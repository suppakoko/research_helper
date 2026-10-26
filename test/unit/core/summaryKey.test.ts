/**
 * `P3-T26` — the summary cache key (`docs/06` §11.2) and the summary cache
 * over the real `cache_entry` store (`docs/07` §9.1–§9.4).
 *
 * The SQLite is `node:sqlite` in memory behind the same port `cache.test.ts`
 * uses, migrated by the shipped migrations, so tags, invalidation and pruning
 * are the shipped SQL. No network, no model: "the LLM" is a counter.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import type { Cache } from "../../../src/core/cache/cache";
import {
  CACHE_SCHEMA_VERSION,
  stableStringify,
  summaryKey,
  type SummaryKeyInput,
} from "../../../src/core/cache/keys";
import {
  CACHE_SCHEMA_TAG,
  createSqliteCache,
  type CacheBlobStore,
  type SqliteCache,
} from "../../../src/core/cache/sqliteCache";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import type { JobRecord } from "../../../src/core/jobQueue/jobRecord";
import { createRunningWork } from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  CACHE_MIXED_MODEL_WARNING,
  createSkipCachedGuard,
  createSummaryCache,
  encodeTagValue,
  PAPER_SUMMARY_SCHEMA_VERSION,
  promptVersionTag,
  reconcilePromptVersions,
  SUMMARY_CACHE_NAMESPACE,
  type SummaryCache,
  type SummaryCacheRequest,
} from "../../../src/pipeline/summarize/summaryCache";
import type { PromptId } from "../../../src/prompts/index";
import type { SqlConnection, SqlParam } from "../../../src/zotero/db";

const here = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// 1. Fixtures
// ---------------------------------------------------------------------------

/** A SHA-256-shaped content hash: 64 hexadecimal characters. */
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const VERSIONS = {
  RELEVANCE_SCREEN: "1.0.0",
  PAPER_SUMMARY_ABSTRACT: "1.0.0",
  PAPER_SUMMARY_FULLTEXT: "1.0.0",
  CHUNK_MAP: "1.0.0",
  CHUNK_REDUCE: "1.0.0",
  THEME_CLUSTER: "1.0.0",
  CLUSTER_REDUCE: "1.0.0",
  TREND_REPORT_EN: "1.0.0",
  TREND_REPORT_KO: "1.0.0",
  SELF_CRITIQUE: "1.0.0",
  THEME_MERGE: "1.0.0",
  CLUSTER_REDUCE_MERGE: "1.0.0",
} as const satisfies Record<PromptId, string>;

/** A partial override of {@link VERSIONS}. */
type VersionOverrides = Partial<Record<PromptId, string>>;

/** Every shipped prompt's `cacheEpoch` (all 1 at version 1.0.0). */
const EPOCHS = {
  RELEVANCE_SCREEN: 1,
  PAPER_SUMMARY_ABSTRACT: 1,
  PAPER_SUMMARY_FULLTEXT: 1,
  CHUNK_MAP: 1,
  CHUNK_REDUCE: 1,
  THEME_CLUSTER: 1,
  CLUSTER_REDUCE: 1,
  TREND_REPORT_EN: 1,
  TREND_REPORT_KO: 1,
  SELF_CRITIQUE: 1,
  THEME_MERGE: 1,
  CLUSTER_REDUCE_MERGE: 1,
} as const satisfies Record<PromptId, number>;

/** A partial override of {@link EPOCHS}. */
type EpochOverrides = Partial<Record<PromptId, number>>;

const METADATA: Readonly<Record<string, string>> = {
  ITEM_KEY: "ABCD2345",
  TITLE: "A synthetic title",
  AUTHORS: "Doe J",
  YEAR: "2024",
  VENUE: "Journal of Fixtures",
  ITEM_TYPE: "journalArticle",
  DOI: "10.1000/fixture",
  TAGS: "",
};

function keyInput(over: Partial<SummaryKeyInput> = {}): SummaryKeyInput {
  return {
    libraryID: 1,
    itemKey: "ABCD2345",
    contentHash: HASH_A,
    tier: "abstract",
    inputScopeKind: "abstract",
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptCacheEpochs: { PAPER_SUMMARY_ABSTRACT: 1 },
    promptMetadata: METADATA,
    schemaVersion: "paper-summary-v1",
    providerId: "anthropic",
    modelId: "model-a-2026-01-01",
    temperature: 0,
    ...over,
  };
}

function request(over: Partial<SummaryCacheRequest> = {}): SummaryCacheRequest {
  return {
    libraryID: 1,
    itemKey: "ABCD2345",
    workKey: "doi:10.1000/fixture",
    contentHash: HASH_A,
    tier: "abstract",
    inputScopeKind: "abstract",
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptMetadata: METADATA,
    providerId: "anthropic",
    modelId: "model-a-2026-01-01",
    temperature: 0,
    ...over,
  };
}

/** A payload shaped like `PaperSummary`; the cache does not look inside. */
function payload(statement = "The fixture finding."): Record<string, unknown> {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey: "ABCD2345",
    sourceTier: "abstract",
    confidence: "high",
    keyFindings: [{ statement, verbatimSupport: "finding" }],
  };
}

// ---------------------------------------------------------------------------
// 2. A real SQLite behind the port (as in cache.test.ts)
// ---------------------------------------------------------------------------

interface Connection extends SqlConnection {
  readonly db: DatabaseSync;
}

function sqlite(): Connection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params));
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction(func) {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      db.close();
      return Promise.resolve();
    },
  };
}

function memoryBlobs(): CacheBlobStore {
  const files = new Map<string, string>();
  return {
    write(name, text) {
      files.set(name, text);
      return Promise.resolve();
    },
    read(name) {
      return Promise.resolve(files.get(name));
    },
    remove(name) {
      files.delete(name);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve([...files.keys()]);
    },
  };
}

interface Harness {
  readonly connection: Connection;
  readonly clock: ManualClock;
  readonly cache: SqliteCache;
  /** Model calls made through {@link summarizeWith}. */
  calls: number;
  readonly prefs: { enabled: boolean; ignoreModel: boolean };
  summaries(versions?: VersionOverrides, epochs?: EpochOverrides): SummaryCache;
  summarizeWith(
    summaries: SummaryCache,
    req: SummaryCacheRequest,
  ): ReturnType<SummaryCache["getOrSummarize"]>;
}

async function harness(
  options: {
    maxBytes?: number;
    pinnedTags?: () => readonly string[];
  } = {},
): Promise<Harness> {
  const connection = sqlite();
  await runMigrations(connection);
  const clock = createManualClock();
  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const cache = createSqliteCache({
    connection: () => Promise.resolve(connection),
    blobs: memoryBlobs(),
    clock,
    logger,
    maxBytes: () => options.maxBytes ?? 10 * 1024 * 1024 * 1024,
    ...(options.pinnedTags !== undefined && { pinnedTags: options.pinnedTags }),
  });
  const prefs = { enabled: true, ignoreModel: false };
  const h: Harness = {
    connection,
    clock,
    cache,
    calls: 0,
    prefs,
    summaries: (versions = {}, epochs = {}) =>
      createSummaryCache({
        cache,
        promptVersions: { ...VERSIONS, ...versions },
        promptCacheEpochs: { ...EPOCHS, ...epochs },
        clock,
        logger,
        enabled: () => prefs.enabled,
        ignoreModel: () => prefs.ignoreModel,
      }),
    summarizeWith: (summaries, req) =>
      summaries.getOrSummarize(req, () => {
        h.calls += 1;
        return Promise.resolve(payload(`finding ${String(h.calls)}`));
      }),
  };
  return h;
}

function rows(connection: Connection): Record<string, unknown>[] {
  return connection.db
    .prepare("SELECT * FROM cache_entry ORDER BY rowid")
    .all()
    .map((row) => ({ ...row }));
}

/** A cache that records which members were called, over another. */
function spyCache(inner: Cache, calls: string[]): Cache {
  return new Proxy(inner, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(name));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 3. summaryKey — docs/06 §11.2
// ---------------------------------------------------------------------------

describe("P3-T26 — summaryKey (docs/06 §11.2)", () => {
  it("is SHA-256 of stableStringify over [v<CACHE_SCHEMA_VERSION>, 'ps', §11.2's components]", () => {
    const input = keyInput();
    const expected = createHash("sha256")
      .update(
        stableStringify([
          `v${String(CACHE_SCHEMA_VERSION)}`,
          "ps",
          1,
          "ABCD2345",
          HASH_A,
          "abstract",
          "abstract",
          "PAPER_SUMMARY_ABSTRACT",
          { PAPER_SUMMARY_ABSTRACT: 1 },
          "paper-summary-v1",
          METADATA,
          "anthropic",
          "model-a-2026-01-01",
          0,
        ]),
        "utf8",
      )
      .digest("hex");
    expect(summaryKey(input)).toBe(expected);
    expect(summaryKey(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  const changes: readonly [string, Partial<SummaryKeyInput>][] = [
    ["the acquired text (contentHash)", { contentHash: HASH_B }],
    ["the tier", { tier: "fulltext_pdf" }],
    ["the input scope kind", { inputScopeKind: "metadata-only" }],
    [
      "the prompt id",
      {
        promptId: "PAPER_SUMMARY_FULLTEXT",
        promptCacheEpochs: { PAPER_SUMMARY_FULLTEXT: 1 },
      },
    ],
    [
      "the prompt's cacheEpoch (a MINOR or MAJOR bump)",
      { promptCacheEpochs: { PAPER_SUMMARY_ABSTRACT: 2 } },
    ],
    [
      "an upstream prompt's cacheEpoch",
      {
        promptCacheEpochs: { PAPER_SUMMARY_ABSTRACT: 1, CHUNK_MAP: 1 },
      },
    ],
    ["the schema version", { schemaVersion: "paper-summary-v2" }],
    ["the provider", { providerId: "openai" }],
    ["the model", { modelId: "model-b-2026-02-01" }],
    ["the temperature", { temperature: 0.2 }],
    ["the library", { libraryID: 2 }],
    ["the item", { itemKey: "WXYZ6789" }],
    [
      "one metadata variable",
      { promptMetadata: { ...METADATA, TAGS: "read" } },
    ],
  ];

  it.each(changes)("misses when only %s changes", (_name, over) => {
    expect(summaryKey(keyInput(over))).not.toBe(summaryKey(keyInput()));
  });

  it("is deterministic and ignores the key order of the two maps", () => {
    const reordered = Object.fromEntries(Object.entries(METADATA).reverse());
    expect(summaryKey(keyInput({ promptMetadata: reordered }))).toBe(
      summaryKey(keyInput()),
    );
    const epochs = { CHUNK_REDUCE: 1, CHUNK_MAP: 2 };
    expect(
      summaryKey(
        keyInput({ promptId: "CHUNK_REDUCE", promptCacheEpochs: epochs }),
      ),
    ).toBe(
      summaryKey(
        keyInput({
          promptId: "CHUNK_REDUCE",
          promptCacheEpochs: { CHUNK_MAP: 2, CHUNK_REDUCE: 1 },
        }),
      ),
    );
  });

  it("anyModel keeps one key across a model change, never equals an exact key, and still keys the provider", () => {
    const anyA = summaryKey(keyInput(), { anyModel: true });
    const anyB = summaryKey(keyInput({ modelId: "model-b-2026-02-01" }), {
      anyModel: true,
    });
    expect(anyA).toBe(anyB);
    expect(anyA).not.toBe(summaryKey(keyInput()));
    expect(
      summaryKey(keyInput({ providerId: "openai" }), { anyModel: true }),
    ).not.toBe(anyA);
    // A model literally named "null" is a string, not the placeholder.
    expect(summaryKey(keyInput({ modelId: "null" }))).not.toBe(anyA);
  });

  it("refuses a hole rather than building a key two holes would share", () => {
    expect(() => summaryKey(keyInput({ contentHash: "" }))).toThrow(RangeError);
    expect(() => summaryKey(keyInput({ itemKey: "" }))).toThrow(RangeError);
    expect(() => summaryKey(keyInput({ modelId: "" }))).toThrow(RangeError);
    expect(() => summaryKey(keyInput({ promptCacheEpochs: {} }))).toThrow(
      RangeError,
    );
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        summaryKey(
          keyInput({ promptCacheEpochs: { PAPER_SUMMARY_ABSTRACT: bad } }),
        ),
      ).toThrow(RangeError);
    }
    expect(() => summaryKey(keyInput({ temperature: Number.NaN }))).toThrow(
      RangeError,
    );
  });

  it("holds PAPER_SUMMARY_SCHEMA_VERSION equal to the schema file's const", () => {
    const schema = JSON.parse(
      readFileSync(
        resolve(
          dirname(here),
          "../../../src/prompts/schemas/paper-summary.v1.json",
        ),
        "utf8",
      ),
    ) as { properties: { schemaVersion: { const: string } } };
    expect(PAPER_SUMMARY_SCHEMA_VERSION).toBe(
      schema.properties.schemaVersion.const,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The summary cache — the card's Done-when
// ---------------------------------------------------------------------------

describe("P3-T26 — the summary cache over cache_entry", () => {
  it("two runs over an unchanged item: a hit and zero model calls on the second", async () => {
    const h = await harness();
    const first = await h.summarizeWith(h.summaries(), request());
    expect(first.fromCache).toBe(false);
    expect(h.calls).toBe(1);

    // A second job: a new SummaryCache over the same store.
    const second = await h.summarizeWith(h.summaries(), request());
    expect(second.fromCache).toBe(true);
    expect(second.warnings).toStrictEqual([]);
    expect(h.calls).toBe(1);
    expect(second.entry).toStrictEqual(first.entry);
  });

  const misses: readonly [
    string,
    Partial<SummaryCacheRequest>,
    VersionOverrides,
    EpochOverrides,
  ][] = [
    ["the acquired text", { contentHash: HASH_B }, {}, {}],
    ["the tier", { tier: "fulltext_pdf", inputScopeKind: "abstract" }, {}, {}],
    [
      "the prompt (a MINOR bump, which raises its cacheEpoch)",
      {},
      { PAPER_SUMMARY_ABSTRACT: "1.1.0" },
      { PAPER_SUMMARY_ABSTRACT: 2 },
    ],
    [
      "the prompt (a MAJOR bump)",
      {},
      { PAPER_SUMMARY_ABSTRACT: "2.0.0" },
      { PAPER_SUMMARY_ABSTRACT: 2 },
    ],
    ["the schema version", { schemaVersion: "paper-summary-v2" }, {}, {}],
    ["the provider", { providerId: "openai" }, {}, {}],
    ["the model", { modelId: "model-b-2026-02-01" }, {}, {}],
    ["the temperature", { temperature: 0.3 }, {}, {}],
  ];

  it.each(misses)(
    "changing only %s misses and calls the model again",
    async (_name, over, versions, epochs) => {
      const h = await harness();
      await h.summarizeWith(h.summaries(), request());
      const again = await h.summarizeWith(
        h.summaries(versions, epochs),
        request(over),
      );
      expect(again.fromCache).toBe(false);
      expect(h.calls).toBe(2);
    },
  );

  it("a PATCH bump keeps the cache: same cacheEpoch, so a hit with zero model calls, and meta still names the version that made it (item 273(a))", async () => {
    const h = await harness();
    const first = await h.summarizeWith(h.summaries(), request());
    expect(first.entry.meta.promptVersion).toBe("1.0.0");
    expect(first.entry.meta.promptCacheEpochs).toStrictEqual({
      PAPER_SUMMARY_ABSTRACT: 1,
    });

    const patched = h.summaries({ PAPER_SUMMARY_ABSTRACT: "1.0.1" });
    expect(patched.keyOf(request())).toBe(h.summaries().keyOf(request()));
    const again = await h.summarizeWith(patched, request());
    expect(again.fromCache).toBe(true);
    expect(h.calls).toBe(1);
    expect(again.entry.meta.promptVersion).toBe("1.0.0");

    // A summary written under the PATCH carries the same line tag as the
    // ones written before it, and names its own version.
    const later = await h.summarizeWith(
      patched,
      request({ itemKey: "WXYZ6789", contentHash: HASH_B }),
    );
    expect(later.fromCache).toBe(false);
    expect(later.entry.meta.promptVersion).toBe("1.0.1");
    expect(patched.tagsOf(request())[0]).toBe(
      h.summaries().tagsOf(request())[0],
    );

    // A CHUNK_MAP PATCH keeps a chunk-reduced summary too.
    const chunked = request({
      promptId: "CHUNK_REDUCE",
      tier: "fulltext_pdf",
      inputScopeKind: "abstract+fulltext",
    });
    await h.summarizeWith(h.summaries(), chunked);
    const calls = h.calls;
    const mapPatched = await h.summarizeWith(
      h.summaries({ CHUNK_MAP: "1.0.7" }),
      chunked,
    );
    expect(mapPatched.fromCache).toBe(true);
    expect(h.calls).toBe(calls);
  });

  it("does not key on the work key: a re-derived work key still hits", async () => {
    const h = await harness();
    await h.summarizeWith(h.summaries(), request());
    const again = await h.summarizeWith(
      h.summaries(),
      request({ workKey: "pmid:12345" }),
    );
    expect(again.fromCache).toBe(true);
    expect(h.calls).toBe(1);
  });

  it("cache.ignoreModel = true hits across a model change, with the mixed-generations warning", async () => {
    const h = await harness();
    // Written while the option was still off.
    await h.summarizeWith(h.summaries(), request());

    const modelB = request({ modelId: "model-b-2026-02-01" });
    h.prefs.ignoreModel = true;
    const found = await h.summaries().lookup(modelB);
    expect(found.hit).toBe(true);
    if (!found.hit) return;
    expect(found.warnings).toStrictEqual([CACHE_MIXED_MODEL_WARNING]);
    expect(found.entry.meta.modelId).toBe("model-a-2026-01-01");

    const served = await h.summarizeWith(h.summaries(), modelB);
    expect(served.fromCache).toBe(true);
    expect(served.warnings).toStrictEqual([CACHE_MIXED_MODEL_WARNING]);
    expect(h.calls).toBe(1);

    // The same model under the option: an exact hit, no warning.
    const same = await h.summarizeWith(h.summaries(), request());
    expect(same.warnings).toStrictEqual([]);

    // The provider is still keyed.
    const otherProvider = await h.summarizeWith(
      h.summaries(),
      request({ providerId: "openai", modelId: "model-b-2026-02-01" }),
    );
    expect(otherProvider.fromCache).toBe(false);

    // With the option off again, the other model misses.
    h.prefs.ignoreModel = false;
    const off = await h.summaries().lookup(modelB);
    expect(off.hit).toBe(false);
  });

  it("follows the newest summary's pointer, and a dangling pointer is a miss", async () => {
    const h = await harness();
    const summaries = h.summaries();
    await h.summarizeWith(summaries, request());
    const b = await h.summarizeWith(
      summaries,
      request({ modelId: "model-b-2026-02-01" }),
    );
    h.prefs.ignoreModel = true;
    const c = request({ modelId: "model-c-2026-03-01" });
    const found = await summaries.lookup(c);
    expect(found.hit && found.entry.meta.modelId).toBe("model-b-2026-02-01");

    await h.cache.delete(
      SUMMARY_CACHE_NAMESPACE,
      summaries.keyOf(request({ modelId: "model-b-2026-02-01" })),
    );
    expect(b.fromCache).toBe(false);
    expect((await summaries.lookup(c)).hit).toBe(false);
  });

  it("a prompt-version change invalidates by tag once and leaves Zotero notes intact", async () => {
    const h = await harness();
    await h.summarizeWith(h.summaries(), request());
    await h.summarizeWith(
      h.summaries(),
      request({
        promptId: "PAPER_SUMMARY_FULLTEXT",
        tier: "fulltext_pdf",
        inputScopeKind: "abstract+fulltext",
        contentHash: HASH_B,
      }),
    );
    // Two summaries, each with its pointer.
    expect(rows(h.connection)).toHaveLength(4);

    const notes = ["<p>A user's summary note</p>"];
    const calls: string[] = [];
    const writes: string[] = [];
    const shipped = { ...VERSIONS, PAPER_SUMMARY_ABSTRACT: "1.1.0" };
    const result = await reconcilePromptVersions({
      cache: spyCache(h.cache, calls),
      shipped,
      readLastSeen: () => JSON.stringify(VERSIONS),
      writeLastSeen: (json) => writes.push(json),
    });

    expect(calls).toStrictEqual(["invalidateByTag"]);
    expect(result.changed).toStrictEqual([
      {
        promptId: "PAPER_SUMMARY_ABSTRACT",
        from: "1.0.0",
        to: "1.1.0",
        invalidated: true,
      },
    ]);
    expect(result.invalidated).toBe(2);
    expect(writes).toStrictEqual([stableStringify(shipped)]);
    expect(result.wrote).toBe(true);
    // Only the abstract summary and its pointer went; notes are not the cache's.
    const left = rows(h.connection);
    expect(left).toHaveLength(2);
    expect(String(left[0]?.["tags"])).toContain(
      promptVersionTag("PAPER_SUMMARY_FULLTEXT", "1.0.0"),
    );
    expect(notes).toStrictEqual(["<p>A user's summary note</p>"]);

    // The next start sees the new set: nothing to invalidate, nothing written.
    const again = await reconcilePromptVersions({
      cache: spyCache(h.cache, calls),
      shipped,
      readLastSeen: () => writes[0] ?? "",
      writeLastSeen: (json) => writes.push(json),
    });
    expect(again).toStrictEqual({ changed: [], invalidated: 0, wrote: false });
    expect(calls).toStrictEqual(["invalidateByTag"]);
    expect(writes).toHaveLength(1);
  });

  it("a CHUNK_MAP change invalidates the chunk-reduced summaries too", async () => {
    const h = await harness();
    await h.summarizeWith(
      h.summaries(),
      request({
        promptId: "CHUNK_REDUCE",
        tier: "fulltext_pdf",
        inputScopeKind: "abstract+fulltext",
      }),
    );
    const result = await reconcilePromptVersions({
      cache: h.cache,
      shipped: { ...VERSIONS, CHUNK_MAP: "1.1.0" },
      readLastSeen: () => JSON.stringify(VERSIONS),
      writeLastSeen: () => undefined,
    });
    expect(result.invalidated).toBe(2);
    expect(rows(h.connection)).toHaveLength(0);
  });

  it("first start writes the set without invalidating; an unreadable pref reads as empty; a failed invalidation writes nothing", async () => {
    const writes: string[] = [];
    const calls: string[] = [];
    const h = await harness();
    const first = await reconcilePromptVersions({
      cache: spyCache(h.cache, calls),
      shipped: VERSIONS,
      readLastSeen: () => "{}",
      writeLastSeen: (json) => writes.push(json),
    });
    expect(first).toStrictEqual({ changed: [], invalidated: 0, wrote: true });
    expect(calls).toStrictEqual([]);

    const corrupt = await reconcilePromptVersions({
      cache: spyCache(h.cache, calls),
      shipped: VERSIONS,
      readLastSeen: () => '["not", "an", "object"]',
      writeLastSeen: (json) => writes.push(json),
    });
    expect(corrupt.wrote).toBe(true);
    expect(calls).toStrictEqual([]);

    const failing: Pick<Cache, "invalidateByTag"> = {
      invalidateByTag: () => Promise.reject(new Error("disk full")),
    };
    writes.length = 0;
    await expect(
      reconcilePromptVersions({
        cache: failing,
        shipped: { ...VERSIONS, PAPER_SUMMARY_ABSTRACT: "2.0.0" },
        readLastSeen: () => JSON.stringify(VERSIONS),
        writeLastSeen: (json) => writes.push(json),
      }),
    ).rejects.toThrow("disk full");
    expect(writes).toStrictEqual([]);
  });

  it("invalidates a prompt that is no longer shipped", async () => {
    const tags: string[] = [];
    const result = await reconcilePromptVersions({
      cache: {
        invalidateByTag: (tag) => {
          tags.push(tag);
          return Promise.resolve(0);
        },
      },
      shipped: { PAPER_SUMMARY_ABSTRACT: "1.0.0" },
      readLastSeen: () =>
        JSON.stringify({
          PAPER_SUMMARY_ABSTRACT: "1.0.0",
          OLD_PROMPT: "3.0.0",
        }),
      writeLastSeen: () => undefined,
    });
    expect(tags).toStrictEqual(["promptVersion:OLD_PROMPT@3.0"]);
    expect(result.changed).toStrictEqual([
      {
        promptId: "OLD_PROMPT",
        from: "3.0.0",
        to: undefined,
        invalidated: true,
      },
    ]);
  });

  it("a PATCH-only change invalidates nothing and writes the new set; the next MINOR bump removes the entries written before and after the PATCH (item 273(a))", async () => {
    const h = await harness();
    await h.summarizeWith(h.summaries(), request());
    expect(rows(h.connection)).toHaveLength(2);

    const calls: string[] = [];
    const writes: string[] = [];
    const patchSet = { ...VERSIONS, PAPER_SUMMARY_ABSTRACT: "1.0.1" };
    const patch = await reconcilePromptVersions({
      cache: spyCache(h.cache, calls),
      shipped: patchSet,
      readLastSeen: () => JSON.stringify(VERSIONS),
      writeLastSeen: (json) => writes.push(json),
    });
    expect(patch).toStrictEqual({
      changed: [
        {
          promptId: "PAPER_SUMMARY_ABSTRACT",
          from: "1.0.0",
          to: "1.0.1",
          invalidated: false,
        },
      ],
      invalidated: 0,
      wrote: true,
    });
    expect(calls).toStrictEqual([]);
    expect(writes).toStrictEqual([stableStringify(patchSet)]);
    expect(rows(h.connection)).toHaveLength(2);

    // Under 1.0.1: the old summary still hits, a new one is written.
    const patched = h.summaries({ PAPER_SUMMARY_ABSTRACT: "1.0.1" });
    expect((await h.summarizeWith(patched, request())).fromCache).toBe(true);
    await h.summarizeWith(
      patched,
      request({ itemKey: "WXYZ6789", contentHash: HASH_B }),
    );
    expect(h.calls).toBe(2);
    expect(rows(h.connection)).toHaveLength(4);

    // 1.0.1 -> 1.1.0: the 1.0 line goes, both summaries and their pointers.
    const minor = await reconcilePromptVersions({
      cache: spyCache(h.cache, calls),
      shipped: { ...VERSIONS, PAPER_SUMMARY_ABSTRACT: "1.1.0" },
      readLastSeen: () => writes[0] ?? "",
      writeLastSeen: (json) => writes.push(json),
    });
    expect(calls).toStrictEqual(["invalidateByTag"]);
    expect(minor.changed).toStrictEqual([
      {
        promptId: "PAPER_SUMMARY_ABSTRACT",
        from: "1.0.1",
        to: "1.1.0",
        invalidated: true,
      },
    ]);
    expect(minor.invalidated).toBe(4);
    expect(rows(h.connection)).toHaveLength(0);
  });

  it("a MAJOR change invalidates too, and only the changed prompt's line", async () => {
    const tags: string[] = [];
    const result = await reconcilePromptVersions({
      cache: {
        invalidateByTag: (tag) => {
          tags.push(tag);
          return Promise.resolve(0);
        },
      },
      shipped: { ...VERSIONS, CHUNK_MAP: "2.0.0", CHUNK_REDUCE: "1.0.3" },
      readLastSeen: () => JSON.stringify(VERSIONS),
      writeLastSeen: () => undefined,
    });
    expect(tags).toStrictEqual(["promptVersion:CHUNK_MAP@1.0"]);
    expect(
      result.changed.map(({ promptId, invalidated }) => [
        promptId,
        invalidated,
      ]),
    ).toStrictEqual([
      ["CHUNK_MAP", true],
      ["CHUNK_REDUCE", false],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. Tags, pinning, the gate, the switches, failures
// ---------------------------------------------------------------------------

describe("P3-T26 — tags, pinning, the redaction gate and the switches", () => {
  it("tags every entry promptVersion, model, provider, work and schema, escaping a comma", async () => {
    const h = await harness();
    const req = request({ workKey: "doi:10.1000/a,b%c" });
    await h.summarizeWith(h.summaries(), req);
    const tags = String(rows(h.connection)[0]?.["tags"]).split(",");
    expect(tags).toStrictEqual([
      "promptVersion:PAPER_SUMMARY_ABSTRACT@1.0",
      "model:model-a-2026-01-01",
      "provider:anthropic",
      "work:doi:10.1000/a%2Cb%25c",
      "schema:paper-summary-v1",
      CACHE_SCHEMA_TAG,
    ]);
    expect(encodeTagValue("a,b%c")).toBe("a%2Cb%25c");
    // The pointer carries the same tags, so it goes with its entry.
    expect(rows(h.connection)[1]?.["tags"]).toBe(
      rows(h.connection)[0]?.["tags"],
    );

    const chunked = h.summaries().tagsOf(request({ promptId: "CHUNK_REDUCE" }));
    expect(chunked.slice(0, 2)).toStrictEqual([
      "promptVersion:CHUNK_REDUCE@1.0",
      "promptVersion:CHUNK_MAP@1.0",
    ]);
    expect(() => h.summaries().tagsOf(request({ workKey: "" }))).toThrow(
      RangeError,
    );
  });

  it("never evicts the entries of a running job's work (P3-T17's pinned tags)", async () => {
    const running = createRunningWork();
    const h = await harness({ maxBytes: 1, pinnedTags: running.pinnedTags });
    const release = running.hold("job-1", ["doi:10.1000/fixture"]);
    await h.summarizeWith(h.summaries(), request());
    await h.cache.prune();
    expect(rows(h.connection)).toHaveLength(2);

    release();
    await h.cache.prune();
    expect(rows(h.connection)).toHaveLength(0);
  });

  it("pins a running job's entries even when its work key holds ',' or '%' (item 273(c))", async () => {
    const running = createRunningWork();
    const h = await harness({ maxBytes: 1, pinnedTags: running.pinnedTags });
    const workKey = "doi:10.1000/a,b%c";
    const release = running.hold("job-1", [workKey]);
    expect(running.pinnedTags()).toStrictEqual([
      `work:${encodeTagValue(workKey)}`,
    ]);
    await h.summarizeWith(h.summaries(), request({ workKey }));
    // The tag the cache wrote is the tag the runner pins.
    expect(String(rows(h.connection)[0]?.["tags"]).split(",")).toContain(
      running.pinnedTags()[0],
    );
    await h.cache.prune();
    expect(rows(h.connection)).toHaveLength(2);

    release();
    await h.cache.prune();
    expect(rows(h.connection)).toHaveLength(0);
  });

  it("stores only what redactRecord let through, with the mark, and keeps the identifiers verbatim", async () => {
    const h = await harness();
    const opaque = "q".repeat(44);
    const entry = await h
      .summaries()
      .store(request(), payload(`run ${opaque}`));

    expect(entry.redaction.partlyRedacted).toBe(true);
    expect(entry.redaction.redactedStrings).toBe(1);
    expect(entry.meta.contentHash).toBe(HASH_A);
    expect(entry.meta.workKey).toBe("doi:10.1000/fixture");
    expect(entry.meta.promptVersion).toBe("1.0.0");
    expect(entry.meta.promptCacheEpochs).toStrictEqual({
      PAPER_SUMMARY_ABSTRACT: 1,
    });
    expect(entry.meta.generatedAtEpochMs).toBe(h.clock.now());

    const stored = rows(h.connection).map((row) => String(row["value"]));
    expect(stored.join("\n")).not.toContain(opaque);
    expect(stored[0]).toContain(HASH_A);

    // What a later run is served is the gated value, mark included.
    const found = await h.summaries().lookup(request());
    expect(found.hit && found.entry).toStrictEqual(entry);
  });

  it("cache.enabled = false reads and writes nothing, and still returns the gated entry", async () => {
    const h = await harness();
    h.prefs.enabled = false;
    const first = await h.summarizeWith(h.summaries(), request());
    const second = await h.summarizeWith(h.summaries(), request());
    expect(first.fromCache || second.fromCache).toBe(false);
    expect(h.calls).toBe(2);
    expect(rows(h.connection)).toHaveLength(0);
    expect(first.entry.meta.itemKey).toBe("ABCD2345");
    const looked = await h.summaries().lookup(request());
    expect(looked).toMatchObject({ hit: false, reason: "disabled" });
  });

  it("a read that throws or an entry that does not describe its key is a miss; a write that throws keeps the summary", async () => {
    const h = await harness();
    const summaries = h.summaries();
    await h.cache.set(SUMMARY_CACHE_NAMESPACE, summaries.keyOf(request()), {
      summary: payload(),
      meta: { itemKey: "SOMEONE" },
    });
    expect((await summaries.lookup(request())).hit).toBe(false);

    const broken: Cache = {
      ...h.cache,
      get: () => Promise.reject(new Error("locked")),
      set: () => Promise.reject(new Error("locked")),
    };
    let calls = 0;
    const result = await createSummaryCache({
      cache: broken,
      promptVersions: VERSIONS,
      promptCacheEpochs: EPOCHS,
      clock: h.clock,
      enabled: () => true,
      ignoreModel: () => true,
    }).getOrSummarize(request(), () => {
      calls += 1;
      return Promise.resolve(payload());
    });
    expect(result.fromCache).toBe(false);
    expect(calls).toBe(1);
    expect(result.entry.summary).toStrictEqual(payload());
  });

  it("concurrent calls for one key share one model call", async () => {
    const h = await harness();
    const summaries = h.summaries();
    const [a, b] = await Promise.all([
      h.summarizeWith(summaries, request()),
      h.summarizeWith(summaries, request()),
    ]);
    expect(h.calls).toBe(1);
    expect(a.entry).toStrictEqual(b.entry);
  });

  it("refuses a summary prompt with no shipped version or no shipped cacheEpoch", async () => {
    const h = await harness();
    const summaries = createSummaryCache({
      cache: h.cache,
      promptVersions: { PAPER_SUMMARY_ABSTRACT: "1.0.0" },
      promptCacheEpochs: EPOCHS,
      clock: h.clock,
    });
    expect(() =>
      summaries.tagsOf(request({ promptId: "CHUNK_REDUCE" })),
    ).toThrow(RangeError);
    const noEpoch = createSummaryCache({
      cache: h.cache,
      promptVersions: VERSIONS,
      promptCacheEpochs: { PAPER_SUMMARY_ABSTRACT: 1 },
      clock: h.clock,
    });
    expect(() => noEpoch.keyOf(request({ promptId: "CHUNK_REDUCE" }))).toThrow(
      RangeError,
    );
    expect(() => noEpoch.keyOf(request())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. ResumeGuards.skipCached — docs/07 §7.6
// ---------------------------------------------------------------------------

describe("P3-T26 — ResumeGuards.skipCached", () => {
  const checkpoint = {
    version: 1,
    pending: ["doi:1", "doi:2", "doi:3"],
    completed: ["doi:0"],
    failed: [],
    stageKey: "summarize",
  };
  const record = (cp: unknown): JobRecord =>
    ({ id: "job-1", checkpoint: cp }) as unknown as JobRecord;

  it("without a probe returns the checkpoint unchanged: nothing is skipped", async () => {
    const guard = createSkipCachedGuard({ enabled: () => true });
    expect(await guard(record(checkpoint))).toBe(checkpoint);
  });

  it("moves the keys the probe calls done to completed, and keeps a throwing probe's key pending", async () => {
    const guard = createSkipCachedGuard({
      enabled: () => true,
      probe: (_record, workKey) =>
        workKey === "doi:3"
          ? Promise.reject(new Error("unreadable"))
          : Promise.resolve(workKey === "doi:1"),
    });
    expect(await guard(record(checkpoint))).toStrictEqual({
      ...checkpoint,
      pending: ["doi:2", "doi:3"],
      completed: ["doi:0", "doi:1"],
    });
  });

  it("leaves a foreign checkpoint alone, and skips nothing with the cache off", async () => {
    const probe = (): Promise<boolean> => Promise.resolve(true);
    const foreign = { stage: "import", cursor: 4 };
    expect(
      await createSkipCachedGuard({ enabled: () => true, probe })(
        record(foreign),
      ),
    ).toBe(foreign);
    expect(
      await createSkipCachedGuard({ enabled: () => false, probe })(
        record(checkpoint),
      ),
    ).toBe(checkpoint);
  });
});

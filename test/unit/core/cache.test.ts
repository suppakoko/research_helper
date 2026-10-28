/**
 * `P3-T33` — the cache layer at layer 1: `src/core/cache/keys.ts`,
 * `src/core/cache/sqliteCache.ts` and migration version 3.
 *
 * Plain Node (`docs/13` §2.1): no Zotero, no network. The store runs against a
 * real SQLite (`node:sqlite`, as `test/unit/core/provenanceRerun.test.ts`
 * explains) migrated by the shipped `runMigrations`, so every `SELECT`,
 * `instr` match and `ON CONFLICT` upsert is executed by SQLite rather than by
 * a double. The blob directory is an in-memory map behind the
 * `CacheBlobStore` port; `src/zotero/db.ts`'s `IOUtils` implementation is
 * exercised by `test/integration/zotero/provenanceStore.spec.ts`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CACHE_ENTRY_DDL,
  CACHE_EXPIRY_INDEX_DDL,
  CACHE_LRU_INDEX_DDL,
  runMigrations,
} from "../../../src/bootstrap/migrations";
import {
  CACHE_BLOB_THRESHOLD_BYTES,
  CACHE_NAMESPACE_POLICIES,
  NO_CACHE,
} from "../../../src/core/cache/cache";
import {
  CACHE_SCHEMA_VERSION,
  cacheKey,
  sha256Hex,
  stableStringify,
} from "../../../src/core/cache/keys";
import {
  CACHE_BLOB_PATH_PREFIX,
  CACHE_SCHEMA_TAG,
  createSqliteCache,
  evictionScore,
  type CacheBlobStore,
  type SqliteCache,
} from "../../../src/core/cache/sqliteCache";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { SqlConnection, SqlParam } from "../../../src/zotero/db";

const here = fileURLToPath(import.meta.url);
const DOCS_07 = readFileSync(
  resolve(dirname(here), "../../../docs/07-architecture-and-data-model.md"),
  "utf8",
);

/** `docs/07` §8.3's statement that starts with `head`, up to its `;`. */
function docsStatement(head: string): string {
  const start = DOCS_07.indexOf(head);
  expect(start, `docs/07 carries "${head}"`).toBeGreaterThan(-1);
  return DOCS_07.slice(start, DOCS_07.indexOf(";", start));
}

// ---------------------------------------------------------------------------
// 1. A real SQLite behind the port, and an in-memory blob directory
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
      // Zotero 10.0.3's `db.js`: `rows.length ? rows[0].getResultByIndex(0) : false`.
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

interface MemoryBlobs extends CacheBlobStore {
  readonly files: Map<string, string>;
}

function memoryBlobs(): MemoryBlobs {
  const files = new Map<string, string>();
  return {
    files,
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
  readonly blobs: MemoryBlobs;
  readonly clock: ManualClock;
  readonly cache: SqliteCache;
}

const BIG = 10 * 1024 * 1024 * 1024;

async function harness(
  options: {
    maxBytes?: number;
    pinnedTags?: () => readonly string[];
  } = {},
): Promise<Harness> {
  const connection = sqlite();
  await runMigrations(connection);
  const blobs = memoryBlobs();
  const clock = createManualClock();
  const cache = createSqliteCache({
    connection: () => Promise.resolve(connection),
    blobs,
    clock,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    maxBytes: () => options.maxBytes ?? BIG,
    ...(options.pinnedTags !== undefined && {
      pinnedTags: options.pinnedTags,
    }),
  });
  return { connection, blobs, clock, cache };
}

function row(
  connection: Connection,
  namespace: string,
  key: string,
): Record<string, unknown> | undefined {
  const found = connection.db
    .prepare("SELECT * FROM cache_entry WHERE namespace = ? AND key = ?")
    .get(namespace, key);
  return found === undefined ? undefined : { ...found };
}

function count(connection: Connection): number {
  return Number(
    (
      connection.db.prepare("SELECT COUNT(*) AS n FROM cache_entry").get() as {
        n: number;
      }
    ).n,
  );
}

// ---------------------------------------------------------------------------
// 2. Keys — docs/07 §9.1
// ---------------------------------------------------------------------------

describe("P3-T33 — stableStringify and the key helper (docs/07 §9.1)", () => {
  it("hashes {a:1,b:2} and {b:2,a:1} to the same key", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(
      stableStringify({ b: 2, a: 1 }),
    );
    expect(cacheKey("source", { a: 1, b: 2 })).toBe(
      cacheKey("source", { b: 2, a: 1 }),
    );
  });

  it("sorts nested keys, keeps array order, and follows JSON for what it leaves out", () => {
    expect(
      stableStringify({
        z: [3, { y: 1, x: undefined, w: "v" }, undefined],
        a: { c: Number.NaN, b: null },
        d: new Date(0),
      }),
    ).toBe(
      '{"a":{"b":null,"c":null},"d":"1970-01-01T00:00:00.000Z","z":[3,{"w":"v","y":1},null]}',
    );
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  it("refuses a cycle and a bigint rather than guessing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(TypeError);
    expect(() => stableStringify({ n: 1n })).toThrow(TypeError);
    // A repeated, non-cyclic reference is fine.
    const shared = { k: 1 };
    expect(stableStringify({ a: shared, b: shared })).toBe(
      '{"a":{"k":1},"b":{"k":1}}',
    );
  });

  it("computes SHA-256 as Node's crypto does, across block boundaries and non-ASCII text", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    for (const text of [
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(1000),
      "유전자 편집 — CRISPR/Cas9 🧬",
    ]) {
      expect(sha256Hex(text), `length ${String(text.length)}`).toBe(
        createHash("sha256").update(text, "utf8").digest("hex"),
      );
    }
  });

  it("puts CACHE_SCHEMA_VERSION and the kind in every key, and cannot confuse a | inside a part", () => {
    expect(CACHE_SCHEMA_VERSION).toBe(1);
    expect(cacheKey("source", "x")).toBe(
      sha256Hex(stableStringify(["v1", "source", "x"])),
    );
    expect(cacheKey("source", "x")).not.toBe(cacheKey("summary", "x"));
    expect(cacheKey("k", "a|b", "c")).not.toBe(cacheKey("k", "a", "b|c"));
    expect(cacheKey("k")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 3. The migration — docs/07 §8.3
// ---------------------------------------------------------------------------

describe("P3-T33 — cache_entry is docs/07 §8.3's, as migration version 3", () => {
  it("copies cache_entry and its two indexes from docs/07 §8.3 byte for byte", () => {
    expect(CACHE_ENTRY_DDL).toBe(docsStatement("CREATE TABLE cache_entry ("));
    expect(CACHE_EXPIRY_INDEX_DDL).toBe(
      docsStatement("CREATE INDEX idx_cache_expiry"),
    );
    expect(CACHE_LRU_INDEX_DDL).toBe(
      docsStatement("CREATE INDEX idx_cache_lru"),
    );
  });

  // Moved with plan/00 §6 item 265 (b), which appended version 4
  // (`user_price`), and with P3-T15, which appended version 5
  // (`collection_settings`), and with P3-T25 (`summary`, version 6): a fresh
  // file now ends at version 6.
  it("migrates a fresh file to the latest version (6) with cache_entry's columns and indexes, read back", async () => {
    const connection = sqlite();
    expect(await runMigrations(connection)).toStrictEqual({ from: 0, to: 6 });
    expect(
      connection.db
        .prepare("PRAGMA table_info(cache_entry)")
        .all()
        .map((r) => {
          const c = r as {
            name: string;
            type: string;
            notnull: number;
            pk: number;
          };
          return [c.name, c.type, c.notnull, c.pk];
        }),
    ).toStrictEqual([
      ["namespace", "TEXT", 1, 1],
      ["key", "TEXT", 1, 2],
      ["value", "TEXT", 0, 0],
      ["blob_path", "TEXT", 0, 0],
      ["size_bytes", "INTEGER", 1, 0],
      ["tags", "TEXT", 1, 0],
      ["created_at", "INTEGER", 1, 0],
      ["expires_at", "INTEGER", 0, 0],
      ["last_access", "INTEGER", 1, 0],
      ["hits", "INTEGER", 1, 0],
    ]);
    for (const [index, column] of [
      ["idx_cache_expiry", "expires_at"],
      ["idx_cache_lru", "last_access"],
    ] as const) {
      expect(
        connection.db
          .prepare(`PRAGMA index_info(${index})`)
          .all()
          .map((r) => (r as { name: string }).name),
      ).toStrictEqual([column]);
    }
  });

  it("brings a version-2 file through version 3 to the latest (6) without touching the job table", async () => {
    const connection = sqlite();
    await runMigrations(connection, [
      { version: 1, statements: ["CREATE TABLE search_provenance (a)"] },
      { version: 2, statements: ["CREATE TABLE job (id TEXT)"] },
    ]);
    connection.db.exec("INSERT INTO job VALUES ('kept')");
    expect(await runMigrations(connection)).toStrictEqual({ from: 2, to: 6 });
    expect(connection.db.prepare("SELECT id FROM job").all()).toHaveLength(1);
    expect(count(connection)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The store
// ---------------------------------------------------------------------------

describe("P3-T33 — the SQLite cache: get, set, TTL, tags", () => {
  it("round-trips a value, and counts the hit on the row", async () => {
    const { cache, connection, clock } = await harness();
    const value = { title: "CRISPR", ids: [1, 2], nested: { ok: true } };
    await cache.set("canonical-work", "k1", value, { tags: ["work:w1"] });
    expect(await cache.get("canonical-work", "k1")).toStrictEqual(value);
    clock.advance(5);
    const found = await cache.getWithMeta("canonical-work", "k1");
    expect(found?.value).toStrictEqual(value);
    expect(found?.meta).toMatchObject({
      key: "k1",
      namespace: "canonical-work",
      hits: 2,
      lastAccessedEpochMs: clock.now(),
      tags: ["work:w1", CACHE_SCHEMA_TAG],
      sizeBytes: JSON.stringify(value).length,
    });
    expect(row(connection, "canonical-work", "k1")).toMatchObject({
      hits: 2,
      last_access: clock.now(),
      tags: `work:w1,${CACHE_SCHEMA_TAG}`,
    });
    expect(await cache.get("canonical-work", "absent")).toBeUndefined();
    expect(await cache.has("canonical-work", "k1")).toBe(true);
  });

  it("overwrites an entry in place, resetting its hits", async () => {
    const { cache, connection } = await harness();
    await cache.set("report", "k", "one");
    await cache.get("report", "k");
    await cache.set("report", "k", "two");
    expect(await cache.get("report", "k")).toBe("two");
    expect(count(connection)).toBe(1);
    expect(row(connection, "report", "k")?.["hits"]).toBe(1);
  });

  it("expires an entry at its TTL on a fake clock, and prune() removes it", async () => {
    const { cache, clock, connection } = await harness();
    await cache.set("llm-completion", "short", "v", { ttlMs: 1000 });
    clock.advance(999);
    expect(await cache.get("llm-completion", "short")).toBe("v");
    clock.advance(1);
    expect(await cache.get("llm-completion", "short")).toBeUndefined();
    expect(await cache.has("llm-completion", "short")).toBe(false);
    expect(count(connection)).toBe(1);
    expect(await cache.prune()).toMatchObject({ expiredRemoved: 1 });
    expect(count(connection)).toBe(0);
  });

  it("takes the namespace's docs/07 §9.2 TTL when none is given, and none for summary", async () => {
    const { cache, clock, connection } = await harness();
    const now = clock.now();
    await cache.set("source-response", "s", 1);
    await cache.set("summary", "m", 2);
    expect(row(connection, "source-response", "s")?.["expires_at"]).toBe(
      now + (CACHE_NAMESPACE_POLICIES["source-response"].ttlMs ?? 0),
    );
    expect(row(connection, "summary", "m")?.["expires_at"]).toBeNull();
    clock.advance(24 * 60 * 60 * 1000);
    expect(await cache.get("source-response", "s")).toBeUndefined();
    expect(await cache.get("summary", "m")).toBe(2);
  });

  it("invalidates by tag exactly the tagged entries, with no LIKE wildcard and no prefix match", async () => {
    const { cache, connection } = await harness();
    await cache.set("summary", "a", 1, { tags: ["model:gpt_4", "work:w1"] });
    await cache.set("summary", "b", 2, { tags: ["model:gpt_4"] });
    await cache.set("summary", "c", 3, { tags: ["model:gptx4"] });
    await cache.set("summary", "d", 4, { tags: ["model:gpt_45"] });
    await cache.set("embedding", "e", 5, { tags: ["work:w1"] });
    expect(await cache.invalidateByTag("model:gpt_4")).toBe(2);
    expect(await cache.get("summary", "a")).toBeUndefined();
    expect(await cache.get("summary", "b")).toBeUndefined();
    expect(await cache.get("summary", "c")).toBe(3);
    expect(await cache.get("summary", "d")).toBe(4);
    expect(await cache.invalidateByTag("work:w1")).toBe(1);
    expect(count(connection)).toBe(2);
    // Every entry carries the schema tag (§9.3 trigger 4).
    expect(await cache.invalidateByTag(CACHE_SCHEMA_TAG)).toBe(2);
    expect(count(connection)).toBe(0);
  });

  it("refuses a tag with a comma and a value with no JSON form", async () => {
    const { cache } = await harness();
    await expect(
      cache.set("report", "k", 1, { tags: ["a,b"] }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(cache.set("report", "k", undefined)).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it("skips a write over maxValueBytes", async () => {
    const { cache, connection } = await harness();
    await cache.set("report", "k", "x".repeat(100), { maxValueBytes: 50 });
    expect(count(connection)).toBe(0);
  });

  it("deletes one entry and clears one namespace", async () => {
    const { cache, connection } = await harness();
    await cache.set("report", "a", 1);
    await cache.set("report", "b", 2);
    await cache.set("summary", "c", 3);
    await cache.delete("report", "a");
    expect(await cache.get("report", "a")).toBeUndefined();
    expect(await cache.clearNamespace("report")).toBe(1);
    expect(count(connection)).toBe(1);
  });
});

describe("P3-T33 — values over 256 KB spill to a blob file (docs/07 §9.2)", () => {
  const large = {
    text: "é".repeat(CACHE_BLOB_THRESHOLD_BYTES / 2),
    tail: [1, 2, 3],
  };

  it("spills a value over 256 KB and reads it back identical", async () => {
    const { cache, connection, blobs } = await harness();
    await cache.set("summary", "big", large);
    const stored = row(connection, "summary", "big");
    expect(stored?.["value"]).toBeNull();
    const name = sha256Hex("summary|big");
    expect(stored?.["blob_path"]).toBe(`${CACHE_BLOB_PATH_PREFIX}${name}`);
    expect(stored?.["size_bytes"]).toBeGreaterThan(CACHE_BLOB_THRESHOLD_BYTES);
    expect(blobs.files.get(name)).toBe(JSON.stringify(large));
    expect(await cache.get("summary", "big")).toStrictEqual(large);
  });

  it("keeps a value of exactly 256 KB inline", async () => {
    const { cache, connection, blobs } = await harness();
    // JSON adds two quote characters.
    await cache.set(
      "summary",
      "edge",
      "a".repeat(CACHE_BLOB_THRESHOLD_BYTES - 2),
    );
    expect(row(connection, "summary", "edge")?.["blob_path"]).toBeNull();
    expect(blobs.files.size).toBe(0);
  });

  it("removes the blob when the entry is overwritten small, deleted or invalidated", async () => {
    const { cache, blobs } = await harness();
    await cache.set("summary", "big", large);
    await cache.set("summary", "big", "small now");
    expect(blobs.files.size).toBe(0);
    expect(await cache.get("summary", "big")).toBe("small now");
    await cache.set("summary", "big", large, { tags: ["work:w9"] });
    expect(blobs.files.size).toBe(1);
    await cache.invalidateByTag("work:w9");
    expect(blobs.files.size).toBe(0);
    await cache.set("summary", "big", large);
    await cache.delete("summary", "big");
    expect(blobs.files.size).toBe(0);
  });

  it("treats a missing blob file as a miss and drops the row; prune() sweeps orphaned files", async () => {
    const { cache, connection, blobs } = await harness();
    await cache.set("summary", "big", large);
    blobs.files.clear();
    expect(await cache.get("summary", "big")).toBeUndefined();
    expect(count(connection)).toBe(0);
    blobs.files.set("f".repeat(64), "orphan");
    await cache.prune();
    expect(blobs.files.size).toBe(0);
  });
});

describe("P3-T33 — eviction (docs/07 §9.4)", () => {
  const MB = 1024 * 1024;

  it("evicts least-recently-used entries first when a namespace cap is exceeded, to 90 % of it", async () => {
    // `recommendation`'s cap is 20 MB (§9.2): seven 3 MB entries exceed it.
    const { cache, clock, connection } = await harness();
    expect(CACHE_NAMESPACE_POLICIES.recommendation.capBytes).toBe(20 * MB);
    const value = "r".repeat(3 * MB - 2);
    for (let i = 0; i < 6; i += 1) {
      clock.advance(1000);
      await cache.set("recommendation", `e${String(i)}`, value);
    }
    clock.advance(1000);
    // e0 is the oldest write but the most recent read.
    expect(await cache.get("recommendation", "e0")).toBe(value);
    clock.advance(1000);
    await cache.set("recommendation", "e6", value);
    const left = connection.db
      .prepare("SELECT key FROM cache_entry ORDER BY key")
      .all()
      .map((r) => (r as { key: string }).key);
    // 21 MB → 18 MB: exactly one 3 MB entry goes, the least recently used.
    expect(left).toStrictEqual(["e0", "e2", "e3", "e4", "e5", "e6"]);
  });

  it("evicts to 90 % of the global cap, keeping the expensive namespaces longer", async () => {
    const { cache, clock, connection } = await harness({ maxBytes: 1000 });
    const value = "x".repeat(298); // 300 bytes of JSON
    await cache.set("summary", "old-summary", value);
    clock.advance(60_000);
    await cache.set("source-response", "s1", value);
    clock.advance(60_000);
    await cache.set("source-response", "s2", value);
    clock.advance(60_000);
    await cache.set("source-response", "s3", value); // 1200 > 1000 → to 900
    const left = connection.db
      .prepare("SELECT key FROM cache_entry ORDER BY key")
      .all()
      .map((r) => (r as { key: string }).key);
    expect(left).toStrictEqual(["old-summary", "s2", "s3"]);
  });

  it("evicts down to the 90 % low-water mark, not merely to the cap", async () => {
    const { cache, clock, connection } = await harness({ maxBytes: 1000 });
    const value = "x".repeat(248); // 250 bytes of JSON
    for (const key of ["s1", "s2", "s3", "s4", "s5"]) {
      clock.advance(60_000);
      await cache.set("source-response", key, value);
    }
    // 1250 bytes: to the cap would drop one (1000); to 900 drops two (750).
    expect(count(connection)).toBe(3);
  });

  it("never evicts an entry carrying a pinned tag (a running job's work)", async () => {
    const { cache, clock, connection } = await harness({
      maxBytes: 1000,
      pinnedTags: () => ["work:running"],
    });
    const value = "x".repeat(298);
    await cache.set("source-response", "pinned", value, {
      tags: ["work:running"],
    });
    for (const key of ["s1", "s2", "s3"]) {
      clock.advance(60_000);
      await cache.set("source-response", key, value);
    }
    const left = connection.db
      .prepare("SELECT key FROM cache_entry ORDER BY key")
      .all()
      .map((r) => (r as { key: string }).key);
    expect(left).toStrictEqual(["pinned", "s2", "s3"]);
  });

  it("scores recency, hits and the retention bonus, lowest first", () => {
    const base = { lastAccess: 1_000_000, hits: 0 };
    expect(evictionScore({ ...base, namespace: "summary" })).toBeGreaterThan(
      evictionScore({ ...base, namespace: "source-response" }),
    );
    expect(
      evictionScore({ ...base, hits: 1, namespace: "source-response" }),
    ).toBeGreaterThan(evictionScore({ ...base, namespace: "source-response" }));
  });
});

describe("P3-T33 — getOrCompute, stats, close, and no database", () => {
  it("shares one computation between concurrent callers, and hits afterwards", async () => {
    const { cache } = await harness();
    let calls = 0;
    let release: (value: string) => void = () => undefined;
    const compute = (): Promise<string> => {
      calls += 1;
      return new Promise((done) => {
        release = done;
      });
    };
    const first = cache.getOrCompute("llm-completion", "k", compute);
    const second = cache.getOrCompute("llm-completion", "k", compute);
    await new Promise((done) => setImmediate(done));
    release("computed");
    expect(await first).toBe("computed");
    expect(await second).toBe("computed");
    expect(calls).toBe(1);
    expect(
      await cache.getOrCompute("llm-completion", "k", () =>
        Promise.resolve("again"),
      ),
    ).toBe("computed");
    expect(calls).toBe(1);
  });

  it("reports entries, bytes per namespace and the session hit rate", async () => {
    const { cache } = await harness();
    await cache.set("summary", "a", "xx");
    await cache.set("summary", "b", "yy");
    await cache.set("report", "c", 1);
    await cache.get("summary", "a");
    await cache.get("summary", "missing");
    const stats = await cache.stats();
    expect(stats.entries).toBe(3);
    expect(stats.bytes).toBe(4 + 4 + 1);
    expect(stats.byNamespace.summary).toStrictEqual({ entries: 2, bytes: 8 });
    expect(stats.byNamespace.report).toStrictEqual({ entries: 1, bytes: 1 });
    expect(stats.byNamespace.embedding).toStrictEqual({ entries: 0, bytes: 0 });
    expect(stats.hitRate).toBe(0.5);
  });

  it("does not finish closing while a write is still in flight", async () => {
    const connection = sqlite();
    await runMigrations(connection);
    const clock = createManualClock();
    const blobs = memoryBlobs();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const cache = createSqliteCache({
      connection: () => Promise.resolve(connection),
      blobs: {
        ...blobs,
        write: async (name, text) => {
          await gate;
          await blobs.write(name, text);
        },
      },
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
      maxBytes: () => BIG,
    });
    const pending = cache.set(
      "summary",
      "big",
      "z".repeat(CACHE_BLOB_THRESHOLD_BYTES + 10),
    );
    let closed = false;
    const closing = cache.close().then(() => {
      closed = true;
    });
    await new Promise((done) => setImmediate(done));
    expect(closed).toBe(false);
    release();
    await closing;
    await pending;
    expect(closed).toBe(true);
    expect(count(connection)).toBe(1);
  });

  it("waits for operations in flight on close, and is inert afterwards", async () => {
    const { cache, connection } = await harness();
    const pending = cache.set("report", "k", 1);
    await cache.close();
    await pending;
    expect(count(connection)).toBe(1);
    await cache.set("report", "after", 2);
    expect(await cache.get("report", "k")).toBeUndefined();
    expect(count(connection)).toBe(1);
  });

  it("stores nothing and never throws when there is no database", async () => {
    const clock = createManualClock();
    const cache = createSqliteCache({
      connection: () => Promise.resolve(undefined),
      blobs: memoryBlobs(),
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
      maxBytes: () => BIG,
    });
    await cache.set("summary", "k", 1);
    expect(await cache.get("summary", "k")).toBeUndefined();
    expect(await cache.has("summary", "k")).toBe(false);
    expect(await cache.invalidateByTag("x")).toBe(0);
    expect(
      await cache.getOrCompute("summary", "k", () => Promise.resolve(7)),
    ).toBe(7);
    expect((await cache.stats()).entries).toBe(0);
    expect(await cache.prune()).toStrictEqual({
      expiredRemoved: 0,
      evictedForSize: 0,
      bytesReclaimed: 0,
    });
  });

  it("NO_CACHE misses everything and computes every time", async () => {
    await NO_CACHE.set("summary", "k", 1);
    expect(await NO_CACHE.get("summary", "k")).toBeUndefined();
    expect(
      await NO_CACHE.getOrCompute("summary", "k", () => Promise.resolve(3)),
    ).toBe(3);
    expect((await NO_CACHE.stats()).byNamespace.summary).toStrictEqual({
      entries: 0,
      bytes: 0,
    });
  });
});

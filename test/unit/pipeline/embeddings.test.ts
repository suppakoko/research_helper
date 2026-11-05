/**
 * `P5-T20`: SPECTER2 vectors, from `fetchEmbeddings` through `ensureEmbeddings` to the
 * `embedding` table, and `cosine`.
 *
 * **`batch-embedding` in `test/fixtures/semanticscholar/related/` is a stand-in until
 * `P5-T31`** (`plan/00` §6 item 335(a)): hand-written from `docs/02` §6.8 and §6.9,
 * `"synthetic": true`. The owner's run overwrites it under the same key, so what these
 * tests expect of it is computed from its own rows. Passing here proves the code reads
 * the *documented* shape and says nothing about the service until then. Every other
 * vector in this file is SYNTHETIC too.
 *
 * The store under the "Done when" lines is the shipped one over a real SQLite
 * (`node:sqlite`, as `test/unit/zotero/embeddingStore.test.ts` explains). The other
 * pass-through tests use a small double, where the order of calls is the point.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { createManualClock } from "../../../src/core/clock";
import {
  BadRequestError,
  OperationCancelledError,
  ParseError,
  SourceError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpOptions,
} from "../../../src/core/http/client";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import { SEMANTICSCHOLAR_HOST } from "../../../src/core/rateLimit/hostLimiter";
import type { SecretStore } from "../../../src/core/secretStore";
import type { ExternalIds } from "../../../src/model/ids";
import {
  cosine,
  EMBEDDING_DIMENSIONS,
  ensureEmbeddings,
  normalizeEmbedding,
  type EmbeddableWork,
  type EmbeddingVector,
  type EnsureEmbeddingsDeps,
} from "../../../src/pipeline/shared/embeddings";
import { createSemanticScholarRecordMapper } from "../../../src/sources/semanticscholar/mapper";
import {
  createSemanticScholarSource,
  SEMANTICSCHOLAR_API_KEY_HEADER,
  SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS,
  SEMANTICSCHOLAR_EMBEDDING_FIELDS,
  SEMANTICSCHOLAR_EMBEDDING_MODEL,
  SEMANTICSCHOLAR_SECRET_ID,
  SemanticScholarRateLimitError,
  toEmbeddingPaperId,
  type SemanticScholarSource,
} from "../../../src/sources/semanticscholar/semanticscholarSource";
import type { SourceCallContext } from "../../../src/sources/types";
import {
  createEmbeddingStore,
  type EmbeddingRow,
  type EmbeddingStore,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";
import { relatedFixtureDirFor } from "../../../scripts/record-fixtures";
import {
  createReplayHttpClient,
  listFixtureMeta,
  nodeFixtureIo,
  type RecordedExchange,
} from "../../contract/_transport";
import {
  createMultiHostReplayHttpClient,
  readScenarioExchange,
} from "../../support/fixtureReplay";
import {
  SEMANTICSCHOLAR_RELATED_SECOND_ID,
  SEMANTICSCHOLAR_RELATED_SEED,
} from "../../support/semanticscholarRecordedRequests";

const NOW = 1_700_000_000_000;
const DIR = relatedFixtureDirFor("semanticscholar");
const SEARCH_DIR = join(DIR, "..");
const FAKE_KEY = "fake-s2-key";
const MODEL = "specter_v2" as const;
const DIMENSIONS = EMBEDDING_DIMENSIONS[MODEL];

function ctx(): SourceCallContext {
  return { token: createCancellationTokenSource().token };
}

function secretsHolding(value: string | undefined): SecretStore {
  return {
    backend: "os-keychain",
    unattended: true,
    get: (id) =>
      Promise.resolve(id === SEMANTICSCHOLAR_SECRET_ID ? value : undefined),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: () => Promise.resolve(value !== undefined),
    listStoredIds: () => Promise.resolve([]),
    clearAll: () => Promise.resolve(0),
  };
}

function sourceOver(
  http: HttpClient,
  key: string | undefined = FAKE_KEY,
): SemanticScholarSource {
  const clock = createManualClock(NOW);
  return createSemanticScholarSource({
    http,
    clock,
    mapRecords: createSemanticScholarRecordMapper({ clock }),
    secrets: secretsHolding(key),
  });
}

interface BatchCall {
  readonly method: HttpMethod;
  readonly url: string;
  readonly options: HttpOptions | undefined;
  readonly ids: readonly string[];
}

/** A client answering each `/paper/batch` from its ids, recording every call. */
function batchClient(answer: (ids: readonly string[]) => readonly unknown[]): {
  readonly client: HttpClient;
  readonly calls: BatchCall[];
} {
  const calls: BatchCall[] = [];
  const client: HttpClient = {
    request(method, url, options) {
      const { ids } = JSON.parse(String(options?.body)) as {
        ids: readonly string[];
      };
      calls.push({ method, url, options, ids });
      return Promise.resolve({
        status: 200,
        url,
        body: JSON.stringify(answer(ids)),
        rawHeaders: "",
        header: () => undefined,
      });
    },
  };
  return { client, calls };
}

/** The shipped client, with this exchange answering every request. */
function answering(exchange: RecordedExchange) {
  const replay = createMultiHostReplayHttpClient({
    routes: [{ host: SEMANTICSCHOLAR_HOST, dirs: [DIR] }],
    io: nodeFixtureIo,
    answerFor: () => exchange,
  });
  return { ...replay, source: sourceOver(replay.client) };
}

/** A raw vector of the right length, different for each seed, far from unit length. */
function raw(seed: number, length = DIMENSIONS): number[] {
  return Array.from({ length }, (_, i) => 3 * Math.sin(seed + i + 1));
}

const row = (seed: number): unknown => ({
  paperId: `paper-${String(seed)}`,
  embedding: { model: SEMANTICSCHOLAR_EMBEDDING_MODEL, vector: raw(seed) },
});

const seedOf = (id: string): number =>
  Number(id.slice(id.lastIndexOf(".") + 1));

function work(n: number): EmbeddableWork {
  const doi = `10.1000/x.${String(n)}`;
  return { workKey: `doi:${doi}`, ids: { doi } as Partial<ExternalIds> };
}

const works = (count: number): readonly EmbeddableWork[] =>
  Array.from({ length: count }, (_, n) => work(n));

function norm(values: Float32Array): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

function sqliteConnection(): SqlConnection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const found = db.prepare(sql).get(...bind(params));
      return Promise.resolve(
        found === undefined ? false : Object.values(found)[0],
      );
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

/** The shipped store over a migrated in-memory SQLite. */
async function realStore(capBytes?: number): Promise<EmbeddingStore> {
  const connection = sqliteConnection();
  await runMigrations(connection);
  return createEmbeddingStore(
    connection,
    capBytes === undefined ? {} : { capBytes },
  );
}

/** A store double that remembers the order of its calls. */
function memoryStore(initial: Readonly<Record<string, Float32Array>> = {}) {
  const held = new Map(Object.entries(initial));
  const events: string[] = [];
  const written: EmbeddingRow[] = [];
  const predicates: ((workKey: string) => boolean)[] = [];
  const store: EnsureEmbeddingsDeps["store"] = {
    getMany(workKeys, model) {
      events.push(`get:${model}:${String(workKeys.length)}`);
      return Promise.resolve(
        new Map(
          workKeys.flatMap((key) => {
            const found = held.get(key);
            return found === undefined ? [] : [[key, found] as const];
          }),
        ),
      );
    },
    putMany(rows) {
      events.push(`put:${String(rows.length)}`);
      written.push(...rows);
      for (const r of rows) held.set(r.workKey, r.vector);
      return Promise.resolve();
    },
    evictToCap(isInLibrary) {
      events.push("evict");
      predicates.push(isInLibrary);
      return Promise.resolve({ evicted: 0, bytes: 0 });
    },
  };
  return { store, events, written, predicates };
}

function depsOver(
  source: EnsureEmbeddingsDeps["source"],
  store: EnsureEmbeddingsDeps["store"],
  overrides: Partial<EnsureEmbeddingsDeps> = {},
): EnsureEmbeddingsDeps {
  return {
    source,
    store,
    clock: createManualClock(NOW),
    isInLibrary: () => false,
    ...overrides,
  };
}

function recordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (msg: string, context?: Record<string, unknown>): void => {
      lines.push(`${level} ${msg} ${JSON.stringify(context ?? {})}`);
    };
  const logger: Logger = {
    child: () => logger,
    error: record("error"),
    warn: record("warn"),
    info: record("info"),
    debug: record("debug"),
    time: (_msg, fn) => fn(),
  };
  return { logger, lines };
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

describe("P5-T20: the batch-embedding fixture", () => {
  const rowsOf = async (): Promise<
    readonly {
      embedding: { model: string; vector: readonly number[] };
    }[]
  > =>
    JSON.parse(
      (await readScenarioExchange(DIR, "batch-embedding", nodeFixtureIo)).body,
    ) as readonly { embedding: { model: string; vector: readonly number[] } }[];

  it("names a document and its reason while it is a stand-in; P5-T31's recording clears both", async () => {
    const meta = (await listFixtureMeta(DIR)).find(
      (l) => l.meta.scenario === "batch-embedding",
    )?.meta;
    expect(meta).toBeDefined();
    if (meta?.synthetic === true) {
      expect(meta.syntheticReason).toMatch(/^Hand-written, not recorded/u);
      expect(meta.syntheticReason).toContain("docs/02 §6.9");
      expect(meta.syntheticReason).toContain("768");
    }
  });

  it("each vector is EMBEDDING_DIMENSIONS long, tagged specter_v2, and not yet unit length (docs/05 §5.2)", async () => {
    const rows = await rowsOf();
    expect(rows).toHaveLength(2);
    for (const { embedding } of rows) {
      expect(embedding.vector).toHaveLength(DIMENSIONS);
      expect(embedding.model).toBe(SEMANTICSCHOLAR_EMBEDDING_MODEL);
      expect(Math.abs(Math.hypot(...embedding.vector) - 1)).toBeGreaterThan(
        1e-3,
      );
    }
  });

  it("768 is what both documents measured, so the constant cannot drift from them", () => {
    expect(EMBEDDING_DIMENSIONS.specter_v2).toBe(768);
    const docs = join(DIR, "..", "..", "..", "..", "docs");
    expect(
      readFileSync(join(docs, "02-literature-database-apis.md"), "utf8"),
    ).toContain("Measured: **768 dimensions**");
    expect(
      readFileSync(join(docs, "05-related-work-discovery.md"), "utf8"),
    ).toContain("Measured: **768 floats**");
  });

  it("fetchEmbeddings finds it by key: the request is byte for byte the recorder's", async () => {
    const replay = createReplayHttpClient({
      dir: DIR,
      host: SEMANTICSCHOLAR_HOST,
    });
    const rows = await rowsOf();
    const ids = [
      SEMANTICSCHOLAR_RELATED_SEED,
      SEMANTICSCHOLAR_RELATED_SECOND_ID,
    ];
    const answer = await sourceOver(replay.client).fetchEmbeddings(ids, ctx());
    expect(replay.transport.calls).toHaveLength(1);
    expect(answer.withoutVector).toEqual([]);
    expect(answer.vectors.get(ids[0] as string)).toEqual(
      rows[0]?.embedding.vector,
    );
    expect(answer.vectors.get(ids[1] as string)).toEqual(
      rows[1]?.embedding.vector,
    );
  });

  it("ensureEmbeddings carries it into the real store at unit length", async () => {
    const replay = createReplayHttpClient({
      dir: DIR,
      host: SEMANTICSCHOLAR_HOST,
    });
    const store = await realStore();
    const seed: EmbeddableWork = {
      workKey: "doi:10.1038/s41586-023-06139-9",
      ids: {
        doi: SEMANTICSCHOLAR_RELATED_SEED.slice("DOI:".length),
      } as Partial<ExternalIds>,
    };
    const second: EmbeddableWork = {
      workKey: "arxiv:1706.03762",
      ids: {
        arxivId: SEMANTICSCHOLAR_RELATED_SECOND_ID.slice("ARXIV:".length),
      } as Partial<ExternalIds>,
    };
    const result = await ensureEmbeddings(
      depsOver(sourceOver(replay.client), store),
      [seed, second],
      MODEL,
      ctx(),
    );
    expect(result.batchCalls).toBe(1);
    const held = await store.getMany([seed.workKey, second.workKey], MODEL);
    expect(held.size).toBe(2);
    for (const values of held.values()) {
      expect(Math.abs(norm(values) - 1)).toBeLessThanOrEqual(1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// fetchEmbeddings
// ---------------------------------------------------------------------------

describe("P5-T20: fetchEmbeddings", () => {
  it("POSTs the ids to /paper/batch with exactly fields=embedding.specter_v2, and the key only as the header", async () => {
    const { client, calls } = batchClient((ids) => ids.map((_, i) => row(i)));
    await sourceOver(client).fetchEmbeddings(
      ["DOI:10.1000/a", "PMID:1"],
      ctx(),
    );
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(
      "https://api.semanticscholar.org/graph/v1/paper/batch?fields=embedding.specter_v2",
    );
    expect(call?.ids).toEqual(["DOI:10.1000/a", "PMID:1"]);
    expect(call?.options?.headers?.[SEMANTICSCHOLAR_API_KEY_HEADER]).toBe(
      FAKE_KEY,
    );
    expect(call?.url).not.toContain(FAKE_KEY);
    expect(call?.options?.body).not.toContain(FAKE_KEY);
  });

  it("never asks for plain embedding, which is SPECTER v1 (docs/05 §5.2)", () => {
    expect(SEMANTICSCHOLAR_EMBEDDING_FIELDS).toEqual(["embedding.specter_v2"]);
  });

  it("takes 200 ids, and refuses 201 before sending anything", async () => {
    expect(SEMANTICSCHOLAR_EMBEDDING_BATCH_IDS).toBe(200);
    const { client, calls } = batchClient((ids) => ids.map(() => null));
    const source = sourceOver(client);
    const ids = Array.from({ length: 201 }, (_, i) => `PMID:${String(i + 1)}`);
    await expect(source.fetchEmbeddings(ids, ctx())).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(calls).toHaveLength(0);
    await source.fetchEmbeddings(ids.slice(0, 200), ctx());
    expect(calls).toHaveLength(1);
  });

  it("sends nothing without a key, and says so", async () => {
    const { client, calls } = batchClient(() => []);
    const answer = await sourceOver(client, "").fetchEmbeddings(
      ["PMID:1"],
      ctx(),
    );
    expect(calls).toHaveLength(0);
    expect(answer.keyed).toBe(false);
    expect(answer.vectors.size).toBe(0);
    expect(answer.withoutVector).toEqual([]);
  });

  it("sends nothing for no ids, keyed or not", async () => {
    const { client, calls } = batchClient(() => []);
    const keyed = await sourceOver(client).fetchEmbeddings([], ctx());
    expect(keyed.keyed).toBe(true);
    expect(keyed.vectors.size).toBe(0);
    expect(keyed.withoutVector).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("matches by position, so a null row shifts nothing", async () => {
    const { client } = batchClient(() => [row(1), null, row(3)]);
    const answer = await sourceOver(client).fetchEmbeddings(
      ["PMID:1", "PMID:2", "PMID:3"],
      ctx(),
    );
    expect(answer.keyed).toBe(true);
    expect(answer.withoutVector).toEqual(["PMID:2"]);
    expect(answer.vectors.get("PMID:1")).toEqual(raw(1));
    expect(answer.vectors.get("PMID:3")).toEqual(raw(3));
    expect(answer.vectors.has("PMID:2")).toBe(false);
  });

  it.each([
    ["embedding null", { paperId: "p", embedding: null }],
    ["embedding absent", { paperId: "p" }],
    ["vector null", { embedding: { model: MODEL, vector: null } }],
    ["vector empty", { embedding: { model: MODEL, vector: [] } }],
    ["vector not an array", { embedding: { model: MODEL, vector: "1,2" } }],
    [
      "a string among the values",
      { embedding: { model: MODEL, vector: [1, "2"] } },
    ],
    [
      "a null among the values",
      { embedding: { model: MODEL, vector: [1, null] } },
    ],
    ["no model", { embedding: { vector: [1, 2] } }],
    [
      "SPECTER v1's model",
      { embedding: { model: "specter_v1", vector: [1, 2] } },
    ],
  ])("reports a row with %s as without a vector", async (_name, answerRow) => {
    const { client } = batchClient(() => [answerRow]);
    const answer = await sourceOver(client).fetchEmbeddings(["PMID:1"], ctx());
    expect(answer.withoutVector).toEqual(["PMID:1"]);
    expect(answer.vectors.size).toBe(0);
  });

  it("reports a value JSON can only read as infinite as without a vector", async () => {
    const client: HttpClient = {
      request: (_m, url) =>
        Promise.resolve({
          status: 200,
          url,
          body: '[{"embedding":{"model":"specter_v2","vector":[1,1e999]}}]',
          rawHeaders: "",
          header: () => undefined,
        }),
    };
    const answer = await sourceOver(client).fetchEmbeddings(["PMID:1"], ctx());
    expect(answer.withoutVector).toEqual(["PMID:1"]);
  });

  it.each([
    ["short", [row(1)]],
    ["long", [row(1), row(2), row(3)]],
  ])(
    "throws ParseError for an answer too %s, using none of it, because a shifted vector would be stored for good",
    async (_name, rows) => {
      const { client } = batchClient(() => rows);
      await expect(
        sourceOver(client).fetchEmbeddings(["PMID:1", "PMID:2"], ctx()),
      ).rejects.toBeInstanceOf(ParseError);
    },
  );

  it("the batch's own 400, No valid paper ids given, leaves every id without a vector", async () => {
    const { source, transport } = answering({
      status: 400,
      headers: { "content-type": "application/json" },
      body: '{"error":"No valid paper ids given"}',
    });
    const answer = await source.fetchEmbeddings(["DOI:a", "DOI:b"], ctx());
    expect(transport.calls).toHaveLength(1);
    expect(answer.keyed).toBe(true);
    expect(answer.withoutVector).toEqual(["DOI:a", "DOI:b"]);
    expect(answer.vectors.size).toBe(0);
  });

  it("any other 400 propagates, the size cap's included", async () => {
    const { source } = answering({
      status: 400,
      headers: {},
      body: '{"error":"Response would exceed maximum size"}',
    });
    await expect(
      source.fetchEmbeddings(["PMID:1"], ctx()),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("a 429 and a 5xx propagate as the existing classes", async () => {
    const limited = answering(
      await readScenarioExchange(SEARCH_DIR, "error-429", nodeFixtureIo),
    );
    await expect(
      limited.source.fetchEmbeddings(["PMID:1"], ctx()),
    ).rejects.toBeInstanceOf(SemanticScholarRateLimitError);
    const broken = answering({ status: 503, headers: {}, body: "{}" });
    await expect(
      broken.source.fetchEmbeddings(["PMID:1"], ctx()),
    ).rejects.toBeInstanceOf(UpstreamServerError);
  });

  it("an error envelope in a 200 and a body that is not an array throw", async () => {
    const enveloped = answering({
      status: 200,
      headers: {},
      body: '{"error":"boom"}',
    });
    await expect(
      enveloped.source.fetchEmbeddings(["PMID:1"], ctx()),
    ).rejects.toBeInstanceOf(SourceError);
    const objected = answering({ status: 200, headers: {}, body: "{}" });
    await expect(
      objected.source.fetchEmbeddings(["PMID:1"], ctx()),
    ).rejects.toBeInstanceOf(ParseError);
  });

  it("a cancelled token sends nothing", async () => {
    const { client, calls } = batchClient(() => []);
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    await expect(
      sourceOver(client).fetchEmbeddings(["PMID:1"], { token: tokens.token }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(calls).toHaveLength(0);
  });
});

describe("P5-T20: fetchEmbeddings, cancelled with no key", () => {
  it("throws, rather than answering that there is no key", async () => {
    const { client } = batchClient(() => []);
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    await expect(
      sourceOver(client, "").fetchEmbeddings(["PMID:1"], {
        token: tokens.token,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

describe("P5-T20: toEmbeddingPaperId", () => {
  const arxivId = "1706.03762";

  it.each(["10.48550/arxiv.1706.03762", "10.48550/arXiv.1706.03762"])(
    "sends arXiv's constructed DOI %s as ARXIV:, which /paper/batch can read",
    (doi) => {
      expect(toEmbeddingPaperId({ doi, arxivId } as Partial<ExternalIds>)).toBe(
        `ARXIV:${arxivId}`,
      );
    },
  );

  it("leaves a journal DOI as it is, with or without an arXiv id", () => {
    expect(
      toEmbeddingPaperId({ doi: "10.1000/j", arxivId } as Partial<ExternalIds>),
    ).toBe("DOI:10.1000/j");
    expect(
      toEmbeddingPaperId({
        doi: "x10.48550/arxiv.1",
        arxivId,
      } as Partial<ExternalIds>),
    ).toBe("DOI:x10.48550/arxiv.1");
  });

  it("falls back to the DOI when the arXiv id is absent or empty", () => {
    const doi = "10.48550/arxiv.1706.03762";
    expect(toEmbeddingPaperId({ doi } as Partial<ExternalIds>)).toBe(
      `DOI:${doi}`,
    );
    expect(
      toEmbeddingPaperId({ doi, arxivId: "" } as Partial<ExternalIds>),
    ).toBe(`DOI:${doi}`);
  });

  it("answers as toSemanticScholarId does otherwise", () => {
    expect(toEmbeddingPaperId({ arxivId } as Partial<ExternalIds>)).toBe(
      `ARXIV:${arxivId}`,
    );
    expect(toEmbeddingPaperId({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The "Done when" lines, on the shipped source and the shipped store
// ---------------------------------------------------------------------------

describe("P5-T20: ensureEmbeddings, Done when", () => {
  const everyVector = (ids: readonly string[]): readonly unknown[] =>
    ids.map((id) => row(seedOf(id)));

  it("450 uncached ids cost 3 batch calls of at most 200; a second run costs 0", async () => {
    const store = await realStore();
    const { client, calls } = batchClient(everyVector);
    const deps = depsOver(sourceOver(client), store);
    const input = works(450);

    const first = await ensureEmbeddings(deps, input, MODEL, ctx());
    expect(calls.map((call) => call.ids.length)).toEqual([200, 200, 50]);
    expect(new Set(calls.flatMap((call) => call.ids)).size).toBe(450);
    expect(first.batchCalls).toBe(3);
    expect(first.vectors.size).toBe(450);
    expect(first.withoutVector).toEqual([]);
    expect(first.notAsked).toEqual([]);

    const second = await ensureEmbeddings(deps, input, MODEL, ctx());
    expect(calls).toHaveLength(3);
    expect(second.batchCalls).toBe(0);
    expect(second.vectors.size).toBe(450);
    expect(second.keyed).toBe(true);
  });

  it("a stored vector has norm 1 ± 1e-6, and is tagged with its model", async () => {
    const store = await realStore();
    const { client } = batchClient(everyVector);
    const input = works(3);
    await ensureEmbeddings(
      depsOver(sourceOver(client), store),
      input,
      MODEL,
      ctx(),
    );
    const held = await store.getMany(
      input.map((w) => w.workKey),
      "specter_v2",
    );
    expect(held.size).toBe(3);
    for (const values of held.values()) {
      expect(values).toHaveLength(DIMENSIONS);
      expect(Math.abs(norm(values) - 1)).toBeLessThanOrEqual(1e-6);
    }
    expect((await store.getMany([input[0]?.workKey ?? ""], "other")).size).toBe(
      0,
    );
  });

  it("the vector stored points the way the raw vector did", async () => {
    const store = await realStore();
    const { client } = batchClient(everyVector);
    const input = work(7);
    await ensureEmbeddings(
      depsOver(sourceOver(client), store),
      [input],
      MODEL,
      ctx(),
    );
    const values = (await store.getMany([input.workKey], MODEL)).get(
      input.workKey,
    );
    const expected = raw(7);
    const length = Math.hypot(...expected);
    expected.forEach((value, i) => {
      expect(values?.[i]).toBeCloseTo(value / length, 6);
    });
  });

  it("a second run normalises nothing: it hands back the stored bytes", async () => {
    const store = await realStore();
    const { client } = batchClient(everyVector);
    const deps = depsOver(sourceOver(client), store);
    const input = [work(1)];
    const first = await ensureEmbeddings(deps, input, MODEL, ctx());
    const second = await ensureEmbeddings(deps, input, MODEL, ctx());
    expect(second.vectors.get(input[0]?.workKey ?? "")?.values).toEqual(
      first.vectors.get(input[0]?.workKey ?? "")?.values,
    );
  });

  it("over the cap, evicting after a write keeps what the library holds and drops the oldest of the rest", async () => {
    // Room for two vectors.
    const store = await realStore(2 * DIMENSIONS * 4);
    const { client } = batchClient(everyVector);
    const clock = createManualClock(NOW);
    const deps = depsOver(sourceOver(client), store, {
      clock,
      isInLibrary: (key) => key === work(1).workKey,
    });
    await ensureEmbeddings(deps, [work(1)], MODEL, ctx());
    clock.advance(1000);
    await ensureEmbeddings(deps, [work(2)], MODEL, ctx());
    clock.advance(1000);
    await ensureEmbeddings(deps, [work(3)], MODEL, ctx());
    const held = await store.getMany(
      [work(1), work(2), work(3)].map((w) => w.workKey),
      MODEL,
    );
    expect([...held.keys()].sort()).toEqual(
      [work(1).workKey, work(3).workKey].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// ensureEmbeddings, on doubles
// ---------------------------------------------------------------------------

describe("P5-T20: ensureEmbeddings", () => {
  const answeringAll: Pick<SemanticScholarSource, "fetchEmbeddings"> = {
    fetchEmbeddings: (ids) =>
      Promise.resolve({
        keyed: true,
        vectors: new Map(ids.map((id) => [id, raw(seedOf(id))])),
        withoutVector: [],
      }),
  };

  it("reads the store first, by getMany and under the model, then writes and evicts after each batch", async () => {
    const memory = memoryStore();
    await ensureEmbeddings(
      depsOver(answeringAll, memory.store),
      works(201),
      MODEL,
      ctx(),
    );
    expect(memory.events).toEqual([
      "get:specter_v2:201",
      "put:200",
      "evict",
      "put:1",
      "evict",
    ]);
  });

  it("gives evictToCap the caller's predicate, and tags each row with its model and the time", async () => {
    const memory = memoryStore();
    const isInLibrary = (key: string): boolean => key === "x";
    await ensureEmbeddings(
      depsOver(answeringAll, memory.store, { isInLibrary }),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(memory.predicates).toEqual([isInLibrary]);
    expect(memory.written).toHaveLength(1);
    expect(memory.written[0]?.model).toBe(MODEL);
    expect(memory.written[0]?.workKey).toBe(work(1).workKey);
    expect(memory.written[0]?.createdAtEpochMs).toBe(NOW);
  });

  it("asks only for what the store lacks, and returns both together as unit vectors of the model", async () => {
    const storedValues = normalizeEmbedding(raw(1)) as Float32Array;
    const memory = memoryStore({ [work(1).workKey]: storedValues });
    const asked: string[] = [];
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids, c) => {
            asked.push(...ids);
            return answeringAll.fetchEmbeddings(ids, c);
          },
        },
        memory.store,
      ),
      [work(1), work(2)],
      MODEL,
      ctx(),
    );
    expect(asked).toEqual(["DOI:10.1000/x.2"]);
    expect(result.model).toBe(MODEL);
    expect(result.vectors.get(work(1).workKey)).toEqual({
      model: MODEL,
      values: storedValues,
    });
    expect(result.vectors.get(work(2).workKey)?.model).toBe(MODEL);
    expect(memory.written.map((r) => r.workKey)).toEqual([work(2).workKey]);
  });

  it("asks nothing and writes nothing when the store holds them all", async () => {
    const memory = memoryStore({
      [work(1).workKey]: normalizeEmbedding(raw(1)) as Float32Array,
    });
    let asked = 0;
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids, c) => {
            asked += 1;
            return answeringAll.fetchEmbeddings(ids, c);
          },
        },
        memory.store,
      ),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(asked).toBe(0);
    expect(memory.events).toEqual(["get:specter_v2:1"]);
    expect(result.batchCalls).toBe(0);
  });

  it("fetches again a stored row of the wrong length, and replaces it", async () => {
    const memory = memoryStore({ [work(1).workKey]: new Float32Array(3) });
    const result = await ensureEmbeddings(
      depsOver(answeringAll, memory.store),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(result.batchCalls).toBe(1);
    expect(result.vectors.get(work(1).workKey)?.values).toHaveLength(
      DIMENSIONS,
    );
    expect(memory.written).toHaveLength(1);
  });

  it("reports the papers with no vector, never asks about one alone, and asks again on the next run only for those", async () => {
    const store = memoryStore();
    const sent: (readonly string[])[] = [];
    const source: EnsureEmbeddingsDeps["source"] = {
      fetchEmbeddings: (ids) => {
        sent.push(ids);
        return Promise.resolve({
          keyed: true,
          vectors: new Map(
            ids
              .filter((id) => seedOf(id) !== 1)
              .map((id) => [id, raw(seedOf(id))]),
          ),
          withoutVector: ids.filter((id) => seedOf(id) === 1),
        });
      },
    };
    const first = await ensureEmbeddings(
      depsOver(source, store.store),
      works(3),
      MODEL,
      ctx(),
    );
    expect(sent).toHaveLength(1);
    expect(first.withoutVector).toEqual([work(1).workKey]);
    expect(first.vectors.size).toBe(2);
    expect(first.batchCalls).toBe(1);
    expect(store.written.map((r) => r.workKey)).toEqual([
      work(0).workKey,
      work(2).workKey,
    ]);

    const second = await ensureEmbeddings(
      depsOver(source, store.store),
      works(3),
      MODEL,
      ctx(),
    );
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(["DOI:10.1000/x.1"]);
    expect(second.withoutVector).toEqual([work(1).workKey]);
    expect(second.vectors.size).toBe(2);
  });

  it.each([
    ["all zeros", new Array<number>(DIMENSIONS).fill(0)],
    ["the wrong length", raw(1, DIMENSIONS - 1)],
    ["a length of one", raw(1, 1)],
  ])(
    "treats a vector of %s as no vector, and stores nothing",
    async (_n, vector) => {
      const memory = memoryStore();
      const { logger, lines } = recordingLogger();
      const result = await ensureEmbeddings(
        depsOver(
          {
            fetchEmbeddings: (ids) =>
              Promise.resolve({
                keyed: true,
                vectors: new Map(ids.map((id) => [id, vector])),
                withoutVector: [],
              }),
          },
          memory.store,
          { logger },
        ),
        [work(1)],
        MODEL,
        ctx(),
      );
      expect(result.withoutVector).toEqual([work(1).workKey]);
      expect(result.vectors.size).toBe(0);
      expect(memory.events).toEqual(["get:specter_v2:1"]);
      expect(lines).toEqual([
        `warn embeddings: vectors that could not be used {"refused":1,"expectedLength":${String(DIMENSIONS)}}`,
      ]);
    },
  );

  it("a paper the service answered with no vector is not called a refused one", async () => {
    const { logger, lines } = recordingLogger();
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids) =>
            Promise.resolve({
              keyed: true,
              vectors: new Map(),
              withoutVector: [...ids],
            }),
        },
        memoryStore().store,
        { logger },
      ),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(result.withoutVector).toEqual([work(1).workKey]);
    expect(lines).toEqual([]);
  });

  it("a work with nothing to ask by is reported, and costs no request", async () => {
    const memory = memoryStore();
    let asked = 0;
    const hashed: EmbeddableWork = { workKey: "hash:abc", ids: {} };
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids, c) => {
            asked += 1;
            return answeringAll.fetchEmbeddings(ids, c);
          },
        },
        memory.store,
      ),
      [hashed],
      MODEL,
      ctx(),
    );
    expect(asked).toBe(0);
    expect(result.withoutIdentifier).toEqual(["hash:abc"]);
    expect(result.withoutVector).toEqual([]);
    expect(result.notAsked).toEqual([]);
    expect(result.batchCalls).toBe(0);
    expect(result.keyed).toBe(true);
  });

  it("a stored hash-keyed work needs no identifier", async () => {
    const values = normalizeEmbedding(raw(1)) as Float32Array;
    const memory = memoryStore({ "hash:abc": values });
    const result = await ensureEmbeddings(
      depsOver(answeringAll, memory.store),
      [{ workKey: "hash:abc", ids: {} }],
      MODEL,
      ctx(),
    );
    expect(result.vectors.get("hash:abc")?.values).toBe(values);
    expect(result.withoutIdentifier).toEqual([]);
  });

  it("a repeated work key counts once", async () => {
    const memory = memoryStore();
    const asked: string[] = [];
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids, c) => {
            asked.push(...ids);
            return answeringAll.fetchEmbeddings(ids, c);
          },
        },
        memory.store,
      ),
      [work(1), work(1)],
      MODEL,
      ctx(),
    );
    expect(asked).toEqual(["DOI:10.1000/x.1"]);
    expect(memory.events[0]).toBe("get:specter_v2:1");
    expect(memory.written).toHaveLength(1);
    expect(result.vectors.size).toBe(1);
  });

  it("two works that resolve to one id are asked about once and stored under both keys", async () => {
    const memory = memoryStore();
    const asked: string[] = [];
    const twin: EmbeddableWork = {
      workKey: "other-key",
      ids: work(1).ids,
    };
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids, c) => {
            asked.push(...ids);
            return answeringAll.fetchEmbeddings(ids, c);
          },
        },
        memory.store,
      ),
      [work(1), twin],
      MODEL,
      ctx(),
    );
    expect(asked).toEqual(["DOI:10.1000/x.1"]);
    expect(memory.written.map((r) => r.workKey)).toEqual([
      work(1).workKey,
      "other-key",
    ]);
    expect(result.vectors.has("other-key")).toBe(true);
  });

  it("an empty list sends nothing and answers empty", async () => {
    const memory = memoryStore();
    const result = await ensureEmbeddings(
      depsOver(answeringAll, memory.store),
      [],
      MODEL,
      ctx(),
    );
    expect(result.batchCalls).toBe(0);
    expect(result.vectors.size).toBe(0);
    expect("failure" in result).toBe(false);
  });

  it("no key: nothing is sent or stored, stored vectors still come back, the rest are not asked", async () => {
    const { client, calls } = batchClient(() => []);
    const values = normalizeEmbedding(raw(1)) as Float32Array;
    const memory = memoryStore({ [work(1).workKey]: values });
    const result = await ensureEmbeddings(
      depsOver(sourceOver(client, ""), memory.store),
      [work(1), work(2), work(3)],
      MODEL,
      ctx(),
    );
    expect(calls).toHaveLength(0);
    expect(result.keyed).toBe(false);
    expect(result.batchCalls).toBe(0);
    expect(result.vectors.get(work(1).workKey)?.values).toBe(values);
    expect(result.notAsked).toEqual([work(2).workKey, work(3).workKey]);
    expect(memory.written).toHaveLength(0);
  });

  it("no key is learned once: one look at the store of keys, not one per batch", async () => {
    let looked = 0;
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: () => {
            looked += 1;
            return Promise.resolve({
              keyed: false,
              vectors: new Map(),
              withoutVector: [],
            });
          },
        },
        memoryStore().store,
      ),
      works(450),
      MODEL,
      ctx(),
    );
    expect(looked).toBe(1);
    expect(result.notAsked).toHaveLength(450);
  });

  it("a failed batch stops the rest, keeps what arrived, and is reported rather than thrown (docs/05 §9.1 item 4)", async () => {
    const memory = memoryStore();
    const failure = new UpstreamServerError(503, "down");
    let asked = 0;
    const { logger, lines } = recordingLogger();
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: (ids, c) => {
            asked += 1;
            return asked === 2
              ? Promise.reject(failure)
              : answeringAll.fetchEmbeddings(ids, c);
          },
        },
        memory.store,
        { logger },
      ),
      works(450),
      MODEL,
      ctx(),
    );
    expect(asked).toBe(2);
    expect(result.failure).toBe(failure);
    expect(result.vectors.size).toBe(200);
    expect(result.batchCalls).toBe(1);
    expect(result.notAsked).toHaveLength(250);
    expect(result.notAsked[0]).toBe(work(200).workKey);
    expect(memory.written).toHaveLength(200);
    expect(lines.some((line) => line.startsWith("warn "))).toBe(true);
    expect(lines.join("\n")).toContain(failure.messageKey);
  });

  it("a cancel during a batch propagates, and what arrived before it stays stored", async () => {
    const memory = memoryStore();
    const tokens = createCancellationTokenSource();
    let asked = 0;
    await expect(
      ensureEmbeddings(
        depsOver(
          {
            fetchEmbeddings: (ids, c) => {
              asked += 1;
              if (asked === 2) {
                return Promise.reject(
                  new OperationCancelledError({ kind: "user" }),
                );
              }
              return answeringAll.fetchEmbeddings(ids, c);
            },
          },
          memory.store,
        ),
        works(450),
        MODEL,
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(asked).toBe(2);
    expect(memory.written).toHaveLength(200);
  });

  it("a cancel between batches stops before the next one", async () => {
    const memory = memoryStore();
    const tokens = createCancellationTokenSource();
    let asked = 0;
    await expect(
      ensureEmbeddings(
        depsOver(
          {
            fetchEmbeddings: (ids, c) => {
              asked += 1;
              tokens.cancel({ kind: "user" });
              return answeringAll.fetchEmbeddings(ids, c);
            },
          },
          memory.store,
        ),
        works(450),
        MODEL,
        { token: tokens.token },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(asked).toBe(1);
    expect(memory.written).toHaveLength(200);
  });

  it("cancelled before it starts, it does not even read the store", async () => {
    const memory = memoryStore();
    const tokens = createCancellationTokenSource();
    tokens.cancel({ kind: "user" });
    await expect(
      ensureEmbeddings(depsOver(answeringAll, memory.store), works(1), MODEL, {
        token: tokens.token,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(memory.events).toEqual([]);
  });

  it("a programming error is not swallowed as a failed batch", async () => {
    await expect(
      ensureEmbeddings(
        depsOver(
          { fetchEmbeddings: () => Promise.reject(new RangeError("bug")) },
          memoryStore().store,
        ),
        works(1),
        MODEL,
        ctx(),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("a store that cannot read only warns, and the fetch goes ahead", async () => {
    const memory = memoryStore();
    const { logger, lines } = recordingLogger();
    const result = await ensureEmbeddings(
      depsOver(
        answeringAll,
        {
          ...memory.store,
          getMany: () => Promise.reject(new Error("locked")),
        },
        { logger },
      ),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(result.vectors.size).toBe(1);
    expect("failure" in result).toBe(false);
    expect(lines.filter((line) => line.startsWith("warn "))).toHaveLength(1);
  });

  it.each(["putMany", "evictToCap"] as const)(
    "a store whose %s fails only warns, and the vectors still come back for every batch",
    async (member) => {
      const memory = memoryStore();
      const { logger, lines } = recordingLogger();
      const result = await ensureEmbeddings(
        depsOver(
          answeringAll,
          {
            ...memory.store,
            [member]: () => Promise.reject(new Error("full")),
          },
          { logger },
        ),
        works(201),
        MODEL,
        ctx(),
      );
      expect(result.vectors.size).toBe(201);
      expect(result.batchCalls).toBe(2);
      expect("failure" in result).toBe(false);
      expect(lines.filter((line) => line.startsWith("warn "))).toHaveLength(2);
    },
  );

  it("a failing store says so when no logger is given, by not throwing", async () => {
    const memory = memoryStore();
    const result = await ensureEmbeddings(
      depsOver(answeringAll, {
        ...memory.store,
        getMany: () => Promise.reject(new Error("locked")),
        putMany: () => Promise.reject(new Error("full")),
      }),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(result.vectors.size).toBe(1);
  });

  it("a failed batch needs no logger either", async () => {
    const result = await ensureEmbeddings(
      depsOver(
        {
          fetchEmbeddings: () =>
            Promise.reject(new UpstreamServerError(503, "down")),
        },
        memoryStore().store,
      ),
      [work(1)],
      MODEL,
      ctx(),
    );
    expect(result.failure).toBeInstanceOf(UpstreamServerError);
    expect(result.notAsked).toEqual([work(1).workKey]);
  });

  it("no log line carries a vector or a key", async () => {
    const memory = memoryStore();
    const { logger, lines } = recordingLogger();
    const { client } = batchClient((ids) => ids.map((id) => row(seedOf(id))));
    await ensureEmbeddings(
      depsOver(
        sourceOver(client),
        {
          ...memory.store,
          putMany: () => Promise.reject(new Error("full")),
        },
        { logger },
      ),
      works(2),
      MODEL,
      ctx(),
    );
    const text = lines.join("\n");
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain(String(raw(0)[0]));
  });
});

// ---------------------------------------------------------------------------
// normalizeEmbedding and cosine
// ---------------------------------------------------------------------------

describe("P5-T20: normalizeEmbedding", () => {
  it("scales to unit length, and keeps the direction", () => {
    const values = normalizeEmbedding([3, 4]) as Float32Array;
    expect(values).toBeInstanceOf(Float32Array);
    expect(values[0]).toBeCloseTo(0.6, 6);
    expect(values[1]).toBeCloseTo(0.8, 6);
  });

  it("is within 1e-6 of unit length at 768 values", () => {
    expect(
      Math.abs(norm(normalizeEmbedding(raw(5)) as Float32Array) - 1),
    ).toBeLessThanOrEqual(1e-6);
  });

  it("scales in double precision first, so values too large for a Float32 still work", () => {
    const values = normalizeEmbedding([3e60, 4e60]) as Float32Array;
    expect(values[0]).toBeCloseTo(0.6, 6);
    expect(values[1]).toBeCloseTo(0.8, 6);
  });

  it.each([
    ["all zeros", [0, 0, 0]],
    ["empty", []],
    ["a sum of squares that overflows", [1e200, 1e200]],
    ["an infinite value", [1, Infinity]],
    ["a NaN", [1, NaN]],
  ])("refuses %s", (_name, values) => {
    expect(normalizeEmbedding(values)).toBeUndefined();
  });
});

describe("P5-T20: cosine", () => {
  const unit = (...values: number[]): EmbeddingVector => ({
    model: MODEL,
    values: normalizeEmbedding(values) as Float32Array,
  });

  it("throws on mixed models, whatever the values", () => {
    const other: EmbeddingVector = {
      model: "text-embedding-3-small@768",
      values: unit(1, 0).values,
    };
    expect(() => cosine(unit(1, 0), other)).toThrow(RangeError);
    expect(() => cosine(other, unit(1, 0))).toThrow(/two models/u);
  });

  it("throws on two lengths", () => {
    expect(() => cosine(unit(1, 0), unit(1, 0, 0))).toThrow(RangeError);
    expect(() => cosine(unit(1, 0), unit(1, 0, 0))).toThrow(/two lengths/u);
  });

  it("is the dot product of unit vectors", () => {
    expect(cosine(unit(1, 0), unit(1, 0))).toBeCloseTo(1, 6);
    expect(cosine(unit(1, 0), unit(0, 1))).toBe(0);
    expect(cosine(unit(1, 0), unit(-1, 0))).toBeCloseTo(-1, 6);
    expect(cosine(unit(3, 4), unit(4, 3))).toBeCloseTo(0.96, 5);
  });

  it("clamps rounding that passes either end, so a rescale stays in [0, 1]", () => {
    const over: EmbeddingVector = {
      model: MODEL,
      values: new Float32Array([1.0000001]),
    };
    const under: EmbeddingVector = {
      model: MODEL,
      values: new Float32Array([-1.0000001]),
    };
    expect(cosine(over, over)).toBe(1);
    expect(cosine(over, under)).toBe(-1);
  });

  it("does not depend on the order of its arguments", () => {
    expect(cosine(unit(1, 2, 3), unit(3, 2, 1))).toBe(
      cosine(unit(3, 2, 1), unit(1, 2, 3)),
    );
  });
});

/**
 * `P5-T03` — the three stores Phase 5 reads, at layer 1: the `embedding` table
 * with its cap, the `collection_profile` table with its centroid blob, and the
 * `recommendation` table with its rejections (`docs/07` §5.2, §8.3, §9.2).
 *
 * Plain Node (`docs/13` §2.1): no Zotero, no network. The stores run against a
 * real SQLite (`node:sqlite`, as `test/unit/core/provenanceRerun.test.ts`
 * explains) migrated by the shipped `runMigrations`, so the upserts, the order
 * and the bytes are SQLite's rather than a double's.
 * `test/integration/zotero/recommendStores.spec.ts` repeats the round trips
 * inside Zotero, where a `BLOB` reads back differently. Every value is SYNTHETIC.
 */

import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createScope } from "../../../src/bootstrap/container";
import { runMigrations } from "../../../src/bootstrap/migrations";
import { installPluginDatabase } from "../../../src/bootstrap/pluginDatabase";
import { createManualClock } from "../../../src/core/clock";
import { StorageError } from "../../../src/core/errors";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { CollectionProfile } from "../../../src/model/profile";
import type { Recommendation } from "../../../src/model/recommendation";
import {
  collectionProfileId,
  COLLECTION_PROFILE_VERBATIM_KEYS,
  createCollectionProfileStore,
  createEmbeddingStore,
  createRecommendationStore,
  EMBEDDING_CAP_BYTES,
  EMBEDDING_IN_LIST_MAX,
  gateCollectionProfile,
  gateRecommendation,
  RECOMMENDATION_VERBATIM_KEYS,
  recommendationId,
  type CollectionProfileStore,
  type EmbeddingRow,
  type EmbeddingStore,
  type RecommendationStore,
  type SqlConnection,
  type SqlParam,
  type SqlQueryOptions,
} from "../../../src/zotero/db";

// ---------------------------------------------------------------------------
// A real SQLite behind the port
// ---------------------------------------------------------------------------

interface Connection extends SqlConnection {
  readonly db: DatabaseSync;
  /** Every statement and its options, in order. */
  readonly statements: { sql: string; options?: SqlQueryOptions }[];
}

function sqlite(): Connection {
  const db = new DatabaseSync(":memory:");
  const statements: Connection["statements"] = [];
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
    statements,
    queryAsync(sql, params, options) {
      statements.push({ sql, ...(options !== undefined && { options }) });
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params, options) {
      statements.push({ sql, ...(options !== undefined && { options }) });
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

async function migrated(): Promise<Connection> {
  const connection = sqlite();
  await runMigrations(connection);
  return connection;
}

function count(connection: Connection, table: string): number {
  const row = connection.db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as { n: number };
  return row.n;
}

const HEX_40 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const HEX_64 = `${HEX_40}${"0123456789abcdef01234567"}`;
const HASH_KEY = `hash:${HEX_40}`;
const PLANTED = `sk-ant-${"x".repeat(30)}`;

// ---------------------------------------------------------------------------
// 1. The embedding store
// ---------------------------------------------------------------------------

function vector(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

function row(
  workKey: string,
  createdAtEpochMs: number,
  values: readonly number[] = [0.25, -0.5],
  model = "specter_v2",
): EmbeddingRow {
  return {
    workKey,
    model,
    vector: Float32Array.from(values),
    createdAtEpochMs,
  };
}

function keysLeft(connection: Connection): string[] {
  return connection.db
    .prepare("SELECT work_key FROM embedding ORDER BY work_key")
    .all()
    .map((r) => (r as { work_key: string }).work_key);
}

describe("P5-T03 — createEmbeddingStore's Float32Array and BLOB", () => {
  it("writes each vector's own bytes, dim and created_at, and reads them back byte-exact", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    const values = vector(0.1, -2.5, 1e-7);
    await store.putMany([
      {
        workKey: "doi:10.1/a",
        model: "specter_v2",
        vector: values,
        createdAtEpochMs: 5,
      },
    ]);
    const stored = connection.db
      .prepare("SELECT dim, vector, created_at FROM embedding")
      .get() as { dim: number; vector: Uint8Array; created_at: number };
    expect(stored.dim).toBe(3);
    expect(stored.created_at).toBe(5);
    expect([...stored.vector]).toStrictEqual([
      ...new Uint8Array(values.buffer),
    ]);
    const read = await store.getMany(["doi:10.1/a"], "specter_v2");
    expect(read.get("doi:10.1/a")).toStrictEqual(values);
  });

  it("stores only the viewed part of a vector that shares a buffer", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    const shared = vector(9, 1, 2, 9);
    await store.putMany([
      {
        workKey: "k",
        model: "m",
        vector: shared.subarray(1, 3),
        createdAtEpochMs: 1,
      },
    ]);
    expect((await store.allForModel("m")).get("k")).toStrictEqual(vector(1, 2));
  });

  it("reads a blob back whichever way the platform hands it: an array of numbers, or a Uint8Array at an odd offset", async () => {
    const floats = vector(1.5, -0.25);
    const bytes = [...new Uint8Array(floats.buffer)];
    const odd = new Uint8Array(bytes.length + 1);
    odd.set(bytes, 1);
    for (const blob of [bytes, odd.subarray(1)]) {
      const connection = await migrated();
      const faked: SqlConnection = {
        ...connection,
        queryAsync: () =>
          Promise.resolve([{ work_key: "k", dim: 2, vector: blob }]),
      };
      expect(
        (await createEmbeddingStore(faked).allForModel("m")).get("k"),
      ).toStrictEqual(floats);
    }
  });

  it("replaces a row with the same work and model, and keeps two models apart", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    await store.putMany([
      row("k", 1, [1, 1]),
      row("k", 1, [2, 2, 2], "other-model"),
    ]);
    await store.putMany([row("k", 9, [3, 3, 3, 3])]);
    expect(count(connection, "embedding")).toBe(2);
    expect((await store.allForModel("specter_v2")).get("k")).toStrictEqual(
      vector(3, 3, 3, 3),
    );
    expect((await store.getMany(["k"], "other-model")).get("k")).toStrictEqual(
      vector(2, 2, 2),
    );
    expect(await store.getMany(["k"], "no-such-model")).toStrictEqual(
      new Map(),
    );
    expect([...(await store.allForModel("other-model")).keys()]).toStrictEqual([
      "k",
    ]);
  });

  it("answers only the keys asked for, in lists Zotero's 999 bound parameters can take, uncached", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    const keys = Array.from(
      { length: EMBEDDING_IN_LIST_MAX + 3 },
      (_, i) => `k${String(i)}`,
    );
    await store.putMany([
      row("k0", 1),
      row(`k${String(EMBEDDING_IN_LIST_MAX + 2)}`, 1),
      row("not-asked", 1),
    ]);
    connection.statements.length = 0;
    const found = await store.getMany(keys, "specter_v2");
    expect([...found.keys()].sort()).toStrictEqual(
      ["k0", `k${String(EMBEDDING_IN_LIST_MAX + 2)}`].sort(),
    );
    expect(connection.statements).toHaveLength(2);
    expect(EMBEDDING_IN_LIST_MAX + 1).toBeLessThanOrEqual(999);
    for (const statement of connection.statements) {
      expect(statement.options).toStrictEqual({
        debugParams: false,
        noCache: true,
      });
    }
    connection.statements.length = 0;
    expect(await store.getMany([], "specter_v2")).toStrictEqual(new Map());
    expect(connection.statements).toHaveLength(0);
  });

  it("refuses a whole batch, writing nothing, for one bad row", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    for (const bad of [
      row("", 1),
      row("k", 1, [1], ""),
      row("k", 1, []),
      row("k", 1, [1, Number.NaN]),
      row("k", 1, [Number.POSITIVE_INFINITY]),
      row("k", Number.NaN),
    ]) {
      await expect(store.putMany([row("good", 1), bad])).rejects.toThrow(
        RangeError,
      );
    }
    expect(count(connection, "embedding")).toBe(0);
  });

  it("rolls the whole batch back when one write fails", async () => {
    const connection = await migrated();
    const failing: SqlConnection = {
      ...connection,
      queryAsync: (sql, params, options) =>
        params?.[0] === "boom"
          ? Promise.reject(new Error("disk full"))
          : connection.queryAsync(sql, params, options),
    };
    await expect(
      createEmbeddingStore(failing).putMany([row("good", 1), row("boom", 1)]),
    ).rejects.toThrow("disk full");
    expect(count(connection, "embedding")).toBe(0);
  });

  it("reads a row whose blob is not dim × 4 bytes as absent", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    await store.putMany([row("good", 1), row("bad", 1), row("zero", 1)]);
    connection.db.exec("UPDATE embedding SET dim = 3 WHERE work_key = 'bad'");
    connection.db.exec("UPDATE embedding SET dim = 0 WHERE work_key = 'zero'");
    expect([...(await store.allForModel("specter_v2")).keys()]).toStrictEqual([
      "good",
    ]);
    expect(await store.getMany(["bad", "zero"], "specter_v2")).toStrictEqual(
      new Map(),
    );
  });

  it("binds every statement with debugParams off, so no vector reaches Zotero's debug log", async () => {
    const connection = await migrated();
    const store = createEmbeddingStore(connection, { capBytes: 0 });
    connection.statements.length = 0;
    await store.putMany([row("k", 1)]);
    await store.allForModel("specter_v2");
    await store.evictToCap(() => false);
    for (const statement of connection.statements) {
      expect(statement.options?.debugParams).toBe(false);
    }
    expect(connection.statements.length).toBeGreaterThanOrEqual(5);
  });
});

describe("P5-T03 — the embedding table's cap (docs/07 §9.2's note of 2026-11-02)", () => {
  /** Two floats a vector: 8 bytes, `dim × 4`. */
  const small = (
    capBytes: number,
    connection: Connection,
  ): ReturnType<typeof createEmbeddingStore> =>
    createEmbeddingStore(connection, { capBytes });

  it("is docs/07 §9.2's 100 MB by default, the cache's unit", async () => {
    expect(EMBEDDING_CAP_BYTES).toBe(100 * 1024 * 1024);
    // 34 133 vectors of 768 dimensions fit and one more does not.
    expect(Math.floor(EMBEDDING_CAP_BYTES / (768 * 4))).toBe(34133);
    const connection = await migrated();
    const store = createEmbeddingStore(connection);
    await store.putMany([row("k", 1)]);
    expect(await store.evictToCap(() => false)).toStrictEqual({
      evicted: 0,
      bytes: 8,
    });
  });

  it("at or under the cap deletes nothing and asks nothing", async () => {
    const connection = await migrated();
    const store = small(16, connection);
    await store.putMany([row("a", 1), row("b", 2)]);
    expect(
      await store.evictToCap(() => {
        throw new Error("the predicate is not needed");
      }),
    ).toStrictEqual({ evicted: 0, bytes: 16 });
    expect(keysLeft(connection)).toStrictEqual(["a", "b"]);
  });

  it("on an empty table reports nothing", async () => {
    const connection = await migrated();
    expect(await small(0, connection).evictToCap(() => false)).toStrictEqual({
      evicted: 0,
      bytes: 0,
    });
  });

  it("evicts the oldest not-in-library vectors first, not older in-library ones", async () => {
    const connection = await migrated();
    const store = small(24, connection);
    await store.putMany([
      row("lib-oldest", 1),
      row("out-new", 30),
      row("out-old", 20),
      row("lib-new", 40),
      row("out-newest", 50),
    ]);
    const library = new Set(["lib-oldest", "lib-new"]);
    const outcome = await store.evictToCap((key) => library.has(key));
    expect(outcome).toStrictEqual({ evicted: 2, bytes: 24 });
    expect(keysLeft(connection)).toStrictEqual([
      "lib-new",
      "lib-oldest",
      "out-newest",
    ]);
  });

  it("then, if still over, evicts the oldest of the rest", async () => {
    const connection = await migrated();
    const store = small(8, connection);
    await store.putMany([
      row("lib-b", 20),
      row("lib-a", 10),
      row("out", 30),
      row("lib-c", 40),
    ]);
    const outcome = await store.evictToCap((key) => key.startsWith("lib"));
    expect(outcome).toStrictEqual({ evicted: 3, bytes: 8 });
    expect(keysLeft(connection)).toStrictEqual(["lib-c"]);
  });

  it("stops exactly at the cap, counts dim × 4 across models, and breaks a tie by insertion", async () => {
    const connection = await migrated();
    const store = small(16, connection);
    await store.putMany([
      row("first", 5, [1, 2, 3, 4]), // 16 bytes
      row("second", 5, [1, 2], "other-model"), // 8 bytes
      row("third", 5, [1, 2]), // 8 bytes
    ]);
    expect(await store.evictToCap(() => false)).toStrictEqual({
      evicted: 1,
      bytes: 16,
    });
    expect(keysLeft(connection)).toStrictEqual(["second", "third"]);
  });

  it("reads no vector while it decides", async () => {
    const connection = await migrated();
    const store = small(0, connection);
    await store.putMany([row("k", 1)]);
    connection.statements.length = 0;
    await store.evictToCap(() => false);
    const scan = connection.statements.find((s) =>
      s.sql.includes("ORDER BY created_at"),
    );
    expect(scan?.sql).not.toContain("vector");
  });

  it("deletes one model's vector and keeps the same work's under another model", async () => {
    const connection = await migrated();
    const store = small(8, connection);
    await store.putMany([
      row("k", 1),
      row("k", 2, [0.25, -0.5], "other-model"),
    ]);
    await store.evictToCap(() => false);
    expect(await store.getMany(["k"], "specter_v2")).toStrictEqual(new Map());
    expect((await store.getMany(["k"], "other-model")).size).toBe(1);
  });

  it("treats a vector written again as new", async () => {
    const connection = await migrated();
    const store = small(8, connection);
    await store.putMany([row("a", 1), row("b", 2)]);
    await store.putMany([row("a", 3)]);
    await store.evictToCap(() => false);
    expect(keysLeft(connection)).toStrictEqual(["a"]);
  });

  it("deletes all or nothing", async () => {
    const connection = await migrated();
    const failing: SqlConnection = {
      ...connection,
      queryAsync: (sql, params, options) =>
        sql.startsWith("DELETE") && params?.[0] === "b"
          ? Promise.reject(new Error("disk full"))
          : connection.queryAsync(sql, params, options),
    };
    const store = createEmbeddingStore(failing, { capBytes: 0 });
    await store.putMany([row("a", 1), row("b", 2)]);
    await expect(store.evictToCap(() => false)).rejects.toThrow("disk full");
    expect(keysLeft(connection)).toStrictEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// 2. The collection profile store
// ---------------------------------------------------------------------------

function profile(
  overrides: Partial<CollectionProfile> = {},
): CollectionProfile {
  return {
    id: "1:ABCD2345",
    libraryID: 1,
    collectionKey: "ABCD2345",
    collectionName: "Base editing",
    builtAtEpochMs: 1000,
    itemCount: 2,
    membershipHash: HEX_64,
    termWeights: { "base editing": 0.5, token: 0.25 },
    subjectCounts: { "CRISPR-Cas Systems": 2, secret: 1 },
    topAuthors: [{ name: "A. Author", count: 2 }],
    topVenues: [{ name: "Nature", count: 2, issn: ["0028-0836"] }],
    yearHistogram: { 2024: 2 },
    medianYear: 2024,
    centroids: [],
    seeds: [
      {
        ids: {
          url: `https://www.semanticscholar.org/paper/${HEX_40}`,
        },
      },
    ],
    suggestedQueries: ["base editing"],
    origin: "heuristic",
    profileCallOutputTokens: 1200,
    knownWorkKeys: [HASH_KEY, "doi:10.1000/xyz"],
    ...overrides,
  };
}

function rawProfile(connection: Connection): Record<string, unknown> {
  return {
    ...(connection.db
      .prepare("SELECT * FROM collection_profile")
      .get() as Record<string, unknown>),
  };
}

describe("P5-T03 — createCollectionProfileStore", () => {
  it("round-trips k = 2 centroids through one row-major blob, sliced by centroid_count", async () => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    const centroids = [
      [0.5, -0.25, 2],
      [1, 0, -1],
    ];
    const written = await store.put(
      profile({ centroids, embeddingModel: "specter_v2", embeddingDim: 3 }),
    );
    expect(written.centroids).toStrictEqual(centroids);
    const raw = rawProfile(connection);
    expect(raw["centroid_count"]).toBe(2);
    expect([...(raw["centroids"] as Uint8Array)]).toStrictEqual([
      ...new Uint8Array(Float32Array.from(centroids.flat()).buffer),
    ]);
    expect(raw["library_id"]).toBe(1);
    expect(raw["collection_key"]).toBe("ABCD2345");
    expect(raw["membership_hash"]).toBe(HEX_64);
    expect(raw["built_at"]).toBe(1000);
    expect(await store.get("1:ABCD2345")).toStrictEqual(written);
  });

  it("holds the centroids in the blob only, and returns them as the Float32 values stored", async () => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    const written = await store.put(profile({ centroids: [[0.1, 0.2]] }));
    expect(
      JSON.parse(String(rawProfile(connection)["json"])),
    ).not.toHaveProperty("centroids");
    expect(written.centroids).toStrictEqual([
      [Float32Array.of(0.1)[0], Float32Array.of(0.2)[0]],
    ]);
    expect(await store.get("1:ABCD2345")).toStrictEqual(written);
  });

  it("stores NULL and count 0 for no centroids, and reads an empty list", async () => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    await store.put(profile());
    const raw = rawProfile(connection);
    expect(raw["centroids"]).toBeNull();
    expect(raw["centroid_count"]).toBe(0);
    expect((await store.get("1:ABCD2345"))?.centroids).toStrictEqual([]);
    expect(await store.get("1:NOSUCH00")).toBeUndefined();
  });

  it("binds a null for no centroids, not an empty blob, which node:sqlite could not tell apart", async () => {
    const connection = await migrated();
    const bound: (readonly SqlParam[] | undefined)[] = [];
    const watching: SqlConnection = {
      ...connection,
      queryAsync: (sql, params, options) => {
        bound.push(params);
        return connection.queryAsync(sql, params, options);
      },
    };
    await createCollectionProfileStore(watching).put(profile());
    expect(bound[0]?.[5]).toBeNull();
  });

  it("replaces by id, centroids and count included", async () => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    await store.put(profile({ centroids: [[1], [2]] }));
    await store.put(profile({ membershipHash: "new", builtAtEpochMs: 2000 }));
    expect(count(connection, "collection_profile")).toBe(1);
    const raw = rawProfile(connection);
    expect(raw["membership_hash"]).toBe("new");
    expect(raw["built_at"]).toBe(2000);
    expect(raw["centroids"]).toBeNull();
    expect((await store.get("1:ABCD2345"))?.centroids).toStrictEqual([]);
  });

  it("keeps the identifiers the gate would destroy, gates the rest, and marks it (measured: docs/07 §5.2's note)", async () => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    const clean = await store.put(profile());
    expect(clean.redaction).toStrictEqual({
      partlyRedacted: false,
      redactedStrings: 0,
      droppedFields: 0,
    });
    expect(clean.membershipHash).toBe(HEX_64);
    expect(clean.knownWorkKeys).toStrictEqual([HASH_KEY, "doi:10.1000/xyz"]);
    expect(clean.seeds[0]?.ids.url).toContain(HEX_40);
    // A number under a name KEYISH_FIELD matches stays.
    expect(clean.profileCallOutputTokens).toBe(1200);
    expect(clean.termWeights["token"]).toBe(0.25);
    expect(clean.subjectCounts["secret"]).toBe(1);

    const dirty = await store.put(
      profile({
        narrative: `about ${PLANTED}`,
        suggestedQueries: [`q ${PLANTED}`],
        collectionName: PLANTED,
      }),
    );
    expect(dirty.redaction?.partlyRedacted).toBe(true);
    expect(dirty.redaction?.redactedStrings).toBe(3);
    expect(String(rawProfile(connection)["json"])).not.toContain(PLANTED);
    expect(String(rawProfile(connection)["json"])).toContain(HEX_64);
    const read = await store.get("1:ABCD2345");
    expect(read?.narrative).not.toContain(PLANTED);
    expect(read?.redaction?.redactedStrings).toBe(3);
  });

  it("names exactly the identifier fields, each proved needed by the gate itself", () => {
    expect(COLLECTION_PROFILE_VERBATIM_KEYS).toStrictEqual([
      "id",
      "collectionKey",
      "membershipHash",
      "knownWorkKeys",
      "embeddingModel",
      "doi",
      "pmid",
      "pmcid",
      "arxivId",
      "s2CorpusId",
      "openAlexId",
      "epmcId",
      "url",
    ]);
    // Idempotent, and the earlier mark is summed in.
    const once = gateCollectionProfile(profile({ narrative: PLANTED }));
    const twice = gateCollectionProfile(once);
    expect(twice).toStrictEqual(once);
    const summed = gateCollectionProfile(
      profile({
        narrative: PLANTED,
        redaction: {
          partlyRedacted: false,
          redactedStrings: 4,
          droppedFields: 5,
        },
      }),
    );
    expect(summed.redaction).toStrictEqual({
      partlyRedacted: true,
      redactedStrings: 5,
      droppedFields: 5,
    });
  });

  it.each<[string, Partial<CollectionProfile>]>([
    ["an id not of its library and collection", { id: "2:ABCD2345" }],
    ["an empty collection key", { collectionKey: "", id: "1:" }],
    [
      "a library id that is not an integer",
      { libraryID: 1.5, id: "1.5:ABCD2345" },
    ],
    ["an empty membership hash", { membershipHash: "" }],
    ["centroids of two lengths", { centroids: [[1, 2], [3]] }],
    ["an empty centroid", { centroids: [[]] }],
    ["a centroid that is not finite", { centroids: [[Number.NaN]] }],
    ["a value too large for a Float32", { centroids: [[1e40]] }],
    [
      "centroids disagreeing with embeddingDim",
      { centroids: [[1, 2]], embeddingDim: 3 },
    ],
  ])("refuses %s, writing nothing", async (_name, overrides) => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    await expect(store.put(profile(overrides))).rejects.toThrow(RangeError);
    expect(count(connection, "collection_profile")).toBe(0);
  });

  it("allows embeddingDim beside no centroids", async () => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    await expect(
      store.put(profile({ embeddingDim: 768 })),
    ).resolves.toBeDefined();
  });

  it.each<[string, string, string]>([
    [
      "text that is not JSON",
      "UPDATE collection_profile SET json = 'x'",
      "not a stored profile",
    ],
    [
      "JSON with no profile",
      "UPDATE collection_profile SET json = '{}'",
      "not a stored profile",
    ],
    [
      "JSON that is null",
      "UPDATE collection_profile SET json = 'null'",
      "not a stored profile",
    ],
    [
      "JSON holding centroids",
      `UPDATE collection_profile SET json = json_set(json, '$.centroids', json('[]'))`,
      "not a stored profile",
    ],
    [
      "a count with no blob",
      "UPDATE collection_profile SET centroids = NULL",
      "do not divide",
    ],
    [
      "a blob a count cannot divide",
      "UPDATE collection_profile SET centroid_count = 3",
      "do not divide",
    ],
    [
      "an empty blob",
      "UPDATE collection_profile SET centroids = x''",
      "do not divide",
    ],
    [
      "a negative count",
      "UPDATE collection_profile SET centroid_count = -1",
      "do not divide",
    ],
    [
      "a fractional count",
      "UPDATE collection_profile SET centroid_count = 0.5",
      "do not divide",
    ],
  ])("refuses to read %s", async (_name, sql, message) => {
    const connection = await migrated();
    const store = createCollectionProfileStore(connection);
    await store.put(profile({ centroids: [[1, 2]] }));
    connection.db.exec(sql);
    const read = store.get("1:ABCD2345");
    await expect(read).rejects.toThrow(StorageError);
    await expect(read).rejects.toThrow(message);
  });

  it("builds the id docs/07 §5.2 prints", () => {
    expect(collectionProfileId(7, "KEY12345")).toBe("7:KEY12345");
  });
});

// ---------------------------------------------------------------------------
// 3. The recommendation store
// ---------------------------------------------------------------------------

const PROFILE_ID = "1:ABCD2345";

function work(
  workKey: string,
  overrides: Partial<CanonicalWork> = {},
): CanonicalWork {
  return {
    workKey,
    ids: { url: `https://www.semanticscholar.org/paper/${HEX_40}` },
    type: "journal-article",
    title: "A paper",
    authors: [{ family: "Author" }],
    url: `https://www.semanticscholar.org/paper/${HEX_40}`,
    provenance: {
      recordIds: [`semanticscholar:${HEX_40}`],
      fieldOrigin: {},
      seenIn: ["semanticscholar"],
    },
    normalizedAtEpochMs: 1,
    ...overrides,
  };
}

function recommendation(
  workKey: string,
  overrides: Partial<Recommendation> = {},
  profileId = PROFILE_ID,
): Recommendation {
  return {
    id: recommendationId(profileId, workKey),
    profileId,
    work: work(workKey),
    score: 0.5,
    signals: {
      similarity: 1,
      recency: 1,
      velocity: 1,
      novelty: 1,
      authorAffinity: 1,
      venueAffinity: 1,
      generatorAgreement: 1,
      coupling: 1,
    },
    similaritySpace: "specter_v2",
    reasons: [{ id: "cites-collection", count: 3 }],
    discoveredVia: [
      { sourceId: "semanticscholar", strategy: "recommendations" },
    ],
    generatedAtEpochMs: 100,
    ...overrides,
  };
}

function rawRecommendations(connection: Connection): Record<string, unknown>[] {
  return connection.db
    .prepare("SELECT * FROM recommendation ORDER BY rowid")
    .all()
    .map((r) => ({ ...(r as Record<string, unknown>) }));
}

describe("P5-T03 — createRecommendationStore", () => {
  it("writes the row's columns, with no user action and no action time in json", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    const written = await store.put(recommendation(HASH_KEY));
    const [raw] = rawRecommendations(connection);
    expect(raw).toMatchObject({
      id: `${PROFILE_ID}:${HASH_KEY}`,
      profile_id: PROFILE_ID,
      work_key: HASH_KEY,
      score: 0.5,
      user_action: null,
      action_at: null,
      generated_at: 100,
    });
    const json = JSON.parse(String(raw?.["json"])) as Record<string, unknown>;
    expect(json).not.toHaveProperty("userAction");
    expect(json).not.toHaveProperty("userActionAtEpochMs");
    expect(json).toMatchObject({ id: written.id });
    expect(written.redaction).toStrictEqual({
      partlyRedacted: false,
      redactedStrings: 0,
      droppedFields: 0,
    });
  });

  it("keeps the identifiers the gate would destroy, gates the rest, and marks it (measured: docs/07 §5.2's note)", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    const clean = await store.put(recommendation(HASH_KEY));
    expect(clean.id).toBe(`${PROFILE_ID}:${HASH_KEY}`);
    expect(clean.work.workKey).toBe(HASH_KEY);
    expect(clean.work.url).toContain(HEX_40);
    expect(clean.work.ids.url).toContain(HEX_40);
    expect(clean.work.provenance.recordIds[0]).toContain(HEX_40);

    const dirty = await store.put(
      recommendation("doi:10.1/x", {
        work: work("doi:10.1/x", {
          title: `A title ${PLANTED}`,
          abstract: `An abstract ${HEX_64}`,
          openAccess: {
            isOpenAccess: true,
            pdfUrl: `https://example.org/${HEX_40}.pdf`,
          },
        }),
        reasons: [{ id: "author-in-collection", names: [PLANTED] }],
      }),
    );
    expect(dirty.redaction?.partlyRedacted).toBe(true);
    expect(dirty.redaction?.redactedStrings).toBe(4);
    expect(dirty.work.title).not.toContain(PLANTED);
    expect(dirty.work.abstract).not.toContain(HEX_64);
    expect(dirty.work.openAccess?.pdfUrl).not.toContain(HEX_40);
    const stored = String(rawRecommendations(connection)[1]?.["json"]);
    expect(stored).not.toContain(PLANTED);
    expect(stored).not.toContain(HEX_64);
  });

  it("names exactly the identifier fields, and sums an earlier mark", () => {
    expect(RECOMMENDATION_VERBATIM_KEYS).toStrictEqual([
      "id",
      "profileId",
      "workKey",
      "recordIds",
      "doi",
      "pmid",
      "pmcid",
      "arxivId",
      "s2CorpusId",
      "openAlexId",
      "epmcId",
      "url",
    ]);
    const summed = gateRecommendation(
      recommendation("k", {
        work: work("k", { title: PLANTED }),
        redaction: {
          partlyRedacted: false,
          redactedStrings: 2,
          droppedFields: 7,
        },
      }),
    );
    expect(summed.redaction).toStrictEqual({
      partlyRedacted: true,
      redactedStrings: 3,
      droppedFields: 7,
    });
  });

  it('reject writes only "rejected" with its time, and answers whether it held the row', async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(recommendation("k"));
    expect(await store.reject(`${PROFILE_ID}:k`, 777)).toBe(true);
    expect(rawRecommendations(connection)[0]).toMatchObject({
      user_action: "rejected",
      action_at: 777,
    });
    expect(await store.reject("1:ABCD2345:never-stored", 778)).toBe(false);
    expect(count(connection, "recommendation")).toBe(1);
  });

  it("keeps the first time when a row is rejected twice", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(recommendation("k"));
    await store.reject(`${PROFILE_ID}:k`, 1);
    expect(await store.reject(`${PROFILE_ID}:k`, 2)).toBe(true);
    expect(rawRecommendations(connection)[0]?.["action_at"]).toBe(1);
  });

  it("refuses a rejection with no finite time", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(recommendation("k"));
    await expect(store.reject(`${PROFILE_ID}:k`, Number.NaN)).rejects.toThrow(
      RangeError,
    );
    expect(rawRecommendations(connection)[0]?.["user_action"]).toBeNull();
  });

  it("a later put replaces the row but keeps its rejection", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(recommendation("k"));
    await store.reject(`${PROFILE_ID}:k`, 5);
    await store.put(
      recommendation("k", { score: 0.75, generatedAtEpochMs: 200 }),
    );
    expect(count(connection, "recommendation")).toBe(1);
    expect(rawRecommendations(connection)[0]).toMatchObject({
      score: 0.75,
      generated_at: 200,
      user_action: "rejected",
      action_at: 5,
    });
  });

  it("a put carrying a rejection stores it in the columns, and a read returns it", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(
      recommendation("k", { userAction: "rejected", userActionAtEpochMs: 9 }),
    );
    expect(rawRecommendations(connection)[0]).toMatchObject({
      user_action: "rejected",
      action_at: 9,
    });
    const [read] = await store.listRejected(PROFILE_ID);
    expect(read?.userAction).toBe("rejected");
    expect(read?.userActionAtEpochMs).toBe(9);
    expect(read?.work.workKey).toBe("k");
  });

  it("drops an action time that comes with no action", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(recommendation("k", { userActionAtEpochMs: 9 }));
    expect(rawRecommendations(connection)[0]?.["action_at"]).toBeNull();
  });

  it.each<[string, Partial<Recommendation>]>([
    [
      '"accepted", or any import record',
      {
        userAction: "accepted" as unknown as "rejected",
        userActionAtEpochMs: 1,
      },
    ],
    [
      "an empty user action",
      { userAction: "" as unknown as "rejected", userActionAtEpochMs: 1 },
    ],
    ["a rejection with no time", { userAction: "rejected" }],
    [
      "a rejection with a time that is not finite",
      { userAction: "rejected", userActionAtEpochMs: Number.NaN },
    ],
    ["an id not of its profile and work", { id: "1:ABCD2345:other" }],
    ["an empty profile id", { profileId: "", id: ":k" }],
    ["a score that is not finite", { score: Number.NaN }],
  ])("refuses %s, writing nothing", async (_name, overrides) => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await expect(store.put(recommendation("k", overrides))).rejects.toThrow(
      RangeError,
    );
    expect(count(connection, "recommendation")).toBe(0);
  });

  it("refuses an empty work key", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await expect(
      store.put(recommendation("", { id: `${PROFILE_ID}:` })),
    ).rejects.toThrow(RangeError);
  });

  it("lists one profile's rejections, most recent first, honouring a limit", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    const other = "1:OTHER234";
    await store.put(recommendation("old"));
    await store.put(recommendation("new"));
    await store.put(recommendation("same-time-1"));
    await store.put(recommendation("same-time-2"));
    await store.put(recommendation("kept-not-rejected"));
    await store.put(recommendation("elsewhere", {}, other));
    await store.reject(`${PROFILE_ID}:old`, 10);
    await store.reject(`${PROFILE_ID}:new`, 30);
    await store.reject(`${PROFILE_ID}:same-time-1`, 20);
    await store.reject(`${PROFILE_ID}:same-time-2`, 20);
    await store.reject(`${other}:elsewhere`, 99);

    const keys = (await store.listRejected(PROFILE_ID)).map(
      (r) => r.work.workKey,
    );
    expect(keys).toStrictEqual(["new", "same-time-2", "same-time-1", "old"]);
    expect(
      (await store.listRejected(PROFILE_ID, 2)).map((r) => r.work.workKey),
    ).toStrictEqual(["new", "same-time-2"]);
    expect(await store.listRejected("1:NOSUCH00")).toStrictEqual([]);
  });

  it("refuses a limit that is not a positive integer", async () => {
    const store = createRecommendationStore(await migrated());
    for (const limit of [0, -1, 1.5]) {
      await expect(store.listRejected(PROFILE_ID, limit)).rejects.toThrow(
        RangeError,
      );
    }
  });

  it("keeps a collection's rejections through a profile rebuild, because the id is the collection's", async () => {
    const connection = await migrated();
    const profiles = createCollectionProfileStore(connection);
    const store = createRecommendationStore(connection);
    await profiles.put(profile());
    await store.put(recommendation("k"));
    await store.reject(`${PROFILE_ID}:k`, 1);
    await profiles.put(profile({ membershipHash: "rebuilt" }));
    expect(await store.listRejected(profile().id)).toHaveLength(1);
  });

  it.each<[string, string]>([
    ["text that is not JSON", "UPDATE recommendation SET json = 'x'"],
    ["JSON that is null", "UPDATE recommendation SET json = 'null'"],
    [
      "JSON with no work",
      `UPDATE recommendation SET json = '{"id":"a","profileId":"b"}'`,
    ],
    [
      "a work with no key",
      `UPDATE recommendation SET json = '{"id":"a","profileId":"b","work":{}}'`,
    ],
  ])("refuses to read %s", async (_name, sql) => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    await store.put(recommendation("k"));
    await store.reject(`${PROFILE_ID}:k`, 1);
    connection.db.exec(sql);
    await expect(store.listRejected(PROFILE_ID)).rejects.toThrow(StorageError);
  });

  it("binds every statement with debugParams off", async () => {
    const connection = await migrated();
    const store = createRecommendationStore(connection);
    connection.statements.length = 0;
    await store.put(recommendation("k"));
    await store.reject(`${PROFILE_ID}:k`, 1);
    await store.listRejected(PROFILE_ID);
    expect(connection.statements.length).toBeGreaterThanOrEqual(3);
    for (const statement of connection.statements) {
      expect(statement.options).toStrictEqual({ debugParams: false });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. installPluginDatabase, the constructing file
// ---------------------------------------------------------------------------

/** What the three handed-out calls resolve to. */
interface HandedOut {
  readonly profiles: CollectionProfileStore | undefined;
  readonly recommendations: RecommendationStore | undefined;
  readonly embeddings: EmbeddingStore | undefined;
}

describe("P5-T03 — installPluginDatabase hands out the three stores on the one connection", () => {
  function install(connection: Connection | undefined) {
    const scope = createScope({
      description: "embeddingStore test",
      onError: (message, error) => {
        throw new Error(`${message}: ${String(error)}`);
      },
      strict: true,
    });
    const clock = createManualClock(1000);
    const database = installPluginDatabase(scope, {
      source:
        connection === undefined
          ? undefined
          : {
              open: () => connection,
              path: () => "/data/research-helper.sqlite",
              blobs: {
                write: () => Promise.resolve(),
                read: () => Promise.resolve(undefined),
                remove: () => Promise.resolve(),
                list: () => Promise.resolve([]),
              },
            },
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
      cacheMaxBytes: () => 1024 * 1024,
    });
    return { scope, database };
  }

  it("each store reaches the file, on the connection it opened, before and after the open settles", async () => {
    const connection = sqlite();
    const { scope, database } = install(connection);
    // Not awaited first: each handed-out store waits for the open-and-migrate.
    const profiles = await database.collectionProfiles();
    const recommendations = await database.recommendations();
    const embeddings = await database.embeddings();
    await profiles?.put(profile({ centroids: [[1, 2]] }));
    expect((await profiles?.get(PROFILE_ID))?.centroids).toStrictEqual([
      [1, 2],
    ]);
    await recommendations?.put(recommendation("k"));
    expect(await recommendations?.reject(`${PROFILE_ID}:k`, 1)).toBe(true);
    expect(await recommendations?.listRejected(PROFILE_ID, 1)).toHaveLength(1);
    await embeddings?.putMany([row("k", 1)]);
    expect(
      (await embeddings?.getMany(["k"], "specter_v2"))?.get("k"),
    ).toStrictEqual(vector(0.25, -0.5));
    expect((await embeddings?.allForModel("specter_v2"))?.size).toBe(1);
    expect(await embeddings?.evictToCap(() => false)).toStrictEqual({
      evicted: 0,
      bytes: 8,
    });
    const open = await database.ready;
    expect(open?.schemaVersion).toBe(10);
    expect(open?.connection).toBe(connection);
    await scope.unregisterAll();
  });

  it("without a database, or once teardown has begun, hands out nothing", async () => {
    const none = install(undefined);
    expect(await none.database.collectionProfiles()).toBeUndefined();
    expect(await none.database.recommendations()).toBeUndefined();
    expect(await none.database.embeddings()).toBeUndefined();
    await none.scope.unregisterAll();

    const connection = sqlite();
    const { scope, database } = install(connection);
    await database.ready;
    await scope.unregisterAll();
    expect(await database.collectionProfiles()).toBeUndefined();
    expect(await database.recommendations()).toBeUndefined();
    expect(await database.embeddings()).toBeUndefined();
  });

  it.each<[string, (held: HandedOut) => Promise<unknown> | undefined]>([
    ["collectionProfiles().put", (h) => h.profiles?.put(profile())],
    ["collectionProfiles().get", (h) => h.profiles?.get(PROFILE_ID)],
    [
      "recommendations().put",
      (h) => h.recommendations?.put(recommendation("k")),
    ],
    ["recommendations().reject", (h) => h.recommendations?.reject("absent", 1)],
    [
      "recommendations().listRejected",
      (h) => h.recommendations?.listRejected(PROFILE_ID),
    ],
    ["embeddings().putMany", (h) => h.embeddings?.putMany([row("k", 1)])],
    ["embeddings().getMany", (h) => h.embeddings?.getMany(["k"], "m")],
    ["embeddings().allForModel", (h) => h.embeddings?.allForModel("m")],
    ["embeddings().evictToCap", (h) => h.embeddings?.evictToCap(() => false)],
  ])("closes the connection only after %s in flight", async (_name, call) => {
    const connection = sqlite();
    const events: string[] = [];
    let armed = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = async (): Promise<void> => {
      if (!armed) return;
      await held;
      events.push("statement");
    };
    const slow: Connection = {
      ...connection,
      queryAsync: async (sql, params, options) => {
        await hold();
        return connection.queryAsync(sql, params, options);
      },
      valueQueryAsync: async (sql, params, options) => {
        await hold();
        return connection.valueQueryAsync(sql, params, options);
      },
      closeDatabase: () => {
        events.push("close");
        return connection.closeDatabase();
      },
    };
    const { scope, database } = install(slow);
    const handedOut: HandedOut = {
      profiles: await database.collectionProfiles(),
      recommendations: await database.recommendations(),
      embeddings: await database.embeddings(),
    };
    armed = true;
    const running = call(handedOut);
    const closing = scope.unregisterAll();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events).toStrictEqual([]);
    release();
    await running;
    await closing;
    expect(events[0]).toBe("statement");
    expect(events.at(-1)).toBe("close");
    expect(events.filter((event) => event === "close")).toHaveLength(1);
  });
});

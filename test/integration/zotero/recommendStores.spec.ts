/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T03` — the three stores Phase 5 reads, against the real plugin database
 * inside a real Zotero (`docs/07` §5.2, §8.3, §9.2).
 *
 * ## What only this layer can show
 *
 * `test/unit/zotero/embeddingStore.test.ts` runs the same statements on
 * `node:sqlite`. Two things differ inside Zotero, and neither was recorded
 * before this card: a `Uint8Array` has to pass `parseQueryAndParams` and
 * `Sqlite.sys.mjs`'s `bindParam` as a real `BLOB`, and a `BLOB` column has to
 * read back through `mozIStorageRow` into bytes. So this spec reads each stored
 * blob back with SQLite's own `hex()` and `typeof()`, which owe nothing to the
 * store's codec, and logs the shape the platform hands back.
 *
 * ## The plugin database is read through the plugin's own connection
 *
 * As `provenanceStore.spec.ts` explains: the connection is exclusive, so it is
 * read off `addon.api.provenance`. Every row this spec writes carries this run's
 * tag and is deleted in `after()`. No HTTP request is made.
 */

import { config } from "../../../package.json";
import type Addon from "../../../src/addon";
import type { CollectionProfile } from "../../../src/model/profile";
import type { Recommendation } from "../../../src/model/recommendation";
import {
  createCollectionProfileStore,
  createEmbeddingStore,
  createRecommendationStore,
  recommendationId,
  type EmbeddingRow,
  type SqlConnection,
} from "../../../src/zotero/db";

/** The slice of Mocha's test context this file uses. */
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 60_000;
const TAG = `p5t03-${String(Date.now())}`;
const LIBRARY_ID = 1;
const COLLECTION_KEY = `C${TAG}`;
const PROFILE_ID = `${String(LIBRARY_ID)}:${COLLECTION_KEY}`;
const HEX_40 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const HEX_64 = `${HEX_40}0123456789abcdef01234567`;
const HASH_KEY = `hash:${HEX_40}`;
const PLANTED = `sk-ant-${"x".repeat(30)}`;
const MODEL = `model-${TAG}`;

function log(line: string): void {
  debug(`[P5-T03] ${line}`);
}

async function connection(): Promise<SqlConnection> {
  const addon = (Zotero as unknown as Record<string, unknown>)[
    config.addonInstance
  ] as Addon | undefined;
  const store = await addon?.api.provenance;
  if (store === undefined) assert.fail("the plugin database is not open");
  return store.database as unknown as SqlConnection;
}

function hexOf(values: Float32Array): string {
  return [
    ...new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function profile(centroids: readonly (readonly number[])[]): CollectionProfile {
  return {
    id: PROFILE_ID,
    libraryID: LIBRARY_ID,
    collectionKey: COLLECTION_KEY,
    collectionName: `Fixture ${PLANTED}`,
    builtAtEpochMs: 1000,
    itemCount: 2,
    membershipHash: HEX_64,
    termWeights: { "base editing": 0.5 },
    subjectCounts: { "한국어 주제": 2 },
    topAuthors: [],
    topVenues: [],
    yearHistogram: { 2024: 2 },
    medianYear: 2024,
    centroids,
    ...(centroids.length > 0 && {
      embeddingModel: "specter_v2",
      embeddingDim: centroids[0]?.length ?? 0,
    }),
    seeds: [],
    suggestedQueries: [],
    origin: "heuristic",
    knownWorkKeys: [HASH_KEY],
  };
}

function recommendation(workKey: string): Recommendation {
  return {
    id: recommendationId(PROFILE_ID, workKey),
    profileId: PROFILE_ID,
    work: {
      workKey,
      ids: {},
      type: "journal-article",
      title: `A paper ${PLANTED}`,
      authors: [{ family: "Author" }],
      provenance: {
        recordIds: [`semanticscholar:${HEX_40}`],
        fieldOrigin: {},
        seenIn: ["semanticscholar"],
      },
      normalizedAtEpochMs: 1,
    },
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
    reasons: [],
    discoveredVia: [
      { sourceId: "semanticscholar", strategy: "recommendations" },
    ],
    generatedAtEpochMs: 100,
  };
}

describe("P5-T03 — the Phase 5 stores on the real plugin database", function () {
  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const database = await connection();
    await database.queryAsync("DELETE FROM collection_profile WHERE id = ?", [
      PROFILE_ID,
    ]);
    await database.queryAsync(
      "DELETE FROM recommendation WHERE profile_id = ?",
      [PROFILE_ID],
    );
    await database.queryAsync("DELETE FROM embedding WHERE model = ?", [MODEL]);
  });

  it("carries the three tables and two indexes with no foreign key", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const database = await connection();
    for (const table of ["collection_profile", "recommendation", "embedding"]) {
      const keys = await database.valueQueryAsync(
        `SELECT COUNT(*) FROM pragma_foreign_key_list('${table}')`,
      );
      assert.strictEqual(Number(keys), 0, `${table}: no foreign key`);
    }
    const objects = (await database.queryAsync(
      "SELECT name FROM sqlite_master WHERE name IN " +
        "('collection_profile', 'recommendation', 'embedding', 'idx_rec_profile', 'idx_embedding_model') ORDER BY name",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      objects.map((row) => String(row["name"])),
      [
        "collection_profile",
        "embedding",
        "idx_embedding_model",
        "idx_rec_profile",
        "recommendation",
      ],
    );
    const profileIndex = (await database.queryAsync(
      "SELECT name, desc FROM pragma_index_xinfo('idx_rec_profile') WHERE key = 1 ORDER BY seqno",
    )) as Record<string, unknown>[];
    assert.deepEqual(
      profileIndex.map((row) => [String(row["name"]), Number(row["desc"])]),
      [
        ["profile_id", 0],
        ["score", 1],
      ],
      "idx_rec_profile, score descending",
    );
  });

  it("round-trips a profile with k = 2 centroids through a real BLOB", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const database = await connection();
    const store = createCollectionProfileStore(database);
    const centroids = [
      [0.5, -0.25, 2],
      [1, 0, -1],
    ];
    const written = await store.put(profile(centroids));
    assert.isTrue(written.redaction?.partlyRedacted === true, "marked");
    assert.strictEqual(written.redaction?.redactedStrings, 1);

    const raw = (await database.queryAsync(
      "SELECT typeof(centroids) AS kind, hex(centroids) AS bytes, centroid_count, membership_hash, json " +
        "FROM collection_profile WHERE id = ?",
      [PROFILE_ID],
    )) as Record<string, unknown>[];
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(String(raw[0]?.["kind"]), "blob", "stored as a BLOB");
    assert.strictEqual(
      String(raw[0]?.["bytes"]),
      hexOf(Float32Array.from(centroids.flat())),
      "the bytes, row-major",
    );
    assert.strictEqual(Number(raw[0]?.["centroid_count"]), 2);
    assert.strictEqual(String(raw[0]?.["membership_hash"]), HEX_64);
    const json = String(raw[0]?.["json"]);
    assert.isFalse(json.includes(PLANTED), "no planted key in json");
    assert.isTrue(json.includes(HEX_64), "the hash, verbatim");
    assert.isTrue(json.includes(HASH_KEY), "the work key, verbatim");
    assert.isTrue(json.includes("한국어 주제"), "UTF-8 kept");
    assert.isFalse(json.includes('"centroids"'), "no centroids in json");

    const read = await store.get(PROFILE_ID);
    assert.deepEqual(read?.centroids, centroids, "k = 2, byte-exact values");
    assert.strictEqual(read?.membershipHash, HEX_64);
    assert.deepEqual(read?.knownWorkKeys, [HASH_KEY]);

    // Replaced by id, and the blob becomes NULL (a bound null) when k = 0.
    await store.put(profile([]));
    const empty = (await database.queryAsync(
      "SELECT typeof(centroids) AS kind, centroid_count FROM collection_profile WHERE id = ?",
      [PROFILE_ID],
    )) as Record<string, unknown>[];
    assert.strictEqual(empty.length, 1, "one row per id");
    assert.strictEqual(String(empty[0]?.["kind"]), "null");
    assert.strictEqual(Number(empty[0]?.["centroid_count"]), 0);
    assert.deepEqual((await store.get(PROFILE_ID))?.centroids, []);
    assert.strictEqual(await store.get(`${PROFILE_ID}-none`), undefined);
  });

  it("round-trips a rejection, keeps it through a later put, and writes nothing else", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const database = await connection();
    const store = createRecommendationStore(database);
    const written = await store.put(recommendation(HASH_KEY));
    assert.strictEqual(written.id, `${PROFILE_ID}:${HASH_KEY}`, "verbatim");
    await store.put(recommendation("doi:10.1/kept"));
    assert.deepEqual(await store.listRejected(PROFILE_ID), [], "none yet");

    assert.strictEqual(await store.reject(written.id, 777), true);
    assert.strictEqual(await store.reject(`${PROFILE_ID}:absent`, 778), false);
    await store.put({ ...recommendation(HASH_KEY), score: 0.75 });

    const [read, ...others] = await store.listRejected(PROFILE_ID, 10);
    assert.strictEqual(others.length, 0, "only the rejected row");
    assert.strictEqual(read?.work.workKey, HASH_KEY);
    assert.strictEqual(read?.userAction, "rejected");
    assert.strictEqual(read?.userActionAtEpochMs, 777);
    assert.strictEqual(read?.score, 0.75);

    const raw = (await database.queryAsync(
      "SELECT DISTINCT user_action FROM recommendation WHERE profile_id = ? ORDER BY user_action",
      [PROFILE_ID],
    )) as Record<string, unknown>[];
    assert.deepEqual(
      raw.map((row) => row["user_action"]),
      [null, "rejected"],
      '"rejected" is the only user action written',
    );
    const json = String(
      await database.valueQueryAsync(
        "SELECT json FROM recommendation WHERE id = ?",
        [written.id],
      ),
    );
    assert.isFalse(json.includes(PLANTED), "no planted key in json");
    assert.isFalse(json.includes("userAction"), "no action in json");
  });

  it("round-trips 3 vectors byte-exact, and evicts the oldest not in the library first", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const database = await connection();
    const rows: EmbeddingRow[] = [
      [0.1, -2.5, 1e-7],
      [Math.PI, Math.E, -0],
      [1, 2, 3],
    ].map((values, index) => ({
      workKey: `${TAG}-${String(index)}`,
      model: MODEL,
      vector: Float32Array.from(values),
      createdAtEpochMs: index + 1,
    }));
    // The shipped cap. The eviction below counts the whole table, and these three
    // rows are the only ones the fresh test profile holds.
    const store = createEmbeddingStore(database);
    await store.putMany(rows);

    const raw = (await database.queryAsync(
      "SELECT work_key, typeof(vector) AS kind, hex(vector) AS bytes, dim, created_at FROM embedding WHERE model = ? ORDER BY created_at",
      [MODEL],
    )) as Record<string, unknown>[];
    assert.strictEqual(raw.length, 3);
    rows.forEach((row, index) => {
      assert.strictEqual(String(raw[index]?.["kind"]), "blob");
      assert.strictEqual(String(raw[index]?.["bytes"]), hexOf(row.vector));
      assert.strictEqual(Number(raw[index]?.["dim"]), 3);
      assert.strictEqual(
        Number(raw[index]?.["created_at"]),
        row.createdAtEpochMs,
      );
    });

    // What the platform hands back for a BLOB (docs/07 §9.2's note of 2026-11-02).
    const shape = (await database.queryAsync(
      "SELECT vector FROM embedding WHERE work_key = ? AND model = ?",
      [rows[0]?.workKey ?? "", MODEL],
    )) as Record<string, unknown>[];
    const handed = shape[0]?.["vector"];
    log(
      `a BLOB reads back as ${Object.prototype.toString.call(handed)}, ` +
        `isArray ${String(Array.isArray(handed))}, ` +
        `isView ${String(ArrayBuffer.isView(handed))}, ` +
        `length ${String((handed as { length?: number }).length)}`,
    );
    assert.isTrue(Array.isArray(handed), "an array of numbers");
    assert.strictEqual((handed as unknown[]).length, 12, "dim × 4 elements");
    assert.strictEqual(typeof (handed as unknown[])[0], "number");

    const many = await store.getMany(
      [rows[0]?.workKey ?? "", rows[2]?.workKey ?? "", "absent"],
      MODEL,
    );
    assert.strictEqual(many.size, 2, "two of three asked for");
    const all = await store.allForModel(MODEL);
    assert.strictEqual(all.size, 3);
    for (const row of rows) {
      assert.strictEqual(
        hexOf(all.get(row.workKey) ?? new Float32Array()),
        hexOf(row.vector),
        "byte-exact",
      );
    }

    // A cap of two vectors over the same rows: the store's order on real SQLite.
    const capped = createEmbeddingStore(database, { capBytes: 24 });
    const before = Number(
      await database.valueQueryAsync(
        "SELECT COALESCE(SUM(dim * 4), 0) FROM embedding",
      ),
    );
    assert.strictEqual(before, 36, "this spec's three vectors alone");
    const outcome = await capped.evictToCap(
      (workKey) => workKey === rows[0]?.workKey,
    );
    assert.deepEqual(outcome, { evicted: 1, bytes: 24 });
    assert.deepEqual(
      [...(await store.allForModel(MODEL)).keys()].sort(),
      [rows[0]?.workKey ?? "", rows[2]?.workKey ?? ""].sort(),
      "the oldest not in the library went, not the older one in it",
    );
  });

  // A logged measurement for P5-T20, whose callers read vectors: a BLOB arrives
  // as one JavaScript number per byte. Asserts the counts, never the times.
  it("logs what 1000 vectors of 768 dimensions cost to write and read", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const database = await connection();
    const store = createEmbeddingStore(database);
    const model = `${MODEL}-measure`;
    const rows: EmbeddingRow[] = Array.from({ length: 1000 }, (_, index) => ({
      workKey: `${TAG}-measure-${String(index)}`,
      model,
      vector: new Float32Array(768).fill(index / 1000),
      createdAtEpochMs: index,
    }));
    try {
      const written = performance.now();
      await store.putMany(rows);
      const read = performance.now();
      const all = await store.allForModel(model);
      const done = performance.now();
      assert.strictEqual(all.size, 1000);
      log(
        `1000 vectors of 768: putMany ${String(Math.round(read - written))} ms, ` +
          `allForModel ${String(Math.round(done - read))} ms`,
      );
    } finally {
      await database.queryAsync("DELETE FROM embedding WHERE model = ?", [
        model,
      ]);
    }
  });
});

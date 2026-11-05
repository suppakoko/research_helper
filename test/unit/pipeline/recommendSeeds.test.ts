import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { StorageError } from "../../../src/core/errors";
import type { Logger } from "../../../src/core/logger";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { ExternalIds, Pmid } from "../../../src/model/ids";
import type { CollectionProfile } from "../../../src/model/profile";
import type { Recommendation } from "../../../src/model/recommendation";
import {
  KMEANS_AUTO_DEFAULTS,
  KMEANS_SAMPLE_CAP,
  kmeansAuto,
  labelCentroids,
  mulberry32,
  type LabelledWork,
} from "../../../src/pipeline/recommend/centroids";
import { persistProfile } from "../../../src/pipeline/recommend/profile";
import {
  lexicalSeedSpace,
  LEXICAL_DIVERSITY_CUT,
  MAX_NEGATIVES,
  MIN_SEEDS,
  recentNegatives,
  SEED_QUALITY_FULL_CITATIONS,
  SEED_RECENCY_TAU_YEARS,
  SEED_RECENTLY_ADDED_DAYS,
  SEED_WEIGHTS,
  selectSeeds,
  specterSeedSpace,
  SPECTER_DIVERSITY_CUT,
  withTopicsAndSeeds,
  type SeedSpace,
} from "../../../src/pipeline/recommend/seeds";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingVector,
} from "../../../src/pipeline/shared/embeddings";
import { lexicalSpace } from "../../../src/pipeline/shared/lexical";
import { RECOMMEND_MAX_POSITIVES } from "../../../src/sources/semanticscholar/recommendations";
import {
  collectionProfileId,
  createCollectionProfileStore,
  createRecommendationStore,
  recommendationId,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

/**
 * `P5-T21`, `centroids.ts` and `seeds.ts`. Layer 1 (`docs/13` §2.1): plain Node over
 * synthetic vectors from a seeded generator. Nothing here is a real SPECTER2 vector,
 * so these tests prove the mechanism and say nothing about whether `docs/05` §7.2's
 * values suit real collections, which is `P5-T30`'s to measure.
 */

const DIM = EMBEDDING_DIMENSIONS.specter_v2;
const MODEL = "specter_v2";
const NOW = Date.UTC(2026, 10, 5);
const DAY = 864e5;
/** See "pins the choices it makes on data with no clear answer". */
const GOLDEN_TRIALS: readonly (readonly number[])[] = [
  [2, 0.005066, 21],
  [3, 0.002613, 9],
  [4, 0.003836, 6],
];

function gaussian(random: () => number): number {
  return (
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  );
}

function unit(values: readonly number[]): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return Float32Array.from(values, (value) => value / norm);
}

function vec(...values: readonly number[]): EmbeddingVector {
  return { model: MODEL, values: unit(values) };
}

function randomDirection(random: () => number, dim: number): number[] {
  return Array.from({ length: dim }, () => gaussian(random));
}

/**
 * `sizes[t]` members of topic `t`: a unit centre plus noise, about 0.77 cosine to the
 * centre and 0.6 between two members, and about 0 across topics. Keys `t<t>-<n>`.
 */
function topics(
  sizes: readonly number[],
  seed = 1,
  dim = DIM,
): Map<string, EmbeddingVector> {
  const random = mulberry32(seed);
  const sigma = 0.83 / Math.sqrt(dim);
  const vectors = new Map<string, EmbeddingVector>();
  sizes.forEach((size, topic) => {
    const centre = unit(randomDirection(random, dim));
    for (let n = 0; n < size; n += 1) {
      const values = Array.from(
        centre,
        (value) => value + sigma * gaussian(random),
      );
      vectors.set(`t${String(topic)}-${String(n).padStart(3, "0")}`, {
        model: MODEL,
        values: unit(values),
      });
    }
  });
  return vectors;
}

function work(
  workKey: string,
  fields: Partial<CanonicalWork> = {},
): CanonicalWork {
  return {
    workKey,
    ids: { pmid: workKey as Pmid },
    type: "journal-article",
    title: "Z",
    authors: [],
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
    normalizedAtEpochMs: 1,
    ...fields,
  };
}

const keysOf = (seeds: readonly { ids: Partial<ExternalIds> }[]): string[] =>
  seeds.map((seed) => seed.ids.pmid as string);

/** A space of no opinion: `overrides` give it one. */
function flatSpace(overrides: Partial<SeedSpace> = {}): SeedSpace {
  return {
    space: "specter_v2",
    diversityCut: 0.5,
    centralityOf: () => 0,
    topicOf: () => undefined,
    similarity: () => 0,
    ...overrides,
  };
}

function fakeLogger(): Logger & {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
} {
  const logger = {
    child: () => logger,
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };
  return logger as unknown as Logger & {
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
}

function profile(fields: Partial<CollectionProfile> = {}): CollectionProfile {
  return {
    id: collectionProfileId(1, "COLLKEY1"),
    libraryID: 1,
    collectionKey: "COLLKEY1",
    collectionName: "A collection",
    builtAtEpochMs: NOW,
    itemCount: 5,
    membershipHash: "hash",
    termWeights: {},
    subjectCounts: {},
    topAuthors: [],
    topVenues: [],
    yearHistogram: {},
    medianYear: undefined,
    centroids: [],
    seeds: [],
    suggestedQueries: [],
    origin: "heuristic",
    knownWorkKeys: [],
    ...fields,
  };
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mulberry32", () => {
  it("answers one fixed sequence in [0, 1) for one seed", () => {
    const random = mulberry32(1);
    expect([random(), random(), random()]).toStrictEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
    const other = mulberry32(2);
    expect(other()).not.toBe(mulberry32(1)());
    const many = mulberry32(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = many();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("kmeansAuto — choosing k", () => {
  it("states docs/05 §7.2's values as its defaults", () => {
    expect(KMEANS_AUTO_DEFAULTS).toMatchObject({
      kMax: 4,
      minClusterSize: 5,
      minGain: 0.08,
    });
  });

  it("finds two topics and puts every member in its own", () => {
    const clusters = kmeansAuto(topics([20, 12]));
    expect(clusters.centroids).toHaveLength(2);
    expect(clusters.members[0]?.every((key) => key.startsWith("t0-"))).toBe(
      true,
    );
    expect(clusters.members[0]).toHaveLength(20);
    expect(clusters.members[1]?.every((key) => key.startsWith("t1-"))).toBe(
      true,
    );
    expect(clusters.members[1]).toHaveLength(12);
    expect(clusters.topicOf.get("t1-003")).toBe(1);
    expect(clusters.topicOf.size).toBe(32);
  });

  it.each([
    [[15, 15, 15], 3],
    [[15, 12, 10, 8], 4],
  ])("finds %j as k = %i", (sizes, k) => {
    expect(kmeansAuto(topics(sizes)).centroids).toHaveLength(k);
  });

  it("stays at kMax however many topics there are", () => {
    const six = topics([10, 10, 10, 10, 10, 10]);
    expect(kmeansAuto(six).centroids.length).toBeLessThanOrEqual(4);
    expect(kmeansAuto(six).trials.map((trial) => trial.k)).toStrictEqual([
      2, 3, 4,
    ]);
    expect(kmeansAuto(six, { kMax: 2 }).centroids).toHaveLength(2);
  });

  it.each([1, 2, 3, 4, 5])(
    "keeps one topic together, whose split gains too little (seed %i)",
    (seed) => {
      const clusters = kmeansAuto(topics([40], seed));
      expect(clusters.centroids).toHaveLength(1);
      expect(clusters.members[0]).toHaveLength(40);
      for (const trial of clusters.trials) {
        expect(trial.silhouette).toBeLessThan(0.08);
      }
    },
  );

  it("refuses a k with a cluster below minClusterSize, and takes it at exactly that size", () => {
    expect(kmeansAuto(topics([30, 4])).centroids).toHaveLength(1);
    const atFive = kmeansAuto(topics([30, 5]));
    expect(atFive.centroids).toHaveLength(2);
    expect(atFive.trials[0]?.smallestCluster).toBe(5);
    expect(
      kmeansAuto(topics([30, 5]), { minClusterSize: 6 }).centroids,
    ).toHaveLength(1);
  });

  it("does not try a k the collection cannot fill", () => {
    expect(kmeansAuto(topics([5, 4])).trials).toStrictEqual([]);
    expect(kmeansAuto(topics([5, 5])).trials.map((t) => t.k)).toStrictEqual([
      2,
    ]);
    expect(kmeansAuto(topics([5, 5])).centroids).toHaveLength(2);
    expect(kmeansAuto(topics([5, 5, 5])).trials.map((t) => t.k)).toStrictEqual([
      2, 3,
    ]);
    expect(
      kmeansAuto(topics([5, 5]), { minClusterSize: 0 }).centroids.length,
    ).toBeGreaterThan(0);
  });

  it("takes a k at exactly minGain and not just under it", () => {
    const vectors = topics([20, 20]);
    const silhouette = kmeansAuto(vectors).trials[0]?.silhouette as number;
    expect(silhouette).toBeGreaterThan(0.08);
    expect(kmeansAuto(vectors, { minGain: silhouette }).centroids).toHaveLength(
      2,
    );
    expect(
      kmeansAuto(vectors, { minGain: silhouette + 1e-6 }).centroids,
    ).toHaveLength(1);
  });

  it("measures the gain against the k held, not against one topic", () => {
    const vectors = topics([15, 15, 15]);
    const [two, three] = kmeansAuto(vectors).trials;
    const s2 = two?.silhouette as number;
    const s3 = three?.silhouette as number;
    expect(s3).toBeGreaterThan(s2);
    // Above what k = 3 adds to k = 2, and no more than k = 2 has.
    const minGain = Math.min(s2, s3 - s2 + 0.01);
    expect(minGain).toBeGreaterThan(s3 - s2);
    expect(kmeansAuto(vectors, { minGain }).centroids).toHaveLength(2);
  });

  it("computes the silhouette as a hand calculation does", () => {
    const vectors = new Map([
      ["a", vec(1, 0)],
      ["b", vec(0.99, 0.1)],
      ["c", vec(0.97, 0.25)],
      ["d", vec(0, 1)],
      ["e", vec(0.1, 0.99)],
    ]);
    const distance = (p: string, q: string): number => {
      const left = vectors.get(p)?.values as Float32Array;
      const right = vectors.get(q)?.values as Float32Array;
      return (
        1 -
        Math.min(
          1,
          (left[0] ?? 0) * (right[0] ?? 0) + (left[1] ?? 0) * (right[1] ?? 0),
        )
      );
    };
    const groups = [
      ["a", "b", "c"],
      ["d", "e"],
    ];
    let total = 0;
    for (const [own, others] of [
      [groups[0], groups[1]],
      [groups[1], groups[0]],
    ] as const) {
      for (const member of own ?? []) {
        const rest = (own ?? []).filter((key) => key !== member);
        const within =
          rest.reduce((sum, key) => sum + distance(member, key), 0) /
          rest.length;
        const across =
          (others ?? []).reduce((sum, key) => sum + distance(member, key), 0) /
          (others ?? []).length;
        total += (across - within) / Math.max(within, across);
      }
    }
    const trial = kmeansAuto(vectors, {
      kMax: 2,
      minClusterSize: 2,
    }).trials[0];
    expect(trial?.silhouette).toBeCloseTo(total / 5, 5);
    expect(trial?.smallestCluster).toBe(2);
  });

  it("counts a member alone in its cluster as 0", () => {
    const vectors = new Map([
      ["a", vec(1, 0)],
      ["b", vec(0.99, 0.1)],
      ["c", vec(0, 1)],
    ]);
    const trial = kmeansAuto(vectors, { kMax: 2, minClusterSize: 1 }).trials[0];
    const ab = 1 - (vec(1, 0).values[0] ?? 0) * (vec(0.99, 0.1).values[0] ?? 0);
    const bc = vec(0.99, 0.1).values[1] ?? 0;
    const expected = ((1 - ab) / 1 + (1 - bc - ab) / (1 - bc)) / 3;
    expect(trial?.smallestCluster).toBe(1);
    expect(trial?.silhouette).toBeCloseTo(expected, 5);
  });
});

describe("kmeansAuto — what it answers", () => {
  it("answers nothing for no vectors", () => {
    expect(kmeansAuto(new Map())).toStrictEqual({
      centroids: [],
      members: [],
      topicOf: new Map(),
      trials: [],
    });
  });

  it("answers one topic for one vector", () => {
    const only = vec(3, 4);
    const clusters = kmeansAuto(new Map([["a", only]]));
    expect(clusters.centroids).toHaveLength(1);
    expect(clusters.centroids[0]?.model).toBe(MODEL);
    expect(Array.from(clusters.centroids[0]?.values ?? [])).toStrictEqual(
      Array.from(only.values),
    );
    expect(clusters.members).toStrictEqual([["a"]]);
    expect(clusters.topicOf.get("a")).toBe(0);
  });

  it("makes a centroid the unit mean of its members", () => {
    const clusters = kmeansAuto(
      new Map([
        ["a", vec(1, 0)],
        ["b", vec(0, 1)],
      ]),
    );
    expect(clusters.centroids[0]?.values[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(clusters.centroids[0]?.values[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("gives every centroid unit length, and each member's own centroid is its nearest", () => {
    const vectors = topics([20, 15, 10]);
    const clusters = kmeansAuto(vectors);
    const dot = (a: Float32Array, b: Float32Array): number =>
      a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
    for (const centroid of clusters.centroids) {
      expect(dot(centroid.values, centroid.values)).toBeCloseTo(1, 5);
    }
    for (const [key, topic] of clusters.topicOf) {
      const scores = clusters.centroids.map((centroid) =>
        dot(vectors.get(key)?.values as Float32Array, centroid.values),
      );
      expect(scores.indexOf(Math.max(...scores))).toBe(topic);
    }
  });

  it("answers no centroid for vectors that cancel out", () => {
    const clusters = kmeansAuto(
      new Map([
        ["a", vec(1, 0)],
        ["b", vec(-1, 0)],
      ]),
    );
    expect(clusters.centroids).toStrictEqual([]);
    expect(clusters.topicOf.size).toBe(0);
    expect(clusters.members).toStrictEqual([]);
  });

  it("survives identical vectors, which have no second start", () => {
    const same = new Map(
      Array.from({ length: 12 }, (_, i) => [`k${String(i)}`, vec(1, 2, 3)]),
    );
    const clusters = kmeansAuto(same);
    expect(clusters.centroids).toHaveLength(1);
    expect(clusters.members[0]).toHaveLength(12);
  });

  it("numbers topics largest first, then by first work key", () => {
    const small = kmeansAuto(topics([6, 14]));
    expect(small.members[0]?.[0]).toBe("t1-000");
    expect(small.members[1]?.[0]).toBe("t0-000");
    const even = kmeansAuto(topics([10, 10]));
    expect(even.members[0]?.[0]).toBe("t0-000");
    expect(even.members[1]?.[0]).toBe("t1-000");
  });

  it("sorts each topic's members", () => {
    const shuffled = new Map([...topics([10, 10])].reverse());
    for (const members of kmeansAuto(shuffled).members) {
      expect([...members]).toStrictEqual([...members].sort());
    }
  });

  it("throws on two models or two lengths, even with too few to split", () => {
    expect(() =>
      kmeansAuto(
        new Map([
          ["a", vec(1, 0)],
          ["b", { model: "other", values: unit([1, 0]) }],
        ]),
      ),
    ).toThrow(RangeError);
    expect(() =>
      kmeansAuto(
        new Map([
          ["a", vec(1, 0)],
          ["b", vec(1, 0, 0)],
        ]),
      ),
    ).toThrow(RangeError);
  });

  it("draws its sample from the whole collection, not its first keys", () => {
    // The small topic's keys sort after the cap, so the first keys alone never see it.
    const clusters = kmeansAuto(topics([KMEANS_SAMPLE_CAP, 40], 5, 64));
    expect(clusters.centroids).toHaveLength(2);
    expect(clusters.members[1]).toHaveLength(40);
  });

  it("samples a large collection, and still assigns and counts every member", () => {
    const over = KMEANS_SAMPLE_CAP + 40;
    const vectors = topics([over - 120, 120], 3, 64);
    const clusters = kmeansAuto(vectors);
    expect(clusters.topicOf.size).toBe(over);
    expect(clusters.centroids).toHaveLength(2);
    expect(clusters.members[1]?.every((key) => key.startsWith("t1-"))).toBe(
      true,
    );
    expect(clusters.members[1]).toHaveLength(120);
    expect(clusters.trials[0]?.smallestCluster).toBe(120);
    const again = kmeansAuto(new Map([...vectors].reverse()));
    expect(again.centroids.map((c) => Array.from(c.values))).toStrictEqual(
      clusters.centroids.map((c) => Array.from(c.values)),
    );
  });
});

describe("kmeansAuto — a topic left empty, and vectors in opposition", () => {
  const twoPoints = new Map([
    ...Array.from({ length: 6 }, (_, i): [string, EmbeddingVector] => [
      `a${String(i)}`,
      vec(1, 0),
    ]),
    ...Array.from({ length: 6 }, (_, i): [string, EmbeddingVector] => [
      `b${String(i)}`,
      vec(0, 1),
    ]),
  ]);

  it("reads a silhouette past an empty topic, and drops that topic", () => {
    const clusters = kmeansAuto(twoPoints, {
      kMax: 3,
      minClusterSize: 0,
      minGain: 0,
    });
    const three = clusters.trials.find((trial) => trial.k === 3);
    expect(three?.smallestCluster).toBe(0);
    expect(three?.silhouette).toBeCloseTo(1, 5);
    expect(clusters.centroids).toHaveLength(2);
    expect(clusters.members).toHaveLength(2);
  });

  it("answers a silhouette of exactly 0 when every member lands in one topic", () => {
    const same = new Map(
      Array.from({ length: 12 }, (_, i) => [`k${String(i)}`, vec(1, 2, 3)]),
    );
    expect(kmeansAuto(same).trials[0]?.silhouette).toBe(0);
  });

  it("keeps two topics in opposition, though their whole mean cancels out", () => {
    const opposed = new Map([
      ...Array.from({ length: 5 }, (_, i): [string, EmbeddingVector] => [
        `a${String(i)}`,
        vec(1, 0),
      ]),
      ...Array.from({ length: 5 }, (_, i): [string, EmbeddingVector] => [
        `b${String(i)}`,
        vec(-1, 0),
      ]),
    ]);
    expect(kmeansAuto(opposed).centroids).toHaveLength(2);
  });
});

describe("kmeansAuto — determinism", () => {
  it("answers the same bytes on two runs and in any input order, without Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const vectors = topics([20, 20, 10]);
    const first = kmeansAuto(vectors);
    const second = kmeansAuto(vectors);
    const reversed = kmeansAuto(new Map([...vectors].reverse()));
    const read = (clusters: typeof first): unknown => ({
      centroids: clusters.centroids.map((c) => Array.from(c.values)),
      members: clusters.members,
      topicOf: [...clusters.topicOf].sort(),
      trials: clusters.trials,
    });
    expect(read(second)).toStrictEqual(read(first));
    expect(read(reversed)).toStrictEqual(read(first));
    expect(random).not.toHaveBeenCalled();
  });

  it("pins the choices it makes on data with no clear answer", () => {
    // A change here is a change to the starts, the restarts or the passes. The figures
    // are this code's own, read on 2026-11-05: a fixed point, and no claim of quality.
    const trials = kmeansAuto(topics([60], 1)).trials.map((trial) => [
      trial.k,
      Number(trial.silhouette.toFixed(6)),
      trial.smallestCluster,
    ]);
    expect(trials).toStrictEqual(GOLDEN_TRIALS);
    const other = kmeansAuto(topics([60], 7)).trials;
    expect(
      other.map((trial) => Number(trial.silhouette.toFixed(6))),
    ).toStrictEqual([0.007913, 0.008113, -0.001078]);
  });

  it("takes its choices from the seed: another seed draws other starts", () => {
    const noise = topics([60], 7);
    const trialsOf = (seed: number): unknown =>
      kmeansAuto(noise, { seed }).trials;
    expect(trialsOf(1)).toStrictEqual(trialsOf(1));
    expect(trialsOf(2)).not.toStrictEqual(trialsOf(1));
  });
});

describe("labelCentroids", () => {
  const member = (
    workKey: string,
    fields: Partial<LabelledWork> = {},
  ): LabelledWork => ({ workKey, title: "Z", ...fields });
  const mesh = (
    term: string,
  ): NonNullable<LabelledWork["subjects"]>[number] => ({
    term,
    scheme: "mesh",
  });

  it("names each topic by its members' highest-weighted term", () => {
    const works = [
      member("a", { subjects: [mesh("Base Editing")] }),
      member("b", { subjects: [mesh("Base Editing")] }),
      member("c", { subjects: [mesh("Delivery Vectors")] }),
    ];
    expect(
      labelCentroids({ members: [["a", "b"], ["c"]] }, works, {
        "Delivery Vectors": 2,
        "Base Editing": 1,
      }),
    ).toStrictEqual(["Base Editing", "Delivery Vectors"]);
  });

  it("prefers the heavier of two terms a topic holds alike", () => {
    const works = [
      member("a", { subjects: [mesh("Light"), mesh("Heavy")] }),
      member("b", { subjects: [mesh("Other")] }),
    ];
    expect(
      labelCentroids({ members: [["a"], ["b"]] }, works, {
        Light: 1,
        Heavy: 2,
        Other: 1,
      }),
    ).toStrictEqual(["Heavy", "Other"]);
  });

  it("passes over a heavy term both topics hold, which tells them apart from nothing", () => {
    const works = [
      member("a", { subjects: [mesh("Shared"), mesh("One")] }),
      member("b", { subjects: [mesh("Shared"), mesh("Two")] }),
    ];
    expect(
      labelCentroids({ members: [["a"], ["b"]] }, works, {
        Shared: 9,
        One: 1,
        Two: 1,
      }),
    ).toStrictEqual(["One", "Two"]);
  });

  it("weighs a term by the share of a topic that holds it", () => {
    const works = [
      member("a", { subjects: [mesh("Rare")] }),
      member("b", { subjects: [mesh("Common")] }),
      member("c", { subjects: [mesh("Common")] }),
      member("d", { subjects: [mesh("Common")] }),
      member("e", { subjects: [mesh("Far")] }),
    ];
    expect(
      labelCentroids({ members: [["a", "b", "c", "d"], ["e"]] }, works, {
        Rare: 2,
        Common: 1,
        Far: 1,
      }),
    ).toStrictEqual(["Common", "Far"]);
  });

  it("lets a heavier term beat a lighter one a few more members hold", () => {
    const works = [
      member("a", { subjects: [mesh("Light"), mesh("Heavy")] }),
      member("b", { subjects: [mesh("Light"), mesh("Heavy")] }),
      member("c", { subjects: [mesh("Light"), mesh("Heavy")] }),
      member("d", { subjects: [mesh("Light")] }),
    ];
    expect(
      labelCentroids({ members: [["a", "b", "c", "d"]] }, works, {
        Light: 1,
        Heavy: 2,
      }),
    ).toStrictEqual(["Heavy"]);
  });

  it("does not give two topics one term, even when it tells each from the rest", () => {
    const works = [
      member("a", { subjects: [mesh("Same"), mesh("OnlyA")] }),
      member("b", { subjects: [mesh("Same"), mesh("OnlyB")] }),
      ...["c", "d", "e", "f"].map((key) =>
        member(key, { subjects: [mesh("Rest")] }),
      ),
    ];
    expect(
      labelCentroids({ members: [["a"], ["b"], ["c", "d", "e", "f"]] }, works, {
        Same: 9,
        OnlyA: 1,
        OnlyB: 1,
        Rest: 1,
      }),
    ).toStrictEqual(["Same", "OnlyB", "Rest"]);
  });

  it("gives two topics two labels", () => {
    const works = [
      member("a", { subjects: [mesh("One")] }),
      member("b", { subjects: [mesh("One"), mesh("Two")] }),
      member("c", { subjects: [mesh("One"), mesh("Two")] }),
    ];
    // k = 1 reads the whole collection, so the outside share is 0.
    expect(
      labelCentroids({ members: [["a", "b", "c"]] }, works, { One: 1, Two: 1 }),
    ).toStrictEqual(["One"]);
    const labels = labelCentroids(
      { members: [["a", "b"], ["c"]] },
      [
        member("a", { keywords: ["p"] }),
        member("b", { keywords: ["p"] }),
        member("c", { keywords: ["q"] }),
      ],
      { p: 1, q: 1 },
    );
    expect(new Set(labels).size).toBe(2);
  });

  it("does not reuse a label a larger topic took", () => {
    const works = [
      member("a", { subjects: [mesh("Same"), mesh("A")] }),
      member("b", { subjects: [mesh("Same"), mesh("A")] }),
      member("c", { subjects: [mesh("Same")] }),
      member("d", { subjects: [mesh("B")] }),
      member("e", { subjects: [mesh("Same")] }),
    ];
    const labels = labelCentroids(
      {
        members: [
          ["a", "b", "c"],
          ["d", "e"],
        ],
      },
      works,
      { Same: 5, A: 1, B: 9 },
    );
    expect(labels?.[1]).toBe("B");
    expect(new Set(labels).size).toBe(2);
  });

  it("reads keywords, and title words whole, through normalizeTitle", () => {
    const works = [
      member("a", { keywords: ["GENE-Drive"] }),
      member("b", { title: "Prime editing in vivo" }),
      member("c", { title: "Primed editings" }),
    ];
    expect(
      labelCentroids({ members: [["a"], ["b"], ["c"]] }, works, {
        "Gene Drive": 3,
        "prime editing": 2,
        primed: 1,
      }),
    ).toStrictEqual(["Gene Drive", "prime editing", "primed"]);
    expect(
      labelCentroids({ members: [["c"]] }, works, { "prime editing": 2 }),
    ).toBeUndefined();
  });

  it("reads a title's words whole, not inside longer ones", () => {
    const works = [member("a", { title: "Reprime editings" })];
    expect(
      labelCentroids({ members: [["a"]] }, works, { "prime editing": 1 }),
    ).toBeUndefined();
  });

  it("reads a subject only when it is MeSH", () => {
    const works = [
      member("a", { subjects: [{ term: "cs.LG", scheme: "arxiv-category" }] }),
    ];
    expect(
      labelCentroids({ members: [["a"]] }, works, { "cs.LG": 1 }),
    ).toBeUndefined();
  });

  it("answers nothing when any topic has no term, so the window numbers the groups", () => {
    const works = [member("a", { subjects: [mesh("One")] }), member("b")];
    expect(
      labelCentroids({ members: [["a"], ["b"]] }, works, { One: 1 }),
    ).toBeUndefined();
    expect(labelCentroids({ members: [] }, works, { One: 1 })).toBeUndefined();
  });

  it("does not count a member it has no record of", () => {
    expect(
      labelCentroids({ members: [["ghost"]] }, [], { One: 1 }),
    ).toBeUndefined();
  });

  it("breaks a tie by rankedTerms' order", () => {
    const works = [member("a", { keywords: ["b", "a"] })];
    expect(
      labelCentroids({ members: [["a"]] }, works, { b: 1, a: 1 }),
    ).toStrictEqual(["a"]);
  });
});

describe("selectSeeds — the score", () => {
  it("ranks by docs/05 §7.2's weights and this card's three scores", () => {
    const random = mulberry32(11);
    const works: CanonicalWork[] = [];
    const addedAt = new Map<string, number>();
    const centrality = new Map<string, number>();
    const expected = new Map<string, number>();
    for (let i = 0; i < 60; i += 1) {
      const key = `w${String(i)}`;
      const year = 2010 + Math.floor(random() * 17);
      const citations = Math.floor(random() * 2000);
      const central = random();
      const recent = random() < 0.5;
      works.push(
        work(key, {
          publishedDate: { year, iso: String(year) },
          citationCount: citations,
        }),
      );
      centrality.set(key, central);
      if (recent) addedAt.set(key, NOW - DAY);
      expected.set(
        key,
        0.4 * Math.exp(-(2026 - year) / 1.5) +
          0.25 * central +
          0.2 * (recent ? 1 : 0) +
          0.15 * Math.min(1, Math.log(1 + citations) / Math.log(1001)),
      );
    }
    const seeds = selectSeeds(
      works,
      addedAt,
      flatSpace({ centralityOf: (key) => centrality.get(key) ?? 0 }),
      { nowEpochMs: NOW, maxSeeds: 60 },
    );
    expect(keysOf(seeds)).toStrictEqual(
      [...expected.entries()].sort(([, a], [, b]) => b - a).map(([key]) => key),
    );
    expect(SEED_WEIGHTS).toStrictEqual({
      recency: 0.4,
      centrality: 0.25,
      addedRecently: 0.2,
      quality: 0.15,
    });
    expect(SEED_RECENCY_TAU_YEARS).toBe(1.5);
    expect(SEED_RECENTLY_ADDED_DAYS).toBe(90);
    expect(SEED_QUALITY_FULL_CITATIONS).toBe(1000);
  });

  it("reads 90 days as strictly within, from the addedAt passed in", () => {
    const edge = NOW - 90 * DAY;
    const seeds = selectSeeds(
      [work("a"), work("b"), work("c")],
      new Map([
        ["a", edge],
        ["b", edge + 1],
      ]),
      flatSpace(),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)[0]).toBe("b");
    expect(keysOf(seeds)).toStrictEqual(["b", "a", "c"]);
  });

  it("gives a future year no more than this year, and no year nothing", () => {
    const year = (value: number): Partial<CanonicalWork> => ({
      publishedDate: { year: value, iso: String(value) },
    });
    const seeds = selectSeeds(
      [
        work("none"),
        work("old", year(2020)),
        work("this", year(2026)),
        work("next", year(2030)),
      ],
      new Map(),
      flatSpace(),
      { nowEpochMs: NOW },
    );
    // "next" and "this" tie, so the smaller key leads.
    expect(keysOf(seeds)).toStrictEqual(["next", "this", "old", "none"]);
  });

  it("counts the year in UTC, whatever the machine's zone says", () => {
    const zone = process.env["TZ"];
    process.env["TZ"] = "Asia/Seoul";
    try {
      const nowInUtc2025 = Date.UTC(2025, 11, 31, 20);
      const seeds = selectSeeds(
        [
          work("a", { publishedDate: { year: 2025, iso: "2025" } }),
          work("b", { publishedDate: { year: 2026, iso: "2026" } }),
        ],
        new Map(),
        flatSpace(),
        { nowEpochMs: nowInUtc2025 },
      );
      // In UTC both have age 0 and tie; in Seoul "a" would be a year older.
      expect(keysOf(seeds)).toStrictEqual(["a", "b"]);
    } finally {
      if (zone === undefined) delete process.env["TZ"];
      else process.env["TZ"] = zone;
    }
  });

  it("caps quality at the full count, and reads no count or a negative one as 0", () => {
    const seeds = selectSeeds(
      [
        work("b", { citationCount: 1000 }),
        work("a", { citationCount: 50000 }),
        work("c", { citationCount: 10 }),
        work("d"),
        work("e", { citationCount: -5 }),
      ],
      new Map(),
      flatSpace(),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not let a negative count spoil the score", () => {
    const seeds = selectSeeds(
      [work("x", { citationCount: 10 }), work("a", { citationCount: -5 })],
      new Map(),
      flatSpace(),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(["x", "a"]);
  });

  it("does not read the machine's clock", () => {
    const clock = vi.spyOn(Date, "now");
    selectSeeds([work("a")], new Map(), flatSpace(), { nowEpochMs: NOW });
    expect(clock).not.toHaveBeenCalled();
  });
});

describe("selectSeeds — who can be a seed", () => {
  it("leaves out a work no request could name", () => {
    const seeds = selectSeeds(
      [
        work("a", { ids: {} }),
        work("b", { ids: { url: "https://example.org/x" } }),
        work("c"),
      ],
      new Map(),
      flatSpace(),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(["c"]);
  });

  it("counts a work two items hold once, the same way in any order", () => {
    const low = work("a", { citationCount: 1, ids: { pmid: "1" as Pmid } });
    const high = work("a", { citationCount: 9, ids: { pmid: "2" as Pmid } });
    const none = work("a", { ids: { pmid: "3" as Pmid } });
    for (const order of [
      [low, high, none],
      [none, high, low],
      [high, low, none],
    ]) {
      expect(
        keysOf(selectSeeds(order, new Map(), flatSpace(), { nowEpochMs: NOW })),
      ).toStrictEqual(["2"]);
    }
    const left = work("a", { ids: { pmid: "4" as Pmid } });
    const right = work("a", { ids: { pmid: "5" as Pmid } });
    for (const order of [
      [left, right],
      [right, left],
    ]) {
      expect(
        keysOf(selectSeeds(order, new Map(), flatSpace(), { nowEpochMs: NOW })),
      ).toStrictEqual(["4"]);
    }
  });

  it("hands over the work's identifiers whole, for each generator to choose from", () => {
    const ids = { pmid: "7" as Pmid, doi: "10.1/x" } as ExternalIds;
    const seeds = selectSeeds([work("a", { ids })], new Map(), flatSpace(), {
      nowEpochMs: NOW,
    });
    expect(seeds).toStrictEqual([{ ids }]);
  });
});

describe("selectSeeds — how many", () => {
  const many = (count: number): CanonicalWork[] =>
    Array.from({ length: count }, (_, i) =>
      work(`w${String(i).padStart(3, "0")}`),
    );

  it("stops at RECOMMEND_MAX_POSITIVES", () => {
    expect(
      selectSeeds(many(40), new Map(), flatSpace(), { nowEpochMs: NOW }),
    ).toHaveLength(RECOMMEND_MAX_POSITIVES);
  });

  it("takes everything from a small collection", () => {
    expect(
      selectSeeds(many(5), new Map(), flatSpace(), { nowEpochMs: NOW }),
    ).toHaveLength(5);
  });

  it("follows a smaller ceiling, and gives nothing for none", () => {
    expect(
      selectSeeds(many(40), new Map(), flatSpace(), {
        nowEpochMs: NOW,
        maxSeeds: 3,
      }),
    ).toHaveLength(3);
    expect(
      selectSeeds(many(40), new Map(), flatSpace(), {
        nowEpochMs: NOW,
        maxSeeds: 0,
      }),
    ).toHaveLength(0);
  });

  it("states the floor and the most negatives", () => {
    expect(MIN_SEEDS).toBe(10);
    expect(MAX_NEGATIVES).toBe(10);
  });
});

describe("selectSeeds — diversification", () => {
  const many = (count: number): CanonicalWork[] =>
    Array.from({ length: count }, (_, i) =>
      work(`w${String(i).padStart(3, "0")}`),
    );

  it("skips a work at or above the cut, and keeps one just under it", () => {
    const seeds = selectSeeds(
      [work("a"), work("b"), work("c")],
      new Map(),
      flatSpace({
        diversityCut: 0.5,
        similarity: (x, y) => {
          const pair = [x, y].sort().join("");
          return pair === "ab" ? 0.5 : pair === "ac" ? 0.4999 : 0;
        },
      }),
      { nowEpochMs: NOW },
    );
    // Back under the floor, "b" returns, so it is last and not second.
    expect(keysOf(seeds)).toStrictEqual(["a", "c", "b"]);
  });

  it("compares a work with every seed held, not only the first", () => {
    const seeds = selectSeeds(
      [work("a"), work("b"), work("c")],
      new Map(),
      flatSpace({
        similarity: (x, y) => ([x, y].sort().join("") === "bc" ? 0.9 : 0),
      }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(["a", "b", "c"]);
    const ten = many(30);
    const held = selectSeeds(
      ten,
      new Map(),
      flatSpace({
        similarity: (x, y) => ([x, y].sort().join("") === "w001w005" ? 0.9 : 0),
      }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(held)).not.toContain("w005");
    expect(held).toHaveLength(RECOMMEND_MAX_POSITIVES);
  });

  it("never skips on a pair it cannot judge", () => {
    const seeds = selectSeeds(
      many(12),
      new Map(),
      flatSpace({ similarity: () => undefined }),
      { nowEpochMs: NOW },
    );
    expect(seeds).toHaveLength(12);
  });

  it("brings skipped works back in score order up to the floor, and no further", () => {
    // Everything is too close to everything, so only the floor's fill takes any.
    const seeds = selectSeeds(
      many(30),
      new Map(),
      flatSpace({ similarity: () => 1 }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(
      Array.from(
        { length: MIN_SEEDS },
        (_, i) => `w${String(i).padStart(3, "0")}`,
      ),
    );
  });

  it("brings none back above a ceiling lower than the floor", () => {
    const seeds = selectSeeds(
      many(30),
      new Map(),
      flatSpace({ similarity: () => 1 }),
      { nowEpochMs: NOW, maxSeeds: 3 },
    );
    expect(keysOf(seeds)).toStrictEqual(["w000", "w001", "w002"]);
  });

  it("takes a skipped work back only when the floor is not met", () => {
    const seeds = selectSeeds(
      many(30),
      new Map(),
      flatSpace({
        similarity: (x, y) => ([x, y].sort().join("") === "w000w001" ? 1 : 0),
      }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).not.toContain("w001");
    expect(seeds).toHaveLength(RECOMMEND_MAX_POSITIVES);
  });
});

describe("selectSeeds — topics", () => {
  const twoTopics = (a: number, b: number): CanonicalWork[] => [
    ...Array.from({ length: a }, (_, i) =>
      work(`a${String(i).padStart(3, "0")}`),
    ),
    ...Array.from({ length: b }, (_, i) =>
      work(`b${String(i).padStart(3, "0")}`),
    ),
  ];
  const topicSpace = flatSpace({
    topicOf: (key) => (key.startsWith("a") ? 0 : 1),
  });

  it("takes seeds in turn from each topic, so a small topic is not crowded out", () => {
    const seeds = selectSeeds(twoTopics(30, 6), new Map(), topicSpace, {
      nowEpochMs: NOW,
    });
    expect(seeds).toHaveLength(RECOMMEND_MAX_POSITIVES);
    expect(seeds.slice(0, 12).map((seed) => seed.topicIndex)).toStrictEqual([
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    ]);
    expect(seeds.slice(12).map((seed) => seed.topicIndex)).toStrictEqual([
      0, 0, 0,
    ]);
    expect(keysOf(seeds).slice(0, 4)).toStrictEqual([
      "a000",
      "b000",
      "a001",
      "b001",
    ]);
  });

  it("goes through topics by index, not by arrival", () => {
    const seeds = selectSeeds(
      twoTopics(3, 3),
      new Map([
        ["b000", NOW],
        ["b001", NOW],
        ["b002", NOW],
      ]),
      topicSpace,
      { nowEpochMs: NOW },
    );
    expect(seeds[0]?.topicIndex).toBe(0);
  });

  it("stops at the ceiling in the middle of a turn", () => {
    const seeds = selectSeeds(twoTopics(5, 5), new Map(), topicSpace, {
      nowEpochMs: NOW,
      maxSeeds: 3,
    });
    expect(seeds.map((seed) => seed.topicIndex)).toStrictEqual([0, 1, 0]);
  });

  it("brings skipped works back by score, not by the turn that skipped them", () => {
    const seeds = selectSeeds(
      twoTopics(12, 12),
      new Map(),
      flatSpace({ topicOf: topicSpace.topicOf, similarity: () => 1 }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(
      Array.from(
        { length: MIN_SEEDS },
        (_, i) => `a${String(i).padStart(3, "0")}`,
      ),
    );
  });

  it("takes a work with no topic only after the topics run out, with no topicIndex", () => {
    const works = [
      work("zzz", { citationCount: 1000 }),
      work("a000"),
      work("b000"),
    ];
    const seeds = selectSeeds(
      works,
      new Map(),
      flatSpace({
        topicOf: (key) =>
          key === "zzz" ? undefined : key.startsWith("a") ? 0 : 1,
      }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).toStrictEqual(["a000", "b000", "zzz"]);
    expect(seeds[2]).not.toHaveProperty("topicIndex");
    expect(seeds[0]).toHaveProperty("topicIndex", 0);
  });

  it("does not take a work with no topic when the topics fill the ceiling", () => {
    const works = [...twoTopics(10, 10), work("zzz", { citationCount: 1000 })];
    const seeds = selectSeeds(
      works,
      new Map(),
      flatSpace({
        topicOf: (key) =>
          key === "zzz" ? undefined : key.startsWith("a") ? 0 : 1,
      }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds)).not.toContain("zzz");
  });

  it("keeps the turn when a topic's next work is too close", () => {
    const seeds = selectSeeds(
      twoTopics(3, 3),
      new Map(),
      flatSpace({
        topicOf: topicSpace.topicOf,
        similarity: (x, y) => ([x, y].sort().join("") === "a000b000" ? 1 : 0),
      }),
      { nowEpochMs: NOW },
    );
    expect(keysOf(seeds).slice(0, 2)).toStrictEqual(["a000", "b001"]);
  });
});

describe("specterSeedSpace", () => {
  it("reads centrality against the member's own centroid, stretched across the collection", () => {
    const vectors = new Map([
      ["near", vec(1, 0.01)],
      ["mid", vec(1, 0.5)],
      ["far", vec(1, 2)],
    ]);
    const space = specterSeedSpace(vectors, {
      centroids: [vec(1, 0)],
      topicOf: new Map([
        ["near", 0],
        ["mid", 0],
        ["far", 0],
      ]),
    });
    expect(space.centralityOf("near")).toBe(1);
    expect(space.centralityOf("far")).toBe(0);
    const middle = space.centralityOf("mid");
    const cosNear = 1 / Math.hypot(1, 0.01);
    const cosMid = 1 / Math.hypot(1, 0.5);
    const cosFar = 1 / Math.hypot(1, 2);
    expect(middle).toBeCloseTo((cosMid - cosFar) / (cosNear - cosFar), 5);
    expect(space.space).toBe("specter_v2");
    expect(space.diversityCut).toBe(SPECTER_DIVERSITY_CUT);
    expect(SPECTER_DIVERSITY_CUT).toBe(0.92);
  });

  it("compares with the nearest of the member's own topic, not the first centroid", () => {
    const vectors = new Map([
      ["a", vec(1, 0)],
      ["b", vec(0, 1)],
      ["c", vec(0.7, 1)],
    ]);
    const space = specterSeedSpace(vectors, {
      centroids: [vec(1, 0), vec(0, 1)],
      topicOf: new Map([
        ["a", 0],
        ["b", 1],
        ["c", 1],
      ]),
    });
    expect(space.centralityOf("a")).toBe(1);
    expect(space.centralityOf("b")).toBe(1);
    expect(space.centralityOf("c")).toBe(0);
  });

  it("answers 0 for a work with no vector, and for a collection all alike", () => {
    const vectors = new Map([
      ["a", vec(1, 0)],
      ["b", vec(1, 0)],
    ]);
    const space = specterSeedSpace(vectors, {
      centroids: [vec(1, 0)],
      topicOf: new Map([
        ["a", 0],
        ["b", 0],
        ["ghost", 0],
      ]),
    });
    expect(space.centralityOf("a")).toBe(0);
    expect(space.centralityOf("ghost")).toBe(0);
    expect(space.centralityOf("unknown")).toBe(0);
  });

  it("says which topic, and judges a pair by raw cosine or not at all", () => {
    const space = specterSeedSpace(
      new Map([
        ["a", vec(1, 0)],
        ["b", vec(0, 1)],
      ]),
      { centroids: [vec(1, 0)], topicOf: new Map([["a", 0]]) },
    );
    expect(space.topicOf("a")).toBe(0);
    expect(space.topicOf("b")).toBeUndefined();
    expect(space.similarity("a", "a")).toBeCloseTo(1, 5);
    expect(space.similarity("a", "b")).toBeCloseTo(0, 5);
    expect(space.similarity("a", "none")).toBeUndefined();
    expect(space.similarity("none", "a")).toBeUndefined();
  });
});

describe("lexicalSeedSpace", () => {
  const onTopic = "alpha beta gamma delta";
  const works = [
    work("core", { title: `${onTopic} epsilon` }),
    work("side", { title: `${onTopic} zeta` }),
    work("near", { title: "alpha beta eta" }),
    work("far", { title: "unrelated words entirely here" }),
    work("empty", { title: "" }),
  ];

  it("reads centrality against the collection's mean, stretched", () => {
    const space = lexicalSeedSpace(works);
    expect(space.centralityOf("empty")).toBe(0);
    expect(space.centralityOf("core")).toBeGreaterThan(
      space.centralityOf("near"),
    );
    expect(space.centralityOf("near")).toBeGreaterThan(0);
    const all = works.map((w) => space.centralityOf(w.workKey));
    expect(Math.max(...all)).toBe(1);
    expect(space.centralityOf("unknown")).toBe(0);
  });

  it("computes centrality as the dot with the mean, across the whole collection", () => {
    const space = lexicalSeedSpace(works);
    const words = lexicalSpace(works);
    const vectors = works.map((w) => words.vector(w));
    const mean = new Map<string, number>();
    for (const vector of vectors) {
      vector.terms.forEach((term, index) => {
        mean.set(term, (mean.get(term) ?? 0) + (vector.weights[index] ?? 0));
      });
    }
    const raw = vectors.map((vector) =>
      vector.terms.reduce(
        (sum, term, index) =>
          sum + (vector.weights[index] ?? 0) * (mean.get(term) ?? 0),
        0,
      ),
    );
    const low = Math.min(...raw);
    const high = Math.max(...raw);
    works.forEach((w, index) => {
      expect(space.centralityOf(w.workKey)).toBeCloseTo(
        ((raw[index] as number) - low) / (high - low),
        9,
      );
    });
  });

  it("names itself, has no topics, and uses this space's own cut", () => {
    const space = lexicalSeedSpace(works);
    expect(space.space).toBe("lexical");
    expect(space.diversityCut).toBe(LEXICAL_DIVERSITY_CUT);
    expect(LEXICAL_DIVERSITY_CUT).toBe(0.45);
    expect(space.topicOf("core")).toBeUndefined();
  });

  it("judges a pair by word overlap, or not at all", () => {
    const space = lexicalSeedSpace(works);
    expect(space.similarity("core", "core")).toBeCloseTo(1, 9);
    expect(space.similarity("core", "far")).toBe(0);
    expect(space.similarity("core", "none")).toBeUndefined();
    expect(space.similarity("none", "core")).toBeUndefined();
  });

  it("stops two versions of one paper and keeps different papers", () => {
    const abstract = (start: number): string =>
      Array.from({ length: 60 }, (_, i) => `word${String(start + i)}`).join(
        " ",
      );
    const collection = [
      work("published", {
        title: "A long shared title about one thing",
        abstract: abstract(0),
      }),
      work("preprint", {
        title: "A long shared title about one thing",
        abstract: `${abstract(0)} added closing sentence`,
      }),
      work("other", { title: "Something different", abstract: abstract(500) }),
      ...Array.from({ length: 9 }, (_, i) =>
        work(`more${String(i)}`, {
          title: `Paper number${String(i)}`,
          abstract: abstract(1000 + 100 * i),
        }),
      ),
    ];
    const seeds = selectSeeds(
      collection,
      new Map(),
      lexicalSeedSpace(collection),
      { nowEpochMs: NOW, maxSeeds: 11 },
    );
    const keys = keysOf(seeds);
    expect(keys).toHaveLength(11);
    expect(keys.includes("published") && keys.includes("preprint")).toBe(false);
    expect(keys).toContain("other");
  });
});

describe("recentNegatives", () => {
  function rejectedRow(
    workKey: string,
    ids: Partial<ExternalIds>,
  ): Recommendation {
    return {
      id: recommendationId(collectionProfileId(1, "COLLKEY1"), workKey),
      profileId: collectionProfileId(1, "COLLKEY1"),
      work: work(workKey, { ids: ids as ExternalIds }),
      score: 0.5,
      signals: {
        similarity: 0,
        recency: 0,
        velocity: 0,
        novelty: 0,
        authorAffinity: 0,
        venueAffinity: 0,
        generatorAgreement: 0,
        coupling: 0,
      },
      similaritySpace: "lexical",
      reasons: [],
      discoveredVia: [{ sourceId: "pubmed", strategy: "similar" }],
      generatedAtEpochMs: NOW,
    };
  }

  it("asks the store for this collection's newest 10, as identifiers, and leaves out a row with none", async () => {
    const listRejected = vi.fn(() =>
      Promise.resolve([
        rejectedRow("a", { pmid: "1" as Pmid }),
        rejectedRow("b", {}),
        rejectedRow("c", { pmid: "3" as Pmid }),
      ]),
    );
    await expect(
      recentNegatives({ listRejected }, "1:COLLKEY1"),
    ).resolves.toStrictEqual([{ pmid: "1" }, { pmid: "3" }]);
    expect(listRejected).toHaveBeenCalledWith("1:COLLKEY1", 10);
  });

  it("reads the shipped store: newest first, 10 at most, this collection only", async () => {
    const connection = sqliteConnection();
    await runMigrations(connection);
    const store = createRecommendationStore(connection);
    const profileId = collectionProfileId(1, "COLLKEY1");
    for (let i = 0; i < 12; i += 1) {
      const key = `k${String(i)}`;
      const row = rejectedRow(key, { pmid: String(i) as Pmid });
      await store.put(row);
      await store.reject(row.id, 1000 + i);
    }
    const elsewhere = collectionProfileId(1, "COLLKEY2");
    await store.put({
      ...rejectedRow("x", { pmid: "99" as Pmid }),
      id: recommendationId(elsewhere, "x"),
      profileId: elsewhere,
    });
    await store.reject(recommendationId(elsewhere, "x"), 5000);
    const notRejected = rejectedRow("kept", { pmid: "77" as Pmid });
    await store.put(notRejected);

    const negatives = await recentNegatives(store, profileId);
    expect(negatives.map((ids) => ids.pmid)).toStrictEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map(String),
    );
  });

  it("warns with no paper in the line and sends none when the store cannot be read", async () => {
    const logger = fakeLogger();
    const failing = {
      listRejected: () => Promise.reject(new StorageError("broken row")),
    };
    await expect(
      recentNegatives(failing, "1:COLLKEY1", logger),
    ).resolves.toStrictEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "recommend: dismissals could not be read; sending none",
      { messageKey: "rh-error-storage" },
    );
    await expect(recentNegatives(failing, "1:COLLKEY1")).resolves.toStrictEqual(
      [],
    );
  });

  it("does not hide a programming error", async () => {
    const failing = {
      listRejected: () => Promise.reject(new RangeError("bad limit")),
    };
    await expect(recentNegatives(failing, "1:COLLKEY1")).rejects.toThrow(
      RangeError,
    );
  });
});

describe("withTopicsAndSeeds", () => {
  /** A two-topic collection whose titles say which topic each paper is. */
  function twoTopicCollection(): {
    readonly works: CanonicalWork[];
    readonly vectors: Map<string, EmbeddingVector>;
    readonly termWeights: Record<string, number>;
  } {
    const vectors = topics([18, 12]);
    const works = [...vectors.keys()].map((key) =>
      work(key, {
        title: key.startsWith("t0-")
          ? "Base editing outcomes"
          : "Delivery vectors compared",
        publishedDate: { year: 2024, iso: "2024" },
      }),
    );
    return {
      works,
      vectors,
      termWeights: { "base editing": 1, "delivery vectors": 2 },
    };
  }

  it("yields k = 2 and seeds from both topics on a two-topic collection", () => {
    const { works, vectors, termWeights } = twoTopicCollection();
    const result = withTopicsAndSeeds(profile({ termWeights }), {
      works,
      addedAt: new Map(),
      vectors,
      nowEpochMs: NOW,
    });
    expect(result.centroids).toHaveLength(2);
    expect(result.centroids[0]).toHaveLength(DIM);
    expect(result.embeddingModel).toBe("specter_v2");
    expect(result.embeddingDim).toBe(768);
    expect(result.centroidLabels).toStrictEqual([
      "base editing",
      "delivery vectors",
    ]);
    expect(result.seeds).toHaveLength(RECOMMEND_MAX_POSITIVES);
    const topicsSeeded = result.seeds.map((seed) => seed.topicIndex);
    expect(topicsSeeded.filter((topic) => topic === 0)).toHaveLength(8);
    expect(topicsSeeded.filter((topic) => topic === 1)).toHaveLength(7);
    for (const seed of result.seeds) {
      const key = seed.ids.pmid as string;
      expect(seed.topicIndex).toBe(key.startsWith("t0-") ? 0 : 1);
    }
    expect(result.seeds.slice(0, 10).map((s) => s.topicIndex)).toContain(1);
  });

  it("agrees on two runs and in any order, without Math.random, byte for byte", () => {
    const random = vi.spyOn(Math, "random");
    const { works, vectors, termWeights } = twoTopicCollection();
    const input = {
      addedAt: new Map([["t1-001", NOW - DAY]]),
      nowEpochMs: NOW,
    };
    const start = profile({ termWeights });
    const first = withTopicsAndSeeds(start, { ...input, works, vectors });
    const second = withTopicsAndSeeds(start, { ...input, works, vectors });
    const shuffled = withTopicsAndSeeds(start, {
      ...input,
      works: [...works].reverse(),
      vectors: new Map([...vectors].reverse()),
    });
    expect(second).toStrictEqual(first);
    expect(shuffled).toStrictEqual(first);
    expect(random).not.toHaveBeenCalled();
  });

  it("stores and reads back through the shipped store, with its model and length", async () => {
    const { works, vectors, termWeights } = twoTopicCollection();
    const connection = sqliteConnection();
    await runMigrations(connection);
    const store = createCollectionProfileStore(connection);
    const built = withTopicsAndSeeds(profile({ termWeights }), {
      works,
      addedAt: new Map(),
      vectors,
      nowEpochMs: NOW,
    });
    const written = await persistProfile(store, built);
    const read = await store.get(built.id);
    expect(read?.centroids).toStrictEqual(built.centroids);
    expect(written.centroids).toStrictEqual(built.centroids);
    expect(read?.seeds).toStrictEqual(built.seeds);
    expect(read?.centroidLabels).toStrictEqual(built.centroidLabels);
    expect(read?.embeddingModel).toBe("specter_v2");
    expect(read?.embeddingDim).toBe(768);
  });

  it.each([
    ["no vectors at all", undefined],
    ["a keyed run that got none", new Map<string, EmbeddingVector>()],
  ])(
    "is on the lexical space with %s: no centroids, no labels, no model",
    (_name, vectors) => {
      const works = Array.from({ length: 12 }, (_, i) =>
        work(`w${String(i)}`, { title: `Words of paper ${String(i)}` }),
      );
      const result = withTopicsAndSeeds(
        profile({
          termWeights: { words: 1 },
          centroids: [[1, 0]],
          centroidLabels: ["old"],
          embeddingModel: "specter_v2",
          embeddingDim: 2,
        }),
        {
          works,
          addedAt: new Map(),
          ...(vectors !== undefined && { vectors }),
          nowEpochMs: NOW,
        },
      );
      expect(result.centroids).toStrictEqual([]);
      expect(result).not.toHaveProperty("centroidLabels");
      expect(result).not.toHaveProperty("embeddingModel");
      expect(result).not.toHaveProperty("embeddingDim");
      expect(result.seeds).toHaveLength(12);
      for (const seed of result.seeds) {
        expect(seed).not.toHaveProperty("topicIndex");
      }
    },
  );

  it("replaces labels it cannot make again, so a window numbers the groups", () => {
    const { works, vectors } = twoTopicCollection();
    const result = withTopicsAndSeeds(
      profile({ termWeights: {}, centroidLabels: ["old"] }),
      { works, addedAt: new Map(), vectors, nowEpochMs: NOW },
    );
    expect(result.centroids).toHaveLength(2);
    expect(result).not.toHaveProperty("centroidLabels");
  });

  it("does not read a vector of a work outside the collection", () => {
    const { works, vectors, termWeights } = twoTopicCollection();
    const members = works.filter((w) => w.workKey.startsWith("t0-"));
    const result = withTopicsAndSeeds(profile({ termWeights }), {
      works: members,
      addedAt: new Map(),
      vectors,
      nowEpochMs: NOW,
    });
    expect(result.centroids).toHaveLength(1);
  });

  it("stays on SPECTER2 with some vectors, and a member with none has no topic", () => {
    const { works, vectors, termWeights } = twoTopicCollection();
    const missing = "t0-000";
    const partial = new Map(vectors);
    partial.delete(missing);
    const small = works.filter(
      (w) => w.workKey === missing || w.workKey.startsWith("t1-"),
    );
    const result = withTopicsAndSeeds(profile({ termWeights }), {
      works: small,
      addedAt: new Map([[missing, NOW]]),
      vectors: partial,
      nowEpochMs: NOW,
    });
    expect(result.embeddingModel).toBe("specter_v2");
    expect(result.centroids).toHaveLength(1);
    const last = result.seeds[result.seeds.length - 1];
    expect(last?.ids.pmid).toBe(missing);
    expect(last).not.toHaveProperty("topicIndex");
    expect(result.seeds[0]).toHaveProperty("topicIndex", 0);
  });

  it("keeps everything else on the profile, and holds no negatives", () => {
    const { works, vectors, termWeights } = twoTopicCollection();
    const start = profile({
      termWeights,
      userEdits: { removedTerms: ["x"], addedTerms: [] },
      origin: "llm",
      narrative: "kept",
    });
    const result = withTopicsAndSeeds(start, {
      works,
      addedAt: new Map(),
      vectors,
      nowEpochMs: NOW,
    });
    expect(result).toMatchObject({
      id: start.id,
      termWeights,
      userEdits: start.userEdits,
      origin: "llm",
      narrative: "kept",
    });
    expect(Object.keys(result).join(" ")).not.toMatch(/negative/i);
  });

  it("logs counts and silhouettes only, for P5-T30 to read", () => {
    const { works, vectors, termWeights } = twoTopicCollection();
    const logger = fakeLogger();
    withTopicsAndSeeds(profile({ termWeights }), {
      works,
      addedAt: new Map(),
      vectors,
      nowEpochMs: NOW,
      logger,
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message, context] = logger.info.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe("recommend: topics and seeds");
    expect(context).toMatchObject({
      space: "specter_v2",
      vectors: 30,
      members: 30,
      k: 2,
      seeds: RECOMMEND_MAX_POSITIVES,
    });
    expect((context["trials"] as unknown[]).length).toBe(3);
    expect(JSON.stringify(context)).not.toMatch(/t0-|base editing/);
  });
});

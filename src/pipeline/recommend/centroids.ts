/**
 * A collection's topics: k-means over SPECTER2 vectors, k chosen by silhouette, and
 * a name for each (`docs/05` §7.2 "Multi-topic collections", `P5-T21`). The dated
 * note at the end of that section holds the decisions and says which values are
 * starting values; this header does not repeat them.
 *
 * **Callers.** `withTopicsAndSeeds` in `seeds.ts` calls {@link kmeansAuto} and
 * {@link labelCentroids}; `recommendPipeline.ts` (`P5-T25`) calls that.
 * Nothing is constructed at run time but the values these functions return. There are
 * no centroids on the lexical space (`docs/07` §5.2), so nothing here reads it.
 *
 * **Deterministic.** Members are sorted by work key before anything else, and every
 * random choice comes from {@link mulberry32}, seeded. `Math.random` is not used.
 *
 * **Time.** Synchronous, on Zotero's main thread when `P5-T25` calls it; `docs/05`'s
 * note records what was measured under Node.
 */

import type { CanonicalWork } from "../../model/canonicalWork";
import { normalizeTitle } from "../../sources/shared/dedupe";
import {
  cosine,
  normalizeEmbedding,
  type EmbeddingVector,
} from "../shared/embeddings";

import { MESH_SCHEME, rankedTerms } from "./profile";

/** What {@link kmeansAuto} can be told. */
export interface KmeansAutoOptions {
  /** The most topics. */
  readonly kMax: number;
  /** A k with a smaller cluster is not taken. */
  readonly minClusterSize: number;
  /** How much a k's silhouette must beat the k held so far by. */
  readonly minGain: number;
  /** The generator's seed. */
  readonly seed: number;
}

/** The fixed seed: two runs on one input must agree. */
export const KMEANS_SEED = 0x5eed;

/** `docs/05` §7.2's values, unmeasured on real vectors, and {@link KMEANS_SEED}. */
export const KMEANS_AUTO_DEFAULTS: KmeansAutoOptions = {
  kMax: 4,
  minClusterSize: 5,
  minGain: 0.08,
  seed: KMEANS_SEED,
};

/** Fits per k; the one with the highest total cosine is kept. A starting value. */
export const KMEANS_RESTARTS = 3;
/** Passes per fit. A starting value. */
export const KMEANS_MAX_PASSES = 50;
/** The most members the fit and the silhouette read. A starting value, for time. */
export const KMEANS_SAMPLE_CAP = 600;

/** One k that was tried, for the log `P5-T30` reads. */
export interface KmeansTrial {
  readonly k: number;
  readonly silhouette: number;
  readonly smallestCluster: number;
}

/** What {@link kmeansAuto} found. Constructed only there. */
export interface TopicClusters {
  /** Unit length, largest topic first. `CollectionProfile.centroids` is this order. */
  readonly centroids: readonly EmbeddingVector[];
  /** Work keys of each centroid, sorted, in the order of {@link centroids}. */
  readonly members: readonly (readonly string[])[];
  /** Work key to its index in {@link centroids}. */
  readonly topicOf: ReadonlyMap<string, number>;
  /** The k above 1 that were tried. */
  readonly trials: readonly KmeansTrial[];
}

/**
 * A small seeded generator (mulberry32). Caller: {@link kmeansAuto}.
 *
 * @param seed - any number; only its low 32 bits count
 * @returns a function answering in [0, 1), the same sequence for the same seed
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The unit mean of these points, or `undefined` when they cancel out or are none. */
function unitMean(
  points: readonly EmbeddingVector[],
  model: string,
): EmbeddingVector | undefined {
  const first = points[0];
  if (first === undefined) return undefined;
  const sum = new Float64Array(first.values.length);
  for (const point of points) {
    for (let i = 0; i < sum.length; i += 1) {
      sum[i] = (sum[i] as number) + (point.values[i] as number);
    }
  }
  const values = normalizeEmbedding(Array.from(sum));
  return values === undefined ? undefined : { model, values };
}

/** The centroid of highest cosine per point; a tie goes to the lower index. */
function assign(
  points: readonly EmbeddingVector[],
  centroids: readonly EmbeddingVector[],
): Int32Array {
  const assignment = new Int32Array(points.length);
  points.forEach((point, index) => {
    let best = 0;
    let bestCosine = -Infinity;
    centroids.forEach((centroid, topic) => {
      const value = cosine(point, centroid);
      if (value > bestCosine) {
        best = topic;
        bestCosine = value;
      }
    });
    assignment[index] = best;
  });
  return assignment;
}

/** The new centroid of each topic; an empty or cancelling topic keeps its old one. */
function updated(
  points: readonly EmbeddingVector[],
  assignment: Int32Array,
  centroids: readonly EmbeddingVector[],
): readonly EmbeddingVector[] {
  return centroids.map((centroid, topic) => {
    const own = points.filter((_, index) => assignment[index] === topic);
    return unitMean(own, centroid.model) ?? centroid;
  });
}

/** k-means++: each next start is drawn by its squared distance from the starts so far. */
function initialCentroids(
  points: readonly EmbeddingVector[],
  k: number,
  random: () => number,
): readonly EmbeddingVector[] {
  const centroids = [
    points[Math.floor(random() * points.length)] as EmbeddingVector,
  ];
  while (centroids.length < k) {
    const weights = points.map((point) => {
      let nearest = Infinity;
      for (const centroid of centroids) {
        nearest = Math.min(nearest, 1 - cosine(point, centroid));
      }
      return nearest * nearest;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = random() * total;
    // All at distance 0 means every point is a start already: the last will do.
    let pick = 0;
    for (let i = 0; i < weights.length; i += 1) {
      draw -= weights[i] as number;
      pick = i;
      if (draw < 0) break;
    }
    centroids.push(points[pick] as EmbeddingVector);
  }
  return centroids;
}

interface Fit {
  readonly centroids: readonly EmbeddingVector[];
  readonly assignment: Int32Array;
  readonly totalCosine: number;
}

function fitOnce(
  points: readonly EmbeddingVector[],
  k: number,
  random: () => number,
): Fit {
  let centroids = initialCentroids(points, k, random);
  let assignment = assign(points, centroids);
  for (let pass = 0; pass < KMEANS_MAX_PASSES; pass += 1) {
    const nextCentroids = updated(points, assignment, centroids);
    const nextAssignment = assign(points, nextCentroids);
    const settled = nextAssignment.every(
      (topic, index) => topic === assignment[index],
    );
    centroids = nextCentroids;
    assignment = nextAssignment;
    if (settled) break;
  }
  let totalCosine = 0;
  points.forEach((point, index) => {
    const centroid = centroids[assignment[index] as number] as EmbeddingVector;
    totalCosine += cosine(point, centroid);
  });
  return { centroids, assignment, totalCosine };
}

function bestFit(
  points: readonly EmbeddingVector[],
  k: number,
  random: () => number,
): Fit {
  let best = fitOnce(points, k, random);
  for (let restart = 1; restart < KMEANS_RESTARTS; restart += 1) {
    const fit = fitOnce(points, k, random);
    if (fit.totalCosine > best.totalCosine) best = fit;
  }
  return best;
}

/** `1 − cosine` of every pair, row-major. Computed once: every k reads the same table. */
function pairwiseDistances(points: readonly EmbeddingVector[]): Float32Array {
  const n = points.length;
  const table = new Float32Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const distance =
        1 - cosine(points[i] as EmbeddingVector, points[j] as EmbeddingVector);
      table[i * n + j] = distance;
      table[j * n + i] = distance;
    }
  }
  return table;
}

/** The mean silhouette: a member alone in its cluster, or with no other cluster, is 0. */
function silhouetteOf(
  table: Float32Array,
  n: number,
  assignment: Int32Array,
  k: number,
): number {
  const sizes = new Int32Array(k);
  for (const topic of assignment) sizes[topic] = (sizes[topic] as number) + 1;
  let total = 0;
  const sums = new Float64Array(k);
  for (let i = 0; i < n; i += 1) {
    sums.fill(0);
    for (let j = 0; j < n; j += 1) {
      const topic = assignment[j] as number;
      sums[topic] = (sums[topic] as number) + (table[i * n + j] as number);
    }
    const own = assignment[i] as number;
    const ownSize = sizes[own] as number;
    if (ownSize < 2) continue;
    const within = (sums[own] as number) / (ownSize - 1);
    let nearest = Infinity;
    for (let topic = 0; topic < k; topic += 1) {
      const size = sizes[topic] as number;
      if (topic !== own && size > 0) {
        nearest = Math.min(nearest, (sums[topic] as number) / size);
      }
    }
    const larger = Math.max(within, nearest);
    if (nearest !== Infinity && larger > 0) {
      total += (nearest - within) / larger;
    }
  }
  return total / n;
}

/** At most {@link KMEANS_SAMPLE_CAP} indices, seeded. */
function sampleIndices(n: number, random: () => number): readonly number[] {
  const indices = Array.from({ length: n }, (_, index) => index);
  if (n <= KMEANS_SAMPLE_CAP) return indices;
  for (let i = 0; i < KMEANS_SAMPLE_CAP; i += 1) {
    const j = i + Math.floor(random() * (n - i));
    const held = indices[i] as number;
    indices[i] = indices[j] as number;
    indices[j] = held;
  }
  return indices.slice(0, KMEANS_SAMPLE_CAP);
}

/** Largest topic first, then the smaller first work key, with each topic's mean. */
function clustersOf(
  keys: readonly string[],
  points: readonly EmbeddingVector[],
  assignment: Int32Array,
  centroids: readonly EmbeddingVector[],
  trials: readonly KmeansTrial[],
): TopicClusters {
  const topics = centroids
    .map((centroid, topic) => {
      const indices = keys.flatMap((_, index) =>
        assignment[index] === topic ? [index] : [],
      );
      return {
        centroid:
          unitMean(
            indices.map((index) => points[index] as EmbeddingVector),
            centroid.model,
          ) ?? centroid,
        members: indices.map((index) => keys[index] as string),
      };
    })
    .filter((topic) => topic.members.length > 0)
    .sort(
      (a, b) =>
        b.members.length - a.members.length ||
        ((a.members[0] as string) < (b.members[0] as string) ? -1 : 1),
    );
  const topicOf = new Map<string, number>();
  topics.forEach((topic, index) => {
    for (const key of topic.members) topicOf.set(key, index);
  });
  return {
    centroids: topics.map((topic) => topic.centroid),
    members: topics.map((topic) => topic.members),
    topicOf,
    trials,
  };
}

/**
 * Split a collection's vectors into 1 to `kMax` topics (`docs/05` §7.2).
 *
 * @param vectors - by work key, unit length, of one model and one length;
 *   `EnsuredEmbeddings.vectors` is one
 * @param options - any of {@link KMEANS_AUTO_DEFAULTS} to replace
 * @returns the topics; none only for no vectors, or vectors that cancel out
 * @throws RangeError for vectors of two models or two lengths
 */
export function kmeansAuto(
  vectors: ReadonlyMap<string, EmbeddingVector>,
  options: Partial<KmeansAutoOptions> = {},
): TopicClusters {
  const { kMax, minClusterSize, minGain, seed } = {
    ...KMEANS_AUTO_DEFAULTS,
    ...options,
  };
  const keys = [...vectors.keys()].sort();
  const points = keys.map((key) => vectors.get(key) as EmbeddingVector);
  const first = points[0];
  if (first === undefined) {
    return { centroids: [], members: [], topicOf: new Map(), trials: [] };
  }
  for (const point of points) {
    if (
      point.model !== first.model ||
      point.values.length !== first.values.length
    ) {
      throw new RangeError(
        "[research-helper] kmeansAuto: vectors of two models or two lengths " +
          "(plan/08 §0.2 item 22)",
      );
    }
  }

  const single = new Int32Array(points.length);
  let held: {
    readonly assignment: Int32Array;
    readonly centroids: readonly EmbeddingVector[];
    readonly silhouette: number;
  } = {
    assignment: single,
    centroids: [first],
    silhouette: 0,
  };

  const largestK = Math.min(kMax, Math.floor(points.length / minClusterSize));
  const trials: KmeansTrial[] = [];
  if (largestK >= 2) {
    const random = mulberry32(seed);
    const sampled = sampleIndices(points.length, random).map(
      (index) => points[index] as EmbeddingVector,
    );
    const table = pairwiseDistances(sampled);
    for (let k = 2; k <= largestK; k += 1) {
      const fit = bestFit(sampled, k, random);
      const silhouette = silhouetteOf(table, sampled.length, fit.assignment, k);
      const assignment = assign(points, fit.centroids);
      const sizes = new Int32Array(k);
      for (const topic of assignment) {
        sizes[topic] = (sizes[topic] as number) + 1;
      }
      const smallestCluster = Math.min(...sizes);
      trials.push({ k, silhouette, smallestCluster });
      if (
        smallestCluster >= minClusterSize &&
        silhouette >= held.silhouette + minGain
      ) {
        held = { assignment, centroids: fit.centroids, silhouette };
      }
    }
  }
  // Vectors that cancel out have no centre, and `first` is only a member.
  if (
    held.centroids.length === 1 &&
    unitMean(points, first.model) === undefined
  ) {
    return { centroids: [], members: [], topicOf: new Map(), trials };
  }
  return clustersOf(keys, points, held.assignment, held.centroids, trials);
}

/** What {@link labelCentroids} reads of a work. Every `CanonicalWork` is one. */
export type LabelledWork = Pick<
  CanonicalWork,
  "workKey" | "title" | "subjects" | "keywords"
>;

/** Whether the work holds the term whose {@link normalizeTitle} form is `key`. */
function holdsTerm(
  tagged: ReadonlySet<string>,
  paddedTitle: string,
  key: string,
): boolean {
  return tagged.has(key) || paddedTitle.includes(` ${key} `);
}

/**
 * Name each centroid in code (`plan/08` `P5-T21` step 4; `docs/05` §7.2's note, item 9).
 * Caller: `withTopicsAndSeeds`.
 *
 * @param clusters - {@link kmeansAuto}'s answer
 * @param works - the collection's works
 * @param termWeights - `CollectionProfile.termWeights`
 * @returns one label per centroid, or `undefined` when any topic has none, so the
 *   window numbers the groups (`docs/07` §5.2)
 */
export function labelCentroids(
  clusters: Pick<TopicClusters, "members">,
  works: readonly LabelledWork[],
  termWeights: Readonly<Record<string, number>>,
): readonly string[] | undefined {
  const { members } = clusters;
  if (members.length === 0) return undefined;
  const readings = new Map(
    works.map((work) => [
      work.workKey,
      {
        tagged: new Set(
          [
            ...(work.subjects ?? [])
              .filter((subject) => subject.scheme === MESH_SCHEME)
              .map((subject) => subject.term),
            ...(work.keywords ?? []),
          ].map(normalizeTitle),
        ),
        paddedTitle: ` ${normalizeTitle(work.title)} `,
      },
    ]),
  );
  const shares = rankedTerms(termWeights).map(([term, weight]) => {
    const key = normalizeTitle(term);
    const holding = members.map(
      (topic) =>
        topic.filter((workKey) => {
          const reading = readings.get(workKey);
          return (
            reading !== undefined &&
            holdsTerm(reading.tagged, reading.paddedTitle, key)
          );
        }).length,
    );
    return { term, weight, holding };
  });
  const everyone = members.reduce((sum, topic) => sum + topic.length, 0);
  const totalHolding = (holding: readonly number[]): number =>
    holding.reduce((sum, count) => sum + count, 0);

  const labels: string[] = [];
  const used = new Set<string>();
  for (const [topic, own] of members.entries()) {
    let best: string | undefined;
    let bestScore = 0;
    for (const { term, weight, holding } of shares) {
      if (used.has(term)) continue;
      const inside = holding[topic] as number;
      const others = everyone - own.length;
      const outside =
        others === 0 ? 0 : (totalHolding(holding) - inside) / others;
      const score = weight * (inside / own.length - outside);
      if (score > bestScore) {
        best = term;
        bestScore = score;
      }
    }
    if (best === undefined) return undefined;
    used.add(best);
    labels.push(best);
  }
  return labels;
}

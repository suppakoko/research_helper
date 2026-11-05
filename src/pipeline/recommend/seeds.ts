/**
 * Seed selection, negatives, and the step that fills a profile's topic members
 * (`docs/05` §7.2 "Seed selection", "Negative examples", `P5-T21`). The dated note at
 * the end of that section holds the decisions and says which values are starting
 * values; this header does not repeat them.
 *
 * **Callers.** `recommendPipeline.ts` (`P5-T25`) calls
 * {@link withTopicsAndSeeds} after `buildProfileStats`, and {@link recentNegatives}
 * when the edited-profile job generates (`docs/07` §12.5). The two `SeedSpace`
 * builders and {@link selectSeeds} are called by {@link withTopicsAndSeeds}. `P5-T23`
 * reads `CollectionProfile.seeds`, grouped by `topicIndex`.
 *
 * **One space per run (`plan/08` §0.2 item 22).** A {@link SeedSpace} is either
 * SPECTER2 or lexical, and its scores are compared only against its own cut.
 *
 * **Deterministic.** The clock is an input, ties go to the smaller work key, and the
 * order the works arrive in changes nothing. No request is sent from here.
 */

import { ResearchHelperError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { ExternalIds } from "../../model/ids";
import type { CollectionProfile, ProfileSeed } from "../../model/profile";
import type { SimilaritySpace } from "../../model/recommendation";
import { RECOMMEND_MAX_POSITIVES } from "../../sources/semanticscholar/recommendations";
import { toSemanticScholarId } from "../../sources/semanticscholar/semanticscholarSource";
import type { RecommendationStore } from "../../zotero/db";
import {
  cosine,
  EMBEDDING_DIMENSIONS,
  type EmbeddingVector,
} from "../shared/embeddings";
import { lexicalSpace, type LexicalVector } from "../shared/lexical";

import { kmeansAuto, labelCentroids, type TopicClusters } from "./centroids";

/** `docs/05` §7.2's sketch: its four weights, unmeasured. */
export const SEED_WEIGHTS = {
  recency: 0.4,
  centrality: 0.25,
  addedRecently: 0.2,
  quality: 0.15,
} as const;

/** `docs/05` §7.4's τ, in years. */
export const SEED_RECENCY_TAU_YEARS = 1.5;
/** `docs/05` §7.2's sketch. */
export const SEED_RECENTLY_ADDED_DAYS = 90;
/** The citation count that reads as full quality. A starting value. */
export const SEED_QUALITY_FULL_CITATIONS = 1000;

/** `docs/05` §7.2's sketch: unmeasured on real vectors (`P5-T30`). */
export const SPECTER_DIVERSITY_CUT = 0.92;
/** Measured 2026-11-05 on recorded abstracts: `docs/05` §7.2's note, item 7. */
export const LEXICAL_DIVERSITY_CUT = 0.45;

/** `plan/08` `P5-T21`'s floor; {@link RECOMMEND_MAX_POSITIVES} is the ceiling. */
export const MIN_SEEDS = 10;
/** `plan/08` `P5-T21` step 3. */
export const MAX_NEGATIVES = 10;

const DAY_MS = 864e5;

/** How one run's seeds are told apart. Built by the two functions below. */
export interface SeedSpace {
  readonly space: SimilaritySpace;
  /** Two seeds at or above this are too close. */
  readonly diversityCut: number;
  /** In [0, 1] across the collection; 0 for a work with no vector. */
  centralityOf(workKey: string): number;
  /** `CollectionProfile.centroids`' index, or `undefined` for no topic. */
  topicOf(workKey: string): number | undefined;
  /** `undefined` when either work has no vector, which no cut can judge. */
  similarity(a: string, b: string): number | undefined;
}

/** So the collection's lowest reads 0 and its highest 1; all alike read 0. */
function stretched(raw: ReadonlyMap<string, number>): Map<string, number> {
  const values = [...raw.values()];
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  return new Map(
    [...raw].map(([key, value]) => [key, span > 0 ? (value - low) / span : 0]),
  );
}

/** The SPECTER2 space: centrality against each member's own centroid. */
export function specterSeedSpace(
  vectors: ReadonlyMap<string, EmbeddingVector>,
  clusters: Pick<TopicClusters, "centroids" | "topicOf">,
): SeedSpace {
  const raw = new Map<string, number>();
  for (const [workKey, topic] of clusters.topicOf) {
    const vector = vectors.get(workKey);
    const centroid = clusters.centroids[topic];
    if (vector !== undefined && centroid !== undefined) {
      raw.set(workKey, cosine(vector, centroid));
    }
  }
  const centrality = stretched(raw);
  return {
    space: "specter_v2",
    diversityCut: SPECTER_DIVERSITY_CUT,
    centralityOf: (workKey) => centrality.get(workKey) ?? 0,
    topicOf: (workKey) => clusters.topicOf.get(workKey),
    similarity(a, b) {
      const left = vectors.get(a);
      const right = vectors.get(b);
      return left === undefined || right === undefined
        ? undefined
        : cosine(left, right);
    },
  };
}

/** The dot product of a word vector with a mean held as a map. */
function dotWithMean(
  vector: LexicalVector,
  mean: ReadonlyMap<string, number>,
): number {
  let dot = 0;
  vector.terms.forEach((term, index) => {
    dot += (vector.weights[index] as number) * (mean.get(term) ?? 0);
  });
  return dot;
}

/**
 * The lexical space, with the collection as its corpus (`docs/05` §5.5). Centrality
 * is against the mean of the collection's word vectors, built here and never stored.
 */
export function lexicalSeedSpace(works: readonly CanonicalWork[]): SeedSpace {
  const space = lexicalSpace(works);
  const vectors = new Map(
    works.map((work) => [work.workKey, space.vector(work)]),
  );
  const mean = new Map<string, number>();
  for (const vector of vectors.values()) {
    vector.terms.forEach((term, index) => {
      mean.set(term, (mean.get(term) ?? 0) + (vector.weights[index] as number));
    });
  }
  const raw = new Map(
    [...vectors].map(([workKey, vector]) => [
      workKey,
      dotWithMean(vector, mean),
    ]),
  );
  const centrality = stretched(raw);
  return {
    space: "lexical",
    diversityCut: LEXICAL_DIVERSITY_CUT,
    centralityOf: (workKey) => centrality.get(workKey) ?? 0,
    topicOf: () => undefined,
    similarity(a, b) {
      const left = vectors.get(a);
      const right = vectors.get(b);
      return left === undefined || right === undefined
        ? undefined
        : space.cosine(left, right);
    },
  };
}

/** What {@link selectSeeds} needs besides the works and the space. */
export interface SelectSeedsOptions {
  /** The run's clock: `Date.now()` is not read, so two runs can agree. */
  readonly nowEpochMs: number;
  /** Defaults to {@link RECOMMEND_MAX_POSITIVES}, `docs/05` §3.3's cap. */
  readonly maxSeeds?: number;
}

/** One entry per work key: the higher count, then the smaller identifiers as text. */
function distinctWorks(
  works: readonly CanonicalWork[],
): readonly CanonicalWork[] {
  const best = new Map<string, CanonicalWork>();
  for (const work of works) {
    const held = best.get(work.workKey);
    const count = work.citationCount ?? -1;
    const heldCount = held?.citationCount ?? -1;
    if (
      held === undefined ||
      count > heldCount ||
      (count === heldCount &&
        JSON.stringify(work.ids) < JSON.stringify(held.ids))
    ) {
      best.set(work.workKey, work);
    }
  }
  return [...best.values()];
}

/**
 * The seeds of `docs/05` §7.2: scored, taken in turn from each topic, each kept off
 * those already taken by the space's cut.
 *
 * @param works - the collection's works; a repeated work key counts once
 * @param addedAt - `addedAtByWorkKey`'s answer; `addedAt` is not on the record
 * @param space - {@link specterSeedSpace} or {@link lexicalSeedSpace}
 * @param options - the clock and the ceiling
 * @returns the seeds, in the order they were taken, best first within a topic
 */
export function selectSeeds(
  works: readonly CanonicalWork[],
  addedAt: ReadonlyMap<string, number>,
  space: SeedSpace,
  options: SelectSeedsOptions,
): readonly ProfileSeed[] {
  const { nowEpochMs, maxSeeds = RECOMMEND_MAX_POSITIVES } = options;
  const nowYear = new Date(nowEpochMs).getUTCFullYear();
  const recentSince = nowEpochMs - SEED_RECENTLY_ADDED_DAYS * DAY_MS;

  const scoreOf = (work: CanonicalWork): number => {
    const year = work.publishedDate?.year;
    const recency =
      year === undefined
        ? 0
        : Math.exp(-Math.max(0, nowYear - year) / SEED_RECENCY_TAU_YEARS);
    const quality =
      work.citationCount === undefined
        ? 0
        : Math.min(
            1,
            Math.log1p(Math.max(0, work.citationCount)) /
              Math.log1p(SEED_QUALITY_FULL_CITATIONS),
          );
    return (
      SEED_WEIGHTS.recency * recency +
      SEED_WEIGHTS.centrality * space.centralityOf(work.workKey) +
      SEED_WEIGHTS.addedRecently *
        ((addedAt.get(work.workKey) ?? 0) > recentSince ? 1 : 0) +
      SEED_WEIGHTS.quality * quality
    );
  };

  const ranked = distinctWorks(works)
    .filter((work) => toSemanticScholarId(work.ids) !== undefined)
    .map((work) => ({ work, score: scoreOf(work) }))
    .sort(
      (a, b) => b.score - a.score || (a.work.workKey < b.work.workKey ? -1 : 1),
    )
    .map(({ work }, rank) => ({ work, rank }));
  type Ranked = (typeof ranked)[number];

  const topicQueues = new Map<number, Ranked[]>();
  const noTopic: Ranked[] = [];
  for (const entry of ranked) {
    const topic = space.topicOf(entry.work.workKey);
    if (topic === undefined) {
      noTopic.push(entry);
    } else {
      const queue = topicQueues.get(topic) ?? [];
      queue.push(entry);
      topicQueues.set(topic, queue);
    }
  }
  const queues = [...topicQueues.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, queue]) => ({ queue, next: 0 }));
  const lastQueue = { queue: noTopic, next: 0 };

  const chosen: Ranked[] = [];
  const skipped: Ranked[] = [];
  const tooClose = (entry: Ranked): boolean =>
    chosen.some((held) => {
      const similarity = space.similarity(
        held.work.workKey,
        entry.work.workKey,
      );
      return similarity !== undefined && similarity >= space.diversityCut;
    });
  const takeFrom = (source: { queue: Ranked[]; next: number }): boolean => {
    while (source.next < source.queue.length) {
      const entry = source.queue[source.next] as Ranked;
      source.next += 1;
      if (tooClose(entry)) {
        skipped.push(entry);
      } else {
        chosen.push(entry);
        return true;
      }
    }
    return false;
  };

  let took = true;
  while (took) {
    took = false;
    for (const source of queues) {
      if (chosen.length >= maxSeeds) break;
      if (takeFrom(source)) took = true;
    }
  }
  while (chosen.length < maxSeeds) {
    if (!takeFrom(lastQueue)) break;
  }

  const floor = Math.min(MIN_SEEDS, maxSeeds);
  for (const entry of [...skipped].sort((a, b) => a.rank - b.rank)) {
    if (chosen.length >= floor) break;
    chosen.push(entry);
  }

  return chosen.map(({ work }) => {
    const topicIndex = space.topicOf(work.workKey);
    return {
      ids: work.ids,
      ...(topicIndex !== undefined && { topicIndex }),
    };
  });
}

/**
 * The newest {@link MAX_NEGATIVES} dismissals for this collection, as identifiers
 * (`docs/05` §7.2), for `P5-T23`'s `recommend`. Read on each run and never held on
 * the profile (`docs/07` §5.2). A store that cannot be read only warns.
 *
 * @param store - the recommendation store
 * @param profileId - `collectionProfileId`'s
 * @param logger - where the warning goes
 * @returns identifiers, newest first; a row with none is left out
 */
export async function recentNegatives(
  store: Pick<RecommendationStore, "listRejected">,
  profileId: string,
  logger?: Logger,
): Promise<readonly Partial<ExternalIds>[]> {
  try {
    const rejected = await store.listRejected(profileId, MAX_NEGATIVES);
    return rejected
      .map((row) => row.work.ids)
      .filter((ids) => toSemanticScholarId(ids) !== undefined);
  } catch (error) {
    if (!(error instanceof ResearchHelperError)) throw error;
    logger?.warn("recommend: dismissals could not be read; sending none", {
      messageKey: error.messageKey,
    });
    return [];
  }
}

/** What {@link withTopicsAndSeeds} reads. */
export interface TopicsAndSeedsInput {
  /** The collection's works. */
  readonly works: readonly CanonicalWork[];
  /** `addedAtByWorkKey`'s answer. */
  readonly addedAt: ReadonlyMap<string, number>;
  /**
   * `EnsuredEmbeddings.vectors` on a keyed run; absent on a run with no key. A vector
   * of a work outside `works` is not read.
   */
  readonly vectors?: ReadonlyMap<string, EmbeddingVector>;
  readonly nowEpochMs: number;
  readonly logger?: Logger;
}

/**
 * `buildProfileStats`' answer with its topic members filled in. Whatever topic members
 * it came with are replaced. `P5-T25` stores the result through `persistProfile`.
 *
 * @param profile - the profile so far
 * @param input - the works, the vectors and the clock
 * @returns a new profile; on the lexical space `centroids` is empty and no
 *   `centroidLabels`, `embeddingModel` or `embeddingDim` is present
 */
export function withTopicsAndSeeds(
  profile: CollectionProfile,
  input: TopicsAndSeedsInput,
): CollectionProfile {
  const { works, addedAt, nowEpochMs, logger } = input;
  const memberKeys = new Set(works.map((work) => work.workKey));
  const memberVectors = new Map(
    [...(input.vectors ?? [])].filter(([workKey]) => memberKeys.has(workKey)),
  );
  const clusters = kmeansAuto(memberVectors);
  const onVectors = clusters.centroids.length > 0;
  const space = onVectors
    ? specterSeedSpace(memberVectors, clusters)
    : lexicalSeedSpace(works);
  const seeds = selectSeeds(works, addedAt, space, { nowEpochMs });
  const labels = labelCentroids(clusters, works, profile.termWeights);

  logger?.info("recommend: topics and seeds", {
    space: space.space,
    vectors: memberVectors.size,
    members: memberKeys.size,
    k: clusters.centroids.length,
    trials: clusters.trials,
    seeds: seeds.length,
  });

  const {
    centroidLabels: _centroidLabels,
    embeddingModel: _embeddingModel,
    embeddingDim: _embeddingDim,
    ...rest
  } = profile;
  return {
    ...rest,
    centroids: clusters.centroids.map((centroid) =>
      Array.from(centroid.values),
    ),
    seeds,
    ...(onVectors && {
      embeddingModel: "specter_v2",
      embeddingDim: EMBEDDING_DIMENSIONS.specter_v2,
    }),
    ...(labels !== undefined && { centroidLabels: labels }),
  };
}

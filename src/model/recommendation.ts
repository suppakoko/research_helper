/**
 * One scored recommendation — `docs/07` §5.2's `// src/model/recommendation.ts`
 * block (`P5-T01`).
 *
 * **Scope.** Transcribed from `docs/07-architecture-and-data-model.md` §5.2,
 * which `plan/README.md` §5 rule 3 makes the sole authority for types; the note
 * of 2026-11-02 above the profile block says what changed and why.
 *
 * **Callers.** Nothing constructs a recommendation yet. `P5-T24`'s scoring does
 * first, `P5-T27`'s rows read it, and `P5-T03`'s store in `src/zotero/db.ts`
 * persists it.
 *
 * Types only: `model/` imports nothing but `model/` (`docs/07` §2.3).
 */

import type { CanonicalWork } from "./canonicalWork";
import type { SourceId } from "./ids";
import type { StoredRedactionMark } from "./summary";

export interface Recommendation {
  /** `${profileId}:${workKey}` */
  readonly id: string;
  readonly profileId: string;
  readonly work: CanonicalWork;
  /**
   * The eight signals' weighted sum, in 0..1. Not rescaled across the batch: the weights sum
   * to 1.00 so that a score means the same thing at every slider position (`05-…` §7.4).
   */
  readonly score: number;
  /** Component scores, exposed in the UI so the ranking is explainable. */
  readonly signals: RecommendationSignals;
  /** Which space `signals.similarity` and `signals.novelty` were computed in; a run has one. */
  readonly similaritySpace: SimilaritySpace;
  /** Why this row is shown (FR-47): ids the window renders, computed in code, never by a model. */
  readonly reasons: readonly RecommendationReason[];
  /** Every generator that found it, so never empty. */
  readonly discoveredVia: readonly RecommendationDiscovery[];
  /** Index into `CollectionProfile.centroids` of its nearest topic; absent when the profile has k ≤ 1. */
  readonly topicIndex?: number;
  readonly generatedAtEpochMs: number;
  /**
   * Set by "Not interested", so the same paper stays hidden for this collection and can be sent as
   * a negative example. The only value: nothing records what the user imports (`plan/00` §6 item 323(b)).
   */
  readonly userAction?: "rejected";
  readonly userActionAtEpochMs?: number;
  /**
   * What the redaction gate changed when the record was stored (`09-security-privacy-and-api-keys.md`
   * §2.1); absent until the store has gated it.
   */
  readonly redaction?: StoredRedactionMark;
}

/**
 * `05-related-work-discovery.md` §7.4's eight terms, each in 0..1 and 0 when a run cannot compute
 * it (no `NaN`, no absent member). §7.4 owns the formulas and the weights.
 */
export interface RecommendationSignals {
  /**
   * Similarity to the profile: the **maximum** over `CollectionProfile.centroids`, not the
   * mean — `05-…` §7.4's scoring table explains why a mean punishes a paper that fits one
   * sub-topic perfectly. Rescaled from cosine's [-1, 1]. On the lexical space there are no
   * centroids and `P5-T24` reads the local word-overlap floor (`05-…` §5.5).
   */
  readonly similarity: number;
  /** Decays with age from the publication date. */
  readonly recency: number;
  /** Citations per year. */
  readonly velocity: number;
  /** Distance from the nearest paper in the collection, on the same rescaled scale as `similarity`. */
  readonly novelty: number;
  /** Authors shared with the profile. */
  readonly authorAffinity: number;
  /** The venue against the profile's top venues, then its ISSN family. */
  readonly venueAffinity: number;
  /** How many distinct generators found it: distinct `RecommendationDiscovery.strategy`, not list entries. */
  readonly generatorAgreement: number;
  /** References shared with the collection (`05-…` §2.3). */
  readonly coupling: number;
}

/**
 * `05-…` §7.1's five generators: (a) Semantic Scholar's recommender, (b) PubMed's similar articles,
 * (c) forward citations of the seeds, (d) keyword search, (e) the frequent-author watch.
 */
export type RecommendationStrategy =
  | "recommendations"
  | "similar"
  | "forward-citations"
  | "keyword-search"
  | "author-watch";

export interface RecommendationDiscovery {
  readonly sourceId: SourceId;
  readonly strategy: RecommendationStrategy;
}

/** `specter_v2` is the model name a stored vector carries; `lexical` is `05-…` §5.5's floor. */
export type SimilaritySpace = "specter_v2" | "lexical";

/**
 * One of the two strongest signals, named after its member, or one of `05-…` §7.6's three
 * reason phrases. `P5-T24` picks them and `P5-T27` renders them.
 */
export type RecommendationReasonId =
  | keyof RecommendationSignals
  | "recommended-by-semantic-scholar"
  | "cites-collection"
  | "author-in-collection";

export interface RecommendationReason {
  readonly id: RecommendationReasonId;
  /** "cites N papers in your collection": N. */
  readonly count?: number;
  /** "author in your collection": the names, from the work's own author list. */
  readonly names?: readonly string[];
}

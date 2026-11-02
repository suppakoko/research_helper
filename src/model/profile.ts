/**
 * The persisted collection profile — `docs/07` §5.2's `// src/model/profile.ts`
 * block (`P5-T01`).
 *
 * **Scope.** Transcribed from `docs/07-architecture-and-data-model.md` §5.2,
 * which `plan/README.md` §5 rule 3 makes the sole authority for types; the note
 * of 2026-11-02 above that block says what changed and why.
 *
 * **Callers.** Nothing constructs a profile yet. `buildProfileStats` (`P5-T18`)
 * does first, `P5-T21`, `P5-T22` and `P5-T25` fill in the rest, and `P5-T03`'s
 * store in `src/zotero/db.ts` persists it.
 *
 * Types only: `model/` imports nothing but `model/` (`docs/07` §2.3).
 */

import type { ExternalIds } from "./ids";
import type { StoredRedactionMark } from "./summary";

/**
 * A compact fingerprint of a collection, used to (a) drive recommendations,
 * (b) detect when a collection has drifted enough to need re-profiling.
 *
 * This is the *persisted* profile, and `docs/07` owns it. Two neighbouring
 * shapes carry similar names and are NOT this type:
 *   - `CollectionProfileDraft` (`05-related-work-discovery.md` §7.2) — the ranking
 *     pipeline's in-memory working set (Float32Array centroids, reference index,
 *     owned-ID sets). This record is derived from it.
 *   - the JSON Schema titled "CollectionProfile" in `12-prompt-library.md` §15 — the
 *     COLLECTION_PROFILE prompt's *output*, whose focus statement and suggested query
 *     terms land in `narrative` and `suggestedQueries` below.
 *
 * `centroids` below is deliberately plural and mirrors the draft's own `centroids`, so a
 * multi-topic profile round-trips through storage without losing all but one centroid.
 */
export interface CollectionProfile {
  /** `${libraryID}:${collectionKey}` */
  readonly id: string;
  readonly libraryID: number;
  readonly collectionKey: string;
  readonly collectionName: string;
  readonly builtAtEpochMs: number;
  /** Number of items considered when the profile was built. */
  readonly itemCount: number;
  /**
   * Content hash over the sorted list of member item keys + their dateModified.
   * If this changes, the profile is stale.
   */
  readonly membershipHash: string;

  /** Weighted term vector for keyword-based recommendation (TF-IDF-ish). */
  readonly termWeights: Readonly<Record<string, number>>;
  /** Controlled-vocabulary concentration: MeSH/arXiv categories with counts. */
  readonly subjectCounts: Readonly<Record<string, number>>;
  readonly topAuthors: readonly {
    name: string;
    count: number;
    orcid?: string;
  }[];
  readonly topVenues: readonly {
    name: string;
    count: number;
    issn?: readonly string[];
  }[];
  readonly yearHistogram: Readonly<Record<number, number>>;
  readonly medianYear: number | undefined;

  /**
   * Centroid embeddings, if embeddings are enabled. **k of them, not one** — a collection
   * spanning several subfields is the normal case for feature F6, and `05-…` §7.2
   * ("Multi-topic collections") splits it with k-means, k = 1..4. Persisting only the
   * primary centroid would silently degrade every recommendation for such a collection,
   * so the field is plural and `05-…`'s `CollectionProfileDraft.centroids` round-trips.
   *
   * Empty array when embeddings are unavailable — never `undefined`, so callers do not
   * need a second absence check. `centroids.length` is the k that `05-…` §7.4's
   * `max over centroids` similarity signal iterates.
   *
   * Stored as one concatenated Float32 blob in SQLite (`collection_profile.centroids`,
   * `docs/07` §8.3), k × `embeddingDim` floats in row-major order; hydrated to number[][] here.
   */
  readonly centroids: readonly (readonly number[])[];
  /** Optional per-centroid label, e.g. "base editing" — same order as `centroids`. */
  readonly centroidLabels?: readonly string[];
  readonly embeddingModel?: string;
  readonly embeddingDim?: number;
  /** The papers generators (a), (b) and (c) ask from (`05-…` §7.2 "Seed selection"), best first. */
  readonly seeds: readonly ProfileSeed[];

  /** LLM-authored description of what this collection is about. Absent when `origin` is "heuristic". */
  readonly narrative?: string;
  /** Machine-generated search queries derived from the profile. Empty when `origin` is "heuristic". */
  readonly suggestedQueries: readonly string[];
  /**
   * "llm" when a COLLECTION_PROFILE answer validated; "heuristic" when no provider is
   * configured or the answer stayed invalid after its repair (FR-45's second scenario).
   */
  readonly origin: "llm" | "heuristic";
  /** Output tokens of the answer behind `narrative`; read against the 2 500 limit by the acceptance run. */
  readonly profileCallOutputTokens?: number;
  /**
   * Works in the source collection — FR-46's exclusion set for recommendations. Library items
   * elsewhere are marked, not excluded, and are worked out on each run through `LibraryIndex`.
   */
  readonly knownWorkKeys: readonly string[];
  /**
   * What the user changed in the profile panel. Kept beside the computed members, which are never
   * overwritten with them: a run reads `termWeights` minus `removedTerms` plus `addedTerms`, and a
   * rebuild computes the members afresh and keeps this one (FR-44; `plan/08` §0.4 line 21).
   */
  readonly userEdits?: ProfileUserEdits;
  /**
   * What the redaction gate changed when the record was stored (`09-security-privacy-and-api-keys.md`
   * §2.1); absent until the store has gated it.
   */
  readonly redaction?: StoredRedactionMark;
}

export interface ProfileSeed {
  /** The paper's identifiers; each generator takes one it can send. */
  readonly ids: Partial<ExternalIds>;
  /** Index into `CollectionProfile.centroids`; absent when the profile has no centroids. */
  readonly topicIndex?: number;
}

export interface ProfileUserEdits {
  readonly removedTerms: readonly string[];
  readonly addedTerms: readonly string[];
}

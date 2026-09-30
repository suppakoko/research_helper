/**
 * One source's pre-merge view of a work.
 *
 * **Scope.** `P1-T01`. `docs/07-architecture-and-data-model.md` §5.1's third
 * code block, transcribed — field names, types, optionality and doc comments
 * unchanged. `plan/README.md` §5 rule 3 makes doc 07 the sole authority for
 * types; `docs/02` §10.1's `CanonicalRecord` sketch carries a "doc 07 wins"
 * note and is not transcribed.
 *
 * **Types only.** No value is exported. `P1-T01` step 5 asks for the guards the
 * mapper tests need and names {@link isCanonicalWork}, which lives with the
 * type it guards; a `SourceRecord` guard would be API the card did not ask for.
 *
 * **Layering.** `model/` imports nothing but `model/` (docs/07 §2.3).
 */

import type { CanonicalWork } from "./canonicalWork";
import type { SourceId } from "./ids";

/**
 * A single source's view of a work, before merging. Kept so that we can
 * re-run the merge with improved rules without re-hitting the network,
 * and so that provenance is auditable.
 */
export interface SourceRecord {
  /** `${sourceId}:${nativeId}` — unique across the plugin. */
  readonly id: string;
  readonly sourceId: SourceId;
  /** The identifier the source itself uses (PMID, DOI, arXiv ID, S2 paper ID...). */
  readonly nativeId: string;
  /** Normalized view produced by this source's mapper. */
  readonly work: Omit<
    CanonicalWork,
    "workKey" | "provenance" | "normalizedAtEpochMs"
  >;
  /** Epoch ms when fetched. Drives cache TTL and staleness display. */
  readonly retrievedAtEpochMs: number;
  /**
   * The raw upstream payload. Held only for as long as the mapper needs it, and retained
   * past that point only when `logRequestBodies` (§8.5) is on — the same switch that lets
   * bodies reach the debug log, kept for the same diagnostic reason. Otherwise undefined
   * (see the §8.3 placement table). There is no separate "keep raw responses" preference;
   * §8.5 is the complete list of preferences and adding a second content switch here would
   * mean two ways to leave user content lying around.
   */
  readonly raw?: unknown;
  /** Source's own relevance score for the query that produced it, if any. */
  readonly relevanceScore?: number;
  /** Fields the mapper could not populate; surfaced in the import report. */
  readonly missingFields: readonly string[];
}

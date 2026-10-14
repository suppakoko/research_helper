/**
 * One source's pre-merge view of a work.
 *
 * **Scope.** `P1-T01`. `docs/07-architecture-and-data-model.md` §5.1's third
 * code block, transcribed — field names, types, optionality and doc comments
 * unchanged. `plan/README.md` §5 rule 3 makes doc 07 the sole authority for
 * types; `docs/02` §10.1's `CanonicalRecord` sketch carries a "doc 07 wins"
 * note and is not transcribed.
 *
 * **One value.** `P1-T01` shipped this file as types only — `isCanonicalWork`
 * lives with the type it guards, and a `SourceRecord` guard was API that card
 * did not ask for. `P2-T10` adds {@link isSourceRecord} (that card's `Files`
 * row: "guards only"), because `src/model/merge.ts` takes records from the
 * dedup cascade and must reject a malformed one before it decides a field
 * with it.
 *
 * **Layering.** `model/` imports nothing but `model/` (docs/07 §2.3).
 */

import { isWorkType, type CanonicalWork } from "./canonicalWork";
import { isSourceId, type SourceId } from "./ids";

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

// ---------------------------------------------------------------------------
// Guard — P2-T10, "guards only"
//
// Mirrors `canonicalWork.ts`'s section 3: required members only, because
// every other member of `SourceRecord` and of its `work` is optional in
// docs/07 §5.1 and a stronger check would reject a legitimate sparse record.
// ---------------------------------------------------------------------------

/** A non-null, non-array object, read as a bag of unknown properties. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The required members of `SourceRecord.work` — `CanonicalWork` minus the
 * three the merge mints — checked the way `isCanonicalWork` checks the whole:
 * `ids` for objecthood only (no `ExternalIds` member is required), `type`
 * against the `WorkType` union, `title` a string, `authors` an array whose
 * every member has a string `family`.
 */
function isSourceWork(value: unknown): value is SourceRecord["work"] {
  const w = asRecord(value);
  return (
    w !== null &&
    asRecord(w["ids"]) !== null &&
    isWorkType(w["type"]) &&
    typeof w["title"] === "string" &&
    Array.isArray(w["authors"]) &&
    w["authors"].every((author) => {
      const a = asRecord(author);
      return a !== null && typeof a["family"] === "string";
    })
  );
}

/**
 * Type guard for {@link SourceRecord}.
 *
 * Checks every member docs/07 §5.1 marks required: `id` a non-empty string,
 * `sourceId` one of the `SourceId` members (`isSourceId`, so an invented
 * source name is rejected here rather than written into provenance),
 * `nativeId` a string, `work` per {@link isSourceWork}, `retrievedAtEpochMs` a
 * finite number and `missingFields` an array of strings. `raw` and
 * `relevanceScore` are optional and not inspected.
 *
 * @param value - anything, typically an element handed to `merge`
 * @returns whether every required member is present and well-typed
 */
export function isSourceRecord(value: unknown): value is SourceRecord {
  const r = asRecord(value);
  if (r === null) return false;
  return (
    typeof r["id"] === "string" &&
    r["id"].length > 0 &&
    isSourceId(r["sourceId"]) &&
    typeof r["nativeId"] === "string" &&
    isSourceWork(r["work"]) &&
    typeof r["retrievedAtEpochMs"] === "number" &&
    Number.isFinite(r["retrievedAtEpochMs"]) &&
    Array.isArray(r["missingFields"]) &&
    r["missingFields"].every((field) => typeof field === "string")
  );
}

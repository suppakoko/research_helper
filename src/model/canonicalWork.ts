/**
 * The canonical work: the plugin's internal lingua franca.
 *
 * **Scope.** `P1-T01`. Every source maps *into* these shapes and the Zotero
 * mapper maps *out of* them; `docs/07-architecture-and-data-model.md` §5
 * opens with the rule that "nothing in `pipeline/` should ever see a raw
 * PubMed or Crossref payload", and this file is what makes that possible.
 *
 * **Authority.** Sections 1 and 2 below are `docs/07` §5.1 transcribed —
 * field names, types, optionality and doc comments unchanged.
 * `plan/README.md` §5 rule 3 makes doc 07 the sole authority for types;
 * `docs/02` §10.1's `CanonicalRecord` and §12.1's `QueryNode` / `WorkType`
 * sketches carry explicit "doc 07 wins" notes and are deliberately **not**
 * transcribed. Two consequences worth naming, because both look like
 * omissions:
 *
 * - `WorkType` is `docs/07` §5.1's nine-member kebab-case union
 *   (`"journal-article"`, `"conference-paper"`, `"book-chapter"`), **not**
 *   `docs/02` §10.2's camelCase Zotero-facing names (`journalArticle`,
 *   `bookSection`). The camelCase names are Zotero item types, and
 *   `docs/07` §6.2 is where one becomes the other.
 * - `ExternalIds` is imported from `./ids`, where `docs/07` §5.1's code block
 *   puts it. §2.2's one-line directory comment attributes it to this file
 *   instead; §5.1 is the declaration and therefore wins.
 *
 * **Layering.** `model/` imports nothing but `model/` (docs/07 §2.3).
 *
 * Section 3 holds the runtime type guards `P1-T01` step 5 requires for the
 * mapper tests. They are the only values this file exports.
 */

import { isSourceId, type ExternalIds, type SourceId } from "./ids";

// ---------------------------------------------------------------------------
// 1. Works — docs/07 §5.1 (`src/model/canonicalWork.ts`), verbatim
// ---------------------------------------------------------------------------

export interface Author {
  /** Family name as printed. Required — an author with no name is dropped. */
  readonly family: string;
  readonly given?: string;
  /** Full name as the source gave it, kept verbatim for fidelity. */
  readonly literal?: string;
  /** Bare ORCID, e.g. "0000-0002-1825-0097" (no URL prefix). */
  readonly orcid?: string;
  /** Affiliation strings in source order; often absent. */
  readonly affiliations?: readonly string[];
  /** Position in the author list, 0-based, as given by the source. */
  readonly sequence?: number;
  /** Marked corresponding author, where the source says so. */
  readonly isCorresponding?: boolean;
}

export type WorkType =
  | "journal-article"
  | "preprint"
  | "conference-paper"
  | "review"
  | "book-chapter"
  | "dataset"
  | "thesis"
  | "report"
  | "other";

/** A publication date that may be only partially known. */
export interface PartialDate {
  readonly year: number;
  readonly month?: number; // 1-12
  readonly day?: number; // 1-31
  /** ISO 8601 rendering of whatever precision we have: "2024", "2024-03", "2024-03-07". */
  readonly iso: string;
}

export interface OpenAccessInfo {
  readonly isOpenAccess: boolean;
  /** Best available OA status label from the source, e.g. "gold", "green", "hybrid". */
  readonly status?: string;
  /** Direct link to a free full text, when the source provides one. */
  readonly pdfUrl?: string;
  readonly landingPageUrl?: string;
  /** SPDX-ish license identifier or URL, when known. Drives TDM decisions. */
  readonly license?: string;
}

/**
 * The normalized representation of a paper, merged across sources.
 * This is what pipelines, prompts, and the Zotero mapper operate on.
 */
export interface CanonicalWork {
  /**
   * Stable internal key: the first available of
   * `doi:<doi>` | `pmid:<pmid>` | `arxiv:<id>` | `s2:<corpusId>` | `hash:<sha1(title|year|firstAuthor)>`.
   * Used as the primary key in the plugin database and as a cache key component.
   */
  readonly workKey: string;
  readonly ids: ExternalIds;
  readonly type: WorkType;

  readonly title: string;
  /** Plain-text abstract, tags stripped, whitespace normalized. May be absent. */
  readonly abstract?: string;
  readonly authors: readonly Author[];

  /** Journal, conference proceedings, or preprint server name. */
  readonly containerTitle?: string;
  readonly containerAbbreviation?: string;
  readonly publisher?: string;
  readonly volume?: string;
  readonly issue?: string;
  readonly pages?: string;
  readonly issn?: readonly string[];

  /** Date used for the "last 3 years" filter. Prefer published over accepted. */
  readonly publishedDate?: PartialDate;
  /** Distinct from publishedDate for preprints that were later published. */
  readonly onlineDate?: PartialDate;

  readonly language?: string;
  /** Controlled vocabulary terms: MeSH descriptors, arXiv categories, publisher keywords. */
  readonly subjects?: readonly Subject[];
  /** Free keywords supplied by authors. */
  readonly keywords?: readonly string[];

  readonly citationCount?: number;
  readonly referenceCount?: number;
  /** Influential citation count (Semantic Scholar), when available. */
  readonly influentialCitationCount?: number;

  readonly openAccess?: OpenAccessInfo;
  /** Canonical landing URL. */
  readonly url?: string;

  /** Set when this preprint has a published version, or vice versa. */
  readonly relatedVersionIds?: ExternalIds;

  /** Provenance: which SourceRecords contributed, and which field came from where. */
  readonly provenance: WorkProvenance;

  /** ms since epoch when this canonical record was last rebuilt. */
  readonly normalizedAtEpochMs: number;
}

export interface Subject {
  readonly term: string;
  /** e.g. "mesh", "arxiv-category", "publisher-keyword". */
  readonly scheme: string;
  /** Scheme-specific identifier, e.g. a MeSH UI like "D000818". */
  readonly id?: string;
  /** MeSH major-topic flag. */
  readonly isMajor?: boolean;
}

export interface WorkProvenance {
  /** SourceRecord ids that were merged into this work, in merge order. */
  readonly recordIds: readonly string[];
  /** Which source won for each contested field. Field name → SourceId. */
  readonly fieldOrigin: Readonly<Record<string, SourceId>>;
  /** Sources that returned this work at all — useful for confidence weighting. */
  readonly seenIn: readonly SourceId[];
}

// ---------------------------------------------------------------------------
// 2. The runtime mirror of WorkType — see SOURCE_ID_SET in ./ids for the
//    identical pattern and the reason it is not a second declaration.
// ---------------------------------------------------------------------------

/** Compile-time-exhaustive key set for {@link WorkType}. */
const WORK_TYPE_SET = {
  "journal-article": true,
  preprint: true,
  "conference-paper": true,
  review: true,
  "book-chapter": true,
  dataset: true,
  thesis: true,
  report: true,
  other: true,
} satisfies Record<WorkType, true>;

/** Every {@link WorkType}, in the union's declaration order. */
export const WORK_TYPES: readonly WorkType[] = Object.keys(
  WORK_TYPE_SET,
) as WorkType[];

/** Type guard: is `value` one of the nine {@link WorkType} members? */
export function isWorkType(value: unknown): value is WorkType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(WORK_TYPE_SET, value)
  );
}

// ---------------------------------------------------------------------------
// 3. Type guards — P1-T01 step 5, "used by the mapper tests"
//
// These check the *required* members only, which is all §5.1 makes checkable:
// every other field is optional, and asserting a shape the doc does not
// require would reject a legitimate sparse record. A mapper test asserting
// `isCanonicalWork(mapped)` is therefore asserting "nothing mandatory is
// missing or of the wrong kind", not "every field was populated" — the
// per-field expectations belong in the mapper's own assertions and in
// `SourceRecord.missingFields`.
// ---------------------------------------------------------------------------

/** A non-null, non-array object, read as a bag of unknown properties. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Type guard for {@link Author}: `family` is the one required member. */
function isAuthor(value: unknown): value is Author {
  const a = asRecord(value);
  return a !== null && typeof a["family"] === "string";
}

/**
 * Type guard for {@link WorkProvenance}. All three members are required, and
 * `seenIn` / `fieldOrigin`'s values are checked against {@link isSourceId} —
 * a mapper that invents a source name is the defect this catches.
 */
function isWorkProvenance(value: unknown): value is WorkProvenance {
  const p = asRecord(value);
  if (p === null) return false;
  const fieldOrigin = asRecord(p["fieldOrigin"]);
  return (
    Array.isArray(p["recordIds"]) &&
    p["recordIds"].every((id) => typeof id === "string") &&
    fieldOrigin !== null &&
    Object.values(fieldOrigin).every(isSourceId) &&
    Array.isArray(p["seenIn"]) &&
    p["seenIn"].every(isSourceId)
  );
}

/**
 * Type guard for {@link CanonicalWork}.
 *
 * `ids` is checked only for objecthood: {@link ExternalIds} has no required
 * member — "a bioRxiv preprint may have only a DOI, an old PubMed record may
 * have only a PMID" — so `{}` is a valid value and any stronger assertion
 * here would invent a rule §5.1 does not state.
 *
 * @param value - anything, typically a mapper's output
 * @returns whether every member §5.1 marks required is present and well-typed
 */
export function isCanonicalWork(value: unknown): value is CanonicalWork {
  const w = asRecord(value);
  if (w === null) return false;
  return (
    typeof w["workKey"] === "string" &&
    w["workKey"].length > 0 &&
    asRecord(w["ids"]) !== null &&
    isWorkType(w["type"]) &&
    typeof w["title"] === "string" &&
    Array.isArray(w["authors"]) &&
    w["authors"].every(isAuthor) &&
    isWorkProvenance(w["provenance"]) &&
    typeof w["normalizedAtEpochMs"] === "number" &&
    Number.isFinite(w["normalizedAtEpochMs"])
  );
}

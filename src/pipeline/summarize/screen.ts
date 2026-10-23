/**
 * Screening before summary: retracted papers, non-English papers and
 * duplicates, handled by policy before any of them can contribute a finding
 * (`docs/06` §13.2–§13.4; `P3-T27` steps 1–5).
 *
 * **Caller.** The summarize pipeline (`summarizePipeline.ts`, `P3-T29`) runs
 * {@link screenItems} over the collection's items before it summarizes
 * anything, then {@link applyNonEnglishPolicy} over each summary it gets
 * back. Nothing calls this module yet; `P3-T29` is the card that does.
 *
 * ## What is decided here, and from what
 *
 * - **Retractions** (§13.3). Layer (a) is Zotero's own Retraction Watch data,
 *   read through `readRetraction` in `src/zotero/zoteroApi.ts` and handed in
 *   as {@link RetractionSignals.zotero} — read, never scraped. Layers (b) and
 *   (c) read only a response the caller **already holds** (§13.3: "only when
 *   the item is being fetched from Crossref anyway"; "available free in the
 *   ESummary response"): {@link crossrefRetractionKinds} and
 *   {@link pubmedRetractionKinds} parse, they never fetch. A retracted paper
 *   never reaches synthesis under any `screening.retractionPolicy`; an
 *   expression of concern is annotated and kept.
 * - **Language** (§13.2). An item `docs/06` §4.2's check marked
 *   `language_non_english` gets `screening.nonEnglishPolicy`. Under
 *   `translate_summary` the source text is summarized as it is — never
 *   translated first — and {@link applyNonEnglishPolicy} adds
 *   `source_language` and caps `confidence` at `medium` on the summary.
 * - **Duplicates** (§13.4). Collection-scoped, with
 *   `src/sources/shared/dedupe.ts`'s cascade reused as it stands
 *   ({@link findCollectionDuplicates}). `Zotero.Duplicates` is not used: it
 *   is library-scoped and has no preprint-aware resolution (§13.4's note).
 *
 * The as-built readings are in `docs/06` §13.2–§13.4's notes of 2026-10-24.
 *
 * Pure: no platform call, no preference read — the policy arrives as an
 * argument, read through `PipelineContext.config` by {@link screeningPolicyFrom}.
 */

import {
  candidateFromLibraryItem,
  compareCandidates,
  isPreprintPair,
  type DedupCandidate,
} from "../../sources/shared/dedupe";
import type { ConfigReader } from "../types";
import {
  LANGUAGE_NON_ENGLISH_WARNING,
  type CountedScript,
  type LanguageDetection,
} from "./languageDetect";

// ---------------------------------------------------------------------------
// 1. The policy
// ---------------------------------------------------------------------------

/** `docs/07` §8.5's `screening.retractionPolicy` values. */
export type RetractionPolicy =
  "include" | "exclude_from_synthesis" | "exclude_entirely";

/** `docs/07` §8.5's `screening.nonEnglishPolicy` values. */
export type NonEnglishPolicy =
  "skip" | "translate_summary" | "summarize_in_source_language";

/** The three `screening.*` preferences this module applies. */
export interface ScreeningPolicy {
  readonly retractionPolicy: RetractionPolicy;
  readonly nonEnglishPolicy: NonEnglishPolicy;
  /** `screening.dedupe`. */
  readonly dedupe: boolean;
}

/**
 * The run's policy, read through the job's `ConfigReader` (`docs/07` §4.5),
 * which falls back to §8.5's defaults — so no default is restated here.
 */
export function screeningPolicyFrom(config: ConfigReader): ScreeningPolicy {
  return {
    retractionPolicy: config.get(
      "screeningRetractionPolicy",
    ) as RetractionPolicy,
    nonEnglishPolicy: config.get(
      "screeningNonEnglishPolicy",
    ) as NonEnglishPolicy,
    dedupe: config.get("screeningDedupe"),
  };
}

// ---------------------------------------------------------------------------
// 2. Retractions — docs/06 §13.3
// ---------------------------------------------------------------------------

/**
 * What a layer says about an item. `expression_of_concern` is the one kind
 * that does **not** exclude.
 */
export type RetractionKind =
  | "retracted"
  | "retraction_notice"
  | "withdrawn"
  | "removed"
  | "expression_of_concern";

/** Which layer said so. */
export type RetractionLayer = "zotero" | "crossref" | "pubmed";

/** The three layers' raw input for one item. Every member is optional. */
export interface RetractionSignals {
  /** Layer (a): `Zotero.Retractions`, through `readRetraction`. */
  readonly zotero?: {
    readonly retracted: boolean;
    /** `getReasonDescription` of each reason, when Zotero gave any. */
    readonly reasons?: readonly string[];
  };
  /** Layer (b): `message["updated-by"]` of a Crossref response already fetched. */
  readonly crossrefUpdatedBy?: unknown;
  /** Layer (c): the publication types of a PubMed record already fetched. */
  readonly pubmedPublicationTypes?: readonly string[];
}

/** What the layers found, together. */
export interface RetractionFinding {
  /** True unless the only finding is an expression of concern. */
  readonly excluded: boolean;
  readonly kinds: readonly RetractionKind[];
  readonly layers: readonly RetractionLayer[];
  /** Zotero's reason descriptions, for Appendix A. */
  readonly reasons: readonly string[];
}

/** §13.3 (b): the `updated-by` types worth acting on, and what each means. */
const CROSSREF_UPDATE_KINDS: Readonly<Record<string, RetractionKind>> = {
  retraction: "retracted",
  withdrawal: "withdrawn",
  removal: "removed",
  expression_of_concern: "expression_of_concern",
};

/**
 * §13.3 (b): the kinds a Crossref `message["updated-by"]` array names. Any
 * other shape — absent, not an array, an entry with no string `type` — names
 * nothing.
 *
 * @param updatedBy - `message["updated-by"]`, exactly as the response held it
 */
export function crossrefRetractionKinds(
  updatedBy: unknown,
): readonly RetractionKind[] {
  if (!Array.isArray(updatedBy)) return [];
  const kinds = new Set<RetractionKind>();
  for (const entry of updatedBy as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const type = (entry as Record<string, unknown>)["type"];
    if (typeof type !== "string") continue;
    const kind = CROSSREF_UPDATE_KINDS[type.trim().toLowerCase()];
    if (kind !== undefined) kinds.add(kind);
  }
  return [...kinds];
}

/**
 * §13.3 (c): `"Retracted Publication"` (the retracted article) and
 * `"Retraction of Publication"` (the notice itself, not a research
 * contribution). Compared case-insensitively.
 *
 * @param publicationTypes - ESummary's `pubtype`, or EFetch's
 *   `PublicationType` texts
 */
export function pubmedRetractionKinds(
  publicationTypes: readonly string[],
): readonly RetractionKind[] {
  const kinds = new Set<RetractionKind>();
  for (const raw of publicationTypes) {
    const type = raw.trim().toLowerCase();
    if (type === "retracted publication") kinds.add("retracted");
    if (type === "retraction of publication") kinds.add("retraction_notice");
  }
  return [...kinds];
}

/**
 * Combine the three layers, cheapest first. Layers (b) and (c) are consulted
 * only for an item Zotero did not already flag (§13.3).
 *
 * @returns the finding, or `undefined` when no layer says anything
 */
export function retractionOf(
  signals: RetractionSignals | undefined,
): RetractionFinding | undefined {
  if (signals === undefined) return undefined;
  if (signals.zotero?.retracted === true) {
    return {
      excluded: true,
      kinds: ["retracted"],
      layers: ["zotero"],
      reasons: signals.zotero.reasons ?? [],
    };
  }
  const kinds = new Set<RetractionKind>();
  const layers: RetractionLayer[] = [];
  const crossref = crossrefRetractionKinds(signals.crossrefUpdatedBy);
  if (crossref.length > 0) {
    layers.push("crossref");
    for (const kind of crossref) kinds.add(kind);
  }
  const pubmed = pubmedRetractionKinds(signals.pubmedPublicationTypes ?? []);
  if (pubmed.length > 0) {
    layers.push("pubmed");
    for (const kind of pubmed) kinds.add(kind);
  }
  if (kinds.size === 0) return undefined;
  return {
    excluded: [...kinds].some((kind) => kind !== "expression_of_concern"),
    kinds: [...kinds],
    layers,
    reasons: [],
  };
}

// ---------------------------------------------------------------------------
// 3. Language — docs/06 §13.2
// ---------------------------------------------------------------------------

/**
 * The `source_language` value for a §4.2 script. Hangul names one language;
 * Han, Cyrillic and Arabic script do not, so they give BCP 47's
 * "undetermined language" with the script subtag (`docs/06` §13.2's note).
 */
export function sourceLanguageOf(script: CountedScript | null): string {
  switch (script) {
    case "hangul":
      return "ko";
    case "cjk":
      return "und-Hani";
    case "cyrillic":
      return "und-Cyrl";
    case "arabic":
      return "und-Arab";
    case null:
      return "und";
  }
}

/** The fields of a `PaperSummary` that {@link applyNonEnglishPolicy} touches. */
export interface SummaryConfidenceFields {
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly notEnoughInformation?: readonly string[];
}

/** §13.2: `"source_language: xx"`, the line added to `notEnoughInformation`. */
export function sourceLanguageNote(language: string): string {
  return `source_language: ${language}`;
}

/**
 * §13.2's `translate_summary` on a summary the model returned: add
 * `"source_language: xx"` to `notEnoughInformation` (once) and cap
 * `confidence` at `medium`. Any other decision returns the summary unchanged.
 *
 * @param summary - the validated summary
 * @param decision - the item's {@link ScreenDecision}
 * @returns a new object; `summary` is not mutated
 */
export function applyNonEnglishPolicy<T extends SummaryConfidenceFields>(
  summary: T,
  decision: Pick<ScreenDecision, "nonEnglishPolicy" | "sourceLanguage">,
): T {
  if (
    decision.nonEnglishPolicy !== "translate_summary" ||
    decision.sourceLanguage === undefined
  ) {
    return summary;
  }
  const note = sourceLanguageNote(decision.sourceLanguage);
  const notes = summary.notEnoughInformation ?? [];
  return {
    ...summary,
    confidence: summary.confidence === "high" ? "medium" : summary.confidence,
    notEnoughInformation: notes.includes(note) ? notes : [...notes, note],
  };
}

// ---------------------------------------------------------------------------
// 4. Duplicates — docs/06 §13.4
// ---------------------------------------------------------------------------

/** One collection item, as the `zotero/` layer reads it. Plain values only. */
export interface ScreenItem {
  /** The Zotero item key: what `duplicate_of:KEY` names. */
  readonly key: string;
  readonly itemID: number;
  /** Zotero's item type, e.g. `journalArticle` or `preprint`. */
  readonly itemType: string;
  readonly title: string;
  readonly year?: number | undefined;
  readonly firstAuthorFamily?: string | undefined;
  readonly containerTitle?: string | undefined;
  readonly doi?: string | undefined;
  readonly pmid?: string | undefined;
  readonly pmcid?: string | undefined;
  readonly arxivId?: string | undefined;
  /** Characters of `abstractNote`: §13.4's "(b) a longer abstract". */
  readonly abstractLength: number;
  /** §13.4's "(a) a full-text attachment". */
  readonly hasFullText: boolean;
  /** `dateAdded` as Zotero stores it (`YYYY-MM-DD HH:MM:SS`, UTC). */
  readonly dateAdded: string;
  readonly retraction?: RetractionSignals | undefined;
  /** `docs/06` §4.2's check over the text that would be summarized. */
  readonly language?:
    Pick<LanguageDetection, "nonEnglish" | "dominantScript"> | undefined;
}

/** Zotero's `preprint` item type: the one §13.4 step 4 pairs. */
const PREPRINT_ITEM_TYPE = "preprint";

/** §13.4 step 4: "years within 2". */
export const PREPRINT_PAIR_MAX_YEAR_DELTA = 2;

function candidateOf(item: ScreenItem): DedupCandidate {
  return candidateFromLibraryItem({
    itemID: item.itemID,
    deleted: false,
    doi: item.doi,
    pmid: item.pmid,
    pmcid: item.pmcid,
    arxivId: item.arxivId,
    title: item.title,
    year: item.year,
    firstAuthorFamily: item.firstAuthorFamily,
    containerTitle: item.containerTitle,
    isPreprint: item.itemType === PREPRINT_ITEM_TYPE,
  });
}

/**
 * Whether two items are one paper under §13.4: the cascade says `"match"`
 * (steps 1–3), or it says `"link"` or `"flag"` for a preprint and a
 * non-preprint with the same normalized title, at most two years apart
 * (step 4). Every other `"flag"` is left alone.
 */
function sameWork(a: DedupCandidate, b: DedupCandidate): boolean {
  const decision = compareCandidates(a, b);
  if (decision.verdict === "match") return true;
  if (decision.verdict !== "link" && decision.verdict !== "flag") return false;
  return (
    isPreprintPair(a, b) &&
    a.title !== "" &&
    a.title === b.title &&
    a.year !== undefined &&
    b.year !== undefined &&
    Math.abs(a.year - b.year) <= PREPRINT_PAIR_MAX_YEAR_DELTA
  );
}

/**
 * §13.4's resolution order: the published version over the preprint, then a
 * full-text attachment, then the longer abstract, then the earlier
 * `dateAdded`, then the smaller key so the choice never changes between runs.
 * Negative when `a` is the one to keep.
 */
function keepOrder(a: ScreenItem, b: ScreenItem): number {
  const published = (item: ScreenItem): number =>
    item.itemType === PREPRINT_ITEM_TYPE ? 1 : 0;
  return (
    published(a) - published(b) ||
    Number(b.hasFullText) - Number(a.hasFullText) ||
    b.abstractLength - a.abstractLength ||
    a.dateAdded.localeCompare(b.dateAdded) ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Collection-scoped duplicate detection (§13.4): every pair of `items`
 * through `src/sources/shared/dedupe.ts`'s cascade, grouped transitively, one
 * item kept per group.
 *
 * Quadratic in the collection, which is the scale `docs/06` §13.4 means
 * ("Zotero collections routinely contain the same paper twice"); the search
 * pipeline's blocked cascade is for result sets, not this.
 *
 * @param items - the collection's items; keys must be unique
 * @returns dropped key → kept key
 */
export function findCollectionDuplicates(
  items: readonly ScreenItem[],
): ReadonlyMap<string, string> {
  const candidates = items.map(candidateOf);
  const parent = items.map((_item, i) => i);
  const find = (i: number): number => {
    let x = i;
    while ((parent[x] ?? x) !== x) x = parent[x] ?? x;
    return x;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (a === undefined || b === undefined || !sameWork(a, b)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
  }
  const groups = new Map<number, ScreenItem[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [item]);
    else group.push(item);
  });
  const dropped = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [kept, ...rest] = [...group].sort(keepOrder);
    if (kept === undefined) continue;
    for (const item of rest) dropped.set(item.key, kept.key);
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// 5. The decision per item
// ---------------------------------------------------------------------------

/** Appendix A's reason for an item that is not summarized or not synthesized. */
export type ExclusionReason =
  "retracted" | "language_non_english" | `duplicate_of:${string}`;

/** What the report marks inline. */
export type ScreenAnnotation =
  "retracted" | "expression_of_concern" | "source_language";

/** What the summarize pipeline does with one item. */
export interface ScreenDecision {
  readonly key: string;
  /** Send it to `PAPER_SUMMARY_*`. */
  readonly summarize: boolean;
  /** Let its summary reach `THEME_CLUSTER`, `CLUSTER_REDUCE` and the report. */
  readonly synthesize: boolean;
  /** List it in the report's Bibliography. */
  readonly bibliography: boolean;
  /** Appendix A's reason; absent for an item that is synthesized. */
  readonly reason?: ExclusionReason;
  readonly retraction?: RetractionFinding;
  /** The kept item's key, for an item dropped as a duplicate. */
  readonly duplicateOf?: string;
  /** Set for a non-English item: §13.2's `xx`. */
  readonly sourceLanguage?: string;
  /** The §13.2 policy applied, for a non-English item. */
  readonly nonEnglishPolicy?: NonEnglishPolicy;
  readonly annotations: readonly ScreenAnnotation[];
}

/** The counts §2 Scope and Method states. */
export interface ScreenCounts {
  /** Retracted, withdrawn, removed or a retraction notice — every policy counts. */
  readonly retracted: number;
  readonly expressionsOfConcern: number;
  readonly nonEnglish: number;
  /** Non-English items `skip` left out. */
  readonly nonEnglishSkipped: number;
  /** Items dropped as a duplicate of another. */
  readonly duplicates: number;
}

export interface ScreenReport {
  /** One per item, in item order. */
  readonly decisions: readonly ScreenDecision[];
  readonly counts: ScreenCounts;
}

/**
 * Decide every item of a summary run (`P3-T27` steps 1–5). Precedence when
 * several apply: a retraction, then a duplicate, then the language — each
 * later one can only narrow what the earlier left.
 *
 * Nothing here deletes, moves or edits an item: the decisions say what the
 * summary run sends and synthesizes, and the item stays in the collection
 * whatever they say (§13.3, "deleting the user's data is never this
 * feature's job").
 *
 * @param items - the collection's items, keys unique
 * @param policy - from {@link screeningPolicyFrom}
 */
export function screenItems(
  items: readonly ScreenItem[],
  policy: ScreeningPolicy,
): ScreenReport {
  const duplicates = policy.dedupe
    ? findCollectionDuplicates(items)
    : new Map<string, string>();
  let retracted = 0;
  let expressionsOfConcern = 0;
  let nonEnglish = 0;
  let nonEnglishSkipped = 0;

  const decisions = items.map((item): ScreenDecision => {
    let summarize = true;
    let synthesize = true;
    let bibliography = true;
    let reason: ExclusionReason | undefined;
    const annotations: ScreenAnnotation[] = [];
    const extra: {
      retraction?: RetractionFinding;
      duplicateOf?: string;
      sourceLanguage?: string;
      nonEnglishPolicy?: NonEnglishPolicy;
    } = {};

    const finding = retractionOf(item.retraction);
    if (finding !== undefined) {
      extra.retraction = finding;
      if (finding.kinds.includes("expression_of_concern")) {
        expressionsOfConcern += 1;
        annotations.push("expression_of_concern");
      }
      if (finding.excluded) {
        retracted += 1;
        annotations.push("retracted");
        reason = "retracted";
        // §13.3: never a finding, under every policy (the note of 2026-10-24).
        synthesize = false;
        summarize = policy.retractionPolicy === "include";
        bibliography = policy.retractionPolicy !== "exclude_entirely";
      }
    }

    const kept = duplicates.get(item.key);
    if (kept !== undefined) {
      extra.duplicateOf = kept;
      reason ??= `duplicate_of:${kept}`;
      summarize = false;
      synthesize = false;
      // Its citations are rewritten to the kept key (§13.4).
      bibliography = false;
    }

    if (item.language?.nonEnglish === true) {
      nonEnglish += 1;
      extra.sourceLanguage = sourceLanguageOf(item.language.dominantScript);
      extra.nonEnglishPolicy = policy.nonEnglishPolicy;
      annotations.push("source_language");
      if (policy.nonEnglishPolicy === "skip") {
        nonEnglishSkipped += 1;
        reason ??= LANGUAGE_NON_ENGLISH_WARNING;
        summarize = false;
        synthesize = false;
      }
    }

    return {
      key: item.key,
      summarize,
      synthesize,
      bibliography,
      ...(reason !== undefined && { reason }),
      ...extra,
      annotations,
    };
  });

  return {
    decisions,
    counts: {
      retracted,
      expressionsOfConcern,
      nonEnglish,
      nonEnglishSkipped,
      duplicates: duplicates.size,
    },
  };
}

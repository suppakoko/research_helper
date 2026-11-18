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
  defaultYieldToEventLoop,
  DEDUP_YIELD_EVERY_COMPARISONS,
  ID_KINDS,
  isPreprintPair,
  isTitleComparable,
  LEVSIM_DUPLICATE_THRESHOLD,
  MAX_YEAR_DELTA,
  titleNumbers,
  type DedupCandidate,
  type DedupCounter,
  type DedupeAsyncOptions,
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
 * How many {@link sameWork} comparisons the duplicate screen runs between two
 * yields to the event loop, in {@link findCollectionDuplicatesAsync}
 * (`P7-T41`, `docs/10` NFR-3). The search pipeline's figure
 * (`DEDUP_YIELD_EVERY_COMPARISONS`, measured by `P2-T30` at about 50 µs a
 * comparison): `P7-T15`'s profile of 2026-11-18 put this screen's comparisons
 * at about 80 µs each, so a slice is about 20 ms.
 */
export const SCREEN_YIELD_EVERY_COMPARISONS = DEDUP_YIELD_EVERY_COMPARISONS;

/** The pair `[i, j]`, `i < j`, as one number, for a `Set` of pairs seen. */
function pairKey(i: number, j: number, n: number): number {
  return Math.min(i, j) * n + Math.max(i, j);
}

/**
 * The fuzzy title tier's group (`P7-T41`): two candidates whose keys differ
 * can never be a fuzzy-title `"match"` after `guardTitleVerdict`, which turns a
 * match into a flag when exactly one side is a preprint (`isPreprintPair`), or
 * when the two titles carry different numbers (`innerNumbersDiffer`, item
 * 281(c)). So the key is "preprint or not" and the title's numbers, in order.
 */
function fuzzyKeyOf(c: DedupCandidate): string {
  return `${c.type === "preprint" ? "p" : "w"}|${titleNumbers(c.title).join(",")}`;
}

/**
 * Whether a pair in one fuzzy group, years within {@link MAX_YEAR_DELTA}, can
 * still be a fuzzy-title match: the tier's first rule needs `levSim` at least
 * `LEVSIM_DUPLICATE_THRESHOLD`, and its other two need the same first author.
 * A Levenshtein distance is never below the length difference, so
 * `1 - |la - lb| / max(la, lb)` bounds `levSim` from above, and a pair below
 * the threshold on that bound and with different first authors is skipped.
 */
function fuzzyPairPossible(a: DedupCandidate, b: DedupCandidate): boolean {
  if (a.firstAuthor !== undefined && a.firstAuthor === b.firstAuthor) {
    return true;
  }
  const longest = Math.max(a.title.length, b.title.length);
  if (longest === 0) return true;
  const levSimBound = 1 - Math.abs(a.title.length - b.title.length) / longest;
  return levSimBound >= LEVSIM_DUPLICATE_THRESHOLD;
}

/**
 * The pairs the duplicate screen compares (`P7-T41`; owner, `plan/00` §6 item
 * 405(a)): only pairs that {@link sameWork} can call one paper, found by cheap
 * keys, each pair once, as `[i, j]` with `i < j`. It replaces comparing every
 * pair of the collection (124 750 pairs at 500 items, about 10.5 s in one task:
 * `plan/reports/P7-T15.md`, batch G).
 *
 * **Nothing {@link sameWork} accepts is left out**, because each way the
 * cascade can make two library items one paper needs a shared key here:
 *
 * 1. **A shared identifier** (`ID_KINDS`) **or bioRxiv accession**: Tiers 0–4's
 *    match. Every pair holding one value is compared.
 * 2. **The same normalized title**, not empty: Tier 5's match, and §13.4 step
 *    4's preprint pair, which needs equal titles. This also holds every
 *    `"link"` or `"flag"` {@link sameWork} accepts, and every pair of two
 *    F1000Research reports across versions, whose matches the cascade returns
 *    as links.
 * 3. **A fuzzy-title match** (Tier 6): both titles comparable, both years
 *    known and within {@link MAX_YEAR_DELTA} (each of the tier's three rules
 *    needs that), the same {@link fuzzyKeyOf} key, and
 *    {@link fuzzyPairPossible}.
 *
 * Tier 7 (a known version link) gives a link, which counts only under 2; a
 * library item has no `relatedVersionIds` anyway.
 *
 * @param candidates - the collection's candidates, in item order
 */
function* candidatePairsOf(
  candidates: readonly DedupCandidate[],
): Generator<readonly [number, number], void, void> {
  const n = candidates.length;
  const seen = new Set<number>();
  const exact = new Map<string, number[]>();
  const fuzzy = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, i: number): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [i]);
    else list.push(i);
  };
  candidates.forEach((c, i) => {
    for (const kind of ID_KINDS) {
      const value = c.ids[kind];
      if (value !== undefined) push(exact, `${kind}:${value}`, i);
    }
    if (c.accession !== undefined) push(exact, `accession:${c.accession}`, i);
    if (c.title !== "") push(exact, `title:${c.title}`, i);
    if (isTitleComparable(c) && c.year !== undefined) {
      push(fuzzy, fuzzyKeyOf(c), i);
    }
  });
  for (const holders of exact.values()) {
    for (let x = 0; x < holders.length; x += 1) {
      for (let y = x + 1; y < holders.length; y += 1) {
        const i = holders[x] as number;
        const j = holders[y] as number;
        const key = pairKey(i, j, n);
        if (seen.has(key)) continue;
        seen.add(key);
        yield [Math.min(i, j), Math.max(i, j)];
      }
    }
  }
  for (const members of fuzzy.values()) {
    // By year, so each item meets only the items within MAX_YEAR_DELTA.
    const byYear = [...members].sort(
      (p, q) => (candidates[p]?.year ?? 0) - (candidates[q]?.year ?? 0),
    );
    for (let x = 0; x < byYear.length; x += 1) {
      const i = byYear[x] as number;
      const a = candidates[i] as DedupCandidate;
      for (let y = x + 1; y < byYear.length; y += 1) {
        const j = byYear[y] as number;
        const b = candidates[j] as DedupCandidate;
        if ((b.year ?? 0) - (a.year ?? 0) > MAX_YEAR_DELTA) break;
        if (!fuzzyPairPossible(a, b)) continue;
        const key = pairKey(i, j, n);
        if (seen.has(key)) continue;
        seen.add(key);
        yield [Math.min(i, j), Math.max(i, j)];
      }
    }
  }
}

/**
 * The pairs of `items` the duplicate screen compares (`P7-T41`), exported so
 * a test can check that every pair {@link sameWork} accepts is among them.
 *
 * @param items - the collection's items, in order
 * @returns `[i, j]` index pairs, `i < j`, each once
 */
export function screenCandidatePairs(
  items: readonly ScreenItem[],
): readonly (readonly [number, number])[] {
  return [...candidatePairsOf(items.map(candidateOf))];
}

/**
 * Whether two collection items are one paper under §13.4 ({@link sameWork}
 * on their candidates): the predicate the screen applies to each pair,
 * exported for `P7-T41`'s test, which applies it to every pair.
 */
export function screenItemsAreSameWork(a: ScreenItem, b: ScreenItem): boolean {
  return sameWork(candidateOf(a), candidateOf(b));
}

/**
 * The duplicate screen as a generator: the one body behind
 * {@link findCollectionDuplicates} and {@link findCollectionDuplicatesAsync},
 * as `dedupeCascade` is for the search pipeline. It yields after every
 * {@link SCREEN_YIELD_EVERY_COMPARISONS} comparisons. A pair already in one
 * group is not compared again: grouping is transitive, so the comparison
 * could not change the groups.
 */
function* duplicateScreen(
  items: readonly ScreenItem[],
  counter: DedupCounter,
): Generator<void, ReadonlyMap<string, string>, void> {
  const candidates = items.map(candidateOf);
  const parent = items.map((_item, i) => i);
  const find = (i: number): number => {
    let x = i;
    while ((parent[x] ?? x) !== x) x = parent[x] ?? x;
    return x;
  };
  let sinceYield = 0;
  for (const [i, j] of candidatePairsOf(candidates)) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    const a = candidates[i];
    const b = candidates[j];
    if (a === undefined || b === undefined) continue;
    counter.comparisons += 1;
    if (sameWork(a, b)) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    sinceYield += 1;
    if (sinceYield >= SCREEN_YIELD_EVERY_COMPARISONS) {
      yield;
      sinceYield = 0;
    }
  }
  return groupsToDropped(items, find);
}

/**
 * Collection-scoped duplicate detection (§13.4): the pairs of `items` that
 * can be one paper ({@link screenCandidatePairs}) through
 * `src/sources/shared/dedupe.ts`'s cascade, grouped transitively, one item
 * kept per group.
 *
 * *Changed 2026-11-18 (`P7-T41`; owner, `plan/00` §6 item 405(a)):* it compared
 * every pair of the collection, which at 500 items held the main thread for
 * about 10.5 s. It now compares only pairs that share a cheap key, and finds
 * the same groups (`test/unit/pipeline/screen.test.ts`). Synchronous, for the
 * callers that have no event loop to yield to; the summarize pipeline runs
 * {@link findCollectionDuplicatesAsync} through {@link screenItemsAsync}.
 *
 * @param items - the collection's items; keys must be unique
 * @param counter - optional comparison counter, incremented in place
 * @returns dropped key → kept key
 */
export function findCollectionDuplicates(
  items: readonly ScreenItem[],
  counter: DedupCounter = { comparisons: 0 },
): ReadonlyMap<string, string> {
  const screen = duplicateScreen(items, counter);
  for (;;) {
    const step = screen.next();
    if (step.done) return step.value;
  }
}

/** What {@link findCollectionDuplicatesAsync} takes beside the items. */
export type ScreenAsyncOptions = DedupeAsyncOptions;

/**
 * {@link findCollectionDuplicates}, yielding to the event loop every
 * {@link SCREEN_YIELD_EVERY_COMPARISONS} comparisons and checking the token
 * after each yield (`P7-T41`, `docs/10` NFR-3, `docs/07` §7.4). Same pairs,
 * same order, same result: both drain one generator.
 *
 * @throws OperationCancelledError when `options.token` is cancelled, at the
 *   next yield (or on entry if it already is)
 */
export async function findCollectionDuplicatesAsync(
  items: readonly ScreenItem[],
  options: ScreenAsyncOptions = {},
): Promise<ReadonlyMap<string, string>> {
  const counter = options.counter ?? { comparisons: 0 };
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop;
  options.token?.throwIfCancelled();
  const screen = duplicateScreen(items, counter);
  for (;;) {
    const step = screen.next();
    if (step.done) return step.value;
    await yieldToEventLoop();
    options.token?.throwIfCancelled();
  }
}

/** The union-find's groups as dropped key → kept key, by §13.4's order. */
function groupsToDropped(
  items: readonly ScreenItem[],
  find: (i: number) => number,
): ReadonlyMap<string, string> {
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
  return decideItems(items, policy, duplicates);
}

/**
 * {@link screenItems}, with the duplicate screen yielding to the event loop
 * ({@link findCollectionDuplicatesAsync}; `P7-T41`). The summarize pipeline's
 * `prepare` runs this one. Same decisions as {@link screenItems}.
 *
 * @param items - the collection's items, keys unique
 * @param policy - from {@link screeningPolicyFrom}
 * @param options - the job's token, and the yield (injectable for a test)
 */
export async function screenItemsAsync(
  items: readonly ScreenItem[],
  policy: ScreeningPolicy,
  options: ScreenAsyncOptions = {},
): Promise<ScreenReport> {
  const duplicates = policy.dedupe
    ? await findCollectionDuplicatesAsync(items, options)
    : new Map<string, string>();
  return decideItems(items, policy, duplicates);
}

/** The per-item decisions, once the duplicates are known. */
function decideItems(
  items: readonly ScreenItem[],
  policy: ScreeningPolicy,
  duplicates: ReadonlyMap<string, string>,
): ScreenReport {
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

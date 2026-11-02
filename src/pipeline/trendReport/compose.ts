/**
 * Report composition and its structural validation (`P4-T08`; `docs/12` §10
 * and §11, `docs/06` §8.3's last paragraph, §9.1–§9.2): the analysed themes
 * and the digests become one Markdown report with exactly the eleven required
 * sections, every marker checked against the run's valid set, inside the
 * 60 000-token input budget at any N.
 *
 * **Callers.** Nothing calls this module yet. The report run
 * (`trendReportPipeline.ts`, `P4-T18`) calls {@link composeReport} at its
 * compose stage with the analyse stage's analysed themes (`P4-T07`), the
 * digests (`P4-T04`), the screening outcome's Appendix A rows, the
 * collection's search records, the stored `report.targetWords` (through
 * `ctx.config`), its context's budgeted router, budget and token, the `llm`
 * pool and the `TREND_REPORT_EN` or `TREND_REPORT_KO` template; it calls
 * {@link prepareComposition} first when it needs what will be sent (the `rp`
 * cache key's `targetWords` and digests, `P4-T17`). `critique.ts` (`P4-T09`)
 * calls {@link composeReport} again for a rewrite, with its notes in
 * `revisionNotes`; `execute` passes a Korean report's language, template and
 * replacement text (`P4-T21`), and once per language on a `both` run. The
 * constructing file is `src/bootstrap/registerPipelines.ts`
 * (`P4-T18`); nothing is constructed here: every export is a function, a type
 * or a constant.
 *
 * ## What it does (`plan/07` `P4-T08` steps 1–5)
 *
 * 1. {@link reportVariables}: every computed variable, in code — the counts,
 *    `{{EXCLUSION_REASONS}}`, the year range, `{{SOURCES}}`,
 *    `{{SEARCH_STRATEGY}}` and `{{TARGET_WORDS}}` ({@link resolveTargetWords}:
 *    a stored 1–399 reads as `0`, automatic, owner, `plan/00` §6 item 290(d);
 *    a stored value above {@link TARGET_WORDS_MAX} is sent as it, with
 *    {@link TARGET_WORDS_CAPPED_WARNING}, owner, item 312(c)).
 * 2. {@link prepareComposition}: `{{DIGESTS}}` trimmed when the full set
 *    would put the rendered request over the budget (`docs/06` §8.3); then,
 *    in the owner's order, `max_tokens` lowered and analyses shortened
 *    (`docs/06` §8.4's note of 2026-11-02).
 * 3. One `chatStream` call on `resolveModel("strong")`, the template's
 *    temperature (0.3) and ceiling, effort `medium` (`plan/07` §0.2),
 *    budgeted, under one `llm` pool permit; every delta goes to `onDraft`.
 * 4. `docs/12` §10's checks: check 1 ({@link checkHeadings}) regenerates once
 *    with the failure named in `{{REVISION_NOTES}}`; check 2 is
 *    `validateCitations` (`P4-T10`), which replaces an invalid marker
 *    visibly, with no model call; checks 3–5 are measured for Appendix B.
 *    When the one fresh generation fails check 1 again, the outcome is
 *    `stopped-structure-invalid` with {@link STRUCTURE_INVALID_L10N}: the run
 *    stops before anything is written (owner, `plan/00` §6 item 311(a)). For
 *    a `P4-T09` rewrite the same outcome does not stop the run: `critique.ts`
 *    keeps the earlier draft (owner, item 312(b)); nothing here changes for
 *    it, because only that caller sends `revisionNotes`.
 *
 * The readings these steps needed are `docs/12` §10's note of 2026-10-29 and
 * `docs/06` §9.2's; `docs/12` §10's notes of 2026-10-30 record the owner's
 * decisions on them (item 311).
 *
 * **Model output is untrusted.** The report text is checked, never trusted:
 * its headings against the template's, every marker against the valid set;
 * no text of the answer is copied into the regeneration's prompt.
 */

import {
  ConfigurationError,
  ContextLengthExceededError,
  NetworkError,
} from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { LlmPool } from "../../core/jobQueue/queue";
import type { Logger } from "../../core/logger";
import type { SearchProvenance, SourceProvenance } from "../../core/provenance";
import type { MainWindowMessageId } from "../../i18n/keys";
import { RESERVE_TOKENS } from "../../llm/shared/chunking";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  ChatRequest,
  Effort,
  LLMRouter,
  ProviderRoutingHints,
  ResolvedModel,
  Usage,
} from "../../llm/types";
import type { SourceTier } from "../../model/summary";
import type {
  Digest,
  ExcludedItem,
  ReportLanguage,
  ReportQualityProxies,
  ReportScope,
  ReportSection,
  ReportSectionNumber,
  ThemeAnalysis,
  TrendPromptUse,
} from "../../model/trend";
import {
  renderPrompt,
  resolveMaxTokens,
  type PromptTemplate,
} from "../../prompts";
import { SOURCE_CATALOG_LABELS } from "../../zotero/itemMapper";
import {
  REPORT_OUTPUT_FLOOR,
  SYNTHESIS_INPUT_BUDGETS,
  windowInputBudget,
  withHeadroom,
  type ModelWindowLimits,
} from "../shared/estimate";
import {
  citedKeysOf,
  fencedRanges,
  INVALID_CITATION_TEXT,
  ITEM_KEY_RE,
  validateCitations,
  type CitationValidation,
} from "./citations";
import { DIGEST_NO_YEAR, digestText } from "./digest";
import { citedKeysOfAnalysis } from "./themeAnalysis";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `plan/07` §0.2 (owner, `plan/00` §6 item 286): the report call sends `medium`. */
export const REPORT_EFFORT: Effort = "medium";

/** The first answer and the one fresh generation check 1 allows (`docs/12` §10). */
export const REPORT_GENERATIONS_MAX = 2;

/** `docs/06` §9.1's eleven level-2 sections. */
export const REPORT_SECTION_COUNT = 11;

/**
 * The stop message when the one fresh generation fails check 1 again (owner,
 * `plan/00` §6 item 311(a); `docs/12` §10's note of 2026-10-30, reading (3)).
 * No argument. Main-window bundle, beside the other report stops; its Korean
 * was approved by the owner on 2026-10-30 and is on `KO_PRESENT` (`G-41`,
 * item 312(a)).
 */
export const STRUCTURE_INVALID_L10N =
  "research-helper-report-stopped-structure-invalid" as const satisfies MainWindowMessageId;

/** `{{SOURCES}}` when neither a search record nor a catalogue names one (item 286). */
export const SOURCES_NOT_RECORDED = "not recorded";

/** `{{SEARCH_STRATEGY}}` for a collection with no search record (`docs/12` §10). */
export const MANUALLY_CURATED = "manually curated by the user";

/** `{{EXCLUSION_REASONS}}` when nothing was excluded. */
export const NO_EXCLUSIONS = "none";

/**
 * Appendix A's reason codes (`docs/06` §9.1; `ExclusionReason` in
 * `src/pipeline/summarize/screen.ts`) as `{{EXCLUSION_REASONS}}` phrases, in
 * the order they are listed. `duplicate_of:KEY` is matched by its prefix.
 */
export const EXCLUSION_PHRASES: readonly {
  readonly code: string;
  readonly one: string;
  readonly many: string;
}[] = Object.freeze([
  { code: "retracted", one: "retracted", many: "retracted" },
  {
    code: "no_abstract_no_pdf",
    one: "no abstract or PDF",
    many: "no abstract or PDF",
  },
  { code: "duplicate_of:", one: "duplicate", many: "duplicates" },
  { code: "language_non_english", one: "non-English", many: "non-English" },
  { code: "non_english_unsupported", one: "non-English", many: "non-English" },
  {
    code: "extraction_failed",
    one: "text extraction failed",
    many: "text extraction failed",
  },
  {
    code: "llm_failed_after_retries",
    one: "summary failed",
    many: "summary failed",
  },
]);

/** One row of `docs/06` §9.2's length table: corpus size → target words. */
export interface TargetWordBand {
  readonly minPapers: number;
  readonly maxPapers: number;
  readonly minWords: number;
  readonly maxWords: number;
}

/** `docs/06` §9.2's "Target report length" column, transcribed (a test reads the table). */
export const TARGET_WORD_BANDS: readonly TargetWordBand[] = Object.freeze([
  { minPapers: 10, maxPapers: 25, minWords: 1_200, maxWords: 1_800 },
  { minPapers: 26, maxPapers: 75, minWords: 1_800, maxWords: 2_800 },
  { minPapers: 76, maxPapers: 150, minWords: 2_800, maxWords: 4_000 },
  { minPapers: 151, maxPapers: 400, minWords: 3_500, maxWords: 5_000 },
]);

/** `docs/07` §8.5: `report.targetWords` is `0`, or at least this. */
export const TARGET_WORDS_MIN = 400;

/**
 * The longest `{{TARGET_WORDS}}` sent (owner, `plan/00` §6 item 312(c)): the
 * "Words" row of `docs/12` §10's ceiling derivation of 2026-10-30, so the
 * longest target `TREND_REPORT_EN`'s and `TREND_REPORT_KO`'s output ceilings
 * are sized for. A test reads it from that row; if the derivation is redone
 * for a longer target, this follows it. Also the automatic setting's longest
 * target, the last {@link TARGET_WORD_BANDS} row's middle.
 */
export const TARGET_WORDS_MAX = 4_250;

/**
 * `docs/12` §10's ceiling derivation, in tokens per word of the target: prose
 * (Korean × 1.141) plus one citation marker of 3.51 tokens per 15 words.
 */
const REPORT_TOKENS_PER_WORD: Readonly<Record<ReportLanguage, number>> =
  Object.freeze({
    en: 1.968 + 3.51 / 15,
    ko: 1.968 * 1.141 + 3.51 / 15,
  });

/** The same derivation's Markdown allowance. */
const REPORT_MARKDOWN_TOKENS = 500;

/** The same derivation's reasoning allowance, 1.0 × visible, and its 1.15 headroom. */
const REPORT_OUTPUT_PER_VISIBLE_TOKEN = 2 * 1.15;

/**
 * The longest `{{TARGET_WORDS}}` an output of this size is sized for, by
 * `docs/12` §10's derivation run backwards. Above {@link TARGET_WORDS_MAX} at
 * either report ceiling, so a large window's target is unchanged. Read by
 * {@link prepareComposition}: a lower `max_tokens` with the same target would
 * invite `OutputTruncatedError`, which is not retried.
 *
 * @param language - the report's language
 * @param outputTokens - the output the request has
 * @returns a whole number of words, possibly below {@link TARGET_WORDS_MIN}
 */
export function targetWordsForOutput(
  language: ReportLanguage,
  outputTokens: number,
): number {
  const visible = outputTokens / REPORT_OUTPUT_PER_VISIBLE_TOKEN;
  return Math.max(
    0,
    Math.floor(
      (visible - REPORT_MARKDOWN_TOKENS) / REPORT_TOKENS_PER_WORD[language],
    ),
  );
}

/**
 * The analysis fields the composition may drop, in the order it drops them
 * (owner's option 1 on FINDING P4-T22-2; order DECIDED 2026-11-02, coordinator,
 * under `plan/00` §6 item 313): the most recoverable from what is still sent
 * first, `contradictions` last because no digest can show one. Each names the
 * section it feeds, for the report's line. Read by {@link prepareComposition} and
 * `fitLines` in `scaffold.ts`.
 */
export const DROPPABLE_ANALYSIS_FIELDS = Object.freeze([
  { field: "representativePapers[].why", section: 4 },
  { field: "methodologicalPatterns", section: 5 },
  { field: "gaps", section: 8 },
  { field: "convergentFindings", section: 6 },
  { field: "contradictions", section: 7 },
] as const);

/** One entry's field name of {@link DROPPABLE_ANALYSIS_FIELDS}. */
export type DroppableAnalysisField =
  (typeof DROPPABLE_ANALYSIS_FIELDS)[number]["field"];

/** On a composed report whose first answer failed check 1 and was generated afresh. */
export const REGENERATED_WARNING = "report_regenerated_structure";

/** On a composed report whose `{{DIGESTS}}` were trimmed to fit the budget. */
export const DIGESTS_TRIMMED_WARNING = "report_digests_trimmed";

/** On a composed report in which check 2 replaced at least one marker. */
export const CITATIONS_REPLACED_WARNING = "report_citations_replaced";

/**
 * On a composed report whose stored `report.targetWords` was above
 * {@link TARGET_WORDS_MAX} and was sent as it (owner, `plan/00` §6 item
 * 312(c)); `P4-T12` builds the appendix line that says the target was capped.
 */
export const TARGET_WORDS_CAPPED_WARNING = "report_target_words_capped";

/**
 * On a composed report whose `max_tokens` was lowered to fit its input, or whose
 * word target was lowered to fit its output (`CompositionFit`). `P4-T12`'s
 * `scaffoldReport` writes the line.
 */
export const OUTPUT_LOWERED_WARNING = "report_output_lowered";

/** On a composed report whose theme analyses lost fields (`CompositionFit`). */
export const ANALYSES_SHORTENED_WARNING = "report_analyses_shortened";

/** Every run of whitespace or control characters. */
const BREAKING_RE = /[\s\p{Cc}]+/gu;

/** An ATX level-2 heading: up to three spaces, `##`, then a space, a tab or the end. */
const LEVEL2_RE = /^ {0,3}##(?:[ \t]+(.*))?$/;

/** Any ATX heading, for the sentences check 3 skips. */
const ANY_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/** A table separator row (`| --- | :---: |`). */
const TABLE_SEPARATOR_RE =
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A leading list, quote or numbering marker. */
const LINE_MARKER_RE = /^\s*(?:[-*+]|\d+[.)]|>)\s+/;

/** A resolved marker, as `validateCitations` leaves one. */
const RESOLVED_MARKER_RE = /\[\[[A-Z0-9]{8}\]\]/;

/** Any marker-shaped run, for removal before the factual test. */
const ANY_MARKER_RE = /\[\[[^[\]\r\n]*\]\]/g;

/** Where check 3 splits a line into sentences. */
const SENTENCE_END_RE = /(?<=[.!?])\s+/;

/** A decimal digit in any script. */
const DIGIT_RE = /\p{Nd}/u;

/** An English word of at least four letters ending in `ed`. */
const ED_WORD_RE = /\b[A-Za-z]{2,}ed\b/g;

/** Words ending in `ed` that are not past forms, for check 3. */
const ED_STOPLIST: ReadonlySet<string> = new Set([
  "need",
  "seed",
  "feed",
  "speed",
  "breed",
  "embed",
  "shed",
  "hundred",
  "indeed",
  "proceed",
  "exceed",
  "succeed",
]);

/** Common irregular English past forms, for check 3. */
const IRREGULAR_PAST: ReadonlySet<string> = new Set([
  "was",
  "were",
  "had",
  "did",
  "found",
  "made",
  "showed",
  "shown",
  "took",
  "gave",
  "saw",
  "led",
  "grew",
  "fell",
  "rose",
  "held",
  "began",
  "became",
  "ran",
  "met",
  "kept",
  "left",
  "brought",
  "thought",
  "chose",
  "drew",
  "wrote",
  "got",
  "went",
  "came",
  "built",
  "sought",
  "felt",
  "lost",
  "paid",
  "said",
  "told",
  "won",
  "spent",
  "knew",
  "meant",
  "taught",
]);

/** Hangul syllables U+AC00–U+D7A3: 28 final-consonant slots each; ㅆ is slot 20. */
const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const FINAL_SSANG_SIOS = 20;
/** 있 ("there is"), whose final ㅆ is not a past tense. */
const ISS = "있";

// ---------------------------------------------------------------------------
// 2. Types
// ---------------------------------------------------------------------------

/** One analysed paper, as the variables need it. */
export interface AnalysedPaper {
  readonly itemKey: string;
  /** The Zotero item's year; `undefined` when it has none. */
  readonly year: number | undefined;
  /** The stored summary's `content.sourceTier`. */
  readonly sourceTier: SourceTier;
  /** The Zotero item's `libraryCatalog`; untrusted. */
  readonly libraryCatalog: string | undefined;
}

/** One analysed theme: `P4-T07`'s analysis and the clustering's member count. */
export interface ComposeTheme {
  readonly analysis: ThemeAnalysis;
  /** The theme's members in the clustering, for §4's descending order. */
  readonly memberCount: number;
}

/** What `{{SOURCES}}` and `{{SEARCH_STRATEGY}}` read from one search record. */
export type SearchRunSummary = Pick<SearchProvenance, "userQuery"> & {
  readonly perSource: readonly Pick<SourceProvenance, "sourceId">[];
};

/** What the compose stage is given. */
export interface ComposeInput {
  readonly language: ReportLanguage;
  /** `{{COLLECTION_NAME}}`. */
  readonly collectionName: string;
  /** `{{USER_TOPIC}}`: the collection's topic. Untrusted. */
  readonly userTopic: string;
  /** `{{N_TOTAL}}`: the items the run started from. */
  readonly totalCount: number;
  /** One per analysed paper; keys unique. The run's valid set. */
  readonly analysed: readonly AnalysedPaper[];
  /** Appendix A's rows; disjoint from {@link analysed}. */
  readonly excluded: readonly ExcludedItem[];
  /** The collection's search records, oldest first; empty for a hand-built collection. */
  readonly searchRuns: readonly SearchRunSummary[];
  /** The analysed themes; at least one. */
  readonly themes: readonly ComposeTheme[];
  /** One per analysed paper at most, in the order to list them; keys unique. */
  readonly digests: readonly Digest[];
  /** The stored `report.targetWords` (`docs/07` §8.5). */
  readonly targetWords: number;
  /** Dropped duplicate → kept key (`findCollectionDuplicates`). */
  readonly duplicateOf: ReadonlyMap<string, string>;
  /** `{{REVISION_NOTES}}` from a `SELF_CRITIQUE` rewrite (`P4-T09`); empty on a first pass. */
  readonly revisionNotes?: string;
  /** Check 2's replacement text; `P4-T21` passes the Korean one (item 292(b)). */
  readonly citationReplacement?: string;
  /**
   * The input budget: `docs/06` §5.2's 60 000 when absent. A smaller whole
   * number forces trimming for one run (tests); it is never raised. With
   * `windowLimits`, the budget at the prompt's ceiling.
   */
  readonly inputBudget?: number;
  /**
   * The report model's window and output limit, each when known. Set by
   * `execute` in `trendReportPipeline.ts`. Lets {@link prepareComposition}
   * lower `max_tokens` and cap the word target; without it neither happens.
   */
  readonly windowLimits?: ModelWindowLimits;
}

/** One streamed piece of a generation's text. */
export interface DraftDelta {
  /** 1 for the first answer, 2 for the regeneration. */
  readonly generation: number;
  readonly deltaText: string;
  /**
   * The report this delta belongs to. Set by `execute` in
   * `trendReportPipeline.ts`, not here, on a `both` run's deltas (`P4-T21`);
   * read by `reduceReportRun`, which restarts the preview when it changes.
   */
  readonly language?: ReportLanguage;
}

/** What {@link composeReport} needs from the job — its context, in pieces. */
export interface ComposeDeps {
  /** `PipelineContext.llm`: the budgeted router (`withBudget`). */
  readonly llm: Pick<
    LLMRouter,
    "activeProvider" | "resolveModel" | "chatStream"
  >;
  /** `PipelineContext.budget`, passed on every request (`plan/07` §0.2 item 11). */
  readonly budget: BudgetGuard;
  readonly token: CancellationToken;
  /** The plugin's `llm` pool: one permit per request. */
  readonly pool: Pick<LlmPool, "acquire">;
  /** The active `TREND_REPORT_EN` or `TREND_REPORT_KO` template, matching the language. */
  readonly reportPrompt: PromptTemplate;
  /** Every non-empty delta, in order (`P4-T20`'s draft preview, through `P4-T18`). */
  readonly onDraft?: (delta: DraftDelta) => void;
  /** Passed on the call context. */
  readonly progress?: ProgressReporter;
  /** The privacy mode's routing hints, when the run has them. */
  readonly routing?: ProviderRoutingHints;
  /** Where check 2 logs each replacement and this module its warnings. */
  readonly logger?: Logger;
  /** Prefix of each request's `traceId`. */
  readonly traceId?: string;
}

/** Which digests a request carries (`docs/06` §8.3). */
export type DigestSelection = "all" | "cited" | "representative";

/**
 * What {@link prepareComposition} changed to fit, present only when it changed
 * something. Read by `scaffoldReport` and `stageInputsOf`. Optional on
 * {@link CompositionPlan} because a report cached before 2026-11-02 has none.
 */
export interface CompositionFit {
  /** The output the request has: `max_tokens`, clamped to the model's limit. */
  readonly outputTokens: number;
  /** `max_tokens` was lowered for the input's sake. */
  readonly outputLowered: boolean;
  /** `{{TARGET_WORDS}}` as sent. */
  readonly targetWords: number;
  /** `{{TARGET_WORDS}}` is below what the settings ask for. */
  readonly targetWordsLowered: boolean;
  /** The fields dropped from every analysis, in {@link DROPPABLE_ANALYSIS_FIELDS}' order. */
  readonly droppedFields: readonly DroppableAnalysisField[];
  /** What `{{REVISION_NOTES}}` tells the model about them; empty when none. */
  readonly modelNote: string;
}

/** What will be sent, before any request: step 1 and step 2. */
export interface CompositionPlan {
  /** Every variable but `REVISION_NOTES`. */
  readonly variables: Readonly<Record<string, string>>;
  readonly scope: ReportScope;
  /** `{{TARGET_WORDS}}` as sent. */
  readonly targetWords: number;
  /** The stored `report.targetWords` was above {@link TARGET_WORDS_MAX} and was sent as it (item 312(c)). */
  readonly targetWordsCapped: boolean;
  readonly digestSelection: DigestSelection;
  /** The digests sent, in order. */
  readonly digestKeys: readonly string[];
  /** The analyses sent, in order (§4's descending member count). */
  readonly themeIds: readonly string[];
  /** The rendered request's raw `estTokens`, with the caller's revision notes. */
  readonly requestTokens: number;
  readonly inputBudget: number;
  /** `max_tokens` as sent: the prompt's ceiling unless lowered. */
  readonly maxOutputTokens: number;
  /** See {@link CompositionFit}. */
  readonly fit?: CompositionFit;
}

/** What {@link checkHeadings} found. */
export interface HeadingCheck {
  readonly ok: boolean;
  /** The level-2 headings outside fences, normalised, in order. */
  readonly found: readonly string[];
  /** Expected headings absent, in the expected order. */
  readonly missing: readonly string[];
  /** Level-2 headings not in the expected list. */
  readonly unexpected: number;
  /** An expected heading appeared more than once. */
  readonly repeated: boolean;
  /** The expected headings present were not in the expected order. */
  readonly outOfOrder: boolean;
}

/** `docs/12` §10's checks 3–5, for Appendix B. */
export interface ComposeQuality extends Pick<
  ReportQualityProxies,
  "citationDensity" | "coverageRatio" | "brokenCitationCount"
> {
  /** Check 3's counts. */
  readonly factualSentences: number;
  readonly citedFactualSentences: number;
  /** Check 4: distinct keys cited in §1–§10. */
  readonly distinctCitedInBody: number;
  /** Check 5: markers inside code fences. */
  readonly fencedMarkerCount: number;
}

interface ComposeOutcomeBase {
  readonly language: ReportLanguage;
  readonly plan: CompositionPlan;
  /** Requests sent: 1, or 2 after a regeneration. */
  readonly requests: number;
  /** Summed over every answer received; a field is `undefined` if any lacked it. */
  readonly usage: Usage;
  readonly prompt: TrendPromptUse;
  /** The first answer's check 1 when it failed. */
  readonly firstStructureFailure?: HeadingCheck;
}

/** A report that passed check 1, with check 2 applied and checks 3–5 measured. */
export interface ComposedReport extends ComposeOutcomeBase {
  readonly status: "composed";
  /** The validated report: invalid markers replaced, duplicates rewritten. */
  readonly markdown: string;
  /** Text before `## 1.`, validated too; usually empty. */
  readonly preamble: string;
  /** The eleven sections, in order, after the citation pass. */
  readonly sections: readonly ReportSection[];
  /** Check 2's result over the whole answer. */
  readonly citations: CitationValidation;
  readonly quality: ComposeQuality;
  /**
   * {@link REGENERATED_WARNING}, {@link DIGESTS_TRIMMED_WARNING},
   * {@link CITATIONS_REPLACED_WARNING}, {@link TARGET_WORDS_CAPPED_WARNING},
   * {@link OUTPUT_LOWERED_WARNING}, {@link ANALYSES_SHORTENED_WARNING}.
   */
  readonly warnings: readonly string[];
}

/**
 * The regeneration failed check 1 too. The run stops before anything is
 * written and says why; the summaries and cached stage results are kept
 * (owner, `plan/00` §6 item 311(a); `docs/12` §10's note of 2026-10-30,
 * reading (3)). No third request and no report text. `P4-T18` ends the job on
 * it, as on the other report stops — on a first composition only: when a
 * `P4-T09` rewrite returns it, `critique.ts` keeps the earlier draft that
 * passed check 1 and the run goes on (owner, `plan/00` §6 item 312(b)).
 */
export interface StructureInvalidOutcome extends ComposeOutcomeBase {
  readonly status: "stopped-structure-invalid";
  readonly messageId: typeof STRUCTURE_INVALID_L10N;
  /** The second answer's check. */
  readonly structure: HeadingCheck;
}

export type ComposeOutcome = ComposedReport | StructureInvalidOutcome;

// ---------------------------------------------------------------------------
// 3. Step 1 — the computed variables
// ---------------------------------------------------------------------------

/** One line: every breaking run one space, trimmed. */
function oneLine(value: string): string {
  return value.replace(BREAKING_RE, " ").trim();
}

/**
 * `docs/06` §9.2's word target for `papers` analysed papers: the middle of
 * the row's range, rounded to the nearest 50 (`docs/06` §9.2's note of
 * 2026-10-29). The first row also serves fewer than 10 papers, the last more
 * than 400.
 */
export function targetWordsFor(papers: number): number {
  const last = TARGET_WORD_BANDS[
    TARGET_WORD_BANDS.length - 1
  ] as TargetWordBand;
  const row =
    TARGET_WORD_BANDS.find((band) => papers <= band.maxPapers) ?? last;
  return Math.round((row.minWords + row.maxWords) / 2 / 50) * 50;
}

/**
 * `{{TARGET_WORDS}}` from the stored `report.targetWords` (`plan/07` `P4-T08`
 * step 5): `0`, and 1–399, which `PrefDef` cannot refuse, are automatic
 * (owner, `plan/00` §6 item 290(d)); 400 to {@link TARGET_WORDS_MAX} is sent
 * as stored, and above it is sent as {@link TARGET_WORDS_MAX} (owner, item
 * 312(c); {@link isTargetWordsCapped} says when).
 *
 * @throws RangeError for a value that is not a whole number of at least 0
 */
export function resolveTargetWords(stored: number, papers: number): number {
  if (!Number.isInteger(stored) || stored < 0) {
    throw new RangeError(
      `[research-helper] report.targetWords is a whole number of at least 0, not ${String(stored)}`,
    );
  }
  if (stored < TARGET_WORDS_MIN) return targetWordsFor(papers);
  return Math.min(stored, TARGET_WORDS_MAX);
}

/**
 * Whether {@link resolveTargetWords} capped the stored `report.targetWords`
 * at {@link TARGET_WORDS_MAX} (owner, `plan/00` §6 item 312(c)).
 */
export function isTargetWordsCapped(stored: number): boolean {
  return stored > TARGET_WORDS_MAX;
}

/**
 * `{{EXCLUSION_REASONS}}`: Appendix A's codes counted, as
 * {@link EXCLUSION_PHRASES} names them, in that order, then any other code
 * (underscores as spaces) in first-appearance order; {@link NO_EXCLUSIONS}
 * when there is none.
 */
export function exclusionReasons(excluded: readonly ExcludedItem[]): string {
  const counts = new Map<string, number>();
  const others: string[] = [];
  for (const row of excluded) {
    const known = EXCLUSION_PHRASES.find((phrase) =>
      phrase.code.endsWith(":")
        ? row.reason.startsWith(phrase.code)
        : row.reason === phrase.code,
    );
    const id = known?.code ?? row.reason;
    if (known === undefined && !counts.has(id)) others.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return NO_EXCLUSIONS;
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const phrase of EXCLUSION_PHRASES) {
    const n = counts.get(phrase.code);
    if (n === undefined) continue;
    const text = n === 1 ? phrase.one : phrase.many;
    // Two codes share "non-English": one entry, their counts summed.
    if (seen.has(text)) {
      const at = parts.findIndex((p) => p.endsWith(` ${text}`));
      const before = Number.parseInt(parts[at] ?? "0", 10);
      parts[at] = `${String(before + n)} ${text}`;
      continue;
    }
    seen.add(text);
    parts.push(`${String(n)} ${text}`);
  }
  for (const code of others) {
    parts.push(`${String(counts.get(code) ?? 0)} ${code.replace(/_/g, " ")}`);
  }
  return oneLine(parts.join(", "));
}

/**
 * `{{SOURCES}}` (owner, `plan/00` §6 item 286): every source the search
 * records asked, by its catalogue label, each once; else the analysed items'
 * distinct `libraryCatalog` values; else {@link SOURCES_NOT_RECORDED}.
 */
export function sourcesOf(
  runs: readonly SearchRunSummary[],
  analysed: readonly AnalysedPaper[],
): string {
  const names: string[] = [];
  const add = (name: string): void => {
    const line = oneLine(name);
    if (line !== "" && !names.includes(line)) names.push(line);
  };
  for (const run of runs) {
    for (const source of run.perSource) {
      add(SOURCE_CATALOG_LABELS[source.sourceId]);
    }
  }
  if (names.length === 0) {
    for (const paper of analysed) add(paper.libraryCatalog ?? "");
  }
  return names.length === 0 ? SOURCES_NOT_RECORDED : names.join(", ");
}

/** `{{SEARCH_STRATEGY}}`: each distinct query, else {@link MANUALLY_CURATED}. */
export function searchStrategyOf(runs: readonly SearchRunSummary[]): string {
  const queries: string[] = [];
  for (const run of runs) {
    const query = oneLine(run.userQuery);
    if (query !== "" && !queries.includes(query)) queries.push(query);
  }
  return queries.length === 0 ? MANUALLY_CURATED : queries.join("; ");
}

/** The counts and years `docs/12` §10 names, computed. */
export function reportScopeOf(input: ComposeInput): ReportScope {
  const years = input.analysed.flatMap((paper) =>
    paper.year === undefined ? [] : [paper.year],
  );
  const fullText = input.analysed.filter(
    (paper) =>
      paper.sourceTier === "fulltext_pdf" ||
      paper.sourceTier === "fulltext_epmc",
  ).length;
  return {
    totalCount: input.totalCount,
    analysedCount: input.analysed.length,
    excludedCount: input.excluded.length,
    fullTextCount: fullText,
    abstractCount: input.analysed.length - fullText,
    yearMin: years.length === 0 ? undefined : Math.min(...years),
    yearMax: years.length === 0 ? undefined : Math.max(...years),
  };
}

/** A year as `{{YEAR_MIN}}`/`{{YEAR_MAX}}` sends it. */
function yearVariable(year: number | undefined): string {
  return year === undefined ? DIGEST_NO_YEAR : String(year);
}

/**
 * Step 1: every variable but `{{THEME_ANALYSES_JSON}}`, `{{DIGESTS}}` and
 * `{{REVISION_NOTES}}`, and the scope and word target they come from.
 */
export function reportVariables(input: ComposeInput): {
  readonly variables: Readonly<Record<string, string>>;
  readonly scope: ReportScope;
  readonly targetWords: number;
  readonly targetWordsCapped: boolean;
} {
  const scope = reportScopeOf(input);
  const targetWords = resolveTargetWords(
    input.targetWords,
    scope.analysedCount,
  );
  return {
    scope,
    targetWords,
    targetWordsCapped: isTargetWordsCapped(input.targetWords),
    variables: {
      COLLECTION_NAME: oneLine(input.collectionName),
      USER_TOPIC: oneLine(input.userTopic),
      N_TOTAL: String(scope.totalCount),
      N_ANALYSED: String(scope.analysedCount),
      N_EXCLUDED: String(scope.excludedCount),
      N_FULLTEXT: String(scope.fullTextCount),
      N_ABSTRACT: String(scope.abstractCount),
      EXCLUSION_REASONS: exclusionReasons(input.excluded),
      YEAR_MIN: yearVariable(scope.yearMin),
      YEAR_MAX: yearVariable(scope.yearMax),
      SOURCES: sourcesOf(input.searchRuns, input.analysed),
      SEARCH_STRATEGY: searchStrategyOf(input.searchRuns),
      TARGET_WORDS: String(targetWords),
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Step 2 — what is sent, inside the budget
// ---------------------------------------------------------------------------

/** The template a language needs. */
function promptIdFor(
  language: ReportLanguage,
): "TREND_REPORT_EN" | "TREND_REPORT_KO" {
  return language === "ko" ? "TREND_REPORT_KO" : "TREND_REPORT_EN";
}

/**
 * The eleven `## ` headings the template asks for, as its user text writes
 * them.
 *
 * @throws ConfigurationError when the template is not a report prompt with
 *   eleven numbered headings
 */
export function expectedHeadings(prompt: PromptTemplate): readonly string[] {
  const headings = prompt.user
    .split("\n")
    .flatMap((line) =>
      line.startsWith("## ") ? [normaliseHeading(line.slice(3))] : [],
    );
  const numbered = headings.every((heading, index) =>
    heading.startsWith(`${String(index + 1)}. `),
  );
  if (headings.length !== REPORT_SECTION_COUNT || !numbered) {
    throw new ConfigurationError(
      `${prompt.id} does not list the eleven numbered report sections`,
      { promptId: prompt.id, headings: headings.length },
    );
  }
  return headings;
}

function checkInput(input: ComposeInput, prompt: PromptTemplate): void {
  const id = promptIdFor(input.language);
  if (prompt.id !== id || prompt.outputFormat !== "markdown") {
    throw new ConfigurationError(
      `composeReport needs the ${id} template for a "${input.language}" report`,
      { promptId: prompt.id },
    );
  }
  const analysed = new Set<string>();
  for (const paper of input.analysed) {
    if (!ITEM_KEY_RE.test(paper.itemKey) || analysed.has(paper.itemKey)) {
      throw new RangeError(
        `[research-helper] analysed papers need distinct item keys; ${JSON.stringify(paper.itemKey)} is not one`,
      );
    }
    if (
      paper.year !== undefined &&
      (!Number.isInteger(paper.year) || paper.year < 0 || paper.year > 9999)
    ) {
      throw new RangeError(
        `[research-helper] a year is a whole number 0–9999 or undefined, not ${String(paper.year)}`,
      );
    }
    analysed.add(paper.itemKey);
  }
  if (input.excluded.some((row) => analysed.has(row.itemKey))) {
    throw new RangeError(
      "[research-helper] an excluded item cannot also be analysed",
    );
  }
  if (
    !Number.isInteger(input.totalCount) ||
    input.totalCount < input.analysed.length + input.excluded.length
  ) {
    throw new RangeError(
      `[research-helper] totalCount ${String(input.totalCount)} is less than the analysed and excluded items`,
    );
  }
  const digested = new Set<string>();
  for (const digest of input.digests) {
    if (!analysed.has(digest.itemKey) || digested.has(digest.itemKey)) {
      throw new RangeError(
        `[research-helper] a digest must be an analysed paper's, once each; ${digest.itemKey} is not`,
      );
    }
    digested.add(digest.itemKey);
  }
  if (input.themes.length === 0) {
    throw new RangeError(
      "[research-helper] composeReport needs at least one analysed theme",
    );
  }
  const budget = input.inputBudget;
  if (
    budget !== undefined &&
    (!Number.isInteger(budget) ||
      budget < 1 ||
      budget > SYNTHESIS_INPUT_BUDGETS[id])
  ) {
    throw new RangeError(
      `[research-helper] inputBudget is a whole number from 1 to ${String(SYNTHESIS_INPUT_BUDGETS[id])}`,
    );
  }
}

/** The analyses in §4's order: descending member count, ties in the given order. */
function orderedThemes(
  themes: readonly ComposeTheme[],
): readonly ThemeAnalysis[] {
  return themes
    .map((theme, index) => ({ theme, index }))
    .sort(
      (a, b) => b.theme.memberCount - a.theme.memberCount || a.index - b.index,
    )
    .map(({ theme }) => theme.analysis);
}

/** One analysis without the first `steps` of {@link DROPPABLE_ANALYSIS_FIELDS}. */
function shortenedAnalysis(
  analysis: ThemeAnalysis,
  steps: number,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...analysis };
  for (const { field } of DROPPABLE_ANALYSIS_FIELDS.slice(0, steps)) {
    if (field === "representativePapers[].why") {
      out["representativePapers"] = analysis.representativePapers.map(
        ({ itemKey }) => ({ itemKey }),
      );
    } else {
      out[field] = undefined;
    }
  }
  return out;
}

/** What {@link CompositionFit.modelNote} says: the fields, and that absence is not evidence. */
function droppedFieldsNote(fields: readonly string[]): string {
  return `To fit the model's limits, these fields were removed from every theme analysis: ${fields.join(", ")}. Their absence says nothing about the corpus. Where a section draws on them, write only what the narratives, trajectories and digests support, and do not state that the corpus has none of them.`;
}

/** Every variable, rendered, measured: system and user text by raw `estTokens`. */
function renderedTokens(
  prompt: PromptTemplate,
  variables: Readonly<Record<string, string>>,
): number {
  const rendered = renderPrompt(prompt, variables);
  return estTokens(rendered.system) + estTokens(rendered.user);
}

/**
 * Steps 1 and 2, before any request: the variables, and `{{DIGESTS}}` trimmed
 * until the rendered request is inside the budget (`docs/12` §10's note of
 * 2026-10-29, reading (7)): every digest; else those of items an analysis
 * names or cites; else those of its representative papers. When even those do
 * not fit, in the owner's order (`docs/06` §8.4's note of 2026-11-02):
 * `max_tokens` lowered as far as the input needs, down to
 * {@link REPORT_OUTPUT_FLOOR}, with `{{TARGET_WORDS}}` following; then
 * {@link DROPPABLE_ANALYSIS_FIELDS}, one step at a time.
 *
 * @param input - see {@link ComposeInput}
 * @param prompt - the language's template
 * @param model - the report model, named by the error when nothing fits
 * @throws ConfigurationError for the wrong template; RangeError for an
 *   inconsistent input; ContextLengthExceededError when the request does not
 *   fit at the floor with every droppable field dropped
 */
export function prepareComposition(
  input: ComposeInput,
  prompt: PromptTemplate,
  model?: Pick<ResolvedModel, "providerId" | "modelId">,
): CompositionPlan {
  checkInput(input, prompt);
  expectedHeadings(prompt);
  const { variables, scope, targetWords, targetWordsCapped } =
    reportVariables(input);
  const analyses = orderedThemes(input.themes);
  const themeIds = analyses.map((analysis) => analysis.themeId);
  const kind = promptIdFor(input.language);
  const limits = input.windowLimits ?? {};
  const ceiling = resolveMaxTokens(prompt);
  const budget =
    input.inputBudget ?? windowInputBudget(kind, limits, ceiling, 0);
  // The output the request can have at all, and the lowest it may be lowered to.
  const roomiest = Math.min(ceiling, limits.maxOutputTokens ?? ceiling);
  const floor = Math.min(roomiest, REPORT_OUTPUT_FLOOR);
  const budgetAt = (output: number): number =>
    output >= roomiest || limits.contextWindowTokens === undefined
      ? budget
      : windowInputBudget(kind, limits, output, 0);
  const wordsAt = (output: number): number =>
    Math.min(
      targetWords,
      Math.max(TARGET_WORDS_MIN, targetWordsForOutput(input.language, output)),
    );
  const fitOf = (
    output: number,
    words: number,
    droppedFields: readonly DroppableAnalysisField[],
  ): CompositionFit | undefined =>
    output >= roomiest && words >= targetWords && droppedFields.length === 0
      ? undefined
      : {
          outputTokens: output,
          outputLowered: output < roomiest,
          targetWords: words,
          targetWordsLowered: words < targetWords,
          droppedFields,
          modelNote:
            droppedFields.length === 0 ? "" : droppedFieldsNote(droppedFields),
        };
  const callerNotes = input.revisionNotes ?? "";
  const roomiestWords = wordsAt(roomiest);
  const base = {
    ...variables,
    TARGET_WORDS: String(roomiestWords),
    THEME_ANALYSES_JSON: JSON.stringify(analyses),
    REVISION_NOTES: callerNotes,
  };

  const named = new Set(
    analyses.flatMap((analysis) =>
      analysis.representativePapers.map((paper) => paper.itemKey),
    ),
  );
  const cited = new Set([
    ...named,
    ...analyses.flatMap((analysis) => citedKeysOfAnalysis(analysis)),
  ]);
  const fewest = input.digests.filter((digest) => named.has(digest.itemKey));
  const choices: readonly (readonly [DigestSelection, readonly Digest[]])[] = [
    ["all", input.digests],
    ["cited", input.digests.filter((digest) => cited.has(digest.itemKey))],
    ["representative", fewest],
  ];
  for (const [selection, digests] of choices) {
    const tokens = renderedTokens(prompt, {
      ...base,
      DIGESTS: digests.map(digestText).join("\n"),
    });
    if (tokens <= budget) {
      const { REVISION_NOTES: _notes, ...sent } = {
        ...base,
        DIGESTS: digests.map(digestText).join("\n"),
      };
      const fit = fitOf(roomiest, roomiestWords, []);
      return {
        variables: sent,
        scope,
        targetWords: roomiestWords,
        targetWordsCapped,
        digestSelection: selection,
        digestKeys: digests.map((digest) => digest.itemKey),
        themeIds,
        requestTokens: tokens,
        inputBudget: budget,
        maxOutputTokens: ceiling,
        ...(fit !== undefined && { fit }),
      };
    }
  }

  // Making room, with the fewest digests: output first, then the analyses.
  for (let steps = 0; steps <= DROPPABLE_ANALYSIS_FIELDS.length; steps += 1) {
    const droppedFields = DROPPABLE_ANALYSIS_FIELDS.slice(0, steps).map(
      (entry) => entry.field,
    );
    const note =
      droppedFields.length === 0 ? "" : droppedFieldsNote(droppedFields);
    const sent = {
      ...variables,
      THEME_ANALYSES_JSON: JSON.stringify(
        analyses.map((analysis) => shortenedAnalysis(analysis, steps)),
      ),
      DIGESTS: fewest.map(digestText).join("\n"),
    };
    const measure = (words: number): number =>
      renderedTokens(prompt, {
        ...sent,
        TARGET_WORDS: String(words),
        REVISION_NOTES:
          note === "" ? callerNotes : joinNotes(callerNotes, note),
      });
    const atFloor = measure(wordsAt(floor));
    if (atFloor > budgetAt(floor)) continue;
    // As high as this input leaves room for: a window not known has no such
    // limit, and a budget only the §5.2 row sets does not depend on the output.
    const window = limits.contextWindowTokens;
    const spare =
      window === undefined
        ? roomiest
        : window - RESERVE_TOKENS - withHeadroom(atFloor);
    let output = Math.max(floor, Math.min(roomiest, spare));
    let words = wordsAt(output);
    let tokens = measure(words);
    if (tokens > budgetAt(output)) {
      output = floor;
      words = wordsAt(floor);
      tokens = atFloor;
    }
    const fit = fitOf(output, words, droppedFields);
    return {
      variables: { ...sent, TARGET_WORDS: String(words) },
      scope,
      targetWords: words,
      targetWordsCapped,
      digestSelection: "representative",
      digestKeys: fewest.map((digest) => digest.itemKey),
      themeIds,
      requestTokens: tokens,
      inputBudget: budgetAt(output),
      maxOutputTokens: output >= roomiest ? ceiling : output,
      ...(fit !== undefined && { fit }),
    };
  }
  throw new ContextLengthExceededError(
    model?.providerId ?? "",
    model?.modelId ?? "",
    "the report request does not fit its input budget even with the representative papers' digests, the lowest output and every secondary analysis field dropped",
    { budget: budgetAt(floor), themes: analyses.length },
  );
}

// ---------------------------------------------------------------------------
// 5. Step 4 — the checks
// ---------------------------------------------------------------------------

/** A heading's text as compared: trimmed, whitespace folded, a closing `#` run dropped. */
function normaliseHeading(text: string): string {
  return text
    .replace(/[ \t]+#+[ \t]*$/, "")
    .replace(/^#+$/, "")
    .replace(BREAKING_RE, " ")
    .trim();
}

/** One level-2 heading outside fences: its normalised text and line span. */
interface HeadingHit {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Every level-2 heading outside code fences, in order. */
function level2Headings(markdown: string): readonly HeadingHit[] {
  const fences = fencedRanges(markdown);
  const hits: HeadingHit[] = [];
  let offset = 0;
  for (const line of markdown.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (fences.some(([from, to]) => start >= from && start < to)) continue;
    const match = LEVEL2_RE.exec(line.replace(/\r$/, ""));
    if (match === null) continue;
    hits.push({
      text: normaliseHeading(match[1] ?? ""),
      start,
      end: start + line.length,
    });
  }
  return hits;
}

/**
 * Check 1 (`docs/12` §10): the eleven expected level-2 headings, in order,
 * with no other.
 *
 * @param markdown - the model's answer
 * @param expected - {@link expectedHeadings}
 */
export function checkHeadings(
  markdown: string,
  expected: readonly string[],
): HeadingCheck {
  const found = level2Headings(markdown).map((hit) => hit.text);
  const missing = expected.filter((heading) => !found.includes(heading));
  const unexpected = found.filter(
    (heading) => !expected.includes(heading),
  ).length;
  const repeated = expected.some(
    (heading) => found.filter((f) => f === heading).length > 1,
  );
  const positions = found
    .map((heading) => expected.indexOf(heading))
    .filter((at, index, all) => at >= 0 && all.indexOf(at) === index);
  const outOfOrder = positions.some(
    (at, index) => index > 0 && at < (positions[index - 1] as number),
  );
  const ok =
    found.length === expected.length &&
    found.every((heading, index) => heading === expected[index]);
  return { ok, found, missing, unexpected, repeated, outOfOrder };
}

/**
 * The structure note the one fresh generation adds to `{{REVISION_NOTES}}`
 * (`docs/12` §10's note of 2026-10-29, reading (2)). It names the missing
 * expected headings by their exact text and quotes nothing from the answer.
 * The wording is approved as drafted (owner, `plan/00` §6 item 311(b),
 * 2026-10-30).
 */
export function structureRevisionNote(check: HeadingCheck): string {
  const problems: string[] = [];
  if (check.missing.length > 0) {
    problems.push(
      `Missing: ${check.missing.map((heading) => `## ${heading}`).join("; ")}.`,
    );
  }
  if (check.unexpected > 0) {
    problems.push(
      `It had ${String(check.unexpected)} level-2 ${check.unexpected === 1 ? "heading" : "headings"} that ${check.unexpected === 1 ? "is" : "are"} not in the list.`,
    );
  }
  if (check.repeated) {
    problems.push("A required heading appeared more than once.");
  }
  if (check.outOfOrder) {
    problems.push("The required headings were not in the required order.");
  }
  return [
    "STRUCTURE CORRECTION: the previous attempt at this report did not have exactly the eleven level-2 sections required above.",
    ...problems,
    "Write the whole report again. Use exactly the eleven level-2 headings listed above, each written exactly as shown and in that order, and no other level-2 heading.",
  ].join(" ");
}

/**
 * The validated report cut at its eleven headings. Call only after
 * {@link checkHeadings} passed on the same text's headings.
 */
export function splitSections(
  markdown: string,
  expected: readonly string[],
): { readonly preamble: string; readonly sections: readonly ReportSection[] } {
  const hits = level2Headings(markdown);
  if (
    hits.length !== expected.length ||
    hits.some((hit, index) => hit.text !== expected[index])
  ) {
    throw new RangeError(
      "[research-helper] splitSections needs a text that passed check 1",
    );
  }
  const trimBlankLines = (text: string): string =>
    text.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
  const sections = hits.map((hit, index): ReportSection => {
    const next = hits[index + 1];
    const body = trimBlankLines(
      markdown.slice(
        hit.end + 1,
        next === undefined ? markdown.length : next.start,
      ),
    );
    return {
      number: (index + 1) as ReportSectionNumber,
      heading: hit.text,
      markdown: body,
      citedItemKeys: citedKeysOf(body),
    };
  });
  const first = hits[0] as HeadingHit;
  return {
    preamble: trimBlankLines(markdown.slice(0, first.start)),
    sections,
  };
}

/** Whether a sentence, its markers removed, reads as a factual claim (check 3). */
function isFactual(
  sentence: string,
  language: ReportLanguage,
  replacement: string,
): boolean {
  const text = sentence
    .split(replacement)
    .join(" ")
    .replace(ANY_MARKER_RE, " ");
  if (DIGIT_RE.test(text)) return true;
  if (language === "ko") {
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (
        code >= HANGUL_FIRST &&
        code <= HANGUL_LAST &&
        (code - HANGUL_FIRST) % 28 === FINAL_SSANG_SIOS &&
        char !== ISS
      ) {
        return true;
      }
    }
    return false;
  }
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (IRREGULAR_PAST.has(word)) return true;
  }
  for (const match of text.matchAll(ED_WORD_RE)) {
    if (!ED_STOPLIST.has(match[0].toLowerCase())) return true;
  }
  return false;
}

/**
 * Check 3 (`docs/12` §10; its note of 2026-10-29, reading (5)) over the
 * sections it reads: §1 and §3–§10.
 *
 * @param sections - {@link splitSections}'s, validated
 * @param language - the report's
 * @param replacement - check 2's replacement text, removed before the test
 */
export function citationDensity(
  sections: readonly ReportSection[],
  language: ReportLanguage,
  replacement: string,
): {
  readonly factual: number;
  readonly cited: number;
  readonly density: number | undefined;
} {
  let factual = 0;
  let cited = 0;
  for (const section of sections) {
    if (section.number === 2 || section.number === 11) continue;
    const fences = fencedRanges(section.markdown);
    let offset = 0;
    for (const line of section.markdown.split("\n")) {
      const start = offset;
      offset += line.length + 1;
      if (fences.some(([from, to]) => start >= from && start < to)) continue;
      if (ANY_HEADING_RE.test(line) || TABLE_SEPARATOR_RE.test(line)) continue;
      let text = line;
      while (LINE_MARKER_RE.test(text)) text = text.replace(LINE_MARKER_RE, "");
      for (const sentence of text.split(SENTENCE_END_RE)) {
        if (sentence.trim() === "") continue;
        if (!isFactual(sentence, language, replacement)) continue;
        factual += 1;
        if (RESOLVED_MARKER_RE.test(sentence)) cited += 1;
      }
    }
  }
  return {
    factual,
    cited,
    density: factual === 0 ? undefined : cited / factual,
  };
}

// ---------------------------------------------------------------------------
// 6. Step 3 — the call, and the stage
// ---------------------------------------------------------------------------

const NO_USAGE: Usage = Object.freeze({
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
  costUsd: undefined,
});

function sumField(
  usages: readonly Usage[],
  field: keyof Usage,
): number | undefined {
  let total = 0;
  for (const usage of usages) {
    const value = usage[field];
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function sumUsage(usages: readonly Usage[]): Usage {
  return {
    inputTokens: sumField(usages, "inputTokens"),
    outputTokens: sumField(usages, "outputTokens"),
    totalTokens: sumField(usages, "totalTokens"),
    costUsd: sumField(usages, "costUsd"),
  };
}

/** Caller notes, then the structure note, one blank line apart. */
function joinNotes(callerNotes: string, structureNote: string): string {
  return callerNotes.trim() === ""
    ? structureNote
    : `${callerNotes.trimEnd()}\n\n${structureNote}`;
}

/**
 * Compose the report (`plan/07` `P4-T08`).
 *
 * @param input - see {@link ComposeInput}
 * @param deps - see {@link ComposeDeps}
 * @returns `composed` with the validated report, its sections and checks 3–5,
 *   or `stopped-structure-invalid` when the one fresh generation failed
 *   check 1 again
 * @throws ConfigurationError for the wrong template; RangeError for an
 *   inconsistent input; ContextLengthExceededError when the request cannot
 *   fit, before any request; and every error of the call unchanged — a
 *   cancel, a budget refusal, `OutputTruncatedError`, a network error — with
 *   no retry here (the router's policy already ran)
 */
export async function composeReport(
  input: ComposeInput,
  deps: ComposeDeps,
): Promise<ComposeOutcome> {
  const prompt = deps.reportPrompt;
  deps.token.throwIfCancelled();
  const model = deps.llm.resolveModel("strong");
  const plan = prepareComposition(input, prompt, model);
  const expected = expectedHeadings(prompt);
  const modelNote = plan.fit?.modelNote ?? "";
  const callerNotes =
    modelNote === ""
      ? (input.revisionNotes ?? "")
      : joinNotes(input.revisionNotes ?? "", modelNote);
  const usages: Usage[] = [];
  let requests = 0;

  const generate = async (
    generation: number,
    notes: string,
  ): Promise<string> => {
    deps.token.throwIfCancelled();
    const rendered = renderPrompt(prompt, {
      ...plan.variables,
      REVISION_NOTES: notes,
    });
    const request: ChatRequest = {
      model: model.modelId,
      messages: [
        { role: "system", content: rendered.system },
        { role: "user", content: rendered.user },
      ],
      temperature: prompt.defaultTemperature,
      maxOutputTokens: plan.maxOutputTokens,
      effort: REPORT_EFFORT,
      responseFormat: { kind: "text" },
      ...(deps.routing !== undefined && { routing: deps.routing }),
      traceId: `${deps.traceId ?? "trend-report"}:${input.language}:generation-${String(generation)}`,
      accounting: { promptId: prompt.id },
    };
    requests += 1;
    let text = "";
    let done = false;
    let usage: Usage | undefined;
    let callbackFailed = false;
    const release = await deps.pool.acquire(deps.token);
    try {
      for await (const chunk of deps.llm.chatStream(request, {
        token: deps.token,
        budget: deps.budget,
        ...(deps.progress !== undefined && { progress: deps.progress }),
      })) {
        if (done) continue;
        if (chunk.deltaText !== "") {
          text += chunk.deltaText;
          try {
            deps.onDraft?.({ generation, deltaText: chunk.deltaText });
          } catch (error) {
            if (!callbackFailed) {
              callbackFailed = true;
              deps.logger?.warn("report: the draft callback threw; ignored", {
                error: error instanceof Error ? error.name : typeof error,
              });
            }
          }
        }
        if (chunk.done) {
          done = true;
          usage = chunk.usage;
        }
      }
    } finally {
      release();
    }
    usages.push(usage ?? NO_USAGE);
    if (!done) {
      throw new NetworkError(
        "the report stream ended without its terminal chunk",
        { model: model.modelId },
      );
    }
    return text;
  };

  let firstFailure: HeadingCheck | undefined;
  const base = (): ComposeOutcomeBase => ({
    language: input.language,
    plan,
    requests,
    usage: sumUsage(usages),
    prompt: {
      promptId: prompt.id as TrendPromptUse["promptId"],
      promptVersion: prompt.version,
      modelId: model.modelId,
      temperature: prompt.defaultTemperature,
    },
    ...(firstFailure !== undefined && { firstStructureFailure: firstFailure }),
  });

  let answer = await generate(1, callerNotes);
  let structure = checkHeadings(answer, expected);
  if (!structure.ok) {
    firstFailure = structure;
    deps.logger?.warn(
      "report: the answer failed the section check; generated once more",
      {
        missing: structure.missing.length,
        unexpected: structure.unexpected,
        repeated: structure.repeated,
        outOfOrder: structure.outOfOrder,
      },
    );
    answer = await generate(
      REPORT_GENERATIONS_MAX,
      joinNotes(callerNotes, structureRevisionNote(structure)),
    );
    structure = checkHeadings(answer, expected);
    if (!structure.ok) {
      deps.logger?.warn(
        "report: the regenerated answer failed the section check too",
        {
          missing: structure.missing.length,
          unexpected: structure.unexpected,
          repeated: structure.repeated,
          outOfOrder: structure.outOfOrder,
        },
      );
      return {
        ...base(),
        status: "stopped-structure-invalid",
        messageId: STRUCTURE_INVALID_L10N,
        structure,
      };
    }
  }

  const validKeys = new Set(input.analysed.map((paper) => paper.itemKey));
  const replacement = input.citationReplacement;
  const logger: Logger = deps.logger ?? SILENT_LOGGER;
  const citations = validateCitations(answer, {
    validKeys,
    duplicateOf: input.duplicateOf,
    logger,
    ...(replacement !== undefined && { replacement }),
  });
  const { preamble, sections } = splitSections(citations.markdown, expected);
  const density = citationDensity(
    sections,
    input.language,
    replacement ?? INVALID_CITATION_TEXT,
  );
  const bodyKeys = new Set(
    sections
      .filter((section) => section.number !== 11)
      .flatMap((section) => section.citedItemKeys),
  );
  const quality: ComposeQuality = {
    citationDensity: density.density,
    factualSentences: density.factual,
    citedFactualSentences: density.cited,
    coverageRatio: validKeys.size === 0 ? 0 : bodyKeys.size / validKeys.size,
    distinctCitedInBody: bodyKeys.size,
    brokenCitationCount: citations.figures.brokenCitationCount,
    fencedMarkerCount: citations.figures.fencedMarkerCount,
  };
  const warnings = [
    ...(firstFailure !== undefined ? [REGENERATED_WARNING] : []),
    ...(plan.digestSelection !== "all" ? [DIGESTS_TRIMMED_WARNING] : []),
    ...(citations.removed.length > 0 ? [CITATIONS_REPLACED_WARNING] : []),
    ...(plan.targetWordsCapped ? [TARGET_WORDS_CAPPED_WARNING] : []),
    ...(plan.fit?.outputLowered === true ||
    plan.fit?.targetWordsLowered === true
      ? [OUTPUT_LOWERED_WARNING]
      : []),
    ...(plan.fit !== undefined && plan.fit.droppedFields.length > 0
      ? [ANALYSES_SHORTENED_WARNING]
      : []),
  ];
  return {
    ...base(),
    status: "composed",
    markdown: citations.markdown,
    preamble,
    sections,
    citations,
    quality,
    warnings,
  };
}

/** A logger that drops everything, when the caller passes none. */
const SILENT_LOGGER: Logger = {
  child: () => SILENT_LOGGER,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  time: (_msg, fn) => fn(),
};

/**
 * The trend-report types — `docs/07` §5.2's `// src/model/trend.ts` block
 * (`P4-T01`).
 *
 * **Scope.** Transcribed from `docs/07-architecture-and-data-model.md` §5.2,
 * which `plan/README.md` §5 rule 3 makes the sole authority for types. The
 * block replaced the earlier `ThemeCluster` and `TrendReport` on 2026-10-26
 * (owner, `plan/00` §6 item 286); §5.2's dated note says what changed and why.
 *
 * **Stage outputs are prompt contracts.** `ThemeClustering`, `ThemeAnalysis`
 * and `SelfCritique` are `docs/12` §8, §9 and §12's "Expected output" schemas
 * field for field, and `ThemeMerge` is `docs/06` §8.4 step 3's merge output:
 * a field required by a schema is required here, every other field is
 * optional, and the JSON schema files under `src/prompts/schemas/` are what
 * validate a model's answer at run time. These types describe the value once
 * it has validated.
 *
 * Types only: nothing here is constructed, and `model/` imports nothing but
 * `model/` (`docs/07` §2.3).
 */

import type { Doi, ProviderId } from "./ids";
import type { StoredRedactionMark } from "./summary";
import type { Usage } from "./usage";

// ---------------------------------------------------------------------------
// The digest — `docs/06` §8.2
// ---------------------------------------------------------------------------

/**
 * One line of `docs/06` §8.2's digest block, in the block's order:
 * `[KEY] year | design: … | pop: …`, `Q:`, `Methods:`, `Findings:`,
 * `Metrics:`, `Theme(first-pass):`, `Keywords:`, `Tier: … | Confidence: …`.
 */
export type DigestLineKind =
  | "head"
  | "question"
  | "methods"
  | "findings"
  | "metrics"
  | "theme"
  | "keywords"
  | "tier";

export interface DigestLine {
  readonly kind: DigestLineKind;
  /** The line as sent, its label included (`"Q: …"`). */
  readonly text: string;
}

/**
 * A deterministic, no-LLM projection of one summary (`docs/06` §8.2). The
 * block a prompt receives is the lines' `text`, joined by `"\n"`.
 */
export interface Digest {
  readonly itemKey: string;
  /** In {@link DigestLineKind}'s order. */
  readonly lines: readonly DigestLine[];
}

// ---------------------------------------------------------------------------
// `THEME_CLUSTER` — `docs/12` §8 "Expected output" (`ThemeClustering`)
// ---------------------------------------------------------------------------

export type ThemeFit = "strong" | "moderate" | "weak";

export interface ClusteredTheme {
  /** `^T[0-9]+$`. */
  readonly themeId: string;
  /** At most 80 characters. */
  readonly name: string;
  /** One sentence; at most 300 characters. */
  readonly definition: string;
  /** Zotero item keys, `^[A-Z0-9]{8}$`. */
  readonly itemKeys: readonly string[];
  /** At most 600 characters. */
  readonly rationale?: string;
}

export interface ThemeAssignment {
  readonly itemKey: string;
  readonly primaryThemeId: string;
  readonly secondaryThemeIds?: readonly string[];
  readonly fit: ThemeFit;
}

export interface UnclusteredItem {
  readonly itemKey: string;
  /** At most 300 characters. */
  readonly reason: string;
}

export interface ThemeClustering {
  /** At least one. */
  readonly themes: readonly ClusteredTheme[];
  readonly assignments: readonly ThemeAssignment[];
  readonly unclustered?: readonly UnclusteredItem[];
  /** Each at most 400 characters. */
  readonly crossCuttingObservations?: readonly string[];
}

// ---------------------------------------------------------------------------
// `THEME_MERGE` — `docs/06` §8.4 steps 3–4 (`ThemeMerge`)
// ---------------------------------------------------------------------------

/** A global theme of a two-stage clustering. */
export interface MergedTheme {
  /** `^T[0-9]+$`, as in {@link ClusteredTheme.themeId}. */
  readonly themeId: string;
  /** At most 80 characters. */
  readonly name: string;
  /** At most 300 characters. */
  readonly definition: string;
  /** At most 600 characters. */
  readonly rationale?: string;
}

export interface LocalThemeMapping {
  /** The batch-qualified local theme id the merge call was given, `^B[0-9]+-T[0-9]+$`. */
  readonly localThemeId: string;
  /**
   * The global theme it joins (`^T[0-9]+$`); `null` when it maps nowhere,
   * whose papers go to `unclustered` (`docs/06` §8.4 step 4).
   */
  readonly globalThemeId: string | null;
}

export interface ThemeMerge {
  /** At least one. */
  readonly themes: readonly MergedTheme[];
  /** One entry per local theme; at least one. */
  readonly mapping: readonly LocalThemeMapping[];
}

// ---------------------------------------------------------------------------
// `CLUSTER_REDUCE` and `CLUSTER_REDUCE_MERGE` — `docs/12` §9 (`ThemeAnalysis`)
// ---------------------------------------------------------------------------

export type FindingStrength = "strong" | "moderate" | "weak";

export interface RepresentativePaper {
  readonly itemKey: string;
  /** At most 300 characters. */
  readonly why: string;
}

export interface MethodologicalPattern {
  /** At most 300 characters. */
  readonly pattern: string;
  readonly itemKeys: readonly string[];
}

export interface ConvergentFinding {
  /** At most 500 characters. */
  readonly statement: string;
  /** At least one. */
  readonly itemKeys: readonly string[];
  readonly strength: FindingStrength;
}

export interface ContradictionSide {
  /** At most 400 characters. */
  readonly claim: string;
  /** At least one. */
  readonly itemKeys: readonly string[];
}

export interface Contradiction {
  /** At most 500 characters. */
  readonly statement: string;
  readonly sideA: ContradictionSide;
  readonly sideB: ContradictionSide;
  /** At most 400 characters. */
  readonly possibleExplanation?: string | null;
}

export interface ThemeGap {
  /** At most 400 characters. */
  readonly gap: string;
  /** Why the corpus shows this gap; at most 400 characters. */
  readonly basis: string;
  readonly itemKeys?: readonly string[];
}

/** One theme's analysis; also `CLUSTER_REDUCE_MERGE`'s output. */
export interface ThemeAnalysis {
  readonly themeId: string;
  /** At most 80 characters. */
  readonly name: string;
  /** Markdown with inline `[[itemKey]]` citations. */
  readonly narrative: string;
  /** One to six. */
  readonly representativePapers: readonly RepresentativePaper[];
  readonly methodologicalPatterns?: readonly MethodologicalPattern[];
  readonly convergentFindings?: readonly ConvergentFinding[];
  readonly contradictions?: readonly Contradiction[];
  readonly gaps?: readonly ThemeGap[];
  /** At most 900 characters. */
  readonly trajectory: string;
}

// ---------------------------------------------------------------------------
// `SELF_CRITIQUE` — `docs/12` §12 (`SelfCritique`)
// ---------------------------------------------------------------------------

export type CritiqueVerdict = "pass" | "revise" | "reject";

export type CritiqueProblemType =
  | "unsupported"
  | "misattributed"
  | "number_error"
  | "overgeneralized"
  | "outside_knowledge"
  | "missing_contradiction"
  | "abstract_overreach"
  | "broken_citation";

export type CritiqueSeverity = "high" | "medium" | "low";

export interface CritiqueProblem {
  readonly type: CritiqueProblemType;
  readonly severity: CritiqueSeverity;
  /** The section heading where it appears; at most 200 characters. */
  readonly section?: string;
  /** The offending sentence, verbatim; at most 800 characters. */
  readonly quote: string;
  /** At most 600 characters. */
  readonly explanation: string;
  /** At most 120 characters. */
  readonly suggestedFix?: string;
}

export interface CitationCoverage {
  /** A non-negative integer. */
  readonly factualSentences?: number;
  /** A non-negative integer. */
  readonly citedSentences?: number;
  readonly brokenCitations?: readonly string[];
}

export interface SelfCritique {
  readonly verdict: CritiqueVerdict;
  readonly problems: readonly CritiqueProblem[];
  readonly citationCoverage?: CitationCoverage;
}

// ---------------------------------------------------------------------------
// The report record — `docs/06` §9.1, stored in `docs/07` §8.3's `report` table
// ---------------------------------------------------------------------------

/** One record per language: `reportLanguage` `both` saves two. */
export type ReportLanguage = "en" | "ko";

/** `docs/06` §9.1's eleven level-2 sections, by number. */
export type ReportSectionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface ReportSection {
  readonly number: ReportSectionNumber;
  /** The `## ` heading as the report shows it, in the report's language. */
  readonly heading: string;
  readonly markdown: string;
  /** Item keys this section cites, after the citation pass. */
  readonly citedItemKeys: readonly string[];
}

/** The prompts a report run can call (`docs/12` §1.2). */
export type TrendPromptId =
  | "THEME_CLUSTER"
  | "THEME_MERGE"
  | "CLUSTER_REDUCE"
  | "CLUSTER_REDUCE_MERGE"
  | "TREND_REPORT_EN"
  | "TREND_REPORT_KO"
  | "SELF_CRITIQUE";

/** One prompt the run called, with the model and temperature it ran on. */
export interface TrendPromptUse {
  readonly promptId: TrendPromptId;
  /** The full version string, not the cache line (`docs/12` §17.4). */
  readonly promptVersion: string;
  readonly modelId: string;
  readonly temperature: number;
}

/** The counts `docs/12` §10's report variables name. */
export interface ReportScope {
  /** `{{N_TOTAL}}`. */
  readonly totalCount: number;
  /** `{{N_ANALYSED}}`. */
  readonly analysedCount: number;
  /** `{{N_EXCLUDED}}`. */
  readonly excludedCount: number;
  /** `{{N_FULLTEXT}}`. */
  readonly fullTextCount: number;
  /** `{{N_ABSTRACT}}`. */
  readonly abstractCount: number;
  /** `{{YEAR_MIN}}`; `undefined` when no analysed item has a year. */
  readonly yearMin: number | undefined;
  /** `{{YEAR_MAX}}`; `undefined` when no analysed item has a year. */
  readonly yearMax: number | undefined;
}

/** One Appendix A row. */
export interface ExcludedItem {
  readonly itemKey: string;
  /** `docs/06` §9.1's reason code, e.g. `retracted`, `duplicate_of:KEY`. */
  readonly reason: string;
}

/** One numbered §11 Bibliography entry. */
export interface BibliographyEntry {
  readonly itemKey: string;
  /** `[n]`, 1-based, in order of first appearance (`docs/06` §10.2). */
  readonly index: number;
  /**
   * The entry as the bibliography formatter returned it, as plain text, trimmed; a numeric style's own
   * number is removed, because the report prints `index` (owner, 2026-10-27, `plan/00` §6 item 294(d)).
   */
  readonly text: string;
  readonly doi: Doi | undefined;
  /**
   * `true` when the item's record came from Semantic Scholar: its `extra` names `semanticscholar` on
   * the `rh-sources` line, or carries an `rh-s2-corpus-id` line. A report whose bibliography holds
   * one prints Semantic Scholar's attribution under its references (`docs/09` §7, §5.3; owner,
   * 2026-11-17, `plan/00` §6 item 395(c)). Absent on a report stored before 2026-11-17, and read
   * as `false`.
   */
  readonly semanticScholar?: boolean;
}

/** One entry of the unnumbered "Retracted — not used in this report" list. */
export interface RetractedEntry {
  readonly itemKey: string;
  readonly text: string;
  readonly doi: Doi | undefined;
}

/** `docs/06` §12.3's automated proxies, shown in Appendix B. */
export interface ReportQualityProxies {
  /** Cited factual sentences / factual sentences; `undefined` when none. */
  readonly citationDensity: number | undefined;
  /** Distinct cited items / analysed items. */
  readonly coverageRatio: number;
  readonly brokenCitationCount: number;
  /** `undefined` when no summary has a grounding score. */
  readonly meanGroundingScore: number | undefined;
  readonly contradictionCount: number;
  readonly unresolvedHighSeverityCount: number;
}

/** What the self-critique left: Appendix C and the warning banner. */
export interface CritiqueOutcome {
  /** Rounds run; `0` when `report.maxCritiqueRounds` is `0`. */
  readonly rounds: number;
  /** The last critique's problems the run did not resolve. */
  readonly unresolved: readonly CritiqueProblem[];
  /** A rewrite followed the last critique, so the shipped text was not re-checked. */
  readonly revisedAfterLastCritique: boolean;
  /**
   * The review's revision could not be applied: the rewrite failed the
   * section check twice, so the shipped text is the earlier draft the last
   * critique read (owner, `plan/00` §6 item 312(b)). Absent means `false`.
   * Added 2026-10-30 (`P4-T12`; `docs/07` §5.2's note of that date).
   */
  readonly revisionNotApplied?: boolean;
}

/**
 * One answered LLM call of a report run: an identifier, a language and numbers,
 * never any text. Added 2026-11-02 (`P4-T23`). Built by
 * `createRunCallRecorder` (`src/pipeline/trendReport/runMeasurement.ts`).
 */
export interface ReportCallUsage {
  /** `CallAccounting.promptId`. */
  readonly promptId: string;
  /** The report this call wrote; absent on a stage every report of the run shares. */
  readonly language?: ReportLanguage;
  /** Each absent, never 0, when the provider did not report it. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly costUsd?: number;
  /**
   * `ChatRequest.maxOutputTokens` as the stage asked it, before an adapter
   * clamps it to the model's limit.
   */
  readonly maxOutputTokens?: number;
  /** `CallAccounting.papers`. */
  readonly papers?: number;
}

/**
 * One analysed theme's size: numbers only. Added 2026-11-02 (`P4-T23`). Built
 * by `themeAnalysisSize` (`src/pipeline/trendReport/runMeasurement.ts`).
 */
export interface ThemeAnalysisSize {
  /**
   * Raw `estTokens` of the analysis as JSON: what the composition measures it
   * by (`P4T22_FIT_MATRIX`'s measure).
   */
  readonly tokens: number;
  /** Raw `estTokens` of its `narrative`, for `docs/07` §12.4's assumed 40%. */
  readonly narrativeTokens: number;
  /** The theme's members. */
  readonly papers: number;
}

/**
 * What one run measured. A run holds one of these, on its first report only.
 * Added 2026-11-02 (`P4-T23`). Built by `runMeasurementOf`
 * (`src/pipeline/trendReport/runMeasurement.ts`).
 */
export interface ReportRunMeasurement {
  /** Every call the run got an answer to, in the order the answers came. */
  readonly calls: readonly ReportCallUsage[];
  /** One per analysed theme, in the clustering's order. */
  readonly themeAnalyses: readonly ThemeAnalysisSize[];
  /** `true` on a job resumed after a restart: calls before the restart are not in `calls`. */
  readonly resumed?: boolean;
}

export interface TrendReport {
  readonly id: string;
  readonly libraryID: number;
  readonly collectionKey: string;
  /** The title block's `{{COLLECTION_NAME}}`. */
  readonly collectionName: string;
  /** The note title, dated (`docs/06` §14.2). */
  readonly title: string;
  readonly language: ReportLanguage;
  readonly generatedAtEpochMs: number;
  /** The title block's `{{PLUGIN_VERSION}}`. */
  readonly pluginVersion: string;

  /** Scope actually analysed. */
  readonly scope: ReportScope;
  /** FR-27's reduction pass count, shown in the header. */
  readonly reductionPasses: number;

  /** The eleven sections, in order, after the citation pass. */
  readonly sections: readonly ReportSection[];
  /** The final theme assignment; after a two-stage merge, the reassigned one. */
  readonly clustering: ThemeClustering;
  /** §11, numbered. */
  readonly bibliography: readonly BibliographyEntry[];
  /** The unnumbered list after §11; empty under `exclude_entirely`. */
  readonly retracted: readonly RetractedEntry[];
  /** Appendix A. */
  readonly excluded: readonly ExcludedItem[];
  /** Appendix B: the `StoredSummary.id` of every summary the synthesis used. */
  readonly summaryIds: readonly string[];
  /** Appendix B. */
  readonly qualityProxies: ReportQualityProxies;
  /** Appendix C and the banner. */
  readonly critique: CritiqueOutcome;

  /** The whole report as saved: title block, sections, appendices. */
  readonly markdown: string;
  /** Flattened, speakable script per language, produced for TTS. */
  readonly audioScripts: Readonly<Partial<Record<"en" | "ko", string>>>;

  /** Where the report lives in Zotero. */
  readonly zoteroNoteKey?: string;
  readonly audioAttachmentKeys?: Readonly<Partial<Record<"en" | "ko", string>>>;

  /** The active provider; every call of the run went to it. */
  readonly providerId: ProviderId;
  /** One entry per prompt the run called. */
  readonly prompts: readonly TrendPromptUse[];
  /** Summed over every call the run made, the summaries it made included. */
  readonly usage: Usage | undefined;
  /**
   * Each call's counts and each theme analysis's size, on the run's first
   * report only. Absent on the second report of a `both` run, and on every
   * record stored before 2026-11-02, which reads as "not measured", never 0.
   * Added 2026-11-02 (`P4-T23`; `docs/07` §5.2's note of that date). Built by
   * `runMeasurementOf`, attached by `execute`, read by
   * `scripts/eval-trend-report.ts`.
   */
  readonly runMeasurement?: ReportRunMeasurement;
  /** Every item key cited, in order of first appearance. */
  readonly citedItemKeys: readonly string[];
  readonly warnings: readonly string[];
  /**
   * What the redaction gate changed when the record was stored (`docs/09`
   * §2.1, "Persisted records pass one gate"); absent until the report store
   * (`createReportStore`, `src/zotero/db.ts`) has gated it. Added 2026-10-30
   * (`P4-T14`; `docs/07` §5.2's note of that date).
   */
  readonly redaction?: StoredRedactionMark;
}

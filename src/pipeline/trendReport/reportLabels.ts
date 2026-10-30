/**
 * The trend report's report-language labels (`P4-T12`; `docs/08` §10.4,
 * `plan/07` §0.2 item 15): every word the plugin itself writes **inside a
 * report** — the title block, the client tables, the appendices, the quality
 * banner, the invalid-citation text — keyed by the report's language, never by
 * the UI's.
 *
 * **Callers.** `scaffold.ts` (`P4-T12`) reads the whole table through
 * {@link reportLabels}. `compose.ts` takes the invalid-citation text as
 * `ComposeInput.citationReplacement`, which `P4-T21` fills from
 * {@link reportLabel}`(language, "invalidCitation")`; `P4-T21` also passes the
 * retracted-list heading to `exportMarkdown.ts` and `noteHtml.ts` as their
 * `retractedHeading` label. `critique.ts` (`P4-T09`) hands the scaffold a
 * `CritiqueOutcome`, and the scaffold writes the banner from these labels, so
 * `critique.ts` needs this module only if it shows the banner's words itself.
 * Nothing is constructed: every export is a constant or a pure function.
 *
 * ## The two tables (owner, 2026-10-26, `plan/00` §6 item 286)
 *
 * - {@link EN_REPORT_LABELS} is complete.
 * - {@link KO_REPORT_LABELS} holds only Korean the owner has approved. Today
 *   that is one label: the invalid-citation text "[인용 삭제: 잘못된 참조]"
 *   (owner, 2026-10-27, `plan/00` §6 item 292(b)).
 * - Every other key is on {@link KO_REPORT_LABELS_PENDING_REVIEW}: a `ko`
 *   report shows its English until the coordinator drafts the Korean and the
 *   owner approves it in chat (`G-41`'s rule, applied to report text by
 *   `plan/07` §0.2 item 15). Nothing here is machine-translated.
 *
 * ## Code-side text written by earlier cards
 *
 * `OTHER_THEME_NAME`, `OTHER_THEME_DEFINITION`, `SMALL_THEME_REASON` and
 * `UNMAPPED_THEME_REASON` (`cluster.ts`, `P4-T05`/`P4-T06`),
 * `INVALID_CITATION_TEXT` (`citations.ts`, `P4-T10`),
 * `DEFAULT_RETRACTED_HEADING` (`exportMarkdown.ts`, `P4-T15`) and
 * `DIGEST_NO_YEAR` (`digest.ts`, `P4-T04`) stay where they are, because their
 * modules use them as English defaults; this table **references** them as its
 * `en` values, so each English text has one source. The `theme_too_large`
 * wording (owner, `plan/00` §6 item 309(f)), the "target was capped" line
 * (item 312(c)) and the banner sentence for a revision that could not be
 * applied (item 312(b)) are new here.
 *
 * ## Placeholders
 *
 * A label holds `{name}` placeholders that {@link fillLabel} fills. A label is
 * plain text: no Markdown character, so the scaffold can place it as written
 * and escape only the values it fills in (a test holds every label to this,
 * the invalid-citation text aside, which the citation pass places itself).
 */

import { INVALID_CITATION_TEXT } from "./citations";
import {
  OTHER_THEME_DEFINITION,
  OTHER_THEME_NAME,
  SMALL_THEME_REASON,
  UNMAPPED_THEME_REASON,
} from "./cluster";
import { DIGEST_NO_YEAR } from "./digest";
import { DEFAULT_RETRACTED_HEADING } from "./exportMarkdown";
import type { StudyDesignLabel } from "../../model/summary";
import type { ReportLanguage } from "../../model/trend";

// ---------------------------------------------------------------------------
// 1. The English table
// ---------------------------------------------------------------------------

const EN = {
  // The title block (`docs/06` §9.1; note title dated, §14.2).
  reportTitle: "Research Trends: {collection} ({date})",
  headerScope:
    "{analysed} papers analysed of {total} · {years} · generated {timestamp} by research_helper v{version}",
  headerModels: "Provider: {provider} · Models: {models}",
  headerPrompts: "Prompts (version, temperature): {prompts}",
  headerAnalysis:
    "Analysis: {fullText} full text, {abstract} abstract only · Reduction passes: {passes}",
  noYear: DIGEST_NO_YEAR,

  // The quality banner (`docs/06` §12.2; owner, `plan/00` §6 items 286, 312(b)).
  bannerTitle: "Quality warning.",
  bannerFlaggedOne:
    "The automated review flagged 1 unresolved issue in this report.",
  bannerFlaggedMany:
    "The automated review flagged {count} unresolved issues in this report.",
  bannerSeeAppendix:
    "See Appendix C. Verify the affected claims against the cited papers before using them.",
  bannerNotRechecked:
    "The report text is a revision made after the last review, and it was not checked again.",
  bannerRevisionNotApplied:
    "The review asked for a revision that could not be applied, so the report text is the earlier draft the review read.",

  // §2's client line (owner, `plan/00` §6 item 286: depth, never section provenance).
  depthLine:
    "Analysis depth, counted by research_helper: {fullText} papers from full text, {abstract} from the abstract only.",

  // §3's year table.
  yearTableCaption: "Papers by year, counted by research_helper.",
  colYear: "Year",
  colPapers: "Papers",
  colDominantDesigns: "Dominant designs",
  colDominantThemes: "Dominant themes",

  // §4: a theme the analyse stage left unanalysed (owner, item 309(f)).
  themeNotAnalysed:
    "Theme “{theme}” ({papers} papers) was not analysed: {reason}.",
  reasonTooLarge: "too large to analyse",
  reasonNoRepresentative:
    "no representative paper remained after its citations were checked",
  reasonMergeOverBudget: "its partial analyses were too large to combine",
  reasonAnalysisFailed: "its analysis failed ({code})",

  // §5's study-design table.
  designTableCaption: "Study designs, counted by research_helper.",
  colStudyDesign: "Study design",
  colShare: "Share",

  // `PaperSummary.studyDesign.label` (`docs/06` §6.2), in the schema's order.
  designRandomizedControlledTrial: "Randomized controlled trial",
  designNonRandomizedTrial: "Non-randomized trial",
  designProspectiveCohort: "Prospective cohort",
  designRetrospectiveCohort: "Retrospective cohort",
  designCaseControl: "Case-control",
  designCrossSectional: "Cross-sectional",
  designCaseSeries: "Case series",
  designCaseReport: "Case report",
  designSystematicReview: "Systematic review",
  designMetaAnalysis: "Meta-analysis",
  designScopingReview: "Scoping review",
  designNarrativeReview: "Narrative review",
  designInVitro: "In vitro",
  designInVivoAnimal: "In vivo (animal)",
  designExVivo: "Ex vivo",
  designComputationalSimulation: "Computational simulation",
  designMethodDevelopment: "Method development",
  designBenchmarkStudy: "Benchmark study",
  designRetrospectiveDatabaseAnalysis: "Retrospective database analysis",
  designQualitativeStudy: "Qualitative study",
  designProtocol: "Protocol",
  designEditorialOrCommentary: "Editorial or commentary",
  designOther: "Other design",
  designNotStated: "Not stated",

  // §11's unnumbered list (owner, item 286; `P4-T15`'s default).
  retractedHeading: DEFAULT_RETRACTED_HEADING,

  // The invalid-citation text (`docs/06` §10.1; `P4-T10`'s default).
  invalidCitation: INVALID_CITATION_TEXT,

  // Appendix A (`docs/06` §9.1).
  appendixAHeading: "Appendix A — Excluded from synthesis",
  appendixANone: "No item was excluded from the synthesis.",
  colItem: "Item",
  colTitle: "Title",
  colReason: "Reason",
  colCode: "Code",
  exclusionRetracted: "Retracted",
  exclusionRetractedBecause: "Retracted: {reason}",
  exclusionNoAbstractNoPdf: "No abstract and no PDF",
  exclusionNonEnglish: "Not in English",
  exclusionNonEnglishUnsupported: "Not in English, not supported",
  exclusionDuplicateOf: "Duplicate of {key}",
  exclusionExtractionFailed: "Text extraction failed",
  exclusionSummaryFailed: "Summary failed after retries",
  exclusionOther: "Other reason",

  // Appendix B (`docs/06` §9.1, §12.3).
  appendixBHeading: "Appendix B — Provenance",
  runParametersHeading: "Run parameters",
  paramProvider: "Provider: {provider}",
  colPrompt: "Prompt",
  colVersion: "Version",
  colModel: "Model",
  colTemperature: "Temperature",
  paramReductionPasses: "Reduction passes: {passes}",
  paramReviewRounds: "Review rounds: {rounds}",
  paramTargetWords: "Target length sent to the model: {words} words",
  targetWordsCapped:
    "The target length setting was above {max} words, so the target was capped at {max} words, the longest the report's output limit is sized for.",
  paramTokens: "Tokens of this run: {input} in, {output} out",
  paramTotalCost: "Total cost of this run: {cost}",
  notReported: "not reported",
  qualityHeading: "Automated quality figures",
  proxyCitationDensity:
    "Citation density (cited factual sentences / factual sentences): {value}",
  proxyCoverage: "Coverage (distinct cited papers / analysed papers): {value}",
  proxyBroken: "Citations removed as invalid: {count}",
  proxySplit: "Combined citation markers split: {count}",
  proxyGrounding: "Mean grounding score of the summaries: {value}",
  proxyContradictions: "Contradictions found by the theme analyses: {count}",
  proxyUnresolvedHigh: "Unresolved high-severity review findings: {count}",
  notMeasured: "not measured",
  notableRowCount:
    "The Notable Papers table has {rows} rows; 8 to 15 are required.",
  notableInvalidRows:
    "Rows of the Notable Papers table that cite no analysed paper: {rows}.",
  mixedModels: "The summaries were made by more than one model: {models}.",
  mixedModelCache:
    "Some summaries were reused from a cache entry another model made.",
  mixedPrompts:
    "The summaries were made with more than one version of a prompt: {prompts}.",
  perPaperHeading: "Per-paper summaries",
  colSource: "Source",
  colConfidence: "Confidence",
  colGrounding: "Grounding",
  colTokensIn: "Tokens in",
  colTokensOut: "Tokens out",
  colCost: "Cost (USD)",
  colTheme: "Theme",
  tierAbstract: "Abstract",
  tierFulltextPdf: "Full text (attachment)",
  tierFulltextEpmc: "Full text (Europe PMC)",
  tierMetadataOnly: "Metadata only",
  confidenceHigh: "High",
  confidenceMedium: "Medium",
  confidenceLow: "Low",
  confidenceNone: "None",
  noTheme: "No theme: {reason}",
  unclusteredByModel: "the clustering left it out",
  smallTheme: SMALL_THEME_REASON,
  unmappedTheme: UNMAPPED_THEME_REASON,
  otherThemeName: OTHER_THEME_NAME,
  otherThemeDefinition: OTHER_THEME_DEFINITION,

  // Appendix C (owner, item 286, on `P4-T09`).
  appendixCHeading: "Appendix C — Unresolved review findings",
  appendixCNotRun: "The automated review did not run for this report.",
  appendixCNone: "The automated review left no unresolved finding.",
  colSeverity: "Severity",
  colType: "Type",
  colSection: "Section",
  colQuote: "Quoted text",
  colExplanation: "Explanation",
  colSuggestedFix: "Suggested fix",
  severityHigh: "High",
  severityMedium: "Medium",
  severityLow: "Low",
  problemUnsupported: "Unsupported claim",
  problemMisattributed: "Misattributed",
  problemNumberError: "Number error",
  problemOvergeneralized: "Overgeneralized",
  problemOutsideKnowledge: "Outside knowledge",
  problemMissingContradiction: "Missing contradiction",
  problemAbstractOverreach: "Claims more than an abstract supports",
  problemBrokenCitation: "Broken citation",
} satisfies Record<string, string>;

/** Every report-language label. */
export type ReportLabelKey = keyof typeof EN;

/** The `en` table: complete. */
export const EN_REPORT_LABELS: Readonly<Record<ReportLabelKey, string>> =
  Object.freeze(EN);

// ---------------------------------------------------------------------------
// 2. The Korean table — approved labels only
// ---------------------------------------------------------------------------

/**
 * Korean the owner approved in chat. A key absent here shows its English in a
 * `ko` report and is on {@link KO_REPORT_LABELS_PENDING_REVIEW}.
 */
export const KO_REPORT_LABELS: Readonly<
  Partial<Record<ReportLabelKey, string>>
> = Object.freeze({
  // Approved by the owner on 2026-10-27 (`plan/00` §6 item 292(b)).
  invalidCitation: "[인용 삭제: 잘못된 참조]",
});

/**
 * Every key whose Korean is not yet approved: the coordinator drafts it and
 * the owner approves it in chat (`G-41`'s rule; `plan/07` §0.2 item 15). Until
 * then a `ko` report shows the English, which {@link EN_REPORT_LABELS} holds
 * for each key below. A test holds this list to exactly the keys missing from
 * {@link KO_REPORT_LABELS}.
 */
export const KO_REPORT_LABELS_PENDING_REVIEW: readonly ReportLabelKey[] =
  Object.freeze([
    "reportTitle",
    "headerScope",
    "headerModels",
    "headerPrompts",
    "headerAnalysis",
    "noYear",
    "bannerTitle",
    "bannerFlaggedOne",
    "bannerFlaggedMany",
    "bannerSeeAppendix",
    "bannerNotRechecked",
    "bannerRevisionNotApplied",
    "depthLine",
    "yearTableCaption",
    "colYear",
    "colPapers",
    "colDominantDesigns",
    "colDominantThemes",
    "themeNotAnalysed",
    "reasonTooLarge",
    "reasonNoRepresentative",
    "reasonMergeOverBudget",
    "reasonAnalysisFailed",
    "designTableCaption",
    "colStudyDesign",
    "colShare",
    "designRandomizedControlledTrial",
    "designNonRandomizedTrial",
    "designProspectiveCohort",
    "designRetrospectiveCohort",
    "designCaseControl",
    "designCrossSectional",
    "designCaseSeries",
    "designCaseReport",
    "designSystematicReview",
    "designMetaAnalysis",
    "designScopingReview",
    "designNarrativeReview",
    "designInVitro",
    "designInVivoAnimal",
    "designExVivo",
    "designComputationalSimulation",
    "designMethodDevelopment",
    "designBenchmarkStudy",
    "designRetrospectiveDatabaseAnalysis",
    "designQualitativeStudy",
    "designProtocol",
    "designEditorialOrCommentary",
    "designOther",
    "designNotStated",
    "retractedHeading",
    "appendixAHeading",
    "appendixANone",
    "colItem",
    "colTitle",
    "colReason",
    "colCode",
    "exclusionRetracted",
    "exclusionRetractedBecause",
    "exclusionNoAbstractNoPdf",
    "exclusionNonEnglish",
    "exclusionNonEnglishUnsupported",
    "exclusionDuplicateOf",
    "exclusionExtractionFailed",
    "exclusionSummaryFailed",
    "exclusionOther",
    "appendixBHeading",
    "runParametersHeading",
    "paramProvider",
    "colPrompt",
    "colVersion",
    "colModel",
    "colTemperature",
    "paramReductionPasses",
    "paramReviewRounds",
    "paramTargetWords",
    "targetWordsCapped",
    "paramTokens",
    "paramTotalCost",
    "notReported",
    "qualityHeading",
    "proxyCitationDensity",
    "proxyCoverage",
    "proxyBroken",
    "proxySplit",
    "proxyGrounding",
    "proxyContradictions",
    "proxyUnresolvedHigh",
    "notMeasured",
    "notableRowCount",
    "notableInvalidRows",
    "mixedModels",
    "mixedModelCache",
    "mixedPrompts",
    "perPaperHeading",
    "colSource",
    "colConfidence",
    "colGrounding",
    "colTokensIn",
    "colTokensOut",
    "colCost",
    "colTheme",
    "tierAbstract",
    "tierFulltextPdf",
    "tierFulltextEpmc",
    "tierMetadataOnly",
    "confidenceHigh",
    "confidenceMedium",
    "confidenceLow",
    "confidenceNone",
    "noTheme",
    "unclusteredByModel",
    "smallTheme",
    "unmappedTheme",
    "otherThemeName",
    "otherThemeDefinition",
    "appendixCHeading",
    "appendixCNotRun",
    "appendixCNone",
    "colSeverity",
    "colType",
    "colSection",
    "colQuote",
    "colExplanation",
    "colSuggestedFix",
    "severityHigh",
    "severityMedium",
    "severityLow",
    "problemUnsupported",
    "problemMisattributed",
    "problemNumberError",
    "problemOvergeneralized",
    "problemOutsideKnowledge",
    "problemMissingContradiction",
    "problemAbstractOverreach",
    "problemBrokenCitation",
  ] as const satisfies readonly ReportLabelKey[]);

// ---------------------------------------------------------------------------
// 3. Study-design labels
// ---------------------------------------------------------------------------

/**
 * Each `studyDesign.label` (`docs/06` §6.2) to its label, in the schema's
 * enum order — the order a tie is broken in. A test reads the order from
 * `src/prompts/schemas/paper-summary.v1.json`.
 */
export const STUDY_DESIGN_LABEL_KEYS: Readonly<
  Record<StudyDesignLabel, ReportLabelKey>
> = Object.freeze({
  randomized_controlled_trial: "designRandomizedControlledTrial",
  non_randomized_trial: "designNonRandomizedTrial",
  prospective_cohort: "designProspectiveCohort",
  retrospective_cohort: "designRetrospectiveCohort",
  case_control: "designCaseControl",
  cross_sectional: "designCrossSectional",
  case_series: "designCaseSeries",
  case_report: "designCaseReport",
  systematic_review: "designSystematicReview",
  meta_analysis: "designMetaAnalysis",
  scoping_review: "designScopingReview",
  narrative_review: "designNarrativeReview",
  in_vitro: "designInVitro",
  in_vivo_animal: "designInVivoAnimal",
  ex_vivo: "designExVivo",
  computational_simulation: "designComputationalSimulation",
  method_development: "designMethodDevelopment",
  benchmark_study: "designBenchmarkStudy",
  retrospective_database_analysis: "designRetrospectiveDatabaseAnalysis",
  qualitative_study: "designQualitativeStudy",
  protocol: "designProtocol",
  editorial_or_commentary: "designEditorialOrCommentary",
  other: "designOther",
});

// ---------------------------------------------------------------------------
// 4. Lookup
// ---------------------------------------------------------------------------

/** Whether a `ko` report still shows `key`'s English (`G-41`). */
export function isKoLabelPending(key: ReportLabelKey): boolean {
  return KO_REPORT_LABELS[key] === undefined;
}

/** One label in the report's language; a pending `ko` label is its English. */
export function reportLabel(
  language: ReportLanguage,
  key: ReportLabelKey,
): string {
  if (language === "ko") return KO_REPORT_LABELS[key] ?? EN_REPORT_LABELS[key];
  return EN_REPORT_LABELS[key];
}

/** The whole table for one report language. */
export function reportLabels(
  language: ReportLanguage,
): Readonly<Record<ReportLabelKey, string>> {
  if (language === "en") return EN_REPORT_LABELS;
  return Object.freeze({ ...EN_REPORT_LABELS, ...KO_REPORT_LABELS });
}

/** A `{name}` placeholder. */
const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g;

/** The placeholders `label` holds, each once, in order. */
export function labelPlaceholders(label: string): readonly string[] {
  const names: string[] = [];
  for (const match of label.matchAll(PLACEHOLDER_RE)) {
    const name = match[1] ?? "";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * `label` with each `{name}` replaced by `args[name]`, as given: the caller
 * escapes a value that came from outside the plugin.
 *
 * @throws Error when a placeholder has no value — a defect in the caller
 */
export function fillLabel(
  label: string,
  args: Readonly<Record<string, string | number>>,
): string {
  return label.replace(PLACEHOLDER_RE, (_m, name: string) => {
    const value = args[name];
    if (value === undefined) {
      throw new Error(`report label placeholder {${name}} has no value`);
    }
    return String(value);
  });
}

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
 * - {@link KO_REPORT_LABELS} holds only Korean the owner has approved: the
 *   invalid-citation text "[인용 삭제: 잘못된 참조]" (owner, 2026-10-27,
 *   `plan/00` §6 item 292(b)), and since 2026-11-01 the 136 labels of
 *   `plan/reports/ko-draft-report-labels.tsv`, byte for byte (owner, `G-41`,
 *   item 319). A Korean label may place its placeholders in another order.
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
 * (item 312(c)), the banner sentence for a revision that could not be
 * applied (item 312(b)) and Appendix B's line for paragraphs the review could
 * not check (`critique_text_unchecked`, coordinator, item 317(c)) are new
 * here.
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
  // Coordinator, plan/00 §6 item 317(c): critique.ts's critique_text_unchecked.
  critiqueTextUnchecked:
    "Some paragraphs were not checked by the automated review, because the summaries they cite were too long to send in one review request.",
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
  // Korean drafted by the coordinator and reviewed by the owner on 2026-11-01
  // (G-41, plan/00 §6 item 319), inserted byte for byte from the third column
  // of plan/reports/ko-draft-report-labels.tsv.
  reportTitle: "연구 동향: {collection} ({date})",
  headerScope:
    "논문 {total}편 중 {analysed}편 분석 · {years} · {timestamp}에 research_helper v{version}로 생성",
  headerModels: "제공자: {provider} · 모델: {models}",
  headerPrompts: "지시문(버전, 온도): {prompts}",
  headerAnalysis:
    "분석: 본문 {fullText}편, 초록만 {abstract}편 · 축약 단계: {passes}",
  noYear: "연도 없음",
  bannerTitle: "품질 경고.",
  bannerFlaggedOne:
    "자동 검토가 이 보고서에서 해결되지 않은 문제 1건을 찾았습니다.",
  bannerFlaggedMany:
    "자동 검토가 이 보고서에서 해결되지 않은 문제 {count}건을 찾았습니다.",
  bannerSeeAppendix:
    "부록 C를 보세요. 해당 주장은 쓰기 전에 인용된 논문과 대조해 확인하세요.",
  bannerNotRechecked:
    "이 보고서 본문은 마지막 검토 뒤에 고친 것이며, 다시 검토하지 않았습니다.",
  bannerRevisionNotApplied:
    "검토가 요청한 고침을 반영하지 못해, 이 보고서 본문은 검토가 읽은 고치기 전 원고입니다.",
  depthLine:
    "분석 깊이(research_helper 집계): 본문으로 {fullText}편, 초록만으로 {abstract}편.",
  yearTableCaption: "연도별 논문 수(research_helper 집계).",
  colYear: "연도",
  colPapers: "논문 수",
  colDominantDesigns: "주요 연구 설계",
  colDominantThemes: "주요 주제",
  themeNotAnalysed:
    "주제 “{theme}”(논문 {papers}편)은 분석하지 못했습니다: {reason}.",
  reasonTooLarge: "너무 커서 분석할 수 없음",
  reasonNoRepresentative: "인용을 검사한 뒤 대표 논문이 남지 않음",
  reasonMergeOverBudget: "부분 분석이 너무 커서 합칠 수 없음",
  reasonAnalysisFailed: "분석 실패({code})",
  designTableCaption: "연구 설계별 분포(research_helper 집계).",
  colStudyDesign: "연구 설계",
  colShare: "비율",
  designRandomizedControlledTrial: "무작위 대조 시험",
  designNonRandomizedTrial: "비무작위 시험",
  designProspectiveCohort: "전향적 코호트",
  designRetrospectiveCohort: "후향적 코호트",
  designCaseControl: "환자-대조군 연구",
  designCrossSectional: "단면 연구",
  designCaseSeries: "증례 시리즈",
  designCaseReport: "증례 보고",
  designSystematicReview: "체계적 문헌고찰",
  designMetaAnalysis: "메타분석",
  designScopingReview: "주제 범위 고찰",
  designNarrativeReview: "서술적 문헌고찰",
  designInVitro: "시험관 내(in vitro)",
  designInVivoAnimal: "생체 내(동물)",
  designExVivo: "생체 외(ex vivo)",
  designComputationalSimulation: "컴퓨터 시뮬레이션",
  designMethodDevelopment: "방법 개발",
  designBenchmarkStudy: "성능 비교 연구",
  designRetrospectiveDatabaseAnalysis: "후향적 데이터베이스 분석",
  designQualitativeStudy: "질적 연구",
  designProtocol: "연구 계획서",
  designEditorialOrCommentary: "사설 또는 논평",
  designOther: "기타 설계",
  designNotStated: "밝히지 않음",
  retractedHeading: "철회됨 — 이 보고서에 쓰지 않음",
  appendixAHeading: "부록 A — 종합에서 제외된 논문",
  appendixANone: "종합에서 제외된 논문이 없습니다.",
  colItem: "항목",
  colTitle: "제목",
  colReason: "이유",
  colCode: "코드",
  exclusionRetracted: "철회됨",
  exclusionRetractedBecause: "철회됨: {reason}",
  exclusionNoAbstractNoPdf: "초록과 PDF가 없음",
  exclusionNonEnglish: "영어가 아님",
  exclusionNonEnglishUnsupported: "영어가 아니며 지원하지 않음",
  exclusionDuplicateOf: "{key}의 중복",
  exclusionExtractionFailed: "본문 추출 실패",
  exclusionSummaryFailed: "여러 번 시도했으나 요약 실패",
  exclusionOther: "기타 이유",
  appendixBHeading: "부록 B — 출처와 작성 과정",
  runParametersHeading: "실행 설정",
  paramProvider: "제공자: {provider}",
  colPrompt: "지시문",
  colVersion: "버전",
  colModel: "모델",
  colTemperature: "온도",
  paramReductionPasses: "축약 단계: {passes}",
  paramReviewRounds: "검토 횟수: {rounds}",
  paramTargetWords: "모델에 보낸 목표 길이: {words}단어",
  targetWordsCapped:
    "목표 길이 설정이 {max}단어를 넘어, 보고서 출력 상한에 맞춘 최대 길이인 {max}단어로 줄였습니다.",
  paramTokens: "이번 실행의 토큰: 입력 {input}, 출력 {output}",
  paramTotalCost: "이번 실행의 총비용: {cost}",
  notReported: "보고되지 않음",
  qualityHeading: "자동 품질 지표",
  proxyCitationDensity: "인용 밀도(인용이 달린 사실 문장 / 사실 문장): {value}",
  proxyCoverage: "포괄도(인용된 서로 다른 논문 / 분석한 논문): {value}",
  proxyBroken: "잘못되어 삭제한 인용: {count}",
  proxySplit: "나눈 묶음 인용 표시: {count}",
  proxyGrounding: "요약의 평균 근거 점수: {value}",
  proxyContradictions: "주제 분석에서 찾은 상충: {count}",
  proxyUnresolvedHigh: "해결되지 않은 심각도 높음 검토 결과: {count}",
  notMeasured: "측정하지 않음",
  notableRowCount:
    "'주목할 논문' 표의 행이 {rows}개입니다. 8개에서 15개가 필요합니다.",
  notableInvalidRows:
    "'주목할 논문' 표에서 분석한 논문을 인용하지 않은 행: {rows}.",
  mixedModels: "요약을 여러 모델이 만들었습니다: {models}.",
  mixedModelCache: "일부 요약은 다른 모델이 만든 저장 결과를 다시 쓴 것입니다.",
  mixedPrompts: "요약을 여러 버전의 지시문으로 만들었습니다: {prompts}.",
  perPaperHeading: "논문별 요약",
  colSource: "원문",
  colConfidence: "신뢰도",
  colGrounding: "근거 점수",
  colTokensIn: "입력 토큰",
  colTokensOut: "출력 토큰",
  colCost: "비용(USD)",
  colTheme: "주제",
  tierAbstract: "초록",
  tierFulltextPdf: "본문(첨부 파일)",
  tierFulltextEpmc: "본문(Europe PMC)",
  tierMetadataOnly: "서지 정보만",
  confidenceHigh: "높음",
  confidenceMedium: "보통",
  confidenceLow: "낮음",
  confidenceNone: "없음",
  noTheme: "주제 없음: {reason}",
  unclusteredByModel: "주제 묶기에서 빠짐",
  smallTheme: "이 논문의 주제는 주제당 최소 논문 수보다 적어 제외되었습니다.",
  unmappedTheme:
    "묶음에서 찾은 주제가 컬렉션 전체의 어떤 주제와도 맞지 않았습니다.",
  otherThemeName: "기타",
  otherThemeDefinition: "주제 묶기에서 어떤 주제에도 들어가지 않은 논문.",
  appendixCHeading: "부록 C — 해결되지 않은 검토 결과",
  appendixCNotRun: "이 보고서에는 자동 검토를 하지 않았습니다.",
  appendixCNone: "자동 검토에서 해결되지 않은 결과가 없습니다.",
  colSeverity: "심각도",
  colType: "종류",
  colSection: "장",
  colQuote: "인용한 글",
  colExplanation: "설명",
  colSuggestedFix: "고침 제안",
  severityHigh: "높음",
  severityMedium: "보통",
  severityLow: "낮음",
  problemUnsupported: "근거 없는 주장",
  problemMisattributed: "출처 잘못 붙임",
  problemNumberError: "숫자 오류",
  problemOvergeneralized: "지나친 일반화",
  problemOutsideKnowledge: "외부 지식 사용",
  problemMissingContradiction: "빠뜨린 상충",
  problemAbstractOverreach: "초록이 뒷받침하는 것보다 많이 주장함",
  problemBrokenCitation: "잘못된 인용",
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
    // Added after the owner's review of item 319 (2026-11-01): Appendix B's
    // line for critique_text_unchecked (coordinator, item 317(c)).
    "critiqueTextUnchecked",
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

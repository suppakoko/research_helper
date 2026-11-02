/**
 * `P4-T12` — the client-generated title block, tables and appendices
 * (`docs/06` §9.1 and its notes of 2026-10-30; `docs/08` §10.4).
 *
 * Every report here is synthetic and written in this file: a 12-item
 * collection — nine analysed papers, one retracted, one duplicate and one
 * failed summary — whose every figure below was counted by hand from the
 * fixture's table. No network, no model, no Zotero.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Doi } from "../../../src/model/ids";
import type {
  PaperSummary,
  SourceTier,
  StoredSummary,
  StudyDesignLabel,
  Confidence,
} from "../../../src/model/summary";
import type {
  BibliographyEntry,
  CritiqueOutcome,
  ReportSection,
  RetractedEntry,
  ThemeAnalysis,
  ThemeClustering,
  TrendPromptUse,
  TrendReport,
} from "../../../src/model/trend";
import type { Usage } from "../../../src/model/usage";
import { CACHE_MIXED_MODEL_WARNING } from "../../../src/pipeline/summarize/summaryCache";
import { INVALID_CITATION_TEXT } from "../../../src/pipeline/trendReport/citations";
import {
  OTHER_THEME_DEFINITION,
  OTHER_THEME_NAME,
  SMALL_THEME_REASON,
  UNMAPPED_THEME_REASON,
} from "../../../src/pipeline/trendReport/cluster";
import {
  splitSections,
  TARGET_WORDS_CAPPED_WARNING,
  type ComposedReport,
} from "../../../src/pipeline/trendReport/compose";
import {
  CRITIQUE_PER_SECTION_WARNING,
  CRITIQUE_TEXT_UNCHECKED_WARNING,
} from "../../../src/pipeline/trendReport/critique";
import { DIGEST_NO_YEAR } from "../../../src/pipeline/trendReport/digest";
import {
  DEFAULT_RETRACTED_HEADING,
  renderReportMarkdown,
} from "../../../src/pipeline/trendReport/exportMarkdown";
import { renderReportNoteHtml } from "../../../src/pipeline/trendReport/noteHtml";
import {
  EN_REPORT_LABELS,
  fillLabel,
  isKoLabelPending,
  KO_REPORT_LABELS,
  KO_REPORT_LABELS_PENDING_REVIEW,
  labelPlaceholders,
  reportLabel,
  reportLabels,
  STUDY_DESIGN_LABEL_KEYS,
  type ReportLabelKey,
} from "../../../src/pipeline/trendReport/reportLabels";
import {
  bibliographyKeys,
  checkNotablePapers,
  designFrequencies,
  formatTimestamp,
  inertText,
  NOTABLE_PAPERS_INVALID_WARNING,
  PREAMBLE_DROPPED_WARNING,
  scaffoldReport,
  yearRows,
  type ScaffoldInput,
  type ScaffoldPaper,
  type ScaffoldedReport,
} from "../../../src/pipeline/trendReport/scaffold";
import type { ThemeResult } from "../../../src/pipeline/trendReport/themeAnalysis";
import {
  type CitationNode,
  citationSpan,
  escapeHtml,
} from "../../../src/zotero/bibliography";

// ---------------------------------------------------------------------------
// Fixture: a 12-item collection
// ---------------------------------------------------------------------------

const A1 = "AAAA0001";
const A2 = "AAAA0002";
const A3 = "AAAA0003";
const A4 = "AAAA0004";
const A5 = "AAAA0005";
const A6 = "AAAA0006";
const A7 = "AAAA0007";
const A8 = "AAAA0008";
const A9 = "AAAA0009";
const RETR = "RETR0001";
const DUPL = "DUPL0001";
const FAIL = "FAIL0001";

const doi = (d: string): Doi => d as Doi;

/**
 * The analysed papers, by hand:
 *
 * | key | year | tier          | design               | theme   | conf.  | grounding | in/out/cost       | model   | prompt |
 * | A1  | 2020 | fulltext_pdf  | RCT                  | T1      | high   | 1         | 1000/200/0.0100   | model-a | 1.0.0  |
 * | A2  | 2020 | abstract      | retrospective cohort | T1      | medium | 0.5       | 800/150/0.0080    | model-a | 1.0.0  |
 * | A3  | 2021 | abstract      | retrospective cohort | T2      | medium | —         | —                 | model-b | 1.0.0  |
 * | A4  | 2021 | fulltext_epmc | RCT                  | T2      | high   | 0.75      | 2000/300/0.0200   | model-a | 1.0.0  |
 * | A5  | 2021 | abstract      | (none)               | T2      | low    | 0.25      | 500/100/—         | model-a | 1.0.0* |
 * | A6  | 2022 | metadata_only | case report          | T3 Other| none   | —         | —                 | model-a | 1.0.0  |
 * | A7  | 2022 | abstract      | retrospective cohort | T3 Other| medium | 1         | 700/120/0.0070    | model-a | 1.0.1  |
 * | A8  | —    | abstract      | meta-analysis        | (small) | medium | 0.5       | 600/110/0.0060    | model-a | 1.0.0  |
 * | A9  | 2022 | fulltext_pdf  | retrospective cohort | T1      | high   | 1         | 3000/400/0.0300   | model-a | 1.0.0  |
 *
 * (* A5 was served from a cache entry another model made.)
 */
interface Row {
  readonly key: string;
  readonly year: number | undefined;
  readonly tier: SourceTier;
  readonly design: StudyDesignLabel | null;
  readonly confidence: Confidence;
  readonly grounding: number | undefined;
  readonly usage: Usage | undefined;
  readonly model: string;
  readonly promptVersion: string;
  readonly warnings: readonly string[];
}

const use = (i: number, o: number, c: number | undefined): Usage => ({
  inputTokens: i,
  outputTokens: o,
  totalTokens: i + o,
  costUsd: c,
});

const ROWS: readonly Row[] = [
  {
    key: A1,
    year: 2020,
    tier: "fulltext_pdf",
    design: "randomized_controlled_trial",
    confidence: "high",
    grounding: 1,
    usage: use(1000, 200, 0.01),
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [],
  },
  {
    key: A2,
    year: 2020,
    tier: "abstract",
    design: "retrospective_cohort",
    confidence: "medium",
    grounding: 0.5,
    usage: use(800, 150, 0.008),
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [],
  },
  {
    key: A3,
    year: 2021,
    tier: "abstract",
    design: "retrospective_cohort",
    confidence: "medium",
    grounding: undefined,
    usage: undefined,
    model: "model-b",
    promptVersion: "1.0.0",
    warnings: [],
  },
  {
    key: A4,
    year: 2021,
    tier: "fulltext_epmc",
    design: "randomized_controlled_trial",
    confidence: "high",
    grounding: 0.75,
    usage: use(2000, 300, 0.02),
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [],
  },
  {
    key: A5,
    year: 2021,
    tier: "abstract",
    design: null,
    confidence: "low",
    grounding: 0.25,
    usage: use(500, 100, undefined),
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [CACHE_MIXED_MODEL_WARNING],
  },
  {
    key: A6,
    year: 2022,
    tier: "metadata_only",
    design: "case_report",
    confidence: "none",
    grounding: undefined,
    usage: undefined,
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [],
  },
  {
    key: A7,
    year: 2022,
    tier: "abstract",
    design: "retrospective_cohort",
    confidence: "medium",
    grounding: 1,
    usage: use(700, 120, 0.007),
    model: "model-a",
    promptVersion: "1.0.1",
    warnings: [],
  },
  {
    key: A8,
    year: undefined,
    tier: "abstract",
    design: "meta_analysis",
    confidence: "medium",
    grounding: 0.5,
    usage: use(600, 110, 0.006),
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [],
  },
  {
    key: A9,
    year: 2022,
    tier: "fulltext_pdf",
    design: "retrospective_cohort",
    confidence: "high",
    grounding: 1,
    usage: use(3000, 400, 0.03),
    model: "model-a",
    promptVersion: "1.0.0",
    warnings: [],
  },
];

function content(row: Row): PaperSummary {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey: row.key,
    sourceTier: row.tier,
    confidence: row.confidence,
    researchQuestion: null,
    studyDesign: { label: row.design, detail: null },
    population: { kind: null, description: null, size: null },
    methods: [],
    keyFindings: [],
    effectSizes: [],
    limitations: [],
    novelty: null,
    keywords: [],
    researchTheme: null,
    citationWorthiness: { score: 3, reason: "r" },
  };
}

function paper(row: Row): ScaffoldPaper {
  const summary: StoredSummary = {
    id: `work-${row.key}:${row.promptVersion}:${row.model}`,
    workKey: `work-${row.key}`,
    zoteroItemKey: row.key,
    content: content(row),
    inputScope: { kind: "abstract" },
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptVersion: row.promptVersion,
    providerId: "anthropic",
    modelId: row.model,
    temperature: 0,
    usage: row.usage,
    generatedAtEpochMs: 0,
    sourceItemVersion: undefined,
    contentHash: "0".repeat(64),
    truncated: false,
    groundingScore: row.grounding,
    warnings: row.warnings,
    redaction: { partlyRedacted: false, redactedStrings: 0, droppedFields: 0 },
  };
  return { itemKey: row.key, year: row.year, summary };
}

const PAPERS: readonly ScaffoldPaper[] = ROWS.map(paper);

/** T2's name carries a marker, emphasis and a pipe: it must stay text. */
const T2_NAME = "Imaging [[AAAA0001]] *trials* | <b>x</b>";

const CLUSTERING: ThemeClustering = {
  themes: [
    {
      themeId: "T1",
      name: "Risk scores",
      definition: "d",
      itemKeys: [A1, A2, A9],
    },
    { themeId: "T2", name: T2_NAME, definition: "d", itemKeys: [A3, A4, A5] },
    {
      themeId: "T3",
      name: OTHER_THEME_NAME,
      definition: OTHER_THEME_DEFINITION,
      itemKeys: [A6, A7],
    },
  ],
  assignments: [
    { itemKey: A1, primaryThemeId: "T1", fit: "strong" },
    { itemKey: A2, primaryThemeId: "T1", fit: "strong" },
    { itemKey: A3, primaryThemeId: "T2", fit: "strong" },
    { itemKey: A4, primaryThemeId: "T2", fit: "strong" },
    { itemKey: A5, primaryThemeId: "T2", fit: "weak" },
    { itemKey: A6, primaryThemeId: "T3", fit: "weak" },
    { itemKey: A7, primaryThemeId: "T3", fit: "weak" },
    { itemKey: A9, primaryThemeId: "T1", fit: "moderate" },
  ],
  unclustered: [{ itemKey: A8, reason: SMALL_THEME_REASON }],
};

function analysis(themeId: string, contradictions: number): ThemeAnalysis {
  const side = { claim: "c", itemKeys: [A1] };
  return {
    themeId,
    name: "n",
    narrative: "x",
    representativePapers: [{ itemKey: A1, why: "w" }],
    contradictions: Array.from({ length: contradictions }, () => ({
      statement: "s",
      sideA: side,
      sideB: side,
    })),
    trajectory: "t",
  };
}

const THEMES: readonly ThemeResult[] = [
  {
    status: "analysed",
    themeId: "T1",
    passes: 1,
    subBatches: 1,
    requests: 1,
    calls: 1,
    analysis: analysis("T1", 2),
    removedKeys: [],
    removedMalformed: 0,
    warnings: [],
  },
  {
    status: "unanalysed",
    themeId: "T2",
    passes: 0,
    subBatches: 9,
    requests: 0,
    calls: 0,
    reason: "theme_too_large",
  },
  {
    status: "analysed",
    themeId: "T3",
    passes: 2,
    subBatches: 2,
    requests: 3,
    calls: 3,
    analysis: analysis("T3", 1),
    removedKeys: [],
    removedMalformed: 0,
    warnings: [],
  },
];

const HEADINGS = [
  "1. Executive Summary",
  "2. Scope and Method",
  "3. Landscape Overview",
  "4. Major Research Themes",
  "5. Methodological Trends",
  "6. Key Findings and Convergence",
  "7. Contradictions and Debates",
  "8. Gaps and Open Questions",
  "9. Emerging Directions",
  "10. Notable Papers",
  "11. Bibliography",
];

/** §10's table: one row per key. */
function notableTable(keys: readonly string[]): string {
  return [
    "| Paper | Year | Why it matters | Theme |",
    "| --- | --- | --- | --- |",
    ...keys.map((key) => `| [[${key}]] | 2021 | Why. | Risk |`),
  ].join("\n");
}

/** The model's answer after `P4-T10`'s pass, with its own title and §11. */
function modelMarkdown(
  notable: string = notableTable([A1, A2, A3, A4, A5, A6, A7, A8]),
): string {
  return [
    "# My own title",
    "",
    `## ${HEADINGS[0]}`,
    "",
    `- Scores improved risk [[${A2}]] and replicated [[${A1}]].`,
    "",
    `## ${HEADINGS[1]}`,
    "",
    "This is one curated collection.",
    "",
    `## ${HEADINGS[2]}`,
    "",
    `The corpus spans three years [[${A3}]].`,
    "",
    `## ${HEADINGS[3]}`,
    "",
    "### Risk scores",
    "",
    `Narrative [[${A1}]].`,
    "",
    `## ${HEADINGS[4]}`,
    "",
    `Cohorts dominate [[${A7}]].`,
    "",
    `## ${HEADINGS[5]}`,
    "",
    "None found.",
    "",
    `## ${HEADINGS[6]}`,
    "",
    `One claim [[${A4}]] and its opposite [[${A5}]].`,
    "",
    `## ${HEADINGS[7]}`,
    "",
    "Gaps.",
    "",
    `## ${HEADINGS[8]}`,
    "",
    "Directions.",
    "",
    `## ${HEADINGS[9]}`,
    "",
    notable,
    "",
    `## ${HEADINGS[10]}`,
    "",
    `1. [[${A1}]] First`,
    `2. [[${A9}]] Listed only in the model's own bibliography`,
  ].join("\n");
}

function composed(
  markdown: string = modelMarkdown(),
  warnings: readonly string[] = [],
): Pick<
  ComposedReport,
  "sections" | "preamble" | "quality" | "citations" | "warnings"
> {
  const { preamble, sections } = splitSections(markdown, HEADINGS);
  return {
    preamble,
    sections,
    quality: {
      citationDensity: 0.5,
      coverageRatio: 8 / 9,
      brokenCitationCount: 1,
      factualSentences: 4,
      citedFactualSentences: 2,
      distinctCitedInBody: 8,
      fencedMarkerCount: 0,
    },
    citations: {
      markdown,
      citedKeys: [],
      figures: {
        brokenCitationCount: 1,
        coverageRatio: 8 / 9,
        markerCount: 17,
        splitMarkerCount: 2,
        resolvedCount: 16,
        rewrittenCount: 0,
        malformedCount: 1,
        notInValidSetCount: 0,
        fencedMarkerCount: 0,
        distinctCitedCount: 9,
        resolvedShare: 1,
      },
      removed: [],
      fenced: [],
    },
    warnings,
  };
}

/** The order §1–§10 cite: A2, A1 (§1), A3 (§3), A7 (§5), A4, A5 (§7), A6, A8 (§10). */
const CITED = [A2, A1, A3, A7, A4, A5, A6, A8];

const BIBLIOGRAPHY: readonly BibliographyEntry[] = CITED.map((key, i) => ({
  itemKey: key,
  index: i + 1,
  text: `Author ${String(i + 1)} (2021). Title [${key}].`,
  doi: i === 0 ? doi(`10.1000/${key.toLowerCase()}`) : undefined,
}));

const RETRACTED: readonly RetractedEntry[] = [
  {
    itemKey: RETR,
    text: "Retracted, A. (2019). Withdrawn study.",
    doi: doi("10.5555/retr.1"),
  },
];

const PROMPTS: readonly TrendPromptUse[] = [
  {
    promptId: "THEME_CLUSTER",
    promptVersion: "1.0.0",
    modelId: "model-a",
    temperature: 0.2,
  },
  {
    promptId: "CLUSTER_REDUCE",
    promptVersion: "1.0.0",
    modelId: "model-a",
    temperature: 0.2,
  },
  {
    promptId: "CLUSTER_REDUCE",
    promptVersion: "1.0.0",
    modelId: "model-a",
    temperature: 0.2,
  },
  {
    promptId: "TREND_REPORT_EN",
    promptVersion: "1.0.1",
    modelId: "model-b",
    temperature: 0.3,
  },
  {
    promptId: "SELF_CRITIQUE",
    promptVersion: "1.0.0",
    modelId: "model-a",
    temperature: 0,
  },
];

const CRITIQUE: CritiqueOutcome = {
  rounds: 1,
  unresolved: [
    {
      type: "overgeneralized",
      severity: "medium",
      section: "1. Executive Summary",
      quote: "Scores improved risk.",
      explanation: "Only two papers.",
    },
    {
      type: "unsupported",
      severity: "high",
      quote: `Narrative [[${A1}]] | more`,
      explanation: "No summary says so.",
      suggestedFix: "Remove it.",
    },
  ],
  revisedAfterLastCritique: true,
};

/** 2026-10-30 05:06:07 UTC. */
const GENERATED = Date.UTC(2026, 9, 30, 5, 6, 7);

function input(overrides: Partial<ScaffoldInput> = {}): ScaffoldInput {
  return {
    language: "en",
    collectionName: "Cardio [risk] *2026*",
    pluginVersion: "0.0.2",
    generatedAtEpochMs: GENERATED,
    utcOffsetMinutes: 540,
    providerId: "anthropic",
    prompts: PROMPTS,
    usage: {
      inputTokens: 50000,
      outputTokens: 9000,
      totalTokens: 59000,
      costUsd: 0.4321,
    },
    totalCount: 12,
    analysed: PAPERS,
    excluded: [
      { itemKey: RETR, reason: "retracted" },
      { itemKey: DUPL, reason: `duplicate_of:${A1}` },
      { itemKey: FAIL, reason: "llm_failed_after_retries" },
    ],
    titles: new Map([
      [RETR, "Withdrawn study"],
      [DUPL, "Preprint of A1"],
    ]),
    retractionReasons: new Map([[RETR, "Falsification of data"]]),
    clustering: CLUSTERING,
    otherThemeId: "T3",
    themes: THEMES,
    reductionPasses: 2,
    composed: composed(),
    plan: {
      scope: {
        totalCount: 12,
        analysedCount: 9,
        excludedCount: 3,
        fullTextCount: 3,
        abstractCount: 6,
        yearMin: 2020,
        yearMax: 2022,
      },
      targetWords: 4250,
      targetWordsCapped: true,
    },
    critique: CRITIQUE,
    bibliography: BIBLIOGRAPHY,
    retracted: RETRACTED,
    retractionPolicy: "exclude_from_synthesis",
    ...overrides,
  };
}

/** The whole report for {@link input}, every figure counted by hand. */
const EXPECTED = [
  "# Research Trends: Cardio \\[risk\\] \\*2026\\* (2026-10-30)",
  "",
  "_9 papers analysed of 12 · 2020–2022 · generated 2026-10-30 14:06 UTC+09:00 by research_helper v0.0.2_",
  "",
  "_Provider: anthropic · Models: model-a, model-b_",
  "",
  "_Prompts (version, temperature): THEME\\_CLUSTER 1.0.0 (0.2), CLUSTER\\_REDUCE 1.0.0 (0.2), TREND\\_REPORT\\_EN 1.0.1 (0.3), SELF\\_CRITIQUE 1.0.0 (0)_",
  "",
  "_Analysis: 3 full text, 6 abstract only · Reduction passes: 2_",
  "",
  "> **Quality warning.** The automated review flagged 2 unresolved issues in this report.",
  "> See Appendix C. Verify the affected claims against the cited papers before using them.",
  "> The report text is a revision made after the last review, and it was not checked again.",
  "",
  "## 1. Executive Summary",
  "",
  `- Scores improved risk [[${A2}]] and replicated [[${A1}]].`,
  "",
  "## 2. Scope and Method",
  "",
  "Analysis depth, counted by research_helper: 3 papers from full text, 6 from the abstract only.",
  "",
  "This is one curated collection.",
  "",
  "## 3. Landscape Overview",
  "",
  `The corpus spans three years [[${A3}]].`,
  "",
  "Papers by year, counted by research_helper.",
  "",
  "| Year | Papers | Dominant designs | Dominant themes |",
  "| --- | --- | --- | --- |",
  "| 2020 | 2 | Randomized controlled trial (1), Retrospective cohort (1) | Risk scores (2) |",
  "| 2021 | 3 | Randomized controlled trial (1), Retrospective cohort (1) | Imaging \\[\\[AAAA0001\\]\\] \\*trials\\* \\| <b>x</b> (3) |",
  "| 2022 | 3 | Retrospective cohort (2), Case report (1) | Other (2), Risk scores (1) |",
  "| n.d. | 1 | Meta-analysis (1) | — |",
  "",
  "## 4. Major Research Themes",
  "",
  "### Risk scores",
  "",
  `Narrative [[${A1}]].`,
  "",
  "Theme “Imaging \\[\\[AAAA0001\\]\\] \\*trials\\* \\| <b>x</b>” (3 papers) was not analysed: too large to analyse.",
  "",
  "## 5. Methodological Trends",
  "",
  `Cohorts dominate [[${A7}]].`,
  "",
  "Study designs, counted by research_helper.",
  "",
  "| Study design | Papers | Share |",
  "| --- | --- | --- |",
  "| Retrospective cohort | 4 | 44% |",
  "| Randomized controlled trial | 2 | 22% |",
  "| Case report | 1 | 11% |",
  "| Meta-analysis | 1 | 11% |",
  "| Not stated | 1 | 11% |",
  "",
  "## 6. Key Findings and Convergence",
  "",
  "None found.",
  "",
  "## 7. Contradictions and Debates",
  "",
  `One claim [[${A4}]] and its opposite [[${A5}]].`,
  "",
  "## 8. Gaps and Open Questions",
  "",
  "Gaps.",
  "",
  "## 9. Emerging Directions",
  "",
  "Directions.",
  "",
  "## 10. Notable Papers",
  "",
  notableTable([A1, A2, A3, A4, A5, A6, A7, A8]),
  "",
  "## 11. Bibliography",
  "",
  "[1] Author 1 (2021). Title \\[AAAA0002\\]. <https://doi.org/10.1000/aaaa0002>",
  "",
  "[2] Author 2 (2021). Title \\[AAAA0001\\].",
  "",
  "[3] Author 3 (2021). Title \\[AAAA0003\\].",
  "",
  "[4] Author 4 (2021). Title \\[AAAA0007\\].",
  "",
  "[5] Author 5 (2021). Title \\[AAAA0004\\].",
  "",
  "[6] Author 6 (2021). Title \\[AAAA0005\\].",
  "",
  "[7] Author 7 (2021). Title \\[AAAA0006\\].",
  "",
  "[8] Author 8 (2021). Title \\[AAAA0008\\].",
  "",
  "### Retracted — not used in this report",
  "",
  "- Retracted, A. (2019). Withdrawn study. <https://doi.org/10.5555/retr.1>",
  "",
  "## Appendix A — Excluded from synthesis",
  "",
  "| Item | Title | Reason | Code |",
  "| --- | --- | --- | --- |",
  "| RETR0001 | Withdrawn study | Retracted: Falsification of data | `retracted` |",
  "| DUPL0001 | Preprint of A1 | Duplicate of AAAA0001 | `duplicate_of:AAAA0001` |",
  "| FAIL0001 | — | Summary failed after retries | `llm_failed_after_retries` |",
  "",
  "## Appendix B — Provenance",
  "",
  "### Run parameters",
  "",
  "- Provider: anthropic",
  "",
  "| Prompt | Version | Model | Temperature |",
  "| --- | --- | --- | --- |",
  "| THEME\\_CLUSTER | 1.0.0 | model-a | 0.2 |",
  "| CLUSTER\\_REDUCE | 1.0.0 | model-a | 0.2 |",
  "| TREND\\_REPORT\\_EN | 1.0.1 | model-b | 0.3 |",
  "| SELF\\_CRITIQUE | 1.0.0 | model-a | 0 |",
  "",
  "- Reduction passes: 2",
  "- Review rounds: 1",
  "- Target length sent to the model: 4250 words",
  "- The target length setting was above 4250 words, so the target was capped at 4250 words, the longest the report's output limit is sized for.",
  "- Tokens of this run: 50000 in, 9000 out",
  "- Total cost of this run: $0.4321",
  "",
  "### Automated quality figures",
  "",
  "- Citation density (cited factual sentences / factual sentences): 50%",
  "- Coverage (distinct cited papers / analysed papers): 89%",
  "- Citations removed as invalid: 1",
  "- Combined citation markers split: 2",
  "- Mean grounding score of the summaries: 0.71",
  "- Contradictions found by the theme analyses: 3",
  "- Unresolved high-severity review findings: 1",
  "",
  "The summaries were made by more than one model: model-a, model-b.",
  "",
  "Some summaries were reused from a cache entry another model made.",
  "",
  "The summaries were made with more than one version of a prompt: PAPER\\_SUMMARY\\_ABSTRACT 1.0.0, PAPER\\_SUMMARY\\_ABSTRACT 1.0.1.",
  "",
  "### Per-paper summaries",
  "",
  "| Item | Source | Confidence | Grounding | Tokens in | Tokens out | Cost (USD) | Theme | Model | Prompt |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| AAAA0001 | Full text (attachment) | High | 1.00 | 1000 | 200 | 0.0100 | Risk scores | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0002 | Abstract | Medium | 0.50 | 800 | 150 | 0.0080 | Risk scores | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0003 | Abstract | Medium | — | — | — | — | Imaging \\[\\[AAAA0001\\]\\] \\*trials\\* \\| <b>x</b> | model-b | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0004 | Full text (Europe PMC) | High | 0.75 | 2000 | 300 | 0.0200 | Imaging \\[\\[AAAA0001\\]\\] \\*trials\\* \\| <b>x</b> | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0005 | Abstract | Low | 0.25 | 500 | 100 | — | Imaging \\[\\[AAAA0001\\]\\] \\*trials\\* \\| <b>x</b> | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0006 | Metadata only | None | — | — | — | — | Other | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0007 | Abstract | Medium | 1.00 | 700 | 120 | 0.0070 | Other | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.1 |",
  "| AAAA0008 | Abstract | Medium | 0.50 | 600 | 110 | 0.0060 | No theme: Its theme had fewer papers than the minimum per theme and was dropped. | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "| AAAA0009 | Full text (attachment) | High | 1.00 | 3000 | 400 | 0.0300 | Risk scores | model-a | PAPER\\_SUMMARY\\_ABSTRACT 1.0.0 |",
  "",
  "## Appendix C — Unresolved review findings",
  "",
  "The report text is a revision made after the last review, and it was not checked again.",
  "",
  "| Severity | Type | Section | Quoted text | Explanation | Suggested fix |",
  "| --- | --- | --- | --- | --- | --- |",
  "| High | Unsupported claim | — | Narrative \\[\\[AAAA0001\\]\\] \\| more | No summary says so. | Remove it. |",
  "| Medium | Overgeneralized | 1. Executive Summary | Scores improved risk. | Only two papers. | — |",
  "",
].join("\n");

const section = (
  report: Pick<ScaffoldedReport, "sections">,
  n: number,
): ReportSection =>
  report.sections.find((s) => s.number === n) as ReportSection;

/** The scaffold's result as the stored record the renderers read. */
function stored(report: ScaffoldedReport): TrendReport {
  const { notablePapers: _notable, ...fields } = report;
  return {
    ...fields,
    id: "report-1",
    libraryID: 1,
    collectionKey: "COLL0001",
    collectionName: "Cardio",
    language: "en",
    generatedAtEpochMs: GENERATED,
    pluginVersion: "0.0.2",
    audioScripts: {},
    providerId: "anthropic",
    prompts: PROMPTS,
    usage: undefined,
  };
}

/** A node as `citationNodes` makes it (`P4-T13`'s test does the same). */
function node(itemKey: string): CitationNode {
  const uri = `http://zotero.org/users/local/abcdefgh/items/${itemKey}`;
  const citationItem = { uris: [uri], itemData: { id: uri } };
  return {
    itemKey,
    uri,
    selectUri: `zotero://select/library/items/${itemKey}`,
    text: `Author ${itemKey}`,
    html: citationSpan(
      citationItem,
      `(<span class="citation-item">${escapeHtml(`Author ${itemKey}`)}</span>)`,
    ),
    citationItem,
  };
}

/** A bibliography for `md`'s §1–§10, in their order. */
function bibliographyFor(md: string): BibliographyEntry[] {
  return bibliographyKeys(splitSections(md, HEADINGS).sections).map(
    (key, i) => ({
      itemKey: key,
      index: i + 1,
      text: `E${String(i)}`,
      doi: undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// The 12-item fixture, whole
// ---------------------------------------------------------------------------

describe("scaffoldReport — the 12-item fixture (Done when 1)", () => {
  const report = scaffoldReport(input());

  it("writes the header, both tables and Appendices A, B and C as counted by hand", () => {
    expect(report.markdown).toBe(EXPECTED);
  });

  it("titles the note with the collection and the local date (docs/06 §14.2)", () => {
    expect(report.title).toBe(
      "Research Trends: Cardio [risk] *2026* (2026-10-30)",
    );
  });

  it("computes the record's figures", () => {
    expect(report.scope).toEqual(input().plan.scope);
    expect(report.summaryIds).toEqual(PAPERS.map((p) => p.summary.id));
    expect(report.citedItemKeys).toEqual(CITED);
    expect(report.bibliography.map((e) => e.itemKey)).toEqual(CITED);
    expect(report.qualityProxies).toEqual({
      citationDensity: 0.5,
      coverageRatio: 8 / 9,
      brokenCitationCount: 1,
      meanGroundingScore: 5 / 7,
      contradictionCount: 3,
      unresolvedHighSeverityCount: 1,
    });
    expect(report.excluded).toEqual(input().excluded);
    expect(report.critique).toBe(CRITIQUE);
    expect(report.clustering).toBe(CLUSTERING);
    expect(report.notablePapers).toEqual({
      ok: true,
      rows: 8,
      invalidRows: [],
    });
  });

  it("puts a retracted item in the unnumbered list and never in the numbered entries", () => {
    expect(report.retracted).toEqual(RETRACTED);
    expect(report.bibliography.some((e) => e.itemKey === RETR)).toBe(false);
    const references = section(report, 11).markdown;
    const listAt = references.indexOf(`### ${DEFAULT_RETRACTED_HEADING}`);
    expect(listAt).toBeGreaterThan(references.indexOf("[8] "));
    expect(references.slice(listAt)).toContain("Withdrawn study");
    expect(references.slice(0, listAt)).not.toContain("Withdrawn study");
  });

  it("drops the model's preamble and says so; flags the capped target from the plan", () => {
    expect(report.markdown).not.toContain("My own title");
    expect(report.warnings).toEqual([
      TARGET_WORDS_CAPPED_WARNING,
      PREAMBLE_DROPPED_WARNING,
    ]);
  });

  it("updates the sections it writes into, and keeps each section's cited keys", () => {
    expect(section(report, 2).markdown.startsWith("Analysis depth")).toBe(true);
    expect(section(report, 3).markdown).toContain("| 2020 | 2 |");
    expect(section(report, 5).markdown).toContain(
      "| Retrospective cohort | 4 | 44% |",
    );
    expect(section(report, 11).citedItemKeys).toEqual([]);
    expect(section(report, 1).citedItemKeys).toEqual([A2, A1]);
    expect(section(report, 10).citedItemKeys).toEqual([
      A1,
      A2,
      A3,
      A4,
      A5,
      A6,
      A7,
      A8,
    ]);
  });

  it("renders through P4-T15's export and P4-T13's note renderer", () => {
    const record = stored(report);
    const file = renderReportMarkdown(record);
    // §11 is the run's list; the appendices survive after it.
    expect(file).toContain("\n## Appendix A — Excluded from synthesis\n");
    expect(file).toContain("\n## Appendix C — Unresolved review findings\n");
    expect(file).not.toMatch(/\[\[[A-Z0-9]{8}\]\]/);
    // `<` from model text is escaped once, by the export, never twice.
    expect(file).toContain("\\<b>x\\</b>");
    expect(file).not.toContain("\\\\<b>");
    const html = renderReportNoteHtml(record, CITED.map(node));
    expect(html).toContain("<h2>Appendix B — Provenance</h2>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    // The theme name's marker stayed text: the 8 Notable Papers rows and the
    // 8 entries are the only citation nodes.
    expect(html.match(/class="citation"/g)?.length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Done when 2: the Notable Papers check
// ---------------------------------------------------------------------------

describe("checkNotablePapers (Done when 2)", () => {
  const valid = new Set(PAPERS.map((p) => p.itemKey));
  const keys = (n: number): string[] =>
    Array.from(
      { length: n },
      (_, i) => PAPERS[i % PAPERS.length]?.itemKey ?? A1,
    );

  it("passes 8 and 15 rows of valid keys", () => {
    expect(checkNotablePapers(notableTable(keys(8)), valid)).toEqual({
      ok: true,
      rows: 8,
      invalidRows: [],
    });
    expect(checkNotablePapers(notableTable(keys(15)), valid).ok).toBe(true);
  });

  it("fails 7 rows and 16 rows", () => {
    expect(checkNotablePapers(notableTable(keys(7)), valid)).toEqual({
      ok: false,
      rows: 7,
      invalidRows: [],
    });
    expect(checkNotablePapers(notableTable(keys(16)), valid).ok).toBe(false);
  });

  it("fails a row whose key is outside the valid set, or was replaced", () => {
    expect(
      checkNotablePapers(notableTable([...keys(7), "ZZZZ9999"]), valid),
    ).toEqual({
      ok: false,
      rows: 8,
      invalidRows: [8],
    });
    const replaced = notableTable(keys(8)).replace(
      `[[${A3}]]`,
      INVALID_CITATION_TEXT,
    );
    expect(checkNotablePapers(replaced, valid).invalidRows).toEqual([3]);
    const retracted = notableTable([...keys(7), RETR]);
    expect(checkNotablePapers(retracted, valid).invalidRows).toEqual([8]);
  });

  it("fails a Paper cell with two markers or a malformed one; reads only the first cell", () => {
    const two = notableTable(keys(8)).replace(
      `| [[${A2}]] |`,
      `| [[${A2}]] [[${A3}]] |`,
    );
    expect(checkNotablePapers(two, valid).invalidRows).toEqual([2]);
    const lower = notableTable(keys(8)).replace(`[[${A2}]]`, "[[aaaa0002]]");
    expect(checkNotablePapers(lower, valid).invalidRows).toEqual([2]);
    const later = notableTable(keys(8)).replace("| Why. |", "| [[ZZZZ9999]] |");
    expect(checkNotablePapers(later, valid).ok).toBe(true);
  });

  it("finds no table inside a code fence, and none at all as 0 rows", () => {
    expect(checkNotablePapers("No table.", valid)).toEqual({
      ok: false,
      rows: 0,
      invalidRows: [],
    });
    const fenced = ["```", notableTable(keys(8)), "```"].join("\n");
    expect(checkNotablePapers(fenced, valid).rows).toBe(0);
  });

  it("does not stop the run: a 7-row table ships with a warning and a line in Appendix B", () => {
    const md = modelMarkdown(notableTable(keys(7)));
    const report = scaffoldReport(
      input({ composed: composed(md), bibliography: bibliographyFor(md) }),
    );
    expect(report.notablePapers).toEqual({
      ok: false,
      rows: 7,
      invalidRows: [],
    });
    expect(report.warnings).toContain(NOTABLE_PAPERS_INVALID_WARNING);
    expect(report.markdown).toContain(
      "\nThe Notable Papers table has 7 rows; 8 to 15 are required.\n",
    );
  });

  it("names the rows that cite no analysed paper in Appendix B", () => {
    const md = modelMarkdown(
      notableTable([A1, A2, A3, A4, A5, A6, A7, A8]).replace(
        `[[${A6}]]`,
        INVALID_CITATION_TEXT,
      ),
    );
    const report = scaffoldReport(
      input({ composed: composed(md), bibliography: bibliographyFor(md) }),
    );
    expect(report.notablePapers.invalidRows).toEqual([6]);
    expect(report.markdown).toContain(
      "\nRows of the Notable Papers table that cite no analysed paper: 6.\n",
    );
    expect(report.markdown).not.toContain("8 to 15 are required");
  });
});

// ---------------------------------------------------------------------------
// Done when 3 and 4: the pass count; §11 replaced, never merged
// ---------------------------------------------------------------------------

describe("the header's pass count (Done when 3)", () => {
  it.each([0, 1, 3])("equals the run's counter, %i", (passes) => {
    const report = scaffoldReport(input({ reductionPasses: passes }));
    expect(report.reductionPasses).toBe(passes);
    expect(report.markdown).toContain(
      `· Reduction passes: ${String(passes)}_\n`,
    );
    expect(report.markdown).toContain(
      `\n- Reduction passes: ${String(passes)}\n`,
    );
  });
});

describe("§11 is replaced, never merged (Done when 4)", () => {
  const report = scaffoldReport(input());

  it("keeps nothing of the model's §11 and numbers only §1–§10's keys", () => {
    const references = section(report, 11).markdown;
    expect(references).not.toContain(
      "Listed only in the model's own bibliography",
    );
    expect(references).not.toContain("[[");
    expect(bibliographyKeys(composed().sections)).toEqual(CITED);
    expect(report.citedItemKeys).not.toContain(A9);
  });

  it("refuses a bibliography in another order, a missing entry, or indices not 1…n", () => {
    const swapped = [
      BIBLIOGRAPHY[1],
      BIBLIOGRAPHY[0],
      ...BIBLIOGRAPHY.slice(2),
    ].map((e, i) => ({ ...(e as BibliographyEntry), index: i + 1 }));
    expect(() => scaffoldReport(input({ bibliography: swapped }))).toThrow(
      /another order/,
    );
    expect(() =>
      scaffoldReport(input({ bibliography: BIBLIOGRAPHY.slice(0, 7) })),
    ).toThrow(/another order/);
    const gap = BIBLIOGRAPHY.map((e) => ({ ...e, index: e.index + 1 }));
    expect(() => scaffoldReport(input({ bibliography: gap }))).toThrow(
      RangeError,
    );
  });

  it("leaves the retracted list out under exclude_entirely, and refuses a retracted numbered entry", () => {
    const report2 = scaffoldReport(
      input({ retractionPolicy: "exclude_entirely" }),
    );
    expect(report2.retracted).toEqual([]);
    expect(report2.markdown).not.toContain(DEFAULT_RETRACTED_HEADING);
    const bad = [{ itemKey: A2, text: "x", doi: undefined }];
    expect(() => scaffoldReport(input({ retracted: bad }))).toThrow(
      /retracted item/,
    );
  });
});

// ---------------------------------------------------------------------------
// The capped target, the banner, Appendix C
// ---------------------------------------------------------------------------

describe("the capped-target line reads the current plan (item 312(c))", () => {
  const capped = EN_REPORT_LABELS.targetWordsCapped.replace(/\{max\}/g, "4250");

  it("drops a cached report's stale warning when this run was not capped", () => {
    const report = scaffoldReport(
      input({
        composed: composed(modelMarkdown(), [
          TARGET_WORDS_CAPPED_WARNING,
          "report_regenerated_structure",
        ]),
        plan: { ...input().plan, targetWordsCapped: false },
      }),
    );
    expect(report.markdown).not.toContain(capped);
    expect(report.warnings).toEqual([
      "report_regenerated_structure",
      PREAMBLE_DROPPED_WARNING,
    ]);
  });

  it("writes the line when this run was capped, though the cached report was not", () => {
    const report = scaffoldReport(
      input({ composed: composed(modelMarkdown(), []) }),
    );
    expect(report.markdown).toContain(`\n- ${capped}\n`);
    expect(report.warnings).toContain(TARGET_WORDS_CAPPED_WARNING);
  });
});

describe("the critique's warnings (coordinator, item 317(c))", () => {
  const line = EN_REPORT_LABELS.critiqueTextUnchecked;

  it("writes Appendix B's line for critique_text_unchecked and carries every critique warning", () => {
    const report = scaffoldReport(
      input({
        critiqueWarnings: [
          CRITIQUE_PER_SECTION_WARNING,
          CRITIQUE_TEXT_UNCHECKED_WARNING,
        ],
      }),
    );
    const appendixB = report.markdown.slice(
      report.markdown.indexOf(EN_REPORT_LABELS.appendixBHeading),
      report.markdown.indexOf(EN_REPORT_LABELS.appendixCHeading),
    );
    expect(appendixB).toContain(`\n\n${line}\n\n`);
    expect(report.warnings).toContain(CRITIQUE_PER_SECTION_WARNING);
    expect(report.warnings).toContain(CRITIQUE_TEXT_UNCHECKED_WARNING);
  });

  it("writes no line without it, a per-section warning alone included", () => {
    expect(scaffoldReport(input()).markdown).not.toContain(line);
    const report = scaffoldReport(
      input({ critiqueWarnings: [CRITIQUE_PER_SECTION_WARNING] }),
    );
    expect(report.markdown).not.toContain(line);
    expect(report.warnings).toContain(CRITIQUE_PER_SECTION_WARNING);
  });
});

describe("the banner and Appendix C (owner, items 286, 312(b))", () => {
  const problem = CRITIQUE
    .unresolved[1] as CritiqueOutcome["unresolved"][number];
  const run = (critique: CritiqueOutcome): string =>
    scaffoldReport(input({ critique })).markdown;

  it("has no banner and says the review did not run when rounds is 0", () => {
    const md = run({
      rounds: 0,
      unresolved: [],
      revisedAfterLastCritique: false,
    });
    expect(md).not.toContain("Quality warning");
    expect(md).toContain(
      "\n\nThe automated review did not run for this report.\n",
    );
  });

  it("has no banner when the review left nothing and the text is the draft it read", () => {
    const md = run({
      rounds: 2,
      unresolved: [],
      revisedAfterLastCritique: false,
    });
    expect(md).not.toContain("Quality warning");
    expect(md).toContain(
      "\n\nThe automated review left no unresolved finding.\n",
    );
  });

  it("counts one unresolved issue in the singular", () => {
    const md = run({
      rounds: 1,
      unresolved: [problem],
      revisedAfterLastCritique: false,
    });
    expect(md).toContain(
      "> **Quality warning.** The automated review flagged 1 unresolved issue in this report.\n> See Appendix C.",
    );
    expect(md).not.toContain("revision");
  });

  it("states a revision that could not be applied, in the banner and Appendix C", () => {
    const sentence = EN_REPORT_LABELS.bannerRevisionNotApplied;
    const md = run({
      rounds: 1,
      unresolved: [problem],
      revisedAfterLastCritique: false,
      revisionNotApplied: true,
    });
    expect(md).toContain(`> ${sentence}\n`);
    expect(md).toContain(
      `## Appendix C — Unresolved review findings\n\n${sentence}\n`,
    );
    expect(md).not.toContain(EN_REPORT_LABELS.bannerNotRechecked);
  });

  it("warns of an unchecked revision even with nothing left unresolved", () => {
    const md = run({
      rounds: 1,
      unresolved: [],
      revisedAfterLastCritique: true,
    });
    expect(md).toContain(
      `> **Quality warning.** ${EN_REPORT_LABELS.bannerNotRechecked}\n`,
    );
    expect(md).not.toContain("See Appendix C");
  });
});

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

describe("the tables' counts", () => {
  it("ranks designs most first, ties in the schema's order, not stated last", () => {
    expect(designFrequencies(PAPERS)).toEqual([
      { label: "retrospective_cohort", count: 4 },
      { label: "randomized_controlled_trial", count: 2 },
      { label: "case_report", count: 1 },
      { label: "meta_analysis", count: 1 },
      { label: null, count: 1 },
    ]);
  });

  it("counts years ascending, no year last, at most two designs and themes", () => {
    const rct = "randomized_controlled_trial";
    const retro = "retrospective_cohort";
    expect(yearRows(PAPERS, CLUSTERING)).toEqual([
      {
        year: 2020,
        papers: 2,
        designs: [
          { label: rct, count: 1 },
          { label: retro, count: 1 },
        ],
        themes: [{ themeId: "T1", count: 2 }],
      },
      {
        year: 2021,
        papers: 3,
        designs: [
          { label: rct, count: 1 },
          { label: retro, count: 1 },
        ],
        themes: [{ themeId: "T2", count: 3 }],
      },
      {
        year: 2022,
        papers: 3,
        designs: [
          { label: retro, count: 2 },
          { label: "case_report", count: 1 },
        ],
        themes: [
          { themeId: "T3", count: 2 },
          { themeId: "T1", count: 1 },
        ],
      },
      {
        year: undefined,
        papers: 1,
        designs: [{ label: "meta_analysis", count: 1 }],
        themes: [],
      },
    ]);
  });

  it("refuses a plan whose scope disagrees with the papers given", () => {
    const plan = {
      ...input().plan,
      scope: { ...input().plan.scope, fullTextCount: 4 },
    };
    expect(() => scaffoldReport(input({ plan }))).toThrow(/fullTextCount/);
    expect(() => scaffoldReport(input({ totalCount: 13 }))).toThrow(
      /totalCount/,
    );
  });

  it("names an unanalysed theme's other reasons in §4", () => {
    const base = { passes: 0, subBatches: 1, requests: 1, calls: 1 } as const;
    const themes: ThemeResult[] = [
      {
        ...base,
        status: "unanalysed",
        themeId: "T1",
        reason: "no_representative_papers",
      },
      {
        ...base,
        status: "unanalysed",
        themeId: "T2",
        reason: "merge_input_over_budget",
      },
      {
        ...base,
        status: "unanalysed",
        themeId: "T3",
        reason: "provider_unavailable",
      },
    ];
    const body = section(scaffoldReport(input({ themes })), 4).markdown;
    expect(body).toContain(
      "Theme “Risk scores” (3 papers) was not analysed: no representative paper remained after its citations were checked.",
    );
    expect(body).toContain(
      "(3 papers) was not analysed: its partial analyses were too large to combine.",
    );
    expect(body).toContain(
      "Theme “Other” (2 papers) was not analysed: its analysis failed (provider\\_unavailable).",
    );
  });

  it("writes an empty Appendix A and a two-stage unmapped paper's theme", () => {
    const clustering: ThemeClustering = {
      ...CLUSTERING,
      unclustered: [{ itemKey: A8, reason: UNMAPPED_THEME_REASON }],
    };
    const scope = { ...input().plan.scope, totalCount: 9, excludedCount: 0 };
    const report = scaffoldReport(
      input({
        excluded: [],
        totalCount: 9,
        plan: { ...input().plan, scope },
        clustering,
      }),
    );
    expect(report.markdown).toContain(
      "## Appendix A — Excluded from synthesis\n\nNo item was excluded from the synthesis.\n",
    );
    expect(report.markdown).toContain(`| No theme: ${UNMAPPED_THEME_REASON} |`);
  });

  it("omits the model and prompt columns when the summaries agree", () => {
    const same = PAPERS.map((p) => ({
      ...p,
      summary: {
        ...p.summary,
        modelId: "model-a",
        promptVersion: "1.0.0",
        warnings: [],
      },
    }));
    const md = scaffoldReport(input({ analysed: same })).markdown;
    expect(md).toContain(
      "| Item | Source | Confidence | Grounding | Tokens in | Tokens out | Cost (USD) | Theme |\n",
    );
    expect(md).not.toContain("more than one");
    expect(md).not.toContain("another model made");
  });
});

describe("formatTimestamp and inertText", () => {
  it("writes the instant in the caller's offset", () => {
    expect(formatTimestamp(GENERATED)).toEqual({
      date: "2026-10-30",
      timestamp: "2026-10-30 05:06 UTC+00:00",
    });
    expect(formatTimestamp(GENERATED, 540).timestamp).toBe(
      "2026-10-30 14:06 UTC+09:00",
    );
    expect(formatTimestamp(Date.UTC(2026, 9, 30, 2, 0), -330)).toEqual({
      date: "2026-10-29",
      timestamp: "2026-10-29 20:30 UTC-05:30",
    });
    expect(() => formatTimestamp(GENERATED, 15 * 60)).toThrow(RangeError);
    expect(() => formatTimestamp(GENERATED, 1.5)).toThrow(RangeError);
  });

  it("makes untrusted text inert, one line, and leaves < to the renderers", () => {
    expect(inertText("a\n[[AAAA0001]] *b* _c_ `d` ~e~ |f| \\g <h>")).toBe(
      "a \\[\\[AAAA0001\\]\\] \\*b\\* \\_c\\_ \\`d\\` \\~e\\~ \\|f\\| \\\\g <h>",
    );
  });
});

// ---------------------------------------------------------------------------
// The label table (docs/08 §10.4; G-41)
// ---------------------------------------------------------------------------

const KEYS = Object.keys(EN_REPORT_LABELS) as ReportLabelKey[];

describe("reportLabels.ts", () => {
  it("lists every ko label not yet approved, and only those", () => {
    const pending = KEYS.filter((key) => KO_REPORT_LABELS[key] === undefined);
    expect([...KO_REPORT_LABELS_PENDING_REVIEW].sort()).toEqual(
      [...pending].sort(),
    );
    expect(new Set(KO_REPORT_LABELS_PENDING_REVIEW).size).toBe(
      KO_REPORT_LABELS_PENDING_REVIEW.length,
    );
    for (const key of KEYS) {
      expect(isKoLabelPending(key)).toBe(
        KO_REPORT_LABELS_PENDING_REVIEW.includes(key),
      );
    }
    // Item 292(b)'s label, then item 319's 136 (owner, 2026-11-01, G-41),
    // byte for byte from the reviewed TSV; only the line added after that
    // review waits (item 317(c)).
    expect(KO_REPORT_LABELS.invalidCitation).toBe("[인용 삭제: 잘못된 참조]");
    const rows = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../plan/reports/ko-draft-report-labels.tsv",
      ),
      "utf8",
    )
      .split(/\r?\n/)
      .slice(1)
      .filter((line) => line !== "")
      .map((line) => line.split("\t"));
    expect(rows).toHaveLength(136);
    for (const [key, en, ko] of rows) {
      expect(EN_REPORT_LABELS[key as ReportLabelKey], key).toBe(en);
      expect(KO_REPORT_LABELS[key as ReportLabelKey], key).toBe(ko);
    }
    expect(Object.keys(KO_REPORT_LABELS)).toHaveLength(138);
    // The line added after that review (item 317(c)), approved by the owner
    // as item 324(c) on 2026-11-01 (G-41), byte for byte.
    expect(KO_REPORT_LABELS.critiqueTextUnchecked).toBe(
      "일부 문단은 자동 검토를 거치지 않았습니다. 그 문단이 인용한 요약이 너무 길어 한 번의 검토 요청으로 보낼 수 없었기 때문입니다.",
    );
    expect(KO_REPORT_LABELS_PENDING_REVIEW).toEqual([]);
  });

  it("gives a ko report its approved Korean and English for every pending label", () => {
    expect(reportLabel("ko", "invalidCitation")).toBe(
      "[인용 삭제: 잘못된 참조]",
    );
    expect(reportLabel("en", "invalidCitation")).toBe(INVALID_CITATION_TEXT);
    const ko = reportLabels("ko");
    for (const key of KO_REPORT_LABELS_PENDING_REVIEW) {
      expect(ko[key]).toBe(EN_REPORT_LABELS[key]);
    }
    // Since item 319, a ko report's own words are the owner's Korean.
    const report = scaffoldReport(input({ language: "ko" })).markdown;
    expect(report).not.toBe(EXPECTED);
    expect(report).toContain(`## ${ko.appendixBHeading}`);
    expect(report).not.toContain(EN_REPORT_LABELS.appendixBHeading);
    expect(ko.appendixBHeading).toBe(KO_REPORT_LABELS.appendixBHeading);
  });

  it("references the code-side English of earlier cards, so each text has one source", () => {
    expect(EN_REPORT_LABELS.otherThemeName).toBe(OTHER_THEME_NAME);
    expect(EN_REPORT_LABELS.otherThemeDefinition).toBe(OTHER_THEME_DEFINITION);
    expect(EN_REPORT_LABELS.smallTheme).toBe(SMALL_THEME_REASON);
    expect(EN_REPORT_LABELS.unmappedTheme).toBe(UNMAPPED_THEME_REASON);
    expect(EN_REPORT_LABELS.invalidCitation).toBe(INVALID_CITATION_TEXT);
    expect(EN_REPORT_LABELS.retractedHeading).toBe(DEFAULT_RETRACTED_HEADING);
    expect(EN_REPORT_LABELS.noYear).toBe(DIGEST_NO_YEAR);
  });

  it("keeps every label one line of plain text", () => {
    for (const key of KEYS) {
      const text = EN_REPORT_LABELS[key];
      expect(text, key).not.toMatch(/[\r\n|<>`*~\\]/);
      // An underscore only inside a word (`research_helper`).
      expect(text.replace(/(?<=\p{L})_(?=\p{L})/gu, ""), key).not.toContain(
        "_",
      );
      if (key !== "invalidCitation") expect(text, key).not.toMatch(/[[\]]/);
    }
    for (const [key, text] of Object.entries(KO_REPORT_LABELS)) {
      // The same placeholders; Korean word order may place them differently
      // (`headerScope` names the total first).
      expect([...labelPlaceholders(text)].sort(), key).toEqual(
        [...labelPlaceholders(EN_REPORT_LABELS[key as ReportLabelKey])].sort(),
      );
      expect(text, key).not.toMatch(/[\r\n|<>`*~\\]/);
      if (key !== "invalidCitation") expect(text, key).not.toMatch(/[[\]]/);
    }
  });

  it("fills placeholders and refuses a missing value", () => {
    expect(fillLabel("{a} and {a}, {b}", { a: 1, b: "x" })).toBe("1 and 1, x");
    expect(() => fillLabel("{a}", {})).toThrow(/\{a\}/);
    expect(labelPlaceholders(EN_REPORT_LABELS.headerScope)).toEqual([
      "analysed",
      "total",
      "years",
      "timestamp",
      "version",
    ]);
  });

  it("orders study designs as the paper-summary schema does", () => {
    const file = resolve(
      import.meta.dirname,
      "../../../src/prompts/schemas/paper-summary.v1.json",
    );
    const schema = JSON.parse(readFileSync(file, "utf8")) as {
      properties: {
        studyDesign: { properties: { label: { enum: (string | null)[] } } };
      };
    };
    const order = schema.properties.studyDesign.properties.label.enum.filter(
      (v): v is string => v !== null,
    );
    expect(Object.keys(STUDY_DESIGN_LABEL_KEYS)).toEqual(order);
  });
});

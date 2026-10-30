/**
 * The client-generated parts of the trend report (`P4-T12`; `docs/06` §9.1,
 * §12.2, §12.3): the title block and metadata header, the §3 year table, the
 * §5 study-design table, §11's bibliography slot and the unnumbered retracted
 * list, the Notable Papers check, the quality banner and Appendices A, B and
 * C — every figure computed in code, every word from `reportLabels.ts` in the
 * report's language. The model produces none of it.
 *
 * **Callers.** Nothing calls this module yet. The report run
 * (`trendReportPipeline.ts`, `P4-T18`) calls it at its scaffold stage, after
 * compose (`P4-T08`) and critique (`P4-T09`): first {@link bibliographyKeys}
 * on the shipped draft's sections, to format §11 through `P4-T11`'s
 * `BibliographyPort` (`formatBibliography` for those keys in that order,
 * `formatRetracted` for the retracted items), then {@link scaffoldReport}
 * with the draft, the run's figures and both lists; it spreads the result
 * into the `TrendReport` it stores (`P4-T14`) and renders (`P4-T13`). A `ko`
 * report is the same call with `language: "ko"` (`P4-T21`). The constructing
 * file is `src/bootstrap/registerPipelines.ts` (`P4-T18`); nothing is
 * constructed here: every export is a pure function, a type or a constant.
 *
 * ## What is decided here
 *
 * The readings are `docs/06` §9.1's notes of 2026-10-30; in short:
 *
 * - **The draft is rebuilt from its sections**, so the model's text before
 *   `## 1.` (its own title, say) is dropped ({@link PREAMBLE_DROPPED_WARNING})
 *   and §11's body is replaced wholesale, never merged.
 * - **The two tables are appended to §3 and §5**, each under a caption; a
 *   theme the analyse stage left unanalysed is named at the end of §4 ("too
 *   large to analyse", owner, `plan/00` §6 item 309(f)); §2 opens with the
 *   analysis-depth line.
 * - **No section-level provenance is claimed** (owner, item 286; R-19b):
 *   the header and §2 say "full text" or "abstract only" and nothing more.
 *   Where a claim would go once `P3-T22` passes (item 315): the header's
 *   analysis line and a per-paper column of Appendix B.
 * - **The Notable Papers check never stops the run** (coordinator, item
 *   313): a failure is a warning and a line in Appendix B.
 * - **The "target was capped" line is read from the current run's plan**
 *   ({@link ScaffoldInput.plan}), never from the composed report, which may
 *   come from the `rp` cache (owner, item 312(c); Appendix B, item 314(b)).
 * - **Untrusted text is made inert as Markdown** ({@link inertText}), but
 *   `<` is left to the renderers, which escape it themselves (`P4-T13`,
 *   `P4-T15`): escaping it here too would escape it twice.
 * - **No appendix holds a marker**: item keys are plain text, so the cited
 *   keys of the whole report are exactly §1–§10's, in the bibliography's
 *   order — which {@link scaffoldReport} checks before it returns.
 */

import type { ProviderId } from "../../model/ids";
import type {
  Confidence,
  SourceTier,
  StoredSummary,
  StudyDesignLabel,
} from "../../model/summary";
import type {
  BibliographyEntry,
  CritiqueOutcome,
  CritiqueProblem,
  CritiqueProblemType,
  CritiqueSeverity,
  ExcludedItem,
  ReportLanguage,
  ReportQualityProxies,
  ReportScope,
  ReportSection,
  RetractedEntry,
  ThemeClustering,
  TrendPromptUse,
  TrendReport,
} from "../../model/trend";
import type { Usage } from "../../model/usage";
import type { RetractionPolicy } from "../summarize/screen";
import { CACHE_MIXED_MODEL_WARNING } from "../summarize/summaryCache";
import {
  assertAllMarkersResolve,
  citedKeysOf,
  fencedRanges,
  ITEM_KEY_RE,
} from "./citations";
import { SMALL_THEME_REASON, UNMAPPED_THEME_REASON } from "./cluster";
import {
  TARGET_WORDS_CAPPED_WARNING,
  TARGET_WORDS_MAX,
  type ComposedReport,
  type CompositionPlan,
} from "./compose";
import { doiUrl, printedDoiAddress } from "./exportMarkdown";
import {
  fillLabel,
  reportLabels,
  STUDY_DESIGN_LABEL_KEYS,
  type ReportLabelKey,
} from "./reportLabels";
import { UNANALYSED_REASONS, type ThemeResult } from "./themeAnalysis";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `docs/06` §9.1: the Notable Papers table has 8–15 rows. */
export const NOTABLE_PAPERS_MIN = 8;
/** See {@link NOTABLE_PAPERS_MIN}. */
export const NOTABLE_PAPERS_MAX = 15;

/** The year table names at most this many designs and themes per year. */
export const DOMINANT_PER_YEAR = 2;

/** The model wrote text before `## 1.`, which the title block replaces. */
export const PREAMBLE_DROPPED_WARNING = "report_preamble_dropped";

/** The Notable Papers table failed its check (coordinator, item 313). */
export const NOTABLE_PAPERS_INVALID_WARNING = "report_notable_papers_invalid";

/** What an empty table cell shows. */
const EMPTY_CELL = "—";

/** Every run of whitespace or control characters. */
const BREAKING_RE = /[\s\p{Cc}]+/gu;

/** The inline characters {@link inertText} escapes. `<` is the renderers'. */
const INERT_RE = /[\\`*_[\]~|]/g;

/** A marker-shaped run, as `citations.ts` reads one. */
const MARKER_LIKE_RE = /\[\[([^[\]\r\n]*)\]\]/g;

/** A table separator row (`| --- | :---: |`), as `noteHtml.ts` reads one. */
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const FULL_TEXT_TIERS: ReadonlySet<SourceTier> = new Set([
  "fulltext_pdf",
  "fulltext_epmc",
]);

const TIER_LABELS: Readonly<Record<SourceTier, ReportLabelKey>> = {
  abstract: "tierAbstract",
  fulltext_pdf: "tierFulltextPdf",
  fulltext_epmc: "tierFulltextEpmc",
  metadata_only: "tierMetadataOnly",
};

const CONFIDENCE_LABELS: Readonly<Record<Confidence, ReportLabelKey>> = {
  high: "confidenceHigh",
  medium: "confidenceMedium",
  low: "confidenceLow",
  none: "confidenceNone",
};

const SEVERITY_LABELS: Readonly<Record<CritiqueSeverity, ReportLabelKey>> = {
  high: "severityHigh",
  medium: "severityMedium",
  low: "severityLow",
};

const SEVERITY_ORDER: readonly CritiqueSeverity[] = ["high", "medium", "low"];

const PROBLEM_LABELS: Readonly<Record<CritiqueProblemType, ReportLabelKey>> = {
  unsupported: "problemUnsupported",
  misattributed: "problemMisattributed",
  number_error: "problemNumberError",
  overgeneralized: "problemOvergeneralized",
  outside_knowledge: "problemOutsideKnowledge",
  missing_contradiction: "problemMissingContradiction",
  abstract_overreach: "problemAbstractOverreach",
  broken_citation: "problemBrokenCitation",
};

/** Appendix A's reason codes (`docs/06` §9.1) to their labels. */
const EXCLUSION_LABELS: Readonly<Record<string, ReportLabelKey>> = {
  retracted: "exclusionRetracted",
  no_abstract_no_pdf: "exclusionNoAbstractNoPdf",
  language_non_english: "exclusionNonEnglish",
  non_english_unsupported: "exclusionNonEnglishUnsupported",
  extraction_failed: "exclusionExtractionFailed",
  llm_failed_after_retries: "exclusionSummaryFailed",
};

const DUPLICATE_PREFIX = "duplicate_of:";

/** The study-design labels in the schema's order: the tie-break. */
const DESIGN_ORDER: readonly StudyDesignLabel[] = Object.keys(
  STUDY_DESIGN_LABEL_KEYS,
) as StudyDesignLabel[];

// ---------------------------------------------------------------------------
// 2. Types
// ---------------------------------------------------------------------------

/** One analysed paper: the run's valid set, in the order Appendix B lists it. */
export interface ScaffoldPaper {
  readonly itemKey: string;
  /** The Zotero item's year; `undefined` when it has none. */
  readonly year: number | undefined;
  /** The stored summary the synthesis used. */
  readonly summary: StoredSummary;
}

/** What the scaffold stage is given. */
export interface ScaffoldInput {
  readonly language: ReportLanguage;
  /** The collection's name. Untrusted. */
  readonly collectionName: string;
  readonly pluginVersion: string;
  readonly generatedAtEpochMs: number;
  /**
   * Minutes east of UTC the times are written in (`+540` for Korea); `0`
   * when absent. The caller reads it from the platform, so this stays pure.
   */
  readonly utcOffsetMinutes?: number;
  readonly providerId: ProviderId;
  /** Every prompt the run called (`TrendReport.prompts`). */
  readonly prompts: readonly TrendPromptUse[];
  /** The run's usage, the summaries it made included (`TrendReport.usage`). */
  readonly usage: Usage | undefined;
  /** `{{N_TOTAL}}`: the items the run started from. */
  readonly totalCount: number;
  /** One per analysed paper; keys unique. */
  readonly analysed: readonly ScaffoldPaper[];
  /** Appendix A's rows; disjoint from {@link analysed}. */
  readonly excluded: readonly ExcludedItem[];
  /** Item titles for Appendix A, when the run has them. Untrusted. */
  readonly titles?: ReadonlyMap<string, string>;
  /** `getReasonDescription`'s text per retracted item (`docs/06` §13.3). Untrusted. */
  readonly retractionReasons?: ReadonlyMap<string, string>;
  /** The final theme assignment. */
  readonly clustering: ThemeClustering;
  /** The client-made `Other` theme's id, shown by its report-language name. */
  readonly otherThemeId: string | undefined;
  /** The analyse stage's results, one per theme (`analyseThemes`). */
  readonly themes: readonly ThemeResult[];
  /** FR-27: the analyse stage's `passes`. */
  readonly reductionPasses: number;
  /** The shipped draft: the last `composed` report the run kept. */
  readonly composed: Pick<
    ComposedReport,
    "sections" | "preamble" | "quality" | "citations" | "warnings"
  >;
  /**
   * The **current** run's plan (`prepareComposition`), never the composed
   * report's own: a cached report's plan may predate the stored target
   * (owner, `plan/00` §6 item 312(c); `docs/06` §9.2).
   */
  readonly plan: Pick<
    CompositionPlan,
    "scope" | "targetWords" | "targetWordsCapped"
  >;
  /** What the self-critique left (`P4-T09`). */
  readonly critique: CritiqueOutcome;
  /** §11's numbered entries, formatted for {@link bibliographyKeys}' order. */
  readonly bibliography: readonly BibliographyEntry[];
  /** The retracted items' entries, formatted the same way. */
  readonly retracted: readonly RetractedEntry[];
  /** `screening.retractionPolicy`: `exclude_entirely` leaves the list out. */
  readonly retractionPolicy: RetractionPolicy;
}

/** What {@link checkNotablePapers} found. */
export interface NotablePapersCheck {
  readonly ok: boolean;
  /** Body rows of §10's first table; `0` when it has none. */
  readonly rows: number;
  /** 1-based rows whose Paper cell is not exactly one valid marker. */
  readonly invalidRows: readonly number[];
}

/** One row of §3's year table, before it is written. */
export interface YearRow {
  /** `undefined` for the papers with no year, listed last. */
  readonly year: number | undefined;
  readonly papers: number;
  /** At most {@link DOMINANT_PER_YEAR}; `null` is "not stated". */
  readonly designs: readonly DesignCount[];
  /** At most {@link DOMINANT_PER_YEAR}. */
  readonly themes: readonly {
    readonly themeId: string;
    readonly count: number;
  }[];
}

/** One study design and its paper count. */
export interface DesignCount {
  readonly label: StudyDesignLabel | null;
  readonly count: number;
}

/** What the scaffold computes of the stored `TrendReport`; the run adds the rest. */
export interface ScaffoldedReport extends Pick<
  TrendReport,
  | "title"
  | "markdown"
  | "sections"
  | "scope"
  | "reductionPasses"
  | "clustering"
  | "bibliography"
  | "retracted"
  | "excluded"
  | "summaryIds"
  | "qualityProxies"
  | "critique"
  | "citedItemKeys"
  | "warnings"
> {
  readonly notablePapers: NotablePapersCheck;
}

type Labels = Readonly<Record<ReportLabelKey, string>>;

// ---------------------------------------------------------------------------
// 3. Text helpers
// ---------------------------------------------------------------------------

/**
 * `text` as one line of inert inline Markdown: line breaks and control
 * characters one space, a backslash before `` \ ` * _ [ ] ~ | ``, so it can
 * open no marker, link, emphasis, code span or table cell. It is only ever
 * placed after a label or inside a table cell, never at the start of a line,
 * so a leading `#` or `-` opens no block. `<` is left alone: `noteHtml.ts`
 * escapes every character of the text and `exportMarkdown.ts` escapes `<`
 * itself, so escaping it here would show a backslash.
 */
export function inertText(text: string): string {
  return text
    .replace(BREAKING_RE, " ")
    .trim()
    .replace(INERT_RE, (c) => `\\${c}`);
}

/** One line of plain text: breaks folded, trimmed (the note title). */
function oneLine(text: string): string {
  return text.replace(BREAKING_RE, " ").trim();
}

/** A Markdown table; every cell already escaped, an empty one shown as a dash. */
function table(head: readonly string[], rows: readonly string[][]): string {
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell) => (cell === "" ? EMPTY_CELL : cell)).join(" | ")} |`;
  return [
    line(head),
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

function decimal(value: number): string {
  return value.toFixed(2);
}

function usd(value: number): string {
  return value.toFixed(4);
}

function count(value: number | undefined, labels: Labels): string {
  return value === undefined ? labels.notReported : String(value);
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The generation instant as the report writes it: the date
 * (`YYYY-MM-DD`) and the time to the minute with its offset
 * (`YYYY-MM-DD HH:MM UTC+09:00`).
 *
 * @throws RangeError for an offset that is not a whole number of minutes
 *   within ±14 hours
 */
export function formatTimestamp(
  epochMs: number,
  utcOffsetMinutes = 0,
): { readonly date: string; readonly timestamp: string } {
  if (
    !Number.isInteger(utcOffsetMinutes) ||
    Math.abs(utcOffsetMinutes) > 14 * 60
  ) {
    throw new RangeError(
      `[research-helper] a UTC offset is whole minutes within ±14 hours, not ${String(utcOffsetMinutes)}`,
    );
  }
  const at = new Date(epochMs + utcOffsetMinutes * 60_000);
  const date = `${String(at.getUTCFullYear())}-${twoDigits(at.getUTCMonth() + 1)}-${twoDigits(at.getUTCDate())}`;
  const sign = utcOffsetMinutes < 0 ? "-" : "+";
  const offset = Math.abs(utcOffsetMinutes);
  const zone = `UTC${sign}${twoDigits(Math.floor(offset / 60))}:${twoDigits(offset % 60)}`;
  return {
    date,
    timestamp: `${date} ${twoDigits(at.getUTCHours())}:${twoDigits(at.getUTCMinutes())} ${zone}`,
  };
}

/** The prompts the run called, each distinct use once, in first-use order. */
function distinctPromptUses(
  prompts: readonly TrendPromptUse[],
): readonly TrendPromptUse[] {
  const seen = new Set<string>();
  const out: TrendPromptUse[] = [];
  for (const use of prompts) {
    const id = [
      use.promptId,
      use.promptVersion,
      use.modelId,
      String(use.temperature),
    ].join("\u0000");
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(use);
  }
  return out;
}

/** Each distinct value, in first-appearance order. */
function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// 4. The pieces
// ---------------------------------------------------------------------------

/**
 * The keys §11 lists, in `[n]` order: first appearance in §1–§10 (`docs/06`
 * §10.1's note, item 4). The run formats exactly these, in this order, before
 * it calls {@link scaffoldReport}; nothing the scaffold adds holds a marker,
 * so the finished report cites the same keys in the same order.
 */
export function bibliographyKeys(
  sections: readonly ReportSection[],
): readonly string[] {
  return citedKeysOf(
    [...sections]
      .filter((section) => section.number <= 10)
      .sort((a, b) => a.number - b.number)
      .map((section) => section.markdown)
      .join("\n\n"),
  );
}

/** A row's cells, `noteHtml.ts`'s way: outer pipes off, split at unescaped `|`. */
function cellsOf(line: string): readonly string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The Notable Papers check (owner, `plan/00` §6 item 286; `docs/06` §9.1's
 * note of 2026-10-30): §10's first table, outside code fences, has
 * {@link NOTABLE_PAPERS_MIN}–{@link NOTABLE_PAPERS_MAX} body rows, and each
 * row's first cell holds exactly one marker, a well-formed key in
 * `validKeys`. No ranking is added and nothing is repaired.
 *
 * @param markdown - §10's body, after the citation pass
 * @param validKeys - the analysed items
 */
export function checkNotablePapers(
  markdown: string,
  validKeys: ReadonlySet<string>,
): NotablePapersCheck {
  const fences = fencedRanges(markdown);
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const fenced = (i: number): boolean =>
    fences.some(
      ([from, to]) => (starts[i] ?? 0) >= from && (starts[i] ?? 0) < to,
    );
  let head = -1;
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const sep = lines[i + 1] ?? "";
    if (
      !fenced(i) &&
      !fenced(i + 1) &&
      (lines[i] ?? "").includes("|") &&
      TABLE_SEPARATOR_RE.test(sep) &&
      sep.includes("-")
    ) {
      head = i;
      break;
    }
  }
  const invalidRows: number[] = [];
  let rows = 0;
  if (head >= 0) {
    for (let i = head + 2; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "" || !line.includes("|") || fenced(i)) break;
      rows += 1;
      const markers = [...(cellsOf(line)[0] ?? "").matchAll(MARKER_LIKE_RE)];
      const key = markers[0]?.[1] ?? "";
      if (
        markers.length !== 1 ||
        !ITEM_KEY_RE.test(key) ||
        !validKeys.has(key)
      ) {
        invalidRows.push(rows);
      }
    }
  }
  return {
    ok:
      invalidRows.length === 0 &&
      rows >= NOTABLE_PAPERS_MIN &&
      rows <= NOTABLE_PAPERS_MAX,
    rows,
    invalidRows,
  };
}

/** Each analysed paper's primary theme, from the clustering's assignments. */
function primaryThemes(
  clustering: ThemeClustering,
): ReadonlyMap<string, string> {
  return new Map(
    clustering.assignments.map((a) => [a.itemKey, a.primaryThemeId]),
  );
}

/** Counts, most first, ties in `order`; an id outside `order` sorts last. */
function ranked<T>(
  counts: ReadonlyMap<T, number>,
  order: readonly T[],
): readonly { readonly id: T; readonly count: number }[] {
  const at = (id: T): number => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...counts.entries()]
    .map(([id, n]) => ({ id, count: n }))
    .sort((a, b) => b.count - a.count || at(a.id) - at(b.id));
}

/** `docs/06` §9.1's design order, "not stated" last. */
const DESIGN_TIE_ORDER: readonly (StudyDesignLabel | null)[] = [
  ...DESIGN_ORDER,
  null,
];

/**
 * §5's table: every analysed paper's `studyDesign.label`, most first, ties in
 * the schema's order, `null` ("not stated") last among equals.
 */
export function designFrequencies(
  papers: readonly ScaffoldPaper[],
): readonly DesignCount[] {
  const counts = new Map<StudyDesignLabel | null, number>();
  for (const paper of papers) {
    const label = paper.summary.content.studyDesign.label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return ranked(counts, DESIGN_TIE_ORDER).map((r) => ({
    label: r.id,
    count: r.count,
  }));
}

/**
 * §3's table: the analysed papers by year, ascending, the papers with no
 * year last; per year at most {@link DOMINANT_PER_YEAR} designs and themes,
 * most first, ties in the schema's order and the clustering's theme order.
 * A paper in no theme counts for no theme.
 */
export function yearRows(
  papers: readonly ScaffoldPaper[],
  clustering: ThemeClustering,
): readonly YearRow[] {
  const primary = primaryThemes(clustering);
  const themeOrder = clustering.themes.map((theme) => theme.themeId);
  const dated = [
    ...new Set(
      papers.flatMap((paper) => (paper.year === undefined ? [] : [paper.year])),
    ),
  ].sort((a, b) => a - b);
  const years: readonly (number | undefined)[] = papers.some(
    (paper) => paper.year === undefined,
  )
    ? [...dated, undefined]
    : dated;
  return years.map((year): YearRow => {
    const inYear = papers.filter((paper) => paper.year === year);
    const themeCounts = new Map<string, number>();
    for (const paper of inYear) {
      const themeId = primary.get(paper.itemKey);
      if (themeId === undefined || !themeOrder.includes(themeId)) continue;
      themeCounts.set(themeId, (themeCounts.get(themeId) ?? 0) + 1);
    }
    return {
      year,
      papers: inYear.length,
      designs: designFrequencies(inYear).slice(0, DOMINANT_PER_YEAR),
      themes: ranked(themeCounts, themeOrder)
        .slice(0, DOMINANT_PER_YEAR)
        .map((r) => ({ themeId: r.id, count: r.count })),
    };
  });
}

/** A design's label in the report's language. */
function designLabel(label: StudyDesignLabel | null, labels: Labels): string {
  return label === null
    ? labels.designNotStated
    : labels[STUDY_DESIGN_LABEL_KEYS[label]];
}

/** A theme's name as the report shows it: `Other` by its label, else inert. */
function themeName(
  themeId: string,
  input: Pick<ScaffoldInput, "clustering" | "otherThemeId">,
  labels: Labels,
): string {
  if (themeId === input.otherThemeId) return labels.otherThemeName;
  const theme = input.clustering.themes.find((t) => t.themeId === themeId);
  return theme === undefined ? inertText(themeId) : inertText(theme.name);
}

/** §12.3's automated proxies, from the draft's checks and the run's figures. */
export function qualityProxiesOf(
  input: Pick<ScaffoldInput, "composed" | "analysed" | "themes" | "critique">,
): ReportQualityProxies {
  const scores = input.analysed.flatMap((paper) =>
    paper.summary.groundingScore === undefined
      ? []
      : [paper.summary.groundingScore],
  );
  let contradictions = 0;
  for (const theme of input.themes) {
    if (theme.status === "analysed") {
      contradictions += theme.analysis.contradictions?.length ?? 0;
    }
  }
  return {
    citationDensity: input.composed.quality.citationDensity,
    coverageRatio: input.composed.quality.coverageRatio,
    brokenCitationCount: input.composed.quality.brokenCitationCount,
    meanGroundingScore:
      scores.length === 0
        ? undefined
        : scores.reduce((sum, s) => sum + s, 0) / scores.length,
    contradictionCount: contradictions,
    unresolvedHighSeverityCount: input.critique.unresolved.filter(
      (problem) => problem.severity === "high",
    ).length,
  };
}

/**
 * The title block (`docs/06` §9.1's note of 2026-10-30): the dated title, and
 * four header lines, each its own paragraph.
 */
export function titleBlock(
  input: Pick<
    ScaffoldInput,
    | "collectionName"
    | "pluginVersion"
    | "generatedAtEpochMs"
    | "utcOffsetMinutes"
    | "providerId"
    | "prompts"
    | "reductionPasses"
    | "plan"
  >,
  labels: Labels,
): { readonly title: string; readonly markdown: string } {
  const { date, timestamp } = formatTimestamp(
    input.generatedAtEpochMs,
    input.utcOffsetMinutes,
  );
  const scope = input.plan.scope;
  const years =
    scope.yearMin === undefined || scope.yearMax === undefined
      ? labels.noYear
      : `${String(scope.yearMin)}–${String(scope.yearMax)}`;
  const uses = distinctPromptUses(input.prompts);
  const models = distinct(uses.map((use) => use.modelId));
  const prompts = distinct(
    uses.map(
      (use) =>
        `${use.promptId} ${use.promptVersion} (${String(use.temperature)})`,
    ),
  );
  const lines = [
    fillLabel(labels.headerScope, {
      analysed: scope.analysedCount,
      total: scope.totalCount,
      years,
      timestamp,
      version: inertText(input.pluginVersion),
    }),
    fillLabel(labels.headerModels, {
      provider: inertText(input.providerId),
      models: models.length === 0 ? EMPTY_CELL : inertText(models.join(", ")),
    }),
    fillLabel(labels.headerPrompts, {
      prompts:
        prompts.length === 0 ? EMPTY_CELL : inertText(prompts.join(", ")),
    }),
    fillLabel(labels.headerAnalysis, {
      fullText: scope.fullTextCount,
      abstract: scope.abstractCount,
      passes: input.reductionPasses,
    }),
  ];
  return {
    title: fillLabel(labels.reportTitle, {
      collection: oneLine(input.collectionName),
      date,
    }),
    markdown: [
      `# ${fillLabel(labels.reportTitle, { collection: inertText(input.collectionName), date })}`,
      ...lines.map((line) => `_${line}_`),
    ].join("\n\n"),
  };
}

/** The sentence a revision state adds to the banner and Appendix C, if any. */
function revisionSentence(
  critique: CritiqueOutcome,
  labels: Labels,
): string | undefined {
  if (critique.revisionNotApplied === true) {
    return labels.bannerRevisionNotApplied;
  }
  if (critique.revisedAfterLastCritique) return labels.bannerNotRechecked;
  return undefined;
}

/**
 * `docs/06` §12.2's banner, as blockquote lines, or `""` when there is
 * nothing to warn of: no unresolved problem, and the shipped text is the
 * draft the last critique read.
 */
export function qualityBanner(
  critique: CritiqueOutcome,
  labels: Labels,
): string {
  const state = revisionSentence(critique, labels);
  const n = critique.unresolved.length;
  if (n === 0 && state === undefined) return "";
  const first =
    n === 0
      ? state
      : n === 1
        ? labels.bannerFlaggedOne
        : fillLabel(labels.bannerFlaggedMany, { count: n });
  const lines = [`> **${labels.bannerTitle}** ${first ?? ""}`.trimEnd()];
  if (n > 0) {
    lines.push(`> ${labels.bannerSeeAppendix}`);
    if (state !== undefined) lines.push(`> ${state}`);
  }
  return lines.join("\n");
}

/** §11's body: the numbered entries, then the unnumbered retracted list. */
function bibliographyBody(
  entries: readonly BibliographyEntry[],
  retracted: readonly RetractedEntry[],
  labels: Labels,
): string {
  const entryText = (text: string, doi: string | undefined): string => {
    if (doi === undefined) return inertText(text);
    const printed = printedDoiAddress(text, doi);
    if (printed !== undefined) {
      return (
        inertText(text.slice(0, printed.start)) +
        `<${doiUrl(doi)}>` +
        inertText(text.slice(printed.end))
      );
    }
    const escaped = inertText(text);
    return escaped === "" ? `<${doiUrl(doi)}>` : `${escaped} <${doiUrl(doi)}>`;
  };
  const blocks = entries.map(
    (entry) => `[${String(entry.index)}] ${entryText(entry.text, entry.doi)}`,
  );
  if (retracted.length > 0) {
    blocks.push(
      `### ${labels.retractedHeading}`,
      retracted
        .map((entry) => `- ${entryText(entry.text, entry.doi)}`)
        .join("\n"),
    );
  }
  return blocks.join("\n\n");
}

/** One Appendix A row's reason, in the report's language. */
function exclusionReason(
  row: ExcludedItem,
  input: Pick<ScaffoldInput, "retractionReasons">,
  labels: Labels,
): string {
  if (row.reason === "retracted") {
    const why = oneLine(input.retractionReasons?.get(row.itemKey) ?? "");
    return why === ""
      ? labels.exclusionRetracted
      : fillLabel(labels.exclusionRetractedBecause, { reason: inertText(why) });
  }
  if (row.reason.startsWith(DUPLICATE_PREFIX)) {
    return fillLabel(labels.exclusionDuplicateOf, {
      key: inertText(row.reason.slice(DUPLICATE_PREFIX.length)),
    });
  }
  const key = EXCLUSION_LABELS[row.reason];
  return key === undefined ? labels.exclusionOther : labels[key];
}

/** A code as a code span when it is plainly one, else inert text. */
function codeCell(code: string): string {
  return /^[A-Za-z0-9_:.-]+$/.test(code) ? `\`${code}\`` : inertText(code);
}

/** Appendix A (`docs/06` §9.1): the excluded items, the reason and its code. */
export function appendixA(
  input: Pick<ScaffoldInput, "excluded" | "titles" | "retractionReasons">,
  labels: Labels,
): string {
  const heading = `## ${labels.appendixAHeading}`;
  if (input.excluded.length === 0) {
    return `${heading}\n\n${labels.appendixANone}`;
  }
  return `${heading}\n\n${table(
    [labels.colItem, labels.colTitle, labels.colReason, labels.colCode],
    input.excluded.map((row) => [
      inertText(row.itemKey),
      inertText(input.titles?.get(row.itemKey) ?? ""),
      exclusionReason(row, input, labels),
      codeCell(row.reason),
    ]),
  )}`;
}

/** A paper's theme cell: its primary theme, or why it has none. */
function themeCell(
  itemKey: string,
  input: Pick<ScaffoldInput, "clustering" | "otherThemeId">,
  primary: ReadonlyMap<string, string>,
  labels: Labels,
): string {
  const themeId = primary.get(itemKey);
  if (themeId !== undefined) return themeName(themeId, input, labels);
  const left = input.clustering.unclustered?.find((u) => u.itemKey === itemKey);
  if (left === undefined) return "";
  const reason =
    left.reason === SMALL_THEME_REASON
      ? labels.smallTheme
      : left.reason === UNMAPPED_THEME_REASON
        ? labels.unmappedTheme
        : labels.unclusteredByModel;
  return fillLabel(labels.noTheme, { reason });
}

/**
 * Appendix B (`docs/06` §9.1's note of 2026-10-30): run parameters, the
 * automated proxies, the Notable Papers check when it failed, mixed-model and
 * mixed-prompt flags, and the per-paper table.
 */
export function appendixB(
  input: ScaffoldInput,
  proxies: ReportQualityProxies,
  notable: NotablePapersCheck,
  labels: Labels,
): string {
  const blocks: string[] = [
    `## ${labels.appendixBHeading}`,
    `### ${labels.runParametersHeading}`,
    `- ${fillLabel(labels.paramProvider, { provider: inertText(input.providerId) })}`,
  ];
  const uses = distinctPromptUses(input.prompts);
  if (uses.length > 0) {
    blocks.push(
      table(
        [
          labels.colPrompt,
          labels.colVersion,
          labels.colModel,
          labels.colTemperature,
        ],
        uses.map((use) => [
          inertText(use.promptId),
          inertText(use.promptVersion),
          inertText(use.modelId),
          String(use.temperature),
        ]),
      ),
    );
  }
  const params = [
    fillLabel(labels.paramReductionPasses, { passes: input.reductionPasses }),
    fillLabel(labels.paramReviewRounds, { rounds: input.critique.rounds }),
    fillLabel(labels.paramTargetWords, { words: input.plan.targetWords }),
  ];
  if (input.plan.targetWordsCapped) {
    params.push(fillLabel(labels.targetWordsCapped, { max: TARGET_WORDS_MAX }));
  }
  params.push(
    fillLabel(labels.paramTokens, {
      input: count(input.usage?.inputTokens, labels),
      output: count(input.usage?.outputTokens, labels),
    }),
    fillLabel(labels.paramTotalCost, {
      cost:
        input.usage?.costUsd === undefined
          ? labels.notReported
          : `$${usd(input.usage.costUsd)}`,
    }),
  );
  blocks.push(params.map((line) => `- ${line}`).join("\n"));

  const figures = [
    fillLabel(labels.proxyCitationDensity, {
      value:
        proxies.citationDensity === undefined
          ? labels.notMeasured
          : percent(proxies.citationDensity),
    }),
    fillLabel(labels.proxyCoverage, { value: percent(proxies.coverageRatio) }),
    fillLabel(labels.proxyBroken, { count: proxies.brokenCitationCount }),
    fillLabel(labels.proxySplit, {
      count: input.composed.citations.figures.splitMarkerCount,
    }),
    fillLabel(labels.proxyGrounding, {
      value:
        proxies.meanGroundingScore === undefined
          ? labels.notMeasured
          : decimal(proxies.meanGroundingScore),
    }),
    fillLabel(labels.proxyContradictions, {
      count: proxies.contradictionCount,
    }),
    fillLabel(labels.proxyUnresolvedHigh, {
      count: proxies.unresolvedHighSeverityCount,
    }),
  ];
  blocks.push(
    `### ${labels.qualityHeading}`,
    figures.map((line) => `- ${line}`).join("\n"),
  );

  const notes: string[] = [];
  if (notable.rows < NOTABLE_PAPERS_MIN || notable.rows > NOTABLE_PAPERS_MAX) {
    notes.push(fillLabel(labels.notableRowCount, { rows: notable.rows }));
  }
  if (notable.invalidRows.length > 0) {
    notes.push(
      fillLabel(labels.notableInvalidRows, {
        rows: notable.invalidRows.join(", "),
      }),
    );
  }
  const summaries = input.analysed.map((paper) => paper.summary);
  const models = distinct(summaries.map((s) => s.modelId));
  const mixedModel = models.length > 1;
  const cachedFromOther = summaries.some((s) =>
    s.warnings.includes(CACHE_MIXED_MODEL_WARNING),
  );
  const versionsByPrompt = new Map<string, string[]>();
  for (const s of summaries) {
    const versions = versionsByPrompt.get(s.promptId) ?? [];
    if (!versions.includes(s.promptVersion)) versions.push(s.promptVersion);
    versionsByPrompt.set(s.promptId, versions);
  }
  const mixedPromptList = [...versionsByPrompt.entries()]
    .filter(([, versions]) => versions.length > 1)
    .flatMap(([id, versions]) => versions.map((v) => `${id} ${v}`));
  if (mixedModel) {
    notes.push(
      fillLabel(labels.mixedModels, { models: inertText(models.join(", ")) }),
    );
  }
  if (cachedFromOther) notes.push(labels.mixedModelCache);
  if (mixedPromptList.length > 0) {
    notes.push(
      fillLabel(labels.mixedPrompts, {
        prompts: inertText(mixedPromptList.join(", ")),
      }),
    );
  }
  blocks.push(...notes);

  const showModel = mixedModel || cachedFromOther;
  const showPrompt = mixedPromptList.length > 0;
  const primary = primaryThemes(input.clustering);
  const head = [
    labels.colItem,
    labels.colSource,
    labels.colConfidence,
    labels.colGrounding,
    labels.colTokensIn,
    labels.colTokensOut,
    labels.colCost,
    labels.colTheme,
    ...(showModel ? [labels.colModel] : []),
    ...(showPrompt ? [labels.colPrompt] : []),
  ];
  const rows = input.analysed.map((paper) => {
    const s = paper.summary;
    return [
      inertText(paper.itemKey),
      labels[TIER_LABELS[s.content.sourceTier]],
      labels[CONFIDENCE_LABELS[s.content.confidence]],
      s.groundingScore === undefined ? "" : decimal(s.groundingScore),
      s.usage?.inputTokens === undefined ? "" : String(s.usage.inputTokens),
      s.usage?.outputTokens === undefined ? "" : String(s.usage.outputTokens),
      s.usage?.costUsd === undefined ? "" : usd(s.usage.costUsd),
      themeCell(paper.itemKey, input, primary, labels),
      ...(showModel ? [inertText(s.modelId)] : []),
      ...(showPrompt ? [inertText(`${s.promptId} ${s.promptVersion}`)] : []),
    ];
  });
  blocks.push(`### ${labels.perPaperHeading}`, table(head, rows));
  return blocks.join("\n\n");
}

/** Appendix C (owner, `plan/00` §6 item 286): what the review left unresolved. */
export function appendixC(critique: CritiqueOutcome, labels: Labels): string {
  const heading = `## ${labels.appendixCHeading}`;
  if (critique.rounds === 0) return `${heading}\n\n${labels.appendixCNotRun}`;
  const state = revisionSentence(critique, labels);
  const blocks = [heading, ...(state === undefined ? [] : [state])];
  if (critique.unresolved.length === 0) {
    blocks.push(labels.appendixCNone);
    return blocks.join("\n\n");
  }
  const ordered: CritiqueProblem[] = SEVERITY_ORDER.flatMap((severity) =>
    critique.unresolved.filter((problem) => problem.severity === severity),
  );
  blocks.push(
    table(
      [
        labels.colSeverity,
        labels.colType,
        labels.colSection,
        labels.colQuote,
        labels.colExplanation,
        labels.colSuggestedFix,
      ],
      ordered.map((problem) => [
        labels[SEVERITY_LABELS[problem.severity]],
        labels[PROBLEM_LABELS[problem.type]],
        inertText(problem.section ?? ""),
        inertText(problem.quote),
        inertText(problem.explanation),
        inertText(problem.suggestedFix ?? ""),
      ]),
    ),
  );
  return blocks.join("\n\n");
}

/** The §4 lines naming each theme the analyse stage left unanalysed. */
function unanalysedLines(input: ScaffoldInput, labels: Labels): string {
  return input.themes
    .flatMap((result) => {
      if (result.status !== "unanalysed") return [];
      const theme = input.clustering.themes.find(
        (t) => t.themeId === result.themeId,
      );
      const reason =
        result.reason === UNANALYSED_REASONS.tooLarge
          ? labels.reasonTooLarge
          : result.reason === UNANALYSED_REASONS.noRepresentativePapers
            ? labels.reasonNoRepresentative
            : result.reason === UNANALYSED_REASONS.mergeInputOverBudget
              ? labels.reasonMergeOverBudget
              : fillLabel(labels.reasonAnalysisFailed, {
                  code: inertText(result.reason),
                });
      return [
        fillLabel(labels.themeNotAnalysed, {
          theme: themeName(result.themeId, input, labels),
          papers: theme?.itemKeys.length ?? 0,
          reason,
        }),
      ];
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// 5. The stage
// ---------------------------------------------------------------------------

/** Throw unless the scope the plan counted matches the papers given. */
function assertScope(input: ScaffoldInput): ReportScope {
  const scope = input.plan.scope;
  const years = input.analysed.flatMap((paper) =>
    paper.year === undefined ? [] : [paper.year],
  );
  const fullText = input.analysed.filter((paper) =>
    FULL_TEXT_TIERS.has(paper.summary.content.sourceTier),
  ).length;
  const expected: ReportScope = {
    totalCount: input.totalCount,
    analysedCount: input.analysed.length,
    excludedCount: input.excluded.length,
    fullTextCount: fullText,
    abstractCount: input.analysed.length - fullText,
    yearMin: years.length === 0 ? undefined : Math.min(...years),
    yearMax: years.length === 0 ? undefined : Math.max(...years),
  };
  for (const field of Object.keys(expected) as (keyof ReportScope)[]) {
    if (scope[field] !== expected[field]) {
      throw new RangeError(
        `[research-helper] the plan's scope disagrees with the papers given: ${field}`,
      );
    }
  }
  if (
    new Set(input.analysed.map((p) => p.itemKey)).size !== input.analysed.length
  ) {
    throw new RangeError("[research-helper] an analysed item key repeats");
  }
  return scope;
}

/**
 * Build the client-generated parts of the report around the shipped draft
 * (`plan/07` `P4-T12` steps 2–7).
 *
 * @param input - see {@link ScaffoldInput}
 * @returns what the scaffold computes of the stored `TrendReport`, and the
 *   Notable Papers check
 * @throws RangeError when the input is inconsistent (sections not 1…11, a
 *   scope that disagrees with the papers, bibliography indices not 1…n);
 *   Error when the finished report's cited keys are not the bibliography's
 *   keys in index order, a marker does not resolve, or a retracted item is a
 *   numbered entry — a defect in the caller, so nothing is returned to save
 */
export function scaffoldReport(input: ScaffoldInput): ScaffoldedReport {
  const labels = reportLabels(input.language);
  const scope = assertScope(input);
  const sections = [...input.composed.sections].sort(
    (a, b) => a.number - b.number,
  );
  if (
    sections.length !== 11 ||
    sections.some((section, i) => section.number !== i + 1)
  ) {
    throw new RangeError("[research-helper] the draft needs sections 1 to 11");
  }
  const entries = [...input.bibliography].sort((a, b) => a.index - b.index);
  entries.forEach((entry, i) => {
    if (entry.index !== i + 1) {
      throw new RangeError(
        "[research-helper] the bibliography's indices are not 1…n",
      );
    }
  });
  const retracted =
    input.retractionPolicy === "exclude_entirely" ? [] : input.retracted;
  const retractedKeys = new Set(retracted.map((entry) => entry.itemKey));
  if (entries.some((entry) => retractedKeys.has(entry.itemKey))) {
    throw new Error("a retracted item is a numbered bibliography entry");
  }

  const validKeys = new Set(input.analysed.map((paper) => paper.itemKey));
  const notable = checkNotablePapers(
    (sections[9] as ReportSection).markdown,
    validKeys,
  );
  const proxies = qualityProxiesOf(input);
  const head = titleBlock(input, labels);
  const banner = qualityBanner(input.critique, labels);

  // The sections, with the client's parts placed in them.
  const yearTable = table(
    [
      labels.colYear,
      labels.colPapers,
      labels.colDominantDesigns,
      labels.colDominantThemes,
    ],
    yearRows(input.analysed, input.clustering).map((row) => [
      row.year === undefined ? labels.noYear : String(row.year),
      String(row.papers),
      row.designs
        .map((d) => `${designLabel(d.label, labels)} (${String(d.count)})`)
        .join(", "),
      row.themes
        .map(
          (t) => `${themeName(t.themeId, input, labels)} (${String(t.count)})`,
        )
        .join(", "),
    ]),
  );
  const designs = designFrequencies(input.analysed);
  const designTable = table(
    [labels.colStudyDesign, labels.colPapers, labels.colShare],
    designs.map((d) => [
      designLabel(d.label, labels),
      String(d.count),
      percent(
        input.analysed.length === 0 ? 0 : d.count / input.analysed.length,
      ),
    ]),
  );
  const depth = fillLabel(labels.depthLine, {
    fullText: scope.fullTextCount,
    abstract: scope.abstractCount,
  });
  const unanalysed = unanalysedLines(input, labels);
  const join = (...blocks: readonly string[]): string =>
    blocks.filter((block) => block.trim() !== "").join("\n\n");
  const bodies = sections.map((section): string => {
    switch (section.number) {
      case 2:
        return join(depth, section.markdown);
      case 3:
        return join(section.markdown, labels.yearTableCaption, yearTable);
      case 4:
        return join(section.markdown, unanalysed);
      case 5:
        return join(section.markdown, labels.designTableCaption, designTable);
      case 11:
        return bibliographyBody(entries, retracted, labels);
      default:
        return section.markdown;
    }
  });
  const finalSections = sections.map((section, i): ReportSection => ({
    number: section.number,
    heading: section.heading,
    markdown: bodies[i] ?? "",
    citedItemKeys: citedKeysOf(bodies[i] ?? ""),
  }));

  const markdown = `${join(
    head.markdown,
    banner,
    ...finalSections.map((section) =>
      join(`## ${section.heading}`, section.markdown),
    ),
    appendixA(input, labels),
    appendixB(input, proxies, notable, labels),
    appendixC(input.critique, labels),
  )}\n`;

  // The gate: every marker resolves, and the report cites exactly the
  // bibliography's keys in index order, so `[n]` and §11 agree.
  assertAllMarkersResolve(markdown, validKeys);
  const cited = citedKeysOf(markdown);
  const order = entries.map((entry) => entry.itemKey);
  if (
    cited.length !== order.length ||
    cited.some((key, i) => key !== order[i])
  ) {
    throw new Error(
      `the report cites ${String(cited.length)} items and its bibliography lists ${String(order.length)}, or in another order`,
    );
  }

  const warnings = input.composed.warnings.filter(
    (warning) => warning !== TARGET_WORDS_CAPPED_WARNING,
  );
  const add = (warning: string): void => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  if (input.plan.targetWordsCapped) add(TARGET_WORDS_CAPPED_WARNING);
  if (input.composed.preamble.trim() !== "") add(PREAMBLE_DROPPED_WARNING);
  if (!notable.ok) add(NOTABLE_PAPERS_INVALID_WARNING);

  return {
    title: head.title,
    markdown,
    sections: finalSections,
    scope,
    reductionPasses: input.reductionPasses,
    clustering: input.clustering,
    bibliography: entries,
    retracted,
    excluded: input.excluded,
    summaryIds: input.analysed.map((paper) => paper.summary.id),
    qualityProxies: proxies,
    critique: input.critique,
    citedItemKeys: cited,
    warnings,
    notablePapers: notable,
  };
}

/**
 * `scripts/eval-trend-report.ts` — scores a saved trend-report run against the
 * owner's expected themes (`P4-T23`; `docs/06` §12.3's notes of 2026-11-02,
 * which hold the route, the formats and the scoring).
 *
 * **Caller.** A person at a terminal, through {@link main}; nothing in `src/`
 * imports this file. `test/unit/scripts/evalTrendReport.test.ts` tests it.
 * Nothing is constructed here but plain values: {@link parseExpectedThemes},
 * {@link parseStoredReport}, {@link groupRuns}, {@link answersFromExport},
 * {@link scoreRun} and {@link buildSheet} each build the value they return.
 *
 * **What it reads.** The plugin's own `research-helper.sqlite`, read-only: the
 * `report` table's `json` column, which `createReportStore`
 * (`src/zotero/db.ts`) wrote. Zotero must be closed, because it holds the file
 * with `PRAGMA locking_mode=EXCLUSIVE` (`src/bootstrap/pluginDatabase.ts`).
 *
 * **What it never does.** It never writes, suggests or generates an expected
 * theme. It never decides whether a produced theme matches an expected one:
 * that is the owner's judgement, arriving as an answer, and no name is ever
 * compared with another. It calls no model and opens no network connection.
 * It reads no `usage`: a `both` run's two records each hold the shared stages
 * plus their own, so adding them would count the shared stages twice
 * (`plan/reports/P4-T21.md`).
 *
 * **What it prints.** Scores and identifiers: no theme name, definition,
 * collection name or report text reaches the terminal. Those are model text or
 * the owner's, and `sheet` writes them only to a file outside the repository.
 *
 * ## Running it
 *
 * ```sh
 * npx tsx scripts/eval-trend-report.ts sheet --set <expected-themes.json> --database <research-helper.sqlite> --out <file outside the repository> [--report <report id>]
 * npx tsx scripts/eval-trend-report.ts score --set <expected-themes.json> --database <research-helper.sqlite> --matches <export.json> --report <run id>
 * ```
 *
 * `sheet` writes what the review page shows the owner, for the set's latest
 * run or the run holding `--report`. `score` prints the scores. Exit codes: 0
 * done, 1 refused (with the reason, in identifiers only), 2 wrong arguments.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type {
  ClusteredTheme,
  ReportLanguage,
  ReportQualityProxies,
  TrendReport,
} from "../src/model/trend";
import { readDecisionExport } from "./build-imrad-fixtures";

// ---------------------------------------------------------------------------
// 0. Vocabulary
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");

/** The three collections, of about 10, 50 and 200 papers (`docs/06` §12.3). */
export const EVAL_SET_IDS = ["small", "medium", "large"] as const;
/** `test/fixtures/trend-eval/synthetic-example/`: a format example, never scored. */
export const SYNTHETIC_SET_ID = "synthetic-example";
/** Every name in the synthetic example starts with this; no real one may. */
export const SYNTHETIC_MARK = "SYNTHETIC";

export type EvalSetId = (typeof EVAL_SET_IDS)[number] | typeof SYNTHETIC_SET_ID;

export const EXPECTED_THEMES_FORMAT = "trend-eval-expected-themes/1";
export const SHEET_FORMAT = "trend-eval-sheet/1";

/** Between a run id and an expected id; {@link isRunDocId} says why it is safe. */
export const ANSWER_ID_SEPARATOR = "__";

const NAME_MAX = 120;
const NOTE_MAX = 400;
const COLLECTION_NAME_MAX = 200;

const ITEM_KEY_RE = /^[A-Z0-9]{8}$/;
const EXPECTED_ID_RE = /^E[0-9]+$/;
const THEME_ID_RE = /^T[0-9]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why the script will not go on. Thrown by the parsers and {@link scoreRun};
 * caught by {@link main}, which prints the message. Its messages carry
 * identifiers and counts only, because the terminal shows no theme text.
 */
export class EvalRefusal extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// 1. `expected-themes.json`
// ---------------------------------------------------------------------------

export interface ExpectedTheme {
  /** `^E[0-9]+$`. */
  readonly id: string;
  readonly name: string;
  /** The owner's own gloss. */
  readonly note?: string;
}

/** One `expected-themes.json`, built by {@link parseExpectedThemes}. */
export interface ExpectedThemes {
  readonly format: typeof EXPECTED_THEMES_FORMAT;
  readonly setId: EvalSetId;
  /** As Zotero shows it; how a run is found, with `itemKeys` as the check. */
  readonly collectionName: string;
  readonly writtenBy: "owner" | "nobody";
  readonly writtenOn: string;
  readonly itemKeys: readonly string[];
  readonly themes: readonly ExpectedTheme[];
}

const SET_MEMBERS: readonly string[] = [
  "format",
  "setId",
  "collectionName",
  "writtenBy",
  "writtenOn",
  "itemKeys",
  "themes",
];
const THEME_MEMBERS: readonly string[] = ["id", "name", "note"];

function onlyMembers(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new EvalRefusal(
        `${where}: "${key}" is not a member of this format, which holds metadata only`,
      );
    }
  }
}

function oneLine(value: unknown, max: number, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EvalRefusal(`${where} must be non-empty text`);
  }
  if (/[\r\n]/.test(value) || Array.from(value).length > max) {
    throw new EvalRefusal(
      `${where} must be one line of at most ${max} characters`,
    );
  }
  return value;
}

function isSetId(value: unknown): value is EvalSetId {
  return (
    value === SYNTHETIC_SET_ID ||
    (EVAL_SET_IDS as readonly unknown[]).includes(value)
  );
}

/**
 * Check one `expected-themes.json`. Strict on purpose: an unknown member is
 * refused so paper text cannot ride along, and the synthetic example cannot be
 * mistaken for the owner's in either direction.
 *
 * @param value - the file's parsed JSON
 * @returns the set
 * @throws EvalRefusal when the file is not exactly this format
 */
export function parseExpectedThemes(value: unknown): ExpectedThemes {
  if (!isRecord(value)) throw new EvalRefusal("the set file is not an object");
  onlyMembers(value, SET_MEMBERS, "the set file");
  if (value.format !== EXPECTED_THEMES_FORMAT) {
    throw new EvalRefusal(
      `the set file's format is not ${EXPECTED_THEMES_FORMAT}`,
    );
  }
  const { setId, writtenBy, writtenOn, itemKeys, themes } = value;
  if (!isSetId(setId)) {
    throw new EvalRefusal(`setId must be one of ${EVAL_SET_IDS.join(", ")}`);
  }
  const synthetic = setId === SYNTHETIC_SET_ID;
  const author = synthetic ? "nobody" : "owner";
  if (writtenBy !== author) {
    throw new EvalRefusal(
      synthetic
        ? 'the synthetic example\'s writtenBy must be "nobody"'
        : 'writtenBy must be "owner": an expected theme is the owner\'s to write',
    );
  }
  if (typeof writtenOn !== "string" || !DATE_RE.test(writtenOn)) {
    throw new EvalRefusal("writtenOn must be YYYY-MM-DD");
  }
  const collectionName = oneLine(
    value.collectionName,
    COLLECTION_NAME_MAX,
    "collectionName",
  );
  if (!Array.isArray(itemKeys) || itemKeys.length === 0) {
    throw new EvalRefusal("itemKeys must list the collection's item keys");
  }
  const keys = new Set<string>();
  for (const key of itemKeys as unknown[]) {
    if (typeof key !== "string" || !ITEM_KEY_RE.test(key)) {
      throw new EvalRefusal("itemKeys holds something that is not an item key");
    }
    if (keys.has(key)) throw new EvalRefusal(`itemKeys repeats ${key}`);
    keys.add(key);
  }
  if (!Array.isArray(themes) || themes.length === 0) {
    throw new EvalRefusal("themes must hold at least one expected theme");
  }
  const ids = new Set<string>();
  const parsed = (themes as unknown[]).map((theme, i): ExpectedTheme => {
    const where = `themes[${i}]`;
    if (!isRecord(theme)) throw new EvalRefusal(`${where} is not an object`);
    onlyMembers(theme, THEME_MEMBERS, where);
    const { id, note } = theme;
    if (typeof id !== "string" || !EXPECTED_ID_RE.test(id)) {
      throw new EvalRefusal(`${where}: id must match ${EXPECTED_ID_RE.source}`);
    }
    if (ids.has(id)) throw new EvalRefusal(`${where}: ${id} is repeated`);
    ids.add(id);
    const name = oneLine(theme.name, NAME_MAX, `${where}: name`);
    if (name.startsWith(SYNTHETIC_MARK) !== synthetic) {
      throw new EvalRefusal(
        synthetic
          ? `${where}: every name in the synthetic example starts with ${SYNTHETIC_MARK}`
          : `${where}: a real set's name may not start with ${SYNTHETIC_MARK}`,
      );
    }
    return {
      id,
      name,
      ...(note !== undefined && {
        note: oneLine(note, NOTE_MAX, `${where}: note`),
      }),
    };
  });
  return {
    format: EXPECTED_THEMES_FORMAT,
    setId,
    collectionName,
    writtenBy: author,
    writtenOn,
    itemKeys: [...keys],
    themes: parsed,
  };
}

// ---------------------------------------------------------------------------
// 2. The stored report
// ---------------------------------------------------------------------------

/**
 * What the script takes from a `report` row, built by
 * {@link parseStoredReport}. `usage` is left out on purpose, so nothing here
 * can add it, and so is everything of the report's text but §4's.
 */
export type StoredReport = Pick<
  TrendReport,
  | "id"
  | "collectionKey"
  | "collectionName"
  | "language"
  | "generatedAtEpochMs"
  | "clustering"
  | "sections"
  | "excluded"
  | "retracted"
  | "qualityProxies"
>;

function isProxies(value: unknown): value is ReportQualityProxies {
  if (!isRecord(value)) return false;
  const number = (key: string): boolean => typeof value[key] === "number";
  const numberOrAbsent = (key: string): boolean =>
    value[key] === undefined || number(key);
  return (
    numberOrAbsent("citationDensity") &&
    number("coverageRatio") &&
    number("brokenCitationCount") &&
    numberOrAbsent("meanGroundingScore") &&
    number("contradictionCount") &&
    number("unresolvedHighSeverityCount")
  );
}

function isClustering(value: unknown): value is TrendReport["clustering"] {
  if (!isRecord(value)) return false;
  const { themes, assignments, unclustered } = value;
  return (
    Array.isArray(themes) &&
    themes.every(
      (theme) =>
        isRecord(theme) &&
        typeof theme.themeId === "string" &&
        typeof theme.name === "string" &&
        typeof theme.definition === "string",
    ) &&
    Array.isArray(assignments) &&
    assignments.every(
      (row) =>
        isRecord(row) &&
        typeof row.itemKey === "string" &&
        typeof row.primaryThemeId === "string",
    ) &&
    (unclustered === undefined || Array.isArray(unclustered))
  );
}

/**
 * Check one `report` row's `json` column, as `storedReportFrom`
 * (`src/zotero/db.ts`) does for the product, and keep what the script reads.
 *
 * @param json - the column's value
 * @returns the fields of {@link StoredReport}, and no others
 * @throws EvalRefusal when the row is not a stored report
 */
export function parseStoredReport(json: unknown): StoredReport {
  let value: unknown;
  try {
    value = JSON.parse(String(json));
  } catch {
    value = undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.collectionKey !== "string" ||
    typeof value.collectionName !== "string" ||
    (value.language !== "en" && value.language !== "ko") ||
    typeof value.generatedAtEpochMs !== "number" ||
    !isClustering(value.clustering) ||
    !Array.isArray(value.sections) ||
    !Array.isArray(value.excluded) ||
    !Array.isArray(value.retracted) ||
    !isProxies(value.qualityProxies)
  ) {
    throw new EvalRefusal("a report row is not a stored report");
  }
  return {
    id: value.id,
    collectionKey: value.collectionKey,
    collectionName: value.collectionName,
    language: value.language,
    generatedAtEpochMs: value.generatedAtEpochMs,
    clustering: value.clustering,
    sections: value.sections as TrendReport["sections"],
    excluded: value.excluded as TrendReport["excluded"],
    retracted: value.retracted as TrendReport["retracted"],
    qualityProxies: value.qualityProxies,
  };
}

/**
 * Every report in the plugin's database, read-only.
 *
 * @param databasePath - `research-helper.sqlite`; never printed
 * @returns the reports, in no particular order
 * @throws EvalRefusal when Zotero holds the file or the table cannot be read
 */
export function readStoredReports(databasePath: string): StoredReport[] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const rows = db.prepare("SELECT json FROM report").all() as {
      readonly json: unknown;
    }[];
    return rows.map((row) => parseStoredReport(row.json));
  } catch (error) {
    if (error instanceof EvalRefusal) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/locked|busy/i.test(message)) {
      throw new EvalRefusal(
        "the database is locked: close Zotero first, which holds the file exclusively",
      );
    }
    throw new EvalRefusal(`the report table cannot be read: ${message}`);
  } finally {
    db?.close();
  }
}

// ---------------------------------------------------------------------------
// 3. A run
// ---------------------------------------------------------------------------

/**
 * One run's reports, built by {@link groupRuns}: one report, or two on a
 * `both` run, which `execute` (`trendReportPipeline.ts`) dates alike and gives
 * one clustering. English first, the order `execute` works in.
 */
export interface EvalRun {
  /** The first report's id: what an answer's document id names. */
  readonly runId: string;
  readonly collectionKey: string;
  readonly generatedAtEpochMs: number;
  readonly reports: readonly StoredReport[];
}

const LANGUAGE_ORDER: Readonly<Record<ReportLanguage, number>> = {
  en: 0,
  ko: 1,
};

/**
 * Pair the rows into runs. A record names no run, and the job record's
 * `resultRef` names only the first report, so the pair is what they share: the
 * collection and the one date `execute` gives both.
 *
 * @param reports - rows in any order
 * @returns the runs, newest first
 */
export function groupRuns(reports: readonly StoredReport[]): EvalRun[] {
  const byRun = new Map<string, StoredReport[]>();
  for (const report of reports) {
    const key = `${report.collectionKey}|${report.generatedAtEpochMs}`;
    byRun.set(key, [...(byRun.get(key) ?? []), report]);
  }
  return [...byRun.values()]
    .map((rows): EvalRun => {
      const sorted = [...rows].sort(
        (a, b) => LANGUAGE_ORDER[a.language] - LANGUAGE_ORDER[b.language],
      );
      const first = sorted[0] as StoredReport;
      return {
        runId: first.id,
        collectionKey: first.collectionKey,
        generatedAtEpochMs: first.generatedAtEpochMs,
        reports: sorted,
      };
    })
    .sort((a, b) => b.generatedAtEpochMs - a.generatedAtEpochMs);
}

/** The run's one theme list, checked to be one across a `both` run's rows. */
function themesOf(run: EvalRun): readonly ClusteredTheme[] {
  const first = run.reports[0] as StoredReport;
  const ids = first.clustering.themes.map((t) => t.themeId).join(",");
  for (const report of run.reports) {
    if (report.clustering.themes.map((t) => t.themeId).join(",") !== ids) {
      throw new EvalRefusal(
        `run ${run.runId}: its reports disagree on the theme ids, so they are not one run`,
      );
    }
  }
  return first.clustering.themes;
}

/** Every paper the run read: placed, left unclustered, excluded or retracted. */
function paperKeysOf(run: EvalRun): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const report of run.reports) {
    for (const row of report.clustering.assignments) keys.add(row.itemKey);
    for (const row of report.clustering.unclustered ?? [])
      keys.add(row.itemKey);
    for (const row of report.excluded) keys.add(row.itemKey);
    for (const row of report.retracted) keys.add(row.itemKey);
  }
  return keys;
}

/**
 * The run a command acts on.
 *
 * @param runs - from {@link groupRuns}, newest first
 * @param set - the set; its collection name finds the runs
 * @param reportId - any report of the run wanted; the latest when absent
 * @returns the run
 * @throws EvalRefusal when no run or more than one collection fits
 */
export function pickRun(
  runs: readonly EvalRun[],
  set: ExpectedThemes,
  reportId?: string,
): EvalRun {
  const named = runs.filter((run) =>
    run.reports.some((report) => report.collectionName === set.collectionName),
  );
  if (reportId !== undefined) {
    const run = named.find((r) => r.reports.some((x) => x.id === reportId));
    if (run === undefined) {
      throw new EvalRefusal(
        `no run of set ${set.setId}'s collection holds report ${reportId}`,
      );
    }
    return run;
  }
  const latest = named[0];
  if (latest === undefined) {
    throw new EvalRefusal(
      `no report of set ${set.setId}'s collection is stored`,
    );
  }
  if (named.some((run) => run.collectionKey !== latest.collectionKey)) {
    throw new EvalRefusal(
      `two collections share set ${set.setId}'s name: name a report with --report`,
    );
  }
  return latest;
}

// ---------------------------------------------------------------------------
// 4. The owner's answers
// ---------------------------------------------------------------------------

/** The owner's answers for one run: expected id → the produced ids they named. */
export type MatchAnswers = ReadonlyMap<string, readonly string[]>;

/**
 * Whether a document id belongs to `runId`. Safe because
 * {@link ANSWER_ID_SEPARATOR} cannot occur in a report id: `REPORT_ID_RE`
 * (`src/zotero/db.ts`) joins its runs with single `-` or `_`.
 */
function isRunDocId(docId: string, runId: string): boolean {
  return docId.startsWith(`${runId}${ANSWER_ID_SEPARATOR}`);
}

/**
 * The owner's answers for one run, out of the review page's export. Documents
 * of other runs are skipped, so one export can hold all three sets.
 *
 * @param exported - the export's parsed JSON, any shape `readDecisionExport` takes
 * @param runId - the run
 * @returns the answers; an empty list is the answer "no produced theme does"
 * @throws EvalRefusal when a document of this run holds no `themeIds` list
 */
export function answersFromExport(
  exported: unknown,
  runId: string,
): MatchAnswers {
  let docs: Map<string, unknown>;
  try {
    docs = readDecisionExport(exported);
  } catch (error) {
    throw new EvalRefusal(`the answers file: ${(error as Error).message}`);
  }
  const answers = new Map<string, readonly string[]>();
  for (const [docId, doc] of docs) {
    if (!isRunDocId(docId, runId)) continue;
    const expectedId = docId.slice(runId.length + ANSWER_ID_SEPARATOR.length);
    const themeIds = isRecord(doc) ? doc.themeIds : undefined;
    if (
      !Array.isArray(themeIds) ||
      !themeIds.every((id) => typeof id === "string" && THEME_ID_RE.test(id))
    ) {
      throw new EvalRefusal(`answer ${expectedId} holds no list of theme ids`);
    }
    answers.set(expectedId, themeIds as string[]);
  }
  return answers;
}

// ---------------------------------------------------------------------------
// 5. The score
// ---------------------------------------------------------------------------

/** One report's automated proxies, read from its record. */
export interface ReportProxyScore {
  readonly reportId: string;
  readonly language: ReportLanguage;
  readonly proxies: ReportQualityProxies;
}

/** Built by {@link scoreRun}; read by {@link formatScore}. */
export interface RunScore {
  readonly setId: EvalSetId;
  readonly runId: string;
  readonly papersRead: number;
  readonly papersListed: number;
  /** Expected themes with at least one matched produced theme. */
  readonly matchedExpected: number;
  readonly expected: number;
  /** {@link matchedExpected} / {@link expected}. */
  readonly themeRecall: number;
  readonly producedThemes: number;
  /** Produced themes the owner named at least once. */
  readonly producedMatched: number;
  /** One per report; two on a `both` run. */
  readonly reports: readonly ReportProxyScore[];
}

/**
 * Score one run (`docs/06` §12.3's note of 2026-11-02, items 5 and 6). Theme
 * recall comes from the owner's answers alone: no name is compared.
 *
 * @param set - the owner's expected themes
 * @param run - the run
 * @param answers - the owner's answers for this run
 * @returns the score
 * @throws EvalRefusal, in identifiers only, on anything item 6 refuses
 */
export function scoreRun(
  set: ExpectedThemes,
  run: EvalRun,
  answers: MatchAnswers,
): RunScore {
  const themes = themesOf(run);
  const listed = new Set(set.itemKeys);
  const read = paperKeysOf(run);
  const unlisted = [...read].filter((key) => !listed.has(key));
  if (unlisted.length > 0) {
    throw new EvalRefusal(
      `run ${run.runId} read papers set ${set.setId} does not list: ${unlisted.join(", ")}`,
    );
  }
  const expectedIds = new Set(set.themes.map((theme) => theme.id));
  const stray = [...answers.keys()].filter((id) => !expectedIds.has(id));
  if (stray.length > 0) {
    throw new EvalRefusal(
      `the answers name expected themes set ${set.setId} does not have: ${stray.join(", ")}`,
    );
  }
  const unanswered = set.themes
    .map((theme) => theme.id)
    .filter((id) => !answers.has(id));
  if (unanswered.length > 0) {
    throw new EvalRefusal(
      `the owner has not answered: ${unanswered.join(", ")}. A missing answer is not counted as a miss`,
    );
  }
  const producedIds = new Set(themes.map((theme) => theme.themeId));
  const named = new Set<string>();
  let matchedExpected = 0;
  for (const theme of set.themes) {
    const themeIds = answers.get(theme.id) ?? [];
    for (const id of themeIds) {
      if (!producedIds.has(id)) {
        throw new EvalRefusal(
          `answer ${theme.id} names ${id}, which run ${run.runId} did not produce`,
        );
      }
      named.add(id);
    }
    if (themeIds.length > 0) matchedExpected += 1;
  }
  return {
    setId: set.setId,
    runId: run.runId,
    papersRead: read.size,
    papersListed: listed.size,
    matchedExpected,
    expected: set.themes.length,
    themeRecall: matchedExpected / set.themes.length,
    producedThemes: themes.length,
    producedMatched: named.size,
    reports: run.reports.map((report) => ({
      reportId: report.id,
      language: report.language,
      proxies: report.qualityProxies,
    })),
  };
}

const NOT_MEASURED = "not measured";

function figure(value: number | undefined): string {
  return value === undefined ? NOT_MEASURED : value.toFixed(3);
}

/**
 * The score as the terminal shows it: figures and identifiers, nothing else.
 *
 * @param score - from {@link scoreRun}
 * @returns the lines, joined
 */
export function formatScore(score: RunScore): string {
  return [
    `set ${score.setId} | run ${score.runId} | papers read ${score.papersRead} of ${score.papersListed} listed`,
    `theme recall ${score.matchedExpected}/${score.expected} = ${score.themeRecall.toFixed(3)} | produced themes ${score.producedThemes}, of which matched ${score.producedMatched}`,
    ...score.reports.map(
      ({ language, proxies }) =>
        `${language} | citation density ${figure(proxies.citationDensity)} | ` +
        `coverage ratio ${figure(proxies.coverageRatio)} | ` +
        `broken citations ${proxies.brokenCitationCount} | ` +
        `mean grounding score ${figure(proxies.meanGroundingScore)} | ` +
        `contradictions ${proxies.contradictionCount} | ` +
        `unresolved high-severity problems ${proxies.unresolvedHighSeverityCount}`,
    ),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 6. The sheet for the review page
// ---------------------------------------------------------------------------

/** What the review page shows; built by {@link buildSheet}. Never committed. */
export interface ReviewSheet {
  readonly format: typeof SHEET_FORMAT;
  readonly setId: EvalSetId;
  readonly runId: string;
  readonly generatedAtEpochMs: number;
  /** §4's level-3 headings per report: what the reader of each one sees. */
  readonly reports: readonly {
    readonly reportId: string;
    readonly language: ReportLanguage;
    readonly section4Headings: readonly string[];
  }[];
  readonly expected: readonly ExpectedTheme[];
  /** In the clustering's order; no suggestion and no similarity figure. */
  readonly produced: readonly {
    readonly themeId: string;
    readonly name: string;
    readonly definition: string;
    /** Papers whose primary theme this is. */
    readonly papers: number;
  }[];
}

function section4Headings(report: StoredReport): readonly string[] {
  const section = report.sections.find((s) => s.number === 4);
  return [
    ...(section?.markdown ?? "").matchAll(/^###[ \t]+(.+?)[ \t]*$/gm),
  ].map((match) => match[1] as string);
}

/**
 * The file the review page is built from.
 *
 * @param set - the owner's expected themes
 * @param run - the run to review
 * @returns the sheet
 */
export function buildSheet(set: ExpectedThemes, run: EvalRun): ReviewSheet {
  const first = run.reports[0] as StoredReport;
  const papers = new Map<string, number>();
  for (const row of first.clustering.assignments) {
    papers.set(row.primaryThemeId, (papers.get(row.primaryThemeId) ?? 0) + 1);
  }
  return {
    format: SHEET_FORMAT,
    setId: set.setId,
    runId: run.runId,
    generatedAtEpochMs: run.generatedAtEpochMs,
    reports: run.reports.map((report) => ({
      reportId: report.id,
      language: report.language,
      section4Headings: section4Headings(report),
    })),
    expected: set.themes,
    produced: themesOf(run).map((theme) => ({
      themeId: theme.themeId,
      name: theme.name,
      definition: theme.definition,
      papers: papers.get(theme.themeId) ?? 0,
    })),
  };
}

/**
 * Whether `path` is inside `root`. The sheet holds model text, so it may not
 * land in the repository.
 *
 * @param path - any path
 * @param root - the repository
 * @returns `true` inside; `false` outside, another drive included
 */
export function isInside(path: string, root: string = REPO_ROOT): boolean {
  const from = relative(resolve(root), resolve(path));
  return !isAbsolute(from) && from !== ".." && !from.startsWith(`..${sep}`);
}

// ---------------------------------------------------------------------------
// 7. The command line
// ---------------------------------------------------------------------------

const USAGE =
  "Usage: eval-trend-report.ts sheet --set <expected-themes.json> --database <research-helper.sqlite> --out <file outside the repository> [--report <report id>]\n" +
  "       eval-trend-report.ts score --set <expected-themes.json> --database <research-helper.sqlite> --matches <export.json> --report <run id>";

function argValue(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

/** No parser's message and no path reaches the terminal: a file can quote a theme. */
async function readJson(path: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new EvalRefusal(`${what} cannot be read`);
  }
  try {
    const bom = text.charCodeAt(0) === 0xfeff;
    return JSON.parse(bom ? text.slice(1) : text);
  } catch {
    throw new EvalRefusal(`${what} is not JSON`);
  }
}

/** A set a command may act on: the synthetic example is a format example only. */
async function readRealSet(path: string): Promise<ExpectedThemes> {
  const set = parseExpectedThemes(await readJson(path, "the set file"));
  if (set.setId === SYNTHETIC_SET_ID) {
    throw new EvalRefusal(
      "the synthetic example shows the format and is never scored",
    );
  }
  return set;
}

/**
 * The script's entry point.
 *
 * @param args - the arguments after the script's own path
 * @param print - where scores go; standard output outside a test
 * @param printError - where refusals go; standard error outside a test
 * @returns the exit code
 */
export async function main(
  args: readonly string[],
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  printError: (line: string) => void = (line) =>
    process.stderr.write(`${line}\n`),
): Promise<number> {
  const [command, ...rest] = args;
  const setPath = argValue(rest, "--set");
  const database = argValue(rest, "--database");
  const report = argValue(rest, "--report");
  const out = argValue(rest, "--out");
  const matches = argValue(rest, "--matches");
  try {
    if (
      command === "sheet" &&
      setPath !== undefined &&
      database !== undefined &&
      out !== undefined
    ) {
      if (isInside(out)) {
        throw new EvalRefusal(
          "the sheet holds model text, so --out must be outside the repository",
        );
      }
      const set = await readRealSet(setPath);
      const run = pickRun(groupRuns(readStoredReports(database)), set, report);
      const sheet = buildSheet(set, run);
      await writeFile(out, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");
      print(`sheet written | set ${set.setId} | run ${run.runId}`);
      return 0;
    }
    if (
      command === "score" &&
      setPath !== undefined &&
      database !== undefined &&
      matches !== undefined &&
      report !== undefined
    ) {
      const set = await readRealSet(setPath);
      const run = pickRun(groupRuns(readStoredReports(database)), set, report);
      if (run.runId !== report) {
        throw new EvalRefusal(
          `--report must be the run's id, ${run.runId}, which the answers' document ids name`,
        );
      }
      const answers = answersFromExport(
        await readJson(matches, "the answers file"),
        run.runId,
      );
      print(formatScore(scoreRun(set, run, answers)));
      return 0;
    }
  } catch (error) {
    if (error instanceof EvalRefusal) {
      printError(error.message);
      return 1;
    }
    throw error;
  }
  printError(USAGE);
  return 2;
}

/** `true` when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));

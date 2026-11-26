/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P4-T23` step 4's data source in real Zotero (`plan/00` §6 items 335(k), 336(e);
 * `docs/07` §5.2's note of 2026-11-02). The collection, the job queue, the plugin
 * database, the cost dialog, citeproc and the notes are real. **Only the provider
 * is fake**, as in `reportWindow-flow.spec.ts`: no request leaves Zotero, and no
 * key exists anywhere.
 *
 * Proved here: a `both` run stores one measurement, on the English row; the row's
 * second `put` (the note key) keeps it; it holds no marker, theme name, collection
 * name or item key; and no note, export or window shows its figures or names.
 *
 * **Proved outside this file, because a spec cannot be running once Zotero has
 * closed.** The `[P4-T23-expect]` lines below name each report and the mock's count
 * of answered calls. After `--exit-on-finish` has quit Zotero, `measure` is run on a
 * copy of `.scaffold/test/data/research-helper.sqlite` and its call count is compared
 * with those lines; the same command runs on a database from before the capture.
 *
 * **Read outside this file too.** The `[P4-T23-screen]` line is every string the run
 * put in its windows, with digits folded. "No new text" is that line compared with
 * the same spec's line from a build of the tree before the capture, which holds no
 * `runMeasurement`; that build fails this file's measurement tests, as it must.
 *
 * **What the resumed job here is not.** Nobody quits Zotero in the middle of it. The
 * checkpoint is the one a real run wrote before it was cancelled, and the runner is
 * the one `recover()`'s notice calls; the restart between them is not exercised,
 * because a restarted Zotero has no fake provider.
 *
 * Nothing about a real provider's field names is proved here (`plan/00` §6 item
 * 336(c)).
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import type { ResumedJobRunner } from "../../src/bootstrap/container";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMCallContext,
  LLMProvider,
} from "../../src/llm/types";
import {
  PAPER_SUMMARY_SCHEMA_VERSION,
  type PaperSummary,
} from "../../src/model/summary";
import type { ReportRunMeasurement, TrendReport } from "../../src/model/trend";
import type { Usage } from "../../src/model/usage";
import { expectedHeadings } from "../../src/pipeline/trendReport/compose";
import {
  isTrendReportCheckpoint,
  TREND_REPORT_INPUT_VERSION,
} from "../../src/pipeline/trendReport/trendReportPipeline";
import { COST_DIALOG_URL } from "../../src/ui/dialogs/costConfirmDialog";
import { chatResponse, mockModel } from "../helpers/mockLLM";
import { answerEuropePmcWithNothing } from "./support/liveRequestGuard";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "./support/uiLocale";

/** The slice of Mocha's test context this file uses. */
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function before(body: (this: MochaContext) => Promise<void>): void;
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 300_000;
const STEP_TIMEOUT_MS = 60_000;
const PAPERS = 30;
const TAG = `p4t23-${String(Date.now())}`;
/** In the mock's answers and one paper's title; never in a measurement. */
const MARKER = "ZQXMARKERQZX";
const QUOTE =
  "The synthetic intervention reduced the synthetic outcome by 42 percent.";
/** SYNTHETIC: longer than `summary.minAbstractChars`. */
const ABSTRACT = `${QUOTE} ${"Synthetic background sentence about the synthetic study. ".repeat(8)}`;
/** Makes a theme analysis's size four digits, which a report's text does not hold. */
const NARRATIVE_PAD = ` Synthetic narrative sentence ${MARKER}.`.repeat(150);
/** What the measurement's own members are called. */
const MEMBER_NAMES = [
  "runMeasurement",
  "themeAnalyses",
  "narrativeTokens",
  "reasoningTokens",
  "maxOutputTokens",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "costUsd",
  "promptId",
] as const;

function log(line: string): void {
  debug(`[P4-T23] ${line}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  what: () => string,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what()}`,
      );
    }
    await delay(25);
  }
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

function restorePref(name: string, before: unknown): void {
  if (before === undefined) {
    Zotero.Prefs.clear(name, true);
  } else {
    Zotero.Prefs.set(name, before as string | number | boolean, true);
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/* ------------------------------------------------------- the fake model */

function userOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "user")?.content ?? "";
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function summaryAnswer(): string {
  const summary: PaperSummary = {
    schemaVersion: PAPER_SUMMARY_SCHEMA_VERSION,
    itemKey: "SYNTHETI",
    sourceTier: "abstract",
    confidence: "medium",
    researchQuestion: `Does the synthetic intervention work? ${MARKER}`,
    studyDesign: { label: "other", detail: null },
    population: { kind: "not_applicable", description: null, size: null },
    methods: ["synthetic method"],
    keyFindings: [
      {
        statement: "The synthetic intervention reduced the synthetic outcome.",
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport: QUOTE,
      },
    ],
    effectSizes: [],
    limitations: ["Synthetic data."],
    novelty: null,
    keywords: ["synthetic"],
    researchTheme: null,
    citationWorthiness: { score: 10, reason: "Synthetic." },
  };
  return JSON.stringify(summary);
}

function clusteringAnswer(request: ChatRequest): string {
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/\[([A-Z0-9]{8})\]/g),
      (m) => m[1] as string,
    ),
  );
  const third = Math.ceil(keys.length / 3);
  const groups = [
    keys.slice(0, third),
    keys.slice(third, third * 2),
    keys.slice(third * 2),
  ];
  return JSON.stringify({
    themes: groups.map((itemKeys, i) => ({
      themeId: `T${String(i + 1)}`,
      name: `${MARKER} theme ${String(i + 1)}`,
      definition: `Synthetic definition ${String(i + 1)}.`,
      itemKeys,
    })),
    assignments: groups.flatMap((itemKeys, i) =>
      itemKeys.map((itemKey) => ({
        itemKey,
        primaryThemeId: `T${String(i + 1)}`,
        fit: "strong",
      })),
    ),
  });
}

function analysisAnswer(request: ChatRequest): string {
  const user = userOf(request);
  const keys = unique(
    Array.from(
      user.matchAll(/"itemKey":"([A-Z0-9]{8})"/g),
      (m) => m[1] as string,
    ),
  );
  return JSON.stringify({
    themeId: "echo",
    name: "echo",
    narrative: `Work in this theme ${keys
      .slice(0, 2)
      .map((k) => `[[${k}]]`)
      .join(" ")} reduced the outcome.${NARRATIVE_PAD}`,
    representativePapers: keys
      .slice(0, 2)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  });
}

/** The prompts' eleven headings, read once from the bundled registry. */
let headings: readonly string[] = [];
let koHeadings: readonly string[] = [];

function reportAnswer(request: ChatRequest): string {
  // The request's own template says which report it is (`P4-T21`).
  const korean = userOf(request).includes("보고서 파라미터");
  const wanted = korean ? koHeadings : headings;
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/\[\[([A-Z0-9]{8})\]\]/g),
      (m) => m[1] as string,
    ),
  );
  return wanted
    .map((heading, index) => {
      const n = index + 1;
      const body =
        n === 11
          ? keys.map((k, i) => `${String(i + 1)}. [[${k}]]`).join("\n")
          : `Finding ${String(n)} reported a 12% change ${MARKER} [[${keys[(n - 1) % keys.length] as string}]].`;
      return `## ${heading}\n\n${body}\n`;
    })
    .join("\n");
}

function answerTo(request: ChatRequest): string {
  const format = request.responseFormat;
  if (format?.kind !== "json_schema") return reportAnswer(request);
  switch (format.name) {
    case "ThemeClustering":
    case "ThemeMerge":
      return clusteringAnswer(request);
    case "ThemeAnalysis":
      return analysisAnswer(request);
    case "SelfCritique":
      return JSON.stringify({ verdict: "pass", problems: [] });
    default:
      return summaryAnswer();
  }
}

/** Every answered call's usage since the last {@link startLedger}. */
let ledger: Usage[] = [];
let serial = 0;

function startLedger(): void {
  ledger = [];
}

/**
 * One answer's usage: five-digit figures no report text holds, each its own, and a
 * cost whose sixth decimal is never 0, so a report's four-decimal cost cannot equal it.
 */
function answeredUsage(): Usage {
  serial += 1;
  const inputTokens = 73_100 + serial;
  const outputTokens = 41_300 + serial;
  const usage: Usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningTokens: 9_170 + serial,
    costUsd: Number((0.000271 + serial * 0.00001).toFixed(6)),
  };
  ledger.push(usage);
  return usage;
}

/** A call the mock holds, until a cancel reaches it. */
const hold: { armed: boolean; held: boolean } = { armed: false, held: false };

function heldUntilCancelled(ctx: LLMCallContext): Promise<void> {
  hold.held = true;
  return new Promise((_resolve, reject) => {
    ctx.token.onCancelled(() => {
      hold.held = false;
      hold.armed = false;
      reject(new Error("the fake model saw the cancel"));
    });
  });
}

/* ------------------------------------------------------ the windows */

interface ReportWindow extends Window {
  RHReportWindow?: {
    state: { initialized: boolean };
    ready?: Promise<void>;
    io: {
      session: {
        exportMarkdown(path: string): Promise<void>;
        copyText(): string | undefined;
      };
    };
  };
}

interface CostDialogWindow extends Window {
  RHCostDialog?: {
    state: { initialized: boolean; reported: boolean };
    updateAccept(): void;
  };
}

/**
 * Every string a window holds: text, the attributes a XUL widget paints, and the
 * Fluent id and arguments behind them. The id is there at once where its text is not:
 * on a run this fast a status can change before Fluent has translated the last one, so
 * its words are read only on some runs, and its id on all of them.
 */
function stringsIn(win: Window, into: Set<string>): void {
  const doc = win.document;
  const skipped = doc.getElementById("rh-report-preview");
  const walker = doc.createTreeWalker(doc.documentElement!, 1 | 4);
  let node: Node | null = walker.currentNode;
  while (node !== null) {
    if (skipped === null || !skipped.contains(node)) {
      if (node.nodeType === 3) {
        const parent = node.parentElement?.localName;
        const text = (node.nodeValue ?? "").trim();
        if (parent !== "style" && parent !== "script" && text !== "") {
          into.add(text);
        }
      } else {
        for (const name of [
          "value",
          "label",
          "title",
          "aria-label",
          "data-l10n-id",
          "data-l10n-args",
        ]) {
          const value = (node as Element).getAttribute(name)?.trim();
          if (value) into.add(value);
        }
      }
    }
    node = walker.nextNode();
  }
}

function costDialogs(): CostDialogWindow[] {
  const open: CostDialogWindow[] = [];
  const windows = Services.wm.getEnumerator(
    null as unknown as string,
  ) as unknown as Iterable<CostDialogWindow>;
  for (const candidate of windows) {
    if (!candidate.closed && candidate.location.href === COST_DIALOG_URL) {
      open.push(candidate);
    }
  }
  return open;
}

/** Accept the cost dialog the run raised, as a user would. */
async function acceptCostDialog(screen: Set<string>): Promise<void> {
  let dialogWindow: CostDialogWindow | undefined;
  await waitUntil(
    () => {
      dialogWindow = costDialogs().find(
        (candidate) =>
          candidate.RHCostDialog?.state.initialized === true &&
          !candidate.RHCostDialog.state.reported,
      );
      return dialogWindow !== undefined;
    },
    () => "the cost dialog to open",
  );
  const shown = dialogWindow as CostDialogWindow;
  await delay(200); // its Fluent lines settle
  stringsIn(shown, screen);
  const doc = shown.document;
  const acknowledge = doc.getElementById("rh-cost-acknowledge") as {
    hidden: boolean;
    checked: boolean;
  } | null;
  if (acknowledge !== null && !acknowledge.hidden) {
    acknowledge.checked = true;
    shown.RHCostDialog?.updateAccept();
  }
  (
    doc.getElementById("rh-cost-dialog") as unknown as {
      acceptDialog(): void;
    }
  ).acceptDialog();
  await waitUntil(
    () => shown.closed || shown.RHCostDialog?.state.reported === true,
    () => "the cost dialog to report its answer",
  );
}

async function openWindow(collectionID: number): Promise<ReportWindow> {
  const commands = pluginInstance()?.api.reportWindow;
  if (!commands) assert.fail("registerUI() published no api.reportWindow");
  const win = commands.open(
    Zotero.getMainWindow(),
    collectionID,
  ) as unknown as ReportWindow;
  await waitUntil(
    () =>
      win.document?.readyState === "complete" &&
      win.RHReportWindow?.state.initialized === true,
    () => "the report window to initialize",
  );
  await win.RHReportWindow?.ready;
  return win;
}

function textOf(win: Window, id: string): string {
  return (win.document.getElementById(id)?.textContent ?? "").trim();
}

function isDisabled(win: Window, id: string): boolean {
  return (
    (win.document.getElementById(id) as unknown as { disabled: boolean })
      .disabled === true
  );
}

function press(win: Window, id: string): void {
  (
    win.document.getElementById(id) as unknown as { doCommand(): void }
  ).doCommand();
}

function chooseBoth(win: Window): void {
  (
    win.document.getElementById("rh-report-language") as unknown as {
      value: string;
    }
  ).value = "both";
}

async function waitForOutcome(win: Window, text: string): Promise<void> {
  await waitUntil(
    () => textOf(win, "rh-report-outcome").includes(text),
    () =>
      `the outcome "${text}" (saw "${textOf(win, "rh-report-outcome")}", stop "${textOf(win, "rh-report-stop-reason")}", question "${textOf(win, "rh-report-question-text")}")`,
    TEST_TIMEOUT_MS / 2,
  );
}

/* ---------------------------------------------------------- the library */

async function makeCollection(
  name: string,
  papers: number,
): Promise<{ collection: Zotero.Collection; items: Zotero.Item[] }> {
  const collection = new Zotero.Collection({
    libraryID: Zotero.Libraries.userLibraryID,
    name,
  });
  await collection.saveTx();
  const items: Zotero.Item[] = [];
  for (let i = 1; i <= papers; i += 1) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField(
      "title",
      i === 1 ? `${name} paper ${MARKER}` : `${name} paper ${String(i)}`,
    );
    item.setField("abstractNote", ABSTRACT);
    item.setField("date", "2024");
    item.setField("DOI", `10.5555/${TAG}.${name.length}.${String(i)}`);
    item.setCollections([collection.id]);
    await item.saveTx();
    items.push(item);
  }
  return { collection, items };
}

function notesIn(collection: Zotero.Collection): Zotero.Item[] {
  return collection
    .getChildItems(false, false)
    .filter((item) => item.isNote() && !item.deleted);
}

/* ------------------------------------------------- the stored rows, raw */

interface RawRow {
  readonly id: string;
  readonly noteKey: string | null;
  readonly json: string;
  readonly record: Omit<TrendReport, "markdown">;
}

/** The collection's `report` rows, as the file holds them. */
async function rowsOf(
  instance: Addon,
  collectionKey: string,
): Promise<RawRow[]> {
  const opened = await instance.api.services!.database.ready;
  if (opened === undefined) assert.fail("no plugin database");
  const rows = (await opened.connection.queryAsync(
    "SELECT id, note_key, json FROM report WHERE collection_key = ?",
    [collectionKey],
  )) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row["id"]),
    noteKey: row["note_key"] === null ? null : String(row["note_key"]),
    json: String(row["json"]),
    record: JSON.parse(String(row["json"])) as Omit<TrendReport, "markdown">,
  }));
}

function sortedUsage(
  values: readonly {
    readonly inputTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
    readonly totalTokens?: number | undefined;
    readonly reasoningTokens?: number | undefined;
    readonly costUsd?: number | undefined;
  }[],
): unknown[] {
  return values
    .map((usage) => ({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens: usage.reasoningTokens,
      costUsd: usage.costUsd,
    }))
    .sort((a, b) => (a.inputTokens ?? 0) - (b.inputTokens ?? 0));
}

/**
 * Figures a report already states for its own reasons, before the capture and with
 * no reading of it: Appendix B's row for each summary gives that summary call's input
 * and output tokens (`scaffold.ts`). They are the same calls, so the same numbers.
 */
function summaryRowFigures(measurement: ReportRunMeasurement): string[] {
  return measurement.calls
    .filter((call) => call.promptId.startsWith("PAPER_SUMMARY"))
    .flatMap((call) => [String(call.inputTokens), String(call.outputTokens)]);
}

/**
 * Every other figure the measurement holds, leaving out `papers`: a report states
 * how many papers it read, whatever is measured.
 */
function measuredOnlyFigures(measurement: ReportRunMeasurement): string[] {
  const inRows = new Set(summaryRowFigures(measurement));
  const figures = new Set<string>();
  for (const call of measurement.calls) {
    for (const value of [
      call.inputTokens,
      call.outputTokens,
      call.totalTokens,
      call.reasoningTokens,
      call.maxOutputTokens,
      call.costUsd,
    ]) {
      if (value !== undefined && !inRows.has(String(value))) {
        figures.add(String(value));
      }
    }
  }
  for (const theme of measurement.themeAnalyses) {
    figures.add(String(theme.tokens));
    figures.add(String(theme.narrativeTokens));
  }
  return [...figures];
}

/** Which of `figures` stands alone in `text`, as a whole number. */
function figuresIn(text: string, figures: readonly string[]): string[] {
  return figures.filter((figure) =>
    new RegExp(`(?<![0-9.])${figure.replace(".", "\\.")}(?![0-9])`, "u").test(
      text,
    ),
  );
}

/**
 * `text` without the note's report marker (`<!-- rh:report … -->`, written by
 * `src/zotero/notes.ts`). The marker carries the report's random id, whose
 * all-digit groups can equal a measured figure by chance (batch M's recorded
 * run 1, 2026-11-26: `9195`); the marker is the plugin's own fixed-format
 * comment, so a figure found only there is not a leak (plan/00 §6 item 419(d)).
 */
function withoutReportMarker(text: string): string {
  return text.replace(/<!--\s*rh:report\b[^>]*-->/g, "");
}

/** What the measurement calls its members, found in `text`. */
function memberNamesIn(text: string): string[] {
  return MEMBER_NAMES.filter((name) => text.includes(name));
}

/** `text` without the table rows that name one of `keys`: Markdown's and the note's. */
function withoutItemRows(text: string, keys: readonly string[]): string {
  const names = (row: string): boolean => keys.some((k) => row.includes(k));
  return text
    .replace(/<tr\b[\s\S]*?<\/tr>/g, (row) => (names(row) ? "" : row))
    .split("\n")
    .filter((line) => !(line.trimStart().startsWith("|") && names(line)))
    .join("\n");
}

/**
 * A report's text with what differs between any two runs folded away, as fragments
 * in a fixed order, so that two builds' reports can be compared outside this file.
 */
function foldedFragments(
  text: string,
  collectionName: string,
  keys: readonly string[],
): string[] {
  let folded = text
    .split(collectionName)
    .join("<collection>")
    .replace(/(local%2F)[A-Za-z0-9]+/g, "$1<user>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
      "<report>",
    );
  for (const key of keys) folded = folded.split(key).join("<key>");
  return [
    ...new Set(
      folded
        .replace(/\d+/g, "#")
        .split(/\n|(?=<[a-z/])/)
        .map((one) => one.trim())
        .filter((one) => one !== ""),
    ),
  ].sort();
}

/* -------------------------------------------------------------- the spec */

describe("P4-T23 step 4: a run's measurement in real Zotero, on a mock provider", function () {
  let instance: Addon;
  let locale: UILocaleSnapshot | undefined;
  const restores: (() => void)[] = [];
  const made: (Zotero.Item | Zotero.Collection)[] = [];

  /** Every string the both run put in a window, digits as they were. */
  const screen = new Set<string>();
  /** The preview's text as it changed: the report itself, kept apart. */
  const previews = new Set<string>();
  let collection: Zotero.Collection;
  let answered: readonly Usage[] = [];
  let exported: { en: string; ko: string } = { en: "", ko: "" };

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      () => "the plugin to initialize",
    );
    instance = pluginInstance() as Addon;
    // Corrected 2026-11-05: the summary stage's full-text ladder asked the real
    // Europe PMC for these fixtures' DOIs until the live request guard caught it.
    restores.push(answerEuropePmcWithNothing());
    locale = await pinUILocale(["en-US"], log);
    const bundled = await import("../../src/prompts/bundled");
    headings = expectedHeadings(bundled.PROMPT_REGISTRY.get("TREND_REPORT_EN"));
    koHeadings = expectedHeadings(
      bundled.PROMPT_REGISTRY.get("TREND_REPORT_KO"),
    );
    const graph = instance.api.services;
    if (!graph) assert.fail("no api.services");
    await graph.database.ready;

    const registry = graph.llm.registry as Mutable<typeof graph.llm.registry>;
    const active = registry.activeProviderId();
    const realGet = registry.get;
    const real = realGet.call(registry, active);
    if (!real) assert.fail(`no adapter is registered for ${active}`);
    const fake: LLMProvider = {
      id: real.id,
      displayNameKey: real.displayNameKey,
      rateLimitKey: real.rateLimitKey,
      isConfigured: () => true,
      validateCredentials: () => Promise.reject(new Error("not in this spec")),
      listModels: () => Promise.resolve([]),
      getModel: (modelId) =>
        mockModel(modelId, {
          contextWindowTokens: 200_000,
          maxOutputTokens: 64_000,
          dataPolicy: {
            trainsOnInputByDefault: "no",
            retention: { days: "zero", note: "SYNTHETIC" },
          },
        }),
      chat: (request): Promise<ChatResponse> =>
        Promise.resolve(
          chatResponse(answerTo(request), { usage: answeredUsage() }),
        ),
      chatStream: async function* (
        request: ChatRequest,
        ctx: LLMCallContext,
      ): AsyncIterable<ChatStreamChunk> {
        const text = answerTo(request);
        const cut = Math.floor(text.length / 2);
        yield { deltaText: text.slice(0, cut), done: false };
        if (hold.armed) await heldUntilCancelled(ctx);
        yield { deltaText: text.slice(cut), done: false };
        yield { deltaText: "", done: true, usage: answeredUsage() };
      },
      countTokens: (text) => Math.ceil(text.length / 4),
    };
    registry.get = (id) => (id === active ? fake : realGet.call(registry, id));
    restores.push(() => {
      registry.get = realGet;
    });

    const secrets = graph.secrets as
      Mutable<NonNullable<typeof graph.secrets>> | undefined;
    const realHas = secrets?.has;
    if (secrets !== undefined && realHas !== undefined) {
      secrets.has = (id) =>
        id === `llm.${active}`
          ? Promise.resolve(true)
          : realHas.call(secrets, id);
      restores.push(() => {
        secrets.has = realHas;
      });
    }
    for (const [name, value] of [
      [`${active}.keyPresent`, true],
      ["reportModel", "p4t23-report-model"],
      ["summaryModel", "p4t23-summary-model"],
    ] as const) {
      const pref = `${config.prefsPrefix}.${name}`;
      const saved = Zotero.Prefs.get(pref, true) as unknown;
      Zotero.Prefs.set(pref, value, true);
      restores.push(() => {
        restorePref(pref, saved);
      });
    }
    const acknowledged = `${config.prefsPrefix}.privacy.egressAcknowledged`;
    const savedAcknowledged = Zotero.Prefs.get(acknowledged, true) as unknown;
    restores.push(() => {
      restorePref(acknowledged, savedAcknowledged);
    });

    // The both run every test below reads.
    const built = await makeCollection(`${TAG} both`, PAPERS);
    made.push(...built.items, built.collection);
    collection = built.collection;
    const win = await openWindow(collection.id);
    const observer = new (win as unknown as typeof globalThis).MutationObserver(
      () => {
        stringsIn(win, screen);
        previews.add(textOf(win, "rh-report-preview"));
      },
    );
    observer.observe(win.document.documentElement!, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    try {
      await waitUntil(
        () => !isDisabled(win, "rh-report-generate"),
        () => "Generate to be enabled",
      );
      chooseBoth(win);
      startLedger();
      press(win, "rh-report-generate");
      await acceptCostDialog(screen);
      await waitForOutcome(win, "Report ready");
      await waitUntil(
        () => notesIn(collection).length === 2,
        () => "the two report notes",
      );
      answered = [...ledger];
      stringsIn(win, screen);
      previews.add(textOf(win, "rh-report-preview"));

      const session = win.RHReportWindow?.io.session;
      const shown = win.document.getElementById(
        "rh-report-shown",
      ) as unknown as { value: string; doCommand(): void };
      const exportTo = async (language: "en" | "ko"): Promise<string> => {
        const path = PathUtils.join(
          Zotero.getTempDirectory().path,
          `${TAG}-${language}.md`,
        );
        await session?.exportMarkdown(path);
        const written = await IOUtils.readUTF8(path);
        await IOUtils.remove(path);
        return `${written}\n${session?.copyText() ?? ""}`;
      };
      const en = await exportTo("en");
      shown.value = "ko";
      shown.doCommand();
      await waitUntil(
        () =>
          textOf(win, "rh-report-preview").includes(koHeadings[6] as string),
        () => "the Korean report in the preview",
      );
      exported = { en, ko: await exportTo("ko") };
      stringsIn(win, screen);
      previews.add(textOf(win, "rh-report-preview"));
    } finally {
      observer.disconnect();
      win.close();
    }

    // Before any assertion: what `measure` and a build from before the capture
    // are compared with, outside this file.
    const itemKeys = built.items.map((item) => item.key);
    for (const [what, text] of [
      [
        "notes",
        notesIn(collection)
          .map((n) => n.getNote())
          .join("\n"),
      ],
      ["export-en", exported.en],
      ["export-ko", exported.ko],
    ] as const) {
      debug(
        `[P4-T23-report] ${what} ${JSON.stringify(foldedFragments(text, collection.name, itemKeys))}`,
      );
    }
    const foldedName = collection.name.replace(/\d+/g, "#");
    log(`answered calls ${String(answered.length)}`);
    debug(
      `[P4-T23-screen] ${JSON.stringify(
        [...new Set([...screen].map((s) => s.replace(/\d+/g, "#")))]
          .map((s) => s.replace(foldedName, "<collection>"))
          .sort(),
      )}`,
    );
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    for (const dialog of costDialogs()) dialog.close();
    for (const restore of restores.reverse()) restore();
    for (const one of made) {
      if (one instanceof Zotero.Collection) {
        for (const note of notesIn(one)) await note.eraseTx();
      }
    }
    for (const one of made) await one.eraseTx();
    if (locale !== undefined) await restoreUILocale(locale, log);
  });

  const measuredRow = async (): Promise<{
    english: RawRow;
    korean: RawRow;
    measurement: ReportRunMeasurement;
  }> => {
    const rows = await rowsOf(instance, collection.key);
    assert.strictEqual(rows.length, 2, "a both run leaves two rows");
    const english = rows.find((row) => row.record.language === "en");
    const korean = rows.find((row) => row.record.language === "ko");
    if (english === undefined || korean === undefined) {
      assert.fail("one row in each language");
    }
    const measurement = english.record.runMeasurement;
    if (measurement === undefined) {
      assert.fail("the English row holds no runMeasurement");
    }
    return { english, korean, measurement };
  };

  it("a both run stores the measurement on the English row only, and it is what the mock answered", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { english, korean, measurement } = await measuredRow();
    assert.isFalse(
      korean.json.includes("runMeasurement"),
      "the Korean row holds none",
    );
    const byPrompt = new Map<string, number>();
    for (const call of measurement.calls) {
      const key = `${call.promptId}/${call.language ?? "shared"}`;
      byPrompt.set(key, (byPrompt.get(key) ?? 0) + 1);
    }
    log(
      `English row ${english.id}: ${String(measurement.calls.length)} calls, ` +
        `${String(measurement.themeAnalyses.length)} theme analyses, ` +
        `by prompt ${JSON.stringify([...byPrompt].sort())}, ` +
        `sizes ${JSON.stringify(measurement.themeAnalyses)}`,
    );
    debug(
      `[P4-T23-expect] ${JSON.stringify({
        kind: "both",
        reportId: english.id,
        answered: answered.length,
        collectionName: collection.name,
        marker: MARKER,
      })}`,
    );
    assert.strictEqual(
      measurement.calls.length,
      answered.length,
      "one entry for each answered call",
    );
    assert.deepEqual(
      sortedUsage(measurement.calls),
      sortedUsage(answered),
      "each entry holds its call's own figures, as answered",
    );
    assert.isFalse(
      byPrompt.has("UNLABELLED/shared"),
      "every call carries its prompt's label",
    );
    // Compose and critique name their language; every other stage is shared.
    for (const call of measurement.calls) {
      const own =
        call.promptId.startsWith("TREND_REPORT") ||
        call.promptId.includes("CRITIQUE");
      assert.strictEqual(
        call.language !== undefined,
        own,
        `${call.promptId} says whether a language owns it`,
      );
    }
    assert.isTrue(
      [...byPrompt.keys()].includes("TREND_REPORT_EN/en") &&
        [...byPrompt.keys()].includes("TREND_REPORT_KO/ko"),
      "both reports' composes are there, each named",
    );
    assert.strictEqual(measurement.themeAnalyses.length, 3, "three themes");
    assert.strictEqual(
      measurement.themeAnalyses.reduce((sum, t) => sum + t.papers, 0),
      PAPERS,
      "the themes' members are the collection's papers",
    );
    assert.strictEqual(measurement.resumed, undefined, "not resumed");
  });

  it("the row's second put, the note key, keeps the measurement", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { english, measurement } = await measuredRow();
    // The first put's draft has no note key: a column and a json member that
    // hold one are the second put's write, and `runMeasurement` is in that json.
    assert.isTrue(english.noteKey !== null, "the row's note key is set");
    assert.strictEqual(
      english.record.zoteroNoteKey,
      english.noteKey as string,
      "the json is the second put's",
    );
    assert.isTrue(
      notesIn(collection).some((note) => note.key === english.noteKey),
      "the key names a note in the collection",
    );
    assert.deepEqual(
      sortedUsage(measurement.calls),
      sortedUsage(answered),
      "still every answered call's own figures",
    );
    const reports = (await instance.api.services!.database.reports())!;
    const read = await reports.get(english.id);
    assert.deepEqual(
      read?.runMeasurement,
      measurement,
      "the store reads back what the file holds",
    );
  });

  it("holds no marker, theme name, collection name or item key, and nothing but its own members", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { english, measurement } = await measuredRow();
    const stored = JSON.stringify(measurement);
    // The search can find them: the rest of the same row holds them.
    const { runMeasurement: _kept, ...rest } = english.record;
    const others = JSON.stringify(rest);
    const themeNames = english.record.clustering.themes.map((t) => t.name);
    assert.isTrue(themeNames.length > 0, "the row names its themes");
    for (const name of [MARKER, collection.name, ...themeNames]) {
      assert.include(others, name, "the row itself holds it");
      assert.isFalse(stored.includes(name), `the measurement holds "${name}"`);
    }
    for (const item of collection.getChildItems(false, false)) {
      assert.isFalse(stored.includes(item.key), "no item key");
    }
    // Numbers only, and a prompt's id and a language among the strings.
    const allowed = new Set([
      "promptId",
      "language",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "reasoningTokens",
      "costUsd",
      "maxOutputTokens",
      "papers",
    ]);
    for (const call of measurement.calls) {
      for (const [name, value] of Object.entries(call)) {
        assert.isTrue(allowed.has(name), `a call's member ${name}`);
        if (name === "promptId") {
          assert.isTrue(/^[A-Z0-9_]+$/.test(value as string), "a prompt's id");
        } else if (name === "language") {
          assert.isTrue(value === "en" || value === "ko", "a language");
        } else {
          assert.strictEqual(typeof value, "number", `${name} is a number`);
        }
      }
    }
    for (const theme of measurement.themeAnalyses) {
      assert.deepEqual(Object.keys(theme).sort(), [
        "narrativeTokens",
        "papers",
        "tokens",
      ]);
    }
  });

  it("no note and no export shows its figures or names, beyond what Appendix B already said of each summary", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { measurement } = await measuredRow();
    const measuredOnly = measuredOnlyFigures(measurement);
    const inRows = summaryRowFigures(measurement);
    const keys = collection.getChildItems(false, false).map((item) => item.key);
    assert.isTrue(measuredOnly.length > 0, "figures to seek");
    const notes = notesIn(collection).map((note) => note.getNote());
    assert.strictEqual(notes.length, 2, "both notes");
    assert.include(notes.join("\n"), headings[6] as string, "the English note");
    assert.include(
      notes.join("\n"),
      koHeadings[6] as string,
      "the Korean note",
    );
    assert.include(exported.en, headings[6] as string, "the English export");
    assert.include(exported.ko, koHeadings[6] as string, "the Korean export");
    for (const [what, original] of [
      ["the first note", notes[0] as string],
      ["the second note", notes[1] as string],
      ["the English export and copy", exported.en],
      ["the Korean export and copy", exported.ko],
    ] as const) {
      const text = withoutReportMarker(original);
      const found = {
        measuredOnly: figuresIn(text, measuredOnly),
        summaryFiguresOutsideTheirRows: figuresIn(
          withoutItemRows(text, keys),
          inRows,
        ),
        memberNames: memberNamesIn(text),
      };
      const rows = figuresIn(text, inRows).length;
      log(
        `${what}: ${String(text.length)} chars, ${JSON.stringify(found)}, ` +
          `${String(rows)} of ${String(inRows.length)} summary figures in their rows`,
      );
      // The search can find a figure: Appendix B's rows hold these.
      assert.isTrue(rows > 0, `${what}: the rows are where they were`);
      assert.deepEqual(
        found,
        {
          measuredOnly: [],
          summaryFiguresOutsideTheirRows: [],
          memberNames: [],
        },
        what,
      );
    }
  });

  it("no window shows its figures or names", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { measurement } = await measuredRow();
    const all = [
      ...measuredOnlyFigures(measurement),
      ...summaryRowFigures(measurement),
    ];
    const keys = collection.getChildItems(false, false).map((item) => item.key);
    assert.isTrue(screen.size > 0, "the windows' strings were read");
    const text = [...screen].join("\n");
    assert.include(text, "Report ready", "the run's own outcome is among them");
    assert.deepEqual(
      {
        figures: figuresIn(text, all),
        names: [
          ...memberNamesIn(text),
          ...unique(measurement.calls.map((call) => call.promptId)).filter(
            (id) => text.includes(id),
          ),
        ],
      },
      { figures: [], names: [] },
      "the window's own strings hold none of the measurement",
    );
    // The preview is the report, so it is held to what the note is held to.
    const previewed = [...previews].join("\n");
    assert.deepEqual(
      {
        measuredOnly: figuresIn(previewed, measuredOnlyFigures(measurement)),
        outsideRows: figuresIn(
          withoutItemRows(previewed, keys),
          summaryRowFigures(measurement),
        ),
        names: memberNamesIn(previewed),
      },
      { measuredOnly: [], outsideRows: [], names: [] },
      "the preview holds none of the measurement beyond the report's own rows",
    );
  });

  it("a job resumed from a real run's checkpoint is flagged, and holds only the calls after it", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const graph = instance.api.services!;
    const built = await makeCollection(`${TAG} resumed`, 6);
    made.push(...built.items, built.collection);
    const resumedCollection = built.collection;

    // A real both run, as far as its first compose. Cancelling it ends the first
    // process's part, and every paid-for stage stays in the cache.
    const win = await openWindow(resumedCollection.id);
    let input: unknown;
    let checkpoint: unknown;
    let choiceStage: string | undefined;
    try {
      await waitUntil(
        () => !isDisabled(win, "rh-report-generate"),
        () => "Generate to be enabled",
      );
      chooseBoth(win);
      hold.armed = true;
      press(win, "rh-report-generate");
      await acceptCostDialog(new Set());
      await waitUntil(
        () => hold.held,
        () => "the first compose to reach the hold",
      );
      const running = (await graph.jobs.list({ status: ["running"] })).find(
        (one) =>
          (one.input as { collectionKey?: string }).collectionKey ===
          resumedCollection.key,
      );
      if (running === undefined) assert.fail("the held run has no record");
      input = running.input;
      checkpoint = running.checkpoint;
      choiceStage = (checkpoint as { stage?: string } | undefined)?.stage;
      press(win, "rh-report-cancel");
      await waitForOutcome(win, "Cancelled");
    } finally {
      hold.armed = false;
      win.close();
    }
    log(`the real checkpoint's stage ${String(choiceStage)}`);
    // `docs/07` §7.6's throttle of one write per 2 s can hold the latest stage back
    // on a run this fast, so which stage it names is not asserted.
    assert.isTrue(
      isTrendReportCheckpoint(checkpoint),
      "written by the real run, and readable as a checkpoint",
    );

    // What `recover()`'s notice does with a re-queued job.
    startLedger();
    const record = await graph.jobs.enqueue("trendReport", input as never, {
      priority: "normal",
      inputVersion: TREND_REPORT_INPUT_VERSION,
    });
    await graph.jobs.writeCheckpoint(record.id, checkpoint as never);
    const runner = graph.resumedReports as ResumedJobRunner;
    runner.run(record.id);
    let status: string | undefined;
    await waitUntil(
      async () => {
        status = (await graph.jobs.get(record.id))?.status;
        return status === "succeeded";
      },
      () =>
        `the resumed job to succeed (status ${String(status)}, question ${String(runner.surfaceOf(record.id)?.pending?.reason)})`,
      TEST_TIMEOUT_MS / 2,
    );
    await waitUntil(
      () => notesIn(resumedCollection).length === 2,
      () => "the resumed run's two notes",
    );

    const rows = await rowsOf(instance, resumedCollection.key);
    const english = rows.find((row) => row.record.language === "en");
    const measurement = english?.record.runMeasurement;
    if (measurement === undefined) {
      assert.fail("the resumed run's English row holds no runMeasurement");
    }
    const promptIds = unique(measurement.calls.map((call) => call.promptId));
    log(
      `resumed row ${english!.id}: ${String(measurement.calls.length)} calls, ` +
        `prompts ${JSON.stringify(promptIds)}, ` +
        `${String(measurement.themeAnalyses.length)} theme analyses`,
    );
    debug(
      `[P4-T23-expect] ${JSON.stringify({
        kind: "resumed",
        reportId: english!.id,
        answered: ledger.length,
        collectionName: resumedCollection.name,
        marker: MARKER,
      })}`,
    );
    assert.strictEqual(measurement.resumed, true, "flagged as resumed");
    assert.strictEqual(
      measurement.calls.length,
      ledger.length,
      "only the calls after the restart",
    );
    assert.deepEqual(sortedUsage(measurement.calls), sortedUsage(ledger));
    assert.isTrue(
      promptIds.every(
        (id) => id.startsWith("TREND_REPORT") || id.includes("CRITIQUE"),
      ),
      "the summaries, themes and analyses came from the cache: no call",
    );
    assert.strictEqual(
      measurement.themeAnalyses.length,
      3,
      "a cached analysis is still measured",
    );
    assert.isFalse(
      rows
        .find((row) => row.record.language === "ko")
        ?.json.includes("runMeasurement") ?? true,
      "the Korean row holds none",
    );
  });
});

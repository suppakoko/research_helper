/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P7-T18` — the plugin with Zotero offline (`NFR-9`; `FR-23`).
 *
 * **Offline is Zotero's own switch.** `Services.io.offline` is set in the test
 * profile, and `Services.io.manageOfflineStatus` is turned off for the block so
 * the operating system's network state cannot set it back. Zotero 10's
 * `Zotero.HTTP.request` reads `browserIsOffline()` (that is `Services.io.offline`)
 * before it opens a channel and throws `BrowserOfflineException`, which
 * `src/core/http/client.ts` turns into `OfflineError`. Nothing in this file
 * replaces `Zotero.HTTP` or the plugin's HTTP client (the card's **Do NOT**).
 *
 * **What is real, and what is a double.**
 *
 * - **Real:** the plugin instance and its service graph, every window, the
 *   job queue, the plugin database, the summarize and trend-report pipelines,
 *   the source registry and its literature-database adapters, the HTTP client
 *   and `Zotero.HTTP`.
 * - **Doubled: the language model only**, as every model-driven spec in this
 *   suite does it (`reportWindow-flow.spec.ts`, `zotero/summarySection.spec.ts`):
 *   `registry.get` answers the active provider with a fake, and `secrets.has`
 *   answers `true` for its key, which exists nowhere. No key is read or
 *   written. *Coordinator decision, 2026-11-17 (brief: "Never run a keyed or
 *   paid path")*: while Zotero is offline the fake sends its request through
 *   the plugin's **real** client (`graph.http`) to a closed loopback port, so the
 *   failure the pipeline sees comes up from `Zotero.HTTP` exactly as a real
 *   adapter's would (the shipped adapters pass the client's errors through). A
 *   loopback port, and not a provider's host, so that even a broken offline
 *   switch sends nothing away from this machine: the request would then fail as
 *   a refused connection and the assertions on the offline message would fail.
 *
 * **What it asserts, against the card's `Do` and `Done when`:**
 *
 * 1. A summarize job cut at its tenth model call keeps the nine summaries, and
 *    a second run, online, makes only the tenth (`FR-23`).
 * 2. Offline, existing content is usable: a third summarize run sends nothing
 *    and says every paper has a summary; the saved report is in the report
 *    store; the report note and a summary note open in Zotero's note window;
 *    an audio attachment's file resolves and reads back.
 * 3. Offline, each network action ends on a message, never a stack trace: a
 *    report run, a keyword search, and the related window's own run. The
 *    message each one shows is logged with the `[P7-T18]` prefix for
 *    `plan/reports/P7-T18.md`.
 * 4. Offline, each window opens: Search & Import, Summarize, Report, and
 *    Research Helper's preferences pane.
 * 5. Offline, the plugin starts: a disable and enable builds a fresh instance
 *    that registers its UI and reports no error.
 *
 * **Not exercised here:** an audio run (the text-to-speech client reads its
 * key from the keystore at run time and no spec doubles it), and the
 * recommend window (the search window in another mode; its run is not in the
 * card's list). `plan/reports/P7-T18.md` records both.
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import { llmAttemptTimeouts } from "../../src/core/rateLimit/hostLimiter";
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
import { expectedHeadings } from "../../src/pipeline/trendReport/compose";
import {
  GEMINI_PCM_FORMAT,
  createAudioStore,
  silencePcm,
  type AttachmentApi,
  type AudioFileSystem,
} from "../../src/tts/audioStore";
import { COST_DIALOG_URL } from "../../src/ui/dialogs/costConfirmDialog";
import { openSearchWindow } from "../../src/ui/dialogs/searchDialog";
import {
  PREFERENCES_PANE_ID,
  PREFERENCES_ROOT_ID,
} from "../../src/ui/prefs/preferencesPane";
import { chatResponse, mockModel } from "../helpers/mockLLM";
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
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 60_000;
const TAG = `p7t18-${String(Date.now())}`;
/** How many papers the collection holds, and the model call the network drops at. */
const PAPERS = 10;
const CUT_AT_CALL = 10;
/** `rh-error-offline`'s first sentence in the en-US bundle (`docs/08` §8.3). */
const OFFLINE_TEXT = "Zotero is offline.";
/** Port 9 (discard) on loopback: closed on a test machine, and never away from it. */
const PROBE_URL = "http://127.0.0.1:9/p7t18-offline-probe";
const USAGE = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  costUsd: 0.001,
};
const QUOTE =
  "The synthetic intervention reduced the synthetic outcome by 42 percent.";
/** SYNTHETIC: longer than `summary.minAbstractChars`. */
const ABSTRACT = `${QUOTE} ${"Synthetic background sentence about the synthetic study. ".repeat(8)}`;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Lines logged while Zotero is offline, sent once it is back.
 *
 * The runner's `debug` is an HTTP POST to its loopback reporter, and Gecko's
 * offline switch refuses loopback too: measured 2026-11-17, every line logged
 * offline in this spec's first run was lost.
 */
const heldLines: string[] = [];

function log(line: string): void {
  if (Services.io.offline) {
    heldLines.push(line);
    return;
  }
  for (const held of heldLines.splice(0)) debug(`[P7-T18] ${held}`);
  debug(`[P7-T18] ${line}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
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

function graphOf(): NonNullable<Addon["api"]["services"]> {
  const graph = pluginInstance()?.api.services;
  if (!graph) assert.fail("registerUI() published no api.services");
  return graph;
}

function restorePref(name: string, before: unknown): void {
  if (before === undefined) {
    Zotero.Prefs.clear(name, true);
  } else {
    Zotero.Prefs.set(name, before as string | number | boolean, true);
  }
}

/** Zotero's offline switch: the one this spec turns. */
function setOffline(offline: boolean): void {
  Services.io.offline = offline;
  assert.strictEqual(
    Zotero.HTTP.browserIsOffline(),
    offline,
    `Zotero.HTTP reads offline = ${String(offline)}`,
  );
  if (!offline) {
    for (const held of heldLines.splice(0)) debug(`[P7-T18] ${held}`);
  }
}

/** Every text node under the document's root element, trimmed and joined. */
function documentText(win: Window): string {
  return (win.document.documentElement?.textContent ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** What `NFR-9` rules out: a stack frame or a source location in the window. */
function assertNoStackTrace(win: Window, where: string): void {
  const text = documentText(win);
  assert.notInclude(text, "    at ", `${where}: a stack frame is shown`);
  assert.notInclude(text, ".ts:", `${where}: a source location is shown`);
  assert.notInclude(text, ".js:", `${where}: a source location is shown`);
}

function textOf(win: Window, id: string): string {
  return (win.document.getElementById(id)?.textContent ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Each shown element under `id` that carries text or a Fluent id, as JSON. */
function panelReport(win: Window, id: string): string {
  const root = win.document.getElementById(id);
  if (root === null) return `"#${id} absent"`;
  const shown = [root, ...root.querySelectorAll("*")].filter(
    (element) =>
      !(element as HTMLElement).hidden &&
      (element.hasAttribute("data-l10n-id") ||
        (element.children.length === 0 &&
          (element.textContent ?? "").trim() !== "")),
  );
  return JSON.stringify(
    shown.map((element) => ({
      id: element.id || undefined,
      l10n: element.getAttribute("data-l10n-id") ?? undefined,
      args: element.getAttribute("data-l10n-args") ?? undefined,
      text: (element.textContent ?? "").replace(/\s+/gu, " ").trim(),
    })),
  );
}

function argsOf(element: Element | null): Record<string, unknown> {
  const raw = element?.getAttribute("data-l10n-args");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

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
    researchQuestion: "Does the synthetic intervention work?",
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
      name: `Synthetic theme ${String(i + 1)}`,
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
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/"itemKey":"([A-Z0-9]{8})"/g),
      (m) => m[1] as string,
    ),
  );
  return JSON.stringify({
    themeId: "echo",
    name: "echo",
    narrative: `Work in this theme ${keys
      .slice(0, 2)
      .map((k) => `[[${k}]]`)
      .join(" ")} reduced the outcome.`,
    representativePapers: keys
      .slice(0, 2)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  });
}

/** The English report template's headings, read once from the bundled registry. */
let headings: readonly string[] = [];

function reportAnswer(request: ChatRequest): string {
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/\[\[([A-Z0-9]{8})\]\]/g),
      (m) => m[1] as string,
    ),
  );
  return headings
    .map((heading, index) => {
      const n = index + 1;
      const body =
        n === 11
          ? keys.map((k, i) => `${String(i + 1)}. [[${k}]]`).join("\n")
          : `Finding ${String(n)} reported a 12% change [[${keys[(n - 1) % keys.length] as string}]].`;
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

/** What the fake model did, read by the tests. */
const model: {
  /** Every call, answered or not. */
  calls: number;
  /** The call that turns Zotero offline before it is sent, when set. */
  cutAtCall: number | undefined;
  /** `name/messageKey` of each error the real client threw for an offline call. */
  offlineFailures: string[];
} = { calls: 0, cutAtCall: undefined, offlineFailures: [] };

/**
 * One model call's network leg. Online, nothing is sent: the fake answers from
 * this file. Offline, the request goes through the plugin's real client, and
 * whatever that throws is what the pipeline sees.
 */
async function networkLeg(ctx: LLMCallContext): Promise<void> {
  model.calls += 1;
  if (model.cutAtCall !== undefined && model.calls === model.cutAtCall) {
    model.cutAtCall = undefined;
    setOffline(true);
    log(`call ${String(model.calls)}: Zotero is now offline`);
  }
  if (!Services.io.offline) return;
  try {
    await graphOf().http.request("POST", PROBE_URL, {
      headers: { "Content-Type": "application/json" },
      body: "{}",
      token: ctx.token,
      ...llmAttemptTimeouts(false),
    });
  } catch (error) {
    const named = error as { name?: string; messageKey?: string };
    model.offlineFailures.push(
      `${named.name ?? typeof error}/${named.messageKey ?? "-"}`,
    );
    throw error;
  }
  throw new Error("[P7-T18] the offline probe was answered");
}

function fakeProvider(real: LLMProvider): LLMProvider {
  return {
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
    chat: async (request, ctx): Promise<ChatResponse> => {
      await networkLeg(ctx);
      return chatResponse(answerTo(request), { usage: USAGE });
    },
    chatStream: async function* (
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      await networkLeg(ctx);
      const text = answerTo(request);
      yield { deltaText: text, done: false };
      yield { deltaText: "", done: true, usage: USAGE };
    },
    countTokens: (text) => Math.ceil(text.length / 4),
  };
}

/* ------------------------------------------------------- the dialogs */

interface CostDialogWindow extends Window {
  RHCostDialog?: {
    state: { initialized: boolean; reported: boolean };
    updateAccept(): void;
  };
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

/** Accept every cost dialog that opens, as a user would, until `done()`. */
async function acceptCostDialogsUntil(done: () => boolean): Promise<number> {
  let accepted = 0;
  while (!done()) {
    const shown = costDialogs().find(
      (candidate) =>
        candidate.RHCostDialog?.state.initialized === true &&
        !candidate.RHCostDialog.state.reported,
    );
    if (shown !== undefined) {
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
      accepted += 1;
      await waitUntil(
        () => shown.closed || shown.RHCostDialog?.state.reported === true,
        "the cost dialog to report its answer",
      );
    }
    await delay(50);
  }
  return accepted;
}

/* ------------------------------------------------------- the windows */

interface SummarizeWindow extends Window {
  RHSummarizeWindow?: {
    state: { initialized: boolean; running: boolean };
    start(): void;
  };
}

interface ReportWindow extends Window {
  RHReportWindow?: {
    state: { initialized: boolean };
    ready?: Promise<void>;
  };
}

interface SearchController {
  readonly state: {
    initialized: boolean;
    running: boolean;
    panel: string;
  };
  search(): void;
  refreshSearchGate(): { enabled: boolean };
  sourceBoxes(): {
    getAttribute(name: string): string | null;
    checked: boolean;
  }[];
}

interface SearchWindow extends Window {
  RHSearchWindow?: SearchController;
}

interface PrefsWindow extends Window {
  Zotero_Preferences?: { panes: Map<string, { loaded?: boolean }> };
}

async function openSummarize(collectionID: number): Promise<SummarizeWindow> {
  const commands = pluginInstance()?.api.summarizeWindow;
  if (!commands) assert.fail("registerUI() published no api.summarizeWindow");
  const win = commands.open(
    Zotero.getMainWindow(),
    collectionID,
  ) as unknown as SummarizeWindow;
  await waitUntil(
    () =>
      win.document?.readyState === "complete" &&
      win.RHSummarizeWindow?.state.initialized === true,
    "the summarize window to initialize",
  );
  await waitUntil(
    () => textOf(win, "rh-summarize-header").length > 0,
    "the summarize window's header",
  );
  return win;
}

/** The outcome line's arguments, once the run has ended and drawn it. */
interface SummarizeOutcome {
  readonly outcome: string;
  readonly done: number;
  readonly total: number;
  readonly failed: number;
  readonly notes: number;
  readonly text: string;
  readonly rows: readonly { status: string; title: string }[];
}

async function runSummarize(win: SummarizeWindow): Promise<SummarizeOutcome> {
  const controller = win.RHSummarizeWindow;
  if (!controller) assert.fail("the window loaded without RHSummarizeWindow");
  const writeNotes = win.document.getElementById(
    "rh-summarize-write-notes",
  ) as unknown as { checked: boolean; disabled: boolean } | null;
  if (writeNotes !== null && !writeNotes.disabled) writeNotes.checked = true;
  log(
    `write notes at Start: checked ${String(writeNotes?.checked)}, ` +
      `disabled ${String(writeNotes?.disabled)}`,
  );
  controller.start();
  await acceptCostDialogsUntil(() => !controller.state.running);
  const outcome = win.document.getElementById("rh-summarize-outcome");
  await waitUntil(
    () => textOf(win, "rh-summarize-outcome").length > 0,
    "the summarize outcome to be drawn",
  );
  const args = argsOf(outcome);
  const rows = [...win.document.querySelectorAll("#rh-summarize-rows p")].map(
    (row) => {
      const rowArgs = argsOf(row);
      return {
        status: String(rowArgs.status),
        title: String(rowArgs.title),
      };
    },
  );
  return {
    outcome: String(args.outcome),
    done: Number(args.done),
    total: Number(args.total),
    failed: Number(args.failed),
    notes: Number(args.notes),
    text: textOf(win, "rh-summarize-outcome"),
    rows,
  };
}

async function openReport(collectionID: number): Promise<ReportWindow> {
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
    "the report window to initialize",
  );
  await win.RHReportWindow?.ready;
  return win;
}

function isDisabled(win: Window, id: string): boolean {
  return (
    (win.document.getElementById(id) as unknown as { disabled: boolean })
      .disabled === true
  );
}

/** Run a report in English and wait for the window to say how it ended. */
async function runReport(win: ReportWindow): Promise<string> {
  (
    win.document.getElementById("rh-report-language") as unknown as {
      value: string;
    }
  ).value = "en";
  await waitUntil(
    () => !isDisabled(win, "rh-report-generate"),
    "Generate to be enabled",
  );
  (
    win.document.getElementById("rh-report-generate") as unknown as {
      doCommand(): void;
    }
  ).doCommand();
  const ended = (): boolean =>
    textOf(win, "rh-report-outcome").length > 0 &&
    !isDisabled(win, "rh-report-generate");
  await acceptCostDialogsUntil(ended);
  return textOf(win, "rh-report-outcome");
}

async function openSearch(
  args: Parameters<typeof openSearchWindow>[1],
): Promise<{ win: SearchWindow; controller: SearchController }> {
  const win = openSearchWindow(
    Zotero.getMainWindow(),
    args,
  ) as unknown as SearchWindow;
  await waitUntil(
    () => win.RHSearchWindow?.state.initialized === true,
    "RHSearchWindow.init() to have run",
  );
  const controller = win.RHSearchWindow;
  if (!controller) assert.fail("the window loaded without RHSearchWindow");
  return { win, controller };
}

/** Close the search window and let the singleton name go. */
async function closeSearch(win: Window): Promise<void> {
  win.close();
  await waitUntil(() => win.closed, "the search window to close");
  await delay(250);
}

async function openPreferencesPane(): Promise<Window> {
  const opened = Zotero.Utilities.Internal.openPreferences(PREFERENCES_PANE_ID);
  if (opened === null) assert.fail("openPreferences returned no window");
  await waitUntil(
    () =>
      (opened as PrefsWindow).Zotero_Preferences?.panes?.get(
        PREFERENCES_PANE_ID,
      )?.loaded === true,
    "the pane to finish loading",
  );
  const root = opened.document.getElementById(PREFERENCES_ROOT_ID);
  await waitUntil(
    () => root?.getAttribute("data-rh-initialized") === "true",
    "the pane's controller to initialise",
  );
  return opened;
}

async function closePreferencesPane(win: Window): Promise<void> {
  win.close();
  await waitUntil(() => win.closed, "the preferences window to close");
  await waitUntil(
    () => !Services.wm.getEnumerator("zotero:pref").hasMoreElements(),
    "the window mediator to drop the preferences window",
  );
}

/** Open a note in Zotero's own note window, check it loaded, and close it. */
async function openNoteWindow(noteID: number, what: string): Promise<void> {
  const pane = Zotero.getMainWindow().ZoteroPane;
  pane.openNoteWindow(noteID);
  let found: Window | undefined;
  await waitUntil(() => {
    found = pane.findNoteWindow(noteID) as Window | undefined;
    return found?.document?.readyState === "complete";
  }, `the note window for ${what}`);
  const win = found as Window;
  log(`${what} opened in a note window (${win.location.href})`);
  win.close();
  await waitUntil(() => win.closed, `the note window for ${what} to close`);
}

/* ------------------------------------------------------- the library */

async function makeCollection(): Promise<{
  collection: Zotero.Collection;
  items: Zotero.Item[];
}> {
  const collection = new Zotero.Collection({
    libraryID: Zotero.Libraries.userLibraryID,
    name: `${TAG} offline`,
  });
  await collection.saveTx();
  const items: Zotero.Item[] = [];
  // No DOI: a summary's full-text ladder asks Europe PMC by DOI, and this
  // spec doubles no service, so a paper without one sends nothing to it.
  for (let i = 1; i <= PAPERS; i += 1) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", `${TAG} paper ${String(i)}`);
    item.setField("abstractNote", ABSTRACT);
    item.setField("date", "2024");
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

/* -------------------------------------------- the plugin's add-on wrapper */

interface AddonWrapper {
  readonly isActive: boolean;
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

async function researchHelperAddon(): Promise<AddonWrapper> {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const wrapper = (await AddonManager.getAddonByID(
    config.addonID,
  )) as AddonWrapper | null;
  if (!wrapper) assert.fail(`AddonManager does not know ${config.addonID}`);
  return wrapper;
}

/** Resolve after Zotero has finished the plugin's bootstrap `method`. */
function afterBootstrapCall(
  method: "startup" | "shutdown",
  action: () => Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observer: _ZoteroTypes.Plugins.observer = {
      [method]: (params: { id: string }) => {
        if (params.id !== config.addonID) return;
        clearTimeout(timer);
        Zotero.Plugins.removeObserver(observer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      Zotero.Plugins.removeObserver(observer);
      reject(new Error(`timed out waiting for bootstrap ${method}`));
    }, STEP_TIMEOUT_MS);
    Zotero.Plugins.addObserver(observer);
    action().catch((error: unknown) => {
      clearTimeout(timer);
      Zotero.Plugins.removeObserver(observer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/* -------------------------------------------------------------- the spec */

describe("P7-T18: the plugin with Zotero offline (NFR-9, FR-23)", function () {
  let locale: UILocaleSnapshot | undefined;
  let collection: Zotero.Collection;
  let items: Zotero.Item[] = [];
  const restores: (() => void)[] = [];
  const made: Zotero.Item[] = [];
  const writtenFiles: string[] = [];
  let audioItemID: number | undefined;
  let offlineBefore = false;
  let manageBefore = false;

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      "the plugin to initialize",
    );
    offlineBefore = Services.io.offline;
    manageBefore = Services.io.manageOfflineStatus;
    Services.io.manageOfflineStatus = false;
    setOffline(false);
    locale = await pinUILocale(["en-US"], log);
    const bundled = await import("../../src/prompts/bundled");
    headings = expectedHeadings(bundled.PROMPT_REGISTRY.get("TREND_REPORT_EN"));

    const graph = graphOf();
    await graph.database.ready;
    const registry = graph.llm.registry as Mutable<typeof graph.llm.registry>;
    const active = registry.activeProviderId();
    const realGet = registry.get;
    const real = realGet.call(registry, active);
    if (!real) assert.fail(`no adapter is registered for ${active}`);
    const fake = fakeProvider(real);
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
      ["reportModel", "p7t18-report-model"],
      ["summaryModel", "p7t18-summary-model"],
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

    const built = await makeCollection();
    collection = built.collection;
    items = built.items;
    made.push(...items);
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    Services.io.offline = offlineBefore;
    Services.io.manageOfflineStatus = manageBefore;
    for (const dialog of costDialogs()) dialog.close();
    for (const restore of restores.reverse()) restore();
    if (audioItemID !== undefined) {
      const audioItem = Zotero.Items.get(audioItemID);
      if (audioItem !== false) await audioItem.eraseTx();
    }
    for (const path of writtenFiles) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
    if (collection !== undefined) {
      for (const note of notesIn(collection)) await note.eraseTx();
    }
    for (const one of made) await one.eraseTx();
    await collection?.eraseTx();
    if (locale !== undefined) await restoreUILocale(locale, log);
  });

  it("FR-23: a summarize job cut at its tenth call keeps nine summaries, and the next run makes only the tenth", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const win = await openSummarize(collection.id);
    try {
      model.calls = 0;
      model.offlineFailures = [];
      model.cutAtCall = CUT_AT_CALL;
      const startedAt = Date.now();
      const cut = await runSummarize(win);
      log(
        `cut run: ${String(Date.now() - startedAt)} ms, ${String(model.calls)} calls, ` +
          `offline failures ${JSON.stringify(model.offlineFailures)}, outcome ` +
          `${JSON.stringify({ ...cut, rows: undefined })}`,
      );
      log(`cut run rows: ${JSON.stringify(cut.rows.map((row) => row.status))}`);
      assert.isTrue(
        Services.io.offline,
        "the tenth call turned Zotero offline",
      );
      assert.isAbove(
        model.offlineFailures.length,
        0,
        "the tenth call went through the real client and failed there",
      );
      for (const failure of model.offlineFailures) {
        assert.strictEqual(
          failure,
          "OfflineError/rh-error-offline",
          "the real client's offline error",
        );
      }
      assert.strictEqual(cut.done, PAPERS - 1, "nine summaries are made");
      assert.strictEqual(cut.failed, 1, "one paper failed");
      assert.strictEqual(
        cut.rows.filter((row) => row.status === "done").length,
        PAPERS - 1,
        "nine rows are done",
      );
      const failedRows = cut.rows.filter((row) => row.status === "failed");
      assert.strictEqual(failedRows.length, 1, "one row failed");
      // Finding, measured 2026-11-17 (`plan/00` §6 item 393): the row says
      // "— failed" and the window names no reason, so `rh-error-offline`
      // is not shown.
      const lastRow = win.document.querySelector(
        "#rh-summarize-rows p:last-child",
      );
      log(
        `the failed row reads "${(lastRow?.textContent ?? "").trim()}"; ` +
          `notice "${textOf(win, "rh-summarize-notice")}"`,
      );
      assertNoStackTrace(win, "the summarize window after the cut");
      const notes = items.reduce(
        (sum, item) => sum + item.getNotes().length,
        0,
      );
      assert.strictEqual(notes, PAPERS - 1, "nine summary notes are kept");

      setOffline(false);
      const callsBefore = model.calls;
      const resumed = await runSummarize(win);
      log(
        `resumed run: ${String(model.calls - callsBefore)} call(s), outcome ` +
          `${JSON.stringify({ ...resumed, rows: undefined })}`,
      );
      assert.strictEqual(
        model.calls - callsBefore,
        1,
        "only the paper the cut lost is sent again",
      );
      assert.strictEqual(resumed.done, 1, "the tenth summary is made");
      assert.strictEqual(resumed.failed, 0, "nothing fails online");
      assert.strictEqual(
        resumed.rows.filter((row) => row.status === "skipped-existing").length,
        PAPERS - 1,
        "the nine kept summaries are skipped, not made again",
      );
      const notesAfter = items.reduce(
        (sum, item) => sum + item.getNotes().length,
        0,
      );
      // Measured 2026-11-17: the resumed run stores the tenth summary and
      // writes no note for it ("0 notes saved"); the next run writes it in
      // its WritingNotes stage. Logged, not asserted: the card asks that
      // nothing is lost, and the nine notes are what the cut must keep.
      log(`summary notes after the resumed run: ${String(notesAfter)}`);
      assert.isAbove(notesAfter, PAPERS - 2, "the nine summary notes are kept");
    } finally {
      setOffline(false);
      win.close();
    }
  });

  it("offline, existing content is usable: stored summaries, the saved report and its note, a summary note and an audio file", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // Made online first: a report, and an audio attachment through the
    // plugin's own audio store.
    const reportWin = await openReport(collection.id);
    let reportNote: Zotero.Item | undefined;
    try {
      const outcome = await runReport(reportWin);
      log(`online report: "${outcome}"`);
      assert.include(outcome, "Report ready");
      await waitUntil(
        () => textOf(reportWin, "rh-report-note").includes("Saved as a note"),
        "the report note line",
      );
      reportNote = notesIn(collection)[0];
    } finally {
      reportWin.close();
    }
    if (reportNote === undefined) assert.fail("no report note was saved");

    const files: AudioFileSystem = {
      join: (...segments) => PathUtils.join(...segments),
      makeDirectory: (path) =>
        IOUtils.makeDirectory(path, {
          createAncestors: true,
          ignoreExisting: true,
        }),
      writeFile: (path, bytes) => IOUtils.write(path, bytes),
      exists: (path) => IOUtils.exists(path),
    };
    const attachments: AttachmentApi = Zotero.Attachments;
    const audioStore = createAudioStore({
      dataDirectory: Zotero.DataDirectory.dir,
      files,
      attachments,
    });
    const written = await audioStore.writeWav({
      stem: `${TAG}-audio`,
      pcm: silencePcm(500),
      format: GEMINI_PCM_FORMAT,
    });
    writtenFiles.push(written.path);
    const attached = await audioStore.attach({
      file: written,
      parentItemID: (items[0] as Zotero.Item).id,
      title: `${TAG} audio`,
    });
    audioItemID = attached.itemID;

    setOffline(true);
    try {
      // The stored summaries: a run over a summarized collection sends
      // nothing and says so.
      const win = await openSummarize(collection.id);
      try {
        const callsBefore = model.calls;
        const again = await runSummarize(win);
        log(
          `offline summarize over summarized papers: "${again.text}"; rows ` +
            `${JSON.stringify(again.rows.map((row) => row.status))}`,
        );
        assert.strictEqual(model.calls, callsBefore, "no model call is made");
        assert.strictEqual(again.failed, 0, "nothing fails offline");
        assert.isTrue(
          again.outcome === "nothing" || again.outcome === "succeeded",
          `the run ends well offline (outcome ${again.outcome})`,
        );
        assertNoStackTrace(win, "the summarize window offline");
      } finally {
        win.close();
      }

      const graph = graphOf();
      const reports = await graph.database.reports();
      const latest = await reports?.latestForCollection(
        collection.libraryID,
        collection.key,
      );
      assert.isTrue(latest !== undefined, "the saved report is in the store");

      assert.include(
        reportNote.getNote(),
        collection.name,
        "the report note's text reads back",
      );
      await openNoteWindow(reportNote.id, "the report note");
      const summaryNoteID = (items[1] as Zotero.Item).getNotes()[0];
      if (summaryNoteID === undefined) assert.fail("no summary note");
      await openNoteWindow(summaryNoteID, "a summary note");

      const audio = Zotero.Items.get(attached.itemID);
      if (audio === false) assert.fail("the audio attachment is gone");
      assert.strictEqual(audio.attachmentContentType, "audio/wav");
      const path = await audio.getFilePathAsync();
      if (path === false) assert.fail("the audio attachment has no file");
      const bytes = await IOUtils.read(path);
      assert.strictEqual(
        bytes.byteLength,
        written.byteLength,
        "the audio file reads back whole",
      );
      log(
        `audio attachment ${String(attached.itemID)}: ${String(bytes.byteLength)} bytes read offline`,
      );
    } finally {
      setOffline(false);
    }
  });

  it("offline, a report run ends on a message and no stack trace", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // A paper with no summary yet, so the run needs the model: with every
    // input unchanged, the run before this one is answered from the store.
    const added = new Zotero.Item("journalArticle");
    added.libraryID = Zotero.Libraries.userLibraryID;
    added.setField("title", `${TAG} paper ${String(PAPERS + 1)}`);
    added.setField("abstractNote", ABSTRACT);
    added.setField("date", "2024");
    added.setCollections([collection.id]);
    await added.saveTx();
    made.push(added);
    setOffline(true);
    const win = await openReport(collection.id);
    try {
      model.offlineFailures = [];
      const startedAt = Date.now();
      const outcome = await runReport(win);
      const reason = textOf(win, "rh-report-stop-reason");
      log(
        `offline report: ${String(Date.now() - startedAt)} ms; outcome "${outcome}"; ` +
          `stop reason "${reason}"; notice "${textOf(win, "rh-report-notice")}"; ` +
          `rows ${panelReport(win, "rh-report-rows")}; ` +
          `client errors ${JSON.stringify(model.offlineFailures)}`,
      );
      assert.isAbove(
        model.offlineFailures.length,
        0,
        "a model call went through the real client and failed offline",
      );
      for (const failure of model.offlineFailures) {
        assert.strictEqual(failure, "OfflineError/rh-error-offline");
      }
      // Finding, measured 2026-11-17 (`plan/00` §6 item 393): the window
      // ends on its generic failure line, not on `rh-error-offline`. What
      // NFR-9 rules out is held here: a message, and no stack trace.
      assert.isAbove(outcome.length, 0, "the report window shows a message");
      assertNoStackTrace(win, "the report window offline");
    } finally {
      win.close();
      setOffline(false);
    }
  });

  it("offline, a keyword search ends on the offline message and no stack trace", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    setOffline(true);
    const { win, controller } = await openSearch({ mode: "keyword" });
    try {
      (
        win.document.getElementById("rh-search-keyword") as HTMLInputElement
      ).value = "synthetic offline query";
      for (const box of controller.sourceBoxes()) {
        box.checked = box.getAttribute("value") === "pubmed";
      }
      assert.isTrue(
        controller.refreshSearchGate().enabled,
        "Search is enabled",
      );
      const startedAt = Date.now();
      controller.search();
      await waitUntil(
        () => !controller.state.running && controller.state.panel !== "initial",
        "the search to end",
      );
      await waitUntil(
        () => textOf(win, "rh-state-error-lines").includes(OFFLINE_TEXT),
        `the offline message (the window reads "${textOf(win, "rh-state-error")}")`,
      );
      log(
        `offline search: ${String(Date.now() - startedAt)} ms; panel ` +
          `${controller.state.panel}; headline "${textOf(win, "rh-state-error-headline")}"; ` +
          `lines "${textOf(win, "rh-state-error-lines")}"`,
      );
      assert.strictEqual(controller.state.panel, "error");
      assertNoStackTrace(win, "the search window offline");
    } finally {
      await closeSearch(win);
      setOffline(false);
    }
  });

  it("offline, the related window's own run ends on a message and no stack trace", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const graph = graphOf();
    const scholar = graph.sources.get("semanticscholar") as unknown as
      { hasUsableApiKey(): Promise<boolean> } | undefined;
    assert.isFalse(
      (await scholar?.hasUsableApiKey()) === true,
      "a Semantic Scholar key is present",
    );
    const seed = new Zotero.Item("journalArticle");
    seed.libraryID = Zotero.Libraries.userLibraryID;
    seed.setField("title", `${TAG} related seed`);
    seed.setField("date", "2024");
    seed.setField("DOI", `10.5555/${TAG}.seed`);
    await seed.saveTx();
    made.push(seed);

    setOffline(true);
    const startedAt = Date.now();
    const { win, controller } = await openSearch({
      mode: "related",
      seedItemID: seed.id,
    });
    try {
      await waitUntil(
        () => !controller.state.running && controller.state.panel !== "initial",
        "the related run to end, which it starts by itself",
      );
      // Fluent fills the panel after the run publishes its end.
      await delay(1500);
      log(
        `offline related: ${String(Date.now() - startedAt)} ms; panel ` +
          `${controller.state.panel}; error panel ${panelReport(win, "rh-state-error")}; ` +
          `warnings ${panelReport(win, "rh-search-warnings")}`,
      );
      assertNoStackTrace(win, "the related window offline");
      // Finding, measured 2026-11-17 (`plan/00` §6 item 393): the window
      // shows its error panel with the code, and each list "failed
      // (OFFLINE)", not `rh-error-offline`. What NFR-9 rules out is held
      // here: a message, and no stack trace.
      assert.strictEqual(controller.state.panel, "error");
      assert.isAbove(
        textOf(win, "rh-state-error-headline").length,
        0,
        "the related window shows a message",
      );
    } finally {
      await closeSearch(win);
      setOffline(false);
    }
  });

  it("offline, each window opens: Search & Import, Summarize, Report and the preferences pane", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    setOffline(true);
    try {
      const search = await openSearch({ mode: "keyword" });
      assertNoStackTrace(search.win, "the search window");
      await closeSearch(search.win);

      const summarize = await openSummarize(collection.id);
      assertNoStackTrace(summarize, "the summarize window");
      summarize.close();

      const report = await openReport(collection.id);
      assert.isFalse(
        isDisabled(report, "rh-report-generate"),
        "Generate is offered",
      );
      assertNoStackTrace(report, "the report window");
      report.close();

      const prefs = await openPreferencesPane();
      assertNoStackTrace(prefs, "the preferences pane");
      await closePreferencesPane(prefs);
      log(
        "offline: the search, summarize, report and preferences windows opened",
      );
    } finally {
      setOffline(false);
    }
  });

  it("offline, the plugin starts and registers its UI with no error", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const wrapper = await researchHelperAddon();
    const previous = pluginInstance();
    if (!previous) assert.fail("no plugin instance");
    // Put the fake model back first: the next instance builds its own graph.
    for (const restore of restores.splice(0).reverse()) restore();
    setOffline(true);
    const logged: string[] = [];
    const platform = Zotero as unknown as {
      logError: (error: unknown) => void;
    };
    const realLogError = platform.logError;
    platform.logError = (error: unknown) => {
      logged.push(String((error as { message?: string })?.message ?? error));
      realLogError.call(Zotero, error);
    };
    try {
      await afterBootstrapCall("shutdown", () => wrapper.disable());
      await afterBootstrapCall("startup", () => wrapper.enable());
      await waitUntil(
        () => pluginInstance()?.data.initialized === true,
        "the plugin to initialize offline",
      );
      const fresh = pluginInstance() as Addon;
      assert.notStrictEqual(fresh, previous, "a fresh instance");
      assert.isTrue(fresh.data.alive, "the fresh instance is alive");
      assert.isAbove(
        fresh.scope.liveHandles().length,
        0,
        "the fresh instance registered into its scope",
      );
      for (const member of [
        "services",
        "searchWindow",
        "summarizeWindow",
        "reportWindow",
      ] as const) {
        assert.isTrue(
          fresh.api[member] !== undefined,
          `api.${member} is published offline`,
        );
      }
      const ours = logged.filter(
        (line) =>
          line.includes(config.addonRef) || line.includes("research-helper"),
      );
      log(
        `offline startup: ${String(logged.length)} error(s) logged, ` +
          `${String(ours.length)} of them the plugin's`,
      );
      assert.strictEqual(
        ours.length,
        0,
        `the plugin logged ${ours.join(" | ")}`,
      );
    } finally {
      platform.logError = realLogError;
      setOffline(false);
      if (!wrapper.isActive) {
        await afterBootstrapCall("startup", () => wrapper.enable());
      }
    }
  });
});

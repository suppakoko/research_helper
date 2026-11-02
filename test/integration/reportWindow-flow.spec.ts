/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P4-T20` — the report window driving the real trend-report pipeline, end to
 * end, inside a live Zotero: the collection, the job queue, the plugin
 * database, the cost dialog, citeproc and the note are all real. **Only the
 * provider is fake** (as `zotero/summarySection.spec.ts` does it): the active
 * adapter answers from this spec, so no request leaves Zotero, and the key
 * check sees a key that exists nowhere — `secrets.has` answers for the active
 * provider and nothing is written to any keystore.
 *
 * It asserts, against the card's `Done when`:
 *
 * 1. A mock job reaches "Report ready" and saves a note in the test library;
 *    the preview shows the streamed text labelled "draft", with no `aria-live`,
 *    and then the final text; Export and Copy work.
 * 2. Cancel through the window: "discarded", no note, no report row.
 * 3. Owner, `plan/00` §6 item 324(a): a job left `paused` asks when the window
 *    opens (stop cancels it; continue finishes it in its own record), and a
 *    job resumed after a restart whose pause waited with no window is asked
 *    when the window opens and finishes in it.
 *
 * A group library is not exercised here (`G-25`): `settleReportNote`'s unit
 * tests hold the question.
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
import { expectedHeadings } from "../../src/pipeline/trendReport/compose";
import { TREND_REPORT_INPUT_VERSION } from "../../src/pipeline/trendReport/trendReportPipeline";
import { COST_DIALOG_URL } from "../../src/ui/dialogs/costConfirmDialog";
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
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 30_000;
const TAG = `p4t20-${String(Date.now())}`;
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

function log(line: string): void {
  debug(`[P4-T20] ${line}`);
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
      .join(" ")} reduced the outcome.`,
    representativePapers: keys
      .slice(0, 2)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  });
}

/** The prompts' eleven headings, read once from the bundled registry. */
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

/** What a test holds the fake model at: released by {@link release}. */
const hold: {
  /** Which call to hold, when one is set. */
  at: "stream" | "chat" | undefined;
  held: boolean;
  release: (() => void) | undefined;
  calls: number;
} = { at: undefined, held: false, release: undefined, calls: 0 };

/** Wait for `release`, or for a cancel of the job's token. */
function held(ctx: LLMCallContext): Promise<void> {
  hold.held = true;
  return new Promise((resolve, reject) => {
    hold.release = () => {
      hold.held = false;
      hold.at = undefined;
      resolve();
    };
    ctx.token.onCancelled(() => {
      hold.held = false;
      hold.at = undefined;
      reject(new Error("the fake model saw the cancel"));
    });
  });
}

/* ------------------------------------------------------ the windows */

interface ReportWindow extends Window {
  RHReportWindow?: {
    state: { initialized: boolean };
    ready?: Promise<void>;
    io: { session: { exportMarkdown(path: string): Promise<void> } };
  };
}

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

/** Accept the cost dialog the run raised, as a user would. */
async function acceptCostDialog(): Promise<void> {
  let dialogWindow: CostDialogWindow | undefined;
  await waitUntil(() => {
    dialogWindow = costDialogs().find(
      (candidate) =>
        candidate.RHCostDialog?.state.initialized === true &&
        !candidate.RHCostDialog.state.reported,
    );
    return dialogWindow !== undefined;
  }, "the cost dialog to open");
  const shown = dialogWindow as CostDialogWindow;
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
    "the cost dialog to report its answer",
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
    "the report window to initialize",
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

function chooseEnglish(win: Window): void {
  (
    win.document.getElementById("rh-report-language") as unknown as {
      value: string;
    }
  ).value = "en";
}

async function waitForOutcome(win: Window, text: string): Promise<void> {
  await waitUntil(
    () => textOf(win, "rh-report-outcome").includes(text),
    `the outcome "${text}" (saw "${textOf(win, "rh-report-outcome")}", stop "${textOf(win, "rh-report-stop-reason")}")`,
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
    item.setField("title", `${name} paper ${String(i)}`);
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

/* -------------------------------------------------------------- the spec */

describe("P4-T20: the report window runs a mock job to a saved report", function () {
  let instance: Addon;
  let locale: UILocaleSnapshot | undefined;
  const restores: (() => void)[] = [];
  const made: (Zotero.Item | Zotero.Collection)[] = [];

  const collectionFor = async (
    name: string,
  ): Promise<{ collection: Zotero.Collection; items: Zotero.Item[] }> => {
    const built = await makeCollection(`${TAG} ${name}`, 6);
    made.push(...built.items, built.collection);
    return built;
  };

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      "the plugin to initialize",
    );
    instance = pluginInstance() as Addon;
    locale = await pinUILocale(["en-US"], log);
    const bundled = await import("../../src/prompts/bundled");
    headings = expectedHeadings(bundled.PROMPT_REGISTRY.get("TREND_REPORT_EN"));
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
      chat: async (request, ctx): Promise<ChatResponse> => {
        hold.calls += 1;
        if (hold.at === "chat") await held(ctx);
        return chatResponse(answerTo(request), { usage: USAGE });
      },
      chatStream: async function* (
        request: ChatRequest,
        ctx: LLMCallContext,
      ): AsyncIterable<ChatStreamChunk> {
        hold.calls += 1;
        const text = answerTo(request);
        const cut = Math.floor(text.length / 2);
        yield { deltaText: text.slice(0, cut), done: false };
        if (hold.at === "stream") await held(ctx);
        yield { deltaText: text.slice(cut), done: false };
        yield { deltaText: "", done: true, usage: USAGE };
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
      ["reportModel", "p4t20-report-model"],
      ["summaryModel", "p4t20-summary-model"],
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

  it("streams a draft, ends on the final text, saves the note, and delivers (Done when 2, 3)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { collection } = await collectionFor("ready");
    const graph = instance.api.services!;
    const reports = (await graph.database.reports())!;
    const win = await openWindow(collection.id);
    try {
      await waitUntil(
        () => !isDisabled(win, "rh-report-generate"),
        "Generate to be enabled",
      );
      assert.isTrue(
        isDisabled(win, "rh-report-cancel"),
        "no run to cancel yet",
      );
      for (const id of [
        "rh-report-save-note",
        "rh-report-export",
        "rh-report-copy",
      ]) {
        assert.isTrue(isDisabled(win, id), `${id} waits for a report`);
      }
      chooseEnglish(win);
      hold.at = "stream";
      press(win, "rh-report-generate");
      await acceptCostDialog();
      await waitUntil(() => hold.held, "the report's stream to reach the hold");

      // The draft: raw text, labelled, and not announced (docs/08 §9).
      const preview = win.document.getElementById("rh-report-preview")!;
      await waitUntil(
        () => textOf(win, "rh-report-preview").length > 0,
        "the streamed text in the preview",
      );
      await waitUntil(
        () => textOf(win, "rh-report-preview-label").startsWith("Draft"),
        "the draft label",
      );
      assert.isFalse(
        preview.hasAttribute("aria-live"),
        "no aria-live while streaming",
      );
      assert.include(
        textOf(win, "rh-report-preview"),
        `## ${headings[0] as string}`,
        "the raw Markdown is painted as text",
      );
      assert.isFalse(
        isDisabled(win, "rh-report-cancel"),
        "Cancel while it runs",
      );
      const rows = [...win.document.querySelectorAll("#rh-report-rows p")].map(
        (row) => [
          row.getAttribute("data-row"),
          row.getAttribute("data-status"),
        ],
      );
      log(`rows while writing ${JSON.stringify(rows)}`);
      assert.deepEqual(rows, [
        ["reading", "done"],
        ["summaries", "done"],
        ["themes", "done"],
        ["writing", "active"],
        ["review", "pending"],
        ["finishing", "pending"],
      ]);
      assert.isTrue(
        textOf(win, "rh-report-spend").startsWith("Spent so far"),
        "the spend so far",
      );

      hold.release?.();
      await waitForOutcome(win, "Report ready");
      log(`outcome "${textOf(win, "rh-report-outcome")}"`);

      // The final text, once, and only now announced.
      await waitUntil(
        () => textOf(win, "rh-report-preview-label") === "The report",
        "the final label",
      );
      assert.strictEqual(preview.getAttribute("aria-live"), "polite");
      const finalText = textOf(win, "rh-report-preview");
      assert.isFalse(
        finalText.includes("[["),
        "the final text carries numeric markers, no raw [[KEY]]",
      );
      assert.include(finalText, collection.name);

      // The note, in the test library's collection, named on the run's row.
      await waitUntil(
        () => textOf(win, "rh-report-note").includes("Saved as a note"),
        `the note line (saw "${textOf(win, "rh-report-note")}")`,
      );
      const notes = notesIn(collection);
      assert.strictEqual(notes.length, 1, "one report note in the collection");
      const records = await graph.jobs.list({ status: ["succeeded"] });
      const record = records.find(
        (one) =>
          one.pipelineId === "trendReport" &&
          (one.input as { collectionKey?: string }).collectionKey ===
            collection.key,
      );
      assert.strictEqual(record?.resultRef?.kind, "report");
      const stored = await reports.get(record!.resultRef!.key as string);
      assert.strictEqual(stored?.zoteroNoteKey, notes[0]!.key);
      assert.isTrue((stored?.prompts.length ?? 0) > 0, "prompts recorded");

      // Delivery.
      assert.isTrue(isDisabled(win, "rh-report-save-note"), "already saved");
      assert.isFalse(isDisabled(win, "rh-report-export"), "Export");
      assert.isFalse(isDisabled(win, "rh-report-copy"), "Copy");
      press(win, "rh-report-copy");
      await waitUntil(
        () => textOf(win, "rh-report-delivery").includes("Copied"),
        "the copy line",
      );
      const path = PathUtils.join(
        Zotero.getTempDirectory().path,
        `${TAG}-report.md`,
      );
      await win.RHReportWindow?.io.session.exportMarkdown(path);
      await waitUntil(
        () => textOf(win, "rh-report-delivery") === "Exported.",
        "the export line",
      );
      const written = await IOUtils.readUTF8(path);
      assert.include(written, collection.name);
      await IOUtils.remove(path);
    } finally {
      win.close();
    }
  });

  it("Cancel through the job's token discards the draft and saves nothing", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { collection } = await collectionFor("cancel");
    const graph = instance.api.services!;
    const win = await openWindow(collection.id);
    try {
      await waitUntil(
        () => !isDisabled(win, "rh-report-generate"),
        "Generate to be enabled",
      );
      chooseEnglish(win);
      hold.at = "stream";
      press(win, "rh-report-generate");
      await acceptCostDialog();
      await waitUntil(() => hold.held, "the report's stream to reach the hold");
      press(win, "rh-report-cancel");
      await waitForOutcome(win, "Cancelled");
      await waitUntil(
        () => textOf(win, "rh-report-preview-label").includes("discarded"),
        "the discarded label",
      );
      assert.strictEqual(textOf(win, "rh-report-preview"), "");
      assert.strictEqual(notesIn(collection).length, 0, "no note");
      assert.isTrue(isDisabled(win, "rh-report-export"), "nothing to export");
      const ended = (await graph.jobs.list({ status: ["cancelled"] })).filter(
        (one) =>
          (one.input as { collectionKey?: string }).collectionKey ===
          collection.key,
      );
      assert.strictEqual(ended.length, 1, "the record ended cancelled");
    } finally {
      win.close();
    }
  });

  it("a job left paused asks when the window opens: stop cancels it, continue finishes it in its own record (item 324(a))", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { collection } = await collectionFor("paused");
    const graph = instance.api.services!;
    const input = {
      libraryID: collection.libraryID,
      collectionKey: collection.key,
      language: "en",
    };
    const leavePaused = async (): Promise<string> => {
      const record = await graph.jobs.enqueue("trendReport", input, {
        priority: "normal",
        inputVersion: TREND_REPORT_INPUT_VERSION,
      });
      await graph.jobs.pause(record.id, "awaiting-confirmation");
      return record.id;
    };

    const stopped = await leavePaused();
    let win = await openWindow(collection.id);
    await waitUntil(
      () => textOf(win, "rh-report-question-text").includes("confirm"),
      "the paused job's question",
    );
    assert.isTrue(isDisabled(win, "rh-report-generate"), "Generate holds");
    press(win, "rh-report-no");
    await waitUntil(
      () => !isDisabled(win, "rh-report-generate"),
      "Generate after the job stopped",
    );
    assert.strictEqual((await graph.jobs.get(stopped))?.status, "cancelled");

    win.close();
    await waitUntil(() => win.closed, "the window to close");
    const continued = await leavePaused();
    // Closing the window with the question open leaves the job paused.
    win = await openWindow(collection.id);
    await waitUntil(
      () => textOf(win, "rh-report-question-text").includes("confirm"),
      "the paused job's question again",
    );
    win.close();
    await waitUntil(() => win.closed, "the window to close");
    await delay(100);
    assert.strictEqual(
      (await graph.jobs.get(continued))?.status,
      "paused",
      "a closing window does not answer for the job",
    );

    win = await openWindow(collection.id);
    try {
      await waitUntil(
        () => textOf(win, "rh-report-question-text").includes("confirm"),
        "the paused job's question a third time",
      );
      press(win, "rh-report-yes");
      await acceptCostDialog();
      await waitForOutcome(win, "Report ready");
      const after = await graph.jobs.get(continued);
      assert.strictEqual(after?.status, "succeeded", "in its own record");
      assert.strictEqual(after?.resultRef?.kind, "report");
      await waitUntil(
        () => notesIn(collection).length === 1,
        "the one report note",
      );
    } finally {
      win.close();
    }
  });

  it("a job resumed after a restart waits with no window, is asked when the window opens, and finishes in it (item 324(a))", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const { collection } = await collectionFor("resumed");
    const graph = instance.api.services!;
    const registry = graph.llm.registry;
    const active = registry.activeProviderId();
    const secrets = graph.secrets as
      Mutable<NonNullable<typeof graph.secrets>> | undefined;
    const patchedHas = secrets?.has;
    if (secrets === undefined || patchedHas === undefined) {
      log("no secret store in this profile: the key pause cannot be staged");
      return;
    }
    // No key: the resumed run pauses at its first check and asks.
    secrets.has = (id) =>
      id === `llm.${active}`
        ? Promise.resolve(false)
        : patchedHas.call(secrets, id);
    let win: ReportWindow | undefined;
    try {
      const record = await graph.jobs.enqueue(
        "trendReport",
        {
          libraryID: collection.libraryID,
          collectionKey: collection.key,
          language: "en",
        },
        { priority: "normal", inputVersion: TREND_REPORT_INPUT_VERSION },
      );
      await graph.jobs.writeCheckpoint(record.id, {
        version: 1,
        stage: "Screening",
        choice: { fullTextMode: "never", costGateBlocksFullText: false },
        spend: [],
      });
      const runner = graph.resumedReports as ResumedJobRunner;
      runner.run(record.id);
      let surface: ReturnType<ResumedJobRunner["surfaceOf"]>;
      await waitUntil(() => {
        surface = runner.surfaceOf(record.id);
        return surface?.pending !== undefined;
      }, "the resumed run's question to wait");
      assert.strictEqual(surface?.pending?.reason, "credential-required");
      assert.strictEqual(
        (await graph.jobs.get(record.id))?.status,
        "paused",
        "stays paused with no window; not answered 'stop'",
      );

      win = await openWindow(collection.id);
      await waitUntil(
        () =>
          textOf(win as Window, "rh-report-question-text").includes("API key"),
        "the window to ask the pending question",
      );
      assert.isFalse(
        isDisabled(win, "rh-report-cancel"),
        "the attached run can be cancelled",
      );
      secrets.has = patchedHas; // the user added the key
      press(win, "rh-report-yes");
      await waitForOutcome(win, "Report ready");
      assert.strictEqual(
        (await graph.jobs.get(record.id))?.status,
        "succeeded",
      );
      assert.strictEqual(
        runner.find(collection.libraryID, collection.key),
        undefined,
      );
    } finally {
      secrets.has = patchedHas;
      win?.close();
    }
  });
});

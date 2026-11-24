/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and reads the platform's own memory reporter; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P7-T15`, item 401(a) — `NFR-7`'s two workload memory figures and
 * `docs/13` §8.8's growth line, measured in the test profile.
 *
 * > **DECIDED 2026-11-18 (owner, plan/00 §6 item 401(a)): "만듦".** Build the
 * > measurement with a fake provider: no network, no key, no spend. The figures
 * > it logs are **test-profile figures only**; the owner's run on a copy of a
 * > large library (`G-34`) stays the owner's.
 *
 * **What is real, and what is a double.** As in `offline.spec.ts`: the plugin
 * instance and its service graph, the summarize and report windows, the job
 * queue, the plugin database, both pipelines, Zotero's items, attachments and
 * full-text reader are real. **Only the language model is doubled**:
 * `registry.get` answers the active provider with a fake that answers from
 * this file and sends nothing, and `secrets.has` answers `true` for its key,
 * which exists nowhere. No key is read or written. No item has a DOI, so the
 * summary's full-text ladder asks Europe PMC for nothing.
 *
 * **The reading.** `nsIMemoryReporterManager`'s `heapAllocated` (jemalloc's
 * heap) plus `JSMainRuntimeGCHeap` (the JS garbage-collected heap, which
 * jemalloc does not count), with `resident` beside it. *Measured 2026-11-18
 * on Zotero 10.0.3: the manager has no `explicit` attribute (it reads
 * `undefined`), which `docs/spikes/phase-7-profiling.md` §3's first reading
 * assumed; the `explicit/` reports' sum (`getReports`, what `about:memory`
 * adds) takes about two seconds, so it is logged beside each idle reading and
 * not sampled.* An **idle** reading is taken after
 * `minimizeMemoryUsage` (Gecko's own "Minimize memory usage": repeated
 * garbage and cycle collection) and a settle, as the median of three. During a
 * job a sampler reads both figures every {@link SAMPLE_MS} ms; the job's
 * figure is its **peak minus the idle reading before it**. Garbage the job
 * leaves before a collection runs counts in the peak, as it does for a user.
 *
 * **What it measures.**
 *
 * 1. **The reference workload** (`NFR-5`'s and `NFR-7`'s: 100 abstracts
 *    summarized, then one trend report over those 100 summaries), run five
 *    times on five collections of 100 synthetic items, all made before the
 *    first idle reading. Job 1's peak is `NFR-7`'s 150 MB row; the idle
 *    reading after job 5 minus the one before job 1 is §8.8's growth line.
 * 2. **A 500-item full-text job**: Summarize All Papers in Collection over 500
 *    synthetic items, each with an abstract and an attached plain-text file of
 *    about {@link FULL_TEXT_CHARS} characters, read as Tier 2 text. Its peak is
 *    `NFR-7`'s 400 MB row.
 * 3. **`P7-T39`** (owner, `plan/00` §6 item 403(a)): a closed summarize or
 *    report window leaves the plugin's hold as it closes (`heldCount`), and
 *    every window the reference workload closed is freed, in a run where a
 *    closed window can be freed at all (`windowsCanBeFreed`).
 * 4. **`P7-T40`** (owner, item 403(e)): an acquired paper keeps one compact
 *    copy of its text, measured as the strings fifty held acquisitions add.
 * 5. **Item 405(c)** (owner): §8.8's growth line is read as "no plugin window
 *    or plugin realm grows across five jobs" (`isPluginGroup`), asserted in a
 *    run without the debugger and logged in every run, with the whole-process
 *    growth beside it.
 * 6. **`P7-T41`** (owner, item 405(a)): the 500-item job's longest sampler
 *    gap, against the card's 1 s, logged.
 *
 * *Added 2026-11-18 (item 405(b)):* the log's first line says whether the run
 * has the debugger; `RH_DEVTOOLS=off npm run test:integration` runs without it.
 *
 * *Changed 2026-11-18 (item 403(e)):* the budgets are MB (10⁶ bytes), not
 * MiB; each budget clause gives the peak in MB.
 *
 * Each figure is logged with the `[P7-T15 memory]` prefix and **is not
 * asserted against its budget**: `P7-T15`'s Do step 2 makes a figure over
 * budget a finding, recorded beside its budget, not a failing run. What is
 * asserted is that the measurement happened: the reporter answered, the
 * sampler ran during each job, and each job did the work it is the figure
 * for (every paper summarized, from full text where it should be, and the
 * report ready).
 *
 * **What these figures are not.** The test profile holds a few hundred items,
 * a fake model answers in microseconds, and the process's whole increment is
 * counted, Zotero's share of a job included. They say nothing about a large
 * library; that is `G-34`'s run (`docs/spikes/phase-7-profiling.md` §3.1).
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMProvider,
} from "../../src/llm/types";
import {
  PAPER_SUMMARY_SCHEMA_VERSION,
  type PaperSummary,
} from "../../src/model/summary";
import { acquireZoteroSource } from "../../src/pipeline/summarize/acquire";
import { expectedHeadings } from "../../src/pipeline/trendReport/compose";
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
  isAbove(value: number, floor: number, message?: string): void;
  isBelow(value: number, ceiling: number, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const SETUP_TIMEOUT_MS = 600_000;
const JOB_TIMEOUT_MS = 1_200_000;
const STEP_TIMEOUT_MS = 600_000;
const TAG = `p7t15m-${String(Date.now())}`;
/** The reference workload's size (`NFR-5`, `NFR-7`). */
const REFERENCE_PAPERS = 100;
/** `docs/13` §8.8: "no memory growth after 5 consecutive jobs". */
const CONSECUTIVE_JOBS = 5;
/** `NFR-7`'s full-text job. */
const FULL_TEXT_PAPERS = 500;
/** About a journal article's length of body text, per attachment. */
const FULL_TEXT_CHARS = 40_000;
/** How often the sampler reads the reporter during a job. */
const SAMPLE_MS = 100;
/** The pause after `minimizeMemoryUsage` before an idle reading. */
const SETTLE_MS = 2_000;
const MIB = 1_048_576;
/**
 * `NFR-7`'s budgets are in MB, 10⁶ bytes (owner, `plan/00` §6 item 403(e):
 * "MB, not MiB"). The figures beside them stay in MiB, as `about:memory`
 * gives them; each budget clause gives the peak in MB too.
 */
const MB = 1_000_000;
const BUDGET_REFERENCE_MB = 150;
const BUDGET_FULL_TEXT_MB = 400;
const USAGE = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  costUsd: 0.001,
};
const QUOTE =
  "The synthetic intervention reduced the synthetic outcome by 42 percent.";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function log(line: string): void {
  debug(`[P7-T15 memory] ${line}`);
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
    await delay(50);
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

function textOf(win: Window, id: string): string {
  return (win.document.getElementById(id)?.textContent ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function argsOf(element: Element | null): Record<string, unknown> {
  const raw = element?.getAttribute("data-l10n-args");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function mib(bytes: number): string {
  return (bytes / MIB).toFixed(1);
}

/** A peak against an `NFR-7` budget, in MB: "budget 400 MB: 287.3 MB, within". */
function budgetClause(peak: number, budgetMb: number): string {
  return (
    `budget ${String(budgetMb)} MB: ${(peak / MB).toFixed(1)} MB, ` +
    (peak <= budgetMb * MB ? "within" : "OVER")
  );
}

/* ------------------------------------------------------- the reporter */

interface MemoryReporter {
  /** jemalloc's allocated heap, in bytes. */
  readonly heapAllocated: number;
  /** The main JS runtime's garbage-collected heap, in bytes. */
  readonly JSMainRuntimeGCHeap: number;
  readonly resident: number;
  /** Windows closed but still held in memory (`about:memory`'s ghost windows). */
  readonly ghostWindows: number;
  minimizeMemoryUsage(callback: () => void): void;
  getReports(
    handle: (
      process: string,
      path: string,
      kind: number,
      units: number,
      amount: number,
    ) => void,
    handleData: null,
    finish: () => void,
    finishData: null,
    anonymize: boolean,
  ): void;
}

/** `nsIMemoryReporter.UNITS_BYTES`. */
const UNITS_BYTES = 0;

function reporter(): MemoryReporter {
  return (
    Cc["@mozilla.org/memory-reporter-manager;1"] as unknown as {
      getService(iface: unknown): MemoryReporter;
    }
  ).getService(
    (Ci as unknown as Record<string, unknown>)["nsIMemoryReporterManager"],
  );
}

interface Reading {
  /** `heapAllocated + JSMainRuntimeGCHeap`: the two cheap heap figures. */
  readonly heap: number;
  readonly resident: number;
}

function read(): Reading {
  const r = reporter();
  return {
    heap: r.heapAllocated + r.JSMainRuntimeGCHeap,
    resident: r.resident,
  };
}

/**
 * The sum of every `explicit/` report in bytes, as `about:memory` adds it:
 * the figure the cheap {@link read} stands in for. About two seconds, so it
 * is taken at idle readings only.
 */
async function explicitReports(): Promise<Map<string, number>> {
  const byPrefix = new Map<string, number>();
  await new Promise<void>((resolve) => {
    reporter().getReports(
      (_process, path, _kind, units, amount) => {
        if (path.startsWith("explicit/") && units === UNITS_BYTES) {
          const prefix = pathPrefix(path, REPORT_DEPTH);
          byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + amount);
        }
      },
      null,
      () => resolve(),
      null,
      false,
    );
  });
  return byPrefix;
}

/** How many path segments a report is grouped by, for the growth line. */
const REPORT_DEPTH = 3;

/** A report path's first `depth` segments; a `/` inside `( )` does not split. */
function segmentsOf(path: string): string[] {
  const segments: string[] = [];
  let level = 0;
  let start = 0;
  for (let i = 0; i < path.length; i += 1) {
    const c = path[i];
    if (c === "(") level += 1;
    else if (c === ")") level -= 1;
    else if (c === "/" && level === 0) {
      segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(path.slice(start));
  return segments;
}

/** Addresses and window ids differ from run to run; the group is the same. */
function withoutAddresses(segment: string): string {
  return segment.replace(/0x[0-9a-f]+/giu, "0x…").replace(/, id=\d+/gu, "");
}

/**
 * The group a report counts in: its first `depth` segments, except that a
 * JS zone's report is grouped by its realm (the global it belongs to: a
 * Zotero module, the plugin's scope, a window), and a window's report by the
 * next two levels (whether it is a detached window, and which). That is where
 * a growth line can say whose memory grew.
 */
function pathPrefix(path: string, depth: number): string {
  const segments = segmentsOf(path);
  if (segments[1] === "js-non-window" && segments[2] === "zones") {
    const realm = segments.find((s) => s.startsWith("realm("));
    return `explicit/js-non-window/zones/${withoutAddresses(realm ?? segments[4] ?? "")}`;
  }
  if (segments[1] === "window-objects") {
    return segments.slice(0, 5).map(withoutAddresses).join("/");
  }
  return segments.slice(0, depth).join("/");
}

function sumOf(reports: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const amount of reports.values()) sum += amount;
  return sum;
}

/** The groups that grew most between two idle readings, largest first. */
function largestGrowth(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  count: number,
): string {
  const growth: [string, number][] = [];
  for (const [prefix, amount] of after) {
    growth.push([prefix, amount - (before.get(prefix) ?? 0)]);
  }
  return growth
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([prefix, amount]) => `${prefix.slice(0, 160)} +${mib(amount)}`)
    .join("; ");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** Gecko's "Minimize memory usage", then a settle, then the median of three. */
interface IdleReading extends Reading {
  /** The `explicit/` reports, grouped by their first {@link REPORT_DEPTH} segments. */
  readonly reports: ReadonlyMap<string, number>;
}

async function idleReading(what: string): Promise<IdleReading> {
  await new Promise<void>((resolve) => {
    reporter().minimizeMemoryUsage(() => resolve());
  });
  await delay(SETTLE_MS);
  const readings: Reading[] = [];
  for (let i = 0; i < 3; i += 1) {
    readings.push(read());
    await delay(500);
  }
  const reports = await explicitReports();
  const idle = {
    heap: median(readings.map((r) => r.heap)),
    resident: median(readings.map((r) => r.resident)),
    reports,
  };
  // The reports' sum has no `heap-unclassified`: `about:memory` derives that
  // line itself, from `heapAllocated`, and no reporter sends it.
  log(
    `idle ${what}: heap ${mib(idle.heap)} MiB, resident ` +
      `${mib(idle.resident)} MiB (median of ${String(readings.length)}); ` +
      `explicit/ reports' sum ${mib(sumOf(reports))} MiB; ghost windows ` +
      String(reporter().ghostWindows),
  );
  return idle;
}

/** Reads the reporter every {@link SAMPLE_MS} ms until stopped. */
/** A gap between two samples this long is listed, with where the job was. */
const LONG_GAP_MS = 1_000;

/**
 * What the job is doing, for the long-gap list: the test sets it as it opens
 * each window. A gap is the main thread busy with something that did not
 * yield, so a long one is also an `NFR-3` observation.
 */
let whereNow: () => string = () => "-";

function startSampler(): {
  stop(): {
    peak: Reading;
    samples: number;
    longestGapMs: number;
    readCostMs: number;
    longGaps: string;
  };
} {
  const startedAt = Date.now();
  let peak = read();
  let samples = 1;
  let last = startedAt;
  let lastWhere = whereNow();
  let longestGapMs = 0;
  let readCostMs = 0;
  const longGaps: string[] = [];
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - last;
    longestGapMs = Math.max(longestGapMs, gap);
    const where = whereNow();
    if (gap >= LONG_GAP_MS) {
      longGaps.push(
        `${String(gap)} ms ending at +${String(now - startedAt)} ms ` +
          `(before: ${lastWhere}; after: ${where})`,
      );
    }
    last = now;
    lastWhere = where;
    const reading = read();
    readCostMs = Math.max(readCostMs, Date.now() - now);
    samples += 1;
    peak = {
      heap: Math.max(peak.heap, reading.heap),
      resident: Math.max(peak.resident, reading.resident),
    };
  }, SAMPLE_MS);
  return {
    stop() {
      clearInterval(timer);
      const reading = read();
      samples += 1;
      peak = {
        heap: Math.max(peak.heap, reading.heap),
        resident: Math.max(peak.resident, reading.resident),
      };
      return {
        peak,
        samples,
        longestGapMs,
        readCostMs,
        longGaps: longGaps.length > 0 ? longGaps.join("; ") : "none",
      };
    },
  };
}

/** The summarize window's progress line and how many rows it has drawn. */
function summarizeWhere(win: Window): () => string {
  return () =>
    win.closed
      ? "summarize window closed"
      : `summarize "${textOf(win, "rh-summarize-progress").slice(0, 80)}", ` +
        `${String(win.document.querySelectorAll("#rh-summarize-rows p").length)} rows, ` +
        `${String(costDialogs().length)} cost dialog(s)`;
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

/** How many calls the fake answered: a job's work, read by the tests. */
const model = { calls: 0 };

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
    chat: (request): Promise<ChatResponse> => {
      model.calls += 1;
      return Promise.resolve(chatResponse(answerTo(request), { usage: USAGE }));
    },
    chatStream: async function* (
      request: ChatRequest,
    ): AsyncIterable<ChatStreamChunk> {
      model.calls += 1;
      await Promise.resolve();
      yield { deltaText: answerTo(request), done: false };
      yield { deltaText: "", done: true, usage: USAGE };
    },
    countTokens: (text) => Math.ceil(text.length / 4),
  };
}

/* ------------------------------------------------------- the cost dialog */

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

interface Checkbox {
  hidden: boolean;
  checked: boolean;
}

/**
 * Accept every cost dialog that opens until `done()`, as a user would, with
 * the full-text plan kept: an abstract-only box that is shown is cleared, so
 * the full-text job stays one.
 */
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
      const downgrade = doc.getElementById(
        "rh-cost-downgrade",
      ) as Checkbox | null;
      if (downgrade !== null && !downgrade.hidden && downgrade.checked) {
        downgrade.checked = false;
        log("cost dialog: the abstract-only box was ticked; cleared");
      }
      const acknowledge = doc.getElementById(
        "rh-cost-acknowledge",
      ) as Checkbox | null;
      if (acknowledge !== null && !acknowledge.hidden) {
        acknowledge.checked = true;
      }
      shown.RHCostDialog?.updateAccept();
      remember("a cost dialog", shown);
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

interface SummarizeOutcome {
  readonly done: number;
  readonly total: number;
  readonly failed: number;
  readonly counts: Record<string, unknown>;
  readonly text: string;
}

async function runSummarize(win: SummarizeWindow): Promise<SummarizeOutcome> {
  const controller = win.RHSummarizeWindow;
  if (!controller) assert.fail("the window loaded without RHSummarizeWindow");
  controller.start();
  await acceptCostDialogsUntil(() => !controller.state.running);
  await waitUntil(
    () => textOf(win, "rh-summarize-outcome").length > 0,
    "the summarize outcome to be drawn",
  );
  const args = argsOf(win.document.getElementById("rh-summarize-outcome"));
  return {
    done: Number(args.done),
    total: Number(args.total),
    failed: Number(args.failed),
    counts: argsOf(win.document.getElementById("rh-summarize-counts")),
    text: textOf(win, "rh-summarize-outcome"),
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

async function closeWindow(win: Window): Promise<void> {
  win.close();
  await waitUntil(() => win.closed, "a window to close");
  await delay(250);
}

/* ------------------------------------------- closed windows (P7-T39) */

/** Each plugin window the reference workload closed, held weakly (`P7-T39`). */
const closedWindows: {
  readonly what: string;
  readonly doc: WeakRef<Document>;
}[] = [];

function remember(what: string, win: Window): void {
  closedWindows.push({ what, doc: new WeakRef(win.document) });
}

/** The two commands' {@link heldCount}s: handles the plugin still holds. */
function heldCounts(): { summarize: number; report: number } {
  const api = pluginInstance()?.api;
  if (!api?.summarizeWindow || !api.reportWindow) {
    assert.fail("registerUI() published no window commands");
  }
  return {
    summarize: api.summarizeWindow.heldCount(),
    report: api.reportWindow.heldCount(),
  };
}

/**
 * *Measured 2026-11-18 (`plan/reports/P7-T39.md`):* with the run's
 * `--jsdebugger` (`server.devtools`, which test runs inherit) every closed
 * chrome window stayed alive after Gecko's "Minimize memory usage", a bare
 * one with no script included; without it every one could be freed. So the
 * closed plugin windows are asserted freed only in a run where at least one
 * of them was: the cost dialogs, which the plugin never held, are freed in
 * such a run. A blank `about:blank` window is no control: it stayed alive in
 * a run without the debugger.
 */
function windowsCanBeFreed(): boolean {
  return closedWindows.some((one) => one.doc.deref() === undefined);
}

/**
 * Whether this run started Zotero with `--jsdebugger`: the
 * `researchHelper.test.devtools` preference `zotero-plugin.config.ts` writes
 * into the test profile (`RH_DEVTOOLS=off` turns the debugger off; owner,
 * `plan/00` §6 item 405(b)). `undefined` when the preference is absent, as on
 * a profile configured before 2026-11-18.
 */
function runHasDebugger(): boolean | undefined {
  const name = "researchHelper.test.devtools";
  return Services.prefs.getPrefType(name) === Services.prefs.PREF_BOOL
    ? Services.prefs.getBoolPref(name)
    : undefined;
}

/* ------------------------------------- the plugin's own groups (405(c)) */

/**
 * A grouped `explicit/` report that is the plugin's own: one of its windows
 * (`chrome://research-helper/…`) or a realm of its code (the build under
 * `research_helper/.scaffold/build`). Owner, `plan/00` §6 item 405(c):
 * `docs/13` §8.8's growth line reads "no plugin window or plugin realm grows
 * across five jobs", with the whole-process figure recorded beside it.
 */
const PLUGIN_GROUP = /research[-_]helper|researchHelper/iu;

function isPluginGroup(prefix: string): boolean {
  return (
    (prefix.startsWith("explicit/window-objects/") ||
      prefix.startsWith("explicit/js-non-window/zones/")) &&
    PLUGIN_GROUP.test(prefix)
  );
}

/**
 * How much a plugin group may grow across five jobs and still read as "does
 * not grow": measurement noise between two idle readings, not a held window
 * (a closed summarize window's group was 3.2 MiB, `plan/reports/P7-T39.md`).
 * DECIDED 2026-11-18 (coordinator, under item 313; `plan/00` §6 item 406(h)).
 */
const PLUGIN_GROUP_GROWTH_TOLERANCE = 1 * MIB;

/** Each plugin group's growth between two idle readings, largest first. */
function pluginGrowth(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): [string, number][] {
  const prefixes = new Set(
    [...before.keys(), ...after.keys()].filter(isPluginGroup),
  );
  return [...prefixes]
    .map((prefix): [string, number] => [
      prefix,
      (after.get(prefix) ?? 0) - (before.get(prefix) ?? 0),
    ])
    .sort((a, b) => b[1] - a[1]);
}

/* ------------------------------------------------------- the library */

const BACKGROUND = [
  "Synthetic background sentence about the synthetic study.",
  "The cohort was followed for a period of twelve months.",
  "Outcomes were measured at the start and at the end of the study.",
  "Participants were assigned to one of two groups by a computer.",
  "The analysis adjusted for age and for the baseline measurement.",
  "Results were consistent across every site that took part.",
];

function abstractFor(label: string): string {
  return `${QUOTE} This record is ${label}. ${BACKGROUND.join(" ")}`;
}

/** A plain-text article body of about {@link FULL_TEXT_CHARS} characters. */
function bodyFor(label: string, abstract: string): string {
  const sections = ["Introduction", "Methods", "Results", "Discussion"];
  const parts: string[] = [`Abstract\n\n${abstract}\n`];
  let length = parts[0]?.length ?? 0;
  let n = 0;
  while (length < FULL_TEXT_CHARS) {
    const section = sections[
      Math.min(3, Math.floor((4 * length) / FULL_TEXT_CHARS))
    ] as string;
    if (!parts.some((part) => part.startsWith(`${section}\n`))) {
      parts.push(`${section}\n`);
    }
    const sentence = `${BACKGROUND[n % BACKGROUND.length] as string} Paragraph ${String(n)} of ${label}.`;
    parts.push(`${sentence}\n`);
    length += sentence.length + 1;
    n += 1;
  }
  return parts.join("\n");
}

async function makeCollection(
  name: string,
  papers: number,
  withText: boolean,
  tempFiles: string[],
): Promise<Zotero.Collection> {
  const collection = new Zotero.Collection({
    libraryID: Zotero.Libraries.userLibraryID,
    name,
  });
  await collection.saveTx();
  // No DOI: a summary's full-text ladder asks Europe PMC by DOI, and this
  // spec doubles no service, so a paper without one sends nothing to it.
  for (let i = 1; i <= papers; i += 1) {
    const label = `${name} paper ${String(i)}`;
    const abstract = abstractFor(label);
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", label);
    item.setField("abstractNote", abstract);
    item.setField("date", "2024");
    item.setCollections([collection.id]);
    await item.saveTx();
    if (withText) {
      const path = PathUtils.join(
        Zotero.getTempDirectory().path,
        `rh-${TAG}-${String(i)}.txt`,
      );
      await IOUtils.writeUTF8(path, bodyFor(label, abstract));
      tempFiles.push(path);
      await Zotero.Attachments.importFromFile({
        file: path,
        parentItemID: item.id,
        contentType: "text/plain",
      });
    }
  }
  return collection;
}

async function eraseCollection(collection: Zotero.Collection): Promise<void> {
  const children = collection.getChildItems(false, true);
  for (const child of children) {
    if (!child.deleted) await child.eraseTx();
  }
  await collection.eraseTx();
}

/* -------------------------------------------------------------- the spec */

describe("P7-T15 (item 401(a)): NFR-7's workload memory in the test profile", function () {
  let locale: UILocaleSnapshot | undefined;
  const restores: (() => void)[] = [];
  const collections: Zotero.Collection[] = [];
  const tempFiles: string[] = [];

  before(async function () {
    this.timeout(SETUP_TIMEOUT_MS);
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      "the plugin to initialize",
    );
    const first = read();
    log(
      `reporter answers: heap ${mib(first.heap)} MiB, resident ` +
        `${mib(first.resident)} MiB`,
    );
    assert.isAbove(first.heap, 0, "the reporter gives a heap figure");
    assert.isAbove(first.resident, 0, "the reporter gives a resident figure");
    log(
      `this run: Zotero ${Services.appinfo.version}; debugger (--jsdebugger) ` +
        `${String(runHasDebugger() ?? "unknown")} (researchHelper.test.devtools; ` +
        `RH_DEVTOOLS=off turns it off, item 405(b))`,
    );
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
    // The session ceiling is turned off for the block: the fake's usage is
    // US$0.001 a call, and these jobs make over a thousand calls in one
    // session, after the rest of the suite.
    for (const [name, value] of [
      [`${active}.keyPresent`, true],
      ["reportModel", "p7t15m-report-model"],
      ["summaryModel", "p7t15m-summary-model"],
      ["runMaxSessionSpendCents", 0],
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
    this.timeout(SETUP_TIMEOUT_MS);
    for (const dialog of costDialogs()) dialog.close();
    for (const restore of restores.reverse()) restore();
    for (const collection of collections) await eraseCollection(collection);
    for (const path of tempFiles) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
    if (locale !== undefined) await restoreUILocale(locale, log);
  });

  it("P7-T39: a closed summarize or report window leaves the plugin's hold as it closes; one opened again stays held", async function () {
    this.timeout(STEP_TIMEOUT_MS);
    const api = pluginInstance()?.api;
    if (!api?.summarizeWindow || !api.reportWindow) {
      assert.fail("registerUI() published no window commands");
    }
    assert.deepEqual(heldCounts(), { summarize: 0, report: 0 });
    // A collection id no library holds, as `lifecycle.spec.ts` uses: the
    // windows open and draw their header, and no job starts.
    const id = 2_000_000_039;
    const main = Zotero.getMainWindow();
    const loaded = async (win: Window, what: string): Promise<void> => {
      await waitUntil(
        () => win.document?.readyState === "complete",
        `the ${what} to load`,
      );
      await delay(300);
    };
    const summarize = api.summarizeWindow.open(main, id) as unknown as Window;
    await loaded(summarize, "summarize window");
    const firstDoc = summarize.document;
    // The same collection again: the named window loads its document again,
    // and the first document's unload must not drop the handle.
    const again = api.summarizeWindow.open(main, id) as unknown as Window;
    assert.strictEqual(again, summarize, "the named window is reused");
    await waitUntil(
      () => summarize.document !== firstDoc,
      "the summarize window to load again",
    );
    await loaded(summarize, "summarize window");
    assert.strictEqual(
      heldCounts().summarize,
      1,
      "the reopened window is held",
    );
    assert.strictEqual(api.summarizeWindow.openCount(), 1);
    const report = api.reportWindow.open(main, id) as unknown as Window;
    await loaded(report, "report window");
    assert.strictEqual(heldCounts().report, 1, "the report window is held");
    await closeWindow(summarize);
    await closeWindow(report);
    await waitUntil(
      () => heldCounts().summarize === 0 && heldCounts().report === 0,
      "both closed windows to leave the plugin's hold",
    );
    assert.strictEqual(api.summarizeWindow.openCount(), 0);
    assert.strictEqual(api.reportWindow.openCount(), 0);
  });

  it("P7-T40: an acquired paper keeps one compact copy of its text", async function () {
    this.timeout(STEP_TIMEOUT_MS);
    const collection = await makeCollection(
      `${TAG} compact`,
      1,
      true,
      tempFiles,
    );
    collections.push(collection);
    const item = collection.getChildItems(false, false)[0];
    if (item === undefined) assert.fail("the item was not made");
    const options = {
      estimateTokens: (text: string) => Math.ceil(text.length / 4),
      includeFullText: true,
      tryEuropePmc: false,
    };
    const first = await acquireZoteroSource(item, options);
    assert.strictEqual(first.tier, "fulltext_pdf", "Tier 2 read the text");
    assert.isAbove(first.sections.length, 1, "the sections were found");
    const strings = async (): Promise<number> => {
      const cu = Cu as unknown as { forceGC(): void; forceCC(): void };
      cu.forceGC();
      cu.forceCC();
      cu.forceGC();
      let total = 0;
      await new Promise<void>((resolve) => {
        reporter().getReports(
          (_process, path, _kind, units, amount) => {
            if (
              units === UNITS_BYTES &&
              path.startsWith("explicit/") &&
              /\/strings(\/|$)/u.test(path)
            ) {
              total += amount;
            }
          },
          null,
          () => resolve(),
          null,
          false,
        );
      });
      return total;
    };
    // Three rounds of 50, every result held to the end, and the least round
    // is the paper's figure: a string the rest of Zotero makes during one
    // round adds to that round only, while a second copy of the text adds to
    // every round. Batch I, 2026-11-24 (`plan/reports/P7-batchI.md` §2): one
    // run with the debugger read 280.7 KiB a paper from a single round, two
    // others 68.6 and 69.2 KiB, and the breakdown probe held about 41.5 KB a
    // paper, 40,960 bytes of it the one Latin-1 copy. DECIDED 2026-11-24 (coordinator, under item 313;
    // plan/00 §6 item 410).
    const copies = 50;
    const roundsOf = 3;
    const held: unknown[] = [];
    const rounds: number[] = [];
    for (let round = 0; round < roundsOf; round += 1) {
      const before = await strings();
      for (let i = 0; i < copies; i += 1) {
        held.push(await acquireZoteroSource(item, options));
      }
      rounds.push(((await strings()) - before) / copies);
    }
    const perPaper = Math.min(...rounds);
    log(
      `P7-T40: one acquired paper of ${String(first.text.length)} characters ` +
        `holds ${(perPaper / 1024).toFixed(1)} KiB of strings, the least of ` +
        `${String(roundsOf)} rounds (${rounds.map((one) => (one / 1024).toFixed(1)).join(", ")} KiB; ` +
        `${String(copies)} held a round; ${String(first.sections.length)} sections)`,
    );
    // Below one two-byte copy of the text. Before `P7-T40` a paper held two
    // two-byte copies with power-of-two capacity, about 6.4 bytes a
    // character. Measured 2026-11-18 (dev run, no debugger): 66,042 bytes for
    // 40,928 characters, about 1.6 a character; the part above one byte a
    // character is not yet explained (`plan/reports/P7-T40.md`). DECIDED
    // 2026-11-18 (coordinator, under item 313; `plan/00` §6 item 404(k)).
    assert.isBelow(
      perPaper,
      2 * first.text.length,
      "one compact copy of the paper is held",
    );
    assert.strictEqual(held.length, copies * roundsOf);
  });

  it("the reference workload (100 abstracts and one report), five times: each peak, and the growth across five jobs", async function () {
    this.timeout(JOB_TIMEOUT_MS);
    closedWindows.length = 0;
    const madeAt = Date.now();
    const jobs: Zotero.Collection[] = [];
    for (let j = 1; j <= CONSECUTIVE_JOBS; j += 1) {
      const collection = await makeCollection(
        `${TAG} reference ${String(j)}`,
        REFERENCE_PAPERS,
        false,
        tempFiles,
      );
      collections.push(collection);
      jobs.push(collection);
    }
    log(
      `made ${String(CONSECUTIVE_JOBS)} collections of ` +
        `${String(REFERENCE_PAPERS)} items in ${String(Date.now() - madeAt)} ms`,
    );
    const before = await idleReading("before job 1");
    const peaks: number[] = [];
    for (const [index, collection] of jobs.entries()) {
      const job = index + 1;
      const idle =
        job === 1 ? before : await idleReading(`before job ${String(job)}`);
      const callsBefore = model.calls;
      const startedAt = Date.now();
      whereNow = () => "opening the summarize window";
      const sampler = startSampler();
      const summarizeWin = await openSummarize(collection.id);
      whereNow = summarizeWhere(summarizeWin);
      const summarized = await runSummarize(summarizeWin);
      remember(`the summarize window of job ${String(job)}`, summarizeWin);
      await closeWindow(summarizeWin);
      whereNow = () => "the report window";
      const reportWin = await openReport(collection.id);
      const outcome = await runReport(reportWin);
      remember(`the report window of job ${String(job)}`, reportWin);
      await closeWindow(reportWin);
      // `P7-T39`: a closed window leaves the plugin's hold as it closes, not
      // at the next open.
      await waitUntil(
        () => heldCounts().summarize === 0 && heldCounts().report === 0,
        `job ${String(job)}: the closed windows to leave the plugin's hold`,
      );
      const sampled = sampler.stop();
      whereNow = () => "-";
      const peak = sampled.peak.heap - idle.heap;
      peaks.push(peak);
      log(
        `reference job ${String(job)}: ${String(Date.now() - startedAt)} ms, ` +
          `${String(model.calls - callsBefore)} model calls, summarize ` +
          `${String(summarized.done)}/${String(summarized.total)} done, ` +
          `${String(summarized.failed)} failed, counts ` +
          `${JSON.stringify(summarized.counts)}; report "${outcome}"`,
      );
      log(
        `reference job ${String(job)}: peak heap ${mib(sampled.peak.heap)} MiB, ` +
          `peak resident ${mib(sampled.peak.resident)} MiB; peak − idle: heap ` +
          `${mib(peak)} MiB, resident ${mib(sampled.peak.resident - idle.resident)} MiB ` +
          `(${budgetClause(peak, BUDGET_REFERENCE_MB)}); ` +
          `${String(sampled.samples)} samples, longest gap ` +
          `${String(sampled.longestGapMs)} ms, slowest read ` +
          `${String(sampled.readCostMs)} ms; gaps of ${String(LONG_GAP_MS)} ms or more: ` +
          sampled.longGaps,
      );
      assert.strictEqual(
        summarized.done,
        REFERENCE_PAPERS,
        `job ${String(job)}: every paper is summarized`,
      );
      assert.strictEqual(
        summarized.failed,
        0,
        `job ${String(job)}: none fails`,
      );
      assert.include(outcome, "Report ready", `job ${String(job)}: the report`);
      assert.isAbove(
        sampled.samples,
        2,
        `job ${String(job)}: the sampler ran during the job`,
      );
    }
    const afterJobs = await idleReading(
      `after job ${String(CONSECUTIVE_JOBS)}`,
    );
    const growth = afterJobs.heap - before.heap;
    log(
      `growth after ${String(CONSECUTIVE_JOBS)} consecutive jobs: heap ` +
        `${mib(growth)} MiB, resident ` +
        `${mib(afterJobs.resident - before.resident)} MiB, explicit/ reports ` +
        `${mib(sumOf(afterJobs.reports) - sumOf(before.reports))} MiB; ` +
        `peaks − idle (heap): ${peaks.map(mib).join(", ")} MiB`,
    );
    log(
      `growth after ${String(CONSECUTIVE_JOBS)} consecutive jobs, largest ` +
        `explicit/ groups (MiB): ${largestGrowth(before.reports, afterJobs.reports, 10)}`,
    );

    // Item 405(c) (owner): §8.8's line is "no plugin window or plugin realm
    // grows across five jobs"; the whole-process growth above is recorded
    // beside it. Asserted in a run without the debugger, which keeps every
    // closed window (item 405(b)); logged in every run.
    const plugin = pluginGrowth(before.reports, afterJobs.reports);
    const grown = plugin.filter(
      ([, amount]) => amount > PLUGIN_GROUP_GROWTH_TOLERANCE,
    );
    const debuggerOn = runHasDebugger() !== false;
    log(
      `growth after ${String(CONSECUTIVE_JOBS)} consecutive jobs, the plugin's ` +
        `own groups (item 405(c); tolerance ${mib(PLUGIN_GROUP_GROWTH_TOLERANCE)} MiB ` +
        `each): ${String(plugin.length)} group(s), ` +
        `${String(grown.length)} over the tolerance` +
        (plugin.length > 0
          ? `: ${plugin
              .map(
                ([prefix, amount]) =>
                  `${prefix.slice(0, 160)} ${amount >= 0 ? "+" : ""}${mib(amount)}`,
              )
              .join("; ")}`
          : "") +
        (debuggerOn
          ? "; the run has the debugger, so this is not asserted"
          : ""),
    );
    if (!debuggerOn) {
      assert.strictEqual(
        grown.map(([prefix]) => prefix).join("; "),
        "",
        "no plugin window or plugin realm grows across five jobs",
      );
    }

    // `P7-T39`: every window the five jobs closed is freed, in a run where
    // a closed window can be (`windowsCanBeFreed`).
    const freeable = windowsCanBeFreed();
    const alive = closedWindows
      .filter((one) => one.doc.deref() !== undefined)
      .map((one) => one.what);
    log(
      `closed windows (P7-T39): ${String(closedWindows.length)} closed, ` +
        `${String(alive.length)} still alive after the idle reading` +
        (freeable
          ? ""
          : "; none was freed, as with the run's --jsdebugger, so none is asserted") +
        (alive.length > 0 ? `: ${alive.join("; ")}` : ""),
    );
    assert.isAbove(
      closedWindows.length,
      2 * CONSECUTIVE_JOBS - 1,
      "every summarize and report window was tracked",
    );
    if (freeable) {
      assert.strictEqual(alive.join("; "), "", "every closed window is freed");
    }
  });

  it("a 500-item full-text summarize job: its peak", async function () {
    this.timeout(JOB_TIMEOUT_MS);
    const beforeItems = await idleReading(
      "before the 500 full-text items are made",
    );
    const madeAt = Date.now();
    const collection = await makeCollection(
      `${TAG} full text`,
      FULL_TEXT_PAPERS,
      true,
      tempFiles,
    );
    collections.push(collection);
    log(
      `made ${String(FULL_TEXT_PAPERS)} items, each with a plain-text ` +
        `attachment of about ${String(FULL_TEXT_CHARS)} characters, in ` +
        `${String(Date.now() - madeAt)} ms`,
    );
    const idle = await idleReading("before the full-text job");
    log(
      `making the 500 items (Zotero's work and the plugin's observers): heap ` +
        `${mib(idle.heap - beforeItems.heap)} MiB, explicit/ reports ` +
        `${mib(sumOf(idle.reports) - sumOf(beforeItems.reports))} MiB; largest ` +
        `groups (MiB): ${largestGrowth(beforeItems.reports, idle.reports, 10)}`,
    );
    const callsBefore = model.calls;
    const startedAt = Date.now();
    whereNow = () => "opening the summarize window";
    const sampler = startSampler();
    const win = await openSummarize(collection.id);
    whereNow = summarizeWhere(win);
    const summarized = await runSummarize(win);
    const fullTextWindow = new WeakRef(win.document);
    await closeWindow(win);
    const sampled = sampler.stop();
    whereNow = () => "-";
    const peak = sampled.peak.heap - idle.heap;
    log(
      `full-text job: ${String(Date.now() - startedAt)} ms, ` +
        `${String(model.calls - callsBefore)} model calls, summarize ` +
        `${String(summarized.done)}/${String(summarized.total)} done, ` +
        `${String(summarized.failed)} failed, counts ` +
        `${JSON.stringify(summarized.counts)}`,
    );
    log(
      `full-text job: peak heap ${mib(sampled.peak.heap)} MiB, peak ` +
        `resident ${mib(sampled.peak.resident)} MiB; peak − idle: heap ` +
        `${mib(peak)} MiB, resident ${mib(sampled.peak.resident - idle.resident)} MiB ` +
        `(${budgetClause(peak, BUDGET_FULL_TEXT_MB)}); ` +
        `${String(sampled.samples)} samples, longest gap ` +
        `${String(sampled.longestGapMs)} ms, slowest read ` +
        `${String(sampled.readCostMs)} ms; gaps of ${String(LONG_GAP_MS)} ms or more: ` +
        sampled.longGaps,
    );
    // `P7-T41` (owner, `plan/00` §6 item 405(a)): Done when this job shows no
    // sampler gap over 1 s. Logged, not asserted, like the budgets (item
    // 402(c)); DECIDED 2026-11-18 (coordinator, under item 313; item 406(f)).
    log(
      `P7-T41: the 500-item job's longest sampler gap ${String(sampled.longestGapMs)} ms ` +
        `(Done when: no gap over ${String(LONG_GAP_MS)} ms): ` +
        (sampled.longestGapMs <= LONG_GAP_MS ? "met" : "NOT MET"),
    );
    const afterJob = await idleReading("after the full-text job");
    log(
      `full-text job, idle after − idle before: heap ` +
        `${mib(afterJob.heap - idle.heap)} MiB; largest explicit/ groups (MiB): ` +
        largestGrowth(idle.reports, afterJob.reports, 10) +
        `; its summarize window is ${fullTextWindow.deref() === undefined ? "freed" : "still alive"}` +
        ` (P7-T39; logged, not asserted), held handles ${JSON.stringify(heldCounts())}`,
    );
    assert.strictEqual(
      summarized.done,
      FULL_TEXT_PAPERS,
      "every paper is summarized",
    );
    assert.strictEqual(summarized.failed, 0, "none fails");
    assert.strictEqual(
      Number(summarized.counts.fulltext),
      FULL_TEXT_PAPERS,
      "every summary used the attached full text",
    );
    assert.isAbove(sampled.samples, 2, "the sampler ran during the job");
  });
});

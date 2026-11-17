/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it doubles Zotero.HTTP.request and tees Zotero.debug, and there is no src/zotero/ facade for either from outside the plugin bundle. */
/**
 * `P7-T14` — the log-redaction audit of full jobs at `debug` level (`NFR-16`;
 * `docs/09` §7's `[BLOCKER]` "no key appears in `Zotero.debug` output at any log
 * level").
 *
 * **What runs.** A summarize job, a trend-report job and an audio job, each
 * through its own window and its cost dialogs, as a user starts them, with
 * `logLevel` set to `debug`. Then the diagnostics text (`P7-T13`) is built
 * through the preferences pane's host.
 *
 * **What is real, and what is a double.**
 *
 * - **Real:** the plugin instance and its service graph, every window and
 *   dialog, the job queue, the plugin database, the three pipelines, the
 *   **OpenRouter adapter** (it reads the key, builds the `Authorization`
 *   header and parses the answer), the **Gemini text-to-speech client** (it
 *   reads the key and sends it in `x-goog-api-key`), the HTTP client and its
 *   log lines, and the redacting logger with its ring.
 * - **Planted keys (coordinator decision, 2026-11-17, under `plan/00` §6 item
 *   313; the brief: "recorded test fixtures only").** `graph.secrets.get` and
 *   `.has` are patched **in memory** to answer one SYNTHETIC key per secret id,
 *   each of its provider's shape. The keystore is never read or written.
 * - **`Zotero.HTTP.request` is doubled** for the plugin's requests: nothing
 *   leaves the machine. OpenRouter's chat answers are built here from the
 *   request (`answerTo`, as `offline.spec.ts` builds them); the audio script is
 *   the committed `test/fixtures/llm/openrouter/audio-script-en.json` and each
 *   speech chunk is `test/fixtures/tts/gemini/tts-en-short.json`. Both
 *   sidecars say `"synthetic": true`: they are stand-ins, not recordings
 *   (`plan/09` `P6-T03`), and this spec reads and logs that.
 * - **The model metadata** (`getModel`, `listModels`) is the mock every
 *   model-driven spec uses, so no catalogue request is made. A streamed call
 *   is answered through the adapter's non-streamed `chat`, so it too goes
 *   through the real adapter and the real client.
 *
 * **What is captured.** Every argument passed to `Zotero.debug` and
 * `Zotero.logError` from the first job to the diagnostics text, by a tee that
 * forwards each call unchanged, and the diagnostics text. Each planted key, its
 * first eight characters, the first eight characters of its secret part, its
 * base64 form, and each credential header's value the double received are
 * searched for (the other headers carry no secret; see the search below).
 * Not captured: `Zotero.HTTP.request`'s own debug lines, because its request is
 * doubled; the double checks that no URL carries a key instead.
 *
 * **The plugin database (`P7-T37`; owner, 2026-11-17, `plan/00` §6 item
 * 395(f)).** After the three jobs and the diagnostics text, every table of the
 * plugin's own database is read from `sqlite_master`, so a table a later
 * migration adds is searched without an edit here: every text cell is read
 * and searched for the same values, and every blob cell is searched in SQL,
 * byte for byte (`instr` on the cell and the value, both as blobs). The
 * counts of tables, rows and cells searched are logged; no cell is.
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
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
import { COST_DIALOG_URL } from "../../src/ui/dialogs/costConfirmDialog";
import {
  PREFERENCES_API_PROPERTY,
  type PreferencesHostApi,
} from "../../src/ui/prefs/preferencesPane";
import { mockModel } from "../helpers/mockLLM";
import { repositoryFixtureDir } from "../support/fixtureIo.zotero";
import { isLiveRequest } from "./support/liveRequestGuard";
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
  isTrue(value: boolean, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TEST_TIMEOUT_MS = 300_000;
const STEP_TIMEOUT_MS = 90_000;
const TAG = `p7t14-${String(Date.now())}`;
const PAPERS = 6;
const QUOTE =
  "The synthetic intervention reduced the synthetic outcome by 42 percent.";
/** SYNTHETIC: longer than `summary.minAbstractChars`. */
const ABSTRACT = `${QUOTE} ${"Synthetic background sentence about the synthetic study. ".repeat(8)}`;
const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_HOST = "https://generativelanguage.googleapis.com/";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function log(line: string): void {
  debug(`[P7-T14] ${line}`);
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

function textOf(win: Window, id: string): string {
  return (win.document.getElementById(id)?.textContent ?? "").replace(
    /[⁨⁩]/gu,
    "",
  );
}

function isDisabled(win: Window, id: string): boolean {
  return (
    (win.document.getElementById(id) as unknown as { disabled: boolean })
      .disabled === true
  );
}

function randomPart(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

const HEX = "0123456789abcdef";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * SYNTHETIC keys, one per secret id, each of its provider's shape
 * (`docs/09` §2.1's patterns), with a random secret part per run. None is a
 * key anywhere.
 */
const PLANTED: Readonly<Record<string, { prefix: string; key: string }>> =
  Object.fromEntries(
    (
      [
        ["llm.openrouter", "sk-or-v1-", randomPart(64, HEX)],
        ["llm.openai", "sk-proj-", randomPart(48, ALNUM)],
        ["llm.anthropic", "sk-ant-api03-", randomPart(80, ALNUM)],
        ["llm.gemini", "AIza", randomPart(35, ALNUM)],
        ["tts.gemini", "AIza", randomPart(35, ALNUM)],
        ["source.ncbi", "", randomPart(36, HEX)],
        ["source.semanticscholar", "", randomPart(40, ALNUM)],
      ] as const
    ).map(([id, prefix, secret]) => [
      id,
      { prefix, key: `${prefix}${secret}` },
    ]),
  );

/* ------------------------------------------------------ the model answers */

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

/** The wire body the OpenRouter adapter sent, read back as the request it was. */
function requestOf(body: string): ChatRequest {
  const wire = JSON.parse(body) as {
    model: string;
    messages: { role: string; content: string }[];
    response_format?: { json_schema: { name: string; schema: object } };
  };
  return {
    model: wire.model,
    messages: wire.messages,
    ...(wire.response_format !== undefined && {
      responseFormat: {
        kind: "json_schema",
        name: wire.response_format.json_schema.name,
        schema: wire.response_format.json_schema.schema,
      },
    }),
  } as unknown as ChatRequest;
}

function chatCompletion(text: string, n: number): string {
  return JSON.stringify({
    id: `gen-p7t14-${String(n)}`,
    object: "chat.completion",
    model: "p7t14/synthetic-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
}

/* ----------------------------------------------------------- the double */

interface Recorded {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What the double saw and answered, read by the test. */
const wire: {
  /** `phase` is "audio" while the audio run is going: the script call is answered from its fixture. */
  phase: "text" | "audio";
  chat: number;
  speech: number;
  refused: string[];
  /** Every header value the double received, by name, for the search. */
  headerValues: Map<string, Set<string>>;
  urls: string[];
  script: Recorded | undefined;
  speechAnswer: Recorded | undefined;
  /** The text-to-speech model list, asked once after the confirmation (item 385). */
  models: Recorded | undefined;
  modelLists: number;
} = {
  phase: "text",
  chat: 0,
  speech: 0,
  refused: [],
  headerValues: new Map(),
  urls: [],
  script: undefined,
  speechAnswer: undefined,
  models: undefined,
  modelLists: 0,
};

function responseOf(url: string, answer: Recorded): unknown {
  const headerLines = Object.entries(answer.headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  return {
    status: answer.status,
    responseText: answer.body,
    response: answer.body,
    responseURL: url,
    getAllResponseHeaders: () => headerLines,
    getResponseHeader: (name: string) =>
      Object.entries(answer.headers).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      )?.[1] ?? null,
  };
}

function answer(method: string, url: string, body: string): Recorded {
  if (method === "POST" && url === OPENROUTER_CHAT) {
    wire.chat += 1;
    if (wire.phase === "audio" && wire.script !== undefined) {
      return wire.script;
    }
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: chatCompletion(answerTo(requestOf(body)), wire.chat),
    };
  }
  if (
    method === "POST" &&
    url.startsWith(GEMINI_HOST) &&
    url.endsWith(":generateContent") &&
    wire.speechAnswer !== undefined
  ) {
    wire.speech += 1;
    return wire.speechAnswer;
  }
  if (
    method === "GET" &&
    url.startsWith(`${GEMINI_HOST}v1beta/models`) &&
    !url.slice(GEMINI_HOST.length).includes(":") &&
    wire.models !== undefined
  ) {
    wire.modelLists += 1;
    return wire.models;
  }
  wire.refused.push(`${method} ${url}`);
  throw new Error(`[P7-T14] the double does not answer ${method} ${url}`);
}

/**
 * Put the double behind `Zotero.HTTP.request` for the plugin's requests (its
 * `User-Agent` names it); anything else goes on to the real method and the
 * suite's live-request guard.
 */
function doubleTheTransport(): () => void {
  const http = Zotero.HTTP as unknown as {
    request: (
      method: string,
      url: string,
      options?: {
        readonly body?: string;
        readonly headers?: Readonly<Record<string, string>>;
      },
    ) => unknown;
  };
  const real = http.request;
  http.request = (method, url, options) => {
    const headers = options?.headers ?? {};
    if (!isLiveRequest({ url, userAgent: headers["User-Agent"] })) {
      return real.call(http, method, url, options);
    }
    wire.urls.push(url);
    for (const [name, value] of Object.entries(headers)) {
      const values = wire.headerValues.get(name) ?? new Set<string>();
      values.add(value);
      wire.headerValues.set(name, values);
    }
    try {
      return Promise.resolve(
        responseOf(url, answer(method, url, options?.body ?? "")),
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  };
  return () => {
    http.request = real;
  };
}

/* ------------------------------------------------------------- the tee */

/** Every `Zotero.debug` and `Zotero.logError` argument while the tee is in. */
const captured: string[] = [];

function teeZoteroOutput(): () => void {
  const target = Zotero as unknown as {
    debug: (message: unknown, ...rest: unknown[]) => unknown;
    logError: (error: unknown, ...rest: unknown[]) => unknown;
  };
  const realDebug = target.debug;
  const realLogError = target.logError;
  target.debug = function (message: unknown, ...rest: unknown[]) {
    captured.push(
      typeof message === "string" ? message : String(message as string),
    );
    return realDebug.call(Zotero, message, ...rest);
  };
  target.logError = function (error: unknown, ...rest: unknown[]) {
    captured.push(
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
        : String(error as string),
    );
    return realLogError.call(Zotero, error, ...rest);
  };
  return () => {
    target.debug = realDebug;
    target.logError = realLogError;
  };
}

/* ------------------------------------------------------- the provider */

/**
 * The real OpenRouter adapter, with the model metadata mocked so no catalogue
 * request is made, and a streamed call answered through the adapter's own
 * `chat`: every call reaches the real adapter, the real client and the double.
 */
function auditProvider(real: LLMProvider): LLMProvider {
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
    chat: (request, ctx): Promise<ChatResponse> => real.chat(request, ctx),
    chatStream: async function* (
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      const response = await real.chat(request, ctx);
      yield { deltaText: response.text, done: false };
      yield {
        deltaText: "",
        done: true,
        ...(response.usage !== undefined && { usage: response.usage }),
      };
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
async function acceptCostDialogsUntil(
  done: () => boolean,
  status: () => string = () => "",
): Promise<number> {
  let accepted = 0;
  const start = Date.now();
  let lastReport = start;
  while (!done()) {
    if (Date.now() - lastReport > 15_000) {
      lastReport = Date.now();
      const open = costDialogs().map(
        (one) =>
          `initialized ${String(one.RHCostDialog?.state.initialized)} reported ${String(one.RHCostDialog?.state.reported)}: ${(one.document.documentElement?.textContent ?? "").replace(/s+/gu, " ").slice(0, 300)}`,
      );
      log(
        `waiting: ${String(open.length)} dialog(s) [${open.join(" | ")}]; chat ${String(wire.chat)}, speech ${String(wire.speech)}, refused ${String(wire.refused.length)}; ${status()}`,
      );
    }
    if (Date.now() - start > TEST_TIMEOUT_MS) {
      assert.fail("timed out accepting cost dialogs");
    }
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
      log(
        `accepted a dialog: ${(doc.documentElement?.textContent ?? "").replace(/s+/gu, " ").slice(0, 200)}`,
      );
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

/* -------------------------------------------------------------- the spec */

/* ---------------------------------------------------- the plugin database */

/** What {@link searchPluginDatabase} searched, and what it found. */
interface DatabaseSearch {
  readonly tables: number;
  readonly rows: number;
  readonly textCells: number;
  readonly blobCells: number;
  readonly hits: readonly string[];
}

/** Quotes a name read from `sqlite_master` or `table_info` (not input). */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * `P7-T37` (owner, item 395(f)): searches every cell of every table of the
 * plugin's database for each of `needles`. A text cell is read and searched
 * here; a blob cell is searched in SQL, so no blob is read into the log.
 * Zotero's rows are read by column name, so the columns come from
 * `table_info`.
 */
async function searchPluginDatabase(
  needles: ReadonlyMap<string, string>,
): Promise<DatabaseSearch> {
  const open = await graphOf().database.ready;
  if (open === undefined) assert.fail("the plugin database is not open");
  const connection = open.connection;
  const rowsOf = async (sql: string, params?: string[]) => {
    const result: unknown = await connection.queryAsync(sql, params);
    return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  };
  const names = (
    await rowsOf(
      // Zotero's query layer refuses a LIKE with a literal pattern, so it is bound.
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE ? ORDER BY name",
      ["sqlite_%"],
    )
  )
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string");
  let rows = 0;
  let textCells = 0;
  let blobCells = 0;
  const hits: string[] = [];
  for (const table of names) {
    const columns = (await rowsOf(`PRAGMA table_info(${quoted(table)})`))
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string");
    rows += Number(
      await connection.valueQueryAsync(`SELECT COUNT(*) FROM ${quoted(table)}`),
    );
    for (const column of columns) {
      const cells = await rowsOf(
        `SELECT ${quoted(column)} AS v FROM ${quoted(table)} WHERE typeof(${quoted(column)}) = 'text'`,
      );
      for (const cell of cells) {
        const value = cell.v;
        if (typeof value !== "string") continue;
        textCells += 1;
        for (const [what, needle] of needles) {
          if (needle.length > 0 && value.includes(needle)) {
            hits.push(`${what} in the plugin database, ${table}.${column}`);
          }
        }
      }
      const blobs = Number(
        await connection.valueQueryAsync(
          `SELECT COUNT(*) FROM ${quoted(table)} WHERE typeof(${quoted(column)}) = 'blob'`,
        ),
      );
      blobCells += blobs;
      if (blobs === 0) continue;
      for (const [what, needle] of needles) {
        if (needle.length === 0) continue;
        const found = Number(
          await connection.valueQueryAsync(
            `SELECT COUNT(*) FROM ${quoted(table)} WHERE typeof(${quoted(column)}) = 'blob' AND instr(${quoted(column)}, CAST(? AS BLOB)) > 0`,
            [needle],
          ),
        );
        if (found > 0) {
          hits.push(`${what} in the plugin database, blob ${table}.${column}`);
        }
      }
    }
  }
  return { tables: names.length, rows, textCells, blobCells, hits };
}

describe("P7-T14: no planted key in the debug output or the diagnostics text, across a summarize, a report and an audio job", function () {
  let locale: UILocaleSnapshot | undefined;
  let collection: Zotero.Collection | undefined;
  const made: Zotero.Item[] = [];
  /** The highest item id before this spec: every item above it is this spec's. */
  let lastIDBefore = 0;
  const restores: (() => void)[] = [];

  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await waitUntil(
      () => pluginInstance()?.data.initialized === true,
      "the plugin to initialize",
    );
    locale = await pinUILocale(["en-US"], log);
    const bundled = await import("../../src/prompts/bundled");
    headings = expectedHeadings(bundled.PROMPT_REGISTRY.get("TREND_REPORT_EN"));

    // The committed stand-ins, read once; each sidecar says it is one.
    const llm = await repositoryFixtureDir("llm");
    const tts = await repositoryFixtureDir("tts");
    const read = async (dir: string, name: string): Promise<Recorded> =>
      JSON.parse(await IOUtils.readUTF8(PathUtils.join(dir, name))) as Recorded;
    const synthetic = async (dir: string, name: string): Promise<boolean> =>
      (
        JSON.parse(await IOUtils.readUTF8(PathUtils.join(dir, name))) as {
          synthetic?: boolean;
        }
      ).synthetic === true;
    const openrouter = PathUtils.join(llm, "openrouter");
    const gemini = PathUtils.join(tts, "gemini");
    wire.script = await read(openrouter, "audio-script-en.json");
    wire.speechAnswer = await read(gemini, "tts-en-short.json");
    wire.models = await read(gemini, "models-list.json");
    log(
      `fixtures: audio-script-en synthetic ${String(await synthetic(openrouter, "audio-script-en_meta.json"))}, ` +
        `tts-en-short synthetic ${String(await synthetic(gemini, "tts-en-short_meta.json"))}, ` +
        `models-list synthetic ${String(await synthetic(gemini, "models-list_meta.json"))}`,
    );

    const graph = graphOf();
    await graph.database.ready;
    restores.push(doubleTheTransport());

    const registry = graph.llm.registry as Mutable<typeof graph.llm.registry>;
    const realGet = registry.get;
    const real = realGet.call(registry, "openrouter");
    if (!real) assert.fail("no OpenRouter adapter is registered");
    const audited = auditProvider(real);
    registry.get = (id) =>
      id === "openrouter" ? audited : realGet.call(registry, id);
    restores.push(() => {
      registry.get = realGet;
    });

    // The planted keys, in memory only: the keystore is never read or written.
    const secrets = graph.secrets as
      Mutable<NonNullable<typeof graph.secrets>> | undefined;
    if (secrets === undefined) assert.fail("the graph has no secret store");
    const realHas = secrets.has;
    const realGetKey = secrets.get;
    secrets.has = (id) => Promise.resolve(PLANTED[id] !== undefined);
    secrets.get = (id) => Promise.resolve(PLANTED[id]?.key);
    restores.push(() => {
      secrets.has = realHas;
      secrets.get = realGetKey;
    });

    for (const [name, value] of [
      ["llmProvider", "openrouter"],
      ["openrouter.keyPresent", true],
      ["gemini.keyPresent", true],
      ["reportModel", "p7t14/report-model"],
      ["summaryModel", "p7t14/summary-model"],
      ["audio.enabled", true],
      // One minute keeps the estimated WAV under the imported-file limit
      // (IMPORT_MAX_BYTES), so no folder picker is asked for a linked file.
      ["tts.targetMinutes", 1],
      ["logLevel", "debug"],
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

    lastIDBefore = Number(
      (await Zotero.DB.valueQueryAsync("SELECT MAX(itemID) FROM items")) ?? 0,
    );

    collection = new Zotero.Collection({
      libraryID: Zotero.Libraries.userLibraryID,
      name: `${TAG} audit`,
    });
    await collection.saveTx();
    for (let i = 1; i <= PAPERS; i += 1) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", `${TAG} paper ${String(i)}`);
      item.setField("abstractNote", ABSTRACT);
      item.setField("date", "2024");
      item.setCollections([collection.id]);
      await item.saveTx();
      made.push(item);
    }
  });

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    for (const dialog of costDialogs()) dialog.close();
    for (const restore of restores.reverse()) restore();
    // Every note and attachment the three jobs made (summary notes, the report
    // note, the audio attachment and its file), newest first, then the papers.
    const madeIDs = new Set(made.map((item) => item.id));
    const created = (await Zotero.DB.columnQueryAsync(
      "SELECT itemID FROM items WHERE itemID > ? ORDER BY itemID DESC",
      [lastIDBefore],
    )) as number[];
    for (const id of created) {
      if (madeIDs.has(Number(id))) continue;
      const item = Zotero.Items.get(Number(id));
      if (item !== false && !item.deleted) {
        // An imported attachment's file goes with it.
        await item.eraseTx();
      }
    }
    for (const one of made) await one.eraseTx();
    await collection?.eraseTx();
    if (locale !== undefined) await restoreUILocale(locale, log);
  });

  it("captures the three jobs at debug level and finds none of the planted keys, their prefixes, their base64 forms or the header values", async function () {
    this.timeout(TEST_TIMEOUT_MS * 2);
    const target = collection;
    if (target === undefined) assert.fail("no collection");
    const untee = teeZoteroOutput();
    restores.push(untee);
    let diagnostics: string;
    try {
      // 1. Summarize, through the window.
      const summarizeCommands = pluginInstance()?.api.summarizeWindow;
      if (!summarizeCommands) assert.fail("no api.summarizeWindow");
      const summarize = summarizeCommands.open(
        Zotero.getMainWindow(),
        target.id,
      ) as unknown as SummarizeWindow;
      await waitUntil(
        () =>
          summarize.document?.readyState === "complete" &&
          summarize.RHSummarizeWindow?.state.initialized === true,
        "the summarize window to initialize",
      );
      const writeNotes = summarize.document.getElementById(
        "rh-summarize-write-notes",
      ) as unknown as { checked: boolean; disabled: boolean } | null;
      if (writeNotes !== null && !writeNotes.disabled)
        writeNotes.checked = true;
      summarize.RHSummarizeWindow!.start();
      await acceptCostDialogsUntil(
        () => summarize.RHSummarizeWindow?.state.running === false,
      );
      await waitUntil(
        () => textOf(summarize, "rh-summarize-outcome").length > 0,
        "the summarize outcome",
      );
      const summarized = textOf(summarize, "rh-summarize-outcome");
      log(`summarize: "${summarized}"; ${String(wire.chat)} chat calls`);
      summarize.close();
      await waitUntil(() => summarize.closed, "the summarize window to close");
      assert.include(summarized, `${String(PAPERS)} of ${String(PAPERS)}`);
      const afterSummaries = wire.chat;
      assert.isAbove(
        afterSummaries,
        0,
        "the summaries went through the double",
      );

      // 2. The trend report, then 3. audio from it, in one report window.
      const reportCommands = pluginInstance()?.api.reportWindow;
      if (!reportCommands) assert.fail("no api.reportWindow");
      let report = reportCommands.open(
        Zotero.getMainWindow(),
        target.id,
      ) as unknown as ReportWindow;
      await waitUntil(
        () =>
          report.document?.readyState === "complete" &&
          report.RHReportWindow?.state.initialized === true,
        "the report window to initialize",
      );
      await report.RHReportWindow?.ready;
      (
        report.document.getElementById("rh-report-language") as unknown as {
          value: string;
        }
      ).value = "en";
      await waitUntil(
        () => !isDisabled(report, "rh-report-generate"),
        "Generate to be enabled",
      );
      (
        report.document.getElementById("rh-report-generate") as unknown as {
          doCommand(): void;
        }
      ).doCommand();
      await acceptCostDialogsUntil(
        () =>
          textOf(report, "rh-report-outcome").length > 0 &&
          !isDisabled(report, "rh-report-generate"),
      );
      const reported = textOf(report, "rh-report-outcome");
      log(
        `report: "${reported}"; ${String(wire.chat - afterSummaries)} chat calls`,
      );
      assert.include(reported, "Report ready");
      const afterReport = wire.chat;

      // The audio section reads the latest stored report when its window
      // opens, so the window is opened again on the report just made.
      report.close();
      await waitUntil(() => report.closed, "the report window to close");
      report = reportCommands.open(
        Zotero.getMainWindow(),
        target.id,
      ) as unknown as ReportWindow;
      await waitUntil(
        () =>
          report.document?.readyState === "complete" &&
          report.RHReportWindow?.state.initialized === true,
        "the report window to initialize again",
      );
      await report.RHReportWindow?.ready;
      await delay(2_000);
      log(
        `audio section: hidden ${String(
          (
            report.document.getElementById("rh-audio") as unknown as {
              hidden: boolean;
            } | null
          )?.hidden,
        )}, none "${textOf(report, "rh-audio-none")}", generate disabled ${String(isDisabled(report, "rh-audio-generate"))}`,
      );
      await waitUntil(
        () =>
          (
            report.document.getElementById("rh-audio") as unknown as {
              hidden: boolean;
            } | null
          )?.hidden === false && !isDisabled(report, "rh-audio-generate"),
        "the audio section to offer Generate",
      );
      wire.phase = "audio";
      (
        report.document.getElementById("rh-audio-generate") as unknown as {
          doCommand(): void;
        }
      ).doCommand();
      await acceptCostDialogsUntil(
        () =>
          textOf(report, "rh-audio-outcome").length > 0 &&
          !isDisabled(report, "rh-audio-generate"),
        () =>
          `stage "${textOf(report, "rh-audio-stage")}", outcome "${textOf(report, "rh-audio-outcome")}", reason "${textOf(report, "rh-audio-reason")}", generate disabled ${String(isDisabled(report, "rh-audio-generate"))}, refused [${wire.refused.join(", ")}]`,
      );
      wire.phase = "text";
      const audio = textOf(report, "rh-audio-outcome");
      log(
        `audio: "${audio}"; ${String(wire.chat - afterReport)} script call(s), ${String(wire.speech)} speech chunk(s), ${String(wire.modelLists)} model list(s); reason "${textOf(report, "rh-audio-reason")}"`,
      );
      assert.isAbove(wire.speech, 0, "the speech went through the double");
      report.close();
      await waitUntil(() => report.closed, "the report window to close");

      // The diagnostics text, through the pane's host.
      const host = (pluginInstance()?.api as Record<string, unknown>)[
        PREFERENCES_API_PROPERTY
      ] as PreferencesHostApi | undefined;
      if (!host) assert.fail("no preferences host");
      diagnostics = await host.diagnosticsText();
    } finally {
      untee();
    }

    // The planted keys reached the wire, so the audit is about keys in play.
    const authorization = [...(wire.headerValues.get("Authorization") ?? [])];
    assert.isTrue(
      authorization.includes(`Bearer ${PLANTED["llm.openrouter"]!.key}`),
      "the OpenRouter adapter sent the planted key",
    );
    const googleKey = [...(wire.headerValues.get("x-goog-api-key") ?? [])];
    assert.isTrue(
      googleKey.includes(PLANTED["llm.gemini"]!.key),
      "the speech client sent the planted Gemini key",
    );
    assert.strictEqual(
      wire.refused.length,
      0,
      `refused: ${wire.refused.join(", ")}`,
    );

    // The search: each key, its first eight characters, the first eight of its
    // secret part, its base64 form, and every value of a credential header the
    // double received (Authorization, x-goog-api-key, x-api-key, api-key).
    // Other headers carry no secret: the User-Agent holds the maintainer
    // contact, and the OpenRouter attribution headers (HTTP-Referer, X-Title,
    // X-OpenRouter-Title) name the plugin and are logged on purpose.
    const needles = new Map<string, string>();
    for (const [id, { prefix, key }] of Object.entries(PLANTED)) {
      needles.set(`${id} key`, key);
      needles.set(`${id} first 8`, key.slice(0, 8));
      needles.set(
        `${id} secret first 8`,
        key.slice(prefix.length, prefix.length + 8),
      );
      needles.set(`${id} base64`, btoa(key));
    }
    const credentialHeader =
      /^(authorization|x-goog-api-key|x-api-key|api-key)$/iu;
    const otherHeaders: string[] = [];
    for (const [name, values] of wire.headerValues) {
      if (!credentialHeader.test(name)) {
        otherHeaders.push(name);
        continue;
      }
      let index = 0;
      for (const value of values) {
        needles.set(`header ${name} #${String(index)}`, value);
        index += 1;
      }
    }
    log(
      `credential headers searched; other headers not searched: ${otherHeaders.sort().join(", ")}`,
    );
    const corpora = [
      ["Zotero.debug and Zotero.logError output", captured.join("\n")],
      ["the diagnostics text", diagnostics],
      ["the request URLs", wire.urls.join("\n")],
    ] as const;
    const hits: string[] = [];
    for (const [where, text] of corpora) {
      for (const [what, needle] of needles) {
        if (needle.length > 0 && text.includes(needle)) {
          const line =
            text.split("\n").find((one) => one.includes(needle)) ?? "";
          hits.push(`${what} in ${where}: ${line.slice(0, 200)}`);
        }
      }
    }
    // The plugin database (P7-T37; owner, item 395(f)).
    const database = await searchPluginDatabase(needles);
    hits.push(...database.hits);
    log(
      `plugin database: ${String(database.tables)} tables, ${String(database.rows)} rows, ` +
        `${String(database.textCells)} text cells and ${String(database.blobCells)} blob cells searched ` +
        `for ${String(needles.size)} values; ${String(database.hits.length)} found`,
    );
    assert.isAbove(database.tables, 0, "the plugin database has tables");
    assert.isAbove(
      database.textCells,
      0,
      "the jobs left text in the plugin database",
    );
    // The control: the same search finds what the summarize job did store,
    // the key of a summarized item, so a search that reads nothing fails.
    const firstKey = made[0]?.key ?? "";
    const control = await searchPluginDatabase(
      new Map([["a summarized item's key", firstKey]]),
    );
    log(
      `plugin database control: ${String(control.hits.length)} cells hold a summarized item's key`,
    );
    assert.isAbove(control.hits.length, 0, "the search finds a stored value");
    const pluginLines = captured.filter((line) =>
      line.includes("[research_helper]"),
    ).length;
    log(
      `searched ${String(captured.length)} captured lines (${String(pluginLines)} the plugin's), ` +
        `${String(diagnostics.split("\n").length)} diagnostics lines and ${String(wire.urls.length)} request URLs ` +
        `for ${String(needles.size)} values; ${String(hits.length)} found`,
    );
    log(
      `header names seen: ${[...wire.headerValues.keys()].sort().join(", ")}`,
    );
    assert.isAbove(pluginLines, 0, "the plugin's own lines were captured");
    assert.strictEqual(
      hits.length,
      0,
      `RELEASE BLOCKER (docs/09 §7): ${hits.join(" | ")}`,
    );
  });
});

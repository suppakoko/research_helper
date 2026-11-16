/**
 * `plan/09` `P6-T18` — the audio pipeline end to end on recorded answers,
 * offline (`docs/13` §4: no live call; §8.6: the lines proved here, mapped in
 * `plan/reports/P6-T18.md`). Copies `plan/08` `P5-T28`'s shape: the shipped
 * code from a stored report to a WAV and an attachment record, with only the
 * transport and Zotero replaced.
 *
 * - **The script** is the recorded OpenRouter answer
 *   (`test/fixtures/llm/openrouter/audio-script-{en,ko}.json`), handed back by
 *   a router stand-in that sends nothing.
 * - **The audio** is the real Gemini TTS client (`createGeminiTts`) over the
 *   real `HttpClient`, whose transport answers each request from
 *   `test/fixtures/tts/gemini/` and counts it; nothing else can answer.
 * - **The file** is the real `AudioStore` writing into memory, and the
 *   attachment is a fake Zotero write that records its options.
 *
 * **Stand-ins are not recordings.** Each fixture's `_meta.json` is read; today
 * every one says `"synthetic": true` (`P6-T03`), so these tests prove the
 * pipeline against `docs/04` §2.4's documented shape, not against Google's
 * service. `P6-T04` (the owner's recordings, `G-44`) has not run; the card
 * stays open until it has, and these tests then read the recordings unchanged.
 *
 * No key is read: the client's key is a synthetic string built here.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { createManualClock } from "../../../src/core/clock";
import {
  createHttpClient,
  type HttpExceptionClass,
  type HttpTransport,
  type HttpTransportOptions,
  type HttpTransportXhr,
} from "../../../src/core/http/client";
import { buildUserAgent } from "../../../src/core/http/userAgent";
import {
  createCancellationTokenSource,
  type CancellationTokenSource,
} from "../../../src/core/jobQueue/cancellation";
import type { ProgressReporter } from "../../../src/core/jobQueue/progress";
import {
  createJobAdmission,
  createJobQueue,
  createLlmPool,
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { SecretStore } from "../../../src/core/secretStore";
import { GEMINI_SECRET_ID } from "../../../src/llm/gemini/geminiProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import type {
  ChatRequest,
  ChatResponse,
  LLMRouter,
  ModelInfo,
} from "../../../src/llm/types";
import type { AudioLanguage, AudioRunInput } from "../../../src/model/audio";
import type { TrendReport } from "../../../src/model/trend";
import {
  audioJobInput,
  createAudioReportPipeline,
  type AudioConfirmRequest,
  type AudioReportOutput,
  type AudioReportRunView,
  type AudioReportSurface,
} from "../../../src/pipeline/audioReport/audioReportPipeline";
import type { CitationSource } from "../../../src/pipeline/audioReport/citationMap";
import {
  saveScriptAsText,
  scriptTextFileContent,
} from "../../../src/pipeline/audioReport/failures";
import {
  createBudgetGuard,
  createSessionSpendCounter,
} from "../../../src/pipeline/shared/budget";
import { createPrivacyPolicy } from "../../../src/pipeline/shared/privacyPolicy";
import type {
  ConfigReader,
  PipelineContext,
} from "../../../src/pipeline/types";
import { getPref, type PrefName } from "../../../src/prefs";
import {
  createPromptRegistry,
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
} from "../../../src/prompts";
import {
  CHUNK_SILENCE_MS,
  createAudioStore,
  GEMINI_PCM_FORMAT,
  WAV_CONTENT_TYPE,
  WAV_HEADER_BYTES,
  type AttachmentFromFileOptions,
  type AudioFileSystem,
} from "../../../src/tts/audioStore";
import { chunkScript } from "../../../src/tts/chunk";
import { createGeminiTts, decodeBase64 } from "../../../src/tts/geminiTts";
import {
  createJobStore,
  createReportStore,
  type ReportMarkdownFiles,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TTS_DIR = join(repo, "test/fixtures/tts/gemini");
const LLM_DIR = join(repo, "test/fixtures/llm/openrouter");
const GEMINI_HOST = "generativelanguage.googleapis.com";

// ---------------------------------------------------------------------------
// 1. The fixtures and their sidecars
// ---------------------------------------------------------------------------

interface Recorded {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

interface Sidecar {
  readonly scenario: string;
  readonly synthetic?: boolean;
}

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

/** Every fixture these tests replay, with what its sidecar says. */
const USED = {
  tts: [
    "models-list",
    "tts-en-short",
    "tts-ko-short",
    "error-invalid-key",
    "error-unknown-model",
    "no-audio-part",
  ],
  llm: ["audio-script-en", "audio-script-ko"],
} as const;

function sidecar(dir: string, scenario: string): Sidecar {
  return read<Sidecar>(join(dir, `${scenario}_meta.json`));
}

/** The recorded answer's message: the script the model wrote. */
function recordedScript(language: AudioLanguage): string {
  const file = read<Recorded>(join(LLM_DIR, `audio-script-${language}.json`));
  const body = JSON.parse(file.body) as {
    choices: { message: { content: string } }[];
  };
  return body.choices[0]?.message.content ?? "";
}

/** The PCM bytes in a recorded TTS answer, read apart from the client. */
function recordedPcmBytes(scenario: string): number {
  const file = read<Recorded>(join(TTS_DIR, `${scenario}.json`));
  const body = JSON.parse(file.body) as {
    candidates: { content: { parts: { inlineData: { data: string } }[] } }[];
  };
  const data = body.candidates[0]?.content.parts[0]?.inlineData.data ?? "";
  return decodeBase64(data)?.byteLength ?? 0;
}

// ---------------------------------------------------------------------------
// 2. The transport: answers from the fixtures, counts every request
// ---------------------------------------------------------------------------

class ReplayUnexpectedStatus extends Error {
  constructor(readonly xmlhttp: HttpTransportXhr) {
    super(`HTTP ${String(xmlhttp.status)}`);
  }
}
class ReplayTimeout extends Error {}
class ReplayOffline extends Error {}
class ReplaySecurity extends Error {}
class ReplayCancelled extends Error {}

interface ReplayRequest {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly scenario: string;
  /** `:generateContent` only: the model in the path and the text spoken. */
  readonly model?: string;
  readonly text?: string;
}

/**
 * `GET /v1beta/models` answers with `models-list`; every `:generateContent`
 * with the scenario `speak` names now. Anything else is refused, unanswered.
 */
function replayTransport(): HttpTransport & {
  readonly requests: ReplayRequest[];
  speak: string;
  onSpeak?: ((n: number) => void) | undefined;
} {
  const requests: ReplayRequest[] = [];
  let speaks = 0;
  const transport = {
    requests,
    speak: "tts-en-short",
    onSpeak: undefined as ((n: number) => void) | undefined,
    request(
      method: string,
      url: string,
      options?: HttpTransportOptions,
    ): Promise<HttpTransportXhr> {
      const parsed = new URL(url);
      let scenario: string;
      if (method === "GET" && /\/v1beta\/models\/?$/u.test(parsed.pathname)) {
        scenario = "models-list";
      } else if (
        method === "POST" &&
        parsed.pathname.endsWith(":generateContent")
      ) {
        scenario = transport.speak;
        speaks += 1;
        transport.onSpeak?.(speaks);
      } else {
        return Promise.reject(
          new Error(`no fixture answers ${method} ${parsed.pathname}`),
        );
      }
      const spoken = /\/models\/([^/:]+):generateContent$/u.exec(
        parsed.pathname,
      );
      const body =
        spoken === null
          ? undefined
          : (JSON.parse(options?.body ?? "{}") as {
              contents?: { parts?: { text?: string }[] }[];
            });
      requests.push({
        method,
        host: parsed.host,
        path: parsed.pathname,
        scenario,
        ...(spoken?.[1] !== undefined && {
          model: decodeURIComponent(spoken[1]),
          text: body?.contents?.[0]?.parts?.[0]?.text ?? "",
        }),
      });
      const recorded = read<Recorded>(join(TTS_DIR, `${scenario}.json`));
      const block = Object.entries(recorded.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      const xhr: HttpTransportXhr = {
        status: recorded.status,
        responseText: recorded.body,
        responseURL: url,
        getAllResponseHeaders: () => block,
      };
      if (recorded.status >= 400) {
        return Promise.reject(new ReplayUnexpectedStatus(xhr));
      }
      return Promise.resolve(xhr);
    },
    UnexpectedStatusException:
      ReplayUnexpectedStatus as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
    TimeoutException: ReplayTimeout,
    BrowserOfflineException: ReplayOffline,
    SecurityException: ReplaySecurity,
    CancelledException: ReplayCancelled,
  };
  return transport;
}

// ---------------------------------------------------------------------------
// 3. The database, the fake Zotero, the router stand-in
// ---------------------------------------------------------------------------

function sqlite(): SqlConnection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params));
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction(func) {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      db.close();
      return Promise.resolve();
    },
  };
}

function memoryFiles(): ReportMarkdownFiles {
  const files = new Map<string, string>();
  return {
    write(id, text) {
      files.set(id, text);
      return Promise.resolve();
    },
    read: (id) => Promise.resolve(files.get(id)),
    exists: (id) => Promise.resolve(files.has(id)),
    remove(id) {
      files.delete(id);
      return Promise.resolve();
    },
  };
}

/** Zotero's side: a disk in memory that keeps the bytes, and the two writes. */
function zotero() {
  const disk = new Map<string, Uint8Array>();
  const imports: AttachmentFromFileOptions[] = [];
  const links: AttachmentFromFileOptions[] = [];
  /** The file each attachment was made from, as it was when attached. */
  const attachedBytes: Uint8Array[] = [];
  let next = 500;
  const append = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a, 0);
    out.set(b, a.byteLength);
    return out;
  };
  const files: AudioFileSystem = {
    join: (...segments) => segments.join("/"),
    makeDirectory: () => Promise.resolve(),
    writeFile: (path, bytes) => {
      disk.set(path, new Uint8Array(bytes));
      return Promise.resolve();
    },
    appendFile: (path, bytes) => {
      disk.set(path, append(disk.get(path) ?? new Uint8Array(0), bytes));
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(disk.has(path)),
  };
  const attach =
    (into: AttachmentFromFileOptions[]) =>
    (options: AttachmentFromFileOptions) => {
      into.push(options);
      attachedBytes.push(disk.get(options.file) ?? new Uint8Array(0));
      next += 1;
      return Promise.resolve({ id: next, key: `E2EATT${String(next)}` });
    };
  return {
    disk,
    imports,
    links,
    attachedBytes,
    api: {
      store: createAudioStore({
        dataDirectory: "D:/data",
        files,
        attachments: {
          importFromFile: attach(imports),
          linkFromFile: attach(links),
        },
      }),
      isLibraryEditable: () => true,
      canLinkFiles: () => true,
      collectionExists: () => true,
      attachmentFileNames: () => new Set<string>(),
      folderExists: () => Promise.resolve(false),
      isTemporaryFolder: () => false,
      fileExists: (path: string) => Promise.resolve(disk.has(path)),
      removeFile: (path: string) => {
        disk.delete(path);
        return Promise.resolve();
      },
    },
  };
}

const REGISTRY = createPromptRegistry(
  PROMPT_IDS.map((id) => ({
    fileName: PROMPT_FILE_NAMES[id],
    text: readFileSync(
      resolve(repo, "src/prompts", PROMPT_FILE_NAMES[id]),
      "utf8",
    ),
  })),
);

const MODEL: ModelInfo = {
  id: "vendor/strong-model",
  displayName: "strong",
  contextWindowTokens: 200_000,
  maxOutputTokens: 64_000,
  supportsJsonSchema: true,
  supportsStreaming: true,
  supportsSystemPrompt: true,
  inputCostPerMTokUsd: undefined,
  outputCostPerMTokUsd: undefined,
  dataPolicy: {
    trainsOnInputByDefault: "no",
    retention: { days: "zero", note: "" },
  },
};

/** The stored report: English, in the personal library. */
const REPORT: TrendReport = {
  id: "report-e2e-en",
  libraryID: 1,
  collectionKey: "E2ECOLL1",
  collectionName: "Coastal sea level",
  title: "Research Trends: Coastal sea level (2026-11-17)",
  language: "en",
  generatedAtEpochMs: Date.UTC(2026, 10, 17),
  pluginVersion: "0.0.2",
  scope: {
    totalCount: 3,
    analysedCount: 3,
    excludedCount: 0,
    fullTextCount: 1,
    abstractCount: 2,
    yearMin: 2019,
    yearMax: 2025,
  },
  reductionPasses: 0,
  sections: [
    {
      number: 1,
      heading: "1. Executive Summary",
      markdown: "- Tide gauges sink [[KEY00001]] [[KEY00002]].",
      citedItemKeys: ["KEY00001", "KEY00002"],
    },
  ],
  clustering: { themes: [], assignments: [] },
  citedItemKeys: ["KEY00001", "KEY00002"],
  bibliography: [],
  warnings: [],
  retracted: [],
  excluded: [],
  summaryIds: [],
  qualityProxies: {
    citationDensity: undefined,
    coverageRatio: 1,
    brokenCitationCount: 0,
    meanGroundingScore: undefined,
    contradictionCount: 0,
    unresolvedHighSeverityCount: 0,
  },
  critique: { rounds: 0, unresolved: [], revisedAfterLastCritique: false },
  markdown: "# whole report\n",
  audioScripts: {},
  providerId: "openrouter",
  prompts: [],
  usage: undefined,
} as TrendReport;

const SILENT: ProgressReporter = {
  setMessage: () => undefined,
  setProgress: () => undefined,
  increment: () => undefined,
  child: () => SILENT,
  warn: () => undefined,
  done: () => undefined,
} as unknown as ProgressReporter;

/** A synthetic value under the Gemini id; never a real key, never read from anywhere. */
const SYNTHETIC_KEY = ["e2e", "synthetic", "gemini", "0".repeat(24)].join("-");

function keyStore(): SecretStore {
  const refuse = (): Promise<never> =>
    Promise.reject(new Error("read-only test store"));
  return {
    backend: "session-only",
    unattended: true,
    get: (id) =>
      Promise.resolve(id === GEMINI_SECRET_ID ? SYNTHETIC_KEY : undefined),
    has: (id) => Promise.resolve(id === GEMINI_SECRET_ID),
    set: refuse,
    clear: refuse,
    listStoredIds: () => Promise.resolve([GEMINI_SECRET_ID]),
    clearAll: () => Promise.resolve(0),
  } as SecretStore;
}

// ---------------------------------------------------------------------------
// 4. The harness: the session's sequence over the shipped pipeline
// ---------------------------------------------------------------------------

async function harness(speak: string) {
  const connection = sqlite();
  await runMigrations(connection);
  const clock = createManualClock();
  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const jobs = createJobQueue({
    clock,
    logger,
    pluginVersion: "0.0.0-test",
    isResumable: () => false,
  });
  jobs.attachStore(createJobStore(connection));
  const store = createReportStore(connection, memoryFiles());
  await store.put(REPORT);

  const transport = replayTransport();
  transport.speak = speak;
  const tts = createGeminiTts({
    http: createHttpClient({
      transport,
      userAgent: buildUserAgent("0.0.2"),
      clock,
    }),
    secrets: keyStore(),
    secretId: GEMINI_SECRET_ID,
    baseUrls: createBaseUrlResolver({ override: () => "" }),
    clock,
    logger,
  });

  const chats: ChatRequest[] = [];
  const llm = {
    resolveModel: () => ({
      providerId: "openrouter",
      modelId: MODEL.id,
      fromPref: "reportModel",
    }),
    async chat(
      request: ChatRequest,
      ctx: { beforeSend?: () => Promise<void> },
    ): Promise<ChatResponse> {
      await ctx.beforeSend?.();
      chats.push(request);
      const korean = JSON.stringify(request).includes("AUDIO_SCRIPT_KO");
      return {
        text: recordedScript(korean ? "ko" : "en"),
        json: undefined,
        model: MODEL.id,
        finishReason: "stop",
        usage: {
          inputTokens: 900,
          outputTokens: 400,
          totalTokens: 1300,
          costUsd: 0.001,
        },
        servedBy: undefined,
        latencyMs: 1,
        raw: undefined,
      };
    },
  } as unknown as LLMRouter;

  const citations: CitationSource = {
    readCitations: (_libraryID, keys) =>
      Promise.resolve(
        new Map(
          keys.map((k) => [
            k,
            {
              itemKey: k,
              firstAuthorSurname: "Testa",
              authorCount: 2,
              year: 2024,
            },
          ]),
        ),
      ),
  };
  const z = zotero();
  const pipeline = createAudioReportPipeline({
    reports: () => Promise.resolve(store),
    prompts: () => Promise.resolve(REGISTRY),
    queue: jobs,
    tts,
    ttsKey: () => Promise.resolve(SYNTHETIC_KEY),
    citations,
    attachments: () => z.api,
    prices: () => undefined,
    priceOverrides: () => Promise.resolve([]),
    baseUrls: {
      effectiveHost: (id) => (id === "gemini" ? GEMINI_HOST : "openrouter.ai"),
    },
    pool: createLlmPool(() => 2),
    admission: createJobAdmission(),
    modelInfo: () => MODEL,
    egressAcknowledged: () => true,
    tierPrefs: { paidTier: () => true, tierAnswer: () => "paid" },
    tierWriter: { tierAnswer: () => undefined, paidTier: () => undefined },
    linkedFolder: { read: () => "", write: () => undefined },
  });

  const values: Partial<Record<PrefName, unknown>> = {
    audioEnabled: true,
    ttsLanguage: "auto",
    ttsVoice: "Charon",
    // Empty: the model comes from the recorded model list (docs/04 §2.2).
    ttsModel: "",
    ttsTargetMinutes: 1,
  };
  const config = {
    get: (name: PrefName) => (name in values ? values[name] : getPref(name)),
  } as unknown as ConfigReader;
  const session = createSessionSpendCounter();
  const context = (
    jobId: string,
    source: CancellationTokenSource,
  ): PipelineContext => ({
    jobId,
    token: source.token,
    progress: SILENT,
    logger,
    cache: undefined as unknown as PipelineContext["cache"],
    clock,
    budget: createBudgetGuard({
      session,
      limits: { run: () => 0, session: () => 0 },
    }),
    sources: undefined as unknown as PipelineContext["sources"],
    llm,
    tts: undefined,
    zotero: undefined,
    config,
    privacy: createPrivacyPolicy("balanced"),
    checkpoint: () => Promise.resolve(),
    resumeState: undefined,
  });

  const views: AudioReportRunView[] = [];
  const confirms: AudioConfirmRequest[] = [];
  const run = async (
    input: Partial<AudioRunInput> = {},
    source: CancellationTokenSource = createCancellationTokenSource(),
  ): Promise<{ output: AudioReportOutput; jobId: string | undefined }> => {
    const full: AudioRunInput = {
      reportId: REPORT.id,
      language: "auto",
      ...input,
    };
    const surface: AudioReportSurface = {
      update: (view) => views.push(view),
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve({ kind: "run" });
      },
      ask: () => Promise.resolve("cancel"),
      pickFolder: () => Promise.resolve(undefined),
    };
    const prepared = await pipeline.prepare(
      full,
      context("prepare-only", source),
      surface,
    );
    if (prepared.status !== "run") {
      return {
        output: await pipeline.execute(
          prepared,
          context("none", source),
          surface,
        ),
        jobId: undefined,
      };
    }
    const record = await jobs.enqueue(
      "audioReport",
      audioJobInput(prepared, clock.now()),
    );
    return {
      output: await pipeline.execute(
        prepared,
        context(record.id, source),
        surface,
      ),
      jobId: record.id,
    };
  };

  return { jobs, store, transport, chats, z, views, confirms, run };
}

/** A WAV's header fields, read from its bytes. */
function wavFields(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  return {
    riff: tag(0),
    riffSize: view.getUint32(4, true),
    wave: tag(8),
    fmt: tag(12),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    data: tag(36),
    dataSize: view.getUint32(40, true),
  };
}

/** The bytes a run of `chunks` recorded answers joins to, gaps included. */
function expectedDataBytes(scenario: string, chunks: number): number {
  const frame =
    (GEMINI_PCM_FORMAT.bitsPerSample / 8) * GEMINI_PCM_FORMAT.channels;
  const gap =
    Math.round((GEMINI_PCM_FORMAT.sampleRateHz * CHUNK_SILENCE_MS) / 1000) *
    frame;
  return chunks * recordedPcmBytes(scenario) + (chunks - 1) * gap;
}

// ---------------------------------------------------------------------------
// 5. Step 5 throughout: nothing reaches a network
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(() => {
      throw new Error("no network in this test");
    }),
  );
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** Every request the transport answered was a fixture's, on Google's host. */
function expectOnlyReplayed(h: Awaited<ReturnType<typeof harness>>): void {
  expect(h.transport.requests.length).toBeGreaterThan(0);
  for (const request of h.transport.requests) {
    expect(request.host).toBe(GEMINI_HOST);
    expect([...USED.tts]).toContain(request.scenario);
  }
}

// ---------------------------------------------------------------------------
// 6. The tests
// ---------------------------------------------------------------------------

describe("P6-T18 — the sidecars: what these tests replay is a stand-in today", () => {
  it("reads every fixture's _meta.json; each one used is P6-T03's synthetic stand-in", () => {
    const sidecars = [
      ...USED.tts.map((s) => sidecar(TTS_DIR, s)),
      ...USED.llm.map((s) => sidecar(LLM_DIR, s)),
    ];
    expect(sidecars.map((m) => m.scenario)).toEqual([...USED.tts, ...USED.llm]);
    // When P6-T04's recordings land, this count falls and the card can close.
    const standIns = sidecars.filter((m) => m.synthetic === true);
    expect(standIns).toHaveLength(sidecars.length);
  });
});

describe("P6-T18 step 1 — English: stored report to a WAV and an attachment", () => {
  it("recorded script, chunks, recorded TTS bodies per chunk, a WAV whose header and length agree, one import, the key stored", async () => {
    const h = await harness("tts-en-short");
    const script = recordedScript("en");
    const chunks = chunkScript(script, { language: "en" }).length;
    expect(chunks).toBeGreaterThan(1);

    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.chats).toHaveLength(1);
    expect(JSON.stringify(h.chats[0])).toContain("AUDIO_SCRIPT_EN");

    // One model-list read (tts.model empty), then one request per chunk.
    expect(h.transport.requests.map((r) => r.scenario)).toEqual([
      "models-list",
      ...Array<string>(chunks).fill("tts-en-short"),
    ]);
    expectOnlyReplayed(h);
    expect(
      h.views.filter((v) => v.stage === "Synthesizing").at(-1)?.chunk,
    ).toEqual({ done: chunks, total: chunks });

    // tts.model empty: every request names a model of the recorded list.
    const listed = (
      JSON.parse(read<Recorded>(join(TTS_DIR, "models-list.json")).body) as {
        models: { name: string }[];
      }
    ).models.map((m) => m.name.replace(/^models\//u, ""));
    const spoken = h.transport.requests.filter((r) => r.text !== undefined);
    expect(spoken).toHaveLength(chunks);
    for (const request of spoken) {
      expect(listed).toContain(request.model);
      // FR-39: no Markdown, citation marker or link reaches the voice.
      expect(request.text).not.toMatch(/\[\[|\*\*|^#|\]\(|https?:\/\//mu);
    }
    // The whole script was spoken, chunk by chunk, in order.
    expect(spoken.map((r) => r.text).join(" ")).toContain(
      chunkScript(script, { language: "en" })[0]?.text ?? "missing",
    );

    // FR-42: both confirmations were asked; the second carries the real
    // chunks' character count and a cost estimate.
    expect(h.confirms.map((c) => c.step)).toEqual(["script", "audio"]);
    const second = h.confirms[1];
    if (second?.step !== "audio") throw new Error("no audio confirmation");
    expect(second.plan.chunks).toHaveLength(chunks);
    expect(second.plan.totalChars).toBeGreaterThan(0);
    expect(second.plan.cost).toBeDefined();

    // The WAV: header and length agree with the recorded PCM and the gaps.
    expect(h.z.imports).toHaveLength(1);
    expect(h.z.links).toHaveLength(0);
    const wav = h.z.attachedBytes[0] ?? new Uint8Array(0);
    const fields = wavFields(wav);
    expect(fields).toMatchObject({
      riff: "RIFF",
      wave: "WAVE",
      fmt: "fmt ",
      data: "data",
      channels: GEMINI_PCM_FORMAT.channels,
      sampleRate: GEMINI_PCM_FORMAT.sampleRateHz,
      bitsPerSample: GEMINI_PCM_FORMAT.bitsPerSample,
    });
    expect(fields.riffSize).toBe(wav.byteLength - 8);
    expect(fields.dataSize).toBe(wav.byteLength - WAV_HEADER_BYTES);
    expect(fields.dataSize).toBe(expectedDataBytes("tts-en-short", chunks));
    expect(output.delivered?.bytes).toBe(wav.byteLength);
    expect(output.delivered?.seconds).toBeCloseTo(
      fields.dataSize /
        (GEMINI_PCM_FORMAT.sampleRateHz *
          (GEMINI_PCM_FORMAT.bitsPerSample / 8) *
          GEMINI_PCM_FORMAT.channels),
      3,
    );

    // The attachment record: imported into the report's collection, as WAV.
    const attached = h.z.imports[0];
    expect(attached?.collections).toEqual([REPORT.collectionKey]);
    expect(attached?.contentType).toBe(WAV_CONTENT_TYPE);
    expect(output.delivered?.mode).toBe("imported");
    // No second copy is left in the data directory once imported.
    expect(h.z.disk.size).toBe(0);

    const stored = await h.store.get(REPORT.id);
    expect(stored?.audioScripts.en).toBe(script);
    expect(stored?.audioAttachmentKeys?.en).toBe(
      output.delivered?.attachmentKey,
    );
    expect(output.delivered?.attachmentKey).toMatch(/^E2EATT/u);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("succeeded");
  });
});

describe("P6-T18 step 2 — Korean from an English report", () => {
  it("one Korean script call from the English report, Korean chunks, a WAV, audioAttachmentKeys.ko", async () => {
    const h = await harness("tts-ko-short");
    const script = recordedScript("ko");
    const chunks = chunkScript(script, { language: "ko" }).length;
    expect(chunks).toBeGreaterThan(1);

    const { output } = await h.run({ language: "ko" });
    expect(output.outcome).toBe("succeeded");
    expect(output.language).toBe("ko");
    // sourceLanguage "en": the Korean prompt, written from the English record,
    // in one call, with no Korean record in the store (no companion).
    expect(h.chats).toHaveLength(1);
    expect(JSON.stringify(h.chats[0])).toContain("AUDIO_SCRIPT_KO");
    expect(await h.store.companionOf(REPORT)).toBeUndefined();
    expect(output.script).toEqual({ language: "ko", text: script });

    expect(h.transport.requests.map((r) => r.scenario)).toEqual([
      "models-list",
      ...Array<string>(chunks).fill("tts-ko-short"),
    ]);
    expectOnlyReplayed(h);
    const wav = h.z.attachedBytes[0] ?? new Uint8Array(0);
    const fields = wavFields(wav);
    expect(fields.dataSize).toBe(wav.byteLength - WAV_HEADER_BYTES);
    expect(fields.dataSize).toBe(expectedDataBytes("tts-ko-short", chunks));

    const stored = await h.store.get(REPORT.id);
    expect(stored?.language).toBe("en");
    expect(stored?.audioScripts.ko).toBe(script);
    expect(stored?.audioScripts.en).toBeUndefined();
    expect(stored?.audioAttachmentKeys?.ko).toBe(
      output.delivered?.attachmentKey,
    );
    expect(stored?.audioAttachmentKeys?.en).toBeUndefined();
  });
});

describe("P6-T18 step 3 — each failure path on its fixture", () => {
  it("error-invalid-key: unentitled, the script saved as text, the written report unchanged", async () => {
    const h = await harness("error-invalid-key");
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(output.failure?.reason).toBe("unentitled");
    expect(output.failure?.messageKey).toBe("rh-error-tts");
    expect(output.failure?.messageArgs).toEqual({ reason: "unentitled" });
    expect(output.failure?.offerScriptText).toBe(true);
    expect(output.failure?.offerAudioSaveAs).toBe(false);
    expect(output.failure?.error).not.toHaveProperty("stack");
    expect(JSON.stringify(output.failure)).not.toContain(SYNTHETIC_KEY);
    expectOnlyReplayed(h);
    expect(h.z.imports).toHaveLength(0);
    expect(h.z.links).toHaveLength(0);
    expect(h.z.disk.size).toBe(0);

    // The written report is as it was; only the kept script was added.
    const stored = await h.store.get(REPORT.id);
    expect(stored?.sections).toEqual(REPORT.sections);
    expect(stored?.markdown).toBe(REPORT.markdown);
    expect(stored?.audioAttachmentKeys?.en).toBeUndefined();
    expect(stored?.audioScripts.en).toBe(recordedScript("en"));

    // FR-43: the offered save writes the script as UTF-8 text.
    const written = new Map<string, string>();
    const saved = await saveScriptAsText(
      "E:/chosen/script.txt",
      REPORT,
      output.script ?? { language: "en", text: "" },
      {
        files: {
          writeTextFile: (path, text) => {
            written.set(path, text);
            return Promise.resolve();
          },
        },
        logger: createLogger({
          sink: NULL_LOG_SINK,
          clock: createManualClock(),
        }),
      },
    );
    expect(saved).toBe("saved");
    expect(written.get("E:/chosen/script.txt")).toBe(
      scriptTextFileContent(REPORT, {
        language: "en",
        text: recordedScript("en"),
      }),
    );
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("failed");
  });

  it("error-unknown-model: model-gone", async () => {
    const h = await harness("error-unknown-model");
    const { output } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(output.failure?.reason).toBe("model-gone");
    expect(output.failure?.messageArgs).toEqual({ reason: "model-gone" });
    expect(output.failure?.offerScriptText).toBe(true);
    expectOnlyReplayed(h);
    expect(h.z.imports).toHaveLength(0);
    expect(
      (await h.store.get(REPORT.id))?.audioAttachmentKeys?.en,
    ).toBeUndefined();
  });

  it("no-audio-part: no-audio", async () => {
    const h = await harness("no-audio-part");
    const { output } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(output.failure?.reason).toBe("no-audio");
    expect(output.failure?.messageArgs).toEqual({ reason: "no-audio" });
    expectOnlyReplayed(h);
    expect(h.z.imports).toHaveLength(0);
    expect(
      (await h.store.get(REPORT.id))?.audioAttachmentKeys?.en,
    ).toBeUndefined();
  });
});

describe("P6-T18 step 4 — cancel during chunk 2", () => {
  it("no file, no key, the script kept", async () => {
    const h = await harness("tts-en-short");
    const source = createCancellationTokenSource();
    h.transport.onSpeak = (n) => {
      if (n === 2) source.cancel({ kind: "user" });
    };
    const { output, jobId } = await h.run({}, source);
    expect(output.outcome).toBe("cancelled");
    expect(output.audio).toBeUndefined();
    expect(
      h.transport.requests.filter((r) => r.scenario === "tts-en-short"),
    ).toHaveLength(2);
    expectOnlyReplayed(h);
    // No file: nothing attached, nothing left on disk.
    expect(h.z.imports).toHaveLength(0);
    expect(h.z.links).toHaveLength(0);
    expect(h.z.disk.size).toBe(0);
    // No key; the script kept.
    const stored = await h.store.get(REPORT.id);
    expect(stored?.audioAttachmentKeys?.en).toBeUndefined();
    expect(stored?.audioScripts.en).toBe(recordedScript("en"));
    // A cancel offers no save (P6-T14's rule): the script is kept in the
    // store, so the next run starts from it without a script call.
    expect(output.failure?.cancelled).toBe(true);
    expect(output.failure?.offerScriptText).toBe(false);
    expect(output.failure?.offerAudioSaveAs).toBe(false);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
    const again = await h.run();
    expect(again.output.outcome).toBe("succeeded");
    expect(h.chats).toHaveLength(1);
  });
});

describe("P6-T18 step 5 — the transport counts requests: none reaches a network", () => {
  it("a whole English run is the model list and one request per chunk, all answered here", async () => {
    const h = await harness("tts-en-short");
    await h.run();
    const chunks = chunkScript(recordedScript("en"), { language: "en" }).length;
    expect(h.transport.requests).toHaveLength(1 + chunks);
    expectOnlyReplayed(h);
    // `fetch` and `XMLHttpRequest` are stubbed to throw; afterEach checks fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

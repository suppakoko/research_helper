/**
 * `plan/09` `P6-T16` — the audio job (`createAudioReportPipeline` in
 * `src/pipeline/audioReport/audioReportPipeline.ts`), `ReportStore`'s two new
 * lookups (`src/zotero/db.ts`) and the job's construction in
 * `buildPipelineSet`. Layer 1: a real SQLite job queue and report store, the
 * shipped prompts, a fake router, a fake TTS client and a fake Zotero; no
 * network, no key and no spend.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import {
  buildPipelineSet,
  type AudioReportConstructionDeps,
} from "../../../src/bootstrap/registerPipelines";
import { createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  BudgetExceededError,
  OperationCancelledError,
  PolicyViolationError,
} from "../../../src/core/errors";
import {
  createCancellationTokenSource,
  type CancellationTokenSource,
} from "../../../src/core/jobQueue/cancellation";
import type { ProgressReporter } from "../../../src/core/jobQueue/progress";
import {
  createJobAdmission,
  createJobQueue,
  createLlmPool,
  type JobQueue,
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { UserPriceOverride } from "../../../src/llm/shared/pricing";
import type {
  ChatRequest,
  ChatResponse,
  LLMRouter,
  ModelInfo,
} from "../../../src/llm/types";
import type { AudioRunInput } from "../../../src/model/audio";
import type { TrendReport } from "../../../src/model/trend";
import {
  AUDIO_REPORT_STAGES,
  audioJobInput,
  audioReportExclusivityKey,
  createAudioReportPipeline,
  HEADLESS_AUDIO_REPORT_SURFACE,
  type AudioConfirmAnswer,
  type AudioConfirmRequest,
  type AudioReportPipelineDeps,
  type AudioReportRunView,
  type AudioReportSurface,
  type PreparedAudioReport,
} from "../../../src/pipeline/audioReport/audioReportPipeline";
import type { CitationSource } from "../../../src/pipeline/audioReport/citationMap";
import {
  audioKeyFingerprint,
  type OfferedTierAnswer,
} from "../../../src/pipeline/audioReport/disclosure";
import { estimateAudioPlan } from "../../../src/pipeline/audioReport/estimate";
import { STYLE_PREFIX } from "../../../src/pipeline/audioReport/synthesize";
import {
  createBudgetGuard,
  createSessionSpendCounter,
} from "../../../src/pipeline/shared/budget";
import { readEgressLog } from "../../../src/pipeline/shared/egressDisclosure";
import { withHeadroom } from "../../../src/pipeline/shared/estimate";
import { createPrivacyPolicy } from "../../../src/pipeline/shared/privacyPolicy";
import type { SummarizeQuestion } from "../../../src/pipeline/summarize/summarizePipeline";
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
  createAudioStore,
  IMPORT_MAX_BYTES,
  type AttachmentFromFileOptions,
  type AudioFileSystem,
} from "../../../src/tts/audioStore";
import { chunkScript } from "../../../src/tts/chunk";
import { GEMINI_TTS_FALLBACK_MODEL } from "../../../src/tts/geminiTts";
import type {
  AudioArtifact,
  SynthesisRequest,
  TTSProvider,
} from "../../../src/tts/types";
import type { ZoteroAudioAttachments } from "../../../src/zotero/attachments";
import {
  createJobStore,
  createReportStore,
  type ReportMarkdownFiles,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

// ---------------------------------------------------------------------------
// 1. The database
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

// ---------------------------------------------------------------------------
// 2. Fixtures
// ---------------------------------------------------------------------------

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REGISTRY = createPromptRegistry(
  PROMPT_IDS.map((id) => ({
    fileName: PROMPT_FILE_NAMES[id],
    text: readFileSync(
      resolve(repo, "src/prompts", PROMPT_FILE_NAMES[id]),
      "utf8",
    ),
  })),
);

const TTS_MODEL = "test-tts-model";
const KEY = "synthetic-key-for-a-fingerprint";

/** A plain spoken script of several chunks: no markup, no citation, no digit. */
const SENTENCE =
  "Tide gauges along the coast record a slow rise in the sea, and the studies read it in different ways. ";
const PARAGRAPH = SENTENCE.repeat(6).trim();
const LONG_SCRIPT = [PARAGRAPH, PARAGRAPH, PARAGRAPH].join("\n\n");
const CHUNKS = chunkScript(LONG_SCRIPT, { language: "en" }).length;

/** A script that keeps its Markdown: rejected after the retry. */
const LEAKY = "## A heading\n\n**Bold** words and [[KEY00001]] here.";

function report(overrides: Partial<TrendReport> = {}): TrendReport {
  return {
    id: "report-en-1",
    libraryID: 1,
    collectionKey: "COLL0001",
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
    ...overrides,
  } as TrendReport;
}

function answer(text: string): ChatResponse {
  return {
    text,
    json: undefined,
    model: "vendor/strong-model",
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
}

const SAFE_MODEL: ModelInfo = {
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

const SILENT_PROGRESS: ProgressReporter = {
  setMessage: () => undefined,
  setProgress: () => undefined,
  increment: () => undefined,
  child: () => SILENT_PROGRESS,
  warn: () => undefined,
  done: () => undefined,
} as unknown as ProgressReporter;

// ---------------------------------------------------------------------------
// 3. The fake Zotero and the fake TTS client
// ---------------------------------------------------------------------------

interface Library {
  readonly zotero: ZoteroAudioAttachments;
  readonly imports: AttachmentFromFileOptions[];
  readonly links: AttachmentFromFileOptions[];
  editable: boolean;
  personal: boolean;
  /** Runs before an attachment is made; may throw. */
  beforeAttach?: () => void;
}

function library(): Library {
  const disk = new Map<string, number>();
  const imports: AttachmentFromFileOptions[] = [];
  const links: AttachmentFromFileOptions[] = [];
  let next = 100;
  const files: AudioFileSystem = {
    join: (...segments) => segments.join("/"),
    makeDirectory: () => Promise.resolve(),
    writeFile: (path, bytes) => {
      disk.set(path, bytes.byteLength);
      return Promise.resolve();
    },
    appendFile: (path, bytes) => {
      disk.set(path, (disk.get(path) ?? 0) + bytes.byteLength);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(disk.has(path)),
  };
  const attach =
    (into: AttachmentFromFileOptions[]) =>
    (options: AttachmentFromFileOptions) => {
      lib.beforeAttach?.();
      into.push(options);
      next += 1;
      return Promise.resolve({ id: next, key: `ATTACH${String(next)}` });
    };
  const lib: Library = {
    imports,
    links,
    editable: true,
    personal: true,
    zotero: undefined as unknown as ZoteroAudioAttachments,
  };
  (lib as { zotero: ZoteroAudioAttachments }).zotero = {
    store: createAudioStore({
      dataDirectory: "D:/data",
      files,
      attachments: {
        importFromFile: attach(imports),
        linkFromFile: attach(links),
      },
    }),
    isLibraryEditable: () => lib.editable,
    canLinkFiles: () => lib.personal,
    collectionExists: () => true,
    attachmentFileNames: () => new Set<string>(),
    folderExists: (path) => Promise.resolve(path === "E:/Audio"),
    isTemporaryFolder: () => false,
    fileExists: (path) => Promise.resolve(disk.has(path)),
    removeFile: (path) => {
      disk.delete(path);
      return Promise.resolve();
    },
  };
  return lib;
}

/**
 * A fake TTS client. As `createGeminiTts`'s `resolveModel` does, a set
 * preference is returned with no request, and an empty one reads the model
 * list (counted in `listReads`, a request to Google) and returns `liveModel`.
 */
function fakeTts(fail?: Error, liveModel: string = TTS_MODEL) {
  const requests: SynthesisRequest[] = [];
  const models: string[] = [];
  const listReads: number[] = [];
  const voiceLanguages: string[] = [];
  const tts: Pick<TTSProvider, "resolveModel" | "synthesize" | "listVoices"> = {
    resolveModel(preferred) {
      models.push(preferred);
      if (preferred.trim() !== "") return Promise.resolve(preferred.trim());
      listReads.push(1);
      return Promise.resolve(liveModel);
    },
    listVoices(language) {
      voiceLanguages.push(language);
      return Promise.resolve([
        { id: "Charon", displayName: "Charon", languages: "multilingual" },
        { id: "Kore", displayName: "Kore", languages: "multilingual" },
      ]);
    },
    synthesize(request): Promise<AudioArtifact> {
      requests.push(request);
      if (fail !== undefined) return Promise.reject(fail);
      return Promise.resolve({
        data: new Uint8Array(4800).fill(1),
        mimeType: "audio/L16;codec=pcm;rate=24000",
        fileExtension: "pcm",
        durationSeconds: 0.1,
        sampleRateHz: 24000,
        model: request.model,
        voice: request.voice,
        usage: {
          inputTokens: 10,
          outputTokens: 25,
          totalTokens: 35,
          costUsd: undefined,
        },
      });
    },
  };
  return { tts, requests, models, listReads, voiceLanguages };
}

// ---------------------------------------------------------------------------
// 4. The harness
// ---------------------------------------------------------------------------

interface HarnessOptions {
  readonly mode?: "strict" | "balanced";
  readonly paid?: boolean;
  readonly tierAnswer?: string;
  readonly config?: Partial<Record<PrefName, unknown>>;
  readonly chat?: readonly string[];
  readonly ttsFail?: Error;
  readonly key?: string | undefined;
  readonly reports?: readonly TrendReport[];
  readonly overrides?: readonly UserPriceOverride[];
  /** Refuse the n-th TTS reservation once, with a run-ceiling stop. */
  readonly refuseReservation?: number;
  /** The script model's description; a zero-retention, no-training one by default. */
  readonly model?: ModelInfo;
  /** The model the list read returns when `tts.model` is empty. */
  readonly liveModel?: string;
}

async function harness(options: HarnessOptions = {}) {
  const connection = sqlite();
  await runMigrations(connection);
  const clock = createManualClock();
  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const jobs: JobQueue = createJobQueue({
    clock,
    logger,
    pluginVersion: "0.0.0-test",
    isResumable: () => false,
  });
  jobs.attachStore(createJobStore(connection));
  const store = createReportStore(connection, memoryFiles());
  for (const r of options.reports ?? [report()]) await store.put(r);

  const chats: ChatRequest[] = [];
  const answers = [...(options.chat ?? [LONG_SCRIPT])];
  const llm = {
    resolveModel: () => ({
      providerId: "openrouter",
      modelId: "vendor/strong-model",
      fromPref: "reportModel",
    }),
    async chat(
      request: ChatRequest,
      ctx: { beforeSend?: () => Promise<void> },
    ) {
      await ctx.beforeSend?.();
      chats.push(request);
      const next = answers.shift();
      if (next === undefined) throw new Error("no answer left");
      return answer(next);
    },
  } as unknown as LLMRouter;

  const citationReads: string[][] = [];
  const citations: CitationSource = {
    readCitations(_libraryID, keys) {
      citationReads.push([...keys]);
      return Promise.resolve(
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
      );
    },
  };
  const lib = library();
  const tts = fakeTts(options.ttsFail, options.liveModel);
  const tierWrites: string[] = [];
  let tierAnswer = options.tierAnswer ?? "";
  let paid = options.paid ?? false;
  const keyReads: number[] = [];
  const deps: AudioReportPipelineDeps = {
    reports: () => Promise.resolve(store),
    prompts: () => Promise.resolve(REGISTRY),
    queue: jobs,
    tts: tts.tts,
    ttsKey: () => {
      keyReads.push(1);
      return Promise.resolve("key" in options ? options.key : KEY);
    },
    citations,
    attachments: () => lib.zotero,
    prices: () => undefined,
    priceOverrides: () => Promise.resolve(options.overrides ?? []),
    baseUrls: {
      effectiveHost: (id) =>
        id === "gemini" ? "generativelanguage.googleapis.com" : "openrouter.ai",
    },
    pool: createLlmPool(() => 2),
    admission: createJobAdmission(),
    modelInfo: () => options.model ?? SAFE_MODEL,
    egressAcknowledged: () => true,
    tierPrefs: { paidTier: () => paid, tierAnswer: () => tierAnswer },
    tierWriter: {
      tierAnswer: (a) => {
        tierWrites.push(a);
        tierAnswer = a;
      },
      paidTier: () => {
        tierWrites.push("paidTier");
        paid = true;
      },
    },
    linkedFolder: { read: () => "E:/Audio", write: () => undefined },
  };
  const pipeline = createAudioReportPipeline(deps);

  const values: Partial<Record<PrefName, unknown>> = {
    audioEnabled: true,
    ttsLanguage: "auto",
    ttsVoice: "Charon",
    // Set, so the quoted model is the one used; the empty case (the shipped
    // value) has its own tests (plan/00 §6 item 385).
    ttsModel: TTS_MODEL,
    ttsTargetMinutes: 1,
    ...options.config,
  };
  const config = {
    get: (name: PrefName) => (name in values ? values[name] : getPref(name)),
  } as unknown as ConfigReader;
  const session = createSessionSpendCounter();
  const raised: [string, number][] = [];

  const context = (
    jobId: string,
    source: CancellationTokenSource,
  ): PipelineContext => {
    const real = createBudgetGuard({
      session,
      limits: { run: () => 0, session: () => 0 },
    });
    let reservations = 0;
    let refused = false;
    const budget = Object.create(real) as typeof real;
    Object.assign(budget, {
      reserveCall: (estimate: Parameters<typeof real.reserveCall>[0]) => {
        reservations += 1;
        if (reservations === options.refuseReservation && !refused) {
          refused = true;
          throw new BudgetExceededError("run ceiling reached", {
            ceiling: "run",
            limitUsd: 0.01,
            spentUsd: 0.01,
            projectedUsd: 0.02,
            runSpentUsd: 0.01,
          });
        }
        return real.reserveCall(estimate);
      },
      raiseLimit: (ceiling: string, limitUsd: number) => {
        raised.push([ceiling, limitUsd]);
      },
    });
    return {
      jobId,
      token: source.token,
      progress: SILENT_PROGRESS,
      logger,
      cache: undefined as unknown as PipelineContext["cache"],
      clock,
      budget,
      sources: undefined as unknown as PipelineContext["sources"],
      llm,
      tts: undefined,
      zotero: undefined,
      config,
      privacy: createPrivacyPolicy(options.mode ?? "balanced"),
      checkpoint: () => Promise.resolve(),
      resumeState: undefined,
    };
  };

  const confirms: AudioConfirmRequest[] = [];
  const atConfirm: {
    listReads: number;
    resolves: number;
    synthesis: number;
    chats: number;
  }[] = [];
  const asks: SummarizeQuestion[] = [];
  const views: AudioReportRunView[] = [];

  /** The session's sequence: prepare, enqueue with the egress log, execute. */
  const run = async (
    runOptions: {
      readonly input?: Partial<AudioRunInput>;
      readonly answers?: AudioConfirmAnswer[];
      readonly ask?: "resume" | "cancel";
      readonly enqueueWithoutLog?: boolean;
      readonly source?: CancellationTokenSource;
      readonly afterPrepare?: () => void;
    } = {},
  ) => {
    const input: AudioRunInput = {
      reportId: "report-en-1",
      language: "auto",
      ...runOptions.input,
    };
    const replies = [...(runOptions.answers ?? [])];
    const surface: AudioReportSurface = {
      update: (view) => views.push(view),
      confirm: (request) => {
        confirms.push(request);
        // What had left the machine when this confirmation was asked.
        atConfirm.push({
          listReads: tts.listReads.length,
          resolves: tts.models.length,
          synthesis: tts.requests.length,
          chats: chats.length,
        });
        return Promise.resolve(replies.shift() ?? { kind: "run" });
      },
      ask: (question) => {
        asks.push(question);
        return Promise.resolve(runOptions.ask ?? "cancel");
      },
      pickFolder: () => Promise.resolve(undefined),
    };
    const source = runOptions.source ?? createCancellationTokenSource();
    const prepared = await pipeline.prepare(
      input,
      context("prepare-only", source),
      surface,
    );
    runOptions.afterPrepare?.();
    if (prepared.status !== "run") {
      const output = await pipeline.execute(
        prepared,
        context("none", source),
        surface,
      );
      return { prepared, output, jobId: undefined };
    }
    const record = await jobs.enqueue(
      "audioReport",
      runOptions.enqueueWithoutLog === true
        ? input
        : audioJobInput(prepared, clock.now()),
    );
    const output = await pipeline.execute(
      prepared,
      context(record.id, source),
      surface,
    );
    return { prepared, output, jobId: record.id };
  };

  return {
    jobs,
    store,
    lib,
    tts,
    chats,
    citationReads,
    confirms,
    atConfirm,
    asks,
    views,
    tierWrites,
    keyReads,
    raised,
    pipeline,
    deps,
    context,
    run,
  };
}

/** Nothing reached a model or Google, and nothing was attached. */
function expectNothingSent(h: Awaited<ReturnType<typeof harness>>): void {
  expect(h.chats).toHaveLength(0);
  expect(h.tts.requests).toHaveLength(0);
  expect(h.lib.imports).toHaveLength(0);
  expect(h.lib.links).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// 5. The run (Done when, line 1)
// ---------------------------------------------------------------------------

describe("P6-T16 — one audio job end to end, with fakes", () => {
  it("with no stored script: one script call, two confirmations, N chunks, one attachment, script and key stored", async () => {
    const h = await harness();
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.chats).toHaveLength(1);
    expect(h.confirms.map((c) => c.step)).toEqual(["script", "audio"]);
    expect(CHUNKS).toBeGreaterThan(1);
    expect(h.tts.requests).toHaveLength(CHUNKS);
    expect(h.tts.requests.every((r) => r.model === TTS_MODEL)).toBe(true);
    expect(h.tts.requests.every((r) => r.voice === "Charon")).toBe(true);
    expect(h.lib.imports).toHaveLength(1);
    expect(h.lib.imports[0]?.collections).toEqual(["COLL0001"]);

    const stored = await h.store.get("report-en-1");
    expect(stored?.audioScripts.en).toBe(LONG_SCRIPT);
    expect(stored?.audioAttachmentKeys?.en).toBe(
      output.delivered?.attachmentKey,
    );
    expect(output.delivered?.attachmentKey).toMatch(/^ATTACH/u);
    expect(output.script).toEqual({ language: "en", text: LONG_SCRIPT });

    const record = await h.jobs.get(jobId ?? "");
    expect(record?.status).toBe("succeeded");
    expect(record?.resultRef).toEqual({ kind: "report", key: "report-en-1" });
    // The first confirmation names both hosts; the second Gemini's alone.
    const [first, second] = h.confirms;
    expect(first?.disclosure.audio?.scriptCall?.modelId).toBe(
      "vendor/strong-model",
    );
    expect(second?.disclosure.audio?.scriptCall).toBeUndefined();
    // The second finds the job's own record: no first-use notice again.
    expect(first?.disclosure.audio?.firstUseWithKey).toBe(true);
    expect(second?.disclosure.audio?.firstUseWithKey).toBe(false);
    // The record's egress log carries the key's fingerprint, never the key.
    const log = record === undefined ? undefined : readEgressLog(record);
    expect(log?.audio?.keyFingerprint).toBe(
      audioKeyFingerprint("llm.gemini", KEY),
    );
    expect(JSON.stringify(record)).not.toContain(KEY);
    // The script's model was the report model (`strong`), the script step
    // priced from the target, the second from the real script.
    if (second?.step !== "audio") throw new Error("no audio step");
    expect(second.plan.chunks).toHaveLength(CHUNKS);
    if (first?.step !== "script") throw new Error("no script step");
    expect(first.targetMinutes).toBe(1);
  });

  it("with a stored script: no script call, one confirmation", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.chats).toHaveLength(0);
    expect(h.citationReads).toHaveLength(0);
    expect(h.confirms.map((c) => c.step)).toEqual(["audio"]);
    expect(h.tts.requests).toHaveLength(CHUNKS);
    const first = h.confirms[0];
    expect(first?.disclosure.audio?.scriptCall).toBeUndefined();
    expect((await h.store.get("report-en-1"))?.audioAttachmentKeys?.en).toBe(
      output.delivered?.attachmentKey,
    );
  });

  it("reports one progress line, chunk n of N, during Synthesizing", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    await h.run();
    const chunks = h.views
      .filter((v) => v.stage === "Synthesizing" && v.chunk !== undefined)
      .map((v) => `${String(v.chunk?.done)}/${String(v.chunk?.total)}`);
    expect(chunks.at(-1)).toBe(`${String(CHUNKS)}/${String(CHUNKS)}`);
    expect(chunks).toContain(`1/${String(CHUNKS)}`);
    expect(h.views.at(-1)?.stage).toBe("done");
  });

  it("uses the window's voice and language, and resolves the model from tts.model", async () => {
    const h = await harness({ config: { ttsModel: "  " } });
    await h.run({ input: { voice: "Kore", language: "en" } });
    expect(h.tts.models).toEqual(["  "]);
    expect(h.tts.requests.every((r) => r.voice === "Kore")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Refused before any call (Done when, line 2)
// ---------------------------------------------------------------------------

describe("P6-T16 — refusals before any request", () => {
  it("strict mode with a free or unknown key is refused before any call, the key unread", async () => {
    const h = await harness({ mode: "strict" });
    const { prepared, output } = await h.run();
    expect(prepared).toMatchObject({
      status: "refused",
      refusal: "tier-refused",
    });
    expect(output.outcome).toBe("refused");
    expect(output.refusal).toBe("tier-refused");
    expectNothingSent(h);
    expect(h.tts.models).toHaveLength(0);
    expect(h.keyReads).toHaveLength(0);
    expect(h.confirms).toHaveLength(0);
  });

  it("strict mode with a declared paid key runs", async () => {
    const h = await harness({ mode: "strict", paid: true });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
  });

  it("a script model the mode refuses throws before the first confirmation", async () => {
    const h = await harness({
      mode: "strict",
      paid: true,
      model: {
        ...SAFE_MODEL,
        dataPolicy: {
          trainsOnInputByDefault: "unknown",
          retention: { days: "unknown", note: "" },
        },
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(PolicyViolationError);
    expect(h.confirms).toHaveLength(0);
    expectNothingSent(h);
  });

  it("a read-only library is refused before any call", async () => {
    const h = await harness();
    h.lib.editable = false;
    const { output } = await h.run();
    expect(output.refusal).toBe("read-only");
    expectNothingSent(h);
    expect(h.tts.models).toHaveLength(0);
    expect(h.keyReads).toHaveLength(0);
  });

  it("audio.enabled off is refused first, before the store is read", async () => {
    const h = await harness({ config: { audioEnabled: false } });
    const { output } = await h.run();
    expect(output.refusal).toBe("disabled");
    expectNothingSent(h);
    expect(h.keyReads).toHaveLength(0);
  });

  it("a report that is not stored is refused", async () => {
    const h = await harness();
    const { output } = await h.run({ input: { reportId: "report-gone" } });
    expect(output.refusal).toBe("no-report");
    expectNothingSent(h);
  });

  it("no Gemini key is refused before the model list is read", async () => {
    for (const key of [undefined, ""]) {
      const h = await harness({ key });
      const { output } = await h.run();
      expect(output.refusal).toBe("no-key");
      expect(h.tts.models).toHaveLength(0);
      expectNothingSent(h);
    }
  });

  it("a group library whose WAV is over 10 MiB with headroom is refused before the confirmation", async () => {
    // The shortest script whose padded estimate is linked though its own is not.
    let text: string;
    let sentences = 0;
    for (;;) {
      sentences += 1;
      text = SENTENCE.repeat(sentences).trim();
      const plan = estimateAudioPlan({
        reportId: "r",
        script: { text, language: "en" },
        chunks: chunkScript(text, { language: "en" }),
        model: TTS_MODEL,
        voice: "Charon",
        stylePrefix: STYLE_PREFIX,
        prices: undefined,
        atEpochMs: 0,
      });
      if (withHeadroom(plan.estimatedBytes) > IMPORT_MAX_BYTES) {
        expect(plan.estimatedBytes).toBeLessThanOrEqual(IMPORT_MAX_BYTES);
        break;
      }
    }
    const h = await harness({
      reports: [report({ libraryID: 7, audioScripts: { en: text } })],
    });
    h.lib.personal = false;
    const { output } = await h.run();
    expect(output.refusal).toBe("linked-needs-personal-library");
    expect(h.confirms).toHaveLength(0);
    expectNothingSent(h);
  });
});

// ---------------------------------------------------------------------------
// 7. Cancel, decline and failures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6a. Item 385: resolve after confirmation (owner, 2026-11-17)
// ---------------------------------------------------------------------------

describe("plan/00 §6 item 385 — the TTS model is resolved after the first confirmation", () => {
  const STORED = [report({ audioScripts: { en: LONG_SCRIPT } })];
  /** The fallback's documented figures, as a user override on another id. */
  const sameAsFallback = (modelId: string): UserPriceOverride => ({
    providerId: "gemini",
    modelId,
    inputPerMTokUsd: 0.5,
    outputPerMTokUsd: 10,
    asOfEpochMs: 0,
  });

  it("with tts.model empty, nothing reaches Google before the first confirmation is answered (script path)", async () => {
    const h = await harness({ config: { ttsModel: "" } });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
    // Asked first with nothing sent: no list read, no model call, no audio.
    expect(h.atConfirm[0]).toEqual({
      listReads: 0,
      resolves: 0,
      synthesis: 0,
      chats: 0,
    });
    // Priced with the marked fallback id, which no request produced.
    expect(h.confirms[0]?.disclosure.modelId).toBe(GEMINI_TTS_FALLBACK_MODEL);
    // Resolved once, after it; the second confirmation is priced on the
    // live model, before any synthesis.
    expect(h.tts.listReads).toHaveLength(1);
    expect(h.atConfirm[1]?.listReads).toBe(1);
    expect(h.atConfirm[1]?.synthesis).toBe(0);
    const second = h.confirms[1];
    if (second?.step !== "audio") throw new Error("no audio step");
    expect(second.plan.model).toBe(TTS_MODEL);
    expect(second.disclosure.modelId).toBe(TTS_MODEL);
    expect(h.tts.requests.every((r) => r.model === TTS_MODEL)).toBe(true);
  });

  it("with tts.model empty and a stored script, nothing reaches Google before the confirmation is answered", async () => {
    const h = await harness({
      config: { ttsModel: "" },
      reports: STORED,
      liveModel: GEMINI_TTS_FALLBACK_MODEL,
    });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.atConfirm[0]).toEqual({
      listReads: 0,
      resolves: 0,
      synthesis: 0,
      chats: 0,
    });
    const first = h.confirms[0];
    if (first?.step !== "audio") throw new Error("no audio step");
    expect(first.plan.model).toBe(GEMINI_TTS_FALLBACK_MODEL);
    // The live model is the quoted one: asked once only.
    expect(h.confirms).toHaveLength(1);
    expect(h.tts.listReads).toHaveLength(1);
    expect(h.tts.requests).toHaveLength(CHUNKS);
  });

  it("declining the first confirmation with tts.model empty sends nothing at all, the list read included", async () => {
    for (const reports of [undefined, STORED]) {
      const h = await harness({
        config: { ttsModel: "" },
        ...(reports !== undefined && { reports }),
      });
      const { output } = await h.run({ answers: [{ kind: "cancelled" }] });
      expect(output.outcome).toBe("declined");
      expect(h.tts.listReads).toHaveLength(0);
      expect(h.tts.models).toHaveLength(0);
      expectNothingSent(h);
    }
  });

  it("with tts.model set, the first confirmation is priced on it and nothing is sent before it", async () => {
    const h = await harness({
      config: { ttsModel: " set-tts-model " },
      reports: STORED,
    });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.atConfirm[0]).toEqual({
      listReads: 0,
      resolves: 0,
      synthesis: 0,
      chats: 0,
    });
    const first = h.confirms[0];
    if (first?.step !== "audio") throw new Error("no audio step");
    expect(first.plan.model).toBe("set-tts-model");
    expect(h.confirms).toHaveLength(1);
    expect(h.tts.listReads).toHaveLength(0);
    expect(h.tts.models).toEqual([" set-tts-model "]);
    expect(h.tts.requests.every((r) => r.model === "set-tts-model")).toBe(true);
  });

  it("estimate() with tts.model empty prices the fallback and sends nothing", async () => {
    const h = await harness({ config: { ttsModel: "" }, reports: STORED });
    const estimate = await h.pipeline.estimate(
      { reportId: "report-en-1", language: "en" },
      h.context("estimate", createCancellationTokenSource()),
    );
    expect(estimate.externalRequests).toBe(CHUNKS);
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(h.tts.listReads).toHaveLength(0);
    expect(h.tts.models).toHaveLength(0);
    expectNothingSent(h);
  });

  it("a live model priced differently from the quoted one is asked again before any synthesis", async () => {
    const h = await harness({
      config: { ttsModel: "" },
      reports: STORED,
      liveModel: "other-tts-model",
      overrides: [
        {
          providerId: "gemini",
          modelId: "other-tts-model",
          inputPerMTokUsd: 2,
          outputPerMTokUsd: 40,
          asOfEpochMs: 0,
        },
      ],
    });
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.confirms.map((c) => c.step)).toEqual(["audio", "audio"]);
    const [first, again] = h.confirms;
    if (first?.step !== "audio" || again?.step !== "audio") {
      throw new Error("no audio steps");
    }
    expect(first.plan.model).toBe(GEMINI_TTS_FALLBACK_MODEL);
    expect(again.plan.model).toBe("other-tts-model");
    expect(again.disclosure.modelId).toBe("other-tts-model");
    expect(again.plan.cost.usd).toBeGreaterThan(first.plan.cost.usd ?? 0);
    // The re-ask came after the list read and before any synthesis.
    expect(h.atConfirm[1]).toMatchObject({ listReads: 1, synthesis: 0 });
    expect(h.tts.requests.every((r) => r.model === "other-tts-model")).toBe(
      true,
    );
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("succeeded");
  });

  it("declining the re-ask cancels the record, synthesizes nothing and keeps the stored script", async () => {
    const h = await harness({
      config: { ttsModel: "" },
      reports: STORED,
      liveModel: "unpriced-tts-model",
    });
    const { output, jobId } = await h.run({
      answers: [{ kind: "run" }, { kind: "cancelled" }],
    });
    expect(output.outcome).toBe("cancelled");
    expect(h.confirms).toHaveLength(2);
    expect(h.tts.requests).toHaveLength(0);
    expect(h.lib.imports).toHaveLength(0);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toBe(
      LONG_SCRIPT,
    );
  });

  it("a live model with the quoted model's prices is used without asking again", async () => {
    const h = await harness({
      config: { ttsModel: "" },
      reports: STORED,
      liveModel: "same-price-tts-model",
      overrides: [sameAsFallback("same-price-tts-model")],
    });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.confirms).toHaveLength(1);
    expect(
      h.tts.requests.every((r) => r.model === "same-price-tts-model"),
    ).toBe(true);
  });

  it("a resolved model that cannot be read fails after the confirmation, with nothing synthesized", async () => {
    const h = await harness({ config: { ttsModel: "" }, reports: STORED });
    h.tts.tts.resolveModel = () =>
      Promise.reject(new AuthenticationError(401, "HTTP 401 from gemini"));
    const { output } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(h.confirms).toHaveLength(1);
    expect(h.tts.requests).toHaveLength(0);
  });

  it("the list read goes through the egress-log check", async () => {
    const h = await harness({ config: { ttsModel: "" }, reports: STORED });
    const { output } = await h.run({ enqueueWithoutLog: true });
    expect(output.outcome).toBe("failed");
    expect(h.tts.listReads).toHaveLength(0);
    expectNothingSent(h);
  });
});

describe("P6-T16 — declined, cancelled and failed runs", () => {
  it("declining the first confirmation sends nothing and makes no record", async () => {
    const h = await harness();
    const { output, jobId } = await h.run({
      answers: [{ kind: "cancelled" }],
    });
    expect(output.outcome).toBe("declined");
    expect(jobId).toBeUndefined();
    expectNothingSent(h);
    expect(await h.jobs.list()).toHaveLength(0);
  });

  it("declining the second confirmation keeps the script and synthesizes nothing", async () => {
    const h = await harness();
    const { output, jobId } = await h.run({
      answers: [{ kind: "run" }, { kind: "cancelled" }],
    });
    expect(output.outcome).toBe("cancelled");
    expect(h.chats).toHaveLength(1);
    expect(h.tts.requests).toHaveLength(0);
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toBe(
      LONG_SCRIPT,
    );
    expect(output.script?.text).toBe(LONG_SCRIPT);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
  });

  it("a script that still leaks after the retry fails, sends nothing to Google and offers the text", async () => {
    const h = await harness({ chat: [LEAKY, LEAKY] });
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(h.chats).toHaveLength(2);
    expect(h.tts.requests).toHaveLength(0);
    expect(output.failure?.reason).toBe("script-rejected");
    expect(output.failure?.offerScriptText).toBe(true);
    expect(output.script?.text).toBe(LEAKY);
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toBeUndefined();
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("failed");
  });

  it("a TTS failure keeps the script, fails the record and offers the text, not the audio", async () => {
    const h = await harness({
      ttsFail: new AuthenticationError(401, "HTTP 401 from gemini"),
    });
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(output.failure?.reason).toBe("unentitled");
    expect(output.failure?.messageKey).toBe("rh-error-tts");
    expect(output.failure?.offerScriptText).toBe(true);
    expect(output.failure?.offerAudioSaveAs).toBe(false);
    expect(output.audio).toBeUndefined();
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toBe(
      LONG_SCRIPT,
    );
    const record = await h.jobs.get(jobId ?? "");
    expect(record?.status).toBe("failed");
    expect(record?.error?.messageKey).toBe("rh-error-tts");
    expect(h.lib.imports).toHaveLength(0);
  });

  it("a written script whose WAV is over 10 MiB is refused for a group library before the second confirmation", async () => {
    const h = await harness({
      chat: [SENTENCE.repeat(260).trim()],
      reports: [report({ libraryID: 7 })],
    });
    h.lib.personal = false;
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("refused");
    expect(output.refusal).toBe("linked-needs-personal-library");
    expect(h.confirms.map((c) => c.step)).toEqual(["script"]);
    expect(h.tts.requests).toHaveLength(0);
    expect(output.script?.text).toContain("Tide gauges");
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toContain(
      "Tide gauges",
    );
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
  });

  it("a record without an audio egress log sends nothing", async () => {
    const h = await harness();
    const { output } = await h.run({ enqueueWithoutLog: true });
    expect(output.outcome).toBe("failed");
    expectNothingSent(h);
  });

  it("a library that turns read-only after synthesis fails and offers the assembled audio", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    const original = h.tts.tts.synthesize.bind(h.tts.tts);
    h.tts.tts.synthesize = async (request, ctx) => {
      const result = await original(request, ctx);
      if (h.tts.requests.length === CHUNKS) h.lib.editable = false;
      return result;
    };
    const { output, jobId } = await h.run();
    expect(output.outcome).toBe("failed");
    expect(output.refusal).toBe("read-only");
    expect(output.failure?.offerAudioSaveAs).toBe(true);
    expect(output.audio?.chunks).toHaveLength(CHUNKS);
    expect(output.audio?.sampleRateHz).toBe(24000);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("failed");
  });

  it("a cancel during synthesis discards the chunks, keeps the script and cancels the record", async () => {
    const h = await harness();
    const source = createCancellationTokenSource();
    const original = h.tts.tts.synthesize.bind(h.tts.tts);
    h.tts.tts.synthesize = async (request, ctx) => {
      const result = await original(request, ctx);
      source.cancel({ kind: "user" });
      return result;
    };
    const { output, jobId } = await h.run({ source });
    expect(output.outcome).toBe("cancelled");
    expect(output.audio).toBeUndefined();
    expect(output.failure?.cancelled).toBe(true);
    expect(output.failure?.offerScriptText).toBe(false);
    expect(output.script?.text).toBe(LONG_SCRIPT);
    expect(h.lib.imports).toHaveLength(0);
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toBe(
      LONG_SCRIPT,
    );
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
  });

  it("a cancel after the last chunk discards the assembled audio", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    const source = createCancellationTokenSource();
    const original = h.tts.tts.synthesize.bind(h.tts.tts);
    h.tts.tts.synthesize = async (request, ctx) => {
      const result = await original(request, ctx);
      if (h.tts.requests.length === CHUNKS) source.cancel({ kind: "user" });
      return result;
    };
    const { output, jobId } = await h.run({ source });
    expect(output.outcome).toBe("cancelled");
    expect(output.audio).toBeUndefined();
    expect(h.lib.imports).toHaveLength(0);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
  });

  it("a cancel while attaching discards the assembled audio", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    const source = createCancellationTokenSource();
    h.lib.beforeAttach = () => {
      source.cancel({ kind: "user" });
      throw new OperationCancelledError({ kind: "user" });
    };
    const { output, jobId } = await h.run({ source });
    expect(h.tts.requests).toHaveLength(CHUNKS);
    expect(output.outcome).toBe("cancelled");
    expect(output.audio).toBeUndefined();
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
  });

  it("an empty stored script is written again", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: "" } })],
    });
    const { output } = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.chats).toHaveLength(1);
    expect(h.confirms.map((c) => c.step)).toEqual(["script", "audio"]);
  });

  it("a shutdown leaves the record for recover()", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    const source = createCancellationTokenSource();
    const original = h.tts.tts.synthesize.bind(h.tts.tts);
    h.tts.tts.synthesize = async (request, ctx) => {
      const result = await original(request, ctx);
      source.cancel({ kind: "shutdown" });
      return result;
    };
    const { output, jobId } = await h.run({ source });
    expect(output.outcome).toBe("interrupted");
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// 8. The budget stop, the tier answer and the first use
// ---------------------------------------------------------------------------

describe("P6-T16 — budget stops, the tier answer and the first use", () => {
  it("a budget stop pauses and asks; continue raises the ceiling and re-sends the pending chunk", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
      refuseReservation: 2,
    });
    const { output, jobId } = await h.run({ ask: "resume" });
    expect(output.outcome).toBe("succeeded");
    expect(h.asks).toHaveLength(1);
    const question = h.asks[0];
    if (question?.reason !== "budget-stop") throw new Error("no budget stop");
    expect(question.stop.ceiling).toBe("run");
    expect(h.raised).toEqual([["run", question.raiseToUsd]]);
    // Chunk 1 once, chunk 2 after the pause, then the rest: N requests.
    expect(h.tts.requests).toHaveLength(CHUNKS);
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("succeeded");
  });

  it("a budget stop answered 'stop' cancels and keeps the script", async () => {
    const h = await harness({ refuseReservation: 1 });
    const { output, jobId } = await h.run({ ask: "cancel" });
    expect(output.outcome).toBe("cancelled");
    expect(h.tts.requests).toHaveLength(0);
    expect((await h.store.get("report-en-1"))?.audioScripts.en).toBe(
      LONG_SCRIPT,
    );
    expect((await h.jobs.get(jobId ?? ""))?.status).toBe("cancelled");
  });

  it("the confirmation's raise is applied before the first call", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    await h.run({
      answers: [{ kind: "run", raise: { ceiling: "session", limitUsd: 3 } }],
    });
    expect(h.raised).toEqual([["session", 3]]);
  });

  it("the tier question is asked once, and its answer is recorded", async () => {
    const h = await harness();
    const paid: OfferedTierAnswer = "paid";
    await h.run({ answers: [{ kind: "run", tierAnswer: paid }] });
    expect(h.confirms.map((c) => c.askTierQuestion)).toEqual([true, false]);
    expect(h.tierWrites).toEqual(["paid", "paidTier"]);
  });

  it("no tier question once answered", async () => {
    const h = await harness({ tierAnswer: "unknown" });
    await h.run();
    expect(h.confirms.map((c) => c.askTierQuestion)).toEqual([false, false]);
    expect(h.tierWrites).toEqual([]);
  });

  it("the first job with a key shows the first-use notice; the next one does not", async () => {
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    await h.run();
    await h.run();
    const [first, second] = h.confirms;
    expect(first?.disclosure.audio?.firstUseWithKey).toBe(true);
    expect(second?.disclosure.audio?.firstUseWithKey).toBe(false);
  });

  it("only an audio job's record counts as an earlier use of the key", async () => {
    const earlier = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    const { jobId } = await earlier.run();
    const logged = (await earlier.jobs.get(jobId ?? ""))?.input;
    expect(logged).toBeDefined();
    const h = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
    });
    // Another pipeline's record carrying the same audio log is not a use.
    await h.jobs.enqueue("summarize", logged);
    await h.run();
    expect(h.confirms[0]?.disclosure.audio?.firstUseWithKey).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. The companion record and the store's lookups
// ---------------------------------------------------------------------------

describe("P6-T16 — the both run's companion and ReportStore's lookups", () => {
  const AT = Date.UTC(2026, 10, 17);
  const english = report({ id: "report-en-1", generatedAtEpochMs: AT });
  const korean = report({
    id: "report-ko-1",
    language: "ko",
    generatedAtEpochMs: AT,
    sections: [
      {
        number: 1,
        heading: "1. 요약",
        markdown: "- 한국어 요약 [[KEY00003]].",
        citedItemKeys: ["KEY00003"],
      },
    ],
  });

  it("a Korean script for an English report is written from the Korean companion and stored on the job's record", async () => {
    const h = await harness({
      reports: [english, korean],
      chat: ["한국어 대본입니다. 해수면이 천천히 오르고 있습니다."],
    });
    const { output } = await h.run({ input: { language: "ko" } });
    expect(output.outcome).toBe("succeeded");
    expect(h.citationReads.at(-1)).toEqual(["KEY00003"]);
    expect(h.chats[0]?.messages[1]?.content).toContain("한국어 요약");
    const job = await h.store.get("report-en-1");
    expect(job?.audioScripts.ko).toContain("한국어 대본");
    expect(job?.audioAttachmentKeys?.ko).toBe(output.delivered?.attachmentKey);
    expect((await h.store.get("report-ko-1"))?.audioScripts).toEqual({});
  });

  it("companionOf finds the other language of the same instant only", async () => {
    const h = await harness({
      reports: [
        english,
        korean,
        report({ id: "report-en-2", generatedAtEpochMs: AT }),
        report({ id: "report-ko-old", language: "ko", generatedAtEpochMs: 1 }),
        report({
          id: "report-ko-other",
          language: "ko",
          collectionKey: "COLL0002",
          generatedAtEpochMs: AT,
        }),
      ],
    });
    expect((await h.store.companionOf(english))?.id).toBe("report-ko-1");
    expect((await h.store.companionOf(korean))?.id).toBe("report-en-1");
    expect(
      await h.store.companionOf(
        report({ id: "report-en-9", generatedAtEpochMs: 5 }),
      ),
    ).toBeUndefined();
  });

  it("latestForCollection is the newest record, the smaller id on a tie", async () => {
    const h = await harness({
      reports: [
        report({ id: "report-a", generatedAtEpochMs: 10 }),
        report({ id: "report-c", generatedAtEpochMs: 30 }),
        report({ id: "report-b", generatedAtEpochMs: 30 }),
        report({
          id: "report-z",
          collectionKey: "COLL0009",
          generatedAtEpochMs: 99,
        }),
        report({ id: "report-y", libraryID: 2, generatedAtEpochMs: 99 }),
      ],
    });
    expect((await h.store.latestForCollection(1, "COLL0001"))?.id).toBe(
      "report-b",
    );
    expect(await h.store.latestForCollection(1, "COLL0404")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10. The contract and the construction (Done when, line 3)
// ---------------------------------------------------------------------------

describe("P6-T16 — the pipeline contract and buildPipelineSet", () => {
  it("is not resumable and declares §12.6's stages", async () => {
    const h = await harness();
    expect(h.pipeline.id).toBe("audioReport");
    expect(h.pipeline.resumable).toBe(false);
    expect(AUDIO_REPORT_STAGES.map((s) => s.key)).toEqual([
      "Scripting",
      "AwaitingConfirm",
      "Synthesizing",
      "Attaching",
    ]);
    expect(audioReportExclusivityKey({ reportId: "r1" })).toBe(
      "audioReport:r1",
    );
  });

  it("validates the input", async () => {
    const h = await harness();
    expect(h.pipeline.validate({ reportId: "r", language: "auto" }).ok).toBe(
      true,
    );
    const bad = h.pipeline.validate({
      reportId: "",
      language: "fr" as "en",
      voice: " ",
    });
    expect(bad.errors.map((e) => e.field)).toEqual([
      "reportId",
      "language",
      "voice",
    ]);
  });

  it("audioJobInput refuses an unconfirmed run", () => {
    const declined: PreparedAudioReport = {
      status: "declined",
      input: { reportId: "r", language: "en" },
    };
    expect(() => audioJobInput(declined, 0)).toThrow(/after its confirmation/u);
  });

  it("run() with no surface declines and cancels its queued record", async () => {
    const h = await harness();
    const record = await h.jobs.enqueue("audioReport", {
      reportId: "report-en-1",
      language: "en",
    });
    const output = await h.pipeline.run(
      { reportId: "report-en-1", language: "en" },
      h.context(record.id, createCancellationTokenSource()),
    );
    expect(output.outcome).toBe("declined");
    expect((await h.jobs.get(record.id))?.status).toBe("cancelled");
    expectNothingSent(h);
  });

  it("estimate() prices the script step, or the stored script's plan, and asks nothing", async () => {
    const h = await harness({
      overrides: [
        {
          providerId: "gemini",
          modelId: TTS_MODEL,
          inputPerMTokUsd: 1,
          outputPerMTokUsd: 10,
          asOfEpochMs: 0,
        },
      ],
    });
    const fresh = await h.pipeline.estimate(
      { reportId: "report-en-1", language: "en" },
      h.context("estimate", createCancellationTokenSource()),
    );
    expect(fresh.externalRequests).toBeGreaterThan(2);
    expect(fresh.estimatedOutputTokens).toBeGreaterThan(0);
    expect(h.confirms).toHaveLength(0);
    expectNothingSent(h);

    const s = await harness({
      reports: [report({ audioScripts: { en: LONG_SCRIPT } })],
      overrides: [
        {
          providerId: "gemini",
          modelId: TTS_MODEL,
          inputPerMTokUsd: 1,
          outputPerMTokUsd: 10,
          asOfEpochMs: 0,
        },
      ],
    });
    const stored = await s.pipeline.estimate(
      { reportId: "report-en-1", language: "en" },
      s.context("estimate", createCancellationTokenSource()),
    );
    expect(stored.externalRequests).toBe(CHUNKS);
    expect(stored.estimatedCostUsd).toBeGreaterThan(0);
    expect(s.confirms).toHaveLength(0);
  });

  it("voices() lists the TTS client's voices for the language, and sends nothing", async () => {
    const h = await harness();
    const voices = await h.pipeline.voices(
      "ko",
      createCancellationTokenSource().token,
    );
    expect(voices.map((v) => v.id)).toEqual(["Charon", "Kore"]);
    expect(h.tts.voiceLanguages).toEqual(["ko"]);
    expectNothingSent(h);
  });

  it("the headless surface confirms nothing", async () => {
    expect(await HEADLESS_AUDIO_REPORT_SURFACE.confirm({} as never)).toEqual({
      kind: "cancelled",
    });
    expect(await HEADLESS_AUDIO_REPORT_SURFACE.pickFolder()).toBeUndefined();
  });

  it("buildPipelineSet supplies audioReport with its deps, and none without", async () => {
    const writer = {} as Parameters<typeof buildPipelineSet>[0]["writer"];
    expect(buildPipelineSet({ writer })).not.toHaveProperty("audioReport");
    const h = await harness();
    const given: AudioReportConstructionDeps = {
      reports: h.deps.reports,
      tts: h.deps.tts,
      ttsKey: h.deps.ttsKey,
      priceOverrides: h.deps.priceOverrides,
      library: {
        citations: h.deps.citations,
        attachments: h.deps.attachments,
      },
    };
    const set = buildPipelineSet({ writer, audioReport: given });
    expect(set.audioReport?.id).toBe("audioReport");
    expect(set.audioReport?.resumable).toBe(false);
  });
});

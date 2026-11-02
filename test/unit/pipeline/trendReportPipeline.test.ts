/**
 * `P4-T18` — the trend-report pipeline: every stage in order, the pass count,
 * the cache probes, cancel, every stop outcome, the 30 % failure rule, the
 * pause on a budget refusal, the restart through the queue's spend guards,
 * and the report run's own "don't ask again".
 *
 * No network and no model: every answer comes from `test/helpers/mockLLM.ts`
 * through the real router and `withBudget`; the cache, the `summary`, `report`
 * and `job` tables are the real ones over `node:sqlite` in memory, the report
 * Markdown files an in-memory map. Every paper is synthetic text written here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { sha256Hex } from "../../../src/core/cache/keys";
import {
  createSqliteCache,
  type CacheBlobStore,
} from "../../../src/core/cache/sqliteCache";
import { createManualClock } from "../../../src/core/clock";
import {
  BudgetExceededError,
  UpstreamServerError,
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
  createRunningWork,
  type JobQueue,
  type ResumeGuards,
} from "../../../src/core/jobQueue/queue";
import type { JobRecord } from "../../../src/core/jobQueue/jobRecord";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import type { ChatRequest } from "../../../src/llm/types";
import {
  PAPER_SUMMARY_SCHEMA_VERSION,
  type AcquiredSource,
  type PaperSummary,
} from "../../../src/model/summary";
import {
  createBudgetGuard,
  createCeilingsResumeGuard,
  createConfirmResumeGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import {
  egressLogEntry,
  withEgressLog,
} from "../../../src/pipeline/shared/egressDisclosure";
import {
  createPrivacyPolicy,
  readCollectionPrivacySettings,
  writeCollectionPrivacySettings,
  type CollectionRef,
  type RoutineConfirmation,
} from "../../../src/pipeline/shared/privacyPolicy";
import {
  createJobNoticeRouter,
  type SummarizeLibraryItem,
  type SummarizeQuestion,
} from "../../../src/pipeline/summarize/summarizePipeline";
import { expectedHeadings } from "../../../src/pipeline/trendReport/compose";
import { EN_REPORT_LABELS } from "../../../src/pipeline/trendReport/reportLabels";
import {
  createTrendReportPipeline,
  FAILED_PAPERS_SHARE,
  isTrendReportCheckpoint,
  STOPPED_CODE,
  stopName,
  NO_PAPERS_L10N,
  PAPERS_FAILED_L10N,
  remainingFromCheckpoint,
  stageSpendOf,
  tooManyPapersFailed,
  TREND_REPORT_STAGES,
  trendReportExclusivityKey,
  withDatedTitle,
  type TrendReportConfirmRequest,
  type TrendReportInput,
  type TrendReportOutput,
  type TrendReportPipeline,
  type TrendReportSurface,
  createDeferredTrendReportSurface,
} from "../../../src/pipeline/trendReport/trendReportPipeline";
import {
  stageSlices,
  type ConfigReader,
  type PipelineContext,
} from "../../../src/pipeline/types";
import { getPref, type PrefName } from "../../../src/prefs";
import {
  createPromptRegistry,
  type PromptRegistry,
} from "../../../src/prompts";
import {
  citationSpan,
  escapeHtml,
  type BibliographyPort,
  type CitationNode,
} from "../../../src/zotero/bibliography";
import {
  createJobStore,
  createReportStore,
  createSummaryStore,
  type CollectionSettingsStore,
  type ReportMarkdownFiles,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";
import type {
  ReportNoteOutcome,
  ReportNoteRequest,
} from "../../../src/zotero/notes";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
  type MockCall,
} from "../../helpers/mockLLM";

const here = dirname(fileURLToPath(import.meta.url));
const promptDir = resolve(here, "../../../src/prompts");

const PROMPTS: PromptRegistry = createPromptRegistry(
  readdirSync(promptDir)
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => ({
      fileName,
      text: readFileSync(resolve(promptDir, fileName), "utf8"),
    })),
);
const HEADINGS = expectedHeadings(PROMPTS.get("TREND_REPORT_EN"));

const COLLECTION: CollectionRef = { libraryID: 1, collectionKey: "COLLKEY1" };

/** A synthetic Zotero item key: `K` and seven digits. */
function key(i: number): string {
  return `K${String(i).padStart(7, "0")}`;
}

// ---------------------------------------------------------------------------
// The synthetic collection
// ---------------------------------------------------------------------------

function abstractOf(i: number): string {
  return (
    `Background: synthetic study ${key(i)} of a made-up intervention. ` +
    "The intervention reduced the primary outcome by 42 percent. " +
    "Conclusion: the effect held in 1,204 patients."
  );
}

function sourceOf(i: number): AcquiredSource {
  const text = abstractOf(i);
  return {
    itemKey: key(i),
    libraryID: 1,
    tier: "abstract",
    abstract: text,
    sections: [],
    sectionAware: false,
    text,
    charCount: text.length,
    estTokens: Math.ceil(text.length / 4),
    truncated: false,
    attachmentKey: null,
    contentHash: sha256Hex(text),
    warnings: [],
  };
}

function itemOf(i: number): SummarizeLibraryItem {
  const k = key(i);
  return {
    itemID: 1000 + i,
    itemKey: k,
    libraryID: 1,
    workKey: `doi:10.1234/${k.toLowerCase()}`,
    metadata: {
      title: `Study ${k} alpha`,
      authors: [`Author${k}, Ann`],
      year: 2018 + (i % 6),
      venue: "Journal of Synthetic Fixtures",
      itemType: "journalArticle",
      doi: `10.1234/${k.toLowerCase()}`,
      tags: [],
    },
    dateModified: "2026-10-01 00:00:00",
    screen: {
      key: k,
      itemID: 1000 + i,
      itemType: "journalArticle",
      title: `Study ${k} alpha`,
      year: 2018 + (i % 6),
      firstAuthorFamily: `Author${k}`,
      containerTitle: "Journal of Synthetic Fixtures",
      doi: `10.1234/${k.toLowerCase()}`,
      abstractLength: abstractOf(i).length,
      hasFullText: false,
      dateAdded: `2026-01-01 00:00:${String(i % 60).padStart(2, "0")}`,
      retraction: { zotero: { retracted: false, reasons: [] } },
    },
  };
}

// ---------------------------------------------------------------------------
// The scripted model: answers by what each request is
// ---------------------------------------------------------------------------

function userOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "user")?.content ?? "";
}

/** Which level a request belongs to (`docs/06` §8.3's L0–L4). */
type Level = "L0" | "L1" | "L2" | "L3" | "L4";

function levelOf(request: ChatRequest): Level {
  const format = request.responseFormat;
  if (format?.kind === "json_schema") {
    if (format.name === "ThemeClustering" || format.name === "ThemeMerge") {
      return "L1";
    }
    if (format.name === "ThemeAnalysis") return "L2";
    if (format.name === "SelfCritique") return "L4";
    return "L0";
  }
  return "L3";
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function summaryAnswer(): string {
  const summary: PaperSummary = {
    schemaVersion: PAPER_SUMMARY_SCHEMA_VERSION,
    itemKey: "WRONGKEY",
    sourceTier: "abstract",
    confidence: "high",
    researchQuestion: "Does the intervention reduce the primary outcome?",
    studyDesign: { label: "randomized_controlled_trial", detail: null },
    population: { kind: "human", description: "Synthetic", size: "1,204" },
    methods: ["randomization"],
    keyFindings: [
      {
        statement: "The intervention reduced the outcome.",
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport:
          "The intervention reduced the primary outcome by 42 percent.",
      },
    ],
    effectSizes: [{ metric: "relative reduction", value: "42 percent" }],
    limitations: ["Synthetic data."],
    novelty: null,
    keywords: ["synthetic trial"],
    researchTheme: "Synthetic Trials",
    citationWorthiness: { score: 50, reason: "Synthetic." },
  };
  return JSON.stringify(summary);
}

function clusteringAnswer(request: ChatRequest): string {
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/\[(K\d{7})\]/g),
      (m) => m[1] as string,
    ),
  );
  const half = Math.ceil(keys.length / 2);
  const groups = [keys.slice(0, half), keys.slice(half)];
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
  const themeId = /"themeId": "(T\d+)"/.exec(user)?.[1] ?? "T1";
  const keys = unique(
    Array.from(user.matchAll(/"itemKey":"(K\d{7})"/g), (m) => m[1] as string),
  );
  return JSON.stringify({
    themeId,
    name: "echo",
    narrative: `Work in this theme ${keys
      .slice(0, 3)
      .map((k) => `[[${k}]]`)
      .join(" ")} reduced the outcome.`,
    representativePapers: keys
      .slice(0, 2)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  });
}

function reportAnswer(request: ChatRequest): string {
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/\[\[(K\d{7})\]\]/g),
      (m) => m[1] as string,
    ),
  );
  return HEADINGS.map((heading, index) => {
    const n = index + 1;
    const body =
      n === 11
        ? keys.map((k, i) => `${String(i + 1)}. [[${k}]]`).join("\n")
        : `Finding ${String(n)} reported a 12% change [[${keys[(n - 1) % keys.length] as string}]].`;
    return `## ${heading}\n\n${body}\n`;
  }).join("\n");
}

const USAGE = {
  inputTokens: 1_000,
  outputTokens: 200,
  totalTokens: 1_200,
  costUsd: 0.001,
};

type Override = (
  call: MockCall,
  level: Level,
) =>
  | ReturnType<typeof chatResponse>
  | Error
  | Promise<ReturnType<typeof chatResponse>>
  | undefined;

function answering(override?: Override) {
  return (call: MockCall) => {
    const level = levelOf(call.request);
    const own = override?.(call, level);
    if (own !== undefined) return own;
    switch (level) {
      case "L0":
        return chatResponse(summaryAnswer(), { usage: USAGE });
      case "L1":
        return chatResponse(clusteringAnswer(call.request), { usage: USAGE });
      case "L2":
        return chatResponse(analysisAnswer(call.request), { usage: USAGE });
      case "L4":
        return chatResponse(JSON.stringify({ verdict: "pass", problems: [] }), {
          usage: USAGE,
        });
      default:
        return chatResponse(reportAnswer(call.request), { usage: USAGE });
    }
  };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

function sqlite(): SqlConnection & { readonly db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
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

function memoryBlobs(): CacheBlobStore {
  const files = new Map<string, string>();
  return {
    write: (name, text) => (files.set(name, text), Promise.resolve()),
    read: (name) => Promise.resolve(files.get(name)),
    remove: (name) => (files.delete(name), Promise.resolve()),
    list: () => Promise.resolve([...files.keys()]),
  };
}

function memoryFiles(): ReportMarkdownFiles & {
  readonly files: Map<string, string>;
} {
  const files = new Map<string, string>();
  return {
    files,
    write: (id, text) => (files.set(id, text), Promise.resolve()),
    read: (id) => Promise.resolve(files.get(id)),
    exists: (id) => Promise.resolve(files.has(id)),
    remove: (id) => (files.delete(id), Promise.resolve()),
  };
}

function memorySettings(): CollectionSettingsStore & {
  readonly rows: Map<string, Record<string, unknown>>;
} {
  const rows = new Map<string, Record<string, unknown>>();
  const id = (libraryID: number, collectionKey: string): string =>
    `${String(libraryID)}/${collectionKey}`;
  return {
    rows,
    get: (l, c) => Promise.resolve(rows.get(id(l, c))),
    put: (l, c, settings) => (
      rows.set(id(l, c), { ...settings }),
      Promise.resolve()
    ),
    delete: (l, c) => (rows.delete(id(l, c)), Promise.resolve()),
  };
}

const SILENT_PROGRESS: ProgressReporter = {
  setMessage: () => undefined,
  setProgress: () => undefined,
  increment: () => undefined,
  child: () => SILENT_PROGRESS,
  warn: () => undefined,
  done: () => undefined,
};

/** $0.10 / $0.40 per million tokens: priced, and far below any threshold. */
const PRICES: ModelPrices = {
  inputPerMTokUsd: 0.1,
  outputPerMTokUsd: 0.4,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: 0,
  source: "documented-table",
};

function citationNode(itemKey: string): CitationNode {
  const uri = `http://zotero.org/users/local/abcdefgh/items/${itemKey}`;
  const citationItem = {
    uris: [uri],
    itemData: { id: uri, type: "article-journal", title: `Title ${itemKey}` },
  };
  const text = `Author ${itemKey}, 2020`;
  return {
    itemKey,
    uri,
    selectUri: `zotero://select/library/items/${itemKey}`,
    text,
    html: citationSpan(
      citationItem,
      `(<span class="citation-item">${escapeHtml(text)}</span>)`,
    ),
    citationItem,
  };
}

const BIBLIOGRAPHY: BibliographyPort = {
  userCitationStyle: () => Promise.resolve(undefined),
  formatBibliography: (keys, request) =>
    Promise.resolve({
      styleId: request.styleId,
      locale: request.locale,
      entries: keys.map((itemKey, i) => ({
        itemKey,
        index: i + 1,
        text: `Author ${itemKey} (2020). Title ${itemKey}.`,
        doi: undefined,
      })),
      styleNumbered: false,
      citationList: false,
    }),
  formatRetracted: () => Promise.resolve([]),
  citationNodes: (keys) => Promise.resolve(keys.map(citationNode)),
};

interface HarnessOptions {
  readonly papers?: number;
  readonly override?: Override;
  readonly config?: Partial<Record<PrefName, unknown>>;
  /** The same database and cache as an earlier harness (a restart). */
  readonly reuse?: Pick<
    Harness,
    "connection" | "cacheBlobs" | "files" | "settings"
  >;
  readonly answer?: (q: SummarizeQuestion) => "resume" | "cancel";
}

interface Harness {
  readonly connection: ReturnType<typeof sqlite>;
  readonly cacheBlobs: CacheBlobStore;
  readonly files: ReturnType<typeof memoryFiles>;
  readonly settings: ReturnType<typeof memorySettings>;
  readonly jobs: JobQueue;
  readonly provider: ReturnType<typeof mockLLM>;
  readonly pipeline: TrendReportPipeline;
  readonly notes: ReportNoteRequest[];
  readonly confirms: TrendReportConfirmRequest[];
  readonly asks: SummarizeQuestion[];
  readonly clock: ReturnType<typeof createManualClock>;
  context(
    jobId: string,
    source: CancellationTokenSource,
    resumeState?: unknown,
  ): PipelineContext;
  run(options?: {
    readonly input?: Partial<TrendReportInput>;
    readonly surface?: Partial<TrendReportSurface>;
    readonly source?: CancellationTokenSource;
    readonly dontAskAgain?: boolean;
  }): Promise<TrendReportOutput & { readonly jobId: string | undefined }>;
  reportRows(): number;
  summaryRows(): number;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const connection = options.reuse?.connection ?? sqlite();
  if (options.reuse === undefined) await runMigrations(connection);
  const clock = createManualClock();
  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const cacheBlobs = options.reuse?.cacheBlobs ?? memoryBlobs();
  const cache = createSqliteCache({
    connection: () => Promise.resolve(connection),
    blobs: cacheBlobs,
    clock,
    logger,
    maxBytes: () => 1024 * 1024 * 1024,
  });
  const store = createSummaryStore(connection);
  const files = options.reuse?.files ?? memoryFiles();
  const reports = createReportStore(connection, files);
  const settings = options.reuse?.settings ?? memorySettings();
  const router = createJobNoticeRouter();
  const jobs = createJobQueue({
    clock,
    logger,
    pluginVersion: "0.0.0-test",
    isResumable: (id) => id === "trendReport",
    notifier: router.notifier,
  });
  jobs.attachStore(createJobStore(connection));
  const provider = mockLLM([answering(options.override)], { streaming: true });
  const llm = withBudget(
    mockLLMRouter(
      [provider],
      mockSettings({
        summaryModel: "summary-model",
        reportModel: "report-model",
        keyPresent: { openrouter: true },
      }),
    ),
    { pricesFor: () => PRICES, now: () => clock.now() },
  );
  const items = Array.from({ length: options.papers ?? 30 }, (_, i) =>
    itemOf(i + 1),
  );
  const notes: ReportNoteRequest[] = [];
  const confirms: TrendReportConfirmRequest[] = [];
  const asks: SummarizeQuestion[] = [];
  const session = createSessionSpendCounter();
  const pipeline = createTrendReportPipeline({
    library: {
      loadCollection: () =>
        Promise.resolve({ name: "Synthetic", editable: true, items }),
      acquire: (item) =>
        Promise.resolve({ source: sourceOf(Number(item.itemKey.slice(1))) }),
      bibliography: BIBLIOGRAPHY,
      writeReportNote: (request): Promise<ReportNoteOutcome> => {
        notes.push(request);
        return Promise.resolve({ kind: "written", noteKey: "NOTEKEY1" });
      },
    },
    summaries: () => Promise.resolve(store),
    reports: () => Promise.resolve(reports),
    prompts: () => Promise.resolve(PROMPTS),
    queue: jobs,
    pool: createLlmPool(() => 2),
    admission: createJobAdmission(),
    runningWork: createRunningWork(),
    pauseNotices: router,
    prices: () => PRICES,
    baseUrls: { effectiveHost: () => "openrouter.ai" },
    egressAcknowledged: () => true,
    modelInfo: (_provider, id) =>
      mockModel(id, {
        contextWindowTokens: 200_000,
        maxOutputTokens: 64_000,
        dataPolicy: {
          trainsOnInputByDefault: "no",
          retention: { days: "zero", note: "" },
        },
      }),
    credentials: { hasKey: () => Promise.resolve(true) },
    routine: {
      read: async (c) =>
        readCollectionPrivacySettings(
          await settings.get(c.libraryID, c.collectionKey),
        ).reportRoutineConfirmation,
      write: (c, record) =>
        writeCollectionPrivacySettings(settings, c, {
          reportRoutineConfirmation: record,
        }),
    },
    pluginVersion: "0.0.0-test",
    newReportId: (() => {
      let n = 0;
      return () => `report-${String((n += 1))}`;
    })(),
  });
  const values: Partial<Record<PrefName, unknown>> = {
    reportMaxCritiqueRounds: 1,
    reportSaveNote: true,
    cacheEnabled: true,
    ...options.config,
  };
  const config = {
    get: (name: PrefName) => (name in values ? values[name] : getPref(name)),
  } as unknown as ConfigReader;

  const context = (
    jobId: string,
    source: CancellationTokenSource,
    resumeState?: unknown,
  ): PipelineContext => ({
    jobId,
    token: source.token,
    progress: SILENT_PROGRESS,
    logger,
    cache,
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
    checkpoint: (state) =>
      jobId === "prepare-only"
        ? Promise.resolve()
        : jobs.writeCheckpoint(jobId, state).then(() => undefined),
    resumeState,
  });

  const h: Harness = {
    connection,
    cacheBlobs,
    files,
    settings,
    jobs,
    provider,
    pipeline,
    notes,
    confirms,
    asks,
    clock,
    context,
    async run(runOptions = {}) {
      const input: TrendReportInput = {
        ...COLLECTION,
        language: "en",
        ...runOptions.input,
      };
      const source = runOptions.source ?? createCancellationTokenSource();
      const surface: TrendReportSurface = {
        update: () => undefined,
        confirm: (request) => {
          confirms.push(request);
          return Promise.resolve({
            kind: "run",
            plan: "selected",
            raise: undefined,
            dontAskAgain: runOptions.dontAskAgain ?? false,
          });
        },
        ask: (question) => {
          asks.push(question);
          return Promise.resolve(options.answer?.(question) ?? "cancel");
        },
        ...runOptions.surface,
      };
      const prepared = await pipeline.prepare(
        input,
        context("prepare-only", source),
        surface,
      );
      if (prepared.status === "declined") {
        return {
          ...(await pipeline.execute(
            prepared,
            context("none", source),
            surface,
          )),
          jobId: undefined,
        };
      }
      const record = await jobs.enqueue(
        "trendReport",
        prepared.disclosure === undefined
          ? input
          : withEgressLog(input, egressLogEntry(prepared.disclosure, 0)),
      );
      const output = await pipeline.execute(
        prepared,
        context(record.id, source),
        surface,
      );
      return { ...output, jobId: record.id };
    },
    reportRows: () =>
      (
        connection.db.prepare("SELECT COUNT(*) AS n FROM report").get() as {
          n: number;
        }
      ).n,
    summaryRows: () =>
      (
        connection.db.prepare("SELECT COUNT(*) AS n FROM summary").get() as {
          n: number;
        }
      ).n,
  };
  return h;
}

function levels(calls: readonly MockCall[]): Level[] {
  return calls.map((call) => levelOf(call.request));
}

/** Resolves once the job's checkpoint reaches `stage`. */
async function untilCheckpoint(
  jobs: JobQueue,
  jobId: () => string | undefined,
  stage: string,
): Promise<JobRecord> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const id = jobId();
    if (id !== undefined) {
      const record = await jobs.get(id);
      if (
        isTrendReportCheckpoint(record?.checkpoint) &&
        record.checkpoint.stage === stage
      ) {
        return record;
      }
    }
    await new Promise((done) => setTimeout(done, 2));
  }
  throw new Error(`no checkpoint at ${stage}`);
}

// ---------------------------------------------------------------------------
// 1. Every stage, the pass count, the save
// ---------------------------------------------------------------------------

describe("P4-T18 — a mock run over 30 items saves one report (Done when 1)", () => {
  it("runs every stage in order and the header's pass count equals the levels L1–L4 that sent calls", async () => {
    const h = await harness();
    const output = await h.run();
    expect(output.outcome).toBe("succeeded");
    const seen = levels(h.provider.calls);
    // Estimate and confirmation before anything is summarized (item 290).
    expect(h.confirms).toHaveLength(1);
    expect(seen.filter((l) => l === "L0")).toHaveLength(30);
    // The stages ran in order: summaries, clustering, themes, report, critique.
    const firstOf = (l: Level): number => seen.indexOf(l);
    expect(firstOf("L0")).toBeLessThan(firstOf("L1"));
    expect(firstOf("L1")).toBeLessThan(firstOf("L2"));
    expect(firstOf("L2")).toBeLessThan(firstOf("L3"));
    expect(firstOf("L3")).toBeLessThan(firstOf("L4"));
    const synthesisLevels = new Set(seen.filter((l) => l !== "L0"));
    expect(synthesisLevels.size).toBe(4);
    // One pass per level here: one clustering call, one theme level (two
    // themes in parallel), one composition, one critique round.
    expect(seen.filter((l) => l === "L1")).toHaveLength(1);
    expect(seen.filter((l) => l === "L2")).toHaveLength(2);
    expect(output.passes).toBe(synthesisLevels.size);
    const report = output.report;
    expect(report?.reductionPasses).toBe(4);
    expect(report?.markdown).toContain(
      EN_REPORT_LABELS.paramReductionPasses.replace("{passes}", "4"),
    );
    // One report: one row, one file, one note; the row carries the note key.
    expect(h.reportRows()).toBe(1);
    expect(h.files.files.size).toBe(1);
    expect(h.notes).toHaveLength(1);
    expect(report?.zoteroNoteKey).toBe("NOTEKEY1");
    expect(report?.scope.analysedCount).toBe(30);
    // The dated title is the note's and the Markdown's first line (P4-T14).
    expect(report?.title).toMatch(
      /^Research Trends: Synthetic \(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\)$/,
    );
    expect(report?.markdown.split("\n")[0]).toBe(`# ${report?.title ?? ""}`);
    const record = await h.jobs.get(output.jobId as string);
    expect(record?.status).toBe("succeeded");
    expect(record?.resultRef).toEqual({ kind: "report", key: report?.id });
  });

  it("declares stages whose weights make one progress bar", () => {
    expect(stageSlices(TREND_REPORT_STAGES).at(-1)?.to).toBe(1);
    expect(TREND_REPORT_STAGES.map((s) => s.key)).toEqual([
      "Screening",
      "Estimating",
      "AwaitingConfirm",
      "EnsuringSummaries",
      "Digesting",
      "Clustering",
      "Analysing",
      "Composing",
      "Critiquing",
      "Scaffolding",
      "Rendering",
      "Saving",
    ]);
    expect(trendReportExclusivityKey(COLLECTION)).toBe(
      "trendReport:1/COLLKEY1",
    );
  });

  it("a second run is served by the tc, cr and rp entries; skipSynthesisCache sends every synthesis call again", async () => {
    const h = await harness();
    await h.run();
    const before = h.provider.calls.length;
    const again = await h.run();
    expect(again.outcome).toBe("succeeded");
    expect(h.provider.calls.length).toBe(before); // summaries stored, synthesis cached
    expect(again.passes).toBe(4); // the cached passes are the report's
    expect(h.reportRows()).toBe(2); // every run writes a new report (item 286)
    const third = await h.run({ input: { skipSynthesisCache: true } });
    expect(third.outcome).toBe("succeeded");
    expect(levels(h.provider.calls.slice(before))).toEqual(
      expect.arrayContaining(["L1", "L2", "L3", "L4"]),
    );
    expect(
      levels(h.provider.calls.slice(before)).filter((l) => l === "L0"),
    ).toHaveLength(0); // ps is kept
  });

  it("with report.saveNote off writes the row and the file and no note", async () => {
    const h = await harness({ config: { reportSaveNote: false } });
    const output = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(output.note).toBeUndefined();
    expect(h.notes).toHaveLength(0);
    expect(h.reportRows()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Cancel, stops, the failure rule
// ---------------------------------------------------------------------------

describe("P4-T18 — cancel and every stop save nothing; summaries remain", () => {
  it("cancelling during the theme stage saves no note, no report row and no file (Done when 2)", async () => {
    const source = createCancellationTokenSource();
    const h = await harness({
      override: (_call, level) => {
        if (level === "L2") source.cancel({ kind: "user" });
        return undefined;
      },
    });
    const output = await h.run({ source });
    expect(output.outcome).toBe("cancelled");
    expect(h.notes).toHaveLength(0);
    expect(h.reportRows()).toBe(0);
    expect(h.files.files.size).toBe(0);
    expect(h.summaryRows()).toBe(30);
    expect((await h.jobs.get(output.jobId as string))?.status).toBe(
      "cancelled",
    );
  });

  const stops: readonly [string, Override, string][] = [
    [
      "the clustering's stopped-no-themes",
      (call, level) =>
        level === "L1"
          ? chatResponse(
              JSON.stringify({
                themes: [
                  {
                    themeId: "T1",
                    name: "Tiny",
                    definition: "Too small.",
                    itemKeys: [key(1)],
                  },
                ],
                assignments: [],
                unclustered: Array.from(
                  userOf(call.request).matchAll(/\[(K\d{7})\]/g),
                  (m) => ({ itemKey: m[1] as string, reason: "none" }),
                ).filter((u) => u.itemKey !== key(1)),
              }),
            )
          : undefined,
      "research-helper-report-stopped-no-themes",
    ],
    [
      "the analyse stage's stopped-no-theme-analysed",
      (_call, level) =>
        level === "L2"
          ? new UpstreamServerError(500, "synthetic outage")
          : undefined,
      "research-helper-report-stopped-no-theme-analysed",
    ],
    [
      "the composition's own stopped-structure-invalid",
      (_call, level) =>
        level === "L3"
          ? chatResponse("## Not the template\n\nNothing.")
          : undefined,
      "research-helper-report-stopped-structure-invalid",
    ],
  ];
  for (const [name, override, messageId] of stops) {
    it(`${name} ends the job with its message and nothing saved (items 307(c), 309(g), 311(a))`, async () => {
      const h = await harness({ override });
      const output = await h.run();
      expect(output.outcome).toBe("stopped");
      expect(output.stop?.messageId).toBe(messageId);
      expect(h.notes).toHaveLength(0);
      expect(h.reportRows()).toBe(0);
      expect(h.files.files.size).toBe(0);
      expect(h.summaryRows()).toBe(30);
      const record = await h.jobs.get(output.jobId as string);
      expect(record?.status).toBe("failed");
      // The record keeps the stop's short name: the gate redacts a run of 40
      // or more characters, and the full ids are 42–48.
      expect(record?.error?.code).toBe(STOPPED_CODE);
      expect(record?.error?.detail).toBe(stopName(messageId));
      expect(stopName(messageId).length).toBeLessThan(40);
    });
  }

  it("a theme-count stop carries its arguments (item 292(d))", async () => {
    const h = await harness({
      override: (call, level) => {
        if (level !== "L1") return undefined;
        const keys = unique(
          Array.from(
            userOf(call.request).matchAll(/\[(K\d{7})\]/g),
            (m) => m[1] as string,
          ),
        );
        const themes = keys.map((k, i) => ({
          themeId: `T${String(i + 1)}`,
          name: `Theme ${String(i)}`,
          definition: "One paper each.",
          itemKeys: [k],
        }));
        return chatResponse(
          JSON.stringify({
            themes,
            assignments: keys.map((k, i) => ({
              itemKey: k,
              primaryThemeId: `T${String(i + 1)}`,
              fit: "weak",
            })),
          }),
        );
      },
    });
    const output = await h.run();
    expect(output.outcome).toBe("stopped");
    expect(output.stop?.messageId).toBe(
      "research-helper-report-stopped-too-many-themes",
    );
    expect(output.stop?.args?.["themes"]).toBe(30);
    expect(h.reportRows()).toBe(0);
  });

  it("11 of 30 papers failing stops the run with one message; 9 of 30 does not (Done when 4)", async () => {
    const failing =
      (count: number): Override =>
      (call, level) => {
        if (level !== "L0") return undefined;
        const k = /Study (K\d{7})/.exec(userOf(call.request))?.[1] ?? "";
        return Number(k.slice(1)) <= count
          ? new UpstreamServerError(500, "synthetic outage")
          : undefined;
      };
    const stopped = await (await harness({ override: failing(11) })).run();
    expect(stopped.outcome).toBe("stopped");
    expect(stopped.stop).toEqual({
      messageId: PAPERS_FAILED_L10N,
      // Decided at the failure that crosses 30 %: the tenth of thirty.
      args: { failed: 10, total: 30 },
    });
    const h = await harness({ override: failing(9) });
    const kept = await h.run();
    expect(kept.outcome).toBe("succeeded");
    expect(kept.report?.scope.analysedCount).toBe(21);
    expect(
      kept.report?.excluded.filter(
        (e) => e.reason === "llm_failed_after_retries",
      ),
    ).toHaveLength(9);
    expect(tooManyPapersFailed(9, 30)).toBe(false);
    expect(tooManyPapersFailed(10, 30)).toBe(true);
    expect(tooManyPapersFailed(11, 30)).toBe(true);
    expect(FAILED_PAPERS_SHARE).toBe(0.3);
  });

  it("a collection with nothing to analyse stops before any request", async () => {
    const h = await harness({ papers: 0 });
    const output = await h.run();
    expect(output.outcome).toBe("stopped");
    expect(output.stop?.messageId).toBe(NO_PAPERS_L10N);
    expect(h.provider.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Pauses
// ---------------------------------------------------------------------------

describe("P4-T18 — a budget refusal pauses with the stage pending (Done when 6)", () => {
  const refusal = (): BudgetExceededError =>
    new BudgetExceededError("synthetic refusal", {
      ceiling: "run",
      limitUsd: 1,
      spentUsd: 0.9,
      projectedUsd: 1.2,
      runSpentUsd: 0.9,
    });

  it("'stop' at the pause saves no note, no report row and no file", async () => {
    const h = await harness({
      override: (_call, level) => (level === "L2" ? refusal() : undefined),
      answer: () => "cancel",
    });
    const output = await h.run();
    expect(output.outcome).toBe("cancelled");
    expect(h.asks.map((q) => q.reason)).toEqual(["budget-stop"]);
    expect(h.notes).toHaveLength(0);
    expect(h.reportRows()).toBe(0);
    expect(h.files.files.size).toBe(0);
    expect(h.summaryRows()).toBe(30);
  });

  it("'continue' runs the pending stage again and the report is saved", async () => {
    let refused = 0;
    const h = await harness({
      override: (_call, level) => {
        if (level === "L2" && refused < 1) {
          refused += 1;
          return refusal();
        }
        return undefined;
      },
      answer: () => "resume",
    });
    const output = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.asks).toHaveLength(1);
    expect(h.reportRows()).toBe(1);
  });

  // plan/00 §6 item 322(e), P4-T18 finding 3 (P4-T20 step 0b): a theme
  // analysed before the refusal is not paid for again on "continue".
  for (const cacheEnabled of [true, false]) {
    it(`'continue' re-sends only the themes not yet analysed (cache.enabled ${String(cacheEnabled)})`, async () => {
      let refused = 0;
      const h = await harness({
        config: { cacheEnabled },
        override: (call, level) => {
          if (
            level === "L2" &&
            refused < 1 &&
            /"themeId": "T2"|THEME_ID[^\n]*T2|\bT2\b/.test(userOf(call.request))
          ) {
            refused += 1;
            return refusal();
          }
          return undefined;
        },
        answer: () => "resume",
      });
      const output = await h.run();
      expect(output.outcome).toBe("succeeded");
      expect(refused).toBe(1);
      expect(h.asks.map((q) => q.reason)).toEqual(["budget-stop"]);
      const themeCalls = h.provider.calls
        .filter((call) => levelOf(call.request) === "L2")
        .map((call) => (/\bT1\b/.test(userOf(call.request)) ? "T1" : "T2"));
      // T1 once; T2 refused, then sent again. Without the fix T1 is sent twice.
      expect(themeCalls.filter((t) => t === "T1")).toHaveLength(1);
      expect(themeCalls.filter((t) => t === "T2")).toHaveLength(2);
      expect(output.view.themes).toEqual({ done: 2, total: 2 });
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Resume
// ---------------------------------------------------------------------------

describe("P4-T18 — resume after a checkpoint at Analysing (Done when 3 and 5)", () => {
  /** A first run whose report call never answers, left at its checkpoint. */
  async function interrupted(): Promise<{
    first: Harness;
    record: JobRecord;
  }> {
    let jobId: string | undefined;
    const first = await harness({
      override: (_call, level) =>
        level === "L3" ? new Promise<never>(() => undefined) : undefined,
    });
    const { pipeline, jobs } = first;
    const source = createCancellationTokenSource();
    const input: TrendReportInput = { ...COLLECTION, language: "en" };
    const surface: TrendReportSurface = {
      update: () => undefined,
      confirm: () =>
        Promise.resolve({
          kind: "run",
          plan: "selected",
          raise: undefined,
          dontAskAgain: false,
        }),
      ask: () => Promise.resolve("cancel"),
    };
    void (async () => {
      const prepared = await pipeline.prepare(
        input,
        first.context("prepare-only", source),
        surface,
      );
      const record = await jobs.enqueue("trendReport", input);
      jobId = record.id;
      await pipeline.execute(
        prepared,
        first.context(record.id, source),
        surface,
      );
    })();
    const record = await untilCheckpoint(jobs, () => jobId, "Analysing");
    return { first, record };
  }

  function guards(thresholdCents: number): ResumeGuards {
    const remaining = (record: JobRecord) =>
      Promise.resolve(remainingFromCheckpoint(record));
    return {
      skipCached: (record) => Promise.resolve(record.checkpoint),
      egress: () => Promise.resolve({ proceed: true }),
      confirm: createConfirmResumeGuard({ remaining }, () => thresholdCents),
      ceilings: createCeilingsResumeGuard({
        remaining,
        session: createSessionSpendCounter(),
      }),
    };
  }

  it("restarted with no guard asking: the notice is shown, no second confirmation, no cluster or theme call", async () => {
    const { first } = await interrupted();
    const resumedNotices: JobRecord[][] = [];
    const clock = createManualClock();
    const logger = createLogger({ sink: NULL_LOG_SINK, clock });
    const restarted = createJobQueue({
      clock,
      logger,
      pluginVersion: "0.0.0-test",
      isResumable: (id) => id === "trendReport",
      resumeGuards: guards(100_000),
      notifier: {
        paused: () => undefined,
        resumed: (records) => {
          resumedNotices.push([...records]);
          return Promise.resolve();
        },
      },
    });
    restarted.attachStore(createJobStore(first.connection));
    const recovery = await restarted.recover();
    expect(recovery.autoResumed).toHaveLength(1);
    expect(resumedNotices).toHaveLength(1);
    const record = await restarted.get(recovery.autoResumed[0] as string);
    expect(record?.status).toBe("queued");

    // The run after the restart: the same database and cache, a fresh model.
    const second = await harness({ reuse: first });
    const confirms: unknown[] = [];
    const surface: TrendReportSurface = {
      update: () => undefined,
      confirm: (request) => (
        confirms.push(request),
        Promise.reject(new Error("asked again"))
      ),
      ask: () => Promise.resolve("cancel"),
    };
    const ctx = second.context(
      record?.id as string,
      createCancellationTokenSource(),
      record?.checkpoint,
    );
    // The second harness's queue reads the same table: the record is the one
    // recover re-queued.
    const output = await second.pipeline.execute(
      await second.pipeline.prepare(
        record?.input as TrendReportInput,
        ctx,
        surface,
        isTrendReportCheckpoint(record?.checkpoint)
          ? { resume: record.checkpoint }
          : {},
      ),
      ctx,
      surface,
    );
    expect(output.outcome).toBe("succeeded");
    expect(confirms).toHaveLength(0);
    const seen = levels(second.provider.calls);
    expect(seen).not.toContain("L0");
    expect(seen).not.toContain("L1");
    expect(seen).not.toContain("L2");
    expect(seen).toContain("L3");
    expect(output.passes).toBe(4);
    expect(second.reportRows()).toBe(1);
  });

  it("Pipeline.run reads the checkpoint itself and never calls confirm", async () => {
    const { first, record } = await interrupted();
    const second = await harness({ reuse: first });
    // Move the record as recover would: running → interrupted → queued.
    first.connection.db
      .prepare("UPDATE job SET status = 'queued' WHERE id = ?")
      .run(record.id);
    const ctx = second.context(
      record.id,
      createCancellationTokenSource(),
      record.checkpoint,
    );
    const output = await second.pipeline.run(
      record.input as TrendReportInput,
      ctx,
    );
    // The headless surface would decline a confirmation; a resumed run asks none.
    expect(output.outcome).toBe("succeeded");
    expect(levels(second.provider.calls)).not.toContain("L1");
    expect(levels(second.provider.calls)).not.toContain("L2");
  });

  it("a spend guard that asks keeps the job paused: nothing resumes and no notice is shown", async () => {
    const { first } = await interrupted();
    const resumedNotices: JobRecord[][] = [];
    const clock = createManualClock();
    const restarted = createJobQueue({
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
      pluginVersion: "0.0.0-test",
      isResumable: (id) => id === "trendReport",
      // A threshold of 0 cents: any remaining cost asks.
      resumeGuards: guards(0),
      notifier: {
        paused: () => undefined,
        resumed: (records) => (
          resumedNotices.push([...records]),
          Promise.resolve()
        ),
      },
    });
    restarted.attachStore(createJobStore(first.connection));
    const recovery = await restarted.recover();
    expect(recovery.autoResumed).toHaveLength(0);
    expect(recovery.pausedByGuard).toHaveLength(1);
    expect(resumedNotices).toHaveLength(0);
    const record = await restarted.get(recovery.pausedByGuard[0] as string);
    expect(record?.status).toBe("paused");
    expect(record?.pauseReason).toBe("awaiting-confirmation");
  });

  it("remainingFromCheckpoint prices only the stages after the checkpoint, and fails closed", () => {
    const spend = [
      { stage: "EnsuringSummaries", calls: 30, costUsd: 0.3 },
      { stage: "Clustering", calls: 1, costUsd: 0.1 },
      { stage: "Analysing", calls: 4, costUsd: 0.4 },
      { stage: "Composing", calls: 1, costUsd: 0.2 },
      { stage: "Critiquing", calls: 2, costUsd: null },
    ] as const;
    const checkpoint = (stage: string) => ({
      version: 1,
      stage,
      choice: { fullTextMode: "auto", costGateBlocksFullText: false },
      spend,
    });
    expect(
      remainingFromCheckpoint({
        pipelineId: "trendReport",
        checkpoint: checkpoint("Analysing"),
      }),
    ).toEqual({ calls: 3, costUsd: undefined });
    expect(
      remainingFromCheckpoint({
        pipelineId: "trendReport",
        checkpoint: checkpoint("Critiquing"),
      }),
    ).toEqual({ calls: 0, costUsd: 0 });
    expect(
      remainingFromCheckpoint({
        pipelineId: "trendReport",
        checkpoint: { ...checkpoint("Clustering"), spend: spend.slice(0, 4) },
      }),
    ).toEqual({ calls: 5, costUsd: 0.6000000000000001 });
    expect(
      remainingFromCheckpoint({
        pipelineId: "summarize",
        checkpoint: undefined,
      }),
    ).toEqual({ calls: 1, costUsd: undefined });
    expect(
      remainingFromCheckpoint({
        pipelineId: "trendReport",
        checkpoint: { stage: "x" },
      }),
    ).toEqual({ calls: 1, costUsd: undefined });
  });
});

// ---------------------------------------------------------------------------
// 5. The report run's own "don't ask again" (step 7, item 292(f))
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// P4-T20 step 0c — a resumed job with no window waits; a shutdown keeps it
// (owner, plan/00 §6 item 324(a); item 322(e), P4-T18 finding 5)
// ---------------------------------------------------------------------------

describe("P4-T20 step 0c — the deferred surface of a resumed job", () => {
  const refusal = (): BudgetExceededError =>
    new BudgetExceededError("synthetic refusal", {
      ceiling: "run",
      limitUsd: 1,
      spentUsd: 0.9,
      projectedUsd: 1.2,
      runSpentUsd: 0.9,
    });

  async function until(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      if (condition()) return;
      await new Promise((done) => setTimeout(done, 2));
    }
    throw new Error("condition never held");
  }

  /** A run on a deferred surface whose `level` call is refused once. */
  async function pausedRun(level: "L0" | "L2") {
    let refused = 0;
    const h = await harness({
      override: (_call, seen) => {
        if (seen === level && refused < 1) {
          refused += 1;
          return refusal();
        }
        return undefined;
      },
    });
    const source = createCancellationTokenSource();
    const deferred = createDeferredTrendReportSurface(source.token);
    const running = h.run({
      source,
      surface: {
        update: (view) => deferred.update(view),
        ask: (question) => deferred.ask(question),
      },
    });
    await until(() => deferred.pending !== undefined);
    return { h, source, deferred, running };
  }

  it("a pause with no window is not answered: the job stays paused, and a window that attaches later is asked and continues it", async () => {
    const { h, deferred, running } = await pausedRun("L2");
    const paused = await h.jobs.list({ status: ["paused"] });
    expect(paused).toHaveLength(1);
    expect(paused[0]?.pauseReason).toBe("budget-stop");
    expect(deferred.pending?.reason).toBe("budget-stop");
    expect(h.reportRows()).toBe(0);
    const asked: string[] = [];
    const views: string[] = [];
    deferred.attach({
      update: (view) => views.push(view.stage),
      ask: (question) => (
        asked.push(question.reason),
        Promise.resolve("resume")
      ),
    });
    const output = await running;
    expect(asked).toEqual(["budget-stop"]);
    // The window saw where the run was the moment it attached.
    expect(views[0]).toBe("waiting");
    expect(output.outcome).toBe("succeeded");
    expect(h.reportRows()).toBe(1);
  });

  it("a shutdown while the question waits leaves the job paused with its checkpoint; nothing is cancelled or saved", async () => {
    const { h, source, running } = await pausedRun("L2");
    source.cancel({ kind: "shutdown" });
    const output = await running;
    expect(output.outcome).toBe("interrupted");
    const record = (await h.jobs.list())[0];
    expect(record?.status).toBe("paused");
    expect(isTrendReportCheckpoint(record?.checkpoint)).toBe(true);
    expect(
      (record?.checkpoint as { readonly stage: string } | undefined)?.stage,
    ).toBe("Clustering");
    expect(h.reportRows()).toBe(0);
    expect(h.summaryRows()).toBe(30);
  });

  it("a shutdown during a summaries-stage pause moves no job state either", async () => {
    const { h, source, running } = await pausedRun("L0");
    source.cancel({ kind: "shutdown" });
    const output = await running;
    expect(output.outcome).toBe("interrupted");
    const record = (await h.jobs.list())[0];
    expect(record?.status).toBe("paused");
    expect(h.reportRows()).toBe(0);
  });

  it("a window that detaches before answering does not answer for the run; the question waits for the next", async () => {
    const source = createCancellationTokenSource();
    const deferred = createDeferredTrendReportSurface(source.token);
    const question: SummarizeQuestion = {
      reason: "credential-required",
      providerId: "openrouter",
    };
    const answer = deferred.ask(question);
    let closeFirst: ((choice: "resume" | "cancel") => void) | undefined;
    const detach = deferred.attach({
      update: () => undefined,
      ask: () =>
        new Promise((resolve) => {
          closeFirst = resolve;
        }),
    });
    detach();
    closeFirst?.("cancel"); // the closing window's "cancel" arrives late
    await Promise.resolve();
    expect(deferred.pending).toBe(question);
    const detachSecond = deferred.attach({
      update: () => undefined,
      ask: () => Promise.resolve("resume"),
    });
    expect(await answer).toBe("resume");
    expect(deferred.pending).toBeUndefined();
    detachSecond();
    // A user cancel of the run answers a waiting question "stop".
    const second = deferred.ask(question);
    source.cancel({ kind: "user" });
    expect(await second).toBe("cancel");
  });
});

describe("P4-T18 step 7 — don't ask again is the report run's own record (Done when 7)", () => {
  it("a summarize run's record never skips the report's question; the report's own does, and leaves the summarize record unchanged", async () => {
    const h = await harness();
    const summarizeRecord: RoutineConfirmation = {
      providerId: "openrouter",
      privacyMode: "balanced",
      fullText: false,
    };
    await writeCollectionPrivacySettings(h.settings, COLLECTION, {
      routineConfirmation: summarizeRecord,
    });
    await h.run({ dontAskAgain: true });
    expect(h.confirms[0]?.confirmation.ask).toBe(true);
    expect(h.confirms[0]?.confirmation.reasons).toEqual(["not-suppressed"]);
    const stored = readCollectionPrivacySettings(
      await h.settings.get(1, "COLLKEY1"),
    );
    expect(stored.routineConfirmation).toEqual(summarizeRecord);
    expect(stored.reportRoutineConfirmation).toEqual({
      providerId: "openrouter",
      privacyMode: "balanced",
      fullText: false,
    });
    await h.run();
    expect(h.confirms[1]?.confirmation).toEqual({ ask: false, reasons: [] });
    expect(
      readCollectionPrivacySettings(await h.settings.get(1, "COLLKEY1"))
        .routineConfirmation,
    ).toEqual(summarizeRecord);
  });

  it("without the box ticked nothing is stored and the next run asks again", async () => {
    const h = await harness();
    await h.run();
    await h.run();
    expect(h.confirms.map((c) => c.confirmation.ask)).toEqual([true, true]);
    expect(h.settings.rows.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Pure helpers
// ---------------------------------------------------------------------------

describe("P4-T18 — the helpers", () => {
  it("withDatedTitle puts the dated note title on the Markdown's first line", () => {
    const at = Date.UTC(2026, 10, 1, 5, 6, 7);
    const out = withDatedTitle(
      "# Research Trends: A (2026-11-01)\n\n_line_",
      "en",
      "A",
      at,
    );
    expect(out.title).toBe("Research Trends: A (2026-11-01 05:06:07 UTC)");
    expect(out.markdown).toBe(
      "# Research Trends: A (2026-11-01 05:06:07 UTC)\n\n_line_",
    );
  });

  it("stageSpendOf assigns every planned call to its stage", async () => {
    const h = await harness();
    await h.run();
    const estimate = h.confirms[0]?.estimate;
    expect(estimate).toBeDefined();
    if (estimate === undefined) return;
    const spend = stageSpendOf(estimate, () => PRICES, 0);
    expect(spend.map((s) => s.stage)).toEqual([
      "EnsuringSummaries",
      "Clustering",
      "Analysing",
      "Composing",
      "Critiquing",
    ]);
    expect(spend.reduce((n, s) => n + s.calls, 0)).toBe(
      estimate.selected.calls,
    );
    expect(spend.every((s) => s.costUsd !== null)).toBe(true);
  });
});

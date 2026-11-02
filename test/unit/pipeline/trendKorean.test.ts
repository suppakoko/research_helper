/**
 * `P4-T21` — the Korean report path end to end: `ko` and `both` through the real
 * pipeline, the Korean headings, the mechanical original-script check and the
 * Korean invalid-citation text (`plan/07` `P4-T21`; `docs/07` §12.4 readings 18
 * to 22; `docs/06` D-06-6), and what a `both` run keeps when Korean fails
 * (owner, `plan/00` §6 item 334(d)).
 *
 * No network and no model: every answer comes from `test/helpers/mockLLM.ts`
 * through the real router and `withBudget`; the cache and the `summary`, `report`
 * and `job` tables are the real ones over `node:sqlite` in memory. Every paper is
 * synthetic text written here; the Korean, Japanese and German titles are made
 * up, and are here only because they must come back byte for byte.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatMeasurement,
  groupRuns,
  measurementOf,
  parseStoredReport,
} from "../../../scripts/eval-trend-report";
import { runMigrations } from "../../../src/bootstrap/migrations";
import { sha256Hex } from "../../../src/core/cache/keys";
import {
  createSqliteCache,
  type CacheBlobStore,
} from "../../../src/core/cache/sqliteCache";
import { createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  ContextLengthExceededError,
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
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type { ChatRequest } from "../../../src/llm/types";
import {
  PAPER_SUMMARY_SCHEMA_VERSION,
  type AcquiredSource,
  type PaperSummary,
} from "../../../src/model/summary";
import type { TrendReport } from "../../../src/model/trend";
import {
  createBudgetGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import { createPrivacyPolicy } from "../../../src/pipeline/shared/privacyPolicy";
import {
  createJobNoticeRouter,
  type SummarizeLibraryItem,
} from "../../../src/pipeline/summarize/summarizePipeline";
import {
  checkHeadings,
  expectedHeadings,
  STRUCTURE_INVALID_L10N,
  type DraftDelta,
} from "../../../src/pipeline/trendReport/compose";
import { renderReportMarkdown } from "../../../src/pipeline/trendReport/exportMarkdown";
import { reportLabel } from "../../../src/pipeline/trendReport/reportLabels";
import {
  createTrendReportPipeline,
  isTrendReportCheckpoint,
  KOREAN_NOT_WRITTEN_L10N,
  remainingFromCheckpoint,
  reportLanguagesOf,
  STOPPED_CODE,
  type TrendReportCheckpoint,
  type TrendReportConfirmRequest,
  type TrendReportInput,
  type TrendReportOutput,
  type TrendReportSurface,
} from "../../../src/pipeline/trendReport/trendReportPipeline";
import type {
  ConfigReader,
  PipelineContext,
} from "../../../src/pipeline/types";
import { getPref, type PrefName } from "../../../src/prefs";
import {
  createPromptRegistry,
  type PromptRegistry,
} from "../../../src/prompts";
import { resolveReportLanguage } from "../../../src/ui/viewModels/reportViewModel";
import {
  citationSpan,
  escapeHtml,
  type BibliographyPort,
  type BibliographyRequest,
  type CitationNode,
} from "../../../src/zotero/bibliography";
import {
  createJobStore,
  createReportStore,
  createSummaryStore,
  type ReportMarkdownFiles,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";
import type { ReportNoteRequest } from "../../../src/zotero/notes";
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
const EN_HEADINGS = expectedHeadings(PROMPTS.get("TREND_REPORT_EN"));
const KO_HEADINGS = expectedHeadings(PROMPTS.get("TREND_REPORT_KO"));
const KO_HEADING_7 = "7. 상충과 논쟁 (Contradictions and Debates)";

const COLLECTION = { libraryID: 1, collectionKey: "COLLKEY1" };

// ---------------------------------------------------------------------------
// The synthetic collection: original-script titles, authors and venues
// ---------------------------------------------------------------------------

function key(i: number): string {
  return `K${String(i).padStart(7, "0")}`;
}

/** Three scripts, so a transliteration or a translation cannot pass. */
const FIELDS = [
  {
    title: "합성 시험의 무작위 배정 연구",
    author: "김가나",
    venue: "한국합성학회지",
  },
  {
    title: "合成試験の無作為化に関する研究",
    author: "山田太郎",
    venue: "合成学会誌",
  },
  {
    title: "Über die Größe synthetischer Prüfungen",
    author: "Müller, Jürgen",
    venue: "Zeitschrift für Synthese",
  },
] as const;

function fieldsOf(i: number): (typeof FIELDS)[number] {
  return FIELDS[i % FIELDS.length] as (typeof FIELDS)[number];
}

function titleOf(i: number): string {
  return `${fieldsOf(i).title} ${String(i)}`;
}

function yearOf(i: number): number {
  return 2018 + (i % 6);
}

/** What the bibliography port renders: the item's fields and nothing else. */
function bibliographyTextOf(i: number): string {
  const f = fieldsOf(i);
  return `${f.author} (${String(yearOf(i))}). ${titleOf(i)}. ${f.venue}.`;
}

function indexOfKey(itemKey: string): number {
  return Number(itemKey.slice(1));
}

function abstractOf(i: number): string {
  return (
    `Background: synthetic study ${key(i)} of a made-up intervention. ` +
    "The intervention reduced the primary outcome by 42 percent."
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
  const f = fieldsOf(i);
  return {
    itemID: 1000 + i,
    itemKey: k,
    libraryID: 1,
    workKey: `doi:10.1234/${k.toLowerCase()}`,
    metadata: {
      title: titleOf(i),
      authors: [f.author],
      year: yearOf(i),
      venue: f.venue,
      itemType: "journalArticle",
      doi: `10.1234/${k.toLowerCase()}`,
      tags: [],
    },
    dateModified: "2026-10-01 00:00:00",
    screen: {
      key: k,
      itemID: 1000 + i,
      itemType: "journalArticle",
      title: titleOf(i),
      year: yearOf(i),
      firstAuthorFamily: f.author,
      containerTitle: f.venue,
      doi: `10.1234/${k.toLowerCase()}`,
      abstractLength: abstractOf(i).length,
      hasFullText: false,
      dateAdded: `2026-01-01 00:00:${String(i % 60).padStart(2, "0")}`,
      retraction: { zotero: { retracted: false, reasons: [] } },
    },
  };
}

// ---------------------------------------------------------------------------
// The scripted model
// ---------------------------------------------------------------------------

function userOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "user")?.content ?? "";
}

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

/** Which report a composition request asks for, by its own template's text. */
function languageOf(request: ChatRequest): "ko" | "en" {
  return userOf(request).includes("보고서 파라미터") ? "ko" : "en";
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

function analysisAnswer(request: ChatRequest, padWords: number): string {
  const user = userOf(request);
  const themeId = /"themeId": "(T\d+)"/.exec(user)?.[1] ?? "T1";
  const keys = unique(
    Array.from(user.matchAll(/"itemKey":"(K\d{7})"/g), (m) => m[1] as string),
  );
  return JSON.stringify({
    themeId,
    name: "echo",
    narrative:
      `Work in this theme ${keys
        .slice(0, 3)
        .map((k) => `[[${k}]]`)
        .join(" ")} reduced the outcome.` +
      " The outcome fell across the synthetic trials.".repeat(padWords),
    representativePapers: keys
      .slice(0, 2)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  });
}

/** What the model "translates" in §11; the scaffold must throw it away. */
const MODEL_TRANSLATED_TITLE = "번역된 제목";

/** A report in the request's own language, with a real §10 table. */
function reportAnswer(request: ChatRequest): string {
  const headings = languageOf(request) === "ko" ? KO_HEADINGS : EN_HEADINGS;
  const keys = unique(
    Array.from(
      userOf(request).matchAll(/\[\[(K\d{7})\]\]/g),
      (m) => m[1] as string,
    ),
  );
  const at = (n: number): string => keys[n % keys.length] as string;
  return headings
    .map((heading, index) => {
      const n = index + 1;
      let body = `Finding ${String(n)} reported a 12% change [[${at(n)}]].`;
      if (n === 10) {
        const rows = Array.from(
          { length: 8 },
          (_, r) => `| [[${at(r)}]] | 2020 | Why it matters. | T1 |`,
        );
        body = ["| P | Y | W | T |", "|---|---|---|---|", ...rows].join("\n");
      }
      if (n === 11) {
        body = keys
          .map((k, i) => `${String(i + 1)}. [[${k}]] ${MODEL_TRANSLATED_TITLE}`)
          .join("\n");
      }
      return `## ${heading}\n\n${body}\n`;
    })
    .join("\n");
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
) => ReturnType<typeof chatResponse> | undefined;

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

const SILENT_PROGRESS: ProgressReporter = {
  setMessage: () => undefined,
  setProgress: () => undefined,
  increment: () => undefined,
  child: () => SILENT_PROGRESS,
  warn: () => undefined,
  done: () => undefined,
};

const PRICES: ModelPrices = {
  inputPerMTokUsd: 0.1,
  outputPerMTokUsd: 0.4,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: 0,
  source: "documented-table",
};

/** A citation node from the item's fields, as `citationNodes` builds one. */
function citationNode(itemKey: string): CitationNode {
  const i = indexOfKey(itemKey);
  const uri = `http://zotero.org/users/local/abcdefgh/items/${itemKey}`;
  const citationItem = {
    uris: [uri],
    itemData: { id: uri, type: "article-journal", title: titleOf(i) },
  };
  const text = `${fieldsOf(i).author}, ${String(yearOf(i))}`;
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

interface HarnessOptions {
  readonly override?: Override;
  readonly config?: Partial<Record<PrefName, unknown>>;
  readonly padWords?: number;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
  readonly source?: CancellationTokenSource;
  /** The first paper is retracted in Zotero. */
  readonly retractFirst?: boolean;
  /** Throw on this call of the port (1 is English's, 2 Korean's). */
  readonly failBibliography?: number;
  readonly failCitationNodes?: number;
  readonly failReportPut?: number;
  readonly failNote?: number;
  /** The Korean template no longer lists its sections: a defect, not a stop. */
  readonly brokenKoreanTemplate?: boolean;
}

async function harness(options: HarnessOptions = {}) {
  const connection = sqlite();
  await runMigrations(connection);
  const clock = createManualClock();
  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const cache = createSqliteCache({
    connection: () => Promise.resolve(connection),
    blobs: memoryBlobs(),
    clock,
    logger,
    maxBytes: () => 1024 * 1024 * 1024,
  });
  const store = createSummaryStore(connection);
  const files = memoryFiles();
  const stored = createReportStore(connection, files);
  // Counted by report: the second `put` of a report is its note's key.
  const putReports = new Set<string>();
  const reports: typeof stored = {
    ...stored,
    put: (report) => {
      putReports.add(report.id);
      if (putReports.size === options.failReportPut) {
        return Promise.reject(new Error("no disk"));
      }
      return stored.put(report);
    },
  };
  const router = createJobNoticeRouter();
  const jobs = createJobQueue({
    clock,
    logger,
    pluginVersion: "0.0.0-test",
    isResumable: (id) => id === "trendReport",
    notifier: router.notifier,
  });
  jobs.attachStore(createJobStore(connection));
  const provider = mockLLM(
    [
      (call: MockCall) => {
        const level = levelOf(call.request);
        const own = options.override?.(call, level);
        if (own !== undefined) return own;
        switch (level) {
          case "L0":
            return chatResponse(summaryAnswer(), { usage: USAGE });
          case "L1":
            return chatResponse(clusteringAnswer(call.request), {
              usage: USAGE,
            });
          case "L2":
            return chatResponse(
              analysisAnswer(call.request, options.padWords ?? 0),
              { usage: USAGE },
            );
          case "L4":
            return chatResponse(
              JSON.stringify({ verdict: "pass", problems: [] }),
              { usage: USAGE },
            );
          default:
            return chatResponse(reportAnswer(call.request), { usage: USAGE });
        }
      },
    ],
    { streaming: true },
  );
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
  const items = Array.from({ length: 30 }, (_, i) => {
    const item = itemOf(i + 1);
    return options.retractFirst === true && i === 0
      ? {
          ...item,
          screen: {
            ...item.screen,
            retraction: { zotero: { retracted: true, reasons: ["Synthetic"] } },
          },
        }
      : item;
  });
  const notes: ReportNoteRequest[] = [];
  const confirms: TrendReportConfirmRequest[] = [];
  const requests: BibliographyRequest[] = [];
  let bibliographyCalls = 0;
  let citationCalls = 0;
  const bibliography: BibliographyPort = {
    userCitationStyle: () => Promise.resolve(undefined),
    formatBibliography: (keys, request) => {
      requests.push(request);
      if ((bibliographyCalls += 1) === options.failBibliography) {
        return Promise.reject(new Error("no style"));
      }
      return Promise.resolve({
        styleId: request.styleId,
        locale: request.locale,
        entries: keys.map((itemKey, i) => ({
          itemKey,
          index: i + 1,
          text: bibliographyTextOf(indexOfKey(itemKey)),
          doi: undefined,
        })),
        styleNumbered: false,
        citationList: false,
      });
    },
    formatRetracted: (keys) =>
      Promise.resolve(
        keys.map((itemKey) => ({
          itemKey,
          text: bibliographyTextOf(indexOfKey(itemKey)),
          doi: undefined,
        })),
      ),
    citationNodes: (keys, request) => {
      requests.push(request);
      if ((citationCalls += 1) === options.failCitationNodes) {
        return Promise.reject(new Error("no nodes"));
      }
      return Promise.resolve(keys.map(citationNode));
    },
  };
  const session = createSessionSpendCounter();
  let reportNumber = 0;
  const pipeline = createTrendReportPipeline({
    library: {
      loadCollection: () =>
        Promise.resolve({ name: "합성 모음", editable: true, items }),
      acquire: (item) =>
        Promise.resolve({ source: sourceOf(indexOfKey(item.itemKey)) }),
      bibliography,
      writeReportNote: (request) => {
        if (notes.length + 1 === options.failNote) {
          return Promise.reject(new Error("no note"));
        }
        notes.push(request);
        return Promise.resolve({
          kind: "written",
          noteKey: `NOTEKEY${String(notes.length)}`,
        });
      },
    },
    summaries: () => Promise.resolve(store),
    reports: () => Promise.resolve(reports),
    prompts: () =>
      Promise.resolve(
        options.brokenKoreanTemplate === true
          ? {
              ...PROMPTS,
              get: (id: Parameters<PromptRegistry["get"]>[0]) => {
                const template = PROMPTS.get(id);
                return id === "TREND_REPORT_KO"
                  ? { ...template, user: template.user.replace(/^## /gmu, "") }
                  : template;
              },
            }
          : PROMPTS,
      ),
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
        contextWindowTokens: options.contextWindowTokens ?? 200_000,
        maxOutputTokens: options.maxOutputTokens ?? 64_000,
        dataPolicy: {
          trainsOnInputByDefault: "no",
          retention: { days: "zero", note: "" },
        },
      }),
    credentials: { hasKey: () => Promise.resolve(true) },
    pluginVersion: "0.0.0-test",
    newReportId: () => `report-${String((reportNumber += 1))}`,
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
  /** Each checkpoint, with how many composition requests had been sent then. */
  const checkpoints: { stage: string; compositions: number }[] = [];

  const context = (
    jobId: string,
    source: CancellationTokenSource,
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
    checkpoint: (state) => {
      if (jobId === "prepare-only") return Promise.resolve();
      checkpoints.push({
        stage: (state as TrendReportCheckpoint).stage,
        compositions: provider.calls.filter(
          (call) => levelOf(call.request) === "L3",
        ).length,
      });
      return jobs.writeCheckpoint(jobId, state).then(() => undefined);
    },
    resumeState: undefined,
  });

  return {
    provider,
    jobs,
    notes,
    confirms,
    requests,
    checkpoints,
    pipeline,
    files,
    async run(
      language: TrendReportInput["language"],
      runOptions: {
        readonly source?: CancellationTokenSource;
        readonly surface?: Partial<TrendReportSurface>;
        readonly resumeState?: unknown;
      } = {},
    ): Promise<TrendReportOutput & { readonly jobId: string }> {
      const input: TrendReportInput = { ...COLLECTION, language };
      const source =
        runOptions.source ?? options.source ?? createCancellationTokenSource();
      const surface: TrendReportSurface = {
        update: () => undefined,
        confirm: (request) => {
          confirms.push(request);
          return Promise.resolve({
            kind: "run",
            plan: "selected",
            raise: undefined,
            dontAskAgain: false,
          });
        },
        ask: () => Promise.resolve("cancel"),
        ...runOptions.surface,
      };
      const prepared = await pipeline.prepare(
        input,
        context("prepare-only", source),
        surface,
      );
      const record = await jobs.enqueue("trendReport", input);
      const output = await pipeline.execute(
        prepared,
        { ...context(record.id, source), resumeState: runOptions.resumeState },
        surface,
      );
      return { ...output, jobId: record.id };
    },
    /** Every `report` row's `json` column, as the script reads it. */
    storedJson(): string[] {
      return (
        connection.db.prepare("SELECT json FROM report").all() as {
          json: string;
        }[]
      ).map((row) => row.json);
    },
    reportRows: () =>
      (
        connection.db.prepare("SELECT COUNT(*) AS n FROM report").get() as {
          n: number;
        }
      ).n,
    compositions(): readonly ChatRequest[] {
      return provider.calls
        .filter((call) => levelOf(call.request) === "L3")
        .map((call) => call.request);
    },
    levelCount(level: Level): number {
      return provider.calls.filter((call) => levelOf(call.request) === level)
        .length;
    },
  };
}

/** The `THEME_ANALYSES_JSON` a composition request carries, by its markers. */
function themeAnalysesOf(request: ChatRequest): string {
  const blocks = userOf(request).split("<<<SOURCE_TEXT>>>");
  return (blocks[1] ?? "").split("<<<END_SOURCE_TEXT>>>")[0] ?? "";
}

// ---------------------------------------------------------------------------
// Done when 1: one call per language, one set of theme analyses
// ---------------------------------------------------------------------------

describe("P4-T21 — ko makes one TREND_REPORT_KO call; both makes one of each", () => {
  it("ko sends one Korean composition, no English one, and saves one Korean report", async () => {
    const h = await harness();
    const output = await h.run("ko");
    expect(output.outcome).toBe("succeeded");
    expect(h.compositions().map(languageOf)).toEqual(["ko"]);
    expect(output.report?.language).toBe("ko");
    expect(output.report?.title).toMatch(/^연구 동향: 합성 모음 \(/u);
    expect(output.reports).toHaveLength(1);
    const used = output.report?.prompts.map((p) => p.promptId);
    expect(used).toContain("TREND_REPORT_KO");
    expect(used).not.toContain("TREND_REPORT_EN");
    expect(h.reportRows()).toBe(1);
    expect(h.notes).toHaveLength(1);
  });

  it("auto under a Korean interface reaches the run as ko; both reaches it as both", () => {
    expect(resolveReportLanguage("auto", "ko-KR")).toBe("ko");
    expect(resolveReportLanguage("both", "ko-KR")).toBe("both");
    expect(resolveReportLanguage("both", "en-US")).toBe("both");
    expect(reportLanguagesOf("both")).toEqual(["en", "ko"]);
    expect(reportLanguagesOf("ko")).toEqual(["ko"]);
  });

  it("both sends one of each from one set of theme analyses, and critiques each", async () => {
    const h = await harness();
    const output = await h.run("both");
    expect(output.outcome).toBe("succeeded");
    expect(h.compositions().map(languageOf)).toEqual(["en", "ko"]);
    // One clustering and two themes, not twice that.
    expect(h.levelCount("L1")).toBe(1);
    expect(h.levelCount("L2")).toBe(2);
    expect(h.levelCount("L4")).toBe(2);
    const [english, korean] = h.compositions() as [ChatRequest, ChatRequest];
    const analyses = themeAnalysesOf(english);
    expect(analyses).toContain("Work in this theme");
    expect(themeAnalysesOf(korean)).toBe(analyses);
    // The Korean request carries no part of the English report (D-06-6).
    expect(userOf(korean)).not.toContain("Finding 1 reported");
  });

  it("both saves two reports, two files and two notes, each with its own key", async () => {
    const h = await harness();
    const output = await h.run("both");
    expect(h.reportRows()).toBe(2);
    expect(h.files.files.size).toBe(2);
    expect(h.notes.map((n) => n.report.language)).toEqual(["en", "ko"]);
    const reports = output.reports ?? [];
    expect(reports.map((r) => r.report.language)).toEqual(["en", "ko"]);
    expect(reports.map((r) => r.report.id)).toEqual(["report-1", "report-2"]);
    expect(reports.map((r) => r.report.zoteroNoteKey)).toEqual([
      "NOTEKEY1",
      "NOTEKEY2",
    ]);
    expect(reports[0]?.noteHtml).not.toBe(reports[1]?.noteHtml);
    expect(reports[0]?.report.generatedAtEpochMs).toBe(
      reports[1]?.report.generatedAtEpochMs,
    );
    // `report`, `note` and `noteHtml` stay the first's.
    expect(output.report?.id).toBe("report-1");
    expect(output.noteHtml).toBe(reports[0]?.noteHtml);
    const record = await h.jobs.get(output.jobId);
    expect(record?.status).toBe("succeeded");
    expect(record?.resultRef).toEqual({ kind: "report", key: "report-1" });
  });

  it("each record describes its own path and counts the shared stages once per record", async () => {
    const h = await harness();
    const output = await h.run("both");
    const [english, korean] = (output.reports ?? []).map((r) => r.report);
    // FR-27: L1, L2, then L3 and L4 per language; each report's path is four.
    expect(output.passes).toBe(6);
    expect(english?.reductionPasses).toBe(4);
    expect(korean?.reductionPasses).toBe(4);
    expect(english?.prompts.map((p) => p.promptId)).not.toContain(
      "TREND_REPORT_KO",
    );
    expect(korean?.prompts.map((p) => p.promptId)).not.toContain(
      "TREND_REPORT_EN",
    );
    // 30 summaries + 1 clustering + 2 themes + its own composition and critique.
    expect(english?.usage?.inputTokens).toBe(35_000);
    expect(korean?.usage?.inputTokens).toBe(35_000);
  });

  it("names the language on a both run's draft deltas, and on no other run's", async () => {
    const seen: DraftDelta[] = [];
    const surface = { onDraft: (delta: DraftDelta) => void seen.push(delta) };
    const h = await harness();
    await h.run("both", { surface });
    const order = unique(seen.map((d) => d.language ?? "none"));
    expect(order).toEqual(["en", "ko"]);
    seen.length = 0;
    const single = await harness();
    await single.run("ko", { surface });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((d) => d.language === undefined)).toBe(true);
  });

  it("prices both languages before the run, and validate takes both and refuses anything else", async () => {
    const h = await harness();
    await h.run("en");
    const both = await harness();
    await both.run("both");
    const kinds = (r: TrendReportConfirmRequest) =>
      r.estimate.selected.synthesis.calls.map((c) => c.kind);
    const single = h.confirms[0] as TrendReportConfirmRequest;
    const two = both.confirms[0] as TrendReportConfirmRequest;
    expect(kinds(single).filter((k) => k === "TREND_REPORT_KO")).toEqual([]);
    expect(kinds(two).filter((k) => k === "TREND_REPORT_EN").length).toBe(
      kinds(single).filter((k) => k === "TREND_REPORT_EN").length,
    );
    expect(kinds(two).filter((k) => k === "TREND_REPORT_KO").length).toBe(
      kinds(single).filter((k) => k === "TREND_REPORT_EN").length,
    );
    expect(kinds(two).filter((k) => k === "SELF_CRITIQUE").length).toBe(
      2 * kinds(single).filter((k) => k === "SELF_CRITIQUE").length,
    );
    expect(two.estimate.selected.calls).toBeGreaterThan(
      single.estimate.selected.calls,
    );
    const input = { ...COLLECTION, language: "both" as const };
    expect(h.pipeline.validate(input).ok).toBe(true);
    expect(
      h.pipeline.validate({
        ...COLLECTION,
        language: "fr" as unknown as TrendReportInput["language"],
      }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The cache and the checkpoint
// ---------------------------------------------------------------------------

describe("P4-T21 — a both run's cache entries and checkpoints", () => {
  it("each language has its own rp entry: a later both pays only for the missing one, and a repeat for nothing", async () => {
    const h = await harness();
    await h.run("en");
    expect(h.compositions().map(languageOf)).toEqual(["en"]);
    await h.run("both");
    expect(h.compositions().map(languageOf)).toEqual(["en", "ko"]);
    const before = h.provider.calls.length;
    const repeat = await h.run("both");
    expect(repeat.outcome).toBe("succeeded");
    expect(h.provider.calls).toHaveLength(before);
    expect(repeat.reports).toHaveLength(2);
    expect(repeat.reports?.[1]?.report.language).toBe("ko");
  });

  it("writes the Composing checkpoint only after the last composition, so a resume never under-states", async () => {
    const h = await harness();
    const output = await h.run("both");
    const at = (stage: string) =>
      h.checkpoints.filter((c) => c.stage === stage);
    expect(at("Composing")).toEqual([{ stage: "Composing", compositions: 2 }]);
    expect(at("Critiquing")).toHaveLength(1);
    expect(at("Scaffolding")).toHaveLength(1);
    const record = await h.jobs.get(output.jobId);
    if (!isTrendReportCheckpoint(record?.checkpoint)) {
      throw new Error("no checkpoint");
    }
    // Priced from Analysing: both languages' compositions are still to come.
    const fromAnalysing = remainingFromCheckpoint({
      pipelineId: "trendReport",
      checkpoint: { ...record.checkpoint, stage: "Analysing" },
    });
    const composing = record.checkpoint.spend.find(
      (share) => share.stage === "Composing",
    );
    expect(composing?.calls).toBe(2);
    expect(fromAnalysing.calls).toBeGreaterThanOrEqual(2);
  });

  it("a cancel in the second language saves nothing, and the first language's paid report stays in its entry", async () => {
    const source = createCancellationTokenSource();
    const h = await harness({
      source,
      override: (call, level) => {
        if (level === "L3" && languageOf(call.request) === "ko") {
          source.cancel({ kind: "user" });
        }
        return undefined;
      },
    });
    const output = await h.run("both");
    expect(output.outcome).toBe("cancelled");
    expect(h.reportRows()).toBe(0);
    expect(h.notes).toHaveLength(0);
    expect(h.files.files.size).toBe(0);
    const again = await h.run("en", {
      source: createCancellationTokenSource(),
    });
    expect(again.outcome).toBe("succeeded");
    expect(h.compositions().filter((r) => languageOf(r) === "en")).toHaveLength(
      1,
    );
    expect(h.reportRows()).toBe(1);
  });

  /** What item 334(d) promises of a run that saved English alone. */
  async function expectEnglishAlone(
    h: Awaited<ReturnType<typeof harness>>,
    output: TrendReportOutput & { readonly jobId: string },
    reason: string,
  ): Promise<void> {
    expect(output.outcome).toBe("succeeded");
    expect(output.stop).toEqual({
      messageId: KOREAN_NOT_WRITTEN_L10N,
      args: { reason },
    });
    expect(output.reports?.map((one) => one.report.language)).toEqual(["en"]);
    expect(output.report?.language).toBe("en");
    expect(output.reports?.[0]?.note?.kind).toBe("written");
    expect(h.reportRows()).toBe(1);
    expect(h.notes.map((note) => note.report.language)).toEqual(["en"]);
    const record = await h.jobs.get(output.jobId);
    expect(record?.status).toBe("succeeded");
    expect(record?.resultRef).toEqual({
      kind: "report",
      key: output.report?.id,
    });
  }

  it("a Korean structure stop saves the English report and says why (item 334(d))", async () => {
    const h = await harness({
      override: (call, level) =>
        level === "L3" && languageOf(call.request) === "ko"
          ? chatResponse("## 1. only one heading\n", { usage: USAGE })
          : undefined,
    });
    await expectEnglishAlone(h, await h.run("both"), "structure");
  });

  it("a failed request while Korean is composed saves the English report (item 334(d))", async () => {
    const h = await harness({
      override: (call, level) => {
        if (level === "L3" && languageOf(call.request) === "ko") {
          throw new ContextLengthExceededError(
            "mock",
            "report-model",
            "too big",
          );
        }
        return undefined;
      },
    });
    await expectEnglishAlone(h, await h.run("both"), "request");
  });

  it("a failed request while Korean is critiqued saves the English report (item 334(d))", async () => {
    let critiques = 0;
    const h = await harness({
      override: (_call, level) => {
        if (level === "L4" && (critiques += 1) === 2) {
          throw new ContextLengthExceededError(
            "mock",
            "report-model",
            "too big",
          );
        }
        return undefined;
      },
    });
    await expectEnglishAlone(h, await h.run("both"), "request");
  });

  it("a failure in Korean's bibliography saves the English report (item 334(d))", async () => {
    const h = await harness({ failBibliography: 2 });
    await expectEnglishAlone(h, await h.run("both"), "finishing");
  });

  it("a failure rendering Korean's note saves the English report (item 334(d))", async () => {
    const h = await harness({ failCitationNodes: 2 });
    await expectEnglishAlone(h, await h.run("both"), "finishing");
  });

  it("a failure saving Korean's row saves the English report (item 334(d))", async () => {
    const h = await harness({ failReportPut: 2 });
    await expectEnglishAlone(h, await h.run("both"), "finishing");
  });

  it("a Korean row stored whose note write throws is delivered with no line (item 334(d))", async () => {
    const h = await harness({ failNote: 2 });
    const output = await h.run("both");
    expect(output.outcome).toBe("succeeded");
    expect(output.stop).toBeUndefined();
    expect(output.reports?.map((one) => one.report.language)).toEqual([
      "en",
      "ko",
    ]);
    expect(output.reports?.[1]?.note).toBeUndefined();
    expect(h.reportRows()).toBe(2);
  });

  it("the English report's own failure still fails the run (item 334(d))", async () => {
    const onEnglish = await harness({
      override: (call, level) => {
        if (level === "L3" && languageOf(call.request) === "en") {
          throw new ContextLengthExceededError(
            "mock",
            "report-model",
            "too big",
          );
        }
        return undefined;
      },
    });
    expect((await onEnglish.run("both")).outcome).toBe("failed");
    expect(onEnglish.reportRows()).toBe(0);
    const inBibliography = await harness({ failBibliography: 1 });
    expect((await inBibliography.run("both")).outcome).toBe("failed");
    expect(inBibliography.reportRows()).toBe(0);
  });

  it("a cancel or a shutdown that reaches Korean as another error still saves nothing (item 334(d))", async () => {
    for (const [kind, outcome] of [
      ["user", "cancelled"],
      ["shutdown", "interrupted"],
    ] as const) {
      const source = createCancellationTokenSource();
      const h = await harness({
        source,
        override: (call, level) => {
          if (level === "L3" && languageOf(call.request) === "ko") {
            source.cancel({ kind });
            throw new Error("the connection closed");
          }
          return undefined;
        },
      });
      const output = await h.run("both");
      expect(output.outcome, kind).toBe(outcome);
      expect(output.stop, kind).toBeUndefined();
      expect(h.reportRows(), kind).toBe(0);
      expect(h.notes, kind).toHaveLength(0);
    }
  });

  it("a planning error that is no lack of room is a defect: the run fails, with no Korean line (item 334(d))", async () => {
    const h = await harness({ brokenKoreanTemplate: true });
    const output = await h.run("both");
    expect(output.outcome).toBe("failed");
    expect(output.error?.code).toBe("CONFIGURATION");
    expect(output.stop).toBeUndefined();
    expect(h.compositions()).toEqual([]);
    expect(h.reportRows()).toBe(0);
  });

  it("a stop answered at a pause in the Korean half is a cancel, and saves nothing (item 334(d))", async () => {
    let first = true;
    const h = await harness({
      override: (call, level) => {
        if (level === "L3" && languageOf(call.request) === "ko" && first) {
          first = false;
          throw new AuthenticationError(401, "the key was rejected");
        }
        return undefined;
      },
    });
    const output = await h.run("both", {
      surface: { ask: () => Promise.resolve("cancel") },
    });
    expect(output.outcome).toBe("cancelled");
    expect(output.stop).toBeUndefined();
    expect(h.reportRows()).toBe(0);
    expect(h.notes).toHaveLength(0);
  });

  /**
   * At 32 000 / 32 000 both languages reach one budget at the floor (`docs/06`
   * §8.4's note of 2026-11-02), and the Korean template is larger, so only a
   * band about the two templates' difference wide fits English alone. The
   * largest padding English fits, all narrative so nothing can be dropped, is
   * found by running it, so a change to either template moves the size with it.
   */
  const TIGHT = { contextWindowTokens: 32_000, maxOutputTokens: 32_000 };
  async function largestEnglishPad(): Promise<number> {
    let fits = 0;
    let over = 2_000;
    while (over - fits > 1) {
      const middle = Math.floor((fits + over) / 2);
      const h = await harness({ ...TIGHT, padWords: middle });
      if ((await h.run("en")).outcome === "succeeded") fits = middle;
      else over = middle;
    }
    return fits;
  }

  it("a Korean request that cannot fit stops the both run before any report request, and says so (item 334(d))", async () => {
    const padWords = await largestEnglishPad();
    expect(padWords).toBeGreaterThan(0);
    const both = await harness({ ...TIGHT, padWords });
    const output = await both.run("both");
    expect(output.outcome).toBe("stopped");
    expect(output.stop).toEqual({
      messageId: KOREAN_NOT_WRITTEN_L10N,
      args: { reason: "no-room" },
    });
    expect(output.reports).toBeUndefined();
    expect(both.compositions()).toEqual([]);
    expect(both.reportRows()).toBe(0);
    expect(both.notes).toHaveLength(0);
    const record = await both.jobs.get(output.jobId);
    expect(record?.status).toBe("failed");
    expect(record?.error?.code).toBe(STOPPED_CODE);
    expect(record?.error?.detail).toBe("korean");
  }, 60_000);

  it("an English request that cannot fit is the single language's failure, not Korean's line", async () => {
    const padWords = (await largestEnglishPad()) + 1;
    const output = await (await harness({ ...TIGHT, padWords })).run("both");
    expect(output.outcome).toBe("failed");
    expect(output.error?.code).toBe("CONTEXT_LENGTH");
    expect(output.stop).toBeUndefined();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Done when 2: the Korean headings, in order
// ---------------------------------------------------------------------------

describe("P4-T21 — the Korean headings are validated in order", () => {
  const body = (headings: readonly string[]): string =>
    headings.map((h) => `## ${h}\n\nBody.\n`).join("\n");

  it("takes TREND_REPORT_KO's own eleven headings", () => {
    expect(KO_HEADINGS).toHaveLength(11);
    expect(KO_HEADINGS[6]).toBe(KO_HEADING_7);
    expect(checkHeadings(body(KO_HEADINGS), KO_HEADINGS).ok).toBe(true);
  });

  it("a draft missing section 7 fails, and names it", () => {
    const check = checkHeadings(
      body(KO_HEADINGS.filter((h) => h !== KO_HEADING_7)),
      KO_HEADINGS,
    );
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual([KO_HEADING_7]);
  });

  it("a draft with two sections swapped fails, and English headings do not pass for Korean", () => {
    const swapped = [...KO_HEADINGS];
    [swapped[6], swapped[7]] = [swapped[7] as string, swapped[6] as string];
    expect(checkHeadings(body(swapped), KO_HEADINGS).ok).toBe(false);
    expect(checkHeadings(body(EN_HEADINGS), KO_HEADINGS).ok).toBe(false);
  });

  it("a Korean draft missing section 7 asks once more, then stops the run with nothing saved", async () => {
    const h = await harness({
      override: (call, level) =>
        level === "L3"
          ? chatResponse(
              reportAnswer(call.request).replace(`## ${KO_HEADING_7}\n`, ""),
              { usage: USAGE },
            )
          : undefined,
    });
    const output = await h.run("ko");
    expect(output.outcome).toBe("stopped");
    expect(output.stop?.messageId).toBe(STRUCTURE_INVALID_L10N);
    expect(h.compositions()).toHaveLength(2);
    expect(h.reportRows()).toBe(0);
    expect(h.notes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Done when 3: the mechanical original-script check (item 286)
// ---------------------------------------------------------------------------

describe("P4-T21 — what code renders stays in the item's own script", () => {
  it("every Bibliography entry of a Korean report equals the fixture item's fields, byte for byte", async () => {
    const h = await harness();
    const output = await h.run("ko");
    const report = output.report;
    if (report === undefined) throw new Error("no report");
    const keys = (report.bibliography ?? []).map((e) => e.itemKey);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const entry of report.bibliography ?? []) {
      const i = indexOfKey(entry.itemKey);
      const f = fieldsOf(i);
      expect(entry.text).toBe(
        `${f.author} (${String(yearOf(i))}). ${titleOf(i)}. ${f.venue}.`,
      );
      expect(Buffer.from(entry.text, "utf8")).toEqual(
        Buffer.from(bibliographyTextOf(i), "utf8"),
      );
    }
    // The model's own §11 text, with its translated title, is not shipped.
    expect(report.markdown).not.toContain(MODEL_TRANSLATED_TITLE);
    const exported = renderReportMarkdown(report, {
      retractedHeading: reportLabel("ko", "retractedHeading"),
    });
    for (const entry of report.bibliography ?? []) {
      expect(exported).toContain(entry.text);
    }
    expect(output.noteHtml).not.toContain(MODEL_TRANSLATED_TITLE);
    for (const entry of report.bibliography ?? []) {
      expect(output.noteHtml).toContain(escapeHtml(entry.text));
    }
  });

  it("the Notable Papers key column renders the citation node built from the item's fields", async () => {
    const h = await harness();
    const output = await h.run("ko");
    const report = output.report;
    if (report === undefined) throw new Error("no report");
    const section = report.sections.find((s) => s.number === 10)?.markdown;
    const rows = (section ?? "")
      .split("\n")
      .filter((l) => l.startsWith("| [["));
    expect(rows).toHaveLength(8);
    expect(report.warnings).not.toContain("report_notable_papers_invalid");
    for (const row of rows) {
      const itemKey = /\[\[(K\d{7})\]\]/.exec(row)?.[1] as string;
      expect(output.noteHtml).toContain(citationNode(itemKey).html);
    }
  });

  it("each report's note heads its retracted list in its own language, and the entry stays the item's fields", async () => {
    const h = await harness({ retractFirst: true });
    const output = await h.run("both");
    expect(output.outcome).toBe("succeeded");
    const [english, korean] = output.reports ?? [];
    const ko = reportLabel("ko", "retractedHeading");
    const en = reportLabel("en", "retractedHeading");
    expect(korean?.noteHtml).toContain(escapeHtml(ko));
    expect(korean?.noteHtml).not.toContain(escapeHtml(en));
    expect(english?.noteHtml).toContain(escapeHtml(en));
    expect(english?.noteHtml).not.toContain(escapeHtml(ko));
    expect(korean?.noteHtml).toContain(escapeHtml(bibliographyTextOf(1)));
  });

  it("a both run's two Bibliographies give each paper the same string in both languages", async () => {
    const h = await harness();
    const output = await h.run("both");
    const [english, korean] = (output.reports ?? []).map((r) => r.report);
    const byKey = new Map(
      (english?.bibliography ?? []).map((e) => [e.itemKey, e.text]),
    );
    expect(byKey.size).toBeGreaterThan(0);
    for (const entry of korean?.bibliography ?? []) {
      expect(entry.text).toBe(byKey.get(entry.itemKey));
    }
  });

  it("a Korean report's bibliography and citation nodes ask for the en-US CSL locale (item 294)", async () => {
    const h = await harness();
    await h.run("ko");
    expect(h.requests.length).toBeGreaterThanOrEqual(2);
    expect(new Set(h.requests.map((r) => r.locale))).toEqual(
      new Set(["en-US"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Done when 4: the invalid-citation text of each language (item 292(b))
// ---------------------------------------------------------------------------

describe("P4-T21 — an invalid marker is replaced in the report's language", () => {
  const INVALID = "[[K9999999]]";
  const withInvalid = (request: ChatRequest): string =>
    reportAnswer(request).replace("Finding 2 reported", `${INVALID} Finding 2`);

  it("in a ko report with the Korean text, in an en report with the default", async () => {
    const override: Override = (call, level) =>
      level === "L3"
        ? chatResponse(withInvalid(call.request), { usage: USAGE })
        : undefined;
    const ko = await (await harness({ override })).run("ko");
    expect(ko.report?.markdown).toContain("[인용 삭제: 잘못된 참조]");
    expect(ko.report?.markdown).not.toContain("[citation removed");
    expect(ko.report?.markdown).not.toContain(INVALID);
    const en = await (await harness({ override })).run("en");
    expect(en.report?.markdown).toContain(
      "[citation removed: invalid reference]",
    );
    expect(en.report?.markdown).not.toContain("인용 삭제");
    expect(en.report?.markdown).not.toContain(INVALID);
  });

  it("in a both run each report takes its own language's text", async () => {
    const override: Override = (call, level) =>
      level === "L3"
        ? chatResponse(withInvalid(call.request), { usage: USAGE })
        : undefined;
    const output = await (await harness({ override })).run("both");
    const [english, korean] = (output.reports ?? []).map((r) => r.report);
    expect(english?.markdown).toContain(
      "[citation removed: invalid reference]",
    );
    expect(english?.markdown).not.toContain("인용 삭제");
    expect(korean?.markdown).toContain("[인용 삭제: 잘못된 참조]");
    expect(korean?.markdown).not.toContain("[citation removed");
  });
});

// ---------------------------------------------------------------------------
// `P4-T23` step 4's data source, through whole runs (owner, `plan/00` §6 item
// 335(k); `docs/07` §5.2's note of 2026-11-02)
// ---------------------------------------------------------------------------

describe("P4-T23 — each run's measurement", () => {
  const MARKER = "MARKER-CONTENT-7f3a";

  interface Given {
    readonly input: number;
    readonly output: number;
    readonly total: number;
    readonly reasoning: number | undefined;
    readonly cost: number;
    readonly level: Level;
    readonly ceiling: number | undefined;
  }

  /**
   * Answers as the harness's own, each with usage of its own, so a figure can
   * be traced to its call. The reasoning figure is only on the strong tier's
   * JSON calls, as a provider would differ from call to call.
   */
  function numbered(wrap: (text: string) => string = (text) => text): {
    readonly override: Override;
    readonly given: Given[];
  } {
    const given: Given[] = [];
    const override: Override = (call, level) => {
      const n = given.length + 1;
      const reasoning = level === "L1" || level === "L2" ? n : undefined;
      given.push({
        input: 1_000 + n,
        output: 100 + n,
        total: 1_100 + 2 * n,
        reasoning,
        cost: n / 1_000,
        level,
        ceiling: call.request.maxOutputTokens,
      });
      const usage = {
        inputTokens: 1_000 + n,
        outputTokens: 100 + n,
        totalTokens: 1_100 + 2 * n,
        costUsd: n / 1_000,
        ...(reasoning !== undefined && { reasoningTokens: reasoning }),
      };
      const answers: Record<Level, () => string> = {
        L0: summaryAnswer,
        L1: () => clusteringAnswer(call.request),
        L2: () => analysisAnswer(call.request, 3),
        L3: () => reportAnswer(call.request),
        L4: () => JSON.stringify({ verdict: "pass", problems: [] }),
      };
      return chatResponse(wrap(answers[level]()), { usage });
    };
    return { override, given };
  }

  const LEVEL_PROMPTS: Readonly<Record<Level, readonly string[]>> = {
    L0: ["PAPER_SUMMARY_ABSTRACT"],
    L1: ["THEME_CLUSTER"],
    L2: ["CLUSTER_REDUCE"],
    L3: ["TREND_REPORT_EN", "TREND_REPORT_KO"],
    L4: ["SELF_CRITIQUE"],
  };

  function measured(report: TrendReport | undefined) {
    const measurement = report?.runMeasurement;
    if (measurement === undefined) throw new Error("no measurement");
    return measurement;
  }

  function sorted(values: readonly number[]): number[] {
    return [...values].sort((a, b) => a - b);
  }

  it("a mock run's captured numbers match the mock's usage, call for call", async () => {
    const { override, given } = numbered();
    const h = await harness({ override });
    const output = await h.run("en");
    expect(output.outcome).toBe("succeeded");
    const { calls } = measured(output.report);
    expect(calls).toHaveLength(h.provider.calls.length);
    expect(calls).toHaveLength(given.length);
    // The pool answers in parallel, so each is found by its one input figure.
    for (const one of given) {
      const call = calls.find((c) => c.inputTokens === one.input);
      expect(call?.outputTokens).toBe(one.output);
      expect(call?.totalTokens).toBe(one.total);
      expect(call?.reasoningTokens).toBe(one.reasoning);
      expect(call?.costUsd).toBe(one.cost);
      expect(call?.maxOutputTokens).toBe(one.ceiling);
      expect(LEVEL_PROMPTS[one.level]).toContain(call?.promptId);
    }
    expect(sorted(calls.map((c) => c.inputTokens as number))).toEqual(
      sorted(given.map((g) => g.input)),
    );
    const clustering = calls.filter((c) => c.promptId === "THEME_CLUSTER");
    expect(clustering).toHaveLength(1);
    expect(clustering[0]?.papers).toBe(30);
    // Only THEME_CLUSTER's calls say how many papers they place.
    expect(calls.filter((c) => c.papers !== undefined)).toHaveLength(1);
    expect(calls.filter((c) => c.language === "en")).toHaveLength(2);
    expect(calls.filter((c) => c.language === undefined)).toHaveLength(33);
  });

  it("each real analysis's size is the raw estimate of what the composition sent", async () => {
    const { override } = numbered();
    const h = await harness({ override });
    const output = await h.run("en");
    const sent = JSON.parse(
      themeAnalysesOf(h.compositions()[0] as ChatRequest),
    ) as { readonly narrative: string }[];
    expect(measured(output.report).themeAnalyses).toStrictEqual(
      sent.map((analysis) => ({
        tokens: estTokens(JSON.stringify(analysis)),
        narrativeTokens: estTokens(analysis.narrative),
        papers: 15,
      })),
    );
    expect(sent).toHaveLength(2);
  });

  it("a both run holds its measurement once, so no sum over its rows counts a shared stage twice", async () => {
    const { override, given } = numbered();
    const h = await harness({ override });
    const output = await h.run("both");
    const [english, korean] = (output.reports ?? []).map((r) => r.report);
    const { calls, themeAnalyses } = measured(english);
    expect(korean).not.toHaveProperty("runMeasurement");
    expect(themeAnalyses).toHaveLength(2);

    // Every call once: 30 summaries, 1 clustering, 2 themes, 2 × (report, critique).
    expect(calls).toHaveLength(37);
    expect(sorted(calls.map((c) => c.inputTokens as number))).toEqual(
      sorted(given.map((g) => g.input)),
    );
    expect(calls.filter((c) => c.language === undefined)).toHaveLength(33);
    expect(calls.filter((c) => c.language === "en")).toHaveLength(2);
    expect(calls.filter((c) => c.language === "ko")).toHaveLength(2);
    expect(
      calls.filter((c) => c.language === "ko").map((c) => c.promptId),
    ).toEqual(["TREND_REPORT_KO", "SELF_CRITIQUE"]);

    // Shared plus a language's own is what that language's `usage` holds, and
    // the run's total is less than the two added.
    const inputOf = (language: string): number =>
      calls
        .filter((c) => c.language === undefined || c.language === language)
        .reduce((sum, c) => sum + (c.inputTokens as number), 0);
    expect(english?.usage?.inputTokens).toBe(inputOf("en"));
    expect(korean?.usage?.inputTokens).toBe(inputOf("ko"));
    const total = calls.reduce((sum, c) => sum + (c.inputTokens as number), 0);
    expect(total).toBeLessThan(
      (english?.usage?.inputTokens as number) +
        (korean?.usage?.inputTokens as number),
    );
  });

  it("a stored both run reads through the script: once, whichever row is read", async () => {
    const { override, given } = numbered();
    const h = await harness({ override });
    await h.run("both");
    const runs = groupRuns(h.storedJson().map(parseStoredReport));
    expect(runs).toHaveLength(1);
    const run = runs[0] as (typeof runs)[number];
    expect(run.reports.map((r) => r.language)).toEqual(["en", "ko"]);
    const shown = formatMeasurement(run);
    const inputs = given.reduce((sum, g) => sum + g.input, 0);
    expect(shown).toContain(`run total | calls 37 | input ${String(inputs)} |`);
    expect(measurementOf(run)?.calls).toHaveLength(37);
    expect(shown).not.toContain("합성");
  });

  it("no content reaches the stored field: a marker in every prompt and answer", async () => {
    const { override } = numbered((text) =>
      text.replace(/Synthetic|The intervention|Finding \d+/g, MARKER),
    );
    const h = await harness({ override });
    const output = await h.run("both");
    expect(output.outcome).toBe("succeeded");

    // The marker did travel: in a later prompt, in the stored report and in
    // the stored row, so its absence below is not for want of it.
    expect(
      h.provider.calls.some((call) =>
        call.request.messages.some((m) => m.content.includes(MARKER)),
      ),
    ).toBe(true);
    const rows = h.storedJson().map((json) => JSON.parse(json) as TrendReport);
    expect(JSON.stringify(rows)).toContain(MARKER);

    const stored = rows[0]?.runMeasurement;
    const text = JSON.stringify(stored);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("합성");
    expect(text).not.toContain("KEY");
    expect(text).not.toContain(output.jobId);
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      "calls",
      "themeAnalyses",
    ]);
    for (const call of stored?.calls ?? []) {
      for (const [name, value] of Object.entries(call)) {
        if (name === "promptId") expect(value).toMatch(/^[A-Z0-9_]+$/);
        else if (name === "language") expect(["en", "ko"]).toContain(value);
        else expect(typeof value).toBe("number");
      }
    }
    for (const size of stored?.themeAnalyses ?? []) {
      expect(Object.keys(size).sort()).toEqual([
        "narrativeTokens",
        "papers",
        "tokens",
      ]);
    }
    expect(output.reports?.[0]?.report.redaction?.partlyRedacted).toBe(false);
  });

  it("keeps the note's second write: the row still holds it after the note key is added", async () => {
    const { override } = numbered();
    const h = await harness({ override });
    const output = await h.run("en");
    expect(output.report?.zoteroNoteKey).toBe("NOTEKEY1");
    const [row] = h.storedJson().map((json) => JSON.parse(json) as TrendReport);
    expect(row?.zoteroNoteKey).toBe("NOTEKEY1");
    expect(row?.runMeasurement?.calls).toHaveLength(35);
  });

  it("a Korean report that stopped leaves its paid calls on the English record", async () => {
    const first = numbered();
    const h = await harness({
      override: (call, level) => {
        const answer = first.override(call, level) as ReturnType<
          typeof chatResponse
        >;
        return level === "L3" && languageOf(call.request) === "ko"
          ? chatResponse("## 1. only one heading\n", { usage: answer.usage })
          : answer;
      },
    });
    const output = await h.run("both");
    expect(output.reports).toHaveLength(1);
    const { calls } = measured(output.report);
    expect(calls).toHaveLength(first.given.length);
    const korean = calls.filter((c) => c.language === "ko");
    expect(korean.length).toBeGreaterThan(0);
    expect(korean.every((c) => c.promptId === "TREND_REPORT_KO")).toBe(true);
  });

  it("a run whose every stage was cached has no calls, and still each analysis's size", async () => {
    const h = await harness();
    const first = await h.run("en");
    const again = await h.run("en");
    expect(again.outcome).toBe("succeeded");
    const { calls, themeAnalyses } = measured(again.report);
    expect(calls).toEqual([]);
    expect(themeAnalyses).toStrictEqual(measured(first.report).themeAnalyses);
    expect(themeAnalyses[0]?.tokens).toBeGreaterThan(0);
  });

  it("a job resumed after a restart says its calls are partial; a fresh one does not", async () => {
    const h = await harness();
    const resumed = await h.run("en", {
      resumeState: {
        version: 1,
        stage: "Digesting",
        choice: { fullTextMode: "never", costGateBlocksFullText: false },
        spend: [],
      },
    });
    expect(measured(resumed.report).resumed).toBe(true);
    const fresh = await (await harness()).run("en");
    expect(measured(fresh.report)).not.toHaveProperty("resumed");
  });
});

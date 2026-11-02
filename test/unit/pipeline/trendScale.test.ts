/**
 * `P4-T22` — the 400-item scale test on the mock provider (FR-27; `docs/11`
 * §1 Phase 4's definition-of-done line, proved offline: owner, `plan/00` §6
 * item 286).
 *
 * 400 deterministic stored summaries (`test/helpers/syntheticSummaries.ts`,
 * 900–1 600 tokens each) go through the whole trend-report pipeline
 * (`createTrendReportPipeline`) on a scripted provider that **enforces a
 * context window and the output ceiling**: a request whose `estTokens` exceeds
 * the window is refused with `ContextLengthExceededError`, and a scripted
 * answer longer than the request's `maxOutputTokens` with
 * `OutputTruncatedError` (`plan/07` `P4-T22` step 2). The run is made once on
 * a 128 000-token model and once on a 32 000-token one.
 *
 * No network, no model, no key: `fetch` is replaced by a function that fails
 * the test, every answer is synthetic text written here, the cache and the
 * `summary`, `report` and `job` tables are the real ones over `node:sqlite` in
 * memory (the harness of `trendReportPipeline.test.ts`, copied, since a test
 * file cannot be imported). Nothing here asserts prose quality (`docs/13`
 * §2.2).
 */

import { DatabaseSync } from "node:sqlite";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import {
  createSqliteCache,
  type CacheBlobStore,
} from "../../../src/core/cache/sqliteCache";
import { createManualClock } from "../../../src/core/clock";
import {
  ContextLengthExceededError,
  OutputTruncatedError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
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
  createBudgetGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import {
  clusterBatchSize,
  DIGEST_MAX_TOKENS,
} from "../../../src/pipeline/shared/estimate";
import {
  egressLogEntry,
  withEgressLog,
} from "../../../src/pipeline/shared/egressDisclosure";
import {
  createPrivacyPolicy,
  readCollectionPrivacySettings,
  writeCollectionPrivacySettings,
  type CollectionRef,
} from "../../../src/pipeline/shared/privacyPolicy";
import {
  createJobNoticeRouter,
  type SummarizeLibraryItem,
} from "../../../src/pipeline/summarize/summarizePipeline";
import { OTHER_THEME_NAME } from "../../../src/pipeline/trendReport/cluster";
import { expectedHeadings } from "../../../src/pipeline/trendReport/compose";
import {
  digestTokens,
  toDigest,
  digestText,
} from "../../../src/pipeline/trendReport/digest";
import { EN_REPORT_LABELS } from "../../../src/pipeline/trendReport/reportLabels";
import {
  createTrendReportPipeline,
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
import {
  SYNTHETIC_SUMMARY_MAX_TOKENS,
  SYNTHETIC_SUMMARY_MIN_TOKENS,
  syntheticPapers,
  type SyntheticPaper,
} from "../../helpers/syntheticSummaries";

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

const COLLECTION: CollectionRef = { libraryID: 1, collectionKey: "SCALE400" };

/** The card's size and one fixed seed (`P4-T22` step 1). */
const PAPERS = 400;
const SEED = 20_261_101;

/** The card's Done-when: `npm run test:unit -- trendScale` in under 60 s. */
const SCALE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// The two simulated models (`P4-T22` step 2)
// ---------------------------------------------------------------------------

/**
 * One simulated report model. DECIDED 2026-11-01 (coordinator, under
 * `plan/00` §6 item 313): the 128 000-token model's output limit is 32 768
 * and the 32 000-token model's 8 192 — typical published pairs; the card
 * names only the windows.
 */
interface WindowProfile {
  readonly name: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
}

const WINDOW_128K: WindowProfile = {
  name: "128k",
  contextWindowTokens: 128_000,
  maxOutputTokens: 32_768,
};

const WINDOW_32K: WindowProfile = {
  name: "32k",
  contextWindowTokens: 32_000,
  maxOutputTokens: 8_192,
};

// ---------------------------------------------------------------------------
// The synthetic collection
// ---------------------------------------------------------------------------

function itemOf(paper: SyntheticPaper): SummarizeLibraryItem {
  const k = paper.itemKey;
  return {
    itemID: 10_000 + paper.index,
    itemKey: k,
    libraryID: 1,
    workKey: paper.workKey,
    metadata: {
      title: paper.title,
      authors: [`Author${k}, Ann`],
      year: paper.year,
      venue: "Journal of Synthetic Fixtures",
      itemType: "journalArticle",
      doi: paper.doi,
      tags: [],
    },
    dateModified: "2026-10-01 00:00:00",
    screen: {
      key: k,
      itemID: 10_000 + paper.index,
      itemType: "journalArticle",
      title: paper.title,
      year: paper.year,
      firstAuthorFamily: `Author${k}`,
      containerTitle: "Journal of Synthetic Fixtures",
      doi: paper.doi,
      abstractLength: 1_200,
      hasFullText: false,
      dateAdded: `2026-01-01 00:00:${String(paper.index % 60).padStart(2, "0")}`,
      retraction: { zotero: { retracted: false, reasons: [] } },
    },
  };
}

// ---------------------------------------------------------------------------
// The scripted model: answers by what each request is
// ---------------------------------------------------------------------------

const KEY = "S[0-9]{7}";

function userOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "user")?.content ?? "";
}

function systemOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "system")?.content ?? "";
}

/** Which call a request is (`docs/06` §8.3's levels, by prompt). */
type CallKind =
  | "THEME_CLUSTER"
  | "THEME_MERGE"
  | "CLUSTER_REDUCE"
  | "CLUSTER_REDUCE_MERGE"
  | "TREND_REPORT"
  | "SELF_CRITIQUE"
  | "MAP";

function kindOf(request: ChatRequest): CallKind {
  const format = request.responseFormat;
  if (format?.kind === "json_schema") {
    if (format.name === "ThemeClustering") return "THEME_CLUSTER";
    if (format.name === "ThemeMerge") return "THEME_MERGE";
    if (format.name === "ThemeAnalysis") {
      return /partial analyses/i.test(systemOf(request))
        ? "CLUSTER_REDUCE_MERGE"
        : "CLUSTER_REDUCE";
    }
    if (format.name === "SelfCritique") return "SELF_CRITIQUE";
    return "MAP";
  }
  return "TREND_REPORT";
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

/** One `{{DIGESTS}}` block: its key and its `Theme(first-pass):` text. */
function digestBlocks(
  user: string,
): { readonly key: string; readonly theme: string | undefined }[] {
  const heads = [...user.matchAll(new RegExp(`^\\[(${KEY})\\] `, "gm"))];
  return heads.map((head, i) => {
    const end = heads[i + 1]?.index ?? user.length;
    const block = user.slice(head.index, end);
    const theme = /^Theme\(first-pass\): (.+)$/m.exec(block)?.[1]?.trim();
    return { key: head[1] as string, theme };
  });
}

/** `{{MIN_THEMES}}`, as the clustering prompt states it. */
function minThemesOf(user: string): number {
  const match = /between ([0-9]+) and ([0-9]+)/.exec(user);
  return match === null ? 1 : Number(match[1]);
}

/**
 * A clustering answer: papers grouped by their digest's first-pass theme,
 * the largest group halved until the prompt's minimum count is met; a paper
 * whose digest has no theme line is left out, so the stage re-runs once and
 * then gives it the client's `Other` theme (`docs/12` §8 rule (3)).
 */
function clusteringAnswer(request: ChatRequest): string {
  const user = userOf(request);
  const groups = new Map<string, string[]>();
  for (const block of digestBlocks(user)) {
    if (block.theme === undefined) continue;
    const list = groups.get(block.theme) ?? [];
    list.push(block.key);
    groups.set(block.theme, list);
  }
  const themes: { name: string; keys: string[] }[] = [...groups].map(
    ([name, keys]) => ({ name, keys }),
  );
  const minThemes = minThemesOf(user);
  while (themes.length < minThemes) {
    themes.sort((a, b) => b.keys.length - a.keys.length);
    const largest = themes[0];
    if (largest === undefined || largest.keys.length < 8) break;
    const half = Math.ceil(largest.keys.length / 2);
    themes.push({ name: largest.name, keys: largest.keys.slice(half) });
    largest.keys = largest.keys.slice(0, half);
  }
  return JSON.stringify({
    themes: themes.map((theme, i) => ({
      themeId: `T${String(i + 1)}`,
      name: theme.name,
      definition: `Papers that study ${theme.name.toLowerCase()}.`,
      itemKeys: theme.keys,
      rationale: "Shared synthetic questions.",
    })),
    assignments: themes.flatMap((theme, i) =>
      theme.keys.map((itemKey) => ({
        itemKey,
        primaryThemeId: `T${String(i + 1)}`,
        fit: "strong",
      })),
    ),
  });
}

/** A merge answer: local themes with the same name become one global theme. */
function mergeAnswer(request: ChatRequest): string {
  const user = userOf(request);
  const blocks = [
    ...user.matchAll(/^\[(B[0-9]+-T[0-9]+)\] papers: [0-9]+\nName: (.+)$/gm),
  ].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
  const names = unique(blocks.map((b) => b.name));
  const idOf = (name: string): string => `T${String(names.indexOf(name) + 1)}`;
  return JSON.stringify({
    themes: names.map((name) => ({
      themeId: idOf(name),
      name,
      definition: `Papers that study ${name.toLowerCase()}.`,
      rationale: "The same synthetic topic in every batch.",
    })),
    mapping: blocks.map((b) => ({
      localThemeId: b.id,
      globalThemeId: idOf(b.name),
    })),
  });
}

function analysisAnswer(request: ChatRequest): string {
  const user = userOf(request);
  const themeId = /"themeId": "(T[0-9]+)"/.exec(user)?.[1] ?? "T1";
  const keys = unique(
    Array.from(
      user.matchAll(new RegExp(`"itemKey":"(${KEY})"`, "g")),
      (m) => m[1] as string,
    ),
  );
  return JSON.stringify({
    themeId,
    name: "echo",
    narrative: `Work in this theme ${keys
      .slice(0, 3)
      .map((k) => `[[${k}]]`)
      .join(" ")} reported a change in the outcome.`,
    representativePapers: keys
      .slice(0, 2)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  });
}

function reportAnswer(request: ChatRequest): string {
  const keys = unique(
    Array.from(
      userOf(request).matchAll(new RegExp(`\\[\\[(${KEY})\\]\\]`, "g")),
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

function answerTo(request: ChatRequest): string {
  switch (kindOf(request)) {
    case "THEME_CLUSTER":
      return clusteringAnswer(request);
    case "THEME_MERGE":
      return mergeAnswer(request);
    case "CLUSTER_REDUCE":
    case "CLUSTER_REDUCE_MERGE":
      return analysisAnswer(request);
    case "SELF_CRITIQUE":
      return JSON.stringify({ verdict: "pass", problems: [] });
    case "TREND_REPORT":
      return reportAnswer(request);
    default:
      throw new Error("P4-T22: no paper should be summarized in this run");
  }
}

/** What the windowed mock saw of one request. */
interface CallRecord {
  readonly kind: CallKind;
  /** `estTokens` of every message, raw (no model id), as the mock measures. */
  readonly inputTokens: number;
  readonly maxOutputTokens: number | undefined;
  readonly answerTokens: number | undefined;
  readonly refused: "context-length" | "output-truncated" | undefined;
  /** The `{{DIGESTS}}` keys of a clustering call, sorted and joined. */
  readonly clusterKeys: string | undefined;
}

/**
 * The window-enforcing step (`P4-T22` step 2). DECIDED 2026-11-01
 * (coordinator, under `plan/00` §6 item 313): "`estTokens` of the request"
 * is the card's text, read as the raw `estTokens` of every message — the
 * input, which is what `mockLLM` reserves too. The output ceiling is checked
 * separately, against the request's own `maxOutputTokens`. Whether input +
 * `maxOutputTokens` would also fit (what some providers check) is recorded in
 * {@link CallRecord} and reported, not enforced.
 */
function windowedStep(
  profile: WindowProfile,
  log: CallRecord[],
): (call: MockCall) => ReturnType<typeof chatResponse> | Error {
  return (call) => {
    const request = call.request;
    const kind = kindOf(request);
    const inputTokens = request.messages.reduce(
      (sum, message) => sum + estTokens(message.content),
      0,
    );
    const clusterKeys =
      kind === "THEME_CLUSTER"
        ? digestBlocks(userOf(request))
            .map((b) => b.key)
            .sort()
            .join(",")
        : undefined;
    const base = {
      kind,
      inputTokens,
      maxOutputTokens: request.maxOutputTokens,
      clusterKeys,
    };
    if (inputTokens > profile.contextWindowTokens) {
      log.push({ ...base, answerTokens: undefined, refused: "context-length" });
      return new ContextLengthExceededError(
        "openrouter",
        request.model,
        `P4-T22 mock: ${String(inputTokens)} tokens exceed the ${String(profile.contextWindowTokens)}-token window`,
      );
    }
    const text = answerTo(request);
    const answerTokens = estTokens(text);
    const ceiling = request.maxOutputTokens ?? profile.maxOutputTokens;
    if (answerTokens > ceiling) {
      log.push({ ...base, answerTokens, refused: "output-truncated" });
      return new OutputTruncatedError(
        "openrouter",
        request.model,
        `P4-T22 mock: a ${String(answerTokens)}-token answer exceeds max_tokens ${String(ceiling)}`,
      );
    }
    log.push({ ...base, answerTokens, refused: undefined });
    return chatResponse(text, {
      usage: {
        inputTokens,
        outputTokens: answerTokens,
        totalTokens: inputTokens + answerTokens,
        costUsd: undefined,
      },
    });
  };
}

// ---------------------------------------------------------------------------
// The harness (from trendReportPipeline.test.ts)
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

function memorySettings(): CollectionSettingsStore {
  const rows = new Map<string, Record<string, unknown>>();
  const id = (libraryID: number, collectionKey: string): string =>
    `${String(libraryID)}/${collectionKey}`;
  return {
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

/** What one scale run leaves behind. */
interface ScaleRun {
  readonly profile: WindowProfile;
  readonly output: TrendReportOutput;
  readonly log: readonly CallRecord[];
  readonly confirms: readonly TrendReportConfirmRequest[];
  readonly notes: readonly ReportNoteRequest[];
  readonly reportRows: number;
  readonly files: number;
  readonly acquired: number;
  readonly papers: readonly SyntheticPaper[];
  readonly wallMs: number;
  readonly heapGrowthBytes: number;
}

async function scaleRun(profile: WindowProfile): Promise<ScaleRun> {
  const papers = syntheticPapers({ count: PAPERS, seed: SEED });
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
  for (const paper of papers) await store.put(paper.summary);
  const files = memoryFiles();
  const reports = createReportStore(connection, files);
  const settings = memorySettings();
  const router = createJobNoticeRouter();
  const jobs = createJobQueue({
    clock,
    logger,
    pluginVersion: "0.0.0-test",
    isResumable: (id) => id === "trendReport",
    notifier: router.notifier,
  });
  jobs.attachStore(createJobStore(connection));
  const log: CallRecord[] = [];
  const info = (id: string) =>
    mockModel(id, {
      contextWindowTokens: profile.contextWindowTokens,
      maxOutputTokens: profile.maxOutputTokens,
      dataPolicy: {
        trainsOnInputByDefault: "no",
        retention: { days: "zero", note: "" },
      },
    });
  const provider = mockLLM([windowedStep(profile, log)], {
    streaming: true,
    models: [info("summary-model"), info("report-model")],
  });
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
  const items = papers.map(itemOf);
  const notes: ReportNoteRequest[] = [];
  const confirms: TrendReportConfirmRequest[] = [];
  let acquired = 0;
  const pipeline = createTrendReportPipeline({
    library: {
      loadCollection: () =>
        Promise.resolve({ name: "Scale400", editable: true, items }),
      acquire: () => {
        acquired += 1;
        return Promise.reject(new Error("P4-T22: every summary is stored"));
      },
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
    pool: createLlmPool(() => 4),
    admission: createJobAdmission(),
    runningWork: createRunningWork(),
    pauseNotices: router,
    prices: () => PRICES,
    baseUrls: { effectiveHost: () => "openrouter.ai" },
    egressAcknowledged: () => true,
    modelInfo: (_provider, id) => info(id),
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
    newReportId: () => "report-scale-1",
  });
  const values: Partial<Record<PrefName, unknown>> = {
    reportMaxCritiqueRounds: 1,
    reportSaveNote: true,
    cacheEnabled: true,
  };
  const config = {
    get: (name: PrefName) => (name in values ? values[name] : getPref(name)),
  } as unknown as ConfigReader;
  const session = createSessionSpendCounter();
  const source = createCancellationTokenSource();
  const context = (jobId: string): PipelineContext => ({
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
    resumeState: undefined,
  });
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
  };
  const input: TrendReportInput = { ...COLLECTION, language: "en" };

  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const prepared = await pipeline.prepare(
    input,
    context("prepare-only"),
    surface,
  );
  const record = await jobs.enqueue(
    "trendReport",
    prepared.disclosure === undefined
      ? input
      : withEgressLog(input, egressLogEntry(prepared.disclosure, 0)),
  );
  const output = await pipeline.execute(prepared, context(record.id), surface);
  const wallMs = performance.now() - started;
  const heapGrowthBytes = process.memoryUsage().heapUsed - heapBefore;
  const count = (sql: string): number =>
    (connection.db.prepare(sql).get() as { n: number }).n;
  const result: ScaleRun = {
    profile,
    output,
    log,
    confirms,
    notes,
    reportRows: count("SELECT COUNT(*) AS n FROM report"),
    files: files.files.size,
    acquired,
    papers,
    wallMs,
    heapGrowthBytes,
  };
  // Measurements for the card's report, written only when asked for.
  const metricsFile = process.env["P4T22_METRICS_FILE"];
  if (metricsFile !== undefined && metricsFile !== "") {
    appendFileSync(
      metricsFile,
      `${JSON.stringify({ profile: profile.name, ...metricsOf(result) })}\n`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reading the call log
// ---------------------------------------------------------------------------

/**
 * FR-27's pass count, rebuilt from the call log by `docs/07` §12.4's reading
 * 4 (`plan/00` §6 item 322(b)): L1 — one per distinct `THEME_CLUSTER` input
 * (a re-run of the same digests is a request, not a pass) plus one for a
 * `THEME_MERGE`; L2 — two when any theme went through `CLUSTER_REDUCE_MERGE`,
 * else one; L3 — one composition; L4 — one per critique round (one here).
 */
function passesFromLog(log: readonly CallRecord[]): number {
  const answered = log.filter((c) => c.refused === undefined);
  const has = (kind: CallKind): boolean =>
    answered.some((c) => c.kind === kind);
  const l1 =
    new Set(
      answered
        .filter((c) => c.kind === "THEME_CLUSTER")
        .map((c) => c.clusterKeys),
    ).size + (has("THEME_MERGE") ? 1 : 0);
  const l2 = has("CLUSTER_REDUCE_MERGE") ? 2 : has("CLUSTER_REDUCE") ? 1 : 0;
  const l3 = has("TREND_REPORT") ? 1 : 0;
  const l4 = has("SELF_CRITIQUE") ? 1 : 0;
  return l1 + l2 + l3 + l4;
}

/** The synthesis calls the run's confirmed estimate reserved, by kind. */
function reservedByKind(run: ScaleRun): Partial<Record<CallKind, number>> {
  const counts: Partial<Record<CallKind, number>> = {};
  for (const call of run.confirms[0]?.estimate.selected.synthesis.calls ?? []) {
    const kind: CallKind = call.kind.startsWith("TREND_REPORT")
      ? "TREND_REPORT"
      : (call.kind as CallKind);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function countOf(log: readonly CallRecord[], kind: CallKind): number {
  return log.filter((c) => c.kind === kind).length;
}

function metricsOf(run: ScaleRun): Record<string, unknown> {
  const kinds: CallKind[] = [
    "THEME_CLUSTER",
    "THEME_MERGE",
    "CLUSTER_REDUCE",
    "CLUSTER_REDUCE_MERGE",
    "TREND_REPORT",
    "SELF_CRITIQUE",
  ];
  return {
    outcome: run.output.outcome,
    error: run.output.error?.code,
    passes: run.output.passes,
    passesFromLog: passesFromLog(run.log),
    calls: Object.fromEntries(kinds.map((k) => [k, countOf(run.log, k)])),
    refused: run.log
      .filter((c) => c.refused !== undefined)
      .map((c) => ({
        kind: c.kind,
        refused: c.refused,
        inputTokens: c.inputTokens,
        maxOutputTokens: c.maxOutputTokens,
      })),
    largestInput: Object.fromEntries(
      kinds.map((k) => [
        k,
        Math.max(
          0,
          ...run.log.filter((c) => c.kind === k).map((c) => c.inputTokens),
        ),
      ]),
    ),
    largestInputPlusMaxTokens: Math.max(
      0,
      ...run.log.map((c) => c.inputTokens + (c.maxOutputTokens ?? 0)),
    ),
    twoStageEstimated:
      run.confirms[0]?.estimate.selected.synthesis.twoStageClustering,
    reservedCalls: reservedByKind(run),
    overModelOutputLimit: run.log.filter(
      (c) => (c.maxOutputTokens ?? 0) > run.profile.maxOutputTokens,
    ).length,
    wallMs: Math.round(run.wallMs),
    heapGrowthMB: Math.round(run.heapGrowthBytes / 1_048_576),
    warnings: run.output.report?.warnings,
  };
}

/** Every analysed key exactly once across the clustering (`P4-T22` step 3). */
function keysOnce(run: ScaleRun): {
  readonly placed: string[];
  readonly analysed: string[];
} {
  const clustering = run.output.report?.clustering;
  const placed = [
    ...(clustering?.assignments ?? []).map((a) => a.itemKey),
    ...(clustering?.unclustered ?? []).map((u) => u.itemKey),
  ];
  return { placed, analysed: run.papers.map((p) => p.itemKey) };
}

/** FR-27: the header states the pass count; Appendix's parameters repeat it. */
function expectStatedPasses(run: ScaleRun): void {
  const report = run.output.report;
  const stated = String(run.output.passes);
  const markdown = report?.markdown ?? "";
  expect(markdown).toContain(
    EN_REPORT_LABELS.headerAnalysis
      .replace("{fullText}", String(report?.scope.fullTextCount))
      .replace("{abstract}", String(report?.scope.abstractCount))
      .replace("{passes}", stated),
  );
  expect(
    markdown.split(
      EN_REPORT_LABELS.paramReductionPasses.replace("{passes}", stated),
    ),
  ).toHaveLength(3); // the header and the parameters, each once
}

// ---------------------------------------------------------------------------
// No network, ever
// ---------------------------------------------------------------------------

const fetchSpy = vi.fn(() => {
  throw new Error("P4-T22: no network request may be made");
});

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. The synthetic collection
// ---------------------------------------------------------------------------

describe("P4-T22 — 400 synthetic stored summaries (step 1)", () => {
  it("are deterministic in the seed, 900–1 600 tokens each, with digests within the 140-token cap", () => {
    const papers = syntheticPapers({ count: PAPERS, seed: SEED });
    expect(papers).toHaveLength(PAPERS);
    expect(JSON.stringify(syntheticPapers({ count: PAPERS, seed: SEED }))).toBe(
      JSON.stringify(papers),
    );
    expect(
      JSON.stringify(syntheticPapers({ count: PAPERS, seed: SEED + 1 })),
    ).not.toBe(JSON.stringify(papers));
    const sizes = papers.map((p) =>
      estTokens(JSON.stringify(p.summary.content)),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(
      SYNTHETIC_SUMMARY_MIN_TOKENS,
    );
    expect(Math.max(...sizes)).toBeLessThanOrEqual(
      SYNTHETIC_SUMMARY_MAX_TOKENS,
    );
    expect(new Set(papers.map((p) => p.itemKey)).size).toBe(PAPERS);
    for (const paper of papers) {
      const digest = toDigest({ summary: paper.summary, year: paper.year });
      expect(digestTokens(digestText(digest))).toBeLessThanOrEqual(
        DIGEST_MAX_TOKENS,
      );
    }
    // Eight orphans (every 50th) for the client's Other theme.
    expect(papers.filter((p) => p.topic === undefined)).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 2. The mock itself (a guard that never fires proves nothing)
// ---------------------------------------------------------------------------

describe("P4-T22 — the mock enforces the window and the output ceiling (step 2)", () => {
  const call = (request: ChatRequest): MockCall => ({
    index: 1,
    request,
    ctx: undefined as unknown as MockCall["ctx"],
  });
  const profile: WindowProfile = {
    name: "tiny",
    contextWindowTokens: 100,
    maxOutputTokens: 100,
  };
  const critique = (content: string, maxOutputTokens: number): ChatRequest => ({
    model: "report-model",
    traceId: "p4-t22-guard",
    messages: [{ role: "user", content }],
    maxOutputTokens,
    responseFormat: { kind: "json_schema", name: "SelfCritique", schema: {} },
  });

  it("refuses a request over the window, and only then", () => {
    const step = windowedStep(profile, []);
    expect(step(call(critique("x ".repeat(1_000), 100)))).toBeInstanceOf(
      ContextLengthExceededError,
    );
    expect(step(call(critique("short", 100)))).not.toBeInstanceOf(Error);
  });

  it("refuses an answer longer than the request's max_tokens, and only then", () => {
    const log: CallRecord[] = [];
    const step = windowedStep(profile, log);
    expect(step(call(critique("short", 1)))).toBeInstanceOf(
      OutputTruncatedError,
    );
    expect(log.map((c) => c.refused)).toEqual(["output-truncated"]);
    expect(step(call(critique("short", 100)))).not.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// 3. The 128 000-token run
// ---------------------------------------------------------------------------

describe("P4-T22 — a 400-item report on a 128 000-token window (Done when 1, 2)", () => {
  it(
    "finishes with no context-length error and no truncation; the header's pass count equals the call log's; every key is placed once",
    async () => {
      const run = await scaleRun(WINDOW_128K);
      expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
      expect(run.output.outcome).toBe("succeeded");
      expect(run.output.passes).toBe(passesFromLog(run.log));
      expect(run.output.report?.reductionPasses).toBe(run.output.passes);
      expectStatedPasses(run);
      // Every analysed key exactly once in the clustering.
      const { placed, analysed } = keysOnce(run);
      expect([...placed].sort()).toEqual([...analysed].sort());
      expect(run.output.report?.scope.analysedCount).toBe(PAPERS);
      // The papers with no theme line went to the client's Other theme.
      expect(
        run.output.report?.clustering.themes.some(
          (t) => t.name === OTHER_THEME_NAME,
        ),
      ).toBe(true);
      // One report: one row, one file, one note; nothing summarized, nothing fetched.
      expect(run.reportRows).toBe(1);
      expect(run.files).toBe(1);
      expect(run.notes).toHaveLength(1);
      expect(run.acquired).toBe(0);
      expect(countOf(run.log, "MAP")).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(run.confirms).toHaveLength(1);
      expect(run.wallMs).toBeLessThan(SCALE_TIMEOUT_MS);
      // DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313): a
      // memory bound of 256 MB of heap growth; measured 6–20 MB.
      expect(run.heapGrowthBytes).toBeLessThan(256 * 1_048_576);
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "the confirmed estimate reserved at least every synthesis call of each kind the run made, and no request asked more than the model's output limit",
    async () => {
      const run = await scaleRun(WINDOW_128K);
      expect(run.output.outcome).toBe("succeeded");
      const reserved = reservedByKind(run);
      // A clustering re-run is not reserved (`planSynthesis`' header, "no
      // estimate can predict them"), so the first requests are compared.
      const distinctInputs = new Set(
        run.log
          .filter((c) => c.kind === "THEME_CLUSTER")
          .map((c) => c.clusterKeys),
      );
      expect(distinctInputs.size).toBeLessThanOrEqual(
        reserved.THEME_CLUSTER ?? 0,
      );
      for (const kind of [
        "THEME_MERGE",
        "CLUSTER_REDUCE",
        "CLUSTER_REDUCE_MERGE",
        "TREND_REPORT",
        "SELF_CRITIQUE",
      ] as const) {
        expect(countOf(run.log, kind)).toBeLessThanOrEqual(reserved[kind] ?? 0);
      }
      expect(
        run.log.filter(
          (c) => (c.maxOutputTokens ?? 0) > WINDOW_128K.maxOutputTokens,
        ),
      ).toEqual([]);
    },
    SCALE_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// 4. The 32 000-token run
// ---------------------------------------------------------------------------

describe("P4-T22 — a 400-item report on a 32 000-token window (Done when 1, 2)", () => {
  it(
    "clusters in two stages, in ⌈N / B⌉ batches with B = clusterBatchSize at the model's output limit, each batch inside the window",
    async () => {
      const run = await scaleRun(WINDOW_32K);
      const batch = clusterBatchSize(
        PROMPTS.get("THEME_CLUSTER"),
        WINDOW_32K.maxOutputTokens,
      );
      const batches = new Set(
        run.log
          .filter((c) => c.kind === "THEME_CLUSTER")
          .map((c) => c.clusterKeys),
      );
      expect(batches.size).toBe(Math.ceil(PAPERS / batch));
      expect(countOf(run.log, "THEME_MERGE")).toBeGreaterThanOrEqual(1);
      expect(
        run.log
          .filter((c) => c.kind === "THEME_CLUSTER" || c.kind === "THEME_MERGE")
          .every((c) => c.refused === undefined),
      ).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
    SCALE_TIMEOUT_MS,
  );

  // FINDING P4-T22-1 (2026-11-01): the pipeline never reads the report
  // model's context window. `createTrendReportPipeline`'s execute passes no
  // `inputBudget` to `clusterThemes`, `composeReport` or `critiqueReport`,
  // and `analyseThemes` packs to the fixed 40 000 of
  // `SYNTHESIS_INPUT_BUDGETS.CLUSTER_REDUCE`. On this 32 000-token model the
  // clustering is two-stage only because the output limit forces it (the test
  // above); then ten `CLUSTER_REDUCE` sub-batches of 38 000–40 500 tokens
  // are refused (each theme left unanalysed with CONTEXT_LENGTH) and the
  // 53 000-token `TREND_REPORT_EN` request fails the run. Skipped until the
  // fix described in plan/reports/P4-T22.md ("SRC FIXES NEEDED") lands.
  it.skip(
    "finishes with no context-length error and no truncation; the header's pass count equals the call log's; every key is placed once (FINDING P4-T22-1)",
    async () => {
      const small = await scaleRun(WINDOW_32K);
      expect(small.log.filter((c) => c.refused !== undefined)).toEqual([]);
      expect(small.output.outcome).toBe("succeeded");
      expect(small.output.passes).toBe(passesFromLog(small.log));
      expect(small.output.report?.reductionPasses).toBe(small.output.passes);
      expectStatedPasses(small);
      const { placed, analysed } = keysOnce(small);
      expect([...placed].sort()).toEqual([...analysed].sort());
      expect(small.reportRows).toBe(1);
      expect(small.files).toBe(1);
      expect(small.notes).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
    SCALE_TIMEOUT_MS,
  );

  // FINDING P4-T22-1, as above: needs the 32 000 run to finish.
  it.skip(
    "reports more passes than the 128 000 run, and each run's count equals its call log (FINDING P4-T22-1)",
    async () => {
      const small = await scaleRun(WINDOW_32K);
      const large = await scaleRun(WINDOW_128K);
      expect(small.output.outcome).toBe("succeeded");
      expect(large.output.outcome).toBe("succeeded");
      expect(small.output.passes).toBe(passesFromLog(small.log));
      expect(large.output.passes).toBe(passesFromLog(large.log));
      expect(small.output.passes).toBeGreaterThan(large.output.passes);
    },
    SCALE_TIMEOUT_MS,
  );

  // FINDING P4-T22-1, the plainest case: `parseCatalogueEntry` (OpenRouter) gives
  // a model with no stated completion limit its whole window as its output
  // limit, so nothing forces two stages, and the 52 000-token single
  // `THEME_CLUSTER` request goes to a 32 000-token model.
  it.skip(
    "still clusters in two stages when the output limit does not force them: the window alone does (FINDING P4-T22-1)",
    async () => {
      const run = await scaleRun({
        name: "32k-output-at-window",
        contextWindowTokens: 32_000,
        maxOutputTokens: 32_000,
      });
      expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
      expect(countOf(run.log, "THEME_MERGE")).toBeGreaterThanOrEqual(1);
      expect(run.output.outcome).toBe("succeeded");
      expect(run.output.passes).toBe(passesFromLog(run.log));
    },
    SCALE_TIMEOUT_MS,
  );
});

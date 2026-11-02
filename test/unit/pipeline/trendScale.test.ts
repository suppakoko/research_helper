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
  planSynthesis,
  REPORT_OUTPUT_FLOOR,
  synthesisBudgets,
  type SynthesisCallKind,
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
import {
  OTHER_THEME_NAME,
  partitionDigests,
} from "../../../src/pipeline/trendReport/cluster";
import {
  ANALYSES_SHORTENED_WARNING,
  expectedHeadings,
  OUTPUT_LOWERED_WARNING,
} from "../../../src/pipeline/trendReport/compose";
import {
  digestTokens,
  toDigest,
  digestText,
} from "../../../src/pipeline/trendReport/digest";
import {
  EN_REPORT_LABELS,
  reportLabel,
} from "../../../src/pipeline/trendReport/reportLabels";
import {
  maxPartialsPerMerge,
  packThemeSummaries,
} from "../../../src/pipeline/trendReport/themeAnalysis";
import {
  createTrendReportPipeline,
  measureSynthesisOverhead,
  stageInputsOf,
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
import type { TrendReport } from "../../../src/model/trend";
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
const KO_HEADINGS = expectedHeadings(PROMPTS.get("TREND_REPORT_KO"));

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
  /**
   * The critique model's window, when it is not the report model's. It goes to
   * the catalogue only; the mock's enforced window stays the profile's.
   */
  readonly critiqueContextWindowTokens?: number;
  /**
   * The size of each theme analysis, over every schema field
   * ({@link fullAnalysisAnswer}). Without it the answers are at most 84 tokens,
   * where a real analysis may reach 3 000 (FINDING P4-T22-2).
   */
  readonly analysisTokens?: number;
  /** The report's language; `en` when absent. */
  readonly language?: TrendReportInput["language"];
  /**
   * The report answer is as long as its `{{TARGET_WORDS}}` asks, by `docs/12`
   * §10's visible tokens, so a target over the output is a refused answer.
   */
  readonly writeTargetLength?: boolean;
  /** The first critique finds a high problem, so the report is rewritten once. */
  readonly rewriteOnce?: boolean;
}

/**
 * Sizes for {@link WindowProfile.analysisTokens}: this one's largest answer is
 * just under `CLUSTER_REDUCE`'s 3 000 ceiling, which the mock enforces.
 */
const LARGEST_ANALYSIS_TOKENS = 2_950;

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

/** About `tokens` by `estTokens`. */
function filler(tokens: number): string {
  return " x".repeat(Math.ceil(tokens * 1.85)).trim();
}

/** As many entries of about `each` tokens as `tokens` holds, at least one. */
function entries<T>(tokens: number, each: number, make: () => T): T[] {
  return Array.from({ length: Math.max(1, Math.round(tokens / each)) }, make);
}

/**
 * An analysis of `tokens` over every schema field, within its length limits.
 * The split (about 40% narrative, the rest of the answer being 8% representative
 * papers, 8% methods, 12% findings, 8% contradictions, 8% gaps, 5% trajectory and
 * the JSON around them) is an assumption from `CLUSTER_REDUCE`'s prompt, since no
 * live run has measured one.
 */
function fullAnalysisAnswer(request: ChatRequest, tokens: number): string {
  const user = userOf(request);
  const themeId = /"themeId": "(T[0-9]+)"/.exec(user)?.[1] ?? "T1";
  const keys = unique(
    Array.from(
      user.matchAll(new RegExp(`"itemKey":"(${KEY})"`, "g")),
      (m) => m[1] as string,
    ),
  );
  const itemKeys = keys.slice(0, 2);
  const analysis = {
    themeId,
    name: "echo",
    narrative: `Work in this theme ${keys
      .slice(0, 3)
      .map((k) => `[[${k}]]`)
      .join(" ")} reported a change in the outcome.`,
    representativePapers: keys.slice(0, 6).map((itemKey) => ({
      itemKey,
      why: filler((tokens * 0.08) / 6),
    })),
    methodologicalPatterns: entries(tokens * 0.08, 60, () => ({
      pattern: filler(60),
      itemKeys,
    })),
    convergentFindings: entries(tokens * 0.12, 100, () => ({
      statement: filler(100),
      itemKeys,
      strength: "moderate",
    })),
    contradictions: entries(tokens * 0.08, 100, () => ({
      statement: filler(40),
      sideA: { claim: filler(30), itemKeys },
      sideB: { claim: filler(30), itemKeys },
      possibleExplanation: null,
    })),
    gaps: entries(tokens * 0.08, 100, () => ({
      gap: filler(50),
      basis: filler(50),
      itemKeys,
    })),
    trajectory: filler(tokens * 0.05),
  };
  // The narrative takes what is left, so the answer is the size asked for.
  const left = tokens - estTokens(JSON.stringify(analysis));
  return JSON.stringify({
    ...analysis,
    narrative: `${analysis.narrative} ${filler(Math.max(0, left - 2))}`,
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

/** `{{TARGET_WORDS}}` as the request's user text carries it, in either language. */
function targetWordsOf(request: ChatRequest): number | undefined {
  const match =
    /Target length: ([0-9]+) words/.exec(userOf(request)) ??
    /목표 분량: ([0-9]+)단어/.exec(userOf(request));
  return match === null ? undefined : Number(match[1]);
}

function reportAnswer(request: ChatRequest, writeTargetLength = false): string {
  const korean = userOf(request).includes(`## ${KO_HEADINGS[0] as string}`);
  // docs/12 §10's visible tokens for the target, without the reasoning allowance.
  const visible = (targetWordsOf(request) ?? 0) * (korean ? 2.48 : 2.2) + 500;
  const length = writeTargetLength ? ` ${filler(visible)}` : "";
  const keys = unique(
    Array.from(
      userOf(request).matchAll(new RegExp(`\\[\\[(${KEY})\\]\\]`, "g")),
      (m) => m[1] as string,
    ),
  );
  return (korean ? KO_HEADINGS : HEADINGS)
    .map((heading, index) => {
      const n = index + 1;
      const body =
        n === 11
          ? keys.map((k, i) => `${String(i + 1)}. [[${k}]]`).join("\n")
          : `Finding ${String(n)} reported a 12% change [[${keys[(n - 1) % keys.length] as string}]].${n === 4 ? length : ""}`;
      return `## ${heading}\n\n${body}\n`;
    })
    .join("\n");
}

function answerTo(
  request: ChatRequest,
  profile: WindowProfile,
  firstCritique = false,
): string {
  switch (kindOf(request)) {
    case "THEME_CLUSTER":
      return clusteringAnswer(request);
    case "THEME_MERGE":
      return mergeAnswer(request);
    case "CLUSTER_REDUCE":
    case "CLUSTER_REDUCE_MERGE":
      return profile.analysisTokens === undefined
        ? analysisAnswer(request)
        : fullAnalysisAnswer(request, profile.analysisTokens);
    case "SELF_CRITIQUE":
      return JSON.stringify(
        profile.rewriteOnce === true && firstCritique
          ? {
              verdict: "revise",
              problems: [
                {
                  type: "unsupported",
                  severity: "high",
                  quote: "Finding 1 reported a 12% change.",
                  explanation: "Synthetic.",
                },
              ],
            }
          : { verdict: "pass", problems: [] },
      );
    case "TREND_REPORT":
      return reportAnswer(request, profile.writeTargetLength);
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
  /** `{{TARGET_WORDS}}` as sent, on a report request. */
  readonly targetWords: number | undefined;
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
      targetWords: kind === "TREND_REPORT" ? targetWordsOf(request) : undefined,
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
    const text = answerTo(
      request,
      profile,
      kind === "SELF_CRITIQUE" && countOf(log, "SELF_CRITIQUE") === 0,
    );
    const answerTokens = estTokens(text);
    // As the provider clamps it (docs/03 §14.3).
    const ceiling = Math.min(
      request.maxOutputTokens ?? profile.maxOutputTokens,
      profile.maxOutputTokens,
    );
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
  let reportNumber = 0;
  const info = (id: string) =>
    mockModel(id, {
      contextWindowTokens:
        id === "summary-model"
          ? (profile.critiqueContextWindowTokens ?? profile.contextWindowTokens)
          : profile.contextWindowTokens,
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
    newReportId: () => `report-${String((reportNumber += 1))}`,
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
  const input: TrendReportInput = {
    ...COLLECTION,
    language: profile.language ?? "en",
  };

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

  // FINDING P4-T22-1 (2026-11-01), fixed 2026-11-02 (owner, plan/00 §6 item
  // 327(a)): the pipeline did not read the report model's context window, so
  // on this 32 000-token model ten `CLUSTER_REDUCE` sub-batches of 38 000–40 500
  // tokens were refused and the 53 000-token `TREND_REPORT_EN` request failed
  // the run. `synthesisBudgets` now gives every stage its window budget.
  it(
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
  it(
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
  // `THEME_CLUSTER` request went to a 32 000-token model.
  it(
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

// ---------------------------------------------------------------------------
// 5. The window budgets at scale (owner, plan/00 §6 item 327(a))
// ---------------------------------------------------------------------------

/** The themes the report's §4 names as not analysed (`unanalysedLines`). */
function themesGivenUp(run: ScaleRun): number {
  const report = run.output.report;
  const label = reportLabel(report?.language ?? "en", "themeNotAnalysed");
  const tail = label.split("{papers}")[1] ?? "";
  const marker = tail.split("{reason}")[0] ?? "";
  return (report?.markdown ?? "").split(marker).length - 1;
}

/** Both 32 000-token shapes, and the ones each side of them. */
const SMALL_WINDOWS: readonly WindowProfile[] = [
  WINDOW_32K,
  {
    name: "32k-output-at-window",
    contextWindowTokens: 32_000,
    maxOutputTokens: 32_000,
  },
  { name: "48k", contextWindowTokens: 48_000, maxOutputTokens: 8_192 },
  { name: "24k", contextWindowTokens: 24_000, maxOutputTokens: 8_192 },
];

/** What the provider sends: `max_tokens` clamped to the limit (docs/03 §14.3). */
function clampedOutput(call: CallRecord, profile: WindowProfile): number {
  return Math.min(call.maxOutputTokens ?? 0, profile.maxOutputTokens);
}

describe("P4-T22 — the estimate and the requests on small windows (plan/00 §6 item 327(a))", () => {
  for (const profile of SMALL_WINDOWS) {
    it(
      `${profile.name}: the estimate reserves at least what the run made, at inputs no smaller, and every request with its clamped output fits the window`,
      async () => {
        const run = await scaleRun(profile);
        expect(run.output.outcome).toBe("succeeded");
        expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
        // No theme was given up to make it fit.
        expect(themesGivenUp(run)).toBe(0);

        const planned =
          run.confirms[0]?.estimate.selected.synthesis.calls ?? [];
        const reserved = reservedByKind(run);
        // A clustering re-run is not reserved (`planSynthesis`' header).
        const distinct = new Set(
          run.log
            .filter((c) => c.kind === "THEME_CLUSTER")
            .map((c) => c.clusterKeys),
        );
        expect(distinct.size).toBeLessThanOrEqual(reserved.THEME_CLUSTER ?? 0);
        for (const kind of [
          "THEME_MERGE",
          "CLUSTER_REDUCE",
          "CLUSTER_REDUCE_MERGE",
          "TREND_REPORT",
        ] as const) {
          expect(countOf(run.log, kind), kind).toBeLessThanOrEqual(
            reserved[kind] ?? 0,
          );
        }
        const largestPlanned = (kind: CallKind): number =>
          Math.max(
            0,
            ...planned
              .filter((c) =>
                kind === "TREND_REPORT"
                  ? c.kind.startsWith("TREND_REPORT")
                  : c.kind === kind,
              )
              .map((c) => c.inputTokens),
          );
        for (const call of run.log) {
          expect(call.inputTokens, call.kind).toBeLessThanOrEqual(
            largestPlanned(call.kind),
          );
          expect(
            call.inputTokens + clampedOutput(call, profile),
            call.kind,
          ).toBeLessThanOrEqual(profile.contextWindowTokens);
        }
      },
      SCALE_TIMEOUT_MS,
    );
  }

  it(
    "the critique follows the critique model's own window, not the report model's",
    async () => {
      const whole = await scaleRun(WINDOW_128K);
      const run = await scaleRun({
        ...WINDOW_128K,
        name: "128k-critique-16k",
        critiqueContextWindowTokens: 16_000,
      });
      expect(run.output.outcome).toBe("succeeded");
      expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
      const critiques = run.log.filter((c) => c.kind === "SELF_CRITIQUE");
      // One call does not fit 16 000 any more, so it goes per section.
      expect(countOf(whole.log, "SELF_CRITIQUE")).toBe(1);
      expect(critiques.length).toBeGreaterThan(1);
      for (const call of critiques) {
        expect(
          call.inputTokens + (call.maxOutputTokens ?? 0),
        ).toBeLessThanOrEqual(16_000);
      }
      // The report model's window still shapes the other stages: as at 128 000.
      expect(countOf(run.log, "THEME_MERGE")).toBe(0);
      // And the estimate prices the critique on the same window.
      const planned = run.confirms[0]?.estimate.selected.synthesis.calls ?? [];
      const critique = planned.find((c) => c.kind === "SELF_CRITIQUE");
      expect(critique?.rawInputTokens).toBeLessThanOrEqual(16_000);
    },
    SCALE_TIMEOUT_MS,
  );

  it("over the same 400 summaries, the plan makes at least the batches, sub-batches and merges the packers make, window by window", () => {
    const papers = syntheticPapers({ count: PAPERS, seed: SEED });
    const overhead = measureSynthesisOverhead(PROMPTS, (text) =>
      estTokens(text),
    );
    const byTheme = new Map<
      string,
      (typeof papers)[number]["summary"]["content"][]
    >();
    for (const paper of papers) {
      const theme = paper.topic?.theme ?? "none";
      byTheme.set(theme, [
        ...(byTheme.get(theme) ?? []),
        paper.summary.content,
      ]);
    }
    const digests = papers.map((paper) =>
      toDigest({ summary: paper.summary, year: paper.year }),
    );
    let compared = 0;
    for (const window of [
      12_000, 16_000, 20_000, 24_000, 32_000, 48_000, 64_000, 96_000, 128_000,
    ]) {
      for (const limit of [8_192, window]) {
        const report = {
          modelId: "m",
          prices: PRICES,
          maxOutputTokens: limit,
          limits: { contextWindowTokens: window, maxOutputTokens: limit },
        };
        const budgets = synthesisBudgets({
          papers: PAPERS,
          outputLimit: limit,
          reportLimits: report.limits,
          critiqueLimits: report.limits,
          prompts: PROMPTS,
          synthesisOverhead: overhead,
        });
        const plan = planSynthesis({
          papers: PAPERS,
          reportModel: report,
          critiqueModel: report,
          prompts: PROMPTS,
          synthesisOverhead: overhead,
          languages: ["en"],
          critiqueRounds: 1,
          themeCount: byTheme.size,
        });
        const planned = (kind: SynthesisCallKind): number =>
          plan.calls.filter((c) => c.kind === kind).length;
        const where = `${String(window)} / ${String(limit)}`;

        const batches = partitionDigests(
          digests,
          clusterBatchSize(PROMPTS.get("THEME_CLUSTER"), limit),
          budgets.clusterBatch,
        );
        expect(batches.length, where).toBeLessThanOrEqual(
          planned("THEME_CLUSTER"),
        );

        const mergeLimit = maxPartialsPerMerge(
          PROMPTS.get("CLUSTER_REDUCE"),
          budgets.reduceMerge,
        );
        let reduces = 0;
        let merges = 0;
        for (const members of byTheme.values()) {
          const count = packThemeSummaries(members, budgets.reduce).length;
          if (count > 1 && count > mergeLimit) continue; // theme_too_large
          reduces += count;
          if (count > 1) merges += 1;
        }
        expect(reduces, where).toBeLessThanOrEqual(planned("CLUSTER_REDUCE"));
        expect(merges, where).toBeLessThanOrEqual(
          planned("CLUSTER_REDUCE_MERGE"),
        );
        compared += 1;
      }
    }
    expect(compared).toBe(18);
  });
});

describe("P4-T22 — a window too small ends the run cleanly (no RangeError, no refused request)", () => {
  it(
    "12 000 / 8 192: every theme too large, the run stops with the no-theme message and no report",
    async () => {
      const run = await scaleRun({
        name: "12k",
        contextWindowTokens: 12_000,
        maxOutputTokens: 8_192,
      });
      expect(run.output.outcome).toBe("stopped");
      expect(run.output.stop?.messageId).toBe(
        "research-helper-report-stopped-no-theme-analysed",
      );
      expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
      expect(run.reportRows).toBe(0);
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "7 500 / 7 500: the local themes are over THEME_MERGE's window budget, so the run stops with the merge's message, before the merge request",
    async () => {
      const run = await scaleRun({
        name: "7.5k",
        contextWindowTokens: 7_500,
        maxOutputTokens: 7_500,
      });
      expect(run.output.outcome).toBe("stopped");
      expect(run.output.stop?.messageId).toBe(
        "research-helper-report-stopped-merge-too-large",
      );
      expect(countOf(run.log, "THEME_MERGE")).toBe(0);
      expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "4 000 / 4 000: no room for one digest beside a batch's output, so the run fails before any request",
    async () => {
      const run = await scaleRun({
        name: "4k",
        contextWindowTokens: 4_000,
        maxOutputTokens: 4_000,
      });
      expect(run.output.outcome).toBe("failed");
      expect(run.output.error?.code).toBe("CONFIGURATION");
      expect(run.log).toEqual([]);
      expect(run.reportRows).toBe(0);
    },
    SCALE_TIMEOUT_MS,
  );

  // FINDING P4-T22-2's fix (owner's option 1, 2026-11-02): the two tests that
  // pinned the old failure are replaced by the describe below.
});

// ---------------------------------------------------------------------------
// 7. Making room at composition (docs/06 §8.4's note of 2026-11-02)
// ---------------------------------------------------------------------------

/** What a run's report calls asked for, and what the estimate priced for them. */
function reportCalls(run: ScaleRun): readonly CallRecord[] {
  return run.log.filter((c) => c.kind === "TREND_REPORT");
}

/** Everything that must hold of a run that made room and succeeded. */
function expectFitted(run: ScaleRun, reports: number): void {
  const profile = run.profile;
  expect(run.output.outcome).toBe("succeeded");
  expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
  expect(themesGivenUp(run)).toBe(0);
  expect(run.reportRows).toBe(reports);
  // The critique still fits, and ran for each report.
  expect(countOf(run.log, "SELF_CRITIQUE")).toBeGreaterThanOrEqual(reports);
  const planned = run.confirms[0]?.estimate.selected.synthesis.calls ?? [];
  const reserved = reservedByKind(run);
  for (const kind of [
    "THEME_MERGE",
    "CLUSTER_REDUCE",
    "CLUSTER_REDUCE_MERGE",
    "TREND_REPORT",
  ] as const) {
    expect(countOf(run.log, kind), kind).toBeLessThanOrEqual(
      reserved[kind] ?? 0,
    );
  }
  const largest = (kind: CallKind, field: "inputTokens" | "outputTokens") =>
    Math.max(
      0,
      ...planned
        .filter((c) =>
          kind === "TREND_REPORT"
            ? c.kind.startsWith("TREND_REPORT")
            : c.kind === kind,
        )
        .map((c) => c[field]),
    );
  for (const call of run.log) {
    expect(
      call.inputTokens + clampedOutput(call, profile),
      call.kind,
    ).toBeLessThanOrEqual(profile.contextWindowTokens);
    expect(call.inputTokens, call.kind).toBeLessThanOrEqual(
      largest(call.kind, "inputTokens"),
    );
    if (call.kind === "TREND_REPORT") {
      expect(call.maxOutputTokens ?? 0).toBeLessThanOrEqual(
        largest(call.kind, "outputTokens"),
      );
    }
  }
}

/** The stored reports of a run, in run order. */
function deliveredOf(run: ScaleRun): readonly TrendReport[] {
  return (run.output.reports ?? []).map((one) => one.report);
}

describe("P4-T22 — analyses up to CLUSTER_REDUCE's ceiling over 11 themes (FINDING P4-T22-2's fix)", () => {
  it("rp's stage inputs change with a lowered max_tokens and dropped fields, and an unchanged plan's stay as they were", () => {
    const variables = {
      TARGET_WORDS: "1390",
      THEME_ANALYSES_JSON: "[]",
      DIGESTS: "",
    };
    const plain = stageInputsOf(
      { variables, maxOutputTokens: 23_000 },
      { citationReplacement: "x" },
    );
    expect(plain).toEqual({ TARGET_WORDS: "1390", CITATION_REPLACEMENT: "x" });
    const fit = {
      outputTokens: 9_000,
      outputLowered: true,
      targetWords: 1_390,
      targetWordsLowered: false,
      droppedFields: [],
      modelNote: "",
    };
    expect(
      stageInputsOf(
        { variables, maxOutputTokens: 9_000, fit },
        { citationReplacement: "x" },
      ),
    ).toEqual({ ...plain, MAX_OUTPUT_TOKENS: "9000" });
    expect(
      stageInputsOf(
        {
          variables,
          maxOutputTokens: 23_000,
          fit: {
            ...fit,
            outputLowered: false,
            droppedFields: ["representativePapers[].why", "gaps"],
          },
        },
        { citationReplacement: "x" },
      ),
    ).toEqual({
      ...plain,
      ANALYSES_DROPPED: "representativePapers[].why,gaps",
    });
  });

  it(
    "the stated minimum at the ceiling: 38 500 succeeds and 38 000 stops, in both, at either output limit",
    async () => {
      for (const [window, limit, outcome] of [
        [38_500, 8_192, "succeeded"],
        [38_000, 38_000, "failed"],
      ] as const) {
        const run = await scaleRun({
          name: `minimum-${String(window)}`,
          contextWindowTokens: window,
          maxOutputTokens: limit,
          analysisTokens: LARGEST_ANALYSIS_TOKENS,
          language: "both",
        });
        expect(run.output.outcome).toBe(outcome);
        expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
      }
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "the mock's largest analysis is at CLUSTER_REDUCE's 3 000 ceiling, and every theme is analysed at it",
    async () => {
      const run = await scaleRun({
        name: "48k-2900",
        contextWindowTokens: 48_000,
        maxOutputTokens: 8_192,
        analysisTokens: LARGEST_ANALYSIS_TOKENS,
        writeTargetLength: true,
        language: "both",
      });
      expectFitted(run, 2);
      const largest = Math.max(
        ...run.log
          .filter((c) => c.kind === "CLUSTER_REDUCE")
          .map((c) => c.answerTokens ?? 0),
      );
      expect(largest).toBeGreaterThan(2_900);
      expect(largest).toBeLessThanOrEqual(3_000);
      expect(run.output.outcome).toBe("succeeded");
      // Both languages planned on the same window, each with its own template.
      const delivered = deliveredOf(run);
      expect(delivered.map((r) => r.language)).toEqual(["en", "ko"]);
      for (const report of delivered) {
        expect(report.warnings).toContain(ANALYSES_SHORTENED_WARNING);
        expect(report.markdown).toContain(
          report.language === "ko"
            ? "세부 내용 없이 보냈습니다"
            : "sent without the details",
        );
      }
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "32 000 / 8 192, 1 500 tokens each, Korean: the word target comes down to the limit, fields are dropped, and the report says so",
    async () => {
      const run = await scaleRun({
        ...WINDOW_32K,
        analysisTokens: 1_500,
        writeTargetLength: true,
        language: "ko",
      });
      expectFitted(run, 1);
      const [call] = reportCalls(run);
      // As sent before this fix: the provider clamps it.
      expect(call?.maxOutputTokens).toBe(26_000);
      expect(call?.targetWords).toBe(1_234);
      const report = run.output.report;
      expect(report?.warnings).toContain(OUTPUT_LOWERED_WARNING);
      expect(report?.warnings).toContain(ANALYSES_SHORTENED_WARNING);
      expect(report?.markdown).toContain("출력 토큰을 8192개");
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "32 000 / 32 000, 1 500 tokens each, both: the case that failed at any analysis size writes both reports, with one critique rewrite that re-plans and still fits",
    async () => {
      const run = await scaleRun({
        name: "32k-32k-both",
        contextWindowTokens: 32_000,
        maxOutputTokens: 32_000,
        analysisTokens: 1_500,
        writeTargetLength: true,
        language: "both",
        rewriteOnce: true,
      });
      expectFitted(run, 2);
      const calls = reportCalls(run);
      expect(calls).toHaveLength(3);
      for (const call of calls) {
        expect(call.maxOutputTokens).toBeGreaterThanOrEqual(
          REPORT_OUTPUT_FLOOR,
        );
        expect(call.maxOutputTokens).toBeLessThan(23_000);
        expect(call.inputTokens).toBeLessThanOrEqual(20_006);
      }
      // The rewrite stayed applied: the earlier draft was not kept for want of room.
      expect(run.output.report?.markdown).not.toContain(
        EN_REPORT_LABELS.bannerRevisionNotApplied,
      );
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "64 000 / 64 000, at the ceiling, Korean: max_tokens comes down and nothing is dropped",
    async () => {
      const run = await scaleRun({
        name: "64k-64k",
        contextWindowTokens: 64_000,
        maxOutputTokens: 64_000,
        analysisTokens: LARGEST_ANALYSIS_TOKENS,
        writeTargetLength: true,
        language: "ko",
      });
      expectFitted(run, 1);
      const [call] = reportCalls(run);
      expect(call?.maxOutputTokens).toBeLessThan(26_000);
      expect(call?.maxOutputTokens).toBeGreaterThan(REPORT_OUTPUT_FLOOR);
      expect(run.output.report?.warnings).toContain(OUTPUT_LOWERED_WARNING);
      expect(run.output.report?.warnings).not.toContain(
        ANALYSES_SHORTENED_WARNING,
      );
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "32 000 / 8 192 at the ceiling, both: under the stated minimum, so CONTEXT_LENGTH before any report request, and no report",
    async () => {
      const run = await scaleRun({
        ...WINDOW_32K,
        analysisTokens: LARGEST_ANALYSIS_TOKENS,
        language: "both",
      });
      expect(run.output.outcome).toBe("failed");
      expect(run.output.error?.code).toBe("CONTEXT_LENGTH");
      expect(countOf(run.log, "CLUSTER_REDUCE")).toBeGreaterThan(0);
      expect(countOf(run.log, "TREND_REPORT")).toBe(0);
      expect(run.log.filter((c) => c.refused !== undefined)).toEqual([]);
      expect(run.reportRows).toBe(0);
    },
    SCALE_TIMEOUT_MS,
  );

  it(
    "128 000 / 32 768 at the ceiling: nothing changes, no warning",
    async () => {
      const run = await scaleRun({
        ...WINDOW_128K,
        analysisTokens: LARGEST_ANALYSIS_TOKENS,
        writeTargetLength: true,
      });
      expectFitted(run, 1);
      const [call] = reportCalls(run);
      expect(call?.maxOutputTokens).toBe(23_000);
      expect(call?.targetWords).toBe(4_250);
      expect(run.output.report?.warnings).not.toContain(OUTPUT_LOWERED_WARNING);
      expect(run.output.report?.warnings).not.toContain(
        ANALYSES_SHORTENED_WARNING,
      );
    },
    SCALE_TIMEOUT_MS,
  );
});

/**
 * The whole grid, on demand (`P4T22_FIT_MATRIX`, a file path; `P4T22_FIT_PAIRS`,
 * `P4T22_FIT_SIZES` and `P4T22_FIT_LANGS` narrow it): too many runs for the card's
 * 60 seconds, so the describe above keeps a few and this writes one JSON line per
 * run for the card's report. The composition-level grid runs always, in
 * `trendCompose.test.ts`.
 */
const FIT_MATRIX_FILE = process.env["P4T22_FIT_MATRIX"];
describe.runIf(FIT_MATRIX_FILE !== undefined && FIT_MATRIX_FILE !== "")(
  "P4-T22 — the whole grid, on demand",
  () => {
    const pairs: readonly (readonly [number, number])[] = (
      process.env["P4T22_FIT_PAIRS"] ??
      "32000/8192,32000/32000,48000/8192,48000/48000,64000/8192,64000/64000,128000/32768"
    )
      .split(",")
      .map(
        (pair) =>
          pair.split("/").map(Number) as unknown as readonly [number, number],
      );
    const sizes = (process.env["P4T22_FIT_SIZES"] ?? "1000,1500,2000,2500,2950")
      .split(",")
      .map(Number);
    for (const [contextWindowTokens, maxOutputTokens] of pairs) {
      for (const analysisTokens of sizes) {
        for (const language of (
          process.env["P4T22_FIT_LANGS"] ?? "en,ko,both"
        ).split(",") as ("en" | "ko" | "both")[]) {
          const name = `${String(contextWindowTokens)}/${String(maxOutputTokens)} ${String(analysisTokens)} ${language}`;
          it(
            name,
            async () => {
              const run = await scaleRun({
                name,
                contextWindowTokens,
                maxOutputTokens,
                analysisTokens,
                writeTargetLength: true,
                language,
              });
              const reports = language === "both" ? 2 : 1;
              const calls = reportCalls(run);
              const first = calls[0];
              const planned =
                run.confirms[0]?.estimate.selected.synthesis.calls ?? [];
              const pricedInput = Math.max(
                ...planned
                  .filter((c) => c.kind.startsWith("TREND_REPORT"))
                  .map((c) => c.inputTokens),
              );
              appendFileSync(
                FIT_MATRIX_FILE as string,
                `${JSON.stringify({
                  name,
                  outcome: run.output.outcome,
                  code: run.output.error?.code ?? run.output.stop?.messageId,
                  givenUp:
                    run.output.outcome === "succeeded"
                      ? themesGivenUp(run)
                      : undefined,
                  largestAnalysis: Math.max(
                    0,
                    ...run.log
                      .filter((c) => c.kind === "CLUSTER_REDUCE")
                      .map((c) => c.answerTokens ?? 0),
                  ),
                  refused: run.log.filter((c) => c.refused !== undefined)
                    .length,
                  reportInput: first?.inputTokens,
                  maxTokens: first?.maxOutputTokens,
                  targetWords: first?.targetWords,
                  pricedInput,
                  dropped: /details behind sections ([0-9, ]+)/.exec(
                    run.output.report?.markdown ?? "",
                  )?.[1],
                  warnings: (run.output.reports ?? []).map((one) =>
                    one.report.warnings.filter((w) =>
                      /output_lowered|analyses_shortened|digests_trimmed/.test(
                        w,
                      ),
                    ),
                  ),
                  wallMs: Math.round(run.wallMs),
                })}\n`,
              );
              if (run.output.outcome === "succeeded") {
                expectFitted(run, reports);
              } else {
                expect(run.output.error?.code).toBe("CONTEXT_LENGTH");
                expect(countOf(run.log, "TREND_REPORT")).toBe(0);
                expect(run.log.filter((c) => c.refused !== undefined)).toEqual(
                  [],
                );
                expect(run.reportRows).toBe(0);
              }
            },
            SCALE_TIMEOUT_MS * 2,
          );
        }
      }
    }
  },
);

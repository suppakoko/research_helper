/**
 * `P3-T29` — the summarize-collection pipeline: skip what is summarized,
 * screen, estimate, confirm, the key check, `Summarizing` under the `llm`
 * pool, notes for summarized items only, the five counts, cancel and
 * re-run, the outage stop, the wall-clock question, the read-only library,
 * and the confirmation's money rules.
 *
 * No network and no model: every answer comes from `test/helpers/mockLLM.ts`
 * through the real router and `withBudget`; the cache, the `summary` table and
 * the `job` table are the real ones over `node:sqlite` in memory. Every paper
 * is synthetic text written here; no key, no label and no fixture is read.
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
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import { UpstreamServerError } from "../../../src/core/errors";
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
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import type { ChatRequest } from "../../../src/llm/types";
import {
  PAPER_SUMMARY_SCHEMA_VERSION,
  type AcquiredSource,
  type PaperSummary,
  type SourceTier,
  type StoredSummary,
} from "../../../src/model/summary";
import {
  createBudgetGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import type { EgressDisclosure } from "../../../src/pipeline/shared/egressDisclosure";
import type { RunEstimate } from "../../../src/pipeline/shared/estimate";
import {
  createPrivacyPolicy,
  loadStrictestPrivacyPolicy,
  type PrivacyMode,
  type RoutineConfirmation,
} from "../../../src/pipeline/shared/privacyPolicy";
import {
  bypassesStoredResult,
  createJobNoticeRouter,
  createSummarizePipeline,
  isOutage,
  measureOverhead,
  summarizeExclusivityKey,
  SUMMARIZE_STAGES,
  type SummarizeInput,
  type SummarizeLibrary,
  type SummarizeLibraryItem,
  type SummarizeOutput,
  type SummarizeQuestion,
  type SummarizeSurface,
} from "../../../src/pipeline/summarize/summarizePipeline";
import {
  stageSlices,
  type ConfigReader,
  type PipelineContext,
} from "../../../src/pipeline/types";
import {
  createPromptRegistry,
  type PromptRegistry,
} from "../../../src/prompts";
import {
  buildSummarizeWindowModel,
  confirmSummarizeRun,
  runItemSummary,
  type ItemSummaryDeps,
  type SummarizeConfirmDeps,
} from "../../../src/ui/dialogs/summarizeDialog";
import type { CostDialogInput } from "../../../src/ui/dialogs/costConfirmDialog";
import { notStoredReason } from "../../../src/ui/panes/summarySection";
import {
  createJobStore,
  createSummaryStore,
  type CollectionSettingsStore,
  type SqlConnection,
  type SqlParam,
  type SummaryStore,
} from "../../../src/zotero/db";
import {
  AI_SUMMARY_TAG,
  isGeneratedTag,
  modelTag,
  renderSummaryNoteHtml,
  saveSummaryNoteOnce,
  summarySourceLine,
} from "../../../src/zotero/notes";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
  type MockCall,
  type MockStep,
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

const MODEL = "mock-small-2026-01-01";
const QUOTE = "The intervention reduced the primary outcome by 42 percent.";

// ---------------------------------------------------------------------------
// The synthetic collection
// ---------------------------------------------------------------------------

type Kind = "abstract" | "fulltext" | "notext" | "retracted" | "duplicate";

function pad(i: number): string {
  return String(i).padStart(4, "0");
}

function abstractOf(i: number): string {
  return (
    `Background: synthetic study ${pad(i)} of a made-up intervention. ` +
    `${QUOTE} Conclusion: the effect held in 1,204 patients.`
  );
}

function bodyOf(i: number): string {
  const lines: string[] = [];
  for (let p = 0; p < 10; p += 1) {
    lines.push(
      `Paragraph ${String(p)} of study ${pad(i)} describes the intervention ` +
        "arm: participants were enrolled at several clinical sites, followed " +
        "for two years, and assessed with the same validated instruments at " +
        "every visit so that the outcomes could be compared across the sites.",
    );
  }
  return lines.join("\n");
}

function sourceOf(i: number, kind: Kind): AcquiredSource {
  const key = `K${pad(i)}`;
  const tier: SourceTier =
    kind === "notext"
      ? "metadata_only"
      : kind === "fulltext"
        ? "fulltext_pdf"
        : "abstract";
  const abstract = kind === "notext" ? null : abstractOf(i);
  const text =
    kind === "notext"
      ? ""
      : kind === "fulltext"
        ? `${abstractOf(i)}\n\n${QUOTE}\n${bodyOf(i)}`
        : abstractOf(i);
  return {
    itemKey: key,
    libraryID: 1,
    tier,
    abstract,
    sections: [],
    sectionAware: false,
    text,
    charCount: text.length,
    estTokens: Math.ceil(text.length / 4),
    truncated: false,
    attachmentKey: kind === "fulltext" ? `A${pad(i)}` : null,
    contentHash: sha256Hex(text),
    warnings: [],
  };
}

function itemOf(i: number, kind: Kind): SummarizeLibraryItem {
  const key = `K${pad(i)}`;
  // Two items share one DOI, so the collection-scoped dedupe drops one.
  const doi =
    kind === "duplicate" || i === 2 ? "10.1234/shared" : `10.1234/k${pad(i)}`;
  return {
    itemID: 1000 + i,
    itemKey: key,
    libraryID: 1,
    workKey: `doi:10.1234/k${pad(i)}`,
    metadata: {
      title: `Study ${key} alpha`,
      authors: [`Author${pad(i)}, Ann`],
      year: 2025,
      venue: "Journal of Synthetic Fixtures",
      itemType: "journalArticle",
      doi,
      tags: [],
    },
    dateModified: "2026-10-01 00:00:00",
    screen: {
      key,
      itemID: 1000 + i,
      itemType: "journalArticle",
      title: `Study ${key} alpha`,
      year: 2025,
      firstAuthorFamily: `Author${pad(i)}`,
      containerTitle: "Journal of Synthetic Fixtures",
      doi,
      abstractLength: kind === "notext" ? 0 : abstractOf(i).length,
      hasFullText: kind === "fulltext",
      dateAdded: `2026-01-01 00:00:${String(i % 60).padStart(2, "0")}`,
      retraction: { zotero: { retracted: kind === "retracted", reasons: [] } },
    },
  };
}

/** 200 items: 20 with no text, 2 retracted, 1 duplicate, 20 full text, 157 abstracts. */
function mixedKinds(n: number): Kind[] {
  return Array.from({ length: n }, (_, i): Kind => {
    if (i % 10 === 0) return "notext";
    if (i === 1 || i === 11) return "retracted";
    if (i === 3) return "duplicate";
    if (i % 10 === 5) return "fulltext";
    return "abstract";
  });
}

interface FakeLibrary extends SummarizeLibrary {
  readonly notes: { itemKey: string; stored: StoredSummary }[];
  editable: boolean;
}

function fakeLibrary(kinds: readonly Kind[]): FakeLibrary {
  const items = kinds.map((kind, i) => itemOf(i, kind));
  const notes: { itemKey: string; stored: StoredSummary }[] = [];
  const noteKeys = new Map<string, string>();
  const library: FakeLibrary = {
    notes,
    editable: true,
    loadCollection: () =>
      Promise.resolve({ name: "Synthetic", editable: library.editable, items }),
    loadItems: (_libraryID, itemKeys) =>
      Promise.resolve({
        name: "",
        editable: library.editable,
        items: items.filter((item) => itemKeys.includes(item.itemKey)),
      }),
    acquire: (item, options) => {
      const i = Number(item.itemKey.slice(1));
      const kind = kinds[i] as Kind;
      const source = sourceOf(
        i,
        !options.includeFullText && kind === "fulltext" ? "abstract" : kind,
      );
      return Promise.resolve({
        source,
        sourceName: kind === "fulltext" ? `Paper ${pad(i)}.pdf` : undefined,
      });
    },
    findSummaryNote: (item, stored) =>
      Promise.resolve(
        stored !== undefined && noteKeys.get(item.itemKey) === stored
          ? stored
          : noteKeys.get(item.itemKey),
      ),
    writeSummaryNote: (item, stored) => {
      notes.push({ itemKey: item.itemKey, stored });
      const key = `N${String(notes.length).padStart(7, "0")}`;
      noteKeys.set(item.itemKey, key);
      return Promise.resolve(key);
    },
  };
  return library;
}

// ---------------------------------------------------------------------------
// The scripted model
// ---------------------------------------------------------------------------

function userOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "user")?.content ?? "";
}

function summaryJson(tier: SourceTier): string {
  const summary: PaperSummary = {
    schemaVersion: PAPER_SUMMARY_SCHEMA_VERSION,
    itemKey: "WRONGKEY",
    sourceTier: tier,
    confidence: "high",
    researchQuestion: "Does the intervention reduce the primary outcome?",
    studyDesign: { label: "randomized_controlled_trial", detail: null },
    population: {
      kind: "human",
      description: "Synthetic patients",
      size: "1,204",
    },
    methods: ["randomization"],
    keyFindings: [
      {
        statement: "The intervention reduced the outcome.",
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport: QUOTE,
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

function answering(
  override?: (
    call: MockCall,
  ) => ReturnType<typeof chatResponse> | Error | undefined,
): MockStep {
  return (call) => {
    const own = override?.(call);
    if (own !== undefined) return own;
    const tier = /Set "sourceTier" to "([a-z_]+)"/.exec(
      userOf(call.request),
    )?.[1];
    return chatResponse(summaryJson((tier ?? "abstract") as SourceTier));
  };
}

// ---------------------------------------------------------------------------
// The harness: real SQLite, real queue, real cache, real router
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

const SILENT_PROGRESS: ProgressReporter = {
  setMessage: () => undefined,
  setProgress: () => undefined,
  increment: () => undefined,
  child: () => SILENT_PROGRESS,
  warn: () => undefined,
  done: () => undefined,
};

interface Harness {
  readonly connection: ReturnType<typeof sqlite>;
  readonly store: SummaryStore;
  readonly jobs: JobQueue;
  readonly clock: ManualClock;
  readonly provider: ReturnType<typeof mockLLM>;
  readonly library: FakeLibrary;
  readonly pipeline: ReturnType<typeof createSummarizePipeline>;
  readonly asks: SummarizeQuestion[];
  /** A job context: `prepare-only` checkpoints nothing, as `openJob` gives. */
  readonly context: (
    jobId: string,
    source: CancellationTokenSource,
  ) => PipelineContext;
  /** Run once: prepare without a record, then execute with one. */
  run(
    input?: Partial<SummarizeInput>,
    surface?: Partial<SummarizeSurface>,
    source?: CancellationTokenSource,
  ): Promise<SummarizeOutput>;
}

async function harness(
  kinds: readonly Kind[],
  options: {
    script?: readonly MockStep[];
    hasKey?: () => boolean;
    wallClockBudgetMs?: number;
    answer?: (q: SummarizeQuestion) => "resume" | "cancel";
  } = {},
): Promise<Harness> {
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
  const router = createJobNoticeRouter();
  const jobs = createJobQueue({
    clock,
    logger,
    pluginVersion: "0.0.0-test",
    isResumable: () => false,
    notifier: router.notifier,
  });
  jobs.attachStore(createJobStore(connection));
  const provider = mockLLM(options.script ?? [answering()]);
  const llm = withBudget(
    mockLLMRouter(
      [provider],
      mockSettings({ summaryModel: MODEL, keyPresent: { openrouter: true } }),
    ),
    { pricesFor: () => undefined, now: () => clock.now() },
  );
  const library = fakeLibrary(kinds);
  const session = createSessionSpendCounter();
  const asks: SummarizeQuestion[] = [];
  const pipeline = createSummarizePipeline({
    library,
    store: () => Promise.resolve(store),
    prompts: () => Promise.resolve(PROMPTS),
    queue: jobs,
    pool: createLlmPool(() => 1),
    admission: createJobAdmission(),
    runningWork: createRunningWork(),
    pauseNotices: router,
    prices: () => undefined,
    baseUrls: { effectiveHost: () => "openrouter.ai" },
    modelInfo: (_provider, id) =>
      mockModel(id, {
        contextWindowTokens: 128_000,
        dataPolicy: {
          trainsOnInputByDefault: "no",
          retention: { days: "zero", note: "" },
        },
      }),
    credentials: { hasKey: () => Promise.resolve(options.hasKey?.() ?? true) },
    ...(options.wallClockBudgetMs !== undefined && {
      wallClockBudgetMs: options.wallClockBudgetMs,
    }),
  });
  const values: Record<string, unknown> = {
    logRequestBodies: false,
    geminiPaidTier: false,
    cacheEnabled: true,
    cacheIgnoreModel: false,
    summaryFullTextMode: "auto",
    summaryFullTextAutoMaxPapers: 1000,
    screeningRetractionPolicy: "exclude_from_synthesis",
    screeningNonEnglishPolicy: "translate_summary",
    screeningDedupe: true,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigReader;

  const context = (
    jobId: string,
    token: CancellationTokenSource,
  ): PipelineContext => ({
    jobId,
    token: token.token,
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
    // As `openJob` gives: a context with no record checkpoints nothing.
    checkpoint: (state) =>
      jobId === "prepare-only"
        ? Promise.resolve()
        : jobs.writeCheckpoint(jobId, state).then(() => undefined),
    resumeState: undefined,
  });

  return {
    connection,
    store,
    jobs,
    clock,
    provider,
    library,
    pipeline,
    asks,
    context,
    async run(
      input = {},
      overrides = {},
      source = createCancellationTokenSource(),
    ) {
      const full: SummarizeInput = {
        libraryID: 1,
        collectionKey: "COLLKEY1",
        resummarize: false,
        writeNotes: true,
        ...input,
      };
      const surface: SummarizeSurface = {
        update: () => undefined,
        confirm: () =>
          Promise.resolve({ kind: "run", plan: "selected", raise: undefined }),
        ask: (question) => {
          asks.push(question);
          return Promise.resolve(options.answer?.(question) ?? "resume");
        },
        ...overrides,
      };
      const prepared = await pipeline.prepare(
        full,
        context("prepare-only", source),
        surface,
      );
      const record = await jobs.enqueue("summarize", full, {
        priority: "normal",
        exclusivityKey: summarizeExclusivityKey(full),
        libraryID: 1,
      });
      return pipeline.execute(prepared, context(record.id, source), surface);
    },
  };
}

function summaryRows(h: Harness): number {
  const row = h.connection.db
    .prepare("SELECT COUNT(*) AS n FROM summary")
    .get() as {
    n: number;
  };
  return row.n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("summarizePipeline — declarations", () => {
  it("declares §12.3's stages with weights that divide the bar", () => {
    expect(SUMMARIZE_STAGES.map((s) => s.key)).toEqual([
      "LoadingItems",
      "Planning",
      "CacheProbe",
      "Estimating",
      "AwaitingConfirm",
      "Summarizing",
      "WritingNotes",
    ]);
    expect(stageSlices(SUMMARIZE_STAGES).at(-1)?.to).toBe(1);
  });

  it("stops for an outage only past the sample and above 30 %", () => {
    expect(isOutage(9, 9)).toBe(false);
    expect(isOutage(10, 3)).toBe(false);
    expect(isOutage(10, 4)).toBe(true);
  });

  it("measures each prompt's overhead with the run's longest metadata in it", () => {
    const count = (text: string): number => text.length;
    const short = measureOverhead(PROMPTS, [itemOf(1, "abstract")], count);
    const long = measureOverhead(
      PROMPTS,
      [
        {
          metadata: {
            ...itemOf(1, "abstract").metadata,
            title: "x".repeat(500),
          },
        },
      ],
      count,
    );
    expect(
      long.PAPER_SUMMARY_ABSTRACT - short.PAPER_SUMMARY_ABSTRACT,
    ).toBeGreaterThan(400);
    expect(short.CHUNK_REDUCE).toBeGreaterThan(0);
  });
});

describe("summarizePipeline — a 200-item scripted run", () => {
  it("writes notes only for summarized items and reports the five counts", async () => {
    const h = await harness(mixedKinds(200));
    const output = await h.run();
    expect(output.outcome).toBe("succeeded");
    const c = output.view.counts;
    expect({
      fullText: c.fullText,
      abstractOnly: c.abstractOnly,
      noText: c.noText,
      retracted: c.retracted,
      duplicate: c.duplicate,
    }).toEqual({
      fullText: 20,
      abstractOnly: 157,
      noText: 20,
      retracted: 2,
      duplicate: 1,
    });
    expect(c.failed).toBe(0);
    // Notes: exactly the 177 stored summaries, none for a skipped item.
    expect(h.library.notes).toHaveLength(177);
    const noted = new Set(h.library.notes.map((n) => n.itemKey));
    for (const [i, kind] of mixedKinds(200).entries()) {
      const summarized = kind === "abstract" || kind === "fulltext";
      expect(noted.has(`K${pad(i)}`)).toBe(summarized);
    }
    expect(summaryRows(h)).toBe(177);
    // The note key is stored on the row (plan/00 §6 item 296(b)).
    const row = (await h.store.listForWork("doi:10.1234/k0004"))[0];
    expect(row?.zoteroNoteKey).toMatch(/^N\d{7}$/);
    // No call for a stub, a retracted or a duplicate item.
    expect(h.provider.calls).toHaveLength(177);
  });
});

describe("summarizePipeline — cancel and re-run (FR-23)", () => {
  it("cancelled at 87/200 keeps 86 summaries; the re-run skips them and issues 114 calls", async () => {
    const source = createCancellationTokenSource();
    let cancelAt87 = true;
    const h = await harness(Array<Kind>(200).fill("abstract"), {
      script: [
        answering((call) => {
          if (cancelAt87 && call.index === 87) {
            source.cancel({ kind: "user" });
            try {
              call.ctx.token.throwIfCancelled();
            } catch (error) {
              return error as Error;
            }
          }
          return undefined;
        }),
      ],
    });
    const first = await h.run({}, {}, source);
    expect(first.outcome).toBe("cancelled");
    expect(first.stoppedAt).toBe(87);
    expect(summaryRows(h)).toBe(86);
    expect(h.library.notes).toHaveLength(86);
    const jobs = await h.jobs.list();
    expect(jobs[0]?.status).toBe("cancelled");

    cancelAt87 = false;
    const before = h.provider.calls.length;
    const second = await h.run();
    expect(second.outcome).toBe("succeeded");
    expect(second.view.counts.existing).toBe(86);
    expect(h.provider.calls.length - before).toBe(114);
    expect(summaryRows(h)).toBe(200);
  });
});

describe("summarizePipeline — the key check (step 3)", () => {
  it("pauses with credential-required and sends nothing when the key is absent", async () => {
    let paused: string | undefined;
    const h = await harness(Array<Kind>(5).fill("abstract"), {
      hasKey: () => false,
    });
    const output = await h.run(
      {},
      {
        ask: async (question) => {
          const [record] = await h.jobs.list();
          paused = `${String(record?.status)}:${String(record?.pauseReason)}`;
          expect(question.reason).toBe("credential-required");
          return "cancel";
        },
      },
    );
    expect(paused).toBe("paused:credential-required");
    expect(h.provider.calls).toHaveLength(0);
    expect(output.outcome).toBe("cancelled");
    expect(summaryRows(h)).toBe(0);
  });

  it("continues once the key is there", async () => {
    let present = false;
    const h = await harness(Array<Kind>(3).fill("abstract"), {
      hasKey: () => present,
    });
    const output = await h.run(
      {},
      {
        ask: () => {
          present = true;
          return Promise.resolve("resume");
        },
      },
    );
    expect(output.outcome).toBe("succeeded");
    expect(h.provider.calls).toHaveLength(3);
  });
});

describe("summarizePipeline — a read-only library (step 8)", () => {
  it("writes no note and leaves the summaries for the export", async () => {
    const h = await harness(Array<Kind>(4).fill("abstract"));
    h.library.editable = false;
    const output = await h.run({ writeNotes: true });
    expect(output.outcome).toBe("succeeded");
    expect(h.library.notes).toHaveLength(0);
    expect(output.view.notesWritable).toBe(false);
    expect(output.summaries).toHaveLength(4);
    const model = buildSummarizeWindowModel(output.view, {
      running: false,
      outcome: { kind: output.outcome },
      exportAvailable:
        !output.view.notesWritable && output.summaries.length > 0,
    });
    expect(model.exportAvailable).toBe(true);
    expect(model.notesWritable).toBe(false);
  });
});

describe("summarizePipeline — notes are opt-in and never overwrite", () => {
  it("writes no note when the run's option is off", async () => {
    const h = await harness(Array<Kind>(3).fill("abstract"));
    await h.run({ writeNotes: false });
    expect(h.library.notes).toHaveLength(0);
    expect(summaryRows(h)).toBe(3);
  });

  it("re-summarizing keeps an existing note and writes no second one", async () => {
    const h = await harness(Array<Kind>(2).fill("abstract"));
    await h.run();
    expect(h.library.notes).toHaveLength(2);
    const output = await h.run({ resummarize: true });
    expect(output.outcome).toBe("succeeded");
    expect(h.library.notes).toHaveLength(2);
  });

  it("a skipped item with a row and no note gets its note from the row, with no call", async () => {
    const h = await harness(Array<Kind>(2).fill("abstract"));
    await h.run({ writeNotes: false });
    const calls = h.provider.calls.length;
    const output = await h.run({ writeNotes: true });
    expect(h.provider.calls.length).toBe(calls);
    expect(h.library.notes).toHaveLength(2);
    expect(output.view.counts.existing).toBe(2);
  });
});

describe("summarizePipeline — an outage stops with one message", () => {
  it("stops once more than 30 % of at least ten settled items failed", async () => {
    const h = await harness(Array<Kind>(40).fill("abstract"), {
      script: [new UpstreamServerError(503, "synthetic outage")],
    });
    const output = await h.run();
    expect(output.outcome).toBe("stopped-outage");
    expect(output.view.counts.failed).toBe(10);
    expect(h.provider.calls.length).toBeLessThan(40);
    const [record] = await h.jobs.list();
    expect(record?.status).toBe("cancelled");
  });
});

describe("summarizePipeline — the wall-clock budget asks (item 265(a))", () => {
  it("routes the queue's pause to the window's question, and a yes continues", async () => {
    const clock: { current?: ManualClock } = {};
    const h = await harness(Array<Kind>(3).fill("abstract"), {
      wallClockBudgetMs: 1,
      script: [
        answering(() => {
          clock.current?.advance(5);
          return undefined;
        }),
      ],
    });
    clock.current = h.clock;
    const output = await h.run();
    expect(output.outcome).toBe("succeeded");
    expect(h.asks.length).toBeGreaterThan(0);
    const first = h.asks[0];
    expect(first?.reason).toBe("wall-clock-budget");
    if (first !== undefined && "total" in first) expect(first.total).toBe(3);
    expect(h.provider.calls).toHaveLength(3);
  });
});

describe("summarizePipeline — declined confirmation", () => {
  it("sends nothing and leaves no row", async () => {
    const h = await harness(Array<Kind>(3).fill("abstract"));
    const output = await h.run(
      {},
      { confirm: () => Promise.resolve({ kind: "cancelled" }) },
    );
    expect(output.outcome).toBe("declined");
    expect(h.provider.calls).toHaveLength(0);
    expect(summaryRows(h)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The confirmation's money rules (plan/00 §6 items 274(b), 292(f))
// ---------------------------------------------------------------------------

function estimateOf(costUsd: number | undefined, calls = 3): RunEstimate {
  const plan = {
    fullTextMode: "auto" as const,
    items: [],
    counts: {
      items: calls,
      cached: 0,
      fullText: 0,
      abstractOnly: calls,
      metadataOnly: 0,
      chunked: 0,
    },
    calls,
    rawInputTokens: 100,
    inputTokens: 115,
    outputTokens: 100,
    costUsd,
  };
  return {
    modelId: MODEL,
    selected: plan,
    abstractOnly: plan,
    preselectDowngrade: false,
    pricesAsOfEpochMs: 0,
    isEstimate: true,
  };
}

const DISCLOSURE: EgressDisclosure = {
  providerId: "openrouter",
  modelId: MODEL,
  host: "openrouter.ai",
  itemCount: 3,
  scope: {
    "metadata-only": 0,
    abstract: 3,
    "abstract+fulltext": 0,
    "abstract+notes": 0,
  },
  privacyMode: "balanced",
  firstJobNotice: false,
  geminiFreeTierWarning: false,
  geminiDeclaredPaidReminder: false,
  noticeIds: [],
};

const ROUTINE: RoutineConfirmation = {
  providerId: "openrouter",
  privacyMode: "balanced",
  fullText: false,
};

function confirmDeps(over: Partial<SummarizeConfirmDeps> = {}): {
  deps: SummarizeConfirmDeps;
  opened: number[];
  written: RoutineConfirmation[];
  settled: string[];
} {
  const opened: number[] = [];
  const written: RoutineConfirmation[] = [];
  const settled: string[] = [];
  return {
    opened,
    written,
    settled,
    deps: {
      readRoutine: () => Promise.resolve(ROUTINE),
      writeRoutine: (_c, record) => {
        written.push(record);
        return Promise.resolve();
      },
      openDialog: () => {
        opened.push(1);
        return Promise.resolve({
          kind: "run",
          plan: "selected",
          raise: undefined,
          dontAskAgain: true,
        });
      },
      settle: (_d, outcome) => {
        settled.push(outcome);
      },
      confirmAboveCents: () => 200,
      fullTextAutoMaxPapers: () => 25,
      providerName: () => Promise.resolve("OpenRouter"),
      locale: () => "en-US",
      ...over,
    },
  };
}

function request(costUsd: number | undefined) {
  return {
    estimate: estimateOf(costUsd),
    disclosure: DISCLOSURE,
    ceilingSelected: undefined,
    ceilingDowngrade: undefined,
    collection: { libraryID: 1, collectionKey: "COLLKEY1" },
    session: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      estimatedCalls: 0,
      unpricedCalls: 0,
    },
  };
}

describe("confirmSummarizeRun", () => {
  it("skips the routine question under the collection's summarize record, and shows the number", async () => {
    const t = confirmDeps();
    const result = await confirmSummarizeRun(t.deps, request(0.5));
    expect(t.opened).toHaveLength(0);
    expect(result.answer.kind).toBe("run");
    expect(result.notice?.id).toBe("research-helper-cost-skipped-notice");
  });

  it("never lets 'don't ask again' skip a question forced by money", async () => {
    const above = confirmDeps();
    await confirmSummarizeRun(above.deps, request(5));
    expect(above.opened).toHaveLength(1);
    const unpriced = confirmDeps();
    await confirmSummarizeRun(unpriced.deps, request(undefined));
    expect(unpriced.opened).toHaveLength(1);
  });

  it("asks when there is no record, and stores the summarize record on 'don't ask again'", async () => {
    const t = confirmDeps({ readRoutine: () => Promise.resolve(undefined) });
    const result = await confirmSummarizeRun(t.deps, request(0.5));
    expect(t.opened).toHaveLength(1);
    expect(t.written).toEqual([ROUTINE]);
    expect(t.settled).toEqual(["confirmed"]);
    expect(result.answer).toEqual({
      kind: "run",
      plan: "selected",
      raise: undefined,
    });
  });

  it("runs nothing when the dialog is cancelled or cannot open", async () => {
    const cancelled = confirmDeps({
      readRoutine: () => Promise.resolve(undefined),
      openDialog: () => Promise.resolve({ kind: "cancelled" }),
    });
    expect(
      (await confirmSummarizeRun(cancelled.deps, request(0.5))).answer.kind,
    ).toBe("cancelled");
    expect(cancelled.settled).toEqual(["cancelled"]);
    const broken = confirmDeps({
      readRoutine: () => Promise.resolve(undefined),
      openDialog: () => Promise.reject(new Error("no window")),
    });
    expect(
      (await confirmSummarizeRun(broken.deps, request(0.5))).answer.kind,
    ).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// The note (FR-20, FR-21; docs/07 §6.4's note of 2026-10-29)
// ---------------------------------------------------------------------------

describe("renderSummaryNoteHtml", () => {
  it("puts the FR-20 disclaimer first, the marker after it, then FR-21's source line", async () => {
    const h = await harness(["fulltext", "abstract"]);
    await h.run({ writeNotes: false });
    const full = (
      await h.store.listForWork("doi:10.1234/k0000")
    )[0] as StoredSummary;
    const html = renderSummaryNoteHtml(full, "Paper 0000.pdf");
    expect(
      html.startsWith(
        "<p><strong>Machine-generated summary (Research Helper). ",
      ),
    ).toBe(true);
    expect(html).toContain(
      `Provider: openrouter · Model: ${MODEL} · Generated `,
    );
    expect(html).toMatch(
      /Generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
    );
    expect(html.indexOf("<!-- rh:summary v=1")).toBeGreaterThan(
      html.indexOf("</p>"),
    );
    expect(html).toMatch(
      /<p>Source: full text \(\d+ chars extracted from Paper 0000\.pdf\)<\/p>/,
    );
    const abstract = (
      await h.store.listForWork("doi:10.1234/k0001")
    )[0] as StoredSummary;
    expect(renderSummaryNoteHtml(abstract)).toContain(
      "<p>Source: abstract only</p>",
    );
  });

  it("escapes the model's text and keeps a comment free of '--'", () => {
    expect(summarySourceLine({ kind: "abstract" }, undefined)).toBe(
      "Source: abstract only",
    );
    expect(isGeneratedTag(AI_SUMMARY_TAG)).toBe(true);
    expect(isGeneratedTag(modelTag("openrouter", MODEL))).toBe(true);
    expect(isGeneratedTag("research_helper")).toBe(false);
    expect(isGeneratedTag("my own tag")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The optional item list and the item pane's one-item run (plan/00 §6 item 303)
// ---------------------------------------------------------------------------

describe("summarizePipeline — an item list (item 303(a))", () => {
  it("runs only the listed items, over no collection: no record to read, items: exclusivity", async () => {
    const h = await harness(Array<Kind>(5).fill("abstract"));
    const requests: (CollectionRefLike | undefined)[] = [];
    const output = await h.run(
      { collectionKey: undefined, itemKeys: ["K0003"], writeNotes: false },
      {
        confirm: (confirmRequest) => {
          requests.push(confirmRequest.collection);
          return Promise.resolve({
            kind: "run",
            plan: "selected",
            raise: undefined,
          });
        },
      },
    );
    expect(output.outcome).toBe("succeeded");
    expect(output.view.total).toBe(1);
    expect(h.provider.calls).toHaveLength(1);
    expect(summaryRows(h)).toBe(1);
    expect(requests).toEqual([undefined]);
    expect(
      summarizeExclusivityKey({ libraryID: 1, itemKeys: ["K2", "K1"] }),
    ).toBe("summarize:1/items:K1,K2");
    expect(
      summarizeExclusivityKey({ libraryID: 1, collectionKey: "COLLKEY1" }),
    ).toBe("summarize:1/COLLKEY1");
  });

  it("narrows a collection to the list when both are given", async () => {
    const h = await harness(Array<Kind>(5).fill("abstract"));
    const output = await h.run({ itemKeys: ["K0001", "K0004"] });
    expect(output.view.total).toBe(2);
    expect(h.provider.calls).toHaveLength(2);
  });

  it("validates: a collection or a non-empty list, each naming something", async () => {
    const h = await harness([]);
    const ok = (input: Partial<SummarizeInput>) =>
      h.pipeline.validate({
        libraryID: 1,
        resummarize: false,
        writeNotes: false,
        ...input,
      }).ok;
    expect(ok({ collectionKey: "COLLKEY1" })).toBe(true);
    expect(ok({ itemKeys: ["K0001"] })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ itemKeys: [] })).toBe(false);
    expect(ok({ itemKeys: [""] })).toBe(false);
    expect(ok({ collectionKey: "" })).toBe(false);
  });

  it("tells the surface which item failed, with the error its call ended in", async () => {
    const failure = new UpstreamServerError(503, "synthetic failure");
    const h = await harness(["abstract"], { script: [failure] });
    const failed: [string, unknown][] = [];
    const output = await h.run(
      {},
      {
        itemFailed: (key, error) => {
          failed.push([key, error]);
        },
      },
    );
    expect(output.view.counts.failed).toBe(1);
    expect(failed).toEqual([["K0000", failure]]);
  });
});

interface CollectionRefLike {
  readonly libraryID: number;
  readonly collectionKey: string;
}

/** {@link runItemSummary} over the harness, with the cost dialog faked. */
function itemRun(
  h: Harness,
  options: {
    dialog?: "run" | "cancel";
    ceiling?: "resume" | "cancel";
    /** The item's collections (`collectionsOf`); none by default. */
    collections?: readonly CollectionRefLike[];
    /**
     * When set, each job context's policy is `loadStrictestPrivacyPolicy`
     * over these overrides (by collection key) and `global`, as `openJob`
     * builds it in the product; otherwise the harness's balanced policy.
     */
    privacy?: {
      readonly global: PrivacyMode;
      readonly overrides: Readonly<Record<string, PrivacyMode>>;
    };
  } = {},
) {
  const dialogs: CostDialogInput[] = [];
  const routineReads: unknown[] = [];
  const routineWrites: unknown[] = [];
  const opened: (readonly CollectionRefLike[])[] = [];
  const modes: string[] = [];
  const source = createCancellationTokenSource();
  const privacy = options.privacy;
  const settings = {
    get: (_libraryID: number, collectionKey: string) => {
      const mode = privacy?.overrides[collectionKey];
      return Promise.resolve(
        mode === undefined ? undefined : { privacyMode: mode },
      );
    },
    put: () => Promise.resolve(),
  } as unknown as CollectionSettingsStore;
  const deps: ItemSummaryDeps = {
    pipeline: h.pipeline,
    collectionsOf: () => options.collections ?? [],
    openJob: async (record, _token, itemCollections) => {
      opened.push(itemCollections);
      const context = h.context(record?.id ?? "prepare-only", source);
      const policy =
        privacy === undefined
          ? context.privacy
          : await loadStrictestPrivacyPolicy(
              { globalMode: () => privacy.global, store: settings },
              itemCollections,
            );
      modes.push(policy.mode);
      return {
        context: { ...context, privacy: policy },
        finish: () => Promise.resolve(),
      };
    },
    enqueue: (input) =>
      h.jobs.enqueue("summarize", input, {
        priority: "normal",
        exclusivityKey: summarizeExclusivityKey(input),
        libraryID: 1,
      }),
    confirm: confirmDeps({
      readRoutine: (collection) => {
        routineReads.push(collection);
        return Promise.resolve(ROUTINE);
      },
      writeRoutine: (collection) => {
        routineWrites.push(collection);
        return Promise.resolve();
      },
      openDialog: (input) => {
        dialogs.push(input);
        return Promise.resolve(
          options.dialog === "cancel"
            ? { kind: "cancelled" }
            : {
                kind: "run",
                plan: "selected",
                raise: undefined,
                dontAskAgain: true,
              },
        );
      },
    }).deps,
    askCeiling: () => Promise.resolve(options.ceiling ?? "cancel"),
  };
  return {
    dialogs,
    routineReads,
    routineWrites,
    opened,
    modes,
    source,
    run: (itemKey: string, regenerate: boolean, bypassCache?: boolean) =>
      runItemSummary(
        deps,
        {
          libraryID: 1,
          itemKey,
          regenerate,
          ...(bypassCache !== undefined && { bypassCache }),
        },
        source.token,
      ),
  };
}

async function reasonOf(promise: Promise<void>): Promise<string | undefined> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return notStoredReason(error) ?? "error";
  }
}

describe("runItemSummary — the item pane's one-item run (item 303(a))", () => {
  it("asks the cost dialog, with no 'don't ask again' box and no record read or written, then stores one row", async () => {
    const h = await harness(Array<Kind>(3).fill("abstract"));
    const t = itemRun(h);
    await t.run("K0001", false);
    expect(t.dialogs).toHaveLength(1);
    const dialog = t.dialogs[0];
    expect(dialog?.mode).toBe("preflight");
    if (dialog?.mode === "preflight") {
      expect(dialog.offerDontAskAgain).toBe(false);
      expect(dialog.estimate.selected.calls).toBe(1);
    }
    expect(t.routineReads).toEqual([]);
    expect(t.routineWrites).toEqual([]);
    expect(h.provider.calls).toHaveLength(1);
    expect(summaryRows(h)).toBe(1);
    // The pane never writes a note itself (docs/08 §3.2).
    expect(h.library.notes).toHaveLength(0);
    const [record] = await h.jobs.list();
    expect(record?.status).toBe("succeeded");
  });

  it("sends nothing and resolves quietly when the cost dialog is cancelled", async () => {
    const h = await harness(["abstract"]);
    const t = itemRun(h, { dialog: "cancel" });
    expect(await reasonOf(t.run("K0000", false))).toBe("resolved");
    expect(t.dialogs).toHaveLength(1);
    expect(h.provider.calls).toHaveLength(0);
    expect(summaryRows(h)).toBe(0);
    expect(await h.jobs.list()).toEqual([]);
  });

  it("Generate skips a stored item; Retry maps to resummarize and keeps the cache rule (item 305(c))", async () => {
    const h = await harness(["abstract"]);
    await h.run({ writeNotes: false });
    const before = h.provider.calls.length;
    const t = itemRun(h);
    expect(await reasonOf(t.run("K0000", false))).toBe("existing");
    expect(h.provider.calls.length).toBe(before);
    expect(t.dialogs).toHaveLength(0);
    // Retry: regenerate without the bypass.
    expect(await reasonOf(t.run("K0000", true))).toBe("resolved");
    // The text is unchanged, so the planned call is a cache hit: nothing to
    // pay, no dialog (shouldOpenCostDialog), and the row is stored again.
    expect(t.dialogs).toHaveLength(0);
    expect(h.provider.calls.length).toBe(before);
    expect(summaryRows(h)).toBe(1);
  });

  it("Regenerate bypasses the stored result: priced, confirmed, one real call, and the new answer replaces the row and the cache entry (item 305(c))", async () => {
    let answers = 0;
    const h = await harness(["abstract"], {
      script: [
        answering(() => {
          answers += 1;
          return answers === 1
            ? undefined
            : chatResponse(
                summaryJson("abstract").replace(
                  "Does the intervention reduce the primary outcome?",
                  "Regenerated question?",
                ),
              );
        }),
      ],
    });
    await h.run({ writeNotes: false });
    const workKey = itemOf(0, "abstract").workKey;
    const [old] = await h.store.listForWork(workKey);
    expect(old?.content.researchQuestion).toBe(
      "Does the intervention reduce the primary outcome?",
    );
    const before = h.provider.calls.length;
    const t = itemRun(h);

    expect(await reasonOf(t.run("K0000", true, true))).toBe("resolved");
    // Priced (no cache hit) and asked before the call.
    expect(t.dialogs).toHaveLength(1);
    const dialog = t.dialogs[0];
    expect(dialog?.mode === "preflight" && dialog.estimate.selected.calls).toBe(
      1,
    );
    expect(h.provider.calls.length).toBe(before + 1);
    // Replaced, not added: one row, same id, the new answer.
    expect(summaryRows(h)).toBe(1);
    const [fresh] = await h.store.listForWork(workKey);
    expect(fresh?.id).toBe(old?.id);
    expect(fresh?.content.researchQuestion).toBe("Regenerated question?");

    // The cache entry was replaced too: with the row gone, a Retry is served
    // from the cache (no call) and rebuilds the new answer.
    h.connection.db.prepare("DELETE FROM summary").run();
    expect(await reasonOf(t.run("K0000", true))).toBe("resolved");
    expect(h.provider.calls.length).toBe(before + 1);
    const [rebuilt] = await h.store.listForWork(workKey);
    expect(rebuilt?.content.researchQuestion).toBe("Regenerated question?");
  });

  it("the bypass needs Regenerate: a Generate carrying it still skips the stored item", async () => {
    const h = await harness(["abstract"]);
    await h.run({ writeNotes: false });
    const before = h.provider.calls.length;
    const t = itemRun(h);
    expect(await reasonOf(t.run("K0000", false, true))).toBe("existing");
    expect(h.provider.calls.length).toBe(before);
    expect(t.dialogs).toHaveLength(0);
  });

  it("rejects with the failed call's own error", async () => {
    const failure = new UpstreamServerError(503, "synthetic failure");
    const h = await harness(["abstract"], { script: [failure] });
    const t = itemRun(h);
    await expect(t.run("K0000", false)).rejects.toBe(failure);
  });

  it("with no key: stops after zero requests and says why", async () => {
    const h = await harness(["abstract"], { hasKey: () => false });
    const t = itemRun(h);
    expect(await reasonOf(t.run("K0000", false))).toBe("no-key");
    expect(h.provider.calls).toHaveLength(0);
    const [record] = await h.jobs.list();
    expect(record?.status).toBe("cancelled");
  });

  it("an item with no text: no dialog, no call, and the reason", async () => {
    const h = await harness(["notext"]);
    const t = itemRun(h);
    expect(await reasonOf(t.run("K0000", false))).toBe("no-text");
    expect(t.dialogs).toHaveLength(0);
    expect(h.provider.calls).toHaveLength(0);
  });
});

describe("runItemSummary — the strictest privacy mode of the item's collections (item 305(a))", () => {
  const STRICT = { libraryID: 1, collectionKey: "STRICT23" };
  const LOOSE = { libraryID: 1, collectionKey: "LOOSE234" };
  const overrides = { STRICT23: "strict", LOOSE234: "balanced" } as const;

  async function inputScope(h: Harness): Promise<string | undefined> {
    const [row] = await h.store.listForWork(itemOf(0, "fulltext").workKey);
    return row?.inputScope.kind;
  }

  it("runs an item in a strict collection in strict mode under a balanced global mode: no full text sent", async () => {
    const h = await harness(["fulltext"]);
    const t = itemRun(h, {
      collections: [STRICT],
      privacy: { global: "balanced", overrides },
    });
    await t.run("K0000", false);
    // Both halves were opened over the item's collections, and both strict.
    expect(t.opened).toEqual([[STRICT], [STRICT]]);
    expect(t.modes).toEqual(["strict", "strict"]);
    const dialog = t.dialogs[0];
    expect(dialog?.mode === "preflight" && dialog.disclosure.privacyMode).toBe(
      "strict",
    );
    expect(await inputScope(h)).toBe("abstract");
    expect(h.provider.calls.length).toBeGreaterThan(0);
    for (const call of h.provider.calls) {
      expect(userOf(call.request)).not.toContain("Paragraph 3 of study");
    }
  });

  it("the same item in no strict collection follows the balanced global mode and sends its full text", async () => {
    const h = await harness(["fulltext"]);
    const t = itemRun(h, {
      collections: [LOOSE],
      privacy: { global: "balanced", overrides },
    });
    await t.run("K0000", false);
    expect(t.modes).toEqual(["balanced", "balanced"]);
    expect(await inputScope(h)).toBe("abstract+fulltext");
  });

  it("an item in two collections takes the stricter, in either order, under a full global mode", async () => {
    for (const collections of [
      [LOOSE, STRICT],
      [STRICT, LOOSE],
    ]) {
      const h = await harness(["fulltext"]);
      const t = itemRun(h, {
        collections,
        privacy: { global: "full", overrides },
      });
      await t.run("K0000", false);
      expect(t.opened).toEqual([collections, collections]);
      expect(t.modes).toEqual(["strict", "strict"]);
      expect(await inputScope(h)).toBe("abstract");
    }
    const h = await harness(["fulltext"]);
    const t = itemRun(h, {
      collections: [LOOSE],
      privacy: { global: "full", overrides },
    });
    await t.run("K0000", false);
    expect(t.modes).toEqual(["balanced", "balanced"]);
  });

  it("stops before anything is sent when the item's collections cannot be read", async () => {
    const h = await harness(["abstract"]);
    const t = itemRun(h);
    const deps = {
      pipeline: h.pipeline,
      collectionsOf: () => {
        throw new Error("no item");
      },
    } as unknown as ItemSummaryDeps;
    await expect(
      runItemSummary(
        deps,
        { libraryID: 1, itemKey: "K0000", regenerate: false },
        t.source.token,
      ),
    ).rejects.toThrow("no item");
    expect(h.provider.calls).toHaveLength(0);
    expect(await h.jobs.list()).toEqual([]);
  });
});

describe("bypassesStoredResult — Regenerate's bypass is keyed to an item run (item 305(c))", () => {
  const base = { libraryID: 1, resummarize: true, writeNotes: false };

  it("holds only for bypassCache on an item list, with no collection and resummarize on", () => {
    expect(
      bypassesStoredResult({ ...base, itemKeys: ["K0000"], bypassCache: true }),
    ).toBe(true);
    expect(bypassesStoredResult({ ...base, itemKeys: ["K0000"] })).toBe(false);
    expect(
      bypassesStoredResult({
        ...base,
        itemKeys: ["K0000"],
        bypassCache: true,
        resummarize: false,
      }),
    ).toBe(false);
    expect(
      bypassesStoredResult({
        ...base,
        collectionKey: "COLLKEY1",
        bypassCache: true,
      }),
    ).toBe(false);
    expect(
      bypassesStoredResult({
        ...base,
        collectionKey: "COLLKEY1",
        itemKeys: ["K0000"],
        bypassCache: true,
      }),
    ).toBe(false);
  });

  it("validate reports it on any other run", async () => {
    const h = await harness(["abstract"]);
    expect(
      h.pipeline.validate({ ...base, itemKeys: ["K0000"], bypassCache: true })
        .ok,
    ).toBe(true);
    const wrong = h.pipeline.validate({
      ...base,
      collectionKey: "COLLKEY1",
      bypassCache: true,
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.map((e) => e.field)).toEqual(["bypassCache"]);
  });

  it("a collection run's Re-summarize keeps the cache rule, even if its input carried the bypass", async () => {
    const h = await harness(Array<Kind>(2).fill("abstract"));
    await h.run({ writeNotes: false });
    const before = h.provider.calls.length;
    const plain = await h.run({ writeNotes: false, resummarize: true });
    expect(plain.view.counts.cached).toBe(2);
    expect(h.provider.calls.length).toBe(before);
    const carried = await h.run({
      writeNotes: false,
      resummarize: true,
      bypassCache: true,
    });
    expect(carried.view.counts.cached).toBe(2);
    expect(h.provider.calls.length).toBe(before);
  });
});

describe("saveSummaryNoteOnce — Save as child note (item 303(b))", () => {
  function row(zoteroNoteKey?: string): StoredSummary {
    return {
      id: "w:1.0.0:m",
      workKey: "w",
      ...(zoteroNoteKey !== undefined && { zoteroNoteKey }),
    } as unknown as StoredSummary;
  }

  it("writes the note and stores its key when the item has none", async () => {
    const put: StoredSummary[] = [];
    const looked: (string | undefined)[] = [];
    const outcome = await saveSummaryNoteOnce(
      { libraryID: 1, parentItemKey: "ABCD1234", stored: row("GONE0000") },
      {
        put: (stored) => (put.push(stored), Promise.resolve()),
        find: (_l, _p, stored) => (looked.push(stored), undefined),
        write: () => Promise.resolve("NOTE0001"),
        editable: () => true,
      },
    );
    expect(outcome).toEqual({ kind: "written", noteKey: "NOTE0001" });
    // Found by the stored key first (item 296(b)), then by tag.
    expect(looked).toEqual(["GONE0000"]);
    expect(put.map((stored) => stored.zoteroNoteKey)).toEqual(["NOTE0001"]);
  });

  it("writes no second note when the item already has one, and stores nothing", async () => {
    const writes: unknown[] = [];
    const put: unknown[] = [];
    const outcome = await saveSummaryNoteOnce(
      { libraryID: 1, parentItemKey: "ABCD1234", stored: row() },
      {
        put: (stored) => (put.push(stored), Promise.resolve()),
        find: () => "NOTE0001",
        write: (request) => (writes.push(request), Promise.resolve("X")),
        editable: () => true,
      },
    );
    expect(outcome).toEqual({ kind: "exists", noteKey: "NOTE0001" });
    expect(writes).toEqual([]);
    expect(put).toEqual([]);
  });

  it("writes nothing in a read-only library", async () => {
    const writes: unknown[] = [];
    const outcome = await saveSummaryNoteOnce(
      { libraryID: 1, parentItemKey: "ABCD1234", stored: row() },
      {
        put: () => Promise.resolve(),
        find: () => undefined,
        write: (request) => (writes.push(request), Promise.resolve("X")),
        editable: () => false,
      },
    );
    expect(outcome).toEqual({ kind: "read-only" });
    expect(writes).toEqual([]);
  });
});

describe("confirmSummarizeRun — a run over no collection (item 303(a))", () => {
  it("reads and writes no record and offers no box, but still asks", async () => {
    const reads: unknown[] = [];
    const t = confirmDeps({
      readRoutine: (collection) => (
        reads.push(collection),
        Promise.resolve(ROUTINE)
      ),
    });
    const inputs: CostDialogInput[] = [];
    const deps = {
      ...t.deps,
      openDialog: (input: CostDialogInput) => {
        inputs.push(input);
        return t.deps.openDialog(input);
      },
    };
    const result = await confirmSummarizeRun(deps, {
      ...request(0.5),
      collection: undefined,
    });
    expect(result.answer.kind).toBe("run");
    expect(reads).toEqual([]);
    expect(inputs).toHaveLength(1);
    expect(
      inputs[0]?.mode === "preflight" ? inputs[0].offerDontAskAgain : "x",
    ).toBe(false);
    expect(t.written).toEqual([]);
  });
});

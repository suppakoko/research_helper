/**
 * `P3-T25` — the per-paper summarizer: DR-1, the three paths, the cache, the
 * grounding policy, the budget on every call, and the redaction-gated row.
 *
 * No network and no model: every answer comes from `test/helpers/mockLLM.ts`
 * through the real router and `withBudget`; the cache and the `summary` table
 * are the real ones over `node:sqlite` in memory. Every paper is synthetic
 * text written here. No label is read; no fixture text is touched.
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
  ConfigurationError,
  ContextLengthExceededError,
  PolicyViolationError,
  StorageError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import { validateAgainstSchema } from "../../../src/llm/shared/schemaValidate";
import type { BudgetGuard, ChatRequest } from "../../../src/llm/types";
import {
  deriveTldr,
  PAPER_SUMMARY_SCHEMA_VERSION,
  type AcquiredSection,
  type AcquiredSource,
  type PaperSummary,
  type SourceTier,
} from "../../../src/model/summary";
import { withBudget } from "../../../src/pipeline/shared/budget";
import {
  createPrivacyPolicy,
  type PrivacyMode,
} from "../../../src/pipeline/shared/privacyPolicy";
import {
  createSummaryCache,
  PAPER_SUMMARY_SCHEMA_VERSION as CACHE_SCHEMA_VERSION_OF_PAYLOAD,
} from "../../../src/pipeline/summarize/summaryCache";
import {
  chunkedSentText,
  completenessNote,
  decideDr1,
  GROUNDING_LOW_WARNING,
  GROUNDING_RETRY_INSTRUCTION,
  isFloatingModelAlias,
  ITEM_KEY_MISMATCH_WARNING,
  summarizeItem,
  type SummarizeItemDeps,
  type SummarizeItemInput,
} from "../../../src/pipeline/summarize/summarizeItem";
import type { ConfigReader } from "../../../src/pipeline/types";
import {
  createPromptRegistry,
  PROMPT_SCHEMAS,
  type PromptRegistry,
} from "../../../src/prompts";
import {
  createSummaryStore,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";
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
const repo = resolve(here, "../../..");
const promptDir = resolve(repo, "src/prompts");

const PROMPTS: PromptRegistry = createPromptRegistry(
  readdirSync(promptDir)
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => ({
      fileName,
      text: readFileSync(resolve(promptDir, fileName), "utf8"),
    })),
);
const SCHEMA = PROMPT_SCHEMAS["paper-summary.v1.json"] as Record<
  string,
  unknown
>;

/** A credential-shaped string, built at run time; never a real key. */
const SYNTHETIC_KEY = "sk-ant-" + "x".repeat(30);

const ITEM = "ABCD2345";
const QUOTE = "The intervention reduced the primary outcome by 42 percent.";
const ABSTRACT =
  "Background: a synthetic trial. " +
  QUOTE +
  " Conclusion: the effect held in 1,204 patients.";

/** One ≥ 200-character paragraph line, so `\n` reads as a paragraph boundary. */
function paragraph(i: number, topic = "intervention"): string {
  return (
    `Paragraph ${String(i)} describes the ${topic} arm of a synthetic study: ` +
    "participants were enrolled at several clinical sites, followed for two " +
    "years, and assessed with the same validated instruments at every visit " +
    "so that the outcomes could be compared across the sites."
  );
}

function body(paragraphs: number, topic?: string, from = 0): string {
  const lines: string[] = [];
  for (let i = 0; i < paragraphs; i += 1)
    lines.push(paragraph(from + i, topic));
  return lines.join("\n");
}

function fullTextSource(
  bodyText: string,
  over: Partial<AcquiredSource> = {},
): AcquiredSource {
  const text = `${ABSTRACT}\n\n${QUOTE}\n${bodyText}`;
  return makeSource({ tier: "fulltext_pdf", text, ...over });
}

function makeSource(over: Partial<AcquiredSource> = {}): AcquiredSource {
  const text = over.text ?? ABSTRACT;
  return {
    itemKey: ITEM,
    libraryID: 1,
    tier: "abstract",
    abstract: ABSTRACT,
    sections: [],
    sectionAware: false,
    charCount: text.length,
    estTokens: 0,
    truncated: false,
    attachmentKey: null,
    warnings: [],
    ...over,
    text,
    contentHash: sha256Hex(text),
  };
}

function input(
  source: AcquiredSource,
  over: Partial<SummarizeItemInput> = {},
): SummarizeItemInput {
  return {
    source,
    workKey: `doi:10.1234/${source.itemKey.toLowerCase()}`,
    metadata: {
      title: "A synthetic trial",
      authors: ["Doe, Jane", "Roe, Rick"],
      year: 2025,
      venue: "Journal of Synthetic Fixtures",
      itemType: "journalArticle",
      doi: "10.1234/synthetic",
      tags: ["trial"],
    },
    fullTextMode: "auto",
    costGateBlocksFullText: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The scripted model
// ---------------------------------------------------------------------------

type PromptKind = "ABSTRACT" | "FULLTEXT" | "MAP" | "REDUCE";

function kindOf(request: ChatRequest): PromptKind {
  const system = request.messages[0]?.content ?? "";
  if (system.startsWith("You are extracting evidence from ONE CHUNK"))
    return "MAP";
  if (system.startsWith("You are consolidating per-chunk")) return "REDUCE";
  if (system.includes("scientific paper abstracts")) return "ABSTRACT";
  return "FULLTEXT";
}

function userOf(request: ChatRequest): string {
  return request.messages.find((m) => m.role === "user")?.content ?? "";
}

function summaryJson(
  over: Partial<PaperSummary> & { quote?: string | null } = {},
): string {
  const { quote, ...rest } = over;
  const summary: PaperSummary = {
    schemaVersion: PAPER_SUMMARY_SCHEMA_VERSION,
    itemKey: ITEM,
    sourceTier: "abstract",
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
        verbatimSupport: quote === undefined ? QUOTE : quote,
      },
    ],
    effectSizes: [{ metric: "relative reduction", value: "42 percent" }],
    limitations: [],
    novelty: null,
    keywords: ["synthetic trial"],
    researchTheme: "Synthetic Trials",
    citationWorthiness: { score: 50, reason: "Synthetic." },
    ...rest,
  };
  return JSON.stringify(summary);
}

function mapJson(): string {
  return JSON.stringify({
    chunkIndex: 1,
    section: "unknown",
    designSignals: [],
    populationSignals: [],
    methodSignals: [],
    findingSignals: [
      { statement: "The outcome fell.", direction: "positive", quote: QUOTE },
    ],
    numberSignals: [],
    limitationSignals: [],
    noveltySignals: [],
  });
}

/** Answers each prompt correctly, with the tier the request names. */
function answering(
  overrides: Partial<
    Record<
      PromptKind,
      (call: MockCall) => ReturnType<typeof chatResponse> | Error
    >
  > = {},
): MockStep {
  return (call) => {
    const kind = kindOf(call.request);
    const own = overrides[kind];
    if (own !== undefined) return own(call);
    if (kind === "MAP") return chatResponse(mapJson());
    const tier = /Set "sourceTier" to "([a-z_]+)"/.exec(
      userOf(call.request),
    )?.[1];
    return chatResponse(
      summaryJson({ sourceTier: (tier ?? "abstract") as SourceTier }),
    );
  };
}

// ---------------------------------------------------------------------------
// The harness: real cache, real store, real router behind withBudget
// ---------------------------------------------------------------------------

interface Connection extends SqlConnection {
  readonly db: DatabaseSync;
}

function sqlite(): Connection {
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

interface Harness {
  readonly deps: SummarizeItemDeps;
  readonly provider: ReturnType<typeof mockLLM>;
  readonly connection: Connection;
  /** One entry per `reserve()` the budget guard saw. */
  readonly reserves: number[];
  rows(): Record<string, unknown>[];
}

async function harness(
  script: readonly MockStep[] = [answering()],
  options: {
    model?: string;
    mode?: PrivacyMode;
    window?: number;
    budget?: BudgetGuard;
    deps?: Partial<SummarizeItemDeps>;
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
  const provider = mockLLM(script);
  const router = mockLLMRouter(
    [provider],
    mockSettings({
      summaryModel: options.model ?? "mock-small-2026-01-01",
      keyPresent: { openrouter: true },
    }),
  );
  const reserves: number[] = [];
  const budget: BudgetGuard = options.budget ?? {
    reserve: (estimate) => {
      reserves.push(estimate.inputTokens);
    },
    settle: () => undefined,
    spentUsd: 0,
    limitUsd: undefined,
  };
  const values: Record<string, unknown> = {
    logRequestBodies: false,
    geminiPaidTier: false,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigReader;
  const deps: SummarizeItemDeps = {
    llm: withBudget(router, { pricesFor: () => undefined, now: () => 0 }),
    budget,
    token: createCancellationTokenSource().token,
    privacy: createPrivacyPolicy(options.mode ?? "balanced"),
    config,
    prompts: PROMPTS,
    summaryCache: createSummaryCache({
      cache,
      promptVersions: PROMPTS.versions,
      promptCacheEpochs: PROMPTS.cacheEpochs,
      clock,
      logger,
      enabled: () => true,
      ignoreModel: () => false,
    }),
    store: createSummaryStore(connection),
    clock,
    modelInfo: (_provider, id) =>
      mockModel(id, {
        contextWindowTokens: options.window ?? 128_000,
        dataPolicy: {
          trainsOnInputByDefault: "no",
          retention: { days: "zero", note: "" },
        },
      }),
    ...options.deps,
  };
  return {
    deps,
    provider,
    connection,
    reserves,
    rows: () =>
      connection.db
        .prepare("SELECT * FROM summary ORDER BY rowid")
        .all()
        .map((row) => ({ ...row })),
  };
}

function kinds(h: Harness): PromptKind[] {
  return h.provider.calls.map((call) => kindOf(call.request));
}

async function summarized(h: Harness, item: SummarizeItemInput) {
  const result = await summarizeItem(item, h.deps);
  if (result.kind !== "summarized") throw new Error("expected a summary");
  return result;
}

// ---------------------------------------------------------------------------
// 1. DR-1
// ---------------------------------------------------------------------------

describe("decideDr1 — docs/06 §5.4", () => {
  const count = (text: string) => text.length;
  const base = {
    tier: "fulltext_pdf" as SourceTier,
    abstract: "a".repeat(100),
    costGateBlocksFullText: false,
    countTokens: count,
  };

  it("picks the abstract in auto when the full text is under 3× the abstract, and full text in always", () => {
    const short = { ...base, text: "t".repeat(299) };
    expect(decideDr1({ ...short, fullTextMode: "auto" })).toBe("abstract");
    expect(decideDr1({ ...short, fullTextMode: "always" })).toBe("fulltext");
    expect(
      decideDr1({ ...base, text: "t".repeat(300), fullTextMode: "auto" }),
    ).toBe("fulltext");
  });

  it("never sends full text in never mode, and reads the cost gate in auto only", () => {
    const long = { ...base, text: "t".repeat(10_000) };
    expect(decideDr1({ ...long, fullTextMode: "never" })).toBe("abstract");
    expect(
      decideDr1({
        ...long,
        fullTextMode: "auto",
        costGateBlocksFullText: true,
      }),
    ).toBe("abstract");
    expect(
      decideDr1({
        ...long,
        fullTextMode: "always",
        costGateBlocksFullText: true,
      }),
    ).toBe("fulltext");
  });

  it("gives the stub for Tier 4 and for an abstract it does not have", () => {
    expect(
      decideDr1({
        ...base,
        tier: "metadata_only",
        text: "",
        fullTextMode: "always",
      }),
    ).toBe("metadata");
    expect(
      decideDr1({
        ...base,
        tier: "abstract",
        abstract: null,
        text: "",
        fullTextMode: "auto",
      }),
    ).toBe("metadata");
    expect(
      decideDr1({
        ...base,
        abstract: null,
        text: "body",
        fullTextMode: "auto",
      }),
    ).toBe("fulltext");
  });
});

describe("summarizeItem — DR-1 through the summarizer", () => {
  it("sends the abstract in auto for a full text under 3× it, and the full text in always", async () => {
    const short = fullTextSource("Short body.");
    const auto = await harness();
    const a = await summarized(auto, input(short));
    expect(kinds(auto)).toStrictEqual(["ABSTRACT"]);
    expect(a.stored.inputScope).toStrictEqual({ kind: "abstract" });
    expect(a.stored.content.sourceTier).toBe("abstract");

    const always = await harness();
    const b = await summarized(
      always,
      input(short, { fullTextMode: "always" }),
    );
    expect(kinds(always)).toStrictEqual(["FULLTEXT"]);
    expect(b.stored.content.sourceTier).toBe("fulltext_pdf");
    expect(b.stored.inputScope).toStrictEqual({
      kind: "abstract+fulltext",
      charsSent: short.text.length,
      chunks: 1,
    });
  });

  it("sends only the abstract in strict mode, whatever the run asked", async () => {
    const h = await harness([answering()], { mode: "strict" });
    await summarized(
      h,
      input(fullTextSource(body(20)), { fullTextMode: "always" }),
    );
    expect(kinds(h)).toStrictEqual(["ABSTRACT"]);
  });

  it("gives Tier 4 the stub with no call and no row", async () => {
    const h = await harness();
    const result = await summarizeItem(
      input(makeSource({ tier: "metadata_only", abstract: null, text: "" })),
      h.deps,
    );
    expect(result.kind).toBe("stub");
    expect(h.provider.calls).toHaveLength(0);
    expect(h.rows()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The request, the payload and the row
// ---------------------------------------------------------------------------

describe("summarizeItem — requests and the stored payload", () => {
  it("returns a payload that validates against paper-summary.v1.json on each path", async () => {
    const paths = [
      input(makeSource()),
      input(fullTextSource(body(40)), { fullTextMode: "always" }),
      input(fullTextSource(body(600)), { fullTextMode: "always" }),
    ];
    for (const item of paths) {
      const h = await harness();
      const result = await summarized(h, item);
      expect(
        validateAgainstSchema(result.stored.content, SCHEMA).errors,
      ).toStrictEqual([]);
    }
    expect(CACHE_SCHEMA_VERSION_OF_PAYLOAD).toBe(PAPER_SUMMARY_SCHEMA_VERSION);
  });

  it("sends temperature 0, top_p 1, a seed, effort low on summaries, none on maps, and the budget on every call", async () => {
    const h = await harness();
    await summarized(
      h,
      input(fullTextSource(body(600)), { fullTextMode: "always" }),
    );
    const requests = h.provider.calls.map((c) => c.request);
    expect(new Set(kinds(h))).toStrictEqual(new Set(["MAP", "REDUCE"]));
    for (const request of requests) {
      expect(request.temperature).toBe(0);
      expect(request.topP).toBe(1);
      expect(request.seed).toBe(0);
      expect(request.effort).toBe(
        kindOf(request) === "MAP" ? undefined : "low",
      );
      expect(request.responseFormat?.kind).toBe("json_schema");
    }
    expect(h.reserves).toHaveLength(requests.length);
  });

  it("refuses a call without the budget guard (the shared router fails closed)", async () => {
    const h = await harness();
    const unbudgeted = {
      ...h.deps,
      budget: undefined as unknown as BudgetGuard,
    };
    await expect(
      summarizeItem(input(makeSource()), unbudgeted),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(h.provider.calls).toHaveLength(0);
  });

  it("pauses on a budget stop: BudgetExceededError propagates and nothing is stored", async () => {
    const stop: BudgetGuard = {
      reserve: () => {
        throw new BudgetExceededError("ceiling", { ceiling: "run" });
      },
      settle: () => undefined,
      spentUsd: 0,
      limitUsd: 0.01,
    };
    const h = await harness([answering()], { budget: stop });
    await expect(
      summarizeItem(input(makeSource()), h.deps),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(h.provider.calls).toHaveLength(0);
    expect(h.rows()).toHaveLength(0);
  });

  it("refuses a floating model alias before any request", async () => {
    expect(isFloatingModelAlias("~openai/gpt-latest")).toBe(true);
    expect(isFloatingModelAlias("claude-sonnet-latest")).toBe(true);
    expect(isFloatingModelAlias("anthropic/claude-sonnet-5")).toBe(false);
    const h = await harness([answering()], { model: "some-model-latest" });
    await expect(
      summarizeItem(input(makeSource()), h.deps),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(h.provider.calls).toHaveLength(0);
  });

  it("refuses a model the strict mode refuses, before any request", async () => {
    const h = await harness([answering()], {
      mode: "strict",
      deps: { modelInfo: (_p, id) => mockModel(id) }, // policy "unknown"
    });
    await expect(
      summarizeItem(input(makeSource()), h.deps),
    ).rejects.toBeInstanceOf(PolicyViolationError);
    expect(h.provider.calls).toHaveLength(0);
  });

  it("keeps the system message byte-identical across two items, with paper content only in the user message", async () => {
    const h = await harness();
    const second = makeSource({
      itemKey: "WXYZ6789",
      abstract: `Another abstract. ${QUOTE}`,
      text: `Another abstract. ${QUOTE}`,
    });
    await summarized(h, input(makeSource()));
    await summarized(h, input(second));
    const [a, b] = h.provider.calls.map((c) => c.request.messages[0]?.content);
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(a).not.toContain(ITEM);
    expect(a).not.toContain("Another abstract");
    expect(userOf(h.provider.calls[1]?.request as ChatRequest)).toContain(
      "Another abstract",
    );
  });

  it("sends PAPER_SUMMARY_FULLTEXT with no section-provenance sentence while the chunker runs flat (P3-T22 step 3)", async () => {
    const h = await harness();
    await summarized(
      h,
      input(fullTextSource(body(30), { sectionAware: true }), {
        fullTextMode: "always",
      }),
    );
    const full = h.provider.calls.filter(
      (c) => kindOf(c.request) === "FULLTEXT",
    );
    expect(full).toHaveLength(1);
    const user = userOf(full[0]?.request as ChatRequest);
    expect(user).toContain("SOURCE TEXT (untrusted):");
    expect(user).not.toMatch(/\[SECTION|sections are label/iu);
  });

  it("corrects a mismatched itemKey with exactly one warning", async () => {
    const h = await harness([
      answering({
        ABSTRACT: () => chatResponse(summaryJson({ itemKey: "ZZZZ9999" })),
      }),
    ]);
    const result = await summarized(h, input(makeSource()));
    expect(result.stored.content.itemKey).toBe(ITEM);
    expect(
      result.stored.warnings.filter((w) => w === ITEM_KEY_MISMATCH_WARNING),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Grounding — docs/06 §12.1
// ---------------------------------------------------------------------------

describe("summarizeItem — the grounding policy", () => {
  const absent = () =>
    chatResponse(
      summaryJson({
        sourceTier: "fulltext_pdf",
        quote: "A sentence the paper never wrote.",
      }),
    );

  it("records 1.0 for a grounded full-text summary with no retry", async () => {
    const h = await harness();
    const result = await summarized(
      h,
      input(fullTextSource(body(30)), { fullTextMode: "always" }),
    );
    expect(result.stored.groundingScore).toBe(1);
    expect(h.provider.calls).toHaveLength(1);
    expect(result.stored.content.confidence).toBe("high");
  });

  it("retries a low full-text summary exactly once with the added instruction, then stores confidence low with a warning", async () => {
    const h = await harness([answering({ FULLTEXT: absent })]);
    const result = await summarized(
      h,
      input(fullTextSource(body(30)), { fullTextMode: "always" }),
    );
    expect(h.provider.calls).toHaveLength(2);
    const retry = h.provider.calls[1]?.request as ChatRequest;
    expect(userOf(retry).endsWith(`\n\n${GROUNDING_RETRY_INSTRUCTION}`)).toBe(
      true,
    );
    expect(retry.temperature).toBe(0);
    expect(retry.messages[0]?.content).toBe(
      h.provider.calls[0]?.request.messages[0]?.content,
    );
    expect(result.stored.groundingScore).toBe(0);
    expect(result.stored.content.confidence).toBe("low");
    expect(result.stored.warnings).toContain(GROUNDING_LOW_WARNING);
    // The cached payload is the marked one, so a later hit serves `low` too.
    const cached = h.connection.db
      .prepare("SELECT value FROM cache_entry WHERE value LIKE ?")
      .all('%"summary":%')
      .map((row) => String((row as { value: unknown }).value));
    expect(cached).toHaveLength(1);
    expect(cached[0]).toContain('"confidence":"low"');
  });

  it("keeps the retry's answer when it is grounded", async () => {
    let n = 0;
    const h = await harness([
      answering({
        FULLTEXT: () =>
          ++n === 1
            ? absent()
            : chatResponse(summaryJson({ sourceTier: "fulltext_pdf" })),
      }),
    ]);
    const result = await summarized(
      h,
      input(fullTextSource(body(30)), { fullTextMode: "always" }),
    );
    expect(h.provider.calls).toHaveLength(2);
    expect(result.stored.groundingScore).toBe(1);
    expect(result.stored.content.confidence).toBe("high");
    expect(result.stored.warnings).not.toContain(GROUNDING_LOW_WARNING);
  });

  it("marks a low abstract-tier summary low without a retry", async () => {
    const h = await harness([
      answering({ ABSTRACT: () => chatResponse(summaryJson({ quote: null })) }),
    ]);
    const result = await summarized(h, input(makeSource()));
    expect(h.provider.calls).toHaveLength(1);
    expect(result.stored.content.confidence).toBe("low");
    expect(result.stored.warnings).toContain(GROUNDING_LOW_WARNING);
  });

  it("re-sends only CHUNK_REDUCE on the chunked path's retry", async () => {
    let reduces = 0;
    const h = await harness([
      answering({
        REDUCE: () => {
          reduces += 1;
          return chatResponse(
            summaryJson({
              sourceTier: "fulltext_pdf",
              quote: "Never written.",
            }),
          );
        },
      }),
    ]);
    await summarized(
      h,
      input(fullTextSource(body(600)), { fullTextMode: "always" }),
    );
    const ks = kinds(h);
    expect(reduces).toBe(2);
    expect(ks.slice(-2)).toStrictEqual(["REDUCE", "REDUCE"]);
    expect(ks.filter((k) => k === "MAP").length).toBe(ks.length - 2);
  });
});

// ---------------------------------------------------------------------------
// 4. contentHash, the cache and the row
// ---------------------------------------------------------------------------

describe("summarizeItem — contentHash is of the text actually sent", () => {
  it("hashes the abstract when DR-1 sends a full-text item's abstract", async () => {
    const h = await harness();
    const source = fullTextSource("Short body.");
    const result = await summarized(h, input(source));
    expect(result.stored.contentHash).toBe(sha256Hex(ABSTRACT));
    expect(result.stored.contentHash).not.toBe(source.contentHash);
  });

  it("hashes the whole text on the single-shot and the uncut flat paths", async () => {
    for (const paragraphs of [30, 600]) {
      const h = await harness();
      const source = fullTextSource(body(paragraphs));
      const result = await summarized(
        h,
        input(source, { fullTextMode: "always" }),
      );
      expect(result.stored.contentHash).toBe(sha256Hex(source.text));
      expect(result.stored.truncated).toBe(false);
    }
  });

  it("hashes what the 13 chunks carried when the plan cuts the text, and says so", async () => {
    const h = await harness();
    const source = fullTextSource(body(1_600));
    const result = await summarized(
      h,
      input(source, { fullTextMode: "always" }),
    );
    const maps = h.provider.calls.filter((c) => kindOf(c.request) === "MAP");
    expect(maps).toHaveLength(13);
    // Each map's CHUNK_TEXT is its label line, then the chunk.
    const sentChunks = maps.map((c) => {
      const user = userOf(c.request);
      const inner =
        /<<<SOURCE_TEXT>>>\n([\s\S]*?)\n<<<END_SOURCE_TEXT>>>/.exec(
          user,
        )?.[1] ?? "";
      expect(inner.startsWith("[SECTION: unknown] [CHUNK ")).toBe(true);
      return inner;
    });
    expect(sentChunks).toHaveLength(13);
    expect(result.stored.truncated).toBe(true);
    expect(result.stored.contentHash).not.toBe(source.contentHash);
    const reduce = userOf(h.provider.calls.at(-1)?.request as ChatRequest);
    expect(reduce).toContain(
      "Text completeness: Section-filtered: the following sections were omitted to fit the context budget: the end of the text.",
    );
    // The hash is of the chunks' new content in document order.
    const starts = sentChunks.map((chunk) =>
      chunk.slice(chunk.indexOf("\n") + 1),
    );
    expect(source.text.startsWith(starts[0] as string)).toBe(true);
  });

  it("builds the sent text from each chunk's new content, in document order", () => {
    const text = "aaaabbbbcccc";
    const chunk = (
      index: number,
      start: number,
      contentStart: number,
      end: number,
    ) => ({
      index,
      total: 2,
      section: "x",
      labels: [],
      label: "",
      start,
      contentStart,
      end,
      text: text.slice(start, end),
      tokens: 1,
      overlapTokens: 0,
    });
    const plan = {
      kind: "chunked" as const,
      path: "section-aware" as const,
      // Synthesis order: the later span first; the first has 2 of overlap.
      chunks: [chunk(1, 6, 8, 12), chunk(2, 0, 0, 4)],
      textTokens: 3,
      chunkBudgetTokens: 1,
      maxChunks: 13,
      labelReserveTokens: 0,
      budgetScale: 1,
      lineShape: { longSegmentShare: 0, unit: "sentence" as const },
      truncated: true,
      cutSections: [],
    };
    expect(chunkedSentText(text, plan)).toBe("aaaacccc");
  });
});

describe("summarizeItem — the cache", () => {
  it("makes zero calls on a second run over an unchanged item and returns the stored row unchanged", async () => {
    const h = await harness();
    const item = input(makeSource());
    const first = await summarized(h, item);
    const second = await summarized(h, item);
    expect(h.provider.calls).toHaveLength(1);
    expect(second.fromCache).toBe(true);
    expect(second.calls).toBe(0);
    // The row read back from SQLite: `undefined` members are not stored.
    expect(second.stored).toEqual(first.stored);
    expect(h.rows()).toHaveLength(1);
  });

  it("misses when the text sent changes", async () => {
    const h = await harness();
    await summarized(h, input(makeSource()));
    await summarized(
      h,
      input(
        makeSource({
          abstract: `${ABSTRACT} More.`,
          text: `${ABSTRACT} More.`,
        }),
      ),
    );
    expect(h.provider.calls).toHaveLength(2);
  });
});

describe("summarizeItem — the row passes the redaction gate", () => {
  it("stores no synthetic key planted in a warning, and marks the row", async () => {
    const h = await harness();
    const result = await summarized(
      h,
      input(makeSource({ warnings: [`planted ${SYNTHETIC_KEY}`] })),
    );
    const rows = h.rows();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(SYNTHETIC_KEY);
    expect(JSON.stringify(result.stored)).not.toContain(SYNTHETIC_KEY);
    expect(result.stored.redaction.partlyRedacted).toBe(true);
    // Identifiers survive the gate unchanged.
    expect(result.stored.contentHash).toBe(sha256Hex(ABSTRACT));
    expect(rows[0]?.["work_key"]).toBe(`doi:10.1234/${ITEM.toLowerCase()}`);
    expect(result.stored.id).toBe(
      `doi:10.1234/${ITEM.toLowerCase()}:${PROMPTS.versions.PAPER_SUMMARY_ABSTRACT}:mock-small-2026-01-01`,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The chunked path — plan/04 P3-T25's notes of 2026-10-27
// ---------------------------------------------------------------------------

function sectionedSource(): AcquiredSource {
  const head = `${ABSTRACT}\n\n`;
  const parts: {
    heading: string;
    label: "introduction" | "methods" | "results";
    text: string;
  }[] = [
    {
      heading: "Introduction",
      label: "introduction",
      text: `Introduction\n${body(150, "introduction", 0)}\n`,
    },
    {
      heading: "Methods",
      label: "methods",
      text: `Methods\n${body(150, "methods", 150)}\n`,
    },
    {
      heading: "Results",
      label: "results",
      text: `Results\n${QUOTE}\n${body(150, "results", 300)}`,
    },
  ];
  let text = head;
  const sections: AcquiredSection[] = [];
  for (const part of parts) {
    const start = text.length;
    text += part.text;
    sections.push({
      imrad: part.label,
      labels: [part.label],
      heading: part.heading,
      text: part.text,
      start,
      end: text.length,
    });
  }
  return makeSource({
    tier: "fulltext_pdf",
    text,
    sections,
    sectionAware: true,
  });
}

function reduceSections(h: Harness): string[] {
  const user = userOf(
    h.provider.calls.find((c) => kindOf(c.request) === "REDUCE")
      ?.request as ChatRequest,
  );
  const json =
    /<<<SOURCE_TEXT>>>\n([\s\S]*?)\n<<<END_SOURCE_TEXT>>>/.exec(user)?.[1] ??
    "[]";
  return (JSON.parse(json) as { section: string }[]).map((a) => a.section);
}

describe("summarizeItem — the chunked path", () => {
  it("runs flat without imradDetectorValidated: a section-aware acquisition is sent with every chunk unknown", async () => {
    const h = await harness();
    await summarized(h, input(sectionedSource(), { fullTextMode: "always" }));
    const maps = h.provider.calls.filter((c) => kindOf(c.request) === "MAP");
    expect(maps.length).toBeGreaterThan(1);
    for (const map of maps) {
      expect(userOf(map.request)).toContain("— section: unknown");
    }
  });

  it("sorts the map answers into document order before CHUNK_REDUCE", async () => {
    const h = await harness([answering()], {
      deps: { imradDetectorValidated: true },
    });
    await summarized(h, input(sectionedSource(), { fullTextMode: "always" }));
    const mapSections = h.provider.calls
      .filter((c) => kindOf(c.request) === "MAP")
      .map((c) => /— section: ([a-z+]+)/.exec(userOf(c.request))?.[1]);
    // The chunker plans in synthesis order: results before introduction.
    expect(mapSections.indexOf("results")).toBeLessThan(
      mapSections.indexOf("introduction"),
    );
    const order = reduceSections(h);
    const firstOf = (s: string) => order.indexOf(s);
    expect(firstOf("introduction")).toBeLessThan(firstOf("methods"));
    expect(firstOf("methods")).toBeLessThan(firstOf("results"));
  });

  it("fails the item on a CHUNK_REDUCE context-length error, without halving or re-sending the maps", async () => {
    const h = await harness([
      answering({
        REDUCE: (call) =>
          new ContextLengthExceededError(
            "openrouter",
            call.request.model,
            "too long",
          ),
      }),
    ]);
    await expect(
      summarizeItem(
        input(fullTextSource(body(600)), { fullTextMode: "always" }),
        h.deps,
      ),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);
    const ks = kinds(h);
    expect(ks.filter((k) => k === "REDUCE")).toHaveLength(1);
    expect(ks.at(-1)).toBe("REDUCE");
    expect(ks.slice(0, -1).every((k) => k === "MAP")).toBe(true);
    expect(h.rows()).toHaveLength(0);
  });

  it("halves and re-plans on a single-shot context-length error, then summarizes by chunks", async () => {
    let first = true;
    const h = await harness([
      answering({
        FULLTEXT: (call) => {
          if (first) {
            first = false;
            return new ContextLengthExceededError(
              "openrouter",
              call.request.model,
              "too long",
            );
          }
          return chatResponse(summaryJson({ sourceTier: "fulltext_pdf" }));
        },
      }),
    ]);
    // About 16 000 tokens: single-shot at 24 000, chunked at the halved 12 000.
    const result = await summarized(
      h,
      input(fullTextSource(body(220)), { fullTextMode: "always" }),
    );
    const ks = kinds(h);
    expect(ks[0]).toBe("FULLTEXT");
    expect(ks.slice(1, -1).every((k) => k === "MAP")).toBe(true);
    expect(ks.at(-1)).toBe("REDUCE");
    expect(result.stored.promptId).toBe("CHUNK_REDUCE");
  });
});

// ---------------------------------------------------------------------------
// 6. COMPLETENESS_NOTE and deriveTldr
// ---------------------------------------------------------------------------

describe("completenessNote — docs/12 §5", () => {
  it("is PARTIAL with the page counts, and refuses a truncated text without them", () => {
    expect(
      completenessNote({ truncated: true }, undefined, {
        indexedPages: 3,
        totalPages: 80,
      }),
    ).toBe(
      "PARTIAL: only the first 3 of 80 pages were indexed. Later sections may be missing.",
    );
    expect(() =>
      completenessNote({ truncated: true }, undefined, undefined),
    ).toThrow(ConfigurationError);
  });

  it("refuses a page-capped full text without page counts before any call", async () => {
    const h = await harness();
    await expect(
      summarizeItem(
        input(fullTextSource(body(30), { truncated: true }), {
          fullTextMode: "always",
        }),
        h.deps,
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(h.provider.calls).toHaveLength(0);
  });
});

describe("deriveTldr — docs/07 §5.2", () => {
  const content = JSON.parse(summaryJson()) as PaperSummary;
  it("prefers the first finding, then the question's first sentence, then the theme", () => {
    expect(deriveTldr(content)).toBe("The intervention reduced the outcome.");
    expect(
      deriveTldr({
        ...content,
        keyFindings: [],
        researchQuestion: "Does it work? More text.",
      }),
    ).toBe("Does it work?");
    expect(
      deriveTldr({ ...content, keyFindings: [], researchQuestion: null }),
    ).toBe("Synthetic Trials");
    expect(
      deriveTldr({
        ...content,
        keyFindings: [],
        researchQuestion: null,
        researchTheme: null,
      }),
    ).toBe("");
  });
});

describe("createSummaryStore — docs/07 §8.3's summary table", () => {
  it("gates on write, reads back by id and by work, and refuses a corrupt row", async () => {
    const h = await harness();
    const first = await summarized(h, input(makeSource()));
    const store = createSummaryStore(h.connection);
    const planted = {
      ...first.stored,
      id: `${first.stored.id}-b`,
      warnings: [`header carried ${SYNTHETIC_KEY}`],
      generatedAtEpochMs: first.stored.generatedAtEpochMs + 1,
    };
    const written = await store.put(planted);
    expect(JSON.stringify(written)).not.toContain(SYNTHETIC_KEY);
    expect(written.redaction.partlyRedacted).toBe(true);
    expect(written.contentHash).toBe(first.stored.contentHash);
    expect(await store.get("no-such-id")).toBeUndefined();
    const listed = await store.listForWork(first.stored.workKey);
    expect(listed.map((row) => row.id)).toStrictEqual([
      planted.id,
      first.stored.id,
    ]);
    h.connection.db
      .prepare("UPDATE summary SET json = ? WHERE id = ?")
      .run("not json", planted.id);
    await expect(store.get(planted.id)).rejects.toBeInstanceOf(StorageError);
    await expect(
      store.put({ ...first.stored, workKey: "" }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

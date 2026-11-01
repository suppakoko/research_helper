/**
 * `P4-T09` — the self-critique pass, the revision loop and the warning banner
 * (`docs/12` §12, `docs/06` §12.2 and §8.5).
 *
 * No network and no model: every answer comes from `test/helpers/mockLLM.ts`,
 * and every item key, summary and draft is a synthetic fixture written here.
 * A request with a `json_schema` response format is a `SELF_CRITIQUE` call;
 * a free-text one is a report generation (the first draft or a rewrite).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  BudgetExceededError,
  ConfigurationError,
  NetworkError,
  OperationCancelledError,
  OutputTruncatedError,
  PolicyViolationError,
  UpstreamServerError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  ChatRequest,
  ModelInfo,
  Usage,
} from "../../../src/llm/types";
import type { PaperSummary, StoredSummary } from "../../../src/model/summary";
import type {
  CritiqueProblem,
  SelfCritique,
  ThemeAnalysis,
} from "../../../src/model/trend";
import {
  escapeSourceText,
  parsePromptFile,
  PROMPT_FILE_NAMES,
  type PromptTemplate,
} from "../../../src/prompts";
import { SYNTHESIS_INPUT_BUDGETS } from "../../../src/pipeline/shared/estimate";
import { createPrivacyPolicy } from "../../../src/pipeline/shared/privacyPolicy";
import type { ConfigReader } from "../../../src/pipeline/types";
import {
  composeReport,
  expectedHeadings,
  type ComposedReport,
  type ComposeInput,
  type DraftDelta,
} from "../../../src/pipeline/trendReport/compose";
import {
  combineCritiques,
  CRITIQUE_EFFORT,
  CRITIQUE_MODEL_PREF,
  CRITIQUE_PER_SECTION_WARNING,
  CRITIQUE_SCHEMA_NAME,
  CRITIQUE_TEXT_UNCHECKED_WARNING,
  critiqueReport,
  critiqueRoundsOf,
  draftForCritique,
  planCritique,
  resolveCritiqueModel,
  REVISION_NOTES_INSTRUCTION,
  revisionNotesFor,
  rewriteErrorEndsRun,
  type CritiqueDeps,
  type CritiqueInput,
  type RevisionSignal,
} from "../../../src/pipeline/trendReport/critique";
import { reportLabels } from "../../../src/pipeline/trendReport/reportLabels";
import {
  appendixC,
  qualityBanner,
} from "../../../src/pipeline/trendReport/scaffold";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
  type MockCall,
} from "../../helpers/mockLLM";

const repo = process.cwd();

function promptFile(name: string): PromptTemplate {
  return parsePromptFile({
    fileName: name,
    text: readFileSync(resolve(repo, "src/prompts", name), "utf8"),
  });
}

const CRITIQUE = promptFile(PROMPT_FILE_NAMES.SELF_CRITIQUE);
const EN = promptFile(PROMPT_FILE_NAMES.TREND_REPORT_EN);
const HEADINGS = expectedHeadings(EN);
const LABELS = reportLabels("en");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A synthetic Zotero item key: `K` and seven digits. */
function key(n: number): string {
  return `K${String(n).padStart(7, "0")}`;
}

function keys(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => key(from + i));
}

/** A synthetic payload; `pad` lengthens its `novelty` by that many characters. */
function content(
  n: number,
  pad = 0,
  over: Partial<PaperSummary> = {},
): PaperSummary {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey: key(n),
    sourceTier: "abstract",
    confidence: "medium",
    researchQuestion: `Synthetic question ${String(n)}.`,
    studyDesign: { label: "retrospective_cohort", detail: null },
    population: { kind: "human", description: "synthetic", size: "120" },
    methods: ["synthetic method"],
    keyFindings: [
      {
        statement: `FINDING-OF-${key(n)} improved the synthetic outcome`,
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport: null,
      },
    ],
    effectSizes: [{ metric: "OR", value: `EFFECT-OF-${key(n)}` }],
    limitations: [],
    novelty: pad > 0 ? "x".repeat(pad) : null,
    keywords: ["synthetic"],
    researchTheme: "Synthetic Theme",
    citationWorthiness: { score: 3, reason: "synthetic" },
    ...over,
  };
}

function stored(payload: PaperSummary): StoredSummary {
  return {
    id: `work-${payload.itemKey}:1.0.0:model`,
    workKey: `work-${payload.itemKey}`,
    zoteroItemKey: payload.itemKey,
    content: payload,
    inputScope: { kind: "abstract" },
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptVersion: "1.0.0",
    providerId: "openrouter",
    modelId: "summary-model",
    temperature: 0,
    usage: undefined,
    generatedAtEpochMs: 0,
    sourceItemVersion: undefined,
    contentHash: "0".repeat(64),
    truncated: false,
    groundingScore: undefined,
    warnings: [],
    redaction: { partlyRedacted: false, redactedStrings: 0, droppedFields: 0 },
  };
}

function analysis(themeId: string, cited: readonly string[]): ThemeAnalysis {
  return {
    themeId,
    name: `Synthetic Theme ${themeId}`,
    narrative: `Work in this theme ${cited.map((k) => `[[${k}]]`).join(" ")}.`,
    representativePapers: cited
      .slice(0, 6)
      .map((itemKey) => ({ itemKey, why: "Representative." })),
    trajectory: "insufficient temporal spread to assess",
  };
}

/** The 12-paper compose input the drafts are made from. */
function composeInput(): ComposeInput {
  return {
    language: "en",
    collectionName: "Synthetic collection",
    userTopic: "synthetic topic",
    totalCount: 12,
    analysed: keys(1, 12).map((itemKey) => ({
      itemKey,
      year: 2020,
      sourceTier: "abstract",
      libraryCatalog: undefined,
    })),
    excluded: [],
    searchRuns: [],
    themes: [
      { analysis: analysis("T1", keys(1, 6)), memberCount: 6 },
      { analysis: analysis("T2", keys(7, 12)), memberCount: 6 },
    ],
    digests: [],
    targetWords: 0,
    duplicateOf: new Map(),
  };
}

/**
 * A report in the template's structure. Section `i` (1-based) cites
 * `cite(i)`; §11 always cites `key(12)`, so a key only §11 names is visible.
 */
function reportText(
  cite: (section: number) => readonly string[] = () => [key(1), key(2)],
  body: (section: number) => string = (section) =>
    `The studies reported a 12% change ${cite(section)
      .map((k) => `[[${k}]]`)
      .join(" ")}.`,
): string {
  return HEADINGS.map((heading, index) => {
    const section = index + 1;
    const text = section === 11 ? `1. [[${key(12)}]] Synthetic` : body(section);
    return `## ${heading}\n\n${text}\n`;
  }).join("\n");
}

/** A report missing `## 7.`: it fails the section check. */
function brokenReport(): string {
  return HEADINGS.filter((h) => !h.startsWith("7."))
    .map((h) => `## ${h}\n\nBroken [[${key(3)}]].\n`)
    .join("\n");
}

const USAGE: Usage = {
  inputTokens: 1_000,
  outputTokens: 500,
  totalTokens: 1_500,
  costUsd: 0.02,
};

function fakeBudget(): BudgetGuard & { reserved: number } {
  const guard = {
    reserved: 0,
    spentUsd: 0,
    limitUsd: undefined,
    reserve(): void {
      guard.reserved += 1;
    },
    settle(): void {},
  };
  return guard;
}

function fakePool() {
  const pool = {
    acquired: 0,
    released: 0,
    acquire: () => {
      pool.acquired += 1;
      return Promise.resolve(() => {
        pool.released += 1;
      });
    },
  };
  return pool;
}

function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const logger = {
    lines,
    child: () => logger,
    error: (msg: string) => void lines.push(`error ${msg}`),
    warn: (msg: string) => void lines.push(`warn ${msg}`),
    info: (msg: string) => void lines.push(`info ${msg}`),
    debug: () => undefined,
    time: <T>(_msg: string, fn: () => Promise<T>) => fn(),
  };
  return logger;
}

function config(values: Record<string, unknown> = {}): ConfigReader {
  const all: Record<string, unknown> = {
    reportMaxCritiqueRounds: 1,
    reportCritiqueModel: "",
    geminiPaidTier: false,
    logRequestBodies: false,
    ...values,
  };
  return { get: (name: string) => all[name] } as unknown as ConfigReader;
}

const SAFE_POLICY: ModelInfo["dataPolicy"] = {
  trainsOnInputByDefault: "no",
  retention: { days: 30, note: "synthetic" },
};

function problem(
  severity: CritiqueProblem["severity"],
  quote = `A ${severity} claim.`,
  over: Partial<CritiqueProblem> = {},
): CritiqueProblem {
  return {
    type: "unsupported",
    severity,
    section: "1. Executive Summary",
    quote,
    explanation: `Synthetic ${severity} explanation.`,
    suggestedFix: "weaken_claim",
    ...over,
  };
}

/** A problem the model gave no section. */
function unsectioned(severity: CritiqueProblem["severity"]): CritiqueProblem {
  const { section: _section, ...rest } = problem(severity, "Q");
  return rest;
}

function critiqueAnswer(
  problems: readonly CritiqueProblem[],
  verdict: SelfCritique["verdict"] = problems.length === 0 ? "pass" : "revise",
): ReturnType<typeof chatResponse> {
  return chatResponse(JSON.stringify({ verdict, problems }), { usage: USAGE });
}

function isCritique(request: ChatRequest): boolean {
  return request.responseFormat?.kind === "json_schema";
}

function userText(call: MockCall | undefined): string {
  return call?.request.messages[1]?.content ?? "";
}

/** The `"itemKey":"…"` values a critique request's evidence carried, in order. */
function evidenceKeys(call: MockCall): string[] {
  const user = userText(call);
  const start = user.indexOf("EVIDENCE BASE");
  const end = user.indexOf("VALID ITEM KEYS:");
  return Array.from(
    user.slice(start, end).matchAll(/"itemKey":"([A-Z0-9]{8})"/g),
    (m) => m[1] as string,
  );
}

function validKeysLine(call: MockCall): string {
  return /VALID ITEM KEYS: (.*)/.exec(userText(call))?.[1] ?? "";
}

/** The draft the compose stage would hand on, made by `composeReport` itself. */
async function makeDraft(
  text: string = reportText(),
  input: ComposeInput = composeInput(),
): Promise<ComposedReport> {
  const provider = mockLLM([chatResponse(text, { usage: USAGE })], {
    streaming: true,
  });
  const router = mockLLMRouter(
    [provider],
    mockSettings({ keyPresent: { openrouter: true } }),
  );
  const outcome = await composeReport(input, {
    llm: router,
    budget: fakeBudget(),
    token: createCancellationTokenSource().token,
    pool: fakePool(),
    reportPrompt: EN,
  });
  if (outcome.status !== "composed") throw new Error("fixture draft failed");
  return outcome;
}

interface Script {
  /** The answer to the n-th critique request (1-based). */
  readonly critique?: (
    n: number,
    call: MockCall,
  ) => ReturnType<typeof chatResponse> | Error;
  /** The answer to the n-th report generation (1-based). */
  readonly report?: (
    n: number,
    call: MockCall,
  ) => ReturnType<typeof chatResponse> | Error;
}

function setup(
  script: Script = {},
  options: {
    readonly config?: Record<string, unknown>;
    readonly over?: Partial<CritiqueDeps>;
    readonly settings?: Parameters<typeof mockSettings>[0];
    readonly mode?: "strict" | "balanced" | "full";
  } = {},
) {
  let critiques = 0;
  let reports = 0;
  const provider = mockLLM(
    [
      (call) => {
        if (isCritique(call.request)) {
          critiques += 1;
          return (
            script.critique?.(critiques, call) ??
            critiqueAnswer([problem("high")])
          );
        }
        reports += 1;
        return (
          script.report?.(reports, call) ??
          chatResponse(
            reportText(() => [key(3)]),
            { usage: USAGE },
          )
        );
      },
    ],
    { streaming: true },
  );
  const router = mockLLMRouter(
    [provider],
    mockSettings({
      keyPresent: { openrouter: true },
      summaryModel: "summary-model",
      reportModel: "report-model",
      ...options.settings,
    }),
  );
  const budget = fakeBudget();
  const pool = fakePool();
  const source = createCancellationTokenSource();
  const drafts: DraftDelta[] = [];
  const signals: RevisionSignal[] = [];
  const logger = recordingLogger();
  const infoAsked: string[] = [];
  const deps: CritiqueDeps = {
    llm: router,
    budget,
    token: source.token,
    pool,
    reportPrompt: EN,
    critiquePrompt: CRITIQUE,
    privacy: createPrivacyPolicy(options.mode ?? "balanced"),
    config: config(options.config),
    modelInfo: (_providerId, modelId) => {
      infoAsked.push(modelId);
      return mockModel(modelId, { dataPolicy: SAFE_POLICY });
    },
    onDraft: (delta) => drafts.push(delta),
    onRevision: (signal) => signals.push(signal),
    logger,
    ...options.over,
  };
  return {
    provider,
    budget,
    pool,
    source,
    deps,
    drafts,
    signals,
    logger,
    infoAsked,
  };
}

const SUMMARIES = keys(1, 12).map((k, i) => stored(content(i + 1)));

async function input(
  over: Partial<CritiqueInput> = {},
  text?: string,
): Promise<CritiqueInput> {
  return {
    draft: await makeDraft(text),
    compose: composeInput(),
    summaries: SUMMARIES,
    ...over,
  };
}

function critiqueCalls(calls: readonly MockCall[]): MockCall[] {
  return calls.filter((call) => isCritique(call.request));
}

function reportCalls(calls: readonly MockCall[]): MockCall[] {
  return calls.filter((call) => !isCritique(call.request));
}

// ---------------------------------------------------------------------------
// 1. Rounds and calls — Done when 1 and 2
// ---------------------------------------------------------------------------

describe("P4-T09 steps 2 and 5 — rounds from report.maxCritiqueRounds, one rewrite per high round", () => {
  it.each([
    [0, 0],
    [1, 2],
    [2, 4],
  ])(
    "with a high problem every round and evidence that fits one call, rounds %i make exactly %i calls",
    async (rounds, expected) => {
      const { provider, deps } = setup(
        {},
        { config: { reportMaxCritiqueRounds: rounds } },
      );
      const result = await critiqueReport(await input(), deps);
      expect(provider.calls).toHaveLength(expected);
      expect(critiqueCalls(provider.calls)).toHaveLength(rounds);
      expect(reportCalls(provider.calls)).toHaveLength(rounds);
      // Critique, rewrite, critique, rewrite: each round critiques, then rewrites.
      provider.calls.forEach((call, index) =>
        expect(isCritique(call.request)).toBe(index % 2 === 0),
      );
      expect(result.outcome.rounds).toBe(rounds);
      expect(result.rewrites).toBe(rounds);
      expect(result.calls).toBe(expected);
      expect(result.outcome.revisedAfterLastCritique).toBe(rounds > 0);
    },
  );

  it("rounds 0 skips the pass: the draft is returned as it came, with no request and no model", async () => {
    const { provider, deps, infoAsked } = setup(
      {},
      { config: { reportMaxCritiqueRounds: 0 } },
    );
    const given = await input();
    const result = await critiqueReport(given, deps);
    expect(provider.calls).toHaveLength(0);
    expect(infoAsked).toEqual([]);
    expect(result.draft).toBe(given.draft);
    expect(result.outcome).toEqual({
      rounds: 0,
      unresolved: [],
      revisedAfterLastCritique: false,
    });
    expect(result.model).toBeUndefined();
    expect(result.prompts).toEqual([]);
    expect(appendixC(result.outcome, LABELS)).toContain(LABELS.appendixCNotRun);
    expect(qualityBanner(result.outcome, LABELS)).toBe("");
  });

  it("against a pass verdict with no problem, rounds 2 makes exactly 1 call and ships the draft unchanged", async () => {
    const { provider, deps } = setup(
      { critique: () => critiqueAnswer([], "pass") },
      { config: { reportMaxCritiqueRounds: 2 } },
    );
    const given = await input();
    const result = await critiqueReport(given, deps);
    expect(provider.calls).toHaveLength(1);
    expect(result.draft).toBe(given.draft);
    expect(result.outcome).toEqual({
      rounds: 1,
      unresolved: [],
      revisedAfterLastCritique: false,
    });
    expect(qualityBanner(result.outcome, LABELS)).toBe("");
    expect(appendixC(result.outcome, LABELS)).toContain(LABELS.appendixCNone);
  });

  it("a medium-only critique triggers no rewrite; the medium problem stays unresolved", async () => {
    const medium = problem("medium");
    const { provider, deps } = setup(
      { critique: () => critiqueAnswer([medium, problem("low")]) },
      { config: { reportMaxCritiqueRounds: 2 } },
    );
    const result = await critiqueReport(await input(), deps);
    expect(provider.calls).toHaveLength(1);
    expect(reportCalls(provider.calls)).toHaveLength(0);
    expect(result.rewrites).toBe(0);
    expect(result.outcome.unresolved).toEqual([medium, problem("low")]);
    expect(result.outcome.revisedAfterLastCritique).toBe(false);
  });

  it("a high problem triggers exactly one rewrite in its round; a later medium-only round triggers none", async () => {
    const { provider, deps } = setup(
      {
        critique: (n) =>
          critiqueAnswer(
            n === 1
              ? [problem("high"), problem("high", "Another.")]
              : [problem("medium")],
          ),
      },
      { config: { reportMaxCritiqueRounds: 2 } },
    );
    const result = await critiqueReport(await input(), deps);
    expect(provider.calls.map((c) => isCritique(c.request))).toEqual([
      true,
      false,
      true,
    ]);
    expect(result.rewrites).toBe(1);
    expect(result.outcome).toEqual({
      rounds: 2,
      unresolved: [problem("medium")],
      revisedAfterLastCritique: false,
    });
  });

  it("the verdict decides nothing: a high problem under 'pass' rewrites, and 'reject' with none does not", async () => {
    const one = setup({
      critique: () => critiqueAnswer([problem("high")], "pass"),
    });
    const rewritten = await critiqueReport(await input(), one.deps);
    expect(rewritten.rewrites).toBe(1);
    const two = setup({
      critique: () => critiqueAnswer([problem("low")], "reject"),
    });
    const kept = await critiqueReport(await input(), two.deps);
    expect(kept.rewrites).toBe(0);
    expect(two.provider.calls).toHaveLength(1);
  });

  it("a rewrite that passes is the shipped draft, and its stream reaches onDraft after a rewrite-started signal", async () => {
    const rewriteText = reportText(() => [key(5)]);
    const { deps, drafts, signals } = setup({
      report: () => chatResponse(rewriteText, { usage: USAGE }),
    });
    const given = await input();
    const result = await critiqueReport(given, deps);
    expect(result.draft).not.toBe(given.draft);
    expect(result.draft.markdown).toBe(rewriteText);
    expect(drafts.map((d) => d.deltaText).join("")).toBe(rewriteText);
    expect(signals).toEqual([{ kind: "rewrite-started", round: 1 }]);
  });

  it("sums the usage of the critiques and the rewrites, and names SELF_CRITIQUE with its model", async () => {
    const { deps } = setup({}, { config: { reportMaxCritiqueRounds: 2 } });
    const result = await critiqueReport(await input(), deps);
    expect(result.usage).toEqual({
      inputTokens: 4_000,
      outputTokens: 2_000,
      totalTokens: 6_000,
      costUsd: 0.08,
    });
    expect(result.prompts).toEqual([
      {
        promptId: "SELF_CRITIQUE",
        promptVersion: CRITIQUE.version,
        modelId: "summary-model",
        temperature: 0,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. The request — step 5's settings, step 4's evidence
// ---------------------------------------------------------------------------

describe("P4-T09 steps 4 and 5 — every critique request: temperature 0, effort low, budgeted, schema-bound", () => {
  it("sends SELF_CRITIQUE's settings, its schema, the budget, and one pool permit per request", async () => {
    const { provider, deps, pool, budget } = setup(
      {},
      { config: { reportMaxCritiqueRounds: 2 } },
    );
    await critiqueReport(await input(), deps);
    const critiques = critiqueCalls(provider.calls);
    expect(critiques).toHaveLength(2);
    for (const call of critiques) {
      expect(call.request.temperature).toBe(0);
      expect(call.request.effort).toBe(CRITIQUE_EFFORT);
      expect(CRITIQUE_EFFORT).toBe("low");
      expect(call.request.maxOutputTokens).toBe(2_500);
      expect(call.request.responseFormat).toMatchObject({
        kind: "json_schema",
        name: CRITIQUE_SCHEMA_NAME,
      });
      expect(call.request.responseFormat).toHaveProperty(
        "schema",
        CRITIQUE.schema,
      );
      expect(call.ctx.budget).toBe(deps.budget);
      expect(call.request.messages[0]?.content).toBe(CRITIQUE.system);
    }
    // Two critiques and two rewrites, each holding one permit.
    expect(pool.acquired).toBe(4);
    expect(pool.released).toBe(4);
    expect(budget.reserved).toBe(4);
  });

  it("carries the summaries of the items §1–§10 cite, and only those: not every summary, not a key only §11 names", async () => {
    const { provider, deps } = setup({
      critique: () => critiqueAnswer([], "pass"),
    });
    const given = await input(
      {},
      reportText((section) => (section === 4 ? [key(4), key(1)] : [key(1)])),
    );
    await critiqueReport(given, deps);
    const [call] = provider.calls;
    expect(call).toBeDefined();
    expect(evidenceKeys(call as MockCall)).toEqual([key(1), key(4)]);
    expect(validKeysLine(call as MockCall)).toBe(`${key(1)}, ${key(4)}`);
    const user = userText(call);
    expect(user).not.toContain(key(12));
    expect(user).not.toContain("## 11. Bibliography");
    expect(user).toContain("## 10. Notable Papers");
    expect(user).toContain(
      escapeSourceText(draftForCritique(given.draft.sections)),
    );
  });

  it("sends a withheld summary as the theme stage does: findings and effect sizes empty", async () => {
    const { provider, deps } = setup({
      critique: () => critiqueAnswer([], "pass"),
    });
    const low = stored(content(1, 0, { confidence: "low" }));
    await critiqueReport(
      await input({ summaries: [low, ...SUMMARIES.slice(1)] }),
      deps,
    );
    const user = userText(provider.calls[0]);
    expect(user).not.toContain(`FINDING-OF-${key(1)}`);
    expect(user).not.toContain(`EFFECT-OF-${key(1)}`);
    expect(user).toContain(`FINDING-OF-${key(2)}`);
  });

  it("a cited set over budget makes one critique call per section, each with that section's cited summaries", async () => {
    const big = keys(1, 12).map((k, i) => stored(content(i + 1, 3_000)));
    const one = estTokens(escapeSourceText(JSON.stringify(big[0]?.content)));
    const { provider, deps } = setup({
      critique: (n) => critiqueAnswer(n === 3 ? [unsectioned("medium")] : []),
    });
    // Each section cites two keys of its own; the whole draft cites 20.
    const cite = (section: number): readonly string[] =>
      section <= 6
        ? [key(section * 2 - 1), key(section * 2)]
        : [key(((section * 2 - 1) % 12) + 1), key(((section * 2) % 12) + 1)];
    const given = await input(
      { summaries: big, inputBudget: one * 5 },
      reportText(cite),
    );
    const result = await critiqueReport(given, deps);
    const critiques = critiqueCalls(provider.calls);
    expect(critiques).toHaveLength(10);
    critiques.forEach((call) => {
      const section = Number(/## (\d+)\./.exec(userText(call))?.[1]);
      expect(evidenceKeys(call)).toEqual([...cite(section)]);
    });
    expect(result.warnings).toContain(CRITIQUE_PER_SECTION_WARNING);
    expect(result.critiqueRequests).toBe(10);
    // Combined in section order; a problem without a section gets its unit's heading.
    expect(result.outcome.unresolved).toHaveLength(1);
    expect(result.outcome.unresolved[0]?.section).toBeDefined();
  });

  it("a section too large alone is cut into runs of paragraphs; a paragraph that cannot fit is left out and named in a warning", async () => {
    const big = keys(1, 12).map((k, i) => stored(content(i + 1, 3_000)));
    const one = estTokens(escapeSourceText(JSON.stringify(big[0]?.content)));
    const body = (section: number): string =>
      section === 4
        ? [
            `First [[${key(1)}]] [[${key(2)}]].`,
            `Second [[${key(3)}]] [[${key(4)}]].`,
            `Third ${keys(5, 11)
              .map((k) => `[[${k}]]`)
              .join(" ")}.`,
          ].join("\n\n")
        : `Plain [[${key(section)}]].`;
    const { provider, deps, logger } = setup({
      critique: () => critiqueAnswer([], "pass"),
    });
    const given = await input(
      { summaries: big, inputBudget: one * 3 },
      reportText(undefined, body),
    );
    const plan = planCritique(
      given.draft.sections,
      new Map(big.map((s) => [s.content.itemKey, s])),
      one * 3,
    );
    expect(plan.mode).toBe("sections");
    expect(plan.uncheckedParagraphs).toBe(1);
    const fourth = plan.units.filter((unit) => unit.section === 4);
    expect(fourth.map((unit) => unit.keys)).toEqual([
      [key(1), key(2)],
      [key(3), key(4)],
    ]);
    const result = await critiqueReport(given, deps);
    expect(critiqueCalls(provider.calls)).toHaveLength(plan.units.length);
    expect(result.warnings).toEqual([
      CRITIQUE_PER_SECTION_WARNING,
      CRITIQUE_TEXT_UNCHECKED_WARNING,
    ]);
    expect(logger.lines.some((line) => line.includes("not critiqued"))).toBe(
      true,
    );
  });

  it("the default budget is SELF_CRITIQUE's 60 000 tokens, and a budget above it is refused", async () => {
    expect(SYNTHESIS_INPUT_BUDGETS.SELF_CRITIQUE).toBe(60_000);
    const { deps } = setup();
    await expect(
      critiqueReport(await input({ inputBudget: 60_001 }), deps),
    ).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 3. The model — step 3
// ---------------------------------------------------------------------------

describe("P4-T09 step 3 — the critique model: report.critiqueModel, else summaryModel, on the active provider", () => {
  it("a set report.critiqueModel is used", async () => {
    const { provider, deps, infoAsked } = setup(
      {},
      { config: { reportCritiqueModel: " critic-model " } },
    );
    const result = await critiqueReport(await input(), deps);
    expect(critiqueCalls(provider.calls)[0]?.request.model).toBe(
      "critic-model",
    );
    expect(result.model).toEqual({
      providerId: "openrouter",
      modelId: "critic-model",
      fromPref: CRITIQUE_MODEL_PREF,
    });
    expect(infoAsked).toEqual(["critic-model"]);
    // The rewrite stays on the report model.
    expect(reportCalls(provider.calls)[0]?.request.model).toBe("report-model");
  });

  it("an empty one resolves to summaryModel on the active provider, never the report model", async () => {
    const { provider, deps } = setup();
    const result = await critiqueReport(await input(), deps);
    expect(critiqueCalls(provider.calls)[0]?.request.model).toBe(
      "summary-model",
    );
    expect(result.model?.fromPref).toBe("summaryModel");
    expect(result.model?.providerId).toBe("openrouter");
  });

  it("an empty one with no summaryModel follows the standard chain to <provider>.model", () => {
    const router = mockLLMRouter(
      [],
      mockSettings({ reportModel: "report-model" }),
    );
    expect(resolveCritiqueModel(router, config())).toEqual({
      providerId: "openrouter",
      modelId: "openrouter-default-model",
      fromPref: "openrouter.model",
    });
  });

  it("assertModelAllowed checks the critique model before any request: a refused model sends nothing", async () => {
    const { provider, deps } = setup({}, { mode: "strict" });
    await expect(
      critiqueReport(await input(), {
        ...deps,
        modelInfo: (_p, id) => mockModel(id),
      }),
    ).rejects.toThrow(PolicyViolationError);
    expect(provider.calls).toHaveLength(0);
  });

  it("a model the mode passes only after a confirmation needs the run's confirmation", async () => {
    const training = (_p: string, id: string) =>
      mockModel(id, {
        dataPolicy: {
          trainsOnInputByDefault: "yes",
          retention: { days: 30, note: "synthetic" },
        },
      });
    const refused = setup({}, { mode: "full" });
    await expect(
      critiqueReport(await input(), { ...refused.deps, modelInfo: training }),
    ).rejects.toThrow(PolicyViolationError);
    expect(refused.provider.calls).toHaveLength(0);
    const confirmed = setup({}, { mode: "full" });
    const result = await critiqueReport(await input(), {
      ...confirmed.deps,
      modelInfo: training,
      modelConfirmed: true,
    });
    expect(result.policyWarnings).toContain("may-train-on-input");
  });

  it("critiqueRoundsOf reads the stored rounds; anything but a whole number from 0 reads as 0", () => {
    expect(critiqueRoundsOf(config({ reportMaxCritiqueRounds: 2 }))).toBe(2);
    expect(critiqueRoundsOf(config({ reportMaxCritiqueRounds: 0 }))).toBe(0);
    expect(critiqueRoundsOf(config({ reportMaxCritiqueRounds: 1.5 }))).toBe(0);
    expect(critiqueRoundsOf(config({ reportMaxCritiqueRounds: -1 }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The banner and Appendix C — step 6
// ---------------------------------------------------------------------------

describe("P4-T09 step 6 — remaining problems become the banner and Appendix C's rows", () => {
  it("unresolved problems produce the banner and their rows; after a rewrite that followed the last critique, the banner says it was not re-checked", async () => {
    const high = problem("high", "The cohort tripled survival.");
    const medium = problem("medium", "Most studies agree.");
    const { deps } = setup({ critique: () => critiqueAnswer([high, medium]) });
    const result = await critiqueReport(await input(), deps);
    expect(result.outcome).toEqual({
      rounds: 1,
      unresolved: [high, medium],
      revisedAfterLastCritique: true,
    });
    const banner = qualityBanner(result.outcome, LABELS);
    expect(banner).toContain(LABELS.bannerTitle);
    expect(banner).toContain(LABELS.bannerFlaggedMany.replace("{count}", "2"));
    expect(banner).toContain(LABELS.bannerSeeAppendix);
    expect(banner).toContain(LABELS.bannerNotRechecked);
    expect(banner).not.toContain(LABELS.bannerRevisionNotApplied);
    const appendix = appendixC(result.outcome, LABELS);
    expect(appendix).toContain(LABELS.bannerNotRechecked);
    expect(appendix).toContain("The cohort tripled survival.");
    expect(appendix).toContain("Most studies agree.");
  });

  it("with no rewrite after the last critique, the banner lists the problems without the not-re-checked line", async () => {
    const { deps } = setup({
      critique: () => critiqueAnswer([problem("medium")]),
    });
    const result = await critiqueReport(await input(), deps);
    const banner = qualityBanner(result.outcome, LABELS);
    expect(banner).toContain(LABELS.bannerFlaggedOne);
    expect(banner).not.toContain(LABELS.bannerNotRechecked);
  });

  it("nothing is hidden: every problem of the last critique is unresolved, its text as the model wrote it", async () => {
    const odd = problem(
      "low",
      "A quote that is <b>not</b> in the draft [[NOTAKEY1]].",
    );
    const { deps } = setup({ critique: () => critiqueAnswer([odd]) });
    const result = await critiqueReport(await input(), deps);
    expect(result.outcome.unresolved).toEqual([odd]);
  });
});

// ---------------------------------------------------------------------------
// 5. A rewrite that fails the section check twice — step 7
// ---------------------------------------------------------------------------

describe("P4-T09 step 7 — a rewrite failing the section check twice keeps the earlier draft (item 312(b), 314(a), 314(c))", () => {
  it("ships the earlier draft byte for byte, makes no further critique call, does not stop, and the banner says the revision could not be applied", async () => {
    const high = problem("high");
    const { provider, deps, signals, logger } = setup(
      {
        critique: () => critiqueAnswer([high]),
        report: () => chatResponse(brokenReport(), { usage: USAGE }),
      },
      { config: { reportMaxCritiqueRounds: 2 } },
    );
    const given = await input();
    const before = given.draft.markdown;
    const result = await critiqueReport(given, deps);
    // One critique, then the rewrite's answer and its one fresh generation; no second round.
    expect(provider.calls.map((c) => isCritique(c.request))).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.draft).toBe(given.draft);
    expect(result.draft.markdown).toBe(before);
    expect(result.outcome).toEqual({
      rounds: 1,
      unresolved: [high],
      revisedAfterLastCritique: false,
      revisionNotApplied: true,
    });
    expect(result.calls).toBe(3);
    // The failed rewrite's usage counts: one critique and two generations.
    expect(result.usage.inputTokens).toBe(3_000);
    const banner = qualityBanner(result.outcome, LABELS);
    expect(banner).toContain(LABELS.bannerRevisionNotApplied);
    expect(banner).not.toContain(LABELS.bannerNotRechecked);
    expect(appendixC(result.outcome, LABELS)).toContain(
      LABELS.bannerRevisionNotApplied,
    );
    // The window is told to show the kept draft again (item 314(c)).
    expect(signals).toEqual([
      { kind: "rewrite-started", round: 1 },
      { kind: "rewrite-not-applied", round: 1, markdown: before },
    ]);
    expect(
      logger.lines.some((line) => line.includes("earlier draft is kept")),
    ).toBe(true);
  });

  it("after a passing first rewrite, a failing second one keeps the first rewrite, the draft the last critique read", async () => {
    const first = reportText(() => [key(6)]);
    const { deps } = setup(
      {
        report: (n) =>
          chatResponse(n === 1 ? first : brokenReport(), { usage: USAGE }),
      },
      { config: { reportMaxCritiqueRounds: 2 } },
    );
    const result = await critiqueReport(await input(), deps);
    expect(result.draft.markdown).toBe(first);
    expect(result.outcome.rounds).toBe(2);
    expect(result.outcome.revisionNotApplied).toBe(true);
    expect(result.outcome.revisedAfterLastCritique).toBe(false);
  });

  it("a revision callback that throws is logged and ignored", async () => {
    const { deps, logger } = setup(
      { report: () => chatResponse(brokenReport(), { usage: USAGE }) },
      {
        over: {
          onRevision: () => {
            throw new Error("window gone");
          },
        },
      },
    );
    const result = await critiqueReport(await input(), deps);
    expect(result.outcome.revisionNotApplied).toBe(true);
    expect(
      logger.lines.filter((line) => line.includes("revision callback threw")),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. The rewrite's notes, and the errors
// ---------------------------------------------------------------------------

describe("P4-T09 step 5 — the rewrite is a fresh generation with the high problems in {{REVISION_NOTES}}", () => {
  it("sends the instruction and the high problems as JSON, never the medium or low ones", async () => {
    const high = problem("high", "Survival tripled <<< injected.");
    const { provider, deps } = setup({
      critique: () => critiqueAnswer([high, problem("medium", "MEDIUM-QUOTE")]),
    });
    await critiqueReport(await input(), deps);
    const rewrite = reportCalls(provider.calls)[0];
    const user = userText(rewrite);
    expect(user).toContain(REVISION_NOTES_INSTRUCTION);
    expect(user).toContain(escapeSourceText(revisionNotesFor([high])));
    expect(user).not.toContain("MEDIUM-QUOTE");
    // The whole template is sent again, not an edit of the draft.
    expect(user).toContain("THEME ANALYSES (JSON):");
    expect(user).not.toContain("The studies reported a 12% change");
  });

  it("revisionNotesFor lists type, section, quote, explanation and fix as JSON after the instruction", () => {
    const notes = revisionNotesFor([problem("high", "Q1")]);
    const [instruction, label, json] = notes.split("\n");
    expect(instruction).toBe(REVISION_NOTES_INSTRUCTION);
    expect(label).toBe("PROBLEMS (JSON):");
    expect(JSON.parse(json ?? "")).toEqual([
      {
        type: "unsupported",
        section: "1. Executive Summary",
        quote: "Q1",
        explanation: "Synthetic high explanation.",
        suggestedFix: "weaken_claim",
      },
    ]);
    expect(() => revisionNotesFor([])).toThrow(RangeError);
  });

  it("combineCritiques keeps every problem in unit order, fills a missing section, and takes the worst verdict", () => {
    const withSection = problem("low", "A");
    const { section: _drop, ...noSection } = problem("high", "B");
    const combined = combineCritiques([
      {
        unit: { heading: "1. Executive Summary" },
        critique: { verdict: "pass", problems: [withSection] },
      },
      {
        unit: { heading: "4. Major Research Themes" },
        critique: { verdict: "reject", problems: [noSection] },
      },
      {
        unit: { heading: "5. Methodological Trends" },
        critique: { verdict: "revise", problems: [] },
      },
    ]);
    expect(combined.verdict).toBe("reject");
    expect(combined.problems).toEqual([
      withSection,
      { ...noSection, section: "4. Major Research Themes" },
    ]);
  });
});

describe("item 317(b) — a rewrite's own error keeps the earlier draft; a critique error still fails", () => {
  const notApplied: readonly [string, () => Error][] = [
    [
      "a truncated answer",
      () => new OutputTruncatedError("openrouter", "report-model", "cut off"),
    ],
    ["a network error", () => new NetworkError("synthetic network failure")],
    [
      "an upstream 5xx",
      () => new UpstreamServerError(503, "synthetic upstream failure"),
    ],
  ];
  for (const [name, error] of notApplied) {
    it(`${name} in the rewrite ships the earlier draft with the not-applied banner`, async () => {
      const high = problem("high");
      const { provider, deps, signals, logger } = setup(
        { critique: () => critiqueAnswer([high]), report: () => error() },
        { config: { reportMaxCritiqueRounds: 2 } },
      );
      const given = await input();
      const result = await critiqueReport(given, deps);
      expect(result.draft).toBe(given.draft);
      expect(result.outcome).toEqual({
        rounds: 1,
        unresolved: [high],
        revisedAfterLastCritique: false,
        revisionNotApplied: true,
      });
      // No second round after a rewrite that was not applied.
      expect(critiqueCalls(provider.calls)).toHaveLength(1);
      expect(signals).toEqual([
        { kind: "rewrite-started", round: 1 },
        {
          kind: "rewrite-not-applied",
          round: 1,
          markdown: given.draft.markdown,
        },
      ]);
      expect(
        logger.lines.some((line) => line.includes("the rewrite failed")),
      ).toBe(true);
      expect(qualityBanner(result.outcome, LABELS)).toContain(
        LABELS.bannerRevisionNotApplied,
      );
    });
  }

  it("a cancel, a budget refusal, a rejected key or a defect in the rewrite still ends the stage", async () => {
    const ending: (() => Error)[] = [
      () => new BudgetExceededError("synthetic refusal"),
      () => new AuthenticationError(401, "synthetic rejected key"),
      () => new PolicyViolationError("synthetic policy refusal"),
      () => new TypeError("synthetic defect"),
    ];
    for (const make of ending) {
      const thrown = make();
      const { deps } = setup({ report: () => thrown });
      await expect(critiqueReport(await input(), deps)).rejects.toBe(thrown);
    }
    const { deps, source } = setup({
      report: () => {
        source.cancel({ kind: "user" });
        return new NetworkError("synthetic failure after a cancel");
      },
    });
    await expect(critiqueReport(await input(), deps)).rejects.toBeDefined();
  });

  it("rewriteErrorEndsRun: the stage-ending errors, and a cancelled token whatever the error", () => {
    const live = { isCancellationRequested: false };
    expect(
      rewriteErrorEndsRun(new OperationCancelledError({ kind: "user" }), live),
    ).toBe(true);
    expect(rewriteErrorEndsRun(new BudgetExceededError("x"), live)).toBe(true);
    expect(rewriteErrorEndsRun(new AuthenticationError(401, "x"), live)).toBe(
      true,
    );
    expect(rewriteErrorEndsRun(new ConfigurationError("x"), live)).toBe(true);
    expect(rewriteErrorEndsRun(new PolicyViolationError("x"), live)).toBe(true);
    expect(rewriteErrorEndsRun(new Error("defect"), live)).toBe(true);
    expect(
      rewriteErrorEndsRun(new OutputTruncatedError("p", "m", "x"), live),
    ).toBe(false);
    expect(rewriteErrorEndsRun(new NetworkError("x"), live)).toBe(false);
    expect(
      rewriteErrorEndsRun(new NetworkError("x"), {
        isCancellationRequested: true,
      }),
    ).toBe(true);
  });

  it("a failed critique request still fails the stage: no banner says the review failed", async () => {
    const { deps } = setup({
      critique: () =>
        new OutputTruncatedError("openrouter", "summary-model", "cut off"),
    });
    await expect(critiqueReport(await input(), deps)).rejects.toBeInstanceOf(
      OutputTruncatedError,
    );
  });
});

describe("P4-T09 — errors are the caller's: nothing is swallowed but a rewrite's structure stop", () => {
  it("a budget refusal on the critique propagates, so the job pauses with the stage pending", async () => {
    const { deps } = setup({
      critique: () => new BudgetExceededError("synthetic refusal"),
    });
    await expect(critiqueReport(await input(), deps)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("a cancelled token sends nothing", async () => {
    const { provider, deps, source } = setup();
    source.cancel({ kind: "user" });
    await expect(critiqueReport(await input(), deps)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses a template that is not SELF_CRITIQUE", async () => {
    const { deps } = setup();
    await expect(
      critiqueReport(await input(), { ...deps, critiquePrompt: EN }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("refuses a compose input in another language than the draft's", async () => {
    const { deps } = setup();
    const given = await input();
    await expect(
      critiqueReport(
        { ...given, compose: { ...given.compose, language: "ko" } },
        deps,
      ),
    ).rejects.toThrow(RangeError);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import type { Cache } from "../../../src/core/cache/cache";
import {
  BudgetExceededError,
  ConfigurationError,
  ContentFilterError,
  MissingCredentialError,
  OperationCancelledError,
  PolicyViolationError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { createLogger } from "../../../src/core/logger";
import {
  KO_PENDING_REVIEW,
  KO_PRESENT,
  L10N_EGRESS_PROFILE_NOTICE,
  L10N_RECOMMEND_PROFILE_UNUSABLE,
  surfaceOfMessage,
} from "../../../src/i18n/keys";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type { LLMRouter, ModelInfo } from "../../../src/llm/types";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { ProviderId } from "../../../src/model/ids";
import type { CollectionProfile } from "../../../src/model/profile";
import { buildProfileStats } from "../../../src/pipeline/recommend/profile";
import {
  applyProfileAnswer,
  fitProfileLines,
  planProfileCall,
  PROFILE_COLLECTION_NAME_WITHHELD,
  PROFILE_INPUT_BUDGET,
  PROFILE_LINE_MAX_TERMS,
  profileLine,
  recommendRoutineStore,
  runProfileCall,
  topSubjectTerms,
  type ProfileCallContext,
  type ProfileCallDeps,
  type ProfileConfirmAnswer,
  type ProfileConfirmRequest,
} from "../../../src/pipeline/recommend/profileCall";
import {
  createBudgetGuard,
  createSessionSpendCounter,
  withBudget,
} from "../../../src/pipeline/shared/budget";
import { buildEgressDisclosure } from "../../../src/pipeline/shared/egressDisclosure";
import { estimateProfileCall } from "../../../src/pipeline/shared/estimate";
import {
  createPrivacyPolicy,
  readCollectionPrivacySettings,
  writeCollectionPrivacySettings,
  type PrivacyMode,
} from "../../../src/pipeline/shared/privacyPolicy";
import type { ConfigReader } from "../../../src/pipeline/types";
import { getPref, type PrefName } from "../../../src/prefs";
import { createPromptRegistry } from "../../../src/prompts";
import {
  buildCostDialogModel,
  shouldOpenCostDialog,
} from "../../../src/ui/dialogs/costConfirmDialog";
import type { CollectionSettingsStore } from "../../../src/zotero/db";
import {
  canonicalWorkFromSnapshot,
  topicTagNames,
  type CollectionWorkRead,
} from "../../../src/zotero/itemMapper";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockModel,
  mockSettings,
  type MockCall,
  type MockLLMProvider,
  type MockStep,
} from "../../helpers/mockLLM";

/**
 * `P5-T22`, `src/pipeline/recommend/profileCall.ts`. Layer 1 (`docs/13` §2.1):
 * plain Node over the real router, `withBudget`, `completeJSON`, the real
 * prompt file and the real privacy policy. No network, no model and no key;
 * every answer comes from `test/helpers/mockLLM.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const promptDir = resolve(here, "../../../src/prompts");
const PROMPTS = createPromptRegistry(
  readdirSync(promptDir)
    .filter((name) => name.endsWith(".md"))
    .map((fileName) => ({
      fileName,
      text: readFileSync(resolve(promptDir, fileName), "utf8"),
    })),
);

const STRONG = "report-model";
const COLLECTION = { libraryID: 7, collectionKey: "COLLKEY1" };
const COLLECTION_NAME = "Secret collection name";
const ABSTRACT = "An abstract nobody may send";
const PRICES: ModelPrices = {
  inputPerMTokUsd: 1,
  outputPerMTokUsd: 2,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: 1,
  source: "documented-table",
};
/** So dear that one call passes a one-cent ceiling. */
const DEAR: ModelPrices = {
  ...PRICES,
  inputPerMTokUsd: 1_000_000,
  outputPerMTokUsd: 1_000_000,
};

const GOOD_ANSWER = JSON.stringify({
  focusStatement: "Synthetic studies of a made-up intervention.",
  coherence: "Close.",
  coherenceScore: 80,
  coreTopics: [{ topic: "dosing", weight: 1 }],
  inclusionSignals: ["a trial of the intervention"],
  exclusionSignals: [],
  suggestedQueryTerms: [
    "  made-up intervention  ",
    "made up intervention",
    "",
    "dose response",
  ],
});

/** A valid answer's text, or `{}`: the schema's required members are absent. */
const INVALID_ANSWER = JSON.stringify({ wrong: true });

function workOf(index: number, fields: Partial<CanonicalWork> = {}) {
  return {
    workKey: `hash:${String(index)}`,
    ids: {},
    type: "journal-article" as const,
    title: `Paper ${String(index)}`,
    authors: [],
    abstract: `${ABSTRACT} ${String(index)}`,
    containerTitle: "Journal of Fixtures",
    publishedDate: { year: 2000 + (index % 5) },
    subjects: [{ term: "Neoplasms", scheme: "mesh", isMajor: true }],
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
    normalizedAtEpochMs: 1,
    ...fields,
  } as CanonicalWork;
}

function itemOf(
  index: number,
  fields: Partial<CanonicalWork> = {},
  dateModified = "2026-01-01 00:00:00",
): CollectionWorkRead {
  return {
    itemKey: `ITEM${String(index).padStart(4, "0")}`,
    dateModified,
    work: workOf(index, fields),
  };
}

/** {@link itemOf} with `absent` members left out (`exactOptionalPropertyTypes`). */
function itemWithout(
  index: number,
  absent: readonly (keyof CanonicalWork)[],
  fields: Partial<CanonicalWork> = {},
): CollectionWorkRead {
  const item = itemOf(index, fields);
  const work = { ...item.work } as Partial<CanonicalWork>;
  for (const name of absent) delete work[name];
  return { ...item, work: work as CanonicalWork };
}

function itemsOf(count: number): CollectionWorkRead[] {
  return Array.from({ length: count }, (_, index) => itemOf(index));
}

function statsOf(items: readonly CollectionWorkRead[]): CollectionProfile {
  return buildProfileStats({
    ...COLLECTION,
    collection: { name: COLLECTION_NAME, items },
    librarySources: [],
    nowEpochMs: 1234,
  });
}

function memoryCache(): Cache & {
  readonly entries: Map<string, unknown>;
  readonly tags: Map<string, readonly string[]>;
} {
  const entries = new Map<string, unknown>();
  const tags = new Map<string, readonly string[]>();
  const id = (namespace: string, key: string): string => `${namespace}/${key}`;
  return {
    entries,
    tags,
    get: <T>(namespace: string, key: string) =>
      Promise.resolve(entries.get(id(namespace, key)) as T | undefined),
    set: (
      namespace: string,
      key: string,
      value: unknown,
      options?: { readonly tags?: readonly string[] },
    ) => {
      entries.set(id(namespace, key), value);
      tags.set(id(namespace, key), options?.tags ?? []);
      return Promise.resolve();
    },
  } as unknown as Cache & {
    readonly entries: Map<string, unknown>;
    readonly tags: Map<string, readonly string[]>;
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

function knownPolicyModel(
  id: string,
  overrides: Partial<ModelInfo> = {},
): ModelInfo {
  return mockModel(id, {
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    dataPolicy: {
      trainsOnInputByDefault: "no",
      retention: { days: "zero", note: "" },
    },
    ...overrides,
  });
}

interface HarnessOptions {
  readonly script?: readonly MockStep[];
  readonly mode?: PrivacyMode;
  readonly hasKey?: boolean;
  readonly router?: LLMRouter;
  readonly modelInfo?: ProfileCallDeps["modelInfo"];
  readonly prices?: ModelPrices;
  readonly settings?: CollectionSettingsStore;
  readonly cache?: ReturnType<typeof memoryCache>;
  readonly config?: Partial<Record<PrefName, unknown>>;
  readonly answer?: ProfileConfirmAnswer | (() => Promise<never>);
  readonly reportModel?: string;
  readonly limits?: { run: () => number; session: () => number };
  readonly prompts?: ProfileCallDeps["prompts"];
  readonly providerId?: ProviderId;
}

function harness(options: HarnessOptions = {}) {
  const clock = createManualClock(1_000);
  const providerId = options.providerId ?? "openrouter";
  const provider: MockLLMProvider = mockLLM(
    options.script ?? [chatResponse(GOOD_ANSWER)],
    {
      id: providerId,
      models: [knownPolicyModel(options.reportModel ?? STRONG)],
    },
  );
  const router = withBudget(
    options.router ??
      mockLLMRouter(
        [provider],
        mockSettings({
          activeProvider: providerId,
          reportModel: options.reportModel ?? STRONG,
          keyPresent: { [providerId]: true },
        }),
      ),
    { pricesFor: () => options.prices ?? PRICES, now: () => clock.now() },
  );
  const cache = options.cache ?? memoryCache();
  const settings = options.settings ?? memorySettings();
  const values: Partial<Record<PrefName, unknown>> = {
    cacheEnabled: true,
    logRequestBodies: false,
    ...options.config,
  };
  const source = createCancellationTokenSource();
  const logs: string[] = [];
  const prefsRead: PrefName[] = [];
  const ctx: ProfileCallContext = {
    token: source.token,
    logger: createLogger({
      sink: { write: (line) => void logs.push(line) },
      clock,
    }),
    cache,
    clock,
    budget: createBudgetGuard({
      session: createSessionSpendCounter(),
      limits: options.limits ?? { run: () => 0, session: () => 0 },
    }),
    llm: router,
    config: {
      get: (name: PrefName) => {
        prefsRead.push(name);
        return name in values ? values[name] : getPref(name);
      },
    } as unknown as ConfigReader,
    privacy: createPrivacyPolicy(options.mode ?? "balanced"),
  };
  const deps: ProfileCallDeps = {
    prompts: options.prompts ?? PROMPTS,
    credentials: { hasKey: () => Promise.resolve(options.hasKey ?? true) },
    prices: () => options.prices ?? PRICES,
    modelInfo: options.modelInfo ?? ((_provider, id) => knownPolicyModel(id)),
    baseUrls: { effectiveHost: () => "openrouter.ai" },
    egressAcknowledged: () => true,
    routine: recommendRoutineStore(settings),
  };
  const confirms: ProfileConfirmRequest[] = [];
  const surface = {
    confirm(request: ProfileConfirmRequest): Promise<ProfileConfirmAnswer> {
      confirms.push(request);
      const answer = options.answer;
      if (typeof answer === "function") return answer();
      return Promise.resolve(
        answer ?? { kind: "run", raise: undefined, dontAskAgain: false },
      );
    },
  };
  return {
    provider,
    ctx,
    deps,
    surface,
    confirms,
    cache,
    settings,
    source,
    logs,
    prefsRead,
  };
}

/** The user text of a call. */
function userText(call: MockCall | undefined): string {
  return (
    call?.request.messages.find(({ role }) => role === "user")?.content ?? ""
  );
}

/** The whole request, as the provider received it. */
function allText(call: MockCall | undefined): string {
  return (call?.request.messages ?? [])
    .map(({ content }) => content)
    .join("\n");
}

// ---------------------------------------------------------------------------

describe("one call, then none (the card's first Done-when line)", () => {
  it("makes one call for 30 items and none for an unchanged second run", async () => {
    const h = harness();
    const items = itemsOf(30);
    const profile = statsOf(items);
    const first = await runProfileCall(
      { profile, items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(first.status).toBe("llm");
    expect(h.provider.calls).toHaveLength(1);

    const second = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.provider.calls).toHaveLength(1);
    expect(h.confirms).toHaveLength(1);
    if (first.status !== "llm" || second.status !== "llm") {
      throw new Error("both runs should end in the model's answer");
    }
    // From the cache: the same narrative, and nothing left the machine.
    expect(second.profile.narrative).toBe(first.profile.narrative);
    expect(second.profile.suggestedQueries).toEqual(
      first.profile.suggestedQueries,
    );
    expect(second.egress).toBeUndefined();
    expect(first.egress).toBeDefined();
  });

  it("calls again when a member changes, whatever the read order", async () => {
    const h = harness();
    const items = itemsOf(30);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const reversed = [...items].reverse();
    await runProfileCall(
      { profile: statsOf(reversed), items: reversed },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.provider.calls).toHaveLength(1);

    const changed = items.map((item, index) =>
      index === 3 ? { ...item, dateModified: "2026-02-02 00:00:00" } : item,
    );
    await runProfileCall(
      { profile: statsOf(changed), items: changed },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.provider.calls).toHaveLength(2);
  });

  it("does not reuse an answer for another model or another prompt epoch", async () => {
    const cache = memoryCache();
    const items = itemsOf(6);
    const a = harness({ cache });
    await runProfileCall(
      { profile: statsOf(items), items },
      a.ctx,
      a.deps,
      a.surface,
    );
    expect(a.provider.calls).toHaveLength(1);

    const b = harness({ cache, reportModel: "another-model" });
    await runProfileCall(
      { profile: statsOf(items), items },
      b.ctx,
      b.deps,
      b.surface,
    );
    expect(b.provider.calls).toHaveLength(1);

    const c = harness({
      cache,
      prompts: {
        get: (id) => PROMPTS.get(id),
        cacheEpochs: { ...PROMPTS.cacheEpochs, COLLECTION_PROFILE: 2 },
      },
    });
    await runProfileCall(
      { profile: statsOf(items), items },
      c.ctx,
      c.deps,
      c.surface,
    );
    expect(c.provider.calls).toHaveLength(1);
  });

  it("does not read or write the cache with the cache preference off", async () => {
    const cache = memoryCache();
    const items = itemsOf(6);
    const h = harness({ cache, config: { cacheEnabled: false } });
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.provider.calls).toHaveLength(2);
    expect(cache.entries.size).toBe(0);
  });

  it("treats a malformed cache entry as a miss", async () => {
    const cache = memoryCache();
    const items = itemsOf(6);
    const h = harness({ cache });
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const [key] = [...cache.entries.keys()];
    cache.entries.set(key as string, { narrative: 3 });
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.provider.calls).toHaveLength(2);
  });

  it("caches only the three members, in the report namespace, with its tags", async () => {
    const cache = memoryCache();
    const items = itemsOf(6);
    const h = harness({ cache });
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const [[key, value]] = [...cache.entries.entries()] as [[string, object]];
    expect(key.startsWith("report/")).toBe(true);
    expect(Object.keys(value).sort()).toEqual([
      "narrative",
      "outputTokens",
      "suggestedQueries",
    ]);
    const tags = cache.tags.get(key) ?? [];
    expect(tags.some((tag) => tag.startsWith("model:"))).toBe(true);
    expect(tags.some((tag) => tag.startsWith("provider:"))).toBe(true);
    expect(tags.some((tag) => tag.includes("COLLECTION_PROFILE"))).toBe(true);
  });

  it("survives a cache that cannot store", async () => {
    const cache = memoryCache();
    (cache as { set: Cache["set"] }).set = () =>
      Promise.reject(new Error("disk full"));
    const items = itemsOf(6);
    const h = harness({ cache });
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome.status).toBe("llm");
  });
});

describe("the request (docs/12 §15; docs/09 §3 row 6)", () => {
  it("has the strong model, temperature 0.2, 2 500 output tokens and no reasoning effort", async () => {
    const h = harness();
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const { request } = h.provider.calls[0] as MockCall;
    expect(request.model).toBe(STRONG);
    expect(request.temperature).toBe(0.2);
    expect(request.traceId).toContain("collection-profile:");
    expect(request.maxOutputTokens).toBe(2500);
    expect("effort" in request).toBe(false);
    expect(JSON.stringify(request)).not.toMatch(/reasoning|effort/iu);
    expect(request.responseFormat).toMatchObject({
      kind: "json_schema",
      name: "CollectionProfile",
    });
  });

  it("carries one line per paper and no abstract, note or collection name", async () => {
    const h = harness();
    const items = itemsOf(30);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const call = h.provider.calls[0];
    const text = allText(call);
    for (const item of items) {
      expect(userText(call)).toContain(`${item.itemKey} | `);
    }
    expect(text).not.toContain(ABSTRACT);
    expect(text).not.toContain(COLLECTION_NAME);
    expect(text).toContain(PROFILE_COLLECTION_NAME_WITHHELD);
    expect(userText(call).match(/ITEM\d{4} \| /gu)).toHaveLength(30);
  });

  it("sends no tag the user typed, through the same reader P5-T18 uses", async () => {
    const typed = "my private reading list";
    const work = canonicalWorkFromSnapshot(
      {
        itemType: "journalArticle",
        fields: { title: "A trial", publicationTitle: "A venue" },
        dateMultipart: "2024-03-00 March 2024",
        creators: [],
        tags: topicTagNames([
          { tag: typed, type: 0 },
          { tag: "MeSH*: Neoplasms", type: 0 },
        ]),
      },
      { nowEpochMs: 1 },
    );
    const items = [
      { itemKey: "AAAAAAAA", dateModified: "2026", work },
      ...itemsOf(5),
    ];
    const h = harness();
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const call = h.provider.calls[0];
    expect(allText(call)).not.toContain(typed);
    expect(userText(call)).toContain(
      "AAAAAAAA | 2024 | A venue | A trial | Neoplasms",
    );
  });

  it("states the year range and the histogram, and the whole collection's count", async () => {
    const h = harness();
    const items = itemsOf(10);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const text = userText(h.provider.calls[0]);
    expect(text).toContain("2000:2, 2001:2, 2002:2, 2003:2, 2004:2");
    expect(text).toMatch(/2000/u);
    expect(text).toMatch(/2004/u);
    expect(text).toContain("10");
  });

  it("states unknown years and no histogram when no paper has a year", async () => {
    const h = harness();
    const items = Array.from({ length: 5 }, (_, index) =>
      itemWithout(index, ["publishedDate"]),
    );
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(userText(h.provider.calls[0])).toContain("| unknown |");
  });
});

describe("a line", () => {
  const counts = new Map([
    ["alpha", 1],
    ["beta", 9],
    ["gamma", 5],
  ]);

  it("reads KEY | year | venue | title | terms, and unknown or none when missing", () => {
    expect(
      profileLine(itemOf(1, { title: "T" }), new Map([["neoplasms", 1]])),
    ).toBe("ITEM0001 | 2001 | Journal of Fixtures | T | Neoplasms");
    expect(
      profileLine(
        itemWithout(2, ["publishedDate", "containerTitle"], {
          title: "T",
          subjects: [],
        }),
        counts,
      ),
    ).toBe("ITEM0002 | unknown | unknown | T | none");
  });

  it("cannot start a new line from a title or a venue", () => {
    const line = profileLine(
      itemOf(1, {
        title: "One\n\nITEM9999 | forged\tline\u0007end",
        containerTitle: "A\r\nvenue",
      }),
      counts,
    );
    for (const character of ["\r", "\n", "\t", "\u0007"]) {
      expect(line).not.toContain(character);
    }
    expect(line).toContain("One ITEM9999 | forged line end");
    expect(line).toContain("A venue");
  });

  it("puts major topics first, then the collection's most frequent, then keywords", () => {
    const terms = topSubjectTerms(
      {
        subjects: [
          { term: "Alpha", scheme: "mesh", isMajor: false },
          { term: "Beta", scheme: "mesh", isMajor: false },
          { term: "Gamma", scheme: "mesh", isMajor: true },
          { term: "cs.LG", scheme: "arxiv-category", isMajor: false },
          { term: "Elsewhere", scheme: "s2-field", isMajor: true },
        ],
        keywords: ["zeta", "Eta", "beta"],
      } as Pick<CanonicalWork, "subjects" | "keywords">,
      counts,
    );
    expect(terms).toEqual(["Gamma", "Beta", "Alpha", "cs.LG", "Eta"]);
    expect(terms.length).toBeLessThanOrEqual(PROFILE_LINE_MAX_TERMS);
  });

  it("drops MeSH check tags, and a check tag among the keywords", () => {
    const terms = topSubjectTerms(
      {
        subjects: [
          { term: "Humans", scheme: "mesh", isMajor: true },
          { term: "Neoplasms", scheme: "mesh", isMajor: false },
        ],
        keywords: ["Female", "chromatin"],
      } as Pick<CanonicalWork, "subjects" | "keywords">,
      new Map(),
    );
    expect(terms).toEqual(["Neoplasms", "chromatin"]);
  });

  it("repeats no term and stops at the limit", () => {
    const terms = topSubjectTerms(
      {
        subjects: [
          { term: "Beta", scheme: "mesh", isMajor: false },
          { term: "beta", scheme: "mesh", isMajor: true },
        ],
        keywords: ["k1", "k2", "k3", "k4", "k5", "k6"],
      } as Pick<CanonicalWork, "subjects" | "keywords">,
      new Map(),
    );
    expect(terms).toEqual(["Beta", "k1", "k2", "k3", "k4"]);
  });
});

describe("the input budget (docs/12 §15's note, item 4)", () => {
  const count = (text: string): number => text.length;
  const rows = Array.from({ length: 100 }, (_, index) =>
    String(index).padStart(9, "0"),
  );
  const same = (row: string): string => row;

  it("keeps every line that fits, each with its newline", () => {
    expect(fitProfileLines(rows, same, 1000, count)).toEqual(rows);
    expect(fitProfileLines(rows, same, 999, count)).not.toEqual(rows);
  });

  it("keeps an evenly spaced subset, in order, starting with the first", () => {
    const kept = fitProfileLines(rows, same, 250, count);
    expect(kept).toHaveLength(25);
    expect(kept[0]).toBe(rows[0]);
    expect(kept[1]).toBe(rows[4]);
    expect(kept[24]).toBe(rows[96]);
  });

  it("steps down when the proportion is still too much", () => {
    const uneven = ["x".repeat(40), ...rows.slice(0, 9)];
    const kept = fitProfileLines(uneven, same, 45, count);
    const total = kept.reduce((sum, row) => sum + row.length + 1, 0);
    expect(kept.length).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(45);
  });

  it("answers nothing when not one line fits or the budget is not positive", () => {
    expect(fitProfileLines(rows, same, 5, count)).toEqual([]);
    expect(fitProfileLines(rows, same, -10, count)).toEqual([]);
    expect(fitProfileLines(rows, same, 0, count)).toEqual([]);
  });

  it("samples a large collection, still states its size, and prices what is sent", async () => {
    const window = 40_000;
    const h = harness({
      modelInfo: (_provider, id) =>
        knownPolicyModel(id, { contextWindowTokens: window }),
    });
    const items = Array.from({ length: 4000 }, (_, index) =>
      itemOf(index, {
        title: `A rather long fixture title number ${String(index)}`,
      }),
    );
    const profile = statsOf(items);
    const plan = await planProfileCall({ profile, items }, h.ctx, h.deps);
    if (plan.status !== "ready") throw new Error(`plan: ${plan.status}`);
    const lines = plan.estimate.selected.items.length;
    expect(lines).toBeGreaterThan(100);
    expect(lines).toBeLessThan(4000);
    expect(plan.disclosure.itemCount).toBe(lines);
    expect(plan.request.messages[1]?.content).toContain("4000");
    // The whole request stays inside the window beside its output.
    expect(plan.estimate.selected.inputTokens).toBeLessThanOrEqual(
      window - 2500 - 800,
    );
    expect(h.provider.calls).toHaveLength(0);
  });

  it("holds the 60 000 budget on a model with a far larger window", async () => {
    const h = harness({
      modelInfo: (_provider, id) =>
        knownPolicyModel(id, { contextWindowTokens: 2_000_000 }),
    });
    const items = Array.from({ length: 8000 }, (_, index) =>
      itemOf(index, {
        title: `A rather long fixture title number ${String(index)}`,
      }),
    );
    const plan = await planProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
    );
    if (plan.status !== "ready") throw new Error(`plan: ${plan.status}`);
    expect(plan.estimate.selected.rawInputTokens).toBeLessThanOrEqual(
      PROFILE_INPUT_BUDGET,
    );
    expect(plan.estimate.selected.items.length).toBeLessThan(8000);
  });

  it("sends nothing and warns when the window holds not one line", async () => {
    const h = harness({
      modelInfo: (_provider, id) =>
        knownPolicyModel(id, { contextWindowTokens: 3400 }),
    });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome).toMatchObject({
      status: "heuristic",
      reason: "too-large",
      warningId: L10N_RECOMMEND_PROFILE_UNUSABLE,
    });
    expect(h.provider.calls).toHaveLength(0);
    expect(h.confirms).toHaveLength(0);
  });
});

describe("privacy (the card's second Done-when line)", () => {
  it("strict mode allows metadata-only, and the notice names the model and the scope", async () => {
    const h = harness({ mode: "strict" });
    const items = itemsOf(30);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome.status).toBe("llm");
    const [request] = h.confirms;
    if (request === undefined) throw new Error("no question was asked");
    expect(request.disclosure.scope["metadata-only"]).toBe(30);
    expect(request.disclosure.scope.abstract).toBe(0);
    expect(request.disclosure.scope["abstract+fulltext"]).toBe(0);
    expect(request.disclosure.privacyMode).toBe("strict");
    expect(request.disclosure.noticeIds).toContain(L10N_EGRESS_PROFILE_NOTICE);

    const model = buildCostDialogModel(
      {
        mode: "preflight",
        estimate: request.estimate,
        disclosure: request.disclosure,
        confirmAboveCents: 200,
        fullTextAutoMaxPapers: 25,
        providerName: "OpenRouter",
        ceilingSelected: undefined,
        ceilingDowngrade: undefined,
        session: request.session,
      },
      "en-US",
    );
    if (model.mode !== "preflight") throw new Error("not a preflight model");
    expect(
      model.notices.find(({ id }) => id === L10N_EGRESS_PROFILE_NOTICE)?.args,
    ).toEqual({ papers: 30, model: STRONG });
    // Zero retention is asked for in strict mode.
    expect(h.provider.calls[0]?.request.routing).toEqual({
      requireNoTraining: true,
      requireZeroRetention: true,
    });
  });

  it("the notice appears only on a profile's disclosure", async () => {
    const h = harness();
    const items = itemsOf(6);
    const plan = await planProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
    );
    if (plan.status !== "ready") throw new Error(plan.status);
    expect(plan.disclosure.noticeIds).toContain(L10N_EGRESS_PROFILE_NOTICE);
    const other = buildEgressDisclosure(
      {
        providerId: "openrouter",
        modelId: STRONG,
        privacyMode: "balanced",
        items: ["metadata-only"],
      },
      { baseUrls: h.deps.baseUrls, egressAcknowledged: () => true },
    );
    expect(other.noticeIds).not.toContain(L10N_EGRESS_PROFILE_NOTICE);
  });

  it("strict mode refuses a model of unknown policy: no question and no request", async () => {
    const h = harness({
      mode: "strict",
      modelInfo: () => undefined,
    });
    const items = itemsOf(6);
    await expect(
      runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      ),
    ).rejects.toBeInstanceOf(PolicyViolationError);
    expect(h.confirms).toHaveLength(0);
    expect(h.provider.calls).toHaveLength(0);
  });
});

describe("an unusable answer (the card's third Done-when line)", () => {
  it("is repaired once, then retried once by completeJSON, then the profile stays heuristic", async () => {
    const h = harness({ script: [chatResponse(INVALID_ANSWER)] });
    const items = itemsOf(6);
    const profile = statsOf(items);
    const outcome = await runProfileCall(
      { profile, items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome).toMatchObject({
      status: "heuristic",
      reason: "unusable-answer",
      warningId: L10N_RECOMMEND_PROFILE_UNUSABLE,
    });
    if (outcome.status !== "heuristic") throw new Error("not heuristic");
    expect(outcome.profile).toBe(profile);
    expect(outcome.profile.origin).toBe("heuristic");
    expect(outcome.profile.suggestedQueries).toEqual([]);
    expect(outcome.profile.narrative).toBeUndefined();
    expect(outcome.egress).toBeDefined();
    expect(h.provider.calls).toHaveLength(3);
    // The second request is the repair: it carries the invalid answer back.
    expect(allText(h.provider.calls[1])).toContain(INVALID_ANSWER);
    expect(h.cache.entries.size).toBe(0);
  });

  it("is used when the repair succeeds", async () => {
    const h = harness({
      script: [chatResponse(INVALID_ANSWER), chatResponse(GOOD_ANSWER)],
    });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome.status).toBe("llm");
    expect(h.provider.calls).toHaveLength(2);
  });

  it("is not repaired when truncated, or stopped by a content filter", async () => {
    for (const error of [
      chatResponse("{", { finishReason: "length" }),
      new ContentFilterError("openrouter", STRONG, "filtered"),
    ]) {
      const h = harness({ script: [error] });
      const items = itemsOf(6);
      const outcome = await runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      );
      expect(outcome).toMatchObject({
        status: "heuristic",
        reason: "unusable-answer",
      });
      expect(h.provider.calls).toHaveLength(1);
      expect(h.cache.entries.size).toBe(0);
    }
  });

  it("reads a blank focus statement as unusable and caches nothing", async () => {
    const h = harness({
      script: [
        chatResponse(
          JSON.stringify({
            ...(JSON.parse(GOOD_ANSWER) as object),
            focusStatement: " \n ",
          }),
        ),
      ],
    });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome).toMatchObject({
      status: "heuristic",
      reason: "unusable-answer",
    });
    expect(h.cache.entries.size).toBe(0);
  });

  it("calls again on the next run after a fallback", async () => {
    const h = harness({
      script: [
        chatResponse(INVALID_ANSWER),
        chatResponse(INVALID_ANSWER),
        chatResponse(INVALID_ANSWER),
        chatResponse(GOOD_ANSWER),
      ],
    });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const again = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(again.status).toBe("llm");
    expect(h.provider.calls).toHaveLength(4);
  });
});

describe("no provider (FR-45)", () => {
  it("stays heuristic with no question, no request and no warning when there is no key", async () => {
    const h = harness({ hasKey: false });
    const items = itemsOf(6);
    const profile = statsOf(items);
    const outcome = await runProfileCall(
      { profile, items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome).toEqual({
      status: "heuristic",
      profile,
      reason: "no-provider",
    });
    expect(h.confirms).toHaveLength(0);
    expect(h.provider.calls).toHaveLength(0);
  });

  it("stays heuristic when the router has no model", async () => {
    const empty = mockLLMRouter();
    const h = harness({
      router: {
        ...empty,
        resolveModel: () => {
          throw new ConfigurationError("no model");
        },
      } as LLMRouter,
    });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome.status).toBe("heuristic");
    expect(h.confirms).toHaveLength(0);
  });

  it("does not swallow another failure of resolveModel", async () => {
    const empty = mockLLMRouter();
    const h = harness({
      router: {
        ...empty,
        resolveModel: () => {
          throw new RangeError("a bug");
        },
      } as LLMRouter,
    });
    const items = itemsOf(6);
    await expect(
      runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("the question and its own record (the card's fourth Done-when line)", () => {
  const recordOf = {
    providerId: "openrouter",
    privacyMode: "balanced",
    fullText: false,
  } as const;

  it("a summarize run's and a report run's records do not skip a recommend run's question", async () => {
    const settings = memorySettings();
    await writeCollectionPrivacySettings(settings, COLLECTION, {
      routineConfirmation: recordOf,
      reportRoutineConfirmation: recordOf,
    });
    const h = harness({ settings });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.confirms[0]?.confirmation).toEqual({
      ask: true,
      reasons: ["not-suppressed"],
    });
  });

  it("the recommend run's own record skips it, and money still forces the dialog", async () => {
    const settings = memorySettings();
    await writeCollectionPrivacySettings(settings, COLLECTION, {
      recommendRoutineConfirmation: recordOf,
    });
    const h = harness({ settings });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const [request] = h.confirms;
    if (request === undefined) throw new Error("the surface was not reached");
    expect(request.confirmation.ask).toBe(false);
    const closed = shouldOpenCostDialog({
      confirmation: request.confirmation,
      plan: request.estimate.selected,
      confirmAboveCents: 1_000_000,
      ceiling: undefined,
    });
    expect(closed.open).toBe(false);
    const forced = shouldOpenCostDialog({
      confirmation: request.confirmation,
      plan: { ...request.estimate.selected, costUsd: undefined },
      confirmAboveCents: 1_000_000,
      ceiling: undefined,
    });
    expect(forced.open).toBe(true);
  });

  it("a model that needs the user's word asks whatever the record says", async () => {
    const settings = memorySettings();
    await writeCollectionPrivacySettings(settings, COLLECTION, {
      recommendRoutineConfirmation: { ...recordOf, privacyMode: "full" },
    });
    const h = harness({
      settings,
      mode: "full",
      modelInfo: (_provider, id) =>
        knownPolicyModel(id, {
          dataPolicy: {
            trainsOnInputByDefault: "yes",
            retention: { days: "unknown", note: "" },
          },
        }),
    });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.confirms[0]?.confirmation.ask).toBe(true);
  });

  it("don't-ask-again writes the recommend member alone", async () => {
    const settings = memorySettings();
    await writeCollectionPrivacySettings(settings, COLLECTION, {
      routineConfirmation: { ...recordOf, providerId: "gemini" },
    });
    const h = harness({
      settings,
      answer: { kind: "run", raise: undefined, dontAskAgain: true },
    });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const stored = readCollectionPrivacySettings(
      await settings.get(COLLECTION.libraryID, COLLECTION.collectionKey),
    );
    expect(stored.recommendRoutineConfirmation).toEqual(recordOf);
    expect(stored.routineConfirmation?.providerId).toBe("gemini");
    expect(stored.reportRoutineConfirmation).toBeUndefined();
  });

  it("stores nothing without the box", async () => {
    const settings = memorySettings();
    const h = harness({ settings });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(
      readCollectionPrivacySettings(
        await settings.get(COLLECTION.libraryID, COLLECTION.collectionKey),
      ).recommendRoutineConfirmation,
    ).toBeUndefined();
  });

  it("a record that cannot be read asks, and one that cannot be written does not stop the run", async () => {
    const settings: CollectionSettingsStore = {
      ...memorySettings(),
      get: () => Promise.reject(new Error("unreadable")),
      put: () => Promise.reject(new Error("unwritable")),
    };
    const h = harness({
      settings,
      answer: { kind: "run", raise: undefined, dontAskAgain: true },
    });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.confirms[0]?.confirmation.ask).toBe(true);
    expect(outcome.status).toBe("llm");
  });

  it("a refusal, or a surface that fails, sends nothing and stores nothing", async () => {
    for (const answer of [
      { kind: "cancelled" } as const,
      () => Promise.reject<never>(new Error("no window")),
    ]) {
      const h = harness({ answer });
      const items = itemsOf(6);
      const outcome = await runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      );
      expect(outcome).toEqual({ status: "declined" });
      expect(h.provider.calls).toHaveLength(0);
      expect(h.cache.entries.size).toBe(0);
    }
  });

  it("reports a ceiling the estimate would pass", async () => {
    const limited = harness({
      limits: { run: () => 1, session: () => 0 },
      prices: DEAR,
      answer: { kind: "cancelled" },
    });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      limited.ctx,
      limited.deps,
      limited.surface,
    );
    expect(limited.confirms[0]?.ceilingSelected?.ceiling).toBe("run");
    expect(limited.provider.calls).toHaveLength(0);
  });

  it("applies the raise the user chose, so the call the ceiling would stop goes out", async () => {
    const raised = harness({
      limits: { run: () => 1, session: () => 0 },
      prices: DEAR,
      answer: {
        kind: "run",
        raise: { ceiling: "run", limitUsd: 1_000_000 },
        dontAskAgain: false,
      },
    });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      raised.ctx,
      raised.deps,
      raised.surface,
    );
    expect(outcome.status).toBe("llm");
    expect(raised.provider.calls).toHaveLength(1);
  });

  it("asks no ceiling question under a guard with no limit", async () => {
    const h = harness();
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.confirms[0]?.ceilingSelected).toBeUndefined();
  });
});

describe("what stops a run (docs/12 §15's note, item 6)", () => {
  it("lets a budget refusal through, because withBudget reserves first", async () => {
    const h = harness({
      limits: { run: () => 1, session: () => 0 },
      prices: DEAR,
    });
    const items = itemsOf(6);
    await expect(
      runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(h.provider.calls).toHaveLength(0);
  });

  it("refuses a router with no budget in its context, through withBudget", async () => {
    const h = harness();
    const items = itemsOf(6);
    await expect(
      runProfileCall(
        { profile: statsOf(items), items },
        { ...h.ctx, budget: undefined } as unknown as ProfileCallContext,
        h.deps,
        h.surface,
      ),
    ).rejects.toThrow();
    expect(h.provider.calls).toHaveLength(0);
  });

  it("lets a cancellation through, before anything is asked", async () => {
    const h = harness();
    h.source.cancel({ kind: "user" });
    const items = itemsOf(6);
    await expect(
      runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(h.confirms).toHaveLength(0);
  });

  it("lets a transport failure through", async () => {
    const h = harness({ script: [new RangeError("connection reset")] });
    const items = itemsOf(6);
    await expect(
      runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("the answer", () => {
  it("maps focusStatement and suggestedQueryTerms, cleans the terms and keeps the output tokens", async () => {
    const h = harness({
      script: [
        chatResponse(GOOD_ANSWER, {
          usage: {
            inputTokens: 10,
            outputTokens: 321,
            totalTokens: 331,
            costUsd: undefined,
          },
        }),
      ],
    });
    const items = itemsOf(6);
    const first = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    if (first.status !== "llm") throw new Error(first.status);
    expect(first.profile).toMatchObject({
      origin: "llm",
      narrative: "Synthetic studies of a made-up intervention.",
      suggestedQueries: ["made-up intervention", "dose response"],
      profileCallOutputTokens: 321,
    });
    const second = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    if (second.status !== "llm") throw new Error(second.status);
    expect(second.profile.profileCallOutputTokens).toBe(321);
  });

  it("leaves the statistics alone", () => {
    const items = itemsOf(6);
    const profile = statsOf(items);
    const after = applyProfileAnswer(profile, {
      narrative: "N",
      suggestedQueries: [],
    });
    expect(after).toEqual({
      ...profile,
      narrative: "N",
      suggestedQueries: [],
      origin: "llm",
    });
    expect("profileCallOutputTokens" in after).toBe(false);
  });
});

describe("the mutation sweep's closing cases", () => {
  const empty = new Map<string, number>();
  const subjects = (
    ...terms: readonly (readonly [string, boolean])[]
  ): Pick<CanonicalWork, "subjects" | "keywords"> =>
    ({
      subjects: terms.map(([term, isMajor]) => ({
        term,
        scheme: "mesh",
        isMajor,
      })),
    }) as Pick<CanonicalWork, "subjects" | "keywords">;

  it("drops a subject and a keyword with no letters", () => {
    expect(
      topSubjectTerms(
        {
          ...subjects(["!!!", true], ["Alpha", false]),
          keywords: ["???", "beta"],
        },
        empty,
      ),
    ).toEqual(["Alpha", "beta"]);
  });

  it("stays major when a later spelling of the term is not", () => {
    expect(
      topSubjectTerms(
        subjects(["Beta", true], ["beta", false], ["Alpha", false]),
        empty,
      ),
    ).toEqual(["Beta", "Alpha"]);
  });

  it("breaks a tie in code-unit order", () => {
    expect(
      topSubjectTerms(subjects(["Beta", false], ["Alpha", false]), empty),
    ).toEqual(["Alpha", "Beta"]);
  });

  it("keeps a keyword's first spelling, once, and none already a subject", () => {
    expect(
      topSubjectTerms(
        {
          ...subjects(["Alpha", false]),
          keywords: ["alpha", "Zeta", "zeta"],
        },
        empty,
      ),
    ).toEqual(["Alpha", "Zeta"]);
  });

  it("orders lines by year, then key, with no year last, whatever the read order", async () => {
    const read = [
      itemWithout(1, ["publishedDate"], { title: "D" }),
      itemOf(5, { title: "C", publishedDate: { year: 2020, iso: "2020" } }),
      itemOf(3, { title: "B", publishedDate: { year: 2020, iso: "2020" } }),
      itemOf(9, { title: "A", publishedDate: { year: 2010, iso: "2010" } }),
      itemOf(7, { title: "E", publishedDate: { year: 2030, iso: "2030" } }),
    ];
    for (const items of [read, [...read].reverse()]) {
      const h = harness();
      await runProfileCall(
        { profile: statsOf(items), items },
        h.ctx,
        h.deps,
        h.surface,
      );
      expect(
        userText(h.provider.calls[0]).match(/ITEM\d{4}(?= \| )/gu),
      ).toEqual(["ITEM0009", "ITEM0003", "ITEM0005", "ITEM0007", "ITEM0001"]);
    }
  });

  it("states the range, the histogram and no note exactly", async () => {
    const h = harness();
    const items = [
      itemOf(1, { publishedDate: { year: 2021, iso: "2021" } }),
      itemOf(2, { publishedDate: { year: 2005, iso: "2005" } }),
      itemOf(3, { publishedDate: { year: 2005, iso: "2005" } }),
      itemOf(4, { publishedDate: { year: 2010, iso: "2010" } }),
      itemOf(5, { publishedDate: { year: 2010, iso: "2010" } }),
    ];
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const text = userText(h.provider.calls[0]);
    expect(text).toContain("5 papers, 2005-2021");
    expect(text).toContain("Year distribution: 2005:2, 2010:2, 2021:1");
    expect(text).toContain("Researcher's note about this collection: none");
  });

  it("states no year as unknown and none", async () => {
    const h = harness();
    const items = Array.from({ length: 5 }, (_, index) =>
      itemWithout(index, ["publishedDate"]),
    );
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const text = userText(h.provider.calls[0]);
    expect(text).toContain("5 papers, unknown-unknown");
    expect(text).toContain("Year distribution: none");
  });

  it.each([
    ["an empty narrative", { narrative: "", suggestedQueries: [] }],
    ["a narrative of another type", { narrative: 3, suggestedQueries: [] }],
    ["no query list", { narrative: "n" }],
    ["a query of another type", { narrative: "n", suggestedQueries: [3] }],
    [
      "tokens of another type",
      { narrative: "n", suggestedQueries: [], outputTokens: "x" },
    ],
  ])("reads a cache entry with %s as a miss", async (_name, entry) => {
    const cache = memoryCache();
    const items = itemsOf(6);
    const h = harness({ cache });
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    const [key] = [...cache.entries.keys()];
    cache.entries.set(key as string, entry);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.provider.calls).toHaveLength(2);
  });

  it("does not reuse an answer across libraries, providers or temperatures", async () => {
    const items = itemsOf(6);
    const run = async (
      h: ReturnType<typeof harness>,
      profile = statsOf(items),
    ): Promise<number> => {
      await runProfileCall({ profile, items }, h.ctx, h.deps, h.surface);
      return h.provider.calls.length;
    };
    const cache = memoryCache();
    expect(await run(harness({ cache }))).toBe(1);
    expect(await run(harness({ cache }))).toBe(0);
    expect(
      await run(harness({ cache }), { ...statsOf(items), libraryID: 8 }),
    ).toBe(1);
    expect(await run(harness({ cache, providerId: "anthropic" }))).toBe(1);
    expect(
      await run(
        harness({
          cache,
          prompts: {
            get: (id) => ({
              ...PROMPTS.get(id),
              defaultTemperature: 0.5,
            }),
            cacheEpochs: PROMPTS.cacheEpochs,
          },
        }),
      ),
    ).toBe(1);
  });

  it("does not read an entry the cache holds while the preference is off", async () => {
    const cache = memoryCache();
    const items = itemsOf(6);
    const on = harness({ cache });
    await runProfileCall(
      { profile: statsOf(items), items },
      on.ctx,
      on.deps,
      on.surface,
    );
    const off = harness({ cache, config: { cacheEnabled: false } });
    await runProfileCall(
      { profile: statsOf(items), items },
      off.ctx,
      off.deps,
      off.surface,
    );
    expect(off.provider.calls).toHaveLength(1);
  });

  it("prices the rendered request and its schema", async () => {
    const h = harness();
    const items = itemsOf(6);
    const plan = await planProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
    );
    if (plan.status !== "ready") throw new Error(plan.status);
    const count = (value: string): number => estTokens(value, STRONG);
    expect(plan.estimate.selected.rawInputTokens).toBe(
      plan.request.messages.reduce((sum, m) => sum + count(m.content), 0) +
        count(JSON.stringify(PROMPTS.get("COLLECTION_PROFILE").schema)),
    );
  });

  it("stores the answer through the redactor", async () => {
    const secret = `sk-ant-${"a".repeat(40)}`;
    const cache = memoryCache();
    const items = itemsOf(6);
    const h = harness({
      cache,
      script: [
        chatResponse(
          JSON.stringify({
            ...(JSON.parse(GOOD_ANSWER) as object),
            focusStatement: `A statement holding ${secret}.`,
          }),
        ),
      ],
    });
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(JSON.stringify([...cache.entries.values()])).not.toContain(secret);
  });

  it("reads the body-logging preference, and logs no request or answer text with it on", async () => {
    const h = harness({
      script: [chatResponse(INVALID_ANSWER)],
      config: { logRequestBodies: true },
    });
    const items = itemsOf(6);
    await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(h.prefsRead).toContain("logRequestBodies");
    const logged = h.logs.join("\n");
    expect(logged).not.toContain("Paper 1");
    expect(logged).not.toContain("ITEM0001");
    expect(logged).not.toContain('"wrong"');
  });

  it("reads a key removed after the plan as no provider", async () => {
    const h = harness({ script: [new MissingCredentialError("openrouter")] });
    const items = itemsOf(6);
    const outcome = await runProfileCall(
      { profile: statsOf(items), items },
      h.ctx,
      h.deps,
      h.surface,
    );
    expect(outcome).toMatchObject({
      status: "heuristic",
      reason: "no-provider",
    });
    expect(h.cache.entries.size).toBe(0);
  });
});

describe("estimateProfileCall (docs/06's headroom, docs/12 §15's 2 500)", () => {
  const input = {
    workKeys: ["a", "b"],
    rawInputTokens: 1000,
    outputTokens: 2500,
    modelId: "m",
    atEpochMs: 1,
  };

  it("is one call, every paper metadata-only, with headroom on the input only", () => {
    const estimate = estimateProfileCall({ ...input, prices: PRICES });
    const { selected } = estimate;
    expect(selected.calls).toBe(1);
    expect(selected.rawInputTokens).toBe(1000);
    expect(selected.inputTokens).toBe(1150);
    expect(selected.outputTokens).toBe(2500);
    expect(selected.counts).toMatchObject({
      items: 2,
      metadataOnly: 2,
      fullText: 0,
      abstractOnly: 0,
    });
    expect(selected.items.map(({ scope }) => scope)).toEqual([
      "metadata-only",
      "metadata-only",
    ]);
    expect(selected.costUsd).toBeGreaterThan(0);
    expect(estimate.abstractOnly).toBe(selected);
    expect(estimate.preselectDowngrade).toBe(false);
  });

  it("does not call an unknown price zero", () => {
    expect(
      estimateProfileCall({ ...input, prices: undefined }).selected.costUsd,
    ).toBeUndefined();
  });
});

describe("the strings", () => {
  const ids = [L10N_EGRESS_PROFILE_NOTICE, L10N_RECOMMEND_PROFILE_UNUSABLE];
  const bundle = (locale: string): string =>
    readFileSync(
      resolve(
        here,
        `../../../addon/locale/${locale}/research-helper-mainWindow.ftl`,
      ),
      "utf8",
    );

  it("have a message in both bundles and are reviewed, on the main window (G-41, plan/00 §6 item 335(l))", () => {
    for (const id of ids) {
      const declared = (text: string): boolean =>
        text.split(/\r?\n/u).some((line) => line.startsWith(`${id} =`));
      expect(surfaceOfMessage(id)).toBe("mainWindow");
      expect(declared(bundle("en-US")), id).toBe(true);
      expect(declared(bundle("ko-KR")), id).toBe(true);
      expect(bundle("ko-KR")).not.toContain(`# NEEDS REVIEW ${id} `);
      expect(KO_PRESENT as readonly string[]).toContain(id);
      expect(KO_PENDING_REVIEW as readonly string[]).not.toContain(id);
    }
  });

  it("name the collection name among what is not sent, and do not promise about tags", () => {
    const english = bundle("en-US");
    const at = english.indexOf(`${L10N_EGRESS_PROFILE_NOTICE} =`);
    const notice = english.slice(at, english.indexOf("\n\n", at));
    expect(notice).toContain("{ $model }");
    expect(notice).toContain("metadata only");
    expect(notice).toContain("collection name");
    expect(notice).not.toMatch(/\btags?\b/iu);
  });
});

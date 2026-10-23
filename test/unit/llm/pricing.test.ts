/**
 * `P3-T13` steps 2–4: `pricing.ts` (`costOf`, tiers, the user table, the cent
 * conversion, the documented table) and `modelCatalogue.ts` (enrichment through
 * the slug map, the 24 h cache, the bundled fallback).
 *
 * **Every fixture is SYNTHETIC**, hand-built in the shapes `docs/03` §9.1 and
 * §9.4 print. Context lengths and prices in the fixtures are test values, not
 * claims about any real model. No live catalogue is fetched: every fetcher is
 * a stub.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NO_CACHE,
  type Cache,
  type CacheNamespace,
  type CacheSetOptions,
} from "../../../src/core/cache/cache";
import { createManualClock, type Clock } from "../../../src/core/clock";
import { createLogger, type Logger } from "../../../src/core/logger";
import { OperationCancelledError } from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import { toModelInfos } from "../../../src/llm/openai/mapper";
import {
  parseOpenRouterCatalogue,
  type OpenRouterCatalogueEntry,
} from "../../../src/llm/openrouter/catalogue";
import { createLLMProviderRegistry } from "../../../src/llm/registry";
import {
  bundledCatalogue,
  createModelCatalogue,
  createModelPriceSource,
  findCatalogueModel,
  MODEL_CATALOGUE_NAMESPACE,
  MODEL_CATALOGUE_TTL_MS,
  modelCatalogueCacheKey,
  modelsFor,
  reloadingUserPriceStore,
  type ModelCatalogueSnapshot,
} from "../../../src/llm/shared/modelCatalogue";
import {
  applyUserPriceOverride,
  centsToUsd,
  costAboveCents,
  costOf,
  DOCUMENTED_PRICE_TABLE,
  DOCUMENTED_PRICES_AS_OF,
  DOCUMENTED_PRICES_AS_OF_EPOCH_MS,
  pricesFromCatalogueEntry,
  pricesFromDocumentedRow,
  selectPriceTier,
  type ModelPrices,
  type UserPriceOverride,
} from "../../../src/llm/shared/pricing";
import type { LLMCallContext, ModelInfo } from "../../../src/llm/types";
import type { ProviderId } from "../../../src/model/ids";
import { PREFS } from "../../../src/prefs";
import {
  chatResponse,
  mockLLM,
  mockModel,
  mockSettings,
} from "../../helpers/mockLLM";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const T0 = Date.parse("2026-10-21T09:00:00Z");

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

/** SYNTHETIC: OpenRouter's `GET /api/v1/models`, in §9.4's entry shape. */
const SYNTHETIC_OPENROUTER_CATALOGUE = {
  data: [
    {
      // §9.4's own example entry, overrides tier included.
      id: "openai/gpt-6-astra",
      name: "OpenAI: GPT-6 Astra",
      context_length: 1_050_000,
      pricing: {
        prompt: "0.00001",
        completion: "0.00005",
        overrides: [
          {
            min_prompt_tokens: 272_000,
            prompt: "0.00002",
            completion: "0.000075",
          },
        ],
      },
      top_provider: {
        context_length: 1_050_000,
        max_completion_tokens: 128_000,
      },
      supported_parameters: ["structured_outputs"],
    },
    {
      id: "openai/gpt-5.6-terra",
      name: "OpenAI: GPT-5.6 Terra",
      context_length: 400_000,
      pricing: { prompt: "0.000002", completion: "0.000012" },
      top_provider: { max_completion_tokens: 64_000 },
    },
    {
      id: "anthropic/claude-haiku-4.5",
      name: "Anthropic: Claude Haiku 4.5",
      context_length: 200_000,
      pricing: { prompt: "0.000001", completion: "0.000005" },
      top_provider: { max_completion_tokens: 64_000 },
    },
    {
      // A decoy under the naive prefix: a lookup that skips the dot rule lands here.
      id: "anthropic/claude-haiku-4-5",
      name: "decoy",
      context_length: 1_000,
      pricing: { prompt: "0.9", completion: "0.9" },
    },
  ],
};

function openRouterEntries(): readonly OpenRouterCatalogueEntry[] {
  return parseOpenRouterCatalogue(SYNTHETIC_OPENROUTER_CATALOGUE).entries;
}

function entry(slug: string): OpenRouterCatalogueEntry {
  const found = openRouterEntries().find((e) => e.model.id === slug);
  if (found === undefined) throw new Error(`no fixture entry ${slug}`);
  return found;
}

/** SYNTHETIC: OpenAI's `GET /v1/models` (§9.1): IDs only, read by P3-T08's mapper. */
const SYNTHETIC_OPENAI_MODELS: readonly ModelInfo[] = toModelInfos({
  object: "list",
  data: [
    { id: "gpt-5.6-terra", object: "model", created: 1, owned_by: "openai" },
    { id: "gpt-6-astra", object: "model", created: 2, owned_by: "openai" },
    { id: "gpt-unlisted-1", object: "model", created: 3, owned_by: "openai" },
  ],
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RecordingCache extends Cache {
  readonly writes: {
    namespace: CacheNamespace;
    key: string;
    options: CacheSetOptions | undefined;
  }[];
}

/** A JSON round-tripping cache honouring `ttlMs` on `clock`. */
function memoryCache(clock: Clock): RecordingCache {
  const store = new Map<string, { json: string; expiresAt?: number }>();
  const writes: RecordingCache["writes"] = [];
  return {
    ...NO_CACHE,
    writes,
    get<T>(namespace: CacheNamespace, key: string): Promise<T | undefined> {
      const hit = store.get(`${namespace}|${key}`);
      if (hit === undefined) return Promise.resolve(undefined);
      if (hit.expiresAt !== undefined && clock.now() >= hit.expiresAt) {
        store.delete(`${namespace}|${key}`);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(JSON.parse(hit.json) as T);
    },
    set<T>(
      namespace: CacheNamespace,
      key: string,
      value: T,
      options?: CacheSetOptions,
    ): Promise<void> {
      writes.push({ namespace, key, options });
      store.set(`${namespace}|${key}`, {
        json: JSON.stringify(value),
        ...(options?.ttlMs !== undefined && {
          expiresAt: clock.now() + options.ttlMs,
        }),
      });
      return Promise.resolve();
    },
  };
}

function ctx(overrides: Partial<LLMCallContext> = {}): LLMCallContext {
  return { token: createCancellationTokenSource().token, ...overrides };
}

interface HarnessOptions {
  readonly keys?: Partial<Record<ProviderId, boolean>>;
  readonly natives?: Partial<
    Record<ProviderId, () => Promise<readonly ModelInfo[]>>
  >;
  readonly openRouter?: () => Promise<readonly OpenRouterCatalogueEntry[]>;
  readonly overrides?: readonly UserPriceOverride[];
  /** The port as the plugin database answers it: asynchronous (item 265 (b)). */
  readonly userPrices?: () => Promise<readonly UserPriceOverride[]>;
  readonly logger?: Logger;
}

function harness(options: HarnessOptions = {}) {
  const clock = createManualClock(T0);
  const cache = memoryCache(clock);
  const calls: string[] = [];
  const registry = createLLMProviderRegistry(
    mockSettings({ keyPresent: options.keys ?? {} }),
  );
  for (const id of ["openrouter", "openai", "anthropic", "gemini"] as const) {
    const provider = mockLLM([chatResponse("unused")], { id });
    const native = options.natives?.[id];
    registry.register({
      ...provider,
      listModels: () => {
        calls.push(id);
        return native === undefined
          ? Promise.reject(new Error(`no ${id} list in this test`))
          : native();
      },
    });
  }
  const catalogue = createModelCatalogue({
    registry,
    cache,
    clock,
    openRouterCatalogue: () => {
      calls.push("openrouter-catalogue");
      return (
        options.openRouter ?? (() => Promise.resolve(openRouterEntries()))
      )();
    },
    ...(options.overrides !== undefined && {
      userPriceOverrides: () => options.overrides ?? [],
    }),
    ...(options.userPrices !== undefined && {
      userPriceOverrides: options.userPrices,
    }),
    ...(options.logger !== undefined && { logger: options.logger }),
  });
  return { clock, cache, calls, catalogue };
}

function model(
  snapshot: ModelCatalogueSnapshot,
  providerId: ProviderId,
  id: string,
) {
  const found = findCatalogueModel(snapshot, providerId, id);
  expect(found, `${providerId} ${id}`).toBeDefined();
  return found!;
}

const fail = () => Promise.reject(new Error("synthetic network failure"));

// ---------------------------------------------------------------------------
// costOf
// ---------------------------------------------------------------------------

function prices(overrides: Partial<ModelPrices> = {}): ModelPrices {
  return {
    inputPerMTokUsd: 2,
    outputPerMTokUsd: 10,
    cachedInputPerMTokUsd: 0.2,
    tiers: [],
    asOfEpochMs: T0,
    source: "openrouter-catalogue",
    ...overrides,
  };
}

describe("costOf — fractional dollars, never rounded (plan/00 §6 item 252)", () => {
  it("prices input and output per million tokens and keeps fractions of a cent", () => {
    const estimate = costOf(
      prices(),
      { inputTokens: 1_950, outputTokens: 200 },
      T0,
    );
    // 1,950 × $2/M + 200 × $10/M = $0.0039 + $0.002
    expect(estimate.inputCostUsd).toBeCloseTo(0.0039, 12);
    expect(estimate.outputCostUsd).toBeCloseTo(0.002, 12);
    expect(estimate.costUsd).toBeCloseTo(0.0059, 12);
    expect(estimate.isEstimate).toBe(true);
    expect(estimate.asOfEpochMs).toBe(T0);
    expect(estimate.tierAbovePromptTokens).toBeUndefined();
  });

  it("on a model with an overrides tier, returns the higher price above its min_prompt_tokens", () => {
    const astra = pricesFromCatalogueEntry(entry("openai/gpt-6-astra"), T0);
    expect(astra).toBeDefined();
    const at = (inputTokens: number) =>
      costOf(astra!, { inputTokens, outputTokens: 1_000 }, T0);

    const atThreshold = at(272_000);
    expect(atThreshold.tierAbovePromptTokens).toBeUndefined();
    // 272,000 × $10/M + 1,000 × $50/M
    expect(atThreshold.costUsd).toBeCloseTo(2.72 + 0.05, 9);

    const above = at(272_001);
    expect(above.tierAbovePromptTokens).toBe(272_000);
    // The whole call at the tier: 272,001 × $20/M + 1,000 × $75/M
    expect(above.costUsd).toBeCloseTo(5.44002 + 0.075, 9);
    expect(above.costUsd!).toBeGreaterThan(atThreshold.costUsd! * 1.9);
  });

  it("selects the highest tier the prompt is above, whatever the order", () => {
    const tiers = [
      { abovePromptTokens: 500, inputPerMTokUsd: 5, outputPerMTokUsd: 50 },
      { abovePromptTokens: 100, inputPerMTokUsd: 3, outputPerMTokUsd: 30 },
    ];
    expect(selectPriceTier(tiers, 100)).toBeUndefined();
    expect(selectPriceTier(tiers, 101)?.abovePromptTokens).toBe(100);
    expect(selectPriceTier(tiers, 501)?.abovePromptTokens).toBe(500);
  });

  it("keeps a base price a tier leaves unstated", () => {
    const estimate = costOf(
      prices({
        tiers: [
          {
            abovePromptTokens: 10,
            inputPerMTokUsd: 4,
            outputPerMTokUsd: undefined,
          },
        ],
      }),
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      T0,
    );
    expect(estimate.inputCostUsd).toBeCloseTo(4, 12);
    expect(estimate.outputCostUsd).toBeCloseTo(10, 12);
  });

  it("bills cached input at the cached price, or at the input price when none is known", () => {
    const tokens = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 600_000,
    };
    // 400,000 × $2/M + 600,000 × $0.20/M
    expect(costOf(prices(), tokens, T0).costUsd).toBeCloseTo(0.8 + 0.12, 12);
    expect(
      costOf(prices({ cachedInputPerMTokUsd: undefined }), tokens, T0).costUsd,
    ).toBeCloseTo(2, 12);
    // A cached count above the prompt is clamped to it.
    expect(
      costOf(prices(), { ...tokens, cachedInputTokens: 5_000_000 }, T0).costUsd,
    ).toBeCloseTo(0.2, 12);
  });

  it("is undefined, never zero, when a needed price is not published", () => {
    const noOutput = costOf(
      prices({ outputPerMTokUsd: undefined }),
      { inputTokens: 100, outputTokens: 100 },
      T0,
    );
    expect(noOutput.costUsd).toBeUndefined();
    expect(noOutput.outputCostUsd).toBeUndefined();
    expect(noOutput.inputCostUsd).toBeCloseTo(0.0002, 12);
    // No output tokens: the missing output price is not needed.
    expect(
      costOf(
        prices({ outputPerMTokUsd: undefined }),
        { inputTokens: 100, outputTokens: 0 },
        T0,
      ).costUsd,
    ).toBeCloseTo(0.0002, 12);
  });

  it("refuses a negative or non-finite token count", () => {
    expect(() =>
      costOf(prices(), { inputTokens: -1, outputTokens: 0 }, T0),
    ).toThrow(RangeError);
    expect(() =>
      costOf(prices(), { inputTokens: 1, outputTokens: Number.NaN }, T0),
    ).toThrow(RangeError);
  });

  it("drops an override with no min_prompt_tokens and reads no price from a JSON number", () => {
    const [parsed] = parseOpenRouterCatalogue({
      data: [
        {
          id: "x/y",
          context_length: 10,
          pricing: {
            prompt: 0.000002,
            completion: "0.000004",
            overrides: [{ prompt: "0.1", completion: "0.1" }],
          },
        },
      ],
    }).entries;
    const read = pricesFromCatalogueEntry(parsed!, T0);
    expect(read?.inputPerMTokUsd).toBeUndefined();
    expect(read?.outputPerMTokUsd).toBeCloseTo(4, 9);
    expect(read?.tiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// docs/03 §12.1, as shipped
// ---------------------------------------------------------------------------

const PROVIDER_COLUMN: Readonly<Record<string, ProviderId>> = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Google: "gemini",
};

function documentedSection(): string {
  const doc = readFileSync(
    resolve(ROOT, "docs/03-llm-provider-integration.md"),
    "utf8",
  );
  const start = doc.indexOf("### 12.1 Price table");
  const end = doc.indexOf("### 12.2", start);
  expect(start).toBeGreaterThan(-1);
  return doc.slice(start, end);
}

describe("DOCUMENTED_PRICE_TABLE — docs/03 §12.1, the bundled fallback's prices", () => {
  it("carries the heading's date, 2026-09-08, and nothing claims it is current", () => {
    expect(documentedSection()).toMatch(
      new RegExp(
        `^### 12\\.1 Price table \\(verified ${DOCUMENTED_PRICES_AS_OF}\\)`,
      ),
    );
    expect(DOCUMENTED_PRICES_AS_OF_EPOCH_MS).toBe(
      Date.parse("2026-09-08T00:00:00Z"),
    );
  });

  it("transcribes §12.1 row for row, in order, with both footnotes", () => {
    const section = documentedSection();
    const rows = section
      .split(/\r?\n/)
      .map((line) =>
        /^\|\s*(OpenAI|Anthropic|Google)\s*\|\s*`([^`]+)`\s*\|\s*([\d.]+)(¹|²)?\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)(¹|²)?\s*\|$/.exec(
          line.trim(),
        ),
      )
      .filter((match): match is RegExpExecArray => match !== null);
    expect(rows).toHaveLength(13);
    expect(DOCUMENTED_PRICE_TABLE).toHaveLength(rows.length);
    rows.forEach((match, index) => {
      const shipped = DOCUMENTED_PRICE_TABLE[index]!;
      expect(shipped.providerId).toBe(PROVIDER_COLUMN[match[1]!]);
      expect(shipped.modelId).toBe(match[2]);
      expect(shipped.inputPerMTokUsd).toBe(Number(match[3]));
      expect(shipped.cachedInputPerMTokUsd).toBe(Number(match[5]));
      expect(shipped.outputPerMTokUsd).toBe(Number(match[6]));
      expect(shipped.promotion !== undefined).toBe(match[4] === "¹");
      expect(shipped.tiers !== undefined).toBe(match[4] === "²");
    });
  });

  it("encodes footnote 1 (the promotion's end and later prices) and footnote 2 (over 200,000 tokens)", () => {
    const section = documentedSection();
    expect(section).toContain(
      "¹ Promotional through 31 December 2026; reverts to $1.50 / $7.50 on 1 January 2027.",
    );
    expect(section).toContain(
      "² Prompts over 200,000 tokens are billed at $4.00 in / $18.00 out per 1M",
    );
    const flash = DOCUMENTED_PRICE_TABLE.find(
      (row) => row.modelId === "gemini-3.8-flash",
    )!;
    expect(flash.promotion).toEqual({
      endsEpochMs: Date.parse("2027-01-01T00:00:00Z"),
      thenInputPerMTokUsd: 1.5,
      thenOutputPerMTokUsd: 7.5,
    });
    const pro = DOCUMENTED_PRICE_TABLE.find(
      (row) => row.modelId === "gemini-3.1-pro-preview",
    )!;
    expect(pro.tiers).toEqual([
      { abovePromptTokens: 200_000, inputPerMTokUsd: 4, outputPerMTokUsd: 18 },
    ]);
  });

  it("gives way to the post-promotion prices on 1 January 2027, and treats the cached price as unknown then", () => {
    const flash = pricesFromDocumentedRow(
      DOCUMENTED_PRICE_TABLE.find((row) => row.modelId === "gemini-3.8-flash")!,
    );
    const tokens = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 500_000,
    };
    const during = costOf(flash, tokens, Date.parse("2026-12-31T23:59:59Z"));
    // 500,000 × $0.75/M + 500,000 × $0.075/M + 1M × $3.75/M
    expect(during.costUsd).toBeCloseTo(0.375 + 0.0375 + 3.75, 9);
    const after = costOf(flash, tokens, Date.parse("2027-01-01T00:00:00Z"));
    // Cached tokens at the input price: 1M × $1.50/M + 1M × $7.50/M
    expect(after.costUsd).toBeCloseTo(1.5 + 7.5, 9);
    expect(after.asOfEpochMs).toBe(DOCUMENTED_PRICES_AS_OF_EPOCH_MS);
    expect(after.source).toBe("documented-table");
  });

  it("lists every docs/07 §8.5 seed model, so a stale picker still shows the defaults", () => {
    const stale = bundledCatalogue();
    expect(
      model(stale, "openrouter", PREFS.openrouterModel.default).prices,
    ).toBeDefined();
    expect(
      model(stale, "openai", PREFS.openaiModel.default).prices,
    ).toBeDefined();
    expect(
      model(stale, "gemini", PREFS.geminiModel.default).prices,
    ).toBeDefined();
    expect(
      model(stale, "anthropic", PREFS.anthropicModel.default).prices,
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The user-editable table and the cent preferences
// ---------------------------------------------------------------------------

describe("the user-editable price table", () => {
  const userRow: UserPriceOverride = {
    providerId: "openai",
    modelId: "gpt-5.6-terra",
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    asOfEpochMs: Date.parse("2026-10-01T00:00:00Z"),
  };

  it("replaces the catalogue's prices, tiers included, and carries the user's date", () => {
    const base = pricesFromCatalogueEntry(entry("openai/gpt-6-astra"), T0);
    const mine = applyUserPriceOverride(base, userRow)!;
    expect(mine).toMatchObject({
      inputPerMTokUsd: 3,
      outputPerMTokUsd: 15,
      cachedInputPerMTokUsd: undefined,
      tiers: [],
      asOfEpochMs: userRow.asOfEpochMs,
      source: "user-override",
    });
  });

  it("ignores a row with a negative or non-finite price, or no usable date", () => {
    const base = prices();
    for (const bad of [
      { ...userRow, inputPerMTokUsd: -1 },
      { ...userRow, outputPerMTokUsd: Number.POSITIVE_INFINITY },
      { ...userRow, cachedInputPerMTokUsd: Number.NaN },
      { ...userRow, asOfEpochMs: Number.NaN },
    ]) {
      expect(applyUserPriceOverride(base, bad)).toBe(base);
    }
    expect(applyUserPriceOverride(base, undefined)).toBe(base);
  });

  it("is applied by the catalogue to its own provider's model only, the last row winning", async () => {
    const { catalogue } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
      overrides: [{ ...userRow, inputPerMTokUsd: 99 }, userRow],
    });
    const snapshot = await catalogue.get(ctx());
    expect(model(snapshot, "openai", "gpt-5.6-terra").prices?.source).toBe(
      "user-override",
    );
    expect(
      model(snapshot, "openai", "gpt-5.6-terra").prices?.inputPerMTokUsd,
    ).toBe(3);
    expect(
      model(snapshot, "openrouter", "openai/gpt-5.6-terra").prices?.source,
    ).toBe("openrouter-catalogue");
    // The stale list honours the table too.
    expect(
      model(bundledCatalogue([userRow]), "openai", "gpt-5.6-terra").prices
        ?.source,
    ).toBe("user-override");
  });
});

describe("the user price table through the plugin database's port (plan/00 §6 item 265 (b))", () => {
  const stored: UserPriceOverride = {
    providerId: "openai",
    modelId: "gpt-5.6-terra",
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    asOfEpochMs: Date.parse("2026-10-21T00:00:00Z"),
  };

  it("reads the table through an asynchronous port, as the plugin database's store answers it", async () => {
    let reads = 0;
    const { catalogue } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
      userPrices: () => {
        reads += 1;
        return Promise.resolve([stored]);
      },
    });
    const snapshot = await catalogue.get(ctx());
    expect(reads).toBe(1);
    expect(model(snapshot, "openai", "gpt-5.6-terra").prices).toMatchObject({
      source: "user-override",
      inputPerMTokUsd: 3,
      outputPerMTokUsd: 15,
      asOfEpochMs: stored.asOfEpochMs,
    });
  });

  it("logs a failed read of the table and keeps the catalogue's own prices", async () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: { write: (line) => lines.push(line) },
      clock: createManualClock(T0),
    });
    const { catalogue } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
      userPrices: () => Promise.reject(new Error("database closed")),
      logger,
    });
    const snapshot = await catalogue.get(ctx());
    expect(snapshot.stale).toBe(false);
    expect(model(snapshot, "openai", "gpt-5.6-terra").prices?.source).toBe(
      "openrouter-catalogue",
    );
    expect(lines.join("\n")).toContain(
      "the user price table could not be read",
    );
  });
});

describe("the cent preferences, through an explicit conversion (plan/00 §6 items 245, 252)", () => {
  it("converts cents to dollars and compares in dollars, never rounding the cost", () => {
    expect(centsToUsd(200)).toBe(2);
    expect(centsToUsd(7)).toBe(0.07);
    // 0.07 × 100 is 7.000000000000001 in floating point; comparing in dollars is exact here.
    expect(costAboveCents(0.07, 7)).toBe(false);
    expect(costAboveCents(2.000001, 200)).toBe(true);
    expect(costAboveCents(1.999999, 200)).toBe(false);
    expect(costAboveCents(0.0001, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

describe("createModelCatalogue — enrichment through the slug map", () => {
  it("an OpenAI-only configuration still gets context and price from the OpenRouter catalogue fixture", async () => {
    const { catalogue, calls } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
    });
    const snapshot = await catalogue.get(ctx());
    expect(snapshot.stale).toBe(false);
    expect(calls.sort()).toEqual(["openai", "openrouter-catalogue"]);

    const terra = model(snapshot, "openai", "gpt-5.6-terra");
    expect(terra.openRouterSlug).toBe("openai/gpt-5.6-terra");
    // OpenAI's own list states no limit (0, P3-T08); the catalogue's apply.
    expect(terra.contextWindowTokens).toBe(400_000);
    expect(terra.maxOutputTokens).toBe(64_000);
    expect(terra.prices?.inputPerMTokUsd).toBeCloseTo(2, 9);
    expect(terra.prices?.outputPerMTokUsd).toBeCloseTo(12, 9);
    expect(terra.prices?.asOfEpochMs).toBe(T0);
    expect(
      costOf(terra.prices!, { inputTokens: 1_000_000, outputTokens: 0 }, T0)
        .costUsd,
    ).toBeCloseTo(2, 9);

    // The tier survives the trip through the catalogue.
    const astra = model(snapshot, "openai", "gpt-6-astra");
    expect(astra.prices?.tiers).toHaveLength(1);
  });

  it("leaves every enriched field undefined when the slug is missing from the catalogue", async () => {
    const { catalogue } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
    });
    const unlisted = model(
      await catalogue.get(ctx()),
      "openai",
      "gpt-unlisted-1",
    );
    expect(unlisted).toEqual({
      providerId: "openai",
      id: "gpt-unlisted-1",
      displayName: "gpt-unlisted-1",
      openRouterSlug: "openai/gpt-unlisted-1",
      contextWindowTokens: undefined,
      maxOutputTokens: undefined,
      prices: undefined,
    });
  });

  it("looks an Anthropic model up under the dot slug, never the naive prefix, and keeps its own stated limits", async () => {
    const { catalogue } = harness({
      keys: { anthropic: true },
      natives: {
        anthropic: () =>
          Promise.resolve([
            mockModel("claude-haiku-4-5", {
              contextWindowTokens: 180_000,
              maxOutputTokens: 32_000,
            }),
          ]),
      },
    });
    const haiku = model(
      await catalogue.get(ctx()),
      "anthropic",
      "claude-haiku-4-5",
    );
    expect(haiku.openRouterSlug).toBe("anthropic/claude-haiku-4.5");
    expect(haiku.prices?.inputPerMTokUsd).toBeCloseTo(1, 9); // not the decoy's 900,000
    expect(haiku.contextWindowTokens).toBe(180_000);
    expect(haiku.maxOutputTokens).toBe(32_000);
  });

  it("lists OpenRouter's models from its public catalogue with no key, and fetches no unconfigured provider", async () => {
    const { catalogue, calls } = harness({
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
    });
    const snapshot = await catalogue.get(ctx());
    expect(calls).toEqual(["openrouter-catalogue"]);
    expect(modelsFor(snapshot, "openrouter").map((m) => m.id)).toEqual(
      openRouterEntries().map((e) => e.model.id),
    );
    expect(modelsFor(snapshot, "openai")).toEqual([]);
    expect(
      model(snapshot, "openrouter", "openai/gpt-6-astra").prices?.tiers,
    ).toHaveLength(1);
  });

  it("keeps a native list without prices when only the OpenRouter catalogue fails: not stale", async () => {
    const { catalogue } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
      openRouter: fail,
    });
    const snapshot = await catalogue.get(ctx());
    expect(snapshot.stale).toBe(false);
    expect(snapshot.failed).toEqual(["openrouter"]);
    expect(model(snapshot, "openai", "gpt-5.6-terra").prices).toBeUndefined();
    expect(modelsFor(snapshot, "openrouter")).toEqual([]);
  });
});

describe("createModelCatalogue — the 24 h cache and the bundled fallback", () => {
  it("with every fetch stubbed to fail, returns the bundled list with stale: true", async () => {
    const { catalogue } = harness({
      keys: { openai: true, anthropic: true, gemini: true },
      natives: { openai: fail, anthropic: fail, gemini: fail },
      openRouter: fail,
    });
    const snapshot = await catalogue.get(ctx());
    expect(snapshot.stale).toBe(true);
    expect(snapshot.asOfEpochMs).toBe(DOCUMENTED_PRICES_AS_OF_EPOCH_MS);
    expect(snapshot.failed).toEqual([
      "anthropic",
      "gemini",
      "openai",
      "openrouter",
    ]);
    expect(snapshot.models).toEqual(
      bundledCatalogue([], snapshot.failed).models,
    );
    expect(modelsFor(snapshot, "anthropic").map((m) => m.id)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
    // Under OpenRouter, the documented models appear under their slugs.
    expect(
      model(snapshot, "openrouter", "anthropic/claude-haiku-4.5").prices
        ?.source,
    ).toBe("documented-table");
  });

  it("serves the bundled list when OpenRouter's catalogue is the only fetch and it fails", async () => {
    const { catalogue } = harness({ openRouter: fail });
    expect((await catalogue.get(ctx())).stale).toBe(true);
  });

  it("caches each list for 24 h in source-response and records the fetch time as as-of", async () => {
    const { catalogue, calls, cache, clock } = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
    });
    const first = await catalogue.get(ctx());
    expect(first.asOfEpochMs).toBe(T0);
    expect(MODEL_CATALOGUE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(
      cache.writes.map((w) => [w.namespace, w.key, w.options?.ttlMs]),
    ).toEqual(
      expect.arrayContaining([
        [
          MODEL_CATALOGUE_NAMESPACE,
          modelCatalogueCacheKey("openrouter"),
          MODEL_CATALOGUE_TTL_MS,
        ],
        [
          MODEL_CATALOGUE_NAMESPACE,
          modelCatalogueCacheKey("openai"),
          MODEL_CATALOGUE_TTL_MS,
        ],
      ]),
    );
    expect(MODEL_CATALOGUE_NAMESPACE).toBe("source-response");

    clock.advance(MODEL_CATALOGUE_TTL_MS - 1);
    const cached = await catalogue.get(ctx());
    expect(calls).toHaveLength(2);
    expect(cached.asOfEpochMs).toBe(T0);
    expect(cached.models).toEqual(first.models);

    clock.advance(1);
    const refreshed = await catalogue.get(ctx());
    expect(calls).toHaveLength(4);
    expect(refreshed.asOfEpochMs).toBe(T0 + MODEL_CATALOGUE_TTL_MS);
  });

  it("refetches under bypassCache, and its as-of is the oldest list it rests on", async () => {
    let fetchOpenAi = true;
    const { catalogue, calls, clock } = harness({
      keys: { openai: true },
      natives: {
        openai: () =>
          fetchOpenAi ? Promise.resolve(SYNTHETIC_OPENAI_MODELS) : fail(),
      },
    });
    await catalogue.get(ctx());
    clock.advance(1_000);
    await catalogue.get(ctx({ bypassCache: true }));
    expect(calls).toHaveLength(4);

    // A failed refetch is not cached: the old copy is gone from the snapshot,
    // and the next ordinary get still reads the last good one.
    clock.advance(1_000);
    fetchOpenAi = false;
    const partial = await catalogue.get(ctx({ bypassCache: true }));
    expect(partial.failed).toEqual(["openai"]);
    expect(modelsFor(partial, "openai")).toEqual([]);
    expect(partial.asOfEpochMs).toBe(T0 + 2_000);
    const again = await catalogue.get(ctx());
    expect(modelsFor(again, "openai").length).toBeGreaterThan(0);
    expect(again.asOfEpochMs).toBe(T0 + 1_000);
  });

  it("never caches a failed fetch", async () => {
    const { catalogue, cache } = harness({ openRouter: fail });
    await catalogue.get(ctx());
    expect(cache.writes).toEqual([]);
  });

  it("refetches a cached value that is not a fetched list", async () => {
    const { catalogue, calls, cache } = harness();
    await cache.set(
      MODEL_CATALOGUE_NAMESPACE,
      modelCatalogueCacheKey("openrouter"),
      { entries: "not a list" },
    );
    const snapshot = await catalogue.get(ctx());
    expect(calls).toEqual(["openrouter-catalogue"]);
    expect(snapshot.stale).toBe(false);
  });

  it("shares one fetch between concurrent callers", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { catalogue, calls } = harness({
      openRouter: async () => {
        await gate;
        return openRouterEntries();
      },
    });
    const both = Promise.all([catalogue.get(ctx()), catalogue.get(ctx())]);
    await Promise.resolve();
    release();
    const [a, b] = await both;
    expect(calls).toEqual(["openrouter-catalogue"]);
    expect(a.models).toEqual(b.models);
  });

  it("rejects with OperationCancelledError for a cancelled token rather than falling back", async () => {
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const { catalogue, calls } = harness();
    await expect(catalogue.get({ token: source.token })).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(calls).toEqual([]);

    const midway = createCancellationTokenSource();
    const { catalogue: second } = harness({
      openRouter: () => {
        midway.cancel({ kind: "user" });
        return Promise.reject(new OperationCancelledError({ kind: "user" }));
      },
    });
    await expect(second.get({ token: midway.token })).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
  });
});

describe("createModelPriceSource — one snapshot, read synchronously, refreshed asynchronously (owner, 2026-10-23, plan/00 §6 item 278(b))", () => {
  const TERRA_OVERRIDE: UserPriceOverride = {
    providerId: "openai",
    modelId: "gpt-5.6-terra",
    inputPerMTokUsd: 7,
    outputPerMTokUsd: 70,
    asOfEpochMs: T0,
  };

  function source(rows: { current: readonly UserPriceOverride[] }) {
    const h = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
    });
    const prices = createModelPriceSource({
      catalogue: h.catalogue,
      userPriceOverrides: () => Promise.resolve(rows.current),
    });
    return { ...h, prices };
  }

  it("serves the documented table until a catalogue snapshot is adopted, and fetches nothing on its own", async () => {
    const rows = { current: [] as readonly UserPriceOverride[] };
    const { prices, calls } = source(rows);
    expect(prices.loaded).toBe(false);
    const terra = prices.pricesFor("openai", "gpt-5.6-terra");
    expect(terra).toEqual(
      pricesFromDocumentedRow(
        DOCUMENTED_PRICE_TABLE.find((r) => r.modelId === "gpt-5.6-terra")!,
      ),
    );
    expect(prices.current().stale).toBe(true);
    // Reading the user table is no catalogue request.
    await prices.reloadUserPrices();
    expect(calls).toEqual([]);
  });

  it("applies the user table over the documented table, and over the live snapshot once refreshed; a removed row stops applying", async () => {
    const rows = { current: [TERRA_OVERRIDE] as readonly UserPriceOverride[] };
    const { prices, calls } = source(rows);
    await prices.reloadUserPrices();
    expect(prices.pricesFor("openai", "gpt-5.6-terra")).toMatchObject({
      inputPerMTokUsd: 7,
      outputPerMTokUsd: 70,
      source: "user-override",
    });

    const snapshot = await prices.refresh(ctx());
    expect(calls.sort()).toEqual(["openai", "openrouter-catalogue"]);
    expect(prices.loaded).toBe(true);
    expect(snapshot.stale).toBe(false);
    // The refresh's answer is the snapshot held, user prices applied.
    expect(model(snapshot, "openai", "gpt-5.6-terra").prices?.source).toBe(
      "user-override",
    );
    expect(prices.pricesFor("openai", "gpt-5.6-terra")?.source).toBe(
      "user-override",
    );

    rows.current = [];
    await prices.reloadUserPrices();
    const live = prices.pricesFor("openai", "gpt-5.6-terra");
    expect(live?.source).not.toBe("user-override");
    expect(live?.asOfEpochMs).toBe(T0);
    expect(live?.inputPerMTokUsd).toBeCloseTo(2, 9);
  });

  it("keeps the table it held when the user table cannot be read, and never adopts an older refresh over a newer one", async () => {
    let fail = false;
    const h = harness({
      keys: { openai: true },
      natives: { openai: () => Promise.resolve(SYNTHETIC_OPENAI_MODELS) },
    });
    const prices = createModelPriceSource({
      catalogue: h.catalogue,
      userPriceOverrides: () =>
        fail
          ? Promise.reject(new Error("synthetic read failure"))
          : Promise.resolve([TERRA_OVERRIDE]),
    });
    await prices.reloadUserPrices();
    fail = true;
    await prices.reloadUserPrices();
    expect(prices.pricesFor("openai", "gpt-5.6-terra")?.source).toBe(
      "user-override",
    );

    // Two refreshes in flight: the second answers first and is kept.
    let releaseFirst!: (snapshot: ModelCatalogueSnapshot) => void;
    const live = await h.catalogue.get(ctx());
    const gated = createModelPriceSource({
      catalogue: {
        get: (() => {
          let n = 0;
          return () => {
            n += 1;
            return n === 1
              ? new Promise<ModelCatalogueSnapshot>((done) => {
                  releaseFirst = done;
                })
              : Promise.resolve(live);
          };
        })(),
      },
      userPriceOverrides: () => [],
    });
    const first = gated.refresh(ctx());
    await gated.refresh(ctx());
    releaseFirst(bundledCatalogue());
    await first;
    expect(gated.current().stale).toBe(false);
  });

  it("reloadingUserPriceStore re-reads the table after each change it makes", async () => {
    const stored: UserPriceOverride[] = [];
    let reloads = 0;
    const store = reloadingUserPriceStore(
      {
        list: () => Promise.resolve([...stored]),
        upsert: (row) => Promise.resolve(void stored.push(row)),
        delete: () => Promise.resolve(void stored.splice(0)),
      },
      {
        reloadUserPrices: () => {
          reloads += 1;
          return Promise.resolve();
        },
      },
    );
    await store.list();
    expect(reloads).toBe(0);
    await store.upsert(TERRA_OVERRIDE);
    expect(reloads).toBe(1);
    await store.delete("openai", "gpt-5.6-terra");
    expect(reloads).toBe(2);
  });
});

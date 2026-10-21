/**
 * Model prices and the cost of a call, in fractional US dollars.
 *
 * **Scope.** `P3-T13` step 4. Callers: `./modelCatalogue.ts` attaches a
 * {@link ModelPrices} to each model it lists, and the cost estimator
 * (`P3-T16`) calls {@link costOf} on it.
 *
 * **Where a price comes from**, in the order the catalogue applies them:
 * 1. A user override ({@link UserPriceOverride}, {@link applyUserPriceOverride})
 *    wins over everything for its model.
 * 2. OpenRouter's public catalogue (`docs/03` §9.4), for every provider through
 *    `./slugMap.ts` ({@link pricesFromCatalogueEntry}). Its long-context tiers,
 *    `pricing.overrides[]`, are kept: an estimator that ignores them
 *    under-quotes (`docs/03` §12.3 item 2).
 * 3. {@link DOCUMENTED_PRICE_TABLE}, `docs/03` §12.1 as written on
 *    {@link DOCUMENTED_PRICES_AS_OF}, only inside the bundled fallback list the
 *    catalogue serves when every fetch fails (`docs/03` §9 preamble).
 *
 * **The documented table is not claimed to be current.** It is the 2026-09-08
 * table, labelled with that date wherever it is used. Whether its model IDs and
 * prices still hold is the owner's check at gate `G-18` (the open line on card
 * `P3-T13`). To update it: change `docs/03` §12.1 first, then the rows below;
 * `test/unit/llm/pricing.test.ts` compares the two row by row and fails until
 * they agree.
 *
 * **Money stays fractional dollars** (`plan/00` §6 item 252): nothing here rounds.
 * The cent-denominated preferences (`summary.confirmAboveCents`,
 * `run.maxSpendCents`, `run.maxSessionSpendCents`; item 245) are compared only
 * through {@link centsToUsd} / {@link costAboveCents}, an explicit conversion.
 *
 * **Every cost is an estimate** and carries the date of its prices: a surface
 * that shows one must show {@link CostEstimate.asOfEpochMs} and the word
 * "estimate" with it (card `P3-T13`, Do NOT).
 */

import type { ProviderId } from "../../model/ids";
import type { OpenRouterCatalogueEntry } from "../openrouter/catalogue";

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

/** Where a {@link ModelPrices} came from. */
export type PriceSource =
  "openrouter-catalogue" | "documented-table" | "user-override";

/**
 * A long-context tier: a prompt **above** `abovePromptTokens` is billed at these
 * prices for the whole call (`docs/03` §9.4 "above 272,000 prompt tokens";
 * §12.1 footnote 2 "prompts over 200,000 tokens"). A missing price keeps the
 * base one.
 */
export interface PriceTier {
  readonly abovePromptTokens: number;
  readonly inputPerMTokUsd: number | undefined;
  readonly outputPerMTokUsd: number | undefined;
}

/** A promotional price that ends: from `endsEpochMs` on, the `then` prices apply. */
export interface PricePromotion {
  readonly endsEpochMs: number;
  readonly thenInputPerMTokUsd: number;
  readonly thenOutputPerMTokUsd: number;
}

/** One model's prices, US dollars per million tokens, with their date. */
export interface ModelPrices {
  readonly inputPerMTokUsd: number | undefined;
  readonly outputPerMTokUsd: number | undefined;
  /** Cached-input price; `undefined` bills cached tokens at the input price. */
  readonly cachedInputPerMTokUsd: number | undefined;
  readonly tiers: readonly PriceTier[];
  readonly promotion?: PricePromotion;
  /** When these prices were read: a fetch time, or a documented date. */
  readonly asOfEpochMs: number;
  readonly source: PriceSource;
}

/** The token counts a cost is computed for. */
export interface TokenCounts {
  /** Every prompt token, cached ones included. Selects the tier. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The part of `inputTokens` read from a prompt cache; 0 when absent. */
  readonly cachedInputTokens?: number;
}

/** What {@link costOf} returns. A cost is always an estimate. */
export interface CostEstimate {
  /** Fractional US dollars; `undefined` when a needed price is not published. */
  readonly costUsd: number | undefined;
  readonly inputCostUsd: number | undefined;
  readonly outputCostUsd: number | undefined;
  /** The tier applied, by its threshold; `undefined` for the base prices. */
  readonly tierAbovePromptTokens: number | undefined;
  /** The prices' date, to be shown beside the cost. */
  readonly asOfEpochMs: number;
  readonly source: PriceSource;
  readonly isEstimate: true;
}

/**
 * One row of the user-editable price table: the user's own prices for one
 * model, with the date the user read them. It replaces every other price for
 * that model, tiers included.
 */
export interface UserPriceOverride {
  readonly providerId: ProviderId;
  /** The model ID as the picker lists it for `providerId`. */
  readonly modelId: string;
  readonly inputPerMTokUsd: number;
  readonly outputPerMTokUsd: number;
  readonly cachedInputPerMTokUsd?: number;
  readonly asOfEpochMs: number;
}

/** One row of {@link DOCUMENTED_PRICE_TABLE}. */
export interface DocumentedPriceRow {
  readonly providerId: Exclude<ProviderId, "openrouter">;
  readonly modelId: string;
  readonly inputPerMTokUsd: number;
  readonly cachedInputPerMTokUsd: number;
  readonly outputPerMTokUsd: number;
  /** §12.1 footnote 2. */
  readonly tiers?: readonly PriceTier[];
  /** §12.1 footnote 1. */
  readonly promotion?: PricePromotion;
}

// ---------------------------------------------------------------------------
// 2. docs/03 §12.1, as written on 2026-09-08
// ---------------------------------------------------------------------------

/** The heading date of `docs/03` §12.1. Not a claim that the table is current. */
export const DOCUMENTED_PRICES_AS_OF = "2026-09-08";

/** Where {@link DOCUMENTED_PRICE_TABLE} is transcribed from. */
export const DOCUMENTED_PRICES_SOURCE =
  "docs/03-llm-provider-integration.md §12.1";

/** {@link DOCUMENTED_PRICES_AS_OF} as epoch milliseconds (midnight UTC). */
export const DOCUMENTED_PRICES_AS_OF_EPOCH_MS = Date.parse(
  `${DOCUMENTED_PRICES_AS_OF}T00:00:00Z`,
);

/**
 * §12.1 footnote 1: "Promotional through 31 December 2026; reverts to $1.50 /
 * $7.50 on 1 January 2027." Midnight UTC; §12.1 names no time zone.
 */
const GEMINI_38_FLASH_PROMOTION: PricePromotion = Object.freeze({
  endsEpochMs: Date.parse("2027-01-01T00:00:00Z"),
  thenInputPerMTokUsd: 1.5,
  thenOutputPerMTokUsd: 7.5,
});

/** §12.1 footnote 2: "Prompts over 200,000 tokens are billed at $4.00 in / $18.00 out per 1M." */
const GEMINI_31_PRO_LONG_CONTEXT: readonly PriceTier[] = Object.freeze([
  Object.freeze({
    abovePromptTokens: 200_000,
    inputPerMTokUsd: 4.0,
    outputPerMTokUsd: 18.0,
  }),
]);

/**
 * `docs/03` §12.1, row for row, in its order, footnotes included. Used only by
 * the bundled fallback list (`./modelCatalogue.ts`). Update `docs/03` first.
 */
export const DOCUMENTED_PRICE_TABLE: readonly DocumentedPriceRow[] =
  Object.freeze([
    row("openai", "gpt-6-astra", 10.0, 1.0, 50.0),
    row("openai", "gpt-5.6-sol", 4.0, 0.4, 20.0),
    row("openai", "gpt-5.6-terra", 2.0, 0.2, 12.0),
    row("openai", "gpt-5.6-luna", 0.2, 0.02, 1.2),
    row("anthropic", "claude-fable-5-1", 10.0, 0.25, 50.0),
    row("anthropic", "claude-opus-5", 5.0, 0.5, 25.0),
    row("anthropic", "claude-sonnet-5", 2.0, 0.2, 10.0),
    row("anthropic", "claude-haiku-4-5", 1.0, 0.1, 5.0),
    row("gemini", "gemini-3.1-pro-preview", 2.0, 0.2, 12.0, {
      tiers: GEMINI_31_PRO_LONG_CONTEXT,
    }),
    row("gemini", "gemini-3.5-flash", 1.5, 0.15, 9.0),
    row("gemini", "gemini-3.8-flash", 0.75, 0.075, 3.75, {
      promotion: GEMINI_38_FLASH_PROMOTION,
    }),
    row("gemini", "gemini-3.5-flash-lite", 0.3, 0.03, 2.5),
    row("gemini", "gemini-3.1-flash-lite", 0.25, 0.025, 1.5),
  ]);

function row(
  providerId: DocumentedPriceRow["providerId"],
  modelId: string,
  inputPerMTokUsd: number,
  cachedInputPerMTokUsd: number,
  outputPerMTokUsd: number,
  extra: Pick<DocumentedPriceRow, "tiers" | "promotion"> = {},
): DocumentedPriceRow {
  return Object.freeze({
    providerId,
    modelId,
    inputPerMTokUsd,
    cachedInputPerMTokUsd,
    outputPerMTokUsd,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 3. Building ModelPrices
// ---------------------------------------------------------------------------

/**
 * A documented row's prices, dated {@link DOCUMENTED_PRICES_AS_OF}.
 *
 * @param documented - one row of {@link DOCUMENTED_PRICE_TABLE}
 * @returns its prices
 */
export function pricesFromDocumentedRow(
  documented: DocumentedPriceRow,
): ModelPrices {
  return {
    inputPerMTokUsd: documented.inputPerMTokUsd,
    outputPerMTokUsd: documented.outputPerMTokUsd,
    cachedInputPerMTokUsd: documented.cachedInputPerMTokUsd,
    tiers: documented.tiers ?? [],
    ...(documented.promotion !== undefined && {
      promotion: documented.promotion,
    }),
    asOfEpochMs: DOCUMENTED_PRICES_AS_OF_EPOCH_MS,
    source: "documented-table",
  };
}

/**
 * A catalogue entry's prices, `pricing.overrides[]` kept as tiers.
 *
 * An override with no `min_prompt_tokens`, or with neither price, cannot be
 * placed and is dropped. The cached-input price is `undefined`: `P3-T07`'s
 * parser does not read `pricing.input_cache_read`.
 *
 * @param entry - one parsed OpenRouter catalogue entry
 * @param fetchedAtEpochMs - when the catalogue was fetched: the "as of"
 * @returns its prices, or `undefined` when the entry publishes none
 */
export function pricesFromCatalogueEntry(
  entry: OpenRouterCatalogueEntry,
  fetchedAtEpochMs: number,
): ModelPrices | undefined {
  const tiers: PriceTier[] = [];
  for (const override of entry.priceOverrides) {
    if (override.minPromptTokens === undefined) continue;
    if (
      override.inputCostPerMTokUsd === undefined &&
      override.outputCostPerMTokUsd === undefined
    ) {
      continue;
    }
    tiers.push({
      abovePromptTokens: override.minPromptTokens,
      inputPerMTokUsd: override.inputCostPerMTokUsd,
      outputPerMTokUsd: override.outputCostPerMTokUsd,
    });
  }
  const input = entry.model.inputCostPerMTokUsd;
  const output = entry.model.outputCostPerMTokUsd;
  if (input === undefined && output === undefined && tiers.length === 0) {
    return undefined;
  }
  return {
    inputPerMTokUsd: input,
    outputPerMTokUsd: output,
    cachedInputPerMTokUsd: undefined,
    tiers,
    asOfEpochMs: fetchedAtEpochMs,
    source: "openrouter-catalogue",
  };
}

/**
 * The user's row for a model, if the table has one.
 *
 * @param overrides - the user-editable table
 * @param providerId - the provider the model is listed under
 * @param modelId - the model ID as listed
 * @returns the last matching row (a later edit wins), or `undefined`
 */
export function findUserPriceOverride(
  overrides: readonly UserPriceOverride[],
  providerId: ProviderId,
  modelId: string,
): UserPriceOverride | undefined {
  let found: UserPriceOverride | undefined;
  for (const override of overrides) {
    if (override.providerId === providerId && override.modelId === modelId) {
      found = override;
    }
  }
  return found;
}

/**
 * The user's prices, replacing everything else for that model. A row with a
 * negative or non-finite price, or no usable date, is ignored.
 *
 * @param prices - the prices the catalogue found, if any
 * @param override - the user's row, if any
 * @returns the prices to use
 */
export function applyUserPriceOverride(
  prices: ModelPrices | undefined,
  override: UserPriceOverride | undefined,
): ModelPrices | undefined {
  if (override === undefined || !isUsableOverride(override)) return prices;
  return {
    inputPerMTokUsd: override.inputPerMTokUsd,
    outputPerMTokUsd: override.outputPerMTokUsd,
    cachedInputPerMTokUsd: override.cachedInputPerMTokUsd,
    tiers: [],
    asOfEpochMs: override.asOfEpochMs,
    source: "user-override",
  };
}

function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUsableOverride(override: UserPriceOverride): boolean {
  return (
    isPrice(override.inputPerMTokUsd) &&
    isPrice(override.outputPerMTokUsd) &&
    (override.cachedInputPerMTokUsd === undefined ||
      isPrice(override.cachedInputPerMTokUsd)) &&
    Number.isFinite(override.asOfEpochMs)
  );
}

// ---------------------------------------------------------------------------
// 4. Cost
// ---------------------------------------------------------------------------

function tokenCount(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `[research-helper] costOf: ${name} must be a non-negative number, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * The tier for a prompt of `promptTokens`: the one with the highest threshold
 * the prompt is **above**, or `undefined` for the base prices.
 *
 * @param tiers - the model's tiers, in any order
 * @param promptTokens - the whole prompt, cached tokens included
 * @returns the tier, or `undefined`
 */
export function selectPriceTier(
  tiers: readonly PriceTier[],
  promptTokens: number,
): PriceTier | undefined {
  let chosen: PriceTier | undefined;
  for (const tier of tiers) {
    if (
      promptTokens > tier.abovePromptTokens &&
      (chosen === undefined ||
        tier.abovePromptTokens > chosen.abovePromptTokens)
    ) {
      chosen = tier;
    }
  }
  return chosen;
}

/**
 * The estimated cost of one call, in fractional US dollars.
 *
 * The whole call is billed at the tier its prompt selects. A promotion that
 * has ended at `atEpochMs` gives way to its `then` prices, and its cached-input
 * price, which the promotion does not restate, is treated as unknown. Cached
 * tokens with no cached price are billed at the input price, which can only
 * over-quote.
 *
 * @param prices - the model's prices
 * @param tokens - the counts to price; `cachedInputTokens` is clamped to `inputTokens`
 * @param atEpochMs - when the call happens, for a promotion's end date
 * @returns the estimate, never rounded
 */
export function costOf(
  prices: ModelPrices,
  tokens: TokenCounts,
  atEpochMs: number,
): CostEstimate {
  const inputTokens = tokenCount("inputTokens", tokens.inputTokens);
  const outputTokens = tokenCount("outputTokens", tokens.outputTokens);
  const cachedTokens = Math.min(
    tokenCount("cachedInputTokens", tokens.cachedInputTokens ?? 0),
    inputTokens,
  );

  const promotionEnded =
    prices.promotion !== undefined && atEpochMs >= prices.promotion.endsEpochMs;
  const baseInput = promotionEnded
    ? prices.promotion?.thenInputPerMTokUsd
    : prices.inputPerMTokUsd;
  const baseOutput = promotionEnded
    ? prices.promotion?.thenOutputPerMTokUsd
    : prices.outputPerMTokUsd;
  const baseCached = promotionEnded ? undefined : prices.cachedInputPerMTokUsd;

  const tier = selectPriceTier(prices.tiers, inputTokens);
  const inputPrice = tier?.inputPerMTokUsd ?? baseInput;
  const outputPrice = tier?.outputPerMTokUsd ?? baseOutput;
  const cachedPrice = baseCached ?? inputPrice;

  const uncachedTokens = inputTokens - cachedTokens;
  const inputCostUsd =
    (uncachedTokens > 0 && inputPrice === undefined) ||
    (cachedTokens > 0 && cachedPrice === undefined)
      ? undefined
      : (uncachedTokens * (inputPrice ?? 0) +
          cachedTokens * (cachedPrice ?? 0)) /
        1e6;
  const outputCostUsd =
    outputTokens > 0 && outputPrice === undefined
      ? undefined
      : (outputTokens * (outputPrice ?? 0)) / 1e6;

  return {
    costUsd:
      inputCostUsd === undefined || outputCostUsd === undefined
        ? undefined
        : inputCostUsd + outputCostUsd,
    inputCostUsd,
    outputCostUsd,
    tierAbovePromptTokens: tier?.abovePromptTokens,
    asOfEpochMs: prices.asOfEpochMs,
    source: prices.source,
    isEstimate: true,
  };
}

// ---------------------------------------------------------------------------
// 5. The explicit conversion to the cent preferences (plan/00 §6 items 245, 252)
// ---------------------------------------------------------------------------

/**
 * Whole US cents, as a cent preference stores them, in fractional dollars.
 *
 * @param cents - e.g. `summary.confirmAboveCents`
 * @returns `cents / 100`
 */
export function centsToUsd(cents: number): number {
  return cents / 100;
}

/**
 * Whether a cost in dollars is above a cent preference. The cost is never
 * rounded to cents; the preference is converted to dollars instead.
 *
 * @param costUsd - fractional US dollars
 * @param cents - the preference's value, whole cents
 * @returns `costUsd > cents / 100`
 */
export function costAboveCents(costUsd: number, cents: number): boolean {
  return costUsd > centsToUsd(cents);
}

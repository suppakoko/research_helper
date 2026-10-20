/**
 * OpenRouter's public model catalogue, `GET /api/v1/models`, parsed.
 *
 * **Scope.** `P3-T07` step 5. The fetch is `./openRouterProvider.ts`'s
 * `listModels`/`listCatalogue`; this file only reads the answer, so it is
 * pure. `P3-T13` (`src/llm/shared/modelCatalogue.ts`, `pricing.ts`) is the
 * next reader: it uses this catalogue as the price source for all four
 * providers, because the endpoint needs no key (`docs/03` §9.4, "No
 * authentication required").
 *
 * **Authority.** `docs/03` §9.4's entry shape and its "Fields worth
 * exploiting" list; `docs/07` §4.3's `ModelInfo` for the result.
 *
 * | `ModelInfo` field | From |
 * |---|---|
 * | `id` | `id`, verbatim — an OpenRouter slug, never derived (no Anthropic dot rule is needed here; that rule maps a *native* id, `P3-T13`'s `slugMap.ts`) |
 * | `displayName` | `name`, else `id` |
 * | `contextWindowTokens` | `context_length`, else `top_provider.context_length` |
 * | `maxOutputTokens` | `top_provider.max_completion_tokens`, else the context window (the one bound the entry itself states) |
 * | `supportsJsonSchema` | `supported_parameters` contains `"structured_outputs"` (`docs/03` §7.4 item 1, §9.4) |
 * | `supportsStreaming` | `true`: OpenRouter streams every model as Chat Completions deltas (`docs/03` §6.4) |
 * | `supportsSystemPrompt` | `true`: the Chat Completions surface takes a `system` message for every model (`docs/03` §5.3) |
 * | `inputCostPerMTokUsd` | `Number(pricing.prompt) * 1e6` |
 * | `outputCostPerMTokUsd` | `Number(pricing.completion) * 1e6` |
 * | `dataPolicy` | `"unknown"` throughout — §9.4's entry declares no policy field |
 *
 * **Prices are decimal strings** (`docs/03` §9.4: "deliberately not JSON
 * numbers to avoid float issues"). A price is read only from a string that is
 * a plain non-negative decimal; a JSON number, a negative value or anything
 * else is "not published" (`undefined`), never coerced. The multiplication is
 * the card's formula exactly, `Number(s) * 1e6`, with no rounding.
 *
 * **`pricing.overrides[]` is kept** as {@link OpenRouterPriceOverride}, the
 * long-context surcharge tiers (`docs/03` §9.4, §12.3 item 2); `ModelInfo`
 * has no field for them, so an entry carries them beside its `ModelInfo`.
 *
 * **Data policy.** `docs/09` §3.4 rule 3 forbids guessing a policy to fill the
 * field. OpenRouter states per-endpoint policies on its endpoints listing
 * (`docs/03` §5.1, `GET /api/v1/models/{author}/{slug}/endpoints`), not in this
 * catalogue, so every model here is `"unknown"` until a card reads that
 * endpoint.
 *
 * **What is skipped.** An entry with no string `id` or no positive context
 * window cannot fill `ModelInfo`'s required numbers without inventing one, so
 * it is counted in {@link ParsedOpenRouterCatalogue.skipped} and left out.
 */

import type { ModelDataPolicy, ModelInfo } from "../types";

/** One `pricing.overrides[]` tier, prices per million tokens. */
export interface OpenRouterPriceOverride {
  /** `min_prompt_tokens`: the tier applies at or above this prompt size. */
  readonly minPromptTokens: number | undefined;
  readonly inputCostPerMTokUsd: number | undefined;
  readonly outputCostPerMTokUsd: number | undefined;
}

/** One catalogue entry: `docs/07` §4.3's `ModelInfo` plus what it cannot hold. */
export interface OpenRouterCatalogueEntry {
  readonly model: ModelInfo;
  /** `pricing.overrides[]`, in the catalogue's order; empty when none. */
  readonly priceOverrides: readonly OpenRouterPriceOverride[];
  /** `supported_parameters`, verbatim. */
  readonly supportedParameters: readonly string[];
}

/** The parsed catalogue. */
export interface ParsedOpenRouterCatalogue {
  readonly entries: readonly OpenRouterCatalogueEntry[];
  /** Entries left out because a required field was missing. */
  readonly skipped: number;
}

/** `docs/03` §9.4's structured-output capability flag. */
export const STRUCTURED_OUTPUTS_PARAMETER = "structured_outputs";

/** The policy every catalogue model carries: nothing declared, nothing guessed. */
export const UNDECLARED_DATA_POLICY: ModelDataPolicy = Object.freeze({
  trainsOnInputByDefault: "unknown",
  retention: Object.freeze({ days: "unknown", note: "" }),
});

/** A plain non-negative decimal, the form `docs/03` §9.4's prices take. */
const DECIMAL_PRICE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A positive finite number, or `undefined`. */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * A per-token decimal string as US dollars per million tokens.
 *
 * @param price - `pricing.prompt`, `pricing.completion` or an override's
 * @returns `Number(price) * 1e6`, or `undefined` when `price` is not a
 *   non-negative decimal string
 */
export function perMillionTokens(price: unknown): number | undefined {
  if (typeof price !== "string") return undefined;
  const trimmed = price.trim();
  if (!DECIMAL_PRICE.test(trimmed)) return undefined;
  const value = Number(trimmed) * 1e6;
  return Number.isFinite(value) ? value : undefined;
}

function toOverride(raw: Record<string, unknown>): OpenRouterPriceOverride {
  const min = raw.min_prompt_tokens;
  return {
    minPromptTokens:
      typeof min === "number" && Number.isFinite(min) && min >= 0
        ? min
        : undefined,
    inputCostPerMTokUsd: perMillionTokens(raw.prompt),
    outputCostPerMTokUsd: perMillionTokens(raw.completion),
  };
}

/**
 * One catalogue entry, or `undefined` when it cannot fill `ModelInfo`.
 *
 * @param raw - one element of the catalogue's `data` array
 * @returns the entry
 */
export function parseCatalogueEntry(
  raw: unknown,
): OpenRouterCatalogueEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id === "") return undefined;
  const top = isRecord(raw.top_provider) ? raw.top_provider : {};
  const contextWindowTokens =
    positiveNumber(raw.context_length) ?? positiveNumber(top.context_length);
  if (contextWindowTokens === undefined) return undefined;
  const maxOutputTokens =
    positiveNumber(top.max_completion_tokens) ?? contextWindowTokens;
  const pricing = isRecord(raw.pricing) ? raw.pricing : {};
  const supportedParameters = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.filter((p): p is string => typeof p === "string")
    : [];
  const overrides = Array.isArray(pricing.overrides)
    ? pricing.overrides.filter(isRecord).map(toOverride)
    : [];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  return {
    model: {
      id,
      displayName: name === "" ? id : name,
      contextWindowTokens,
      maxOutputTokens,
      supportsJsonSchema: supportedParameters.includes(
        STRUCTURED_OUTPUTS_PARAMETER,
      ),
      supportsStreaming: true,
      supportsSystemPrompt: true,
      inputCostPerMTokUsd: perMillionTokens(pricing.prompt),
      outputCostPerMTokUsd: perMillionTokens(pricing.completion),
      dataPolicy: UNDECLARED_DATA_POLICY,
    },
    priceOverrides: overrides,
    supportedParameters,
  };
}

/**
 * Parse `GET /api/v1/models`'s answer.
 *
 * `docs/03` §9.4 prints one entry but not the envelope; the answer is read as
 * `{ data: [...] }` (the envelope §9.1 prints for the OpenAI-compatible list)
 * or, failing that, as a bare array.
 *
 * @param parsed - the parsed answer body
 * @returns the entries, in the catalogue's order, and how many were skipped
 */
export function parseOpenRouterCatalogue(
  parsed: unknown,
): ParsedOpenRouterCatalogue {
  const list: readonly unknown[] = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.data)
      ? parsed.data
      : [];
  const entries: OpenRouterCatalogueEntry[] = [];
  let skipped = 0;
  for (const raw of list) {
    const entry = parseCatalogueEntry(raw);
    if (entry === undefined) skipped += 1;
    else entries.push(entry);
  }
  return { entries, skipped };
}

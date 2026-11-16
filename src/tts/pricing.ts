/**
 * The dated TTS price table — `plan/09` `P6-T10`: `docs/04` §4.2's three
 * Gemini TTS rows, the audio token rate, and the one function that prices a
 * TTS call.
 *
 * **Callers.** `src/pipeline/audioReport/estimate.ts` (`estimateScriptStep`,
 * `estimateAudioPlan`, `chunkReservation`) and, through `chunkReservation`,
 * `src/pipeline/audioReport/synthesize.ts`. Constructed nowhere: constants
 * and functions only.
 *
 * **Authority.** `docs/04` §4.2 (the prices, verified 2026-09-08, and the
 * measured 24.998 tok/s with the model it was measured on), §4.1 (the rate);
 * `plan/09` §0.2 item 24 (no price except in a dated, documented table with a
 * row-by-row test) and §0.4 line 21 (a user override wins; a model with
 * neither price is an unknown cost, which forces the confirmation).
 *
 * ## Decisions (DECIDED 2026-11-17, coordinator, under `plan/00` §6 item 313)
 *
 * 1. **The table names three TTS model ids, each as a lookup key on a line
 *    marked `PRICE ROW`.** `plan/09` §0.2 item 24 allows a price only in such
 *    a table, and a price row cannot be keyed without its model id. The
 *    rule behind `P6-T05`'s grep (`docs/04` §2.2, "do not hardcode") is about
 *    *choosing* a model: a row here is read only for a model already resolved
 *    from the live list or `tts.model`, never offered or chosen. The one
 *    compiled-in model choice stays `GEMINI_TTS_FALLBACK_MODEL`
 *    (`./geminiTts.ts`). `test/unit/tts/pricing.test.ts` holds the amended
 *    grep: every TTS id in `src` is on that fallback line or on a marked row.
 * 2. **Which model the rate was measured on is a field of its row**
 *    (`audioRateMeasured`), so the id is not repeated outside the table.
 * 3. **The user's override is looked up under the `gemini` provider id**:
 *    TTS reads the chat key (`plan/09` §0.4 line 24), and the price table's
 *    rows are keyed by provider and model (`UserPriceOverride`).
 */

import {
  applyUserPriceOverride,
  costOf,
  findUserPriceOverride,
  type ModelPrices,
  type UserPriceOverride,
} from "../llm/shared/pricing";

/** The heading date of `docs/04` §4.2. Not a claim that the table is current. */
export const TTS_PRICES_AS_OF = "2026-09-08";

/** Where {@link DOCUMENTED_TTS_PRICE_TABLE} is transcribed from. */
export const TTS_PRICES_SOURCE = "docs/04-audio-report-tts.md §4.2";

/** {@link TTS_PRICES_AS_OF} as epoch milliseconds (midnight UTC). */
export const TTS_PRICES_AS_OF_EPOCH_MS = Date.parse(
  `${TTS_PRICES_AS_OF}T00:00:00Z`,
);

/**
 * Audio output tokens billed per second of audio (`docs/04` §4.1–§4.2):
 * measured 2026-09-29 at 24.998 tok/s (`P0-T25`), on **one** model only — the
 * row whose `audioRateMeasured` is `true`. For any other model it is the
 * documented assumption, and the estimate says so.
 */
export const AUDIO_TOKENS_PER_SECOND = 25;

/** One row of {@link DOCUMENTED_TTS_PRICE_TABLE}. */
export interface DocumentedTtsPriceRow {
  readonly modelId: string;
  /** US dollars per million text input tokens. */
  readonly inputPerMTokUsd: number;
  /** US dollars per million audio output tokens. */
  readonly outputPerMTokUsd: number;
  /** Whether {@link AUDIO_TOKENS_PER_SECOND} was measured on this model. */
  readonly audioRateMeasured: boolean;
}

function row(
  modelId: string,
  inputPerMTokUsd: number,
  outputPerMTokUsd: number,
  audioRateMeasured: boolean,
): DocumentedTtsPriceRow {
  return Object.freeze({
    modelId,
    inputPerMTokUsd,
    outputPerMTokUsd,
    audioRateMeasured,
  });
}

/**
 * `docs/04` §4.2, row for row, in its order (decision 1). Update `docs/04`
 * first; the row test reads the document.
 */
export const DOCUMENTED_TTS_PRICE_TABLE: readonly DocumentedTtsPriceRow[] =
  Object.freeze([
    row("gemini-3.1-flash-tts-preview", 1.0, 20.0, false), // PRICE ROW
    row("gemini-2.5-flash-preview-tts", 0.5, 10.0, true), // PRICE ROW
    row("gemini-2.5-pro-preview-tts", 1.0, 20.0, false), // PRICE ROW
  ]);

/** The documented row for `modelId`, if the table has one. */
export function documentedTtsRow(
  modelId: string,
): DocumentedTtsPriceRow | undefined {
  return DOCUMENTED_TTS_PRICE_TABLE.find((r) => r.modelId === modelId);
}

/**
 * A model's TTS prices: the user's override when there is one (it replaces
 * the documented row), else the documented row dated
 * {@link TTS_PRICES_AS_OF}, else `undefined` — an unknown cost.
 *
 * @param modelId - the TTS model the run resolved
 * @param overrides - the user-editable price table (`UserPriceStore.list`)
 */
export function ttsPricesFor(
  modelId: string,
  overrides: readonly UserPriceOverride[] = [],
): ModelPrices | undefined {
  const documented = documentedTtsRow(modelId);
  const prices: ModelPrices | undefined =
    documented === undefined
      ? undefined
      : {
          inputPerMTokUsd: documented.inputPerMTokUsd,
          outputPerMTokUsd: documented.outputPerMTokUsd,
          cachedInputPerMTokUsd: undefined,
          tiers: [],
          asOfEpochMs: TTS_PRICES_AS_OF_EPOCH_MS,
          source: "documented-table",
        };
  return applyUserPriceOverride(
    prices,
    findUserPriceOverride(overrides, "gemini", modelId),
  );
}

/** Whether {@link AUDIO_TOKENS_PER_SECOND} was measured on `modelId`. */
export function audioRateMeasuredFor(modelId: string): boolean {
  return documentedTtsRow(modelId)?.audioRateMeasured === true;
}

/**
 * The cost of a TTS call or plan in fractional US dollars, or `undefined`
 * when it cannot be known (no price, or a needed price missing).
 *
 * @param prices - {@link ttsPricesFor}'s result
 * @param tokens - text input tokens and audio output tokens
 * @param atEpochMs - when the call happens (`costOf`)
 */
export function ttsCostOf(
  prices: ModelPrices | undefined,
  tokens: { readonly inputTokens: number; readonly outputTokens: number },
  atEpochMs: number,
): number | undefined {
  if (prices === undefined) return undefined;
  return costOf(prices, tokens, atEpochMs).costUsd;
}

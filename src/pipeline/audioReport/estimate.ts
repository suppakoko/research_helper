/**
 * The two-step audio estimate — `plan/09` `P6-T10`: an audio run priced
 * twice, before the script exists ({@link estimateScriptStep}, from the
 * target length) and after ({@link estimateAudioPlan}, from the real script
 * and its chunks), in characters, chunks, seconds, bytes, import-or-link and
 * dollars, from one dated TTS price table (`src/tts/pricing.ts`).
 *
 * **Callers.** `audioReportPipeline.ts` (`P6-T16`, not built) calls both for
 * the two confirmations of `plan/09` §0.4 line 13, and passes
 * {@link audioDialogPlan}'s figures to `shouldOpenCostDialog` and
 * `secondAcknowledgementFor` (`src/ui/dialogs/costConfirmDialog.ts`,
 * `src/pipeline/shared/estimate.ts`), which apply unchanged.
 * `synthesize.ts` (`P6-T11`) calls {@link chunkReservation} for each chunk's
 * budget reservation, replacing the `estimateChunk` stand-in it was built
 * with. Constructed nowhere: functions and constants only.
 *
 * **Authority.** `docs/04` §4.2 (prices and the audio token rate), §6.4's
 * note of 2026-11-16 (show the size), §9.3 (speaking rates), §11 (the worked
 * example this reproduces); `docs/06` §5.1 (`estTokens`), §5.4 (headroom);
 * `plan/09` §0.4 lines 13 and 21.
 *
 * ## Decisions (DECIDED 2026-11-17, coordinator, under `plan/00` §6 item 313)
 *
 * 1. **The script step prices the retry too.** `writeScript` makes at most
 *    two calls (`SCRIPT_ATTEMPTS_MAX`); the second is conditional and is
 *    reserved all the same, as the report run's rewrites are
 *    (`SynthesisCall.conditional`). Its input is the first call's plus the
 *    correction note listing every leak, so it is never under-quoted.
 * 2. **Headroom on both sides of a TTS estimate.** `withHeadroom` (×1.15) is
 *    applied to the input tokens and to the audio output tokens, since the
 *    duration is itself an estimate from a speaking rate; the script call's
 *    output is its ceiling (`scriptOutputCeiling`), which takes none, as
 *    every other call's `max_tokens` takes none (`estimateRun`).
 * 3. **Seconds.** English: `countSpokenWords` at 150 a minute. Korean:
 *    `countHangulSyllables` at 330 a minute, **plus** any Latin-letter words
 *    (the English terms §9.1 keeps) at 150 a minute, which the syllable count
 *    would otherwise leave out. Whole seconds, rounded up.
 * 4. **Bytes and the mode come from the unpadded seconds**, as the card
 *    says: `estimatedSeconds × 48 000 + WAV_HEADER_BYTES`, then
 *    `chooseAttachmentMode`. The file actually written decides the mode
 *    (`P6-T13`); this is the preview the dialog shows.
 * 5. **Before the script exists** the TTS figures come from
 *    `TARGET_MINUTES`: `minutes × 60` seconds, `minutes ×` the language's
 *    characters a minute (`docs/04` §9.3) for the text, and the chunk count
 *    at the language's chunk ceiling. They carry `provisional: true`.
 */

import { costOf, type ModelPrices } from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type {
  AudioChunk,
  AudioCostEstimate,
  AudioLanguage,
  AudioPlan,
  SpokenScript,
} from "../../model/audio";
import type { TrendReport } from "../../model/trend";
import { renderPrompt, type PromptTemplate } from "../../prompts";
import {
  chooseAttachmentMode,
  WAV_HEADER_BYTES,
  type AttachmentMode,
} from "../../tts/audioStore";
import { GEMINI_TTS_MAX_CHUNK_CHARS } from "../../tts/geminiTts";
import {
  AUDIO_TOKENS_PER_SECOND,
  audioRateMeasuredFor,
  ttsCostOf,
} from "../../tts/pricing";
import type { ReservationEstimate } from "../shared/budget";
import { withHeadroom, type PricedModel } from "../shared/estimate";
import { countHangulSyllables } from "./korean";
import {
  buildScriptInputs,
  correctionNote,
  countSpokenWords,
  SCRIPT_ATTEMPTS_MAX,
  SCRIPT_LEAKS,
  scriptOutputCeiling,
  SPOKEN_CHARS_PER_MINUTE,
  SPOKEN_KO_SYLLABLES_PER_MINUTE,
  SPOKEN_WORDS_PER_MINUTE,
  type ScriptLeakId,
} from "./script";

/** 24 kHz, 16-bit, mono PCM (`docs/04` §3.1): bytes per second of audio. */
export const PCM_BYTES_PER_SECOND = 48_000;

/** A Latin-letter word inside a Korean script (decision 3). */
const LATIN_WORD = /[A-Za-z]+(?:[-'][A-Za-z]+)*/gu;

/**
 * Seconds of speech `text` takes at the language's rate (decision 3),
 * unrounded.
 *
 * @param text - a script or one chunk of it
 * @param language - the language it is spoken in
 */
export function spokenSecondsOf(text: string, language: AudioLanguage): number {
  if (language === "en") {
    return (countSpokenWords(text) / SPOKEN_WORDS_PER_MINUTE) * 60;
  }
  const latinWords = text.match(LATIN_WORD)?.length ?? 0;
  return (
    (countHangulSyllables(text) / SPOKEN_KO_SYLLABLES_PER_MINUTE) * 60 +
    (latinWords / SPOKEN_WORDS_PER_MINUTE) * 60
  );
}

/** The WAV file's size for `seconds` of audio: PCM plus the 44-byte header. */
export function wavBytesFor(seconds: number): number {
  return Math.ceil(seconds) * PCM_BYTES_PER_SECOND + WAV_HEADER_BYTES;
}

/** Audio output tokens for `seconds`, before headroom. */
export function audioTokensFor(seconds: number): number {
  return Math.ceil(seconds * AUDIO_TOKENS_PER_SECOND - 1e-9);
}

/** One TTS request's text input: the chunk with the style prefix before it. */
function chunkInputTokens(
  text: string,
  stylePrefix: string,
  modelId: string,
): number {
  return estTokens(stylePrefix + text, modelId);
}

// ---------------------------------------------------------------------------
// 1. One chunk's reservation (synthesize.ts)
// ---------------------------------------------------------------------------

/**
 * What one TTS request reserves on the run's budget guard: its input tokens
 * (the chunk and the style prefix), its audio tokens from the chunk's
 * speaking time, both through `withHeadroom`, and, when the model is
 * priced, the cost and the prices a reported usage is settled at.
 *
 * @param chunk - the chunk to be sent
 * @param plan - the plan's language, model and style prefix
 * @param prices - `ttsPricesFor(plan.model, overrides)`
 * @param atEpochMs - when the request is made
 */
export function chunkReservation(
  chunk: Pick<AudioChunk, "text">,
  plan: Pick<AudioPlan, "language" | "model" | "stylePrefix">,
  prices: ModelPrices | undefined,
  atEpochMs: number,
): ReservationEstimate {
  const inputTokens = withHeadroom(
    chunkInputTokens(chunk.text, plan.stylePrefix, plan.model),
  );
  const outputTokens = withHeadroom(
    audioTokensFor(spokenSecondsOf(chunk.text, plan.language)),
  );
  const costUsd = ttsCostOf(prices, { inputTokens, outputTokens }, atEpochMs);
  return {
    inputTokens,
    outputTokens,
    ...(costUsd !== undefined && { costUsd }),
    ...(prices !== undefined && { prices }),
  };
}

// ---------------------------------------------------------------------------
// 2. After the script: the audio plan (the second confirmation)
// ---------------------------------------------------------------------------

/** What {@link estimateAudioPlan} is given. */
export interface AudioPlanInput {
  readonly reportId: string;
  /** The validated script (its text and language). */
  readonly script: Pick<SpokenScript, "text" | "language">;
  /** `chunkScript(script.text, { language })` (`src/tts/chunk.ts`). */
  readonly chunks: readonly AudioChunk[];
  /** The TTS model the run resolved (`TTSProvider.resolveModel`). */
  readonly model: string;
  readonly voice: string;
  /** `STYLE_PREFIX` (`./synthesize.ts`), captured once for the run. */
  readonly stylePrefix: string;
  /** `ttsPricesFor(model, overrides)`; `undefined` is an unknown cost. */
  readonly prices: ModelPrices | undefined;
  /** When the run would start, for `costOf`. */
  readonly atEpochMs: number;
}

/**
 * `docs/07` §5.2's `AudioPlan` from the real script (`plan/09` §0.4 line 13):
 * characters, chunks, seconds, bytes, import-or-link and the cost.
 *
 * @throws RangeError for a plan with no chunk, or chunks of another script
 */
export function estimateAudioPlan(input: AudioPlanInput): AudioPlan {
  const { chunks, script } = input;
  if (chunks.length === 0) {
    throw new RangeError("[research-helper] an audio plan needs a chunk");
  }
  const rebuilt = chunks.map((c) => c.text + c.separator).join("");
  if (rebuilt !== script.text) {
    throw new RangeError(
      "[research-helper] the chunks do not rebuild the script they are planned for",
    );
  }
  const exactSeconds = chunks.reduce(
    (sum, c) => sum + spokenSecondsOf(c.text, script.language),
    0,
  );
  const estimatedSeconds = Math.ceil(exactSeconds);
  const estimatedBytes = wavBytesFor(exactSeconds);
  const inputTokens = withHeadroom(
    chunks.reduce(
      (sum, c) =>
        sum + chunkInputTokens(c.text, input.stylePrefix, input.model),
      0,
    ),
  );
  const outputTokens = withHeadroom(audioTokensFor(exactSeconds));
  const cost: AudioCostEstimate = {
    usd: ttsCostOf(
      input.prices,
      { inputTokens, outputTokens },
      input.atEpochMs,
    ),
    inputTokens,
    outputTokens,
    rateMeasuredOnModel: audioRateMeasuredFor(input.model),
  };
  return {
    reportId: input.reportId,
    language: script.language,
    model: input.model,
    voice: input.voice,
    stylePrefix: input.stylePrefix,
    chunks,
    totalChars: chunks.reduce((sum, c) => sum + c.chars, 0),
    estimatedSeconds,
    estimatedBytes,
    mode: chooseAttachmentMode(estimatedBytes),
    cost,
  };
}

/**
 * The figures `secondAcknowledgementFor` and `shouldOpenCostDialog` read:
 * one call per chunk, and the plan's cost (`undefined` forces the dialog).
 */
export function audioDialogPlan(plan: Pick<AudioPlan, "chunks" | "cost">): {
  readonly calls: number;
  readonly costUsd: number | undefined;
} {
  return { calls: plan.chunks.length, costUsd: plan.cost.usd };
}

// ---------------------------------------------------------------------------
// 3. Before the script: the script step (the first confirmation)
// ---------------------------------------------------------------------------

/** What {@link estimateScriptStep} is given. */
export interface ScriptStepInput {
  /** The report the script will be written from (`chooseScriptSource`). */
  readonly source: Pick<TrendReport, "sections" | "collectionName" | "scope">;
  readonly language: AudioLanguage;
  /** `resolveTargetMinutes`' result, 1–60. */
  readonly targetMinutes: number;
  /** `AUDIO_SCRIPT_EN` or `AUDIO_SCRIPT_KO`, as the call will use it. */
  readonly prompt: PromptTemplate;
  /** `citationMapFor(…).text`, as the call will send it. */
  readonly citationMap: string;
  /** `reportModel` (the `strong` purpose) and its prices. */
  readonly scriptModel: PricedModel;
  /** The TTS model the run resolved, and `ttsPricesFor`'s prices for it. */
  readonly ttsModel: PricedModel;
  /** `STYLE_PREFIX` (`./synthesize.ts`). */
  readonly stylePrefix: string;
  /** When the run would start, for `costOf`. */
  readonly atEpochMs: number;
}

/** The script call's part of {@link ScriptStepEstimate}. */
export interface ScriptCallEstimate {
  readonly modelId: string;
  /** Two: the call and its one conditional retry (decision 1). */
  readonly calls: number;
  /** Both calls' input, through `withHeadroom`. */
  readonly inputTokens: number;
  /** Both calls' ceiling (`scriptOutputCeiling`). */
  readonly outputTokens: number;
  readonly costUsd: number | undefined;
  /** The prices' date, shown beside the cost; absent with no price. */
  readonly pricesAsOfEpochMs: number | undefined;
}

/** The TTS step as the target length predicts it (decision 5). */
export interface ProvisionalAudioEstimate extends AudioCostEstimate {
  /** Always `true`: to be replaced by {@link estimateAudioPlan}. */
  readonly provisional: true;
  readonly totalChars: number;
  readonly chunks: number;
  readonly estimatedSeconds: number;
  readonly estimatedBytes: number;
  readonly mode: AttachmentMode;
}

/** The first confirmation's figures. */
export interface ScriptStepEstimate {
  readonly script: ScriptCallEstimate;
  readonly tts: ProvisionalAudioEstimate;
  /** Every request the run may make: the script calls and one per chunk. */
  readonly calls: number;
  /** Script plus TTS; `undefined` when either cannot be known. */
  readonly costUsd: number | undefined;
}

const EVERY_LEAK: readonly ScriptLeakId[] = [
  ...SCRIPT_LEAKS.map((l) => l.id),
  "empty",
];

/**
 * The first confirmation (`plan/09` §0.4 line 13): the script call priced
 * from what it will send, and the TTS step from `TARGET_MINUTES`, marked
 * provisional.
 *
 * @throws RangeError for a target outside 1–60 (`buildScriptInputs`)
 */
export function estimateScriptStep(input: ScriptStepInput): ScriptStepEstimate {
  const { language, prompt, scriptModel, ttsModel } = input;
  const inputs = buildScriptInputs(
    input.source,
    input.targetMinutes,
    input.citationMap,
  );
  const rendered = renderPrompt(prompt, inputs.variables);
  const first = estTokens(
    `${rendered.system}\n${rendered.user}`,
    scriptModel.modelId,
  );
  const retry = estTokens(
    `${rendered.system}\n${rendered.user}\n\n${correctionNote(EVERY_LEAK)}`,
    scriptModel.modelId,
  );
  const scriptInput =
    withHeadroom(first) + (SCRIPT_ATTEMPTS_MAX - 1) * withHeadroom(retry);
  const scriptOutput =
    scriptOutputCeiling(prompt, language, input.targetMinutes) *
    SCRIPT_ATTEMPTS_MAX;
  const scriptCost =
    scriptModel.prices === undefined
      ? undefined
      : costOf(
          scriptModel.prices,
          { inputTokens: scriptInput, outputTokens: scriptOutput },
          input.atEpochMs,
        ).costUsd;

  const seconds = input.targetMinutes * 60;
  const totalChars = input.targetMinutes * SPOKEN_CHARS_PER_MINUTE[language];
  const chunks = Math.ceil(totalChars / GEMINI_TTS_MAX_CHUNK_CHARS[language]);
  const prefixTokens = estTokens(input.stylePrefix, ttsModel.modelId);
  const textTokens = estTokens(
    sampleText(language, totalChars),
    ttsModel.modelId,
  );
  const ttsInput = withHeadroom(textTokens + prefixTokens * chunks);
  const ttsOutput = withHeadroom(audioTokensFor(seconds));
  const ttsUsd = ttsCostOf(
    ttsModel.prices,
    { inputTokens: ttsInput, outputTokens: ttsOutput },
    input.atEpochMs,
  );
  const estimatedBytes = wavBytesFor(seconds);
  return {
    script: {
      modelId: scriptModel.modelId,
      calls: SCRIPT_ATTEMPTS_MAX,
      inputTokens: scriptInput,
      outputTokens: scriptOutput,
      costUsd: scriptCost,
      pricesAsOfEpochMs: scriptModel.prices?.asOfEpochMs,
    },
    tts: {
      provisional: true,
      usd: ttsUsd,
      inputTokens: ttsInput,
      outputTokens: ttsOutput,
      rateMeasuredOnModel: audioRateMeasuredFor(ttsModel.modelId),
      totalChars,
      chunks,
      estimatedSeconds: seconds,
      estimatedBytes,
      mode: chooseAttachmentMode(estimatedBytes),
    },
    calls: SCRIPT_ATTEMPTS_MAX + chunks,
    costUsd:
      scriptCost === undefined || ttsUsd === undefined
        ? undefined
        : scriptCost + ttsUsd,
  };
}

/**
 * A stand-in text of `chars` characters in the language's script, so
 * `estTokens` applies the language's own ratio (`docs/06` §5.1) to a text
 * that does not exist yet.
 */
function sampleText(language: AudioLanguage, chars: number): string {
  return (language === "en" ? "a" : "가").repeat(Math.max(0, chars));
}

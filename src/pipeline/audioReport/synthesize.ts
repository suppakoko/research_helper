/**
 * The synthesis loop — `plan/09` `P6-T11`: the chunks of one audio plan sent
 * to the TTS provider **one at a time**, each under a budget reservation,
 * retried with byte-identical inputs, and cancelled cleanly.
 *
 * **Caller.** `audioReportPipeline.ts` (`P6-T16`) calls
 * {@link synthesizeChunks} after the second confirmation; it passes the TTS
 * client `registerProviders` built (`LLMServices.tts`), the per-chunk estimate
 * of `P6-T10` and the job's `LLMCallContext`. Constructed nowhere: a function.
 *
 * **Authority.** `docs/04` §5.3 (one voice, one model, one style prefix, all
 * captured once; a retried chunk is identical), §5.4 (sequential; the note of
 * 2026-11-16 on where finished chunks live), §6.3 (one sample rate, or fail);
 * `docs/07` §7.4 (an audio cancel discards the partial segments), §12.6 (the
 * `Synthesizing` state and its `Paused` loop); `plan/07` §0.2 items 11, 12 and
 * 18 (every paid call carries a budget; a ceiling pauses with the item
 * pending).
 *
 * ## The shape of a run, and what it hands back
 *
 * - **Done**: every chunk's PCM, in order, at one sample rate, with the summed
 *   usage. Assembly is `P6-T12`'s (`src/tts/audioStore.ts`).
 * - **Stopped**: a budget refusal (`reason: "budget"`, the job pauses and
 *   asks), or an error the retry policy does not retry (`reason: "error"`).
 *   The finished chunks are handed back **in memory**, with the index of the
 *   chunk that did not finish; passing them in again as
 *   {@link SynthesisInput.completed} resumes from there in the same session
 *   (`plan/09` §0.4 line 14). Nothing is written to disk.
 * - **Cancelled**: `OperationCancelledError` is thrown, the request in flight
 *   is aborted through the job's token, and no PCM is returned (FR-42).
 *
 * ## Retries
 *
 * `TTSProvider.synthesize` makes one attempt and never retries (`P6-T05`);
 * this loop retries through `withRetry` (`src/core/http/retry.ts`) under the
 * Gemini host's policy (`LLM_RETRY_BUDGET`) and the 90-second request budget,
 * so the policy is the one every LLM call has. **That policy does not retry a
 * timeout** (owner, `plan/00` §6 item 230; `isRetriedAutomatically`), so a
 * timed-out chunk stops the loop with the chunks before it kept, and the user
 * may retry by hand; `P6-T11` step 3's "timeout" is read under that owner rule
 * (`plan/reports/P6-T11.md`). Every attempt sends the same request object,
 * built once per chunk.
 */

import type { Clock } from "../../core/clock";
import {
  BudgetExceededError,
  ConfigurationError,
  OperationCancelledError,
  TTSError,
} from "../../core/errors";
import {
  REQUEST_BUDGET_MS,
  retryPolicyFromBudget,
  withRetry,
  type RetryPolicy,
} from "../../core/http/retry";
import type { Logger } from "../../core/logger";
import { LLM_RETRY_BUDGET } from "../../core/rateLimit/hostLimiter";
import type { BudgetGuard, LLMCallContext } from "../../llm/types";
import type { AudioChunk, AudioLanguage, AudioPlan } from "../../model/audio";
import type { Usage } from "../../model/usage";
import type {
  AudioArtifact,
  SynthesisRequest,
  TTSProvider,
} from "../../tts/types";
import type {
  BudgetReservation,
  ReservationEstimate,
  RunBudgetGuard,
} from "../shared/budget";

/**
 * `docs/04` §5.3's style instruction, verbatim: prepended, byte for byte, to
 * every chunk (Gemini has no style parameter, §2.9), with the "no commentary"
 * clause and the delimiter §2.9 asks for. The plan carries it
 * (`AudioPlan.stylePrefix`), so it is captured once per run.
 */
export const STYLE_PREFIX =
  "Read the following aloud in a calm, measured, professional tone, as a " +
  "researcher briefing colleagues. Do not add any commentary of your own.\n\n---\n\n";

/** The BCP-47 tag a chunk is sent with: the plugin ships these two (`docs/07` §4.4). */
const LANGUAGE_TAGS: Readonly<Record<AudioLanguage, string>> = Object.freeze({
  en: "en-US",
  ko: "ko-KR",
});

/** One finished chunk: its PCM and the exact request that produced it. */
export interface SynthesizedChunk {
  readonly index: number;
  /** The request sent; a resumed run re-checks it, so a reused chunk is identical. */
  readonly request: SynthesisRequest;
  /** Raw 16-bit PCM, no header (`docs/04` §3.1). */
  readonly pcm: Uint8Array;
  readonly sampleRateHz: number;
  readonly durationSeconds: number | undefined;
  readonly usage: Usage | undefined;
}

/** What a run is started with. */
export interface SynthesisInput {
  /** The confirmed plan: its voice, model and prefix are used unchanged. */
  readonly plan: Pick<
    AudioPlan,
    "reportId" | "language" | "model" | "voice" | "stylePrefix" | "chunks"
  >;
  /**
   * Chunks finished earlier **in this session** for the same plan (a
   * `stopped` result's `completed`), in order from chunk 0. Each must have
   * been made from exactly the request this plan builds for it.
   */
  readonly completed?: readonly SynthesizedChunk[];
  /** Carried on every request, never sent on the wire. */
  readonly traceId: string;
}

/** What the loop needs. */
export interface SynthesisDeps {
  /** `LLMServices.tts` (`src/bootstrap/registerProviders.ts`). */
  readonly tts: Pick<TTSProvider, "synthesize">;
  /**
   * One chunk's reservation (`P6-T10`): its input and audio tokens and, when
   * the model is priced, the cost and the prices the reported tokens are
   * settled at (`ReservationEstimate.prices`).
   */
  readonly estimateChunk: (chunk: AudioChunk) => ReservationEstimate;
  /** For the waits between attempts and the request budget. */
  readonly clock: Clock;
  /**
   * The retry policy; Gemini's `LLM_RETRY_BUDGET` by default, as the HTTP
   * client applies it to every Gemini request.
   */
  readonly retry?: RetryPolicy;
  /**
   * Called before each chunk is sent, with the 0-based index and the count:
   * the job renders "chunk n of N" from it (`docs/07` §12.6).
   */
  readonly onChunk?: (index: number, total: number) => void;
  readonly logger?: Logger;
}

/** Every chunk made. */
export interface SynthesisDone {
  readonly kind: "done";
  readonly chunks: readonly SynthesizedChunk[];
  /** The one rate every chunk came back at (`docs/04` §6.3). */
  readonly sampleRateHz: number;
  /** Summed over every chunk, a reused one included; absent when none reported any. */
  readonly usage: Usage | undefined;
}

/** The loop stopped before the last chunk; the finished ones are kept in memory. */
export interface SynthesisStopped {
  readonly kind: "stopped";
  /** `budget`: a ceiling refused the next chunk (pause and ask). */
  readonly reason: "budget" | "error";
  readonly error: unknown;
  /** The chunks finished before {@link pendingIndex}, in order. */
  readonly completed: readonly SynthesizedChunk[];
  /** The chunk that did not finish. */
  readonly pendingIndex: number;
}

export type SynthesisResult = SynthesisDone | SynthesisStopped;

/** One reservation on whatever guard the context carries (`withBudget`'s rule). */
function reserve(
  guard: BudgetGuard,
  estimate: ReservationEstimate,
): Pick<BudgetReservation, "release"> & { settle(usage: Usage): void } {
  const run = guard as Partial<RunBudgetGuard>;
  if (typeof run.reserveCall === "function") return run.reserveCall(estimate);
  guard.reserve(estimate);
  return {
    settle: (usage) => {
      guard.settle(usage);
    },
    release: () => undefined,
  };
}

/** The request chunk `chunk` is sent with: built once, sent on every attempt. */
function requestFor(
  input: SynthesisInput,
  chunk: AudioChunk,
): SynthesisRequest {
  const { plan } = input;
  return {
    text: chunk.text,
    language: LANGUAGE_TAGS[plan.language],
    voice: plan.voice,
    model: plan.model,
    styleInstruction: plan.stylePrefix,
    traceId: input.traceId,
  };
}

function sameRequest(a: SynthesisRequest, b: SynthesisRequest): boolean {
  return (
    a.text === b.text &&
    a.language === b.language &&
    a.voice === b.voice &&
    a.model === b.model &&
    a.styleInstruction === b.styleInstruction
  );
}

function addCount(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  return a === undefined ? b : b === undefined ? a : a + b;
}

/** The usage of every chunk, summed; `undefined` when none reported any. */
function sumUsage(chunks: readonly SynthesizedChunk[]): Usage | undefined {
  let total: Usage | undefined;
  for (const { usage } of chunks) {
    if (usage === undefined) continue;
    total =
      total === undefined
        ? { ...usage }
        : {
            inputTokens: addCount(total.inputTokens, usage.inputTokens),
            outputTokens: addCount(total.outputTokens, usage.outputTokens),
            totalTokens: addCount(total.totalTokens, usage.totalTokens),
            costUsd: addCount(total.costUsd, usage.costUsd),
          };
  }
  return total;
}

function sampleRateChanged(
  index: number,
  got: number | undefined,
  expected: number | undefined,
): TTSError {
  return new TTSError(
    `sample rate changed: chunk ${index} came back at ` +
      `${got === undefined ? "an unknown rate" : `${got} Hz`}, expected ` +
      `${expected === undefined ? "a known rate" : `${expected} Hz`}; ` +
      "refusing to join them (docs/04 §6.3)",
    {
      reason: "sample-rate",
      chunk: index,
      expected: expected ?? null,
      got: got ?? null,
    },
  );
}

/**
 * Send every chunk of `input.plan`, one at a time (`P6-T11`).
 *
 * @param input - the confirmed plan, and any chunks finished earlier
 * @param deps - see {@link SynthesisDeps}
 * @param ctx - the job's context: its token cancels, its `budget` is required
 * @returns `done` with every chunk, or `stopped` with the finished ones
 * @throws OperationCancelledError on a cancel, with no PCM kept
 * @throws ConfigurationError when `ctx.budget` is absent, before any request
 */
export async function synthesizeChunks(
  input: SynthesisInput,
  deps: SynthesisDeps,
  ctx: LLMCallContext,
): Promise<SynthesisResult> {
  const { plan } = input;
  const { budget } = ctx;
  if (budget === undefined) {
    // Fail closed, as the shared router does (owner, `plan/00` §6 item 278(a)).
    throw new ConfigurationError(
      "a TTS call carries no budget guard (LLMCallContext.budget); nothing is sent",
      { model: plan.model },
    );
  }
  const total = plan.chunks.length;
  const policy = deps.retry ?? retryPolicyFromBudget(LLM_RETRY_BUDGET);
  const finished: SynthesizedChunk[] = [];
  let sampleRateHz: number | undefined;

  const cancelled = (): never => {
    finished.length = 0;
    ctx.token.throwIfCancelled();
    throw new OperationCancelledError({ kind: "user" });
  };

  for (const [index, done] of (input.completed ?? []).entries()) {
    const chunk = plan.chunks[index];
    if (
      chunk === undefined ||
      done.index !== index ||
      !sameRequest(done.request, requestFor(input, chunk))
    ) {
      throw new RangeError(
        `completed chunk ${index} was not made from this plan's chunk ${index}`,
      );
    }
    if (sampleRateHz !== undefined && done.sampleRateHz !== sampleRateHz) {
      throw sampleRateChanged(index, done.sampleRateHz, sampleRateHz);
    }
    sampleRateHz = done.sampleRateHz;
    finished.push(done);
  }

  for (let index = finished.length; index < total; index += 1) {
    const chunk = plan.chunks[index];
    if (chunk === undefined) break;
    if (ctx.token.isCancellationRequested) cancelled();
    deps.onChunk?.(index, total);
    ctx.progress?.setProgress(index, total);

    const request = requestFor(input, chunk);
    const estimate = deps.estimateChunk(chunk);
    let audio: AudioArtifact;
    try {
      audio = await withRetry(
        async () => {
          const reservation = reserve(budget, estimate);
          try {
            await ctx.beforeSend?.();
            const answer = await deps.tts.synthesize(request, {
              token: ctx.token,
            });
            reservation.settle(
              answer.usage ?? {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
                costUsd: undefined,
              },
            );
            return answer;
          } catch (error) {
            reservation.release();
            throw error;
          }
        },
        {
          policy,
          clock: deps.clock,
          token: ctx.token,
          budget: { totalMs: REQUEST_BUDGET_MS },
          onRetry: ({ attempt, delayMs, error }) => {
            deps.logger?.info("tts chunk retried", {
              chunk: index,
              attempt,
              delayMs,
              error: error instanceof Error ? error.name : "unknown",
            });
          },
        },
      );
    } catch (error) {
      if (
        error instanceof OperationCancelledError ||
        ctx.token.isCancellationRequested
      ) {
        cancelled();
      }
      return {
        kind: "stopped",
        reason: error instanceof BudgetExceededError ? "budget" : "error",
        error,
        completed: [...finished],
        pendingIndex: index,
      };
    }

    const rate = audio.sampleRateHz;
    if (
      rate === undefined ||
      (sampleRateHz !== undefined && rate !== sampleRateHz)
    ) {
      return {
        kind: "stopped",
        reason: "error",
        error: sampleRateChanged(index, rate, sampleRateHz),
        completed: [...finished],
        pendingIndex: index,
      };
    }
    sampleRateHz = rate;
    finished.push({
      index,
      request,
      pcm: audio.data,
      sampleRateHz: rate,
      durationSeconds: audio.durationSeconds,
      usage: audio.usage,
    });
  }

  if (ctx.token.isCancellationRequested) cancelled();
  ctx.progress?.setProgress(total, total);
  if (sampleRateHz === undefined) {
    throw new RangeError("an audio plan with no chunk cannot be synthesized");
  }
  return {
    kind: "done",
    chunks: finished,
    sampleRateHz,
    usage: sumUsage(finished),
  };
}

/**
 * `plan/09` `P6-T11` — the synthesis loop (`synthesizeChunks` in
 * `src/pipeline/audioReport/synthesize.ts`), layer 1: plain Node, a fake TTS
 * provider, no network and no spend.
 */

import { describe, expect, it } from "vitest";

import type { Clock } from "../../../src/core/clock";
import {
  AuthenticationError,
  BudgetExceededError,
  ConfigurationError,
  OperationCancelledError,
  RateLimitError,
  TimeoutError,
  TTSError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type { RetryPolicy } from "../../../src/core/http/retry";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { BudgetGuard, LLMCallContext } from "../../../src/llm/types";
import type { AudioChunk } from "../../../src/model/audio";
import type { Usage } from "../../../src/model/usage";
import {
  STYLE_PREFIX,
  type SynthesisDeps,
  type SynthesisInput,
  synthesizeChunks,
} from "../../../src/pipeline/audioReport/synthesize";
import type {
  BudgetReservation,
  ReservationEstimate,
  RunBudgetGuard,
} from "../../../src/pipeline/shared/budget";
import type { AudioArtifact, SynthesisRequest } from "../../../src/tts/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function chunks(...texts: string[]): AudioChunk[] {
  return texts.map((text, index) => ({
    index,
    text,
    chars: text.length,
    separator: index === texts.length - 1 ? "" : " ",
  }));
}

function plan(
  texts: string[] = ["One.", "Two.", "Three."],
): SynthesisInput["plan"] {
  return {
    reportId: "report-1",
    language: "en",
    model: "gemini-9.9-flash-tts",
    voice: "Charon",
    stylePrefix: STYLE_PREFIX,
    chunks: chunks(...texts),
  };
}

function usage(input: number, output: number): Usage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    costUsd: undefined,
  };
}

function artifact(
  request: SynthesisRequest,
  bytes: number,
  sampleRateHz: number | undefined,
): AudioArtifact {
  return {
    data: new Uint8Array(bytes).fill(request.text.length),
    mimeType: "audio/L16;codec=pcm;rate=24000",
    fileExtension: "pcm",
    durationSeconds: bytes / 48000,
    sampleRateHz,
    model: request.model,
    voice: request.voice,
    usage: usage(10, 25),
  };
}

type Step =
  | { readonly ok: number; readonly rate?: number | undefined }
  | { readonly fail: Error }
  | { readonly hang: true };

/** A TTS provider answering call `i` from `steps[i]`, recording every request. */
function fakeTts(steps: readonly Step[]) {
  const requests: SynthesisRequest[] = [];
  const contexts: LLMCallContext[] = [];
  const tts = {
    requests,
    contexts,
    synthesize(
      request: SynthesisRequest,
      ctx: LLMCallContext,
    ): Promise<AudioArtifact> {
      const step = steps[requests.length];
      requests.push(request);
      contexts.push(ctx);
      if (step === undefined) {
        return Promise.reject(new Error("unexpected extra call"));
      }
      if ("fail" in step) return Promise.reject(step.fail);
      if ("hang" in step) {
        return new Promise((_resolve, reject) => {
          ctx.token.onCancelled((reason) => {
            reject(new OperationCancelledError(reason));
          });
        });
      }
      return Promise.resolve(
        artifact(request, step.ok, "rate" in step ? step.rate : 24000),
      );
    },
  };
  return tts;
}

/** A run guard that records reservations, and refuses the `refuseAt`-th one. */
function fakeGuard(refuseAt?: number) {
  const log: string[] = [];
  let n = 0;
  const guard: BudgetGuard & Pick<RunBudgetGuard, "reserveCall"> = {
    spentUsd: 0,
    limitUsd: undefined,
    reserve: () => undefined,
    settle: () => undefined,
    reserveCall(estimate: ReservationEstimate): BudgetReservation {
      n += 1;
      if (n === refuseAt) {
        log.push("refused");
        throw new BudgetExceededError("run ceiling reached");
      }
      log.push(`reserve ${estimate.outputTokens}`);
      return {
        costUsd: estimate.costUsd,
        settle: (u: Usage) => {
          log.push(`settle ${u.outputTokens ?? "?"}`);
          return {} as ReturnType<BudgetReservation["settle"]>;
        },
        release: () => {
          log.push("release");
        },
      };
    },
  };
  return { guard, log };
}

/** A clock whose waits return at once and are recorded. */
function instantClock(): Clock & { readonly slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => 1_800_000_000_000,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

const POLICY: RetryPolicy = { maxAttempts: 5, nextDelayMs: () => 1000 };

function deps(
  tts: ReturnType<typeof fakeTts>,
  extra: Partial<Omit<SynthesisDeps, "clock">> = {},
): SynthesisDeps & {
  readonly clock: ReturnType<typeof instantClock>;
  readonly seen: string[];
} {
  const seen: string[] = [];
  return {
    tts,
    estimateChunk: (chunk) => ({
      inputTokens: chunk.chars,
      outputTokens: 1500,
    }),
    clock: instantClock(),
    retry: POLICY,
    onChunk: (index, total) => {
      seen.push(`${index + 1}/${total}`);
    },
    seen,
    ...extra,
  };
}

function ctx(
  guard: BudgetGuard | undefined = fakeGuard().guard,
): LLMCallContext & {
  readonly source: ReturnType<typeof createCancellationTokenSource>;
} {
  const source = createCancellationTokenSource();
  return {
    source,
    token: source.token,
    ...(guard !== undefined && { budget: guard }),
  };
}

const input = (
  p = plan(),
  extra: Partial<SynthesisInput> = {},
): SynthesisInput => ({
  plan: p,
  traceId: "trace-1",
  ...extra,
});

// ---------------------------------------------------------------------------
// Done when, line 1
// ---------------------------------------------------------------------------

describe("synthesizeChunks — in order, identical inputs (docs/04 §5.3)", () => {
  it("sends three chunks one at a time with the same prefix, voice and model", async () => {
    const tts = fakeTts([{ ok: 100 }, { ok: 200 }, { ok: 300 }]);
    const d = deps(tts);
    const { guard, log } = fakeGuard();
    const result = await synthesizeChunks(input(), d, ctx(guard));

    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(tts.requests.map((r) => r.text)).toEqual(["One.", "Two.", "Three."]);
    for (const r of tts.requests) {
      expect(r.styleInstruction).toBe(STYLE_PREFIX);
      expect(r.voice).toBe("Charon");
      expect(r.model).toBe("gemini-9.9-flash-tts");
      expect(r.language).toBe("en-US");
      expect(r.traceId).toBe("trace-1");
    }
    expect(d.seen).toEqual(["1/3", "2/3", "3/3"]);
    expect(result.chunks.map((c) => c.pcm.byteLength)).toEqual([100, 200, 300]);
    expect(result.chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(result.sampleRateHz).toBe(24000);
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 75,
      totalTokens: 105,
      costUsd: undefined,
    });
    expect(log).toEqual([
      "reserve 1500",
      "settle 25",
      "reserve 1500",
      "settle 25",
      "reserve 1500",
      "settle 25",
    ]);
  });

  it("never has two requests in flight", async () => {
    let inFlight = 0;
    let most = 0;
    const tts = {
      requests: [] as SynthesisRequest[],
      contexts: [] as LLMCallContext[],
      async synthesize(request: SynthesisRequest): Promise<AudioArtifact> {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return artifact(request, 10, 24000);
      },
    };
    await synthesizeChunks(input(), deps(tts), ctx());
    expect(most).toBe(1);
  });

  it("sends Korean chunks tagged ko-KR", async () => {
    const tts = fakeTts([{ ok: 2 }]);
    const p = { ...plan(["하나."]), language: "ko" as const };
    await synthesizeChunks(input(p), deps(tts), ctx());
    expect(tts.requests[0]?.language).toBe("ko-KR");
  });

  it("retries a 429 on chunk 2 with the very same request, after Retry-After", async () => {
    const tts = fakeTts([
      { ok: 10 },
      { fail: new RateLimitError(429, 2000, "gemini") },
      { ok: 20 },
      { ok: 30 },
    ]);
    const d = deps(tts);
    const { guard, log } = fakeGuard();
    const result = await synthesizeChunks(input(), d, ctx(guard));
    expect(result.kind).toBe("done");
    expect(tts.requests).toHaveLength(4);
    expect(tts.requests[2]).toBe(tts.requests[1]);
    expect(tts.requests[2]).toEqual(tts.requests[1]);
    expect(d.clock.slept).toEqual([2000]);
    expect(log.slice(2, 6)).toEqual([
      "reserve 1500",
      "release",
      "reserve 1500",
      "settle 25",
    ]);
  });

  it("retries a 5xx and a 429 without Retry-After by the policy's delay", async () => {
    const tts = fakeTts([
      { fail: new UpstreamServerError(503, "busy") },
      { fail: new RateLimitError(429, undefined, "gemini") },
      { ok: 10 },
    ]);
    const d = deps(tts);
    const result = await synthesizeChunks(input(plan(["Only."])), d, ctx());
    expect(result.kind).toBe("done");
    expect(d.clock.slept).toEqual([1000, 1000]);
  });

  it("stops on a 401 at chunk 2 with chunk 1 kept, and does not retry it", async () => {
    const error = new AuthenticationError(401, "bad key");
    const tts = fakeTts([{ ok: 10 }, { fail: error }]);
    const result = await synthesizeChunks(input(), deps(tts), ctx());
    expect(result).toMatchObject({
      kind: "stopped",
      reason: "error",
      error,
      pendingIndex: 1,
    });
    if (result.kind !== "stopped") return;
    expect(result.completed.map((c) => c.pcm.byteLength)).toEqual([10]);
    expect(tts.requests).toHaveLength(2);
  });

  it("does not retry a timeout (owner, item 230), and keeps what is done", async () => {
    const tts = fakeTts([
      { ok: 10 },
      { fail: new TimeoutError(180_000, "https://x.test/") },
    ]);
    const result = await synthesizeChunks(input(), deps(tts), ctx());
    expect(result).toMatchObject({
      kind: "stopped",
      reason: "error",
      pendingIndex: 1,
    });
    expect(tts.requests).toHaveLength(2);
  });

  it("stops with a sample-rate TTSError when chunk 2 changes rate", async () => {
    const tts = fakeTts([{ ok: 10 }, { ok: 10, rate: 16000 }]);
    const result = await synthesizeChunks(input(), deps(tts), ctx());
    expect(result.kind).toBe("stopped");
    if (result.kind !== "stopped") return;
    expect(result.error).toBeInstanceOf(TTSError);
    expect((result.error as TTSError).context.reason).toBe("sample-rate");
    expect((result.error as TTSError).message).toMatch(/16000 Hz.*24000 Hz/u);
    expect(result.completed).toHaveLength(1);
    expect(result.pendingIndex).toBe(1);
  });

  it("stops with a sample-rate TTSError when a chunk reports no rate", async () => {
    const tts = fakeTts([{ ok: 10, rate: undefined }]);
    const result = await synthesizeChunks(
      input(plan(["A."])),
      deps(tts),
      ctx(),
    );
    expect(result.kind).toBe("stopped");
    if (result.kind !== "stopped") return;
    expect((result.error as TTSError).context.reason).toBe("sample-rate");
  });
});

// ---------------------------------------------------------------------------
// Done when, line 2: cancel
// ---------------------------------------------------------------------------

describe("synthesizeChunks — cancel (FR-42)", () => {
  it("aborts chunk 2's request in flight and hands back no PCM", async () => {
    const tts = fakeTts([{ ok: 10 }, { hang: true }]);
    const c = ctx();
    const d = deps(tts, {
      onChunk: (index) => {
        if (index === 1) {
          setTimeout(() => {
            c.source.cancel({ kind: "user" });
          }, 0);
        }
      },
    });
    const outcome = await synthesizeChunks(input(), d, c).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    expect("error" in outcome && outcome.error).toBeInstanceOf(
      OperationCancelledError,
    );
    expect("result" in outcome).toBe(false);
    expect(tts.requests).toHaveLength(2);
    expect(tts.contexts[1]?.token.isCancellationRequested).toBe(true);
  });

  it("sends nothing once the token is cancelled", async () => {
    const tts = fakeTts([{ ok: 10 }]);
    const c = ctx();
    c.source.cancel({ kind: "user" });
    await expect(
      synthesizeChunks(input(), deps(tts), c),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(tts.requests).toHaveLength(0);
  });

  it("does not retry after a cancel that lands during a failing attempt", async () => {
    const c = ctx();
    const tts = {
      requests: [] as SynthesisRequest[],
      contexts: [] as LLMCallContext[],
      synthesize(request: SynthesisRequest): Promise<AudioArtifact> {
        tts.requests.push(request);
        c.source.cancel({ kind: "user" });
        return Promise.reject(new RateLimitError(429, 1000, "gemini"));
      },
    };
    await expect(
      synthesizeChunks(input(), deps(tts), c),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(tts.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Budget, resume, wiring
// ---------------------------------------------------------------------------

describe("synthesizeChunks — budget and in-session retry", () => {
  it("refuses with ConfigurationError, sending nothing, when the context has no budget", async () => {
    const tts = fakeTts([{ ok: 10 }]);
    const c = { token: createCancellationTokenSource().token };
    await expect(
      synthesizeChunks(input(), deps(tts), c),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(tts.requests).toHaveLength(0);
  });

  it("pauses on a ceiling with the chunk pending and nothing sent for it", async () => {
    const tts = fakeTts([{ ok: 10 }, { ok: 20 }]);
    const { guard } = fakeGuard(2);
    const result = await synthesizeChunks(input(), deps(tts), ctx(guard));
    expect(result).toMatchObject({
      kind: "stopped",
      reason: "budget",
      pendingIndex: 1,
    });
    expect((result as { error: unknown }).error).toBeInstanceOf(
      BudgetExceededError,
    );
    expect(tts.requests).toHaveLength(1);
  });

  it("resumes from the finished chunks in the same session, sending only the rest", async () => {
    const first = fakeTts([
      { ok: 10 },
      { fail: new AuthenticationError(401, "no") },
    ]);
    const stopped = await synthesizeChunks(input(), deps(first), ctx());
    if (stopped.kind !== "stopped") throw new Error("expected a stop");

    const second = fakeTts([{ ok: 20 }, { ok: 30 }]);
    const result = await synthesizeChunks(
      input(plan(), { completed: stopped.completed }),
      deps(second),
      ctx(),
    );
    expect(second.requests.map((r) => r.text)).toEqual(["Two.", "Three."]);
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.chunks.map((c) => c.pcm.byteLength)).toEqual([10, 20, 30]);
    expect(result.chunks[0]).toBe(stopped.completed[0]);
  });

  it("refuses finished chunks made with another voice", async () => {
    const first = fakeTts([
      { ok: 10 },
      { fail: new AuthenticationError(401, "no") },
    ]);
    const stopped = await synthesizeChunks(input(), deps(first), ctx());
    if (stopped.kind !== "stopped") throw new Error("expected a stop");
    const other = { ...plan(), voice: "Kore" };
    await expect(
      synthesizeChunks(
        input(other, { completed: stopped.completed }),
        deps(fakeTts([])),
        ctx(),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("awaits beforeSend before every attempt", async () => {
    const order: string[] = [];
    const tts = {
      requests: [] as SynthesisRequest[],
      contexts: [] as LLMCallContext[],
      synthesize(request: SynthesisRequest): Promise<AudioArtifact> {
        order.push("send");
        return Promise.resolve(artifact(request, 2, 24000));
      },
    };
    const c = {
      ...ctx(),
      beforeSend: () => {
        order.push("before");
        return Promise.resolve();
      },
    };
    await synthesizeChunks(input(plan(["A.", "B."])), deps(tts), c);
    expect(order).toEqual(["before", "send", "before", "send"]);
  });

  it("refuses a plan with no chunk", async () => {
    await expect(
      synthesizeChunks(input(plan([])), deps(fakeTts([])), ctx()),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

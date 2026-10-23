/**
 * `P3-T16` steps 3–5: `BudgetGuard`, the two spend ceilings, the session
 * counter, and settling after every call (`docs/07` §4.3's note "`BudgetGuard`,
 * as built"; `docs/06` §11.4, §5.4). Every model answer is SYNTHETIC, from
 * `test/helpers/mockLLM.ts`; no network, no key, no live LLM call.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  BudgetExceededError,
  ConfigurationError,
  NetworkError,
  StructuredOutputError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  createJobRecord,
  type JobRecord,
} from "../../../src/core/jobQueue/jobRecord";
import { completeJSON } from "../../../src/llm/shared/jsonMode";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import type {
  BudgetGuard,
  ChatRequest,
  LLMCallContext,
  Usage,
} from "../../../src/llm/types";
import { PREF_KEYS, getPref, setPrefStore } from "../../../src/prefs";
import {
  UNWIRED_BUDGET_GUARD,
  ZERO_SPEND,
  ceilToCentUsd,
  ceilingStopOf,
  createBudgetGuard,
  createCeilingsResumeGuard,
  createConfirmResumeGuard,
  createSessionSpendCounter,
  isEstimatedSpend,
  requestEstimate,
  suggestedLimitUsd,
  withBudget,
  type CeilingLimitsCents,
  type RunBudgetGuard,
  type SessionSpendCounter,
} from "../../../src/pipeline/shared/budget";
import { withHeadroom } from "../../../src/pipeline/shared/estimate";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockSettings,
} from "../../helpers/mockLLM";

afterEach(() => {
  setPrefStore(undefined);
});

/** $1 / M input, $10 / M output: easy dollars. SYNTHETIC. */
const PRICES: ModelPrices = {
  inputPerMTokUsd: 1,
  outputPerMTokUsd: 10,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: Date.UTC(2026, 9, 1),
  source: "documented-table",
};

const NOW = Date.UTC(2026, 9, 23);

function limits(run: number, session: number): CeilingLimitsCents {
  return { run: () => run, session: () => session };
}

function usage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  costUsd?: number,
): Usage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: undefined,
    costUsd,
  };
}

function guardOf(
  session: SessionSpendCounter,
  ceilings: CeilingLimitsCents,
  extra: { prices?: ModelPrices } = {},
): RunBudgetGuard {
  return createBudgetGuard({
    session,
    limits: ceilings,
    now: () => NOW,
    ...extra,
  });
}

function request(
  text = "summarize this",
  maxOutputTokens = 1_000,
): ChatRequest {
  return {
    model: "mock-small",
    messages: [{ role: "user", content: text }],
    maxOutputTokens,
    traceId: "t",
  };
}

function ctx(budget?: BudgetGuard): LLMCallContext {
  const { token } = createCancellationTokenSource();
  return budget === undefined ? { token } : { token, budget };
}

/** A router over one scripted provider, wrapped by `withBudget`. */
function budgetedRouter(
  script: Parameters<typeof mockLLM>[0],
  options: Parameters<typeof mockLLM>[1] = {},
) {
  const mock = mockLLM(script, options);
  const router = withBudget(
    mockLLMRouter([mock], mockSettings({ keyPresent: { openrouter: true } })),
    { pricesFor: () => PRICES, now: () => NOW },
  );
  return { mock, router };
}

describe("the session counter (docs/06 §11.4)", () => {
  it("accumulates across two jobs and reads zero after a simulated restart", async () => {
    let session = createSessionSpendCounter();
    const { router } = budgetedRouter([
      chatResponse("one", { usage: usage(100, 10, 0.25) }),
    ]);
    const first = guardOf(session, limits(0, 0));
    const second = guardOf(session, limits(0, 0));
    await router.chat(request(), ctx(first));
    await router.chat(request(), ctx(first));
    await router.chat(request(), ctx(second));
    expect(first.spentUsd).toBeCloseTo(0.5, 12);
    expect(second.spentUsd).toBeCloseTo(0.25, 12);
    expect(session.totals.calls).toBe(3);
    expect(session.totals.costUsd).toBeCloseTo(0.75, 12);
    expect(first.usage().session).toBe(session.totals);

    // Zotero restarts: the composition root builds the next counter. Nothing
    // was written anywhere, so there is nothing to read back.
    session = createSessionSpendCounter();
    expect(session.totals).toEqual(ZERO_SPEND);
    expect(guardOf(session, limits(0, 0)).usage().session.costUsd).toBe(0);
  });

  it("is never persisted: settling writes no preference", async () => {
    const store = createMemoryPrefStore({});
    const writes: string[] = [];
    setPrefStore({
      ...store,
      set(key, value) {
        writes.push(key);
        store.set(key, value);
      },
    });
    const session = createSessionSpendCounter();
    const { router } = budgetedRouter([chatResponse("x")]);
    const guard = createBudgetGuard({ session, now: () => NOW });
    await router.chat(request(), ctx(guard));
    expect(writes).toEqual([]);
  });
});

describe("ceilings: read before every call, the stricter binds", () => {
  it("with run.maxSpendCents = 1 ($0.01) the job pauses before its first call; continue proceeds, stop loses nothing", async () => {
    setPrefStore(createMemoryPrefStore({ [PREF_KEYS.runMaxSpendCents]: 1 }));
    const session = createSessionSpendCounter();
    const guard = createBudgetGuard({ session, now: () => NOW });
    const { mock, router } = budgetedRouter([chatResponse("summary")]);

    // Pre-run: the estimate is already above the ceiling.
    const estimate = requestEstimate(request(), {
      pricesFor: () => PRICES,
      now: () => NOW,
    });
    const preflight = guard.check(estimate.costUsd ?? 0);
    expect(preflight.ok).toBe(false);
    // And a call made anyway is refused before anything is sent.
    const refused = await router.chat(request(), ctx(guard)).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(BudgetExceededError);
    expect(mock.calls).toHaveLength(0);
    const stop = ceilingStopOf(refused);
    expect(stop).toMatchObject({ ceiling: "run", limitUsd: 0.01, spentUsd: 0 });

    // "Stop": nothing was spent and nothing was lost.
    expect(guard.usage().run).toEqual(ZERO_SPEND);

    // "Continue": raise the per-run ceiling for this run only.
    if (stop === undefined) throw new Error("no stop");
    guard.raiseLimit("run", suggestedLimitUsd(stop, estimate.costUsd));
    await router.chat(request(), ctx(guard));
    expect(mock.calls).toHaveLength(1);
    // The preference itself is untouched (gate G-20).
    expect(getPref("runMaxSpendCents")).toBe(1);
  });

  it("a ceiling set mid-run pauses at the first call that would breach it, and earlier results are kept", async () => {
    const store = createMemoryPrefStore({ [PREF_KEYS.runMaxSpendCents]: 0 });
    setPrefStore(store);
    const session = createSessionSpendCounter();
    const guard = createBudgetGuard({ session, now: () => NOW });
    const { mock, router } = budgetedRouter([
      chatResponse("s", { usage: usage(1_000, 100, 0.02) }),
    ]);
    const kept: number[] = [];
    let pausedAt: number | undefined;
    for (let item = 1; item <= 10; item += 1) {
      // The user sets a $0.05 ceiling after the second summary.
      if (item === 3) store.set(PREF_KEYS.runMaxSpendCents, 5);
      try {
        await router.chat(request(), ctx(guard));
        kept.push(item);
      } catch (error) {
        expect(ceilingStopOf(error)?.ceiling).toBe("run");
        pausedAt = item;
        break;
      }
    }
    // 2 × $0.02 spent; the third call reserves about $0.01 (1 000 output
    // tokens at $10 / M), and $0.04 + $0.01 passes $0.05: it pauses at 3.
    expect(kept).toEqual([1, 2]);
    expect(pausedAt).toBe(3);
    expect(mock.calls).toHaveLength(2);
    expect(guard.spentUsd).toBeCloseTo(0.04, 12);
  });

  it("names the ceiling with the least room, not the smaller number", () => {
    const session = createSessionSpendCounter();
    // Another job already spent $4.90 of a $5 session ceiling this session.
    session.add({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 4.9,
      estimated: false,
    });
    const guard = guardOf(session, limits(100, 500)); // $1 per run, $5 session
    expect(guard.binding()).toMatchObject({ ceiling: "session" });
    expect(guard.binding()?.roomUsd).toBeCloseTo(0.1, 12);
    expect(guard.limitUsd).toBeCloseTo(0.1, 12);
    const verdict = guard.check(0.2);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.stop).toMatchObject({ ceiling: "session", limitUsd: 5 });
      expect(verdict.stop.projectedUsd).toBeCloseTo(5.1, 12);
    }
    // With the session ceiling off, the run ceiling binds.
    expect(guardOf(session, limits(100, 0)).binding()?.ceiling).toBe("run");
    // With both off nothing binds and nothing is refused.
    const off = guardOf(session, limits(0, 0));
    expect(off.binding()).toBeUndefined();
    expect(off.limitUsd).toBeUndefined();
    expect(off.check(1e6).ok).toBe(true);
  });

  it("counts reservations still in flight, so concurrent calls cannot pass a ceiling together", () => {
    const guard = guardOf(createSessionSpendCounter(), limits(10, 0));
    const a = guard.reserveCall({
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.04,
    });
    const b = guard.reserveCall({
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.04,
    });
    expect(() =>
      guard.reserveCall({ inputTokens: 1, outputTokens: 1, costUsd: 0.04 }),
    ).toThrow(BudgetExceededError);
    a.release();
    b.settle(usage(1, 1, 0.01));
    // $0.01 spent, nothing reserved: $0.09 fits under $0.10, $0.0901 does not.
    expect(guard.check(0.09).ok).toBe(true);
    expect(guard.check(0.0901).ok).toBe(false);
  });

  it("raises only for this run, only upwards, and never an off ceiling", () => {
    const guard = guardOf(createSessionSpendCounter(), limits(100, 0));
    expect(() => guard.raiseLimit("run", 0.5)).toThrow(RangeError);
    expect(() => guard.raiseLimit("run", Number.NaN)).toThrow(RangeError);
    expect(() => guard.raiseLimit("session", 10)).toThrow(RangeError);
    guard.raiseLimit("run", 2);
    expect(guard.binding()?.limitUsd).toBe(2);
    // Another run reads the preference, not this run's raise.
    expect(
      guardOf(createSessionSpendCounter(), limits(100, 0)).binding()?.limitUsd,
    ).toBe(1);
  });

  it("suggests a raise that covers the rest of the job, rounded up to a cent", () => {
    const stop = {
      ceiling: "run" as const,
      limitUsd: 0.05,
      spentUsd: 0.04,
      projectedUsd: 0.051,
      runSpentUsd: 0.04,
    };
    expect(suggestedLimitUsd(stop, undefined)).toBe(0.06);
    expect(suggestedLimitUsd(stop, 0.123)).toBe(0.17);
    expect(ceilToCentUsd(0.1)).toBe(0.1);
  });

  it("reads a refusal's figures back, and nothing from any other error", () => {
    const guard = guardOf(createSessionSpendCounter(), limits(1, 0));
    let caught: unknown;
    try {
      guard.reserve({ inputTokens: 1, outputTokens: 1, costUsd: 0.02 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect(ceilingStopOf(caught)).toEqual({
      ceiling: "run",
      limitUsd: 0.01,
      spentUsd: 0,
      projectedUsd: 0.02,
      runSpentUsd: 0,
    });
    expect(ceilingStopOf(new Error("x"))).toBeUndefined();
    expect(ceilingStopOf(new BudgetExceededError("x"))).toBeUndefined();
  });
});

describe("settling after every call (step 5)", () => {
  it("prefers the provider's cost, then priced tokens, then the reservation's estimate, marked estimated", () => {
    const guard = guardOf(createSessionSpendCounter(), limits(0, 0), {
      prices: PRICES,
    });
    const reserved = { inputTokens: 2_000, outputTokens: 500, costUsd: 0.007 };
    const reported = guard.reserveCall(reserved).settle(usage(1_000, 100, 0.5));
    expect(reported).toEqual({
      inputTokens: 1_000,
      outputTokens: 100,
      costUsd: 0.5,
      estimated: false,
    });
    const priced = guard.reserveCall(reserved).settle(usage(1_000, 100));
    expect(priced.costUsd).toBeCloseTo((1_000 * 1 + 100 * 10) / 1e6, 15);
    expect(priced.estimated).toBe(false);
    const missing = guard
      .reserveCall(reserved)
      .settle(usage(undefined, undefined));
    expect(missing).toEqual({
      inputTokens: 2_000,
      outputTokens: 500,
      costUsd: 0.007,
      estimated: true,
    });
    expect(guard.usage().run.calls).toBe(3);
    expect(guard.usage().run.estimatedCalls).toBe(1);
    expect(isEstimatedSpend(guard.usage().run)).toBe(true);
  });

  it("counts an unpriced call's tokens and says it had no price; its reservation passes", () => {
    const guard = guardOf(createSessionSpendCounter(), limits(1, 0));
    const call = guard
      .reserveCall({ inputTokens: 10, outputTokens: 5 })
      .settle(usage(10, 5));
    expect(call.costUsd).toBeUndefined();
    expect(guard.usage().run).toMatchObject({
      calls: 1,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0,
      unpricedCalls: 1,
    });
    expect(isEstimatedSpend(guard.usage().run)).toBe(true);
  });

  it("counts every request of a completeJSON that throws (plan/00 §6 item 266)", async () => {
    const session = createSessionSpendCounter();
    const guard = guardOf(session, limits(0, 0));
    const { mock, router } = budgetedRouter([
      chatResponse("not json at all", { usage: usage(1_000, 50, 0.01) }),
    ]);
    const structured = {
      ...request(),
      responseFormat: {
        kind: "json_schema" as const,
        name: "Summary",
        schema: {
          type: "object",
          required: ["a"],
          properties: { a: { type: "string" } },
        },
      },
    };
    await expect(
      completeJSON(router, structured, ctx(guard)),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(guard.usage().run.calls).toBe(mock.calls.length);
    expect(guard.spentUsd).toBeCloseTo(0.01 * mock.calls.length, 12);
    expect(session.totals.calls).toBe(mock.calls.length);
  });

  it("frees the reservation of a request that fails before any answer, and counts nothing", async () => {
    const guard = guardOf(createSessionSpendCounter(), limits(100, 0));
    const { router } = budgetedRouter([
      new NetworkError("SYNTHETIC failure", { host: "mock.invalid" }),
    ]);
    await expect(router.chat(request(), ctx(guard))).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(guard.usage().run).toEqual(ZERO_SPEND);
    expect(guard.binding()?.reservedUsd).toBe(0);
  });

  it("passes no guard down, so a provider that also reserves cannot count a call twice", async () => {
    const guard = guardOf(createSessionSpendCounter(), limits(0, 0));
    const { mock, router } = budgetedRouter([chatResponse("x")]);
    await router.chat(request(), ctx(guard));
    expect(mock.calls[0]?.ctx.budget).toBeUndefined();
    expect(guard.usage().run.calls).toBe(1);
    // Without a guard the router is called as it is.
    await router.chat(request(), ctx());
    expect(guard.usage().run.calls).toBe(1);
  });

  it("drives a bare BudgetGuard through its reserve() and settle() pair once per call", async () => {
    const seen: string[] = [];
    const bare: BudgetGuard = {
      reserve: () => {
        seen.push("reserve");
      },
      settle: () => {
        seen.push("settle");
      },
      spentUsd: 0,
      limitUsd: undefined,
    };
    const { router } = budgetedRouter([chatResponse("x")]);
    await router.chat(request(), ctx(bare));
    expect(seen).toEqual(["reserve", "settle"]);
  });

  it("settles a stream on its final chunk, estimates one that reports no usage, and frees an abandoned one", async () => {
    const guard = guardOf(createSessionSpendCounter(), limits(0, 0));
    const { router } = budgetedRouter(
      [chatResponse("alpha beta", { usage: usage(20, 4, 0.003) })],
      { streaming: true },
    );
    let text = "";
    for await (const chunk of router.chatStream(request(), ctx(guard))) {
      text += chunk.deltaText;
    }
    expect(text.length).toBeGreaterThan(0);
    expect(guard.usage().run.calls).toBe(1);
    expect(guard.spentUsd).toBeCloseTo(0.003, 12);

    // Abandoned after the first chunk: nothing counted, nothing reserved.
    const abandon = guardOf(createSessionSpendCounter(), limits(100, 0));
    for await (const chunk of router.chatStream(request(), ctx(abandon))) {
      void chunk;
      break;
    }
    expect(abandon.usage().run.calls).toBe(0);
    expect(abandon.binding()?.reservedUsd).toBe(0);
  });

  it("reserves the messages' tokens with 1.15× headroom and the request's own output ceiling", () => {
    const text = "a".repeat(370); // 100 tokens
    const estimate = requestEstimate(request(text, 800), {
      pricesFor: () => PRICES,
      now: () => NOW,
      countTokens: (t) => Math.ceil(t.length / 3.7),
    });
    expect(estimate.inputTokens).toBe(withHeadroom(100));
    expect(estimate.outputTokens).toBe(800);
    expect(estimate.costUsd).toBeCloseTo((115 * 1 + 800 * 10) / 1e6, 15);
    const unpriced = requestEstimate(request(text, 800), {
      pricesFor: () => undefined,
      now: () => NOW,
    });
    expect(unpriced.costUsd).toBeUndefined();
  });

  it("the unwired placeholder fails closed: no request is sent under it", async () => {
    const { mock, router } = budgetedRouter([chatResponse("x")]);
    await expect(
      router.chat(request(), ctx(UNWIRED_BUDGET_GUARD)),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(mock.calls).toHaveLength(0);
    expect(UNWIRED_BUDGET_GUARD.limitUsd).toBe(0);
  });
});

describe("the resume guards (plan/00 §6 item 250)", () => {
  function record(costUsd: number): JobRecord {
    const fresh = createJobRecord({
      id: "j",
      pipelineId: "summarize",
      input: {},
      createdAtEpochMs: NOW,
      createdByPluginVersion: "0.0.0",
    });
    return { ...fresh, usage: { inputTokens: 0, outputTokens: 0, costUsd } };
  }

  it("confirm: above summary.confirmAboveCents, or unpriced, waits awaiting-confirmation", async () => {
    const at = (costUsd: number | undefined, calls = 3) =>
      createConfirmResumeGuard(
        { remaining: () => Promise.resolve({ calls, costUsd }) },
        () => 200,
      )(record(0));
    await expect(at(1.5)).resolves.toEqual({ proceed: true });
    await expect(at(2.5)).resolves.toEqual({
      proceed: false,
      pauseReason: "awaiting-confirmation",
    });
    await expect(at(undefined)).resolves.toMatchObject({ proceed: false });
    await expect(at(undefined, 0)).resolves.toEqual({ proceed: true });
  });

  it("ceilings: the recorded spend plus the rest past a ceiling waits budget-stop", async () => {
    const session = createSessionSpendCounter();
    const guardFor = (run: number, sessionCents: number) =>
      createCeilingsResumeGuard({
        session,
        limits: limits(run, sessionCents),
        remaining: () => Promise.resolve({ calls: 5, costUsd: 0.3 }),
      });
    await expect(guardFor(100, 0)(record(0.6))).resolves.toEqual({
      proceed: true,
    });
    await expect(guardFor(100, 0)(record(0.8))).resolves.toEqual({
      proceed: false,
      pauseReason: "budget-stop",
    });
    // After a restart the session counter is zero; a $0.25 session ceiling
    // still stops a $0.30 remainder.
    await expect(guardFor(0, 25)(record(0))).resolves.toMatchObject({
      pauseReason: "budget-stop",
    });
    await expect(guardFor(0, 0)(record(100))).resolves.toEqual({
      proceed: true,
    });
  });
});

/**
 * `BudgetGuard`: the two spend ceilings, checked before every LLM call.
 *
 * **Scope.** `P3-T16` steps 3–5; `docs/07` §4.3's `BudgetGuard` and its dated
 * note "`BudgetGuard`, as built" (2026-10-23), `docs/06` §11.4 and §5.4. The
 * interface is declared in `src/llm/types.ts` (§4.3 is the authority) and
 * re-exported by `../types.ts`; this file builds it. `P3-T35` wires one guard
 * per job into `PipelineContext.budget`, and the composition root holds the
 * one {@link SessionSpendCounter}.
 *
 * ## Two counters, two ceilings
 *
 * - The **run** counter starts at zero for every job (or at a resumed job's
 *   recorded `usage.costUsd`), and `run.maxSpendCents` binds it.
 * - The **session** counter accumulates across every job in this Zotero
 *   process, **in memory only**, and `run.maxSessionSpendCents` binds it. It is
 *   never persisted: a restart builds a new one, which reads zero (`docs/06`
 *   §11.4: a persisted session counter would be a monthly budget).
 * - Both preferences are **read before every call** ({@link PREF_CEILINGS}), so
 *   a ceiling the user sets mid-run applies at the next call. `0` is off.
 *   Cents become dollars through `centsToUsd` (`plan/00` §6 item 245); money
 *   here is fractional US dollars (item 252).
 * - **The stricter binds**: the ceiling with the least room left — its limit
 *   minus its own counter's spend and the reservations still in flight — not
 *   the smaller number. {@link RunBudgetGuard.binding} names it, so the dialog
 *   can.
 *
 * ## Reaching a ceiling pauses and asks (`plan/00` §6 item 234)
 *
 * `reserve()` throws `BudgetExceededError` when spend so far, plus calls in
 * flight, plus this call's estimate would pass a ceiling. Nothing is sent. The
 * error's context carries the ceiling and the figures ({@link ceilingStopOf}
 * reads them back); the job pauses with `budget-stop` — `docs/07` §12.3's
 * `BudgetStop`, paused, not failed — and every summary already made is kept.
 * "Continue" is {@link RunBudgetGuard.raiseLimit}: it raises that ceiling **for
 * this run only** and never writes the preference (gate `G-20`).
 *
 * ## Settling, and the failed `completeJSON` (`plan/00` §6 item 266)
 *
 * {@link withBudget} wraps the `LLMRouter` so that **each request** reserves
 * before it is sent and settles when its answer arrives. `completeJSON` sends
 * each of its up to three requests through that `chat`, so when it throws
 * (a repair still invalid, a truncation) the requests it made are already
 * counted. A settled call is priced in this order: the provider's own
 * `costUsd` (OpenRouter reports one); the reported tokens through `costOf`,
 * at the prices the call was reserved with (owner, `plan/00` §6 item 278(b));
 * the reservation's estimate, marked estimated, only when the tokens were not
 * reported. A request that fails before any answer settles nothing and frees
 * its reservation.
 *
 * **A call with no guard is refused** (owner, 2026-10-23, `plan/00` §6 item
 * 278(a)): {@link withBudget} throws `ConfigurationError` before anything is
 * sent, so a caller that forgets `budget: ctx.budget` spends nothing. The
 * pane's key Test and the model catalogue never pass through the router.
 *
 * **Prices.** {@link WithBudgetDeps.pricesFor} is synchronous; the composition
 * root reads it from the service graph's `modelPrices`
 * (`createModelPriceSource` in `src/llm/shared/modelCatalogue.ts`), the
 * snapshot the cost dialog prices from too (`docs/07` §4.3's note of
 * 2026-10-23).
 *
 * A model with no known price is **unpriced**: its reservation passes, because
 * nothing can be compared, its tokens are counted and the totals say how many
 * calls had no price. The cost dialog then demands the second acknowledgement
 * (`secondAcknowledgementFor` in `./estimate.ts`).
 */

import { BudgetExceededError, ConfigurationError } from "../../core/errors";
import type { JobRecord } from "../../core/jobQueue/jobRecord";
import type { ResumeVerdict } from "../../core/jobQueue/queue";
import {
  centsToUsd,
  costAboveCents,
  costOf,
  type ModelPrices,
} from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMCallContext,
  LLMRouter,
  Usage,
} from "../../llm/types";
import { getPref } from "../../prefs";

import { withHeadroom } from "./estimate";

// ===========================================================================
// 1. Totals and the session counter
// ===========================================================================

/** Which ceiling: per run (`run.maxSpendCents`) or per Zotero session. */
export type CeilingKind = "run" | "session";

/** Accumulated usage over some calls. */
export interface SpendTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Fractional US dollars, over the calls that had a cost. */
  readonly costUsd: number;
  /**
   * Calls whose figures are the reservation's estimate rather than what the
   * provider reported: the totals are then marked as estimated (step 5).
   */
  readonly estimatedCalls: number;
  /** Calls with no cost at all (no price known): tokens counted, dollars not. */
  readonly unpricedCalls: number;
}

/** No calls yet. */
export const ZERO_SPEND: SpendTotals = Object.freeze({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  estimatedCalls: 0,
  unpricedCalls: 0,
});

/** One call, as settled. */
export interface SettledCall {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** `undefined` when the call could not be priced at all. */
  readonly costUsd: number | undefined;
  /** Some figure came from the reservation's estimate, not the provider. */
  readonly estimated: boolean;
}

function addCall(totals: SpendTotals, call: SettledCall): SpendTotals {
  return {
    calls: totals.calls + 1,
    inputTokens: totals.inputTokens + call.inputTokens,
    outputTokens: totals.outputTokens + call.outputTokens,
    costUsd: totals.costUsd + (call.costUsd ?? 0),
    estimatedCalls: totals.estimatedCalls + (call.estimated ? 1 : 0),
    unpricedCalls: totals.unpricedCalls + (call.costUsd === undefined ? 1 : 0),
  };
}

/** Whether any figure in `totals` is an estimate rather than reported usage. */
export function isEstimatedSpend(totals: SpendTotals): boolean {
  return totals.estimatedCalls > 0 || totals.unpricedCalls > 0;
}

/**
 * The per-session counter (`docs/06` §11.4): one per plugin lifetime, shared
 * by every job's guard, in memory only.
 */
export interface SessionSpendCounter {
  /** Everything settled since this counter was built. */
  readonly totals: SpendTotals;
  /** Add one settled call. */
  add(call: SettledCall): void;
}

/**
 * A fresh session counter, at zero. The composition root builds exactly one
 * per plugin lifetime; Zotero's restart builds the next, so the session's
 * spend reads zero again and nothing is ever written to disk.
 *
 * @returns the counter
 */
export function createSessionSpendCounter(): SessionSpendCounter {
  let totals: SpendTotals = ZERO_SPEND;
  return {
    get totals(): SpendTotals {
      return totals;
    },
    add(call: SettledCall): void {
      totals = addCall(totals, call);
    },
  };
}

// ===========================================================================
// 2. The ceilings
// ===========================================================================

/** Where the two ceilings are read from, in whole US cents; `0` is off. */
export interface CeilingLimitsCents {
  run(): number;
  session(): number;
}

/**
 * The two preferences, read on every call (never cached), so a ceiling set
 * mid-run applies at the next call.
 */
export const PREF_CEILINGS: CeilingLimitsCents = Object.freeze({
  run: () => getPref("runMaxSpendCents"),
  session: () => getPref("runMaxSessionSpendCents"),
});

/** One ceiling, as it stands. */
export interface CeilingState {
  readonly ceiling: CeilingKind;
  /** The limit in force: the preference, or this run's raise. */
  readonly limitUsd: number;
  /** Its own counter's spend so far (the run's or the session's). */
  readonly spentUsd: number;
  /** Reservations of calls still in flight. */
  readonly reservedUsd: number;
  /** `limitUsd − spentUsd − reservedUsd`; may be negative. */
  readonly roomUsd: number;
}

/** What reaching a ceiling reports: enough for the question it asks. */
export interface CeilingStop {
  readonly ceiling: CeilingKind;
  readonly limitUsd: number;
  /** That ceiling's counter, before this call. */
  readonly spentUsd: number;
  /** What the counter would reach with this call (or this estimate). */
  readonly projectedUsd: number;
  /** This run's own spend so far, for the "spent so far" line. */
  readonly runSpentUsd: number;
}

/** The answer of {@link RunBudgetGuard.check}. */
export type CeilingCheck =
  | { readonly ok: true; readonly binding: CeilingState | undefined }
  | { readonly ok: false; readonly stop: CeilingStop };

/**
 * A `BudgetExceededError`'s figures, or `undefined` for any other error. The
 * surface uses it to ask the question (`docs/07` §10.2's "Raise limit and
 * continue" / "Stop").
 *
 * @param error - anything caught
 * @returns the stop, when `error` is a guard's refusal
 */
export function ceilingStopOf(error: unknown): CeilingStop | undefined {
  if (!(error instanceof BudgetExceededError)) return undefined;
  const c = error.context;
  const ceiling = c["ceiling"];
  const numbers = [
    c["limitUsd"],
    c["spentUsd"],
    c["projectedUsd"],
    c["runSpentUsd"],
  ];
  if (ceiling !== "run" && ceiling !== "session") return undefined;
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined;
  }
  const [limitUsd, spentUsd, projectedUsd, runSpentUsd] = numbers as number[];
  return {
    ceiling,
    limitUsd: limitUsd as number,
    spentUsd: spentUsd as number,
    projectedUsd: projectedUsd as number,
    runSpentUsd: runSpentUsd as number,
  };
}

/** `usd` rounded **up** to a whole cent: a raised limit is never below what it must cover. */
export function ceilToCentUsd(usd: number): number {
  return Math.ceil(usd * 100 - 1e-9) / 100;
}

/**
 * The limit "continue" raises the stopped ceiling to, for this run: enough
 * for the projected spend and for the rest of the job's estimate, rounded up
 * to a whole cent, and never below the current limit.
 *
 * @param stop - the stop being answered
 * @param remainingUsd - the estimate for the work still to do, when known
 *   (already with headroom); the call that stopped is part of it
 * @returns the new limit in dollars
 */
export function suggestedLimitUsd(
  stop: CeilingStop,
  remainingUsd: number | undefined,
): number {
  const needed = Math.max(
    stop.projectedUsd,
    stop.spentUsd + (remainingUsd ?? 0),
    stop.limitUsd,
  );
  return ceilToCentUsd(needed);
}

// ===========================================================================
// 3. The guard
// ===========================================================================

/** What one call reserves. `costUsd` absent: the call is unpriced. */
export interface ReservationEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
  /**
   * The prices `costUsd` was computed with. A settled call whose provider
   * reports no cost is charged at these × its reported tokens (`plan/00` §6
   * item 278(b)); absent, the guard's own {@link BudgetGuardDeps.prices}.
   */
  readonly prices?: ModelPrices;
}

/** One call's reservation, settled or freed exactly once. */
export interface BudgetReservation {
  /** The reserved cost; `undefined` for an unpriced call. */
  readonly costUsd: number | undefined;
  /** The answer arrived: count it (step 5). */
  settle(usage: Usage): SettledCall;
  /** No answer: free the reservation and count nothing. */
  release(): void;
}

/** {@link BudgetGuard} with what the dialog and the pipeline need besides. */
export interface RunBudgetGuard extends BudgetGuard {
  /** Would `additionalUsd` more (beyond calls in flight) pass a ceiling? */
  check(additionalUsd: number): CeilingCheck;
  /** The ceiling with the least room, or `undefined` when both are off. */
  binding(): CeilingState | undefined;
  /**
   * Reserve one call and get its handle. Throws `BudgetExceededError`, with
   * nothing reserved, when the call would pass a ceiling.
   */
  reserveCall(estimate: ReservationEstimate): BudgetReservation;
  /**
   * The user's "continue": raise `ceiling` to `limitUsd` for this run only.
   * Never writes the preference (gate `G-20`).
   *
   * @throws RangeError when the ceiling is off, or `limitUsd` is not a finite
   *   number above the limit in force — a "raise" may not lower a ceiling
   */
  raiseLimit(ceiling: CeilingKind, limitUsd: number): void;
  /** This run's totals and the session's (step 6's readout). */
  usage(): { readonly run: SpendTotals; readonly session: SpendTotals };
}

/** What {@link createBudgetGuard} needs. */
export interface BudgetGuardDeps {
  /** The plugin lifetime's one session counter. */
  readonly session: SessionSpendCounter;
  /** The ceilings; {@link PREF_CEILINGS} by default. */
  readonly limits?: CeilingLimitsCents;
  /**
   * The run model's prices, to price reported tokens at settle when the
   * reservation carries none of its own ({@link ReservationEstimate.prices}).
   */
  readonly prices?: ModelPrices;
  /** Now, for a promotion's end date (`costOf`); `Date.now` by default. */
  readonly now?: () => number;
  /** A resumed job's recorded usage: the run counter starts from it. */
  readonly resumedFrom?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  };
}

/** A finite, non-negative number, or `undefined`. */
function count(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * One job's guard (`P3-T16` step 3).
 *
 * @param deps - see {@link BudgetGuardDeps}
 * @returns the guard
 */
export function createBudgetGuard(deps: BudgetGuardDeps): RunBudgetGuard {
  const limits = deps.limits ?? PREF_CEILINGS;
  const now = deps.now ?? (() => Date.now());
  let run: SpendTotals =
    deps.resumedFrom === undefined
      ? ZERO_SPEND
      : {
          ...ZERO_SPEND,
          inputTokens: deps.resumedFrom.inputTokens,
          outputTokens: deps.resumedFrom.outputTokens,
          costUsd: deps.resumedFrom.costUsd,
        };
  const raised: { run?: number; session?: number } = {};
  let reservedUsd = 0;
  /** For the bare `reserve()` / `settle()` pair: first in, first settled. */
  const fifo: BudgetReservation[] = [];

  const limitOf = (ceiling: CeilingKind): number | undefined => {
    const override = raised[ceiling];
    if (override !== undefined) return override;
    const cents = ceiling === "run" ? limits.run() : limits.session();
    return Number.isFinite(cents) && cents > 0 ? centsToUsd(cents) : undefined;
  };
  const spentOf = (ceiling: CeilingKind): number =>
    ceiling === "run" ? run.costUsd : deps.session.totals.costUsd;

  const states = (): CeilingState[] => {
    const out: CeilingState[] = [];
    for (const ceiling of ["run", "session"] as const) {
      const limitUsd = limitOf(ceiling);
      if (limitUsd === undefined) continue;
      const spentUsd = spentOf(ceiling);
      out.push({
        ceiling,
        limitUsd,
        spentUsd,
        reservedUsd,
        roomUsd: limitUsd - spentUsd - reservedUsd,
      });
    }
    return out;
  };

  const binding = (): CeilingState | undefined => {
    let least: CeilingState | undefined;
    for (const state of states()) {
      if (least === undefined || state.roomUsd < least.roomUsd) least = state;
    }
    return least;
  };

  const check = (additionalUsd: number): CeilingCheck => {
    let stop: CeilingStop | undefined;
    let stopRoom = Infinity;
    for (const state of states()) {
      const projectedUsd = state.spentUsd + state.reservedUsd + additionalUsd;
      // `>`: reaching a limit exactly is within it.
      if (projectedUsd > state.limitUsd && state.roomUsd < stopRoom) {
        stopRoom = state.roomUsd;
        stop = {
          ceiling: state.ceiling,
          limitUsd: state.limitUsd,
          spentUsd: state.spentUsd,
          projectedUsd,
          runSpentUsd: run.costUsd,
        };
      }
    }
    return stop === undefined
      ? { ok: true, binding: binding() }
      : { ok: false, stop };
  };

  const settleCall = (
    usage: Usage,
    reserved: ReservationEstimate,
  ): SettledCall => {
    const input = count(usage.inputTokens);
    const output = count(usage.outputTokens);
    const reported = count(usage.costUsd);
    let costUsd: number | undefined = reported;
    let estimated = input === undefined || output === undefined;
    const inputTokens = input ?? reserved.inputTokens;
    const outputTokens = output ?? reserved.outputTokens;
    // Item 278(b): the prices the call was reserved with, so a call the
    // provider does not price is charged for what it used, not its estimate.
    const prices = reserved.prices ?? deps.prices;
    if (costUsd === undefined && !estimated && prices !== undefined) {
      costUsd = costOf(prices, { inputTokens, outputTokens }, now()).costUsd;
    }
    if (costUsd === undefined && reserved.costUsd !== undefined) {
      costUsd = reserved.costUsd;
      estimated = true;
    }
    const call: SettledCall = { inputTokens, outputTokens, costUsd, estimated };
    run = addCall(run, call);
    deps.session.add(call);
    return call;
  };

  const reserveCall = (estimate: ReservationEstimate): BudgetReservation => {
    const costUsd = count(estimate.costUsd);
    const verdict = check(costUsd ?? 0);
    if (!verdict.ok) {
      const { stop } = verdict;
      throw new BudgetExceededError(
        `the ${stop.ceiling} spend ceiling would be passed`,
        { ...stop },
      );
    }
    reservedUsd += costUsd ?? 0;
    let open = true;
    const close = (): void => {
      if (!open) return;
      open = false;
      reservedUsd = Math.max(0, reservedUsd - (costUsd ?? 0));
      const at = fifo.indexOf(handle);
      if (at >= 0) fifo.splice(at, 1);
    };
    const handle: BudgetReservation = {
      costUsd,
      settle(usage: Usage): SettledCall {
        if (!open) {
          throw new Error("[research-helper] a reservation settles once");
        }
        close();
        return settleCall(usage, {
          inputTokens: estimate.inputTokens,
          outputTokens: estimate.outputTokens,
          ...(costUsd !== undefined && { costUsd }),
          ...(estimate.prices !== undefined && { prices: estimate.prices }),
        });
      },
      release: close,
    };
    return handle;
  };

  return {
    reserve(estimate): void {
      fifo.push(reserveCall(estimate));
    },
    settle(usage: Usage): void {
      const first = fifo[0];
      if (first !== undefined) {
        first.settle(usage);
        return;
      }
      // A settle with no reservation: count it as reported.
      settleCall(usage, { inputTokens: 0, outputTokens: 0 });
    },
    get spentUsd(): number {
      return run.costUsd;
    },
    get limitUsd(): number | undefined {
      const least = binding();
      return least === undefined
        ? undefined
        : run.costUsd + Math.max(0, least.roomUsd + reservedUsd);
    },
    check,
    binding,
    reserveCall,
    raiseLimit(ceiling: CeilingKind, limitUsd: number): void {
      const current = limitOf(ceiling);
      if (current === undefined) {
        throw new RangeError(
          `[research-helper] the ${ceiling} ceiling is off; there is nothing to raise`,
        );
      }
      if (!Number.isFinite(limitUsd) || limitUsd <= current) {
        throw new RangeError(
          `[research-helper] a raised ${ceiling} ceiling must be above ${String(current)} USD`,
        );
      }
      raised[ceiling] = limitUsd;
    },
    usage() {
      return { run, session: deps.session.totals };
    },
  };
}

/**
 * A guard that **fails closed**: every reservation throws
 * `ConfigurationError`, so no LLM request can be sent under it, and it can
 * spend nothing (`limitUsd` 0).
 *
 * *(Updated 2026-10-23: `P3-T35` replaced it in
 * `createPipelineContextFactory` with a real guard per job, so the product no
 * longer uses it.)* It stays for the callers that build a `PipelineContext`
 * by hand for a pipeline that makes no LLM call — `scripts/bench-search.ts`,
 * the search-import and backfill tests and `searchDialog-flow.spec.ts` —
 * where a real guard would be noise.
 */
export const UNWIRED_BUDGET_GUARD: BudgetGuard = Object.freeze({
  reserve(): void {
    throw new ConfigurationError(
      "no budget guard is wired into this job's context (P3-T35); nothing is sent",
    );
  },
  settle(): void {
    // Nothing can have been reserved.
  },
  spentUsd: 0,
  limitUsd: 0,
});

// ===========================================================================
// 4. Enforcement: every request through the router (item 266)
// ===========================================================================

/** What {@link withBudget} needs to estimate one request. */
export interface WithBudgetDeps {
  /**
   * The prices of a model, or `undefined` when none is known. Synchronous: the
   * composition root reads a snapshot (`ModelPriceSource.pricesFor`), the one
   * the cost dialog prices from (`plan/00` §6 item 278(b)).
   */
  pricesFor(modelId: string): ModelPrices | undefined;
  /** Now, for a promotion's end date. */
  now(): number;
  /** The token counter; `estTokens(text, modelId)` by default. */
  countTokens?(text: string, modelId: string): number;
}

/**
 * One request's reservation: the messages' tokens with the model's
 * calibration and D-06-5's headroom, the request's own output ceiling, and the
 * price of both. The prices travel with the estimate, so the call is settled
 * at them ({@link ReservationEstimate.prices}).
 *
 * `maxOutputTokens` absent reserves no output: the per-paper summarizer always
 * sends one (`docs/06` §5.2; `plan/00` §6 item 261(e)).
 *
 * @param request - the request about to be sent
 * @param deps - prices, clock, counter
 * @returns the estimate to reserve
 */
export function requestEstimate(
  request: ChatRequest,
  deps: WithBudgetDeps,
): ReservationEstimate {
  const countTokens =
    deps.countTokens ??
    ((text: string, model: string) => estTokens(text, model));
  let raw = 0;
  for (const message of request.messages) {
    raw += countTokens(message.content, request.model);
  }
  const inputTokens = withHeadroom(raw);
  const outputTokens = request.maxOutputTokens ?? 0;
  const prices = deps.pricesFor(request.model);
  const costUsd =
    prices === undefined
      ? undefined
      : costOf(prices, { inputTokens, outputTokens }, deps.now()).costUsd;
  return costUsd === undefined || prices === undefined
    ? { inputTokens, outputTokens }
    : { inputTokens, outputTokens, costUsd, prices };
}

function isRunGuard(guard: BudgetGuard): guard is RunBudgetGuard {
  return typeof (guard as Partial<RunBudgetGuard>).reserveCall === "function";
}

/** A reservation on any `BudgetGuard`: the handle for ours, the bare pair otherwise. */
function reserveOn(
  guard: BudgetGuard,
  estimate: ReservationEstimate,
): Pick<BudgetReservation, "release"> & { settle(usage: Usage): void } {
  if (isRunGuard(guard)) return guard.reserveCall(estimate);
  guard.reserve(estimate);
  return {
    settle: (usage) => {
      guard.settle(usage);
    },
    // The bare interface has no release; a foreign guard keeps its own books.
    release: () => undefined,
  };
}

const NO_USAGE: Usage = Object.freeze({
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
  costUsd: undefined,
});

/**
 * The refusal of a call that carries no guard (`plan/00` §6 item 278(a)).
 * `ConfigurationError`: the caller's wiring is at fault, which the summarize
 * stages rethrow as fatal; never `BudgetExceededError`, which the job runner
 * would read as a ceiling and answer with "raise the limit?".
 */
function unbudgeted(request: ChatRequest): ConfigurationError {
  return new ConfigurationError(
    "an LLM call through the shared router carries no budget guard " +
      "(LLMCallContext.budget); nothing is sent",
    { model: request.model },
  );
}

/**
 * `LLMCallContext.budget` enforced (`docs/07` §4.3: "Enforced before the
 * call"). A call whose context carries a guard reserves before it is sent and
 * settles when its answer arrives; the guard is not passed further down, so
 * nothing counts a call twice. **A call without a guard is refused** with
 * `ConfigurationError` before anything is sent (owner, 2026-10-23, `plan/00`
 * §6 item 278(a): fail closed).
 *
 * @param router - the router to wrap
 * @param deps - see {@link WithBudgetDeps}
 * @returns the same router surface, budgeted
 */
export function withBudget(router: LLMRouter, deps: WithBudgetDeps): LLMRouter {
  return {
    activeProvider: () => router.activeProvider(),
    resolveModel: (purpose) => router.resolveModel(purpose),
    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      const { budget, ...rest } = ctx;
      if (budget === undefined) throw unbudgeted(request);
      const reservation = reserveOn(budget, requestEstimate(request, deps));
      let response: ChatResponse;
      try {
        response = await router.chat(request, rest);
      } catch (error) {
        reservation.release();
        throw error;
      }
      reservation.settle(response.usage);
      return response;
    },
    async *chatStream(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      const { budget, ...rest } = ctx;
      if (budget === undefined) throw unbudgeted(request);
      const reservation = reserveOn(budget, requestEstimate(request, deps));
      let settled = false;
      try {
        for await (const chunk of router.chatStream(request, rest)) {
          if (chunk.done && !settled) {
            settled = true;
            reservation.settle(chunk.usage ?? NO_USAGE);
          }
          yield chunk;
        }
        if (!settled) {
          settled = true;
          reservation.settle(NO_USAGE);
        }
      } finally {
        if (!settled) reservation.release();
      }
    },
  };
}

// ===========================================================================
// 5. The resume guards (plan/00 §6 item 250; queue.ts's ResumeGuards)
// ===========================================================================

/** The work a resumed job still has to do, priced. */
export interface RemainingEstimate {
  readonly calls: number;
  /** With headroom; `undefined` when the model has no known price. */
  readonly costUsd: number | undefined;
}

/** What the two resume guards read. */
export interface ResumeGuardDeps {
  /** The pipeline's estimate over the record's checkpoint (`P3-T29`). */
  remaining(record: JobRecord): Promise<RemainingEstimate>;
}

/**
 * `ResumeGuards.confirm`: a resumed job whose remaining estimate is above
 * `summary.confirmAboveCents`, or cannot be priced, waits `paused` with
 * `awaiting-confirmation` for the user's yes. Installed by the composition
 * root (`P3-T35`).
 *
 * @param deps - see {@link ResumeGuardDeps}
 * @param confirmAboveCents - the threshold; the preference by default
 * @returns the guard
 */
export function createConfirmResumeGuard(
  deps: ResumeGuardDeps,
  confirmAboveCents: () => number = () => getPref("summaryConfirmAboveCents"),
): (record: JobRecord) => Promise<ResumeVerdict> {
  return async (record) => {
    const remaining = await deps.remaining(record);
    if (remaining.calls === 0) return { proceed: true };
    const above =
      remaining.costUsd === undefined ||
      costAboveCents(remaining.costUsd, confirmAboveCents());
    return above
      ? { proceed: false, pauseReason: "awaiting-confirmation" }
      : { proceed: true };
  };
}

/**
 * `ResumeGuards.ceilings`: a resumed job whose recorded spend plus its
 * remaining estimate would pass either ceiling waits `paused` with
 * `budget-stop` (item 234: pause and ask, never refuse).
 *
 * @param deps - see {@link ResumeGuardDeps}, plus the session counter
 * @returns the guard
 */
export function createCeilingsResumeGuard(
  deps: ResumeGuardDeps & {
    readonly session: SessionSpendCounter;
    readonly limits?: CeilingLimitsCents;
  },
): (record: JobRecord) => Promise<ResumeVerdict> {
  return async (record) => {
    const remaining = await deps.remaining(record);
    if (remaining.calls === 0) return { proceed: true };
    const guard = createBudgetGuard({
      session: deps.session,
      ...(deps.limits !== undefined && { limits: deps.limits }),
      resumedFrom: record.usage,
    });
    return guard.check(remaining.costUsd ?? 0).ok
      ? { proceed: true }
      : { proceed: false, pauseReason: "budget-stop" };
  };
}

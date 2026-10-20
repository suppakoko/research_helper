/**
 * Retry policy for the one outbound choke point — *when* to try again, and how
 * many times. **Not** *how long to wait*: that shape belongs to
 * `src/core/rateLimit/backoff.ts`.
 *
 * **Scope.** `P1-T05`. `docs/07` §7.4's closing sentence puts "all 429/5xx
 * handling" in `src/core/rateLimit/` **and** `src/core/http/retry.ts`, and the
 * split between the two is fixed by `P1-T04`'s **Do NOT**: "do not implement a
 * second backoff in the HTTP layer or in the adapter. `docs/02` §2.4 defers the
 * shape to `docs/07` §7.3 explicitly." So:
 *
 * - `docs/07` §7.3's decorrelated jitter — `sleep = min(cap, random(base,
 *   prev*3))` — is **`P1-T04`'s `backoff.ts`** and is deliberately absent here.
 *   {@link RetryPolicy.nextDelayMs} is the seam it is injected through.
 * - The per-host **attempt cap** §7.3 names is {@link RetryPolicy.maxAttempts},
 *   supplied per host by the caller. No number is invented here:
 *   `plan/README.md` §5 rule 4 forbids it. §7.3 published no cap value when
 *   this was written; its retry cells were filled on 2026-10-07 (NCBI,
 *   `P1-T28`) and 2026-10-14 (every other row), and they reach this module
 *   only through `src/core/rateLimit/hostLimiter.ts`'s `HOST_POLICIES` and
 *   {@link retryPolicyFromBudget} (`plan/00` §6 item 228, 2026-10-20).
 * - Which errors may be retried at all is {@link isRetryableError}, and it is
 *   `docs/07` §10.1's own `retryable` flag rather than a second opinion about
 *   status codes. Which of those this loop retries **by itself** is
 *   {@link isRetriedAutomatically}: every one except a `TimeoutError`
 *   (`plan/00` §6 item 230, owner, 2026-10-20) and a `StructuredOutputError`
 *   (`plan/00` §6 item 244, owner, 2026-10-20).
 * - How long the attempts and the waits between them may take **in total** is
 *   {@link REQUEST_BUDGET_MS}, a 90-second budget per request (`plan/00` §6
 *   item 233, owner, 2026-10-21; `docs/07` §7.3's dated note). Once it is
 *   spent, or when the next wait would cross it, the loop ends with the last
 *   error instead of retrying.
 *
 * ## `Retry-After` is parsed in `backoff.ts`, not here (`P1-T26`)
 *
 * `P1-T05` step 4 ("on 429/503 read `Retry-After`, call `limiter.penalize(...)`,
 * throw `RateLimitError`") and `P1-T04` step 6 ("`parseRetryAfter(headerValue)`
 * handling both the delta-seconds and the HTTP-date forms") each required the
 * same parse, and each shipped one — a `…Ms`-suffixed copy here and
 * `parseRetryAfter` in `src/core/rateLimit/backoff.ts`. `P1-T26` collapsed them
 * into the second, which is the better home because it already owns the jitter
 * and the budget the parsed delay is combined with. `src/core/http/client.ts`
 * imports it from there; this module parses nothing. The deleted name is spelled
 * nowhere in `src/` or `test/` on purpose: `P1-T26`'s first criterion is that a
 * recursive grep for it finds nothing, which is how a future reader can trust
 * that there is exactly one parser.
 *
 * **The removed copy was the unsafe one, and the difference is measured.** It
 * reached `Date.parse` with no shape check, and `Date.parse("120")` is *not*
 * `NaN` — V8 reads a bare number as a year, so `"120.5"`, `"-5"` and `"+120"`
 * became deadlines roughly two thousand years in the past, which clamp to "retry
 * immediately" against a host that has just asked us to stop. `backoff.ts`'s
 * `HTTP_DATE` gate is why its version returns `undefined` for all three and
 * falls back to {@link RetryPolicy.nextDelayMs} instead.
 */

import type { Clock } from "../clock";
import {
  RateLimitError,
  ResearchHelperError,
  StructuredOutputError,
  TimeoutError,
  UpstreamServerError,
} from "../errors";
import type { CancellationToken } from "../jobQueue/cancellation";
import { decorrelatedJitter, type RetryBudget } from "../rateLimit/backoff";

// ---------------------------------------------------------------------------
// 1. What may be retried
// ---------------------------------------------------------------------------

/**
 * Whether an error is worth another attempt.
 *
 * The answer is read off the error itself — `docs/07` §10.1 declares
 * `retryable` on every class in the hierarchy — so this function adds no
 * status-code opinion of its own. That matters for the two rules `docs/02` §2.4
 * states: a `BadRequestError` (other 4xx, which includes 400 and 404) is
 * `retryable: false` in §10.1, and `OperationCancelledError` is too.
 *
 * Only `ResearchHelperError` is inspected, and that is deliberate rather than
 * partial: `src/core/http/client.ts` maps every transport-level `HttpError` into
 * a §10.1 class *inside* the retried operation, so an error reaching this loop
 * is always one of §10.1's. Importing `HttpError` to check it as well would make
 * `client.ts` ↔ `retry.ts` a cycle for a case the shipped path cannot produce.
 *
 * An unrecognised throw is **not** retryable. It is a bug rather than a
 * transport condition, and retrying a bug hides it behind a delay.
 *
 * @param error - whatever was thrown
 * @returns `true` only for an error that declares itself retryable
 */
export function isRetryableError(error: unknown): boolean {
  return error instanceof ResearchHelperError && error.retryable;
}

/**
 * Whether {@link withRetry} tries again **on its own**, without the user.
 *
 * `plan/00` §6 item 230 (owner, 2026-10-20): **automatic retries skip
 * timeouts.** Only a 429 (`RateLimitError`), a 5xx (`UpstreamServerError`)
 * and an offline or network failure (`OfflineError`, `NetworkError`) are
 * retried; a `TimeoutError` surfaces after the one attempt. Before that date
 * a host that never answered cost up to the attempt cap of request timeouts
 * (`docs/07` §8.5's 60 s each) before the job saw the error.
 *
 * The rule is the retry policy's, **not** the error's. `TimeoutError` stays
 * `retryable: true` (`docs/07` §10.1), because that flag is also the
 * user-facing verdict: `src/ui/viewModels/searchImportViewModel.ts`'s
 * `errorView` offers the Retry button exactly when it is `true`, and a user
 * may still retry a timeout by hand. So this function narrows
 * {@link isRetryableError} and leaves the flag alone. `TimeoutError` is a
 * subclass of `NetworkError`, which is why the exclusion is by class: the
 * plain network failure it extends is still retried.
 *
 * **A `StructuredOutputError` is excluded the same way** (`P3-T38`, `plan/00`
 * §6 item 244, owner, 2026-10-20). `docs/03` §14.1's authority note puts it
 * outside the transport retry set: it is `retryable: true` because its retry
 * is the one-shot repair prompt (`docs/12` §18.3), and re-sending the same
 * request because its answer failed to parse would buy the same answer again.
 * Its flag stays `true`; only this loop skips it.
 *
 * @param error - whatever the attempt threw
 * @returns `true` only for a retryable error that is neither a timeout nor a
 *   structured-output failure
 */
export function isRetriedAutomatically(error: unknown): boolean {
  return (
    isRetryableError(error) &&
    !(error instanceof TimeoutError) &&
    !(error instanceof StructuredOutputError)
  );
}

// ---------------------------------------------------------------------------
// 2. The policy
// ---------------------------------------------------------------------------

/**
 * How many attempts a host allows, and how long to wait between them.
 *
 * Both members come from *outside* this module. `docs/07` §7.3 owns the numbers
 * and `src/core/rateLimit/` owns the jitter shape; this interface is how they
 * reach the request path.
 */
export interface RetryPolicy {
  /**
   * Total attempts including the first, so `1` means "never retry". §7.3's
   * "per-host attempt cap".
   */
  readonly maxAttempts: number;
  /**
   * The delay before the next attempt.
   *
   * Intended supplier: `decorrelatedJitter(prev, base, cap)` from
   * `src/core/rateLimit/backoff.ts` (`P1-T04`), partially applied with that
   * host's `base` and `cap`. It is a function rather than a number so the
   * jitter stays in one place and stays testable with a fixed sequence.
   *
   * @param prevDelayMs - the previous delay, `0` before the first retry
   * @param attempt - the attempt that just failed, 1-based
   */
  nextDelayMs(prevDelayMs: number, attempt: number): number;
}

/**
 * A host's {@link RetryPolicy}, built from its `docs/07` §7.3 retry cells.
 *
 * `plan/00` §6 item 228 (owner, 2026-10-20). The budget is the `retry` member
 * of the host's `HOST_POLICIES` row in `src/core/rateLimit/hostLimiter.ts`;
 * the delay is `src/core/rateLimit/backoff.ts`'s {@link decorrelatedJitter}
 * over that row's `baseMs` and `capMs`, so the jitter shape still lives in one
 * place (`P1-T04`'s **Do NOT**) and no number is written here. With
 * {@link withRetry}'s `prevDelayMs = 0` on the first retry the first wait is
 * exactly `baseMs`, which is the seam §7.3's cost table is computed against.
 *
 * @param budget - the host's base, cap and attempt cap
 * @param random - uniform `[0, 1)` source; a test injects a fixed one
 * @returns the policy the HTTP client's `retryFor` hands out for that host
 */
export function retryPolicyFromBudget(
  budget: RetryBudget,
  random: () => number = Math.random,
): RetryPolicy {
  // Validated now, so a malformed row fails at startup rather than on the
  // first refused request.
  decorrelatedJitter(budget.baseMs, budget.baseMs, budget.capMs, () => 0);
  return {
    maxAttempts: budget.maxAttempts,
    nextDelayMs: (prevDelayMs) =>
      decorrelatedJitter(prevDelayMs, budget.baseMs, budget.capMs, random),
  };
}

/**
 * The delay the server asked for, when the error carries one.
 *
 * A 429 carries it as {@link RateLimitError.retryAfterMs}. A 503 with
 * `Retry-After` carries it in `UpstreamServerError`'s context, where
 * `src/core/http/client.ts`'s `classify` puts it after the same parse. §7.3:
 * the retry cells "apply only when the server sent no `Retry-After` — one
 * that is sent always wins".
 */
function serverDirectedDelayMs(error: unknown): number | undefined {
  if (error instanceof RateLimitError) return error.retryAfterMs;
  if (error instanceof UpstreamServerError) {
    const { retryAfterMs } = error.context;
    return typeof retryAfterMs === "number" ? retryAfterMs : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 3. The total budget
// ---------------------------------------------------------------------------

/**
 * The total time one request's attempts and the waits between them may take:
 * **90 seconds** (`plan/00` §6 item 233, owner, 2026-10-21; the number is
 * `docs/07` §7.3's dated note's, not this file's).
 *
 * Item 230 stopped retrying timeouts, but a host that *answers* each attempt
 * with a slow 429 or 5xx was still retried to the attempt cap: `P0-T21`
 * measured arXiv 429s taking up to 46 s to fail, which is about 150 s for
 * three attempts. The budget ends that case after two attempts, at about 95 s.
 *
 * What the budget does **not** do is cut an attempt short. Each attempt keeps
 * its own request timeout (`docs/07` §8.5); the budget only decides whether
 * another wait and another attempt may start. See {@link withRetry}.
 */
export const REQUEST_BUDGET_MS = 90_000;

/** A request's total budget, as {@link withRetry} enforces it. */
export interface RequestBudget {
  /** Milliseconds for every attempt and every wait; {@link REQUEST_BUDGET_MS}. */
  readonly totalMs: number;
  /**
   * When the budget started, on the same clock as {@link RetryContext.clock}.
   *
   * `src/core/http/client.ts` answers with the instant its **first attempt
   * was handed to the transport**, so the wait for the host's bucket before
   * that attempt is not charged: a request queued behind others on a busy
   * host would otherwise spend its budget before it was ever sent. Absent, or
   * `undefined` when asked, means "when {@link withRetry} was entered".
   */
  readonly startedAtMs?: () => number | undefined;
}

/** What {@link withRetry} needs besides the operation itself. */
export interface RetryContext {
  readonly policy: RetryPolicy;
  /**
   * Supplies `now()` for `Retry-After` and for the budget, and `sleep()` for
   * the wait.
   */
  readonly clock: Clock;
  /**
   * The request's total budget (`plan/00` §6 item 233). Absent means none:
   * only the attempt cap ends the loop, which is what a caller outside the
   * HTTP client gets.
   */
  readonly budget?: RequestBudget;
  /**
   * Called when the budget ends the loop, before the last error is rethrown.
   * For logging; never throws into the loop.
   */
  readonly onBudgetSpent?: (info: {
    readonly attempt: number;
    readonly elapsedMs: number;
    readonly delayMs: number;
    readonly error: unknown;
  }) => void;
  /**
   * Cancellation, checked while waiting. `docs/07` §7.4 point 2: a job parked
   * on a delay must not block cancellation, and {@link Clock.sleep} rejects
   * with `OperationCancelledError` when the token fires.
   */
  readonly token?: CancellationToken;
  /** Called before each wait, for logging. Never throws into the loop. */
  readonly onRetry?: (info: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly error: unknown;
  }) => void;
}

/**
 * Run `operation`, retrying while the error says it is worth retrying and is
 * not a timeout ({@link isRetriedAutomatically}, item 230).
 *
 * The delay is `Retry-After` when the server named one — a
 * {@link RateLimitError} carries it as `retryAfterMs`, so a 429 waits exactly
 * as long as the host asked, and a 503's rides in its context — and
 * {@link RetryPolicy.nextDelayMs} otherwise. Every attempt is the caller's
 * `operation`, so in `src/core/http/client.ts` a retry passes through the
 * host's limiter exactly as the first attempt did; this loop only waits.
 * That ordering is `docs/07` §7.3's: the server's own figure is authoritative
 * and the jitter is what fills in when there is none.
 *
 * The last error is rethrown unchanged once the attempt cap is reached, which is
 * what makes "a 503 is retried up to the per-host cap and then throws
 * `UpstreamServerError`" observable at the call site.
 *
 * **The total budget** ({@link RetryContext.budget}, `plan/00` §6 item 233).
 * After a failed attempt the loop knows the wait it would start. If the time
 * already spent since {@link RequestBudget.startedAtMs} plus that wait reaches
 * the budget, no wait starts and the last error is rethrown unchanged — so a
 * spent budget ends the loop, and so does a wait that would cross it; a retry
 * always *starts* inside the budget. An attempt already running is never cut:
 * it keeps its own request timeout. Cancellation is checked first, so a
 * cancelled request still ends with `OperationCancelledError` at once.
 *
 * @param operation - receives the 1-based attempt number
 * @param context - see {@link RetryContext}
 * @returns whatever `operation` resolved with
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  context: RetryContext,
): Promise<T> {
  const { policy, clock, budget } = context;
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
  const enteredMs = clock.now();
  let previousDelayMs = 0;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetriedAutomatically(error)) {
        throw error;
      }
      // A cancel that landed while the failed attempt was in flight stops the
      // loop here, before a wait is scheduled or a retry is logged (`docs/07`
      // §7.4; `plan/00` §6 item 228: "cancellation stops retrying at once").
      context.token?.throwIfCancelled();

      const delayMs =
        serverDirectedDelayMs(error) ??
        policy.nextDelayMs(previousDelayMs, attempt);
      previousDelayMs = delayMs;

      if (budget !== undefined) {
        // Item 233: measured on the injected clock, from the first attempt's
        // start on the wire when the caller knows it.
        const startedMs = budget.startedAtMs?.() ?? enteredMs;
        const elapsedMs = clock.now() - startedMs;
        // `>=`, not `>`: a wait that ends exactly at the budget would start
        // the next attempt after the budget had run out.
        if (elapsedMs + delayMs >= budget.totalMs) {
          context.onBudgetSpent?.({ attempt, elapsedMs, delayMs, error });
          throw error;
        }
      }

      context.onRetry?.({ attempt, delayMs, error });
      // Rejects with OperationCancelledError if the token fires while waiting;
      // that error is not retryable, so it propagates out of the loop.
      await clock.sleep(delayMs, context.token);
    }
  }
}

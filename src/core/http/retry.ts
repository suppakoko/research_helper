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
 *   status codes.
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

/** What {@link withRetry} needs besides the operation itself. */
export interface RetryContext {
  readonly policy: RetryPolicy;
  /** Supplies `now()` for `Retry-After` and `sleep()` for the wait. */
  readonly clock: Clock;
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
 * Run `operation`, retrying while the error says it is worth retrying.
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
 * @param operation - receives the 1-based attempt number
 * @param context - see {@link RetryContext}
 * @returns whatever `operation` resolved with
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  context: RetryContext,
): Promise<T> {
  const { policy, clock } = context;
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
  let previousDelayMs = 0;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableError(error)) throw error;
      // A cancel that landed while the failed attempt was in flight stops the
      // loop here, before a wait is scheduled or a retry is logged (`docs/07`
      // §7.4; `plan/00` §6 item 228: "cancellation stops retrying at once").
      context.token?.throwIfCancelled();

      const delayMs =
        serverDirectedDelayMs(error) ??
        policy.nextDelayMs(previousDelayMs, attempt);
      previousDelayMs = delayMs;

      context.onRetry?.({ attempt, delayMs, error });
      // Rejects with OperationCancelledError if the token fires while waiting;
      // that error is not retryable, so it propagates out of the loop.
      await clock.sleep(delayMs, context.token);
    }
  }
}

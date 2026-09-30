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
 *   `plan/README.md` §5 rule 4 forbids it and §7.3 publishes no cap value.
 * - Which errors may be retried at all is {@link isRetryableError}, and it is
 *   `docs/07` §10.1's own `retryable` flag rather than a second opinion about
 *   status codes.
 *
 * ## `parseRetryAfterMs` is also declared by `P1-T04` step 6
 *
 * `P1-T05` step 4 says "on 429/503 read `Retry-After`, call
 * `limiter.penalize(...)`, throw `RateLimitError`", and `P1-T04` step 6 says
 * `backoff.ts` implements "`parseRetryAfter(headerValue)` handling both the
 * delta-seconds and the HTTP-date forms". Both cards own the same parse. It is
 * implemented here because this card's first acceptance criterion measures it
 * (`Retry-After: 2` → `retryAfterMs === 2000`) and this card's `Files` list has
 * nowhere else to put it. **The duplication is reported against the cards, not
 * resolved silently** — whichever of the two ends up authoritative, the other
 * should import it rather than keep a second copy.
 */

import type { Clock } from "../clock";
import { RateLimitError, ResearchHelperError } from "../errors";
import type { CancellationToken } from "../jobQueue/cancellation";

// ---------------------------------------------------------------------------
// 1. `Retry-After`
// ---------------------------------------------------------------------------

/**
 * `Retry-After` in milliseconds, in either RFC 9110 form.
 *
 * Two forms exist and both are seen in the wild: `delay-seconds` (a
 * non-negative integer) and `HTTP-date`. A date already in the past, and a
 * negative delta, yield `0` — "retry now" — rather than a negative delay, which
 * would sort before the present in every deadline comparison.
 *
 * @param headerValue - the raw header, or `undefined` when absent
 * @param nowMs - epoch milliseconds, from the injected {@link Clock}; the
 *   HTTP-date form is only meaningful relative to a clock this code controls
 * @returns the delay in milliseconds, or `undefined` when there is no usable
 *   value
 */
export function parseRetryAfterMs(
  headerValue: string | undefined,
  nowMs: number,
): number | undefined {
  if (headerValue === undefined) return undefined;
  const raw = headerValue.trim();
  if (raw === "") return undefined;

  // delay-seconds first: `Date.parse("120")` is *not* NaN in every engine, so
  // testing the numeric form second would misread a small integer as a year.
  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }
  if (/^-\d+$/.test(raw)) {
    return 0;
  }

  const atMs = Date.parse(raw);
  if (Number.isNaN(atMs)) return undefined;
  return Math.max(0, atMs - nowMs);
}

// ---------------------------------------------------------------------------
// 2. What may be retried
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
// 3. The policy
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
 * as long as the host asked — and {@link RetryPolicy.nextDelayMs} otherwise.
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

      const serverDirected =
        error instanceof RateLimitError ? error.retryAfterMs : undefined;
      const delayMs =
        serverDirected ?? policy.nextDelayMs(previousDelayMs, attempt);
      previousDelayMs = delayMs;

      context.onRetry?.({ attempt, delayMs, error });
      // Rejects with OperationCancelledError if the token fires while waiting;
      // that error is not retryable, so it propagates out of the loop.
      await clock.sleep(delayMs, context.token);
    }
  }
}

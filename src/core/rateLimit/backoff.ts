/**
 * `Retry-After` parsing and `docs/07` §7.3's decorrelated-jitter backoff.
 *
 * **Scope.** `P1-T04`. The *shape* of a retry and nothing that performs one. The
 * retry loop itself is `src/core/http/retry.ts` (`P1-T05`), the 429 →
 * {@link ./tokenBucket.RateLimiter.penalize} call is the HTTP
 * client's, and this file has no clock, no network and no state beyond one
 * sequence object.
 *
 * **Authority.** §7.3's "429 / `Retry-After` handling" paragraph: "Retries use
 * decorrelated jitter (`sleep = min(cap, random(base, prev*3))`) with a per-host
 * attempt cap; after the cap the job fails with a retryable `RateLimitError`".
 * `docs/02` §2.4 and `docs/05` §9.4's authority note both defer the shape here
 * and forbid a second one — `docs/05` names the form not to write,
 * `(2 ** attempt) * 1000 * (0.5 + Math.random())`, explicitly.
 *
 * ## Why there is exactly one backoff shape in this file
 *
 * Three different shapes appear in the corpus and only one of them is shipped
 * for source hosts:
 *
 * - §7.3's decorrelated jitter, `min(cap, random(base, prev*3))` — **this one**.
 * - `docs/03` §11.6's full jitter over `min(cap, base * 2**attempt)`, for LLM
 *   providers. `P3-T05` step 7 adds it, and its `Files` list modifies this
 *   module, so the two will sit side by side with the retryable *sets* keeping
 *   them apart. Nothing in Phase 1 may use it.
 * - `docs/05` §9.4's inline sketch, which that section itself rules out.
 *
 * ## The three numbers §7.3 does not give
 *
 * `base`, `cap` and the attempt cap are parameters here and carry **no
 * defaults**. `plan/README.md` §5 rule 4 forbids hardcoding a limit anywhere but
 * `docs/07` §7.3 (rates) and §8.5 (preferences) — and neither section declares
 * any of the three. §7.3's policy table has columns for rate, burst and max
 * concurrent only; §8.5 has no retry rows; `docs/03` §11.6's `maxAttempts = 5,
 * baseMs = 1000, capMs = 60_000` are the *LLM* defaults for the *other* shape.
 * So the values are the caller's to supply until §7.3 gains a column, and that
 * gap is reported against the card rather than filled with a plausible-looking
 * guess.
 */

// ---------------------------------------------------------------------------
// 1. Retry-After
// ---------------------------------------------------------------------------

/** `Retry-After` in the delay-seconds form: a run of ASCII digits, nothing else. */
const DELAY_SECONDS = /^\d+$/;

/**
 * `Retry-After` in the HTTP-date form, as a shape check *before* `Date.parse`.
 *
 * **`Date.parse` alone is unsafe here, measured 2026-09-30.** It is specified to
 * fall back to implementation-defined heuristics for anything that is not an ISO
 * date, and on V8 those heuristics read a bare number as a *year*:
 *
 * ```
 * Date.parse("120.5") === -58369969672000   // the year 120
 * Date.parse("-5")    ===   988642800000    // 2001
 * Date.parse("+120")  === -58380424072000
 * ```
 *
 * All three are values a server can legally never send, but all three reach this
 * function as soon as an upstream is sloppy — and a naive `Date.parse` turns them
 * into a deadline roughly two thousand years in the past, which clamps to "retry
 * immediately" and hammers a host that has just asked us to stop. So the date
 * branch is gated on the value actually *looking* like an HTTP-date.
 *
 * The pattern admits RFC 9110's preferred IMF-fixdate
 * (`"Sun, 06 Nov 1994 08:49:37 GMT"`, which is what `Date.prototype.toUTCString`
 * emits) and the obsolete RFC 850 form (`"Sunday, 06-Nov-94 08:49:37 GMT"`).
 * The third, `asctime` (`"Sun Nov  6 08:49:37 1994"`), is not admitted: it has no
 * timezone at all, so `Date.parse` would read it in the *local* zone and produce
 * a delay wrong by the offset. A server sending it gets the jittered fallback,
 * which is a correct delay rather than a plausible wrong one.
 */
const HTTP_DATE =
  /^[A-Za-z]{3,9},\s+\d{1,2}[\s-][A-Za-z]{3}[\s-]\d{2,4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/;

/**
 * Parse a `Retry-After` header value into a delay in milliseconds.
 *
 * RFC 9110 §10.2.3 gives the field two forms and both appear in the wild, so
 * both are handled:
 *
 * - **delay-seconds** — a non-negative integer count of seconds. `"120"` → `120_000`.
 * - **HTTP-date** — an absolute instant, so the delay is `date - nowEpochMs`.
 *   A date already in the past yields `0` ("retry now"), never a negative delay.
 *
 * Returns `undefined` for an absent, empty or unparseable value, which is the
 * "no `Retry-After` header" case the caller must fall back to
 * {@link decorrelatedJitter} for. A fractional or signed value such as `"120.5"`
 * or `"-5"` is *not* a delay-seconds token and does not parse as a date either,
 * so it too yields `undefined` rather than a number the server did not send.
 *
 * `Date.parse` does the date half rather than a hand-rolled RFC 9110 parser —
 * `Date` is plain ECMAScript and so present in the plugin sandbox — but only
 * after the value has been shape-checked against {@link HTTP_DATE}, for the
 * measured reason recorded there: unguarded, `Date.parse` reads `"120.5"` and
 * `"-5"` as *years*.
 *
 * **Deviation from the card, reported rather than hidden.** `P1-T04` step 6 and
 * its fifth criterion write this as `parseRetryAfter(headerValue)`, with one
 * argument. The HTTP-date form cannot be turned into a *delta* without a
 * reference instant, and `src/core/clock.ts` is explicit that `core/` reads wall
 * time only through the injected {@link ../clock.Clock} — a `Date.now()` here
 * would be the one call the clock port exists to remove, and would make this
 * function untestable under a manual clock. So `nowEpochMs` is a required second
 * parameter, supplied by the caller's clock.
 *
 * @param headerValue - the raw header value, or `undefined`/`null` if absent
 * @param nowEpochMs - the caller's `clock.now()`, for the HTTP-date form
 * @returns milliseconds to wait, or `undefined` if the header gives no answer
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  nowEpochMs: number,
): number | undefined {
  if (headerValue === null || headerValue === undefined) return undefined;
  const value = headerValue.trim();
  if (value === "") return undefined;

  if (DELAY_SECONDS.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }

  if (!HTTP_DATE.test(value)) return undefined;
  const atEpochMs = Date.parse(value);
  if (Number.isNaN(atEpochMs)) return undefined;
  return Math.max(0, atEpochMs - nowEpochMs);
}

// ---------------------------------------------------------------------------
// 2. Decorrelated jitter — docs/07 §7.3
// ---------------------------------------------------------------------------

/**
 * §7.3's `sleep = min(cap, random(base, prev*3))`.
 *
 * "Decorrelated jitter" is the AWS *Exponential Backoff and Jitter* variant that
 * grows from the previous *actual* sleep rather than from an attempt counter.
 * That is what `docs/03` §11.6's own note is about — "with a 100-paper batch,
 * unjittered backoff synchronizes retries into a thundering herd": two jobs that
 * were throttled by the same upstream 429 draw independent delays here and so
 * stop arriving together.
 *
 * `random(base, prev*3)` is read as a uniform draw over `[base, prev*3]`. When
 * `prev * 3` is below `base` — which is the case on the first retry, where the
 * convention is to pass `prev = base` — the interval collapses to the single
 * point `base`, so the first delay is never shorter than `base`.
 *
 * The result is **not rounded**. §7.3's formula is transcribed as written, and
 * {@link ../clock.Clock.sleep} takes fractional milliseconds.
 *
 * @param prevMs - the previous delay this sequence produced; `base` on the first
 *   retry, `0` is accepted and treated the same way
 * @param baseMs - the floor, and the first delay's value; must be positive
 * @param capMs - the ceiling; must be at least `baseMs`
 * @param random - uniform `[0, 1)` source; injected so a test can assert the
 *   interval's ends rather than sample and hope
 * @returns the delay in milliseconds
 */
export function decorrelatedJitter(
  prevMs: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) {
    throw new RangeError(
      `baseMs must be a positive finite number, got ${baseMs}`,
    );
  }
  if (!Number.isFinite(capMs) || capMs < baseMs) {
    throw new RangeError(`capMs must be finite and >= baseMs, got ${capMs}`);
  }
  if (!Number.isFinite(prevMs) || prevMs < 0) {
    throw new RangeError(
      `prevMs must be a non-negative finite number, got ${prevMs}`,
    );
  }
  const low = baseMs;
  const high = Math.max(low, prevMs * 3);
  return Math.min(capMs, low + random() * (high - low));
}

// ---------------------------------------------------------------------------
// 3. The per-host attempt cap
// ---------------------------------------------------------------------------

/**
 * What a host's retry budget consists of. No defaults — see the module header on
 * the three numbers §7.3 does not declare.
 */
export interface RetryBudget {
  /** {@link decorrelatedJitter}'s floor, and the first delay. */
  readonly baseMs: number;
  /** {@link decorrelatedJitter}'s ceiling. */
  readonly capMs: number;
  /**
   * §7.3's "per-host attempt cap", counted as **total attempts including the
   * first**, so a budget of `n` allows `n - 1` retries. That is `docs/03`
   * §11.6's reading of the same word (`attempt >= maxAttempts - 1` throws) and
   * keeping the two the same is what lets one number be quoted in both places.
   */
  readonly maxAttempts: number;
}

/**
 * A per-host retry sequence: successive delays, then exhaustion.
 *
 * Stateful on purpose. Decorrelated jitter grows from the previous delay, so the
 * sequence has to remember it; an attempt *counter* passed in from the call site
 * would not be enough to reproduce the same progression.
 */
export interface BackoffSequence {
  /** How many delays have been handed out. */
  readonly delaysIssued: number;
  /**
   * The next delay, or `undefined` once the attempt cap is spent — §7.3: "after
   * the cap the job fails with a retryable `RateLimitError`". The caller turns
   * that `undefined` into the error; this module throws nothing, so one failure
   * policy is not baked into every host.
   *
   * @param retryAfterMs - {@link parseRetryAfter}'s answer when the server sent
   *   one. The delay becomes `max(retryAfterMs, jittered)`, which is `docs/03`
   *   §11.6's rule and also satisfies `docs/05` §9.4's stronger "`Retry-After`
   *   always wins when present", since the result is never shorter than the
   *   server asked for. It is deliberately **not** clamped to `capMs`: a server
   *   that says "come back in an hour" outranks our own ceiling, and §7.3's
   *   `penalize()` has parked the whole host for that long anyway.
   */
  next(retryAfterMs?: number): number | undefined;
}

/**
 * Create a {@link BackoffSequence} over `budget`.
 *
 * @param budget - the host's base, cap and attempt cap
 * @param random - uniform `[0, 1)` source, forwarded to
 *   {@link decorrelatedJitter}
 */
export function createBackoff(
  budget: RetryBudget,
  random: () => number = Math.random,
): BackoffSequence {
  if (!Number.isInteger(budget.maxAttempts) || budget.maxAttempts < 1) {
    throw new RangeError(
      `maxAttempts must be a positive integer, got ${budget.maxAttempts}`,
    );
  }
  // Validated eagerly, so a bad base/cap is a construction error rather than a
  // surprise on the first failure in production.
  decorrelatedJitter(budget.baseMs, budget.baseMs, budget.capMs, () => 0);

  let issued = 0;
  let prevMs = budget.baseMs;

  return {
    get delaysIssued(): number {
      return issued;
    },
    next(retryAfterMs?: number): number | undefined {
      if (issued >= budget.maxAttempts - 1) return undefined;
      const jittered = decorrelatedJitter(
        prevMs,
        budget.baseMs,
        budget.capMs,
        random,
      );
      issued += 1;
      // The progression advances by the *jittered* value, not by the server's:
      // a single long `Retry-After` must not push every later delay to the cap,
      // and §7.3's `prev` is the sleep this shape produced.
      prevMs = jittered;
      return retryAfterMs === undefined
        ? jittered
        : Math.max(retryAfterMs, jittered);
    },
  };
}

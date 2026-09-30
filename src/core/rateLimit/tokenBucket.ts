/**
 * `RateLimiter`, `RateLimiterConfig`, `RateLimiterStats` and the `TokenBucket`
 * that implements them — per-host request pacing.
 *
 * **Scope.** `P1-T04`. The primitive only. The per-host *registry* is
 * `./hostLimiter.ts` and the retry shape is `./backoff.ts`; neither is here,
 * and nothing in this file knows what a host *is* beyond {@link
 * TokenBucket.key} being an opaque string.
 *
 * **Authority.** Every interface below is
 * `docs/07-architecture-and-data-model.md` §4.1's, transcribed — `plan/README.md`
 * §5 rule 3 makes §4.1 the sole authority for types. The class skeleton, the
 * `refill()` arithmetic and the 429 → `penalize()` rule are §7.3's.
 *
 * ## One bucket per host, shared by every job
 *
 * §7.3 opens with the reason, and it is the whole point of the module: "One
 * `TokenBucket` per **host**, shared by every job — not per adapter instance and
 * not per job, or two concurrent jobs would each get a full budget and together
 * exceed the policy." This file makes that *possible*; `./hostLimiter.ts` makes
 * it *true*, because it owns the only instances.
 *
 * ## Why the clock is injected
 *
 * `docs/01` §2.3 measured that `performance` is absent from the plugin sandbox,
 * and `src/core/clock.ts` is the port that makes `Date.now()` the single wall
 * clock. §7.3's skeleton takes a `Clock` as its third constructor argument for
 * exactly this reason: a limiter that read the clock itself could only be tested
 * against real time, and "20 acquires at 2.5/s" is a 7.6-second test.
 * {@link ../clock.createManualClock} drives every assertion in
 * `test/unit/core/tokenBucket.test.ts` instead.
 *
 * ## Waiters are woken by a single pump, not by one timer each
 *
 * A parked {@link TokenBucket.acquire} does **not** hold its own `clock.sleep`.
 * One sleep at a time is scheduled for the *head* of the queue; when it fires,
 * {@link TokenBucket.drain} serves everything the bucket can afford and the next
 * sleep is scheduled. Three consequences worth knowing:
 *
 * 1. Service is strictly first-in-first-out, for the reason
 *    `src/core/concurrency.ts` gives for `Semaphore`: §7.7's progress reporting
 *    counts completions against a total, and a queue that reordered work would
 *    make "Fetching PubMed page 3 of 8" untrue.
 * 2. {@link TokenBucket.penalize} and {@link TokenBucket.reconfigure} only have
 *    to move one deadline, not *n*.
 * 3. Under {@link ../clock.ManualClock} a test advances time once per served
 *    waiter, which is the granularity the card's first criterion ("±1 tick") is
 *    written at.
 *
 * ## Two gaps in §4.1 this file cannot close, recorded rather than invented
 *
 * **`maxConcurrent` is unenforceable through this interface.**
 * {@link RateLimiterConfig.maxConcurrent} is "a hard cap on simultaneous
 * in-flight requests to this host" and {@link RateLimiterStats.inFlight} reports
 * the current count — but §4.1's `RateLimiter` has **no member that signals a
 * request has finished**. `acquire` resolves `void`, so there is no release
 * handle and no `release()` / `run()` method to pair with it. A counter this
 * file incremented could therefore never be decremented, and gating `acquire`
 * on it would deadlock the bucket permanently after `maxConcurrent` calls. So
 * {@link TokenBucket} paces by *rate* and reports `inFlight: 0`, the concurrency
 * cap is carried as data on the policy row
 * ({@link ./hostLimiter.HostRateLimitPolicy}) for whoever owns the in-flight
 * count, and the gap is reported against the card instead of being coded around.
 *
 * **`total429s` counts penalizations, not 429s.** §7.3 calls `penalize()` for
 * "any 429 **or 503** with `Retry-After`", so the counter §4.1 names `total429s`
 * is incremented by both. §4.1 owns the name, so the name ships; the reading is
 * "server-directed pauses applied".
 */

import type { Clock } from "../clock";
import { createDeferred, type Deferred } from "../concurrency";
import { OperationCancelledError } from "../errors";
import type { CancellationToken } from "../jobQueue/cancellation";

// ---------------------------------------------------------------------------
// 1. The interfaces — docs/07 §4.1, verbatim
// ---------------------------------------------------------------------------

/**
 * Per-host request pacing. `acquire` resolves when a token is available,
 * rejecting early if the token is cancelled.
 */
export interface RateLimiter {
  /** Stable identifier, normally the API host, e.g. "eutils.ncbi.nlm.nih.gov". */
  readonly key: string;
  /**
   * Wait until `cost` tokens are available, then consume them.
   *
   * @param cost number of tokens (default 1); some endpoints count heavier.
   */
  acquire(cost?: number, token?: CancellationToken): Promise<void>;
  /** Non-blocking attempt. Returns false if not enough tokens right now. */
  tryAcquire(cost?: number): boolean;
  /**
   * Apply a server-directed pause (e.g. HTTP 429 `Retry-After`).
   * Blocks all future acquires on this key until the deadline.
   */
  penalize(untilEpochMs: number, reason: string): void;
  /** Runtime reconfiguration, e.g. after the user enters an NCBI API key. */
  reconfigure(config: RateLimiterConfig): void;
  readonly stats: RateLimiterStats;
}

export interface RateLimiterConfig {
  /** Sustained rate. */
  readonly ratePerSecond: number;
  /** Bucket depth = max burst. Set to 1 for strict "no burst" APIs. */
  readonly burst: number;
  /** Hard cap on simultaneous in-flight requests to this host. */
  readonly maxConcurrent: number;
  /** Optional minimum spacing between request starts, in ms. */
  readonly minIntervalMs?: number;
}

export interface RateLimiterStats {
  readonly available: number;
  readonly inFlight: number;
  readonly queued: number;
  readonly penalizedUntilEpochMs: number | undefined;
  readonly totalAcquired: number;
  readonly total429s: number;
}

// ---------------------------------------------------------------------------
// 2. Internals
// ---------------------------------------------------------------------------

/**
 * Slack allowed when comparing the token count against a cost.
 *
 * `refill()` multiplies a fractional second by a fractional rate, so the token
 * count after exactly the right amount of time can land a few ulps *below* the
 * cost — 2.5 tokens/s for 400 ms is one token in arithmetic and can be
 * `0.9999999999999999` in binary. Without this the bucket would sleep another
 * whole millisecond for a token it has already earned, and the card's "±1 tick"
 * criterion would drift by one tick per acquire. 1e-9 tokens is 4e-10 ms at
 * 2.5/s: far below any observable deadline, far above any rounding error.
 */
const TOKEN_EPSILON = 1e-9;

/** One parked {@link TokenBucket.acquire} call. */
interface Waiter {
  /** Tokens this caller asked for. */
  readonly cost: number;
  readonly deferred: Deferred<void>;
  /** Drops the waiter's cancellation subscription once it is served. */
  unsubscribe: () => void;
}

/** Reject a config the bucket cannot honour, at the point it is supplied. */
function assertConfig(config: RateLimiterConfig): void {
  if (!Number.isFinite(config.ratePerSecond) || config.ratePerSecond <= 0) {
    throw new RangeError(
      `ratePerSecond must be a positive finite number, got ${config.ratePerSecond}`,
    );
  }
  if (!Number.isFinite(config.burst) || config.burst < 1) {
    throw new RangeError(
      `burst must be a finite number >= 1, got ${config.burst}`,
    );
  }
  if (!Number.isInteger(config.maxConcurrent) || config.maxConcurrent < 1) {
    throw new RangeError(
      `maxConcurrent must be a positive integer, got ${config.maxConcurrent}`,
    );
  }
  if (
    config.minIntervalMs !== undefined &&
    (!Number.isFinite(config.minIntervalMs) || config.minIntervalMs < 0)
  ) {
    throw new RangeError(
      `minIntervalMs must be a non-negative finite number, got ${config.minIntervalMs}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. TokenBucket — docs/07 §7.3
// ---------------------------------------------------------------------------

export class TokenBucket implements RateLimiter {
  private tokens: number;

  private lastRefillMs: number;

  /**
   * §7.3's skeleton declares this and §4.1's stats report it, but §4.1's
   * `RateLimiter` gives no way to signal that a request *finished* — see the
   * module header. It is `readonly 0` rather than a mutable counter so that the
   * situation is visible in the type rather than hidden behind a number that
   * never moves.
   */
  private readonly inFlight = 0;

  private readonly waiters: Waiter[] = [];

  private penalizedUntilMs = 0;

  private penaltyReason: string | undefined;

  /**
   * When the most recent acquire was served, for
   * {@link RateLimiterConfig.minIntervalMs}.
   *
   * `-Infinity` rather than the construction time: `minIntervalMs` is "minimum
   * spacing between request *starts*" (§4.1), and there is no earlier start to
   * be spaced from, so the first acquire must not be delayed by it.
   */
  private lastStartMs = Number.NEGATIVE_INFINITY;

  /** The deadline of the pump sleep in flight, or `undefined` if none is. */
  private pumpAtMs: number | undefined;

  /**
   * Bumped on every {@link schedule}. A pump sleep whose generation no longer
   * matches was superseded by an earlier deadline and must do nothing when it
   * fires — `Clock.sleep` has no cancel except through a `CancellationToken`,
   * and creating a token per pump to abandon one timer would be heavier than a
   * counter.
   */
  private pumpGeneration = 0;

  private totalAcquired = 0;

  private penalizations = 0;

  /**
   * @param key - the limiter's stable identity, normally the API host
   * @param config - the policy to enforce; `./hostLimiter.ts` supplies §7.3's
   * @param clock - the injected clock (`src/core/clock.ts`)
   */
  constructor(
    readonly key: string,
    private config: RateLimiterConfig,
    private readonly clock: Clock,
  ) {
    assertConfig(config);
    this.tokens = config.burst;
    this.lastRefillMs = clock.now();
  }

  // -- docs/07 §4.1's members ------------------------------------------------

  /**
   * Wait until `cost` tokens are available, then consume them.
   *
   * Rejects with {@link OperationCancelledError} if `token` is cancelled while
   * parked, or is already cancelled on entry. That is `docs/07` §7.4's second
   * cancellation checkpoint — "inside `RateLimiter.acquire` — a job waiting on a
   * token bucket must not block cancellation" — and a cancelled waiter consumes
   * no token, so abandoning the queue costs the *other* callers nothing.
   *
   * `async` deliberately, for the reason `Semaphore.acquire` records: an
   * already-cancelled token, and an unsatisfiable `cost`, must produce a
   * **rejected promise** rather than a synchronous throw, because a method that
   * sometimes throws before returning its promise and sometimes rejects it
   * cannot be handled in one place. The satisfiable fast path still runs
   * synchronously up to the `return`, so two callers cannot both see the same
   * token.
   *
   * @param cost - tokens to consume; must be in `1..burst`
   * @param token - optional cancellation
   */
  async acquire(cost = 1, token?: CancellationToken): Promise<void> {
    if (token?.isCancellationRequested) {
      token.throwIfCancelled();
    }
    this.assertCost(cost);

    this.refill();
    const now = this.clock.now();
    // The queue check is what makes service FIFO: a caller arriving while
    // others are parked must not take a token they have been waiting for.
    if (this.waiters.length === 0 && this.serveable(cost, now)) {
      this.take(cost, now);
      return;
    }

    const deferred = createDeferred<void>();
    const entry: Waiter = { cost, deferred, unsubscribe: () => undefined };
    this.waiters.push(entry);
    const unsubscribe = token?.onCancelled((reason) => {
      const at = this.waiters.indexOf(entry);
      if (at >= 0) this.waiters.splice(at, 1);
      deferred.reject(new OperationCancelledError(reason));
      // The head may just have changed, and with it the deadline worth waking
      // at. Cheap to redo; a hang if it is skipped.
      this.schedule();
    });
    if (unsubscribe !== undefined) entry.unsubscribe = unsubscribe;
    this.schedule();
    return deferred.promise;
  }

  /**
   * Take `cost` tokens if they are free right now.
   *
   * Returns `false` rather than jumping a non-empty queue, and `false` for a
   * `cost` above {@link RateLimiterConfig.burst} — which {@link acquire} rejects
   * instead, because an unwaitable cost there would park forever.
   *
   * @param cost - tokens to consume; default 1
   * @returns whether the tokens were consumed
   */
  tryAcquire(cost = 1): boolean {
    if (!Number.isInteger(cost) || cost < 1 || cost > this.config.burst) {
      return false;
    }
    this.refill();
    const now = this.clock.now();
    if (this.waiters.length > 0 || !this.serveable(cost, now)) return false;
    this.take(cost, now);
    return true;
  }

  /**
   * Apply a server-directed pause. §7.3's 429 / `Retry-After` rule.
   *
   * It "parks *every* waiter on that host — so one job's throttling
   * automatically slows all others", and that falls out of the design rather
   * than being done waiter by waiter: the deadline is a property of the
   * *bucket*, {@link serveable} consults it for every caller, and the one pump
   * sleep is rescheduled to the deadline.
   *
   * A deadline **earlier** than one already in force is recorded (for the
   * reason) but does not shorten the pause: two upstream 429s must not let the
   * second, smaller `Retry-After` undo the first.
   *
   * @param untilEpochMs - epoch ms before which nothing may be acquired
   * @param reason - developer-facing note, e.g. `"429 Retry-After: 120"`
   */
  penalize(untilEpochMs: number, reason: string): void {
    if (!Number.isFinite(untilEpochMs)) {
      throw new RangeError(
        `penalize(): untilEpochMs must be finite, got ${untilEpochMs}`,
      );
    }
    this.penalizations += 1;
    this.penaltyReason = reason;
    if (untilEpochMs > this.penalizedUntilMs) {
      this.penalizedUntilMs = untilEpochMs;
    }
    this.schedule();
  }

  /**
   * Swap the policy in place — §4.1: "e.g. after the user enters an NCBI API
   * key".
   *
   * **Queued waiters are kept.** They are the point: the user entering a key
   * mid-run raises NCBI from 2.5/s to 8/s (§7.3), and a reconfigure that
   * restarted the queue would reject work that is merely slow. The order below
   * is load-bearing: credit at the *old* rate first, then adopt the new config,
   * then serve whatever the new rate already permits.
   *
   * @param config - the replacement policy
   */
  reconfigure(config: RateLimiterConfig): void {
    assertConfig(config);
    this.refill();
    this.config = config;
    // A smaller burst must not leave more tokens in the bucket than its depth.
    this.tokens = Math.min(this.tokens, config.burst);
    this.drain();
    this.schedule();
  }

  /**
   * A snapshot for diagnostics (§10.4's debug bundle) and for tests.
   *
   * Refills first, so `available` is the count *now* rather than the count as of
   * the last acquire. That makes this getter mildly effectful, which is the
   * lesser evil: a stale `available` is the number a reader would act on.
   */
  get stats(): RateLimiterStats {
    this.refill();
    const now = this.clock.now();
    return {
      available: this.tokens,
      inFlight: this.inFlight,
      queued: this.waiters.length,
      penalizedUntilEpochMs:
        this.penalizedUntilMs > now ? this.penalizedUntilMs : undefined,
      totalAcquired: this.totalAcquired,
      total429s: this.penalizations,
    };
  }

  // -- beyond §4.1 ----------------------------------------------------------

  /**
   * The pause in force and why, or `undefined` when none is.
   *
   * §4.1's {@link RateLimiterStats} has no field for {@link penalize}'s `reason`
   * argument, and dropping a parameter on the floor is worse than exposing it:
   * "penalized for 120 s" is unactionable without "because `429 Retry-After`".
   * Not on the {@link RateLimiter} interface, so no caller depends on it.
   */
  get lastPenalty():
    { readonly untilEpochMs: number; readonly reason: string } | undefined {
    if (
      this.penaltyReason === undefined ||
      this.penalizedUntilMs <= this.clock.now()
    ) {
      return undefined;
    }
    return {
      untilEpochMs: this.penalizedUntilMs,
      reason: this.penaltyReason,
    };
  }

  /** The policy currently in force. */
  get currentConfig(): RateLimiterConfig {
    return this.config;
  }

  // -- private --------------------------------------------------------------

  /** §7.3's refill arithmetic, unchanged. */
  private refill(): void {
    const now = this.clock.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    // `<= 0` is §7.3's, and it is also the guard `src/core/clock.ts` names for
    // wall time stepping backwards across an NTP correction: a clock that moved
    // back credits nothing and `lastRefillMs` is left where it was, so no
    // tokens are conjured and none are lost.
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(
      this.config.burst,
      this.tokens + elapsedSec * this.config.ratePerSecond,
    );
    this.lastRefillMs = now;
  }

  /** Whether `cost` could be taken at `now`. Assumes {@link refill} has run. */
  private serveable(cost: number, now: number): boolean {
    if (now < this.penalizedUntilMs) return false;
    if (this.tokens + TOKEN_EPSILON < cost) return false;
    const { minIntervalMs } = this.config;
    if (minIntervalMs !== undefined && now - this.lastStartMs < minIntervalMs) {
      return false;
    }
    return true;
  }

  /** Consume `cost` at `now`. Only ever called when {@link serveable}. */
  private take(cost: number, now: number): void {
    this.tokens -= cost;
    // TOKEN_EPSILON lets `serveable` pass a few ulps short; clamp so the
    // shortfall cannot accumulate into a free token over many acquires.
    if (this.tokens < 0) this.tokens = 0;
    this.lastStartMs = now;
    this.totalAcquired += 1;
  }

  /** Milliseconds until `cost` becomes serveable. At least 1. */
  private delayFor(cost: number, now: number): number {
    const tokenWaitMs =
      this.tokens + TOKEN_EPSILON >= cost
        ? 0
        : ((cost - this.tokens) / this.config.ratePerSecond) * 1000;
    const penaltyWaitMs = Math.max(0, this.penalizedUntilMs - now);
    const { minIntervalMs } = this.config;
    const spacingWaitMs =
      minIntervalMs === undefined
        ? 0
        : Math.max(0, this.lastStartMs + minIntervalMs - now);
    const waitMs = Math.max(tokenWaitMs, penaltyWaitMs, spacingWaitMs);
    // Never 0: a pump that resolved in the same instant it was scheduled would
    // spin. `serveable` and `delayFor` share TOKEN_EPSILON, so a 0 here only
    // happens when `drain` has already served the head.
    return Math.max(1, Math.ceil(waitMs));
  }

  /** Serve every waiter the bucket can currently afford, in arrival order. */
  private drain(): void {
    for (;;) {
      const head = this.waiters[0];
      if (head === undefined) return;
      this.refill();
      const now = this.clock.now();
      if (!this.serveable(head.cost, now)) return;
      this.waiters.shift();
      this.take(head.cost, now);
      // INVARIANT: `unsubscribe()` runs **before** `resolve()`, the order
      // `src/core/concurrency.ts`'s `Semaphore.makeRelease` records and for the
      // same reason. Reversed, a cancellation arriving between the two would
      // reject an already-resolved deferred — a no-op — while the token had
      // been handed to a promise nobody awaits: a silently consumed token whose
      // symptom is a stalled job rather than an error. It is also why
      // `acquire`'s cancellation callback can never observe `at < 0`.
      head.unsubscribe();
      head.deferred.resolve(undefined);
    }
  }

  /**
   * Ensure a pump sleep is in flight for the head waiter's deadline.
   *
   * A sleep already scheduled for that deadline *or earlier* is left alone: an
   * early wake costs one no-op {@link drain}, whereas replacing it on every
   * `acquire` would leave a pending timer per parked caller — the per-waiter
   * timer this design exists to avoid.
   */
  private schedule(): void {
    const head = this.waiters[0];
    if (head === undefined) return;
    this.refill();
    const now = this.clock.now();
    const at = now + this.delayFor(head.cost, now);
    if (this.pumpAtMs !== undefined && this.pumpAtMs <= at) return;
    this.pumpAtMs = at;
    const generation = (this.pumpGeneration += 1);
    void this.clock.sleep(at - now).then(
      () => {
        // A superseded pump must not clear `pumpAtMs`: it now belongs to the
        // newer, earlier sleep that replaced this one.
        if (generation !== this.pumpGeneration) return;
        this.pumpAtMs = undefined;
        this.drain();
        this.schedule();
      },
      // `sleep` was given no CancellationToken, so it cannot reject. The
      // handler exists so that a future change to `Clock` cannot turn this into
      // an unhandled rejection in the sandbox, which has no `console` to report
      // one (`docs/01` §2.3).
      () => undefined,
    );
  }

  /** Reject a cost the bucket could never satisfy. */
  private assertCost(cost: number): void {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new RangeError(`cost must be a positive integer, got ${cost}`);
    }
    if (cost > this.config.burst) {
      throw new RangeError(
        `${this.key}: cost ${cost} exceeds burst ${this.config.burst}; ` +
          `the bucket can never hold that many tokens and the caller would ` +
          `wait forever.`,
      );
    }
  }
}

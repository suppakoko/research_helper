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
 * ## `maxConcurrent` is enforced by {@link TokenBucket.run}, not by `acquire`
 *
 * `P1-T27`, 2026-10-01. `P1-T04` left this gap open and asserted it: §4.1's
 * `acquire` resolves `void`, so **nothing in it signals that a request
 * finished**, an `inFlight` counter could never be decremented, and gating
 * `acquire` on one would deadlock the bucket permanently after `maxConcurrent`
 * calls. The fix is not a counter but a *scope*: §4.1 now declares
 * {@link RateLimiter.run}, which holds one of the host's `maxConcurrent` slots
 * for the lifetime of the call it is given and releases it in a `finally`.
 *
 * Three consequences, all deliberate:
 *
 * 1. **`acquire` is still rate-only and still ungated.** A bare `acquire` neither
 *    takes a slot nor counts towards {@link RateLimiterStats.inFlight}, because
 *    it has no end. Gating it is the deadlock above, and §4.1 fixes its contract.
 *    The concurrency cap therefore binds the callers that can honour it —
 *    `src/core/http/client.ts`, which `docs/13` §2.2 makes the *single* outbound
 *    choke point, is all of them today.
 * 2. **The slot is taken before the token, not after.** `run` parks on the
 *    semaphore first and only then calls `acquire`, so a token is consumed at the
 *    moment the work actually starts. The other order would take a token while
 *    the caller was still queued behind the cap, and
 *    {@link RateLimiterConfig.minIntervalMs} — "minimum spacing between request
 *    *starts*" — would then be measured from an instant no request started at.
 *    That matters for precisely the host §7.3 gives `maxConcurrent: 1`:
 *    `export.arxiv.org`, which pairs it with `minIntervalMs: 3000`.
 * 3. **`inFlight` counts slots held, which for a brief window is one more than
 *    the requests on the wire** — a `run` caller that holds a slot while waiting
 *    for its token is counted. The cap is what must be exact, and counting this
 *    way makes it conservative: requests actually in flight are never more than
 *    `maxConcurrent`, which is what §4.1 promises.
 *
 * The slot gate is `src/core/concurrency.ts`'s {@link Semaphore}, not a second
 * implementation of one: it already models FIFO admission, cancellation while
 * parked, and the `unsubscribe()`-before-`resolve()` ordering that keeps a permit
 * from leaking to a promise nobody awaits.
 *
 * ## One gap in §4.1 this file cannot close, recorded rather than invented
 *
 * **`total429s` counts penalizations, not 429s.** §7.3 calls `penalize()` for
 * "any 429 **or 503** with `Retry-After`", so the counter §4.1 names `total429s`
 * is incremented by both. §4.1 owns the name, so the name ships; the reading is
 * "server-directed pauses applied".
 */

import type { Clock } from "../clock";
import { createDeferred, Semaphore, type Deferred } from "../concurrency";
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
  /**
   * Run `fn` holding one of the host's {@link RateLimiterConfig.maxConcurrent}
   * slots for its whole lifetime, having first waited for `cost` tokens.
   *
   * This is the **only** member that enforces the concurrency cap, and the only
   * one {@link RateLimiterStats.inFlight} counts: a call's end is what releases
   * the slot, and `acquire` has no end (see the module header).
   *
   * The slot is released when `fn`'s promise settles **either way**, and when the
   * call is abandoned before `fn` is reached — a rejecting `fn`, a cancelled
   * token and an impossible `cost` all give the slot back.
   *
   * @param fn - the work to run while holding a slot
   * @param cost - tokens to consume; default 1
   * @param token - optional cancellation, honoured while waiting for either the
   *   slot or the tokens
   */
  run<T>(
    fn: () => Promise<T>,
    cost?: number,
    token?: CancellationToken,
  ): Promise<T>;
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
  /**
   * Hard cap on simultaneous in-flight requests to this host. Enforced by
   * {@link RateLimiter.run}; `acquire` is paced by rate alone.
   */
  readonly maxConcurrent: number;
  /** Optional minimum spacing between request starts, in ms. */
  readonly minIntervalMs?: number;
}

export interface RateLimiterStats {
  readonly available: number;
  /**
   * Slots currently held by a {@link RateLimiter.run} call — never more than
   * {@link RateLimiterConfig.maxConcurrent}. A bare `acquire` is not counted;
   * it has no end that could decrement this.
   */
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
   * The concurrency cap, as `src/core/concurrency.ts`'s {@link Semaphore}.
   *
   * Not `readonly`: {@link reconfigure} may bring a different
   * {@link RateLimiterConfig.maxConcurrent} — §7.3 says Crossref's
   * `x-concurrency-limit` arrives on every response — and `Semaphore`'s permit
   * count is fixed at construction. {@link applyWantedConcurrency} swaps the gate
   * instead, and only while it is idle; see there for why.
   */
  private gate: Semaphore;

  /**
   * The cap the config in force asks for, which is {@link gate}'s permit count
   * except while a pending change waits for the host to go idle.
   */
  private wantedConcurrency: number;

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
    this.wantedConcurrency = config.maxConcurrent;
    this.gate = new Semaphore(config.maxConcurrent);
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
   * Run `fn` holding one of `maxConcurrent` slots, after waiting for `cost`
   * tokens. §4.1's `run`, and the only enforcement of the concurrency cap.
   *
   * **The slot is taken first and the tokens second.** Reversed, a token would be
   * consumed while the caller was still queued behind the cap and
   * {@link RateLimiterConfig.minIntervalMs} would be measured from an instant at
   * which nothing started — which is exactly wrong for `export.arxiv.org`, the
   * one host §7.3 gives both `maxConcurrent: 1` and `minIntervalMs: 3000`. This
   * order can never deadlock: a slot holder's only wait is for tokens, and tokens
   * always arrive (`ratePerSecond` is positive and a penalty deadline is finite).
   *
   * `async` deliberately, for the reason {@link acquire} and `Semaphore.acquire`
   * both record: an already-cancelled token must **reject** rather than throw
   * synchronously.
   *
   * The `finally` is the point — a `throw` inside `fn` that leaked a slot would
   * shrink the cap silently, and after `maxConcurrent` failures the host would be
   * unreachable.
   *
   * @param fn - the work to run while holding a slot
   * @param cost - tokens to consume; must be in `1..burst`
   * @param token - optional cancellation
   * @returns whatever `fn` resolves to
   */
  async run<T>(
    fn: () => Promise<T>,
    cost = 1,
    token?: CancellationToken,
  ): Promise<T> {
    const release = await this.gate.acquire(token);
    try {
      await this.acquire(cost, token);
      return await fn();
    } finally {
      release();
      // A cap change that could not be applied while the gate was busy may be
      // applicable now. Cheap; and the alternative is a pending change that
      // only lands on the next reconfigure.
      this.applyWantedConcurrency();
    }
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
   * **A changed `maxConcurrent` lands when the host next goes idle**, not
   * immediately — see {@link applyWantedConcurrency}. Rate, burst and spacing all
   * take effect at once; only the slot gate waits.
   *
   * @param config - the replacement policy
   */
  reconfigure(config: RateLimiterConfig): void {
    assertConfig(config);
    this.refill();
    this.config = config;
    // A smaller burst must not leave more tokens in the bucket than its depth.
    this.tokens = Math.min(this.tokens, config.burst);
    this.wantedConcurrency = config.maxConcurrent;
    this.applyWantedConcurrency();
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
      inFlight: this.gate.permits - this.gate.available,
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

  /**
   * The concurrency cap **in force**, which lags
   * {@link RateLimiterConfig.maxConcurrent} while a change waits for the host to
   * go idle ({@link applyWantedConcurrency}).
   *
   * Not on {@link RateLimiter}: §4.1 reports the cap's *use* through
   * {@link RateLimiterStats.inFlight} and nothing else needs the limit itself.
   * It is exported so a test can tell "the change landed" from "the change is
   * pending" without reaching into the gate.
   */
  get concurrencyLimit(): number {
    return this.gate.permits;
  }

  /** Callers parked waiting for a slot, as opposed to for tokens. */
  get slotQueued(): number {
    return this.gate.waiting;
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

  /**
   * Adopt {@link wantedConcurrency} if the gate can be replaced safely.
   *
   * `Semaphore`'s permit count is fixed at construction, deliberately: its
   * recorded invariant is about never handing out or revoking a permit behind a
   * holder's back, and a `resize()` would be exactly that. So the gate is
   * *replaced* — but only when it is idle, with no slot held and nobody parked.
   * Replacing a busy gate would orphan its waiters' promises (a hang) and let its
   * holders release into an object no longer consulted (the cap exceeded).
   *
   * The consequence, recorded rather than hidden: **a cap change applies when the
   * host next goes idle.** Phase 1 never exercises it — §7.3's one shipped row,
   * NCBI, is `maxConcurrent: 3` in both key modes — but §7.3 says Crossref's
   * `x-concurrency-limit` "comes back … on every response" and `reconfigure()` is
   * called from it, so a live cap change is anticipated. Making it immediate needs
   * a resizable gate, which is a change to `src/core/concurrency.ts` and a card of
   * its own.
   */
  private applyWantedConcurrency(): void {
    if (this.wantedConcurrency === this.gate.permits) return;
    if (this.gate.available !== this.gate.permits) return;
    if (this.gate.waiting > 0) return;
    this.gate = new Semaphore(this.wantedConcurrency);
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

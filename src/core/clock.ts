/**
 * The injectable clock — the port `core/` takes instead of reading wall time or
 * scheduling timers directly.
 *
 * **Scope.** `P1-T02`. `docs/07` §2.2 describes this file as the "injectable
 * clock (testability)"; §2.3 lists the clock among the platform capabilities
 * `core/` must receive rather than reach for.
 *
 * **Shape is fixed by a call site, not by a declaration.** No section of the
 * corpus declares a `Clock` interface. `docs/07` §7.3's `TokenBucket` takes one
 * as its third constructor argument and calls `clock.now()` (§7.3, §7.7), and
 * `P1-T02` step 3 pins the interface to
 * `{ now(): number; sleep(ms, token?): Promise<void> }`. That is what is
 * implemented here, and `P1-T04` (`TokenBucket`) is the card that consumes it.
 *
 * ## `Date.now()`, never `performance.now()`
 *
 * `performance` **does not exist in the plugin sandbox** — measured 2026-09-10
 * on Zotero 10.0.1, card `P0-T08`, `docs/01` §2.3: "referencing any of these
 * throws". `docs/01` §2.3 draws the consequence explicitly — "every duration
 * measured against an `NFR-*` budget must use `Date.now()`" — which makes this
 * module the single place the rule has to hold. `NFR-1`'s 100-item import
 * (`P1-T23`) and §7.7's 250 ms progress-repaint throttle both time themselves
 * through {@link Clock.now}.
 *
 * The consequence to know: `Date.now()` is wall time, so it can step backwards
 * across an NTP correction. §7.3's refill maths guards against that with
 * `if (elapsedSec <= 0) return;` rather than this module pretending to be
 * monotonic.
 *
 * ## Why `sleep` is here and not `Zotero.Promise.delay`
 *
 * `Zotero.Promise.delay()` survives the Bluebird removal (`docs/07` §1.2) and
 * would work — but only from `src/zotero/`, and every caller of a delay is in
 * `core/` or below: §7.3's token bucket, §7.3's decorrelated-jitter retry, and
 * §7.2's batched Zotero writes. Taking the delay through the same port as the
 * clock is what lets all three be tested without a timer.
 */

import { OperationCancelledError } from "./errors";
import type { CancellationToken } from "./jobQueue/cancellation";

/**
 * Wall time and delays, as `core/` sees them.
 *
 * `now()` is epoch milliseconds, matching every `*EpochMs` field in the data
 * model (§5.2, §4.1's `RateLimiterStats.penalizedUntilEpochMs`, §9's cache
 * metadata), so a timestamp read here can be stored without conversion.
 */
export interface Clock {
  /** Epoch milliseconds. `Date.now()` on the real clock. */
  now(): number;
  /**
   * Resolve after at least `ms` milliseconds.
   *
   * Rejects with {@link OperationCancelledError} if `token` is cancelled first,
   * or is already cancelled when the call is made. That is the second of
   * `docs/07` §7.4's four check points expressed as a primitive: "a job waiting
   * on a token bucket must not block cancellation", and a sleeping job is the
   * same problem.
   */
  sleep(ms: number, token?: CancellationToken): Promise<void>;
}

// ---------------------------------------------------------------------------
// 1. The real clock
// ---------------------------------------------------------------------------

/**
 * The system clock: `Date.now()` and `setTimeout`.
 *
 * Both are ordinary ECMAScript / sandbox globals rather than Zotero ones —
 * `setTimeout` and `clearTimeout` are in `docs/01` §2.3's measured *present*
 * list — so this implementation stays inside §2.3's rule and lives in `core/`
 * rather than behind a second port.
 *
 * @returns a {@link Clock} over real time
 */
export function createSystemClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },
    sleep(ms: number, token?: CancellationToken): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (token?.isCancellationRequested) {
          token.throwIfCancelled();
        }
        // The timer and the cancellation subscription each need the other's
        // handle: the timer must drop the subscription when it fires (or a
        // long-lived token accumulates one listener per sleep), and the
        // subscription must clear the timer when it fires. One of the two is
        // therefore reached through a box — `prefer-const` rejects the
        // `let off; … off = token?.onCancelled(…)` form that would express it
        // directly, since the variable is only ever assigned once.
        const sub: { off: (() => void) | undefined } = { off: undefined };
        const handle = setTimeout(
          () => {
            sub.off?.();
            resolve();
          },
          Math.max(0, ms),
        );
        sub.off = token?.onCancelled((reason) => {
          clearTimeout(handle);
          reject(new OperationCancelledError(reason));
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 2. The test double
// ---------------------------------------------------------------------------

/**
 * A {@link Clock} whose time only moves when a test moves it.
 *
 * `P1-T02` step 3 requires the double to ship with the port ("with a test
 * double"). It is exported from the production module, not from `test/helpers/`,
 * for two reasons: `P1-T02`'s `Files` list names no helper file, and `P1-T04`'s
 * `TokenBucket` tests, `P1-T05`'s retry tests and `P1-T15`'s progress-throttle
 * tests all need the same one — a double that lives beside its interface cannot
 * drift from it.
 *
 * `vi.useFakeTimers()` is the alternative and is deliberately not used: it fakes
 * the timer, while the thing under test is a *port*, and the whole reason §2.3
 * declares ports is so that layer-1 tests (`docs/13` §2.1) need no runtime
 * patching at all.
 */
export interface ManualClock extends Clock {
  /**
   * Move time forward and resolve every sleep whose deadline has now passed.
   *
   * Deadlines are fired in deadline order, so a test that advances past several
   * sleeps at once observes the same ordering real time would give. Sleeps
   * created *by* a resolving sleep's continuation are not fired by the same
   * call — the continuation runs on a later microtask — so a test driving a
   * retry loop advances once per attempt, which is the point.
   *
   * @param ms - milliseconds to advance; must not be negative
   */
  advance(ms: number): void;
  /** Set epoch milliseconds absolutely, without firing anything. */
  setNow(epochMs: number): void;
  /** How many sleeps are still pending. */
  readonly pending: number;
}

interface PendingSleep {
  readonly atMs: number;
  readonly resolve: () => void;
  readonly unsubscribe: (() => void) | undefined;
}

/**
 * Create a {@link ManualClock}.
 *
 * @param startEpochMs - the initial `now()`; defaults to a fixed, arbitrary
 *   instant rather than `Date.now()` so that a test's assertions on absolute
 *   timestamps are reproducible
 * @returns the clock, plus `advance` / `setNow` / `pending`
 */
export function createManualClock(
  startEpochMs = 1_700_000_000_000,
): ManualClock {
  let nowMs = startEpochMs;
  let sleeps: PendingSleep[] = [];

  return {
    now(): number {
      return nowMs;
    },
    sleep(ms: number, token?: CancellationToken): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (token?.isCancellationRequested) {
          token.throwIfCancelled();
        }
        const entry: { value?: PendingSleep } = {};
        const unsubscribe = token?.onCancelled((reason) => {
          if (entry.value !== undefined) {
            sleeps = sleeps.filter((s) => s !== entry.value);
          }
          reject(new OperationCancelledError(reason));
        });
        entry.value = {
          atMs: nowMs + Math.max(0, ms),
          resolve,
          unsubscribe,
        };
        sleeps.push(entry.value);
      });
    },
    advance(ms: number): void {
      if (ms < 0)
        throw new RangeError(`advance(${ms}): time does not run back`);
      nowMs += ms;
      const due = sleeps
        .filter((s) => s.atMs <= nowMs)
        .sort((a, b) => a.atMs - b.atMs);
      sleeps = sleeps.filter((s) => s.atMs > nowMs);
      for (const s of due) {
        s.unsubscribe?.();
        s.resolve();
      }
    },
    setNow(epochMs: number): void {
      nowMs = epochMs;
    },
    get pending(): number {
      return sleeps.length;
    },
  };
}

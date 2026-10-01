import { describe, expect, it, afterEach } from "vitest";

import { createManualClock, type ManualClock } from "../../../src/core/clock";
import { createDeferred, type Deferred } from "../../../src/core/concurrency";
import { createMemoryPrefStore } from "../../../src/core/config";
import { OperationCancelledError } from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import {
  createHostLimiterRegistry,
  getHostLimiters,
  HOST_POLICIES,
  installHostLimiters,
  NCBI_HOST,
  NCBI_KEY_PRESENT_PREF,
  peekHostLimiters,
  resetHostLimiters,
} from "../../../src/core/rateLimit/hostLimiter";
import {
  TokenBucket,
  type RateLimiterConfig,
} from "../../../src/core/rateLimit/tokenBucket";
import { PREF_KEYS } from "../../../src/prefs/keys";

/**
 * `P1-T04`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no network** and
 * **no real time**.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * **Every assertion is driven from `createManualClock()`.** Not `vi.useFakeTimers()`:
 * the thing under test takes a `Clock` *port* (`src/core/clock.ts`), so a layer-1
 * test needs no runtime patching at all — and a rate limiter tested against real
 * time is a test that takes 7.6 seconds to assert one number and flakes on a
 * loaded CI box.
 *
 * **Which configs in here are shipped policy and which are fixtures.** The only
 * `docs/07` §7.3 values asserted as *shipped* are `hostLimiter.ts`'s NCBI row, in
 * section 10 below. Every other config is a deliberately synthetic fixture
 * chosen to isolate one mechanism (a round rate so deadlines are exact, a burst
 * of 1 so the queue is easy to reason about). `P1-T04`'s **Do NOT** — "do not
 * invent, round, or tune a rate number" — is about the enforcement table, not
 * about a test's arithmetic, and no number below is read by the product.
 *
 * `test/unit/core/hostLimiter.test.ts` **does not exist**: `P1-T04`'s `Files`
 * list names only `tokenBucket.test.ts` and `backoff.test.ts`, so the registry's
 * coverage lives here in section 10. Reported against the card, because
 * `plan/03-phase-2-multi-source-dedup.md`'s `P2-T03` runs
 * `npm run test:unit -- hostLimiter` and nothing will match it.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Let every already-queued microtask run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** Advance the manual clock and let the pump react. */
async function step(clock: ManualClock, ms: number): Promise<void> {
  clock.advance(ms);
  await flush();
}

/**
 * Advance the clock one millisecond at a time until `done()`.
 *
 * One millisecond is the "tick" the card's first criterion is stated in ("±1
 * tick"), and stepping rather than jumping is what makes the *elapsed* figure an
 * observation instead of an assumption: the loop never tells the limiter when to
 * fire, it only lets time pass until it has.
 */
async function runUntil(
  clock: ManualClock,
  done: () => boolean,
  maxSteps = 40_000,
): Promise<void> {
  await flush();
  for (let steps = 0; !done(); steps += 1) {
    if (steps >= maxSteps) {
      throw new Error(`clock advanced ${maxSteps} ticks without finishing`);
    }
    clock.advance(1);
    await flush();
  }
}

/** Narrow away `undefined` without a non-null assertion. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** A bucket over a synthetic config, with its clock. */
function bucket(config: RateLimiterConfig): {
  clock: ManualClock;
  limiter: TokenBucket;
  t0: number;
} {
  const clock = createManualClock();
  return {
    clock,
    limiter: new TokenBucket("test", config, clock),
    t0: clock.now(),
  };
}

/** Record the clock reading at which each acquire resolved. */
function acquireMany(
  limiter: TokenBucket,
  clock: ManualClock,
  count: number,
): number[] {
  const at: number[] = [];
  for (let i = 0; i < count; i += 1) {
    void limiter.acquire().then(() => {
      at.push(clock.now());
    });
  }
  return at;
}

const FAST: RateLimiterConfig = {
  ratePerSecond: 1000,
  burst: 10,
  maxConcurrent: 3,
};

/**
 * A fake operation whose every call parks until the test settles it by name.
 *
 * This is `P1-T27`'s "gated fake transport" as a primitive: the limiter does not
 * know what it is running, so the gate does not have to be an HTTP transport to
 * exercise the cap — and `started` records each call as it *begins*, which is
 * what the card's criterion is stated on ("the second must start only after the
 * first settles").
 */
function gatedWork(clock: ManualClock): {
  /** Labels in the order their calls started, with the clock reading. */
  readonly started: { label: string; at: number }[];
  /** The function to hand to `run`. */
  work(label: string): () => Promise<string>;
  /** Settle a started call; `"reject"` is the case a missing `finally` breaks. */
  settle(label: string, outcome: "resolve" | "reject"): void;
} {
  const started: { label: string; at: number }[] = [];
  const open = new Map<string, Deferred<string>>();
  return {
    started,
    work(label: string): () => Promise<string> {
      return () => {
        started.push({ label, at: clock.now() });
        const deferred = createDeferred<string>();
        open.set(label, deferred);
        return deferred.promise;
      };
    },
    settle(label: string, outcome: "resolve" | "reject"): void {
      const deferred = open.get(label);
      if (deferred === undefined) {
        throw new Error(`${label} has not started, so it cannot settle`);
      }
      open.delete(label);
      if (outcome === "resolve") deferred.resolve(label);
      else deferred.reject(new Error(`${label} failed`));
    },
  };
}

/** The labels of every call that has started, in order. */
function labels(g: ReturnType<typeof gatedWork>): string[] {
  return g.started.map((s) => s.label);
}

// ---------------------------------------------------------------------------
// 1. Construction
// ---------------------------------------------------------------------------

describe("TokenBucket construction", () => {
  it("starts full, with empty stats", () => {
    const { limiter } = bucket({
      ratePerSecond: 2.5,
      burst: 4,
      maxConcurrent: 3,
    });
    expect(limiter.stats).toEqual({
      available: 4,
      inFlight: 0,
      queued: 0,
      penalizedUntilEpochMs: undefined,
      totalAcquired: 0,
      total429s: 0,
    });
    expect(limiter.key).toBe("test");
  });

  it("rejects a config it could not honour", () => {
    const clock = createManualClock();
    const make =
      (config: RateLimiterConfig): (() => TokenBucket) =>
      () =>
        new TokenBucket("test", config, clock);
    expect(make({ ratePerSecond: 0, burst: 1, maxConcurrent: 1 })).toThrow(
      RangeError,
    );
    expect(
      make({ ratePerSecond: Number.NaN, burst: 1, maxConcurrent: 1 }),
    ).toThrow(RangeError);
    expect(make({ ratePerSecond: 1, burst: 0, maxConcurrent: 1 })).toThrow(
      RangeError,
    );
    expect(make({ ratePerSecond: 1, burst: 1, maxConcurrent: 0 })).toThrow(
      RangeError,
    );
    expect(make({ ratePerSecond: 1, burst: 1, maxConcurrent: 1.5 })).toThrow(
      RangeError,
    );
    expect(
      make({ ratePerSecond: 1, burst: 1, maxConcurrent: 1, minIntervalMs: -1 }),
    ).toThrow(RangeError);
  });

  it("starts with the config's concurrency cap in force and no slot held", () => {
    const { limiter } = bucket(FAST);
    expect(limiter.concurrencyLimit).toBe(3);
    expect(limiter.stats.inFlight).toBe(0);
    expect(limiter.slotQueued).toBe(0);
  });

  it("does not count a bare acquire towards inFlight", () => {
    // `P1-T27`'s inverse of `P1-T04`'s `inFlight: 0` assertion, and the thing
    // that keeps the deadlock from coming back: `acquire` resolves `void`, so it
    // has no end that could decrement a counter, so it must not increment one
    // either. Concurrency is counted by `run` and by nothing else.
    const { limiter } = bucket(FAST);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.stats.inFlight).toBe(0);
    void limiter.acquire();
    expect(limiter.stats.inFlight).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Sustained rate — the card's first criterion
// ---------------------------------------------------------------------------

describe("TokenBucket sustained rate", () => {
  it("paces 20 acquires at the no-key NCBI rate, to within one tick", async () => {
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    const policy = must(registry.policyFor(NCBI_HOST), "the NCBI policy row");
    const limiter = must(registry.limiterFor(NCBI_HOST), "the NCBI limiter");
    if (!(limiter instanceof TokenBucket)) throw new Error("not a TokenBucket");
    const t0 = clock.now();
    const n = 20;

    const at = acquireMany(limiter, clock, n);
    await runUntil(clock, () => at.length === n);

    // The first `burst` acquires are free; the rest arrive at the sustained
    // rate. Derived from the shipped row rather than written as 7600 so that a
    // change to §7.3 fails this test loudly instead of silently.
    const expected =
      ((n - policy.withoutKey.burst) / policy.withoutKey.ratePerSecond) * 1000;
    expect(expected).toBe(7600);
    expect(
      Math.abs(must(at[n - 1], "the last acquire") - t0 - expected),
    ).toBeLessThanOrEqual(1);
    expect(limiter.stats.totalAcquired).toBe(n);
    expect(limiter.stats.queued).toBe(0);

    // Evenly spaced, not bunched at the end.
    const spacing = 1000 / policy.withoutKey.ratePerSecond;
    for (let i = 2; i < n; i += 1) {
      const delta =
        must(at[i], `acquire ${i}`) - must(at[i - 1], `acquire ${i - 1}`);
      expect(Math.abs(delta - spacing)).toBeLessThanOrEqual(1);
    }
  });

  it("spends the burst immediately and then paces", async () => {
    const { clock, limiter, t0 } = bucket({
      ratePerSecond: 1,
      burst: 3,
      maxConcurrent: 3,
    });
    const at = acquireMany(limiter, clock, 4);
    await flush();
    expect(at).toEqual([t0, t0, t0]);
    expect(limiter.stats.queued).toBe(1);

    await runUntil(clock, () => at.length === 4);
    expect(at[3]).toBe(t0 + 1000);
  });

  it("refills no further than the burst depth", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1,
      burst: 2,
      maxConcurrent: 3,
    });
    await step(clock, 3_600_000);
    expect(limiter.stats.available).toBe(2);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("credits nothing when wall time steps backwards", () => {
    // `src/core/clock.ts`: `Date.now()` can step back across an NTP correction,
    // and §7.3's `if (elapsedSec <= 0) return` is the whole guard.
    const { clock, limiter } = bucket({
      ratePerSecond: 1,
      burst: 2,
      maxConcurrent: 1,
    });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    clock.setNow(clock.now() - 60_000);
    expect(limiter.tryAcquire()).toBe(false);
    expect(limiter.stats.available).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. minIntervalMs
// ---------------------------------------------------------------------------

describe("TokenBucket minIntervalMs", () => {
  it("spaces request starts even while tokens are free", async () => {
    const { clock, limiter, t0 } = bucket({
      ratePerSecond: 100,
      burst: 5,
      maxConcurrent: 1,
      minIntervalMs: 100,
    });
    const at = acquireMany(limiter, clock, 3);
    await flush();
    // Four tokens are still in the bucket; spacing alone is holding these back.
    expect(at).toEqual([t0]);
    expect(limiter.stats.available).toBeGreaterThan(1);

    await runUntil(clock, () => at.length === 3);
    expect(at).toEqual([t0, t0 + 100, t0 + 200]);
  });

  it("does not delay the very first acquire", () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 1,
      minIntervalMs: 3000,
    });
    expect(limiter.tryAcquire()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. tryAcquire
// ---------------------------------------------------------------------------

describe("TokenBucket.tryAcquire", () => {
  it("consumes what is there and refuses what is not", () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 2,
      maxConcurrent: 1,
    });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("refuses to jump a non-empty queue", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 1,
    });
    const at = acquireMany(limiter, clock, 2);
    await flush();
    expect(at).toHaveLength(1);

    // Drain the queue, then let one whole token accrue with nobody waiting.
    await step(clock, 1000);
    expect(at).toHaveLength(2);
    expect(limiter.stats.queued).toBe(0);
    await step(clock, 1000);
    expect(limiter.stats.available).toBeGreaterThanOrEqual(1);

    // The first of these takes the free token; the second parks behind it.
    const queued = acquireMany(limiter, clock, 2);
    await flush();
    expect(queued).toHaveLength(1);
    expect(limiter.stats.queued).toBe(1);
    // A token is on its way, but a waiter has been queued for it since before
    // this call: FIFO wins and the non-blocking path is refused.
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("refuses while penalized, and refuses an impossible cost", () => {
    const { limiter, t0 } = bucket(FAST);
    expect(limiter.tryAcquire(11)).toBe(false);
    expect(limiter.tryAcquire(0)).toBe(false);
    expect(limiter.tryAcquire(1.5)).toBe(false);
    limiter.penalize(t0 + 1000, "429");
    expect(limiter.tryAcquire()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. cost
// ---------------------------------------------------------------------------

describe("TokenBucket cost", () => {
  it("consumes `cost` tokens, not one", () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 5,
      maxConcurrent: 1,
    });
    expect(limiter.tryAcquire(3)).toBe(true);
    expect(limiter.stats.available).toBe(2);
  });

  it("rejects — never throws synchronously — a cost above the burst", async () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 2,
      maxConcurrent: 1,
    });
    const promise = limiter.acquire(3);
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toBeInstanceOf(RangeError);
    await expect(limiter.acquire(0)).rejects.toBeInstanceOf(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 6. Cancellation — docs/07 §7.4 check point 2, the card's third criterion
// ---------------------------------------------------------------------------

describe("TokenBucket under cancellation", () => {
  it("rejects an already-cancelled token without consuming a token", async () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 2,
      maxConcurrent: 1,
    });
    const source = createCancellationTokenSource();
    source.cancel({ kind: "shutdown" });

    await expect(limiter.acquire(1, source.token)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(limiter.stats.available).toBe(2);
    expect(limiter.stats.totalAcquired).toBe(0);
    expect(limiter.stats.queued).toBe(0);
  });

  it("rejects while parked, consuming nothing and keeping the queue intact", async () => {
    const { clock, limiter, t0 } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 1,
    });
    const order: string[] = [];
    void limiter.acquire().then(() => order.push("a"));
    const source = createCancellationTokenSource();
    const parked = limiter.acquire(1, source.token);
    parked.catch(() => order.push("b-cancelled"));
    void limiter.acquire().then(() => order.push("c"));
    await flush();

    expect(order).toEqual(["a"]);
    expect(limiter.stats.queued).toBe(2);
    const acquiredBefore = limiter.stats.totalAcquired;

    source.cancel({ kind: "user" });
    await flush();
    await expect(parked).rejects.toBeInstanceOf(OperationCancelledError);
    expect(order).toEqual(["a", "b-cancelled"]);
    expect(limiter.stats.queued).toBe(1);
    expect(limiter.stats.totalAcquired).toBe(acquiredBefore);

    // Cancelling the head must not stall the caller behind it.
    await runUntil(clock, () => order.includes("c"));
    expect(clock.now() - t0).toBe(1000);
  });

  it("carries the cancellation reason", async () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 1,
    });
    expect(limiter.tryAcquire()).toBe(true);
    const source = createCancellationTokenSource();
    const parked = limiter.acquire(1, source.token);
    const reason = { kind: "timeout", ms: 20_000 } as const;
    source.cancel(reason);
    await expect(parked).rejects.toMatchObject({
      code: "CANCELLED",
      reason,
    });
  });
});

// ---------------------------------------------------------------------------
// 7. penalize — docs/07 §7.3, the card's second criterion
// ---------------------------------------------------------------------------

describe("TokenBucket.penalize", () => {
  it("blocks a waiter for 5 s and then releases it", async () => {
    const { clock, limiter, t0 } = bucket(FAST);
    limiter.penalize(t0 + 5000, "429 Retry-After: 5");

    let releasedAt: number | undefined;
    void limiter.acquire().then(() => {
      releasedAt = clock.now();
    });
    await flush();
    expect(releasedAt).toBeUndefined();

    await step(clock, 4999);
    expect(releasedAt).toBeUndefined();

    await step(clock, 1);
    expect(releasedAt).toBe(t0 + 5000);
  });

  it("parks every waiter on the key, not just the caller's", async () => {
    // §7.3: "one job's throttling automatically slows all others". Tokens are
    // plentiful here, so only the penalty can be what holds these three.
    const { clock, limiter, t0 } = bucket(FAST);
    limiter.penalize(t0 + 2000, "503 Retry-After: 2");
    const at = acquireMany(limiter, clock, 3);
    await flush();
    expect(at).toEqual([]);

    await step(clock, 2000);
    expect(at).toEqual([t0 + 2000, t0 + 2000, t0 + 2000]);
  });

  it("never shortens a pause already in force", async () => {
    const { clock, limiter, t0 } = bucket(FAST);
    limiter.penalize(t0 + 5000, "first");
    limiter.penalize(t0 + 1000, "second, smaller Retry-After");

    const at = acquireMany(limiter, clock, 1);
    await step(clock, 1000);
    expect(at).toEqual([]);
    await runUntil(clock, () => at.length === 1);
    expect(at).toEqual([t0 + 5000]);
  });

  it("reports the deadline and the reason while it is in force", async () => {
    const { clock, limiter, t0 } = bucket(FAST);
    expect(limiter.lastPenalty).toBeUndefined();

    limiter.penalize(t0 + 1000, "429 Retry-After: 1");
    expect(limiter.stats.penalizedUntilEpochMs).toBe(t0 + 1000);
    expect(limiter.lastPenalty).toEqual({
      untilEpochMs: t0 + 1000,
      reason: "429 Retry-After: 1",
    });
    expect(limiter.stats.total429s).toBe(1);

    await step(clock, 1000);
    expect(limiter.stats.penalizedUntilEpochMs).toBeUndefined();
    expect(limiter.lastPenalty).toBeUndefined();
  });

  it("counts every penalization, 429 or 503", () => {
    const { limiter, t0 } = bucket(FAST);
    limiter.penalize(t0 + 10, "429");
    limiter.penalize(t0 + 20, "503");
    expect(limiter.stats.total429s).toBe(2);
  });

  it("refuses a non-finite deadline", () => {
    const { limiter } = bucket(FAST);
    expect(() => limiter.penalize(Number.NaN, "bad")).toThrow(RangeError);
    expect(() => limiter.penalize(Number.POSITIVE_INFINITY, "bad")).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// 8. reconfigure — the card's fourth criterion
// ---------------------------------------------------------------------------

describe("TokenBucket.reconfigure", () => {
  it("raises throughput without dropping queued waiters", async () => {
    const noKey: RateLimiterConfig = {
      ratePerSecond: 2.5,
      burst: 1,
      maxConcurrent: 3,
    };
    const withKey: RateLimiterConfig = {
      ratePerSecond: 8,
      burst: 1,
      maxConcurrent: 3,
    };
    const clock = createManualClock();
    const limiter = new TokenBucket(NCBI_HOST, noKey, clock);
    const t0 = clock.now();

    const at = acquireMany(limiter, clock, 5);
    await flush();
    expect(at).toEqual([t0]);
    expect(limiter.stats.queued).toBe(4);

    limiter.reconfigure(withKey);
    expect(limiter.stats.queued).toBe(4);
    expect(limiter.currentConfig).toBe(withKey);

    await runUntil(clock, () => at.length === 5);
    // 8/s is 125 ms apart, so four more acquires land 500 ms after the first —
    // against 1600 ms under the unkeyed rate.
    expect(at[4]).toBe(t0 + 500);
    expect(at[4]).toBeLessThan(t0 + 1600);
  });

  it("clips the token count when the burst shrinks", () => {
    const { limiter } = bucket({
      ratePerSecond: 1,
      burst: 8,
      maxConcurrent: 3,
    });
    expect(limiter.stats.available).toBe(8);
    limiter.reconfigure({ ratePerSecond: 1, burst: 2, maxConcurrent: 1 });
    expect(limiter.stats.available).toBe(2);
  });

  it("validates the replacement config", () => {
    const { limiter } = bucket(FAST);
    expect(() =>
      limiter.reconfigure({ ratePerSecond: -1, burst: 1, maxConcurrent: 1 }),
    ).toThrow(RangeError);
    expect(limiter.currentConfig).toBe(FAST);
  });
});

// ---------------------------------------------------------------------------
// 9. FIFO
// ---------------------------------------------------------------------------

describe("TokenBucket ordering", () => {
  it("serves waiters strictly first-in-first-out", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 1,
    });
    const order: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      void limiter.acquire().then(() => order.push(i));
    }
    await runUntil(clock, () => order.length === 5);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// 10. run / maxConcurrent — `P1-T27`
// ---------------------------------------------------------------------------

describe("TokenBucket.run enforces maxConcurrent", () => {
  it("serialises two overlapping calls at maxConcurrent: 1, on start order", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1000,
      burst: 10,
      maxConcurrent: 1,
    });
    const g = gatedWork(clock);

    const a = limiter.run(g.work("a"));
    const b = limiter.run(g.work("b"));
    await flush();

    // Tokens are plentiful, so the cap is the only thing that can hold `b`.
    expect(labels(g)).toEqual(["a"]);
    expect(limiter.stats.inFlight).toBe(1);
    expect(limiter.slotQueued).toBe(1);
    expect(limiter.stats.available).toBeGreaterThan(1);

    g.settle("a", "resolve");
    await expect(a).resolves.toBe("a");
    await flush();
    expect(labels(g)).toEqual(["a", "b"]);
    expect(limiter.stats.inFlight).toBe(1);

    g.settle("b", "resolve");
    await expect(b).resolves.toBe("b");
    expect(limiter.stats.inFlight).toBe(0);
    expect(limiter.slotQueued).toBe(0);
  });

  it("admits exactly maxConcurrent at a time over more calls than the cap", async () => {
    // Deliberately more than `maxConcurrent` calls: a gate that incremented a
    // counter nothing decrements passes the two-call test and deadlocks here,
    // which is the trap `P1-T27`'s Do NOT names.
    const { clock, limiter } = bucket({
      ratePerSecond: 1000,
      burst: 10,
      maxConcurrent: 2,
    });
    const g = gatedWork(clock);
    const pending = ["a", "b", "c", "d", "e"].map((label) =>
      limiter.run(g.work(label)),
    );
    await flush();

    expect(labels(g)).toEqual(["a", "b"]);
    expect(limiter.stats.inFlight).toBe(2);
    expect(limiter.slotQueued).toBe(3);

    // One release admits exactly one more, five times over — never two, never
    // zero.
    for (const [index, label] of ["a", "b", "c", "d", "e"].entries()) {
      g.settle(label, "resolve");
      await flush();
      const admitted = Math.min(index + 3, 5);
      expect(labels(g)).toHaveLength(admitted);
      expect(limiter.stats.inFlight).toBe(Math.min(2, 5 - (index + 1)));
    }

    await expect(Promise.all(pending)).resolves.toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("releases the slot when the call rejects", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1000,
      burst: 10,
      maxConcurrent: 1,
    });
    const g = gatedWork(clock);

    const a = limiter.run(g.work("a"));
    const b = limiter.run(g.work("b"));
    await flush();
    expect(labels(g)).toEqual(["a"]);

    g.settle("a", "reject");
    await expect(a).rejects.toThrow("a failed");
    await flush();

    // The case a missing `finally` breaks: without one, `b` never starts.
    expect(labels(g)).toEqual(["a", "b"]);
    expect(limiter.stats.inFlight).toBe(1);
    g.settle("b", "resolve");
    await expect(b).resolves.toBe("b");
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("releases the slot when the token is cancelled while it waits for tokens", async () => {
    // The slot is taken first, so this call holds one while parked on the empty
    // bucket. Cancelling it must give the slot back even though `fn` never ran.
    const { clock, limiter } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 1,
    });
    expect(limiter.tryAcquire()).toBe(true); // the bucket is now empty
    const g = gatedWork(clock);
    const source = createCancellationTokenSource();

    const a = limiter.run(g.work("a"), 1, source.token);
    const b = limiter.run(g.work("b"));
    await flush();
    expect(labels(g)).toEqual([]);
    expect(limiter.stats.inFlight).toBe(1);
    expect(limiter.slotQueued).toBe(1);

    source.cancel({ kind: "user" });
    await expect(a).rejects.toBeInstanceOf(OperationCancelledError);
    await flush();

    // `b` now holds the slot `a` gave back, and starts as soon as a token lands.
    expect(limiter.stats.inFlight).toBe(1);
    expect(limiter.slotQueued).toBe(0);
    await runUntil(clock, () => labels(g).length === 1);
    expect(labels(g)).toEqual(["b"]);
    g.settle("b", "resolve");
    await expect(b).resolves.toBe("b");
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("releases the slot when the token is cancelled while the call runs", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1000,
      burst: 10,
      maxConcurrent: 1,
    });
    const g = gatedWork(clock);
    const source = createCancellationTokenSource();

    const a = limiter.run(g.work("a"), 1, source.token);
    const b = limiter.run(g.work("b"));
    await flush();
    expect(labels(g)).toEqual(["a"]);

    // Cancellation is cooperative: the work itself observes the token and
    // rejects. The slot must come back from that path too.
    source.cancel({ kind: "shutdown" });
    g.settle("a", "reject");
    await expect(a).rejects.toThrow("a failed");
    await flush();
    expect(labels(g)).toEqual(["a", "b"]);
    g.settle("b", "resolve");
    await expect(b).resolves.toBe("b");
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("rejects an already-cancelled token rather than throwing synchronously", async () => {
    const { clock, limiter } = bucket(FAST);
    const g = gatedWork(clock);
    const source = createCancellationTokenSource();
    source.cancel({ kind: "shutdown" });

    const promise = limiter.run(g.work("a"), 1, source.token);
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError);
    expect(labels(g)).toEqual([]);
    expect(limiter.stats.inFlight).toBe(0);
  });

  it("releases the slot when the cost can never be satisfied", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1000,
      burst: 2,
      maxConcurrent: 1,
    });
    const g = gatedWork(clock);

    await expect(limiter.run(g.work("a"), 3)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(labels(g)).toEqual([]);
    expect(limiter.stats.inFlight).toBe(0);

    // The slot survived the throw, so the host is still reachable.
    const b = limiter.run(g.work("b"));
    await flush();
    expect(labels(g)).toEqual(["b"]);
    g.settle("b", "resolve");
    await expect(b).resolves.toBe("b");
  });

  it("paces run by rate as well as by the cap", async () => {
    // The tokens are waited for *inside* run, so an uncapped fan-out is still
    // rate-limited: three calls at 1/s with burst 1 start a second apart.
    const { clock, limiter, t0 } = bucket({
      ratePerSecond: 1,
      burst: 1,
      maxConcurrent: 3,
    });
    const g = gatedWork(clock);
    for (const label of ["a", "b", "c"]) void limiter.run(g.work(label));

    await runUntil(clock, () => g.started.length === 3);
    expect(g.started.map((s) => s.at)).toEqual([t0, t0 + 1000, t0 + 2000]);
  });

  it("takes the slot before the token, so minIntervalMs spaces real starts", async () => {
    // The ordering decision recorded in docs/07 §4.1, asserted. `a` holds the
    // one slot for 5 s. Under the chosen order `b` takes its token at the moment
    // it actually starts (t0+5000), so `c` is spaced 3 s from *that* and starts
    // at t0+8000. Had the token been taken before the slot, `b`'s token — and so
    // `lastStartMs` — would have been stamped at t0+3000 and `c` would start at
    // t0+6000, only 1 s after the request before it: minIntervalMs violated.
    const { clock, limiter, t0 } = bucket({
      ratePerSecond: 1000,
      burst: 10,
      maxConcurrent: 1,
      minIntervalMs: 3000,
    });
    const starts: number[] = [];
    const slow = createDeferred<string>();
    const start = (label: string, hold?: Promise<string>): Promise<string> =>
      limiter.run(() => {
        starts.push(clock.now());
        return hold ?? Promise.resolve(label);
      });

    const a = start("a", slow.promise);
    const b = start("b");
    const c = start("c");
    await flush();
    expect(starts).toEqual([t0]);

    // A millisecond at a time, not one 5 s jump: the two orders differ only in
    // *when* the token is stamped, and a jump would hand the token out at the
    // instant the slot frees under either order, hiding the difference. Time
    // alone starts nothing here — `b` is parked on the cap, not on a deadline.
    await runUntil(clock, () => clock.now() >= t0 + 5000);
    expect(starts).toEqual([t0]);

    slow.resolve("a");
    await runUntil(clock, () => starts.length === 3);
    expect(starts).toEqual([t0, t0 + 5000, t0 + 8000]);
    await expect(Promise.all([a, b, c])).resolves.toEqual(["a", "b", "c"]);
  });

  it("adopts a changed cap when the host next goes idle, not mid-flight", async () => {
    const { clock, limiter } = bucket({
      ratePerSecond: 1000,
      burst: 10,
      maxConcurrent: 2,
    });
    const g = gatedWork(clock);
    const a = limiter.run(g.work("a"));
    const b = limiter.run(g.work("b"));
    await flush();
    expect(limiter.stats.inFlight).toBe(2);

    limiter.reconfigure({ ratePerSecond: 1000, burst: 10, maxConcurrent: 1 });
    // Rate and burst changed at once; the gate cannot, because two holders are
    // inside it (docs/07 §4.1's recorded limitation).
    expect(limiter.currentConfig.maxConcurrent).toBe(1);
    expect(limiter.concurrencyLimit).toBe(2);

    g.settle("a", "resolve");
    await expect(a).resolves.toBe("a");
    await flush();
    expect(limiter.concurrencyLimit).toBe(2);

    g.settle("b", "resolve");
    await expect(b).resolves.toBe("b");
    await flush();
    expect(limiter.stats.inFlight).toBe(0);
    expect(limiter.concurrencyLimit).toBe(1);

    // And the new cap is in force from here on.
    const c = limiter.run(g.work("c"));
    const d = limiter.run(g.work("d"));
    await flush();
    expect(labels(g)).toEqual(["a", "b", "c"]);
    g.settle("c", "resolve");
    await flush();
    expect(labels(g)).toEqual(["a", "b", "c", "d"]);
    g.settle("d", "resolve");
    await expect(Promise.all([c, d])).resolves.toEqual(["c", "d"]);
  });

  it("adopts a changed cap immediately when nothing is in flight", () => {
    const { limiter } = bucket(FAST);
    expect(limiter.concurrencyLimit).toBe(3);
    limiter.reconfigure({ ratePerSecond: 1000, burst: 10, maxConcurrent: 1 });
    expect(limiter.concurrencyLimit).toBe(1);
  });

  it("keeps the NCBI row's cap of 3 across the key-presence switch", () => {
    // docs/07 §7.3 gives NCBI maxConcurrent 3 in both modes, so the deferral
    // above is unreachable through the shipped Phase 1 policy table.
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    const policy = must(registry.policyFor(NCBI_HOST), "the NCBI policy row");
    expect(policy.withoutKey.maxConcurrent).toBe(3);
    expect(must(policy.withKey, "the with-key row").maxConcurrent).toBe(3);
    const limiter = must(registry.limiterFor(NCBI_HOST), "the NCBI limiter");
    if (!(limiter instanceof TokenBucket)) throw new Error("not a TokenBucket");
    expect(limiter.concurrencyLimit).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 11. hostLimiter — the registry and docs/07 §7.3's policy row
// ---------------------------------------------------------------------------

describe("hostLimiter policy table", () => {
  afterEach(() => {
    resetHostLimiters();
  });

  it("carries docs/07 §7.3's NCBI row exactly, and only that row in Phase 1", () => {
    expect(HOST_POLICIES).toHaveLength(1);
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    expect(registry.hosts).toEqual([NCBI_HOST]);

    const policy = must(registry.policyFor(NCBI_HOST), "the NCBI policy row");
    expect(policy.withoutKey).toEqual({
      ratePerSecond: 2.5,
      burst: 1,
      maxConcurrent: 3,
    });
    expect(policy.withKey).toEqual({
      ratePerSecond: 8,
      burst: 1,
      maxConcurrent: 3,
    });
    expect(policy.keyPresencePref).toBe(NCBI_KEY_PRESENT_PREF);
  });

  it("spells the key-presence pref exactly as src/prefs/keys.ts does", () => {
    // `core/` may not import `prefs/` (`docs/07` §2.3, enforced by
    // `eslint.config.js`'s `research-helper/layering/core`), so the branch-relative
    // key string is spelled in both places. A test file is under no layering rule
    // and is therefore the only place the two copies can be compared.
    expect(NCBI_KEY_PRESENT_PREF).toBe(PREF_KEYS.ncbiKeyPresent);
  });

  it("sits below NCBI's published 3/s and 10/s, as §7.3 requires", () => {
    // `P1-T04`'s Do NOT: "do not make the NCBI bucket 3/s or 10/s. `docs/07`
    // §7.3 sits deliberately below the published figures for clock-skew
    // headroom" (`docs/02` §3.1, NBK25497).
    const clock = createManualClock();
    const policy = must(
      createHostLimiterRegistry({ clock }).policyFor(NCBI_HOST),
      "the NCBI policy row",
    );
    expect(policy.withoutKey.ratePerSecond).toBeLessThan(3);
    expect(must(policy.withKey, "the with-key row").ratePerSecond).toBeLessThan(
      10,
    );
  });

  it("hands out one bucket per host, and none for an unregistered host", () => {
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    const first = registry.limiterFor(NCBI_HOST);
    // Identity is the requirement, not equality: §7.3's "one TokenBucket per
    // host, shared by every job".
    expect(registry.limiterFor(NCBI_HOST)).toBe(first);
    expect(must(first, "the NCBI limiter").key).toBe(NCBI_HOST);
    expect(registry.limiterFor("api.crossref.org")).toBeUndefined();
    expect(registry.policyFor("api.crossref.org")).toBeUndefined();
  });

  it("refuses two rows for one host", () => {
    const clock = createManualClock();
    const row = {
      host: "example.invalid",
      withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 1 },
    };
    expect(() =>
      createHostLimiterRegistry({ clock, policies: [row, row] }),
    ).toThrow(/duplicate rate-limit policy/);
  });
});

describe("hostLimiter key-presence switch", () => {
  afterEach(() => {
    resetHostLimiters();
  });

  it("starts on the with-key policy when the flag is already set", () => {
    const clock = createManualClock();
    const prefs = createMemoryPrefStore({ [NCBI_KEY_PRESENT_PREF]: true });
    const limiter = must(
      createHostLimiterRegistry({ clock, prefs }).limiterFor(NCBI_HOST),
      "the NCBI limiter",
    );
    if (!(limiter instanceof TokenBucket)) throw new Error("not a TokenBucket");
    expect(limiter.currentConfig.ratePerSecond).toBe(8);
  });

  it("accepts the stringified form the prefs pane can store", () => {
    const clock = createManualClock();
    const prefs = createMemoryPrefStore({ [NCBI_KEY_PRESENT_PREF]: "true" });
    const limiter = must(
      createHostLimiterRegistry({ clock, prefs }).limiterFor(NCBI_HOST),
      "the NCBI limiter",
    );
    if (!(limiter instanceof TokenBucket)) throw new Error("not a TokenBucket");
    expect(limiter.currentConfig.ratePerSecond).toBe(8);
  });

  it("defaults to the unkeyed policy with no store, a missing flag, or a throwing store", () => {
    const clock = createManualClock();
    const rateOf = (
      prefs?: ReturnType<typeof createMemoryPrefStore>,
    ): number => {
      const limiter = must(
        createHostLimiterRegistry(
          prefs === undefined ? { clock } : { clock, prefs },
        ).limiterFor(NCBI_HOST),
        "the NCBI limiter",
      );
      if (!(limiter instanceof TokenBucket)) {
        throw new Error("not a TokenBucket");
      }
      return limiter.currentConfig.ratePerSecond;
    };
    expect(rateOf()).toBe(2.5);
    expect(rateOf(createMemoryPrefStore())).toBe(2.5);
    expect(
      rateOf(createMemoryPrefStore({ [NCBI_KEY_PRESENT_PREF]: "yes" })),
    ).toBe(2.5);

    const throwing = createMemoryPrefStore();
    throwing.get = (): never => {
      throw new Error("pref branch unavailable");
    };
    expect(rateOf(throwing)).toBe(2.5);
  });

  it("reconfigures on a pref change without dropping queued waiters", async () => {
    const clock = createManualClock();
    const prefs = createMemoryPrefStore({ [NCBI_KEY_PRESENT_PREF]: false });
    const registry = createHostLimiterRegistry({ clock, prefs });
    expect(registry.observers).toHaveLength(1);

    const limiter = must(registry.limiterFor(NCBI_HOST), "the NCBI limiter");
    if (!(limiter instanceof TokenBucket)) throw new Error("not a TokenBucket");
    const t0 = clock.now();

    const at = acquireMany(limiter, clock, 3);
    await flush();
    expect(at).toEqual([t0]);
    expect(limiter.stats.queued).toBe(2);

    prefs.set(NCBI_KEY_PRESENT_PREF, true);
    prefs.notify(NCBI_KEY_PRESENT_PREF, true);

    expect(limiter.currentConfig.ratePerSecond).toBe(8);
    expect(limiter.stats.queued).toBe(2);

    await runUntil(clock, () => at.length === 3);
    expect(at).toEqual([t0, t0 + 125, t0 + 250]);
  });

  it("refresh() names what changed and is a no-op otherwise", () => {
    const clock = createManualClock();
    const prefs = createMemoryPrefStore({ [NCBI_KEY_PRESENT_PREF]: false });
    const registry = createHostLimiterRegistry({ clock, prefs });
    expect(registry.refresh()).toEqual([]);
    prefs.set(NCBI_KEY_PRESENT_PREF, true);
    expect(registry.refresh()).toEqual([NCBI_HOST]);
    expect(registry.refresh()).toEqual([]);
  });
});

describe("hostLimiter process-wide holder", () => {
  afterEach(() => {
    resetHostLimiters();
  });

  it("installs once and is readable everywhere", () => {
    const clock = createManualClock();
    expect(peekHostLimiters()).toBeUndefined();
    expect(() => getHostLimiters()).toThrow(/no host rate limiters installed/);

    const registry = installHostLimiters({ clock });
    expect(getHostLimiters()).toBe(registry);
    expect(peekHostLimiters()).toBe(registry);
  });

  it("refuses a second install, because fresh buckets are fresh budgets", () => {
    const clock = createManualClock();
    installHostLimiters({ clock });
    expect(() => installHostLimiters({ clock })).toThrow(/already installed/);
  });

  it("accepts a pre-built registry", () => {
    const clock = createManualClock();
    const registry = createHostLimiterRegistry({ clock });
    expect(installHostLimiters(registry)).toBe(registry);
    expect(getHostLimiters()).toBe(registry);
  });
});

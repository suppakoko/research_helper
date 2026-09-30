import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  createBackoff,
  decorrelatedJitter,
  parseRetryAfter,
  type RetryBudget,
} from "../../../src/core/rateLimit/backoff";

/**
 * `P1-T04`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no real
 * time — `parseRetryAfter`'s HTTP-date form is asserted against a
 * `createManualClock()` reading rather than `Date.now()`, which is the reason its
 * second parameter exists at all.
 *
 * `vitest` globals are deliberately not used — every symbol is imported.
 *
 * **The random source is injected, never sampled.** `decorrelatedJitter` takes a
 * `() => number`, so the tests below assert the *ends* of the interval §7.3
 * specifies instead of drawing a few values and hoping. A test that called
 * `Math.random` and asserted a range would pass on a broken implementation that
 * happened to stay inside it.
 */

/** Narrow away `undefined` without a non-null assertion. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

// ---------------------------------------------------------------------------
// 1. parseRetryAfter — the card's fifth criterion
// ---------------------------------------------------------------------------

describe("parseRetryAfter", () => {
  const now = createManualClock().now();

  it("reads the delay-seconds form", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("0", now)).toBe(0);
    expect(parseRetryAfter("1", now)).toBe(1000);
    expect(parseRetryAfter("3600", now)).toBe(3_600_000);
  });

  it("reads the HTTP-date form as a delta from now", () => {
    const header = new Date(now + 120_000).toUTCString();
    expect(header).toMatch(/GMT$/);
    expect(parseRetryAfter(header, now)).toBe(120_000);
  });

  it("clamps an HTTP-date already in the past to zero, never negative", () => {
    const header = new Date(now - 90_000).toUTCString();
    expect(parseRetryAfter(header, now)).toBe(0);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRetryAfter("  90  ", now)).toBe(90_000);
  });

  it("returns undefined when the header gives no answer", () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("", now)).toBeUndefined();
    expect(parseRetryAfter("   ", now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });

  it("refuses values that are not delay-seconds tokens", () => {
    // RFC 9110 §10.2.3's delay-seconds is a non-negative *integer*. Accepting
    // these would invent a delay the server did not send; the caller falls back
    // to the jittered backoff instead.
    expect(parseRetryAfter("120.5", now)).toBeUndefined();
    expect(parseRetryAfter("-5", now)).toBeUndefined();
    expect(parseRetryAfter("1e3", now)).toBeUndefined();
    expect(parseRetryAfter("+120", now)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. decorrelatedJitter — docs/07 §7.3's `min(cap, random(base, prev*3))`
// ---------------------------------------------------------------------------

describe("decorrelatedJitter", () => {
  it("returns the interval's lower end when the draw is 0", () => {
    expect(decorrelatedJitter(1000, 500, 60_000, () => 0)).toBe(500);
  });

  it("returns the interval's upper end when the draw is 1", () => {
    expect(decorrelatedJitter(1000, 500, 60_000, () => 1)).toBe(3000);
  });

  it("never exceeds the cap", () => {
    expect(decorrelatedJitter(100_000, 1000, 5000, () => 1)).toBe(5000);
    expect(decorrelatedJitter(100_000, 1000, 5000, () => 0.5)).toBe(5000);
  });

  it("collapses to the base when prev*3 is below it", () => {
    // The first retry, where the convention is `prev = base`, and the
    // degenerate `prev = 0`.
    expect(decorrelatedJitter(0, 1000, 60_000, () => 1)).toBe(1000);
    expect(decorrelatedJitter(1000, 1000, 60_000, () => 0)).toBe(1000);
    expect(decorrelatedJitter(1000, 1000, 60_000, () => 1)).toBe(3000);
  });

  it("stays inside [base, min(cap, max(base, prev*3))] for every draw", () => {
    const prev = 4000;
    const base = 1000;
    const cap = 60_000;
    const upper = Math.min(cap, Math.max(base, prev * 3));
    for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
      const delay = decorrelatedJitter(prev, base, cap, () => r);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(upper);
    }
  });

  it("defaults to Math.random and still respects the bounds", () => {
    for (let i = 0; i < 50; i += 1) {
      const delay = decorrelatedJitter(2000, 1000, 60_000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(6000);
    }
  });

  it("rejects a base, cap or prev it cannot work with", () => {
    expect(() => decorrelatedJitter(1000, 0, 60_000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(1000, -1, 60_000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(1000, 5000, 1000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(-1, 1000, 60_000)).toThrow(RangeError);
    expect(() => decorrelatedJitter(Number.NaN, 1000, 60_000)).toThrow(
      RangeError,
    );
    expect(() =>
      decorrelatedJitter(1000, 1000, Number.POSITIVE_INFINITY),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 3. createBackoff — the per-host attempt cap
// ---------------------------------------------------------------------------

describe("createBackoff", () => {
  const budget: RetryBudget = {
    baseMs: 1000,
    capMs: 60_000,
    maxAttempts: 5,
  };

  it("yields maxAttempts - 1 delays and then exhausts", () => {
    const backoff = createBackoff(budget, () => 0);
    const delays: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = backoff.next();
      if (next === undefined) break;
      delays.push(next);
    }
    // 5 total attempts = 1 initial try + 4 retries.
    expect(delays).toHaveLength(4);
    expect(backoff.delaysIssued).toBe(4);
    expect(backoff.next()).toBeUndefined();
    expect(backoff.next()).toBeUndefined();
  });

  it("allows no retry at all when the cap is 1", () => {
    const backoff = createBackoff({ ...budget, maxAttempts: 1 });
    expect(backoff.next()).toBeUndefined();
    expect(backoff.delaysIssued).toBe(0);
  });

  it("grows from the previous delay, tripling until the cap bites", () => {
    const backoff = createBackoff({ ...budget, maxAttempts: 6 }, () => 1);
    expect([
      backoff.next(),
      backoff.next(),
      backoff.next(),
      backoff.next(),
      backoff.next(),
    ]).toEqual([3000, 9000, 27_000, 60_000, 60_000]);
  });

  it("stays at the base when every draw is 0", () => {
    const backoff = createBackoff(budget, () => 0);
    expect([backoff.next(), backoff.next(), backoff.next()]).toEqual([
      1000, 1000, 1000,
    ]);
  });

  it("lets a server-supplied Retry-After win", () => {
    const backoff = createBackoff(budget, () => 0);
    expect(backoff.next(120_000)).toBe(120_000);
    // The progression advanced by the *jittered* value, not the server's, so one
    // long Retry-After does not push every later delay to the cap.
    expect(backoff.next()).toBe(1000);
  });

  it("keeps its own delay when it is the longer of the two", () => {
    const backoff = createBackoff(budget, () => 1);
    expect(backoff.next(10)).toBe(3000);
  });

  it("does not clamp a server-supplied Retry-After to the cap", () => {
    const backoff = createBackoff(
      { baseMs: 1000, capMs: 5000, maxAttempts: 5 },
      () => 0,
    );
    expect(backoff.next(3_600_000)).toBe(3_600_000);
  });

  it("validates the budget eagerly", () => {
    expect(() => createBackoff({ ...budget, maxAttempts: 0 })).toThrow(
      RangeError,
    );
    expect(() => createBackoff({ ...budget, maxAttempts: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => createBackoff({ ...budget, baseMs: 0 })).toThrow(RangeError);
    expect(() => createBackoff({ ...budget, capMs: 10 })).toThrow(RangeError);
  });

  it("threads a whole retry sequence through one clock, with no real time", () => {
    // The shape a caller uses: parse the header, take the longer of it and the
    // jittered delay, stop when the cap is spent. No sleeping happens here —
    // that is `src/core/http/retry.ts`'s (`P1-T05`), and the point of this
    // assertion is that the numbers are computable without a timer.
    const clock = createManualClock();
    const backoff = createBackoff({ ...budget, maxAttempts: 3 }, () => 1);
    const headers = ["2", new Date(clock.now() + 30_000).toUTCString(), "1"];
    const delays: number[] = [];
    for (const header of headers) {
      const serverMs = parseRetryAfter(header, clock.now());
      const next = backoff.next(serverMs);
      if (next === undefined) break;
      delays.push(next);
    }
    expect(delays).toEqual([3000, 30_000]);
    expect(must(delays[1], "the second delay")).toBeGreaterThan(
      must(delays[0], "the first delay"),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createManualClock, createSystemClock } from "../../../src/core/clock";
import { mapWithConcurrency, Semaphore } from "../../../src/core/concurrency";
import { OperationCancelledError } from "../../../src/core/errors";
import {
  createCancellationTokenSource,
  type CancellationReason,
} from "../../../src/core/jobQueue/cancellation";

/**
 * `P1-T02`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * This file also carries the cancellation-facing assertions for `clock.ts` and
 * `concurrency.ts`. `P1-T02`'s `Files` list names three test files —
 * `cancellation.test.ts`, `errors.test.ts`, `logger-redaction.test.ts` — and
 * `plan/README.md` §5 rule 2 forbids creating a fourth, so the `clock.sleep`
 * acceptance criterion and the "a parked worker abandons the queue on cancel"
 * behaviour are asserted here, where they are cancellation properties. The
 * *non*-cancellation halves of `concurrency.ts` and `result.ts` are reported as
 * an untested gap rather than smuggled in under this name.
 */

describe("createCancellationTokenSource", () => {
  describe("docs/07 §4.1's declared members", () => {
    it("starts uncancelled with no reason", () => {
      const source = createCancellationTokenSource();
      expect(source.token.isCancellationRequested).toBe(false);
      expect(source.token.reason).toBeUndefined();
    });

    it("reports the reason it was cancelled with", () => {
      const source = createCancellationTokenSource();
      source.cancel({ kind: "timeout", ms: 30_000 });
      expect(source.token.isCancellationRequested).toBe(true);
      expect(source.token.reason).toEqual({ kind: "timeout", ms: 30_000 });
    });

    it("keeps the first reason when cancelled twice", () => {
      // §7.6's shutdown path signals every running job with
      // `{ kind: "shutdown" }`. A job the user had already cancelled must keep
      // the reason the UI is about to explain.
      const source = createCancellationTokenSource();
      source.cancel({ kind: "user" });
      source.cancel({ kind: "shutdown" });
      expect(source.token.reason).toEqual({ kind: "user" });
    });
  });

  describe("throwIfCancelled", () => {
    it("does nothing while uncancelled", () => {
      const source = createCancellationTokenSource();
      expect(() => source.token.throwIfCancelled()).not.toThrow();
    });

    it("throws OperationCancelledError once cancelled", () => {
      const source = createCancellationTokenSource();
      source.cancel({ kind: "user" });
      expect(() => source.token.throwIfCancelled()).toThrow(
        OperationCancelledError,
      );
    });

    it("carries the same reason object, not a copy (P1-T02 step 2)", () => {
      const reason: CancellationReason = {
        kind: "budget-exceeded",
        limit: 2,
        unit: "usd",
      };
      const source = createCancellationTokenSource();
      source.cancel(reason);
      let thrown: unknown;
      try {
        source.token.throwIfCancelled();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(OperationCancelledError);
      // Identity, not deep equality: the card says "same object, not a copy".
      expect((thrown as OperationCancelledError).reason).toBe(reason);
    });

    it("is not user-facing (docs/07 §10.1)", () => {
      // P1-T02's Do NOT: "a cancel toast that reads like a failure is a
      // documented UX defect".
      const source = createCancellationTokenSource();
      source.cancel({ kind: "user" });
      let thrown: OperationCancelledError | undefined;
      try {
        source.token.throwIfCancelled();
      } catch (e) {
        thrown = e as OperationCancelledError;
      }
      expect(thrown?.userFacing).toBe(false);
      expect(thrown?.code).toBe("CANCELLED");
    });
  });

  describe("onCancelled", () => {
    it("fires every subscriber with the reason, synchronously", () => {
      // Synchronous matters: `queueMicrotask` is not in the sandbox
      // (docs/01 §2.3) and §7.4's four check points must see the flag at once.
      const source = createCancellationTokenSource();
      const seen: CancellationReason[] = [];
      source.token.onCancelled((r) => seen.push(r));
      source.token.onCancelled((r) => seen.push(r));
      source.cancel({ kind: "shutdown" });
      expect(seen).toEqual([{ kind: "shutdown" }, { kind: "shutdown" }]);
    });

    it("fires immediately when the token is already cancelled", () => {
      // This is §7.4's `if (opts.token?.isCancellationRequested) c()` line
      // expressed once in the token instead of at every call site.
      const source = createCancellationTokenSource();
      source.cancel({ kind: "user" });
      const cb = vi.fn();
      source.token.onCancelled(cb);
      expect(cb).toHaveBeenCalledWith({ kind: "user" });
    });

    it("stops firing after the returned unsubscribe is called", () => {
      const source = createCancellationTokenSource();
      const cb = vi.fn();
      const unsubscribe = source.token.onCancelled(cb);
      unsubscribe();
      source.cancel({ kind: "user" });
      expect(cb).not.toHaveBeenCalled();
    });

    it("still cancels when one subscriber throws", () => {
      const source = createCancellationTokenSource();
      const second = vi.fn();
      source.token.onCancelled(() => {
        throw new Error("subscriber is broken");
      });
      source.token.onCancelled(second);
      expect(() => source.cancel({ kind: "user" })).not.toThrow();
      expect(second).toHaveBeenCalledTimes(1);
      expect(source.token.isCancellationRequested).toBe(true);
    });

    it("fires only once per subscriber", () => {
      const source = createCancellationTokenSource();
      const cb = vi.fn();
      source.token.onCancelled(cb);
      source.cancel({ kind: "user" });
      source.cancel({ kind: "shutdown" });
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("signal", () => {
    it("is not aborted before cancel", () => {
      const source = createCancellationTokenSource();
      expect(source.token.signal.aborted).toBe(false);
    });

    it("token.signal.aborted becomes true when cancel() is called", () => {
      // The card's second acceptance criterion, verbatim. Node supplies a real
      // AbortController, so this asserts against the genuine platform type;
      // the plugin sandbox has none (docs/01 §2.3) and gets the same-shaped
      // stand-in documented in cancellation.ts.
      const source = createCancellationTokenSource();
      source.cancel({ kind: "user" });
      expect(source.token.signal.aborted).toBe(true);
    });

    it("is the same object on every read", () => {
      const source = createCancellationTokenSource();
      expect(source.token.signal).toBe(source.token.signal);
    });

    it("notifies an abort listener", () => {
      const source = createCancellationTokenSource();
      const cb = vi.fn();
      source.token.signal.addEventListener("abort", cb);
      source.cancel({ kind: "user" });
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("signal in the plugin sandbox, where AbortController is absent", () => {
    // docs/01 §2.3, measured 2026-09-10 on Zotero 10.0.1: `AbortController` is
    // ABSENT and "referencing any of these throws". Node has one, so every
    // assertion above exercises the *other* branch — this block is the only
    // coverage of the path the product actually takes, which is why it stubs the
    // global out rather than trusting the fallback by inspection.
    beforeEach(() => {
      vi.stubGlobal("AbortController", undefined);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("still exposes a signal that starts unaborted", () => {
      const source = createCancellationTokenSource();
      expect(typeof AbortController).toBe("undefined");
      expect(source.token.signal.aborted).toBe(false);
    });

    it("aborts that signal on cancel", () => {
      const source = createCancellationTokenSource();
      source.cancel({ kind: "user" });
      expect(source.token.signal.aborted).toBe(true);
      expect(source.token.signal.reason).toBeInstanceOf(Error);
    });

    it("notifies both an abort listener and onabort, once", () => {
      const source = createCancellationTokenSource();
      const listener = vi.fn();
      const onabort = vi.fn();
      const { signal } = source.token;
      signal.addEventListener("abort", listener);
      signal.onabort = onabort;
      source.cancel({ kind: "user" });
      source.cancel({ kind: "shutdown" });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(onabort).toHaveBeenCalledTimes(1);
    });

    it("honours removeEventListener", () => {
      const source = createCancellationTokenSource();
      const listener = vi.fn();
      source.token.signal.addEventListener("abort", listener);
      source.token.signal.removeEventListener("abort", listener);
      source.cancel({ kind: "user" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("ignores a listener for another event type", () => {
      const source = createCancellationTokenSource();
      const listener = vi.fn();
      source.token.signal.addEventListener("load", listener);
      source.cancel({ kind: "user" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("throwIfAborted throws once aborted and not before", () => {
      const source = createCancellationTokenSource();
      expect(() => source.token.signal.throwIfAborted()).not.toThrow();
      source.cancel({ kind: "user" });
      expect(() => source.token.signal.throwIfAborted()).toThrow();
    });

    it("leaves onCancelled — the mechanism §7.4 actually uses — working", () => {
      // §7.4: cancellation reaches the network through
      // `Zotero.HTTP.request`'s `cancellerReceiver`, driven from `onCancelled`.
      // `signal` is interop surface nothing on the Zotero path consumes.
      const source = createCancellationTokenSource();
      const cb = vi.fn();
      source.token.onCancelled(cb);
      source.cancel({ kind: "shutdown" });
      expect(cb).toHaveBeenCalledWith({ kind: "shutdown" });
    });
  });

  describe("dispose", () => {
    it("drops subscriptions without cancelling", () => {
      // Disposing a token whose work succeeded must not make it look cancelled.
      const source = createCancellationTokenSource();
      const cb = vi.fn();
      source.token.onCancelled(cb);
      source.dispose();
      source.cancel({ kind: "user" });
      expect(cb).not.toHaveBeenCalled();
      expect(source.token.isCancellationRequested).toBe(false);
    });
  });
});

describe("Clock.sleep under cancellation", () => {
  it("rejects a pending sleep with OperationCancelledError within one tick", async () => {
    // The card's first acceptance criterion, on the real clock: a 1 hour sleep
    // that nothing will ever resolve, cancelled, must reject now.
    const clock = createSystemClock();
    const source = createCancellationTokenSource();
    const pending = clock.sleep(3_600_000, source.token);
    source.cancel({ kind: "user" });
    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects immediately when the token is already cancelled", async () => {
    const clock = createSystemClock();
    const source = createCancellationTokenSource();
    source.cancel({ kind: "shutdown" });
    await expect(clock.sleep(3_600_000, source.token)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
  });

  it("resolves normally when nothing cancels it", async () => {
    const clock = createSystemClock();
    const before = clock.now();
    await clock.sleep(5);
    expect(clock.now()).toBeGreaterThanOrEqual(before);
  });

  it("carries the cancellation reason through to the rejection", async () => {
    const clock = createSystemClock();
    const source = createCancellationTokenSource();
    const pending = clock.sleep(3_600_000, source.token);
    source.cancel({ kind: "timeout", ms: 500 });
    await expect(pending).rejects.toMatchObject({
      reason: { kind: "timeout", ms: 500 },
    });
  });

  describe("on the manual clock (P1-T02 step 3's test double)", () => {
    it("does not resolve until time is advanced past the deadline", async () => {
      const clock = createManualClock(1_000);
      const settled = vi.fn();
      void clock.sleep(100).then(settled);
      clock.advance(99);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      clock.advance(1);
      await Promise.resolve();
      expect(settled).toHaveBeenCalledTimes(1);
      expect(clock.now()).toBe(1_100);
    });

    it("drops a cancelled sleep from the pending set", async () => {
      const clock = createManualClock();
      const source = createCancellationTokenSource();
      const pending = clock.sleep(1_000, source.token);
      expect(clock.pending).toBe(1);
      source.cancel({ kind: "user" });
      await expect(pending).rejects.toBeInstanceOf(OperationCancelledError);
      expect(clock.pending).toBe(0);
    });

    it("refuses to run time backwards", () => {
      // docs/01 §2.3 forbids `performance`, so `now()` is wall time and §7.3's
      // refill guards against a backwards NTP step itself. The double must not
      // be the thing that produces one.
      const clock = createManualClock();
      expect(() => clock.advance(-1)).toThrow(RangeError);
    });
  });
});

describe("Semaphore under cancellation", () => {
  it("rejects a parked acquire when the token is cancelled", async () => {
    // §7.4 check point 2 one layer down: a job parked behind slower ones must
    // abandon the queue when the user presses Cancel.
    const semaphore = new Semaphore(1);
    const held = await semaphore.acquire();
    const source = createCancellationTokenSource();
    const parked = semaphore.acquire(source.token);
    expect(semaphore.waiting).toBe(1);

    source.cancel({ kind: "user" });
    await expect(parked).rejects.toBeInstanceOf(OperationCancelledError);
    expect(semaphore.waiting).toBe(0);

    // The permit the cancelled waiter never took is still there for the next
    // caller — a cancel must not shrink the pool.
    held();
    expect(semaphore.available).toBe(1);
  });

  it("rejects an acquire made with an already-cancelled token", async () => {
    const semaphore = new Semaphore(2);
    const source = createCancellationTokenSource();
    source.cancel({ kind: "shutdown" });
    await expect(semaphore.acquire(source.token)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(semaphore.available).toBe(2);
  });

  it("serves waiters first-in-first-out", async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    const first = await semaphore.acquire();
    const second = semaphore.acquire().then((r) => {
      order.push(2);
      return r;
    });
    const third = semaphore.acquire().then((r) => {
      order.push(3);
      return r;
    });
    first();
    (await second)();
    (await third)();
    expect(order).toEqual([2, 3]);
  });

  it("releases the permit even when the held function throws", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(semaphore.available).toBe(1);
  });
});

describe("mapWithConcurrency under cancellation", () => {
  it("stops dispatching at the next slot once cancelled", async () => {
    // §7.4 check point 1: "before each unit of work in every `for` loop".
    const source = createCancellationTokenSource();
    const started: number[] = [];
    const result = mapWithConcurrency(
      [0, 1, 2, 3, 4, 5, 6, 7],
      1,
      async (item) => {
        started.push(item);
        if (item === 1) source.cancel({ kind: "user" });
        return item;
      },
      source.token,
    );
    await expect(result).rejects.toBeInstanceOf(OperationCancelledError);
    // Items 0 and 1 ran; the check before item 2 stopped the fan-out.
    expect(started).toEqual([0, 1]);
  });

  it("honours the limit and returns results in input order", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

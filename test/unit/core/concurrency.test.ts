import { describe, expect, it, vi } from "vitest";

import {
  createDeferred,
  mapWithConcurrency,
  Semaphore,
} from "../../../src/core/concurrency";

/**
 * `P1-T02`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * **The split with `cancellation.test.ts` is deliberate.** This file covers the
 * **non-cancellation** half of `src/core/concurrency.ts`: `createDeferred`,
 * `Semaphore`'s permit accounting and FIFO discipline, and
 * `mapWithConcurrency`'s ordering, concurrency bound and failure policy. Every
 * assertion that passes a `CancellationToken` lives in
 * `test/unit/core/cancellation.test.ts` instead —
 * `describe("Semaphore under cancellation")` and
 * `describe("mapWithConcurrency under cancellation")` — because they belong with
 * the token whose contract they exercise. Nothing is duplicated across the two
 * files, and no token appears below.
 *
 * **Everything here is deterministic.** The interleavings are driven by explicit
 * gates built on `createDeferred` rather than by racing timers, so a slow CI box
 * cannot turn an ordering assertion into a flake. The two places a real timer is
 * used are marked, and in both the assertion is on *order*, never on elapsed
 * time.
 */

/** A promise a test resolves by hand. Dogfoods `createDeferred`. */
function gate(): { wait: () => Promise<void>; open: () => void } {
  const deferred = createDeferred<void>();
  return {
    wait: () => deferred.promise,
    open: () => deferred.resolve(undefined),
  };
}

/** Yield long enough for every already-queued microtask to run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/** A real delay. Used only where completion *order* must differ from input order. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. Deferred
// ---------------------------------------------------------------------------

describe("createDeferred", () => {
  it("resolves from the outside", async () => {
    const d = createDeferred<number>();
    d.resolve(7);
    await expect(d.promise).resolves.toBe(7);
  });

  it("rejects from the outside", async () => {
    const d = createDeferred<number>();
    d.reject(new Error("boom"));
    await expect(d.promise).rejects.toThrow("boom");
  });

  it("assigns resolve and reject before returning", () => {
    // The executor runs synchronously, so both must already be callable — the
    // `let resolve!: …` definite-assignment assertions in the implementation are
    // only sound because of that, and this is what holds them honest.
    const d = createDeferred<number>();
    expect(typeof d.resolve).toBe("function");
    expect(typeof d.reject).toBe("function");
  });

  it("adopts a thenable passed to resolve", async () => {
    const d = createDeferred<number>();
    d.resolve(Promise.resolve(9));
    await expect(d.promise).resolves.toBe(9);
  });

  it("ignores a second settle", async () => {
    const d = createDeferred<number>();
    d.resolve(1);
    d.resolve(2);
    d.reject(new Error("too late"));
    await expect(d.promise).resolves.toBe(1);
  });

  it("returns the same promise on every read", () => {
    const d = createDeferred<number>();
    expect(d.promise).toBe(d.promise);
  });
});

// ---------------------------------------------------------------------------
// 2. Semaphore
// ---------------------------------------------------------------------------

describe("Semaphore construction", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s permits",
    (permits) => {
      expect(() => new Semaphore(permits)).toThrow(RangeError);
    },
  );

  it("starts with every permit free", () => {
    const s = new Semaphore(4); // §7.2's `network-metadata` pool size
    expect(s.permits).toBe(4);
    expect(s.available).toBe(4);
    expect(s.waiting).toBe(0);
  });
});

describe("Semaphore permit accounting", () => {
  it("hands out up to `permits` without parking anyone", async () => {
    const s = new Semaphore(3);
    await s.acquire();
    await s.acquire();
    await s.acquire();
    expect(s.available).toBe(0);
    expect(s.waiting).toBe(0);
  });

  it("parks the caller past the limit", async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const parked = vi.fn();
    void s.acquire().then(parked);
    await settle();
    expect(parked).not.toHaveBeenCalled();
    expect(s.waiting).toBe(1);
    expect(s.available).toBe(0);
  });

  it("returns the permit to the pool when nobody is waiting", async () => {
    const s = new Semaphore(2);
    const release = await s.acquire();
    expect(s.available).toBe(1);
    release();
    expect(s.available).toBe(2);
  });

  it("releases at most once however often the release is called", async () => {
    // The pool must not be able to grow past `permits`, or the §7.2 sizes stop
    // meaning anything and two `zotero-write` workers run concurrently.
    const s = new Semaphore(2);
    const release = await s.acquire();
    release();
    release();
    release();
    expect(s.available).toBe(2);
    expect(s.available).toBeLessThanOrEqual(s.permits);
  });

  it("gives each waiter its own single-use release", async () => {
    const s = new Semaphore(1);
    const first = await s.acquire();
    const second = s.acquire();
    first();
    const secondRelease = await second;
    secondRelease();
    secondRelease();
    expect(s.available).toBe(1);
  });
});

describe("Semaphore FIFO discipline", () => {
  it("serves waiters in arrival order", async () => {
    // §7.2's pools feed §7.7's progress counts. A pool that reordered work would
    // make "Fetching PubMed page 3 of 8" — §4.1's own example message — untrue.
    const s = new Semaphore(1);
    const served: number[] = [];
    let release = await s.acquire();

    const waiters = [1, 2, 3, 4].map((n) =>
      s.acquire().then((r) => {
        served.push(n);
        return r;
      }),
    );

    for (const waiter of waiters) {
      release();
      release = await waiter;
    }
    expect(served).toEqual([1, 2, 3, 4]);
  });

  it("hands the permit straight to the next waiter instead of via the pool", async () => {
    // The design decision, asserted directly: `available` must stay 0 across the
    // handover. If the permit went back to the pool first, the window between
    // `free += 1` and the waiter resuming is one a later arrival could use.
    const s = new Semaphore(1);
    const first = await s.acquire();
    const queued = s.acquire();
    expect(s.available).toBe(0);
    expect(s.waiting).toBe(1);

    first();
    expect(s.available).toBe(0); // handed over, never parked in the pool
    expect(s.waiting).toBe(0);

    const second = await queued;
    expect(s.available).toBe(0);
    second();
    expect(s.available).toBe(1);
  });

  it("does not let a caller arriving during the handover jump the queue", async () => {
    const s = new Semaphore(1);
    const first = await s.acquire();
    const early = s.acquire(); // queued before the release
    first(); // hands the permit to `early`, synchronously
    const late = s.acquire(); // arrives after; no free permit exists
    expect(s.waiting).toBe(1);

    const order: string[] = [];
    void early.then((r) => {
      order.push("early");
      r();
    });
    void late.then((r) => {
      order.push("late");
      r();
    });
    await settle();
    expect(order).toEqual(["early", "late"]);
  });
});

describe("Semaphore.run", () => {
  it("returns the body's value", async () => {
    const s = new Semaphore(1);
    await expect(s.run(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it("releases the permit on success", async () => {
    const s = new Semaphore(1);
    await s.run(() => Promise.resolve(1));
    expect(s.available).toBe(1);
  });

  it("releases the permit in a finally when the body rejects", async () => {
    // A leaked permit shrinks the pool silently, and after `permits` failures
    // nothing runs at all — the failure mode is a hang, not an error.
    // (`cancellation.test.ts` asserts a narrower form of this because its cancel
    // test needs the pool not to shrink; this is the full property.)
    const s = new Semaphore(2);
    await expect(
      s.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(s.available).toBe(2);
  });

  it("releases the permit when the body throws synchronously", async () => {
    const s = new Semaphore(1);
    await expect(
      s.run((): Promise<never> => {
        throw new Error("threw before returning");
      }),
    ).rejects.toThrow("threw before returning");
    expect(s.available).toBe(1);
  });

  it("survives a whole pool of failures and still runs the next body", async () => {
    const s = new Semaphore(2);
    for (let i = 0; i < 5; i += 1) {
      await expect(s.run(() => Promise.reject(new Error("x")))).rejects.toThrow(
        "x",
      );
    }
    await expect(s.run(() => Promise.resolve("still alive"))).resolves.toBe(
      "still alive",
    );
    expect(s.available).toBe(2);
  });

  it("never lets more than `permits` bodies run at once", async () => {
    const s = new Semaphore(2);
    let live = 0;
    let peak = 0;
    const open = gate();
    const bodies = [1, 2, 3, 4, 5, 6].map(() =>
      s.run(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await open.wait();
        live -= 1;
      }),
    );
    await settle();
    expect(peak).toBe(2);
    open.open();
    await Promise.all(bodies);
    expect(peak).toBe(2);
    expect(s.available).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. mapWithConcurrency
// ---------------------------------------------------------------------------

describe("mapWithConcurrency arguments", () => {
  it.each([0, -1, 1.5, Number.NaN])(
    "rejects rather than throws on a limit of %s",
    async (limit) => {
      // A rejection, not a synchronous throw. `Semaphore.acquire` was made
      // `async` for exactly this reason, and an async function's `throw` is a
      // rejection, so the two entry points behave the same way: one `.catch()`
      // handles either.
      await expect(
        mapWithConcurrency([1, 2], limit, (n) => Promise.resolve(n)),
      ).rejects.toThrow(RangeError);
    },
  );

  it("resolves an empty input to an empty array without calling fn", async () => {
    const fn = vi.fn((n: number) => Promise.resolve(n));
    await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not start more workers than there are items", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2], 16, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await delay(1);
      live -= 1;
      return n;
    });
    expect(out).toEqual([1, 2]);
    expect(peak).toBe(2);
  });

  it("passes each item with its index, once", async () => {
    const seen: [string, number][] = [];
    await mapWithConcurrency(["a", "b", "c"], 2, async (item, index) => {
      seen.push([item, index]);
      return item;
    });
    expect(seen).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });
});

describe("mapWithConcurrency ordering", () => {
  it("returns results in INPUT order while completing out of order", async () => {
    // The property `docs/06` §13 depends on: it indexes the returned array
    // against the array it passed in. A real timer is used here precisely so
    // completion order is genuinely the reverse of dispatch order.
    const completed: number[] = [];
    const out = await mapWithConcurrency([0, 1, 2, 3], 4, async (n) => {
      await delay((4 - n) * 10); // item 3 finishes first, item 0 last
      completed.push(n);
      return n * 10;
    });
    expect(out).toEqual([0, 10, 20, 30]);
    expect(completed).toEqual([3, 2, 1, 0]);
  });

  it("fills every slot, leaving no holes", async () => {
    const n = 9;
    const out = await mapWithConcurrency(
      Array.from({ length: n }, (_, i) => i),
      4,
      async (i) => {
        await delay(i % 2 === 0 ? 4 : 1);
        return i;
      },
    );
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // `new Array(n)` starts sparse; a skipped index would read as a hole rather
    // than as a wrong value, which `toEqual` alone would not distinguish.
    expect(Object.keys(out)).toHaveLength(n);
  });
});

describe("mapWithConcurrency concurrency bound", () => {
  it("observes a peak of exactly `limit` and never more", async () => {
    // The observed peak, not just the final result: a mapper that ignored the
    // limit would still return the right array.
    const open = gate();
    let live = 0;
    let peak = 0;
    const run = mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4, // §7.2's `network-metadata` pool
      async (i) => {
        live += 1;
        peak = Math.max(peak, live);
        await open.wait();
        live -= 1;
        return i;
      },
    );
    await settle();
    expect(live).toBe(4);
    expect(peak).toBe(4);
    open.open();
    await run;
    expect(peak).toBe(4);
    expect(live).toBe(0);
  });

  it("holds the bound across many staggered waves", async () => {
    let live = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 40 }, (_, i) => i),
      3,
      async (i) => {
        live += 1;
        peak = Math.max(peak, live);
        await delay(i % 3);
        live -= 1;
        return i;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
  });

  it("serializes completely at a limit of 1", async () => {
    // §7.2's `zotero-write` pool. Overlap here means lock contention inside
    // `Zotero.DB.executeTransaction`.
    const events: string[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      events.push(`start ${n}`);
      await delay(1);
      events.push(`end ${n}`);
      return n;
    });
    expect(events).toEqual([
      "start 1",
      "end 1",
      "start 2",
      "end 2",
      "start 3",
      "end 3",
    ]);
  });
});

describe("mapWithConcurrency failure policy", () => {
  it("rejects with the first error, by identity", async () => {
    const boom = new Error("boom");
    await expect(
      mapWithConcurrency([1, 2, 3], 2, (n) =>
        n === 1 ? Promise.reject(boom) : Promise.resolve(n),
      ),
    ).rejects.toBe(boom);
  });

  it("starts no further item after a rejection, and awaits the in-flight ones", async () => {
    // Both halves of the documented policy in one test, because they are one
    // decision. "Nothing runs behind the returned promise" is the half a future
    // refactor to `Promise.all` would break silently: the caller would move on
    // while two callbacks were still writing into the results array.
    const started: number[] = [];
    const finished: number[] = [];
    const open = gate();

    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (n) => {
      started.push(n);
      if (n === 0) throw new Error("boom");
      await open.wait();
      finished.push(n);
      return n;
    });

    // Three workers dispatched synchronously; item 0 has already failed.
    await settle();
    expect(started).toEqual([0, 1, 2]);
    expect(finished).toEqual([]);

    open.open();
    await expect(run).rejects.toThrow("boom");

    // In-flight items ran to completion before the rejection surfaced …
    expect([...finished].sort()).toEqual([1, 2]);
    // … and items 3, 4 and 5 were never dispatched.
    expect(started).toEqual([0, 1, 2]);
  });

  it("leaves nothing running after the promise settles", async () => {
    const started: number[] = [];
    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      started.push(n);
      await delay(1);
      if (n === 0) throw new Error("boom");
      return n;
    });
    await expect(run).rejects.toThrow("boom");
    const atRejection = [...started];
    await delay(20);
    expect(started).toEqual(atRejection);
  });

  it("keeps the FIRST error when a later item also fails", async () => {
    const first = new Error("first");
    const second = new Error("second");
    await expect(
      mapWithConcurrency([0, 1], 2, async (n) => {
        if (n === 0) throw first;
        await delay(5);
        throw second;
      }),
    ).rejects.toBe(first);
  });

  it("catches a synchronous throw from fn", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, (n): Promise<number> => {
        if (n === 1) throw new Error("threw before returning");
        return Promise.resolve(n);
      }),
    ).rejects.toThrow("threw before returning");
  });

  it("completes normally when no item fails", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, (n) => Promise.resolve(n * 2)),
    ).resolves.toEqual([2, 4, 6]);
  });
});

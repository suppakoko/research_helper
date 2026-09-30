/**
 * `mapWithConcurrency`, `Semaphore`, `Deferred` — the three primitives
 * `docs/07` §2.2 declares this file holds.
 *
 * **Scope.** `P1-T02`. Bounded fan-out and nothing above it. The *scheduler* —
 * `docs/07` §4.5's `JobQueue`, its priorities and its persistent `JobRecord`
 * store — is Phase 3's (`docs/11` §1) and `P1-T02`'s **Do NOT** forbids building
 * it here.
 *
 * **Why these exist at all.** `docs/07` §1.2, on the Zotero 7/10 platform break:
 * "Bluebird was removed. Only standard Promises remain. `Zotero.Promise.delay()`
 * and `Zotero.Promise.defer()` survive, but `Zotero.Promise.map()`, `.filter()`,
 * `.isResolved()`, `.cancel()` and `Zotero.spawn()` are gone. **This is why
 * `src/core/concurrency.ts` implements its own `mapWithConcurrency` and
 * `Semaphore` rather than leaning on any Zotero promise helper**".
 *
 * **What consumes them.** `docs/07` §7.2's three worker pools —
 * `network-metadata` at 4, `llm` at 3, `zotero-write` at 1. `P1-T02` step 6
 * names the first: "the `network-metadata` pool of 4 (`docs/07` §7.2) is
 * expressed with them." A `Promise.all` over the same work is the failure mode
 * §7.1 opens with: it "will trip rate limits, blow the user's budget with no
 * confirmation, freeze the UI thread with progress churn".
 */

import { OperationCancelledError } from "./errors";
import type { CancellationToken } from "./jobQueue/cancellation";

// ---------------------------------------------------------------------------
// 1. Deferred
// ---------------------------------------------------------------------------

/**
 * A promise with its settle functions exposed.
 *
 * The replacement for `Zotero.Promise.defer()`, which §1.2 notes survives but
 * lives on the Zotero global and so is out of reach from `core/` (§2.3). §7.3's
 * `TokenBucket` needs it for the `waiters` array a `penalize()` call has to
 * settle from the outside.
 */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

/**
 * Create a {@link Deferred}.
 *
 * Written with the executor rather than `Promise.withResolvers()`: that method
 * is ES2024 and `tsconfig.json` targets ES2022 through
 * `zotero-types/entries/sandbox` (`docs/07` §2.1), so it neither type-checks nor
 * is guaranteed present on the Gecko 140 baseline of §1.2.1.
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// 2. Semaphore
// ---------------------------------------------------------------------------

/** Releases one permit. Idempotent: calling it twice releases once. */
export type SemaphoreRelease = () => void;

/** One parked {@link Semaphore.acquire} call. */
interface SemaphoreWaiter {
  readonly deferred: Deferred<SemaphoreRelease>;
  /** Drops the waiter's cancellation subscription once it is served. */
  unsubscribe: () => void;
}

/**
 * A counting semaphore — `docs/07` §7.2's worker pool, as a primitive.
 *
 * Waiters are served strictly first-in-first-out. That is a requirement rather
 * than a detail: §7.7's progress reporting counts completions against a total,
 * and a pool that reordered work would make "Fetching PubMed page 3 of 8"
 * (§4.1's own example) untrue.
 */
export class Semaphore {
  private readonly queue: SemaphoreWaiter[] = [];

  private free: number;

  /**
   * @param permits - how many holders may run at once; §7.2's pool sizes are 4,
   *   3 and 1
   */
  constructor(readonly permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new RangeError(
        `permits must be a positive integer, got ${permits}`,
      );
    }
    this.free = permits;
  }

  /** Permits not currently held. */
  get available(): number {
    return this.free;
  }

  /** Callers parked waiting for a permit. */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Take a permit, waiting if none is free.
   *
   * Rejects with {@link OperationCancelledError} if `token` is cancelled while
   * parked, or is already cancelled on entry. §7.4 check point 2 — "a job
   * waiting on a token bucket must not block cancellation" — is the same
   * requirement one layer down: a job parked behind three slower ones must
   * abandon the queue when the user presses Cancel.
   *
   * `async` deliberately, though nothing in the body awaits: an
   * already-cancelled token must produce a *rejected promise*, not a synchronous
   * throw. A method that sometimes throws before returning its promise and
   * sometimes rejects it is one a `.catch()` caller cannot handle in one place —
   * and the fast path still completes synchronously up to the return, so two
   * callers cannot both see a free permit.
   *
   * @returns the release function; call it in a `finally`
   */
  async acquire(token?: CancellationToken): Promise<SemaphoreRelease> {
    if (token?.isCancellationRequested) {
      token.throwIfCancelled();
    }
    if (this.free > 0) {
      this.free -= 1;
      return this.makeRelease();
    }
    const deferred = createDeferred<SemaphoreRelease>();
    const entry: SemaphoreWaiter = {
      deferred,
      unsubscribe: () => {
        /* replaced below when a token was supplied */
      },
    };
    this.queue.push(entry);
    const unsubscribe = token?.onCancelled((reason) => {
      const at = this.queue.indexOf(entry);
      if (at >= 0) this.queue.splice(at, 1);
      deferred.reject(new OperationCancelledError(reason));
    });
    if (unsubscribe !== undefined) entry.unsubscribe = unsubscribe;
    return deferred.promise;
  }

  /**
   * Hold a permit for the duration of `fn`.
   *
   * The `finally` is the point: a `throw` inside `fn` that leaked a permit would
   * shrink the pool silently, and after `permits` failures nothing would run at
   * all.
   */
  async run<T>(fn: () => Promise<T>, token?: CancellationToken): Promise<T> {
    const release = await this.acquire(token);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private makeRelease(): SemaphoreRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next === undefined) {
        this.free += 1;
        return;
      }
      next.unsubscribe();
      // The permit is handed straight over rather than returned to the pool and
      // re-taken: returning it first would let a caller arriving in between jump
      // the queue.
      next.deferred.resolve(this.makeRelease());
    };
  }
}

// ---------------------------------------------------------------------------
// 3. mapWithConcurrency
// ---------------------------------------------------------------------------

/**
 * Apply `fn` to every item, at most `limit` at a time, results in input order.
 *
 * **Input order, not completion order.** `docs/06` §13's summarize pipeline
 * indexes the array this returns against the array it passed in
 * (`summaries.find(...)` by item key), and `docs/07` §12.1's search-import state
 * machine previews results in the order the user's query produced them.
 *
 * **Failure policy.** The first rejection wins: no further item is *started*,
 * already-started items are awaited so nothing is left running behind the
 * returned promise, and that rejection is rethrown. Per-item tolerance is the
 * caller's — `docs/06` §13.1's "an individual paper failing after retries does
 * **not** abort the run … The run aborts only if the failure rate exceeds 30%"
 * is a *policy* over recorded outcomes, and its own callback is what records
 * them, by returning a `status: 'failed'` summary rather than throwing. Building
 * that threshold in here would make it unavailable to the six callers that want
 * the plain semantics, and Phase 3 owns the summarize pipeline in any case.
 *
 * **Cancellation.** `token` is checked before each item is dispatched — §7.4
 * check point 1, "before each unit of work in every `for` loop" — so a cancel
 * stops the fan-out at the next slot rather than at the end of the batch.
 *
 * @param items - the work; an empty array resolves to an empty array
 * @param limit - maximum simultaneous calls to `fn`; must be a positive integer
 * @param fn - called once per item, with its index
 * @param token - optional cancellation
 * @returns the results, aligned with `items`
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  token?: CancellationToken,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  let next = 0;
  let firstError: { value: unknown } | undefined;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (firstError !== undefined) return;
      try {
        token?.throwIfCancelled();
      } catch (e) {
        firstError ??= { value: e };
        return;
      }
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        // `noUncheckedIndexedAccess` makes the element `T | undefined`; the
        // bound check above is what guarantees it is not, so the cast is the
        // narrowing the compiler cannot do itself.
        results[index] = await fn(items[index] as T, index);
      } catch (e) {
        firstError ??= { value: e };
        return;
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push(worker());
  }
  // `allSettled`, not `all`: every worker must finish before this returns, or a
  // rejection would leave live calls writing into `results` after the caller
  // moved on. A worker never rejects — it records into `firstError` instead.
  await Promise.allSettled(workers);

  if (firstError !== undefined) throw firstError.value;
  return results;
}

/**
 * `P3-T17` — the `llm` worker pool: concurrency, cancel, pause, resume.
 *
 * Everything is synthetic: no request leaves the process. The "LLM call" is
 * a scripted function; where the card asks about `RateLimiter.acquire`, the
 * call goes through a real `TokenBucket` on a manual clock, configured with
 * `docs/07` §7.3's LLM row from `HOST_POLICIES`.
 *
 * The job record lives in the real queue (`createJobQueue`) over an in-memory
 * `JobStore`, so pause, resume and cancel are asserted as §5.2 job states.
 */

import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createScope } from "../../../src/bootstrap/container";
import {
  installPluginDatabase,
  type PluginDatabaseSource,
} from "../../../src/bootstrap/pluginDatabase";
import { buildWorkerPools } from "../../../src/bootstrap/registerPipelines";
import type { CacheBlobStore } from "../../../src/core/cache/sqliteCache";
import { createDeferred, type Deferred } from "../../../src/core/concurrency";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  createCheckpointWriter,
  readCheckpoint,
} from "../../../src/pipeline/shared/checkpoint";
import {
  OperationCancelledError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  createCancellationTokenSource,
  createLinkedCancellationTokenSource,
  type CancellationToken,
} from "../../../src/core/jobQueue/cancellation";
import type { JobRecord, JobRow } from "../../../src/core/jobQueue/jobRecord";
import {
  admissionClassOf,
  clampLlmPoolSize,
  createJobAdmission,
  createJobQueue,
  createLlmPool,
  createRunningWork,
  describePooledOutcome,
  JOB_CONCURRENCY_LIMITS,
  LLM_POOL_MAX,
  LLM_POOL_MIN,
  runPooledItems,
  type JobNotifier,
  type JobQueue,
  type JobStore,
  type LlmPool,
  type PooledCheckpointState,
  type PooledRunDeps,
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  HOST_POLICIES,
  LLM_HOSTS,
} from "../../../src/core/rateLimit/hostLimiter";
import { TokenBucket } from "../../../src/core/rateLimit/tokenBucket";
import type { SqlConnection, SqlParam } from "../../../src/zotero/db";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** A `JobStore` over a `Map`: the queue's port, without SQLite. */
function memoryJobStore(): JobStore {
  const rows = new Map<string, JobRow>();
  return {
    put(row) {
      rows.set(row.id, row);
      return Promise.resolve();
    },
    get(id) {
      return Promise.resolve(rows.get(id));
    },
    list(statuses) {
      return Promise.resolve(
        [...rows.values()].filter(
          (row) =>
            statuses === undefined ||
            (statuses as readonly string[]).includes(row.status),
        ),
      );
    },
  };
}

interface Harness {
  readonly clock: ManualClock;
  readonly queue: JobQueue;
  readonly paused: JobRecord[];
  readonly logger: ReturnType<typeof createLogger>;
}

function harness(): Harness {
  const clock = createManualClock();
  const logger = createLogger({ sink: NULL_LOG_SINK, clock });
  const paused: JobRecord[] = [];
  const notifier: JobNotifier = {
    paused(record) {
      paused.push(record);
    },
    resumed: () => Promise.resolve(),
  };
  const queue = createJobQueue({
    clock,
    logger,
    pluginVersion: "1.2.3",
    isResumable: () => true,
    notifier,
    newId: (() => {
      let n = 0;
      return () => `job-${String((n += 1))}`;
    })(),
  });
  queue.attachStore(memoryJobStore());
  return { clock, queue, paused, logger };
}

/** A running job, as the job's owner leaves it before the `llm` stage. */
async function runningJob(
  h: Harness,
  priority: JobRecord["priority"] = "interactive",
): Promise<string> {
  const record = await h.queue.enqueue(
    "summarize",
    { items: 200 },
    { priority },
  );
  await h.queue.start(record.id);
  return record.id;
}

interface Item {
  readonly n: number; // 1-based position
  readonly key: string;
}

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    key: `w${String(i + 1).padStart(3, "0")}`,
  }));
}

/** A store of results — the summary cache, as far as the runner can tell. */
function resultStore(): Map<string, string> {
  return new Map<string, string>();
}

/** Settle every pending microtask and short timer. */
async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((done) => setImmediate(done));
  }
}

/** A promise that rejects when `token` fires: a request the HTTP layer aborts. */
function abortedBy(token: CancellationToken): Promise<never> {
  return new Promise<never>((_, reject) => {
    token.onCancelled((reason) => {
      reject(new OperationCancelledError(reason));
    });
  });
}

function fixedPool(size: number): LlmPool {
  return createLlmPool(() => size);
}

function baseDeps(
  h: Harness,
  jobId: string,
  overrides: Partial<PooledRunDeps<Item, string>> &
    Pick<PooledRunDeps<Item, string>, "items" | "call" | "pool">,
  results = resultStore(),
): PooledRunDeps<Item, string> {
  return {
    jobId,
    workKey: (item) => item.key,
    isDone: (item) => Promise.resolve(results.has(item.key)),
    onResult: (item, value) => {
      results.set(item.key, value);
      return Promise.resolve();
    },
    queue: h.queue,
    clock: h.clock,
    logger: h.logger,
    ...overrides,
  };
}

/** A seeded linear congruential generator, so "random" delays repeat. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// ---------------------------------------------------------------------------
// The card's Done-when lines
// ---------------------------------------------------------------------------

describe("P3-T17 — the llm pool's Done-when lines", () => {
  it("a 200-item scripted run with concurrency = 3 never has more than three calls in flight", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const pool = createLlmPool(() => 3);
    const random = seeded(17);
    let inFlight = 0;
    let maxInFlight = 0;
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(200),
        pool,
        call: async (item) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          expect(pool.inFlight).toBeLessThanOrEqual(3);
          // Real timers, 0–2 ms, so calls finish out of order.
          await new Promise((done) =>
            setTimeout(done, Math.floor(random() * 3)),
          );
          inFlight -= 1;
          return `summary ${item.key}`;
        },
      }),
    );
    const outcome = await run.result;
    expect(maxInFlight).toBe(3);
    expect(outcome).toMatchObject({
      stop: "finished",
      total: 200,
      completed: 200,
      skipped: 0,
      dispatched: 200,
      stoppedAt: undefined,
    });
    expect(outcome.failed).toStrictEqual([]);
    expect(pool.inFlight).toBe(0);
    expect(describePooledOutcome(outcome)).toBe("finished 200/200");
    // The runner never moves a job to succeeded; that is the pipeline's.
    expect((await h.queue.get(jobId))?.status).toBe("running");
  });

  it("cancelling at item 87 leaves exactly 86 results and reports 'cancelled at 87/200'; re-running dispatches exactly 114 calls", async () => {
    const h = harness();
    const results = resultStore();
    const checkpoints: PooledCheckpointState[] = [];
    const jobId = await runningJob(h);
    let calls = 0;
    let probes = 0;
    const deps = baseDeps(
      h,
      jobId,
      {
        items: items(200),
        pool: fixedPool(3),
        isDone: (item) => {
          probes += 1;
          return Promise.resolve(results.has(item.key));
        },
        checkpoint: {
          checkpoint(state) {
            checkpoints.push(state as PooledCheckpointState);
            return Promise.resolve();
          },
        },
        call: (item, token) => {
          calls += 1;
          if (item.n === 87) {
            // The user presses Cancel as item 87 goes out; the HTTP layer
            // aborts its request (docs/07 §7.4 point 3).
            void run.cancel();
            return abortedBy(token);
          }
          return Promise.resolve(`summary ${item.key}`);
        },
      },
      results,
    );
    const run = runPooledItems(deps);
    const outcome = await run.result;

    expect(results.size).toBe(86);
    expect([...results.keys()]).toStrictEqual(
      items(86).map((item) => item.key),
    );
    expect(outcome.stop).toBe("cancelled");
    expect(outcome.stoppedAt).toBe(87);
    expect(describePooledOutcome(outcome)).toBe("cancelled at 87/200");
    expect(calls).toBe(87);
    // Checked before each unit of work (§7.4 point 1): nothing after 87 is
    // even probed in the cache.
    expect(probes).toBe(87);
    expect(outcome.failed).toStrictEqual([]);
    // Cancel without rollback: cancelling, then cancelled; nothing deleted.
    expect((await h.queue.get(jobId))?.status).toBe("cancelled");
    const last = checkpoints.at(-1);
    expect(last?.completed).toHaveLength(86);
    expect(last?.pending).toHaveLength(114);
    expect(last?.pending[0]).toBe("w087");

    // Re-running: a new job over the same items; the 86 are cache hits.
    const rerunId = await runningJob(h);
    let rerunCalls = 0;
    const rerun = runPooledItems({
      ...deps,
      jobId: rerunId,
      call: (item) => {
        rerunCalls += 1;
        return Promise.resolve(`summary ${item.key}`);
      },
    });
    const second = await rerun.result;
    expect(rerunCalls).toBe(114);
    expect(second).toMatchObject({
      stop: "finished",
      dispatched: 114,
      completed: 114,
      skipped: 86,
    });
    expect(results.size).toBe(200);
  });

  it("pause during a call lets it finish and dispatches nothing further; resume continues", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const admission = createJobAdmission();
    const ticket = await admission.admit({
      id: jobId,
      priority: "interactive",
      exclusivityKey: "collection:1:ABCD2345",
    });
    const pending = new Map<string, Deferred<string>>();
    const checkpoints: { state: PooledCheckpointState; boundary: boolean }[] =
      [];
    let autoAnswer = false;
    let calls = 0;
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(10),
        pool: fixedPool(3),
        ticket,
        checkpoint: {
          checkpoint(state, options) {
            checkpoints.push({
              state: state as PooledCheckpointState,
              boundary: options?.boundary === true,
            });
            return Promise.resolve();
          },
        },
        call: (item) => {
          calls += 1;
          if (autoAnswer) return Promise.resolve(`summary ${item.key}`);
          const answer = createDeferred<string>();
          pending.set(item.key, answer);
          return answer.promise;
        },
      }),
    );
    await flush();
    expect(calls).toBe(3);

    let pausedYet = false;
    const pausing = run.pause().then(() => {
      pausedYet = true;
    });
    await flush();
    // In-flight calls are never aborted by a pause: still waiting on them.
    expect(pausedYet).toBe(false);
    expect((await h.queue.get(jobId))?.status).toBe("running");

    for (const answer of pending.values()) answer.resolve("summary");
    await pausing;
    await flush();
    const record = await h.queue.get(jobId);
    expect(record?.status).toBe("paused");
    expect(record?.pauseReason).toBe("user");
    expect(h.paused).toHaveLength(1);
    // Nothing further was dispatched, and a boundary checkpoint was written.
    expect(calls).toBe(3);
    const boundary = checkpoints.filter((c) => c.boundary).at(-1);
    expect(boundary?.state.completed).toHaveLength(3);
    expect(boundary?.state.pending).toHaveLength(7);
    // Paused: the slot is given back, the exclusivity key is kept (§7.5).
    expect(admission.running.interactive).toBe(0);
    expect(admission.heldKeys).toStrictEqual(["collection:1:ABCD2345"]);
    // A second pause is a no-op: no second notice.
    await run.pause();
    expect(h.paused).toHaveLength(1);

    autoAnswer = true;
    await run.resume();
    expect((await h.queue.get(jobId))?.status).toBe("running");
    expect(admission.running.interactive).toBe(1);
    const outcome = await run.result;
    expect(outcome).toMatchObject({
      stop: "finished",
      completed: 10,
      dispatched: 10,
    });
    expect(calls).toBe(10);
    ticket.release();
    expect(admission.heldKeys).toStrictEqual([]);
  });

  it("a cancellation while a worker waits in RateLimiter.acquire returns promptly", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const row = HOST_POLICIES.find((p) => p.host === LLM_HOSTS.anthropic);
    expect(row).toBeDefined();
    if (row === undefined) return;
    // §7.3's LLM row: 1 request per second, burst 1, 3 concurrent.
    const bucket = new TokenBucket(
      LLM_HOSTS.anthropic,
      row.withoutKey,
      h.clock,
    );
    let sent = 0;
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(5),
        pool: fixedPool(3),
        call: (item, token) =>
          bucket.run(
            () => {
              sent += 1;
              return Promise.resolve(`summary ${item.key}`);
            },
            1,
            token,
          ),
      }),
    );
    await flush();
    // One request had the bucket's token; the other workers wait in the
    // bucket, and the clock never moves, so they would wait forever.
    expect(sent).toBe(1);
    expect(bucket.stats.queued).toBeGreaterThan(0);

    const stopped = run.cancel();
    const winner = await Promise.race([
      stopped.then(() => "stopped"),
      new Promise((done) => setTimeout(() => done("hung"), 1000)),
    ]);
    expect(winner).toBe("stopped");
    expect(h.clock.now()).toBe(createManualClock().now());
    const outcome = await run.result;
    expect(outcome.stop).toBe("cancelled");
    expect(outcome.completed).toBe(1);
    expect(outcome.failed).toStrictEqual([]);
    expect(bucket.stats.queued).toBe(0);
    expect(bucket.stats.inFlight).toBe(0);
    expect((await h.queue.get(jobId))?.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Pool size, the per-host cap, job admission
// ---------------------------------------------------------------------------

describe("P3-T17 — the pool's size and the per-host cap of 3", () => {
  it("clamps concurrency to 1–8, truncating, and gives the smallest pool for a non-number", () => {
    expect([LLM_POOL_MIN, LLM_POOL_MAX]).toStrictEqual([1, 8]);
    expect(clampLlmPoolSize(0)).toBe(1);
    expect(clampLlmPoolSize(-4)).toBe(1);
    expect(clampLlmPoolSize(3)).toBe(3);
    expect(clampLlmPoolSize(3.9)).toBe(3);
    expect(clampLlmPoolSize(8)).toBe(8);
    expect(clampLlmPoolSize(9)).toBe(8);
    expect(clampLlmPoolSize(Number.NaN)).toBe(1);
    expect(clampLlmPoolSize(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("buildWorkerPools sizes the llm pool from concurrency (schema default 3 with no preference store), clamped", () => {
    const writer = {} as Parameters<typeof buildWorkerPools>[0]["writer"];
    expect(buildWorkerPools({ writer }).llm.size).toBe(3);
    expect(
      buildWorkerPools({ writer, readConcurrency: () => 12 }).llm.size,
    ).toBe(8);
    expect(
      buildWorkerPools({ writer, readConcurrency: () => 0 }).llm.size,
    ).toBe(1);
    const pools = buildWorkerPools({ writer });
    expect(pools.networkMetadata.permits).toBe(4);
    expect(pools.admission.running).toStrictEqual({
      interactive: 0,
      background: 0,
    });
    const runningWork = createRunningWork();
    expect(buildWorkerPools({ writer, runningWork }).runningWork).toBe(
      runningWork,
    );
  });

  it("re-reads concurrency before every permit: a smaller value drains, a larger one serves waiters", async () => {
    let concurrency = 3;
    const pool = createLlmPool(() => concurrency);
    const held = [
      await pool.acquire(),
      await pool.acquire(),
      await pool.acquire(),
    ];
    expect(pool.inFlight).toBe(3);
    concurrency = 1;
    let fourth = false;
    const next = pool.acquire().then((release) => {
      fourth = true;
      return release;
    });
    expect(pool.size).toBe(1);
    held[0]?.();
    held[1]?.();
    await flush();
    // Two released, but one holder is still above the new size of 1.
    expect(fourth).toBe(false);
    held[2]?.();
    (await next)();
    expect(fourth).toBe(true);
    expect(pool.inFlight).toBe(0);
  });

  it("with concurrency 8, eight calls hold pool permits but §7.3's LLM row keeps at most 3 requests in flight to the host", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const row = HOST_POLICIES.find((p) => p.host === LLM_HOSTS.openai);
    expect(row?.withoutKey.maxConcurrent).toBe(3);
    if (row === undefined) return;
    const bucket = new TokenBucket(LLM_HOSTS.openai, row.withoutKey, h.clock);
    const pool = createLlmPool(() => 8);
    let atHost = 0;
    let maxAtHost = 0;
    let maxPool = 0;
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(24),
        pool,
        call: (item, token) => {
          maxPool = Math.max(maxPool, pool.inFlight);
          return bucket.run(
            async () => {
              atHost += 1;
              maxAtHost = Math.max(maxAtHost, atHost);
              await h.clock.sleep(5000, token); // a 5 s generation
              atHost -= 1;
              return `summary ${item.key}`;
            },
            1,
            token,
          );
        },
      }),
    );
    let done = false;
    void run.result.then(() => {
      done = true;
    });
    for (let step = 0; step < 400 && !done; step += 1) {
      await flush(2);
      h.clock.advance(500);
    }
    const outcome = await run.result;
    expect(outcome.completed).toBe(24);
    expect(maxPool).toBe(8);
    expect(maxAtHost).toBe(3);
    expect(bucket.stats.inFlight).toBe(0);
  });
});

describe("P3-T17 — job-level admission (docs/07 §7.2)", () => {
  it("runs at most one interactive and two background jobs; normal shares the background slots", async () => {
    expect(JOB_CONCURRENCY_LIMITS).toStrictEqual({
      interactive: 1,
      background: 2,
    });
    expect(admissionClassOf("normal")).toBe("background");
    const admission = createJobAdmission();
    const i1 = await admission.admit({
      id: "i1",
      priority: "interactive",
      exclusivityKey: undefined,
    });
    const b1 = await admission.admit({
      id: "b1",
      priority: "background",
      exclusivityKey: undefined,
    });
    const n1 = await admission.admit({
      id: "n1",
      priority: "normal",
      exclusivityKey: undefined,
    });
    const admitted: string[] = [];
    const i2 = admission
      .admit({ id: "i2", priority: "interactive", exclusivityKey: undefined })
      .then((t) => (admitted.push("i2"), t));
    const b2 = admission
      .admit({ id: "b2", priority: "background", exclusivityKey: undefined })
      .then((t) => (admitted.push("b2"), t));
    await flush();
    expect(admitted).toStrictEqual([]);
    expect(admission.running).toStrictEqual({ interactive: 1, background: 2 });
    n1.release();
    await flush();
    expect(admitted).toStrictEqual(["b2"]);
    i1.release();
    await flush();
    expect(admitted).toStrictEqual(["b2", "i2"]);
    for (const t of [b1, await i2, await b2]) t.release();
    expect(admission.running).toStrictEqual({ interactive: 0, background: 0 });
  });

  it("serializes jobs sharing an exclusivity key, and a paused job keeps the key while giving its slot away", async () => {
    const admission = createJobAdmission();
    const key = "collection:1:ABCD2345";
    const a = await admission.admit({
      id: "a",
      priority: "background",
      exclusivityKey: key,
    });
    let sameKeyIn = false;
    const sameKey = admission
      .admit({ id: "b", priority: "background", exclusivityKey: key })
      .then((t) => ((sameKeyIn = true), t));
    a.suspend();
    // Another collection may use the freed slot ...
    const other = await admission.admit({
      id: "c",
      priority: "background",
      exclusivityKey: "collection:1:OTHER",
    });
    const third = await admission.admit({
      id: "d",
      priority: "background",
      exclusivityKey: undefined,
    });
    await flush();
    // ... but the paused job's collection stays held.
    expect(sameKeyIn).toBe(false);
    expect(admission.heldKeys).toContain(key);
    // Resuming waits for a slot; a cancel while waiting holds nothing.
    const source = createCancellationTokenSource();
    const waiting = a.reacquire(source.token);
    source.cancel({ kind: "user" });
    await expect(waiting).rejects.toBeInstanceOf(OperationCancelledError);
    third.release();
    await a.reacquire();
    expect(admission.running.background).toBe(2);
    a.release();
    const b = await sameKey;
    expect(sameKeyIn).toBe(true);
    b.release();
    other.release();
    expect(admission.heldKeys).toStrictEqual([]);
    expect(admission.running.background).toBe(0);
  });

  it("a job cancelled while waiting for its key or slot holds nothing", async () => {
    const admission = createJobAdmission({ interactive: 1, background: 1 });
    const first = await admission.admit({
      id: "a",
      priority: "background",
      exclusivityKey: undefined,
    });
    const source = createCancellationTokenSource();
    const waiting = admission.admit(
      { id: "b", priority: "background", exclusivityKey: "collection:1:K" },
      source.token,
    );
    await flush();
    expect(admission.heldKeys).toStrictEqual(["collection:1:K"]);
    source.cancel({ kind: "user" });
    await expect(waiting).rejects.toBeInstanceOf(OperationCancelledError);
    expect(admission.heldKeys).toStrictEqual([]);
    first.release();
    expect(admission.running.background).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cancellation, pause and the runner's other paths
// ---------------------------------------------------------------------------

describe("P3-T17 — cancellation, pause and failures in the runner", () => {
  it("a linked token follows its parent, never cancels it, and unlinks on dispose", () => {
    const parent = createCancellationTokenSource();
    const child = createLinkedCancellationTokenSource(parent.token);
    child.cancel({ kind: "user" });
    expect(child.token.isCancellationRequested).toBe(true);
    expect(parent.token.isCancellationRequested).toBe(false);

    const second = createLinkedCancellationTokenSource(parent.token);
    parent.cancel({ kind: "shutdown" });
    expect(second.token.reason).toStrictEqual({ kind: "shutdown" });

    const late = createLinkedCancellationTokenSource(parent.token);
    expect(late.token.isCancellationRequested).toBe(true);

    const other = createCancellationTokenSource();
    const disposed = createLinkedCancellationTokenSource(other.token);
    disposed.dispose();
    other.cancel({ kind: "user" });
    expect(disposed.token.isCancellationRequested).toBe(false);
    expect(createLinkedCancellationTokenSource(undefined).token.reason).toBe(
      undefined,
    );

    // dispose() drops the subscription on the parent, so a long-lived job
    // token does not keep every finished child alive.
    const base = createCancellationTokenSource();
    let unsubscribed = 0;
    const spied: CancellationToken = {
      get isCancellationRequested() {
        return base.token.isCancellationRequested;
      },
      get reason() {
        return base.token.reason;
      },
      get signal() {
        return base.token.signal;
      },
      throwIfCancelled: () => {
        base.token.throwIfCancelled();
      },
      onCancelled: (cb) => {
        const off = base.token.onCancelled(cb);
        return () => {
          unsubscribed += 1;
          off();
        };
      },
    };
    createLinkedCancellationTokenSource(spied).dispose();
    expect(unsubscribed).toBe(1);
  });

  it("records a failed item with its error code and carries on", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const results = resultStore();
    const run = runPooledItems(
      baseDeps(
        h,
        jobId,
        {
          items: items(6),
          pool: fixedPool(1),
          call: (item) =>
            item.n === 2
              ? Promise.reject(new UpstreamServerError(529, "overloaded"))
              : Promise.resolve(`summary ${item.key}`),
        },
        results,
      ),
    );
    const outcome = await run.result;
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.workKey).toBe("w002");
    expect(outcome.failed[0]?.code).toBe("UPSTREAM_SERVER");
    expect(outcome).toMatchObject({ stop: "finished", completed: 5 });
    expect(results.has("w002")).toBe(false);
  });

  it("the job's own token stops the run at once but moves no job state", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const job = createCancellationTokenSource();
    let calls = 0;
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(10),
        pool: fixedPool(2),
        token: job.token,
        call: (_item, token) => {
          calls += 1;
          return abortedBy(token);
        },
      }),
    );
    await flush();
    expect(calls).toBe(2);
    job.cancel({ kind: "shutdown" });
    const outcome = await run.result;
    expect(outcome).toMatchObject({
      stop: "cancelled",
      completed: 0,
      stoppedAt: 1,
    });
    expect(outcome.failed).toStrictEqual([]);
    expect(calls).toBe(2);
    // A shutdown leaves the record for recover(); the runner does not touch it.
    expect((await h.queue.get(jobId))?.status).toBe("running");
  });

  it("cancelling a paused job moves it straight to cancelled and stops the run", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(10),
        pool: fixedPool(2),
        call: (item) => Promise.resolve(`summary ${item.key}`),
      }),
    );
    await run.pause("credential-required");
    const paused = await h.queue.get(jobId);
    expect(paused?.status).toBe("paused");
    expect(paused?.pauseReason).toBe("credential-required");
    await run.cancel();
    const outcome = await run.result;
    expect(outcome.stop).toBe("cancelled");
    expect((await h.queue.get(jobId))?.status).toBe("cancelled");
    // Nothing completed before the pause point is lost; nothing after it ran.
    expect(outcome.completed + outcome.skipped).toBe(
      (outcome.stoppedAt ?? 0) - 1,
    );
  });

  it("a pause request interrupts a wait for a permit another job holds", async () => {
    const h = harness();
    const pool = fixedPool(1);
    const blocker = createDeferred<string>();
    const first = await runningJob(h);
    const second = await runningJob(h, "background");
    const a = runPooledItems(
      baseDeps(h, first, {
        items: items(1),
        pool,
        call: () => blocker.promise,
      }),
    );
    await flush();
    let bCalls = 0;
    const b = runPooledItems(
      baseDeps(h, second, {
        items: items(3),
        pool,
        call: (item) => {
          bCalls += 1;
          return Promise.resolve(`summary ${item.key}`);
        },
      }),
    );
    await flush();
    // Job B waits for the one permit job A holds; pausing B does not wait for A.
    await b.pause();
    expect((await h.queue.get(second))?.status).toBe("paused");
    expect(bCalls).toBe(0);
    blocker.resolve("summary");
    await a.result;
    await b.resume();
    expect((await b.result).completed).toBe(3);
  });

  it("a resume before the pause takes effect withdraws it: the job never pauses", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const answer = createDeferred<string>();
    let calls = 0;
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(3),
        pool: fixedPool(1),
        call: (item) => {
          calls += 1;
          return item.n === 1 ? answer.promise : Promise.resolve("summary");
        },
      }),
    );
    await flush();
    const pausing = run.pause();
    await run.resume();
    await pausing;
    answer.resolve("summary");
    const outcome = await run.result;
    expect(outcome.completed).toBe(3);
    expect(calls).toBe(3);
    expect(h.paused).toHaveLength(0);
  });

  it("stops dispatching once the wall-clock budget is spent, not counting time paused", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    let calls = 0;
    const second = createDeferred<string>();
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(10),
        pool: fixedPool(1),
        wallClockBudgetMs: 5000,
        call: (item) => {
          calls += 1;
          h.clock.advance(1000);
          return item.n === 2
            ? second.promise
            : Promise.resolve(`summary ${item.key}`);
        },
      }),
    );
    await flush();
    expect(calls).toBe(2);
    const pausing = run.pause();
    second.resolve("summary");
    await pausing;
    expect(calls).toBe(2);
    h.clock.advance(60_000); // a minute paused does not count
    await run.resume();
    const outcome = await run.result;
    expect(outcome.stop).toBe("budget-elapsed");
    expect(calls).toBe(5);
    expect(outcome.stoppedAt).toBe(6);
    expect(describePooledOutcome(outcome)).toBe("budget elapsed at 6/10");
    // A budget stop leaves the job running, for the pipeline's
    // "N of M completed, retry the rest?" (P3-T29).
    expect((await h.queue.get(jobId))?.status).toBe("running");
  });

  it("writes through checkpoint.ts's CheckpointWriter: the paused job's record holds the boundary checkpoint", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const answer = createDeferred<string>();
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(4),
        pool: fixedPool(1),
        checkpoint: createCheckpointWriter({
          queue: h.queue,
          jobId,
          clock: h.clock,
        }),
        call: (item) =>
          item.n === 2 ? answer.promise : Promise.resolve("summary"),
      }),
    );
    await flush();
    const pausing = run.pause();
    answer.resolve("summary");
    await pausing;
    expect(await readCheckpoint(h.queue, jobId)).toStrictEqual({
      version: 1,
      completed: ["w001", "w002"],
      failed: [],
      pending: ["w003", "w004"],
    });
    await run.resume();
    await run.result;
    expect(await readCheckpoint(h.queue, jobId)).toMatchObject({
      completed: ["w001", "w002", "w003", "w004"],
      pending: [],
    });
  });

  it("treats a done-probe that throws as not done, and dispatches the item", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(2),
        pool: fixedPool(1),
        isDone: () => Promise.reject(new Error("cache closed")),
        call: (item) => Promise.resolve(`summary ${item.key}`),
      }),
    );
    expect(await run.result).toMatchObject({ dispatched: 2, completed: 2 });
  });
});

// ---------------------------------------------------------------------------
// Pinned work: the cache's §9.4 step 4 hook
// ---------------------------------------------------------------------------

describe("P3-T17 — running jobs' work keys are pinned in the cache", () => {
  it("holds every item's work tag while the run lives, completed ones included, and lets go after", async () => {
    const h = harness();
    const jobId = await runningJob(h);
    const runningWork = createRunningWork();
    const other = runningWork.hold("other", ["w001", "x9"]);
    const answer = createDeferred<string>();
    const run = runPooledItems(
      baseDeps(h, jobId, {
        items: items(3),
        pool: fixedPool(1),
        runningWork,
        call: (item) =>
          item.n === 3 ? answer.promise : Promise.resolve("summary"),
      }),
    );
    await flush();
    expect([...runningWork.pinnedTags()].sort()).toStrictEqual([
      "work:w001",
      "work:w002",
      "work:w003",
      "work:x9",
    ]);
    answer.resolve("summary");
    await run.result;
    expect([...runningWork.pinnedTags()].sort()).toStrictEqual([
      "work:w001",
      "work:x9",
    ]);
    other();
    other();
    expect(runningWork.pinnedTags()).toStrictEqual([]);
  });

  it("installPluginDatabase hands pinnedTags to the cache, whose prune keeps the pinned entries", async () => {
    const clock = createManualClock();
    const logger = createLogger({ sink: NULL_LOG_SINK, clock });
    const scope = createScope({
      description: "llmPool test",
      onError: (message, error) => {
        throw new Error(`${message}: ${String(error)}`);
      },
      strict: true,
    });
    const runningWork = createRunningWork();
    const release = runningWork.hold("job-1", ["w1"]);
    const database = installPluginDatabase(scope, {
      source: sqliteSource(),
      clock,
      logger,
      cacheMaxBytes: () => 1, // every unpinned entry is over the cap
      pinnedTags: runningWork.pinnedTags,
    });
    await database.ready;
    await database.cache.set("summary", "pinned", "kept", {
      tags: ["work:w1"],
    });
    await database.cache.set("summary", "loose", "evicted", {
      tags: ["work:w2"],
    });
    await database.cache.prune();
    expect(await database.cache.get("summary", "pinned")).toBe("kept");
    expect(await database.cache.get("summary", "loose")).toBeUndefined();
    release();
    await database.cache.prune();
    expect(await database.cache.get("summary", "pinned")).toBeUndefined();
    await scope.unregisterAll();
  });
});

/** A plugin database over `node:sqlite` in memory, as `container.test.ts` builds one. */
function sqliteSource(): PluginDatabaseSource {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  const connection: SqlConnection = {
    queryAsync(sql, params) {
      const statement = db.prepare(sql);
      if (/^\s*(select|pragma)/i.test(sql)) {
        return Promise.resolve(statement.all(...bind(params)));
      }
      statement.run(...bind(params));
      return Promise.resolve(undefined);
    },
    valueQueryAsync(sql, params) {
      const row = db.prepare(sql).get(...bind(params));
      return Promise.resolve(row === undefined ? false : Object.values(row)[0]);
    },
    async executeTransaction(func) {
      db.exec("BEGIN");
      try {
        const result = await func();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    closeDatabase() {
      db.close();
      return Promise.resolve();
    },
  };
  const files = new Map<string, string>();
  const blobs: CacheBlobStore = {
    write: (name, text) => Promise.resolve(void files.set(name, text)),
    read: (name) => Promise.resolve(files.get(name)),
    remove: (name) => Promise.resolve(void files.delete(name)),
    list: () => Promise.resolve([...files.keys()]),
  };
  return {
    open: () => connection,
    path: () => "/data/research-helper.sqlite",
    blobs,
  };
}

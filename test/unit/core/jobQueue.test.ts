/**
 * `P3-T34` — the job record, the `job` table, the queue's persistent half and
 * the checkpoint, at layer 1.
 *
 * Plain Node (`docs/13` §2.1): no Zotero, no network, no spend. The store is
 * `src/zotero/db.ts`'s `createJobStore` over a real SQLite (`node:sqlite`,
 * unflagged in Node 22.13, this repository's floor), migrated by the shipped
 * `runMigrations`, so every "persisted" below was read back out of SQLite
 * rather than out of a double that agrees with the code. A "simulated
 * restart" is a fresh queue and a fresh store over the same database file.
 *
 * Every key in this file is synthetic and built at run time.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JOB_DDL,
  JOB_STATUS_INDEX_DDL,
  runMigrations,
} from "../../../src/bootstrap/migrations";
import { createManualClock, type ManualClock } from "../../../src/core/clock";
import { ConfigurationError } from "../../../src/core/errors";
import {
  canTransition,
  isBudgetStop,
  isPartlyRedacted,
  JOB_COLUMNS,
  JOB_STATUSES,
  JOB_TRANSITIONS,
  JobTransitionError,
  TERMINAL_JOB_STATUSES,
  transition,
  type JobRecord,
} from "../../../src/core/jobQueue/jobRecord";
import {
  createJobQueue,
  MAX_RESUME_ATTEMPTS,
  NOT_RESUMABLE_CODE,
  RESUME_GUARD_NAMES,
  RESUME_LOOP_CODE,
  type JobNotifier,
  type JobQueue,
  type JobQueueDeps,
  type ResumeGuards,
  type ResumeVerdict,
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  CHECKPOINT_MIN_INTERVAL_MS,
  createCheckpointWriter,
  readCheckpoint,
} from "../../../src/pipeline/shared/checkpoint";
import {
  createJobStore,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

const here = fileURLToPath(import.meta.url);
const DOCS_07 = readFileSync(
  resolve(dirname(here), "../../../docs/07-architecture-and-data-model.md"),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. A real SQLite behind db.ts's port (as provenanceRerun.test.ts builds it)
// ---------------------------------------------------------------------------

interface Connection extends SqlConnection {
  readonly db: DatabaseSync;
}

function sqlite(): Connection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
    db,
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
}

async function migrated(): Promise<Connection> {
  const connection = sqlite();
  await runMigrations(connection);
  return connection;
}

/** One `job` row straight out of SQLite, as a plain object. */
function rawRow(connection: Connection, id: string): Record<string, unknown> {
  const row = connection.db.prepare("SELECT * FROM job WHERE id = ?").get(id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return { ...row };
}

/** A synthetic Anthropic-shaped key, built at run time. */
const SYNTHETIC_KEY = "sk-ant-" + "x".repeat(30);

const VERSION = "0.0.2-test";

interface Harness {
  readonly connection: Connection;
  readonly clock: ManualClock;
  readonly queue: JobQueue;
}

function queueOver(
  connection: Connection,
  clock: ManualClock,
  overrides: Partial<JobQueueDeps> = {},
): JobQueue {
  let sequence = 0;
  const queue = createJobQueue({
    clock,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    pluginVersion: VERSION,
    isResumable: (pipelineId) => pipelineId === "summarize",
    newId: () => {
      sequence += 1;
      return `job-${String(sequence)}`;
    },
    ...overrides,
  });
  queue.attachStore(createJobStore(connection));
  return queue;
}

async function harness(
  overrides: Partial<JobQueueDeps> = {},
): Promise<Harness> {
  const connection = await migrated();
  const clock = createManualClock();
  return { connection, clock, queue: queueOver(connection, clock, overrides) };
}

/** Records every notice, in order, with the job's status on disk at that moment. */
function recordingNotifier(connection: Connection): JobNotifier & {
  readonly paused: (record: JobRecord) => void;
  readonly pausedCalls: JobRecord[];
  readonly resumedCalls: { ids: string[]; statusOnDisk: string[] }[];
} {
  const pausedCalls: JobRecord[] = [];
  const resumedCalls: { ids: string[]; statusOnDisk: string[] }[] = [];
  return {
    pausedCalls,
    resumedCalls,
    paused(record) {
      pausedCalls.push(record);
    },
    resumed(records) {
      resumedCalls.push({
        ids: records.map((record) => record.id),
        statusOnDisk: records.map((record) =>
          String(rawRow(connection, record.id)["status"]),
        ),
      });
      return Promise.resolve();
    },
  };
}

const PROCEED: ResumeVerdict = { proceed: true };

/** Four guards that let everything through and count their calls. */
function passingGuards(): ResumeGuards & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    skipCached(record) {
      calls.push(`skipCached:${record.id}`);
      const state = record.checkpoint as { pending: string[]; done: string[] };
      // The fixture's cache holds "w2": it leaves the pending list.
      return Promise.resolve({
        ...state,
        pending: state.pending.filter((key) => key !== "w2"),
      });
    },
    egress(record) {
      calls.push(`egress:${record.id}`);
      return Promise.resolve(PROCEED);
    },
    confirm(record) {
      calls.push(`confirm:${record.id}`);
      return Promise.resolve(PROCEED);
    },
    ceilings(record) {
      calls.push(`ceilings:${record.id}`);
      return Promise.resolve(PROCEED);
    },
  };
}

const CHECKPOINT = {
  version: 1,
  pending: ["w2", "w3", "hash:" + "0123456789abcdef".repeat(2) + "01234567"],
  done: ["w1"],
};

/** A summarize job, started, checkpointed, then left `running` by a "crash". */
async function crashedMidJob(queue: JobQueue): Promise<JobRecord> {
  const job = await queue.enqueue("summarize", { collectionKey: "ABCD2345" });
  await queue.start(job.id);
  return queue.writeCheckpoint(job.id, CHECKPOINT);
}

// ---------------------------------------------------------------------------
// 2. The schema — docs/07 §8.3, column for column
// ---------------------------------------------------------------------------

function docsStatement(head: string): string {
  const start = DOCS_07.indexOf(head);
  expect(start, `docs/07 carries "${head}"`).toBeGreaterThan(-1);
  return DOCS_07.slice(start, DOCS_07.indexOf(";", start));
}

describe("P3-T34 — the job table is docs/07 §8.3's, as migration version 2", () => {
  it("copies job and idx_job_status from docs/07 §8.3 byte for byte", () => {
    expect(JOB_DDL).toBe(docsStatement("CREATE TABLE job ("));
    expect(JOB_STATUS_INDEX_DDL).toBe(
      docsStatement("CREATE INDEX idx_job_status"),
    );
  });

  it("migrates a fresh file with the job table whose columns are JobRow's, in order", async () => {
    const connection = await migrated();
    const names = connection.db
      .prepare("PRAGMA table_info(job)")
      .all()
      .map((row) => String((row as { name: string }).name));
    expect(names).toStrictEqual([...JOB_COLUMNS]);
    expect(
      connection.db
        .prepare("PRAGMA index_info(idx_job_status)")
        .all()
        .map((row) => String((row as { name: string }).name)),
    ).toStrictEqual(["status"]);
  });

  // Moved with P3-T33, which appended version 3 (`cache_entry`), and with
  // plan/00 §6 item 265 (b), which appended version 4 (`user_price`), and with
  // P3-T15, which appended version 5 (`collection_settings`): a version-1 file
  // now goes through version 2 to the latest.
  it("brings a version-1 file through version 2 to the latest without touching search_provenance", async () => {
    const connection = sqlite();
    await runMigrations(connection, [
      {
        version: 1,
        statements: ["CREATE TABLE search_provenance (run_id TEXT)"],
      },
    ]);
    connection.db.exec("INSERT INTO search_provenance VALUES ('kept')");
    expect(await runMigrations(connection)).toStrictEqual({ from: 1, to: 10 });
    expect(
      connection.db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'job'")
        .get(),
    ).toMatchObject({ n: 1 });
    expect(
      connection.db.prepare("SELECT run_id FROM search_provenance").all(),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. The state machine
// ---------------------------------------------------------------------------

describe("P3-T34 — JobRecord's states and the moves between them", () => {
  it("moves queued → running → paused(credential-required) → running → succeeded, persisted at every step", async () => {
    const { connection, clock, queue } = await harness();
    const job = await queue.enqueue("summarize", { collectionKey: "ABCD2345" });
    expect(rawRow(connection, job.id)["status"]).toBe("queued");

    clock.advance(10);
    await queue.start(job.id);
    expect(rawRow(connection, job.id)).toMatchObject({
      status: "running",
      started_at: clock.now(),
      pause_reason: null,
    });

    await queue.pause(job.id, "credential-required");
    expect(rawRow(connection, job.id)).toMatchObject({
      status: "paused",
      pause_reason: "credential-required",
    });

    await queue.resume(job.id);
    expect(rawRow(connection, job.id)).toMatchObject({
      status: "running",
      pause_reason: null,
    });

    clock.advance(10);
    await queue.succeed(job.id, { kind: "collection", key: "ABCD2345" });
    expect(rawRow(connection, job.id)).toMatchObject({
      status: "succeeded",
      finished_at: clock.now(),
      result_ref_json: JSON.stringify({ kind: "collection", key: "ABCD2345" }),
    });

    // A simulated restart reads the same record.
    const reread = await queueOver(connection, clock).get(job.id);
    expect(reread).toStrictEqual(await queue.get(job.id));
    expect(reread?.status).toBe("succeeded");
  });

  it("refuses a move JOB_TRANSITIONS does not list, and a pause without a reason", async () => {
    const { queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await expect(queue.succeed(job.id)).rejects.toThrow(JobTransitionError);
    await expect(queue.resume(job.id)).rejects.toThrow(JobTransitionError);
    await queue.start(job.id);
    await queue.succeed(job.id);
    for (const attempt of [
      () => queue.start(job.id),
      () => queue.pause(job.id, "user"),
      () => queue.cancel(job.id),
    ]) {
      await expect(attempt()).rejects.toThrow(JobTransitionError);
    }
    const record = await queue.get(job.id);
    if (record === undefined) throw new Error("no record");
    expect(() =>
      transition({ ...record, status: "running" }, "paused", 0),
    ).toThrow(JobTransitionError);
  });

  it("gives terminal states no way out and every other state at least one", () => {
    for (const status of JOB_STATUSES) {
      expect(JOB_TRANSITIONS[status].length === 0).toBe(
        TERMINAL_JOB_STATUSES.includes(status),
      );
    }
    expect(canTransition("queued", "interrupted")).toBe(false);
    expect(canTransition("interrupted", "queued")).toBe(true);
  });

  it("notifies once per pause, not once per item", async () => {
    const connection = await migrated();
    const clock = createManualClock();
    const notifier = recordingNotifier(connection);
    const queue = queueOver(connection, clock, { notifier });
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    // 200 items each find the key missing.
    await Promise.all(
      Array.from({ length: 200 }, () =>
        queue.pause(job.id, "credential-required"),
      ),
    );
    expect(notifier.pausedCalls).toHaveLength(1);
    expect(notifier.pausedCalls[0]?.pauseReason).toBe("credential-required");
    await queue.resume(job.id);
    await queue.pause(job.id, "user");
    expect(notifier.pausedCalls).toHaveLength(2);
  });

  it("holds a ceiling stop as BudgetStop: paused, not failed", async () => {
    const { queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    const stopped = await queue.pause(job.id, "budget-stop");
    expect(stopped.status).toBe("paused");
    expect(isBudgetStop(stopped)).toBe(true);
    expect(isBudgetStop(await queue.resume(job.id))).toBe(false);
  });

  it("rolls nothing back on cancel: progress, usage and checkpoint survive", async () => {
    const { connection, queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    await queue.reportProgress(job.id, {
      completed: 86,
      total: 200,
      currentStageKey: "summarize",
      message: "86 of 200",
    });
    await queue.addUsage(job.id, {
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.25,
    });
    await queue.writeCheckpoint(job.id, CHECKPOINT);
    const before = rawRow(connection, job.id);

    expect((await queue.cancel(job.id)).status).toBe("cancelling");
    const cancelled = await queue.finishCancel(job.id);
    expect(cancelled.status).toBe("cancelled");
    const after = rawRow(connection, job.id);
    for (const column of ["progress_json", "usage_json", "checkpoint_json"]) {
      expect(after[column]).toBe(before[column]);
    }
    // A job with nothing in flight goes straight to `cancelled`.
    const queued = await queue.enqueue("summarize", {});
    expect((await queue.cancel(queued.id)).status).toBe("cancelled");
  });

  it("adds usage across calls and keeps the token counts the gate could have dropped", async () => {
    const { connection, queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    await queue.addUsage(job.id, {
      inputTokens: 10,
      outputTokens: 2,
      costUsd: 0.5,
    });
    await queue.addUsage(job.id, {
      inputTokens: 5,
      outputTokens: 1,
      costUsd: 0.25,
    });
    expect(
      JSON.parse(String(rawRow(connection, job.id)["usage_json"])),
    ).toStrictEqual({ inputTokens: 15, outputTokens: 3, costUsd: 0.75 });
  });

  it("serializes concurrent writes to one job, so none is lost", async () => {
    const { queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    await Promise.all([
      queue.addWarning(job.id, "first"),
      queue.addUsage(job.id, { inputTokens: 1, outputTokens: 1, costUsd: 1 }),
      queue.addWarning(job.id, "second"),
      queue.writeCheckpoint(job.id, CHECKPOINT),
    ]);
    const record = await queue.get(job.id);
    expect(record?.warnings).toStrictEqual(["first", "second"]);
    expect(record?.usage.costUsd).toBe(1);
    expect(record?.checkpoint).toStrictEqual(CHECKPOINT);
  });

  it("refuses every operation before a store is attached and after it is detached", async () => {
    const clock = createManualClock();
    const queue = createJobQueue({
      clock,
      logger: createLogger({ sink: NULL_LOG_SINK, clock }),
      pluginVersion: VERSION,
      isResumable: () => true,
    });
    expect(queue.attached).toBe(false);
    await expect(queue.enqueue("summarize", {})).rejects.toThrow(
      ConfigurationError,
    );
    queue.attachStore(createJobStore(await migrated()));
    expect(queue.attached).toBe(true);
    queue.detachStore();
    await expect(queue.list()).rejects.toThrow(ConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// 4. The redaction gate on every gated column
// ---------------------------------------------------------------------------

describe("P3-T34 — every gated job column passes redactRecord, and keeps its mark", () => {
  it("stores an error_json carrying a synthetic key without the key, and marks it", async () => {
    const { connection, queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    const failed = await queue.fail(job.id, {
      code: "LLM",
      messageKey: "rh-error-llm",
      detail: `provider said: invalid key ${SYNTHETIC_KEY}`,
      retryable: false,
    });

    const stored = String(rawRow(connection, job.id)["error_json"]);
    expect(stored).not.toContain(SYNTHETIC_KEY);
    expect(stored).toContain("rh-error-llm");
    expect(failed.redaction.error?.partlyRedacted).toBe(true);
    expect(isPartlyRedacted(failed)).toBe(true);
    expect(
      JSON.parse(String(rawRow(connection, job.id)["redaction_json"])),
    ).toMatchObject({
      error: { partlyRedacted: true, redactedStrings: 1, droppedFields: 0 },
    });
  });

  it("gates input, progress and warnings, and drops a key-named field from the input", async () => {
    const { connection, queue } = await harness();
    const job = await queue.enqueue("summarize", {
      query: `crispr ${SYNTHETIC_KEY}`,
      apiKey: SYNTHETIC_KEY,
    });
    await queue.start(job.id);
    await queue.reportProgress(job.id, {
      completed: 1,
      total: 2,
      currentStageKey: "summarize",
      message: `retrying with ${SYNTHETIC_KEY}`,
    });
    await queue.addWarning(job.id, `a header carried ${SYNTHETIC_KEY}`);

    const row = rawRow(connection, job.id);
    for (const column of ["input_json", "progress_json", "warnings_json"]) {
      expect(String(row[column])).not.toContain(SYNTHETIC_KEY);
    }
    expect(JSON.parse(String(row["input_json"]))).not.toHaveProperty("apiKey");
    const record = await queue.get(job.id);
    expect(record?.redaction.input).toStrictEqual({
      partlyRedacted: true,
      redactedStrings: 1,
      droppedFields: 1,
    });
    expect(record?.redaction.progress?.partlyRedacted).toBe(true);
    expect(record?.redaction.warnings?.partlyRedacted).toBe(true);
  });

  it("keeps a field's mark through later writes of other fields, and clears it when the field is replaced clean", async () => {
    const { queue } = await harness();
    const job = await queue.enqueue("summarize", { query: SYNTHETIC_KEY });
    await queue.start(job.id);
    await queue.reportProgress(job.id, {
      completed: 0,
      total: 1,
      currentStageKey: undefined,
      message: SYNTHETIC_KEY,
    });
    // Many later writes: the input's and progress's marks stay.
    await queue.addUsage(job.id, {
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    });
    await queue.pause(job.id, "user");
    await queue.resume(job.id);
    let record = await queue.get(job.id);
    expect(record?.redaction.input?.partlyRedacted).toBe(true);
    expect(record?.redaction.progress?.partlyRedacted).toBe(true);

    await queue.reportProgress(job.id, {
      completed: 1,
      total: 1,
      currentStageKey: undefined,
      message: "done",
    });
    record = await queue.get(job.id);
    expect(record?.redaction.progress).toBeUndefined();
    expect(record?.redaction.input?.partlyRedacted).toBe(true);
  });

  it("keeps an earlier warning's mark when a clean warning is appended", async () => {
    const { queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    await queue.addWarning(job.id, SYNTHETIC_KEY);
    const record = await queue.addWarning(job.id, "clean");
    expect(record.redaction.warnings?.partlyRedacted).toBe(true);
    expect(record.warnings).toHaveLength(2);
  });

  it("leaves a clean record unmarked", async () => {
    const { queue } = await harness();
    const job = await queue.enqueue("summarize", { collectionKey: "ABCD2345" });
    expect(job.redaction).toStrictEqual({});
    expect(isPartlyRedacted(job)).toBe(false);
  });

  it("stores the checkpoint ungated, so a hash: work key survives", async () => {
    const { connection, queue } = await harness();
    const job = await crashedMidJob(queue);
    expect(
      JSON.parse(String(rawRow(connection, job.id)["checkpoint_json"])),
    ).toStrictEqual(CHECKPOINT);
  });
});

// ---------------------------------------------------------------------------
// 5. The checkpoint
// ---------------------------------------------------------------------------

describe("P3-T34 — checkpoint.ts writes and reads a job's checkpoint through the job store", () => {
  it("reads a checkpoint written mid-job back identical after a simulated restart", async () => {
    const { connection, clock, queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    const writer = createCheckpointWriter({ queue, jobId: job.id, clock });
    await writer.checkpoint(CHECKPOINT);

    const restarted = queueOver(connection, clock);
    expect(await readCheckpoint(restarted, job.id)).toStrictEqual(CHECKPOINT);
    expect((await restarted.get(job.id))?.checkpointAtEpochMs).toBe(
      clock.now(),
    );
  });

  it("writes at most once per 2 s, always at a boundary, and flushes the held state", async () => {
    const { clock, queue } = await harness();
    const job = await queue.enqueue("summarize", {});
    await queue.start(job.id);
    const writer = createCheckpointWriter({ queue, jobId: job.id, clock });
    const read = (): Promise<unknown> => readCheckpoint(queue, job.id);

    await writer.checkpoint({ at: 1 });
    expect(await read()).toStrictEqual({ at: 1 });

    clock.advance(CHECKPOINT_MIN_INTERVAL_MS - 1);
    await writer.checkpoint({ at: 2 });
    await writer.checkpoint({ at: 3 });
    expect(await read()).toStrictEqual({ at: 1 });

    await writer.flush();
    expect(await read()).toStrictEqual({ at: 3 });
    await writer.flush(); // nothing held: no write
    expect(await read()).toStrictEqual({ at: 3 });

    await writer.checkpoint({ at: 4 }, { boundary: true });
    expect(await read()).toStrictEqual({ at: 4 });

    clock.advance(CHECKPOINT_MIN_INTERVAL_MS);
    await writer.checkpoint({ at: 5 });
    expect(await read()).toStrictEqual({ at: 5 });
  });
});

// ---------------------------------------------------------------------------
// 6. Startup recovery — docs/07 §7.6, as decided 2026-10-21 (item 250)
// ---------------------------------------------------------------------------

describe("P3-T34 — recover(): docs/07 §7.6's table", () => {
  it("reclassifies running and cancelling as interrupted, and leaves queued and paused alone", async () => {
    const { connection, clock, queue } = await harness();
    const running = await crashedMidJob(queue);
    const cancelling = await queue.enqueue("summarize", {});
    await queue.start(cancelling.id);
    await queue.cancel(cancelling.id);
    const queued = await queue.enqueue("summarize", {});
    const paused = await queue.enqueue("summarize", {});
    await queue.pause(paused.id, "user");

    const report = await queueOver(connection, clock).recover();
    expect(report.interrupted).toStrictEqual([running.id, cancelling.id]);
    expect(rawRow(connection, queued.id)["status"]).toBe("queued");
    expect(rawRow(connection, paused.id)).toMatchObject({
      status: "paused",
      pause_reason: "user",
    });
  });

  it(`fails a job interrupted ${String(MAX_RESUME_ATTEMPTS)} times with resume-loop, and a non-resumable one with not-resumable`, async () => {
    const { connection, clock, queue } = await harness();
    const looping = await crashedMidJob(queue);
    connection.db
      .prepare("UPDATE job SET attempt_count = ? WHERE id = ?")
      .run(MAX_RESUME_ATTEMPTS, looping.id);
    const search = await queue.enqueue("searchImport", {});
    await queue.start(search.id);

    const report = await queueOver(connection, clock).recover();
    expect(report.failed).toStrictEqual([looping.id, search.id]);
    expect(
      JSON.parse(String(rawRow(connection, looping.id)["error_json"])),
    ).toMatchObject({
      code: RESUME_LOOP_CODE,
    });
    expect(
      JSON.parse(String(rawRow(connection, search.id)["error_json"])),
    ).toMatchObject({
      code: NOT_RESUMABLE_CODE,
    });
  });

  // docs/07 §12.6's note, point 9: DECIDED 2026-11-17 (coordinator, under
  // plan/00 §6 item 313).
  it("cancels, not fails, an interrupted job of a pipeline cancelledAfterRestart names; others still fail", async () => {
    const { connection, clock, queue } = await harness();
    const audio = await queue.enqueue("audioReport", {});
    await queue.start(audio.id);
    const search = await queue.enqueue("searchImport", {});
    await queue.start(search.id);
    const resumable = await crashedMidJob(queue);

    const report = await queueOver(connection, clock, {
      cancelledAfterRestart: (pipelineId) => pipelineId === "audioReport",
    }).recover();
    expect(report.cancelled).toStrictEqual([audio.id]);
    expect(report.failed).toStrictEqual([search.id]);
    expect(rawRow(connection, audio.id)).toMatchObject({
      status: "cancelled",
      error_json: null,
    });
    expect(rawRow(connection, audio.id)["finished_at"]).not.toBeNull();
    expect(rawRow(connection, search.id)["status"]).toBe("failed");
    // A resumable pipeline the predicate names is not cancelled.
    const named = await queueOver(connection, clock, {
      cancelledAfterRestart: () => true,
    }).recover();
    expect(named.cancelled).toStrictEqual([]);
    expect(rawRow(connection, resumable.id)["status"]).toBe("interrupted");
  });

  it("without cancelledAfterRestart every non-resumable interrupted job fails", async () => {
    const { connection, clock, queue } = await harness();
    const audio = await queue.enqueue("audioReport", {});
    await queue.start(audio.id);
    const report = await queueOver(connection, clock).recover();
    expect(report.cancelled).toStrictEqual([]);
    expect(report.failed).toStrictEqual([audio.id]);
  });

  it("leaves a job from another plugin version, or with no checkpoint, for the user", async () => {
    const { connection, clock, queue } = await harness();
    const other = await crashedMidJob(queue);
    connection.db
      .prepare("UPDATE job SET plugin_version = '0.0.1' WHERE id = ?")
      .run(other.id);
    const bare = await queue.enqueue("summarize", {});
    await queue.start(bare.id);

    const guards = passingGuards();
    const notifier = recordingNotifier(connection);
    const report = await queueOver(connection, clock, {
      resumeGuards: guards,
      notifier,
    }).recover();
    expect(report.awaitingUserDecision).toStrictEqual([other.id, bare.id]);
    expect(report.autoResumed).toStrictEqual([]);
    expect(guards.calls).toStrictEqual([]);
    expect(rawRow(connection, other.id)["status"]).toBe("interrupted");
  });
});

describe("P3-T34 — recover(): unfinished jobs resume automatically, behind every guard (plan/00 §6 item 250)", () => {
  it("resumes nothing while no guard exists: the job waits interrupted, its attempt count unchanged", async () => {
    const { connection, clock, queue } = await harness();
    const job = await crashedMidJob(queue);
    const restarted = queueOver(connection, clock);
    expect(restarted.missingResumePrerequisites()).toStrictEqual([
      ...RESUME_GUARD_NAMES,
      "notifier",
    ]);

    const report = await restarted.recover();
    expect(report.waitingForGuards).toStrictEqual([job.id]);
    expect(report.autoResumed).toStrictEqual([]);
    expect(rawRow(connection, job.id)).toMatchObject({
      status: "interrupted",
      attempt_count: 0,
    });
    // Looked at again on the next start, and still waiting.
    expect(
      (await queueOver(connection, clock).recover()).waitingForGuards,
    ).toStrictEqual([job.id]);
  });

  for (const absent of [...RESUME_GUARD_NAMES, "notifier"] as const) {
    it(`resumes nothing when only ${absent} is missing, and calls no guard`, async () => {
      const { connection, clock, queue } = await harness();
      const job = await crashedMidJob(queue);
      const guards = passingGuards();
      const notifier = recordingNotifier(connection);
      const partial: Partial<ResumeGuards> = { ...guards };
      if (absent !== "notifier") delete partial[absent];
      const restarted = queueOver(connection, clock, {
        resumeGuards: partial,
        ...(absent !== "notifier" && { notifier }),
      });
      expect(restarted.missingResumePrerequisites()).toStrictEqual([absent]);

      const report = await restarted.recover();
      expect(report.waitingForGuards).toStrictEqual([job.id]);
      expect(guards.calls).toStrictEqual([]);
      expect(notifier.resumedCalls).toStrictEqual([]);
      expect(rawRow(connection, job.id)["status"]).toBe("interrupted");
    });
  }

  it("resumes when every guard passes: cached items skipped, one notice before requeueing, attempt counted", async () => {
    const { connection, clock, queue } = await harness();
    const first = await crashedMidJob(queue);
    const second = await crashedMidJob(queue);
    const guards = passingGuards();
    const notifier = recordingNotifier(connection);

    const report = await queueOver(connection, clock, {
      resumeGuards: guards,
      notifier,
    }).recover();

    expect(report.autoResumed).toStrictEqual([first.id, second.id]);
    // One notice, naming both, shown while both were still interrupted.
    expect(notifier.resumedCalls).toStrictEqual([
      {
        ids: [first.id, second.id],
        statusOnDisk: ["interrupted", "interrupted"],
      },
    ]);
    // Cached first, then the three spend guards, in that order, per job.
    expect(guards.calls).toStrictEqual([
      `skipCached:${first.id}`,
      `egress:${first.id}`,
      `confirm:${first.id}`,
      `ceilings:${first.id}`,
      `skipCached:${second.id}`,
      `egress:${second.id}`,
      `confirm:${second.id}`,
      `ceilings:${second.id}`,
    ]);
    const resumed = await queueOver(connection, clock).get(first.id);
    expect(resumed?.status).toBe("queued");
    expect(resumed?.attemptCount).toBe(1);
    expect(resumed?.checkpoint).toStrictEqual({
      ...CHECKPOINT,
      pending: CHECKPOINT.pending.filter((key) => key !== "w2"),
    });
  });

  it("lets the spend guards judge only what is left after the cached items are skipped", async () => {
    const { connection, clock, queue } = await harness();
    await crashedMidJob(queue);
    const seen: unknown[] = [];
    const guards = passingGuards();
    await queueOver(connection, clock, {
      resumeGuards: {
        ...guards,
        confirm(record) {
          seen.push(record.checkpoint);
          return Promise.resolve(PROCEED);
        },
      },
      notifier: recordingNotifier(connection),
    }).recover();
    expect(seen).toStrictEqual([
      {
        ...CHECKPOINT,
        pending: CHECKPOINT.pending.filter((key) => key !== "w2"),
      },
    ]);
  });

  for (const [guard, reason] of [
    ["egress", "egress-unacknowledged"],
    ["confirm", "awaiting-confirmation"],
    ["ceilings", "budget-stop"],
  ] as const) {
    it(`pauses with ${reason} when ${guard} says no, stops there, and announces no resume`, async () => {
      const { connection, clock, queue } = await harness();
      const job = await crashedMidJob(queue);
      const guards = passingGuards();
      const notifier = recordingNotifier(connection);
      const report = await queueOver(connection, clock, {
        resumeGuards: {
          ...guards,
          [guard]: (record: JobRecord): Promise<ResumeVerdict> => {
            guards.calls.push(`${guard}:${record.id}`);
            return Promise.resolve({ proceed: false, pauseReason: reason });
          },
        },
        notifier,
      }).recover();

      expect(report.pausedByGuard).toStrictEqual([job.id]);
      expect(report.autoResumed).toStrictEqual([]);
      expect(rawRow(connection, job.id)).toMatchObject({
        status: "paused",
        pause_reason: reason,
        attempt_count: 0,
      });
      expect(guards.calls.at(-1)).toBe(`${guard}:${job.id}`);
      expect(notifier.resumedCalls).toStrictEqual([]);
      expect(
        notifier.pausedCalls.map((record) => record.pauseReason),
      ).toStrictEqual([reason]);
    });
  }

  it("resumes nothing when a guard throws or the notice fails", async () => {
    const { connection, clock, queue } = await harness();
    const job = await crashedMidJob(queue);
    const throwing = await queueOver(connection, clock, {
      resumeGuards: {
        ...passingGuards(),
        ceilings: () => Promise.reject(new Error("no pricing table")),
      },
      notifier: recordingNotifier(connection),
    }).recover();
    expect(throwing.waitingForGuards).toStrictEqual([job.id]);
    expect(rawRow(connection, job.id)["status"]).toBe("interrupted");

    const silent = await queueOver(connection, clock, {
      resumeGuards: passingGuards(),
      notifier: {
        paused: () => undefined,
        resumed: () => Promise.reject(new Error("no window")),
      },
    }).recover();
    expect(silent.waitingForGuards).toStrictEqual([job.id]);
    expect(silent.autoResumed).toStrictEqual([]);
    expect(rawRow(connection, job.id)["status"]).toBe("interrupted");
  });
});

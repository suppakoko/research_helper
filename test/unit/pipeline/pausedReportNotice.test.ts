/**
 * `P4-T21` — the one-time notice at Zotero's start that a report job is left
 * paused (owner, `plan/00` §6 item 332(b); `docs/07` §12.4 reading 23). "One-time"
 * and "no cost" are what these tests prove: no job started or changed, the queue
 * only listed, and no second notice for the same pause. `announcePausedReports`
 * holds no router and no pipeline, so listing is all it can do; the live check that
 * no provider request follows is `test/integration/reportWindow-flow.spec.ts`'s.
 *
 * The queue and the `job` table are the real ones over `node:sqlite` in memory.
 */

import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/bootstrap/migrations";
import { createManualClock } from "../../../src/core/clock";
import type { JobRecord } from "../../../src/core/jobQueue/jobRecord";
import {
  createJobQueue,
  type JobQueue,
} from "../../../src/core/jobQueue/queue";
import { createLogger, NULL_LOG_SINK } from "../../../src/core/logger";
import {
  announcePausedReports,
  pausedForAnswer,
  pausedReportIdentity,
  pausedReportNoticeArgs,
  waitingReportJobs,
} from "../../../src/pipeline/trendReport/pausedReportNotice";
import {
  createJobStore,
  type SqlConnection,
  type SqlParam,
} from "../../../src/zotero/db";

function sqlite(): SqlConnection {
  const db = new DatabaseSync(":memory:");
  const bind = (params: readonly SqlParam[] | undefined): SqlParam[] => [
    ...(params ?? []),
  ];
  return {
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

const INPUT = { libraryID: 1, collectionKey: "COLLKEY1", language: "en" };

async function setup() {
  const connection = sqlite();
  await runMigrations(connection);
  const clock = createManualClock();
  const jobs = createJobQueue({
    clock,
    logger: createLogger({ sink: NULL_LOG_SINK, clock }),
    pluginVersion: "0.0.0-test",
    isResumable: () => true,
  });
  jobs.attachStore(createJobStore(connection));
  let stored = "[]";
  const shown: (readonly JobRecord[])[] = [];
  const called: string[] = [];
  // Every queue call is recorded, to show that `list` is the only one made.
  const onlyList = new Proxy(jobs, {
    get(target, name, receiver) {
      const member: unknown = Reflect.get(target, name, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        called.push(String(name));
        return (member as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const announce = (
    show?: (records: readonly JobRecord[]) => Promise<void>,
  ): Promise<readonly JobRecord[]> =>
    announcePausedReports({
      jobs: onlyList,
      readShown: () => stored,
      writeShown: (json) => {
        stored = json;
      },
      show:
        show ??
        ((records) => {
          shown.push(records);
          return Promise.resolve();
        }),
    });
  return {
    clock,
    jobs,
    shown,
    called,
    announce,
    stored: () => stored,
    setStored: (json: string) => {
      stored = json;
    },
  };
}

/** A running report job, paused for `reason`. */
async function pausedJob(
  jobs: JobQueue,
  pipelineId = "trendReport",
  input: unknown = INPUT,
  reason: "budget-stop" | "credential-required" = "budget-stop",
): Promise<JobRecord> {
  const record = await jobs.enqueue(pipelineId, input);
  await jobs.start(record.id);
  return jobs.pause(record.id, reason);
}

describe("P4-T21 — the paused-report notice is shown once and costs nothing", () => {
  it("shows one notice for a paused report job, with only a list of the queue and no record changed", async () => {
    const h = await setup();
    const record = await pausedJob(h.jobs);
    const before = JSON.stringify(await h.jobs.list());
    const announced = await h.announce();
    expect(announced.map((r) => r.id)).toEqual([record.id]);
    expect(h.shown).toHaveLength(1);
    // No job started: the queue was only listed.
    expect(h.called).toEqual(["list"]);
    expect(JSON.stringify(await h.jobs.list())).toBe(before);
    expect((await h.jobs.get(record.id))?.status).toBe("paused");
  });

  it("does not show it again for the same pause, at the next start or the one after", async () => {
    const h = await setup();
    await pausedJob(h.jobs);
    await h.announce();
    expect(h.shown).toHaveLength(1);
    expect(await h.announce()).toEqual([]);
    expect(await h.announce()).toEqual([]);
    expect(h.shown).toHaveLength(1);
  });

  it("recovery leaves a paused job paused, and the notice still holds for it", async () => {
    const h = await setup();
    const record = await pausedJob(h.jobs);
    await h.announce();
    await h.jobs.recover();
    expect((await h.jobs.get(record.id))?.status).toBe("paused");
    expect(await h.announce()).toEqual([]);
    expect(h.shown).toHaveLength(1);
  });

  it("shows it again for a new pause of the same job", async () => {
    const h = await setup();
    const record = await pausedJob(h.jobs);
    await h.announce();
    await h.jobs.resume(record.id);
    h.clock.advance(1_000);
    await h.jobs.writeCheckpoint(record.id, { moved: true });
    await h.jobs.pause(record.id, "budget-stop");
    expect((await h.announce()).map((r) => r.id)).toEqual([record.id]);
    expect(h.shown).toHaveLength(2);
  });

  it("another reason on the same job is a new pause, by its identity", () => {
    const base = {
      id: "trendReport-1",
      pauseReason: "budget-stop",
      checkpointAtEpochMs: 5,
      attemptCount: 1,
    } as const;
    const one = pausedReportIdentity(base);
    expect(one).toBe(pausedReportIdentity({ ...base }));
    for (const other of [
      { ...base, id: "trendReport-2" },
      { ...base, pauseReason: "credential-required" as const },
      { ...base, checkpointAtEpochMs: 6 },
      { ...base, attemptCount: 2 },
    ]) {
      expect(pausedReportIdentity(other)).not.toBe(one);
    }
  });

  it("ignores another pipeline's paused job and a report job that is not paused", async () => {
    const h = await setup();
    await pausedJob(h.jobs, "summarize");
    await h.jobs.enqueue("trendReport", INPUT);
    expect(await h.announce()).toEqual([]);
    expect(h.shown).toEqual([]);
    expect(h.stored()).toBe("[]");
  });

  it("a notice that could not be shown writes nothing, so the next start tries again", async () => {
    const h = await setup();
    await pausedJob(h.jobs);
    await expect(
      h.announce(() => Promise.reject(new Error("no window"))),
    ).rejects.toThrow("no window");
    expect(h.stored()).toBe("[]");
    expect(await h.announce()).toHaveLength(1);
    expect(h.shown).toHaveLength(1);
  });

  it("holds no more than the jobs paused now, and no library data", async () => {
    const h = await setup();
    const first = await pausedJob(h.jobs);
    await h.announce();
    const stored = JSON.parse(h.stored()) as string[];
    expect(stored).toEqual([pausedReportIdentity(first)]);
    expect(h.stored()).not.toContain("COLLKEY1");
    await h.jobs.cancel(first.id);
    await h.announce();
    expect(h.stored()).toBe("[]");
  });

  it("reads a damaged record as nothing shown, and shows the notice", async () => {
    const h = await setup();
    await pausedJob(h.jobs);
    for (const damaged of ["not json", '{"a":1}', "[1,2]"]) {
      h.setStored(damaged);
      expect(await h.announce()).toHaveLength(1);
    }
    expect(h.shown).toHaveLength(3);
  });
});

/** A report job running when recovery runs, with no checkpoint: left waiting. */
async function interruptedJob(jobs: JobQueue): Promise<JobRecord> {
  const record = await jobs.enqueue("trendReport", INPUT);
  await jobs.start(record.id);
  const report = await jobs.recover();
  expect(report.awaitingUserDecision).toContain(record.id);
  return (await jobs.get(record.id)) as JobRecord;
}

describe("P4-T21 — a report job left interrupted waits as a paused one does (item 334(j))", () => {
  it("gets one notice, with only a list of the queue and no record changed", async () => {
    const h = await setup();
    const record = await interruptedJob(h.jobs);
    expect(record.status).toBe("interrupted");
    const before = JSON.stringify(await h.jobs.list());
    expect((await h.announce()).map((r) => r.id)).toEqual([record.id]);
    expect(h.shown).toHaveLength(1);
    expect(h.called).toEqual(["list"]);
    expect(JSON.stringify(await h.jobs.list())).toBe(before);
  });

  it("gets no second notice, also after another recovery leaves it where it was", async () => {
    const h = await setup();
    const record = await interruptedJob(h.jobs);
    await h.announce();
    expect(await h.announce()).toEqual([]);
    await h.jobs.recover();
    expect((await h.jobs.get(record.id))?.status).toBe("interrupted");
    expect(await h.announce()).toEqual([]);
    expect(h.shown).toHaveLength(1);
  });

  it("is announced together with a paused job, once each", async () => {
    const h = await setup();
    const paused = await pausedJob(h.jobs);
    const left = await interruptedJob(h.jobs);
    const announced = await h.announce();
    expect(announced.map((r) => r.id).sort()).toEqual(
      [paused.id, left.id].sort(),
    );
    expect(h.shown).toHaveLength(1);
    expect(await h.announce()).toEqual([]);
  });

  it("leaves another pipeline's interrupted job out", async () => {
    const h = await setup();
    const record = await h.jobs.enqueue("summarize", INPUT);
    await h.jobs.start(record.id);
    await h.jobs.recover();
    expect((await h.jobs.get(record.id))?.status).toBe("interrupted");
    expect(await waitingReportJobs(h.jobs)).toEqual([]);
    expect(await h.announce()).toEqual([]);
  });

  it("continues through paused into running, in its own record", async () => {
    const h = await setup();
    const record = await interruptedJob(h.jobs);
    await expect(h.jobs.start(record.id)).rejects.toThrow();
    const moved = await pausedForAnswer(h.jobs, record);
    expect(moved.id).toBe(record.id);
    expect(moved.status).toBe("paused");
    expect(moved.pauseReason).toBe("user");
    expect((await h.jobs.start(record.id)).status).toBe("running");
  });

  it("leaves a paused job's record as it is on continue, with its reason", async () => {
    const h = await setup();
    const record = await pausedJob(h.jobs);
    expect(await pausedForAnswer(h.jobs, record)).toBe(record);
    expect((await h.jobs.get(record.id))?.pauseReason).toBe("budget-stop");
  });

  it("stops straight to cancelled", async () => {
    const h = await setup();
    const record = await interruptedJob(h.jobs);
    expect((await h.jobs.cancel(record.id)).status).toBe("cancelled");
    expect(await waitingReportJobs(h.jobs)).toEqual([]);
  });
});

describe("P4-T21 — what the notice names", () => {
  const record = (input: unknown): JobRecord =>
    ({ id: "x", input }) as unknown as JobRecord;
  const names: Readonly<Record<string, string>> = {
    "1/A": "Alpha",
    "1/B": "베타",
    "2/A": "Gamma",
  };
  const nameOf = (libraryID: number, key: string): string | undefined =>
    names[`${String(libraryID)}/${key}`];

  it("names each collection once, keeps its name as it is, and counts collections", () => {
    expect(
      pausedReportNoticeArgs(
        [
          record({ libraryID: 1, collectionKey: "A" }),
          record({ libraryID: 1, collectionKey: "B" }),
          record({ libraryID: 1, collectionKey: "A" }),
          record({ libraryID: 2, collectionKey: "A" }),
        ],
        nameOf,
      ),
    ).toEqual({ count: 3, collections: "Alpha, 베타, Gamma" });
  });

  it("leaves out a collection that has gone or an input with no collection; none left means no notice", () => {
    expect(
      pausedReportNoticeArgs(
        [
          record({ libraryID: 1, collectionKey: "GONE" }),
          record({ libraryID: 1, collectionKey: "A" }),
        ],
        nameOf,
      ),
    ).toEqual({ count: 1, collections: "Alpha" });
    expect(
      pausedReportNoticeArgs(
        [record({ libraryID: 1, collectionKey: "GONE" }), record({})],
        nameOf,
      ),
    ).toBeUndefined();
  });
});

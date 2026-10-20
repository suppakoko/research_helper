/**
 * The job queue's persistent half: every job's record, the moves between its
 * states, its checkpoint, and what happens to unfinished jobs at startup
 * (`P3-T34`; `docs/07` §4.5, §7.5, §7.6).
 *
 * ## What this file is, and what it is not yet
 *
 * `docs/07` §4.5 declares a `JobQueue` whose `enqueue` returns a `JobHandle`
 * with a `result` promise — a queue that *runs* pipelines. That half needs the
 * `llm` worker pool (`P3-T17`), the per-job context members (`P3-T35`) and a
 * pipeline to run (`P3-T29`), none of which exist. This file is the half they
 * stand on: the record of each job, kept in the plugin database through the
 * {@link JobStore} port, and changed only through the moves
 * `./jobRecord.ts`'s `JOB_TRANSITIONS` allows. A worker calls {@link JobQueue}
 * to say a job started, paused, made progress, spent money or finished; the
 * queue writes it down.
 *
 * Every write goes through `toJobRow` in `./jobRecord.ts`, which is where the
 * redaction gate runs, and the queue keeps in memory only what that function
 * returned as stored — so a record read from the queue is the record on disk.
 *
 * ## One notification per pause, not per item
 *
 * A 200-item job that loses its key fails 200 times. {@link JobQueue.pause}
 * moves the job to `paused` once and tells the {@link JobNotifier} once; every
 * later `pause()` of a job that is already paused returns the record and
 * notifies nobody.
 *
 * ## Startup: unfinished jobs resume automatically, behind every spend guard
 *
 * `plan/00` §6 item 250 (owner, 2026-10-21) and `docs/07` §7.6: a job left
 * `interrupted` by a quit or a crash resumes on its own at the next start —
 * but only after every guard has passed, and the user is told. The guards are
 * {@link ResumeGuards}; the notice is {@link JobNotifier.resumed}. **When any
 * of the four guards or the notifier is absent, {@link JobQueue.recover}
 * resumes nothing**: the job stays `interrupted`, is reported in
 * {@link RecoveryReport.waitingForGuards}, and is looked at again on the next
 * `recover()`. On 2026-10-21 none of the four exists — `P3-T33` builds the
 * cache, `P3-T15` the egress acknowledgement, `P3-T16` the confirm threshold
 * and the ceilings — so today every resumable job waits.
 */

import { ConfigurationError, type SerializedError } from "../errors";
import type { Clock } from "../clock";
import type { Logger } from "../logger";
import {
  canTransition,
  createJobRecord,
  fromJobRow,
  JobTransitionError,
  transition,
  toJobRow,
  withGatedField,
  type JobPriority,
  type JobProgressRecord,
  type JobRecord,
  type JobResultRef,
  type JobRow,
  type JobStatus,
  type JobUsage,
  type PauseReason,
} from "./jobRecord";

export type { JobStatus } from "./jobRecord";

// ---------------------------------------------------------------------------
// 1. The ports
// ---------------------------------------------------------------------------

/**
 * Where job rows live: `src/zotero/db.ts`'s `createJobStore`, over the one
 * plugin database connection (`docs/07` §8.3). A row is written whole.
 */
export interface JobStore {
  /** Insert the row, or replace the row with the same `id`. */
  put(row: JobRow): Promise<void>;
  /** The row with this id, or `undefined`. */
  get(id: string): Promise<JobRow | undefined>;
  /** Rows in these states (every row when omitted), oldest first. */
  list(statuses?: readonly JobStatus[]): Promise<readonly JobRow[]>;
}

/** What the user is told. Built by the card that owns the surface. */
export interface JobNotifier {
  /**
   * A job moved to `paused`. Called once per pause, never once per item.
   */
  paused(record: JobRecord): void | Promise<void>;
  /**
   * The visible notice that these jobs resumed after a restart (`plan/00` §6
   * item 250), shown **before** they are queued again. Its message is
   * `research-helper-job-resumed` (`L10N_JOB_RESUMED` in `src/i18n/keys.ts`).
   * A notice that throws resumes nothing.
   */
  resumed(records: readonly JobRecord[]): Promise<void>;
}

/** A guard's answer about one resumed job. */
export type ResumeVerdict =
  | { readonly proceed: true }
  | { readonly proceed: false; readonly pauseReason: PauseReason };

/**
 * The spend guards a job must pass before it resumes after a restart
 * (`plan/00` §6 item 250), in the order {@link JobQueue.recover} runs them.
 *
 * Each is filled by the card that builds the guard, at the composition root
 * (`installServices` in `src/bootstrap/container.ts`). A guard must not wait
 * on the user: to ask, it answers `proceed: false` with a reason, and the job
 * waits `paused` for the user's answer. A guard that throws resumes nothing.
 */
export interface ResumeGuards {
  /**
   * `P3-T33`: drop the items the cache already holds from the job's
   * checkpoint, and return the checkpoint to resume from. Runs first, so the
   * guards after it judge only what is left to do.
   */
  skipCached(record: JobRecord): Promise<unknown>;
  /** `P3-T15`: `privacy.egressAcknowledged`. */
  egress(record: JobRecord): Promise<ResumeVerdict>;
  /** `P3-T16`: `summary.confirmAboveCents`, over the remaining estimate. */
  confirm(record: JobRecord): Promise<ResumeVerdict>;
  /**
   * `P3-T16`: `run.maxSpendCents` and `run.maxSessionSpendCents`. Reaching
   * either pauses and asks (`plan/00` §6 item 234), so the answer is
   * `budget-stop`.
   */
  ceilings(record: JobRecord): Promise<ResumeVerdict>;
}

/** The four guards' names, in {@link ResumeGuards}' order. */
export const RESUME_GUARD_NAMES: readonly (keyof ResumeGuards)[] = [
  "skipCached",
  "egress",
  "confirm",
  "ceilings",
];

/** `docs/07` §7.6: the third resume attempt that crashes is the last. */
export const MAX_RESUME_ATTEMPTS = 3;

/** `SerializedError.code` of a job that kept crashing the app (§7.6). */
export const RESUME_LOOP_CODE = "resume-loop";

/** `SerializedError.code` of an interrupted job whose pipeline cannot resume. */
export const NOT_RESUMABLE_CODE = "not-resumable";

/** What {@link JobQueue.recover} did (`docs/07` §4.5, widened). */
export interface RecoveryReport {
  /** Found `running` or `cancelling`: the app died under them. */
  readonly interrupted: readonly string[];
  /** Every guard passed and the notice was shown; now `queued`. */
  readonly autoResumed: readonly string[];
  /** Not resumable automatically: plugin version changed, or no checkpoint. */
  readonly awaitingUserDecision: readonly string[];
  /** Resumable, but a guard or the notifier does not exist yet (item 250). */
  readonly waitingForGuards: readonly string[];
  /** A guard said no; now `paused` with that guard's reason. */
  readonly pausedByGuard: readonly string[];
  /** Moved to `failed`: a resume loop, or a pipeline that cannot resume. */
  readonly failed: readonly string[];
}

/** What {@link JobQueue.enqueue} is told besides the input. */
export interface EnqueueRecordOptions {
  readonly priority?: JobPriority;
  readonly exclusivityKey?: string;
  readonly budgetUsd?: number;
  readonly libraryID?: number;
  readonly inputVersion?: number;
}

/** The persistent half of `docs/07` §4.5's queue. */
export interface JobQueue {
  /**
   * Hand the queue its store. The plugin database opens after
   * `installServices` has run (`src/bootstrap/registerUI.ts`), so the store
   * arrives late; every operation before it throws `ConfigurationError`.
   */
  attachStore(store: JobStore): void;
  /** Forget the store, before its connection closes. */
  detachStore(): void;
  /** Whether a store is attached. */
  readonly attached: boolean;

  /** A new `queued` job. */
  enqueue(
    pipelineId: string,
    input: unknown,
    options?: EnqueueRecordOptions,
  ): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | undefined>;
  list(filter?: {
    readonly status?: readonly JobStatus[];
  }): Promise<readonly JobRecord[]>;

  /** `queued` → `running`. */
  start(jobId: string): Promise<JobRecord>;
  /**
   * → `paused` with `reason`, and one notification. A job already `paused`
   * is returned unchanged and nobody is notified again.
   */
  pause(jobId: string, reason: PauseReason): Promise<JobRecord>;
  /** `paused` → `running`, within the session. */
  resume(jobId: string): Promise<JobRecord>;
  /**
   * Stop a job. `running` goes to `cancelling` (in-flight calls finish, then
   * {@link finishCancel}); a job with nothing in flight goes to `cancelled`.
   * Nothing already done is rolled back: progress, usage and the checkpoint
   * stay as they were.
   */
  cancel(jobId: string): Promise<JobRecord>;
  /** `cancelling` → `cancelled`. */
  finishCancel(jobId: string): Promise<JobRecord>;
  /** `running` → `succeeded`. */
  succeed(jobId: string, resultRef?: JobResultRef): Promise<JobRecord>;
  /** `running` → `failed`, with the error through the gate. */
  fail(jobId: string, error: SerializedError): Promise<JobRecord>;

  /** Replace the job's progress (through the gate). */
  reportProgress(
    jobId: string,
    progress: JobProgressRecord,
  ): Promise<JobRecord>;
  /** Add one call's usage to the job's total (through the gate). */
  addUsage(jobId: string, usage: JobUsage): Promise<JobRecord>;
  /** Append a warning (through the gate). */
  addWarning(jobId: string, warning: string): Promise<JobRecord>;

  /** Write the job's checkpoint. `src/pipeline/shared/checkpoint.ts` throttles. */
  writeCheckpoint(jobId: string, state: unknown): Promise<JobRecord>;
  /** The job's last checkpoint, or `undefined`. */
  readCheckpoint(jobId: string): Promise<unknown>;

  /** `docs/07` §7.6's startup recovery, as decided 2026-10-21. */
  recover(): Promise<RecoveryReport>;
  /**
   * What automatic resumption is still waiting for: the names of the absent
   * {@link ResumeGuards} members, then `"notifier"` if there is none. Empty
   * means `recover()` may resume.
   */
  missingResumePrerequisites(): readonly string[];
}

/** What {@link createJobQueue} is built from. */
export interface JobQueueDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  /** `package.json`'s version: a job made by another version is not resumed. */
  readonly pluginVersion: string;
  /** Whether a pipeline's checkpointed job can resume (`Pipeline.resumable`). */
  readonly isResumable: (pipelineId: string) => boolean;
  /** The guards that exist so far; an absent one holds resumption back. */
  readonly resumeGuards?: Partial<ResumeGuards>;
  /** The notices; absent holds resumption back and drops pause notices. */
  readonly notifier?: JobNotifier;
  /** Job ids. Defaults to a random UUID (`docs/07` §5.2). */
  readonly newId?: () => string;
}

// ---------------------------------------------------------------------------
// 2. The queue
// ---------------------------------------------------------------------------

/** A random UUID: `crypto` is in the sandbox (`docs/01` §2.3) and in Node. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Build the queue. `installServices` calls this once; `registerUI.ts`
 * attaches the store when the plugin database is open.
 */
export function createJobQueue(deps: JobQueueDeps): JobQueue {
  const newId = deps.newId ?? randomUuid;
  let store: JobStore | undefined;
  // Every operation is a read-modify-write of one row, so they run one at a
  // time: a progress write racing a pause would otherwise lose one of them.
  let tail: Promise<unknown> = Promise.resolve();

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };

  const requireStore = (): JobStore => {
    if (store === undefined) {
      throw new ConfigurationError(
        "[research-helper] the job queue has no store: the plugin database " +
          "is not open (yet, or any more).",
      );
    }
    return store;
  };

  const save = async (record: JobRecord): Promise<JobRecord> => {
    const stored = toJobRow(record);
    await requireStore().put(stored.row);
    return stored.record;
  };

  const load = async (jobId: string): Promise<JobRecord> => {
    const row = await requireStore().get(jobId);
    if (row === undefined) {
      throw new ConfigurationError(`[research-helper] no job ${jobId}.`);
    }
    return fromJobRow(row);
  };

  const update = (
    jobId: string,
    change: (record: JobRecord, now: number) => JobRecord,
  ): Promise<JobRecord> =>
    serial(async () => save(change(await load(jobId), deps.clock.now())));

  const notifyPaused = async (record: JobRecord): Promise<void> => {
    if (deps.notifier === undefined) {
      deps.logger.info("a job paused; no notifier is attached", {
        jobId: record.id,
        reason: record.pauseReason,
      });
      return;
    }
    try {
      await deps.notifier.paused(record);
    } catch (error) {
      deps.logger.warn("the pause notice failed", {
        jobId: record.id,
        reason: error instanceof Error ? error.name : typeof error,
      });
    }
  };

  const missingResumePrerequisites = (): readonly string[] => {
    const guards = deps.resumeGuards ?? {};
    const missing: string[] = RESUME_GUARD_NAMES.filter(
      (name) => guards[name] === undefined,
    );
    if (deps.notifier === undefined) missing.push("notifier");
    return missing;
  };

  const failed = (
    record: JobRecord,
    now: number,
    code: string,
    detail: string,
  ): JobRecord =>
    transition(
      withGatedField(record, "error", {
        code,
        // No message names this failure yet; the surface that lists
        // interrupted jobs adds one (see the P3-T34 report).
        messageKey: "rh-error-configuration",
        detail,
        retryable: false,
      }),
      "failed",
      now,
    );

  /**
   * Run the guards over one resumable job. Resolves to the record to queue
   * (its checkpoint already cut by `skipCached`), or to a pause reason.
   */
  const runGuards = async (
    guards: ResumeGuards,
    record: JobRecord,
    now: number,
  ): Promise<
    | { readonly kind: "pass"; readonly record: JobRecord }
    | { readonly kind: "pause"; readonly reason: PauseReason }
  > => {
    const checkpoint = await guards.skipCached(record);
    const cut: JobRecord = {
      ...record,
      checkpoint,
      checkpointAtEpochMs: now,
    };
    for (const guard of [guards.egress, guards.confirm, guards.ceilings]) {
      const verdict = await guard(cut);
      if (!verdict.proceed)
        return { kind: "pause", reason: verdict.pauseReason };
    }
    return { kind: "pass", record: cut };
  };

  const recover = async (): Promise<RecoveryReport> => {
    const now = deps.clock.now();
    const report = {
      interrupted: [] as string[],
      autoResumed: [] as string[],
      awaitingUserDecision: [] as string[],
      waitingForGuards: [] as string[],
      pausedByGuard: [] as string[],
      failed: [] as string[],
    };

    // The crash path: nothing ran a shutdown hook under these.
    for (const row of await requireStore().list(["running", "cancelling"])) {
      await save(transition(fromJobRow(row), "interrupted", now));
      report.interrupted.push(row.id);
    }

    const candidates: JobRecord[] = [];
    for (const row of await requireStore().list(["interrupted"])) {
      const record = fromJobRow(row);
      if (record.attemptCount >= MAX_RESUME_ATTEMPTS) {
        await save(
          failed(
            record,
            now,
            RESUME_LOOP_CODE,
            `interrupted ${String(record.attemptCount)} times; not resumed again`,
          ),
        );
        report.failed.push(record.id);
      } else if (!deps.isResumable(record.pipelineId)) {
        await save(
          failed(
            record,
            now,
            NOT_RESUMABLE_CODE,
            `pipeline ${record.pipelineId} cannot resume after a restart`,
          ),
        );
        report.failed.push(record.id);
      } else if (
        record.createdByPluginVersion !== deps.pluginVersion ||
        record.checkpoint === undefined
      ) {
        report.awaitingUserDecision.push(record.id);
      } else {
        candidates.push(record);
      }
    }

    const missing = missingResumePrerequisites();
    const guards = deps.resumeGuards;
    const notifier = deps.notifier;
    if (
      missing.length > 0 ||
      guards === undefined ||
      notifier === undefined ||
      !isComplete(guards)
    ) {
      report.waitingForGuards.push(...candidates.map((record) => record.id));
      if (candidates.length > 0) {
        deps.logger.info("interrupted jobs wait: a resume guard is missing", {
          jobs: candidates.length,
          missing: missing.join(","),
        });
      }
      return report;
    }

    const passed: JobRecord[] = [];
    for (const record of candidates) {
      try {
        const outcome = await runGuards(guards, record, now);
        if (outcome.kind === "pause") {
          const paused = await save(
            transition(record, "paused", now, outcome.reason),
          );
          report.pausedByGuard.push(record.id);
          await notifyPaused(paused);
        } else {
          passed.push(outcome.record);
        }
      } catch (error) {
        report.waitingForGuards.push(record.id);
        deps.logger.warn("a resume guard failed; the job waits", {
          jobId: record.id,
          reason: error instanceof Error ? error.name : typeof error,
        });
      }
    }
    if (passed.length === 0) return report;

    try {
      await notifier.resumed(passed);
    } catch (error) {
      report.waitingForGuards.push(...passed.map((record) => record.id));
      deps.logger.warn("the resume notice failed; nothing resumed", {
        jobs: passed.length,
        reason: error instanceof Error ? error.name : typeof error,
      });
      return report;
    }
    for (const record of passed) {
      await save({
        ...transition(record, "queued", now),
        attemptCount: record.attemptCount + 1,
      });
      report.autoResumed.push(record.id);
    }
    return report;
  };

  return {
    attachStore(next: JobStore): void {
      store = next;
    },
    detachStore(): void {
      store = undefined;
    },
    get attached(): boolean {
      return store !== undefined;
    },

    enqueue(pipelineId, input, options = {}) {
      return serial(async () =>
        save(
          createJobRecord({
            id: newId(),
            pipelineId,
            input,
            createdAtEpochMs: deps.clock.now(),
            createdByPluginVersion: deps.pluginVersion,
            ...(options.priority !== undefined && {
              priority: options.priority,
            }),
            ...(options.exclusivityKey !== undefined && {
              exclusivityKey: options.exclusivityKey,
            }),
            ...(options.budgetUsd !== undefined && {
              budgetUsd: options.budgetUsd,
            }),
            ...(options.libraryID !== undefined && {
              libraryID: options.libraryID,
            }),
            ...(options.inputVersion !== undefined && {
              inputVersion: options.inputVersion,
            }),
          }),
        ),
      );
    },

    get(jobId) {
      return serial(async () => {
        const row = await requireStore().get(jobId);
        return row === undefined ? undefined : fromJobRow(row);
      });
    },

    list(filter = {}) {
      return serial(async () =>
        (await requireStore().list(filter.status)).map(fromJobRow),
      );
    },

    start(jobId) {
      return update(jobId, (record, now) => transition(record, "running", now));
    },

    pause(jobId, reason) {
      return serial(async () => {
        const record = await load(jobId);
        if (record.status === "paused") return record;
        const paused = await save(
          transition(record, "paused", deps.clock.now(), reason),
        );
        await notifyPaused(paused);
        return paused;
      });
    },

    resume(jobId) {
      return update(jobId, (record, now) => {
        // Only a paused job resumes; a queued one is started, not resumed.
        if (record.status !== "paused") {
          throw new JobTransitionError(record.id, record.status, "running");
        }
        return transition(record, "running", now);
      });
    },

    cancel(jobId) {
      return update(jobId, (record, now) =>
        transition(
          record,
          canTransition(record.status, "cancelling")
            ? "cancelling"
            : "cancelled",
          now,
        ),
      );
    },

    finishCancel(jobId) {
      return update(jobId, (record, now) =>
        transition(record, "cancelled", now),
      );
    },

    succeed(jobId, resultRef) {
      return update(jobId, (record, now) =>
        transition(
          resultRef === undefined ? record : { ...record, resultRef },
          "succeeded",
          now,
        ),
      );
    },

    fail(jobId, error) {
      return update(jobId, (record, now) =>
        transition(withGatedField(record, "error", error), "failed", now),
      );
    },

    reportProgress(jobId, progress) {
      return update(jobId, (record) =>
        withGatedField(record, "progress", progress),
      );
    },

    addUsage(jobId, usage) {
      // A running total, not a replacement: the earlier mark still describes
      // what the total was built from, so it is kept (`toJobRow` replaces it
      // only when this pass changes something).
      return update(jobId, (record) => ({
        ...record,
        usage: {
          inputTokens: record.usage.inputTokens + usage.inputTokens,
          outputTokens: record.usage.outputTokens + usage.outputTokens,
          costUsd: record.usage.costUsd + usage.costUsd,
        },
      }));
    },

    addWarning(jobId, warning) {
      // Appended, so the earlier warnings' mark is kept, as for usage.
      return update(jobId, (record) => ({
        ...record,
        warnings: [...record.warnings, warning],
      }));
    },

    writeCheckpoint(jobId, state) {
      return update(jobId, (record, now) => ({
        ...record,
        checkpoint: state,
        checkpointAtEpochMs: now,
      }));
    },

    readCheckpoint(jobId) {
      return serial(async () => (await load(jobId)).checkpoint);
    },

    recover() {
      return serial(recover);
    },

    missingResumePrerequisites,
  };
}

/** Whether every {@link ResumeGuards} member is present. */
function isComplete(guards: Partial<ResumeGuards>): guards is ResumeGuards {
  return RESUME_GUARD_NAMES.every((name) => guards[name] !== undefined);
}

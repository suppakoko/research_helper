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
 *
 * ## Running jobs (`P3-T17`; `docs/07` §7.2, §7.4, §7.5)
 *
 * Section 3 below is what runs a job's LLM calls: the `llm` pool
 * ({@link createLlmPool}), job-level admission ({@link createJobAdmission}),
 * the work keys every live job pins in the cache ({@link createRunningWork})
 * and the item runner ({@link runPooledItems}). The runner moves the job
 * through the states above — `pause`, `resume`, `cancel`, `finishCancel` — and
 * keeps no state machine of its own. It does not touch {@link ResumeGuards}:
 * resumption after a restart still waits on every guard (`plan/00` §6 item
 * 250). The caller that builds jobs from these pieces is the summarize
 * pipeline (`P3-T29`), from `buildPipelineSet` in
 * `src/bootstrap/registerPipelines.ts`, where the pool and the admission are
 * built.
 */

import {
  createDeferred,
  Semaphore,
  type Deferred,
  type SemaphoreRelease,
} from "../concurrency";
import {
  ConfigurationError,
  ResearchHelperError,
  type SerializedError,
} from "../errors";
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
import {
  createLinkedCancellationTokenSource,
  type CancellationReason,
  type CancellationToken,
  type CancellationTokenSource,
} from "./cancellation";

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
   * Hand the queue its store. The plugin database's migrations finish after
   * `installServices` has returned (`src/bootstrap/pluginDatabase.ts`,
   * `P3-T33`), so the store arrives late; every operation before it throws
   * `ConfigurationError`.
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
 * Build the queue. `installServices` calls this once, and attaches the store
 * through `installPluginDatabase` once the plugin database is open (`P3-T33`).
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

// ---------------------------------------------------------------------------
// 3. Running jobs: the `llm` pool, admission, pinned work, the item runner
//    (`P3-T17`; `docs/07` §7.2, §7.4, §7.5 and its note "Built 2026-10-21")
// ---------------------------------------------------------------------------

/** `docs/07` §7.2 and §8.5: the `llm` pool is "user-configurable 1-8". */
export const LLM_POOL_MIN = 1;
/** See {@link LLM_POOL_MIN}. */
export const LLM_POOL_MAX = 8;

/**
 * The `concurrency` preference as a pool size: truncated to an integer and
 * clamped to {@link LLM_POOL_MIN}–{@link LLM_POOL_MAX}. The preference reader
 * already falls back to the default for an out-of-range value; this is the
 * pool's own guard, so no reader can hand the `Semaphore` a size it refuses.
 * A value that is not a finite number gives the smallest pool.
 */
export function clampLlmPoolSize(value: number): number {
  if (!Number.isFinite(value)) return LLM_POOL_MIN;
  return Math.min(LLM_POOL_MAX, Math.max(LLM_POOL_MIN, Math.trunc(value)));
}

/**
 * `docs/07` §7.2's `llm` worker pool: one per plugin lifetime, shared by every
 * job that calls an LLM.
 *
 * It bounds this plugin's LLM work, not one host's: §7.3's LLM rows allow at
 * most 3 requests in flight per host whatever the pool's size, so with
 * `concurrency` above 3 the extra permit holders wait in that host's limiter.
 */
export interface LlmPool {
  /** The current size: `concurrency`, clamped. */
  readonly size: number;
  /** Permits held now. */
  readonly inFlight: number;
  /**
   * Take a permit, re-reading `concurrency` first. Rejects with
   * `OperationCancelledError` when `token` is cancelled while waiting.
   *
   * @returns the release; call it once the call has settled
   */
  acquire(token?: CancellationToken): Promise<SemaphoreRelease>;
}

/**
 * Build the `llm` pool. `buildPipelineSet` in
 * `src/bootstrap/registerPipelines.ts` calls this once, with
 * `getPref("concurrency")`.
 *
 * The size is re-read before every permit is taken, so a change in the
 * preferences pane applies to the next dispatch. A smaller size drains
 * (`Semaphore.resize`): no call already running is interrupted.
 *
 * @param readConcurrency - the `concurrency` preference, read on demand
 */
export function createLlmPool(readConcurrency: () => number): LlmPool {
  const semaphore = new Semaphore(clampLlmPoolSize(readConcurrency()));
  return {
    get size(): number {
      return semaphore.permits;
    },
    get inFlight(): number {
      return semaphore.permits - semaphore.available;
    },
    acquire(token?: CancellationToken): Promise<SemaphoreRelease> {
      semaphore.resize(clampLlmPoolSize(readConcurrency()));
      return semaphore.acquire(token);
    },
  };
}

/**
 * `docs/07` §7.2's job-level concurrency: at most one `interactive` job and
 * two `background` jobs run at once. §5.2's `normal` priority is not named by
 * §7.2; it shares the `background` slots ({@link admissionClassOf}).
 */
export const JOB_CONCURRENCY_LIMITS: Readonly<{
  readonly interactive: number;
  readonly background: number;
}> = Object.freeze({ interactive: 1, background: 2 });

/** Which slots a job takes. */
export type JobAdmissionClass = keyof typeof JOB_CONCURRENCY_LIMITS;

/** `interactive` takes the interactive slot; `normal` and `background` share the rest. */
export function admissionClassOf(priority: JobPriority): JobAdmissionClass {
  return priority === "interactive" ? "interactive" : "background";
}

/** One admitted job's hold on its slot and its `exclusivityKey`. */
export interface JobTicket {
  /**
   * The job paused: give the slot back and keep the key (`docs/07` §7.5, "a
   * paused job holds its `exclusivityKey`"). Idempotent.
   */
  suspend(): void;
  /** Take a slot again before resuming. Cancellable; a no-op while holding one. */
  reacquire(token?: CancellationToken): Promise<void>;
  /** The job ended: give the slot and the key back. Idempotent. */
  release(): void;
}

/** Admission of jobs into §7.2's job-level slots. */
export interface JobAdmission {
  /**
   * Wait for the job's `exclusivityKey` (when it has one), then for a slot of
   * its class. Rejects with `OperationCancelledError` when `token` is
   * cancelled while waiting, holding nothing.
   */
  admit(
    job: Pick<JobRecord, "id" | "priority" | "exclusivityKey">,
    token?: CancellationToken,
  ): Promise<JobTicket>;
  /** Slots held now, per class. */
  readonly running: Readonly<Record<JobAdmissionClass, number>>;
  /** Exclusivity keys held now, by running or paused jobs. */
  readonly heldKeys: readonly string[];
}

/**
 * Build the job admission. One per plugin lifetime, beside the pools in
 * `buildPipelineSet`; the job runner (`P3-T29`, `P3-T35`) admits each job
 * before it starts and releases it when the job ends.
 *
 * The key is taken before the slot, so a job waiting for a collection another
 * job holds does not sit on a slot meanwhile. Both waits are first in, first
 * out (`Semaphore`).
 */
export function createJobAdmission(
  limits: Readonly<Record<JobAdmissionClass, number>> = JOB_CONCURRENCY_LIMITS,
): JobAdmission {
  const slots: Record<JobAdmissionClass, Semaphore> = {
    interactive: new Semaphore(limits.interactive),
    background: new Semaphore(limits.background),
  };
  const keys = new Map<string, Semaphore>();

  const keyLock = (key: string): Semaphore => {
    let lock = keys.get(key);
    if (lock === undefined) {
      lock = new Semaphore(1);
      keys.set(key, lock);
    }
    return lock;
  };
  const forgetIdle = (key: string): void => {
    const lock = keys.get(key);
    if (lock !== undefined && lock.available === 1 && lock.waiting === 0) {
      keys.delete(key);
    }
  };

  return {
    async admit(job, token): Promise<JobTicket> {
      const slotsOfClass = slots[admissionClassOf(job.priority)];
      const key = job.exclusivityKey;
      let releaseKey: SemaphoreRelease | undefined;
      if (key !== undefined) releaseKey = await keyLock(key).acquire(token);
      let releaseSlot: SemaphoreRelease | undefined;
      try {
        releaseSlot = await slotsOfClass.acquire(token);
      } catch (error) {
        releaseKey?.();
        if (key !== undefined) forgetIdle(key);
        throw error;
      }
      let ended = false;
      return {
        suspend(): void {
          releaseSlot?.();
          releaseSlot = undefined;
        },
        async reacquire(waitToken?: CancellationToken): Promise<void> {
          if (ended || releaseSlot !== undefined) return;
          const release = await slotsOfClass.acquire(waitToken);
          // Released while this waited: give the slot straight back.
          if (ended || releaseSlot !== undefined) {
            release();
            return;
          }
          releaseSlot = release;
        },
        release(): void {
          if (ended) return;
          ended = true;
          releaseSlot?.();
          releaseSlot = undefined;
          releaseKey?.();
          if (key !== undefined) forgetIdle(key);
        },
      };
    },
    get running(): Readonly<Record<JobAdmissionClass, number>> {
      return {
        interactive: limits.interactive - slots.interactive.available,
        background: limits.background - slots.background.available,
      };
    },
    get heldKeys(): readonly string[] {
      return [...keys.entries()]
        .filter(([, lock]) => lock.available === 0)
        .map(([key]) => key);
    },
  };
}

/** `docs/07` §9.3: the tag every cache entry of one work carries. */
export const WORK_TAG_PREFIX = "work:";

/**
 * The work keys of every live run, for the cache's `pinnedTags` hook
 * (`docs/07` §9.4 step 4: never evict a running job's entries).
 */
export interface RunningWork {
  /**
   * Pin these work keys while the job is live, completed ones included: a
   * paused or cancelled-then-re-run job resumes by finding them in the cache.
   *
   * @returns the release; idempotent
   */
  hold(jobId: string, workKeys: readonly string[]): () => void;
  /** `work:<workKey>` for every held key, each once. */
  pinnedTags(): readonly string[];
}

/**
 * Build the registry. `installServices` builds one, passes its
 * {@link RunningWork.pinnedTags} to the cache (`installPluginDatabase`), and
 * hands it to `registerPipelines`; {@link runPooledItems} holds a run's keys
 * for as long as the run lives.
 */
export function createRunningWork(): RunningWork {
  const holds = new Map<symbol, readonly string[]>();
  return {
    hold(jobId: string, workKeys: readonly string[]): () => void {
      const id = Symbol(jobId);
      holds.set(id, [...workKeys]);
      return () => {
        holds.delete(id);
      };
    },
    pinnedTags: (): readonly string[] => {
      const tags = new Set<string>();
      for (const workKeys of holds.values()) {
        for (const key of workKeys) tags.add(`${WORK_TAG_PREFIX}${key}`);
      }
      return [...tags];
    },
  };
}

/**
 * The checkpoint the runner writes. A pipeline's own checkpoint (`docs/07`
 * §7.6's `SummarizeCheckpoint`) carries these three lists; the runner hands
 * them over and the pipeline adds its stage and usage.
 */
export interface PooledCheckpointState {
  readonly version: 1;
  readonly completed: readonly string[];
  readonly failed: readonly {
    readonly workKey: string;
    readonly code: string;
  }[];
  readonly pending: readonly string[];
}

/**
 * Where the runner writes checkpoints: structurally
 * `src/pipeline/shared/checkpoint.ts`'s `CheckpointWriter`, which throttles to
 * one write per 2 s and writes a `boundary` at once.
 */
export interface PooledCheckpointSink {
  checkpoint(
    state: unknown,
    options?: { readonly boundary?: boolean },
  ): Promise<void>;
}

/** Why a run stopped dispatching. A result, not a job state. */
export type PooledRunStop = "finished" | "cancelled" | "budget-elapsed";

/** What a run did. */
export interface PooledRunOutcome {
  readonly stop: PooledRunStop;
  readonly total: number;
  /** Results returned and handed to `onResult` in this run. */
  readonly completed: number;
  /** Items the caller reported already done (cache hits); never dispatched. */
  readonly skipped: number;
  readonly failed: readonly {
    readonly workKey: string;
    readonly code: string;
  }[];
  /** Calls started in this run. */
  readonly dispatched: number;
  /**
   * 1-based position the run stopped at, `settled + 1` (settled = completed,
   * skipped and failed); `undefined` when it finished. "cancelled at 87/200"
   * is `stoppedAt` 87 of `total` 200.
   */
  readonly stoppedAt: number | undefined;
}

/** The handle on one run: `docs/07` §4.5's `JobHandle` controls, for one stage. */
export interface PooledRun {
  readonly result: Promise<PooledRunOutcome>;
  /**
   * Stop dispatching; this job's in-flight calls finish; a boundary
   * checkpoint is written; the admission slot is given back; the job moves to
   * `paused` with `reason` (one notice, `JobQueue.pause`). Resolves once
   * paused, or when the request is withdrawn by {@link resume} or the run
   * ends first.
   */
  pause(reason?: PauseReason): Promise<void>;
  /** Take a slot again, move the job back to `running`, continue. */
  resume(): Promise<void>;
  /**
   * Cancel at once: the run's token fires (in-flight HTTP requests abort,
   * waits for a permit or a host's bucket stop), the job moves to
   * `cancelling`, every result already returned is kept, and the job moves to
   * `cancelled` once nothing is in flight. Resolves when the run has stopped.
   */
  cancel(reason?: CancellationReason): Promise<void>;
}

/** What {@link runPooledItems} runs, and over what. */
export interface PooledRunDeps<T, R> {
  readonly jobId: string;
  /** The items, in order. Their work keys are unique. */
  readonly items: readonly T[];
  readonly workKey: (item: T) => string;
  /**
   * Whether the item's result is already stored — a cache hit. Such an item
   * is skipped, never dispatched: this is how a re-run resumes. A probe that
   * throws counts as "not done".
   */
  readonly isDone: (item: T) => Promise<boolean>;
  /** The item's LLM call, given the run's token. Runs under a pool permit. */
  readonly call: (item: T, token: CancellationToken) => Promise<R>;
  /**
   * Persist one result as it arrives (cache, note). Never rolled back; a
   * result that arrives after a cancel is kept too. A throw fails the item.
   */
  readonly onResult: (item: T, result: R) => Promise<void>;
  readonly pool: LlmPool;
  readonly queue: Pick<
    JobQueue,
    "pause" | "resume" | "cancel" | "finishCancel"
  >;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * The job's token (`ctx.token`). Its cancellation stops the run as
   * {@link PooledRun.cancel} does but moves no job state: the job's owner
   * decides (a shutdown leaves it for `recover()`).
   */
  readonly token?: CancellationToken;
  readonly checkpoint?: PooledCheckpointSink;
  /** The job's admission; suspended while paused. Released by the job's owner. */
  readonly ticket?: JobTicket;
  /** Pins the run's work keys in the cache while it lives. */
  readonly runningWork?: RunningWork;
  /**
   * `docs/03` §11.6's batch wall-clock budget: once this much time has been
   * spent running (paused time excluded), nothing more is dispatched and the
   * run stops with `budget-elapsed`. **No number is decided** (`plan/00` §6
   * item 240 left §11.6's "e.g. 30 min" to `P3-T17`, and nothing decided it),
   * so nothing passes one yet; absent, there is no budget.
   */
  readonly wallClockBudgetMs?: number;
}

/** The `code` a failed item is recorded with. */
function failureCode(error: unknown): string {
  return error instanceof ResearchHelperError ? error.code : "UNKNOWN";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Developer-facing one-liner for the log: "cancelled at 87/200", "finished
 * 200/200", "budget elapsed at 120/200". Not a user-visible string.
 */
export function describePooledOutcome(outcome: PooledRunOutcome): string {
  const total = String(outcome.total);
  const at = String(outcome.stoppedAt);
  switch (outcome.stop) {
    case "finished":
      return `finished ${String(outcome.completed + outcome.skipped)}/${total}`;
    case "cancelled":
      return `cancelled at ${at}/${total}`;
    case "budget-elapsed":
      return `budget elapsed at ${at}/${total}`;
  }
}

/**
 * Run one job's LLM calls under the `llm` pool (`P3-T17`).
 *
 * Items are dispatched in order, one at a time, each only once it holds a
 * pool permit; there is no `Promise.all` over the items. Before each dispatch
 * the runner checks, in this order: a pause request, the token (`docs/07`
 * §7.4 point 1), the wall-clock budget, and whether the item is already done.
 * A wait for a permit is cancellable and is interrupted by a pause request
 * (point 2 one layer up; `RateLimiter.acquire` inside a call is point 2
 * itself, through the token the call is given).
 *
 * The job must be `running` when the run starts (`JobQueue.start`). The run
 * moves it to `paused` and back, and on {@link PooledRun.cancel} to
 * `cancelling` and `cancelled`; it never moves it to `succeeded` or `failed`,
 * which are the pipeline's, after its later stages.
 *
 * A per-item error is recorded in `failed` and the run continues (`docs/07`
 * §12.3's `ItemFailed`); the 30 % stop is the pipeline's policy over these
 * counts. A call that rejects after this run was cancelled is neither done
 * nor failed: a re-run dispatches it again.
 */
export function runPooledItems<T, R>(deps: PooledRunDeps<T, R>): PooledRun {
  const { jobId } = deps;
  const run = createLinkedCancellationTokenSource(deps.token);
  const token = run.token;
  const keys = deps.items.map(deps.workKey);
  const releaseHold = deps.runningWork?.hold(jobId, keys);

  const completed: string[] = [];
  const failed: { readonly workKey: string; readonly code: string }[] = [];
  const settled = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  let skipped = 0;
  let dispatched = 0;
  let finished = false;

  let pauseRequest:
    { readonly reason: PauseReason; readonly done: Deferred<void> } | undefined;
  let resumeGate: Deferred<void> | undefined;
  let resumed: Deferred<void> | undefined;
  let permitWait: CancellationTokenSource | undefined;
  let cancelling: Promise<JobRecord | undefined> | undefined;
  let activeMs = 0;
  let activeSince = deps.clock.now();

  const state = (): PooledCheckpointState => ({
    version: 1,
    completed: [...completed],
    failed: [...failed],
    pending: keys.filter((key) => !settled.has(key)),
  });

  const writeCheckpoint = async (boundary: boolean): Promise<void> => {
    if (deps.checkpoint === undefined) return;
    try {
      await deps.checkpoint.checkpoint(state(), { boundary });
    } catch (error) {
      deps.logger.warn("the llm pool's checkpoint write failed", {
        jobId,
        reason: reasonOf(error),
      });
    }
  };

  const recordFailure = (key: string, error: unknown): void => {
    failed.push({ workKey: key, code: failureCode(error) });
    settled.add(key);
  };

  const settle = async (
    item: T,
    key: string,
    releasePermit: SemaphoreRelease,
  ): Promise<void> => {
    let outcome:
      | { readonly ok: true; readonly value: R }
      | { readonly ok: false; readonly error: unknown };
    try {
      outcome = { ok: true, value: await deps.call(item, token) };
    } catch (error) {
      outcome = { ok: false, error };
    } finally {
      releasePermit();
    }
    if (outcome.ok) {
      try {
        await deps.onResult(item, outcome.value);
        completed.push(key);
        settled.add(key);
      } catch (error) {
        recordFailure(key, error);
      }
    } else if (!token.isCancellationRequested) {
      recordFailure(key, outcome.error);
    }
    await writeCheckpoint(false);
  };

  const drain = async (): Promise<void> => {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
  };

  const isDone = async (item: T): Promise<boolean> => {
    try {
      return await deps.isDone(item);
    } catch (error) {
      deps.logger.warn("a done-probe failed; the item is dispatched", {
        jobId,
        reason: reasonOf(error),
      });
      return false;
    }
  };

  const budgetElapsed = (): boolean =>
    deps.wallClockBudgetMs !== undefined &&
    activeMs + (deps.clock.now() - activeSince) >= deps.wallClockBudgetMs;

  /** Honour a pause request: drain, checkpoint, `paused`, wait, `running`. */
  const pausePoint = async (): Promise<void> => {
    while (pauseRequest !== undefined && !token.isCancellationRequested) {
      const request = pauseRequest;
      await drain();
      if (token.isCancellationRequested) return;
      // Withdrawn by resume() while this job's calls were finishing.
      if (pauseRequest !== request) continue;
      await writeCheckpoint(true);
      if (token.isCancellationRequested) return;
      activeMs += deps.clock.now() - activeSince;
      deps.ticket?.suspend();
      const gate = createDeferred<void>();
      resumeGate = gate;
      const stopWaiting = token.onCancelled(() => {
        gate.resolve();
      });
      await deps.queue.pause(jobId, request.reason);
      pauseRequest = undefined;
      request.done.resolve();
      await gate.promise;
      stopWaiting();
      resumeGate = undefined;
      if (token.isCancellationRequested) return;
      try {
        await deps.ticket?.reacquire(token);
      } catch (error) {
        if (token.isCancellationRequested) return;
        throw error;
      }
      if (token.isCancellationRequested) return;
      await deps.queue.resume(jobId);
      activeSince = deps.clock.now();
      resumed?.resolve();
      resumed = undefined;
    }
  };

  const dispatchAll = async (): Promise<PooledRunStop> => {
    let index = 0;
    while (index < deps.items.length) {
      await pausePoint();
      if (token.isCancellationRequested) return "cancelled";
      if (budgetElapsed()) return "budget-elapsed";
      const item = deps.items[index] as T;
      const key = keys[index] as string;
      if (settled.has(key)) {
        index += 1;
        continue;
      }
      if (await isDone(item)) {
        skipped += 1;
        settled.add(key);
        index += 1;
        continue;
      }
      if (pauseRequest !== undefined) continue;
      if (token.isCancellationRequested) return "cancelled";

      const wait = createLinkedCancellationTokenSource(token);
      permitWait = wait;
      let releasePermit: SemaphoreRelease;
      try {
        releasePermit = await deps.pool.acquire(wait.token);
      } catch (error) {
        if (token.isCancellationRequested) return "cancelled";
        // Interrupted by a pause request, which a resume() may already have
        // withdrawn: either way, back to the pause point and this item.
        if (wait.token.isCancellationRequested) continue;
        throw error;
      } finally {
        permitWait = undefined;
        wait.dispose();
      }
      // A pause or a cancel that arrived while the permit was granted wins.
      if (token.isCancellationRequested || pauseRequest !== undefined) {
        releasePermit();
        continue;
      }
      dispatched += 1;
      const task = settle(item, key, releasePermit);
      inFlight.add(task);
      const forget = (): void => {
        inFlight.delete(task);
      };
      task.then(forget, forget);
      index += 1;
    }
    return "finished";
  };

  const finish = (): void => {
    finished = true;
    releaseHold?.();
    run.dispose();
    pauseRequest?.done.resolve();
    pauseRequest = undefined;
    resumed?.resolve();
    resumed = undefined;
  };

  const result = (async (): Promise<PooledRunOutcome> => {
    try {
      let stop: PooledRunStop;
      try {
        stop = await dispatchAll();
      } finally {
        await drain();
      }
      // Cancelled after the last dispatch: the aborted tail is not done.
      if (token.isCancellationRequested && settled.size < new Set(keys).size) {
        stop = "cancelled";
      }
      await writeCheckpoint(true);
      if (cancelling !== undefined) {
        const record = await cancelling;
        if (record?.status === "cancelling") {
          await deps.queue.finishCancel(jobId);
        }
      }
      const outcome: PooledRunOutcome = {
        stop,
        total: deps.items.length,
        completed: completed.length,
        skipped,
        failed: [...failed],
        dispatched,
        stoppedAt: stop === "finished" ? undefined : settled.size + 1,
      };
      deps.logger.info("llm pool run stopped", {
        jobId,
        outcome: describePooledOutcome(outcome),
        dispatched,
        failed: failed.length,
      });
      return outcome;
    } finally {
      finish();
    }
  })();

  return {
    result,
    pause(reason: PauseReason = "user"): Promise<void> {
      if (finished || resumeGate !== undefined) return Promise.resolve();
      if (pauseRequest === undefined) {
        pauseRequest = { reason, done: createDeferred<void>() };
        // A wait for a permit, possibly behind another job's calls, must not
        // hold the pause up.
        permitWait?.cancel({ kind: "user" });
      }
      return pauseRequest.done.promise;
    },
    resume(): Promise<void> {
      if (finished) return Promise.resolve();
      if (resumeGate !== undefined) {
        resumed ??= createDeferred<void>();
        const running = resumed.promise;
        resumeGate.resolve();
        return running;
      }
      if (pauseRequest !== undefined) {
        const withdrawn = pauseRequest;
        pauseRequest = undefined;
        withdrawn.done.resolve();
      }
      return Promise.resolve();
    },
    cancel(reason: CancellationReason = { kind: "user" }): Promise<void> {
      if (!finished && cancelling === undefined) {
        // The token first, synchronously: every wait and every in-flight
        // request stops now. The job's move is queued behind any pause the
        // runner has already asked for, so the two cannot cross.
        run.cancel(reason);
        cancelling = deps.queue.cancel(jobId).catch((error: unknown) => {
          deps.logger.warn("the job could not move to cancelling", {
            jobId,
            reason: reasonOf(error),
          });
          return undefined;
        });
      }
      return result.then(
        () => undefined,
        () => undefined,
      );
    },
  };
}

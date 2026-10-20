/**
 * The persisted, restart-surviving record of a job, its states and the moves
 * between them, and its stored row (`P3-T34`; `docs/07` §5.2, §7.5, §7.6,
 * §8.3).
 *
 * ## What is `docs/07` §5.2's and what this card added
 *
 * {@link JobRecord} is §5.2's member list with two additions, both written back
 * into §5.2 by this card:
 *
 * - {@link JobRecord.pauseReason}. §7.5 and §12.3 have a `paused` state that a
 *   user, an offline circuit breaker, a missing credential (`docs/09` §2.4,
 *   `credential-required`) or a spend ceiling (§12.3's `BudgetStop`) can put a
 *   job into, and §5.2 had nowhere to say which. A `BudgetStop` is a `paused`
 *   job with reason `budget-stop` — paused, not failed (§12.3's note).
 * - {@link JobRecord.redaction}. `plan/00` §6 item 242: a stored record the
 *   redaction gate changed carries a visible "partly redacted" mark, and §5.2's
 *   note gave `JobRecord` that member to this card.
 *
 * `pipelineId` is a `string` here, not `src/pipeline/types.ts`'s `PipelineId`:
 * `core/` may import only `model/` (`docs/07` §2.3), and the union lives in
 * `pipeline/`. The queue's caller is the one that knows the union.
 *
 * ## One gate, at one place
 *
 * Every column that can carry text a user, a provider or an error wrote —
 * `input_json`, `progress_json`, `usage_json`, `error_json` and
 * `warnings_json` — is produced by {@link toJobRow} and nowhere else, and
 * {@link toJobRow} runs each value through `redactRecord`
 * (`src/core/provenance.ts`, `P3-T36`) before it is serialized. The store in
 * `src/zotero/db.ts` takes a {@link JobRow}, so it cannot write one of those
 * columns without the gate having run. The mark from the pass that changed a
 * value is kept on {@link JobRecord.redaction}, per column, because the gate is
 * idempotent: a second pass over an already-gated value reports nothing.
 *
 * `checkpoint_json` is **not** gated, on purpose. `docs/07` §7.6: a checkpoint
 * records *position* — work keys — not results, and a `hash:` work key carries
 * forty hexadecimal characters the gate's catch-all would replace, which would
 * make a resumed job skip nothing and lose its place. `plan/04` §0.2 item 5 and
 * this card's step 4 name the four columns above; the checkpoint is not one.
 */

import { type SerializedError } from "../errors";
import { redactRecord, type RedactionMark } from "../provenance";

// ---------------------------------------------------------------------------
// 1. The record — docs/07 §5.2, plus the two members above
// ---------------------------------------------------------------------------

/** `docs/07` §4.5's job states. */
export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

/** Every {@link JobStatus}, in §4.5's declaration order. */
export const JOB_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "paused",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
];

/** The three states a job never leaves. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** `docs/07` §5.2's priority. */
export type JobPriority = "interactive" | "normal" | "background";

/**
 * Why a job is `paused`.
 *
 * - `user` — the user pressed pause (§7.5).
 * - `offline` — the per-host circuit breaker of §10.5.
 * - `credential-required` — a key is absent or was rejected mid-job (`docs/09`
 *   §1.7 tier 2, §2.4).
 * - `budget-stop` — a spend ceiling was reached: §12.3's `BudgetStop`, which
 *   pauses and asks (`plan/00` §6 item 234).
 * - `awaiting-confirmation` — a resumed job whose remaining estimate is above
 *   `summary.confirmAboveCents` and needs the user's yes (item 250).
 * - `egress-unacknowledged` — a resumed job that would send text off the
 *   machine before `privacy.egressAcknowledged` is set (item 250).
 */
export type PauseReason =
  | "user"
  | "offline"
  | "credential-required"
  | "budget-stop"
  | "awaiting-confirmation"
  | "egress-unacknowledged";

/** Every {@link PauseReason}. */
export const PAUSE_REASONS: readonly PauseReason[] = [
  "user",
  "offline",
  "credential-required",
  "budget-stop",
  "awaiting-confirmation",
  "egress-unacknowledged",
];

/** `docs/07` §5.2's `progress` member. */
export interface JobProgressRecord {
  readonly completed: number;
  readonly total: number | undefined;
  readonly currentStageKey: string | undefined;
  readonly message: string;
}

/** `docs/07` §5.2's `usage` member: accumulated across attempts. */
export interface JobUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

/** `docs/07` §5.2's `resultRef` member. */
export interface JobResultRef {
  readonly kind: "collection" | "report" | "none";
  readonly key?: string;
}

/** The columns {@link toJobRow} puts through the redaction gate. */
export type GatedJobField =
  "input" | "progress" | "usage" | "error" | "warnings";

/** Every {@link GatedJobField}, in the order {@link toJobRow} gates them. */
export const GATED_JOB_FIELDS: readonly GatedJobField[] = [
  "input",
  "progress",
  "usage",
  "error",
  "warnings",
];

/**
 * The "partly redacted" marks of one record: one per gated field whose stored
 * value the gate changed, absent for a field it left alone.
 */
export type JobRedaction = {
  readonly [F in GatedJobField]?: RedactionMark;
};

/** The persisted, restart-surviving record of a job (`docs/07` §5.2). */
export interface JobRecord {
  readonly id: string;
  readonly pipelineId: string;
  readonly status: JobStatus;
  /** Set exactly when {@link status} is `paused`. */
  readonly pauseReason: PauseReason | undefined;
  readonly priority: JobPriority;
  readonly exclusivityKey: string | undefined;

  /** Serialized pipeline input. Must be JSON-safe; stored through the gate. */
  readonly input: unknown;
  /** Schema version of `input`, so old queued jobs can be migrated or discarded. */
  readonly inputVersion: number;

  readonly createdAtEpochMs: number;
  readonly startedAtEpochMs: number | undefined;
  readonly finishedAtEpochMs: number | undefined;
  /** Bumped on every restart-resume; used to detect resume loops. */
  readonly attemptCount: number;

  readonly progress: JobProgressRecord;

  /** Opaque, pipeline-defined resume state written via `ctx.checkpoint()`. */
  readonly checkpoint: unknown;
  readonly checkpointAtEpochMs: number | undefined;

  /** Accumulated cost/usage across attempts. */
  readonly usage: JobUsage;
  readonly budgetUsd: number | undefined;

  /** Terminal error, redacted and serialized. */
  readonly error: SerializedError | undefined;
  readonly warnings: readonly string[];
  /** Result reference rather than the result itself. */
  readonly resultRef: JobResultRef | undefined;

  /** Zotero context so a job's result can be resolved to the right library. */
  readonly libraryID: number | undefined;
  /** Plugin version that created the job; guards against cross-version resume. */
  readonly createdByPluginVersion: string;

  /** Which stored fields the redaction gate changed (`plan/00` §6 item 242). */
  readonly redaction: JobRedaction;
}

/** True when the gate changed any stored field of `record`. */
export function isPartlyRedacted(record: JobRecord): boolean {
  return GATED_JOB_FIELDS.some(
    (field) => record.redaction[field]?.partlyRedacted === true,
  );
}

/** §12.3's `BudgetStop`: a job paused at a spend ceiling, not a failed one. */
export function isBudgetStop(record: JobRecord): boolean {
  return record.status === "paused" && record.pauseReason === "budget-stop";
}

/** What a caller supplies to create a record; everything else is derived. */
export interface NewJobRecord {
  readonly id: string;
  readonly pipelineId: string;
  readonly input: unknown;
  readonly inputVersion?: number;
  readonly priority?: JobPriority;
  readonly exclusivityKey?: string;
  readonly budgetUsd?: number;
  readonly libraryID?: number;
  readonly createdAtEpochMs: number;
  readonly createdByPluginVersion: string;
}

/** A fresh `queued` record. */
export function createJobRecord(fields: NewJobRecord): JobRecord {
  return {
    id: fields.id,
    pipelineId: fields.pipelineId,
    status: "queued",
    pauseReason: undefined,
    priority: fields.priority ?? "normal",
    exclusivityKey: fields.exclusivityKey,
    input: fields.input,
    inputVersion: fields.inputVersion ?? 1,
    createdAtEpochMs: fields.createdAtEpochMs,
    startedAtEpochMs: undefined,
    finishedAtEpochMs: undefined,
    attemptCount: 0,
    progress: {
      completed: 0,
      total: undefined,
      currentStageKey: undefined,
      message: "",
    },
    checkpoint: undefined,
    checkpointAtEpochMs: undefined,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    budgetUsd: fields.budgetUsd,
    error: undefined,
    warnings: [],
    resultRef: undefined,
    libraryID: fields.libraryID,
    createdByPluginVersion: fields.createdByPluginVersion,
    redaction: {},
  };
}

// ---------------------------------------------------------------------------
// 2. The state machine — docs/07 §7.5, §7.6, §12
// ---------------------------------------------------------------------------

/**
 * Every move a job may make. Terminal states have none.
 *
 * - `queued → interrupted` is absent: a queued job that outlives a crash is
 *   returned to `queued` (§7.6's table), not interrupted.
 * - `paused → running` is an in-session resume; `paused → queued` hands the
 *   job back to whatever dispatches queued work (a paused job after a
 *   restart has no worker waiting on it).
 * - `interrupted → paused` is a resumed job that a spend guard stopped
 *   (item 250); `interrupted → queued` is one every guard let through.
 */
export const JOB_TRANSITIONS: Readonly<
  Record<JobStatus, readonly JobStatus[]>
> = {
  queued: ["running", "paused", "cancelled"],
  running: ["paused", "cancelling", "succeeded", "failed", "interrupted"],
  paused: ["running", "queued", "cancelled", "interrupted"],
  cancelling: ["cancelled", "interrupted"],
  interrupted: ["queued", "paused", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

/** Whether `from → to` is one of {@link JOB_TRANSITIONS}. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/** A move {@link JOB_TRANSITIONS} does not allow. A programming error. */
export class JobTransitionError extends Error {
  constructor(
    readonly jobId: string,
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(
      `[research-helper] job ${jobId} cannot move from "${from}" to "${to}".`,
    );
    this.name = "JobTransitionError";
  }
}

/**
 * `record` moved to `to` at `atEpochMs`.
 *
 * `pauseReason` is required for `paused` and ignored otherwise; leaving
 * `paused` clears it. Entering `running` for the first time stamps
 * `startedAtEpochMs`; entering a terminal state stamps `finishedAtEpochMs`.
 *
 * @throws JobTransitionError for a move {@link JOB_TRANSITIONS} does not allow,
 *   or for `paused` without a reason
 */
export function transition(
  record: JobRecord,
  to: JobStatus,
  atEpochMs: number,
  pauseReason?: PauseReason,
): JobRecord {
  if (!canTransition(record.status, to)) {
    throw new JobTransitionError(record.id, record.status, to);
  }
  if (to === "paused" && pauseReason === undefined) {
    throw new JobTransitionError(record.id, record.status, to);
  }
  return {
    ...record,
    status: to,
    pauseReason: to === "paused" ? pauseReason : undefined,
    startedAtEpochMs:
      to === "running" && record.startedAtEpochMs === undefined
        ? atEpochMs
        : record.startedAtEpochMs,
    finishedAtEpochMs: TERMINAL_JOB_STATUSES.includes(to)
      ? atEpochMs
      : record.finishedAtEpochMs,
  };
}

/**
 * `record` with one gated field replaced by a caller's raw value. The field's
 * old mark is dropped, so {@link toJobRow} marks the new value on its own
 * merits.
 */
export function withGatedField<F extends GatedJobField>(
  record: JobRecord,
  field: F,
  value: JobRecord[F],
): JobRecord {
  const redaction: { [K in GatedJobField]?: RedactionMark } = {
    ...record.redaction,
  };
  delete redaction[field];
  return { ...record, [field]: value, redaction };
}

// ---------------------------------------------------------------------------
// 3. The stored row — docs/07 §8.3's `job` table
// ---------------------------------------------------------------------------

/** One `job` row, column for column (`docs/07` §8.3). */
export interface JobRow {
  readonly id: string;
  readonly pipeline_id: string;
  readonly status: string;
  readonly priority: string;
  readonly exclusivity_key: string | null;
  readonly input_json: string;
  readonly input_version: number;
  readonly checkpoint_json: string | null;
  readonly checkpoint_at: number | null;
  readonly progress_json: string;
  readonly usage_json: string;
  readonly error_json: string | null;
  readonly library_id: number | null;
  readonly attempt_count: number;
  readonly plugin_version: string;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly finished_at: number | null;
  readonly pause_reason: string | null;
  readonly warnings_json: string;
  readonly budget_usd: number | null;
  readonly result_ref_json: string | null;
  readonly redaction_json: string;
}

/** {@link JobRow}'s column names, in `docs/07` §8.3's order. */
export const JOB_COLUMNS: readonly (keyof JobRow)[] = [
  "id",
  "pipeline_id",
  "status",
  "priority",
  "exclusivity_key",
  "input_json",
  "input_version",
  "checkpoint_json",
  "checkpoint_at",
  "progress_json",
  "usage_json",
  "error_json",
  "library_id",
  "attempt_count",
  "plugin_version",
  "created_at",
  "started_at",
  "finished_at",
  "pause_reason",
  "warnings_json",
  "budget_usd",
  "result_ref_json",
  "redaction_json",
];

/** What {@link toJobRow} returns. */
export interface StoredJob {
  /** The row to write. */
  readonly row: JobRow;
  /**
   * The record exactly as the row holds it: gated values, and the marks.
   * A caller keeps this one, so what it holds in memory is what is on disk.
   */
  readonly record: JobRecord;
}

/** `undefined` → SQL `NULL`. */
function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/** SQL `NULL` → `undefined`. */
function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

/**
 * JSON with `undefined` kept as `null`, so a gated value round-trips.
 * `JSON.stringify(undefined)` is `undefined`, which a `NOT NULL` column refuses.
 */
function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** `JSON.parse`, with `null` read back as `undefined`. */
function parsed(text: string | null): unknown {
  if (text === null) return undefined;
  const value: unknown = JSON.parse(text);
  return value === null ? undefined : value;
}

/**
 * The row for `record`, with every gated field through the redaction gate.
 *
 * A field whose pass changed it gets that pass's mark; a field the pass left
 * alone keeps the mark it already had, because an already-gated value passes
 * through unchanged and its earlier mark is the one that describes it.
 *
 * @param record - the record, raw or already gated
 * @returns the row and the record as stored
 */
export function toJobRow(record: JobRecord): StoredJob {
  const redaction: { [K in GatedJobField]?: RedactionMark } = {
    ...record.redaction,
  };
  const gate = <T>(field: GatedJobField, value: T): T => {
    const pass = redactRecord(value);
    if (pass.mark.partlyRedacted) redaction[field] = pass.mark;
    return pass.record;
  };
  const input = gate("input", record.input);
  const progress = gate("progress", record.progress);
  const usage = gate("usage", record.usage);
  const error = gate("error", record.error);
  const warnings = gate("warnings", record.warnings);

  const stored: JobRecord = {
    ...record,
    input,
    progress,
    usage,
    error,
    warnings,
    redaction,
  };
  const row: JobRow = {
    id: record.id,
    pipeline_id: record.pipelineId,
    status: record.status,
    priority: record.priority,
    exclusivity_key: orNull(record.exclusivityKey),
    input_json: json(input),
    input_version: record.inputVersion,
    checkpoint_json:
      record.checkpoint === undefined ? null : json(record.checkpoint),
    checkpoint_at: orNull(record.checkpointAtEpochMs),
    progress_json: json(progress),
    usage_json: json(usage),
    error_json: error === undefined ? null : json(error),
    library_id: orNull(record.libraryID),
    attempt_count: record.attemptCount,
    plugin_version: record.createdByPluginVersion,
    created_at: record.createdAtEpochMs,
    started_at: orNull(record.startedAtEpochMs),
    finished_at: orNull(record.finishedAtEpochMs),
    pause_reason: orNull(record.pauseReason),
    warnings_json: json(warnings),
    budget_usd: orNull(record.budgetUsd),
    result_ref_json:
      record.resultRef === undefined ? null : json(record.resultRef),
    redaction_json: json(redaction),
  };
  return { row, record: stored };
}

/**
 * §5.2's progress with every member present. JSON drops an `undefined`
 * member, so `total` and `currentStageKey` are restored as `undefined` here
 * and a record read back equals the record written.
 */
function progressFrom(value: unknown): JobProgressRecord {
  const stored = (value ?? {}) as Partial<JobProgressRecord>;
  return {
    completed: stored.completed ?? 0,
    total: stored.total,
    currentStageKey: stored.currentStageKey,
    message: stored.message ?? "",
  };
}

function isStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

function isPauseReason(value: string): value is PauseReason {
  return (PAUSE_REASONS as readonly string[]).includes(value);
}

function isPriority(value: string): value is JobPriority {
  return (
    value === "interactive" || value === "normal" || value === "background"
  );
}

/**
 * The record a stored row holds.
 *
 * @throws Error when the row carries a status, a priority or a pause reason
 *   this build does not know — a row a later plugin version wrote, which this
 *   build cannot interpret
 */
export function fromJobRow(row: JobRow): JobRecord {
  if (!isStatus(row.status) || !isPriority(row.priority)) {
    throw new Error(
      `[research-helper] job ${row.id} has a status or priority this build does not know.`,
    );
  }
  const pauseReason = orUndefined(row.pause_reason);
  if (pauseReason !== undefined && !isPauseReason(pauseReason)) {
    throw new Error(
      `[research-helper] job ${row.id} has a pause reason this build does not know.`,
    );
  }
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    pauseReason,
    priority: row.priority,
    exclusivityKey: orUndefined(row.exclusivity_key),
    input: parsed(row.input_json),
    inputVersion: row.input_version,
    createdAtEpochMs: row.created_at,
    startedAtEpochMs: orUndefined(row.started_at),
    finishedAtEpochMs: orUndefined(row.finished_at),
    attemptCount: row.attempt_count,
    progress: progressFrom(parsed(row.progress_json)),
    checkpoint: parsed(row.checkpoint_json),
    checkpointAtEpochMs: orUndefined(row.checkpoint_at),
    usage: parsed(row.usage_json) as JobUsage,
    budgetUsd: orUndefined(row.budget_usd),
    error: parsed(row.error_json) as SerializedError | undefined,
    warnings: (parsed(row.warnings_json) ?? []) as readonly string[],
    resultRef: parsed(row.result_ref_json) as JobResultRef | undefined,
    libraryID: orUndefined(row.library_id),
    createdByPluginVersion: row.plugin_version,
    redaction: (parsed(row.redaction_json) ?? {}) as JobRedaction,
  };
}

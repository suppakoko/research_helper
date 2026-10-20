/**
 * A job's checkpoint, written and read through the job store (`P3-T34`;
 * `docs/07` §4.5, §7.6).
 *
 * `docs/07` §7.6: "`ctx.checkpoint(state)` writes an opaque JSON blob into
 * `JobRecord.checkpoint`, throttled to at most once per 2 seconds and always
 * flushed at stage boundaries." {@link createCheckpointWriter} is that
 * throttle over `src/core/jobQueue/queue.ts`'s `writeCheckpoint`, and
 * {@link readCheckpoint} is what a resumed job's `ctx.resumeState` is read
 * from. `P3-T35` binds a writer to each job's `PipelineContext.checkpoint` in
 * `createPipelineContextFactory` (`src/bootstrap/container.ts`), replacing the
 * no-op `P1-T16` left there.
 *
 * The state is a checkpoint's *position* — work keys — and is stored as it
 * is, without the redaction gate: see `src/core/jobQueue/jobRecord.ts`'s
 * header for why a `hash:` work key must not pass through it.
 */

import type { Clock } from "../../core/clock";
import type { JobQueue } from "../../core/jobQueue/queue";

/** `docs/07` §7.6's "at most once per 2 seconds". */
export const CHECKPOINT_MIN_INTERVAL_MS = 2000;

/** One job's checkpoint writer. */
export interface CheckpointWriter {
  /**
   * Record `state` as the job's resume point.
   *
   * Written at once when the last write was at least
   * {@link CHECKPOINT_MIN_INTERVAL_MS} ago, or when `boundary` is set (a stage
   * boundary, §7.6's "always flushed"); otherwise held, and written by the
   * next call that may write or by {@link flush}. A held state is replaced by
   * a newer one, never queued behind it.
   */
  checkpoint(
    state: unknown,
    options?: { readonly boundary?: boolean },
  ): Promise<void>;
  /** Write the held state, if any. Called on pause, on stop and at a boundary. */
  flush(): Promise<void>;
}

/** What {@link createCheckpointWriter} needs. */
export interface CheckpointWriterDeps {
  readonly queue: Pick<JobQueue, "writeCheckpoint">;
  readonly jobId: string;
  readonly clock: Clock;
  /** Defaults to {@link CHECKPOINT_MIN_INTERVAL_MS}. */
  readonly minIntervalMs?: number;
}

/** Nothing is held. A `unique symbol`, so `undefined` stays a valid state. */
const NOTHING: unique symbol = Symbol("no held checkpoint");

/**
 * A throttled writer for one job's checkpoint.
 *
 * @param deps - the queue, the job and the clock
 * @returns the writer
 */
export function createCheckpointWriter(
  deps: CheckpointWriterDeps,
): CheckpointWriter {
  const interval = deps.minIntervalMs ?? CHECKPOINT_MIN_INTERVAL_MS;
  let lastWriteAt: number | undefined;
  let held: unknown = NOTHING;

  const write = async (state: unknown): Promise<void> => {
    held = NOTHING;
    lastWriteAt = deps.clock.now();
    await deps.queue.writeCheckpoint(deps.jobId, state);
  };

  return {
    async checkpoint(state, options = {}): Promise<void> {
      const now = deps.clock.now();
      if (
        options.boundary === true ||
        lastWriteAt === undefined ||
        now - lastWriteAt >= interval
      ) {
        await write(state);
        return;
      }
      held = state;
    },

    async flush(): Promise<void> {
      if (held === NOTHING) return;
      await write(held);
    },
  };
}

/**
 * The job's last written checkpoint — a resumed job's `ctx.resumeState` — or
 * `undefined` when it never wrote one.
 */
export function readCheckpoint(
  queue: Pick<JobQueue, "readCheckpoint">,
  jobId: string,
): Promise<unknown> {
  return queue.readCheckpoint(jobId);
}

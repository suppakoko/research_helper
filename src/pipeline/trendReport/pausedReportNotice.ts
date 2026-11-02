/**
 * The one-time notice at Zotero's start that a report job is left waiting for
 * the user (`P4-T21`; owner, `plan/00` §6 item 332(b); coordinator, item 334(j);
 * `docs/07` §12.4 readings 23 and 24; `docs/08` §6.3's notes of 2026-11-02), and
 * the rule for which jobs those are, which the report window's question shares.
 *
 * **Caller:** `publishReportWindowCommands` in `src/bootstrap/registerUI.ts`,
 * after `PluginDatabase.recovery`, with `getPref`/`setPref` on
 * `report.pausedNoticeShown` and a `show` that opens Zotero's progress window.
 * Nothing is constructed here: every export is a function, a type or a constant.
 *
 * **At no cost.** {@link announcePausedReports} is handed only the queue's
 * `list`, so it cannot change a record, start a job or reach a provider. The
 * question itself stays with the collection's report window (reading 15).
 */

import type { JobRecord, JobStatus } from "../../core/jobQueue/jobRecord";
import type { JobQueue } from "../../core/jobQueue/queue";

/** The job queue's name for a report job. */
const REPORT_PIPELINE_ID = "trendReport";

/** What a report job is in while only the user's answer can move it on. */
const WAITING_STATUSES: readonly JobStatus[] = ["paused", "interrupted"];

/**
 * The report jobs waiting for the user: `paused`, or left `interrupted` by
 * `recover()` (`docs/07` §12.4 reading 24). Lists the queue and nothing else.
 * Callers: {@link announcePausedReports} here and `askPausedJob` in
 * `createReportWindowSession` (`src/bootstrap/registerUI.ts`).
 *
 * @param jobs - the queue's `list`
 */
export async function waitingReportJobs(
  jobs: Pick<JobQueue, "list">,
): Promise<readonly JobRecord[]> {
  const records = await jobs.list({ status: WAITING_STATUSES });
  return records.filter((r) => r.pipelineId === REPORT_PIPELINE_ID);
}

/**
 * The record "Continue" runs in: an `interrupted` job may not go to `running`,
 * so it is `paused` first, for the user's own reason; a `paused` one is as it
 * was. Caller: `askPausedJob` in `createReportWindowSession`.
 *
 * @param jobs - the queue's `pause`
 * @param record - from {@link waitingReportJobs}
 */
export function pausedForAnswer(
  jobs: Pick<JobQueue, "pause">,
  record: JobRecord,
): Promise<JobRecord> {
  return record.status === "interrupted"
    ? jobs.pause(record.id, "user")
    : Promise.resolve(record);
}

/**
 * One pause, as {@link announcePausedReports} remembers it: the same job paused
 * again later (a new reason, a checkpoint moved, another attempt) is a new pause
 * and gets a new notice. No collection name or other library data is in it.
 *
 * @param record - a waiting job's record
 */
export function pausedReportIdentity(
  record: Pick<
    JobRecord,
    "id" | "pauseReason" | "checkpointAtEpochMs" | "attemptCount"
  >,
): string {
  return [
    record.id,
    record.pauseReason ?? "",
    record.checkpointAtEpochMs ?? 0,
    record.attemptCount,
  ].join("|");
}

/** The stored array of identities; anything else reads as empty. */
function parseShown(json: string): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(json);
    if (Array.isArray(value)) {
      return new Set(value.filter((v) => typeof v === "string"));
    }
  } catch {
    // A hand-edited preference: at worst one notice is shown again.
  }
  return new Set();
}

/** What {@link announcePausedReports} needs. */
export interface PausedReportNoticeDeps {
  readonly jobs: Pick<JobQueue, "list">;
  /** `report.pausedNoticeShown`. */
  readShown(): string;
  /** Write `report.pausedNoticeShown`. */
  writeShown(json: string): void;
  /** Tell the user about these records; it rejects if it could not. */
  show(records: readonly JobRecord[]): Promise<void>;
}

/**
 * Show one notice for the waiting report jobs not yet announced, then remember
 * every report job waiting now, so the preference holds no more than those. A
 * `show` that fails writes nothing, so the next start tries again.
 *
 * @param deps - see {@link PausedReportNoticeDeps}
 * @returns the records announced; empty when there was nothing new
 */
export async function announcePausedReports(
  deps: PausedReportNoticeDeps,
): Promise<readonly JobRecord[]> {
  const paused = await waitingReportJobs(deps.jobs);
  const shown = parseShown(deps.readShown());
  const fresh = paused.filter((r) => !shown.has(pausedReportIdentity(r)));
  if (fresh.length > 0) await deps.show(fresh);
  const identities = paused.map(pausedReportIdentity);
  if (identities.length !== shown.size || fresh.length > 0) {
    deps.writeShown(JSON.stringify(identities));
  }
  return fresh;
}

/** The notice's arguments (`research-helper-report-paused-notice`). */
export interface PausedReportNoticeArgs {
  readonly count: number;
  readonly collections: string;
}

/**
 * The notice's arguments: each collection named once. A job whose collection has
 * gone is left out; with none left there is no notice.
 *
 * @param records - from {@link announcePausedReports}
 * @param nameOf - the collection's name, or `undefined` when it has gone
 */
export function pausedReportNoticeArgs(
  records: readonly JobRecord[],
  nameOf: (libraryID: number, collectionKey: string) => string | undefined,
): PausedReportNoticeArgs | undefined {
  const names = new Map<string, string>();
  for (const record of records) {
    const input = record.input as {
      readonly libraryID?: number;
      readonly collectionKey?: string;
    };
    if (input.libraryID === undefined || input.collectionKey === undefined) {
      continue;
    }
    const name = nameOf(input.libraryID, input.collectionKey);
    if (name !== undefined) {
      names.set(`${input.libraryID}/${input.collectionKey}`, name);
    }
  }
  return names.size === 0
    ? undefined
    : { count: names.size, collections: [...names.values()].join(", ") };
}

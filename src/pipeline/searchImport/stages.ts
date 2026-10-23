/**
 * `searchImport`'s stage list — `docs/07` §12.1's states, as
 * `docs/07` §4.5 `StageDescriptor`s — and the one stage that is more than a
 * descriptor: {@link fanOut}, `docs/07` §2.2's "plan → **fanOut** → merge →
 * dedupe → import".
 *
 * **Scope.** `P1-T16` step 2 declared the seven states the card's `Read first`
 * names: `Planning → Fetching → Merging → Deduping → BackfillingAbstracts →
 * CreatingCollection → WritingItems`. `P2-T02` adds the parallel fan-out that
 * runs *inside* `Fetching` — section 3 below. `P3-T27` adds an eighth,
 * `Screening`, between `BackfillingAbstracts` and `CreatingCollection`
 * (`docs/07` §12.1's note of 2026-10-24), and its body — section 7.
 *
 * ## What is deliberately **not** a stage
 *
 * §12.1's diagram also draws `Queued`, `Estimating`, `AwaitingConfirm`,
 * `PartialFetch`, `Cancelling`, `Paused`, `Interrupted` and the three terminals.
 * None of them is a stage, and each is left out for a reason rather than for
 * brevity:
 *
 * - `Queued`, `Paused` and `Interrupted` are the **queue's** states, not the
 *   pipeline's — §7.5 and §7.6 own them and Phase 3 owns the queue.
 * - `Estimating` and `AwaitingConfirm` are `Pipeline.estimate()` and the
 *   confirmation dialog around it; they happen *before* `run()` is called, so a
 *   slice of `run()`'s progress bar is the wrong place for them.
 * - **`PartialFetch` is a state of `Fetching`, not a stage after it.** §12.1
 *   draws `Fetching → PartialFetch → Merging`, and §12.1's note says
 *   "`PartialFetch` is a first-class state, not an error". Giving it a slice of
 *   the bar would mean the bar jumped differently depending on whether a source
 *   failed, which is backwards: the work done is the same. It is carried on the
 *   outcome instead (`./types.ts`'s `SearchImportOutcome`), and {@link fanOut}
 *   reports which of §12.1's three `Fetching →` edges was taken as
 *   `SearchImportFanOutResult.state`.
 * - `Cancelling` and the terminals are what `ProgressReporter.done()` reports.
 *
 * ## The weights
 *
 * The weights allocate one progress bar, so they are a statement about relative
 * *cost*, and `docs/07` publishes no measured figures for these seven. They are
 * therefore chosen, and the reasoning is written down here so a later card with
 * a measurement can replace them against something:
 *
 * - `fetching` is the network, paced by `docs/07` §7.3's token bucket at 3
 *   requests a second unkeyed, and PubMed needs two round trips per page
 *   (`esearch` then `efetch`, `docs/02` §3.3–§3.4). It is the largest.
 * - `writingItems` is the only other stage that does real work per record —
 *   `docs/01` §5.2's `fromJSON()` plus one transaction per batch of 50 — and
 *   `P1-T14`'s own `ImportStats.chunkMs` is the thing that will eventually
 *   measure it. It is second.
 * - `backfillingAbstracts` gets a small slice rather than zero because
 *   `docs/01` §6.3 step 4 makes it a real step; on the PubMed path it is
 *   normally a no-op, because `efetch` returns the abstract with the record.
 *   Its body is `./backfill.ts` (`P2-T12`): `docs/02` §10.4's batched pass, a
 *   handful of requests at any import size — which is why the slice stays
 *   small now that the stage does network work.
 * - `planning`, `merging`, `deduping` and `creatingCollection` are bookkeeping:
 *   a query parse, a lift, an identity pass and one collection write. They get
 *   the same small slice each so that a bar which stops in one of them still
 *   moves visibly, which is the whole reason they are not zero.
 *
 * **The sum is exactly `1` in IEEE-754, and that is checked rather than
 * assumed.** `stageSlices()` rejects a list that does not sum to 1, and
 * `STAGE_WEIGHT_SUM_EPSILON`'s own comment records that this particular decimal
 * set sums exactly while an equally reasonable one does not.
 *
 * ## The label keys do not exist yet, and that is reported rather than fixed
 *
 * §4.5 types `labelKey` as a Fluent message id, and **none of the seven ids
 * below is in either `.ftl` bundle**: verified by grep over
 * `addon/locale/<lang>/research-helper-mainWindow.ftl and -searchDialog.ftl` on 2026-10-07. The bundles and
 * `src/i18n/keys.ts` are `P1-T18`'s files and neither is in `P1-T16`'s `Files`
 * list, so adding them here would be the scope-widening `plan/README.md` §5
 * rule 2 forbids. Nothing in `src/pipeline/` resolves a message — §2.3 keeps
 * Fluent and the DOM in `ui/` — so an absent id costs nothing until a surface
 * renders a stage name, which is `P1-T22`'s. **It needs a card** (or a line in
 * `P1-T18`'s bundles): seven stage labels plus
 * {@link SEARCH_IMPORT_DISPLAY_NAME_KEY}.
 *
 * ## The fan-out (`P2-T02`) — what it guarantees and what it does not
 *
 * {@link fanOut} is the `Fetching` stage's body for a multi-source run. Its one
 * job is the Phase 2 finishing condition "one source returning 500 or 429 does
 * not prevent the others from delivering results" (`plan/03`, FR-9), plus the
 * two NFR-2 clauses "per-source timeouts of 20 s and overall cancellation
 * always available". Concretely:
 *
 * - **Every source runs in its own `try`, with its own cancellation token.**
 *   A throw from one adapter is recorded on *that* source's
 *   `SearchImportSourceReport.error` and nowhere else; the others are not
 *   touched. The per-source token is linked to the run's token, so Cancel still
 *   reaches every adapter, but a *timeout* cancels one source only.
 * - **Concurrency is bounded by the `network-metadata` pool, not by
 *   `Promise.all`.** `docs/07` §7.1 names `Promise.all` as the failure mode and
 *   §7.2 fixes the pool at {@link NETWORK_METADATA_POOL_SIZE}. The pool is
 *   *injected* — one `Semaphore` per process, owned by the composition root,
 *   for the same reason `src/core/rateLimit/hostLimiter.ts` keeps one bucket
 *   per host: a pool created per call would be a per-job budget under another
 *   name. Pacing *within* a host is the per-host limiter's, which
 *   `src/core/http/client.ts` already applies underneath every adapter; the
 *   pool only bounds how many sources are in flight at once.
 * - **The 20 s deadline is armed when the source starts, not when it is
 *   dispatched.** A source parked behind the pool has not been asked anything
 *   yet, so timing its wait would cut a healthy source for the sin of being
 *   fifth. For NFR-2's own case — four sources — the pool admits all four at
 *   once and the two readings coincide.
 * - **On the deadline the source's token is cancelled with
 *   `{ kind: "timeout" }`, which aborts its in-flight request through
 *   `cancellerReceiver`** (`docs/07` §7.4), and the source is reported with a
 *   §10.1 `TimeoutError`. The records it had already yielded are **kept**: a
 *   source that returned two pages and hung on the third is degraded, not
 *   failed — the same reading {@link fetchStateFromReports} gives a page-2
 *   throw.
 *   The fan-out stops *waiting* for that source at the deadline even if the
 *   adapter ignores its token, and **its pool permit is released at the
 *   deadline** — the `TimeoutError` is thrown inside `Semaphore.run`, whose
 *   `finally` returns the permit. A non-cooperating adapter therefore runs on
 *   without a permit, bounded only by its host limiter, which is why the
 *   deadline is logged.
 * - **No retry, no backoff, no `Retry-After` handling here.** Those live in
 *   `src/core/http/retry.ts` and `src/core/rateLimit/`, below the adapter;
 *   `docs/02` §2.4 defers the shape to `docs/07` §7.3, and a second shape
 *   here would be a retry the limiter cannot see. A `RateLimitError` arriving
 *   at this layer has already exhausted the host's retry budget and is
 *   recorded as that source's failure.
 * - **Cancellation settles everything before it is reported.** The per-source
 *   promises are gathered with `Promise.allSettled`, so the
 *   `OperationCancelledError` {@link fanOut} throws is thrown only after every
 *   in-flight adapter promise has settled and every deadline timer has been
 *   disarmed — no adapter keeps writing into a result the caller has moved on
 *   from.
 *
 * **What is still the caller's.** The `Fetching` stage's `enterStage`,
 * `done()`, and the `Fetching → Failed` early return are
 * `searchImportPipeline.ts`'s. `P2-T27` wired {@link fanOut} in there in place
 * of the serial per-source loop, so the pipeline's `run()` now calls it and
 * `fetchStateFromReports` (through the pipeline's `fetchOutcome`) is the one
 * function that decides the `Fetching →` edge.
 *
 * ## Deduping and Merging (`P2-T10`) — the same shape, one card later
 *
 * Section 6 is the body of the `Deduping` and `Merging` stages for a
 * multi-source run, as {@link fanOut} is `Fetching`'s: `P2-T09`'s cascade
 * once over the fan-out output and `P2-T10`'s `merge()` once per group, with
 * {@link attributeDeduplicatedAway} turning the cross-source count into the
 * per-source figure `docs/07` §5.3 asks for. `P2-T10` built it and reported
 * the wiring rather than making it (its `Files` row for the pipeline licensed
 * one deletion only); `P2-T29` wired it — the pipeline's `run()` calls it in
 * `Merging` and `attributeDeduplicatedAway` in `Deduping`. Since `P2-T30`
 * the call `run()` awaits is {@link dedupeAndMergeAsync}, whose cascade
 * yields to the event loop between slices (`docs/10` NFR-3); the synchronous
 * {@link dedupeAndMerge} stays because `test/unit/model/merge.test.ts` calls
 * it directly, and the two are asserted equal in
 * `test/unit/pipeline/searchImport.test.ts`. One path skips both: an import
 * handed the preview's own `works` beside its `records`
 * (`SearchImportInput.works`, `P2-T31`) writes those works as given, so the
 * cascade runs once per search, never again over the representatives.
 */

import type { Clock } from "../../core/clock";
import type { Semaphore } from "../../core/concurrency";
import {
  OperationCancelledError,
  ResearchHelperError,
  TimeoutError,
  type SerializedError,
} from "../../core/errors";
import {
  createCancellationTokenSource,
  type CancellationToken,
} from "../../core/jobQueue/cancellation";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { Logger } from "../../core/logger";
import type { MergeDecision } from "../../core/provenance";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { ExternalIds, ProviderId, SourceId } from "../../model/ids";
import { merge, type IdConflict } from "../../model/merge";
import type { SourceRecord } from "../../model/sourceRecord";
import {
  dedupeRecords,
  dedupeRecordsAsync,
  type DedupDecision,
  type DedupeAsyncOptions,
  type DedupPair,
  type DedupResult,
} from "../../sources/shared/dedupe";
import { parseUserQuery } from "../../sources/shared/queryParse";
import {
  applyClientRecencyFilter,
  resolveDateFilterMode,
} from "../../sources/shared/recency";
import type { LiteratureSource, SourceQuery } from "../../sources/types";
import type { ModelInfo } from "../../llm/types";
import type { PromptTemplate } from "../../prompts";
import { SUPERSEDED_BY_PUBLISHED_TAG } from "../../zotero/itemMapper";
import {
  excludedIds,
  screenRelevance,
  type ScreeningCandidate,
} from "../shared/relevanceScreen";
import type { PipelineContext, StageDescriptor } from "../types";
import type {
  SearchImportFanOutResult,
  SearchImportFetchState,
  SearchImportInput,
  SearchImportScreeningOptions,
  SearchImportScreeningReport,
  SearchImportSourceReport,
} from "./types";

// ---------------------------------------------------------------------------
// 1. The stage declaration — P1-T16
// ---------------------------------------------------------------------------

/**
 * `Pipeline.displayNameKey` for `searchImport`.
 *
 * Not in either bundle yet — see this file's header.
 */
export const SEARCH_IMPORT_DISPLAY_NAME_KEY =
  "research-helper-pipeline-search-import";

/**
 * The seven stage keys, as a union, so a `switch` over them is exhaustive and a
 * typo in a stage transition is a compile error rather than a bar that never
 * moves.
 */
export type SearchImportStageKey =
  | "planning"
  | "fetching"
  | "merging"
  | "deduping"
  | "backfillingAbstracts"
  | "screening"
  | "creatingCollection"
  | "writingItems";

/**
 * `docs/07` §12.1's states in run order, with `docs/07` §4.5's three members.
 *
 * Frozen, and exported as the pipeline's `stages`: `StageDescriptor` is
 * `readonly` in every member, but the array itself would otherwise be mutable
 * through the `readonly StageDescriptor[]` the interface declares.
 */
export const SEARCH_IMPORT_STAGES: readonly StageDescriptor[] = Object.freeze([
  {
    key: "planning",
    labelKey: "research-helper-stage-planning",
    weight: 0.05,
  },
  {
    key: "fetching",
    labelKey: "research-helper-stage-fetching",
    // 0.45 until `P3-T27`, which gave `screening` 0.1 of it (0.35 + 0.1 keeps
    // the set's IEEE-754 sum at exactly 1; measured 2026-10-24).
    weight: 0.35,
  },
  {
    key: "merging",
    labelKey: "research-helper-stage-merging",
    weight: 0.05,
  },
  {
    key: "deduping",
    labelKey: "research-helper-stage-deduping",
    weight: 0.05,
  },
  {
    key: "backfillingAbstracts",
    labelKey: "research-helper-stage-backfilling-abstracts",
    weight: 0.1,
  },
  {
    // `P3-T27`: `docs/07` §12.1's `Screening` state (its note of 2026-10-24).
    // An LLM pass when the run asked for it, so a slice as large as the
    // backfill's; entered and completed at once when it did not.
    key: "screening",
    labelKey: "research-helper-stage-screening",
    weight: 0.1,
  },
  {
    key: "creatingCollection",
    labelKey: "research-helper-stage-creating-collection",
    weight: 0.05,
  },
  {
    key: "writingItems",
    labelKey: "research-helper-stage-writing-items",
    weight: 0.25,
  },
] satisfies readonly (StageDescriptor & { key: SearchImportStageKey })[]);

/**
 * The stage keys in run order, derived from {@link SEARCH_IMPORT_STAGES} rather
 * than listed a second time.
 *
 * A second hand-written list is how a stage comes to exist in one place and not
 * the other; `docs/07` §12.1's order is the one thing here that must not be
 * reproduced twice.
 */
export const SEARCH_IMPORT_STAGE_KEYS: readonly SearchImportStageKey[] =
  SEARCH_IMPORT_STAGES.map((stage) => stage.key as SearchImportStageKey);

// ---------------------------------------------------------------------------
// 2. The two fan-out constants, and where each number comes from
// ---------------------------------------------------------------------------

/**
 * `docs/07` §7.2's `network-metadata` pool: **4**, "not user-configurable"
 * (`docs/10` NFR-6, `docs/07` §8.5's note on `concurrency`, which sizes the
 * `llm` pool only).
 *
 * This is the size the composition root builds its one `Semaphore` with; it is
 * exported so that the root and `fanOut`'s tests name the same figure, and it
 * is not read by {@link fanOut} itself — the pool arrives built.
 */
export const NETWORK_METADATA_POOL_SIZE = 4;

/**
 * `docs/10` NFR-2's "per-source timeouts of 20 s", in milliseconds.
 *
 * **`docs/10` is the only place in the corpus that states this figure**:
 * grepped 2026-10-13, `docs/07` does not restate it, although the card's
 * `Read first` says the numbers are doc 07's. It is a *source* deadline, not
 * a request timeout — `src/core/http/client.ts`'s per-request `timeout` comes
 * from the `timeoutSeconds` preference (`docs/07` §8.5, default 60 s) and sits
 * one layer down; a source whose single request runs long is cut here first.
 */
export const PER_SOURCE_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// 3. The fan-out — P2-T02
// ---------------------------------------------------------------------------

/** What {@link fanOut} needs. Everything is a `PipelineContext` member or a port. */
export interface FanOutOptions {
  /**
   * The sources to ask, already resolved from the registry by `Planning`, in
   * the order the user selected them. Results and reports come back in this
   * order regardless of which source finished first.
   */
  readonly sources: readonly LiteratureSource[];
  /** The run's query, limit and recency window — `SearchImportInput`'s three. */
  readonly input: Pick<SearchImportInput, "query" | "limit" | "dateFilter">;
  /** The run's token. A cancel here reaches every source. */
  readonly token: CancellationToken;
  /** The clock the per-source deadline sleeps on. */
  readonly clock: Clock;
  /**
   * The `Fetching` stage's reporter. Each source gets a child of it, and the
   * FR-9 banner for a failed source is raised on it.
   */
  readonly progress: ProgressReporter;
  readonly logger: Logger;
  /**
   * The process-wide `network-metadata` pool — one `Semaphore` built with
   * {@link NETWORK_METADATA_POOL_SIZE} permits and shared by every run. See the
   * header for why it is injected rather than created here.
   */
  readonly pool: Semaphore;
  /** Defaults to {@link PER_SOURCE_TIMEOUT_MS}. Tests shorten it; nothing else should. */
  readonly perSourceTimeoutMs?: number;
}

/** One source's fetch, before it becomes part of the result. */
interface SourceFetch {
  readonly records: readonly SourceRecord[];
  readonly report: SearchImportSourceReport;
  /** The FR-9 banner this source raised, if it failed. */
  readonly banner: string | undefined;
}

/**
 * Query `sources` concurrently under `pool`, isolate each one's failure, and
 * report which of `docs/07` §12.1's three `Fetching →` edges was taken.
 *
 * See the header's "The fan-out" section for the guarantees. In one sentence:
 * a source that times out, 500s or 429s produces a report with an `error` and
 * a warning naming it, and never an exception — the only thing this function
 * throws is the run's own `OperationCancelledError`, after every in-flight
 * source has settled.
 *
 * @param options - see {@link FanOutOptions}
 * @returns records in `sources` order, one report per source in the same
 *   order, the run-level warnings this call raised, and the fetch state
 * @throws OperationCancelledError when `options.token` was cancelled, carrying
 *   the run's reason — and only once every per-source promise has settled
 */
export async function fanOut(
  options: FanOutOptions,
): Promise<SearchImportFanOutResult> {
  const { sources, token } = options;

  // `allSettled`, not `all`, and not the card's forbidden `Promise.all` over
  // the sources: `all` would surface the first rejection while the others were
  // still writing, and the pool — not this call — bounds how many run at once.
  // `fetchOne` rejects only for the run's cancellation, so the `rejected` arm
  // below is cancellation or a defect, never a source's failure.
  const settled = await Promise.allSettled(
    sources.map((source) => fetchOne(source, options)),
  );

  // The run's cancel outranks everything that was collected: `Fetching →
  // Cancelling` in §12.1, and `searchImportPipeline.ts`'s `catch` maps the
  // throw to the `"cancelled"` outcome. Thrown *after* `allSettled`, so no
  // adapter is still running behind the caller's back (FR-10).
  token.throwIfCancelled();

  const records: SourceRecord[] = [];
  const perSource: SearchImportSourceReport[] = [];
  const warnings: string[] = [];
  for (const [index, source] of sources.entries()) {
    const outcome = settled[index];
    if (outcome === undefined) {
      // `allSettled` returns one entry per input; `noUncheckedIndexedAccess`
      // cannot know that.
      throw new RangeError(
        `[research-helper] fanOut: no outcome for source ${source.id}`,
      );
    }
    const fetch =
      outcome.status === "fulfilled"
        ? outcome.value
        : // Unreachable through `fetchOne`'s own `catch`, which converts every
          // non-cancellation throw into a report. Kept because this loop is
          // the isolation boundary: if a future edit lets a source's throw
          // escape `fetchOne`, it must still land on *that* source's row
          // rather than take the fan-out down.
          unexpectedFetch(source, options.input.limit, outcome.reason);
    records.push(...fetch.records);
    perSource.push(fetch.report);
    if (fetch.banner !== undefined) warnings.push(fetch.banner);
  }

  return {
    records,
    perSource,
    warnings,
    state: fetchStateFromReports(perSource, lookupOnlySourceIds(sources)),
  };
}

/**
 * The ids of the sources that contribute by lookup rather than by search —
 * `capabilities.keywordSearch: false` (`P2-T07`'s bioRxiv and medRxiv).
 *
 * {@link fetchStateFromReports} leaves these out of "every source failed"
 * (`plan/00` §6 item 204): such a source makes no request on a keyword run,
 * so it cannot fail one. Read from the capability, never from a list of ids,
 * so a later lookup-only adapter is covered without an edit here.
 *
 * @param sources - the resolved sources a run asked
 * @returns their lookup-only ids
 */
export function lookupOnlySourceIds(
  sources: readonly LiteratureSource[],
): ReadonlySet<SourceId> {
  return new Set(
    sources
      .filter((source) => !source.capabilities.keywordSearch)
      .map((source) => source.id),
  );
}

/**
 * Which of `docs/07` §12.1's three edges out of `Fetching` the reports imply.
 *
 * - **`"failed"`** — `Fetching --> Failed : all sources failed`. Every source
 *   **that searches** errored **and no source yielded a record**. A source that
 *   threw after yielding is degraded, not failed — `P1-T16`'s first criterion
 *   keeps its page 1 — so one such source alone is `"partial"`, not
 *   `"failed"`. A lookup-only source (`lookupOnly`, `keywordSearch: false`)
 *   is left out of "every": it makes no request on a keyword run and so
 *   cannot fail one, and counting it made the default seven-source run
 *   `"partial"` when all five searching sources failed (`plan/00` §6 item
 *   204; `docs/07` §12.1's 2026-10-16 note). The window decides the same way
 *   (`everySearchFailed` in `src/ui/viewModels/searchImportViewModel.ts`). A
 *   run that asked **only** lookup-only sources keeps the reading over every
 *   report, so a real failure there is still `"failed"`.
 * - **`"partial"`** — `Fetching --> PartialFetch : some sources failed, some
 *   succeeded`. At least one report carries an `error` and the run is not
 *   `"failed"`. A healthy source that found *nothing* still succeeded: one
 *   source erroring beside one that returned an empty result set is
 *   `"partial"`, because §12.1's edge is "all sources failed" and an empty
 *   result is not a failure. (The pipeline's earlier `outcomeFromReports`
 *   keyed on productivity and called that run `"failed"`; `P2-T27` deleted it
 *   and the owner confirmed this reading on 2026-10-14 — `plan/00` §6 item 81.)
 * - **`"succeeded"`** — no report carries an `error`. An empty `reports` list
 *   is `"succeeded"` for the reason the pipeline's `fetchOutcome` gives:
 *   nothing was asked, so nothing failed.
 *
 * @param reports - one per source asked
 * @param lookupOnly - the ids of the asked sources whose
 *   `capabilities.keywordSearch` is `false` ({@link lookupOnlySourceIds});
 *   omitted, every report counts as a searching source. A report whose
 *   source had no adapter is not in it, and so counts as searching — as the
 *   window counts a source it has no descriptor for.
 * @returns the state `Fetching` ends in
 */
export function fetchStateFromReports(
  reports: readonly SearchImportSourceReport[],
  lookupOnly: ReadonlySet<SourceId> = new Set(),
): SearchImportFetchState {
  if (reports.length === 0) return "succeeded";
  const errored = reports.filter((report) => report.error !== undefined);
  if (errored.length === 0) return "succeeded";
  const searched = reports.filter((report) => !lookupOnly.has(report.sourceId));
  const basis = searched.length > 0 ? searched : reports;
  const allFailedOutright =
    basis.every((report) => report.error !== undefined) &&
    reports.every((report) => report.recordsRetrieved === 0);
  return allFailedOutright ? "failed" : "partial";
}

// ---------------------------------------------------------------------------
// 4. One source
// ---------------------------------------------------------------------------

/**
 * Fetch one source: build its query, run `searchAll` under the pool and the
 * deadline, and turn whatever happened into a report.
 *
 * **Throws only for the run's cancellation.** Every other throw — the adapter's,
 * `explainQuery`'s, the deadline's `TimeoutError` — becomes `report.error`,
 * which is the isolation the header promises. The run's token is checked in
 * the `catch` *before* the error is classified, so an adapter that throws
 * something else while being cancelled is still reported as cancelled, not
 * failed (`searchImport.test.ts`, "does not let a cancelled source look like a
 * failed source").
 */
async function fetchOne(
  source: LiteratureSource,
  options: FanOutOptions,
): Promise<SourceFetch> {
  const { input, token, clock, pool, logger, progress } = options;
  const timeoutMs = options.perSourceTimeoutMs ?? PER_SOURCE_TIMEOUT_MS;

  const collected: SourceRecord[] = [];
  const warnings: string[] = [];
  let error: SerializedError | undefined;
  let banner: string | undefined;
  let transmittedQuery = "";
  let mode: "server" | "client" | "none" = "none";

  // The source's own token: cancelled by the run's cancel (linked below) *or*
  // by this source's deadline, so a timeout aborts this source's in-flight
  // request (`docs/07` §7.4, `cancellerReceiver`) and nobody else's.
  const own = createCancellationTokenSource();
  const unlink = token.onCancelled((reason) => {
    own.cancel(reason);
  });

  try {
    const planned = queryFor(source, input);
    mode = planned.mode;
    transmittedQuery = source.explainQuery(planned.query);

    // A child of the stage per source, so sources share the stage's slice
    // rather than each claiming all of it; wrapped so the adapter's page
    // warnings — which `searchAll` can only deliver through
    // `ProgressReporter.warn`, there being no page object in an async
    // iterable — also land on *this* source's report (card step 6).
    const reporter = capturingReporter(
      progress.child(source.id, 0, 1),
      warnings,
    );

    // The pool permit is held for the whole of this source's `searchAll`;
    // parked here with the *run's* token so a Cancel releases a waiting source
    // at once (`docs/07` §7.4 check point 2, one layer up).
    await pool.run(async () => {
      // Armed once the permit is held — see the header on why the wait is
      // not timed.
      const deadline = armDeadline(clock, timeoutMs);
      try {
        const work = drain(
          source,
          planned.query,
          own.token,
          reporter,
          collected,
        );
        const winner = await Promise.race([work, deadline.expired]);
        if (winner === "expired") {
          // Abort this source's request, then stop waiting for it. The
          // adapter's eventual rejection is handled so it cannot surface as an
          // unhandled rejection. The `throw` below leaves `pool.run`, whose
          // `finally` releases this source's permit now — a non-cooperating
          // adapter runs on without one, paced only by its host limiter, which
          // is why this is logged.
          own.cancel({ kind: "timeout", ms: timeoutMs });
          work.catch(() => undefined);
          logger.warn("searchImport: a source hit its deadline; continuing", {
            sourceId: source.id,
            timeoutMs,
          });
          throw new TimeoutError(timeoutMs, source.rateLimitKey);
        }
      } finally {
        deadline.disarm();
      }
    }, token);
  } catch (caught) {
    // The run's cancel outranks whatever the adapter threw on the way out.
    token.throwIfCancelled();
    error = serialize(caught);
    // FR-9's banner "names the failed source and the error class".
    banner = `${source.id}: ${error.code} — the other databases were still searched.`;
    warnings.push(banner);
    progress.warn(banner);
    logger.warn("searchImport: a source failed; continuing", {
      sourceId: source.id,
      code: error.code,
    });
  } finally {
    unlink();
    own.dispose();
  }

  // Whatever was collected before a failure is kept — a degraded source still
  // contributes — and the client recency filter runs over it exactly as it
  // would over a clean fetch (FR-3).
  const recordsRetrieved = collected.length;
  let kept: readonly SourceRecord[] = collected;
  let droppedOutOfWindow = 0;
  let keptWithoutDate = 0;
  if (mode === "client" && input.dateFilter !== "none") {
    const filtered = applyClientRecencyFilter(collected, input.dateFilter);
    kept = filtered.kept;
    droppedOutOfWindow = filtered.droppedOutOfWindow;
    keptWithoutDate = filtered.keptWithoutDate;
  }

  return {
    records: kept,
    banner,
    report: {
      sourceId: source.id,
      transmittedQuery,
      requestedLimit: input.limit,
      dateFilterApplied: mode,
      recordsRetrieved,
      droppedOutOfWindow,
      keptWithoutDate,
      // Nothing is merged in `Fetching`. Dedup is cross-source and runs after
      // every source has answered, so this cannot be known here; `Deduping`
      // re-stamps it through {@link attributeDeduplicatedAway}.
      recordsDeduplicatedAway: 0,
      error,
      warnings,
    },
  };
}

/**
 * Pull every record out of `searchAll`, checking the source's token before
 * each one is kept — `docs/07` §7.4 check point 1, and the reason a record a
 * misbehaving adapter yields *after* its deadline is never counted.
 */
async function drain(
  source: LiteratureSource,
  query: SourceQuery,
  token: CancellationToken,
  progress: ProgressReporter,
  into: SourceRecord[],
): Promise<"done"> {
  for await (const record of source.searchAll(query, { token, progress })) {
    token.throwIfCancelled();
    into.push(record);
  }
  return "done";
}

/** The `SourceQuery` one source is asked, and how its dates were handled. */
function queryFor(
  source: LiteratureSource,
  input: FanOutOptions["input"],
): { query: SourceQuery; mode: "server" | "client" | "none" } {
  const mode = resolveDateFilterMode(source.capabilities, input.dateFilter);
  const window = input.dateFilter;
  return {
    mode,
    query: {
      terms: parseUserQuery(input.query),
      limit: input.limit,
      // Server-side bounds only when the source says it can filter;
      // `resolveDateFilterMode` states §11.1 step 2's rule: "do not fake it."
      ...(mode === "server" &&
        window !== "none" && {
          fromDate: window.fromDate,
          toDate: window.toDate,
        }),
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Small helpers
// ---------------------------------------------------------------------------

/** A disarmable deadline over the injected clock. */
interface Deadline {
  /** Resolves `"expired"` when the deadline passes; never settles once disarmed. */
  readonly expired: Promise<"expired">;
  /** Stop the timer. Idempotent. Call it once the race is decided. */
  disarm(): void;
}

/**
 * Start a deadline of `ms` on `clock`.
 *
 * `Clock.sleep`'s only early exit is a cancellation, so the timer gets a
 * private token and `disarm()` cancels it. The reason is `{ kind: "shutdown" }`
 * — the timer is being shut down — and it is observed by nothing: the sleep's
 * rejection is swallowed here, at the one place it can land, and the token
 * never leaves this function. Disarming is what keeps a finished source from
 * leaving a 20 s timer behind (`docs/01` §12 gotcha 10 is about exactly that
 * kind of straggler).
 */
function armDeadline(clock: Clock, ms: number): Deadline {
  const timer = createCancellationTokenSource();
  const expired = clock.sleep(ms, timer.token).then(
    () => "expired" as const,
    // Disarmed before it fired: the race has already been decided by the
    // work, so this promise must simply never win. A never-settling promise
    // is the honest shape of "this timer no longer exists".
    () => new Promise<"expired">(() => undefined),
  );
  return {
    expired,
    disarm(): void {
      timer.cancel({ kind: "shutdown" });
      timer.dispose();
    },
  };
}

/**
 * A `ProgressReporter` that records every `warn` into `into` and forwards
 * everything to `inner`.
 *
 * The forward keeps the tree's own `warnings` list intact — a page warning
 * still reaches the run through the reporter exactly once — and the record
 * is what puts it on the per-source status row.
 */
function capturingReporter(
  inner: ProgressReporter,
  into: string[],
): ProgressReporter {
  return {
    setMessage: (message) => {
      inner.setMessage(message);
    },
    setProgress: (completed, total) => {
      inner.setProgress(completed, total);
    },
    increment: (n) => {
      inner.increment(n);
    },
    child: (label, from, to) => inner.child(label, from, to),
    warn: (message, detail) => {
      into.push(message);
      inner.warn(message, detail);
    },
    done: (outcome, message) => {
      inner.done(outcome, message);
    },
  };
}

/**
 * `SerializedError` for anything, including a throw that is not one of ours.
 *
 * `docs/07` §10.1 declares no class for "something untyped threw", and inventing
 * one would be a new error code in a file that may not declare one. The *shape*
 * is §10.1's `SerializedError`; the `code` says plainly that the throw was not
 * typed, and `detail` carries the error's **name** rather than its message,
 * because an arbitrary message has not been through `redact()`.
 *
 * Exported since `P2-T10` (`plan/00` §6 item 79): `searchImportPipeline.ts`
 * kept a private copy for its three other callers (`backfillAbstracts`,
 * `notePartial`, `run()`'s final `catch`) because this one was module-private;
 * it now imports this one, and the copy is gone.
 */
export function serialize(error: unknown): SerializedError {
  if (error instanceof ResearchHelperError) return error.toSerialized();
  return {
    code: "UNTYPED",
    messageKey: "rh-error-source",
    detail: error instanceof Error ? error.name : "non-Error throw",
    retryable: false,
  };
}

/** The report for a source whose `fetchOne` escaped — see the `fanOut` loop. */
function unexpectedFetch(
  source: LiteratureSource,
  requestedLimit: number,
  reason: unknown,
): SourceFetch {
  const error = serialize(reason);
  const banner = `${source.id}: ${error.code} — the other databases were still searched.`;
  return {
    records: [],
    banner,
    report: {
      sourceId: source.id,
      transmittedQuery: "",
      requestedLimit,
      dateFilterApplied: "none",
      recordsRetrieved: 0,
      droppedOutOfWindow: 0,
      keptWithoutDate: 0,
      // Nothing retrieved, so nothing to deduplicate; stays `0` through
      // {@link attributeDeduplicatedAway} as well.
      recordsDeduplicatedAway: 0,
      error,
      warnings: [banner],
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Deduping and Merging — P2-T10
// ---------------------------------------------------------------------------

/**
 * The tag the preprint carries once its published version is known — gate
 * `G-16`'s decision of 2026-10-14. Declared in `src/zotero/itemMapper.ts`,
 * the module that writes it, since `P2-T11` (`zotero/` may not import
 * `pipeline/`, `docs/07` §2.3), and re-exported here, where `P2-T10` first
 * declared it beside the {@link VersionLink} list, so its importers are
 * unchanged.
 */
export { SUPERSEDED_BY_PUBLISHED_TAG };

/** One merged work with the evidence behind it — FR-50 scenario 2's record. */
export interface MergedWork {
  readonly work: CanonicalWork;
  /** The dedup group, in fetch order. Kept, never discarded (`docs/07` §8.3). */
  readonly records: readonly SourceRecord[];
  /**
   * The `"match"` decisions that joined the group — tier fired, confidence,
   * evidence — empty for a singleton. Since `P2-T34` (2026-10-15) they reach
   * `docs/07` §5.3's `SearchProvenance.mergeDecisions` through
   * {@link mergeDecisionsOf}.
   */
  readonly decisions: readonly DedupDecision[];
  /** Identifier conflicts `merge()` found inside the group (`docs/02` §11.5 rule 1). */
  readonly conflicts: readonly IdConflict[];
}

/**
 * A preprint ↔ published pair (or any other `"link"` verdict: a title match
 * with conflicting ids, a same-title different-venue pair). Both works are in
 * the output, **unmerged**; the `zotero/` layer relates the two items and tags
 * the preprint {@link SUPERSEDED_BY_PUBLISHED_TAG}.
 */
export interface VersionLink {
  readonly aWorkKey: string;
  readonly bWorkKey: string;
  /**
   * Which of the two is the preprint, when exactly one side is — by `type`
   * or by a preprint-server DOI prefix. `undefined` when the roles cannot be
   * told apart, in which case the pair is related but nothing is tagged.
   */
  readonly preprintWorkKey: string | undefined;
  readonly decision: DedupDecision;
}

/** What {@link dedupeAndMerge} hands the pipeline at the end of `Merging`. */
export interface DedupeMergeResult {
  /**
   * One record per work — each group's first record in fetch order — so that
   * `SearchImportOutput.records` keeps its positional contract with `works`:
   * `works[i]` was merged from the group whose representative is `records[i]`.
   */
  readonly records: readonly SourceRecord[];
  /** One `CanonicalWork` per group, aligned with {@link records}. */
  readonly works: readonly CanonicalWork[];
  /** The same works with their groups, decisions and conflicts. */
  readonly merged: readonly MergedWork[];
  /** Possible duplicates for review. Never merged (FR-50 scenario 4). */
  readonly flags: readonly DedupPair[];
  /** Pairs kept as two linked works (`docs/02` §11.4, §11.5 rule 1). */
  readonly links: readonly VersionLink[];
  /** Pairs the cascade compared. */
  readonly comparisons: number;
  /** `DedupResult.recordsDeduplicatedAway`: the whole-run figure. */
  readonly recordsDeduplicatedAway: number;
  /**
   * The whole-run figure attributed per source: every record that is not its
   * group's representative is charged to **its own** `sourceId`. Sources with
   * nothing charged are absent.
   */
  readonly deduplicatedAwayBySource: Readonly<
    Partial<Record<SourceId, number>>
  >;
}

/**
 * The `Deduping` and `Merging` bodies for a multi-source run.
 *
 * Calls `dedupeRecords` once over `records` and `merge()` once per group, so
 * the output has one `CanonicalWork` per distinct work with `fieldOrigin`
 * filled, `recordIds` listing every contributor and `seenIn` every source. The
 * two things the cascade reports as *pairs* are passed through as pairs and
 * never reach `merge()`:
 *
 * - a **flag** (`"flag"`) is FR-50 scenario 4's "possible duplicate" and both
 *   records stay separate works;
 * - a **link** (`"link"`) is `docs/02` §11.4's preprint ↔ published relation
 *   or §11.5 rule 1's title-match-with-conflicting-ids, and both works stay,
 *   each carrying the other's identifiers in `relatedVersionIds` so the
 *   `zotero/` layer can relate the two items (gate `G-16`'s decision).
 *
 * Pure apart from the `normalizedAtEpochMs` the caller supplies: no clock, no
 * network, no Zotero.
 *
 * Two entry points over one body (`P2-T30`): {@link dedupeAndMerge} runs the
 * cascade synchronously and {@link dedupeAndMergeAsync} runs
 * `dedupeRecordsAsync`, which yields to the event loop as it compares; the
 * merge of the groups ({@link mergeGroups}) is the same code after either.
 *
 * @param records - the fan-out output, in fetch order
 * @param normalizedAtEpochMs - `ctx.clock.now()`, stamped on every work
 */
export function dedupeAndMerge(
  records: readonly SourceRecord[],
  normalizedAtEpochMs: number,
): DedupeMergeResult {
  return mergeGroups(dedupeRecords(records), normalizedAtEpochMs);
}

/**
 * {@link dedupeAndMerge} with the cascade yielding to the event loop — what
 * `run`'s `Merging` stage awaits (`P2-T30`, `docs/10` NFR-3).
 *
 * The synchronous form is kept because `test/unit/model/merge.test.ts` calls
 * it directly, and that file is outside `P2-T30`'s list; the two return the
 * same {@link DedupeMergeResult} for the same input, asserted in
 * `test/unit/pipeline/searchImport.test.ts`. The cancellation token is
 * checked at every yield inside the cascade, so a Cancel during `Merging`
 * rejects with `OperationCancelledError` within one slice (FR-10).
 *
 * @param records - the fan-out output, in fetch order
 * @param normalizedAtEpochMs - `ctx.clock.now()`, stamped on every work
 * @param options - the token to check at each yield and, for tests, the yield
 */
export async function dedupeAndMergeAsync(
  records: readonly SourceRecord[],
  normalizedAtEpochMs: number,
  options: Omit<DedupeAsyncOptions, "counter"> = {},
): Promise<DedupeMergeResult> {
  const dedup = await dedupeRecordsAsync(records, options);
  return mergeGroups(dedup, normalizedAtEpochMs);
}

/** `merge()` once per group, then the pair lists and per-source figures. */
function mergeGroups(
  dedup: DedupResult,
  normalizedAtEpochMs: number,
): DedupeMergeResult {
  const merged: MergedWork[] = dedup.groups.map((group) => {
    const { work, conflicts } = merge(group.records, normalizedAtEpochMs);
    return {
      work,
      records: group.records,
      decisions: group.decisions,
      conflicts,
    };
  });

  // Which merged work each record ended up in, for the pair lists.
  const indexByRecordId = new Map<string, number>();
  merged.forEach((entry, index) => {
    for (const record of entry.records) indexByRecordId.set(record.id, index);
  });
  const indexOf = (record: SourceRecord): number => {
    const index = indexByRecordId.get(record.id);
    if (index === undefined) {
      throw new RangeError(
        `[research-helper] dedupeAndMerge: record ${record.id} is in no group`,
      );
    }
    return index;
  };

  // Links: both works stay; each learns the other's identifiers.
  const links: VersionLink[] = [];
  for (const pair of dedup.links) {
    const ai = indexOf(pair.a);
    const bi = indexOf(pair.b);
    const a = merged[ai];
    const b = merged[bi];
    if (a === undefined || b === undefined || ai === bi) continue;
    merged[ai] = relate(a, b.work.ids);
    merged[bi] = relate(b, a.work.ids);
    links.push({
      aWorkKey: a.work.workKey,
      bWorkKey: b.work.workKey,
      preprintWorkKey: preprintSide(a.work, b.work),
      decision: pair.decision,
    });
  }

  const deduplicatedAwayBySource: Partial<Record<SourceId, number>> = {};
  for (const entry of merged) {
    for (const record of entry.records.slice(1)) {
      deduplicatedAwayBySource[record.sourceId] =
        (deduplicatedAwayBySource[record.sourceId] ?? 0) + 1;
    }
  }

  const representatives: SourceRecord[] = [];
  for (const entry of merged) {
    const first = entry.records[0];
    if (first === undefined) {
      throw new RangeError("[research-helper] dedupeAndMerge: empty group");
    }
    representatives.push(first);
  }

  return {
    records: representatives,
    works: merged.map((entry) => entry.work),
    merged,
    flags: dedup.flags,
    links,
    comparisons: dedup.comparisons,
    recordsDeduplicatedAway: dedup.recordsDeduplicatedAway,
    deduplicatedAwayBySource,
  };
}

/** `entry` with `other`'s identifiers added to its work's `relatedVersionIds`. */
function relate(entry: MergedWork, other: ExternalIds): MergedWork {
  const related: Record<string, string> = {
    ...(entry.work.relatedVersionIds as Record<string, string> | undefined),
  };
  for (const [key, value] of Object.entries(other)) {
    if (typeof value === "string" && related[key] === undefined) {
      related[key] = value;
    }
  }
  return {
    ...entry,
    work: { ...entry.work, relatedVersionIds: related as ExternalIds },
  };
}

/**
 * FR-50 scenario 2's record: every `"match"` decision of every merged work, as
 * `docs/07` §5.3's {@link MergeDecision} — the work's `workKey`, the tier that
 * fired, its confidence and its evidence — in the order of the works, then of
 * the decisions inside each group. A singleton contributes nothing, so a run
 * that merged nothing yields `[]` (§5.3: "empty, not absent").
 *
 * A decision whose `tier` is `null` is skipped: the cascade gives `null`
 * only to a `"distinct"` verdict, which never joins a group, so the guard
 * exists for the type and drops nothing a real run produces.
 *
 * Called by `run` in `searchImportPipeline.ts` on its `Merging` stage's
 * result (`P2-T34`).
 *
 * @param result - what {@link dedupeAndMerge} / {@link dedupeAndMergeAsync} returned
 * @returns one entry per merge, `[]` when nothing merged
 */
export function mergeDecisionsOf(
  result: Pick<DedupeMergeResult, "merged">,
): readonly MergeDecision[] {
  const out: MergeDecision[] = [];
  for (const entry of result.merged) {
    for (const decision of entry.decisions) {
      if (decision.tier === null) continue;
      out.push({
        workKey: entry.work.workKey,
        tier: decision.tier,
        confidence: decision.confidence,
        evidence: decision.evidence,
      });
    }
  }
  return out;
}

/**
 * Exactly one side a preprint → its key; else undefined.
 *
 * By `type` alone since `P2-T11`: the card's **Do NOT** forbids naming the
 * preprint side by DOI prefix (`docs/02` §11.2), and `P2-T08` made every
 * preprint source map to `type: "preprint"`. The prefix set stays what
 * `preprintServers.ts` calls it — a hint, never a role.
 */
function preprintSide(a: CanonicalWork, b: CanonicalWork): string | undefined {
  const pa = a.type === "preprint";
  const pb = b.type === "preprint";
  if (pa === pb) return undefined;
  return pa ? a.workKey : b.workKey;
}

/**
 * Re-stamp each source's `recordsDeduplicatedAway` from
 * {@link DedupeMergeResult.deduplicatedAwayBySource}.
 *
 * `fetchOne` writes `0` because dedup is cross-source and has not run yet when
 * the fetch report is built; this is the one place the figure becomes true.
 * Reports are returned in the order given, every other member untouched, and
 * a source with nothing charged keeps `0` — `docs/07` §5.3: "`0`, not absent".
 *
 * Called by the pipeline's `run()` in its `Deduping` stage (`P2-T29`) over
 * the {@link DedupeMergeResult} `Merging` just produced. Not called on an
 * import handed its `works` (`P2-T31`): that run asked no source, so it has
 * no report to stamp, and ran no cascade, so it has nothing to stamp from.
 */
export function attributeDeduplicatedAway(
  reports: readonly SearchImportSourceReport[],
  result: Pick<DedupeMergeResult, "deduplicatedAwayBySource">,
): readonly SearchImportSourceReport[] {
  return reports.map((report) => ({
    ...report,
    recordsDeduplicatedAway:
      result.deduplicatedAwayBySource[report.sourceId] ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// 7. Screening — P3-T27
// ---------------------------------------------------------------------------

/**
 * Where the `Screening` stage gets what the job's context does not carry: the
 * `RELEVANCE_SCREEN` template and the adapter's description of a model.
 */
export interface SearchScreeningDeps {
  /**
   * The active `RELEVANCE_SCREEN` template. Defaults to the bundled registry,
   * imported lazily: `src/prompts/bundled.ts` imports `.md` files, which only
   * the esbuild bundles can load (a unit test passes the template instead).
   */
  readonly relevancePrompt?: () => PromptTemplate | Promise<PromptTemplate>;
  /** The adapter's `getModel`, for the privacy check (`relevanceScreen.ts`). */
  readonly modelInfo?: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelInfo | undefined;
}

/** What {@link screenSearchResults} needs. */
export interface ScreenSearchResultsArgs {
  /** One representative per row, as `Merging` left them. */
  readonly records: readonly SourceRecord[];
  /** Aligned with {@link records} once `Merging` has run; may be empty. */
  readonly works: readonly CanonicalWork[];
  readonly options: SearchImportScreeningOptions;
  /** The run's query: the topic when {@link SearchImportScreeningOptions.topic} is absent. */
  readonly query: string;
  readonly ctx: PipelineContext;
  /** The `Screening` stage's reporter. */
  readonly progress: ProgressReporter;
  readonly deps: SearchScreeningDeps | undefined;
}

async function bundledRelevancePrompt(): Promise<PromptTemplate> {
  const { PROMPT_REGISTRY } = await import("../../prompts/bundled");
  return PROMPT_REGISTRY.get("RELEVANCE_SCREEN");
}

/**
 * One row as `{{CANDIDATES_JSON}}` carries it: the merged work's fields when
 * the works are aligned (so a backfilled abstract is what the model reads),
 * the representative's own otherwise.
 */
function candidateOf(
  record: SourceRecord,
  work: CanonicalWork | undefined,
): ScreeningCandidate {
  const w = work ?? record.work;
  return {
    id: record.id,
    title: w.title,
    abstract: w.abstract,
    year: w.publishedDate?.year ?? w.onlineDate?.year,
    venue: w.containerTitle,
    itemType: w.type,
  };
}

/**
 * The `Screening` stage's body (`docs/07` §12.1's note of 2026-10-24): score
 * every row with `RELEVANCE_SCREEN` and record which fall below the run's
 * threshold. **Nothing is removed here** — the rows stay in the output, and
 * the window hides the excluded ones until "Show excluded" is ticked
 * (`docs/12` §3: never hard-filter silently).
 *
 * A failure that is not the run's cancellation — a refused model, a missing
 * key, a budget stop, a network error — leaves every row unscored and is
 * returned as the report's `error`; the search itself still succeeds. Every
 * LLM call carries `budget: ctx.budget` (`relevanceScreen.ts`).
 *
 * @throws OperationCancelledError when the run is cancelled
 */
export async function screenSearchResults(
  args: ScreenSearchResultsArgs,
): Promise<SearchImportScreeningReport> {
  const { records, options, ctx } = args;
  const aligned = args.works.length === records.length;
  const candidates = records.map((record, at) =>
    candidateOf(record, aligned ? args.works[at] : undefined),
  );
  const ids = candidates.map((c) => c.id);
  try {
    const prompt = await (
      args.deps?.relevancePrompt ?? bundledRelevancePrompt
    )();
    const result = await screenRelevance(
      candidates,
      { topic: options.topic ?? args.query },
      {
        llm: ctx.llm,
        budget: ctx.budget,
        token: ctx.token,
        privacy: ctx.privacy,
        config: ctx.config,
        prompt,
        ...(args.deps?.modelInfo !== undefined && {
          modelInfo: args.deps.modelInfo,
        }),
        progress: args.progress,
        logger: ctx.logger,
        traceId: `${ctx.jobId}:screening`,
      },
    );
    return {
      threshold: options.threshold,
      verdicts: result.verdicts,
      unscored: result.unscored,
      excluded: excludedIds(result.verdicts, options.threshold),
      modelId: result.model?.modelId,
      error: undefined,
    };
  } catch (caught) {
    if (caught instanceof OperationCancelledError) throw caught;
    return {
      threshold: options.threshold,
      verdicts: [],
      unscored: ids,
      excluded: [],
      modelId: undefined,
      error: serialize(caught),
    };
  }
}

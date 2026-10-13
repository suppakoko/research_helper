/**
 * The `searchImport` pipeline — `docs/07` §12.1's state machine, run.
 *
 * **Scope.** `P1-T16` steps 1 through 6.
 *
 * ## The three properties this file exists to get right
 *
 * 1. **A source failing is not the run failing.** §12.1: "`PartialFetch` is a
 *    first-class state, not an error", and FR-9 requires the other sources'
 *    results plus a banner naming the failed one. `Fetching` is `./stages.ts`'s
 *    {@link fanOut} (`P2-T02`, wired here by `P2-T27`): the selected sources
 *    are asked **concurrently** under the process-wide `network-metadata` pool,
 *    each in its own `try` with its own deadline, and a throw is **recorded on
 *    that source's report** while the others run on. Only an all-sources
 *    failure is `"failed"`; `fetchStateFromReports` is the one function that
 *    decides it, and {@link fetchOutcome} says why it is applied over the whole
 *    report list rather than to `fanOut`'s own verdict.
 * 2. **Cancellation is checked everywhere §7.4 names, and nothing is rolled
 *    back.** §7.4's per-pipeline rule for `searchImport` is explicit: "items
 *    already written to Zotero are **kept**; the collection is kept with a note
 *    in its description that the import was partial. No rollback — deleting
 *    user-visible items on cancel is surprising and destructive." FR-10's "no
 *    items are created" is about cancelling the *search*, before any write —
 *    conflict `C7`, which `plan/02` §4 resolves exactly that way. So the write
 *    half is batched, a cancel between batches keeps every earlier batch, and
 *    the outcome carries the count.
 * 3. **`Merging` and `Deduping` are honest no-ops.** `P1-T16` step 3 asks for
 *    them as *named* stages so Phase 2 has the seam, and the `Do NOT` forbids
 *    `Deduping` merging anything in Phase 1 — `R-18` makes a false merge the
 *    expensive error and Phase 2 owns the cascade with its labelled corpus.
 *    `Merging` does do one thing, and it is not a merge: see
 *    {@link liftToCanonicalWorks}.
 *
 * ## What this file does not do
 *
 * - **No `compensate()`.** §4.5 makes it optional and describes it as
 *   "best-effort cleanup of partial side effects"; for `searchImport` §7.4 says
 *   there is nothing to clean up, and the one thing that *is* owed on a partial
 *   run — the note on the collection description — is written by `run()` itself,
 *   at the only moment the counts are known. A declared no-op `compensate` would
 *   be dead code that reads as a promise.
 * - **No real `checkpoint()`.** `P1-T16`'s `Do NOT`: Phase 3 owns the persistent
 *   queue, so `resumable` is `false` and `ctx.resumeState` is never read.
 *   `ctx.checkpoint()` *is* called at every stage boundary, because §4.5 says
 *   `run()` must and because Phase 3 then inherits a pipeline that already does.
 * - **No DOM, no adapter call from the UI, no preference read.** §2.3 and
 *   `P1-T16`'s `Do NOT`. The `sources` preference, the `searchYears` span and
 *   `maxResults` all arrive on {@link SearchImportInput}, already resolved.
 *   `validate()` reads `PREFS.maxResults`' declared **range**, which is a schema
 *   constant rather than a stored value — `plan/README.md` §5 rule 4 puts limits
 *   in the schema, so re-typing `10` and `200` here is the thing to avoid.
 */

import { Semaphore } from "../../core/concurrency";
import {
  OperationCancelledError,
  ResearchHelperError,
  type SerializedError,
} from "../../core/errors";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { CanonicalWork } from "../../model/canonicalWork";
import { buildWorkKey, type SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import { PREFS } from "../../prefs/schema";
import type { LiteratureSource } from "../../sources/types";
import {
  stageSlices,
  type Pipeline,
  type PipelineContext,
  type PipelineEstimate,
  type StageSlice,
  type ValidationResult,
} from "../types";
import {
  fanOut,
  fetchStateFromReports,
  NETWORK_METADATA_POOL_SIZE,
  SEARCH_IMPORT_DISPLAY_NAME_KEY,
  SEARCH_IMPORT_STAGES,
  type SearchImportStageKey,
} from "./stages";
import type {
  SearchImportBatchResult,
  SearchImportInput,
  SearchImportOutcome,
  SearchImportOutput,
  SearchImportSourceReport,
  SearchImportWriteReport,
  SearchImportWriteSession,
  SearchImportWriter,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Message ids and literals
// ---------------------------------------------------------------------------

/**
 * `validate()`'s four message ids.
 *
 * `noSources` is the id `P1-T18` already ships —
 * `research-helper-search-databases-none` = "Select at least one database to
 * search." **The other three have no message in either bundle**: verified by
 * grep over `addon/locale/<lang>/research-helper-mainWindow.ftl and -searchDialog.ftl` on 2026-10-07. The bundles
 * and `src/i18n/keys.ts` are `P1-T18`'s files and neither is in `P1-T16`'s
 * `Files` list, so they are declared here and reported rather than added
 * (`plan/README.md` §5 rule 2). `./stages.ts`'s header records the same finding
 * about the seven stage labels.
 */
export const SEARCH_IMPORT_VALIDATION_KEYS = {
  emptyQuery: "research-helper-search-query-empty",
  noSources: "research-helper-search-databases-none",
  limitOutOfRange: "research-helper-search-max-results-range",
  noTarget: "research-helper-search-target-missing",
} as const;

/**
 * The note `docs/07` §7.4 requires on a partially-imported collection.
 *
 * **Not a Fluent message, deliberately.** §7.4 calls it "a note in its
 * description"; the description is a Zotero data field rather than a UI string,
 * and `pipeline/` may not resolve Fluent (§2.3). Localizing it would mean the
 * caller resolving a message and passing it in, which is a decision for the card
 * that owns the writer's real implementation — reported, not taken here.
 */
export const PARTIAL_IMPORT_NOTE_PREFIX =
  "Research Helper: this import was incomplete.";

// ---------------------------------------------------------------------------
// 2. Dependencies
// ---------------------------------------------------------------------------

/** What {@link createSearchImportPipeline} needs from the composition root. */
export interface SearchImportDeps {
  /**
   * The Zotero write surface. See `./types.ts`'s header for why it is a port
   * rather than a direct `src/zotero/importer.ts` import.
   */
  readonly writer: SearchImportWriter;
  /**
   * How many works go into one {@link SearchImportWriteSession.writeBatch}
   * call.
   *
   * **Required, with no default here on purpose.** `FR-6` wants one transaction
   * per batch and `docs/07` §7.2 says to instrument the chunk size;
   * `src/zotero/importer.ts` already declares the number as
   * `DEFAULT_CHUNK_SIZE`, so the composition root passes *that* constant and
   * this file does not acquire a second opinion about it (`plan/README.md` §5
   * rule 4).
   */
  readonly writeBatchSize: number;
  /**
   * The process-wide `network-metadata` pool that `fanOut` runs the sources
   * under — `docs/07` §7.2: one pool of {@link NETWORK_METADATA_POOL_SIZE},
   * not configurable, shared by every run so that two concurrent searches
   * cannot hold eight sockets between them.
   *
   * **Built once, in `src/bootstrap/registerPipelines.ts`, and passed in**
   * (`P2-T27` step 2). The product never omits it.
   *
   * **Optional for one reason only.** `test/integration/searchDialog-flow.spec.ts`
   * constructs this pipeline directly without a pool, and that file is outside
   * `P2-T27`'s `Files`; a required member would fail the type check on a file
   * the card may not edit. When omitted, {@link createSearchImportPipeline}
   * builds **one pool per pipeline instance** — never one per run — so a
   * directly-constructed pipeline still bounds its own fan-out at §7.2's
   * figure. Make this required, and delete that fallback, once that spec
   * passes one; until then the "exactly one pool" rule is enforced at the
   * composition root rather than by the type.
   */
  readonly pool?: Semaphore;
}

// ---------------------------------------------------------------------------
// 3. Run state
// ---------------------------------------------------------------------------

/** Everything one `run()` accumulates, so one `catch` can build the output. */
interface RunState {
  stageReached: SearchImportStageKey;
  records: readonly SourceRecord[];
  works: readonly CanonicalWork[];
  readonly perSource: SearchImportSourceReport[];
  readonly warnings: string[];
  session: SearchImportWriteSession | undefined;
  created: number;
  linkedExisting: number;
  skipped: number;
  failed: number;
  createdWithAbstract: number;
  partialNoteRecorded: boolean;
}

function freshState(): RunState {
  return {
    stageReached: "planning",
    records: [],
    works: [],
    perSource: [],
    warnings: [],
    session: undefined,
    created: 0,
    linkedExisting: 0,
    skipped: 0,
    failed: 0,
    createdWithAbstract: 0,
    partialNoteRecorded: false,
  };
}

// ---------------------------------------------------------------------------
// 4. Pure helpers
// ---------------------------------------------------------------------------

/**
 * `SerializedError` for anything, including a throw that is not one of ours.
 *
 * `docs/07` §10.1 declares no class for "something untyped threw", and inventing
 * one would be a new error code in a file that may not declare one. The *shape*
 * is §10.1's `SerializedError`; the `code` says plainly that the throw was not
 * typed, and `detail` carries the error's **name** rather than its message,
 * because an arbitrary message has not been through `redact()`.
 *
 * **Still here after `P2-T27`, deliberately.** The card asked for this copy to
 * go with the fetch loop, on the premise that only the loop used it; it has
 * three other callers — `backfillAbstracts`, `notePartial` and `run()`'s final
 * `catch` — and `./stages.ts`'s copy is module-private, so removing this one
 * needs an `export` there, which the card's `Files` row for `stages.ts` did
 * not license. One `export` keyword is the whole of the follow-up.
 */
function serialize(error: unknown): SerializedError {
  if (error instanceof ResearchHelperError) return error.toSerialized();
  return {
    code: "UNTYPED",
    messageKey: "rh-error-source",
    detail: error instanceof Error ? error.name : "non-Error throw",
    retryable: false,
  };
}

/**
 * Lift records to `CanonicalWork` — `Merging`'s whole Phase 1 job.
 *
 * **This is not a merge, and the distinction is the point.** `docs/07` §5.1
 * types `SourceRecord.work` as `CanonicalWork` minus `workKey`, `provenance` and
 * `normalizedAtEpochMs`, so **nothing in the corpus converts the one into the
 * other** — grepped 2026-10-07: no function anywhere takes a `SourceRecord` and
 * returns a `CanonicalWork`, while `src/zotero/importer.ts`'s `importWorks()`
 * requires the latter. Minting those three fields is the minimum a one-source
 * run needs, and §12.1 puts it in `Merging`.
 *
 * With two or more sources this function is **replaced**, not extended: Phase 2's
 * cascade (`docs/02` §11.3, `P2-T09`) decides which records are the same work
 * and which source wins each field, and `fieldOrigin` stops being empty.
 *
 * - `workKey` comes from `src/model/ids.ts`'s `buildWorkKey`, which is §5.1's
 *   declared algorithm and the same function `docs/07` §6.6 uses to derive the
 *   key again when an item is read back out of Zotero. Deriving it any other way
 *   here would make that re-read produce a different key.
 * - `provenance.recordIds` is this one record and `seenIn` its one source;
 *   `fieldOrigin` is **empty**, because §5.1 defines it as "which source won for
 *   each contested field" and with one source nothing is contested. Filling it
 *   with `pubmed` for every field would assert a contest that never happened.
 * - `normalizedAtEpochMs` is now — §5.1: "ms since epoch when this canonical
 *   record was last rebuilt". Deliberately not `record.retrievedAtEpochMs`,
 *   which is when the *source* answered.
 *
 * @param records - one run's records, in fetch order
 * @param normalizedAtEpochMs - `ctx.clock.now()`
 * @returns the works, **positionally aligned with `records`**
 */
export function liftToCanonicalWorks(
  records: readonly SourceRecord[],
  normalizedAtEpochMs: number,
): readonly CanonicalWork[] {
  return records.map((record) => {
    const { work } = record;
    return {
      ...work,
      workKey: buildWorkKey(
        work.ids,
        work.title,
        work.publishedDate?.year,
        work.authors[0]?.family,
      ),
      provenance: {
        recordIds: [record.id],
        fieldOrigin: {},
        seenIn: [record.sourceId],
      },
      normalizedAtEpochMs,
    };
  });
}

/** Split into runs of at most `size`. */
function batches<T>(items: readonly T[], size: number): readonly T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * `docs/07` §4.5's `validate()` — "structural validation before a job is
 * created. Cheap, synchronous."
 *
 * A module function rather than only a method, so `run()` can call it without
 * `this` and so a caller can validate an input it has not built a pipeline for.
 */
export function validateSearchImportInput(
  input: SearchImportInput,
): ValidationResult {
  const errors: { field: string; messageKey: string }[] = [];
  const fetching = input.records === undefined;

  // A run that supplies `records` needs no query and no source: it is `P1-T22`
  // step 3's import of a preview the user has already seen.
  if (fetching && input.query.trim() === "") {
    errors.push({
      field: "query",
      messageKey: SEARCH_IMPORT_VALIDATION_KEYS.emptyQuery,
    });
  }
  if (fetching && input.sourceIds.length === 0) {
    errors.push({
      field: "sourceIds",
      messageKey: SEARCH_IMPORT_VALIDATION_KEYS.noSources,
    });
  }
  // The range is `docs/07` §8.5's, read off the preference schema rather than
  // repeated here (`plan/README.md` §5 rule 4). `min`/`max` are inclusive,
  // which `src/prefs/schema.ts` states.
  const { min, max } = PREFS.maxResults;
  if (
    !Number.isInteger(input.limit) ||
    input.limit < min ||
    input.limit > max
  ) {
    errors.push({
      field: "limit",
      messageKey: SEARCH_IMPORT_VALIDATION_KEYS.limitOutOfRange,
    });
  }
  // Records with no target would fetch nothing and write nothing; rejecting it
  // is more useful than returning an empty success.
  if (!fetching && input.target === undefined) {
    errors.push({
      field: "target",
      messageKey: SEARCH_IMPORT_VALIDATION_KEYS.noTarget,
    });
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 5. The pipeline
// ---------------------------------------------------------------------------

/**
 * Build the `searchImport` pipeline.
 *
 * @param deps - the Zotero write port and the write batch size
 * @returns a `docs/07` §4.5 `Pipeline`, ready to register
 * @throws RangeError at construction if the stage weights do not sum to 1 —
 *   `stageSlices` checks it here rather than in the middle of a user's search
 */
export function createSearchImportPipeline(
  deps: SearchImportDeps,
): Pipeline<SearchImportInput, SearchImportOutput> {
  // Computed once, at construction: the slices are a function of the stage
  // declaration alone, and `stageSlices` is also what rejects a weight list
  // that does not sum to 1.
  const slices: readonly StageSlice[] = stageSlices(SEARCH_IMPORT_STAGES);

  // See `SearchImportDeps.pool` for why the fallback exists and why it is one
  // per pipeline instance rather than one per run.
  const pool: Semaphore =
    deps.pool ?? new Semaphore(NETWORK_METADATA_POOL_SIZE);

  const sliceFor = (key: SearchImportStageKey): StageSlice => {
    const slice = slices.find((s) => s.stage.key === key);
    if (slice === undefined) {
      throw new RangeError(
        `[research-helper] no stage "${key}" in searchImport's stage list`,
      );
    }
    return slice;
  };

  /**
   * Enter a stage: check `docs/07` §7.4's between-stages checkpoint, advance the
   * run's `stageReached`, write §4.5's (no-op) checkpoint, and hand back this
   * stage's child reporter.
   */
  async function enterStage(
    state: RunState,
    ctx: PipelineContext,
    key: SearchImportStageKey,
  ): Promise<ProgressReporter> {
    // §7.4 check point 4, "between pipeline stages", **before** anything of the
    // new stage happens — including before the collection is created, which is
    // what makes FR-10's "no items are created" true for a cancel landing here.
    ctx.token.throwIfCancelled();
    state.stageReached = key;
    const slice = sliceFor(key);
    const reporter = ctx.progress.child(key, slice.from, slice.to);
    // §4.5: "Must honour ctx.token and call ctx.checkpoint". A no-op in Phase 1
    // (`resumable: false`), called anyway so Phase 3's queue inherits a pipeline
    // that already reports its stage boundaries.
    await ctx.checkpoint({ stage: key });
    return reporter;
  }

  /** Raise a warning on the run and on the reporter, in that order. */
  function warn(
    state: RunState,
    reporter: ProgressReporter,
    message: string,
  ): void {
    state.warnings.push(message);
    reporter.warn(message);
  }

  /**
   * `docs/07` §12.1's `BackfillingAbstracts`: ask each source for the abstracts
   * its own search did not return.
   *
   * **On the Phase 1 path this does nothing, and that is a fact about the
   * adapter rather than a stub.** §4.2 declares `fetchAbstract` optional and
   * `src/sources/types.ts` records that all three optional members are
   * "declared but implemented by nobody in Phase 1", so the check below is false
   * for PubMed and no call is made. It is written anyway, because a Phase 2
   * adapter that implements `fetchAbstract` then needs no change here — and
   * because the *count* of works without an abstract is `R-17`'s subject and is
   * worth logging even when nothing can be done about it.
   *
   * `docs/01` §6.3 step 4's backfill is a **different** step with the same word
   * in it: that one repairs a Zotero field after `fromJSON()` dropped it, and it
   * lives inside the writer.
   */
  async function backfillAbstracts(
    state: RunState,
    ctx: PipelineContext,
    stage: ProgressReporter,
  ): Promise<void> {
    const missing = state.works.filter(
      (work) => work.abstract === undefined || work.abstract === "",
    );
    if (missing.length === 0) return;

    stage.setProgress(0, missing.length);
    const repaired: CanonicalWork[] = [];
    for (const work of missing) {
      // §7.4 check point 1: one potential network call per work, so one check
      // per work.
      ctx.token.throwIfCancelled();
      const sourceId = work.provenance.seenIn[0];
      const source =
        sourceId === undefined ? undefined : ctx.sources.get(sourceId);
      const fetchAbstract = source?.fetchAbstract;
      if (source === undefined || fetchAbstract === undefined) {
        stage.increment();
        continue;
      }
      try {
        const abstract = await fetchAbstract.call(source, work.ids, {
          token: ctx.token,
          progress: stage,
        });
        if (abstract !== undefined && abstract !== "") {
          repaired.push({ ...work, abstract });
        }
      } catch (caught) {
        if (caught instanceof OperationCancelledError) throw caught;
        // A missing abstract is a degraded record, never a failed run.
        warn(
          state,
          stage,
          `${source.id}: could not backfill an abstract ` +
            `(${serialize(caught).code}).`,
        );
      }
      stage.increment();
    }

    if (repaired.length > 0) {
      const byKey = new Map(repaired.map((work) => [work.workKey, work]));
      state.works = state.works.map((work) => byKey.get(work.workKey) ?? work);
    }
    ctx.logger.debug("searchImport: abstracts missing after fetch", {
      missing: missing.length,
      backfilled: repaired.length,
    });
  }

  /** The checked subset of `state.works`, in fetch order. */
  function selectedWorks(
    state: RunState,
    selectedRecordIds: readonly string[] | undefined,
  ): readonly CanonicalWork[] {
    if (selectedRecordIds === undefined) return state.works;
    const wanted = new Set(selectedRecordIds);
    // Indexed by position: `works[i]` was lifted from `records[i]`, which is the
    // ordering contract `liftToCanonicalWorks` keeps. Matching on `workKey`
    // instead would conflate two records that share a DOI, which is exactly the
    // dedup decision Phase 1 is forbidden to make.
    return state.works.filter((_work, index) => {
      const record = state.records[index];
      return record !== undefined && wanted.has(record.id);
    });
  }

  /** Add one batch's counts to the run. */
  function accumulate(state: RunState, result: SearchImportBatchResult): void {
    state.created += result.created;
    state.linkedExisting += result.linkedExisting;
    state.skipped += result.skipped;
    state.failed += result.failed;
    state.createdWithAbstract += result.createdWithAbstract;
  }

  /** `CreatingCollection` then `WritingItems`. */
  async function writeHalf(
    state: RunState,
    input: SearchImportInput,
    ctx: PipelineContext,
  ): Promise<void> {
    const { target } = input;
    if (target === undefined) {
      // FR-5's preview run. Both stages are marked complete so the bar still
      // reaches 1; nothing is written and no collection is created.
      (await enterStage(state, ctx, "creatingCollection")).done("succeeded");
      (await enterStage(state, ctx, "writingItems")).done("succeeded");
      return;
    }

    const creating = await enterStage(state, ctx, "creatingCollection");
    creating.setProgress(0, 1);
    // The **first** Zotero write of the run. Nothing above this line touches
    // the library, which is what makes FR-10's "no items are created" a
    // property of the code rather than a promise.
    const session = await deps.writer.openTarget(target, ctx.token);
    state.session = session;
    creating.done("succeeded");

    const selected = selectedWorks(state, target.selectedRecordIds);
    const writing = await enterStage(state, ctx, "writingItems");
    writing.setProgress(0, selected.length);

    for (const batch of batches(selected, deps.writeBatchSize)) {
      // §7.4's "each write batch". A cancel here keeps every earlier batch: the
      // counts are already on `state`, and `run()`'s `catch` turns them into a
      // `"cancelled"` outcome carrying a real number.
      ctx.token.throwIfCancelled();
      accumulate(state, await session.writeBatch(batch, ctx.token));
      // `increment`, not `setProgress(n)`: `P1-T15` measured that
      // `setProgress(completed)` with `total` omitted **resets a known total to
      // indeterminate**, because §4.1 says "total === undefined means
      // indeterminate". `increment()` is the call that keeps one.
      writing.increment(batch.length);
    }
    writing.done("succeeded");
  }

  /**
   * `docs/07` §7.4's partial-import note, once, when a session was opened and
   * the run did not finish.
   *
   * Best-effort: a failure to annotate must not replace the outcome the caller
   * is about to render, and the collection and its items are kept either way.
   */
  async function notePartial(
    state: RunState,
    ctx: PipelineContext,
    outcome: SearchImportOutcome,
  ): Promise<void> {
    const { session } = state;
    if (session === undefined || state.partialNoteRecorded) return;
    try {
      await session.notePartialImport(
        `${PARTIAL_IMPORT_NOTE_PREFIX} Outcome: ${outcome}; ` +
          `stage: ${state.stageReached}; ` +
          `items created: ${String(state.created)}; ` +
          `linked: ${String(state.linkedExisting)}.`,
      );
      state.partialNoteRecorded = true;
    } catch (caught) {
      ctx.logger.warn(
        "searchImport: could not record the partial-import note; the " +
          "collection and its items are kept regardless (docs/07 §7.4)",
        { code: serialize(caught).code },
      );
    }
  }

  /** Build the output from whatever the run accumulated. */
  function toOutput(
    state: RunState,
    input: SearchImportInput,
    outcome: SearchImportOutcome,
    error: SerializedError | undefined,
    cancellationKind: string | undefined,
  ): SearchImportOutput {
    const { session } = state;
    const write: SearchImportWriteReport | undefined =
      session === undefined || input.target === undefined
        ? undefined
        : {
            libraryId: session.libraryId,
            collectionKey: session.collectionKey,
            collectionName: input.target.collectionName,
            collectionCreated: session.collectionCreated,
            created: state.created,
            linkedExisting: state.linkedExisting,
            skipped: state.skipped,
            failed: state.failed,
            // Weighted by created items across batches, not averaged over
            // batches: a final batch of one must not move it as far as fifty.
            abstractCoveragePercent:
              state.created === 0
                ? 0
                : Math.round((state.createdWithAbstract / state.created) * 100),
            partialNoteRecorded: state.partialNoteRecorded,
          };

    return {
      outcome,
      stageReached: state.stageReached,
      records: state.records,
      works: state.works,
      perSource: state.perSource,
      write,
      warnings: state.warnings,
      error,
      cancellationKind,
    };
  }

  return {
    id: "searchImport",
    displayNameKey: SEARCH_IMPORT_DISPLAY_NAME_KEY,
    stages: SEARCH_IMPORT_STAGES,
    // `P1-T16`'s `Do NOT`: Phase 3 owns the persistent queue, so a checkpointed
    // job of this type cannot be resumed and says so.
    resumable: false,

    validate: validateSearchImportInput,

    estimate(
      input: SearchImportInput,
      ctx: PipelineContext,
    ): Promise<PipelineEstimate> {
      // `P1-T16` step 1: "a trivial `estimate()` returning request counts and
      // zero cost — Phase 1 spends no money, but §11.3 requires the member to
      // exist."
      const sources = input.sourceIds
        .map((id) => ctx.sources.get(id))
        .filter((source): source is LiteratureSource => source !== undefined);
      // Per source: the pages `searchAll` will walk, each page costing two
      // round trips on the PubMed path (`docs/02` §3.3's `esearch` then §3.4's
      // `efetch`). Derived from each adapter's own declared page size rather
      // than guessed.
      const externalRequests = sources.reduce((total, source) => {
        const pageSize = Math.max(1, source.capabilities.maxPageSize);
        return total + Math.ceil(input.limit / pageSize) * 2;
      }, 0);
      return Promise.resolve({
        itemCount: input.limit * sources.length,
        externalRequests,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        // `undefined`, not `0`: §4.5 types it `number | undefined`, and "we do
        // not know" is a different claim from "it is free". Phase 1 calls no
        // priced API, so there is nothing to know.
        estimatedCostUsd: undefined,
        estimatedDurationSeconds: 0,
        notesKeys: [],
      });
    },

    async run(
      input: SearchImportInput,
      ctx: PipelineContext,
    ): Promise<SearchImportOutput> {
      const state = freshState();

      try {
        // ---- Planning -----------------------------------------------------
        const planning = await enterStage(state, ctx, "planning");
        const validation = validateSearchImportInput(input);
        if (!validation.ok) {
          // §12.1: `Planning --> Failed : invalid query`.
          planning.done("failed");
          return toOutput(
            state,
            input,
            "failed",
            {
              code: "CONFIGURATION",
              messageKey: validation.errors[0]?.messageKey ?? "rh-error-source",
              detail: `searchImport input rejected: ${validation.errors
                .map((e) => e.field)
                .join(", ")}`,
              retryable: false,
            },
            undefined,
          );
        }

        const resolved: LiteratureSource[] = [];
        if (input.records === undefined) {
          for (const id of input.sourceIds) {
            const source = ctx.sources.get(id);
            if (source === undefined) {
              // A selected source this build has no adapter for. Not a failure
              // of the run — FR-9's shape — and not silent either.
              warn(
                state,
                planning,
                `${id}: this build has no adapter for that database.`,
              );
              state.perSource.push(missingAdapterReport(id, input.limit));
              continue;
            }
            resolved.push(source);
          }
        }
        planning.done("succeeded");

        // ---- Fetching -----------------------------------------------------
        const fetching = await enterStage(state, ctx, "fetching");
        if (input.records === undefined) {
          // `P2-T27`: the sources are asked concurrently under the pool, each
          // isolated and under its own deadline. `fanOut` throws only for the
          // run's own cancellation, and only after every source has settled,
          // so the `catch` below never races an adapter still writing.
          const fetched = await fanOut({
            sources: resolved,
            input,
            token: ctx.token,
            clock: ctx.clock,
            progress: fetching,
            logger: ctx.logger,
            pool,
          });
          state.perSource.push(...fetched.perSource);
          // The FR-9 banners only — `fanOut` has already raised each one on
          // `fetching`. An adapter's own page warnings reached the reporter
          // once, through the per-source child, and sit on that source's
          // report; they are not run-level warnings.
          state.warnings.push(...fetched.warnings);
          state.records = fetched.records;
        } else {
          // `P1-T22` step 3's import of an already-rendered preview. The stage
          // is still entered and completed, so the bar behaves the same either
          // way.
          state.records = input.records;
        }
        fetching.done("succeeded");

        // §12.1: `Fetching --> Failed : all sources failed`. Checked here so a
        // run that could not reach a single database does not go on to create
        // an empty collection.
        if (fetchOutcome(state, input) === "failed") {
          return toOutput(
            state,
            input,
            "failed",
            {
              code: "SOURCE",
              messageKey: "rh-error-source",
              detail:
                "every selected database failed: " +
                state.perSource.map((r) => r.sourceId).join(", "),
              retryable: true,
            },
            undefined,
          );
        }

        // ---- Merging ------------------------------------------------------
        const merging = await enterStage(state, ctx, "merging");
        // A named no-op as far as *merging* goes (`P1-T16` step 3): with one
        // source there is nothing to reconcile. What it does do is lift the
        // records to `CanonicalWork`, which has to happen somewhere and which
        // §12.1 puts here. See {@link liftToCanonicalWorks}.
        state.works = liftToCanonicalWorks(state.records, ctx.clock.now());
        merging.done("succeeded");

        // ---- Deduping -----------------------------------------------------
        const deduping = await enterStage(state, ctx, "deduping");
        // A true no-op, and it must stay one in Phase 1: `P1-T16`'s `Do NOT`
        // and `R-18` — a false merge is the expensive error, and Phase 2 owns
        // the cascade with its labelled corpus. The *library* duplicate check
        // is a different mechanism and happens inside the writer
        // (`src/zotero/importer.ts`'s dedup pass, `FR-51`).
        deduping.done("succeeded");

        // ---- BackfillingAbstracts -----------------------------------------
        const backfilling = await enterStage(
          state,
          ctx,
          "backfillingAbstracts",
        );
        await backfillAbstracts(state, ctx, backfilling);
        backfilling.done("succeeded");

        // ---- CreatingCollection, WritingItems -----------------------------
        await writeHalf(state, input, ctx);

        // A partial fetch is still a *completed* run (FR-9), so nothing above
        // reported a failure; the banner comes from the outcome and the
        // warnings.
        return toOutput(
          state,
          input,
          fetchOutcome(state, input),
          undefined,
          undefined,
        );
      } catch (caught) {
        if (caught instanceof OperationCancelledError) {
          // §7.4: no rollback. Whatever is written stays, and the collection
          // keeps a note that the import was partial.
          await notePartial(state, ctx, "cancelled");
          ctx.logger.info("searchImport cancelled", {
            stage: state.stageReached,
            created: state.created,
          });
          return toOutput(
            state,
            input,
            "cancelled",
            undefined,
            caught.reason.kind,
          );
        }
        // §12.1: `WritingItems --> Failed : Zotero write error`. Same rule —
        // nothing is undone.
        await notePartial(state, ctx, "failed");
        return toOutput(state, input, "failed", serialize(caught), undefined);
      }
    },
  };
}

/** The report for a selected source this build has no adapter for. */
function missingAdapterReport(
  sourceId: SourceId,
  requestedLimit: number,
): SearchImportSourceReport {
  return {
    sourceId,
    transmittedQuery: "",
    requestedLimit,
    dateFilterApplied: "none",
    recordsRetrieved: 0,
    droppedOutOfWindow: 0,
    keptWithoutDate: 0,
    recordsDeduplicatedAway: 0,
    error: {
      code: "CONFIGURATION",
      messageKey: "rh-error-configuration",
      detail: `no adapter registered for source "${sourceId}"`,
      retryable: false,
    },
    warnings: [],
  };
}

/**
 * The outcome the fetch half implies — `docs/07` §12.1's `Fetching →
 * PartialFetch` / `Fetching → Failed` test, over **every** per-source report.
 *
 * `./stages.ts`'s `fetchStateFromReports` is the one state function left after
 * `P2-T27` step 3. Its predecessor here, `outcomeFromReports`, keyed on
 * productivity alone and called "one source errored, one healthy with zero
 * hits" a failure. The kept reading rests on §12.1's edge `Fetching --> Failed
 * : all sources failed`: a healthy source that found nothing did not fail, so
 * that run is `"partial"`. `P1-T16`'s first criterion — a source that threw
 * after yielding is degraded, not failed, and its page 1 is kept — holds under
 * both readings and is still asserted by the pipeline's own tests.
 *
 * Applied to `state.perSource` rather than to `fanOut`'s own `state`, because
 * the list also carries `Planning`'s {@link missingAdapterReport} rows, which
 * `fanOut` never saw: a run whose only adapter-less source sits beside a
 * healthy one is `"partial"` on the whole list and would be `"succeeded"` on
 * `fanOut`'s view alone.
 *
 * A run that was handed its records did not ask any source, so it has no
 * per-source verdict to aggregate and is `"succeeded"` on that count.
 */
function fetchOutcome(
  state: RunState,
  input: SearchImportInput,
): SearchImportOutcome {
  if (input.records !== undefined || state.perSource.length === 0) {
    return "succeeded";
  }
  return fetchStateFromReports(state.perSource);
}

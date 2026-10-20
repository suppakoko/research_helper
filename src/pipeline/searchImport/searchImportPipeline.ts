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
 *    failure — every source that *searches* (item 204) — is `"failed"`;
 *    `fetchStateFromReports` is the one function that
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
 * 3. **`Merging` and `Deduping` are one body, `./stages.ts`'s
 *    {@link dedupeAndMergeAsync}** (`P2-T10`, wired here by `P2-T29`; made to
 *    yield to the event loop by `P2-T30`, because the unchunked cascade stalled
 *    the main thread 246–274 ms on a 100-record import against NFR-3's
 *    100 ms). Phase 1 ran
 *    both stages as named no-ops — `P1-T16`'s `Do NOT` forbade `Deduping`
 *    merging anything because `R-18` makes a false merge the expensive error
 *    — and lifted records to `CanonicalWork` one-for-one. Phase 2 owns the
 *    cascade with its labelled corpus (`P2-T09`), so the run now folds the
 *    records that are the same work into **one** `CanonicalWork` with every
 *    contributing source in `seenIn`, keeps a preprint and its published
 *    version as two linked works (gate `G-16`), passes possible duplicates
 *    through as `flags` for review (FR-50 scenario 4), and stamps each
 *    source's `recordsDeduplicatedAway` through `attributeDeduplicatedAway`.
 *    `records` and `works` stay positionally aligned: `records[i]` is the
 *    representative of the group `works[i]` was merged from, which is the
 *    contract {@link selectedWorks} reads. **The import of a preview hands
 *    that pair back** (`SearchImportInput.works` beside `records`, `P2-T31`)
 *    and `Merging` then writes the works through as given — the cascade is
 *    not run again over representatives, which would have made each work a
 *    singleton of one source and lost every field the other contributors
 *    won. `records` alone still merges, for a caller holding raw records.
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

import type { Semaphore } from "../../core/concurrency";
import {
  OperationCancelledError,
  type SerializedError,
} from "../../core/errors";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { MergeDecision } from "../../core/provenance";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { SourceId } from "../../model/ids";
import { areOtherVersions } from "../../model/merge";
import type { SourceRecord } from "../../model/sourceRecord";
import { PREFS } from "../../prefs/schema";
import type { DedupPair } from "../../sources/shared/dedupe";
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
  attributeDeduplicatedAway,
  dedupeAndMergeAsync,
  fanOut,
  fetchStateFromReports,
  lookupOnlySourceIds,
  mergeDecisionsOf,
  SEARCH_IMPORT_DISPLAY_NAME_KEY,
  SEARCH_IMPORT_STAGES,
  serialize,
  type DedupeMergeResult,
  type SearchImportStageKey,
  type VersionLink,
} from "./stages";
import { abstractBackfillRequestBound, backfillAbstracts } from "./backfill";
import type {
  SearchImportBatchResult,
  SearchImportInput,
  SearchImportOutcome,
  SearchImportOutput,
  SearchImportPathCounts,
  SearchImportSourceReport,
  SearchImportWriteReport,
  SearchImportWriteSession,
  SearchImportWriter,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Message ids and literals
// ---------------------------------------------------------------------------

/**
 * `validate()`'s five message ids.
 *
 * `noSources` is the id `P1-T18` already ships —
 * `research-helper-search-databases-none` = "Select at least one database to
 * search." **The other four have no message in either bundle**: three were
 * verified absent by grep over `addon/locale/<lang>/research-helper-mainWindow.ftl and -searchDialog.ftl` on 2026-10-07, and
 * `worksMisaligned` (`P2-T31`) was declared the same way on 2026-10-14. The
 * bundles and `src/i18n/keys.ts` are `P1-T18`'s files and in neither
 * `P1-T16`'s nor `P2-T31`'s `Files` list, so they are declared here and
 * reported rather than added (`plan/README.md` §5 rule 2). `./stages.ts`'s
 * header records the same finding about the seven stage labels.
 * `worksMisaligned` is also the one of the five no window can trigger: the
 * view model hands back a pair the pipeline itself produced aligned.
 */
export const SEARCH_IMPORT_VALIDATION_KEYS = {
  emptyQuery: "research-helper-search-query-empty",
  noSources: "research-helper-search-databases-none",
  limitOutOfRange: "research-helper-search-max-results-range",
  noTarget: "research-helper-search-target-missing",
  worksMisaligned: "research-helper-search-works-misaligned",
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
   * under — `docs/07` §7.2: one pool of `NETWORK_METADATA_POOL_SIZE`
   * (`./stages.ts`), not configurable, shared by every run so that two
   * concurrent searches cannot hold eight sockets between them.
   *
   * **Built once, in `src/bootstrap/registerPipelines.ts`, and passed in**
   * (`P2-T27` step 2). Required: this file constructs no pool of its own, so
   * "exactly one pool" is enforced by the type. `P2-T27` had left it optional
   * with a per-instance fallback only because
   * `test/integration/searchDialog-flow.spec.ts` constructed the pipeline
   * without one; `P2-T28` passed that spec a pool and deleted the fallback.
   */
  readonly pool: Semaphore;
  /**
   * The yield `Merging`'s cascade makes between slices (`P2-T30`, NFR-3).
   *
   * Optional, and the composition root does not pass it: the default is
   * `src/sources/shared/dedupe.ts`'s `defaultYieldToEventLoop`, a
   * `setTimeout(…, 0)` macrotask. Injectable for the same reason
   * `src/zotero/importer.ts`'s `ImportRequest.yieldToUi` is — so a unit test
   * can count the yields and cancel inside one, instead of inferring either
   * from timing.
   */
  readonly yieldToEventLoop?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// 3. Run state
// ---------------------------------------------------------------------------

/** Everything one `run()` accumulates, so one `catch` can build the output. */
interface RunState {
  stageReached: SearchImportStageKey;
  /** One representative per work after `Merging`; the fetch output before. */
  records: readonly SourceRecord[];
  works: readonly CanonicalWork[];
  /** FR-50 scenario 4's possible duplicates, kept apart for review. */
  flags: readonly DedupPair[];
  /** Pairs kept as two linked works — preprint ↔ published (gate `G-16`). */
  links: readonly VersionLink[];
  /** FR-50 scenario 2's record of every merge `Merging` made (`P2-T34`). */
  mergeDecisions: readonly MergeDecision[];
  /**
   * Reassigned once, by `Deduping`, when `attributeDeduplicatedAway` re-stamps
   * every report; pushed to by `Planning` and `Fetching` before that.
   */
  perSource: SearchImportSourceReport[];
  /**
   * The asked sources whose `capabilities.keywordSearch` is `false`, set by
   * `Planning` — what {@link fetchOutcome} leaves out of "every source
   * failed" (`plan/00` §6 item 204).
   */
  lookupOnly: ReadonlySet<SourceId>;
  readonly warnings: string[];
  session: SearchImportWriteSession | undefined;
  created: number;
  linkedExisting: number;
  skipped: number;
  failed: number;
  createdWithAbstract: number;
  /**
   * Strategy B's counts, summed over the batches that carried them; stays
   * `undefined` while no batch did (item 212).
   */
  importPaths: SearchImportPathCounts | undefined;
  partialNoteRecorded: boolean;
}

function freshState(): RunState {
  return {
    stageReached: "planning",
    records: [],
    works: [],
    flags: [],
    links: [],
    mergeDecisions: [],
    perSource: [],
    lookupOnly: new Set(),
    warnings: [],
    session: undefined,
    created: 0,
    linkedExisting: 0,
    skipped: 0,
    failed: 0,
    createdWithAbstract: 0,
    importPaths: undefined,
    partialNoteRecorded: false,
  };
}

/**
 * `a + b`, field by field — Strategy B's counts over two batches (item 212).
 * `a` is `undefined` before the first batch that carried any.
 */
function addPathCounts(
  a: SearchImportPathCounts | undefined,
  b: SearchImportPathCounts,
): SearchImportPathCounts {
  if (a === undefined) {
    return { ...b, fallbackReasons: { ...b.fallbackReasons } };
  }
  const fallbackReasons = { ...a.fallbackReasons };
  for (const reason of Object.keys(
    b.fallbackReasons,
  ) as (keyof typeof fallbackReasons)[]) {
    fallbackReasons[reason] += b.fallbackReasons[reason];
  }
  return {
    viaTranslators: a.viaTranslators + b.viaTranslators,
    handMapped: a.handMapped + b.handMapped,
    fallbackReasons,
  };
}

// ---------------------------------------------------------------------------
// 4. Pure helpers
// ---------------------------------------------------------------------------

// `liftToCanonicalWorks` — Phase 1's one-record-one-work lift — lived here
// until `P2-T29` and was deleted rather than kept: `./stages.ts`'s
// `dedupeAndMerge` is the one route from `SourceRecord`s to `CanonicalWork`s,
// and a singleton group through `src/model/merge.ts`'s `merge()` mints the same
// `workKey` (`buildWorkKey`), the same one-entry `recordIds`/`seenIn` and the
// same empty `fieldOrigin` the lift did. Nothing in `src/` called it; the one
// remaining mention is a doc comment in `src/zotero/itemMapper.ts`.

/**
 * Split the works to write into batches of `size`, **never separating two
 * versions of one work** (`P2-T11`, gate `G-16`).
 *
 * The writer relates a preprint and its published version through Zotero
 * *Related* only when one `writeBatch` creates both (`docs/07` §6.2's
 * `relatedVersionIds.doi` rows; the library index is a snapshot from before
 * the run, so a later batch cannot see an earlier batch's items). So the
 * versions of a work — every work {@link areOtherVersions} connects to it,
 * transitively — are placed together, at the position of the first of them,
 * and a batch is closed once it reaches `size`. A batch can therefore exceed
 * `size` by the members of one version group less one. With no versions
 * among the works this is a plain split into runs of `size`, in order.
 *
 * Exported for the unit test.
 *
 * @param works - the selected works, in table order
 * @param size - the pipeline's `writeBatchSize`
 */
export function versionAwareBatches(
  works: readonly CanonicalWork[],
  size: number,
): readonly CanonicalWork[][] {
  // Union–find over positions; only works that name another can start an edge.
  const parent = works.map((_work, i) => i);
  const find = (i: number): number => {
    let x = i;
    while ((parent[x] ?? x) !== x) x = parent[x] ?? x;
    return x;
  };
  works.forEach((work, i) => {
    if (work.relatedVersionIds === undefined) return;
    works.forEach((other, j) => {
      if (i === j || !areOtherVersions(work, other)) return;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    });
  });
  const groups = new Map<number, CanonicalWork[]>();
  works.forEach((work, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [work]);
    else group.push(work);
  });

  const out: CanonicalWork[][] = [];
  let current: CanonicalWork[] = [];
  for (const group of groups.values()) {
    current.push(...group);
    if (current.length >= size) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
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
  // `works` is read by position against `records` (`selectedWorks`), so a
  // list with nothing to align with, or of another length, would write the
  // wrong work for a checked row — or `undefined` — silently. Rejected here,
  // before `Planning` ends (`P2-T31`).
  if (
    input.works !== undefined &&
    (fetching || input.works.length !== input.records.length)
  ) {
    errors.push({
      field: "works",
      messageKey: SEARCH_IMPORT_VALIDATION_KEYS.worksMisaligned,
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
   * `docs/07` §12.1's `BackfillingAbstracts`: `./backfill.ts`'s batched pass
   * (`P2-T12`, `docs/02` §10.4) over the merged works.
   *
   * Until `P2-T12` this stage asked `seenIn[0]`'s `fetchAbstract` once per
   * work — one request per record, which §10.4 forbids. It now runs §10.4's
   * ladder of batched `lookup`s — a handful of requests at any import size —
   * and the winning source lands in `provenance.fieldOrigin.abstract`. A
   * failed step is a run warning; only a cancellation leaves by a throw, and
   * then `state.works` is still exactly what `Merging` left.
   *
   * **Not run on the import of a preview's own works** (`input.works`,
   * `P2-T31`): the preview run that produced them already went through this
   * stage, so asking again would spend the same requests on the same DOIs —
   * the reason `Merging` does not re-run the cascade on that path either. The
   * stage is still entered and completed, so the bar behaves the same.
   *
   * `docs/01` §6.3 step 4's backfill is a **different** step with the same word
   * in it: that one repairs a Zotero field after `fromJSON()` dropped it, and it
   * lives inside the writer.
   */
  async function backfillStage(
    state: RunState,
    input: SearchImportInput,
    ctx: PipelineContext,
    stage: ProgressReporter,
  ): Promise<void> {
    if (input.works !== undefined) return;
    const result = await backfillAbstracts(state.works, {
      sources: ctx.sources,
      // Only the databases the user ticked (owner, 2026-10-15, item 194).
      selected: input.sourceIds,
      // A backfilled work is rebuilt, so it is restamped (item 198).
      now: () => ctx.clock.now(),
      token: ctx.token,
      progress: stage,
      checkpoint: (checkpointState) => ctx.checkpoint(checkpointState),
      logger: ctx.logger,
    });
    state.works = result.works;
    // Each line already reached `stage.warn` inside the pass.
    state.warnings.push(...result.warnings);
  }

  /** The checked subset of `state.works`, in fetch order. */
  function selectedWorks(
    state: RunState,
    selectedRecordIds: readonly string[] | undefined,
  ): readonly CanonicalWork[] {
    if (selectedRecordIds === undefined) return state.works;
    const wanted = new Set(selectedRecordIds);
    // Indexed by position: `works[i]` was merged from the group whose
    // **representative** is `records[i]` — `DedupeMergeResult`'s contract,
    // one record per work in fetch order. The table renders exactly those
    // representatives, so a checked row's id is always a representative's; an
    // id belonging to a record that was folded into another work selects
    // nothing, because that record is no row.
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
    // Only a batch Strategy B wrote carries counts, so a run with
    // `useTranslators` off leaves this `undefined` and its summary unchanged.
    if (result.importPaths !== undefined) {
      state.importPaths = addPathCounts(state.importPaths, result.importPaths);
    }
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

    for (const batch of versionAwareBatches(selected, deps.writeBatchSize)) {
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
            ...(state.importPaths !== undefined && {
              importPaths: state.importPaths,
            }),
          };

    return {
      outcome,
      stageReached: state.stageReached,
      records: state.records,
      works: state.works,
      flags: state.flags,
      links: state.links,
      mergeDecisions: state.mergeDecisions,
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
      //
      // **Zero search requests whenever no search is sent** (owner,
      // 2026-10-20, `plan/00` §6 item 231). Read off `run()` below, a run
      // sends no search in exactly three cases:
      // 1. `validate` rejects the input. `Planning` returns `failed` before
      //    any stage that could send a request, so nothing at all is sent.
      // 2. The input supplies `records`, with or without `works`. `Planning`
      //    resolves no source and `Fetching` takes the records as given.
      // 3. No ticked source can search: each is absent from the registry or
      //    lookup-only (`keywordSearch: false`, item 180). `fanOut` asks
      //    nothing that sends a request. This needs no branch: `searching`
      //    below is empty, and so is the work count the backfill is charged.
      if (!validateSearchImportInput(input).ok) {
        return Promise.resolve(requestEstimate(0, 0));
      }
      if (input.records !== undefined) {
        // `BackfillingAbstracts` still runs on supplied records **unless**
        // `works` came with them: that pair is a preview's own output, and
        // `backfillStage` returns at once (`P2-T31`; owner, 2026-10-19,
        // `plan/00` §6 item 229). Without `works`, `Merging` folds the
        // records into at most one work each, so the records are the bound.
        // The item count is likewise an upper bound — `Merging` may fold and
        // `selectedRecordIds` may write fewer.
        const backfillRequests =
          input.works === undefined
            ? abstractBackfillRequestBound(
                input.records.length,
                input.sourceIds,
                ctx.sources,
              )
            : 0;
        return Promise.resolve(
          requestEstimate(
            input.works?.length ?? input.records.length,
            backfillRequests,
          ),
        );
      }
      const sources = input.sourceIds
        .map((id) => ctx.sources.get(id))
        .filter((source): source is LiteratureSource => source !== undefined);
      // Per source: the pages `searchAll` will walk, each page costing two
      // round trips on the PubMed path (`docs/02` §3.3's `esearch` then §3.4's
      // `efetch`). Derived from each adapter's own declared page size rather
      // than guessed. A source with `capabilities.keywordSearch: false`
      // (bioRxiv, medRxiv) sends nothing during a search, so it is charged
      // nothing (owner, 2026-10-19, `plan/00` §6 item 180).
      const searching = sources.filter(
        (source) => source.capabilities.keywordSearch,
      );
      const searchRequests = searching.reduce((total, source) => {
        const pageSize = Math.max(1, source.capabilities.maxPageSize);
        return total + Math.ceil(input.limit / pageSize) * 2;
      }, 0);
      // `BackfillingAbstracts` (item 198): the batched ladder's worst case —
      // one Europe PMC request and one Semantic Scholar request per 100
      // works, for ticked ladder databases only. **An upper bound:** the pass
      // asks only works that still have no abstract, and charging every work
      // assumes none came with one. The run can hold at most `limit` works
      // per searching source when the pass starts.
      const backfillRequests = abstractBackfillRequestBound(
        input.limit * searching.length,
        input.sourceIds,
        ctx.sources,
      );
      return Promise.resolve(
        requestEstimate(
          // Searching sources only: a lookup-only source yields no record on
          // a keyword run, so it adds no item either (owner, 2026-10-19;
          // `plan/00` §6 item 229).
          input.limit * searching.length,
          searchRequests + backfillRequests,
        ),
      );
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
        state.lookupOnly = lookupOnlySourceIds(resolved);
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
            pool: deps.pool,
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
              // The errored sources only: since item 204 a quiet lookup-only
              // source can sit beside them, and it did not fail.
              detail:
                "every selected database failed: " +
                state.perSource
                  .filter((r) => r.error !== undefined)
                  .map((r) => r.sourceId)
                  .join(", "),
              retryable: true,
            },
            undefined,
          );
        }

        // ---- Merging ------------------------------------------------------
        const merging = await enterStage(state, ctx, "merging");
        // `P2-T29`: `dedupeAndMerge` is both stages' body — `P2-T09`'s cascade
        // once over the fetch output, then `P2-T10`'s `merge()` once per group
        // — so it runs here, where the works have to exist, and `Deduping`
        // below does the per-source bookkeeping. `records` becomes one
        // representative per work, aligned with `works` (see `selectedWorks`).
        // Applied to a supplied `input.records` too, **unless the caller also
        // supplied `input.works`** (`P2-T31`): that pair is a preview's own
        // output handed back for its write half, already one representative
        // per work and already merged, and running the cascade over the
        // representatives again would make every work a singleton of one
        // source — the written item would lose the sources and fields the
        // table showed. So the works are taken as given, and the stage is
        // entered and completed like any other so the bar behaves the same.
        //
        // Flags and links never reach `merge()`: a flagged pair stays two
        // works for review (FR-50 scenario 4), a linked pair stays two works
        // each carrying the other's ids in `relatedVersionIds` (gate `G-16`).
        // `P2-T14` renders both; `P2-T11` writes the Zotero relation and tag.
        // On the supplied-works path both stay empty: the review was the
        // preview's, and an import has nothing new to show.
        //
        // Awaited, not called (`P2-T30`): the cascade yields to the event loop
        // every `DEDUP_YIELD_EVERY_COMPARISONS` comparisons and between blocks,
        // and checks `ctx.token` at each yield — the one-block 100-record case
        // stalled the main thread 246–274 ms unchunked against NFR-3's 100 ms.
        let merged: DedupeMergeResult | undefined;
        if (input.works !== undefined) {
          state.works = input.works;
          // `P2-T34`: the preview's merges, handed back with its works, so
          // the provenance this import writes records what the table showed.
          state.mergeDecisions = input.mergeDecisions ?? [];
        } else {
          merged = await dedupeAndMergeAsync(state.records, ctx.clock.now(), {
            token: ctx.token,
            ...(deps.yieldToEventLoop !== undefined && {
              yieldToEventLoop: deps.yieldToEventLoop,
            }),
          });
          state.records = merged.records;
          state.works = merged.works;
          state.flags = merged.flags;
          state.links = merged.links;
          // FR-50 scenario 2: the decisions leave memory here, for
          // `docs/07` §5.3's `SearchProvenance.mergeDecisions` (`P2-T34`).
          state.mergeDecisions = mergeDecisionsOf(merged);
        }
        merging.done("succeeded");

        // ---- Deduping -----------------------------------------------------
        const deduping = await enterStage(state, ctx, "deduping");
        // The cascade has already run inside `dedupeAndMerge`; what is left
        // for this stage is `docs/07` §5.3's per-source figure. `fetchOne`
        // writes `recordsDeduplicatedAway: 0` because dedup is cross-source
        // and has not happened when a source's report is built; this is the
        // one place the figure becomes true, each folded record charged to
        // its own source and `Planning`'s adapter-less rows left at `0`. The
        // *library* duplicate check is a different mechanism and happens
        // inside the writer (`src/zotero/importer.ts`'s dedup pass, `FR-51`).
        // A run handed its works asked no source and ran no cascade, so it
        // has no report to stamp and nothing to stamp it from.
        if (merged !== undefined) {
          state.perSource = [
            ...attributeDeduplicatedAway(state.perSource, merged),
          ];
        }
        deduping.done("succeeded");

        // ---- BackfillingAbstracts -----------------------------------------
        const backfilling = await enterStage(
          state,
          ctx,
          "backfillingAbstracts",
        );
        await backfillStage(state, input, ctx, backfilling);
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

/**
 * `estimate()`'s answer for an item count and a request count. Every other
 * member is the same on every path: this pipeline calls no priced API and no
 * model.
 */
function requestEstimate(
  itemCount: number,
  externalRequests: number,
): PipelineEstimate {
  return {
    itemCount,
    externalRequests,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    // `undefined`, not `0`: §4.5 types it `number | undefined`, and "we do
    // not know" is a different claim from "it is free". Phase 1 calls no
    // priced API, so there is nothing to know.
    estimatedCostUsd: undefined,
    estimatedDurationSeconds: 0,
    notesKeys: [],
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
 *
 * `Planning`'s lookup-only set is passed with the reports (`plan/00` §6 item
 * 204): a source with `keywordSearch: false` makes no request on a keyword run
 * and cannot fail one, so a run whose every *searching* source failed is
 * `"failed"` — it stops here, creates no collection, and the window's job and
 * progress popup are told `"failed"` — rather than `"partial"`.
 */
function fetchOutcome(
  state: RunState,
  input: SearchImportInput,
): SearchImportOutcome {
  if (input.records !== undefined || state.perSource.length === 0) {
    return "succeeded";
  }
  return fetchStateFromReports(state.perSource, state.lookupOnly);
}

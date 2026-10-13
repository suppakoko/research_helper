/**
 * `searchImport`'s input, its output, and the one port it needs that
 * `docs/07` §4.5's `PipelineContext` does not carry.
 *
 * **Scope.** `P1-T16`. Nothing here is a transcription: `docs/07` declares the
 * `Pipeline` contract (§4.5), the state machine (§12.1) and the provenance
 * record (§5.3), but it declares no input or output type for this pipeline, so
 * these shapes are this card's and are written against three consumers:
 *
 * 1. **`P1-T22`**, which drives the window: it runs the fetch half, renders
 *    `docs/08` §4.6's per-database status list, lets the user check rows, then
 *    runs the write half over exactly the checked set.
 * 2. **`docs/07` §5.3 / FR-8**, whose `SourceProvenance` needs per-source
 *    counts. Every count §5.3 asks for that this pipeline can actually observe
 *    is on {@link SearchImportSourceReport}; the ones it cannot are listed
 *    there with the reason.
 * 3. **`docs/08` §8.4's five states**, which are a function of the outcome and
 *    the per-source reports and are therefore derivable from this output
 *    without the window keeping its own parallel bookkeeping.
 *
 * ## The write port
 *
 * `docs/07` §3.1's arrows put `ORCH → ZL`, and §3.3's worked example has a
 * pipeline calling `zotero/collectionOps` directly, so a pipeline *may* import
 * `src/zotero/`. {@link SearchImportWriter} exists anyway, for two reasons that
 * are not style:
 *
 * - `src/zotero/importer.ts`'s `importWorks()` reaches `Zotero.DB`,
 *   `Zotero.Schema` and `Zotero.Items` on the way to its first `await`. A layer-1
 *   unit test (`docs/13` §2.1) runs in plain Node with the deliberately minimal
 *   fake of `test/setup/zotero-global.ts`, and §2.1's own rule is that "a test
 *   that wants a richer fake is a signal the code belongs in an integration
 *   test". A port keeps the pipeline's **ordering, cancellation and counting**
 *   logic — which is what this card is about — testable at layer 1, and leaves
 *   the real `importWorks` to the integration specs that already cover it.
 * - It is the member §4.5 calls `ctx.zotero: ZoteroFacade`, and that type is
 *   **declared nowhere in the corpus** (see `../types.ts`'s header). Declaring a
 *   narrow port for the three operations this one pipeline needs is smaller and
 *   more honest than inventing the facade §4.5 gestures at.
 */

import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { SerializedError } from "../../core/errors";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import type { RecencyWindow } from "../../sources/shared/recency";
import type { DuplicatePolicy } from "../../zotero/importer";
import type { SearchImportStageKey } from "./stages";

/**
 * Re-exported so `src/ui/**` can name the importer's policy vocabulary without
 * importing `src/zotero/**`, which `eslint.config.js`'s
 * `research-helper/layering/ui` forbids. `pipeline/` may import `zotero/`
 * (this file's header, and `research-helper/layering/pipeline` forbids only
 * `ui/`), so the type crosses here and nowhere else.
 */
export type { DuplicatePolicy };

// ---------------------------------------------------------------------------
// 1. Input
// ---------------------------------------------------------------------------

/** Where the run writes, when it writes. */
export interface SearchImportTarget {
  /** Matched exactly; created when absent (`FR-6`). */
  readonly collectionName: string;
  /** Defaults to the user library, resolved by the writer. */
  readonly libraryId?: number;
  /** Nest under this collection; omitted means top level (`FR-6`). */
  readonly parentCollectionId?: number;
  /**
   * Write only the records whose `SourceRecord.id` is listed.
   *
   * Omitted writes every record the fetch produced. `P1-T22` passes the table's
   * **checked** set, which its own `Do NOT` distinguishes from the table's
   * *filtered* view: "import exactly the checked set, or a hidden-but-checked
   * row silently vanishes". An id that no record carries is ignored rather than
   * an error — the table is a projection of a fetch that may have been re-run.
   */
  readonly selectedRecordIds?: readonly string[];
  /**
   * What happens to a selected record the library already holds — `docs/08`
   * §4.4's "skip | add existing item to collection | import anyway", in the
   * **importer's** vocabulary (`P1-T43`).
   *
   * On the target rather than on {@link SearchImportInput} or the write
   * session, because it is a fact about *writing*: a preview run has no target
   * and therefore no policy, and the choice holds for the whole run rather than
   * for one batch. The view model maps the window's radio value onto it
   * (`DUPLICATE_POLICY_BY_CHOICE`), the pipeline hands the target to
   * `SearchImportWriter.openTarget` whole, and the production writer in
   * `src/bootstrap/registerPipelines.ts` passes it to `importWorks()`, which
   * implements all three branches and defaults to `"link-existing"` when this
   * is omitted.
   */
  readonly duplicatePolicy?: DuplicatePolicy;
}

/**
 * One `searchImport` run.
 *
 * The two optional members are what let `P1-T22` run the state machine in the
 * two halves its steps 2 and 3 describe, **without re-fetching between them**:
 *
 * | `records` | `target` | what runs |
 * |---|---|---|
 * | absent | absent | `Planning → … → BackfillingAbstracts` — FR-5's preview |
 * | absent | present | the whole machine, `Planning → WritingItems` |
 * | present | present | `Merging → WritingItems` over records already fetched |
 * | present | absent | rejected by `validate()`: it would do nothing |
 *
 * A skipped stage still reports `done("succeeded")` into its slice, so the bar
 * reaches 100 % in every accepted combination.
 */
export interface SearchImportInput {
  /**
   * The user's query, verbatim, as typed. Parsed by
   * `src/sources/shared/queryParse.ts`, never pre-rendered into a source's
   * syntax (`docs/07` §4.2: each adapter renders the AST itself).
   */
  readonly query: string;
  /**
   * Which sources to ask. `docs/07` §8.5: "membership in `sources` *is* the
   * enable flag", so this is the `sources` preference's value, resolved by the
   * caller rather than read here — `pipeline/` does not read preferences.
   */
  readonly sourceIds: readonly SourceId[];
  /** Records wanted from each source. The `maxResults` preference's value. */
  readonly limit: number;
  /**
   * The resolved recency window, or `"none"` for FR-3's "All years".
   *
   * Resolved by the caller with `recencyWindow(years, clock)` because the span
   * comes from the `searchYears` preference and `docs/08` §4.2 requires the
   * window be computed when the window opens, not when the run starts.
   */
  readonly dateFilter: RecencyWindow | "none";
  /** Omitted runs the fetch half only — FR-5's preview. See the table above. */
  readonly target?: SearchImportTarget;
  /**
   * Records from an earlier run of this same pipeline, to write without
   * re-fetching. Omitted fetches.
   */
  readonly records?: readonly SourceRecord[];
}

// ---------------------------------------------------------------------------
// 2. Output
// ---------------------------------------------------------------------------

/**
 * How the run ended.
 *
 * `"partial"` is §12.1's `PartialFetch` carried to the end: the run **succeeded**
 * and at least one source did not. FR-9 requires exactly that outcome — "results
 * from the other three are still shown, and a non-blocking banner names the
 * failed source" — so it is deliberately not a member of a failure union, and
 * `docs/08` §8.4's PARTIAL state is rendered from it.
 */
export type SearchImportOutcome =
  "succeeded" | "partial" | "cancelled" | "failed";

/**
 * What one source did, and the counts `docs/07` §5.3 asks of it.
 *
 * **Three of §5.3's `SourceProvenance` fields are not here, and cannot be.**
 * `P1-T16` step 4 fetches through `LiteratureSource.searchAll`, which is an
 * `AsyncIterable<SourceRecord>` (§4.2) and therefore returns no page object:
 *
 * | §5.3 field | why it is absent |
 * |---|---|
 * | `endpointBaseUrl` | no member of §4.2's `LiteratureSource` exposes it |
 * | `transmittedUrl` | built inside the adapter and never returned; `SourcePage` has no such member |
 * | `rawHitCount` | `SourcePage.totalAvailable` exists, but `searchAll` does not yield a page, and the only route out — `ctx.progress.setProgress(emitted, total)` — is clamped to `min(total, limit, 9999)` by the adapter, so it is not the raw count |
 * | `sourceExtras` | `PubmedSearchPage.sourceExtras` is on the **page**, so `searchAll` drops it |
 *
 * {@link transmittedQuery} *is* available, through §4.2's `explainQuery`, which
 * exists for exactly this ("for UI preview + logs").
 *
 * This is a real gap in FR-8's field list and it **needs a card**: either
 * `searchAll` grows a page-level side channel, or the pipeline pages `search()`
 * itself — and §11.1's closing rule says the first of those is a documented
 * change to `docs/07` §4.2 rather than a local workaround. `P1-T16` neither
 * implements nor claims FR-8; `P1-T22` does.
 */
export interface SearchImportSourceReport {
  readonly sourceId: SourceId;
  /**
   * The query as this source's own syntax renders it — §4.2's `explainQuery`.
   * Feeds `SourceProvenance.transmittedQuery`.
   *
   * Redacted at the provenance boundary, not here: `src/core/provenance.ts` is
   * the single gate (`P1-T17`), and a second redactor would be a second rule.
   */
  readonly transmittedQuery: string;
  /** `SourceQuery.limit` this source was asked for. */
  readonly requestedLimit: number;
  /**
   * `"server"`, `"client"` or `"none"` — `resolveDateFilterMode()`'s verdict for
   * this source. Assign straight into `SourceProvenance.dateFilterApplied`.
   */
  readonly dateFilterApplied: "server" | "client" | "none";
  /** Records this source yielded, before the client recency filter. */
  readonly recordsRetrieved: number;
  /** Dropped by the client recency filter. `0` when it did not run. */
  readonly droppedOutOfWindow: number;
  /**
   * Kept by the client recency filter although they carry no parsed date.
   *
   * `applyClientRecencyFilter` reports it because "a large count is the signal
   * that a source's mapper is losing dates"; passed through so the run's report
   * carries the same signal.
   */
  readonly keptWithoutDate: number;
  /**
   * `0` in Phase 1, always, and present rather than omitted. `docs/07` §5.3's
   * own comment on the field says "`0`, not absent", and `P1-T16`'s `Do NOT`
   * forbids `Deduping` merging anything this phase.
   */
  readonly recordsDeduplicatedAway: number;
  /**
   * Populated when this source failed; `undefined` on a clean run — §5.3's
   * shape, and the reason the failure is a *report* rather than a throw
   * (`P1-T16` step 4, FR-9).
   */
  readonly error: SerializedError | undefined;
  /**
   * Warnings this source raised, e.g. PubMed's pagination ceiling.
   *
   * Under `stages.ts`'s `fanOut` (`P2-T02`) this holds the adapter's own page
   * warnings — delivered through `SourceCallContext.progress.warn`, the only
   * route out of `searchAll` — followed by the FR-9 banner when the source
   * failed. `docs/08` §4.6's per-source status row renders it.
   */
  readonly warnings: readonly string[];
}

/**
 * Which of `docs/07` §12.1's three edges out of `Fetching` a fan-out took.
 *
 * - `"succeeded"` — `Fetching --> Merging : all sources exhausted or limit reached`
 * - `"partial"` — `Fetching --> PartialFetch : some sources failed, some succeeded`
 * - `"failed"` — `Fetching --> Failed : all sources failed`
 *
 * A subset of {@link SearchImportOutcome}: the fetch half cannot be
 * `"cancelled"`, because a cancel is thrown out of the stage rather than
 * reported from it. `stages.ts`'s `fetchStateFromReports` derives it, and
 * documents the one case where its reading and `outcomeFromReports`' differ.
 */
export type SearchImportFetchState = Exclude<SearchImportOutcome, "cancelled">;

/**
 * What `stages.ts`'s `fanOut` (`P2-T02`) hands the pipeline at the end of
 * `Fetching`.
 *
 * Every array is in the **order the sources were asked**, never in completion
 * order: `docs/07` §12.1 previews results in the order the user's query
 * produced them, and a table that reshuffled between two runs of the same
 * query would look like a different result set.
 */
export interface SearchImportFanOutResult {
  /** Every source's kept records, concatenated in source order. */
  readonly records: readonly SourceRecord[];
  /** One per source asked, in the same order. */
  readonly perSource: readonly SearchImportSourceReport[];
  /**
   * The FR-9 banners `fanOut` itself raised, in the order they were raised.
   * Each was also sent to the stage's `ProgressReporter.warn`; an adapter's
   * own page warnings are **not** repeated here — they reached the reporter
   * once, through the per-source child, and sit on that source's report.
   */
  readonly warnings: readonly string[];
  /** Which `Fetching →` edge the pipeline should take. */
  readonly state: SearchImportFetchState;
}

/** What the write half did. Absent when it did not run. */
export interface SearchImportWriteReport {
  readonly libraryId: number;
  readonly collectionKey: string;
  readonly collectionName: string;
  /** False when a same-named collection was reused (`FR-6`: "create or reuse"). */
  readonly collectionCreated: boolean;
  /** New items written. `FR-51` reports this separately from {@link linkedExisting}. */
  readonly created: number;
  /** Existing library items added to the collection instead of duplicated (`FR-51`). */
  readonly linkedExisting: number;
  /** Dropped without a write: a library duplicate under `"skip"`, or a repeat. */
  readonly skipped: number;
  /** Records that did not become an item. */
  readonly failed: number;
  /**
   * `R-17`'s measurement, as a whole-number percentage of **created** items —
   * the argument of `research-helper-import-abstract-coverage`.
   *
   * Weighted across batches by `created`, not averaged over batches, so a final
   * batch of one record cannot move it as far as a batch of fifty.
   */
  readonly abstractCoveragePercent: number;
  /**
   * True when `docs/07` §7.4's partial-import note was recorded on the
   * collection: the run was cancelled or failed **after** at least one item was
   * written.
   */
  readonly partialNoteRecorded: boolean;
}

/** One `searchImport` run's result. */
export interface SearchImportOutput {
  readonly outcome: SearchImportOutcome;
  /**
   * The last stage that was entered.
   *
   * On a cancellation this is where the run stopped, which is what `docs/08`
   * §8.3's `CANCELLED` row needs in order to say whether anything was written.
   */
  readonly stageReached: SearchImportStageKey;
  /**
   * The records the run produced, after the client recency filter and after
   * `Deduping`'s identity pass, in fetch order.
   *
   * This is what `docs/08` §4.6's table renders.
   */
  readonly records: readonly SourceRecord[];
  /**
   * The same records lifted to `CanonicalWork`, in the same order — the shape
   * the write half consumes. Empty on a preview run.
   */
  readonly works: readonly CanonicalWork[];
  /** One entry per source that was **asked**, in `input.sourceIds` order. */
  readonly perSource: readonly SearchImportSourceReport[];
  /** Absent when the write half did not run (a preview, or a cancel before it). */
  readonly write: SearchImportWriteReport | undefined;
  /**
   * Run-level warnings, in the order they were raised. Every one of these also
   * reached `ProgressReporter.warn`.
   */
  readonly warnings: readonly string[];
  /**
   * Present only when {@link outcome} is `"failed"`.
   *
   * On an all-sources failure each source's own typed error is on its
   * {@link SearchImportSourceReport}; this is the run-level error the caller
   * renders through `docs/08` §8.3's table.
   */
  readonly error: SerializedError | undefined;
  /** `CancellationToken.reason`'s `kind`, when the run was cancelled. */
  readonly cancellationKind: string | undefined;
}

// ---------------------------------------------------------------------------
// 3. The write port
// ---------------------------------------------------------------------------

/** What one write batch produced. */
export interface SearchImportBatchResult {
  readonly created: number;
  readonly linkedExisting: number;
  readonly skipped: number;
  readonly failed: number;
  /** Of {@link created}, how many carry a non-empty `abstractNote` (`R-17`). */
  readonly createdWithAbstract: number;
}

/**
 * The destination, open, with the index built — what `CreatingCollection` hands
 * to `WritingItems`.
 *
 * It is a session rather than three loose functions because the library index
 * `docs/02` §11.6 says to build "once per run" has to live somewhere between the
 * batches, and because the collection must be resolved exactly once: `FR-6`'s
 * find-or-create is idempotent by name, but `collectionCreated` is only true for
 * whichever call actually created it.
 */
export interface SearchImportWriteSession {
  readonly libraryId: number;
  readonly collectionKey: string;
  readonly collectionCreated: boolean;

  /**
   * Write one batch. Called once per batch so that a cancellation between
   * batches leaves a **count** behind — `FR-53` and `docs/08` §8.3 want "the
   * count of items already imported", and `src/zotero/importer.ts` records that
   * a thrown `OperationCancelledError` carries none.
   *
   * @param works - this batch's works, already lifted and filtered
   * @param token - checked by the writer before it opens a transaction
   */
  writeBatch(
    works: readonly CanonicalWork[],
    token: CancellationToken,
  ): Promise<SearchImportBatchResult>;

  /**
   * Record on the collection that the import was partial — `docs/07` §7.4's
   * "the collection is kept with a note in its description that the import was
   * partial".
   *
   * @param reason - a short already-composed line; the writer decides how to
   *   attach it
   */
  notePartialImport(reason: string): Promise<void>;
}

/** The Zotero write surface `searchImport` needs. See this file's header. */
export interface SearchImportWriter {
  /**
   * `CreatingCollection`: resolve or create the destination and open the
   * session. **Nothing before this stage may write to Zotero** — FR-10's
   * "cancel creates no items" is a statement about this call not having happened
   * yet.
   */
  openTarget(
    target: SearchImportTarget,
    token: CancellationToken,
  ): Promise<SearchImportWriteSession>;
}

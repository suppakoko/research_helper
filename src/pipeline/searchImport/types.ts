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
import type { MergeDecision } from "../../core/provenance";
import type { CanonicalWork } from "../../model/canonicalWork";
import type { SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import type { DedupPair } from "../../sources/shared/dedupe";
import type { RecencyWindow } from "../../sources/shared/recency";
import type { DuplicatePolicy } from "../../zotero/importer";
import type { TranslatorFallbackReason } from "../../zotero/translatorImport";
import type { RelevanceVerdict } from "../shared/relevanceScreen";
import type { SearchImportStageKey, VersionLink } from "./stages";

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
  /**
   * Relate each item written to this one (`P5-T17`, FR-17): the seed's
   * `Zotero.Item.id`. Set by `src/ui/viewModels/relatedViewModel.ts` when the
   * link box is ticked, and read by the writer in
   * `src/bootstrap/registerPipelines.ts`, which passes it to `importWorks`.
   * Created items and linked existing items alike (`plan/08` §0.4 line 15).
   */
  readonly relateTo?: number;
  /**
   * `workKey` → the item the related pipeline matched that work to, by identifier
   * or by title (`P5-T17`, FR-16; `RelatedRow.existingItemID`). Same setter and
   * reader as {@link relateTo}. It is how a row matched by title links to its item
   * rather than creating a second one, since the importer finds identifier
   * matches only.
   */
  readonly existingItemIDs?: ReadonlyMap<string, number>;
}

/**
 * What {@link SearchImportTarget.relateTo} did. A failed link does not fail the
 * run: the items stay as imported (`plan/08` `P5-T17` step 2). The writer builds
 * it per batch, and the pipeline sums it into {@link SearchImportWriteReport}.
 */
export interface SearchImportSeedLink {
  /** Items now related to the seed on both sides. */
  readonly linked: number;
  /** The first failure, when any batch failed. Redacted and storable. */
  readonly error: SerializedError | undefined;
}

/**
 * One `searchImport` run.
 *
 * The two optional members are what let `P1-T22` run the state machine in the
 * two halves its steps 2 and 3 describe, **without re-fetching between them**:
 *
 * | `records` | `works` | `target` | what runs |
 * |---|---|---|---|
 * | absent | absent | absent | `Planning → … → BackfillingAbstracts` — FR-5's preview |
 * | absent | absent | present | the whole machine, `Planning → WritingItems` |
 * | present | absent | present | `Merging → WritingItems` over records already fetched, merged here |
 * | present | present | present | `WritingItems` over the preview's own works; `Merging` writes them through unchanged (`P2-T31`) |
 * | present | any | absent | rejected by `validate()`: it would do nothing |
 * | absent | present | any | rejected by `validate()`: `works` is aligned with `records` and has nothing to align with |
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
   *
   * Without {@link works} these go through `Merging`'s `dedupeAndMergeAsync`
   * exactly as a fetch output does (`P2-T29`), so what is passed decides what
   * is written: the earlier run's {@link SearchImportOutput.records} holds
   * **one representative per work**, and a representative merged alone is a
   * singleton — one source in `seenIn`, the other contributors' fields gone.
   * That is the right thing for a caller holding raw records (a pre-fetched
   * set, a run that stopped before `Merging`) and the wrong thing for the
   * import of a preview, which is why the preview's caller passes
   * {@link works} too.
   */
  readonly records?: readonly SourceRecord[];
  /**
   * The earlier run's {@link SearchImportOutput.works}, **positionally
   * aligned with {@link records}** exactly as the output had them: `works[i]`
   * is the work whose representative is `records[i]`. `P2-T31`.
   *
   * Present, `Merging` writes these through as given — no cascade, no
   * re-merge — so the `CanonicalWork` that reaches the writer is the same
   * object the results table showed: every contributing source in
   * `provenance.seenIn`, every contested field's winner in `fieldOrigin`,
   * `flags` and `links` empty because an import reviews nothing. Chosen over
   * carrying every contributing record back and merging again because it is
   * one member and one branch, costs the main thread no second cascade
   * (`docs/10` NFR-3), and makes "the written work equals the previewed one"
   * true by identity rather than by re-derivation under a new clock reading.
   *
   * Requires {@link records} and the same length; `validate()` rejects
   * anything else with `SEARCH_IMPORT_VALIDATION_KEYS.worksMisaligned`.
   * `SearchImportTarget.selectedRecordIds` still names representatives, and
   * the pipeline's `selectedWorks` still reads the alignment.
   */
  readonly works?: readonly CanonicalWork[];
  /**
   * The earlier run's {@link SearchImportOutput.mergeDecisions}, handed back
   * with {@link works} (`P2-T34`). A run handed its works runs no cascade, so
   * without this the import of a preview — the run that writes the provenance
   * note — would record no merge at all although the table showed merged
   * works. Passed through to the output as given; ignored unless
   * {@link works} is present, because a run that merges its records itself
   * produces its own.
   */
  readonly mergeDecisions?: readonly MergeDecision[];
  /**
   * Relevance screening for this run (`P3-T27`; `docs/12` §3, `docs/07`
   * §12.1's `Screening` state). Present means the user chose it for this run;
   * absent means no model is called. Ignored on the import of a preview's own
   * {@link works}: that preview was screened already.
   */
  readonly screening?: SearchImportScreeningOptions;
}

/** The window's per-run screening choice (`docs/08` §4.2's threshold row). */
export interface SearchImportScreeningOptions {
  /**
   * 0–100. Seeded from `screening.threshold` and changed per run only; `0`
   * scores everything and excludes nothing (`docs/07` §8.5).
   */
  readonly threshold: number;
  /** The topic the model scores against; the run's {@link SearchImportInput.query} when absent. */
  readonly topic?: string;
}

/** What the `Screening` stage recorded (`P3-T27`). */
export interface SearchImportScreeningReport {
  readonly threshold: number;
  /** Every scored row, keyed by its representative's `SourceRecord.id`. */
  readonly verdicts: readonly RelevanceVerdict[];
  /** Rows no call could score. Never in {@link excluded}. */
  readonly unscored: readonly string[];
  /** Scored rows below {@link threshold}; empty when it is `0`. */
  readonly excluded: readonly string[];
  /** The model that scored them, as the router resolved it. */
  readonly modelId: string | undefined;
  /**
   * Why nothing was scored — a refused model, a missing key, a budget stop.
   * The search itself still succeeded.
   */
  readonly error: SerializedError | undefined;
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
   * Records from this source that `Deduping` folded into another record's
   * work. Present rather than omitted — `docs/07` §5.3's own comment on the
   * field says "`0`, not absent".
   *
   * `fetchOne` writes `0`, because dedup is cross-source and runs only after
   * every source has answered; the pipeline's `Deduping` stage then calls
   * `stages.ts`'s `attributeDeduplicatedAway` (`P2-T10`, wired by `P2-T29`),
   * which re-stamps the figure from the dedup result, charging each folded
   * record to its own source. A run that ends before `Deduping` — an
   * all-sources failure, a cancel during `Fetching` — reports the `0` the
   * fetch wrote, as does a `Planning` row for a source with no adapter.
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
 * - `"failed"` — `Fetching --> Failed : all sources failed`, where "all" means
 *   every source that searches: a `keywordSearch: false` source cannot fail a
 *   keyword run and is left out (`plan/00` §6 item 204)
 *
 * A subset of {@link SearchImportOutcome}: the fetch half cannot be
 * `"cancelled"`, because a cancel is thrown out of the stage rather than
 * reported from it. `stages.ts`'s `fetchStateFromReports` derives it and is,
 * since `P2-T27`, the only function that does — the pipeline's
 * `fetchOutcome` applies it over the whole per-source list.
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

/**
 * Strategy B's import-path counts (`P2-T18` step 10), carried to the visible
 * summary (`plan/00` §6 item 212).
 *
 * **Present only when Strategy B ran** — the writer read `useTranslators` as
 * on and wrote at least one batch. With the preference off, the shipped
 * default, the field is absent from every batch result and from the write
 * report, so the summary the window draws is exactly what it was before.
 * The writer copies these from `src/zotero/importer.ts`'s
 * `ImportReport.importPaths`, one batch at a time; the pipeline sums them.
 */
export interface SearchImportPathCounts {
  /** Items created through Zotero's translators (Strategy B). */
  readonly viaTranslators: number;
  /** Items created by hand-mapping (Strategy A), for whatever reason. */
  readonly handMapped: number;
  /**
   * Records sent to hand-mapping by the translator path, by reason class.
   * Every reason is present, 0 or more — the importer's own contract.
   */
  readonly fallbackReasons: Readonly<Record<TranslatorFallbackReason, number>>;
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
  /**
   * Strategy B's counts, summed over the run's batches. Absent unless
   * Strategy B ran — see {@link SearchImportPathCounts}.
   */
  readonly importPaths?: SearchImportPathCounts;
  /**
   * Summed over the run's batches. Absent unless the target carried
   * {@link SearchImportTarget.relateTo}.
   */
  readonly seedLink?: SearchImportSeedLink;
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
   * **One row per work, not per record** (`P2-T29`): for each distinct work
   * the run found, the first record of its dedup group in fetch order — the
   * group's *representative* — so a paper two sources both returned appears
   * once (FR-50). Rows are in fetch order of their representatives (again
   * since 2026-11-12, when `docs/07` §5.1's review-document exception of
   * 2026-11-10 was removed). A run that
   * ended before `Merging` carries the fetch output instead, every record,
   * after the client recency filter.
   *
   * This is what `docs/08` §4.6's table renders, and a checked row's
   * `SourceRecord.id` is what {@link SearchImportTarget.selectedRecordIds}
   * names. The other members of each group are not rows and are not here
   * (`DedupeMergeResult.merged` holds them, inside `stages.ts`); what the
   * import of a preview needs is the merged work itself, which is
   * {@link works} handed back as {@link SearchImportInput.works} (`P2-T31`).
   */
  readonly records: readonly SourceRecord[];
  /**
   * One `CanonicalWork` per work, **positionally aligned with
   * {@link records}**: `works[i]` was merged from the group whose
   * representative is `records[i]`, with every contributing source in
   * `provenance.seenIn`, every contributing record in `recordIds` and each
   * contested field's winner in `fieldOrigin` (`docs/07` §5.1). The shape the
   * write half consumes. Empty before `Merging` has run.
   */
  readonly works: readonly CanonicalWork[];
  /**
   * Possible duplicates the cascade would not merge — FR-50 scenario 4's
   * "flagged for user review". Both records of each pair are separate rows in
   * {@link records}; `P2-T14` renders the badge. Empty before `Merging`, and
   * empty on an import that was handed {@link SearchImportInput.works}: the
   * review happened on the preview. Required since `P2-T31` (`P2-T29` had to
   * leave it optional for two `test/unit/ui/*` fixtures outside its list).
   */
  readonly flags: readonly DedupPair[];
  /**
   * Pairs kept as two linked works — a preprint and its published version
   * (gate `G-16`), or a title match with conflicting identifiers (`docs/02`
   * §11.5 rule 1). Each side's `CanonicalWork` carries the other's ids in
   * `relatedVersionIds`; `P2-T11` writes the Zotero *Related* relation and
   * tags the side `VersionLink.preprintWorkKey` names. Empty before
   * `Merging` and on an import handed its works, as {@link flags} is.
   */
  readonly links: readonly VersionLink[];
  /**
   * FR-50 scenario 2: every merge `Merging` made, as `docs/07` §5.3's
   * `MergeDecision` (`P2-T34`) — what `SearchProvenance.mergeDecisions`
   * records. Empty before `Merging` and when nothing merged; on an import
   * handed its works, the {@link SearchImportInput.mergeDecisions} it was
   * handed.
   */
  readonly mergeDecisions: readonly MergeDecision[];
  /**
   * One entry per source that was **asked**, in `input.sourceIds` order, with
   * `recordsDeduplicatedAway` stamped once `Deduping` has run.
   */
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
  /**
   * The `Screening` stage's record (`P3-T27`). Absent when the run did not
   * screen: no {@link SearchImportInput.screening}, the import of a
   * preview's works, or a run that ended before the stage.
   */
  readonly screening?: SearchImportScreeningReport;
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
  /**
   * This batch's Strategy B counts. Absent when the writer did not use
   * Strategy B — see {@link SearchImportPathCounts}.
   */
  readonly importPaths?: SearchImportPathCounts;
  /** This batch's link to the seed. Absent unless the target asked for one. */
  readonly seedLink?: SearchImportSeedLink;
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

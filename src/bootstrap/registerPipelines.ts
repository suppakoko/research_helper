/**
 * The single wiring point for pipelines, and the Zotero side of `searchImport`'s
 * write port.
 *
 * **Scope.** `P1-T16`. It is the pipeline counterpart of
 * `./registerSources.ts`, deliberately down to the shape: the composition root
 * calls it once, it owns the *policy* (which ids this phase registers, in what
 * order) and not the construction, and `docs/07` §11.3 makes it the one place a
 * new pipeline is wired in.
 *
 * ## Why the writer is built here
 *
 * `src/pipeline/searchImport/types.ts` declares a narrow
 * {@link SearchImportWriter} port — three operations — instead of having the
 * pipeline import `src/zotero/importer.ts` directly. Its own header says why
 * (layer-1 testability, and §4.5's `ZoteroFacade` being declared nowhere); this
 * file is the implementation, and it belongs in `bootstrap/` for the reason the
 * composition root exists: it is the *wiring* of a `zotero/` capability onto a
 * `pipeline/` port, which is neither module's business.
 *
 * ## The `network-metadata` pool lives here
 *
 * `docs/07` §7.2 sizes it at four and `P2-T27` step 2 gives it one home: the
 * `Semaphore` is constructed in {@link buildPipelineSet} — which the
 * composition root calls once — and reaches `stages.ts`'s `fanOut` through
 * `SearchImportDeps.pool`. A pool built per pipeline, per run or per call would
 * be a per-job budget under another name, so nothing else constructs one; the
 * size is `stages.ts`'s `NETWORK_METADATA_POOL_SIZE`, not a figure of this
 * file's, and it is not read from a preference (§7.2 fixes it).
 *
 * ## So do the `llm` pool and job admission (`P3-T17`)
 *
 * {@link buildWorkerPools} builds, once, beside the `network-metadata` pool:
 * §7.2's `llm` pool, sized from the `concurrency` preference clamped to 1–8
 * (`createLlmPool` in `src/core/jobQueue/queue.ts`), and the job-level
 * admission (one `interactive`, two `background`). It also carries the
 * `RunningWork` registry `installServices` gave the cache as its pinned
 * tags. No pipeline takes these yet: the summarize pipeline (`P3-T29`) is
 * their caller, constructed here from the same {@link WorkerPools}.
 *
 * ## Two things this file does not do, and they are reported not hidden
 *
 * 1. **`notePartialImport` cannot write to the collection.** `docs/07` §7.4
 *    requires that a partial `searchImport` leave "a note in its description
 *    that the import was partial". Grepped 2026-10-07: **nothing in
 *    `src/zotero/` writes a collection description** — not
 *    `collectionOps.ts`, not `zoteroApi.ts`, not `importer.ts` — and
 *    `eslint.config.js`'s `research-helper/zotero-global` rule exempts only
 *    `src/zotero/**`, `addon/**` and the three lifecycle entry files, so this
 *    file may not reach `Zotero.Collections` itself. `src/zotero/collectionOps.ts`
 *    is **not in `P1-T16`'s `Files` list**, so adding the capability there would
 *    be the scope-widening `plan/README.md` §5 rule 2 forbids. The default
 *    implementation therefore **logs the note at `warn`** and sets no
 *    description, and {@link ZoteroSearchImportWriterDeps.setCollectionNote} is
 *    the seam the card that adds the capability fills. The pipeline's behaviour
 *    — *when* the note is composed and what it says — is complete and tested;
 *    only the final write is missing. **Needs a card.**
 * 2. **It writes no provenance note and no provenance JSON.** `P1-T17` shipped
 *    `src/core/provenance.ts` and `src/zotero/notes.ts` with no importer, and
 *    its own report says the construction site "belongs to the card this one
 *    blocks" — which is `P1-T22`, the card `P1-T16` also blocks. Neither path is
 *    in `P1-T16`'s `Files` list. What this card *can* do for it, and does, is
 *    make the pipeline's output carry every per-source count `docs/07` §5.3 asks
 *    for that the `LiteratureSource` port can actually produce;
 *    `SearchImportSourceReport`'s doc comment lists the four it cannot and why.
 */

import {
  DEFAULT_CHUNK_SIZE,
  type ImportPathReport,
  importWorks,
} from "../zotero/importer";
import { buildLibraryIndex, type LibraryIndex } from "../zotero/libraryIndex";
import {
  readCollectionWorks,
  readLibraryTermSources,
} from "../zotero/itemMapper";
import {
  TRANSLATOR_FALLBACK_REASONS,
  TRANSLATOR_LOOKUP_TIMEOUT_MS,
  type PmcidResolver,
  type TranslatorFallbackReason,
  type TranslatorImportOptions,
} from "../zotero/translatorImport";
import { createPmcidConverter } from "../sources/pubmed/idConverter";
import { getPref } from "../prefs";
import { Semaphore } from "../core/concurrency";
import {
  createJobAdmission,
  createLlmPool,
  createRunningWork,
  type JobAdmission,
  type LlmPool,
  type RunningWork,
} from "../core/jobQueue/queue";
import type { HttpClient } from "../core/http/client";
import type { Logger } from "../core/logger";
import type { CancellationToken } from "../core/jobQueue/cancellation";
import type { CanonicalWork } from "../model/canonicalWork";
import {
  createPipelineRegistry,
  registerPipelines as registerIntoRegistry,
  type PipelineRegistry,
  type PipelineSet,
} from "../pipeline/registry";
import { createSearchImportPipeline } from "../pipeline/searchImport/searchImportPipeline";
import {
  NETWORK_METADATA_POOL_SIZE,
  type SearchScreeningDeps,
} from "../pipeline/searchImport/stages";
import type {
  SearchImportBatchResult,
  SearchImportTarget,
  SearchImportWriteSession,
  SearchImportWriter,
} from "../pipeline/searchImport/types";
import {
  acquireZoteroSource,
  readItemIdentifiers,
  type ZoteroAcquirableItem,
} from "../pipeline/summarize/acquire";
import {
  createSummarizePipeline,
  type JobPauseNotices,
  type SummarizeCollection,
  type SummarizeLibrary,
  type SummarizeLibraryItem,
  type SummarizePipelineDeps,
} from "../pipeline/summarize/summarizePipeline";
import {
  createTrendReportPipeline,
  type ReportRoutineStore,
  type TrendReportLibrary,
  type TrendReportPipelineDeps,
  type TrendReportSurface,
} from "../pipeline/trendReport/trendReportPipeline";
import type { SearchRunSummary } from "../pipeline/trendReport/compose";
import type { RecommendLibrary } from "../pipeline/recommend/profile";
import { zoteroBibliographyPort } from "../zotero/bibliography";
import { estTokens } from "../llm/shared/tokenEstimate";
import type { JobQueue } from "../core/jobQueue/queue";
import { ConfigurationError } from "../core/errors";
import {
  EUROPE_PMC_SOURCE_NAME,
  attachmentPageCounts,
  attachmentTitle,
  findSummaryNote,
  readCollectionForSummary,
  readItemsForSummary,
  writeReportNote,
  writeSummaryNote,
  type SummaryRunCollection,
  type SummaryRunItemSnapshot,
} from "../zotero/notes";

export { DEFAULT_CHUNK_SIZE };

// ---------------------------------------------------------------------------
// 1. The Zotero write surface
// ---------------------------------------------------------------------------

/** What {@link createZoteroSearchImportWriter} needs. */
export interface ZoteroSearchImportWriterDeps {
  /** Diagnostics. Never given a record, an abstract or a credential. */
  readonly logger?: Logger;
  /**
   * Record `docs/07` §7.4's partial-import line on the collection.
   *
   * **Omitted in the product today, because there is nothing to call** — see
   * item 1 of this file's header. When omitted, the line is logged at `warn`
   * and the collection's description is left alone, which is the honest
   * degradation: §7.4's other requirement, that the items and the collection be
   * *kept*, is satisfied either way, and the note is a diagnostic rather than
   * the thing that preserves the user's data.
   *
   * @param collectionKey - the target collection's key
   * @param libraryId - the target library
   * @param note - the already-composed line
   */
  readonly setCollectionNote?: (
    collectionKey: string,
    libraryId: number,
    note: string,
  ) => Promise<void>;
  /**
   * Read `useTranslators` (`P2-T18`). Defaults to
   * `getPref("useTranslators")` — the typed accessor of `docs/07` §8.5.1, never
   * `Zotero.Prefs` — and is called **once per run**, on the run's first
   * `writeBatch`, which is the first thing `WritingItems` does (`docs/07`
   * §12.1: "reads `useTranslators` once on entry"). Not at startup, not per
   * record, not per batch, so a mid-run change cannot split one import across
   * two strategies. Injectable so a test can count the reads.
   */
  readonly readUseTranslators?: () => boolean;
  /**
   * The client Strategy B's PMCID route sends its requests through (owner,
   * 2026-10-19, `plan/00` §6 item 214): the NCBI ID Converter of `docs/02`
   * §3.7, built by `createPmcidConverter` in
   * `src/sources/pubmed/idConverter.ts` and handed to the importer as
   * `resolvePmcids`. The composition root passes the shipped client, so the
   * `pmc.ncbi.nlm.nih.gov` bucket of `docs/07` §7.3 paces it. **Absent, there
   * is no PMCID route** and a PMCID-only record is hand-mapped. Only used while
   * `useTranslators` is on.
   */
  readonly http?: HttpClient;
  /**
   * Strategy B's seams, passed to the importer when the preference is on:
   * the `Translate.Search` factory a test fakes, the PMCID route, and the
   * per-record deadline. **Omitted in the product**: the factory then
   * defaults to the platform's own search object, the PMCID route is the
   * converter over {@link http}, and the deadline is
   * `TRANSLATOR_LOOKUP_TIMEOUT_MS` (30 s, owner 2026-10-19, item 213). A
   * member given here replaces that default — which is how a test supplies a
   * fake route or a short deadline.
   */
  readonly translatorLookup?: Omit<TranslatorImportOptions, "logger">;
}

/** {@link ImportPathReport} at zero, before a run's first batch. */
function emptyPathTotals(): ImportPathReport {
  const fallbackReasons = {} as Record<TranslatorFallbackReason, number>;
  for (const reason of TRANSLATOR_FALLBACK_REASONS) fallbackReasons[reason] = 0;
  return {
    translatorsRequested: true,
    viaTranslators: 0,
    handMapped: 0,
    fellBack: 0,
    fallbackReasons,
    searches: 0,
  };
}

/**
 * `a + b`, field by field — `P2-T18` step 10's per-run counts, summed over a
 * run's batches.
 */
export function addPathTotals(
  a: ImportPathReport,
  b: ImportPathReport,
): ImportPathReport {
  const fallbackReasons = {} as Record<TranslatorFallbackReason, number>;
  for (const reason of TRANSLATOR_FALLBACK_REASONS) {
    fallbackReasons[reason] =
      a.fallbackReasons[reason] + b.fallbackReasons[reason];
  }
  return {
    translatorsRequested: a.translatorsRequested || b.translatorsRequested,
    viaTranslators: a.viaTranslators + b.viaTranslators,
    handMapped: a.handMapped + b.handMapped,
    fellBack: a.fellBack + b.fellBack,
    fallbackReasons,
    searches: a.searches + b.searches,
  };
}

/**
 * The production {@link SearchImportWriter}, over `src/zotero/importer.ts`.
 *
 * **Why `openTarget` imports an empty batch.** `importWorks()` resolves the
 * collection lazily, inside whichever transaction runs first, and guarantees as a
 * post-condition that "the collection must exist even when nothing was written"
 * (`FR-6`). Calling it with `works: []` is therefore the supported way to make
 * `CreatingCollection` a stage of its own that creates the collection and nothing
 * else — which is what lets the pipeline keep `WritingItems` cancellable per
 * batch while `FR-10`'s "cancel creates no items" stays true for every earlier
 * stage. An empty call also builds **no** library index: `resolveIndex` returns
 * early when `works.length === 0`.
 *
 * **Why the index is built once and passed in.** `docs/02` §11.6 says the
 * library is searched "once per run", and `ImportRequest.index`'s own doc says
 * supplying one "is how a pipeline that has already read the library avoids a
 * second search". Without it, a 200-record run in four batches would run four
 * `Zotero.Search` calls.
 *
 * **Why `chunkSize` is the batch's own length.** The pipeline batches so that a
 * cancellation leaves a count behind; `FR-6` wants one transaction per batch. One
 * `importWorks` call per pipeline batch with `chunkSize = works.length` makes
 * those two the same batch instead of two nested batchings with different sizes.
 */
export function createZoteroSearchImportWriter(
  deps: ZoteroSearchImportWriterDeps = {},
): SearchImportWriter {
  // Item 214: the PMCID route over the shipped client. Built once per writer;
  // it sends nothing until a PMCID-only record reaches Strategy B.
  const resolvePmcids: PmcidResolver | undefined =
    deps.http === undefined
      ? undefined
      : createPmcidConverter({
          http: deps.http,
          ...(deps.logger !== undefined && { logger: deps.logger }),
        });
  return {
    async openTarget(
      target: SearchImportTarget,
      token: CancellationToken,
    ): Promise<SearchImportWriteSession> {
      const opened = await importWorks({
        works: [],
        collectionName: target.collectionName,
        ...(target.libraryId !== undefined && { libraryID: target.libraryId }),
        ...(target.parentCollectionId !== undefined && {
          parentCollectionID: target.parentCollectionId,
        }),
        token,
      });

      const libraryId = opened.collection.libraryID;
      const collectionKey = opened.collection.key;
      // Built on the first write rather than here: a run whose only batch is
      // empty (every row unchecked) then costs no search at all.
      let index: LibraryIndex | undefined;
      // `P2-T18`: read on the first write — `WritingItems`' entry — and then
      // never again for this run. See `readUseTranslators`.
      let useTranslators: boolean | undefined;
      let pathTotals = emptyPathTotals();

      return {
        libraryId,
        collectionKey,
        collectionCreated: opened.collectionCreated,

        async writeBatch(
          works: readonly CanonicalWork[],
          batchToken: CancellationToken,
        ): Promise<SearchImportBatchResult> {
          index ??= await buildLibraryIndex(libraryId);
          useTranslators ??= (
            deps.readUseTranslators ?? (() => getPref("useTranslators"))
          )();
          const report = await importWorks({
            works,
            collectionName: target.collectionName,
            libraryID: libraryId,
            ...(target.parentCollectionId !== undefined && {
              parentCollectionID: target.parentCollectionId,
            }),
            // `P1-T43`: the user's §4.4 choice, already in the importer's own
            // vocabulary. Omitted when the target carries none, so `importWorks`
            // applies `DEFAULT_DUPLICATE_POLICY` exactly as before. Measured
            // 2026-10-13 before this line existed: the window's "skip" and
            // "import anyway" both behaved as "link-existing" here, because
            // this was the one call on the path that never passed it on.
            ...(target.duplicatePolicy !== undefined && {
              duplicatePolicy: target.duplicatePolicy,
            }),
            index,
            chunkSize: Math.max(1, works.length),
            token: batchToken,
            // Off — the shipped default — passes nothing, so the importer
            // runs the hand-mapped path exactly as it did before `P2-T18`.
            // On: item 213's 30 s deadline and item 214's PMCID route are the
            // defaults; anything in `deps.translatorLookup` replaces them.
            ...(useTranslators && {
              translatorLookup: {
                perRecordTimeoutMs: TRANSLATOR_LOOKUP_TIMEOUT_MS,
                ...(resolvePmcids !== undefined && { resolvePmcids }),
                ...deps.translatorLookup,
                ...(deps.logger !== undefined && { logger: deps.logger }),
              },
            }),
          });
          if (useTranslators) {
            pathTotals = addPathTotals(pathTotals, report.importPaths);
            // `P2-T18` step 10's per-run counts, cumulative over the run's
            // batches, for the log. The summary gets this batch's own counts
            // through `importPaths` below, and the pipeline sums those
            // (`plan/00` §6 item 212).
            deps.logger?.info("searchImport: import paths so far", {
              viaTranslators: pathTotals.viaTranslators,
              handMapped: pathTotals.handMapped,
              fellBack: pathTotals.fellBack,
              ...pathTotals.fallbackReasons,
              searches: pathTotals.searches,
            });
          }
          return {
            created: report.created,
            linkedExisting: report.linkedExisting,
            skipped: report.skipped,
            failed: report.failed.length,
            createdWithAbstract: report.abstractCoverage.withAbstract,
            // Item 212: this batch's Strategy B counts, for the visible
            // summary. Only when Strategy B ran — off, the shipped default,
            // adds no field, so the summary is exactly what it was.
            ...(useTranslators && {
              importPaths: {
                viaTranslators: report.importPaths.viaTranslators,
                handMapped: report.importPaths.handMapped,
                fallbackReasons: { ...report.importPaths.fallbackReasons },
              },
            }),
          };
        },

        async notePartialImport(note: string): Promise<void> {
          const { setCollectionNote } = deps;
          if (setCollectionNote === undefined) {
            // See item 1 of this file's header. Logged rather than dropped, so
            // the information exists somewhere a bug report can carry.
            deps.logger?.warn(
              "searchImport: docs/07 §7.4's partial-import note has no " +
                "write path yet; nothing in src/zotero/ sets a collection " +
                "description. The items and the collection are kept.",
              { collectionKey, libraryId, note },
            );
            return;
          }
          await setCollectionNote(collectionKey, libraryId, note);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 1b. The summarize pipeline's Zotero port (`P3-T29`)
// ---------------------------------------------------------------------------

/** The four-digit year of a Zotero date string, when it has one. */
function yearOf(date: string): number | undefined {
  const match = /\b(\d{4})\b/.exec(date);
  return match === null ? undefined : Number(match[1]);
}

/** A snapshot of `src/zotero/notes.ts`, as the pipeline's plain item. */
function summarizeItemFrom(
  snapshot: SummaryRunItemSnapshot,
): SummarizeLibraryItem {
  const ids = readItemIdentifiers({
    getField: (field: string) =>
      field === "DOI" ? snapshot.doi : field === "extra" ? snapshot.extra : "",
  });
  const year = yearOf(snapshot.date);
  return {
    itemID: snapshot.itemID,
    itemKey: snapshot.key,
    libraryID: snapshot.libraryID,
    workKey: snapshot.workKey,
    metadata: {
      title: snapshot.title,
      authors: snapshot.creators,
      year,
      venue:
        snapshot.publicationTitle === ""
          ? undefined
          : snapshot.publicationTitle,
      itemType: snapshot.itemType,
      doi: ids.doi,
      tags: snapshot.tags,
    },
    dateModified: snapshot.dateModified,
    screen: {
      key: snapshot.key,
      itemID: snapshot.itemID,
      itemType: snapshot.itemType,
      title: snapshot.title,
      year,
      firstAuthorFamily: snapshot.firstAuthorFamily,
      containerTitle: snapshot.publicationTitle,
      doi: ids.doi,
      pmid: ids.pmid,
      pmcid: ids.pmcid,
      abstractLength: snapshot.abstractLength,
      hasFullText: snapshot.hasAttachment,
      dateAdded: snapshot.dateAdded,
      retraction: {
        zotero: {
          retracted: snapshot.retracted,
          reasons: snapshot.retractionReasons,
        },
      },
    },
  };
}

/** What {@link createZoteroSummarizeLibrary} needs. */
export interface ZoteroSummarizeLibraryDeps {
  readonly logger?: Logger;
  /**
   * `docs/06` §3.4's Tier 3 (Europe PMC JATS). Default `true`, as
   * `acquireZoteroSource`'s own default; never tried when the run's mode
   * allows no full text.
   */
  readonly tryEuropePmc?: () => boolean;
}

/**
 * The summarize pipeline's {@link SummarizeLibrary} over Zotero: the
 * collection read and the notes through `src/zotero/notes.ts`, the text
 * through `acquireZoteroSource` (`src/pipeline/summarize/acquire.ts`). Built
 * here for the reason {@link createZoteroSearchImportWriter} is: it is the
 * wiring of a `zotero/` capability onto a `pipeline/` port.
 *
 * Acquisition gets no §13.1 abstract recovery: that writes to the user's item
 * and needs a per-run consent surface no card has built, so an item with no
 * text stays Tier 4 and is counted "skipped: no text" (FR-21).
 */
export function createZoteroSummarizeLibrary(
  deps: ZoteroSummarizeLibraryDeps = {},
): SummarizeLibrary {
  const live = new Map<string, ZoteroAcquirableItem>();
  const keyOf = (libraryID: number, itemKey: string): string =>
    `${String(libraryID)}/${itemKey}`;
  // Every item a run has read, for its acquisition. Never cleared on a new
  // read (item 303(a)): the item pane's one-item run may read while a
  // collection run is still acquiring, and clearing would take that run's
  // items away. It holds the items Zotero's own cache already holds.
  const remember = (collection: SummaryRunCollection): SummarizeCollection => {
    for (const snapshot of collection.items) {
      live.set(
        keyOf(snapshot.libraryID, snapshot.key),
        snapshot.item as unknown as ZoteroAcquirableItem,
      );
    }
    return {
      name: collection.name,
      editable: collection.editable,
      items: collection.items.map(summarizeItemFrom),
    };
  };
  return {
    async loadCollection(libraryID, collectionKey) {
      return remember(await readCollectionForSummary(libraryID, collectionKey));
    },

    async loadItems(libraryID, itemKeys) {
      return remember(await readItemsForSummary(libraryID, itemKeys));
    },

    async acquire(item, options) {
      const zoteroItem = live.get(keyOf(item.libraryID, item.itemKey));
      if (zoteroItem === undefined) {
        throw new Error(
          "[research-helper] an item to summarize was not read with its collection",
        );
      }
      const source = await acquireZoteroSource(zoteroItem, {
        estimateTokens: (text) => estTokens(text),
        includeFullText: options.includeFullText,
        tryEuropePmc:
          options.includeFullText && (deps.tryEuropePmc?.() ?? true),
        token: options.token,
        ...(deps.logger !== undefined && { logger: deps.logger }),
      });
      const pageCounts =
        source.truncated && source.attachmentKey !== null
          ? await attachmentPageCounts(source.libraryID, source.attachmentKey)
          : undefined;
      const sourceName =
        source.tier === "fulltext_epmc"
          ? EUROPE_PMC_SOURCE_NAME
          : source.attachmentKey === null
            ? undefined
            : attachmentTitle(source.libraryID, source.attachmentKey);
      return { source, pageCounts, sourceName };
    },

    findSummaryNote(item, storedNoteKey) {
      return Promise.resolve(
        findSummaryNote(item.libraryID, item.itemKey, storedNoteKey),
      );
    },

    writeSummaryNote(item, stored, sourceName) {
      return writeSummaryNote({
        libraryID: item.libraryID,
        parentItemKey: item.itemKey,
        stored,
        sourceName,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 1c. The recommend pipeline's Zotero reads (`P5-T18`)
// ---------------------------------------------------------------------------

/**
 * The recommend profile's {@link RecommendLibrary} over Zotero. Built here for
 * the reason {@link createZoteroSearchImportWriter} is; the reads themselves are
 * in `src/zotero/`, because this file may not name the `Zotero` global.
 * {@link buildPipelineSet} constructs it for `recommendPipeline.ts` (`P5-T25`);
 * until that card, nothing calls this.
 */
export function createZoteroRecommendLibrary(): RecommendLibrary {
  return {
    readCollection: (libraryID, collectionKey) =>
      readCollectionWorks(libraryID, collectionKey),
    libraryTermSources: (libraryID) => readLibraryTermSources(libraryID),
    libraryIndex: (libraryID) => buildLibraryIndex(libraryID),
  };
}

// ---------------------------------------------------------------------------
// 2. The pipelines
// ---------------------------------------------------------------------------

/** What {@link buildPipelineSet} needs from the composition root. */
export interface PipelineConstructionDeps {
  /** The Zotero write surface, from {@link createZoteroSearchImportWriter}. */
  readonly writer: SearchImportWriter;
  /**
   * Works per write transaction. Defaults to `src/zotero/importer.ts`'s
   * {@link DEFAULT_CHUNK_SIZE}, which is the number `docs/07` §7.2 says to
   * instrument — not a second opinion about it.
   */
  readonly writeBatchSize?: number;
  /**
   * The `concurrency` preference (`docs/07` §8.5), read before every `llm`
   * dispatch. Defaults to `getPref("concurrency")`; injectable for a test.
   */
  readonly readConcurrency?: () => number;
  /**
   * The registry whose work keys the cache pins (`docs/07` §9.4 step 4).
   * `installServices` passes the one it gave the cache; absent, a fresh one
   * that no cache reads.
   */
  readonly runningWork?: RunningWork;
  /**
   * The search pipeline's `Screening` stage dependencies (`P3-T27`): the
   * adapter's model description for the privacy check. Absent, every model's
   * data policy is judged `unknown`.
   */
  readonly screening?: SearchScreeningDeps;
  /**
   * The summarize pipeline's dependencies (`P3-T29`) that only the
   * composition root holds: the summary store, the job queue (read through a
   * getter, because `installServices` builds it after the pipelines), the
   * pause notices, the price source, the base URLs, the adapters' model
   * descriptions and the key check. Absent in a unit test of the graph that
   * builds no queue: then `summarize` refuses to run (`ConfigurationError`)
   * before anything is read or sent.
   */
  readonly summarize?: SummarizeConstructionDeps;
  /**
   * The trend-report pipeline's dependencies (`P4-T18`) that only the
   * composition root holds: the report store (`P4-T14`), the report run's own
   * "don't ask again" record (`collection_settings`), the collection's search
   * records and the plugin version, beside the summarize pipeline's store,
   * queue, notices, prices, base URLs, model descriptions and key check, which
   * it shares. Absent in a unit test of the graph that builds no queue: then
   * `trendReport` refuses to run (`ConfigurationError`) before anything is
   * read or sent.
   */
  readonly trendReport?: TrendReportConstructionDeps;
}

/** {@link PipelineConstructionDeps.trendReport}. */
export interface TrendReportConstructionDeps extends Pick<
  TrendReportPipelineDeps,
  "reports" | "pluginVersion" | "utcOffsetMinutes" | "wallClockBudgetMs"
> {
  /** `reportRoutineConfirmation` in `collection_settings`; absent: always asked. */
  readonly routine?: ReportRoutineStore;
  /** The collection's latest search record, for `{{SOURCES}}` and the topic. */
  readonly searchRuns?: (
    libraryID: number,
    collectionKey: string,
  ) => Promise<readonly SearchRunSummary[]>;
  /** The window's surface for a job (`P4-T20`); absent: headless. */
  readonly surfaces?: (jobId: string) => TrendReportSurface | undefined;
  /** The Zotero port; {@link createZoteroTrendReportLibrary} by default. */
  readonly library?: TrendReportLibrary;
}

/** {@link PipelineConstructionDeps.summarize}. */
export interface SummarizeConstructionDeps extends Pick<
  SummarizePipelineDeps,
  "store" | "prices" | "baseUrls" | "modelInfo" | "credentials"
> {
  /** `PROMPT_REGISTRY`, imported lazily by default. */
  readonly prompts?: SummarizePipelineDeps["prompts"];
  /** `installServices`' queue, built after the pipelines. */
  readonly jobs: () => JobQueue;
  readonly pauseNotices?: JobPauseNotices;
  /** The Zotero port; {@link createZoteroSummarizeLibrary} by default. */
  readonly library?: SummarizeLibrary;
}

/** `docs/07` §7.2's worker pools and job admission, one each per plugin lifetime. */
export interface WorkerPools {
  /** §7.2's `network-metadata` pool, {@link NETWORK_METADATA_POOL_SIZE}. */
  readonly networkMetadata: Semaphore;
  /** §7.2's `llm` pool, `concurrency` clamped to 1–8 (`P3-T17`). */
  readonly llm: LlmPool;
  /** §7.2's job-level concurrency: one `interactive`, two `background`. */
  readonly admission: JobAdmission;
  /** The work keys of live runs, pinned in the cache. */
  readonly runningWork: RunningWork;
}

/**
 * Build {@link WorkerPools}. Called by {@link buildPipelineSet} only — see the
 * header: a pool built anywhere else would be a second budget.
 */
export function buildWorkerPools(deps: PipelineConstructionDeps): WorkerPools {
  return {
    // The one construction site of `docs/07` §7.2's `network-metadata` pool —
    // see the header. Every pipeline in this set that fetches literature
    // metadata takes this same instance.
    networkMetadata: new Semaphore(NETWORK_METADATA_POOL_SIZE),
    llm: createLlmPool(
      deps.readConcurrency ?? ((): number => getPref("concurrency")),
    ),
    admission: createJobAdmission(),
    runningWork: deps.runningWork ?? createRunningWork(),
  };
}

/**
 * Construct every pipeline this build ships.
 *
 * One function so the set is assembled in one place and a missing member is a
 * compile error at the `PipelineSet` boundary rather than an id that resolves to
 * nothing at run time.
 */
export function buildPipelineSet(deps: PipelineConstructionDeps): PipelineSet {
  // `llm`, `admission` and `runningWork` are the summarize pipeline's
  // (`P3-T29`), from the same `pools` as the search pipeline's.
  const pools = buildWorkerPools(deps);
  return {
    searchImport: createSearchImportPipeline({
      writer: deps.writer,
      writeBatchSize: deps.writeBatchSize ?? DEFAULT_CHUNK_SIZE,
      pool: pools.networkMetadata,
      ...(deps.screening !== undefined && { screening: deps.screening }),
    }),
    summarize: createSummarizePipeline(
      summarizeDepsFrom(deps.summarize, pools),
    ),
    // `P4-T18`: the report run, from the same pools and the summarize
    // pipeline's shared deps; this is its one construction site.
    trendReport: createTrendReportPipeline(
      trendReportDepsFrom(deps.trendReport, deps.summarize, pools),
    ),
  };
}

/**
 * The trend-report pipeline's Zotero port (`P4-T18`): the collection read and
 * acquisition of {@link createZoteroSummarizeLibrary}, `P4-T11`'s
 * `zoteroBibliographyPort` and `P4-T14`'s `writeReportNote`, all from
 * `src/zotero/`, so the pipeline names no `Zotero` global.
 */
export function createZoteroTrendReportLibrary(
  deps: {
    readonly summarize?: SummarizeLibrary;
    readonly searchRuns?: TrendReportConstructionDeps["searchRuns"];
  } = {},
): TrendReportLibrary {
  const reads = deps.summarize ?? createZoteroSummarizeLibrary();
  return {
    loadCollection: (libraryID, collectionKey) =>
      reads.loadCollection(libraryID, collectionKey),
    acquire: (item, options) => reads.acquire(item, options),
    bibliography: zoteroBibliographyPort,
    writeReportNote: (request) => writeReportNote(request),
    ...(deps.searchRuns !== undefined && { searchRuns: deps.searchRuns }),
  };
}

/**
 * The trend-report pipeline's deps from the composition root's. Without them
 * every queue call and both stores refuse with `ConfigurationError`, so a run
 * fails before anything is read or sent.
 */
function trendReportDepsFrom(
  given: TrendReportConstructionDeps | undefined,
  shared: SummarizeConstructionDeps | undefined,
  pools: WorkerPools,
): TrendReportPipelineDeps {
  const summarize = summarizeDepsFrom(shared, pools);
  return {
    library:
      given?.library ??
      createZoteroTrendReportLibrary({
        ...(shared?.library !== undefined && { summarize: shared.library }),
        ...(given?.searchRuns !== undefined && {
          searchRuns: given.searchRuns,
        }),
      }),
    summaries: summarize.store,
    reports:
      given?.reports ?? ((): Promise<undefined> => Promise.resolve(undefined)),
    prompts: summarize.prompts,
    queue: summarize.queue,
    pool: pools.llm,
    admission: pools.admission,
    runningWork: pools.runningWork,
    prices: summarize.prices,
    baseUrls: summarize.baseUrls,
    pluginVersion: given?.pluginVersion ?? "",
    ...(summarize.pauseNotices !== undefined && {
      pauseNotices: summarize.pauseNotices,
    }),
    ...(summarize.modelInfo !== undefined && {
      modelInfo: summarize.modelInfo,
    }),
    ...(summarize.credentials !== undefined && {
      credentials: summarize.credentials,
    }),
    ...(given?.routine !== undefined && { routine: given.routine }),
    ...(given?.surfaces !== undefined && { surfaces: given.surfaces }),
    ...(given?.utcOffsetMinutes !== undefined && {
      utcOffsetMinutes: given.utcOffsetMinutes,
    }),
    ...(given?.wallClockBudgetMs !== undefined && {
      wallClockBudgetMs: given.wallClockBudgetMs,
    }),
  };
}

/**
 * The summarize pipeline's deps from the composition root's. Without them
 * (a graph built with no queue) every queue call and the store refuse with
 * `ConfigurationError`, so a run fails before anything is read or sent.
 */
function summarizeDepsFrom(
  given: SummarizeConstructionDeps | undefined,
  pools: WorkerPools,
): SummarizePipelineDeps {
  const jobs = (): JobQueue => {
    if (given === undefined) {
      throw new ConfigurationError(
        "the summarize pipeline was built without a job queue; nothing was sent",
      );
    }
    return given.jobs();
  };
  return {
    library: given?.library ?? createZoteroSummarizeLibrary(),
    store:
      given?.store ?? ((): Promise<undefined> => Promise.resolve(undefined)),
    // A lazy import, as the search pipeline's `Screening` stage does:
    // `../prompts/bundled` imports the `.md` prompt files.
    prompts:
      given?.prompts ??
      (async () => (await import("../prompts/bundled")).PROMPT_REGISTRY),
    // Through a getter: `installServices` builds the queue after this.
    queue: {
      start: (id) => jobs().start(id),
      pause: (id, reason) => jobs().pause(id, reason),
      resume: (id) => jobs().resume(id),
      cancel: (id) => jobs().cancel(id),
      finishCancel: (id) => jobs().finishCancel(id),
      succeed: (id, ref) => jobs().succeed(id, ref),
      fail: (id, error) => jobs().fail(id, error),
      get: (id) => jobs().get(id),
    },
    pool: pools.llm,
    admission: pools.admission,
    runningWork: pools.runningWork,
    prices: given?.prices ?? (() => undefined),
    baseUrls: given?.baseUrls ?? { effectiveHost: () => "" },
    ...(given?.pauseNotices !== undefined && {
      pauseNotices: given.pauseNotices,
    }),
    ...(given?.modelInfo !== undefined && { modelInfo: given.modelInfo }),
    ...(given?.credentials !== undefined && {
      credentials: given.credentials,
    }),
  };
}

/**
 * Build the registry and fill it — `docs/07` §11.3's single wiring point.
 *
 * @param deps - the write surface and the batch size
 * @returns the filled registry
 */
export function registerPipelines(
  deps: PipelineConstructionDeps,
): PipelineRegistry {
  const registry = createPipelineRegistry();
  registerIntoRegistry(registry, buildPipelineSet(deps));
  return registry;
}

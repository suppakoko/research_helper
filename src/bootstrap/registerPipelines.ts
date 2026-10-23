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
  // `llm`, `admission` and `runningWork` have no taker until the summarize
  // pipeline (`P3-T29`) is constructed here from the same `pools`.
  const pools = buildWorkerPools(deps);
  return {
    searchImport: createSearchImportPipeline({
      writer: deps.writer,
      writeBatchSize: deps.writeBatchSize ?? DEFAULT_CHUNK_SIZE,
      pool: pools.networkMetadata,
      ...(deps.screening !== undefined && { screening: deps.screening }),
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

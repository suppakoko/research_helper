/**
 * The batched importer: N `CanonicalWork`s become N Zotero items in a named
 * collection (`P1-T14`; `docs/10` FR-6, FR-7, FR-51, NFR-1, NFR-3).
 *
 * Six decisions are load-bearing, and each one is a rule from a `Read first`
 * section rather than a preference.
 *
 * **Everything that can be decided outside a transaction is.** `docs/01` §5.8:
 * Zotero's DB is single-writer, and holding a transaction open across anything
 * slow "will stall the whole application". So the existing-item resolution, the
 * `CanonicalWork` → item-JSON mapping and the `new Zotero.Item()` +
 * `fromJSON()` construction all happen **before** the chunk's transaction
 * opens. What is left inside it is `setCollections()` + `save()` per item —
 * pure DB work. No HTTP call is reachable from this module at all: it takes
 * already-fetched records, which is also what `NFR-1` measures.
 *
 * **One search for the whole run, then O(1) per candidate.** Existing-item
 * detection is {@link buildLibraryIndex}'s, called **once** here (`docs/02`
 * §11.6, `P1-T13`). `LibraryIndex.findExisting` is synchronous, which is the
 * compile-time proof that the hot path cannot reach the database; `P1-T13`
 * measured the per-candidate alternative at ≥ 400 searches for one run against
 * 69–72 ms for the whole index at 10,000 items. A caller that already holds an
 * index passes it in ({@link ImportRequest.index}) and no search is issued.
 *
 * **A trashed item does not block an import.** `docs/02` §11.6's advice to "add
 * it to a persistent dismissed list" is feature-6 advice and deliberately does
 * **not** reach this module (`P1-T13` flagged it): {@link buildLibraryIndex}
 * excludes trashed items twice, so a record whose only library match is in the
 * trash simply has no match and is created fresh. That is what `FR-51` asks
 * for.
 *
 * **Chunks of 50 with a yield between them, and the chunk size is
 * instrumented.** `docs/07` §7.2 prescribes "~50 items" and
 * `await Zotero.Promise.delay(0)` between chunks, and marks **both** the number
 * and the safety of notifier suppression `> **Unverified:**`, saying to "start
 * at 50 and instrument it". {@link DEFAULT_CHUNK_SIZE} is 50,
 * {@link ImportRequest.chunkSize} overrides it, and
 * {@link ImportStats.chunkMs} reports every chunk's wall time so
 * `test/integration/zotero/import-perf.spec.ts` can sweep the value rather than
 * trusting it. `NFR-3` caps a single main-thread task at 100 ms and the yield is
 * what keeps a chunk under it.
 *
 * **Notifier suppression is not implemented, on purpose.** §7.2 offers it "where
 * safe" and marks its safety unverified; `P0-T20` then measured that Zotero
 * already queues a transaction's notifier events and delivers them once after
 * the commit — which is `docs/11` R-16's "defer collection-tree updates until
 * the batch completes" — at a cost of 60–100 ms *inside* `NFR-1`'s budget. So
 * the mitigation R-16 asks for is already in force and disabling the notifier
 * would buy an unverified risk for nothing measurable.
 *
 * **An existing item is added to a collection and nothing more.** `P1-T14`'s
 * **Do NOT** and `docs/07` §6.2 ("never overwrite a user-authored `extra`
 * line"): no `fromJSON`, no `setField`, no abstract backfill, no tag, and
 * `skipDateModifiedUpdate` on the one `save()`
 * ({@link addExistingItemsToCollection}). The abstract backfill of `docs/01`
 * §6.3 step 4 therefore applies to **created** items only — see
 * {@link AbstractCoverage}.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, no `AbortController`. The clock is the injected {@link Clock} and
 * cancellation is {@link CancellationToken}.
 */

import { type Clock, createSystemClock } from "../core/clock";
import {
  ResearchHelperError,
  type SerializedError,
  ZoteroApiError,
} from "../core/errors";
import type { CancellationToken } from "../core/jobQueue/cancellation";
import type { CanonicalWork } from "../model/canonicalWork";
import {
  addExistingItemsToCollection,
  type CollectionLookup,
  findOrCreateCollection,
} from "./collectionOps";
import {
  detectNativeIdentifierFields,
  toZoteroMapping,
  type ZoteroMappingOptions,
} from "./itemMapper";
import {
  buildLibraryIndex,
  type ExistingItemMatch,
  type LibraryIndex,
} from "./libraryIndex";

// ---------------------------------------------------------------------------
// 1. What the caller chooses
// ---------------------------------------------------------------------------

/**
 * What to do with a record that already exists in the library.
 *
 * The three arms are `docs/08` §4.4's, verbatim — "per user preference:
 * skip | add existing item to collection | import anyway" — and no more:
 * `docs/07` §8.5 declares **no preference** for this today, so it is a
 * parameter (`P1-T14` step 2: "the duplicate policy"), not a pref read. Adding
 * the pref means adding a §8.5 row first (§8.5's own ordering rule), which is
 * not this card's.
 *
 * - `"link-existing"` — `FR-51`'s behaviour and the default: the existing item
 *   is added to the target collection and counted as
 *   {@link ImportReport.linkedExisting}.
 * - `"skip"` — the record is dropped and counted as
 *   {@link ImportReport.skipped}. Nothing is written for it.
 * - `"import-anyway"` — a second item is created. `FR-51` says never to do this
 *   silently, so it exists only because §4.4 offers it; choosing it is the
 *   user's explicit act, and no index is built when it is in force because
 *   nothing would consult it.
 */
export type DuplicatePolicy = "link-existing" | "skip" | "import-anyway";

/** `FR-51`'s behaviour: link, do not duplicate. */
export const DEFAULT_DUPLICATE_POLICY: DuplicatePolicy = "link-existing";

/**
 * `docs/07` §7.2's "~50 items" per transaction.
 *
 * Marked `> **Unverified:**` there — "start at 50 and instrument it" — so this
 * is a starting point with a measurement attached, not a constant to trust.
 * `test/integration/zotero/import-perf.spec.ts` sweeps it.
 */
export const DEFAULT_CHUNK_SIZE = 50;

/** One import run's inputs. */
export interface ImportRequest {
  /** Already-fetched, already-merged records. No network call is made here. */
  readonly works: readonly CanonicalWork[];
  /** Matched exactly; created when absent (`FR-6`). */
  readonly collectionName: string;
  /** Defaults to the user library. */
  readonly libraryID?: number;
  /** Nest the collection under this one; omitted means top level (`FR-6`). */
  readonly parentCollectionID?: number;
  /** Defaults to {@link DEFAULT_DUPLICATE_POLICY}. */
  readonly duplicatePolicy?: DuplicatePolicy;
  /** Defaults to {@link DEFAULT_CHUNK_SIZE}; `docs/07` §7.2 says to instrument it. */
  readonly chunkSize?: number;
  /**
   * An index built earlier in the same run.
   *
   * Supplying one is how a pipeline that has already read the library avoids a
   * second search (`docs/02` §11.6, "once per run"). Omitting it builds one,
   * **once**, before any transaction opens.
   */
  readonly index?: LibraryIndex;
  /**
   * Passed through to {@link toZoteroMapping}.
   *
   * `nativeIdentifierFields` is filled in from
   * {@link detectNativeIdentifierFields} when absent, because `docs/01` §5.3
   * requires feature detection rather than a version check and the detection
   * needs an `await` this module is already doing.
   */
  readonly mapping?: ZoteroMappingOptions;
  /**
   * `item.fromJSON(json, { strict })` — `docs/01` §5.2.1's "ship non-strict,
   * develop strict".
   *
   * Defaults to `false`, and the switch belongs to the caller rather than to a
   * read of `__env__` here, matching `src/addon.ts`, which passes
   * `__env__ === "development"` into `createScope()`. `__env__` is a build-time
   * define that the scaffold's *test* bundler does not provide (`P0-T20`
   * finding), so a module that reads it directly is a free identifier inside an
   * integration spec.
   */
  readonly strict?: boolean;
  /** Defaults to {@link createSystemClock}. Used for every measurement here. */
  readonly clock?: Clock;
  /**
   * Checked at every chunk boundary (`docs/07` §7.4's checkpoint list).
   *
   * `throwIfCancelled()` throws `OperationCancelledError`, so chunks already
   * committed stay committed — chunked transactions are atomic per chunk, never
   * per run (see {@link ImportStats.transactions}). **`FR-53`'s cancel message
   * wants "the count of items already imported"** (`docs/08` §8.3, `P1-T22`
   * step 4) and a thrown error carries no counts; reported as needing a
   * decision rather than invented here.
   */
  readonly token?: CancellationToken;
  /**
   * The inter-chunk yield. Defaults to `Zotero.Promise.delay(0)`, which is what
   * both `docs/07` §7.2 and `P1-T14` step 4 name.
   *
   * Injectable so a spec can count the yields instead of inferring them.
   */
  readonly yieldToUi?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// 2. What the run reports
// ---------------------------------------------------------------------------

/** One record that did not become an item, and why. */
export interface ImportFailure {
  readonly workKey: string;
  /** The record's title, for the UI's failure list (`docs/08` §4.6). */
  readonly title: string;
  /**
   * `"mapping"` — {@link toZoteroMapping} or `fromJSON()` rejected the record,
   * before any transaction opened. `"write"` — the chunk's transaction failed.
   */
  readonly phase: "mapping" | "write";
  /** Redacted and storable: `docs/07` §10.1's shape, via `toSerialized()`. */
  readonly error: SerializedError;
}

/**
 * `R-17`'s measurement: how many of the items this run **created** carry an
 * abstract.
 *
 * Linked existing items are excluded deliberately. Their abstract is the
 * library's, written by whatever saved them, and counting it would make the
 * number a statement about the user's library rather than about the sources —
 * which is the thing `R-17` is about (`docs/11` R-17, `P0-T21`'s per-source
 * coverage table). It is also why nothing here touches an existing item's
 * `abstractNote`: `P1-T14`'s **Do NOT** says existing items are *added to a
 * collection*, nothing more.
 *
 * `withAbstract` is counted by reading `item.getField("abstractNote")` back off
 * the saved item, not by looking at `work.abstract`, so a field `fromJSON()`
 * silently dropped shows up as missing rather than as present.
 */
export interface AbstractCoverage {
  /** Items created by this run — the denominator. */
  readonly itemsCreated: number;
  /** Of those, how many have a non-empty `abstractNote`. */
  readonly withAbstract: number;
  /** `withAbstract / itemsCreated`, or 0 when nothing was created. */
  readonly fraction: number;
  /** `fraction` as a whole-number percentage, for `$percent` in the FTL. */
  readonly percent: number;
  /**
   * How many of those abstracts had to be repaired by `docs/01` §6.3 step 4's
   * backfill ("if `abstractNote` is empty and we have one from the API, set
   * it").
   *
   * Expected to be **0** on the hand-mapped path, because
   * {@link toZoteroMapping} puts `work.abstract` straight into the item JSON.
   * A non-zero value means `fromJSON()` dropped a field it was given, which is
   * worth seeing rather than silently fixing.
   */
  readonly backfilled: number;
}

/** What the run cost, so `docs/07` §7.2's chunk size can be instrumented. */
export interface ImportStats {
  readonly chunkSize: number;
  /** Write chunks run, over created items and over linked items together. */
  readonly chunks: number;
  /**
   * `Zotero.DB.executeTransaction` calls made.
   *
   * **Atomicity is per chunk, not per run.** `FR-6` requires items "created
   * inside a single Zotero transaction **per batch** so a failure does not
   * leave a half-populated collection", and `docs/07` §7.2's chunking is what
   * makes a batch smaller than a run. A failure in chunk 3 therefore leaves
   * chunks 1–2 committed; that is the trade §7.2 prescribes for `NFR-3`, and
   * `P0-T20`'s single-transaction shape is recoverable by passing a
   * {@link ImportRequest.chunkSize} at or above `works.length`.
   */
  readonly transactions: number;
  /** Wall time for the whole call, including the index build. */
  readonly elapsedMs: number;
  /** Index build time, 0 when an index was supplied or none was needed. */
  readonly indexMs: number;
  /**
   * `Zotero.Search` calls **this call** made while building the index: one, or
   * zero when an index was supplied or none was needed.
   *
   * Deliberately not the supplied index's own `stats.searchCount`, which is a
   * fact about whoever built it rather than about this import.
   */
  readonly indexSearchCount: number;
  /** True when {@link ImportRequest.index} was supplied. */
  readonly indexReused: boolean;
  /** Mapping + `fromJSON()` time, summed across chunks. Outside every transaction. */
  readonly mappingMs: number;
  /** Time inside `executeTransaction`, summed across chunks. */
  readonly writeMs: number;
  /** Every chunk's wall time, in order — the `NFR-3` evidence. */
  readonly chunkMs: readonly number[];
}

/** `P1-T14` step 7's report. */
export interface ImportReport {
  readonly collection: Zotero.Collection;
  /** False when a same-named collection was reused (`FR-6`: "create or reuse"). */
  readonly collectionCreated: boolean;
  /** New items written. */
  readonly created: number;
  /**
   * Existing library items added to the collection instead of being
   * duplicated.
   *
   * `FR-51` requires this reported as `linked existing: N`. The **string** is
   * not built here: `docs/08` §10.3 forbids concatenating translated fragments
   * and `P1-T18` already ships the one Fluent message,
   * `research-helper-import-summary` = `Imported { $imported } · Linked
   * { $linked } · Skipped { $skipped } duplicates · { $failed } failed`. These
   * four counters are that message's four arguments, and
   * {@link AbstractCoverage.percent} is
   * `research-helper-import-abstract-coverage`'s `$percent`. The corpus has four
   * spellings of the line (`docs/08` §4.4, §4.6 rule 4, `P1-T22` step 3,
   * `FR-51`); `P1-T22`'s is the one with both a linked/created split and a
   * duplicate count, it is the one `P1-T18` localized, and so it is the one
   * these fields feed.
   */
  readonly linkedExisting: number;
  /**
   * Records dropped without a write: a library duplicate under
   * `"skip"`, or a `workKey` repeated inside `works`.
   */
  readonly skipped: number;
  readonly failed: readonly ImportFailure[];
  readonly abstractCoverage: AbstractCoverage;
  /** Created item IDs, in input order. */
  readonly createdItemIDs: readonly number[];
  /** Linked existing item IDs, in input order. */
  readonly linkedItemIDs: readonly number[];
  /** How each linked record matched (`"doi"` or `"pmid"`), in input order. */
  readonly linkedMatches: readonly ExistingItemMatch[];
  readonly stats: ImportStats;
}

// ---------------------------------------------------------------------------
// 3. The import
// ---------------------------------------------------------------------------

/**
 * Import `works` into the named collection, in batched transactions.
 *
 * The order is `docs/08` §4.4's: resolve the target collection, run the dedup
 * pass, write the new items, backfill abstracts, link the existing items,
 * report. §4.4's `Zotero.Translate.Search` branch is **not** here — Phase 1
 * ships the hand-mapped path only, `useTranslators` ships `false`
 * (`docs/07` §8.5) and `P2-T18` owns Strategy B — so this module neither reads
 * that preference nor imports `Zotero.Translate`.
 *
 * @param request - the records, the destination and the policies
 * @returns the counts, the IDs, the `R-17` coverage and the timings
 * @throws `OperationCancelledError` when {@link ImportRequest.token} is
 *   cancelled at a chunk boundary; chunks already committed remain committed
 */
export async function importWorks(
  request: ImportRequest,
): Promise<ImportReport> {
  const clock = request.clock ?? createSystemClock();
  const startedAt = clock.now();
  const libraryID = request.libraryID ?? Zotero.Libraries.userLibraryID;
  const policy = request.duplicatePolicy ?? DEFAULT_DUPLICATE_POLICY;
  const chunkSize = Math.max(
    1,
    Math.trunc(request.chunkSize ?? DEFAULT_CHUNK_SIZE),
  );
  const strict = request.strict ?? false;
  const yieldToUi = request.yieldToUi ?? defaultYield;

  // An already-cancelled token must not write anything at all — the first of
  // `docs/07` §7.4's check points is "before starting work".
  request.token?.throwIfCancelled();

  // `docs/01` §5.2.1: `fromJSON()` reads the schema, and §5.3: `getID()` throws
  // `UnloadedDataException` before it is loaded. Awaited **once**, before the
  // loop (`P1-T14` step 3) — never inside a transaction.
  await Zotero.Schema.schemaUpdatePromise;

  const mapping: ZoteroMappingOptions = {
    ...request.mapping,
    nativeIdentifierFields:
      request.mapping?.nativeIdentifierFields ??
      (await detectNativeIdentifierFields()),
  };

  // ---- dedup pass: every lookup before any transaction (`P1-T14` step 2) ----
  const { index, indexMs } = await resolveIndex(
    request,
    libraryID,
    policy,
    clock,
  );
  const plan = planImport(request.works, index, policy);

  // ---- write ----
  const failed: ImportFailure[] = [];
  const createdItemIDs: number[] = [];
  const chunkMs: number[] = [];
  let mappingMs = 0;
  let writeMs = 0;
  let transactions = 0;
  let backfilled = 0;
  let withAbstract = 0;

  let lookup: CollectionLookup | undefined;
  /** Find-or-create, lazily, inside whichever transaction runs first. */
  const ensureCollection = async (): Promise<CollectionLookup> => {
    lookup ??= await findOrCreateCollection(
      request.collectionName,
      libraryID,
      request.parentCollectionID,
    );
    return lookup;
  };

  let firstChunk = true;
  for (const chunk of chunksOf(plan.toCreate, chunkSize)) {
    if (!firstChunk) {
      // `docs/07` §7.2's inter-chunk yield, then `docs/07` §7.4's checkpoint.
      await yieldToUi();
      request.token?.throwIfCancelled();
    }
    firstChunk = false;

    const chunkStartedAt = clock.now();

    // Mapping and construction, **outside** the transaction. A throw here is
    // one record's failure, not the chunk's: `docs/01` §5.8 keeps HTTP out of
    // a transaction for latency, and keeping `fromJSON()` out of it keeps a
    // single malformed record from rolling back the other 49 — which is
    // `P1-T14`'s "does not abort the batch or the remaining batches".
    const built: BuiltItem[] = [];
    for (const work of chunk) {
      try {
        built.push(buildItem(work, libraryID, mapping, strict));
      } catch (error) {
        failed.push(toFailure(work, "mapping", error));
      }
    }
    const tMapped = clock.now();
    mappingMs += tMapped - chunkStartedAt;

    if (built.length > 0) {
      try {
        const written = await Zotero.DB.executeTransaction(
          async (): Promise<ChunkWriteResult> => {
            const { collection } = await ensureCollection();
            const ids: number[] = [];
            for (const entry of built) {
              // `setCollections()` before the single `save()`: one write, not
              // two (`docs/01` §5.2, "at creation time"). Safe here and only
              // here, because every item in `built` is new — it replaces
              // membership, which is why an *existing* item goes through
              // `addExistingItemsToCollection()` instead.
              entry.item.setCollections([collection.id]);
              // save(), not saveTx(): `docs/01` §5.8 / §12 gotcha 12.
              await entry.item.save();
              ids.push(entry.item.id);
            }
            // `docs/01` §6.3 step 4, "the single highest-value post-processing
            // step": `setField`, never `fromJSON` — §5.2.1 hard rule 1 forbids
            // `fromJSON` on an item that now exists.
            let repaired = 0;
            let present = 0;
            for (const entry of built) {
              const current = entry.item.getField("abstractNote");
              if (current === "" && entry.abstract !== undefined) {
                entry.item.setField("abstractNote", entry.abstract);
                await entry.item.save();
                repaired += 1;
              }
              if (entry.item.getField("abstractNote") !== "") present += 1;
            }
            return { ids, repaired, present };
          },
        );
        transactions += 1;
        createdItemIDs.push(...written.ids);
        backfilled += written.repaired;
        withAbstract += written.present;
      } catch (error) {
        transactions += 1;
        // The transaction rolled back, so none of this chunk's records became
        // an item. Each is reported, and the loop continues to the next chunk.
        for (const entry of built) {
          failed.push(toFailure(entry.work, "write", error));
        }
      }
    }

    const chunkEndedAt = clock.now();
    chunkMs.push(chunkEndedAt - chunkStartedAt);
    writeMs += chunkEndedAt - tMapped;
  }

  // ---- link the existing items (`P1-T14` step 5, `FR-51`) ----
  const linkedItemIDs: number[] = [];
  for (const chunk of chunksOf(plan.toLink, chunkSize)) {
    if (!firstChunk) {
      await yieldToUi();
      request.token?.throwIfCancelled();
    }
    firstChunk = false;

    const chunkStartedAt = clock.now();
    // Loaded outside the transaction: these are DB reads, and `inCollection()`
    // needs the item's `collections` data type, which an item already in
    // Zotero's object cache may have arrived without. Same batched load
    // `buildLibraryIndex` does, for the same reason.
    const items = await Zotero.Items.getAsync(
      chunk.map((entry) => entry.itemID),
    );
    await Zotero.Items.loadDataTypes(items);
    const tMapped = clock.now();
    try {
      await Zotero.DB.executeTransaction(async (): Promise<void> => {
        const { collection } = await ensureCollection();
        await addExistingItemsToCollection(items, collection);
      });
      transactions += 1;
      // Every record that resolved to an existing item is counted, including
      // one whose item was already a member: `FR-51` counts "matched an
      // existing library item", and `addExistingItemsToCollection` skips the
      // redundant *write*, not the record.
      linkedItemIDs.push(...chunk.map((entry) => entry.itemID));
    } catch (error) {
      transactions += 1;
      for (const entry of chunk) {
        failed.push(toFailure(entry.work, "write", error));
      }
    }
    const chunkEndedAt = clock.now();
    chunkMs.push(chunkEndedAt - chunkStartedAt);
    writeMs += chunkEndedAt - tMapped;
  }

  // ---- the collection must exist even when nothing was written ----
  // `FR-6`: "a collection with that exact name exists under the chosen parent"
  // is a post-condition of the import, not of the write. An empty result set,
  // an all-skipped run and an all-failed run must still leave the collection.
  let resolved = lookup;
  if (resolved === undefined) {
    resolved = await Zotero.DB.executeTransaction(() => ensureCollection());
    transactions += 1;
  }

  const itemsCreated = createdItemIDs.length;
  const fraction = itemsCreated === 0 ? 0 : withAbstract / itemsCreated;

  return {
    collection: resolved.collection,
    collectionCreated: resolved.created,
    created: itemsCreated,
    linkedExisting: linkedItemIDs.length,
    skipped: plan.skipped,
    failed,
    abstractCoverage: {
      itemsCreated,
      withAbstract,
      fraction,
      percent: Math.round(fraction * 100),
      backfilled,
    },
    createdItemIDs,
    linkedItemIDs,
    linkedMatches: plan.toLink.map((entry) => entry.match),
    stats: {
      chunkSize,
      chunks: chunkMs.length,
      transactions,
      elapsedMs: clock.now() - startedAt,
      indexMs,
      indexSearchCount:
        request.index !== undefined ? 0 : (index?.stats.searchCount ?? 0),
      indexReused: request.index !== undefined,
      mappingMs,
      writeMs,
      chunkMs,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. The pieces
// ---------------------------------------------------------------------------

/** One record that mapped cleanly, with its unsaved item. */
interface BuiltItem {
  readonly work: CanonicalWork;
  readonly item: Zotero.Item;
  /** `work.abstract`, when non-empty — the backfill's source. */
  readonly abstract: string | undefined;
}

interface ChunkWriteResult {
  readonly ids: readonly number[];
  readonly repaired: number;
  readonly present: number;
}

/** One record that resolved to an item already in the library. */
interface LinkTarget {
  readonly work: CanonicalWork;
  readonly itemID: number;
  readonly match: ExistingItemMatch;
}

interface ImportPlan {
  readonly toCreate: readonly CanonicalWork[];
  readonly toLink: readonly LinkTarget[];
  readonly skipped: number;
}

/**
 * `Zotero.Promise.delay(0)` — the yield `docs/07` §7.2 and `P1-T14` step 4
 * both name.
 *
 * It survives in Zotero 10 even though Bluebird does not (`docs/01` §2.3:
 * "`Zotero.Promise.delay()` and `Zotero.Promise.defer()` still work"), and it
 * is a `setTimeout`-backed macrotask yield, which is what lets the main
 * window's event loop run between chunks and so what keeps a 200-item import
 * inside `NFR-3`.
 */
function defaultYield(): Promise<void> {
  return Zotero.Promise.delay(0) as unknown as Promise<void>;
}

/**
 * Build the index, unless the caller supplied one or the policy cannot use one.
 *
 * `"import-anyway"` consults nothing, so building an index for it would be one
 * `Zotero.Search` over the whole library for an answer nobody reads.
 */
async function resolveIndex(
  request: ImportRequest,
  libraryID: number,
  policy: DuplicatePolicy,
  clock: Clock,
): Promise<{ index: LibraryIndex | undefined; indexMs: number }> {
  if (request.index !== undefined) {
    return { index: request.index, indexMs: 0 };
  }
  if (policy === "import-anyway" || request.works.length === 0) {
    return { index: undefined, indexMs: 0 };
  }
  const startedAt = clock.now();
  const index = await buildLibraryIndex(libraryID);
  return { index, indexMs: clock.now() - startedAt };
}

/**
 * `docs/08` §4.4's dedup pass, as pure bookkeeping over a built index.
 *
 * Nothing here awaits: {@link LibraryIndex.findExisting} is synchronous by
 * design (`P1-T13`), so the whole plan is O(works) map reads.
 *
 * **A `workKey` repeated inside `works` is skipped.** `docs/07` §5.1 makes
 * `workKey` the primary key of a `CanonicalWork`, so two entries carrying one
 * is the caller handing in the same record twice, and creating two items for it
 * would break `FR-51` inside a single run. Two *different* `workKey`s that
 * share a DOI are a different problem — cross-source identity — and `P2-T09`
 * owns it; this card must not grow a second dedup rule beside
 * {@link LibraryIndex}'s.
 */
function planImport(
  works: readonly CanonicalWork[],
  index: LibraryIndex | undefined,
  policy: DuplicatePolicy,
): ImportPlan {
  const toCreate: CanonicalWork[] = [];
  const toLink: LinkTarget[] = [];
  const seenWorkKeys = new Set<string>();
  let skipped = 0;

  for (const work of works) {
    if (seenWorkKeys.has(work.workKey)) {
      skipped += 1;
      continue;
    }
    seenWorkKeys.add(work.workKey);

    const match = index?.findExisting(work.ids);
    if (match === undefined || policy === "import-anyway") {
      toCreate.push(work);
      continue;
    }
    if (policy === "skip") {
      skipped += 1;
      continue;
    }
    toLink.push({ work, itemID: match.itemID, match });
  }

  return { toCreate, toLink, skipped };
}

/**
 * `CanonicalWork` → an unsaved `Zotero.Item`, outside any transaction.
 *
 * `fromJSON()` and not field-by-field `setField()`: `docs/01` §5.2.1 —
 * `setField` throws on a field invalid for the item type, and `fromJSON` owns
 * that validation matrix, resolves base-field mappings and migrates recognised
 * `Extra` lines. It is a **replace, not a merge**, which is why it is only ever
 * handed a brand-new item.
 *
 * `toZoteroMapping`'s `overflowNote` is **not** written. `docs/07` §6.3 says the
 * deferred `extra` payload becomes a child note, and creating that note is a
 * second item per record — a write this card's `Files` list, counts and
 * criteria do not cover. Reported as needing its own card rather than
 * half-built here.
 */
function buildItem(
  work: CanonicalWork,
  libraryID: number,
  mapping: ZoteroMappingOptions,
  strict: boolean,
): BuiltItem {
  const { itemJSON } = toZoteroMapping(work, mapping);
  const item = new Zotero.Item();
  item.libraryID = libraryID;
  item.fromJSON(itemJSON, { strict });
  const abstract =
    work.abstract !== undefined && work.abstract !== ""
      ? work.abstract
      : undefined;
  return { work, item, abstract };
}

/** `[a,b,c,d]`, 2 → `[[a,b],[c,d]]`. Empty input yields nothing. */
function* chunksOf<T>(
  values: readonly T[],
  size: number,
): Generator<readonly T[]> {
  for (let start = 0; start < values.length; start += size) {
    yield values.slice(start, start + size);
  }
}

/**
 * One failure, in `docs/07` §10.1's redacted shape.
 *
 * A thrown value that is not a {@link ResearchHelperError} is wrapped in
 * {@link ZoteroApiError} rather than stringified, so `failed[]` is one type and
 * `docs/08` §8.3's error table has a `messageKey` to map. The wrap keeps the
 * original as `cause`.
 */
function toFailure(
  work: CanonicalWork,
  phase: ImportFailure["phase"],
  error: unknown,
): ImportFailure {
  const wrapped =
    error instanceof ResearchHelperError
      ? error
      : new ZoteroApiError(
          error instanceof Error ? error.message : String(error),
          { workKey: work.workKey, phase },
          { cause: error },
        );
  return {
    workKey: work.workKey,
    title: work.title,
    phase,
    error: wrapped.toSerialized(),
  };
}

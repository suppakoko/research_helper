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
 * pure DB work. On the hand-mapped path — the shipped default and the one
 * `NFR-1` measures — no HTTP call is reachable from this module: it takes
 * already-fetched records. The one exception is opt-in and arrives as
 * {@link ImportRequest.translatorLookup}: `P2-T18`'s Strategy B, whose
 * identifier lookups are network round trips run by `./translatorImport.ts`,
 * one at a time and outside every transaction.
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
 * {@link AbstractCoverage}. The one exception is a caller's own request:
 * {@link ImportRequest.relateTo} adds a *Related* link to the seed (`P5-T17`).
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
import type { CanonicalWork, WorkType } from "../model/canonicalWork";
import { areOtherVersions } from "../model/merge";
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
import {
  type ImportPath,
  lookupThroughTranslators,
  TRANSLATOR_FALLBACK_REASONS,
  type TranslatedWork,
  type TranslatorFallbackReason,
  type TranslatorImportOptions,
} from "./translatorImport";

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
  /**
   * Strategy B (`P2-T18`, `docs/01` §6.3 item 3): present only when the
   * writer read `useTranslators` as on, once, at the entry to `WritingItems`
   * (`docs/07` §12.1). **Absent, the import is exactly the hand-mapped path**
   * — not one call, request or transaction differs — which is the shipped
   * default and the path `NFR-1` measures.
   *
   * Present, every record to be created is first looked up through
   * `Zotero.Translate.Search` (`./translatorImport.ts`); a record whose lookup
   * fails, times out, finds no translator or returns nothing — or that has no
   * usable identifier — is hand-mapped as if the option were absent, and is
   * counted in {@link ImportReport.importPaths}.
   */
  readonly translatorLookup?: TranslatorImportOptions;
  /**
   * Relate every item this call creates or links to this item, on both sides
   * (`P5-T17`, FR-17; `docs/07` §6.2's note of 2026-11-05). Its one caller is
   * the writer in `src/bootstrap/registerPipelines.ts`, for the related
   * window's import. Absent, no such write happens, which is every keyword run.
   */
  readonly relateTo?: number;
  /**
   * `workKey` → the item a caller has already matched that work to (`P5-T17`,
   * FR-16). The library index finds identifier matches and exact work keys only,
   * so the related pipeline's **title** match reaches this call only by this
   * route: without it a row matched by title and ticked by hand would create a
   * second item. An identifier match in the index still wins. An entry whose
   * item is trashed, gone or in another library is ignored, because the match was
   * made earlier in the session. Same caller as {@link relateTo}.
   */
  readonly existingItemIDs?: ReadonlyMap<string, number>;
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

/**
 * `P2-T18` step 10: which path produced the created items, and why records
 * that could have gone through Zotero's translators did not.
 */
export interface ImportPathReport {
  /** True when {@link ImportRequest.translatorLookup} was supplied. */
  readonly translatorsRequested: boolean;
  /** Items created through Strategy B. Always 0 when not requested. */
  readonly viaTranslators: number;
  /** Items created by hand-mapping (Strategy A). */
  readonly handMapped: number;
  /**
   * Records sent to Strategy A by the translator path — the sum of
   * {@link fallbackReasons}. A record counted here can still fail to map;
   * it is then also in {@link ImportReport.failed}.
   */
  readonly fellBack: number;
  /** {@link fellBack}, by reason class. Every reason is present, 0 or more. */
  readonly fallbackReasons: Readonly<Record<TranslatorFallbackReason, number>>;
  /** `Translate.Search` objects constructed — one per lookup. */
  readonly searches: number;
}

/**
 * What {@link ImportRequest.relateTo} did (`P5-T17`). `planImport` also builds
 * the `"caller"` arm of {@link LinkedMatch} for the same request.
 */
export interface SeedLinkReport {
  /** Items now related to the seed on both sides, new links and old alike. */
  readonly linked: number;
  /**
   * Set when the write failed or the seed could not be read. The items stay as
   * imported, without the link; redacted and storable like
   * {@link ImportFailure.error}.
   */
  readonly error: SerializedError | undefined;
}

/**
 * How a linked record matched: the index's own answer, or
 * {@link ImportRequest.existingItemIDs}'s.
 */
export type LinkedMatch =
  ExistingItemMatch | { readonly itemID: number; readonly matchedOn: "caller" };

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
  /**
   * The path that produced each of {@link createdItemIDs}, aligned with it
   * (`P2-T18` step 9: "record which path produced each item").
   */
  readonly createdVia: readonly ImportPath[];
  /** `P2-T18` step 10's per-run counts. */
  readonly importPaths: ImportPathReport;
  /** Linked existing item IDs, in input order. */
  readonly linkedItemIDs: readonly number[];
  /** How each linked record matched, in input order. */
  readonly linkedMatches: readonly LinkedMatch[];
  /**
   * Pairs of created items related to each other through Zotero *Related*
   * because one is the other's preprint or published version (`P2-T11`, gate
   * `G-16`, `docs/07` §6.2). Each pair once, as item IDs in input order.
   */
  readonly versionLinks: readonly (readonly [number, number])[];
  /**
   * Set when the *Related* write failed. The items stay created, without the
   * relation, and {@link versionLinks} is empty; redacted and storable like
   * {@link ImportFailure.error}.
   */
  readonly versionLinkError: SerializedError | undefined;
  /** Present exactly when {@link ImportRequest.relateTo} was given. */
  readonly seedLink: SeedLinkReport | undefined;
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
 * report. §4.4's `Zotero.Translate.Search` branch runs only when
 * {@link ImportRequest.translatorLookup} is supplied (`P2-T18`), between the
 * dedup pass and the hand-mapped write: its items get the same abstract
 * repair, and its fallbacks become the hand-mapped write's input. This module
 * never reads `useTranslators` (the writer does, once per run) and never names
 * `Zotero.Translate` (`./translatorImport.ts` does).
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
  const known =
    request.existingItemIDs === undefined
      ? undefined
      : await usableExistingItems(request.existingItemIDs, libraryID);
  const plan = planImport(request.works, index, policy, known);
  // `P2-T11`: which other versions of each work this call creates — decided
  // before any mapping, because it chooses between the `extra` line and the
  // *Related* relation (`docs/07` §6.2's `relatedVersionIds.doi` rows).
  const versionTypes = importedVersionTypes(plan.toCreate);

  // ---- write ----
  const failed: ImportFailure[] = [];
  const createdItemIDs: number[] = [];
  /** Every item this call created, with its work — the relation pass's input. */
  const createdEntries: BuiltItem[] = [];
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

  // ---- Strategy B (`P2-T18`): only when the writer read the pref on ----
  // Absent, `handMapQueue` is `plan.toCreate` itself and nothing below this
  // block runs differently from the shipped hand-mapped path.
  const createdVia: ImportPath[] = [];
  const fallbackReasons = emptyFallbackCounts();
  let handMapQueue: readonly CanonicalWork[] = plan.toCreate;
  let translatorSearches = 0;
  if (request.translatorLookup !== undefined && plan.toCreate.length > 0) {
    // `translate()` saves straight into the collection, so it must exist
    // before the first lookup; resolved in a transaction of its own, before
    // any network call, never inside one.
    const target = await Zotero.DB.executeTransaction(() => ensureCollection());
    transactions += 1;
    const looked = await lookupThroughTranslators({
      works: plan.toCreate,
      libraryID,
      collectionID: target.collection.id,
      ...(request.token !== undefined && { token: request.token }),
      options: request.translatorLookup,
    });
    translatorSearches = looked.searches;
    for (const fallback of looked.fallbacks) {
      fallbackReasons[fallback.reason] += 1;
    }
    handMapQueue = looked.fallbacks.map((fallback) => fallback.work);

    for (const chunk of chunksOf(looked.translated, chunkSize)) {
      if (!firstChunk) {
        await yieldToUi();
        request.token?.throwIfCancelled();
      }
      firstChunk = false;
      const chunkStartedAt = clock.now();
      // Decided outside the transaction, as the hand-mapped path decides
      // its mapping outside it.
      const planned = chunk.map((entry) => ({
        ...entry,
        abstract: nonEmptyAbstract(entry.work),
        repository: preprintRepository(entry, mapping),
      }));
      const tMapped = clock.now();
      mappingMs += tMapped - chunkStartedAt;
      try {
        const written = await Zotero.DB.executeTransaction(
          async (): Promise<{ repaired: number; present: number }> => {
            let repaired = 0;
            let present = 0;
            for (const entry of planned) {
              let changed = false;
              // `docs/01` §6.3 step 4 after **either** path: translators
              // "frequently drop abstracts". `setField`, never `fromJSON`.
              if (
                entry.item.getField("abstractNote") === "" &&
                entry.abstract !== undefined
              ) {
                entry.item.setField("abstractNote", entry.abstract);
                repaired += 1;
                changed = true;
              }
              // `P2-T08`'s server attribution, on the type the translator
              // chose — never re-mapped — and only into an empty field: the
              // user turned this path on for Zotero-canonical metadata.
              if (entry.repository !== undefined) {
                entry.item.setField("repository", entry.repository);
                changed = true;
              }
              // save(), not saveTx(): `docs/01` §5.8 / §12 gotcha 12.
              if (changed) await entry.item.save();
              if (entry.item.getField("abstractNote") !== "") present += 1;
            }
            return { repaired, present };
          },
        );
        backfilled += written.repaired;
        withAbstract += written.present;
      } catch (error) {
        // The translator already saved these items, so they are created
        // whatever happened here; only the repair is lost. Counted from the
        // fields as they stand, and logged rather than thrown.
        for (const entry of planned) {
          if (entry.item.getField("abstractNote") !== "") withAbstract += 1;
        }
        request.translatorLookup.logger?.warn(
          "searchImport: could not repair translator-imported items",
          {
            items: planned.length,
            code: (error instanceof ResearchHelperError
              ? error
              : new ZoteroApiError(String(error), {
                  phase: "translator-repair",
                })
            ).code,
          },
        );
      }
      transactions += 1;
      for (const entry of chunk) {
        createdItemIDs.push(entry.item.id);
        createdVia.push("translator");
        createdEntries.push({
          work: entry.work,
          item: entry.item,
          abstract: nonEmptyAbstract(entry.work),
        });
      }
      const chunkEndedAt = clock.now();
      chunkMs.push(chunkEndedAt - chunkStartedAt);
      writeMs += chunkEndedAt - tMapped;
    }
  }

  for (const chunk of chunksOf(handMapQueue, chunkSize)) {
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
        const types = versionTypes.get(work) ?? [];
        built.push(
          buildItem(
            work,
            libraryID,
            types.length > 0
              ? { ...mapping, importedVersionTypes: types }
              : mapping,
            strict,
          ),
        );
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
        for (const _id of written.ids) createdVia.push("hand-map");
        createdEntries.push(...built);
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

  // Strategy B wrote its items before the hand-mapped fallbacks; put both
  // back in input order, which `createdItemIDs` promises and the relation
  // pass below pairs in. A no-op on the hand-mapped path.
  if (request.translatorLookup !== undefined) {
    restoreInputOrder(
      plan.toCreate,
      createdEntries,
      createdItemIDs,
      createdVia,
    );
  }

  // ---- relate the versions this call created (`P2-T11`, gate `G-16`) ----
  // Two items, never one: each side gets `addRelatedItem(other)`, because
  // Zotero stores the relation per item, and one `save()` per touched item,
  // inside one transaction of its own. Only items created above are touched —
  // an existing item is "added to a collection and nothing more" (`P1-T14`).
  // A failure leaves the items as created, each without the relation, and is
  // reported rather than thrown: the items are the import, the relation is
  // what `docs/07` §6.2 adds to it.
  const versionLinks: (readonly [number, number])[] = [];
  let versionLinkError: SerializedError | undefined;
  const pairs = versionPairs(createdEntries);
  if (pairs.length > 0) {
    const relateStartedAt = clock.now();
    try {
      await Zotero.DB.executeTransaction(async (): Promise<void> => {
        const touched = new Set<Zotero.Item>();
        for (const [a, b] of pairs) {
          a.item.addRelatedItem(b.item);
          b.item.addRelatedItem(a.item);
          touched.add(a.item);
          touched.add(b.item);
        }
        // save(), not saveTx(): `docs/01` §5.8 / §12 gotcha 12.
        for (const item of touched) await item.save();
      });
      for (const [a, b] of pairs) versionLinks.push([a.item.id, b.item.id]);
    } catch (error) {
      versionLinkError = (
        error instanceof ResearchHelperError
          ? error
          : new ZoteroApiError(
              error instanceof Error ? error.message : String(error),
              { phase: "relate-versions", pairs: pairs.length },
              { cause: error },
            )
      ).toSerialized();
    }
    transactions += 1;
    writeMs += clock.now() - relateStartedAt;
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

  // ---- relate what this call wrote to the seed (`P5-T17`, FR-17) ----
  let seedLink: SeedLinkReport | undefined;
  const seedID = request.relateTo;
  const toRelate = [...createdItemIDs, ...linkedItemIDs];
  if (seedID !== undefined) {
    const relateStartedAt = clock.now();
    seedLink = await relateToSeed(seedID, toRelate);
    if (toRelate.length > 0) {
      transactions += 1;
      writeMs += clock.now() - relateStartedAt;
    }
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
    createdVia,
    importPaths: {
      translatorsRequested: request.translatorLookup !== undefined,
      viaTranslators: createdVia.filter((via) => via === "translator").length,
      handMapped: createdVia.filter((via) => via === "hand-map").length,
      fellBack: TRANSLATOR_FALLBACK_REASONS.reduce(
        (sum, reason) => sum + fallbackReasons[reason],
        0,
      ),
      fallbackReasons,
      searches: translatorSearches,
    },
    linkedItemIDs,
    linkedMatches: plan.toLink.map((entry) => entry.match),
    versionLinks,
    versionLinkError,
    seedLink,
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
  readonly match: LinkedMatch;
}

/** {@link planImport}'s answer. Exported with it, for the unit test. */
export interface ImportPlan {
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
 *
 * **The work's own key is passed to the index** (`P2-T37`). Without it
 * `findExisting` derives a key from the identifiers alone and so cannot reach
 * the `hash:` arm: a work with no DOI, PMID, arXiv id or S2 corpus id — a
 * PMCID-only Europe PMC record — was created again on every re-run
 * (`P2-T16` Part A, defect D1). The key is still the last arm tried, so an
 * identifier that names another item wins over it.
 *
 * **`known` comes after the index** (`P5-T17`): the item a caller matched by
 * title, when the library has no identifier or key match for the work. The
 * policy then applies as to any other match. Exported for the unit test.
 *
 * @param works - the records, in input order
 * @param index - the library index, when the policy needs one
 * @param policy - what to do with a match
 * @param known - {@link usableExistingItems}'s answer, when the caller gave any
 */
export function planImport(
  works: readonly CanonicalWork[],
  index: LibraryIndex | undefined,
  policy: DuplicatePolicy,
  known?: ReadonlyMap<string, number>,
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

    const knownItemID = known?.get(work.workKey);
    const match: LinkedMatch | undefined =
      index?.findExisting(work.ids, work.workKey) ??
      (knownItemID === undefined
        ? undefined
        : { itemID: knownItemID, matchedOn: "caller" });
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
 * The entries of {@link ImportRequest.existingItemIDs} that still name a regular
 * item, out of the trash, in this library. Read before any transaction, as every
 * lookup here is. Exported for the unit test.
 *
 * @param existing - `workKey` → item id, as the caller matched them
 * @param libraryID - the library this import writes to
 * @returns the entries an import may link to
 */
export async function usableExistingItems(
  existing: ReadonlyMap<string, number>,
  libraryID: number,
): Promise<ReadonlyMap<string, number>> {
  const usable = new Map<string, number>();
  if (existing.size === 0) return usable;
  const items = await Zotero.Items.getAsync([...existing.values()]);
  const live = new Set(
    items
      .filter(
        (item) =>
          !item.deleted && item.isRegularItem() && item.libraryID === libraryID,
      )
      .map((item) => item.id),
  );
  for (const [workKey, itemID] of existing) {
    if (live.has(itemID)) usable.set(workKey, itemID);
  }
  return usable;
}

/** An unexpected value as this module's error type, for a report. */
function seedLinkError(
  error: unknown,
  relatedItems: number,
): SeedLinkReport["error"] {
  return (
    error instanceof ResearchHelperError
      ? error
      : new ZoteroApiError(
          error instanceof Error ? error.message : String(error),
          { phase: "relate-to-seed", items: relatedItems },
          { cause: error },
        )
  ).toSerialized();
}

/**
 * `P5-T17`'s relation pass: each item related to the seed and the seed to each
 * item, `save()` on each side inside one transaction (`docs/08` §5.1 step 5,
 * `docs/01` §5.8).
 *
 * Reported, never thrown: the items are the import, and the link is what the
 * user asked for on top of it. A side already holding the relation is not saved
 * (`addRelation` answers `false`, read from 10.0.3's `omni.ja`). Date Modified
 * is left alone, because a link is not an edit of the paper, as
 * `addExistingItemsToCollection` leaves it for a collection add.
 *
 * Called by {@link importWorks}. Exported for the unit test.
 *
 * @param seedID - {@link ImportRequest.relateTo}
 * @param itemIDs - what the call created and linked
 * @returns how many items are now related, or why none is
 */
export async function relateToSeed(
  seedID: number,
  itemIDs: readonly number[],
): Promise<SeedLinkReport> {
  // An item is never its own relation, and Zotero would only log the attempt.
  // Two works can match one item, which is one relation.
  const ids = [...new Set(itemIDs)].filter((id) => id !== seedID);
  if (ids.length === 0) return { linked: 0, error: undefined };
  const seed = await Zotero.Items.getAsync(seedID);
  if (seed === false || seed.deleted) {
    return {
      linked: 0,
      error: new ZoteroApiError("the seed item is no longer in the library", {
        phase: "relate-to-seed",
        items: ids.length,
      }).toSerialized(),
    };
  }
  const items = await Zotero.Items.getAsync(ids);
  // `addRelation` needs the `relations` data type, which an item already in
  // Zotero's object cache may have arrived without. Outside the transaction.
  await Zotero.Items.loadDataTypes([seed, ...items]);
  try {
    await Zotero.DB.executeTransaction(async (): Promise<void> => {
      let seedChanged = false;
      for (const item of items) {
        if (seed.addRelatedItem(item)) seedChanged = true;
        if (item.addRelatedItem(seed)) {
          // save(), not saveTx(): `docs/01` §5.8 / §12 gotcha 12.
          await item.save({ skipDateModifiedUpdate: true });
        }
      }
      if (seedChanged) await seed.save({ skipDateModifiedUpdate: true });
    });
  } catch (error) {
    // The transaction rolled back, and the objects in Zotero's cache still hold
    // the relations. A later save of either would write what this says failed.
    for (const item of [seed, ...items]) {
      try {
        await item.reload(["relations"], true);
      } catch {
        // The failure below is already what gets reported.
      }
    }
    return { linked: 0, error: seedLinkError(error, items.length) };
  }
  return { linked: items.length, error: undefined };
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

/**
 * For each work to create, the {@link WorkType}s of the **other** works to
 * create that are its preprint or published version ({@link areOtherVersions},
 * `docs/02` §11.4). A work with none is absent. `toZoteroMapping` reads it as
 * `importedVersionTypes` (`docs/07` §6.2, `P2-T11`).
 */
function importedVersionTypes(
  works: readonly CanonicalWork[],
): Map<CanonicalWork, WorkType[]> {
  const out = new Map<CanonicalWork, WorkType[]>();
  for (const [i, a] of works.entries()) {
    for (const b of works.slice(i + 1)) {
      if (!areOtherVersions(a, b)) continue;
      out.set(a, [...(out.get(a) ?? []), b.type]);
      out.set(b, [...(out.get(b) ?? []), a.type]);
    }
  }
  return out;
}

/** Every pair of created items whose works are versions of each other, once each, in input order. */
function versionPairs(
  entries: readonly BuiltItem[],
): (readonly [BuiltItem, BuiltItem])[] {
  const out: (readonly [BuiltItem, BuiltItem])[] = [];
  for (const [i, a] of entries.entries()) {
    for (const b of entries.slice(i + 1)) {
      if (areOtherVersions(a.work, b.work)) out.push([a, b]);
    }
  }
  return out;
}

/** Every {@link TranslatorFallbackReason} at 0. */
function emptyFallbackCounts(): Record<TranslatorFallbackReason, number> {
  const out = {} as Record<TranslatorFallbackReason, number>;
  for (const reason of TRANSLATOR_FALLBACK_REASONS) out[reason] = 0;
  return out;
}

/** `work.abstract`, when non-empty — the abstract repair's source. */
function nonEmptyAbstract(work: CanonicalWork): string | undefined {
  return work.abstract !== undefined && work.abstract !== ""
    ? work.abstract
    : undefined;
}

/**
 * `P2-T08`'s preprint-server attribution for an item a translator saved, or
 * `undefined` when there is nothing to write (`P2-T18` step 9).
 *
 * The value is the hand-mapped path's own `repository`, taken from
 * {@link toZoteroMapping} so there is one attribution rule, not two. It is
 * written only when the work is a preprint, the item's type — whatever the
 * translator chose, never re-mapped — has a `repository` field, and that field
 * is empty: a user who turned translators on chose Zotero-canonical metadata,
 * so a server the translator already named is kept. A work the mapper rejects
 * gets no attribution rather than a failed import: the item already exists.
 */
function preprintRepository(
  entry: TranslatedWork,
  mapping: ZoteroMappingOptions,
): string | undefined {
  if (entry.work.type !== "preprint") return undefined;
  let fieldID: unknown;
  try {
    fieldID = Zotero.ItemFields.getID("repository");
  } catch {
    return undefined;
  }
  if (typeof fieldID !== "number" || fieldID === 0) return undefined;
  if (
    Zotero.ItemFields.isValidForType(fieldID, entry.item.itemTypeID) !== true
  ) {
    return undefined;
  }
  if (entry.item.getField("repository") !== "") return undefined;
  let repository: unknown;
  try {
    repository = toZoteroMapping(entry.work, mapping).itemJSON["repository"];
  } catch {
    return undefined;
  }
  return typeof repository === "string" && repository !== ""
    ? repository
    : undefined;
}

/**
 * Sort the created entries, their IDs and their paths back into the order
 * of `order` (the run's input), keeping the three arrays aligned.
 */
function restoreInputOrder(
  order: readonly CanonicalWork[],
  entries: BuiltItem[],
  ids: number[],
  via: ImportPath[],
): void {
  const rank = new Map<CanonicalWork, number>();
  order.forEach((work, index) => rank.set(work, index));
  const zipped = entries.map((entry, index) => ({
    entry,
    id: ids[index] ?? entry.item.id,
    via: via[index] ?? "hand-map",
  }));
  zipped.sort(
    (a, b) => (rank.get(a.entry.work) ?? 0) - (rank.get(b.entry.work) ?? 0),
  );
  zipped.forEach((row, index) => {
    entries[index] = row.entry;
    ids[index] = row.id;
    via[index] = row.via;
  });
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

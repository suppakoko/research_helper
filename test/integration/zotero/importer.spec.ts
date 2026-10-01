/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P1-T14`: the batched importer's correctness, against a real Zotero library.
 *
 * **Why every criterion here is an integration criterion.** The card's
 * assertions are about the platform, not about a pure function: that a created
 * item carries an *automatic* `research_helper` tag, that re-importing links
 * instead of duplicating, that a **trashed** duplicate does not block an
 * import, that a collection nests under a chosen parent, that linking an
 * existing item does not bump its `dateModified`, and that the dedup pass costs
 * **one** `Zotero.Search` for the whole run rather than one per candidate. A
 * fake could be made to report any of them, which is exactly what `docs/13`
 * §2.1 means by "a fake that lies is worse than no fake".
 *
 * `test/integration/zotero/import-perf.spec.ts` carries the `NFR-1` / `NFR-3`
 * timings and the chunk-size instrumentation `docs/07` §7.2 asks for. This file
 * carries everything that is not a number.
 *
 * **The search count is measured from the platform side**, by patching
 * `Zotero.Search.prototype.search`, not by trusting
 * `LibraryIndex.stats.searchCount` — the same technique, and the same reason,
 * as `test/integration/zotero/libraryIndex.spec.ts`.
 *
 * **Fixtures are erased in `after()`, not gated behind a pref.** `P1-T13`'s
 * 10,000-item test had to be made opt-in because its fixture outlived it and
 * would silently change what every later spec measured; it could not simply
 * clean up, because 9,685 erases cost more than the measurement they would
 * protect. This file's fixtures are ~30 items, so erasing them is cheap and
 * strictly better than a gate: the fixture does not outlive the spec at all,
 * so nothing downstream can be perturbed whatever order the runner enumerates
 * `test/integration` in. Cleanup never fails the run — a failed erase is
 * reported through `debug()` and swallowed.
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`docs/13` §2.3), so nothing here touches a real library. Items
 * written by earlier spec files in the same run *are* present, which is why
 * every fixture identifier below is namespaced to this card.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console` — `Date.now()` is the clock and `debug()` is the log.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { type Doi, normalizeDoi, normalizePmid } from "../../../src/model/ids";
import { RESEARCH_HELPER_TAG } from "../../../src/zotero/itemMapper";
import {
  type ImportReport,
  type ImportRequest,
  importWorks,
} from "../../../src/zotero/importer";
import { buildLibraryIndex } from "../../../src/zotero/libraryIndex";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isAtMost(value: number, ceiling: number, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T14]";
const TEST_TIMEOUT_MS = 120_000;

/** Namespaced so earlier spec files in the same run cannot collide. */
const DOI_PREFIX = "10.5555/rh-p1t14.";
/** PMIDs are nine digits here, outside any range a real fixture would use. */
const PMID_BASE = 910_000_000;

/** A ~250-word abstract, `docs/10` NFR-4's "typical" length. */
const ABSTRACT = (
  "This synthetic abstract exists so that the importer's R-17 coverage " +
  "measurement has something to count without touching the network. "
)
  .repeat(12)
  .trim();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function doiOrThrow(raw: string): Doi {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
}

function pmidOrThrow(raw: string) {
  const pmid = normalizePmid(raw);
  if (pmid === null) throw new Error(`fixture PMID must normalize: ${raw}`);
  return pmid;
}

interface WorkOptions {
  /** Omit the abstract, so `abstractCoverage` has a denominator worth counting. */
  readonly withoutAbstract?: boolean;
  /** `"preprint"` is the mapping `toZoteroMapping()` throws on (Phase 2 owns it). */
  readonly type?: CanonicalWork["type"];
  /** Identify by PMID instead of DOI, to exercise the index's second arm. */
  readonly byPmid?: boolean;
}

/**
 * One `CanonicalWork`, built by hand.
 *
 * No source adapter is involved: `NFR-1` and this card both start from
 * "already-fetched records", and a fixture that went through a mapper would be
 * measuring the mapper.
 */
function makeWork(slug: string, options: WorkOptions = {}): CanonicalWork {
  const doi = doiOrThrow(`${DOI_PREFIX}${slug}`);
  const pmid = pmidOrThrow(String(PMID_BASE + hash(slug)));
  return {
    workKey: `doi:${doi}`,
    ids: options.byPmid === true ? { pmid } : { doi, pmid },
    type: options.type ?? "journal-article",
    title: `Research Helper importer fixture ${slug} (P1-T14)`,
    ...(options.withoutAbstract === true ? {} : { abstract: ABSTRACT }),
    authors: [{ family: "Hopper", given: "Grace" }],
    containerTitle: "Journal of Synthetic Fixtures",
    volume: "1",
    issue: "1",
    pages: "1-2",
    publishedDate: { year: 2026, month: 1, day: 1, iso: "2026-01-01" },
    provenance: { recordIds: [], fieldOrigin: {}, seenIn: ["pubmed"] },
    normalizedAtEpochMs: Date.now(),
  };
}

/** Stable small integer per slug, so each fixture gets its own PMID. */
function hash(slug: string): number {
  let out = 0;
  for (const char of slug) out = (out * 31 + char.charCodeAt(0)) % 900_000;
  return out;
}

/** A collection name unique to this run, so a re-run cannot reuse one. */
function collectionName(label: string): string {
  return `Research Helper importer (P1-T14) ${label} ${String(Date.now())}`;
}

// ---------------------------------------------------------------------------
// Cleanup bookkeeping — see the file header on why this is cleanup, not a gate
// ---------------------------------------------------------------------------

const writtenItemIDs = new Set<number>();
const writtenCollectionIDs = new Set<number>();

function record(report: ImportReport): ImportReport {
  for (const id of report.createdItemIDs) writtenItemIDs.add(id);
  if (report.collectionCreated) writtenCollectionIDs.add(report.collection.id);
  return report;
}

async function runImport(request: ImportRequest): Promise<ImportReport> {
  return record(await importWorks(request));
}

/**
 * Build the index while counting real `Zotero.Search#search()` calls, and hand
 * the count back.
 *
 * Patches the prototype for the duration of `body`, restoring it in a
 * `finally` so a failing assertion cannot leave the patch installed for the
 * rest of the run. The same shape `libraryIndex.spec.ts` uses.
 */
type SearchRunner = (asTempTable?: boolean) => Promise<number[] | string>;

async function countingSearches<T>(
  body: () => Promise<T>,
): Promise<{ value: T; searches: number }> {
  const proto = Zotero.Search.prototype as unknown as { search: SearchRunner };
  const original: SearchRunner = proto.search;
  let searches = 0;
  proto.search = function (this: Zotero.Search, asTempTable?: boolean) {
    searches += 1;
    return original.call(this, asTempTable);
  };
  try {
    return { value: await body(), searches };
  } finally {
    proto.search = original;
  }
}

/** The item, or a failed assertion — `Zotero.Items.get` returns `false`. */
function itemOrFail(itemID: number): Zotero.Item {
  const item = Zotero.Items.get(itemID);
  if (!item) assert.fail(`item ${String(itemID)} is not loadable`);
  return item;
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

describe("Batched importer (P1-T14, FR-6, FR-7, FR-51)", function () {
  it("creates items in a named collection, tags them automatically, and reports R-17 coverage", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    // Four with an abstract, two without: the hand count criterion 5 asks for.
    const works = [
      makeWork("cov-a"),
      makeWork("cov-b"),
      makeWork("cov-c"),
      makeWork("cov-d"),
      makeWork("cov-e", { withoutAbstract: true }),
      makeWork("cov-f", { withoutAbstract: true }),
    ];
    const name = collectionName("coverage");

    // chunkSize 2 over 6 records: three chunks, so the chunking path is the one
    // under test rather than a single-transaction special case.
    const { value: report, searches } = await countingSearches(async () =>
      runImport({ works, collectionName: name, chunkSize: 2 }),
    );

    debug(
      `${LOG_PREFIX} coverage run: created=${String(report.created)} ` +
        `linked=${String(report.linkedExisting)} skipped=${String(report.skipped)} ` +
        `failed=${String(report.failed.length)}; coverage ` +
        `${String(report.abstractCoverage.withAbstract)}/` +
        `${String(report.abstractCoverage.itemsCreated)} = ` +
        `${String(report.abstractCoverage.percent)}% ` +
        `(backfilled ${String(report.abstractCoverage.backfilled)}); ` +
        `chunks=${String(report.stats.chunks)} ` +
        `transactions=${String(report.stats.transactions)} ` +
        `chunkMs=[${report.stats.chunkMs.join(", ")}] ` +
        `indexMs=${String(report.stats.indexMs)}; ` +
        `observed Zotero.Search calls=${String(searches)}`,
    );

    assert.strictEqual(report.created, 6, "six items created");
    assert.strictEqual(report.linkedExisting, 0, "nothing to link");
    assert.strictEqual(report.skipped, 0, "nothing skipped");
    assert.strictEqual(report.failed.length, 0, "no failures");
    assert.strictEqual(report.collectionCreated, true, "fresh collection");
    assert.strictEqual(
      report.collection.name,
      name,
      "collection name is exact",
    );
    assert.strictEqual(
      report.collection.getChildItems(true).length,
      6,
      "the collection holds six items",
    );
    assert.strictEqual(report.stats.chunks, 3, "6 records at chunkSize 2");
    assert.strictEqual(
      report.stats.transactions,
      3,
      "one transaction per chunk, and no extra one for the collection",
    );

    // Criterion 5: `abstractCoverage` matches the hand count on the fixture set.
    assert.strictEqual(report.abstractCoverage.itemsCreated, 6);
    assert.strictEqual(report.abstractCoverage.withAbstract, 4);
    assert.strictEqual(report.abstractCoverage.percent, 67, "4/6 → 67 %");
    assert.strictEqual(
      report.abstractCoverage.backfilled,
      0,
      "fromJSON() kept every abstract it was given, so no backfill was needed",
    );

    // The dedup pass is one search for the whole run (`docs/02` §11.6).
    assert.strictEqual(
      searches,
      1,
      "one Zotero.Search for the whole import, not one per candidate",
    );
    assert.strictEqual(report.stats.indexSearchCount, 1);
    assert.isFalse(report.stats.indexReused);

    // Criterion 3: every created item carries the automatic tag.
    for (const itemID of report.createdItemIDs) {
      const item = itemOrFail(itemID);
      assert.strictEqual(
        Zotero.ItemTypes.getName(item.itemTypeID),
        "journalArticle",
        `item ${String(itemID)} type (FR-7)`,
      );
      const tag = item
        .getTags()
        .find((candidate) => candidate.tag === RESEARCH_HELPER_TAG);
      if (tag === undefined) {
        assert.fail(`item ${String(itemID)} has no ${RESEARCH_HELPER_TAG} tag`);
      }
      // `type: 1` is automatic (orange). `docs/01` §5.2, `docs/02` §10.3.
      assert.strictEqual(
        tag.type,
        1,
        `item ${String(itemID)} tag is automatic, not manual`,
      );
      // FR-6: bare lowercase DOI, no resolver prefix.
      assert.isTrue(
        item.getField("DOI").startsWith(DOI_PREFIX),
        `item ${String(itemID)} DOI is bare`,
      );
    }
  });

  it("counts a record whose mapping throws in failed[] without aborting the batch or the remaining batches", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    // `toZoteroMapping()` throws on a preprint — `docs/07` §6.2's preprint
    // column is Phase 2's (`P1-T12` refuses to half-map it). That makes it the
    // honest fixture for "a record whose mapping throws": a real, shipped
    // throw from the real mapper, not an injected one.
    const works = [
      makeWork("fail-a"),
      makeWork("fail-b", { type: "preprint" }),
      makeWork("fail-c"),
      makeWork("fail-d"),
    ];
    const name = collectionName("failure");

    // chunkSize 2 puts the throwing record second in the *first* chunk, so the
    // assertion covers both halves of the criterion: the rest of its own chunk,
    // and the chunk after it.
    const report = await runImport({
      works,
      collectionName: name,
      chunkSize: 2,
    });

    debug(
      `${LOG_PREFIX} failure run: created=${String(report.created)} ` +
        `failed=${String(report.failed.length)} ` +
        `[${report.failed
          .map((f) => `${f.phase}:${f.error.code}:${f.workKey}`)
          .join(", ")}]; chunks=${String(report.stats.chunks)}`,
    );

    assert.strictEqual(report.created, 3, "the other three still imported");
    assert.strictEqual(report.failed.length, 1, "one failure");
    const failure = report.failed[0];
    if (failure === undefined) assert.fail("expected one failure");
    assert.strictEqual(failure.phase, "mapping");
    assert.strictEqual(failure.workKey, works[1]?.workKey ?? "");
    assert.strictEqual(
      failure.error.code,
      "ZOTERO_API",
      "a plain Error is wrapped in ZoteroApiError so failed[] has one shape",
    );
    assert.isAbove(
      failure.error.detail.length,
      0,
      "the redacted detail survives",
    );
    assert.strictEqual(
      report.collection.getChildItems(true).length,
      3,
      "the surviving three are in the collection",
    );
    assert.strictEqual(
      report.stats.chunks,
      2,
      "both chunks ran; the throw did not abort the remaining batch",
    );
  });

  it("links an existing item into the collection instead of duplicating it, and does not modify it (FR-51)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const works = [
      makeWork("link-a"),
      makeWork("link-b"),
      makeWork("link-c", { byPmid: true }),
    ];
    const first = await runImport({
      works,
      collectionName: collectionName("link-first"),
    });
    assert.strictEqual(first.created, 3, "first import creates three");

    const modifiedBefore = new Map<number, string>(
      first.createdItemIDs.map((id) => [
        id,
        itemOrFail(id).getField("dateModified"),
      ]),
    );

    const secondName = collectionName("link-second");
    const { value: second, searches } = await countingSearches(async () =>
      runImport({ works, collectionName: secondName }),
    );

    debug(
      `${LOG_PREFIX} re-import: created=${String(second.created)} ` +
        `linked=${String(second.linkedExisting)} ` +
        `matchedOn=[${second.linkedMatches.map((m) => m.matchedOn).join(", ")}]; ` +
        `observed Zotero.Search calls=${String(searches)}; ` +
        `transactions=${String(second.stats.transactions)}`,
    );

    assert.strictEqual(second.created, 0, "no new items (FR-51)");
    assert.strictEqual(second.createdItemIDs.length, 0, "no created IDs");
    assert.strictEqual(second.linkedExisting, 3, "linked existing: 3");
    assert.deepEqual(
      [...second.linkedItemIDs].sort((a, b) => a - b),
      [...first.createdItemIDs].sort((a, b) => a - b),
      "the same three items were linked",
    );
    assert.deepEqual(
      second.linkedMatches.map((match) => match.matchedOn),
      ["doi", "doi", "pmid"],
      "DOI takes precedence; the PMID-only record matched on pmid",
    );
    assert.strictEqual(
      searches,
      1,
      "one search for the whole run, not one per candidate",
    );
    assert.strictEqual(
      second.collection.getChildItems(true).length,
      3,
      "the second collection holds the existing items",
    );

    // `P1-T14`'s **Do NOT**: an existing item is added to a collection, nothing
    // more. `skipDateModifiedUpdate` is what makes that true of the row too.
    for (const [itemID, before] of modifiedBefore) {
      assert.strictEqual(
        itemOrFail(itemID).getField("dateModified"),
        before,
        `linking did not bump dateModified on item ${String(itemID)}`,
      );
    }

    // The original collection still holds them: `addToCollection` adds, where
    // `setCollections` would have replaced.
    assert.strictEqual(
      first.collection.getChildItems(true).length,
      3,
      "the first collection still holds all three",
    );
  });

  it("does not let a trashed duplicate block an import (FR-51)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const work = makeWork("trashed");
    const doi = work.ids.doi ?? "";

    // A trashed library item carrying the same DOI. `docs/02` §11.6's advice to
    // "add it to a persistent dismissed list" is feature-6 advice and must not
    // reach the importer: for FR-51 the trashed item simply must not block.
    const trashed = new Zotero.Item("journalArticle");
    trashed.libraryID = Zotero.Libraries.userLibraryID;
    trashed.setField("title", "Trashed duplicate (P1-T14)");
    trashed.setField("DOI", doi);
    await trashed.saveTx();
    trashed.deleted = true;
    await trashed.saveTx();
    writtenItemIDs.add(trashed.id);

    const report = await runImport({
      works: [work],
      collectionName: collectionName("trashed"),
    });

    debug(
      `${LOG_PREFIX} trashed fixture itemID=${String(trashed.id)} ` +
        `deleted=${String(trashed.deleted)}; created=${String(report.created)} ` +
        `linked=${String(report.linkedExisting)}`,
    );

    assert.strictEqual(report.created, 1, "the import was not blocked");
    assert.strictEqual(report.linkedExisting, 0, "and nothing was linked");
    assert.isTrue(trashed.deleted, "the trashed item is still in the trash");
  });

  it("finds or creates the collection under a chosen parent, and reuses a same-named one", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const libraryID = Zotero.Libraries.userLibraryID;
    const parent = new Zotero.Collection({
      name: `Research Helper parent (P1-T14) ${String(Date.now())}`,
      libraryID,
    });
    await parent.saveTx();
    writtenCollectionIDs.add(parent.id);

    const childName = collectionName("nested");
    const first = await runImport({
      works: [makeWork("nest-a")],
      collectionName: childName,
      parentCollectionID: parent.id,
    });

    assert.strictEqual(first.collectionCreated, true, "created under parent");
    assert.strictEqual(
      first.collection.parentID,
      parent.id,
      "nested under the chosen parent (FR-6, docs/13 §2.3)",
    );
    assert.strictEqual(
      Zotero.Collections.getByLibrary(libraryID).some(
        (collection) => collection.name === childName,
      ),
      false,
      "and not at the top level",
    );

    // Same name, same parent → reuse, not a second collection (`FR-6`:
    // "create (or reuse) a Zotero collection").
    const second = await runImport({
      works: [makeWork("nest-b")],
      collectionName: childName,
      parentCollectionID: parent.id,
    });
    assert.strictEqual(second.collectionCreated, false, "reused");
    assert.strictEqual(second.collection.id, first.collection.id);
    assert.strictEqual(
      Zotero.Collections.getByParent(parent.id).length,
      1,
      "exactly one child collection exists",
    );

    debug(
      `${LOG_PREFIX} nesting: parent=${String(parent.id)} ` +
        `child=${String(first.collection.id)} reusedOnSecondCall=` +
        `${String(!second.collectionCreated)}`,
    );
  });

  it("honours the skip and import-anyway duplicate policies (docs/08 §4.4)", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const work = makeWork("policy");
    const seeded = await runImport({
      works: [work],
      collectionName: collectionName("policy-seed"),
    });
    assert.strictEqual(seeded.created, 1);

    const skipped = await runImport({
      works: [work],
      collectionName: collectionName("policy-skip"),
      duplicatePolicy: "skip",
    });
    assert.strictEqual(skipped.created, 0, "skip writes nothing");
    assert.strictEqual(skipped.linkedExisting, 0, "and links nothing");
    assert.strictEqual(skipped.skipped, 1, "the record is counted as skipped");
    assert.strictEqual(
      skipped.collection.getChildItems(true).length,
      0,
      "the collection exists and is empty (FR-6 post-condition)",
    );

    const { value: anyway, searches } = await countingSearches(async () =>
      runImport({
        works: [work],
        collectionName: collectionName("policy-anyway"),
        duplicatePolicy: "import-anyway",
      }),
    );
    assert.strictEqual(
      anyway.created,
      1,
      "import-anyway creates a second item",
    );
    assert.strictEqual(
      searches,
      0,
      "and consults no index, because nothing would read it",
    );
    assert.strictEqual(anyway.stats.indexSearchCount, 0);

    // A workKey repeated inside one request is skipped: `docs/07` §5.1 makes it
    // the primary key, so two entries carrying one is the same record twice.
    const twice = await runImport({
      works: [makeWork("policy-twice"), makeWork("policy-twice")],
      collectionName: collectionName("policy-twice"),
    });
    assert.strictEqual(twice.created, 1, "one item for one workKey");
    assert.strictEqual(twice.skipped, 1, "the repeat is counted as skipped");

    debug(
      `${LOG_PREFIX} policies: skip -> created=${String(skipped.created)} ` +
        `skipped=${String(skipped.skipped)}; import-anyway -> created=` +
        `${String(anyway.created)} searches=${String(searches)}; ` +
        `repeated workKey -> created=${String(twice.created)} ` +
        `skipped=${String(twice.skipped)}`,
    );
  });

  it("accepts a caller-supplied index and then issues no search of its own", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const index = await buildLibraryIndex(Zotero.Libraries.userLibraryID);
    const { value: report, searches } = await countingSearches(async () =>
      runImport({
        works: [makeWork("reuse-a"), makeWork("reuse-b")],
        collectionName: collectionName("index-reuse"),
        index,
      }),
    );

    assert.strictEqual(searches, 0, "the supplied index is not rebuilt");
    assert.isTrue(report.stats.indexReused);
    assert.strictEqual(report.stats.indexMs, 0);
    assert.strictEqual(report.created, 2);

    // `LibraryIndex` is a snapshot, not a live view (`docs/02` §11.6, "once per
    // run"), so the two items just written are invisible to the index that was
    // handed in. Asserted rather than assumed, because a caller that reuses an
    // index across two imports needs to know it.
    assert.isUndefined(
      index.findExisting(makeWork("reuse-a").ids),
      "the snapshot does not see items written after it was built",
    );

    debug(
      `${LOG_PREFIX} index reuse: searches=${String(searches)} ` +
        `indexMs=${String(report.stats.indexMs)} ` +
        `indexedItems=${String(index.stats.itemsScanned)}`,
    );
  });

  it("leaves the collection behind even when there is nothing to import", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;

    const name = collectionName("empty");
    const report = await runImport({ works: [], collectionName: name });

    assert.strictEqual(report.created, 0);
    assert.strictEqual(report.collectionCreated, true);
    assert.strictEqual(report.collection.name, name);
    assert.strictEqual(report.stats.transactions, 1, "one transaction for it");
    assert.strictEqual(report.stats.chunks, 0, "and no write chunks");
    assert.strictEqual(report.abstractCoverage.fraction, 0, "0, not NaN");
    assert.strictEqual(report.abstractCoverage.percent, 0);
  });
});

// ---------------------------------------------------------------------------
// Cleanup. See the file header: cleanup rather than a pref gate, and a failure
// here is reported, never thrown — it must not turn a passing run red.
// ---------------------------------------------------------------------------

after(async function () {
  const itemIDs = [...writtenItemIDs];
  const collectionIDs = [...writtenCollectionIDs];
  const startedAt = Date.now();
  try {
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
    for (const collectionID of collectionIDs) {
      const collection = Zotero.Collections.get(collectionID);
      if (collection) await collection.eraseTx();
    }
    debug(
      `${LOG_PREFIX} cleanup erased ${String(itemIDs.length)} items and ` +
        `${String(collectionIDs.length)} collections in ` +
        `${String(Date.now() - startedAt)} ms`,
    );
  } catch (error) {
    debug(
      `${LOG_PREFIX} cleanup FAILED after ${String(Date.now() - startedAt)} ms ` +
        `(${error instanceof Error ? error.message : String(error)}); ` +
        `${String(itemIDs.length)} items may remain`,
    );
  }
});

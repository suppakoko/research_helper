/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T17`: a *Related* link to the seed, written by the shipped importer
 * (`importWorks()` in `src/zotero/importer.ts`) into a live Zotero.
 *
 * `plan/08` `P5-T17`'s scenario: import 10 of 20 rows, 2 of them already in the
 * library, one matched by identifier and one by title. So 8 are created and 2
 * linked, and with the box ticked all 10 are related to the seed on both sides,
 * and with it unticked none is. The works here stand for the ticked rows, and the
 * selection of 10 of 20 is the view model's, proved in
 * `test/unit/ui/relatedViewModel.test.ts`.
 *
 * **Why inside Zotero.** Only Zotero can show that `addRelatedItem` plus `save()`
 * leaves each `relatedItems` holding the other's key, that Date Modified stays, and
 * that a failed save leaves nothing behind in the cached objects. The unit suite
 * (`test/unit/zotero/seedLink.test.ts`) proves only the control flow.
 *
 * **Written 2026-11-05 and typechecked. It first runs in the next integration
 * round**, so nothing in this file is yet evidence.
 *
 * The runner gives Zotero a temporary data directory that it empties before every
 * run (`docs/13` §2.3), and this file erases what it wrote in `after()`. Sandbox
 * caveats (`docs/01` §2.3): no `console` — `debug()` is the log.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { normalizeDoi, type Doi } from "../../../src/model/ids";
import { type ImportReport, importWorks } from "../../../src/zotero/importer";
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
  isUndefined(value: unknown, message?: string): void;
  isDefined(value: unknown, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P5-T17]";
const TEST_TIMEOUT_MS = 120_000;
const AT = Date.UTC(2026, 10, 5, 1, 2, 3);
const ABSTRACT = "An abstract the imported item must keep.";

/** Everything written, erased in `after()`. */
const written: Zotero.Item[] = [];
const collections: Zotero.Collection[] = [];

function doiOrThrow(raw: string): Doi {
  const doi = normalizeDoi(raw);
  if (doi === null) throw new Error(`fixture DOI must normalize: ${raw}`);
  return doi;
}

/** A work as a related row carries it. `slug` keeps each test's ids apart. */
function workOf(slug: string, n: number): CanonicalWork {
  const doi = doiOrThrow(`10.5555/rh-p5t17.${slug}.${String(n)}`);
  return {
    workKey: `doi:${doi}`,
    ids: { doi },
    type: "journal-article",
    title: `P5-T17 ${slug} paper ${String(n)}`,
    authors: [{ family: `Author${String(n)}`, given: "A." }],
    publishedDate: { year: 2024, iso: "2024" },
    abstract: ABSTRACT,
    provenance: {
      recordIds: [`crossref:${slug}-${String(n)}`],
      fieldOrigin: {},
      seenIn: ["crossref"],
    },
    retrievedAt: AT,
  } as unknown as CanonicalWork;
}

async function savedArticle(title: string, doi?: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  if (doi !== undefined) item.setField("DOI", doi);
  await item.saveTx();
  written.push(item);
  return item;
}

/** A seed, an identifier match and a title match, as the scenario sets them up. */
async function scenario(slug: string): Promise<{
  readonly seed: Zotero.Item;
  readonly byDoi: Zotero.Item;
  readonly byTitle: Zotero.Item;
  readonly works: readonly CanonicalWork[];
  readonly known: ReadonlyMap<string, number>;
}> {
  const works = Array.from({ length: 10 }, (_, n) => workOf(slug, n));
  const [first, second] = works;
  if (first === undefined || second === undefined) {
    throw new Error("the fixture has ten works");
  }
  const seed = await savedArticle(`P5-T17 ${slug} seed`);
  const byDoi = await savedArticle(first.title, first.ids.doi);
  // No identifier: only the related pipeline's title match can find this one.
  const byTitle = await savedArticle(second.title);
  return {
    seed,
    byDoi,
    byTitle,
    works,
    known: new Map([
      [first.workKey, byDoi.id],
      [second.workKey, byTitle.id],
    ]),
  };
}

async function run(
  slug: string,
  works: readonly CanonicalWork[],
  extra: {
    readonly relateTo?: number;
    readonly existingItemIDs?: ReadonlyMap<string, number>;
  },
): Promise<ImportReport> {
  const libraryID = Zotero.Libraries.userLibraryID;
  const report = await importWorks({
    works,
    collectionName: `P5-T17 ${slug}`,
    libraryID,
    duplicatePolicy: "link-existing",
    index: await buildLibraryIndex(libraryID),
    ...extra,
  });
  const collection = Zotero.Collections.getByLibraryAndKey(
    libraryID,
    report.collection.key,
  );
  if (collection) collections.push(collection);
  for (const item of await Zotero.Items.getAsync([...report.createdItemIDs])) {
    written.push(item);
  }
  debug(
    `${LOG_PREFIX} ${slug}: created=${String(report.created)} ` +
      `linked=${String(report.linkedExisting)} ` +
      `matchedOn=[${report.linkedMatches.map((m) => m.matchedOn).join(", ")}] ` +
      `seedLink=${JSON.stringify(report.seedLink)}`,
  );
  return report;
}

async function itemsOf(ids: readonly number[]): Promise<Zotero.Item[]> {
  return Zotero.Items.getAsync([...ids]);
}

describe("P5-T17: a Related link to the seed, in a live Zotero", () => {
  after(async () => {
    for (const item of written.splice(0)) {
      if (Zotero.Items.exists(item.id)) await item.eraseTx();
    }
    for (const collection of collections.splice(0)) {
      if (Zotero.Collections.exists(collection.id)) await collection.eraseTx();
    }
  });

  it("creates 8, links 2, and relates all 10 to the seed on both sides", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("ticked");
    const report = await run("ticked", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });

    assert.strictEqual(report.created, 8);
    assert.strictEqual(report.linkedExisting, 2);
    assert.deepEqual(
      report.linkedMatches.map((match) => match.matchedOn),
      ["doi", "caller"],
    );
    assert.deepEqual(report.seedLink, { linked: 10, error: undefined });

    const ids = [...report.createdItemIDs, ...report.linkedItemIDs];
    assert.strictEqual(ids.length, 10);
    assert.isTrue(ids.includes(s.byDoi.id));
    assert.isTrue(ids.includes(s.byTitle.id), "no second item for the title");
    for (const item of await itemsOf(ids)) {
      assert.isTrue(item.relatedItems.includes(s.seed.key), "item to seed");
      assert.isTrue(s.seed.relatedItems.includes(item.key), "seed to item");
    }
    assert.strictEqual(s.seed.relatedItems.length, 10);
  });

  it("survives a reload from the database, not only in the cached objects", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("stored");
    const report = await run("stored", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    await s.seed.reload(["relations"], true);
    assert.strictEqual(s.seed.relatedItems.length, 10);
    const [firstID] = report.createdItemIDs;
    if (firstID === undefined) assert.fail("nothing was created");
    const first = (await Zotero.Items.getAsync(firstID)) as Zotero.Item;
    await first.reload(["relations"], true);
    assert.isTrue(first.relatedItems.includes(s.seed.key));
  });

  it("relates nothing with the box unticked", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("unticked");
    const report = await run("unticked", s.works, {
      existingItemIDs: s.known,
    });
    assert.strictEqual(report.created, 8);
    assert.strictEqual(report.linkedExisting, 2);
    assert.isUndefined(report.seedLink);
    assert.strictEqual(s.seed.relatedItems.length, 0);
    for (const item of await itemsOf([
      ...report.createdItemIDs,
      ...report.linkedItemIDs,
    ])) {
      assert.strictEqual(item.relatedItems.length, 0);
    }
  });

  it("leaves Date Modified alone on the seed and on an item already owned", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("dates");
    // Zotero stores seconds, so a change made now could read the same.
    await Zotero.Promise.delay(1_100);
    const seedBefore = s.seed.dateModified;
    const ownedBefore = s.byDoi.dateModified;
    await run("dates", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    await s.seed.reload(["primaryData"], true);
    await s.byDoi.reload(["primaryData"], true);
    assert.strictEqual(s.seed.dateModified, seedBefore);
    assert.strictEqual(s.byDoi.dateModified, ownedBefore);
  });

  it("keeps the abstract of every item it creates", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("abstracts");
    const report = await run("abstracts", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    assert.strictEqual(report.abstractCoverage.withAbstract, 8);
    for (const item of await itemsOf(report.createdItemIDs)) {
      assert.strictEqual(item.getField("abstractNote"), ABSTRACT);
    }
  });

  it("adds an owned item to the collection through the title match", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("collection");
    const report = await run("collection", s.works, {
      existingItemIDs: s.known,
    });
    const collection = Zotero.Collections.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      report.collection.key,
    );
    if (!collection) assert.fail("no collection");
    assert.isTrue(collection.hasItem(s.byTitle.id));
    assert.isTrue(collection.hasItem(s.byDoi.id));
  });

  it("creates the row whose matched item has since gone to the trash", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("trashed");
    s.byTitle.deleted = true;
    await s.byTitle.saveTx();
    const report = await run("trashed", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    assert.strictEqual(report.created, 9, "the trashed title match is created");
    assert.strictEqual(report.linkedExisting, 1);
    assert.isFalse(report.linkedItemIDs.includes(s.byTitle.id));
    assert.strictEqual(s.byTitle.relatedItems.length, 0);
  });

  it("creates the row whose matched item has since been erased", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("erased");
    await s.byTitle.eraseTx();
    const report = await run("erased", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    assert.strictEqual(report.created, 9);
    assert.strictEqual(report.linkedExisting, 1);
    assert.deepEqual(report.seedLink, { linked: 10, error: undefined });
  });

  it("relates a second import without saving what is already related", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("twice");
    const first = await run("twice", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    const second = await run("twice", s.works, {
      relateTo: s.seed.id,
      existingItemIDs: s.known,
    });
    assert.strictEqual(first.created, 8);
    assert.strictEqual(second.created, 0, "the first import's items are found");
    assert.strictEqual(second.linkedExisting, 10);
    assert.deepEqual(second.seedLink, { linked: 10, error: undefined });
    assert.strictEqual(s.seed.relatedItems.length, 10);
  });

  it("reports a failed seed save, keeps the items, and leaves no relation behind", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("failed");
    const realSave = s.seed.save.bind(s.seed);
    s.seed.save = (): Promise<never> =>
      Promise.reject(new Error("a seed that cannot be saved"));
    let report: ImportReport;
    try {
      report = await run("failed", s.works, {
        relateTo: s.seed.id,
        existingItemIDs: s.known,
      });
    } finally {
      (s.seed as { save: unknown }).save = realSave;
    }
    assert.strictEqual(report.created, 8, "the items stay");
    assert.strictEqual(report.linkedExisting, 2);
    assert.strictEqual(report.seedLink?.linked, 0);
    assert.isDefined(report.seedLink?.error);
    assert.strictEqual(report.failed.length, 0);

    // The rollback undid the database, and the pass undid the objects in the cache.
    assert.strictEqual(s.seed.relatedItems.length, 0);
    for (const item of await itemsOf([
      ...report.createdItemIDs,
      ...report.linkedItemIDs,
    ])) {
      assert.strictEqual(
        item.relatedItems.length,
        0,
        "a later save would write what the report says failed",
      );
      await item.reload(["relations"], true);
      assert.strictEqual(item.relatedItems.length, 0, "and in the database");
    }
  });

  it("reports a seed erased before the import, and keeps the items", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const s = await scenario("gone");
    const seedID = s.seed.id;
    await s.seed.eraseTx();
    const report = await run("gone", s.works, {
      relateTo: seedID,
      existingItemIDs: s.known,
    });
    assert.strictEqual(report.created, 8);
    assert.strictEqual(report.seedLink?.linked, 0);
    assert.isDefined(report.seedLink?.error);
  });
});

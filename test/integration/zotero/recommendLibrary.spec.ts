/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T18`: the recommend profile's reads, against a real Zotero library.
 *
 * What a fake could not prove, so the library is really written and searched:
 *
 * - `getTags()` really reports a user's tag as manual and a translator's as
 *   automatic, so `topicTagNames` keeps the second and not the first;
 * - `item.dateAdded` and `item.dateModified` have the shape `membershipHash` and
 *   `zoteroDateToEpochMs` expect;
 * - a trashed item, a note and an attachment are left out of both reads;
 * - `readLibraryTermSources` issues one search, not one per item;
 * - saving an item changes `membershipHash`, and reading it again does not.
 *
 * Every fixture carries {@link FIXTURE_TAG} and is tracked by id; `after()` erases
 * them and the collection.
 */

import { createZoteroRecommendLibrary } from "../../../src/bootstrap/registerPipelines";
import {
  membershipHash,
  zoteroDateToEpochMs,
} from "../../../src/pipeline/recommend/profile";

interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function after(body: (this: MochaContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P5-T18]";
const FIXTURE_TAG = "rh-test-recommendLibrary-spec";
const TEST_TIMEOUT_MS = 60_000;
const MANUAL = 0;
const AUTOMATIC = 1;

const TAGGED_TITLE = "P5-T18 tagged article for the recommend profile";
const TRASHED_TITLE = "P5-T18 trashed article for the recommend profile";
const USER_TAG = "rh-p5t18 to read on the train";
const TRANSLATOR_TAG = "rh-p5t18 translator keyword";

type SearchRunner = (asTempTable?: boolean) => Promise<number[] | string>;

describe("recommend profile reads (P5-T18)", () => {
  const itemIDs: number[] = [];
  let collection: Zotero.Collection | undefined;
  let taggedItem: Zotero.Item | undefined;

  async function makeArticle(
    title: string,
    tags: readonly (readonly [string, number])[],
    collectionID: number,
  ): Promise<Zotero.Item> {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", title);
    item.addTag(FIXTURE_TAG, AUTOMATIC);
    for (const [tag, type] of tags) item.addTag(tag, type);
    item.addToCollection(collectionID);
    await item.saveTx();
    itemIDs.push(item.id);
    return item;
  }

  async function fixtureCollection(): Promise<Zotero.Collection> {
    if (collection !== undefined) return collection;
    await Zotero.Schema.schemaUpdatePromise;
    const made = new Zotero.Collection({
      name: `Research Helper profile (P5-T18) ${String(Date.now())}`,
      libraryID: Zotero.Libraries.userLibraryID,
    });
    await made.saveTx();
    collection = made;

    taggedItem = await makeArticle(
      TAGGED_TITLE,
      [
        [USER_TAG, MANUAL],
        [TRANSLATOR_TAG, AUTOMATIC],
        ["MeSH*: Gene Editing", MANUAL],
        ["arXiv: cs.LG", AUTOMATIC],
      ],
      made.id,
    );

    const trashed = await makeArticle(TRASHED_TITLE, [], made.id);
    trashed.deleted = true;
    await trashed.saveTx();

    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote("P5-T18 note in the collection");
    note.addTag(FIXTURE_TAG, AUTOMATIC);
    note.addToCollection(made.id);
    await note.saveTx();
    itemIDs.push(note.id);

    return made;
  }

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
    if (collection !== undefined) await collection.eraseTx();
    debug(`${LOG_PREFIX} erased ${String(itemIDs.length)} items`);
  });

  it("a collection read keeps regular items, a translator's tag and a subject tag, and not a user's tag", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const read = await createZoteroRecommendLibrary().readCollection(
      made.libraryID,
      made.key,
    );

    assert.strictEqual(read.name, made.name);
    assert.deepEqual(
      read.items.map(({ work }) => work.title),
      [TAGGED_TITLE],
      "the trashed article and the note are left out",
    );
    const [only] = read.items;
    if (only === undefined) throw new Error("no item read");
    assert.isTrue(
      (only.work.keywords ?? []).includes(TRANSLATOR_TAG),
      "an automatic tag is a keyword",
    );
    assert.isFalse(
      (only.work.keywords ?? []).includes(USER_TAG),
      "a tag the user typed is not",
    );
    assert.deepEqual(
      // In term order: `getTags()` gives its own (measured, sorted by name).
      (only.work.subjects ?? [])
        .map(({ term, scheme, isMajor }) => [term, scheme, isMajor])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        ["cs.LG", "arxiv-category", undefined],
        ["Gene Editing", "mesh", true],
      ],
      "a manual tag spelled as a subject still counts",
    );
    debug(
      `${LOG_PREFIX} keywords ${JSON.stringify(only.work.keywords)} subjects ${JSON.stringify(only.work.subjects)}`,
    );
  });

  it("the dates of a saved item have the shape the profile reads", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const read = await createZoteroRecommendLibrary().readCollection(
      made.libraryID,
      made.key,
    );
    const [only] = read.items;
    if (only === undefined) throw new Error("no item read");
    debug(
      `${LOG_PREFIX} dateAdded ${String(only.dateAdded)} dateModified ${only.dateModified}`,
    );

    const addedAt = zoteroDateToEpochMs(only.dateAdded ?? "");
    assert.isTrue(addedAt !== undefined, "dateAdded parses");
    assert.isTrue(
      Math.abs((addedAt ?? 0) - Date.now()) < 3_600_000,
      "dateAdded is this run, read as UTC",
    );
    assert.strictEqual(
      "dateAdded" in only.work,
      false,
      "dateAdded stays off the work",
    );
  });

  it("the hash is stable across reads and changes when an item is saved with a change", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const library = createZoteroRecommendLibrary();
    const first = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    const again = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.strictEqual(first, again, "reading changes nothing");

    // `dateModified` has one-second resolution, so the change needs a later second.
    await Zotero.Promise.delay(1_100);
    if (taggedItem === undefined) throw new Error("no fixture item");
    taggedItem.setField("abstractNote", "P5-T18 modified");
    await taggedItem.saveTx();
    const modified = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.notStrictEqual(first, modified, "a saved change moves the hash");

    const added = await makeArticle("P5-T18 added article", [], made.id);
    const withAdded = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.notStrictEqual(modified, withAdded, "an added item moves the hash");
    added.removeFromCollection(made.id);
    await added.saveTx();
    const withoutAdded = membershipHash(
      (await library.readCollection(made.libraryID, made.key)).items,
    );
    assert.strictEqual(modified, withoutAdded, "removing it moves it back");
  });

  it("the library read is one search and leaves out the trash, notes and typed tags", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const made = await fixtureCollection();
    const proto = Zotero.Search.prototype as unknown as {
      search: SearchRunner;
    };
    const original: SearchRunner = proto.search;
    let searches = 0;
    proto.search = function (this: unknown, asTempTable?: boolean) {
      searches += 1;
      return original.call(this, asTempTable);
    } as SearchRunner;
    let sources;
    const started = Date.now();
    try {
      sources = await createZoteroRecommendLibrary().libraryTermSources(
        made.libraryID,
      );
    } finally {
      proto.search = original;
    }
    debug(
      `${LOG_PREFIX} library read: ${String(sources.length)} rows, ${String(searches)} search, ${String(Date.now() - started)} ms`,
    );
    assert.strictEqual(searches, 1, "one search");

    const titles = sources.map(({ title }) => title);
    assert.isTrue(titles.includes(TAGGED_TITLE), "the regular item is there");
    assert.isFalse(titles.includes(TRASHED_TITLE), "the trashed one is not");
    assert.isFalse(titles.includes(""), "a note has no row");
    const tagged = sources.find(({ title }) => title === TAGGED_TITLE);
    assert.isFalse(
      (tagged?.keywords ?? []).includes(USER_TAG),
      "a tag the user typed is not counted",
    );
  });

  it("a key that names no collection is refused", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await Zotero.Schema.schemaUpdatePromise;
    let refused = false;
    try {
      await createZoteroRecommendLibrary().readCollection(
        Zotero.Libraries.userLibraryID,
        "ZZZZZZZZ",
      );
    } catch {
      refused = true;
    }
    assert.isTrue(refused, "readCollectionWorks throws");
  });
});

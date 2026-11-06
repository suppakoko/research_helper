/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P5-T14`: the related pipeline's Zotero reads, against a real Zotero library.
 *
 * What a fake could not prove:
 *
 * - `relatedSeedOfItemID` gives the work and the library the item is really in, a group
 *   library's as well as the user's, and `undefined` for a trashed item, a note, an
 *   attachment and an id nothing holds;
 * - `readLibraryWorks` leaves out the trash, notes and attachments, reads **every** item
 *   type the running Zotero declares without throwing on a field the type lacks, reads
 *   one library only, and issues one search;
 * - `createZoteroRelatedLibrary`'s two indexes mark one item by identifier and one with
 *   no identifier by title, and its read time on this library is logged;
 * - reading through the port writes nothing. `item.version` alone cannot say so, because
 *   it moves only on a sync, so the row's `clientDateModified` and `synced` and the
 *   notifier are checked too, each with a real save as its control;
 * - a real start's `graph.pipelines` holds `related`, and that pipeline reads this
 *   Zotero: an id nothing holds ends the run on `rh-error-seed-gone`, with no request.
 *
 * Every fixture carries {@link FIXTURE_TAG} and is tracked by id; `after()` erases them
 * and the group library.
 */

import { config } from "../../../package.json";
import type Addon from "../../../src/addon";
import { createScope } from "../../../src/bootstrap/container";
import {
  createZoteroRecommendLibrary,
  createZoteroRelatedLibrary,
  createZoteroSummarizeLibrary,
  libraryItemFieldsOf,
} from "../../../src/bootstrap/registerPipelines";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { ExternalIds } from "../../../src/model/ids";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import type { RelatedFailed } from "../../../src/pipeline/related/types";
import { metadataVariables } from "../../../src/pipeline/summarize/summarizeItem";
import {
  buildLibraryIndex,
  matchAgainstLibrary,
} from "../../../src/sources/shared/dedupe";
import {
  readLibraryWorks,
  relatedSeedOfItemID,
} from "../../../src/zotero/itemMapper";
import { readItemsForSummary } from "../../../src/zotero/notes";
import { notifierRegistration } from "../../../src/zotero/registrations";

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
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

/** What this file reads of Zotero's group class, which `zotero-types` leaves loose. */
interface FixtureGroup {
  id: number;
  name: string;
  description: string;
  editable: boolean;
  filesEditable: boolean;
  version: number;
  readonly libraryID: number;
  saveTx(): Promise<unknown>;
  eraseTx(): Promise<unknown>;
}

type SearchRunner = (asTempTable?: boolean) => Promise<number[] | string>;

const LOG_PREFIX = "[P5-T14]";
const FIXTURE_TAG = "rh-test-relatedLibrary-spec";
const AUTOMATIC = 1;
const TEST_TIMEOUT_MS = 120_000;
const NO_SUCH_ITEM = 2_147_000_000;
const TITLE_ONLY =
  "P5-T14 ionizable lipid nanoparticles for hepatocyte gene editing in vivo";
const ID_ONLY_DOI = "10.5555/p5t14.identified";
/** Item types that are not regular items, so neither read may hold them. */
const NOT_REGULAR = new Set(["note", "attachment", "annotation"]);

function logged(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

function idsOf(doi: string): ExternalIds {
  return { doi } as unknown as ExternalIds;
}

function recordOf(doi: string, title: string): SourceRecord {
  return {
    id: "crossref:p5t14",
    sourceId: "crossref",
    nativeId: "p5t14",
    retrievedAtEpochMs: Date.now(),
    missingFields: [],
    work: {
      ids: idsOf(doi),
      type: "journal-article",
      title,
      authors: [{ family: "Fixture" }],
      publishedDate: { year: 2021, iso: "2021" },
      containerTitle: "Journal of P5-T14",
    },
  } as unknown as SourceRecord;
}

describe("related pipeline reads (P5-T14)", () => {
  const itemIDs: number[] = [];
  let group: FixtureGroup | undefined;

  async function saved(
    type: string,
    fields: Readonly<Record<string, string>> = {},
    libraryID: number = Zotero.Libraries.userLibraryID,
  ): Promise<Zotero.Item> {
    const item = new Zotero.Item(type as never);
    item.libraryID = libraryID;
    for (const [name, value] of Object.entries(fields)) {
      item.setField(name as never, value);
    }
    item.addTag(FIXTURE_TAG, AUTOMATIC);
    await item.saveTx();
    itemIDs.push(item.id);
    return item;
  }

  async function trashed(title: string): Promise<Zotero.Item> {
    const item = await saved("journalArticle", { title });
    item.deleted = true;
    await item.saveTx();
    assert.isTrue(item.deleted, "the fixture really is in the trash");
    return item;
  }

  async function note(text: string, parentID?: number): Promise<Zotero.Item> {
    const item = new Zotero.Item("note");
    item.libraryID = Zotero.Libraries.userLibraryID;
    if (parentID !== undefined) item.parentID = parentID;
    item.setNote(text);
    item.addTag(FIXTURE_TAG, AUTOMATIC);
    await item.saveTx();
    itemIDs.push(item.id);
    return item;
  }

  /** A linked-URL attachment: nothing is fetched, and no file is written. */
  async function attachment(parentID: number): Promise<Zotero.Item> {
    const item = await Zotero.Attachments.linkFromURL({
      url: "https://example.invalid/p5t14",
      parentItemID: parentID,
      contentType: "text/html",
      title: "P5-T14 linked attachment",
    });
    itemIDs.push(item.id);
    return item;
  }

  async function fixtureGroup(): Promise<FixtureGroup> {
    if (group !== undefined) return group;
    const made = new (
      Zotero as unknown as { Group: new () => FixtureGroup }
    ).Group();
    made.id = 90_000_000 + (Date.now() % 1_000_000);
    made.name = `Research Helper related (P5-T14) ${String(Date.now())}`;
    made.description = "";
    made.editable = true;
    made.filesEditable = true;
    made.version = 1;
    await made.saveTx();
    group = made;
    return made;
  }

  after(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
    if (group !== undefined) await group.eraseTx();
    logged(`erased ${String(itemIDs.length)} items and the group library`);
  });

  it("relatedSeedOfItemID gives the work and the library the item is in, and nothing for what is gone", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const userLibrary = Zotero.Libraries.userLibraryID;
    const article = await saved("journalArticle", {
      title: "P5-T14 seed",
      DOI: "10.5555/P5T14.Seed",
    });
    const seed = await relatedSeedOfItemID(article.id);
    assert.strictEqual(seed?.libraryID, userLibrary);
    assert.strictEqual(seed?.work.ids.doi, "10.5555/p5t14.seed");
    assert.strictEqual(seed?.work.title, "P5-T14 seed");

    const inGroup = await fixtureGroup();
    assert.notStrictEqual(inGroup.libraryID, userLibrary);
    const groupArticle = await saved(
      "journalArticle",
      { title: "P5-T14 seed in a group" },
      inGroup.libraryID,
    );
    const groupSeed = await relatedSeedOfItemID(groupArticle.id);
    assert.strictEqual(
      groupSeed?.libraryID,
      inGroup.libraryID,
      "a group item reads its own library, not the user's",
    );
    assert.strictEqual(groupSeed?.work.title, "P5-T14 seed in a group");

    const gone = await trashed("P5-T14 trashed seed");
    assert.strictEqual(await relatedSeedOfItemID(gone.id), undefined);
    assert.strictEqual(await relatedSeedOfItemID(NO_SUCH_ITEM), undefined);
    const standalone = await note("P5-T14 note");
    assert.strictEqual(await relatedSeedOfItemID(standalone.id), undefined);
    const child = await note("P5-T14 child note", article.id);
    assert.strictEqual(await relatedSeedOfItemID(child.id), undefined);
    const linked = await attachment(article.id);
    assert.strictEqual(await relatedSeedOfItemID(linked.id), undefined);

    // The port is the function: the pipeline reads through this.
    const library = createZoteroRelatedLibrary();
    assert.strictEqual(
      (await library.readSeed(groupArticle.id))?.libraryID,
      inGroup.libraryID,
    );
    assert.strictEqual(await library.readSeed(gone.id), undefined);
  });

  it("readLibraryWorks reads every item type, once each, in one search, and leaves out trash, notes and attachments", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const types = (
      Zotero.ItemTypes.getAll() as unknown as readonly {
        readonly name: string;
      }[]
    )
      .map(({ name }) => name)
      .filter((name) => !NOT_REGULAR.has(name));
    assert.isTrue(types.length >= 30, "the running Zotero declares its types");
    const byType = new Map<string, Zotero.Item>();
    for (const type of types) {
      byType.set(type, await saved(type, { title: `P5-T14 type ${type}` }));
    }
    const article = byType.get("journalArticle");
    if (article === undefined) assert.fail("no journalArticle fixture");
    const standalone = await note("P5-T14 standalone note");
    const child = await note("P5-T14 child note", article.id);
    const linked = await attachment(article.id);
    const gone = await trashed("P5-T14 trashed for the read");
    const inGroup = await saved(
      "journalArticle",
      { title: "P5-T14 only in the group" },
      (await fixtureGroup()).libraryID,
    );

    const proto = Zotero.Search.prototype as unknown as {
      search: SearchRunner;
    };
    const original: SearchRunner = proto.search;
    let searches = 0;
    proto.search = function (this: unknown, asTempTable?: boolean) {
      searches += 1;
      return original.call(this, asTempTable);
    } as SearchRunner;
    let works: Awaited<ReturnType<typeof readLibraryWorks>>;
    try {
      works = await readLibraryWorks(Zotero.Libraries.userLibraryID);
    } finally {
      proto.search = original;
    }
    assert.strictEqual(searches, 1, "one search, not one per item");

    const read = new Map(works.map((entry) => [entry.itemID, entry.work]));
    assert.strictEqual(read.size, works.length, "each item once");
    const titleless: string[] = [];
    for (const [type, item] of byType) {
      const work = read.get(item.id);
      assert.notStrictEqual(work, undefined, `${type} is read`);
      if (work?.title !== `P5-T14 type ${type}`) titleless.push(type);
    }
    logged(
      `item types read: ${String(byType.size)} of ${String(types.length)}; ` +
        `no title read from ${JSON.stringify(titleless)}`,
    );
    assert.deepEqual(
      titleless,
      [],
      "every item type's title is read, whatever the type calls the field",
    );
    const terms = await createZoteroRecommendLibrary().libraryTermSources(
      Zotero.Libraries.userLibraryID,
    );
    for (const type of ["case", "email", "statute"]) {
      assert.isTrue(
        terms.some(({ title }) => title === `P5-T14 type ${type}`),
        `the recommend profile's library read has the ${type} title too`,
      );
    }
    for (const [what, item] of [
      ["a trashed item", gone],
      ["a standalone note", standalone],
      ["a child note", child],
      ["an attachment", linked],
      ["another library's item", inGroup],
    ] as const) {
      assert.isFalse(read.has(item.id), `${what} is left out`);
    }
  });

  it("reads a type's own field names as a work's container and date", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // `P5-T32`: `title`, `publicationTitle` and `date` are read base-mapped; every other
    // field by its own name, so a thesis's `university` is still no container.
    // `docs/07` §6.6's notes of 2026-11-05. Written without a Zotero run: the next
    // integration run is the first proof of this block.
    const rows: Record<
      string,
      { container: string | undefined; year: number | undefined }
    > = {};
    for (const [type, fields] of [
      ["conferencePaper", { proceedingsTitle: "P5-T14 proceedings" }],
      ["bookSection", { bookTitle: "P5-T14 book" }],
      ["webpage", { websiteTitle: "P5-T14 site" }],
      ["patent", { issueDate: "2020" }],
      ["case", { dateDecided: "2020" }],
      ["statute", { dateEnacted: "2020" }],
      ["thesis", { university: "P5-T14 university", date: "2020" }],
    ] as const) {
      const item = await saved(type, {
        title: `P5-T14 fields ${type}`,
        ...fields,
      });
      const seed = await relatedSeedOfItemID(item.id);
      rows[type] = {
        container: seed?.work.containerTitle,
        year: seed?.work.publishedDate?.year,
      };
    }
    logged(`base-named reads: ${JSON.stringify(rows)}`);
    assert.deepEqual(rows, {
      conferencePaper: { container: "P5-T14 proceedings", year: undefined },
      bookSection: { container: "P5-T14 book", year: undefined },
      webpage: { container: "P5-T14 site", year: undefined },
      patent: { container: undefined, year: 2020 },
      case: { container: undefined, year: 2020 },
      statute: { container: undefined, year: 2020 },
      thesis: { container: undefined, year: 2020 },
    });
  });

  it("gives the summarize library a type's own container as its venue (item 358(b))", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // `plan/00` §6 items 345(d) and 358(b): the summarize port read
    // `publicationTitle` by its own name, so these three had no venue. The venue
    // reaches no window; what it changes is the `{{VENUE}}` line a summary
    // request carries, so that line is what is asserted, on real items.
    const fixtures = [
      ["conferencePaper", { proceedingsTitle: "P5-T14 summary proceedings" }],
      ["bookSection", { bookTitle: "P5-T14 summary book" }],
      ["webpage", { websiteTitle: "P5-T14 summary site" }],
      ["journalArticle", { publicationTitle: "P5-T14 summary journal" }],
      ["preprint", { repository: "bioRxiv" }],
      ["thesis", { university: "P5-T14 summary university" }],
    ] as const;
    const keys: string[] = [];
    for (const [type, fields] of fixtures) {
      const item = await saved(type, {
        title: `P5-T14 summary venue ${type}`,
        ...fields,
      });
      keys.push(item.key);
    }
    const loaded = await createZoteroSummarizeLibrary().loadItems(
      Zotero.Libraries.userLibraryID,
      keys,
    );
    const rows: Record<string, { venue: string; screened: string }> = {};
    for (const item of loaded.items) {
      rows[item.metadata.itemType ?? ""] = {
        venue: metadataVariables(item.metadata, item.itemKey)["VENUE"] ?? "",
        screened: item.screen.containerTitle ?? "",
      };
    }
    logged(`summary venues: ${JSON.stringify(rows)}`);
    assert.deepEqual(rows, {
      conferencePaper: {
        venue: "P5-T14 summary proceedings",
        screened: "P5-T14 summary proceedings",
      },
      bookSection: {
        venue: "P5-T14 summary book",
        screened: "P5-T14 summary book",
      },
      webpage: {
        venue: "P5-T14 summary site",
        screened: "P5-T14 summary site",
      },
      journalArticle: {
        venue: "P5-T14 summary journal",
        screened: "P5-T14 summary journal",
      },
      // Unchanged: a preprint's `repository` is base-mapped onto `publisher`.
      preprint: { venue: "unknown", screened: "" },
      thesis: { venue: "unknown", screened: "" },
    });
  });

  it("gives the summarize library a type's own title and date (item 358(b))", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // `plan/00` §6 item 358(b), extended by the coordinator on 2026-11-06: the same
    // reader read `title` and `date` by their own names, so a case, an email and a
    // statute had no title, and a patent, a case and a statute no year (`docs/07`
    // §6.6's measurement of 2026-11-05). Both now come from `snapshotZoteroItem`'s
    // base-mapped read. What changes is the `{{TITLE}}` and `{{YEAR}}` a summary
    // request carries and the title and year screening compares, so those are
    // asserted, with the summary's date text against Zotero's own base-mapped read.
    const fixtures = [
      ["case", { dateDecided: "March 3, 2019" }],
      ["email", { date: "2018" }],
      ["statute", { dateEnacted: "2017" }],
      ["patent", { issueDate: "2016-05-04" }],
      ["journalArticle", { date: "Spring 2015" }],
    ] as const;
    const keys: string[] = [];
    const zoteroReads: Record<string, { title: string; date: string }> = {};
    for (const [type, fields] of fixtures) {
      const item = await saved(type, {
        title: `P5-T14 summary title ${type}`,
        ...fields,
      });
      keys.push(item.key);
      zoteroReads[type] = {
        title: item.getField("title", false, true),
        date: item.getField("date", false, true),
      };
    }
    const library = Zotero.Libraries.userLibraryID;
    const snapshots = await readItemsForSummary(library, keys);
    const read: Record<string, { title: string; date: string }> = {};
    for (const item of snapshots.items) {
      read[item.itemType] = { title: item.title, date: item.date };
    }
    logged(
      `summary titles and dates: ${JSON.stringify(read)}; Zotero's own: ${JSON.stringify(zoteroReads)}`,
    );
    assert.deepEqual(read, zoteroReads, "the text Zotero reads base-mapped");
    const loaded = await createZoteroSummarizeLibrary().loadItems(
      library,
      keys,
    );
    const rows: Record<
      string,
      {
        title: string;
        year: string;
        screenedTitle: string;
        screenedYear: number | undefined;
      }
    > = {};
    for (const item of loaded.items) {
      const vars = metadataVariables(item.metadata, item.itemKey);
      rows[item.metadata.itemType ?? ""] = {
        title: vars["TITLE"] ?? "",
        year: vars["YEAR"] ?? "",
        screenedTitle: item.screen.title,
        screenedYear: item.screen.year,
      };
    }
    logged(`summary title and year variables: ${JSON.stringify(rows)}`);
    const row = (type: string, year: number) => ({
      title: `P5-T14 summary title ${type}`,
      year: String(year),
      screenedTitle: `P5-T14 summary title ${type}`,
      screenedYear: year,
    });
    assert.deepEqual(rows, {
      case: row("case", 2019),
      email: row("email", 2018),
      statute: row("statute", 2017),
      patent: row("patent", 2016),
      // Unchanged: a journal article's own fields were always read.
      journalArticle: row("journalArticle", 2015),
    });
  });

  it("the port marks one item by identifier and one with no identifier by title, and logs its read time", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const libraryID = Zotero.Libraries.userLibraryID;
    const byId = await saved("journalArticle", {
      title: "P5-T14 identified",
      DOI: ID_ONLY_DOI,
    });
    const byTitle = await saved("journalArticle", {
      title: TITLE_ONLY,
      date: "2021",
      publicationTitle: "Journal of P5-T14",
    });
    byTitle.setCreators([
      { firstName: "Ada", lastName: "Fixture", creatorType: "author" },
    ]);
    await byTitle.saveTx();
    const gone = await trashed(`${TITLE_ONLY} and in the trash`);
    const library = createZoteroRelatedLibrary();

    const startedIndex = Date.now();
    const existing = await library.libraryIndex(libraryID);
    const indexMs = Date.now() - startedIndex;
    const startedItems = Date.now();
    const items = [...(await library.libraryItems(libraryID))];
    const itemsMs = Date.now() - startedItems;
    logged(
      `read time on ${String(items.length)} items: libraryIndex ${String(indexMs)} ms, ` +
        `libraryItems ${String(itemsMs)} ms`,
    );

    assert.strictEqual(
      existing.findExisting(idsOf(ID_ONLY_DOI.toUpperCase()))?.itemID,
      byId.id,
      "findExisting holds the item by its DOI",
    );
    assert.strictEqual(
      existing.findExisting(idsOf("10.5555/p5t14.nothing")),
      undefined,
    );

    const ids = new Set(items.map(({ itemID }) => itemID));
    assert.isTrue(ids.has(byTitle.id));
    assert.isFalse(
      ids.has(gone.id),
      "the trash is left out of the port's read",
    );
    const index = buildLibraryIndex(items);

    const onDoi = matchAgainstLibrary(
      recordOf(ID_ONLY_DOI, "P5-T14 identified"),
      index,
    );
    assert.strictEqual(onDoi?.itemID, byId.id);
    assert.strictEqual(onDoi?.decision.verdict, "match");

    const onTitle = matchAgainstLibrary(
      recordOf("10.5555/p5t14.other", TITLE_ONLY),
      index,
    );
    assert.strictEqual(onTitle?.itemID, byTitle.id);
    assert.strictEqual(onTitle?.decision.verdict, "match");

    assert.strictEqual(
      matchAgainstLibrary(
        recordOf(
          "10.5555/p5t14.unrelated",
          "An unrelated study of something else entirely in 2021",
        ),
        index,
      ),
      null,
      "a record nothing holds is marked by nothing",
    );

    const fields = libraryItemFieldsOf({
      itemID: byTitle.id,
      work: (await relatedSeedOfItemID(byTitle.id))!.work,
    });
    assert.strictEqual(
      fields.title,
      items.find(({ itemID }) => itemID === byTitle.id)?.title,
    );
    assert.strictEqual(fields.deleted, false);
  });

  it("reading through the port writes nothing: version, row and notifier, each with a real save as its control", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const libraryID = Zotero.Libraries.userLibraryID;
    const owned = await saved("journalArticle", {
      title: "P5-T14 read-only",
      DOI: "10.5555/p5t14.second",
    });
    const row = async (): Promise<string> =>
      String(
        await Zotero.DB.valueQueryAsync(
          "SELECT version || ' ' || synced || ' ' || clientDateModified || ' ' || dateModified FROM items WHERE itemID = ?",
          [owned.id],
        ),
      );
    const events: string[] = [];
    const scope = createScope({
      description: "P5-T14 write spy",
      onError: (messageText) => {
        logged(`write spy teardown: ${messageText}`);
      },
      strict: false,
    });
    try {
      await notifierRegistration("P5-T14 write spy", {
        types: ["item"],
        notify: (event: string, _type: string, ids: readonly unknown[]) => {
          if (ids.includes(owned.id)) events.push(event);
        },
      })(scope);
      // `clientDateModified` has one-second resolution, so a change needs a later second.
      await Zotero.Promise.delay(1_100);
      const versionBefore = owned.version;
      const rowBefore = await row();
      const library = createZoteroRelatedLibrary();
      await library.readSeed(owned.id);
      await library.libraryIndex(libraryID);
      await library.libraryItems(libraryID);
      await Zotero.Promise.delay(100);
      const again = (await Zotero.Items.getAsync(owned.id)) as Zotero.Item;
      assert.strictEqual(again.version, versionBefore, "the version");
      assert.strictEqual(await row(), rowBefore, "the row");
      assert.deepEqual(events, [], "no item event during the reads");
      logged(`the row before and after the reads: ${rowBefore}`);

      // The control: a real save moves what the assertions above read.
      owned.setField("abstractNote", "P5-T14 written");
      await owned.saveTx();
      await Zotero.Promise.delay(100);
      assert.notStrictEqual(await row(), rowBefore, "a save moves the row");
      assert.isTrue(events.length > 0, "the notifier sees a save");
      logged(
        `after a real save: version ${String(owned.version)} (was ${String(versionBefore)}), ` +
          `events ${JSON.stringify(events)}`,
      );
    } finally {
      await scope.unregisterAll();
    }
  });

  it("a real start's graph holds the related pipeline, and it reads this Zotero", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const instance = (Zotero as unknown as Record<string, Addon | undefined>)[
      config.addonInstance
    ];
    const graph = instance?.api.services;
    if (!graph) assert.fail("no ServiceGraph is published at api.services");
    logged(
      `pipelines on a real start: ${JSON.stringify(graph.pipelines.list().map(({ id }) => id))}`,
    );
    const pipeline = graph.pipelines.get("related");
    if (!pipeline) assert.fail("graph.pipelines holds no related pipeline");
    assert.strictEqual(pipeline.id, "related");

    // An id nothing holds stops at the first read, before any request can go out.
    const source = createCancellationTokenSource();
    const job = await graph.pipelineContext.openJob({
      pipelineId: "related",
      token: source.token,
    });
    try {
      const output = (await pipeline.run(
        { seedItemID: NO_SUCH_ITEM } as never,
        job.context,
      )) as RelatedFailed;
      assert.strictEqual(output.outcome, "failed");
      assert.strictEqual(output.error.code, "SEED_UNRESOLVED");
      assert.strictEqual(output.error.messageKey, "rh-error-seed-gone");
      assert.deepEqual([...output.statuses], [], "no generator ran");
    } finally {
      job.dispose();
      source.dispose();
    }
  });
});

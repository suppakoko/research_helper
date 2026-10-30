/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it builds its own collection and notes and reads them back, which no src/zotero/ facade exposes. */
/**
 * `P4-T14` inside Zotero 10: FR-25's report note as `writeReportNote`
 * (`src/zotero/notes.ts`) saves it, in a **personal library only** — no test
 * writes into a group library (the card's **Do NOT**; the group and read-only
 * checks are unit-tested on the argument check in
 * `test/unit/zotero/reportNote.test.ts`).
 *
 * - **Two runs, two notes**: two calls on one collection leave two standalone
 *   notes in it, each with its own dated title as Zotero derives it from the
 *   first line, the tag `research_helper/trend-report` and the marker comment
 *   (information only, `plan/00` §6 item 296(b)).
 * - **Found by key and tag**: `findReportNote` returns a stored key while the
 *   note keeps the tag and is out of the trash, and nothing for a note
 *   without the tag.
 * - **Step 5**: FR-20's "Remove Generated Notes from Collection…"
 *   (`findGeneratedNotes`, `removeGeneratedNotes`) counts and moves the
 *   report notes, and leaves the user's own note.
 *
 * No network and no LLM: the HTML is a literal in `renderReportNote`'s shape.
 * The note text is the report's, not a UI string, so no UI locale is pinned.
 * Every fixture is erased in `after()`.
 */

import {
  datedReportTitle,
  findGeneratedNotes,
  findReportNote,
  isLibraryEditable,
  removeGeneratedNotes,
  reportLibrary,
  TREND_REPORT_TAG,
  writeReportNote,
  type ReportNoteSubject,
} from "../../../src/zotero/notes";

declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void> | void): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
declare function debug(line: string): void;

const LOG_PREFIX = "[P4-T14]";
const HEADING = "Research Trends: P4-T14 fixture";
const FIRST_AT = Date.UTC(2026, 9, 30, 5, 6, 7);
const SECOND_AT = FIRST_AT + 1000;

const createdItemIDs: number[] = [];
const reportNoteKeys: string[] = [];
let collection: Zotero.Collection | undefined;
const libraryID = (): number => Zotero.Libraries.userLibraryID;

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

function subject(id: string, at: number): ReportNoteSubject {
  if (collection === undefined) assert.fail("no collection");
  return {
    id,
    libraryID: libraryID(),
    collectionKey: collection.key,
    title: datedReportTitle(HEADING, at),
    language: "en",
    generatedAtEpochMs: at,
  };
}

/** `renderReportNote`'s shape: the wrapper, the title block's `h1`, a body. */
const HTML =
  '<div data-citation-items="%5B%5D" data-schema-version="9">' +
  `<h1>${HEADING}</h1><h2>Executive Summary</h2><p>A finding.</p></div>`;

function noteOf(key: string): Zotero.Item {
  const note = Zotero.Items.getByLibraryAndKey(libraryID(), key);
  if (note === false) assert.fail(`no note ${key}`);
  return note;
}

describe("P4-T14 — the report note: a new note per run, found by key and tag", function () {
  before(async function () {
    collection = new Zotero.Collection({
      libraryID: libraryID(),
      name: `P4-T14 fixture collection ${String(Date.now())}`,
    });
    await collection.saveTx();
  });

  after(async function () {
    try {
      for (const key of reportNoteKeys) {
        const note = Zotero.Items.getByLibraryAndKey(libraryID(), key);
        if (note !== false) createdItemIDs.push(note.id);
      }
      if (createdItemIDs.length > 0) {
        await Zotero.Items.erase([...new Set(createdItemIDs)]);
      }
      if (collection !== undefined) await collection.eraseTx();
      log(`erased ${String(new Set(createdItemIDs).size)} fixture notes`);
    } catch (error) {
      log(`cleanup failed: ${String(error)}`);
    }
  });

  it("reads My Library as an editable user library", function () {
    assert.isTrue(isLibraryEditable(libraryID()));
    assert.strictEqual(reportLibrary(libraryID())?.kind, "user");
    assert.strictEqual(reportLibrary(libraryID())?.editable, true);
  });

  it("leaves two standalone notes with distinct dated titles, the tag and the marker after two runs", async function () {
    const first = await writeReportNote({
      report: subject("rpt-p4t14-first", FIRST_AT),
      html: HTML,
    });
    const second = await writeReportNote({
      report: subject("rpt-p4t14-second", SECOND_AT),
      html: HTML,
    });
    if (first.kind !== "written" || second.kind !== "written") {
      assert.fail(`not written: ${first.kind}, ${second.kind}`);
    }
    reportNoteKeys.push(first.noteKey, second.noteKey);
    assert.notStrictEqual(first.noteKey, second.noteKey, "two notes");

    const titles: string[] = [];
    for (const [key, id, at] of [
      [first.noteKey, "rpt-p4t14-first", FIRST_AT],
      [second.noteKey, "rpt-p4t14-second", SECOND_AT],
    ] as const) {
      const note = noteOf(key);
      assert.isTrue(note.isNote(), "a note");
      assert.strictEqual(note.parentKey, false, "standalone, no parent");
      assert.isTrue(
        note.getCollections().includes(collection?.id ?? -1),
        "in the reported collection",
      );
      assert.isTrue(
        note.getTags().some((t) => t.tag === TREND_REPORT_TAG),
        "tagged research_helper/trend-report",
      );
      assert.strictEqual(
        note.getNoteTitle(),
        datedReportTitle(HEADING, at),
        "the dated title is the note's title",
      );
      titles.push(note.getNoteTitle());
      const html = note.getNote();
      assert.include(
        html,
        `<!-- rh:report v=1 id=${id} lang=en generatedAt=${new Date(at).toISOString()} -->`,
        "the marker comment, as information only",
      );
      assert.strictEqual(
        (html.match(/<h1>/gu) ?? []).length,
        1,
        "one title heading: the title block's h1 was replaced",
      );
    }
    assert.notStrictEqual(titles[0], titles[1], "distinct dated titles");
    log(`titles ${JSON.stringify(titles)}`);
  });

  it("finds a report note by its stored key while it keeps the tag, never another note", async function () {
    const key = reportNoteKeys[0];
    if (key === undefined) assert.fail("the previous test wrote no note");
    assert.strictEqual(findReportNote(libraryID(), key), key, "by key");
    assert.strictEqual(findReportNote(libraryID(), undefined), undefined);
    assert.strictEqual(findReportNote(libraryID(), "ZZZZZZZZ"), undefined);

    const own = new Zotero.Item("note");
    own.libraryID = libraryID();
    own.setNote(`<h1>${HEADING}</h1><p>My own copy.</p>`);
    own.setCollections([collection?.key ?? ""]);
    own.addTag("my-tag", 0);
    await own.saveTx();
    createdItemIDs.push(own.id);
    assert.strictEqual(
      findReportNote(libraryID(), own.key),
      undefined,
      "a note without the tag is not a report note",
    );
  });

  it("is counted and moved by Remove Generated Notes from Collection…, which leaves the user's note (step 5)", async function () {
    if (collection === undefined) assert.fail("no collection");
    const reportIDs = reportNoteKeys.map((key) => noteOf(key).id);
    const found = findGeneratedNotes(collection.id);
    assert.deepEqual(
      [...found.noteIDs].sort((a, b) => a - b),
      [...reportIDs].sort((a, b) => a - b),
      "exactly the two report notes",
    );
    let asked: number | undefined;
    const result = await removeGeneratedNotes(collection.id, (count) => {
      asked = count;
      return true;
    });
    assert.strictEqual(asked, 2);
    assert.strictEqual(result.moved, 2);
    for (const key of reportNoteKeys) {
      assert.isTrue(noteOf(key).deleted, "in the trash, restorable");
      assert.strictEqual(
        findReportNote(libraryID(), key),
        undefined,
        "a trashed note is not found",
      );
    }
    log(`asked ${String(asked)}, moved ${String(result.moved)}`);
  });
});

/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it builds its own collection, items and notes and reads them back, which no src/zotero/ facade exposes. */
/**
 * `P3-T29` inside Zotero 10: FR-19–FR-21's summary note as
 * `src/zotero/notes.ts` writes it, and FR-20's "Remove Generated Notes from
 * Collection…" (`docs/07` §6.4's note of 2026-10-29).
 *
 * - **The note**: a child note whose first line (its title) is FR-20's
 *   disclaimer with provider, model ID and an ISO UTC timestamp, carrying
 *   `research_helper/ai-summary` and the provider/model tag, with FR-21's
 *   `Source: …` line; found again by its stored key and by its tag, never by
 *   the marker comment (`plan/00` §6 item 296(b)).
 * - **The removal**: over one user note, one note carrying only the bare
 *   `research_helper` tag (FR-8's provenance tag, outside the namespace) and
 *   40 generated notes, the confirmation is asked with exactly 40 and exactly
 *   those 40 go to the trash; a "no" moves nothing.
 * - **The collection read**: regular items only, the library editable.
 *
 * No network and no LLM (`docs/13` §2.3): the stored summary is a literal.
 * Every fixture carries {@link FIXTURE_TAG} and is erased in `after()`. The
 * assertions are on note text the plugin writes in English whatever the UI
 * language (FR-20 and FR-21 fix it), so no UI locale is pinned.
 */

import type { StoredSummary } from "../../../src/model/summary";
import {
  AI_SUMMARY_TAG,
  describeCollectionForSummary,
  findGeneratedNotes,
  findSummaryNote,
  modelTag,
  readCollectionForSummary,
  removeGeneratedNotes,
  writeSummaryNote,
} from "../../../src/zotero/notes";

declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void> | void): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  match(value: string, pattern: RegExp, message?: string): void;
  fail(message: string): never;
};
declare function debug(line: string): void;

const LOG_PREFIX = "[P3-T29]";
const FIXTURE_TAG = "rh-p3t29-fixture";
const GENERATED = 40;
const MODEL = "mock-small-2026-01-01";

const createdItemIDs: number[] = [];
let collection: Zotero.Collection | undefined;
const libraryID = (): number => Zotero.Libraries.userLibraryID;

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

function stored(itemKey: string, workKey: string): StoredSummary {
  return {
    id: `${workKey}:1.0.0:${MODEL}`,
    workKey,
    zoteroItemKey: itemKey,
    content: {
      schemaVersion: "paper-summary-v1",
      itemKey,
      sourceTier: "abstract",
      confidence: "high",
      researchQuestion: "Does the synthetic intervention work?",
      studyDesign: { label: "randomized_controlled_trial", detail: null },
      population: { kind: "human", description: "Synthetic", size: "12" },
      methods: ["randomization"],
      keyFindings: [
        {
          statement: "It <worked> & held.",
          direction: "positive",
          evidenceStrength: "moderate",
          verbatimSupport: "It worked.",
        },
      ],
      effectSizes: [],
      limitations: [],
      novelty: null,
      keywords: ["synthetic"],
      researchTheme: "Synthetic",
      citationWorthiness: { score: 10, reason: "Synthetic." },
    },
    inputScope: { kind: "abstract" },
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptVersion: "1.0.0",
    providerId: "openrouter",
    modelId: MODEL,
    temperature: 0,
    usage: undefined,
    generatedAtEpochMs: Date.UTC(2026, 9, 29, 1, 2, 3),
    sourceItemVersion: undefined,
    contentHash: "0".repeat(64),
    truncated: false,
    groundingScore: 1,
    warnings: [],
    redaction: { partlyRedacted: false, redactedStrings: 0, droppedFields: 0 },
  };
}

async function regularItem(i: number): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = libraryID();
  item.setField("title", `P3-T29 fixture paper ${String(i)}`);
  item.addTag(FIXTURE_TAG, 1);
  if (collection !== undefined) item.setCollections([collection.key]);
  await item.saveTx();
  createdItemIDs.push(item.id);
  return item;
}

async function childNote(
  parent: Zotero.Item,
  html: string,
  tags: readonly string[],
): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = libraryID();
  note.parentKey = parent.key;
  note.setNote(html);
  for (const tag of tags) note.addTag(tag, 0);
  await note.saveTx();
  createdItemIDs.push(note.id);
  return note;
}

describe("P3-T29 — the summary note and FR-20's removal command", function () {
  before(async function () {
    collection = new Zotero.Collection({
      libraryID: libraryID(),
      name: `P3-T29 fixture collection ${String(Date.now())}`,
    });
    await collection.saveTx();
  });

  after(async function () {
    try {
      if (createdItemIDs.length > 0) await Zotero.Items.erase(createdItemIDs);
      if (collection !== undefined) await collection.eraseTx();
      log(`erased ${String(createdItemIDs.length)} fixture items and notes`);
    } catch (error) {
      log(`cleanup failed: ${String(error)}`);
    }
  });

  it("writes the child note with the disclaimer first, both tags and FR-21's line, and finds it by key and tag", async function () {
    const item = await regularItem(0);
    const row = stored(item.key, "doi:10.1234/p3t29-0");
    const noteKey = await writeSummaryNote({
      libraryID: libraryID(),
      parentItemKey: item.key,
      stored: row,
    });
    const note = Zotero.Items.getByLibraryAndKey(libraryID(), noteKey);
    if (note === false) assert.fail("the note was not saved");
    createdItemIDs.push(note.id);
    assert.strictEqual(note.parentKey, item.key, "a child of the item");
    const tags = note.getTags().map((t) => t.tag);
    assert.isTrue(tags.includes(AI_SUMMARY_TAG), "the ai-summary tag");
    assert.isTrue(
      tags.includes(modelTag("openrouter", MODEL)),
      "the model tag",
    );
    // The title is the first line, cut by Zotero at `Zotero.Notes.MAX_TITLE_LENGTH`
    // (120, `docs/06` §14.2); the whole line is the first paragraph of the HTML.
    assert.match(
      note.getNoteTitle(),
      /^Machine-generated summary \(Research Helper\)\. Provider: openrouter · Model: mock-small-2026-01-01/u,
      "FR-20's disclaimer is the note's first line",
    );
    const html = note.getNote();
    assert.match(
      html,
      /^(<div[^>]*>)?<p><strong>Machine-generated summary \(Research Helper\)\. Provider: openrouter · Model: mock-small-2026-01-01 · Generated 2026-10-29T01:02:03\.000Z\. Not reviewed by a person; check it against the paper\.<\/strong><\/p>/u,
      "the whole disclaimer, with the UTC timestamp, opens the stored HTML",
    );
    assert.include(html, "<p>Source: abstract only</p>", "FR-21's source line");
    assert.include(
      html,
      "It &lt;worked&gt; &amp; held.",
      "model text is escaped",
    );
    log(`note title "${note.getNoteTitle()}"`);

    assert.strictEqual(
      findSummaryNote(libraryID(), item.key, noteKey),
      noteKey,
      "found by the stored key",
    );
    assert.strictEqual(
      findSummaryNote(libraryID(), item.key, undefined),
      noteKey,
      "found by the tag when no key is stored",
    );
    assert.strictEqual(
      findSummaryNote(libraryID(), item.key, "ZZZZZZZZ"),
      noteKey,
      "a stale stored key falls back to the tag",
    );
  });

  it("reads the collection's regular items only, in an editable library", async function () {
    if (collection === undefined) assert.fail("no collection");
    const read = await readCollectionForSummary(libraryID(), collection.key);
    assert.strictEqual(read.editable, true, "My Library is editable");
    assert.strictEqual(
      read.items.length,
      1,
      "one regular item, its note not counted",
    );
    assert.strictEqual(read.items[0]?.title, "P3-T29 fixture paper 0");
    assert.isFalse(
      (read.items[0]?.tags ?? []).some((t) => t.startsWith("research_helper")),
      "the plugin's own tags are not sent as metadata",
    );
    const header = describeCollectionForSummary(collection.id);
    assert.strictEqual(header?.regularItems, 1);
  });

  it("over one user note and 40 generated notes, confirms 40 and moves exactly those", async function () {
    if (collection === undefined) assert.fail("no collection");
    // The first test left one generated note; 39 more, one per new item.
    const started = Date.now();
    const generatedIDs: number[] = [];
    const first = findGeneratedNotes(collection.id).noteIDs;
    generatedIDs.push(...first);
    for (let i = 1; i < GENERATED; i += 1) {
      const item = await regularItem(i);
      const key = await writeSummaryNote({
        libraryID: libraryID(),
        parentItemKey: item.key,
        stored: stored(item.key, `doi:10.1234/p3t29-${String(i)}`),
      });
      const note = Zotero.Items.getByLibraryAndKey(libraryID(), key);
      if (note === false) assert.fail("a generated note was not saved");
      createdItemIDs.push(note.id);
      generatedIDs.push(note.id);
    }
    const parent = await regularItem(GENERATED);
    const userNote = await childNote(parent, "<p>My own note</p>", ["my-tag"]);
    const bareTag = await childNote(parent, "<p>A provenance-like note</p>", [
      "research_helper",
    ]);
    assert.strictEqual(generatedIDs.length, GENERATED);

    // A "no" moves nothing.
    log(`fixtures written in ${String(Date.now() - started)} ms`);
    const declined = await removeGeneratedNotes(collection.id, () => false);
    assert.strictEqual(declined.found, GENERATED);
    assert.strictEqual(declined.moved, 0);

    let asked: number | undefined;
    const result = await removeGeneratedNotes(collection.id, (count) => {
      asked = count;
      return true;
    });
    log(
      `asked ${String(asked)}, moved ${String(result.moved)} at ${String(Date.now() - started)} ms`,
    );
    assert.strictEqual(asked, GENERATED, 'the confirmation names "40"');
    assert.strictEqual(result.moved, GENERATED);
    const isTrashed = (id: number): boolean => {
      const note: unknown = Zotero.Items.get(id);
      return (
        typeof note === "object" &&
        note !== null &&
        (note as Zotero.Item).deleted
      );
    };
    for (const id of generatedIDs) {
      assert.isTrue(
        isTrashed(id),
        `generated note ${String(id)} is in the trash`,
      );
    }
    assert.isFalse(isTrashed(userNote.id), "the user's note stays");
    assert.isFalse(
      isTrashed(bareTag.id),
      "a note tagged only `research_helper` is outside the namespace and stays",
    );

    const again = await removeGeneratedNotes(collection.id, () => {
      assert.fail("nothing is left to ask about");
    });
    assert.strictEqual(again.found, 0);
  });
});

/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it builds its own items, notes, attachment and group library and reads them back, which no src/zotero/ facade exposes. */
/**
 * `P7-T11` inside Zotero 10: "Remove all Research Helper content" (`plan/00`
 * §6 item 380, decision 2; `docs/10` §5 Q14, NFR-20).
 *
 * The library this file builds holds each kind the command moves — (a) a
 * generated note, (b) a search provenance note, (c) a linked audio attachment
 * a stored report names — and each kind it must leave: a user note, a user
 * note whose text mentions `research_helper/` but which carries no such tag,
 * an imported item with the bare `research_helper` tag, and a note with the
 * bare tag whose title is not a provenance title. A group library the user
 * cannot edit holds one more generated note.
 *
 * What is run is the command's own two halves, `findAllPluginContent` and
 * `trashPluginContent` (`src/zotero/notes.ts`), with the audio keys read by
 * `reportAudioKeys` (`src/core/dataReset.ts`) from a synthetic `report` row.
 * The host's last step, `deleteAllPluginData`, is not run here: on the shared
 * test profile it would empty the database every later spec reads, and
 * `test/unit/core/dataReset.test.ts` covers it on a real SQLite. The trash
 * is given only this file's ids, so another spec's leftovers are not moved;
 * the find is still over the whole library.
 *
 * No network, no LLM, no key. Every fixture carries {@link FIXTURE_TAG} or is
 * named with {@link MARK}, and is erased in `after()`, with the group, the
 * report row and the audio file.
 */

import { config } from "../../../package.json";
import type Addon from "../../../src/addon";
import { reportAudioKeys } from "../../../src/core/dataReset";
import {
  PLUGIN_CONTENT_TRASH_BATCH,
  PROVENANCE_NOTE_TITLE_PREFIX,
  findAllPluginContent,
  pluginContentLibraryIDs,
  trashPluginContent,
  type LibraryPluginContent,
  type PluginContent,
} from "../../../src/zotero/notes";

declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: { timeout(ms: number): void }) => Promise<void> | void,
): void;
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

const TEST_TIMEOUT_MS = 120_000;
const MARK = `p7t11-${String(Date.now())}`;
const FIXTURE_TAG = "rh-p7t11-fixture";

function log(line: string): void {
  debug(`[P7-T11] ${line}`);
}

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

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

describe("P7-T11 — remove all Research Helper content", function () {
  const userLibrary = (): number => Zotero.Libraries.userLibraryID;
  const created: number[] = [];
  let group: FixtureGroup | undefined;
  let audioFile: string | undefined;
  let reportRowId: string | undefined;

  const ids = {
    generated: 0,
    generatedStandalone: 0,
    provenance: 0,
    audio: 0,
    userNote: 0,
    mentionNote: 0,
    bareNote: 0,
    imported: 0,
    groupGenerated: 0,
  };

  async function item(
    type: string,
    fields: {
      libraryID?: number;
      parent?: Zotero.Item;
      html?: string;
      title?: string;
      tags?: readonly string[];
    },
  ): Promise<Zotero.Item> {
    const made = new Zotero.Item(type as never);
    made.libraryID = fields.libraryID ?? userLibrary();
    if (fields.parent !== undefined) made.parentKey = fields.parent.key;
    if (fields.html !== undefined) made.setNote(fields.html);
    if (fields.title !== undefined) made.setField("title", fields.title);
    made.addTag(FIXTURE_TAG, 0);
    for (const tag of fields.tags ?? []) made.addTag(tag, 1);
    await made.saveTx();
    created.push(made.id);
    return made;
  }

  async function graphConnection() {
    const instance = pluginInstance();
    if (!instance) assert.fail("the plugin instance is gone");
    const graph = instance.api.services;
    if (!graph) assert.fail("no ServiceGraph is published at api.services");
    const open = await graph.database.ready;
    if (open === undefined) assert.fail("the plugin database is not open");
    return open.connection;
  }

  before(async function () {
    // An imported item, carrying the bare tag the importer writes.
    const paper = await item("journalArticle", {
      title: `P7-T11 imported paper ${MARK}`,
      tags: ["research_helper"],
    });
    ids.imported = paper.id;
    // (a) A generated child note, and a standalone one.
    ids.generated = (
      await item("note", {
        parent: paper,
        html: `<p>Generated summary ${MARK}</p>`,
        tags: ["research_helper/ai-summary"],
      })
    ).id;
    ids.generatedStandalone = (
      await item("note", {
        html: `<p>Generated report ${MARK}</p>`,
        tags: ["research_helper/report"],
      })
    ).id;
    // (b) A provenance note: the bare tag and FR-8's title.
    ids.provenance = (
      await item("note", {
        html: `<p>${PROVENANCE_NOTE_TITLE_PREFIX}2026-11-17T00:00:00Z</p><p>${MARK}</p>`,
        tags: ["research_helper"],
      })
    ).id;
    // What must stay: a user note; a user note that mentions the namespace in
    // its text only; a note with the bare tag but another title.
    ids.userNote = (
      await item("note", { parent: paper, html: `<p>My own note ${MARK}</p>` })
    ).id;
    ids.mentionNote = (
      await item("note", {
        html: `<p>I tag things research_helper/ai-summary by hand ${MARK}</p>`,
      })
    ).id;
    ids.bareNote = (
      await item("note", {
        html: `<p>Reading list ${MARK}</p>`,
        tags: ["research_helper"],
      })
    ).id;
    // (c) A linked audio file, named by a stored report.
    audioFile = PathUtils.join(PathUtils.tempDir, `${MARK}.wav`);
    await IOUtils.write(audioFile, new Uint8Array([82, 73, 70, 70]));
    const attachment = (await Zotero.Attachments.linkFromFile({
      file: audioFile,
      parentItemID: paper.id,
    })) as Zotero.Item;
    attachment.addTag(FIXTURE_TAG, 0);
    await attachment.saveTx();
    created.push(attachment.id);
    ids.audio = attachment.id;
    reportRowId = `${MARK}-report`;
    const db = await graphConnection();
    await db.queryAsync(
      "INSERT INTO report (id, library_id, collection_key, json, generated_at) VALUES (?, ?, ?, ?, 1)",
      [
        reportRowId,
        userLibrary(),
        "P7T11KEY",
        JSON.stringify({ audioAttachmentKeys: { en: attachment.key } }),
      ],
    );
    // A group library with one generated note, then made read-only.
    const made = new (
      Zotero as unknown as { Group: new () => FixtureGroup }
    ).Group();
    made.id = 91_000_000 + (Date.now() % 1_000_000);
    made.name = `Research Helper removal (P7-T11) ${MARK}`;
    made.description = "";
    made.editable = true;
    made.filesEditable = true;
    made.version = 1;
    await made.saveTx();
    group = made;
    ids.groupGenerated = (
      await item("note", {
        libraryID: made.libraryID,
        html: `<p>Group summary ${MARK}</p>`,
        tags: ["research_helper/ai-summary"],
      })
    ).id;
    made.editable = false;
    await made.saveTx();
  });

  after(async function () {
    if (reportRowId !== undefined) {
      const db = await graphConnection();
      await db.queryAsync("DELETE FROM report WHERE id = ?", [reportRowId]);
    }
    if (group !== undefined) {
      group.editable = true;
      await group.saveTx();
    }
    if (created.length > 0) await Zotero.Items.erase(created);
    if (group !== undefined) await group.eraseTx();
    if (audioFile !== undefined) await IOUtils.remove(audioFile);
    log(
      `erased ${String(created.length)} items, the group, the row and the file`,
    );
  });

  it("finds exactly (a)–(c), names the linked folder and the read-only group, and moves only them to the trash, from where they restore", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    const db = await graphConnection();
    const audio = await reportAudioKeys(db);
    const key = (Zotero.Items.get(ids.audio) as Zotero.Item).key;
    assert.isTrue(
      audio.some((ref) => ref.libraryID === userLibrary() && ref.key === key),
      "the stored report's audio key is read",
    );
    const libraries = pluginContentLibraryIDs();
    assert.isTrue(
      libraries.includes(userLibrary()),
      "the user library is read",
    );
    assert.isTrue(
      libraries.includes(group!.libraryID),
      "the group library is read",
    );

    const found = await findAllPluginContent(libraries, audio);
    const mine = (library: LibraryPluginContent | undefined) => ({
      generated: (library?.generatedNoteIDs ?? []).filter((id) =>
        created.includes(id),
      ),
      provenance: (library?.provenanceNoteIDs ?? []).filter((id) =>
        created.includes(id),
      ),
      audio: (library?.audioAttachmentIDs ?? []).filter((id) =>
        created.includes(id),
      ),
    });
    const user = found.libraries.find((one) => one.libraryID === userLibrary());
    const inGroup = found.libraries.find(
      (one) => one.libraryID === group!.libraryID,
    );
    assert.deepEqual(mine(user), {
      generated: [ids.generated, ids.generatedStandalone].sort((a, b) => a - b),
      provenance: [ids.provenance],
      audio: [ids.audio],
    });
    assert.isTrue(user!.editable, "the user library is editable");
    assert.isTrue(
      user!.linkedFolders.includes(PathUtils.parent(audioFile!)!),
      "the linked audio file's folder is named",
    );
    assert.isFalse(inGroup!.editable, "the group is read-only");
    assert.deepEqual(mine(inGroup).generated, [ids.groupGenerated]);
    for (const kept of [
      ids.userNote,
      ids.mentionNote,
      ids.bareNote,
      ids.imported,
    ]) {
      for (const library of found.libraries) {
        assert.isFalse(
          [
            ...library.generatedNoteIDs,
            ...library.provenanceNoteIDs,
            ...library.audioAttachmentIDs,
          ].includes(kept),
          `item ${String(kept)} is not plugin content`,
        );
      }
    }
    log(
      `found: user ${JSON.stringify(mine(user))}, group ${JSON.stringify(mine(inGroup))}; batch ${String(PLUGIN_CONTENT_TRASH_BATCH)}`,
    );

    // The trash, over this file's ids only. A kept item smuggled into the plan
    // is checked again and stays; the read-only group is not written.
    const plan: PluginContent = {
      libraries: [
        {
          ...user!,
          generatedNoteIDs: [
            ...mine(user).generated,
            ids.userNote,
            ids.mentionNote,
          ],
          provenanceNoteIDs: [...mine(user).provenance, ids.bareNote],
          audioAttachmentIDs: mine(user).audio,
        },
        {
          ...inGroup!,
          generatedNoteIDs: mine(inGroup).generated,
          provenanceNoteIDs: [],
          audioAttachmentIDs: [],
        },
      ],
    };
    const moved = await trashPluginContent(plan);
    assert.strictEqual(moved, 4, "(a) twice, (b) and (c) are moved");
    const deleted = (id: number) =>
      (Zotero.Items.get(id) as Zotero.Item).deleted;
    for (const id of [
      ids.generated,
      ids.generatedStandalone,
      ids.provenance,
      ids.audio,
    ]) {
      assert.isTrue(deleted(id), `item ${String(id)} is in the trash`);
    }
    for (const id of [
      ids.userNote,
      ids.mentionNote,
      ids.bareNote,
      ids.imported,
      ids.groupGenerated,
    ]) {
      assert.isFalse(deleted(id), `item ${String(id)} stays`);
    }
    const paper = Zotero.Items.get(ids.imported) as Zotero.Item;
    assert.isTrue(
      paper.getTags().some((tag) => tag.tag === "research_helper"),
      "the imported item keeps its bare tag",
    );
    assert.isTrue(
      await IOUtils.exists(audioFile!),
      "the linked audio file stays on disk",
    );

    // Restorable: Zotero's own restore brings them back.
    const restore = [
      ids.generated,
      ids.generatedStandalone,
      ids.provenance,
      ids.audio,
    ];
    await Zotero.DB.executeTransaction(async () => {
      for (const id of restore) {
        const one = Zotero.Items.get(id) as Zotero.Item;
        one.deleted = false;
        await one.save();
      }
    });
    for (const id of restore) {
      assert.isFalse(deleted(id), `item ${String(id)} is restored`);
    }
    log(`moved ${String(moved)}; all restored; the five kept items untouched`);
  });
});

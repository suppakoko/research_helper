/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `P0-T10`'s item round trip, automated (`P0-T13`; spike `V-2`).
 *
 * `P0-T10` verified by hand, then by SQL with Zotero closed, that the plugin
 * writes one `journalArticle` with `title`, a first author, `DOI` and
 * `abstractNote`, inside the collection `SPIKE_COLLECTION_NAME`, tagged
 * `research_helper` as an automatic tag. This spec asserts the same thing.
 *
 * **Changed 2026-11-17 (`plan/10` `P7-T04`).** Until then the write was the
 * Tools ▸ Research Helper ▸ "Create spike item (P0-T10)" command, fired through
 * Zotero's own menu dispatch. `P7-T04` retired that developer command
 * (`plan/00` §5 backlog item 25), so the spec now writes the same fixture work
 * into the same collection through `test/integration/support/spikeArticle.ts`,
 * which uses the shipped writer, `importWorks` (`plan/00` §6 item 388(b)).
 * Every assertion on the item is unchanged; only the menu click before it is
 * gone. The Tools menu's own shape is `menus.spec.ts`'s and
 * `lifecycle.spec.ts`'s.
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`.scaffold/test/data`, `docs/13` §2.3), so nothing here touches
 * a real library. The spec still counts items *before* and *after* rather than
 * assuming an empty collection, because a watch-mode re-run reuses the same
 * Zotero.
 *
 * **Cleanup** (`plan/00` §6 items 264 and 266, added 2026-10-22): an `after`
 * hook inside this file's `describe` erases the item(s) the write made and,
 * only when the write created it, the `SPIKE_COLLECTION_NAME` collection, so
 * later specs never see them. A failure there is reported, never thrown.
 *
 * No network, no LLM (`docs/13` §2.3): the write is fixed local data.
 *
 * **`P1-T24` changed the mapping, not what it must produce.** The item is
 * mapped from a `CanonicalWork` through `docs/07` §6.2's shipped mapper. One
 * assertion, on `extra`'s `rh-work-key`, is the cheapest proof that the shipped
 * mapper produced the item, because §6.3 makes it mandatory.
 * {@link AUTOMATIC_TAG_TYPE} and {@link RESEARCH_HELPER_TAG} are declared in
 * `itemMapper.ts` §1 and the shipped mapper needs both.
 */

import type Addon from "../../../src/addon";
import { config } from "../../../package.json";
import { readWorkKey } from "../../../src/zotero/extraField";
import {
  AUTOMATIC_TAG_TYPE,
  RESEARCH_HELPER_TAG,
} from "../../../src/zotero/itemMapper";
import {
  SPIKE_COLLECTION_NAME,
  writeSpikeArticle,
} from "../support/spikeArticle";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isNotEmpty(value: string, message?: string): void;
  include<T>(haystack: readonly T[], needle: T, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P0-T10]";

/** What the write made, for the cleanup hook; see the file header. */
const writtenItemIDs = new Set<number>();
const writtenCollectionIDs = new Set<number>();

const STEP_TIMEOUT_MS = 20_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > STEP_TIMEOUT_MS) {
      assert.fail(`timed out after ${STEP_TIMEOUT_MS} ms waiting for ${what}`);
    }
    await delay(100);
  }
}

function spikeCollection(): Zotero.Collection | undefined {
  return Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID).find(
    (collection) => collection.name === SPIKE_COLLECTION_NAME,
  );
}

function spikeItemIDs(): number[] {
  return spikeCollection()?.getChildItems(true) ?? [];
}

describe("P0-T10's item round trip (V-2)", function () {
  // plan/00 §6 items 264 and 266: inside the describe, so it runs when this
  // spec ends; a failure here is reported, never thrown.
  after(async function () {
    const itemIDs = [...writtenItemIDs];
    const collectionIDs = [...writtenCollectionIDs];
    try {
      if (itemIDs.length > 0) await Zotero.Items.erase(itemIDs);
      for (const collectionID of collectionIDs) {
        const collection = Zotero.Collections.get(collectionID);
        if (collection) await collection.eraseTx();
      }
      debug(
        `${LOG_PREFIX} cleanup erased ${String(itemIDs.length)} items and ` +
          `${String(collectionIDs.length)} collections`,
      );
    } catch (error) {
      debug(
        `${LOG_PREFIX} cleanup FAILED (${
          error instanceof Error ? error.message : String(error)
        }); ${String(itemIDs.length)} items may remain`,
      );
    }
  });
  it("creates one journalArticle with four fields inside the named collection", async function () {
    await waitUntil(
      () =>
        (Zotero as unknown as Record<string, Addon | undefined>)[
          config.addonInstance
        ]?.data.initialized === true,
      `Zotero.${config.addonInstance}.data.initialized`,
    );

    const before = new Set(spikeItemIDs());
    const report = await writeSpikeArticle();
    // Bookkeeping first, so the cleanup hook has it even if an assertion fails.
    for (const id of report.createdItemIDs) writtenItemIDs.add(id);
    if (report.collectionCreated)
      writtenCollectionIDs.add(report.collection.id);
    debug(
      `${LOG_PREFIX} created ${String(report.created)} item(s) ` +
        `${JSON.stringify(report.createdItemIDs)} tagged "${RESEARCH_HELPER_TAG}" ` +
        `in collection ${String(report.collection.id)} ` +
        `(${report.collectionCreated ? "created" : "reused"}); ` +
        `linked ${String(report.linkedExisting)}, skipped ${String(report.skipped)}, ` +
        `failed ${String(report.failed.length)}`,
    );

    const created = spikeItemIDs().filter((id) => !before.has(id));
    assert.strictEqual(created.length, 1, "exactly one item per write");
    assert.deepEqual(
      [...report.createdItemIDs],
      created,
      "the writer's report names the item the collection gained",
    );

    const item = Zotero.Items.get(created[0]!);
    if (!item) {
      assert.fail(`item ${String(created[0])} is not loadable`);
    }
    const collection = spikeCollection()!;

    assert.strictEqual(
      Zotero.ItemTypes.getName(item.itemTypeID),
      "journalArticle",
    );
    assert.isNotEmpty(item.getField("title"), "title");
    assert.isNotEmpty(item.getField("DOI"), "DOI");
    assert.isNotEmpty(item.getField("abstractNote"), "abstractNote");

    const firstAuthor = item.getCreators()[0];
    if (!firstAuthor) {
      assert.fail("the item has no creators");
    }
    assert.strictEqual(
      Zotero.CreatorTypes.getName(firstAuthor.creatorTypeID),
      "author",
      "first creator's type",
    );
    assert.isNotEmpty(firstAuthor.lastName, "first author's last name");

    assert.include(
      item.getCollections(),
      collection.id,
      "item is in the named collection",
    );
    assert.deepEqual(
      item
        .getTags()
        .filter((tag) => tag.tag === RESEARCH_HELPER_TAG)
        .map((tag) => tag.type),
      [AUTOMATIC_TAG_TYPE],
      `item carries "${RESEARCH_HELPER_TAG}" once, as an automatic tag`,
    );

    // P1-T24: the item came through docs/07 §6.2's shipped mapper, so §6.3's
    // mandatory `rh-work-key` is in `extra` and matches the DOI the write
    // carried. A spike-built item would have an empty `extra`.
    assert.strictEqual(
      readWorkKey(item.getField("extra")),
      `doi:${item.getField("DOI")}`,
      "extra carries the shipped mapper's rh-work-key for this DOI",
    );
  });
});

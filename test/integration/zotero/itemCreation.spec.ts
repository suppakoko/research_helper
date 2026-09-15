/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * The `P0-T10` Tools-menu command, automated (`P0-T13`).
 *
 * `P0-T10` verified by hand, then by SQL with Zotero closed, that
 * Tools ▸ Research Helper ▸ Create spike item writes one `journalArticle` with
 * `title`, a first author, `DOI` and `abstractNote`, inside the collection
 * `SPIKE_COLLECTION_NAME`, tagged `research_helper` as an automatic tag. This
 * spec asserts the same thing through Zotero's own dispatch: it builds the real
 * menu with `Zotero.MenuManager.updateMenuPopup()` and fires the real
 * `<menuitem>`'s command, so the path is `menuCommandListener` → the plugin's
 * `onCommand`, not a direct call into the bundle.
 *
 * The runner gives Zotero a temporary data directory that it empties before
 * every run (`.scaffold/test/data`, `docs/13` §2.3), so nothing here touches
 * a real library and nothing is cleaned up afterwards. The spec still counts
 * items *before* and *after* rather than assuming an empty collection, because
 * a watch-mode re-run reuses the same Zotero.
 *
 * No network, no LLM (`docs/13` §2.3): the command writes fixed local data.
 */

import type Addon from "../../../src/addon";
import { config } from "../../../package.json";
import {
  L10N_MENU_ROOT,
  L10N_MENU_SPIKE_CREATE_ITEM,
} from "../../../src/ui/menus/toolsMenu";
import { SPIKE_COLLECTION_NAME } from "../../../src/zotero/zoteroApi";
import {
  AUTOMATIC_TAG_TYPE,
  RESEARCH_HELPER_TAG,
} from "../../../src/zotero/itemMapper";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isNotEmpty(value: string, message?: string): void;
  include<T>(haystack: readonly T[], needle: T, message?: string): void;
  fail(message: string): never;
};

const TOOLS_POPUP_ID = "menu_ToolsPopup";
const TOOLS_TARGET = "main/menubar/tools";
const STEP_TIMEOUT_MS = 20_000;
/** How long to keep watching for a second, unwanted item. */
const SETTLE_MS = 1_500;

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

/**
 * Fire Tools ▸ Research Helper ▸ Create spike item through Zotero's own menu
 * machinery, then hide the popups again so no `popupshowing` listener is left
 * behind (`P0-T10`).
 *
 * Waits for the window to go idle first. Zotero 10.0.1's `menuManager.js`
 * removes the menuitem's previous command listener only in a
 * `requestIdleCallback` after `popuphidden`, so a submenu shown by an earlier
 * spec and re-shown before that callback runs carries two command listeners,
 * and one `doCommand()` creates two items. Measured: without this wait, this
 * spec failed with "expected 2 to equal 1" when it ran straight after
 * `lifecycle.spec.ts`.
 */
async function clickSpikeMenuItem(win: _ZoteroTypes.MainWindow): Promise<void> {
  await idle(win);
  const doc = win.document;
  const popup = doc.getElementById(TOOLS_POPUP_ID) as XULPopupElement | null;
  if (!popup) {
    assert.fail(`#${TOOLS_POPUP_ID} not found in the main window`);
  }
  Zotero.MenuManager.updateMenuPopup(popup, TOOLS_TARGET, {
    tabType: "library",
  });

  const menu = popup.querySelector(
    `:scope > .zotero-custom-menu-item[data-l10n-id="${L10N_MENU_ROOT}"]`,
  );
  const submenu = menu?.querySelector(":scope > menupopup");
  if (!submenu) {
    popup.dispatchEvent(new win.Event("popuphidden"));
    assert.fail("the Research Helper submenu is not in the Tools menu");
  }
  submenu.dispatchEvent(new win.Event("popupshowing"));
  const menuitem = submenu.querySelector(
    `:scope > [data-l10n-id="${L10N_MENU_SPIKE_CREATE_ITEM}"]`,
  ) as XULElement | null;

  try {
    if (!menuitem) {
      assert.fail("the spike menu item is not in the Research Helper submenu");
    }
    menuitem.doCommand();
  } finally {
    submenu.dispatchEvent(new win.Event("popuphidden"));
    popup.dispatchEvent(new win.Event("popuphidden"));
  }
  await idle(win);
}

function idle(win: _ZoteroTypes.MainWindow): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

describe("Tools-menu spike command (P0-T10)", function () {
  it("creates one journalArticle with four fields inside the named collection", async function () {
    await waitUntil(
      () =>
        (Zotero as unknown as Record<string, Addon | undefined>)[
          config.addonInstance
        ]?.data.initialized === true,
      `Zotero.${config.addonInstance}.data.initialized`,
    );

    const before = new Set(spikeItemIDs());
    await clickSpikeMenuItem(Zotero.getMainWindow());

    // onCommand does not await the command (src/ui/menus/toolsMenu.ts), so
    // the write lands asynchronously.
    const newIDs = (): number[] =>
      spikeItemIDs().filter((id) => !before.has(id));
    await waitUntil(
      () => newIDs().length > 0,
      `a new item in "${SPIKE_COLLECTION_NAME}"`,
    );
    await delay(SETTLE_MS);

    const created = newIDs();
    assert.strictEqual(created.length, 1, "exactly one item per click");

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
  });
});

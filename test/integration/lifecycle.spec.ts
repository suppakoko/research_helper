/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * Lifecycle regression for `FR-56` (`P0-T13`, automating `P0-T11`).
 *
 * Runs inside a real Zotero through zotero-plugin-scaffold's test runner
 * (`docs/13` §2.3). The plugin under test is the real, built one, installed by
 * the runner as a temporary add-on; this spec drives it only through public
 * platform paths — `AddonManager` for disable/enable, `Zotero.Plugins`
 * observers for the bootstrap calls, and `Zotero.MenuManager.updateMenuPopup()`
 * for the menu, which is what Zotero itself calls on `popupshowing`.
 *
 * What `P0-T11` measured, asserted mechanically:
 *
 * - after startup, every main window's Tools menu holds exactly one
 *   Research Helper submenu with exactly one item;
 * - after a disable, none, the torn-down instance's scope reports zero live
 *   handles, and the window's Fluent `<link>` is gone;
 * - after the matching enable, exactly one again, from a fresh instance.
 *
 * **Why the menu count alone is not enough.** Zotero 10.0.1's `MenuManager`
 * adds its own `Zotero.Plugins` shutdown observer (`_addPluginShutdownObserver`)
 * that unregisters a plugin's menus after the plugin's `shutdown` returns.
 * A plugin that forgot to unregister would still show zero menus after a
 * disable. The two assertions that catch a missing `unregisterAll()` are the
 * registry's `liveHandles()` and the window-scoped Fluent link, which nothing
 * in Zotero cleans up on the plugin's behalf (`P0-T32`).
 *
 * The sandbox caveats of `docs/01` §2.3 apply in spirit: no `console`, no
 * `performance`, no `debugger;` statement (`server.devtools` attaches the
 * Browser Toolbox, which would freeze Zotero on one).
 */

import type Addon from "../../src/addon";
import { config } from "../../package.json";
import {
  L10N_MENU_ROOT,
  L10N_MENU_SPIKE_CREATE_ITEM,
} from "../../src/ui/menus/toolsMenu";
import { L10N_MENU_SEARCH_IMPORT } from "../../src/i18n/keys";
import { PREF_KEYS } from "../../src/prefs/keys";
import { SEARCH_WINDOW_NAME } from "../../src/ui/dialogs/searchDialog";
import { SUMMARIZE_WINDOW_NAME_PREFIX } from "../../src/ui/dialogs/summarizeDialog";
import { REPORT_WINDOW_NAME_PREFIX } from "../../src/ui/panes/reportWindow";
import { qualifiedPrefName } from "../../src/zotero/prefStore";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: { timeout(ms: number): void }) => Promise<void>,
): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  fail(message: string): never;
};

/** The subset of an `AddonManager` add-on wrapper this spec calls. */
interface AddonWrapper {
  readonly isActive: boolean;
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

const TOOLS_POPUP_ID = "menu_ToolsPopup";
const TOOLS_TARGET = "main/menubar/tools";
const MAIN_WINDOW_FTL = `${config.addonRef}-mainWindow.ftl`;
const STEP_TIMEOUT_MS = 20_000;

function pluginInstance(): Addon | undefined {
  return (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
}

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

async function initializedInstance(): Promise<Addon> {
  await waitUntil(
    () => pluginInstance()?.data.initialized === true,
    `Zotero.${config.addonInstance}.data.initialized`,
  );
  return pluginInstance()!;
}

async function researchHelperAddon(): Promise<AddonWrapper> {
  const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  );
  const wrapper = (await AddonManager.getAddonByID(
    config.addonID,
  )) as AddonWrapper | null;
  if (!wrapper) {
    assert.fail(`AddonManager does not know ${config.addonID}`);
  }
  return wrapper;
}

/**
 * Resolve after Zotero has *finished* the plugin's bootstrap `method`.
 *
 * `AddonWrapper.disable()` resolves before the plugin's asynchronous
 * `shutdown` has run (`P0-T11`), so it cannot be the signal. `Zotero.Plugins`
 * calls its observers only after awaiting the bootstrap function's promise.
 */
function afterBootstrapCall(
  method: "startup" | "shutdown",
  action: () => Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observer: _ZoteroTypes.Plugins.observer = {
      [method]: (params: { id: string }) => {
        if (params.id !== config.addonID) {
          return;
        }
        clearTimeout(timer);
        Zotero.Plugins.removeObserver(observer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      Zotero.Plugins.removeObserver(observer);
      reject(new Error(`timed out waiting for bootstrap ${method}`));
    }, STEP_TIMEOUT_MS);
    Zotero.Plugins.addObserver(observer);
    action().catch((error: unknown) => {
      clearTimeout(timer);
      Zotero.Plugins.removeObserver(observer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

interface ToolsMenuCount {
  readonly menus: number;
  readonly items: number;
}

/**
 * Build the Tools popup the way Zotero does on `popupshowing`, count this
 * plugin's elements, then hide it again.
 *
 * Counting the raw DOM without an update is wrong: after `unregisterMenu` a
 * stale `<menu>` stays in the popup until its next update (`P0-T32`). And
 * `popuphidden` must be fired on both popups, or the submenu's `popupshowing`
 * listeners accumulate across counts (`P0-T10`).
 *
 * **And the count is not finished until the window has been idle.** Zotero
 * 10.0.1's `menuManager.js` adds a `once` command listener to the menuitem
 * every time the submenu is shown, and on `popuphidden` removes the previous
 * one only inside `requestIdleCallback`. Showing the submenu again before that
 * idle callback runs leaves *two* live command listeners on the same element,
 * and one `doCommand()` then runs the command twice — measured here as two
 * items from one click when `itemCreation.spec.ts` ran straight after this
 * spec, and the likely reason `P0-T10` saw three items for two dispatches.
 */
async function countToolsMenu(
  win: _ZoteroTypes.MainWindow,
): Promise<ToolsMenuCount> {
  const doc = win.document;
  const popup = doc.getElementById(TOOLS_POPUP_ID) as XULPopupElement | null;
  if (!popup) {
    assert.fail(`#${TOOLS_POPUP_ID} not found in a main window`);
  }
  Zotero.MenuManager.updateMenuPopup(popup, TOOLS_TARGET, {
    tabType: "library",
  });

  const menus = Array.from(popup.children).filter(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  );
  const submenus: Element[] = [];
  let items = 0;
  for (const menu of menus) {
    const submenu = menu.querySelector(":scope > menupopup");
    if (!submenu) {
      continue;
    }
    submenus.push(submenu);
    submenu.dispatchEvent(new win.Event("popupshowing"));
    items += Array.from(submenu.children).filter(
      (el) => el.getAttribute("data-l10n-id") === L10N_MENU_SPIKE_CREATE_ITEM,
    ).length;
  }
  for (const submenu of submenus) {
    submenu.dispatchEvent(new win.Event("popuphidden"));
  }
  popup.dispatchEvent(new win.Event("popuphidden"));
  await idle(win);

  return { menus: menus.length, items };
}

function idle(win: _ZoteroTypes.MainWindow): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

function fluentLinkCount(win: _ZoteroTypes.MainWindow): number {
  return win.document.querySelectorAll(
    `link[rel="localization"][href="${MAIN_WINDOW_FTL}"]`,
  ).length;
}

/**
 * This plugin's item-pane sections as Zotero holds them (`P3-T28`): the
 * registrations in `Zotero.ItemPaneManager.customSectionData`, which is what
 * every item pane draws from. Counted in the registry rather than the DOM,
 * because a section element is only drawn (and only removed) while an item is
 * shown. Zotero's own plugin-shutdown observer also removes a plugin's
 * sections, so `liveHandles()` above remains the check on the pairing.
 */
function summarySectionCount(): number {
  const data = (
    Zotero.ItemPaneManager as unknown as {
      customSectionData: { options: { pluginID: string }[] };
    }
  ).customSectionData;
  return data.options.filter((option) => option.pluginID === config.addonID)
    .length;
}

/**
 * The windows open anywhere in the application whose name starts with
 * `prefix`. Read from the window mediator, not from the plugin, so a window the
 * plugin forgot is still counted.
 */
function openWindowCount(prefix: string): number {
  let count = 0;
  // `null` is every window type; the typings ask for a string.
  const windows = Services.wm.getEnumerator(null as unknown as string);
  while (windows.hasMoreElements()) {
    const win = windows.getNext() as unknown as Window;
    if (!win.closed && win.name.startsWith(prefix)) {
      count += 1;
    }
  }
  return count;
}

/** The report windows (`P4-T19`), by the name `openReportWindow` gives them. */
function openReportWindowCount(): number {
  return openWindowCount(REPORT_WINDOW_NAME_PREFIX);
}

/**
 * The summarize windows (`P3-T29`), by the name `openSummarizeWindow` gives
 * them; closed at shutdown since `plan/00` §6 item 307(e).
 */
function openSummarizeWindowCount(): number {
  return openWindowCount(SUMMARIZE_WINDOW_NAME_PREFIX);
}

/**
 * This plugin's top-level items on the item context menu (`P5-T15`), in one main
 * window. `getContext` is left out: the count is of the build, and the guard
 * that reads `context.items` runs later, on `popupshowing`, which is not fired.
 */
async function itemMenuRoots(win: _ZoteroTypes.MainWindow): Promise<number> {
  const popup = win.document.getElementById(
    "zotero-itemmenu",
  ) as XULPopupElement | null;
  if (!popup) {
    assert.fail("#zotero-itemmenu not found in a main window");
  }
  Zotero.MenuManager.updateMenuPopup(popup, "main/library/item", {
    tabType: "library",
  });
  const roots = Array.from(popup.children).filter(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  ).length;
  popup.dispatchEvent(new win.Event("popuphidden"));
  await idle(win);
  return roots;
}

async function assertEveryWindow(
  expected: ToolsMenuCount & { readonly fluentLinks: number },
  when: string,
): Promise<void> {
  const windows = Zotero.getMainWindows();
  assert.isAbove(windows.length, 0, `no main window is open ${when}`);
  for (const [index, win] of windows.entries()) {
    assert.deepEqual(
      { ...(await countToolsMenu(win)), fluentLinks: fluentLinkCount(win) },
      expected,
      `main window ${index} ${when}`,
    );
  }
}

describe("lifecycle (FR-56)", function () {
  after(async function () {
    // Never leave the plugin disabled for the specs that run after this one,
    // whatever failed above.
    const wrapper = await researchHelperAddon();
    if (!wrapper.isActive) {
      await afterBootstrapCall("startup", () => wrapper.enable());
    }
    await initializedInstance();
  });

  it("registers exactly one Tools-menu item after startup", async function () {
    const instance = await initializedInstance();
    assert.isTrue(instance.data.alive, "instance is alive after startup");
    await assertEveryWindow(
      { menus: 1, items: 1, fluentLinks: 1 },
      "after startup",
    );
    assert.strictEqual(
      summarySectionCount(),
      1,
      "exactly one item-pane section after startup (P3-T28)",
    );
  });

  it("tears down on disable and registers exactly one item again on enable", async function () {
    const wrapper = await researchHelperAddon();
    const before = await initializedInstance();

    // P4-T19: a report window left open must not survive the disable. Opened
    // through the plugin's own command, for a collection id no library holds
    // (a missing collection only leaves the collection line empty), so the
    // window's name cannot be one a later spec's real collection asks for.
    const reportWindows = before.api.reportWindow;
    if (!reportWindows) {
      assert.fail("registerUI() published no api.reportWindow");
    }
    reportWindows.open(Zotero.getMainWindow(), 2_000_000_001);
    await waitUntil(
      () => openReportWindowCount() === 1,
      "the report window to open",
    );

    // Item 307(e): a summarize window left open must not survive the disable
    // either. Opened the same way, for another collection id no library holds.
    const summarizeWindows = before.api.summarizeWindow;
    if (!summarizeWindows) {
      assert.fail("registerUI() published no api.summarizeWindow");
    }
    summarizeWindows.open(Zotero.getMainWindow(), 2_000_000_002);
    await waitUntil(
      () => openSummarizeWindowCount() === 1,
      "the summarize window to open",
    );
    assert.strictEqual(summarizeWindows.openCount(), 1);

    await afterBootstrapCall("shutdown", () => wrapper.disable());
    await waitUntil(
      () => pluginInstance() === undefined,
      `Zotero.${config.addonInstance} to be removed by onShutdown`,
    );

    assert.isFalse(before.data.alive, "torn-down instance is marked dead");
    assert.deepEqual(
      before.scope.liveHandles(),
      [],
      "registry reports zero live handles after unregisterAll()",
    );
    await assertEveryWindow(
      { menus: 0, items: 0, fluentLinks: 0 },
      "after disable",
    );
    assert.strictEqual(
      summarySectionCount(),
      0,
      "no item-pane section after disable (P3-T28)",
    );
    await waitUntil(
      () => openReportWindowCount() === 0,
      "no report window after disable (P4-T19)",
    );
    assert.strictEqual(
      before.api.reportWindow,
      undefined,
      "the report window's opener is withdrawn with the instance (P4-T19)",
    );
    await waitUntil(
      () => openSummarizeWindowCount() === 0,
      "no summarize window after disable (item 307(e))",
    );
    assert.strictEqual(
      before.api.summarizeWindow,
      undefined,
      "the summarize window's opener is withdrawn with the instance (item 307(e))",
    );

    await afterBootstrapCall("startup", () => wrapper.enable());
    const afterEnable = await initializedInstance();

    assert.notStrictEqual(
      afterEnable,
      before,
      "enable builds a fresh instance rather than reusing the dead one",
    );
    assert.isAbove(
      afterEnable.scope.liveHandles().length,
      0,
      "the fresh instance registered into its own scope",
    );
    await assertEveryWindow(
      { menus: 1, items: 1, fluentLinks: 1 },
      "after disable and enable",
    );
    assert.strictEqual(
      summarySectionCount(),
      1,
      "exactly one item-pane section after disable and enable (P3-T28)",
    );
    assert.strictEqual(
      openReportWindowCount(),
      0,
      "enable opens no report window (P4-T19)",
    );
    assert.strictEqual(
      openSummarizeWindowCount(),
      0,
      "enable opens no summarize window (item 307(e))",
    );
  });

  it("closes a search window opened in keyword mode from the Tools menu at disable (P5-T15)", async function () {
    this.timeout(60_000);
    const wrapper = await researchHelperAddon();
    await initializedInstance();
    const win = Zotero.getMainWindow();
    const popup = win.document.getElementById(
      TOOLS_POPUP_ID,
    ) as XULPopupElement | null;
    if (!popup) {
      assert.fail(`#${TOOLS_POPUP_ID} not found in a main window`);
    }
    Zotero.MenuManager.updateMenuPopup(popup, TOOLS_TARGET, {
      tabType: "library",
    });
    const submenu = Array.from(popup.children)
      .find((el) => el.getAttribute("data-l10n-id") === L10N_MENU_ROOT)
      ?.querySelector(":scope > menupopup");
    submenu?.dispatchEvent(new win.Event("popupshowing"));
    const entry = Array.from(submenu?.children ?? []).find(
      (el) => el.getAttribute("data-l10n-id") === L10N_MENU_SEARCH_IMPORT,
    ) as unknown as { doCommand(): void } | undefined;
    if (!entry) {
      assert.fail("the Tools submenu has no Search & Import entry");
    }
    // The real entry, so the window goes through the plugin's own opener.
    entry.doCommand();
    submenu?.dispatchEvent(new win.Event("popuphidden"));
    popup.dispatchEvent(new win.Event("popuphidden"));
    await idle(win);
    await waitUntil(
      () => openWindowCount(SEARCH_WINDOW_NAME) === 1,
      "the search window to open",
    );

    await afterBootstrapCall("shutdown", () => wrapper.disable());
    await waitUntil(
      () => openWindowCount(SEARCH_WINDOW_NAME) === 0,
      "no search window after disable, in keyword mode too",
    );
    await afterBootstrapCall("startup", () => wrapper.enable());
    await initializedInstance();
    assert.strictEqual(
      openWindowCount(SEARCH_WINDOW_NAME),
      0,
      "enable opens no search window",
    );
  });

  it("leaves no item menu and no search window after a disable/enable cycle (P5-T15)", async function () {
    this.timeout(120_000);
    const wrapper = await researchHelperAddon();
    const pref = qualifiedPrefName(PREF_KEYS.relatedEnabled);
    const cycle = async (): Promise<Addon> => {
      await afterBootstrapCall("shutdown", () => wrapper.disable());
      await waitUntil(
        () => pluginInstance() === undefined,
        `Zotero.${config.addonInstance} to be removed by onShutdown`,
      );
      await afterBootstrapCall("startup", () => wrapper.enable());
      return initializedInstance();
    };
    const everyWindowHas = async (roots: number, when: string) => {
      for (const win of Zotero.getMainWindows()) {
        assert.strictEqual(await itemMenuRoots(win), roots, when);
      }
    };
    const searchWindows = (): number => openWindowCount(SEARCH_WINDOW_NAME);

    try {
      // The menu is built at registration, so the preference needs a cycle.
      Zotero.Prefs.set(pref, true, true);
      const before = await cycle();
      await everyWindowHas(1, "one item menu with related.enabled on");
      const opener = before.api.relatedWindow;
      if (!opener) {
        assert.fail("registerUI() published no api.relatedWindow");
      }
      // A seed id no library holds: the window draws its missing line.
      opener.open(Zotero.getMainWindow(), 2_000_000_003);
      await waitUntil(() => searchWindows() === 1, "the search window to open");

      await afterBootstrapCall("shutdown", () => wrapper.disable());
      await waitUntil(
        () => pluginInstance() === undefined,
        `Zotero.${config.addonInstance} to be removed by onShutdown`,
      );
      await everyWindowHas(0, "no item menu after disable");
      await waitUntil(
        () => searchWindows() === 0,
        "no search window after disable",
      );
      assert.strictEqual(
        before.api.relatedWindow,
        undefined,
        "the opener is withdrawn with the instance",
      );
      assert.deepEqual(before.scope.liveHandles(), []);

      await afterBootstrapCall("startup", () => wrapper.enable());
      const fresh = await initializedInstance();
      await everyWindowHas(1, "exactly one item menu after enable");
      assert.strictEqual(searchWindows(), 0, "enable opens no search window");

      // Off again: no menu after the next start, and the opener opens nothing.
      Zotero.Prefs.clear(pref, true);
      const freshOpener = fresh.api.relatedWindow;
      if (!freshOpener) {
        assert.fail("the fresh instance published no api.relatedWindow");
      }
      assert.strictEqual(
        freshOpener.open(Zotero.getMainWindow(), 2_000_000_004),
        undefined,
        "the opener reads the preference on every call",
      );
      assert.strictEqual(searchWindows(), 0, "and so opens no window");
      await cycle();
      await everyWindowHas(0, "no item menu with related.enabled off");
    } finally {
      // The registration follows the preference, so restoring it takes a cycle.
      Zotero.Prefs.clear(pref, true);
      if (
        pluginInstance() !== undefined &&
        (await itemMenuRoots(Zotero.getMainWindow())) > 0
      ) {
        await cycle();
      }
    }
  });
});

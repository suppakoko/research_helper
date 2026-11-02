/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * The two Phase 1 menu entry points and the window opener (`P1-T19`).
 *
 * Runs inside a real Zotero through zotero-plugin-scaffold's test runner
 * (`docs/13` §2.3), against the real built plugin. The menus are read the way
 * Zotero reads them — `Zotero.MenuManager.updateMenuPopup()`, which is what
 * Zotero itself calls on `popupshowing` — and the event pairing and the idle
 * wait are `lifecycle.spec.ts`'s, for the reasons documented there: a stale
 * `<menu>` survives `unregisterMenu` until the next update, and Zotero 10.0.1
 * removes the previous `once` command listener only inside
 * `requestIdleCallback`, so showing a submenu again too early leaves two live
 * listeners on one element.
 *
 * ## What is asserted here, and what cannot be yet
 *
 * `P1-T19`'s first four criteria all begin "the window opens". The window's
 * document is **`P1-T20`'s** — `addon/content/searchDialog.xhtml` does not
 * exist yet — so they cannot be mechanically verified at this card. Rather
 * than weaken them (`plan/README.md` §5 rule 6), this spec:
 *
 * - asserts the **mechanism** each one rests on: the exact URL, window name
 *   and feature string `openSearchWindow` hands to `openDialog`, that `args`
 *   travels as the fourth `openDialog` argument (which is
 *   `window.arguments[0]` inside the document), and that the returned window is
 *   focused — which is what makes a second invocation re-focus rather than
 *   duplicate;
 * - probes the chrome URL for content and **runs the real-window assertions
 *   only when the document is there**, so they switch on by themselves the day
 *   `P1-T20` lands. A `chrome://` fetch for a missing file in a registered
 *   package returns an *empty response*, not an error (`P1-T18`, measured), so
 *   presence has to be decided on the content;
 * - and reports the shortfall rather than hiding it.
 *
 * The sandbox caveats of `docs/01` §2.3 apply in spirit: no `console`, no
 * `performance`, no `debugger;` statement.
 */

import type Addon from "../../src/addon";
import { config } from "../../package.json";
import {
  L10N_MENU_COLLECTION_REMOVE_NOTES,
  L10N_MENU_COLLECTION_REPORT,
  L10N_MENU_COLLECTION_RERUN,
  L10N_MENU_COLLECTION_SEARCH_IMPORT,
  L10N_MENU_COLLECTION_SUMMARIZE_ALL,
  L10N_MENU_ITEM_FIND_RELATED,
  L10N_MENU_ROOT,
  L10N_MENU_SEARCH_IMPORT,
  L10N_MENU_SPIKE_CREATE_ITEM,
} from "../../src/i18n/keys";
import { PREF_KEYS } from "../../src/prefs/keys";
import { PREFS } from "../../src/prefs/schema";
import {
  SEARCH_WINDOW_FEATURES,
  SEARCH_WINDOW_NAME,
  SEARCH_WINDOW_URL,
  openSearchWindow,
  type SearchWindowArgs,
  type SearchWindowHandle,
} from "../../src/ui/dialogs/searchDialog";
import {
  collectionMenuOptions,
  withSearchImportEntry,
  type SearchMenuCommands,
} from "../../src/ui/menus/registerMenus";
import { toolsMenuOptions } from "../../src/ui/menus/toolsMenu";
import {
  REPORT_LANGUAGE_L10N,
  REPORT_WINDOW_FEATURES,
  REPORT_WINDOW_L10N,
  REPORT_WINDOW_NAME_PREFIX,
  REPORT_WINDOW_URL,
  buildReportWindowModel,
  openReportWindow,
  type ReportWindowArgs,
  type ReportWindowSession,
} from "../../src/ui/panes/reportWindow";
import { qualifiedPrefName } from "../../src/zotero/prefStore";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "./support/uiLocale";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
/** The slice of Mocha's test context this file uses. */
interface TestContext {
  /** Per-test timeout override; the config-wide default is 30 s. */
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const TOOLS_POPUP_ID = "menu_ToolsPopup";
const COLLECTION_POPUP_ID = "zotero-collectionmenu";
const TOOLS_TARGET = "main/menubar/tools";
const COLLECTION_TARGET = "main/library/collection";
const STEP_TIMEOUT_MS = 20_000;
/** Five disable/enable cycles, as `P1-T19`'s fifth criterion and `P0-T11`. */
const TEARDOWN_CYCLES = 5;

function log(line: string): void {
  debug(`[P1-T19] ${line}`);
}

/* ------------------------------------------------------- platform helpers */

/** The subset of an `AddonManager` add-on wrapper this spec calls. */
interface AddonWrapper {
  readonly isActive: boolean;
  disable(): Promise<unknown>;
  enable(): Promise<unknown>;
}

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
 * `AddonWrapper.disable()` resolves before the asynchronous `shutdown` has run
 * (`P0-T11`), so it cannot be the signal.
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

function idle(win: _ZoteroTypes.MainWindow): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

/* ------------------------------------------------------------ menu reading */

/** One top-level plugin submenu, and the entries inside it. */
interface MenuShape {
  /** How many top-level items of ours the popup holds. One, or zero. */
  readonly roots: number;
  /** `data-l10n-id`s of the submenu's children, in order. */
  readonly entries: readonly string[];
  /** `localName`s of the submenu's children, in order. */
  readonly kinds: readonly string[];
  /** `hidden` on the top-level item straight after the popup was built. */
  readonly hiddenOnBuild: boolean | undefined;
  /** `hidden` after the popup's own `popupshowing`, i.e. after `onShowing`. */
  readonly hidden: boolean | undefined;
}

const EMPTY_MENU: MenuShape = {
  roots: 0,
  entries: [],
  kinds: [],
  hiddenOnBuild: undefined,
  hidden: undefined,
};

function popupOf(
  win: _ZoteroTypes.MainWindow,
  id: string,
): XULPopupElement | undefined {
  const popup = win.document.getElementById(id);
  return (popup as XULPopupElement | null) ?? undefined;
}

/**
 * `setVisible(v)` does `menuElem.hidden = !v` — the DOM *property*
 * (`menuManager.js`, Zotero 10.0.1, `_updateMenuEvents`'s default context), so
 * the property is what has to be read. The attribute is the fallback, because
 * `zoteroPane.js` sets `hidden` on its own entries with `setAttribute`.
 */
function isHidden(el: Element): boolean {
  const property = (el as unknown as { hidden?: unknown }).hidden;
  if (typeof property === "boolean") {
    return property;
  }
  return el.hasAttribute("hidden") && el.getAttribute("hidden") !== "false";
}

/**
 * Build one popup the way Zotero builds it, read this plugin's contribution,
 * then hide it again.
 *
 * **`event` is deliberately not passed**, because `zoteroPane.js` does not pass
 * it for `main/library/collection` (nor for `main/library/item`; it does for
 * `addAttachment` / `addNote`, and `standalone.js` does for all six menubar
 * targets). That is not a detail: `menuManager.js`'s `_updateMenuEvents` calls
 * a top-level `onShowing` **synchronously only when an `event` was passed**, and
 * otherwise registers it as a `{ once: true }` `popupshowing` listener on the
 * parent popup. For the collection menu the real order is
 * `buildCollectionContextMenu()` → `openPopupAtScreen()` → `popupshowing`
 * (`zoteroPane.js`'s `onCollectionsContextMenuOpen`), so the guard runs on the
 * same open, just after the build. `fireParentShowing` reproduces that second
 * step; `docs/08` §2.2's "Hook timing" paragraph describes only the
 * `event`-passed half.
 *
 * `collectionTreeRows` is left out of the context on purpose: the handlers
 * under test do not read it — `zotero-types@4.1.3` declares only the
 * deprecated singular `collectionTreeRow`, which *throws* when more than one
 * row is selected — and take the selection from `ZoteroPane` instead
 * (`docs/01` §3.4(a), `P1-T19` Do step 2).
 */
async function readMenu(
  win: _ZoteroTypes.MainWindow,
  popupID: string,
  target: _ZoteroTypes.MenuManager.ValidTarget,
  fireParentShowing = false,
): Promise<MenuShape> {
  const popup = popupOf(win, popupID);
  if (!popup) {
    assert.fail(`#${popupID} not found in a main window`);
  }
  Zotero.MenuManager.updateMenuPopup(popup, target, {
    tabType: "library",
    tabID: "zotero-pane",
  });

  const roots = Array.from(popup.children).filter(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  );
  const [root] = roots;
  let shape: MenuShape = { ...EMPTY_MENU, roots: roots.length };
  const submenu = root?.querySelector(":scope > menupopup") ?? undefined;
  if (root) {
    const hiddenOnBuild = isHidden(root);
    if (fireParentShowing) {
      // `#zotero-collectionmenu` carries no `onpopupshowing` attribute and
      // `buildCollectionContextMenu` is not wired to this event, so this
      // dispatch reaches MenuManager's own listeners and nothing else.
      popup.dispatchEvent(new win.Event("popupshowing"));
    }
    submenu?.dispatchEvent(new win.Event("popupshowing"));
    const children = submenu ? Array.from(submenu.children) : [];
    shape = {
      roots: roots.length,
      entries: children.map((el) => el.getAttribute("data-l10n-id") ?? ""),
      kinds: children.map((el) => el.localName),
      hiddenOnBuild,
      hidden: isHidden(root),
    };
  }

  submenu?.dispatchEvent(new win.Event("popuphidden"));
  popup.dispatchEvent(new win.Event("popuphidden"));
  await idle(win);
  return shape;
}

/** How many top-level items of ours a popup holds, for the teardown counts. */
async function rootCount(
  win: _ZoteroTypes.MainWindow,
  popupID: string,
  target: _ZoteroTypes.MenuManager.ValidTarget,
): Promise<number> {
  return (await readMenu(win, popupID, target, true)).roots;
}

/* ------------------------------------------------------ handler test doubles */

/** One recorded `openSearchWindow` call. */
interface OpenCall {
  readonly host: unknown;
  readonly args: SearchWindowArgs;
}

/** One recorded `openDialog` call. */
interface DialogCall {
  readonly url: string | undefined;
  readonly name: string | undefined;
  readonly features: string | undefined;
  readonly extra: readonly unknown[];
}

interface Recorder {
  readonly opens: OpenCall[];
  readonly errors: string[];
  readonly commands: SearchMenuCommands;
}

function recorder(): Recorder {
  const opens: OpenCall[] = [];
  const errors: string[] = [];
  return {
    opens,
    errors,
    commands: {
      openSearchWindow: (host, args) => {
        opens.push({ host, args });
        return undefined;
      },
      onError: (message, error) => {
        errors.push(`${message}: ${String(error)}`);
      },
    },
  };
}

/** A stand-in for the window that owns a clicked menu element. */
interface StubWindow {
  readonly ZoteroPane: { getSelectedCollections: () => { id: number }[] };
  readonly dialogs: DialogCall[];
  readonly focuses: number[];
  openDialog(
    url?: string,
    name?: string,
    features?: string,
    ...extra: unknown[]
  ): SearchWindowHandle | null;
}

function stubWindow(
  collectionIDs: readonly number[],
  opened: SearchWindowHandle | null = null,
): StubWindow {
  const dialogs: DialogCall[] = [];
  const focuses: number[] = [];
  const handle: SearchWindowHandle = opened ?? {
    focus: () => {
      focuses.push(focuses.length + 1);
    },
  };
  return {
    ZoteroPane: {
      getSelectedCollections: () => collectionIDs.map((id) => ({ id })),
    },
    dialogs,
    focuses,
    openDialog(url, name, features, ...extra) {
      dialogs.push({ url, name, features, extra });
      return handle;
    },
  };
}

/** `setVisible`'s last argument, as the submenu's `onShowing` left it. */
interface VisibilityProbe {
  visible?: boolean;
}

function libraryContext(
  win: unknown,
  probe: VisibilityProbe,
): _ZoteroTypes.MenuManager.LibraryMenuContext {
  return {
    // The handlers read `menuElem.ownerDocument.defaultView` and nothing else
    // off the element, which is the whole shape that has to be faked.
    menuElem: {
      ownerDocument: { defaultView: win },
    } as unknown as XULElement,
    setL10nArgs: () => undefined,
    setEnabled: () => undefined,
    setVisible: (visible: boolean) => {
      probe.visible = visible;
    },
    setIcon: () => undefined,
    tabType: "library",
    tabSubType: undefined,
    tabID: "zotero-pane",
  };
}

function menubarContext(
  win: unknown,
): _ZoteroTypes.MenuManager.MenubarMenuContext {
  const probe: VisibilityProbe = {};
  const { menuElem, setL10nArgs, setEnabled, setVisible, setIcon } =
    libraryContext(win, probe);
  // Spelled out rather than spread from `libraryContext`: `MenubarMenuContext`
  // declares `tabSubType?: string` where `LibraryMenuContext` declares it as
  // the required `undefined`, and `exactOptionalPropertyTypes` rejects the
  // explicit `undefined` the spread would carry over.
  return {
    menuElem,
    setL10nArgs,
    setEnabled,
    setVisible,
    setIcon,
    items: [],
    tabType: "library",
  };
}

/** The Tools options the product registers: the spike menu, extended. */
function toolsOptions(commands: SearchMenuCommands) {
  return withSearchImportEntry(
    toolsMenuOptions({
      createSpikeArticle: () => Promise.resolve(undefined),
      onError: () => undefined,
    }),
    commands,
  );
}

/* ------------------------------------------------------------ chrome probes */

/**
 * The bytes a `chrome://` URL yields, or `undefined` if it does not resolve at
 * all.
 *
 * The two outcomes are different and both matter: an unregistered *package*
 * fails the request, while a missing *file* in a registered package comes back
 * **empty** (`P1-T18`, measured 2026-09-30). So a zero length is "the file is
 * not there" and `undefined` is "the package is not there".
 */
async function chromeBytes(url: string): Promise<number | undefined> {
  try {
    const response = await fetch(url);
    const body = await response.arrayBuffer();
    return body.byteLength;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------- the item menu (P5-T15) */

const ITEM_POPUP_ID = "zotero-itemmenu";
const ITEM_TARGET = "main/library/item";

/** What the item menu shows for one selection. */
interface ItemMenuShape {
  readonly roots: number;
  readonly hidden: boolean | undefined;
  readonly entries: readonly string[];
  /** Per entry, `setEnabled`'s result: it sets the `disabled` property. */
  readonly disabled: readonly boolean[];
}

/** The two `main/library/item` halves `zoteroPane.js` runs when the menu opens. */
function buildItemMenu(
  win: _ZoteroTypes.MainWindow,
  items: readonly Zotero.Item[],
): {
  popup: XULPopupElement;
  root: Element | undefined;
  submenu: Element | undefined;
} {
  const popup = popupOf(win, ITEM_POPUP_ID);
  if (!popup) {
    assert.fail(`#${ITEM_POPUP_ID} not found in a main window`);
  }
  // No `event`, as `zoteroPane.js` passes none for this target: see readMenu().
  Zotero.MenuManager.updateMenuPopup(popup, ITEM_TARGET, {
    getContext: () => ({
      items: [...items],
      collectionTreeRows: [],
      tabType: "library",
      tabSubType: undefined,
      tabID: "zotero-pane",
    }),
  } as unknown as Parameters<typeof Zotero.MenuManager.updateMenuPopup>[2]);
  const root = Array.from(popup.children).find(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  );
  return {
    popup,
    root,
    submenu: root?.querySelector(":scope > menupopup") ?? undefined,
  };
}

async function readItemMenu(
  win: _ZoteroTypes.MainWindow,
  items: readonly Zotero.Item[],
): Promise<ItemMenuShape> {
  const { popup, root, submenu } = buildItemMenu(win, items);
  // Reaches MenuManager's listeners and nothing else: the popup's own build is
  // `onItemsContextMenuOpen`, which runs before Zotero opens the popup.
  popup.dispatchEvent(new win.Event("popupshowing"));
  submenu?.dispatchEvent(new win.Event("popupshowing"));
  const children = submenu ? Array.from(submenu.children) : [];
  const shape: ItemMenuShape = {
    roots: root ? 1 : 0,
    hidden: root ? isHidden(root) : undefined,
    entries: children.map((el) => el.getAttribute("data-l10n-id") ?? ""),
    disabled: children.map(
      (el) => (el as unknown as { disabled?: boolean }).disabled === true,
    ),
  };
  submenu?.dispatchEvent(new win.Event("popuphidden"));
  popup.dispatchEvent(new win.Event("popuphidden"));
  await idle(win);
  return shape;
}

/** The open windows carrying the search window's name, from the mediator. */
function searchWindows(): Window[] {
  const found: Window[] = [];
  const windows = Services.wm.getEnumerator(null as unknown as string);
  while (windows.hasMoreElements()) {
    const win = windows.getNext() as unknown as Window;
    if (!win.closed && win.name === SEARCH_WINDOW_NAME) {
      found.push(win);
    }
  }
  return found;
}

async function closeSearchWindows(): Promise<void> {
  for (const win of searchWindows()) {
    win.close();
  }
  await waitUntil(() => searchWindows().length === 0, "the window to close");
}

const RELATED_PREF = qualifiedPrefName(PREF_KEYS.relatedEnabled);

/** A disable/enable cycle: the item menu is built at registration. */
async function cyclePlugin(): Promise<Addon> {
  const wrapper = await researchHelperAddon();
  await afterBootstrapCall("shutdown", () => wrapper.disable());
  await waitUntil(
    () => pluginInstance() === undefined,
    `Zotero.${config.addonInstance} to be removed by onShutdown`,
  );
  await afterBootstrapCall("startup", () => wrapper.enable());
  return initializedInstance();
}

/** Run `body` with `related.enabled` on, and leave it as it was found. */
async function withRelatedEnabled(
  body: (instance: Addon) => Promise<void>,
): Promise<void> {
  try {
    Zotero.Prefs.set(RELATED_PREF, true, true);
    await body(await cyclePlugin());
  } finally {
    await closeSearchWindows();
    Zotero.Prefs.clear(RELATED_PREF, true);
    await cyclePlugin();
  }
}

/** A saved journal article in the user library. */
async function savedArticle(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  item.setField("publicationTitle", "P5-T15 Journal");
  item.setField("date", "2021");
  item.setField("DOI", "10.1000/p5t15");
  item.setCreators([
    { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  ]);
  await item.saveTx();
  return item;
}

async function savedNote(): Promise<Zotero.Item> {
  const item = new Zotero.Item("note");
  item.libraryID = Zotero.Libraries.userLibraryID;
  await item.saveTx();
  return item;
}

/* -------------------------------------------------------------------- tests */

describe("menu entry points and the window opener (P1-T19)", function () {
  after(async function () {
    // Never leave the plugin disabled for the specs that run after this one,
    // whatever failed above.
    const wrapper = await researchHelperAddon();
    if (!wrapper.isActive) {
      await afterBootstrapCall("startup", () => wrapper.enable());
    }
    await initializedInstance();
  });

  it("puts Search & Import first in one Tools submenu, above the spike item", async function () {
    await initializedInstance();
    const win = Zotero.getMainWindow();
    const shape = await readMenu(win, TOOLS_POPUP_ID, TOOLS_TARGET);
    log(`Tools submenu ${JSON.stringify(shape)}`);

    // One top-level item, per docs/08 §2.3's grouping budget.
    assert.strictEqual(shape.roots, 1, "exactly one Tools submenu of ours");
    // Order is docs/08 §2.5's: Search & Import…, then the separator §2.4 puts
    // there, then what P0-T10 already had.
    assert.deepEqual(
      [...shape.entries],
      [L10N_MENU_SEARCH_IMPORT, "", L10N_MENU_SPIKE_CREATE_ITEM],
      "the Tools submenu entries, in order",
    );
    assert.deepEqual(
      [...shape.kinds],
      ["menuitem", "menuseparator", "menuitem"],
      "separators are legal INSIDE a submenu (docs/08 §2.3)",
    );
  });

  it("gives both menu labels a real translation, not an identifier", async function () {
    const win = Zotero.getMainWindow();
    const l10n = win.document.l10n;
    if (!l10n) {
      assert.fail("the main window has no document.l10n");
    }
    // Async Fluent only: `Zotero.getString()` throws on a plugin key when the
    // locale is en-US, because a plugin .ftl lives in L10nRegistry and not in
    // that synchronous bundle (docs/08 §8.2.1).
    const [root, tools, collection] = await l10n.formatMessages([
      { id: L10N_MENU_ROOT },
      { id: L10N_MENU_SEARCH_IMPORT },
      { id: L10N_MENU_COLLECTION_SEARCH_IMPORT },
    ]);
    const label = (message: L10nMessage | null | undefined): string =>
      message?.attributes?.find((attr) => attr.name === "label")?.value ?? "";
    log(
      `labels root="${label(root)}" tools="${label(tools)}" ` +
        `collection="${label(collection)}"`,
    );
    // An empty `.label` is the silent failure P0-T10 and P0-T32 chased; it is
    // what a wrong resource id or a missing `.label` attribute looks like.
    assert.isAbove(label(root).length, 0, `${L10N_MENU_ROOT} has a label`);
    assert.isAbove(
      label(tools).length,
      0,
      `${L10N_MENU_SEARCH_IMPORT} has a label`,
    );
    assert.isAbove(
      label(collection).length,
      0,
      `${L10N_MENU_COLLECTION_SEARCH_IMPORT} has a label`,
    );
  });

  it("registers exactly one top-level item on the collection context menu", async function () {
    const win = Zotero.getMainWindow();
    const shape = await readMenu(
      win,
      COLLECTION_POPUP_ID,
      COLLECTION_TARGET,
      true,
    );
    log(`collection submenu ${JSON.stringify(shape)}`);

    // That the submenu is here at all is the proof that we registered no
    // top-level separator: docs/08 §2.3 says `_validate()` rejects one and
    // registration then fails SILENTLY FOR THE WHOLE MENU, so a passing
    // `roots === 1` cannot coexist with a top-level separator of ours.
    assert.strictEqual(
      shape.roots,
      1,
      "exactly one collection-context submenu of ours",
    );
    // The hidden `report.enabled` of item 307(d) was removed on 2026-11-02
    // (P4-T20), so the live menu has the report entry, first (docs/08 §2.5).
    assert.deepEqual(
      [...shape.entries],
      [
        L10N_MENU_COLLECTION_REPORT,
        L10N_MENU_COLLECTION_SUMMARIZE_ALL,
        L10N_MENU_COLLECTION_REMOVE_NOTES,
        "",
        L10N_MENU_COLLECTION_SEARCH_IMPORT,
        L10N_MENU_COLLECTION_RERUN,
      ],
      "P4-T19's report entry, P3-T29's two LLM-job entries and the separator " +
        "below them (docs/08 §2.5's notes of 2026-10-29), then Search & " +
        "Import and FR-12's Re-run This Search… (P2-T17); the recommend " +
        "entry of docs/08 §2.4 is a later card's",
    );
    assert.deepEqual(
      [...shape.kinds],
      [
        "menuitem",
        "menuitem",
        "menuitem",
        "menuseparator",
        "menuitem",
        "menuitem",
      ],
    );

    // The real `onShowing` ran, reading the live selection through
    // menuElem -> ownerDocument -> defaultView -> ZoteroPane. Whatever is
    // selected, the two must agree.
    const selected = win.ZoteroPane.getSelectedCollections().length;
    log(`live selection holds ${selected} collection(s)`);
    assert.strictEqual(
      shape.hidden,
      selected !== 1,
      "the submenu is visible exactly when one collection is selected",
    );

    // Opening the menu again must give the same answer, and it is the popup's
    // own `popupshowing` that applies the guard rather than the build:
    // `zoteroPane.js` passes no `event` to `updateMenuPopup` for this target,
    // so `menuManager.js` registers `onShowing` as a `{ once: true }`
    // `popupshowing` listener instead of calling it, and `_initMenu` re-uses
    // the existing element without resetting `hidden`. The real sequence still
    // shows the right state because the build precedes `openPopupAtScreen()`;
    // these two assertions are what would catch that order changing.
    const again = await readMenu(
      win,
      COLLECTION_POPUP_ID,
      COLLECTION_TARGET,
      true,
    );
    log(`collection submenu, second open ${JSON.stringify(again)}`);
    assert.strictEqual(
      again.hidden,
      selected !== 1,
      "the guard gives the same answer on the second open",
    );
    assert.strictEqual(
      again.hiddenOnBuild,
      shape.hidden,
      "building the popup re-uses the element and does not re-apply the guard",
    );
  });

  it("shows the collection submenu only for a single-collection selection", async function () {
    const commands = recorder().commands;
    const submenu = collectionMenuOptions(commands).menus[0];
    if (!submenu?.onShowing) {
      assert.fail("the collection submenu has no onShowing guard");
    }
    const visibilityFor = (ids: number[]): boolean | undefined => {
      const probe: VisibilityProbe = {};
      submenu.onShowing?.(
        new Event("popupshowing"),
        libraryContext(stubWindow(ids), probe),
      );
      return probe.visible;
    };
    assert.isTrue(visibilityFor([7]), "one selected collection -> visible");
    assert.isFalse(visibilityFor([]), "no selected collection -> hidden");
    assert.isFalse(visibilityFor([7, 8]), "two selected -> hidden");
  });

  it("passes the right-clicked collection as the pre-selected target", async function () {
    const rec = recorder();
    const item = collectionMenuOptions(rec.commands).menus[0]?.menus?.[0];
    if (!item?.onCommand) {
      assert.fail("the collection entry has no onCommand");
    }
    const win = stubWindow([4242]);
    const probe: VisibilityProbe = {};
    item.onCommand(new Event("command"), libraryContext(win, probe));

    assert.strictEqual(rec.errors.length, 0, rec.errors.join("; "));
    assert.strictEqual(rec.opens.length, 1, "one window open request");
    assert.deepEqual(
      rec.opens[0]?.args,
      { mode: "keyword", collectionID: 4242 },
      "the collection id travels as the import target (P1-T19 Do step 2)",
    );
    assert.strictEqual(
      rec.opens[0]?.host,
      win,
      "the window that owns the clicked element is the one opened from",
    );
  });

  it("gives the summarize and removal entries the right-clicked collection (P3-T29)", async function () {
    const rec = recorder();
    const calls: { what: string; host: unknown; collectionID: number }[] = [];
    const commands: SearchMenuCommands = {
      ...rec.commands,
      openSummarizeWindow: (host, collectionID) => {
        calls.push({ what: "summarize", host, collectionID });
        return undefined;
      },
      removeGeneratedNotes: (host, collectionID) => {
        calls.push({ what: "remove", host, collectionID });
        return undefined;
      },
    };
    const entries = collectionMenuOptions(commands).menus[0]?.menus ?? [];
    assert.deepEqual(
      entries.map((entry) => entry.menuType),
      ["menuitem", "menuitem", "separator", "menuitem", "menuitem"],
    );
    const win = stubWindow([4243]);
    for (const entry of entries.slice(0, 2)) {
      if (!entry.onCommand) assert.fail("an LLM-job entry has no onCommand");
      entry.onCommand(new Event("command"), libraryContext(win, {}));
    }
    assert.strictEqual(rec.errors.length, 0, rec.errors.join("; "));
    assert.deepEqual(
      calls.map(({ what, collectionID }) => [what, collectionID]),
      [
        ["summarize", 4243],
        ["remove", 4243],
      ],
    );
    assert.strictEqual(calls[0]?.host, win, "the clicked window is the host");
    // Two selected collections: refused through onError, nothing called.
    const two = stubWindow([1, 2]);
    entries[0]?.onCommand?.(new Event("command"), libraryContext(two, {}));
    assert.strictEqual(calls.length, 2, "nothing runs for two collections");
    assert.strictEqual(rec.errors.length, 1, "one reported refusal");
  });

  it("gives the report entry the right-clicked collection, first in the submenu (P4-T19)", async function () {
    const rec = recorder();
    const calls: { host: unknown; collectionID: number }[] = [];
    const commands: SearchMenuCommands = {
      ...rec.commands,
      openReportWindow: (host, collectionID) => {
        calls.push({ host, collectionID });
        return undefined;
      },
      openSummarizeWindow: () => undefined,
      removeGeneratedNotes: () => undefined,
    };
    const entries = collectionMenuOptions(commands).menus[0]?.menus ?? [];
    assert.deepEqual(
      entries.map((entry) =>
        entry.menuType === "menuitem" ? entry.l10nID : entry.menuType,
      ),
      [
        L10N_MENU_COLLECTION_REPORT,
        L10N_MENU_COLLECTION_SUMMARIZE_ALL,
        L10N_MENU_COLLECTION_REMOVE_NOTES,
        "separator",
        L10N_MENU_COLLECTION_SEARCH_IMPORT,
        L10N_MENU_COLLECTION_RERUN,
      ],
      "docs/08 §2.5: the report entry is first, above summarize",
    );
    const report = entries[0];
    if (!report?.onCommand) assert.fail("the report entry has no onCommand");
    const win = stubWindow([4244]);
    report.onCommand(new Event("command"), libraryContext(win, {}));
    assert.strictEqual(rec.errors.length, 0, rec.errors.join("; "));
    assert.deepEqual(
      calls.map(({ collectionID }) => collectionID),
      [4244],
    );
    assert.strictEqual(calls[0]?.host, win, "the clicked window is the host");
    // Two selected collections: refused through onError, nothing opened.
    report.onCommand(
      new Event("command"),
      libraryContext(stubWindow([1, 2]), {}),
    );
    assert.strictEqual(calls.length, 1, "nothing opens for two collections");
    assert.strictEqual(rec.errors.length, 1, "one reported refusal");
    // Without the command the entry is absent, never a dead menu item.
    const without = collectionMenuOptions(rec.commands).menus[0]?.menus ?? [];
    assert.isFalse(
      without.some(
        (entry) =>
          entry.menuType === "menuitem" &&
          entry.l10nID === L10N_MENU_COLLECTION_REPORT,
      ),
      "no report entry when no opener is bound",
    );
  });

  it("asks openDialog for a modeless report window per collection, passing the session (P4-T19)", async function () {
    const win = stubWindow([]);
    const session = {
      describe: () => Promise.reject(new Error("not called here")),
      closed: () => undefined,
    } as unknown as ReportWindowSession;
    const opened = openReportWindow(win, 31, session);
    assert.strictEqual(win.dialogs.length, 1, "one openDialog call");
    const call = win.dialogs[0];
    assert.strictEqual(call?.url, REPORT_WINDOW_URL);
    assert.strictEqual(
      call?.url,
      `chrome://${config.addonRef}/content/reportWindow.xhtml`,
      "the window's own document, under the hyphenated chrome package",
    );
    assert.strictEqual(call?.name, `${REPORT_WINDOW_NAME_PREFIX}31`);
    assert.strictEqual(call?.features, REPORT_WINDOW_FEATURES);
    assert.include(call?.features ?? "", "dialog=no", "modeless");
    assert.isFalse(
      (call?.features ?? "").includes("modal"),
      "never a modal window (P4-T19 Do NOT)",
    );
    const args = call?.extra[0] as ReportWindowArgs | undefined;
    assert.strictEqual(args?.session, session, "the session is the argument");
    assert.strictEqual(args?.l10n, REPORT_WINDOW_L10N);
    assert.isAbove(win.focuses.length, 0, "the window is focused");
    assert.strictEqual(opened, openReportWindow(win, 31, session));
    assert.strictEqual(
      win.dialogs[1]?.name,
      win.dialogs[0]?.name,
      "the same collection names the same window, so Gecko raises it",
    );
    openReportWindow(win, 32, session);
    assert.strictEqual(
      win.dialogs[2]?.name,
      `${REPORT_WINDOW_NAME_PREFIX}32`,
      "another collection gets its own window",
    );

    // The model the window draws: the resolved model as text, or "none".
    const set = buildReportWindowModel({
      collection: { name: "C", regularItems: 3 },
      language: "both",
      model: { modelId: "m-1", providerName: "OpenRouter" },
    });
    assert.deepEqual(set, {
      collection: {
        id: REPORT_WINDOW_L10N.collection,
        args: { name: "C", count: 3 },
      },
      language: "both",
      model: {
        id: REPORT_WINDOW_L10N.model,
        args: { model: "m-1", provider: "OpenRouter" },
      },
    });
    const unset = buildReportWindowModel({
      collection: undefined,
      language: "fr",
      model: undefined,
    });
    assert.deepEqual(unset, {
      collection: undefined,
      language: "auto",
      model: { id: REPORT_WINDOW_L10N.modelNone },
    });
  });

  it("opens the real report window with the collection, the language and the model as text (P4-T19)", async function () {
    this.timeout(90_000);
    const instance = await initializedInstance();
    const commands = instance.api.reportWindow;
    if (!commands) {
      assert.fail("registerUI() published no api.reportWindow");
    }
    // English assertions below: pin the UI locale (support/uiLocale.ts).
    const locale: UILocaleSnapshot = await pinUILocale(["en-US"], log);
    const libraryID = Zotero.Libraries.userLibraryID;
    const languagePref = qualifiedPrefName("reportLanguage");
    const modelPref = qualifiedPrefName("reportModel");
    const savedLanguage: unknown = Zotero.Prefs.get(languagePref, true);
    const savedModel: unknown = Zotero.Prefs.get(modelPref, true);
    const collection = new Zotero.Collection({
      libraryID,
      name: "P4-T19 report window",
    });
    await collection.saveTx();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = libraryID;
    item.setField("title", "P4-T19 paper");
    item.setCollections([collection.id]);
    await item.saveTx();
    let opened: Window | undefined;
    try {
      Zotero.Prefs.set(languagePref, "ko", true);
      Zotero.Prefs.set(modelPref, "p4t19-test-model", true);
      const main = Zotero.getMainWindow();
      opened = commands.open(main, collection.id) as unknown as Window;
      const win = opened as unknown as Window & {
        RHReportWindow?: {
          state: { initialized: boolean };
          ready?: Promise<void>;
          selectedLanguage(): string;
        };
      };
      await waitUntil(
        () =>
          win.document?.readyState === "complete" &&
          win.RHReportWindow?.state.initialized === true,
        "the report window to load and initialize",
      );
      await win.RHReportWindow?.ready;
      const doc = win.document;
      await doc.l10n?.translateRoots();
      await waitUntil(
        () =>
          doc.title.length > 0 &&
          (doc.getElementById("rh-report-model")?.textContent ?? "") !== "" &&
          (doc.getElementById("rh-report-collection")?.textContent ?? "") !==
            "",
        "the window title, the collection and the model line from Fluent",
      );
      const text = (id: string): string =>
        (doc.getElementById(id)?.textContent ?? "").trim();
      const languageList = doc.getElementById(
        "rh-report-language",
      ) as unknown as { value: string };
      const shown = {
        title: doc.title,
        collection: text("rh-report-collection"),
        model: text("rh-report-model"),
        language: languageList.value,
        close:
          doc
            .getElementById("rh-report-dialog")
            ?.getAttribute("buttonlabelcancel") ?? "",
        // Item 334(k): "Report shown" appears only for two reports and chooses
        // no model, so it is left out by name; any other menulist still counts.
        menulists: doc.querySelectorAll("menulist:not(#rh-report-shown)")
          .length,
        languageItems: [
          ...doc.querySelectorAll("#rh-report-language menuitem"),
        ].map((el) => el.getAttribute("value")),
        languageIds: Object.fromEntries(
          [...doc.querySelectorAll("#rh-report-language menuitem")].map(
            (el) => [el.getAttribute("value"), el.getAttribute("data-l10n-id")],
          ),
        ),
      };
      log(`report window ${JSON.stringify(shown)}`);
      assert.strictEqual(shown.title, "Research Helper — Collection Report");
      assert.strictEqual(shown.collection, "P4-T19 report window — 1 paper");
      assert.include(shown.model, "Model: p4t19-test-model (");
      assert.include(shown.model, "set in Research Helper's preferences");
      assert.strictEqual(
        shown.language,
        "ko",
        "the selector starts on reportLanguage",
      );
      assert.strictEqual(win.RHReportWindow?.selectedLanguage(), "ko");
      assert.deepEqual(shown.languageItems, ["auto", "en", "ko", "both"]);
      assert.deepEqual(
        shown.languageIds,
        { ...REPORT_LANGUAGE_L10N },
        "each value carries the label id the opener names for it",
      );
      assert.strictEqual(
        shown.menulists,
        1,
        "one selector — the language; no model dropdown (item 286)",
      );
      assert.strictEqual(
        doc.querySelectorAll("radiogroup, radio").length,
        0,
        "no Depth control (item 286)",
      );
      assert.strictEqual(shown.close, "Close");
      // The per-run choice is never written back to the preference.
      languageList.value = "en";
      assert.strictEqual(win.RHReportWindow?.selectedLanguage(), "en");
      assert.strictEqual(Zotero.Prefs.get(languagePref, true), "ko");

      // A second click on the same collection raises the same window.
      const again = commands.open(main, collection.id) as unknown as Window;
      assert.strictEqual(again, opened, "one window per collection");
      assert.strictEqual(commands.openCount(), 1);
    } finally {
      opened?.close();
      if (typeof savedLanguage === "string") {
        Zotero.Prefs.set(languagePref, savedLanguage, true);
      } else {
        Zotero.Prefs.clear(languagePref, true);
      }
      if (typeof savedModel === "string") {
        Zotero.Prefs.set(modelPref, savedModel, true);
      } else {
        Zotero.Prefs.clear(modelPref, true);
      }
      await item.eraseTx();
      await collection.eraseTx();
      await restoreUILocale(locale, log);
    }
    await waitUntil(
      () => commands.openCount() === 0,
      "the closed report window to be forgotten",
    );
  });

  it("opens nothing when the collection selection is not exactly one", async function () {
    for (const ids of [[], [7, 8]]) {
      const rec = recorder();
      const item = collectionMenuOptions(rec.commands).menus[0]?.menus?.[0];
      if (!item?.onCommand) {
        assert.fail("the collection entry has no onCommand");
      }
      const probe: VisibilityProbe = {};
      item.onCommand(
        new Event("command"),
        libraryContext(stubWindow(ids), probe),
      );
      assert.strictEqual(
        rec.opens.length,
        0,
        `${ids.length} selected collection(s) must open no window`,
      );
      assert.strictEqual(
        rec.errors.length,
        1,
        `${ids.length} selected collection(s) must report, not fail silently`,
      );
    }
  });

  it("opens the Tools entry with no pre-selected collection", async function () {
    const rec = recorder();
    const entry = toolsOptions(rec.commands).menus[0]?.menus?.[0];
    if (!entry?.onCommand) {
      assert.fail("the Tools Search & Import entry has no onCommand");
    }
    const win = stubWindow([4242]);
    entry.onCommand(new Event("command"), menubarContext(win));

    assert.strictEqual(rec.errors.length, 0, rec.errors.join("; "));
    assert.strictEqual(rec.opens.length, 1, "one window open request");
    assert.deepEqual(
      rec.opens[0]?.args,
      { mode: "keyword" },
      "from the Tools menu there is no right-clicked collection",
    );
    assert.isUndefined(
      rec.opens[0]?.args.collectionID,
      "no collectionID from the Tools menu",
    );
  });

  it("reports rather than throws when a handler has no host window", async function () {
    const rec = recorder();
    const entry = toolsOptions(rec.commands).menus[0]?.menus?.[0];
    if (!entry?.onCommand) {
      assert.fail("the Tools Search & Import entry has no onCommand");
    }
    // A detached element: `ownerDocument.defaultView` is null, which is what
    // docs/08 §2.2's "WeakRef-backed; may be undefined" degrades into.
    entry.onCommand(new Event("command"), menubarContext(undefined));
    assert.strictEqual(rec.opens.length, 0, "no window is opened");
    assert.strictEqual(
      rec.errors.length,
      1,
      "an unhandled rejection in the sandbox is the FR-56 failure",
    );
  });

  it("asks openDialog for a modeless singleton and passes args through", async function () {
    const win = stubWindow([]);
    const args: SearchWindowArgs = { mode: "keyword", collectionID: 9 };
    const opened = openSearchWindow(win, args);

    assert.strictEqual(win.dialogs.length, 1, "one openDialog call");
    const call = win.dialogs[0];
    assert.strictEqual(
      call?.url,
      `chrome://${config.addonRef}/content/searchDialog.xhtml`,
      "the chrome namespace is HYPHENATED (docs/08 §4.1 corrected 2026-09-30)",
    );
    assert.strictEqual(call?.url, SEARCH_WINDOW_URL);
    assert.strictEqual(
      call?.name,
      "research-helper-search",
      "the window NAME is what makes it a singleton (docs/08 §4.1)",
    );
    assert.strictEqual(call?.name, SEARCH_WINDOW_NAME);
    // docs/08 §4.1's feature string, and P1-T19 Do step 3's four requirements.
    for (const feature of [
      "dialog=no",
      "centerscreen",
      "resizable",
      "minwidth=880",
      "minheight=600",
    ]) {
      assert.include(
        call?.features ?? "",
        feature,
        `features carry ${feature}`,
      );
    }
    assert.strictEqual(call?.features, SEARCH_WINDOW_FEATURES);
    assert.strictEqual(call?.extra.length, 1, "exactly one dialog argument");
    assert.strictEqual(
      call?.extra[0],
      args,
      "args is openDialog's 4th argument, i.e. window.arguments[0]",
    );
    // Not a `jar:file:///…!/` URL: docs/08 §4.1 calls that "used in the wild
    // but not the documented path".
    assert.strictEqual(
      SEARCH_WINDOW_URL.startsWith("chrome://"),
      true,
      "no rootURI + 'content/…' jar: URL (P1-T19 Do NOT)",
    );

    // Re-invoking focuses: with the same window name Gecko hands back the
    // window that is already open, and this is what raises it.
    openSearchWindow(win, args);
    assert.strictEqual(win.dialogs.length, 2, "two invocations");
    assert.strictEqual(
      win.dialogs[1]?.name,
      win.dialogs[0]?.name,
      "both invocations name the same window, so Gecko re-uses it",
    );
    assert.strictEqual(
      opened,
      openSearchWindow(win, args),
      "the same window object comes back",
    );
    assert.isAbove(win.focuses.length, 1, "every invocation focuses");
  });

  it("registers the chrome package under the hyphenated addonRef", async function () {
    const registered = await chromeBytes(
      `chrome://${config.addonRef}/content/icons/favicon.png`,
    );
    log(`hyphenated package favicon: ${String(registered)} byte(s)`);
    assert.strictEqual(
      typeof registered,
      "number",
      `chrome://${config.addonRef}/ must resolve (addon/bootstrap.js ` +
        `registers ["content", "__addonRef__", rootURI + "content/"])`,
    );
    assert.isAbove(registered ?? 0, 0, "and the file has content");

    // docs/08 §4.1 wrote the namespace unhyphenated. If that spelling also
    // resolved, nothing would catch a copy of the stale form.
    const unhyphenated = await chromeBytes(
      `chrome://${config.addonRef.replace("-", "")}/content/icons/favicon.png`,
    );
    log(`unhyphenated package favicon: ${String(unhyphenated)}`);
    assert.strictEqual(
      unhyphenated === undefined || unhyphenated === 0,
      true,
      "the unhyphenated namespace of docs/08 §4.1 is NOT registered",
    );
  });

  it("opens the real window as a singleton once P1-T20 ships the document", async function () {
    const bytes = await chromeBytes(SEARCH_WINDOW_URL);
    if (bytes === undefined || bytes === 0) {
      // Not a silent skip: the four "the window opens" criteria of P1-T19 rest
      // on a document P1-T20 creates, and this line is the evidence that they
      // are still unverified rather than verified-and-passing.
      log(
        `PENDING P1-T20: ${SEARCH_WINDOW_URL} yields ` +
          `${bytes === undefined ? "no response" : "0 bytes"}, so the ` +
          `real-window criteria (opens / re-focuses / Escape closes) are ` +
          `NOT verified by this spec. A missing file in a registered chrome ` +
          `package returns an empty response, not an error (P1-T18).`,
      );
      assert.strictEqual(bytes ?? 0, 0, "the document is not there yet");
      return;
    }

    const win = Zotero.getMainWindow();
    const first = openSearchWindow(win, { mode: "keyword" });
    const second = openSearchWindow(win, { mode: "keyword" });
    try {
      assert.strictEqual(
        first,
        second,
        "the window name makes the second invocation re-focus, not duplicate",
      );
    } finally {
      (first as unknown as { close?: () => void }).close?.();
    }
  });

  it("leaves no menu item standing across five disable/enable cycles", async function () {
    // Five cycles do not fit the config-wide 30 s per-test budget.
    this.timeout(240_000);
    const wrapper = await researchHelperAddon();

    for (let cycle = 1; cycle <= TEARDOWN_CYCLES; cycle += 1) {
      const before = await initializedInstance();

      await afterBootstrapCall("shutdown", () => wrapper.disable());
      await waitUntil(
        () => pluginInstance() === undefined,
        `Zotero.${config.addonInstance} to be removed by onShutdown`,
      );
      assert.isFalse(before.data.alive, `cycle ${cycle}: instance is dead`);
      assert.deepEqual(
        before.scope.liveHandles(),
        [],
        `cycle ${cycle}: zero live handles after unregisterAll()`,
      );

      for (const win of Zotero.getMainWindows()) {
        assert.strictEqual(
          await rootCount(win, TOOLS_POPUP_ID, TOOLS_TARGET),
          0,
          `cycle ${cycle}: no Tools submenu after disable`,
        );
        assert.strictEqual(
          await rootCount(win, COLLECTION_POPUP_ID, COLLECTION_TARGET),
          0,
          `cycle ${cycle}: no collection submenu after disable`,
        );
      }

      await afterBootstrapCall("startup", () => wrapper.enable());
      const fresh = await initializedInstance();
      assert.isAbove(
        fresh.scope.liveHandles().length,
        0,
        `cycle ${cycle}: the fresh instance registered into its own scope`,
      );

      for (const win of Zotero.getMainWindows()) {
        assert.strictEqual(
          await rootCount(win, TOOLS_POPUP_ID, TOOLS_TARGET),
          1,
          `cycle ${cycle}: exactly one Tools submenu after enable`,
        );
        assert.strictEqual(
          await rootCount(win, COLLECTION_POPUP_ID, COLLECTION_TARGET),
          1,
          `cycle ${cycle}: exactly one collection submenu after enable`,
        );
      }
      log(`cycle ${cycle} of ${TEARDOWN_CYCLES} clean`);
    }
  });
});

describe("Find Related Papers… on the item context menu (P5-T15)", function () {
  it("is absent while related.enabled is false, and its opener opens nothing", async function () {
    const instance = await initializedInstance();
    // Read as src/prefs/index.ts's getPref reads it: addon/prefs.js keeps no
    // line for this row (plan/00 §6 item 333(c)), so the stored value is
    // undefined and the schema's default answers.
    assert.strictEqual(
      Zotero.Prefs.get(RELATED_PREF, true) ?? PREFS.relatedEnabled.default,
      false,
      "the schema's default holds the entry back (docs/07 §8.5)",
    );
    const article = await savedArticle("P5-T15 off");
    try {
      const shape = await readItemMenu(Zotero.getMainWindow(), [article]);
      log(`[P5-T15] related.enabled off ${JSON.stringify(shape)}`);
      assert.strictEqual(shape.roots, 0, "no item menu at all");
      assert.isUndefined(
        instance.api.relatedWindow?.open(Zotero.getMainWindow(), article.id),
        "the opener reads the preference on every call",
      );
      assert.strictEqual(searchWindows().length, 0, "no window opened");
    } finally {
      await article.eraseTx();
    }
  });

  it("appears for one regular item, is disabled for two, and hides for none", async function () {
    this.timeout(120_000);
    await withRelatedEnabled(async () => {
      const win = Zotero.getMainWindow();
      const first = await savedArticle("P5-T15 first");
      const second = await savedArticle("P5-T15 second");
      const note = await savedNote();
      try {
        const one = await readItemMenu(win, [first]);
        log(`[P5-T15] one regular item ${JSON.stringify(one)}`);
        assert.deepEqual(one, {
          roots: 1,
          hidden: false,
          entries: [L10N_MENU_ITEM_FIND_RELATED],
          disabled: [false],
        });

        const two = await readItemMenu(win, [first, second]);
        log(`[P5-T15] two regular items ${JSON.stringify(two)}`);
        assert.deepEqual(two, { ...one, disabled: [true] }, "disabled for two");

        const withNote = await readItemMenu(win, [first, note]);
        log(`[P5-T15] an item and a note ${JSON.stringify(withNote)}`);
        assert.deepEqual(withNote, one, "a note does not count as a seed");

        const noteOnly = await readItemMenu(win, [note]);
        log(`[P5-T15] a note alone ${JSON.stringify(noteOnly)}`);
        assert.strictEqual(
          noteOnly.hidden,
          true,
          "no regular item, no submenu",
        );

        const none = await readItemMenu(win, []);
        assert.strictEqual(none.hidden, true, "an empty selection likewise");

        // A measurement for docs/08 §5.2: what a hidden submenu leaves behind.
        const popup = popupOf(win, ITEM_POPUP_ID);
        log(
          `[P5-T15] measured, after a hidden build: last children ` +
            JSON.stringify(
              Array.from(popup?.children ?? [])
                .slice(-3)
                .map((el) => [
                  el.localName,
                  el.getAttribute("class"),
                  isHidden(el),
                ]),
            ),
        );

        // The reason on the disabled entry, through Fluent: docs/08 §2.5.
        const reasonFor = async (
          items: readonly Zotero.Item[],
          settled: (text: string) => boolean,
        ): Promise<string> => {
          const built = buildItemMenu(win, items);
          built.popup.dispatchEvent(new win.Event("popupshowing"));
          built.submenu?.dispatchEvent(new win.Event("popupshowing"));
          const entry = built.submenu?.firstElementChild;
          let text = "";
          try {
            await waitUntil(() => {
              text = entry?.getAttribute("tooltiptext") ?? "";
              return settled(text);
            }, "Fluent to word the entry's tooltip");
          } finally {
            built.submenu?.dispatchEvent(new win.Event("popuphidden"));
            built.popup.dispatchEvent(new win.Event("popuphidden"));
            await idle(win);
          }
          return text;
        };
        const reason = await reasonFor([first, second], (t) => t !== "");
        log(`[P5-T15] two items, tooltip ${JSON.stringify(reason)}`);
        assert.isAbove(reason.length, 0, "a disabled entry says why");
        const noReason = await reasonFor([first], (t) => t === "");
        assert.strictEqual(noReason, "", "an enabled entry has no tooltip");

        // Turned off while registered: hidden at once, without a restart.
        Zotero.Prefs.set(RELATED_PREF, false, true);
        const off = await readItemMenu(win, [first]);
        Zotero.Prefs.set(RELATED_PREF, true, true);
        log(`[P5-T15] turned off while registered ${JSON.stringify(off)}`);
        assert.strictEqual(
          off.hidden,
          true,
          "the submenu re-reads the preference",
        );
      } finally {
        await first.eraseTx();
        await second.eraseTx();
        await note.eraseTx();
      }
    });
  });

  it("opens the real window in related mode from the real entry, with the seed's header", async function () {
    this.timeout(120_000);
    const locale: UILocaleSnapshot = await pinUILocale(["en-US"], log);
    try {
      await withRelatedEnabled(async (instance) => {
        const main = Zotero.getMainWindow();
        const longTitle = "P5-T15 seed ".repeat(10).trim();
        const seed = await savedArticle(longTitle);
        const other = await savedArticle("P5-T15 the other seed");
        const note = await savedNote();
        interface RelatedDocument {
          document: Document;
          RHSearchWindow?: {
            state: { initialized: boolean };
            io: { mode?: string; seedItemID?: number };
            collectQuery(): {
              fromYear: number;
              toYear: number;
              related?: { seedItemID: number; relations: string[] };
            };
          };
        }
        const openWindow = (): RelatedDocument =>
          searchWindows()[0] as unknown as RelatedDocument;
        const text = (id: string): string =>
          (openWindow().document.getElementById(id)?.textContent ?? "").trim();
        const shownSeed = (title: string): Promise<void> =>
          waitUntil(
            () =>
              searchWindows().length === 1 &&
              openWindow().RHSearchWindow?.state.initialized === true &&
              text("rh-related-seed-title") === title,
            `the Seed line to read "${title}"`,
          );
        try {
          // The real entry's real listener: the click goes through MenuManager.
          const { popup, submenu } = buildItemMenu(main, [seed]);
          popup.dispatchEvent(new main.Event("popupshowing"));
          submenu?.dispatchEvent(new main.Event("popupshowing"));
          const entry = submenu?.firstElementChild as unknown as
            { doCommand(): void } | null | undefined;
          if (!entry) {
            assert.fail("the item submenu has no entry");
          }
          entry.doCommand();
          submenu?.dispatchEvent(new main.Event("popuphidden"));
          popup.dispatchEvent(new main.Event("popuphidden"));
          await idle(main);

          await shownSeed(longTitle);
          const io = openWindow().RHSearchWindow?.io;
          assert.deepEqual(
            { mode: io?.mode, seedItemID: io?.seedItemID },
            { mode: "related", seedItemID: seed.id },
            "window.arguments[0] carries the seed",
          );

          const doc = openWindow().document;
          const hiddenById = (id: string): boolean => {
            const el = doc.getElementById(id);
            if (!el) {
              assert.fail(`#${id} is not in the document`);
            }
            return isHidden(el);
          };
          const yearFrom = doc.getElementById(
            "rh-search-years-from",
          ) as unknown as {
            value: string;
            label: string;
          };
          const yearTo = doc.getElementById(
            "rh-search-years-to",
          ) as unknown as {
            value: string;
            label: string;
          };
          // Whether a menulist picks up Fluent's label for an item added at run
          // time is measured here: the label arrives after the selection.
          const chip = doc.getElementById("rh-search-mode");
          await waitUntil(
            () =>
              yearFrom.label !== "" &&
              yearTo.label !== "" &&
              (chip?.getAttribute("value") ?? "").startsWith("Related to: "),
            "the year lists' Any label and the chip from Fluent",
          );
          const shown = {
            title: doc.title,
            chip: chip?.getAttribute("value") ?? "",
            chipHidden: chip ? isHidden(chip) : undefined,
            authors: text("rh-related-seed-authors"),
            details: text("rh-related-seed-details"),
            yearFrom: [yearFrom.value, yearFrom.label],
            yearTo: [yearTo.value, yearTo.label],
            prose: text("rh-state-initial-prose"),
            includeBoxes: Array.from(
              doc.querySelectorAll("#rh-related-include checkbox"),
            ).map((box) => (box as Element).getAttribute("label")),
          };
          log(`[P5-T15] related window ${JSON.stringify(shown)}`);
          assert.strictEqual(shown.title, "Research Helper — Related Papers");
          assert.strictEqual(shown.chipHidden, false);
          assert.include(shown.chip, "Related to: ");
          assert.include(
            shown.chip,
            "…",
            "the chip's copy of a long title is cut",
          );
          assert.include(shown.authors, "Lovelace");
          assert.include(shown.details, "P5-T15 Journal");
          assert.include(shown.details, "2021");
          assert.include(shown.details, "10.1000/p5t15");
          assert.deepEqual(shown.yearFrom, ["any", "Any"]);
          assert.deepEqual(shown.yearTo, ["any", "Any"]);
          assert.deepEqual(shown.includeBoxes, [
            "References",
            "Citations",
            "Recommended",
            "Similar articles (PubMed)",
          ]);
          assert.strictEqual(
            shown.prose,
            "Papers related to this item will be listed here.",
          );
          for (const id of [
            "rh-search-keyword",
            "rh-search-run",
            "rh-search-max-results",
            "rh-search-databases-group",
            "rh-search-screening-row",
          ]) {
            assert.isTrue(hiddenById(id), `#${id} has no meaning for a seed`);
          }
          assert.isFalse(
            hiddenById("rh-related-header"),
            "the header is shown",
          );
          assert.isFalse(hiddenById("rh-related-seed-title"));
          assert.isTrue(hiddenById("rh-related-seed-missing"));

          const query = openWindow().RHSearchWindow?.collectQuery();
          assert.deepEqual(query?.related, {
            seedItemID: seed.id,
            relations: ["reference", "citation", "recommendation", "similar"],
          });
          assert.isTrue(Number.isNaN(query?.fromYear), "Any reads as no bound");

          // A second seed lands in the one window: Gecko reloads it by name.
          const opener = instance.api.relatedWindow;
          if (!opener) {
            assert.fail("registerUI() published no api.relatedWindow");
          }
          opener.open(main, other.id);
          await shownSeed("P5-T15 the other seed");
          assert.strictEqual(searchWindows().length, 1, "still one window");
          log("[P5-T15] measured: a second seed reloads the one window");

          // A seed that is not a readable regular item: the missing line.
          opener.open(main, note.id);
          await waitUntil(
            () =>
              searchWindows().length === 1 &&
              openWindow().RHSearchWindow?.io.seedItemID === note.id &&
              text("rh-related-seed-missing").length > 0 &&
              !isHidden(
                openWindow().document.getElementById(
                  "rh-related-seed-missing",
                ) as Element,
              ),
            "the missing line for a seed that cannot be read",
          );
          assert.include(
            text("rh-related-seed-missing"),
            "This item could not be read.",
          );
        } finally {
          await closeSearchWindows();
          await seed.eraseTx();
          await other.eraseTx();
          await note.eraseTx();
        }
      });
    } finally {
      await restoreUILocale(locale, log);
    }
  });
});

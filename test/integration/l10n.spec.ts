/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `V-17` / `P0-T24`: Fluent localization of plugin strings on Zotero 10, with a
 * `ko-KR` bundle and English fallback for a missing key (`FR-55`, `docs/13`
 * §2.3's L10n row).
 *
 * The plugin under test is the real, built one; its bundles are
 * `locale/en-US/research-helper-mainWindow.ftl` (complete) and
 * `locale/ko-KR/research-helper-mainWindow.ftl`, which lacks
 * `research-helper-menu-spike-create-item` on purpose.
 *
 * Three layers are asserted separately, because they fail independently:
 *
 * 1. **Registration, per file per locale.** Zotero's `registerLocales()`
 *    (`plugins.js`) contributes one file per Zotero locale to the shared
 *    `zotero-plugins` source, picking exact → same language → `en-US` → first
 *    available. A `Localization` pinned to `["ko-KR"]` alone therefore sees
 *    the Korean file and nothing else: the root key is Korean and the missing
 *    key is `null`. That is the proof the key really is absent at runtime, and
 *    that Zotero's file-level pick does not merge files.
 * 2. **Fallback, per message.** Pinned to `["ko-KR", "en-US"]`, Gecko's
 *    `Localization` walks the chain message by message, so the missing key
 *    resolves from the English file.
 * 3. **The real UI locale.** `Services.locale.requestedLocales` is switched to
 *    `en-US` and then to `ko-KR` in the runner's own profile
 *    (`.scaffold/test/profile`, never the dev profile or the user's Zotero),
 *    and the Tools menu, the main window's `document.l10n` and an unpinned
 *    `new Localization([...])` — the form the plugin sandbox uses — are read
 *    under each. The pref is restored in `after`, whatever failed.
 *
 * Every measured value is written to the runner's terminal, prefixed
 * `[P0-T24]`, before it is asserted. Sandbox caveats (`docs/01` §2.3): no
 * `console`, no `performance`.
 */

import { config } from "../../package.json";
import {
  FLUENT_PREFIX,
  fluentResourceId,
  formatAttribute,
  type FluentFormatter,
} from "../../src/i18n/ftl";
import {
  L10N_MENU_ROOT,
  L10N_MENU_SPIKE_CREATE_ITEM,
} from "../../src/ui/menus/toolsMenu";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void>): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  include(haystack: readonly string[], needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P0-T24]";
const MAIN_WINDOW_FTL = fluentResourceId("mainWindow");
const PLUGIN_L10N_SOURCE = "zotero-plugins";
const LOCALE_PREF = "intl.locale.requested";
const TOOLS_POPUP_ID = "menu_ToolsPopup";
const TOOLS_TARGET = "main/menubar/tools";
const STEP_TIMEOUT_MS = 20_000;

/** The expected values, copied from the two `.ftl` files by hand. */
const EN = {
  root: "Research Helper",
  spike: "Create spike item (P0-T10)",
} as const;
const KO = { root: "리서치 헬퍼" } as const;

interface MenuLabels {
  readonly root: string | undefined;
  readonly spike: string | undefined;
}

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
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

function pluginInitialized(): boolean {
  const instance = (
    Zotero as unknown as Record<
      string,
      { data?: { initialized?: boolean } } | undefined
    >
  )[config.addonInstance];
  return instance?.data?.initialized === true;
}

/** A `Localization` over the main-window bundle, pinned to `locales`. */
function pinnedLocalization(locales: string[]): Localization {
  return new Localization(
    [MAIN_WINDOW_FTL],
    false,
    L10nRegistry.getInstance(),
    locales,
  );
}

/** Both menu labels through `formatter`, via `src/i18n/ftl.ts`. */
async function labelsFrom(formatter: FluentFormatter): Promise<MenuLabels> {
  return {
    root: await formatAttribute(formatter, L10N_MENU_ROOT, "label"),
    spike: await formatAttribute(
      formatter,
      L10N_MENU_SPIKE_CREATE_ITEM,
      "label",
    ),
  };
}

function show(labels: MenuLabels): string {
  return JSON.stringify(labels);
}

function idle(win: _ZoteroTypes.MainWindow): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

/**
 * The labels the Tools menu actually carries, built the way Zotero builds it
 * on `popupshowing` (`lifecycle.spec.ts` explains the event pairing and the
 * idle wait), after asking the window's own `document.l10n` to translate the
 * two elements so the read does not race the async DOM localization.
 */
async function toolsMenuLabels(
  win: _ZoteroTypes.MainWindow,
): Promise<MenuLabels> {
  const doc = win.document;
  const popup = doc.getElementById(TOOLS_POPUP_ID) as XULPopupElement | null;
  if (!popup) {
    assert.fail(`#${TOOLS_POPUP_ID} not found in the main window`);
  }
  Zotero.MenuManager.updateMenuPopup(popup, TOOLS_TARGET, {
    tabType: "library",
  });
  const menu = Array.from(popup.children).find(
    (el) =>
      el.classList.contains("zotero-custom-menu-item") &&
      el.getAttribute("data-l10n-id") === L10N_MENU_ROOT,
  );
  if (!menu) {
    popup.dispatchEvent(new win.Event("popuphidden"));
    assert.fail("the Research Helper submenu is not in the Tools popup");
  }
  const submenu = menu.querySelector(":scope > menupopup");
  submenu?.dispatchEvent(new win.Event("popupshowing"));
  const item = submenu
    ? Array.from(submenu.children).find(
        (el) => el.getAttribute("data-l10n-id") === L10N_MENU_SPIKE_CREATE_ITEM,
      )
    : undefined;

  const l10n = doc.l10n;
  if (!l10n) {
    assert.fail("the main window has no document.l10n");
  }
  await l10n.translateElements(item ? [menu, item] : [menu]);
  const labels: MenuLabels = {
    root: menu.getAttribute("label") ?? undefined,
    spike: item?.getAttribute("label") ?? undefined,
  };

  submenu?.dispatchEvent(new win.Event("popuphidden"));
  popup.dispatchEvent(new win.Event("popuphidden"));
  await idle(win);
  return labels;
}

/**
 * Request `locales` as the UI locale and wait until the negotiated app locale
 * chain leads with the first of them.
 */
async function requestUILocale(locales: string[]): Promise<void> {
  Services.locale.requestedLocales = locales;
  await waitUntil(
    () => Services.locale.appLocalesAsBCP47[0] === locales[0],
    `app locales to lead with ${locales[0]}`,
  );
  // The windows' DOM localizations re-translate on intl:app-locales-changed;
  // let that settle before anything is read.
  await idle(Zotero.getMainWindow());
  log(
    `requested ${JSON.stringify(Services.locale.requestedLocales)} -> app ` +
      `${JSON.stringify(Services.locale.appLocalesAsBCP47)}`,
  );
}

/** Every read a Korean or English UI must agree on, in one place. */
async function readUnderCurrentLocale(): Promise<{
  unpinned: MenuLabels;
  document: MenuLabels;
  menu: MenuLabels;
}> {
  const win = Zotero.getMainWindow();
  const docL10n = win.document.l10n;
  if (!docL10n) {
    assert.fail("the main window has no document.l10n");
  }
  const result = {
    // What the plugin sandbox writes: no registry, no locale list.
    unpinned: await labelsFrom(new Localization([MAIN_WINDOW_FTL])),
    document: await labelsFrom(docL10n),
    menu: await toolsMenuLabels(win),
  };
  log(
    `unpinned Localization ${show(result.unpinned)}; document.l10n ` +
      `${show(result.document)}; Tools menu ${show(result.menu)}`,
  );
  return result;
}

describe("localization (FR-55, V-17)", function () {
  const original = {
    hadUserValue: false,
    requested: "",
    appLocales: [] as string[],
  };

  before(async function () {
    await waitUntil(
      pluginInitialized,
      `Zotero.${config.addonInstance}.data.initialized`,
    );
    original.hadUserValue = Services.prefs.prefHasUserValue(LOCALE_PREF);
    original.requested = Services.prefs.getCharPref(LOCALE_PREF, "");
    original.appLocales = [...Services.locale.appLocalesAsBCP47];
    log(
      `Zotero ${Zotero.version}, Gecko ${Services.appinfo.platformVersion}, ` +
        `Zotero.locale ${Zotero.locale}; ${LOCALE_PREF} ` +
        `${original.hadUserValue ? JSON.stringify(original.requested) : "(default)"}; ` +
        `app locales ${JSON.stringify(original.appLocales)}; ` +
        `ko-KR available ${String(Services.locale.availableLocales.includes("ko-KR"))}`,
    );
  });

  after(async function () {
    // Put the runner profile's UI locale back exactly as it was.
    if (original.hadUserValue) {
      Services.prefs.setCharPref(LOCALE_PREF, original.requested);
    } else {
      Services.prefs.clearUserPref(LOCALE_PREF);
    }
    await waitUntil(
      () =>
        JSON.stringify(Services.locale.appLocalesAsBCP47) ===
        JSON.stringify(original.appLocales),
      "app locales to return to their original value",
    );
    log(
      `restored ${LOCALE_PREF} (user value ` +
        `${String(Services.prefs.prefHasUserValue(LOCALE_PREF))}); app ` +
        `${JSON.stringify(Services.locale.appLocalesAsBCP47)}`,
    );
  });

  it("registers the plugin's bundles in Zotero's shared source for ko-KR", async function () {
    assert.strictEqual(MAIN_WINDOW_FTL, `${FLUENT_PREFIX}mainWindow.ftl`);
    assert.strictEqual(MAIN_WINDOW_FTL, "research-helper-mainWindow.ftl");
    assert.include(
      Services.locale.availableLocales,
      "ko-KR",
      "Zotero ships ko-KR as a UI locale",
    );
    assert.isTrue(
      L10nRegistry.getInstance().hasSource(PLUGIN_L10N_SOURCE),
      `L10nRegistry has the "${PLUGIN_L10N_SOURCE}" source`,
    );
  });

  it("resolves en-US completely and ko-KR without the deliberately missing key", async function () {
    const en = await labelsFrom(pinnedLocalization(["en-US"]));
    const koOnly = await labelsFrom(pinnedLocalization(["ko-KR"]));
    log(`pinned ["en-US"] ${show(en)}`);
    log(`pinned ["ko-KR"] ${show(koOnly)}`);

    assert.deepEqual(en, { root: EN.root, spike: EN.spike }, "en-US bundle");
    assert.deepEqual(
      koOnly,
      { root: KO.root, spike: undefined },
      "ko-KR bundle alone: Korean root, and the spike key really is absent",
    );
  });

  it("falls back to English per message along a ko-KR, en-US chain", async function () {
    const chain = await labelsFrom(pinnedLocalization(["ko-KR", "en-US"]));
    log(`pinned ["ko-KR","en-US"] ${show(chain)}`);
    assert.deepEqual(chain, { root: KO.root, spike: EN.spike });
    assert.notStrictEqual(chain.spike, L10N_MENU_SPIKE_CREATE_ITEM);
  });

  it("renders the Tools menu from Fluent with the UI locale set to en-US", async function () {
    await requestUILocale(["en-US"]);
    const read = await readUnderCurrentLocale();
    const expected = { root: EN.root, spike: EN.spike };
    assert.deepEqual(read.menu, expected, "Tools menu labels");
    assert.deepEqual(read.document, expected, "main window document.l10n");
    assert.deepEqual(read.unpinned, expected, "unpinned Localization");
  });

  it("renders Korean, with English for the missing key, with the UI locale set to ko-KR", async function () {
    await requestUILocale(["ko-KR"]);
    assert.deepEqual(
      [...Services.locale.appLocalesAsBCP47].slice(-1),
      ["en-US"],
      "Gecko keeps en-US as the last fallback of a Korean UI",
    );
    const read = await readUnderCurrentLocale();
    const expected = { root: KO.root, spike: EN.spike };
    assert.deepEqual(read.menu, expected, "Tools menu labels");
    assert.deepEqual(read.document, expected, "main window document.l10n");
    assert.deepEqual(read.unpinned, expected, "unpinned Localization");
    for (const label of Object.values(read.menu)) {
      assert.notStrictEqual(label, L10N_MENU_ROOT, "not a raw identifier");
      assert.notStrictEqual(
        label,
        L10N_MENU_SPIKE_CREATE_ITEM,
        "not a raw identifier",
      );
    }
  });
});

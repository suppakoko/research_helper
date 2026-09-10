/**
 * Bootstrapped plugin entry point (docs/01 §2.3, §2.5).
 *
 * Adapted from the Zotero team's Make It Red example and the Zotero 7
 * developer documentation, by way of windingwind/zotero-plugin-template
 * (main @ 306d4e2, 2025-12-16).
 *
 * All six hooks are plain top-level functions, not exports — the plugin
 * sandbox looks them up by name (docs/01 §2.3). This file stays tiny and does
 * nothing but register the chrome namespace, load the bundle, and dispatch
 * into `src/hooks.ts`; every decision about *what* to register and *when*
 * lives there and in `src/bootstrap/registerUI.ts`.
 *
 * Deliberately Zotero 10 only. There is no Zotero 6 compatibility shim: the
 * `Services.prefs.getDefaultBranch` loop some tutorials still show is a
 * Zotero 6 fallback, and Zotero 7+ loads addon/prefs.js by itself
 * (docs/01 §7.2). Verified 2026-09-10 that the upstream template carries no
 * such shim either.
 *
 * Placeholders (`__addonRef__`, `__addonInstance__`) are substituted at build
 * time by zotero-plugin-scaffold from `build.define` in
 * zotero-plugin.config.ts.
 */

var chromeHandle;

/**
 * Deliberately empty. Zotero 7+ loads `addon/prefs.js` defaults on install by
 * itself (docs/01 §7.2), and the plugin creates no storage until something
 * asks it to, so there is nothing to do on first install.
 */
function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  /**
   * The plugin sandbox's global root. Anything assigned to it is globally
   * accessible inside the bundle. See src/index.ts.
   *
   * The privileged globals are passed in explicitly. `loadSubScript` runs the
   * bundle with `ctx` as its global, so a bare `Zotero` inside src/ resolves
   * to what we put here and nothing else. Zotero 7+ makes these available in
   * the bootstrap scope automatically (docs/01 §3), so forwarding them costs
   * nothing.
   *
   * The upstream template instead pulled `Zotero` in through the toolkit's
   * `BasicTool.getGlobal()`. We do not, because P0-T02 fix 8 (docs/01 §4.6
   * item 8) keeps the toolkit to DialogHelper, VirtualizedTableHelper,
   * FilePickerHelper, ClipboardHelper, KeyboardManager and unregisterAll() —
   * `BasicTool` is not on that list, and reaching for it here would make the
   * composition root depend on the toolkit merely to see `Zotero`.
   *
   * **Verified 2026-09-10** (`P0-T08` and `P0-T09`): the bundle loads, a bare
   * `Zotero` inside src/ resolves, and `Zotero.debug()` called from
   * `src/hooks.ts` reaches Debug Output. `BasicTool` is not needed.
   *
   * The five names here are not the whole story, because `loadSubScript` gives
   * the bundle `ctx` as its global *and* leaves the sandbox's own globals
   * reachable. Measured on Zotero 10.0.1: `setTimeout`, `clearTimeout`,
   * `setInterval`, `clearInterval`, `fetch`, `TextDecoder`, `TextEncoder`,
   * `URL`, `URLSearchParams`, `btoa`, `crypto`, `Blob`, `FileReader`,
   * `XMLHttpRequest`, `DOMParser`, `IOUtils`, `PathUtils` and `dump` all
   * exist; `AbortController`, `structuredClone`, `queueMicrotask`, `console`
   * and `performance` **do not**. Full table and consequences in docs/01 §2.3.
   * Widen `ctx` here if src/ ever needs something the sandbox lacks — do not
   * reintroduce `BasicTool`.
   */
  const ctx = { rootURI, Zotero, Services, Components, ChromeUtils };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    // No slash between the two: `rootURI` already ends with one. Measured
    // 2026-09-10 (P0-T09) from the dev profile's extensions.json, where an
    // installed XPI gives
    //   rootURI = "jar:file:///.../research-helper@suppakoko.github.io.xpi!/"
    // The doubled form worked, because Gecko's jar: resolver tolerates `!//`,
    // but lines 38 and 40 above already concatenate without a slash and the
    // file should not carry two conventions. docs/01 §2.5 and §4.4 disagreed
    // on this; §2.5 (no slash) is the one that matches reality.
    `${rootURI}content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

/**
 * Window-scoped setup. Fires for every main window, including ones opened
 * after startup, and again when a closed window is reopened (docs/01 §2.4).
 * `?.` because a window can load before `startup()` has finished installing
 * the plugin object.
 */
async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  // Zotero is closing anyway; every window is going away and every observer
  // dies with the process, so unwinding is wasted work that can throw against
  // already-torn-down windows (docs/01 §2.3). This is the ONLY reason that
  // skips teardown: ADDON_DISABLE, ADDON_UNINSTALL and ADDON_UPGRADE all
  // leave Zotero running and must clean up fully (docs/01 §12 gotcha 11).
  if (reason === APP_SHUTDOWN) {
    return;
  }

  try {
    await Zotero.__addonInstance__?.hooks.onShutdown();
  } catch (error) {
    // Logged rather than propagated, so a failure inside the plugin's own
    // teardown cannot also strand the chrome registration below. The message
    // lands in Debug Output, which is where P0-T11 looks for it.
    Zotero.debug(`[__addonRef__] shutdown hook threw: ${error}`);
  } finally {
    if (chromeHandle) {
      chromeHandle.destruct();
      chromeHandle = null;
    }
  }
}

/**
 * Deliberately empty, and that is FR-56's second acceptance criterion: items,
 * collections and notes the plugin created are ordinary Zotero data and must
 * survive uninstall untouched. Preferences are removed by Zotero itself.
 */
async function uninstall(data, reason) {}

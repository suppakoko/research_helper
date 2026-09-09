/**
 * Bootstrapped plugin entry point (docs/01 §3).
 *
 * Adapted from the Zotero team's Make It Red example and the Zotero 7
 * developer documentation, by way of windingwind/zotero-plugin-template
 * (main @ 306d4e2, 2025-12-16).
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
   */
  const ctx = { rootURI, Zotero, Services, Components, ChromeUtils };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}

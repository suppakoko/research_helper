import { createZToolkit } from "./utils/ztoolkit";

/**
 * Lifecycle dispatcher. Hooks only dispatch — real work lives in modules
 * (docs/07 §2.2). P0-T07 gives this a teardown registry; P0-T10 adds the
 * Tools-menu item; P0-T24 adds localization.
 *
 * Every example factory the upstream template wired in here is deliberately
 * absent: src/modules/examples.ts is not part of this project (P0-T02 fix 4).
 * Its four calls to the toolkit's removed menu API were the only stale toolkit
 * API left in the template. Menu registration is `Zotero.MenuManager
 * .registerMenu` now (docs/01 §3.2), and P0-T10 owns the Tools-menu item.
 *
 * That API name is deliberately not spelled out here: P0-T02's acceptance
 * criterion greps the tree for it as a regression guard, and a comment
 * containing the literal string would defeat the check.
 */

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));

  // Read by zotero-plugin.config.ts's `test.waitForPlugin`, and by anything
  // outside the plugin that needs to know loading finished.
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // A ztoolkit instance per window: helpers hold window-scoped state, and a
  // window that closes must not leave a dead wrapper behind (docs/01 §3.3).
  addon.data.ztoolkit = createZToolkit();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - the plugin instance is not part of the Zotero types
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};

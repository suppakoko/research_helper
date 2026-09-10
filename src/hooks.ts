import { registerUI, registerWindowUI } from "./bootstrap/registerUI";
import { createZToolkit } from "./utils/ztoolkit";

/**
 * Lifecycle dispatcher (`P0-T07`). Hooks only dispatch — real work lives in
 * modules (`docs/07` §2.2), and every registration goes through the scope
 * `src/addon.ts` owns, so teardown is structural rather than remembered
 * (`FR-56`).
 *
 * The `docs/01` §2.4 split is enforced by which scope each hook is handed:
 * `onStartup` registers into the root scope, `onMainWindowLoad` registers
 * into a child scope keyed on the window and does not have the root one in
 * hand. `onMainWindowUnload` disposes exactly that child, and
 * `onShutdown` disposes the root, children included.
 *
 * Every example factory the upstream template wired in here is deliberately
 * absent: src/modules/examples.ts is not part of this project (P0-T02 fix 4).
 * Its four calls to the toolkit's removed menu API were the only stale toolkit
 * API left in the template. Menu registration is native and application-scoped
 * now (docs/01 §3.2), and P0-T10 owns the Tools-menu item.
 *
 * That API name is deliberately not spelled out here: P0-T02's acceptance
 * criterion greps the tree for it as a regression guard, and a comment
 * containing the literal string would defeat the check.
 */

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // The barrier above can take seconds, and the user can disable the plugin
  // inside that window. Registering after `onShutdown` has already run would
  // leak everything registered from here on; the scope would throw on the
  // first `use()`, but returning quietly is the correct behaviour, not an
  // exception in the debug log (FR-56).
  if (!addon.data.alive) {
    return;
  }

  // Application-scoped first, then existing windows, so a plugin enabled
  // mid-session catches up on windows that are already open (docs/01 §2.4).
  await registerUI(addon.scope);

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Read by zotero-plugin.config.ts's `test.waitForPlugin`, and by anything
  // outside the plugin that needs to know loading finished.
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  if (!addon.data.alive) {
    return;
  }

  // `child()` tears down any scope already open for this window before
  // returning a new one, so a duplicated onMainWindowLoad — the failure mode
  // P0-T11 cycles disable/enable looking for — cannot produce a duplicated
  // registration.
  const scope = await addon.scope.child(win, "main window");

  // A ztoolkit instance per window: helpers hold window-scoped state, and a
  // window that closes must not leave a dead wrapper behind (docs/01 §3.3).
  // The instance is captured rather than read back off `addon.data`, because
  // by teardown time `addon.data.ztoolkit` may belong to a different window.
  const windowToolkit = createZToolkit();
  addon.data.ztoolkit = windowToolkit;
  scope.defer("window-scoped toolkit helpers", () => {
    windowToolkit.unregisterAll();
  });

  await registerWindowUI(scope, win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  // Keyed on the window object itself, so closing one window cannot tear down
  // another's registrations.
  await addon.scope.disposeChild(win);
}

async function onShutdown(): Promise<void> {
  // Set first: it closes the door on any registration still in flight behind
  // an await in onStartup.
  addon.data.alive = false;

  // The single teardown call site (P0-T07). Children — the per-window scopes
  // — go first, then application-scoped registrations in reverse order.
  await addon.scope.unregisterAll();

  // Belt and braces for anything the toolkit registered outside a scope. The
  // per-window instances have already been torn down by their own scopes;
  // unregisterAll() is idempotent, so the double call is harmless.
  ztoolkit.unregisterAll();

  reportSurvivors();

  addon.data.initialized = false;

  // @ts-expect-error - the plugin instance is not part of the Zotero types
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * The development tripwire for `FR-56`: after teardown, say loudly what is
 * still standing.
 *
 * Two independent checks, because they catch different mistakes.
 *
 * 1. `scope.liveHandles()` catches a teardown that threw or did not run. It
 *    is the check `P0-T11` reads ("the registry should be able to report zero
 *    live handles after `unregisterAll()`").
 * 2. `Zotero.PreferencePanes.pluginPanes` catches the opposite mistake — a
 *    registration made *without* going through the scope, which by definition
 *    the registry cannot know about. It is the only one of the plugin-facing
 *    manager APIs that exposes its registrations for inspection;
 *    `Zotero.MenuManager` and `Zotero.Notifier` do not, so there is no
 *    equivalent audit for those and `P0-T11`'s manual cycling remains the
 *    check for them.
 *
 * `Zotero.PreferencePanes.pluginPanes` is **readable on Zotero 10.0.1** — verified
 * 2026-09-10 (`P0-T08`) across five hot-reload cycles, each of which ran this
 * function: the audit never threw, so the `catch` branch below never logged.
 * The read stays wrapped anyway. It is cheap, and an audit that throws must not
 * become the error `FR-56` says the log should not contain.
 *
 * > **Still unverified:** that it is *populated* for this plugin. Nothing here
 * > registers a preference pane yet, so a passing audit currently proves only
 * > that the property exists and enumerates. `P0-T09` registers the first pane
 * > and is where the audit starts having something to find.
 */
function reportSurvivors(): void {
  const survivors = addon.scope.liveHandles();
  if (survivors.length > 0) {
    Zotero.debug(
      `[${addon.data.config.addonName}] FR-56: ${survivors.length} registration(s) ` +
        `survived teardown: ${survivors.join(", ")}`,
    );
  }

  try {
    const panes = Zotero.PreferencePanes.pluginPanes.filter(
      (pane) => pane.pluginID === addon.data.config.addonID,
    );
    if (panes.length > 0) {
      Zotero.debug(
        `[${addon.data.config.addonName}] FR-56: ${panes.length} preference pane(s) ` +
          `outlived teardown, so they were registered without going through the scope.`,
      );
    }
  } catch (error) {
    Zotero.debug(
      `[${addon.data.config.addonName}] preference-pane audit unavailable: ${String(error)}`,
    );
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};

/**
 * Where every registration this plugin makes is listed (`P0-T07`).
 *
 * `docs/07` §2.2 gives this file the job of registering "menus, panes, prefs
 * pane, notifier hooks". `docs/01` §2.4 splits that job in two and the split
 * is not a matter of taste:
 *
 * - **Application-scoped** — `Zotero.PreferencePanes.register`,
 *   `Zotero.MenuManager.registerMenu`, `Zotero.Notifier.registerObserver`,
 *   pref observers, timers. Registered once in `startup`, undone in
 *   `shutdown`. They go in `APP_REGISTRATIONS`.
 * - **Window-scoped** — anything holding a `window`, `document` or `Node`.
 *   Registered per window in `onMainWindowLoad`, undone in
 *   `onMainWindowUnload`. They go in `WINDOW_REGISTRATIONS`.
 *
 * Putting a window-scoped thing in the first list leaks a window per close
 * (`docs/01` §12 gotcha 8), which is why the two lists take different types:
 * a window-scoped entry is a function *of* the window, so it cannot be
 * written without one and cannot be dropped into the app-scoped list.
 *
 * **Both lists are empty on purpose.** `P0-T07` builds the mechanism;
 * `P0-T10` adds the first real entry (the Tools-menu item) and `P0-T09` the
 * preference pane. The shape a later card must produce is fixed here: a
 * `ScopedRegistration` built by `registration({ description, register,
 * unregister })`, which does not compile without its `unregister`.
 *
 * Note what this file does *not* contain: any `Zotero.*` call.
 * `eslint.config.js` forbids the `Zotero` global outside `src/zotero/**` and
 * the three lifecycle entry files, so the `register`/`unregister` bodies are
 * built in `src/zotero/` (`P0-T10` creates `src/zotero/zoteroApi.ts`) and
 * merely *listed* here. That is the point: composition is separate from the
 * platform call, and the only way to get a platform call executed at startup
 * is to put a fully-specified `Registration` in one of these two arrays.
 */

import type { ScopedRegistration, Scope } from "./container";

/**
 * A window-scoped registration, which cannot be built without the window it
 * belongs to.
 */
export type WindowRegistration = (
  win: _ZoteroTypes.MainWindow,
) => ScopedRegistration;

/** Registered in `startup`, torn down in `shutdown`. */
const APP_REGISTRATIONS: readonly ScopedRegistration[] = [];

/** Registered per main window, torn down when that window closes. */
const WINDOW_REGISTRATIONS: readonly WindowRegistration[] = [];

/**
 * Run the application-scoped registrations into the root scope.
 *
 * Sequential rather than `Promise.all`: teardown is last-in-first-out, so a
 * deterministic registration order gives a deterministic teardown order, and
 * a registration that fails does not leave later ones half-applied behind it.
 */
export async function registerUI(scope: Scope): Promise<void> {
  for (const register of APP_REGISTRATIONS) {
    await register(scope);
  }
}

/** Run the window-scoped registrations into one window's child scope. */
export async function registerWindowUI(
  scope: Scope,
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  for (const register of WINDOW_REGISTRATIONS) {
    await register(win)(scope);
  }
}

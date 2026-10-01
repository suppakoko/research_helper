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
 * `P0-T07` built the mechanism with both lists empty; `P0-T10` adds the first
 * real entry — the Tools-menu item — and `P0-T09` will add the preference
 * pane. The shape is fixed here: a `ScopedRegistration` built by
 * `registration({ description, register, unregister })`, which does not
 * compile without its `unregister`.
 *
 * Note what this file does *not* contain: any `Zotero.*` call.
 * `eslint.config.js` forbids the `Zotero` global outside `src/zotero/**` and
 * the three lifecycle entry files, so the `register`/`unregister` bodies are
 * built in `src/zotero/` and merely *listed* here. That is the point:
 * composition is separate from the platform call, and the only way to get a
 * platform call executed at startup is to put a fully-specified
 * `Registration` in one of these two arrays.
 *
 * **This file is the composition root's only three-way junction.** It is the
 * one place allowed to import from `src/ui/` *and* `src/zotero/` at once:
 * `docs/07` §2.3 forbids `src/ui/**` from importing `src/zotero/**`, so the
 * menu's shape (`src/ui/menus/toolsMenu.ts`) and the platform call that
 * installs it (`src/zotero/registrations.ts`) can only meet here. `src/ui/`
 * therefore never learns what a Zotero menu registration is, and
 * `src/zotero/` never learns what this plugin's menus look like.
 *
 * ## It also chooses the platform halves of the object graph (`P1-T25`)
 *
 * `installServices()` in `./container.ts` does the wiring; this file chooses
 * the implementations, for two reasons. `registerUI()` is the one function
 * `src/hooks.ts` already hands the **root scope** at startup — and `hooks.ts`
 * is not in `P1-T25`'s `Files` list — so it is the only place a
 * startup-scoped construction can be hooked without touching a path this card
 * does not own. And this file is already the junction that may name
 * `src/zotero/`, which is where `createZoteroHttpTransport()` and
 * `createZoteroPrefStore()` live.
 *
 * Services are installed **before** `APP_REGISTRATIONS`, because a menu
 * handler may issue a request the moment the item exists; teardown is
 * last-in-first-out, so the menu item is removed first and the services come
 * down last.
 *
 * **This file was extended, not replaced** (`plan/README.md` §4, corrected
 * 2026-09-30): `src/hooks.ts` imports both `registerUI` and
 * `registerWindowUI` and is outside `P1-T25`'s `Files` list, so both
 * signatures are unchanged.
 */

import { config, version } from "../../package.json";
import {
  installServices,
  type ScopedRegistration,
  type Scope,
} from "./container";
import type { LogSink } from "../core/logger";
import {
  L10N_MENU_ROOT,
  TOOLS_MENU_DESCRIPTION,
  toolsMenuOptions,
} from "../ui/menus/toolsMenu";
import { createZoteroPrefStore } from "../zotero/prefStore";
import {
  fluentResourceRegistration,
  menuRegistration,
} from "../zotero/registrations";
import {
  createSpikeArticle,
  createZoteroHttpTransport,
  debug,
  reportError,
} from "../zotero/zoteroApi";

/**
 * A window-scoped registration, which cannot be built without the window it
 * belongs to.
 */
export type WindowRegistration = (
  win: _ZoteroTypes.MainWindow,
) => ScopedRegistration;

/**
 * Registered in `startup`, torn down in `shutdown`.
 *
 * The Tools-menu item is application-scoped, not window-scoped: `docs/01`
 * §2.4 and `docs/08` §2.4 both say to register menus once in `startup`, and
 * Zotero 10's `MenuManager` propagates a registration to every open window and
 * removes the elements again on unregister.
 *
 * `menuRegistration()` and `toolsMenuOptions()` both run at module-evaluation
 * time and neither touches the platform: the first returns a closure, the
 * second a plain object. Nothing reaches `Zotero.MenuManager` until
 * `registerUI()` feeds this array to a live `Scope`.
 */
const APP_REGISTRATIONS: readonly ScopedRegistration[] = [
  menuRegistration(
    TOOLS_MENU_DESCRIPTION,
    toolsMenuOptions({ createSpikeArticle, onError: reportError }),
  ),
];

/**
 * The main-window Fluent resource id (`docs/08` §10.1's `mainWindow` surface).
 *
 * Flat and plugin-prefixed, because Zotero 10.0.1's `registerLocales()` drops
 * subdirectories under `locale/<locale>/` and registers every plugin's bundle
 * in one shared `zotero-plugins:{locale}/<filename>` namespace (`docs/01`
 * §9.1). The prefix is `config.addonRef` rather than a second literal, and
 * `zotero-plugin.config.ts` turns scaffold's `prefixLocaleFiles` off, so the
 * built file keeps its source name, `addon/locale/<locale>/` +
 * `${addonRef}-mainWindow.ftl`. `fluentResourceRegistration` then asserts the
 * name at runtime by resolving a real message out of it: a mismatch throws
 * instead of rendering blank labels.
 */
const MAIN_WINDOW_FTL = `${config.addonRef}-mainWindow.ftl`;

/**
 * Registered per main window, torn down when that window closes.
 *
 * The Fluent bundle is first: `docs/08` §10.1 wants it in the window before
 * any plugin DOM is, and teardown runs last-in-first-out, so it is also the
 * last thing removed.
 */
const WINDOW_REGISTRATIONS: readonly WindowRegistration[] = [
  (win) =>
    fluentResourceRegistration("main-window Fluent bundle", win, {
      resourceId: MAIN_WINDOW_FTL,
      probeMessageId: L10N_MENU_ROOT,
    }),
];

/**
 * `src/core/logger.ts`'s sink over Help → Debug Output Logging.
 *
 * Built here rather than in `src/zotero/` because this card may not touch
 * `src/zotero/zoteroApi.ts`, and `debug()` is already exported from it. Two
 * consequences are reported rather than coded around (`P1-T25` report):
 *
 * - **The Zotero level is dropped.** `LogSink.write` is documented as "pass it
 *   straight through as `Zotero.debug`'s second argument", and
 *   `zoteroApi.debug()` takes no second argument, so every line lands at
 *   Zotero's default level 3. Threading the level through needs a signature
 *   change in a file no card's `Files` list names for this purpose.
 * - **There is no `reportError` channel**, so an `error()` line does not reach
 *   `Zotero.logError()` / `Zotero.getErrors()` (`docs/07` §10.3). `logError`
 *   has no facade in `src/zotero/` at all.
 *
 * `createLogger` already prefixes `[research_helper]` and `debug()` prefixes
 * `[research-helper]`, so a line carries both. Harmless and greppable, but the
 * two prefixes differ by a character and only one of them is `config.addonRef`.
 */
const ZOTERO_DEBUG_SINK: LogSink = {
  write(line: string): void {
    debug(line);
  },
};

/**
 * Run the composition root, then the application-scoped registrations, into
 * the root scope.
 *
 * Sequential rather than `Promise.all`: teardown is last-in-first-out, so a
 * deterministic registration order gives a deterministic teardown order, and
 * a registration that fails does not leave later ones half-applied behind it.
 *
 * The {@link import("./container").ServiceGraph} is deliberately **not** held
 * anywhere. Three of its four services are already reachable through the
 * process-wide accessors their own modules export (`httpRequest()`,
 * `getHostLimiters()`, `getPref()`), nothing in Phase 1 yet has a pipeline to
 * hand the fourth to, and the typed service locator is `P1-T16` step 7's — it
 * `create`s this path for that. Standing up a holder with no consumer is the
 * dead code `P0-T07` declined to write for the same reason.
 */
export async function registerUI(scope: Scope): Promise<void> {
  await installServices(scope, {
    transport: createZoteroHttpTransport(),
    prefs: createZoteroPrefStore(),
    version,
    // Not a Fluent lookup: `ZoteroProgressWindowSink` needs an
    // already-localized string, Fluent is async and per-window, and
    // `src/i18n/keys.ts` declares **no message id for a progress headline** at
    // all. The product name is the honest placeholder — it is a brand name
    // rather than a translatable sentence — and the missing id is reported as
    // needing a card.
    progressHeadline: config.addonName,
    logSink: ZOTERO_DEBUG_SINK,
  });

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

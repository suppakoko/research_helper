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
 * menu's shape (`src/ui/menus/toolsMenu.ts`, `src/ui/menus/registerMenus.ts`)
 * and the platform call that installs it (`src/zotero/registrations.ts`) can
 * only meet here. `src/ui/` therefore never learns what a Zotero menu
 * registration is, and `src/zotero/` never learns what this plugin's menus
 * look like.
 *
 * ## It composes Phase 1's two menu entry points (`P1-T19`)
 *
 * The Tools ▸ Research Helper ▸ Search & Import… entry and the collection
 * context-menu entry are described in `src/ui/menus/registerMenus.ts` and
 * registered from {@link APP_REGISTRATIONS} below. Their one command —
 * `openSearchWindow` from `src/ui/dialogs/searchDialog.ts` — is injected here
 * for the same reason `createSpikeArticle` is: the menu knows there is a
 * command, not what a command is made of.
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
  createZoteroLogSink,
  installServices,
  type ProgressHeadlineSource,
  type ScopedRegistration,
  type Scope,
} from "./container";
import { formatValue } from "../i18n/ftl";
import { L10N_PROGRESS_HEADLINE } from "../i18n/keys";
import { openSearchWindow } from "../ui/dialogs/searchDialog";
import {
  COLLECTION_MENU_DESCRIPTION,
  collectionMenuOptions,
  withSearchImportEntry,
  type SearchMenuCommands,
} from "../ui/menus/registerMenus";
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
 * What `src/ui/menus/registerMenus.ts`'s two menus are allowed to do.
 *
 * `openSearchWindow` comes from `src/ui/dialogs/searchDialog.ts` and takes the
 * host window as its first parameter, which the menu handler supplies from the
 * element that was clicked — `src/ui/**` may name neither `Zotero` nor
 * `src/zotero/**`, and the clicked window is the right one anyway when two
 * main windows are open. `reportError` is `src/zotero/zoteroApi.ts`'s helper
 * for a caught exception, so a failed command lands in Debug Output rather
 * than in an unhandled rejection (`FR-56`).
 *
 * **Corrected 2026-10-03 (`P1-T32`).** This paragraph used to call
 * `reportError` "`Zotero.logError` + `Zotero.debug` pair". It is not: it
 * formats the message and the stack and forwards to `debug()`, so it reaches
 * `Zotero.debug` **only** — nothing in `src/zotero/` named `Zotero.logError`
 * at all until this card added the `logError` facade. A failed menu command is
 * therefore in Debug Output but was never in `Zotero.getErrors()`. Widening
 * `reportError`'s destination is a behaviour change to seven integration
 * specs' expectations and is left to a card; the `LogSink` channel below is
 * the one `P1-T32` owns.
 */
const SEARCH_MENU_COMMANDS: SearchMenuCommands = {
  openSearchWindow,
  onError: reportError,
};

/**
 * Registered in `startup`, torn down in `shutdown`.
 *
 * Both menu items are application-scoped, not window-scoped: `docs/01` §2.4
 * and `docs/08` §2.4 both say to register menus once in `startup`, and
 * Zotero 10's `MenuManager` propagates a registration to every open window and
 * removes the elements again on unregister.
 *
 * `menuRegistration()`, `toolsMenuOptions()`, `withSearchImportEntry()` and
 * `collectionMenuOptions()` all run at module-evaluation time and none touches
 * the platform: the first returns a closure, the rest plain objects. Nothing
 * reaches `Zotero.MenuManager` until `registerUI()` feeds this array to a live
 * `Scope`.
 *
 * Two registrations, one per target (`P1-T19`), because `docs/08` §2.3 allows
 * exactly one top-level item per context and
 * `Zotero.MenuManager.registerMenu` takes one target per call. The Tools entry
 * is `./toolsMenu.ts`'s options **extended**
 * with Phase 1's Search & Import command rather than replaced: `P0-T10`'s
 * spike item is asserted by `test/integration/lifecycle.spec.ts` and invoked
 * by `test/integration/zotero/itemCreation.spec.ts`, neither of which is in
 * `P1-T19`'s `Files` list, and a second Tools registration would be a second
 * top-level item (`plan/README.md` §4, corrected 2026-09-30: extend rather
 * than replace when an importer is outside your `Files` list).
 */
const APP_REGISTRATIONS: readonly ScopedRegistration[] = [
  menuRegistration(
    TOOLS_MENU_DESCRIPTION,
    withSearchImportEntry(
      toolsMenuOptions({ createSpikeArticle, onError: reportError }),
      SEARCH_MENU_COMMANDS,
    ),
  ),
  menuRegistration(
    COLLECTION_MENU_DESCRIPTION,
    collectionMenuOptions(SEARCH_MENU_COMMANDS),
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
 * The progress popup's headline, resolved from Fluent at startup (`P1-T32`
 * item 3 and `Do` step 4).
 *
 * **`new Localization([...])` is `docs/08` §10.1's "From JS, no window" row**,
 * and `test/integration/l10n.spec.ts` layer 5 reads an unpinned one as "the
 * form the plugin sandbox uses". It is the only route available here:
 * `Zotero.getString()` *throws* on a plugin key under an `en-US` locale
 * (`docs/08` §8.2.1) because a plugin's `.ftl` lives in `L10nRegistry` and not
 * in that synchronous bundle, and `document.l10n` needs a window the
 * application-scoped graph does not have.
 *
 * A `Localization` is built per lookup rather than kept, because this is one
 * lookup for the life of the plugin and a cached one would pin the locale
 * chain as it stood at startup.
 *
 * **What is still unresolved, and is reported rather than papered over:** this
 * runs inside `startup`, and nothing in the corpus states whether Zotero's own
 * `registerLocales()` has contributed this plugin's bundle to the
 * `zotero-plugins` `L10nFileSource` by then. If it has not, `resolve()` yields
 * `undefined`, `installServices` logs a `warn` naming the id, and the popup
 * carries {@link ProgressHeadlineSource.fallback} — which is the same string
 * the user saw before this card, with the difference that the substitution is
 * now in the debug log a bug report carries instead of in a code comment.
 */
const PROGRESS_HEADLINE: ProgressHeadlineSource = {
  messageId: L10N_PROGRESS_HEADLINE,
  async resolve(): Promise<string | undefined> {
    return formatValue(
      new Localization([MAIN_WINDOW_FTL]),
      L10N_PROGRESS_HEADLINE,
    );
  },
  // `config.addonName`, which is what `P1-T25` passed unconditionally and what
  // the en-US bundle's text is anyway. It is a fallback now rather than the
  // headline: reaching it is logged.
  fallback: config.addonName,
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
    // A Fluent lookup since `P1-T32`, awaited once by `installServices`:
    // `ZoteroProgressWindowSink` needs an already-localized string and the
    // factory that builds it is synchronous, so the resolution has to happen
    // here. See {@link PROGRESS_HEADLINE} for why `new Localization([...])` is
    // the only route from an application-scoped startup, and for what happens
    // when it resolves nothing.
    progressHeadline: PROGRESS_HEADLINE,
    // Both channels of `docs/07` §10.3, and one prefix. The lossy sink
    // `P1-T25` had to build here — no level, no `reportError` — is gone; the
    // real one is `container.ts`'s, over `zoteroApi.ts`'s two facades.
    logSink: createZoteroLogSink(),
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

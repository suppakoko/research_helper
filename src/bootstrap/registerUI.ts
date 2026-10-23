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
  type ServiceGraph,
} from "./container";
import type { Logger } from "../core/logger";
import { formatValue } from "../i18n/ftl";
import { L10N_PROGRESS_HEADLINE } from "../i18n/keys";
import { merge } from "../model/merge";
import type { SourceRecord } from "../model/sourceRecord";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../pipeline/searchImport/types";
import type { Pipeline } from "../pipeline/types";
import { httpRequest } from "../core/http/client";
import { getPref, setPref } from "../prefs";
import { PROVIDER_PREF_NAMES } from "./registerProviders";
import type { PluginDatabase } from "./pluginDatabase";
import { SEMANTICSCHOLAR_KEY_REQUEST_URL } from "../sources/semanticscholar/semanticscholarSource";
import {
  SEARCH_WINDOW_API_PROPERTY,
  openSearchWindow,
  type SearchWindowQuery,
} from "../ui/dialogs/searchDialog";
import {
  openSecretBackendDialog,
  type SecretBackendChoice,
  type SecretBackendDialogHost,
} from "../ui/dialogs/secretBackendDialog";
import {
  USAGE_API_PROPERTY,
  buildCostDialogModel,
  createUsageHost,
  openCostConfirmDialog,
  type CostDialogHost,
  type CostDialogInput,
  type CostDialogOutcome,
  type UsageHostApi,
} from "../ui/dialogs/costConfirmDialog";
import {
  createSessionSpendCounter,
  type SessionSpendCounter,
} from "../pipeline/shared/budget";
import {
  PREFERENCES_API_PROPERTY,
  PREFERENCES_PANE_DESCRIPTION,
  createPreferencesHost,
  preferencePaneOptions,
  type PreferencesHostApi,
} from "../ui/prefs/preferencesPane";
import {
  createSearchImportViewModel,
  type SearchImportViewModelDeps,
  type SearchWindowHostApi,
} from "../ui/viewModels/searchImportViewModel";
import { buildLibraryIndex, type LibraryIndex } from "../zotero/libraryIndex";
import { provenanceFileWriter, writeProvenanceNote } from "../zotero/notes";
import {
  createProvenanceIndex,
  type ProvenanceIndex,
  type ProvenanceStore,
} from "../core/provenance";
import {
  createCacheBlobStore,
  openPluginDatabase,
  pluginDatabasePath,
} from "../zotero/db";
import {
  COLLECTION_MENU_DESCRIPTION,
  collectionMenuOptions,
  withSearchImportEntry,
  type CollectionRunLookup,
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
  preferencePaneRegistration,
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
  // FR-12's "Re-run This Search…" (`P2-T17`), answered from the plugin
  // database once {@link publishProvenanceStore} has published it.
  provenance: {
    hasRunForCollection: (collectionID) => knownRun(collectionID),
    lookupRunForCollection: (collectionID) => lookupRun(collectionID),
  } satisfies CollectionRunLookup,
};

// ---------------------------------------------------------------------------
// FR-12's provenance store (`P2-T17`)
// ---------------------------------------------------------------------------

/**
 * The plugin database's lifecycle state, held for the menu and the view model.
 *
 * `ready` is the startup open-and-migrate, **not awaited by startup**:
 * `docs/10` NFR-10 allows the plugin 200 ms of startup and `P1-T23`'s
 * measurement already runs close to it, so the SQLite open runs alongside the
 * rest of startup and everything that needs the store awaits `ready` instead.
 * It resolves to `undefined` — never rejects — when the database cannot be
 * opened or migrated, which is `P2-T17`'s Notes' degradation: "Re-run This
 * Search…" is absent, never broken.
 */
const provenanceState: {
  index: ProvenanceIndex | undefined;
  ready: Promise<ProvenanceIndex | undefined> | undefined;
} = { index: undefined, ready: undefined };

/**
 * `docs/08` §2.4's `hasRunForCollection`, synchronously, over the index: the
 * cached answer; `undefined` while it is not known yet — including while the
 * database is still opening; `false` when no database was ever started or the
 * id names no collection.
 */
function knownRun(collectionID: number): boolean | undefined {
  const ref = addon.platform.collectionById(collectionID);
  if (ref === undefined) return false;
  const index = provenanceState.index;
  if (index === undefined) {
    return provenanceState.ready === undefined ? false : undefined;
  }
  return index.known(ref.libraryId, ref.key);
}

/** The asynchronous half: wait for the database, ask it, cache the answer. */
async function lookupRun(collectionID: number): Promise<boolean> {
  const ref = addon.platform.collectionById(collectionID);
  const index = await provenanceState.ready;
  if (index === undefined || ref === undefined) return false;
  return index.hasRun(ref.libraryId, ref.key);
}

/**
 * The view model's `provenanceStore`, bound before the database has finished
 * opening: every call waits for {@link provenanceState}'s `ready`.
 *
 * A write with no database throws, so the view model logs the missing row
 * rather than believing it was stored; a read with no database finds nothing,
 * so the window opens unseeded.
 */
const DEFERRED_PROVENANCE_STORE: ProvenanceStore = {
  async putProvenance(record, libraryId, collectionKey, noteKey) {
    const index = await provenanceState.ready;
    if (index === undefined) {
      throw new Error(
        "[research-helper] the plugin database is not available, so the " +
          "run's search_provenance row cannot be written.",
      );
    }
    await index.putProvenance(record, libraryId, collectionKey, noteKey);
  },
  async findProvenanceByCollection(libraryId, collectionKey) {
    const index = await provenanceState.ready;
    return index?.findProvenanceByCollection(libraryId, collectionKey);
  },
};

/**
 * Publish FR-12's store over the plugin database the service graph opened
 * (`P2-T17`), and withdraw it again on shutdown.
 *
 * **The database is no longer opened here** (`P3-T33`; `plan/00` §6 item
 * 249, owner, 2026-10-21). `installServices` opens the one connection through
 * `installPluginDatabase` (`src/bootstrap/pluginDatabase.ts`), shares it with
 * the cache and the job store, attaches the job store and runs the startup
 * recovery, and closes it in the graph's own teardown — which runs after this
 * registration's, because it was registered first. What stays here is what the
 * search window and the menu read: {@link provenanceState}, and
 * `api.provenance` for the integration spec.
 *
 * `docs/07` §8.4: the file is `<Zotero.DataDirectory.dir>/research-helper.sqlite`,
 * resolved by `Zotero.DBConnection` from the name, never a hard-coded path and
 * never Zotero's own `zotero.sqlite`.
 *
 * Teardown waits for an open that is still in flight, so the store is never
 * published after it has been withdrawn.
 */
async function publishProvenanceStore(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: "the plugin database's provenance store (api.provenance)",
    register: () => {
      const ready = graph.database.ready.then(
        (open): ProvenanceIndex | undefined => {
          if (open === undefined) return undefined;
          const index = createProvenanceIndex(open.provenance);
          provenanceState.index = index;
          api.provenance = {
            index,
            database: open.connection,
            path: open.path,
            schemaVersion: open.schemaVersion,
          };
          return index;
        },
      );
      provenanceState.ready = ready;
      // Wrapped, so `scope.use` does not await the open: startup goes on.
      return { ready };
    },
    unregister: async ({ ready }) => {
      await ready;
      delete api.provenance;
      provenanceState.index = undefined;
      provenanceState.ready = undefined;
    },
  });
}

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
  // The preference pane (`P1-T44`). Application-scoped: `docs/01` §2.4 lists
  // `Zotero.PreferencePanes.register` with the once-per-startup registrations,
  // and Zotero propagates it to every open `zotero:pref` window itself. Through
  // `preferencePaneRegistration` so the pane is paired with its unregister and
  // visible to `liveHandles()`; `hooks.ts`'s `reportSurvivors` reads
  // `pluginPanes` after teardown and now has something to find. The literal
  // plugin ID is D9's permanent constant, read from `package.json` as every
  // other registration here reads it.
  preferencePaneRegistration(
    PREFERENCES_PANE_DESCRIPTION,
    preferencePaneOptions(config.addonID),
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

// ---------------------------------------------------------------------------
// The Search & Import window's host (`P1-T35`)
// ---------------------------------------------------------------------------

/**
 * The view model's dependencies, with **every optional member made required**.
 *
 * This is `P1-T35` criterion 4's enumeration, and it is derived from
 * `SearchImportViewModelDeps` by a mapped type rather than written out, so it
 * **cannot go stale**: adding a member to that interface — optional or not —
 * immediately makes {@link searchWindowDeps} fail to satisfy this type, and
 * `npm run typecheck` fails until the new member is wired here. A hand-written
 * list of today's five optional names would have to be remembered; this one is
 * the interface itself.
 *
 * It does **not** change `SearchImportViewModelDeps`' shape (`P1-T35`'s
 * **Do NOT**). The optionality is what lets a unit test build a view model with
 * no platform at all; `Required<…>` is a separate, stricter contract that only
 * the composition root is held to — which is exactly where the card says the
 * fix for silent degradation belongs.
 */
export type SearchWindowDeps = Required<SearchImportViewModelDeps>;

/**
 * The library snapshot {@link SearchWindowDeps.isExisting} reads.
 *
 * `P1-T13` shipped the existing-item check in `src/zotero/libraryIndex.ts`
 * (grepped 2026-10-07: `findExisting` is declared at `libraryIndex.ts:157` and
 * implemented at `:322`; `src/zotero/importer.ts` and
 * `src/bootstrap/registerPipelines.ts` are its only other callers). That check
 * is **synchronous** by design and the snapshot behind it is **async** to
 * build, so the two cannot be bridged inside the port: the index has to exist
 * before the first row is mapped.
 */
let libraryIndex: LibraryIndex | undefined;

/**
 * Rebuild the library snapshot, or leave the last one in place.
 *
 * A failure here must not stop a search: the consequence is that rows are not
 * badged as already present, which is the same degradation the view model
 * documents for an absent `isExisting`, and it is logged rather than silent.
 */
async function refreshLibraryIndex(logger: Logger): Promise<void> {
  try {
    const rebuilt = await buildLibraryIndex();
    libraryIndex = rebuilt;
    logger.debug("library index rebuilt for the search window", {
      doiKeys: rebuilt.byDoi.size,
      pmidKeys: rebuilt.byPmid.size,
      itemsScanned: rebuilt.stats.itemsScanned,
      elapsedMs: rebuilt.stats.elapsedMs,
    });
  } catch (error) {
    logger.warn(
      "the library index could not be rebuilt; result rows will not be " +
        "marked as already present until the next search",
      { reason: error instanceof Error ? error.name : typeof error },
    );
  }
}

/**
 * The `workKey` the pipeline mints for `record` as a group of one, for
 * {@link SearchWindowDeps.isExisting} (`P2-T37`).
 *
 * The window's port hands over a `SourceRecord`, whose `work` carries no key,
 * and `findExisting` without one cannot reach the `hash:` arm — so a row with
 * no DOI, PMID, arXiv id or S2 corpus id was never marked as already in the
 * library (`P2-T16` Part A, defect D1). `merge` of the one record is the same
 * derivation the `Merging` stage applies to a singleton group, so the key is
 * the one the importer wrote as `rh-work-key`, with no second copy of
 * `buildWorkKey`'s inputs here.
 *
 * `undefined` if `merge` refuses the record, which leaves the lookup exactly
 * as it was before this card: a badge is not worth breaking the table over.
 */
function singletonWorkKey(record: SourceRecord): string | undefined {
  try {
    return merge([record], record.retrievedAtEpochMs).work.workKey;
  } catch {
    return undefined;
  }
}

/**
 * Everything the view model needs, with nothing left optional.
 *
 * Each platform member and where it comes from:
 *
 * | member | bound to |
 * |---|---|
 * | `listSources` | {@link ServiceGraph.sources}, the registry `registerSources()` filled |
 * | `listCollections` | `addon.platform.listCollections()` — `Zotero.Collections`, read in the one file allowed to name it |
 * | `getPrefs` | `src/prefs`' typed `getPref`, the four `docs/07` §8.5 window seeds |
 * | `saveSources` | `setPref("sources", …)` — the Databases row is the preference's control (`P2-T14`) |
 * | `semanticScholarKeyStatus` | `getPref("semanticscholarKeyPresent")` and `SEMANTICSCHOLAR_KEY_REQUEST_URL` — FR-2's notice (`P2-T14`) |
 * | `isExisting` | `P1-T13`'s `LibraryIndex.findExisting`, over {@link libraryIndex} |
 * | `writeProvenanceNote` | `src/zotero/notes.ts`'s `writeProvenanceNote`, `FR-8`'s note |
 * | `provenanceFiles` | `src/zotero/notes.ts`'s `provenanceFileWriter()`, `FR-8`'s JSON export |
 *
 * The last three are the ones `P1-T22` could not make, because `src/ui/**` may
 * not import `src/zotero/**` (`docs/07` §2.3) and no file in that card's
 * `Files` list could reach either module. This file is the three-way junction
 * where they can be bound, which is what its header has said since `P0-T07`.
 *
 * **What this file cannot bind, and `P1-T36` measured why.** The *destination*
 * half of the JSON export — the file chooser — is not here and cannot be. A
 * chooser needs a `BrowsingContext` (`docs/01`:436), only a window has one, and
 * `eslint.config.js`'s `research-helper/zotero-global` rule does not exempt this
 * file, so it cannot reach `Zotero.getMainWindow()` to borrow one either. The
 * window document opens the chooser and hands the path to
 * `host.exportProvenance(path)`; this file binds only the write.
 *
 * `getPrefs` reads on **every** call rather than latching a snapshot: `getPref`
 * never throws (`docs/07` §8.5.1) and the window re-seeds its controls from
 * this each time it opens, so a preference changed between two opens has to be
 * visible without a restart.
 */
function searchWindowDeps(
  graph: ServiceGraph,
  pipeline: Pipeline<SearchImportInput, SearchImportOutput>,
  logger: Logger,
): SearchWindowDeps {
  return {
    pipeline,
    jobs: graph.pipelineContext,
    logger,
    pluginVersion: version,
    zoteroVersion: addon.platform.zoteroVersion,
    clock: graph.clock,
    listSources: () =>
      graph.sources.list().map((source) => ({
        id: source.id,
        displayNameKey: source.displayNameKey,
        // `P2-T14`: the window draws bioRxiv's and medRxiv's `⊕` role row
        // from this capability, never from the adapters' English notice.
        keywordSearch: source.capabilities.keywordSearch,
      })),
    listCollections: () => addon.platform.listCollections(),
    getPrefs: () => ({
      sources: getPref("sources"),
      searchYears: getPref("searchYears"),
      maxResults: getPref("maxResults"),
      hideExisting: getPref("hideExisting"),
    }),
    // FR-2's third scenario (`P2-T14`). The presence flag, never the key
    // (decision D5); read per call so a key stored after startup is seen.
    semanticScholarKeyStatus: () => ({
      present: getPref("semanticscholarKeyPresent"),
      requestUrl: SEMANTICSCHOLAR_KEY_REQUEST_URL,
    }),
    // `P2-T14` step 1: the window's checkboxes are the `sources` preference's
    // control (`docs/07` §8.5's row), written through the typed accessor.
    saveSources: (ids) => {
      setPref("sources", ids.join(","));
    },
    // `ExternalIds` and the work key in, boolean out: `findExisting`
    // re-normalizes the identifiers itself, so a record whose DOI is cased
    // differently from the stored one still matches. The key is what reaches a
    // record with no DOI, PMID, arXiv id or S2 corpus id (`P2-T37`).
    isExisting: (record) =>
      libraryIndex?.findExisting(record.work.ids, singletonWorkKey(record)) !==
      undefined,
    // The default `deps` argument builds `new Zotero.Item("note")`, which is
    // `docs/01` §5.7's standalone-note sequence. The record handed over has
    // already been through `src/core/provenance.ts`'s redaction gate — the
    // view model calls `redactSearchProvenance` before this port — and nothing
    // here adds a second rule (`NFR-16`: one gate).
    writeProvenanceNote: (provenance) => writeProvenanceNote(provenance),
    // `FR-8`'s third scenario. The **port**, not `exportProvenanceJson`: the
    // view model calls `src/core/provenance.ts`'s `exportJson`, so the
    // serialisation and the one redaction gate stay in `core/` and the platform
    // contributes `Zotero.File.putContentsAsync` and nothing else.
    provenanceFiles: provenanceFileWriter(),
    // FR-12 (`P2-T17`): the search_provenance store, which waits for the
    // database `installServices` opens ({@link publishProvenanceStore}), and
    // the collection lookup a
    // re-run is seeded through — `Zotero.Collections.get`, read by the one file
    // allowed to name it (`src/addon.ts`).
    provenanceStore: DEFERRED_PROVENANCE_STORE,
    findCollection: (collectionID) => {
      const ref = addon.platform.collectionById(collectionID);
      return ref === undefined
        ? undefined
        : { libraryId: ref.libraryId, collectionKey: ref.key, name: ref.name };
    },
  };
}

/**
 * Which members of {@link SearchWindowDeps} are missing at run time.
 *
 * The compiler already makes an unwired member impossible to ship, so this can
 * only fire when a *value* is `undefined` — a getter that threw, a service the
 * graph left out. Enumerated from the object rather than from a literal list of
 * names for the same reason {@link SearchWindowDeps} is a mapped type: a list
 * written here would be a second thing to keep in step.
 */
function missingDependencies(deps: SearchWindowDeps): readonly string[] {
  return Object.entries(deps)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Hold the graph on the plugin instance, and drop it again on teardown.
 *
 * Through `scope.use` rather than by assignment so that the holder is undone by
 * `hooks.onShutdown`'s single `unregisterAll()` — a stale `ServiceGraph` left
 * on a disabled plugin's instance would keep its rate limiters, its HTTP client
 * and every open progress surface reachable (`docs/01` §12 gotcha 10).
 *
 * **The target object is captured once, not re-read from the `addon` global in
 * the teardown.** A disable/enable cycle deletes the plugin object off `Zotero`
 * and `src/index.ts` news up a fresh `Addon` with a fresh `api`, so a teardown
 * that said `delete addon.api.services` would delete from whichever instance
 * the global happened to name when it ran rather than from the one the
 * registration wrote to. In the ordering `hooks.ts` uses today those are the
 * same object — `unregisterAll()` runs before `delete Zotero[addonInstance]` —
 * so this is not a live defect; it is the `Registration` contract's own
 * requirement that `unregister` undo exactly what `register` did, and
 * `test/integration/menus.spec.ts` cycles disable/enable five times looking for
 * precisely this class of mistake.
 */
async function publishServiceGraph(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  const api = addon.api;
  await scope.use({
    description: "the service graph on the plugin instance (api.services)",
    register: () => {
      api.services = graph;
      return "api.services";
    },
    unregister: () => {
      delete api.services;
    },
  });
}

/**
 * Build the window's host and publish it where the document looks for it.
 *
 * **The property is imported, never respelled** (`P1-T35` step 3):
 * {@link SEARCH_WINDOW_API_PROPERTY} is declared beside the document's own
 * `resolveHost()` contract in `src/ui/dialogs/searchDialog.ts`, so the
 * publishing side and the reading side cannot drift.
 *
 * **A search refreshes the library snapshot before it starts.** `runSearch` is
 * wrapped for exactly that: `isExisting` is synchronous and `buildLibraryIndex`
 * is not, and the one point where an `await` can be inserted without changing
 * `SearchImportViewModelDeps` is the host boundary. Doing it here rather than
 * on a timer or a notifier observer keeps `docs/02` §11.6's budget — **one**
 * `Zotero.Search` per run, independent of library size — and makes the badge
 * deterministic instead of racing the fetch, which is the defect
 * `ensureSourceNames` had to be rewritten for in `P1-T22`. The cost is one
 * index build before each search; the alternative, badging rows from a snapshot
 * taken at startup, is wrong the moment the user imports anything.
 *
 * Nothing else is wrapped. `runImport` leaves the snapshot stale on purpose:
 * the *pipeline* builds its own index for the write (`registerPipelines.ts`'s
 * `writeBatch`), so duplicate detection during the import is already correct,
 * and the next search refreshes the badge.
 */
async function publishSearchWindowHost(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  const logger = graph.logger.child({ surface: "searchWindow" });

  // `PipelineRegistry.get()` is typed `Pipeline<never, unknown>` on purpose —
  // see `src/pipeline/registry.ts`'s header — so the caller that knows which
  // pipeline it wants narrows at the construction site. This is that site.
  const erased = graph.pipelines.get("searchImport");
  if (erased === undefined) {
    // Startup is not failed over this: the menus still register and the window
    // still opens, inert, exactly as it did before this card. What changes is
    // that the reason is in the debug log instead of nowhere.
    logger.error(
      "the searchImport pipeline is not registered, so the Search & Import " +
        "window has no host and every control in it will be inert",
      { pipelines: graph.pipelines.list().length },
    );
    return;
  }
  const pipeline = erased as Pipeline<SearchImportInput, SearchImportOutput>;

  const deps = searchWindowDeps(graph, pipeline, logger);
  const missing = missingDependencies(deps);
  if (missing.length > 0) {
    // Reported, not thrown. `FR-56`'s shape: a plugin that refused to load
    // because one optional port resolved to `undefined` would be a worse
    // outcome than one that searches and does not badge a row. The names are in
    // the line because that is what makes it actionable.
    logger.error(
      "the Search & Import window's host is missing dependencies and will " +
        "degrade silently in the ways each one's doc comment describes",
      { missing: missing.join(",") },
    );
  }

  const model = createSearchImportViewModel(deps);
  const published = model.host;
  const host: SearchWindowHostApi = {
    ...published,
    runSearch: async (query: SearchWindowQuery): Promise<void> => {
      await refreshLibraryIndex(logger);
      await published.runSearch(query);
    },
  };

  // Captured once, for the reason {@link publishServiceGraph} gives: the
  // teardown must act on the `api` the registration wrote to, not on whichever
  // `Addon` instance the global names when teardown runs.
  const api = addon.api;
  await scope.use({
    description: `the search window host (api.${SEARCH_WINDOW_API_PROPERTY})`,
    register: () => {
      api[SEARCH_WINDOW_API_PROPERTY] = host;
      api.searchWindowDeps = deps;
      // Read off the graph, **not** by calling `deps.listSources()`. Measured
      // 2026-10-07: with that port forced to `undefined` the log line itself
      // threw, the exception came out of `scope.use` and out of `registerUI`,
      // `hooks.onStartup` never set `data.initialized`, and the whole run died
      // with `Internal: Plugin awaiting timeout` — a diagnostic that bricked
      // the plugin instead of describing it. The composition root must survive
      // a missing port; reporting one is what {@link missingDependencies}
      // above is for.
      logger.info("the Search & Import window's host is published", {
        property: SEARCH_WINDOW_API_PROPERTY,
        sources: graph.sources.list().length,
        dependencies: Object.keys(deps).length,
      });
      return SEARCH_WINDOW_API_PROPERTY;
    },
    unregister: () => {
      delete api[SEARCH_WINDOW_API_PROPERTY];
      delete api.searchWindowDeps;
      libraryIndex = undefined;
    },
  });
}

// ---------------------------------------------------------------------------
// The preference pane's host (`P1-T44`)
// ---------------------------------------------------------------------------

/**
 * The pane's host property on the plugin instance.
 *
 * **This is a module augmentation of `src/addon.ts`'s `PluginApi`, and it is
 * here because that file is outside `P1-T44`'s `Files` list** (`plan/README.md`
 * §5 rule 2). The member belongs in `PluginApi` proper, beside `searchWindow`,
 * with the same doc comment; moving it there is a two-line edit and needs a
 * card. Until then this declaration is what lets `publishPreferencesHost`
 * write the property without a cast, and the document reads it by the same
 * name through {@link PREFERENCES_API_PROPERTY}.
 */
declare module "../addon" {
  interface PluginApi {
    /**
     * The preference pane's privileged host (`src/ui/prefs/preferencesPane.ts`),
     * at the property `PREFERENCES_API_PROPERTY` names. The pane script reads
     * it off `api` by that name; nothing respells it.
     */
    preferences?: PreferencesHostApi;
  }
}

/**
 * Build the pane's host over the graph and publish it where
 * `addon/content/preferences.js` looks for it.
 *
 * The bindings, member by member:
 *
 * | port | bound to |
 * |---|---|
 * | `secrets` | {@link ServiceGraph.secrets} — the tier-1 store; after a failed probe, the tier-2 session store if the user chose it in the degradation dialog (`P3-T03`), otherwise `undefined`, in which case the host refuses every write and the badge warns |
 * | `request` | `src/core/http/client.ts`'s `httpRequest`: the one outbound choke point, with its per-host limiter, D10 guard and redacted log line |
 * | `getBackendPref` | `src/prefs`' typed `getPref("secretBackend")`, the non-secret row `probeAndRecordBackend` wrote (or `adoptSessionSecretStore`, on a tier-2 choice) |
 * | `providerPrefs` | `getPref("llmProvider")`, and `getPref` / `setPref` over each provider's `<provider>.baseUrl` row, named by `PROVIDER_PREF_NAMES` (`P3-T04`); the host validates before it writes |
 * | `hasPluginData` | {@link pluginDatabaseHasData} over the graph's plugin database, for `docs/09` §1.9 item 8's restore notice (`P3-T04`) |
 * | `clock` | the graph's clock, for the Semantic Scholar retry delay and the `checkedAt` stamp |
 * | `logger` | a child of the graph's redacting logger |
 *
 * Nothing here can reach a key: the host asks the store for one only inside
 * its Test call, to build one request, and the store it asks is the shipped
 * `src/zotero/keychain.ts` through the `SecretStore` port.
 */
async function publishPreferencesHost(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  const host = createPreferencesHost({
    secrets: graph.secrets,
    request: httpRequest,
    getBackendPref: () => getPref("secretBackend"),
    providerPrefs: {
      getActiveProvider: () => getPref("llmProvider"),
      getBaseUrl: (provider) => getPref(PROVIDER_PREF_NAMES[provider].baseUrl),
      setBaseUrl: (provider, value) => {
        setPref(PROVIDER_PREF_NAMES[provider].baseUrl, value);
      },
    },
    hasPluginData: () => pluginDatabaseHasData(graph.database),
    clock: graph.clock,
    logger: graph.logger.child({ surface: "preferences" }),
  });
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: `the preference pane host (api.${PREFERENCES_API_PROPERTY})`,
    register: () => {
      api[PREFERENCES_API_PROPERTY] = host;
      return PREFERENCES_API_PROPERTY;
    },
    unregister: () => {
      delete api[PREFERENCES_API_PROPERTY];
    },
  });
}

/**
 * Whether the plugin database already holds a row in any of its tables other
 * than `schema_version` — `docs/09` §1.9 item 8's sign that this Zotero data
 * folder has been used with the plugin before (`P3-T04` step 4). The tables
 * are read from `sqlite_master` rather than listed, so a table a later
 * migration adds counts without an edit here.
 *
 * `false` when there is no database this run. Reads only whether a row
 * exists, never what it holds.
 */
async function pluginDatabaseHasData(
  database: PluginDatabase,
): Promise<boolean> {
  const open = await database.ready;
  if (open === undefined) return false;
  const result: unknown = await open.connection.queryAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' AND name <> 'schema_version'",
  );
  const tables = Array.isArray(result)
    ? (result as readonly { name?: unknown }[])
    : [];
  for (const row of tables) {
    if (typeof row.name !== "string") continue;
    // The name comes from sqlite_master, not from input; quoted all the same.
    const quoted = `"${row.name.replaceAll('"', '""')}"`;
    const any: unknown = await open.connection.valueQueryAsync(
      `SELECT EXISTS (SELECT 1 FROM ${quoted})`,
    );
    if (Number(any) === 1) return true;
  }
  return false;
}

/**
 * `docs/09` §1.7's degradation dialog (`P3-T03`), raised over the Zotero main
 * window. `installServices` calls this only after the keystore probe failed,
 * and installs no store until it resolves.
 *
 * **Why the window comes from `Services.wm` here.** `src/ui/**` may not touch
 * the platform, and this file may not reference the `Zotero` global
 * (`research-helper/zotero-global`), so `Zotero.getMainWindow()` is out of
 * reach — the same limit {@link searchWindowDeps} records for the file chooser.
 * `Services.wm.getMostRecentWindow("navigator:browser")` is the call
 * `Zotero.getMainWindow()` itself makes; `hooks.ts` awaits
 * `Zotero.uiReadyPromise` before `registerUI` runs, so a main window exists.
 * The result is narrowed by the one member used, as `registerMenus.ts`
 * narrows its menu's window.
 *
 * @returns the user's choice
 * @throws when no main window can raise the dialog; `installServices` then
 *   continues with no stored keys rather than choosing a tier for the user
 */
function chooseSecretBackend(): Promise<SecretBackendChoice> {
  const win: unknown = Services.wm.getMostRecentWindow("navigator:browser");
  if (
    typeof win !== "object" ||
    win === null ||
    typeof (win as Partial<SecretBackendDialogHost>).openDialog !== "function"
  ) {
    return Promise.reject(
      new Error(
        "[research-helper] no Zotero main window to raise the key-storage " +
          "dialog over",
      ),
    );
  }
  return openSecretBackendDialog(win as SecretBackendDialogHost);
}

/**
 * `P3-T16`: this plugin lifetime's one session spend counter (`docs/06`
 * §11.4). Held in memory only and never written anywhere: the next Zotero
 * start evaluates this module again and the count is zero, which is the rule
 * "resets when Zotero restarts". The Usage readout reads it; `P3-T35` hands
 * the same counter to every job's `createBudgetGuard` (reported: the card
 * that wires the context owns that call).
 */
const sessionSpend: SessionSpendCounter = createSessionSpendCounter();

/** The counter every job's budget guard must share (`P3-T35`). */
export function getSessionSpendCounter(): SessionSpendCounter {
  return sessionSpend;
}

/**
 * The application's locale, for `Intl` (`docs/08` §10.3). `Zotero.locale` is
 * out of reach here (`research-helper/zotero-global`); `Services.locale` is
 * what it reads. Falls back to `en-US`, the bundle every id resolves in.
 */
function appLocale(): string {
  try {
    const tag = Services.locale.appLocaleAsBCP47;
    return typeof tag === "string" && tag !== "" ? tag : "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * `P3-T16` step 2: the cost dialog the summarize pipeline calls before its
 * first paid call, and again when a spend ceiling pauses it (`P3-T29` passes
 * this to its pipeline). Raised over the Zotero main window, for the reason
 * {@link chooseSecretBackend} gives.
 *
 * @param input - the pre-run estimate and disclosure, or the ceiling stop
 * @returns what the user chose; rejects when no window can show the number,
 *   and the caller then runs nothing
 */
export function confirmRunCost(
  input: CostDialogInput,
): Promise<CostDialogOutcome> {
  const win: unknown = Services.wm.getMostRecentWindow("navigator:browser");
  if (
    typeof win !== "object" ||
    win === null ||
    typeof (win as Partial<CostDialogHost>).openDialog !== "function"
  ) {
    return Promise.reject(
      new Error(
        "[research-helper] no Zotero main window to raise the cost dialog over",
      ),
    );
  }
  return openCostConfirmDialog(
    win as CostDialogHost,
    buildCostDialogModel(input, appLocale()),
  );
}

declare module "../addon" {
  interface PluginApi {
    /**
     * The preference pane's Usage host (`P3-T16` step 6), at the property
     * `USAGE_API_PROPERTY` names; `addon/content/preferences.js` reads it.
     */
    usage?: UsageHostApi;
  }
}

/**
 * Publish the Usage host where `addon/content/preferences.js` looks for it:
 * the session counter's totals and `run.maxSessionSpendCents`, read each time
 * the pane asks.
 */
async function publishUsageHost(scope: Scope): Promise<void> {
  const host = createUsageHost({
    session: () => sessionSpend.totals,
    sessionLimitCents: () => getPref("runMaxSessionSpendCents"),
    locale: appLocale,
  });
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: `the Usage readout host (api.${USAGE_API_PROPERTY})`,
    register: () => {
      api[USAGE_API_PROPERTY] = host;
      return USAGE_API_PROPERTY;
    },
    unregister: () => {
      delete api[USAGE_API_PROPERTY];
    },
  });
}

/**
 * Run the composition root, then the application-scoped registrations, into
 * the root scope.
 *
 * Sequential rather than `Promise.all`: teardown is last-in-first-out, so a
 * deterministic registration order gives a deterministic teardown order, and
 * a registration that fails does not leave later ones half-applied behind it.
 *
 * ## The {@link import("./container").ServiceGraph} is now held — and was not
 *
 * **Until `P1-T35` this paragraph said the graph was deliberately not held
 * anywhere**, and gave three reasons: three of its four services are already
 * reachable through the process-wide accessors their own modules export
 * (`httpRequest()`, `getHostLimiters()`, `getPref()`), "nothing in Phase 1 yet
 * has a pipeline to hand the fourth to, and the typed service locator is
 * `P1-T16` step 7's — it `create`s this path for that. Standing up a holder
 * with no consumer is the dead code `P0-T07` declined to write for the same
 * reason."
 *
 * **The first reason still stands; the second has expired.** `P1-T16` landed
 * and built the pipeline — `ServiceGraph.pipelineContext` is declared at
 * `container.ts:830` and constructed at `:1419` — and `P1-T22` built the
 * window's host around it. So there is now a consumer, and the graph is held on
 * the plugin instance at `addon.api.services` by {@link publishServiceGraph}.
 * That is this paragraph's own condition being met, not a reversal of
 * `P0-T07`'s judgement: the holder exists because something reads it, which is
 * exactly the test the old text set.
 *
 * It is held on `addon.api` rather than in a module-level variable because a
 * module-level one is unreachable from outside the plugin bundle — an
 * integration spec is bundled separately and gets its own copy of every module,
 * with none of that module's state — and because `src/addon.ts`'s own comment
 * has been promising this since `P0-T07`: "the service-locator half arrives
 * with Phase 1".
 */
export async function registerUI(scope: Scope): Promise<void> {
  const graph = await installServices(scope, {
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
    // The plugin database (`P3-T33`; `plan/00` §6 item 249): opened once by
    // `installServices` and shared by every store, closed in its teardown.
    pluginDatabase: {
      open: openPluginDatabase,
      path: pluginDatabasePath,
      blobs: createCacheBlobStore(),
    },
    // The shipped prompt versions for `docs/07` §9.3's startup comparison
    // (`P3-T26`). A lazy `import()`: `../prompts/bundled` imports the `.md`
    // prompt files, which no unit test that imports this module may reach.
    promptVersions: async () =>
      (await import("../prompts/bundled")).PROMPT_VERSIONS,
    // `docs/09` §1.7's degradation dialog (`P3-T03`), asked only when the
    // keystore probe fails. See {@link chooseSecretBackend}.
    chooseSecretBackend,
  });

  await publishServiceGraph(scope, graph);
  // Before the host and the menus that read it (`P2-T17`), so teardown — last
  // in, first out — removes both before the store is withdrawn, and all three
  // before the graph's own teardown closes the connection. The open itself
  // runs in the background; see {@link provenanceState}.
  await publishProvenanceStore(scope, graph);
  await publishSearchWindowHost(scope, graph);
  // Before `APP_REGISTRATIONS`, for the same reason the services are: the
  // pane registration below can make a `zotero:pref` window reload and load
  // our fragment at once, and its script resolves the host on load.
  await publishPreferencesHost(scope, graph);
  // The pane's Usage section (`P3-T16`), before the pane is registered, for
  // the same reason.
  await publishUsageHost(scope);

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

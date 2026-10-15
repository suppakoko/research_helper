import { config } from "../package.json";
import hooks from "./hooks";
import {
  createScope,
  type Scope,
  type ServiceGraph,
} from "./bootstrap/container";
import type { ProvenanceIndex } from "./core/provenance";
import type {
  SearchImportViewModelDeps,
  SearchWindowHostApi,
} from "./ui/viewModels/searchImportViewModel";
import type { SqlConnection } from "./zotero/db";

/**
 * One collection the Search & Import window's target picker can offer.
 *
 * Declared here rather than imported from
 * `src/ui/viewModels/searchImportViewModel.ts`'s `CollectionDescriptor` so that
 * {@link PlatformReads} describes a *platform* read and not a UI type: the two
 * are structurally identical and the composition root is where they meet.
 */
export interface LibraryCollection {
  readonly id: number;
  readonly name: string;
}

/**
 * The platform facts the composition root cannot read for itself (`P1-T35`).
 *
 * **Why they live in this file.** `eslint.config.js`'s
 * `research-helper/zotero-global` rule forbids the `Zotero` global everywhere
 * except `src/zotero/**`, `addon/**` and the three lifecycle entry files, of
 * which this is one — `docs/07` §2.2 places `index.ts` / `addon.ts` /
 * `hooks.ts` outside the layer directories precisely because they *are* the
 * sandbox boundary. `src/bootstrap/registerUI.ts` is **not** exempt, so it
 * cannot write `Zotero.version` or `Zotero.Collections` itself, and
 * `src/zotero/` ships no facade for either (measured 2026-10-07:
 * `grep -rn "Zotero.Collections\|Zotero.version" src/` returns
 * `collectionOps.ts`'s two `findOrCreateCollection` calls and nothing else).
 *
 * This file already injects a platform capability downward in exactly this
 * shape — the `onError` reporter below closes over `Zotero.debug` and hands it
 * to `createScope`, which may not name the global either. These two reads are
 * the same arrangement for the same reason.
 *
 * **This is reported rather than absorbed** (`plan/README.md` §5 rule 2): the
 * architecturally correct home for both is a `src/zotero/` facade, and no
 * `src/zotero/**` path is in `P1-T35`'s `Files` list. Moving them there — a
 * `zoteroVersion()` beside `userLibraryID()` in `src/zotero/zoteroApi.ts`, and
 * a `listCollections()` beside `findOrCreateCollection()` in
 * `src/zotero/collectionOps.ts` — **needs a card**.
 */
export interface PlatformReads {
  /**
   * `Zotero.version`, for `SearchProvenance.zoteroVersion` (`docs/07` §5.3).
   * Read once per enabled lifetime: the application does not change version
   * while it runs.
   */
  readonly zoteroVersion: string;
  /**
   * The user library's top-level collections, for the window's target picker.
   *
   * Read on **every** call, not cached, because the user can make a collection
   * in the main window while the search window is open and the picker is
   * rebuilt from this on each open.
   *
   * Non-recursive, matching `src/zotero/collectionOps.ts`'s
   * `findOrCreateCollection`, which is what actually resolves the name the
   * window hands the pipeline: offering a nested collection the writer would
   * then fail to find — or, worse, find a top-level namesake of — would make
   * the picker and the writer disagree about what "that collection" means.
   */
  listCollections(): readonly LibraryCollection[];
  /**
   * One collection by `Zotero.Collection.id`, with the library and key FR-12's
   * `search_provenance` lookup is keyed on (`P2-T17`; `docs/07` §8.3's
   * `idx_provenance_collection` is `(library_id, collection_key)`), or
   * `undefined` for an id that names no collection. Any library, any depth:
   * the collection context menu can be opened on either.
   */
  collectionById(id: number): CollectionRef | undefined;
}

/** {@link PlatformReads.collectionById}'s answer. */
export interface CollectionRef {
  readonly id: number;
  readonly libraryId: number;
  readonly key: string;
  readonly name: string;
}

/**
 * The service-locator half of the plugin instance (`docs/07` §2.2).
 *
 * **Everything here is optional and nothing may be assumed present.** The
 * window document's `resolveHost()` reads
 * `Zotero.__addonInstance__.api.searchWindow` and falls back to `{}`, so a
 * build where startup failed before `registerUI()` reached the publication
 * leaves an inert window rather than a broken one (`FR-56`: teardown and
 * startup failures are reported, never thrown at the user).
 *
 * Filled by `src/bootstrap/registerUI.ts` through the root {@link Scope}, so
 * every member is removed again by `hooks.onShutdown`'s single
 * `unregisterAll()` — the same discipline the menus go through — rather than
 * by a `delete` someone has to remember.
 */
export interface PluginApi {
  /**
   * The graph `installServices()` built, held so there is exactly one.
   *
   * `P1-T25`'s **Do NOT** makes a second graph an error — two graphs mean two
   * rate limiters and a host paced at twice its policy — so anything that
   * needs a service reads it from here instead of building one.
   */
  services?: ServiceGraph;
  /**
   * The Search & Import window's host, at the property
   * `SEARCH_WINDOW_API_PROPERTY` names. The document reads it off `api` by
   * that name; nothing respells it.
   */
  searchWindow?: SearchWindowHostApi;
  /**
   * The dependency record {@link searchWindow} was built from — **the
   * assertion seam `P1-T35` criterion 4 needs**, and the reason it is on the
   * public surface rather than module-private to `registerUI.ts`.
   *
   * Every platform dependency the view model takes is *optional*, so one left
   * unbound compiles, runs, and degrades silently — a window that searches and
   * imports and quietly writes no provenance note. `Required<…>` makes
   * forgetting one a **compile** error at the composition root; publishing the
   * record makes it a **run-time** assertion from a live Zotero as well, which
   * is the half a module-private holder cannot give: an integration spec is
   * bundled separately from the plugin, so it sees its own copy of any module
   * and none of that module's state. The plugin instance is the only object
   * both halves can name.
   */
  searchWindowDeps?: Required<SearchImportViewModelDeps>;
  /**
   * FR-12's store and the plugin database under it (`P2-T17`), published by
   * `src/bootstrap/registerUI.ts` once the database is open and migrated, and
   * removed again — the connection closed — on shutdown.
   *
   * On the public surface for the reason {@link searchWindowDeps} is: Zotero
   * holds the file under an exclusive lock, so an integration spec cannot open
   * a second connection to read the schema back, and a module-private holder is
   * invisible to a separately bundled spec.
   */
  provenance?: PluginProvenance;
}

/** {@link PluginApi.provenance}: the store, the index and the connection. */
export interface PluginProvenance {
  /** `createProvenanceIndex` over `src/zotero/db.ts`'s store. */
  readonly index: ProvenanceIndex;
  /** The plugin's own connection, for reading the schema back in a spec. */
  readonly database: SqlConnection;
  /** `<Zotero.DataDirectory.dir>/research-helper.sqlite`. */
  readonly path: string;
  /** The schema version `runMigrations` left the file at. */
  readonly schemaVersion: number;
}

/**
 * The plugin instance, reachable at `Zotero.ResearchHelper`.
 *
 * `docs/07` §2.2: "holds the DI container + lifecycle state". `P0-T07` fills
 * in the lifecycle half — `scope`, the teardown registry every registration
 * passes through. The service-locator half is {@link PluginApi}, filled by
 * `src/bootstrap/registerUI.ts` once `installServices()` has run (`P1-T35`).
 *
 * `data.initialized` is polled by `zotero-plugin.config.ts`'s
 * `test.waitForPlugin` (`docs/13` §1.4), which is why `hooks.onStartup` sets
 * it last and `hooks.onShutdown` clears it.
 */
class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    locale?: {
      current: any;
    };
  };

  /**
   * The root teardown registry. One per enabled lifetime of the plugin: a
   * disable/enable cycle deletes the plugin object off `Zotero` and
   * `src/index.ts` news up a fresh `Addon`, so a torn-down scope is never
   * reused.
   */
  public readonly scope: Scope;

  public hooks: typeof hooks;

  /**
   * The service locator. Empty until `registerUI()` publishes into it.
   *
   * **Typed rather than `object` since `P1-T35`.** `object` has no index
   * signature, so no property could be written to it without a cast — and
   * nothing wrote to it at all: `grep -rn '\.api\b' src/` on 2026-10-07
   * returned four lines, this assignment plus three *comments* in
   * `src/ui/dialogs/searchDialog.ts` saying that nothing wrote to it.
   * (`P1-T35`'s own card says that grep "returns that line and nothing else",
   * which is the count of *writes* and not of lines; reported with the card.)
   */
  public readonly api: PluginApi;

  /**
   * The two platform reads the composition root cannot make. See
   * {@link PlatformReads} for why they are here and not in `src/zotero/`.
   */
  public readonly platform: PlatformReads;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };

    this.scope = createScope({
      description: config.addonRef,
      // Teardown failures are reported, never thrown: FR-56 wants the rest of
      // the teardown to finish. This is the one place they become visible,
      // so it logs the stack — `docs/01` §12 gotcha 15 forbids logging
      // request bodies and keys, not error stacks from our own lifecycle.
      onError: (message, error) => {
        const detail =
          error instanceof Error
            ? `${error.message}\n${error.stack ?? "(no stack)"}`
            : String(error);
        Zotero.debug(`[${config.addonName}] ${message}: ${detail}`);
      },
      strict: __env__ === "development",
    });

    this.hooks = hooks;
    this.api = {};
    this.platform = {
      // A getter, not a value: `src/index.ts` constructs this during
      // `addon/bootstrap.js`'s `startup`, *before* `hooks.onStartup` awaits
      // `Zotero.initializationPromise`. Reading the version eagerly here would
      // latch whatever `Zotero.version` is at that moment; reading it on access
      // means the string reaching `SearchProvenance.zoteroVersion` is read after
      // the barrier, from the same place `test/integration` reads it.
      get zoteroVersion(): string {
        return Zotero.version;
      },
      listCollections: () =>
        Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID).map(
          (collection) => ({ id: collection.id, name: collection.name }),
        ),
      collectionById: (id) => {
        // `Zotero.Collections.get` returns `false` for an unknown id.
        const collection: unknown = Zotero.Collections.get(id);
        if (typeof collection !== "object" || collection === null) {
          return undefined;
        }
        const found = collection as Zotero.Collection;
        return {
          id: found.id,
          libraryId: found.libraryID,
          key: found.key,
          name: found.name,
        };
      },
    };
  }
}

export default Addon;

/**
 * The two menu entry points Phase 1 ships (`docs/08` §2.4, §2.5, `P1-T19`).
 *
 * Like `./toolsMenu.ts`, this file *describes* menus and registers nothing.
 * `Zotero.MenuManager.registerMenu` may only be called from
 * `src/zotero/registrations.ts` (`eslint.config.js`'s
 * `research-helper/scoped-registration` rule, `P0-T31`, `FR-56`), the
 * `Zotero` global may not be named outside `src/zotero/**` and the three
 * lifecycle files (`research-helper/zotero-global`, `docs/13` §2.1), and
 * `src/ui/**` may not import `src/zotero/**` at all
 * (`research-helper/layering/ui`, `docs/07` §2.3). What is left here is the
 * shape of the menus, their identifiers and their handlers — which is exactly
 * what a UI file should own. `src/bootstrap/registerUI.ts` is the one place
 * the shapes below and the platform call that installs them may meet.
 *
 * ### Two registrations, two targets, one top-level item each
 *
 * `docs/08` §2.3 reads `menuManager.js`'s `GROUPED_TARGETS` and both
 * consequences are load-bearing for this file:
 *
 * - **No top-level `separator`** for `main/library/collection`: `_validate()`
 *   rejects it and *the whole menu silently fails to register*. The separator
 *   inside the Tools submenu is fine — §2.4's own block has one there — and
 *   the auto-inserted separator above our collection submenu is Zotero's, not
 *   ours.
 * - **Exactly one top-level `submenu` per context**, because one submenu costs
 *   one slot in the grouping budget however many commands it holds, so our
 *   placement stays stable whatever else the user has installed.
 *
 * That second rule is why {@link withSearchImportEntry} *extends* the options
 * `./toolsMenu.ts` builds instead of registering a second Tools menu:
 * `P0-T10`'s spike item is still registered, still asserted by
 * `test/integration/lifecycle.spec.ts` and still invoked by
 * `test/integration/zotero/itemCreation.spec.ts` — none of which is in
 * `P1-T19`'s `Files` list — and a second `main/menubar/tools` registration
 * would be two top-level items.
 *
 * ### The handlers take their window from the element that was clicked
 *
 * `docs/08` §4.1 reaches for `Zotero.getMainWindow()`; this file may not, and
 * does not need to. Every hook receives `(event, context)` and `context`
 * carries `menuElem` (§2.2), so the window that owns the clicked item — the
 * right one when two main windows are open — is
 * `menuElem.ownerDocument.defaultView`. That window is also where
 * `ZoteroPane` lives, which is how the collection entry reads the selection
 * without naming a `Zotero` global.
 *
 * ### What is deliberately *not* here
 *
 * `docs/08` §2.4's collection block also carries `research-helper-menu-collection-report`,
 * `-summarize-all`, `-rerun` and `-recommend`. All four are Phases 2–3
 * (`docs/11` §1) and `P1-T19`'s **Do NOT** names the `-rerun` one specifically:
 * its `onShowing` guard reads the `search_provenance` table, which does not
 * exist until `P2-T17` creates it, so a Phase 1 copy would either throw or
 * register a permanently invisible entry. The item-context menu
 * (`main/library/item`) is likewise a later phase's and is not registered.
 *
 * §2.4's block also sets `icon: "chrome://research-helper/content/icons/menu-16.svg"`
 * on every submenu. No such file exists under `addon/content/icons/` (only
 * `favicon.png`), and `MenuData.icon` takes a URL Zotero resolves at paint
 * time, so setting it would paint a broken image. `./toolsMenu.ts` already
 * omits it; this file does too, and `P1-T19` reports the missing asset as
 * needing a card rather than inventing an SVG.
 */

import { config } from "../../../package.json";
import {
  L10N_MENU_COLLECTION_SEARCH_IMPORT,
  L10N_MENU_ROOT,
  L10N_MENU_SEARCH_IMPORT,
} from "../../i18n/keys";
import type {
  SearchWindowArgs,
  SearchWindowHost,
} from "../dialogs/searchDialog";

/**
 * `docs/08` §2.1's `VALID_TARGETS`, the two entries Phase 1 needs.
 *
 * Both are members of `_ZoteroTypes.MenuManager.ValidTarget`, and
 * `MenuOptions<T extends ValidTarget>` is what checks that: a typo in either
 * string is a compile error at the signatures below, not a menu that fails
 * `_validate()` at runtime.
 *
 * The Tools target is written as a type argument rather than a `const`
 * because this file never needs it as a *value* — `withSearchImportEntry()`
 * takes the target from the options it extends.
 */
type ToolsTarget = "main/menubar/tools";
const COLLECTION_TARGET = "main/library/collection";

/** `docs/08` §2.4's name for the collection registration. */
const COLLECTION_MENU_ID = "rh-menu-collection";

/**
 * What `Scope.liveHandles()` reports for the collection registration if
 * teardown does not reach zero (`P0-T11`, `FR-56`). Names the thing, not the
 * call, and is unique within the scope — `./toolsMenu.ts`'s
 * `TOOLS_MENU_DESCRIPTION` is the other one, and `Scope`'s strict mode rejects
 * a duplicate description.
 */
export const COLLECTION_MENU_DESCRIPTION = "Collection context-menu item";

/**
 * What the menus are allowed to do, injected rather than imported — the same
 * seam `./toolsMenu.ts` uses, and for the same reason: the menu knows there is
 * a command, not what a command is made of.
 */
export interface SearchMenuCommands {
  /**
   * Opens, or re-focuses, the modeless Search & Import window.
   * `src/ui/dialogs/searchDialog.ts`'s `openSearchWindow`.
   */
  readonly openSearchWindow: (
    host: SearchWindowHost,
    args: SearchWindowArgs,
  ) => unknown;
  /** Where a failure goes. Must not throw. */
  readonly onError: (message: string, error: unknown) => void;
}

/** `ZoteroPane`'s Zotero 10 plural collection getter, narrowed to its id. */
export interface CollectionSelection {
  /**
   * `docs/01` §3.4(a): the plural form. The singular
   * `getSelectedCollection()` **throws** on Zotero 10 and Zotero's own
   * JavaScript API page still shows it, so it is not declared here at all.
   */
  getSelectedCollections(): readonly { readonly id: number }[];
}

/**
 * The members of a main window these handlers use.
 *
 * `_ZoteroTypes.MainWindow` satisfies it structurally (`ZoteroPane` is
 * declared on it, and `openDialog` comes from `Window`), but the handlers
 * narrow to this shape instead of casting to `MainWindow`, because what comes
 * out of `menuElem.ownerDocument.defaultView` is a `WindowProxy` and the only
 * honest way to know it is a Zotero main window is to check for the members
 * being used.
 */
export interface MenuHostWindow extends SearchWindowHost {
  readonly ZoteroPane?: CollectionSelection;
}

/** The part of a menu context this file reads. `menuElem` may be absent. */
interface MenuElementContext {
  /**
   * `docs/08` §2.2 documents it as WeakRef-backed and possibly `undefined`,
   * while `zotero-types@4.1.3` declares it required. The document wins: every
   * read below is optional.
   */
  readonly menuElem?: XULElement;
}

/**
 * The window that owns the clicked element, if it looks like a main window.
 *
 * Returns `undefined` rather than throwing, so the caller decides what to
 * report; a menu command that cannot find its window is a bug, but it must
 * surface as a reported error and not as an unhandled rejection in the plugin
 * sandbox.
 */
function hostWindow(context: MenuElementContext): MenuHostWindow | undefined {
  const view: unknown = context.menuElem?.ownerDocument?.defaultView;
  if (typeof view !== "object" || view === null) {
    return undefined;
  }
  const candidate = view as Partial<MenuHostWindow>;
  return typeof candidate.openDialog === "function"
    ? (candidate as MenuHostWindow)
    : undefined;
}

/**
 * The collections selected in the window that owns the clicked element.
 *
 * `docs/08` §2.2's `context.collectionTreeRows` would be the other way in, and
 * is not used: `zotero-types@4.1.3` declares only the **deprecated singular**
 * `collectionTreeRow` on `LibraryMenuContext` — which §2.2 shows throwing when
 * more than one row is selected — and declares no plural at all, so reading
 * the plural off the context means reading an undeclared property.
 * `P1-T19`'s `Do` step 2 names `ZoteroPane.getSelectedCollections()`, which
 * `typings/zotero-augment.d.ts` §5 does declare, so that is what this reads.
 */
function selectedCollectionIds(context: MenuElementContext): number[] {
  const pane = hostWindow(context)?.ZoteroPane;
  return pane ? pane.getSelectedCollections().map((c) => c.id) : [];
}

/**
 * Start the command and return immediately.
 *
 * `onCommand` is declared `(event, context) => void`: Zotero does not await it
 * and a returned promise would be dropped together with any rejection. So
 * *every* failure path ends at `onError` — an unhandled rejection inside the
 * plugin sandbox is exactly the "no error appears in Debug Output" criterion
 * failing (`FR-56`, `./toolsMenu.ts`'s `run()` for the same reason).
 */
function open(
  commands: SearchMenuCommands,
  context: MenuElementContext,
  args: SearchWindowArgs,
): void {
  try {
    const host = hostWindow(context);
    if (!host) {
      commands.onError(
        "Search & Import menu command found no host window",
        new Error(
          "[research-helper] the clicked menu element has no main window; " +
            "menuElem.ownerDocument.defaultView did not look like one.",
        ),
      );
      return;
    }
    const result: unknown = commands.openSearchWindow(host, args);
    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        commands.onError("Search & Import menu command failed", error);
      });
    }
  } catch (error) {
    commands.onError("Search & Import menu command threw", error);
  }
}

/**
 * Tools ▸ Research Helper ▸ Search & Import… (`docs/08` §2.4, §2.5).
 *
 * `mode: "keyword"` and no `collectionID`: from the Tools menu there is no
 * right-clicked collection, so the window's target picker opens on its own
 * default (`P1-T20`).
 */
function searchImportItem(
  commands: SearchMenuCommands,
): _ZoteroTypes.MenuManager.MenuData<_ZoteroTypes.MenuManager.MenubarMenuContext> {
  return {
    menuType: "menuitem",
    l10nID: L10N_MENU_SEARCH_IMPORT,
    onCommand: (_event, context) => {
      open(commands, context, { mode: "keyword" });
    },
  };
}

/**
 * Add Phase 1's Search & Import entry to the Tools submenu `./toolsMenu.ts`
 * built, without replacing it.
 *
 * Non-mutating: `base` is read, never written, so `toolsMenuOptions()` stays
 * the pure factory it documents itself as. The entry goes **first**, which is
 * where §2.5's Tools wireframe puts it, followed by §2.4's separator; what
 * `base` already held — `P0-T10`'s spike command — follows below the rule.
 *
 * @throws if `base` is not exactly one top-level `submenu`. That is the shape
 *   `docs/08` §2.3 requires and the shape this function has to splice into; a
 *   silent mis-splice would either drop the spike item or register two
 *   top-level items, and both are failures a disable/enable cycle would not
 *   catch.
 */
export function withSearchImportEntry(
  base: _ZoteroTypes.MenuManager.MenuOptions<ToolsTarget>,
  commands: SearchMenuCommands,
): _ZoteroTypes.MenuManager.MenuOptions<ToolsTarget> {
  const [root, ...rest] = base.menus;
  if (!root || rest.length > 0 || root.menuType !== "submenu") {
    throw new Error(
      `[research-helper] the Tools menu options must hold exactly one ` +
        `top-level submenu (docs/08 §2.3); got ${String(base.menus.length)} ` +
        `entr(ies), the first of type "${root?.menuType ?? "none"}".`,
    );
  }
  return {
    ...base,
    menus: [
      {
        ...root,
        menus: [
          searchImportItem(commands),
          // Allowed here: §2.3 rejects only *top-level* separators, and
          // §2.4's own Tools block carries one in this position.
          { menuType: "separator" },
          ...(root.menus ?? []),
        ],
      },
    ],
  };
}

/**
 * Right-click a collection ▸ Research Helper ▸ Search & Import into This
 * Collection… (`docs/08` §2.4, §2.5; `P1-T19` Goal).
 *
 * The submenu is **hidden unless exactly one collection is selected**, which is
 * §2.4's guard: the collections pane supports multi-row selection on Zotero 10
 * (`docs/01` §3.4(a)) and a search can have exactly one target collection, so
 * two selected rows mean the command has no answer. Hidden rather than
 * disabled, as §2.4's block does.
 *
 * The l10n id is `research-helper-menu-collection-search-import`, which
 * `P1-T18` created because `docs/08` §2.4/§2.5 list **no collection-context
 * entry for Phase 1** although this card's Goal requires one. Its `en-US`
 * wording is provisional and is an owner decision on gate `G-41`.
 */
export function collectionMenuOptions(
  commands: SearchMenuCommands,
): _ZoteroTypes.MenuManager.MenuOptions<typeof COLLECTION_TARGET> {
  return {
    menuID: COLLECTION_MENU_ID,
    // D9 (`docs/00` §3): the plugin ID is permanent and must be
    // byte-identical here, in `addon/manifest.json` and in
    // `zotero-plugin.config.ts`.
    pluginID: config.addonID,
    target: COLLECTION_TARGET,
    menus: [
      {
        menuType: "submenu",
        // The same submenu label as the Tools menu's root, deliberately:
        // `docs/08` §2.4 registers both with `research-helper-menu-root`.
        l10nID: L10N_MENU_ROOT,
        onShowing: (_event, context) => {
          try {
            context.setVisible(selectedCollectionIds(context).length === 1);
          } catch (error) {
            commands.onError(
              "Collection context-menu visibility check failed",
              error,
            );
          }
        },
        menus: [
          {
            menuType: "menuitem",
            l10nID: L10N_MENU_COLLECTION_SEARCH_IMPORT,
            onCommand: (_event, context) => {
              const ids = selectedCollectionIds(context);
              // Exactly one, per `P1-T19` Do step 2. The `onShowing` guard
              // above should already have hidden the submenu, but the
              // selection can change between `popupshowing` and the click,
              // and opening the window against the wrong collection is worse
              // than opening nothing.
              const [collectionID, ...extra] = ids;
              if (collectionID === undefined || extra.length > 0) {
                commands.onError(
                  "Collection context-menu command needs exactly one " +
                    `selected collection; the selection holds ` +
                    `${String(ids.length)}`,
                  new Error(
                    "[research-helper] ZoteroPane.getSelectedCollections() " +
                      `returned ${String(ids.length)} collection(s).`,
                  ),
                );
                return;
              }
              open(commands, context, { mode: "keyword", collectionID });
            },
          },
        ],
      },
    ],
  };
}

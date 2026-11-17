/**
 * The Tools ▸ Research Helper menu (`docs/08` §2.4, `P0-T10`).
 *
 * This file describes the menu; it does not register it. Registration is
 * `src/zotero/registrations.ts`'s `menuRegistration()`, listed in
 * `src/bootstrap/registerUI.ts`'s `APP_REGISTRATIONS`. Three separate rules
 * push the code apart this way and they all point the same direction:
 *
 * - `eslint.config.js`'s `research-helper/layering/ui` rule (from `docs/07`
 *   §2.3) forbids `src/ui/**` importing `src/zotero/**` at all, so this file
 *   cannot reach the platform even if it wanted to. `_ZoteroTypes` is a global
 *   *type* namespace, not an import, so the option type below costs nothing.
 * - `research-helper/scoped-registration` (`P0-T31`, `FR-56`) makes a bare
 *   `Zotero.MenuManager.registerMenu` a lint error anywhere but
 *   `src/zotero/registrations.ts`.
 * - `docs/01` §2.4 makes this registration **application-scoped**: menus are
 *   registered once in `startup`, not per window. Putting it in
 *   `WINDOW_REGISTRATIONS` would leak a menu per window close (§12 gotcha 8).
 *
 * What is left here is the shape of the menu and the identifiers, which is
 * exactly what a UI file should own.
 *
 * ### Do NOT reach for the toolkit
 *
 * `ztoolkit.Menu.register` was removed in `zotero-plugin-toolkit` 5.1.1 and
 * the toolkit deliberately ships no wrapper for `Zotero.MenuManager`
 * (`docs/01` §4.3, `docs/08` §2.4.2). Hand-injecting `<menuitem>` elements
 * into `#menu_ToolsPopup` is ruled out too (`docs/08` §2.4.1): Zotero's own
 * context-menu builders address their children positionally, and a
 * hand-injected item is not "known" to the `popupshowing` handler that hides
 * the rest, so it stays visible forever.
 */

import { config } from "../../../package.json";

/**
 * `docs/08` §2.1 reproduces `menuManager.js`'s `VALID_TARGETS` verbatim and
 * the Tools-menu value is this one. Confirmed against the installed
 * Zotero 10.0.1 (`omni.ja`, `menuManager.js` line 36) and against
 * `_ZoteroTypes.MenuManager.MainMenubarTarget`.
 */
const TOOLS_TARGET = "main/menubar/tools";

/** Unique within the plugin; `docs/08` §2.4's name for this menu. */
const TOOLS_MENU_ID = "rh-menu-tools";

/**
 * What `Scope.liveHandles()` reports if teardown does not reach zero
 * (`P0-T11`). Names the thing, not the call.
 */
export const TOOLS_MENU_DESCRIPTION = "Tools menu item";

/**
 * The Fluent ID of the submenu's label.
 *
 * Prefixed `research-helper-` because Fluent identifiers share one global
 * namespace per document and an unprefixed ID silently shadows Zotero's own
 * (`docs/01` §9.3, §12 gotcha 16). The message lives in
 * `addon/locale/{en-US,ko-KR}/research-helper-mainWindow.ftl`.
 *
 * `MenuData` has no plain `label` property — `l10nID` is the only labelling
 * mechanism `Zotero.MenuManager` offers (`docs/08` §2.1's verbatim typedef),
 * and its `l10nFiles` option is commented out in Zotero 10.0.1's
 * `menuManager.js`, so the FTL has to already be loaded in the window.
 *
 * *Changed 2026-11-17 (`plan/10` `P7-T04`, retiring `plan/00` §5 backlog item
 * 25):* the second id, `P0-T10`'s spike command, is gone with the command; the
 * test fixture it wrote is `test/integration/support/spikeArticle.ts`.
 */
export const L10N_MENU_ROOT = "research-helper-menu-root";

/**
 * Build the `registerMenu` options for Tools ▸ Research Helper: the submenu,
 * with no entries of its own.
 *
 * Inert: it returns a plain object. Nothing is registered until
 * `src/bootstrap/registerUI.ts` hands it to `menuRegistration()` and a `Scope`
 * runs the result.
 *
 * The entries are spliced in by `withSearchImportEntry`
 * (`./registerMenus.ts`), which is the only caller in the product; since
 * `P7-T04` removed the spike command, the submenu it builds is empty until that
 * splice fills it, and it is never registered empty. The submenu stays here
 * rather than moving, because `docs/08` §2.3's one-top-level-item rule is what
 * `withSearchImportEntry` checks the shape of.
 */
export function toolsMenuOptions(): _ZoteroTypes.MenuManager.MenuOptions<
  typeof TOOLS_TARGET
> {
  return {
    menuID: TOOLS_MENU_ID,
    // D9 (docs/00 §3): the plugin ID is permanent and must be byte-identical
    // here, in addon/manifest.json and in zotero-plugin.config.ts.
    pluginID: config.addonID,
    target: TOOLS_TARGET,
    menus: [
      {
        menuType: "submenu",
        l10nID: L10N_MENU_ROOT,
        menus: [],
      },
    ],
  };
}

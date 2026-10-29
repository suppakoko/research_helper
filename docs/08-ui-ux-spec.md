# 08 — UI/UX Specification for research_helper in Zotero 10

**Document status:** implementation-ready UI specification
**Target application:** Zotero 10.0.x
**Companion document:** `01-zotero-plugin-platform.md` (platform, lifecycle, packaging)
**Last researched:** 2026-09-08

---

## 0. Scope, conventions, and provenance

This document specifies every surface `research_helper` presents inside Zotero, with the actual extension point and code for each. It covers:

| § | Surface | Extension point |
|---|---|---|
| 2 | Tools menu, collection context menu, item context menu | `Zotero.MenuManager.registerMenu` |
| 3 | Item-pane "Research Helper" section (AI summary) | `Zotero.ItemPaneManager.registerSection` |
| 4 | Search & Import window | `window.openDialog` on a plugin `chrome://` XHTML |
| 5 | Related Papers flow | reuses §4's result table |
| 6 | Collection Report flow | modeless dialog + streaming preview |
| 7 | Preferences pane | `Zotero.PreferencePanes.register` |
| 8 | Notifications, errors, empty/loading states | `Zotero.ProgressWindow` + in-dialog banners |
| 9 | Accessibility | XUL/ARIA conventions |
| 10 | Localization (en-US / ko-KR) | Fluent |

**Provenance markers** are the same as in document 01: unmarked statements are verified against the linked source; `> **Unverified:**` blocks are not.

Most API schemas below were read directly from the Zotero 10 source tree, because the published developer docs do not include them.

### 0.1 Design principles for this plugin

1. **Look like Zotero, not like a web app.** Use XUL/Zotero widgets and Zotero's own CSS variables. No bundled UI framework, no Tailwind, no custom theming. A plugin that looks foreign is a plugin users distrust with their library.
2. **One top-level entry per menu.** Zotero's `MenuManager` auto-groups plugin menu items into a "…" submenu when a context menu grows too tall (see §2.3), so a plugin that registers four flat items may see them collapse unpredictably. We register **one submenu** per context and control our own hierarchy.
3. **Nothing blocks the UI thread.** Every long job is cancellable and reports progress (see `01-zotero-plugin-platform.md` §10).
4. **Never silently mutate the library.** Every write is previewed, counted, and reported. Bulk saves carry a Zotero 10 `undoAction`.
5. **Degrade, don't fail.** No API key → the feature is disabled with an explanation and a link to preferences, not an error dialog.

### 0.2 Naming and ID conventions

```
Plugin ID          research-helper@suppakoko.github.io
Pref branch        extensions.zotero.research-helper.*
Fluent prefix      research-helper-*
Fluent files       locale/<locale>/research-helper-*.ftl   (flat — 01-… §9.1)
chrome namespace   chrome://research-helper/content/*   <- HYPHENATED (corrected 2026-09-30, P1-T18)
DOM element IDs    rh-<surface>-<element>       e.g. rh-search-keyword
Menu IDs           rh-menu-<target>             e.g. rh-menu-library-item
Pane IDs           rh-itempane-summary
```

---

## 1. Information architecture

```
                          ┌──────────────────────────────────────────┐
                          │              Zotero 10                   │
                          └──────────────────────────────────────────┘
                                            │
   ┌──────────────────┬─────────────────────┼────────────────────┬────────────────────┐
   │                  │                     │                    │                    │
Tools menu     Collection ctx menu    Item ctx menu        Item pane          Preferences
   │                  │                     │                    │                    │
   ▼                  ▼                     ▼                    ▼                    ▼
Research Helper ▸  Research Helper ▸   Research Helper ▸   [RH] Summary       Research Helper
 ├ Search & Import  ├ Generate Report   ├ Find Related       section           ├ Providers
 ├ Preferences…     ├ Recommend New     ├ Summarize          ├ summary text    ├ Models
 └ About            │   Papers…         └ Add to Report      ├ [Regenerate]    ├ Search
                    ├ Summarize All     …                    └ [Copy] [Note]   ├ Report & Audio
                    └ Re-run Search…                                           └ Advanced
       │                    │                    │                     │
       ▼                    ▼                    ▼                     ▼
 ┌───────────┐      ┌──────────────┐     ┌──────────────┐     (inline, no window)
 │ Search &  │      │  Collection  │     │   Related    │
 │  Import   │      │    Report    │     │   Papers     │
 │  window   │      │    window    │     │   window     │
 └───────────┘      └──────────────┘     └──────────────┘
       │                    │                    │
       └────────────────────┴────────────────────┘
                            │
                   shared result table +
                   target-collection picker +
                   import pipeline
```

**Three windows total.** "Search & Import" and "Related Papers" are the *same window* in two modes (different query source, identical result table and import controls). "Collection Report" is its own window because its output is a document, not a list.

---

## 2. Menu integration

### 2.1 The API

Menus are registered with `Zotero.MenuManager.registerMenu`, introduced in Zotero 8 ([Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers)). The complete schema below is read from [`chrome/content/zotero/xpcom/pluginAPI/menuManager.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/pluginAPI/menuManager.js) on `main`.

**Valid `target` values** — this is the full `VALID_TARGETS` array, verbatim:

```javascript
const VALID_TARGETS = [
    // Main window menubar menus
    "main/menubar/file",
    "main/menubar/edit",
    "main/menubar/view",
    "main/menubar/go",
    "main/menubar/tools",
    "main/menubar/help",
    // Main window library context menus
    "main/library/item",
    "main/library/collection",
    // Main window toolbar & file menu submenu: "Add attachment"
    "main/library/addAttachment",
    // Main window toolbar & file menu submenu: "New note"
    "main/library/addNote",
    // Main window tab context menus
    "main/tab",
    // Reader window menubar menus
    "reader/menubar/file",
    "reader/menubar/edit",
    "reader/menubar/view",
    "reader/menubar/go",
    "reader/menubar/window",
    // item pane context menus
    "itemPane/info/row",
    // notes pane add note buttons
    "notesPane/addItemNote",
    "notesPane/addStandaloneNote",
    // sidenav buttons
    "sidenav/locate",
];
```

**`MenuOptions` and `MenuData` typedefs**, verbatim from the source:

```javascript
/**
 * @typedef MenuData
 * @type {object}
 * @property {string} menuType - The type of the menu item
 * @property {string} [l10nID] - The l10n ID for the menu item
 * @property {string} [l10nArgs] - Arguments for the l10n ID. Support for object type is deprecated.
 * @property {string} [icon] - The icon for the menu item
 * - For menu icons, it is recommended to use an SVG icon with a size of 16x16.
 * Use `fill="context-fill"` in the SVG to use the default icon color
 * for automatic hover and dark mode support.
 * @property {string} [darkIcon] - The dark icon for the menu item
 * - If not provided, the light icon will be used for both light and dark mode.
 * @property {string[]} [enableForTabTypes] - The type of tab for which the menu item should be enabled.
 * Available types are "library", "reader/*", "reader/pdf", "reader/epub", "reader/snapshot",
 * but other types are allowed as well for custom tab types.
 * By default, the menu item is always enabled.
 * Only for main window menubar menus and reader window menubar menus
 * @property {function} [onShowing] - Function to run when the menu is about to be shown
 * @property {function} [onShown] - Function to run when the menu is shown
 * @property {function} [onHiding] - Function to run when the menu is about to be hidden
 * @property {function} [onHidden] - Function to run when the menu is hidden
 * @property {function} [onCommand] - Function to run when the menu is clicked
 * @property {MenuData[]} [menus] - The menu items to add to the menu
 *
 * @typedef MenuOptions
 * @type {object}
 * @property {string} menuID - The unique ID of the menu
 * @property {string} pluginID - The ID of the plugin registering the menu
 * @property {string} target - The target for the menu
 * @property {MenuData[]} [menus] - The menu items to add to the menu
 */
```

`menuType` must be one of `"menuitem"`, `"separator"`, `"submenu"` (`VALID_MENU_TYPES`). A `"submenu"` **must** have a `menus` array.

### 2.2 The `context` object

Every hook receives `(event, context)`. The `context` object is composed of a **default context** (present for every target) plus a **target-specific context**.

Default context, read from `menuManager.js` — these are live helpers you should use instead of touching the DOM:

```javascript
{
  get menuElem(),                          // WeakRef-backed; may be undefined
  setL10nArgs(l10nArgs),                   // sets data-l10n-args on the item
  setEnabled(enabled),                     // menuElem.disabled = !enabled
  setVisible(visible),                     // menuElem.hidden = !visible
  setIcon(icon, darkIcon),                 // sets --custom-menu-icon-light/-dark
}
```

Target-specific contexts, read from [`zoteroPane.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/zoteroPane.js) and [`standalone/standalone.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/standalone/standalone.js) on `main`:

| Target | Context properties |
|---|---|
| `main/library/item` | `collectionTreeRows` (array), `collectionTreeRow` (**deprecated — throws if more than one row is selected**), `items`, `tabType`, `tabSubType`, `tabID` |
| `main/library/collection` | `collectionTreeRows`, `collectionTreeRow` (deprecated), `tabType`, `tabSubType`, `tabID` |
| `main/library/addAttachment`, `main/library/addNote` | `items`, `tabType`, `tabSubType`, `tabID` |
| `main/menubar/*` | `items`, `tabType`, `tabSubType`, `tabID` |

The Zotero 10 deprecation is implemented literally like this in `zoteroPane.js` — worth reading, because it is the exact trap described in `01-zotero-plugin-platform.md` §3.4a:

```javascript
getContext: () => ({
    get collectionTreeRow() {
        if (collectionTreeRows.length > 1) {
            throw new Error("collectionTreeRow was removed -- use collectionTreeRows");
        }
        Zotero.Plugins.warnRemovedAPICall("Menu context collectionTreeRow",
            "collectionTreeRows");
        return collectionTreeRows[0];
    },
    collectionTreeRows,
    items,
    tabType: "library",
    tabSubType: undefined,
    tabID: "zotero-pane",
})
```

**Never read `context.collectionTreeRow`.** Always `context.collectionTreeRows`.

The remaining targets, for completeness (read from their respective call sites):

| Target | Context properties | Call site |
|---|---|---|
| `reader/menubar/*` | `items: this._item ? [this._item] : []`, `tabType: "reader"`, `tabSubType: this._type` | `xpcom/reader.js` |
| `main/tab` | `items: [item]`, `tabType: tab.type`, `tabID`, `tabSubType: item.attachmentReaderType` | `tabs.js` |
| `itemPane/info/row` | `items: [this.item]`, `tabID`, `tabType`, `tabSubType`, **`editable`**, **`fieldName`**, **`targetElem`** (a `WeakRef`) | `itemBox.js` |
| `notesPane/addItemNote`, `notesPane/addStandaloneNote` | `items: [currentAttachment]`, `tabID`, `tabType`, `tabSubType` | `notesContext.js` |
| `sidenav/locate` | `items`, `tabType`, `tabID`, `tabSubType` | `itemPaneSidenav.js` |

Note the target is `itemPane/info/row` — **not** `main/itemPane/info/row` — and **there is no `reader/menu` target**. Injecting UI into the reader's *content* (text-selection popup, annotation context menu, sidebars) goes through `Zotero.Reader.registerEventListener` instead, which is out of scope for `research_helper` v1.

#### What `MenuData` does *not* have

⚠️ There is **no `label`**, **no `disabled`**, and **no `checked`** option. Labels are Fluent-only (`l10nID` + `l10nArgs`); enabled/visible/icon state is set imperatively from `context` inside `onShowing`. For a checkbox-style item, reach through `context.menuElem`.

Because there is no `label`, dynamic labels are done with a parameterised Fluent string plus `l10nArgs` — this is how [zotero-actions-tags](https://github.com/windingwind/zotero-actions-tags) builds its dynamic menu:

```javascript
menus: actions.map((action) => ({
  menuType: "menuitem",
  l10nID: "research-helper-menupopup-item",
  l10nArgs: JSON.stringify({ label: action.label }),   // pass a STRING; object form is deprecated
  onCommand: () => run(action),
}))
```

The FTL entry must set the `label` **attribute**, not a bare value:

```properties
research-helper-menupopup-item =
    .label = { $label }
```

#### Hook timing

`onShowing` is **not** wired as a `popupshowing` listener for top-level items — by the time Zotero builds them the event has already fired, so it calls `menuData.onShowing(event, context)` synchronously right after appending the element. For **submenus**, `event` is undefined at registration and `popupshowing` *is* used. `onShown` / `onHiding` / `onHidden` map to `popupshown` / `popuphiding` / `popuphidden`, all `{ once: true }`. `onCommand` listeners are also `{ once: true }` and torn down on `popuphidden` via `requestIdleCallback`.

### 2.3 Auto-grouping (important, and undocumented)

`menuManager.js` defines:

```javascript
const GROUPED_TARGETS = [
    "main/library/collection",
    "main/library/item",
];
```

For these two targets, Zotero:

* prepends a `<menuseparator>` before all plugin menu items;
* computes how many items fit in 80% of screen height (`_computeAvailableMenuNum`, using per-platform row heights of 22px on macOS, 26px on Windows, 24px on Linux);
* if plugin items exceed that, shows the first *N* and moves the rest into an automatically-created submenu labelled `menu-custom-group-submenu`;
* **rejects top-level separators**: `_validate()` logs `"Invalid menu: top-level separators are not allowed for target …"` and returns false.

Two consequences for `research_helper`:

1. **Do not register top-level `separator` items** for `main/library/item` or `main/library/collection` — registration silently fails for the whole menu.
2. **Register exactly one top-level `submenu`** per context. This is one item in the grouping budget regardless of how many commands we offer, so our menu placement stays stable no matter what other plugins the user has installed.

### 2.4 Registration code

```javascript
// src/modules/menus.ts
import { config } from "../../package.json";

const PLUGIN_ID = "research-helper@suppakoko.github.io";
const ICON = `chrome://research-helper/content/icons/menu-16.svg`;    // fill="context-fill"
// ^ HYPHENATED, corrected 2026-09-30 (`P1-T18`). `addon/bootstrap.js` registers
// ["content", "__addonRef__", rootURI + "content/"] and `package.json`'s `config.addonRef` is
// `research-helper`, so the live package name carries the hyphen. Measured: a fetch of
// `chrome://research-helper/content/searchDialog.xhtml` returns an **empty response** rather than
// an unknown-package error, i.e. the hyphenated package is registered and only the file is
// missing. `P1-T19` step 5 and `P1-T20` will both trip on this if they copy the old spelling.

export const registeredMenuIDs: string[] = [];

export function registerMenus() {
  // ---------- Tools ▸ Research Helper ----------
  registeredMenuIDs.push(Zotero.MenuManager.registerMenu({
    menuID: "rh-menu-tools",
    pluginID: PLUGIN_ID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "submenu",
        l10nID: "research-helper-menu-root",
        icon: ICON,
        menus: [
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-search-import",
            onCommand: () => RH.ui.openSearchWindow({ mode: "keyword" }),
          },
          { menuType: "separator" },     // separators ARE allowed inside a submenu
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-preferences",
            onCommand: () => RH.ui.openPreferences(),
          },
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-about",
            onCommand: () => RH.ui.openAbout(),
          },
        ],
      },
    ],
  }));

  // ---------- Collection right-click ▸ Research Helper ----------
  registeredMenuIDs.push(Zotero.MenuManager.registerMenu({
    menuID: "rh-menu-collection",
    pluginID: PLUGIN_ID,
    target: "main/library/collection",
    menus: [
      {
        menuType: "submenu",
        l10nID: "research-helper-menu-root",
        icon: ICON,
        // Enable only when exactly one *collection* row is selected
        onShowing: (event, context) => {
          const rows = context.collectionTreeRows ?? [];
          const ok = rows.length === 1 && rows[0].isCollection?.();
          context.setVisible(ok);
        },
        menus: [
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-collection-report",
            onShowing: (event, context) =>
              context.setEnabled(RH.llm.isConfigured()),
            onCommand: (event, context) => {
              const row = context.collectionTreeRows[0];
              RH.ui.openReportWindow({ collectionID: row.ref.id });
            },
          },
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-collection-summarize-all",
            onShowing: (event, context) =>
              context.setEnabled(RH.llm.isConfigured()),
            onCommand: (event, context) => {
              const row = context.collectionTreeRows[0];
              RH.jobs.summarizeCollection(row.ref.id);
            },
          },
          { menuType: "separator" },
          {
            // FR-12. Hidden — not merely disabled — when the collection has no stored
            // SearchProvenance row (07-… §5.3); a hand-built collection was never searched
            // for, so there is nothing to re-run.
            menuType: "menuitem",
            l10nID: "research-helper-menu-collection-rerun",
            onShowing: (event, context) => {
              const row = context.collectionTreeRows[0];
              context.setVisible(RH.provenance.hasRunForCollection(row.ref.id));
            },
            onCommand: (event, context) => {
              const row = context.collectionTreeRows[0];
              RH.ui.openSearchWindow({
                mode: "rerun",
                collectionID: row.ref.id,
              });
            },
          },
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-collection-recommend",
            onCommand: (event, context) => {
              const row = context.collectionTreeRows[0];
              RH.ui.openSearchWindow({
                mode: "recommend-from-collection",
                collectionID: row.ref.id,
              });
            },
          },
        ],
      },
    ],
  }));

  // ---------- Item right-click ▸ Research Helper ----------
  registeredMenuIDs.push(Zotero.MenuManager.registerMenu({
    menuID: "rh-menu-item",
    pluginID: PLUGIN_ID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: "research-helper-menu-root",
        icon: ICON,
        onShowing: (event, context) => {
          const items = (context.items ?? []).filter(i => i.isRegularItem());
          // Hide entirely for notes/attachments-only selections
          context.setVisible(items.length > 0);
          context.setL10nArgs(JSON.stringify({ count: items.length }));
        },
        menus: [
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-item-find-related",
            onShowing: (event, context) => {
              const items = (context.items ?? []).filter(i => i.isRegularItem());
              context.setEnabled(items.length === 1);   // one seed paper only
            },
            onCommand: (event, context) => {
              const seed = context.items.find(i => i.isRegularItem());
              RH.ui.openSearchWindow({ mode: "related", seedItemID: seed.id });
            },
          },
          {
            menuType: "menuitem",
            l10nID: "research-helper-menu-item-summarize",
            onShowing: (event, context) =>
              context.setEnabled(RH.llm.isConfigured()),
            onCommand: (event, context) => {
              const ids = context.items.filter(i => i.isRegularItem()).map(i => i.id);
              RH.jobs.summarizeItems(ids);
            },
          },
        ],
      },
    ],
  }));
}

export function unregisterMenus() {
  for (const id of registeredMenuIDs.splice(0)) {
    Zotero.MenuManager.unregisterMenu(id);
  }
}
```

> **Measured 2026-10-15 in Zotero 10.0.3 (`P2-T17`): `hasRunForCollection` cannot be synchronous.** The answer is a
> SQLite read, which is asynchronous, and `menuManager.js` does not await `onShowing`. Submenu entries are built when
> the submenu opens, and `setVisible` reaches the live element through a weak reference, so a late call still lands.
> The shipped entry therefore reads a cache (`ProvenanceIndex` in `src/core/provenance.ts`): the parent submenu starts
> the lookup early, and a late answer is applied only while the same single collection is still selected. The
> separator §2.5 draws above the entry divides the AI jobs from the window-opening entries; none of those jobs is
> registered yet, so no separator ships until one is.

Register in `startup()` (app-scoped, not per-window) and unregister in `shutdown()`. Zotero 10 also removes plugin menu elements from all windows automatically when the plugin unregisters — the `_unregisterByPluginID` implementation in `menuManager.js` walks `Zotero.getMainWindows()` and every `zotero:reader` window and removes matching `.zotero-custom-menu-item` elements.

### 2.4.1 Why we do not hand-inject `<menuitem>` elements

The legacy approach — `doc.createXULElement('menuitem')` appended to `#zotero-itemmenu` / `#zotero-collectionmenu` / `#menu_ToolsPopup` in `onMainWindowLoad` — still works, and the [Zotero 8 documentation](https://www.zotero.org/support/dev/zotero_8_for_developers) states the policy plainly: "Plugins should use this official API if possible rather than manually injecting content."

Two concrete hazards make that more than a style preference:

1. ⚠️ **`ZoteroPane.buildItemContextMenu()` and `buildCollectionContextMenu()` address their own entries positionally** — `menu.childNodes[m.moveToTrash]`, `menu.childNodes[m.exportItems]`, and so on. Appending at the **end** of `#zotero-itemmenu` is safe; **inserting anywhere before the built-in items shifts every index and corrupts Zotero's own context menu.**
2. Those builders hide all known children by default on each `popupshowing`. A hand-injected item is not "known", so it stays visible permanently — including for selections where it makes no sense — unless you write your own `popupshowing` listener.

`MenuManager` has neither problem. Verified popup IDs, if you ever need them for something MenuManager cannot reach: `#zotero-collectionmenu`, `#zotero-itemmenu`, `#menu_ToolsPopup`, `#menu_FilePopup`, `#menu_EditPopup`, `#menu_goPopup`, `#menu_viewPopup`, `#menu_HelpPopup` (all in `zoteroPane.xhtml`).

### 2.4.2 `ztoolkit.Menu.register` is deleted — do not use it

`zotero-plugin-toolkit`'s `MenuManager` (`ztoolkit.Menu`) was deprecated on 2025-09-01 with the note *"Use `Zotero.MenuManager` instead. This API is planned to be removed in 6 months after Zotero 8 is officially released"*, and **removed on 2026-02-17, shipping in v5.1.1**. The published `zotero-plugin-toolkit@5.2.0` `ztoolkit.d.ts` exposes `UI, Reader, ExtraField, FieldHooks, Keyboard, Prompt, Clipboard, FilePicker, Patch, ProgressWindow, VirtualizedTable, Dialog, LargePrefObject, Guide` — **no `Menu`.** The toolkit deliberately does not wrap `Zotero.MenuManager`.

⚠️ **`windingwind/zotero-plugin-template` still calls `ztoolkit.Menu.register(...)` in `src/modules/examples.ts` while depending on `^5.1.0-beta.13`.** A fresh `npm install` of the template resolves to 5.2.0 and the example code does not compile. Do not copy the template's menu code.

### 2.5 Wireframes

**Tools menu**

```
┌ Tools ──────────────────────────────┐
│ Add-ons                             │
│ RTF Scan…                           │
│ Create Timeline                     │
│ Developer                         ▸ │
│ ─────────────────────────────────── │
│ 🔎 Research Helper                ▸ │──┐
└─────────────────────────────────────┘  │
   ┌─────────────────────────────────────▼──┐
   │ Search & Import…                       │
   │ ────────────────────────────────────── │
   │ Preferences…                           │
   │ About Research Helper                  │
   └────────────────────────────────────────┘
```

**Collection context menu** (right-click a collection in the left pane)

```
┌ (collection) ───────────────────────┐
│ New Subcollection…                  │
│ Rename Collection…                  │
│ Delete Collection…                  │
│ Export Collection…                  │
│ ─────────────────────────────────── │  ← separator auto-inserted by Zotero
│ 🔎 Research Helper                ▸ │──┐
└─────────────────────────────────────┘  │
   ┌─────────────────────────────────────▼─────┐
   │ Generate Research Trends Report…          │
   │ Summarize All Papers in Collection        │
   │ ───────────────────────────────────────── │
   │ Re-run This Search…                       │
   │ Recommend New Papers from This Collection…│
   └───────────────────────────────────────────┘
```

**"Re-run This Search…" is FR-12's control**, and it is the only entry in this submenu that can be *absent* rather than merely disabled: it is shown only when the collection has a stored `SearchProvenance` row (`07-architecture-and-data-model.md` §5.3, the `search_provenance` table indexed by target collection). A collection the user built by hand has no such row and gets no entry. It is grouped with "Recommend New Papers…" because both open the Search & Import window (§4) rather than starting a job; the two entries above the separator are the LLM jobs. The pre-filled window state it opens is §4.6's **Re-run (pre-filled from provenance)**.

> **As built 2026-10-29 (`P3-T29`; the card's readings, for the owner to confirm).** "Summarize All
> Papers in Collection" (`research-helper-menu-collection-summarize-all`, §10.2's wording) and FR-20's
> "Remove Generated Notes from Collection…" (`research-helper-menu-collection-remove-notes`, a new id;
> its `en-US` wording is provisional, `G-41`) are the first two entries of the submenu, above the
> separator, followed by "Search & Import into This Collection…" and "Re-run This Search…". Neither is
> disabled when no key is set: the summarize window says what is missing and pauses before any request
> (`P3-T29` step 3). The summarize entry opens a **modeless** window of its own,
> `chrome://research-helper/content/summarize.xhtml` (`src/ui/dialogs/summarizeDialog.ts`): §6.4's
> "Stage 1–2" layout without the report's language, model and depth rows — the collection and its
> paper count, "Re-summarize existing" (off), "Save a summary note on each paper" (from
> `report.perPaperNotes`, per run; disabled with a line saying why when the library is read-only), a
> stage line, the progress line with `cached`/`new` counts and FR-53's remaining time, one row per paper
> (§6.4's ✓ ⟳ ⚠ ·, with the skip reason), the end-of-job counts, and Summarize / Cancel / Close
> buttons. The job runs on the privileged side (`src/bootstrap/registerUI.ts`), never inside the
> window; Cancel, or closing the window while the job runs, cancels it, keeping every summary made. The cost
> question is `P3-T16`'s dialog, raised over the main window; the wall-clock and key questions are
> asked inside the window. The removal entry asks with `Services.prompt` naming the exact count and the
> collection, and does nothing when the count is 0.

> **As built 2026-10-29 (`P4-T19`; FR-25's wording, decided 2026-10-26 by the owner, `plan/00` §6 item
> 286).** "Generate Research Trends Report…" (`research-helper-menu-collection-report`, with §10.2's
> `en-US` and Korean) is now the **first** entry, above "Summarize All Papers in Collection", as the
> wireframe above draws it. Like the summarize entry it is shown whenever the submenu is (exactly one
> collection selected) and is not disabled when no key or model is set: the §2.4 block's
> `setEnabled(RH.llm.isConfigured())` is not used: the report window names the resolved model or says
> that none is set (§6.4's note of 2026-10-29), and a missing key is the job's to report before any
> request (`P4-T18`, `P4-T20`). The entry opens the modeless report window (§6.4) and starts no job.

**Item context menu** (right-click one or more items)

```
┌ (item) ─────────────────────────────┐
│ Add Note                            │
│ Add Attachment                    ▸ │
│ Duplicate Item                      │
│ Remove Item from Collection…        │
│ Move Item to Trash…                 │
│ Export Item…                        │
│ Create Bibliography from Item…      │
│ ─────────────────────────────────── │  ← auto-inserted
│ 🔎 Research Helper                ▸ │──┐
└─────────────────────────────────────┘  │
   ┌─────────────────────────────────────▼──┐
   │ Find Related Papers…      (1 item only)│
   │ Summarize with AI             (3 items)│
   └────────────────────────────────────────┘
```

---

## 3. Item-pane section: AI summary

### 3.1 The API

Registered via `Zotero.ItemPaneManager.registerSection`. The complete option schema below is read from [`chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js) on `main`.

**Options** (from `optionTypeDefinition`; unmarked = required):

```
paneID          string      required, must not collide with built-ins:
                            info, abstract, attachments, notes, attachment-info,
                            attachment-annotations, libraries-collections, tags, related
pluginID        string      required
header          object      required: { l10nID: string, l10nArgs?: string,
                                        icon: string, darkIcon?: string }
sidenav         object      required: { l10nID: string, l10nArgs?: string,
                                        icon: string, darkIcon?: string,
                                        orderable?: boolean }
onRender        function    required
bodyXHTML       string      optional
onInit          function    optional
onDestroy       function    optional
onItemChange    function    optional
onAsyncRender   function    optional
onToggle        function    optional
sectionButtons  array       optional: [{ type, icon, darkIcon?, l10nID?, onClick }]
```

Note that `header.icon` and `sidenav.icon` are **required**, not optional — a registration missing either is rejected.

**Hook argument shape** — from the JSDoc typedefs:

```javascript
/**
 * @typedef {Object} SectionHookArgs
 * @property {string} paneID - Registered pane id.
 * @property {Document} doc - Document of section.
 * @property {HTMLDivElement} body - Section body.
 * @property {Zotero.Item} item - Current item.
 * @property {string} tabType - Current tab type.
 * @property {boolean} editable - Whether the section is in edit mode.
 * @property {SetSectionL10nArgs} setL10nArgs - Set l10n args for section header.
 * @property {SetEnabled} setEnabled - Set pane enabled state.
 * @property {SetSectionSummary} setSectionSummary - Set pane section summary, shown in collapsed header.
 * @property {SetSectionButtonStatus} setSectionButtonStatus - Set pane section button status.
 */
```

The props objects are `Object.freeze`d and composed from a basic set (`paneID`, `doc`, `body`) plus a UI set (`item`, `tabType`, `editable`, `setL10nArgs`, `setEnabled`, `setSectionSummary`, `setSectionButtonStatus`). Exactly which hook gets what — read from `chrome/content/zotero/elements/itemPaneCustomSection.js`:

| Hook | Props |
|---|---|
| `onInit` | basic + UI + **`refresh: () => Promise<void>`** ← **only here** |
| `onDestroy` | **basic only** — `{ paneID, doc, body }`, **no `item`** |
| `onItemChange` | basic + UI |
| `onRender` | basic + UI (must be synchronous) |
| `onAsyncRender` | basic + UI |
| `onToggle` | basic + UI + `event` |
| `sectionButtons[].onClick` | basic + UI + `event` — **no `refresh`** |

> ⚠️ **`refresh` is available only in `onInit`.** If a section button needs to re-render, capture `refresh` into your module state during `onInit` and call it from `onClick`. Do not destructure `refresh` out of the `onClick` props — it is not there.

Return-value contract:

* `onItemChange` returns **boolean** — return `false` to hide the section for this item.
* `onRender` is **required and synchronous**. It runs on every selection change; keep it cheap.
* `onAsyncRender` may return a promise and is where I/O belongs.

Zotero's own JSDoc gives the intended division of labour: `onInit` — "Initialize data if necessary; set up hooks, e.g. notifier callback. **Don't** render/refresh UI." `onItemChange` — "Update data (no need to render or refresh); update the section enabled state with `props.setEnabled`." `onAsyncRender` — "Compute height and create a box in sync `onRender`; render actual contents in async `onAsyncRender`."

`setSectionButtonStatus(buttonType, { disabled, hidden })` looks the button up as `.${type}`, so `sectionButtons[].type` "must be a valid DOMString and without `,`" — Zotero sanitises it with `type.replace(/[^a-zA-Z0-9-_]/g, "-")`.

Other details not in the published docs:

* `bodyXHTML` is parsed with `MozXULElement.parseXULToFragment()` — **XUL is the default namespace, HTML needs `html:`**, and `<script>` will not run. Build behaviour in `onRender`/`onInit`.
* `paneID` is namespaced internally to `CSS.escape(pluginID + "-" + paneID)`.
* Header icons should be **16×16**, sidenav icons **20×20**.
* `sidenav.orderable` defaults to `true` — set `false` to pin the section's position.
* Sections render in **both** the library item pane and the reader context pane (they share the `item-details` element). Use `tabType` to tell them apart.

> **Read 2026-10-29 (`P3-T28`) from Zotero 10.0.3's `omni.ja`** (`xpcom/pluginAPI/itemPaneManager.js`, `pluginAPIBase.mjs`, `elements/itemPaneCustomSection.js`, `itemDetails.js`, `itemPaneContainerBase.mjs`, `collapsibleSection.js`, `itemPane.js`) — source reading, not yet a run; `test/integration/zotero/summarySection.spec.ts` is the measurement. (1) **`onItemChange`'s return value is discarded** (`_handleItemChange` calls the hook and ignores what it returns): the section is hidden only by `setEnabled(false)`, which sets the element's `hidden`. The plugin calls `setEnabled` and returns the same boolean. (2) `registerSection` returns the namespaced id `CSS.escape(pluginID + "-" + paneID)` or `false`, and validates a shallow copy of the options. (3) Zotero removes a plugin's sections from its own `Zotero.Plugins` shutdown observer, as it does menus, so a section vanishing on disable does not prove the plugin unregistered it; the scope's `liveHandles()` does. (4) `onAsyncRender` runs only for a pane scrolled into view (`isPaneVisible`), awaited at most 500 ms per pane, and again when a pane scrolls in. (5) `setSectionSummary` writes the collapsed header's `summary` attribute, which `collapsible-section` draws with `textContent`. (6) Selecting a note shows the note editor, not `item-details` (`itemPane.js`, `renderNoteEditor`), so for a note the section is never drawn rather than hidden; an attachment goes through `onItemChange`. (7) The section is drawn once in the library pane and once in the reader's context pane **of the same document**, so the body must not use element ids: `P3-T28` uses classes.

### 3.2 Behaviour specification

| Situation | Section behaviour |
|---|---|
| Non-regular item selected (note, attachment, annotation) | `onItemChange` returns `false` → section hidden |
| Regular item, cached summary exists | Render the summary's fields, model name, timestamp; the collapsed header line is the **derived gist** — `deriveTldr(stored.content)` from `07-architecture-and-data-model.md` §5.2, truncated to ~60 chars |
| Regular item, no cached summary | Render an empty state with a **Generate summary** button |
| Regular item, no LLM key configured | Render "Set an API key in Preferences" + link button; Generate disabled |
| Generation in progress | Spinner + "Summarizing…" + Cancel; header buttons disabled |
| Generation failed | Inline error banner with the provider message + **Retry** |
| Multiple items selected | Zotero shows no item pane sections for multi-select; nothing to do |

The summary is **not** written as a note unless the user asks: "Save as child note" is an explicit user action, never automatic, so the plugin does not pollute the user's notes. Where the cached copy lives is **owned by `07-architecture-and-data-model.md` §8.3**, which selected the plugin's own SQLite `summary` table (`StoredSummary`, keyed `workKey:promptVersion:modelId`) with blobs over 256 KB in `<data dir>/research-helper/cache/blobs/`. This section does not choose a store; an earlier draft of it proposed a per-item JSON cache file, and §8.3 wins. Invalidation on `item` `delete`/`trash` is a `Zotero.Notifier` observer (see `01-zotero-plugin-platform.md` §5.9) that calls `cache.invalidateByTag('work:<key>')` (`07-architecture-and-data-model.md` §9.3, trigger 3 — qualified because this document's own §9 is Accessibility and has no such subsection).

> **As built 2026-10-29 (`P3-T28`; `src/ui/panes/summarySection.ts`).** Choices this section left open: (a) **What a stored summary shows**: the research question, the key findings and the limitations, each under a heading, then `<modelId> · <localized time>` — §3.4's populated wireframe (a lead paragraph, "Key findings", the meta line). Every string from the row is model output and is written with `textContent` only, never `innerHTML` and never as a Fluent argument; a failure message is passed through `redact` first. (b) **The gist** is `deriveTldr(stored.content)` with whitespace collapsed, cut at the last word break inside 60 UTF-16 units, with "…". (c) **The read**: the newest row of the item's work key (`fromZoteroItem(item).workKey`, which trusts `rh-work-key`) from the `summary` table, in `onAsyncRender` only. (d) **A failure** stays with its item; selecting another item and coming back reads the table again. (e) **Generate, Retry and Regenerate are offered only when a Generate is bound**, and **Save as child note only when a note writer is bound** — never a button that does nothing. In the no-key state Generate is shown disabled either way. As of this date neither is bound: the summarize job `P3-T29` builds takes a collection, and which code runs a one-item summary is the open question in `plan/04` `P3-T28`'s note of 2026-10-29.

> **Decided 2026-10-29 (owner, `plan/00` §6 item 303(a), (b)); built the same day.** Item (e) of the note above no longer holds: Generate, Retry and Regenerate are bound, and so is Save as child note.
> - **What runs.** Generate runs `P3-T29`'s summarize pipeline for this one item (`SummarizeInput.itemKeys`; `07-architecture-and-data-model.md` §12.3's note of this date) through `runItemSummary` (`src/ui/dialogs/summarizeDialog.ts`). Regenerate runs it with `resummarize`, and so does Retry, which `P3-T28` built as a regenerate: it repeats a run that stored nothing. *(Decided 2026-10-29 (owner, `plan/00` §6 item 305(c)): Regenerate also bypasses the stored result; Retry does not — see the note below.)* The run never writes a note (`writeNotes` off): a summary becomes a note only through Save as child note, the explicit action this section requires.
> - **Where its progress and its questions appear.** Progress is the section's own loading state — "Summarizing…" and Cancel, the header buttons disabled — as the table above says; the summarize window of §2.5 is the collection command's and is not opened. Each question is asked where a collection run asks it when it is not a line in that window: the pre-run cost and egress confirmation is `P3-T16`'s cost dialog over the main window (`confirmRunCost`), and a spend ceiling reached mid-run asks that dialog's ceiling question. A one-item run works on no collection, so it runs under the global privacy mode (`plan/00` §6 item 278(c)) *(superseded — Decided 2026-10-29 (owner, `plan/00` §6 item 305(a)): the strictest of the global mode and the override of every collection the item belongs to; see the note below)*, reads no "don't ask again" record and offers no box to store one, as the search's screening dialog does (§4.2's note of 2026-10-24); the dialog therefore opens on every Generate that will make a call *(Decided 2026-10-29 (owner, `plan/00` §6 item 305(b)): kept as built — see the note below)*, and a question forced by money is asked as on any run (item 274(b)). The two questions a collection run asks as lines in its window — the key is missing (Continue), and the 30-minute wall-clock limit — have no window to appear in: the run answers them as a run with no surface does (`HEADLESS_SUMMARIZE_SURFACE`: stop, nothing more is sent), and the section shows the failure banner with the reason and **Retry** (the table's "Generation failed" row).
> - **What the banner says.** A failed call shows its own message, redacted — `failureText` reads the message of any error-shaped object, because an error made in another global fails `instanceof Error` (found 2026-10-29 by the failing `summarySection.spec.ts` test). A run that ends without a stored summary shows `research-helper-itempane-not-summarized` with its reason: no abstract or full text, retracted, not in English, an existing summary note, no key, the time limit, or another stop. Cancelling the cost dialog shows no banner: the user chose to send nothing, and the section returns to its empty state.
> - **Save as child note** (item 303(b)). It writes the stored summary as `P3-T29`'s note (`writeSummaryNote`) only when the item has no summary note — found by the stored `zoteroNoteKey`, then by the tag (item 296(b), `findSummaryNote`) — and then stores the new note's key on the row (`StoredSummary.zoteroNoteKey`). When the item already has one, or its library is read-only, it writes nothing and says so in a `Zotero.ProgressWindow` popup (`research-helper-itempane-note-not-written`; §8.1's mechanism for a short action). The logic is `saveSummaryNoteOnce` in `src/zotero/notes.ts`.

> **Decided 2026-10-29 (owner, `plan/00` §6 item 305(a)–(c)); built the same day.** Three readings of the note above are settled.
> - **(a) Privacy.** The one-item run no longer takes the global privacy mode alone: it runs under the **strictest** of the global `privacy.mode` and the override of every collection the item belongs to, in the order `PRIVACY_MODES` declares (strict, balanced, full), so a collection set to strict is never summarized more loosely from this section (`09-security-privacy-and-api-keys.md` §3.5's note of this date). `runItemSummary` reads the item's collections through `ItemSummaryDeps.collectionsOf` before the first job context and passes them to both halves' `openJob`; if they cannot be read, the run stops with the failure banner and nothing is sent. Everything else about working on no collection stays: no "don't ask again" record, no box.
> - **(b) The routine cost question.** Kept as built: a one-item run asks the cost question every time it will make a call, with no "don't ask again" record and no box (`confirmSummarizeRun` with no collection). `plan/reports/followup-303-304.md` finding 2 raised that the owner may find this heavy; the owner keeps asking every time. No behaviour changed.
> - **(c) Regenerate.** Regenerate (the header button) really asks the model again. It passes `bypassCache` (`SummarySectionHost.generate`'s options, `ItemSummaryRequest.bypassCache`, `SummarizeInput.bypassCache`): the item's stored row and its cache entry are not served, so `CacheProbe` prices the call, the cost dialog opens before it, and after confirmation one real call is made; its answer replaces the old row (same row id, `workKey:promptVersion:modelId`) and the cache entry (same key). **Retry** keeps the rule above — `resummarize` with the cache, so an unchanged text is a cache hit with no call and no dialog — and **Generate** keeps skipping a stored item. How the bypass is keyed so it cannot reach another run is `07-architecture-and-data-model.md` §12.3's note of this date. A summary note already saved from the old row is not rewritten: Regenerate writes no note, and Save as child note still finds the existing note and writes no second one.

Summaries are never stored in preferences, in any form: `07-architecture-and-data-model.md` §8.5.2 rules cached summaries out of `Zotero.Prefs` explicitly, so `zotero-plugin-toolkit`'s `LargePrefHelper` — which chunks large values across preferences — is not a candidate here regardless of how well it works.

### 3.3 Registration code

```javascript
// src/modules/itemPaneSection.ts
const PLUGIN_ID = "research-helper@suppakoko.github.io";
// ^ every `chrome://research-helper/...` URL below is HYPHENATED, corrected 2026-10-05
// (`P1-T34`). This block and §4.1 kept the unhyphenated spelling — the same package name with
// the hyphen removed — after §2.4 was corrected on 2026-09-30, and `P1-T19` has since
// **measured** that that spelling does not resolve at all: a fetch of
// `chrome://research-helper/content/icons/favicon.png` returns **1723 bytes**, while the
// unhyphenated package **rejects** (`undefined`). Both readings are now integration assertions
// in `test/integration/menus.spec.ts`. `addon/bootstrap.js` registers
// ["content", "__addonRef__", rootURI + "content/"] and `package.json`'s `config.addonRef` is
// `research-helper`, so the hyphen is the live package name (§2.4).
let sectionID: string | undefined;

export function registerSummarySection() {
  sectionID = Zotero.ItemPaneManager.registerSection({
    paneID: "rh-itempane-summary",
    pluginID: PLUGIN_ID,

    header: {
      l10nID: "research-helper-itempane-header",
      icon: "chrome://research-helper/content/icons/section-16.svg",
      darkIcon: "chrome://research-helper/content/icons/section-16-dark.svg",
    },
    sidenav: {
      l10nID: "research-helper-itempane-sidenav",
      icon: "chrome://research-helper/content/icons/section-20.svg",
      darkIcon: "chrome://research-helper/content/icons/section-20-dark.svg",
    },

    // Static skeleton; XUL is the default namespace, HTML lives under html:
    bodyXHTML: `
      <html:div id="rh-summary-root" class="rh-summary">
        <html:div id="rh-summary-empty" class="rh-empty" hidden="true">
          <html:p data-l10n-id="research-helper-itempane-empty"/>
          <html:button id="rh-summary-generate"
                       data-l10n-id="research-helper-itempane-generate"/>
        </html:div>
        <html:div id="rh-summary-loading" class="rh-loading" hidden="true">
          <html:span data-l10n-id="research-helper-itempane-loading"/>
        </html:div>
        <html:div id="rh-summary-error" class="rh-error" hidden="true" role="alert">
          <html:span id="rh-summary-error-text"/>
          <html:button id="rh-summary-retry"
                       data-l10n-id="research-helper-itempane-retry"/>
        </html:div>
        <html:div id="rh-summary-content" hidden="true">
          <html:p id="rh-summary-text" class="rh-summary-text"/>
          <html:p id="rh-summary-meta" class="rh-summary-meta"/>
        </html:div>
      </html:div>`,

    sectionButtons: [
      {
        type: "rh-regenerate",     // becomes a CSS class; [^a-zA-Z0-9-_] is replaced with "-"
        icon: "chrome://research-helper/content/icons/refresh-16.svg",
        darkIcon: "chrome://research-helper/content/icons/refresh-16-dark.svg",
        l10nID: "research-helper-itempane-btn-regenerate",
        // NOTE: onClick props do NOT include `refresh` — use the captured one.
        onClick: ({ item }) => RH.jobs.summarizeItems([item.id])
                                 .then(() => RH.state.refreshSection?.()),
      },
      {
        type: "rh-save-note",
        icon: "chrome://research-helper/content/icons/note-16.svg",
        l10nID: "research-helper-itempane-btn-save-note",
        onClick: ({ item }) => RH.notes.saveSummaryAsChildNote(item.id),
      },
    ],

    // `refresh` is ONLY provided here. Capture it.
    onInit: ({ body, refresh }) => {
      RH.state.refreshSection = refresh;
      // These are `html:button`s (see bodyXHTML above), so the event is `click`.
      // `command` is XUL-only and would silently never fire on an HTML button.
      body.querySelector("#rh-summary-generate")
          ?.addEventListener("click", () => RH.jobs
              .summarizeItems([RH.state.currentItemID])
              .then(() => refresh?.()));
      body.querySelector("#rh-summary-retry")
          ?.addEventListener("click", () => refresh?.());
      // Cache invalidation lives here, not in onRender
      body.dataset.notifierKey = Zotero.Notifier.registerObserver(
        { notify: (event, type, ids) => {
            if (type === "item" && (event === "delete" || event === "trash")) {
              RH.cache.invalidate(ids);
              refresh?.();
            }
        } },
        ["item"],
        "research-helper-itempane",
      );
    },

    // Return false to hide the section entirely for this item
    onItemChange: ({ item, setEnabled }) => {
      const show = !!item && item.isRegularItem();
      setEnabled(show);
      return show;
    },

    // Synchronous, cheap: paint whatever is already cached
    onRender: ({ body, item, setSectionSummary, setSectionButtonStatus }) => {
      RH.state.currentItemID = item?.id;
      const cached = RH.cache.getSummary(item);
      paint(body, {
        state: cached ? "content"
             : RH.llm.isConfigured() ? "empty" : "unconfigured",
        summary: cached,
      });
      // The collapsed header line is the derived gist, not a stored field: `StoredSummary`
      // has no `tldr` and `PaperSummary` v1 does not generate one (07-… §5.2).
      setSectionSummary(cached ? truncate(RH.summary.deriveTldr(cached.content), 60) : "");
      setSectionButtonStatus("rh-save-note", { disabled: !cached });
      setSectionButtonStatus("rh-regenerate", { disabled: !RH.llm.isConfigured() });
    },

    // Async: only runs when the section is actually visible/expanded
    onAsyncRender: async ({ body, item, setSectionSummary }) => {
      if (!item?.isRegularItem()) return;
      if (RH.cache.getSummary(item)) return;
      if (!Zotero.Prefs.get("research-helper.autoSummarize")) return;
      paint(body, { state: "loading" });
      try {
        const summary = await RH.jobs.summarizeItems([item.id]);
        paint(body, { state: "content", summary });
        setSectionSummary(truncate(RH.summary.deriveTldr(summary.content), 60));
      } catch (e) {
        paint(body, { state: "error", error: String(e.message ?? e) });
      }
    },

    // onDestroy receives ONLY { paneID, doc, body } — no `item`
    onDestroy: ({ body }) => {
      if (body.dataset.notifierKey) {
        Zotero.Notifier.unregisterObserver(body.dataset.notifierKey);
      }
      RH.state.refreshSection = undefined;
    },
  });
}

export function unregisterSummarySection() {
  if (sectionID) Zotero.ItemPaneManager.unregisterSection(sectionID);
  sectionID = undefined;
}
```

> ⚠️ **Do not auto-summarize on every selection by default.** `onAsyncRender` fires whenever a user clicks through their library; an unconditional LLM call there would burn the user's API credits by arrow-keying down a list. The `autoSummarize` preference above must default to **off**, and even when on should be debounced (300–500 ms) and rate-limited.

> **As built 2026-10-29 (`P3-T28`).** Where this block and the build differ, the build is the reading: (1) the code is `src/ui/panes/summarySection.ts` (`summarySectionOptions`), registered by `publishSummarySection` in `src/bootstrap/registerUI.ts` through `itemPaneSectionRegistration` (`src/zotero/registrations.ts`) — never a bare `registerSection`, which `eslint.config.js`'s `REGISTRATION_APIS` now forbids; (2) **both icons are `chrome://research-helper/content/icons/favicon@0.5x.png`**, with no `darkIcon`: the four SVGs above do not exist and `addon/content/icons/README.md` forbids another icon size, and the placeholder mark is its own tile, legible in either theme; (3) the body uses classes, not ids (§3.1's note, item 7); (4) the delete/trash observer is application-scoped, registered once through `notifierRegistration` beside the section rather than per body in `onInit`, so teardown removes it once; (5) `autoSummarize` (off by default) is debounced **400 ms**, starts at most one run per section at a time, and tries each item at most once per section — the rate limit this block asks for.

> **Decided 2026-10-29 (owner, `plan/00` §6 item 303(a), (b)); built the same day.** The block's `RH.jobs.summarizeItems([item.id])` is now real: `publishSummarySection` (`src/bootstrap/registerUI.ts`) binds the host's `generate` to a one-item run of the summarize pipeline (`runItemSummary` in `src/ui/dialogs/summarizeDialog.ts`; `regenerate` → `resummarize`), with its own cancellation token for the section's Cancel: the prepare half runs in a job context with no record, and only after the confirmation is the record enqueued with its egress log and the execute half run in its context — as the summarize window's session (`createSummarizeSession`) does. The jobs open with `openOn: "completion"`, as that session's do, so a run that ends while the user looks at another item still leaves its completion popup. `saveAsNote` is bound to `saveSummaryNoteOnce` (`src/zotero/notes.ts`). §3.2's note of this date has the rules.

### 3.4 Wireframes

**Populated**

```
┌ Item pane ───────────────────────────────────┬──┐
│ ▸ Info                                       │≡ │
│ ▸ Abstract                                   │¶ │
│ ▾ Research Helper            [↻] [🗒]        │🔎│ ← sidenav button
│ ┌──────────────────────────────────────────┐ │  │
│ │ This study evaluates lipid-nanoparticle  │ │  │
│ │ delivery of CRISPR-Cas9 to hepatocytes   │ │  │
│ │ in non-human primates, reporting 68%     │ │  │
│ │ editing efficiency with no detectable    │ │  │
│ │ off-target activity at 12 weeks.         │ │  │
│ │                                          │ │  │
│ │ Key findings                             │ │  │
│ │  • Durable knockdown through week 12     │ │  │
│ │  • Dose–response plateau above 3 mg/kg   │ │  │
│ │                                          │ │  │
│ │ claude-sonnet-5 · 2026-09-08 14:22       │ │  │
│ └──────────────────────────────────────────┘ │  │
│ ▸ Attachments (2)                            │📎│
│ ▸ Notes (1)                                  │🗒│
│ ▸ Tags (4)                                   │🏷│
└──────────────────────────────────────────────┴──┘
```

**Empty**

```
│ ▾ Research Helper            [↻] [🗒]        │
│ ┌──────────────────────────────────────────┐ │
│ │  No summary yet for this item.           │ │
│ │                                          │ │
│ │        [ Generate summary ]              │ │
│ └──────────────────────────────────────────┘ │
```

**Unconfigured**

```
│ ▾ Research Helper            [↻] [🗒]        │
│ ┌──────────────────────────────────────────┐ │
│ │  ⚠ No LLM API key configured.            │ │
│ │  Add a key for OpenRouter, OpenAI,       │ │
│ │  Gemini, or Anthropic to enable          │ │
│ │  summaries.                              │ │
│ │                                          │ │
│ │        [ Open Preferences… ]             │ │
│ └──────────────────────────────────────────┘ │
```

**Loading / error**

```
│ │  ⟳ Summarizing…                [Cancel]  │ │
   …
│ │  ⚠ OpenRouter returned HTTP 429          │ │
│ │    (rate limit). Try again in a moment.  │ │
│ │                            [ Retry ]     │ │
```

---

## 4. Search & Import window

### 4.1 How the window is opened

> **File names come from `07-architecture-and-data-model.md` §2.2, which owns the directory tree.** The document there is `addon/content/searchDialog.xhtml`, with `searchDialog.js` beside it and the bundle at `addon/locale/<locale>/research-helper-searchDialog.ftl` — **flat and prefixed**, per `01-zotero-plugin-platform.md` §9.1 (this clause said "`searchDialog.ftl` in the per-surface locale folder" until 2026-10-05, `P1-T34`: the same subdirectory-and-unprefixed error §10.1's tree carried, and it cited §9.1 for the opposite of what §9.1 measures — `registerLocales()` on Zotero 10.0.1 drops directory entries). An earlier draft of this section named all three `searchWindow.*`, and two file-naming conventions for one surface is a defect, not a preference. The *behaviour* is still a modeless singleton **window** — that is this document's call, and it is why the entry point below is `openSearchWindow` and the controller object is `RHSearchWindow`; only the file names changed.

```javascript
// src/ui/dialogs/searchDialog.ts  (07-… §2.2: ui/dialogs/)
export function openSearchWindow(args: SearchWindowArgs) {
  const win = Zotero.getMainWindow();
  const features = "chrome,titlebar,toolbar,centerscreen,resizable,dialog=no,minwidth=880,minheight=600";
  // `args` is passed as the dialog argument; read it inside with window.arguments[0]
  const dialog = win.openDialog(
    "chrome://research-helper/content/searchDialog.xhtml",
    "research-helper-search",         // named window: re-focuses instead of duplicating
    features,
    args,
  );
  dialog.focus();
  return dialog;
}
```

`dialog=no` plus a window name gives a **modeless, singleton** window — the user can keep browsing their library while a search runs, and re-invoking the menu focuses the existing window instead of opening a second one. This matters because searches take tens of seconds.

The `chrome://research-helper/content/` namespace is registered in `bootstrap.js` via `amIAddonManagerStartup.registerChrome` (see `01-zotero-plugin-platform.md` §2.5).

> **Namespace spelling corrected 2026-10-05 (`P1-T34`): it is `research-helper`, hyphenated, here and in §3.3.** This section — the code block above, this paragraph and §4.1.1's markup — kept the unhyphenated spelling (the same package name with the hyphen removed) after §2.4 was corrected on 2026-09-30, so an agent reading §4.1 rather than §2.4 copied a URL that does not resolve. `P1-T19` **measured** the difference rather than inferring it: a fetch of `chrome://research-helper/content/icons/favicon.png` returns **1723 bytes**, while the unhyphenated package **rejects** with `undefined` — the package is not registered at all, so nothing under it resolves. Both readings are now assertions in `test/integration/menus.spec.ts`. `addon/bootstrap.js` registers `["content", "__addonRef__", rootURI + "content/"]` and `package.json`'s `config.addonRef` is `research-helper`, which is where the hyphen comes from.

> ⚠️ Passing `rootURI + 'content/foo.xhtml'` (a `jar:file:///…!/` URL) straight to `openDialog` is used in the wild but is **not** the documented path. `registerChrome` + `chrome://` is. Use it.

### 4.1.1 Zotero 7+ dialog markup

The top-level `<dialog>` root was replaced by `<window><dialog>`. This is Zotero's own `createParentDialog.xhtml`, abridged, and it is the shape to copy:

```xml
<?xml version="1.0"?>
<?xml-stylesheet href="chrome://global/skin/" type="text/css"?>
<?xml-stylesheet href="chrome://zotero/skin/zotero.css" type="text/css"?>
<?xml-stylesheet href="chrome://zotero-platform/content/zotero.css"?>
<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
        xmlns:html="http://www.w3.org/1999/xhtml"
        title="Research Helper — Search &amp; Import"
        tooltip="html-tooltip"
        onload="RHSearchWindow.init()">
  <tooltip id="html-tooltip" page="true"/>
  <dialog id="rh-search-dialog" orient="vertical"
          buttons="cancel,accept"
          buttonlabelaccept="Import"
          buttondisabledaccept="true"
          style="padding: 12px; min-width: 880px; min-height: 600px">
    <script src="chrome://global/content/globalOverlay.js"/>
    <script src="chrome://zotero/content/include.js"/>
    <script src="chrome://research-helper/content/searchDialog.js"/>
    <linkset>
      <html:link rel="localization" href="research-helper-searchDialog.ftl"/>
    </linkset>
    <!-- content -->
  </dialog>
</window>
```

Four non-obvious requirements:

1. ⚠️ **`width` / `height` attributes on XUL `<window>` are no longer recognised** (since Firefox 115). Size with CSS `min-width` / `min-height`.
2. ⚠️ **Call `Zotero.UIProperties.registerRoot(rootEl)` in `init()`.** It applies the user's `fontSize` preference, `--zotero-font-size`, `--zotero-ui-density`, and `dir="rtl"` when `Zotero.rtl`. **Omitting it is a real accessibility defect** — the dialog will ignore the font size the user chose for Zotero.
3. ⚠️ **`tooltiptext` becomes `title` automatically in existing windows, but in a *new* window it needs a XUL `<tooltip id="html-tooltip">` element plus `tooltip="html-tooltip"` on `<window>`.** Without it, none of your tooltips appear.
4. Arguments come in via `window.arguments[0]`; results go back by assigning to that same object before `window.close()`.

```javascript
// searchDialog.js
var RHSearchWindow = {
  init() {
    this.io = window.arguments[0];                  // { mode, seedItemID?, collectionID? }
    Zotero.UIProperties.registerRoot(document.getElementById('rh-search-dialog'));
    document.addEventListener('dialogaccept', (e) => { e.preventDefault(); this.import(); });
    document.getElementById('rh-search-keyword').focus();
  },
};
```

### 4.1.2 Toolkit `DialogHelper` for the small stuff

For confirmations and small forms, `zotero-plugin-toolkit`'s `DialogHelper` avoids the XHTML file and the chrome registration entirely — `open()` calls `openDialog("about:blank", …)` and builds the DOM programmatically, injecting `chrome://global/skin/global.css` and `chrome://zotero-platform/content/zotero.css`.

```typescript
const dialogData = {
  name: suggested,
  loadCallback:   () => ztoolkit.log("opened"),
  unloadCallback: () => ztoolkit.log("closed"),
};

const dialog = new ztoolkit.Dialog(2, 2)         // (rows, columns) — both must be > 0
  .addCell(0, 0, { tag: "label", properties: { innerText: "Collection name:" } })
  .addCell(0, 1, { tag: "input", namespace: "html", id: "rh-new-collection-name",
                   attributes: { "data-bind": "name", "data-prop": "value",
                                 type: "text" } }, false)   // false = don't stretch the cell
  .addButton("Create", "ok")
  .addButton("Cancel", "cancel")
  .setDialogData(dialogData)
  .open("New collection", { centerscreen: true, resizable: true, fitContent: true });

await dialogData.unloadLock.promise;              // auto-created by open(); just await it
if (dialogData._lastButtonId === "ok") {
  const name = dialogData.name;                   // written back on beforeunload
}
```

Data binding: `data-bind="key"` syncs the element to `dialogData[key]`; `data-prop` sets a JS property, otherwise `data-attr` (default `"value"`) sets an attribute.

⚠️ **`width` / `height` in the window features are ignored when `fitContent` is true — which is the default.** The helper calls `win.sizeToContent()` 300 ms after open. Pass `fitContent: false` if you need a fixed size.

`DialogData` also accepts an undocumented `l10nFiles?: string | string[]`, which is the clean way to get Fluent into a toolkit dialog.

The Search & Import window is large and stateful, so it gets its own XHTML document; the report window's small sub-prompts can use `DialogHelper`.

### 4.2 Layout and controls

| Control | Type | Default | Notes |
|---|---|---|---|
| Keyword | text input | `""` | Focus on open. Enter triggers Search. |
| Search mode chip | read-only label | per invocation | `Keyword` / `Related to: <title>` / `From collection: <name>` / `Re-run: <collection name>` — one per `mode` value `openSearchWindow` accepts (§4.1): `keyword`, `related`, `recommend-from-collection`, `rerun`. The `rerun` mode is FR-12's; its pre-filled opening state is in §4.6. |
| Date range | two `<menulist>` (from/to year) | **from = current year − 2, to = current year** | i.e. the last 3 **calendar** years, per the project brief. This document owns the computation (see "Date defaults" below); `10-requirements-and-user-stories.md` **FR-3** is the requirement and defers here, and the project owner settled calendar years over a rolling 36 months on 2026-09-09. A "Custom…" option reveals full date inputs. |
| Databases | checkbox row | all on | PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv, medRxiv — the seven `10-requirements-and-user-stories.md` FR-2 requires. The row is rendered from the source registry; membership in the `sources` preference *is* the enable flag (there is no per-source `enabled` boolean), and that preference's default is all seven (`07-architecture-and-data-model.md` §8.5). See the note below on what the two preprint servers contribute. |
| Max results per DB | number input | the `maxResults` preference | **Key, type, shipped default and range are `07-architecture-and-data-model.md` §8.5's, and this row deliberately does not restate them.** An earlier draft of this row named a default of 50 and a range of 10–200; §8.5 ships 100 and its own precedence rule makes any disagreeing restatement the defect, so the number is stated in exactly one place. The prefs-pane control that seeds this field is in §7.3, bound to the same key. |
| Relevance threshold | number input + live count | `screening.threshold` (60) | Shown only when LLM relevance screening is available and enabled for the run. `12-prompt-library.md` §3 owns the behaviour: the count preview beside it reads "importing 47 of 210 results" and updates as the number changes, filtering never happens without that number being visible, and a "show excluded" toggle must be able to bring the dropped rows back. Default and range: `07-architecture-and-data-model.md` §8.5. |
| Result table | plain scrollable `<html:table>` (**§4.3**) | — | Columns: ☑ / Title / Authors / Year / Source / Type / DOI. §4.3 is the owner and decides for v1 **against** Zotero's `VirtualizedTable`: our result sets are bounded (≤ `maxResults` per database, a few hundred rows total), and the plain table removes the CJS-loader/window-scope hazard and a React dependency from the critical path. An earlier draft of this row said "virtualized table", which contradicted that decision two subsections later. Whatever is used, §4.3's `getRowString` / `label` / `disableFontSizeScaling` rules still apply. |
| Select all / none | checkbox in header | all selected on new results | |
| Filters | text input + "Hide items already in my library" checkbox | filter empty, hide-existing **on** | Client-side filter over fetched results |
| Target collection | collection picker + "New collection…" | current collection if one is selected, else "New collection…" | |
| Import | button | disabled until ≥1 selected | |
| Status bar | text + progress + Cancel | — | |

> **As built 2026-10-24 (`P3-T27`): the Relevance threshold row.** "Enabled for the run" is a checkbox beside the control, "Screen results for relevance with the AI model", **unticked on every open** and shown only while the active LLM provider has a key, because screening spends money during a search; the number input and its count line show while it is ticked. The number opens at `screening.threshold`, read when the window opens, and a change applies to that run only and is never written back (`07-architecture-and-data-model.md` §8.5's row). After a screened search, a row scoring below the number is hidden — and so not imported — until "Show excluded" is ticked, and the line beside the control reads "Importing 47 of 210 results · 163 below the threshold". `0` hides nothing. Rows the model could not score are never hidden, and a notice says how many there were. `12-prompt-library.md` §3's note of this date has the rest.

> **Decided 2026-10-24 (owner, `plan/00` §6 item 281(b)): the checkbox shows what screening may cost, and a costly screen asks first.** Built after wave 8.
>
> - **The line beside the checkbox.** While the row is shown, the window shows "Estimated cost of screening: up to about $0.42 for up to 500 results" (`research-helper-search-screening-cost`), or, for a model with no known price, "The price of *model* is not known, so the cost of screening cannot be estimated." (`research-helper-search-screening-cost-unpriced`). It is redrawn when the ticked databases, the per-database maximum or the keyword change. The number of results is not known before the search runs, so the line uses the most the search can return: the per-database maximum times the ticked databases that search (bioRxiv and medRxiv add none on a keyword run). Merging duplicates can only lower it. How the dollars are computed is `12-prompt-library.md` §3's note of this date.
> - **When it asks.** When that estimate is above `summary.confirmAboveCents`, pressing Search with the box ticked opens `P3-T16`'s cost dialog — the same window and model the summary run uses (`confirmRunCost`), not a second dialog — before anything is fetched. At or below the threshold no dialog opens. The dialog's "Don't ask again for this collection" box is not shown here: a search has no collection for it to apply to.
> - **What the answers do.** **Run** starts the screened search. **Cancel**, or closing the dialog, starts nothing: no search and no screening, and the window stays as it was.
> - **Read by the implementer, for the owner to confirm.** (1) A model with no known price also opens the dialog, because `P3-T16`'s rule is that an unknown cost is never treated as a small one (`secondAcknowledgementFor`). (2) Cancel cancels the whole search, not only its screening. (3) If the estimate cannot be made at all (the prompt or the model cannot be read), or the dialog cannot be shown (no Zotero main window to raise it over), the search runs without screening and the window shows "Relevance screening could not run, so no result was scored and none is hidden." Nothing is screened without its estimate having been checked against the threshold. (4) While the dialog is open, a second press of Search is ignored.

**Date defaults.** "Last 3 years" is computed from the current date at window open, not hard-coded:

```javascript
const now = new Date();
const toYear = now.getFullYear();
const fromYear = toYear - 2;   // 2024, 2025, 2026 → three calendar years
```

Expose the exact semantics in the UI label (`2024 – 2026`) so the user is never guessing whether "3 years" means rolling 36 months or three calendar years. Provide a preference (`searchYears`; key, type, default and range in `07-architecture-and-data-model.md` §8.5) that changes the default span.

**What bioRxiv and medRxiv contribute, and what the checkbox therefore means.** `02-literature-database-apis.md` §8.4 establishes that neither server has a keyword search: their APIs filter by date, category, funder and DOI prefix only. Both are still v1 sources under decision **D2** (`00-overview.md` §3) and both ship enabled, but on a keyword run their adapter does ID-based lookup and preprint↔published resolution rather than search — keyword discovery of preprints goes through Europe PMC `SRC:PPR` and Crossref `type:posted-content`. **Decision (2026-09-09): both ship enabled, and the status block states their role rather than a count.** The alternative — shipping them unchecked — hides the problem instead of explaining it: a user who ticks the box still gets nothing back and still has no idea why.

So the per-source status block in §4.6 must **never** render a count, a "searching…" spinner, or an empty result for these two on a keyword run. It renders their actual contribution:

```
│  │  bioRxiv ............. ⊕ ID lookup · preprint matching                  │  │
```

The `⊕` glyph is reserved for this state — *contributing, but not by searching* — and must not be reused for errors or for zero-result searches, which have their own states in §4.6. A genuine failure on these adapters (a 503 on an ID lookup, say) still renders as an error; the point is that **absence of search results is not a failure for them and must not be drawn as one**.

Hovering the row explains it in one sentence, and the sentence names where keyword discovery of preprints actually happens: Europe PMC `SRC:PPR` and Crossref `type:posted-content`.

> **Decided 2026-10-19 (owner; `plan/00` §6 item 207): an empty selection reopens empty.** The Databases row is the
> `sources` preference's only control (`07-architecture-and-data-model.md` §8.5), and each tick or untick writes the
> ticked set back to it. Unticking every database writes `""`, and the window used to read that back on the next open
> as "all ticked", silently undoing the user's choice. Membership in the preference is the enable flag, so a stored
> list that names no source is an empty selection: the window reopens with every box unticked, Search disabled and
> FR-2's inline "select at least one database" message showing, exactly as it was left. Only a preference that cannot
> be read at all falls back to §8.5's all-seven default. No preference was added and the `sources` default is
> unchanged. Decided in one place, `initialSelection` (with `normalizePrefs`) in `addon/content/searchDialog.js`.

### 4.3 Result table

Zotero's table component lives at [`chrome/content/zotero/components/virtualized-table.jsx`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/components/virtualized-table.jsx) (2336 lines on `main`). Several things about it are easy to get wrong:

* It is a **React component**, not a custom element, and it is **CommonJS** — `ChromeUtils.importESModule()` does not work on it, and it did *not* get ESM-ified in Zotero 8. You reach it through Zotero's own CJS loader, which `chrome://zotero/content/include.js` installs: `require('components/virtualized-table')`, `require('react')` (React **18.3.1**), `require('react-dom')`.
* ⚠️ **`require.js` captures `window`/`document` from the scope that loaded it**, and the table's `renderCell()` calls bare `document.createElement`. **Load `include.js` inside the same window that hosts the table.** Zotero's own `progressQueueTable.jsx` carries the warning that getting this wrong will "segfault Zotero".
* **There is no `getRowData` prop.** Required props are only `id`, `getRowCount`, and `renderItem`. `getRowData` is the *argument to* `makeRowRenderer(getRowData)`, which produces `renderItem`.
* No `IntlProvider` is needed — `react-intl` is a stale `package.json` entry, and there are zero references to it in the client. Mount with React 18's `createRoot`.

Exports: `VirtualizedTable` (default), plus `VirtualizedTree` (Zotero 10 only), `TreeSelection`, `TreeSelectionStub`, `renderCell`, `renderCheckboxCell`, `makeRowRenderer`, `formatColumnName`.

Column shape: `dataKey` (required), `label` (required — plain string or i18n id), `flex` (default 1), `width`, `fixedWidth`, `staticWidth`, `minWidth`, `primary`, `renderCell` (Zotero 10 only). Cell `type` values honoured by `makeRowRenderer`: `'checkbox'`, `'button'`, `'html'`, otherwise plain text.

```javascript
// searchDialog.js — loaded from the dialog document, so `require` binds to THIS window
const React = require('react');
const ReactDOM = require('react-dom');
const VirtualizedTable = require('components/virtualized-table');
const { makeRowRenderer } = VirtualizedTable;

const columns = [
  { dataKey: 'selected', label: '',        type: 'checkbox',
    width: '28', staticWidth: true, fixedWidth: true },
  { dataKey: 'title',    label: 'Title',   primary: true, flex: 4 },
  { dataKey: 'authors',  label: 'Authors', flex: 2 },
  { dataKey: 'year',     label: 'Year',    width: '60', staticWidth: true, fixedWidth: true },
  { dataKey: 'source',   label: 'Source',  width: '110', staticWidth: true },
  { dataKey: 'type',     label: 'Type',    width: '90',  staticWidth: true },
  { dataKey: 'doi',      label: 'DOI',     flex: 2 },
];

const container = document.getElementById('rh-results-container');
RH.ui.tableRoot = ReactDOM.createRoot(container);
RH.ui.tableRoot.render(React.createElement(VirtualizedTable, {
  id: 'rh-results',
  ref: (ref) => { RH.ui.table = ref; },
  columns,
  showHeader: true,
  multiSelect: true,
  staticColumns: true,               // no column picker / no persisted prefs
  containerWidth: container.clientWidth,
  disableFontSizeScaling: false,     // honour the user's font-size preference
  getRowCount: () => RH.state.filteredResults.length,
  renderItem: makeRowRenderer((i) => rowToStrings(RH.state.filteredResults[i])),
  getRowString: (i) => RH.state.filteredResults[i].title,   // find-as-you-type + a11y
  label: 'Search results',                                   // accessible table name
  onSelectionChange: (selection) => RH.ui.updateImportButton(selection),
  onActivate: (_e, indices) => RH.ui.togglePicked(indices),  // Enter / double-click
  onColumnSort: (colIndex, ascending) => RH.ui.sortResults(colIndex, ascending),
}));

window.addEventListener('unload', () => RH.ui.tableRoot?.unmount());
```

Instance methods on the ref: `invalidate()`, `rerender()`, `invalidateRow(i)`, `invalidateRange(a, b)`, `scrollToRow(i)`, and `.selection` (a `TreeSelection`, with `.selected` and `.count`).

The closest in-tree model to copy is `chrome/content/zotero/renameFilesPreview.{xhtml,js}` (added in Zotero 8) — a self-contained dialog mounting a `VirtualizedTable`.

**Toolkit wrapper.** `zotero-plugin-toolkit`'s `VirtualizedTableHelper` hides all of the above:

```typescript
new ztoolkit.VirtualizedTable(win)
  .setContainerId("rh-results-container")
  .setProp({ id: "rh-results", columns, showHeader: true, multiSelect: true,
             getRowCount: () => RH.state.filteredResults.length,
             getRowData: (i) => rowToStrings(RH.state.filteredResults[i]) })
  .render();
```

If you supply `getRowData` and no `renderItem`, the helper builds `renderItem` via `makeRowRenderer` for you. ⚠️ **Do not call its `setLocale()`** — it mutates the global `Zotero.Intl.strings`. Set `label` per column instead.

> **Decision for `research_helper`:** use a **plain scrollable `<html:table>` for v1.** Our result sets are bounded (≤200 per database, a few hundred rows total), which a plain table handles comfortably, and it removes the CJS-loader/window-scope hazard and a React dependency from the critical path. Adopt `VirtualizedTable` only if profiling shows a problem — and if you do, budget time for the `include.js`-in-the-right-window problem.

Whichever you use, **always set `getRowString`** (accessible row name + type-to-find) and **`label`** (accessible table name), and leave `disableFontSizeScaling` false.

### 4.4 Import pipeline (what the button does)

```
click Import
  → collect picked records
  → resolve target collection (create if "New collection…")
  → dedup pass: for each record, findByDOI / findByPMID  (01-doc §5.5)
      ├─ existing → per user preference: skip | add existing item to collection | import anyway
      └─ new      → queue
  → mapPool(queue, concurrency)                                  (01-doc §10.1)
      ├─ preferred: Zotero.Translate.Search identifier lookup    (01-doc §6.2)
      └─ fallback:  hand-mapped new Zotero.Item                  (01-doc §5.2)
  → abstract backfill from the API record where empty
  → single Zotero.DB.executeTransaction for the batch save       (01-doc §5.8)
  → tag all created items `research_helper`
  → report: "Imported 37 · Skipped 12 duplicates · 1 failed"
```

Progress is shown **inside the window's status bar** (because we need a Cancel button), and a `Zotero.ProgressWindow` toast is raised only on completion so the user gets feedback if they have switched away from the window.

### 4.5 Wireframe

```
┌ Research Helper — Search & Import ────────────────────────────────────────────┐
│                                                                               │
│  Keyword  ┌──────────────────────────────────────────────┐  ┌──────────────┐  │
│           │ lipid nanoparticle CRISPR delivery           │  │   Search     │  │
│           └──────────────────────────────────────────────┘  └──────────────┘  │
│                                                                               │
│  Years    [ 2024 ▾ ] – [ 2026 ▾ ]   (last 3 years)     Max per database [100] │
│                                                                               │
│  Databases  ☑ PubMed   ☑ Europe PMC   ☑ Crossref   ☑ Semantic Scholar         │
│             ☑ arXiv    ☑ bioRxiv      ☑ medRxiv                               │
│                                                                               │
│  ───────────────────────────────────────────────────────────────────────────  │
│  Filter ┌───────────────────────┐   ☑ Hide items already in my library        │
│         │ hepatocyte            │                        142 results · 37 new │
│         └───────────────────────┘                                             │
│  ┌───┬────────────────────────────────┬──────────────┬─────┬──────────┬─────┐ │
│  │ ☑ │ Title                          │ Authors      │Year │ Source   │Type │ │
│  ├───┼────────────────────────────────┼──────────────┼─────┼──────────┼─────┤ │
│  │ ☑ │ In vivo CRISPR-Cas9 editing of │ Kim, Park,   │2026 │ PubMed   │ art │ │
│  │   │ hepatocytes via ionizable LNPs │ Novak +5     │     │ Crossref │     │ │
│  │ ☑ │ Ionizable lipid design rules   │ Chen, Ito    │2025 │ bioRxiv  │ pre │ │
│  │ ☐ │ Off-target profiling of base   │ Adeyemi +11  │2024 │ EuropePMC│ art │ │
│  │ ☑ │ Scalable LNP manufacturing for │ Rossi, Weber │2026 │ Crossref │ art │ │
│  │   │ nucleic-acid therapeutics      │              │     │          │     │ │
│  │ ☐ │ ⚠ already in library:          │ Kim, Park    │2025 │ S2       │ art │ │
│  │   │   Lipid carriers for gene ed…  │              │     │          │     │ │
│  │ … │                                │              │     │          │     │ │
│  └───┴────────────────────────────────┴──────────────┴─────┴──────────┴─────┘ │
│  [ Select all ] [ Select none ] [ Invert ]                    28 selected     │
│                                                                               │
│  ───────────────────────────────────────────────────────────────────────────  │
│  Import into  [ ▾ CRISPR delivery / 2026 screen        ]  [ New collection… ] │
│  Duplicates  ( ) Skip  (•) Add existing item to collection  ( ) Import anyway │
│                                                                               │
│  ⟳ Searching Europe PMC…  ████████████░░░░░░░░  5 of 7 databases    [Cancel]  │
│                                                                               │
│                                        [  Close  ]  [  Import 28 items  ]     │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 States

**Initial (no search run)**

```
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                         │  │
│  │        Enter a keyword and press Search to query the selected           │  │
│  │        databases for papers from the last 3 years.                      │  │
│  │                                                                         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
```

**Re-run (pre-filled from provenance)** — `10-requirements-and-user-stories.md` **FR-12**

Reached from **collection context menu ▸ Research Helper ▸ Re-run This Search…** (§2.5), which opens this window with `mode: "rerun"` and the collection's ID. The window loads the collection's `SearchProvenance` row (`07-architecture-and-data-model.md` §5.3 — the authoritative copy is the `search_provenance` table, not the FR-8 note) and pre-fills every control from it: keyword, source checkboxes, max-per-database, the recorded date window, and the client-side filters. The mode chip reads `Re-run: <collection name>`. This is the *initial* state of the window for that mode; once the user presses Search, the Searching / results / error states below are identical to a keyword run.

```
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  ⟳ Re-run of the search that built “CRISPR delivery / 2026 screen”      │  │
│  │    Recorded 2026-03-14 · 5 databases · 142 retrieved · 37 imported      │  │
│  │                                                                         │  │
│  │    Years  [ 2024 ▾ ] – [ 2026 ▾ ] (•) as recorded ( ) advance to today  │  │
│  │    Keyword, sources, max-per-database and filters are pre-filled from   │  │
│  │    the stored provenance record, and all stay editable.                 │  │
│  │                                                                         │  │
│  │    Press Search to run it again. Items already in this collection are   │  │
│  │    counted as “already present”, never imported twice.                  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
```

Four rules this state must hold, all of them FR-12's:

1. **Everything is editable.** The provenance record seeds the controls; it does not lock them. A re-run the user has adjusted is a normal run and writes its own new provenance record — it never overwrites the one it was seeded from.
2. **The date choice is explicit, and "as recorded" is the default.** The "advance to today" radio moves only the *upper* bound to the current date, leaving the recorded lower bound alone, so the re-run returns what has appeared since. It does **not** recompute the window from §4.2's calendar-year rule — that would move the lower bound too and silently change what is being compared.

   > **Decided 2026-10-16 (owner; `plan/00` §6 item 217): the upper bound never moves backwards.** "Advance to today"
   > sets the upper bound to the **later** of the recorded upper bound and today — `max(recorded, today)`, compared as
   > `YYYY-MM-DD` dates in the local calendar. A recorded window that already ends after today (a record written with a
   > future end date, or read on a machine whose clock is behind) is kept as recorded rather than narrowed. The lower
   > bound is never touched by this rule. Computed in one place, `toSearchParams` in `src/core/provenance.ts`; the
   > window's `rerunWindow` only picks between the two windows the host computed.
3. **The target collection is fixed to the collection the menu was invoked on**, with "New collection…" still available for a user who wants a side-by-side comparison rather than a top-up.
4. **Import reports "already present: N"** rather than counting duplicates as imports, using the same DOI/PMID dedup pass §4.4 already runs. The status line reads `Imported 9 · Already present 128 · 1 failed`.

A collection with no provenance row cannot reach this state: §2.5 hides the menu entry rather than opening a window with nothing to pre-fill.

> **Measured 2026-10-15 (`P2-T17`): "already present" means *in the library*, not *in this collection*.** The importer
> reports only "matched an existing item in the library" (`linkedExisting`) and "skipped as a duplicate" (`skipped`, which
> also counts a `workKey` repeated inside one run); it cannot tell whether a matched item was already in the target
> collection. The shipped summary counts `linkedExisting + skipped`, and the banner says "in your library". A true
> "already in this collection" count needs a per-record write report from the importer. The banner does not claim the
> client-side filters were pre-filled: §5.3's record has no field for them.

**Searching**

```
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  PubMed .............. ✓ 43 results                                     │  │
│  │  Europe PMC .......... ⟳ searching…                                     │  │
│  │  Crossref ............ ✓ 50 results                                     │  │
│  │  Semantic Scholar .... ✓ 31 results                                     │  │
│  │  arXiv ............... ✓  4 results                                     │  │
│  │  bioRxiv ............. ⊕ ID lookup · preprint matching                  │  │
│  │  medRxiv ............. ⊕ ID lookup · preprint matching                  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
```

Per-database status is essential: partial failure across seven sources is the *normal* case, and collapsing it into one spinner hides the fact that a whole database was missed.

**No results**

```
│  │  No papers found for “lipid nanoparticle CRISPR delivery” in 2024–2026. │  │
│  │                                                                         │  │
│  │  Try: broadening the year range · removing quotation marks ·            │  │
│  │       enabling more databases                                           │  │
```

**All databases failed**

```
│  │  ⚠ Could not reach any database.                                        │  │
│  │    PubMed: HTTP 429 (rate limited — add an NCBI API key in Preferences) │  │
│  │    Crossref: network error                                              │  │
│  │                                     [ Open Preferences… ]  [ Retry ]    │  │
```

> **Decided 2026-10-16 (owner; `plan/00` §6 item 220): the buttons follow the failed sources, not the run.** Since item
> 204 a run whose every searching source failed also carries a run-level `SOURCE` error. When at least one source
> carries its own error, the panel skips that run-level error twice over: it adds no line to the details disclosure,
> and it plays no part in choosing the buttons. Each button is drawn when at least one failed source's §8.3 row offers
> it (`P1-T22`), so a run where every source failed only on a refused key shows **Open Preferences… alone**, and an
> offline-only run shows **Retry alone**. The run-level error is used only when no source carries an error of its own —
> for example a run that `Planning` rejected before any source was asked. The wireframe above shows a mixed run, which
> draws both buttons.

> **Decided 2026-10-19 (owner; `plan/00` §6 item 205): "Open Preferences…" is not always shown.** `P2-T14` step 5
> asked for the button in every all-failed panel. The owner kept item 220's rule instead: the buttons follow each
> failed source's own error, through that error's §8.3 row (`P1-T22`). "Open Preferences…" is drawn when at least one
> failed source's row offers it — today a missing, refused or forbidden key, a configuration error and an exhausted
> quota (`ERROR_ROWS` in `src/ui/viewModels/searchImportViewModel.ts`) — because only then can Preferences help; a run
> whose sources all failed offline shows **Retry alone**, and a button that could not fix anything is not drawn.
> Behaviour unchanged by this note.

---

## 5. Related Papers flow

Launched from **item context menu ▸ Research Helper ▸ Find Related Papers…** with exactly one regular item selected.

### 5.1 Behaviour

1. Read identifiers off the seed item: `DOI` field, `PMID:` / `PMCID:` lines in `Extra`, arXiv ID in `archiveID`, plus `title` as a last resort.
2. Fan out:
   * **References** — Crossref `/works/{doi}` `reference[]`, Semantic Scholar `/paper/{id}/references`
   * **Citations** — Semantic Scholar `/paper/{id}/citations`, Europe PMC `citedBy`
   * **Recommendations** — Semantic Scholar recommendations endpoint
   * **Semantic similarity** — embedding/keyword similarity against the seed abstract (fallback when the seed has no DOI)
3. Merge, dedup, and score. Each result carries a **relation kind** badge.
4. Present in the same window as §4, with the mode chip showing the seed title and an extra **Relation** column.
5. On import, additionally set a Zotero item relation between seed and imported item:

```javascript
seed.addRelatedItem(newItem);
newItem.addRelatedItem(seed);
await seed.saveTx();
await newItem.saveTx();
```

Zotero relations are **bidirectional only if set on both sides** — this is exactly how the [Zotero JavaScript API docs](https://www.zotero.org/support/dev/client_coding/javascript_api) show it. Do both, inside the batch transaction.

### 5.2 Wireframe (differences from §4 only)

```
┌ Research Helper — Related Papers ─────────────────────────────────────────────┐
│                                                                               │
│  Seed  📄 In vivo CRISPR-Cas9 editing of hepatocytes via ionizable LNPs       │
│         Kim, Park, Novak et al. · Nature Biotechnology · 2026 · 10.1038/…     │
│                                                                               │
│  Include  ☑ References (37)  ☑ Citations (58)  ☑ Recommended (20)             │
│           ☑ Semantically similar (25)                                         │
│  Years    [ Any ▾ ] – [ Any ▾ ]   ☐ Restrict to last 3 years                  │
│                                                                               │
│  ┌───┬──────────────────────────────┬────────────┬─────┬──────────┬─────────┐ │
│  │ ☑ │ Title                        │ Authors    │Year │ Relation │ Score   │ │
│  ├───┼──────────────────────────────┼────────────┼─────┼──────────┼─────────┤ │
│  │ ☑ │ Ionizable lipid design rules │ Chen, Ito  │2025 │ cited by │ ●●●●○   │ │
│  │ ☑ │ Endosomal escape mechanisms  │ Ferreira   │2024 │ reference│ ●●●○○   │ │
│  │ ☐ │ mRNA vaccine LNP formulation │ Sato +7    │2023 │ similar  │ ●●○○○   │ │
│  └───┴──────────────────────────────┴────────────┴─────┴──────────┴─────────┘ │
│                                                                               │
│  Import into  [ ▾ Related to “In vivo CRISPR-Cas9…” ]  [ New collection… ]    │
│  ☑ Link imported items as “Related” to the seed item                          │
│                                                                               │
│                                        [  Close  ]  [  Import 12 items  ]     │
└───────────────────────────────────────────────────────────────────────────────┘
```

Note the **year filter is off by default here**. The 3-year restriction is a discovery heuristic for keyword search; for citation graphs it would silently discard the foundational papers that are the whole point of following references.

### 5.3 Edge cases

| Case | Handling |
|---|---|
| Seed has no DOI/PMID/arXiv ID | Fall back to title-based lookup on Crossref/S2; show a banner "No identifier found — matched by title, results may be less accurate" |
| Seed identifier not found upstream | Per-source row shows "not indexed"; other sources still run |
| Seed is a preprint with a published version | Offer to also fetch relations for the published DOI |
| Result already in library | Same treatment as §4 (marked, optionally hidden) |

---

## 6. Collection Report flow

Launched from **collection context menu ▸ Research Helper ▸ Generate Research Trends Report…**

### 6.1 Pipeline

```
Stage 1  Collect      → collection.getChildItems(), filter to regular items
Stage 2  Summarize    → per-item summary (cache hit skips the call)
                        bounded concurrency; per-item progress
Stage 3  Synthesize   → single LLM call over all summaries → trends report
                        STREAMED into the preview pane
Stage 4  Deliver      → Save as note | Save as Markdown | Generate audio
```

Stages 1–3 are one cancellable job. Stage 4 is a set of independent user actions on the finished report.

### 6.2 Streaming preview

Streaming uses `fetch` + `ReadableStream` from the plugin sandbox, with the chunks pushed into the dialog's DOM (see `01-zotero-plugin-platform.md` §8.4 for the generator and its caveats).

```javascript
// In the report window's controller
const preview = doc.getElementById("rh-report-preview");
const controller = new AbortController();
doc.getElementById("rh-report-cancel")
   .addEventListener("command", () => controller.abort());

let markdown = "";
try {
  for await (const delta of RH.llm.streamReport({ summaries, signal: controller.signal })) {
    markdown += delta;
    // Cheap incremental paint: append text, re-render markdown only on idle
    preview.textContent = markdown;
    preview.scrollTop = preview.scrollHeight;
  }
  RH.state.report = markdown;
  setStage("done");
} catch (e) {
  if (e.name === "AbortError") { setStage("cancelled"); }
  else { setStage("error", e); }
}
```

Two performance notes: re-parsing Markdown on every token will pin the UI thread, so paint raw text during the stream and render formatted output once on completion (or throttle re-render to `requestIdleCallback`). And keep the preview scrolled to the bottom only while the user has not scrolled up themselves — a jumping viewport is the most common complaint about streaming UIs.

**If streaming is unavailable** (see the unverified caveat in `01-zotero-plugin-platform.md` §8.4), the same window shows a determinate-less progress bar with "Writing report…" and paints the whole document on arrival. The delivery options in Stage 4 are identical either way.

### 6.3 Delivery options

| Option | Implementation | Placement |
|---|---|---|
| **Save as note** | `new Zotero.Item('note')` with Markdown converted to Zotero's note HTML subset; `setCollections([collectionID])` | Standalone note in the reported collection |
| **Save as Markdown** | Write file, then `Zotero.Attachments.importFromFile({ file, parentItemID, contentType: 'text/markdown' })` — or a file picker for "save outside Zotero" | Attachment on the report note, or user-chosen path |
| **Save as audio** | Gemini TTS → bytes → temp file → `importFromFile({ contentType: 'audio/wav' })` | Attachment on the report note |
| **Copy to clipboard** | `ztoolkit.Clipboard` (or `Zotero.Utilities.Internal.copyTextToClipboard`) | — |

All three "save" paths attach to a single **report note** so the artefacts stay together and a single delete removes them.

Filenames are derived from the collection name and date and **must be sanitised** — see `01-zotero-plugin-platform.md` gotcha #19, and note that Zotero 10 throws on attachment filenames containing slashes:

```javascript
function safeBaseName(s) {
  return (s || "report")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "report";
}
const base = `${safeBaseName(collection.name)} — trends ${new Date().toISOString().slice(0, 10)}`;
```

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286; written here 2026-10-27 by `P4-T15`).** In v1, **"Save as Markdown" writes a file the user places** through a native save dialog. It is **not** an attachment on the report note: the `importFromFile` variant above waits in the backlog with the `.html` export (`plan/00` §6 item 287(c); `06-summarization-and-trend-report.md` §14.3 D-06-10), so "All three 'save' paths attach to a single report note" holds for the note and audio only. The file holds numeric `[n]` markers and DOI links, never `zotero://` links (`06-…` §14.3).

> **Decided 2026-10-27 (`P4-T15`; `safeBaseName` and `reportExportFileName` in `src/pipeline/trendReport/exportMarkdown.ts`).** The save dialog's suggested name is `safeBaseName(collectionName)` + ` — trends ` + the date + `.md`. Three readings of the sketch above: (1) **the date is the report's generation date** (`TrendReport.generatedAtEpochMs`, UTC, as `toISOString` gives it), not the moment of export, so a report exported twice suggests one name; (2) **the 80-character cap counts code points**, not UTF-16 units, so a name is never cut inside a surrogate pair; (3) **the name is trimmed again after the cap**, so a cut never leaves a trailing space. The character class, the whitespace collapse and the `"report"` fallback are the sketch's, unchanged. The dialog itself is opened by the report window document and the chosen path handed inward (`P4-T20`), as `P1-T36` measured for FR-8's JSON export.

### 6.4 Wireframes

**Stage 1–2, summarizing**

```
┌ Research Helper — Collection Report ──────────────────────────────────────────┐
│                                                                               │
│  Collection  📁 CRISPR delivery / 2026 screen        47 papers (3 skipped:    │
│                                                       notes & attachments)    │
│                                                                               │
│  Language  [ English ▾ ]                                                      │
│  Model: claude-sonnet-5 (Anthropic) — set in Research Helper's preferences.   │
│                                                                               │
│  ───────────────────────────────────────────────────────────────────────────  │
│  Step 1 of 2 — Summarizing papers                                             │
│                                                                               │
│  ████████████████████████░░░░░░░░░░░░░░░░  31 / 47   (18 cached, 13 new)      │
│                                                                               │
│  ✓ In vivo CRISPR-Cas9 editing of hepatocytes…                                │
│  ✓ Ionizable lipid design rules for hepatic…                                  │
│  ⟳ Off-target profiling of base editors in…                                   │
│  ⚠ Scalable LNP manufacturing… — no abstract or full text, skipped            │
│  · Endosomal escape mechanisms…                                               │
│                                                                               │
│                                                             [   Cancel   ]    │
└───────────────────────────────────────────────────────────────────────────────┘
```

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286); written here 2026-10-29 by `P4-T19`.** The
> sketch above showed a per-run "Model" dropdown and "Depth ( ) Brief (•) Standard ( ) Detailed".
> `07-architecture-and-data-model.md` §8.5 declares no depth setting and no per-run model. **The window
> shows the resolved report model as text, changed in preferences, and has no Depth control;
> `report.targetWords` stays the length control** (it is not user-visible). The alternative not taken:
> add both as new settings. The sketch above is corrected to match.
>
> **As built 2026-10-29 (`P4-T19`; readings of points this document leaves open, for the owner to
> confirm).** (1) **The model line** is the `strong` chain's answer (`reportModel`, then
> `<provider>.model`; `07-…` §8.5) with the provider's display name, e.g. "Model: claude-sonnet-5
> (Anthropic) — set in Research Helper's preferences."; when every setting in the chain is empty it
> says that no report model is set. `reportModel` itself has no control in the preferences pane (§8.5:
> "Not in the pane"), so "set in preferences" holds through `<provider>.model`. (2) **The language
> selector** offers the four values of `reportLanguage` (`auto`, `en`, `ko`, `both`), starts on the
> preference's value, and is a per-run override that is never written back to the preference (§10.4).
> "English" and "한국어" are each language's own name, as §7.3's preference markup draws them; `auto`
> and `both` read "Same as Zotero's language" and "English and Korean". (3) **The window** is modeless
> and has its own document and bundle: `chrome://research-helper/content/reportWindow.xhtml` with
> `research-helper-reportWindow.ftl` (§10.1), `<window><dialog>` as §4.1.1 draws it, one window per
> collection (named `research-helper-report-<collection id>`, so a second click raises the first), its
> title "Research Helper — Collection Report" as above, and one Close button (Escape closes too). It
> is closed when the plugin shuts down. (4) **What `P4-T19` built is the shell only**: the collection
> line, the language selector, the model line and Close. Generate, the stage rows, the streamed
> preview, Cancel and the delivery buttons are `P4-T20`'s, which drives the job through the window's
> host (`plan/07` `P4-T20`).

**Stage 3, streaming**

```
┌ Research Helper — Collection Report ──────────────────────────────────────────┐
│  Step 2 of 2 — Writing report                          ⟳ streaming…           │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ # Recent Research Trends — CRISPR delivery / 2026 screen                │  │
│  │                                                                         │  │
│  │ ## Overview                                                             │  │
│  │ Across 44 papers published 2024–2026, three directions dominate:        │  │
│  │ ionizable-lipid chemistry, tissue-selective targeting, and in vivo      │  │
│  │ safety characterisation.                                                │  │
│  │                                                                         │  │
│  │ ## 1. Ionizable lipid chemistry (18 papers)                             │  │
│  │ Structure–activity work has converged on branched-tail ionizable        │  │
│  │ lipids with apparent pKa 6.2–6.6. Chen & Ito (2025) report▌             │  │
│  │                                                                         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                             [   Cancel   ]    │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Stage 4, done**

```
┌ Research Helper — Collection Report ──────────────────────────────────────────┐
│  ✓ Report ready — 44 papers · claude-sonnet-5 · 2,140 words · 38 s            │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ Recent Research Trends — CRISPR delivery / 2026 screen                  │  │
│  │ ═════════════════════════════════════════════════════════════════════   │  │
│  │ Overview                                                                │  │
│  │   Across 44 papers published 2024–2026, three directions dominate…      │  │
│  │ 1. Ionizable lipid chemistry (18 papers)                                │  │
│  │   Structure–activity work has converged on branched-tail ionizable…     │  │
│  │ 2. Tissue-selective targeting (14 papers)                               │  │
│  │ 3. In vivo safety and durability (12 papers)                            │  │
│  │ Open questions                                                          │  │
│  │ References                                                          ▼   │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  Save as   ☑ Note in this collection                                          │
│            ☑ Markdown attachment                                              │
│            ☐ Audio (spoken report)  Language [ Korean ▾ ] Voice [ Charon ▾ ]  │
│                                                                               │
│      [ Copy ]  [ Regenerate ]                    [  Close  ]  [   Save   ]    │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Audio generation**

```
│  🔊 Generating audio…  ██████████░░░░░░░░  segment 4 / 9                      │
│     Long reports are split into segments and concatenated.       [ Cancel ]   │
```

> **Unverified:** whether Zotero 10's built-in **Read Aloud** (introduced in Zotero 9, improved in Zotero 10) exposes any plugin-facing API that we could use to play a generated report, or to register a voice. A [forum feature request asking for Read Aloud on plugin-generated text](https://forums.zotero.org/discussion/131551/read-aloud-for-plugin-generated-text) (2026-05) received no staff answer, and no `Zotero.ReadAloud`-style API appears in the Zotero 10 developer changelog. **Plan for Gemini TTS producing an audio file that becomes a normal Zotero attachment**, which the user plays with their OS player — do not design around a Read Aloud integration that may not exist.

---

## 7. Preferences pane

### 7.1 Registration

Schema read from [`chrome/content/zotero/xpcom/preferencePanes.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/preferencePanes.js) on `main`, JSDoc verbatim:

```javascript
/**
 * Register a pane to be displayed in the preferences. The pane XHTML (`src`)
 * is loaded as a fragment, not a full document, with XUL as the default
 * namespace and (X)HTML tags available under `html:`.
 *
 * The pane will be unregistered automatically when the registering plugin
 * shuts down.
 *
 * @param {Object} options
 * @param {string} options.pluginID ID of the plugin registering the pane
 * @param {string} options.src URI of an XHTML fragment, optionally relative to the plugin's root
 * @param {string} [options.id] Represents the pane and must be unique. Automatically generated if not provided
 * @param {string} [options.parent] ID of parent pane (if provided, pane is hidden from the sidebar)
 * @param {string} [options.label] Displayed as the pane's label in the sidebar.
 * 		If not provided, the plugin's name is used
 * @param {string} [options.image] URI of an icon to be displayed in the navigation sidebar, optionally relative to
 * 		the plugin's root. If not provided, the plugin's icon (from manifest.json) is used.
 * @param {string[]} [options.scripts] Array of URIs of scripts to load along with the pane, optionally relative to
 * 		the plugin's root
 * @param {string[]} [options.stylesheets] Array of URIs of CSS stylesheets to load along with the pane, optionally
 * 		relative to the plugin's root
 * @param {string} [options.helpURL] If provided, a help button will be displayed under the pane
 * 		and the provided URL will open when it is clicked
 * @return {Promise<string>} Resolves to the ID of the pane if successfully added
 */
```

Five things worth noting that are easy to miss:

* `register` is **async** and resolves to the pane ID (auto-generated as `plugin-pane-${randomString}-${pluginID}` if you omit `id`).
* Panes **unregister automatically on plugin shutdown** — you do not need to track the ID (unlike menus and item-pane sections).
* Paths may be **relative to the plugin root**, so `src: 'content/preferences.xhtml'` works without `rootURI`.
* ⚠️ **There is no `l10nID` option.** `label` is a raw string. Localize it yourself, or omit it and let Zotero use the plugin name from `manifest.json`.
* ⚠️ **`defaultXUL` is not a caller option** — `register()` hardcodes `defaultXUL: true` internally. Do not pass it.

Registering or unregistering a pane calls `_refreshPreferences()`, which does `win.location.reload()` on every open `zotero:pref` window. That is why panes appear immediately during development, and why you should not register panes in a loop.

```javascript
await Zotero.PreferencePanes.register({
  pluginID: "research-helper@suppakoko.github.io",
  id: "rh-prefpane",
  src: "content/preferences.xhtml",
  scripts: ["content/preferences.js"],
  stylesheets: ["content/preferences.css"],
  label: "Research Helper",            // omit to use the plugin name from manifest.json
  image: "content/icons/favicon.png",
  helpURL: "https://github.com/suppakoko/research_helper#configuration",
});
```

### 7.2 Preference binding

Zotero's preferences window binds any element carrying a `preference` attribute. From [`chrome/content/zotero/preferences/preferences.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/preferences/preferences.js) on `main`:

```javascript
_syncFromPref(elem, preference, force = false) {
    let value = Zotero.Prefs.get(preference, true);
    ...
}
_syncToPrefOnModify(elem, preference) {
    ...
    Zotero.Prefs.set(preference, value, true);
    ...
}
```

Both use `global = true`, so **the `preference` attribute must be the FULL preference key**, including the `extensions.zotero.` prefix.

The binding mechanics, read from `_initImportedNodesPostInsert`:

* Each `[preference]` element gets a `Zotero.Prefs.registerObserver(key, …, true)`.
* Sync **to** the pref fires on `command`, `input` **and** `change`.
* Value mapping: `elem.checked` for `<html:input type="checkbox">` and XUL `<checkbox>`; `elem.value` for everything else — **coerced with `String(value)`**.
* `<menulist>` gets a `MutationObserver` so dynamically added `<menuitem>`s update the displayed label (which is how the model pickers in §7.3 work).
* A document-level `MutationObserver` on `attributeFilter: ['preference']` picks up elements inserted later.

> ⚠️ **Numeric preferences round-trip as strings through the `preference` attribute.** `String(value)` is applied on the way out. Read them back with `Zotero.Prefs.get()` and coerce yourself — `Number(Zotero.Prefs.get("research-helper.concurrency"))`. Silently doing string arithmetic on `maxResults` or `concurrency` is a classic and very confusing bug.

The code explicitly warns when it looks like you passed a legacy `<preference>` element ID instead:

```javascript
Zotero.warn('`preference` attribute value `' + preference + '` looks like a <preference> ID, '
    + 'although no element with that ID exists. Its value should be a preference key.');
```

The pane also observes DOM mutations (`attributeFilter: ['preference']`), so dynamically-inserted bound controls work. Custom events `syncfrompreference`, `beforesynctopreference` and `synctopreference` are dispatched on the element — useful for validating an API key the moment it is typed.

`<preference>` elements are **deprecated**. Do not use them.

### 7.3 Pane markup

> **Every `preference=` attribute below must be a key that exists in `07-architecture-and-data-model.md` §8.5**, spelled identically and fully qualified with the `extensions.zotero.research-helper.` prefix. §8.5 is the authoritative schema — key, type, default, allowed values — and this document does not restate defaults; where a control has a range or a value list, it is §8.5's range or value list. A `preference=` attribute naming a key that is not a §8.5 row is a bug, and so is a §8.5 value that the control cannot produce. Every key bound here also needs a `pref()` default line in `01-zotero-plugin-platform.md` §7.2, or the control reads `undefined` on first paint.

XUL is the default namespace; HTML is available under `html:`. Fragments **cannot have a `<!DOCTYPE>`**. Organise as top-level `<groupbox>`es: "By default, all text in the DOM is searchable. If you want to manually add keywords to an element … set its `data-search-strings-raw` property to a comma-separated list" ([Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)). The same page requires that "all `class`, `id`, and `data-l10n-id` in the preference pane should be namespaced to avoid conflicting between plugins."

Fluent goes in a XUL `<linkset>`, and each `<groupbox>` should carry `aria-labelledby` pointing at its heading — this is the pattern Zotero's own `preferences_general.xhtml` uses:

```xml
<groupbox aria-labelledby="rh-providers-title">
  <label><html:h2 id="rh-providers-title" data-l10n-id="research-helper-prefs-providers"/></label>
  …
</groupbox>
```

> **Corrected 2026-10-15 (owner review of 2026-10-14, row 51; shipped by `P1-T44`).** The `<linkset>`
> below named `research-helper-preferences.ftl`, a fourth bundle. The pane's strings ship in the
> **main-window bundle**, `research-helper-mainWindow.ftl`, with their ids declared on
> `MAIN_WINDOW_MESSAGE_IDS` in `src/i18n/keys.ts` (35 ids, `PREFERENCES_L10N … satisfies Record<string,
> MainWindowMessageId>`). The reason `P1-T44` gives: the pane is a **fragment inside a window Zotero
> owns** (`zotero:pref`), which is that bundle's first job under §10.1's surface rule — a surface earns
> its own file only when it owns a window — and a fourth bundle would need a `SHIPPED_SURFACES` entry and
> the l10n integration spec to learn it. §10.1 is corrected the same way.

```xml
<!-- content/preferences.xhtml — a FRAGMENT: no <!DOCTYPE>, no <html> wrapper -->
<vbox
    xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
    xmlns:html="http://www.w3.org/1999/xhtml">

  <linkset>
    <!-- the main-window bundle, not a fourth file — see the note above (2026-10-15) -->
    <html:link rel="localization" href="research-helper-mainWindow.ftl"/>
  </linkset>

  <!-- ============ LLM providers ============ -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-providers"/></label>

    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-active-provider"
             control="rh-provider"/>
      <menulist id="rh-provider"
                preference="extensions.zotero.research-helper.llmProvider"
                native="true">
        <menupopup>
          <menuitem value="openrouter" label="OpenRouter"/>
          <menuitem value="openai"     label="OpenAI"/>
          <menuitem value="gemini"     label="Google Gemini"/>
          <menuitem value="anthropic"  label="Anthropic"/>
        </menupopup>
      </menulist>
    </hbox>

    <!-- One block per provider; JS shows only the active one -->
    <!-- NOTE: the key field carries NO `preference` attribute. Binding it would write the
         key to Zotero.Prefs, i.e. plaintext `user_pref(...)` in the profile — forbidden by
         decision D5 and by 09-security-privacy-and-api-keys.md §1.7 tier 4. The field is
         driven imperatively by preferences.js against the SecretStore (OSKeyStore +
         Services.logins). Only the non-secret `*.keyPresent` booleans live in prefs. -->
    <vbox id="rh-provider-openrouter" class="rh-provider-block">
      <hbox align="center">
        <label data-l10n-id="research-helper-prefs-api-key" control="rh-or-key"/>
        <html:input id="rh-or-key" type="password" class="rh-key" size="46"
                    placeholder="sk-or-…"/>
        <button id="rh-or-reveal" data-l10n-id="research-helper-prefs-reveal"/>
        <button id="rh-or-test"   data-l10n-id="research-helper-prefs-test"/>
        <button id="rh-or-clear"  data-l10n-id="research-helper-prefs-clear-key"/>
      </hbox>
      <html:p class="rh-hint" id="rh-or-backend" role="status"/>   <!-- storage-backend badge -->

      <hbox align="center">
        <label data-l10n-id="research-helper-prefs-model" control="rh-or-model"/>
        <menulist id="rh-or-model" editable="true"
                  preference="extensions.zotero.research-helper.openrouter.model">
          <menupopup/>   <!-- populated at load from the provider's /models -->
        </menulist>
        <button id="rh-or-refresh" data-l10n-id="research-helper-prefs-refresh-models"/>
      </hbox>
      <!-- Base-URL override, required by FR-29. EMPTY = the base URL doc 03 §5.1 documents
           for this provider; the placeholder shows that default so the field is never a
           guess. Schema row: 07-… §8.5. Resolution and the two rules on an overridden value
           (https only; the egress dialog names the EFFECTIVE host) are 03-… §14.4's.
           This is not a credential field — it carries a `preference` binding. -->
      <hbox align="center">
        <label data-l10n-id="research-helper-prefs-base-url" control="rh-or-base-url"/>
        <html:input id="rh-or-base-url" type="url" size="46"
                    placeholder="https://openrouter.ai/api/v1"
                    preference="extensions.zotero.research-helper.openrouter.baseUrl"/>
      </hbox>
      <!-- Key status. NO `preference` attribute: this is output, not input. preferences.js
           paints it from the non-secret `<provider>.keyPresent`, `<provider>.lastValidatedAt`
           and `<provider>.lastValidationResult` prefs (07-… §8.5), whose values doc 09 §2.3–2.4
           own — "" / ok / rejected / forbidden / inconclusive. A binding here would try to
           write a status back into a pref the SecretStore owns. -->
      <html:p class="rh-hint" id="rh-or-status" role="status"/>
    </vbox>

    <!-- rh-provider-openai / -gemini / -anthropic: identical structure, each with its own
         `<provider>.model` and `<provider>.baseUrl` bindings and its own placeholder -->

    <!-- Residual-risk statement, doc 09 §1.8, verbatim and always visible -->
    <html:p class="rh-hint" data-l10n-id="research-helper-prefs-key-storage-note"/>
    <hbox>
      <button id="rh-clear-all-keys" data-l10n-id="research-helper-prefs-clear-all-keys"/>
    </hbox>
  </groupbox>

  <!-- ============ Search ============ -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-search"/></label>

    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-default-years" control="rh-years"/>
      <html:input id="rh-years" type="number" min="1" max="20" size="4"
                  preference="extensions.zotero.research-helper.searchYears"/>
    </hbox>
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-max-results" control="rh-max"/>
      <html:input id="rh-max" type="number" min="10" max="200" step="10" size="4"
                  preference="extensions.zotero.research-helper.maxResults"/>
    </hbox>
    <checkbox data-l10n-id="research-helper-prefs-use-translators"
              preference="extensions.zotero.research-helper.useTranslators"/>
    <checkbox data-l10n-id="research-helper-prefs-hide-existing"
              preference="extensions.zotero.research-helper.hideExisting"/>
  </groupbox>

  <!-- ============ NCBI ============ -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-ncbi"/></label>
    <html:p class="rh-hint" data-l10n-id="research-helper-prefs-ncbi-note"/>
    <hbox align="center">
      <!-- General contact address, not NCBI-specific: sent only as Crossref's `mailto`.
           NCBI always gets the maintainer address (02-…§2.2). The label and hint must say
           so — naming this "NCBI e-mail" would be actively misleading. -->
      <label data-l10n-id="research-helper-prefs-contact-email" control="rh-contact-email"/>
      <html:input id="rh-contact-email" type="email" size="36"
                  preference="extensions.zotero.research-helper.contactEmail"/>
    </hbox>
    <!-- Also a credential: SecretId "source.ncbi" in 09-…§1.7. No `preference` binding.
         Same control set as an LLM provider block above — reveal / test / clear, a storage-
         backend badge and a key-status line — because 09-… §1.9 rule 5 requires the status
         row for all SIX credentials, not just the four LLM ones. NOTE the button uses
         `research-helper-prefs-test-key`, the id the Semantic Scholar block already uses;
         the LLM blocks use `research-helper-prefs-test` for the same button. Two ids for one
         string is a small localization defect: collapse them onto one id when §10.2's key
         list is next revised. -->
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-ncbi-key" control="rh-ncbi-key"/>
      <html:input id="rh-ncbi-key" type="password" size="36"/>
      <button id="rh-ncbi-reveal" data-l10n-id="research-helper-prefs-reveal"/>
      <button id="rh-ncbi-test"   data-l10n-id="research-helper-prefs-test-key"/>
      <button id="rh-ncbi-clear"  data-l10n-id="research-helper-prefs-clear-key"/>
      <html:span id="rh-ncbi-backend" class="rh-backend-badge"/>
    </hbox>
    <!-- Key status, same contract as `rh-or-status`: NO `preference` attribute, painted by
         preferences.js from `ncbi.keyPresent`, `ncbi.lastValidatedAt` and
         `ncbi.lastValidationResult` (07-… §8.5). The test call and the outcome→enum mapping
         are 09-… §2.3's. This element earns its place: a wrong NCBI key produces no error at
         all, it silently costs the user the keyed 10 req/s budget (02-… §3.1), so this line
         is the only place that failure is ever visible. Until 09-… §2.3's `> Unverified:`
         callout is closed, a failed test paints `inconclusive` — "could not verify this key"
         — and never "this key is wrong". -->
    <html:p class="rh-hint" id="rh-ncbi-status" role="status"/>
  </groupbox>

  <!-- ============ Semantic Scholar ============ -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-s2"/></label>
    <html:p class="rh-hint" data-l10n-id="research-helper-prefs-s2-note"/>
    <!-- Credential: SecretId "source.semanticscholar" in 09-…§1.7. No `preference` binding. -->
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-s2-key" control="rh-s2-key"/>
      <html:input id="rh-s2-key" type="password" size="46"/>
      <button id="rh-s2-reveal" data-l10n-id="research-helper-prefs-reveal"/>
      <button id="rh-s2-test" data-l10n-id="research-helper-prefs-test-key"/>
      <button id="rh-s2-clear" data-l10n-id="research-helper-prefs-clear-key"/>
      <html:span id="rh-s2-backend" class="rh-backend-badge"/>
    </hbox>
    <!-- Key status, same contract as `rh-or-status` and `rh-ncbi-status`: no `preference`
         attribute, painted by preferences.js from `semanticscholar.keyPresent`,
         `semanticscholar.lastValidatedAt` and `semanticscholar.lastValidationResult`
         (07-… §8.5); test call and outcome→enum mapping in 09-… §2.3. This is the most
         load-bearing of the six status lines: a Semantic Scholar key that is not being
         honoured does not slow feature 2 and feature 6 down, it drops them onto the
         saturated anonymous pool (02-… §6.4), which the user experiences as "the plugin is
         broken". Because a 429 cannot be told apart from that state, 09-… §2.3 maps it to
         `inconclusive` here rather than to the pass it means elsewhere, and the wording
         must match: "could not verify", not a green tick. -->
    <html:p class="rh-hint" id="rh-s2-status" role="status"/>
    <html:a id="rh-s2-request"
            href="https://www.semanticscholar.org/product/api#api-key-form"
            data-l10n-id="research-helper-prefs-s2-request"/>
  </groupbox>

  <!-- ============ Report & audio ============ -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-report"/></label>
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-report-language" control="rh-lang"/>
      <menulist id="rh-lang"
                preference="extensions.zotero.research-helper.reportLanguage">
        <menupopup>
          <menuitem value="auto" data-l10n-id="research-helper-lang-auto"/>
          <menuitem value="en"   label="English"/>
          <menuitem value="ko"   label="한국어"/>
          <!-- `both` is in the reportLanguage value set (07-…§8.5); an earlier
               draft of this markup omitted it, which made the pref unreachable. -->
          <menuitem value="both" data-l10n-id="research-helper-lang-both"/>
        </menupopup>
      </menulist>
    </hbox>
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-tts-voice" control="rh-voice"/>
      <menulist id="rh-voice"
                preference="extensions.zotero.research-helper.tts.voice">
        <menupopup/>   <!-- populated from the Gemini TTS voice list -->
      </menulist>
      <button id="rh-voice-preview" data-l10n-id="research-helper-prefs-preview-voice"/>
    </hbox>
    <!-- Audio file format. Value set `wav` | `mp3` is 07-…§8.5's; the trade-off it encodes
         (WAV ~28.8 MB per 10 min, MP3 ~3.6–9.6 MB) is owned by 04-audio-report-tts.md §6.4.
         Import-vs-link is decided by §10.2's 10 MB threshold, which a 10-minute WAV exceeds
         and an MP3 does not. The hint line states the size consequence, because it is the
         whole reason the control exists. -->
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-tts-format" control="rh-audio-format"/>
      <menulist id="rh-audio-format"
                preference="extensions.zotero.research-helper.tts.outputFormat">
        <menupopup>
          <menuitem value="wav" data-l10n-id="research-helper-audio-format-wav"/>
          <menuitem value="mp3" data-l10n-id="research-helper-audio-format-mp3"/>
        </menupopup>
      </menulist>
    </hbox>
    <html:p class="rh-hint" data-l10n-id="research-helper-prefs-tts-format-note"/>
    <checkbox data-l10n-id="research-helper-prefs-auto-summarize"
              preference="extensions.zotero.research-helper.autoSummarize"/>
  </groupbox>

  <!-- ============ Privacy ============ -->
  <!-- The GLOBAL default only. Per-collection overrides are unbounded in number, live in the
       `collection_settings` table (07-…§8.3) and are set from the collection context menu
       registered in §2.4 of this document; a per-collection setting can never loosen a stricter global one
       (09-security-privacy-and-api-keys.md §3.5). Value set is 07-…§8.5's. -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-privacy"/></label>
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-privacy-mode" control="rh-privacy"/>
      <menulist id="rh-privacy"
                preference="extensions.zotero.research-helper.privacy.mode">
        <menupopup>
          <menuitem value="strict"   data-l10n-id="research-helper-privacy-strict"/>
          <menuitem value="balanced" data-l10n-id="research-helper-privacy-balanced"/>
          <menuitem value="full"     data-l10n-id="research-helper-privacy-full"/>
        </menupopup>
      </menulist>
    </hbox>
    <!-- One line per mode, describing what leaves the machine. Text traces to doc 09 §3.5's
         table; it must not promise more than that table says. -->
    <html:p class="rh-hint" id="rh-privacy-explain" role="status"/>
  </groupbox>

  <!-- ============ Advanced ============ -->
  <groupbox>
    <label><html:h2 data-l10n-id="research-helper-prefs-advanced"/></label>
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-concurrency" control="rh-conc"/>
      <!-- Range is 1–8, owned by 07-architecture-and-data-model.md §7.2/§8.5.
           An earlier draft of this markup allowed 10. -->
      <html:input id="rh-conc" type="number" min="1" max="8" size="3"
                  preference="extensions.zotero.research-helper.concurrency"/>
    </hbox>
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-timeout" control="rh-timeout"/>
      <html:input id="rh-timeout" type="number" min="10" max="600" step="10" size="4"
                  preference="extensions.zotero.research-helper.timeoutSeconds"/>
    </hbox>
    <!-- Global cache cap. Range 100–5000 MB is 07-architecture-and-data-model.md §8.5's;
         07-… §9.2 requires this control to exist ("shown in preferences") and defers the number
         to 07-… §8.5. The per-namespace caps in 07-… §9.2 are fixed and are NOT settings. -->
    <hbox align="center">
      <label data-l10n-id="research-helper-prefs-cache-size" control="rh-cache-size"/>
      <html:input id="rh-cache-size" type="number" min="100" max="5000" step="100" size="5"
                  preference="extensions.zotero.research-helper.cache.maxSizeMB"/>
      <label data-l10n-id="research-helper-prefs-cache-size-unit"/>
    </hbox>
    <html:p class="rh-hint" id="rh-cache-breakdown" role="status"/>
    <!-- Verbose logging. NOTE: there is deliberately NO `debug` preference (07-… §8.5,
         Diagnostics). This checkbox is a convenience over `logLevel`, so it carries a
         scripted handler instead of a `preference=` binding: checked -> logLevel "debug",
         unchecked -> logLevel "warn"; preferences.js sets `checked` from the stored value
         on load. Binding it to a `debug` pref would reintroduce two switches over one
         logger. It does NOT touch `logRequestBodies`, which is a content switch, not a
         verbosity one, and stays out of the pane behind its own warning. -->
    <checkbox id="rh-verbose-logging" data-l10n-id="research-helper-prefs-debug"/>
    <hbox>
      <button id="rh-clear-cache" data-l10n-id="research-helper-prefs-clear-cache"/>
      <button id="rh-clear-summaries" data-l10n-id="research-helper-prefs-clear-summaries"/>
      <button id="rh-clear-embeddings" data-l10n-id="research-helper-prefs-clear-embeddings"/>
      <button id="rh-clear-jobs"  data-l10n-id="research-helper-prefs-clear-jobs"/>
    </hbox>
    <hbox>
      <button id="rh-delete-all-data" data-l10n-id="research-helper-prefs-delete-all-data"/>
      <button id="rh-reset"       data-l10n-id="research-helper-prefs-reset"/>
    </hbox>
    <!-- Where the plugin database lives, so a user preparing a shared backup knows what is
         in it (09-security-privacy-and-api-keys.md §3.7, last bullet). -->
    <html:p class="rh-hint" id="rh-data-location"/>
  </groupbox>
</vbox>
```

**Controls in this pane that are not `preference=` bindings.** Three, and each is deliberate:

| Control | Why not a binding | What the script does |
|---|---|---|
| Every API-key field | A binding writes to `Zotero.Prefs`, i.e. plaintext `user_pref(...)` — forbidden by **D5** and `09-security-privacy-and-api-keys.md` §1.7 | Driven imperatively against the `SecretStore`; only the `*.keyPresent` booleans are prefs |
| `rh-verbose-logging` | There is no `debug` pref to bind to (`07-architecture-and-data-model.md` §8.5, Diagnostics) | On load, `checked = getPref("logLevel") === "debug"`. On toggle, `setPref("logLevel", checked ? "debug" : "warn")`. It never touches `logRequestBodies`. |
| The four clear buttons and **Delete all plugin data** | Actions, not settings | Each is the corresponding item in `09-security-privacy-and-api-keys.md` §3.7's required list. **"Clear generated summaries" must state, in the confirmation, that it does *not* delete the Zotero notes** — notes are user data and are removed only through Zotero's own UI (doc 09 §3.7). `rh-data-location` shows where the plugin database lives, per the same section. |

> **Corrected 2026-10-23 (`P3-T04`; measured in the `omni.ja` files of Zotero 10.0.3).** Two controls in the
> markup above cannot be built as drawn, and the pane ships them differently:
> 1. **The base-URL input carries no `preference=` attribute.** Zotero's `_syncToPrefOnModify`
>    (`chrome/content/zotero/preferences/preferences.js`) writes the element's value on every `input`,
>    `change` and `command` event, and its `beforesynctopreference` event is a plain, non-cancelable `Event`
>    dispatched after the value has been read, so a bound field stores every keystroke and cannot refuse a
>    value. `03-llm-provider-integration.md` §14.4 requires the value to be validated at write time, so
>    `preferences.js` sends it on `change` through `PreferencesHostApi.setBaseUrl`, which writes
>    `<provider>.baseUrl` only for an absolute `https://` URL with no trailing slash, no user name or
>    password, no `?` and no `#`, or for an empty value. Anything else is refused with a message and the
>    stored value is kept. The placeholder is still the documented base URL. This is a fourth control in the
>    table above.
> 2. **The model control is an `<html:input>` bound to `<provider>.model`, not an editable `<menulist>`.**
>    Toolkit's `menulist.js` (`chrome/toolkit/content/global/elements/menulist.js`) keeps an `editable`
>    check only in `setInitialSelection` and has no text-entry part, so an `editable="true"` menulist takes
>    no typed model ID, and a non-editable one shows a blank label for a stored ID that is not one of its
>    items. The input accepts any model ID, as `07-architecture-and-data-model.md` §8.5 allows; offering the
>    catalogue's models as suggestions is `P3-T14`'s.

> **Added 2026-10-23 (`P3-T14`; the card's reading, for the owner to confirm).** `preferences.js` builds three
> things as DOM inside elements the markup already has, so the markup above is unchanged:
> 1. **Beside each model input, a non-editable suggestion `<menulist>`** whose first item is a prompt. Picking
>    an item types its ID into the input and fires `input` and `change`, so Zotero's own `preference=`
>    binding stores it; the script still writes no preference. Any ID can still be typed. Under the input's
>    row, a status line gives the list's date, or says it is the built-in list of its documented date and may
>    be out of date (the catalogue's stale fallback). **The list is fetched the first time any suggestion
>    list is opened, not when the pane loads**, so opening Settings contacts no provider the user did not ask
>    for (the catalogue reads OpenRouter's public list and each configured provider's own); a successful
>    Test refills that provider's list from the models it returned.
> 2. **The Test button of each LLM block is live.** The host tests the key through that provider's own
>    adapter (`validateCredentials()`), paints the outcome inline, and every status row is painted from
>    `<provider>.lastValidationResult` / `.lastValidatedAt` when the pane loads.
> 3. **"Your model prices"**, appended to the LLM providers group: one line per `user_price` row with a
>    Remove button, and a form (model ID, input, output, optional cached input, as-of date) that adds or
>    replaces a row for the provider chosen in the menulist above. The store's refusal is shown as a message.
>
> *Decided 2026-10-23 (owner, `plan/00` §6 items 279(a), (c) and (d)):* (a) a Test answered "out of credit"
> (`QuotaExceededError`) paints `research-helper-prefs-test-ok-no-credit`, "Key accepted, but the account has no
> credit left · checked { $time }", instead of the accepted line; a plain rate-limit 429 keeps
> `research-helper-prefs-test-ok-rate-limited` (`09-security-privacy-and-api-keys.md` §2.3). The line is shown at the
> Test; the stored result is `ok`, which repaints as the plain accepted line. (c) confirmed: the suggestions are
> fetched when a list is first opened, never when Settings opens. (d) now that results are stored, a stored key with
> no stored result reads `research-helper-prefs-key-present`, "A key is stored. Not tested yet." (it read "… Not
> tested yet this session."). A model list fetched for the suggestions also refreshes the prices the spend guard
> reserves with (`07-architecture-and-data-model.md` §4.3's note of this date, item 278(b)), and a price saved or
> removed here reaches the guard at once.

> ⚠️ **Zotero 8+ isolates preference-pane global scope.** A `var` declared in `preferences.js` is not shared with other panes or the prefs window. Attach anything you need across scopes to `window` explicitly ([Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers)).

### 7.4 Wireframe

```
┌ Zotero Settings ──────────────────────────────────────────────────────────────┐
│ ┌───────────────┐ ┌───────────────────────────────────────────────────────┐   │
│ │ ⚙ General     │ │  Research Helper                                      │   │
│ │ 👤 Sync       │ │                                                       │   │
│ │ ⤓ Export      │ │ ┌ LLM providers ────────────────────────────────────┐ │   │
│ │ ❝ Cite        │ │ │ Active provider  [ OpenRouter          ▾ ]        │ │   │
│ │ 🔧 Advanced   │ │ │                                                   │ │   │
│ │ ───────────── │ │ │ API key  [sk-…••••1a2b] [👁] [Test] [Clear]       │ │   │
│ │ 🔎 Research   │ │ │ 🔒 Protected by Windows Credential Manager        │ │   │
│ │    Helper     │ │ │ Model     [ anthropic/claude-sonnet-5  ▾] [↻]     │ │   │
│ │               │ │ │ Base URL  [ https://openrouter.ai/api/v1        ] │ │   │
│ │               │ │ │ ✓ Key valid · 312 models available                │ │   │
│ │               │ │ │                                                   │ │   │
│ │               │ │ │ Your API keys are encrypted using your operating  │ │   │
│ │               │ │ │ system's credential store and stored in Zotero's  │ │   │
│ │               │ │ │ login manager… It does not protect them from      │ │   │
│ │               │ │ │ software running under your own user account —    │ │   │
│ │               │ │ │ including any other Zotero plugin.                │ │   │
│ │               │ │ │ (Verbatim §1.8 text of doc 09; full text shown,   │ │   │
│ │               │ │ │  elided here only for the wireframe.)             │ │   │
│ │               │ │ │ [ Remove all stored keys ]                        │ │   │
│ │               │ │ └───────────────────────────────────────────────────┘ │   │
│ │               │ │                                                       │   │
│ │               │ │ ┌ Search ───────────────────────────────────────────┐ │   │
│ │               │ │ │ Default year range      [ 3 ] years back          │ │   │
│ │               │ │ │ Max results per database[ 100 ]                   │ │   │
│ │               │ │ │ ☐ Fetch metadata through Zotero translators       │ │   │
│ │               │ │ │    (slower, more accurate)                        │ │   │
│ │               │ │ │ ☑ Hide results already in my library              │ │   │
│ │               │ │ └───────────────────────────────────────────────────┘ │   │
│ │               │ │                                                       │   │
│ │               │ │ ┌ NCBI (PubMed / Europe PMC) ───────────────────────┐ │   │
│ │               │ │ │ This address is sent to Crossref only. NCBI       │ │   │
│ │               │ │ │ always receives the maintainer's address instead. │ │   │
│ │               │ │ │ An NCBI API key raises the limit 3 to 10 req/sec. │ │   │
│ │               │ │ │ Contact   [ you@example.org              ]        │ │   │
│ │               │ │ │ API key   [••••••••••] [👁] [Test] [Clear]        │ │   │
│ │               │ │ │ 🔒 Windows Credential Manager                     │ │   │
│ │               │ │ │ ✓ Key valid · 10 req/sec · checked 2026-09-09     │ │   │
│ │               │ │ └───────────────────────────────────────────────────┘ │   │
│ │               │ │                                                       │   │
│ │               │ │ ┌ Semantic Scholar ─────────────────────────────────┐ │   │
│ │               │ │ │ Related papers and recommendations need a key —   │ │   │
│ │               │ │ │ the anonymous pool is rate-limited to the point   │ │   │
│ │               │ │ │ of being unusable. Free, but approval takes time. │ │   │
│ │               │ │ │ API key   [••••••••••] [👁] [Test] [Clear]        │ │   │
│ │               │ │ │ 🔒 Keychain                                       │ │   │
│ │               │ │ │ ? Could not verify — rate-limited. Try again.     │ │   │
│ │               │ │ │ Request an API key →                              │ │   │
│ │               │ │ └───────────────────────────────────────────────────┘ │   │
│ │               │ │                                                       │   │
│ │               │ │ ┌ Report & audio ──────────────────────────────────┐  │   │
│ │               │ │ │ Report language  [ Follow Zotero language ▾ ]    │  │   │
│ │               │ │ │ TTS voice        [ Charon                 ▾ ] ▶  │  │   │
│ │               │ │ │ Audio format     [ WAV                    ▾ ]    │  │   │
│ │               │ │ │   WAV keeps full quality but is ~29 MB per 10    │  │   │
│ │               │ │ │   minutes, so it is linked, not copied into      │  │   │
│ │               │ │ │   Zotero, and does not sync. MP3 is ~4–10 MB     │  │   │
│ │               │ │ │   and is copied in, counting against your        │  │   │
│ │               │ │ │   Zotero storage quota.                          │  │   │
│ │               │ │ │ ☐ Summarize items automatically when selected    │  │   │
│ │               │ │ └──────────────────────────────────────────────────┘  │   │
│ │               │ │                                                       │   │
│ │               │ │ ┌ Privacy ─────────────────────────────────────────┐  │   │
│ │               │ │ │ Default privacy mode [ Balanced           ▾ ]    │  │   │
│ │               │ │ │   Sends metadata, abstracts and PDF full text.   │  │   │
│ │               │ │ │   Never sends your notes, annotations, or        │  │   │
│ │               │ │ │   collection names. A collection can be set      │  │   │
│ │               │ │ │   stricter from its context menu.                │  │   │
│ │               │ │ └──────────────────────────────────────────────────┘  │   │
│ │               │ │                                                       │   │
│ │               │ │ ┌ Advanced ────────────────────────────────────────┐  │   │
│ │               │ │ │ Parallel requests [ 3 ]   Timeout [ 60 ] sec     │  │   │
│ │               │ │ │ Cache limit       [ 500 ] MB                     │  │   │
│ │               │ │ │   Using 214 MB — summaries 180, searches 28,     │  │   │
│ │               │ │ │   embeddings 6                                   │  │   │
│ │               │ │ │ ☐ Verbose debug logging                          │  │   │
│ │               │ │ │ [ Clear cached responses ] [ Clear summaries ]   │  │   │
│ │               │ │ │ [ Clear embeddings ]       [ Clear job history ] │  │   │
│ │               │ │ │ [ Delete all plugin data ] [ Reset all settings ]│  │   │
│ │               │ │ │   Plugin data: C:\Users\you\Zotero\              │  │   │
│ │               │ │ │   research-helper.sqlite                         │  │   │
│ │               │ │ └──────────────────────────────────────────────────┘  │   │
│ │               │ │                                              [ ? ]    │   │
│ └───────────────┘ └───────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘
```

A wireframe has to draw *some* value in every field, so the ones above are the shipped defaults —
`concurrency`, `timeoutSeconds`, `cache.maxSizeMB`, `searchYears` and `maxResults` as
`07-architecture-and-data-model.md` §8.5 ships them (the cache-usage breakdown and the data-directory
path are illustrative, not defaults). **They are a rendering of §8.5, not a second declaration of it:**
§8.5 is the only place a default may be changed, and if a figure drawn here ever disagrees with that
table, this picture is the defect. An earlier draft of this wireframe drew 50 results and a 120-second
timeout, neither of which was ever a §8.5 value.

**The two source-credential blocks now draw the same five affordances as the provider block** — masked field, reveal, Test, Clear, a storage-backend badge and a key-status line — because `09-security-privacy-and-api-keys.md` §1.9 rule 5 requires a status row for all six credentials, not just the four LLM ones. The two status lines are drawn deliberately in *different* states: NCBI shows the `ok` reading (§2.3 derives it from `X-Ratelimit-Limit: 10`), and Semantic Scholar shows the `inconclusive` one, which is what a 429 must produce there — §2.3 explains that a 429 from S2 cannot be told apart from the key not being honoured at all. Neither line may ever be drawn red on a failed test until §2.3's `> **Unverified:**` callout is closed; "could not verify" is the honest wording, and it is what §7.5 rule 2 requires here.

### 7.5 API-key UX rules

The authoritative requirements are `09-security-privacy-and-api-keys.md` §1.9; this section restates them for the pane and must not diverge from it.

1. `type="password"` always, with a **hold-to-show** reveal, not a sticky toggle. Once a key is stored it is **never re-displayed**: the field shows a masked digest (`sk-…••••1a2b`, first 3 + last 4 characters), and `SecretStore.get()` is never called to populate a UI field.
2. **Test** button performs a minimal, cheap call (e.g. list models) and reports inline: `✓ Key valid`, `✗ 401 Unauthorized`, `✗ Network error`. Never a modal. **All six credentials have one** — the NCBI and Semantic Scholar blocks included — and the call each one makes, plus the outcome-to-status mapping, is `09-security-privacy-and-api-keys.md` §2.3's, not this document's. For those two the only wording currently permitted on a non-success outcome is the neutral "could not verify", because §2.3 maps every such outcome to `inconclusive` until its `> **Unverified:**` callout is closed; a red `✗` there would invite the user to delete a key that works.
3. On paste, trim whitespace and strip a leading `Bearer `.
4. Show only the active provider's block; keep the others' stored keys.
5. Never write a key into `Zotero.debug()` output, an error message, or a saved note. Never place a key on the clipboard; there is no "copy key" affordance.
6. ⛔ **The key field carries no `preference` attribute and no key is ever written to `Zotero.Prefs`** (decision D5; doc 09 §1.7 tier 4 is explicitly not implemented). Keys go through `Zotero.OSKeyStore.encrypt()` → `Services.logins`. Only the non-secret trio lives in prefs — `research-helper.<provider>.keyPresent`, `.lastValidatedAt` and `.lastValidationResult`, one set for each of the six credential IDs (`07-architecture-and-data-model.md` §8.5).
7. A **storage-backend badge** next to the key fields names the active tier — "Protected by Windows Credential Manager" / "macOS Keychain" / "System keyring", or a warning-coloured "Not saved between sessions" / "Protected by your passphrase" in degraded tiers, or doc 09 §1.9's fourth state "Stored in Zotero's database — protected only by your primary password". **Added 2026-10-15 (owner review row 50): a warning-coloured *indeterminate* state** — en-US "Indeterminate — this operating system does not reveal the key-storage tier", ko-KR 「확인 불가 — 이 운영체제에서는 열쇠 보관 등급을 판별할 수 없습니다」 — shown when the probe succeeded but its answer cannot be classified, which on Linux is always, because a missing keyring library does not make `encrypt()` fail (`P1-T41`; doc 09 §1.9 item 3 is the authority, this line restates it). The badge never claims a tier the probe cannot tell apart; `G-09`'s library-presence check retires the state.
8. The residual-risk statement of doc 09 §1.8 appears in the pane **verbatim and visible** (not behind a "Learn more" link), including the sentence that other Zotero plugins can read the keys.
9. A **Remove all stored keys** button clears every `SecretId` and reports how many were removed.
10. On an empty-key state after a data-directory restore, explain *why*: keys live in this computer's credential store and do not travel with the Zotero data folder. *(Added 2026-10-23, `P3-T04`: the pane shows this as one notice under the badge when no key of any `SecretId` is stored, the plugin database already holds data — a row in any of its tables — and the badge names an operating-system store; doc 09 §1.9 item 8 says why only then.)*

---

## 8. Notifications, errors, and empty/loading states

### 8.1 Which mechanism, when

| Situation | Mechanism |
|---|---|
| Long job with a Cancel affordance | In-window status bar + progress (§4, §6) |
| Job completed while its window is closed or backgrounded | `Zotero.ProgressWindow` toast |
| Short background action (single-item summarize from the context menu) | `Zotero.ProgressWindow` only |
| Recoverable error inside a window | Inline banner in that window, `role="alert"` |
| Configuration error (no key) | Inline empty state + "Open Preferences…" |
| Unrecoverable/unexpected error | Inline banner + `Zotero.logError(e)`; never a modal alert |

**No modal `alert()` or `Services.prompt` for anything the user did not just click.** Modals over a library window are hostile and can appear behind the main window.

### 8.2 `Zotero.ProgressWindow` usage

Signatures read from [`chrome/content/zotero/xpcom/progressWindow.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressWindow.js):

⚠️ **Two arguments are commonly passed wrongly, because Zotero 7 changed them to CSS-icon keys:**

* `changeHeadline(text, cssIconKey, postText)` — the second argument is a **CSS icon key**, not a URL. Zotero builds `<span class="icon icon-16 icon-css icon-${cssIconKey}">`. Real in-tree call: `changeHeadline(Zotero.getString("ingester.scrapingTo"), collection ? 'collection' : 'library', name + "…")`.
* `new pw.ItemProgress(itemType, text, parentItemProgress)` — the first argument is an **item type string** (`'journalArticle'`, `'attachmentPDF'`, …), not an icon URL. There is **no `setIcon()`**; the method is `setItemTypeAndIcon(itemType, cssIcon = 'item-type')`. **`zotero-types@4.1.3` disagrees with this paragraph (measured 2026-09-30, `P1-T15`):** `types/xpcom/progressWindow.d.ts` declares `setIcon(iconSrc: string): void` and declares **no** `setItemTypeAndIcon`, and types `ItemProgress`'s first parameter as `iconSrc`. The two happen to agree that it is a `string`, so no cast is needed — but a caller who trusts the typings will pass an icon path and hit the bug this paragraph names. **Call neither icon setter until the signatures are confirmed against a running Zotero**, and keep the whole surface behind one wrapper so a correction is one edit (`src/zotero/progressWindow.ts`'s `openZoteroProgressWindow()`).

(`zoteroPane.js#_showPageSaveStatus` passes a PNG path to `addLines()` — that is a live Zotero bug. Do not copy it.)

```javascript
const pw = new Zotero.ProgressWindow({ closeOnClick: true });
pw.changeHeadline("Research Helper", "library", "Summarizing…");
pw.show();

const line = new pw.ItemProgress('journalArticle', 'Summarizing 3 items…');
line.setProgress(45);
line.setText('Summarizing… (45%)');

// indented child row under `line`
const child = new pw.ItemProgress('attachmentPDF', 'paper.pdf', line);
child.setProgress(100);

line.setProgress(100);
line.setText("Summarized 3 items");
// on failure: line.setError();

pw.addDescription('Done. <a href="https://example.org">Details</a>');
pw.startCloseTimer(4000);
```

`ItemProgress` is constructed off the **progress-window instance** (`new pw.ItemProgress(...)`), not off `Zotero`. `setProgress` takes 0–100 (values strictly between 0 and 100 render a sprite arc; 100 restores the real icon). `addDescription(text)` runs the text through `Zotero.Utilities.parseMarkup()`, turning `<a>` into text links. Everything except `show()`, `close()` and `startCloseTimer()` is deferred until the window loads, so ordering relative to `show()` does not matter — **except `startCloseTimer()`, which is a no-op if called before `show()`**. Default close timer is 2500 ms. `Zotero.ProgressWindowSet.closeAll()` closes everything.

Only two constructor options exist: `window` and `closeOnClick`.

`zotero-plugin-toolkit`'s `ProgressWindowHelper` wraps the same thing with `new ztoolkit.ProgressWindow(header, { window, closeOnClick, closeTime, closeOtherProgressWindows })` and chainable `.createLine({ type, icon, text, progress, idx }).show(closeTime)` / `.changeLine({...})` — `closeTime: -1` keeps it open. Its built-in `type` keys are only `success` and `fail`; the `type: "default"` seen everywhere in plugin code works only because those plugins first call `ztoolkit.ProgressWindow.setIconURI("default", …)` at startup. Either API is fine; the native one has no dependency.

### 8.2.1 `Zotero.ProgressQueue` — the per-item batch window

Zotero has a second, richer progress surface: the queue window used by "Retrieve Metadata for PDF". It **is** reachable from a plugin. Read from [`chrome/content/zotero/xpcom/progressQueue.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressQueue.js) (byte-identical across Zotero 8/9/10):

```javascript
Zotero.ProgressQueue.ROW_QUEUED     = 1;
Zotero.ProgressQueue.ROW_PROCESSING = 2;
Zotero.ProgressQueue.ROW_FAILED     = 3;
Zotero.ProgressQueue.ROW_SUCCEEDED  = 4;

const queue = Zotero.ProgressQueues.create({ id, title, columns });
Zotero.ProgressQueues.get(id);
Zotero.ProgressQueues.getAll();

queue.addRow(item);                               // takes a Zotero.Item
queue.updateRow(itemID, status, message);
queue.deleteRow(itemID);
queue.getRows() / getTotal() / getProcessedTotal();
queue.addListener(name, cb);                      // empty | cancel | rowadded | nonempty
                                                  // | rowupdated | rowdeleted
queue.cancel();

const dialog = queue.getDialog();
dialog.open(); dialog.close(); dialog.isOpen();
dialog.setStatus(msgOrL10nKey); dialog.showMinimizeButton(bool);
```

Three constraints that decide whether you can use it:

1. **The dialog renders exactly three fixed columns**, so `columns` must be an array of **exactly two localization keys**, and `title` is a localization key too — both go through `Zotero.getString()`.
2. ⚠️ **`Zotero.getString()` throws on an unknown key when `Zotero.locale === 'en-US'`.** A plugin's `.ftl` is registered into `L10nRegistry` but *not* into `getString`'s synchronous bundle.
3. ⚠️ **There is no `remove`/`destroy`.** A plugin-created queue leaks for the rest of the session.

> **Unverified:** whether `Zotero.ftl.addResourceIds(['research-helper.ftl'])` makes plugin FTL keys resolvable from `Zotero.getString()` — this is inferred from `intl.js` and `plugins.js` plus an in-source comment, not executed.
>
> **Decision for `research_helper`:** do **not** build the import or report UI on `ProgressQueue`. The two-l10n-key column constraint, the `getString` throw, and the session leak are all real, and we need a Cancel button and per-database status that its fixed three-column layout cannot express. Use the in-window status bar (§4, §6) plus `Zotero.ProgressWindow` toasts.

### 8.2.2 There is no toast/notification API

Searching the Zotero 10 tree for a general notification surface comes up empty: **`Zotero.Notifications` does not exist** in 7, 8, 9 or 10; there is no notification/toast/banner custom element among the ~55 files in `chrome/content/zotero/elements/`; and the banners that do exist (`scss/components/_banners.scss`) are hardcoded `<vbox class="banner-container">` nodes in `zoteroPane.xhtml` driven by one-off `ZoteroPane.show*Banner()` methods, with **no plugin entry point**.

Do not confuse `Zotero.Notifier` (the data-change observer bus) with UI notifications — it draws nothing.

The only adjacent primitive is `<guidance-panel>` (`chrome/content/zotero/elements/guidancePanel.js`), a XUL arrow panel for first-run hints anchored to an element. Useful for a one-time "Research Helper lives here" pointer at the Tools menu; not a notification system.

For modal confirmation, `Zotero.Prompt.confirm({ window, title, text, button0, button1, button2, checkLabel, checkbox, defaultButton, buttonDelay })` returns the index of the pressed button (constants `BUTTON_TITLE_OK`/`CANCEL`/`YES`/`NO`/`SAVE`/`DONT_SAVE`/`REVERT`; `delayButtons` is deprecated in favour of `buttonDelay`). `Zotero.alert(window, title, msg)` for a plain alert. Per §8.1, use these sparingly.

### 8.3 Error taxonomy and messages

Every error the user can see must say **what failed, why, and what to do**. Map provider/HTTP failures onto a small fixed set:

| Class | Trigger | Message (en-US) | Action offered |
|---|---|---|---|
| `NO_KEY` | provider key empty | "No API key configured for {provider}." | Open Preferences |
| `AUTH` | 401 / 403 | "{provider} rejected the API key (HTTP {status})." | Open Preferences |
| `RATE_LIMIT` | 429, or 503 w/ Retry-After | "{provider} rate limit reached. Retrying in {n}s." | Retry now / Cancel |
| `QUOTA` | 402 / provider quota error | "{provider} reports the account is out of credit." | Open provider dashboard |
| `TIMEOUT` | `Zotero.HTTP.TimeoutException` | "{host} did not respond within {n}s." | Retry / Increase timeout |
| `OFFLINE` | `Zotero.HTTP.BrowserOfflineException` | "Zotero is offline." | Retry |
| `UPSTREAM` | 5xx from a literature DB | "{database} is temporarily unavailable (HTTP {status}). Other databases were still searched." | Retry this database |
| `NO_CONTENT` | item has no abstract or full text | "No abstract or indexed full text — skipped." | (per-item, non-fatal) |
| `PARSE` | malformed provider response | "Could not read the response from {provider}." | Retry / Report issue |
| `CANCELLED` | user abort | "Cancelled. {n} items were already imported." | — |

> **Decided 2026-10-21 (owner; `plan/00` §6 item 232): the Search window shows a 429 refused after the retries as
> "{database}: too many requests, refused · try again in a moment".** The `RATE_LIMIT` row's "Retrying in {n}s" is
> not shown, because it would be false. Since 2026-10-20 the HTTP client retries a 429 inside the request
> (`07-architecture-and-data-model.md` §7.3), so by the time the window sees the error every automatic retry has
> already happened and nothing is retrying. The error the window receives does not carry the seconds either. The
> window shows the database name with "too many requests, refused · try again in a moment" instead (message
> `research-helper-search-error-rate-limit`, in `research-helper-searchDialog.ftl`), in that source's status row and in
> its line of the all-failed panel. The action offered is this row's **Retry** (the table's "Retry now"; Cancel is
> the window's own button), never Open Preferences, so under item 220's rule a run whose sources all failed on 429
> draws Retry alone. The Korean wording awaits the owner's review. The `rh-error-rate-limit` message, which is the
> `RateLimitError`'s own `messageKey`, keeps the table's wording and is not used by this row.

Always log the underlying exception with `Zotero.logError(e)` and, when debug logging is enabled, `Zotero.debug()` the request *shape* — never the key or the prompt body.

### 8.4 Empty and loading states — checklist

Every list-bearing surface needs all five:

```
1. INITIAL     nothing has been requested yet          → instruction, not a spinner
2. LOADING     request in flight                       → per-source progress, cancellable
3. EMPTY       request succeeded, zero results         → why + concrete suggestions
4. PARTIAL     some sources succeeded, some failed     → results + per-source warnings
5. ERROR       everything failed                       → cause + retry
```

The **PARTIAL** state is the one plugins usually forget, and for a seven-database aggregator it is the most common outcome.

---

## 9. Accessibility

**The bar is high, and it is not ours to lower.** Per [zotero.org/accessibility](https://www.zotero.org/accessibility): "As of October 2024, the Zotero desktop app fully meets the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA." Zotero 7 was audited by an independent external auditor for screen-reader and keyboard-only users, with regular testing against VoiceOver, NVDA and JAWS, and a VPAT 2.5 conformance report dated 2024-10-24.

**Our plugin's UI is not covered by that audit.** It is the weakest link in an otherwise conformant application, and a WCAG-AA claim on the host app is exactly what makes a non-conformant plugin surface conspicuous.

Zotero's UI is XUL-based and inherits Firefox's accessibility stack; XUL widgets (`menulist`, `checkbox`, `button`, `label` with `control=`) are accessible by default. Our obligations:

**Keyboard**

* Every action reachable by Tab in a sensible order; no keyboard traps in the modeless windows.
* `Enter` in the keyword field = Search; `Escape` closes the window (and cancels a running job first, with the second `Escape` closing).
* Result table: arrow keys move, `Space` toggles the row checkbox, `Ctrl/Cmd+A` selects all, type-to-find works (on the plain `<html:table>` §4.3 decides for v1, this means an accessible name on every row; on `VirtualizedTable`, should it ever be adopted, it is the `getRowString` prop — §4.3).
* Do not register global shortcuts. Zotero, its plugins, and the OS already compete for them; the menus are sufficient.

**Labels and roles**

* Every input has a `<label control="…">` or `aria-label`. XUL `label`'s `control` attribute is the XUL equivalent of HTML `for`. Every `<groupbox>` gets `aria-labelledby` pointing at its heading.
* Status regions: `role="status"` for progress text, `role="alert"` for errors (assertive), `aria-live="polite"` on the streaming report preview — but **set `aria-live` on the container only after streaming completes**, or a screen reader will read every token.
* The result table's `role` defaults to `'grid'`; set `label` (accessible table name) and `getRowString` (per-row accessible name, and find-as-you-type).
* **Item-pane sections get accessibility for free — via your `l10nID`.** `collapsibleSection.js` sets `role="button"`, `tabindex="0"`, `aria-expanded`, and derives the section's `aria-label` from `header.l10nID`. A section registered with a wrong or missing l10n ID is **unlabelled to a screen reader**. This makes `header.l10nID` an accessibility contract, not decoration.

**Font size, density, RTL**

⚠️ **Call `Zotero.UIProperties.registerRoot(rootEl)` in every plugin dialog's `init()`** (§4.1.1). It applies the `fontSize` preference, `--zotero-font-size`, `zoteroFontSize`, `--zotero-ui-density`, `zoteroUIDensity`, and `dir="rtl"` when `Zotero.rtl`. Skipping it means the dialog ignores the font size the user deliberately chose — a genuine defect for low-vision users, and one that is invisible in testing unless you change the preference.

For the result table, leave `disableFontSizeScaling` **false**.

**Visual**

* Never encode meaning in colour alone. The relation badges in §5 pair colour with text (`cited by`, `reference`, `similar`); the duplicate marker pairs colour with a ⚠ glyph and text.
* Use Zotero's CSS variables so light/dark and high-contrast modes follow the app. Menu icons should use `fill="context-fill"` in the SVG — the `menuManager.js` JSDoc explicitly recommends this "to use the default icon color for automatic hover and dark mode support". Supply `darkIcon` where a single icon cannot work.
* Respect the user's font size: Zotero scales UI text. Do not defeat it — with a plain `<html:table>` that means no fixed pixel font sizes, and on `VirtualizedTable` it means leaving the `disableFontSizeScaling` prop unset (§4.3).
* Do not set fixed pixel heights on text containers; long Korean and English strings differ in wrapping.

**Motion**

* The only animation is the progress bar. No spinners that convey nothing; where progress is determinate, show the number.

> **Unverified:** whether Zotero 10 ships a high-contrast/forced-colors stylesheet that plugin panes inherit automatically. Test the prefs pane and dialogs under Windows high-contrast mode before release.

---

## 10. Localization: English and Korean

### 10.1 Mechanics

Fluent, as described in `01-zotero-plugin-platform.md` §9. Files:

```
locale/
├── en-US/
│   ├── research-helper-mainWindow.ftl      (menus, item-pane section, and every dialog raised from them)
│   ├── research-helper-searchDialog.ftl    (searchDialog.xhtml, and the Related Papers reuse of it — §5)
│   └── research-helper-reportWindow.ftl    (reportWindow.xhtml — trend report viewer + audio player; Phase 3)
│                                           (preferences.xhtml has NO file of its own: its strings are in
│                                            research-helper-mainWindow.ftl — corrected 2026-10-15, see below)
└── ko-KR/
    ├── research-helper-mainWindow.ftl
    ├── research-helper-searchDialog.ftl
    └── research-helper-reportWindow.ftl
```

> **Measured 2026-10-15 in Zotero 10.0.3 (`P2-T14`): a value-only Fluent message on a XUL `<checkbox>` paints nothing.**
> Fluent writes a message's *value* into the element's text content, which replaces the checkbox's own label and box
> parts, so every Databases checkbox showed an empty label (owner review row 142). The window now resolves the name
> and sets the checkbox's `label` attribute (`applySourceNames` in `addon/content/searchDialog.js`), falling back to the
> source id. A message meant for a XUL control's label needs a `.label` attribute in the bundle, or a resolved `label`.

> **Corrected 2026-10-15 (owner review of 2026-10-14, row 51; shipped by `P1-T44`).** Until this date the
> tree and the table below listed a fourth bundle, `research-helper-preferences.ftl`, for the preferences
> pane. The shipped pane (`P1-T44`) keeps its 35 strings in **`research-helper-mainWindow.ftl`**, with the
> ids declared on `MAIN_WINDOW_MESSAGE_IDS` in `src/i18n/keys.ts`, and the owner chose to bring this
> document into line with the code. The reason `P1-T44` gives is the main-window rule this section already
> states: a surface earns its own FTL file only when it **owns a window**, and the preferences pane does
> not — it is a fragment inside Zotero's own `zotero:pref` window, exactly like the dialogs raised from the
> main window. A fourth bundle would also have needed a `SHIPPED_SURFACES` entry and the l10n integration
> spec to learn it. The surface *set* is still four surfaces (the pane keeps its XHTML fragment and its
> name); the *bundle* set is three files.

> **Tree corrected 2026-10-05 (`P1-T34`): flat directories, `research-helper-` prefixed filenames.** As printed until now this block showed a `locale/<locale>/research-helper/` **subdirectory** holding **unprefixed** filenames, which contradicted the table four lines below it — the one that says "FTL in `locale/<locale>/` (flat, `research-helper-` prefixed)" — and contradicted the paragraph between them, which claims this section's list wins over `07-architecture-and-data-model.md` §2.2's tree. A section cannot assert authority over a tree and then print that tree wrongly, and this is exactly the kind of block a later card types straight from. The layout above is the one that ships: `find addon/locale -type f` reads `addon/locale/{en-US,ko-KR}/research-helper-{mainWindow,searchDialog}.ftl` (Phase 1's two surfaces; the two Phase 3 surfaces above have no file yet). The subdirectory form would not have worked at all: `01-zotero-plugin-platform.md` §9.1 records, read verbatim from Zotero 10.0.1's `xpcom/plugins.js` by `P0-T10`, that `registerLocales()` enumerates `locale/<locale>/` and skips every entry not ending `.ftl`, so a **directory** entry is silently dropped — and that registered hrefs are flat, which is why the filename must carry the plugin prefix. Found by `P1-T32`. The *layout* is `01-…` §9.1's to own (its listing agrees with the one above); the *surface set and its names* remain this section's, per the paragraph below.

**This section owns the surface set and its names.** `07-architecture-and-data-model.md` §2.2 owns the *tree* — where the files sit in the repository — and defers to this list for what the surfaces are called; where the two disagree, this list wins and the tree is the defect. The mapping is one-to-one except at the two ends, and both exceptions are deliberate:

| Surface | XHTML in `addon/content/` | FTL in `locale/<locale>/` (flat, `research-helper-` prefixed) |
|---|---|---|
| Main window | **none** — it is Zotero's own window; the plugin injects menus and an item-pane section into it | `mainWindow.ftl` |
| Search & Import | `searchDialog.xhtml` | `searchDialog.ftl` |
| Report window | `reportWindow.xhtml` | `reportWindow.ftl` |
| Preferences | `preferences.xhtml` (a fragment in Zotero's `zotero:pref` window) | **`mainWindow.ftl`** — no file of its own *(corrected 2026-10-15, row 51; `P1-T44`)* |

One name was reconciled here on 2026-09-09. **`reportViewer` and `reportWindow` were one surface under two names** — `07-architecture-and-data-model.md` §2.2's tree said `reportViewer.xhtml` while this list said `reportWindow.ftl`; the surface is **`reportWindow`** and the XHTML file has been renamed to match, because the FTL name is the one that appears in `insertFTLIfNeeded` calls and in every `data-l10n-id` lookup path.

**`jobCenter` was removed from this list on 2026-09-09, and with it `jobCenter.xhtml` and `jobCenter.ftl`.** Earlier the same day the mismatch here was the opposite one — the surface had an XHTML file but no FTL, and one was added so that the durable job list would not ship as hard-coded English. The project owner then took the Job Center out of v1 altogether, deferring it to v1.1: `10-requirements-and-user-stories.md` §4 item 18 records the decision and its reasoning, and `07-architecture-and-data-model.md` §7.7.1 keeps the deferred design. The surface set above is therefore four surfaces, not five, and neither file exists in v1.

**The main-window rule, for dialogs raised from menus and the item pane.** A modal or transient dialog that the user opens *from the main window* — the Phase 3 cost-confirmation dialog, the first-use egress disclosure (`09-security-privacy-and-api-keys.md` §3.6), the summarize dialog — is **not** a new localization surface. Its strings go in `mainWindow.ftl`, and it does not get an FTL file of its own. The reason is mechanical rather than stylistic: `mainWindow.ftl` is already inserted into that window by `insertFTLIfNeeded` before any DOM is touched, so a dialog opened from it resolves its ids with no second registration, no second removal on unload, and no window in which a string can fail to resolve because its file has not been inserted yet. A surface earns its own FTL file when it owns a **window** — one that is opened with its own document, carries its own `<linkset>`, and can be open while the main window is not. `searchDialog` and `reportWindow` clear that bar; a cost-confirmation sheet does not, and **neither does `preferences`** — it is a fragment inside Zotero's `zotero:pref` window, so its strings live in `mainWindow.ftl` *(this sentence listed `preferences` among the window-owners until 2026-10-15; corrected per owner review row 51, `P1-T44`)*. This is also what `plan/`'s Phase 3 cards already do, and this paragraph is the rule they were following without one written down.

> **The Job Center gap is closed by dropping the surface, not by writing the section.** A note here earlier on 2026-09-09 flagged that this document had no section specifying the Job Center: §§2–7 above specify the menus, the item-pane section, the search window, the related-papers flow, the report flow and the preferences pane, and stop there, so the surface's *name* and its localization home were settled here while its layout, states and accessibility notes were written nowhere — and `07-architecture-and-data-model.md` §7.7 is a behaviour spec rather than a UI one. That is no longer an open v1 gap, because the surface is no longer in v1: it is deferred to v1.1 (paragraph above; `10-requirements-and-user-stories.md` §4 item 18). **The section becomes owed again the moment the Job Center is pulled into a release** — it is a window of ours, so it needs a UI specification in this document before anyone builds it, and `07-architecture-and-data-model.md` §7.7.1 lists that as the second thing v1.1 must do.

**Korean is a real Zotero UI locale.** `chrome/locale/ko-KR/zotero/zotero.ftl` (1133 lines vs 1342 for `en-US`), `preferences.ftl` and `zotero.properties` all exist in the [zotero/zotero repository](https://github.com/zotero/zotero/blob/main/chrome/locale/ko-KR/zotero/zotero.properties), with real translations (`general-print = 인쇄`, `general-remove = 제거`, `general-add = 추가`). Coverage is substantial but not complete — untranslated entries fall through to English within the same file. **The locale code is `ko-KR` exactly; there is no bare `ko`.**

**Zotero 10 reworked plugin localization.** Per `xpcom/plugins.js#registerLocales`, all plugins' strings are now consolidated into a single `L10nFileSource` registered as `zotero-plugins:{locale}/`, with fallback computed **per file, per Zotero locale**: exact match → same language → `en-US` → first available. The [Zotero 10 developer page](https://www.zotero.org/support/dev/zotero_10_for_developers) says this "fixes plugins that ship only a non-English locale showing that locale for all users, and competing registrations across plugins causing strings to fail to resolve."

⚠️ **Always ship `locale/en-US/` even though our primary audience is Korean.** On the pre-Zotero-10 fallback path, a plugin that ships only `ko-KR` shows Korean strings to *every* user regardless of their locale.

How each surface gets its strings:

| Surface | Mechanism |
|---|---|
| Menus (`MenuManager`) | `l10nID` + `l10nArgs`; the FTL entry **must** set the `.label` attribute |
| Item-pane section | `header.l10nID` / `sidenav.l10nID` — Zotero resolves them; nothing to insert |
| Prefs pane fragment | `<linkset><html:link rel="localization" href="research-helper-mainWindow.ftl"/></linkset>` — the main-window bundle, not a file of its own *(2026-10-15, row 51)* |
| Our own dialog windows (`searchDialog`, `reportWindow`) | `<linkset>` inside `<dialog>`, or `<html:link rel="localization">` — one per window, naming that window's own FTL file |
| Dialogs raised from the main window (cost confirmation, egress disclosure, summarize) | **Nothing to insert.** They resolve against the already-inserted `mainWindow.ftl`; see the main-window rule above |
| Main window (injected DOM) | `window.MozXULElement.insertFTLIfNeeded("research-helper-mainWindow.ftl")`, removed on unload |
| From JS, in a window | `document.l10n.setAttributes(el, id, args)`, `await document.l10n.formatValue(id, args)` |
| From JS, no window | `new Localization(["research-helper-mainWindow.ftl"])` |
| Zotero 10 undo labels | `Zotero.ftl.addResourceIds(['research-helper-mainWindow.ftl'])`, removed on shutdown — **unverified, see §8.2.1** |

The Zotero 7 docs are explicit that you must insert the FTL **before** touching the DOM: "Please ensure that you have inserted the FTL into the window before making any changes to the DOM." And remove it on unload: `doc.querySelector('[href="research-helper-mainWindow.ftl"]').remove();`

`formatValueSync()` exists but is, in Mozilla's words, strongly discouraged. Use the async form.

### 10.2 Sample strings

`locale/en-US/research-helper-mainWindow.ftl`:

```properties
research-helper-menu-root =
    .label = Research Helper
research-helper-menu-search-import =
    .label = Search & Import…
research-helper-menu-preferences =
    .label = Preferences…
research-helper-menu-about =
    .label = About Research Helper
research-helper-menu-collection-report =
    .label = Generate Research Trends Report…
research-helper-menu-collection-summarize-all =
    .label = Summarize All Papers in Collection
research-helper-menu-collection-rerun =
    .label = Re-run This Search…
research-helper-menu-collection-recommend =
    .label = Recommend New Papers from This Collection…
research-helper-menu-item-find-related =
    .label = Find Related Papers…
research-helper-menu-item-summarize =
    .label = { $count ->
            [one] Summarize with AI
           *[other] Summarize { $count } items with AI
        }

research-helper-itempane-header =
    .label = Research Helper
research-helper-itempane-sidenav =
    .tooltiptext = Research Helper summary
research-helper-itempane-empty = No summary yet for this item.
research-helper-itempane-generate =
    .label = Generate summary
research-helper-itempane-loading = Summarizing…
research-helper-itempane-retry =
    .label = Retry
research-helper-itempane-btn-regenerate =
    .tooltiptext = Regenerate summary
research-helper-itempane-btn-save-note =
    .tooltiptext = Save summary as a child note
```

`locale/ko-KR/research-helper-mainWindow.ftl`:

```properties
research-helper-menu-root =
    .label = 리서치 헬퍼
research-helper-menu-search-import =
    .label = 검색 및 가져오기…
research-helper-menu-preferences =
    .label = 환경설정…
research-helper-menu-about =
    .label = 리서치 헬퍼 정보
research-helper-menu-collection-report =
    .label = 최신 연구 동향 보고서 생성…
research-helper-menu-collection-summarize-all =
    .label = 컬렉션의 모든 논문 요약
research-helper-menu-collection-rerun =
    .label = 이 검색 다시 실행…
research-helper-menu-collection-recommend =
    .label = 이 컬렉션을 기반으로 새 논문 추천…
research-helper-menu-item-find-related =
    .label = 관련 논문 찾기…
research-helper-menu-item-summarize =
    .label = { $count ->
           *[other] { $count }개 항목 AI 요약
        }

research-helper-itempane-header =
    .label = 리서치 헬퍼
research-helper-itempane-sidenav =
    .tooltiptext = 리서치 헬퍼 요약
research-helper-itempane-empty = 이 항목에 대한 요약이 아직 없습니다.
research-helper-itempane-generate =
    .label = 요약 생성
research-helper-itempane-loading = 요약하는 중…
research-helper-itempane-retry =
    .label = 다시 시도
research-helper-itempane-btn-regenerate =
    .tooltiptext = 요약 다시 생성
research-helper-itempane-btn-save-note =
    .tooltiptext = 요약을 하위 노트로 저장
```

> **Corrected 2026-10-29 (`P3-T28`).** The body's buttons in §3.3 are `html:button`s, and Fluent does not draw a `.label` attribute on an HTML button, so `research-helper-itempane-generate` and `-retry` ship with a message **value** ("Generate summary", "Retry"), not `.label`. `P3-T28` also ships `-cancel`, `-failed`, `-no-key` (§3.4's unconfigured wording), `-open-preferences` and three headings (`-research-question`, `-key-findings`, `-limitations`). The Korean above is a draft nobody has reviewed: all fifteen ids are on `KO_PENDING_REVIEW` with commented stubs in the `ko-KR` bundle (gate `G-41`).

Korean has a single plural category, so Fluent selectors need only `*[other]` — but keep the selector rather than a flat string, so the English source and Korean translation stay structurally parallel.

### 10.3 UI-language rules

* **Never concatenate** translated fragments. `"Imported " + n + " items"` breaks Korean word order. Use one Fluent message with `{ $count }`.
* **Numbers, dates, file sizes** — format with `Intl.NumberFormat` / `Intl.DateTimeFormat` using `Zotero.locale`.
* **Do not translate**: provider names (OpenRouter, OpenAI, Gemini, Anthropic), database names (PubMed, Crossref, arXiv), model IDs, DOIs.
* **Layout**: Korean strings are typically shorter than English but menu labels can be longer; never fix widths on labels or buttons. `hbox`/`vbox` with `flex` handles this.
* **Fonts**: rely on Zotero's default font stack. Do not specify a font family — Korean glyph coverage is the OS's job.

### 10.4 The three-language distinction (restated, because it is a real bug source)

| Setting | Source | Affects |
|---|---|---|
| **UI language** | Zotero's own locale | Menus, panes, dialogs, prefs |
| **Report language** | pref `research-helper.reportLanguage` (values and default: `07-architecture-and-data-model.md` §8.5) | What the LLM writes |
| **TTS language/voice** | prefs `research-helper.tts.voice` and `research-helper.tts.language` (`07-architecture-and-data-model.md` §8.5) + report language | What the TTS provider speaks |

A Korean-locale user reading English-language papers commonly wants an **English** report. Defaulting the report language to the UI language is correct, but it must be overridable both in preferences and per-run in the report window (§6.4).

---

## 11. Implementation checklist

```
Menus
  [ ] Zotero.MenuManager only — NEVER ztoolkit.Menu (deleted in toolkit 5.1.1)
  [ ] One submenu per target; NO top-level separators on library targets
  [ ] context.collectionTreeRows (never collectionTreeRow — it throws)
  [ ] No `label`/`disabled`/`checked` options — l10nID + context.setEnabled/setVisible
  [ ] FTL entries set the .label ATTRIBUTE, not a bare value
  [ ] l10nArgs passed as a JSON STRING (object form deprecated)
  [ ] onShowing sets enabled/visible from selection + config state
  [ ] unregisterMenu for every registerMenu in shutdown()

Item pane
  [ ] paneID does not collide with built-ins
  [ ] header.icon (16px) AND sidenav.icon (20px) both supplied — both required
  [ ] `refresh` captured in onInit — it is NOT in onClick/onRender props
  [ ] onDestroy uses only { paneID, doc, body } — no `item`
  [ ] onItemChange returns false for non-regular items
  [ ] onRender synchronous & cheap; I/O only in onAsyncRender
  [ ] bodyXHTML uses html: prefix for HTML tags; no <script>
  [ ] autoSummarize defaults OFF and is debounced
  [ ] unregisterSection in shutdown()

Windows
  [ ] chrome:// namespace registered in bootstrap, destructed on shutdown
  [ ] <window><dialog> markup; size via CSS, NOT width/height attributes
  [ ] Zotero.UIProperties.registerRoot(root) called in init()
  [ ] <tooltip id="html-tooltip"> + tooltip="html-tooltip" on <window>
  [ ] include.js loaded in the SAME window if using VirtualizedTable
  [ ] Named, modeless singleton windows (dialog=no)
  [ ] Every long job cancellable via AbortController + HTTP cancellerReceiver
  [ ] Windows closed in onMainWindowUnload and onShutdown

Prefs
  [ ] `preference` attributes use FULL keys (extensions.zotero.research-helper.*)
  [ ] every `preference` key is a row in 07-architecture-and-data-model.md §8.5,
      spelled identically, and has a pref() default line in 01-… §7.2
  [ ] every control's range / value list matches that §8.5 row
  [ ] Numeric prefs coerced with Number() on read — binding stringifies
  [ ] No l10nID option on PreferencePanes.register; no defaultXUL
  [ ] groupboxes carry aria-labelledby; FTL inside <linkset>
  [ ] prefs.js ships a default for every key this pane touches — every `preference`
      binding AND every key a scripted handler reads (logLevel). Keys with no
      control need no pref() line (01-… §7.2)
  [ ] the three non-binding controls behave: API-key fields go to the SecretStore;
      the verbose-logging checkbox writes logLevel debug/warn and nothing else;
      the clear/delete buttons cover doc 09 §3.7's list, and "Clear generated
      summaries" states that Zotero notes are NOT deleted
  [ ] there is no `debug` pref anywhere — the checkbox is a view onto logLevel
  [ ] NO `preference` attribute on any API-key field — keys go to OSKeyStore +
      Services.logins, never Zotero.Prefs (D5 / doc 09 §1.7)
  [ ] Keys masked and never re-displayed; hold-to-show reveal; Test button;
      storage-backend badge; doc 09 §1.8 residual-risk text verbatim and visible
  [ ] "Remove all stored keys" button present
  [ ] No key ever reaches Zotero.debug / logError / a note / the clipboard

States
  [ ] INITIAL / LOADING / EMPTY / PARTIAL / ERROR for every list surface
  [ ] Per-database status, not one aggregate spinner
  [ ] FR-12: "Re-run This Search…" hidden when the collection has no
      search_provenance row; pre-filled state per §4.6; controls editable;
      "as recorded" is the default date choice; import reports "already present"
  [ ] ProgressWindow: changeHeadline 2nd arg = CSS icon KEY; ItemProgress 1st arg = itemType
  [ ] startCloseTimer called AFTER show()
  [ ] No modal alerts (Zotero.Prompt.confirm only for user-initiated confirmations)

A11y & i18n
  [ ] Every input labelled; role=status / role=alert on live regions
  [ ] getRowString + label on the result table
  [ ] Menu icons 16x16 SVG with fill="context-fill"; darkIcon where needed
  [ ] disableFontSizeScaling left false
  [ ] All IDs/classes prefixed research-helper-; files flat under locale/<lang>/, named research-helper-*.ftl
  [ ] en-US AND ko-KR both shipped (en-US is the fallback for everyone else)
  [ ] No string concatenation; Intl.* for numbers and dates
```

---

## Sources

Zotero source (read on `main`, 2026-09-08) — these are the authoritative schemas, none of which are fully published in the developer docs:

* [`chrome/content/zotero/xpcom/pluginAPI/menuManager.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/pluginAPI/menuManager.js) — `VALID_TARGETS`, `VALID_MENU_TYPES`, `GROUPED_TARGETS`, `MenuData`/`MenuOptions` typedefs, default menu context (`menuElem`, `setL10nArgs`, `setEnabled`, `setVisible`, `setIcon`), `_groupMenus` auto-grouping, `_unregisterByPluginID`
* [`chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js) — `registerSection` option type definition, built-in pane IDs, `SectionHookArgs` / `SectionInitHookArgs` typedefs, `sectionButtons`, `registerInfoRow` schema
* [`chrome/content/zotero/xpcom/preferencePanes.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/preferencePanes.js) — `Zotero.PreferencePanes.register` JSDoc (quoted verbatim), built-in pane list, auto-unregister on plugin shutdown
* [`chrome/content/zotero/preferences/preferences.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/preferences/preferences.js) — `preference` attribute binding, `_syncFromPref` / `_syncToPrefOnModify` using `global = true`, `<preference>` deprecation warning, MutationObserver on `[preference]`
* [`chrome/content/zotero/zoteroPane.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/zoteroPane.js) — `getContext` for `main/library/item`, `main/library/collection`, `main/library/addAttachment`, `main/library/addNote`; the `collectionTreeRow` deprecation throw
* [`chrome/content/zotero/standalone/standalone.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/standalone/standalone.js) — `getContext` for `main/menubar/*`
* [`chrome/content/zotero/xpcom/progressWindow.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressWindow.js) — `Zotero.ProgressWindow` / `ItemProgress` API
* [`chrome/content/zotero/xpcom/progressQueue.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressQueue.js) — `ProgressQueue` / `ProgressQueues`, `ROW_*` constants, listener names, dialog methods
* [`chrome/content/zotero/components/virtualized-table.jsx`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/components/virtualized-table.jsx) — CommonJS React table; exports, required props, `makeRowRenderer`
* [`chrome/content/zotero/elements/itemPaneCustomSection.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/elements/itemPaneCustomSection.js) — `_getBasicHookProps` / `_getUIHookProps`, which hook receives `refresh`
* [`chrome/content/zotero/elements/collapsibleSection.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/elements/collapsibleSection.js) — item-pane section a11y (`role`, `tabindex`, `aria-expanded`, `aria-label` from `l10nID`)
* [`chrome/content/zotero/xpcom/uiProperties.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/uiProperties.js) — `Zotero.UIProperties.registerRoot`
* [`chrome/content/zotero/createParentDialog.xhtml`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/createParentDialog.xhtml) / `.js` — canonical Zotero 7+ dialog markup and init idiom
* [`chrome/content/zotero/preferences/preferences_general.xhtml`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/preferences/preferences_general.xhtml) — `aria-labelledby` groupbox pattern, `<linkset>`, `preference` binding
* [`chrome/content/zotero/renameFilesPreview.xhtml`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/renameFilesPreview.xhtml) — self-contained dialog mounting a VirtualizedTable (Zotero 8+)
* [`chrome/content/zotero/xpcom/plugins.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/plugins.js) — `registerLocales`, the Zotero 10 per-file locale fallback chain
* [`chrome/locale/ko-KR/zotero/zotero.ftl`](https://github.com/zotero/zotero/blob/main/chrome/locale/ko-KR/zotero/zotero.ftl) — Korean is a supported Zotero UI locale (1133 lines)
* [Zotero Accessibility](https://www.zotero.org/accessibility) — WCAG 2.2 Level AA conformance as of October 2024, VPAT 2.5

Official Zotero documentation

* [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) — `PreferencePanes.register`, `ItemPaneManager.registerSection` example, Fluent registration and namespace rules, groupbox guidance for prefs search
* [Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers) — `Zotero.MenuManager.registerMenu` introduction and example, preference-pane global scope isolation, button `label` property change
* [Zotero 9 for Developers](https://www.zotero.org/support/dev/zotero_9_for_developers)
* [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers) — multi-select collection API, `MenuManager` shutdown cleanup, plugin localization fallback, attachment filename validation
* [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api) — `addRelatedItem`, collections, notes
* [Plugins for Zotero](https://www.zotero.org/support/plugins)

Ecosystem

* [windingwind/zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) — `DialogHelper` (`addCell`, `addButton`, `setDialogData`, `open`, `dialogData.unloadLock`, `_lastButtonId`), `ProgressWindowHelper` constructor options, `FilePickerHelper.open()`, `VirtualizedTableProps` and `ColumnOptions` interfaces, `unregisterAll()`
* [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) — `amIAddonManagerStartup.registerChrome` pattern, `hooks.ts` structure, `MozXULElement.insertFTLIfNeeded` usage
* [zotero-plugin.dev](https://zotero-plugin.dev/) — community hub
* [Dev Docs for Zotero Plugin (community)](https://windingwind.github.io/doc-for-zotero-plugin-dev/)
* [windingwind/zotero-better-notes](https://github.com/windingwind/zotero-better-notes) — reference for Markdown ↔ Zotero note HTML
* [MuiseDestiny/zotero-gpt](https://github.com/MuiseDestiny/zotero-gpt) — reference for LLM UI inside Zotero

Forums

* [Read Aloud for plugin-generated text?](https://forums.zotero.org/discussion/131551/read-aloud-for-plugin-generated-text) — feature request, no staff response, no plugin-facing Read Aloud API confirmed
* [Zotero 9 is amazing, but the plugin documentation is becoming a "scavenger hunt"](https://forums.zotero.org/discussion/130948/zotero-9-is-amazing-but-the-plugin-documentation-is-becoming-a-scavenger-hunt)
* [zotero-dev Google Group](https://groups.google.com/g/zotero-dev)

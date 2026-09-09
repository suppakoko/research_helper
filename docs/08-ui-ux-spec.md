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
Fluent files       locale/<locale>/research-helper/*.ftl
chrome namespace   chrome://researchhelper/content/*
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
const ICON = `chrome://researchhelper/content/icons/menu-16.svg`;     // fill="context-fill"

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

Summaries are never stored in preferences, in any form: `07-architecture-and-data-model.md` §8.5.2 rules cached summaries out of `Zotero.Prefs` explicitly, so `zotero-plugin-toolkit`'s `LargePrefHelper` — which chunks large values across preferences — is not a candidate here regardless of how well it works.

### 3.3 Registration code

```javascript
// src/modules/itemPaneSection.ts
const PLUGIN_ID = "research-helper@suppakoko.github.io";
let sectionID: string | undefined;

export function registerSummarySection() {
  sectionID = Zotero.ItemPaneManager.registerSection({
    paneID: "rh-itempane-summary",
    pluginID: PLUGIN_ID,

    header: {
      l10nID: "research-helper-itempane-header",
      icon: "chrome://researchhelper/content/icons/section-16.svg",
      darkIcon: "chrome://researchhelper/content/icons/section-16-dark.svg",
    },
    sidenav: {
      l10nID: "research-helper-itempane-sidenav",
      icon: "chrome://researchhelper/content/icons/section-20.svg",
      darkIcon: "chrome://researchhelper/content/icons/section-20-dark.svg",
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
        icon: "chrome://researchhelper/content/icons/refresh-16.svg",
        darkIcon: "chrome://researchhelper/content/icons/refresh-16-dark.svg",
        l10nID: "research-helper-itempane-btn-regenerate",
        // NOTE: onClick props do NOT include `refresh` — use the captured one.
        onClick: ({ item }) => RH.jobs.summarizeItems([item.id])
                                 .then(() => RH.state.refreshSection?.()),
      },
      {
        type: "rh-save-note",
        icon: "chrome://researchhelper/content/icons/note-16.svg",
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

> **File names come from `07-architecture-and-data-model.md` §2.2, which owns the directory tree.** The document there is `addon/content/searchDialog.xhtml`, with `searchDialog.js` beside it and `searchDialog.ftl` in the per-surface locale folder (`01-zotero-plugin-platform.md` §9.1). An earlier draft of this section named all three `searchWindow.*`, and two file-naming conventions for one surface is a defect, not a preference. The *behaviour* is still a modeless singleton **window** — that is this document's call, and it is why the entry point below is `openSearchWindow` and the controller object is `RHSearchWindow`; only the file names changed.

```javascript
// src/ui/dialogs/searchDialog.ts  (07-… §2.2: ui/dialogs/)
export function openSearchWindow(args: SearchWindowArgs) {
  const win = Zotero.getMainWindow();
  const features = "chrome,titlebar,toolbar,centerscreen,resizable,dialog=no,minwidth=880,minheight=600";
  // `args` is passed as the dialog argument; read it inside with window.arguments[0]
  const dialog = win.openDialog(
    "chrome://researchhelper/content/searchDialog.xhtml",
    "research-helper-search",         // named window: re-focuses instead of duplicating
    features,
    args,
  );
  dialog.focus();
  return dialog;
}
```

`dialog=no` plus a window name gives a **modeless, singleton** window — the user can keep browsing their library while a search runs, and re-invoking the menu focuses the existing window instead of opening a second one. This matters because searches take tens of seconds.

The `chrome://researchhelper/content/` namespace is registered in `bootstrap.js` via `amIAddonManagerStartup.registerChrome` (see `01-zotero-plugin-platform.md` §2.5).

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
    <script src="chrome://researchhelper/content/searchDialog.js"/>
    <linkset>
      <html:link rel="localization" href="research-helper/searchDialog.ftl"/>
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
3. **The target collection is fixed to the collection the menu was invoked on**, with "New collection…" still available for a user who wants a side-by-side comparison rather than a top-up.
4. **Import reports "already present: N"** rather than counting duplicates as imports, using the same DOI/PMID dedup pass §4.4 already runs. The status line reads `Imported 9 · Already present 128 · 1 failed`.

A collection with no provenance row cannot reach this state: §2.5 hides the menu entry rather than opening a window with nothing to pre-fill.

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

### 6.4 Wireframes

**Stage 1–2, summarizing**

```
┌ Research Helper — Collection Report ──────────────────────────────────────────┐
│                                                                               │
│  Collection  📁 CRISPR delivery / 2026 screen        47 papers (3 skipped:    │
│                                                       notes & attachments)    │
│                                                                               │
│  Language  [ English ▾ ]     Model  [ claude-sonnet-5 ▾ ]                     │
│  Depth     ( ) Brief   (•) Standard   ( ) Detailed                            │
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

```xml
<!-- content/preferences.xhtml — a FRAGMENT: no <!DOCTYPE>, no <html> wrapper -->
<vbox
    xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
    xmlns:html="http://www.w3.org/1999/xhtml">

  <linkset>
    <html:link rel="localization" href="research-helper/preferences.ftl"/>
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
7. A **storage-backend badge** next to the key fields names the active tier — "Protected by Windows Credential Manager" / "macOS Keychain" / "System keyring", or a warning-coloured "Not saved between sessions" / "Protected by your passphrase" in degraded tiers.
8. The residual-risk statement of doc 09 §1.8 appears in the pane **verbatim and visible** (not behind a "Learn more" link), including the sentence that other Zotero plugins can read the keys.
9. A **Remove all stored keys** button clears every `SecretId` and reports how many were removed.
10. On an empty-key state after a data-directory restore, explain *why*: keys live in this computer's credential store and do not travel with the Zotero data folder.

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
* `new pw.ItemProgress(itemType, text, parentItemProgress)` — the first argument is an **item type string** (`'journalArticle'`, `'attachmentPDF'`, …), not an icon URL. There is **no `setIcon()`**; the method is `setItemTypeAndIcon(itemType, cssIcon = 'item-type')`.

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
├── en-US/research-helper/
│   ├── mainWindow.ftl      (menus, item-pane section, and every dialog raised from them)
│   ├── searchDialog.ftl    (searchDialog.xhtml, and the Related Papers reuse of it — §5)
│   ├── reportWindow.ftl    (reportWindow.xhtml — trend report viewer + audio player)
│   └── preferences.ftl     (preferences.xhtml)
└── ko-KR/research-helper/
    ├── mainWindow.ftl
    ├── searchDialog.ftl
    ├── reportWindow.ftl
    └── preferences.ftl
```

**This section owns the surface set and its names.** `07-architecture-and-data-model.md` §2.2 owns the *tree* — where the files sit in the repository — and defers to this list for what the surfaces are called; where the two disagree, this list wins and the tree is the defect. The mapping is one-to-one except at the two ends, and both exceptions are deliberate:

| Surface | XHTML in `addon/content/` | FTL in `locale/<locale>/research-helper/` |
|---|---|---|
| Main window | **none** — it is Zotero's own window; the plugin injects menus and an item-pane section into it | `mainWindow.ftl` |
| Search & Import | `searchDialog.xhtml` | `searchDialog.ftl` |
| Report window | `reportWindow.xhtml` | `reportWindow.ftl` |
| Preferences | `preferences.xhtml` | `preferences.ftl` |

One name was reconciled here on 2026-09-09. **`reportViewer` and `reportWindow` were one surface under two names** — `07-architecture-and-data-model.md` §2.2's tree said `reportViewer.xhtml` while this list said `reportWindow.ftl`; the surface is **`reportWindow`** and the XHTML file has been renamed to match, because the FTL name is the one that appears in `insertFTLIfNeeded` calls and in every `data-l10n-id` lookup path.

**`jobCenter` was removed from this list on 2026-09-09, and with it `jobCenter.xhtml` and `jobCenter.ftl`.** Earlier the same day the mismatch here was the opposite one — the surface had an XHTML file but no FTL, and one was added so that the durable job list would not ship as hard-coded English. The project owner then took the Job Center out of v1 altogether, deferring it to v1.1: `10-requirements-and-user-stories.md` §4 item 18 records the decision and its reasoning, and `07-architecture-and-data-model.md` §7.7.1 keeps the deferred design. The surface set above is therefore four surfaces, not five, and neither file exists in v1.

**The main-window rule, for dialogs raised from menus and the item pane.** A modal or transient dialog that the user opens *from the main window* — the Phase 3 cost-confirmation dialog, the first-use egress disclosure (`09-security-privacy-and-api-keys.md` §3.6), the summarize dialog — is **not** a new localization surface. Its strings go in `mainWindow.ftl`, and it does not get an FTL file of its own. The reason is mechanical rather than stylistic: `mainWindow.ftl` is already inserted into that window by `insertFTLIfNeeded` before any DOM is touched, so a dialog opened from it resolves its ids with no second registration, no second removal on unload, and no window in which a string can fail to resolve because its file has not been inserted yet. A surface earns its own FTL file when it owns a **window** — one that is opened with its own document, carries its own `<linkset>`, and can be open while the main window is not. `searchDialog`, `reportWindow` and `preferences` each clear that bar; a cost-confirmation sheet does not. This is also what `plan/`'s Phase 3 cards already do, and this paragraph is the rule they were following without one written down.

> **The Job Center gap is closed by dropping the surface, not by writing the section.** A note here earlier on 2026-09-09 flagged that this document had no section specifying the Job Center: §§2–7 above specify the menus, the item-pane section, the search window, the related-papers flow, the report flow and the preferences pane, and stop there, so the surface's *name* and its localization home were settled here while its layout, states and accessibility notes were written nowhere — and `07-architecture-and-data-model.md` §7.7 is a behaviour spec rather than a UI one. That is no longer an open v1 gap, because the surface is no longer in v1: it is deferred to v1.1 (paragraph above; `10-requirements-and-user-stories.md` §4 item 18). **The section becomes owed again the moment the Job Center is pulled into a release** — it is a window of ours, so it needs a UI specification in this document before anyone builds it, and `07-architecture-and-data-model.md` §7.7.1 lists that as the second thing v1.1 must do.

**Korean is a real Zotero UI locale.** `chrome/locale/ko-KR/zotero/zotero.ftl` (1133 lines vs 1342 for `en-US`), `preferences.ftl` and `zotero.properties` all exist in the [zotero/zotero repository](https://github.com/zotero/zotero/blob/main/chrome/locale/ko-KR/zotero/zotero.properties), with real translations (`general-print = 인쇄`, `general-remove = 제거`, `general-add = 추가`). Coverage is substantial but not complete — untranslated entries fall through to English within the same file. **The locale code is `ko-KR` exactly; there is no bare `ko`.**

**Zotero 10 reworked plugin localization.** Per `xpcom/plugins.js#registerLocales`, all plugins' strings are now consolidated into a single `L10nFileSource` registered as `zotero-plugins:{locale}/`, with fallback computed **per file, per Zotero locale**: exact match → same language → `en-US` → first available. The [Zotero 10 developer page](https://www.zotero.org/support/dev/zotero_10_for_developers) says this "fixes plugins that ship only a non-English locale showing that locale for all users, and competing registrations across plugins causing strings to fail to resolve."

⚠️ **Always ship `locale/en-US/` even though our primary audience is Korean.** On the pre-Zotero-10 fallback path, a plugin that ships only `ko-KR` shows Korean strings to *every* user regardless of their locale.

How each surface gets its strings:

| Surface | Mechanism |
|---|---|
| Menus (`MenuManager`) | `l10nID` + `l10nArgs`; the FTL entry **must** set the `.label` attribute |
| Item-pane section | `header.l10nID` / `sidenav.l10nID` — Zotero resolves them; nothing to insert |
| Prefs pane fragment | `<linkset><html:link rel="localization" href="…"/></linkset>` |
| Our own dialog windows (`searchDialog`, `reportWindow`) | `<linkset>` inside `<dialog>`, or `<html:link rel="localization">` — one per window, naming that window's own FTL file |
| Dialogs raised from the main window (cost confirmation, egress disclosure, summarize) | **Nothing to insert.** They resolve against the already-inserted `mainWindow.ftl`; see the main-window rule above |
| Main window (injected DOM) | `window.MozXULElement.insertFTLIfNeeded("research-helper/mainWindow.ftl")`, removed on unload |
| From JS, in a window | `document.l10n.setAttributes(el, id, args)`, `await document.l10n.formatValue(id, args)` |
| From JS, no window | `new Localization(["research-helper/mainWindow.ftl"])` |
| Zotero 10 undo labels | `Zotero.ftl.addResourceIds(['research-helper/mainWindow.ftl'])`, removed on shutdown — **unverified, see §8.2.1** |

The Zotero 7 docs are explicit that you must insert the FTL **before** touching the DOM: "Please ensure that you have inserted the FTL into the window before making any changes to the DOM." And remove it on unload: `doc.querySelector('[href="research-helper/mainWindow.ftl"]').remove();`

`formatValueSync()` exists but is, in Mozilla's words, strongly discouraged. Use the async form.

### 10.2 Sample strings

`locale/en-US/research-helper/mainWindow.ftl`:

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

`locale/ko-KR/research-helper/mainWindow.ftl`:

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
  [ ] All IDs/classes prefixed research-helper-; files under locale/<lang>/research-helper/
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

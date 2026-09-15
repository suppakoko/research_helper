# 01 — The Zotero 10 Plugin Platform

**Document status:** research reference for the `research_helper` plugin
**Target application:** Zotero 10.0.x (user is on 10.0.1, released 2026-08-24)
**Plugin model:** bootstrapped plugin (`manifest.json` + `bootstrap.js`), introduced in Zotero 7 and still current
**Architecture constraint:** fully client-side, no backend server
**Last researched:** 2026-09-08

---

## 0. How to read this document

Everything in this document is annotated for provenance:

* Plain text with an inline link = **verified** against the linked source on 2026-09-08.
* Blocks marked `> **Unverified:**` = could not be confirmed from primary sources; treat as a hypothesis to test in the debug console before relying on it.

The single most important thing to internalise before writing code: **Zotero's plugin documentation is fragmented.** The official docs at zotero.org/support/dev are incomplete and in places stale, and the Zotero team has acknowledged this — in [a 2026 forum thread titled "Zotero 9 is amazing, but the plugin documentation is becoming a 'scavenger hunt'"](https://forums.zotero.org/discussion/130948/zotero-9-is-amazing-but-the-plugin-documentation-is-becoming-a-scavenger-hunt), a Zotero team member pointed developers at the [zotero-dev Google Group](https://groups.google.com/g/zotero-dev) and the community-maintained [doc-for-zotero-plugin-dev](https://windingwind.github.io/doc-for-zotero-plugin-dev/) site, and promised "we'll be improving this soon."

Practical consequence: **the `zotero/zotero` source tree is the real API documentation.** Where this document quotes a signature, it was read from the source at `chrome/content/zotero/xpcom/*.js` on the `main` branch. Do the same when you hit something undocumented.

---

## 1. Release timeline and what "rapid release" means for you

### 1.1 The timeline

| Version | Release date | Mozilla platform base | Notes |
|---|---|---|---|
| 7.0 | 2024-08-09 | Firefox 115 ESR | Bootstrapped plugin model introduced; overlay plugins dropped ([Wikipedia](https://en.wikipedia.org/wiki/Zotero), [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)) |
| 8.0 | 2026-01-22 | Firefox 140 ESR | Large platform jump (115 → 128 → 140), JSM→ESM, Bluebird removed ([blog](https://www.zotero.org/blog/category/news/), [Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers)) |
| 9.0 | 2026-04-10 | Firefox 140 ESR | "did not include any major developer-facing changes" ([Zotero 9 for Developers](https://www.zotero.org/support/dev/zotero_9_for_developers)) |
| 10.0 | 2026-08-17 | Firefox 140 ESR | Search rewrite, multi-select collections, undo/redo, WAL, FTS5 ([Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)) |
| 10.0.1 | 2026-08-24 | — | Maintenance release ([changelog](https://www.zotero.org/support/changelog)) |

### 1.2 The policy

Zotero announced a faster release cycle on 2026-01-22 alongside Zotero 8: new major versions "roughly every 6–10 weeks", with maintenance releases in between ([Zotero blog](https://www.zotero.org/blog/category/news/)). In [the forum thread on the faster release cycle](https://forums.zotero.org/discussion/129153/a-faster-release-cycle-for-zotero), Zotero's Dan Stillman stated (2026-01-23) that "All OS-compatible version updates will be automatic going forward, and we won't be supporting older versions", that plugin developers "do need to maintain their plugins", and (2026-04-24) that majors will arrive approximately every 6–10 weeks.

He also said the team is "adding new APIs for common plugin integration points, and those should generally stay stable across many versions." This is visible in practice: `Zotero.ItemPaneManager`, `Zotero.ItemTreeManager` (Zotero 7) and `Zotero.MenuManager` (Zotero 8) are exactly those stable integration points. **Build `research_helper` on the Manager APIs wherever one exists, and touch raw DOM only where none does.** That is the single highest-leverage decision for surviving the release treadmill.

### 1.3 `strict_max_version` under rapid release

The compatibility model is unchanged from the Firefox add-on model: a plugin declares `strict_max_version`, and Zotero disables the plugin when the running app exceeds it. Under a 6–10 week major cadence this means **your plugin is administratively disabled roughly six times a year unless you ship an update**, even when nothing is technically broken. Users have complained about exactly this in [Frequent major-version changes and the current plugin compatibility model](https://forums.zotero.org/discussion/133127/frequent-major-version-changes-and-the-current-plugin-compatibility-model) (2026-08); Zotero's response was to redirect the discussion to zotero-dev and point at the pre-release API-freeze announcements.

Two mitigations that are officially documented:

1. **You do not need to ship a new XPI just to bump compatibility.** Both the [Zotero 9](https://www.zotero.org/support/dev/zotero_9_for_developers) and [Zotero 10](https://www.zotero.org/support/dev/zotero_10_for_developers) developer pages say that if no code changes are required, you can update `strict_max_version` **in the update manifest alone** (`update.json`), without releasing a new version. Zotero will then treat the already-installed XPI as compatible. This is the cheapest possible compatibility bump — a one-line commit to a JSON file served over HTTPS.
2. **Betas ignore `strict_max_version`.** Per the [Zotero 8 beta announcement on zotero-dev](https://groups.google.com/g/zotero-dev/c/uQhEGkJEzYs/m/Hjqr13PwBwAJ) and community write-ups, developers are expected to run the betas and catch breakage before a version is frozen.

> **Unverified:** The precise wording of the "betas ignore strict_max_version" rule and whether it applies to *all* beta channels was reported in secondary sources (a third-party blog summarising Zotero 10) rather than found verbatim in Zotero's own docs. Test on a beta build before depending on it.

**Operational recommendation for research_helper:**

* Keep `update.json` in a GitHub Release asset at a stable URL (see §11), so a compatibility bump is a single file replacement.
* Subscribe to [zotero-dev](https://groups.google.com/g/zotero-dev) and run the beta channel in a second Zotero profile.
* Set `strict_min_version` to `"10.0"` and `strict_max_version` to `"10.0.*"` for the first release. Do **not** guess forward (`"11.*"`). This is not just prudence: [Zotero 11 for Developers](https://www.zotero.org/support/dev/zotero_11_for_developers) already exists and says explicitly, "Do not update your plugin to declare compatibility with Zotero 11 at this time. We'll make an announcement on the dev list when Zotero 11 is feature-frozen and it's time to test for compatibility." Zotero 11 absorbs Firefox 140 → 153 and carries a long breaking-change list (boolean XUL attributes match on presence alone, `ownerGlobal` → `documentGlobal`, `XPCOMUtils.defineLazyServiceGetter()` requires an `nsIID`, XUL checkbox `CheckboxStateChange` removed in favour of `command`, login-manager `findLogins` removed in favour of `searchLoginsAsync`, `oncommand` is now a WebIDL event handler). The last of those touches our key storage (D5) directly.

---

## 2. The bootstrapped plugin model

### 2.1 Minimum viable plugin

A bootstrapped plugin is a ZIP archive renamed to `.xpi`, containing **at the archive root**:

```
research-helper.xpi
├── manifest.json          # required
├── bootstrap.js           # required
├── prefs.js               # optional: default preference values
├── preferences.xhtml      # optional: preference pane markup
├── preferences.js         # optional: preference pane script
├── locale/
│   ├── en-US/research-helper.ftl
│   └── ko-KR/research-helper.ftl
└── content/               # your scripts, icons, XHTML dialogs
```

Unlike Zotero 6 overlay plugins, bootstrapped plugins can be enabled, disabled and uninstalled **without restarting Zotero**, which is why the shutdown contract is strict (§2.4).

### 2.2 `manifest.json`

This is the canonical Zotero 7+ manifest, quoted from the [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) documentation:

```json
{
  "manifest_version": 2,
  "name": "Make It Red",
  "version": "1.1",
  "description": "Makes everything red",
  "author": "Zotero",
  "icons": {
    "48": "icon.png",
    "96": "icon@2x.png"
  },
  "applications": {
    "zotero": {
      "id": "make-it-red@zotero.org",
      "update_url": "https://www.zotero.org/download/plugins/make-it-red/updates.json",
      "strict_min_version": "6.999",
      "strict_max_version": "7.0.*"
    }
  }
}
```

And this is the real manifest from Zotero's official sample plugin, [`make-it-red/src-2.0/manifest.json`](https://github.com/zotero/make-it-red) (fetched raw on 2026-09-08):

```json
{
	"manifest_version": 2,
	"name": "Make It Red",
	"version": "2.0",
	"description": "Makes everything red",
	"homepage_url": "https://github.com/zotero/make-it-red",
	"applications": {
		"zotero": {
			"id": "make-it-red@example.com",
			"update_url": "https://zotero-download.s3.amazonaws.com/tmp/make-it-red/updates-2.0.json",
			"strict_min_version": "7.0",
			"strict_max_version": "7.1.*"
		}
	}
}
```

#### Field reference

| Field | Required | Meaning |
|---|---|---|
| `manifest_version` | yes | Always `2`. Zotero uses the WebExtension manifest **format** but is not a WebExtension host; MV3 is not applicable. |
| `name` | yes | Display name in Tools → Plugins. |
| `version` | yes | Plugin version. Use the Mozilla toolkit version format — `1.2.3`, and pre-release suffixes like `1.2.3-beta.1` sort *before* `1.2.3`. The comparison rules are specified in [`nsIVersionComparator.idl`](https://searchfox.org/mozilla-central/source/xpcom/base/nsIVersionComparator.idl). (The MDN page formerly at `Mozilla/Toolkit_version_format` has been removed — it now 404s.) |
| `description` | no | Shown under the name. |
| `author` | no | Shown in the plugin manager. |
| `homepage_url` | no | Linked in the plugin manager. |
| `icons` | no | Map of pixel size → path relative to the archive root. `48` and `96` are the sizes Zotero's plugin manager uses. |
| `applications.zotero.id` | yes | Globally unique plugin ID, in email form (`research-helper@suppakoko.github.io` — decision D9). **This is also the folder/proxy-file name during development and the key in `update.json`.** Never change it after release — changing it orphans every installed copy. |
| `applications.zotero.update_url` | no | HTTPS URL of an `update.json`. Omit it and the plugin will never auto-update. |
| `applications.zotero.strict_min_version` | yes (effectively) | Lowest supported Zotero version. `"6.999"` was the Zotero 7-beta idiom; for a Zotero 10-only plugin use `"10.0"`. |
| `applications.zotero.strict_max_version` | yes (effectively) | Highest supported version, e.g. `"10.0.*"`. Exceeding it disables the plugin. |

Recommended manifest for `research_helper`:

```json
{
  "manifest_version": 2,
  "name": "Research Helper",
  "version": "0.1.0",
  "description": "Literature search, related-paper discovery, and AI summaries/reports inside Zotero.",
  "author": "KIST",
  "homepage_url": "https://github.com/suppakoko/research_helper",
  "icons": {
    "48": "content/icons/favicon@0.5x.png",
    "96": "content/icons/favicon.png"
  },
  "applications": {
    "zotero": {
      "id": "research-helper@suppakoko.github.io",
      "update_url": "https://raw.githubusercontent.com/suppakoko/research_helper/release/update.json",
      "strict_min_version": "10.0",
      "strict_max_version": "10.0.*"
    }
  }
}
```

> **Unverified:** Whether Zotero honours a `browser_specific_settings` key as an alias for `applications` (Firefox renamed it). Every Zotero example uses `applications`; use `applications`.

### 2.3 `bootstrap.js` lifecycle hooks

`bootstrap.js` is loaded into a **plugin sandbox**, not a window. The globals available include `Zotero`, `Services`, `Components`, `ChromeUtils`, and the reason constants. It must define plain top-level functions (not exports):

> **Measured 2026-09-10 on Zotero 10.0.1 (Gecko 140), task `P0-T08`.** The sandbox's global set
> was probed two independent ways from inside a loaded plugin — property lookup on `globalThis`,
> and bare-identifier `typeof`, which resolves through the scope chain rather than through a
> property. **Both agree exactly**, so the list below is not an artefact of how it was measured.
>
> **Present:** `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `fetch`,
> `TextDecoder`, `TextEncoder`, `URL`, `URLSearchParams`, `btoa`, `crypto`, `Blob`,
> `FileReader`, `XMLHttpRequest`, `DOMParser`, `IOUtils`, `PathUtils`, `dump`.
>
> **ABSENT — referencing any of these throws:** `AbortController`, `structuredClone`,
> `queueMicrotask`, `console`, `performance`.
>
> Three of those absences have design consequences, not merely stylistic ones:
>
> - **`AbortController` does not exist.** Nothing may be cancelled the DOM way. Cancellation
>   goes through `Zotero.HTTP.request`'s `cancellerReceiver` option (§8.1), which is the only
>   mechanism available. `P0-T17` is the card that proves it end to end.
> - **`performance` does not exist.** Every duration measured against an `NFR-*` budget must use
>   `Date.now()`. `P0-T20` measures a 100-item transaction against `NFR-1` and is the first card
>   this bites.
> - **`console` does not exist.** A stray `console.log` is not merely ignored, it throws. Use
>   `Zotero.debug()`; `dump()` also exists and reaches stdout when Zotero is started with
>   `-ZoteroDebugText`.

```javascript
function install(data, reason) { }
async function startup({ id, version, rootURI }, reason) { }
function onMainWindowLoad({ window }, reason) { }
function onMainWindowUnload({ window }, reason) { }
function shutdown({ id, version, rootURI }, reason) { }
function uninstall(data, reason) { }
```

Zotero's official sample, [`make-it-red/src-2.0/bootstrap.js`](https://github.com/zotero/make-it-red), verbatim:

```javascript
var MakeItRed;

function log(msg) {
	Zotero.debug("Make It Red: " + msg);
}

function install() {
	log("Installed 2.0");
}

async function startup({ id, version, rootURI }) {
	log("Starting 2.0");

	Zotero.PreferencePanes.register({
		pluginID: 'make-it-red@example.com',
		src: rootURI + 'preferences.xhtml',
		scripts: [rootURI + 'preferences.js']
	});

	Services.scriptloader.loadSubScript(rootURI + 'make-it-red.js');
	MakeItRed.init({ id, version, rootURI });
	MakeItRed.addToAllWindows();
	await MakeItRed.main();
}

function onMainWindowLoad({ window }) {
	MakeItRed.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	MakeItRed.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down 2.0");
	MakeItRed.removeFromAllWindows();
	MakeItRed = undefined;
}

function uninstall() {
	log("Uninstalled 2.0");
}
```

#### Hook parameters

`install`, `startup`, `shutdown`, `uninstall` receive `(data, reason)`:

* `data.id` — the plugin ID from the manifest
* `data.version` — the plugin version
* `data.rootURI` — a **string** URL pointing at the plugin's root, **always ending in `/`**. It is either a `jar:file:///…!/` URL (installed XPI) or a `file:///…/` URL (development proxy). Build every internal path as `rootURI + 'content/foo.js'`. Never assume a filesystem path.
* `data.resourceURI` — also present in practice (the [zotero-plugin-template bootstrap](https://github.com/windingwind/zotero-plugin-template) destructures `{ id, version, resourceURI, rootURI }`).

`onMainWindowLoad` / `onMainWindowUnload` receive `({ window })` — the DOM window object of a Zotero main window. These two hooks are **Zotero 7+ only**.

#### Reason constants

The second argument is an integer matching one of the bare globals injected into the sandbox ([Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)):

```
APP_STARTUP      APP_SHUTDOWN
ADDON_ENABLE     ADDON_DISABLE
ADDON_INSTALL    ADDON_UNINSTALL
ADDON_UPGRADE    ADDON_DOWNGRADE
```

The one you actually branch on is `APP_SHUTDOWN`. From the [zotero-plugin-template bootstrap](https://github.com/windingwind/zotero-plugin-template):

```javascript
async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;   // Zotero is closing anyway; skip expensive teardown
  }
  await Zotero.__addonInstance__?.hooks.onShutdown();
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}
```

Rationale: when the whole application is quitting, every window is going away and every observer dies with the process, so unwinding DOM changes is wasted work and can throw against already-torn-down windows. When the reason is `ADDON_DISABLE` / `ADDON_UNINSTALL` / `ADDON_UPGRADE`, Zotero keeps running and **you must fully clean up**.

### 2.4 Why window-scoped setup must be per-window

This is the rule that catches every new Zotero plugin author. From the [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) docs:

> "You must then **remove all references to a window or objects within it, cancel any timers, etc.**, when `onMainWindowUnload` is called, or else you'll risk creating a memory leak every time the window is closed."

Three separate facts combine into the rule:

1. **`startup()` may run before any window exists.** On `APP_STARTUP` the plugin is started during application boot. `Zotero.getMainWindows()` can legitimately return `[]`.
2. **There can be more than one main window.** Zotero supports multiple main windows; `Zotero.getMainWindows()` returns an array.
3. **Main windows can be closed and reopened during a single session** — routinely on macOS, where closing the last window does not quit the app. `onMainWindowLoad` will fire again on the *new* window.

Therefore:

* **Window-scoped things** — DOM elements, event listeners, stylesheets, `MozXULElement.insertFTLIfNeeded`, anything holding a `window`/`document`/`Node` reference — belong in `onMainWindowLoad` and must be undone in `onMainWindowUnload`.
* **Application-scoped things** — `Zotero.PreferencePanes.register`, `Zotero.ItemPaneManager.registerSection`, `Zotero.MenuManager.registerMenu`, `Zotero.Notifier.registerObserver`, pref observers, network clients — belong in `startup` and must be undone in `shutdown`.
* In `startup`, after registering app-scoped things, **iterate existing windows** so the plugin works when it is enabled mid-session:

```javascript
await Promise.all(
  Zotero.getMainWindows().map((win) => onMainWindowLoad({ window: win }))
);
```

(That pattern is exactly what the template's `hooks.ts` does.)

The canonical add/remove bookkeeping, from [`make-it-red/src-2.0/make-it-red.js`](https://github.com/zotero/make-it-red) — note that every injected element is given an `id` purely so it can be found and removed later:

```javascript
	addToWindow(window) {
		let doc = window.document;

		// Add a stylesheet to the main Zotero pane
		let link1 = doc.createElement('link');
		link1.id = 'make-it-red-stylesheet';
		link1.type = 'text/css';
		link1.rel = 'stylesheet';
		link1.href = this.rootURI + 'style.css';
		doc.documentElement.appendChild(link1);
		this.storeAddedElement(link1);

		// Use Fluent for localization
		window.MozXULElement.insertFTLIfNeeded("make-it-red.ftl");

		// Add menu option
		let menuitem = doc.createXULElement('menuitem');
		menuitem.id = 'make-it-green-instead';
		menuitem.setAttribute('type', 'checkbox');
		menuitem.setAttribute('data-l10n-id', 'make-it-red-green-instead');
		menuitem.addEventListener('command', () => {
			MakeItRed.toggleGreen(window, menuitem.checked);
		});
		doc.getElementById('menu_viewPopup').appendChild(menuitem);
		this.storeAddedElement(menuitem);
	},

	storeAddedElement(elem) {
		if (!elem.id) {
			throw new Error("Element must have an id");
		}
		this.addedElementIDs.push(elem.id);
	},

	removeFromWindow(window) {
		var doc = window.document;
		// Remove all elements added to DOM
		for (let id of this.addedElementIDs) {
			doc.getElementById(id)?.remove();
		}
		doc.querySelector('[href="make-it-red.ftl"]').remove();
	},
```

> **Note:** `Zotero.MenuManager` (Zotero 8+) removes plugin menu elements automatically on shutdown — the [Zotero 10 changelog](https://www.zotero.org/support/dev/zotero_10_for_developers) explicitly lists "`Zotero.MenuManager` properly removes plugin menu elements on shutdown" as a fix. That is one more reason to prefer `MenuManager` over hand-built `<menuitem>` elements.

### 2.5 Loading your real code

`bootstrap.js` should stay tiny and do nothing but dispatch. Two loading mechanisms:

```javascript
// 1. Classic subscript load into the plugin sandbox (make-it-red style)
Services.scriptloader.loadSubScript(rootURI + 'content/research-helper.js');

// 2. Subscript load into an explicit context object (template style),
//    so the bundle gets a controlled `_globalThis`
const ctx = { rootURI };
ctx._globalThis = ctx;
Services.scriptloader.loadSubScript(
  `${rootURI}content/scripts/research-helper.js`,
  ctx,
);
```

Zotero 8 moved the platform to ESM ([Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers)), so platform modules are imported with `ChromeUtils.importESM`-style calls rather than `Cu.import`:

```javascript
const { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);
```

Registering a `chrome://` namespace (needed if you want to open XHTML dialogs by `chrome://` URL) is done through the addon-manager startup service — this is verbatim from the [zotero-plugin-template's `addon/bootstrap.js`](https://github.com/windingwind/zotero-plugin-template):

```javascript
var chromeHandle;

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "researchhelper", rootURI + "content/"],
  ]);
  // ... now chrome://researchhelper/content/searchDialog.xhtml resolves
}
```

Remember to call `chromeHandle.destruct()` in `shutdown` (see §2.3).

---

## 3. What changed across Zotero 7 → 8 → 9 → 10

This section exists so you do not copy Zotero 7-era snippets from blog posts into a Zotero 10 plugin.

### 3.1 Zotero 7 (2024-08) — the model itself

Overlay plugins removed; bootstrapped plugins introduced; Fluent replaces DTD/properties for plugin localization; `Zotero.PreferencePanes.register`, `Zotero.ItemPaneManager.registerSection`, `Zotero.ItemTreeManager.registerColumn` introduced. Platform: Firefox 115 ESR. ([Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers))

### 3.2 Zotero 8 (2026-01-22) — the big platform jump

Zotero 8 jumped from Firefox 115 to Firefox 140 ESR, absorbing two ESR transitions at once. From [Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers):

**Firefox 115 → 128 breakage**

* Manual `Services.jsm` imports must be removed (`Services` is a global).
* `nsIScriptableUnicodeConverter` removed — replace `convertToByteArray()` / `convertToInputStream()`.
* `nsIOSFileConstantsService` removed.
* `XPCOMUtils.defineLazyGetter` → `ChromeUtils.defineLazyGetter`.
* `nsIDOMChromeWindow` removed.
* Login manager: `addLogin` → `addLoginAsync`.
* `BrowsingContext` must be passed to `nsIFilePicker.init`.
* `DataTransfer#types`: `.contains()` → `.includes()`.
* CSS: `-moz-nativehyperlinktext` → `LinkText`.

**Firefox 128 → 140 breakage**

* **All JSMs became ESMs.** Use `.mjs` / `.sys.mjs` and `import` / `ChromeUtils.importESModule`. Global imports are gone: assign imported modules to variables.
* **All ESMs run in strict mode.**
* **Bluebird was removed.** `Zotero.Promise` is now native-Promise-backed. `Zotero.Promise.delay()` and `Zotero.Promise.defer()` still work, but `defer()` can no longer be called as a constructor, and Bluebird instance methods (`.map()`, `.filter()`, `.each()`, `.isResolved()`, `.isPending()`, `.cancel()`) are **gone**. `Zotero.spawn()` was removed.
* `Services.appShell.hiddenDOMWindow` removed outside macOS.
* `ZOTERO_CONFIG` must be imported rather than assumed global.
* **Preference panes now have an isolated global scope** — see §7.3.
* Button labels must be set via the `label` **property**, not the attribute.
* `zotero:` URI: first segment is now parsed as host, not path.

Zotero shipped migration scripts: `migrate-fx140/migrate.py esmify` and `migrate-fx140/migrate.py asyncify`.

**New in Zotero 8: `Zotero.MenuManager`** — the first officially supported way to add menu items. Verbatim from the docs:

```javascript
let registeredID = Zotero.MenuManager.registerMenu({
    menuID: "test",
    pluginID: "example@example.com",
    target: "main/library/item",
    menus: [
        {
            menuType: "menuitem",
            l10nID: "menu-print",
            onShowing: (event, context) => {
                Zotero.debug("onShowing");
            },
            onCommand: (event, context) => {
                Zotero.debug("onCommand");
            },
        },
    ],
});
// ...
Zotero.MenuManager.unregisterMenu(registeredID);
```

Targets cover menubar menus, library context menus, tab context menus, reader windows, item-pane menus and sidenav buttons. (Detailed target list and usage for `research_helper` is in `08-ui-ux-spec.md`.)

**Practical impact for `research_helper`:** none directly, because we are writing new code for Zotero 10 — but it means **any tutorial, StackOverflow answer or plugin snippet written before 2026 may use Bluebird promise methods, `Cu.import`, or `XPCOMUtils.defineLazyGetter`, all of which will throw.** Treat pre-2026 sample code as pseudocode.

### 3.3 Zotero 9 (2026-04-10) — a free pass

Per [Zotero 9 for Developers](https://www.zotero.org/support/dev/zotero_9_for_developers), Zotero 9 "did not include any major developer-facing changes." Plugin authors only needed to bump `strict_max_version` to `9.0.*`. Zotero 9 introduced **Read Aloud** (built-in TTS) as a user feature.

### 3.4 Zotero 10 (2026-08-17) — search, multi-select, undo

From [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers). **Every item below is a potential source of bugs in `research_helper`, because our plugin reads the current selection and creates collections.**

#### (a) Multiple selection in the collections pane — BREAKING

The collections list now supports multi-row selection, and the singular getters **throw**:

| Removed / throwing | Replacement |
|---|---|
| `ZoteroPane.getCollectionTreeRow()` | `ZoteroPane.getCollectionTreeRows()` |
| — | `ZoteroPane.getSelectedLibraryIDs()` (new; `getSelectedLibraryID()` throws) |
| `ZoteroPane.getSelectedCollection()` | `ZoteroPane.getSelectedCollections()` |
| `ZoteroPane.getSelectedSavedSearch()` | `ZoteroPane.getSelectedSavedSearches()` |
| `ZoteroPane.getSelectedGroup()` | filter `getCollectionTreeRows()` by `isGroup()` |
| `ItemTree#collectionTreeRow` | `ItemTree#viewMode` |

Plural getters return arrays and are safe with any selection size.

> ⚠️ **This directly invalidates the code sample on Zotero's own [JavaScript API page](https://www.zotero.org/support/dev/client_coding/javascript_api)**, which still shows `var collection = ZoteroPane.getSelectedCollection();`. That page has not been updated for Zotero 10. Use:
>
> ```javascript
> const collections = ZoteroPane.getSelectedCollections();
> if (collections.length !== 1) {
>   // research_helper: require exactly one target collection
>   return;
> }
> const collection = collections[0];
> ```

#### (b) Search API restructuring — BREAKING

Searches now express nested logic with **condition groups**: `groupStart` / `groupEnd` conditions plus `joinMode`. The legacy `required` parameter of `addCondition()` now **throws**. The `fulltextWord` condition was **removed** (use `fulltextContent`), and `childNote` is deprecated. Full-text search was rewritten on **SQLite FTS5**.

#### (c) Item data validation tightened — BREAKING

* `item.setType()` and `item.setField('itemTypeID')` **throw** when converting between regular items and attachments/notes/annotations.
* `attachmentFilename` / `attachmentPath` setters **throw** if the value contains slashes.

For `research_helper` this matters when we save a generated Markdown report or audio file as an attachment: pass a plain filename, never a path fragment.

#### (d) Undo/redo — NEW, and we should use it

```javascript
await item.saveTx({
    undoAction: 'undo-action-edit-metadata',
    undoActionArgs: { count: 1 }
});
```

Because `research_helper` performs bulk imports (potentially dozens of items at once), wiring `undoAction` into our save calls gives the user a single Ctrl+Z escape hatch. This is a strong UX differentiator.

> **Unverified:** The complete list of valid `undoAction` string identifiers (they appear to be Fluent IDs for the Edit menu's "Undo …" label) is not documented on the Zotero 10 developer page. Read `chrome/locale/en-US/zotero/zotero.ftl` for `undo-action-*` keys, and check whether a plugin may define its own.

#### (e) Cookie isolation — `Zotero.CookieSandbox` replaced

```javascript
let cookieContext = Zotero.HTTP.newCookieContext();
await Zotero.HTTP.request('GET', url, { userContextId: cookieContext.id });
cookieContext.dispose();
```

`research_helper` calls stateless JSON APIs with bearer tokens, so we generally do **not** want cookies at all — use `{ anon: true }` instead (see §8.1).

#### (f) Other Zotero 10 changes

* `Zotero.HTTP.download()` now returns a **`Response` object** (fetch-style), not an XHR. This is direct evidence that the fetch/Streams stack is live in the privileged context — see §8.4.
* Local HTTP server hardening: requests need a `Host` header of `localhost` / `127.0.0.1` / `[::1]`; browser-like requests need a `Zotero-Allowed-Request` header. (Relevant only if we ever talk to Zotero's local API, which we do not — we are in-process.)
* Local API now supports **write** requests; all responses carry a `Zotero-Server-ID` header.
* **WAL mode enabled on `zotero.sqlite`**; accent-normalized shadow columns added; new `Zotero.DB.loadExtension()`, `Zotero.DB.onIdle()`, `Zotero.DB.addCorruptionHandler()`.
* "Plugin localization consolidated with proper per-locale fallback" — good news for our ko-KR support (§9).
* `Zotero.MenuManager` now removes plugin menu elements on shutdown.
* **No Mozilla platform change** — Zotero 10 is still Firefox 140 ESR, same as 8 and 9.

---

## 4. Toolchain: template, toolkit, scaffold, types

### 4.1 What exists

There is a small, coherent ecosystem, indexed at the community hub [zotero-plugin.dev](https://zotero-plugin.dev/):

| Package | Repo | Role |
|---|---|---|
| `zotero-plugin-template` | [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) | Opinionated starter repo: TypeScript, hooks structure, examples, CI |
| `zotero-plugin-toolkit` | [windingwind/zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) | Runtime helper library: UI builders, dialogs, progress windows, menu/prefs registration, `unregisterAll()` |
| `zotero-plugin-scaffold` | [zotero-plugin-dev/zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold) (moved from `northword/`; docs now at [zotero-plugin.dev/zotero-plugin-scaffold](https://zotero-plugin.dev/zotero-plugin-scaffold/)) | Build/dev/release CLI: side-loading, hot reload, bundling, XPI packaging, `update.json` generation, GitHub Release upload |
| `zotero-types` | [windingwind/zotero-types](https://github.com/windingwind/zotero-types) | TypeScript type definitions for the `Zotero` global |
| `@zotero-plugin/eslint-config` | — | Shared ESLint config |

### 4.2 Current versions — and a warning about the template

Published versions as of 2026-09-08 (npm registry):

| Package | Latest | Published | Notes |
|---|---|---|---|
| `zotero-plugin-toolkit` | **5.2.0** | 2026-07-21 | ESM-only, MIT, Node ≥ 18 |
| `zotero-plugin-scaffold` | **0.9.2** | 2026-09-08 | AGPL-3.0-or-later, Node ≥ 22.8 |
| `zotero-types` | **4.1.3** | 2026-07-24 | repo HEAD 2026-08-02 adds Zotero 10 `SaveOptions` undo fields |
| `zotero-plugin-template` | 3.1.0 (git tag) | — | **not on npm**; GitHub "Use this template" repo |

> ⚠️ **The template is ~9 months stale.** `main` HEAD is `306d4e2` (2025-12-16), a dependabot bump. It pins `zotero-plugin-toolkit ^5.1.0-beta.13` and `zotero-plugin-scaffold ^0.8.2`, its `addon/manifest.json` declares `"strict_max_version": "8.*"` (no Zotero 9 or 10), its esbuild target is `firefox115` (the Zotero 7 baseline), and its example modules call `ztoolkit.Menu.register(...)` and `import { ZoteroToolkit } from "zotero-plugin-toolkit"` — **both removed in current toolkit versions** (§4.6).
>
> Practical consequence: `npm ci` works because the committed lockfile pins the old beta, but a fresh `npm install` resolving `^5.1.0-beta.13` → `5.2.0` **will not compile**. Plan on re-baselining the template rather than using it as-is.

The template's `package.json` on `main`, verbatim:

```json
{
  "name": "zotero-plugin-template",
  "type": "module",
  "version": "3.1.0",
  "config": {
    "addonName": "Zotero Plugin Template",
    "addonID": "addontemplate@euclpts.com",
    "addonRef": "addontemplate",
    "addonInstance": "AddonTemplate",
    "prefsPrefix": "extensions.zotero.addontemplate"
  },
  "scripts": {
    "start": "zotero-plugin serve",
    "build": "zotero-plugin build && tsc --noEmit",
    "lint:check": "prettier --check . && eslint .",
    "lint:fix": "prettier --write . && eslint . --fix",
    "release": "zotero-plugin release",
    "test": "zotero-plugin test"
  },
  "dependencies": {
    "zotero-plugin-toolkit": "^5.1.0-beta.13"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "zotero-plugin-scaffold": "^0.8.2",
    "zotero-types": "^4.1.0-beta.4",
    "@zotero-plugin/eslint-config": "^0.6.7",
    "eslint": "^9.39.2",
    "prettier": "^3.7.4",
    "mocha": "^11.7.5",
    "chai": "^6.2.1"
  }
}
```

If you scaffold from this, immediately change `strict_min_version` / `strict_max_version` to `"10.0"` / `"10.0.*"` and re-verify every example module against Zotero 10 (particularly the `ZoteroPane.getSelectedCollection()` family — see §3.4a).

### 4.3 `zotero-plugin-toolkit` v5: what exists, and what was removed

`ZoteroToolkit` composes these (verified against the `5.2.0` published `.d.ts`):

| `ztoolkit.*` | Class | Notes |
|---|---|---|
| `UI` | `UITool` | `createElement`, `appendElement`, `replaceElement`, `parseXHTMLToFragment` |
| `Dialog` | `DialogHelper` | grid dialog with `data-bind` two-way binding |
| `ProgressWindow` | `ProgressWindowHelper` | chainable wrapper over `Zotero.ProgressWindow` |
| `VirtualizedTable` | `VirtualizedTableHelper` | wraps Zotero's React table |
| `Clipboard` | `ClipboardHelper` | |
| `FilePicker` | `FilePickerHelper` | |
| `Keyboard` | `KeyboardManager` | replaces the removed `Shortcut` manager |
| `Prompt` | `PromptManager` | Zotero's command palette |
| `Reader` | `ReaderTool` | replaces the removed `ReaderInstance` |
| `ExtraField` | `ExtraFieldTool` | |
| `FieldHooks` | `FieldHookManager` | |
| `Patch` | `PatchHelper` | monkey-patching with auto-unpatch |
| `LargePrefObject` | `LargePrefHelper` | chunked storage across prefs |
| `Guide` | `GuideHelper` | `@alpha` |
| `unregisterAll()` | — | tears down everything the toolkit registered |

`SettingsDialogHelper` and `MessageHelper` are exported from the package root but are **not** wired into `ZoteroToolkit` — construct them directly.

**Removals you will trip over** (verified by diffing published tarballs):

| Removed | Version | Replacement |
|---|---|---|
| `ztoolkit.Menu` / `MenuManager` | 5.1.0-beta.14 (stable in 5.1.1) | **native `Zotero.MenuManager.registerMenu()`** (Zotero 8+) |
| `ztoolkit.PreferencePane` | 3.0.0 | **native `Zotero.PreferencePanes.register()`** |
| `ztoolkit.ItemTree` | 3.0.0 | **native `Zotero.ItemTreeManager.registerColumn()`** (the plural `registerColumns()` still exists but is marked `@deprecated` in `itemTreeManager.js`) |
| `ztoolkit.ItemBox` | 3.0.0 | **native `Zotero.ItemPaneManager.registerInfoRow()`** |
| `ztoolkit.LibraryTabPanel`, `ztoolkit.ReaderTabPanel` | 3.0.0 | **native `Zotero.ItemPaneManager.registerSection()`** |
| `ztoolkit.Shortcut` | 3.0.0 | `ztoolkit.Keyboard` |
| `ztoolkit.ReaderInstance` | 3.0.0 | `ztoolkit.Reader` |

**Breaking in 5.2.0:** `import { ZoteroToolkit } from "zotero-plugin-toolkit"` no longer resolves — the class moved to a subpath export:

```typescript
import { ZoteroToolkit } from "zotero-plugin-toolkit/ztoolkit";
```

This is the single most likely first-hour build failure when starting from the template.

> ⚠️ The toolkit's own documentation site still advertises a `MenuManager` feature card and says "Zotero 6, 7, and 8" in its quick-start. **Both are stale for 5.1.1+.** Trust the published `.d.ts` over the docs site.
>
> **Unverified:** the maintainers never published a migration table for the 3.0.0 removals (the GitHub release body is empty), so the "replacement" column above is inferred from the template's own example code plus the Zotero client source. The removals themselves are empirically verified.

This all reinforces §1.2: **use the native Zotero manager APIs.** The toolkit is deliberately shedding wrappers as Zotero grows first-party equivalents, so code written against `Zotero.MenuManager` / `Zotero.ItemPaneManager` / `Zotero.PreferencePanes` survives toolkit churn as well as Zotero churn.

### 4.4 What the template gives you, structurally

The template splits the plugin into a thin bootstrap and a bundled TypeScript app.

`addon/bootstrap.js` (build-time placeholders like `__addonRef__` are substituted by scaffold):

```javascript
var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    // No slash: `rootURI` already ends with one — measured 2026-09-10
    // (P0-T09) as `jar:file:///…/<id>.xpi!/`. §2.5 above had this right and
    // this line had it wrong; the doubled form happened to work because
    // Gecko's jar: resolver tolerates `!//`.
    `${rootURI}content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  await Zotero.__addonInstance__?.hooks.onShutdown();
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
```

`src/index.ts` — installs the singleton on the `Zotero` object and defines the `ztoolkit` global:

```typescript
import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  Zotero[config.addonInstance] = addon;
}
```

`src/hooks.ts` — the dispatcher. Note the startup barrier and the per-window re-entry:

```typescript
async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  BasicExampleFactory.registerPrefs();
  BasicExampleFactory.registerNotifier();
  UIExampleFactory.registerItemPaneSection();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  delete Zotero[addon.data.config.addonInstance];
}
```

Two things worth stealing outright:

1. **`await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise])`** at the top of startup. `startup()` can run before the database is open and before the UI exists; awaiting these three avoids a whole class of "undefined is not an object" crashes.
2. **`ztoolkit.unregisterAll()`** — the toolkit tracks everything it registered (menus, columns, panes, shortcuts, observers) and tears it down in one call. This is the cheapest possible insurance against the leak problems in §2.4.

### 4.5 `zotero-plugin-scaffold`

`zotero-plugin.config.ts` from the template, verbatim:

```typescript
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },
});
```

#### CLI

| Command | Options | Notes |
|---|---|---|
| `zotero-plugin build` | `--dev`, `--dist <dir>` | `NODE_ENV=production` unless `--dev` |
| `zotero-plugin serve` (alias `dev`) | — | dev server + hot reload |
| `zotero-plugin test` | `--abort-on-fail`, `--exit-on-finish`, `--no-watch` | Mocha + Chai **inside a real Zotero** |
| `zotero-plugin release [version]` | `--preid <preid>`, `-y` | bump → build → tag → GitHub Release |
| `zotero-plugin create` | — | **not implemented** (logs "not yet implemented") |

#### Build pipeline (ordered)

clean `dist` → copy assets → **`define` substitution** (each key `k` becomes `/__k__/g` across copied assets, which is how `__addonRef__` in `bootstrap.js` and `manifest.json` gets filled) → **manifest generation** (deep-merges `name`, `version`, `manifest_version: 2`, `applications.zotero.{id,update_url}` into your `addon/manifest.json`; existing values win) → **Fluent handling** (prefixes `.ftl` filenames *and* message IDs with `${namespace}-`, generates `typings/i10n.d.ts`) → **prefs** (prefixes keys in `prefs.js` and `preference=` attributes in XHTML, generates `typings/prefs.d.ts`) → esbuild bundle → *(production)* zip to `.xpi` → *(production)* `update.json` / `update-beta.json`.

Two consequences worth internalising:

* **Fluent IDs are auto-prefixed at build time.** Write `startup-begin` in `addon/locale/en-US/*.ftl` and scaffold emits `research-helper-startup-begin`. This satisfies the global-namespace rule from §9.3 automatically — but it means the IDs in your source files do *not* match the IDs in the shipped XPI. Know which you are looking at when debugging.
* **`addon/prefs.js` is written unprefixed** (`pref("enable", true);`) and scaffold prefixes it with `build.prefs.prefix`. Same caveat.

> ⚠️ **Scaffold does not write `strict_min_version` / `strict_max_version`.** Its manifest builder only merges `name`, `version`, `manifest_version` and `applications.zotero.{id, update_url}`. **Your `addon/manifest.json` owns the Zotero compatibility range** — which is exactly the field that must change every 6–10 weeks (§1.3).

#### Hot reload uses RDP, not proxy files

`zotero-plugin serve` passes `--purgecaches` and then the string `no-remote` — **without a
leading dash**, verified 2026-09-10 by reading scaffold 0.9.2's `startZoteroInstance()`
(`let args = ["--purgecaches", "no-remote"]`). A bare `no-remote` is not a flag; Gecko treats it
as a positional argument, so the isolation `-no-remote` would give is **not** in effect and a
`serve` launched while another Zotero is running may attach to that instance instead of starting
its own. Close Zotero before `npm start`. This is a scaffold bug worth reporting upstream; the
rest of this sentence is accurate: adds `--jsdebugger` when `server.devtools` (default true), and captures Zotero's debug output to `.scaffold/logs/zotero-<starttime>.log` when `server.debugOutputFile` (default true), pruning logs older than 7 days.

The reload itself goes over the **Firefox Remote Debugging Protocol** — the same mechanism Mozilla's `web-ext` uses — so the plugin is installed and reloaded inside the running Zotero with no restart. The extension-proxy-file approach (§11.6) is legacy and opt-in via `server.asProxy: true`; proxy files cannot hot-reload.

Configure the binary via `.env`:

```ini
ZOTERO_PLUGIN_ZOTERO_BIN_PATH = C:\Program Files\Zotero\zotero.exe   # required
ZOTERO_PLUGIN_PROFILE_PATH    = C:\Users\you\Zotero-dev-profile      # optional
# GITHUB_TOKEN =                                                     # local publishing only
```

#### Release

Two phases. **Bump** (via `bumpp`): prompts for the version, updates `package.json`, runs `release.bumpp.execute` (default `npm run build`), commits `chore(publish): release v%s`, tags `v%s`, pushes. **Publish** (via `@octokit/rest`): creates a release tagged `v{version}` with the XPI attached, **plus** creates/updates a separate permanent release tagged **`release`** carrying `update.json` and `update-beta.json`. That is where the stable `…/releases/download/release/update.json` URL comes from.

Pre-release behaviour: a version containing `-` regenerates **only** `update-beta.json`; a stable version regenerates **both**, so beta testers roll forward onto stable.

Defaults to `release.github.enable: "ci"` — set `"local"` plus a `GITHUB_TOKEN` in `.env` to publish from your machine.

> ⚠️ Note `target: "firefox115"` in the template's esbuild options — the Zotero 7 baseline. For a Zotero-10-only plugin raise it to `firefox140`. Verify by building and smoke-testing.
>
> **Unverified:** whether scaffold 0.9.x's RDP client has been validated against Zotero 10 specifically; its docs only say "Zotero 7 and later", and no 0.9.x changelog was retrievable. Test `zotero-plugin serve` against your Zotero 10 install on day one — if hot reload misbehaves, `server.asProxy: true` plus manual restarts is the fallback.

### 4.6 Recommended toolchain for `research_helper`

**Adopt the template, but re-baseline it.**

```
Node 22.8+ LTS                  (scaffold 0.9.x requires it)
pnpm or npm
TypeScript 5.9
zotero-plugin-scaffold ^0.9.2   → build / serve / release / test
zotero-plugin-toolkit  ^5.2.0   → Dialog, VirtualizedTable, FilePicker, Clipboard, unregisterAll()
zotero-types           ^4.1.3   → types for the Zotero global (tracks Zotero 10)
esbuild (via scaffold)          → single-file bundle, target firefox140
eslint 9 + @zotero-plugin/eslint-config + prettier
mocha + chai (via `zotero-plugin test`)
GitHub Actions                  → build on PR, release on tag
```

`tsconfig.json` — the `sandbox` entry is the right one for a bootstrapped plugin:

```jsonc
{
  "extends": "zotero-types/entries/sandbox/",
  "include": ["src", "typings"],
  "exclude": ["build", "addon", ".scaffold"]
}
```

`zotero-types` ships several entries; pick by execution context:

| Entry | Use for |
|---|---|
| `sandbox` | plugin code loaded from `bootstrap.js` — privileged, `Zotero`, no DOM |
| `xhtml` | your dialog/prefs-pane scripts — privileged, `Zotero`, XUL + DOM |
| `mainWindow` | code touching `ZoteroPane` / `Zotero_Tabs` |
| `webworker`, `html`, `base`, `shared` | as named |

pnpm users must add `public-hoist-pattern[]=*@types/bluebird*` to `.npmrc`.

Concrete deviations from the template to make on day one:

1. `addon/manifest.json`: `strict_min_version: "10.0"`, `strict_max_version: "10.0.*"` (scaffold will not write these for you).
2. Bump `zotero-plugin-toolkit` to `^5.2.0` and change the import to `zotero-plugin-toolkit/ztoolkit`.
3. Delete every `ztoolkit.Menu.register(...)` call — the API no longer exists (§4.3). Use `Zotero.MenuManager.registerMenu`.
4. Delete `src/modules/examples.ts` once read; several snippets predate Zotero 8, let alone 10.
5. Raise the esbuild `target` to `firefox140`.
6. Set the scaffold's `prefsPrefix` and `namespace` fields. `prefsPrefix` is `extensions.zotero.research-helper` — the preference branch this document's §7.1 decides. **The `namespace` value is `13-testing-build-and-release.md` §1.4's, not this document's: it is `researchHelper`.** `namespace` is the *JavaScript* namespace — it is what makes the plugin's global `Zotero.ResearchHelper` — and it is deliberately a **different string** from the preference prefix; §1.4 explains why and is the project-specific configuration of record. (An earlier draft of this line gave `research-helper` here, conflating the two fields; that is the conflation §1.4 warns against.)
7. Point `updateURL` at your repo's permanent `release` tag.
8. Prefer the **native managers** over toolkit wrappers wherever a native one exists (§1.2, §4.3). Keep the toolkit for `DialogHelper`, `VirtualizedTableHelper`, `FilePickerHelper` and `ClipboardHelper`, imported individually. **Do not construct `ZoteroToolkit`** and do not use `KeyboardManager`: measured 2026-09-14 (`P0-T11`), every `ZoteroToolkit` instance permanently leaks a `Zotero.Plugins` observer, a `Zotero.Reader` `renderToolbar` listener filed under the toolkit's default id (its `KeyboardManager` constructor reads `pluginID` before the template's `initZToolkit()` sets it), and three `Zotero.Item.prototype` wrappers from `FieldHookManager` — none of which `unregisterAll()` removes. Any helper a later card adopts must first pass `P0-T33`'s leak counters across five disable/enable cycles.

> **Unverified:** the contents of `@zotero-plugin/eslint-config` (latest `0.6.10`; the template pins `^0.6.7`). It is convenient but not load-bearing — you can drop it for a plain ESLint config.

---

## 5. Core JavaScript APIs

The authoritative overview is [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api); the authoritative *detail* is the source tree. Everything below is either quoted from that page or read from `chrome/content/zotero/xpcom/` on `main`.

### 5.0 Scopes

* **Window scope** — code in a main/secondary window; has DOM access and `ZoteroPane`.
* **Non-window scope** — the `Zotero` object itself; data layer, no DOM.
  Get the active pane from anywhere with `Zotero.getActiveZoteroPane()`; get windows with `Zotero.getMainWindows()` / `Zotero.getMainWindow()`.

### 5.1 Reading items

```javascript
// Synchronous, only for already-loaded items
const item = Zotero.Items.get(itemID);

// Async load — always use this after a search or for arbitrary IDs
const items = await Zotero.Items.getAsync(itemIDs);   // accepts array or single id

// Fields
const title    = item.getField('title');
const doi      = item.getField('DOI');
const abstract = item.getField('abstractNote');
const date     = item.getField('date');

// Type
item.itemType;        // 'journalArticle'
item.itemTypeID;      // numeric
item.isRegularItem(); // true for non-attachment/note/annotation

// Creators, notes, attachments, tags
const creators     = item.getCreators();     // [{firstName, lastName, creatorTypeID, fieldMode}]
const noteIDs      = item.getNotes();        // child note IDs
const attachIDs    = item.getAttachments();  // child attachment IDs
const tags         = item.getTags();         // [{tag, type}]

// A whole item as plain JSON (very useful for feeding an LLM)
const json = item.toJSON();
```

Reading child notes and attachment text, from the official docs:

```javascript
var noteIDs = item.getNotes();
for (let id of noteIDs) {
    let note = Zotero.Items.get(id);
    let noteHTML = note.getNote();
}

let attachmentIDs = item.getAttachments();
for (let id of attachmentIDs) {
    let attachment = Zotero.Items.get(id);
    let text = await attachment.attachmentText;   // extracted full text, if indexed
}
```

`attachmentText` is exactly what `research_helper` should prefer for summarisation when the abstract is missing or thin — but it can be empty if the PDF has not been indexed yet, so always fall back to `abstractNote`.

> **Unverified:** whether `item.loadAllData()` is still required before synchronous field access in Zotero 10. `Zotero.Items.getAsync()` loads primary data; historically `item.loadAllData()` (or `Zotero.Items.loadDataTypes()`) was needed for creators/tags/notes on items fetched by ID in a fresh session. Modern Zotero appears to load these eagerly for items obtained via `getAsync`. Verify in the debug console with a large library before relying on synchronous `getCreators()` immediately after `getAsync`.

### 5.2 Creating items

Verbatim from [the JavaScript API docs](https://www.zotero.org/support/dev/client_coding/javascript_api):

```javascript
var item = new Zotero.Item('book');
item.setField('title', 'Much Ado About Nothing');
item.setCreators([
    {
        firstName: "William",
        lastName: "Shakespeare",
        creatorType: "author"
    }
]);
var itemID = await item.saveTx();
```

The `research_helper` shape, importing a paper from an external API:

```javascript
/**
 * @param {Object} rec  normalised record from PubMed/Crossref/S2/arXiv
 * @param {number} libraryID
 * @param {number[]} collectionIDs
 * @returns {Promise<Zotero.Item>}
 */
async function createItemFromRecord(rec, libraryID, collectionIDs) {
  const item = new Zotero.Item(rec.isPreprint ? 'preprint' : 'journalArticle');
  item.libraryID = libraryID;

  item.setField('title', rec.title);
  if (rec.abstract)   item.setField('abstractNote', rec.abstract);
  if (rec.date)       item.setField('date', rec.date);          // Zotero parses many formats
  if (rec.doi)        item.setField('DOI', rec.doi);
  if (rec.url)        item.setField('url', rec.url);
  if (rec.language)   item.setField('language', rec.language);

  if (!rec.isPreprint) {
    if (rec.journal) item.setField('publicationTitle', rec.journal);
    if (rec.volume)  item.setField('volume', rec.volume);
    if (rec.issue)   item.setField('issue', rec.issue);
    if (rec.pages)   item.setField('pages', rec.pages);
    if (rec.issn)    item.setField('ISSN', rec.issn);
  } else {
    if (rec.repository) item.setField('repository', rec.repository); // e.g. "arXiv"
    if (rec.archiveID)  item.setField('archiveID', rec.archiveID);   // e.g. "arXiv:2408.01234"
  }

  item.setCreators(rec.authors.map(a => ({
    creatorType: 'author',
    firstName: a.given ?? '',
    lastName:  a.family ?? a.literal ?? '',
  })));

  // PMID/PMCID are REAL fields on journalArticle since Zotero 7.0.31 (schema 34).
  // They are NOT valid on preprint — see §5.2.1 for the version-portable way to do this.
  if (!rec.isPreprint) {
    if (rec.pmid)  item.setField('PMID', rec.pmid);
    if (rec.pmcid) item.setField('PMCID', rec.pmcid);
  }

  item.addTag('research_helper', 1);            // 1 = automatic tag
  if (collectionIDs?.length) item.setCollections(collectionIDs);

  await item.saveTx({
    undoAction: 'undo-action-add-item',         // Zotero 10 undo support
  });
  return item;
}
```

Notes on the above:

* **Creator object shape.** For a two-field name: `{ creatorType, firstName, lastName }`. For a single-field (institutional) name: `{ creatorType, name: "World Health Organization", fieldMode: 1 }`. `fieldMode: 1` means single-field.
* **`setCollections()`** takes collection **IDs or keys** and replaces the item's collection membership. Use it at creation time; use `collection.addItem(itemID)` to add later.
* **Tag type.** `item.addTag(name, type)` — type `0` = manual (blue), `1` = automatic (orange). Tag `research_helper`-created items automatically so users can find/undo them.

> **Unverified:** the exact `undoAction` identifier `'undo-action-add-item'`. Zotero 10 documents the mechanism and shows `'undo-action-edit-metadata'`; the full ID list was not found. Grep `zotero.ftl` for `undo-action-` before shipping, and omit the option if no suitable ID exists rather than inventing one.

### 5.2.1 Prefer `item.fromJSON()` over field-by-field `setField()`

`setField()` throws on an invalid field for the type, so hand-mapping means you own a validation matrix that changes with every schema bump. `Zotero.Item.prototype.fromJSON(json, options)` does that work for you, and does something better besides.

In non-strict mode (the default), `fromJSON`:

* **Migrates recognised `Extra` lines into real fields** via `Zotero.Utilities.Internal.extractExtraFields()` — so `extra: "PMID: 23851394"` lands in the real `PMID` field on a `journalArticle`;
* **Pushes unknown or invalid-for-type fields back into `Extra`** rather than throwing, logging `Storing unknown field '<name>' in Extra for item <key>`;
* Resolves base-field mappings (so `publisher` on a `preprint` becomes `repository`).

That combination makes one code path version-portable across the Zotero 7.0.31 boundary where `PMID`/`PMCID` became real fields:

```javascript
async function createItemFromRecord(rec, libraryID, collectionIDs) {
  await Zotero.Schema.schemaUpdatePromise;      // gate: types/fields must be loaded

  const item = new Zotero.Item();
  item.libraryID = libraryID;
  item.fromJSON({
    itemType: rec.isPreprint ? 'preprint' : 'journalArticle',
    title: rec.title,
    abstractNote: rec.abstract,
    date: rec.date,                              // free-form; Zotero parses it
    DOI: rec.doi,
    url: rec.url,
    language: rec.language,
    creators: rec.authors.map(a => a.literal
      ? { creatorType: 'author', name: a.literal, fieldMode: 1 }
      : { creatorType: 'author', firstName: a.given ?? '', lastName: a.family ?? '' }),
    // journalArticle-only; harmlessly rerouted to Extra on other types
    publicationTitle: rec.journal,
    volume: rec.volume,
    issue: rec.issue,
    pages: rec.pages,
    ISSN: rec.issn,
    PMID: rec.pmid,
    PMCID: rec.pmcid,
    // preprint-only
    repository: rec.repository,                  // "arXiv" | "bioRxiv" | "medRxiv"
    archiveID: rec.archiveID,                    // "arXiv:2408.01234"
  });
  item.addTag('research_helper', 1);
  if (collectionIDs?.length) item.setCollections(collectionIDs);
  await item.saveTx();
  return item;
}
```

Two hard rules:

1. ⚠️ **`fromJSON` is a replace, not a merge.** Its implementation clears every field present on the item but absent from the JSON. **Never use it to patch an existing item** — use `setField` for updates (e.g. abstract backfill).
2. **Develop with `{ strict: true }`.** In strict mode, an unknown or invalid field throws an `Error` with `e.name === "ZoteroInvalidDataError"` instead of being silently swept into `Extra`. Run your mapping tests strict, ship non-strict.

### 5.3 Validating fields before you set them

`setField` on a field that is invalid for the item type will throw. When mapping heterogeneous upstream records, validate:

```javascript
function safeSetField(item, fieldName, value) {
  if (value === undefined || value === null || value === '') return;
  const fieldID = Zotero.ItemFields.getID(fieldName);
  if (!fieldID) {
    Zotero.debug(`[research_helper] unknown field: ${fieldName}`);
    return;
  }
  if (!Zotero.ItemFields.isValidForType(fieldID, item.itemTypeID)) {
    Zotero.debug(`[research_helper] ${fieldName} invalid for ${item.itemType}`);
    return;
  }
  item.setField(fieldID, value);
}

// Enumerate what a type accepts (useful when building the mapping table)
const typeID = Zotero.ItemTypes.getID('preprint');
const fieldIDs = Zotero.ItemFields.getItemTypeFields(typeID);
const fieldNames = fieldIDs.map(id => Zotero.ItemFields.getName(id));

// Valid creator types for a type
const creatorTypes = Zotero.CreatorTypes.getTypesForItemType(typeID);
Zotero.CreatorTypes.getPrimaryIDForType(typeID);
Zotero.CreatorTypes.isValidForItemType(creatorTypeID, typeID);
```

**Base-field mapping** is the piece people miss. Many type-specific fields are aliases of a shared "base" field, which is how you write a generic mapper without a per-type lookup table:

```javascript
// preprint: base 'publisher' → 'repository', base 'number' → 'archiveID'
Zotero.ItemFields.getFieldIDFromTypeAndBase(typeID, 'publisher');
Zotero.ItemFields.getBaseIDFromTypeAndField(typeID, 'repository');
Zotero.ItemFields.getTypeFieldsFromBase('publicationTitle', true);
// → ['publicationTitle', 'proceedingsTitle', 'bookTitle', 'websiteTitle', …]
```

⚠️ **Gate every type/field lookup on the schema being loaded.** `Zotero.ItemFields.getID()` / `getName()` throw `Zotero.Exception.UnloadedDataException` if called too early:

```javascript
await Zotero.Schema.schemaUpdatePromise;
Zotero.Schema.globalSchemaVersion;      // e.g. 42
```

> **Recommended:** generate the field mapping table for `journalArticle` / `preprint` / `conferencePaper` **at runtime** with the snippet above and commit the output as a test fixture. The schema is versioned and changes independently of Zotero releases — clients fetch it from the API — so a hard-coded list silently rots. **Feature-detect** rather than version-check: `Zotero.ItemFields.getID('PMID')` returning a truthy ID is the correct way to ask "does this client have real PMID fields?".

### 5.4 Collections

From the official docs:

```javascript
var collection = new Zotero.Collection();
collection.name = name;
collection.parentID = currentCollection.id;
var collectionID = await collection.saveTx();
```

For `research_helper` (creating a result collection and filling it):

```javascript
async function createResultCollection(name, libraryID, parentID = null) {
  const coll = new Zotero.Collection();
  coll.libraryID = libraryID;
  coll.name = name;                      // e.g. "research_helper — CRISPR delivery (2026-09-08)"
  if (parentID) coll.parentID = parentID;
  await coll.saveTx();
  return coll;
}

// Reading
const coll  = Zotero.Collections.get(collectionID);
const coll2 = await Zotero.Collections.getAsync(collectionID);
const items = coll.getChildItems();          // Zotero.Item[]
const ids   = coll.getChildItems(true);      // IDs only
const subs  = coll.getChildCollections();

// Adding existing items
await coll.addItems(itemIDs);                // batched, transaction-wrapped
```

> **Unverified:** whether `collection.addItems()` exists as a plural alongside `addItem()` in Zotero 10, and whether either auto-saves or requires a subsequent `saveTx()`. Both `addItem`/`addItems` appear in Zotero source history. The safest, definitely-correct pattern is to set membership on the item side:
>
> ```javascript
> await Zotero.DB.executeTransaction(async function () {
>   for (const item of items) {
>     item.addToCollection(collection.id);
>     await item.save();
>   }
> });
> ```
> Confirm `addToCollection` / `removeFromCollection` in the console before choosing.

### 5.5 Search

Official examples:

```javascript
var s = new Zotero.Search();
s.libraryID = Zotero.Libraries.userLibraryID;
s.addCondition('tag', 'is', 'tag name');
s.addCondition('creator', 'contains', 'smith');
s.addCondition('joinMode', 'any');       // default is 'all'
s.addCondition('recursive', 'true');     // include subcollections
s.addCondition('deleted', 'true');       // include trashed items
var itemIDs = await s.search();
var items = await Zotero.Items.getAsync(itemIDs);
```

`research_helper` needs a duplicate check before importing — "does an item with this DOI already exist in this library?":

**Every item field is automatically available as a search condition.** Zotero's `searchConditions.js` builds condition aliases from `SELECT fieldName FROM fieldsCombined`, excluding `accessDate`, `pages`, `section`, `seriesNumber` and `issue` (which are handled by other condition groups). So `addCondition('DOI', …)` and `addCondition('PMID', …)` work without any registration.

```javascript
async function findByDOI(libraryID, doi) {
  doi = Zotero.Utilities.cleanDOI(doi);
  if (!doi) return [];
  const s = new Zotero.Search();
  s.libraryID = libraryID;
  s.addCondition('DOI', 'is', doi);
  s.addCondition('deleted', 'false');
  const ids = await s.search();
  return ids.length ? await Zotero.Items.getAsync(ids) : [];
}

async function findByPMID(libraryID, pmid) {
  // Real field since Zotero 7.0.31 / schema 34
  const s = new Zotero.Search();
  s.libraryID = libraryID;
  s.addCondition('PMID', 'is', String(pmid));
  s.addCondition('deleted', 'false');
  let ids = await s.search();
  if (ids.length) return Zotero.Items.getAsync(ids);

  // Fallback: items saved by older translators still carry it in Extra
  const s2 = new Zotero.Search();
  s2.libraryID = libraryID;
  s2.addCondition('extra', 'contains', `PMID: ${pmid}`);
  s2.addCondition('deleted', 'false');
  ids = await s2.search();
  return ids.length ? Zotero.Items.getAsync(ids) : [];
}
```

Run **both** branches of `findByPMID`. Many items in a real library were saved before schema 34 and still hold the identifier in `Extra`.

`addCondition` throws `ZoteroInvalidDataError` for an invalid condition/operator pair — wrap it if you support more than one Zotero version.

**Do not use `Zotero.Duplicates` for this.** It exists, but it is a library-wide, UI-oriented scan (`new Zotero.Duplicates(libraryID)` → `getSearchObject()` → `search()`), not an identifier lookup. Its heuristic matches on canonicalised ISBN-13, uppercased DOI, or normalised title + creator surname/initial + year within ±1, with mismatched DOIs/ISBNs vetoing a title match. Useful to know if you ever want a "find duplicates in this collection" feature; useless for "does this DOI already exist".

**Zotero 10 changes you must respect** ([Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)):

* `addCondition(condition, operator, value)` — the legacy fourth `required` argument now **throws**. Never pass it.
* Nested logic uses `groupStart` / `groupEnd` pseudo-conditions with `joinMode` inside the group.
* `fulltextWord` is **removed**; use `fulltextContent`.

```javascript
// Zotero 10 condition groups: (DOI is X) OR (extra contains PMID: Y)
const s = new Zotero.Search();
s.libraryID = libraryID;
s.addCondition('joinMode', 'any');
s.addCondition('groupStart');
s.addCondition('DOI', 'is', doi);
s.addCondition('groupEnd');
s.addCondition('groupStart');
s.addCondition('extra', 'contains', `PMID: ${pmid}`);
s.addCondition('groupEnd');
const ids = await s.search();
```

> **Unverified:** the exact semantics of `joinMode` *inside* a `groupStart`/`groupEnd` pair in Zotero 10 (whether each group carries its own `joinMode` condition, and where it must be positioned). The Zotero 10 developer page announces the feature but does not document the call sequence. **Verify this in Tools → Developer → Run JavaScript before building duplicate detection on it**, and keep a fallback that runs two flat searches and unions the results.

### 5.6 Attachments

Signatures read from [`chrome/content/zotero/xpcom/attachments.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/attachments.js) on `main`:

```javascript
Zotero.Attachments.LINK_MODE_IMPORTED_FILE   = 0
Zotero.Attachments.LINK_MODE_IMPORTED_URL    = 1
Zotero.Attachments.LINK_MODE_LINKED_FILE     = 2
Zotero.Attachments.LINK_MODE_LINKED_URL      = 3
Zotero.Attachments.LINK_MODE_EMBEDDED_IMAGE  = 4
```

```javascript
/**
 * @param {Object} options
 * @param {nsIFile|String} [options.file]      - File to add
 * @param {Integer}        [options.libraryID]
 * @param {Integer}        [options.parentItemID]
 * @param {String}         [options.title]
 * @param {Integer[]}      [options.collections]  - Collection keys or ids
 * @param {String}         [options.fileBaseName]
 * @param {String}         [options.contentType]
 * @param {String}         [options.charset]
 * @param {Object}         [options.saveOptions]  - Options for Item::save()
 * @return {Promise<Zotero.Item>}
 */
Zotero.Attachments.importFromFile(options)

/**
 * @param {Object} options
 * @param {Integer} options.libraryID
 * @param {String}  options.url
 * @param {Integer} [options.parentItemID]
 * @param {Integer[]} [options.collections]
 * @param {String}  [options.title]
 * @param {String}  [options.fileBaseName]
 * @param {Boolean} [options.renameIfAllowedType=false]
 * @param {String}  [options.contentType]
 * @param {String}  [options.referrer]
 * @param {Object}  [options.saveOptions]
 * @return {Promise<Zotero.Item>}
 */
Zotero.Attachments.importFromURL(options)

Zotero.Attachments.linkFromFile({ file, parentItemID, title, collections, contentType, charset, saveOptions })
Zotero.Attachments.linkFromURL({ url, parentItemID, contentType, title, collections, saveOptions })
Zotero.Attachments.importFromDocument({ libraryID, document, browser, parentItemID, forceTitle, collections, saveOptions })
Zotero.Attachments.importEmbeddedImage({ blob, parentItemID, saveOptions })
```

> ⚠️ **`Zotero.Attachments.importEmbeddedItems` does not exist.** The real method for saving an image into a note or annotation is **`importEmbeddedImage({ blob, parentItemID, saveOptions })`**. Do not use the plural name from older notes/tickets.

The `research_helper` use cases:

**(a) Attach a generated Markdown report to a collection's "report" item**

```javascript
async function saveMarkdownAttachment(parentItemID, markdown, baseName) {
  // Write to a temp file first, then import (copies into storage)
  const tmpDir  = Zotero.getTempDirectory().path;
  const tmpPath = PathUtils.join(tmpDir, `${baseName}.md`);
  await Zotero.File.putContentsAsync(tmpPath, markdown);

  const attachment = await Zotero.Attachments.importFromFile({
    file: tmpPath,
    parentItemID,
    title: `${baseName}.md`,
    contentType: 'text/markdown',
    charset: 'utf-8',
  });
  await IOUtils.remove(tmpPath);
  return attachment;
}
```

**(b) Attach TTS audio produced by Gemini**

```javascript
async function saveAudioAttachment(parentItemID, bytes /* Uint8Array */, baseName) {
  const tmpPath = PathUtils.join(Zotero.getTempDirectory().path, `${baseName}.wav`);
  await IOUtils.write(tmpPath, bytes);
  const attachment = await Zotero.Attachments.importFromFile({
    file: tmpPath,
    parentItemID,
    title: `${baseName}.wav`,
    contentType: 'audio/wav',
  });
  await IOUtils.remove(tmpPath);
  return attachment;
}
```

> ⚠️ Zotero 10 made `attachmentFilename` / `attachmentPath` setters **throw if the value contains slashes** ([Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)). Pass plain base names. Also **sanitise LLM-derived titles** before using them as filenames — strip `/ \ : * ? " < > |` and trim length.

**Verified 2026-09-08:** `Zotero.getTempDirectory()` still exists (`chrome/content/zotero/xpcom/zotero.js`), and `IOUtils`, `PathUtils` and `Localization` are assigned directly into the plugin sandbox's global scope by `_loadScope()` in [`chrome/content/zotero/xpcom/plugins.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/plugins.js) — no import needed. (The same function's `wantGlobalProperties` list supplies `atob`, `btoa`, `Blob`, `crypto`, `CSS`, `ChromeUtils`, `DOMParser`, `fetch`, `File`, `FileReader`, `TextDecoder`, `TextEncoder`, `URL`, `URLSearchParams`, `XMLHttpRequest`.) `Zotero.File.getContentsAsync` / `putContentsAsync` are documented on the [JavaScript API page](https://www.zotero.org/support/dev/client_coding/javascript_api) and remain the simpler choice for text.

**(c) Download a PDF for an imported item** — `importFromURL` with `parentItemID` and `contentType: 'application/pdf'`. Note that for open-access PDFs this is the correct path; Zotero also has its own OA-lookup machinery, which is out of scope here.

### 5.7 Notes

```javascript
// Standalone note
const note = new Zotero.Item('note');
note.libraryID = libraryID;
note.setNote('<h1>Recent research trends</h1><p>…</p>');
note.setCollections([collectionID]);
await note.saveTx();

// Child note attached to a paper (this is what the per-paper summary should be)
const child = new Zotero.Item('note');
child.libraryID = parentItem.libraryID;
child.parentItemID = parentItem.id;
child.setNote(
  `<h2>research_helper summary</h2>` +
  `<p>${Zotero.Utilities.text2html(summaryText)}</p>` +
  `<p><em>Model: ${model} · ${new Date().toISOString()}</em></p>`
);
await child.saveTx();

// Reading back
const html = note.getNote();
```

Zotero note content is **HTML**, stored and sanitised by Zotero's note editor stack. Keep to a conservative subset: `h1`–`h6`, `p`, `ul`/`ol`/`li`, `strong`, `em`, `a`, `blockquote`, `pre`, `code`, `table`. Convert LLM Markdown to that subset yourself — do **not** paste raw Markdown into `setNote()`, it will render as literal text.

> **Unverified:** the exact sanitisation whitelist Zotero applies to note HTML in version 10, and whether `Zotero.Notes` exposes a public Markdown→HTML helper. The [zotero-better-notes](https://github.com/windingwind/zotero-better-notes) plugin implements Markdown↔note-HTML conversion and is the reference implementation to study if you need fidelity.

### 5.8 Transactions

From the official docs — the batch pattern:

```javascript
await Zotero.DB.executeTransaction(async function () {
    for (let id of ids) {
        let item = await Zotero.Items.getAsync(id);
        item.setField(fieldID, newValue);
        await item.save();
    }
});
```

Rules:

* `item.saveTx()` = "save in its own transaction". `item.save()` = "save, assuming a transaction is already open". **Never call `saveTx()` inside `executeTransaction()`** — use `save()`.
* Batch your imports. Importing 50 search results as 50 separate `saveTx()` calls is 50 transactions and will be visibly slow; one `executeTransaction` around 50 `save()` calls is one.
* **Do not `await` network I/O inside `executeTransaction`.** Zotero's DB is single-writer; holding a transaction open across an HTTP round-trip will stall the whole application. Fetch everything first, then open the transaction and write.
* Zotero 10 enabled **WAL mode** on `zotero.sqlite`, which improves reader/writer concurrency but does not change the single-writer rule.
* Raw SQL is available via `Zotero.DB.queryAsync(sql, params)` — avoid it. The schema is not a public API and Zotero's own upgrade scripts will not know about your assumptions.

### 5.9 Notifier observers

Signature read from [`chrome/content/zotero/xpcom/notifier.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/notifier.js):

```javascript
/**
 * @param {Object}  [ref]      signature {notify: function(event, type, ids, extraData) {}}
 * @param {Array}   [types]    a list of types of events observer should be triggered on
 * @param {String}  [id]       an id of the observer used in debug output
 * @param {Integer} [priority] lower numbers correspond to higher priority
 * @returns {string}
 */
Zotero.Notifier.registerObserver(ref, types, id, priority)
Zotero.Notifier.unregisterObserver(id)
```

Valid `types` (the `_types` array in the source):

```
collection, search, share, share-items, item, file, collection-item,
item-tag, tag, setting, group, trash, bucket, relation, feed, feedItem,
sync, api-key, tab, itemtree, itempane, infobox
```

Events referenced in the source:

```
add, modify, delete, move, remove, refresh, redraw, trash,
unreadCountUpdated, index, pageChange
```

Usage in `research_helper` — refresh the item-pane summary section when the selected item changes, and invalidate caches when items are deleted:

```javascript
const observer = {
  notify(event, type, ids, extraData) {
    if (type === 'item' && (event === 'delete' || event === 'trash')) {
      ResearchHelper.summaryCache.invalidate(ids);
    }
  },
};

// in startup()
this.notifierID = Zotero.Notifier.registerObserver(
  observer,
  ['item', 'collection', 'tab'],
  'research-helper',
);

// in shutdown()
Zotero.Notifier.unregisterObserver(this.notifierID);
```

`registerObserver` returns the registration ID — **keep it and unregister on shutdown**, or you leak a live closure into a disabled plugin.

### 5.10 Other useful entry points

```javascript
Zotero.Libraries.userLibraryID
Zotero.Libraries.get(libraryID)          // .editable, .filesEditable, .isGroup
Zotero.getActiveZoteroPane()
Zotero.getMainWindow()
Zotero.getMainWindows()
Zotero.debug(msg, level)                 // goes to Help → Debug Output Logging
Zotero.logError(err)
Zotero.File.getContentsAsync(path)
Zotero.File.putContentsAsync(path, data)
Zotero.Utilities.text2html(str)
Zotero.Utilities.trimInternal(str)
Zotero.Utilities.cleanDOI(str)
Zotero.Promise.delay(ms)
Zotero.initializationPromise / Zotero.unlockPromise / Zotero.uiReadyPromise
```

---

## 6. Translating external metadata into Zotero items

There are two viable strategies. **`research_helper` should use both, in a specific order.**

### 6.1 Strategy A — hand-mapping (what we mostly do)

We already hold rich JSON from PubMed/Europe PMC/Crossref/Semantic Scholar/arXiv, including abstracts. Hand-mapping (§5.2) is deterministic, offline, and gives us the abstract — which is the whole point of the feature. Its cost is that we own the item-type and field mapping table.

#### Item types and their fields (verified against schema v42 at <https://api.zotero.org/schema>)

**`journalArticle`** — 31 fields:
`title`, `abstractNote`, `publicationTitle`, `publisher`, `place`, `date`, `volume`, `issue`, `section`, `partNumber`, `partTitle`, `pages`, `series`, `seriesTitle`, `seriesText`, `journalAbbreviation`, `DOI`, `citationKey`, `url`, `accessDate`, `PMID`, `PMCID`, `ISSN`, `archive`, `archiveLocation`, `shortTitle`, `language`, `libraryCatalog`, `callNumber`, `rights`, `extra`
Creators: `author` (primary), `contributor`, `editor`, `translator`, `reviewedAuthor`

**`preprint`** — 21 fields:
`title`, `abstractNote`, `genre` (base `type`), `repository` (base `publisher`), `archiveID` (base `number`), `place`, `date`, `series`, `seriesNumber`, `DOI`, `citationKey`, `url`, `accessDate`, `archive`, `archiveLocation`, `shortTitle`, `language`, `libraryCatalog`, `callNumber`, `rights`, `extra`
Creators: `author` (primary), `contributor`, `editor`, `translator`, `reviewedAuthor`

**`conferencePaper`** — 28 fields:
`title`, `abstractNote`, `proceedingsTitle` (base `publicationTitle`), `conferenceName`, `publisher`, `place`, `date`, `eventPlace`, `volume`, `issue`, `numberOfVolumes`, `pages`, `series`, `seriesNumber`, `DOI`, `ISBN`, `citationKey`, `url`, `accessDate`, `ISSN`, `archive`, `archiveLocation`, `shortTitle`, `language`, `libraryCatalog`, `callNumber`, `rights`, `extra`
Creators: `author` (primary), `contributor`, `editor`, `translator`, `seriesEditor`

`preprint` was added in **Zotero 6.0** (2022-03-17, schema v15).

#### Identifier fields — a recent and important change

**`PMID` and `PMCID` became real Zotero fields in Zotero 7.0.31 (2026-01-12, schema v34)** — the changelog entry reads "PMID and PMCID for journal articles". They exist **only on `journalArticle`**. The same schema commit added `DOI` to essentially every item type (37 types, including `book`, `report`, `thesis`, `webpage`, `preprint`, `dataset`).

An `arXivID` field was briefly added and then **removed before release** — it does not exist. For preprints, the arXiv identifier goes in **`archiveID`** alongside **`repository`**, which is exactly what Zotero's own arXiv translator emits:

```json
{ "itemType": "preprint", "archiveID": "arXiv:1810.04805", "repository": "arXiv", "DOI": "..." }
```

Crossref's `posted-content` / `subtype: preprint` maps to `preprint` with `repository` taken from `group-title` (e.g. "Cold Spring Harbor Laboratory" for bioRxiv).

**The `Extra` convention still works and is still what Zotero's translators emit.** The Europe PMC translator, in current code, does:

```javascript
item.extra = (item.extra || '') + `PMID: ${result.pmid}\n`;
item.extra = (item.extra || '') + `PMCID: ${result.pmcid}\n`;
```

This survives because `fromJSON` migrates recognised `Extra` lines into real fields (§5.2.1). The parser (`Zotero.Utilities.Internal.extractExtraFields`) matches `/^([a-z][a-z -_]+):(.+)/i` plus the legacy citeproc `{:key:value}` form, normalises keys (camelCase → hyphens, lowercased), and **only moves a value if the field is valid for the type and currently empty**. Its key map is built from `Zotero.ItemFields.getAll()` *plus* CSL variables, which is why `PMID`/`PMCID` matched even before they were real fields.

> ⚠️ **If you consume translator output directly** (e.g. from translation-server) **without** routing it through `item.fromJSON()`, you must parse `Extra` yourself — the translators have not been updated to write the new fields.

#### Mapping table for `research_helper`

| Source | Zotero item type | Identifier placement |
|---|---|---|
| PubMed / Europe PMC (journal article) | `journalArticle` | `PMID`, `PMCID`, `DOI` fields |
| Crossref `type: journal-article` | `journalArticle` | `DOI` |
| Crossref `type: posted-content` (`subtype: preprint`) | `preprint` | `DOI`, `repository` ← `group-title`, `archiveID` |
| Crossref `type: proceedings-article` | `conferencePaper` | `DOI`, `proceedingsTitle`, `conferenceName` |
| arXiv | `preprint` | `repository: "arXiv"`, `archiveID: "arXiv:2408.01234"` |
| bioRxiv / medRxiv | `preprint` | `repository: "bioRxiv"` / `"medRxiv"`, `DOI` |
| Semantic Scholar | follow `publicationTypes` / `externalIds` | prefer `journalArticle`, fall back to `preprint` |

> **Note on schema skew:** `api.zotero.org/schema` currently serves **v42**, while the `zotero-schema` repo's `master` is already at v44–45. Clients fetch the schema from the API on update, so repo `master` is *not* what a user's Zotero has. Always feature-detect (§5.3).

#### Dates

`setField` on a date field runs `if (Zotero.ItemFields.isDate(fieldID) && !Zotero.Date.isMultipart(value)) value = Zotero.Date.strToMultipart(value)` — so pass `"2024-03-15"`, `"March 2024"` or `"2024"` and Zotero parses it into its internal multipart form. EDTF ranges and "circa" survive.

```javascript
Zotero.Date.strToDate(str)     // → { order, year, month, day, part }  — month is 0-INDEXED,
                               //   and this is a plain object, NOT a JS Date
Zotero.Date.strToISO(str)      // → "YYYY" | "YYYY-MM" | "YYYY-MM-DD" | false
Zotero.Date.sqlToDate(s, isUTC)// → JS Date from "2006-06-13 11:03:05"
Zotero.Date.dateToSQL(d, isUTC)
Zotero.Date.dateToISO(d)
```

⚠️ **`accessDate` is different from `date`.** It is stored as a **SQL UTC datetime**; `setField` accepts an ISO date and converts internally, and *silently discards* anything that is not a SQL date/datetime (logging an error). The safe form is:

```javascript
item.setField('accessDate', Zotero.Date.dateToSQL(new Date(), true));
```

For the **"last 3 years"** filter, compute the cutoff once and compare against the *source's* date field before creating the item. Do not try to filter on Zotero's parsed multipart value.

### 6.2 Strategy B — let Zotero's translators do it (identifier lookup)

Zotero already ships translators that turn a DOI, PMID, arXiv ID or ISBN into a fully-populated item — this is what "Add Item by Identifier" (the magic-wand button) uses. Going through it gives you Zotero-canonical metadata for free, including correct item types and journal abbreviations.

The pipeline is `Zotero.Utilities.extractIdentifiers(text)` → `Zotero.Translate.Search` with `setIdentifier()` → `translate.translate({ libraryID, collections, saveAttachments })`. This is verified against Zotero's own [`chrome/content/zotero/lookup.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/lookup.js), whose core loop is:

```javascript
var identifiers = Zotero.Utilities.extractIdentifiers(textBox.value);
...
for (let identifier of identifiers) {
    let translate = new Zotero.Translate.Search();
    translate.setIdentifier(identifier);
    let translators = await translate.getTranslators();   // be lenient about translators
    translate.setTranslator(translators);
    try {
        newItems.push(...await translate.translate({ libraryID, collections, saveAttachments: !childItem }));
    }
    catch (e) { Zotero.logError(e); }
}
```

Passing the **whole translator list** (not just `translators[0]`) is deliberate: `Zotero.Translate.Search.prototype.complete` falls through to the next translator when one fails.

```javascript
/**
 * @param {String} text - a DOI, PMID, ISBN, or arXiv ID (or several, whitespace-separated)
 * @param {Number} libraryID
 * @param {Number[]} collectionIDs
 * @returns {Promise<Zotero.Item[]>}
 */
async function importByIdentifier(text, libraryID, collectionIDs) {
  await Zotero.Schema.schemaUpdatePromise;

  const identifiers = Zotero.Utilities.extractIdentifiers(text);
  if (!identifiers.length) throw new Error('No identifiers found in: ' + text);

  const saved = [];
  for (const identifier of identifiers) {
    const translate = new Zotero.Translate.Search();
    translate.setIdentifier(identifier);
    const translators = await translate.getTranslators();
    if (!translators.length) {
      Zotero.debug('[research_helper] no translators for ' + JSON.stringify(identifier));
      continue;
    }
    translate.setTranslator(translators);
    try {
      const items = await translate.translate({
        libraryID,
        collections: collectionIDs?.length ? collectionIDs : false,
        saveAttachments: true,
      });
      saved.push(...items);
    }
    catch (e) { Zotero.logError(e); }   // ERROR_NO_RESULTS etc. — keep going
  }
  return saved;
}
```

#### What `extractIdentifiers` actually accepts

⚠️ **`Zotero.Utilities.Internal.extractIdentifiers` is deprecated** — its body now just logs a deprecation notice and forwards to `Zotero.Utilities.extractIdentifiers`. Use the non-`Internal` form.

It returns objects keyed `DOI`, `ISBN`, `arXiv`, `adsBibcode`, or `PMID`, tried in **that strict priority order, stopping at the first type that matches**. arXiv version suffixes are stripped (`0706.0044v1` → `0706.0044`). The PMID branch is a loose fallback (`/(^|\s|,|:)(\d{1,9})(?=\s|,|$)/g`), so a bare number is only read as a PMID if nothing else matched.

> ⚠️ **PMCID is not recognised at all**, and `setIdentifier` accepts only `DOI`, `ISBN`, `PMID`, `arXiv`, `adsBibcode`. If your only identifier is a PMCID, resolve it to a PMID or DOI first via the Europe PMC API.

`setIdentifier` builds the search object like this (from `translate.js`):

```javascript
if (identifier.DOI)             search = { itemType: "journalArticle", DOI: identifier.DOI };
else if (identifier.ISBN)       search = { itemType: "book", ISBN: identifier.ISBN };
else if (identifier.PMID)       search = { itemType: "journalArticle", contextObject: "rft_id=info:pmid/" + identifier.PMID };
else if (identifier.arXiv)      search = { itemType: "journalArticle", arXiv: identifier.arXiv };
else if (identifier.adsBibcode) search = { itemType: "journalArticle", adsBibcode: identifier.adsBibcode };
else throw new Error("Unrecognized identifier");
```

Zotero's own lookup batches PubMed IDs 200 at a time as `[{ PMID: [id1, id2, …] }]` — worth copying for bulk imports.

#### Which translators actually participate

| Translator | ID | Type |
|---|---|---|
| DOI Content Negotiation | `b28d0d42-8549-4c6d-83fc-8382874a5cb9` | search |
| Crossref REST | `0a61e167-de9a-4f93-a68a-628b48855909` | search |
| PubMed | `3d0231ce-fd4b-478c-b1d3-840389e5b68c` | web + search |
| arXiv.org | `ecddda2e-4fc6-4aea-9f17-ef3b56d7377a` | web + search |
| Europe PMC | `0fd5beb3-646a-4e01-960b-e7168d9292e1` | **web only** |

> ⚠️ **Europe PMC is a web-only translator, so `Zotero.Translate.Search` will never invoke it.** PMID lookups resolve through the PubMed translator. There is likewise no Semantic Scholar *search* translator — the Semantic Scholar web translator internally delegates to DOI Content Negotiation. Do not expect identifier lookup to reach every database we search; that is precisely why Strategy A remains the fallback.

Pass a specific translator ID to `setTranslator()` to force one (e.g. Crossref REST for DOIs, skipping content negotiation).

`Zotero.Translate.Web` with a live document, for completeness:

```javascript
const translate = new Zotero.Translate.Web();
translate.setDocument(doc);
const translators = await translate.getTranslators();
translate.setTranslator(translators[0]);
const items = await translate.translate({ libraryID, collections, saveAttachments: true });
```

> ⚠️ **`Zotero.Translate.Search` is undocumented internal API.** There is no `zotero.org/support/dev` page for it; the closest is the [search-translator coding guide](https://www.zotero.org/support/dev/translators/coding#search_translators), which documents `detectSearch`/`doSearch` for *translator authors*, not consumers. There is no stability guarantee across major versions — wrap it in a try/catch and keep Strategy A working.

There is also a standalone [translation-server](https://github.com/zotero/translation-server) — a Docker service that runs the same translators over HTTP and returns Zotero API JSON (`POST /search`, `POST /web`, `POST /export?format=…`). **It is not appropriate for `research_helper`**: we committed to fully client-side operation, and the in-process `Zotero.Translate` gives us the same translators without a server. (And its output still needs `item.fromJSON()` to get Extra migration.)

### 6.3 Recommended hybrid for `research_helper`

1. **Search phase** — call the literature APIs directly, normalise into our own record shape. This is where the 3-year filter, dedup across databases, and the result table live. No Zotero involvement.
2. **Import phase, default path** — hand-map (Strategy A). This is what ships on, and it is the path `10-requirements-and-user-stories.md` NFR-1's throughput target is measured against.
3. **Import phase, opt-in path** — when the user enables *"Fetch metadata through Zotero translators (slower, more accurate)"*, records that have a DOI, PMID or arXiv ID go through identifier lookup (Strategy B) first, so the user gets Zotero-canonical metadata plus any OA PDF; hand-mapping remains the per-record fallback when lookup fails or times out.

   > **The preference is `useTranslators` and it ships `false`.** Key, type and default are `07-architecture-and-data-model.md` §8.5's, and that section states why: Strategy B costs one network round trip per record, so it cannot meet NFR-1, and shipping it on would promise a default the throughput requirement forbids. Strategy B is *better metadata*, not the default path — an earlier draft of this list called it "preferred", which read as a statement about the shipped default rather than about quality. Where the preference is honoured in the pipeline is `07-architecture-and-data-model.md` §12.1 (`WritingItems`).
4. **Abstract backfill** — Zotero's translators frequently drop abstracts. After either path, if `abstractNote` is empty and we have one from the API, set it. This is the single highest-value post-processing step for a summarisation plugin.
5. **Dedup** — before creating anything, run the DOI/PMID search from §5.5 and offer "skip / add anyway / add to collection only".

---

## 7. Preferences

### 7.1 The pref branch

From [`chrome/content/zotero/xpcom/prefs.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/prefs.js):

```javascript
Zotero.Prefs.get(pref, global)
Zotero.Prefs.set(pref, value, global)
Zotero.Prefs.clear(pref, global)

/**
 * @param {String}   name - Preference name; if not global, this is on
 *                          the extensions.zotero branch
 * @param {Function} handler
 * @param {Boolean}  [global]
 * @return {Symbol} - Symbol to pass to unregisterObserver()
 */
Zotero.Prefs.registerObserver(name, handler, global)
Zotero.Prefs.unregisterObserver(symbol)
```

When `global` is falsy, the name is prefixed with `ZOTERO_CONFIG.PREF_BRANCH` = `"extensions.zotero."`.

Two conventions exist in the wild:

* **`make-it-red` style** — put prefs on the app-global branch and always pass `global = true`:
  `prefs.js`: `pref("extensions.make-it-red.intensity", 100);`
  code: `Zotero.Prefs.get('extensions.make-it-red.intensity', true)`
* **`zotero-plugin-template` style** — nest under Zotero's own branch: `prefsPrefix: "extensions.zotero.addontemplate"`, read as `Zotero.Prefs.get("addontemplate.foo")` with no `global` flag.

**Use the template convention** for `research_helper`: prefix `extensions.zotero.research-helper`. It keeps everything under one branch, plays nicely with scaffold's `prefs.prefix` substitution, and means shorter call sites.

### 7.2 `prefs.js` defaults

A plain file at the archive root, using the Mozilla `pref()` syntax. Zotero registers these as **default** values (so `Zotero.Prefs.clear()` restores them).

> **`07-architecture-and-data-model.md` §8.5 owns the preference schema** — every key, its type, its default, its allowed values, and which document owns its semantics. This section owns the **file**: the literal `prefs.js` that ships in the XPI, plus the Zotero-platform mechanics of how it is loaded. The listing below is a transcription of the §8.5 rows that carry a shipped default; it must stay byte-consistent with that table, and §8.5 wins on any disagreement. §8.5 also carries the settings that have **no** `pref()` line here (they exist in `src/prefs/schema.ts` with a default and are written only when the user changes them), so this listing is deliberately shorter than the schema. Do not add a preference here without adding it there first, and note §8.5's migration rule: renaming a pref that has already shipped requires a migration step.

**Zotero 7+ loads it automatically.** `plugins.js` reads `addon.getResourceURI("prefs.js")` into `Services.prefs.getDefaultBranch("")` on install, on enable, and on every startup (verified in [`chrome/content/zotero/xpcom/plugins.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/plugins.js); the [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) page says the same). There is **no manifest declaration and no bootstrap call** — the hand-rolled `Services.prefs.getDefaultBranch(...)` loop found in older plugins is a Zotero 6 shim and must not be copied.

```javascript
// prefs.js
// Model IDs are owned by `03-llm-provider-integration.md` §§2.5, 3.5, 4.6, 5.5 (verified
// 2026-09-08) and change on a scale of weeks. These are seed defaults only — the picker is
// repopulated from each provider's models endpoint at run time (doc 03 §9); never hardcode a
// model ID anywhere else.
pref("extensions.zotero.research-helper.llmProvider", "openrouter");
pref("extensions.zotero.research-helper.openrouter.model", "anthropic/claude-sonnet-5");
pref("extensions.zotero.research-helper.openai.model", "gpt-5.6-terra");
pref("extensions.zotero.research-helper.gemini.model", "gemini-3.8-flash");
pref("extensions.zotero.research-helper.anthropic.model", "claude-sonnet-5");
// Per-provider base-URL override (FR-29). EMPTY means "use the base URL doc 03 documents
// for that provider" (03-… §§2.1, 3.1, 4.1, 5.1). Bound in 08-ui-ux-spec.md §7.3, so each
// needs a default here or the field paints empty. Never a credential — a proxy that needs
// authentication is out of scope.
pref("extensions.zotero.research-helper.openrouter.baseUrl", "");
pref("extensions.zotero.research-helper.openai.baseUrl", "");
pref("extensions.zotero.research-helper.gemini.baseUrl", "");
pref("extensions.zotero.research-helper.anthropic.baseUrl", "");
pref("extensions.zotero.research-helper.searchYears", 3);
// All seven v1 sources (D2, 00-overview.md §3; FR-2). bioRxiv/medRxiv have no keyword
// search (02-… §8.4), so on a keyword run they contribute ID lookup and preprint↔published
// resolution only; that is why they are members and not omissions.
pref("extensions.zotero.research-helper.sources", "pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv");
pref("extensions.zotero.research-helper.maxResults", 100);
// MUST ship false: Strategy B (§6.3) costs one identifier lookup per record and cannot meet
// NFR-1. Schema row and the reasoning: 07-… §8.5.
pref("extensions.zotero.research-helper.useTranslators", false);
pref("extensions.zotero.research-helper.hideExisting", true);
pref("extensions.zotero.research-helper.concurrency", 3);
pref("extensions.zotero.research-helper.timeoutSeconds", 60);
// "auto" follows the Zotero UI locale; also accepts "en", "ko", "both".
// The prefs pane (08-ui-ux-spec.md §7.3) shows "Follow Zotero language" for "auto".
pref("extensions.zotero.research-helper.reportLanguage", "auto");
// `Charon` ("Informative") is the default narrator recommended by 04-audio-report-tts.md §2.7,
// which owns the choice. Kore appears in that document only inside Google's own API examples.
pref("extensions.zotero.research-helper.tts.voice", "Charon");
// Audio settings named by 04-audio-report-tts.md §12; schema rows in 07-… §8.5.
// tts.model ships EMPTY on purpose: the empty string means "use the TTS model doc 04
// recommends for the selected provider, resolved at call time from the live model list".
// Doc 04 §2.2's IDs all carry `-preview` and churn on a scale of weeks — never hardcode one
// here, exactly as with the LLM model IDs above.
pref("extensions.zotero.research-helper.tts.model", "");
// 0 = derive the target duration from the report length (06-… §9.2).
pref("extensions.zotero.research-helper.tts.targetMinutes", 0);
// "wav" | "mp3" — 04-… §10.2 (WAV is linked, MP3 is imported).
pref("extensions.zotero.research-helper.tts.outputFormat", "wav");
// MUST ship false: onAsyncRender fires on every selection change (08-ui-ux-spec.md §3.3).
pref("extensions.zotero.research-helper.autoSummarize", false);
// Global default privacy mode: "strict" | "balanced" | "full". Semantics owned by
// 09-security-privacy-and-api-keys.md §3.5; per-collection overrides are NOT prefs (they
// live in the collection_settings table, 07-… §8.3). Bound in 08-ui-ux-spec.md §7.3.
pref("extensions.zotero.research-helper.privacy.mode", "balanced");
// Bound by the "Verbose debug logging" checkbox in 08-ui-ux-spec.md §7.3, which writes
// "debug" when checked and "warn" when unchecked. There is deliberately NO `debug` boolean
// pref: 07-… §8.5 (Diagnostics) removed it so the checkbox and the level cannot drift.
pref("extensions.zotero.research-helper.logLevel", "warn");
// Global cache cap in MB, 100–5000 (07-… §8.5; cap semantics in 07-… §9.2). Bound in the Advanced
// groupbox of 08-ui-ux-spec.md §7.3, so it needs a default here or the field paints empty.
pref("extensions.zotero.research-helper.cache.maxSizeMB", 500);
// Spend ceilings, 0 = off (07-… §8.5; semantics in 06-… §11.4): run.maxSpendUSD is the
// per-run cap, run.maxSessionSpendUSD the per-Zotero-session one. Neither is bound by a
// control; both are listed here so they are visible in about:config.
pref("extensions.zotero.research-helper.run.maxSpendUSD", 0);
pref("extensions.zotero.research-helper.run.maxSessionSpendUSD", 0);
// General contact address, NOT NCBI-specific: it is sent only as Crossref's `mailto`
// parameter. NCBI always receives the maintainer address per NBK25497. See
// 02-literature-database-apis.md §2.2.
pref("extensions.zotero.research-helper.contactEmail", "");
// Presence flags only — never the key itself. Written by the SecretStore, read by the prefs pane.
// One per SecretId that has a UI affordance (09-security-privacy-and-api-keys.md §1.7).
pref("extensions.zotero.research-helper.openrouter.keyPresent", false);
pref("extensions.zotero.research-helper.openai.keyPresent", false);
pref("extensions.zotero.research-helper.gemini.keyPresent", false);
pref("extensions.zotero.research-helper.anthropic.keyPresent", false);
pref("extensions.zotero.research-helper.ncbi.keyPresent", false);
pref("extensions.zotero.research-helper.semanticscholar.keyPresent", false);
// Last key-validation outcome, one line per credential holder — the SAME SIX ids as
// keyPresent above, not just the four LLM providers: "" (never validated) | "ok" |
// "rejected" | "forbidden" | "inconclusive". Non-secret status only, never any part of the
// key. Written by the validation flow and by 09-security-privacy-and-api-keys.md §2.4 step 3;
// read by the prefs pane to paint the per-provider status row on first paint.
// Schema row: 07-… §8.5. The two source credentials are here because they fail silently —
// a bad NCBI key just drops the user back to the unkeyed 3 req/s (02-… §3.1) and a bad
// Semantic Scholar key drops F2/F6 onto the saturated anonymous pool (02-… §6.4) — so the
// stored status is the only surface either failure has. Test calls: 09-… §2.3.
pref("extensions.zotero.research-helper.openrouter.lastValidationResult", "");
pref("extensions.zotero.research-helper.openai.lastValidationResult", "");
pref("extensions.zotero.research-helper.gemini.lastValidationResult", "");
pref("extensions.zotero.research-helper.anthropic.lastValidationResult", "");
pref("extensions.zotero.research-helper.ncbi.lastValidationResult", "");
pref("extensions.zotero.research-helper.semanticscholar.lastValidationResult", "");
```

Every key bound by a `preference=` attribute in `08-ui-ux-spec.md` §7.3 needs a line here: a bound control whose pref has no default reads `undefined` on first paint and renders wrong (an unchecked `hideExisting`, an empty `timeoutSeconds`, an empty cache-size field). That is why `cache.maxSizeMB` and `tts.outputFormat` appear above — §7.3 binds both. `logLevel` appears because §7.3's "Verbose debug logging" checkbox writes it through a scripted handler rather than a `preference=` binding, and a scripted handler still needs a default to read on first paint.

The remaining `07-architecture-and-data-model.md` §8.5 rows — most of the `summary.*`, `fullText.*`, `report.*`, `screening.*` and `cache.*` families, plus `logRequestBodies`, `background.enabled`, `prefsSchemaVersion`, `privacy.egressAcknowledged`, `llm.tokenEstimateCalibration` and the `tts.*` keys that have no control — have no control in the pane and are read through the typed accessor in `07-architecture-and-data-model.md` §8.5.1, which falls back to the schema default, so they need no `pref()` line. Adding one for them is harmless and makes them visible in `about:config`; the two `run.*` lines above are there for exactly that reason, because a spending control the user cannot find in `about:config` is a spending control they cannot audit.

> ⛔ **Do not store API keys in prefs.** Note that the pref list above deliberately contains **no** API key entries at all — not for the LLM/TTS providers and not for NCBI or Semantic Scholar, which [09-security-privacy-and-api-keys.md](09-security-privacy-and-api-keys.md) §1.7 also assigns `SecretId`s (`source.ncbi`, `source.semanticscholar`) in the keystore. Only presence booleans and validation metadata are prefs. Prefs land as plaintext `user_pref(...)` lines in `prefs.js` inside the Zotero *profile* directory, with no encryption layer — that is fine for a voice name or a concurrency limit, and not fine for a credential that can spend the user's money.
>
> Every existing Zotero LLM plugin does put keys in prefs, and the [Zotero plugins page](https://www.zotero.org/support/plugins) already warns that "plugins have full access to your Zotero and your computer." That is precedent, not justification: Zotero itself does **not** do this. Zotero stores its own zotero.org API key via `Zotero.OSKeyStore.encrypt()` (Windows DPAPI / macOS Keychain / libsecret) into `Services.logins` — see `syncLocal.js` — and `research_helper` follows Zotero's own practice, not the plugin ecosystem's habit.
>
> **The authoritative design, including the residual-risk statement that must appear in the UI, is [09-security-privacy-and-api-keys.md](09-security-privacy-and-api-keys.md) §1 ("API key storage"), and §1.7 in particular.** Do not implement key storage from this document. The rules that still apply here regardless: (a) never log key values — `Zotero.debug` output is routinely pasted into public forums, (b) mask keys in the prefs UI, and (c) state where keys live, in the preferences pane, in plain language.

> **Unverified:** whether Zotero excludes plugin prefs from sync. Zotero syncs a subset of its own prefs; third-party pref branches are believed **not** to sync, meaning users must re-enter non-secret settings per machine. Confirm before promising anything in the UI. (Keys are unaffected — they are not in prefs at all, and the OS keystore is per-machine by construction.)

### 7.3 Registering the preference pane

```javascript
Zotero.PreferencePanes.register({
  pluginID: 'research-helper@suppakoko.github.io',
  src: rootURI + 'content/preferences.xhtml',
  scripts: [rootURI + 'content/preferences.js'],
  stylesheets: [rootURI + 'content/preferences.css'],
  label: 'Research Helper',          // raw string; there is no l10nID option
  image: rootURI + 'content/icons/favicon.png',
});
```

`register()` is **async** and resolves to the pane ID. Its full option list (verified against
[`chrome/content/zotero/xpcom/preferencePanes.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/preferencePanes.js)) is
`pluginID`, `src`, `id`, `parent`, `label`, `image`, `scripts`, `stylesheets`, `helpURL` — **there is no `l10nID`, and `defaultXUL` is not a caller option** (`register()` sets `defaultXUL: true` internally). See `08-ui-ux-spec.md` §7.1.

Per [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers): panes are XUL/XHTML **fragments** — no `<!DOCTYPE>`, no `<html>` wrapper — and "Organizing your pane as a sequence of top-level `<groupbox>`es will optimize it for the new preferences search mechanism."

> ⚠️ **Zotero 8 changed preference pane scoping:** "Preference panes now have isolated global scope" ([Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers)). Variables declared in one pane's script are no longer visible to others or to the prefs window; assign to `window.<name>` explicitly if you need cross-scope access. Code written for Zotero 7 prefs panes will silently break here.

Detailed prefs-pane markup and layout for `research_helper` is in `08-ui-ux-spec.md` §7.

---

## 8. Networking from a plugin

### 8.1 `Zotero.HTTP.request`

Signature and options read from [`chrome/content/zotero/xpcom/http.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/http.js) on `main`:

```javascript
/**
 * Get a promise for a HTTP request
 * @return {Promise<XMLHttpRequest>}
 */
Zotero.HTTP.request(method, url, options = {})
```

| Option | Type | Meaning | Default |
|---|---|---|---|
| `body` | String | Request body | — |
| `headers` | Object | Request headers | — |
| `responseType` | String | XHR `responseType` (`"json"`, `"text"`, `"arraybuffer"`, `"blob"`, `"document"`) | — |
| `responseCharset` | String | Response charset override | — |
| `successCodes` | Number[] \| false | Accepted status codes; `false` = accept all | 2xx |
| `timeout` | Number | ms; `0` = no timeout | **30000** |
| `errorDelayIntervals` | Number[] | Retry delays after 429/5xx | built-in set |
| `errorDelayMax` | Number | Max total retry wait | 3600000 (1 h) |
| `noRetryOnThrottle` | Boolean | Throw on 429/503 with `Retry-After` instead of auto-retrying | false |
| `anon` | Boolean | Anonymous request, no global cookies | false |
| `userContextId` | Number | Cookie isolation context (see `newCookieContext()`) | — |
| `cookieSandbox` | Number | Legacy alias for `userContextId` | — |
| `followRedirects` | Boolean | Follow redirects | true |
| `noCache` | Boolean | Bypass cache (`dontCache` is deprecated) | false |
| `compressBody` | Boolean | gzip the request body | false |
| `requestObserver` | Function | Called after `open()` with the XHR | — |
| `cancellerReceiver` | Function | Receives a cancel function | — |
| `onAuthorizationHeader` | Function | Authorization header callback | — |
| `foreground` | Boolean | Allow cert/auth dialogs | false |
| `debug` | Boolean | Log response text and status | false |
| `logBodyLength` | Number | Body chars to log | 1024 |

Exception classes:

```javascript
Zotero.HTTP.UnexpectedStatusException   // .status, .xmlhttp, .url; .is4xx(), .is5xx()
Zotero.HTTP.TimeoutException
Zotero.HTTP.BrowserOfflineException
Zotero.HTTP.SecurityException
Zotero.HTTP.CancelledException
```

Helpers:

```javascript
Zotero.HTTP.newCookieContext()          // → { id, getCookies(host), dispose() }
Zotero.HTTP.download(uri, path, options)  // streams to disk; returns a fetch Response (Zotero 10)
Zotero.HTTP.processDocuments(urls, processor, options)
```

Two of these options matter for `research_helper`, in opposite directions:

* **`errorDelayIntervals` / `errorDelayMax` / `noRetryOnThrottle` — Zotero's own retry machinery, which this plugin deliberately turns off.** Zotero does implement exponential backoff with `Retry-After` handling for 429 and 5xx, and for an ordinary plugin that is a gift. It is not one here, because `research_helper` runs a per-host token-bucket rate limiter that must see every attempt: a retry issued *below* the bucket is a request the limiter cannot pace, and `errorDelayMax`'s one-hour default is a delay neither the plugin's own progress reporting nor cancellation can observe. **`07-architecture-and-data-model.md` §7.4 owns this decision and states the exact overrides** — `noRetryOnThrottle: true`, `errorDelayMax: 0`, `successCodes: false` — and all 429/5xx handling lives in `src/core/rateLimit/` and `src/core/http/retry.ts`. Do not re-enable Zotero's retrying in an adapter; an earlier draft of this section advised exactly that, with `errorDelayMax: 60000`.
* **`anon: true`** — our API calls carry bearer tokens in headers and must not pick up ambient cookies. Set it on every LLM and literature-API call.

### 8.2 A `research_helper` HTTP wrapper

The sketch below shows the *platform* mechanics — headers, `responseType`, exception mapping, `cancellerReceiver`. **The shipped client is `src/core/http/client.ts` and `07-architecture-and-data-model.md` §7.4 owns its option set**, including the three retry/status overrides named in §8.1 and the `timeoutSeconds` default. Where this sketch and §7.4 differ, §7.4 wins.

```javascript
// The User-Agent always carries the *maintainer* address, never the user's, on every
// host — decision D10 (00-overview.md §3); slot assignment owned by
// 02-literature-database-apis.md §2.2.
const RH_UA = 'research_helper/0.1 (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)';

async function apiGet(url, { headers = {}, timeout = 60000, signalKey } = {}) {
  try {
    const xhr = await Zotero.HTTP.request('GET', url, {
      headers: { 'User-Agent': RH_UA, Accept: 'application/json', ...headers },
      responseType: 'json',
      timeout,                     // 07-… §7.4: timeoutSeconds × 1000, default 60 s
      anon: true,
      // Zotero's own retry loop is OFF; the per-host token bucket owns 429/5xx.
      // 07-architecture-and-data-model.md §7.4 owns both of these.
      noRetryOnThrottle: true,
      errorDelayMax: 0,
      cancellerReceiver: (cancel) => RH.cancellers.set(signalKey, cancel),
    });
    return xhr.response;
  } catch (e) {
    if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
      throw new RHApiError(`HTTP ${e.status} from ${new URL(url).host}`, { cause: e });
    }
    if (e instanceof Zotero.HTTP.TimeoutException) {
      throw new RHApiError('Request timed out', { cause: e });
    }
    if (e instanceof Zotero.HTTP.BrowserOfflineException) {
      throw new RHApiError('Zotero is offline', { cause: e });
    }
    throw e;
  }
}
```

`cancellerReceiver` is the cancellation mechanism — store the returned function and call it when the user clicks Cancel (§10.3).

One difference from the shipped client, so the sketch is not read as complete: `07-architecture-and-data-model.md` §7.4 also passes `successCodes: false` and classifies HTTP statuses itself against the typed error hierarchy in that document's §10.1. This sketch leaves Zotero's status checking on so the `UnexpectedStatusException` mapping above is exercised; the real client maps from the response instead. Either way, no adapter re-enables `errorDelayMax`.

### 8.3 CORS and CSP

Plugin code runs in Zotero's **privileged chrome context**, not a content page. Consequences:

* **There is no CORS preflight and no same-origin restriction on `Zotero.HTTP.request`.** You can call `api.openai.com`, `eutils.ncbi.nlm.nih.gov`, `api.crossref.org` etc. directly with arbitrary headers. This is precisely what makes a serverless architecture viable.
* Content Security Policy applies to **documents you create** (your XHTML dialogs and prefs panes), not to the privileged JS making requests. Keep dialog markup free of inline `<script>` and remote resources; load scripts from your own `chrome://` or `rootURI` paths.
* If you use `fetch()` from inside an XHTML dialog document rather than from the plugin sandbox, you *may* re-enter a CORS-checked context depending on the document's principal. **Do all network I/O in the plugin's privileged sandbox and pass results into the dialog**, never the other way round.

> **Unverified:** the precise CSP applied to plugin-provided XHTML loaded via `chrome://` in Zotero 10, and whether `fetch()` from such a document is same-origin-restricted. Architecting network calls to live in the sandbox sidesteps the question entirely; do that.

### 8.4 Streaming (SSE) for LLM responses

`Zotero.HTTP.request` is XHR-based and resolves once, so it cannot stream token-by-token. `fetch` can, and it **is available in the plugin sandbox** — this is not an inference:

* **`fetch` is explicitly listed in the plugin sandbox's `wantGlobalProperties`** in the Zotero client source, on both the 7.0 branch and `main`. It is deliberately provided to plugin code.
* Zotero 10's `Zotero.HTTP.download()` "returns a `Response` object" ([Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)) — Zotero itself uses the Fetch API internally.
* Zotero 8+ is Firefox 140 ESR, where `fetch` + `ReadableStream` + `TextDecoderStream` are standard in chrome scopes.

The intended pattern for streaming an LLM report into the preview pane:

```javascript
async function* streamChatCompletion({ url, apiKey, body, signal }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch { /* ignore keep-alive / partial frames */ }
      }
    }
  }
}
```

Cancellation uses a standard `AbortController`.

> **Unverified — test this early, it is on the critical path.** The *availability* of `fetch` is verified from the sandbox's `wantGlobalProperties`. Still confirm in Tools → Developer → Run JavaScript that (a) `res.body` is a live `ReadableStream` rather than `null`, (b) `TextDecoderStream` exists in the sandbox, and (c) `AbortController`/`signal` actually aborts the underlying channel.

#### 8.4.1 The fallback, and why it is better-trodden than the primary path

If any of the three checks above fails, fall back to `Zotero.HTTP.request` with `requestObserver` and an `onprogress` handler reading `xhr.response` incrementally. Weigh this honestly before committing to `fetch`: a survey of seven established plugins (`zotero-better-notes`, `zotero-gpt`, `zotero-pdf-translate`, `zotero-actions-tags`, `zotero-plugin-template`, `zotero-plugin-toolkit`, `make-it-red`) found **55 calls to `Zotero.HTTP.request` against 2 uses of `fetch`** — and both `fetch` uses are local (`chrome://` resource reads and a `localhost` Better BibTeX RPC), neither a cross-origin streaming call. Every LLM integration in that set — OpenAI, Anthropic, and Gemini SSE in `zotero-pdf-translate/src/modules/services/` — uses the XHR path. So `fetch`-based streaming is the *cleaner* path and the one Zotero's own docs point toward, but it is **not the path with production mileage behind it**.

Three mechanics the XHR fallback requires, all learned from that production code rather than from documentation:

* **`responseType: "text"` is mandatory.** With `"json"` you cannot observe partial responses. (`Zotero.HTTP.request` does **not** restrict `responseType` to a whitelist — it assigns `options.responseType` straight onto the XHR and its JSDoc says "See XHR 2 documentation for legal values", so `arraybuffer` and `blob` work too; only `text`/`json`/`document` get special post-processing. That matters for the TTS audio path in `04-audio-report-tts.md`.)
* **The default 30-second timeout kills long streams.** Every plugin defuses it from inside the progress handler: `if (e.target.timeout) e.target.timeout = 0;`
* **`e.target.response` is cumulative, not a delta.** Keep a `preLength` cursor and slice from it, and buffer the trailing partial line across ticks — `zotero-gpt` re-parses the entire accumulated response on every tick, which is O(n²) and visibly janky on long reports. `zotero-pdf-translate`'s `streamCallback` is the reference implementation to copy.

**Design implication either way:** the streaming report preview in `08-ui-ux-spec.md` §6.2 should degrade gracefully. Build the report generator so a non-streaming provider (or a failed stream) still produces the same output, just without incremental rendering.


### 8.5 Rate limiting and politeness

Not a Zotero API concern, but a plugin-architecture one, and it belongs in this document because it constrains the concurrency design:

* **NCBI E-utilities** — 3 requests/second without an API key, 10 with. Requires `tool` and `email` parameters. Expose an *NCBI API key* field and an *email* field in the preferences pane (`08-ui-ux-spec.md` §7.3) — but note the key itself is a credential and goes to the keystore (`SecretId` `source.ncbi`), not to a pref; only the email is a pref.
* **Crossref** — "polite pool" if you send a `mailto:` in the User-Agent.
* **Semantic Scholar / OpenRouter / OpenAI / Gemini / Anthropic** — per-key limits; surface 429s to the user rather than retrying forever.

Implement a single shared token-bucket scheduler per host, and set the plugin's global concurrency from the `concurrency` preference — its shipped default and its range are `07-architecture-and-data-model.md` §8.5's row, and the `llm` worker pool it sizes is that same document's §7.2.

---

## 9. Localization (English + Korean)

### 9.1 Fluent is the only supported mechanism

Zotero 7 moved plugin localization to [Fluent](https://projectfluent.org/) (`.ftl`). From the [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) docs:

```
locale/en-US/make-it-red.ftl
locale/fr-FR/make-it-red.ftl
locale/zh-CN/make-it-red.ftl
```

The Zotero 7 docs also showed a subfolder form:

```
locale/en-US/make-it-red/main.ftl
locale/en-US/make-it-red/preferences.ftl
```

> **The subfolder form does not work on Zotero 10.0.1.** Read verbatim from the shipped
> `chrome/content/zotero/xpcom/plugins.js` in `app/omni.ja` on 2026-09-10 (task `P0-T10`),
> `registerLocales()` does `readDirectory(rootURI, 'locale/' + pluginLocale)` and then
> `if (!file.endsWith('.ftl')) continue;` — a **directory** entry fails that test and is
> silently dropped. Registered hrefs are flat, `zotero-plugins:{locale}/<filename>`, and the
> function's own doc comment now shows only `[plugin root]/locale/en-US/make-it-red.ftl`.
> This is the "Plugin localization consolidated with proper per-locale fallback" rewrite noted
> in §3.4(f).
>
> **Consequence: the layout is flat, and filenames are a global namespace shared with every
> other plugin.** Put every bundle at `locale/<locale>/<filename>.ftl` and make the filename
> plugin-unique — `research-helper-mainWindow.ftl`, not `mainWindow.ftl`.

**There is no manual registration call for the *source*.** Shipping the directory registers the
bundle. But a plugin FTL is **not** automatically attached to a window Zotero owns: every
`insertFTLIfNeeded` call in `chrome/content/zotero/` is for Zotero's own bundles, and
`menuManager.js`'s `l10nFiles` option is commented out in 10.0.1 with a `TODO` about unload
management. A plugin that puts a label in Zotero's main window must call
`win.MozXULElement.insertFTLIfNeeded("<filename>.ftl")` itself in `onMainWindowLoad` — and that
call has no *documented* counterpart. It is nonetheless undoable — verified 2026-09-14 (`P0-T32`)
from Gecko 140's `customElements.js`: it only appends `<html:link rel="localization" href=…>`
to `document.head` or `<linkset>`, and is a no-op if that `href` is already present. Removing
that element with `link.remove()` makes the window's own `document.l10n` stop resolving the
file's messages, measured across four hot reloads with the link count never growing. No
`FR-56` exception is needed.

**Fallback has two layers, and the second is conditional** (measured 2026-09-15, `P0-T24`). Zotero
chooses a *whole file* per locale (exact → same language → `en-US` → first available) and never
merges files, so a key missing from the chosen `ko-KR` file is simply absent there. Gecko's
`Localization` then fills a missing *message* from the next locale in its chain — which rescues it
only because the app locale chain ends in `en-US`. **A `Localization` constructed with an explicit
locale list that omits `en-US` gets no fallback at all**, so any code formatting in a chosen
language (a Korean report on an English UI, for instance) must append `en-US` to its list. Switching
locale in a test means `Services.locale.requestedLocales`, not assigning `Zotero.locale`.

For `research_helper` — **the *layout* below is this section's; the *file list* is `08-ui-ux-spec.md` §10.1's**, which owns the set of UI surfaces and each surface's localization home. Reproduced here only so the directory shape is concrete; if the two ever differ, §10.1 wins and this listing is the defect:

```
locale/
├── en-US/
│   ├── research-helper-mainWindow.ftl
│   ├── research-helper-preferences.ftl
│   ├── research-helper-searchDialog.ftl
│   └── research-helper-reportWindow.ftl
└── ko-KR/
    ├── research-helper-mainWindow.ftl
    ├── research-helper-preferences.ftl
    ├── research-helper-searchDialog.ftl
    └── research-helper-reportWindow.ftl
```

Korean is a supported Zotero UI locale — `chrome/locale/ko-KR/` exists in the [zotero/zotero repo](https://github.com/zotero/zotero/blob/main/chrome/locale/ko-KR/zotero/zotero.properties).

### 9.2 Using it

In a document:

```html
<link rel="localization" href="research-helper-preferences.ftl"/>
<!-- in a XUL-namespaced document: -->
<html:link rel="localization" href="research-helper-preferences.ftl"/>
```

Injected into an existing window at runtime:

```javascript
window.MozXULElement.insertFTLIfNeeded("research-helper-mainWindow.ftl");
```

On elements:

```html
<button data-l10n-id="research-helper-search-run"/>
<label data-l10n-id="research-helper-prefs-api-key" control="rh-openai-key"/>
```

`.ftl` content:

```properties
research-helper-search-run = Search
research-helper-search-run =
    .label = Search
    .tooltiptext = Run the search across selected databases
research-helper-import-count =
    { $count ->
        [one] Import 1 item
       *[other] Import { $count } items
    }
```

From JS, to get a string imperatively, the template provides a `getString()` helper backed by `Zotero.getMainWindow().document.l10n` / a `Localization` instance.

The `Localization` constructor **is** available in the plugin sandbox — `plugins.js#_loadScope()` assigns it into the sandbox globals (verified 2026-09-08, §5.6).

**Verified 2026-09-14 (`P0-T32`):** for a plugin's own files the resource id is the **bare filename**, and both forms work — `new Localization(["research-helper-mainWindow.ftl"], true).formatMessagesSync(…)` from the plugin sandbox, and `document.l10n.formatMessages(…)` from a window the bundle has been inserted into. The sync flag works; Mozilla still discourages the sync form outside of probes and tests.

### 9.3 The two namespace rules (both are footguns)

From the official docs, emphasis theirs:

> "**Fluent identifiers within a given DOM document share a global namespace.** If adding a Fluent file to a shared document — the main Zotero window, the Zotero preferences, etc. — you must prefix all identifiers in the file with your plugin's name."

> "**Fluent filenames also share a global namespace.**"

So: every ID starts with `research-helper-`, and every **filename** starts with `research-helper-` too, flat under `locale/<lang>/` — on Zotero 10 the filename is itself a namespace shared with every installed plugin (§9.1). No exceptions. A collision does not error — it silently shadows, which is far worse.

### 9.4 Language handling for `research_helper` specifically

There are **three** independent language settings and conflating them will cause bugs:

1. **UI language** — follows Zotero's own locale. Provided by the `.ftl` files. Nothing to configure.
2. **Report language** — the language the LLM writes the summary/trends report in. A plugin preference (`reportLanguage`), default = follow UI locale, overridable per run in the report dialog.
3. **TTS language/voice** — the language Gemini TTS speaks. Usually follows (2), but the user may want a Korean voice reading an English report or vice versa. Separate preference.

Do **not** derive the report language from `Zotero.locale` alone — a Korean-locale user reading English papers frequently wants an English report.

---

## 10. Concurrency, progress, and cancellation

### 10.1 There is one thread

Zotero's UI and your plugin code share the main thread. Any synchronous loop over hundreds of items — or a synchronous JSON parse of a 20 MB response — freezes the entire application. `research_helper` does three inherently long jobs (search across 5 databases, summarise N papers, synthesise a report), so this is a first-class design concern.

Rules:

* Everything is `async`. Never busy-wait.
* Chunk large synchronous work and yield with `await Zotero.Promise.delay(0)` between chunks.
* Bound concurrency explicitly (a simple promise pool), driven by the `concurrency` preference. Unbounded `Promise.all` over 200 papers will hit every provider's rate limit simultaneously.
* Keep DB transactions short and free of network I/O (§5.8).

A minimal pool:

```javascript
async function mapPool(items, limit, fn, { onProgress, signal } = {}) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (e) {
        results[i] = { ok: false, error: e };   // never let one failure kill the batch
      }
      onProgress?.(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

### 10.2 `Zotero.ProgressWindow`

The lightweight, native, non-modal progress toast. Signatures read from [`chrome/content/zotero/xpcom/progressWindow.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressWindow.js):

```javascript
new Zotero.ProgressWindow(options)
//   options.window       — active window (defaults to main window)
//   options.closeOnClick — Boolean (default true)

pw.changeHeadline(text, cssIconKey, postText)   // headline at top
pw.addDescription(text)                          // <a> elements become XUL links
pw.addLines(labels, icons)
pw.show()
pw.startCloseTimer(ms, requireMouseOver)
pw.close()

// A line, created via the window's own ItemProgress class:
const line = new pw.ItemProgress(itemType, text, parentItemProgress);
line.setProgress(percent);                       // 0–100
line.setText(text);
line.setItemTypeAndIcon(itemType, cssIcon = 'item-type');
line.setError();
```

Usage for the import job:

```javascript
const pw = new Zotero.ProgressWindow({ closeOnClick: false });
pw.changeHeadline('Research Helper — importing');
pw.show();

const line = new pw.ItemProgress('journalArticle', `0 / ${records.length}`);

await mapPool(records, concurrency, importOne, {
  onProgress: (done, total) => {
    line.setProgress(Math.round((done / total) * 100));
    line.setText(`${done} / ${total}`);
  },
});

line.setProgress(100);
line.setText(`Imported ${okCount} items (${failCount} failed)`);
if (failCount) line.setError();
pw.startCloseTimer(5000);
```

The `zotero-plugin-toolkit` wraps this with a chainable API (`new ztoolkit.ProgressWindow(title, {closeOnClick, closeTime}).createLine({text, type, progress}).show()` / `.changeLine({...})`), which is what the template's `hooks.ts` uses. Either is fine; the native one has no dependency.

### 10.3 Cancellation

Zotero's progress window has **no built-in cancel button**. For jobs the user must be able to stop — which for us is all three long jobs — you need your own UI:

* Long jobs run from a **modeless dialog** with a real Cancel button (see `08-ui-ux-spec.md`), with `Zotero.ProgressWindow` used only for short, fire-and-forget feedback.
* Thread one `AbortController` through the whole job. Pass `signal` to `fetch` for streaming calls, and register `Zotero.HTTP`'s `cancellerReceiver` callbacks for XHR calls (§8.2).
* On cancel: abort in-flight requests, stop the pool, and **do not roll back already-imported items** — instead report "imported 23 of 100 before cancelling" and leave them. Silent rollback of work the user watched happen is worse than partial results.

### 10.4 `Zotero.ProgressQueue`

Zotero has a second, richer progress surface: the queue window used by "Retrieve Metadata for PDF". It **is** reachable from a plugin, and it is byte-identical across Zotero 8, 9 and 10 ([`chrome/content/zotero/xpcom/progressQueue.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressQueue.js)):

```javascript
Zotero.ProgressQueue.ROW_QUEUED     = 1;
Zotero.ProgressQueue.ROW_PROCESSING = 2;
Zotero.ProgressQueue.ROW_FAILED     = 3;
Zotero.ProgressQueue.ROW_SUCCEEDED  = 4;

const queue = Zotero.ProgressQueues.create({ id, title, columns });
queue.addRow(item);                          // takes a Zotero.Item
queue.updateRow(itemID, status, message);
queue.deleteRow(itemID);
queue.addListener(name, cb);   // empty | cancel | rowadded | nonempty | rowupdated | rowdeleted
queue.getTotal(); queue.getProcessedTotal(); queue.cancel();

const dialog = queue.getDialog();
dialog.open(); dialog.close(); dialog.isOpen();
dialog.setStatus(msgOrL10nKey); dialog.showMinimizeButton(bool);
```

Three constraints decide whether you can use it:

1. The dialog renders **exactly three fixed columns**, so `columns` must be an array of **exactly two localization keys**, and `title` is a key too — both go through `Zotero.getString()`.
2. ⚠️ **`Zotero.getString()` throws on an unknown key when `Zotero.locale === 'en-US'`.** A plugin's `.ftl` is registered into `L10nRegistry` but *not* into `getString`'s synchronous bundle.
3. ⚠️ **There is no `remove`/`destroy`.** A plugin-created queue leaks for the rest of the session.

> **Unverified:** whether `Zotero.ftl.addResourceIds(['research-helper.ftl'])` makes plugin FTL keys resolvable from `Zotero.getString()`. This is inferred from `intl.js` + `plugins.js` and an in-source comment, not executed.
>
> **Decision:** `research_helper` does **not** use `ProgressQueue`. The fixed three-column layout cannot express per-database status, there is no Cancel button, and the session leak is real. Use a custom window with our own status list (see `08-ui-ux-spec.md` §4, §6) plus `Zotero.ProgressWindow` toasts.

### 10.5 There is no toast/notification API

Searching the Zotero 10 tree turns up nothing: **`Zotero.Notifications` does not exist** in 7, 8, 9 or 10; there is no notification/toast/banner custom element among the ~55 files in `chrome/content/zotero/elements/`; and the banners that do exist are hardcoded nodes in `zoteroPane.xhtml` driven by one-off `ZoteroPane.show*Banner()` methods, with no plugin entry point.

**`Zotero.ProgressWindow` remains the only toast-style API through Zotero 10.** Do not confuse `Zotero.Notifier` (the data-change observer bus, §5.9) with UI notification — it draws nothing.

For modal confirmation there is `Zotero.Prompt.confirm({ window, title, text, button0, button1, button2, checkLabel, checkbox, defaultButton, buttonDelay })`, which returns the index of the pressed button, and `Zotero.alert(window, title, msg)`. And `<guidance-panel>` (`chrome/content/zotero/elements/guidancePanel.js`) is a XUL arrow panel for anchored first-run hints.

---

## 11. Packaging and distribution

### 11.1 Building the XPI

An XPI is a ZIP with `manifest.json` **at the archive root** (not inside a subfolder — this is the single most common packaging mistake):

```bash
cd build/            # directory whose immediate children are manifest.json, bootstrap.js, ...
zip -r -FS ../research-helper-0.1.0.xpi * --exclude '*.git*' '*.DS_Store'
```

With the recommended toolchain this is just `npm run build`, which runs `zotero-plugin build`.

### 11.2 `update.json`

Verbatim schema from [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers):

```json
{
  "addons": {
    "make-it-red@zotero.org": {
      "updates": [
        {
          "version": "2.0",
          "update_link": "https://download.zotero.org/plugins/make-it-red/make-it-red-2.0.xpi",
          "update_hash": "sha256:4a6dd04c197629a02a9c6beaa9ebd52a69bb683f8400243bcdf95847f0ee254a",
          "applications": {
            "zotero": {
              "strict_min_version": "6.999"
            }
          }
        }
      ]
    }
  }
}
```

For `research_helper`:

```json
{
  "addons": {
    "research-helper@suppakoko.github.io": {
      "updates": [
        {
          "version": "0.1.0",
          "update_link": "https://github.com/suppakoko/research_helper/releases/download/v0.1.0/research-helper-0.1.0.xpi",
          "update_hash": "sha256:<sha256 of the xpi>",
          "applications": {
            "zotero": {
              "strict_min_version": "10.0",
              "strict_max_version": "10.0.*"
            }
          }
        }
      ]
    }
  }
}
```

Notes:

* `update_hash` is `sha256:` + hex digest. Generate with `shasum -a 256 research-helper-0.1.0.xpi` (or `Get-FileHash -Algorithm SHA256` on Windows).
* The `updates` array holds **every** offered version; Zotero picks the newest one compatible with the running app. This is how you can keep an old build available for users on an older Zotero.
* `update_url` **must be HTTPS**.
* `update.rdf` is the Zotero-6-era / legacy Firefox format. **Do not use it.** Zotero 7+ uses `update.json`. (Older Zotero 6 dual-compat examples used an `applications.gecko` block alongside `applications.zotero`; irrelevant for us.)

### 11.3 The compatibility-bump trick

Because both the [Zotero 9](https://www.zotero.org/support/dev/zotero_9_for_developers) and [Zotero 10](https://www.zotero.org/support/dev/zotero_10_for_developers) developer pages state you may update `strict_max_version` in the update manifest alone, you can support a new Zotero major without rebuilding:

```jsonc
// same version, same XPI, wider compatibility window
// (illustrative — see the warning below before writing any 11.x range)
{ "version": "0.1.0",
  "update_link": ".../research-helper-0.1.0.xpi",
  "update_hash": "sha256:…",
  "applications": { "zotero": { "strict_min_version": "10.0", "strict_max_version": "11.0.*" } } }
```

> ⚠️ **Do not actually publish an 11.x range yet.** [Zotero 11 for Developers](https://www.zotero.org/support/dev/zotero_11_for_developers) says "Do not update your plugin to declare compatibility with Zotero 11 at this time," and lists breaking Firefox 140 → 153 changes we have not tested against (§1.3). Use this mechanism only after the dev-list feature-freeze announcement and an actual test pass on the beta.

**Design your release process around this.** Host `update.json` at a *fixed* URL — the scaffold convention is a permanent GitHub Release tagged `release` whose assets are `update.json` / `update-beta.json` — so the file can be replaced without touching the manifest inside any shipped XPI.

### 11.4 GitHub Releases distribution

The de-facto standard for Zotero plugins:

```
Tag v0.1.0        → assets: research-helper-0.1.0.xpi
Tag `release`     → assets: update.json, update-beta.json   (moving tag, stable URL)
```

`zotero-plugin release` automates the version bump, XPI upload, and update-manifest regeneration. A minimal GitHub Actions workflow:

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npx zotero-plugin release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 11.5 Signing

**Zotero does not require plugin XPIs to be signed.** This is not folklore — it is set explicitly in the client's own default preferences, `app/assets/prefs.js` in the [zotero/zotero](https://github.com/zotero/zotero) source:

```javascript
// Disable add-on signature checking with unbranded Firefox build
pref("xpinstall.signatures.required", false);
// Allow legacy extensions (though this might not be necessary)
pref("extensions.legacy.enabled", true);
// Allow installing XPIs from any host
pref("xpinstall.whitelist.required", false);
// Allow installing XPIs when using a custom CA
pref("extensions.install.requireBuiltInCerts", false);
pref("extensions.update.requireBuiltInCerts", false);
```

So: **no AMO submission, no Mozilla signing, no `web-ext sign`.** A plain zip renamed `.xpi` installs. The last two lines are also why a self-hosted `update_url` on any HTTPS host works.

(Search results that conflate this with Firefox's AMO signing requirement are wrong for Zotero. The client source wins.)

Users install by dragging an `.xpi` onto Tools → Plugins ([Plugins for Zotero](https://www.zotero.org/support/plugins)).

Zotero's own page carries the corresponding warning:

> "Be aware that plugins have full access to your Zotero and your computer. You should only install plugins from developers you trust."

There is also **no official plugin directory yet** — the same page says "We don't currently provide a list of available plugins" and "An official plugin directory is planned." Distribution today is: GitHub Releases + a forum announcement thread + community lists (see [zotero-plugin.dev](https://zotero-plugin.dev/)).

> **Unverified:** whether the planned official plugin directory (announced but not shipped as of 2026-09) will introduce a review or signing requirement. Watch [zotero-dev](https://groups.google.com/g/zotero-dev).

**Implication for `research_helper`:** because there is no signing and no review, trust is entirely reputational. Ship reproducible builds, publish the SHA-256 alongside each release, keep the repo public, and be explicit in the README about which network endpoints the plugin contacts and where API keys are stored.

### 11.6 Development install (no XPI)

From [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development):

1. Create a text file in your Zotero profile's `extensions/` directory named exactly after the plugin ID (`research-helper@suppakoko.github.io`, no extension) whose contents are the absolute path to your plugin source root.
2. Edit the profile's `prefs.js` and delete the lines containing `extensions.lastAppBuildId` and `extensions.lastAppVersion`.
3. Restart Zotero. The plugin appears in Tools → Plugins.
4. Launch Zotero with `-purgecaches` to force re-reading cached files, plus `-ZoteroDebugText`, `-jsconsole`, and `-p <Profile>` as needed.

`zotero-plugin serve` automates all of this plus hot reload.

---

## 12. Gotchas and pitfalls

Ordered roughly by how much time each one costs when you hit it cold.

**1. `manifest.json` must be at the ZIP root.** Zipping the *containing folder* produces an XPI Zotero silently refuses. Verify with `unzip -l` before every manual release.

**2. Never use `localStorage` or `sessionStorage`.** They are not available/persistent in the Zotero chrome context. Use `Zotero.Prefs` for settings and plain JS state (or a JSON file under the profile directory) for caches. This is called out explicitly in community Zotero 8 guidance.

**3. `ZoteroPane.getSelectedCollection()` throws on Zotero 10.** Along with `getCollectionTreeRow()`, `getSelectedLibraryID()`, `getSelectedSavedSearch()`, `getSelectedGroup()`. Use the plural forms. **Zotero's own JavaScript API documentation page still shows the singular form** — it has not been updated. See §3.4a.

**4. `addCondition()`'s legacy `required` fourth argument throws on Zotero 10**, and `fulltextWord` was removed. Search code copied from older plugins will break.

**5. Bluebird is gone (Zotero 8+).** `somePromise.map()`, `.filter()`, `.each()`, `.isPending()`, `.cancel()`, and `Zotero.spawn()` no longer exist. Any pre-2026 sample using them is dead code.

**6. `Cu.import` is gone (Zotero 8+).** Use `ChromeUtils.importESModule("resource://gre/modules/X.sys.mjs")`. `XPCOMUtils.defineLazyGetter` → `ChromeUtils.defineLazyGetter`.

**7. Preference panes have isolated global scope (Zotero 8+).** A `var` in `preferences.js` is not visible where a Zotero-7 plugin expected it. Attach to `window` explicitly.

**8. Window-scoped setup in `startup()` is a bug.** `startup()` may run before any window exists, and windows can be opened/closed repeatedly (routine on macOS). See §2.4. Symptom: plugin works on first launch, menu items vanish after closing and reopening the window, memory grows.

**9. Every injected DOM element needs an `id`, and you must track it.** `make-it-red`'s `storeAddedElement()` throws if you forget. Without it, `onMainWindowUnload` cannot clean up and you leak the window.

**10. Forgetting `unregisterObserver` / `unregisterSection` / `unregisterMenu` on shutdown** leaves live closures referencing a dead plugin. `ztoolkit.unregisterAll()` covers everything the toolkit registered; native manager registrations you did yourself are your responsibility (though Zotero 10 fixed `MenuManager` to self-clean).

**11. Skipping teardown on `APP_SHUTDOWN` is correct; skipping it on `ADDON_DISABLE` is a leak.** Branch on the reason constant, don't blanket-skip.

**12. `saveTx()` inside `executeTransaction()` deadlocks or throws.** Use `save()` inside a transaction, `saveTx()` outside.

**13. Network I/O inside a DB transaction stalls the application.** Fetch first, then write.

**14. `Zotero.HTTP.request` defaults to a 30-second timeout.** LLM completions routinely exceed this. Set `timeout` explicitly (or `0`) for LLM calls — and prefer streaming so you get first tokens fast.

**15. `Zotero.debug()` output is shared by users in bug reports.** Never log API keys, request bodies containing keys, or full LLM prompts containing potentially sensitive library content. Log request *shapes* and status codes.

**16. Fluent identifiers and filenames are global namespaces.** Unprefixed IDs silently shadow Zotero's own. Prefix everything with `research-helper-`.

**17. `setField()` on a field invalid for the item type throws.** Validate with `Zotero.ItemFields.isValidForType()` when mapping heterogeneous upstream records (§5.3).

**18. Zotero 10 throws on `setType()`/`setField('itemTypeID')` across the regular/attachment/note boundary**, and on `attachmentFilename`/`attachmentPath` values containing slashes.

**19. LLM-generated text used as a filename or collection name must be sanitised.** Strip path separators and control characters, cap length, and handle the empty string.

**20. `Zotero.Attachments.importEmbeddedItems` does not exist.** It is `importEmbeddedImage`. Do not invent API names — grep the source.

**21. The `zotero-plugin-template` on `main` still declares `strict_max_version: "8.*"`** and has not been committed to since 2025-12-16. Scaffolding from it and shipping without changing that gives you a plugin disabled on the user's Zotero 10.

**22. `ztoolkit.Menu.register` no longer exists** (removed in toolkit 5.1.1, Feb 2026) — **and the official template still calls it.** A fresh `npm install` of the template does not compile. Same for `ztoolkit.PreferencePane`, `ItemTree`, `ItemBox`, `Shortcut`, `ReaderInstance` (all removed in 3.0.0). Use the native `Zotero.*Manager` APIs.

**23. `import { ZoteroToolkit } from "zotero-plugin-toolkit"` broke in toolkit 5.2.0.** It moved to the `zotero-plugin-toolkit/ztoolkit` subpath export.

**24. `fromJSON()` is a replace, not a merge.** It clears every field present on the item but absent from the JSON. Never use it to patch an existing item.

**25. `Zotero.Utilities.Internal.extractIdentifiers` is deprecated** — use `Zotero.Utilities.extractIdentifiers`. And it recognises `DOI`, `ISBN`, `arXiv`, `adsBibcode`, `PMID` **only, first-match-wins** — never PMCID.

**26. `Zotero.getString()` throws on an unknown key when the locale is `en-US`.** Plugin `.ftl` files are registered into `L10nRegistry`, not into `getString`'s synchronous bundle. This bites when using `ProgressQueue`, whose `title`/`columns` go through `getString`.

**27. Preference-pane `preference=` binding stringifies values** (`String(value)` on the way out). Numeric prefs round-trip as strings; coerce with `Number()` on read.

**28. Don't hand-copy item field lists.** Generate them at runtime from `Zotero.ItemFields` or from <https://api.zotero.org/schema>; the schema is versioned, is fetched from the API rather than bundled, and changes independently of Zotero releases. **Feature-detect** (`Zotero.ItemFields.getID('PMID')`) rather than version-check.

**29. Gate schema lookups on `await Zotero.Schema.schemaUpdatePromise`.** `Zotero.ItemFields.getID()` / `getName()` throw `UnloadedDataException` if called too early.

**30. Zotero's own docs are stale in places, and so are the toolkit's.** When docs and source disagree, the source wins. Order of resort: `zotero/zotero` source → [zotero-dev](https://groups.google.com/g/zotero-dev) → [community docs](https://windingwind.github.io/doc-for-zotero-plugin-dev/) → recently-maintained plugin source. **Note that `zotero-gpt` (toolkit ^2.0.1) and `zotero-style` (toolkit ^2.0.3, still calling the deleted `ztoolkit.PreferencePane.register`) are years stale and are not valid models for a Zotero 8+ plugin.** `zotero-better-notes`, `zotero-actions-tags` and `zotero-pdf-translate` are current.

**31. Test on the beta channel.** Under a 6–10 week major cadence, "it works on the current release" has a half-life of about two months. Keep a second profile on beta and a CI job that at minimum builds against the newest `zotero-types`.

**32. `zotero/zotero` `main` is already `11.0.SOURCE`.** The `main` branch is *not* the shipped 10.x line. When reading source to confirm an API, check whether the behaviour you are relying on exists in the 10.0 line, not just on `main`. (Example: `groupStart`/`groupEnd` search conditions exist on `main`; the 7.0 branch had only internal `blockStart`/`blockEnd`.)

---

## Sources

Official Zotero documentation

* [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) — bootstrapped model, manifest, lifecycle hooks, reason constants, Fluent, `PreferencePanes.register`, `ItemPaneManager.registerSection`, `ItemTreeManager.registerColumn`, `updates.json`
* [Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers) — Firefox 115→140 migration, ESM, Bluebird removal, `Zotero.MenuManager`, prefs-pane scope isolation
* [Zotero 9 for Developers](https://www.zotero.org/support/dev/zotero_9_for_developers) — no major developer-facing changes; `strict_max_version` → `9.0.*`
* [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers) — multi-select breaking changes, search condition groups, item validation, undo/redo, `newCookieContext`, WAL/FTS5, `HTTP.download` returning `Response`
* [Zotero 11 for Developers](https://www.zotero.org/support/dev/zotero_11_for_developers) — Firefox 140→153 breaking changes; **"Do not update your plugin to declare compatibility with Zotero 11 at this time"**
* [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api) — item/collection/search/note/attachment examples, `Zotero.DB.executeTransaction`, `Zotero.File`
* [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development) — extension proxy file, `-purgecaches`, `-ZoteroDebugText`, `-jsconsole`
* [Plugins for Zotero](https://www.zotero.org/support/plugins) — installation, no official directory, security warning
* [Zotero Version History / changelog](https://www.zotero.org/support/changelog) — 10.0 (2026-08-17), 10.0.1 (2026-08-24)
* [Zotero Blog — News](https://www.zotero.org/blog/category/news/) — Zotero 8 (2026-01-22), Zotero 9 (2026-04-10), Zotero 10 (2026-08-17), faster release cycle
* [Localization](https://www.zotero.org/support/dev/localization)

Zotero source (read on `main`, 2026-09-08)

* [`chrome/content/zotero/xpcom/http.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/http.js) — `Zotero.HTTP.request` options, exception classes, `newCookieContext`, `download`, `processDocuments`
* [`chrome/content/zotero/xpcom/progressWindow.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressWindow.js) — `Zotero.ProgressWindow`, `ItemProgress`
* [`chrome/content/zotero/xpcom/notifier.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/notifier.js) — types, events, `registerObserver` JSDoc
* [`chrome/content/zotero/xpcom/prefs.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/prefs.js) — `get`/`set`/`clear`/`registerObserver`, `PREF_BRANCH`
* [`chrome/content/zotero/xpcom/attachments.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/attachments.js) — `importFromFile`, `importFromURL`, `linkFromFile`, `linkFromURL`, `importFromDocument`, `importEmbeddedImage`, LINK_MODE constants
* [`chrome/content/zotero/xpcom/progressQueue.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/progressQueue.js) — `ProgressQueue` / `ProgressQueues` API and `ROW_*` constants
* [`chrome/content/zotero/xpcom/data/item.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/item.js) — `fromJSON` (Extra migration, strict mode, replace-not-merge semantics), `setField` date handling
* [`chrome/content/zotero/xpcom/utilities_internal.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/utilities_internal.js) — `extractExtraFields`, `combineExtraFields`, `_normalizeExtraKey`, deprecated `extractIdentifiers`
* [`chrome/content/zotero/lookup.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/lookup.js) — the "Add Item by Identifier" pipeline quoted verbatim
* [`chrome/content/zotero/xpcom/data/itemFields.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/itemFields.js) — field/base-field APIs
* [`chrome/content/zotero/xpcom/duplicates.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/duplicates.js) — `Zotero.Duplicates` heuristic
* [`chrome/content/zotero/xpcom/data/searchConditions.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/searchConditions.js) — field-name condition aliases (the `xpcom/searchConditions.js` path cited in older notes is a 404; the file lives under `xpcom/data/`)
* [`chrome/content/zotero/xpcom/plugins.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/plugins.js) — `_loadScope()` sandbox globals (`fetch`, `IOUtils`, `PathUtils`, `Localization`, …), automatic `prefs.js` loading, `registerLocales`
* [`chrome/content/zotero/xpcom/preferencePanes.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/preferencePanes.js) — `PreferencePanes.register` option list; no `l10nID`, `defaultXUL` set internally
* [`app/assets/prefs.js`](https://github.com/zotero/zotero) — `xpinstall.signatures.required = false` and the other install-policy prefs
* [`chrome/locale/ko-KR/zotero/zotero.ftl`](https://github.com/zotero/zotero/blob/main/chrome/locale/ko-KR/zotero/zotero.ftl) — Korean is a supported Zotero UI locale
* [zotero/make-it-red](https://github.com/zotero/make-it-red) — official sample plugin; `src-2.0/{manifest.json,bootstrap.js,make-it-red.js,prefs.js}` quoted verbatim
* [zotero/translation-server](https://github.com/zotero/translation-server)
* [zotero/utilities](https://github.com/zotero/utilities) — `utilities.js`, `utilities_item.js`, `date.js` (shared by client, connector and translation-server)
* [zotero/zotero-schema](https://github.com/zotero/zotero-schema) — schema history; commit `1873057` adds `preprint` (v15), commit `55a1312` adds `PMID`/`PMCID` (v34)
* [zotero/translators](https://github.com/zotero/translators) — arXiv, Crossref REST, PubMed, Europe PMC translator behaviour and IDs

Forums and dev list

* [A faster release cycle for Zotero](https://forums.zotero.org/discussion/129153/a-faster-release-cycle-for-zotero)
* [Frequent major-version changes and the current plugin compatibility model](https://forums.zotero.org/discussion/133127/frequent-major-version-changes-and-the-current-plugin-compatibility-model)
* [Zotero 9 is amazing, but the plugin documentation is becoming a "scavenger hunt"](https://forums.zotero.org/discussion/130948/zotero-9-is-amazing-but-the-plugin-documentation-is-becoming-a-scavenger-hunt)
* [zotero-dev: Zotero 8 beta coming soon — plugin updates required](https://groups.google.com/g/zotero-dev/c/uQhEGkJEzYs/m/Hjqr13PwBwAJ)
* [zotero-dev Google Group](https://groups.google.com/g/zotero-dev)
* [Announcing Zotero 10](https://forums.zotero.org/discussion/133256/announcing-zotero-10)

Ecosystem

* [zotero-plugin.dev](https://zotero-plugin.dev/) — community hub
* [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) — v3.1.0; `package.json`, `zotero-plugin.config.ts`, `addon/bootstrap.js`, `addon/manifest.json`, `src/index.ts`, `src/addon.ts`, `src/hooks.ts` quoted verbatim
* [windingwind/zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) — v5.2.0; module list, removals, and the `/ztoolkit` subpath change verified against the published npm tarballs and `dist/*.d.ts`
* [zotero-plugin-dev/zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold) — v0.9.2; CLI, build pipeline, RDP hot reload, release flow. Config reference: [`src/types/config.ts`](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold/blob/main/src/types/config.ts)
* [zotero-plugin-dev/workflows](https://github.com/zotero-plugin-dev/workflows) — the reusable `release-plugin.yml` GitHub Actions workflow the template delegates to
* [windingwind/zotero-types](https://github.com/windingwind/zotero-types) — v4.1.3; tsconfig entries table
* npm registry: [zotero-plugin-toolkit](https://www.npmjs.com/package/zotero-plugin-toolkit), [zotero-plugin-scaffold](https://www.npmjs.com/package/zotero-plugin-scaffold), [zotero-types](https://www.npmjs.com/package/zotero-types)
* [Dev Docs for Zotero Plugin (community)](https://windingwind.github.io/doc-for-zotero-plugin-dev/)
* [Zotero 8 Plugin Development Guide (community gist)](https://gist.github.com/EwoutH/04c8df5a97963b5b46cec9f392ceb103) — source of the "never use localStorage" and structure guidance
* [windingwind/zotero-better-notes](https://github.com/windingwind/zotero-better-notes) — reference for note HTML / Markdown handling
* [MuiseDestiny/zotero-gpt](https://github.com/MuiseDestiny/zotero-gpt) — reference for LLM integration in a Zotero plugin
* [Zotero item schema (machine-readable)](https://api.zotero.org/schema)

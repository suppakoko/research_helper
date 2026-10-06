/**
 * The Search & Import window's controller (P1-T20).
 *
 * Loaded as a classic chrome script by `searchDialog.xhtml`, which is why this
 * file declares one global `var` and exports nothing: `docs/01` §8.3 forbids an
 * inline `<script>` in a document the plugin creates, so the document names
 * `RHSearchWindow.init()` in its `onload` and the object has to be reachable by
 * name. `docs/08` §4.1.1's own sample is the same shape under the same name.
 *
 * ## What this file may and may not do
 *
 * - **No network call, ever.** `docs/01` §8.3: `fetch()` from a document the
 *   plugin created "may re-enter a CORS-checked context depending on the
 *   document's principal", and the resolution it gives is to "do all network
 *   I/O in the plugin's privileged sandbox and pass results into the dialog,
 *   never the other way round". Nothing here opens a connection; the search
 *   itself arrives through {@link RHSearchWindow.host} as `runSearch`, which
 *   `P1-T22` wires.
 * - **No DOM work outside `init()` and the methods it calls.** The body of this
 *   file only declares, so the whole of {@link RHSearchWindow.logic} can be
 *   evaluated and asserted in plain Node by
 *   `test/unit/ui/searchDialog.test.ts`.
 * - **No literal human-readable string.** Every visible string is a Fluent id
 *   from `research-helper-searchDialog.ftl`; the ids live in
 *   {@link RHSearchWindow.l10n} so the document and this file cannot disagree
 *   about one.
 *
 * ## Where the data comes from, and why there are two paths
 *
 * This document is a chrome window, not part of the esbuild bundle, so it
 * cannot `import` from `src/`. Everything privileged therefore arrives through
 * a host object — {@link RHSearchWindow.resolveHost} — which the privileged
 * side is expected to publish at `Zotero.<addonInstance>.api.searchWindow`.
 *
 * **Nothing publishes it today, and that is measured, not assumed.** On
 * 2026-10-06 `src/addon.ts` still initialises `api` to `{}`,
 * `src/bootstrap/registerSources.ts`'s `registerSources()` is called only from
 * `test/unit/sources/registry.test.ts`, and `installServices()` in
 * `src/bootstrap/container.ts` is called only from
 * `test/unit/bootstrap/container.test.ts` — so at runtime there is no source
 * registry and no `PrefStore` at all. The consequences are deliberate and are
 * the behaviour `docs/07` §11.1 step 11 asks for:
 *
 * - The Databases row is rendered from whatever the host reports, so with no
 *   registered adapter it renders **zero** checkboxes. `P1-T20`'s **Do NOT** is
 *   explicit that the other six must not be faked — "a checkbox that searches
 *   nothing is worse than an absent one" — and Phase 2 adds them by
 *   registration alone.
 * - Search is disabled and the inline message FR-2 requires is shown, which is
 *   the same gate as "the user unchecked everything"
 *   ({@link RHSearchWindow.logic.searchGate}).
 * - Preference seeds fall back to reading the plugin's own preference branch,
 *   where `addon/prefs.js` has put `docs/07` §8.5's defaults on the default
 *   branch. That file is tied to `src/prefs/schema.ts` by
 *   `test/unit/prefs/schema.test.ts`, which reads both and asserts every
 *   default matches, so this is the same single source of truth §8.5 owns and
 *   not a second copy of it. The numbers in {@link RHSearchWindow.spec} are the
 *   last-resort fallback for a branch that cannot be read at all, and
 *   `test/unit/ui/searchDialog.test.ts` asserts each one against both
 *   `src/prefs/schema.ts` and `docs/07` §8.5's own table row.
 */

/* global Zotero, window, document */

var RHSearchWindow = {
  /**
   * Element ids this file and `searchDialog.xhtml` share.
   *
   * `root` is the element `Zotero.UIProperties.registerRoot()` is called with
   * (`docs/08` §4.1.1 requirement 2) and `keyword` the input §4.1.1's sample
   * focuses on open.
   */
  spec: {
    root: "rh-search-dialog",
    keyword: "rh-search-keyword",
    run: "rh-search-run",
    mode: "rh-search-mode",
    yearsFrom: "rh-search-years-from",
    yearsTo: "rh-search-years-to",
    yearsSpan: "rh-search-years-span",
    maxResults: "rh-search-max-results",
    databases: "rh-search-databases",
    databasesNone: "rh-search-databases-none",
    filter: "rh-search-filter",
    hideExisting: "rh-search-hide-existing",
    resultCount: "rh-search-result-count",
    resultsArea: "rh-results-area",
    resultsContainer: "rh-results-container",
    sourceStatus: "rh-search-source-status",
    target: "rh-search-target",
    targetPopup: "rh-search-target-popup",
    targetNew: "rh-search-target-new",
    targetNewItem: "rh-search-target-new-item",
    duplicates: "rh-search-duplicates",
    status: "rh-search-status",
    progress: "rh-search-progress",
    cancel: "rh-search-cancel",
    stateInitial: "rh-state-initial",
    stateSearching: "rh-state-searching",
    stateEmpty: "rh-state-empty",
    stateError: "rh-state-error",
    initialProse: "rh-state-initial-prose",
    emptyHeadline: "rh-state-empty-headline",

    /**
     * Branch-relative preference keys, as `Zotero.Prefs` takes them with
     * `global` omitted (`docs/07` §8.5.1; `src/prefs/keys.ts`'s `PREF_BRANCH`
     * is the same `__addonRef__.` prefix used below).
     */
    prefKeys: {
      sources: "sources",
      searchYears: "searchYears",
      maxResults: "maxResults",
      hideExisting: "hideExisting",
    },

    /**
     * `docs/07` §8.5's declared type, range and shipped default for the three
     * preferences this window seeds a *widget* from.
     *
     * The ranges are not decoration: the year menulists offer exactly the spans
     * `searchYears` permits, and the number input's `min`/`max` are §8.5's. The
     * `step` of 10 is the widget's rather than a validity rule — §8.5 says so
     * and `src/prefs/schema.ts` deliberately omits it — so this is the one
     * place it is written.
     */
    prefBounds: {
      searchYears: { min: 1, max: 20, default: 3 },
      maxResults: { min: 10, max: 200, step: 10, default: 100 },
      hideExisting: { default: true },
    },

    /**
     * The duplicate policy pre-selected on open.
     *
     * `docs/07` §8.5 declares no preference for it, so `docs/08` §4.5's
     * wireframe — which draws "Add existing item to collection" as the selected
     * radio — is the only default there is, and this is the single place it is
     * recorded.
     */
    duplicatesDefault: "link",
  },

  /** Every Fluent id this file sets from script. */
  l10n: {
    windowTitle: "research-helper-search-window-title",
    close: "research-helper-search-close",
    import: "research-helper-search-import",
    yearsSpan: "research-helper-search-years-span",
    stateInitial: "research-helper-search-state-initial",
    databasesNone: "research-helper-search-databases-none",
    modeKeyword: "research-helper-search-mode-keyword",
  },

  /**
   * Wall time, as the one place this file reads it.
   *
   * Shaped like `src/core/clock.ts`'s `Clock` port on purpose — `now()` in
   * epoch milliseconds, `Date.now()` underneath — because a chrome document
   * cannot import that module and `docs/08` §4.2's year range must still be
   * computed at window open rather than hard-coded. A test replaces this
   * object the way `createManualClock()` replaces the real one.
   */
  clock: {
    now() {
      return Date.now();
    },
  },

  /** `window.arguments[0]`, per `docs/08` §4.1.1 requirement 4. */
  io: null,

  /** The privileged capabilities this window was given; see the file header. */
  host: null,

  /** Run state, so `Escape` cancels before it closes (`docs/08` §9). */
  state: { running: false, selectedCount: 0, panel: "initial" },

  // =========================================================================
  // 1. Pure logic — no DOM, no Zotero, no clock of its own
  // =========================================================================

  logic: {
    /**
     * The year range to seed the two menulists with.
     *
     * `docs/08` §4.2: `fromYear = currentYear - 2`, i.e. the last three
     * **calendar** years, computed at window open. Generalised over
     * `searchYears` because §4.2's own "Date defaults" block provides that
     * preference "that changes the default span", and the two must agree: a
     * span of 3 gives `currentYear - 2`, which is the figure §4.2 states.
     *
     * @param {number} nowEpochMs - epoch milliseconds, from the clock
     * @param {number} years - the span in calendar years, ≥ 1
     * @returns {{from: number, to: number, years: number}}
     */
    yearRange(nowEpochMs, years) {
      const to = new Date(nowEpochMs).getFullYear();
      const span = Math.max(1, Math.trunc(years));
      return { from: to - (span - 1), to, years: span };
    },

    /**
     * The years each menulist offers, newest first.
     *
     * The list spans the widest range `searchYears` permits, so every span the
     * preference allows is reachable without the "Custom…" escape hatch §4.2
     * also provides.
     *
     * @param {number} toYear - the current calendar year
     * @param {number} maxYears - `searchYears`' declared maximum
     * @returns {number[]}
     */
    yearOptions(toYear, maxYears) {
      const span = Math.max(1, Math.trunc(maxYears));
      const years = [];
      for (let y = toYear; y > toYear - span; y -= 1) {
        years.push(y);
      }
      return years;
    },

    /**
     * Whether Search may run, and the inline message to show when it may not.
     *
     * FR-2's requirement is that unchecking every source disables Search and
     * says why. An **empty registry** reaches the same state by a different
     * route and is the state the plugin is actually in today, so it is gated
     * here too rather than left as a window whose Search button does nothing.
     *
     * Both cases resolve to the one message the bundle has for this gate,
     * `research-helper-search-databases-none`. A build with no registered
     * adapter arguably deserves a message of its own — "select a database" is
     * advice the user cannot act on — but minting a string is `P1-T18`'s and
     * gate `G-41`'s, not this card's, so the existing id is reused and the gap
     * is reported.
     *
     * @param {{available: string[], selected: string[]}} sources
     * @returns {{enabled: boolean, messageId: string|null}}
     */
    searchGate(sources) {
      const available = sources.available || [];
      const selected = sources.selected || [];
      if (available.length === 0 || selected.length === 0) {
        return {
          enabled: false,
          messageId: "research-helper-search-databases-none",
        };
      }
      return { enabled: true, messageId: null };
    },

    /**
     * Whether Import may run. `docs/08` §4.2: "disabled until ≥1 selected".
     *
     * @param {number} selectedCount
     * @returns {boolean}
     */
    importEnabled(selectedCount) {
      return Math.trunc(selectedCount) > 0;
    },

    /** The four `docs/08` §4.6 panels this card owns, and the results table. */
    panels: {
      initial: "rh-state-initial",
      searching: "rh-state-searching",
      empty: "rh-state-empty",
      error: "rh-state-error",
      results: "rh-results-container",
    },

    /**
     * `"pubmed,europepmc"` → `["pubmed", "europepmc"]`.
     *
     * `docs/07` §8.5: membership in the `sources` preference *is* each source's
     * enable flag, so this is read as a set and never as an ordering.
     *
     * @param {unknown} raw - whatever the preference branch returned
     * @returns {string[]}
     */
    parseSourceIds(raw) {
      if (typeof raw !== "string") {
        return [];
      }
      return raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    },

    /**
     * `docs/07` §8.5.1's coercion, applied to one numeric preference.
     *
     * The pane's `preference=` binding applies `String(value)` on the way out
     * (`docs/08` §7.2), so a touched `maxResults` reads back as a **string**;
     * §8.5.1 calls string arithmetic on it "a classic and very confusing bug".
     * Out of range yields the declared default rather than the nearest bound,
     * which is `src/prefs/index.ts`'s rule and its reason: clamping silently
     * keeps a corrupt value in play.
     *
     * @param {unknown} raw
     * @param {{min: number, max: number, default: number}} bounds
     * @returns {number}
     */
    coerceInteger(raw, bounds) {
      if (typeof raw === "boolean" || raw === undefined || raw === null) {
        return bounds.default;
      }
      if (typeof raw === "string" && raw.trim() === "") {
        return bounds.default;
      }
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        return bounds.default;
      }
      if (value < bounds.min || value > bounds.max) {
        return bounds.default;
      }
      return value;
    },

    /**
     * {@link coerceInteger}'s counterpart for a boolean preference, accepting
     * the `String(value)` spellings for the same reason.
     *
     * @param {unknown} raw
     * @param {boolean} fallback
     * @returns {boolean}
     */
    coerceBoolean(raw, fallback) {
      if (typeof raw === "boolean") {
        return raw;
      }
      if (raw === "true") {
        return true;
      }
      if (raw === "false") {
        return false;
      }
      return fallback;
    },

    /**
     * Coerce a whole seed object. Pure, so the same function covers the host
     * path and the preference-branch path.
     *
     * @param {object} raw
     * @param {object} bounds - {@link RHSearchWindow.spec.prefBounds}
     * @returns {{sources: string[], searchYears: number, maxResults: number,
     *   hideExisting: boolean}}
     */
    normalizePrefs(raw, bounds) {
      const source = raw || {};
      return {
        sources: this.parseSourceIds(source.sources),
        searchYears: this.coerceInteger(source.searchYears, bounds.searchYears),
        maxResults: this.coerceInteger(source.maxResults, bounds.maxResults),
        hideExisting: this.coerceBoolean(
          source.hideExisting,
          bounds.hideExisting.default,
        ),
      };
    },

    /**
     * Which registered sources start checked.
     *
     * Membership in the `sources` preference is the enable flag; a source the
     * preference does not mention at all starts checked, because a registered
     * adapter the user has never had the chance to deselect is not a source
     * they disabled. With no registered source the answer is the empty list,
     * which is what disables Search.
     *
     * @param {string[]} registered
     * @param {string[]} enabled - the `sources` preference, parsed
     * @returns {string[]}
     */
    initialSelection(registered, enabled) {
      if (!enabled || enabled.length === 0) {
        return [...registered];
      }
      return registered.filter((id) => enabled.includes(id));
    },
  },

  // =========================================================================
  // 2. Lifecycle
  // =========================================================================

  /**
   * `docs/08` §4.1.1's `init()`.
   *
   * Called from the document's `onload` attribute, which is what §4.1.1 shows,
   * and **also** from a `load` listener registered at the bottom of this file.
   * `docs/01` §8.3 leaves the exact CSP applied to a plugin's `chrome://`
   * XHTML on Zotero 10 marked **Unverified**; if that CSP turns out to block
   * inline event-handler attributes, the listener is what still runs. The guard
   * below makes the second call a no-op, so whichever arrives first wins.
   */
  init() {
    if (this.state.initialized) {
      return;
    }
    this.state.initialized = true;

    this.io =
      (typeof window !== "undefined" &&
        window.arguments &&
        window.arguments[0]) ||
      {};
    this.host = this.resolveHost();

    // First, and deliberately not wrapped: docs/08 §4.1.1 requirement 2 and §9
    // both call omitting this "a real accessibility defect", so a failure here
    // must be loud rather than swallowed into a dialog that quietly ignores the
    // font size the user chose.
    this.registerUIRoot();

    this.applyChromeStrings();
    this.seedControls();
    this.renderDatabaseRow();
    this.renderCollections();
    this.bindEvents();
    this.showPanel("initial");
    this.refreshSearchGate();
    this.refreshImportGate();
    this.focusKeyword();
  },

  /**
   * `Zotero.UIProperties.registerRoot(rootEl)` — the call that applies the
   * user's `fontSize` preference, `--zotero-font-size`, `--zotero-ui-density`
   * and `dir="rtl"` to this window.
   */
  registerUIRoot() {
    Zotero.UIProperties.registerRoot(this.el(this.spec.root));
  },

  /**
   * The privileged capabilities this window runs on, every one optional.
   *
   * The contract, for the card that wires it (`P1-T21` / `P1-T22`, and whatever
   * card finally calls `installServices()` and `registerSources()` at
   * startup):
   *
   * - `listSources(): { id: string, displayNameKey: string }[]` — the source
   *   registry's `list()`, mapped. `docs/08` §4.2's Databases row is rendered
   *   from it and from nothing else.
   * - `listCollections(): { id: number, name: string }[]` — for the target
   *   picker.
   * - `getPrefs(): { sources, searchYears, maxResults, hideExisting }` — read
   *   through `src/prefs`' typed accessor.
   * - `runSearch(query)`, `runImport(request)`, `cancel()`,
   *   `createCollection(name)` — the pipeline entry points.
   *
   * @returns {object} the host, never null
   */
  resolveHost() {
    const instance =
      typeof Zotero === "undefined" ? undefined : Zotero.__addonInstance__;
    const api = instance && instance.api;
    return (api && api.searchWindow) || {};
  },

  /**
   * Set the three strings XUL carries in attributes the bundle does not target:
   * the window title and the two dialog button labels.
   *
   * They are set from Fluent rather than written into the markup because
   * `P1-T20`'s **Do NOT** forbids a literal English string there, and
   * `docs/08` §4.1.1's own sample hard-codes all three.
   *
   * @returns {Promise<void>|undefined}
   */
  applyChromeStrings() {
    const l10n = document.l10n;
    if (!l10n || typeof l10n.formatMessages !== "function") {
      return undefined;
    }
    return l10n
      .formatMessages([
        { id: this.l10n.windowTitle },
        { id: this.l10n.close },
        { id: this.l10n.import, args: { count: 0 } },
      ])
      .then((messages) => {
        const [title, close, importLabel] = messages;
        if (title && title.value) {
          document.title = title.value;
        }
        const dialog = this.el(this.spec.root);
        const closeLabel = this.attributeOf(close, "label");
        const acceptLabel = this.attributeOf(importLabel, "label");
        if (dialog && closeLabel !== undefined) {
          dialog.setAttribute("buttonlabelcancel", closeLabel);
        }
        if (dialog && acceptLabel !== undefined) {
          dialog.setAttribute("buttonlabelaccept", acceptLabel);
        }
      });
  },

  /**
   * Seed every control from `docs/07` §8.5's defaults, computing the year range
   * at window open.
   */
  seedControls() {
    const prefs = this.readPrefs();
    this.prefs = prefs;

    const bounds = this.spec.prefBounds;
    const range = this.logic.yearRange(this.clock.now(), prefs.searchYears);
    const options = this.logic.yearOptions(range.to, bounds.searchYears.max);

    this.fillYearMenulist(this.spec.yearsFrom, options, range.from);
    this.fillYearMenulist(this.spec.yearsTo, options, range.to);
    this.applyYearRange(range);

    const max = this.el(this.spec.maxResults);
    if (max) {
      max.setAttribute("min", String(bounds.maxResults.min));
      max.setAttribute("max", String(bounds.maxResults.max));
      max.setAttribute("step", String(bounds.maxResults.step));
      max.value = String(prefs.maxResults);
    }

    const hide = this.el(this.spec.hideExisting);
    if (hide) {
      hide.checked = prefs.hideExisting;
    }

    const duplicates = this.el(this.spec.duplicates);
    if (duplicates) {
      duplicates.value = this.spec.duplicatesDefault;
    }

    const mode = this.el(this.spec.mode);
    if (mode && this.io.mode === "keyword") {
      mode.setAttribute("data-l10n-id", this.l10n.modeKeyword);
    }
  },

  /**
   * The preference seed: the host's typed accessor when one is attached, the
   * plugin's own preference branch otherwise. See the file header for why both
   * read the same table.
   *
   * @returns {{sources: string[], searchYears: number, maxResults: number,
   *   hideExisting: boolean}}
   */
  readPrefs() {
    const bounds = this.spec.prefBounds;
    if (typeof this.host.getPrefs === "function") {
      return this.logic.normalizePrefs(this.host.getPrefs(), bounds);
    }
    return this.logic.normalizePrefs(this.readPrefBranch(), bounds);
  },

  /**
   * Read the four branch-relative keys this window seeds from.
   *
   * `docs/07` §8.5.1's typed accessor "never throws: a corrupt pref must not be
   * able to stop a job from starting", and the same has to hold here — a
   * preference that cannot be read must leave the window usable, so each read
   * degrades to `undefined` and {@link logic.normalizePrefs} supplies §8.5's
   * default.
   *
   * @returns {object} raw, uncoerced values
   */
  readPrefBranch() {
    const keys = this.spec.prefKeys;
    const read = (key) => {
      try {
        return Zotero.Prefs.get("__addonRef__." + key);
      } catch {
        return undefined;
      }
    };
    return {
      sources: read(keys.sources),
      searchYears: read(keys.searchYears),
      maxResults: read(keys.maxResults),
      hideExisting: read(keys.hideExisting),
    };
  },

  /**
   * Fill one year `<menulist>` and select `selected`.
   *
   * @param {string} id
   * @param {number[]} years
   * @param {number} selected
   */
  fillYearMenulist(id, years, selected) {
    const list = this.el(id);
    if (!list) {
      return;
    }
    const popup = list.firstElementChild || list;
    this.clear(popup);
    for (const year of years) {
      const item = this.createXUL("menuitem");
      const text = String(year);
      item.setAttribute("value", text);
      // A year is a number, not a translatable string (docs/08 §10.3 keeps
      // identifiers and numerals untranslated), so this is the one label in
      // the window that is not a Fluent id.
      item.setAttribute("label", text);
      popup.appendChild(item);
    }
    list.value = String(selected);
  },

  /**
   * Put the computed span in the label, as `docs/08` §4.2 requires "so the user
   * is never guessing whether '3 years' means rolling 36 months or three
   * calendar years".
   *
   * @param {{from: number, to: number, years: number}} range
   */
  applyYearRange(range) {
    // **`from` and `to` are passed as strings, and that is not a slip.**
    // Measured in a live window on 2026-10-06: passed as numbers, Fluent
    // formats a bare `{ $from }` through `Intl.NumberFormat`, so the label
    // read `2,024 – 2,026 (last 3 calendar years)` — a thousands separator in
    // a year. `docs/08` §4.2 requires the label to read `2024 – 2026`
    // literally, so the only two fixes are a string argument here or
    // `NUMBER($from, useGrouping: "false")` in the bundle, and the bundle is
    // `P1-T18`'s. `years` stays a number because it selects the message's
    // plural variant, and three digits never group.
    //
    // `src/i18n/keys.ts`'s FluentMessageArgsMap types `from` and `to` as
    // `number`, so a future caller in `src/` that obeys the type will
    // reproduce the separator. That is reported with this card.
    const args = JSON.stringify({
      from: String(range.from),
      to: String(range.to),
      years: range.years,
    });
    // The id and the arguments are set together, never separately: Fluent
    // retranslates on either mutation, and a translation that arrives without
    // its variables both logs an l10n error and paints `{ $from } – { $to }`.
    this.localize(this.spec.yearsSpan, this.l10n.yearsSpan, args);
    // docs/08 §4.6's INITIAL panel names the same span.
    this.localize(
      this.spec.initialProse,
      this.l10n.stateInitial,
      JSON.stringify({ years: range.years }),
    );
  },

  /**
   * Point an element at a Fluent message, with its arguments if it has any.
   *
   * @param {string} id - element id
   * @param {string} messageId - a Fluent id from {@link RHSearchWindow.l10n}
   * @param {string} [args] - a JSON object literal, or omitted
   */
  localize(id, messageId, args) {
    const element = this.el(id);
    if (!element) {
      return;
    }
    if (args !== undefined) {
      element.setAttribute("data-l10n-args", args);
    }
    element.setAttribute("data-l10n-id", messageId);
  },

  /**
   * Render `docs/08` §4.2's Databases row from the source registry.
   *
   * One checkbox per **registered** adapter, labelled by the source's own
   * `displayNameKey`, in registration order. No source is named in this file or
   * in the markup: `docs/07` §11.1 step 11 is that "the source appears
   * automatically in the search dialog because it is rendered from the
   * registry", and `P1-T20`'s **Do NOT** forbids faking the absent ones.
   */
  renderDatabaseRow() {
    const row = this.el(this.spec.databases);
    if (!row) {
      return;
    }
    this.clear(row);

    const sources =
      typeof this.host.listSources === "function"
        ? this.host.listSources() || []
        : [];
    const selected = this.logic.initialSelection(
      sources.map((source) => source.id),
      (this.prefs && this.prefs.sources) || [],
    );

    for (const source of sources) {
      const box = this.createXUL("checkbox");
      box.id = "rh-search-db-" + source.id;
      box.className = "rh-source";
      box.setAttribute("value", source.id);
      box.setAttribute("data-l10n-id", source.displayNameKey);
      box.checked = selected.includes(source.id);
      box.addEventListener("command", () => this.refreshSearchGate());
      row.appendChild(box);
    }
  },

  /**
   * Fill the target-collection picker, leaving "New collection…" in place.
   *
   * `docs/08` §4.2: the default is the current collection if one is selected,
   * else "New collection…" — and `collectionID` in `window.arguments[0]` is how
   * the collection context-menu entry says which that is.
   */
  renderCollections() {
    const list = this.el(this.spec.target);
    const popup = this.el(this.spec.targetPopup);
    if (!list || !popup) {
      return;
    }
    const collections =
      typeof this.host.listCollections === "function"
        ? this.host.listCollections() || []
        : [];
    for (const collection of collections) {
      const item = this.createXUL("menuitem");
      item.setAttribute("value", String(collection.id));
      // A user-chosen collection name: not a translatable string.
      item.setAttribute("label", collection.name);
      popup.appendChild(item);
    }
    const preselect = this.io.collectionID;
    const known = collections.some((c) => c.id === preselect);
    list.value = known ? String(preselect) : "new";
  },

  /** Wire every control. `docs/08` §9's keyboard contract lives here. */
  bindEvents() {
    const keyword = this.el(this.spec.keyword);
    if (keyword) {
      keyword.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.search();
        }
      });
    }

    this.on(this.spec.run, "command", () => this.search());
    this.on(this.spec.cancel, "command", () => this.cancel());
    this.on(this.spec.targetNew, "command", () => this.newCollection());
    this.on(this.spec.targetNewItem, "command", () => this.newCollection());
    this.on(this.spec.yearsFrom, "command", () => this.onYearChanged());
    this.on(this.spec.yearsTo, "command", () => this.onYearChanged());

    // docs/08 §4.1.1's own init(): the accept button must not close the window,
    // because the import reports into the status bar.
    document.addEventListener("dialogaccept", (event) => {
      event.preventDefault();
      this.import();
    });

    // NFR-13 and docs/08 §9: Escape closes, and cancels a running job first,
    // with the second Escape closing.
    document.addEventListener("dialogcancel", (event) => {
      if (this.state.running) {
        event.preventDefault();
        this.cancel();
      }
    });
  },

  /** `docs/08` §4.2: the keyword field is focused on open. */
  focusKeyword() {
    const keyword = this.el(this.spec.keyword);
    if (keyword && typeof keyword.focus === "function") {
      keyword.focus();
    }
  },

  // =========================================================================
  // 3. Gates and panels
  // =========================================================================

  /** Apply {@link logic.searchGate} to the Search button and the message. */
  refreshSearchGate() {
    const gate = this.logic.searchGate({
      available: this.availableSourceIds(),
      selected: this.selectedSourceIds(),
    });

    const run = this.el(this.spec.run);
    if (run) {
      run.disabled = !gate.enabled;
    }
    const message = this.el(this.spec.databasesNone);
    if (message) {
      message.hidden = gate.messageId === null;
      if (gate.messageId !== null) {
        message.setAttribute("data-l10n-id", gate.messageId);
      }
    }
    return gate;
  },

  /** Apply {@link logic.importEnabled} to the dialog's accept button. */
  refreshImportGate() {
    const dialog = this.el(this.spec.root);
    const enabled = this.logic.importEnabled(this.state.selectedCount);
    if (dialog) {
      dialog.setAttribute("buttondisabledaccept", enabled ? "false" : "true");
    }
    return enabled;
  },

  /** Every id in the Databases row, i.e. every registered source. */
  availableSourceIds() {
    return this.sourceBoxes().map((box) => box.getAttribute("value"));
  },

  /** The ticked subset. */
  selectedSourceIds() {
    return this.sourceBoxes()
      .filter((box) => box.checked)
      .map((box) => box.getAttribute("value"));
  },

  /** @returns {object[]} the checkboxes `renderDatabaseRow` created */
  sourceBoxes() {
    const row = this.el(this.spec.databases);
    if (!row || !row.children) {
      return [];
    }
    return [...row.children];
  },

  /**
   * Show one of `docs/08` §4.6's panels and hide the rest.
   *
   * @param {"initial"|"searching"|"empty"|"error"|"results"} name
   */
  showPanel(name) {
    const panels = this.logic.panels;
    const target = panels[name];
    if (target === undefined) {
      return;
    }
    for (const key of Object.keys(panels)) {
      const element = this.el(panels[key]);
      if (element) {
        element.hidden = panels[key] !== target;
      }
    }
    this.state.panel = name;
  },

  // =========================================================================
  // 4. Actions — the pipeline's half is P1-T21's and P1-T22's
  // =========================================================================

  /**
   * Start a search, if the gate allows one.
   *
   * No request is made here. `docs/01` §8.3 requires every network call to run
   * in the privileged sandbox, so this hands the query to the host and the
   * host answers by driving the panels.
   */
  search() {
    if (!this.refreshSearchGate().enabled) {
      return;
    }
    if (typeof this.host.runSearch !== "function") {
      // Nothing is wired yet. Staying on the current panel is the honest
      // outcome: a "searching…" list that will never resolve would be a lie.
      return;
    }
    this.state.running = true;
    this.showPanel("searching");
    this.host.runSearch(this.collectQuery());
  },

  /** Hand the picked rows to the host. FR-5's accounting is `P1-T22`'s. */
  import() {
    if (!this.logic.importEnabled(this.state.selectedCount)) {
      return;
    }
    if (typeof this.host.runImport === "function") {
      this.host.runImport(this.collectQuery());
    }
  },

  /** Cancel a running job. FR-5: Cancel performs zero database writes. */
  cancel() {
    this.state.running = false;
    if (typeof this.host.cancel === "function") {
      this.host.cancel();
    }
  },

  /** "New collection…" — `docs/08` §4.1.2 suggests `DialogHelper` for this. */
  newCollection() {
    if (typeof this.host.createCollection === "function") {
      this.host.createCollection();
    }
  },

  /** Re-state the span when the user moves either year menulist. */
  onYearChanged() {
    const from = Number(this.value(this.spec.yearsFrom));
    const to = Number(this.value(this.spec.yearsTo));
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return;
    }
    this.applyYearRange({ from, to, years: Math.max(1, to - from + 1) });
  },

  /**
   * Everything the pipeline needs to run what the window currently shows.
   *
   * @returns {object}
   */
  collectQuery() {
    return {
      mode: this.io.mode || "keyword",
      keyword: this.value(this.spec.keyword) || "",
      fromYear: Number(this.value(this.spec.yearsFrom)),
      toYear: Number(this.value(this.spec.yearsTo)),
      maxResults: Number(this.value(this.spec.maxResults)),
      sources: this.selectedSourceIds(),
      filter: this.value(this.spec.filter) || "",
      hideExisting: this.checked(this.spec.hideExisting),
      duplicates: this.value(this.spec.duplicates),
      collectionID: this.value(this.spec.target),
    };
  },

  // =========================================================================
  // 5. Small DOM helpers
  // =========================================================================

  /** @param {string} id */
  el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  },

  /** @param {string} id */
  value(id) {
    const element = this.el(id);
    return element ? element.value : undefined;
  },

  /** @param {string} id */
  checked(id) {
    const element = this.el(id);
    return element ? Boolean(element.checked) : false;
  },

  /** @param {string} id @param {string} type @param {Function} handler */
  on(id, type, handler) {
    const element = this.el(id);
    if (element && typeof element.addEventListener === "function") {
      element.addEventListener(type, handler);
    }
  },

  /** @param {string} name - a XUL local name */
  createXUL(name) {
    return typeof document.createXULElement === "function"
      ? document.createXULElement(name)
      : document.createElement(name);
  },

  /** @param {object} element */
  clear(element) {
    while (element && element.firstChild) {
      element.removeChild(element.firstChild);
    }
  },

  /**
   * One attribute off a `formatMessages` result.
   *
   * @param {object} message
   * @param {string} name
   * @returns {string|undefined}
   */
  attributeOf(message, name) {
    const attributes = (message && message.attributes) || [];
    for (const attribute of attributes) {
      if (attribute.name === name) {
        return attribute.value;
      }
    }
    return undefined;
  },
};

// The CSP fallback for the document's `onload` attribute; see `init()`.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("load", () => RHSearchWindow.init(), { once: true });
}

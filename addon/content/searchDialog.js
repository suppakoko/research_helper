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
 * **Nothing publishes it today**, and the reason is narrower than this comment
 * used to claim.
 *
 * **Corrected 2026-10-07 (`P1-T22`), and the error was this file's.** The
 * paragraph here said that `installServices()` "is called only from
 * `test/unit/bootstrap/container.test.ts`" and that `registerSources()` is
 * called only from `test/unit/sources/registry.test.ts`, concluding that "at
 * runtime there is no source registry and no `PrefStore` at all". Both halves
 * are false, and were already false when the sentence was written: grepped
 * 2026-10-07, `src/bootstrap/registerUI.ts:267` calls `installServices()` from
 * `registerUI()`, which `src/hooks.ts`'s `onStartup` awaits, and
 * `installServices` calls `registerSources()` itself. So at run time there **is**
 * a filled source registry, a `PrefStore`, an `HttpClient`, a pipeline registry
 * and a per-job pipeline-context factory.
 *
 * What is actually missing is one line: `registerUI()` holds the
 * `ServiceGraph` nowhere ("deliberately **not** held anywhere", with the reason
 * given there), and `src/addon.ts`'s constructor sets `this.api = {}` and nothing
 * writes to it — `grep -rn "\.api\b" src/` returns those two lines and nothing
 * else. Publishing the host therefore needs an edit to one of those two files,
 * and **neither is in `P1-T22`'s `Files` list**, so that card reported it rather
 * than making it (`plan/README.md` §5 rule 2). The host and the view model it
 * wraps exist: `src/ui/viewModels/searchImportViewModel.ts`'s
 * `createSearchImportViewModel(...).host` is exactly the object below, and
 * `test/integration/searchDialog-flow.spec.ts` installs it to run the window end
 * to end.
 *
 * With no host attached the consequences are deliberate and are the behaviour
 * `docs/07` §11.1 step 11 asks for:
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

/* global Zotero, Services, window, document, ChromeUtils */

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
    // FR-8's third scenario (P1-T45). Both are in the markup, `hidden`, and
    // revealed from view state the way `cancel` is.
    exportProvenance: "rh-search-export",
    exportStatus: "rh-search-export-status",
    stateInitial: "rh-state-initial",
    stateSearching: "rh-state-searching",
    stateEmpty: "rh-state-empty",
    stateError: "rh-state-error",
    initialProse: "rh-state-initial-prose",
    emptyHeadline: "rh-state-empty-headline",

    statusBar: "rh-search-status-bar",

    // docs/08 §4.6's all-failed panel (P1-T22). All five are in P1-T20's
    // markup; the parts this file builds are under `built` below.
    errorHeadline: "rh-state-error-headline",
    errorDetail: "rh-state-error-detail",
    errorActions: "rh-state-error-actions",
    errorRetry: "rh-state-error-retry",
    errorPreferences: "rh-state-error-open-preferences",

    // docs/08 §4.3's plain scrollable table and §4.5's selection row (P1-T21).
    resultsScroll: "rh-results-scroll",
    resultsTable: "rh-results-table",
    resultsHeadRow: "rh-results-head-row",
    resultsBody: "rh-results-body",
    selectAllBox: "rh-results-select-all-box",
    selectAll: "rh-results-select-all",
    selectNone: "rh-results-select-none",
    selectInvert: "rh-results-select-invert",
    selectedCount: "rh-results-selected-count",

    /**
     * Ids of elements **this file creates**, kept out of the flat list above for
     * the same reason {@link RHSearchWindow.spec.row} is: that list is the set
     * of ids `searchDialog.xhtml` declares, and
     * `test/unit/ui/searchDialog.test.ts` asserts every one of them resolves in
     * the document. These do not, until `init()` has run.
     *
     * **Why they are built by script rather than written into the markup.**
     * `addon/content/searchDialog.xhtml` is `P1-T20`'s file and is **not** in
     * `P1-T22`'s `Files` list, so adding six elements to it would be the
     * scope-widening `plan/README.md` §5 rule 2 forbids. This file already
     * builds the Databases row, the target picker's items and every table row,
     * so one more construction site is the smaller change — and the markup
     * already left `#rh-state-error-detail` as an empty `<vbox>` for exactly
     * this.
     *
     * - `notices` / `warningList` / `noticeList` — FR-9's non-blocking banner,
     *   the import summary and `R-17`'s abstract-coverage line. Inserted
     *   **before the status bar**, outside `#rh-results-area`, so they survive a
     *   panel swap: `showPanel()` hides every panel but one, and a banner that
     *   vanished when the EMPTY panel came up would be a banner nobody read.
     * - `errorLines` — one line per failed source, `docs/08` §4.6's
     *   "PubMed: HTTP 429 …" rows.
     * - `errorDetailsToggle` / `errorDetailsList` — NFR-14's details
     *   disclosure.
     * - `databaseProgress` — §4.5's `5 of 7 databases`, beside the bar. Its own
     *   element rather than the status line's, because both are live and the
     *   status line already carries `Searching { $database }…`.
     */
    built: {
      notices: "rh-search-notices",
      warningList: "rh-search-warnings",
      noticeList: "rh-search-notice",
      errorLines: "rh-state-error-lines",
      errorDetailsToggle: "rh-state-error-details-toggle",
      errorDetailsList: "rh-state-error-details-list",
      databaseProgress: "rh-search-progress-databases",
    },

    /**
     * Per-row naming, kept out of the flat id list above because none of these
     * is an element id in the shipped document: the first two are built per
     * row and the third is an attribute name.
     */
    row: {
      /** `<td>` id prefix; the row and its checkbox `aria-labelledby` it. */
      titleIdPrefix: "rh-results-row-title-",
      /** Where a built row records which result it is. */
      keyAttribute: "data-rh-row-key",
    },

    /**
     * Class names the built rows and the stylesheet share.
     *
     * Nothing typechecks either file (`tsconfig.json` excludes `addon`), so a
     * typo here is a silently unstyled table. They are listed in one place and
     * `test/unit/ui/searchDialog.test.ts` asserts the stylesheet declares each
     * one.
     */
    rowClass: {
      row: "rh-row",
      existingRow: "rh-row-existing",
      select: "rh-row-select",
      badge: "rh-existing-badge",
      sourceLine: "rh-source-line",
    },

    /**
     * How many author names a row draws before the overflow count takes over.
     *
     * **`docs/08` states no number, and this is reported with the card rather
     * than presented as the document's.** §4.5's wireframe draws the overflow
     * form once with three names ("Kim, Park, Novak +5") and once with one
     * ("Adeyemi +11"), so the wireframe cannot be read as a single rule; the
     * bundle's `research-helper-search-authors-overflow` establishes only that
     * a cap exists. Three is §4.5's widest drawn row, and it is written here
     * once so a documented decision can replace it in one edit.
     */
    authorNamesShown: 3,

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

    /**
     * The **second** Fluent bundle this window needs, added at run time.
     *
     * `searchDialog.xhtml`'s `<linkset>` links one resource,
     * `research-helper-searchDialog.ftl`, which was right until this card made
     * the window render a pipeline's outcome. Measured 2026-10-07, by grepping
     * both bundles: **every string the error states, the per-database names and
     * the import summary need is in `research-helper-mainWindow.ftl`** —
     * `rh-error-offline` and the rest of `docs/08` §8.3's rows,
     * `research-helper-source-pubmed` and every other literature-source display
     * name, `research-helper-import-summary` and
     * `research-helper-import-abstract-coverage`. `src/i18n/keys.ts`'s
     * `MESSAGE_IDS_BY_SURFACE` is the authority and puts them there.
     *
     * The first run of `test/integration/searchDialog-flow.spec.ts` is how this
     * was found: the per-database line rendered as an **empty string**, because
     * a `data-l10n-id` whose message is in an unlinked resource resolves to
     * nothing and Fluent leaves the element alone.
     *
     * The fix is `document.l10n.addResourceIds([...])` rather than a second
     * `<html:link>`: `addon/content/searchDialog.xhtml` is `P1-T20`'s file and is
     * **not** in `P1-T22`'s `Files` list (`plan/README.md` §5 rule 2). It is also
     * not one of `eslint.config.js`'s scoped registration APIs and it is not
     * `insertFTLIfNeeded` — that one is confined to
     * `src/zotero/registrations.ts` and is for windows *Zotero* owns; this is
     * our own document, which takes its resources with it when it closes.
     *
     * `__addonRef__` is substituted at build time by the scaffold's
     * `replaceDefine()`, the same way `Zotero.Prefs.get("__addonRef__." + key)`
     * below is and the same way the `<linkset>` in the markup is. **Needs a
     * card** if the owner would rather the link be in the markup, or rather the
     * §8.3 rows move surface.
     */
    ftl: {
      mainWindow: "__addonRef__-mainWindow.ftl",
    },
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
    resultCount: "research-helper-search-result-count",
    selectedCount: "research-helper-search-selected-count",
    authorsOverflow: "research-helper-search-authors-overflow",
    rowExisting: "research-helper-search-row-existing",
    rowExistingBadge: "research-helper-search-row-existing-badge",

    // NFR-14's details disclosure, built by script (P1-T22). Both carry a
    // `.label`, so they are set as a `data-l10n-id` on a `<button>`.
    detailsShow: "research-helper-search-details-show",
    detailsHide: "research-helper-search-details-hide",

    /**
     * The one existing message the "New collection…" prompt reuses.
     *
     * `research-helper-search-target-new` is already the label of both the
     * menuitem and the button beside the picker, and its text is exactly the
     * question the prompt asks. Minting a prompt title and a prompt body would
     * be two new strings in `P1-T18`'s bundles, which are not in `P1-T22`'s
     * `Files` list — so the prompt reuses this one rather than inlining
     * English, and the fact that a dedicated string would read better is
     * reported with the card.
     */
    targetNew: "research-helper-search-target-new",

    /**
     * FR-8's third scenario — the control's label and its two outcome
     * sentences (P1-T45).
     *
     * `exportWritten` and `exportFailed` are plain values, set on a
     * `<description>`'s `data-l10n-id` so Fluent writes them into
     * `textContent`; `exportProvenance` carries a `.label` because it is a
     * `<button>`. All three are declared by `src/i18n/keys.ts`'s
     * `SEARCH_DIALOG_MESSAGE_IDS` and asserted against it by
     * `test/unit/ui/searchDialog.test.ts`.
     *
     * **There are two sentences for five outcomes, and that is a decision.**
     * `host.exportProvenance` returns `written`, `no-record`, `no-writer`,
     * `no-path` or `failed`. `written` gets the first sentence; the other four
     * all get the second, because from the user's side they are one event —
     * "it did not write" — and because three of them cannot be reached from a
     * visible control at all (see {@link RHSearchWindow.exportProvenance}).
     * Minting a sentence per outcome would put three more strings on `G-41`
     * for events a user is not supposed to see. A dismissed chooser gets
     * **no** sentence: this document never calls the host without a path, so
     * there is no outcome value for it, and a user who cancelled knows they
     * did (`P1-T45` step 4).
     */
    exportProvenance: "research-helper-search-export",
    exportWritten: "research-helper-search-export-written",
    exportFailed: "research-helper-search-export-failed",
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

  /**
   * Zotero's own file-picker wrapper, as a module URL (P1-T45).
   *
   * **Read off the shipped Zotero 10.0.3, not guessed.** `app/omni.ja` holds it
   * at `chrome/content/zotero/modules/filePicker.mjs` and that archive's
   * `chrome.manifest` maps `content zotero chrome/content/zotero/`, which is the
   * URL below. The class it exports takes a **window** in `init()` and does
   * `parentWindow.browsingContext` itself, which is the `docs/01`:436
   * requirement that kept this out of `src/`; `show()` returns a promise; and
   * its `file` getter returns a **string path**, not an `nsIFile`.
   *
   * **The toolkit is not used, and could not be.** `docs/01` §4.6 item 8 keeps
   * `FilePickerHelper` on the approved list, but `zotero-plugin.config.ts` only
   * bundles `src/index.ts` — every file under `addon/` is copied by
   * `build.assets` as a plain asset — so this document cannot `import` from
   * `node_modules` at all. `P1-T45`'s **Do NOT** asked for that to be verified
   * before importing the toolkit; it was, and the helper turns out to do exactly
   * what the four lines in {@link RHSearchWindow.pickExportPath} do, through
   * this same module and this same `ChromeUtils.importESModule`.
   *
   * Not in {@link RHSearchWindow.spec}: that object is the set of element ids,
   * and `test/unit/ui/searchDialog.test.ts` asserts every string in it resolves
   * to an element in the document.
   */
  filePickerModule: "chrome://zotero/content/modules/filePicker.mjs",

  /** `window.arguments[0]`, per `docs/08` §4.1.1 requirement 4. */
  io: null,

  /** The privileged capabilities this window was given; see the file header. */
  host: null,

  /**
   * Run state, so `Escape` cancels before it closes (`docs/08` §9), plus the
   * result table's own four pieces (P1-T21).
   *
   * - `results` — what the host handed in, untouched, in arrival order.
   * - `rows` — one display row per result, same order and same length, built
   *   once by {@link RHSearchWindow.logic.rowsFromRecords}.
   * - `visible` — the subset of `rows` the filter and the hide-existing
   *   checkbox currently leave showing. Rebuilt on every filter change.
   * - `selection` — **row keys, over the whole of `rows`.** Never indices and
   *   never a subset of `visible`; see the `logic` selection block.
   */
  state: {
    running: false,
    selectedCount: 0,
    panel: "initial",
    results: [],
    rows: [],
    visible: [],
    selection: [],
    view: { filter: "", hideExisting: false },
    /** The count the in-flight Import-label request was made for. */
    importLabelCount: 0,

    /**
     * The `recordsRevision` of the result set currently in the table (P1-T22).
     *
     * The host publishes a whole view state on **every** progress snapshot, and
     * the reporter throttles those to four a second. Re-handing the same records
     * to `setResults()` each time would rebuild the table and reset
     * `state.selection`, so a user who had unticked five rows would watch them
     * come back. The records are therefore applied only when this number moves,
     * which the view model bumps once per completed fetch.
     */
    appliedRecordsRevision: 0,
    /** The current detach function from `host.connect`, or null. */
    disconnect: null,
    /** Whether the details disclosure is expanded (NFR-14). */
    detailsOpen: false,

    /**
     * Whether the run the window is showing has a provenance record to export
     * (P1-T45), and which outcome sentence is on screen, or `null`.
     *
     * See {@link RHSearchWindow.logic.exportAvailable} for how the first is
     * derived and why it is derived rather than published.
     *
     * **Neither holds the chosen path**, and no field in this document ever
     * does: the path exists for the length of one `host.exportProvenance(path)`
     * call and is then gone (`docs/09` §2.2).
     */
    exportAvailable: false,
    exportMessage: null,
  },

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
     * **Deliberately still one condition.** `docs/08` §4.4's first write step is
     * "resolve target collection (create if 'New collection…')", and a new
     * collection needs a *name* this window had no way to collect — so the
     * obvious move was to add "and the target names something" to this gate.
     * That was tried and reverted: §4.2 states the gate as "disabled until ≥1
     * selected" and `test/unit/ui/searchDialog.test.ts` asserts exactly that in
     * two tests, and that file is **not** in `P1-T22`'s `Files` list. Changing
     * a documented gate to work around a missing control is the shape
     * `plan/README.md` §5 rule 6 forbids.
     *
     * The name is collected by §4.5's own affordance instead — the
     * `[ New collection… ]` button beside the picker, which
     * {@link RHSearchWindow.newCollection} now implements. Pressing Import while
     * the picker is on bare "New collection…" is refused on the privileged side
     * with a `warn`, which is a dead affordance and is reported with the card.
     *
     * @param {number} selectedCount
     * @returns {boolean}
     */
    importEnabled(selectedCount) {
      return Math.trunc(selectedCount) > 0;
    },

    /**
     * Whether the run the window is showing has a provenance record, read off
     * one published view state (FR-8's third scenario, P1-T45).
     *
     * **This is a derivation, and the card asked for a published field.**
     * `P1-T45` step 3 says the control is "revealed from view state the way the
     * Cancel button is", and the Cancel button reads
     * `SearchViewState.cancelVisible`, a boolean the view model publishes for
     * exactly that purpose. **There is no such field for the record**:
     * `SearchViewState` (`src/ui/viewModels/searchImportViewModel.ts`,
     * `interface SearchViewState`) declares thirteen members and none of them
     * is about the retained record, and that file is **not** in `P1-T45`'s
     * `Files` list, so adding one would be the scope `plan/README.md` §5 rule 2
     * forbids. The gap is reported with the card rather than closed quietly.
     *
     * **Why `notices` is the right proxy, measured rather than guessed.** In
     * the view model the retained record is assigned on the line immediately
     * after the `publish()` that fills `notices` with the import summary and
     * the abstract-coverage line (`renderImportOutcome`), and `notices` is
     * published **empty** at the start of every job (`runJob`) just as the
     * record is cleared at the start of every `runSearch` and `runImport`. So
     * the two move together, and `notices.length > 0` means "an import has
     * produced a write report for the run on screen", which is exactly when a
     * record exists.
     *
     * **The one divergence, and it is why the failure sentence covers
     * `no-record`.** A *refused* run clears the record without publishing a
     * state: `runImport` clears it before `resolveTarget` can refuse, and
     * `runJob` refuses a second concurrent run before its own `publish`. In
     * both cases the previous import's notices are still on screen, so the
     * control stays visible with nothing to export and the host answers
     * `no-record`. That is a sentence, never a blank element — see
     * {@link RHSearchWindow.exportProvenance}.
     *
     * @param {object} state - the view model's `SearchViewState`
     * @returns {boolean}
     */
    exportAvailable(state) {
      if (!state || !Array.isArray(state.notices)) {
        return false;
      }
      return state.notices.length > 0;
    },

    /**
     * The filename the chooser opens with (P1-T45).
     *
     * **Built from the clock and nothing else.** The obvious suggestion is the
     * keyword the user searched for, and it is forbidden for the reason
     * `EMPTY_HEADLINE_OMITTED` in `src/ui/viewModels/searchImportViewModel.ts`
     * records: a credential pasted into the keyword box would be drawn in a
     * file-save dialog, and from there into a filename on disk. The collection
     * name is user data for the same reason. So the only variable part is the
     * date.
     *
     * Digits and hyphens only — `toISOString()`'s time half carries colons,
     * which are not legal in a Windows filename and which `docs/13` §8's
     * three-OS QA would find.
     *
     * @param {number} nowEpochMs - epoch milliseconds, from the clock
     * @returns {string}
     */
    exportFileName(nowEpochMs) {
      const iso = new Date(nowEpochMs).toISOString();
      return "research-helper-provenance-" + iso.slice(0, 10) + ".json";
    },

    /**
     * Whether a target-picker value names a collection the import can write to.
     *
     * `"new"` on its own does not; `"new:My collection"` and a numeric
     * collection id do. The same parse runs on the privileged side
     * (`resolveTarget`), because a host driven directly must refuse what this
     * window refuses.
     *
     * @param {unknown} value
     * @returns {boolean}
     */
    targetNamed(value) {
      if (typeof value !== "string" || value === "") {
        return false;
      }
      if (value === "new") {
        return false;
      }
      if (value.startsWith("new:")) {
        return value.slice(4).trim() !== "";
      }
      return true;
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

    // -----------------------------------------------------------------------
    // 1b. The result table (P1-T21) — docs/08 §4.2's columns, §4.3's widget
    // -----------------------------------------------------------------------

    /**
     * `docs/08` §4.2's column set, in §4.2's order: ☑ / Title / Authors / Year
     * / Source / Type / DOI.
     *
     * `captioned` is false for the first column only: its `<th>` holds the
     * select-all checkbox §4.2 puts in the header, and
     * `research-helper-search-col-select` is an `.aria-label` the document
     * resolves on that checkbox. The other six are `.label` entries — the
     * shape §4.3's `VirtualizedTable` column prop takes — and an `<html:th>`
     * draws `textContent`, not `label`, so {@link
     * RHSearchWindow.applyColumnLabels} resolves them in script. Putting a
     * `data-l10n-id` on those `<th>`s instead would set an attribute nothing
     * renders, which is the second defect `P1-T20` measured in a live window.
     */
    columns: [
      {
        id: "rh-results-col-select",
        messageId: "research-helper-search-col-select",
        captioned: false,
      },
      {
        id: "rh-results-col-title",
        messageId: "research-helper-search-col-title",
        captioned: true,
      },
      {
        id: "rh-results-col-authors",
        messageId: "research-helper-search-col-authors",
        captioned: true,
      },
      {
        id: "rh-results-col-year",
        messageId: "research-helper-search-col-year",
        captioned: true,
      },
      {
        id: "rh-results-col-source",
        messageId: "research-helper-search-col-source",
        captioned: true,
      },
      {
        id: "rh-results-col-type",
        messageId: "research-helper-search-col-type",
        captioned: true,
      },
      {
        id: "rh-results-col-doi",
        messageId: "research-helper-search-col-doi",
        captioned: true,
      },
    ],

    /**
     * One author's display name. `docs/08` §4.5 draws family names.
     *
     * Accepts `docs/07` §4's `Author` or a bare string, because the host
     * formats the view model and a source that only ever had a literal name
     * must still render.
     *
     * @param {object|string} author
     * @returns {string}
     */
    authorName(author) {
      if (typeof author === "string") {
        return author.trim();
      }
      const value = author || {};
      if (typeof value.literal === "string" && value.literal.trim() !== "") {
        return value.literal.trim();
      }
      if (typeof value.family === "string" && value.family.trim() !== "") {
        return value.family.trim();
      }
      return "";
    },

    /**
     * `docs/08` §4.5's "Kim, Park, Novak +5", split into the two halves the
     * bundle's one message takes.
     *
     * The caller never concatenates the overflow onto the names — NFR-11
     * forbids it and `research-helper-search-authors-overflow` exists so the
     * `+{ $count }` can move anywhere in a translation.
     *
     * @param {Array<object|string>} authors
     * @param {number} shown - {@link RHSearchWindow.spec.authorNamesShown}
     * @returns {{names: string, overflow: number}}
     */
    authorSummary(authors, shown) {
      const names = (authors || [])
        .map((author) => this.authorName(author))
        .filter((name) => name !== "");
      const cap = Math.max(1, Math.trunc(shown));
      return {
        names: names.slice(0, cap).join(", "),
        overflow: Math.max(0, names.length - cap),
      };
    },

    /**
     * The Year cell's text.
     *
     * Written straight into `textContent`, never through Fluent, so no
     * `Intl.NumberFormat` ever sees it — which is the whole reason the year
     * span passes strings (`applyYearRange`). A year is a numeral, not a
     * translatable string (`docs/08` §10.3).
     *
     * @param {unknown} year
     * @returns {string}
     */
    yearText(year) {
      if (typeof year === "number" && Number.isFinite(year)) {
        return String(Math.trunc(year));
      }
      if (typeof year === "string" && year.trim() !== "") {
        return year.trim();
      }
      return "";
    },

    /**
     * The key a row's selection is held under.
     *
     * The host's own key when it has one — `docs/07` §5.1's `workKey` is what
     * `P1-T22` will pass — and an arrival-ordinal otherwise. Either way it is
     * **stable for the life of the result set and independent of the filter**,
     * which is what makes the selection survive filtering.
     *
     * @param {object} record
     * @param {number} index - position in the arrival order
     * @returns {string}
     */
    rowKey(record, index) {
      const key = record && record.key;
      if (typeof key === "string" && key.trim() !== "") {
        return key.trim();
      }
      return "rh-row-" + String(index);
    },

    /**
     * Build one display row per record, in arrival order.
     *
     * A duplicate key from the host falls back to the arrival-ordinal form:
     * two rows sharing a key would share a checkbox, and FR-5's "unchecking 5
     * of 40 imports exactly 35" would quietly become 34.
     *
     * The fields the host supplies are the view model's, all of them already
     * localized where they are words rather than data — `sourceLabels` and
     * `typeLabel` especially. That is the en-US bundle's own rule for the
     * literature-source display names: "the view model formats those and hands
     * this document an already localized string". This file mints no word for
     * either, and `existing` is `P1-T13`'s `LibraryIndex.findExisting` result
     * reduced to a boolean by the host.
     *
     * @param {object[]} records
     * @param {number} authorNamesShown
     * @returns {object[]}
     */
    rowsFromRecords(records, authorNamesShown) {
      const seen = new Set();
      return (records || []).map((record, index) => {
        const source = record || {};
        const candidate = this.rowKey(source, index);
        const key = seen.has(candidate) ? "rh-row-" + String(index) : candidate;
        seen.add(key);

        const authors = this.authorSummary(source.authors, authorNamesShown);
        const sourceLabels = Array.isArray(source.sourceLabels)
          ? source.sourceLabels.filter(
              (label) => typeof label === "string" && label.trim() !== "",
            )
          : typeof source.sourceLabel === "string" && source.sourceLabel !== ""
            ? [source.sourceLabel]
            : [];
        const row = {
          key,
          title: typeof source.title === "string" ? source.title : "",
          authorNames: authors.names,
          authorOverflow: authors.overflow,
          year: this.yearText(source.year),
          sourceLabels,
          typeLabel:
            typeof source.typeLabel === "string" ? source.typeLabel : "",
          doi: typeof source.doi === "string" ? source.doi : "",
          existing: Boolean(source.existing),
        };
        row.filterText = this.filterText(row);
        return row;
      });
    },

    /**
     * The text the client-side filter matches against: every column the table
     * shows.
     *
     * **`docs/08` §4.2 names no field list**, only "a client-side filter over
     * already-fetched results"; matching exactly what the user can read is the
     * reading that cannot surprise them, and the under-specification is
     * reported with the card rather than narrowed here.
     *
     * @param {object} row
     * @returns {string}
     */
    filterText(row) {
      return [
        row.title,
        row.authorNames,
        row.year,
        ...row.sourceLabels,
        row.typeLabel,
        row.doi,
      ]
        .filter((part) => typeof part === "string" && part !== "")
        .join("\n")
        .toLowerCase();
    },

    /**
     * @param {object} row
     * @param {string} needle
     * @returns {boolean}
     */
    matchesFilter(row, needle) {
      const query = String(needle === undefined ? "" : needle)
        .trim()
        .toLowerCase();
      if (query === "") {
        return true;
      }
      return row.filterText.includes(query);
    },

    /**
     * The rows the table draws, given the filter box and the hide-existing
     * checkbox.
     *
     * Both filters are **client-side over the already-fetched set** (§4.2's
     * requirement and this card's `Do NOT`): nothing here issues a request, and
     * nothing here drops a row from `rows`, so every hidden row comes back
     * unchanged when the filter is cleared or the checkbox is unticked. That is
     * what makes hiding reversible "without re-running the search".
     *
     * @param {object[]} rows
     * @param {{filter: string, hideExisting: boolean}} view
     * @returns {object[]}
     */
    visibleRows(rows, view) {
      const filter = (view && view.filter) || "";
      const hideExisting = Boolean(view && view.hideExisting);
      return (rows || []).filter(
        (row) =>
          (!hideExisting || !row.existing) && this.matchesFilter(row, filter),
      );
    },

    // --- The selection model -----------------------------------------------
    //
    // Read this before changing anything above or below it.
    //
    // **Selection is keyed on the row key and held over the WHOLE fetched
    // set.** It is never a list of indices and never a subset of the visible
    // rows. Three consequences, each asserted in
    // `test/unit/ui/searchDialog.test.ts` and in
    // `test/integration/searchDialog-table.spec.ts`:
    //
    // 1. **Changing the filter does not change the selection at all.** A row
    //    hidden while selected is still selected when it comes back. Nothing
    //    in `applyFilter()` writes to `state.selection`.
    // 2. **Select all / none / invert act on the visible rows only**, and
    //    leave every hidden row's state exactly as it was. "Select all" can
    //    therefore never select a row the user cannot see — the defect this
    //    is written against.
    // 3. **Every count the user reads, and the set Import receives, is the
    //    intersection of the selection with the visible rows.** So a hidden
    //    row is never imported either, in the other direction. What the table
    //    shows and what Import does are the same set, by construction.
    //
    // FR-5's arithmetic rides on 3: 40 rows arrive all selected, unchecking 5
    // leaves 35 visible-and-selected, and that is the count on the Import
    // button and the length of the list handed to the host.

    /**
     * FR-5: "all rows are checked by default", on every new result set.
     *
     * Including a row the hide-existing checkbox is about to hide: the
     * duplicate-policy radio (`docs/08` §4.4, §4.5) is what decides what
     * happens to an already-present record, so unticking the checkbox reveals
     * those rows already checked rather than silently deselected.
     *
     * @param {object[]} rows
     * @returns {string[]}
     */
    selectionAfterResults(rows) {
      return (rows || []).map((row) => row.key);
    },

    /**
     * Apply one selection command to the visible keys, leaving every other key
     * untouched.
     *
     * @param {string[]} selectedKeys - the whole current selection
     * @param {string[]} visibleKeys - the keys the filter leaves showing
     * @param {"all"|"none"|"invert"} command
     * @returns {string[]} the new whole selection
     */
    applySelection(selectedKeys, visibleKeys, command) {
      const selected = new Set(selectedKeys || []);
      for (const key of visibleKeys || []) {
        if (command === "all") {
          selected.add(key);
        } else if (command === "none") {
          selected.delete(key);
        } else if (command === "invert") {
          if (selected.has(key)) {
            selected.delete(key);
          } else {
            selected.add(key);
          }
        }
      }
      return [...selected];
    },

    /**
     * The keys Import acts on: selected **and** visible, in arrival order.
     *
     * @param {object[]} visibleRows
     * @param {string[]} selectedKeys
     * @returns {string[]}
     */
    pickedKeys(visibleRows, selectedKeys) {
      const selected = new Set(selectedKeys || []);
      return (visibleRows || [])
        .filter((row) => selected.has(row.key))
        .map((row) => row.key);
    },

    /**
     * The three numbers the window shows, all of them about the visible rows.
     *
     * `total` and `new` feed `research-helper-search-result-count`, which sits
     * beside the filter box in `docs/08` §4.5 — so it describes the rows the
     * table is showing rather than the fetched set, because a count next to a
     * table that disagrees with the table is worse than no count. §4.2 does
     * not say which, and that is reported with the card.
     *
     * @param {object[]} visibleRows
     * @param {string[]} selectedKeys
     * @returns {{total: number, new: number, selected: number}}
     */
    visibleCounts(visibleRows, selectedKeys) {
      const selected = new Set(selectedKeys || []);
      const rows = visibleRows || [];
      let picked = 0;
      let fresh = 0;
      for (const row of rows) {
        if (selected.has(row.key)) {
          picked += 1;
        }
        if (!row.existing) {
          fresh += 1;
        }
      }
      return { total: rows.length, new: fresh, selected: picked };
    },

    /**
     * Whether the header checkbox draws as checked: every visible row
     * selected, and at least one visible row.
     *
     * @param {object[]} visibleRows
     * @param {string[]} selectedKeys
     * @returns {boolean}
     */
    allVisibleSelected(visibleRows, selectedKeys) {
      const rows = visibleRows || [];
      if (rows.length === 0) {
        return false;
      }
      const selected = new Set(selectedKeys || []);
      return rows.every((row) => selected.has(row.key));
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

    // Before every other Fluent call: see `spec.mainWindowFtl`.
    this.addMainWindowBundle();

    this.applyChromeStrings();
    this.applyColumnLabels();
    this.seedControls();
    this.renderDatabaseRow();
    this.renderCollections();
    // Before bindEvents, so the notice area and the details disclosure exist
    // before anything can be clicked, and before connectHost, so the first
    // state the host publishes has somewhere to land.
    this.buildNoticeArea();
    this.buildDetailsDisclosure();
    this.bindEvents();
    this.connectHost();
    // An empty table, its header captions in place and its counts at zero, so
    // no element is ever left with a `data-l10n-id` and no arguments.
    this.applyFilter();
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
   * Link `research-helper-mainWindow.ftl` into this document.
   *
   * See {@link RHSearchWindow.spec.ftl} for why the window needs a
   * second bundle and why the link is made here rather than in the markup.
   *
   * Guarded rather than assumed: `addResourceIds` is `Localization`'s, which
   * `DOMLocalization` extends, and nothing in the corpus had called it before
   * this card. A build where it is absent renders the §8.3 rows as empty
   * elements — visible, and loud in the integration spec, rather than a silent
   * English fallback.
   *
   * @returns {boolean} whether the resource was added
   */
  addMainWindowBundle() {
    const l10n = document.l10n;
    if (!l10n || typeof l10n.addResourceIds !== "function") {
      return false;
    }
    try {
      l10n.addResourceIds([this.spec.ftl.mainWindow]);
      return true;
    } catch (error) {
      try {
        Zotero.debug(
          "[research-helper] could not add the main-window Fluent bundle to " +
            "the search window: " +
            String(error && error.name ? error.name : error),
        );
      } catch {
        /* a diagnostic that cannot be written is not worth a second failure */
      }
      return false;
    }
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

    // docs/08 §4.2's client-side filter. `input` and not `change`, so the rows
    // narrow as the user types; nothing here issues a request.
    this.on(this.spec.filter, "input", () => this.applyFilter());
    // A XUL <checkbox> reports through `command`. Toggling it only re-filters:
    // the hidden rows stay in `state.rows` and come straight back.
    this.on(this.spec.hideExisting, "command", () => this.applyFilter());

    this.on(this.spec.selectAll, "command", () => this.selectVisible("all"));
    this.on(this.spec.selectNone, "command", () => this.selectVisible("none"));
    this.on(this.spec.selectInvert, "command", () =>
      this.selectVisible("invert"),
    );
    // An <html:input type="checkbox"> reports through `change`, not `command`.
    this.on(this.spec.selectAllBox, "change", () =>
      this.selectVisible(this.checked(this.spec.selectAllBox) ? "all" : "none"),
    );
    this.on(this.spec.resultsBody, "keydown", (event) =>
      this.onTableKeydown(event),
    );

    this.on(this.spec.run, "command", () => this.search());
    this.on(this.spec.cancel, "command", () => this.cancel());
    // FR-8's third scenario. `settle` for the same reason `search()` and
    // `import()` use it: an unhandled rejection in a chrome window is silent.
    this.on(this.spec.exportProvenance, "command", () =>
      this.settle(this.exportProvenance()),
    );
    this.on(this.spec.targetNew, "command", () => this.newCollection());
    this.on(this.spec.targetNewItem, "command", () => this.newCollection());
    this.on(this.spec.yearsFrom, "command", () => this.onYearChanged());
    this.on(this.spec.yearsTo, "command", () => this.onYearChanged());

    // docs/08 §4.6's two actions on the all-failed panel.
    this.on(this.spec.errorRetry, "command", () => this.search());
    this.on(this.spec.errorPreferences, "command", () =>
      this.openPreferences(),
    );

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

    // FR-56 in miniature: the host holds a reference to this document's render
    // function, so a closed window must hand it back or the privileged side
    // keeps painting into a dead document.
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("unload", () => this.disconnectHost(), {
        once: true,
      });
    }
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
  // 3a. The host, and the one method that draws a whole view state (P1-T22)
  // =========================================================================

  /**
   * Attach this document to the privileged side, so the host can drive it.
   *
   * Before this card the host contract was push-only — `runSearch(query)` went
   * out and nothing came back — so a search could start and the window could
   * never learn what happened. `connect(view)` closes the loop: the host keeps
   * the view, publishes a whole {@link RHSearchWindow.render} state on every
   * change, and returns the detach function this document's `unload` calls.
   *
   * `document.l10n` goes with it. The view model needs exactly two strings as
   * *text* rather than as ids — the database names the Source column writes into
   * `textContent`, and the completion toast's message — and this window's own
   * `DOMLocalization` is the formatter that already has the bundle attached.
   * Everything else crosses as a message id plus arguments.
   *
   * A host with no `connect` is left alone and the window stays on whatever
   * panel `init()` chose, which is the honest outcome for a build where nothing
   * is wired: `search()` makes the same check about `runSearch`.
   */
  connectHost() {
    if (typeof this.host.connect !== "function") {
      return;
    }
    const detach = this.host.connect({
      render: (state) => this.render(state),
      formatter: document.l10n || undefined,
    });
    this.state.disconnect = typeof detach === "function" ? detach : null;
  },

  /** Release the host subscription. Called from `unload`. */
  disconnectHost() {
    const detach = this.state.disconnect;
    this.state.disconnect = null;
    if (typeof detach === "function") {
      detach();
    }
  },

  /**
   * Draw one whole view state — the only entry point the host uses.
   *
   * A whole state rather than a stream of deltas, because a late snapshot must
   * not be able to resurrect a panel the run has already left: the last state
   * published wins, field by field, and there is no merge for this document to
   * get wrong.
   *
   * @param {object} state - the view model's `SearchViewState`
   */
  render(state) {
    if (!state) {
      return;
    }
    this.state.running = Boolean(state.running);

    // The table, only when the result set actually changed — see
    // `state.appliedRecordsRevision`.
    if (
      typeof state.recordsRevision === "number" &&
      state.recordsRevision !== this.state.appliedRecordsRevision
    ) {
      this.state.appliedRecordsRevision = state.recordsRevision;
      this.setResults(state.records || []);
    }

    this.renderSourceStatus(state.sources || []);
    this.renderMessageList(
      this.spec.built.warningList,
      state.warnings || [],
      "rh-inline-warning",
    );
    this.renderMessageList(
      this.spec.built.noticeList,
      state.notices || [],
      "rh-hint",
    );
    this.renderEmptyPanel(state.emptyHeadline);
    this.renderErrorPanel(state.error);
    this.renderStatusBar(state);

    // Last: `setResults()` shows the results panel when it has rows, and the
    // view model — not this document — decides which of docs/08 §8.4's five
    // states is current.
    this.showPanel(state.panel || "initial");
    this.refreshImportGate();
  },

  /**
   * `docs/08` §4.6's per-database status list.
   *
   * One row per source, **never one spinner**: §4.6's own reason is that
   * "partial failure across seven sources is the *normal* case, and collapsing
   * it into one spinner hides the fact that a whole database was missed", and
   * this card's **Do NOT** repeats it. The name and the state are two separate
   * elements, each carrying its own Fluent id, so the row is never assembled
   * from a name plus a fragment (`docs/08` §10.3).
   *
   * @param {object[]} lines - the view model's `SourceStatusLine[]`
   */
  renderSourceStatus(lines) {
    const host = this.el(this.spec.sourceStatus);
    if (!host) {
      return;
    }
    this.clear(host);
    for (const line of lines) {
      const row = this.createXUL("hbox");
      row.id = this.spec.sourceStatus + "-" + String(line.sourceId);
      // No class on the row or the name: `P1-T21` established that "a class
      // name with no rule behind it is dead weight", and
      // `addon/content/style/searchDialog.css` is `P1-T20`'s file and not in
      // this card's `Files` list, so there is no rule to point at. The outcome
      // travels as a data attribute instead, which is both the selector a
      // stylesheet would use and what the integration spec reads.
      row.setAttribute("data-rh-outcome", String(line.outcome));

      const name = this.createXUL("description");
      if (line.nameId) {
        name.setAttribute("data-l10n-id", line.nameId);
      }
      row.appendChild(name);

      const detail = this.createXUL("description");
      // NFR-13: a failed row carries the stylesheet's ⚠ glyph *and* its colour
      // *and* the words of the §8.3 row, never colour alone.
      detail.className =
        line.outcome === "failed" ? "rh-inline-warning" : "rh-hint";
      this.applyRef(detail, line.detail);
      row.appendChild(detail);

      host.appendChild(row);
    }
  },

  /**
   * Fill one notice list from a list of message references.
   *
   * @param {string} id - {@link RHSearchWindow.spec.warningList} or `noticeList`
   * @param {object[]} refs - `{ id, args }` objects
   * @param {string} className
   */
  renderMessageList(id, refs, className) {
    const host = this.el(id);
    if (!host) {
      return;
    }
    this.clear(host);
    host.hidden = refs.length === 0;
    for (const ref of refs) {
      const line = this.createXUL("description");
      line.className = className;
      this.applyRef(line, ref);
      host.appendChild(line);
    }
  },

  /**
   * `docs/08` §4.6's EMPTY headline.
   *
   * **The view model always passes nothing**, and that is a decision rather than
   * an omission: `research-helper-search-state-empty` interpolates the user's
   * query verbatim, and a credential pasted into the keyword box would be drawn
   * in the window. The full argument, including why redaction does not fix it,
   * is `EMPTY_HEADLINE_OMITTED` in
   * `src/ui/viewModels/searchImportViewModel.ts`. The panel's second line —
   * `research-helper-search-state-empty-suggestions`, which takes no arguments —
   * is in the markup and renders either way, so §8.4's "concrete suggestions"
   * half is intact.
   *
   * @param {object} [ref]
   */
  renderEmptyPanel(ref) {
    const element = this.el(this.spec.emptyHeadline);
    if (!element) {
      return;
    }
    if (ref && ref.id) {
      this.applyRef(element, ref);
      element.hidden = false;
      return;
    }
    this.clearRef(element);
    element.hidden = true;
  },

  /**
   * `docs/08` §4.6's "All databases failed" panel, with §8.3's rows and NFR-14's
   * disclosure.
   *
   * The primary text is never a stack trace and never the provider's own message
   * (`docs/07` §10.2); the disclosure carries the machine code and the HTTP
   * status and nothing else, which is `ERROR_DETAIL_FIELDS`' reasoning.
   *
   * @param {object} [error] - the view model's `ErrorView`
   */
  renderErrorPanel(error) {
    const headline = this.el(this.spec.errorHeadline);
    if (headline && error && error.headline) {
      this.applyRef(headline, error.headline);
    }

    this.renderMessageList(
      this.spec.built.errorLines,
      (error && error.lines ? error.lines : []).map((line) => line.detail),
      "rh-inline-warning",
    );

    const list = this.el(this.spec.built.errorDetailsList);
    const toggle = this.el(this.spec.built.errorDetailsToggle);
    const details = (error && error.details) || [];
    if (list) {
      this.clear(list);
      for (const value of details) {
        const line = this.createXUL("description");
        line.className = "rh-hint";
        // A machine code or an HTTP status: data, not a translatable string,
        // and the only two fields of a SerializedError that cannot carry a key.
        line.textContent = String(value);
        list.appendChild(line);
      }
      list.hidden = !this.state.detailsOpen || details.length === 0;
    }
    if (toggle) {
      toggle.hidden = details.length === 0;
      toggle.setAttribute(
        "data-l10n-id",
        this.state.detailsOpen ? this.l10n.detailsHide : this.l10n.detailsShow,
      );
      toggle.setAttribute(
        "aria-expanded",
        this.state.detailsOpen ? "true" : "false",
      );
    }

    const retry = this.el(this.spec.errorRetry);
    if (retry) {
      retry.hidden = !(error && error.retry);
    }
    const prefs = this.el(this.spec.errorPreferences);
    if (prefs) {
      prefs.hidden = !(error && error.openPreferences);
    }
  },

  /**
   * The status bar — `docs/08` §4.4: progress lives here "because we need a
   * Cancel button".
   *
   * @param {object} state
   */
  renderStatusBar(state) {
    const progress = this.el(this.spec.progress);
    if (progress) {
      const percent = state.progressPercent;
      if (typeof percent === "number") {
        progress.hidden = false;
        progress.value = percent;
      } else {
        progress.hidden = true;
      }
    }
    const status = this.el(this.spec.status);
    if (status) {
      if (state.status && state.status.id) {
        this.applyRef(status, state.status);
      } else {
        this.clearRef(status);
      }
    }
    // docs/08 §4.5's "5 of 7 databases", beside the bar. Its own element, so the
    // two live messages in the status bar do not overwrite each other.
    const databases = this.el(this.spec.built.databaseProgress);
    if (databases) {
      if (state.databaseProgress && state.databaseProgress.id) {
        this.applyRef(databases, state.databaseProgress);
        databases.hidden = false;
      } else {
        this.clearRef(databases);
        databases.hidden = true;
      }
    }
    const cancel = this.el(this.spec.cancel);
    if (cancel) {
      cancel.hidden = !state.cancelVisible;
    }
    this.renderExportControl(state);
  },

  /**
   * FR-8's third scenario: the export control and its outcome sentence
   * (P1-T45).
   *
   * Hidden until the run on screen has a record, revealed when it does, and the
   * sentence is dropped the moment the control goes away — a "Provenance record
   * exported." left standing beside the next run's table would be describing a
   * run the window no longer shows.
   *
   * @param {object} state - the view model's `SearchViewState`
   */
  renderExportControl(state) {
    const available = this.logic.exportAvailable(state);
    if (!available && this.state.exportAvailable) {
      // A new run replaced what can be exported, so the previous run's outcome
      // sentence stops being true.
      this.state.exportMessage = null;
    }
    this.state.exportAvailable = available;

    const button = this.el(this.spec.exportProvenance);
    if (button) {
      button.hidden = !available;
    }
    const message = this.el(this.spec.exportStatus);
    if (message) {
      const id = available ? this.state.exportMessage : null;
      if (id) {
        this.applyRef(message, { id: id });
        message.hidden = false;
      } else {
        // `clearRef` and not just `hidden`: `DOMLocalization` does not undo its
        // own writes, so removing the id alone would leave the old sentence in
        // `textContent` for the next reveal to show.
        this.clearRef(message);
        message.hidden = true;
      }
    }
  },

  /**
   * Point an element at one message reference, id and arguments together.
   *
   * Together and never separately, for the reason {@link applyYearRange}
   * records: Fluent re-translates on either mutation, and a translation that
   * arrives without its variables both logs an l10n error and paints
   * `{ $count }` at the user.
   *
   * @param {object} element
   * @param {object} ref - `{ id, args }`
   */
  applyRef(element, ref) {
    if (!element || !ref || !ref.id) {
      return;
    }
    if (ref.args) {
      element.setAttribute("data-l10n-args", JSON.stringify(ref.args));
    } else {
      element.removeAttribute("data-l10n-args");
    }
    element.setAttribute("data-l10n-id", ref.id);
  },

  /**
   * Unpoint an element, and clear what Fluent last wrote into it.
   *
   * Removing `data-l10n-id` alone leaves the previous translation standing —
   * `DOMLocalization` does not undo its own writes — so the text goes too.
   *
   * @param {object} element
   */
  clearRef(element) {
    if (!element) {
      return;
    }
    element.removeAttribute("data-l10n-id");
    element.removeAttribute("data-l10n-args");
    element.textContent = "";
  },

  /**
   * Build FR-9's non-blocking notice region, once.
   *
   * See {@link RHSearchWindow.spec.notices} for why it is built here rather than
   * written into `P1-T20`'s markup, and why it sits outside the panel area.
   */
  buildNoticeArea() {
    if (this.el(this.spec.built.notices)) {
      return;
    }
    const bar = this.el(this.spec.statusBar);
    if (!bar || !bar.parentNode) {
      return;
    }

    // §4.5's "5 of 7 databases", inside the status bar and after the status
    // line, which is where the wireframe draws it.
    const databases = this.createXUL("description");
    databases.id = this.spec.built.databaseProgress;
    databases.className = "rh-hint";
    databases.setAttribute("role", "status");
    databases.hidden = true;
    const status = this.el(this.spec.status);
    if (status && status.parentNode === bar && status.nextSibling) {
      bar.insertBefore(databases, status.nextSibling);
    } else {
      bar.appendChild(databases);
    }
    const box = this.createXUL("vbox");
    box.id = this.spec.built.notices;

    // role="alert" for the warning half: docs/08 §8.1 puts a recoverable error
    // inside a window in an "inline banner in that window, role='alert'".
    const warnings = this.createXUL("vbox");
    warnings.id = this.spec.built.warningList;
    warnings.setAttribute("role", "alert");
    warnings.hidden = true;
    box.appendChild(warnings);

    // role="status" for the outcome half: a completion summary is information,
    // not an interruption, so it is announced politely (§9).
    const notices = this.createXUL("vbox");
    notices.id = this.spec.built.noticeList;
    notices.setAttribute("role", "status");
    notices.setAttribute("aria-live", "polite");
    notices.hidden = true;
    box.appendChild(notices);

    bar.parentNode.insertBefore(box, bar);
  },

  /**
   * Build the per-source error lines and NFR-14's details disclosure, once.
   *
   * `#rh-state-error-detail` is an empty `<vbox>` in `P1-T20`'s markup, left
   * there for exactly this. The lines go *before* it so the panel reads
   * headline → per-source rows → disclosure → actions, which is §4.6's drawn
   * order.
   */
  buildDetailsDisclosure() {
    const detail = this.el(this.spec.errorDetail);
    if (!detail || this.el(this.spec.built.errorDetailsToggle)) {
      return;
    }

    const lines = this.createXUL("vbox");
    lines.id = this.spec.built.errorLines;
    lines.setAttribute("role", "status");
    lines.hidden = true;
    if (detail.parentNode) {
      detail.parentNode.insertBefore(lines, detail);
    }

    const toggle = this.createXUL("button");
    toggle.id = this.spec.built.errorDetailsToggle;
    toggle.hidden = true;
    toggle.setAttribute("aria-controls", this.spec.built.errorDetailsList);
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("data-l10n-id", this.l10n.detailsShow);
    toggle.addEventListener("command", () => this.toggleDetails());
    detail.appendChild(toggle);

    const list = this.createXUL("vbox");
    list.id = this.spec.built.errorDetailsList;
    list.hidden = true;
    detail.appendChild(list);
  },

  /** Expand or collapse NFR-14's details disclosure. */
  toggleDetails() {
    this.state.detailsOpen = !this.state.detailsOpen;
    const list = this.el(this.spec.built.errorDetailsList);
    const toggle = this.el(this.spec.built.errorDetailsToggle);
    if (list) {
      list.hidden = !this.state.detailsOpen || !list.firstChild;
    }
    if (toggle) {
      toggle.setAttribute(
        "data-l10n-id",
        this.state.detailsOpen ? this.l10n.detailsHide : this.l10n.detailsShow,
      );
      toggle.setAttribute(
        "aria-expanded",
        this.state.detailsOpen ? "true" : "false",
      );
    }
    return this.state.detailsOpen;
  },

  // =========================================================================
  // 3b. The result table — docs/08 §4.2's columns, §4.3's plain table (P1-T21)
  // =========================================================================

  /**
   * Resolve the six captioned column headers.
   *
   * Through `formatMessages` rather than `data-l10n-id`, because the bundle
   * carries each column as a `.label` — §4.3's `VirtualizedTable` column-prop
   * shape — and an `<html:th>` renders `textContent` and ignores `label`. Same
   * reason, and the same technique, as {@link applyChromeStrings}.
   *
   * @returns {Promise<void>|undefined}
   */
  applyColumnLabels() {
    const l10n = document.l10n;
    if (!l10n || typeof l10n.formatMessages !== "function") {
      return undefined;
    }
    const captioned = this.logic.columns.filter((column) => column.captioned);
    return l10n
      .formatMessages(captioned.map((column) => ({ id: column.messageId })))
      .then((messages) => {
        captioned.forEach((column, at) => {
          const cell = this.el(column.id);
          const label = this.attributeOf(messages[at], "label");
          if (cell && label !== undefined) {
            cell.textContent = label;
          }
        });
      });
  },

  /**
   * Hand the window a finished result set. FR-5's "a reviewable result list
   * before creating any Zotero item".
   *
   * Arrival order is kept, every row starts selected, and the results panel is
   * shown only when there is at least one row — with zero results `docs/08`
   * §4.6's EMPTY panel is the right surface and only the caller knows the query
   * and the year span that panel's message takes, so the panel is left alone
   * here. Called by `P1-T22`, which owns the search wiring.
   *
   * @param {object[]} records - the view model; see `logic.rowsFromRecords`
   * @returns {number} how many rows arrived
   */
  setResults(records) {
    this.state.results = Array.isArray(records) ? [...records] : [];
    this.state.rows = this.logic.rowsFromRecords(
      this.state.results,
      this.spec.authorNamesShown,
    );
    this.state.selection = this.logic.selectionAfterResults(this.state.rows);
    this.applyFilter();
    if (this.state.rows.length > 0) {
      this.showPanel("results");
    }
    return this.state.rows.length;
  },

  /**
   * Re-apply the filter box and the hide-existing checkbox, then redraw.
   *
   * **This method never writes to `state.selection`** — the one line that would
   * make a filter change the meaning of a selection. See the `logic` selection
   * block.
   *
   * @returns {{total: number, new: number, selected: number}}
   */
  applyFilter() {
    this.state.view = {
      filter: this.value(this.spec.filter) || "",
      hideExisting: this.checked(this.spec.hideExisting),
    };
    this.state.visible = this.logic.visibleRows(
      this.state.rows,
      this.state.view,
    );
    this.renderResults();
    return this.refreshSelection();
  },

  /** Rebuild the table body from `state.visible`. */
  renderResults() {
    const body = this.el(this.spec.resultsBody);
    if (!body) {
      return;
    }
    this.clear(body);
    this.state.visible.forEach((row, index) => {
      body.appendChild(this.buildRow(row, index));
    });
  },

  /**
   * One `<html:tr>`, in `docs/08` §4.2's column order.
   *
   * `docs/08` §4.3 requires an accessible string per row even for the plain
   * table, and §9 spells that out as "an accessible name on every row". The row
   * and its checkbox both `aria-labelledby` the title cell rather than
   * repeating the title into an attribute, so an already-present row's name is
   * the localized "Already in library: …" Fluent puts in that cell — no
   * concatenation, and nothing to go stale.
   *
   * @param {object} row
   * @param {number} index - position among the *visible* rows
   * @returns {object}
   */
  buildRow(row, index) {
    const classes = this.spec.rowClass;
    const titleId = this.spec.row.titleIdPrefix + String(index);

    const tr = this.createHTML("tr");
    tr.className = row.existing
      ? classes.row + " " + classes.existingRow
      : classes.row;
    tr.setAttribute(this.spec.row.keyAttribute, row.key);
    tr.setAttribute("aria-labelledby", titleId);

    // 1. ☑ — §9: Space toggles the row checkbox, which a native checkbox does
    // for free. No tabindex: it is focusable already.
    const selectCell = this.createHTML("td");
    selectCell.className = "rh-col-select";
    const box = this.createHTML("input");
    box.setAttribute("type", "checkbox");
    box.className = classes.select;
    box.setAttribute(this.spec.row.keyAttribute, row.key);
    box.setAttribute("aria-labelledby", titleId);
    box.checked = this.state.selection.includes(row.key);
    box.addEventListener("change", () =>
      this.toggleRow(row.key, Boolean(box.checked)),
    );
    selectCell.appendChild(box);
    tr.appendChild(selectCell);

    // 2. Title, with NFR-13's already-present marker: a ⚠ glyph and a colour
    // from the stylesheet AND the words, never the colour alone. The Fluent
    // message is set on a child `<span>`, not on the cell, because Fluent
    // assigns a value-only message to `textContent` and would otherwise remove
    // the badge beside it.
    const titleCell = this.createHTML("td");
    titleCell.id = titleId;
    titleCell.className = "rh-col-title";
    if (row.existing) {
      const badge = this.createHTML("span");
      badge.className = classes.badge;
      badge.setAttribute("role", "img");
      badge.setAttribute("data-l10n-id", this.l10n.rowExistingBadge);
      titleCell.appendChild(badge);
      // No class on this one: it is identified by the message it carries, and a
      // class name with no rule behind it is dead weight the spec rejects.
      const text = this.createHTML("span");
      // Id and arguments together, never separately — see applyYearRange.
      text.setAttribute("data-l10n-args", JSON.stringify({ title: row.title }));
      text.setAttribute("data-l10n-id", this.l10n.rowExisting);
      titleCell.appendChild(text);
    } else {
      // A paper's title is data, not a translatable string.
      titleCell.textContent = row.title;
    }
    tr.appendChild(titleCell);

    // 3. Authors — §4.5's "Kim, Park, Novak +5" as one message when it
    // overflows, so a translation can move the `+{ $count }`.
    const authorsCell = this.createHTML("td");
    authorsCell.className = "rh-col-authors";
    if (row.authorOverflow > 0) {
      authorsCell.setAttribute(
        "data-l10n-args",
        JSON.stringify({ names: row.authorNames, count: row.authorOverflow }),
      );
      authorsCell.setAttribute("data-l10n-id", this.l10n.authorsOverflow);
    } else {
      authorsCell.textContent = row.authorNames;
    }
    tr.appendChild(authorsCell);

    // 4. Year — plain text, so no Intl.NumberFormat and no `2,024`.
    const yearCell = this.createHTML("td");
    yearCell.className = "rh-col-year";
    yearCell.textContent = row.year;
    tr.appendChild(yearCell);

    // 5. Source — one line per contributing source, as §4.5 stacks "PubMed"
    // over "Crossref". Already-localized display names from the host.
    const sourceCell = this.createHTML("td");
    sourceCell.className = "rh-col-source";
    for (const label of row.sourceLabels) {
      const line = this.createHTML("div");
      line.className = classes.sourceLine;
      line.textContent = label;
      sourceCell.appendChild(line);
    }
    tr.appendChild(sourceCell);

    // 6. Type — likewise an already-localized label from the host. No bundle
    // declares a work-type vocabulary yet; that is reported with this card.
    const typeCell = this.createHTML("td");
    typeCell.className = "rh-col-type";
    typeCell.textContent = row.typeLabel;
    tr.appendChild(typeCell);

    // 7. DOI — not translated (docs/08 §10.3).
    const doiCell = this.createHTML("td");
    doiCell.className = "rh-col-doi";
    doiCell.textContent = row.doi;
    tr.appendChild(doiCell);

    return tr;
  },

  /**
   * Apply one of §4.5's three selection commands to the **visible** rows.
   *
   * @param {"all"|"none"|"invert"} command
   * @returns {{total: number, new: number, selected: number}}
   */
  selectVisible(command) {
    this.state.selection = this.logic.applySelection(
      this.state.selection,
      this.state.visible.map((row) => row.key),
      command,
    );
    this.syncRowCheckboxes();
    return this.refreshSelection();
  },

  /**
   * One row's checkbox changed.
   *
   * @param {string} key
   * @param {boolean} checked
   */
  toggleRow(key, checked) {
    this.state.selection = this.logic.applySelection(
      this.state.selection,
      [key],
      checked ? "all" : "none",
    );
    return this.refreshSelection();
  },

  /** Push `state.selection` back onto the drawn checkboxes, without redrawing. */
  syncRowCheckboxes() {
    const selected = new Set(this.state.selection);
    for (const box of this.rowCheckboxes()) {
      box.checked = selected.has(box.getAttribute(this.spec.row.keyAttribute));
    }
  },

  /** @returns {object[]} the drawn rows' checkboxes, in drawn order */
  rowCheckboxes() {
    const body = this.el(this.spec.resultsBody);
    const boxes = [];
    for (const tr of (body && body.children) || []) {
      const cell = tr.children && tr.children[0];
      const box = cell && cell.children && cell.children[0];
      if (box) {
        boxes.push(box);
      }
    }
    return boxes;
  },

  /**
   * Every number the window shows about the table, plus the Import gate.
   *
   * Counts go to Fluent as **numbers**, unlike the year span's `from` and `to`:
   * a grouping separator is correct in a quantity ("1,400 results" with seven
   * databases at `maxResults`) and was wrong only in a year, and `{ $count }`
   * is a plural selector in two of these messages, which a string would defeat.
   *
   * @returns {{total: number, new: number, selected: number}}
   */
  refreshSelection() {
    const counts = this.logic.visibleCounts(
      this.state.visible,
      this.state.selection,
    );
    this.state.selectedCount = counts.selected;

    const box = this.el(this.spec.selectAllBox);
    if (box) {
      box.checked = this.logic.allVisibleSelected(
        this.state.visible,
        this.state.selection,
      );
    }

    this.localize(
      this.spec.selectedCount,
      this.l10n.selectedCount,
      JSON.stringify({ count: counts.selected }),
    );

    const resultCount = this.el(this.spec.resultCount);
    if (resultCount) {
      resultCount.hidden = this.state.rows.length === 0;
      this.localize(
        this.spec.resultCount,
        this.l10n.resultCount,
        JSON.stringify({ total: counts.total, new: counts.new }),
      );
    }

    this.refreshImportGate();
    this.refreshImportLabel(counts.selected);
    return counts;
  },

  /**
   * The live count in the accept button's label — `docs/08` §4.5's
   * "[ Import 28 items ]".
   *
   * @param {number} count
   * @returns {Promise<void>|undefined}
   */
  refreshImportLabel(count) {
    const l10n = document.l10n;
    if (!l10n || typeof l10n.formatMessages !== "function") {
      return undefined;
    }
    // **Out-of-order resolution guard, and it is not theoretical.** Measured in
    // a live Zotero window on 2026-10-07: `formatMessages` is asynchronous and
    // every selection change calls this, so with 40 rows selected and then 5
    // unchecked the button read `Import 40 items` while 35 were selected — the
    // earlier request resolved last and overwrote the later one. The last
    // request wins by construction rather than by luck.
    this.state.importLabelCount = count;
    return l10n
      .formatMessages([{ id: this.l10n.import, args: { count } }])
      .then((messages) => {
        if (this.state.importLabelCount !== count) {
          return;
        }
        const dialog = this.el(this.spec.root);
        const label = this.attributeOf(messages[0], "label");
        if (dialog && label !== undefined) {
          dialog.setAttribute("buttonlabelaccept", label);
        }
      });
  },

  /**
   * `docs/08` §9's two table keyboard rules that a native checkbox does not
   * give for free: arrow keys move between rows, `Ctrl`/`Cmd`+`A` selects all.
   * `Space` is the checkbox's own.
   *
   * @param {object} event
   */
  onTableKeydown(event) {
    if (
      (event.ctrlKey || event.metaKey) &&
      String(event.key).toLowerCase() === "a"
    ) {
      event.preventDefault();
      this.selectVisible("all");
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const boxes = this.rowCheckboxes();
    const at = boxes.indexOf(event.target);
    if (at < 0) {
      return;
    }
    const next = boxes[event.key === "ArrowDown" ? at + 1 : at - 1];
    if (!next) {
      return;
    }
    event.preventDefault();
    if (typeof next.focus === "function") {
      next.focus();
    }
  },

  /**
   * The records Import acts on: selected **and** visible, in arrival order.
   *
   * @returns {object[]}
   */
  pickedRows() {
    const byKey = new Map();
    this.state.rows.forEach((row, at) => {
      byKey.set(row.key, this.state.results[at]);
    });
    return this.logic
      .pickedKeys(this.state.visible, this.state.selection)
      .map((key) => byKey.get(key))
      .filter((record) => record !== undefined);
  },

  // =========================================================================
  // 4. Actions
  // =========================================================================

  /**
   * Start a search, if the gate allows one.
   *
   * No request is made here. `docs/01` §8.3 requires every network call to run
   * in the privileged sandbox, so this hands the query to the host and the host
   * answers by publishing view states back through
   * {@link RHSearchWindow.render}.
   *
   * The returned promise is **not** awaited, and it is swallowed rather than
   * ignored: the host's `runSearch` resolves when the whole run has finished
   * rendering, which is tens of seconds away, and a rejection there must not
   * surface as an unhandled rejection in a document that has no `console`
   * (`docs/01` §2.3).
   */
  search() {
    if (!this.refreshSearchGate().enabled) {
      return;
    }
    if (typeof this.host.runSearch !== "function") {
      // Nothing is wired. Staying on the current panel is the honest outcome:
      // a "searching…" list that will never resolve would be a lie.
      return;
    }
    this.state.running = true;
    this.showPanel("searching");
    this.settle(this.host.runSearch(this.collectQuery()));
  },

  /**
   * Hand the picked rows to the host.
   *
   * What this document owns is **which** records go — `collectImportRequest()`,
   * i.e. the checked ∩ visible set — and that the target names a collection.
   * The item creation, the duplicate pass and the "Imported 37 · Linked 2 ·
   * Skipped 12" accounting come back as a view state.
   */
  import() {
    if (!this.logic.importEnabled(this.state.selectedCount)) {
      return;
    }
    if (typeof this.host.runImport === "function") {
      this.settle(this.host.runImport(this.collectImportRequest()));
    }
  },

  /**
   * FR-8's third scenario: choose a file, and write this run's provenance
   * record to it (P1-T45).
   *
   * **The chooser opens here and the path is handed inward**, which is
   * `P1-T36`'s measured decision rather than this card's preference:
   * `nsIFilePicker.init` needs a `BrowsingContext` (`docs/01`:436) and only a
   * window has one, the view model is built once at startup with no window, and
   * `eslint.config.js`'s `research-helper/zotero-global` rule does not exempt
   * `src/bootstrap/registerUI.ts`. All three were re-measured for this card and
   * all three hold.
   *
   * **The path lives for the length of this method.** It is a local `const`,
   * passed to the host and then gone: not stored on `state`, not logged at any
   * level, not put into the record, the note or the file. `docs/09` §2.2
   * (2026-10-08) is the rule, and a path carrying an account name is the reason.
   *
   * **A dismissed chooser shows nothing**, which is the one outcome with no
   * sentence (`P1-T45` step 4): `pickExportPath` returns `""` and this returns
   * without calling the host, so there is no outcome value to render and a user
   * who cancelled is not told what they just did.
   *
   * @returns {Promise<string>} the outcome the host reported, or `""` when the
   *   host was never called
   */
  async exportProvenance() {
    if (!this.state.exportAvailable) {
      // Not reachable from the control, which is hidden in this state. A host
      // driven directly still gets the refusal the view model makes.
      return "";
    }
    if (typeof this.host.exportProvenance !== "function") {
      return "";
    }
    const path = await this.pickExportPath();
    if (!path) {
      return "";
    }
    let outcome;
    try {
      outcome = await this.host.exportProvenance(path);
    } catch {
      // A rejection is a failed write from the user's side. Nothing about the
      // error is logged here, because the message could quote the path; the
      // view model logs the outcome without it.
      outcome = "failed";
    }
    this.showExportOutcome(outcome);
    return outcome;
  },

  /**
   * Draw one of {@link RHSearchWindow.l10n}'s two sentences for an export
   * outcome.
   *
   * `written` is the first; **every other value is the second**, including the
   * three a visible control is not supposed to be able to produce. That is
   * `P1-T45` step 5's "do not leave an empty element": `P1-T22` measured that
   * an unresolvable `data-l10n-id` leaves an element's text alone, which is how
   * seven surfaces once rendered blank, and an unmapped outcome falling through
   * to no id at all would do the same thing one layer earlier.
   *
   * @param {string} outcome - one of `ProvenanceExportOutcome`
   */
  showExportOutcome(outcome) {
    this.state.exportMessage =
      outcome === "written" ? this.l10n.exportWritten : this.l10n.exportFailed;
    const message = this.el(this.spec.exportStatus);
    if (!message) {
      return;
    }
    // Drawn here rather than waiting for the host's next state: the export
    // publishes no view state, so there is no render to wait for.
    this.applyRef(message, { id: this.state.exportMessage });
    message.hidden = false;
  },

  /**
   * Open the save dialog and return the chosen path, or `""`.
   *
   * Split from {@link RHSearchWindow.exportProvenance} for the reason
   * {@link RHSearchWindow.promptForCollectionName} is split from
   * {@link RHSearchWindow.newCollection}: a modal in an integration run blocks
   * until the suite times out, so the half that opens one must be replaceable
   * from a test.
   *
   * Every failure path returns `""`, which the caller treats as a dismissal —
   * a build where the module has moved shows no sentence rather than claiming a
   * write that did not happen.
   *
   * @returns {Promise<string>} an absolute path, or `""`
   */
  async pickExportPath() {
    try {
      const utils =
        typeof ChromeUtils === "undefined" ? undefined : ChromeUtils;
      if (!utils || typeof utils.importESModule !== "function") {
        return "";
      }
      const module = utils.importESModule(this.filePickerModule);
      const Picker = module ? module.FilePicker : undefined;
      if (typeof Picker !== "function") {
        return "";
      }
      const picker = new Picker();
      // The button's own label is the dialog's title, the way the "New
      // collection…" prompt reuses its button's label: a dedicated title string
      // would be a fourth id on `G-41` for one word of chrome.
      const title =
        this.labelOf(this.spec.exportProvenance) || document.title || "";
      // A window, not a BrowsingContext: Zotero's wrapper reads
      // `parentWindow.browsingContext` itself. See `filePickerModule`.
      picker.init(window, title, picker.modeSave);
      // "JSON" is a format name and is not translated (`docs/08` §10.3, the
      // rule that ships "DOI" verbatim in `ko-KR`).
      picker.appendFilter("JSON", "*.json");
      picker.defaultExtension = "json";
      picker.defaultString = this.logic.exportFileName(this.clock.now());
      const result = await picker.show();
      if (result !== picker.returnOK && result !== picker.returnReplace) {
        return "";
      }
      // A string, not an `nsIFile`: Zotero's wrapper converts it.
      return typeof picker.file === "string" ? picker.file : "";
    } catch {
      // Nothing is logged: a picker error message can quote the path the user
      // was typing. `docs/09` §2.2.
      return "";
    }
  },

  /**
   * Swallow a host promise's outcome, visibly.
   *
   * There is no `console` in this document (`docs/01` §2.3) and an unhandled
   * rejection in a chrome window is silent, so a failed host call goes to
   * `Zotero.debug` — the one diagnostic channel this window has.
   *
   * @param {unknown} promise
   */
  settle(promise) {
    if (!promise || typeof promise.then !== "function") {
      return;
    }
    promise.then(undefined, (error) => {
      try {
        Zotero.debug(
          "[research-helper] search window host call rejected: " +
            String(error && error.name ? error.name : error),
        );
      } catch {
        /* a diagnostic that cannot be written is not worth a second failure */
      }
    });
  },

  /**
   * `docs/08` §4.6's `[ Open Preferences… ]` action.
   *
   * **This plugin registers no preference pane yet** — grepped 2026-10-07:
   * nothing in `src/` calls `Zotero.PreferencePanes.register`, and
   * `src/hooks.ts` only *reads* `pluginPanes` as a teardown audit. So the button
   * opens Zotero's preferences window without selecting a pane of ours, which is
   * the closest thing to the §8.3 action that exists today and is reported with
   * the card. `Zotero.Utilities.Internal.openPreferences` is reached through a
   * `typeof` guard because this window has not verified that signature against a
   * running Zotero.
   */
  openPreferences() {
    try {
      const internal =
        Zotero && Zotero.Utilities && Zotero.Utilities.Internal
          ? Zotero.Utilities.Internal
          : undefined;
      if (internal && typeof internal.openPreferences === "function") {
        internal.openPreferences();
      }
    } catch (error) {
      try {
        Zotero.debug(
          "[research-helper] could not open Zotero preferences: " +
            String(error && error.name ? error.name : error),
        );
      } catch {
        /* see settle() */
      }
    }
  },

  /**
   * Everything the import pipeline needs, including the exact record list.
   *
   * `records` is {@link pickedRows} — selected **and** visible — so FR-5's
   * "unchecking 5 of 40 … creates exactly 35 items" is decided here, at the
   * window boundary, and a row the filter hides can never be imported.
   *
   * @returns {object}
   */
  collectImportRequest() {
    const request = this.collectQuery();
    request.records = this.pickedRows();
    return request;
  },

  /**
   * Cancel a running job. FR-5: Cancel performs zero database writes.
   *
   * `state.running` is cleared here rather than waiting for the host's next
   * state, so a second `Escape` closes the window even if the host is wedged
   * (`docs/08` §9's two-press contract).
   */
  cancel() {
    this.state.running = false;
    if (typeof this.host.cancel === "function") {
      this.host.cancel();
    }
  },

  /**
   * "New collection…" — ask for the name, then put it in the picker.
   *
   * `docs/08` §4.4's first write step is "resolve target collection (create if
   * 'New collection…')", and creating one needs a name. The name can only come
   * from the user: deriving it from the keyword box would write whatever is in
   * that box — a pasted API key included — into the Zotero database, where it
   * would persist for the life of the library. So this asks.
   *
   * **`Services.prompt` is permitted here and only here.** `docs/08` §8.1 bans
   * a modal "for anything the user did not just click"; the user just clicked
   * this button. The prompt's one string is
   * `research-helper-search-target-new`, which is already this button's own
   * label and is exactly the question — minting a prompt title and body would be
   * two new ids in `P1-T18`'s bundles, which are not in this card's `Files`
   * list. A dedicated string would read better and that is reported.
   *
   * The collection is **not created here**; the name goes into the picker and
   * `importWorks()` resolves or creates it inside the import's first
   * transaction, which is what keeps FR-10's "cancel creates no items" true.
   *
   * A build where `Services.prompt` is unavailable degrades to leaving the
   * picker alone, which leaves Import disabled rather than importing into a
   * collection nobody named. `host.createCollection` is still called when the
   * host offers one, so a privileged side that wants to own this flow can.
   */
  newCollection() {
    if (typeof this.host.createCollection === "function") {
      this.host.createCollection();
    }
    const label = this.promptForCollectionName();
    if (label) {
      this.adoptNewCollection(label);
    }
  },

  /**
   * Ask for a collection name. Returns the trimmed name, or `""`.
   *
   * Split from {@link newCollection} so the picker half can be driven from a
   * test without opening a modal — a modal in an integration run blocks until
   * the suite times out.
   *
   * @returns {string}
   */
  promptForCollectionName() {
    try {
      const services = typeof Services === "undefined" ? undefined : Services;
      if (!services || !services.prompt) {
        return "";
      }
      const title = document.title || "";
      const text = this.labelOf(this.spec.targetNewItem) || "";
      const result = { value: "" };
      const accepted = services.prompt.prompt(
        window,
        title,
        text,
        result,
        null,
        {},
      );
      return accepted && result.value ? String(result.value).trim() : "";
    } catch {
      return "";
    }
  },

  /**
   * Put a named new collection in the target picker and select it.
   *
   * The value is `new:<name>`, which both this document's
   * {@link RHSearchWindow.logic.targetNamed} and the privileged side's
   * `resolveTarget` parse. The label is the name as typed — a collection name is
   * user data, like a paper's title, and is not translated (`docs/08` §10.3).
   *
   * @param {string} name
   * @returns {string} the picker value that was selected
   */
  adoptNewCollection(name) {
    const trimmed = String(name === undefined ? "" : name).trim();
    if (trimmed === "") {
      return "";
    }
    const value = "new:" + trimmed;
    const list = this.el(this.spec.target);
    const popup = this.el(this.spec.targetPopup);
    if (popup) {
      const existing = [...(popup.children || [])].find(
        (item) => item.getAttribute("value") === value,
      );
      if (!existing) {
        const item = this.createXUL("menuitem");
        item.setAttribute("value", value);
        item.setAttribute("label", trimmed);
        popup.appendChild(item);
      }
    }
    if (list) {
      list.value = value;
    }
    this.refreshImportGate();
    return value;
  },

  /**
   * One element's `label` attribute, for the two places a XUL label is read
   * back rather than drawn.
   *
   * @param {string} id
   * @returns {string}
   */
  labelOf(id) {
    const element = this.el(id);
    const value = element ? element.getAttribute("label") : null;
    return value === null ? "" : value;
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

  /**
   * An **XHTML** element, by namespace and not by `createElement`.
   *
   * This is a XUL document, so `document.createElement("tr")` yields a XUL
   * element named `tr`, which is not a table row and lays out as nothing.
   * `docs/08` §4.3's plain-table decision needs real HTML table elements, so
   * every one of them goes through `createElementNS`.
   *
   * @param {string} name - an HTML local name
   */
  createHTML(name) {
    return typeof document.createElementNS === "function"
      ? document.createElementNS("http://www.w3.org/1999/xhtml", name)
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

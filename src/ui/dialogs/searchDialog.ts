/**
 * The Search & Import window's entry point (`docs/08` §4.1, `P1-T19`).
 *
 * The **module** is named for the surface and the **exported function** is
 * not: `docs/08` §4.1 heads its own code block `src/ui/dialogs/searchDialog.ts`
 * while the entry point stays `openSearchWindow`, because the surface is a
 * modeless singleton *window*, not a modal dialog (conflict `C3`, resolved
 * upstream 2026-09-09). `P1-T19`'s Notes say in as many words: do not "tidy"
 * either name into agreement with the other.
 *
 * `P1-T20` owns the document this opens — `addon/content/searchDialog.xhtml`,
 * its script and its stylesheet — and that card `modify`s this file to go with
 * it. **The document exists as of `P1-T20` (2026-10-06)**, so the probe in
 * `test/integration/menus.spec.ts` that printed `PENDING P1-T20` now resolves
 * with content and runs its real open/singleton assertions. Shipping it took
 * one change outside this card's `Files` list, reported with the card:
 * `zotero-plugin.config.ts`'s `build.assets` glob had to learn `.xhtml` and
 * `.css`, because until it did the build copied neither file and a `chrome://`
 * fetch for a missing file in a *registered* package returns an **empty
 * response** rather than an unknown-package error (`P1-T18`, measured) — so a
 * document that never shipped would have looked exactly like a document that
 * was never written.
 *
 * ### Why this takes the window rather than fetching one
 *
 * `docs/08` §4.1's sketch opens with `Zotero.getMainWindow()`. That cannot be
 * written here: `eslint.config.js`'s `research-helper/zotero-global` rule
 * (`docs/13` §2.1, `docs/07` §2.3) forbids the `Zotero` global outside
 * `src/zotero/**` and the three lifecycle files, and `research-helper/layering/ui`
 * forbids `src/ui/**` from importing `src/zotero/**` at all. So the host window
 * is a parameter.
 *
 * That is also the better behaviour, not merely the permitted one.
 * `Zotero.getMainWindow()` returns *a* main window — the most recently active
 * one — whereas `src/ui/menus/registerMenus.ts` passes the window that owns the
 * menu item the user actually clicked. With two main windows open, §4.1's shape
 * can raise the dialog over the wrong one.
 *
 * No `Zotero.*` here, and no DOM of its own: this file hands a URL, a window
 * name, a feature string and one argument object to the platform and gets a
 * window back.
 */

import { config } from "../../../package.json";

/**
 * The `mode` values `openSearchWindow` accepts (`docs/08` §4.2's "Search mode
 * chip" row, which fixes the set as "one per `mode` value `openSearchWindow`
 * accepts (§4.1)").
 *
 * **`keyword` since Phase 1, `rerun` since `P2-T17`** (FR-12: the collection
 * context menu's "Re-run This Search…" opens the window with `mode: "rerun"`
 * and the collection's id, and the document seeds itself from the
 * collection's stored provenance row). `related` and
 * `recommend-from-collection` are later cards'; they are named here because
 * the union is the documented surface of this function, and this file
 * registers no menu entry for either.
 */
export type SearchWindowMode =
  "keyword" | "related" | "recommend-from-collection" | "rerun";

/**
 * What the window receives as `window.arguments[0]` (`docs/08` §4.1:
 * `{ mode, seedItemID?, collectionID? }`).
 *
 * `collectionID` is this card's: it is how the collection context-menu entry
 * pre-selects the right-clicked collection as the import target. `seedItemID`
 * belongs to the item-context "Find Related Papers…" entry, which is a later
 * phase's.
 */
export interface SearchWindowArgs {
  readonly mode: SearchWindowMode;
  /** Pre-selected import target, as `Zotero.Collection.id`. */
  readonly collectionID?: number;
  /** Seed paper for `mode: "related"`, as `Zotero.Item.id`. */
  readonly seedItemID?: number;
}

/**
 * The one member of the opened window this module touches.
 *
 * Narrow on purpose: `WindowProxy` satisfies it, and so does a recording
 * double in a test, which is how `test/integration/menus.spec.ts` asserts the
 * URL, the window name, the features and the arguments without needing
 * `P1-T20`'s document to exist yet.
 */
export interface SearchWindowHandle {
  focus(): void;
}

/**
 * The one member of the *host* window this module calls.
 *
 * `_ZoteroTypes.MainWindow` extends `Window` and therefore satisfies this
 * structurally; `_ZoteroTypes` is a global type namespace, so naming it costs
 * no import and breaks no layering rule.
 */
export interface SearchWindowHost {
  openDialog(
    url?: string,
    name?: string,
    features?: string,
    ...extraArguments: unknown[]
  ): SearchWindowHandle | null;
}

/**
 * The document the window loads.
 *
 * **Hyphenated**, and derived from `config.addonRef` rather than written out.
 * `docs/08` §4.1 spells the namespace `chrome://researchhelper/content/`, which
 * was corrected on 2026-09-30 (`P1-T18`): `addon/bootstrap.js` registers
 * `["content", "__addonRef__", rootURI + "content/"]` and `addonRef` is
 * `research-helper`, so the live package name carries the hyphen. Deriving it
 * means a rename of `addonRef` cannot leave this string behind.
 */
export const SEARCH_WINDOW_URL = `chrome://${config.addonRef}/content/searchDialog.xhtml`;

/**
 * The window *name*, which is what makes the window a singleton: `openDialog`
 * with a name that is already open re-uses that window instead of creating a
 * second one (`docs/08` §4.1). This matters because a search takes tens of
 * seconds, and `P1-T19`'s **Do NOT** forbids a second window outright.
 */
export const SEARCH_WINDOW_NAME = "research-helper-search";

/**
 * The window's minimum size, written once.
 *
 * It appears in two places that cannot import each other —
 * {@link SEARCH_WINDOW_FEATURES}'s `minwidth=` / `minheight=`, which size the
 * *chrome window*, and `addon/content/style/searchDialog.css`'s `min-width` /
 * `min-height`, which size the *document* because XUL `width` / `height`
 * attributes have not been recognised since Firefox 115 (`docs/08` §4.1.1
 * requirement 1). This constant is the authority for both, and
 * `test/unit/ui/searchDialog.test.ts` reads the stylesheet off disk and asserts
 * the two agree, so a resize of one cannot leave the other behind.
 *
 * The pair is `docs/08` §4.1's, and `P1-T20`'s first "Done when" criterion
 * states it as the window opening "at ≥ 880×600".
 */
export const SEARCH_WINDOW_MIN_SIZE = { width: 880, height: 600 } as const;

/**
 * The element id `Zotero.UIProperties.registerRoot()` is called with inside the
 * document, from `docs/08` §4.1.1's own `init()` sample.
 *
 * Exported so the markup assertions have something to tie the document to;
 * omitting that call is what §4.1.1 and §9 both call "a real accessibility
 * defect", and the id is how a test can tell the call was made against the
 * dialog root rather than against whatever `getElementById` happened to return.
 */
export const SEARCH_WINDOW_ROOT_ID = "rh-search-dialog";

/** The keyword input §4.1.1's `init()` focuses on open. */
export const SEARCH_WINDOW_KEYWORD_ID = "rh-search-keyword";

/**
 * `docs/08` §4.1's feature string, verbatim.
 *
 * `dialog=no` plus the name above is what makes it modeless *and* singleton —
 * the user keeps browsing their library while a search runs. The `minwidth` /
 * `minheight` features size the chrome window; the *document* is sized with CSS
 * because XUL `width`/`height` attributes have not been recognised since
 * Firefox 115 (§4.1.1 requirement 1, `P1-T20`'s problem).
 */
export const SEARCH_WINDOW_FEATURES =
  "chrome,titlebar,toolbar,centerscreen,resizable,dialog=no," +
  `minwidth=${SEARCH_WINDOW_MIN_SIZE.width},` +
  `minheight=${SEARCH_WINDOW_MIN_SIZE.height}`;

// ---------------------------------------------------------------------------
// The document ↔ privileged-side contract (`P1-T22`)
// ---------------------------------------------------------------------------

/**
 * The property on `Zotero.<addonInstance>.api` the document reads its host off.
 *
 * `addon/content/searchDialog.js`'s `resolveHost()` looks for
 * `Zotero.__addonInstance__.api.searchWindow` and falls back to an empty object.
 * The name is written here as well so the publishing side and the reading side
 * cannot drift; the shape is {@link import("../viewModels/searchImportViewModel").SearchWindowHostApi}.
 *
 * **Nothing publishes it in the shipped build, and that is reported rather than
 * worked around.** Measured 2026-10-07: `src/addon.ts`'s constructor sets
 * `this.api = {}` and nothing writes to it afterwards (`grep -rn "\.api" src/`),
 * and `src/bootstrap/registerUI.ts`'s `registerUI()` — which *does* call
 * `installServices()` at startup — discards the `ServiceGraph` on purpose
 * ("deliberately **not** held anywhere"). So publishing the host needs an edit
 * to one of those two files, and **neither is in `P1-T22`'s `Files` list**
 * (`plan/README.md` §5 rule 2). Until that card lands, the host is installed by
 * `test/integration/searchDialog-flow.spec.ts`, which is where the end-to-end
 * run in this card's report was measured.
 */
export const SEARCH_WINDOW_API_PROPERTY = "searchWindow";

/**
 * The target-picker value that means "New collection…".
 *
 * It is the `value` attribute of `#rh-search-target-new-item` in
 * `addon/content/searchDialog.xhtml` (`P1-T20`'s markup), and the document
 * extends it to `new:<name>` once the user has named one. Declared here because
 * both the document and the view model parse it.
 */
export const NEW_COLLECTION_VALUE = "new";

/**
 * The three values the duplicate-policy radiogroup can hold (`P1-T43`).
 *
 * They are the `value` attributes of the three `<radio>` elements under
 * `#rh-search-duplicates` in `addon/content/searchDialog.xhtml`, which draws
 * `docs/08` §4.4's "skip | add existing item to collection | import anyway"
 * control, and nothing else can reach {@link SearchWindowQuery.duplicates}.
 *
 * **These are the window's words, not the importer's.** `src/zotero/importer.ts`
 * spells the same three outcomes `"skip"`, `"link-existing"` and
 * `"import-anyway"`, and only one of the three pairs coincides. Until `P1-T43`
 * the member below was typed `string`, so the importer's word compiled in the
 * window's slot and was then dropped on the floor — `test/integration/phase1-dod.spec.ts`
 * carried `"link-existing"` there for five days without a complaint. The
 * mapping between the two vocabularies lives in exactly one place,
 * `src/ui/viewModels/searchImportViewModel.ts`'s `DUPLICATE_POLICY_BY_CHOICE`,
 * and is total over this tuple, so a fourth radio added here without a mapping
 * is a type error rather than a silent fall-back to the importer's default.
 *
 * `test/integration/searchDialog-flow.spec.ts` asserts that the live document's
 * radios carry exactly this set, because the markup is a plain asset nothing
 * typechecks.
 */
export const SEARCH_WINDOW_DUPLICATES = ["skip", "link", "import"] as const;

/** One of {@link SEARCH_WINDOW_DUPLICATES}. */
export type SearchWindowDuplicates = (typeof SEARCH_WINDOW_DUPLICATES)[number];

/** One author, as the document's `logic.authorName` accepts them. */
export interface SearchWindowAuthor {
  readonly family?: string;
  readonly given?: string;
  readonly literal?: string;
}

/**
 * One result row, as the view model hands it to the document's `setResults()`.
 *
 * `key` is the record's own `SourceRecord.id` (`${sourceId}:${nativeId}`), which
 * is what makes the document's selection round-trip into
 * `SearchImportTarget.selectedRecordIds` without a second identity scheme — see
 * `logic.rowKey`, which prefers `record.key` when it is a non-empty string.
 *
 * `sourceLabels` and `typeLabel` are **already-localized** strings, per the
 * en-US bundle's own rule for literature-source display names: "the view model
 * formats those and hands this document an already localized string". `title`
 * and `doi` are data (`docs/08` §10.3), and `year` is a numeral the document
 * writes straight into `textContent` so no `Intl.NumberFormat` can group it.
 */
export interface SearchWindowRecord {
  readonly key: string;
  readonly title: string;
  readonly authors: readonly SearchWindowAuthor[];
  readonly year?: number;
  readonly sourceLabels: readonly string[];
  readonly typeLabel: string;
  readonly doi: string;
  readonly existing: boolean;
}

/**
 * What the document's `collectQuery()` returns, i.e. what Search sends.
 *
 * Every member is read off a control, so every member is as untrusted as a
 * control is: `maxResults` can be `NaN` if the number input is empty, and
 * `sources` can contain an id no adapter is registered for. The pipeline's
 * `validate()` is what rejects the first and `searchImportPipeline`'s
 * `missingAdapterReport` the second — FR-9's shape, not a throw.
 */
export interface SearchWindowQuery {
  readonly mode: string;
  /** The keyword box, verbatim. Never interpolated into a visible string. */
  readonly keyword: string;
  readonly fromYear: number;
  readonly toYear: number;
  readonly maxResults: number;
  readonly sources: readonly string[];
  /** The client-side filter box. Applied in the document, never sent upstream. */
  readonly filter: string;
  readonly hideExisting: boolean;
  /**
   * The duplicate-policy radio, in the **window's** vocabulary
   * ({@link SEARCH_WINDOW_DUPLICATES}). The view model maps it to the importer's
   * `DuplicatePolicy` before it reaches the pipeline; see `P1-T43`.
   */
  readonly duplicates: SearchWindowDuplicates;
  /**
   * The target picker's value: a collection id as a string,
   * {@link NEW_COLLECTION_VALUE}, or `new:<name>`.
   */
  readonly collectionID: string;
  /**
   * A re-run's exact date window (`P2-T17`, FR-12), sent **only** while the
   * window is in `rerun` mode and the user has not touched the two year
   * menulists: the recorded `{ fromIso, toIso }`, the same with `toIso` moved
   * to the later of the recorded end and today ("advance to today"; owner,
   * 2026-10-16, `plan/00` §6 item 217), or `"all-years"` for a record that stored
   * FR-3's `dateFilter: "none"`. Absent on every other query, and then
   * {@link fromYear} / {@link toYear} decide, as they always have.
   *
   * Structurally `src/core/provenance.ts`'s `RerunDateWindow`, written out so
   * this file keeps importing nothing from `src/`.
   */
  readonly dateWindow?:
    { readonly fromIso: string; readonly toIso: string } | "all-years";
  /**
   * Relevance screening for this run (`P3-T27`, `docs/08` §4.2's threshold
   * row): the "screen with the AI model" checkbox and the threshold control's
   * value, read off the controls like every other member — so `threshold` can
   * be `NaN` from an emptied box, and the view model's `screeningThreshold`
   * coerces it. The value is the run's own: nothing writes it back to the
   * `screening.threshold` preference. Absent, or `enabled: false`, means no
   * model is called.
   */
  readonly screening?: {
    readonly enabled: boolean;
    readonly threshold: number;
  };
}

/**
 * What Import sends: the query, plus **exactly the checked and visible rows**.
 *
 * The intersection is decided in the document (`pickedRows()`), which is this
 * card's **Do NOT** — "import exactly the checked set, or a hidden-but-checked
 * row silently vanishes" — and `P1-T21`'s selection model is what makes it one
 * set rather than two.
 */
export interface SearchWindowImportRequest extends SearchWindowQuery {
  readonly records: readonly SearchWindowRecord[];
}

/**
 * Open the Search & Import window, or re-focus the one that is already open.
 *
 * Issues no network request — nothing here but `openDialog` — which is `FR-1`'s
 * third acceptance criterion ("`Escape` closes the dialog with no side effects
 * and no network request"); the other half of that criterion is `P1-T20`'s
 * document.
 *
 * @param host - the window to open from. `src/ui/menus/registerMenus.ts`
 *   passes the window that owns the clicked menu item.
 * @param args - becomes `window.arguments[0]` inside the opened document.
 * @returns the window, already focused.
 * @throws if `openDialog` returns `null`. A window that silently did not open
 *   is the same class of failure as a menu registration that silently did not
 *   register (`src/zotero/registrations.ts`), and the menu handler turns a
 *   throw into a reported error rather than nothing at all.
 */
export function openSearchWindow(
  host: SearchWindowHost,
  args: SearchWindowArgs,
): SearchWindowHandle {
  const win = host.openDialog(
    SEARCH_WINDOW_URL,
    SEARCH_WINDOW_NAME,
    SEARCH_WINDOW_FEATURES,
    args,
  );
  if (!win) {
    throw new Error(
      `[research-helper] openDialog("${SEARCH_WINDOW_URL}", ` +
        `"${SEARCH_WINDOW_NAME}") returned no window.`,
    );
  }
  // Re-focusing is the whole point of the window name: an invocation while the
  // window is already open must raise it, not duplicate it.
  win.focus();
  return win;
}

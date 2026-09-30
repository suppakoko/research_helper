/**
 * Every Fluent message id Phase 1 ships, as types and as enumerable lists
 * (`P1-T18`).
 *
 * `src/i18n/ftl.ts` is the *lookup*; this file is the *vocabulary*. Splitting
 * them this way is what makes the id set something a test can walk: the four
 * `.ftl` bundles under `addon/locale/` are data files no compiler reads, so the
 * only way a typo in one of them fails anything is a spec that diffs the
 * bundles against a list — which is `test/integration/l10n.spec.ts`, using the
 * arrays below.
 *
 * ## Why this file is a leaf
 *
 * It imports nothing, including `./ftl`. `ftl.ts` imports *from here*, so the
 * dependency runs one way and the id lists stay readable from a test, a view
 * model or a source adapter without dragging in the `Localization` shapes.
 *
 * ## Two prefixes, and why
 *
 * `docs/01` §9.3 requires every identifier to start with `research-helper-`,
 * "No exceptions", because Fluent identifiers share one global namespace per
 * DOM document and a collision silently shadows rather than erroring. Every id
 * here obeys that **except the sixteen `rh-error-*` ids**, whose values are
 * fixed in `src/core/errors.ts` from `docs/07` §10.1 and asserted, all 23 of
 * them, by `P1-T02`'s `test/unit/core/errors.test.ts`.
 *
 * `P1-T18` did not resolve that conflict, because resolving it means editing
 * `src/core/errors.ts`, its unit test and `docs/07` §10.1 — none of which is in
 * this card's `Files` list (`plan/README.md` §5 rule 2). The keys are
 * transcribed from the code, because a `messageKey` with no matching message is
 * a blank label at runtime rather than a compile error, and the divergence is
 * reported. `ERROR_MESSAGE_PREFIX` exists so that the one place that has to
 * tolerate it is explicit and greppable.
 *
 * ## No message id ever reaches a synchronous getter
 *
 * `Zotero.getString()` throws on an unknown key when `Zotero.locale` is
 * `en-US` (`docs/08` §8.2.1), and a plugin's `.ftl` lives in `L10nRegistry`,
 * not in `getString`'s synchronous bundle, so plugin strings resolve through
 * async Fluent only. Everything downstream — `P1-T15`'s progress sink, the
 * search window's document — takes an **already localized string**. The ids
 * here are for `src/i18n/ftl.ts` and for `data-l10n-id` attributes, nothing
 * else.
 */

/* ------------------------------------------------------------------ prefixes */

/**
 * The prefix on every identifier this plugin owns, and on every one of its
 * Fluent *filenames* — both are global namespaces (`docs/01` §9.3).
 *
 * Duplicated as a literal rather than built from `package.json`'s `addonRef`
 * so that this module stays a leaf and so the string a test greps for is the
 * string the `.ftl` files contain. `src/i18n/ftl.ts` asserts the two agree.
 */
export const MESSAGE_PREFIX = "research-helper-";

/**
 * The second, unwanted prefix: `ResearchHelperError.messageKey` (`docs/07`
 * §10.1). See this file's header — it is a reported corpus conflict, not a
 * sanctioned pattern, and nothing new may use it.
 */
export const ERROR_MESSAGE_PREFIX = "rh-error-";

/* ------------------------------------------------------------------ surfaces */

/**
 * The four localization surfaces `docs/08` §10.1 owns, by their FTL stem.
 * Phase 1 ships the first two; `reportWindow` and `preferences` arrive with
 * the surfaces that need them.
 */
export type FluentSurface =
  "mainWindow" | "searchDialog" | "reportWindow" | "preferences";

/** The surfaces that have a bundle in `addon/locale/` today. */
export const SHIPPED_SURFACES = ["mainWindow", "searchDialog"] as const;

export type ShippedSurface = (typeof SHIPPED_SURFACES)[number];

/* -------------------------------------------------- mainWindow message ids */

/**
 * `research-helper-mainWindow.ftl` — strings shown in a window Zotero owns, in
 * a dialog raised from it, or formatted by JavaScript for more than one
 * surface (`docs/08` §10.1, and that bundle's header for the third case).
 *
 * Order matches the file, so a reviewer can read the two side by side.
 */
export const MAIN_WINDOW_MESSAGE_IDS = [
  // Menus (docs/08 §2.4, §2.5). The FTL entry must set `.label`: MenuData has
  // no plain label property and `l10nID` is MenuManager's only mechanism.
  "research-helper-menu-root",
  "research-helper-menu-search-import",
  "research-helper-menu-collection-search-import",
  "research-helper-menu-spike-create-item",

  // LiteratureSource.displayNameKey (docs/07 §4.2). Never translated.
  "research-helper-source-pubmed",

  // Search provenance (FR-8, P1-T17).
  "research-helper-provenance-note-title",

  // Import outcome (docs/08 §4.4, FR-51).
  "research-helper-import-summary",
  "research-helper-import-abstract-coverage",
  "research-helper-import-toast-header",

  // ResearchHelperError.messageKey — see ERROR_MESSAGE_IDS below.
  "rh-error-configuration",
  "rh-error-missing-credential",
  "rh-error-network",
  "rh-error-offline",
  "rh-error-timeout",
  "rh-error-auth",
  "rh-error-forbidden",
  "rh-error-rate-limit",
  "rh-error-quota",
  "rh-error-upstream",
  "rh-error-bad-request",
  "rh-error-source",
  "rh-error-parse",
  "rh-error-zotero",
  "rh-error-storage",
  "rh-error-cancelled",
] as const;

export type MainWindowMessageId = (typeof MAIN_WINDOW_MESSAGE_IDS)[number];

/**
 * `P0-T10`'s spike menu item, which `src/ui/menus/toolsMenu.ts` declares for
 * itself. Named here because it is the key the `ko-KR` fallback assertion is
 * built on and the one id that is *deliberately* absent from that bundle
 * (`FR-55`, spike `V-17`, `P0-T24`); `test/integration/l10n.spec.ts` asserts
 * this constant and `toolsMenu.ts`'s are the same string.
 */
export const L10N_MENU_SPIKE_CREATE_ITEM =
  "research-helper-menu-spike-create-item";

/** The submenu label, shared by the Tools and collection-context menus. */
export const L10N_MENU_ROOT = "research-helper-menu-root";

/** Tools ▸ Research Helper ▸ Search & Import… (`P1-T19`). */
export const L10N_MENU_SEARCH_IMPORT = "research-helper-menu-search-import";

/**
 * Collection context menu ▸ Research Helper ▸ Search & Import into This
 * Collection… (`P1-T19`).
 *
 * **This id has no counterpart in the corpus.** `docs/08` §2.4's collection
 * registration block and §2.5's collection wireframe list report,
 * summarize-all, re-run and recommend, none of which is Phase 1's, while
 * `P1-T19`'s Goal requires an entry that opens the search window "with that
 * collection pre-selected as the target". `P1-T18` declares the id `P1-T19`
 * needs and reports the gap; the wording in the bundle is provisional.
 */
export const L10N_MENU_COLLECTION_SEARCH_IMPORT =
  "research-helper-menu-collection-search-import";

/* ------------------------------------------------ searchDialog message ids */

/**
 * `research-helper-searchDialog.ftl` — everything the Search & Import window's
 * own document resolves through `data-l10n-id` (`docs/08` §4.2, §4.3, §4.5,
 * §4.6, §8.4).
 *
 * Order matches the file and the order a user meets the controls.
 */
export const SEARCH_DIALOG_MESSAGE_IDS = [
  "research-helper-search-window-title",

  // Query row.
  "research-helper-search-keyword-label",
  "research-helper-search-keyword-input",
  "research-helper-search-run",
  "research-helper-search-mode-keyword",

  // Date range (FR-3; the years themselves are computed at window open).
  "research-helper-search-years-label",
  "research-helper-search-years-span",
  "research-helper-search-years-from",
  "research-helper-search-years-to",
  "research-helper-search-years-custom",

  // Per-database limit (the number is docs/07 §8.5's `maxResults`).
  "research-helper-search-max-results-label",
  "research-helper-search-max-results-input",

  // Database selection (FR-2).
  "research-helper-search-databases-label",
  "research-helper-search-databases-none",

  // Client-side filtering.
  "research-helper-search-filter-label",
  "research-helper-search-filter-input",
  "research-helper-search-hide-existing",
  "research-helper-search-result-count",

  // Result table (docs/08 §4.3's accessible name and row strings).
  "research-helper-search-table",
  "research-helper-search-col-select",
  "research-helper-search-col-title",
  "research-helper-search-col-authors",
  "research-helper-search-col-year",
  "research-helper-search-col-source",
  "research-helper-search-col-type",
  "research-helper-search-col-doi",
  "research-helper-search-authors-overflow",
  "research-helper-search-row-existing",
  "research-helper-search-row-existing-badge",

  // Selection controls (FR-5).
  "research-helper-search-select-all",
  "research-helper-search-select-none",
  "research-helper-search-select-invert",
  "research-helper-search-selected-count",

  // Import target and duplicate policy (FR-51).
  "research-helper-search-target-label",
  "research-helper-search-target-picker",
  "research-helper-search-target-new",
  "research-helper-search-duplicates-label",
  "research-helper-search-duplicates-skip",
  "research-helper-search-duplicates-link",
  "research-helper-search-duplicates-import",

  // Window buttons.
  "research-helper-search-close",
  "research-helper-search-cancel",
  "research-helper-search-import",

  // docs/08 §8.4's five states: INITIAL.
  "research-helper-search-state-initial",

  // LOADING, including the per-database status list docs/08 §4.6 requires.
  "research-helper-search-source-searching",
  "research-helper-search-source-results",
  "research-helper-search-source-failed",
  "research-helper-search-progress-databases",
  "research-helper-search-status-searching",
  "research-helper-search-status-importing",

  // EMPTY.
  "research-helper-search-state-empty",
  "research-helper-search-state-empty-suggestions",
  "research-helper-search-row-no-content",

  // PARTIAL (FR-9: a non-blocking banner, never a modal).
  "research-helper-search-state-partial",

  // ERROR.
  "research-helper-search-state-error",
  "research-helper-search-state-error-open-preferences",
  "research-helper-search-state-error-retry",

  // NFR-14's details disclosure for raw upstream text.
  "research-helper-search-details-show",
  "research-helper-search-details-hide",
] as const;

export type SearchDialogMessageId = (typeof SEARCH_DIALOG_MESSAGE_IDS)[number];

/** Every message id Phase 1 ships, in either bundle. */
export type FluentMessageId = MainWindowMessageId | SearchDialogMessageId;

/** The shipped surfaces and the ids each one's bundle must contain. */
export const MESSAGE_IDS_BY_SURFACE: {
  readonly [S in ShippedSurface]: readonly FluentMessageId[];
} = {
  mainWindow: MAIN_WINDOW_MESSAGE_IDS,
  searchDialog: SEARCH_DIALOG_MESSAGE_IDS,
};

/** Which bundle declares `id`, or `undefined` if nothing does. */
export function surfaceOfMessage(id: string): ShippedSurface | undefined {
  for (const surface of SHIPPED_SURFACES) {
    if ((MESSAGE_IDS_BY_SURFACE[surface] as readonly string[]).includes(id)) {
      return surface;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------ error message ids */

/**
 * The `messageKey` of every error class Phase 1 can throw, transcribed from
 * `src/core/errors.ts` (`docs/07` §10.1). `test/integration/l10n.spec.ts`
 * constructs one instance of each class and asserts its `messageKey` is in
 * this list *and* resolves in `en-US`, which is the only check that catches a
 * key renamed on one side.
 */
export const ERROR_MESSAGE_IDS = [
  "rh-error-configuration",
  "rh-error-missing-credential",
  "rh-error-network",
  "rh-error-offline",
  "rh-error-timeout",
  "rh-error-auth",
  "rh-error-forbidden",
  "rh-error-rate-limit",
  "rh-error-quota",
  "rh-error-upstream",
  "rh-error-bad-request",
  "rh-error-source",
  "rh-error-parse",
  "rh-error-zotero",
  "rh-error-storage",
  "rh-error-cancelled",
] as const satisfies readonly MainWindowMessageId[];

/**
 * The seven `messageKey`s `docs/07` §10.1 declares that Phase 1 deliberately
 * ships no message for, because no Phase 1 code path can throw them: they
 * belong to the LLM, TTS and budget subsystems Phase 3 builds, and to the
 * privacy-mode policy check that goes with them.
 *
 * Listed rather than ignored so the gap is asserted: `plan/README.md` §5 rule 2
 * forbids adding strings this card does not cover, and
 * `test/integration/l10n.spec.ts` checks that the `rh-error-*` keys reachable
 * from `src/core/errors.ts` are exactly `ERROR_MESSAGE_IDS` ∪ this list. A new
 * error class, or a Phase 3 card wiring one of these into a Phase 1 path, fails
 * that assertion instead of rendering a blank label.
 */
export const DEFERRED_ERROR_MESSAGE_IDS = [
  "rh-error-llm",
  "rh-error-context-length",
  "rh-error-content-filter",
  "rh-error-structured-output",
  "rh-error-tts",
  "rh-error-budget",
  "rh-error-policy",
] as const;

/* ------------------------------------------------------- ko-KR review state */

/**
 * The `ko-KR` messages that need a native Korean speaker — the `P1-T18` human
 * gate, as data.
 *
 * `docs/08` §10.2 ships owner-written Korean for two main-window menu labels
 * and nothing for the search window. `docs/08` §10.3 exempts database names
 * and "DOI" from translation, so those are shipped in Korean unchanged. Every
 * other id is here, and the Korean bundles list the same ids as comments with
 * their English source for the reviewer to fill in.
 *
 * Nothing on this list was machine-translated. Until the gate clears, a Korean
 * UI resolves these from `en-US` through the second fallback layer `P0-T24`
 * measured — visibly English, rather than plausibly wrong.
 *
 * `test/integration/l10n.spec.ts` asserts that the messages actually missing
 * from the two `ko-KR` bundles are exactly this list plus
 * {@link KO_DELIBERATELY_ABSENT}, so a new `en-US` string cannot land without
 * either a Korean entry or an explicit admission here.
 */
export const KO_PENDING_REVIEW = [
  // --- mainWindow (21) ---
  "research-helper-menu-collection-search-import",
  "research-helper-provenance-note-title",
  "research-helper-import-summary",
  "research-helper-import-abstract-coverage",
  "research-helper-import-toast-header",
  "rh-error-configuration",
  "rh-error-missing-credential",
  "rh-error-network",
  "rh-error-offline",
  "rh-error-timeout",
  "rh-error-auth",
  "rh-error-forbidden",
  "rh-error-rate-limit",
  "rh-error-quota",
  "rh-error-upstream",
  "rh-error-bad-request",
  "rh-error-source",
  "rh-error-parse",
  "rh-error-zotero",
  "rh-error-storage",
  "rh-error-cancelled",

  // --- searchDialog (58) ---
  "research-helper-search-window-title",
  "research-helper-search-keyword-label",
  "research-helper-search-keyword-input",
  "research-helper-search-run",
  "research-helper-search-mode-keyword",
  "research-helper-search-years-label",
  "research-helper-search-years-span",
  "research-helper-search-years-from",
  "research-helper-search-years-to",
  "research-helper-search-years-custom",
  "research-helper-search-max-results-label",
  "research-helper-search-max-results-input",
  "research-helper-search-databases-label",
  "research-helper-search-databases-none",
  "research-helper-search-filter-label",
  "research-helper-search-filter-input",
  "research-helper-search-hide-existing",
  "research-helper-search-result-count",
  "research-helper-search-table",
  "research-helper-search-col-select",
  "research-helper-search-col-title",
  "research-helper-search-col-authors",
  "research-helper-search-col-year",
  "research-helper-search-col-source",
  "research-helper-search-col-type",
  "research-helper-search-authors-overflow",
  "research-helper-search-row-existing",
  "research-helper-search-row-existing-badge",
  "research-helper-search-select-all",
  "research-helper-search-select-none",
  "research-helper-search-select-invert",
  "research-helper-search-selected-count",
  "research-helper-search-target-label",
  "research-helper-search-target-picker",
  "research-helper-search-target-new",
  "research-helper-search-duplicates-label",
  "research-helper-search-duplicates-skip",
  "research-helper-search-duplicates-link",
  "research-helper-search-duplicates-import",
  "research-helper-search-close",
  "research-helper-search-cancel",
  "research-helper-search-import",
  "research-helper-search-state-initial",
  "research-helper-search-source-searching",
  "research-helper-search-source-results",
  "research-helper-search-source-failed",
  "research-helper-search-progress-databases",
  "research-helper-search-status-searching",
  "research-helper-search-status-importing",
  "research-helper-search-state-empty",
  "research-helper-search-state-empty-suggestions",
  "research-helper-search-row-no-content",
  "research-helper-search-state-partial",
  "research-helper-search-state-error",
  "research-helper-search-state-error-open-preferences",
  "research-helper-search-state-error-retry",
  "research-helper-search-details-show",
  "research-helper-search-details-hide",
] as const satisfies readonly FluentMessageId[];

/**
 * The one id that is absent from `ko-KR` **permanently and on purpose**, so
 * that `FR-55`'s "falls back to English rather than showing an identifier"
 * stays observable at runtime (spike `V-17`, `P0-T24`).
 *
 * It is not on {@link KO_PENDING_REVIEW}: translating it would delete the
 * fixture `test/integration/l10n.spec.ts` is built on.
 */
export const KO_DELIBERATELY_ABSENT = [
  "research-helper-menu-spike-create-item",
] as const satisfies readonly FluentMessageId[];

/**
 * The ids the `ko-KR` bundles are expected to contain today: everything an
 * owner supplied (`docs/08` §10.2) plus everything `docs/08` §10.3 forbids
 * translating.
 */
export const KO_PRESENT = [
  "research-helper-menu-root",
  "research-helper-menu-search-import",
  "research-helper-source-pubmed",
  "research-helper-search-col-doi",
] as const satisfies readonly FluentMessageId[];

/* ---------------------------------------------------------------- arguments */

/**
 * The arguments each message with placeables requires.
 *
 * Typed because a missing argument is not a compile error in Fluent — the
 * placeable renders as `{$name}` in the user's face — and because `docs/08`
 * §10.3 forbids the alternative of building the sentence in JavaScript. A
 * message absent from this map takes no arguments.
 *
 * `$provider`, `$database` and `$host` are **already-resolved display
 * strings**, never message ids: provider and database names are not translated
 * (`docs/08` §10.3), and a source's name comes from its `displayNameKey`
 * formatted first. `$reason` is an already-localized `rh-error-*` string.
 * Numbers and dates are formatted by the caller with `Intl.NumberFormat` /
 * `Intl.DateTimeFormat` over `Zotero.locale` (`docs/08` §10.3), except where a
 * Fluent selector needs the raw number to choose a plural form.
 */
export interface FluentMessageArgsMap {
  // mainWindow
  "research-helper-provenance-note-title": { timestamp: string };
  "research-helper-import-summary": {
    imported: number;
    linked: number;
    skipped: number;
    failed: number;
  };
  "research-helper-import-abstract-coverage": { percent: number };
  "rh-error-missing-credential": { provider: string };
  "rh-error-network": { host: string };
  "rh-error-timeout": { host: string; seconds: number };
  "rh-error-auth": { provider: string; status: number };
  "rh-error-forbidden": { provider: string; status: number };
  "rh-error-rate-limit": { provider: string; seconds: number };
  "rh-error-quota": { provider: string };
  "rh-error-upstream": { database: string; status: number };
  "rh-error-bad-request": { database: string };
  "rh-error-source": { database: string };
  "rh-error-parse": { database: string };
  "rh-error-cancelled": { imported: number };

  // searchDialog
  "research-helper-search-years-span": {
    from: number;
    to: number;
    years: number;
  };
  "research-helper-search-result-count": { total: number; new: number };
  "research-helper-search-authors-overflow": { names: string; count: number };
  "research-helper-search-row-existing": { title: string };
  "research-helper-search-selected-count": { count: number };
  "research-helper-search-import": { count: number };
  "research-helper-search-state-initial": { years: number };
  "research-helper-search-source-results": { count: number };
  "research-helper-search-source-failed": { reason: string };
  "research-helper-search-progress-databases": { done: number; total: number };
  "research-helper-search-status-searching": { database: string };
  "research-helper-search-status-importing": { done: number; total: number };
  "research-helper-search-state-empty": {
    query: string;
    from: number;
    to: number;
  };
  "research-helper-search-state-partial": {
    failed: number;
    succeeded: number;
  };
}

/** The argument object `id` needs, or `undefined` when it needs none. */
export type FluentMessageArgs<Id extends FluentMessageId> =
  Id extends keyof FluentMessageArgsMap ? FluentMessageArgsMap[Id] : undefined;

/**
 * The trailing parameter list for a lookup of `id`: required when the message
 * has placeables, absent when it does not. This is what stops a caller passing
 * `{ count }` to a message that has no `{ $count }`, and stops it forgetting
 * one that does.
 */
export type FluentArgsParam<Id extends FluentMessageId> =
  Id extends keyof FluentMessageArgsMap
    ? [args: FluentMessageArgsMap[Id]]
    : [args?: undefined];

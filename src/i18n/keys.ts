/**
 * Every Fluent message id Phase 1 ships, as types and as enumerable lists
 * (`P1-T18`, reconciled against the generated union by `P1-T30`).
 *
 * `src/i18n/ftl.ts` is the *lookup*; this file is the *vocabulary*. Splitting
 * them this way is what makes the id set something a test can walk: the four
 * `.ftl` bundles under `addon/locale/` are data files no compiler reads, so the
 * only way a typo in one of them fails anything is a spec that diffs the
 * bundles against a list — which is `test/integration/l10n.spec.ts`, using the
 * arrays below.
 *
 * ## The bundles are the source of truth, not this file (`P1-T30`)
 *
 * {@link FluentMessageId} is **re-exported from `typings/i10n.d.ts`**, which
 * `zotero-plugin-scaffold` generates from the built `.ftl` files
 * (`zotero-plugin.config.ts`, `build.fluent.dts`). Until `P1-T30` turned that
 * switch on, this file's hand-written union and the generated one were two
 * descriptions of one vocabulary and a bundle edit that forgot this file was an
 * invisible blank label rather than a compile error.
 *
 * What the generator *cannot* produce is kept by hand here, and there are
 * exactly three such things:
 *
 * 1. **Which surface declares an id.** `buildLocale()` unions the messages of
 *    every `.ftl` of every locale into one flat set, so the generated union
 *    cannot say that `research-helper-search-close` belongs to
 *    `searchDialog.ftl` and must *not* also be in `mainWindow.ftl` — a
 *    collision `docs/01` §9.3 calls worse than an error because it is silent.
 *    {@link MAIN_WINDOW_MESSAGE_IDS} and {@link SEARCH_DIALOG_MESSAGE_IDS} are
 *    therefore still written out, but they are now a **partition** of the
 *    generated union rather than a second union: each `satisfies readonly
 *    FluentMessageId[]`, so an id dropped from a bundle stops compiling here,
 *    and {@link UndeclaredBundleMessageId} fails the other way round, so an id
 *    added to a bundle and not assigned a surface stops compiling too. The two
 *    together make the sets provably equal.
 * 2. **The per-message argument map.** {@link FluentMessageArgsMap}. The
 *    generator reads ids, never placeables.
 * 3. **The decisions**, which are not vocabulary at all:
 *    {@link KO_PENDING_REVIEW}, {@link KO_DELIBERATELY_ABSENT},
 *    {@link KO_PRESENT} and {@link DEFERRED_ERROR_MESSAGE_IDS}. A generator can
 *    only report what the bundles contain; it cannot record that one id must
 *    stay missing from `ko-KR` forever.
 *
 * The generated file is committed, for the same reason `typings/prefs.d.ts` is:
 * `npm run build` is `tsc --noEmit && zotero-plugin build`, so the typecheck
 * that consumes the union runs *before* the step that writes it. A bundle edit
 * is therefore caught by the typecheck **after** the next build, not during it.
 *
 * ## Why this file is a leaf
 *
 * Its only import is the generated union, which is type-only and erased: no
 * runtime dependency, and in particular not `./ftl`. `ftl.ts` imports *from
 * here*, so the dependency runs one way and the id lists stay readable from a
 * test, a view model or a source adapter without dragging in the
 * `Localization` shapes.
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

import type { FluentMessageId as GeneratedMessageId } from "../../typings/i10n";

/* --------------------------------------------------- the generated union */

/**
 * Every message id the built bundles actually declare — **generated**, not
 * written.
 *
 * `typings/i10n.d.ts` is `zotero-plugin-scaffold`'s `generateFluentDts()`
 * output over every `.ftl` under `.scaffold/build/addon/locale/`, re-exported
 * here under the name the rest of `src/` imports. It is the union of the messages
 * of *every* locale, not of `en-US` alone — so a typo in `ko-KR` widens it, and
 * {@link UndeclaredBundleMessageId} is what catches that.
 *
 * Re-exported rather than restated so that this file cannot drift from the
 * bundles: `P1-T30`'s whole point is that there is one union and the compiler
 * owns it.
 */
export type FluentMessageId = GeneratedMessageId;

/**
 * A type-level assertion that `T` is empty. Instantiating it with anything
 * else is a `TS2344` naming the offending members, which is how the two
 * drift checks below report.
 */
type AssertNever<T extends never> = T;

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

/**
 * The surfaces that have a bundle in `addon/locale/` today. `reportWindow`
 * since `P4-T19` (2026-10-29): the report window owns a window, so it owns a
 * bundle (`docs/08` §10.1). `preferences` never will — its strings are in the
 * main-window bundle (`docs/08` §10.1, corrected 2026-10-15).
 */
export const SHIPPED_SURFACES = [
  "mainWindow",
  "searchDialog",
  "reportWindow",
] as const;

export type ShippedSurface = (typeof SHIPPED_SURFACES)[number];

/* -------------------------------------------------- mainWindow message ids */

/**
 * `research-helper-mainWindow.ftl` — strings shown in a window Zotero owns, in
 * a dialog raised from it, or formatted by JavaScript for more than one
 * surface (`docs/08` §10.1, and that bundle's header for the third case).
 *
 * Order matches the file, so a reviewer can read the two side by side.
 *
 * `satisfies readonly FluentMessageId[]` is load-bearing: it is what makes a
 * message deleted from a bundle, without this list being touched, a **compile
 * error** rather than a blank label (`P1-T30`).
 */
export const MAIN_WINDOW_MESSAGE_IDS = [
  // Menus (docs/08 §2.4, §2.5). The FTL entry must set `.label`: MenuData has
  // no plain label property and `l10nID` is MenuManager's only mechanism.
  "research-helper-menu-root",
  "research-helper-menu-search-import",
  "research-helper-menu-collection-search-import",
  // FR-12's "Re-run This Search…" (P2-T17), docs/08 §2.4 and §10.2.
  "research-helper-menu-collection-rerun",
  // FR-25's "Generate Research Trends Report…" (P4-T19), docs/08 §2.4 and
  // §10.2. The window it opens has its own bundle: REPORT_WINDOW_MESSAGE_IDS.
  "research-helper-menu-collection-report",
  "research-helper-menu-spike-create-item",
  // P3-T29: the collection submenu's two LLM-job entries (docs/08 §2.5's
  // note of 2026-10-29), the summarize window and the removal command.
  // See SUMMARIZE_DIALOG_L10N in src/ui/dialogs/summarizeDialog.ts.
  "research-helper-menu-collection-summarize-all",
  "research-helper-menu-collection-remove-notes",
  "research-helper-summarize-title",
  "research-helper-summarize-collection",
  "research-helper-summarize-resummarize",
  "research-helper-summarize-write-notes",
  "research-helper-summarize-notes-readonly",
  "research-helper-summarize-start",
  "research-helper-summarize-cancel",
  "research-helper-summarize-close",
  "research-helper-summarize-export",
  "research-helper-summarize-stage",
  "research-helper-summarize-progress",
  "research-helper-summarize-remaining",
  "research-helper-summarize-row",
  "research-helper-summarize-counts",
  "research-helper-summarize-outcome",
  "research-helper-summarize-key-needed",
  "research-helper-summarize-continue",
  "research-helper-summarize-stop",
  "research-helper-summarize-export-outcome",
  "research-helper-remove-notes-title",
  "research-helper-remove-notes-confirm",
  "research-helper-remove-notes-none",
  "research-helper-remove-notes-done",

  // LiteratureSource.displayNameKey (docs/07 §4.2). Never translated. One
  // per registered source, in SOURCE_IDS order (P2-T32 added Europe PMC,
  // P2-T04 Crossref, P2-T06 arXiv, P2-T05 Semantic Scholar — listed after
  // arXiv here in landing order; SOURCE_IDS puts it before — and P2-T07
  // bioRxiv and medRxiv, two ids served by one adapter).
  "research-helper-source-pubmed",
  "research-helper-source-europepmc",
  "research-helper-source-crossref",
  "research-helper-source-arxiv",
  "research-helper-source-semanticscholar",
  "research-helper-source-biorxiv",
  "research-helper-source-medrxiv",

  // LLMProvider.displayNameKey (docs/07 §4.3). Never translated, like the
  // source names above (docs/08 §10.3). One per adapter, in the order
  // registerProviders registers them, under one id scheme
  // `research-helper-provider-<id>` (owner, 2026-10-21, plan/00 §6 item
  // 262(b)).
  "research-helper-provider-openrouter",
  "research-helper-provider-openai",
  "research-helper-provider-anthropic",
  "research-helper-provider-gemini",

  // Search provenance (FR-8, P1-T17).
  "research-helper-provenance-note-title",

  // Import outcome (docs/08 §4.4, FR-51). The toast *header* is not here: it
  // is the progress popup's headline below, because §4.4's completion toast is
  // §7.7's popup (P1-T33).
  "research-helper-import-summary",
  "research-helper-import-abstract-coverage",
  // P2-T18 step 10: a run's import paths with `useTranslators` on.
  "research-helper-import-paths",
  "research-helper-import-fallback-reason",

  // The progress popup's headline (docs/07 §7.7, docs/08 §8.2; P1-T32 item 3,
  // P1-T33). JavaScript formats it and hands it to a surface that is not a
  // document of ours, which is docs/08 §10.1's "From JS, no window" row and so
  // this bundle. It is the **only** headline id: `P1-T33` retired
  // `research-helper-import-toast-header` in its favour, and
  // L10N_PROGRESS_HEADLINE below is where that decision is recorded.
  "research-helper-progress-headline",

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
  // The four LLM messageKeys (`P3-T05`, 2026-10-20), moved here from
  // DEFERRED_ERROR_MESSAGE_IDS when the LLM error mapping
  // (`src/llm/shared/errorMap.ts`) made them reachable.
  "rh-error-llm",
  "rh-error-context-length",
  "rh-error-content-filter",
  "rh-error-structured-output",
  // `OutputTruncatedError`, a truncated answer (owner, 2026-10-21, plan/00
  // §6 item 265(c); docs/07 §10.1).
  "rh-error-output-truncated",
  // `PrivacyRoutingError`, OpenRouter's guardrail 404 (owner, 2026-10-21,
  // plan/00 §6 item 262(c); docs/07 §10.1).
  "rh-error-privacy-routing",
  // `BudgetExceededError`, a spend ceiling reached: the job pauses (P3-T16;
  // owner, 2026-10-20, plan/00 §6 item 234; docs/07 §10.1).
  "rh-error-budget",

  // The preference pane's literature-source credential blocks (docs/08 §7.3,
  // docs/09 §1.8–1.9; P1-T44). On *this* surface rather than a fourth
  // `preferences` one because the pane is a fragment inside a window Zotero
  // owns (`zotero:pref`), which is this bundle's first job, and because a
  // fourth bundle needs a fourth SHIPPED_SURFACES entry that the card's Files
  // list does not cover — reported with the card as a divergence from
  // docs/08 §10.1. `src/ui/prefs/preferencesPane.ts`'s PREFERENCES_L10N is
  // typed against MainWindowMessageId, so an id used by the pane and missing
  // here does not compile. Order matches the bundle.
  "research-helper-prefs-storage",
  "research-helper-prefs-backend-windows",
  "research-helper-prefs-backend-mac",
  "research-helper-prefs-backend-indeterminate",
  "research-helper-prefs-backend-unavailable",
  // docs/09 §1.8's five paragraphs, verbatim. Edit docs/09 first.
  "research-helper-prefs-risk-1",
  "research-helper-prefs-risk-2",
  "research-helper-prefs-risk-3",
  "research-helper-prefs-risk-4",
  "research-helper-prefs-risk-5",
  // docs/09 §1.8's tier-2 sentence, shown in place of paragraph 1 while
  // `secretBackend` is `session` (owner, 2026-10-23, plan/00 §6 item 274(a)).
  // No argument.
  "research-helper-prefs-risk-1-session",
  // docs/09 §1.8's tier-2 replacement for paragraph 4, shown in its place
  // while `secretBackend` is `session` (owner, 2026-10-23, plan/00 §6 item
  // 275(b)). No argument.
  "research-helper-prefs-risk-4-session",
  "research-helper-prefs-remove-all",
  "research-helper-prefs-remove-all-done",
  "research-helper-prefs-ncbi",
  "research-helper-prefs-ncbi-note",
  "research-helper-prefs-ncbi-key",
  "research-helper-prefs-s2",
  "research-helper-prefs-s2-note",
  "research-helper-prefs-s2-key",
  "research-helper-prefs-s2-request",
  "research-helper-prefs-reveal",
  "research-helper-prefs-test-key",
  "research-helper-prefs-clear-key",
  // The per-credential status row (docs/09 §1.9 item 5).
  "research-helper-prefs-key-absent",
  "research-helper-prefs-key-absent-os",
  "research-helper-prefs-key-present",
  "research-helper-prefs-key-cleared",
  "research-helper-prefs-store-unavailable",
  "research-helper-prefs-store-empty",
  "research-helper-prefs-test-running",
  "research-helper-prefs-test-ok",
  "research-helper-prefs-test-inconclusive",
  "research-helper-prefs-test-rejected",
  "research-helper-prefs-test-forbidden",
  "research-helper-prefs-test-absent",
  "research-helper-prefs-test-unavailable",
  // P3-T04: tier 2's badge (docs/09 §1.9 item 3), the restore notice (item 8),
  // and the LLM provider blocks (docs/08 §7.3). None takes an argument.
  "research-helper-prefs-backend-session",
  "research-helper-prefs-restore-note",
  "research-helper-prefs-providers",
  "research-helper-prefs-active-provider",
  "research-helper-prefs-api-key",
  "research-helper-prefs-model",
  "research-helper-prefs-base-url",
  "research-helper-prefs-base-url-saved",
  "research-helper-prefs-base-url-default",
  "research-helper-prefs-base-url-not-https",
  "research-helper-prefs-base-url-trailing-slash",
  "research-helper-prefs-base-url-invalid",
  "research-helper-prefs-gemini-paid-tier",
  "research-helper-prefs-gemini-paid-tier-note",
  // P2-T18 step 11: the `useTranslators` checkbox's label and slower-path
  // tooltip, for `P3-T04`'s pane to bind (docs/08 §7.3).
  "research-helper-prefs-use-translators",
  // P3-T34: the notice that interrupted jobs resumed (docs/07 §7.6,
  // plan/00 §6 item 250). See L10N_JOB_RESUMED.
  "research-helper-job-resumed",
  // The wall-clock budget's question (owner, 2026-10-21, plan/00 §6 item
  // 265; docs/07 §7.5). See L10N_JOB_WALL_CLOCK_BUDGET.
  "research-helper-job-wall-clock-budget",
  // P3-T15: the egress disclosure's two notices (docs/09 §3.6). See
  // L10N_EGRESS_FIRST_JOB_NOTICE and L10N_EGRESS_GEMINI_FREE_TIER.
  "research-helper-egress-first-job-notice",
  "research-helper-egress-gemini-free-tier",
  // The reminder that replaces the Gemini warning for a key declared paid
  // (owner, 2026-10-22, plan/00 §6 item 269(b)). See
  // L10N_EGRESS_GEMINI_DECLARED_PAID.
  "research-helper-egress-gemini-declared-paid",
  // P4-T16: a trend-report run's own notice (docs/09 §3 row 3b; docs/07 §4.5's
  // note of 2026-10-27). See L10N_EGRESS_REPORT_NOTICE.
  "research-helper-egress-report-notice",
  // P3-T16: the cost confirmation dialog (docs/06 §5.4, docs/10 FR-24,
  // docs/09 §3.6) and the preference pane's Usage section. See
  // COST_DIALOG_L10N and USAGE_L10N in src/ui/dialogs/costConfirmDialog.ts.
  "research-helper-cost-title",
  "research-helper-cost-items",
  "research-helper-cost-destination",
  "research-helper-cost-calls",
  "research-helper-cost-input",
  "research-helper-cost-output",
  "research-helper-cost-total",
  "research-helper-cost-unpriced",
  "research-helper-cost-disclaimer",
  "research-helper-cost-above-threshold",
  "research-helper-cost-acknowledge",
  "research-helper-cost-acknowledge-unpriced",
  "research-helper-cost-downgrade",
  "research-helper-cost-downgrade-preselected",
  "research-helper-cost-ceiling-preflight",
  "research-helper-cost-ceiling-reached",
  "research-helper-cost-usage-job",
  "research-helper-cost-usage-session",
  "research-helper-cost-usage-estimated",
  "research-helper-cost-dont-ask",
  "research-helper-cost-run",
  "research-helper-cost-cancel",
  "research-helper-cost-continue",
  "research-helper-cost-stop",
  "research-helper-cost-skipped-notice",
  "research-helper-prefs-usage",
  "research-helper-prefs-usage-limit",
  "research-helper-prefs-usage-limit-off",
  // P4-T16: the trend report's lines in the cost dialog (docs/06 §5.2, §5.4).
  // See REPORT_COST_L10N in src/ui/dialogs/costConfirmDialog.ts.
  "research-helper-cost-report-summaries",
  "research-helper-cost-report-writing",
  "research-helper-cost-report-review",
  // Owner, 2026-10-23, plan/00 §6 item 279(a): an LLM key accepted by an
  // account with no credit left (QuotaExceededError).
  "research-helper-prefs-test-ok-no-credit",
  // P3-T14: an LLM key accepted under a 429 (docs/09 §2.3), the model fields'
  // suggestions, and the user price table (plan/00 §6 item 265(b)). See
  // PREFERENCES_L10N in src/ui/prefs/preferencesPane.ts.
  "research-helper-prefs-test-ok-rate-limited",
  "research-helper-prefs-model-suggestions",
  "research-helper-prefs-models-as-of",
  "research-helper-prefs-models-stale",
  "research-helper-prefs-prices",
  "research-helper-prefs-prices-note",
  "research-helper-prefs-price-row",
  "research-helper-prefs-price-row-no-cached",
  "research-helper-prefs-price-model",
  "research-helper-prefs-price-input",
  "research-helper-prefs-price-output",
  "research-helper-prefs-price-cached",
  "research-helper-prefs-price-as-of",
  "research-helper-prefs-price-save",
  "research-helper-prefs-price-remove",
  "research-helper-prefs-price-saved",
  "research-helper-prefs-price-removed",
  "research-helper-prefs-price-invalid",
  "research-helper-prefs-price-refused",
  "research-helper-prefs-price-unavailable",
  // P3-T03: the key-storage degradation dialog (docs/09 §1.7, gate G-10).
  // See SECRET_BACKEND_DIALOG_L10N in src/ui/dialogs/secretBackendDialog.ts.
  "research-helper-secret-backend-title",
  "research-helper-secret-backend-explain",
  "research-helper-secret-backend-session",
  "research-helper-secret-backend-none",
  "research-helper-secret-backend-accept",
  "research-helper-secret-backend-decline",
  // P3-T28: the item pane's AI summary section (docs/08 §3). See
  // SUMMARY_SECTION_L10N in src/ui/panes/summarySection.ts.
  "research-helper-itempane-header",
  "research-helper-itempane-sidenav",
  "research-helper-itempane-empty",
  "research-helper-itempane-generate",
  "research-helper-itempane-loading",
  "research-helper-itempane-cancel",
  "research-helper-itempane-failed",
  "research-helper-itempane-retry",
  "research-helper-itempane-no-key",
  "research-helper-itempane-open-preferences",
  "research-helper-itempane-research-question",
  "research-helper-itempane-key-findings",
  "research-helper-itempane-limitations",
  "research-helper-itempane-btn-regenerate",
  "research-helper-itempane-btn-save-note",
  // The item pane's result lines (owner, plan/00 §6 item 303(a), (b)). See
  // SUMMARY_RESULT_L10N in src/ui/panes/summarySection.ts.
  "research-helper-itempane-not-summarized",
  "research-helper-itempane-note-not-written",
  // P4-T05: the report run stopped by a clustering answer with more themes
  // than MAX_THEMES (owner, plan/00 §6 item 292(d)). See TOO_MANY_THEMES_L10N
  // in src/pipeline/trendReport/cluster.ts.
  "research-helper-report-stopped-too-many-themes",
] as const satisfies readonly FluentMessageId[];

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

/**
 * Collection context menu ▸ Research Helper ▸ Re-run This Search… (`P2-T17`,
 * FR-12). `docs/08` §2.4 registers it under this id and §10.2 ships its
 * strings in both locales, so — unlike the entry above — it has a counterpart
 * in the corpus and an owner-written Korean label.
 */
export const L10N_MENU_COLLECTION_RERUN =
  "research-helper-menu-collection-rerun";

/**
 * Collection context menu ▸ Research Helper ▸ Summarize All Papers in
 * Collection (`P3-T29`, FR-19). `docs/08` §2.4 registers it under this id and
 * §10.2 ships its strings in both locales, owner-written.
 */
export const L10N_MENU_COLLECTION_SUMMARIZE_ALL =
  "research-helper-menu-collection-summarize-all";

/**
 * Collection context menu ▸ Research Helper ▸ Remove Generated Notes from
 * Collection… (`P3-T29`, FR-20). Not in the corpus's §10.2; the `en-US`
 * wording is provisional and the Korean is pending (`G-41`).
 */
export const L10N_MENU_COLLECTION_REMOVE_NOTES =
  "research-helper-menu-collection-remove-notes";

/**
 * Collection context menu ▸ Research Helper ▸ Generate Research Trends
 * Report… (`P4-T19`, FR-25). `docs/08` §2.4 registers it under this id and
 * §10.2 ships its strings in both locales, owner-written; FR-25's wording was
 * corrected to match on 2026-10-26 (owner, `plan/00` §6 item 286).
 */
export const L10N_MENU_COLLECTION_REPORT =
  "research-helper-menu-collection-report";

/**
 * The headline of the `Zotero.ProgressWindow` every job raises (`docs/07`
 * §7.7, `docs/08` §8.2; `P1-T32` item 3).
 *
 * Resolved once at startup by `src/bootstrap/registerUI.ts` and handed to
 * `src/bootstrap/container.ts`'s `installServices` as a
 * `ProgressHeadlineSource`: `ZoteroProgressWindowSink` takes an
 * **already-localized** string, `Zotero.getString()` throws on a plugin key
 * (`docs/08` §8.2.1), and Fluent is async while the popup factory is not.
 *
 * ## The surface that owns this string, and why it is the only headline id
 *
 * **Owner: `docs/07` §7.7's first surface — the `Zotero.ProgressWindow`, one
 * per job.** `P1-T33` retired `research-helper-import-toast-header`, which
 * `P1-T18` had declared for "the completion `ProgressWindow` toast (`docs/08`
 * §4.4, §8.2)" with the same en-US text and which no code ever named, after
 * deciding that §4.4's completion toast and §7.7's per-job popup are **one
 * surface, not two**. The four grounds, in the order they settle it:
 *
 * 1. **There is no toast mechanism for a second string to belong to.**
 *    `docs/08` §8.2.2 searched Zotero 7, 8, 9 and 10 and found no notification
 *    surface at all — no `Zotero.Notifications`, no toast element, no plugin
 *    entry point to the pane's banners. So §4.4's "toast" *is* a
 *    `Zotero.ProgressWindow`, which is §7.7's first surface and nothing else.
 *    The word names a timing, not a mechanism.
 * 2. **§7.7 allows exactly one window per job** (`P1-T31`'s clarification,
 *    which is also what `forJob()` builds), and §4.4 describes the
 *    `searchImport` job. The completion toast is therefore that job's one
 *    window rather than a second window beside it.
 * 3. **What the two sections disagree about is *when* the window opens, not
 *    *what* it is** — which is precisely what `P1-T31` encoded as
 *    `JobProgressOptions.openOn`: `"completion"` for §4.4's import, whose
 *    live progress is in the search window's status bar because that is where
 *    the Cancel button is, and `"progress"` for §7.7's short pipelines, which
 *    have no window of their own. One sink serves both values, and
 *    `ZoteroProgressWindowSink`'s own lifecycle note calls the popup it raises
 *    on a terminal snapshot "the completion toast `docs/08` §4.4 asks for".
 * 4. **Mechanically there is one headline slot, and no design for a second.**
 *    `ZoteroProgressWindowSink` takes a single `headline`, set once in its
 *    constructor and used for both `openOn` values. The retired id had no
 *    consumer and no designed one, which is why the 2026-10-03 grep found no
 *    code naming *either* id before `P1-T32` wired this one.
 *
 * **Which of the two survived was not arbitrary.** This is the id the
 * composition root actually resolves — `registerUI.ts`'s `PROGRESS_HEADLINE`,
 * asserted by `test/unit/bootstrap/container.test.ts` — and its name describes
 * the surface instead of one pipeline. The `import-` prefix on the retired id
 * scoped to `searchImport` a string that is **application-scoped**: it is the
 * product's name for the surface, not the job's, as
 * `ServiceGraphOptions.progressHeadline` records. Retiring this one instead
 * would also have meant editing two files outside `P1-T33`'s `Files`
 * (`plan/README.md` §5 rule 2).
 *
 * **Nothing about the text changed.** `P1-T32` recorded that the corpus
 * supplies no wording — `docs/08` §8.2's own example call passes the product
 * name as the headline — so the shipped en-US string stays the one already on
 * screen, and both it and the Korean remain `G-41`'s and the owner's.
 * Retirement removed a duplicate id, not a string.
 *
 * **The error that produced the duplicate is recorded, not tidied away.**
 * `P1-T32`'s item 3 asserted that `keys.ts` "declares no headline id", which
 * was false when written: `P1-T18`'s commit precedes it. The executing agent
 * found the overlap, added the general id as its card instructed, and reported
 * the clash rather than silently picking a side — because which id is right is
 * the surface judgement above and not a mechanical fix.
 */
export const L10N_PROGRESS_HEADLINE = "research-helper-progress-headline";

/**
 * The visible notice that jobs interrupted by the last quit resumed on their
 * own (`P3-T34`; `docs/07` §7.6, `plan/00` §6 item 250). `$count` is how many.
 * Shown by `src/core/jobQueue/queue.ts`'s `JobNotifier.resumed`, which no
 * surface implements yet; until one does, the queue resumes nothing.
 */
export const L10N_JOB_RESUMED = "research-helper-job-resumed";

/**
 * The question a job asks when it pauses at the batch wall-clock budget
 * (pause reason `wall-clock-budget`; owner, 2026-10-21, `plan/00` §6 item 265;
 * `docs/07` §7.5): "N of M done — continue the rest?". `$minutes` is the
 * budget in minutes (`WALL_CLOCK_BUDGET_DEFAULT_MS` in
 * `src/core/jobQueue/queue.ts`), `$total` the job's item count and `$done` the
 * items settled so far. No surface shows it yet; `P3-T29` builds the one that
 * does.
 */
export const L10N_JOB_WALL_CLOCK_BUDGET =
  "research-helper-job-wall-clock-budget";

/**
 * The egress disclosure's first-job notice (`P3-T15`; `docs/09` §3.6): shown
 * in the cost dialog while `privacy.egressAcknowledged` is `false`. Carried as
 * data by `src/pipeline/shared/egressDisclosure.ts`; rendered by `P3-T16`.
 */
export const L10N_EGRESS_FIRST_JOB_NOTICE =
  "research-helper-egress-first-job-notice";

/**
 * The Gemini free-tier warning (`P3-T15`; `docs/09` §3.6 item 3, verbatim):
 * shown on every job whose Gemini key's tier is free or unknown, with no
 * suppression path.
 */
export const L10N_EGRESS_GEMINI_FREE_TIER =
  "research-helper-egress-gemini-free-tier";

/**
 * The one-line reminder that replaces {@link L10N_EGRESS_GEMINI_FREE_TIER}
 * when the user has declared the Gemini key paid (`gemini.paidTier`; owner,
 * 2026-10-22, `plan/00` §6 item 269(b); `docs/09` §3.6 item 3's extension,
 * verbatim). Shown on every such job, with no suppression path.
 */
export const L10N_EGRESS_GEMINI_DECLARED_PAID =
  "research-helper-egress-gemini-declared-paid";

/**
 * A trend-report run's own egress notice (`P4-T16`; `docs/09` §3 row 3b;
 * `docs/07` §4.5's note of 2026-10-27): the generated summaries of `$papers`
 * papers, their titles, years and venues and the theme statistics, sent to
 * `$models` — every model the run sends to. Carried as data by
 * `src/pipeline/shared/egressDisclosure.ts`; placed with its arguments by the
 * cost dialog's model.
 */
export const L10N_EGRESS_REPORT_NOTICE = "research-helper-egress-report-notice";

/* ------------------------------------------------ searchDialog message ids */

/**
 * `research-helper-searchDialog.ftl` — everything the Search & Import window's
 * own document resolves through `data-l10n-id` (`docs/08` §4.2, §4.3, §4.5,
 * §4.6, §8.4).
 *
 * Order matches the file and the order a user meets the controls.
 *
 * `satisfies readonly FluentMessageId[]`, for the reason
 * {@link MAIN_WINDOW_MESSAGE_IDS} gives.
 */
export const SEARCH_DIALOG_MESSAGE_IDS = [
  "research-helper-search-window-title",

  // Query row.
  "research-helper-search-keyword-label",
  "research-helper-search-keyword-input",
  "research-helper-search-run",
  "research-helper-search-mode-keyword",
  // FR-12's mode chip, `Re-run: <collection name>` (P2-T17).
  "research-helper-search-mode-rerun",

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
  // FR-2's third scenario: the Semantic Scholar no-key notice and its link
  // (`P2-T14`; `plan/00` §6 item 170 — rendered from the
  // `semanticscholar.keyPresent` flag, not from the adapter's English note).
  "research-helper-search-s2-no-key",
  "research-helper-search-s2-no-key-request",

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
  // `P2-T14`: the flagged-duplicate badge and the linked-version badge.
  "research-helper-search-row-duplicate",
  "research-helper-search-row-linked",
  // The deduplication tiers' names, resolved to text for the duplicate
  // badge's `{ $tier }` (owner, 2026-10-19, `plan/00` §6 item 206;
  // `DEDUP_TIER_NAME_KEYS` in src/ui/viewModels/searchImportViewModel.ts).
  "research-helper-search-tier-title-exact",
  "research-helper-search-tier-title-fuzzy",
  "research-helper-search-tier-version-link",

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
  // The preprint/published-version rule, gate G-16 (P2-T11). Declared here;
  // P2-T14 places it in the duplicate-handling area.
  "research-helper-search-preprint-policy",

  // Window buttons.
  "research-helper-search-close",
  "research-helper-search-cancel",
  "research-helper-search-import",

  // FR-8's third scenario: the status-bar export control and its two outcome
  // sentences (`P1-T45`). This surface and no other — the control is a child of
  // `#rh-search-status-bar` in `addon/content/searchDialog.xhtml`, which is this
  // window's own document, so all three belong here rather than in
  // `MAIN_WINDOW_MESSAGE_IDS`. None of the three takes an argument: see
  // {@link L10N_EXPORT_TAKES_NO_PATH} for why the success sentence does not
  // name the file it wrote.
  "research-helper-search-export",
  "research-helper-search-export-written",
  "research-helper-search-export-failed",

  // docs/08 §8.4's five states: INITIAL.
  "research-helper-search-state-initial",

  // FR-12's Re-run (pre-filled from provenance) panel, docs/08 §4.6 (P2-T17):
  // the banner, the date radio pair, the All-years span and rule 4's summary.
  "research-helper-search-rerun-heading",
  "research-helper-search-rerun-recorded",
  "research-helper-search-rerun-as-recorded",
  "research-helper-search-rerun-advance",
  "research-helper-search-rerun-prefilled",
  "research-helper-search-rerun-press-search",
  "research-helper-search-rerun-all-years",
  "research-helper-search-import-summary-rerun",

  // LOADING, including the per-database status list docs/08 §4.6 requires.
  "research-helper-search-source-searching",
  "research-helper-search-source-results",
  "research-helper-search-source-failed",
  "research-helper-search-progress-databases",
  "research-helper-search-status-searching",
  "research-helper-search-status-importing",
  // `docs/08` §4.2's reserved `⊕` role row for bioRxiv and medRxiv
  // (`P2-T14`; `plan/00` §6 item 182 — rendered from
  // `capabilities.keywordSearch`, not from the adapter's English notice).
  "research-helper-search-source-role",

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
  // Item 232 (owner, 2026-10-21): a source refused with HTTP 429 after the
  // client's own retries. Here and not in the mainWindow bundle: only this
  // window's document resolves it, through `data-l10n-id`, and it is not a
  // `ResearchHelperError.messageKey` (`rh-error-rate-limit` stays that).
  "research-helper-search-error-rate-limit",

  // NFR-14's details disclosure for raw upstream text.
  "research-helper-search-details-show",
  "research-helper-search-details-hide",

  // `P3-T27`: relevance screening (docs/08 §4.2's threshold row, docs/12 §3).
  "research-helper-search-screening-enable",
  "research-helper-search-screening-threshold-label",
  "research-helper-search-screening-threshold-input",
  "research-helper-search-screening-show-excluded",
  "research-helper-search-screening-count",
  "research-helper-search-screening-unscored",
  "research-helper-search-screening-failed",
  "research-helper-search-row-relevance",
  // Owner, 2026-10-24, `plan/00` §6 item 281(b): the estimated cost beside
  // the screening checkbox (docs/08 §4.2's note of that date).
  "research-helper-search-screening-cost",
  "research-helper-search-screening-cost-unpriced",
] as const satisfies readonly FluentMessageId[];

export type SearchDialogMessageId = (typeof SEARCH_DIALOG_MESSAGE_IDS)[number];

/* ------------------------------------------------ reportWindow message ids */

/**
 * `research-helper-reportWindow.ftl` — everything the report window's own
 * document resolves (`docs/08` §6.4, §10.1; `P4-T19`). The window owns a
 * window, so it owns a bundle; `addon/content/reportWindow.xhtml` links this
 * file and no other. See `REPORT_WINDOW_L10N` in `src/ui/panes/reportWindow.ts`.
 *
 * Order matches the file. `satisfies readonly FluentMessageId[]`, for the
 * reason {@link MAIN_WINDOW_MESSAGE_IDS} gives.
 */
export const REPORT_WINDOW_MESSAGE_IDS = [
  "research-helper-report-title",
  "research-helper-report-collection",
  // The per-run language override (docs/08 §6.4, §10.4): the label and the
  // four values of `reportLanguage` (docs/07 §8.5).
  "research-helper-report-language-label",
  "research-helper-report-language-auto",
  "research-helper-report-language-en",
  "research-helper-report-language-ko",
  "research-helper-report-language-both",
  // The resolved report model as text (owner, plan/00 §6 item 286).
  "research-helper-report-model",
  "research-helper-report-model-none",
  "research-helper-report-close",
] as const satisfies readonly FluentMessageId[];

export type ReportWindowMessageId = (typeof REPORT_WINDOW_MESSAGE_IDS)[number];

/**
 * Why none of `P1-T45`'s three export ids is in {@link FluentMessageArgsMap},
 * and why the absence is a security property rather than an omission.
 *
 * The success sentence a user would expect is "Written to
 * `/Users/<name>/Desktop/run.json`", which needs a `{ $path }` placeable. **It
 * must not exist.** `docs/09` §2.2's 2026-10-08 paragraph settles that a
 * user-chosen filesystem path is not written to the debug log, because a path
 * carries an account name; a placeable would put the same string on the screen,
 * where screenshots, screen recordings and bug reports read it — the exposure
 * `P1-T21` closed for the result table and
 * {@link EMPTY_HEADLINE_OMITTED} for the EMPTY panel.
 *
 * So the argument map is where this is enforced: with no entry here,
 * `FluentArgsParam` types the lookup as taking no arguments at all, and a later
 * card that tries to pass a path does not compile. The window script never
 * holds the path beyond the one call that hands it to
 * `host.exportProvenance(path)`.
 */
export const L10N_EXPORT_TAKES_NO_PATH =
  "research-helper-search-export-written takes no { $path }; see " +
  "L10N_EXPORT_TAKES_NO_PATH in src/i18n/keys.ts";

/**
 * Every message id this file assigns to a surface.
 *
 * Equal in extent to {@link FluentMessageId} — the two `satisfies` clauses
 * above give one inclusion and {@link UndeclaredBundleMessageId} the other —
 * but *not* the same type: this one carries the surface partition, which the
 * generator cannot express.
 */
export type DeclaredMessageId =
  MainWindowMessageId | SearchDialogMessageId | ReportWindowMessageId;

/**
 * The ids the bundles declare that this file assigns to no surface. **Must be
 * empty**, and a `TS2344` here names the ids that were added to an `.ftl` and
 * never given a surface.
 *
 * This is the second half of `P1-T30`'s single source of truth. Without it the
 * `satisfies` clauses above would only prove that this file names nothing the
 * bundles lack; with it, the two sets are provably the same 85 ids (84 until
 * `P1-T32` added the progress headline) and neither side can move alone.
 */
export type UndeclaredBundleMessageId = AssertNever<
  Exclude<FluentMessageId, DeclaredMessageId>
>;

/** The shipped surfaces and the ids each one's bundle must contain. */
export const MESSAGE_IDS_BY_SURFACE: {
  readonly [S in ShippedSurface]: readonly FluentMessageId[];
} = {
  mainWindow: MAIN_WINDOW_MESSAGE_IDS,
  searchDialog: SEARCH_DIALOG_MESSAGE_IDS,
  reportWindow: REPORT_WINDOW_MESSAGE_IDS,
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
 * The `messageKey` of every error class the shipped code can throw,
 * transcribed from `src/core/errors.ts` (`docs/07` §10.1): Phase 1's sixteen,
 * since `P3-T05` (2026-10-20) the four of the LLM subtree, and since
 * 2026-10-21 `PrivacyRoutingError`'s (`plan/00` §6 item 262(c)) and
 * `OutputTruncatedError`'s (item 265(c)). `test/integration/l10n.spec.ts`
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
  // `P3-T05` (2026-10-20): the LLM subtree of `docs/07` §10.1, reachable
  // through `mapProviderError` in `src/llm/shared/errorMap.ts`.
  "rh-error-llm",
  "rh-error-context-length",
  "rh-error-content-filter",
  "rh-error-structured-output",
  // Item 265(c) (owner, 2026-10-21): `OutputTruncatedError`, thrown for a
  // truncated answer by `completeJSON` in `src/llm/shared/jsonMode.ts`.
  "rh-error-output-truncated",
  // Item 262(c) (owner, 2026-10-21): `PrivacyRoutingError`, thrown for
  // OpenRouter's guardrail 404 by `openRouterGuardrailError` in
  // `src/llm/openrouter/mapper.ts`.
  "rh-error-privacy-routing",
  // P3-T16 (2026-10-23): `BudgetExceededError`, thrown by the budget guard's
  // reservation (`createBudgetGuard` in src/pipeline/shared/budget.ts).
  "rh-error-budget",
] as const satisfies readonly MainWindowMessageId[];

/**
 * The `messageKey`s `docs/07` §10.1 declares that the plugin deliberately
 * ships no message for yet, because no shipped code path can throw them: they
 * belong to the TTS and budget subsystems, and to the privacy-mode policy
 * check that goes with them. Seven until 2026-10-20, when `P3-T05` moved the
 * four LLM keys (`rh-error-llm`, `rh-error-context-length`,
 * `rh-error-content-filter`, `rh-error-structured-output`) to
 * {@link ERROR_MESSAGE_IDS} with their `en-US` strings; three since, and two
 * since 2026-10-23, when `P3-T16` moved `rh-error-budget` there with the budget
 * guard that throws it.
 *
 * Listed rather than ignored so the gap is asserted: `plan/README.md` §5 rule 2
 * forbids adding strings this card does not cover, and
 * `test/integration/l10n.spec.ts` checks that the `rh-error-*` keys reachable
 * from `src/core/errors.ts` are exactly `ERROR_MESSAGE_IDS` ∪ this list. A new
 * error class, or a Phase 3 card wiring one of these into a Phase 1 path, fails
 * that assertion instead of rendering a blank label.
 */
export const DEFERRED_ERROR_MESSAGE_IDS = [
  "rh-error-tts",
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
  // --- mainWindow (25, then `P1-T44`'s pane strings) ---
  // `P1-T32` item 3. Gate `G-41` owns the translation; the `ko-KR` bundle
  // carries the id as a commented stub with its English source, and nothing
  // was machine-translated. `P1-T33` retired
  // `research-helper-import-toast-header` from this list with it: the two were
  // one surface's headline declared twice, and `G-41` now has one product-name
  // decision here instead of two identical ones. See L10N_PROGRESS_HEADLINE.
  // `P1-T44`'s preference-pane strings. `G-41` owns the translation; the
  // `ko-KR` bundle is outside that card's `Files` list, so it carries no
  // commented stubs for these yet (reported with the card). Nothing was
  // machine-translated. "API", "NCBI", "PubMed" and "Semantic Scholar" are
  // names and exempt from translation (`docs/08` §10.3), but every message
  // here carries prose around them, so all are pending.
  // `research-helper-prefs-backend-indeterminate` left this list on 2026-10-15
  // (`P2-T34`): `docs/09` §1.9 ships the owner's Korean for it, so it is on
  // KO_PRESENT.
  // `research-helper-prefs-risk-1-session` left this list on 2026-10-23: the
  // owner reviewed its Korean (`G-41`, plan/00 §6 item 275(a)), so it is on
  // KO_PRESENT with `research-helper-prefs-risk-4-session`.
  // The out-of-credit Test line (owner, 2026-10-23, `plan/00` §6 item
  // 279(a)); a commented `ko-KR` stub, nothing machine-translated (`G-41`).
  // `P3-T14`'s twenty pane strings (the 429 pass, the model suggestions, the
  // price table). `G-41` owns the translation; the `ko-KR` bundle carries each
  // as a commented stub with its English source, and nothing was
  // machine-translated.
  // `P3-T29`'s summarize window and removal command (24) left this list on
  // 2026-10-29: the owner approved the coordinator's Korean (`G-41`, plan/00
  // §6 item 304), so all twenty-four are on KO_PRESENT.
  // The item pane's two result lines (owner, plan/00 §6 item 303(a), (b))
  // left this list on 2026-10-29: the owner approved the coordinator's Korean
  // (`G-41`, plan/00 §6 item 305(d)), so both are on KO_PRESENT.
  // `P4-T05`'s stop message for too many themes (plan/00 §6 items 292(d),
  // 306(b)). `G-41` owns the translation; the `ko-KR` bundle carries it as a
  // commented stub with its English source, and nothing was
  // machine-translated. The coordinator drafts the Korean for the owner.
  "research-helper-report-stopped-too-many-themes",
  // --- searchDialog (62) ---
  // `P1-T45`. On this list and not on `KO_PRESENT`: the `ko-KR` bundle carries
  // all three as commented stubs with their English source, which the
  // localization spec counts as absent — correctly, because a commented line
  // resolves to nothing at runtime. `G-41` owns the translation; the owner
  // deferred Korean on 2026-10-08 and nothing here was machine-translated.
  // "JSON" itself is exempt from translation (`docs/08` §10.3).
  // `P3-T27`'s eight relevance-screening strings. `G-41` owns the
  // translation; the `ko-KR` bundle carries each as a commented stub with its
  // English source, and nothing was machine-translated.
  // The screening cost line (owner, 2026-10-24, `plan/00` §6 item 281(b)); a
  // commented `ko-KR` stub each, nothing machine-translated (`G-41`).
  // `P4-T16`'s report notice and the report's three cost-dialog lines
  // (`plan/00` §6 item 291) left this list on 2026-10-27: the owner reviewed
  // the coordinator's Korean (`G-41`, plan/00 §6 item 292(a)), so all four
  // are on KO_PRESENT.
  // `P3-T28`'s fifteen item-pane section strings (plan/00 §6 item 302) left
  // this list on 2026-10-29: the owner approved the coordinator's Korean
  // (`G-41`, plan/00 §6 item 304), so all fifteen are on KO_PRESENT.
  // --- reportWindow (10) ---
  // `P4-T19`'s report window (plan/00 §6 item 306(b)). `G-41` owns the
  // translation; the `ko-KR` bundle carries each as a commented stub with its
  // English source, and nothing was machine-translated. The coordinator drafts
  // the Korean for the owner.
  "research-helper-report-title",
  "research-helper-report-collection",
  "research-helper-report-language-label",
  "research-helper-report-language-auto",
  "research-helper-report-language-en",
  "research-helper-report-language-ko",
  "research-helper-report-language-both",
  "research-helper-report-model",
  "research-helper-report-model-none",
  "research-helper-report-close",
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
 * owner supplied (`docs/08` §10.2, and `docs/09` §1.9's badge wording since
 * 2026-10-15) plus everything `docs/08` §10.3 forbids translating.
 */
export const KO_PRESENT = [
  "research-helper-menu-root",
  "research-helper-menu-search-import",
  // FR-12's entry: owner-written Korean in `docs/08` §10.2 (`P2-T17`).
  "research-helper-menu-collection-rerun",
  // FR-19's entry: owner-written Korean in `docs/08` §10.2 (`P3-T29`).
  "research-helper-menu-collection-summarize-all",
  // FR-25's entry: owner-written Korean in `docs/08` §10.2 (`P4-T19`).
  "research-helper-menu-collection-report",
  "research-helper-source-pubmed",
  "research-helper-source-europepmc",
  "research-helper-source-crossref",
  "research-helper-source-arxiv",
  "research-helper-source-semanticscholar",
  "research-helper-source-biorxiv",
  "research-helper-source-medrxiv",
  // The four LLM provider names (owner, 2026-10-21, plan/00 §6 item 262(b)):
  // `docs/08` §10.3 forbids translating a provider name, so `ko-KR` carries
  // the English verbatim, as it does the source names above.
  "research-helper-provider-openrouter",
  "research-helper-provider-openai",
  "research-helper-provider-anthropic",
  "research-helper-provider-gemini",
  "research-helper-search-col-doi",
  // The key-storage badge's fifth state: owner-written Korean in `docs/09`
  // §1.9 (decided 2026-10-15, review row 50; `P2-T34`).
  "research-helper-prefs-backend-indeterminate",
  // `P2-T14`'s five and `P2-T11`'s policy line: Korean drafted by the
  // coordinator and reviewed by the owner on 2026-10-16 (`G-41`).
  "research-helper-search-s2-no-key",
  "research-helper-search-s2-no-key-request",
  "research-helper-search-row-duplicate",
  "research-helper-search-row-linked",
  "research-helper-search-source-role",
  "research-helper-search-preprint-policy",
  // `P2-T17`'s nine (FR-12's re-run state) and `P2-T18`'s three (the import
  // paths and the `useTranslators` checkbox): Korean drafted by the coordinator
  // and reviewed by the owner on 2026-10-16 (`G-41`). "translator" follows
  // Zotero's own Korean interface, which says 중계기.
  "research-helper-search-mode-rerun",
  "research-helper-search-rerun-heading",
  "research-helper-search-rerun-recorded",
  "research-helper-search-rerun-as-recorded",
  "research-helper-search-rerun-advance",
  "research-helper-search-rerun-prefilled",
  "research-helper-search-rerun-press-search",
  "research-helper-search-rerun-all-years",
  "research-helper-search-import-summary-rerun",
  "research-helper-import-paths",
  "research-helper-import-fallback-reason",
  "research-helper-prefs-use-translators",
  // Item 206's three deduplication tier names: Korean drafted by the
  // coordinator and reviewed by the owner on 2026-10-19 (`G-41`).
  "research-helper-search-tier-title-exact",
  "research-helper-search-tier-title-fuzzy",
  "research-helper-search-tier-version-link",
  // Item 232's refused-429 row: Korean drafted by the coordinator and
  // reviewed by the owner on 2026-10-20 (`G-41`).
  "research-helper-search-error-rate-limit",
  // `P3-T05`'s four LLM error strings: Korean drafted by the coordinator and
  // reviewed by the owner on 2026-10-20 (`G-41`).
  "rh-error-llm",
  "rh-error-context-length",
  "rh-error-content-filter",
  "rh-error-structured-output",
  // P3-T34's resume notice: Korean drafted by the coordinator and reviewed
  // by the owner on 2026-10-21 (`G-41`).
  "research-helper-job-resumed",
  // Item 262(c)'s guardrail message: Korean drafted by the coordinator and
  // reviewed by the owner on 2026-10-21 (`G-41`).
  "rh-error-privacy-routing",
  // Item 265's truncation message and wall-clock budget question: Korean
  // drafted by the coordinator and reviewed by the owner on 2026-10-21 (`G-41`).
  "rh-error-output-truncated",
  "research-helper-job-wall-clock-budget",
  // P3-T15's two egress notices: Korean drafted by the coordinator and
  // reviewed by the owner on 2026-10-22 (`G-41`, plan/00 §6 item 269(a)).
  "research-helper-egress-first-job-notice",
  "research-helper-egress-gemini-free-tier",
  // The Gemini declared-paid reminder: Korean drafted by the coordinator and
  // reviewed by the owner on 2026-10-23 (`G-41`, plan/00 §6 item 270(b)).
  "research-helper-egress-gemini-declared-paid",
  // P3-T03's key-storage dialog: Korean drafted by the coordinator and
  // reviewed by the owner on 2026-10-22 (`G-41`, plan/00 §6 item 268(a)).
  "research-helper-secret-backend-title",
  "research-helper-secret-backend-explain",
  "research-helper-secret-backend-session",
  "research-helper-secret-backend-none",
  "research-helper-secret-backend-accept",
  "research-helper-secret-backend-decline",
  // P3-T04's fourteen pane strings and P3-T16's twenty-nine (the budget error,
  // the cost dialog and the Usage section): Korean drafted by the coordinator
  // and reviewed by the owner on 2026-10-23 (`G-41`, plan/00 §6 item 274).
  "research-helper-prefs-backend-session",
  "research-helper-prefs-restore-note",
  "research-helper-prefs-providers",
  "research-helper-prefs-active-provider",
  "research-helper-prefs-api-key",
  "research-helper-prefs-model",
  "research-helper-prefs-base-url",
  "research-helper-prefs-base-url-saved",
  "research-helper-prefs-base-url-default",
  "research-helper-prefs-base-url-not-https",
  "research-helper-prefs-base-url-trailing-slash",
  "research-helper-prefs-base-url-invalid",
  "research-helper-prefs-gemini-paid-tier",
  "research-helper-prefs-gemini-paid-tier-note",
  "rh-error-budget",
  "research-helper-cost-title",
  "research-helper-cost-items",
  "research-helper-cost-destination",
  "research-helper-cost-calls",
  "research-helper-cost-input",
  "research-helper-cost-output",
  "research-helper-cost-total",
  "research-helper-cost-unpriced",
  "research-helper-cost-disclaimer",
  "research-helper-cost-above-threshold",
  "research-helper-cost-acknowledge",
  "research-helper-cost-acknowledge-unpriced",
  "research-helper-cost-downgrade",
  "research-helper-cost-downgrade-preselected",
  "research-helper-cost-ceiling-preflight",
  "research-helper-cost-ceiling-reached",
  "research-helper-cost-usage-job",
  "research-helper-cost-usage-session",
  "research-helper-cost-usage-estimated",
  "research-helper-cost-dont-ask",
  "research-helper-cost-run",
  "research-helper-cost-cancel",
  "research-helper-cost-continue",
  "research-helper-cost-stop",
  "research-helper-cost-skipped-notice",
  "research-helper-prefs-usage",
  "research-helper-prefs-usage-limit",
  "research-helper-prefs-usage-limit-off",
  // docs/09 §1.8's two tier-2 replacements (paragraphs 1 and 4): Korean
  // drafted by the coordinator and reviewed by the owner on 2026-10-23
  // (`G-41`, plan/00 §6 item 275).
  "research-helper-prefs-risk-1-session",
  "research-helper-prefs-risk-4-session",
  // item 284(a), batches 1-4: Korean drafted by the coordinator and reviewed by the owner on
  // 2026-10-25 (`G-41`).
  "research-helper-menu-collection-search-import",
  "research-helper-provenance-note-title",
  "research-helper-import-summary",
  "research-helper-import-abstract-coverage",
  "research-helper-progress-headline",
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
  "research-helper-prefs-storage",
  "research-helper-prefs-backend-windows",
  "research-helper-prefs-backend-mac",
  "research-helper-prefs-backend-unavailable",
  "research-helper-prefs-risk-1",
  "research-helper-prefs-risk-2",
  "research-helper-prefs-risk-3",
  "research-helper-prefs-risk-4",
  "research-helper-prefs-risk-5",
  "research-helper-prefs-remove-all",
  "research-helper-prefs-remove-all-done",
  "research-helper-prefs-ncbi",
  "research-helper-prefs-ncbi-note",
  "research-helper-prefs-ncbi-key",
  "research-helper-prefs-s2",
  "research-helper-prefs-s2-note",
  "research-helper-prefs-s2-key",
  "research-helper-prefs-s2-request",
  "research-helper-prefs-reveal",
  "research-helper-prefs-test-key",
  "research-helper-prefs-clear-key",
  "research-helper-prefs-key-absent",
  "research-helper-prefs-key-absent-os",
  "research-helper-prefs-key-present",
  "research-helper-prefs-key-cleared",
  "research-helper-prefs-store-unavailable",
  "research-helper-prefs-store-empty",
  "research-helper-prefs-test-running",
  "research-helper-prefs-test-ok",
  "research-helper-prefs-test-inconclusive",
  "research-helper-prefs-test-rejected",
  "research-helper-prefs-test-forbidden",
  "research-helper-prefs-test-absent",
  "research-helper-prefs-test-unavailable",
  "research-helper-prefs-test-ok-no-credit",
  "research-helper-prefs-test-ok-rate-limited",
  "research-helper-prefs-model-suggestions",
  "research-helper-prefs-models-as-of",
  "research-helper-prefs-models-stale",
  "research-helper-prefs-prices",
  "research-helper-prefs-prices-note",
  "research-helper-prefs-price-row",
  "research-helper-prefs-price-row-no-cached",
  "research-helper-prefs-price-model",
  "research-helper-prefs-price-input",
  "research-helper-prefs-price-output",
  "research-helper-prefs-price-cached",
  "research-helper-prefs-price-as-of",
  "research-helper-prefs-price-save",
  "research-helper-prefs-price-remove",
  "research-helper-prefs-price-saved",
  "research-helper-prefs-price-removed",
  "research-helper-prefs-price-invalid",
  "research-helper-prefs-price-refused",
  "research-helper-prefs-price-unavailable",
  // item 284(a), batches 5-7: Korean drafted by the coordinator and reviewed by the owner on
  // 2026-10-25 (`G-41`).
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
  "research-helper-search-export",
  "research-helper-search-export-written",
  "research-helper-search-export-failed",
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
  "research-helper-search-screening-enable",
  "research-helper-search-screening-threshold-label",
  "research-helper-search-screening-threshold-input",
  "research-helper-search-screening-show-excluded",
  "research-helper-search-screening-count",
  "research-helper-search-screening-unscored",
  "research-helper-search-screening-failed",
  "research-helper-search-row-relevance",
  "research-helper-search-screening-cost",
  "research-helper-search-screening-cost-unpriced",
  // `P4-T16`'s report notice and the report's three cost-dialog lines: Korean
  // drafted by the coordinator and reviewed by the owner on 2026-10-27
  // (`G-41`, plan/00 §6 item 292(a)).
  "research-helper-egress-report-notice",
  "research-helper-cost-report-summaries",
  "research-helper-cost-report-writing",
  "research-helper-cost-report-review",
  // `P3-T28`'s fifteen item-pane strings and `P3-T29`'s twenty-four summarize
  // window and removal strings: Korean drafted by the coordinator and reviewed
  // by the owner on 2026-10-29 (`G-41`, plan/00 §6 item 304), inserted byte for
  // byte from plan/reports/ko-review-304.ftl.
  "research-helper-itempane-header",
  "research-helper-itempane-sidenav",
  "research-helper-itempane-empty",
  "research-helper-itempane-generate",
  "research-helper-itempane-loading",
  "research-helper-itempane-cancel",
  "research-helper-itempane-failed",
  "research-helper-itempane-retry",
  "research-helper-itempane-no-key",
  "research-helper-itempane-open-preferences",
  "research-helper-itempane-research-question",
  "research-helper-itempane-key-findings",
  "research-helper-itempane-limitations",
  "research-helper-itempane-btn-regenerate",
  "research-helper-itempane-btn-save-note",
  "research-helper-menu-collection-remove-notes",
  "research-helper-summarize-title",
  "research-helper-summarize-collection",
  "research-helper-summarize-resummarize",
  "research-helper-summarize-write-notes",
  "research-helper-summarize-notes-readonly",
  "research-helper-summarize-start",
  "research-helper-summarize-cancel",
  "research-helper-summarize-close",
  "research-helper-summarize-export",
  "research-helper-summarize-stage",
  "research-helper-summarize-progress",
  "research-helper-summarize-remaining",
  "research-helper-summarize-row",
  "research-helper-summarize-counts",
  "research-helper-summarize-outcome",
  "research-helper-summarize-key-needed",
  "research-helper-summarize-continue",
  "research-helper-summarize-stop",
  "research-helper-summarize-export-outcome",
  "research-helper-remove-notes-title",
  "research-helper-remove-notes-confirm",
  "research-helper-remove-notes-none",
  "research-helper-remove-notes-done",
  // The item pane's two result lines (plan/00 §6 item 303(a), (b)): Korean
  // drafted by the coordinator and reviewed by the owner on 2026-10-29
  // (`G-41`, plan/00 §6 item 305(d)), inserted byte for byte from
  // plan/reports/ko-review-305.ftl.
  "research-helper-itempane-not-summarized",
  "research-helper-itempane-note-not-written",
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
  // P2-T18. `$cause` is a fallback-reason token (`TRANSLATOR_FALLBACK_REASONS`
  // in `src/zotero/translatorImport.ts`), selected on and never displayed.
  "research-helper-import-paths": { translated: number; handMapped: number };
  "research-helper-import-fallback-reason": { cause: string; count: number };
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
  // `P3-T05`. `$provider` is the provider's display name and `$model` the
  // model ID, both untranslated (`docs/08` §10.3). `rh-error-content-filter`
  // takes no argument: it is `docs/07` §10.2's sentence as written.
  "rh-error-llm": { provider: string };
  "rh-error-context-length": { model: string };
  "rh-error-structured-output": { provider: string };
  // Item 265(c). `$model` is the model whose answer was cut off, untranslated.
  "rh-error-output-truncated": { model: string };
  // Item 262(c). `$model` is the model ID the request named, untranslated.
  "rh-error-privacy-routing": { model: string };
  // P3-T16. Every money, token and date argument is a string the caller
  // formatted with `Intl` (docs/08 §10.3); `$calls`, `$items` and the other
  // counts are numbers (plural selectors); `$ceiling` (`run` | `session`) and
  // `$mode` (`strict` | `balanced` | `full`) are selectors only.
  "rh-error-budget": { limit: string; spent: string };
  "research-helper-cost-items": {
    items: number;
    fullText: number;
    abstract: number;
    cached: number;
    metadata: number;
  };
  "research-helper-cost-destination": {
    provider: string;
    host: string;
    model: string;
    mode: string;
  };
  "research-helper-cost-calls": { calls: number };
  "research-helper-cost-input": { tokens: string };
  "research-helper-cost-output": { tokens: string };
  "research-helper-cost-total": { cost: string };
  "research-helper-cost-unpriced": { model: string };
  "research-helper-cost-disclaimer": { date: string };
  "research-helper-cost-above-threshold": { threshold: string };
  "research-helper-cost-acknowledge": { cost: string };
  "research-helper-cost-downgrade": { cost: string };
  "research-helper-cost-downgrade-preselected": { max: number };
  "research-helper-cost-ceiling-preflight": {
    ceiling: string;
    limit: string;
    spent: string;
    raised: string;
  };
  "research-helper-cost-ceiling-reached": {
    ceiling: string;
    limit: string;
    spent: string;
    raised: string;
  };
  "research-helper-cost-usage-job": {
    calls: number;
    input: string;
    output: string;
    cost: string;
  };
  "research-helper-cost-usage-session": {
    calls: number;
    input: string;
    output: string;
    cost: string;
  };
  "research-helper-cost-skipped-notice": { cost: string; calls: number };
  "research-helper-prefs-usage-limit": { limit: string };
  // P4-T16. `$papers`, `$calls` and `$themes` are numbers and plural
  // selectors; `$model` is a model ID and `$models` a list of model IDs joined
  // with `Intl.ListFormat` over the application locale — names, never
  // translated (docs/08 §10.3).
  "research-helper-egress-report-notice": { papers: number; models: string };
  "research-helper-cost-report-summaries": { calls: number; model: string };
  "research-helper-cost-report-writing": {
    calls: number;
    themes: number;
    model: string;
  };
  "research-helper-cost-report-review": { calls: number; model: string };
  // The preference pane (P1-T44). `$count` is a plural selector; `$time` is a
  // clock time the pane script has already formatted with
  // `Intl.DateTimeFormat` over `Zotero.locale` (docs/08 §10.3). **No message
  // takes the key, the digest, or any part of either** — the status row is
  // painted from an outcome enum and a timestamp, and that absence is a
  // security property, not an omission (docs/09 §2.3: "never store or display
  // any part of the key in the validation result").
  "research-helper-prefs-remove-all-done": { count: number };
  "research-helper-prefs-test-ok": { time: string };
  "research-helper-prefs-test-inconclusive": { time: string };
  "research-helper-prefs-test-rejected": { time: string };
  "research-helper-prefs-test-forbidden": { time: string };
  // P3-T14. `$date` is formatted by the pane script with `Intl.DateTimeFormat`
  // over `Zotero.locale`; the four prices with `Intl.NumberFormat`. `$model`
  // is a model ID and `$provider` a provider's display name, neither
  // translated (docs/08 §10.3). No message takes any part of a key.
  "research-helper-prefs-test-ok-rate-limited": { time: string };
  // Owner, 2026-10-23, plan/00 §6 item 279(a). `$time` as above.
  "research-helper-prefs-test-ok-no-credit": { time: string };
  "research-helper-prefs-models-as-of": { date: string };
  "research-helper-prefs-models-stale": { date: string };
  "research-helper-prefs-price-row": {
    provider: string;
    model: string;
    input: string;
    output: string;
    cached: string;
    date: string;
  };
  "research-helper-prefs-price-row-no-cached": {
    provider: string;
    model: string;
    input: string;
    output: string;
    date: string;
  };
  // P3-T34: how many interrupted jobs resumed.
  "research-helper-job-resumed": { count: number };
  // Item 265(a): `$minutes` is a plural selector (the budget, 30); `$done`
  // and `$total` are item counts.
  "research-helper-job-wall-clock-budget": {
    minutes: number;
    done: number;
    total: number;
  };
  // P3-T29: the summarize window and the removal command. `$stage`,
  // `$status`, `$outcome` and the export's `$outcome` are selectors; the
  // titles and the collection name are the user's own text.
  "research-helper-summarize-collection": { name: string; count: number };
  "research-helper-summarize-stage": { stage: string };
  "research-helper-summarize-progress": {
    done: number;
    total: number;
    cached: number;
    fresh: number;
  };
  "research-helper-summarize-remaining": { minutes: number };
  "research-helper-summarize-row": { status: string; title: string };
  "research-helper-summarize-counts": {
    fulltext: number;
    abstract: number;
    notext: number;
    retracted: number;
    duplicate: number;
  };
  "research-helper-summarize-outcome": {
    outcome: string;
    done: number;
    total: number;
    at: number;
    failed: number;
    notes: number;
  };
  "research-helper-summarize-key-needed": { provider: string };
  "research-helper-summarize-export-outcome": { outcome: string };
  "research-helper-remove-notes-confirm": { count: number; collection: string };
  "research-helper-remove-notes-none": { collection: string };
  "research-helper-remove-notes-done": { count: number };
  // The item pane's result lines (plan/00 §6 item 303(a), (b)): `$reason`
  // is a selector (NotSummarizedReason; "exists" / "read-only").
  "research-helper-itempane-not-summarized": { reason: string };
  "research-helper-itempane-note-not-written": { reason: string };
  // P4-T05 (plan/00 §6 item 292(d)): `$themes` is the second answer's theme
  // count, `$max` is MAX_THEMES.
  "research-helper-report-stopped-too-many-themes": {
    themes: number;
    max: number;
  };

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
  // Item 232. `$database` is the refused source's display name.
  "research-helper-search-error-rate-limit": { database: string };
  // `P2-T14`: `$tier` is the deciding deduplication tier's name, already
  // resolved from a `research-helper-search-tier-*` message (item 206; its id
  // only when no name resolved); `$score` the similarity as a whole
  // percentage.
  "research-helper-search-row-duplicate": { tier: string; score: number };
  // `P3-T27`: `$score` is the model's 0–100 relevance score; `$kept` the
  // rows the threshold keeps (unscored rows included), `$total` every row,
  // `$excluded` the scored rows below it; `$count` the unscored rows.
  "research-helper-search-row-relevance": { score: number };
  "research-helper-search-screening-count": {
    kept: number;
    total: number;
    excluded: number;
  };
  "research-helper-search-screening-unscored": { count: number };
  // Item 281(b) (owner, 2026-10-24): `$cost` is the estimate, already
  // formatted as currency for the application locale; `$count` the most
  // results the search can return; `$model` the model id (not translated).
  "research-helper-search-screening-cost": { cost: string; count: number };
  "research-helper-search-screening-cost-unpriced": { model: string };
  // `P2-T17`, FR-12. `$collection` is the collection's own name (data, not a
  // translatable string); `$date` the recorded run's finish date, already
  // formatted by the window. `$present` is `linkedExisting + skipped` — see
  // `rerunSummary` in src/ui/viewModels/searchImportViewModel.ts.
  "research-helper-search-mode-rerun": { collection: string };
  "research-helper-search-rerun-heading": { collection: string };
  "research-helper-search-rerun-recorded": {
    date: string;
    databases: number;
    retrieved: number;
    imported: number;
  };
  "research-helper-search-import-summary-rerun": {
    imported: number;
    present: number;
    failed: number;
  };
  // reportWindow (P4-T19). `$name` is the user's own text; `$count` selects
  // the plural; `$model` is a model id and `$provider` a provider's display
  // name, neither translated (docs/08 §10.3).
  "research-helper-report-collection": { name: string; count: number };
  "research-helper-report-model": { model: string; provider: string };
}

/**
 * The keys of {@link FluentMessageArgsMap} that no bundle declares. **Must be
 * empty.**
 *
 * `P1-T30`: before `fluent.dts` was on, nothing at all checked this map's keys
 * — an interface takes any string, so a renamed message left an entry here
 * pointing at nothing and the caller went on passing arguments Fluent would
 * never place. Now a key that no `.ftl` declares is a `TS2344` naming it.
 */
export type UndeclaredArgumentMessageId = AssertNever<
  Exclude<keyof FluentMessageArgsMap, FluentMessageId>
>;

/**
 * {@link FluentMessageArgsMap}'s keys as a value, so a test can walk them.
 *
 * A mapped type is not enumerable at runtime, and the whole argument of this
 * module's header is that a list a spec can walk is the only thing that makes
 * an `.ftl` typo fail something. `test/integration/l10n.spec.ts` checks every
 * id here against the live `en-US` bundle of its own surface.
 *
 * It cannot drift from the map: `satisfies` below rejects an id the map does
 * not declare, and {@link UnlistedArgumentMessageId} rejects a map key missing
 * from here.
 */
export const ARGUMENT_MESSAGE_IDS = [
  // mainWindow (20)
  "research-helper-provenance-note-title",
  "research-helper-import-summary",
  "research-helper-import-abstract-coverage",
  "research-helper-import-paths",
  "research-helper-import-fallback-reason",
  "rh-error-missing-credential",
  "rh-error-network",
  "rh-error-timeout",
  "rh-error-auth",
  "rh-error-forbidden",
  "rh-error-rate-limit",
  "rh-error-quota",
  "rh-error-upstream",
  "rh-error-bad-request",
  "rh-error-source",
  "rh-error-parse",
  "rh-error-cancelled",
  "rh-error-llm",
  "rh-error-context-length",
  "rh-error-structured-output",
  // mainWindow — a truncated answer (1, item 265(c))
  "rh-error-output-truncated",
  // mainWindow — OpenRouter's guardrail 404 (1, item 262(c))
  "rh-error-privacy-routing",
  // mainWindow — the preference pane (5, P1-T44)
  "research-helper-prefs-remove-all-done",
  "research-helper-prefs-test-ok",
  "research-helper-prefs-test-inconclusive",
  "research-helper-prefs-test-rejected",
  "research-helper-prefs-test-forbidden",
  // mainWindow — the preference pane (5, P3-T14; 1, item 279(a))
  "research-helper-prefs-test-ok-rate-limited",
  "research-helper-prefs-test-ok-no-credit",
  "research-helper-prefs-models-as-of",
  "research-helper-prefs-models-stale",
  "research-helper-prefs-price-row",
  "research-helper-prefs-price-row-no-cached",
  // mainWindow — the job queue (2: P3-T34, item 265(a))
  "research-helper-job-resumed",
  "research-helper-job-wall-clock-budget",
  // mainWindow — the summarize window and the removal command (12, P3-T29)
  "research-helper-summarize-collection",
  "research-helper-summarize-stage",
  "research-helper-summarize-progress",
  "research-helper-summarize-remaining",
  "research-helper-summarize-row",
  "research-helper-summarize-counts",
  "research-helper-summarize-outcome",
  "research-helper-summarize-key-needed",
  "research-helper-summarize-export-outcome",
  "research-helper-remove-notes-confirm",
  "research-helper-remove-notes-none",
  "research-helper-remove-notes-done",
  // mainWindow — the item pane's result lines (2, plan/00 §6 item 303)
  "research-helper-itempane-not-summarized",
  "research-helper-itempane-note-not-written",
  // mainWindow — the report run's stop for too many themes (1, P4-T05)
  "research-helper-report-stopped-too-many-themes",
  // mainWindow — the budget error, the cost dialog and the Usage readout
  // (19, P3-T16)
  "rh-error-budget",
  "research-helper-cost-items",
  "research-helper-cost-destination",
  "research-helper-cost-calls",
  "research-helper-cost-input",
  "research-helper-cost-output",
  "research-helper-cost-total",
  "research-helper-cost-unpriced",
  "research-helper-cost-disclaimer",
  "research-helper-cost-above-threshold",
  "research-helper-cost-acknowledge",
  "research-helper-cost-downgrade",
  "research-helper-cost-downgrade-preselected",
  "research-helper-cost-ceiling-preflight",
  "research-helper-cost-ceiling-reached",
  "research-helper-cost-usage-job",
  "research-helper-cost-usage-session",
  "research-helper-cost-skipped-notice",
  "research-helper-prefs-usage-limit",
  // mainWindow — the trend report's notice and cost-dialog lines (4, P4-T16)
  "research-helper-egress-report-notice",
  "research-helper-cost-report-summaries",
  "research-helper-cost-report-writing",
  "research-helper-cost-report-review",

  // searchDialog (20)
  "research-helper-search-years-span",
  "research-helper-search-result-count",
  "research-helper-search-authors-overflow",
  "research-helper-search-row-existing",
  "research-helper-search-selected-count",
  "research-helper-search-import",
  "research-helper-search-state-initial",
  "research-helper-search-source-results",
  "research-helper-search-source-failed",
  "research-helper-search-progress-databases",
  "research-helper-search-status-searching",
  "research-helper-search-status-importing",
  "research-helper-search-state-empty",
  "research-helper-search-state-partial",
  "research-helper-search-error-rate-limit",
  "research-helper-search-row-duplicate",
  "research-helper-search-mode-rerun",
  "research-helper-search-rerun-heading",
  "research-helper-search-rerun-recorded",
  "research-helper-search-import-summary-rerun",
  // `P3-T27`.
  "research-helper-search-row-relevance",
  "research-helper-search-screening-count",
  "research-helper-search-screening-unscored",
  // Item 281(b).
  "research-helper-search-screening-cost",
  "research-helper-search-screening-cost-unpriced",

  // reportWindow (2, P4-T19)
  "research-helper-report-collection",
  "research-helper-report-model",
] as const satisfies readonly (keyof FluentMessageArgsMap)[];

/**
 * The keys of {@link FluentMessageArgsMap} missing from
 * {@link ARGUMENT_MESSAGE_IDS}. **Must be empty**, so the enumerable list and
 * the type map are the same set.
 */
export type UnlistedArgumentMessageId = AssertNever<
  Exclude<keyof FluentMessageArgsMap, (typeof ARGUMENT_MESSAGE_IDS)[number]>
>;

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

/**
 * The preference pane's controller (P1-T44; the LLM provider blocks, P3-T04).
 *
 * Loaded by Zotero's preferences window through
 * `Zotero.PreferencePanes.register({ scripts })`, which evaluates it with
 * `Services.scriptloader.loadSubScript` inside a `Cu.Sandbox` whose prototype
 * is the preferences window (Zotero 8+: "Preference panes now have isolated
 * global scope"). So `window`, `document` and `Zotero` resolve, but nothing
 * declared here is visible to the window, and nothing declared by another
 * pane is visible here. The file declares one `var` and exports nothing; the
 * integration spec reaches it through `Zotero_Preferences.getScope(paneID)`.
 *
 * ## How it starts
 *
 * Zotero inserts `preferences.xhtml`, translates it, then dispatches a
 * non-bubbling `load` event on the fragment's root (`#rh-preferences`). This
 * script registers a **capturing** listener on `document` — capture reaches
 * the ancestors of a non-bubbling event on the way down — and initialises when
 * the target is our root. No inline `onload` in the markup: an inline handler
 * compiles in the window's scope, where `RHPreferences` does not exist.
 *
 * ## What this file may and may not do
 *
 * - **No network call, ever.** `docs/01` §8.3. The Test call is made by the
 *   privileged host in the plugin sandbox; this file asks for an outcome.
 * - **No key is ever read back.** The host returns booleans, a digest and
 *   outcomes; `SecretStore.get()` is never called to populate a field
 *   (`docs/09` §1.9 rule 2). The digest the host returns goes into the field's
 *   `placeholder` and nowhere else — not into a log line, not into an error.
 * - **No clipboard.** Nothing here reads or writes the clipboard, there is no
 *   copy button for a key, and `copy` / `cut` on a key field are refused
 *   (rule 7/8). "Copy diagnostics" (`P7-T13`, 2026-11-17) hands the
 *   diagnostics text, which holds no key, to the host, and the host copies it.
 * - **No `Zotero.Prefs` write.** This file writes no preference at all (rule
 *   9, decision D5). The non-secret rows the markup binds — `llmProvider`,
 *   each `<provider>.model`, `gemini.paidTier` — are written by Zotero's own
 *   `preference=` binding; each `<provider>.baseUrl` is written by the host's
 *   `setBaseUrl`, which validates first (`docs/03` §14.4).
 * - **Test, for all six keys** (`P3-T14`). The host tests an LLM key through
 *   that provider's own adapter; this file only asks for the outcome and
 *   paints it inline, then paints every status row from the stored status
 *   on the next refresh. A successful LLM Test refills that provider's model
 *   suggestions from the list it returned.
 * - **Model suggestions and the price table** (`P3-T14` step 5) are built
 *   here as DOM, inside elements the markup already has: each model field
 *   gets a suggestion list beside it — filled from the host's catalogue the
 *   first time it is opened, so opening the pane sends no request — and a
 *   line under it giving the list's date and, for the built-in list, that
 *   it may be out of date. Picking a suggestion only types it into the
 *   field, which Zotero's own binding then stores; any model ID can still be
 *   typed. The price table is listed and edited through the host.
 * - **The Search, Report & audio and Privacy sections** (`P7-T08`) are bound
 *   by Zotero's own `preference=` binding. This file fills the voice list
 *   from the documented default list the host returns (no call), hides the
 *   audio rows while `audio.enabled` is off, paints the privacy line for the
 *   chosen mode, and drives the linked-audio folder row: a folder picker, then
 *   the host's `setLinkedFolder`, which checks the folder and writes it. The
 *   folder's path is shown in its field and never logged.
 * - **The Advanced section** (`P7-T09`): its three number fields are bound;
 *   this file paints the verbose-logging checkbox from the host and sends a
 *   toggle to the host's `setVerboseLogging` (which writes `logLevel` and
 *   nothing else), paints the cache-usage lines (`refreshCacheUsage`, which
 *   `P7-T10`'s clear actions call again), and shows the plugin database's
 *   location with "Show in folder", which the host performs.
 * - **No literal human-readable string.** Every visible string is a Fluent id
 *   from `research-helper-mainWindow.ftl`; the ids are listed in
 *   {@link RHPreferences.l10n} and `test/unit/ui/preferencesPane.test.ts`
 *   asserts they agree with `src/ui/prefs/preferencesPane.ts`.
 *
 * ## Where the data comes from
 *
 * The privileged host is published by `src/bootstrap/registerUI.ts` at
 * `Zotero.<addonInstance>.api.preferences` (`PREFERENCES_API_PROPERTY`). With
 * no host — startup failed before publication — every control is disabled and
 * the badge shows the unavailable state, which is the honest reading: nothing
 * can be stored.
 */

/* global Zotero, window, document, ChromeUtils */

var RHPreferences = {
  /** Element ids this file and `preferences.xhtml` share. */
  spec: {
    root: "rh-preferences",
    backend: "rh-prefs-backend",
    removeAll: "rh-prefs-remove-all",
    removeAllStatus: "rh-prefs-remove-all-status",
    restoreNote: "rh-prefs-restore-note",
    /** docs/09 §1.8's first paragraph, swapped for tier 2's sentence. */
    riskOpening: "rh-prefs-risk-1",
    /** docs/09 §1.8's fourth paragraph, swapped for tier 2's replacement. */
    riskOwnAccount: "rh-prefs-risk-4",
    /**
     * One entry per credential block, keyed by `SecretId`. The element ids are
     * `<prefix>-key`, `-reveal`, `-test`, `-clear`, `-backend`, `-status`
     * (`PANE_CREDENTIALS` in src/ui/prefs/preferencesPane.ts).
     */
    credentials: {
      "source.ncbi": "rh-ncbi",
      "source.semanticscholar": "rh-s2",
      "llm.openrouter": "rh-or",
      "llm.openai": "rh-openai",
      "llm.gemini": "rh-gemini",
      "llm.anthropic": "rh-anthropic",
    },
    /** The credentials the host can Test (`isTestableCredential`): all six. */
    testable: [
      "source.ncbi",
      "source.semanticscholar",
      "llm.openrouter",
      "llm.openai",
      "llm.gemini",
      "llm.anthropic",
    ],
    /** The LLM credential of each provider block (`LLM_CREDENTIALS`). */
    providerCredentials: {
      openrouter: "llm.openrouter",
      openai: "llm.openai",
      gemini: "llm.gemini",
      anthropic: "llm.anthropic",
    },
    /**
     * Provider display names for the price rows: names, never translated
     * (docs/08 §10.3); the unit test asserts each equals the en-US value of
     * `research-helper-provider-<id>`.
     */
    providerNames: {
      openrouter: "OpenRouter",
      openai: "OpenAI",
      gemini: "Google Gemini",
      anthropic: "Anthropic",
    },
    /** The groupbox the price table is built into (P3-T14 step 5). */
    providersGroup: "rh-prefs-providers",
    /** Ids this file gives the elements it builds. */
    built: {
      suggestions: "-model-suggestions",
      modelsStatus: "-models-status",
      prices: "rh-prefs-prices",
      priceRows: "rh-prefs-price-rows",
      priceModel: "rh-prefs-price-model",
      priceInput: "rh-prefs-price-input",
      priceOutput: "rh-prefs-price-output",
      priceCached: "rh-prefs-price-cached",
      priceAsOf: "rh-prefs-price-as-of",
      priceSave: "rh-prefs-price-save",
      priceStatus: "rh-prefs-price-status",
    },
    /**
     * The four LLM provider blocks (`LLM_CREDENTIALS`), keyed by `ProviderId`.
     * Each block is `rh-provider-<provider>`; its base-URL field and status
     * are `<prefix>-base-url` and `<prefix>-base-url-status`.
     */
    providers: {
      openrouter: "rh-or",
      openai: "rh-openai",
      gemini: "rh-gemini",
      anthropic: "rh-anthropic",
    },
    providerMenu: "rh-provider",
    providerBlockPrefix: "rh-provider-",
    s2Request: "rh-s2-request",
    /**
     * P7-T08: the Report & audio and Privacy sections' elements. The bound
     * controls (`PANE_BOUND_SETTINGS`) are written by Zotero's own binding;
     * this file only fills the voice list, shows or hides the audio rows,
     * paints the privacy line and drives the folder row through the host.
     */
    audio: "rh-prefs-audio",
    voice: "rh-voice",
    voicePopup: "rh-voice-popup",
    privacy: "rh-privacy",
    privacyExplain: "rh-privacy-explain",
    folder: "rh-tts-folder",
    folderChoose: "rh-tts-folder-choose",
    folderClear: "rh-tts-folder-clear",
    folderStatus: "rh-tts-folder-status",
    /**
     * P7-T09: the Advanced section's scripted elements. The three number
     * fields are Zotero's bindings; the checkbox, the usage lines and the
     * data location go through the host.
     */
    verbose: "rh-verbose-logging",
    cacheBreakdown: "rh-cache-breakdown",
    dataLocation: "rh-data-location",
    dataLocationShow: "rh-data-location-show",
    /** P7-T17: the Privacy section's dated provider-policy lines. */
    retention: "rh-prefs-retention",
    /** P7-T13: the Advanced section's diagnostics. */
    diagnosticsPreview: "rh-diagnostics-preview",
    diagnosticsSave: "rh-diagnostics-save",
    diagnosticsCopy: "rh-diagnostics-copy",
    diagnosticsText: "rh-diagnostics-text",
    diagnosticsStatus: "rh-diagnostics-status",
    /**
     * P7-T10: the stored-data buttons, each with the kind it asks the host
     * to clear (DATA_KINDS in src/core/dataReset.ts), the reset button and
     * the status line.
     */
    dataActions: {
      "rh-clear-responses": "cached-responses",
      "rh-clear-summaries": "summaries",
      "rh-clear-jobs": "job-history",
      "rh-clear-embeddings": "embeddings",
      "rh-delete-all-data": "all",
    },
    resetDefaults: "rh-reset-defaults",
    /** P7-T11: "Remove all Research Helper content". */
    removeContent: "rh-remove-content",
    dataStatus: "rh-data-status",
  },

  /** Zotero's folder picker, as `addon/content/reportWindow.js` loads it. */
  filePickerModule: "chrome://zotero/content/modules/filePicker.mjs",

  /** P7-T08: `docs/07` §8.5's `privacy.mode` values, and its default. */
  PRIVACY_MODES: ["strict", "balanced", "full"],
  PRIVACY_DEFAULT: "balanced",

  /**
   * Fluent ids, as literals: this file cannot import `PREFERENCES_L10N`.
   * `test/unit/ui/preferencesPane.test.ts` asserts every value here is in it.
   */
  l10n: {
    backendWindows: "research-helper-prefs-backend-windows",
    backendMac: "research-helper-prefs-backend-mac",
    backendIndeterminate: "research-helper-prefs-backend-indeterminate",
    backendUnavailable: "research-helper-prefs-backend-unavailable",
    risk1: "research-helper-prefs-risk-1",
    risk1Session: "research-helper-prefs-risk-1-session",
    risk4: "research-helper-prefs-risk-4",
    risk4Session: "research-helper-prefs-risk-4-session",
    removeAllDone: "research-helper-prefs-remove-all-done",
    keyAbsent: "research-helper-prefs-key-absent",
    keyAbsentOs: "research-helper-prefs-key-absent-os",
    keyPresent: "research-helper-prefs-key-present",
    keyCleared: "research-helper-prefs-key-cleared",
    storeUnavailable: "research-helper-prefs-store-unavailable",
    storeEmpty: "research-helper-prefs-store-empty",
    testRunning: "research-helper-prefs-test-running",
    testOk: "research-helper-prefs-test-ok",
    testInconclusive: "research-helper-prefs-test-inconclusive",
    testRejected: "research-helper-prefs-test-rejected",
    testForbidden: "research-helper-prefs-test-forbidden",
    testAbsent: "research-helper-prefs-test-absent",
    testUnavailable: "research-helper-prefs-test-unavailable",
    backendSession: "research-helper-prefs-backend-session",
    baseUrlSaved: "research-helper-prefs-base-url-saved",
    baseUrlDefault: "research-helper-prefs-base-url-default",
    baseUrlNotHttps: "research-helper-prefs-base-url-not-https",
    baseUrlTrailingSlash: "research-helper-prefs-base-url-trailing-slash",
    baseUrlInvalid: "research-helper-prefs-base-url-invalid",
    testOkRateLimited: "research-helper-prefs-test-ok-rate-limited",
    testOkNoCredit: "research-helper-prefs-test-ok-no-credit",
    modelSuggestions: "research-helper-prefs-model-suggestions",
    modelsAsOf: "research-helper-prefs-models-as-of",
    modelsStale: "research-helper-prefs-models-stale",
    pricesTitle: "research-helper-prefs-prices",
    pricesNote: "research-helper-prefs-prices-note",
    priceRow: "research-helper-prefs-price-row",
    priceRowNoCached: "research-helper-prefs-price-row-no-cached",
    priceModel: "research-helper-prefs-price-model",
    priceInput: "research-helper-prefs-price-input",
    priceOutput: "research-helper-prefs-price-output",
    priceCached: "research-helper-prefs-price-cached",
    priceAsOf: "research-helper-prefs-price-as-of",
    priceSave: "research-helper-prefs-price-save",
    priceRemove: "research-helper-prefs-price-remove",
    priceSaved: "research-helper-prefs-price-saved",
    priceRemoved: "research-helper-prefs-price-removed",
    priceInvalid: "research-helper-prefs-price-invalid",
    priceRefused: "research-helper-prefs-price-refused",
    priceUnavailable: "research-helper-prefs-price-unavailable",
    privacyExplain: "research-helper-prefs-privacy-explain",
    ttsFolderUnset: "research-helper-prefs-tts-folder-unset",
    ttsFolderRefused: "research-helper-prefs-tts-folder-refused",
    cacheUsageRow: "research-helper-prefs-cache-usage-row",
    cacheUsageTotal: "research-helper-prefs-cache-usage-total",
    cacheUsageUnavailable: "research-helper-prefs-cache-usage-unavailable",
    dataLocation: "research-helper-prefs-data-location",
    dataLocationUnavailable: "research-helper-prefs-data-location-unavailable",
    retentionTitle: "research-helper-prefs-retention-title",
    diagnosticsStatus: "research-helper-prefs-diagnostics-status",
    dataStatus: "research-helper-prefs-data-status",
    removeContentStatus: "research-helper-prefs-remove-content-status",
  },

  /**
   * `docs/07` §8.5's `secretBackend` value for tier 1 — the same literal as
   * `OS_KEYSTORE_PREF_VALUE` in src/ui/prefs/preferencesPane.ts, asserted equal
   * by the unit test.
   */
  OS_KEYSTORE: "oskeystore",

  /** Tier 2's value, as `SESSION_PREF_VALUE` (P3-T03's dialog writes it). */
  SESSION: "session",

  /** The privileged host, or `{}` when nothing published one. */
  host: null,

  /** Set by `init()`; `true` while a Test call is in flight for a credential. */
  busy: {},

  /** The one load of the model suggestions, once asked for (P3-T14). */
  suggestionsLoad: null,

  /** The namespaces of the elements this file builds. */
  HTML_NS: "http://www.w3.org/1999/xhtml",
  XUL_NS: "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",

  /**
   * Pure decisions, kept free of DOM so the unit test can evaluate this file
   * with `new Function` and assert them in plain Node.
   */
  logic: {
    /**
     * `backendBadge()`'s table, duplicated as data: which message and whether
     * it is a warning, for a `secretBackend` value and a platform.
     *
     * @param {string} backendPref
     * @param {"win"|"mac"|"linux"|"other"} platform
     * @param {{ OS_KEYSTORE: string, SESSION: string, l10n: object }} ctx
     * @returns {{ messageId: string, warning: boolean, canStore: boolean, osStore: boolean }}
     */
    badge(backendPref, platform, ctx) {
      if (backendPref === ctx.SESSION) {
        // docs/09 §1.9 item 3's tier-2 state: a warning, and keys still store
        // (into memory only, as the user chose in P3-T03's dialog).
        return {
          messageId: ctx.l10n.backendSession,
          warning: true,
          canStore: true,
          osStore: false,
        };
      }
      if (backendPref !== ctx.OS_KEYSTORE) {
        return {
          messageId: ctx.l10n.backendUnavailable,
          warning: true,
          canStore: false,
          osStore: false,
        };
      }
      if (platform === "win") {
        return {
          messageId: ctx.l10n.backendWindows,
          warning: false,
          canStore: true,
          osStore: true,
        };
      }
      if (platform === "mac") {
        return {
          messageId: ctx.l10n.backendMac,
          warning: false,
          canStore: true,
          osStore: true,
        };
      }
      return {
        messageId: ctx.l10n.backendIndeterminate,
        warning: true,
        canStore: true,
        osStore: false,
      };
    },

    /**
     * `riskOpeningMessageId()`'s rule (docs/09 §1.8, owner 2026-10-23, plan/00
     * §6 item 274(a)): under the tier-2 badge, the sentence that keys are held
     * in memory only replaces paragraph 1, which would claim an
     * operating-system store; every other badge keeps paragraph 1.
     *
     * @param {string} backendPref - the value `badge()` was given
     * @param {{ SESSION: string, l10n: object }} ctx
     * @returns {string} the Fluent id for the first risk paragraph
     */
    riskOpening(backendPref, ctx) {
      return backendPref === ctx.SESSION
        ? ctx.l10n.risk1Session
        : ctx.l10n.risk1;
    },

    /**
     * `riskOwnAccountMessageId()`'s rule (docs/09 §1.8, owner 2026-10-23,
     * plan/00 §6 item 275(b)): under the tier-2 badge, the sentence that even
     * keys held in memory can be read by any program running as the user
     * replaces paragraph 4, which presumes encryption; every other badge keeps
     * paragraph 4.
     *
     * @param {string} backendPref - the value `badge()` was given
     * @param {{ SESSION: string, l10n: object }} ctx
     * @returns {string} the Fluent id for the fourth risk paragraph
     */
    riskOwnAccount(backendPref, ctx) {
      return backendPref === ctx.SESSION
        ? ctx.l10n.risk4Session
        : ctx.l10n.risk4;
    },

    /**
     * `showRestoreNotice()`'s rule (docs/09 §1.9 item 8): no key is stored at
     * all, the plugin database already holds data, and the badge names an
     * operating-system store.
     *
     * @param {{ anyKeyStored?: boolean, pluginDataPresent?: boolean }} state
     * @param {{ osStore: boolean }} badge
     * @returns {boolean}
     */
    restoreNotice(state, badge) {
      return (
        badge.osStore &&
        state.pluginDataPresent === true &&
        state.anyKeyStored === false
      );
    },

    /**
     * The base-URL status message for `setBaseUrl`'s answer.
     *
     * @param {{ stored: boolean, cleared?: boolean, reason?: string }} result
     * @param {object} l10n
     * @returns {{ id: string }}
     */
    baseUrlMessage(result, l10n) {
      if (result && result.stored) {
        return { id: result.cleared ? l10n.baseUrlDefault : l10n.baseUrlSaved };
      }
      const reason = result && result.reason;
      if (reason === "not-https") return { id: l10n.baseUrlNotHttps };
      if (reason === "trailing-slash") return { id: l10n.baseUrlTrailingSlash };
      return { id: l10n.baseUrlInvalid };
    },

    /**
     * The status-row message for a credential's state.
     *
     * @param {{ present: boolean, lastTest?: object }} credential
     * @param {boolean} osStore - whether the badge names an operating-system
     *   store, which is the only case docs/09 §1.9 item 8's sentence is true in
     * @param {object} l10n
     * @returns {{ id: string, args?: object }}
     */
    statusMessage(credential, osStore, l10n) {
      if (!credential.present) {
        return { id: osStore ? l10n.keyAbsentOs : l10n.keyAbsent };
      }
      const test = credential.lastTest;
      if (!test || test.kind !== "tested") {
        return { id: l10n.keyPresent };
      }
      return RHPreferences.logic.testMessage(test, l10n);
    },

    /**
     * The status-row message for a Test report.
     *
     * @param {{ kind: string, outcome?: string, checkedAt?: string }} report
     * @param {object} l10n
     * @returns {{ id: string, args?: object }}
     */
    testMessage(report, l10n) {
      if (report.kind === "absent") {
        return { id: l10n.testAbsent };
      }
      if (report.kind === "unavailable") {
        return { id: l10n.testUnavailable };
      }
      const time = RHPreferences.logic.formatTime(report.checkedAt);
      switch (report.outcome) {
        case "ok":
          // docs/09 §2.3: a 429 on an LLM Test is a pass, and says so; an
          // account with no credit left says that instead (owner,
          // 2026-10-23, plan/00 §6 item 279(a)).
          return {
            id:
              report.noCredit === true
                ? l10n.testOkNoCredit
                : report.rateLimited === true
                  ? l10n.testOkRateLimited
                  : l10n.testOk,
            args: { time },
          };
        case "rejected":
          return { id: l10n.testRejected, args: { time } };
        case "forbidden":
          return { id: l10n.testForbidden, args: { time } };
        default:
          return { id: l10n.testInconclusive, args: { time } };
      }
    },

    /**
     * `docs/08` §10.3: dates are formatted by the caller with `Intl` over
     * `Zotero.locale`, never built in the sentence.
     *
     * @param {string} iso
     * @returns {string}
     */
    formatTime(iso) {
      const locale =
        typeof Zotero !== "undefined" && Zotero.locale
          ? Zotero.locale
          : "en-US";
      try {
        return new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(iso));
      } catch {
        return iso;
      }
    },

    /**
     * A calendar date for `epochMs`, in UTC (the catalogue's dates and the
     * price table's `as of` are midnight UTC), formatted with `Intl` over
     * `Zotero.locale` (docs/08 §10.3).
     *
     * @param {number} epochMs
     * @returns {string}
     */
    formatDate(epochMs) {
      const locale =
        typeof Zotero !== "undefined" && Zotero.locale
          ? Zotero.locale
          : "en-US";
      try {
        return new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(epochMs));
      } catch {
        return String(epochMs);
      }
    },

    /**
     * A price, with `Intl.NumberFormat` over `Zotero.locale`.
     *
     * @param {number} value
     * @returns {string}
     */
    formatPrice(value) {
      const locale =
        typeof Zotero !== "undefined" && Zotero.locale
          ? Zotero.locale
          : "en-US";
      try {
        return new Intl.NumberFormat(locale, {
          maximumFractionDigits: 6,
        }).format(value);
      } catch {
        return String(value);
      }
    },

    /**
     * The line under a model field: where its suggestions come from and how
     * old they are; the stale marker when it is the built-in list.
     *
     * @param {{ asOfEpochMs: number, stale: boolean }} suggestions
     * @param {object} l10n
     * @returns {{ id: string, args: { date: string } }}
     */
    suggestionsMessage(suggestions, l10n) {
      const date = RHPreferences.logic.formatDate(suggestions.asOfEpochMs);
      return {
        id: suggestions.stale ? l10n.modelsStale : l10n.modelsAsOf,
        args: { date },
      };
    },

    /**
     * One price row's line.
     *
     * @param {{ providerId: string, modelId: string, inputPerMTokUsd: number,
     *   outputPerMTokUsd: number, cachedInputPerMTokUsd?: number,
     *   asOfEpochMs: number }} row
     * @param {Record<string, string>} names - provider display names
     * @param {object} l10n
     * @returns {{ id: string, args: object }}
     */
    priceMessage(row, names, l10n) {
      const logic = RHPreferences.logic;
      const args = {
        provider: names[row.providerId] || row.providerId,
        model: row.modelId,
        input: logic.formatPrice(row.inputPerMTokUsd),
        output: logic.formatPrice(row.outputPerMTokUsd),
        date: logic.formatDate(row.asOfEpochMs),
      };
      if (typeof row.cachedInputPerMTokUsd === "number") {
        return {
          id: l10n.priceRow,
          args: {
            ...args,
            cached: logic.formatPrice(row.cachedInputPerMTokUsd),
          },
        };
      }
      return { id: l10n.priceRowNoCached, args };
    },

    /**
     * The status line for `savePrice`'s answer.
     *
     * @param {{ saved: boolean, reason?: string }} result
     * @param {object} l10n
     * @returns {{ id: string }}
     */
    priceSaveMessage(result, l10n) {
      if (result && result.saved) return { id: l10n.priceSaved };
      const reason = result && result.reason;
      if (reason === "unavailable") return { id: l10n.priceUnavailable };
      if (reason === "refused") return { id: l10n.priceRefused };
      return { id: l10n.priceInvalid };
    },

    /**
     * Which platform the badge is for, from the three Zotero flags.
     *
     * @param {{ isWin?: boolean, isMac?: boolean, isLinux?: boolean }} zotero
     * @returns {"win"|"mac"|"linux"|"other"}
     */
    platform(zotero) {
      if (zotero && zotero.isWin) return "win";
      if (zotero && zotero.isMac) return "mac";
      if (zotero && zotero.isLinux) return "linux";
      return "other";
    },

    /**
     * P7-T08: the voice list's items, `{ id, label }`: the documented list
     * the host returned, then the stored voice when that list lacks it (the
     * report window can write a name from the live list), so the bound
     * menulist never shows a blank for a stored value.
     *
     * @param {{ voices?: { id: string, label: string }[], voice?: string }} settings
     * @returns {{ id: string, label: string }[]}
     */
    voiceItems(settings) {
      const items = [];
      const seen = {};
      for (const voice of (settings && settings.voices) || []) {
        if (!voice || typeof voice.id !== "string" || voice.id === "") continue;
        if (seen[voice.id]) continue;
        seen[voice.id] = true;
        const label =
          typeof voice.label === "string" && voice.label !== ""
            ? voice.label
            : voice.id;
        items.push({ id: voice.id, label });
      }
      const stored = settings && settings.voice;
      if (typeof stored === "string" && stored !== "" && !seen[stored]) {
        items.push({ id: stored, label: stored });
      }
      return items;
    },

    /**
     * P7-T08: the privacy line's `$mode`: the menulist's value when it is
     * one of §8.5's three, else the default — never a value the Fluent
     * selector does not know.
     *
     * @param {string} value
     * @param {{ PRIVACY_MODES: string[], PRIVACY_DEFAULT: string }} ctx
     * @returns {string}
     */
    privacyMode(value, ctx) {
      return ctx.PRIVACY_MODES.indexOf(value) >= 0
        ? value
        : ctx.PRIVACY_DEFAULT;
    },

    /**
     * P7-T08: the folder row's status after a write: nothing on success (the
     * field shows the folder, or the unset line shows), the refusal line on
     * a refusal. The path is never part of a message.
     *
     * @param {{ stored: boolean, reason?: string }|undefined} result
     * @param {object} l10n
     * @returns {string|undefined} the message id, or nothing to show
     */
    folderMessage(result, l10n) {
      if (result && result.stored) return undefined;
      return l10n.ttsFolderRefused;
    },

    /**
     * P7-T09: the cache lines as Fluent ids and arguments — the total first,
     * then one per row the host returned. `$namespace` is a selector;
     * `$megabytes` and `$entries` are numbers. No usage: one line saying the
     * size cannot be read.
     *
     * @param {object|undefined} usage the host's `cacheStats()` answer
     * @param {Record<string, string>} l10n
     * @returns {{ id: string, args?: object }[]}
     */
    cacheLines(usage, l10n) {
      const count = (value) =>
        typeof value === "number" && Number.isFinite(value) && value > 0
          ? value
          : 0;
      if (!usage || typeof usage !== "object") {
        return [{ id: l10n.cacheUsageUnavailable }];
      }
      const lines = [
        {
          id: l10n.cacheUsageTotal,
          args: {
            megabytes: count(usage.megabytes),
            entries: count(usage.entries),
          },
        },
      ];
      for (const row of usage.rows || []) {
        if (!row || typeof row.namespace !== "string") continue;
        lines.push({
          id: l10n.cacheUsageRow,
          args: {
            namespace: row.namespace,
            megabytes: count(row.megabytes),
            entries: count(row.entries),
          },
        });
      }
      return lines;
    },
  },

  /** @returns {object} the host, never null */
  resolveHost() {
    const instance =
      typeof Zotero === "undefined" ? undefined : Zotero.__addonInstance__;
    const api = instance && instance.api;
    return (api && api.preferences) || {};
  },

  /**
   * The Usage host (P3-T16 step 6; `USAGE_API_PROPERTY` in
   * src/ui/dialogs/costConfirmDialog.ts), or `{}` when none was published.
   *
   * @returns {object}
   */
  resolveUsageHost() {
    const instance =
      typeof Zotero === "undefined" ? undefined : Zotero.__addonInstance__;
    const api = instance && instance.api;
    return (api && api.usage) || {};
  },

  /**
   * Paint the Usage section: one paragraph per line the host returns, each a
   * Fluent id with arguments the host already formatted (this Zotero
   * session's spend and its ceiling). With no host the section stays empty.
   */
  paintUsage() {
    const container = this.el("rh-prefs-usage-lines");
    const host = this.resolveUsageHost();
    if (!container || typeof host.readout !== "function") return;
    let lines;
    try {
      lines = host.readout() || [];
    } catch (error) {
      this.report("usage", error);
      return;
    }
    while (container.firstChild) container.firstChild.remove();
    for (const line of lines) {
      const p = document.createElementNS("http://www.w3.org/1999/xhtml", "p");
      this.localize(p, line.id, line.args);
      container.appendChild(p);
    }
  },

  /** @returns {boolean} whether the resolved host has the method */
  can(method) {
    return !!this.host && typeof this.host[method] === "function";
  },

  /**
   * @param {string} id
   * @returns {Element|null}
   */
  el(id) {
    return document.getElementById(id);
  },

  /**
   * Translate `el` through the window's Fluent, or leave it alone when the
   * window has none (which never happens in a live preferences window, and is
   * the unit test's case).
   */
  localize(el, id, args) {
    if (!el) return;
    const l10n = document.l10n;
    if (l10n && typeof l10n.setAttributes === "function") {
      l10n.setAttributes(el, id, args);
    } else {
      el.setAttribute("data-l10n-id", id);
      if (args) el.setAttribute("data-l10n-args", JSON.stringify(args));
    }
  },

  /**
   * Entry point. Called from the capturing `load` listener at the bottom of
   * this file with the fragment root as `root`.
   *
   * @param {Element} root
   * @returns {Promise<void>}
   */
  async init(root) {
    this.host = this.resolveHost();
    this.busy = {};
    this.wireStorageBlock();
    for (const id of Object.keys(this.spec.credentials)) {
      this.wireCredentialBlock(id, this.spec.credentials[id]);
    }
    this.wireProviderBlocks();
    this.suggestionsLoad = null;
    this.buildModelSuggestions();
    this.buildPriceSection();
    this.wireSettings();
    this.wireAdvanced();
    const state = await this.refresh();
    this.paintProviders(state);
    await this.paintPrices();
    this.paintUsage();
    await this.paintSettings();
    await this.paintRetention();
    await this.paintAdvanced();
    if (root && typeof root.setAttribute === "function") {
      root.setAttribute("data-rh-initialized", "true");
    }
  },

  /**
   * Re-read the host's state and repaint the badge and every credential
   * block. The base-URL fields are painted once, by `init`, so a refresh
   * after a key store does not overwrite an address the user is editing.
   *
   * @returns {Promise<object>} the state painted
   */
  async refresh() {
    let state;
    if (this.can("readState")) {
      try {
        state = await this.host.readState();
      } catch (error) {
        this.report("readState", error);
      }
    }
    if (!state) {
      state = {
        backendPref: "",
        storeAvailable: false,
        credentials: Object.keys(this.spec.credentials).map((id) => ({
          id,
          present: false,
          lastTest: undefined,
        })),
        activeProvider: "openrouter",
        providers: [],
        pluginDataPresent: false,
        anyKeyStored: false,
      };
    }
    const backendPref = state.storeAvailable ? state.backendPref : "";
    const badge = this.logic.badge(
      backendPref,
      this.logic.platform(typeof Zotero === "undefined" ? undefined : Zotero),
      this,
    );
    this.paintBadge(this.el(this.spec.backend), badge);
    // docs/09 §1.8: tier 2's sentence stands in for paragraph 1.
    const riskOpening = this.el(this.spec.riskOpening);
    if (riskOpening) {
      this.localize(riskOpening, this.logic.riskOpening(backendPref, this));
    }
    // docs/09 §1.8 (item 275(b)): and tier 2's replacement for paragraph 4.
    const riskOwnAccount = this.el(this.spec.riskOwnAccount);
    if (riskOwnAccount) {
      this.localize(
        riskOwnAccount,
        this.logic.riskOwnAccount(backendPref, this),
      );
    }
    const restoreNote = this.el(this.spec.restoreNote);
    if (restoreNote) {
      restoreNote.hidden = !this.logic.restoreNotice(state, badge);
    }
    for (const credential of state.credentials) {
      const prefix = this.spec.credentials[credential.id];
      if (!prefix) continue;
      this.paintBadge(this.el(prefix + "-backend"), badge);
      this.paintCredential(prefix, credential, badge);
    }
    const removeAll = this.el(this.spec.removeAll);
    if (removeAll) removeAll.disabled = !badge.canStore;
    return state;
  },

  /**
   * Paint the provider choice and each block's stored base URL.
   *
   * @param {{ activeProvider?: string, providers?: { provider: string, baseUrl: string }[] }} state
   */
  paintProviders(state) {
    for (const entry of state.providers || []) {
      const prefix = this.spec.providers[entry.provider];
      const input = prefix && this.el(prefix + "-base-url");
      if (input) input.value = entry.baseUrl;
    }
    const canWrite = this.can("setBaseUrl");
    for (const provider of Object.keys(this.spec.providers)) {
      const input = this.el(this.spec.providers[provider] + "-base-url");
      if (input) input.disabled = !canWrite;
    }
    this.showProvider(state.activeProvider);
  },

  /**
   * docs/08 §7.5 rule 4: show only the active provider's block. The others
   * are hidden, never cleared — their stored keys stay.
   *
   * @param {string|undefined} provider
   */
  showProvider(provider) {
    const active = Object.prototype.hasOwnProperty.call(
      this.spec.providers,
      provider,
    )
      ? provider
      : "openrouter";
    for (const name of Object.keys(this.spec.providers)) {
      const block = this.el(this.spec.providerBlockPrefix + name);
      if (block) block.hidden = name !== active;
    }
  },

  /**
   * @param {Element|null} el
   * @param {{ messageId: string, warning: boolean }} badge
   */
  paintBadge(el, badge) {
    if (!el) return;
    this.localize(el, badge.messageId);
    el.classList.toggle("rh-warning", badge.warning);
    // Zotero's own palette variables, so both themes get the right colour
    // without a stylesheet of this pane's own.
    el.style.color = badge.warning
      ? "var(--accent-red)"
      : "var(--accent-green)";
    el.style.fontWeight = badge.warning ? "bold" : "normal";
  },

  /**
   * Paint one credential block from its state. The field is **not** given the
   * key — rule 2 — only its `placeholder` carries the digest, and only right
   * after a store, because the host never recomputes a digest from storage.
   *
   * @param {string} prefix
   * @param {{ id: string, present: boolean, lastTest?: object }} credential
   * @param {{ canStore: boolean, osStore: boolean }} badge
   */
  paintCredential(prefix, credential, badge) {
    const input = this.el(prefix + "-key");
    const test = this.el(prefix + "-test");
    const clear = this.el(prefix + "-clear");
    const reveal = this.el(prefix + "-reveal");
    if (input) {
      input.disabled = !badge.canStore;
      if (!credential.present) input.placeholder = "";
    }
    if (reveal) reveal.disabled = !badge.canStore;
    if (test) {
      test.disabled =
        !badge.canStore ||
        !credential.present ||
        !this.spec.testable.includes(credential.id);
    }
    if (clear) clear.disabled = !badge.canStore || !credential.present;
    const message = this.logic.statusMessage(
      credential,
      badge.osStore,
      this.l10n,
    );
    this.setStatus(prefix, message);
  },

  /**
   * @param {string} prefix
   * @param {{ id: string, args?: object }} message
   */
  setStatus(prefix, message) {
    this.localize(this.el(prefix + "-status"), message.id, message.args);
  },

  wireStorageBlock() {
    const removeAll = this.el(this.spec.removeAll);
    if (removeAll) {
      removeAll.addEventListener("command", () => {
        this.settle(this.removeAllKeys());
      });
    }
    const request = this.el(this.spec.s2Request);
    if (request) {
      request.addEventListener("click", (event) => {
        event.preventDefault();
        const href = request.getAttribute("href");
        if (href && typeof Zotero !== "undefined" && Zotero.launchURL) {
          Zotero.launchURL(href);
        }
      });
    }
  },

  /**
   * @param {string} id - the `SecretId`
   * @param {string} prefix - the block's element-id prefix
   */
  wireCredentialBlock(id, prefix) {
    const input = this.el(prefix + "-key");
    const reveal = this.el(prefix + "-reveal");
    const test = this.el(prefix + "-test");
    const clear = this.el(prefix + "-clear");

    if (input) {
      // Rule 7: the host normalises what it stores; this only keeps the field
      // honest about what will be stored while the key is still visible.
      input.addEventListener("paste", () => {
        window.setTimeout(() => {
          input.value = this.normalizeForDisplay(input.value);
        }, 0);
      });
      // Store on `change` (blur or Enter), as docs/08 §7.3's three-button
      // layout implies; an empty field is a no-op, not a clear.
      input.addEventListener("change", () => {
        if (input.value.length === 0) return;
        this.settle(this.storeKey(id, prefix, input));
      });
      // Rule 8: nothing leaves the field for the clipboard, even while shown.
      for (const type of ["copy", "cut"]) {
        input.addEventListener(type, (event) => event.preventDefault());
      }
    }

    if (reveal && input) {
      // Rule 1: hold-to-show. Pressed → text; released, left, blurred → password.
      const show = () => {
        input.type = "text";
      };
      const hide = () => {
        input.type = "password";
      };
      reveal.addEventListener("mousedown", show);
      reveal.addEventListener("mouseup", hide);
      reveal.addEventListener("mouseleave", hide);
      reveal.addEventListener("blur", hide);
      reveal.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          show();
        }
      });
      reveal.addEventListener("keyup", (event) => {
        if (event.key === " " || event.key === "Enter") hide();
      });
      // A XUL button also fires `command` on click; swallow it so the click's
      // mouseup is the only thing that decides the field's type.
      reveal.addEventListener("command", (event) => event.preventDefault());
    }

    if (test) {
      test.addEventListener("command", () => {
        this.settle(this.testKey(id, prefix));
      });
    }
    if (clear) {
      clear.addEventListener("command", () => {
        this.settle(this.clearKey(id, prefix, input));
      });
    }
  },

  /**
   * The provider choice and the four base-URL fields. The menulist and the
   * model fields are bound by Zotero; this only follows the choice and writes
   * a base URL through the host.
   */
  wireProviderBlocks() {
    const menu = this.el(this.spec.providerMenu);
    if (menu) {
      const follow = () => this.showProvider(menu.value);
      // `command`: the user picked one. `syncfrompreference`: Zotero painted
      // the stored value, which it does after the pane's `load`.
      menu.addEventListener("command", follow);
      menu.addEventListener("syncfrompreference", follow);
    }
    for (const provider of Object.keys(this.spec.providers)) {
      const prefix = this.spec.providers[provider];
      const input = this.el(prefix + "-base-url");
      if (!input) continue;
      // On `change` (blur or Enter), never per keystroke: one validated write.
      input.addEventListener("change", () => {
        this.settle(this.storeBaseUrl(provider, prefix, input));
      });
    }
  },

  /**
   * @param {string} provider
   * @param {string} prefix
   * @param {HTMLInputElement} input
   */
  async storeBaseUrl(provider, prefix, input) {
    if (!this.can("setBaseUrl")) return;
    const result = await this.host.setBaseUrl(provider, input.value);
    // A refused value stays in the field, unchanged, beside the reason: the
    // pane never rewrites what the user typed (P3-T04 step 3).
    if (result && result.stored) input.value = input.value.trim();
    this.localize(
      this.el(prefix + "-base-url-status"),
      this.logic.baseUrlMessage(result, this.l10n).id,
    );
  },

  /**
   * P7-T08: the privacy line follows the menulist; the folder buttons ask
   * the host. Nothing here writes a preference: the bound controls are
   * Zotero's, and the folder goes through `setLinkedFolder`.
   */
  wireSettings() {
    const privacy = this.el(this.spec.privacy);
    if (privacy) {
      privacy.addEventListener("command", () => this.paintPrivacyExplain());
    }
    const choose = this.el(this.spec.folderChoose);
    if (choose) {
      choose.addEventListener("command", () => {
        this.settle(this.chooseLinkedFolder());
      });
    }
    const clear = this.el(this.spec.folderClear);
    if (clear) {
      clear.addEventListener("command", () => {
        this.settle(this.storeLinkedFolder(""));
      });
    }
  },

  /** P7-T08: one line for the chosen mode, from docs/09 §3.5's table. */
  paintPrivacyExplain() {
    const menu = this.el(this.spec.privacy);
    const mode = this.logic.privacyMode(menu ? menu.value : "", this);
    this.localize(this.el(this.spec.privacyExplain), this.l10n.privacyExplain, {
      mode,
    });
  },

  /**
   * P7-T08: read the host's settings and paint the Report & audio section:
   * the audio rows shown only while `audio.enabled` is on, the voice list,
   * the folder row. With no host the audio rows stay hidden.
   */
  async paintSettings() {
    this.paintPrivacyExplain();
    let settings;
    if (this.can("readSettings")) {
      try {
        settings = await this.host.readSettings();
      } catch (error) {
        this.report("readSettings", error);
      }
    }
    const audio = this.el(this.spec.audio);
    if (audio) audio.hidden = !(settings && settings.audioEnabled === true);
    this.fillVoices(settings);
    this.paintFolder(settings ? settings.linkedFolder : "");
    const canWrite = this.can("setLinkedFolder");
    for (const id of [this.spec.folderChoose, this.spec.folderClear]) {
      const button = this.el(id);
      if (button) button.disabled = !canWrite;
    }
  },

  /**
   * Fill the voice menulist and select the stored voice. Setting `value`
   * from script fires no `command`, so Zotero's binding writes nothing.
   *
   * @param {object|undefined} settings
   */
  fillVoices(settings) {
    const menu = this.el(this.spec.voice);
    const popup = this.el(this.spec.voicePopup);
    if (!menu || !popup) return;
    while (popup.firstChild) popup.firstChild.remove();
    for (const voice of this.logic.voiceItems(settings)) {
      const item = this.xul("menuitem");
      item.setAttribute("value", voice.id);
      item.setAttribute("label", voice.label);
      popup.appendChild(item);
    }
    const stored =
      settings && typeof settings.voice === "string" ? settings.voice : "";
    if (stored !== "") menu.value = stored;
  },

  /**
   * @param {string} path the stored folder, `""` when unset; shown here, on
   *   the user's own screen, and never logged
   */
  paintFolder(path) {
    const field = this.el(this.spec.folder);
    if (field) field.value = typeof path === "string" ? path : "";
    const status = this.el(this.spec.folderStatus);
    if (!status) return;
    // A chosen folder speaks for itself in the field; the line is hidden.
    const unset = !(typeof path === "string" && path !== "");
    status.hidden = !unset;
    if (unset) this.localize(status, this.l10n.ttsFolderUnset);
  },

  /** Ask for a folder with Zotero's picker, then store it through the host. */
  async chooseLinkedFolder() {
    const path = await this.pickFolder();
    if (path) await this.storeLinkedFolder(path);
  },

  /**
   * Store (or, with `""`, forget) the folder; on a refusal the stored one
   * stays and the refusal line shows. The path is never logged here.
   *
   * @param {string} path
   */
  async storeLinkedFolder(path) {
    if (!this.can("setLinkedFolder")) return;
    const result = await this.host.setLinkedFolder(path);
    if (result && result.stored) {
      await this.paintSettings();
      return;
    }
    const id = this.logic.folderMessage(result, this.l10n);
    const status = this.el(this.spec.folderStatus);
    if (id && status) {
      status.hidden = false;
      this.localize(status, id);
    }
  },

  /**
   * Zotero's folder picker; `""` on a cancel or any failure. As in
   * `addon/content/reportWindow.js`, nothing is logged, because a picker's
   * message can quote the path.
   *
   * @returns {Promise<string>}
   */
  async pickFolder() {
    try {
      const utils =
        typeof ChromeUtils === "undefined" ? undefined : ChromeUtils;
      if (!utils || typeof utils.importESModule !== "function") return "";
      const module = utils.importESModule(this.filePickerModule);
      const Picker = module ? module.FilePicker : undefined;
      if (typeof Picker !== "function") return "";
      const picker = new Picker();
      const button = this.el(this.spec.folderChoose);
      const title = (button && button.getAttribute("label")) || "";
      picker.init(window, title, picker.modeGetFolder);
      const result = await picker.show();
      if (result !== picker.returnOK) return "";
      return typeof picker.file === "string" ? picker.file : "";
    } catch {
      return "";
    }
  },

  /**
   * P7-T09: wire the Advanced section's two scripted controls. The three
   * number fields are Zotero's bindings.
   */
  wireAdvanced() {
    const verbose = this.el(this.spec.verbose);
    if (verbose) {
      verbose.addEventListener("command", () => {
        this.settle(this.storeVerboseLogging(verbose.checked === true));
      });
    }
    const show = this.el(this.spec.dataLocationShow);
    if (show) {
      show.addEventListener("command", () => {
        this.settle(this.revealDatabase());
      });
    }
    this.wireDiagnostics();
    this.wireStoredData();
  },

  /**
   * P7-T10: the stored-data buttons. The host counts, asks over this window,
   * and only then removes; this file shows its answer. A button is disabled
   * while any of them runs, so two confirmations never stack.
   */
  wireStoredData() {
    this.paintDataStatus(undefined);
    for (const id of Object.keys(this.spec.dataActions)) {
      const button = this.el(id);
      if (!button) continue;
      button.disabled = !this.can("clearData");
      const kind = this.spec.dataActions[id];
      button.addEventListener("command", () => {
        this.settle(this.clearStoredData(kind));
      });
    }
    const reset = this.el(this.spec.resetDefaults);
    if (reset) {
      reset.disabled = !this.can("resetToDefaults");
      reset.addEventListener("command", () => {
        this.settle(this.resetToDefaults());
      });
    }
    const remove = this.el(this.spec.removeContent);
    if (remove) {
      remove.disabled = !this.can("removeAllContent");
      remove.addEventListener("command", () => {
        this.settle(this.removeAllContent());
      });
    }
  },

  /** Set while a stored-data action runs. */
  dataBusy: false,

  /**
   * The window the host's confirmation is modal over: this preferences
   * window, or nothing outside one (the unit test).
   */
  parentWindow() {
    return typeof window === "undefined" ? undefined : window;
  },

  /** @param {string} kind - one of the spec's dataActions values */
  async clearStoredData(kind) {
    if (!this.can("clearData")) return;
    await this.runStoredDataAction(() =>
      this.host.clearData(kind, this.parentWindow()),
    );
  },

  /** P7-T11: the host finds, asks, trashes and deletes; this shows its answer. */
  async removeAllContent() {
    if (!this.can("removeAllContent")) return;
    await this.runStoredDataAction(() =>
      this.host.removeAllContent(this.parentWindow()),
    );
  },

  async resetToDefaults() {
    if (!this.can("resetToDefaults")) return;
    await this.runStoredDataAction(() =>
      this.host.resetToDefaults(this.parentWindow()),
    );
  },

  /**
   * Run one stored-data action, show its outcome, then read again what it
   * may have changed: the cache lines, and after a reset every painted
   * setting.
   *
   * @param {() => Promise<{outcome: string, status: {args?: object}}>} action
   */
  async runStoredDataAction(action) {
    if (this.dataBusy) return;
    this.dataBusy = true;
    this.setDataButtonsDisabled(true);
    let result;
    try {
      result = await action();
    } catch (error) {
      this.report("storedData", error);
      result = {
        outcome: "failed",
        status: { args: { outcome: "failed", removed: 0 } },
      };
    } finally {
      this.dataBusy = false;
      this.setDataButtonsDisabled(false);
    }
    this.paintDataStatus(result);
    if (
      result &&
      (result.outcome === "cleared" || result.outcome === "removed")
    ) {
      await this.refreshCacheUsage();
    }
    if (result && result.outcome === "reset") {
      await this.refresh();
      await this.paintSettings();
      await this.paintAdvanced();
    }
  },

  /** @param {boolean} disabled */
  setDataButtonsDisabled(disabled) {
    for (const id of Object.keys(this.spec.dataActions)) {
      const button = this.el(id);
      if (button) button.disabled = disabled || !this.can("clearData");
    }
    const reset = this.el(this.spec.resetDefaults);
    if (reset) reset.disabled = disabled || !this.can("resetToDefaults");
    const remove = this.el(this.spec.removeContent);
    if (remove) remove.disabled = disabled || !this.can("removeAllContent");
  },

  /**
   * The host's status line, always through this file's own id; hidden before
   * the first action.
   *
   * @param {{outcome: string, status: {args?: object}}|undefined} result
   */
  paintDataStatus(result) {
    const line = this.el(this.spec.dataStatus);
    if (!line) return;
    if (!result) {
      line.hidden = true;
      return;
    }
    const args = (result.status && result.status.args) || {};
    const count = (value) => (typeof value === "number" ? value : 0);
    line.hidden = false;
    // P7-T11's answer has its own message; any other is P7-T10's.
    if (result.status && result.status.id === this.l10n.removeContentStatus) {
      this.localize(line, this.l10n.removeContentStatus, {
        outcome: String(result.outcome),
        moved: count(args.moved),
        records: count(args.records),
      });
      return;
    }
    this.localize(line, this.l10n.dataStatus, {
      outcome: String(result.outcome),
      removed: count(args.removed),
    });
  },

  /**
   * P7-T17: the provider-policy lines under the Privacy section, each with
   * its verification date, after one heading line. With no line from the
   * host the block stays hidden: a claim without a date is never shown.
   */
  async paintRetention() {
    const container = this.el(this.spec.retention);
    if (!container) return;
    let lines = [];
    if (this.can("readPolicyNotes")) {
      try {
        lines = (await this.host.readPolicyNotes()) || [];
      } catch (error) {
        this.report("readPolicyNotes", error);
        lines = [];
      }
    }
    while (container.firstChild) container.firstChild.remove();
    let shown = 0;
    for (const line of lines) {
      if (!line || typeof line.id !== "string") continue;
      if (typeof line.date !== "string" || line.date === "") continue;
      if (shown === 0) {
        const title = document.createElementNS(this.HTML_NS, "p");
        this.localize(title, this.l10n.retentionTitle);
        container.appendChild(title);
      }
      const p = document.createElementNS(this.HTML_NS, "p");
      this.localize(p, line.id, { date: line.date });
      container.appendChild(p);
      shown += 1;
    }
    container.hidden = shown === 0;
  },

  /** P7-T09: the checkbox, the cache lines and the database's location. */
  async paintAdvanced() {
    await this.paintVerboseLogging();
    await this.refreshCacheUsage();
    await this.paintDataLocation();
  },

  /**
   * Checked exactly when `logLevel` is `debug` (docs/07 §8.5); disabled when
   * the host cannot write it.
   */
  async paintVerboseLogging() {
    const box = this.el(this.spec.verbose);
    if (!box) return;
    let on = false;
    if (this.can("readVerboseLogging")) {
      try {
        on = (await this.host.readVerboseLogging()) === true;
      } catch (error) {
        this.report("readVerboseLogging", error);
      }
    }
    box.checked = on;
    box.disabled = !this.can("setVerboseLogging");
  },

  /**
   * Write `debug` or `warn` through the host; on a refusal, show the stored
   * value again.
   *
   * @param {boolean} on
   */
  async storeVerboseLogging(on) {
    if (!this.can("setVerboseLogging")) return;
    const stored = await this.host.setVerboseLogging(on === true);
    if (stored !== true) await this.paintVerboseLogging();
  },

  /**
   * P7-T09 step 2: one line for the total, then one per namespace holding
   * anything. Called on open and, by P7-T10's clear actions, after a clear.
   */
  async refreshCacheUsage() {
    const container = this.el(this.spec.cacheBreakdown);
    if (!container) return;
    let usage;
    if (this.can("cacheStats")) {
      try {
        usage = await this.host.cacheStats();
      } catch (error) {
        this.report("cacheStats", error);
      }
    }
    while (container.firstChild) container.firstChild.remove();
    for (const line of this.logic.cacheLines(usage, this.l10n)) {
      const p = document.createElementNS(this.HTML_NS, "p");
      this.localize(p, line.id, line.args);
      container.appendChild(p);
    }
  },

  /**
   * The plugin database's file, read-only, and "Show in folder". The path is
   * shown here, on the user's own screen, and never logged.
   */
  async paintDataLocation() {
    let path = "";
    if (this.can("databasePath")) {
      try {
        const value = await this.host.databasePath();
        path = typeof value === "string" ? value : "";
      } catch (error) {
        this.report("databasePath", error);
      }
    }
    const line = this.el(this.spec.dataLocation);
    if (line) {
      if (path !== "") this.localize(line, this.l10n.dataLocation, { path });
      else this.localize(line, this.l10n.dataLocationUnavailable);
    }
    const show = this.el(this.spec.dataLocationShow);
    if (show) show.disabled = !(path !== "" && this.can("revealDatabase"));
  },

  /** "Show in folder": the host opens the system's file manager. */
  async revealDatabase() {
    if (this.can("revealDatabase")) await this.host.revealDatabase();
  },

  /**
   * P7-T13: the diagnostics text. "Show diagnostics" asks the host for the
   * whole text and puts it in the read-only box; only then are Save and Copy
   * enabled, and each acts on exactly the text shown. Nothing here names the
   * clipboard or writes a file: the host does both, and keeps no path.
   */
  wireDiagnostics() {
    // Nothing is offered before a preview, whatever the markup says.
    this.diagnosticsShown = "";
    this.setDiagnosticsActions(false);
    const box = this.el(this.spec.diagnosticsText);
    if (box) box.hidden = true;
    const preview = this.el(this.spec.diagnosticsPreview);
    if (preview) {
      preview.addEventListener("command", () => {
        this.settle(this.previewDiagnostics());
      });
    }
    const save = this.el(this.spec.diagnosticsSave);
    if (save) {
      save.addEventListener("command", () => {
        this.settle(this.saveDiagnostics());
      });
    }
    const copy = this.el(this.spec.diagnosticsCopy);
    if (copy) {
      copy.addEventListener("command", () => {
        this.settle(this.copyDiagnostics());
      });
    }
  },

  /** The text the box shows, or `""` before a preview. */
  diagnosticsShown: "",

  async previewDiagnostics() {
    this.diagnosticsShown = "";
    this.setDiagnosticsActions(false);
    const box = this.el(this.spec.diagnosticsText);
    let text = "";
    if (this.can("diagnosticsText")) {
      try {
        const answer = await this.host.diagnosticsText();
        text = typeof answer === "string" ? answer : "";
      } catch (error) {
        this.report("diagnosticsText", error);
        text = "";
      }
    }
    if (box) {
      box.value = text;
      box.hidden = text === "";
    }
    if (text === "") {
      this.paintDiagnosticsStatus("unavailable");
      return;
    }
    this.diagnosticsShown = text;
    this.paintDiagnosticsStatus("");
    this.setDiagnosticsActions(true);
  },

  setDiagnosticsActions(enabled) {
    for (const id of [this.spec.diagnosticsSave, this.spec.diagnosticsCopy]) {
      const button = this.el(id);
      if (button) button.disabled = !enabled;
    }
  },

  async saveDiagnostics() {
    const text = this.diagnosticsShown;
    if (text === "" || !this.can("saveDiagnostics")) return;
    const path = await this.pickSaveFile();
    if (path === "") return;
    let saved;
    try {
      saved = (await this.host.saveDiagnostics(path, text)) === true;
    } catch (error) {
      this.report("saveDiagnostics", error);
      saved = false;
    }
    this.paintDiagnosticsStatus(saved ? "saved" : "failed");
  },

  async copyDiagnostics() {
    const text = this.diagnosticsShown;
    if (text === "" || !this.can("copyDiagnostics")) return;
    let copied;
    try {
      copied = (await this.host.copyDiagnostics(text)) === true;
    } catch (error) {
      this.report("copyDiagnostics", error);
      copied = false;
    }
    this.paintDiagnosticsStatus(copied ? "copied" : "failed");
  },

  /** @param {string} outcome - saved, copied, failed, unavailable, or "" to hide */
  paintDiagnosticsStatus(outcome) {
    const line = this.el(this.spec.diagnosticsStatus);
    if (!line) return;
    if (outcome === "") {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    this.localize(line, this.l10n.diagnosticsStatus, { outcome });
  },

  /**
   * Zotero's save picker; `""` on a cancel or any failure. Nothing is logged
   * and nothing is kept: a picker's message can quote the path.
   *
   * @returns {Promise<string>}
   */
  async pickSaveFile() {
    try {
      const utils =
        typeof ChromeUtils === "undefined" ? undefined : ChromeUtils;
      if (!utils || typeof utils.importESModule !== "function") return "";
      const module = utils.importESModule(this.filePickerModule);
      const Picker = module ? module.FilePicker : undefined;
      if (typeof Picker !== "function") return "";
      const picker = new Picker();
      const button = this.el(this.spec.diagnosticsSave);
      const title = (button && button.getAttribute("label")) || "";
      picker.init(window, title, picker.modeSave);
      picker.defaultString = "research-helper-diagnostics.txt";
      picker.appendFilters(picker.filterText);
      const result = await picker.show();
      if (result !== picker.returnOK && result !== picker.returnReplace) {
        return "";
      }
      return typeof picker.file === "string" ? picker.file : "";
    } catch {
      return "";
    }
  },

  /**
   * @param {string} tag
   * @param {string} [id]
   * @returns {Element}
   */
  html(tag, id) {
    const el = document.createElementNS(this.HTML_NS, tag);
    if (id) el.id = id;
    return el;
  },

  /**
   * @param {string} tag
   * @param {string} [id]
   * @returns {Element}
   */
  xul(tag, id) {
    const el =
      typeof document.createXULElement === "function"
        ? document.createXULElement(tag)
        : document.createElementNS(this.XUL_NS, tag);
    if (id) el.id = id;
    return el;
  },

  /**
   * P3-T14 step 5: beside each model field, a suggestion list (empty but for
   * its prompt until first opened) and, under the field's row, the line that
   * dates the list. The field itself is untouched and still takes any ID.
   */
  buildModelSuggestions() {
    for (const provider of Object.keys(this.spec.providers)) {
      const prefix = this.spec.providers[provider];
      const input = this.el(prefix + "-model");
      if (!input || this.el(prefix + this.spec.built.suggestions)) continue;
      const menu = this.xul("menulist", prefix + this.spec.built.suggestions);
      menu.appendChild(this.xul("menupopup"));
      this.fillSuggestions(menu, []);
      input.after(menu);
      const status = this.html("p", prefix + this.spec.built.modelsStatus);
      status.setAttribute("class", "rh-hint");
      status.setAttribute("role", "status");
      const row = input.parentNode;
      (row && typeof row.after === "function" ? row : menu).after(status);
      // Fetched the first time any list is opened, never on pane load: an
      // open pane sends nothing the user did not ask for.
      menu.addEventListener("popupshowing", () => {
        this.settle(this.loadSuggestions());
      });
      menu.addEventListener("command", () => {
        this.pickSuggestion(menu, input);
      });
    }
  },

  /**
   * Replace a suggestion list's items: its prompt, then one item per ID.
   * Model IDs are names and are shown as they are (docs/08 §10.3).
   *
   * @param {Element} menu
   * @param {string[]} models
   */
  fillSuggestions(menu, models) {
    const popup = menu.firstChild;
    if (!popup) return;
    while (popup.firstChild) popup.firstChild.remove();
    const prompt = this.xul("menuitem");
    prompt.setAttribute("value", "");
    this.localize(prompt, this.l10n.modelSuggestions);
    popup.appendChild(prompt);
    for (const id of models) {
      if (typeof id !== "string" || id === "") continue;
      const item = this.xul("menuitem");
      item.setAttribute("label", id);
      item.setAttribute("value", id);
      popup.appendChild(item);
    }
    menu.value = "";
  },

  /**
   * @param {string} provider
   * @param {string[]} models
   */
  paintSuggestions(provider, models) {
    const prefix = this.spec.providers[provider];
    const menu = prefix && this.el(prefix + this.spec.built.suggestions);
    if (menu) this.fillSuggestions(menu, models);
  },

  /**
   * @param {string} provider
   * @param {{ asOfEpochMs: number, stale: boolean }} suggestions
   */
  paintSuggestionsStatus(provider, suggestions) {
    const prefix = this.spec.providers[provider];
    const status = prefix && this.el(prefix + this.spec.built.modelsStatus);
    if (!status) return;
    const message = this.logic.suggestionsMessage(suggestions, this.l10n);
    this.localize(status, message.id, message.args);
  },

  /** Ask the host for the catalogue once; a failed load may be asked again. */
  loadSuggestions() {
    if (this.suggestionsLoad) return this.suggestionsLoad;
    if (!this.can("modelSuggestions")) return Promise.resolve();
    this.suggestionsLoad = (async () => {
      let suggestions;
      try {
        suggestions = await this.host.modelSuggestions();
      } catch (error) {
        this.suggestionsLoad = null;
        throw error;
      }
      if (!suggestions) {
        this.suggestionsLoad = null;
        return;
      }
      for (const entry of suggestions.providers || []) {
        this.paintSuggestions(entry.provider, entry.models || []);
        this.paintSuggestionsStatus(entry.provider, suggestions);
      }
    })();
    return this.suggestionsLoad;
  },

  /**
   * Type the picked ID into the model field and let Zotero's `preference=`
   * binding store it, as if the user had typed it; then show the prompt
   * again. This file still writes no preference itself.
   *
   * @param {Element} menu
   * @param {HTMLInputElement} input
   */
  pickSuggestion(menu, input) {
    const value = menu.value;
    if (!value) return;
    input.value = value;
    const EventCtor = window.Event;
    for (const type of ["input", "change"]) {
      input.dispatchEvent(new EventCtor(type, { bubbles: true }));
    }
    menu.value = "";
  },

  /**
   * P3-T14 step 5: the user price table, built at the end of the LLM
   * providers group: a heading, a note, one line per stored row with a
   * Remove button, and a form that adds or replaces a row for the provider
   * chosen above. Everything goes through the host; nothing is stored here.
   */
  buildPriceSection() {
    const group = this.el(this.spec.providersGroup);
    const built = this.spec.built;
    if (!group || this.el(built.prices)) return;
    const section = this.html("div", built.prices);
    const title = this.html("h3");
    this.localize(title, this.l10n.pricesTitle);
    const note = this.html("p");
    note.setAttribute("class", "rh-hint");
    this.localize(note, this.l10n.pricesNote);
    const rows = this.html("div", built.priceRows);
    const form = this.html("div");
    const canSave = this.can("savePrice");
    for (const [id, l10nId] of [
      [built.priceModel, this.l10n.priceModel],
      [built.priceInput, this.l10n.priceInput],
      [built.priceOutput, this.l10n.priceOutput],
      [built.priceCached, this.l10n.priceCached],
      [built.priceAsOf, this.l10n.priceAsOf],
    ]) {
      const field = this.html("input", id);
      field.setAttribute("type", "text");
      field.setAttribute("autocomplete", "off");
      field.setAttribute("spellcheck", "false");
      field.disabled = !canSave;
      this.localize(field, l10nId);
      form.appendChild(field);
    }
    const save = this.html("button", built.priceSave);
    save.disabled = !canSave;
    this.localize(save, this.l10n.priceSave);
    save.addEventListener("click", () => {
      this.settle(this.savePrice());
    });
    form.appendChild(save);
    const status = this.html("p", built.priceStatus);
    status.setAttribute("class", "rh-hint");
    status.setAttribute("role", "status");
    for (const child of [title, note, rows, form, status]) {
      section.appendChild(child);
    }
    group.appendChild(section);
  },

  /** Repaint the stored price rows from the host. */
  async paintPrices() {
    const container = this.el(this.spec.built.priceRows);
    if (!container || !this.can("listPrices")) return;
    const rows = (await this.host.listPrices()) || [];
    while (container.firstChild) container.firstChild.remove();
    for (const row of rows) {
      const line = this.html("div");
      const text = this.html("span");
      const message = this.logic.priceMessage(
        row,
        this.spec.providerNames,
        this.l10n,
      );
      this.localize(text, message.id, message.args);
      const remove = this.html("button");
      remove.disabled = !this.can("deletePrice");
      this.localize(remove, this.l10n.priceRemove);
      remove.addEventListener("click", () => {
        this.settle(this.removePrice(row));
      });
      line.appendChild(text);
      line.appendChild(remove);
      container.appendChild(line);
    }
  },

  async savePrice() {
    if (!this.can("savePrice")) return;
    const built = this.spec.built;
    const value = (id) => {
      const field = this.el(id);
      return field ? String(field.value) : "";
    };
    const menu = this.el(this.spec.providerMenu);
    const result = await this.host.savePrice({
      provider: (menu && menu.value) || "openrouter",
      modelId: value(built.priceModel),
      input: value(built.priceInput),
      output: value(built.priceOutput),
      cached: value(built.priceCached),
      asOf: value(built.priceAsOf),
    });
    this.localize(
      this.el(built.priceStatus),
      this.logic.priceSaveMessage(result, this.l10n).id,
    );
    if (result && result.saved) {
      for (const id of [
        built.priceModel,
        built.priceInput,
        built.priceOutput,
        built.priceCached,
        built.priceAsOf,
      ]) {
        const field = this.el(id);
        if (field) field.value = "";
      }
      await this.paintPrices();
    }
  },

  /** @param {{ providerId: string, modelId: string }} row */
  async removePrice(row) {
    if (!this.can("deletePrice")) return;
    await this.host.deletePrice(row.providerId, row.modelId);
    this.localize(this.el(this.spec.built.priceStatus), this.l10n.priceRemoved);
    await this.paintPrices();
  },

  /**
   * The display-side half of rule 7 — the host's `normalizeKeyInput` is the
   * one that decides what is stored.
   *
   * @param {string} raw
   * @returns {string}
   */
  normalizeForDisplay(raw) {
    return String(raw)
      .trim()
      .replace(/^bearer(?:\s+|$)/i, "")
      .trim();
  },

  /**
   * @param {string} id
   * @param {string} prefix
   * @param {HTMLInputElement} input
   */
  async storeKey(id, prefix, input) {
    if (!this.can("storeKey")) return;
    const result = await this.host.storeKey(id, input.value);
    // The typed value is dropped from the DOM whatever happened: a key that was
    // refused is not left on screen either.
    input.value = "";
    input.type = "password";
    if (result && result.stored) {
      input.placeholder = result.digest;
      await this.refresh();
      return;
    }
    const reason = result && result.reason;
    this.setStatus(prefix, {
      id:
        reason === "unavailable"
          ? this.l10n.storeUnavailable
          : this.l10n.storeEmpty,
    });
  },

  /**
   * @param {string} id
   * @param {string} prefix
   */
  async testKey(id, prefix) {
    if (!this.spec.testable.includes(id)) return;
    if (!this.can("testKey") || this.busy[id]) return;
    this.busy[id] = true;
    const button = this.el(prefix + "-test");
    if (button) button.disabled = true;
    this.setStatus(prefix, { id: this.l10n.testRunning });
    try {
      const report = await this.host.testKey(id);
      this.setStatus(prefix, this.logic.testMessage(report, this.l10n));
      // P3-T14 step 4: a successful LLM Test refills that provider's
      // suggestions from the list it returned.
      const provider = Object.keys(this.spec.providerCredentials).find(
        (name) => this.spec.providerCredentials[name] === id,
      );
      if (provider && report && Array.isArray(report.models)) {
        this.paintSuggestions(provider, report.models);
        this.paintSuggestionsStatus(provider, {
          asOfEpochMs: Date.parse(report.checkedAt),
          stale: false,
        });
      }
    } catch (error) {
      // The outcome vocabulary has no "error" member on purpose: a thrown
      // error is "could not verify", and its text stays out of the pane.
      this.report("testKey", error);
      this.setStatus(
        prefix,
        this.logic.testMessage(
          {
            kind: "tested",
            outcome: "inconclusive",
            checkedAt: new Date().toISOString(),
          },
          this.l10n,
        ),
      );
    } finally {
      this.busy[id] = false;
      if (button) button.disabled = false;
    }
  },

  /**
   * @param {string} id
   * @param {string} prefix
   * @param {HTMLInputElement|null} input
   */
  async clearKey(id, prefix, input) {
    if (!this.can("clearKey")) return;
    await this.host.clearKey(id);
    if (input) {
      input.value = "";
      input.placeholder = "";
      input.type = "password";
    }
    await this.refresh();
    this.setStatus(prefix, { id: this.l10n.keyCleared });
  },

  async removeAllKeys() {
    if (!this.can("clearAllKeys")) return;
    const count = await this.host.clearAllKeys();
    for (const id of Object.keys(this.spec.credentials)) {
      const input = this.el(this.spec.credentials[id] + "-key");
      if (input) {
        input.value = "";
        input.placeholder = "";
        input.type = "password";
      }
    }
    await this.refresh();
    this.localize(this.el(this.spec.removeAllStatus), this.l10n.removeAllDone, {
      count,
    });
  },

  /**
   * Run a handler's promise and report a rejection by **name only**. The
   * message is never written: a failure path is where a value escapes, and a
   * platform or HTTP error message can carry a URL that carries a key.
   *
   * @param {Promise<unknown>} promise
   */
  settle(promise) {
    Promise.resolve(promise).catch((error) => this.report("handler", error));
  },

  /**
   * @param {string} where
   * @param {unknown} error
   */
  report(where, error) {
    try {
      Zotero.debug(
        "[research-helper] preference pane " +
          where +
          " failed: " +
          String(error && error.name ? error.name : typeof error),
      );
    } catch {
      /* a diagnostic that cannot be written is not worth a second failure */
    }
  },
};

// Zotero dispatches a non-bubbling `load` on the fragment root after inserting
// and translating it (preferences.js, _initImportedNodesPostInsert). A
// capturing listener sees it; a bubbling one would not.
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener(
    "load",
    (event) => {
      const target = event.target;
      if (target && target.id === RHPreferences.spec.root) {
        RHPreferences.settle(RHPreferences.init(target));
      }
    },
    true,
  );
}

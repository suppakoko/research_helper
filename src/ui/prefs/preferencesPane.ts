/**
 * The preference pane's shape and its privileged host (`P1-T44`).
 *
 * `docs/08` §7.5 restates `docs/09` §1.9's nine rules for the pane, and the
 * card says they ship with the very first key field. The rules that are
 * *logic* live here, where a unit test can reach them without a window:
 *
 * - rule 2's digest ({@link keyDigest}) — the one place seven characters of a
 *   stored key are ever derived, and the host hands it to the pane and to
 *   nothing else: not the logger, not an error, not a note;
 * - rule 3's badge ({@link backendBadge}) — which text the storage badge may
 *   show for a `secretBackend` preference value on a given platform, and why
 *   Linux gets an *indeterminate* state rather than "System keyring";
 * - rule 5's Test call ({@link createPreferencesHost}'s `testKey`) — `docs/09`
 *   §2.3's two source requests and its outcome table, including the one place
 *   its "429 counts as a pass" rule must **not** apply;
 * - rule 7's paste normalisation ({@link normalizeKeyInput});
 * - rule 9 by construction: nothing here imports `src/prefs`' writer, and the
 *   only preference the host *reads* is the non-secret `secretBackend` row,
 *   through a getter the composition root supplies.
 *
 * The *markup* rules — `type="password"`, no `preference` attribute, no copy
 * affordance, the verbatim §1.8 text — are `addon/content/preferences.xhtml`'s,
 * and `test/unit/ui/preferencesPane.test.ts` reads that file off disk to assert
 * them, exactly as `test/unit/ui/searchDialog.test.ts` does for the search
 * window.
 *
 * ## Why the host is a factory with injected ports
 *
 * `src/ui/**` may not import `src/zotero/**` (`docs/07` §2.3, enforced by
 * `eslint.config.js`), so this file cannot name the keychain. It takes the
 * `SecretStore` *port* (`src/core/secretStore.ts`), an HTTP function shaped
 * like `src/core/http/client.ts`'s `httpRequest`, a clock and a logger, and
 * `src/bootstrap/registerUI.ts` — the one three-way junction — binds the real
 * ones. The same factory lets `test/integration/preferences.spec.ts` build a
 * second host over the *same* login manager with a stubbed `request`, which is
 * how the card's negative assertion drives a failing Test call without a
 * network and without a real key.
 *
 * ## The four LLM provider blocks (`P3-T04`)
 *
 * {@link LLM_CREDENTIALS} adds one block per provider. Each key stores, masks
 * and clears exactly as the two source keys do; the store re-derives the
 * matching `<provider>.keyPresent` flag itself (`src/zotero/keychain.ts`).
 * The block's base URL goes through {@link checkBaseUrlInput} and the host's
 * `setBaseUrl`, never through a `preference=` binding, because Zotero's
 * binding writes every keystroke and cannot refuse a value (`docs/08` §7.3,
 * the note dated 2026-10-23). The model field and the Gemini paid-tier
 * checkbox **are** bound: neither has a write-time rule. The host does not
 * *resolve* a base URL — `src/llm/shared/baseUrl.ts` (`P3-T06`) does.
 *
 * ## The Test call for all six credentials (`P3-T14`)
 *
 * The two source keys are tested here, by the two `docs/09` §2.3 requests
 * below — they stay in this file for Phase 3 and move into the source
 * adapters with `plan/00` §6 item 52 (owner, item 272(d); `docs/09` §8 item
 * 8). An LLM key is tested by its own adapter's `validateCredentials()`,
 * through the {@link PreferencesHostDeps.validateLlm} port, so it only ever
 * goes to its own provider's host and the host here never reads it.
 * {@link classifyLlmCheck} maps the answer to `docs/07` §8.5's enum; an
 * out-of-credit answer (`rh-error-quota`) is `ok` with its own line
 * (owner, 2026-10-23, `plan/00` §6 item 279(a)). Every
 * outcome the service actually answered is persisted through the
 * {@link ValidationPort} (`<provider>.lastValidationResult` and
 * `.lastValidatedAt`); a Test that got no answer — a network failure, a
 * timeout — leaves the stored status as it was (`docs/09` §2.3). The pane
 * paints every status row from the stored status on load. The store's own
 * `set` and `clear` reset it (`docs/09` §2.5, `src/zotero/keychain.ts`).
 *
 * The model fields' suggestions come from `P3-T13`'s catalogue through
 * {@link PreferencesHostDeps.modelSuggestions}, and the user price table is
 * listed and edited through {@link PreferencesHostDeps.prices} (`P3-T14`
 * step 5; `plan/00` §6 item 265(b)).
 *
 * Tier 2 (`P3-T03`): a `secretBackend` of `"session"` paints *"Not saved
 * between sessions"* and still lets the fields store, into memory only.
 *
 * ## What is deliberately not here
 *
 * - *(Corrected 2026-10-23, `P3-T14`: this list said the host wrote no
 *   validation status and had no live model list; both are now built.)*
 * - **No store at all** (the startup probe failed and the user declined tier
 *   2, or the keychain module could not load): the host reports
 *   `"unavailable"` and refuses to store.
 */

import {
  CACHE_NAMESPACES,
  type CacheNamespace,
  type CacheStats,
} from "../../core/cache/cache";
import type { Clock } from "../../core/clock";
import {
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
} from "../../core/errors";
import type { HttpRequest, HttpResponse } from "../../core/http/client";
import { ncbiIdentityParams } from "../../core/http/userAgent";
import type { Logger } from "../../core/logger";
import {
  isSecretId,
  type SecretId,
  type SecretStore,
} from "../../core/secretStore";
import type { MainWindowMessageId } from "../../i18n/keys";
import type { ProviderId } from "../../model/ids";

/* ------------------------------------------------------------ registration */

/**
 * The pane id handed to `Zotero.PreferencePanes.register` and to
 * `Zotero.Utilities.Internal.openPreferences(paneID)`.
 *
 * Fixed rather than generated so the search window's **Open Preferences**
 * action (`addon/content/searchDialog.js`) can name it: that script is a
 * classic chrome script and cannot import this constant, so it carries the
 * same literal and `test/unit/ui/searchDialog.test.ts` asserts the two agree.
 */
export const PREFERENCES_PANE_ID = "research-helper-preferences";

/** The fragment, relative to the plugin root (`docs/08` §7.1). */
export const PREFERENCES_PANE_SRC = "content/preferences.xhtml";

/** The pane's controller, relative to the plugin root. */
export const PREFERENCES_PANE_SCRIPT = "content/preferences.js";

/** The `ScopedRegistration` description the leak report prints. */
export const PREFERENCES_PANE_DESCRIPTION =
  "the Research Helper preference pane";

/**
 * The property on `addon.api` where the privileged host is published, read by
 * `addon/content/preferences.js` as `Zotero.<addonInstance>.api.preferences`.
 * Declared here beside the host so the publishing and reading sides cannot
 * drift, as `SEARCH_WINDOW_API_PROPERTY` is for the search window.
 */
export const PREFERENCES_API_PROPERTY = "preferences";

/** The fragment's root element, which receives the pane's `load` event. */
export const PREFERENCES_ROOT_ID = "rh-preferences";

/**
 * `Zotero.PreferencePanes.register`'s caller-supplied options
 * (`docs/01` §7.3, `docs/08` §7.1).
 *
 * `label` and `image` are omitted on purpose: there is no `l10nID`, so a label
 * here would be an untranslatable literal, and Zotero falls back to the
 * manifest's name and icon. `defaultXUL` is **not** a caller option
 * (`P0-T07`'s trap) and is excluded from the type.
 *
 * `_ZoteroTypes` is a global type namespace, so naming it costs no import and
 * breaks no layering rule — the same reasoning `src/ui/dialogs/searchDialog.ts`
 * gives for `_ZoteroTypes.MainWindow`.
 */
export type PreferencePaneRegistrationOptions = Omit<
  _ZoteroTypes._PreferencePaneOption,
  "defaultXUL"
>;

/** @param pluginID - `package.json`'s `config.addonID`, decision D9 */
export function preferencePaneOptions(
  pluginID: string,
): PreferencePaneRegistrationOptions {
  return {
    pluginID,
    id: PREFERENCES_PANE_ID,
    src: PREFERENCES_PANE_SRC,
    scripts: [PREFERENCES_PANE_SCRIPT],
  };
}

/* -------------------------------------------------------------- credentials */

/** One literature-source credential block (`docs/08` §7.3, §7.4). */
export interface SourceCredential {
  readonly id: SecretId;
  /** Element-id prefix every control in the block shares: `rh-ncbi-key`, … */
  readonly elementPrefix: string;
}

/**
 * The two literature-source credentials (`P1-T44`). The only two the host can
 * **Test** today: `docs/09` §2.3's two requests below are theirs.
 */
export const SOURCE_CREDENTIALS: readonly SourceCredential[] = [
  { id: "source.ncbi", elementPrefix: "rh-ncbi" },
  { id: "source.semanticscholar", elementPrefix: "rh-s2" },
];

/** One LLM provider block (`docs/08` §7.3, `P3-T04`). */
export interface LlmCredential extends SourceCredential {
  /** The provider whose `<provider>.model` / `.baseUrl` rows the block edits. */
  readonly provider: ProviderId;
}

/**
 * The four LLM provider blocks, in `docs/07` §8.5's `llmProvider` value order.
 * `rh-or` is `docs/08` §7.3's own prefix; the other three follow its "identical
 * structure" comment. `addon/content/preferences.js` carries the same table as
 * literals and `test/unit/ui/preferencesPane.test.ts` asserts they agree.
 *
 * `tts.gemini` has no block: `docs/08` §7.3 draws none, and the TTS key is
 * Phase 5's.
 */
export const LLM_CREDENTIALS: readonly LlmCredential[] = [
  { id: "llm.openrouter", elementPrefix: "rh-or", provider: "openrouter" },
  { id: "llm.openai", elementPrefix: "rh-openai", provider: "openai" },
  { id: "llm.gemini", elementPrefix: "rh-gemini", provider: "gemini" },
  { id: "llm.anthropic", elementPrefix: "rh-anthropic", provider: "anthropic" },
];

/** Every credential block the pane shows: the two sources, then the four LLMs. */
export const PANE_CREDENTIALS: readonly SourceCredential[] = [
  ...SOURCE_CREDENTIALS,
  ...LLM_CREDENTIALS,
];

/** Whether `id` is a credential this pane may store or clear. */
export function isPaneCredential(id: string): id is SecretId {
  return isSecretId(id) && PANE_CREDENTIALS.some((entry) => entry.id === id);
}

/**
 * Whether the host can run `id`'s Test call: every block the pane shows
 * (`P3-T14`; until then only the two source credentials). The two source
 * keys take `docs/09` §2.3's requests below; an LLM key takes its own
 * adapter's `validateCredentials()` and never reaches a source request
 * ({@link llmCredentialFor}).
 */
export function isTestableCredential(id: string): id is SecretId {
  return isPaneCredential(id);
}

/** The LLM block that holds `id`, or `undefined` for a source credential. */
export function llmCredentialFor(id: string): LlmCredential | undefined {
  return LLM_CREDENTIALS.find((entry) => entry.id === id);
}

/** Whether `value` names one of the four LLM provider blocks. */
export function isPaneProvider(value: string): value is ProviderId {
  return LLM_CREDENTIALS.some((entry) => entry.provider === value);
}

/* --------------------------------------------------------------------- l10n */

/**
 * Every Fluent id the pane resolves, by role.
 *
 * `satisfies Record<string, MainWindowMessageId>` is the compile-time half of
 * the card's "every new string is registered" criterion: an id here that
 * `src/i18n/keys.ts` has not assigned to the main-window surface does not
 * compile. The strings live in `research-helper-mainWindow.ftl` because the
 * pane is a fragment inside a window **Zotero** owns, which is that bundle's
 * first job (`docs/08` §10.1); see the card report for the divergence from
 * §10.1's planned `preferences.ftl`.
 *
 * `addon/content/preferences.js` carries the same ids as literals — it cannot
 * import — and `test/unit/ui/preferencesPane.test.ts` asserts the two agree.
 */
export const PREFERENCES_L10N = {
  storageTitle: "research-helper-prefs-storage",
  backendWindows: "research-helper-prefs-backend-windows",
  backendMac: "research-helper-prefs-backend-mac",
  backendIndeterminate: "research-helper-prefs-backend-indeterminate",
  backendUnavailable: "research-helper-prefs-backend-unavailable",
  risk1: "research-helper-prefs-risk-1",
  risk2: "research-helper-prefs-risk-2",
  risk3: "research-helper-prefs-risk-3",
  risk4: "research-helper-prefs-risk-4",
  risk5: "research-helper-prefs-risk-5",
  // docs/09 §1.8's tier-2 sentence, in place of risk1 under the session badge
  // (owner, 2026-10-23, plan/00 §6 item 274(a)); see riskOpeningMessageId.
  risk1Session: "research-helper-prefs-risk-1-session",
  // docs/09 §1.8's tier-2 paragraph-4 replacement, in place of risk4 under the
  // session badge (owner, 2026-10-23, plan/00 §6 item 275(b)); see
  // riskOwnAccountMessageId.
  risk4Session: "research-helper-prefs-risk-4-session",
  removeAll: "research-helper-prefs-remove-all",
  removeAllDone: "research-helper-prefs-remove-all-done",
  ncbiTitle: "research-helper-prefs-ncbi",
  ncbiNote: "research-helper-prefs-ncbi-note",
  ncbiKey: "research-helper-prefs-ncbi-key",
  s2Title: "research-helper-prefs-s2",
  s2Note: "research-helper-prefs-s2-note",
  s2Key: "research-helper-prefs-s2-key",
  s2Request: "research-helper-prefs-s2-request",
  reveal: "research-helper-prefs-reveal",
  testKey: "research-helper-prefs-test-key",
  clearKey: "research-helper-prefs-clear-key",
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
  // P3-T04: tier 2's badge (docs/09 §1.9 item 3), the restore notice (item 8),
  // and the LLM provider blocks (docs/08 §7.3).
  backendSession: "research-helper-prefs-backend-session",
  restoreNote: "research-helper-prefs-restore-note",
  providersTitle: "research-helper-prefs-providers",
  activeProvider: "research-helper-prefs-active-provider",
  apiKey: "research-helper-prefs-api-key",
  model: "research-helper-prefs-model",
  baseUrl: "research-helper-prefs-base-url",
  baseUrlSaved: "research-helper-prefs-base-url-saved",
  baseUrlDefault: "research-helper-prefs-base-url-default",
  baseUrlNotHttps: "research-helper-prefs-base-url-not-https",
  baseUrlTrailingSlash: "research-helper-prefs-base-url-trailing-slash",
  baseUrlInvalid: "research-helper-prefs-base-url-invalid",
  geminiPaidTier: "research-helper-prefs-gemini-paid-tier",
  geminiPaidTierNote: "research-helper-prefs-gemini-paid-tier-note",
  // P3-T16 step 6: the Usage section. The heading is markup; the other four
  // are placed by preferences.js from the lines `api.usage.readout()` returns
  // (`USAGE_L10N` in src/ui/dialogs/costConfirmDialog.ts, the same ids).
  usageTitle: "research-helper-prefs-usage",
  usageSession: "research-helper-cost-usage-session",
  usageEstimated: "research-helper-cost-usage-estimated",
  usageLimit: "research-helper-prefs-usage-limit",
  usageLimitOff: "research-helper-prefs-usage-limit-off",
  // P3-T14: an LLM key accepted under a 429, the model suggestions' source
  // line, and the user price table (step 5; plan/00 §6 item 265(b)).
  testOkRateLimited: "research-helper-prefs-test-ok-rate-limited",
  // Owner, 2026-10-23, plan/00 §6 item 279(a): a key accepted by an account
  // with no credit left (QuotaExceededError).
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
  // P7-T08 (2026-11-17): the Search, Report & audio and Privacy sections
  // (docs/08 §7.3 as P7-T01 left it). The Korean is G-41's: each is a
  // commented draft, not adopted, and on KO_PENDING_REVIEW.
  searchTitle: "research-helper-prefs-search",
  defaultYears: "research-helper-prefs-default-years",
  maxResults: "research-helper-prefs-max-results",
  useTranslators: "research-helper-prefs-use-translators",
  hideExisting: "research-helper-prefs-hide-existing",
  reportTitle: "research-helper-prefs-report",
  reportLanguage: "research-helper-prefs-report-language",
  languageOption: "research-helper-prefs-language-option",
  ttsLanguage: "research-helper-prefs-tts-language",
  ttsLanguageOption: "research-helper-prefs-tts-language-option",
  ttsVoice: "research-helper-prefs-tts-voice",
  ttsVoiceNote: "research-helper-prefs-tts-voice-note",
  ttsMinutes: "research-helper-prefs-tts-minutes",
  ttsFolder: "research-helper-prefs-tts-folder",
  ttsFolderChoose: "research-helper-prefs-tts-folder-choose",
  ttsFolderClear: "research-helper-prefs-tts-folder-clear",
  ttsFolderUnset: "research-helper-prefs-tts-folder-unset",
  ttsFolderNote: "research-helper-prefs-tts-folder-note",
  ttsFolderRefused: "research-helper-prefs-tts-folder-refused",
  privacyTitle: "research-helper-prefs-privacy",
  privacyMode: "research-helper-prefs-privacy-mode",
  privacyOption: "research-helper-prefs-privacy-option",
  privacyExplain: "research-helper-prefs-privacy-explain",
  fullTextMode: "research-helper-prefs-fulltext-mode",
  fullTextOption: "research-helper-prefs-fulltext-option",
  fullTextNote: "research-helper-prefs-fulltext-note",
  // P7-T09 (2026-11-17): the Advanced section's first half (docs/08 §7.3,
  // item 4). The Korean is G-41's, as above.
  advancedTitle: "research-helper-prefs-advanced",
  concurrency: "research-helper-prefs-concurrency",
  timeout: "research-helper-prefs-timeout",
  cacheSize: "research-helper-prefs-cache-size",
  cacheUsageRow: "research-helper-prefs-cache-usage-row",
  cacheUsageTotal: "research-helper-prefs-cache-usage-total",
  cacheUsageUnavailable: "research-helper-prefs-cache-usage-unavailable",
  debug: "research-helper-prefs-debug",
  debugNote: "research-helper-prefs-debug-note",
  dataLocation: "research-helper-prefs-data-location",
  dataLocationShow: "research-helper-prefs-data-location-show",
  dataLocationUnavailable: "research-helper-prefs-data-location-unavailable",
  // P7-T17 (2026-11-17): the Privacy section's dated provider-policy lines
  // (POLICY_NOTES in src/llm/shared/policyNotes.ts). Korean is G-41's.
  retentionTitle: "research-helper-prefs-retention-title",
  retentionOpenai: "research-helper-prefs-retention-openai",
  retentionAnthropic: "research-helper-prefs-retention-anthropic",
  retentionGeminiPaid: "research-helper-prefs-retention-gemini-paid",
  retentionGeminiFree: "research-helper-prefs-retention-gemini-free",
  retentionOpenrouter: "research-helper-prefs-retention-openrouter",
  // P7-T13 (2026-11-17): the Advanced section's diagnostics (docs/07 §10.4,
  // "As built"). Korean is G-41's.
  diagnosticsTitle: "research-helper-prefs-diagnostics-title",
  diagnosticsNote: "research-helper-prefs-diagnostics-note",
  diagnosticsPreview: "research-helper-prefs-diagnostics-preview",
  diagnosticsText: "research-helper-prefs-diagnostics-text",
  diagnosticsSave: "research-helper-prefs-diagnostics-save",
  diagnosticsCopy: "research-helper-prefs-diagnostics-copy",
  diagnosticsStatus: "research-helper-prefs-diagnostics-status",
} as const satisfies Record<string, MainWindowMessageId>;

/**
 * `P7-T17`: the messages a provider-policy line may use. A row naming any
 * other id is not shown.
 */
const POLICY_LINE_IDS: ReadonlySet<string> = new Set([
  PREFERENCES_L10N.retentionOpenai,
  PREFERENCES_L10N.retentionAnthropic,
  PREFERENCES_L10N.retentionGeminiPaid,
  PREFERENCES_L10N.retentionGeminiFree,
  PREFERENCES_L10N.retentionOpenrouter,
]);

/**
 * `P7-T08`: the pane's bound settings, by section — `docs/07` §8.5's rows that
 * `docs/08` §7.3 (as `P7-T01` left it) places in the pane, each written by
 * Zotero's own `preference=` binding. `tts.linkedFileDir` is not among them: it
 * is a local path, chosen with a folder picker and written through
 * {@link PreferencesHostApi.setLinkedFolder}, never through a binding.
 *
 * **Not in the pane, on purpose:** `sources` (the search window's checkboxes,
 * §8.5), `autoSummarize` (off and hidden in v1.0, owner, `plan/00` §6 item 381;
 * `plan/10` §0.4 line 23), `tts.model`, `tts.outputFormat`, `gemini.tierAnswer`
 * and `audio.enabled` (hidden rows).
 *
 * `advanced` is `P7-T09`'s (2026-11-17): concurrency, the timeout and the cache
 * cap. `logLevel` is not bound: the verbose-logging checkbox writes it through
 * {@link PreferencesHostApi.setVerboseLogging} (`docs/07` §8.5, Diagnostics).
 */
export const PANE_BOUND_SETTINGS = {
  search: ["searchYears", "maxResults", "useTranslators", "hideExisting"],
  report: ["reportLanguage"],
  audio: ["tts.language", "tts.voice", "tts.targetMinutes"],
  privacy: ["privacy.mode", "summary.fullTextMode"],
  advanced: ["concurrency", "timeoutSeconds", "cache.maxSizeMB"],
} as const;

/** The values each bound menulist offers: `docs/07` §8.5's value sets. */
export const PANE_MENU_VALUES = {
  reportLanguage: ["auto", "en", "ko", "both"],
  "tts.language": ["auto", "en", "ko"],
  "privacy.mode": ["strict", "balanced", "full"],
  "summary.fullTextMode": ["never", "auto", "always"],
} as const;

/* ------------------------------------------------------- rule 7: paste input */

/**
 * `docs/09` §1.9 / `docs/08` §7.5 rule 3: "On paste, trim whitespace and strip
 * a leading `Bearer `." Case-insensitive on the scheme word, because a key
 * copied out of a `curl` example arrives as `Bearer`, `bearer` or `BEARER`.
 */
export function normalizeKeyInput(raw: string): string {
  const trimmed = raw.trim();
  // `(?:\s+|$)`: a bare scheme word with no token after it is an empty paste,
  // not a six-character key. Measured by the unit test on 2026-10-13: without
  // the alternation, "  Bearer   " trimmed to "Bearer" and was stored.
  const withoutScheme = trimmed.replace(/^bearer(?:\s+|$)/i, "");
  return withoutScheme.trim();
}

/* ------------------------------------------------------------ rule 2: digest */

/**
 * Below this length the digest would re-display most of the key, so the pane
 * shows the mask alone. NCBI keys are 36 characters and Semantic Scholar keys
 * 40 (`docs/02` §3.1, §6.4); nothing legitimate is near the threshold.
 */
export const MIN_DIGEST_KEY_LENGTH = 12;

/** The mask between head and tail. Eight bullets, as §1.9 draws it. */
const DIGEST_MASK = "••••••••";

/**
 * Rule 2's digest: first three and last four characters, `sk-…••••••••1a2b`.
 *
 * **This is the project's one sanctioned exception to "truncation leaks a
 * prefix"** (`P1-T22`), and it holds only because the pane is the owner's own
 * screen. The host computes it once per store and returns it to the pane; it is
 * never logged, never put in an error, never written anywhere. A key shorter
 * than {@link MIN_DIGEST_KEY_LENGTH} gets the mask alone, because seven of
 * eleven characters is not a digest.
 */
export function keyDigest(key: string): string {
  if (key.length < MIN_DIGEST_KEY_LENGTH) {
    return DIGEST_MASK;
  }
  return `${key.slice(0, 3)}…${DIGEST_MASK}${key.slice(-4)}`;
}

/* ------------------------------------------------------------- rule 3: badge */

/** What the pane script reads off `Zotero.isWin` / `isMac` / `isLinux`. */
export type PanePlatform = "win" | "mac" | "linux" | "other";

/**
 * The five things the badge can say.
 *
 * `"windows"` and `"mac"` are `docs/09` §1.9 item 3's named tiers. `"session"`
 * is its degraded tier 2, *"Not saved between sessions"* (`P3-T03`'s dialog
 * wrote `secretBackend = "session"`; painted since `P3-T04`). `"unavailable"`
 * is its warning for no store at all. **`"indeterminate"` is `P1-T44`'s and
 * was added to §1.9 on 2026-10-15**: `P1-T41` measured (2026-10-13) that the
 * startup probe cannot tell a Linux system keyring from Gecko's `NSSKeyStore`
 * substitute, because a missing libsecret does not make `encrypt()` fail
 * (`docs/09` §1.7, the 2026-09-30 block). §1.8's verbatim text is only true if
 * the badge is accurate, so until gate `G-09`'s library-presence check lands
 * the badge on Linux must say that it cannot tell, rather than claim either
 * tier.
 */
export type BackendBadgeState =
  "windows" | "mac" | "indeterminate" | "session" | "unavailable";

export interface BackendBadge {
  readonly state: BackendBadgeState;
  readonly messageId: MainWindowMessageId;
  /** Warning colour, per §1.9 item 3's "warning-coloured" degraded states. */
  readonly warning: boolean;
  /** Whether a key may be stored at all. False only when no backend is live. */
  readonly canStore: boolean;
  /**
   * Whether the badge names an operating-system store — the only case in
   * which `docs/09` §1.9 item 8's "do not travel with your Zotero data folder"
   * sentence is known to be true.
   */
  readonly osStore: boolean;
}

/**
 * `docs/07` §8.5's `secretBackend` value for tier 1, duplicated from
 * `src/zotero/keychain.ts`'s `secretBackendPrefValue` because this layer may
 * not import that module. `test/unit/ui/preferencesPane.test.ts` asserts the
 * two literals agree.
 */
export const OS_KEYSTORE_PREF_VALUE = "oskeystore";

/**
 * `docs/07` §8.5's `secretBackend` value for tier 2, duplicated for the same
 * reason as {@link OS_KEYSTORE_PREF_VALUE} and asserted against
 * `SECRET_BACKEND_PREF_VALUES` the same way.
 */
export const SESSION_PREF_VALUE = "session";

/**
 * Map the recorded backend and the platform to the badge.
 *
 * @param backendPref - the `secretBackend` preference's current value
 * @param platform - see {@link PanePlatform}
 */
export function backendBadge(
  backendPref: string,
  platform: PanePlatform,
): BackendBadge {
  if (backendPref === SESSION_PREF_VALUE) {
    // docs/09 §1.9 item 3: warning-coloured, and the fields still store — into
    // memory only, which is what the user chose in P3-T03's dialog.
    return {
      state: "session",
      messageId: PREFERENCES_L10N.backendSession,
      warning: true,
      canStore: true,
      osStore: false,
    };
  }
  if (backendPref !== OS_KEYSTORE_PREF_VALUE) {
    return {
      state: "unavailable",
      messageId: PREFERENCES_L10N.backendUnavailable,
      warning: true,
      canStore: false,
      osStore: false,
    };
  }
  switch (platform) {
    case "win":
      return {
        state: "windows",
        messageId: PREFERENCES_L10N.backendWindows,
        warning: false,
        canStore: true,
        osStore: true,
      };
    case "mac":
      return {
        state: "mac",
        messageId: PREFERENCES_L10N.backendMac,
        warning: false,
        canStore: true,
        osStore: true,
      };
    default:
      return {
        state: "indeterminate",
        messageId: PREFERENCES_L10N.backendIndeterminate,
        warning: true,
        canStore: true,
        osStore: false,
      };
  }
}

/* ------------------------------------------ docs/09 §1.8: paragraph 1, tier 2 */

/**
 * Which message opens the residual-risk statement. Paragraph 1 says the keys
 * are "encrypted using your operating system's credential store", which is
 * untrue under tier 2, so while the badge is `"session"` the pane shows
 * `docs/09` §1.8's tier-2 sentence in its place — keys held in memory only,
 * written nowhere, gone when Zotero closes — and paragraphs 2, 3 and 5
 * unchanged (owner, 2026-10-23, `plan/00` §6 item 274(a); gate `G-19`;
 * paragraph 4 is swapped too, by {@link riskOwnAccountMessageId}). Every other
 * badge keeps paragraph 1.
 *
 * `addon/content/preferences.js`'s `logic.riskOpening` is the same rule.
 *
 * @param badge - what {@link backendBadge} returned
 */
export function riskOpeningMessageId(
  badge: Pick<BackendBadge, "state">,
): MainWindowMessageId {
  return badge.state === "session"
    ? PREFERENCES_L10N.risk1Session
    : PREFERENCES_L10N.risk1;
}

/**
 * Which message is the residual-risk statement's paragraph 4. Paragraph 4 says
 * other software running as the user "can decrypt them", which presumes
 * encryption and is untrue under tier 2, so while the badge is `"session"` the
 * pane shows `docs/09` §1.8's tier-2 paragraph-4 replacement in its place —
 * even held in memory, the keys can be read by any program running as the
 * user (owner, 2026-10-23, `plan/00` §6 item 275(b)). Every other badge keeps
 * paragraph 4. It is the same test as {@link riskOpeningMessageId}'s.
 *
 * `addon/content/preferences.js`'s `logic.riskOwnAccount` is the same rule.
 *
 * @param badge - what {@link backendBadge} returned
 */
export function riskOwnAccountMessageId(
  badge: Pick<BackendBadge, "state">,
): MainWindowMessageId {
  return badge.state === "session"
    ? PREFERENCES_L10N.risk4Session
    : PREFERENCES_L10N.risk4;
}

/* ------------------------------------------- docs/09 §1.9 item 8: restore */

/**
 * Whether the pane shows the restore notice: no key is stored at all, the
 * plugin database already holds data (so this is not a first start), and the
 * badge names an operating-system store — under any other backend the
 * notice's "do not travel with your Zotero data folder" is not known to be
 * true (`docs/09` §1.9 item 8). "No key is stored" is the store's
 * `listStoredIds()` coming back empty: every `*.keyPresent` flag is derived
 * from the same store, and this also counts `tts.gemini`, which has no block
 * here but sets `gemini.keyPresent`.
 */
export function showRestoreNotice(
  state: Pick<PaneState, "anyKeyStored" | "pluginDataPresent">,
  badge: Pick<BackendBadge, "osStore">,
): boolean {
  return badge.osStore && state.pluginDataPresent && !state.anyKeyStored;
}

/* ------------------------------------- docs/03 §14.4: the base-URL override */

/** Why {@link checkBaseUrlInput} refused a value. */
export type BaseUrlRefusal = "not-https" | "trailing-slash" | "invalid";

export type BaseUrlCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: BaseUrlRefusal };

/**
 * Validate a typed `<provider>.baseUrl` at write time (`docs/03` §14.4,
 * `docs/07` §8.5: "an absolute `https://` URL with no trailing slash, or
 * empty"). **Refuses rather than normalizes**: a missing scheme is not given
 * one and a trailing slash is not removed (`P3-T04` step 3). Surrounding
 * whitespace is trimmed, as the resolver trims the stored value.
 *
 * Also refused, as `"invalid"`: a value that does not parse, has no host, or
 * carries a user name, a password, a query or a fragment — the same set
 * `src/llm/shared/baseUrl.ts`'s resolver ignores at call time, so nothing this
 * accepts is silently replaced by the documented URL later. An `https:` value
 * spelled without `//` (`https:proxy.example`) is `"not-https"`, because the
 * user must see the scheme they are getting.
 */
export function checkBaseUrlInput(raw: string): BaseUrlCheck {
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" };
  if (!/^https:\/\//i.test(value)) return { ok: false, reason: "not-https" };
  if (/[?#]/.test(value)) return { ok: false, reason: "invalid" };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname === "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (value.endsWith("/")) return { ok: false, reason: "trailing-slash" };
  return { ok: true, value };
}

/* ----------------------------------------------------- rule 5: the Test call */

/**
 * `docs/07` §8.5's `lastValidationResult` vocabulary, minus `""`.
 *
 * `docs/09` §2.3's outcome table for the two source credentials resolves every
 * non-success observation to `inconclusive` except the two Semantic Scholar
 * rows that name a clean 401 or 403, which §2.3 marks as its general rule
 * applied speculatively. Nothing here invents a fifth value.
 */
export type TestOutcome = "ok" | "inconclusive" | "rejected" | "forbidden";

/**
 * Why an `inconclusive` was inconclusive — an enum, never free text, because
 * free text from a failure path is where a value escapes. The pane may show it
 * one day; today it is for the log line and for tests.
 */
export type InconclusiveReason =
  | "unkeyed-budget"
  | "no-rate-limit-header"
  | "body-error"
  | "no-paper-id"
  | "rate-limited"
  | "request-failed"
  // `P3-T14`: no answer arrived at all (network failure, timeout, a throw
  // with no HTTP status). The only reason that is **not** persisted: the
  // stored status is left as it was (`docs/09` §2.3).
  | "no-answer";

export type TestReport =
  | {
      readonly kind: "tested";
      readonly outcome: TestOutcome;
      readonly reason?: InconclusiveReason;
      /** ISO 8601, from the host's clock. */
      readonly checkedAt: string;
      /**
       * `P3-T14`: the key was accepted under an HTTP 429 (`docs/09` §2.3's
       * "counts as a pass"); the pane says so. LLM keys only.
       */
      readonly rateLimited?: true;
      /**
       * The key was accepted, but the account has no credit left
       * (`QuotaExceededError`; owner, 2026-10-23, `plan/00` §6 item
       * 279(a)); the pane says so. Shown at the Test only: the stored result
       * is `ok`. LLM keys only.
       */
      readonly noCredit?: true;
      /**
       * `P3-T14`: the model IDs a successful LLM Test listed, so the pane can
       * refill that provider's suggestions at once. Never stored.
       */
      readonly models?: readonly string[];
    }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" };

/**
 * `docs/09` §2.3's NCBI test call: `esummary` on one fixed public PMID with the
 * maintainer's `tool` and `email` (decision D10, enforced again at the HTTP
 * choke point). The verdict is read from `X-Ratelimit-Limit`, not the body.
 */
export const NCBI_TEST_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
export const NCBI_TEST_PMID = "37258680";

/**
 * `docs/09` §2.3's Semantic Scholar test call: one fixed public paper on the
 * `/graph/v1` base, `fields=paperId` — the smallest response the API returns
 * (`docs/02` §6.5).
 */
export const SEMANTIC_SCHOLAR_TEST_URL =
  "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/s41586-023-06139-9";

/**
 * How long to wait before the one retry §2.3 allows after a Semantic Scholar
 * 429. The keyed limit is 1 req/s (`docs/02` §6.4), so just over a second.
 */
export const SEMANTIC_SCHOLAR_RETRY_DELAY_MS = 1_100;

/** The timeout for a Test call. One round trip, not a search. */
export const TEST_TIMEOUT_MS = 15_000;

/** Build the NCBI request. `key` goes in the query string, as NCBI requires. */
export function ncbiTestRequest(key: string): HttpRequest {
  const params = new URLSearchParams({
    db: "pubmed",
    id: NCBI_TEST_PMID,
    retmode: "json",
    ...ncbiIdentityParams(),
    api_key: key,
  });
  return {
    method: "GET",
    url: `${NCBI_TEST_URL}?${params.toString()}`,
    headers: { Accept: "application/json" },
    timeoutMs: TEST_TIMEOUT_MS,
  };
}

/** Build the Semantic Scholar request. `key` goes in the `x-api-key` header. */
export function semanticScholarTestRequest(key: string): HttpRequest {
  return {
    method: "GET",
    url: `${SEMANTIC_SCHOLAR_TEST_URL}?fields=paperId`,
    headers: { Accept: "application/json", "x-api-key": key },
    timeoutMs: TEST_TIMEOUT_MS,
  };
}

/** A classification, with the reason carried only when it is inconclusive. */
export interface Classification {
  readonly outcome: TestOutcome;
  readonly reason?: InconclusiveReason;
}

/** Parse a JSON body, or `undefined` when it is not JSON. Never throws. */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `docs/09` §2.3's NCBI rows for an HTTP 200. The header is the verdict:
 * `10` is the keyed budget and the only `ok`; `3` is the unkeyed budget, which
 * is also what a rejected key produces, so it is `inconclusive` and never
 * `rejected`; no header proves nothing. A body carrying `error` or
 * `esearchresult.ERROR` is a *query* fact, not a credential fact.
 */
export function classifyNcbiResponse(response: HttpResponse): Classification {
  const body = parseJson(response.body);
  if (isRecord(body)) {
    const esearch = body["esearchresult"];
    if (
      body["error"] !== undefined ||
      (isRecord(esearch) && esearch["ERROR"] !== undefined)
    ) {
      return { outcome: "inconclusive", reason: "body-error" };
    }
  }
  const limit = response.header("x-ratelimit-limit")?.trim();
  if (limit === undefined || limit === "") {
    return { outcome: "inconclusive", reason: "no-rate-limit-header" };
  }
  if (limit === "10") {
    return { outcome: "ok" };
  }
  return { outcome: "inconclusive", reason: "unkeyed-budget" };
}

/**
 * `docs/09` §2.3's Semantic Scholar row for an HTTP 200: `ok` only when the
 * body carries a `paperId` (`docs/02` §6.5 says it always does on success).
 */
export function classifySemanticScholarResponse(
  response: HttpResponse,
): Classification {
  const body = parseJson(response.body);
  if (isRecord(body) && typeof body["paperId"] === "string") {
    return { outcome: "ok" };
  }
  return { outcome: "inconclusive", reason: "no-paper-id" };
}

/**
 * `docs/09` §2.3's rows for a request that did not resolve — the HTTP client
 * throws a typed error for every status ≥ 400 and for every transport failure.
 *
 * - **NCBI**: everything is `inconclusive`. A 429 is per IP, not per key
 *   (`docs/02` §3.1); 5xx and network failures are not credential facts; §2.3
 *   lists no NCBI row for 401 or 403 at all.
 * - **Semantic Scholar**: 401 → `rejected`, 403 → `forbidden` (§2.3's general
 *   rule, which it marks as speculative for this API); **429 → `inconclusive`**,
 *   because a 429 is exactly what the anonymous pool returns, so "429 counts as
 *   a pass" must not be applied here; everything else `inconclusive`.
 *
 * Nothing about the error's *text* is read: the message could carry the URL,
 * and the URL carries the key. Only the class is consulted.
 *
 * *(`P3-T14`.)* A failure that carries no HTTP status — a network failure, a
 * timeout, anything thrown before an answer — is `no-answer`, which the host
 * does not persist; an answered failure keeps `request-failed`.
 */
export function classifyFailure(id: SecretId, error: unknown): Classification {
  if (error instanceof RateLimitError) {
    return { outcome: "inconclusive", reason: "rate-limited" };
  }
  if (id === "source.semanticscholar") {
    if (error instanceof AuthenticationError) {
      return { outcome: "rejected" };
    }
    if (error instanceof AuthorizationError) {
      return { outcome: "forbidden" };
    }
  }
  if (httpStatusOf(error) === undefined) {
    return { outcome: "inconclusive", reason: "no-answer" };
  }
  return { outcome: "inconclusive", reason: "request-failed" };
}

/**
 * What an LLM adapter's `validateCredentials()` answers: `docs/07` §4.3's
 * `CredentialCheckResult`, restated structurally because `ui/` may not import
 * `llm/` (`docs/07` §2.3). `src/bootstrap/registerUI.ts` passes the adapter's
 * value through unchanged, and the type checker holds the two together there.
 */
export interface LlmKeyCheck {
  readonly ok: boolean;
  readonly messageKey: string;
  readonly httpStatus?: number;
  readonly models?: readonly { readonly id: string }[];
}

/**
 * `AuthenticationError`'s and `AuthorizationError`'s `messageKey`s
 * (`src/core/errors.ts`), which the adapters return on a 401 (and Gemini's
 * bad-key 400) and a 403. `test/unit/ui/preferencesPane.test.ts` asserts they
 * equal the classes' values.
 */
export const REJECTED_MESSAGE_KEY = "rh-error-auth";
export const FORBIDDEN_MESSAGE_KEY = "rh-error-forbidden";
/**
 * `QuotaExceededError`'s `messageKey`: an adapter answers a spend cap with
 * it and `ok: true` (item 279(a)). Asserted equal to the class's value.
 */
export const NO_CREDIT_MESSAGE_KEY = "rh-error-quota";

/** {@link classifyLlmCheck}'s answer. */
export interface LlmClassification extends Classification {
  /** Accepted under a rate-limit HTTP 429 (`docs/09` §2.3). */
  readonly rateLimited: boolean;
  /**
   * Accepted, but the account has no credit left (`rh-error-quota`; owner,
   * 2026-10-23, `plan/00` §6 item 279(a)). Never with {@link rateLimited}.
   */
  readonly noCredit: boolean;
}

/**
 * Map an LLM adapter's answer to `docs/07` §8.5's enum (`P3-T14` step 2):
 * `ok` → `ok` (a 429 included: the adapter already counts it as a pass;
 * an out-of-credit `rh-error-quota` is `noCredit`, never `rateLimited`);
 * `rh-error-auth` → `rejected`; `rh-error-forbidden` → `forbidden`; anything
 * else `inconclusive` — `no-answer` when no HTTP status came back, so a
 * network failure or timeout is never persisted. The `messageKey` text is
 * matched, never shown, and no other field is read.
 */
export function classifyLlmCheck(check: LlmKeyCheck): LlmClassification {
  if (check.ok) {
    const noCredit = check.messageKey === NO_CREDIT_MESSAGE_KEY;
    return {
      outcome: "ok",
      rateLimited: !noCredit && check.httpStatus === 429,
      noCredit,
    };
  }
  if (check.messageKey === REJECTED_MESSAGE_KEY) {
    return { outcome: "rejected", rateLimited: false, noCredit: false };
  }
  if (check.messageKey === FORBIDDEN_MESSAGE_KEY) {
    return { outcome: "forbidden", rateLimited: false, noCredit: false };
  }
  return {
    outcome: "inconclusive",
    reason: check.httpStatus === undefined ? "no-answer" : "request-failed",
    rateLimited: false,
    noCredit: false,
  };
}

/* ------------------------------------------------------------------ the host */

/** What the pane needs to paint one credential block. */
export interface CredentialState {
  readonly id: SecretId;
  readonly present: boolean;
  /**
   * The stored Test status (`<provider>.lastValidationResult` and
   * `.lastValidatedAt`, read through the {@link ValidationPort}), or
   * `undefined` when the key was never tested — or was replaced or removed
   * since (`P3-T14`; until then the last result of this session).
   */
  readonly lastTest: TestReport | undefined;
}

/**
 * The validation status rows (`docs/07` §8.5), bound by the composition root
 * to `readValidation` / `recordValidation` in `src/zotero/keychain.ts`, which
 * put the record through the redaction gate before `setPref` (`P3-T14` step
 * 3). This file never writes a preference itself.
 */
export interface ValidationPort {
  /** `result` `""` means never validated; `undefined` means no such rows. */
  read(
    id: SecretId,
  ): { readonly result: string; readonly at: string } | undefined;
  record(id: SecretId, result: TestOutcome, atIso: string): void;
}

/**
 * The model fields' suggestions (`P3-T14` step 5): `P3-T13`'s catalogue
 * snapshot, reduced to model IDs per provider. `stale` is true only for the
 * bundled fallback list, whose `asOfEpochMs` is its documented date.
 */
export interface ModelSuggestions {
  readonly providers: readonly {
    readonly provider: ProviderId;
    readonly models: readonly string[];
  }[];
  readonly asOfEpochMs: number;
  readonly stale: boolean;
}

/**
 * One row of the user price table (`user_price`, `docs/07` §8.3): the shape
 * of `UserPriceOverride` in `src/llm/shared/pricing.ts`, restated because
 * `ui/` may not import `llm/`. US dollars per million tokens.
 */
export interface PriceRow {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly inputPerMTokUsd: number;
  readonly outputPerMTokUsd: number;
  readonly cachedInputPerMTokUsd?: number;
  readonly asOfEpochMs: number;
}

/** The plugin database's `UserPriceStore`, bound by the composition root. */
export interface PricesPort {
  list(): Promise<readonly PriceRow[]>;
  /** Rejects, writing nothing, a row the store refuses. */
  upsert(row: PriceRow): Promise<void>;
  delete(providerId: ProviderId, modelId: string): Promise<void>;
}

/** What the pane's price form sends: the fields as typed. */
export interface PriceInput {
  readonly provider: string;
  readonly modelId: string;
  readonly input: string;
  readonly output: string;
  /** Empty: no cached-input price. */
  readonly cached: string;
  /** `YYYY-MM-DD`, read as midnight UTC. */
  readonly asOf: string;
}

/** {@link PreferencesHostApi.savePrice}'s answer. Never echoes a value. */
export type PriceSaveResult =
  | { readonly saved: true }
  | {
      readonly saved: false;
      /**
       * `invalid`: a field did not parse (checked here, before the store);
       * `refused`: the store refused the row (an unusable row, or a model ID
       * the redaction gate would change); `unavailable`: no price store.
       */
      readonly reason: "invalid" | "refused" | "unavailable";
    };

/** What the pane needs to paint one LLM provider block's non-secret rows. */
export interface ProviderState {
  readonly provider: ProviderId;
  /** The stored `<provider>.baseUrl`; `""` means the documented base URL. */
  readonly baseUrl: string;
}

export interface PaneState {
  /** The `secretBackend` preference's current value, for {@link backendBadge}. */
  readonly backendPref: string;
  /** Whether a `SecretStore` exists at all. False after a failed probe. */
  readonly storeAvailable: boolean;
  /** Every block in {@link PANE_CREDENTIALS} order. */
  readonly credentials: readonly CredentialState[];
  /** The `llmProvider` preference: the one provider block the pane shows. */
  readonly activeProvider: ProviderId;
  /** One entry per {@link LLM_CREDENTIALS} block, in that order. */
  readonly providers: readonly ProviderState[];
  /** Whether the plugin database already holds a row, for {@link showRestoreNotice}. */
  readonly pluginDataPresent: boolean;
  /** Whether any `SecretId` at all is stored, for {@link showRestoreNotice}. */
  readonly anyKeyStored: boolean;
}

export type StoreResult =
  | { readonly stored: true; readonly digest: string }
  | { readonly stored: false; readonly reason: "unavailable" | "empty" };

/** {@link PreferencesHostApi.setBaseUrl}'s answer. Never echoes the value. */
export type BaseUrlResult =
  | { readonly stored: true; readonly cleared: boolean }
  | { readonly stored: false; readonly reason: BaseUrlRefusal };

/** One voice of the pane's list: its name, shown as it is (`docs/08` §10.3). */
export interface PaneVoice {
  readonly id: string;
  readonly label: string;
}

/**
 * `P7-T08`: what the Report & audio section needs beyond its bindings.
 * {@link PreferencesHostApi.readSettings}'s answer. Reads preferences and the
 * documented voice list only: no call, no key.
 */
export interface PaneSettings {
  /** `audio.enabled`: the audio rows are shown only while it is on. */
  readonly audioEnabled: boolean;
  /**
   * The documented default voice list (`GEMINI_TTS_VOICES`,
   * `docs/04` §2.7), read by no call (`docs/08` §7.3's note of 2026-11-17).
   */
  readonly voices: readonly PaneVoice[];
  /**
   * The stored `tts.voice`, so a name the report window wrote from the live
   * list and the default list lacks is still shown.
   */
  readonly voice: string;
  /**
   * `tts.linkedFileDir`, `""` when unset. Shown in the pane, which is the
   * user's own screen; **never logged** (`docs/07` §8.5's row).
   */
  readonly linkedFolder: string;
}

/** Why {@link PreferencesHostApi.setLinkedFolder} kept the stored folder. */
export type LinkedFolderRefusal = "unusable" | "unavailable";

/** {@link PreferencesHostApi.setLinkedFolder}'s answer. Never echoes the path. */
export type LinkedFolderResult =
  | { readonly stored: true; readonly cleared: boolean }
  | { readonly stored: false; readonly reason: LinkedFolderRefusal };

/**
 * `P7-T08`: the Report & audio section's reads and its one write, bound by the
 * composition root (`publishPreferencesHost` in `src/bootstrap/registerUI.ts`)
 * — so this file imports neither `src/tts` nor `src/zotero` (the layering
 * rule) nor a preference writer.
 */
export interface SettingsPort {
  /** The hidden `audio.enabled` row. */
  readAudioEnabled(): boolean;
  /** The documented default voice list. */
  readonly voices: readonly PaneVoice[];
  /** `tts.voice`. */
  readVoice(): string;
  /** `tts.linkedFileDir`. */
  getLinkedFolder(): string;
  setLinkedFolder(path: string): void;
  /**
   * The test `resolveLinkedFolder` (`src/pipeline/audioReport/deliver.ts`)
   * applies before it uses a stored folder: absolute, an existing folder, and
   * not a temporary one.
   */
  isUsableFolder(path: string): Promise<boolean>;
}

/* --------------------------------- P7-T17: dated provider-policy lines */

/**
 * One provider-policy line as the composition root hands it over: the shape
 * of `PolicyNote` in `src/llm/shared/policyNotes.ts`, declared here because
 * `ui/` may not import `llm/` (`eslint.config.js`'s layering rule).
 */
export interface PanePolicyNote {
  readonly messageId: string;
  readonly sourceUrls: readonly string[];
  /** ISO date (`YYYY-MM-DD`) the sources were read. */
  readonly asOf: string;
}

/** {@link PreferencesHostApi.readPolicyNotes}'s line: a Fluent id and its `$date`. */
export interface PolicyLine {
  readonly id: string;
  readonly date: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * `P7-T17` step 2 at the last step before the screen: a row is shown only
 * with a known message, an ISO date and at least one `https` source, so a
 * claim without a date or a source cannot reach the pane.
 */
export function policyLines(
  notes: readonly PanePolicyNote[] | undefined,
): readonly PolicyLine[] {
  return (notes ?? [])
    .filter(
      (note) =>
        POLICY_LINE_IDS.has(note.messageId) &&
        ISO_DATE.test(note.asOf) &&
        note.sourceUrls.length > 0 &&
        note.sourceUrls.every(isHttpsUrl),
    )
    .map((note) => ({ id: note.messageId, date: note.asOf }));
}

/* ---------------------------------------- P7-T09: the Advanced section */

/**
 * The bytes in one MB as `cache.maxSizeMB` is converted (`cacheMaxBytes` in
 * `src/bootstrap/container.ts`: MB × 1024 × 1024), so the usage line and the
 * cap are in one unit.
 */
const BYTES_PER_MB = 1024 * 1024;

/** `docs/07` §8.5's Diagnostics row: the checkbox's two values. */
export const VERBOSE_LOG_LEVEL = "debug";
export const QUIET_LOG_LEVEL = "warn";

/** One namespace's line under the cache-size field. */
export interface CacheUsageRow {
  readonly namespace: CacheNamespace;
  readonly entries: number;
  readonly bytes: number;
  /** `bytes` in the cap's unit ({@link BYTES_PER_MB}). */
  readonly megabytes: number;
}

/**
 * {@link PreferencesHostApi.cacheStats}'s answer: the namespaces holding
 * anything, in `CACHE_NAMESPACES`' order, and their total. The total is the
 * sum of the rows, so the rows always add up to it.
 */
export interface CacheUsage {
  readonly rows: readonly CacheUsageRow[];
  readonly entries: number;
  readonly bytes: number;
  readonly megabytes: number;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * `P7-T09` step 2: the cache's own counts (`Cache.stats()`), as the pane's
 * lines. A namespace with nothing in it has no line; the total is always
 * shown.
 */
export function cacheUsage(stats: CacheStats): CacheUsage {
  const rows: CacheUsageRow[] = [];
  for (const namespace of CACHE_NAMESPACES) {
    const counted = stats.byNamespace[namespace] as
      { entries?: unknown; bytes?: unknown } | undefined;
    const entries = countOf(counted?.entries);
    const bytes = countOf(counted?.bytes);
    if (entries === 0 && bytes === 0) continue;
    rows.push({ namespace, entries, bytes, megabytes: bytes / BYTES_PER_MB });
  }
  const entries = rows.reduce((sum, row) => sum + row.entries, 0);
  const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  return { rows, entries, bytes, megabytes: bytes / BYTES_PER_MB };
}

/**
 * `P7-T09`: the Advanced section's reads and its one write, bound by the
 * composition root (`preferencesAdvancedPort` in
 * `src/bootstrap/registerUI.ts`), so this file imports neither `src/zotero`
 * nor a preference writer.
 */
export interface AdvancedPort {
  /** `logLevel`. */
  readLogLevel(): string;
  /** Writes `logLevel`, and nothing else. */
  writeLogLevel(level: typeof VERBOSE_LOG_LEVEL | typeof QUIET_LOG_LEVEL): void;
  /** The cache's counts, or `undefined` when the plugin database is not open. */
  cacheStats(): Promise<CacheStats | undefined>;
  /**
   * The plugin database's file, or `undefined` when it is not open. Shown on
   * the user's own screen; **never logged**.
   */
  databasePath(): Promise<string | undefined>;
  /**
   * Show the database's file in the system's file manager; `false` when the
   * database is not open.
   */
  revealDatabase(): Promise<boolean>;
}

/**
 * What `addon/content/preferences.js` is allowed to do. Published on the plugin
 * instance at {@link PREFERENCES_API_PROPERTY}.
 *
 * **No method ever returns a key or a decrypted value.** `storeKey` returns a
 * digest of what it just stored; `testKey` returns an outcome; `readState`
 * returns booleans. `SecretStore.get()` is called in exactly one place, inside
 * `testKey`, to build one request — never to populate a field (§1.9 rule 2).
 */
export interface PreferencesHostApi {
  readonly paneId: string;
  readState(): Promise<PaneState>;
  storeKey(id: string, rawInput: string): Promise<StoreResult>;
  /** Resolves to whether a key was there to remove. */
  clearKey(id: string): Promise<boolean>;
  /** Clears every stored `SecretId`; resolves to how many were removed. */
  clearAllKeys(): Promise<number>;
  /**
   * Test any of the six; see {@link isTestableCredential}. An LLM key is
   * tested by its own adapter, never read here.
   */
  testKey(id: string): Promise<TestReport>;
  /**
   * The model fields' suggestions, or `undefined` when no catalogue is bound
   * or it could not be read at all (`P3-T14` step 5).
   */
  modelSuggestions(): Promise<ModelSuggestions | undefined>;
  /** The user price table; empty with no store. */
  listPrices(): Promise<readonly PriceRow[]>;
  /** Parse, then add or replace one row (`P3-T14` step 5). */
  savePrice(input: PriceInput): Promise<PriceSaveResult>;
  /** Remove one row; resolves to whether a store was there to ask. */
  deletePrice(provider: string, modelId: string): Promise<boolean>;
  /**
   * Validate `raw` with {@link checkBaseUrlInput} and, only when it passes,
   * write `<provider>.baseUrl`. A refused value leaves the stored one as it
   * was. Never resolves the URL; `P3-T06`'s resolver does that at call time.
   */
  setBaseUrl(provider: string, raw: string): Promise<BaseUrlResult>;
  /**
   * `P7-T08`: the Report & audio section's state. With no
   * {@link SettingsPort} bound, audio reads as off and the list as empty.
   */
  readSettings(): Promise<PaneSettings>;
  /**
   * `P7-T08`: write `tts.linkedFileDir`. `""` clears it (the next linked WAV
   * asks again); any other value is stored only when
   * {@link SettingsPort.isUsableFolder} accepts it. The path is never logged.
   */
  setLinkedFolder(raw: string): Promise<LinkedFolderResult>;
  /**
   * `P7-T09`: whether `logLevel` is `debug`, which is when the verbose-logging
   * checkbox renders checked (`docs/07` §8.5, Diagnostics).
   */
  readVerboseLogging(): Promise<boolean>;
  /**
   * `P7-T09`: write `logLevel` — `debug` for `true`, `warn` for `false` — and
   * nothing else: never `logRequestBodies`, never a `debug` row. Resolves to
   * whether it was written.
   */
  setVerboseLogging(on: boolean): Promise<boolean>;
  /**
   * `P7-T09`: the cache's usage ({@link cacheUsage}), or `undefined` when the
   * plugin database is not open or its counts cannot be read.
   */
  cacheStats(): Promise<CacheUsage | undefined>;
  /**
   * `P7-T09`: the plugin database's file, `""` when it is not open. Shown in
   * the pane; never logged.
   */
  databasePath(): Promise<string>;
  /** `P7-T09`: "Show in folder". Resolves to whether it was asked. */
  revealDatabase(): Promise<boolean>;
  /**
   * `P7-T17`: the Privacy section's dated provider-policy lines
   * ({@link policyLines}); empty when none was bound.
   */
  readPolicyNotes(): Promise<readonly PolicyLine[]>;
  /**
   * `P7-T13`: the whole diagnostics text (`buildDiagnostics`,
   * `src/core/diagnostics.ts`), `""` when no {@link DiagnosticsPort} is bound
   * or it could not be built. The pane shows it before Save or Copy is offered.
   */
  diagnosticsText(): Promise<string>;
  /**
   * `P7-T13`: write `text` to the path the user just chose in the save picker.
   * The path is neither kept nor logged. Resolves to whether it was written.
   */
  saveDiagnostics(path: string, text: string): Promise<boolean>;
  /** `P7-T13`: put `text` on the clipboard. Resolves to whether it was. */
  copyDiagnostics(text: string): Promise<boolean>;
}

/**
 * `P7-T13`: the diagnostics text and its two outlets, bound by the composition
 * root (`preferencesDiagnosticsPort` in `src/bootstrap/registerUI.ts`), so this
 * file names neither a file writer nor the clipboard.
 */
export interface DiagnosticsPort {
  /** Build the text now, from the live preferences, jobs, log ring and cache. */
  text(): Promise<string>;
  /** Write it; `false` on any failure. Never logs `path`. */
  save(path: string, text: string): Promise<boolean>;
  /** Copy it; `false` on any failure. */
  copy(text: string): boolean | Promise<boolean>;
}

/**
 * The non-secret LLM rows the host reads and writes, bound by the composition
 * root to `src/prefs`' typed `getPref` / `setPref` — so this file imports no
 * preference writer, and no secret can reach one through it.
 */
export interface ProviderPrefsPort {
  /** The `llmProvider` row. */
  getActiveProvider(): string;
  getBaseUrl(provider: ProviderId): string;
  setBaseUrl(provider: ProviderId, value: string): void;
}

/** The ports {@link createPreferencesHost} binds. */
export interface PreferencesHostDeps {
  /**
   * The live store — tier 1, or tier 2 when the user chose it in `P3-T03`'s
   * dialog — or `undefined` when there is none. With `undefined` every write
   * refuses and the badge warns.
   */
  readonly secrets: SecretStore | undefined;
  /** `src/core/http/client.ts`'s `httpRequest`, or a stub in a spec. */
  readonly request: (request: HttpRequest) => Promise<HttpResponse>;
  /** Reads the non-secret `secretBackend` preference. */
  readonly getBackendPref: () => string;
  /** The LLM blocks' non-secret rows. */
  readonly providerPrefs: ProviderPrefsPort;
  /**
   * Whether the plugin database already holds a row (`docs/09` §1.9 item 8's
   * restore condition). Absent or failing: `false`, so the notice stays off.
   */
  readonly hasPluginData?: () => Promise<boolean>;
  /**
   * `P3-T14`: the provider's own adapter's `validateCredentials()` — its own
   * host, the shared `HttpClient` — or a rejection when this build has no
   * adapter for it. Absent, an LLM Test reports `inconclusive` with no answer.
   */
  readonly validateLlm?: (provider: ProviderId) => Promise<LlmKeyCheck>;
  /**
   * `P3-T14`: the stored status rows. Absent (a unit test), the host keeps
   * the status in memory, as `P1-T44` did.
   */
  readonly validation?: ValidationPort;
  /** `P3-T14` step 5: the catalogue, reduced for the model fields. */
  readonly modelSuggestions?: () => Promise<ModelSuggestions>;
  /** `P3-T14` step 5: the user price table. */
  readonly prices?: PricesPort;
  /** `P7-T08`: the Report & audio section's reads and its folder write. */
  readonly settings?: SettingsPort;
  /** `P7-T09`: the Advanced section's reads, its `logLevel` write and reveal. */
  readonly advanced?: AdvancedPort;
  /**
   * `P7-T17`: `POLICY_NOTES` (`src/llm/shared/policyNotes.ts`), handed over
   * as data by the composition root.
   */
  readonly policyNotes?: readonly PanePolicyNote[];
  /** `P7-T13`: the diagnostics text, its save and its copy. */
  readonly diagnostics?: DiagnosticsPort;
  readonly clock: Clock;
  /**
   * Redacting logger (`src/core/logger.ts`). The host logs ids, outcomes,
   * error *names* and statuses — never a message, never a value, never the
   * digest (`docs/09` §2.1).
   */
  readonly logger?: Logger;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function httpStatusOf(error: unknown): number | undefined {
  if (
    isRecord(error) &&
    typeof (error as { httpStatus?: unknown }).httpStatus === "number"
  ) {
    return (error as { httpStatus: number }).httpStatus;
  }
  return undefined;
}

/** `docs/07` §8.5's `llmProvider` default, used when the row reads as nothing we know. */
const DEFAULT_ACTIVE_PROVIDER: ProviderId = "openrouter";

/**
 * Build the pane's privileged host over the injected ports.
 *
 * Every method validates `id` against {@link PANE_CREDENTIALS} first — and
 * `testKey` against {@link SOURCE_CREDENTIALS} — so the pane cannot reach a
 * credential it has no block for, and every method is total over a missing
 * store.
 */
export function createPreferencesHost(
  deps: PreferencesHostDeps,
): PreferencesHostApi {
  const {
    secrets,
    request,
    getBackendPref,
    providerPrefs,
    hasPluginData,
    validateLlm,
    modelSuggestions: readSuggestions,
    prices,
    settings,
    advanced,
    policyNotes,
    diagnostics,
    clock,
    logger,
  } = deps;
  /**
   * Only without a bound {@link ValidationPort}: `P1-T44`'s session memory,
   * cleared by this host's own store and clear. With the port, the store's
   * `set` and `clear` reset the rows (`src/zotero/keychain.ts`).
   */
  const lastTests = new Map<SecretId, TestReport>();
  const validation: ValidationPort = deps.validation ?? {
    read: (id) => {
      const report = lastTests.get(id);
      return report?.kind === "tested"
        ? { result: report.outcome, at: report.checkedAt }
        : undefined;
    },
    record: (id, result, atIso) => {
      lastTests.set(id, { kind: "tested", outcome: result, checkedAt: atIso });
    },
  };

  /** The stored status as a report, or `undefined` when never tested. */
  function storedReport(id: SecretId): TestReport | undefined {
    const stored = validation.read(id);
    if (stored === undefined || !isTestOutcome(stored.result)) return undefined;
    return { kind: "tested", outcome: stored.result, checkedAt: stored.at };
  }

  function requireCredential(id: string): SecretId {
    if (!isPaneCredential(id)) {
      throw new RangeError(
        `[research-helper] "${id}" is not a credential this pane holds`,
      );
    }
    return id;
  }

  function requireProvider(value: string): ProviderId {
    if (!isPaneProvider(value)) {
      throw new RangeError(
        `[research-helper] "${value}" is not a provider this pane holds`,
      );
    }
    return value;
  }

  async function pluginDataPresent(): Promise<boolean> {
    if (hasPluginData === undefined) return false;
    try {
      return await hasPluginData();
    } catch (error) {
      logger?.warn("could not tell whether the plugin database holds data", {
        error: errorName(error),
      });
      return false;
    }
  }

  async function readState(): Promise<PaneState> {
    const credentials: CredentialState[] = [];
    for (const { id } of PANE_CREDENTIALS) {
      const present = secrets === undefined ? false : await secrets.has(id);
      credentials.push({ id, present, lastTest: storedReport(id) });
    }
    const active = providerPrefs.getActiveProvider();
    return {
      backendPref: getBackendPref(),
      storeAvailable: secrets !== undefined,
      credentials,
      activeProvider: isPaneProvider(active) ? active : DEFAULT_ACTIVE_PROVIDER,
      providers: LLM_CREDENTIALS.map(({ provider }) => ({
        provider,
        baseUrl: providerPrefs.getBaseUrl(provider),
      })),
      pluginDataPresent: await pluginDataPresent(),
      // Ids only, never a value: `listStoredIds()` reads login user names.
      anyKeyStored:
        secrets === undefined
          ? false
          : (await secrets.listStoredIds()).length > 0,
    };
  }

  async function setBaseUrl(
    rawProvider: string,
    raw: string,
  ): Promise<BaseUrlResult> {
    const provider = requireProvider(rawProvider);
    const checked = checkBaseUrlInput(raw);
    if (!checked.ok) {
      // The value is never logged: docs/03 §14.4 — it may hold a credential.
      logger?.info("base URL refused", { provider, reason: checked.reason });
      return { stored: false, reason: checked.reason };
    }
    providerPrefs.setBaseUrl(provider, checked.value);
    const cleared = checked.value === "";
    logger?.info("base URL stored", { provider, cleared });
    return { stored: true, cleared };
  }

  async function storeKey(
    rawId: string,
    rawInput: string,
  ): Promise<StoreResult> {
    const id = requireCredential(rawId);
    if (secrets === undefined) {
      logger?.warn("key not stored: no secret backend is live", {
        credential: id,
      });
      return { stored: false, reason: "unavailable" };
    }
    const value = normalizeKeyInput(rawInput);
    if (value.length === 0) {
      return { stored: false, reason: "empty" };
    }
    await secrets.set(id, value);
    // A new key has no test result yet; the old one described the old key.
    lastTests.delete(id);
    logger?.info("key stored", { credential: id, length: value.length });
    // The digest goes to the caller and nowhere else — not into the line above.
    return { stored: true, digest: keyDigest(value) };
  }

  async function clearKey(rawId: string): Promise<boolean> {
    const id = requireCredential(rawId);
    if (secrets === undefined) {
      return false;
    }
    const had = await secrets.has(id);
    await secrets.clear(id);
    lastTests.delete(id);
    logger?.info("key cleared", { credential: id, removed: had });
    return had;
  }

  async function clearAllKeys(): Promise<number> {
    if (secrets === undefined) {
      return 0;
    }
    // The port's one sweep (`clearEveryStoredId`, P3-T02): every stored
    // SecretId, not only the pane's six, and it keeps going past a failure.
    const count = await secrets.clearAll();
    lastTests.clear();
    logger?.info("all stored keys removed", { count });
    return count;
  }

  /** The LLM path: the provider's own adapter reads and sends the key. */
  async function issueLlm(provider: ProviderId): Promise<{
    readonly classification: Classification;
    readonly rateLimited: boolean;
    readonly noCredit: boolean;
    readonly models: readonly string[] | undefined;
  }> {
    if (validateLlm === undefined) {
      return {
        classification: { outcome: "inconclusive", reason: "no-answer" },
        rateLimited: false,
        noCredit: false,
        models: undefined,
      };
    }
    let check: LlmKeyCheck;
    try {
      check = await validateLlm(provider);
    } catch (error) {
      // Name and status only, for the reason `testKey` gives below.
      logger?.warn("LLM key test failed before an answer", {
        provider,
        error: errorName(error),
        httpStatus: httpStatusOf(error),
      });
      return {
        classification: { outcome: "inconclusive", reason: "no-answer" },
        rateLimited: false,
        noCredit: false,
        models: undefined,
      };
    }
    const { rateLimited, noCredit, ...classification } =
      classifyLlmCheck(check);
    const models =
      check.ok && Array.isArray(check.models)
        ? check.models
            .map((model) => model.id)
            .filter((id): id is string => typeof id === "string")
        : undefined;
    return { classification, rateLimited, noCredit, models };
  }

  async function issue(id: SecretId, key: string): Promise<Classification> {
    if (id === "source.ncbi") {
      try {
        return classifyNcbiResponse(await request(ncbiTestRequest(key)));
      } catch (error) {
        return classifyFailure(id, error);
      }
    }
    // Semantic Scholar: one retry after a 429, per docs/09 §2.3.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return classifySemanticScholarResponse(
          await request(semanticScholarTestRequest(key)),
        );
      } catch (error) {
        if (error instanceof RateLimitError && attempt === 0) {
          await clock.sleep(SEMANTIC_SCHOLAR_RETRY_DELAY_MS);
          continue;
        }
        return classifyFailure(id, error);
      }
    }
  }

  async function testKey(rawId: string): Promise<TestReport> {
    const id = requireCredential(rawId);
    if (secrets === undefined) {
      return { kind: "unavailable" };
    }
    const llm = llmCredentialFor(id);
    let classification: Classification;
    let rateLimited = false;
    let noCredit = false;
    let models: readonly string[] | undefined;
    if (llm !== undefined) {
      // P3-T14: an LLM key is never read here and never reaches the source
      // requests below; its own adapter reads it and sends it to its own
      // host. `has()` never decrypts.
      if (!(await secrets.has(id))) {
        return { kind: "absent" };
      }
      ({ classification, rateLimited, noCredit, models } = await issueLlm(
        llm.provider,
      ));
    } else {
      // The one `get()`: for the request, never for a field (§1.9 rule 2).
      const key = await secrets.get(id);
      if (key === undefined || key.length === 0) {
        return { kind: "absent" };
      }
      try {
        classification = await issue(id, key);
      } catch (error) {
        // `issue` catches request failures itself; this is for a defect in
        // the classifiers. The name is logged, the message is not: a message
        // built from a response could carry the URL, and the URL carries the
        // key.
        logger?.warn("key test could not be classified", {
          credential: id,
          error: errorName(error),
          httpStatus: httpStatusOf(error),
        });
        classification = { outcome: "inconclusive", reason: "request-failed" };
      }
    }
    const report: TestReport = {
      kind: "tested",
      outcome: classification.outcome,
      ...(classification.reason !== undefined && {
        reason: classification.reason,
      }),
      checkedAt: new Date(clock.now()).toISOString(),
      ...(rateLimited && { rateLimited: true as const }),
      ...(noCredit && { noCredit: true as const }),
      ...(models !== undefined && { models }),
    };
    // docs/09 §2.3: no answer, no verdict — the stored status stays as it was.
    const persisted = classification.reason !== "no-answer";
    if (persisted) {
      try {
        validation.record(id, report.outcome, report.checkedAt);
      } catch (error) {
        logger?.warn("key test outcome not stored", {
          credential: id,
          error: errorName(error),
        });
      }
    }
    logger?.info("key tested", {
      credential: id,
      outcome: report.outcome,
      reason: report.reason,
      persisted,
    });
    return report;
  }

  async function modelSuggestions(): Promise<ModelSuggestions | undefined> {
    if (readSuggestions === undefined) return undefined;
    try {
      return await readSuggestions();
    } catch (error) {
      logger?.warn("model suggestions unavailable", {
        error: errorName(error),
      });
      return undefined;
    }
  }

  async function listPrices(): Promise<readonly PriceRow[]> {
    if (prices === undefined) return [];
    try {
      return await prices.list();
    } catch (error) {
      logger?.warn("price table could not be read", {
        error: errorName(error),
      });
      return [];
    }
  }

  async function savePrice(input: PriceInput): Promise<PriceSaveResult> {
    if (prices === undefined) return { saved: false, reason: "unavailable" };
    const row = parsePriceInput(input);
    if (row === undefined) return { saved: false, reason: "invalid" };
    try {
      await prices.upsert(row);
    } catch (error) {
      // The model ID is never logged: the store refuses a credential-shaped
      // one, and that is exactly the value that must not reach a log line.
      logger?.info("price row refused", {
        provider: row.providerId,
        error: errorName(error),
      });
      return { saved: false, reason: "refused" };
    }
    logger?.info("price row stored", { provider: row.providerId });
    return { saved: true };
  }

  async function deletePrice(
    rawProvider: string,
    modelId: string,
  ): Promise<boolean> {
    const provider = requireProvider(rawProvider);
    if (prices === undefined) return false;
    await prices.delete(provider, modelId);
    logger?.info("price row removed", { provider });
    return true;
  }

  async function readSettings(): Promise<PaneSettings> {
    if (settings === undefined) {
      return { audioEnabled: false, voices: [], voice: "", linkedFolder: "" };
    }
    try {
      return {
        audioEnabled: settings.readAudioEnabled(),
        voices: settings.voices.map((voice) => ({
          id: voice.id,
          label: voice.label,
        })),
        voice: settings.readVoice(),
        linkedFolder: settings.getLinkedFolder(),
      };
    } catch (error) {
      logger?.warn("pane settings could not be read", {
        error: errorName(error),
      });
      return { audioEnabled: false, voices: [], voice: "", linkedFolder: "" };
    }
  }

  async function setLinkedFolder(raw: string): Promise<LinkedFolderResult> {
    if (settings === undefined) return { stored: false, reason: "unavailable" };
    const path = typeof raw === "string" ? raw.trim() : "";
    // The path is a local path: no line below names it (docs/09 §2.2).
    if (path === "") {
      settings.setLinkedFolder("");
      logger?.info("linked audio folder cleared");
      return { stored: true, cleared: true };
    }
    let usable: boolean;
    try {
      usable = await settings.isUsableFolder(path);
    } catch (error) {
      logger?.info("linked audio folder could not be checked", {
        error: errorName(error),
      });
      return { stored: false, reason: "unavailable" };
    }
    if (!usable) {
      logger?.info("linked audio folder refused", { reason: "unusable" });
      return { stored: false, reason: "unusable" };
    }
    settings.setLinkedFolder(path);
    logger?.info("linked audio folder stored");
    return { stored: true, cleared: false };
  }

  async function readVerboseLogging(): Promise<boolean> {
    if (advanced === undefined) return false;
    try {
      return advanced.readLogLevel() === VERBOSE_LOG_LEVEL;
    } catch (error) {
      logger?.warn("log level could not be read", { error: errorName(error) });
      return false;
    }
  }

  async function setVerboseLogging(on: boolean): Promise<boolean> {
    if (advanced === undefined) return false;
    // `logLevel` only: never `logRequestBodies`, never a `debug` row
    // (docs/07 §8.5, Diagnostics).
    const level = on === true ? VERBOSE_LOG_LEVEL : QUIET_LOG_LEVEL;
    try {
      advanced.writeLogLevel(level);
    } catch (error) {
      logger?.warn("log level could not be written", {
        error: errorName(error),
      });
      return false;
    }
    logger?.info("log level set from the pane", { level });
    return true;
  }

  async function cacheStats(): Promise<CacheUsage | undefined> {
    if (advanced === undefined) return undefined;
    try {
      const stats = await advanced.cacheStats();
      return stats === undefined ? undefined : cacheUsage(stats);
    } catch (error) {
      logger?.warn("cache usage could not be read", {
        error: errorName(error),
      });
      return undefined;
    }
  }

  async function databasePath(): Promise<string> {
    if (advanced === undefined) return "";
    try {
      const path = await advanced.databasePath();
      return typeof path === "string" ? path : "";
    } catch (error) {
      // The error's message can quote the path: its name only.
      logger?.warn("database location could not be read", {
        error: errorName(error),
      });
      return "";
    }
  }

  async function revealDatabase(): Promise<boolean> {
    if (advanced === undefined) return false;
    try {
      const shown = await advanced.revealDatabase();
      logger?.info("database folder requested", { shown });
      return shown;
    } catch (error) {
      logger?.info("database folder could not be shown", {
        error: errorName(error),
      });
      return false;
    }
  }

  async function diagnosticsText(): Promise<string> {
    if (diagnostics === undefined) return "";
    try {
      const answer: unknown = await diagnostics.text();
      const text = typeof answer === "string" ? answer : "";
      logger?.info("diagnostics text built", {
        lines: text === "" ? 0 : text.split("\n").length,
      });
      return text;
    } catch (error) {
      logger?.warn("diagnostics text could not be built", {
        error: errorName(error),
      });
      return "";
    }
  }

  async function saveDiagnostics(path: string, text: string): Promise<boolean> {
    if (diagnostics === undefined) return false;
    if (typeof path !== "string" || path === "") return false;
    if (typeof text !== "string" || text === "") return false;
    try {
      // The path is the user's choice: neither kept nor logged.
      const saved = (await diagnostics.save(path, text)) === true;
      logger?.info("diagnostics saved", { saved });
      return saved;
    } catch (error) {
      // The error's message can quote the path: its name only.
      logger?.warn("diagnostics could not be saved", {
        error: errorName(error),
      });
      return false;
    }
  }

  async function copyDiagnostics(text: string): Promise<boolean> {
    if (diagnostics === undefined) return false;
    if (typeof text !== "string" || text === "") return false;
    try {
      const copied = (await diagnostics.copy(text)) === true;
      logger?.info("diagnostics copied", { copied });
      return copied;
    } catch (error) {
      logger?.warn("diagnostics could not be copied", {
        error: errorName(error),
      });
      return false;
    }
  }

  return {
    paneId: PREFERENCES_PANE_ID,
    readState,
    storeKey,
    clearKey,
    clearAllKeys,
    testKey,
    setBaseUrl,
    modelSuggestions,
    listPrices,
    savePrice,
    deletePrice,
    readSettings,
    setLinkedFolder,
    readVerboseLogging,
    setVerboseLogging,
    cacheStats,
    databasePath,
    revealDatabase,
    readPolicyNotes: () => Promise.resolve(policyLines(policyNotes)),
    diagnosticsText,
    saveDiagnostics,
    copyDiagnostics,
  };
}

/** Whether `value` is one of {@link TestOutcome}'s four. */
function isTestOutcome(value: string): value is TestOutcome {
  return (
    value === "ok" ||
    value === "inconclusive" ||
    value === "rejected" ||
    value === "forbidden"
  );
}

/** A price as typed: a finite number of zero or more, or `undefined`. */
function parsePrice(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Parse the price form (`P3-T14` step 5) into a {@link PriceRow}, or
 * `undefined` when any field does not parse: a provider the pane has a block
 * for, a non-empty model ID, input and output prices of zero or more (plain
 * decimals: no sign, no exponent, no thousands separator), an optional cached
 * price of the same form, and an `as of` date `YYYY-MM-DD` that is a real
 * calendar day, read as midnight UTC. The store applies its own rules after
 * this (`isUsableUserPriceOverride`, and the redaction gate on the model ID).
 */
export function parsePriceInput(input: PriceInput): PriceRow | undefined {
  if (!isPaneProvider(input.provider)) return undefined;
  const modelId = input.modelId.trim();
  if (modelId === "") return undefined;
  const inputPrice = parsePrice(input.input);
  const outputPrice = parsePrice(input.output);
  if (inputPrice === undefined || outputPrice === undefined) return undefined;
  const cachedText = input.cached.trim();
  const cached = cachedText === "" ? undefined : parsePrice(cachedText);
  if (cachedText !== "" && cached === undefined) return undefined;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.asOf.trim());
  if (date === null) return undefined;
  const [year, month, day] = [
    Number(date[1]),
    Number(date[2]),
    Number(date[3]),
  ];
  const asOfEpochMs = Date.UTC(year, month - 1, day);
  const check = new Date(asOfEpochMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  return {
    providerId: input.provider,
    modelId,
    inputPerMTokUsd: inputPrice,
    outputPerMTokUsd: outputPrice,
    ...(cached !== undefined && { cachedInputPerMTokUsd: cached }),
    asOfEpochMs,
  };
}

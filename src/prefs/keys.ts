/**
 * Preference key strings — the single source of truth (`docs/07` §2.2,
 * `P1-T03`).
 *
 * **Scope.** `P1-T03`. This file holds the *strings*; `./schema.ts` holds the
 * types, defaults and bounds that `docs/07` §8.5 fixes for each one. Splitting
 * them that way is what `docs/07` §2.2's tree asks for ("`keys.ts` — pref key
 * constants (single source of truth)") and it means a typo in a key is a
 * compile error in exactly one place rather than a silently-absent pref at run
 * time.
 *
 * **Only the keys a shipped phase reads are here.** Phase 1's twelve came with
 * `P1-T03`; `P3-T32` added the fifty §8.5 rows Phase 3 reads and the
 * `semanticscholar.keyPresent` key `P2-T05` had spelled inline in the schema
 * (`plan/04` §0.2 item 2 makes `P3-T32` the only Phase 3 card that adds a key);
 * `P4-T02` added the five "Report & audio" keys Phase 4 reads (2026-10-26);
 * `P5-T02` added the three Phase 5 reads (2026-11-02).
 * Rows for later phases (`tts.*`, `background.enabled`, …) are not here. Adding a row means adding it to `docs/07` §8.5 first, then
 * here, then to `addon/prefs.js`, then to the pane — §8.5's own ordering rule.
 *
 * ## The two call conventions
 *
 * `Zotero.Prefs.get(pref, global)` prefixes `pref` with
 * `ZOTERO_CONFIG.PREF_BRANCH` (`"extensions.zotero."`) when `global` is falsy,
 * and this plugin's branch nests under Zotero's own (`docs/01` §7.1). So the
 * same preference has two spellings and `docs/07` §8.5.1 tabulates which caller
 * uses which:
 *
 * | Caller | Form |
 * |---|---|
 * | Plugin code (`src/**`) | {@link PREF_BRANCH} + key, `global` omitted |
 * | `preference=` in the pane markup, and `prefs.js` | {@link PREF_BRANCH_ROOT} + key |
 *
 * `addon/prefs.js` carries the **bare** key in source: the scaffold prefixes it
 * at build time from `build.prefs.prefix` (`docs/13` §1.4), so the fully
 * qualified spelling above is a post-build statement, not what the file on disk
 * looks like.
 */

/**
 * Branch-relative prefix, as `Zotero.Prefs` takes it with `global` omitted.
 *
 * Note the trailing dot: `PREF_BRANCH + "searchYears"` must produce
 * `research-helper.searchYears`, which `Zotero.Prefs` then expands to
 * `extensions.zotero.research-helper.searchYears`.
 */
export const PREF_BRANCH = "research-helper.";

/**
 * The fully qualified branch, as `Services.prefs`, `about:config`, the pane's
 * `preference=` attribute and the post-build `prefs.js` spell it.
 *
 * It is `package.json`'s `config.prefsPrefix` plus a dot; that field is what
 * `zotero-plugin.config.ts` hands the scaffold, so the two cannot drift without
 * this constant being wrong.
 */
export const PREF_BRANCH_ROOT = "extensions.zotero.research-helper.";

/** `extensions.zotero.research-helper.<key>` — the markup / `prefs.js` form. */
export function qualifiedPrefKey(key: string): string {
  return PREF_BRANCH_ROOT + key;
}

/**
 * Branch-relative key per `docs/07` §8.5 row, keyed by the name plugin code
 * uses.
 *
 * The property name and the key string differ wherever §8.5 puts a row inside a
 * dotted family — `ncbiKeyPresent` → `"ncbi.keyPresent"` — which is the shape
 * §8.5.1's own example uses for `fullTextMode` → `"summary.fullTextMode"`. The
 * property is an identifier; the string is the preference.
 */
export const PREF_KEYS = {
  // Sources & search (docs/07 §8.5, "Sources & search").
  sources: "sources",
  searchYears: "searchYears",
  maxResults: "maxResults",
  useTranslators: "useTranslators",
  hideExisting: "hideExisting",
  contactEmail: "contactEmail",

  // LLM providers & models (docs/07 §8.5, "LLM providers & models"; P3-T32).
  llmProvider: "llmProvider",
  openrouterModel: "openrouter.model",
  openaiModel: "openai.model",
  geminiModel: "gemini.model",
  anthropicModel: "anthropic.model",
  openrouterBaseUrl: "openrouter.baseUrl",
  openaiBaseUrl: "openai.baseUrl",
  geminiBaseUrl: "gemini.baseUrl",
  anthropicBaseUrl: "anthropic.baseUrl",
  summaryModel: "summaryModel",
  reportModel: "reportModel",
  screeningModel: "screening.model",
  privacyMode: "privacy.mode",
  privacyEgressAcknowledged: "privacy.egressAcknowledged",
  // The Gemini key declared paid (owner, 2026-10-22, plan/00 §6 item 269(b)).
  geminiPaidTier: "gemini.paidTier",
  llmTokenEstimateCalibration: "llm.tokenEstimateCalibration",

  // Summarization (docs/07 §8.5, "Summarization"; P3-T32).
  summaryFullTextMode: "summary.fullTextMode",
  summaryFullTextAutoMaxPapers: "summary.fullTextAutoMaxPapers",
  summaryConfirmAboveCents: "summary.confirmAboveCents",
  summaryMinAbstractChars: "summary.minAbstractChars",
  fullTextPreferJATS: "fullText.preferJATS",
  fullTextHardPageCap: "fullText.hardPageCap",
  autoSummarize: "autoSummarize",
  screeningThreshold: "screening.threshold",
  screeningRetractionPolicy: "screening.retractionPolicy",
  screeningNonEnglishPolicy: "screening.nonEnglishPolicy",
  screeningDedupe: "screening.dedupe",
  cacheEnabled: "cache.enabled",
  cacheIgnoreModel: "cache.ignoreModel",
  cacheLastSeenPromptVersions: "cache.lastSeenPromptVersions",
  cacheMaxSizeMB: "cache.maxSizeMB",

  // Report & audio (docs/07 §8.5, "Report & audio"; P3-T32 — perPaperNotes;
  // P4-T02 — the five rows the trend report reads).
  reportLanguage: "reportLanguage",
  reportTargetWords: "report.targetWords",
  reportMaxCritiqueRounds: "report.maxCritiqueRounds",
  reportCritiqueModel: "report.critiqueModel",
  reportSaveNote: "report.saveNote",
  reportPerPaperNotes: "report.perPaperNotes",
  // P4-T21 (owner, plan/00 §6 item 332(b)): not user-visible.
  reportPausedNoticeShown: "report.pausedNoticeShown",

  // Related papers & recommendations (docs/07 §8.5; P5-T02).
  relatedLinkToSeed: "related.linkToSeed",
  relatedEnabled: "related.enabled",
  recommendEnabled: "recommend.enabled",

  // Runtime & concurrency (docs/07 §8.5, "Runtime & concurrency").
  concurrency: "concurrency",
  timeoutSeconds: "timeoutSeconds",
  runMaxSpendCents: "run.maxSpendCents",
  runMaxSessionSpendCents: "run.maxSessionSpendCents",
  prefsSchemaVersion: "prefsSchemaVersion",

  // Diagnostics (docs/07 §8.5, "Diagnostics").
  logLevel: "logLevel",
  logRequestBodies: "logRequestBodies",

  // Non-secret key-presence flags (docs/07 §8.5, last block). NEVER a key —
  // only whether one is present, when it was last validated and with what
  // outcome, and which backend holds it (decision D5).
  openrouterKeyPresent: "openrouter.keyPresent",
  openaiKeyPresent: "openai.keyPresent",
  geminiKeyPresent: "gemini.keyPresent",
  anthropicKeyPresent: "anthropic.keyPresent",
  ncbiKeyPresent: "ncbi.keyPresent",
  semanticscholarKeyPresent: "semanticscholar.keyPresent",
  openrouterLastValidatedAt: "openrouter.lastValidatedAt",
  openaiLastValidatedAt: "openai.lastValidatedAt",
  geminiLastValidatedAt: "gemini.lastValidatedAt",
  anthropicLastValidatedAt: "anthropic.lastValidatedAt",
  ncbiLastValidatedAt: "ncbi.lastValidatedAt",
  semanticscholarLastValidatedAt: "semanticscholar.lastValidatedAt",
  openrouterLastValidationResult: "openrouter.lastValidationResult",
  openaiLastValidationResult: "openai.lastValidationResult",
  geminiLastValidationResult: "gemini.lastValidationResult",
  anthropicLastValidationResult: "anthropic.lastValidationResult",
  ncbiLastValidationResult: "ncbi.lastValidationResult",
  semanticscholarLastValidationResult: "semanticscholar.lastValidationResult",
  secretBackend: "secretBackend",
} as const;

/** The name plugin code uses for a preference. */
export type PrefKeyName = keyof typeof PREF_KEYS;

/** A branch-relative preference key string. */
export type PrefKey = (typeof PREF_KEYS)[PrefKeyName];

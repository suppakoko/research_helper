// Default preference values.
//
// Zotero 7+ loads this file automatically from the plugin root — it is not
// declared in manifest.json and bootstrap.js must not load it (docs/01 §7.2).
// It is read on install, on enable, and on EVERY startup, and the values land
// on the DEFAULT branch, which is why Zotero.Prefs.clear() restores them and
// why shipping a better default needs no migration code (docs/07 §8.5.3).
//
// The keys here are BARE. zotero-plugin-scaffold injects the prefix at build
// time from `build.prefs.prefix` in zotero-plugin.config.ts, which is
// `extensions.zotero.research-helper` (docs/01 §7.1, docs/13 §1.4). Verified
// 2026-09-10: the upstream template uses the same bare form, with no
// `__prefsPrefix__` placeholder.
//
// docs/07 §8.5 IS THE SCHEMA; this file is only the subset that ships a default
// on the default branch. Every line below has a matching entry in
// src/prefs/schema.ts with an identical default, and
// test/unit/prefs/schema.test.ts reads both files and asserts it. Add a
// preference to docs/07 §8.5 first, then to src/prefs/, then here, then to the
// pane — that order is §8.5's own rule.
//
// Phase 1's twelve keys (P1-T03 step 5), P2-T05's semanticscholar.keyPresent,
// and the docs/01 §7.2 lines for the rows Phase 3 reads (P3-T32, 2026-10-20).
// docs/01 §7.2 lists more (reportLanguage, tts.*) because it transcribes the
// whole of §8.5; those rows arrive with the phases that read them. docs/01
// §7.2 also notes that a row with no pane control needs no pref() line at all,
// since the typed accessor falls back to the schema default — so the Phase 3
// rows §7.2 gives no line (summaryModel, reportModel, screening.model,
// privacy.egressAcknowledged, llm.tokenEstimateCalibration, the summary.*,
// fullText.* and screening.* families, cache.enabled, cache.ignoreModel,
// cache.lastSeenPromptVersions, report.perPaperNotes and every
// *.lastValidatedAt) get none here. The four Phase 1 rows below that §7.2 does
// not list (logRequestBodies, prefsSchemaVersion, secretBackend,
// ncbi.keyPresent) are listed anyway because a setting the user cannot find in
// about:config is a setting they cannot audit.
//
// NO CREDENTIAL EVER APPEARS HERE. Decision D5 (docs/00 §3): secrets go
// through Zotero.OSKeyStore.encrypt() into Services.logins. Preferences hold
// only non-secret settings, `*.keyPresent` booleans, the selected backend and
// validation metadata. docs/09 §1.7's tier 4 (plaintext prefs) is deliberately
// NOT IMPLEMENTED: "implementing it as a fallback guarantees it becomes the
// common case."

// ---------------------------------------------------------------------------
// Sources & search — docs/07 §8.5, "Sources & search"
// ---------------------------------------------------------------------------

// All seven v1 sources (D2, docs/00 §3; FR-2). bioRxiv/medRxiv have no keyword
// search (docs/02 §8.4), so on a keyword run they contribute ID lookup and
// preprint↔published resolution only; that is why they are members and not
// omissions. `openalex` is NOT a valid member — OpenAlex is out of v1 (D2).
// Membership in this list IS each source's enable flag: there is deliberately
// no per-source `enabled` boolean (docs/07 §8.5).
pref(
  "sources",
  "pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv",
);
// Recency window in years, 1–20. Bound in docs/08 §7.3 → Search.
pref("searchYears", 3);
// Result cap per run, 10–200 (the step of 10 is the widget's, not a validity
// rule). Bound in docs/08 §7.3 → Search.
pref("maxResults", 100);
// MUST ship false: Strategy B (docs/01 §6.3) costs one identifier lookup per
// record and cannot meet NFR-1. Schema row and the reasoning: docs/07 §8.5.
pref("useTranslators", false);
pref("hideExisting", true);
// General contact address, NOT NCBI-specific: it is sent only as Crossref's
// `mailto` parameter, which Phase 2 uses. NCBI always receives the maintainer
// address per NBK25497 (D10). See docs/02 §2.2, which calls the name
// `ncbi.email` "actively misleading".
pref("contactEmail", "");

// ---------------------------------------------------------------------------
// LLM providers & models — docs/07 §8.5, "LLM providers & models" (P3-T32)
// ---------------------------------------------------------------------------

// Model IDs are owned by docs/03 §§2.5, 3.5, 4.6, 5.5 and change on a scale of
// weeks. These are seed defaults only — the picker is repopulated from each
// provider's models endpoint at run time (docs/03 §9); never hardcode a model
// ID anywhere else.
pref("llmProvider", "openrouter");
pref("openrouter.model", "anthropic/claude-sonnet-5");
pref("openai.model", "gpt-5.6-terra");
pref("gemini.model", "gemini-3.8-flash");
pref("anthropic.model", "claude-sonnet-5");
// Per-provider base-URL override (FR-29). EMPTY means "use the base URL docs/03
// documents for that provider". Bound in docs/08 §7.3, so each needs a default
// here or the field paints empty. Never a credential — a proxy that needs
// authentication is out of scope.
pref("openrouter.baseUrl", "");
pref("openai.baseUrl", "");
pref("gemini.baseUrl", "");
pref("anthropic.baseUrl", "");
// Global default privacy mode: "strict" | "balanced" | "full". Semantics owned
// by docs/09 §3.5; per-collection overrides are NOT prefs (they live in the
// collection_settings table, docs/07 §8.3). Bound in docs/08 §7.3.
pref("privacy.mode", "balanced");

// ---------------------------------------------------------------------------
// Summarization — docs/07 §8.5, "Summarization" (P3-T32)
// ---------------------------------------------------------------------------

// MUST ship false: onAsyncRender fires on every selection change (docs/08
// §3.3), so an unconditional LLM call there burns credits.
pref("autoSummarize", false);
// Global cache cap in MB, 100–5000 (docs/07 §8.5; cap semantics in docs/07
// §9.2). Bound in the Advanced groupbox of docs/08 §7.3, so it needs a default
// here or the field paints empty.
pref("cache.maxSizeMB", 500);

// ---------------------------------------------------------------------------
// Runtime & concurrency — docs/07 §8.5, "Runtime & concurrency"
// ---------------------------------------------------------------------------

// The `llm` worker-pool size, 1–8 (docs/07 §7.2). Bound in docs/08 §7.3 →
// Advanced (P3-T32).
pref("concurrency", 3);

// timeoutSeconds × 1000 is the `timeout` passed to Zotero.HTTP.request. 60
// deliberately doubles Zotero's own 30 000 ms default because LLM calls are
// long (docs/07 §7.3). Range 10–600. Bound in docs/08 §7.3 → Advanced.
pref("timeoutSeconds", 60);
// Spend ceilings in whole US cents, 0 = off (docs/07 §8.5; semantics in
// docs/06 §11.4): run.maxSpendCents is the per-run cap,
// run.maxSessionSpendCents the per-Zotero-session one. Every surface shows and
// accepts dollars. Neither is bound by a control; both are listed here so they
// are visible in about:config. Changing either default is gate G-20 (P3-T32;
// renamed from the USD keys by P3-T39, plan/00 §6 item 245).
pref("run.maxSpendCents", 0);
pref("run.maxSessionSpendCents", 0);
// How far the pref migrations of docs/07 §8.5.3 have got. 0 = none has run, and
// no migration entry exists yet: §8.5.3 is explicit that renames applied
// before first release need no entry, only document updates.
pref("prefsSchemaVersion", 0);

// ---------------------------------------------------------------------------
// Diagnostics — docs/07 §8.5, "Diagnostics"
// ---------------------------------------------------------------------------

// "error" | "warn" | "info" | "debug". Bound by the "Verbose debug logging"
// checkbox in docs/08 §7.3, which writes "debug" when checked and "warn" when
// unchecked, through a scripted handler that still needs a default to read on
// first paint. There is deliberately NO `debug` boolean pref: docs/07 §8.5
// (Diagnostics) removed it so the checkbox and the level cannot drift.
pref("logLevel", "warn");
// A CONTENT switch, not a verbosity one: raising logLevel never turns it on,
// and enabling it must show an explicit warning that abstracts and prompts
// reach the debug log. It can never write a credential whatever its value —
// docs/09 §2.1's KEYISH_FIELD / KEY_PATTERNS redaction runs at the logger
// regardless of this setting.
pref("logRequestBodies", false);

// ---------------------------------------------------------------------------
// Non-secret key-presence flags — docs/07 §8.5, last block
//
// Presence and status only, NEVER the key itself. Written by the SecretStore,
// read by the prefs pane so a status row paints without a keychain round-trip.
// ---------------------------------------------------------------------------

// Whether an NCBI API key is in the keystore. Phase 1's rate-limit switch reads
// it: a keyed caller gets 10 req/s from E-utilities, an unkeyed one 3 req/s
// (docs/02 §3.1). A wrong or expired key does not error, it silently drops the
// user back to 3 req/s, which is why the validation-result rows exist.
pref("ncbi.keyPresent", false);
// Whether a Semantic Scholar API key is in the keystore (P2-T05; docs/07 §8.5,
// docs/01 §7.2). Never the key. The adapter reads the key itself from the
// SecretStore at request time and docs/07 §7.3 paces this host at 0.9/s in
// both modes, so this flag drives the prefs pane's status row only.
pref("semanticscholar.keyPresent", false);
// The four LLM providers' presence flags (P3-T32). Never the key.
pref("openrouter.keyPresent", false);
pref("openai.keyPresent", false);
pref("gemini.keyPresent", false);
pref("anthropic.keyPresent", false);
// Last key-validation outcome, one line per credential holder — the SAME SIX
// ids as keyPresent above, not just the four LLM providers: "" (never
// validated) | "ok" | "rejected" | "forbidden" | "inconclusive". Non-secret
// status only, never any part of the key. Written by the validation flow and by
// docs/09 §2.4 step 3; read by the prefs pane to paint the per-provider status
// row on first paint. The *.lastValidatedAt
// rows get no line: docs/01 §7.2 lists none (P3-T32).
pref("openrouter.lastValidationResult", "");
pref("openai.lastValidationResult", "");
pref("gemini.lastValidationResult", "");
pref("anthropic.lastValidationResult", "");
pref("ncbi.lastValidationResult", "");
pref("semanticscholar.lastValidationResult", "");
// Which secret backend is live, for the prefs pane's storage badge:
// "oskeystore" | "session" | "" (unprobed, or no store). These are docs/07
// §8.5's spellings; secretBackendPrefValue maps the port's SecretBackend
// ("os-keychain" | "session-only") onto them. No passphrase tier ships in v1
// (gate G-10; corrected 2026-10-22, plan/00 §6 item 268).
pref("secretBackend", "");

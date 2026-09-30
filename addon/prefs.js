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
// Phase 1's twelve keys and no others (P1-T03 step 5). docs/01 §7.2 lists more
// because it transcribes the whole of §8.5; those rows arrive with the phases
// that read them. docs/01 §7.2 also notes that a row with no pane control needs
// no pref() line at all, since the typed accessor falls back to the schema
// default — the four such rows below (logRequestBodies, prefsSchemaVersion,
// secretBackend, ncbi.keyPresent) are listed anyway because a setting the user
// cannot find in about:config is a setting they cannot audit.
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
// Runtime & concurrency — docs/07 §8.5, "Runtime & concurrency"
// ---------------------------------------------------------------------------

// timeoutSeconds × 1000 is the `timeout` passed to Zotero.HTTP.request. 60
// deliberately doubles Zotero's own 30 000 ms default because LLM calls are
// long (docs/07 §7.3). Range 10–600. Bound in docs/08 §7.3 → Advanced.
pref("timeoutSeconds", 60);
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
// Which secret backend is live, for the prefs pane's storage badge:
// "oskeystore" | "session" | "passphrase" | "" (unprobed). These are docs/07
// §8.5's spellings, which are NOT docs/09 §1.7's SecretBackend union
// ("os-keychain" | "session-only" | "passphrase") — §8.5 is the authority for
// a preference's allowed values.
pref("secretBackend", "");

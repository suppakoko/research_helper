/* eslint-disable no-undef */
// Default preference values.
//
// Zotero 7+ loads this file automatically from the plugin root — it is not
// declared in manifest.json and bootstrap.js must not load it (docs/01 §7.2).
//
// The keys here are BARE. zotero-plugin-scaffold injects the prefix at build
// time from `build.prefs.prefix` in zotero-plugin.config.ts, which is
// `extensions.zotero.research-helper` (docs/01 §7.1). Verified 2026-09-10:
// the upstream template uses the same bare form, with no `__prefsPrefix__`
// placeholder.
//
// NO CREDENTIAL EVER APPEARS HERE. Decision D5 (docs/00 §3): secrets go
// through Zotero.OSKeyStore.encrypt() into Services.logins. Preferences hold
// only non-secret settings and `*.keyPresent` booleans. The full schema is
// docs/07 §8.5; P0-T02 ships only what the skeleton needs to boot.

pref("enable", true);

VERDICT
Done. The 15 failures are fixed in test code only. All three integration runs passed 195 of 195 on this ko-KR machine. Before the change, the same tree gave 180 passed and 15 failed: the same 15 as plan/reports/followup-285b.md. No product code was needed (src/, addon/, .ftl), and plan/ and docs/ were not touched. Nothing is committed.

FILES CHANGED
- test/integration/support/uiLocale.ts (new): the shared helper, moved out of l10n.spec.
  - Exports: LOCALE_PREF, UILocaleSnapshot, UILocaleLog, captureUILocale, describeUILocale, requestUILocale (the same mechanism as before: set Services.locale.requestedLocales, wait until the app locales lead with the request, then an idle wait), pinUILocale (capture, then request), restoreUILocale.
  - restoreUILocale clears intl.locale.requested if it had no user value, otherwise writes the old value back. It then waits until the app locales match the snapshot.
  - The header explains why the pin exists and records the measurement under FINDINGS 2.
- test/integration/l10n.spec.ts:
  - The local LOCALE_PREF and the body of requestUILocale are removed. The two calls now use the shared requestUILocale with the spec's log.
  - The describe's before/after now use captureUILocale, describeUILocale and restoreUILocale.
  - The startup log line keeps its format ("Zotero.locale ko-KR; intl.locale.requested (default); app locales …").
  - The Korean checks are unchanged.
- test/integration/searchDialog-flow.spec.ts:
  - The "P1-T35: the host the composition root published" and "P1-T22: the Search & Import window driving the pipeline" blocks each gain a block-local localeBefore.
  - Each block's before() now starts with pinUILocale(["en-US"]), before the window opens. Its after() ends with restoreUILocale, after the window is closed.
  - The P2-T25 block opens no window, so it is not pinned.
  - New header section "The UI locale (2026-10-26)".
  - Comments updated with dated notes: the module note on the locale left on ko-KR; the item 206 tier-name test; the role-row comment in "P2-T14: bioRxiv draws its ⊕ role row…" (the locale-independent assertion itself is kept as it was); and the 429 test's "en-US fallback until the Korean is reviewed".
- test/integration/preferences.spec.ts:
  - Declares Mocha's before().
  - "P1-T44 — the preference pane" gains localeBefore, a before() that pins en-US, and a restore in after() right after the preferences window closes, before the plugin re-enable step that could throw.
  - New header section explaining the pin.

RUNS
- Baseline, current tree before my edits (00:23–00:28): 180 passed, 15 failed, the same 15 as the report.
- Trial with the pins (00:31–00:34): 195 passed. The log shows each block finding ["ko-KR","en-US"], switching to en-US, and restoring with "user value false; app [\"ko-KR\",\"en-US\"]".
- Mutant M1, marked /* MUTANT M1 */: the P1-T22 pin moved to the end of before(), after the window had opened and connected on ko-KR. Result (00:34–00:37): 195 passed. Restored by copy; the hash b53b555f… matches the saved final copy. The final MUTANT grep is empty.
- npm run typecheck: 0. npm run lint:check: 0 (Prettier clean). npx eslint .: 0.
- npm run test: unit 86 files, 4,013 passed; contract 2 files, 40 passed.
- npm run build: 0. typings/*.d.ts hashes are identical before and after, and identical to the hashes at the start of the session.
- NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish, three runs. Each pre-flight found 0 MUTANT lines and 0 zotero.exe processes on .scaffold\test\profile (checked with Get-CimInstance by name):
  - Run 1, 00:39:51–00:42:54: 195 passed, 0 failed.
  - Run 2, 00:42:56–00:46:11: 195 passed, 0 failed.
  - Run 3, 00:46:14–00:49:28: 195 passed, 0 failed.
  - Each run logs 4 restores back to ["ko-KR","en-US"]: l10n, preferences, P1-T35 and P1-T22. No test-profile Zotero is left running.

FINDINGS
1. Why the pin works: the baseline (no pin) fails 15 and the pinned tree passes all 195, so the pin is what fixes them. In the baseline, "fills the table", "banner", "imports exactly the checked set", the two P1-T43 tests and the toast showed counts of 0 or 37 rather than Korean text. They pass once the window is pinned, which suggests they failed downstream of the Korean text waits rather than for a separate reason.
2. How windows pick up the locale:
   - A search window opened after the switch starts on en-US.
   - A search window already open on ko-KR also re-translates after the switch: mutant M1 passed all 195.
   - So for the search window, the pin's timing does not matter. The specs still pin before opening, so they do not depend on the re-translation.
   - An already-open preferences window was not measured.
   - On this machine, ["en-US"] negotiates to en-US followed by four other English locales (en-NZ, en-GB, en-CA, en-AU, in varying order).
3. I pinned whole blocks rather than single tests, because both search windows are opened in before(). As a result, the item 206 test and the locale-independent role-row assertion now run on en-US, not ko-KR. Both are still written to hold in any locale, and their comments now say so. The rendered Korean is now covered only by l10n.spec.
4. I chose a shared helper rather than a copy, because three specs need it.
5. A full run is now about 3 minutes, against about 5 in the baseline, because there are no more 25-second timeouts.

WHAT I DID NOT CHECK
- A real en-US-default machine. On en-US the pin requests the locale already in use and the restore clears the pref. That follows from the code and is not measured.
- Whether an already-open preferences window re-translates.
- macOS or Linux, or other Zotero versions (only 10.0.3).
- searchDialog-table, phase1-dod and the other specs were not given pins. None of them failed, and the Korean-text grep found no English-asserting locale dependence in them, but that is not proof they are locale-proof on every machine.
- I did not commit. Scratch files (logs, backups, three.sh) are in C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\ko\.

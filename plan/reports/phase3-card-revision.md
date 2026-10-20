## Phase 3 card revision — report (2026-10-20)

**Verdict.** I edited only `D:\KIST\projects\research_helper\plan\04-phase-3-llm-summaries.md`. A copy of the original is at `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p04-original-backup.md`. I rewrote all 31 cards against the current tree and added six cards, so the file now has 37 cards (3,328 lines, down from 4,006). All six owner decisions are applied. Every remaining open question is written into the card it affects as a `> **Open — recommended:**` line, 27 in all, and each one names the document section it would change.

The new phase sum is **27.5 developer-days over 37 cards**, up from 23.5 d over 31. The band is 27.5–38.5 d (× 1.4), with the whole-day rounding left to you. Gated cards went from 6 to 8.

I checked the file with a script that reads cards the same way `scripts/derive-task-index.ts` does. It found:
- all 37 cards have every template field and section;
- every Depends on / Blocks pair matches, and the graph has no cycles;
- the §1 table matches each card's title, estimate and gate;
- no line-number citations remain.

I did **not** run `npm run index:derive`, and I did not run typecheck, lint or any test suite.

Other changes to the file:
- **Header and opening:** "Last updated" is now 2026-10-20 with the new status. The opening section no longer claims a `Cache` exists.
- **New §0.1:** a table of what is already built, cited by name.
- **New §0.2:** ten rules every card follows:
  - Korean stubs and owner review at gate G-41;
  - only `P3-T32` adds preference rows;
  - test file naming;
  - the integration command `npm run test:integration -- --exit-on-finish --abort-on-fail` (the runner has no `--grep`), repeated three times before calling a failure a regression;
  - database changes as appended migrations, plus the two tests that pin the schema version;
  - one redaction gate for stored records;
  - no live requests in tests;
  - the agent never handles keys (gate G-18);
  - the import-boundary rules;
  - every card names who calls what it builds;
  - an agent stops at a step that depends on an unresolved open line.
- **Rewritten §3 and §4:** §3 is the estimate reconciliation. §4 keeps its numbering; item 5 (publisher licensing) is now decided.

### Every card

| Card | What changed | Estimate |
|---|---|---|
| P3-T01 | Re-scoped to the three missing pieces: the `Secret` class in `src/prefs/secrets.ts` (where `docs/09` §2.1 puts it); `loggableHeaders` in `src/core/errors.ts`, which calls the existing `redact`; and a `debug: true` rule appended to the existing `no-restricted-syntax` list in `research-helper/scoped-registration`. Says to use the one redactor (eight patterns). Ring buffer and debug bundle deferred to Phase 7 with a pointer. Now blocks T07–T10, not T02/T05. | 0.5 → 0.25 |
| P3-T02 | Already-built steps listed by name, with no line numbers. Remaining work: four LLM rows in `KEY_PRESENCE_PREFS`, startup reconciliation of all flags in `installSecretStore`, `clearAll` on the store and in `container.ts`, and the `uninstall()` call. The non-existent `secretSchema.spec.ts` is dropped. Backend detection (waiting on gate G-09) moved to the new T37, so this card is ungated. No longer blocks T07–T10. | 0.75 → 0.5 |
| P3-T03 | Session-only tier only (G-10). Passphrase file, `keychainPassphrase.ts` and `secrets.enc` removed. Adds the dialog window, its script, the opener in `registerUI.ts`, and the `installSecretStore` change. Job pausing moved to T29. Strings go in `mainWindow.ftl`. | 0.75 → 0.5 |
| P3-T04 | The pane built by `P1-T44` is marked as landed. Remaining work: four LLM provider blocks through `PreferencesHostApi` and `preferences.js`, base-URL validation, and the empty-after-restore text. References to `prefsController.ts`, `keyFieldController.ts`, `preferences.ftl` and `prefsPaneKeys.spec.ts` removed. Typing in the keys is G-18 and the agent stops there. | 1.75 → 1.0 |
| P3-T05 | Error classes, `withRetry` (decorrelated jitter), `REQUEST_BUDGET_MS` (90 s per request) and the `TimeoutError` exclusion are marked as built. Remaining work: `errorMap.ts`, one shared LLM retry budget for the provider rows, and moving four LLM message keys out of `DEFERRED_ERROR_MESSAGE_IDS`. No longer depends on T01. | 0.5 (unchanged) |
| P3-T06 | `ProviderId` and the lint rule marked as built. Now creates `registerProviders.ts` (listed as modify before) and calls it from `installServices`, replaces the `LLMRouter` placeholder, and creates the heuristic `tokenEstimate.ts`. That move fixes the T08/T09 → T13 inverted dependency. | 0.75 → 1.0 |
| P3-T07 | Wraps the key in `Secret`. Adds the `HOST_POLICIES` row and `hostLimiter.test.ts`, and the `registerProviders.ts` caller. Depends on T01, T05, T06 (T02 dropped). | 1.0 (unchanged) |
| P3-T08 | As T07; `countTokens` now uses T06's estimator. | 0.5 (unchanged) |
| P3-T09 | As T08. | 0.5 (unchanged) |
| P3-T10 | As T07. | 0.75 (unchanged) |
| P3-T11 | `sse.ts` is extended rather than created. Streaming runs over XHR in `client.ts` and `createZoteroHttpTransport`, as the Phase 0 `V-8` spike found. | 0.5 → 0.75 |
| P3-T12 | Test file names fixed; who calls it is named. | 0.75 (unchanged) |
| P3-T13 | Heuristic estimator moved to T06; filling the pane's model lists moved to T14. Uses the Cache layer from T33. No longer adds a preference row or depends on T04. | 0.75 → 0.5 |
| P3-T14 | The shipped NCBI/Semantic Scholar Test code is reused. Now fills the model lists (from T13). Uses `queue.ts` from T34 and the redaction gate from T36. "Enter a key manually" is now G-18, the owner's step. | 0.5 → 0.75 |
| P3-T15 | Adds the `collection_settings` migration (with the two version tests), replaces the `PrivacyPolicy` placeholder, and puts the egress log through the redaction gate. The disclosure content moved to `pipeline/` because `ui/` cannot import `llm/`. Korean Gemini warning is a commented stub, never machine-translated. | 0.75 → 1.0 |
| P3-T16 | Rewritten so a run that reaches a spend ceiling pauses and asks; `docs/06` §5.4 (and §11.4's "abort") must change first. Adds the window script, its opener, the `BudgetGuard` type replacement and the `rh-error-budget` key move. | 1.0 → 1.25 |
| P3-T17 | Uses the existing `Semaphore` in `buildPipelineSet`. Notes that there is no "zotero-write pool". The queue and checkpoint come from T34. | 0.75 (unchanged) |
| P3-T18 | `fulltext.ts` is modified, not created. Corrected D-06-4: a line break is not a guaranteed paragraph break. Integration test command fixed. | 0.75 → 0.5 |
| P3-T19 | Corrected D-06-4. The de-hyphenation instruction was backwards (see the false claims below). The 0.80 OCR threshold and the "demote" test are removed, pending open lines. | 0.75 (unchanged) |
| P3-T20 | G-12 with open-access papers under a redistributable licence: a candidate list for the owner, and each download asked for separately. | 1.75 (unchanged) |
| P3-T21 | Title shortened. `V-8b` facts added (no font size; outline and heading blocks exist; `style.bold` unreliable). Detector design is an open line. | 0.5 (held, pending the owner's ruling) |
| P3-T22 | Test names fixed. | 0.5 (unchanged) |
| P3-T23 | Corrected D-06-4. How paragraphs are found is now an open line. | 0.75 (unchanged) |
| P3-T24 | Starts without step 7 (moved to T26). Adds `zotero-plugin.config.ts` and a `*.md` typing; how the `.md` prompts reach the bundle is an open line. | 0.5 (unchanged) |
| P3-T25 | Adds the `summary` migration and its version tests, and stores through the redaction gate. | 1.0 → 1.25 |
| P3-T26 | Builds on T33. Takes over T24's old step 7 (prompt-version invalidation at startup). | 0.5 (unchanged) |
| P3-T27 | Adds the search window's markup, script, view model, strings and the pipeline's `run`. Where screening runs is marked as a guess. Wait for `P2-T13` to land first. Now depends on T35. | 0.75 → 1.0 |
| P3-T28 | Adds a section factory to `registrations.ts`, `registerSection` to `REGISTRATION_APIS`, the lifecycle test, and the notifier through `notifierRegistration`. | 0.5 → 0.75 |
| P3-T29 | Adds the `summarize` member of `PipelineSet`, the entries in `registerMenus.ts` (no new `collectionMenu.ts`), the dialog files, and the menu-count tests. Takes over the session-tier pause when a key is missing. | 1.0 → 1.25 |
| P3-T30 | No keys from `.env`: keys come only from the process environment for one session, or the OS keystore. New gate with a stated spend (about $1). The recorder strips key-like values; its live mode never runs under `test:contract`; only the owner records. Contract tests named `*.contract.test.ts`. | 0.75 (unchanged) |
| P3-T31 | The key-prefix check is run by the owner through a script that prints only match counts. The debug-bundle step is dropped, with an open line. Index bookkeeping moved to you. Depends on T37. | 0.75 (unchanged) |

### New cards

- **P3-T32 — Preference rows Phase 3 reads.** About 50 `docs/07` §8.5 rows. Touches `src/prefs/*`, `addon/prefs.js` and `schema.test.ts`. No dependencies; blocks 16 cards. 0.75 d.
- **P3-T33 — Cache layer.** `src/core/cache/cache.ts`, `keys.ts` and `sqliteCache.ts`, the `cache_entry` migration, and a way for the service graph to reach the database. 1.0 d.
- **P3-T34 — Job record and queue.** `jobRecord.ts`, `queue.ts`, `checkpoint.ts`, and the `job` migration, storing through the redaction gate. 1.0 d.
- **P3-T35 — Wire the pipeline-context members.** In `createPipelineContextFactory`, plus the `ConfigReader` type. 0.5 d.
- **P3-T36 — One redaction gate** for new stored records, built in `src/core/provenance.ts` on top of `redactText` and `omitSecretFields`. 0.25 d.
- **P3-T37 — Keyring-less Linux backend detection.** Gated on G-09; split out of T02 so that gate holds up only this card. 0.25 d.

### Estimates to propagate (your `npm run index:derive`)

- **Changed:** T01 0.5→0.25, T02 0.75→0.5, T03 0.75→0.5, T04 1.75→1.0, T06 0.75→1.0, T11 0.5→0.75, T13 0.75→0.5, T14 0.5→0.75, T15 0.75→1.0, T16 1.0→1.25, T18 0.75→0.5, T25 1.0→1.25, T27 0.75→1.0, T28 0.5→0.75, T29 1.0→1.25.
- **New:** T32 0.75, T33 1.0, T34 1.0, T35 0.5, T36 0.25, T37 0.25.
- **Arithmetic:** 23.5 − 2.0 + 2.25 + 3.75 = **27.5 d**.
- **Gates:** T30 and T37 are newly gated; T02 stays ungated.
- **Starting points** (cards with no dependencies) are now T01, T05, T24, T32 and T36. T18 now depends on T32.
- **Titles changed:** T01, T02, T03, T04, T05, T13, T21.

### Open — recommended lines (27)

1. **T03** — write G-10's outcome into the documents (`docs/11` §1, `docs/09` §1.7 and §8 items 1–2, `docs/00` §3 D5).
2. **T03** — the `secretBackend` values become `oskeystore | session | ""`, dropping `passphrase` (`docs/07` §8.5, `docs/09` §1.7 and §1.9).
3. **T05** — LLM retries keep the shipped decorrelated jitter and use 5 attempts, 1000 ms base and 60 s cap; a 30-minute batch budget; and a decision on whether LLM calls use the 60 s `timeoutSeconds` (`docs/03` §11.6, `docs/07` §7.3).
4. **T06** — declare `LLMRouter` (`docs/07` §4.3 and §4.5).
5. **T07** — LLM host rows get no fixed request rate; they are paced only by `Retry-After` and `concurrency`. Applies to T08–T10 too (`docs/07` §7.3).
6. **T10** — assume no programmatic Gemini billing signal; default to free or unknown and warn on every job (`docs/09` §3.4 rule 4 and §8 item 3; gate G-06).
7. **T13** — the owner confirms the seed model IDs, the price table, and the cheapest capable model per provider (`docs/07` §8.5, `docs/03` §12.1 and §16, `docs/09` §8 item 7).
8. **T14** — keep the NCBI and Semantic Scholar key checks in the pane for now (`docs/09` §8 item 8).
9. **T15** — declare `PrivacyPolicy` (`docs/07` §4.5).
10. **T16** — ship `run.maxSessionSpendUSD` non-zero at a value the owner names, and keep `run.maxSpendUSD` off (gate G-20; `docs/07` §8.5).
11. **T19** — de-hyphenation does nothing until a contiguous-occurrence test is measured (`docs/06` §4.1 step 4).
12. **T19** — the OCR probe only warns and never demotes until thresholds are measured (`docs/06` §4.1 step 8).
13. **T20** — accept fewer than 4 open-access papers for some publisher families rather than use papers that cannot be redistributed (`docs/06` §4.3).
14. **T21** — detector built on the document outline and heading blocks, with the regex as fallback and nothing keyed on bold (`docs/06` §4.3 and §3.3.5).
15. **T23** — measure each document before deciding what a paragraph is (`docs/06` §5.3 step 3).
16. **T24** — bundle the `.md` prompts with an esbuild text loader plus a `*.md` typing (`docs/12` §17.3).
17. **T25** — create the `summary` table without the `REFERENCES work` clause for now (`docs/07` §8.3).
18. **T29** — "86 notes" means 86 `StoredSummary` rows, and 86 notes only when per-paper notes are on (`docs/11` §1).
19. **T30** — the owner records the LLM fixtures with session-only environment keys at a stated spend (`docs/13` §3.2).
20. **T31** — narrow the definition-of-done line to the debug log and notes; "copied diagnostics" is checked in Phase 7 (`docs/11` §1, `docs/07` §10.4).
21. **T31** — the same "86 notes" reading as line 18 (`docs/11` §1).
22. **T32** — the owner confirms the three ⚠ preference names (`docs/07` §8.5).
23. **T33** — open the database in `installServices` instead of `openProvenanceStore`, sharing one connection (`docs/07` §8.3).
24. **T34** — no job restarts on its own at launch; resume works by skipping cached items (`docs/07` §7.6). *New.*
25. **T35** — declare `ConfigReader` (`docs/07` §4.5).
26. **T36** — the redaction gate also runs over summary content, with a warning when it alters a long sequence quoted from a paper (`docs/09` §2.1, `docs/07` §5.2). *New.*
27. **T37** — if backend detection proves infeasible, the owner revisits G-10's 2026-09-30 ruling (`docs/09` §1.7).

### Review claims I found false or inaccurate

- **§4 item 15 and §6, "`docs/13` §3.2 still says `.env`": false.** It was corrected on 2026-10-15 and now says the recorder reads no credential from any file. The real gap is that it has no answer for LLM providers, which cannot be called without a key.
- **§2b T05, "the `HOST_POLICIES` LLM row has no retry cells": imprecise.** `HOST_POLICIES` has no LLM row at all. Only the `docs/07` §7.3 table has an LLM row, with `—` in its retry cells.
- **"About 28 missing rows": a counting difference, not an error.** Counting each provider separately, Phase 3 reads about 50 rows.
- **Missed by the review:** `docs/06` §4.1 step 4 already says the old de-hyphenation rule is backwards (a hyphenated line break arrives as `word\nword`), so old T19's Do-NOT about `hyphen- ation` was wrong.
- **Missed by the review:** three pairs of tests pin `schema_version` 1 and must move with every new migration: `provenanceRerun.test.ts` and `provenanceStore.spec.ts`.

I confirmed everything else I relied on by grep or file read. That includes: the eight patterns; the 13 rows; the `container.ts` placeholders; the empty `cache/` folder; the scaffold's test command accepting only `--abort-on-fail`, `--exit-on-finish` and `--no-watch`; and the `registerSection` comment.

### Not verified

- The ESLint flat-config precedence (I did not run ESLint).
- Whether `uninstall()` can still reach the keychain code after shutdown.
- Whether `Zotero.DBConnection` enforces foreign keys.
- Whether `scripts/build-imrad-fixtures.ts` can run outside Zotero.
- Whether the scaffold's `esbuildOptions` accepts a text loader for `.md`.
- Whether the seed model IDs and prices are current.
- Where relevance screening belongs (T27's caller is marked as a guess).
- Whether T02's startup reconciliation is reachable from a unit test.
- `crypto.subtle` availability inside Zotero.
- I ran no typecheck, lint or test suite: the change is to a plan document only.

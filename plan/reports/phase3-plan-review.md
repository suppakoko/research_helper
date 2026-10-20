# Phase 3 plan review (read-only), 2026-10-20

I changed no file. Every claim below comes from a grep or a file read in `D:\KIST\projects\research_helper`. Anything I could not check is marked **Unverified**.

## 0. Summary

- **Most Phase 3 settings have no schema row yet.** The Phase 3 cards assume the full `docs/07` §8.5 preference schema exists. `src/prefs/schema.ts` actually ships 13 rows: Phase 1's 12 plus `semanticscholar.keyPresent`. `test/unit/prefs/schema.test.ts` asserts that count (`expect(SECTION_8_5).toHaveLength(13)`). About 28 settings that Phase 3 reads have no row, and no card adds them.
- **Eleven paths are modified by Phase 3 cards but created by no card.** Examples: `src/bootstrap/registerProviders.ts`, `src/core/jobQueue/queue.ts`, `src/core/jobQueue/jobRecord.ts`, `src/pipeline/shared/checkpoint.ts`, and everything under `src/core/cache/` (that folder holds only `.gitkeep`). The Cache layer that the phase preamble says Phase 2 delivered does not exist.
- **No card names the composition root or the pipeline-context placeholders.**
  - `installServices` in `src/bootstrap/container.ts` builds the services.
  - `createPipelineContextFactory` in the same file sets `cache`, `budget`, `llm`, `config` and `privacy` to `undefined` and makes `checkpoint()` a no-op.
  - The matching types in `src/pipeline/types.ts` (`Cache`, `BudgetGuard`, `LLMRouter`, `ConfigReader`, `PrivacyPolicy`) are placeholder aliases to `unknown`.
- **Four cards are built on decisions that have since changed:**
  - Gate G-10 was decided on 2026-10-08: session-only storage only, and passphrase storage (tier 3) does not ship.
  - Phase 0's `V-8b` spike found a section outline but no font size, which changes the section-detector design.
  - The `D-06-4` correction says a line break is not a guaranteed paragraph boundary.
  - Phase 0's `V-15` spike found the 0.80 OCR threshold separates almost nothing.
- **Three security problems in card wording:**
  - `P3-T30` tells the agent to read API keys from `.env`.
  - `P3-T30` has no human gate, although recording fixtures spends money on live calls.
  - `P3-T01` would start a second redaction helper with an outdated pattern list.

## 1. Card inventory

| ID | Title | Depends on | Est. | Human gate |
|---|---|---|---|---|
| P3-T01 | Secret wrapper and unconditional log redaction | — | 0.5 | none |
| P3-T02 | `SecretStore` tier 1 — OS keychain | P3-T01, P1-T41 (DONE) | 0.75 | none on the card; **but** `plan/06` G-10 says "P3-T02 must not be started on the assumption that detection works" (G-09) |
| P3-T03 | Tier ladder — session-only and passphrase | P3-T02 | 0.75 | none on the card; needs G-09 measurement, and G-10 is decided |
| P3-T04 | Prefs pane: key fields, badge, remove-all | P3-T02, P3-T03 | 1.75 | Yes (G-18 enter keys, G-19 accept residual risk) |
| P3-T05 | LLM error taxonomy and retry policy | P3-T01 | 0.5 | none |
| P3-T06 | `LLMProvider` contract, registry, router, mock | P3-T05 | 0.75 | none |
| P3-T07 | OpenRouter adapter | P3-T02, T05, T06 | 1.0 | none |
| P3-T08 | OpenAI adapter | P3-T02, T05, T06 | 0.5 | none |
| P3-T09 | Anthropic adapter | P3-T02, T05, T06 | 0.5 | none |
| P3-T10 | Gemini adapter | P3-T02, T05, T06 | 0.75 | none (G-06 applies to any live Gemini call) |
| P3-T11 | Streaming across four adapters | T07–T10 | 0.5 | none |
| P3-T12 | Structured output, validation, repair | T07–T10 | 0.75 | none |
| P3-T13 | Model catalogue, pricing, token estimation | T07–T10 | 0.75 | none |
| P3-T14 | `validateCredentials()` and Test button | T04, T07–T10, T13 | 0.5 | Yes (G-18) |
| P3-T15 | Privacy modes, egress disclosure, Gemini warning | T07, T10, T13 | 0.75 | none |
| P3-T16 | Cost estimate, confirm gate, `BudgetGuard`, usage | T13, T15 | 1.0 | Yes (G-21; ceiling defaults are G-20) |
| P3-T17 | `llm` worker pool | T05, T06 | 0.75 | none |
| P3-T18 | Text acquisition tiers 1–2 | — | 0.75 | none |
| P3-T19 | Tiers 3–4, cleaning, OCR probe, language | T18 | 0.75 | none |
| P3-T20 | 40-PDF IMRaD fixture set | T19 | 1.75 | Yes (G-12) |
| P3-T21 | IMRaD section detector | T19 | 0.5 | none (owner design call pending, see §4) |
| P3-T22 | Detector accuracy harness, 85 % gate | T20, T21 | 0.5 | Yes (G-22) |
| P3-T23 | Chunker | T13, T21, T22 | 0.75 | none |
| P3-T24 | Prompt registry | — | 0.5 | none |
| P3-T25 | Per-paper summarizer, DR-1, grounding | T12, T16, T23, T24, T26 | 1.0 | none |
| P3-T26 | Summary cache | T19, T24 | 0.5 | none |
| P3-T27 | Screening | T12, T18, T24 | 0.75 | none |
| P3-T28 | Item-pane AI summary section | T25 | 0.5 | none |
| P3-T29 | Summarize-collection pipeline and notes | T16, T17, T25, T27 | 1.0 | none |
| P3-T30 | LLM fixtures and contract tests | T07–T12 | 0.75 | **none written — defect** (live recording spends money and needs keys; `plan/README.md` §6 "Cost") |
| P3-T31 | Phase-3 acceptance run | T14, T22, T28, T29, T30 | 0.75 | Yes (G-21, G-18) |

The sum is 23.5 d. That figure is now wrong in both directions:
- **Shrunk:** T01, T02, T04 and T05 partly landed in Phases 1–2, and T03 shrinks once tier 3 is dropped.
- **Never priced:** the schema rows, the Cache layer, the job queue, provider registration and database migrations.

## 2. Rule-10 gaps (files a card must touch but does not list)

### 2a. Gaps that affect many cards

1. **Preference rows.** `PREFS` in `src/prefs/schema.ts` and `PREF_KEYS` in `src/prefs/keys.ts` carry only Phase 1/2 rows. The cards read the following §8.5 rows without adding them:
   - P3-T04: `llmProvider`, `<provider>.model`.
   - P3-T06: `summaryModel`, `reportModel`, `screening.model`.
   - P3-T15: `privacy.mode`.
   - P3-T18: `summary.minAbstractChars`, `fullText.preferJATS`, `fullText.hardPageCap`.
   - P3-T16: `summary.confirmAboveUSD`, `summary.fullTextAutoMaxPapers`, `run.maxSpendUSD`, `run.maxSessionSpendUSD`.
   - P3-T17: `concurrency`.
   - P3-T21 and P3-T22: `summary.fullTextMode`.
   - P3-T24 and P3-T26: `cache.enabled`, `cache.ignoreModel`, `cache.lastSeenPromptVersions`, `cache.maxSizeMB`.
   - P3-T27: `screening.retractionPolicy`, `screening.nonEnglishPolicy`, `screening.dedupe`.
   - P3-T28: `autoSummarize`.
   - P3-T29: `report.perPaperNotes`.
   - Nobody adds `<provider>.lastValidatedAt` for any of the six IDs (`plan/00` §6 item 46).

   Every card that adds a row must also list `test/unit/prefs/schema.test.ts`, because its 13-row assertion fails otherwise. No card lists that test file.
2. **Paths no card creates:**
   - `src/bootstrap/registerProviders.ts` — "modify" in T06–T10.
   - `src/core/jobQueue/queue.ts` — T14, T17.
   - `src/core/jobQueue/jobRecord.ts` — T03, T17.
   - `src/pipeline/shared/checkpoint.ts` — T17.
   - `src/core/cache/keys.ts` and `src/core/cache/sqliteCache.ts` — T26.
   - `src/core/cache/cache.ts` (the `Cache` interface in `docs/07` §4.1) — needed by T13 step 3, T24 step 7 and T28 step 7.
3. **Composition root.** `installServices` (`src/bootstrap/container.ts`) is the only place that builds adapters (`registerSources(...)`) and pipelines (`registerPipelines(...)`). No Phase 3 card lists `container.ts`, yet:
   - provider construction and registration (T06–T10) happen there;
   - the tier-2 choice after a failed probe happens in `installSecretStore` (T03);
   - the pipeline context gets its LLM router, budget, cache and privacy members in `createPipelineContextFactory` (T15, T16, T26, T29);
   - a real `checkpoint` is wired there (T17).

   `src/pipeline/types.ts` (the placeholder aliases) is likewise unlisted.
4. **Database.**
   - New tables have to be added to `MIGRATIONS` in `src/bootstrap/migrations.ts`. That file's header names P3-T15 and P3-T29 for version 2, but neither card lists it, nor do T25 (`summary` table) or T26 (`cache_entry` table).
   - The database is opened in `openProvenanceStore` (`src/bootstrap/registerUI.ts`), not in the service graph, so the summary and cache stores have no route into a pipeline.
   - `docs/07` §8.3's `summary.work_key REFERENCES work(work_key)` also needs the `work` table. **Unverified** whether `Zotero.DBConnection` enforces foreign keys.
5. **Interface strings.**
   - **Every new string must be declared in `src/i18n/keys.ts`.** The ID must be added to `MAIN_WINDOW_MESSAGE_IDS` and either `KO_PENDING_REVIEW` or `KO_PRESENT`; argument messages also go in `ARGUMENT_MESSAGE_IDS` and `FluentMessageArgsMap`. Otherwise `UndeclaredBundleMessageId` fails the type check.
   - **The LLM error message keys are parked.** They sit on `DEFERRED_ERROR_MESSAGE_IDS` and must move to `ERROR_MESSAGE_IDS`, with strings, once Phase 3 makes them reachable (T05).
   - **No Phase 3 card lists `keys.ts` or its tests.** The tests are `test/unit/i18n/keys.test.ts` and `test/integration/l10n.spec.ts`.
6. **Import-boundary lint.**
   - `research-helper/layering/ui` forbids `src/ui/**` from importing `llm/` or `zotero/`.
   - `research-helper/zotero-global` forbids the `Zotero` global outside `src/zotero/` and `addon/`.
   - Registration calls must go through `src/zotero/registrations.ts`.

   The cards these rules affect:
   - T03 `secretBackendDialog.ts` (needs the keychain).
   - T04, T13 and T14 pane code (needs the store, the catalogue and `validateCredentials()`). These must go through `PreferencesHostApi`, published by `publishPreferencesHost` in `registerUI.ts`, plus `addon/content/preferences.js`.
   - T15 `egressDisclosure.ts` (needs `resolveBaseUrl`).
   - T28 (`registerSection`, `Notifier`).
7. **Test commands.** The scaffold's `zotero-plugin test` accepts only `--abort-on-fail`, `--exit-on-finish` and `--no-watch` (read from `node_modules/zotero-plugin-scaffold/dist/cli.js`). The `-- --grep X` commands in the "Verify with" sections of T02, T04, T18, T28 and T29 will not filter as written. Phase 2 cards used `-- --exit-on-finish --abort-on-fail`.
8. **Test file names.** Unit tests are 47 `.test.ts` files to 1 `.spec.ts`; integration tests are all `.spec.ts`; contract tests are `*.contract.test.ts`. Phase 3 cards create unit `.spec.ts` files throughout (T01–T03, T05–T27, T29), and T30 creates `test/contract/llm/*.spec.ts`.

### 2b. Per-card gaps

- **T01:**
  - `redact`, `redactUrl`, `KEY_PATTERNS` and `KEYISH_FIELD` already live in `src/core/errors.ts`.
  - Existing tests: `test/unit/core/errors.test.ts` and `logger-redaction.test.ts`.
  - `core/` may not import `prefs/`, so a `loggableHeaders` that `client.ts` uses must sit in `core/`.
- **T02:**
  - `src/core/secretStore.ts` must gain `clearAll` (the "No `clearAll()`" note in that file names this step).
  - `installSecretStore` reconciles only NCBI (`refreshKeyPresence(NCBI_SECRET_ID)`); new key-presence flags need startup reconciliation too.
  - Missing from the list: `test/unit/prefs/schema.test.ts`.
- **T03:**
  - Constructing file: `createKeychainSecretStore` in `keychain.ts` (listed). Caller: `installSecretStore` in `container.ts` (not listed).
  - Also missing: the dialog opener in `registerUI.ts`, an `addon/content/*.xhtml` for the dialog, and `keys.ts`.
  - The bundle to modify is `research-helper-mainWindow.ftl`.
- **T04:** Missing:
  - `src/ui/prefs/preferencesPane.ts` (`SOURCE_CREDENTIALS`, `PREFERENCES_L10N`, `backendBadge`);
  - `addon/content/preferences.js`;
  - `publishPreferencesHost` in `registerUI.ts`;
  - `KEY_PRESENCE_PREFS` in `keychain.ts`;
  - `keys.ts`;
  - tests `test/unit/ui/preferencesPane.test.ts`, `test/integration/preferences.spec.ts` and `schema.test.ts`.
- **T05:** The caller is `createRetryFor` in `container.ts`. LLM hosts get no retry policy there, because the `HOST_POLICIES` LLM row has no retry cells. Also missing: `src/core/http/client.ts`, plus `keys.ts` and the bundles for the new quota message key.
- **T06:** `registerProviders.ts` must be **create**, not modify. Missing: `installServices` (caller) and `src/pipeline/types.ts` (`LLMRouter`).
- **T07–T10:** Missing: `container.ts` (builds the adapters with `http`, `secrets` and a base-URL getter) and `test/unit/core/hostLimiter.test.ts` for the new `HOST_POLICIES` rows.
- **T11:** Missing: `src/core/http/client.ts`, the transport. Per `V-8`, streaming runs on XHR through `Zotero.HTTP.request` progress events.
- **T13:**
  - The Cache layer is absent.
  - `prefsController.ts` should be `preferencesPane.ts` + `preferences.js` + `registerUI.ts`.
  - Missing: `schema.test.ts`.
- **T14:**
  - `queue.ts` is absent.
  - The NCBI/S2 Test code already exists in `preferencesPane.ts` (`ncbiTestRequest`, `classifyNcbiResponse`, `semanticScholarTestRequest`, `classifySemanticScholarResponse`).
  - Missing: `preferences.js`, `registerUI.ts` and `schema.test.ts`.
- **T15:** Missing: `migrations.ts` (`collection_settings`, `job`), `src/pipeline/types.ts` (`PrivacyPolicy`), `container.ts` and `keys.ts`.
- **T16:**
  - Lists `costConfirm.xhtml` but no window script.
  - Missing: `keys.ts` and the dialog's caller.
  - Lists `prefsController.ts`, which should be `preferencesPane.ts`.
- **T17:**
  - The existing pool is a `Semaphore(NETWORK_METADATA_POOL_SIZE)` built in `buildPipelineSet` (`src/bootstrap/registerPipelines.ts`, unlisted).
  - Missing: `container.ts` (`checkpoint`) and `migrations.ts` (`job` table).
- **T18:** `src/zotero/fulltext.ts` already exists from the `P0-T19` spike, with no importers. It has `getAttachmentText`, `getIndexedState`, `getIndexedPageCounts` and `getFullTextAllPages`. Treat it as modify.
- **T24:** Missing: `zotero-plugin.config.ts`. Build assets are `addon/**/*.{js,json,ftl,png,xhtml,css}` and esbuild has no `.md` loader, so `src/prompts/*.md` cannot reach the bundle. Also probably a `typings/` declaration.
- **T25:** Missing: `migrations.ts`. The caller, `summarizePipeline.ts`, is T29's file.
- **T26:** The whole cache layer is missing. Missing: `migrations.ts` (`cache_entry`).
- **T27:**
  - The threshold control lives in `addon/content/searchDialog.js`/`.xhtml`, `searchImportViewModel.ts` and `research-helper-searchDialog.ftl` — all unlisted besides `searchDialog.ts`.
  - Missing: `keys.ts`.
- **T28:** Missing:
  - `src/zotero/registrations.ts`, which has no item-pane-section factory yet;
  - `eslint.config.js` `REGISTRATION_APIS` (its comment says `registerSection` is "deliberately absent");
  - `keys.ts`.
- **T29:** Missing:
  - `PipelineSet` in `src/pipeline/registry.ts`, which needs a `summarize` member;
  - `container.ts`;
  - `src/ui/menus/registerMenus.ts`, which already owns the collection submenu `rh-menu-collection` — the card instead creates `collectionMenu.ts`;
  - an `addon/content` dialog;
  - `migrations.ts`, `keys.ts`;
  - `test/integration/menus.spec.ts` and `lifecycle.spec.ts`, which count menu items.

## 3. Premises that Phase 2 (or Phases 0–1) made wrong

- **Header and preamble.** The file still reads "Last updated 2026-09-09 · no code written". The preamble's "SQLite store and `Cache`" is wrong: no Cache exists.
- **T01 is mostly landed.** The logger already redacts through `redactContext`, and the client logs only `redactUrl(url)`. "Seven KEY_PATTERNS" is out of date: `docs/09` §2.1 now has eight, including the NCBI hexadecimal shape from P1-T42. What actually remains: the `Secret` class, `loggableHeaders`, and the `debug: true` lint rule.
- **T02:**
  - The landed-table line numbers have drifted (`setSecret` is now at :246, not :241; `installSecretStore` at :1668, not :1517). That is rule 8 in action.
  - `secretSchema.spec.ts` is stale (`plan/00` §6 item 32).
  - Step 5's badge mapping landed as `backendBadge`, with an `indeterminate` state, in `preferencesPane.ts`.
- **T03:**
  - G-10 was decided on 2026-10-08: tier 2 only, and tier 3 "does not ship in v1". That invalidates the title, `keychainPassphrase.ts`, step 2 and the tier-3 done-when item.
  - `research-helper-preferences.ftl` was dropped (owner item 51; `docs/08` §10.1).
  - `jobRecord.ts` does not exist.
- **T04:**
  - P1-T44 already shipped the pane: `preferences.xhtml`, `preferences.js`, `preferencesPane.ts`, the NCBI and S2 fields, the residual-risk strings `research-helper-prefs-risk-1..5`, remove-all, and the badge.
  - `prefsController.ts`, `keyFieldController.ts`, `preferences.ftl`, `prefsPaneKeys.spec.ts` and `prefKeyBinding` all name things that do not exist.
- **T05:**
  - All the LLM error classes already exist in `errors.ts`.
  - `withRetry` already exists in `src/core/http/retry.ts`, with decorrelated jitter and `REQUEST_BUDGET_MS`. The card's full-jitter `withRetry` would collide by name.
  - `isRetriedAutomatically` excludes `TimeoutError` (owner item 230), while the card's set includes `network`.
- **T06:** `ProviderId` already exists in `src/model/ids.ts`. Step 6's lint rule is already enforced by `research-helper/zotero-global`.
- **T08/T09 have an inverted dependency.** Both delegate `countTokens` to `src/llm/shared/tokenEstimate.ts`, which T13 creates — and T13 depends on T08 and T09.
- **T11.** `src/llm/shared/sse.ts` exists, and `scripts/spike-network.ts` imports it, so extend rather than replace. The file contains a literal NUL inside a string, so plain `grep` reports it as binary; use `grep -a`.
- **T13, T14, T16** name `prefsController.ts`, which does not exist.
- **T17.** The "zotero-write pool" does not exist; only the network-metadata `Semaphore` does.
- **T18, T19 and T23 assume a line break marks a paragraph.** `docs/06` §3.3.5 corrected D-06-4 on 2026-09-16: a line break is **not** guaranteed to be a paragraph boundary. That breaks T18's Read-first, T19's Do-NOT, and T23's step 4 and Do-NOT.
- **T19.** Phase 0 report row 9 says the 0.80 OCR probe "separates almost nothing", but `docs/06` §4.1 step 8 still says 0.80.
- **T21.** `V-8b` found a section outline and heading blocks but no font size. Phase 0 recommends using the outline instead of the regex table, but `docs/06` §4.3 is unchanged.
- **The Phase 3 definition of done needs a debug bundle that does not exist.** P3-T01 step 5 and P3-T31 step 6 rely on a ring buffer and a debug bundle that do not exist (`src/core/logger.ts` header). `docs/11` puts "Copy diagnostics" and the debug bundle in Phase 7.
- **The definition of done conflicts with `docs/06` and the cards:**
  - **$0.01 ceiling.** `docs/11` §1 says the job "pauses ... and asks for confirmation". `docs/06` §5.4 and P3-T16 say the run is refused. P3-T31 says pause.
  - **"Retains 86 notes".** `report.perPaperNotes` ships `false`, and `docs/10` §5 question 3 says notes are opt-in.

## 4. Owner decisions needed before launch

1. **Who adds the ~28 missing §8.5 rows**, and confirmation of the ⚠ names (`privacy.egressAcknowledged`, `llm.tokenEstimateCalibration`, `cache.lastSeenPromptVersions`). Where: `docs/07` §8.5.
2. **The `secretBackend` value set.** The "CONFLICT" note is still open: the spellings differ from the type, and there are new NSS-degraded and indeterminate states. Where: `docs/07` §8.5 and `docs/09` §1.7, §1.9.
3. **Write G-10's outcome into the documents** (tier 3 dropped). Where: `docs/09` §1.7 and §8 items 1–2, `docs/00` §3 D5, and the `docs/11` §1 Phase 3 deliverable.
4. **G-09: can a plugin tell which key-storage backend is live** (via `js-ctypes`)? This is a precondition for P3-T02 steps 3 and 5 (`plan/00` §6 item 55). Where: `docs/09` §1.7.
5. **Rate for the LLM hosts.** The `docs/07` §7.3 row says "from provider prefs", but no such pref exists in §8.5. Where: `docs/07` §7.3 and §8.5.
6. **LLM retry numbers and batch time budget.** `docs/03` §11.6 gives only sketch defaults (5 attempts, 1000 ms base, 60 s cap) and "e.g. 30 min". Where: `docs/03` §11.6.
7. **Declare `LLMRouter`, `ConfigReader` and `PrivacyPolicy`.** Each appears only in `PipelineContext`. Where: `docs/07` §4.3 and §4.5.
8. **$0.01 ceiling: refuse, or pause and confirm?** Where: `docs/11` §1 Phase 3 definition of done against `docs/06` §5.4 and §11.4.
9. **"86 notes" or 86 `StoredSummary` rows?** Where: the `docs/11` §1 definition of done.
10. **Should spend ceilings ship non-zero?** (G-20.) Where: `docs/07` §8.5, Runtime.
11. **Debug bundle in Phase 3, or narrow the definition-of-done line.** Where: `docs/11` §1 (Phase 3 against Phase 7) and `docs/07` §10.4.
12. **IMRaD detector design after `V-8b`** (outline and heading blocks, or regex). Where: `docs/06` §4.3 and §3.3.5.
13. **Quality-gate thresholds:** OCR ratio, minimum characters, letter ratio. Where: `docs/06` §4.1.
14. **How the chunker finds paragraphs under corrected D-06-4.** Where: `docs/06` §5.3.
15. **How LLM fixtures are recorded and who pays.** Where: `docs/13` §3.2, which still says `.env`.
16. **Are the seed model IDs and the 2026-09-08 price table still current?** Examples: `anthropic/claude-sonnet-5`, `gpt-5.6-terra`, `gemini-3.8-flash`. Also, which model is "cheapest capable" for P3-T31? **Unverified here.** Where: `docs/07` §8.5, `docs/03` §12.1 and §16, `docs/09` §8 item 7.
17. **The IMRaD corpus.** Publisher-PDF licensing (`docs/09` §4.4, `plan/04` §4 item 5). G-12 should start now.
18. **Gemini tier signal and repeated warnings.** Where: `docs/09` §3.4 rule 4 and §8 item 3; G-06.
19. **Where the NCBI and S2 key checks live.** Where: `docs/09` §8 item 8.
20. **How prompt `.md` files reach the bundle.** Where: `docs/12` §17.3.
21. **Re-estimate** the shrunk cards and price the uncarded prerequisites. Where: `plan/README.md` §7 propagation list.

## 5. Recommended first cards (no overlap with P2-T13 Part B or P2-T16 Part B)

1. **P3-T01, re-scoped.** It has no dependencies and is the security floor for everything after it. Scope it to the `Secret` class, `loggableHeaders` in `core/`, and the `debug: true` lint rule. The files it touches (`src/core/*`, `eslint.config.js`) are untouched by `dedup-report.ts`, `dedupe.ts`, `ci.yml` and `plan/06`.
2. **P3-T24 without step 7** (the cache invalidation waits for P3-T26), with `zotero-plugin.config.ts` and `.test.ts` naming added. It has no dependencies, is pure data and parsing under `src/prompts/`, and needs no owner input except decision 20.
3. **A new rule-9 card adding the §8.5 rows Phase 3 reads**, after decision 1. Nearly every Phase 3 card reads these rows, so without them the phase cannot reach its definition of done. The card would touch only `src/prefs/*`, `addon/prefs.js` and `test/unit/prefs/schema.test.ts`. P3-T18 is the natural next card after it.

Hold back:
- **P3-T27** might reuse the thresholds in `src/sources/shared/dedupe.ts` while P2-T13 is tuning them.
- **P3-T30** touches `ci.yml`.
- **P3-T31** touches `plan/00`.
- **P3-T02 and P3-T03** wait on G-09.
- **P3-T20 and P3-T22** wait on G-12.

## 6. Security notes

- **P3-T30 step 2 says "reading keys from `.env`".** That contradicts D5, `.env.example` ("NEVER put an API key here"), and the `record-fixtures.ts` header ("reads no key from anywhere"). Rewrite it as process environment variables set per session or the OS keystore, and add a human gate with a stated spend.
- **P3-T01 would split the single redactor.** Creating `src/prefs/secrets.ts` with "seven" patterns would fork the one redactor and drop the NCBI hexadecimal shape. Point the card at `redact` in `src/core/errors.ts`.
- **New persisted records skip the redaction gate.** The cards T15, T25 and T29 store new records without saying so: `StoredSummary.json`, `job.error_json` and `job.input_json`, the egress log, and `CredentialCheckResult`. These should pass through one gate, in the same way `redactSearchProvenance` (`src/core/provenance.ts`) does for provenance.
- **P3-T01 step 7 lint-rule trap.** Adding a second `no-restricted-syntax` config block for `**/*` would, under flat-config precedence, replace the `research-helper/scoped-registration` selectors rather than add to them. Append to the same array instead. **Unverified by running it.**
- **P3-T31 step 6 would expose key material.** Its done-when check greps for each key's first eight characters, which requires the executor to hold those characters. The owner must run that check, or a script inside Zotero must read the keystore and print only match counts.
- **"Then, manually: enter a key" in the Verify steps of T04 and T14** must be read as G-18, the owner's step. The agent stops there.
- **Korean text.** T03, T04, T15, T16, T28 and T29 modify the `ko-KR` bundles without saying the Korean side stays a commented stub listed in `KO_PENDING_REVIEW`. T15 step 9 ("verbatim" Gemini warning) invites a machine translation. Owner-written Korean exists only where a document supplies it, such as the indeterminate badge.
- **No live requests in tests.** The catalogue and `listModels()` tests in T07 and T13 must replay fixtures. The recorder's live mode (`FIXTURE_MODE`) must never run under `test:contract`. Live Test-button checks should follow the `RH_DOD_LIVE` opt-in pattern (`plan/00` §6 item 53).

**Unverified items:** whether foreign keys are enforced on the plugin database; whether `addon/bootstrap.js` `uninstall()` can still reach the keychain code after shutdown (P3-T02 step 7); whether `scripts/build-imrad-fixtures.ts` can run outside Zotero; the flat-config override behaviour; whether the seed model IDs are still current.

### Critical Files for Implementation
- `D:\KIST\projects\research_helper\src\bootstrap\container.ts`
- `D:\KIST\projects\research_helper\src\prefs\schema.ts`
- `D:\KIST\projects\research_helper\src\pipeline\types.ts`
- `D:\KIST\projects\research_helper\src\bootstrap\migrations.ts`
- `D:\KIST\projects\research_helper\src\i18n\keys.ts`

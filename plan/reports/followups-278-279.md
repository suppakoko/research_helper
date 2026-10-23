WAVE 7 FOLLOW-UPS (plan/00 §6 items 278(a), 278(b), 279(a), 279(b), 279(d), and the stale comments from P3-T35), with the combined checks

VERDICT
All six tasks are built and tested, and the combined checks pass on the final tree.
- The documents changed first: docs/07 §4.3, §4.5 and §7.3, docs/09 §2.3 and docs/08 §7.3 each got a dated "Decided 2026-10-23 (owner, plan/00 §6 item 27x)" note before any code changed. All notes are quoted below.
- Final tree checks:
  - npm run typecheck: exit 0.
  - npm run lint:check: exit 0 (Prettier: "All matched files use Prettier code style!").
  - npx eslint .: exit 0.
  - npm run test: unit 82 files, 3835 tests passed; contract 2 files, 40 tests passed.
  - npm run build: exit 0. The five typings files hashed the same before and after.
- One `npx zotero-plugin build` was run for the new message id. It changed typings/i10n.d.ts by exactly one line, `| 'research-helper-prefs-test-ok-no-credit'` (hash 68862150… → 8bfe8dd3…). P3-T14's 20 hand-inserted lines came out unchanged, so the generator agrees with them.
- Integration suite:
  - First set of three runs: run 1 had 193 passed and 1 failed. The failure was the preferences.spec.ts P3-T04 test, which hit `NS_ERROR_FILE_IS_LOCKED` reading prefs.js. Runs 2 and 3 had 194 passed.
  - I changed only the spec's file read (see FINDINGS 1). Then three more runs on the final tree: 194 passed, 0 failed, each time.
- Mutation testing: 22 mutants, 22 killed. Each was restored by copy and checked by SHA-256. The final `grep -rn MUTANT src test addon typings scripts` is empty.
- Nothing was committed. No card State line, estimate or plan/00 line was changed. No key and no live request was used.

WHAT WAS BUILT, IN ONE PARAGRAPH EACH
- 278(a), fail closed. `withBudget` throws `ConfigurationError` before anything is sent when a `chat` or `chatStream` call carries no `budget`.
  - Why that class: docs/07 §10.1 makes `ConfigurationError` the class for a wiring fault, and the summarize stages already rethrow it as fatal (`rethrowIfFatal` in acquire.ts and jats.ts). `BudgetExceededError` was rejected because the job runner's `budgetStopOf` would read it as a spending limit and ask the user to raise it.
  - Every caller, found by grep: no product code calls the shared router yet. The key Test calls each adapter's `validateCredentials`, and the model catalogue calls `listModels` / `listCatalogue`; neither goes through the router. `completeJSON` passes the context on unchanged, so a budget it was given is kept.
  - Two tests called the router without a budget and were updated: container.test.ts ("budgets the one router", which now expects `ConfigurationError`) and router.test.ts (P3-T06's "constructs the registry and router", which now passes `budget: first.context.budget`). No caller loses its budget silently.
- 278(b), one price source.
  - What exists: a new `ModelPriceSource` (`createModelPriceSource` in src/llm/shared/modelCatalogue.ts), which is the service graph's `modelPrices`. It wraps one `createModelCatalogue` that is built without the user price table, and applies that table itself, the same way the catalogue does (new `applyUserPrices`).
  - How it is read: `pricesFor(provider, model)` is synchronous and reads the snapshot it holds. Until a catalogue snapshot has loaded, that snapshot is `bundledCatalogue()` (the documented table) with the user table applied; `loaded` is false until then. `refresh(ctx)` fetches the catalogue (cache, then network, then the bundled list) and adopts it, and never adopts an older answer over a newer one. `reloadUserPrices()` re-reads only the `user_price` table, with no network.
  - What refreshes it, and what does not:
    - Startup reads the user table once the database is open, and sends no catalogue request (item 279(c)).
    - The pane's model suggestions now refresh it (`preferencesModelSuggestions` calls `graph.modelPrices.refresh`, so the pane no longer builds a catalogue of its own).
    - The pane's price form writes through the new `reloadingUserPriceStore`, which re-reads the table after each save or removal.
  - In installServices: the router is now wrapped at a new step 6d, after the database, with `pricesFor = modelPrices.pricesFor(activeProvider, model)`.
  - Settling: a reservation now carries the prices it was priced with (`ReservationEstimate.prices`, filled by `requestEstimate`). A call whose provider reports no cost but does report its tokens is charged at those prices × those tokens. Only a call whose tokens are not reported falls back to the reservation, marked "estimated".
  - The cost dialog: it does not exist yet (P3-T29), so "the same prices the dialog shows" holds only once P3-T29 takes the dialog's prices from `graph.modelPrices` after a `refresh`. The docs/07 note says this.
- 279(a), out of credit.
  - New shared helper `isKeyAcceptedFailure` (src/llm/shared/errorMap.ts): true for any `QuotaExceededError`, whatever its HTTP status, and for any HTTP 429. All four adapters' `validateCredentials` use it, so OpenRouter's 402 is now `ok: true` with `rh-error-quota`.
  - The pane: `classifyLlmCheck` gains `noCredit`, true when `messageKey` is `rh-error-quota`; `rateLimited` is now only for a plain 429. `TestReport` gains `noCredit?`. preferences.js `testMessage` paints the new id.
  - What is stored: still `ok`, because the docs/07 §8.5 list of allowed values is unchanged. So the out-of-credit line shows at the Test only; after the pane is reopened it reads as the plain accepted line, exactly as the 429 line already did.
- 279(b), one attempt.
  - The client: new `HttpOptions.singleAttempt` in src/core/http/client.ts. When true, the request makes one attempt and is never retried, whatever the host's retry policy. Host pacing, the error-reading hook and `Retry-After` handling are unchanged. This is the one client, not a second HTTP stack.
  - The limits: new `LLM_KEY_TEST_TIMEOUT_MS = 15_000`, `LlmAttemptLimits` and `LLM_KEY_TEST_ATTEMPT` in src/core/rateLimit/hostLimiter.ts.
  - The adapters: each internal `send` takes a `limits` argument, defaulting to `llmAttemptTimeouts`. `validateCredentials` passes `LLM_KEY_TEST_ATTEMPT` for every request of the Test: OpenAI and Gemini's list call, every page of Anthropic's list (now the internal `listModelPages`), and OpenRouter's `/api/v1/key` plus its public catalogue. `listModels`, `chat` and `chatStream` keep `LLM_ATTEMPT_TIMEOUT_MS` and `LLM_RETRY_BUDGET`.
- 279(d): the en-US `research-helper-prefs-key-present` is changed. It stays on KO_PENDING_REVIEW. It has no ko-KR stub, before or after this change.
- Stale comments:
  - UNWIRED_BUDGET_GUARD's doc in budget.ts;
  - the privacyPolicy.ts header ("Callers");
  - the PipelineContext doc comment in src/pipeline/types.ts;
  - plus the module headers of budget.ts and modelCatalogue.ts and the four adapters' timeout lines.

FILES CHANGED WITH DECLARATION NAMES
- docs/07-architecture-and-data-model.md, docs/09-security-privacy-and-api-keys.md, docs/08-ui-ux-spec.md: the notes quoted below.
- src/pipeline/shared/budget.ts:
  - module header;
  - `ReservationEstimate.prices` (new);
  - `BudgetGuardDeps.prices` doc;
  - `createBudgetGuard` (settleCall uses `reserved.prices ?? deps.prices`; reserveCall passes `estimate.prices`);
  - `UNWIRED_BUDGET_GUARD` doc;
  - `WithBudgetDeps.pricesFor` doc;
  - `requestEstimate` (returns `prices`);
  - new private `unbudgeted`;
  - `withBudget` (refuses in `chat` and `chatStream`).
- src/llm/shared/modelCatalogue.ts: header; new `applyUserPrices`, `ModelPriceSource`, `ModelPriceSourceDeps`, `createModelPriceSource`, `reloadingUserPriceStore`; the `UserPriceStore` type import.
- src/llm/shared/errorMap.ts: new `isKeyAcceptedFailure`; the `UpstreamError` import.
- src/llm/types.ts: the `LLMCallContext.budget` doc.
- src/core/http/client.ts: `HttpOptions.singleAttempt`; `createHttpClient` (one attempt when it is set).
- src/core/rateLimit/hostLimiter.ts: new `LLM_KEY_TEST_TIMEOUT_MS`, `LlmAttemptLimits`, `LLM_KEY_TEST_ATTEMPT`.
- The four adapters, each `validateCredentials` with its `send` limits argument:
  - src/llm/openai/openAiProvider.ts: `listModels` takes limits; `listModels` member wrapped.
  - src/llm/anthropic/anthropicProvider.ts: new internal `listModelPages`; `listModels` member wrapped.
  - src/llm/gemini/geminiProvider.ts: `GeminiTransport.send` limits; `listModels`.
  - src/llm/openrouter/openRouterProvider.ts: `fetchCatalogue` limits; `listCatalogue` wrapped.
- src/bootstrap/container.ts (shared file):
  - imports (`createModelCatalogue`, `createModelPriceSource`, `ModelPriceSource`, `OpenRouterProvider` type; `bundledCatalogue` / `findCatalogueModel` removed);
  - `ServiceGraph.modelPrices` (new);
  - installServices step 6b comment, new step 6d (price source, startup user-table read, `withBudget` wrap), return value;
  - the createPipelineContextFactory doc line.
- src/bootstrap/registerUI.ts: `publishPreferencesHost` (`prices: reloadingUserPriceStore(...)`; binding table); `preferencesModelSuggestions` now uses `graph.modelPrices.refresh`; imports.
- src/ui/prefs/preferencesPane.ts:
  - header;
  - `PREFERENCES_L10N.testOkNoCredit`;
  - `TestReport.noCredit`;
  - new `NO_CREDIT_MESSAGE_KEY`;
  - `LlmClassification.noCredit`;
  - `classifyLlmCheck`;
  - `issueLlm` and `testKey` inside `createPreferencesHost`.
- addon/content/preferences.js: `RHPreferences` `l10n.testOkNoCredit`; `logic.testMessage`.
- src/i18n/keys.ts, both .ftl files, typings/i10n.d.ts (generated): quoted below.
- src/pipeline/shared/privacyPolicy.ts (header) and src/pipeline/types.ts (`PipelineContext` doc).
- Tests:
  - test/unit/pipeline/budget.test.ts: "passes no guard down" trimmed; new "refuses a call that carries no guard…" and "settles a call the provider does not price at the prices it was reserved with…".
  - test/unit/bootstrap/container.test.ts: "budgets the one router" updated; new "prices every reservation from graph.modelPrices (item 278(b))…" over a real node:sqlite database. It covers the startup read, a change through `reloadingUserPriceStore`, and no transport call at startup.
  - test/unit/llm/router.test.ts: one call now passes the job's budget.
  - test/unit/llm/pricing.test.ts: new describe "createModelPriceSource…", 4 tests.
  - test/unit/llm/validateCredentials.test.ts: two expectations gain `noCredit: false`. New describe "item 279…": out-of-credit for OpenAI, Anthropic and OpenRouter; every Test request is 15 s and one attempt, while `listModels` keeps 180 s with no single-attempt flag, for all four. New host test "item 279(a): an out-of-credit Test reports noCredit…".
  - test/unit/ui/preferencesPane.test.ts: the classification table, with 402 and 429 out-of-credit cases; the LLM Test paint test, where Anthropic shows the new line; new "item 279(a) and (d)…" string test.
  - test/unit/i18n/keys.test.ts: new describe for the new id and key-present.
  - test/unit/core/http-client.test.ts: new "singleAttempt (item 279(b))…".
  - test/integration/preferences.spec.ts: `flushedPrefsFile` retries a locked read (FINDINGS 1).

SHARED-FILE EDITS QUOTED (each one small and exact; Prettier was run only as --check, plus one copy-in of Prettier's own output for my two new lines in container.test.ts)
- src/i18n/keys.ts:
  - In MAIN_WINDOW_MESSAGE_IDS, after `"research-helper-prefs-usage-limit-off",`: "// Owner, 2026-10-23, plan/00 §6 item 279(a): an LLM key accepted by an // account with no credit left (QuotaExceededError)." and then `"research-helper-prefs-test-ok-no-credit",`.
  - In KO_PENDING_REVIEW, before P3-T14's block: "// The out-of-credit Test line (owner, 2026-10-23, `plan/00` §6 item // 279(a)); a commented `ko-KR` stub, nothing machine-translated (`G-41`)." and then the id.
  - In FluentMessageArgsMap: `"research-helper-prefs-test-ok-no-credit": { time: string };` with "// Owner, 2026-10-23, plan/00 §6 item 279(a). `$time` as above."
  - In ARGUMENT_MESSAGE_IDS: the group comment became "// mainWindow — the preference pane (5, P3-T14; 1, item 279(a))", and the id was added after test-ok-rate-limited.
- addon/locale/en-US/research-helper-mainWindow.ftl:
  - The key-present comment and value were replaced: "# A stored key with no stored Test result. Test results are stored since P3-T14 # (docs/07 §8.5's lastValidatedAt / lastValidationResult), so "this session" was # dropped (owner, 2026-10-23, plan/00 §6 item 279(d))." followed by `research-helper-prefs-key-present = A key is stored. Not tested yet.`
  - After test-ok-rate-limited: "# The Test was answered "out of credit" (a spend cap: OpenAI's insufficient_quota, # Anthropic's spend limit, OpenRouter's 402): the key itself was accepted (owner, # 2026-10-23, plan/00 §6 item 279(a))." followed by `research-helper-prefs-test-ok-no-credit = Key accepted, but the account has no credit left · checked { $time }`.
  - Written with Node in UTF-8.
- addon/locale/ko-KR/research-helper-mainWindow.ftl: after the test-ok-rate-limited stub: "# NEEDS REVIEW (owner, 2026-10-23, plan/00 §6 item 279(a)). en-US: "Key accepted, but the account has no credit left · checked { $time }"", then "# research-helper-prefs-test-ok-no-credit =", then "#". Nothing was translated.
- test/unit/i18n/keys.test.ts: one appended describe, "src/i18n/keys.ts — the out-of-credit Test line (owner, 2026-10-23, plan/00 §6 item 279(a))", with 2 tests.
- src/pipeline/types.ts, the PipelineContext doc, now reads: "See this file's header for why seven of the member types began as forward aliases rather than imports. *(Updated 2026-10-23: since `P3-T35` five are real — `LLMRouter`, `Cache`, `PrivacyPolicy` and `BudgetGuard` imported, `ConfigReader` declared — and only `TTSProvider` and `ZoteroFacade` remain aliases to `unknown`; nothing in `src/pipeline/` reads `tts` or `zotero`.)*"
- src/bootstrap/container.ts: the edits listed above. The step 6b comment now ends "…and a call without one is refused before anything is sent (owner, 2026-10-23, `plan/00` §6 item 278(a)). The wrapping waits for step 6c, because its prices do (item 278(b))."
- docs/07 and docs/09: below.
- Not touched: src/prefs/schema.ts and its test, docs/06.

DOC NOTES ADDED (quoted)
1. docs/07 §4.3, after the "`BudgetGuard`, as built" note:
   - "**Decided 2026-10-23 (owner, `plan/00` §6 item 278(a) and (b)): the shared router refuses a call with no budget, and prices a reservation as the cost dialog does.** Built after wave 7. Two bullets above are corrected by it."
   - "(a) Fail closed. `withBudget` refuses a `chat` or `chatStream` whose `LLMCallContext` carries no `budget`. It throws `ConfigurationError` (§10.1, `rh-error-configuration`, not retryable) before any request is sent, so a caller that forgets `budget: ctx.budget` spends nothing. The class is `ConfigurationError` because the fault is the caller's wiring, a composition-root bug, which the summarize stages already rethrow as fatal; it is not `BudgetExceededError`, which the job runner reads as `budget-stop` and answers by asking the user to raise a limit. Calls that are not summary work never pass through the router and are unaffected: the pane's key Test calls each adapter's `validateCredentials`, and the model catalogue calls `listModels` / `listCatalogue`. *(Corrects "Where it is enforced" above, which left an unbudgeted call free to pass.)*"
   - "(b) One price source, read as a snapshot. The composition root builds one `ModelPriceSource` (`createModelPriceSource`, `src/llm/shared/modelCatalogue.ts`), the service graph's `modelPrices`, and `withBudget`'s synchronous `pricesFor` reads it for the active provider. It holds the last catalogue snapshot (`createModelCatalogue`: the live lists, priced from OpenRouter's catalogue) with the user price table (`user_price`, §8.3) applied over it the way `createModelCatalogue` applies it. While no catalogue snapshot has loaded it holds `bundledCatalogue()`, the documented table of `03-llm-provider-integration.md` §12.1, with the user table applied over that. It is refreshed asynchronously, and startup sends no catalogue request (`plan/00` §6 item 279(c)): the user table is read from the plugin database once it is open and again after each price the pane saves or removes (no network); the catalogue is adopted each time something fetches it through `modelPrices.refresh` — the pane's model suggestions today. The cost dialog (`P3-T29`) must take its prices from `modelPrices` too, after a `refresh`, so that the dialog and the reservations of the run it confirms read the same snapshot."
   - "(b) Settling. A reservation carries the prices it was priced with. A call whose provider reports no `costUsd` but reports its input and output tokens is charged at those prices × those tokens (`costOf`), not at its reservation; only a call whose tokens are not reported is counted at the reservation's estimate, marked estimated. *(Corrects "Settling" above in effect: each job's guard is built without `prices`, so until this date such a call was charged its reservation, with headroom and the full `maxOutputTokens`.)*"
2. docs/07 §4.3, appended to the "`CredentialCheckResult`, as built" note: "*Decided 2026-10-23 (owner, `plan/00` §6 item 279(a) and (b)):* an out-of-credit answer is `ok: true` with `messageKey` `rh-error-quota`, whatever its status — `QuotaExceededError`: OpenAI's `insufficient_quota` 429, Anthropic's spend-cap 429 and OpenRouter's 402 — and the pane shows it on its own line (`research-helper-prefs-test-ok-no-credit`), not as plain "key accepted". A plain rate-limit 429 (`rh-error-rate-limit`) keeps the accepted line. The stored §8.5 enum is `ok` for both, as before; the separate line is shown at the Test only. Every request of a Test is one attempt of at most 15 seconds, never retried (`LLM_KEY_TEST_ATTEMPT`, §7.3's note of this date); summary calls keep `LLM_ATTEMPT_TIMEOUT_MS` and `LLM_RETRY_BUDGET`. *(Corrects "an HTTP 429 … is `ok: true`" above: OpenRouter's 402 was `ok: false`, and a spend cap showed the accepted line.)*"
3. docs/07 §4.5, appended to P3-T35's first bullet: "*(Corrected 2026-10-23 (owner, `plan/00` §6 item 278): a call without `budget` is now refused with `ConfigurationError` and sends nothing, and a reservation is priced from the graph's `modelPrices` — the live catalogue with the user price table, the documented table only until a catalogue snapshot has loaded. See §4.3's note of that date.)*"
4. docs/07 §7.3, a new note after "LLM hosts' pacing": "**A key Test makes one attempt of 15 seconds. Decided 2026-10-23 (owner; `plan/00` §6 item 279(b)).** Until this date the pane's LLM Test went through the same path as a summary call: a 3-minute attempt and the LLM row's retry budget, so a Test against a rate-limited or failing host could take about 90 s before it reported." It has three bullets:
   - one per-request option on the one client, `HttpOptions.singleAttempt` (what it keeps: pacing, the hook, `penalize`; the 90-second budget has nothing to decide; no second HTTP stack);
   - "The Test's limits are one constant. `LLM_KEY_TEST_ATTEMPT` … `{ timeoutMs: LLM_KEY_TEST_TIMEOUT_MS (15 000), singleAttempt: true }`", which lists every Test request it covers and the calls that keep `llmAttemptTimeouts` and `LLM_RETRY_BUDGET`;
   - "What it bounds. A Test request ends after one answer or 15 s, plus any wait for the host's bucket; a 429 or 5xx is reported at once".
5. docs/09 §2.3, after the five rule bullets: "**Decided 2026-10-23 (owner, `plan/00` §6 item 279(a) and (b)).** (a) An out-of-credit answer has its own line. A Test answered with `QuotaExceededError` (OpenAI's `insufficient_quota` 429, Anthropic's spend-cap 429, OpenRouter's 402 where it applies) still counts as a pass, because the key was accepted, but the pane says "Key accepted, but the account has no credit left" (`research-helper-prefs-test-ok-no-credit`) instead of the plain accepted line. A rate-limit 429 keeps the accepted line (`research-helper-prefs-test-ok-rate-limited`). The stored `<provider>.lastValidationResult` is `ok` for both (`07-architecture-and-data-model.md` §8.5's enum is unchanged), so after the pane is reopened both read as plain "key accepted". (b) A Test makes one attempt with a 15-second limit and no retry (`07-architecture-and-data-model.md` §7.3's note of this date); summary calls keep their own limits and retries."
6. docs/08 §7.3, appended to P3-T14's note: "*Decided 2026-10-23 (owner, `plan/00` §6 items 279(a), (c) and (d)):* (a) a Test answered "out of credit" (`QuotaExceededError`) paints `research-helper-prefs-test-ok-no-credit`, "Key accepted, but the account has no credit left · checked { $time }", instead of the accepted line; a plain rate-limit 429 keeps `research-helper-prefs-test-ok-rate-limited` (`09-security-privacy-and-api-keys.md` §2.3). The line is shown at the Test; the stored result is `ok`, which repaints as the plain accepted line. (c) confirmed: the suggestions are fetched when a list is first opened, never when Settings opens. (d) now that results are stored, a stored key with no stored result reads `research-helper-prefs-key-present`, "A key is stored. Not tested yet." (it read "… Not tested yet this session."). A model list fetched for the suggestions also refreshes the prices the spend guard reserves with (`07-architecture-and-data-model.md` §4.3's note of this date, item 278(b)), and a price saved or removed here reaches the guard at once."

NEW STRINGS (en-US, quoted)
- New: research-helper-prefs-test-ok-no-credit = "Key accepted, but the account has no credit left · checked { $time }". It has a ko-KR commented stub and is on KO_PENDING_REVIEW.
- Changed: research-helper-prefs-key-present = "A key is stored. Not tested yet." (was "A key is stored. Not tested yet this session."). It stays on KO_PENDING_REVIEW, and the ko-KR bundle has no entry or stub for it.

RUNS
- npm run typecheck 0; npm run lint:check 0; npx eslint . 0; npm run test 0 (unit 82 files / 3835 tests; contract 2 / 40). Run once mid-way and again on the final tree, with the same results.
- `npx zotero-plugin build` once (exit 0): only the one typings line described in VERDICT changed. `npm run build` twice (exit 0): all five typings unchanged each time (020956c7…, 8bfe8dd3…, 8c6fe067…, 4480d796…, cf994969…). The build printed the usual ko-KR "missing in locale" warnings.
- Integration: `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`. Before every run, the MUTANT grep was empty (exit 1), and a PowerShell CIM query found no process with `.scaffold\test\profile` on its command line (my own PID excluded). The same query was empty after the last run.

  | Run | Time | Passed | Failed |
  |---|---|---|---|
  | 1 | 21:25:12–21:28:20 | 193 | 1: preferences.spec.ts "P3-T04: each LLM block stores, masks and clears a synthetic key…", `Could not open … prefs.js (NS_ERROR_FILE_IS_LOCKED)` |
  | 2 | 21:28:51–21:31:52 | 194 | 0 |
  | 3 | 21:32:03–21:35:12 | 194 | 0 |
  | 4 (after the spec fix) | 21:36:53–21:40:02 | 194 | 0 |
  | 5 | 21:40:10–21:43:12 | 194 | 0 |
  | 6 | 21:43:19–21:46:30 | 194 | 0 |

  - The preferences pane spec (P1-T44 and P3-T04 tests) passed in runs 2–6, so P3-T14's pane code now initialises and works inside Zotero 10.0.3.
  - l10n.spec logged "ko-KR totals: 100 present, 138 absent; expected 100 / 138".
  - Runs 4–6 printed no "locked on read" line, so the retry was never needed in them.
  - Logs: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\followups\int-run1.log … int-run6.log.
- Mutants:
  - Runner: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\followups\tools\mutants.mjs. Vitest filters were passed as separate arguments. Each mutant was restored by copy and matched its SHA-256 ("restored ok" every time). None touched useTranslators.
  - Killed (22 of 22):
    - M1 `withBudget.chat` lets an unbudgeted call through (the required mutant; killed by the budget, container and router tests);
    - M2 the same in `chatStream`;
    - M3 the refusal thrown as `BudgetExceededError`;
    - M4 settle ignores the reservation's prices;
    - M5 `requestEstimate` drops prices;
    - M6 reserveCall drops prices;
    - M7 the price source ignores user prices;
    - M8 no startup user-table read;
    - M9 no re-read after a save;
    - M10 refresh not adopted;
    - M11 an older refresh adopted over a newer one;
    - M12 the client ignores `singleAttempt`;
    - M13 `LLM_KEY_TEST_ATTEMPT.singleAttempt` false;
    - M14 the OpenAI Test without the Test limits;
    - M15 OpenRouter's Test catalogue fetch without them;
    - M16 Gemini `listModels` using the Test limits;
    - M17 `isKeyAcceptedFailure` ignores `QuotaExceededError`;
    - M18 out-of-credit flagged as rate-limited;
    - M19 `testKey` drops `noCredit`;
    - M20 preferences.js never paints the new line;
    - M21 Anthropic's Test pages without the Test limits;
    - M22 OpenRouter's `/key` request without them.
  - Final `grep -rn MUTANT src test addon typings scripts`: empty.
  - Final hashes (first 12 hex characters of SHA-256): budget.ts 89299726cdb3, modelCatalogue.ts 07b5facfcbf8, container.ts 8efc7e452291, client.ts 365f8177c850, preferencesPane.ts 67d261fea1e8.

CONTRADICTIONS/FINDINGS
1. The integration failure in run 1 came from the spec's file read, not from product code. `flushedPrefsFile` in test/integration/preferences.spec.ts calls `savePrefFile(null)` and then reads prefs.js at once; Windows reported the file locked once in three runs. Runs 2 and 3, before any change, passed.
   - Likely cause, not measured: Zotero's own background save of prefs.js still holds the file. Since P3-T14, every key stored or cleared also writes the two validation preferences, so those background saves happen more often.
   - What I changed: the read now retries up to five times, 200 ms apart, only on `NS_ERROR_FILE_IS_LOCKED`. Any other error, or a lock that outlasts the retries, still fails. A dated comment says so.
   - Not changed: test/integration/zotero/secrets.spec.ts uses the same flush-then-read pattern without a retry.
2. A seam for P3-T29: the cost dialog must price from `graph.modelPrices` after `await graph.modelPrices.refresh(ctx)`. `PipelineContext` carries no price source, so the summarize pipeline has to be handed it. Until something refreshes, reservations use the documented table with the user's prices, and the live catalogue arrives only when the pane's suggestion list is opened.
3. Reservations are priced for `router.activeProvider()` at the moment of the call, as before. A model the snapshot lists without a price (for example, a native model with no OpenRouter slug match) is unpriced even if the documented table had a price for it. This is consistent with the dialog as long as the dialog reads the same source.
4. The out-of-credit and rate-limited lines are not stored, because the docs/07 §8.5 enum has no such value. After reopening Settings, both show "Key accepted". The owner may want a stored value; that would change §8.5.
5. Anthropic's Test may send more than one request (one per list page), each limited to one 15-second attempt. A Test request still waits for the host's pacing bucket before its attempt; that wait is not covered by the 15 seconds.
6. The startup user-table read is not awaited and has no teardown of its own. It is one of the plugin database's tracked calls, which the database's teardown already waits for. Adding a teardown entry broke container.test.ts's teardown-order test, which is why there is none.

WHAT I DID NOT CHECK
- A live key Test against any provider, which is gate G-18. A real `insufficient_quota`, spend-cap or 402 answer has not been seen. The 15-second limit was checked only through the fake client and the transport's `timeout` option.
- A live catalogue refresh inside Zotero changing a reservation's price. It was checked only at unit level with node:sqlite and a fake catalogue. No integration spec opens the suggestion list (by design) or calls `modelPrices`.
- That the price form's save and remove buttons re-read the table inside Zotero. Checked only at unit level, through `reloadingUserPriceStore`.
- That the new pane line renders through Fluent in Zotero. Checked only by unit tests against the en-US bundle text and fake elements; the integration suite exercises no Test that answers "out of credit".
- Korean: none written. The coordinator should draft the ko-KR text for the two strings above.

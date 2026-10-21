Adapter follow-up for plan/00 §6 items 260 and 262 (report for plan/reports/adapter-followup-260-262.md)

VERDICT

All four tasks are done. Every required check exits 0.
- Item 260: the four LLM hosts now have HOST_POLICIES rows. Each paces at 1 request per second, burst 1, at most 3 in flight, and carries retry: LLM_RETRY_BUDGET (the object itself). In the product, an LLM request now gets the five-attempt retry budget and pacing, where before it got one attempt and no pacing.
- Item 262(a): ChatRequest has an effort member. There is one shared Effort type in src/llm/types.ts, and each adapter maps effort onto its provider's own field. When effort is absent, nothing is sent.
- Item 262(b): the four provider display names exist under one id scheme, research-helper-provider-<id>. They carry the same English in both locales and are listed on KO_PRESENT.
- Item 262(c): OpenRouter's guardrail 404 is now a new user-facing class, PrivacyRoutingError, a subclass of BadRequestError. It has its own message id, rh-error-privacy-routing.

The documents moved first: docs/07 §7.3, §4.3, §10.1 and §10.2, the four adapter cards, and the P3-T25 card. No live provider call was made, no API key was used, and nothing was committed.

The integration suite passed in full on the third of three runs (187 passed). The first two runs each failed one test, the same one: P0-T20's batch-import test counted 2 database transactions during its second timed write and expected 1. That test's code path has nothing to do with these changes; see Runs.

FILES CHANGED, WITH DECLARATION NAMES

Documents
- docs/07-architecture-and-data-model.md
  - §7.3, the LLM/TTS row, corrected in place and marked "Corrected 2026-10-21, plan/00 §6 item 260":
    - Rate cell: "from provider prefs" → "1/s (LLM)".
    - Max concurrent cell: "= `llm` pool size" → "3 (LLM)".
    - Basis cell: rewritten.
  - §7.3, new dated note: "LLM hosts' pacing. Decided 2026-10-21 (owner; plan/00 §6 item 260)".
  - §4.3: `export type Effort` and `ChatRequest.effort?` added to the code block, plus the dated note "`ChatRequest.effort` and the shared `Effort` type. Decided 2026-10-21 (owner; plan/00 §6 item 262(a))", which includes a per-provider mapping table.
  - §10.1: class PrivacyRoutingError added to the code block, plus the dated note "`PrivacyRoutingError`, OpenRouter's guardrail 404. Decided 2026-10-21 (owner; plan/00 §6 item 262(c))".
  - §10.2: one new row in the condition table, for PrivacyRoutingError.
- plan/04-phase-3-llm-summaries.md
  - P3-T07: the "Open — recommended" block under step 7 is replaced by a "Decided 2026-10-21" block.
  - P3-T08 step 8, P3-T09 step 7 and P3-T10 step 7: "(same open line as P3-T07)" is replaced by a "Decided 2026-10-21" block on each card.
  - P3-T10's other open line, about detecting Gemini's paid tier, is untouched.
  - P3-T25 Notes: a dated note saying summaries pass effort: "low" (item 262(a)).

Source code
- src/core/rateLimit/hostLimiter.ts
  - New LLM_HOSTS: a frozen Record<ProviderId, string> of the four hosts.
  - LLM_RETRY_BUDGET moved above HOST_POLICIES. The table reads it while the module loads, so the old order would have thrown a ReferenceError (temporal dead zone).
  - Four rows added to HOST_POLICIES, and the header paragraph about LLM hosts updated.
  - New type-only import of ProviderId from model/.
- src/core/errors.ts
  - New PrivacyRoutingError (extends BadRequestError): code "PRIVACY_ROUTING", messageKey "rh-error-privacy-routing", userFacing true.
  - BadRequestError.userFacing is now annotated `: boolean`. Without it the literal type false makes the subclass's true a TS2416 compile error. No runtime value changes.
- src/llm/types.ts: new `Effort`; `ChatRequest.effort?: Effort`.
- src/llm/shared/effort.ts (new): FiveLevelEffort, toFiveLevelEffort. This is docs/03 §14.2's mapEffortToFiveLevel, shared by OpenAI, Anthropic and OpenRouter.
- src/llm/openai/mapper.ts
  - Removed the local Effort, OpenAiEffort and toOpenAiEffort, and the effort member of ResponsesBodyOptions.
  - buildResponsesBody reads request.effort.
  - ResponsesRequestBody.reasoning is now typed FiveLevelEffort.
- src/llm/openai/openAiProvider.ts: OPENAI_DISPLAY_NAME_KEY renamed from "research-helper-llm-provider-openai" to "research-helper-provider-openai"; comment updated.
- src/llm/gemini/mapper.ts: removed the local Effort (now imported from ../types). buildInteractionBody sends generation_config.thinking_level through mapEffortToThinkingLevel.
- src/llm/anthropic/mapper.ts
  - AnthropicMessagesBody.output_config now has optional format and optional effort.
  - toMessagesBody merges effort into output_config.
  - toCountTokensBody is unchanged: no effort is sent to the exact token counter.
- src/llm/openrouter/mapper.ts
  - OpenRouterChatBody.reasoning added; toOpenRouterBody sends reasoning.effort.
  - openRouterGuardrailError now returns PrivacyRoutingError.
  - The module header has a new section on reasoning.effort.
- src/llm/anthropic/anthropicProvider.ts, src/llm/gemini/geminiProvider.ts, src/llm/openrouter/openRouterProvider.ts: comments only, on the display-name constants. openRouterProvider.ts also had a stale "row is not added" comment corrected.

Localization
- src/i18n/keys.ts
  - MAIN_WINDOW_MESSAGE_IDS: the 4 provider ids, after the source names; rh-error-privacy-routing, after rh-error-structured-output.
  - ERROR_MESSAGE_IDS: rh-error-privacy-routing.
  - KO_PENDING_REVIEW: rh-error-privacy-routing.
  - KO_PRESENT: the 4 provider ids.
  - FluentMessageArgsMap: "rh-error-privacy-routing": { model: string }.
  - ARGUMENT_MESSAGE_IDS: rh-error-privacy-routing.
- addon/locale/en-US/research-helper-mainWindow.ftl: a new provider-names section, and rh-error-privacy-routing with a comment.
- addon/locale/ko-KR/research-helper-mainWindow.ftl: the provider names verbatim; a header bullet listing them as untranslated; a commented NEEDS REVIEW stub for rh-error-privacy-routing.
- typings/i10n.d.ts: regenerated by `npx zotero-plugin build` with no Zotero running. It gained the 4 provider ids and rh-error-privacy-routing.

Tests
- test/unit/core/hostLimiter.test.ts, test/unit/core/backoff.test.ts, test/unit/core/tokenBucket.test.ts, test/unit/bootstrap/container.test.ts
- test/unit/core/errors.test.ts, test/unit/i18n/keys.test.ts, test/integration/l10n.spec.ts (PrivacyRoutingError added to everyErrorInstance and its import)
- test/unit/llm/openai.test.ts, gemini.test.ts, anthropic.test.ts, openrouter.test.ts

Not changed: src/bootstrap/registerProviders.ts, src/bootstrap/container.ts, plan/00-task-index.md.

THE FOUR ROWS AS SHIPPED (HOST_POLICIES, after the pmc.ncbi.nlm.nih.gov row)

  { host: LLM_HOSTS.openrouter, withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 }, retry: LLM_RETRY_BUDGET },
  { host: LLM_HOSTS.openai,     withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 }, retry: LLM_RETRY_BUDGET },
  { host: LLM_HOSTS.anthropic,  withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 }, retry: LLM_RETRY_BUDGET },
  { host: LLM_HOSTS.gemini,     withoutKey: { ratePerSecond: 1, burst: 1, maxConcurrent: 3 }, retry: LLM_RETRY_BUDGET },

LLM_HOSTS = { openrouter: "openrouter.ai", openai: "api.openai.com", anthropic: "api.anthropic.com", gemini: "generativelanguage.googleapis.com" }.

Why the hosts are written out: core/ may not import llm/, so the hosts cannot be derived from the adapters. A test asserts that each host equals `new URL(DEFAULT_BASE_URLS[id]).host`, equals the resolver's effectiveHost, and equals the adapter's own constant (ANTHROPIC_HOST, GEMINI_HOST, OPENAI_RATE_LIMIT_KEY, and OpenRouter's rateLimitKey read off a constructed adapter).

Why there is no withKey: the row type allows withKey and keyPresencePref, but every chat request needs a key, so there is no keyless mode to tell apart. This follows the literature rows that have no key mode.

EFFORT MAPPING PER PROVIDER (absent effort → nothing sent, provider default applies)

- OpenAI: reasoning.effort. none and minimal become low; low, medium, high, xhigh and max pass through unchanged. Source: docs/03 §2.3, §2.5, §14.2.
- Gemini: generation_config.thinking_level. none and minimal become minimal; low stays low; medium stays medium; high, xhigh and max become high. Source: docs/03 §4.3, §14.2.
  - The legacy generateContent fallback sends no effort, because docs/03 §4.5 documents no thinking field for it.
- Anthropic: output_config.effort. Same fold as OpenAI: none and minimal become low; the other five pass through. Source: docs/03 §3.6, §14.2.
  - With a schema, the effort sits beside output_config.format.
  - On the strict-tool fallback, output_config holds only the effort.
  - No `thinking` field is sent; §14.2's sketch sends none.
  - Nothing is sent to POST /v1/messages/count_tokens; §10.1 documents no effort there.
- OpenRouter: reasoning.effort, with the same fold to the five levels low … max. See Contradiction 1 for why it is folded.

NEW MESSAGE IDS AND THE GUARDRAIL ENGLISH TEXT

Provider names (both locales, identical, on KO_PRESENT):
- research-helper-provider-openrouter = OpenRouter
- research-helper-provider-openai = OpenAI
- research-helper-provider-anthropic = Anthropic
- research-helper-provider-gemini = Google Gemini

The names follow docs/08 §7.3's provider menu labels, which is why Gemini's is "Google Gemini". They are in MAIN_WINDOW_MESSAGE_IDS, next to the source names, which is where the precedent puts them.

Guardrail message: rh-error-privacy-routing. It takes the argument $model. It is on ERROR_MESSAGE_IDS, MAIN_WINDOW_MESSAGE_IDS, ARGUMENT_MESSAGE_IDS and KO_PENDING_REVIEW, with a commented ko-KR stub. The English, for the coordinator to draft Korean from:

"OpenRouter has no provider for { $model } that meets your privacy mode. Choose a different model, or change the privacy mode from Strict to Balanced if it is set to Strict. Balanced allows providers that keep your text for a time and sends PDF full text, but still refuses providers that may train on your data."

On scope: the second remedy is conditioned on Strict, and the last sentence says Balanced still refuses providers that may train on the data. That is because data_collection: "deny" is sent in every mode, so leaving Strict drops only zdr. The consequence sentence follows docs/09 §3.5's table: Balanced drops zero retention and allows PDF full text.

The mechanism: the 404 is still a BadRequestError, so nothing that already handles a 4xx changes. Only code, messageKey and userFacing differ. The developer message and the context fields cause, remedies and restrictions are unchanged. The thrower puts modelId in the context.

TESTS BY NAME (3171 → 3189 unit tests; 18 new, plus updates)

New tests:
- hostLimiter.test.ts, describe "the four LLM hosts' HOST_POLICIES rows (owner, 2026-10-21, item 260)":
  - "ships one row per LLM host with docs/07 §7.3's LLM/TTS rate, burst and max concurrent cells" (parses the document's cells)
  - "takes each host from the provider's documented base URL, and agrees with each adapter's rateLimitKey"
  - "gives each LLM host a bucket of its own that admits one request, then the next after one second"
- openai.test.ts:
  - "sends ChatRequest.effort as reasoning.effort on the wire, and no reasoning when it is absent (item 262)"
- gemini.test.ts:
  - "sends ChatRequest.effort as generation_config.thinking_level on the wire, and none when it is absent (item 262)"
  - "sends no effort on the legacy generateContent fallback: docs/03 §4.5 documents no thinking field"
- anthropic.test.ts, describe "ChatRequest.effort as output_config.effort (docs/03 §3.6, item 262)":
  - "folds none and minimal to low, passes the other five through, and adds nothing without an effort"
  - "sends it on the wire, beside output_config.format under a schema and beside the strict tool"
  - "sends no effort to the exact counter: docs/03 §10.1 documents none"
- openrouter.test.ts:
  - "sends ChatRequest.effort as reasoning.effort, folded to the five-level scale, and no reasoning without one (item 262)"
- errors.test.ts:
  - a HIERARCHY row for PrivacyRoutingError (3 parameterized cases)
  - "makes PrivacyRoutingError a BadRequestError that is user-facing, and leaves BadRequestError log-only"
- keys.test.ts:
  - "gives every registered adapter the one id scheme research-helper-provider-<id>"
  - "declares all four on the main-window surface and on KO_PRESENT, never pending review"
  - "ships PrivacyRoutingError's messageKey as an error id that takes an argument"
  - "waits on KO_PENDING_REVIEW for the coordinator's Korean, never on KO_PRESENT"

Updated tests:
- backoff.test.ts: the synthetic-row test, which duplicated the now-shipped api.anthropic.com row and threw "duplicate rate-limit policy", is rewritten as "reads the shipped api.anthropic.com row, which carries LLM_RETRY_BUDGET, against the shared row". The (LLM)-marker test now uses the shipped row. Green.
- tokenBucket.test.ts: "carries docs/07 §7.3's NCBI row exactly, and serves every shipped row and no other" now includes the 4 LLM hosts.
- container.test.ts:
  - "installs the PrefStore, the limiter registry and the HTTP client" now includes the 4 hosts, and checks each has a limiter.
  - "retries a 503 to each row's own attempt cap…" had a hard-coded 3 attempts and [1, 2]. It now expects 5 attempts for a row carrying LLM_RETRY_BUDGET and 3 otherwise, with maxAttempts − 1 retry lines.
- openai.test.ts: "maps an Effort of minimal (and none) to low…" now uses toFiveLevelEffort and request.effort.
- gemini.test.ts: "maps all seven levels onto Gemini's four…" now also checks the built body.
- openrouter.test.ts:
  - "maps the synthetic guardrail 404 onto a user-facing PrivacyRoutingError naming the cause and both remedies" (renamed; asserts class, userFacing, messageKey, code, modelId).
  - "keys the guardrail off status and error.code, never the sentence" and "treats a 404 for a model the fetched catalogue does not list as an ordinary not-found" now assert the non-guardrail 404 is not a PrivacyRoutingError.
- l10n.spec.ts: everyErrorInstance includes PrivacyRoutingError.

RUNS (final tree; one run each unless stated)

- npm run typecheck: exit 0.
- npm run lint:check: exit 0 ("All matched files use Prettier code style!").
- npx eslint .: exit 0.
- npm run test: exit 0. Unit: 64 files, 3189 tests. Contract: 2 files, 40 tests.
- npm run build: exit 0. It printed the existing ko-KR "missing" warnings for pending ids.
- npx zotero-plugin build: run once, before the above, to regenerate typings. It is required first because npm run build runs tsc before the generator.
- Full integration suite, `npm run test:integration -- --exit-on-finish`, three runs:
  - Run 1: 186 passed, 1 failed (exit 1).
  - Run 2: 186 passed, 1 failed (exit 1).
  - Run 3: 187 passed (exit 0).
- The failure in runs 1 and 2 was the same test both times: test/integration/zotero/batchImport.spec.ts, "writes 100 journalArticles into one collection in one transaction within NFR-1", with "exactly one DB transaction began during the write: expected 2 to equal 1".
  - Both times it happened on that spec's second of its three internal timed writes.
  - Zotero.DB.addCallback("begin") counts every transaction anywhere in the process during a ~400 ms window, which makes the test sensitive to background activity.
  - In run 3 all three writes counted 1.
  - Nothing in this change touches the database. I could not run the pre-change tree to compare, because there was no git baseline.
- l10n.spec passed in all three runs, including "gives every messageKey src/core/errors.ts can throw a message, or defers it explicitly".
- No Zotero process was running before any run (checked by process list); none was left behind and none was killed.

MUTANTS (scratchpad runner mutants.mjs)

Procedure: one mutant live at a time, marked /* MUTANT id */. Each ran only its named vitest files, then the original was copied back from a backup and the restore checked by SHA-256. All 22 were killed:

| Mutant | File | Change | Result |
|---|---|---|---|
| M1 | hostLimiter.ts | OpenRouter rate 2/s | killed (2 failed) |
| M2 | hostLimiter.ts | Anthropic row gets a copy of LLM_RETRY_BUDGET, not the object | killed (5) |
| M3 | hostLimiter.ts | Gemini max concurrent 8 | killed (2) |
| M4 | hostLimiter.ts | OpenAI row dropped | killed (4) |
| M5 | hostLimiter.ts | Gemini host misspelt | killed (1) |
| M6 | hostLimiter.ts | OpenAI row gains a withKey | killed (1) |
| M7 | shared/effort.ts | none and minimal fold to medium | killed (5) |
| M8 | openai/mapper.ts | reasoning dropped | killed (2) |
| M9 | openai/mapper.ts | effort forwarded unmapped | killed (2) |
| M10 | gemini/mapper.ts | thinking_level dropped | killed (2) |
| M11 | gemini/mapper.ts | effort forwarded unmapped | killed (2) |
| M12 | anthropic/mapper.ts | effort sent at top level | killed (2) |
| M13 | anthropic/mapper.ts | effort replaces format | killed (1) |
| M14 | anthropic/mapper.ts | effort sent to count_tokens | killed (1) |
| M15 | openrouter/mapper.ts | effort forwarded unmapped | killed (1) |
| M16 | openrouter/mapper.ts | reasoning sent with no effort | killed (3) |
| M17 | errors.ts | PrivacyRoutingError not user-facing | killed (2) |
| M18 | openrouter/mapper.ts | guardrail returns a plain BadRequestError | killed (2) |
| M19 | errors.ts | messageKey rh-error-bad-request | killed (4) |
| M20 | keys.ts | guardrail id dropped from KO_PENDING_REVIEW | killed (2) |
| M21 | keys.ts | a provider name dropped from KO_PRESENT | killed (2) |
| M22 | openAiProvider.ts | display key back to the old id | killed (2) |

Final hashes (all matched the pre-mutant hashes):
- hostLimiter.ts 4566855d…4f17
- effort.ts d308b8df…5516
- openai/mapper.ts 435848ea…c4c7
- gemini/mapper.ts 18440f2c…9b63
- anthropic/mapper.ts 01f32be8…2b55
- openrouter/mapper.ts 4725f807…af6a
- errors.ts 9f0689ba…a77d
- keys.ts 3c449647…4f4b
- openAiProvider.ts 43ae01bc…26c2

Final check: `grep -rn MUTANT src test addon typings scripts` is empty (exit 1). No mutant touched useTranslators.

CONTRADICTIONS

1. OpenRouter's effort mapping: docs/03 contradicts itself.
   - §14.2's OpenRouter sketch sends `reasoning: { effort: req.effort }` unmapped.
   - §14.3 says to map through a function in every adapter and never pass the string through blind.
   - I sent the field the sketch names, folded by §14.3's rule onto the five levels that §9.4's catalogue example lists as supported_efforts (low … max).
   - Per-model supported_efforts is not read: the catalogue parser does not keep it. So a model whose route accepts other levels, for example a Gemini model through OpenRouter, still gets the five-level fold.
   - The docs/07 §4.3 note records this choice. docs/03 was not edited.
2. Anthropic: docs/03 documents output_config.effort only for current models.
   - The strict-tool fallback exists for models that lack structured outputs. It still sends output_config.effort when effort is set.
   - Whether such older models accept that field is not documented.
3. The prefix of the new message id.
   - The ERROR_MESSAGE_PREFIX comment in keys.ts says nothing new may use rh-error-.
   - But docs/07 §10.1's hierarchy, test/unit/core/errors.test.ts ("gives every messageKey the rh-error- prefix") and l10n.spec all require every error class's messageKey to start with rh-error-.
   - I followed the enforced rule, rh-error-privacy-routing, and recorded the reason in docs/07 §10.1's note.
4. Max concurrent is fixed at 3, not the live preference.
   - The owner's decision says "at most 3 concurrent (the concurrency default)", so the rows are fixed at 3.
   - The old cell said "= `llm` pool size", which is the live preference (1–8). I corrected that cell too and said so in the note.
   - A user with concurrency above 3 gets more llm workers, but at most 3 requests in flight to any one host.
5. P3-T07 step 6 and its Done-when line still say "BadRequestError".
   - That remains true, because PrivacyRoutingError is a subclass. The card text was not changed beyond step 7.
6. Two docs claims that are now stale are partly fixed.
   - The gemini.test.ts and openRouterProvider.ts comments saying no row ships are corrected.
   - registerProviders.ts's "No adapter is registered yet" header and container.ts step 6b's "No adapter yet" (plan/00 item 261(h)) were left alone, as outside scope.

WHAT I DID NOT CHECK

- No live provider call. I did not check whether any provider accepts the effort values as sent:
  - OpenRouter's reasoning.effort on non-OpenAI models;
  - Anthropic's output_config.effort beside a strict tool;
  - Gemini thinking_level on the Interactions API.
- How a surface renders PrivacyRoutingError with $model. No surface formats LLM errors yet. The args map entry is typed, but no caller passes it.
- Whether 1/s, burst 1 suits real provider limits. That was the owner's decision; no provider-side limit was measured.
- A base-URL override's host still has no row (one attempt, no pacing). This is recorded in docs/07 §7.3's note, but not otherwise addressed.
- `npm run index:derive` was not run. No card ID, Depends, Estimate or Human-gate rows changed, and plan/00 is the coordinator's file.
- The P0-T20 transaction-count failure in integration runs 1 and 2 was not traced to its source. I could not compare against the pre-change tree.
- The Korean text for rh-error-privacy-routing. It is left to the coordinator and owner (G-41); nothing was machine-translated.

Nothing was committed.

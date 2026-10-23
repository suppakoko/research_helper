Follow-ups to wave 5: items 268(c), 268(d), 269(b)+(c) and the item-268 cleanups

VERDICT
All four tasks are done. Documents were edited before code, and each decision carries a dated note.
- Checks: typecheck, lint:check, `npx eslint .` and `npm run test` all exit 0. Unit: 76 files, 3541 tests passed. Contract: 2 files, 40 tests passed.
- Mutants: 17 mutants run, all 17 killed; each restored by copy and checked by SHA-256. The final `grep -rn MUTANT src test addon typings scripts` is empty (exit 1).
- Not run, as instructed: Zotero, `npm run build`, the integration suite.
- Not touched: any card's State line, any estimate, plan/00. Nothing was committed. No API key, live request or live LLM call was used.
- One choice for the owner to confirm: the single place for the Gemini rule is `assertModelAllowed`, through a new optional `route` parameter (reasons under Findings 1).

FILES CHANGED WITH DECLARATION NAMES
- src/core/rateLimit/hostLimiter.ts: new `LLM_STREAM_IDLE_TIMEOUT_MS` (180_000), `LLM_STREAM_TOTAL_TIMEOUT_MS` (900_000) and `llmAttemptTimeouts(streamed)`, all beside `LLM_ATTEMPT_TIMEOUT_MS`, whose doc comment now says it is for a plain request.
- src/core/http/client.ts:
  - New `HttpOptions.idleTimeoutMs`, and `"idle-timeout"` added to `HttpErrorSource`.
  - New private class `IdleExpired`.
  - Header item 6 gains a paragraph on the two time limits.
  - `createHttpClient().request` refuses `idleTimeoutMs` with a RangeError when there is no `onBodyText`, or when the value is not a finite number above 0.
  - `issue()` gains a `clock` parameter, and the canceller is now wired whenever an idle limit is set. A progress event that grows the body restarts the idle count. A watch loop (`clock.sleep` on a token from `createCancellationTokenSource`) rejects a race promise first and only then aborts through the raw `cancellerReceiver`. The request is `Promise.race([sent, expiry])`, so the attempt ends on time even if the transport ignores the abort. An `IdleExpired` becomes `TimeoutError(idleTimeoutMs)` through `toHierarchy`, and the watch is stopped in `finally`.
  - No timeout is ever set to 0. The 15-minute limit is the request's `timeoutMs`, which reaches Zotero as the XHR `timeout`.
- src/llm/openai/openAiProvider.ts, src/llm/anthropic/anthropicProvider.ts, src/llm/gemini/geminiProvider.ts, src/llm/openrouter/openRouterProvider.ts: each `send` now spreads `...llmAttemptTimeouts(onBodyText !== undefined)` where it passed `timeoutMs: LLM_ATTEMPT_TIMEOUT_MS`. The import and one header line changed in each.
- src/llm/openai/mapper.ts: `toModelInfos` writes `supportsStreaming: true` for "not known", with an updated doc comment.
- test/helpers/mockLLM.ts: `mockModel` now defaults to `supportsStreaming: true`, with a doc comment.
- src/prefs/keys.ts: new `PREF_KEYS.geminiPaidTier` = "gemini.paidTier".
- src/prefs/schema.ts: new row `geminiPaidTier` (boolean, default false). `secretBackend.values` is now `["oskeystore","session",""]`, with a dated correction. One header sentence added.
- src/pipeline/shared/privacyPolicy.ts:
  - New `ModelRoute` and `modelRouteFor(providerId, readGeminiPaidTier = () => getPref("geminiPaidTier"))`, which reads the preference only for Gemini, on every call.
  - `assertModelAllowed(model, mode, route?)`:
    - Gemini in strict mode is refused on every tier.
    - Gemini declared paid counts as `"no"` in balanced and full.
    - Without a route the rule is unchanged, so it still fails closed for a free or unknown Gemini key.
  - The Gemini refusal's error context gains `providerId` and `geminiPaidTier`.
  - The `PrivacyPolicy.assertModelAllowed` signature now takes the route; the header has a dated note.
- src/pipeline/shared/egressDisclosure.ts:
  - `EgressNoticeId` adds the reminder id.
  - New member `EgressDisclosure.geminiDeclaredPaidReminder`.
  - New dependency `EgressDisclosureDeps.geminiPaidTier`. The default reads the preference, only for Gemini, on every build.
  - `buildEgressDisclosure`: when the key is declared paid, the reminder replaces the free-tier warning, and the two never appear together.
  - `ConfirmationReason` adds "gemini-declared-paid". `mustAskConfirmation` pushes that reason, so "don't ask again" cannot suppress the reminder.
  - The header and doc comments are updated.
- Tests:
  - test/unit/core/http-client.test.ts: new describe "a stream's two time limits (plan/00 §6 item 268(c))", 10 tests, using a manual clock and a hand-driven stream:
    - idle expiry gives TimeoutError carrying the idle limit, and the request is aborted;
    - growth restarts the count;
    - nothing is read after expiry;
    - a host that sends nothing at all is cut, even when the transport ignores the abort;
    - a CancelledException or a status-0 answer to the client's own abort is still TimeoutError;
    - a stream lasting 10 minutes completes and its idle watch stops;
    - an idle expiry is not retried;
    - an expiry of the total limit is TimeoutError carrying 900000 and is not retried;
    - a user cancel stays OperationCancelledError and stops the watch;
    - the RangeError cases;
    - a plain request starts no watch.
  - test/unit/core/hostLimiter.test.ts: a test pinning the two constants and `llmAttemptTimeouts`.
  - test/unit/llm/sse.test.ts: the plain request's XHR timeout is 180000, the stream's is 900000, and the stream asks for `idleTimeoutMs` 180000, for all four adapters (through a recording client).
  - test/unit/llm/router.test.ts: the pass-through test now asserts the provider's own two-chunk stream. New test: "chatStream falls back to chat for a model whose catalogue says supportsStreaming: false, though the provider streams".
  - test/unit/llm/openai.test.ts: expects `supportsStreaming: true`.
  - test/unit/prefs/schema.test.ts: the `passphrase` copies are removed; the `geminiPaidTier` row is added; 63→64 in the title and both counts; `NO_PREF_LINE` gains "gemini.paidTier" and goes 25→26. Two new tests: a stored "passphrase" reads as ""; `gemini.paidTier` coercion.
  - test/unit/pipeline/privacyPolicy.test.ts: new section 10, 15 tests: the Gemini route rules, `modelRouteFor`, the disclosure reminder, the reminder forcing the question, the en-US string matching docs/09 verbatim, and the ko-KR stub.
  - test/unit/i18n/keys.test.ts: see the next section.
- typings/i10n.d.ts (generated): one line inserted by hand, in sorted order: `| 'research-helper-egress-gemini-declared-paid'`. New hash 90dee648…014e. The other typings are unchanged.

SHARED-FILE EDITS QUOTED (each file re-read immediately before its edit; small exact-string edits only)
- src/llm/openrouter/openRouterProvider.ts:
  - Import `LLM_ATTEMPT_TIMEOUT_MS` → `llmAttemptTimeouts`.
  - In `send`, `timeoutMs: LLM_ATTEMPT_TIMEOUT_MS,` → `...llmAttemptTimeouts(onBodyText !== undefined),`.
  - Header bullet now reads "- `timeoutMs: LLM_ATTEMPT_TIMEOUT_MS` (3 minutes, item 240), or for a stream 15 minutes in all and 3 without new text (`llmAttemptTimeouts`, item 268(c));".
- src/i18n/keys.ts:
  - In `MAIN_WINDOW_MESSAGE_IDS`, after "research-helper-egress-gemini-free-tier": the comment "// The reminder that replaces the Gemini warning for a key declared paid (owner, 2026-10-22, plan/00 §6 item 269(b)). See L10N_EGRESS_GEMINI_DECLARED_PAID." and then "research-helper-egress-gemini-declared-paid".
  - New constant `L10N_EGRESS_GEMINI_DECLARED_PAID`, after `L10N_EGRESS_GEMINI_FREE_TIER`.
  - In `KO_PENDING_REVIEW`, after "research-helper-prefs-test-unavailable": a G-41 comment and then the id.
- test/unit/i18n/keys.test.ts: `ID_CONSTANTS` gains `L10N_EGRESS_GEMINI_DECLARED_PAID`. New describe "src/i18n/keys.ts — the Gemini declared-paid reminder (plan/00 §6 item 269(b))" with 2 tests: the id is on the main-window surface, takes no argument and is outside the error ids; it is on KO_PENDING_REVIEW and not on KO_PRESENT.
- en-US research-helper-mainWindow.ftl: after the free-tier entry, a 4-line "#" comment and then the new entry (text under NEW STRINGS).
- ko-KR research-helper-mainWindow.ftl: after the free-tier entry, "# NEEDS REVIEW. en-US: "…"" with the source text, a G-41 comment, and "# research-helper-egress-gemini-declared-paid =". Nothing was translated.
- docs/07 and docs/09: see the next section.

DOC NOTES ADDED (quoted)
1. docs/07 §4.3, after the streaming contract's (g):
   - Lead and correction: "**Decided 2026-10-22 (owner, plan/00 §6 item 268(c)): a stream's two time limits.** *(This corrects (f)'s "timeout … unchanged".)*"
   - Limits: "A plain request keeps `LLM_ATTEMPT_TIMEOUT_MS` (3 minutes) for the whole request. A streamed request has two limits instead: **3 minutes without new text** (`LLM_STREAM_IDLE_TIMEOUT_MS`, 180 000 ms) and **15 minutes in all** (`LLM_STREAM_TOTAL_TIMEOUT_MS`, 900 000 ms)."
   - Rest, summarized: both constants sit beside `LLM_ATTEMPT_TIMEOUT_MS`, and the adapters take all three through `llmAttemptTimeouts`. The note explains P3-T11 finding 4 and states that no second HTTP stack exists. The 15-minute limit is the XHR `timeout`. The 3-minute idle limit is `HttpOptions.idleTimeoutMs`, accepted only together with `onBodyText`; it is counted on the injected clock from the moment the attempt is handed to the transport and restarted each time the body grows. When it runs out, the request is aborted through `cancellerReceiver`.
   - Verbatim: "**No timeout is ever set to zero or lifted from the progress handler**". Either expiry is `TimeoutError`, and neither is retried.
2. docs/07 §4.3:
   - Lead: "**Decided 2026-10-22 (owner, plan/00 §6 item 268(d)): "not known" streams.**"
   - Rule: "an adapter that cannot tell whether a model streams writes `true`, the value (a) treats as streamable. It never writes `false`, which (a) reads as "cannot stream"."
   - The note also records OpenAI's old encoding and P3-T11 finding 1, and says `supportsJsonSchema` is not touched.
3. docs/07 §7.3's "One LLM attempt may wait up to 3 minutes" bullet: "*(Updated 2026-10-22, owner, plan/00 §6 item 268(c): this limit is for a plain request. A **streamed** request has two limits instead: 3 minutes without new text (`LLM_STREAM_IDLE_TIMEOUT_MS`) and 15 minutes in all (`LLM_STREAM_TOTAL_TIMEOUT_MS`), both beside it in `hostLimiter.ts`. See §4.3's note "a stream's two time limits".)*"
4. docs/07 §4.5:
   - The `PrivacyPolicy` block's `assertModelAllowed` gains `route?: ModelRoute`, and a new interface `ModelRoute { providerId; geminiPaidTier? }` is declared.
   - New note: "**Decided 2026-10-22 (owner, plan/00 §6 item 269(b)): a Gemini key the user declares paid.** The Gemini rules live in **one place**: `assertModelAllowed`, through its third parameter `ModelRoute`." The note then says:
     - strict refuses Gemini on every tier (the free tier trains on input; the paid tier keeps content 55 days for abuse monitoring);
     - balanced and full read the policy as `"no"` when `geminiPaidTier` is true;
     - full allows a declared-paid key with no warning and no confirmation;
     - `modelRouteFor` reads the preference on demand;
     - a check without a route reads `dataPolicy` alone and still fails closed for a free or unknown key;
     - the callers (P3-T16, P3-T29) pass the route.
5. docs/07 §8.5: new row `gemini.paidTier` | boolean | `false`. It is marked "**Decided 2026-10-22 (owner, `plan/00` §6 item 269(b)).**" and gives:
   - the meaning (the user's statement that the key is on Google's paid tier, which the plugin cannot read);
   - read on demand, never cached;
   - the effect in each mode;
   - "The setting is a declaration, not evidence";
   - the checkbox is P3-T04's;
   - no `pref()` line, like `privacy.egressAcknowledged`.
6. docs/09 §3.5:
   - The row "Gemini free tier | **Refused** | Warned every session | Warned once" became "Gemini (any tier) | **Refused** | **Refused**, unless the key is declared paid (`gemini.paidTier`…); then allowed | Allowed. A free or unknown key is warned and needs confirmation… Every job shows the free-tier warning, or the declared-paid reminder instead (§3.6 item 3)".
   - Added note: "> **Corrected 2026-10-22 (owner, `plan/00` §6 item 269(b)–(c)).** The Gemini row read … and it could not be built as written." It quotes the old row, explains why, and lists the three decisions.
7. docs/09 §3.6 item 3: "*Extended 2026-10-22 (owner, `plan/00` §6 item 269(b)):* **When the user has declared the key paid** (`gemini.paidTier`…), the warning above is replaced, on every job, by a one-line reminder: *"<reminder text>"* The reminder is never removed while the declaration stands, and, like the warning, it has no suppression path: it forces the confirmation that item 2's checkbox would otherwise skip. Turning the declaration off brings the free-tier warning back."
8. docs/09 §1.4: "> *Corrected 2026-10-22 (`plan/00` §6 item 268, recorded from `P3-T03`):* the sentence above is not what v1 does. Gate `G-10` was decided on 2026-10-08 … **tier 3, the passphrase-encrypted file, does not ship in v1** … No passphrase layer is offered, so no `secretBackend` value names one …"
9. docs/11 §5: the "Still open: …" text is struck through and followed by "**Decided 2026-10-08 (gate `G-10`): session-only (tier 2) is the only fallback; the passphrase-encrypted file (tier 3) does not ship in v1.** `P3-T03` built it. Still owed: detecting Gecko's `NSSKeyStore` substitute (`P3-T37`). *(Corrected 2026-10-22, `plan/00` §6 item 268: this cell still read "Still open" after the gate was decided.)*"
10. plan/06 G-10, after the "Two corrections…" paragraph: "*Corrected 2026-10-22 (`plan/00` §6 item 268, recorded from `P3-T03`):* the paragraph above describes the card as it was written on 2026-09-30, not what was built. After this gate was decided on 2026-10-08 (tier 2 only), `P3-T03` built **tier 2 alone** … No passphrase tier exists, and `secretBackend` has no `passphrase` value …"
11. docs/03 §6.5, under the heading: "> **Corrected 2026-10-22 (`plan/00` §6 item 268, recorded from `P3-T11`).** The next sentence is wrong. Spike `V-8` (`P0-T16`, measured 2026-09-30; … §8.4.1) showed that `Zotero.HTTP.request()` **can** stream … `P3-T11` built streaming on exactly that path, as `HttpOptions.onBodyText` … No `fetch()` path and no second HTTP stack exist …"
12. docs/03 §11.6's "One LLM attempt may wait up to 3 minutes" bullet: "*(Updated 2026-10-22, owner, `plan/00` §6 item 268(c): that limit is for a plain request. A **streamed** request (§6) has two limits instead: **3 minutes without new text** … and **15 minutes in all** … enforced by `src/core/http/client.ts`'s streaming mode, with no timeout ever set to zero. …)*"

NEW STRINGS (en-US; the ko-KR file holds a commented stub, and the id is on KO_PENDING_REVIEW)
- research-helper-egress-gemini-declared-paid: "This Google API key is marked as a paid key in Research Helper's settings. If it is actually on the free tier, Google may use the content you send to improve its products."
  - It is identical to the text in docs/09 §3.6 item 3's extension, and a test checks that.

RUNS
- `npm run typecheck`: exit 0.
- `npm run lint:check`: exit 0. ESLint passed, and Prettier reported "All matched files use Prettier code style!". An earlier run flagged one line wrap in egressDisclosure.ts; I fixed it by hand, without `--write`.
- `npx eslint .`: exit 0.
- `npm run test`: unit 76 files / 3541 passed; contract 2 files / 40 passed.
- Mutants (runner in the scratchpad at followup268/mutants.mjs). Each was live only for its own vitest run, then restored by copy, and every restore printed "restored=ok". All 17 were killed:

  | Mutant | Change | Tests failed |
  |---|---|---|
  | M1 | a growing body does not restart the idle count | 2 |
  | M2 | `IdleExpired` is not mapped to TimeoutError | 5 |
  | M3 | no race | 5 |
  | M4 | the abort is sent before the race is rejected | 4 |
  | M5 | an idle limit of 0 is accepted | 1 |
  | M6 | the stream's total limit falls back to 3 minutes | 5 |
  | M7 | OpenAI streams with the plain request's limits | 1 |
  | M8 | the OpenAI mapper writes `false` again | 1 |
  | M9 | `mockModel` defaults to `false` again | 1 |
  | M10 | strict mode lets a declared-paid Gemini key through | 2 |
  | M11 | the declaration applies to any provider | 1 |
  | M12 | `modelRouteFor` reads the preference for every provider | 1 |
  | M13 | the reminder does not force the question | 1 |
  | M14 | the warning and the reminder appear together | 3 |
  | M15 | `passphrase` is back in the value set | 2 |
  | M16 | the idle watch is not stopped | 2 |
  | M17 | the injected `geminiPaidTier` reader is ignored | 3 |

  The first sweep had one survivor: the old M4 (a status-0 branch after an idle expiry). The analysis showed that branch, and the `CancelledException` clause beside it, could never be reached, because the race's rejection is always queued before the abort. I removed both and rewrote M4 as above.
- `grep -rn MUTANT src test addon typings scripts`: empty.

CONTRADICTIONS/FINDINGS
1. Why the Gemini rule lives in `assertModelAllowed` and not in P3-T10's mapper. Strict mode must refuse Gemini even when it counts as "no", and the mapper cannot know the mode, so a mapper-only change could not satisfy strict. `assertModelAllowed` holds both rules, keeps docs/07's statement that it reads `dataPolicy`, and fails closed without a route. The cost: the mapper's `dataPolicy`, and so the model picker, still shows a declared-paid key as "trains on input". P3-T04 may want to show the declaration there.
2. Strict mode and retention. The owner refuses Gemini paid in strict mode because of 55-day abuse-monitoring retention. OpenAI and Anthropic direct also keep content 30 days for abuse monitoring, and strict mode allows them, because their policy is "no". This is reported, not changed.
3. A check without a route and a proven-paid tier would pass strict mode. The tier detector never answers "paid" today, so this cannot happen now. P3-T16 and P3-T29 must pass `modelRouteFor(providerId)`; docs/07 §4.5 says so.
4. My readings, for the owner to confirm:
   - The reminder forces the confirmation question, because the owner asked for "no suppression path".
   - When the key is declared paid, the reminder is shown even if the detector says "paid".
   - `gemini.paidTier` has no `pref()` line, following `privacy.egressAcknowledged`. docs/07 §8.5 says to add a preference "then to prefs.js", but that also needs docs/01 §7.2.
5. addon/prefs.js still has a comment above `pref("secretBackend", "")` listing "passphrase" twice. The file was outside my scope, so it is reported, not fixed.
6. The idle expiry and the total expiry are told apart only by `TimeoutError.timeoutMs` (180000 against 900000). `toHierarchy` drops the `HttpError` cause, so the new `"idle-timeout"` source is not visible in a debug bundle.
7. typings/i10n.d.ts was edited by hand (one line). The P3-T15 agent's build should regenerate the same line. Its run of test/integration/l10n.spec.ts should confirm that the ko-KR gap now includes the new pending id.

WHAT I DID NOT CHECK
- Anything inside Zotero:
  - that an abort through `cancellerReceiver` during a streaming XHR behaves as the fakes assume (the race makes the result independent of how the transport answers);
  - that the XHR `timeout` still bounds a 15-minute streamed body (this rests on the XHR specification, not on a measurement).
- The build, the integration suite, and the l10n spec.
- Any live stream or provider call; no Gemini paid-tier signal.
- The Korean text: none was written; that is gate G-41.
- No UI was built: the checkbox is P3-T04's.

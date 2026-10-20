# Phase 3 — LLM layer, key storage, and per-paper summaries

> **What this file is.** The task-card decomposition of
> [`docs/11-implementation-roadmap.md`](../docs/11-implementation-roadmap.md) §1 "Phase 3".
> The card schema, the field rules and the execution protocol are
> [`README.md`](README.md) §4–§5 and are binding on every card below.
>
> **Last updated:** 2026-10-20 · **Status:** every card revised against the tree on 2026-10-20
> (owner decision, `plan/00-task-index.md` §6 item 234; the review is
> `plan/reports/phase3-plan-review.md`). No Phase 3 card has been executed; every task is `TODO`.
> Parts of `P3-T01`, `P3-T02`, `P3-T04`, `P3-T05` and `P3-T06` were built in Phases 1–2 under other
> cards and are listed as landed in §0.1. Lines beginning `> **Open — recommended:**` are owner
> decisions still open; the owner reviews all of them in one pass.

---

## 0. Phase summary

**Goal (docs/11).** A provider-agnostic LLM client with cost control, plus per-item summary
notes.

**Why this phase is different.** Phases 0–2 spend nothing and send nothing but query terms to
public bibliographic APIs. Phase 3 is the first phase that **spends the user's money** and the
first that **sends the user's material off the machine**. Two consequences run through every
card in this file:

1. **Secrets before adapters.** No provider adapter may read a key from anywhere but the
   `SecretStore` port (`src/core/secretStore.ts`). Decision **D5** (`docs/00-overview.md` §3)
   forbids a key in a preference, and `docs/09-security-privacy-and-api-keys.md` §1.7 refuses a
   plaintext tier even as a fallback.
2. **No spend without a number.** The cost estimator and the confirmation gate are a
   precondition for the first real run (`docs/06` §5.4, R-4), not polish.

**What Phase 3 has from Phases 0–2 (checked against the tree on 2026-10-20).** A building,
installable plugin with: the `HttpClient` in `src/core/http/client.ts` over
`createZoteroHttpTransport` (`src/zotero/zoteroApi.ts`); the full `docs/07` §10.1 error hierarchy,
including the LLM subtree, in `src/core/errors.ts`; the one redactor (`redact`, `redactUrl`,
`omitSecretFields`, eight `KEY_PATTERNS`) in the same file; `withRetry` and `REQUEST_BUDGET_MS` in
`src/core/http/retry.ts`; the per-host limiter registry (`HOST_POLICIES` in
`src/core/rateLimit/hostLimiter.ts`, literature hosts only); the plugin database with one migration
(`MIGRATIONS` in `src/bootstrap/migrations.ts`, `search_provenance` only); the tier-1 secret store
(`src/zotero/keychain.ts`); the preferences pane for the NCBI and Semantic Scholar keys; seven
literature sources, deduplication and import.

**What Phase 3 does not have, and which this file now cards.** There is **no `Cache` layer**
(`src/core/cache/` holds only `.gitkeep`; `P3-T33`), **no job queue, job record or checkpoint**
(`P3-T34`), and **only 13 preference rows** (`PREFS` in `src/prefs/schema.ts`; `P3-T32` adds the
rows this phase reads). `createPipelineContextFactory` in `src/bootstrap/container.ts` sets `cache`,
`budget`, `llm`, `config` and `privacy` to `undefined` and makes `checkpoint()` a no-op, and the
matching types in `src/pipeline/types.ts` are placeholder aliases to `unknown` (`P3-T35` wires them).

**Deliverables (docs/11 §1 Phase 3, scope).** Provider abstraction with four adapters (FR-29);
preferences pane with keys, the per-provider base-URL override, per-task model selection, budget
ceilings and language (FR-29, FR-30, FR-32, FR-52); the `SecretStore` fallback tier and every
key-entry surface (FR-30, NFR-16, D5) — **tier 2 (session-only) only: gate `G-10` was decided on
2026-10-08 and tier 3 (passphrase file) does not ship in v1**; "Test connection" (FR-31); token and
cost estimation with an "as of" date (FR-24, NFR-5); consent and egress disclosure (FR-36); job
engine with bounded concurrency, backoff with jitter, cancellation and resume-by-skipping (FR-23,
FR-34, NFR-6); the summarizer with the R-19 extraction quality gate, prompts from `docs/12`,
structured-output parsing and child-note writing (FR-19–FR-22); IMRaD section-detector validation
against the 40-PDF fixture set (R-19b); "Remove generated notes from collection" (FR-20); usage
accounting (FR-35); and the deterministic LLM mocking harness (`docs/13` §2.2). (`docs/11` still
promises tier 3; the open line on `P3-T03` covers the documents.)

**Risks retired.** R-4, R-5, R-6 (partly), **R-9** (retired by design under D5), **R-19** (quality
gate + cost preview), **R-19b** (detector validated, or `auto` degraded to whole-document chunking).

**Effort.** **27.5 developer-days over 37 cards** (§3), so the published band is
**27.5–39 d** (27.5 × 1.4 = 38.5, rounded up to the whole day as Phase 2's 27.50 → 39 was on
2026-10-07). The previous figure was 23.5–33 d over 31 cards. Propagated on 2026-10-20 to the five
places in `plan/README.md` §7, and `npm run index:derive` was run
(`plan/reports/bookkeeping-2026-10-20.md`).

### Phase definition of done

Taken from `docs/11` §1 Phase 3 "Definition of done":

- [ ] All four providers produce a summary for the same item using the same internal code
      path; only the adapter differs.
- [ ] A 100-abstract job completes within the NFR-4 budget and reports actual token usage.
- [ ] Setting a $0.01 ceiling pauses the job on the first item and asks for confirmation.
      *(Decided 2026-10-20 by the owner: a ceiling pauses and asks; `docs/06` §5.4 changes to
      match — `P3-T16`.)*
- [ ] Cancelling at item 87/200 retains 86 notes and resumes correctly (FR-23). *(See the open
      line on `P3-T31`: notes are opt-in.)*
- [ ] No key appears in the debug log, in a note, or in copied diagnostics (NFR-16). *(See the
      open line on `P3-T31`: the debug bundle is Phase 7.)*

And two that `docs/11` states as deliverables but which gate the phase as hard:

- [ ] The IMRaD detector has been measured against the 40-PDF fixture set and either passes
      the ≥ 85 % threshold (`docs/06` §4.3) or `summary.fullTextMode: auto` has been degraded
      to whole-document flat chunking with section provenance suppressed in the prompt.
- [ ] Every phase-3 test passes with **zero** live network calls and **zero** spend
      (`docs/13` §4).

### 0.1 Already landed — cite these by name, do not rebuild them

| What | Where (by name) | Landed by |
|---|---|---|
| Redaction: `KEYISH_FIELD`, `KEY_PATTERNS` (eight, including the NCBI hexadecimal shape), `redact`, `redactUrl`, `omitSecretFields` | `src/core/errors.ts` | `P1-T02`, `P1-T42` |
| Logger redacts every message and context value | `redactContext` in `src/core/logger.ts` | `P1-T02` |
| HTTP client logs only `redactUrl(url)` and never a header object | `logExchange` in `src/core/http/client.ts` | `P1-T05` |
| Free-text gate for persisted records | `redactText`, `redactSearchProvenance` in `src/core/provenance.ts` | Phases 1–2 (`P2-T35` exported `redactText`) |
| Every `docs/07` §10.1 error class, including `LLMError`, `ContextLengthExceededError`, `ContentFilterError`, `StructuredOutputError`, `QuotaExceededError`, `BudgetExceededError`, `PolicyViolationError` | `src/core/errors.ts` | `P1-T02` |
| `withRetry`, `isRetriedAutomatically` (excludes `TimeoutError`, owner item 230), `REQUEST_BUDGET_MS` (90 s total per request, owner item 233), `retryPolicyFromBudget` | `src/core/http/retry.ts` | `P1-T05`, items 228–233 |
| Decorrelated jitter and the one `Retry-After` parser | `decorrelatedJitter`, `parseRetryAfter` in `src/core/rateLimit/backoff.ts` | `P1-T04`, `P1-T26` |
| Per-host retry policies, wired | `createRetryFor` in `src/bootstrap/container.ts` | item 228 |
| `ProviderId` union | `src/model/ids.ts` | `P1-T01` |
| `Zotero` global confined to `src/zotero/` and `addon/` | `research-helper/zotero-global` in `eslint.config.js` | Phase 0 |
| `SecretStore` port, `SECRET_IDS`, `SecretId`, `SecretBackend` | `src/core/secretStore.ts` (re-exported by `src/zotero/keychain.ts`) | `P1-T06` |
| Tier-1 store for every `SecretId`: `setSecret`, `getSecret`, `hasSecret`, `clearSecret`, `listStoredIds`, `probeKeystore`, `probeAndRecordBackend`, `createKeychainSecretStore`; `KEY_PRESENCE_PREFS` (two rows: NCBI, Semantic Scholar) | `src/zotero/keychain.ts`; called from `installSecretStore` in `src/bootstrap/container.ts` | `P1-T06`, `P1-T41`, item 169 |
| Preferences pane: NCBI and Semantic Scholar key fields, masked digest (`keyDigest`), backend badge with an `indeterminate` state (`backendBadge`), residual-risk text (`research-helper-prefs-risk-1`…`-5`), remove-all (`clearAllKeys`), NCBI and S2 Test (`ncbiTestRequest`, `classifyNcbiResponse`, `semanticScholarTestRequest`, `classifySemanticScholarResponse`) | `src/ui/prefs/preferencesPane.ts`, `addon/content/preferences.xhtml`, `addon/content/preferences.js`, published by `publishPreferencesHost` in `src/bootstrap/registerUI.ts` | `P1-T44` |
| `D5: no credential can reach a preference` test block | `test/unit/prefs/schema.test.ts` | `P1-T06` |
| SSE frame parser | `createSseParser`, `parseSse` in `src/llm/shared/sse.ts` (imported by `scripts/spike-network.ts`) | `P0-T16` |
| Full-text readers, no importers yet | `getAttachmentText`, `getIndexedState`, `getIndexedPageCounts`, `getFullTextAllPages` in `src/zotero/fulltext.ts` | `P0-T19` |

### 0.2 Conventions binding on every card in this file

1. **Strings.** A card that adds a user-visible string adds: the `en-US` entry in the bundle; the
   id in `src/i18n/keys.ts` (`MAIN_WINDOW_MESSAGE_IDS` or `SEARCH_DIALOG_MESSAGE_IDS`, plus
   `ARGUMENT_MESSAGE_IDS` and `FluentMessageArgsMap` for a message with arguments); a **commented**
   `ko-KR` stub carrying the English source; and the id on `KO_PENDING_REVIEW`. The coordinator
   drafts the Korean and the owner reviews it (gate `G-41`). **Never machine-translate.** The pane's
   strings live in `research-helper-mainWindow.ftl` (owner item 51); there is no
   `research-helper-preferences.ftl`. Run `test/integration/l10n.spec.ts` after any bundle edit
   (`plan/README.md` §6). Tests to keep green: `test/unit/i18n/keys.test.ts`,
   `test/integration/l10n.spec.ts`.
2. **Preference rows.** Only `P3-T32` adds rows to `PREFS` (`src/prefs/schema.ts`), `PREF_KEYS`
   (`src/prefs/keys.ts`) and `addon/prefs.js`, and updates `test/unit/prefs/schema.test.ts`. Every
   other card reads through `getPref`/`setPref` in `src/prefs/index.ts`. A card that finds it needs
   a row `P3-T32` did not add stops and says so.
3. **Tests.** Unit tests are `test/unit/**/*.test.ts` (`npm run test:unit -- <filter>`); contract
   tests are `test/contract/**/*.contract.test.ts` (`npm run test:contract`); integration tests are
   `test/integration/**/*.spec.ts`. The integration runner has no name filter, so every card runs
   the whole suite: `npm run test:integration -- --exit-on-finish --abort-on-fail`. The suite is
   load-sensitive: repeat a failing run three times before calling it a regression.
4. **Migrations.** A new table is a new entry appended to `MIGRATIONS` in
   `src/bootstrap/migrations.ts` with the next free `version`, never an edit to a shipped one. Two
   tests pin the current version and must move with it: `test/unit/core/provenanceRerun.test.ts`
   and `test/integration/zotero/provenanceStore.spec.ts`.
5. **One redaction gate.** Every new persisted record (`StoredSummary` JSON, job `input_json` and
   `error_json`, the egress log, `CredentialCheckResult`) passes through the gate `P3-T36` builds,
   modelled on `redactSearchProvenance`. No card adds a pattern or a second redaction rule; the
   patterns are `KEY_PATTERNS` in `src/core/errors.ts`.
6. **No live requests.** Tests replay fixtures. A live call happens only behind a human gate with a
   stated spend, and a live check in an integration spec is opt-in behind `RH_DOD_LIVE`
   (`plan/00` §6 item 53).
7. **Keys.** An agent never types, reads, prints or holds an API key. Entering keys is gate
   `G-18`, the owner's step; an agent that reaches it stops and reports which provider needs one.
8. **Layering.** `src/ui/**` may not import `llm/` or `zotero/` (`research-helper/layering/ui`);
   pane code reaches the store, the catalogue and `validateCredentials()` through
   `PreferencesHostApi`, published by `publishPreferencesHost` in `src/bootstrap/registerUI.ts`
   and driven by `addon/content/preferences.js`. `core/` imports only `model/`. Registrations go
   through `src/zotero/registrations.ts`.
9. **Callers (`plan/README.md` §5 rule 10).** Every card names the file that constructs or calls
   what it builds. The composition root is `installServices` in `src/bootstrap/container.ts`.
10. **Open lines.** A step that depends on an unresolved `Open — recommended` line is not executed
    on the recommendation: the agent stops at that step and asks. Steps that do not depend on it
    proceed.

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P3-T01` | `Secret` wrapper, `loggableHeaders`, `debug: true` lint | 0.25 | none |
| `P3-T02` | Tier-1 store: LLM presence flags and `clearAll` | 0.5 | none |
| `P3-T03` | Session-only fallback tier and the degradation dialog | 0.5 | none |
| `P3-T04` | Prefs pane: LLM provider blocks, model, base URL | 1.0 | **Yes** |
| `P3-T05` | LLM error mapping and the LLM retry policy | 0.5 | none |
| `P3-T06` | `LLMProvider` contract, registry, router, mock harness | 1.0 | none |
| `P3-T07` | OpenRouter adapter (the default provider) | 1.0 | none |
| `P3-T08` | OpenAI adapter (Responses API) | 0.5 | none |
| `P3-T09` | Anthropic adapter (Messages API) | 0.5 | none |
| `P3-T10` | Gemini adapter (Interactions API) | 0.75 | none |
| `P3-T11` | SSE streaming across the four adapters | 0.75 | none |
| `P3-T12` | Structured output, validation, and the repair path | 0.75 | none |
| `P3-T13` | Model catalogue, pricing table, token calibration | 0.5 | none |
| `P3-T14` | `validateCredentials()` and the Test-key button | 0.75 | **Yes** |
| `P3-T15` | Privacy modes, egress disclosure, Gemini free-tier warning | 1.0 | none |
| `P3-T16` | Cost estimate, confirmation gate, `BudgetGuard`, usage | 1.25 | **Yes** |
| `P3-T17` | `llm` worker pool: concurrency, cancel, pause, resume | 0.75 | none |
| `P3-T18` | Text acquisition tiers 1–2 (abstract, attachment text) | 0.5 | none |
| `P3-T19` | Tiers 3–4, cleaning pass, OCR probe, language detection | 0.75 | none |
| `P3-T20` | The 40-PDF IMRaD fixture set with ground-truth labels | 1.75 | **Yes** |
| `P3-T21` | IMRaD section detector | 0.5 | none |
| `P3-T22` | Detector accuracy harness, 85 % gate, degrade switch | 0.5 | **Yes** |
| `P3-T23` | Chunker: section-aware, flat, and single-shot paths | 0.75 | none |
| `P3-T24` | Prompt registry with versioned prompt files | 0.5 | none |
| `P3-T25` | Per-paper summarizer, DR-1, and the grounding check | 1.25 | none |
| `P3-T26` | Summary cache keyed per `docs/06` §11.2 | 0.5 | none |
| `P3-T27` | Screening: retractions, non-English, duplicates, relevance | 1.0 | none |
| `P3-T28` | Item-pane AI summary section | 0.75 | none |
| `P3-T29` | Summarize-collection pipeline, notes, remove-notes command | 1.25 | none |
| `P3-T30` | LLM fixtures and contract tests | 0.75 | **Yes** |
| `P3-T31` | Phase-3 acceptance run against the definition of done | 0.75 | **Yes** |
| `P3-T32` | Preference rows Phase 3 reads (`docs/07` §8.5) | 0.75 | none |
| `P3-T33` | Cache layer: interface, SQLite store, keys, migration | 1.0 | none |
| `P3-T34` | Job record, `job` table, queue and checkpoint | 1.0 | none |
| `P3-T35` | Wire the pipeline-context members | 0.5 | none |
| `P3-T36` | One redaction gate for new persisted records | 0.25 | none |
| `P3-T37` | Detect a keyring-less Linux backend (gate `G-09`) | 0.25 | **Yes** |
| | **Total** | **27.5** | 8 gates |

**Entry points** (no `Depends on`): `P3-T01`, `P3-T05`, `P3-T24`, `P3-T32`, `P3-T36`. The owner
chose `P3-T01` and `P3-T24` (without its old step 7) to start first; `P3-T32` is the next natural
start because most cards read its rows.

---

## 2. Task cards

### P3-T01 — `Secret` wrapper, `loggableHeaders`, `debug: true` lint

| Field | Value |
|---|---|
| **ID** | `P3-T01` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` |
| **Retires** | part of `R-9` |
| **Implements** | `NFR-16`, part of `FR-30`, part of `FR-54` |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** The three pieces of `docs/09` §2.1 that are not yet in the tree exist: a `Secret` type
that is awkward to stringify, a header summary that cannot carry a key, and a lint rule that
forbids `debug: true` on `Zotero.HTTP.request`.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §2.1 — the `Secret` block (file header
  `src/prefs/secrets.ts`), level 3's `loggableHeaders()`, and the `debug: true` paragraph
- `src/core/errors.ts` header, "Why the redaction primitives live in this file" — why there is
  exactly one redactor and why `core/` cannot import `src/prefs/`

**Already landed (§0.1), not part of this card:** `redact`, `redactUrl`, `KEY_PATTERNS` (eight
patterns), `KEYISH_FIELD`, the logger's redaction (`redactContext`), and the client logging only
`redactUrl(url)`.

**Files.**
- create `src/prefs/secrets.ts` (the `Secret` class; first callers are the adapters' header
  builders in `P3-T07`–`P3-T10`)
- modify `src/core/errors.ts` (add `loggableHeaders` beside `omitSecretFields`)
- modify `src/core/http/client.ts` (only if it logs any header: through `loggableHeaders`)
- modify `eslint.config.js`
- create `test/unit/prefs/secrets.test.ts`
- modify `test/unit/core/errors.test.ts`

**Do.**
1. Create `Secret` in `src/prefs/secrets.ts` exactly as `docs/09` §2.1 declares it: private
   `#value`, one `expose()` reader, and `toString` / `toJSON` / `Symbol.toStringTag` / the node
   inspect symbol returning `[Secret]`.
2. Add `loggableHeaders(h)` to `src/core/errors.ts` as §2.1 prints it: a `KEYISH_FIELD` header name
   becomes `[redacted:<length>]`, every other value goes through the existing `redact()`.
3. If `src/core/http/client.ts` logs any header, route it through `loggableHeaders`; if it logs
   none (as `logExchange` does today), add nothing and say so in the report.
4. Append one selector to the **existing** `no-restricted-syntax` array of the
   `research-helper/scoped-registration` block in `eslint.config.js`, rejecting a `debug: true`
   property in an object literal passed to `Zotero.HTTP.request`. Do not add a second config
   block.

**Do NOT.**
- Do **not** create a second redactor, a `redaction.ts`, or a copy of the pattern list. The one
  redactor is `redact` / `KEY_PATTERNS` in `src/core/errors.ts`; `loggableHeaders` calls it.
- Do **not** add a second `no-restricted-syntax` block. Under flat-config precedence a later block
  for the same files replaces the earlier array, which would silently drop the
  `research-helper/scoped-registration` selectors. (Unverified by running it; append, and verify
  both rules fire.)
- Do **not** give `Secret` a getter, a spread-friendly shape or a `valueOf` — `expose()` is the
  only leak path and must stay greppable.
- Do **not** add a preference, flag or log level that disables redaction (`docs/09` §2.1).

**Done when.**
- [ ] `JSON.stringify({ k: new Secret("sk-ant-" + "x".repeat(30)) })` contains `"[Secret]"` and
      no key material; `` `${secret}` `` yields `[Secret]`.
- [ ] `loggableHeaders({ Authorization: "Bearer " + "x".repeat(40), Accept: "application/json" })`
      returns `[redacted:<n>]` for `Authorization` and `application/json` unchanged.
- [ ] `KEY_PATTERNS` still has exactly eight entries and no new pattern exists anywhere in `src/`
      (asserted in `test/unit/core/errors.test.ts`).
- [ ] ESLint reports the new error, whose message names `debug: true`, on
      `Zotero.HTTP.request("POST", u, { debug: true })` in a file under `src/zotero/`, and still
      reports the existing `menuRegistration` error on `Zotero.MenuManager.registerMenu(x)`.
- [ ] `npm run typecheck` and `npm run lint:check` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- secrets errors
printf 'Zotero.HTTP.request("POST", u, { debug: true });\n' | npx eslint --stdin --stdin-filename src/zotero/probe.ts | grep -q "debug: true"
printf 'Zotero.MenuManager.registerMenu(x);\n' | npx eslint --stdin --stdin-filename src/zotero/probe.ts | grep -q "menuRegistration"
```
(`src/zotero/` is used because it is exempt from the `Zotero`-global rule, so the only errors on
those lines are the two being checked.)

**Notes.** Deferred, with a pointer: the ring buffer and debug bundle that `docs/09` §2.2 redacts
at write time are Phase 7 (`docs/11` §1 Phase 7, "Copy diagnostics" and the debug bundle;
`src/core/logger.ts` header). This card builds nothing for them. The `scoped-registration` block
ignores `src/zotero/registrations.ts` and `scripts/probe-types.ts`, so the new selector does not
apply in those two files; neither calls `Zotero.HTTP.request`.

---

### P3-T02 — Tier-1 store: LLM presence flags and `clearAll`

| Field | Value |
|---|---|
| **ID** | `P3-T02` |
| **State** | `TODO` |
| **Depends on** | `P1-T41`, `P3-T32` |
| **Blocks** | `P3-T03`, `P3-T04`, `P3-T37` |
| **Retires** | most of `R-9` |
| **Implements** | `FR-30` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The tier-1 store that Phase 1 shipped covers the four LLM credentials too: their
presence flags are maintained and reconciled at startup, and `uninstall()` clears every stored key.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §1.7 — the `SecretStore` interface
- `docs/09-security-privacy-and-api-keys.md` §2.5 — `uninstall()` (not `shutdown()`) clears every
  `SecretId`
- `docs/07-architecture-and-data-model.md` §8.5 "Non-secret key-presence flags" — six flags for
  seven ids (`tts.gemini` shares `gemini.keyPresent`)

**Already landed (§0.1):** the three types and the port; `setSecret`, `getSecret`, `hasSecret`,
`clearSecret`, `listStoredIds` for every `SecretId`; `probeKeystore` and `probeAndRecordBackend`
(round trip, `secretBackend` pref write); `refreshKeyPresence` as the only writer of a
`*.keyPresent` flag; `backendBadge` with its `indeterminate` state; the D5 schema test. The old
step 6 test file `test/unit/prefs/secretSchema.spec.ts` is dropped: its assertions live in
`test/unit/prefs/schema.test.ts` (`plan/00` §6 item 32). The backend detection that waits on gate
`G-09` (the old steps 3 and 5) moved to `P3-T37`, so that neither this card nor the pane after it is
held by that gate.

**Files.**
- modify `src/zotero/keychain.ts` (`KEY_PRESENCE_PREFS`, `clearAll`)
- modify `src/core/secretStore.ts` (add `clearAll` to the port; the header's "No `clearAll()`" note
  names this card)
- modify `src/bootstrap/container.ts` (`installSecretStore`: reconcile every flag, not only
  `refreshKeyPresence(NCBI_SECRET_ID)`)
- modify `addon/bootstrap.js` (`uninstall`)
- modify `test/integration/zotero/keychain.spec.ts`
- modify `test/unit/bootstrap/container.test.ts` (a guess: `installSecretStore` is not exported, so
  the integration spec may have to carry the reconciliation test — verify yourself)

**Do.**
1. Add the LLM rows to `KEY_PRESENCE_PREFS`: `llm.openrouter`, `llm.openai`, `llm.gemini`,
   `llm.anthropic`, and `tts.gemini` mapped to the same flag as `llm.gemini`. The schema rows come
   from `P3-T32`.
2. Make `installSecretStore` reconcile every id in `KEY_PRESENCE_PREFS` at startup through
   `refreshKeyPresence`, not only NCBI.
3. Add `clearAll(): Promise<number>` to the `SecretStore` port and to `createKeychainSecretStore`,
   clearing every id `listStoredIds` returns, and call it from `uninstall()` in
   `addon/bootstrap.js`. Leave `shutdown()` untouched. Verify yourself whether `uninstall()` can
   still reach the bundled keychain code after shutdown; if it cannot, stop and report.

**Do NOT.**
- Do **not** write a key, encrypted or not, to `Zotero.Prefs` or to the plugin database (D5;
  `docs/09` §1.6).
- Do **not** re-declare the port, the `SecretId` union or a second keychain module.
- Do **not** call a `Services.logins` member directly; go through `searchOwnLogins()` and
  `removeLogin()` in `src/zotero/keychain.ts`, which feature-detect the platform (`docs/09` §1.2).
- Do **not** clear secrets from `shutdown()` — it runs on every app close (`docs/09` §2.5).
- Do **not** call `SecretStore.get()` to populate a UI field (`docs/09` §1.9 rule 2).

**Done when.**
- [ ] An in-Zotero test stores a synthetic `sk-`-shaped value under `llm.openrouter`, reads it back,
      clears it, and `openrouter.keyPresent` follows (`true`, then `false`).
- [ ] With a synthetic value stored and `openrouter.keyPresent` forced `false`, a fresh
      `installSecretStore` sets it back to `true`.
- [ ] `clearAll()` over three stored ids resolves to `3` and `listStoredIds()` is then empty.
- [ ] `uninstall()` calls `clearAll()`; `shutdown()` does not (asserted on `addon/bootstrap.js`).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- container && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** The test values are synthetic strings built in the test, never a real key.

---

### P3-T03 — Session-only fallback tier and the degradation dialog

| Field | Value |
|---|---|
| **ID** | `P3-T03` |
| **State** | `TODO` |
| **Depends on** | `P3-T02` |
| **Blocks** | `P3-T04`, `P3-T37` |
| **Retires** | remainder of `R-9` |
| **Implements** | `FR-30` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** When the OS keystore is unavailable the plugin offers session-only storage — keys held
in memory and written nowhere — through a dialog, never silently, and there is no code path that
writes a key in plaintext.

**Read first.**
- `plan/06-human-gates.md` `G-10` — **decided 2026-10-08: tier 2 (session-only) only; tier 3
  (passphrase file) does not ship in v1**
- `docs/09-security-privacy-and-api-keys.md` §1.7 — tier 2 and the tier-4 refusal (read the
  tier-3 text only to know what not to build)
- `docs/09-security-privacy-and-api-keys.md` §1.4 — why `unattended: false` has behavioural
  consequences
- `docs/07-architecture-and-data-model.md` §7.5 — `paused` with reason `credential-required`

**Files.**
- modify `src/zotero/keychain.ts` (a session-only `SecretStore` implementation beside
  `createKeychainSecretStore`)
- modify `src/bootstrap/container.ts` (`installSecretStore`: on a failed probe, open the dialog
  and install the chosen store)
- create `src/ui/dialogs/secretBackendDialog.ts`
- create `addon/content/secretBackend.xhtml`
- create `addon/content/secretBackend.js` (the window script)
- modify `src/bootstrap/registerUI.ts` (the dialog opener; `ui/` cannot reach `zotero/`)
- modify `src/i18n/keys.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/zotero/sessionStore.test.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. Implement the tier-2 store: a module-scoped map cleared on `shutdown()`, `backend` = the
   session value, `unattended: false`.
2. On a failed startup probe, show `secretBackendDialog` offering session-only storage with its
   stated cost (keys re-entered each launch; background work stops until they are), or running
   without LLM features. Never select a tier silently.
3. Persist the choice in the `secretBackend` pref and let `backendBadge` render it warning-coloured.
4. Expose `unattended: false` so the summarize pipeline (`P3-T29`) can pause a job with reason
   `credential-required` when a key is absent; this card builds no job logic.
5. Add a unit test asserting that no function exported from `src/zotero/` writes a `SecretId`
   value through the `PrefStore` port.
6. Strings per §0.2 item 1.

> **Open — recommended:** write `G-10`'s outcome (tier 2 only, no passphrase file) into the
> documents that still promise tier 3. Changes `docs/11` §1 Phase 3 deliverable, `docs/09` §1.7 and
> §8 items 1–2, and the open note under D5 in `docs/00` §3. (Review §4 item 3.)

> **Open — recommended:** settle the `secretBackend` value set as `oskeystore` | `session` | `""`,
> dropping `passphrase` because tier 3 does not ship, and resolve the "CONFLICT" note in favour of
> `docs/07`'s spellings, with `secretBackendPrefValue` mapping the port's `SecretBackend` onto them.
> Changes `docs/07` §8.5 (the `secretBackend` row) and `docs/09` §1.7, §1.9. (Review §4 item 2.)

**Do NOT.**
- Do **not** build a passphrase tier, `keychainPassphrase.ts`, a `secrets.enc` file or any
  key-derivation code. `G-10` decided against it; one word from the owner reverses that, nothing
  else does.
- Do **not** implement a tier 4. `docs/09` §1.7: no code path writes an API key to a preference.
- Do **not** fall back from tier 1 to tier 2 without the dialog (`docs/09` §1.7).
- Do **not** obfuscate with a machine-derived or build-embedded key (`docs/09` §1.4).

**Done when.**
- [ ] With the probe stubbed to fail, the dialog is shown and no store is installed until a choice
      is made.
- [ ] The session store round-trips a synthetic value, and after a simulated `shutdown()` `has()`
      returns false.
- [ ] `secretBackend` reads the session value after the choice and `backendBadge` reports a
      warning state for it.
- [ ] A test fails if any `src/zotero/` export writes a `SecretId` value through `PrefStore`.
- [ ] `npm run typecheck` exits 0; `test/integration/l10n.spec.ts` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "sessionStore|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `G-09` still owes the measurement that the probe *fails cleanly and says so* on a
machine without a keystore; this card is testable with a stubbed failure and does not wait for it.

---

### P3-T04 — Prefs pane: LLM provider blocks, model, base URL

| Field | Value |
|---|---|
| **ID** | `P3-T04` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T03`, `P3-T32` |
| **Blocks** | `P3-T14` |
| **Retires** | part of `R-9` |
| **Implements** | `FR-30`, `FR-52`, part of `FR-29` |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — gate `G-18`: the owner types each provider's key into the pane; the agent stops there and reports which providers still need one. Gate `G-19`: the owner accepts the residual-risk text, which already ships. |

**Goal.** The pane `P1-T44` shipped gains the four LLM provider blocks: a provider choice, a
masked key field per provider, a model choice, a validated base-URL override, and a status element.

**Read first.**
- `docs/08-ui-ux-spec.md` §7.3 — the LLM-providers groupbox markup (`llmProvider` menulist, the key
  input with **no** `preference` attribute, the model menulist, the `rh-or-base-url` input which
  *does* carry one, the `role="status"` element)
- `docs/08-ui-ux-spec.md` §7.5 — the ten key UX rules (rule 1 hold-to-show, rule 6 no `preference`
  on a key field)
- `docs/03-llm-provider-integration.md` §14.4 closing paragraph — base URLs are validated at write
  time here and resolved in the transport (`P3-T06`)
- `src/ui/prefs/preferencesPane.ts` — `SOURCE_CREDENTIALS`, `PREFERENCES_L10N`, `keyDigest`,
  `backendBadge`, `PreferencesHostApi`: extend these, do not build a parallel controller

**Already landed (§0.1):** the pane shell, NCBI and Semantic Scholar key fields, masked digest,
backend badge, residual-risk paragraphs, remove-all across every `SecretId`.

**Files.**
- modify `addon/content/preferences.xhtml`
- modify `addon/content/preferences.js`
- modify `src/ui/prefs/preferencesPane.ts`
- modify `src/bootstrap/registerUI.ts` (`publishPreferencesHost`)
- modify `src/i18n/keys.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- modify `test/unit/ui/preferencesPane.test.ts`
- modify `test/integration/preferences.spec.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. Add the LLM-providers groupbox per `docs/08` §7.3: the provider menulist bound to `llmProvider`,
   and one block per provider with a `type="password"` key input (no `preference=`), Reveal
   (hold-to-show on the value just typed), Test (wired by `P3-T14`), Clear, the model menulist bound
   to `<provider>.model`, the base-URL input bound to `<provider>.baseUrl`, and a `role="status"`
   element.
2. Extend the pane's credential list and `PreferencesHostApi` so the four `llm.*` ids store, mask
   and clear exactly as the two source ids do.
3. Base URL: use the provider's documented base URL (`docs/03` §2.1, §3.1, §4.1, §5.1) as the
   placeholder; on write accept only an absolute `https://` URL with no trailing slash, or empty;
   reject anything else with a message rather than normalizing it.
4. Add the empty-key-after-restore explanation (`docs/09` §1.9 item 8) and show it when every
   `*.keyPresent` is false and the plugin database is non-empty.
5. Strings per §0.2 item 1.

**Do NOT.**
- Do **not** put a `preference=` attribute on any key field (D5; `docs/08` §7.5 rule 6).
- Do **not** offer copy, a sticky reveal, or `SecretStore.get()` to populate a field
  (`docs/09` §1.9 rules 2 and 7).
- Do **not** resolve `<provider>.baseUrl` here — `P3-T06` owns resolution.
- Do **not** import `src/llm/` or `src/zotero/` from `src/ui/`; go through `PreferencesHostApi`.
- Do **not** type a key into the pane yourself; that is `G-18`.

**Done when.**
- [ ] Each of the four provider blocks stores, masks and clears a synthetic key through the host,
      and sets the matching `*.keyPresent`.
- [ ] Every `preference=` attribute in `preferences.xhtml` names a key in `src/prefs/keys.ts`, and no
      key input carries one — asserted by a test that parses the XHTML.
- [ ] `http://proxy.example/v1` and `https://proxy.example/v1/` are rejected with a message;
      `https://proxy.example/v1` is stored and read back.
- [ ] The profile's `prefs.js` contains no substring of a stored synthetic key.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "preferencesPane|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```
Then stop at `G-18`: report which provider blocks are ready for the owner to enter a key, and that
the agent will not see or handle the value.

**Notes.** Re-estimated 1.75 → 1.0 d on 2026-10-20: `P1-T44` delivered the pane shell, the two
source-credential blocks, the badge, the residual-risk text and remove-all.

---

### P3-T05 — LLM error mapping and the LLM retry policy

| Field | Value |
|---|---|
| **ID** | `P3-T05` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T06`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T17` |
| **Retires** | part of `R-4`, part of `R-6` |
| **Implements** | `FR-34` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Every provider failure lands on exactly one shipped error class through one mapping
function, LLM hosts get a retry policy through the existing `withRetry`, and the LLM error
messages become reachable strings.

**Read first.**
- `docs/03-llm-provider-integration.md` §11.5 — the taxonomy and its three traps (Anthropic 529,
  HTTP-200 refusals, spend cap masquerading as a rate limit)
- `docs/03-llm-provider-integration.md` §14.1 authority note — `ErrorCategory` → shipped class, and
  `StructuredOutputError` deliberately outside the transport retry set
- `docs/03-llm-provider-integration.md` §11.6 — the LLM retry policy sketch
- `docs/07-architecture-and-data-model.md` §7.3 — the LLM/TTS row has no retry cells, and §11.6
  owns a differently shaped backoff for those hosts
- `src/core/http/retry.ts` header — `withRetry`, `isRetriedAutomatically` (a `TimeoutError` is not
  retried automatically), `REQUEST_BUDGET_MS` (90 s total per request, retries included), and
  `RetryPolicy.nextDelayMs` as the seam for a jitter shape

**Already landed (§0.1):** every LLM error class, `withRetry` with decorrelated jitter,
`parseRetryAfter`, `createRetryFor`.

**Files.**
- create `src/llm/shared/errorMap.ts` (callers: the four adapters, `P3-T07`–`P3-T10`)
- modify `src/core/rateLimit/hostLimiter.ts` (one shared LLM retry budget that the LLM rows added
  by `P3-T07`–`P3-T10` carry in their `retry` cells)
- modify `test/unit/core/hostLimiter.test.ts`
- modify `src/i18n/keys.ts` (move `rh-error-llm`, `rh-error-context-length`,
  `rh-error-content-filter`, `rh-error-structured-output` from `DEFERRED_ERROR_MESSAGE_IDS` to
  `ERROR_MESSAGE_IDS`)
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/llm/errorMap.test.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. Write `mapProviderError(providerId, modelId, status, headers, body)` returning the shipped class
   per the `docs/03` §14.1 table.
2. Map Anthropic **529** to `UpstreamServerError`.
3. Map a spend cap (Anthropic 429 with `enforced_spend_limit_reached`; OpenRouter 402) to the
   shipped non-retryable `QuotaExceededError` (`rh-error-quota`, already shipped).
4. Detect refusals and content filtering from `stop_reason` / `finish_reason` / `finishReason` on
   HTTP 200, never from a status code.
5. Read `Retry-After` through `parseRetryAfter` into `RateLimitError.retryAfterMs`.
6. Declare one LLM retry budget in `hostLimiter.ts` for the adapters' `HOST_POLICIES` rows to
   carry. `createRetryFor` (`src/bootstrap/container.ts`) already turns any row with `retry` cells
   and a limiter into a policy for the existing `withRetry`, so no change is expected there; if one
   is needed, stop and say so. No second `withRetry`.
7. Move the four LLM message ids to `ERROR_MESSAGE_IDS` with strings, per §0.2 item 1.

> **Open — recommended:** use the shipped decorrelated jitter for LLM hosts too (one jitter shape in
> the tree) rather than `docs/03` §11.6's full jitter, take §11.6's sketch numbers (5 attempts,
> 1000 ms base, 60 s cap) as the LLM row's retry cells, and keep the 90 s `REQUEST_BUDGET_MS` as the
> per-request bound with §11.6's batch budget ("e.g. 30 min") as a pipeline-level limit
> (`P3-T17`). Also state whether LLM calls use `timeoutSeconds` (60 s default) per attempt, since a
> long full-text generation can exceed it. Changes `docs/03` §11.6 and `docs/07` §7.3 (LLM/TTS row).
> (Review §4 item 6.)

**Do NOT.**
- Do **not** write a second `withRetry`, a full-jitter helper outside `backoff.ts`, or a second
  `Retry-After` parser.
- Do **not** put `StructuredOutputError` or `ContextLengthExceededError` in the transport retry set
  (`docs/03` §14.1, §11.6).
- Do **not** retry a 401 or a spend cap.
- Do **not** construct `StructuredOutputError(message, ctx)`; the shipped constructor is
  `(providerId, modelId, message, ctx?)` (`docs/07` §10.1).
- Do **not** treat `status >= 500` as covering Anthropic overload; it is 529.

**Done when.**
- [ ] A table-driven test maps one recorded or hand-built error body per provider per category
      onto the expected shipped class.
- [ ] A 529 body maps to `UpstreamServerError` (retryable); an Anthropic 429 with
      `enforced_spend_limit_reached` maps to `QuotaExceededError` (not retryable).
- [ ] An HTTP-200 `stop_reason: "refusal"` maps to `ContentFilterError` and is not retried.
- [ ] With a fake clock, a `Retry-After: 30` response delays the next attempt by 30 s, through the
      existing `withRetry`.
- [ ] The four ids are in `ERROR_MESSAGE_IDS`, not `DEFERRED_ERROR_MESSAGE_IDS`, each with an
      `en-US` string and a commented `ko-KR` stub.
- [ ] `npm run typecheck` exits 0; `test/integration/l10n.spec.ts` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "errorMap|hostLimiter|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Step 6's numbers are an open decision; steps 1–5 and 7 do not depend on it.

---

### P3-T06 — `LLMProvider` contract, registry, router, mock harness

| Field | Value |
|---|---|
| **ID** | `P3-T06` |
| **State** | `TODO` |
| **Depends on** | `P3-T05`, `P3-T32` |
| **Blocks** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T17`, `P3-T35` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29`, `FR-33`, part of `FR-32` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** One provider-agnostic contract exists with a registry, a model-tier resolver, a base-URL
resolver, a heuristic token estimator, and a scripted mock — constructed in the composition root.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.3 — the shipped `LLMProvider` contract and its types,
  including the synchronous `countTokens(text, modelId): number`
- `docs/03-llm-provider-integration.md` §14.1 and §10.2 authority notes — doc 07 wins; every
  `countTokens()` result is inexact at the call site
- `docs/03-llm-provider-integration.md` §14.4 closing paragraph — base URLs are resolved here
- `docs/12-prompt-library.md` §18.5 — tier-to-pref mapping and the `screening.model` chain
- `docs/06-summarization-and-trend-report.md` §5.1 — the per-script `estTokens` heuristic
- `docs/13-testing-build-and-release.md` §2.2 — the `mockLLM` script shape

**Already landed (§0.1):** `ProviderId` in `src/model/ids.ts`; the `Zotero`-global rule already
keeps `src/llm/**` free of Zotero (`research-helper/zotero-global`), so the old lint step is done.

**Files.**
- create `src/llm/types.ts`
- create `src/llm/registry.ts`
- create `src/llm/router.ts`
- create `src/llm/shared/baseUrl.ts`
- create `src/llm/shared/tokenEstimate.ts` (the heuristic only; `P3-T13` adds calibration)
- create `src/model/usage.ts` (`docs/07` §5.1's `Usage`)
- create `src/bootstrap/registerProviders.ts` (builds the registry and router; `P3-T07`–`P3-T10`
  add one adapter each)
- modify `src/bootstrap/container.ts` (`installServices` calls `registerProviders`)
- modify `src/pipeline/types.ts` (replace the `LLMRouter` alias)
- create `test/helpers/mockLLM.ts`
- create `test/unit/llm/router.test.ts`
- create `test/unit/llm/tokenEstimate.test.ts`

**Do.**
1. Transcribe `docs/07` §4.3 into `src/llm/types.ts`, importing `ProviderId` and `Usage` from
   `src/model/`.
2. Implement the registry: register by `ProviderId`, read the active provider from `llmProvider`,
   expose `isConfigured()` per provider from `*.keyPresent`.
3. Implement the tier resolver: `cheap`/`standard` → `summaryModel` then `<provider>.model`;
   `strong` → `reportModel` then `<provider>.model`; screening → `screening.model` →
   `summaryModel` → `<provider>.model`.
4. Implement `chat()` dispatch, throwing `MissingCredentialError` with zero requests when no
   provider is configured (FR-33).
5. Implement `resolveBaseUrl(providerId)`: `<provider>.baseUrl` when non-empty and `https://`,
   the documented default otherwise (logging once on a refused value); export the effective host
   for `P3-T15`.
6. Implement `estTokens` in `src/llm/shared/tokenEstimate.ts` per `docs/06` §5.1's per-script
   ratios; it is the one estimator every `countTokens()` delegates to.
7. Create `registerProviders` and call it from `installServices`; replace the `LLMRouter` alias in
   `src/pipeline/types.ts` with the router's type.
8. Write `test/helpers/mockLLM.ts`: a scripted provider that records calls and replays
   `ChatResponse` values or errors (retry-then-succeed, context-length, budget stop, cancel at
   87/200, schema violation).

> **Open — recommended:** declare `LLMRouter` in `docs/07` §4.3 as the router's public surface
> (`resolveModel(tier)`, `chat`, `chatStream`, `activeProvider()`), since `PipelineContext` names
> the type and no document declares it. Changes `docs/07` §4.3 and §4.5. (Review §4 item 7.)

**Do NOT.**
- Do **not** type from `docs/03` §14.1's sketch names (`complete`, `stream`, `validateKey`, …).
- Do **not** let an adapter hold a literal base URL.
- Do **not** add a third model tier or skip `summaryModel` in the screening chain (`docs/12` §3).
- Do **not** silently fail over to another provider (`docs/09` §2.4 rule 6).
- Do **not** bundle a provider SDK, and do **not** let any test call a real provider.
- Do **not** widen `countTokens` to carry an `exact` flag.

**Done when.**
- [ ] A stub implementation compiles against `src/llm/types.ts` with every `docs/07` §4.3 member.
- [ ] The tier resolver's three chains are each asserted with a stubbed `PrefStore`.
- [ ] With no key configured, `chat()` throws `MissingCredentialError` and issues zero requests.
- [ ] `resolveBaseUrl()` returns the documented default when empty, the stored value when a valid
      `https://` URL, and the default again for `http://…`.
- [ ] `estTokens` is exported from exactly one module; the Hangul range covers U+AC00–U+D7A3.
- [ ] `installServices` constructs the registry (asserted in `test/unit/bootstrap/container.test.ts`
      or the new router test).
- [ ] `mockLLM` drives a five-call script with one `RateLimitError` and one `StructuredOutputError`.
- [ ] `npm run typecheck` and `npm run lint:check` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- "llm/router|tokenEstimate|container"
```

**Notes.** Re-estimated 0.75 → 1.0 d on 2026-10-20: the heuristic token estimator moved here from
`P3-T13` so that `P3-T08` and `P3-T09` (whose `countTokens` delegates to it) no longer depend on a
card that depends on them, and the card now creates `registerProviders.ts` and its call in
`installServices`. Follow `docs/07` §2.2's paths (`src/llm/types.ts`,
`src/llm/shared/tokenEstimate.ts`), not the roadmap's prose names.

---

### P3-T07 — OpenRouter adapter (the default provider)

| Field | Value |
|---|---|
| **ID** | `P3-T07` |
| **State** | `TODO` |
| **Depends on** | `P3-T01`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T15`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The default provider (decision D6) works through the shared transport: authenticated
chat with restrictive routing, a parsed model catalogue with real prices, and exact per-call cost
from `usage.cost`.

**Read first.**
- `docs/03-llm-provider-integration.md` §5.1–§5.4 — base URL, auth and attribution headers (send
  both `X-Title` and `X-OpenRouter-Title`), request and response shape
- `docs/03-llm-provider-integration.md` §7.4 — `provider.require_parameters: true` with any
  `response_format`
- `docs/09-security-privacy-and-api-keys.md` §3.4 rules 1 and 2 — `data_collection: "deny"` on every
  request, `zdr: true` in strict mode, the guardrail 404 keyed off status plus structured fields
- `docs/03-llm-provider-integration.md` §9.4 — the catalogue fields, prices as decimal strings,
  `pricing.overrides[]`, and the Anthropic dot-slug rule
- `docs/03-llm-provider-integration.md` §14.4 — the single transport choke point

**Files.**
- create `src/llm/openrouter/openRouterProvider.ts`
- create `src/llm/openrouter/mapper.ts`
- create `src/llm/openrouter/catalogue.ts`
- modify `src/bootstrap/registerProviders.ts` (construct and register the adapter with the
  `HttpClient`, the `SecretStore` and `resolveBaseUrl`)
- modify `src/core/rateLimit/hostLimiter.ts` (`HOST_POLICIES` row for `openrouter.ai`)
- modify `test/unit/core/hostLimiter.test.ts`
- create `test/unit/llm/openrouter.test.ts`

**Do.**
1. Implement `chat()` against `POST /api/v1/chat/completions`, reading the key through the
   `SecretStore`, wrapping it in `Secret` (`P3-T01`) and calling `expose()` once, in the
   header-building function.
2. Attach the `provider` block on every request: `data_collection: "deny"`; `require_parameters:
   true` whenever `responseFormat.kind === "json_schema"`; `zdr: true` when the effective privacy
   mode is strict (`P3-T15` supplies the mode; default to balanced until it lands).
3. Map `allowProviders` / `denyProviders` onto `provider.only` / `provider.ignore`.
4. Normalize the response per `docs/03` §14.3 and map errors through `mapProviderError` (`P3-T05`).
5. Implement `listModels()` over the unauthenticated `GET /api/v1/models`: prices parsed from
   strings × 1e6, `overrides` kept, `supportsJsonSchema` from `supported_parameters`,
   `maxOutputTokens`, `contextWindowTokens`, and `dataPolicy` (`"unknown"` where undeclared).
6. Map a guardrail 404 onto `BadRequestError` naming the cause and both remedies.
7. Add the `openrouter.ai` row to `HOST_POLICIES`.

> **Open — recommended:** the LLM rows in `HOST_POLICIES` carry no fixed request rate — burst and
> concurrency equal the `concurrency` pref, pacing comes only from `Retry-After` through
> `penalize()` — and `docs/07` §7.3's "from provider prefs" is replaced by that sentence, since no
> provider-rate preference exists in §8.5. Changes `docs/07` §7.3 (LLM/TTS row). (Review §4 item 5;
> applies equally to `P3-T08`–`P3-T10`.)

**Do NOT.**
- Do **not** omit `provider.data_collection: "deny"` (D6; `docs/09` §3.4 rule 1).
- Do **not** send `response_format` without `require_parameters: true` (`docs/03` §7.4).
- Do **not** substring-match the guardrail sentence (`docs/09` §3.4 rule 2).
- Do **not** derive an Anthropic slug by naive prefixing (`docs/03` §9.4), and do **not** default
  to a floating alias such as `~openai/gpt-latest`.
- Do **not** hardcode a model ID or a price (`plan/README.md` §5 rule 4).
- Do **not** fetch the live catalogue in a test; replay a fixture (§0.2 item 6).

**Done when.**
- [ ] A wire-shape snapshot asserts the exact request body for a fixed prompt, including
      `data_collection: "deny"` and, under `json_schema`, `require_parameters: true`.
- [ ] `zdr: true` appears in strict mode and is absent in balanced mode.
- [ ] `listModels()` over a recorded catalogue fixture yields `inputCostPerMTokUsd ===
      Number(pricing.prompt) * 1e6` and keeps an `overrides` entry.
- [ ] A recorded guardrail-404 fixture yields a `BadRequestError` naming both remedies.
- [ ] `usage.cost` reaches `Usage` unrounded.
- [ ] The key appears only through `expose()` in the header builder (grep: one call site).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "llm/openrouter|hostLimiter"
```

**Notes.** The fixtures this card's tests replay are hand-built or recorded under `P3-T30`'s gate;
none is recorded by this card. `GET /api/v1/models` needs no key, which is what lets `P3-T13` use
it as the price source for all four providers.

---

### P3-T08 — OpenAI adapter (Responses API)

| Field | Value |
|---|---|
| **ID** | `P3-T08` |
| **State** | `TODO` |
| **Depends on** | `P3-T01`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** OpenAI works through the same internal code path as OpenRouter, differing only in the
adapter.

**Read first.**
- `docs/03-llm-provider-integration.md` §2.1–§2.4 — base URL, why `POST /v1/responses`, headers,
  request and response shapes
- `docs/03-llm-provider-integration.md` §2.6 — reasoning tokens are billed as output
- `docs/03-llm-provider-integration.md` §7.1 and §7.5 — structured output at `text.format`
- `docs/03-llm-provider-integration.md` §9.1 — `GET /v1/models` returns IDs only
- `docs/03-llm-provider-integration.md` §14.3 — text extraction and the effort-scale trap

**Files.**
- create `src/llm/openai/openAiProvider.ts`
- create `src/llm/openai/mapper.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts` (`api.openai.com` row)
- modify `test/unit/core/hostLimiter.test.ts`
- create `test/unit/llm/openai.test.ts`

**Do.**
1. Implement `chat()` against `POST /v1/responses`, key via `Secret.expose()` in the header
   builder, system content as a `role: "system"` entry in `input`.
2. Map `maxOutputTokens` onto `max_output_tokens`, clamped to `ModelInfo.maxOutputTokens`.
3. Map the shared `Effort` union onto OpenAI's levels through a function.
4. Extract text from `output[].content[]` message / `output_text` blocks; fill `Usage` with
   reasoning tokens counted as output.
5. Map `status` plus `incomplete_details` onto `finishReason`.
6. Implement `listModels()` over `GET /v1/models`, dropping embedding, audio, image, realtime and
   moderation entries; enrichment is `P3-T13`'s.
7. Implement `countTokens(text, modelId)` by delegating to `estTokens` (`P3-T06`).
8. Add the `api.openai.com` row to `HOST_POLICIES` (same open line as `P3-T07`).

**Do NOT.**
- Do **not** use `response_format` on the Responses surface; the field is `text.format`.
- Do **not** forward `none` or `minimal` effort unmapped; OpenAI rejects them.
- Do **not** omit reasoning tokens from output cost.
- Do **not** hardcode a model ID outside `addon/prefs.js`'s seed default.

**Done when.**
- [ ] A wire-shape snapshot shows `max_output_tokens` present and `max_tokens` absent.
- [ ] A truncated response fixture yields `finishReason: "length"`.
- [ ] `listModels()` over a fixture excludes every embedding, audio and image entry.
- [ ] An `Effort` of `minimal` is mapped, not forwarded.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "llm/openai|hostLimiter"
```

**Notes.** `countTokens()` returns the shared heuristic, synchronous, a bare `number`; treat it as
inexact at every call site (`docs/03` §10.2 authority note).

---

### P3-T09 — Anthropic adapter (Messages API)

| Field | Value |
|---|---|
| **ID** | `P3-T09` |
| **State** | `TODO` |
| **Depends on** | `P3-T01`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Anthropic works through the same internal path, and supplies the plugin's only exact,
free pre-flight token count as an adapter-private helper.

**Read first.**
- `docs/03-llm-provider-integration.md` §3.1–§3.4 — `anthropic-version: 2023-06-01`,
  `anthropic-dangerous-direct-browser-access`, required `max_tokens`, top-level `system`
- `docs/03-llm-provider-integration.md` §7.2 — `output_config.format`, strict tool use as fallback
- `docs/03-llm-provider-integration.md` §9.2 — `max_input_tokens`, pagination via `has_more` /
  `last_id`
- `docs/03-llm-provider-integration.md` §10.1 — `POST /v1/messages/count_tokens`
- `docs/03-llm-provider-integration.md` §11.5 traps 1 and 3 — 529 and the spend-cap 429
- `docs/03-llm-provider-integration.md` §14.3 — usage summed across the cache fields

**Files.**
- create `src/llm/anthropic/anthropicProvider.ts`
- create `src/llm/anthropic/mapper.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts` (`api.anthropic.com` row)
- modify `test/unit/core/hostLimiter.test.ts`
- create `test/unit/llm/anthropic.test.ts`

**Do.**
1. Implement `chat()` against `POST /v1/messages` with `x-api-key` (via `Secret.expose()`),
   `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`.
2. Lift the system message into the top-level `system` field; always send `max_tokens`.
3. Implement structured output via `output_config.format`, strict tool use as fallback.
4. Implement `countTokens(text, modelId)` synchronously by delegating to `estTokens` (`P3-T06`);
   add the exact count over `POST /v1/messages/count_tokens` as an **adapter-private async
   helper**, falling back to the heuristic on any failure.
5. Implement `listModels()` with pagination, `max_input_tokens` → `contextWindowTokens`,
   `max_tokens` → `maxOutputTokens`.
6. Sum `input_tokens` with the cache-read and cache-write counts in `Usage`.
7. Add the `api.anthropic.com` row to `HOST_POLICIES` (same open line as `P3-T07`).

**Do NOT.**
- Do **not** send `system` as a message, omit `max_tokens`, or look for `context_window`.
- Do **not** add a member to `LLMProvider` for the exact count.
- Do **not** bump `anthropic-version`, or build any feedback affordance (`docs/09` §3.3).
- Do **not** retry a spend-cap 429.

**Done when.**
- [ ] A wire-shape snapshot shows `system` at the top level and `max_tokens` present.
- [ ] A stub `LLMProvider` with no extra member compiles; `countTokens` is synchronous.
- [ ] The private exact counter returns a fixture's count and, on a stubbed failure, the heuristic.
- [ ] `listModels()` follows two pages of a fixture and returns the union.
- [ ] A usage block with cache fields yields total input greater than `input_tokens`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "llm/anthropic|hostLimiter"
```

**Notes.** `P3-T16`'s estimator may use the exact count to calibrate, never to gate (`docs/03`
§10.2). The dependency on `tokenEstimate.ts` now points at `P3-T06`, which this card depends on;
before 2026-10-20 it pointed at `P3-T13`, which depends on this card.

---

### P3-T10 — Gemini adapter (Interactions API)

| Field | Value |
|---|---|
| **ID** | `P3-T10` |
| **State** | `TODO` |
| **Depends on** | `P3-T01`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T15`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Gemini works through the same internal path, with the key in a header only, and the
free/paid tier determined — or conservatively assumed free — before the first call.

**Read first.**
- `docs/03-llm-provider-integration.md` §4.1–§4.4 — the Interactions API, `system_instruction`,
  `generation_config`
- `docs/03-llm-provider-integration.md` §4.2 and `docs/09` §2.1 "URLs" — the key goes in
  `x-goog-api-key`, never `?key=`
- `docs/09-security-privacy-and-api-keys.md` §3.3 "Google Gemini" and §3.4 rule 4 — the paid/unpaid
  split and that an indeterminate tier is assumed free
- `docs/03-llm-provider-integration.md` §9.3 — `GET /v1beta/models`, the `models/` prefix

**Files.**
- create `src/llm/gemini/geminiProvider.ts`
- create `src/llm/gemini/mapper.ts`
- create `src/llm/gemini/tierDetect.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts` (`generativelanguage.googleapis.com` row)
- modify `test/unit/core/hostLimiter.test.ts`
- create `test/unit/llm/gemini.test.ts`

**Do.**
1. Implement `chat()` against `POST /v1beta/interactions`, key in `x-goog-api-key` via
   `Secret.expose()`, `system_instruction`, `generation_config.max_output_tokens`, `store: false`.
2. Map the shared `Effort` union onto `thinking_level`'s four values.
3. Extract text from `steps[].content[]` filtered to `model_output`; fill `Usage`.
4. Implement `listModels()` filtered on `supportedGenerationMethods`, `models/` prefix stripped.
5. Implement `detectTier()` per session and per key change, returning `"free-or-unknown"` when it
   cannot tell.
6. Keep `generateContent` behind one documented fallback function, unused by default.
7. Add the host row to `HOST_POLICIES` (same open line as `P3-T07`).

> **Open — recommended:** assume no programmatic billing signal exists — `detectTier()` returns
> `"free-or-unknown"` unless a documented signal is found — ask the user once per key change with
> the answer defaulted to free/unsure, and show the free-tier warning on every job while the answer
> is free or unknown. Changes `docs/09` §3.4 rule 4 and §8 item 3; ties to gate `G-06`. (Review §4
> item 18.)

**Do NOT.**
- Do **not** put the key in a query parameter, ever.
- Do **not** assume the paid tier when detection is inconclusive, or infer it from an account's
  billing method.
- Do **not** use Context Caching, leave File API uploads undeleted, or use Grounding with Google
  Search (each breaks ZDR, `docs/09` §3.3).
- Do **not** forward `xhigh` or `max` to `thinking_level`.

**Done when.**
- [ ] The request URL in a wire-shape snapshot carries no `key=`, `api_key=` or `token=`, and the
      key appears only in `x-goog-api-key`.
- [ ] `store: false` is on every request body.
- [ ] `listModels()` returns IDs without `models/` and excludes embedding-only and TTS-only entries.
- [ ] `detectTier()` on an inconclusive response returns `"free-or-unknown"`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "llm/gemini|hostLimiter"
```

**Notes.** A live Gemini call on the free tier is governed by gate `G-06`; this card makes none.

---

### P3-T11 — SSE streaming across the four adapters

| Field | Value |
|---|---|
| **ID** | `P3-T11` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` |
| **Blocks** | `P3-T30` |
| **Retires** | part of `R-14` |
| **Implements** | part of `FR-29`, part of `FR-53` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `chatStream()` yields normalized text deltas from all four providers over the existing
transport, and the router falls back to `chat()` where streaming is unavailable.

**Read first.**
- `docs/spikes/phase-0.md` `V-8` row — **verified: build on XHR** through `Zotero.HTTP.request`
  with `responseType: "text"` and progress events; `fetch` streaming worked only in a window global
- `docs/03-llm-provider-integration.md` §6.1–§6.4 — the four SSE payload shapes
- `docs/07-architecture-and-data-model.md` §4.3 — `chatStream?` is optional; `ChatStreamChunk`
- `docs/07-architecture-and-data-model.md` §7.4 — cancellation through `cancellerReceiver`
- `docs/08-ui-ux-spec.md` §6.2 — paint raw text during the stream, render once at the end

**Files.**
- modify `src/llm/shared/sse.ts` (extend; `scripts/spike-network.ts` imports it — keep
  `createSseParser` and `parseSse`. The file holds a literal NUL inside a string, so use
  `grep -a` on it)
- modify `src/core/http/client.ts` (a streaming request mode over the same choke point)
- modify `src/zotero/zoteroApi.ts` (`createZoteroHttpTransport`: progress events)
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/llm/openai/openAiProvider.ts`
- modify `src/llm/anthropic/anthropicProvider.ts`
- modify `src/llm/gemini/geminiProvider.ts`
- modify `src/llm/router.ts`
- create `test/unit/llm/sse.test.ts`
- modify `test/unit/core/http-client.test.ts`

**Do.**
1. Add per-provider payload mappers from the parser's events to `ChatStreamChunk`.
2. Add a streaming mode to the `HttpClient` that surfaces response text progressively through
   `createZoteroHttpTransport`'s progress events — the same limiter, retry and redaction path as a
   plain request.
3. Implement `chatStream()` on each adapter, passing the cancellation token so an aborted stream
   stops.
4. Make the router call `chat()` when `chatStream` is absent or `ModelInfo.supportsStreaming` is
   false, without the caller branching.
5. Emit the final `usage` on the terminal chunk where the provider supplies it.

**Do NOT.**
- Do **not** write a second HTTP stack or call `fetch` from the plugin sandbox (`V-8`).
- Do **not** replace `src/llm/shared/sse.ts`; extend it.
- Do **not** treat an aborted stream as a reportable error (`OperationCancelledError` is
  `userFacing: false`).
- Do **not** infer completion from an empty delta; use the terminal event.

**Done when.**
- [ ] The parser reconstructs each provider's streamed fixture text byte-identical to the
      non-streamed fixture's text.
- [ ] A stream cut mid-frame surfaces a `NetworkError`, not a short result.
- [ ] Aborting mid-stream stops iteration and issues no further reads (fake transport).
- [ ] A model with `supportsStreaming: false` is routed through `chat()` with no caller branch.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "llm/sse|http-client"
```

**Notes.** Re-estimated 0.5 → 0.75 d on 2026-10-20: the card now also adds the streaming mode to
the shipped transport, which `V-8` showed must be XHR, and the parser already exists.

---

### P3-T12 — Structured output, validation, and the repair path

| Field | Value |
|---|---|
| **ID** | `P3-T12` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` |
| **Blocks** | `P3-T25`, `P3-T27`, `P3-T30` |
| **Retires** | part of `R-6` |
| **Implements** | part of `FR-21`, part of `FR-34` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A schema-constrained call returns a validated object or throws — never prose, never a
half-parsed shape, and never a repair loop that burns money.

**Read first.**
- `docs/03-llm-provider-integration.md` §7.1–§7.5 — the four mechanisms and their field paths
- `docs/03-llm-provider-integration.md` §14.5 — `completeJSON`: truncation check, refusal early
  exit, fence stripper, one correction turn
- `docs/12-prompt-library.md` §18.3–§18.4 — `parseOrRepair`, "one repair, one full retry, then
  fail that item", and client-side validation always
- `docs/06-summarization-and-trend-report.md` §6.4 — the universal prompt-append fallback

**Files.**
- create `src/llm/shared/jsonMode.ts` (callers: `P3-T25`, `P3-T27`)
- create `src/llm/shared/schemaValidate.ts`
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/llm/openai/openAiProvider.ts`
- modify `src/llm/anthropic/anthropicProvider.ts`
- modify `src/llm/gemini/geminiProvider.ts`
- create `test/unit/llm/jsonMode.test.ts`

**Do.**
1. Translate `responseFormat.kind === "json_schema"` into each provider's native field inside its
   adapter.
2. Write a dependency-free validator for the JSON Schema constructs `PaperSummary` v1 uses.
3. Implement `completeJSON()` per `docs/03` §14.5.
4. Implement `parseOrRepair()` per `docs/12` §18.3, throwing the four-argument
   `StructuredOutputError`.
5. Enforce: one repair, then one full retry at temperature 0, then fail that item.
6. Implement the prompt-append fallback for models without structured output.

**Do NOT.**
- Do **not** trust `strict: true`; validate client-side every time.
- Do **not** loop the repair, or retry a refusal or a content-filter stop.
- Do **not** put `StructuredOutputError` in the transport retry set.
- Do **not** bundle a JSON Schema library (NFR-18).

**Done when.**
- [ ] Each provider's `chat-json-malformed` fixture parses through the fence stripper.
- [ ] A schema-violating body triggers exactly one repair and one retry (`mockLLM` call count),
      and a third failure throws `StructuredOutputError` with `providerId` and `modelId`.
- [ ] A `finish_reason: "length"` fixture throws before any repair; a refusal throws
      `ContentFilterError` with zero repairs.
- [ ] The validator accepts the canonical `PaperSummary` v1 example and rejects an extra
      property, a bad `studyDesign` enum value and a missing required field.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/jsonMode
```

**Notes.** `docs/06` §6.4's `generateStructured` is implemented as `completeJSON()` over `chat()`;
no second adapter member.

---

### P3-T13 — Model catalogue, pricing table, token calibration

| Field | Value |
|---|---|
| **ID** | `P3-T13` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T32`, `P3-T33` |
| **Blocks** | `P3-T14`, `P3-T15`, `P3-T16`, `P3-T23` |
| **Retires** | `R-5` |
| **Implements** | `FR-32`, part of `FR-24`, part of `NFR-5` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The model picker and the cost estimator are driven by a cached live catalogue with real
prices and a visible "as of" date, and the one token estimator gains its per-model calibration.

**Read first.**
- `docs/03-llm-provider-integration.md` §9 preamble and §9.4 — fetch at run time, 24 h cache,
  bundled fallback only if every fetch fails; OpenRouter's catalogue as the metadata source
- `docs/03-llm-provider-integration.md` §12.1, §12.4 — the price table and the estimator UI
- `docs/03-llm-provider-integration.md` §10.2 "Correcting the drift" — the factor is applied after
  the heuristic and before the 20 % headroom
- `docs/06-summarization-and-trend-report.md` §5.1 D-06-5 — the 1.15× multiplier and the
  `maxOutputTokens + 800` reserve
- `docs/07-architecture-and-data-model.md` §8.5 — `llm.tokenEstimateCalibration` (written at most
  once per job) and §8.2 (a pref write rewrites `prefs.js`)

**Files.**
- create `src/llm/shared/modelCatalogue.ts` (callers: the pane host in `P3-T14` and the estimator in
  `P3-T16`)
- create `src/llm/shared/pricing.ts`
- create `src/llm/shared/slugMap.ts`
- modify `src/llm/shared/tokenEstimate.ts` (created by `P3-T06`)
- create `test/unit/llm/slugMap.test.ts`
- create `test/unit/llm/pricing.test.ts`
- create `test/unit/llm/calibration.test.ts`

**Do.**
1. `slugMap.ts`: `toOpenRouterSlug(providerId, nativeId)` with the Anthropic dot rule.
2. `modelCatalogue.ts`: fetch each configured provider's list, enrich from the OpenRouter
   catalogue via the slug map, leave fields `undefined` when the slug is missing; cache in the
   `Cache` layer (`P3-T33`) with a 24 h TTL and record the fetch time as "as of".
3. Ship a small bundled fallback list used only when every fetch fails, with a `stale` flag the UI
   reads (`P3-T14` renders it in the pane, `P3-T16` in the cost dialog).
4. `pricing.ts`: cost from `ModelInfo` prices honouring `pricing.overrides[]`, with a user-editable
   override table and the "as of" date.
5. Calibration: accumulate the estimated-to-actual input ratio per model in memory during a job;
   at job end read `llm.tokenEstimateCalibration`, parse inside try/catch (failure = `{}`), fold in
   the ratios, and write it back **once** with `setPref`. In `estTokens`, apply a positive numeric
   factor after the heuristic and before the 20 % headroom; anything else means uncalibrated.

> **Open — recommended:** the owner confirms, at gate `G-18` time, that the seed model IDs in
> `docs/07` §8.5 (`anthropic/claude-sonnet-5`, `gpt-5.6-terra`, `gemini-3.8-flash`,
> `claude-sonnet-5`) and the 2026-09-08 price table are still current, and names the "cheapest
> capable" model per provider for `P3-T31`. An agent cannot check this without a live request.
> Changes `docs/07` §8.5, `docs/03` §12.1 and §16, `docs/09` §8 item 7. (Review §4 item 16.)

**Do NOT.**
- Do **not** hardcode a model ID or price outside `addon/prefs.js`'s seed defaults.
- Do **not** parse `pricing.prompt` as a JSON number, ignore `overrides`, or naive-prefix an
  Anthropic slug.
- Do **not** show a cost without the "as of" date and the word "estimate".
- Do **not** add a second estimator; `estTokens` in `tokenEstimate.ts` is the one.
- Do **not** write the calibration pref per call, store it in the database, or add a schema row
  (`P3-T32` adds it).
- Do **not** fetch a live catalogue in a test.

**Done when.**
- [ ] `toOpenRouterSlug("anthropic", "claude-haiku-4-5") === "anthropic/claude-haiku-4.5"`.
- [ ] `costOf()` on a model with an `overrides` tier returns the higher price above its
      `min_prompt_tokens`.
- [ ] An OpenAI-only configuration still yields context and price for a model, from the
      OpenRouter catalogue fixture.
- [ ] With every fetch stubbed to fail, the catalogue returns the bundled list with `stale: true`.
- [ ] A 10-call scripted job makes exactly one `setPref` for the calibration row.
- [ ] With the pref stubbed `"not json"`, `estTokens` returns the uncalibrated value without
      throwing; with `{"m": 1.2}` it returns 1.2× for model `m` before headroom.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "slugMap|pricing|calibration|tokenEstimate"
```

**Notes.** Re-estimated 0.75 → 0.5 d on 2026-10-20: the base heuristic moved to `P3-T06` (so that
`P3-T08` and `P3-T09` no longer depend on a card that depends on them), and populating the pane's
model menulists — which the card assigned to a `prefsController.ts` that does not exist — moved to
`P3-T14`, which already wires the pane. This card no longer depends on the pane (`P3-T04`).

---

### P3-T14 — `validateCredentials()` and the Test-key button

| Field | Value |
|---|---|
| **ID** | `P3-T14` |
| **State** | `TODO` |
| **Depends on** | `P3-T04`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T13`, `P3-T32`, `P3-T34`, `P3-T36` |
| **Blocks** | `P3-T31` |
| **Retires** | part of `R-9` |
| **Implements** | `FR-31`, part of `FR-32` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — gate `G-18`: a real key per provider is needed for the live path. The agent implements and tests against fixtures, then stops and asks the owner to enter each key and press Test, and to report the outcomes. The agent never sees a key. |

**Goal.** Pressing Test tells the user precisely what is wrong with an LLM key, costs nothing,
and persists the outcome; the pane's model pickers are filled from the catalogue; a 401 in a
running job pauses it once.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §2.3 — cheapest authenticated endpoint, never a
  completion, the outcome set (429 counts as a pass; network = inconclusive)
- `docs/09-security-privacy-and-api-keys.md` §2.4 — the 401 policy: pause with
  `credential-required`, mark rejected, keep the key, one notification
- `docs/07-architecture-and-data-model.md` §4.3 `CredentialCheckResult` and §8.5's
  `<provider>.lastValidatedAt` / `<provider>.lastValidationResult`
- `src/ui/prefs/preferencesPane.ts` — the shipped NCBI/S2 Test: `ncbiTestRequest`,
  `classifyNcbiResponse`, `semanticScholarTestRequest`, `classifySemanticScholarResponse`,
  `classifyFailure`, `TestOutcome` — extend this path, do not rebuild it

**Files.**
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/llm/openai/openAiProvider.ts`
- modify `src/llm/anthropic/anthropicProvider.ts`
- modify `src/llm/gemini/geminiProvider.ts`
- modify `src/ui/prefs/preferencesPane.ts` (`testKey` for `llm.*` ids, outcome persistence)
- modify `src/bootstrap/registerUI.ts` (`publishPreferencesHost` passes the registry and the
  catalogue from `P3-T13`)
- modify `addon/content/preferences.js` (Test, status painting, the model menulists)
- modify `src/core/jobQueue/queue.ts` (created by `P3-T34`; the mid-job 401 policy)
- modify `src/zotero/keychain.ts` (reset `lastValidationResult` on rotation or removal)
- modify `src/i18n/keys.ts`, `addon/locale/en-US/research-helper-mainWindow.ftl`,
  `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/llm/validateCredentials.test.ts`
- modify `test/unit/ui/preferencesPane.test.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. Implement `validateCredentials()` on each adapter over its list endpoint (`GET /v1/models`,
   `GET /v1beta/models` with header auth, `GET /api/v1/key`).
2. Classify: 2xx → `ok` with `models`; 401 → `rejected`; 403 → `forbidden`; 429 → `ok`; network or
   timeout → inconclusive, and the stored value is left unchanged.
3. Persist the outcome in `<provider>.lastValidationResult` and the time in
   `<provider>.lastValidatedAt` for all six credential ids, through `setPref`; the persisted
   `CredentialCheckResult` passes the `P3-T36` gate.
4. Wire Test inline for the four LLM blocks; on success repopulate the model menulist from the
   returned list; paint every status element from the stored result on pane load.
5. On pane load, fill each provider's model menulist from `P3-T13`'s catalogue through
   `PreferencesHostApi`, keeping it editable, with the "as of" date and a stale marker when the
   catalogue fell back to its bundled list. (Moved here from `P3-T13` on 2026-10-20.)
6. In the queue, a 401 mid-job pauses with `credential-required`, emits one notification, keeps the
   key, and sets `lastValidationResult = "rejected"` with a timestamp.
7. Reset `lastValidationResult` to `""` on key rotation or removal (`docs/09` §2.5).
8. Strings per §0.2 item 1.

> **Open — recommended:** keep the NCBI and Semantic Scholar checks in `preferencesPane.ts` for
> Phase 3 and move them into the source adapters with `plan/00` §6 item 52, not here. Changes
> `docs/09` §8 item 8. (Review §4 item 19.)

**Do NOT.**
- Do **not** validate with a completion call or send any user content.
- Do **not** mark a key bad on a network failure, or treat a 429 as a failure.
- Do **not** delete a stored key on a 401, or emit one notification per item.
- Do **not** show the result in a modal (`docs/08` §7.5 rule 2).
- Do **not** include any part of the key, or a raw provider error body, in the result.
- Do **not** press Test with a real key yourself; that is `G-18`.

**Done when.**
- [ ] A 401 fixture per provider yields `ok: false`, `httpStatus: 401`, and a `messageKey`
      distinct from the 403 case; a 429 fixture yields `ok: true`.
- [ ] A simulated network failure leaves `lastValidationResult` unchanged.
- [ ] A mid-job 401 leaves a 200-item job `paused` with `credential-required`, the key stored,
      `lastValidationResult === "rejected"`, and exactly one notification.
- [ ] Rotating or removing a key resets `lastValidationResult` to `""`.
- [ ] With the catalogue stubbed stale, the pane's model menulist shows the bundled list and the
      stale marker, and accepts a typed model ID.
- [ ] A persisted `CredentialCheckResult` contains no substring of the synthetic key.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "validateCredentials|preferencesPane|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```
Then stop at `G-18`: ask the owner to enter each key and press Test, and record the reported
outcomes. A live re-check in a spec follows the `RH_DOD_LIVE` opt-in (`plan/00` §6 item 53).

**Notes.** The `<provider>.lastValidationResult` rows are added by `P3-T32`, not here.
Re-estimated 0.5 → 0.75 d on 2026-10-20 for the menulist population moved in from `P3-T13`.

---

### P3-T15 — Privacy modes, egress disclosure, Gemini free-tier warning

| Field | Value |
|---|---|
| **ID** | `P3-T15` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T10`, `P3-T13`, `P3-T32`, `P3-T36` |
| **Blocks** | `P3-T16`, `P3-T35` |
| **Retires** | part of `R-9` |
| **Implements** | `FR-36` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Before any content leaves the machine the user is told where it goes and what it is, the
privacy mode mechanically restricts what may be sent, and the Gemini free-tier warning cannot be
turned off.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §3.5 — the three modes; a per-collection override in
  `collection_settings` can only be stricter
- `docs/09-security-privacy-and-api-keys.md` §3.4 rules 1, 3, 4 and §3.6 — disclosure at the point
  of action, the suppression rules, the non-suppressible Gemini warning, the egress log, and the
  `privacy.egressAcknowledged` semantics (an acknowledgement that suppresses nothing)
- `docs/09-security-privacy-and-api-keys.md` §3.2 — what feature 3a may never send
- `docs/07-architecture-and-data-model.md` §8.3 (`collection_settings`, `job`) and §5.2
  (`SummaryInputScope`)

**Files.**
- create `src/pipeline/shared/privacyPolicy.ts` (callers: `P3-T16`'s dialog and `P3-T29`'s
  pipeline, through the context `P3-T35` wires)
- create `src/pipeline/shared/egressDisclosure.ts` (the disclosure content as data; the dialog
  renders it in `P3-T16`)
- modify `src/pipeline/types.ts` (replace the `PrivacyPolicy` alias)
- modify `src/llm/openrouter/openRouterProvider.ts` (mode → `zdr`)
- modify `src/bootstrap/migrations.ts` (`collection_settings`, next free version)
- modify `src/zotero/db.ts` (a `collection_settings` store)
- modify `test/unit/core/provenanceRerun.test.ts`
- modify `test/integration/zotero/provenanceStore.spec.ts`
- modify `src/i18n/keys.ts`, `addon/locale/en-US/research-helper-mainWindow.ftl`,
  `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/pipeline/privacyPolicy.test.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. `effectiveMode(globalMode, collectionOverride)` returns the stricter of the two.
2. `allowedInputScope(mode)`: strict forces `fullTextMode` to `never`; notes, annotations, tags and
   collection names are excluded except under `full` with a separate opt-in.
3. `assertModelAllowed(model, mode)`: refuse `"unknown"` training policy in strict, refuse `"yes"`
   in strict and balanced, warn in full — via `PolicyViolationError`.
4. Feed the mode into the OpenRouter `provider` block (`zdr: true` in strict).
5. Build the disclosure content (provider, **effective** host from `resolveBaseUrl()`, item count,
   content scope, privacy mode) as data the cost dialog embeds; not a second dialog. When
   `privacy.egressAcknowledged` is `false` include the first-job notice; set it `true` only when
   the user confirms that dialog.
6. Implement "don't ask again for this collection": it never suppresses a provider change, a
   privacy-mode change, the first full-text send, or the Gemini free-or-unknown warning.
7. Add the Gemini free-tier warning as an `en-US` string transcribed from `docs/09` §3.6 item 3,
   shown whenever the tier is free or unknown, with no suppression path. Its `ko-KR` entry is a
   commented stub on `KO_PENDING_REVIEW`: the coordinator drafts the Korean and the owner reviews
   it (`G-41`); it is never machine-translated.
8. Write the per-job egress log (provider, item count, content scope) into the job record through
   the `P3-T36` gate, locally only.
9. Add `collection_settings` as the next migration (§0.2 item 4).

> **Open — recommended:** declare `PrivacyPolicy` in `docs/07` §4.5 as the surface this card builds
> (`effectiveMode`, `allowedInputScope`, `assertModelAllowed`). Changes `docs/07` §4.5. (Review §4
> item 7.)

**Do NOT.**
- Do **not** let a per-collection setting loosen the global mode, or keep it in a preference.
- Do **not** send collection names, tags, notes, annotations or folder structure.
- Do **not** guess a `dataPolicy`, make the Gemini warning suppressible, or downgrade it when the
  tier is merely unknown.
- Do **not** add telemetry or upload the egress log.
- Do **not** let `privacy.egressAcknowledged` suppress anything, write it on cancel, or write it
  from anywhere but the first-job confirmation.
- Do **not** import `src/zotero/` or `src/llm/` adapters from `src/ui/`; the disclosure content is
  built in `pipeline/` and rendered by the dialog.

**Done when.**
- [ ] `effectiveMode("balanced", "strict") === "strict"` and `effectiveMode("strict", "full") ===
      "strict"`.
- [ ] In strict mode a plan for a full-text item yields `SummaryInputScope.kind === "abstract"`.
- [ ] An `"unknown"`-policy model throws `PolicyViolationError` in strict and only warns in balanced.
- [ ] With `openrouter.baseUrl = "https://gateway.example/v1"` the disclosure names
      `gateway.example`.
- [ ] Confirming calls `setPref` for `privacy.egressAcknowledged` once; cancelling calls it zero
      times; with it `true` the per-job disclosure and the Gemini warning still render.
- [ ] The persisted egress log passes the `P3-T36` gate (no synthetic key survives).
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "privacyPolicy|provenanceRerun|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Re-estimated 0.75 → 1.0 d on 2026-10-20 for the `collection_settings` migration, the
`PrivacyPolicy` type and the redaction-gated egress log, none of which the card priced. The
`privacy.egressAcknowledged` row is added by `P3-T32`. The old `src/ui/dialogs/egressDisclosure.ts`
moved to `pipeline/` because `ui/` cannot reach `resolveBaseUrl()` in `llm/`.

---

### P3-T16 — Cost estimate, confirmation gate, `BudgetGuard`, usage

| Field | Value |
|---|---|
| **ID** | `P3-T16` |
| **State** | `TODO` |
| **Depends on** | `P3-T13`, `P3-T15`, `P3-T32` |
| **Blocks** | `P3-T25`, `P3-T29`, `P3-T35` |
| **Retires** | `R-4` |
| **Implements** | `FR-24`, `FR-35`, `NFR-5` |
| **Estimate** | 1.25 d |
| **Human gate** | **Yes** — gate `G-21`, the first real spend: after the fixtures pass, the owner runs one 3-item summarize job with their own key (expected spend well under $0.05) and compares the dialog's estimate with the provider's reported usage. The agent prepares the run and stops; it never starts a paid run. |

**Goal.** No run starts without a number; above a threshold the user must say yes twice; and a run
that reaches a spend ceiling **pauses and asks whether to continue**, keeping everything done so
far.

> **Decided 2026-10-20 (owner, `plan/00` §6 item 234 c):** reaching `run.maxSpendUSD` or
> `run.maxSessionSpendUSD` **pauses the run and asks** whether to continue, as `docs/11` §1's
> definition of done and `P3-T31` already say. `docs/06` §5.4 ("the run refuses rather than
> prompting") — and the "abort" wording of §11.4 — **change first**; the coordinator edits
> `docs/06`, not this card. Do not start this card's step 4 before that edit lands.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.4 — DR-1, the cost model, the mandatory preview,
  `summary.confirmAboveUSD`, the abstract-only downgrade (read the ceiling sentence as superseded
  by the decision above)
- `docs/06-summarization-and-trend-report.md` §11.4 — two ceilings, checked before each call, the
  stricter binds, the session counter never persisted
- `docs/07-architecture-and-data-model.md` §4.3 `BudgetGuard` and §12.3 — `Estimating →
  AwaitingConfirm`, and `BudgetStop` as a paused state, not `Failed`
- `docs/10-requirements-and-user-stories.md` FR-24 — "estimate; actual cost may differ" and the
  second acknowledgement

**Files.**
- create `src/pipeline/shared/budget.ts` (`BudgetGuard`; wired into the context by `P3-T35`)
- create `src/pipeline/shared/estimate.ts` (caller: `P3-T29`'s pipeline)
- modify `src/pipeline/types.ts` (replace the `BudgetGuard` alias)
- create `src/ui/dialogs/costConfirmDialog.ts`
- create `addon/content/costConfirm.xhtml`
- create `addon/content/costConfirm.js` (the window script)
- modify `src/bootstrap/registerUI.ts` (the dialog opener the pipeline calls)
- modify `addon/content/preferences.xhtml`, `addon/content/preferences.js`,
  `src/ui/prefs/preferencesPane.ts` (the Usage readout)
- modify `src/i18n/keys.ts` (also move `rh-error-budget` from `DEFERRED_ERROR_MESSAGE_IDS` to
  `ERROR_MESSAGE_IDS`)
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/pipeline/budget.test.ts`
- create `test/unit/pipeline/estimate.test.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. `estimateRun()`: per item, resolve the input scope, estimate tokens with `estTokens`, add the
   `docs/06` §5.2 output ceilings, count calls, price through `pricing.ts` including overrides;
   produce the selected plan and the abstract-only downgrade.
2. Confirmation: always show the dialog; above `summary.confirmAboveUSD` require a second explicit
   acknowledgement; pre-select (never silently apply) the abstract-only downgrade above
   `summary.fullTextAutoMaxPapers`. Embed `P3-T15`'s disclosure block.
3. `BudgetGuard` with a per-run counter and an in-memory session counter (reset on restart);
   check both before every call; the stricter binds; name it in the dialog.
4. **Ceiling reached** (pre-run estimate above a ceiling, or `reserve()` throwing
   `BudgetExceededError` mid-run): move the job to `BudgetStop` — paused, partial results kept —
   and ask whether to continue (raise the ceiling for this run) or stop. Never refuse silently,
   never discard work.
5. `settle()` with provider-reported usage after every call; mark estimated figures as estimated.
6. Usage readout: per-job and per-session tokens and dollars in the job dialog and a Usage section
   in preferences.
7. Strings per §0.2 item 1.

> **Open — recommended:** ship `run.maxSessionSpendUSD` non-zero at a value the owner names, and
> keep `run.maxSpendUSD` off, so a first run can stop itself without a per-run cap the user never
> set; until the owner answers `G-20`, `P3-T32` ships `docs/07`'s current defaults (both `0`, off).
> Changes `docs/07` §8.5 (Runtime). (Review §4 item 10.)

**Do NOT.**
- Do **not** start any paid run without showing a number first.
- Do **not** persist the session counter.
- Do **not** silently apply the abstract-only downgrade.
- Do **not** treat `BudgetStop` as a failure or discard completed work.
- Do **not** restate a dollar default in code; read the prefs.
- Do **not** change a ceiling's default value (gate `G-20`).

**Done when.**
- [ ] `estimateRun()` over `docs/06` §5.4's worked example reproduces its map-phase arithmetic
      within 10 % (42 calls; the 8 synthesis calls are Phase 4's).
- [ ] Above `summary.confirmAboveUSD` the confirm button needs a second acknowledgement.
- [ ] With `run.maxSpendUSD = 0.01` the job pauses before its first call and asks; answering
      "continue" proceeds, "stop" ends it with nothing lost.
- [ ] A ceiling set mid-run pauses the job at the first call that would breach it, prior summaries
      retained.
- [ ] The session counter accumulates across two jobs and reads zero after a simulated restart.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(budget|estimate)|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```
Then stop at `G-21`: report the 3-item job's dialog contents and wait for the owner to run it.

**Notes.** Rewritten 2026-10-20 for the pause-and-ask decision; re-estimated 1.0 → 1.25 d for the
window script, its caller and the pause path, none of which the card listed. If the estimator's
error on the first real run exceeds ~25 %, that is a finding for `P3-T13`'s calibration, not a
reason to widen the gate.

---

### P3-T17 — `llm` worker pool: concurrency, cancel, pause, resume

| Field | Value |
|---|---|
| **ID** | `P3-T17` |
| **State** | `TODO` |
| **Depends on** | `P3-T05`, `P3-T06`, `P3-T32`, `P3-T34` |
| **Blocks** | `P3-T29` |
| **Retires** | part of `R-4`, part of `R-10` |
| **Implements** | `FR-23`, `NFR-6`, part of `FR-34` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Two hundred LLM calls run at a bounded, configurable concurrency, can be cancelled at item
87 without losing the first 86, and resume by skipping completed work.

**Read first.**
- `docs/07-architecture-and-data-model.md` §7.1–§7.2 — why a real queue, and the `llm` pool sized
  by `concurrency`
- `docs/07-architecture-and-data-model.md` §7.4–§7.6 — the four cancellation points; pause lets
  in-flight calls finish; checkpoints
- `docs/07-architecture-and-data-model.md` §12.3 — the summarize state machine
- `docs/03-llm-provider-integration.md` §11.6 — low concurrency and the batch wall-clock budget

**Files.**
- modify `src/core/jobQueue/queue.ts` (created by `P3-T34`)
- modify `src/core/jobQueue/cancellation.ts`
- modify `src/pipeline/shared/checkpoint.ts` (created by `P3-T34`)
- modify `src/bootstrap/registerPipelines.ts` (`buildPipelineSet` builds the existing
  `Semaphore(NETWORK_METADATA_POOL_SIZE)`; the `llm` pool is built beside it)
- create `test/unit/core/llmPool.test.ts`

**Do.**
1. Add the `llm` pool as a `Semaphore` (`src/core/concurrency.ts`) sized from `concurrency`,
   clamped 1–8, beside the network-metadata pool in `buildPipelineSet`. (There is no "zotero-write
   pool" in the tree; do not build one here.)
2. Enforce job-level concurrency: at most one `interactive` and two `background` jobs.
3. Check cancellation at the four `docs/07` §7.4 points, including inside `RateLimiter.acquire`.
4. Pause: stop dispatching, let in-flight calls finish, write a checkpoint, hold the
   `exclusivityKey`.
5. Resume by skipping: completed items are cache hits and are not re-dispatched.
6. Apply the batch wall-clock budget, surfacing "N of M completed, retry the rest?" (the number is
   `P3-T05`'s open line).

**Do NOT.**
- Do **not** use `Promise.all` over the items, abort in-flight calls on pause, or roll back written
  summaries on cancel.
- Do **not** re-enable Zotero's internal retry, give a job its own limiter, or add a second
  concurrency preference.
- Do **not** block the main thread.

**Done when.**
- [ ] A 200-item scripted run with `concurrency = 3` never has more than three calls in flight.
- [ ] Cancelling at item 87 leaves exactly 86 results and reports "cancelled at 87/200".
- [ ] Re-running dispatches exactly 114 calls.
- [ ] Pause during a call lets it finish and dispatches nothing further; resume continues.
- [ ] A cancellation while a worker waits in `RateLimiter.acquire` returns promptly.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llmPool
```

**Notes.** The queue, job record and checkpoint this card used to "modify" did not exist; `P3-T34`
now creates them.

---

### P3-T18 — Text acquisition tiers 1–2 (abstract, attachment text)

| Field | Value |
|---|---|
| **ID** | `P3-T18` |
| **State** | `TODO` |
| **Depends on** | `P3-T32` |
| **Blocks** | `P3-T19`, `P3-T27` |
| **Retires** | part of `R-19` |
| **Implements** | part of `FR-21`, part of `FR-22` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** For any Zotero item the plugin obtains the normalized abstract and, where one exists, the
attachment's full text — without re-parsing a PDF Zotero has indexed and without mutating the
library.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §3.1–§3.2 — the four-tier ladder, D-06-1, and the
  five abstract-normalization steps (keep `BACKGROUND:` / `METHODS:` labels)
- `docs/06-summarization-and-trend-report.md` §3.3.1–§3.3.4 — what does not exist
  (`getItemContent`), `attachmentText` as Tier 2, `pickTextAttachment()`, D-06-3 page truncation
- `docs/06-summarization-and-trend-report.md` §3.3.5 — the corrected D-06-4: `\f` is a guaranteed
  page boundary; **`\n` is not a guaranteed paragraph boundary** — it is per-document
- `docs/06-summarization-and-trend-report.md` §3.6 — `AcquiredSource`
- `docs/spikes/phase-0.md` `V-15` row — `attachmentText` and a fresh `getFullText` were
  byte-identical on all seven files

**Files.**
- modify `src/zotero/fulltext.ts` (the `P0-T19` spike: `getAttachmentText`, `getIndexedState`,
  `getIndexedPageCounts`, `getFullTextAllPages`; no importers today — grep before replacing)
- create `src/pipeline/summarize/acquire.ts` (caller: `summarizeItem` in `P3-T25`)
- create `src/pipeline/summarize/normalizeAbstract.ts`
- create `src/model/summary.ts`
- create `test/unit/pipeline/normalizeAbstract.test.ts`
- create `test/integration/zotero/acquireFullText.spec.ts`

**Do.**
1. Tier 1: read `abstractNote`, run the five normalization steps in order, reject anything under
   `summary.minAbstractChars` or matching a placeholder.
2. `pickTextAttachment()` per `docs/06` §3.3.3, gated on `Zotero.Fulltext.canIndex()`, in
   `src/zotero/fulltext.ts`.
3. Tier 2 through `await attachment.attachmentText` (`getAttachmentText`).
4. D-06-3: on `INDEX_STATE_PARTIAL`, re-extract with `getFullText` only when
   `total <= fullText.hardPageCap`; otherwise keep the text and set `truncated: true`.
5. Catch extraction failures (password-protected, corrupt) and demote to Tier 1 with a warning.
6. Fill `AcquiredSource`, with `contentHash` as SHA-256 over the exact text to be sent
   (`crypto.subtle`, falling back to `Zotero.Utilities.Internal.md5`; probe once).
7. Prepend the normalized abstract as a framing preamble on full-text tiers.

**Do NOT.**
- Do **not** call `getItemContent` (does not exist), `setItemContent` (a writer), or
  `Zotero.Fulltext.indexItems()` (mutates the library).
- Do **not** read `.zotero-ft-cache` or the `fulltext*` tables directly.
- Do **not** trigger a download for an attachment that is not local.
- Do **not** treat `\n` as a paragraph boundary anywhere in this card; keep the text as the
  extractor gave it (corrected D-06-4).
- Do **not** hash the file or `dateModified` for `contentHash`.

**Done when.**
- [ ] A fully indexed PDF yields Tier 2 text with zero `PDFWorker` calls.
- [ ] `INDEX_STATE_PARTIAL` under the cap triggers exactly one re-extraction; over it, none, and
      `truncated` is `true`.
- [ ] A password-protected fixture demotes to Tier 1 without throwing out of the pipeline.
- [ ] Normalization keeps `RESULTS:`, strips a trailing copyright line, rejects "No abstract
      available".
- [ ] `contentHash` changes with the text and not with `dateModified`.
- [ ] A grep test finds no `indexItems`, `setItemContent` or `getItemContent` in `src/`.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- normalizeAbstract && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Re-estimated 0.75 → 0.5 d on 2026-10-20: the four platform readers already exist in
`src/zotero/fulltext.ts`. `crypto.subtle` in the plugin scope is still **Unverified** (`docs/06`
§11.2); record what the probe finds.

---

### P3-T19 — Tiers 3–4, cleaning pass, OCR probe, language detection

| Field | Value |
|---|---|
| **ID** | `P3-T19` |
| **State** | `TODO` |
| **Depends on** | `P3-T18`, `P3-T32` |
| **Blocks** | `P3-T20`, `P3-T21`, `P3-T26` |
| **Retires** | `R-19` |
| **Implements** | `FR-21`, `FR-22` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Full text is cleaned of page furniture, references and supplements before it costs
anything; unusable extraction is flagged rather than sent; and an item with no usable text produces
a stub with no LLM call.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §3.4 — Europe PMC `fullTextXML`, the open-access gate,
  the JATS element table
- `docs/06-summarization-and-trend-report.md` §3.5 — Tier 4: a stub with no LLM call
- `docs/06-summarization-and-trend-report.md` §4.1 — the cleaning pass. **Step 4 (de-hyphenation)
  says the old rule is backwards and that a hyphenated break arrives as `word\nword`; it needs a
  real decision before shipping.** Step 8 is the OCR probe
- `docs/spikes/phase-0.md` §7 row 9 (`V-15`) — the 0.80 OCR measure spans 0.834–0.852 on real files
  and separates almost nothing; the scanned page is not the minimum; "scanned means demote" is wrong
- `docs/06-summarization-and-trend-report.md` §3.3.5 — corrected D-06-4
- `docs/06-summarization-and-trend-report.md` §4.2, §13.1, §13.5

**Files.**
- create `src/pipeline/summarize/jats.ts`
- create `src/pipeline/summarize/clean.ts`
- create `src/pipeline/summarize/languageDetect.ts`
- modify `src/pipeline/summarize/acquire.ts`
- create `test/unit/pipeline/clean.test.ts`
- create `test/unit/pipeline/jats.test.ts`
- create `test/fixtures/fulltext/` (text fixtures only; the PDFs stay out of the repository)

**Do.**
1. Tier 3: check `isOpenAccess` and `inEPMC`, fetch `fullTextXML` through the shared Europe PMC
   limiter, parse with `DOMParser`, apply the §3.4 element table.
2. Honour `fullText.preferJATS` (D-06-1), falling back to Tier 2 on any failure.
3. The §4.1 cleaning pass for Tier 2, in order: page split on `\f`, running head/foot removal,
   line-number gutters, de-hyphenation (**only as the owner decides — see the open line**),
   whitespace collapse, reference-list truncation with the 8–60 % check, supplementary removal.
4. The OCR probe: compute and record the measure and push `ocr_suspected` as `docs/06` §4.1 step 8
   then reads (see the open line before choosing to demote).
5. The §4.2 language heuristic, setting `language_non_english` above 15 %.
6. Tier 4: a stub `PaperSummary` (`sourceTier: "metadata_only"`, analytical fields `null`,
   `confidence: "none"`) and **no LLM call**.
7. The §13.1 recoveries, with write-back of a recovered abstract gated on one consent per run.

> **Open — recommended:** de-hyphenation ships as "do nothing" until a contiguous-occurrence test
> (join `word\nword` only when the joined form occurs contiguously elsewhere in the same document)
> is measured on `P3-T20`'s corpus; the old `/(\w)-[ \t]+(\w)/` rule never ships. Changes `docs/06`
> §4.1 step 4. (New finding of this revision; the review did not raise it.)

> **Open — recommended:** the OCR probe records `ocr_suspected` as a **warning only** and does not
> demote, and the two unfixed thresholds (minimum characters, letters/total) stay `PROPOSAL`
> constants, until `P3-T20`'s corpus measures values that separate; `docs/06` §4.1 step 8's 0.80 is
> replaced by the measured figure. Changes `docs/06` §4.1 step 8. (Review §4 item 13.)

**Do NOT.**
- Do **not** fetch `fullTextXML` without the open-access gate, or open a second Europe PMC pool.
- Do **not** ship any de-hyphenation regex, and in particular not `/(\w)-\n(\w)/` or
  `/(\w)-[ \t]+(\w)/`: the extractor emits `word\nword` and the old rule corrupts suspended hyphens
  ("N- and C-terminal") (`docs/06` §4.1 step 4).
- Do **not** assume `\n` is a paragraph boundary (corrected D-06-4). Line-oriented steps (running
  heads, gutters) work on lines, not paragraphs.
- Do **not** truncate references without the 8–60 % check.
- Do **not** spend an LLM call on a Tier 4 item.
- Do **not** write a recovered abstract back without consent (NFR-20).

**Done when.**
- [ ] A JATS fixture yields sectioned text with references, formulae and funding/conflict sections
      removed and captions kept.
- [ ] The cleaning pass over a two-column text fixture removes the running head from every page and
      the reference list, inside the 8–60 % band.
- [ ] A text fixture containing `"N- and C-terminal"` and `"tar\ngeted"` comes out of the cleaning
      pass with the first unchanged.
- [ ] A Korean-abstract fixture sets `language_non_english`.
- [ ] An item with no abstract and no attachment yields a Tier 4 stub with zero `mockLLM` calls.
- [ ] `fullText.preferJATS = true` with an OA item and a local PDF selects Tier 3; `false`, Tier 2.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(clean|jats|languageDetect)"
```

**Notes.** The OCR-probe criterion "a scanned fixture scores below 0.80 and demotes" was removed on
2026-10-20: `V-15` measured that it does not hold on a real scan.

---

### P3-T20 — The 40-PDF IMRaD fixture set with ground-truth labels

| Field | Value |
|---|---|
| **ID** | `P3-T20` |
| **State** | `TODO` |
| **Depends on** | `P3-T19` |
| **Blocks** | `P3-T22` |
| **Retires** | prerequisite for `R-19b` |
| **Implements** | part of `FR-22` |
| **Estimate** | 1.75 d |
| **Human gate** | **Yes** — gate `G-12`: the agent lists open-access candidate papers with a redistributable licence for the owner; the owner approves the list, **every download is asked for separately**, and the owner adjudicates the ground-truth section labels. The agent never labels, never downloads without a per-file yes, and never obtains a paywalled PDF. |

**Goal.** A committed, licence-clean, ground-truth-labelled corpus of 40 open-access papers
spanning the layouts that matter, against which the section detector is measured.

> **Decided 2026-10-20 (owner, `plan/00` §6 item 234 d):** `G-12` starts now with **open-access
> papers only**. Candidates are open-access with a **redistributable licence** (for example
> CC BY), listed for the owner; each download is asked for separately.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §4.3 final block — 40 PDFs across Elsevier,
  Springer, Wiley, OUP, PLOS, Nature, IEEE and arXiv-LaTeX, and the ≥ 85 % bar
- `docs/11-implementation-roadmap.md` §3 R-19b — why a mislabelled section is worse than none
- `docs/spikes/phase-0.md` `V-8b` row — geometry yes, font size no, a section outline and heading
  blocks; nothing measured on Elsevier, Wiley, Springer, Nature-family or Cell
- `docs/09-security-privacy-and-api-keys.md` §4.4 and §5.7 — redistribution, and that an agent may
  not scrape publisher sites
- `docs/13-testing-build-and-release.md` §3.1–§3.3 — fixture conventions and `_meta.json`

**Files.**
- create `test/fixtures/imrad/README.md`
- create `test/fixtures/imrad/candidates.md` (the candidate list the owner approves)
- create `test/fixtures/imrad/manifest.json`
- create `test/fixtures/imrad/text/` *(extracted text, one file per paper)*
- create `test/fixtures/imrad/labels/` *(ground-truth label files)*
- create `scripts/build-imrad-fixtures.ts`
- create `test/unit/pipeline/imradFixtureManifest.test.ts`

**Do.**
1. Draft the composition spec — ≥ 4 per publisher family named in §4.3, single- and two-column
   layouts, ≥ 6 preprints, a "Results and Discussion" heading and an unnumbered-heading layout —
   and a candidate list of open-access papers with their DOI, licence and source URL, in
   `candidates.md`. Stop for the owner's approval.
2. For each approved candidate, ask for the download individually; record the answer.
3. Write `scripts/build-imrad-fixtures.ts` to run each PDF through the `P3-T18`/`P3-T19` path and
   emit the extracted text (not the PDF) with a `_meta.json` sidecar (publisher, layout, DOI,
   licence, extraction date, tool version). Verify yourself whether the script can run outside
   Zotero; if it cannot, it runs in the integration harness and the README says so.
4. Define the label format over the `ImradSection` enum and ingest the owner's adjudication; record
   per paper whether it has IMRaD structure at all.
5. Record the composition and the licence of every paper in `README.md`.

> **Open — recommended:** if open-access papers with a redistributable licence cannot reach ≥ 4 per
> publisher family (IEEE and Elsevier are the likely gaps), accept the shortfall per family and
> record it rather than adding non-redistributable papers, and change the composition rule to
> match. Changes `docs/06` §4.3 final block. (Review §4 item 17.)

**Do NOT.**
- Do **not** download a file without the owner's yes for that file, or fetch from a site whose
  terms forbid it (`docs/09` §5.7).
- Do **not** commit a paper whose licence does not permit redistribution.
- Do **not** generate labels with an LLM or with the detector under test.
- Do **not** hand-edit a fixture to make the detector pass, or substitute a smaller corpus.

**Done when.**
- [ ] `manifest.json` lists 40 entries with publisher, layout, column count, preprint flag,
      licence and `hasImradStructure`, or the README records the owner-approved shortfall.
- [ ] Every fixture has a labels file; a validator asserts monotonic offsets within the text.
- [ ] `README.md` records the licence of every paper and the composition rationale.
- [ ] The build script reproduces every text file byte-identically, or the README says why not.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- imradFixtureManifest
```
Then confirm with the owner that the candidate list, each download and the 40 labellings are
theirs.

**Notes.** Estimate unchanged at 1.75 d: sourcing from open-access candidates replaces sourcing from
the owner's subscriptions, at similar developer cost. The owner's adjudication time is `G-12`'s and
is not in the figure.

---

### P3-T21 — IMRaD section detector

| Field | Value |
|---|---|
| **ID** | `P3-T21` |
| **State** | `TODO` |
| **Depends on** | `P3-T19` |
| **Blocks** | `P3-T22`, `P3-T23` |
| **Retires** | part of `R-19b` |
| **Implements** | part of `FR-22` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Sections are labelled where the source says so (JATS) and heuristically where it does not
(PDF), and the heuristic declares failure rather than guessing.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §4.3 — the `ImradSection` union, the JATS `@sec-type`
  mapping, the ordered heading table (combined "Results and Discussion" row first), and the
  "fewer than two sections → failed" rule
- `docs/06-summarization-and-trend-report.md` §3.3.5 — `getStructuredDocumentText`'s recorded
  contract (outline, heading blocks, boxes)
- `docs/spikes/phase-0.md` `V-8b` row and the §5 row for `docs/06` §3.3.5, §4.3 — **no font size or
  weight; a section outline (native bookmarks or inferred) and classified heading blocks exist;
  `style.bold` is not portable; a native outline is not better than an inferred one; block
  classification was wrong on three of four articles**

**Files.**
- create `src/pipeline/summarize/imrad.ts` (caller: `acquire.ts`)
- modify `src/pipeline/summarize/acquire.ts`
- modify `src/zotero/fulltext.ts` (a `getStructuredDocumentText` reader, if the open line is decided
  for the outline)
- create `test/unit/pipeline/imrad.test.ts`

**Do.**
1. `detectSectionsFromJats(doc)`: map `@sec-type`, fall through untyped sections to the heading
   table, drop `supplementary-material`.
2. The PDF path, per the owner's ruling on the open line below.
3. Mark a "Results and Discussion" heading as both `results` and `discussion`.
4. Return `{ sections, sectionAware }`, with `sectionAware: false` whenever fewer than two IMRaD
   sections were recognized; expose one `sectionAware` flag on `AcquiredSource`.

> **Open — recommended:** build the PDF path on `getStructuredDocumentText`'s section outline and
> heading blocks (`catalog.outline`), with the regex heading table only as the fallback for headings
> the outline does not anchor, and never on `style.bold`; re-estimate this card when the owner rules,
> since the outline path is more than the 0.5 d regex path. Changes `docs/06` §4.3 and §3.3.5.
> (Review §4 item 12.)

**Do NOT.**
- Do **not** reorder the regex table; the combined row is tested first.
- Do **not** guess a section when fewer than two are recognized.
- Do **not** key anything on `style.bold` (`V-8b`: not portable).
- Do **not** invent section types outside the union, or run the detector on Tier 1 or Tier 4 text.
- Do **not** start step 2 before the owner rules on the open line.

**Done when.**
- [ ] A JATS fixture with `@sec-type="methods"` yields a `methods` section at the right offsets.
- [ ] A "3. Results and Discussion" heading yields a section marked both `results` and
      `discussion`.
- [ ] A fixture with only a title page and body text yields `sectionAware: false`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- pipeline/imrad
```

**Notes.** This card does not claim the detector is good enough; `P3-T22` measures it.

---

### P3-T22 — Detector accuracy harness, 85 % gate, degrade switch

| Field | Value |
|---|---|
| **ID** | `P3-T22` |
| **State** | `TODO` |
| **Depends on** | `P3-T20`, `P3-T21` |
| **Blocks** | `P3-T23`, `P3-T31` |
| **Retires** | `R-19b` |
| **Implements** | `FR-22` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — gate `G-22`: if the measured accuracy is below 85 %, the owner chooses between whole-document chunking and flipping `summary.fullTextMode`'s default back to abstracts. The agent stops, reports the figure per publisher family, and waits. |

**Goal.** The detector's section-attribution accuracy is a measured number in the repository, and
below the threshold `auto` degrades to flat chunking by a switch.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §4.3 final block — the ≥ 85 % bar and the degrade
- `docs/11-implementation-roadmap.md` §3 R-19b — both exits retire the risk
- `docs/06-summarization-and-trend-report.md` §5.3 — the flat path the degrade falls back to
- `docs/12-prompt-library.md` §5 `PAPER_SUMMARY_FULLTEXT` — the section-provenance wording to
  suppress

**Files.**
- create `scripts/measure-imrad.ts`
- create `test/unit/pipeline/imradAccuracy.test.ts`
- modify `src/pipeline/summarize/imrad.ts`
- modify `src/pipeline/summarize/acquire.ts`
- create `docs/spikes/imrad-accuracy-report.md`

**Do.**
1. `scripts/measure-imrad.ts`: score section attribution per character over the fixtures, overall
   and by publisher family, column count and preprint/published; exclude and report separately the
   fixtures flagged `hasImradStructure: false`.
2. Add a constant `IMRAD_DETECTOR_VALIDATED` set from the committed measurement; when false,
   `acquire.ts` forces `sectionAware: false`.
3. Make the prompt selector drop all section-provenance language when `sectionAware` is false.
4. Commit the measurement, date, breakdown and the owner's decision to
   `docs/spikes/imrad-accuracy-report.md`.
5. Add a regression test that fails if the measured score drops below the recorded value.

**Do NOT.**
- Do **not** ship `sectionAware: true` on an unmeasured detector, or lower the threshold.
- Do **not** score papers without IMRaD structure as failures.
- Do **not** skip the harness silently in CI when the corpus is absent; skip with a reported
  reason.

**Done when.**
- [ ] The script prints the overall figure and three breakdowns and exits non-zero below 85 %.
- [ ] With `IMRAD_DETECTOR_VALIDATED = false`, a full-text acquisition returns `sectionAware:
      false` and the rendered `PAPER_SUMMARY_FULLTEXT` prompt has no section-provenance sentence.
- [ ] The regression test fails on a deliberately degraded test double.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- imradAccuracy && npx tsx scripts/measure-imrad.ts
```
Below 85 %: stop at `G-22` with the overall and per-family figures.

**Notes.** If the owner reverts the default, that changes D7 and therefore `docs/00` §3, `docs/06`
§5.4 and `docs/07` §8.5 — the owner's document change, not a quiet code change.

---

### P3-T23 — Chunker: section-aware, flat, and single-shot paths

| Field | Value |
|---|---|
| **ID** | `P3-T23` |
| **State** | `TODO` |
| **Depends on** | `P3-T13`, `P3-T21`, `P3-T22` |
| **Blocks** | `P3-T25` |
| **Retires** | part of `R-19` |
| **Implements** | part of `FR-22`, part of `FR-34` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Any acquired text becomes either one single-shot call or a labelled chunk sequence that
fits the model's window, with the right things dropped first under budget pressure.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.3 — the three paths, section ordering, budget
  shares, within-section-only overlap, chunk labels, the single-shot short-circuit
- `docs/06-summarization-and-trend-report.md` §5.2 and §5.1 D-06-5 — the budget inequality and the
  1.15× / +800 reserve
- `docs/06-summarization-and-trend-report.md` §3.3.5 — **corrected D-06-4: `\f` is a page boundary;
  `\n` is not a guaranteed paragraph boundary** (segment shares from 0.85 down to 0.00 across seven
  files). §5.3 step 3 still says "`\n`, guaranteed by D-06-4" and is stale
- `docs/06-summarization-and-trend-report.md` §13.5 — halve and retry once on context length

**Files.**
- create `src/llm/shared/chunking.ts` (caller: `summarizeItem` in `P3-T25`)
- modify `src/pipeline/summarize/acquire.ts`
- create `test/unit/llm/chunking.test.ts`

**Do.**
1. `planChunks(source, model, promptId)` → `{ kind: "single-shot" }` or `{ kind: "chunked", chunks }`;
   prefer single-shot whenever the cleaned text fits the `PAPER_SUMMARY_FULLTEXT` budget.
2. Section-aware path: order sections by synthesis value, allocate §5.3's shares, drop the
   lowest-value sections first.
3. Within a section, find paragraph units per the open line below, pack greedily, and split on
   sentence boundaries only when one unit exceeds the budget.
4. Carry ≤ 250 tokens of overlap from chunk *i* to *i+1* only within a section; label every chunk
   `[SECTION: x] [CHUNK i/n] [PAPER: itemKey ...]`.
5. Flat path: pack in document order, overlap between all adjacent chunks, label `unknown`.
6. Check the §5.2 inequality with the D-06-5 multiplier and reserve; on
   `ContextLengthExceededError` halve the budget for that paper and retry once.

> **Open — recommended:** measure each document before packing — when the share of characters in
> `\n`-delimited segments of ≥ 200 characters is high, treat `\n` as a paragraph boundary; when it is
> low, treat `\n` as a line break and pack by sentence — with the cut-off set from `P3-T20`'s corpus,
> not invented here. Changes `docs/06` §5.3 step 3. (Review §4 item 14.)

**Do NOT.**
- Do **not** assume `\n` marks a paragraph (corrected D-06-4); do not add a blank-line heuristic
  either — measure the document.
- Do **not** overlap across a section boundary, or chunk in document order on the section-aware
  path.
- Do **not** chunk text that fits single-shot.
- Do **not** omit the D-06-5 multiplier or the 800-token reserve, or retry a context-length error
  unchanged.
- Do **not** emit a section label other than `unknown` when `sectionAware` is false.

**Done when.**
- [ ] A 9 000-token text with a 24 000-token budget yields one single-shot plan.
- [ ] A 60 000-token text's per-section shares match §5.3 within 5 %.
- [ ] Reassembling the chunks minus overlap reproduces each section's text.
- [ ] No overlap crosses a section boundary.
- [ ] A hard-wrapped fixture (one `\n` per printed line) is not split mid-sentence at every line.
- [ ] A simulated `ContextLengthExceededError` triggers exactly one halved retry, then propagates.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/chunking
```

**Notes.** Step 3 depends on the open line; steps 1–2 and 4–6 do not.

---

### P3-T24 — Prompt registry with versioned prompt files

| Field | Value |
|---|---|
| **ID** | `P3-T24` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T25`, `P3-T26`, `P3-T27` |
| **Retires** | part of `R-6` |
| **Implements** | part of `FR-19`, part of `FR-21` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Prompts are versioned data files validated at load, shipped in the bundle, and their
version strings are available for the cache key.

> **Changed 2026-10-20 (owner, `plan/00` §6 item 234 b):** this card starts **without its old step
> 7** (the startup comparison against `cache.lastSeenPromptVersions` and the
> `invalidateByTag('promptVersion:<old>')` call). That step moved to `P3-T26`, after the Cache layer
> exists.

**Read first.**
- `docs/12-prompt-library.md` §17.2, §17.3, §17.5 — version semantics, the front-matter fields and
  load-time validation, and never mutating a released file
- `docs/12-prompt-library.md` §3–§7 — `RELEVANCE_SCREEN`, `PAPER_SUMMARY_ABSTRACT`,
  `PAPER_SUMMARY_FULLTEXT`, `CHUNK_MAP`, `CHUNK_REDUCE`
- `docs/12-prompt-library.md` §1.1 — the untrusted-input boundary
- `docs/06-summarization-and-trend-report.md` §11.1 and §5.2 — temperatures and `max_tokens`
- `zotero-plugin.config.ts` — `assets` copies only `addon/**/*.{js,json,ftl,png,xhtml,css}`, and
  the esbuild options set no loader for `.md`

**Files.**
- create `src/prompts/index.ts` (callers: `summarizeItem` in `P3-T25`, `relevanceScreen` in
  `P3-T27`)
- create `src/prompts/paper-summary-abstract.v1.0.0.md`
- create `src/prompts/paper-summary-fulltext.v1.0.0.md`
- create `src/prompts/chunk-map.v1.0.0.md`
- create `src/prompts/chunk-reduce.v1.0.0.md`
- create `src/prompts/relevance-screen.v1.0.0.md`
- create `src/prompts/schemas/paper-summary.v1.json`
- modify `zotero-plugin.config.ts` (how the `.md` files reach the bundle — see the open line)
- create `typings/prompts.d.ts` (a module declaration for `*.md`, if the open line chooses a loader)
- create `test/unit/prompts/registry.test.ts`

**Do.**
1. Transcribe the five prompts from `docs/12` §3–§7 verbatim into versioned files with the §17.3
   front matter.
2. Copy the `PaperSummary` v1 schema from `docs/06` §6.2 unchanged.
3. The registry: parse front matter, expose `{ id, version, cacheEpoch, system, user, schema,
   defaultTemperature, defaultMaxTokens }`, render `{{PLACEHOLDER}}`s.
4. Validate at load: a version, a positive integer `cacheEpoch`, every placeholder declared and
   every declared variable used; a malformed file fails the build.
5. Temperatures and `max_tokens` from `docs/06` §11.1 and §5.2; `RELEVANCE_SCREEN` from `docs/12`
   §3 (`max_tokens` derived per call from the batch size).
6. Export `PROMPT_VERSIONS` for `P3-T26`.
7. Make the `.md` files reach the bundle per the open line, and prove it on the built artifact.

> **Open — recommended:** add an esbuild text loader for `.md`
> (`loader: { ".md": "text" }` in `zotero-plugin.config.ts`'s `esbuildOptions`) and a
> `declare module "*.md"` typing, so prompts are imported as strings and bundled into the one
> script — rather than adding `.md` to `assets`, which would also ship `addon/content/icons/README.md`
> (the config's own comment). Changes `docs/12` §17.3. (Review §4 item 20.)

**Do NOT.**
- Do **not** scatter prompt text as string literals, mutate a released prompt file, or write
  per-provider variants.
- Do **not** interpolate per-paper content into the system message.
- Do **not** add a field to `PaperSummary` here.
- Do **not** implement the cache invalidation (old step 7) here; it is `P3-T26`'s.
- Do **not** widen `assets` to `**/*.md`.

**Done when.**
- [ ] All five prompt files load; an undeclared placeholder, `cacheEpoch: 0` or a missing
      `version` fails.
- [ ] `paper-summary.v1.json` is byte-identical to `docs/06` §6.2's block, asserted by a test.
- [ ] Rendering `PAPER_SUMMARY_ABSTRACT` with a fixture leaves no `{{`.
- [ ] `npm run build` produces a bundle in which the registry loads all five prompts (asserted on
      the built script or by an integration check).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- prompts/registry && npm run build
```

**Notes.** `docs/12` §17.6's "keep using cached summaries from the previous prompt version" opt-in
belongs with the cache surface; raise it then rather than shipping a silent bulk invalidation.

---

### P3-T25 — Per-paper summarizer, DR-1, and the grounding check

| Field | Value |
|---|---|
| **ID** | `P3-T25` |
| **State** | `TODO` |
| **Depends on** | `P3-T12`, `P3-T16`, `P3-T23`, `P3-T24`, `P3-T26`, `P3-T32`, `P3-T36` |
| **Blocks** | `P3-T28`, `P3-T29` |
| **Retires** | part of `R-6`, part of `R-19` |
| **Implements** | `FR-19`, `FR-21`, `FR-22` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** One item in, one validated `PaperSummary` out — grounded against its own source text and
recorded as a redaction-gated `StoredSummary` row.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.4 DR-1 — four conditions; condition 4 is a cost
  gate
- `docs/06-summarization-and-trend-report.md` §6.2–§6.3 — the schema and the `itemKey` overwrite
- `docs/06-summarization-and-trend-report.md` §12.1 L3 — `checkGrounding` and the `< 0.5` policy
- `docs/06-summarization-and-trend-report.md` §11.1 — temperature 0, `top_p: 1`, seed, dated model
- `docs/07-architecture-and-data-model.md` §5.2 — `StoredSummary`; its `id` is not the cache key
- `docs/07-architecture-and-data-model.md` §8.3 — the `summary` table DDL

**Files.**
- create `src/pipeline/summarize/summarizeItem.ts` (caller: `summarizePipeline.ts`, `P3-T29`; and
  the item pane's Generate, `P3-T28`)
- create `src/pipeline/summarize/grounding.ts`
- modify `src/model/summary.ts`
- modify `src/zotero/db.ts` (a `summary` store)
- modify `src/bootstrap/migrations.ts` (the `summary` table, next free version)
- modify `test/unit/core/provenanceRerun.test.ts`
- modify `test/integration/zotero/provenanceStore.spec.ts`
- create `test/unit/pipeline/summarizeItem.test.ts`
- create `test/unit/pipeline/grounding.test.ts`

**Do.**
1. DR-1 as a pure function over the acquired source, the mode-limited `summary.fullTextMode` and
   the run's cost decision; condition 3 enforced in `auto`, skipped in `always`.
2. Call through `completeJSON()` at temperature 0, `top_p: 1`, seed where supported.
3. Overwrite `itemKey` with the true key; warn on a mismatch.
4. Check the §18.4 invariants (numerals in `effectSizes[].value` and `population.size` appear in
   the source).
5. `checkGrounding()` exactly per §12.1; below 0.5 on full text, retry once; still low, set
   `confidence: "low"` and record that `keyFindings` are excluded from synthesis.
6. Persist a `StoredSummary` row through the `P3-T36` gate, with `inputScope`, prompt and model
   identity, `usage`, `contentHash`, `truncated`, `groundingScore` and `warnings`.
7. Route the chunked path through `CHUNK_MAP` then `CHUNK_REDUCE`.
8. Add the `summary` table as the next migration (§0.2 item 4).

> **Open — recommended:** create `summary` without the `REFERENCES work(work_key)` clause, because
> no phase writes the `work` table yet and it is unverified whether `Zotero.DBConnection` enforces
> foreign keys; add the clause in the migration that first populates `work`. Changes `docs/07` §8.3
> (the `summary` DDL). (Review §2a item 4.)

**Do NOT.**
- Do **not** send a Tier 4 item to a model, trust the model's `itemKey`, or recompute an effect
  size.
- Do **not** add a field to `PaperSummary` or create a third summary shape.
- Do **not** persist `deriveTldr()`'s output, or use `StoredSummary.id` as the cache key.
- Do **not** use a floating model alias.
- Do **not** claim section provenance when `sectionAware` is false, or put paper content in the
  system message.
- Do **not** add a redaction rule; persist through the gate.

**Done when.**
- [ ] Every returned `PaperSummary` validates against `paper-summary.v1.json`.
- [ ] DR-1 picks the abstract when the full text is under 3× the abstract in `auto`, and full text
      in `always`.
- [ ] A mismatched `itemKey` is corrected with exactly one warning.
- [ ] `checkGrounding()` returns 1.0 for present spans and < 0.5 for absent ones; the low case
      retries exactly once, then stores `confidence: "low"` with a warning.
- [ ] The stored `contentHash` equals the hash of the text actually sent.
- [ ] The system message is byte-identical across two items in one run.
- [ ] A stored row passed through the gate contains no synthetic key planted in a warning.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(summarizeItem|grounding)|provenanceRerun" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Re-estimated 1.0 → 1.25 d on 2026-10-20 for the `summary` migration (and the two tests
that pin the schema version) and the redaction-gated persistence.

---

### P3-T26 — Summary cache keyed per `docs/06` §11.2

| Field | Value |
|---|---|
| **ID** | `P3-T26` |
| **State** | `TODO` |
| **Depends on** | `P3-T19`, `P3-T24`, `P3-T32`, `P3-T33` |
| **Blocks** | `P3-T25` |
| **Retires** | part of `R-4` |
| **Implements** | part of `FR-19`, part of `FR-23` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A summary is never paid for twice and never served from a cache that no longer describes
what would be produced today; a prompt-version change invalidates exactly its entries.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §11.2 — the component list and why each is
  load-bearing
- `docs/07-architecture-and-data-model.md` §9.1–§9.4 — `summaryKey()`, `stableStringify`,
  `CACHE_SCHEMA_VERSION`, the `summary` namespace, the tags, the four invalidation triggers
- `docs/07-architecture-and-data-model.md` §8.5 — `cache.enabled`, `cache.ignoreModel`,
  `cache.lastSeenPromptVersions`

**Files.**
- modify `src/core/cache/keys.ts` (created by `P3-T33`; add `summaryKey`)
- create `src/pipeline/summarize/summaryCache.ts` (caller: `summarizeItem`, `P3-T25`)
- modify `src/bootstrap/container.ts` (the startup prompt-version comparison runs once, after the
  Cache is built)
- create `test/unit/core/summaryKey.test.ts`

**Do.**
1. `summaryKey()` over exactly the §11.2 components, hashed with `stableStringify` and prefixed
   with `CACHE_SCHEMA_VERSION`.
2. Tag every entry `promptVersion:`, `model:`, `provider:`, `work:` and `schema:`.
3. `cache.ignoreModel`: omit the model component and surface the mixed-generations warning.
4. Store the payload with its `meta` block inside the cached object.
5. **Moved here from `P3-T24` step 7:** at startup, compare `PROMPT_VERSIONS` with
   `cache.lastSeenPromptVersions`, call `invalidateByTag('promptVersion:<old>')` for each change,
   then write the new set once.
6. Honour `cache.enabled`.

**Do NOT.**
- Do **not** key on `dateModified` or the file; omit `tier`, the prompt version or the schema
  version; or hash without `stableStringify`.
- Do **not** reuse `StoredSummary.id` as the key.
- Do **not** delete Zotero notes on invalidation, or evict an entry whose work belongs to a running
  job.
- Do **not** put a cached summary in `Zotero.Prefs`.

**Done when.**
- [ ] Two runs over an unchanged item produce a hit and zero LLM calls on the second.
- [ ] Changing only the acquired text, tier, prompt version, schema version, provider, model or
      temperature each produces a miss.
- [ ] `cache.ignoreModel = true` hits across a model change and surfaces the warning.
- [ ] A prompt-version change invalidates by tag once and leaves Zotero notes intact.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- summaryKey
```

**Notes.** Estimate unchanged: the cache layer itself moved to `P3-T33`, and step 5 moved in.

---

### P3-T27 — Screening: retractions, non-English, duplicates, relevance

| Field | Value |
|---|---|
| **ID** | `P3-T27` |
| **State** | `TODO` |
| **Depends on** | `P3-T12`, `P3-T18`, `P3-T24`, `P3-T32`, `P3-T35` |
| **Blocks** | `P3-T29` |
| **Retires** | part of `R-6` |
| **Implements** | part of `FR-19`, part of `FR-21` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Retracted, non-English and duplicate items are handled by policy before they contribute a
finding, and search results can be scored for relevance in cheap batches with a per-run threshold.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §13.2–§13.4 — non-English policies, retraction
  layers and policy (`isRetracted` is synchronous and free), duplicate detection without
  `Zotero.Duplicates`
- `docs/12-prompt-library.md` §3 — `RELEVANCE_SCREEN` batching and handling rules
- `docs/07-architecture-and-data-model.md` §8.5 — the `screening.*` rows; `screening.threshold` is a
  per-run control in the Search & Import window, not the pane
- `src/sources/shared/dedupe.ts` — the shipped matcher; `P2-T13` is tuning its thresholds

**Files.**
- create `src/pipeline/summarize/screen.ts` (caller: `summarizePipeline.ts`, `P3-T29`)
- create `src/pipeline/shared/relevanceScreen.ts` (caller: a screening stage in the search
  pipeline — a guess: verify that `docs/08` §4.2 and `docs/12` §3 place screening there, and stop if
  they do not)
- modify `src/pipeline/searchImport/stages.ts` (the screening stage)
- modify `src/pipeline/searchImport/searchImportPipeline.ts` (`run` calls the stage; the `P2-T27`
  lesson — a stage nothing calls changes nothing)
- modify `test/unit/pipeline/searchImport.test.ts`
- modify `src/zotero/zoteroApi.ts` (`Zotero.Retractions` reads)
- modify `src/ui/dialogs/searchDialog.ts`
- modify `src/ui/viewModels/searchImportViewModel.ts`
- modify `addon/content/searchDialog.xhtml`
- modify `addon/content/searchDialog.js`
- modify `src/i18n/keys.ts`
- modify `addon/locale/en-US/research-helper-searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper-searchDialog.ftl`
- create `test/unit/pipeline/screen.test.ts`
- create `test/unit/pipeline/relevanceScreen.test.ts`
- modify `test/unit/ui/searchImportViewModel.test.ts`
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. `Zotero.Retractions.isRetracted(item)` on every item; reason text for the appendix.
2. Crossref `updated-by` and PubMed `pubtype` checks only from responses already fetched.
3. Apply `screening.retractionPolicy`, recording the count.
4. Apply `screening.nonEnglishPolicy` to `language_non_english` items (`translate_summary`: summarize
   in the source language, emit English, add `source_language`, cap `confidence` at `medium`).
5. Collection-scoped duplicate detection per §13.4, recording `duplicate_of:KEY`.
6. `RELEVANCE_SCREEN` batching: 10–20 per call under the token cap; re-run a batch once on a dropped
   or invented id, then per-item calls.
7. Resolve the screening model through the router's screening chain (`P3-T06`).
8. Seed the Search & Import window's threshold control from `screening.threshold` on demand, keep
   per-run changes in the run's options object, and treat `0` as "score everything, filter
   nothing"; show the count of excluded items.
9. Strings per §0.2 item 1 (search-dialog bundle).

**Do NOT.**
- Do **not** delete a retracted item, exclude an expression of concern, or let a retracted paper
  contribute a finding.
- Do **not** use `Zotero.Duplicates`.
- Do **not** translate then summarize.
- Do **not** hard-filter silently, drop `isPrimaryResearch: false` items, or restate the `60`
  default in code.
- Do **not** change `src/sources/shared/dedupe.ts`'s thresholds; reuse its functions as they stand.

**Done when.**
- [ ] A fixture item reported retracted is excluded from synthesis, kept, and counted.
- [ ] An expression-of-concern fixture is annotated, not excluded.
- [ ] A Korean-abstract fixture under `translate_summary` yields English with `source_language: ko`
      and `confidence` ≤ `medium`.
- [ ] A preprint/published pair is detected and the published version kept.
- [ ] A batch dropping one candidate triggers one re-run, then per-item calls.
- [ ] The threshold control opens at the pref's value, a per-run change does not write the pref,
      and `0` imports every candidate with every score recorded.
- [ ] A grep test finds no `Zotero.Duplicates`.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(screen|relevanceScreen)|searchImportViewModel|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Re-estimated 0.75 → 1.0 d on 2026-10-20 for the search-window control (markup, script,
view model, strings) the card named only as `searchDialog.ts`. The `screening.threshold` row is
`P3-T32`'s. Hold this card until `P2-T13`'s threshold tuning has landed (review §5).

---

### P3-T28 — Item-pane AI summary section

| Field | Value |
|---|---|
| **ID** | `P3-T28` |
| **State** | `TODO` |
| **Depends on** | `P3-T25`, `P3-T32`, `P3-T35` |
| **Blocks** | `P3-T31` |
| **Retires** | none |
| **Implements** | part of `FR-19`, part of `FR-20`, part of `FR-33` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Selecting an item shows its summary if one exists, an honest empty state if not, and a
Generate button that costs nothing until pressed.

**Read first.**
- `docs/08-ui-ux-spec.md` §3.1–§3.3 — the `registerSection` options, both required icons, the
  props table (`refresh` exists only in `onInit`), the seven-state behaviour table, and the
  `bodyXHTML` caveats
- `docs/07-architecture-and-data-model.md` §5.2 — `deriveTldr()` is derived, never persisted
- `docs/07-architecture-and-data-model.md` §8.5 — `autoSummarize` ships off
- `eslint.config.js` `REGISTRATION_APIS` comment — `registerSection` is deliberately absent today

**Files.**
- modify `src/zotero/registrations.ts` (add an item-pane-section factory that pairs
  `registerSection` with its teardown)
- modify `eslint.config.js` (add `ItemPaneManager.registerSection` to `REGISTRATION_APIS`)
- create `src/ui/panes/summarySection.ts`
- modify `src/bootstrap/registerUI.ts` (registers the section through the new factory and a
  `notifierRegistration` observer)
- modify `src/i18n/keys.ts`, `addon/locale/en-US/research-helper-mainWindow.ftl`,
  `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/integration/zotero/summarySection.spec.ts`
- modify `test/integration/lifecycle.spec.ts` (the disable/enable cycle leaves no section)
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. Add the section factory to `src/zotero/registrations.ts` and the API to `REGISTRATION_APIS`, so
   a bare `registerSection` is a lint error everywhere else.
2. Register the section with both icons and a `paneID` that does not collide with the built-ins.
3. Capture `refresh` in `onInit`; hide the section for non-regular items in `onItemChange`; keep
   `onRender` synchronous and do I/O in `onAsyncRender`.
4. Render the seven states, with `deriveTldr(stored.content)` (~60 characters) in the collapsed
   header.
5. No-key state: a Preferences link and a disabled Generate button.
6. A `Notifier` observer for item delete/trash calling `cache.invalidateByTag('work:<key>')`,
   registered through `notifierRegistration` and removed in teardown.
7. "Save as child note" only as an explicit user action.
8. Strings per §0.2 item 1.

**Do NOT.**
- Do **not** call `Zotero.ItemPaneManager.registerSection` outside `src/zotero/registrations.ts`.
- Do **not** destructure `refresh` from button props, or do I/O in `onRender`.
- Do **not** ship `autoSummarize` on, persist `deriveTldr()`'s output, or write a note
  automatically.
- Do **not** expect `<script>` in `bodyXHTML` to run.

**Done when.**
- [ ] A note, an attachment or an annotation hides the section.
- [ ] An item with a stored summary renders its fields, model and timestamp, with the derived gist.
- [ ] With no key, Generate is disabled, the Preferences link is present, and zero requests are made.
- [ ] Changing selection across 20 items issues zero LLM calls with `autoSummarize` off.
- [ ] Five disable/enable cycles leave no section and no notifier observer.
- [ ] A bare `registerSection` call outside `registrations.ts` fails `npm run lint:check`.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- keys && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Re-estimated 0.5 → 0.75 d on 2026-10-20 for the registration factory, the lint entry and
the lifecycle assertion. The section shares `item-details` with the reader context pane; use
`tabType` if the layouts must differ.

---

### P3-T29 — Summarize-collection pipeline, notes, remove-notes command

| Field | Value |
|---|---|
| **ID** | `P3-T29` |
| **State** | `TODO` |
| **Depends on** | `P3-T16`, `P3-T17`, `P3-T25`, `P3-T27`, `P3-T32`, `P3-T35` |
| **Blocks** | `P3-T31` |
| **Retires** | part of `R-6` |
| **Implements** | `FR-19`, `FR-20`, `FR-23`, `FR-53` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** "Summarize collection…" runs end to end from the collection menu with a pre-flight gate,
per-item progress, cancellation and resume — and everything it writes is labelled and removable in
one command.

**Read first.**
- `docs/07-architecture-and-data-model.md` §12.3 — every summarize state and transition
- `docs/08-ui-ux-spec.md` §6.1, §6.4 and §8.2.1 — the stages, the progress rows, and not using
  `Zotero.ProgressQueue`
- `docs/10-requirements-and-user-stories.md` FR-20, FR-21 — tags, disclaimer line, provenance
  header, the removal command's exact count
- `docs/06-summarization-and-trend-report.md` §14.2 — note writing (`libraryID` before parent)
- `docs/07-architecture-and-data-model.md` §8.5 — `report.perPaperNotes` ships off
- `src/ui/menus/registerMenus.ts` — the collection submenu `rh-menu-collection` already exists
  (`collectionMenuOptions`); add entries there, do not create a second menu

**Files.**
- create `src/pipeline/summarize/summarizePipeline.ts`
- modify `src/pipeline/registry.ts` (`PipelineSet` gains `summarize`)
- modify `src/bootstrap/registerPipelines.ts` (`buildPipelineSet` constructs it)
- modify `src/zotero/notes.ts` (the summary-note writer and the removal command)
- modify `src/ui/menus/registerMenus.ts` (two entries in `rh-menu-collection`)
- create `src/ui/dialogs/summarizeDialog.ts`
- create `addon/content/summarize.xhtml`
- create `addon/content/summarize.js`
- modify `src/bootstrap/registerUI.ts` (the dialog opener)
- modify `src/i18n/keys.ts`, `addon/locale/en-US/research-helper-mainWindow.ftl`,
  `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/pipeline/summarizePipeline.test.ts`
- create `test/integration/zotero/removeGeneratedNotes.spec.ts`
- modify `test/integration/menus.spec.ts` (menu item counts)
- modify `test/integration/lifecycle.spec.ts` (menu item counts)
- modify `test/unit/i18n/keys.test.ts`

**Do.**
1. Stages: collect regular items, probe the cache, plan the input scope under the privacy policy,
   estimate, confirm (`P3-T16`), summarize under the `llm` pool (`P3-T17`), write notes.
2. Skip items that already have a summary by default, with "Re-summarize existing".
3. Before dispatch, when the `SecretStore` is not `unattended` and the key is absent, pause the job
   with `credential-required` (`P3-T03`'s session tier) rather than failing.
4. Per-item progress in the dialog's own status list with cached/new counts, skip reasons and
   Cancel.
5. Per-paper notes behind `report.perPaperNotes` with the FR-20 disclaimer, the
   `research_helper/ai-summary` tag plus a provider/model tag, and the FR-21 provenance header.
6. "Remove generated notes from collection": only notes in the `research_helper/` tag namespace,
   confirmed with the exact count.
7. End-of-job counts: full text used, fell back to abstract, skipped no text, skipped retracted,
   skipped duplicate.
8. Detect `library.editable` before offering to save; fall back to export.
9. Strings per §0.2 item 1.

> **Open — recommended:** read the definition-of-done line "cancelling at 87/200 retains 86 notes"
> as "retains 86 `StoredSummary` rows, and 86 notes when `report.perPaperNotes` is on", because
> notes are opt-in (`docs/10` §5 question 3). Changes `docs/11` §1 Phase 3 definition of done.
> (Review §4 item 9; the same line sits on `P3-T31`.)

**Do NOT.**
- Do **not** write a note for an item with no summary, or fabricate one from a title.
- Do **not** delete notes outside the `research_helper/` namespace, or delete notes on a cache
  clear.
- Do **not** roll back on cancel, write per-paper notes by default, or set `parentKey` before
  `libraryID`.
- Do **not** emit one error row per item on an outage; above 30 % failures stop with one message.
- Do **not** run the job from a modal dialog, or mutate user-authored data.

**Done when.**
- [ ] A 200-item scripted run writes notes only for summarized items and reports the five counts.
- [ ] Every written note carries both tags, the disclaimer first line and the provenance line for
      the tier used.
- [ ] Removal over one user note and 40 generated notes confirms "40" and deletes exactly those.
- [ ] Cancel at 87 of 200 keeps 86 summaries; the re-run skips them and issues 114 calls.
- [ ] A session-tier store with no key pauses the job with `credential-required` and zero requests.
- [ ] A read-only group library offers export instead of note saving.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "summarizePipeline|keys" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Re-estimated 1.0 → 1.25 d on 2026-10-20 for the `PipelineSet` member, the dialog's
window, and the menu-count specs the card did not list. `collectionMenu.ts` is not created: the
collection submenu exists in `registerMenus.ts`.

---

### P3-T30 — LLM fixtures and contract tests

| Field | Value |
|---|---|
| **ID** | `P3-T30` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T11`, `P3-T12` |
| **Blocks** | `P3-T31` |
| **Retires** | part of `R-5`, part of `R-13` |
| **Implements** | part of `NFR-16`, part of `FR-34` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — recording LLM fixtures makes live, paid calls with real keys. The agent writes the recorder and the scenario list and states the expected spend per provider (the forty scenarios on the cheapest model, expected under $1 in total); the owner approves that spend and runs the recording with their own keys set in the process environment for that one session (or read from the OS keystore). The agent never holds a key and never runs live mode. |

**Goal.** Every adapter's request shape and response parsing is asserted against committed,
redacted fixtures, and the whole contract suite runs offline at zero cost.

**Read first.**
- `docs/13-testing-build-and-release.md` §3.1 "LLM providers" — the ten fixtures per provider
- `docs/13-testing-build-and-release.md` §2.2 — record/replay, `fixtureKey`, the missing-fixture
  message, snapshot versus parsing tests
- `docs/13-testing-build-and-release.md` §3.2 — the recorder reads **no credential from any file**,
  the mandatory redaction pass that aborts on a surviving key, response bodies only for LLM
- `scripts/record-fixtures.ts` header — `FIXTURE_MODE`, dry run as the default
- `.env.example` — "NEVER put an API key here"

**Files.**
- modify `test/contract/_transport.ts` (the LLM fixture key shape)
- create `test/contract/llm/openrouter.contract.test.ts`
- create `test/contract/llm/openai.contract.test.ts`
- create `test/contract/llm/anthropic.contract.test.ts`
- create `test/contract/llm/gemini.contract.test.ts`
- modify `scripts/record-fixtures.ts` (the LLM scenario list)
- modify `test/unit/scripts/recordFixturesRedaction.test.ts`
- create `test/fixtures/llm/openrouter/`, `test/fixtures/llm/openai/`, `test/fixtures/llm/anthropic/`,
  `test/fixtures/llm/gemini/`
- modify `.github/workflows/ci.yml`

**Do.**
1. Extend the replay transport for LLM fixture keys, with the missing-fixture error that prints the
   record command.
2. Add the versioned LLM scenario list to `scripts/record-fixtures.ts`. Keys come **only** from the
   process environment set for one recording session, or from the OS keystore — never from `.env`
   or any file — and only in live mode, which defaults off.
3. Run the existing mandatory redaction pass before writing, strip key-like values, and abort the
   recorder if any output still matches a `KEY_PATTERNS` entry or the session's key deny-list.
4. Write a `_meta.json` sidecar per fixture.
5. Wire-shape snapshot tests per adapter, and response-parsing tests over the recorded bodies.
6. The staleness assertion: warn above 180 days, fail above 365.
7. Wire the contract suite into CI with the replay transport only.
8. Stop at the gate: report the scenario list and the expected spend; the owner records.

> **Open — recommended:** the owner records the LLM fixtures, with each key set in the process
> environment for that one session only (or read from the OS keystore by a recorder run inside
> Zotero), at a spend stated before the run; `docs/13` §3.2's "scenarios run unauthenticated"
> gains an LLM exception saying exactly that. Changes `docs/13` §3.2. (Review §4 item 15. The review
> said §3.2 "still says `.env`"; it does not — it was corrected on 2026-10-15 — but it has no
> answer for an LLM, which cannot be called unauthenticated.)

**Do NOT.**
- Do **not** read a key from `.env`, `.env.example`, a fixture, a pref or any file.
- Do **not** run the recorder's live mode (`FIXTURE_MODE=record`) yourself, and never under
  `test:contract`; the contract suite must fail, not fall through to the network, when a fixture is
  missing.
- Do **not** commit an unredacted fixture, record LLM request bodies, or hand-edit a fixture.
- Do **not** assert generated-text quality here.
- Do **not** put a real key in CI secrets used by the blocking suite.

**Done when.**
- [ ] The four contract files exist and pass offline against committed fixtures (hand-built ones
      are acceptable until the owner records).
- [ ] Running the recorder over a body containing a synthetic key aborts non-zero and writes nothing.
- [ ] Deleting a fixture fails the suite with the record command and no network access.
- [ ] Each adapter has a committed request-body snapshot.
- [ ] A synthetic sidecar older than 365 days fails the suite.
- [ ] A test asserts the recorder reads no key from any file path.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recordFixturesRedaction && npm run test:contract
```
Then stop at the gate with the scenario list and expected spend.

**Notes.** Rewritten 2026-10-20: the card used to say "reading keys from `.env`", which contradicted
D5, `.env.example` and the recorder's own header, and it had no gate although recording spends
money. The `error-429` scenario is recorded twice (with and without `Retry-After`).

---

### P3-T31 — Phase-3 acceptance run against the definition of done

| Field | Value |
|---|---|
| **ID** | `P3-T31` |
| **State** | `TODO` |
| **Depends on** | `P3-T14`, `P3-T22`, `P3-T28`, `P3-T29`, `P3-T30`, `P3-T37` |
| **Blocks** | none |
| **Retires** | closes `R-4`, `R-5`, `R-9`, `R-19`, `R-19b`; part of `R-6` |
| **Implements** | `NFR-4`, `NFR-5`, `NFR-16`, `FR-23`, `FR-24` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — gates `G-18` and `G-21`: this run spends real money on four providers (expected under $2 in total: a 100-abstract job on the cheapest capable model per provider plus one 3-item full-text job). The owner enters the keys, approves the estimate from `P3-T16`'s dialog before dispatch, and runs the key-prefix check (step 6). |

**Goal.** Every line of the phase definition of done is demonstrated on a real Zotero profile, and
the result is recorded.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 3 "Definition of done"
- `docs/10-requirements-and-user-stories.md` NFR-4, NFR-16
- `docs/13-testing-build-and-release.md` §8.4 "LLM layer" — the manual QA items
- `docs/09-security-privacy-and-api-keys.md` §7 — the implementer's security checklist

**Files.**
- create `docs/spikes/phase-3-acceptance-report.md`
- create `test/integration/pipeline/phase3Acceptance.spec.ts` (live parts behind `RH_DOD_LIVE`)
- create `scripts/key-leak-count.ts` (prints only match counts; see step 6)

**Do.**
1. Ask the owner to configure all four providers and confirm each with Test (`G-18`).
2. Run the same item through all four providers and show that only the adapter differs.
3. State the 100-abstract job's estimate and stop for approval (`G-21`); then record wall-clock time
   against NFR-4 and actual usage against the estimate.
4. Set `run.maxSpendUSD` to `0.01` and confirm the job pauses before the first item and asks.
5. Run a 200-item job on the mock provider, cancel at item 87, confirm 86 are retained and the
   re-run resumes correctly.
6. **Key-leak check, never by the agent holding key characters:** the owner runs
   `scripts/key-leak-count.ts`, which reads each configured key inside Zotero from the keystore and
   prints only the number of matches of its first eight characters in the debug log and every
   written note — never the key, never a prefix. The agent reads only the counts.
7. Confirm the IMRaD outcome: measured ≥ 85 % with `sectionAware` on, or the degrade active.
8. Run the `docs/09` §7 checklist for credential storage, key hygiene and data egress.
9. Record every figure and the spend in `docs/spikes/phase-3-acceptance-report.md`. The `plan/00`
   state column is the coordinator's (`npm run index:derive`), not this card's.

> **Open — recommended:** narrow the definition-of-done line to "no key appears in the debug log or
> in a note" for Phase 3, and check "copied diagnostics" in Phase 7 when the debug bundle and
> "Copy diagnostics" exist (`docs/11` §1 Phase 7). Changes `docs/11` §1 Phase 3 definition of done
> and `docs/07` §10.4. (Review §4 item 11.)

> **Open — recommended:** "retains 86 notes" reads as 86 `StoredSummary` rows, and 86 notes when
> `report.perPaperNotes` is on (same line as `P3-T29`). Changes `docs/11` §1. (Review §4 item 9.)

**Do NOT.**
- Do **not** dispatch a paid run without the owner approving the estimate.
- Do **not** read, print, grep for or hold any part of a key; the count script is the owner's to run.
- Do **not** relax a criterion to make it pass, count a mock run as "all four providers", or run
  the 100-abstract job on a frontier model.
- Do **not** mark the phase done while the IMRaD gate is unresolved.

**Done when.**
- [ ] One item summarized by all four providers yields four `StoredSummary` rows differing only in
      `providerId`, `modelId` and `usage`.
- [ ] The 100-abstract job's time and actual usage are recorded against NFR-4 and the estimate.
- [ ] With `run.maxSpendUSD = 0.01` the job pauses before the first item and asks.
- [ ] Cancel at 87/200 retains 86; the re-run dispatches 114.
- [ ] The owner-run count script reports zero matches for every key.
- [ ] The IMRaD outcome is recorded with its number and the resulting configuration.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract && npm run build
```
Then the manual steps above on a real Zotero 10 profile, stopping at each gate.

**Notes.** Rewritten 2026-10-20: the old step 6 grepped for each key's first eight characters,
which required the executor to hold them, and generated a debug bundle that does not exist until
Phase 7. Only the owner changes a card's state to `DONE`.

---

### P3-T32 — Preference rows Phase 3 reads (`docs/07` §8.5)

| Field | Value |
|---|---|
| **ID** | `P3-T32` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T02`, `P3-T04`, `P3-T06`, `P3-T13`, `P3-T14`, `P3-T15`, `P3-T16`, `P3-T17`, `P3-T18`, `P3-T19`, `P3-T25`, `P3-T26`, `P3-T27`, `P3-T28`, `P3-T29`, `P3-T33` |
| **Retires** | none |
| **Implements** | part of `FR-29`, `FR-32`, `FR-52` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Every `docs/07` §8.5 row that a Phase 3 card reads exists in `PREFS`, `PREF_KEYS` and
`addon/prefs.js`, exactly as §8.5 declares it, so no other card has to add one.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.5 — the rows below, their types, defaults, ranges and
  value sets; and §8.5.1 (the typed accessor) and §8.5.3 (migration)
- `docs/01-zotero-plugin-platform.md` §7.2 — the literal `pref()` block, and which rows have no
  `pref()` line
- `test/unit/prefs/schema.test.ts` — `SECTION_8_5` is typed out from §8.5 and asserts its length
  (13 today)

**Files.**
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `addon/prefs.js`
- modify `test/unit/prefs/schema.test.ts`

**Do.**
1. Add these rows exactly as §8.5 declares them, `secret` absent on every one, with `PrefName`s
   following the existing convention (dots removed, next letter capitalised:
   `ncbi.keyPresent` → `ncbiKeyPresent`):
   - LLM providers & models: `llmProvider`; `openrouter.model`, `openai.model`, `gemini.model`,
     `anthropic.model`; `openrouter.baseUrl`, `openai.baseUrl`, `gemini.baseUrl`,
     `anthropic.baseUrl`; `summaryModel`, `reportModel`, `screening.model`; `privacy.mode`;
     ⚠ `privacy.egressAcknowledged`; ⚠ `llm.tokenEstimateCalibration`.
   - Summarization: `summary.fullTextMode`, `summary.fullTextAutoMaxPapers`,
     `summary.confirmAboveUSD`, `summary.minAbstractChars`, `fullText.preferJATS`,
     `fullText.hardPageCap`, `autoSummarize`, `screening.threshold`, `screening.retractionPolicy`,
     `screening.nonEnglishPolicy`, `screening.dedupe`, `cache.enabled`, `cache.ignoreModel`,
     ⚠ `cache.lastSeenPromptVersions`, `cache.maxSizeMB`.
   - Report: `report.perPaperNotes`.
   - Runtime: `concurrency`, `run.maxSpendUSD`, `run.maxSessionSpendUSD`.
   - Key-presence: `openrouter.keyPresent`, `openai.keyPresent`, `gemini.keyPresent`,
     `anthropic.keyPresent`; `<id>.lastValidatedAt` and `<id>.lastValidationResult` for the six ids
     `openrouter`, `openai`, `gemini`, `anthropic`, `ncbi`, `semanticscholar`.
2. Add the matching `pref()` lines to `addon/prefs.js` by transcribing `docs/01` §7.2; rows §7.2
   says have no `pref()` line get none.
3. Extend `SECTION_8_5` in `test/unit/prefs/schema.test.ts` with the same rows typed out from §8.5
   (not derived from `PREFS`) and update its length assertion.
4. Ship every default as §8.5 states it today, including both spend ceilings at `0` (off).

> **Open — recommended:** this card adds all the rows above in one pass, and the owner confirms the
> three ⚠ names as written — `privacy.egressAcknowledged`, `llm.tokenEstimateCalibration`,
> `cache.lastSeenPromptVersions` — before they reach a user's `prefs.js`. Changes `docs/07` §8.5
> (removes the ⚠ marks). (Review §4 item 1.)

**Do NOT.**
- Do **not** add a row §8.5 does not declare, a `secret: true` row, or any `*.apiKey` key (D5).
- Do **not** change a default from §8.5's value; in particular not a spend ceiling (gate `G-20`).
- Do **not** derive `SECTION_8_5` from `PREFS`; the test types it out so drift fails.
- Do **not** touch the `secretBackend` row's value set here (`P3-T03`'s open line).

**Done when.**
- [ ] Every row above is in `PREFS` with §8.5's type, default, range and value set.
- [ ] `test/unit/prefs/schema.test.ts` lists the same rows and its length assertion passes.
- [ ] Every `pref()` line in `addon/prefs.js` names a row in `PREF_KEYS`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- prefs/schema && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Created 2026-10-20 (review §2a item 1): the cards read about 50 rows across these groups
and none added them, while `schema.test.ts` pins 13. One card for all of them keeps the length
assertion moving once. Rows for later phases (`reportLanguage`, `tts.*`, `background.enabled`, …)
are not added here.

---

### P3-T33 — Cache layer: interface, SQLite store, keys, migration

| Field | Value |
|---|---|
| **ID** | `P3-T33` |
| **State** | `TODO` |
| **Depends on** | `P3-T32` |
| **Blocks** | `P3-T13`, `P3-T26`, `P3-T35` |
| **Retires** | part of `R-4` |
| **Implements** | part of `FR-19`, part of `FR-23` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The `Cache` of `docs/07` §4.1 exists over the plugin database, with the key helpers,
TTLs, size caps, tag invalidation and eviction of `docs/07` §9, reachable from the service graph.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.1 — the `Cache` interface and its option, prune and
  stats types
- `docs/07-architecture-and-data-model.md` §9.1–§9.4 — `stableStringify`, `CACHE_SCHEMA_VERSION`,
  per-namespace TTLs and caps, the 256 KB blob spill, tags, eviction
- `docs/07-architecture-and-data-model.md` §8.3 — the `cache_entry` DDL; §8.4 — data directory
- `src/bootstrap/registerUI.ts` `openProvenanceStore` — where the database is opened today (outside
  the service graph)

**Files.**
- create `src/core/cache/cache.ts` (the interface)
- create `src/core/cache/keys.ts` (`stableStringify`, `CACHE_SCHEMA_VERSION`, generic key helper)
- create `src/core/cache/sqliteCache.ts`
- modify `src/pipeline/types.ts` (replace the `Cache` alias)
- modify `src/bootstrap/migrations.ts` (`cache_entry`, next free version)
- modify `src/zotero/db.ts` (if the store needs a connection helper)
- modify `src/bootstrap/container.ts` (`installServices` builds the cache — see the open line)
- modify `src/bootstrap/registerUI.ts` (`openProvenanceStore`, if the open line moves the open)
- modify `test/unit/core/provenanceRerun.test.ts`
- modify `test/integration/zotero/provenanceStore.spec.ts`
- create `test/unit/core/cache.test.ts`

**Do.**
1. Transcribe the §4.1 `Cache` interface and its types into `src/core/cache/cache.ts`; replace the
   `Cache` alias in `src/pipeline/types.ts`.
2. `keys.ts`: `stableStringify` and `CACHE_SCHEMA_VERSION` per §9.1.
3. `sqliteCache.ts` over the `SqlConnection` port: get/set with TTL, tags, `invalidateByTag`,
   the 256 KB blob spill, per-namespace caps from §9.2 and the global `cache.maxSizeMB`, LRU
   eviction per §9.4, and stats for the cache-management UI.
4. Add `cache_entry` and its two indexes as the next migration (§0.2 item 4).
5. Give the service graph a route to the database per the open line, and build the cache in
   `installServices`.

> **Open — recommended:** move `openPluginDatabase` and `runMigrations` out of
> `openProvenanceStore` (`src/bootstrap/registerUI.ts`) into `installServices`, so the provenance
> store, the cache, the job store and the summary store share one connection owned by the graph and
> closed in its teardown. Changes `docs/07` §8.3 (where the connection is opened). (Review §2a
> item 4.)

**Do NOT.**
- Do **not** hash an object without `stableStringify`.
- Do **not** make the per-namespace caps preferences (§9.2 fixes them); only the global cap is.
- Do **not** open a second connection to `research-helper.sqlite` (it is opened with
  `locking_mode=EXCLUSIVE`; see `openProvenanceStore`'s comment).
- Do **not** put cached values in `Zotero.Prefs`.

**Done when.**
- [ ] A set/get round trip, a TTL expiry with a fake clock, and `invalidateByTag` each pass.
- [ ] A value over 256 KB is spilled to a blob and read back identical.
- [ ] Exceeding a namespace cap evicts least-recently-used entries first.
- [ ] `{a:1,b:2}` and `{b:2,a:1}` hash to the same key.
- [ ] A fresh database migrates to the new version with `cache_entry` present; the two version
      tests are updated.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "core/cache|provenanceRerun" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Created 2026-10-20: the phase preamble said Phase 2 delivered a `Cache`; it did not
(`src/core/cache/` holds only `.gitkeep`), while `P3-T13`, `P3-T26` and `P3-T28` all need one.

---

### P3-T34 — Job record, `job` table, queue and checkpoint

| Field | Value |
|---|---|
| **ID** | `P3-T34` |
| **State** | `TODO` |
| **Depends on** | `P3-T36` |
| **Blocks** | `P3-T14`, `P3-T17`, `P3-T35` |
| **Retires** | part of `R-10` |
| **Implements** | part of `FR-23`, part of `NFR-6` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** A job has a persistent record with a status, progress, usage, error and checkpoint; a
queue owns job states including `paused` with a reason; and `checkpoint()` writes for real.

**Read first.**
- `docs/07-architecture-and-data-model.md` §5.2 — `JobRecord` and its states
- `docs/07-architecture-and-data-model.md` §7.1, §7.5–§7.6 — the queue, pause reasons
  (`credential-required`), checkpoints and surviving a quit
- `docs/07-architecture-and-data-model.md` §8.3 — the `job` DDL
- `src/bootstrap/container.ts` `createPipelineContextFactory` doc comment — why `checkpoint()` is a
  no-op today and that Phase 3's queue is its caller

**Files.**
- create `src/core/jobQueue/jobRecord.ts`
- create `src/core/jobQueue/queue.ts`
- create `src/pipeline/shared/checkpoint.ts`
- modify `src/zotero/db.ts` (a `job` store)
- modify `src/bootstrap/migrations.ts` (`job`, next free version)
- modify `src/bootstrap/container.ts` (`installServices` builds the queue; `P3-T35` wires
  `checkpoint` into the context)
- modify `test/unit/core/provenanceRerun.test.ts`
- modify `test/integration/zotero/provenanceStore.spec.ts`
- create `test/unit/core/jobQueue.test.ts`

**Do.**
1. `jobRecord.ts`: the §5.2 `JobRecord` type and its state transitions, including `paused` with a
   reason and `BudgetStop`.
2. `queue.ts`: enqueue, state changes, pause with a reason, resume, cancel; one notification per
   pause, not per item.
3. `checkpoint.ts`: write and read a job's checkpoint through the job store.
4. Every write of `input_json`, `error_json`, `progress_json` and `usage_json` passes the `P3-T36`
   gate.
5. Add the `job` table and index as the next migration (§0.2 item 4).
6. Build the queue in `installServices`.

> **Open — recommended:** v1 resumes a job only within the running session plus "skip what is
> already cached" across a restart — the job row survives a quit for display and resume-by-skipping,
> but no job restarts on its own at launch (FR-23 says job state need not survive a restart in v1).
> Changes `docs/07` §7.6. (New finding of this revision.)

**Do NOT.**
- Do **not** write a job column without the gate, or add a redaction rule.
- Do **not** roll back completed work on cancel.
- Do **not** open a second database connection.

**Done when.**
- [ ] A job moves queued → running → paused(`credential-required`) → running → done, persisted.
- [ ] A checkpoint written mid-job is read back identical after a simulated restart.
- [ ] An `error_json` carrying a synthetic key is stored without it.
- [ ] A fresh database migrates with `job` present; the two version tests are updated.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "jobQueue|provenanceRerun" && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Created 2026-10-20: `P3-T03`, `P3-T14` and `P3-T17` modified `queue.ts`, `jobRecord.ts`
and `checkpoint.ts`, and no card created them. `src/core/jobQueue/` holds `cancellation.ts` and
`progress.ts` only.

---

### P3-T35 — Wire the pipeline-context members

| Field | Value |
|---|---|
| **ID** | `P3-T35` |
| **State** | `TODO` |
| **Depends on** | `P3-T06`, `P3-T15`, `P3-T16`, `P3-T33`, `P3-T34` |
| **Blocks** | `P3-T27`, `P3-T28`, `P3-T29` |
| **Retires** | none |
| **Implements** | part of `FR-23` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Every job's `PipelineContext` carries a real `cache`, `budget`, `llm`, `config`,
`privacy` and `checkpoint`, constructed in the composition root.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.5 — `PipelineContext`
- `src/bootstrap/container.ts` `createPipelineContextFactory` — the members it sets to `undefined`
  and the no-op `checkpoint()`
- `src/pipeline/types.ts` — the placeholder aliases (`Cache`, `BudgetGuard`, `LLMRouter`,
  `ConfigReader`, `PrivacyPolicy`; `TTSProvider` and `ZoteroFacade` are not Phase 3's)

**Files.**
- modify `src/bootstrap/container.ts` (`createPipelineContextFactory`, `installServices`)
- modify `src/pipeline/types.ts` (replace the `ConfigReader` alias)
- modify `test/unit/bootstrap/container.test.ts`

**Do.**
1. Pass the cache (`P3-T33`), the router (`P3-T06`), the privacy policy (`P3-T15`), a fresh
   per-job `BudgetGuard` over the shared session counter (`P3-T16`) and a real `checkpoint` bound to
   the job's record (`P3-T34`) into `createPipelineContextFactory`.
2. Declare and supply `config` per the open line.
3. Keep `tts` and `zotero` as they are.

> **Open — recommended:** declare `ConfigReader` in `docs/07` §4.5 as a read-only view of
> `getPref` (`get<K extends PrefName>(name: K): PrefValue<K>`), so a pipeline reads preferences
> through the context instead of importing `src/prefs/`. Changes `docs/07` §4.5. (Review §4 item 7.)

**Do NOT.**
- Do **not** share one `BudgetGuard` per-run counter across jobs; only the session counter is
  shared.
- Do **not** build a second router, cache or queue here; take the ones `installServices` built.

**Done when.**
- [ ] A job's context has non-`undefined` `cache`, `budget`, `llm`, `config` and `privacy`, and
      `checkpoint()` writes to the job record — asserted in `container.test.ts`.
- [ ] Two jobs get distinct per-run counters and the same session counter.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- container
```

**Notes.** Created 2026-10-20 under `plan/README.md` §5 rule 10: without it each builder card would
ship a component nothing passes to a pipeline.

---

### P3-T36 — One redaction gate for new persisted records

| Field | Value |
|---|---|
| **ID** | `P3-T36` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T14`, `P3-T15`, `P3-T25`, `P3-T34` |
| **Retires** | part of `R-9` |
| **Implements** | part of `NFR-16` |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** Every new record Phase 3 persists — `StoredSummary` JSON, job `input_json` /
`error_json` / `progress_json` / `usage_json`, the egress log, `CredentialCheckResult` — passes one
gate built from the existing redactor, as search provenance already does.

**Read first.**
- `src/core/provenance.ts` — `redactText`, the private `redactUnknown` walker and
  `redactSearchProvenance`: the model to follow
- `src/core/errors.ts` — `redact`, `redactUrl`, `omitSecretFields`, `KEYISH_FIELD`
- `docs/09-security-privacy-and-api-keys.md` §2.1

**Files.**
- modify `src/core/provenance.ts` (export one generic gate, e.g. `redactRecord(value)`, built from
  `redactUnknown` plus `omitSecretFields`)
- modify `test/unit/core/provenance.test.ts`

**Do.**
1. Export one function that walks a JSON-shaped value, puts every string through `redactText` and
   drops every field whose name matches `KEYISH_FIELD` (`omitSecretFields`).
2. Make it idempotent, like `redactSourceProvenance`.
3. Callers: `P3-T14`, `P3-T15`, `P3-T25`, `P3-T34`.

> **Open — recommended:** run the gate over every persisted record, including `StoredSummary`
> content, and record a warning on the row when the gate changed a content string — because
> `redact()`'s 40-character catch-all can also match a long sequence quoted from a paper (a gene or
> protein sequence) and alter it. Changes `docs/09` §2.1 (scope of the gate) and `docs/07` §5.2.
> (New finding of this revision.)

**Do NOT.**
- Do **not** add a pattern, a second redactor or a second gate; this function only composes
  `redactText` and `omitSecretFields`.
- Do **not** weaken the 40-character catch-all to protect content.

**Done when.**
- [ ] A nested object with a synthetic key in a string, in a URL query and under an `apiKey` field
      comes out with all three gone.
- [ ] Running the gate twice equals running it once.
- [ ] `KEY_PATTERNS` is unchanged (eight entries).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "core/provenance|errors"
```

**Notes.** Created 2026-10-20 from the review's security note: `P3-T15`, `P3-T25` and `P3-T29`
stored new records without naming a gate.

---

### P3-T37 — Detect a keyring-less Linux backend (gate `G-09`)

| Field | Value |
|---|---|
| **ID** | `P3-T37` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T03` |
| **Blocks** | `P3-T31` |
| **Retires** | remainder of `R-9` |
| **Implements** | part of `FR-30`, part of `NFR-16` |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — gate `G-09`: the owner provides a Linux machine (or VM) without a keyring library and a stock desktop with one, and runs the probe on both. Nothing in this card is built on the assumption that detection works. |

**Goal.** On Linux the startup probe tells a real system keyring from Gecko's profile-held
`NSSKeyStore` substitute, and routes the substitute into `P3-T03`'s degradation dialog, as `G-10`
decided on 2026-09-30.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §1.7, the 2026-09-30 block — a missing libsecret does
  not make `encrypt()` throw; Gecko substitutes `NSSKeyStore`, so a round trip cannot tell
- `plan/06-human-gates.md` `G-09` and `G-10` — the owed measurement, and the ruling that
  NSS-backed storage is a degraded tier
- `plan/00-task-index.md` §6 item 55
- `src/zotero/keychain.ts` — `probeKeystore`, `probeAndRecordBackend`, `secretBackendPrefValue`

**Files.**
- modify `src/zotero/keychain.ts` (the detection inside the startup probe)
- modify `src/bootstrap/container.ts` (`installSecretStore`: route the substitute to the dialog)
- modify `src/ui/prefs/preferencesPane.ts` (`backendBadge`: retire `indeterminate` only if
  detection lands)
- modify `test/integration/zotero/keychain.spec.ts`

**Do.**
1. Stop at `G-09` first: ask the owner to run the existing probe on both Linux machines and report
   what each does.
2. If the owner's measurement shows a way to tell the backends apart (candidate: `js-ctypes`
   loading libsecret the way Gecko's `MaybeLoadLibSecret()` does), implement it in the probe.
3. Route the substitute case to `P3-T03`'s dialog and badge it as degraded, never as a system
   keyring.

> **Open — recommended:** if detection proves infeasible, keep the shipped `indeterminate` badge
> and revisit `G-10`'s 2026-09-30 ruling ("NSS-backed storage is a degraded tier") rather than
> implement it on a guess; the remaining choices are to accept NSS storage as tier 1 with an honest
> badge, or to refuse Linux without a keyring. Changes `docs/09` §1.7. (Review §4 item 4.)

**Do NOT.**
- Do **not** guess the backend from `Zotero.OSKeyStore.available` or from a successful round trip.
- Do **not** present NSS-backed storage as protected by a system keyring.
- Do **not** start step 2 before the owner's measurement exists.

**Done when.**
- [ ] The owner's measurement on both machines is recorded in the card's report.
- [ ] On the keyring-less machine the badge is not a system-keyring badge, and the dialog is shown
      if detection is implemented.
- [ ] `npm run typecheck` exits 0; the integration suite passes on Windows.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```
Then the owner's run on the two Linux machines.

**Notes.** Created 2026-10-20 by splitting the old `P3-T02` steps 3 and 5, which waited on `G-09`,
so that the gate holds only this card and not the pane and adapters behind `P3-T02`.

---

## 3. Estimate reconciliation

| | Developer-days |
|---|---|
| Sum of the 37 task cards (2026-10-20) | **27.5** |
| Previous sum (31 cards, 2026-09-09) | 23.5 |
| `docs/11` §1 Phase 3 band, published 2026-10-20 | **27.5–39** (27.5 × 1.4 = 38.5 → 39) |

**Re-estimated 2026-10-20, with the revision of every card** (`plan/00` §6 item 234). Three
movements:

- **Shrunk because work landed in Phases 1–2 or moved to another card:** `P3-T01` 0.5 → 0.25,
  `P3-T02` 0.75 → 0.5 (backend detection moved to `P3-T37`), `P3-T03` 0.75 → 0.5 (tier 3 dropped
  by `G-10`), `P3-T04` 1.75 → 1.0 (`P1-T44` built the pane), `P3-T13` 0.75 → 0.5 (heuristic to
  `P3-T06`, menulists to `P3-T14`), `P3-T18` 0.75 → 0.5 (the full-text readers exist). Total
  −2.0 d.
- **Grew because the cards had not priced their callers, migrations, windows or strings, or took
  work from another card:** `P3-T06` 0.75 → 1.0, `P3-T11` 0.5 → 0.75, `P3-T14` 0.5 → 0.75,
  `P3-T15` 0.75 → 1.0, `P3-T16` 1.0 → 1.25, `P3-T25` 1.0 → 1.25, `P3-T27` 0.75 → 1.0, `P3-T28`
  0.5 → 0.75, `P3-T29` 1.0 → 1.25. Total +2.25 d.
- **New cards for prerequisites no card owned:** `P3-T32` 0.75, `P3-T33` 1.0, `P3-T34` 1.0,
  `P3-T35` 0.5, `P3-T36` 0.25, `P3-T37` 0.25. Total +3.75 d.

23.5 − 2.0 + 2.25 + 3.75 = **27.5 d**. Every other card's estimate is unchanged. `P3-T21` is held
at 0.5 d pending the owner's ruling on the outline-based detector, which would raise it.

**Propagation is the coordinator's.** The five places in `plan/README.md` §7 move together through
`npm run index:derive`; this file does not edit them. **Done 2026-10-20**
(`plan/reports/bookkeeping-2026-10-20.md`): `docs/11` §1 and §2 and `plan/00` §1 now carry
27.5–39 d over 37 cards. Human-gated cards rose from 6 to 8: `P3-T30`
(its recording spend) and `P3-T37` (`G-09`) are new gates; the other six are unchanged.

The estimates exclude review latency, waiting for key approvals, and the owner's time at gates
(`G-12`'s adjudication in particular), per `plan/README.md` §7.

---

## 4. Open items this file could not resolve

**Numbering is permanent.** Items 1–3 and 7–10 were closed on 2026-09-09; their full text is in
earlier revisions of this file, and the cards named below carry the result.

1. ~~No `<provider>.baseUrl` preference.~~ Closed 2026-09-09 (`docs/07` §8.5); `P3-T32` adds the rows.
2. ~~No consent preference.~~ Closed 2026-09-09 (`privacy.egressAcknowledged`); `P3-T32`, `P3-T15`.
3. ~~No `screening.threshold` preference.~~ Closed 2026-09-09; `P3-T32`, `P3-T27`.
4. **Gemini billing-tier detection may have no programmatic signal.** Still open; the
   recommendation is on `P3-T10`.
5. ~~Publisher-PDF licensing for the IMRaD corpus.~~ **Decided 2026-10-20:** open-access papers with
   a redistributable licence only, each download asked for separately (`P3-T20`, `G-12`).
6. **Cross-lingual summary quality is unmeasured** (`docs/06` §13.2). Not decomposed; it belongs
   with the Korean report work in Phase 4.
7. ~~No home for the token-estimator correction factor.~~ Closed 2026-09-09
   (`llm.tokenEstimateCalibration`); `P3-T32`, `P3-T13`.
8. ~~`countTokens` has no `exact` flag.~~ Closed 2026-09-09: doc 07 §4.3's synchronous signature
   wins; Anthropic's exact count is adapter-private (`P3-T09`).
9. ~~`P3-T04`'s scope grew without its estimate moving.~~ Closed 2026-09-09; re-estimated again on
   2026-10-20 (§3).
10. ~~No `<provider>.lastValidationResult` preference.~~ Closed 2026-09-09; `P3-T32`, `P3-T14`.
11. **The owner decisions of the 2026-10-20 review** are written into the cards as
    `> **Open — recommended:**` lines, one per decision, each naming the document section it would
    change. `grep -n "Open — recommended" plan/04-phase-3-llm-summaries.md` lists them for the
    owner's single review pass.

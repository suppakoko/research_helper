# Phase 3 — LLM layer, key storage, and per-paper summaries

> **What this file is.** The task-card decomposition of
> [`docs/11-implementation-roadmap.md`](../docs/11-implementation-roadmap.md) §1 "Phase 3".
> The card schema, the field rules and the execution protocol are
> [`README.md`](README.md) §4–§5 and are binding on every card below.
>
> **Last updated:** 2026-09-09 · **Status:** no code written yet; every task is `TODO`.

---

## 0. Phase summary

**Goal (docs/11).** A provider-agnostic LLM client with cost control, plus per-item summary
notes.

**Why this phase is different.** Phases 0–2 spend nothing and send nothing but query terms to
public bibliographic APIs. Phase 3 is the first phase that **spends the user's money** and the
first that **sends the user's material off the machine**. Two consequences run through every
card in this file:

1. **Secrets before adapters.** No provider adapter may be written before the `SecretStore`
   exists, because the first thing an adapter needs is a key, and the shortest path to a key is
   a preference — which decision **D5** (`docs/00-overview.md` §3) forbids outright and which
   `docs/09-security-privacy-and-api-keys.md` §1.7 refuses to implement even as a fallback.
2. **No spend without a number.** The cost estimator and the confirmation gate are not polish
   at the end of the phase; they are a precondition for the first real run (`docs/06` §5.4,
   R-4).

**What Phase 3 assumes from Phases 0–2.** A building, installable plugin with a working
`HttpClient` over `Zotero.HTTP.request`, the typed error base (`docs/07` §10.1), the SQLite
store and `Cache` (`docs/07` §8.3, §9), the per-host `TokenBucket` registry (`docs/07` §7.3),
seven literature-source adapters, deduplication, and Zotero import. Phase 3 adds the `llm`
worker pool and the LLM host limiters on top of that, not a second HTTP stack.

**Deliverables (docs/11 §1 Phase 3, verbatim scope).** Provider abstraction with four adapters
(FR-29); preferences pane with keys, the per-provider base-URL override (`<provider>.baseUrl`,
`docs/07` §8.5), per-task model selection, budget ceilings and language (FR-29, FR-30, FR-32,
FR-52); **`SecretStore` tiers 2 and 3 and every key-entry surface** — the passphrase file, the
session-only fallback, the degradation dialog, the storage-backend badge, and the key fields for
all four LLM providers *plus NCBI and Semantic Scholar*, since Phase 1 shipped tier 1 for
`source.ncbi` alone and no UI at all (FR-30, NFR-16, D5); "Test connection" (FR-31); token and cost
estimation with an "as of" date (FR-24, NFR-5); consent and egress disclosure before the first
job and before every job (FR-36); job engine with bounded concurrency, backoff with jitter,
cancellation and resume-by-skipping (FR-23, FR-34, NFR-6); the summarizer including the R-19
extraction quality gate, prompts from `docs/12`, structured-output parsing and child-note
writing (FR-19–FR-22); **IMRaD section-detector validation against the 40-PDF fixture set
before this phase ships** (R-19b); "Remove generated notes from collection" (FR-20); usage
accounting (FR-35); and the deterministic LLM mocking harness (`docs/13` §2.2).

**Risks retired.** R-4, R-5, R-6 (partly), **R-9** (mitigations shipped; retired by design
under D5), **R-19** (quality gate + cost preview shipped), **R-19b** (detector validated
against the 40-PDF fixture set, or `auto` degraded to whole-document chunking).

**Effort (docs/11).** **23.5–33 developer-days** — *measured*, and measured from this file: the
2026-09-09 re-estimate replaced the old 12–15 d guess with the 31 cards' own sum, and its upper
bound is that × 1.4. The sum moved from 22.0 d to **23.5 d** later the same day when the owner
re-estimated the two cards two review rounds had flagged as knowingly optimistic — `P3-T04`
(1.0 → 1.75 d) and `P3-T20` (1.0 → 1.75 d). No other card's estimate changed. See §3.

### Phase definition of done

Taken from `docs/11` §1 Phase 3 "Definition of done" and not restated in weaker words:

- [ ] All four providers produce a summary for the same item using the same internal code
      path; only the adapter differs.
- [ ] A 100-abstract job completes within the NFR-4 budget and reports actual token usage.
- [ ] Setting a $0.01 ceiling pauses the job on the first item and asks for confirmation.
- [ ] Cancelling at item 87/200 retains 86 notes and resumes correctly (FR-23).
- [ ] No key appears in the debug log, in a note, or in copied diagnostics (NFR-16).

And two that `docs/11` states as deliverables rather than as DoD lines, but which gate the
phase just as hard:

- [ ] The IMRaD detector has been measured against the 40-PDF fixture set and either passes
      the ≥ 85 % threshold (`docs/06` §4.3) or `summary.fullTextMode: auto` has been degraded
      to whole-document flat chunking with section provenance suppressed in the prompt.
- [ ] Every phase-3 test passes with **zero** live network calls and **zero** spend
      (`docs/13` §4, "no test at any layer performs a live network call").

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P3-T01` | Secret wrapper and unconditional log redaction | 0.5 | none |
| `P3-T02` | `SecretStore` tier 1 — OS keychain via `Services.logins` | 0.75 | none |
| `P3-T03` | Tier ladder — session-only and passphrase, no tier 4 | 0.75 | none |
| `P3-T04` | Prefs pane: key fields, backend badge, remove-all | 1.75 | **Yes** |
| `P3-T05` | LLM error taxonomy and the retry/backoff policy | 0.5 | none |
| `P3-T06` | `LLMProvider` contract, registry, router, mock harness | 0.75 | none |
| `P3-T07` | OpenRouter adapter (the default provider) | 1.0 | none |
| `P3-T08` | OpenAI adapter (Responses API) | 0.5 | none |
| `P3-T09` | Anthropic adapter (Messages API) | 0.5 | none |
| `P3-T10` | Gemini adapter (Interactions API) | 0.75 | none |
| `P3-T11` | SSE streaming across the four adapters | 0.5 | none |
| `P3-T12` | Structured output, validation, and the repair path | 0.75 | none |
| `P3-T13` | Model catalogue, pricing table, token estimation | 0.75 | none |
| `P3-T14` | `validateCredentials()` and the Test-key button | 0.5 | **Yes** |
| `P3-T15` | Privacy modes, egress disclosure, Gemini free-tier warning | 0.75 | none |
| `P3-T16` | Cost estimate, confirmation gate, `BudgetGuard`, usage | 1.0 | **Yes** |
| `P3-T17` | `llm` worker pool: concurrency, cancel, pause, resume | 0.75 | none |
| `P3-T18` | Text acquisition tiers 1–2 (abstract, attachment text) | 0.75 | none |
| `P3-T19` | Tiers 3–4, cleaning pass, OCR probe, language detection | 0.75 | none |
| `P3-T20` | The 40-PDF IMRaD fixture set with ground-truth labels | 1.75 | **Yes** |
| `P3-T21` | IMRaD section detector (JATS + PDF heading table) | 0.5 | none |
| `P3-T22` | Detector accuracy harness, 85 % gate, degrade switch | 0.5 | **Yes** |
| `P3-T23` | Chunker: section-aware, flat, and single-shot paths | 0.75 | none |
| `P3-T24` | Prompt registry with versioned prompt files | 0.5 | none |
| `P3-T25` | Per-paper summarizer, DR-1, and the grounding check | 1.0 | none |
| `P3-T26` | Summary cache keyed per `docs/06` §11.2 | 0.5 | none |
| `P3-T27` | Screening: retractions, non-English, duplicates, relevance | 0.75 | none |
| `P3-T28` | Item-pane AI summary section | 0.5 | none |
| `P3-T29` | Summarize-collection pipeline, notes, remove-notes command | 1.0 | none |
| `P3-T30` | LLM fixtures and contract tests | 0.75 | none |
| `P3-T31` | Phase-3 acceptance run against the definition of done | 0.75 | **Yes** |
| | **Total** | **23.5** | 6 gates |

---

## 2. Task cards

### P3-T01 — Secret wrapper and unconditional log redaction

| Field | Value |
|---|---|
| **ID** | `P3-T01` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T02`, `P3-T05` |
| **Retires** | part of `R-9` |
| **Implements** | `NFR-16`, part of `FR-30`, part of `FR-54` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A credential cannot reach a log, an error message, a URL or a debug bundle even if
a call site is careless, because the type is awkward to stringify and the logger redacts
unconditionally.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §2.1 — the three enforcement levels, the literal
  `Secret` class, the `KEY_PATTERNS` / `KEYISH_FIELD` regexes and `loggableHeaders()`; this
  task is that section made real, and the regex list is copied from there rather than invented
- `docs/09-security-privacy-and-api-keys.md` §2.2 — why the ring buffer is redacted **at write
  time, not at export time**, which decides where `redact()` is called
- `docs/07-architecture-and-data-model.md` §8.5 "Diagnostics" — `logLevel` and
  `logRequestBodies`, and the rule that neither ever widens what *credentials* may be logged
- `docs/07-architecture-and-data-model.md` §10.3 — the structured-logging shape `redact()` has
  to run over (message plus context values)

**Files.**
- create `src/prefs/secrets.ts`
- modify `src/core/logger.ts`
- modify `src/core/http/client.ts`
- create `test/unit/core/redaction.spec.ts`
- modify `eslint.config.js`

**Do.**
1. Add the `Secret` class to `src/prefs/secrets.ts` exactly as `docs/09` §2.1 declares it:
   private `#value`, a single `expose()` reader, and `toString` / `toJSON` /
   `Symbol.toStringTag` / the node inspect symbol all returning `[Secret]`.
2. Add `redact(input: string): string` with the seven `KEY_PATTERNS` from §2.1, in that order,
   replacing each match with `[redacted:<length>]`.
3. Add `redactUrl(url: string): string` stripping the `key`, `api_key`, `apikey`, `token` and
   `access_token` query parameters.
4. Add `loggableHeaders(h)` using `KEYISH_FIELD`, returning `[redacted:<length>]` for a keyish
   header name and `redact(value)` for everything else.
5. Wire `redact()` into `src/core/logger.ts` so it runs over every message **and** every
   context value, at every level, before the entry enters the 5000-line ring buffer.
6. Change `src/core/http/client.ts` to log only `loggableHeaders(headers)`, never the header
   object, and to pass request URLs through `redactUrl()`.
7. Add an ESLint `no-restricted-syntax` rule that fails the build on a `debug: true` property
   in any object literal passed to `Zotero.HTTP.request`.

**Do NOT.**
- Do **not** add a preference, a build flag or a `logLevel` value that disables redaction.
  `docs/09` §2.1: "There is no diagnostic setting, and must never be one, whose effect is to
  put a key in the log." `logRequestBodies` widens *content*, never *credentials*.
- Do **not** drop the final catch-all `/\b[A-Za-z0-9_-]{40,}\b/g` pattern because it
  occasionally redacts a hash or a base64 run. §2.1 records that trade deliberately: a false
  positive costs a debugging inconvenience, a false negative publishes a billing credential.
- Do **not** ever pass `debug: true` to `Zotero.HTTP.request`. It logs response text, and LLM
  request/response bodies contain the user's paper content (`docs/09` §2.1, "URLs" para.).
- Do **not** give `Secret` a getter, a spread-friendly shape or a `valueOf` — the point is that
  `expose()` is the only leak path and is greppable.

**Done when.**
- [ ] `JSON.stringify({ k: new Secret("sk-ant-…") })` contains `"[Secret]"` and no key material.
- [ ] `redact()` masks each of the seven documented key shapes in a unit test, including a
      `Bearer` header value and a 45-character opaque run.
- [ ] A logger call at `logLevel: "debug"` with `logRequestBodies: true` and an
      `Authorization` header in context emits `[redacted:<n>]` for that header.
- [ ] `redactUrl("https://…/models?key=AIza…&alt=json")` returns a string with no `AIza` prefix.
- [ ] The ESLint rule fails on a fixture file containing `Zotero.HTTP.request("POST", u, { debug: true })`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- redaction
```

**Notes.** This card ships before `SecretStore` on purpose. Writing the store first means the
first debugging session of the store happens without redaction in place, which is exactly when
a real key is most likely to be printed. The `Secret` type also fixes the rotation rule in
`docs/09` §2.5 by construction: `expose()` is cheap, so adapters call it per request and never
hoist the value into a job-scoped variable.

---

### P3-T02 — `SecretStore` tier 1 — OS keychain via `Services.logins`

| Field | Value |
|---|---|
| **ID** | `P3-T02` |
| **State** | `TODO` |
| **Depends on** | `P3-T01` |
| **Blocks** | `P3-T03`, `P3-T04`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` |
| **Retires** | most of `R-9` |
| **Implements** | `FR-30` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** An API key can be stored, read, replaced and cleared through
`Zotero.OSKeyStore.encrypt()` → `Services.logins`, with a `*.keyPresent` boolean in prefs and
no secret anywhere else on disk.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §1.7 — the `SecretStore` interface, the
  `SecretId` union, `LOGIN_ORIGIN` / `LOGIN_REALM` constants and the literal `setTier1()`
  implementation this task reproduces
- `docs/09-security-privacy-and-api-keys.md` §1.2 — the async-only `nsILoginManager` note:
  `findLogins()` is a throwing stub and the sync `addLogin`/`removeLogin`/`searchLogins` were
  removed on the esr153 base, so every call here is `await`ed and uses the `Async` name
- `docs/09-security-privacy-and-api-keys.md` §1.3 — that `encrypt()`/`decrypt()` are async, the
  `oskv1:` prefix, and the implementer note that the `available` getter is **not** a capability
  check and `ensureLoggedIn()`/`hasCredentials()` are not re-exported
- `docs/07-architecture-and-data-model.md` §8.5 "Non-secret key-presence flags" — the exact
  pref keys this store is allowed to write: `<provider>.keyPresent`,
  `<provider>.lastValidatedAt` and `secretBackend`. The table's third per-credential row,
  `<provider>.lastValidationResult`, belongs to the **validation flow** (`P3-T14`), not to this
  store — except that §2.5's rotation path resets it, which `P3-T14` implements
- `docs/09-security-privacy-and-api-keys.md` §2.5 — replacement is atomic remove-then-add in
  one operation, and `uninstall()` (not `shutdown()`) clears every `SecretId`

**Files.**
- modify `src/zotero/keychain.ts` (created by `P1-T06`, which shipped tier 1 for `source.ncbi`
  only; this card widens it to every `SecretId`)
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `addon/bootstrap.js`
- modify `test/integration/zotero/keychain.spec.ts`
- create `test/unit/prefs/secretSchema.spec.ts`

**Do.**
1. Declare `SecretBackend`, `SecretId` and the `SecretStore` interface in
   `src/zotero/keychain.ts` exactly as `docs/09` §1.7 gives them — including the deliberate
   absence of a `"plaintext-prefs"` member.
2. Implement the tier-1 backend: `set()` per §1.7's `setTier1()`, `get()` decrypting via
   `Zotero.OSKeyStore.decrypt()` when `isEncrypted()` is true, `clear()` via
   `removeLoginAsync`, `has()` as a search that never decrypts, and `listStoredIds()`.
3. Implement `probeBackend()`: round-trip a throwaway value through
   `encrypt()`/`decrypt()` at startup and classify the backend from the result, not from the
   `available` flag. Write the outcome to the `secretBackend` pref.
4. Make `set()` and `clear()` the only writers of `<provider>.keyPresent`.
5. Map the `SecretBackend` to the user-facing badge string key (Windows Credential Manager /
   macOS Keychain / System keyring) for `P3-T04` to render.
6. Add the `secret: true` flag to `src/prefs/schema.ts` entries and a unit test asserting that
   **no** `secret: true` entry has a `Zotero.Prefs` writer.
7. Call `await secretStore.clearAll()` from `uninstall()` in `addon/bootstrap.js`. Leave
   `shutdown()` untouched.

**Do NOT.**
- Do **not** write a key, encrypted or otherwise, to `Zotero.Prefs`. Decision **D5**. There is
  no `*.apiKey` / `apiKey.*` pref and there must never be one (`docs/07` §8.5).
- Do **not** write a key to the plugin's SQLite database, "not even encrypted, not even
  transiently" — the database lives in the **data** directory and travels in every backup
  (`docs/09` §1.6).
- Do **not** call `Services.logins.findLogins()`, `addLogin()`, `removeLogin()`,
  `searchLogins()` or `countLogins()`. They are removed or throwing on this Gecko base; use the
  `…Async` forms and `await` all of them (`docs/09` §1.2).
- Do **not** treat `Zotero.OSKeyStore.available` as proof that encryption works, and do **not**
  call `ensureLoggedIn()` or `hasCredentials()` on Zotero's wrapper — it does not re-export
  them (`docs/09` §1.3 implementer note).
- Do **not** assume `encrypt()` succeeds. The existence of `confirmUnencryptedFallback()` in
  Zotero's wrapper is the evidence that it can fail; `P3-T03` owns what happens then.
- Do **not** clear secrets from `shutdown()` — it runs on every app close (`docs/09` §2.5).
- Do **not** call `SecretStore.get()` to populate a UI field, here or anywhere
  (`docs/09` §1.9 rule 2).

**Done when.**
- [ ] An in-Zotero integration test stores a `sk-`-shaped string under `llm.openrouter`, reads
      it back identical, overwrites it with a second value, reads back the second, clears it,
      and then `has()` returns false.
- [ ] After `set()`, `research-helper.openrouter.keyPresent` is `true`; after `clear()`, false.
- [ ] Grepping the profile's `prefs.js` after the round-trip finds no substring of the stored
      value.
- [ ] The stored `password` field starts with `oskv1:`.
- [ ] `test/unit/prefs/secretSchema.spec.ts` fails if a `secret: true` entry is given a prefs
      writer.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- secretSchema && npm run test:integration -- --grep keychain
```

**Notes.** Phase 0's `V-16` spike (`docs/11` §4.3) already round-tripped this path on Windows;
if that spike report records a deviation from `syncLocal.js`'s pattern, the spike report wins
over the sketch in `docs/09` §1.7 and this card should be amended before it is executed. The
one `SecretId` per login entry (with the id as the `username` field) is what makes
`listStoredIds()` and the "remove all keys" count in `P3-T04` possible.

**This card widens an existing module, it does not create one.** `P1-T06` already shipped
`src/core/secretStore.ts` (the port, with `docs/09` §1.7's full member list and the full
`SecretId` union) and tier 1 in `src/zotero/keychain.ts` and its integration spec, scoped to
`source.ncbi` because Phase 1 has no LLM credentials and `docs/11` §1 says no key-entry UI ships
there. Do not re-declare the port, do not re-declare the `SecretId` union, and do not start a
second keychain module — extend what is there to every `SecretId` and add the LLM cases to the
existing spec. There is no `Depends on` edge to `P1-T06` because Phase 3 is reachable only after
Phase 1 has shipped in full.

---

### P3-T03 — Tier ladder — session-only and passphrase, no tier 4

| Field | Value |
|---|---|
| **ID** | `P3-T03` |
| **State** | `TODO` |
| **Depends on** | `P3-T02` |
| **Blocks** | `P3-T04` |
| **Retires** | remainder of `R-9` |
| **Implements** | `FR-30` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** When the OS keystore is unavailable the plugin degrades **explicitly and visibly**
to session-only or passphrase storage, and there is no code path that could ever write a key
in plaintext.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §1.7 — tiers 2 and 3 in full, including the
  passphrase parameters (AES-GCM, PBKDF2-HMAC-SHA256 ≥ 600 000 iterations), the file location
  (`research-helper/secrets.enc` in the **profile** directory), and the tier-4 refusal
- `docs/09-security-privacy-and-api-keys.md` §1.4 — why a passphrase is the *fallback* and not
  the primary mechanism (background jobs need unattended reads), so tier 2's `unattended:
  false` has behavioural consequences rather than being a label
- `docs/00-overview.md` §3 D5 — the open question of whether tier 2 or tier 3 is offered first
  on Linux without libsecret; both are implemented, the ordering is the owner's call
- `docs/07-architecture-and-data-model.md` §7.5 — `paused` with reason `credential-required`,
  the state a job must enter when tier 2 has no key rather than failing

**Files.**
- modify `src/zotero/keychain.ts`
- create `src/zotero/keychainPassphrase.ts`
- modify `src/core/jobQueue/jobRecord.ts`
- create `src/ui/dialogs/secretBackendDialog.ts`
- create `test/unit/zotero/keychainLadder.spec.ts`
- modify `addon/locale/en-US/research-helper-preferences.ftl`
- modify `addon/locale/ko-KR/research-helper-preferences.ftl`

**Do.**
1. Implement the tier-2 backend: a module-scoped map cleared on `shutdown()`, with
   `unattended: false`.
2. Implement the tier-3 backend in `keychainPassphrase.ts`: AES-GCM over Web Crypto with a
   PBKDF2-HMAC-SHA256 key at ≥ 600 000 iterations, ciphertext in
   `<profile>/research-helper/secrets.enc`, passphrase held in memory for the session after one
   prompt.
3. On a failed startup probe, show `secretBackendDialog` offering tier 2 and tier 3 with their
   stated costs. Never select one silently.
4. Persist the chosen tier in the `secretBackend` pref and expose it to the badge.
5. Make a job that needs a key which tier 2 does not hold transition to `paused` with reason
   `credential-required`, per `docs/07` §7.5 — not `failed`.
6. Add a unit test that walks every exported symbol of `src/zotero/` and asserts that no
   function writes a `SecretId` value through the `PrefStore` port.

**Do NOT.**
- Do **not** implement a tier 4. `docs/09` §1.7: "There is no code path that writes an API key
  to a preference… implementing it as a fallback guarantees it becomes the common case." If
  tiers 1–3 all fail, the plugin runs without LLM features and says so.
- Do **not** put `secrets.enc` in the **data** directory. Data-directory files travel in
  backups and shared library folders (`docs/09` §1.6); the profile directory does not.
- Do **not** obfuscate with a key derived from a machine ID or hard-coded in the build.
  `docs/09` §1.4 rejects that as "obfuscation presented as encryption, which is worse than
  plaintext because it misleads the user".
- Do **not** fall back from tier 1 to tier 2 without a dialog. §1.7: "Failure → escalate to the
  tier-2/3 decision **with a dialog**, never silently."
- Do **not** fail a job when a tier-2 key is absent — pause it, so fixing the key and resuming
  does not discard completed work.

**Done when.**
- [ ] With `Zotero.OSKeyStore.encrypt` stubbed to throw, the probe reports failure and the
      backend dialog is shown rather than a tier being chosen.
- [ ] The tier-3 round-trip encrypts, writes, re-reads and decrypts a key across a simulated
      restart with the passphrase re-entered.
- [ ] `secrets.enc` resolves under the profile directory, not the data directory, asserted by
      path comparison against `Zotero.DataDirectory.dir`.
- [ ] A summarize job started with the tier-2 backend and no stored key ends in state `paused`
      with reason `credential-required`, and zero HTTP requests were issued.
- [ ] A repository-wide grep for a prefs write whose key matches `/apiKey|api_key/i` returns
      nothing, asserted by a test.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- keychainLadder
```

**Notes.** The Linux-without-libsecret ordering is `docs/09` §8 open question 1 and is **not**
settled by this card: implement both, offer both, and leave the default ordering as a one-line
constant with a comment pointing at that open question so the owner's answer is a one-line
change.

---

### P3-T04 — Prefs pane: key fields, backend badge, remove-all

| Field | Value |
|---|---|
| **ID** | `P3-T04` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T03` |
| **Blocks** | `P3-T14` |
| **Retires** | part of `R-9` |
| **Implements** | `FR-30`, `FR-52`, part of `FR-29` |
| **Estimate** | 1.75 d |
| **Human gate** | **Yes** — a human must enter real API keys. An agent must stop here and report which providers still need a key. Keys are never pasted into a task card, a commit, a log or a test fixture. |

**Goal.** The user can store, mask, replace and remove a key per provider, see which storage
tier is in effect, and read the residual-risk statement without clicking anything.

**Read first.**
- `docs/08-ui-ux-spec.md` §7.5 — the ten API-key UX rules, in particular rule 6 (the key field
  carries **no** `preference` attribute) and rule 1 (hold-to-show, never re-display)
- `docs/08-ui-ux-spec.md` §7.3 — the pane markup: the provider `menulist` bound to
  `llmProvider`, the `rh-or-key` password input with **no** `preference` attribute, the
  `rh-or-backend` badge paragraph, the `rh-or-base-url` input (which *does* carry a
  `preference` binding — it is not a credential), the `rh-clear-all-keys` button, and the
  separate **NCBI** and **Semantic Scholar** groupboxes with their own key fields
- `docs/09-security-privacy-and-api-keys.md` §1.8 — the residual-risk text, to be reproduced
  **verbatim, not paraphrased**, as the Fluent string
- `docs/09-security-privacy-and-api-keys.md` §1.9 — the eight UI requirements this pane must
  satisfy, including the masked digest format (`sk-…••••1a2b`, first 3 + last 4) and the
  empty-state explanation after a data-directory restore
- `docs/07-architecture-and-data-model.md` §8.5 "LLM providers & models" — the exact pref keys
  the pane may bind (`llmProvider`, `<provider>.model`, and the four `<provider>.baseUrl` rows:
  type `string`, default `""`, allowed "an absolute `https://` URL with no trailing slash, or
  empty"), and §8.5 "Non-secret key-presence flags" for what the status row reads, including
  the `ncbi.keyPresent` and `semanticscholar.keyPresent` rows this pane also drives
- `docs/03-llm-provider-integration.md` §14.4 "Transport layer", closing paragraph — base URLs
  are resolved **in the transport** from `<provider>.baseUrl` and are never hardcoded in an
  adapter; an overridden value must be `https://` and is validated at write time, and the
  pre-flight egress dialog names the *effective* host. `P3-T06` owns the resolver and `P3-T15`
  the dialog; this card owns only the control and its validation
- `docs/11-implementation-roadmap.md` §1 Phase 3, the "`SecretStore` tiers 2 and 3, and every
  key-entry surface" deliverable — this pane is where a user can first enter a key at all, and
  the deliverable names "the key fields for all four LLM providers plus NCBI and Semantic
  Scholar", not the LLM providers alone
- `docs/08-ui-ux-spec.md` §7.2 — preference binding, and the note that `preference=` bindings
  stringify on the way out

**Files.**
- modify `addon/content/preferences.xhtml`
- create `src/ui/prefs/prefsController.ts`
- create `src/ui/prefs/keyFieldController.ts`
- modify `addon/locale/en-US/research-helper-preferences.ftl`
- modify `addon/locale/ko-KR/research-helper-preferences.ftl`
- modify `addon/prefs.js`
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- create `test/integration/zotero/prefsPaneKeys.spec.ts`

**Do.**
1. Add the LLM-providers groupbox from `docs/08` §7.3: the provider menulist bound to
   `extensions.zotero.research-helper.llmProvider`, and one block per provider containing the
   `type="password"` key input, Reveal, Test, Clear buttons, the backend badge paragraph, the
   model menulist bound to `<provider>.model`, the base-URL input bound to
   `<provider>.baseUrl`, and a status paragraph.
2. Drive the key input imperatively from `keyFieldController.ts` against the `SecretStore`.
   On blur or Save: trim whitespace, strip a leading `Bearer `, `set()` the value, then replace
   the field content with the masked digest.
3. Implement Reveal as **hold-to-show** on the value the user just typed, never on a stored
   value — a stored key is never re-displayed.
4. Render the backend badge from the `secretBackend` pref, warning-coloured for tiers 2 and 3.
5. Render the per-provider status row from `<provider>.keyPresent` and
   `<provider>.lastValidatedAt`. The third input to that row,
   `<provider>.lastValidationResult`, supplies its colour and wording and is added by `P3-T14`;
   ship the `role="status"` element here (`docs/08` §7.3, no `preference=` attribute) and let
   `P3-T14` paint it.
6. Add the §1.8 residual-risk paragraph as an always-visible Fluent string; only its second
   paragraph may be a collapsed disclosure.
7. Implement "Remove all stored keys": clear every `SecretId`, then report the count removed.
8. Add the empty-key-after-restore explanation string and show it when `keyPresent` is false
   for every provider and the plugin database is non-empty.
9. Add a `pref()` default line to `addon/prefs.js` for every key the pane binds, including the
   four `<provider>.baseUrl` rows, all six `*.keyPresent` rows, and `secretBackend`. Transcribe
   `docs/01` §7.2's block rather than composing your own: it now also ships six
   `*.lastValidationResult` lines defaulting to `""`, whose schema row `P3-T14` adds. Any §8.5
   row with no pane control needs no line at all (§7.2's closing paragraph), which is why
   `*.lastValidatedAt` has none.
10. Add the four `<provider>.baseUrl` rows to `src/prefs/schema.ts` and their key constants to
    `src/prefs/keys.ts` exactly as `docs/07` §8.5 declares them — type `string`, default `""`,
    `secret` absent — and no other new row. Then add the base-URL override control per
    `docs/08` §7.3: one `type="url"` input per provider
    block carrying `preference="extensions.zotero.research-helper.<provider>.baseUrl"`, with
    that provider's documented base URL (`docs/03` §2.1, §3.1, §4.1, §5.1) as the **placeholder**
    so the empty default is never a guess. Validate on write: accept only an absolute `https://`
    URL with no trailing slash, or empty; reject and report anything else rather than silently
    normalizing it (`docs/03` §14.4, `docs/07` §8.5).
11. Add the NCBI and Semantic Scholar key fields from `docs/08` §7.3's own groupboxes, driven by
    the same `keyFieldController` against `SecretId`s `source.ncbi` and
    `source.semanticscholar` (`docs/09` §1.7), rendering `ncbi.keyPresent` /
    `semanticscholar.keyPresent` and the same backend badge. `docs/11` Phase 3 makes this pane
    **every** key-entry surface, and "Remove all stored keys" in step 7 already spans them
    because it clears every `SecretId`.

**Do NOT.**
- Do **not** put a `preference=` attribute on any key field. A binding writes the key to
  `prefs.js` in plaintext — forbidden by D5 and by `docs/09` §1.7 tier 4
  (`docs/08` §7.5 rule 6).
- Do **not** offer a "copy key" affordance and do **not** place a key on the clipboard
  (`docs/09` §1.9 rule 7).
- Do **not** call `SecretStore.get()` to populate a field (`docs/09` §1.9 rule 2).
- Do **not** use a sticky reveal toggle; `docs/08` §7.5 rule 1 requires hold-to-show, because a
  sticky toggle survives into screenshots.
- Do **not** paraphrase, shorten or soften the §1.8 residual-risk text, and do **not** hide its
  first paragraph behind "Learn more" (`docs/09` §1.9 rule 4).
- Do **not** hardcode a provider's base URL here, and do **not** *resolve* `<provider>.baseUrl`
  in this pane. `docs/07` §8.5 owns the row; `docs/03` §14.4 puts resolution in the single
  transport function (`P3-T06`). This card edits and validates the value, nothing more.
- Do **not** accept a base-URL override that is not `https://`, or one carrying a trailing
  slash. `docs/03` §14.4: the plugin "must not send a key to a host the user has not explicitly
  configured", which is why the value is checked at write time and not at call time.
- Do **not** treat the base-URL input as a credential field. It carries a `preference` binding
  by design (`docs/08` §7.3's comment on `rh-or-base-url`); the *key* field is the one that
  must never have one.
- Do **not** put `<!DOCTYPE>` in the pane fragment, and remember XUL is the default namespace
  (`docs/08` §7.3).

**Done when.**
- [ ] Entering a key, closing and reopening the pane shows `sk-…••••1a2b`-style masking and
      never the full value.
- [ ] The profile's `prefs.js` contains no substring of any entered key after the pane is used.
- [ ] The badge names the active tier and turns warning-coloured when `secretBackend` is
      `session` or `passphrase`.
- [ ] "Remove all stored keys" clears every provider and reports an exact count.
- [ ] The §1.8 text appears in the pane character-for-character identical to `docs/09` §1.8.
- [ ] Every `preference=` attribute in `preferences.xhtml` names a row that exists in
      `docs/07` §8.5, asserted by a test that parses the XHTML against `src/prefs/keys.ts`.
- [ ] Each of the four provider blocks carries a base-URL input bound to
      `<provider>.baseUrl` whose placeholder is that provider's documented base URL; entering
      `http://proxy.example/v1` or `https://proxy.example/v1/` is rejected with a message, and
      `https://proxy.example/v1` is stored and read back.
- [ ] The NCBI and Semantic Scholar key fields store, mask and clear through the `SecretStore`,
      set `ncbi.keyPresent` / `semanticscholar.keyPresent`, and carry no `preference=`
      attribute — asserted by the same XHTML-parsing test.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- prefKeyBinding && npm run test:integration -- --grep prefsPaneKeys
```
Then, manually: open Preferences → Research Helper, enter an OpenRouter key, confirm the mask,
reopen the pane, confirm the mask persists and the badge reads "Protected by Windows Credential
Manager", press "Remove all stored keys", confirm the reported count.

**Notes — changed 2026-09-09; the `<provider>.baseUrl` gap is closed.** This card previously
shipped the pane **without** a base-URL control and recorded the absence as a defect in the
source documents: `docs/11` Phase 3 and FR-29 both promised a per-provider override, `docs/07`
§8.5 declared no such row, and README §5 rule 2 forbids inventing one. The documentation pass
added all four rows — `openrouter.baseUrl`, `openai.baseUrl`, `gemini.baseUrl`,
`anthropic.baseUrl`, each `string`, default `""`, allowed "an absolute `https://` URL with no
trailing slash, or empty". `docs/08` §7.3 now ships the `rh-or-base-url` markup with its
`preference` binding and placeholder, `docs/03` §14.4 owns resolution and the two rules on an
overridden value, and `docs/11` Phase 3 names the key explicitly in its deliverable. Nothing is
invented here any more and the control ships.

The one thing this card must **not** absorb is resolution. `docs/03` §14.4 keeps base-URL
resolution in the single transport function so that no adapter ever carries a literal host;
`P3-T06` builds that resolver, and `P3-T15` makes the pre-flight egress dialog name the
*effective* host whenever an override is in effect.

FR-36's "one-time consent…recorded in prefs" was the same class of gap and is also closed:
`privacy.egressAcknowledged` now exists in §8.5 and `P3-T15` owns it. This card writes neither
that row nor any consent key.

**Estimate — re-estimated 2026-09-09 from 1.0 d to 1.75 d, and here is the derivation.** The
1.0 d figure was written when this card shipped four LLM provider key fields and nothing else.
It now also ships four `<provider>.baseUrl` controls with write-time validation, the NCBI and
Semantic Scholar key fields, and six `role="status"` elements. §4 item 9 recorded the gap and
the owner settled it on 2026-09-09 by re-estimating rather than by accepting the card as
knowingly optimistic — the same decision, and for the same reason, as the 2026-09-09 roadmap
correction. Two independent routes to the number, in developer-days of one focused 6-hour day:

*Bottom-up from the `Do` steps and the `Done when` criteria.*

| Work | d |
|---|---|
| Pane markup (step 1, step 10, step 11): four provider blocks of seven controls each, plus the NCBI and Semantic Scholar groupboxes, in XUL-default-namespace XHTML with no `<!DOCTYPE>` | 0.25 |
| `keyFieldController.ts` (steps 2–3): trim, `Bearer ` strip, `set()`, masked-digest render, hold-to-show reveal, clear — written once and bound to six credential fields | 0.30 |
| `prefsController.ts` (steps 4–5, 7–8): backend badge, six status rows painted imperatively, remove-all with an exact count, empty-after-restore state | 0.30 |
| Base-URL controls and their write-time validation (step 10): four `type="url"` inputs with per-provider placeholders, `https://`-only and no-trailing-slash rejection with a message | 0.20 |
| Fluent strings in `en-US` and `ko-KR` (step 6), including the §1.8 residual-risk text transcribed character-for-character | 0.15 |
| `prefs.js`, `schema.ts`, `keys.ts` (steps 9–10): seventeen `pref()` lines transcribed from `docs/01` §7.2, four schema rows, four key constants | 0.10 |
| Tests: the XHTML-parsing unit test that checks every `preference=` against `src/prefs/keys.ts`, plus `prefsPaneKeys.spec.ts` covering the eight non-typecheck `Done when` boxes | 0.35 |
| The developer's own share of the **Verify with** manual pass — enter, mask, reopen, badge, remove-all count — excluding the human's key-entry gate itself | 0.15 |
| **Total** | **1.80 → 1.75** |

*Top-down from what was added to the 1.0 d card.* Base-URL controls, validation and their
schema/keys rows ≈ 0.20 d; two further credential groupboxes with their own `keyPresent` flags
≈ 0.20 d; six `role="status"` elements ≈ 0.15 d; the extra `pref()` lines and the extra
`Done when` assertions ≈ 0.15 d. That is +0.70 d on 1.0 d = 1.70 d.

The two routes land 0.10 d apart, so **1.75 d** at the corpus's 0.25 d granularity. No padding
was added: review latency and the human's key-entry wait are excluded per `README.md` §7, and
nothing here is contingency. Cross-check against comparable cards — `P1-T20` (Search & Import
window markup and controls) is 1.0 d and `P2-T14` (that window's chips, badges and per-source
status) is 1.5 d; this card is a larger surface than either, with six credential fields, two
locales, a validated URL control and two test suites, so landing above both is consistent
rather than inflated.

---

### P3-T05 — LLM error taxonomy and the retry/backoff policy

| Field | Value |
|---|---|
| **ID** | `P3-T05` |
| **State** | `TODO` |
| **Depends on** | `P3-T01` |
| **Blocks** | `P3-T06`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T17` |
| **Retires** | part of `R-4`, part of `R-6` |
| **Implements** | `FR-34` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Every provider failure lands on exactly one shipped error class, and retry is driven
by that class rather than by string-matching a provider message.

**Read first.**
- `docs/07-architecture-and-data-model.md` §10.1 — the shipped hierarchy. This is the sole
  authority for class names and constructor signatures; note `LLMError(providerId, modelId,
  message, ctx?)` and that `StructuredOutputError` inherits it and adds no parameters
- `docs/03-llm-provider-integration.md` §11.5 — the unified taxonomy table the adapters
  normalize onto, plus the three named traps (Anthropic 529, HTTP-200 refusals, spend-cap
  masquerading as a rate limit)
- `docs/03-llm-provider-integration.md` §14.1 authority note — the `ErrorCategory` →
  shipped-class mapping table, and the explicit statement that `StructuredOutputError` is
  `retryable` but is deliberately **not** in the transport retry set
- `docs/03-llm-provider-integration.md` §11.6 — the retry policy: full jitter, `retry-after`
  always wins, no retry on `context_length`, total wall-clock budget
- `docs/07-architecture-and-data-model.md` §7.3 "429 / `Retry-After` handling" — `penalize()`
  parks every waiter on that host, so retry cooperates with the token bucket instead of racing it

**Files.**
- modify `src/core/errors.ts`
- create `src/llm/shared/errorMap.ts`
- modify `src/core/rateLimit/backoff.ts`
- modify `src/core/http/retry.ts`
- create `test/unit/llm/errorMap.spec.ts`

**Do.**
1. Add the LLM branch of `docs/07` §10.1 to `src/core/errors.ts` if Phase 1 did not:
   `LLMError`, `ContextLengthExceededError`, `ContentFilterError`, `StructuredOutputError`.
2. Write `mapProviderError(providerId, modelId, status, headers, body)` in
   `src/llm/shared/errorMap.ts`, returning the shipped class per the §14.1 mapping table.
3. Handle Anthropic **529** explicitly as `UpstreamServerError`.
4. Distinguish `spend_cap` from `rate_limit`: a 429 carrying
   `error.details.error_code === "enforced_spend_limit_reached"` (Anthropic) or a 402 with
   insufficient credits (OpenRouter) becomes a non-retryable `QuotaExceededError` with its own
   message key.
5. Detect refusals and content filtering from `stop_reason` / `finish_reason` / `finishReason`
   on **HTTP 200** responses, never from a status code.
6. Parse `Retry-After` (both delta-seconds and HTTP-date forms) into `RateLimitError.retryAfterMs`
   and feed it to `limiter.penalize()`.
7. Implement `withRetry` using full jitter over `min(cap, base * 2^attempt)`, taking
   `max(serverDelay, jittered)`, with the retryable set exactly
   `{rate_limit, overloaded, server, network}` and a total wall-clock cap for the batch.

**Do NOT.**
- Do **not** put `StructuredOutputError` in the transport retry set. Its retry is the one-shot
  repair prompt in `docs/12` §18.3, at a different layer; retrying it in the transport re-sends
  the same malformed request (`docs/03` §14.1 authority note).
- Do **not** retry `context_length`. Re-chunk and re-issue — "a retry of the identical
  oversized request always fails" (`docs/03` §11.6).
- Do **not** construct `StructuredOutputError(message, ctx)`. The two-argument form does not
  compile and would strip the two fields that make a user's bug report actionable
  (`docs/07` §10.1).
- Do **not** treat `status >= 500` as covering Anthropic overload — it is 529, and generic
  `=== 503` logic misses it too (`docs/03` §11.5 trap 1).
- Do **not** retry a 401. `AuthenticationError` is `retryable: false`; the job pauses with
  reason `credential-required` and the key is **not** deleted (`docs/09` §2.4).
- Do **not** use "exponential + small random". With a 100-paper batch, unjittered backoff
  synchronizes retries into a thundering herd (`docs/03` §11.6).
- Do **not** let a retry happen below the per-host token bucket — Zotero's own retry machinery
  stays disabled (`successCodes: false`, `noRetryOnThrottle: true`, `errorDelayMax: 0`,
  `docs/07` §7.4).

**Done when.**
- [ ] A table-driven test maps one recorded error body per provider per category onto the
      expected shipped class, for all twelve `ErrorCategory` values.
- [ ] A 529 body maps to `UpstreamServerError` with `retryable === true`.
- [ ] An Anthropic 429 carrying `enforced_spend_limit_reached` maps to `QuotaExceededError`
      with `retryable === false`.
- [ ] An HTTP-200 response with `stop_reason: "refusal"` maps to `ContentFilterError` and is
      not retried.
- [ ] `withRetry` honours a `Retry-After: 30` header over its own computed backoff, asserted
      with a fake clock.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- errorMap
```

**Notes.** `docs/03` §14.1's flat `LLMError(category, message, opts)` is a *working name for
the whole family*, not a second design. Do not create it. Where `docs/03` and `docs/07`
disagree on a name, `docs/07` wins (README §5 rule 3).

---

### P3-T06 — `LLMProvider` contract, registry, router, mock harness

| Field | Value |
|---|---|
| **ID** | `P3-T06` |
| **State** | `TODO` |
| **Depends on** | `P3-T05` |
| **Blocks** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T17` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29`, `FR-33`, part of `FR-32` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** One provider-agnostic contract exists, with a registry, a model-tier resolver, and a
scripted mock that lets every later card be tested without a network call or a cent of spend.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.3 — **the shipped `LLMProvider` contract.** Every
  member name and signature comes from here: `chat` / `chatStream`, `validateCredentials`,
  `listModels`, `getModel`, `countTokens(text, modelId)`, plus `ModelInfo`, `ModelDataPolicy`,
  `ChatRequest`, `ChatResponse`, `LLMCallContext`, `BudgetGuard`, `CredentialCheckResult`
- `docs/03-llm-provider-integration.md` §14.1 authority note — the explicit warning that
  §14's shorter names (`complete`/`stream`, `validateKey`, `contextWindow`, `pricing`,
  `supportsJSONSchema`) are a pre-consolidation sketch and that doc 07 wins
- `docs/03-llm-provider-integration.md` §10.2 authority note — the same rule for the one member
  §14.1's note does not reach: "do not implement the signature below", `countTokens` is doc 07
  §4.3's synchronous `(text, modelId) => number`, the `{ tokens, exact }` shape is superseded,
  and with no `exact` flag on the return **every result is treated as inexact at the call
  site**. Do not widen `LLMProvider` to carry the flag
- `docs/03-llm-provider-integration.md` §14.3 — the five things every adapter must normalize
  (system-prompt placement, max-output naming, text extraction, usage, stop reason) plus the
  effort-scale and JSON-dialect traps
- `docs/03-llm-provider-integration.md` §14.4, closing paragraph — **"Base URLs are resolved
  here, not hardcoded in the adapters."** Each adapter asks for its base URL and gets
  `<provider>.baseUrl` when non-empty and this document's documented default otherwise (§2.1
  OpenAI, §3.1 Anthropic, §4.1 Gemini, §5.1 OpenRouter), plus the two rules on an overridden
  value: `https://` only, and the egress dialog names the effective host
- `docs/03-llm-provider-integration.md` §16 "Recommended defaults" — the two-model split
  (`summaryModel` for the map pass, `reportModel` for the synthesis pass) this router resolves
- `docs/12-prompt-library.md` §18.5 — the tier-to-pref mapping (`cheap`/`standard` to
  `summaryModel`, `strong` to `reportModel`) and the full `screening.model` fallback chain
- `docs/13-testing-build-and-release.md` §2.2 "Deterministic LLM mocking" — the `mockLLM`
  script shape and the list of behaviours it has to make testable
- `docs/07-architecture-and-data-model.md` §11.2 — what adding a provider must cost, which is
  the check on whether this abstraction sits at the right level

**Files.**
- create `src/llm/types.ts`
- create `src/llm/registry.ts`
- create `src/llm/router.ts`
- create `src/llm/shared/baseUrl.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/model/ids.ts`
- modify `src/model/usage.ts`
- create `test/helpers/mockLLM.ts`
- create `test/unit/llm/router.spec.ts`

**Do.**
1. Transcribe `docs/07` §4.3 into `src/llm/types.ts` unchanged, re-exporting `ProviderId` and
   `Usage` from `src/model/`.
2. Implement `LLMRegistry`: register by `ProviderId`, look up the active provider from the
   `llmProvider` pref, and expose `isConfigured()` per provider.
3. Implement the model-tier resolver in `router.ts`: `cheap`/`standard` resolve
   `summaryModel` then `<provider>.model`; `strong` resolves `reportModel` then
   `<provider>.model`; `RELEVANCE_SCREEN` consults `screening.model` first and then walks the
   whole remaining chain.
4. Implement `chat()` dispatch through the registry, including the `MissingCredentialError`
   path FR-33 requires when no provider is configured.
5. Implement `test/helpers/mockLLM.ts`: a scripted `LLMProvider` that records calls and replays
   a list of `ChatResponse` values or `Error`s, sufficient to exercise retry-then-succeed,
   context-length-then-reshrink, budget-stop, cancel-at-87-of-200 and schema-violation.
6. Add an ESLint `no-restricted-imports` rule keeping `src/llm/**` free of Zotero globals, per
   the `docs/07` §2.3 dependency rule.
7. Implement `resolveBaseUrl(providerId)` in `src/llm/shared/baseUrl.ts` per `docs/03` §14.4:
   return `<provider>.baseUrl` when that preference is non-empty, and this document's documented
   default for that provider otherwise (§2.1, §3.1, §4.1, §5.1). Read the pref through the
   `PrefStore` port, refuse a non-`https://` value by falling back to the documented default and
   logging once, and export the resolved host so `P3-T15`'s egress dialog can name it. Every
   adapter takes its base URL from here; `P3-T04` owns the pane control that sets the pref.

**Do NOT.**
- Do **not** let an adapter hold a literal base URL. `docs/03` §14.4: "Base URLs are resolved
  here, not hardcoded in the adapters" — one resolver, so a corporate-gateway user changes one
  preference and every provider path follows.
- Do **not** type straight from `docs/03` §14.1's sketch. It says `complete`, `stream`,
  `validateKey`, `contextWindow`, `pricing`, `supportsJSONSchema`; the shipped names are
  `chat`, `chatStream`, `validateCredentials`, `contextWindowTokens`, `inputCostPerMTokUsd` /
  `outputCostPerMTokUsd`, `supportsJsonSchema`. Typing from the sketch builds a parallel, wrong
  type system (README §5 rule 3).
- Do **not** add a third model tier. `docs/03` §16 sanctions exactly two; `screening.model` is
  an opt-in override on the cheap end, not a tier (`docs/12` §3, §18.5).
- Do **not** let the screening resolver skip `summaryModel` and fall straight through to
  `<provider>.model` — that silently promotes the highest-volume call in the plugin to the
  expensive model for every user who configured a cheap summary model (`docs/12` §3).
- Do **not** bundle a provider SDK. Hand-rolled adapters over one transport function are R-13's
  mitigation and `docs/03` §14.4's design.
- Do **not** let any test call a real provider. `docs/13` §4: "no test at any layer performs a
  live network call", except the separately scheduled `live-contract` job.
- Do **not** silently fail over to a different provider. Changing the destination changes the
  data-egress decision, which is the user's to make (`docs/09` §2.4 rule 6).

**Done when.**
- [ ] `src/llm/types.ts` compiles against a stub implementation with every member of
      `docs/07` §4.3 present and none absent.
- [ ] `resolveModel("cheap")` returns `summaryModel` when set and `<provider>.model` when not;
      `resolveModel("strong")` does the same for `reportModel`; the screening resolver walks
      all three links — each asserted in a unit test.
- [ ] Invoking an LLM feature with no key throws `MissingCredentialError` and issues zero HTTP
      requests.
- [ ] `mockLLM` drives a five-call script including one thrown `RateLimitError` and one
      `StructuredOutputError`, and records request bodies for assertion.
- [ ] The ESLint dependency rule fails on a `Zotero.` reference inside `src/llm/`.
- [ ] `resolveBaseUrl()` returns the `docs/03`-documented default for each of the four providers
      when `<provider>.baseUrl` is empty, the stored value when it is a valid `https://` URL, and
      the documented default again when the stored value is `http://…` — asserted with a stubbed
      `PrefStore`.
- [ ] A repository grep finds no literal provider host in `src/llm/*/`; every adapter reaches its
      base URL through `resolveBaseUrl()`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- llm/router
```

**Notes.** `docs/11` names the modules `src/llm/provider.ts`, `src/llm/pricing.ts` and
`src/core/budget.ts`. `docs/07` §2.2's tree is the architecture authority and uses
`src/llm/types.ts`, `src/llm/shared/tokenEstimate.ts` and `src/pipeline/shared/budget.ts`;
follow the tree and read the roadmap's paths as prose.

---

### P3-T07 — OpenRouter adapter (the default provider)

| Field | Value |
|---|---|
| **ID** | `P3-T07` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T15`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The default provider (decision D6) works end to end: authenticated chat with
restrictive routing, a parsed model catalogue with real prices, and exact per-call cost from
`usage.cost`.

**Read first.**
- `docs/03-llm-provider-integration.md` §5.1–§5.4 — base URL, auth and attribution headers
  (including the unresolved `X-Title` / `X-OpenRouter-Title` question and the instruction to
  send both), request shape, response shape
- `docs/03-llm-provider-integration.md` §7.4 — the silent-degradation trap and
  `provider.require_parameters: true`, "the difference between structured output and usually
  structured output"
- `docs/09-security-privacy-and-api-keys.md` §3.4 rules 1 and 2 — `data_collection: "deny"` on
  **every** request in **every** privacy mode, `zdr: true` in strict mode, and the requirement
  that the guardrail 404 be keyed off status plus structured fields, not a substring
- `docs/03-llm-provider-integration.md` §9.4 — the catalogue: `pricing.prompt` /
  `pricing.completion` as per-token decimal **strings**, `pricing.overrides[]` long-context
  tiers, `supported_parameters` as the authoritative `structured_outputs` flag,
  `top_provider.max_completion_tokens`, and the Anthropic dot-slug rule
- `docs/03-llm-provider-integration.md` §11.4 — no `X-RateLimit-*` on success; poll
  `GET /api/v1/key` for credit monitoring instead
- `docs/00-overview.md` §3 D6 — why OpenRouter is the default, and the standing instruction to
  invert OpenRouter's own `"allow"` default
- `docs/03-llm-provider-integration.md` §14.4 — the single `httpPost` choke point, including
  `successCodes: false` and the `getAllResponseHeaders()` string-parsing trap

**Files.**
- create `src/llm/openrouter/openRouterProvider.ts`
- create `src/llm/openrouter/mapper.ts`
- create `src/llm/openrouter/catalogue.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- create `test/unit/llm/openrouter.spec.ts`

**Do.**
1. Implement `chat()` against `POST /api/v1/chat/completions` with `Authorization: Bearer`,
   `Content-Type`, `HTTP-Referer`, and **both** `X-Title` and `X-OpenRouter-Title`.
2. Attach a `provider` block on every request: `data_collection: "deny"` always,
   `require_parameters: true` whenever `responseFormat.kind === "json_schema"`, and `zdr: true`
   when the effective privacy mode is strict (`P3-T15` computes the mode).
3. Map `ProviderRoutingHints.allowProviders` / `denyProviders` onto `provider.only` /
   `provider.ignore`.
4. Normalize the response per `docs/03` §14.3: flat `text` from `choices[0].message.content`,
   `finishReason` from `finish_reason`, `usage` from `prompt_tokens` / `completion_tokens`, and
   `servedBy` from the routing metadata.
5. Implement `listModels()` over the **unauthenticated** `GET /api/v1/models`: parse
   `pricing.*` as strings then multiply by 1e6 for $/1M, carry `pricing.overrides[]`, set
   `supportsJsonSchema` from `supported_parameters.includes("structured_outputs")`,
   `maxOutputTokens` from `top_provider.max_completion_tokens`, `contextWindowTokens` from
   `context_length`.
6. Populate `ModelInfo.dataPolicy` from the endpoint's declared policy; where it is undeclared
   set `trainsOnInputByDefault: "unknown"` rather than guessing.
7. Map a guardrail 404 onto a `BadRequestError` whose message names the cause and both ways
   out, keyed off the 404 status **plus** the error body's structured fields.
8. Register `openrouter.ai` in the host limiter with the LLM-host policy of `docs/07` §7.3.

**Do NOT.**
- Do **not** omit `provider.data_collection: "deny"`. OpenRouter's own default is `"allow"`,
  which permits providers that store data non-transiently and may train on it
  (`docs/00` §3 D6, `docs/09` §3.3, §3.4 rule 1).
- Do **not** send `response_format` without `provider.require_parameters: true`. A provider
  that does not support it "may simply ignore it and return prose. There is no error"
  (`docs/03` §7.4 caveat 2).
- Do **not** substring-match the guardrail error sentence. `docs/09` §3.3 records the literal
  string as seen only in search excerpts, and §3.4 rule 2 requires keying off status plus
  structured fields.
- Do **not** derive an Anthropic slug by naive prefixing. `claude-haiku-4-5` is
  `anthropic/claude-haiku-4.5` — a **dot** — and naive prefixing 404s on exactly the model
  `docs/03` §16 recommends for Anthropic-only users (`docs/03` §9.4).
- Do **not** default to `~openai/gpt-latest` or any floating alias: it "silently changes cost
  and capability under you" (`docs/03` §5.5) and breaks the cache contract (`docs/06` §11.1).
- Do **not** hardcode a model ID or a price. Fetch the catalogue (README §5 rule 4).
- Do **not** ignore `pricing.overrides[]` — an estimator that does will under-quote every
  long-context run (`docs/03` §9.4).
- Do **not** conflate OpenRouter's private "Input & Output Logging" with the 1 % discount
  "OpenRouter Use of Inputs/Outputs" setting in any string (`docs/09` §3.3).

**Done when.**
- [ ] A wire-shape snapshot asserts the exact request body for a fixed prompt, including
      `provider.data_collection === "deny"` and `provider.require_parameters === true` under a
      `json_schema` request.
- [ ] A test asserts `zdr: true` appears in strict mode and is absent in balanced mode.
- [ ] `listModels()` over the recorded catalogue fixture yields `inputCostPerMTokUsd` equal to
      `Number(pricing.prompt) * 1e6` and preserves an `overrides` entry.
- [ ] `toOpenRouterSlug("claude-haiku-4-5") === "anthropic/claude-haiku-4.5"` and
      `toOpenRouterSlug("gpt-5.6-terra") === "openai/gpt-5.6-terra"`.
- [ ] A recorded guardrail-404 fixture produces a `BadRequestError` naming both remedies, with
      no substring match on the provider's sentence.
- [ ] `usage.cost` from the recorded response reaches `Usage` unrounded.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/openrouter
```

**Notes.** The attribution-header ambiguity is marked **Unverified** in `docs/03` §5.2; sending
both headers costs nothing because unknown headers are ignored, so this card resolves the
marker by shipping both rather than by choosing. `GET /api/v1/models` needs no key, which is
what makes OpenRouter usable as the pricing source for all four providers in `P3-T13`.

---

### P3-T08 — OpenAI adapter (Responses API)

| Field | Value |
|---|---|
| **ID** | `P3-T08` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** OpenAI works through the same internal code path as OpenRouter, differing only in the
adapter.

**Read first.**
- `docs/03-llm-provider-integration.md` §2.1–§2.4 — base URL, why `POST /v1/responses` is the
  right surface rather than Chat Completions, auth headers, request and response shapes
- `docs/03-llm-provider-integration.md` §2.6 — reasoning tokens are billed as output, which
  changes how `Usage` is filled
- `docs/03-llm-provider-integration.md` §7.1 and §7.5 — Structured Outputs on the Responses
  surface live at `text.format`, not `response_format`
- `docs/03-llm-provider-integration.md` §9.1 — `GET /v1/models` returns IDs only, mixed with
  embedding/TTS/image models; the adapter must filter and enrich from elsewhere
- `docs/03-llm-provider-integration.md` §14.3 — text extraction from `output[].content[].text`
  and the effort-scale trap (`none`/`minimal` 400 on OpenAI)
- `docs/03-llm-provider-integration.md` §11.2 — tier-1 accounts have low TPM on flagship
  models, so rate limiting must be assumed rather than treated as exceptional

**Files.**
- create `src/llm/openai/openAiProvider.ts`
- create `src/llm/openai/mapper.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- create `test/unit/llm/openai.spec.ts`

**Do.**
1. Implement `chat()` against `POST /v1/responses` with `Authorization: Bearer`, placing the
   system content as a `role: "system"` entry in `input`.
2. Map `maxOutputTokens` onto `max_output_tokens`, clamped to `ModelInfo.maxOutputTokens`.
3. Map the shared `Effort` union onto OpenAI's five levels through a function.
4. Extract flat text by filtering `output[].content[]` for message / `output_text` blocks.
5. Fill `Usage` from `input_tokens` / `output_tokens`, counting reasoning tokens as output.
6. Map `status` plus `incomplete_details` onto the `finishReason` union, keeping truncation
   visible to the caller.
7. Implement `listModels()` over `GET /v1/models`, dropping anything matching
   `/embedding|tts|transcribe|whisper|image|realtime|moderation|audio/`, leaving context and
   price enrichment to `P3-T13`.
8. Register `api.openai.com` in the host limiter.

**Do NOT.**
- Do **not** use `response_format` on the Responses surface — the field is `text.format`
  (`docs/03` §7.5).
- Do **not** forward the shared `Effort` string unmapped. `none` and `minimal` exist in the
  union only so the Gemini path has somewhere to land, and OpenAI 400s on them
  (`docs/03` §14.3).
- Do **not** present `GET /v1/models` output as a picker without filtering and enrichment — it
  carries no context window, no pricing and no capability flags (`docs/03` §9.1).
- Do **not** omit reasoning tokens from output cost (`docs/03` §2.6).
- Do **not** hardcode a model ID outside `addon/prefs.js`'s seed default; §8.5 calls those
  "seed defaults only".

**Done when.**
- [ ] A wire-shape snapshot matches the committed snapshot, with `max_output_tokens` present
      and `max_tokens` absent.
- [ ] A recorded truncated response (`incomplete_details`) yields `finishReason: "length"`.
- [ ] `listModels()` over the recorded fixture excludes every embedding, audio and image entry.
- [ ] An `Effort` of `minimal` is mapped, not forwarded, asserted on the request body.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/openai
```

**Notes.** OpenAI has no pre-flight count endpoint and bundling `tiktoken` is impractical in a
Zotero plugin (`docs/03` §10.1), so `countTokens()` here is simply the shared heuristic from
`src/llm/shared/tokenEstimate.ts`, returned through `docs/07` §4.3's shipped signature —
synchronous, a bare `number`, no `exact` flag (that flag belongs to `docs/03` §10.2's
pre-consolidation sketch, which **§10.2's own authority note now overrides** — "do not implement
the signature below", doc 07 §4.3 wins — as does §14.1's; see `P3-T09` Notes). Treat the result
as inexact at every call site, which is what §10.2's note says the missing flag means. Improving
the number is `P3-T13`'s rolling calibration, not a gap in this adapter.

---

### P3-T09 — Anthropic adapter (Messages API)

| Field | Value |
|---|---|
| **ID** | `P3-T09` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Anthropic works through the same internal path, and supplies the only exact, free
pre-flight token count available to the plugin.

**Read first.**
- `docs/03-llm-provider-integration.md` §3.1–§3.4 — base URL, the required
  `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access`, the **required**
  `max_tokens`, and `system` as a top-level field rather than a message
- `docs/03-llm-provider-integration.md` §7.2 — native structured outputs via
  `output_config.format`, with strict tool use as the documented fallback
- `docs/03-llm-provider-integration.md` §9.2 — the model list carries `max_input_tokens` (there
  is **no** `context_window` field) and `max_tokens`, and auto-paginates via `has_more` /
  `last_id`
- `docs/03-llm-provider-integration.md` §10.1 — `POST /v1/messages/count_tokens` is exact and
  free; this is the only provider that has such an endpoint at all
- `docs/07-architecture-and-data-model.md` §4.3 — the **shipped** `countTokens(text: string,
  modelId: string): number`: synchronous, returning a bare number, "best-effort token count for
  budgeting. Falls back to a heuristic." `docs/03` §10.2's `{ tokens, exact }` design
  recommendation and §14.1's `countTokens(req): Promise<…>` are the pre-consolidation sketch
  that **§10.2's own authority note** and §14.1's both override — doc 07 wins
  (README §5 rule 3) — and §10.2 adds the call-site rule that follows from it: with no `exact`
  flag on the return, every `countTokens()` result is treated as inexact
- `docs/03-llm-provider-integration.md` §11.1 and §11.5 traps 1 and 3 — HTTP 529 for overload,
  and the spend-cap 429 carrying `enforced_spend_limit_reached` with no `retry-after`
- `docs/03-llm-provider-integration.md` §14.3 — Anthropic's usage block must be summed across
  the cache fields; `input_tokens` is not total input
- `docs/09-security-privacy-and-api-keys.md` §3.3 "Anthropic" — feedback signals are the one
  carve-out in the no-training commitment, so the plugin must have no such feature

**Files.**
- create `src/llm/anthropic/anthropicProvider.ts`
- create `src/llm/anthropic/mapper.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- create `test/unit/llm/anthropic.spec.ts`

**Do.**
1. Implement `chat()` against `POST /v1/messages` with `x-api-key`,
   `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`.
2. Lift the system message out of `messages` into the top-level `system` field.
3. Always send `max_tokens`.
4. Implement structured output via `output_config.format`, with strict tool use as fallback.
5. Implement the interface member `countTokens(text, modelId)` exactly as `docs/07` §4.3
   declares it — **synchronous, returning `number`** — delegating to the shared heuristic in
   `src/llm/shared/tokenEstimate.ts` (`P3-T13`). Then add the exact path as an
   **adapter-private async helper** over `POST /v1/messages/count_tokens`, not as a second
   member of `LLMProvider`: it is free and exact (`docs/03` §10.1), and it is the only such
   endpoint the plugin has. Fall back to the heuristic on any failure, and see Notes for the
   conflict this resolves.
6. Implement `listModels()` with `has_more` / `last_id` pagination, reading `max_input_tokens`
   into `contextWindowTokens` and `max_tokens` into `maxOutputTokens`.
7. Sum `input_tokens` with the cache-read and cache-write counts when filling `Usage`.
8. Register `api.anthropic.com` in the host limiter.

**Do NOT.**
- Do **not** send `system` as a `role: "system"` message — it is a top-level field
  (`docs/03` §3.3).
- Do **not** omit `max_tokens`; it is required here unlike OpenAI and Gemini, which is why
  `maxOutputTokens` is mandatory in the normalized request (`docs/03` §14.3).
- Do **not** look for `context_window` in the model list; the field is `max_input_tokens`
  (`docs/03` §9.2).
- Do **not** report `input_tokens` as total input (`docs/03` §14.3).
- Do **not** bump `anthropic-version` opportunistically (`docs/03` §3.2).
- Do **not** build a thumbs-up/down or feedback affordance (`docs/09` §3.3).
- Do **not** retry a 429 carrying `enforced_spend_limit_reached` — it fails until the next
  month (`docs/03` §11.1).

**Done when.**
- [ ] A wire-shape snapshot shows `system` at the top level and `max_tokens` always present.
- [ ] `countTokens("…", modelId)` type-checks against `docs/07` §4.3's declaration — sync,
      returning `number` — and a stub implementation of `LLMProvider` compiles with no extra
      member.
- [ ] The adapter-private exact counter returns the recorded fixture's server-side count and, on
      a stubbed transport failure, returns the shared heuristic's value instead of throwing.
- [ ] `listModels()` follows two pages of a recorded paginated fixture and returns the union.
- [ ] A recorded usage block with cache fields yields a total input count greater than
      `input_tokens`.
- [ ] A recorded 529 body produces a retryable `UpstreamServerError`; a recorded spend-cap 429
      produces a non-retryable `QuotaExceededError`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/anthropic
```

**Notes.** This is the only exact pre-flight count in the plugin, so `P3-T16`'s estimator may
use it to calibrate the heuristic even when the run targets another provider — as calibration
only, never as a gate, because `docs/03` §10.2 forbids gating hard behaviour on an inexact or
foreign count.

**The `exact` flag has no home on the shipped contract, and `docs/03` now says so itself.**
§10.2's design recommendation and §14.1's sketch both give `countTokens` an `{ tokens, exact }`
return and make it a promise; `docs/07` §4.3 — the sole authority for types (README §5 rule 3) —
declares `countTokens(text, modelId): number`, synchronous. **§10.2 gained its own authority
note on 2026-09-09** — "do not implement the signature below", the `{ tokens, exact }` shape is
"a working design from before that consolidation", and where the two disagree "doc 07 §4.3
wins" — which is the same rule §14.1 already stated for the rest of the adapter interface. The
note also settles what the missing flag means for callers: **every `countTokens()` result must
be treated as inexact**, which costs nothing because §10.2's policy already forbids gating hard
behaviour on the count. A synchronous method cannot make a network call, so the interface member
is the heuristic and the exact endpoint is an adapter-private helper reached by the estimator.
**This card must not add a member to `LLMProvider` to carry `exact`**; if the owner wants the
flag on the contract, that is a change to `docs/07` §4.3 first, and then to `P3-T06`, not a
local widening here. (`plan/04` §4 item 8 tracked this and is now closed.)

---

### P3-T10 — Gemini adapter (Interactions API)

| Field | Value |
|---|---|
| **ID** | `P3-T10` |
| **State** | `TODO` |
| **Depends on** | `P3-T02`, `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T11`, `P3-T12`, `P3-T13`, `P3-T14`, `P3-T15`, `P3-T30` |
| **Retires** | part of `R-13` |
| **Implements** | `FR-29` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Gemini works through the same internal path, with the key in a header only, and with
the free/paid tier determined — or conservatively assumed free — before the first call.

**Read first.**
- `docs/03-llm-provider-integration.md` §4.1–§4.4 — base URL, the Interactions API as primary
  with `generateContent` as a documented fallback, `system_instruction`, and the
  `generation_config` field list including `thinking_level`
- `docs/03-llm-provider-integration.md` §4.2 — the `x-goog-api-key` header, and the explicit
  "Do not use it" on the `?key=` query parameter
- `docs/09-security-privacy-and-api-keys.md` §2.1 "URLs" — why: query-string keys land in proxy
  logs, `Zotero.HTTP` error messages, `Zotero.getErrors()` output and pasted bug reports
- `docs/09-security-privacy-and-api-keys.md` §3.3 "Google Gemini" — the paid/unpaid split, that
  the trigger is a **billing-linked Cloud project** rather than a billing-enabled account, and
  that free-tier content is used for product improvement with human reviewers
- `docs/09-security-privacy-and-api-keys.md` §3.4 rule 4 — tier detection, and that an
  indeterminate result assumes **free** rather than the safer-sounding answer
- `docs/03-llm-provider-integration.md` §9.3 — `GET /v1beta/models`, the `models/` prefix to
  strip, and the `supportedGenerationMethods` filter
- `docs/03-llm-provider-integration.md` §7.3 and §14.3 — Gemini structured output, and the
  uppercase-OpenAPI schema dialect the legacy path needs if it is ever implemented
- `docs/03-llm-provider-integration.md` §11.3 — the free tier's requests-per-day cap is the
  binding constraint, which is why the pipeline must be resumable

**Files.**
- create `src/llm/gemini/geminiProvider.ts`
- create `src/llm/gemini/mapper.ts`
- create `src/llm/gemini/tierDetect.ts`
- modify `src/bootstrap/registerProviders.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- create `test/unit/llm/gemini.spec.ts`

**Do.**
1. Implement `chat()` against `POST /v1beta/interactions` with the key in `x-goog-api-key`,
   `system_instruction` from the system message, and `generation_config.max_output_tokens`.
2. Map the shared `Effort` union onto `thinking_level`'s four values through a function.
3. Set `store: false` on every request so ZDR-approved projects are not broken by the
   Interactions API default (`docs/09` §3.3).
4. Extract flat text from `steps[].content[]` filtered to `model_output`; fill `Usage` from
   `total_input_tokens` / `total_output_tokens`.
5. Implement `listModels()` over `GET /v1beta/models`, filtering on `supportedGenerationMethods`
   containing `generateContent` and stripping the `models/` prefix.
6. Implement `detectTier()`, run before the first Gemini call of a session and whenever the key
   changes; return `"free-or-unknown"` when it cannot be determined.
7. Keep `generateContent` behind one documented fallback function, unused by default.
8. Register `generativelanguage.googleapis.com` in the host limiter.

**Do NOT.**
- Do **not** put the key in a `?key=` query parameter, ever, not even for one debugging call.
  `docs/03` §4.2 and `docs/09` §2.1 both forbid it; `redactUrl()` is a backstop, not a licence.
- Do **not** assume the paid tier when detection is inconclusive (`docs/09` §3.4 rule 4).
- Do **not** infer paid status from the account having a billing method — the trigger is the
  *project* being billing-linked (`docs/09` §3.3).
- Do **not** use Context Caching (`cached_content`), leave File API uploads undeleted, or use
  Grounding with Google Search; each breaks ZDR (`docs/09` §3.3).
- Do **not** forward `xhigh` or `max` to `thinking_level` — Gemini has four levels and 400s on
  the rest (`docs/03` §14.3).
- Do **not** forget to strip the `models/` prefix before storing a model ID (`docs/03` §9.3).

**Done when.**
- [ ] A wire-shape snapshot shows the key only in `x-goog-api-key`, and a test asserts the
      request URL contains no `key=`, `api_key=` or `token=` parameter.
- [ ] `store: false` appears on every request body in the snapshot.
- [ ] `listModels()` over the recorded fixture returns IDs without the `models/` prefix and
      excludes embedding-only and TTS-only entries.
- [ ] `detectTier()` on an inconclusive response returns `"free-or-unknown"`.
- [ ] An `Effort` of `xhigh` is mapped down, not forwarded.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/gemini
```

**Notes.** `docs/09` §3.4 rule 4 carries an **Unverified** marker: it is not known whether the
Gemini API exposes a reliable programmatic billing signal. If none exists, this card is
satisfied by returning `"free-or-unknown"` and letting `P3-T15` ask the user with the answer
defaulted to free/unsure. Do not invent a signal to close the marker.

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
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `chatStream()` yields normalized text deltas from all four providers, and the router
falls back to `chat()` cleanly where it is unavailable.

**Read first.**
- `docs/03-llm-provider-integration.md` §6.1–§6.4 — the four SSE payload shapes: OpenAI's typed
  `event:` lines, Anthropic's Messages event sequence, Gemini's shape and OpenRouter's
  passthrough. The framing is identical; the payloads are not
- `docs/03-llm-provider-integration.md` §6.5 — the Zotero-specific implementation note, which
  decides whether the streaming path uses `fetch` rather than `Zotero.HTTP.request`
- `docs/07-architecture-and-data-model.md` §4.3 — `chatStream?` is **optional** on the shipped
  contract and `ChatStreamChunk` carries `deltaText`, `done` and an optional final `usage`
- `docs/07-architecture-and-data-model.md` §7.4 — cancellation: `token.signal` exists for
  `fetch`-shaped APIs, while the `Zotero.HTTP` path uses `cancellerReceiver`
- `docs/08-ui-ux-spec.md` §6.2 — what the UI does with the stream, and the fallback behaviour
  when streaming is unavailable (a progress bar, identical delivery options)
- `docs/11-implementation-roadmap.md` §4.2 `V-8` — the Phase 0 spike that already answered
  whether SSE is consumable inside Zotero; its report is the authority over any assumption here

**Files.**
- create `src/llm/shared/sse.ts`
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/llm/openai/openAiProvider.ts`
- modify `src/llm/anthropic/anthropicProvider.ts`
- modify `src/llm/gemini/geminiProvider.ts`
- modify `src/llm/router.ts`
- create `test/unit/llm/sse.spec.ts`

**Do.**
1. Write one SSE frame parser in `src/llm/shared/sse.ts` handling `event:` / `data:` lines,
   multi-line data, comments and the terminal event, and yielding raw JSON payloads.
2. Add a per-provider payload mapper turning those payloads into `ChatStreamChunk`.
3. Implement `chatStream()` on each adapter over the transport the Phase 0 `V-8` report
   selected, passing the cancellation signal so an aborted stream really stops.
4. Make the router call `chat()` when `chatStream` is absent or when `ModelInfo.supportsStreaming`
   is false, without the caller branching.
5. Emit the final `usage` on the terminal chunk where the provider supplies it, and reconcile it
   with `BudgetGuard.settle()` in `P3-T16`.

**Do NOT.**
- Do **not** re-parse Markdown on every delta in any consumer — it pins the UI thread
  (`docs/08` §6.2). Paint raw text during the stream and render once on completion.
- Do **not** write a second HTTP stack. If `fetch` is required for streaming, `docs/03` §14.4
  puts that swap in exactly one place: the transport function.
- Do **not** treat an aborted stream as an error to report; `OperationCancelledError` is
  `userFacing: false` (`docs/07` §10.1).
- Do **not** assume streaming exists. `chatStream?` is optional on the shipped contract and
  R-14's mitigation is an explicitly acceptable per-item progress substitute.
- Do **not** infer completion from an empty delta — use the provider's terminal event.

**Done when.**
- [ ] The parser reconstructs the exact full text from each provider's recorded
      `chat-stream-ok` fixture, byte for byte identical to the non-streamed fixture's text.
- [ ] A truncated stream fixture (connection cut mid-frame) surfaces a `NetworkError`, not a
      silent short result.
- [ ] Aborting mid-stream stops iteration and issues no further reads, asserted with a fake
      transport.
- [ ] A provider whose `ModelInfo.supportsStreaming` is false is routed through `chat()` with
      no caller-side branch.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/sse
```

**Notes.** Streaming buys perceived responsiveness for the single long trend-report call in
Phase 4, not for the per-paper map pass, which is inherently chunked and already reports
progress per item. Do not spend more than the estimate here.

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
- `docs/03-llm-provider-integration.md` §7.1–§7.5 — the four mechanisms and the field path for
  each (`text.format`, `output_config.format`, `response_format.{mime_type,schema}`,
  `response_format.json_schema`), plus the summary table that marks OpenRouter "conditional"
- `docs/03-llm-provider-integration.md` §14.5 — the `completeJSON` wrapper: the `max_tokens`
  truncation check, the refusal/content-filter early exit (retrying is pointless and an empty
  assistant turn makes Anthropic 400), the fence stripper, and the one correction turn
- `docs/12-prompt-library.md` §18.3 — `parseOrRepair`, its exact signature, the
  `StructuredOutputError(providerId, modelId, message, ctx)` throw, and the "one repair, then
  one full retry, then fail that item — do not loop" rule
- `docs/12-prompt-library.md` §18.4 — always validate client-side regardless of the provider's
  mode, plus the four invariants a JSON Schema cannot express
- `docs/06-summarization-and-trend-report.md` §6.4 — the `generateStructured` contract this
  must satisfy ("guarantees a parsed object or throws") and the universal prompt-append fallback
- `docs/07-architecture-and-data-model.md` §10.1 — `StructuredOutputError`'s constructor and
  the note that a two-argument call does not compile

**Files.**
- create `src/llm/shared/jsonMode.ts`
- create `src/llm/shared/schemaValidate.ts`
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/llm/openai/openAiProvider.ts`
- modify `src/llm/anthropic/anthropicProvider.ts`
- modify `src/llm/gemini/geminiProvider.ts`
- create `test/unit/llm/jsonMode.spec.ts`

**Do.**
1. Translate `ChatRequest.responseFormat.kind === "json_schema"` into each provider's native
   field per the §7.5 table, inside that provider's adapter.
2. Implement a dependency-free JSON Schema (draft 2020-12 subset) validator in
   `schemaValidate.ts` covering the constructs `PaperSummary` v1 actually uses: `type`,
   `enum`, `const`, `required`, `properties`, `additionalProperties: false`, `items`,
   `pattern`, `minimum`/`maximum`, and `null` unions.
3. Implement `completeJSON()` per `docs/03` §14.5: throw on `max_tokens` truncation, throw on
   refusal/content filter, strip code fences, take the outermost balanced object, parse,
   validate, and allow exactly one correction turn.
4. Implement `parseOrRepair()` per `docs/12` §18.3 with the repair prompt verbatim and the
   four-argument `StructuredOutputError` throw.
5. Enforce the sequence: one repair attempt, then one full retry of the original call at
   temperature 0, then fail that item.
6. Implement the universal fallback for models without structured output: append the serialized
   schema to the prompt with an "output only JSON" instruction.

**Do NOT.**
- Do **not** trust `strict: true`. `docs/03` §7.4 caveat 4 and `docs/12` §18.4 both require
  client-side validation on every provider, every time.
- Do **not** loop the repair. "A model that cannot produce the schema twice will not produce it
  on the fifth try, and the loop burns the user's money" (`docs/12` §18.3).
- Do **not** retry a refusal or a content-filter stop. It returns HTTP 200, retrying is
  pointless, and the correction turn appends an empty assistant message which Anthropic rejects
  with a 400 (`docs/03` §14.5).
- Do **not** construct `StructuredOutputError` with two arguments (`docs/07` §10.1).
- Do **not** put `StructuredOutputError` in the transport retry set (`docs/03` §14.1).
- Do **not** send `response_format` to OpenRouter without `require_parameters: true`; that is
  where silent degradation happens (`docs/03` §7.4).
- Do **not** bundle a general-purpose JSON Schema library for this — NFR-18 bundle size, and
  the schema surface in use is small and fixed.

**Done when.**
- [ ] The `chat-json-malformed` fixture for each provider (trailing prose, code fences) parses
      successfully through the fence stripper and balanced-object extractor.
- [ ] A body that is valid JSON but violates the schema triggers exactly one repair call and
      then exactly one retry, asserted by call count on `mockLLM`.
- [ ] A third failure throws `StructuredOutputError` carrying both `providerId` and `modelId`.
- [ ] A `finish_reason: "length"` fixture throws before any repair attempt.
- [ ] A refusal fixture throws `ContentFilterError` with zero repair attempts.
- [ ] The validator accepts the canonical `PaperSummary` v1 example and rejects one with an
      extra property, one with a bad `studyDesign` enum value, and one with a missing required
      field.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/jsonMode
```

**Notes.** `docs/06` §6.4 names the adapter method `generateStructured`; `docs/07` §4.3 owns the
shipped surface, which is `chat()` with `responseFormat`. Implement `completeJSON()` as a helper
over `chat()` and do not add a second adapter member.

---

### P3-T13 — Model catalogue, pricing table, token estimation

| Field | Value |
|---|---|
| **ID** | `P3-T13` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` |
| **Blocks** | `P3-T14`, `P3-T15`, `P3-T16`, `P3-T23` |
| **Retires** | `R-5` |
| **Implements** | `FR-32`, part of `FR-24`, part of `NFR-5` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** The model picker and the cost estimator are driven by a live catalogue with real
prices and a visible "as of" date, and every token figure comes from one estimator.

**Read first.**
- `docs/03-llm-provider-integration.md` §9 preamble — "Do not ship a hardcoded model list",
  fetch at run time, cache with a 24 h TTL, fall back to a small bundled list only if all
  fetches fail
- `docs/03-llm-provider-integration.md` §9.4 "Design recommendation" — use OpenRouter's
  unauthenticated catalogue as the metadata source for **all** providers, and the exact
  native-to-slug mapping rule including the Anthropic dot
- `docs/03-llm-provider-integration.md` §12.1 and §12.4 — the price table with its verified-on
  date and the cost-estimator UI recommendation
- `docs/03-llm-provider-integration.md` §10.1–§10.2 — where exact counting exists, and the
  recommended heuristic with its Hangul range correction and `+16` framing overhead. §10.2's
  **authority note** governs what you implement: the shipped signature is `docs/07` §4.3's
  synchronous `countTokens(text, modelId): number`, the `{ tokens, exact }` shape sketched below
  it is superseded, and because the return carries no `exact` flag **every result is treated as
  inexact at the call site**. Read the rest of §10.2 for the *policy*, which doc 07 does not
  restate and which still holds in full
- `docs/06-summarization-and-trend-report.md` §5.1 — the per-script `estTokens` variant this
  pipeline uses, plus **D-06-5**: the 1.15x safety multiplier and the reserve of
  `maxOutputTokens` plus 800 tokens of overhead
- `docs/07-architecture-and-data-model.md` §8.5 "LLM providers & models" — that the shipped
  model IDs are **seed defaults only** and the pickers are repopulated at run time, **and the
  ⚠ `llm.tokenEstimateCalibration` row**: type `string` holding JSON, default `"{}"`, shape
  "model ID → correction factor", written **at most once per job** and explicitly declared a
  preference *rather than a database table* because it is bounded, tiny and read at estimate
  time by `src/llm/shared/tokenEstimate.ts`
- `docs/07-architecture-and-data-model.md` §8.5.1 — the typed `getPref`/`setPref` accessor and
  the rule that plugin code never calls `Zotero.Prefs` directly, which is how this card reads
  and writes the calibration store
- `docs/03-llm-provider-integration.md` §10.2 "Correcting the drift" — that the correction
  factor is accumulated per model from the returned `usage` blocks, stored in
  `llm.tokenEstimateCalibration`, and applied **after** `estimateTokens()` and **before** the
  20 % headroom; an absent or unparseable entry means "not calibrated yet"
- `docs/01-zotero-plugin-platform.md` §7.2 — the paragraph naming
  `llm.tokenEstimateCalibration` as one of the §8.5 rows that has **no `pref()` line** and is
  reached only through the typed accessor, so `addon/prefs.js` is not touched by this card
- `docs/07-architecture-and-data-model.md` §8.2 — that prefs rewrite the whole file on every
  change, which is why the write cadence is once per job and never per call
- `docs/07-architecture-and-data-model.md` §9.2 — cache TTLs, so the catalogue cache uses the
  cache layer rather than a bespoke store

**Files.**
- create `src/llm/shared/modelCatalogue.ts`
- create `src/llm/shared/pricing.ts`
- create `src/llm/shared/tokenEstimate.ts`
- create `src/llm/shared/slugMap.ts`
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `src/ui/prefs/prefsController.ts`
- create `test/unit/llm/tokenEstimate.spec.ts`
- create `test/unit/llm/slugMap.spec.ts`
- create `test/unit/llm/calibration.spec.ts`

**Do.**
1. Implement `slugMap.ts`: `toOpenRouterSlug(providerId, nativeId)` prefixing the author and
   rewriting a trailing `-<major>-<minor>` to `-<major>.<minor>`; and the inverse where needed.
2. Implement `modelCatalogue.ts`: fetch each configured provider's own list, then enrich each
   entry with `contextWindowTokens`, `inputCostPerMTokUsd`, `outputCostPerMTokUsd`,
   `supportsJsonSchema` and `dataPolicy` from the OpenRouter catalogue via the slug map, leaving
   fields `undefined` when the slug is missing.
3. Cache the catalogue in the `Cache` layer with a 24 h TTL and record the fetch timestamp as
   the "as of" date.
4. Ship a small bundled fallback list used only when every fetch fails, clearly marked stale in
   the UI.
5. Implement `pricing.ts`: cost from `ModelInfo` prices, honouring `pricing.overrides[]`
   long-context tiers, with a user-editable override table and the "as of" date surfaced.
6. Implement `tokenEstimate.ts` as the single estimator: the `docs/06` §5.1 per-script
   character ratios, the D-06-5 1.15x multiplier, and the `maxOutputTokens + 800` reservation.
7. Add the `llm.tokenEstimateCalibration` row to `src/prefs/schema.ts` and its key constant to
   `src/prefs/keys.ts` exactly as `docs/07` §8.5 declares it — key
   `llm.tokenEstimateCalibration`, type `string`, default `"{}"`, `secret` absent — and no
   other new row.
8. Record actual `usage` per call in memory for the life of the job, and accumulate the
   estimated-to-actual input-token ratio per model ID.
9. On job completion, read the store with `getPref("tokenEstimateCalibration")`, `JSON.parse`
   it inside a try/catch that treats any failure as `{}`, fold in the ratios measured by this
   job, and write it back **once** with `setPref`. One write per job, never per call.
10. In `estimateTokens()`, look up the model's factor from the parsed store and apply it
    **after** the heuristic and **before** the 20 % headroom (`docs/03` §10.2). A missing,
    non-numeric or non-positive entry means "not calibrated yet" and the raw heuristic stands.
11. Populate the prefs-pane model menulists from the catalogue, keeping them editable so a user
    can type an ID the catalogue lacks.

**Do NOT.**
- Do **not** hardcode a model ID or a price outside `addon/prefs.js`'s seed defaults
  (README §5 rule 4, `docs/07` §8.5).
- Do **not** parse `pricing.prompt` as a JSON number. They are decimal **strings** on purpose,
  to avoid float issues; parse then convert (`docs/03` §9.4).
- Do **not** ignore `pricing.overrides[]` (`docs/03` §9.4).
- Do **not** produce an Anthropic slug by naive prefixing (`docs/03` §9.4).
- Do **not** display a cost without the "as of" date and the word "estimate"; R-5's whole
  mitigation is that the staleness is visible, and FR-24 requires the wording "estimate; actual
  cost may differ".
- Do **not** gate hard behaviour on an inexact count — use it for chunk sizing and display only
  (`docs/03` §10.2).
- Do **not** use the `docs/03` §10.2 estimator and the `docs/06` §5.1 estimator in different
  places. One function; `docs/06` §5.1's per-script form is the one the summarization budget is
  written against.
- Do **not** keep the calibration factor in the plugin database. `docs/07` §8.5 declares it a
  **preference** and gives the reason — it is bounded (one entry per model the user actually
  runs), tiny, and read at estimate time — and §8.5.2's "not a preference" table does not list
  it. An earlier draft of this card said "keep it in the plugin database if no schema row
  exists"; the row now exists.
- Do **not** write the pref on every call. `docs/07` §8.2: a pref write rewrites the whole
  `prefs.js`, so a per-call write turns a token estimate into disk I/O. Once per job, on
  completion, is the declared cadence.
- Do **not** call `Zotero.Prefs.get`/`set` directly for it. `docs/07` §8.5.1: plugin code goes
  through the typed accessor so the key string, type and default exist in exactly one place —
  and `core/` reaches prefs only through the `PrefStore` port (§2.3).
- Do **not** let a corrupt value stop an estimate. §8.5.1: `getPref` "never throws: a corrupt
  pref must not be able to stop a job from starting"; an unparseable JSON blob means
  uncalibrated, not failed.
- Do **not** add a `pref()` line for it to `addon/prefs.js`. `docs/01` §7.2 names this key as
  one of the rows that has none and is served by the schema default.
- Do **not** invent a second calibration key, a per-provider variant, or a `secret: true` flag
  on this row. `docs/07` §8.5 is the complete list of preferences.

**Done when.**
- [ ] `estTokens()` is exported from exactly one module and a repository grep finds no second
      character-ratio estimator.
- [ ] `estTokens("...")` on a 250-word English abstract lands within ±15 % of 350 tokens
      (`docs/03` §10.2 calibration note), asserted on a fixture string.
- [ ] The Hangul range covers U+AC00–U+D7A3 inclusive, asserted with the syllable `힣`.
- [ ] `costOf()` on a model with an `overrides` tier returns the higher price above the
      override's `min_prompt_tokens`.
- [ ] The catalogue for an OpenAI-only configuration still yields non-`undefined` context and
      price for at least one model, proving OpenRouter enrichment works without an OpenAI-side
      price source.
- [ ] With all fetches stubbed to fail, the picker falls back to the bundled list and the UI
      marks it stale.
- [ ] `src/prefs/schema.ts` carries exactly one new row, `llm.tokenEstimateCalibration`, with
      `type: "string"` and `default: "{}"`, and a grep finds no `research-helper.llm.` string
      passed to `Zotero.Prefs` outside `src/prefs/index.ts`.
- [ ] A scripted job of 10 calls produces exactly **one** `setPref` call for
      `tokenEstimateCalibration`, asserted with a spying `PrefStore`.
- [ ] With the pref stubbed to `"not json"`, `estTokens()` returns the uncalibrated heuristic
      value and does not throw.
- [ ] With the pref stubbed to `{"anthropic/claude-sonnet-5": 1.2}`, `estTokens()` for that
      model returns 1.2× the uncalibrated value before headroom, and the unchanged value for a
      model absent from the object.
- [ ] No SQLite table, `db.ts` call or on-disk JSON file holds calibration data — the pref is
      the only store, asserted by a test that greps `src/` for a write of the calibration object
      to anything but `setPref`. (Do not grep for `search_provenance`: `docs/07` §5.3 makes that
      a real, unrelated table owned by Phase 2.)
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "llm/(tokenEstimate|slugMap|pricing|calibration)"
```

**Notes.** This card is what retires R-5: the price table stops being a constant in the source
and becomes a fetched, dated, user-editable artifact. The rolling correction factor closes the
**Unverified** marker on the ratios in `docs/06` §5.1 by measurement rather than by assertion.

**Changed 2026-09-09 — the calibration store is a preference, not the plugin database.** This
card previously said "keep it in the plugin database instead of inventing a pref", because when
it was written `docs/07` §8.5 had no row for it. The documentation pass added one:
`llm.tokenEstimateCalibration`, `string` holding JSON, default `"{}"`, with §8.5 stating in the
row itself that it is a preference rather than a table and giving the write cadence
(once per job). `docs/03` §10.2 "Correcting the drift" names the same key. Nothing is invented
here any more — read and write it through §8.5.1's accessor and add the schema row.

---

### P3-T14 — `validateCredentials()` and the Test-key button

| Field | Value |
|---|---|
| **ID** | `P3-T14` |
| **State** | `TODO` |
| **Depends on** | `P3-T04`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T13` |
| **Blocks** | `P3-T31` |
| **Retires** | part of `R-9` |
| **Implements** | `FR-31` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — a real key per provider is needed to exercise the live path. The agent implements and unit-tests against fixtures, then stops and asks the human to press Test for each configured provider and report the outcome. |

**Goal.** Pressing Test tells the user precisely what is wrong with their key, costs nothing,
and populates the model picker on success.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §2.3 — the rules: cheapest authenticated endpoint,
  never a completion, never user content, the specific outcome set (401 / 403 / **429 counts as
  a pass** / network = inconclusive / success), what may be stored, and the per-provider
  endpoint table with its "confirm in docs/03" caveat
- `docs/03-llm-provider-integration.md` §9.1–§9.4 — the actual list endpoints that confirm that
  table, and §15.4 for OpenRouter's `GET /api/v1/key` credit endpoint
- `docs/09-security-privacy-and-api-keys.md` §2.4 — the seven-step 401 policy: do not retry, pause
  the job with reason `credential-required`, mark the key rejected in prefs, **do not delete the
  key**, one notification not N, no silent provider fallback
- `docs/07-architecture-and-data-model.md` §4.3 `CredentialCheckResult` — `ok`, `messageKey`,
  `httpStatus`, optional `models`, and the comment that it "never contains any part of the key"
- `docs/07-architecture-and-data-model.md` §8.5 "Non-secret key-presence flags" — the **complete**
  set of rows the pane's status row may read: `<provider>.keyPresent`,
  `<provider>.lastValidatedAt` and `<provider>.lastValidationResult` (`string`, default `""`,
  values `ok | rejected | forbidden | inconclusive | ""`). All three are scoped to the **same six
  credential-holding IDs** — `openrouter`, `openai`, `gemini`, `anthropic`, `ncbi`,
  `semanticscholar` — not to the four LLM providers, and §8.5 says why: a wrong NCBI or Semantic
  Scholar key degrades silently rather than erroring. `lastValidationResult` is a **status, not
  an input**, so it carries no `preference=` binding; it is reset to `""` on key rotation
  (`docs/09` §2.5)
- `docs/01-zotero-plugin-platform.md` §7.2 — the six `pref()` lines that ship the defaults
- `docs/08-ui-ux-spec.md` §7.3 — the per-credential `role="status"` hint element beside each key
  field (`rh-or-status` in the OpenRouter block, one per key-holding block), which this card
  drives imperatively from `lastValidationResult`
- `docs/08-ui-ux-spec.md` §7.5 rule 2 — inline reporting, never a modal

**Files.**
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/llm/openai/openAiProvider.ts`
- modify `src/llm/anthropic/anthropicProvider.ts`
- modify `src/llm/gemini/geminiProvider.ts`
- modify `src/ui/prefs/prefsController.ts`
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `src/core/jobQueue/queue.ts`
- create `test/unit/llm/validateCredentials.spec.ts`

**Do.**
1. Implement `validateCredentials()` on each adapter using its list endpoint —
   `GET /v1/models` (OpenAI, Anthropic), `GET /v1beta/models` (Gemini, header auth),
   `GET /api/v1/key` or `GET /api/v1/models` (OpenRouter).
2. Classify: 2xx = pass with `models` populated; 401 = rejected; 403 = valid but lacks
   permission or region-blocked; 429 = **pass** (the key is valid, it is throttled); network or
   timeout = inconclusive, and the stored result is not changed to "rejected".
3. Store only the outcome, the timestamp, and any account/organization label the provider
   returns. The outcome goes to `<provider>.lastValidationResult` and the timestamp to
   `<provider>.lastValidatedAt`, both through `P3-T04`'s typed accessor; the mapping from
   `docs/09` §2.3's status set is `2xx`/`429` → `ok`, `401` → `rejected`, `403` → `forbidden`,
   network or timeout → the stored value is **left unchanged**, never `inconclusive` written
   over a good `ok`. Add the `<provider>.lastValidationResult` row to `src/prefs/schema.ts` and
   its key constant to `src/prefs/keys.ts` for all six credential IDs, exactly as §8.5 declares
   them — `string`, default `""`, `secret` absent.
4. Wire the Test button to report inline and, on success, immediately repopulate that
   provider's model menulist from the returned list. Paint the per-credential `role="status"`
   element of `docs/08` §7.3 from the stored `lastValidationResult` on pane load, so the state
   survives a restart; the element has no `preference=` binding and is driven imperatively.
5. Implement the 401 mid-job policy in the job queue: pause with `credential-required`, emit
   exactly one notification, keep the stored key, and — per `docs/09` §2.4 step 3 — set
   `<provider>.lastValidationResult = "rejected"` and stamp `<provider>.lastValidatedAt` with
   the rejection time.
6. Reset `<provider>.lastValidationResult` to `""` when the key is rotated or removed
   (`docs/09` §2.5), so a new key never inherits the old key's red state.

**Do NOT.**
- Do **not** validate with a completion call. "Nobody should be billed for pressing Test"
  (`docs/09` §2.3). If a provider had no list endpoint, the fallback is `"ping"` with
  `max_tokens: 1` — none of the four needs it.
- Do **not** send any user content in a validation call (`docs/09` §2.3).
- Do **not** mark a key bad on a network failure — that is inconclusive (`docs/09` §2.3).
- Do **not** treat a 429 as a failure; the key is valid (`docs/09` §2.3).
- Do **not** delete the stored key on a 401. "Silently discarding their credential is hostile";
  offer a Remove button instead (`docs/09` §2.4 step 4).
- Do **not** let 200 items each produce their own 401 — fail the provider once
  (`docs/09` §2.4 step 2).
- Do **not** show the result in a modal (`docs/08` §7.5 rule 2).
- Do **not** write a `<provider>.lastValidationResult` value outside
  `ok | rejected | forbidden | inconclusive | ""`, and do **not** scope the key to the four LLM
  providers. `docs/07` §8.5 declares the closed value set and scopes the row to the same six
  credential IDs as `keyPresent`; an earlier draft of the row was LLM-only and the owner
  extended it on 2026-09-09 (this file's §4 item 10, closed).
- Do **not** give the status element a `preference=` attribute. `docs/07` §8.5 and `docs/08`
  §7.3: it is a status, not an input, and is painted imperatively by `preferences.js`.
- Do **not** include any part of the key, or the raw provider error body, in the result — the
  provider's error `type`/`code` fields are safe, the message body may not be
  (`docs/09` §2.4 step 7).

**Done when.**
- [ ] A recorded 401 fixture per provider yields `ok: false` with `httpStatus: 401` and a
      distinct `messageKey` from the 403 case.
- [ ] A recorded 429 fixture yields `ok: true`.
- [ ] A simulated network failure leaves the stored `lastValidationResult` unchanged.
- [ ] A successful validation populates the model menulist without a second network call.
- [ ] A mid-job 401 leaves the job `paused` with reason `credential-required`, the key still
      stored, `<provider>.lastValidationResult` set to `"rejected"` and
      `<provider>.lastValidatedAt` stamped, and exactly one notification emitted for a 200-item
      job.
- [ ] `src/prefs/schema.ts` carries a `<provider>.lastValidationResult` row for all six
      credential IDs with default `""` and the closed value set of `docs/07` §8.5, and no row
      carries `secret: true`.
- [ ] Reopening the prefs pane after a restart still shows the red state for a provider whose
      last validation was `rejected`, read from the pref rather than from session memory.
- [ ] Rotating or removing a key resets that provider's `lastValidationResult` to `""`
      (`docs/09` §2.5).
- [ ] `CredentialCheckResult` serialized into a debug bundle contains no key material.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- validateCredentials
```
Then, manually: enter each provider's key in Preferences, press Test, and confirm the inline
result and the repopulated model list. Report which providers were tested and their outcomes.

**Notes.** `docs/09` §2.3's endpoint table carries an **Unverified** marker asking that each
endpoint be confirmed against `docs/03`. It has been: §9.1–§9.4 confirm all four, and
OpenRouter's `GET /api/v1/key` is confirmed in §5.1. Record that resolution in the spike log so
the marker can be cleared.

**Resolved 2026-09-09, and the card changed with it.** An earlier revision of this card kept the
validation outcome in session memory, because `docs/09` §2.4 step 3 told the implementer to "set
`<provider>.lastValidationResult = "rejected"` with a timestamp" while `docs/07` §8.5 — the sole
authority — declared no such row. The owner added it: §8.5 now carries
`<provider>.lastValidationResult` (`string`, default `""`, values
`ok | rejected | forbidden | inconclusive | ""`), scoped to the **six** credential-holding IDs
rather than the four LLM providers, on the ground that a wrong NCBI key silently drops the user
from 10 req/s to 3 (`docs/02` §3.1) and a wrong Semantic Scholar key silently drops F2 and F6
onto the saturated anonymous pool (`docs/02` §6.4) — "without a stored validation status neither
failure has any surface at all". `docs/01` §7.2 ships the six `pref()` lines and `docs/09` §2.4
now defers to §8.5 for the schema while keeping the semantics. So the outcome is **persisted**,
the pane's red state survives a restart, and `docs/07` §8.3's placement-table group name is no
longer ahead of the schema. Tracked as this file's §4 item 10, now closed.

---

### P3-T15 — Privacy modes, egress disclosure, Gemini free-tier warning

| Field | Value |
|---|---|
| **ID** | `P3-T15` |
| **State** | `TODO` |
| **Depends on** | `P3-T07`, `P3-T10`, `P3-T13` |
| **Blocks** | `P3-T16` |
| **Retires** | part of `R-9` |
| **Implements** | `FR-36` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Before any content leaves the machine the user is told where it goes and what it is,
the privacy mode mechanically restricts what may be sent, and the Gemini free-tier warning
cannot be turned off.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §3.5 — the three-mode table, that a per-collection
  override lives in the `collection_settings` table rather than in prefs and **can only ever be
  stricter** than the global mode, and that "abstract-only is the floor, not an option"
- `docs/09-security-privacy-and-api-keys.md` §3.4 rules 1, 3 and 4 — restrictive OpenRouter
  routing by default, `ModelInfo.dataPolicy` surfaced in the picker with `"unknown"` refused in
  strict mode, and the Gemini tier assumption
- `docs/09-security-privacy-and-api-keys.md` §3.6 — disclosure at the point of action: the
  pre-flight dialog contents, what "don't ask again" may and may not suppress, the **verbatim
  non-suppressible Gemini free-tier warning text**, the egress log, and item 1's rule that when
  a `<provider>.baseUrl` override is in effect the dialog names the **effective** host rather
  than the provider's default one
- `docs/09-security-privacy-and-api-keys.md` §3.6, the opening "first-job acknowledgement"
  paragraph — that the acknowledgement is recorded in the **`privacy.egressAcknowledged`**
  preference, is written **only** by this dialog, is read **only** to decide whether to show
  the notice again, and *suppresses nothing*: this is where FR-36's "recorded in prefs" lands
- `docs/09-security-privacy-and-api-keys.md` §3.2 — the per-feature egress table, which fixes
  exactly what feature 3a may send and what it may never send (notes, annotations, tags,
  collection names, file paths)
- `docs/07-architecture-and-data-model.md` §8.5 — the `privacy.mode` row (key, type, default,
  value set), the **⚠ `privacy.egressAcknowledged` row** (boolean, default `false`, "Not in the
  pane", written once by the first-job confirmation dialog and explicitly *not* a suppression
  switch for the per-job disclosure), and §8.3 for the `collection_settings` table
- `docs/07-architecture-and-data-model.md` §8.5.1 — the typed `getPref`/`setPref` accessor, the
  rule that plugin code never calls `Zotero.Prefs` directly, and that everything not on the
  startup list is read **on demand** at the point the dialog needs it
- `docs/01-zotero-plugin-platform.md` §7.2 — the paragraph naming `privacy.egressAcknowledged`
  as one of the §8.5 rows that has **no `pref()` line** and is served by the schema default, so
  `addon/prefs.js` is not touched by this card
- `docs/07-architecture-and-data-model.md` §5.2 — `SummaryInputScope`, the per-summary record of
  what was actually sent, which is what makes the egress log answerable to an IRB
- `docs/07-architecture-and-data-model.md` §10.1 — `PolicyViolationError`, the error a refused
  route must throw

**Files.**
- create `src/pipeline/shared/privacyPolicy.ts`
- create `src/ui/dialogs/egressDisclosure.ts`
- modify `src/llm/openrouter/openRouterProvider.ts`
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `src/zotero/db.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/pipeline/privacyPolicy.spec.ts`

**Do.**
1. Implement `effectiveMode(globalMode, collectionOverride)` returning the **stricter** of the
   two, never the looser.
2. Implement `allowedInputScope(mode)` returning the maximum `SummaryInputScope` kind: strict
   forces `fullTextMode` to `never`; balanced and full permit `abstract+fulltext`; notes,
   annotations, tags and collection names are excluded in every mode except `full` with a
   separate explicit opt-in.
3. Implement `assertModelAllowed(model, mode)`: refuse `dataPolicy.trainsOnInputByDefault ===
   "unknown"` in strict, refuse `"yes"` in strict and balanced, warn-and-confirm in full — via
   `PolicyViolationError`.
4. Feed the mode into the OpenRouter `provider` block: `zdr: true` in strict, `data_collection:
   "deny"` in all three.
5. Build the egress disclosure content — provider, endpoint host, item count, content scope in
   plain words, privacy mode — as a block the cost dialog in `P3-T16` embeds, not a second
   dialog. When a `<provider>.baseUrl` override is in effect, name the **effective** host from
   `P3-T06`'s `resolveBaseUrl()`, never the provider's documented default: `docs/09` §3.6 item 1
   — "the destination is what the user is being asked about" — and `docs/03` §14.4.
6. Add the `privacy.egressAcknowledged` row to `src/prefs/schema.ts` and its key constant to
   `src/prefs/keys.ts` exactly as `docs/07` §8.5 declares it — key
   `privacy.egressAcknowledged`, type `boolean`, default `false`, `secret` absent — and no
   other new row.
7. Implement the **first-job acknowledgement** (FR-36, `docs/09` §3.6 opening paragraph):
   read `getPref("egressAcknowledged")` on demand when the pre-flight dialog is built; when it
   is `false`, render the additional notice — what a fully client-side, bring-your-own-key
   plugin does and does not protect the user from, and that content leaves their machine for a
   third-party provider they chose — and call `setPref` to `true` **only** when the user
   confirms that dialog. Nothing else in the codebase writes this pref.
8. Implement the suppression rules for "don't ask again for this collection": it suppresses only
   the routine confirmation and never a provider change, a privacy-mode change, the first
   full-text send, or the Gemini free-tier warning.
9. Add the Gemini free-tier warning as a Fluent string reproducing `docs/09` §3.6 item 3
   verbatim, shown whenever the tier is free **or unknown**, with no suppression path.
10. Write the per-job egress log — provider, item count, content scope — into the `job` record,
    locally only.

**Do NOT.**
- Do **not** let a per-collection setting loosen a stricter global mode (`docs/09` §3.5).
- Do **not** put the per-collection override in a preference — per-collection settings are
  unbounded in number and belong in `collection_settings` (`docs/09` §3.5, `docs/07` §8.3).
- Do **not** send collection names, tag names, folder structure, Zotero notes or PDF
  annotations. "They frequently contain project codenames, grant numbers, and collaborator
  names" and notes are "the user's own unpublished thinking" (`docs/09` §3.2).
- Do **not** guess a `dataPolicy` in order to fill a field. "We do not guess a policy in order
  to fill a field" (`docs/09` §3.4 rule 3).
- Do **not** make the Gemini free-tier warning suppressible, and do **not** downgrade it when
  the tier is merely unknown (`docs/09` §3.6 item 3, §3.4 rule 4).
- Do **not** add a second dialog for privacy. "This dialog already exists for cost reasons…
  privacy information goes in the same dialog rather than a second one" (`docs/09` §3.6 item 1).
- Do **not** add telemetry, analytics or crash reporting of any kind (`docs/09` §3.2 last row).
- Do **not** upload the egress log anywhere. It is local only.
- Do **not** record the acknowledgement in the plugin database. `docs/07` §8.5 declares
  `privacy.egressAcknowledged` a **preference**, FR-36 says "recorded in prefs", and `docs/03`
  §10.2's sibling case settles the pattern. An earlier draft of this card put it in the
  database because no schema row existed; the row now exists.
- Do **not** let `privacy.egressAcknowledged` suppress anything. `docs/09` §3.6: "It is an
  *acknowledgement*, not consent-in-advance, and it suppresses nothing." Item 1's per-job
  disclosure still runs on every job, and items 2–3's four non-suppressible warnings are
  unaffected. Reading it as a "user already agreed" flag is the failure this row exists to
  prevent.
- Do **not** write it from anywhere but the first-job confirmation dialog, and do **not** write
  it when the user cancels. §8.5: "Written **once**, by the first-job confirmation dialog, when
  the user acknowledges the notice."
- Do **not** call `Zotero.Prefs.get`/`set` directly for it (`docs/07` §8.5.1) and do **not**
  read it at startup — §8.5.1's startup list does not include it, and reading it on demand is
  what lets a change take effect without a restart.
- Do **not** add a `pref()` line for it to `addon/prefs.js` (`docs/01` §7.2), a prefs-pane
  control for it (§8.5: "Not in the pane"), or a second `consent.*` key. §8.5 is the complete
  list of preferences.

**Done when.**
- [ ] `effectiveMode("balanced", "strict") === "strict"` and
      `effectiveMode("strict", "full") === "strict"`, asserted.
- [ ] In strict mode a summarize plan for an item with full text produces
      `SummaryInputScope.kind === "abstract"`, and `fullTextMode` is forced to `never`.
- [ ] A model with `dataPolicy.trainsOnInputByDefault === "unknown"` throws
      `PolicyViolationError` in strict and only warns in balanced.
- [ ] The OpenRouter request body carries `zdr: true` in strict and omits it in balanced,
      while `data_collection: "deny"` is present in all three modes.
- [ ] With "don't ask again" set for a collection, changing the provider still shows the dialog,
      and a Gemini free-or-unknown tier still shows the warning.
- [ ] With `openrouter.baseUrl` set to `https://gateway.example/v1`, the disclosure block names
      `gateway.example` and not `openrouter.ai`; with the pref empty it names the documented
      host.
- [ ] The Gemini warning string in the `.ftl` matches `docs/09` §3.6 item 3 character for
      character.
- [ ] `src/prefs/schema.ts` carries exactly one new row, `privacy.egressAcknowledged`, with
      `type: "boolean"` and `default: false`.
- [ ] With the pref stubbed `false`, building the pre-flight dialog yields a block containing
      the first-job notice; with it stubbed `true`, the same call yields the block without it.
- [ ] Confirming that dialog calls `setPref("egressAcknowledged", true)` exactly once;
      cancelling it calls `setPref` zero times — both asserted with a spying `PrefStore`.
- [ ] With the pref stubbed `true`, a second job still renders the §3.6 item 1 per-job
      disclosure, and a Gemini free-or-unknown tier still renders the item 3 warning.
- [ ] A repository grep finds no write of the acknowledgement to `src/zotero/db.ts`, and no
      `consent.` pref key anywhere.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- privacyPolicy
```

**Notes — changed 2026-09-09; the acknowledgement is a preference, not the plugin database.**
This card previously said FR-36's "recorded in prefs" had no key in `docs/07` §8.5 and, per
README §5 rule 2, put the acknowledgement in the plugin database instead. The documentation
pass added the row: **`privacy.egressAcknowledged`**, `boolean`, default `false`, flagged ⚠ in
§8.5 so a human confirms the name before it reaches `prefs.js`, with `docs/09` §3.6's opening
paragraph naming the same key and stating the write-once / read-only-to-decide semantics.
Nothing is invented here any more, and no `consent.*` key is needed.

The one trap that survives the fix is semantic rather than structural: the pref is an
acknowledgement, not consent-in-advance. `docs/09` §3.6 spends a paragraph on this precisely
because a boolean named "acknowledged" invites being read as a suppression switch. The
per-job disclosure and the four non-suppressible warnings are governed by items 1–3 of that
section and are untouched by this pref's value.

The missing `<provider>.baseUrl` row noted in `P3-T04` was the same class of gap and has also
been closed — §8.5 now carries all four `*.baseUrl` rows.

---

### P3-T16 — Cost estimate, confirmation gate, `BudgetGuard`, usage

| Field | Value |
|---|---|
| **ID** | `P3-T16` |
| **State** | `TODO` |
| **Depends on** | `P3-T13`, `P3-T15` |
| **Blocks** | `P3-T25`, `P3-T29` |
| **Retires** | `R-4` |
| **Implements** | `FR-24`, `FR-35`, `NFR-5` |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — the first real spend. After the fixtures pass, a human must run one small paid job (a 3-item collection, well under $0.05) to confirm the dialog's figure against the provider's reported usage. The agent must not start a paid run on its own. |

**Goal.** No run starts without a number, a threshold above which the user must say yes twice,
and two hard ceilings that stop rather than warn.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.4 — **DR-1**, the cost model table (~8x
  single-shot, ~32x chunked), the mandatory cost preview with its worked example, the
  `summary.confirmAboveUSD` gate, the one-click "use abstracts instead" downgrade, and the rule
  that `run.maxSpendUSD` **refuses** rather than prompting
- `docs/06-summarization-and-trend-report.md` §11.4 — the two ceilings, that both are checked
  before each call and the **stricter wins**, and that the session counter lives in memory and
  is **never persisted**
- `docs/07-architecture-and-data-model.md` §4.3 `BudgetGuard` — `reserve()`, `settle()`,
  `spentUsd`, `limitUsd`, and that `reserve()` throws `BudgetExceededError`
- `docs/07-architecture-and-data-model.md` §8.5 "Runtime & concurrency" — the exact keys, types
  and shipped defaults of `run.maxSpendUSD` and `run.maxSessionSpendUSD` (both ship **off**)
  and `docs/07` §8.5 "Summarization" for `summary.confirmAboveUSD` and
  `summary.fullTextAutoMaxPapers`
- `docs/07-architecture-and-data-model.md` §12.3 — the summarize state machine, in particular
  `Estimating → AwaitingConfirm` and `BudgetStop` being deliberately not `Failed`
- `docs/09-security-privacy-and-api-keys.md` §3.6 item 1 — the privacy content this same dialog
  must carry
- `docs/10-requirements-and-user-stories.md` FR-24 — the three acceptance clauses, including the
  required wording "estimate; actual cost may differ" and the second explicit acknowledgement
  above the warning threshold

**Files.**
- create `src/pipeline/shared/budget.ts`
- create `src/pipeline/shared/estimate.ts`
- create `src/ui/dialogs/costConfirmDialog.ts`
- create `addon/content/costConfirm.xhtml`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- modify `src/ui/prefs/prefsController.ts`
- create `test/unit/pipeline/budget.spec.ts`
- create `test/unit/pipeline/estimate.spec.ts`

**Do.**
1. Implement `estimateRun()`: per item, resolve the input scope, estimate input tokens with the
   `P3-T13` estimator, add the `docs/06` §5.2 per-call output ceilings, count calls, and price
   the total through `pricing.ts` including `overrides` tiers.
2. Produce both figures the dialog needs: the selected plan and the abstract-only downgrade.
3. Implement the confirmation gate: show the dialog always; above `summary.confirmAboveUSD`
   require a second explicit acknowledgement; above `run.maxSpendUSD` (when non-zero) refuse the
   run rather than prompting.
4. Pre-select the abstract-only downgrade when the item count exceeds
   `summary.fullTextAutoMaxPapers`, without applying it silently.
5. Implement `BudgetGuard` with both counters: a per-run counter starting at zero, and a
   session counter held in memory that resets on restart. Check both before every call and let
   the stricter one win; name the one that is about to bind in the dialog.
6. On `BudgetExceededError`, transition the job to `BudgetStop` (paused, partial results kept),
   offering "raise the cap" or "stop".
7. Call `settle()` with the provider's returned `usage` after every call, preferring
   provider-reported usage over the estimate, and mark estimated figures as estimated.
8. Add the usage-accounting readout: per-job and per-session token and dollar totals in the job
   dialog and a Usage section in preferences.
9. Embed `P3-T15`'s egress disclosure block in the same dialog.

**Do NOT.**
- Do **not** start any paid run without showing a number first (`docs/06` §11.4, FR-24).
- Do **not** persist the session counter. "A spending ceiling that survives a restart is a
  monthly budget, which this is not, and… a persisted counter that drifts from the user's real
  provider bill is worse than no counter" (`docs/06` §11.4).
- Do **not** silently apply the abstract-only downgrade above
  `summary.fullTextAutoMaxPapers`. "The user always sees what the expensive choice costs and is
  never quietly given the cheap one" (`docs/06` §5.4).
- Do **not** treat `BudgetStop` as a failure. The user set the cap; hitting it is an expected
  outcome with an offered continuation (`docs/07` §12.3).
- Do **not** restate a dollar default in the dialog code. `summary.confirmAboveUSD`,
  `run.maxSpendUSD` and `run.maxSessionSpendUSD` have their values in `docs/07` §8.5 and are
  read from prefs.
- Do **not** show a cost without the "as of" pricing date and the FR-24 wording.
- Do **not** discard completed work when a ceiling binds — abort with partial results preserved
  (`docs/06` §11.4).
- Do **not** make the cost dialog suppressible for a provider change, a privacy-mode change, a
  first full-text send, or a Gemini free-or-unknown tier (`docs/09` §3.6 item 2).

**Done when.**
- [ ] `estimateRun()` over the `docs/06` §5.4 worked example (42 papers, 38 full text, 4
      abstract-only) reproduces that section's **map-phase** arithmetic within 10 %: 42 calls,
      38 single-shot full-text calls at ~12 k input each plus 4 abstract-only calls at ~3.4 k
      (≈ 470 k input), and the §5.2 `max_tokens` ceilings for output. The example's remaining 8
      calls — `THEME_CLUSTER`, 5 × `CLUSTER_REDUCE`, the report call and `SELF_CRITIQUE` — are
      Phase 4's synthesis pipeline and are not estimable here; assert them when Phase 4 lands.
- [ ] With `summary.confirmAboveUSD` at its shipped default and an estimate above it, the
      confirm button requires a second acknowledgement.
- [ ] With `run.maxSpendUSD = 0.01` the run is refused before any call, not prompted.
- [ ] With the ceiling set mid-run, the job reaches `BudgetStop` on the first call that would
      breach it, with prior summaries retained.
- [ ] The session counter accumulates across two jobs in one process and reads zero after a
      simulated restart; a grep confirms it is written to no store.
- [ ] `settle()` overwrites the estimate with provider-reported usage where available, and the
      Usage readout labels the remainder as estimated.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(budget|estimate)"
```
Then, manually: run a 3-item summarize job with a real key, compare the dialog's estimate to the
reported actual, and record both figures.

**Notes.** This card is R-4's retirement and the reason D7 is affordable. The ~32x chunked
multiplier in `docs/06` §5.4 is the number to budget against for a worst-case corpus; a typical
journal-article corpus lands nearer ~8x. If the estimator's error against the first real run
exceeds ~25 %, that is a finding for the rolling correction factor in `P3-T13`, not a reason to
widen the gate.

---

### P3-T17 — `llm` worker pool: concurrency, cancel, pause, resume

| Field | Value |
|---|---|
| **ID** | `P3-T17` |
| **State** | `TODO` |
| **Depends on** | `P3-T05`, `P3-T06` |
| **Blocks** | `P3-T29` |
| **Retires** | part of `R-4`, part of `R-10` |
| **Implements** | `FR-23`, `NFR-6`, part of `FR-34` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Two hundred LLM calls run at a bounded, user-configurable concurrency, can be
cancelled at item 87 without losing the first 86, and resume by skipping completed work.

**Read first.**
- `docs/07-architecture-and-data-model.md` §7.1–§7.2 — why a real queue rather than
  `Promise.all`, and the three pools with the `llm` pool at the `concurrency` pref's value
- `docs/07-architecture-and-data-model.md` §7.4 — cancellation checked at four places, the
  `cancellerReceiver` wiring, the deliberate disabling of Zotero's own retry
  (`successCodes: false`, `noRetryOnThrottle: true`, `errorDelayMax: 0`), and the per-pipeline
  cancellation semantics ("summarize: summaries already written are kept")
- `docs/07-architecture-and-data-model.md` §7.5–§7.6 — pause holds the `exclusivityKey`,
  in-flight requests finish rather than being aborted (aborting wastes money already spent), and
  the checkpoint model for surviving a quit
- `docs/07-architecture-and-data-model.md` §12.3 — the summarize state machine this scheduler
  has to be able to express, including `Interrupted → Summarizing` on resume
- `docs/07-architecture-and-data-model.md` §8.5 "Runtime & concurrency" — `concurrency` (1–8)
  and `timeoutSeconds`, and that `concurrency` is the plugin's single concurrency setting
- `docs/03-llm-provider-integration.md` §11.6 — "keep concurrency low and user-configurable",
  and the total wall-clock batch budget
- `docs/10-requirements-and-user-stories.md` FR-23 — the three acceptance clauses, including
  that job state need not survive restart in v1 but completed work must

**Files.**
- modify `src/core/jobQueue/queue.ts`
- modify `src/core/jobQueue/jobRecord.ts`
- modify `src/core/jobQueue/cancellation.ts`
- modify `src/pipeline/shared/checkpoint.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- create `test/unit/core/llmPool.spec.ts`

**Do.**
1. Add the `llm` worker pool sized from the `concurrency` pref, clamped to 1–8, alongside the
   existing `network-metadata` and `zotero-write` pools.
2. Enforce job-level concurrency: at most one `interactive` and two `background` jobs.
3. Check cancellation at all four `docs/07` §7.4 points, including inside
   `RateLimiter.acquire`, and wire the HTTP cancel through `cancellerReceiver`.
4. Implement pause: stop dispatching, let in-flight calls finish, write a checkpoint, hold the
   `exclusivityKey`, and release-and-requeue the token-bucket waiters on resume.
5. Implement resume-by-skipping: on re-run, completed items are cache hits and are not
   re-dispatched.
6. Apply a total wall-clock budget for the batch, surfacing "N of M completed, retry the rest?"
   rather than retrying indefinitely.
7. Register the LLM hosts' limiters as driven by `Retry-After` and provider headers rather than
   a fixed rate, per `docs/07` §7.3's last table row.

**Do NOT.**
- Do **not** use `Promise.all` over the item list. It "will trip rate limits, blow the user's
  budget with no confirmation, freeze the UI thread… and lose everything if Zotero closes"
  (`docs/07` §7.1).
- Do **not** abort in-flight LLM calls on pause — the money is already spent
  (`docs/07` §7.5). Cancel does abort; pause does not.
- Do **not** roll back written summaries on cancel (`docs/07` §7.4 semantics).
- Do **not** re-enable Zotero's internal retry loop; a retry below the token bucket is invisible
  to the limiter, to our own progress reporting and to cancellation (`docs/07` §7.4).
- Do **not** give each job its own rate limiter — one `TokenBucket` per host, shared, or two
  concurrent jobs each get a full budget (`docs/07` §7.3).
- Do **not** add a second concurrency preference. `concurrency` is the `llm` pool size and the
  plugin's only such setting (`docs/07` §8.5).
- Do **not** block the main thread; long jobs run from a modeless dialog (R-10).

**Done when.**
- [ ] A 200-item scripted run with `concurrency = 3` never has more than three calls in flight,
      asserted by instrumenting `mockLLM`.
- [ ] Cancelling at item 87 leaves exactly 86 completed results, writes no partial result for
      87, and reports "cancelled at 87/200".
- [ ] Re-running the cancelled job dispatches exactly 114 calls.
- [ ] Pause during a call lets that call complete and dispatches nothing further; resume
      continues from the checkpoint.
- [ ] A cancellation issued while a worker is blocked in `RateLimiter.acquire` returns promptly
      rather than after the bucket refills.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llmPool
```

**Notes.** `docs/07` §7.2 carries an **Unverified** marker on the Zotero write-batch chunk size;
that belongs to the import path, not here, and this card must not change it. The
`exclusivityKey` is what stops a second summarize job starting on the same collection while one
is paused.

---

### P3-T18 — Text acquisition tiers 1–2 (abstract, attachment text)

| Field | Value |
|---|---|
| **ID** | `P3-T18` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T19`, `P3-T27` |
| **Retires** | part of `R-19` |
| **Implements** | part of `FR-21`, part of `FR-22` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** For any Zotero item the plugin can obtain the normalized abstract and, where one
exists, the attachment's full text — without re-parsing a PDF Zotero has already indexed and
without mutating the user's library.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §3.1 — the four-tier ladder, the stop-at-first-hit
  rule, and **D-06-1** (prefer Tier 3 JATS over Tier 2 PDF when both exist, behind
  `fullText.preferJATS`)
- `docs/06-summarization-and-trend-report.md` §3.2 — abstract normalization in five ordered
  steps, including **keeping** `BACKGROUND:` / `METHODS:` labels because they are free
  supervision, and the placeholder rejection list
- `docs/06-summarization-and-trend-report.md` §3.3.1 — the API reality table: **`Zotero.Fulltext.getItemContent`
  does not exist**, `setItemContent` is a sync *writer* and must not be called, and the
  `fulltextItemWords` tables are a word-ID index from which text cannot be reconstructed
- `docs/06-summarization-and-trend-report.md` §3.3.2 — **D-06-2**: `await attachment.attachmentText`
  is the primary Tier-2 API, and the annotated source of what it already does for us
- `docs/06-summarization-and-trend-report.md` §3.3.3 — `pickTextAttachment()` using
  `getBestAttachment()`, `isPDFAttachment()` and `Zotero.Fulltext.canIndex()` as the gate
- `docs/06-summarization-and-trend-report.md` §3.3.4 — **D-06-3**: the index-state constants,
  `fulltext.pdfMaxPages` defaulting to 100, `getPages()`, the `fullText.hardPageCap` re-extract
  rule, and the prohibition on calling `indexItems()`
- `docs/06-summarization-and-trend-report.md` §3.3.5 — **D-06-4**: `getFullText`'s exact return
  shape and the text layout contract (`\f` between pages, `\n` for paragraph breaks, spaces for
  wrapped lines, final NFC)
- `docs/06-summarization-and-trend-report.md` §3.6 — the `AcquiredSource` object every tier
  must fill, including `contentHash`, `truncated` and `warnings`
- `docs/07-architecture-and-data-model.md` §8.5 "Summarization" — `summary.minAbstractChars`,
  `fullText.preferJATS`, `fullText.hardPageCap` keys, types and defaults

**Files.**
- create `src/zotero/fulltext.ts`
- create `src/pipeline/summarize/acquire.ts`
- create `src/pipeline/summarize/normalizeAbstract.ts`
- modify `src/model/summary.ts`
- create `test/unit/pipeline/normalizeAbstract.spec.ts`
- create `test/integration/zotero/acquireFullText.spec.ts`

**Do.**
1. Implement Tier 1: read `item.getField('abstractNote')`, run the five normalization steps in
   order, and reject anything under `summary.minAbstractChars` or matching a placeholder.
2. Implement `pickTextAttachment()` exactly as `docs/06` §3.3.3 sketches it, gating on
   `Zotero.Fulltext.canIndex()`.
3. Implement Tier 2 through `await attachment.attachmentText`.
4. Implement the D-06-3 page-truncation policy: read `getIndexedState()`; on
   `INDEX_STATE_PARTIAL`, read `getPages()`; if `total > indexedPages` **and**
   `total <= fullText.hardPageCap`, bypass the cache with
   `Zotero.PDFWorker.getFullText(attachment.id, null)`; otherwise accept the truncated text and
   set `truncated: true`.
5. Catch `Zotero.PDFWorker.getFullText` failures (password-protected, corrupt) and demote to
   Tier 1 with a `pdf_password_protected` warning.
6. Fill `AcquiredSource` including `contentHash` as SHA-256 over the exact text that will be
   sent, computed with `crypto.subtle` and falling back to
   `Zotero.Utilities.Internal.md5` if it is unavailable.
7. Always prepend the normalized abstract as a framing preamble on full-text tiers.

**Do NOT.**
- Do **not** call `Zotero.Fulltext.getItemContent` — it does not exist (`docs/06` §3.3.1).
- Do **not** call `Zotero.Fulltext.setItemContent` — it is the sync *download* writer, not a
  reader (`docs/06` §3.3.1).
- Do **not** read `.zotero-ft-cache` directly and do **not** touch the `fulltextItems`,
  `fulltextItemWords` or `ftindex.*` tables. The word-ID index cannot reconstruct text and the
  schema is version-fragile (`docs/06` §3.3.1, D-06-2).
- Do **not** call `Zotero.Fulltext.indexItems()` to force indexing. That mutates the user's
  library and index as a side effect of running a report (`docs/06` §3.3.4).
- Do **not** trigger a file download for an attachment that is not synced locally
  (`docs/06` §13.5).
- Do **not** treat `INDEX_STATE_PARTIAL` as normal. `fulltext.pdfMaxPages` defaults to 100 and
  journal articles are rarely that long, so partial usually means something went wrong — and
  **"never silently summarize a truncated document as if it were complete"** (D-06-3).
- Do **not** reach for `Zotero.Fulltext.semanticSplitter` for chunking. It is a word-boundary
  tokenizer returning a deduplicated bag of lowercase words (`docs/06` §3.3.6).
- Do **not** strip structured-abstract labels; they measurably improve extraction
  (`docs/06` §3.2 step 1).
- Do **not** hash the file or use `dateModified` for `contentHash` — hash the acquired text
  actually sent (`docs/06` §11.2, `docs/07` §9.1).

**Done when.**
- [ ] An item with a fully indexed PDF yields Tier 2 text with zero `PDFWorker` calls, asserted
      by spying on `Zotero.PDFWorker.getFullText`.
- [ ] An item whose attachment reports `INDEX_STATE_PARTIAL` with `total` under
      `fullText.hardPageCap` triggers exactly one full re-extraction; with `total` over the cap
      it does not, and `truncated` is `true`.
- [ ] A password-protected PDF fixture demotes to Tier 1 with the documented warning and does
      not throw out of the pipeline.
- [ ] Abstract normalization keeps `RESULTS:` labels, strips a trailing copyright line, and
      rejects `"No abstract available"`.
- [ ] `contentHash` changes when the acquired text changes and is stable when only
      `dateModified` changes.
- [ ] No test or code path calls `indexItems`, `setItemContent`, or `getItemContent`, asserted
      by a repository grep test.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- normalizeAbstract && npm run test:integration -- --grep acquireFullText
```

**Notes.** Phase 0's `V-15` spike already confirmed the index is readable from a plugin; if its
report records a quality caveat, that caveat belongs in the `warnings` array here rather than in
new logic. `crypto.subtle` availability in the Zotero 10 plugin scope carries an **Unverified**
marker in `docs/06` §11.2 — probe it once at startup and record the answer, since the fallback
is a one-line change and the key is a cache lookup, not a security boundary.

---

### P3-T19 — Tiers 3–4, cleaning pass, OCR probe, language detection

| Field | Value |
|---|---|
| **ID** | `P3-T19` |
| **State** | `TODO` |
| **Depends on** | `P3-T18` |
| **Blocks** | `P3-T20`, `P3-T21`, `P3-T26` |
| **Retires** | `R-19` |
| **Implements** | `FR-21`, `FR-22` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Full text is cleaned of page furniture, references and supplements before it costs
anything; garbage extraction is detected and demoted rather than sent; and an item with no
usable text produces a stub with no LLM call at all.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §3.4 — the Europe PMC `fullTextXML` endpoint, the
  `isOpenAccess === "Y" && inEPMC === "Y"` gate, and the JATS element handling table with its
  drop list
- `docs/06-summarization-and-trend-report.md` §3.5 — Tier 4: a stub summary with **no LLM call**,
  excluded from synthesis, listed in the appendix
- `docs/06-summarization-and-trend-report.md` §4.1 — the eight-step cleaning pass in order,
  especially step 4's de-hyphenation separator and step 8's OCR probe threshold of 0.80
- `docs/06-summarization-and-trend-report.md` §4.2 — the character-block language heuristic and
  its 15 % threshold
- `docs/06-summarization-and-trend-report.md` §13.1 — the two cheap recoveries before giving up
  (metadata refetch, open-access full text) and the consent rule for writing an abstract back
- `docs/06-summarization-and-trend-report.md` §13.5 — the failure table: missing file, scanned
  image, corrupt PDF
- `docs/07-architecture-and-data-model.md` §7.3 — the `www.ebi.ac.uk` limiter row, which this
  fetch must share rather than opening its own pool

**Files.**
- create `src/pipeline/summarize/jats.ts`
- create `src/pipeline/summarize/clean.ts`
- create `src/pipeline/summarize/languageDetect.ts`
- modify `src/pipeline/summarize/acquire.ts`
- create `test/unit/pipeline/clean.spec.ts`
- create `test/unit/pipeline/jats.spec.ts`
- create `test/fixtures/fulltext/`

**Do.**
1. Implement Tier 3: check `isOpenAccess` and `inEPMC` from the Europe PMC `core` search result,
   then `GET .../{PMCID}/fullTextXML`, parse with `DOMParser`, and apply the §3.4 element table
   — keeping captions, dropping `xref`, formulae, `ref-list`, acknowledgements, footnotes and
   the named administrative sections.
2. Honour `fullText.preferJATS` (D-06-1): when true and the item qualifies, try Tier 3 before
   Tier 2, falling back to Tier 2 on any failure.
3. Implement the §4.1 cleaning pass for Tier 2 only, in order: page split on `\f`, running
   head/foot removal at the 60 % threshold, line-number gutter stripping, de-hyphenation,
   whitespace collapse, reference-list truncation with the 8–60 % sanity check, supplementary
   removal, and the OCR probe.
4. On an OCR probe below 0.80, push `ocr_suspected` and demote to Tier 1 when an abstract
   exists.
5. Implement the §4.2 language heuristic and set `language_non_english` above 15 %.
6. Implement Tier 4: a stub `PaperSummary` with `sourceTier: "metadata_only"`, every analytical
   field `null`, `confidence: "none"`, and **no LLM call**.
7. Implement the §13.1 recoveries: a DOI/PMID metadata refetch for a missing abstract, and the
   DOI-to-PMCID open-access path — with the write-back of a recovered abstract gated on one
   explicit consent per run, not per item.

**Do NOT.**
- Do **not** fetch `fullTextXML` without the open-access gate. A non-OA PMCID returns an error
  document, not text (`docs/06` §3.4).
- Do **not** open a second connection pool for Europe PMC — share the limiter
  (`docs/06` §3.4, `docs/07` §7.3).
- Do **not** write a de-hyphenation rule of the form `/(\w)-\n(\w)/`. It never matches: the
  extractor emits a **space** for a wrapped line, so a broken word arrives as `hyphen- ation`
  (`docs/06` §4.1 step 4).
- Do **not** run a generic blank-line paragraph heuristic over Zotero PDF text. `\n` already
  means paragraph and `\f` already means page (D-06-4).
- Do **not** truncate the reference list without the 8–60 % sanity check — a mid-document false
  positive would silently delete the results (`docs/06` §4.1 step 6).
- Do **not** send text that failed the OCR probe. "Never send ligature soup to a model"
  (`docs/06` §13.5).
- Do **not** spend an LLM call on a Tier 4 item. "Spending an LLM call to hallucinate a summary
  from a title is the single worst thing this pipeline could do. It is structurally prevented"
  (`docs/06` §3.5, FR-21).
- Do **not** write a recovered abstract back to `abstractNote` without explicit consent — it is
  a library mutation (`docs/06` §13.1, NFR-20).

**Done when.**
- [ ] A recorded JATS fixture yields sectioned text with references, formulae and the
      funding/conflict sections removed, and figure captions retained.
- [ ] The cleaning pass over a recorded two-column PDF text fixture removes the running head
      from every page and the reference list, and the removal falls inside the 8–60 % band.
- [ ] A scanned-PDF fixture scores below 0.80 on the probe, carries `ocr_suspected`, and the
      acquired tier is `abstract`.
- [ ] A Korean-language abstract fixture sets `language_non_english`.
- [ ] An item with no abstract and no attachment produces a Tier 4 stub, and the test asserts
      zero calls on `mockLLM`.
- [ ] `fullText.preferJATS = true` with an OA item and a local PDF selects Tier 3; setting it
      false selects Tier 2.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(clean|jats|languageDetect)"
```

**Notes.** This card is the one that retires **R-19**. The quality gate is cheap, deterministic
and runs before any spend — which is exactly why R-19's mitigation names the cost preview as the
*backstop* rather than the primary control: a garbage extraction that inflates the token count
becomes visible in `P3-T16`'s dialog before the money is spent, not after.

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
| **Human gate** | **Yes** — a human must supply the PDFs and adjudicate the ground truth. An agent cannot decide whether a heading is really the start of Methods, and it cannot decide whether a publisher PDF may be committed to the repository. Stop and ask for both. |

**Goal.** A committed, licence-clean, ground-truth-labelled corpus of 40 papers spanning the
layouts that matter, against which the section detector can be measured rather than assumed.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §4.3 final block — the fixture-set requirement in
  full: 40 PDFs spanning Elsevier, Springer, Wiley, OUP, PLOS, Nature, IEEE and arXiv-LaTeX, and
  the ≥ 85 % correct-section-attribution bar required **before Phase 3 ships**
- `docs/11-implementation-roadmap.md` §3 **R-19b** — why this exists, why a mis-labelled section
  is worse than an unlabelled one, and the owner decision required if the spike fails
- `docs/11-implementation-roadmap.md` §4.2 `V-8b` — the Phase 0 spike that inspected
  `getStructuredDocumentText` on five PDFs; its report says whether font geometry is available
  and therefore whether this detector can ever be more than a regex
- `docs/09-security-privacy-and-api-keys.md` §4.4 — licensing and redistribution of publisher
  content, which governs what may be committed to a public repository
- `docs/13-testing-build-and-release.md` §3.1–§3.2 — the fixture conventions this corpus must
  follow: committed, small, with a `_meta.json` sidecar, and never hand-edited to make a test
  pass
- `docs/06-summarization-and-trend-report.md` §3.3.5 — the extractor's text layout contract, so
  the stored fixture is extracted text with `\f` and `\n` intact rather than a re-derived form

**Files.**
- create `test/fixtures/imrad/README.md`
- create `test/fixtures/imrad/manifest.json`
- create `test/fixtures/imrad/text/` *(40 extracted-text files)*
- create `test/fixtures/imrad/labels/` *(40 ground-truth label files)*
- create `scripts/build-imrad-fixtures.ts`
- create `test/unit/pipeline/imradFixtureManifest.spec.ts`

**Do.**
1. Agree the corpus composition with the owner: 40 papers with at least four per publisher
   family named in `docs/06` §4.3, a mix of single- and two-column layouts, at least six
   preprints (arXiv, bioRxiv, medRxiv), and at least two known-difficult cases (a
   Results-and-Discussion combined heading, and an unnumbered-heading layout).
2. Write `scripts/build-imrad-fixtures.ts` to run each PDF through the `P3-T18`/`P3-T19`
   acquisition and cleaning path and emit the extracted text — **not** the PDF — plus a
   `_meta.json` sidecar recording publisher, layout, DOI, extraction date and tool version.
3. Have the human adjudicate ground truth: for each fixture, a labels file giving the character
   offset at which each `ImradSection` begins, using the union of the `docs/06` §4.3 enum.
4. Record, per fixture, whether the paper genuinely has IMRaD structure at all — a review or an
   editorial legitimately does not, and scoring it as a detector failure would be wrong.
5. Store the corpus composition and the licence decision in
   `test/fixtures/imrad/README.md`.

**Do NOT.**
- Do **not** commit publisher PDFs to the repository without a licence decision from the owner.
  `docs/09` §4.4 governs redistribution of publisher content; extracted text of a small sample
  for testing is a different question from redistributing the article, and the answer belongs to
  the owner, not to the implementer.
- Do **not** generate the ground-truth labels with an LLM or with the detector under test. A
  corpus labelled by the thing being measured measures nothing.
- Do **not** hand-edit a fixture to make the detector pass. Re-record, or add a scenario
  (`docs/13` §3.3 rule 4).
- Do **not** substitute a smaller corpus. Forty is the number in `docs/06` §4.3 and in R-19b's
  mitigation; a 10-PDF corpus cannot separate 85 % from 70 % with any confidence.
- Do **not** draw all 40 from one discipline or one decade — the two-column publisher layout is
  the case the regex detector is weakest on and it must be well represented.

**Done when.**
- [ ] `test/fixtures/imrad/manifest.json` lists exactly 40 entries with publisher, layout,
      column count, preprint flag and `hasImradStructure`.
- [ ] Every publisher family named in `docs/06` §4.3 has at least four entries.
- [ ] Every fixture has a labels file, and a validator asserts that offsets are monotonic and
      within the text length.
- [ ] `test/fixtures/imrad/README.md` records the owner's licence decision and the corpus
      rationale.
- [ ] `scripts/build-imrad-fixtures.ts` reproduces every text file byte-identically from its
      source PDF, or the README explains why a given fixture cannot be reproduced.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- imradFixtureManifest
```
Then, manually: confirm with the owner that the licence decision in the README is theirs and
that the 40 ground-truth labellings have been reviewed.

**Notes.** This is the single most expensive card in the phase that produces no shipped code,
and it is on the critical path only because decision **D7** made full text the default. If the
owner decides the corpus cannot be committed, the fallback is to commit the labels and the
`_meta.json` sidecars, keep the extracted text out of the repository, and have
`build-imrad-fixtures.ts` regenerate it from a locally-held Zotero collection — the accuracy
harness in `P3-T22` must then be runnable locally but skipped in CI with an explicit skip
reason, never a silent pass.

**Estimate — re-estimated 2026-09-09 from 1.0 d to 1.75 d, and here is the derivation.** The
1.0 d figure did not survive reading the card's own steps: a 40-PDF corpus across eight
publisher families, driven through the `P3-T18`/`P3-T19` path by a script that must reproduce
every text file byte-identically, is not a one-day job even before the labels exist.

*What is developer work and what is the human's.* `plan/README.md` §7 and `docs/11`'s preamble
both measure **developer**-days, so the figure below counts only the developer's hours. The
human's share is gate **G-12** (`plan/06-human-gates.md`): sourcing 40 PDFs from their own
subscribed access — `docs/09` §5.7 forbids an agent obtaining them — adjudicating the section
offsets for all 40, and taking the `docs/09` §4.4 licence decision. `plan/06` rates G-12 as
"days of the human's own time" and tells the human to start it in Phase 0 for exactly this
reason. As an order-of-magnitude check on that wording rather than as a figure this card owns:
40 fixtures at roughly 10–15 minutes of adjudication each is ≈ 7–10 hours, and sourcing the
PDFs is on top of it — so **≈ 2–3 days of the human's elapsed time, none of it developer-days**.
That is why the card's number can be smaller than the calendar span it sits in, and why the
figure stays comparable with every other card in this file.

*Developer work, bottom-up from the `Do` steps and the `Done when` criteria.*

| Work | d |
|---|---|
| Step 1: write the corpus-composition spec the owner is asked to agree — ≥ 4 per publisher family across the eight in `docs/06` §4.3, the single/two-column mix, ≥ 6 preprints, the two known-difficult cases — then check what comes back for coverage gaps and re-ask | 0.25 |
| Step 2: `scripts/build-imrad-fixtures.ts` — drive 40 PDFs through the `P3-T18`/`P3-T19` acquisition and cleaning path, emit extracted text with `\f` and `\n` intact per `docs/06` §3.3.5, emit the `_meta.json` sidecars, and make the run byte-reproducible across eight publishers' PDF quirks | 0.75 |
| Step 3 support: define the labels-file format over the `docs/06` §4.3 `ImradSection` enum and build the ingest path that turns the human's adjudication into 40 label files (the adjudication itself is G-12, above) | 0.25 |
| Steps 4–5: `manifest.json` with `hasImradStructure` and the layout metadata per fixture, and `test/fixtures/imrad/README.md` recording composition, rationale, the licence decision and any non-reproducible fixture | 0.25 |
| `test/unit/pipeline/imradFixtureManifest.spec.ts`: exactly-40 check, ≥ 4 per publisher family, and the validator asserting offsets are monotonic and inside the text length | 0.25 |
| **Total** | **1.75** |

**1.75 d**, and nothing in it is padding. Three things are deliberately *outside* the figure:
the G-12 human time above; the "sourcing them from scratch" case, which §3 already costs
separately at "at least half a day" and which this card still assumes away; and the licence
fallback in the paragraph above — if the owner refuses redistribution, the labels-only layout
with local regeneration and an explicitly-skipped CI run adds roughly a further 0.25 d, and
should be added then rather than carried now.

---

### P3-T21 — IMRaD section detector (JATS + PDF heading table)

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

**Goal.** Sections are labelled exactly where the source says so (JATS) and heuristically where
it does not (PDF), and the heuristic declares failure rather than guessing.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §4.3 — the `ImradSection` union, the JATS
  `@sec-type` mapping, the **ordered** PDF heading regex table, the candidate-heading
  preconditions (< 90 chars, followed by a blank line or a capitalized sentence, no terminal
  period), and the "fewer than two sections recognized → segmentation failed" rule
- `docs/06-summarization-and-trend-report.md` §4.3 the ordering warning — `^…(results?)\b` also
  matches "Results and Discussion" because the `\b` sits before the space, so the combined row
  **must** be tested first
- `docs/06-summarization-and-trend-report.md` §3.4 — the JATS side: `@sec-type` maps directly and
  untyped sections fall through to the same heading table
- `docs/06-summarization-and-trend-report.md` §3.6 — `AcquiredSource.sections`, the shape this
  detector fills
- `docs/11-implementation-roadmap.md` §4.2 `V-8b` — whether `getStructuredDocumentText` exposes
  usable font geometry. **Read the Phase 0 `V-8b` report before writing the detector**, because
  `docs/06` §3.3.5 puts this method **on the v1 critical path** and states the consequence
  directly: "If it exposes font size/weight, the regex heading detector in §4.3 is replaced by a
  geometry-driven one and section provenance is trustworthy. If it does not, `auto` degrades to
  whole-document chunking." The regex table below is the *no-geometry* branch
- `docs/06-summarization-and-trend-report.md` §3.3.5, the `getStructuredDocumentText` block —
  its verified signature (`(itemID, { isPriority, password, onProgress })` → `Object|null`, and
  it works for PDF, EPUB and snapshot attachments), the **Unverified** marker on its
  serialization, and the paragraph recording that an earlier draft calling it "not used in v1"
  pre-dates decision **D7** and is wrong

**Files.**
- create `src/pipeline/summarize/imrad.ts`
- modify `src/pipeline/summarize/acquire.ts`
- create `test/unit/pipeline/imrad.spec.ts`

**Do.**
1. Implement `detectSectionsFromJats(doc)`: map `@sec-type` directly, fall through untyped
   sections to the heading table, and drop `supplementary-material`.
2. Implement `detectSectionsFromText(text)`: find candidate heading lines by the three
   preconditions, then test the regex rows **top to bottom, stopping at the first match**, in
   the exact order `docs/06` §4.3 gives.
3. Mark a "Results and Discussion" heading as **both** `results` and `discussion`.
4. Assign text before the first recognized heading to `other`.
5. Return `{ sections, sectionAware }` where `sectionAware` is false whenever fewer than two
   IMRaD sections were recognized.
6. Expose a single `sectionAware` flag on `AcquiredSource` for the chunker and the prompt
   selector to read.

**Do NOT.**
- Do **not** reorder the regex table. Testing `results?` before `results and discussion` labels
  the combined heading `results` and attributes the entire discussion body to Results — the
  exact mis-attribution R-19b names as worse than no label (`docs/06` §4.3).
- Do **not** guess a section when fewer than two are recognized. Declare failure and set
  `sectionAware: false` (`docs/06` §4.3).
- Do **not** invent section types outside the `ImradSection` union.
- Do **not** treat a numbered heading's number as part of the label — the `(\d+\.?\s*)?` group
  exists to absorb it.
- Do **not** write the regex detector without first reading the Phase 0 `V-8b` report. The claim
  that `getStructuredDocumentText` is "not used in v1" is **withdrawn**: `docs/06` §3.3.5 now
  marks it "on the v1 critical path — this is not an optional extra" and records that the
  earlier statement pre-dates D7 and is wrong. If `V-8b` found usable font size/weight, §3.3.5
  says the geometry-driven detector **replaces** this heading table rather than supplementing
  it, and that is a scope change the owner decides before this card is executed — not something
  to discover after `P3-T22` measures the regex.
- Do **not** invent a geometry path from the serialization on your own. §3.3.5's **Unverified**
  marker on `packStructuredDocumentText` is still open; only the `V-8b` report closes it, and
  guessing the shape produces a detector nobody can measure.
- Do **not** let the detector run on Tier 1 or Tier 4 text — there are no sections to find.

**Done when.**
- [ ] A JATS fixture with `@sec-type="methods"` yields a `methods` section at the right offsets.
- [ ] A text fixture whose heading is "3. Results and Discussion" yields a section marked both
      `results` and `discussion`, asserted explicitly.
- [ ] A text fixture with only a title page and body text yields `sectionAware: false`.
- [ ] A heading line of 120 characters is not treated as a heading.
- [ ] A line ending in a period is not treated as a heading.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- pipeline/imrad
```

**Notes.** This card deliberately does **not** claim the detector is good enough — that is
`P3-T22`'s job and it is a measurement, not an opinion. Ship this card even if you expect it to
fail the threshold; the degrade path in `P3-T22` is what makes shipping it safe.

**Changed 2026-09-09 — `getStructuredDocumentText` is no longer "not used in v1".** The
documentation pass corrected `docs/06` §3.3.5: the method is on the v1 critical path, `V-8b` is
a required Phase 0 spike rather than a deferred one, and the sentence this card previously
quoted as a prohibition is explicitly retracted there. The regex table stays the v1 design *if
and only if* `V-8b` found no usable geometry; if it did, §3.3.5 replaces this detector rather
than extending it, and that is an owner call before execution, not an implementer's option.

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
| **Human gate** | **Yes** — if the measured accuracy is below 85 %, the owner decides. R-19b names the two options: ship whole-document chunking, or flip `summary.fullTextMode`'s default back to abstracts. An agent must stop, report the measured number per publisher family, and wait. |

**Goal.** The detector's section-attribution accuracy is a measured number in the repository,
and below the threshold `auto` degrades to flat chunking automatically rather than by
remembering to.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §4.3 final block — the ≥ 85 % bar, the requirement
  that until it passes `auto` must degrade to **whole-document flat chunking** with
  `sectionAware: false`, and that **the summary prompt must not claim section provenance**
- `docs/11-implementation-roadmap.md` §3 R-19b — the full mitigation and the sentence "Owner
  decision required if the spike fails: ship whole-document chunking, or flip the default back
  to abstracts"
- `docs/11-implementation-roadmap.md` §1 Phase 3 "Risks retired" — R-19b is retired either by
  the detector passing **or** by `auto` being degraded; both are acceptable exits
- `docs/06-summarization-and-trend-report.md` §5.3 — the flat path the degrade falls back to,
  so the fallback is a switch rather than new code
- `docs/12-prompt-library.md` §5 `PAPER_SUMMARY_FULLTEXT` — the prompt whose section-provenance
  language must be suppressed when `sectionAware` is false

**Files.**
- create `scripts/measure-imrad.ts`
- create `test/unit/pipeline/imradAccuracy.spec.ts`
- modify `src/pipeline/summarize/imrad.ts`
- modify `src/pipeline/summarize/acquire.ts`
- create `docs/spikes/imrad-accuracy-report.md`

**Do.**
1. Write `scripts/measure-imrad.ts`: run the detector over all 40 fixtures and score
   **section attribution per character** against the ground-truth labels — the fraction of body
   characters assigned the correct `ImradSection`.
2. Report the score overall and broken down by publisher family, column count and
   preprint/published, so a failure is diagnosable rather than a single number.
3. Exclude fixtures flagged `hasImradStructure: false` from the score and report them
   separately.
4. Add a build-time constant `IMRAD_DETECTOR_VALIDATED` set from the committed measurement, and
   make `acquire.ts` force `sectionAware: false` when it is false — a switch, not a code path.
5. Make the prompt selector drop all section-provenance language when `sectionAware` is false.
6. Commit the measurement, its date, the per-family breakdown and the resulting decision to
   `docs/spikes/imrad-accuracy-report.md`.
7. Add a regression test that fails if a later change drops the measured score below the
   recorded value.

**Do NOT.**
- Do **not** ship `sectionAware: true` on an unmeasured detector. That is precisely the state
  R-19b describes as high likelihood, high impact.
- Do **not** lower the threshold to make the detector pass. 85 % is `docs/06` §4.3's number; if
  it is wrong, the owner changes it in `docs/06`, not the implementer in a test.
- Do **not** let a mis-labelled section reach the prompt. "A wrong section label is worse than
  no section label, because the summary prompt trusts it" (`docs/06` §5.4).
- Do **not** leave section-provenance wording in the prompt when the detector is degraded
  (`docs/06` §4.3).
- Do **not** score fixtures that legitimately have no IMRaD structure as detector failures.
- Do **not** silently skip the harness in CI when the corpus is unavailable — skip with an
  explicit reason that the test reports (see `P3-T20` Notes).

**Done when.**
- [ ] `scripts/measure-imrad.ts` prints an overall accuracy figure plus the three breakdowns,
      and exits non-zero below the threshold.
- [ ] `docs/spikes/imrad-accuracy-report.md` records the measured number, the date, the
      breakdown and the owner's decision.
- [ ] With `IMRAD_DETECTOR_VALIDATED = false`, an acquisition over a full-text item returns
      `sectionAware: false` and the chunker takes the flat path.
- [ ] With `sectionAware: false`, the assembled `PAPER_SUMMARY_FULLTEXT` prompt contains no
      section-provenance sentence, asserted on the rendered prompt string.
- [ ] The regression test fails when the detector is deliberately degraded in a test double.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- imradAccuracy && npx tsx scripts/measure-imrad.ts
```
Then, if the score is below 85 %: stop, report the overall and per-family figures, and ask the
owner to choose between whole-document chunking and reverting `summary.fullTextMode`'s default.

**Notes.** Both exits retire R-19b — `docs/11` §3.1 lists it as "detector validated against the
40-PDF fixture set, **or** `auto` degraded". Degrading is not a failure of the phase; shipping
an unmeasured detector would be. If the owner chooses to revert the default, that changes
decision **D7** and therefore `docs/00` §3, `docs/06` §5.4 and `docs/07` §8.5 — a documentation
change the owner makes, not a code change made quietly here.

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

**Goal.** Any acquired text is turned into either one single-shot call or a labelled chunk
sequence that fits the model's window with the right things dropped first when the budget runs
out.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.3 — the three paths in full: the section-aware
  ordering by synthesis value, the percentage budget shares, the paragraph-packing rule, the
  **within-section-only** 1-paragraph/250-token overlap, the chunk label format, the flat path,
  and the single-shot short-circuit
- `docs/06-summarization-and-trend-report.md` §5.2 — the budget inequality and the per-call
  input budgets and output ceilings for `PAPER_SUMMARY_FULLTEXT`, `CHUNK_MAP` and
  `CHUNK_REDUCE`
- `docs/06-summarization-and-trend-report.md` §5.1 **D-06-5** — the 1.15x safety multiplier and
  the reservation of `maxOutputTokens` plus 800 tokens
- `docs/06-summarization-and-trend-report.md` §3.3.5 **D-06-4** — `\f` is a hard page boundary
  and `\n` is a paragraph boundary, guaranteed by the extractor
- `docs/07-architecture-and-data-model.md` §4.3 `ModelInfo.contextWindowTokens` /
  `maxOutputTokens` — the per-model numbers the inequality is checked against
- `docs/06-summarization-and-trend-report.md` §13.5 — the context-length safety net: halve the
  chunk budget for that paper and retry once

**Files.**
- create `src/llm/shared/chunking.ts`
- modify `src/pipeline/summarize/acquire.ts`
- create `test/unit/llm/chunking.spec.ts`

**Do.**
1. Implement `planChunks(source, model, promptId)` returning either
   `{ kind: "single-shot" }` or `{ kind: "chunked", chunks }`.
2. Take the single-shot path whenever the whole cleaned text fits the
   `PAPER_SUMMARY_FULLTEXT` input budget, and prefer it — "both cheaper and better: no
   map-reduce information loss".
3. On the section-aware path, order sections by synthesis value and allocate the §5.3
   percentage shares, dropping the lowest-value sections first when over budget.
4. Split within a section on paragraph boundaries and pack greedily; split on sentence
   boundaries only when a single paragraph exceeds the budget.
5. Carry the last paragraph, capped at 250 tokens, from chunk *i* into chunk *i+1* — **only
   within the same section**.
6. Label every chunk `[SECTION: x] [CHUNK i/n] [PAPER: itemKey ...]`.
7. On the flat path, pack paragraphs in document order with a 250-token overlap between all
   adjacent chunks and the section label `unknown`.
8. Check the §5.2 inequality against `ModelInfo` with the D-06-5 multiplier and reservation, and
   implement the halve-and-retry-once safety net for a `ContextLengthExceededError`.

**Do NOT.**
- Do **not** overlap across a section boundary. "Methods bleeding into Results is precisely the
  confusion that produces wrong `studyDesign` extractions" (`docs/06` §5.3 step 4).
- Do **not** chunk in document order on the section-aware path. The ordering exists so that what
  gets dropped under budget pressure is the introduction, not the results (`docs/06` §5.3 step 1).
- Do **not** split a paragraph across chunks unless the paragraph alone exceeds the budget
  (`docs/06` §5.3 step 3).
- Do **not** detect paragraphs with a blank-line heuristic — `\n` already is one (D-06-4).
- Do **not** chunk when the text fits: the single-shot path is cheaper and loses less
  (`docs/06` §5.3).
- Do **not** omit the D-06-5 multiplier or the 800-token overhead reservation; the estimator is
  deliberately conservative and the budget assumes it.
- Do **not** retry a context-length error unchanged. Halve the chunk budget for that paper and
  retry once (`docs/06` §13.5, `docs/03` §11.6).
- Do **not** emit a section label other than `unknown` when `sectionAware` is false
  (`P3-T22`).

**Done when.**
- [ ] A 9 000-token cleaned text with a 24 000-token budget produces exactly one single-shot
      plan and zero chunks.
- [ ] A 60 000-token text produces chunks whose per-section character shares match the §5.3
      percentages within 5 %.
- [ ] No chunk boundary within a section loses a paragraph, asserted by reassembling the chunks
      minus overlap and comparing to the section text.
- [ ] No overlap crosses a section boundary, asserted directly.
- [ ] With `sectionAware: false` every chunk carries the label `unknown` and the overlap is
      applied between all adjacent chunks.
- [ ] A simulated `ContextLengthExceededError` triggers exactly one halved-budget retry and then
      propagates.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- llm/chunking
```

**Notes.** The 24 000-token single-shot budget covers "the large majority of journal articles
once references and supplements are stripped" (`docs/06` §5.3) — which is why `P3-T19`'s
cleaning pass is worth its estimate twice over: it is what keeps most papers on the ~8x
single-shot regime instead of the ~32x chunked one.

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

**Goal.** Prompts are versioned data files validated at build time, and their version strings
are available to the cache key so a prompt edit invalidates exactly the right entries.

**Read first.**
- `docs/12-prompt-library.md` §17.2 — the MAJOR/MINOR/PATCH semantics and their cache effects,
  including `cacheEpoch` mapping patch-equivalent versions onto one namespace
- `docs/12-prompt-library.md` §17.3 — the storage layout, the exact front-matter fields
  (`id`, `version`, `cacheEpoch`, `schema`, `defaultTemperature`, `defaultMaxTokens`,
  `outputFormat`, `lastReviewed`) and the registry's load-time validation rules
- `docs/12-prompt-library.md` §17.5 — the migration policy and the rule that a released prompt
  file is never mutated in place
- `docs/12-prompt-library.md` §4 and §5 — `PAPER_SUMMARY_ABSTRACT` and
  `PAPER_SUMMARY_FULLTEXT`: their input variables, system and user prompts, and model/temperature
- `docs/12-prompt-library.md` §3 — `RELEVANCE_SCREEN`, its variables, batching guidance, and its
  own "Model / temperature" block (`temperature: 0`, `max_tokens: 100 × batch size`). It is
  **not** in `docs/06` §11.1's temperature table or §5.2's budget table, so §3 is the source for
  both of its parameters
- `docs/12-prompt-library.md` §6 and §7 — `CHUNK_MAP` and `CHUNK_REDUCE`, needed by the chunked
  path
- `docs/12-prompt-library.md` §1.1 — the conventions binding on all prompts, including the
  untrusted-input boundary
- `docs/06-summarization-and-trend-report.md` §11.1 — the temperature policy table these files'
  `defaultTemperature` values must match

**Files.**
- create `src/prompts/index.ts`
- create `src/prompts/paper-summary-abstract.v1.0.0.md`
- create `src/prompts/paper-summary-fulltext.v1.0.0.md`
- create `src/prompts/chunk-map.v1.0.0.md`
- create `src/prompts/chunk-reduce.v1.0.0.md`
- create `src/prompts/relevance-screen.v1.0.0.md`
- create `src/prompts/schemas/paper-summary.v1.json`
- create `test/unit/prompts/registry.spec.ts`

**Do.**
1. Transcribe the five prompts from `docs/12` §3–§7 **verbatim** into versioned files with the
   §17.3 front matter.
2. Copy the canonical `PaperSummary` v1 JSON Schema from `docs/06` §6.2 into
   `src/prompts/schemas/paper-summary.v1.json` unchanged.
3. Implement the registry: parse front matter, expose
   `{ id, version, cacheEpoch, system, user, schema, defaultTemperature, defaultMaxTokens }`,
   and render `{{PLACEHOLDER}}` substitutions.
4. Validate at load: every prompt has a version, `cacheEpoch` is a positive integer, every
   placeholder in the text is declared, and every declared variable is used. A malformed file
   fails the build.
5. Set `defaultTemperature` and `defaultMaxTokens` from the section that owns each prompt: for
   `PAPER_SUMMARY_*`, `CHUNK_MAP` and `CHUNK_REDUCE`, `docs/06` §11.1 (temperature **0.0**) and
   §5.2's per-call `max_tokens` ceilings (1 200 / 1 600 / 900 / 1 600); for `RELEVANCE_SCREEN`,
   which appears in neither table, `docs/12` §3 "Model / temperature" — `temperature: 0`,
   `max_tokens: 100 × batch size`, so its `defaultMaxTokens` is derived per call from the batch
   size rather than being a constant in the front matter.
6. Export `PROMPT_VERSIONS` for `P3-T26`'s cache key.
7. Implement the startup comparison of shipped versions against
   `cache.lastSeenPromptVersions` and call `cache.invalidateByTag('promptVersion:<old>')` for
   each change.

**Do NOT.**
- Do **not** scatter prompt text as string literals through the code. Prompts live as data
  (`docs/12` §17.3).
- Do **not** mutate a released prompt file in place. Add a new versioned file; the old text must
  stay readable so a cached output can be explained (`docs/12` §17.5).
- Do **not** write per-provider prompt variants. "One prompt per task, not one per provider…
  If a provider needs different handling, that belongs in the adapter" (`docs/12` §18.1).
- Do **not** interpolate per-paper content into the **system** message — it breaks provider
  prompt caching and crosses the injection boundary (`docs/06` §11.4, `docs/12` §1.1).
- Do **not** add a field to `PaperSummary` here. A new extracted field is added in `docs/06`
  §6.2 first, with the MAJOR bump `docs/12` §17.2 requires (`docs/06` §6.3).
- Do **not** invent a `config/prompt-versions.json`. The last-seen set is the
  `cache.lastSeenPromptVersions` preference (`docs/06` §11.3, `docs/07` §8.5).
- Do **not** delete existing Zotero notes when a prompt version changes — only the cache entry
  (`docs/07` §9.3 trigger 1).

**Done when.**
- [ ] All five prompt files load, and a file with an undeclared placeholder fails the build.
- [ ] A file with `cacheEpoch: 0` or a missing `version` fails the build.
- [ ] `paper-summary.v1.json` is byte-identical to the schema block in `docs/06` §6.2, asserted
      by a test that reads both.
- [ ] Rendering `PAPER_SUMMARY_ABSTRACT` with a fixture item produces a string containing no
      unresolved `{{` sequence.
- [ ] Changing a prompt's version in a test double triggers exactly one
      `invalidateByTag('promptVersion:<old>')` call and deletes no Zotero note.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- prompts/registry
```

**Notes.** `docs/12` §17.6 requires that a version bump which will invalidate a large number of
cached entries warn the user and offer "keep using cached summaries from the previous prompt
version" as a labelled opt-in. That UI belongs with the cache management surface; if it does not
fit this phase, raise it as a Phase 7 card rather than shipping a silent bulk invalidation.

---

### P3-T25 — Per-paper summarizer, DR-1, and the grounding check

| Field | Value |
|---|---|
| **ID** | `P3-T25` |
| **State** | `TODO` |
| **Depends on** | `P3-T12`, `P3-T16`, `P3-T23`, `P3-T24`, `P3-T26` |
| **Blocks** | `P3-T28`, `P3-T29` |
| **Retires** | part of `R-6`, part of `R-19` |
| **Implements** | `FR-19`, `FR-21`, `FR-22` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** One item in, one validated `PaperSummary` out — grounded against its own source text,
recorded as a `StoredSummary` with the provenance an IRB question would need.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.4 **DR-1** — the four normative conditions for
  using full text, and that condition 4 is a **cost gate, not a content trigger**
- `docs/06-summarization-and-trend-report.md` §6.2 — the canonical `PaperSummary` v1 JSON
  Schema, the required field list, and the `itemKey` note ("the client MUST overwrite it with
  the true key and reject a mismatch")
- `docs/06-summarization-and-trend-report.md` §6.3 — the TypeScript form, and the statement that
  this document owns the payload and doc 07 owns the envelope
- `docs/06-summarization-and-trend-report.md` §12.1 — the five hallucination layers, and in
  particular **L3**, the `checkGrounding` function with its normalization, exact-containment
  test, 0.85 token-overlap fallback, and the `groundingScore < 0.5` policy
- `docs/06-summarization-and-trend-report.md` §11.1 — the temperature policy: 0.0 for
  extraction, `top_p: 1`, a `seed` where supported, and the "pin a dated model identifier"
  caveat
- `docs/07-architecture-and-data-model.md` §5.2 — `StoredSummary`, its `id` format
  (`workKey:promptVersion:modelId`), `inputScope`, `contentHash`, `truncated`, `groundingScore`,
  `warnings`, and the explicit warning that `StoredSummary.id` is **not** the cache key
- `docs/12-prompt-library.md` §18.4 — the four invariants a schema cannot express, all of which
  are checked here
- `docs/10-requirements-and-user-stories.md` FR-21 — the exact header strings the note must
  carry for abstract-only versus full-text provenance

**Files.**
- create `src/pipeline/summarize/summarizeItem.ts`
- create `src/pipeline/summarize/grounding.ts`
- modify `src/model/summary.ts`
- modify `src/zotero/db.ts`
- create `test/unit/pipeline/summarizeItem.spec.ts`
- create `test/unit/pipeline/grounding.spec.ts`

**Do.**
1. Implement DR-1 as a pure function over the acquired source, the mode-limited
   `fullTextMode`, and the run's cost decision — returning the chosen tier and prompt id.
2. Enforce condition 3 (`estTokens(fullText) >= 3 * estTokens(abstract)`) in `auto`, and skip it
   in `always`.
3. Issue the call at temperature 0 with `top_p: 1` and a seed where supported, through
   `completeJSON()` against the `PaperSummary` v1 schema.
4. Overwrite `itemKey` with the true key after parsing and log a warning on mismatch.
5. Verify the §18.4 invariants: every `effectSizes[].value` numeral and `population.size`
   numeral appears in the source text.
6. Implement `checkGrounding()` exactly as `docs/06` §12.1 gives it, and apply the policy: below
   0.5 on a full-text summary, retry once at temperature 0 with the added instruction; still
   low, set `confidence: "low"` and record that the `keyFindings` are excluded from downstream
   synthesis.
7. Persist a `StoredSummary` row with `inputScope`, `promptId`, `promptVersion`, `providerId`,
   `modelId`, `temperature`, `usage`, `contentHash`, `truncated`, `groundingScore` and
   `warnings`.
8. Route the chunked path through `CHUNK_MAP` then `CHUNK_REDUCE`, producing one
   `PaperSummary` per paper.

**Do NOT.**
- Do **not** send a Tier 4 item to a model. Structurally prevented (`docs/06` §3.5, FR-21).
- Do **not** trust the model's `itemKey`. Overwrite it; a mismatch is "a reliable signal of
  prompt contamination in batched calls" (`docs/06` §6.4).
- Do **not** recompute an effect size. `EffectSize.value` is verbatim, never recomputed
  (`docs/06` §6.3).
- Do **not** add a field to `PaperSummary`, and do **not** create a third summary shape. There
  are exactly two — `PaperSummary` and `StoredSummary` — and "anything that reads like a third
  is a defect" (`docs/06` §6.3).
- Do **not** add a second confidence field on `StoredSummary`; model-reported confidence is
  `content.confidence` (`docs/07` §5.2).
- Do **not** persist `deriveTldr()`'s output. It is derived, never stored, never sent to a model,
  and must never be presented as something the model said (`docs/07` §5.2).
- Do **not** use `StoredSummary.id` as the cache key. It deliberately keys on fewer components
  (`docs/07` §5.2, `P3-T26`).
- Do **not** use a floating model alias. Pin the dated identifier and record it, or the cache
  claims a model that changed underneath it (`docs/06` §11.1).
- Do **not** claim section provenance in the prompt when `sectionAware` is false
  (`P3-T22`).
- Do **not** interpolate paper content into the system message — it breaks prompt caching across
  the run (`docs/06` §11.4).

**Done when.**
- [ ] Every returned `PaperSummary` validates against `src/prompts/schemas/paper-summary.v1.json`.
- [ ] DR-1 selects the abstract when the full text is under 3x the abstract in `auto`, and the
      full text in `always`, asserted on a fixture pair.
- [ ] A response whose `itemKey` differs from the true key is corrected and produces exactly one
      warning.
- [ ] `checkGrounding()` returns 1.0 for a summary whose `verbatimSupport` spans are present,
      and below 0.5 for one where they are not, and the low case triggers exactly one retry.
- [ ] A summary whose grounding stays low is stored with `confidence: "low"` and a warning
      naming the exclusion.
- [ ] The stored row's `contentHash` equals the hash of the text actually sent, asserted
      against the `AcquiredSource`.
- [ ] The system message is byte-identical across two consecutive items in one run.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(summarizeItem|grounding)"
```

**Notes.** The grounding check is "a cheap, deterministic, LLM-free hallucination detector and
it is the single highest-value quality control in the design" (`docs/06` §12.1). It costs one
substring search per finding and it is what lets Phase 4's report claim traceability rather than
assert it.

---

### P3-T26 — Summary cache keyed per `docs/06` §11.2

| Field | Value |
|---|---|
| **ID** | `P3-T26` |
| **State** | `TODO` |
| **Depends on** | `P3-T19`, `P3-T24` |
| **Blocks** | `P3-T25` |
| **Retires** | part of `R-4` |
| **Implements** | part of `FR-19`, part of `FR-23` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A summary is never paid for twice, and is never served from a cache that no longer
describes what would be produced today.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §11.2 — the canonical component list and the
  paragraph explaining why each one is load-bearing, plus the `sha256Hex` implementation note
  and its `crypto.subtle` caveat
- `docs/07-architecture-and-data-model.md` §9.1 — `summaryKey()`, `stableStringify`,
  `CACHE_SCHEMA_VERSION`, and the statement that §11.2 owns the component list while §9.1 owns
  the hashing mechanics
- `docs/07-architecture-and-data-model.md` §9.2 — the `summary` namespace's indefinite TTL and
  200 MB cap, and the 256 KB blob spill rule. The per-namespace caps in that table are **fixed
  and are not preferences**; the separate *global* cap is the `cache.maxSizeMB` pref (§8.5,
  `integer`, default `500`, 100–5000), owned by the Phase-2 cache layer and not by this card
- `docs/07-architecture-and-data-model.md` §9.3 — the four invalidation triggers and the tag
  scheme (`promptVersion:`, `model:`, `provider:`, `work:`, `schema:`)
- `docs/07-architecture-and-data-model.md` §5.2 — why `StoredSummary.id` and the cache key are
  deliberately different objects
- `docs/07-architecture-and-data-model.md` §8.5 "Summarization" — `cache.enabled`,
  `cache.ignoreModel` and `cache.lastSeenPromptVersions` keys and defaults

**Files.**
- modify `src/core/cache/keys.ts`
- create `src/pipeline/summarize/summaryCache.ts`
- modify `src/core/cache/sqliteCache.ts`
- create `test/unit/core/summaryKey.spec.ts`

**Do.**
1. Implement `summaryKey()` in `src/core/cache/keys.ts` over exactly the §11.2 components:
   namespace, library id, item key, `contentHash`, tier, `promptId`, prompt version, schema
   version, provider, model, temperature — hashed with `stableStringify` and prefixed with
   `CACHE_SCHEMA_VERSION`.
2. Tag every entry `promptVersion:`, `model:`, `provider:`, `work:` and `schema:`.
3. Implement `cache.ignoreModel`: when true, omit the model component and surface a warning that
   the report will mix model generations.
4. Implement the four invalidation triggers, with prompt-version invalidation driven from
   `cache.lastSeenPromptVersions` at startup.
5. Store the payload plus its `meta` block (`promptId`, `promptVersion`, `schemaVersion`,
   `provider`, `model`, `temperature`, `createdAt`) inside the cached object, not only in the
   key.
6. Respect the 256 KB blob-spill rule and the `summary` namespace cap.

**Do NOT.**
- Do **not** key on `dateModified` or on the file. Zotero finishing its full-text index changes
  the text **without touching `dateModified`**, and that must invalidate (`docs/06` §11.2,
  `docs/07` §9.1).
- Do **not** omit `tier`. "An abstract-only summary must not satisfy a full-text request even if
  the abstract text is unchanged" (`docs/06` §11.2).
- Do **not** omit the prompt version or the schema version.
- Do **not** hash an object without `stableStringify`. Without it `{a:1,b:2}` and `{b:2,a:1}`
  are different keys "and the hit rate silently collapses" (`docs/07` §9.1).
- Do **not** reuse `StoredSummary.id` as the cache key (`docs/07` §5.2).
- Do **not** delete Zotero notes on invalidation — only cache entries (`docs/07` §9.3).
- Do **not** evict an entry whose `work_key` belongs to a running job (`docs/07` §9.4 rule 4).
- Do **not** put a cached summary in `Zotero.Prefs`, in any form, including via
  `LargePrefHelper` (`docs/07` §8.5.2, `docs/08` §3.2).

**Done when.**
- [ ] Two runs over an unchanged item with unchanged settings produce a cache hit and zero LLM
      calls on the second.
- [ ] Changing only the acquired text (simulating index completion) produces a miss while
      `dateModified` is untouched.
- [ ] Changing only the tier, only the prompt version, only the schema version, only the
      provider, only the model, or only the temperature each produces a miss — six assertions.
- [ ] `cache.ignoreModel = true` produces a hit across a model change and surfaces the warning.
- [ ] A prompt-version bump invalidates by tag in one statement and leaves Zotero notes intact.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- summaryKey
```

**Notes.** `docs/06` §11.2's `crypto.subtle` availability marker is **Unverified**; the fallback
is `Zotero.Utilities.Internal.md5` and collision risk is irrelevant because this is a cache
lookup, not a security boundary. Probe once at startup, record the result, and do not branch per
call.

---

### P3-T27 — Screening: retractions, non-English, duplicates, relevance

| Field | Value |
|---|---|
| **ID** | `P3-T27` |
| **State** | `TODO` |
| **Depends on** | `P3-T12`, `P3-T18`, `P3-T24` |
| **Blocks** | `P3-T29` |
| **Retires** | part of `R-6` |
| **Implements** | part of `FR-19`, part of `FR-21` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Retracted, non-English and duplicate items are handled by policy before they can
contribute a finding, and search results can be scored for relevance in cheap batches.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §13.3 — the three retraction detection layers, the
  verified `Zotero.Retractions` API surface (`isRetracted` is **synchronous and free**), and the
  policy: keep the item, keep it in the bibliography, exclude it from synthesis, annotate
  expressions of concern rather than excluding them
- `docs/06-summarization-and-trend-report.md` §13.2 — the three non-English policies, the
  default `translate_summary`, and its obligations (`source_language` in
  `notEnoughInformation`, `confidence` capped at medium)
- `docs/06-summarization-and-trend-report.md` §13.4 — the four-step duplicate detection, the
  resolution order, and the explicit instruction **not** to use `Zotero.Duplicates`
- `docs/12-prompt-library.md` §3 — `RELEVANCE_SCREEN`: the batching guidance (10–20 candidates
  per call, under ~8 000 input tokens), the client-side handling rules, and the
  `screening.model` fallback chain
- `docs/07-architecture-and-data-model.md` §8.5 "Summarization" — the exact spellings and
  defaults of `screening.retractionPolicy`, `screening.nonEnglishPolicy`, `screening.dedupe`,
  and the **`screening.threshold` row**: type `integer`, default `60`, range 0–100, surfaced in
  the Search & Import window per run and explicitly **not** in the prefs pane, with `0` meaning
  "record the scores but filter nothing"
- `docs/07-architecture-and-data-model.md` §8.5.1 — the typed `getPref`/`setPref` accessor and
  the rule that plugin code never calls `Zotero.Prefs` directly, which is how the threshold is
  read; it is not on §8.5.1's startup list, so it is read on demand when the dialog is built
- `docs/06-summarization-and-trend-report.md` §4.2 — the language heuristic that feeds the
  non-English policy

**Files.**
- create `src/pipeline/summarize/screen.ts`
- create `src/pipeline/shared/relevanceScreen.ts`
- modify `src/zotero/zoteroApi.ts`
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `src/ui/dialogs/searchDialog.ts`
- create `test/unit/pipeline/screen.spec.ts`
- create `test/unit/pipeline/relevanceScreen.spec.ts`

**Do.**
1. Call `Zotero.Retractions.isRetracted(item)` on every item, and `getData()` /
   `getReasonDescription()` for the appendix reason where it returns true.
2. Add the Crossref `updated-by` check only for items already being fetched from Crossref, and
   the PubMed `pubtype` check from an ESummary response the search already made — flagging
   `"Retracted Publication"` and `"Retraction of Publication"`.
3. Apply `screening.retractionPolicy`: `include`, `exclude_from_synthesis` (default) or
   `exclude_entirely`, and record the count for the report's Scope and Method section.
4. Apply `screening.nonEnglishPolicy` to items flagged `language_non_english`: for
   `translate_summary`, summarize in the source language and emit the `PaperSummary` in English,
   add `source_language: xx` to `notEnoughInformation`, and cap `confidence` at `medium`.
5. Implement collection-scoped duplicate detection per §13.4 steps 1–4, with the documented
   resolution order, recording `duplicate_of:KEY` for the appendix.
6. Implement `RELEVANCE_SCREEN` batching: 10–20 candidates per call under the token cap,
   round-trip every candidate id, re-run a batch once if an id is dropped or invented, then fall
   back to per-item calls for that batch.
7. Resolve the screening model through `screening.model → summaryModel → <provider>.model`.
8. Add the `screening.threshold` row to `src/prefs/schema.ts` and its key constant to
   `src/prefs/keys.ts` exactly as `docs/07` §8.5 declares it — key `screening.threshold`, type
   `integer`, default `60`, `min: 0`, `max: 100`, `secret` absent — and no other new row. Seed
   the Search & Import window's threshold control from `getPref("screeningThreshold")` on
   demand, keep the per-run adjustment in the run's options object (§8.5.2's "per-run choices"
   row), and treat `0` as "score everything, filter nothing".

**Do NOT.**
- Do **not** delete a retracted item. "Deleting the user's data is never this feature's job"
  (`docs/06` §13.3).
- Do **not** exclude an expression of concern — annotate it inline instead (`docs/06` §13.3).
- Do **not** let a retracted paper contribute a finding. "This is the one failure mode with real
  scientific consequences" (`docs/06` §13.3).
- Do **not** make `isRetracted` async or batch it — it is synchronous and free
  (`docs/06` §13.3).
- Do **not** use `Zotero.Duplicates`. It is whole-library scoped for the Duplicate Items view;
  this pipeline needs collection-scoped, preprint-aware matching with its own resolution policy
  (`docs/06` §13.4).
- Do **not** translate the paper and then summarize the translation. Summarize in the source
  language and emit English in one step — "far more accurate" (`docs/06` §13.2).
- Do **not** hard-filter relevance results without showing the count, and do **not** discard
  below-threshold items silently: "Recall failures are invisible otherwise" (`docs/12` §3).
- Do **not** drop `isPrimaryResearch: false` items; import and tag them (`docs/12` §3).
- Do **not** restate the threshold's default in code. `60` lives in `docs/07` §8.5's
  `screening.threshold` row and is read through the §8.5.1 accessor; `docs/12` §3 owns what the
  number *means*, §8.5 owns its shape.
- Do **not** put the threshold control in the prefs pane. §8.5: "**Not in the prefs pane**" — it
  is a per-run control in the Search & Import window (`docs/08` §4.2), and the per-run value
  belongs in the run's options object, not in a second pref (§8.5.2).
- Do **not** add a second screening pref, a per-source threshold, or a `screening.*` key that
  §8.5 does not list. §8.5 is the complete list of preferences.

**Done when.**
- [ ] A fixture item that `Zotero.Retractions.isRetracted` reports true is excluded from
      synthesis under the default policy, retained in the collection, and counted.
- [ ] An expression-of-concern fixture is **not** excluded and is annotated.
- [ ] A Korean-abstract fixture under `translate_summary` produces an English `PaperSummary`
      carrying `source_language: ko` and `confidence` no higher than `medium`.
- [ ] A preprint/published pair in one collection is detected, the published version kept, and
      `duplicate_of:` recorded.
- [ ] A `RELEVANCE_SCREEN` batch whose response drops one candidate triggers exactly one batch
      re-run and then per-item calls.
- [ ] The screening model resolver walks all three links.
- [ ] A repository grep test finds no reference to `Zotero.Duplicates`.
- [ ] `src/prefs/schema.ts` carries exactly one new row, `screening.threshold`, with
      `type: "integer"`, `default: 60`, `min: 0` and `max: 100`, and a grep finds no literal
      `60` threshold in `relevanceScreen.ts` or in the dialog code.
- [ ] The Search & Import window's threshold control opens at the pref's value, a per-run change
      does not write the pref, and the live count preview updates from the run's options object.
- [ ] With the threshold at `0`, every candidate is imported and every score is still recorded.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- "pipeline/(screen|relevanceScreen)"
```

**Notes — changed 2026-09-09; `screening.threshold` is a preference now.** This card previously
said "do not invent a `screening.threshold` preference — no such row exists in `docs/07` §8.5"
and kept the 60 default in the dialog's state, because when it was written §8.5 had no row for
it. The documentation pass added one: `screening.threshold`, `integer`, default `60`, range
0–100, with the row itself recording that the control lives in the Search & Import window and
**not** in the prefs pane, and that `0` disables filtering while still recording scores.
`docs/12` §3 names the same key and keeps ownership of the semantics — the two non-negotiable
rules (never hard-filter without showing the number, always offer "show excluded"). Nothing is
invented here any more: add the schema row, read it through §8.5.1's accessor, and keep the
per-run adjustment in the run's options object rather than writing the pref back.

`docs/06` §13.2 carries an **Unverified** marker on cross-lingual summary quality and
asks for a 20-paper multilingual fixture set before `translate_summary` is trusted as the
default. That measurement is not in this phase's scope; ship the default, record the marker in
the phase report, and raise a card for the fixture set alongside the Korean-report work in
Phase 4.

---

### P3-T28 — Item-pane AI summary section

| Field | Value |
|---|---|
| **ID** | `P3-T28` |
| **State** | `TODO` |
| **Depends on** | `P3-T25` |
| **Blocks** | `P3-T31` |
| **Retires** | none |
| **Implements** | part of `FR-19`, part of `FR-20`, part of `FR-33` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Selecting an item shows its summary if one exists, an honest empty state if not, and a
Generate button that costs nothing until pressed.

**Read first.**
- `docs/08-ui-ux-spec.md` §3.1 — the `registerSection` option schema, the required `header.icon`
  and `sidenav.icon`, the per-hook props table, and the critical note that **`refresh` is
  available only in `onInit`**
- `docs/08-ui-ux-spec.md` §3.2 — the behaviour table for all seven situations, the collapsed
  header line being the **derived** gist, and the rule that the summary is not written as a note
  unless the user asks
- `docs/08-ui-ux-spec.md` §3.3 — the registration code and the `bodyXHTML` parsing caveats (XUL
  is the default namespace, `<script>` will not run)
- `docs/07-architecture-and-data-model.md` §5.2 — `deriveTldr()`: pure, recomputed on every
  render, never persisted, never sent to a model, and never presented as something the model said
- `docs/07-architecture-and-data-model.md` §8.5 "Summarization" — `autoSummarize` ships **off**,
  with the reason: `onAsyncRender` fires on every selection change
- `docs/09-security-privacy-and-api-keys.md` §1.9 rule 5 — the per-provider status row this
  section's no-key state links to

**Files.**
- create `src/ui/panes/summarySection.ts`
- modify `src/bootstrap/registerUI.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/integration/zotero/summarySection.spec.ts`

**Do.**
1. Register the section with `Zotero.ItemPaneManager.registerSection`, supplying both required
   icons and a `paneID` that does not collide with the built-ins listed in `docs/08` §3.1.
2. Capture `refresh` in `onInit` into module state so section buttons can re-render.
3. Return `false` from `onItemChange` for non-regular items so the section hides.
4. Keep `onRender` synchronous and cheap: create the box and set the height; do I/O in
   `onAsyncRender`.
5. Render the seven states from `docs/08` §3.2, using `deriveTldr(stored.content)` truncated to
   ~60 characters for the collapsed header.
6. Show the no-key state with a link to Preferences and a disabled Generate button.
7. Register a `Zotero.Notifier` observer for item `delete`/`trash` that calls
   `cache.invalidateByTag('work:<key>')`, and unregister it in `onDestroy`.
8. Implement "Save as child note" as an explicit user action only.

**Do NOT.**
- Do **not** destructure `refresh` from `sectionButtons[].onClick` props — it is not there
  (`docs/08` §3.1).
- Do **not** do I/O in `onRender`; it runs on every selection change (`docs/08` §3.1).
- Do **not** ship `autoSummarize` on. "An unconditional LLM call here burns credits"; debounce
  300–500 ms even when the user turns it on (`docs/07` §8.5).
- Do **not** persist `deriveTldr()`'s output or present it as model output (`docs/07` §5.2).
- Do **not** write a note automatically. "Save as child note" is an explicit user action
  (`docs/08` §3.2).
- Do **not** expect `<script>` inside `bodyXHTML` to run, and remember HTML elements need the
  `html:` prefix (`docs/08` §3.3).
- Do **not** rely on `item` being present in `onDestroy` props — it is basic-props only
  (`docs/08` §3.1).
- Do **not** cache the summary anywhere but the `summary` table (`docs/08` §3.2 defers to
  `docs/07` §8.3).

**Done when.**
- [ ] Selecting a note, an attachment or an annotation hides the section.
- [ ] An item with a stored summary renders its fields, model name and timestamp, with the
      collapsed header showing the derived gist.
- [ ] An item with no summary shows the empty state and a Generate button.
- [ ] With no key configured, Generate is disabled and the Preferences link is present, and zero
      HTTP requests are made.
- [ ] Rapidly changing selection across 20 items issues zero LLM calls with `autoSummarize` off.
- [ ] Disable/enable cycling the plugin five times leaves no residual notifier observer.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --grep summarySection
```

**Notes.** The section renders in both the library item pane and the reader context pane, which
share the `item-details` element; use `tabType` to distinguish them if the layouts need to differ
(`docs/08` §3.1).

---

### P3-T29 — Summarize-collection pipeline, notes, remove-notes command

| Field | Value |
|---|---|
| **ID** | `P3-T29` |
| **State** | `TODO` |
| **Depends on** | `P3-T16`, `P3-T17`, `P3-T25`, `P3-T27` |
| **Blocks** | `P3-T31` |
| **Retires** | part of `R-6` |
| **Implements** | `FR-19`, `FR-20`, `FR-23`, `FR-53` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** "Summarize collection…" runs end to end with a pre-flight gate, per-item progress,
cancellation and resume — and everything it writes is labelled and removable in one command.

**Read first.**
- `docs/07-architecture-and-data-model.md` §12.3 — the summarize state machine, every state and
  transition this pipeline must implement, including `CacheProbe → Estimating → AwaitingConfirm`
  and `Interrupted → Summarizing`
- `docs/08-ui-ux-spec.md` §6.1 and §6.4 — the four-stage pipeline and the progress wireframe:
  per-item rows with cached/new counts and skip reasons
- `docs/10-requirements-and-user-stories.md` FR-20 — the tag namespace
  `research_helper/ai-summary`, the provider/model tag, the disclaimer first line with provider,
  model ID and UTC timestamp, and the removal command's confirmation naming the exact count
- `docs/10-requirements-and-user-stories.md` FR-21 — the exact provenance header strings
  (`Source: abstract only` / `Source: full text (<N> chars extracted from <attachment name>)`)
  and the skipped-no-text bucket
- `docs/06-summarization-and-trend-report.md` §14.2 — the verified note-writing pattern:
  `libraryID` set **before** parent or collection, `setNote()`, `notifierData.autoSyncDelay`,
  and the read-only-library check
- `docs/07-architecture-and-data-model.md` §8.5 "Report & audio" — `report.perPaperNotes` ships
  off, which is what makes per-paper notes opt-in
- `docs/08-ui-ux-spec.md` §8.2.1 — the decision *not* to build per-item batch progress on
  `Zotero.ProgressQueue`, and what to use instead
- `docs/07-architecture-and-data-model.md` §7.4 — the summarize cancellation semantics:
  completed summaries are kept, nothing is rolled back

**Files.**
- create `src/pipeline/summarize/summarizePipeline.ts`
- modify `src/zotero/notes.ts` (created by `P1-T17` for the provenance note; this card adds the
  summary-note writer and the removal command)
- create `src/ui/menus/collectionMenu.ts`
- create `src/ui/dialogs/summarizeDialog.ts`
- modify `src/bootstrap/registerPipelines.ts`
- modify `src/bootstrap/registerUI.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `test/unit/pipeline/summarizePipeline.spec.ts`
- create `test/integration/zotero/removeGeneratedNotes.spec.ts`

**Do.**
1. Implement the pipeline stages: collect regular items, probe the cache, plan the input scope
   per item under the privacy policy, estimate, confirm, summarize under the `llm` pool, then
   write notes.
2. Skip items that already have a `research_helper` summary by default, with a
   "Re-summarize existing" option (FR-19).
3. Report per-item progress through the dialog's own in-window status list — `docs/08` §6.4's
   per-item rows, with cached/new counts, per-item skip reasons and a Cancel button. **Not
   `Zotero.ProgressQueue`**: `docs/08` §8.2.1 and `docs/01` §10.4 both decide against it, and
   `docs/07` §7.7 defers to them.
4. Implement per-paper note writing behind `report.perPaperNotes`, with the FR-20 disclaimer
   first line, the `research_helper/ai-summary` tag plus a provider/model tag, and the FR-21
   provenance header.
5. Implement "Remove generated notes from collection": select only notes carrying the
   `research_helper/` tag namespace, confirm with the exact count, then delete.
6. Report end-of-job counts: full text used, fell back to abstract, skipped no text, skipped
   retracted, skipped duplicate (R-19's reporting requirement).
7. Detect `library.editable` before offering to save, and fall back to export when it is false.
8. Wire the collection context menu entry.

**Do NOT.**
- Do **not** write a note for an item that produced no summary, and do **not** fabricate a
  summary from a title (FR-21, `docs/06` §3.5).
- Do **not** delete notes that lack the `research_helper/` tag namespace. The removal command
  touches only what the plugin created (FR-20).
- Do **not** delete generated notes as part of a cache clear. "Clear generated summaries" must
  state in its confirmation that it does **not** delete the Zotero notes (`docs/09` §3.7,
  `docs/08` §7.3).
- Do **not** roll back completed summaries on cancel (`docs/07` §7.4).
- Do **not** write per-paper notes by default. `report.perPaperNotes` ships off, because 200
  papers means 200 notes the user did not ask for (`docs/06` §11.3 option A).
- Do **not** set `parentKey` before `libraryID` on a new note (`docs/06` §14.2).
- Do **not** emit one error row per item on a provider outage. Detect the pattern above 30 %
  failures and stop with one clear message (`docs/06` §13.5).
- Do **not** run the job from a modal dialog (R-10, `docs/07` §7.1).
- Do **not** mutate user-authored data anywhere in this pipeline (NFR-20).

**Done when.**
- [ ] A 200-item scripted run completes, writes notes only for items that produced summaries,
      and reports the five end-of-job counts.
- [ ] Every written note carries the `research_helper/ai-summary` tag, a provider/model tag, the
      disclaimer first line with provider, model ID and UTC timestamp, and the FR-21 provenance
      line matching the tier actually used.
- [ ] "Remove generated notes from collection" over a collection containing one user-authored
      note and 40 generated notes confirms "40" and deletes exactly those 40.
- [ ] Cancelling at item 87 of 200 retains 86 notes, writes none for 87, and reports
      "cancelled at 87/200".
- [ ] Re-running the cancelled job skips the 86 and issues 114 calls.
- [ ] A read-only group library offers export instead of note saving.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- summarizePipeline && npm run test:integration -- --grep removeGeneratedNotes
```

**Notes.** FR-19's acceptance text says a child note is attached to each item; `docs/10` open
question resolution and `docs/06` §11.3 D-06-8 supersede that for the *machine-readable* record,
which is a `StoredSummary` row. The note is the opt-in human-readable artifact. Where the two
readings conflict, the resolution recorded in `docs/10` §3 ("the question conflated two
artifacts, and both now have owners") governs.

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
| **Human gate** | none |

**Goal.** Every adapter's request shape and response parsing is asserted against committed,
redacted fixtures, and the whole suite runs offline at zero cost.

**Read first.**
- `docs/13-testing-build-and-release.md` §3.1 "LLM providers" — the ten required fixtures per
  provider: `chat-nonstream-ok`, `chat-stream-ok`, `chat-json-ok`, `chat-json-malformed`,
  `error-401`, `error-429` (with and without `Retry-After`), `error-context-length`,
  `error-truncated`, `refusal`, `models-list`
- `docs/13-testing-build-and-release.md` §2.2 — the record/replay transport, the `fixtureKey`
  hashing, the missing-fixture failure message, and the split between wire-shape snapshot tests
  and response-parsing tests
- `docs/13-testing-build-and-release.md` §3.2 — the mandatory redaction pass, the sidecar
  `_meta.json`, and the rule that **for LLM fixtures only response bodies are recorded** while
  request bodies are asserted against adapter-generated snapshots
- `docs/13-testing-build-and-release.md` §3.3 — staleness handling: the 180-day warning, the
  365-day failure, and the rule that LLM fixtures are re-recorded on API-version change rather
  than on a schedule
- `docs/13-testing-build-and-release.md` §4 — the mocking matrix and the invariant that no test
  at any layer performs a live network call
- `docs/09-security-privacy-and-api-keys.md` §2.1 — the redaction patterns the recorder reuses

**Files.**
- modify `test/contract/_transport.ts` (created by `P1-T11`; add the LLM fixture key shape)
- create `test/contract/llm/*.spec.ts`
- modify `scripts/record-fixtures.ts` (created by `P1-T11`; add the LLM scenario list)
- create `test/fixtures/llm/openrouter/`
- create `test/fixtures/llm/openai/`
- create `test/fixtures/llm/anthropic/`
- create `test/fixtures/llm/gemini/`
- modify `.github/workflows/ci.yml`

**Do.**
1. Implement the replay transport with `fixtureKey()` and the missing-fixture error that prints
   the exact record command.
2. Extend `scripts/record-fixtures.ts` with a versioned scenario list producing the ten
   fixtures per provider, reading keys from `.env`.
3. Apply the mandatory redaction pass before writing, and **abort the recorder** if any output
   still matches a key pattern.
4. Write a `_meta.json` sidecar per fixture with the recorded-at timestamp, endpoint, tool
   version and scenario name.
5. Write wire-shape snapshot tests: for a fixed prompt and options, assert each adapter's exact
   request body against a committed snapshot.
6. Write response-parsing tests over the recorded bodies, asserting normalized text, usage and
   stop reason, and the typed error for each error fixture.
7. Add the staleness assertion: warn above 180 days, fail above 365.
8. Wire the contract suite into CI with the replay transport as the only transport.

**Do NOT.**
- Do **not** let a missing fixture fall through to a live network call. It is "a **test failure**
  with the exact command to record it, never a silent network call" (`docs/13` §2.2).
- Do **not** commit an unredacted fixture. The recorder aborts rather than writing one
  (`docs/13` §3.2).
- Do **not** record LLM **request** bodies as fixtures. Request bodies are adapter-generated
  snapshots, so a prompt change shows up as a reviewable diff (`docs/13` §3.2).
- Do **not** hand-edit a fixture to make a test pass. Re-record, or add a scenario
  (`docs/13` §3.3 rule 4).
- Do **not** assert generated-text quality here. Prompt quality is a curated evaluation set run
  manually or nightly, "never as a blocking CI gate, because it costs money and is inherently
  fuzzy" (`docs/13` §2.2).
- Do **not** put a real API key in `.env.example`, in CI secrets used by the blocking suite, or
  anywhere a test can reach it.

**Done when.**
- [ ] Forty LLM fixtures exist (ten scenarios x four providers), each with a `_meta.json`.
- [ ] Running the recorder over a response containing a synthetic key aborts with a non-zero
      exit and writes nothing.
- [ ] Deleting one fixture makes the suite fail with a message naming the record command, and
      the network is never touched.
- [ ] Each adapter has a committed request-body snapshot, and changing a prompt produces a
      snapshot diff rather than a silent pass.
- [ ] The full contract suite runs with the network disabled.
- [ ] A fixture with a `recordedAt` older than 365 days fails the suite, asserted with a
      synthetic sidecar.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:contract
```

**Notes.** The `error-429` scenario must be recorded **twice** — with and without `Retry-After`
— because `P3-T05`'s policy branches on exactly that. The `refusal` and `error-truncated`
scenarios are the two that `docs/03` §14.5 short-circuits before any repair attempt, so they
belong to `P3-T12`'s assertions as much as to this card's.

---

### P3-T31 — Phase-3 acceptance run against the definition of done

| Field | Value |
|---|---|
| **ID** | `P3-T31` |
| **State** | `TODO` |
| **Depends on** | `P3-T14`, `P3-T22`, `P3-T28`, `P3-T29`, `P3-T30` |
| **Blocks** | none |
| **Retires** | closes `R-4`, `R-5`, `R-9`, `R-19`, `R-19b`; part of `R-6` |
| **Implements** | `NFR-4`, `NFR-5`, `NFR-16`, `FR-23`, `FR-24` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — this run spends real money on four providers. Expected spend: under **$2** total (a 100-abstract job on the cheapest capable model per provider, plus one 3-item full-text job). The agent prepares the run, states the estimate from `P3-T16`'s dialog, and stops for approval before dispatching. |

**Goal.** Every line of the phase definition of done is demonstrated on a real Zotero profile
with real keys, and the result is recorded.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 3 "Definition of done" — the five criteria this
  card exists to demonstrate, verbatim
- `docs/10-requirements-and-user-stories.md` NFR-4 — the summarization throughput budget the
  100-abstract run is measured against
- `docs/10-requirements-and-user-stories.md` NFR-16 — the security-of-secrets criterion behind
  "no key appears in the debug log, in a note, or in copied diagnostics"
- `docs/13-testing-build-and-release.md` §8.4 "LLM layer" — the manual QA checklist items for
  this layer, which this card runs as a whole
- `docs/07-architecture-and-data-model.md` §10.4 — the debug bundle, so the no-key-in-diagnostics
  check inspects the real artifact rather than a proxy
- `docs/09-security-privacy-and-api-keys.md` §7 "Implementer's security checklist" — the
  credential-storage, key-hygiene and data-egress sections, run as a checklist here

**Files.**
- create `docs/spikes/phase-3-acceptance-report.md`
- create `test/integration/pipeline/phase3Acceptance.spec.ts`
- modify `plan/00-task-index.md`

**Do.**
1. Configure all four providers with real keys and confirm each with Test.
2. Run the same single item through all four providers and diff the internal call path, showing
   that only the adapter differs.
3. Run a 100-abstract summarize job; record wall-clock time against NFR-4 and the reported
   actual token usage against the pre-run estimate.
4. Set `run.maxSpendUSD` to `0.01` and confirm the job pauses on the first item and asks.
5. Run a 200-item job with the mock provider, cancel at item 87, confirm 86 notes are retained
   and that re-running resumes correctly.
6. Generate a debug bundle, copy diagnostics, and grep the debug log, the bundle and every
   written note for each configured key's first eight characters.
7. Confirm the IMRaD gate: either the measured accuracy is at or above 85 % and `sectionAware`
   is on, or the degrade is active and no prompt claims section provenance.
8. Run the `docs/09` §7 checklist for credential storage, key hygiene and data egress.
9. Record every figure, the spend, and any deviation in
   `docs/spikes/phase-3-acceptance-report.md`, and update the state column in
   `plan/00-task-index.md`.

**Do NOT.**
- Do **not** dispatch a paid run without the human approving the estimate first.
- Do **not** paste a key, or any prefix of one longer than four characters, into the acceptance
  report, a commit message or a test fixture.
- Do **not** relax a criterion to make it pass. "If it fails, report the failure — do not adjust
  the criterion to match the code" (README §5 rule 6).
- Do **not** mark the phase done while the IMRaD gate is unresolved. Degraded is an acceptable
  exit; unmeasured is not.
- Do **not** run the 100-abstract job on a frontier model. `docs/03` §16 names the cheap
  per-paper defaults; this is a throughput and plumbing test, not a quality test.
- Do **not** count a mock-provider run as satisfying the "all four providers" criterion.

**Done when.**
- [ ] The same item summarized by all four providers yields four `StoredSummary` rows differing
      only in `providerId`, `modelId` and `usage`.
- [ ] The 100-abstract job's wall-clock time is recorded and compared against NFR-4, with the
      actual token usage reported.
- [ ] With `run.maxSpendUSD = 0.01` the job pauses on the first item with a confirmation prompt.
- [ ] Cancel at 87/200 retains 86 notes; the re-run dispatches 114 items.
- [ ] A grep of the debug log, the debug bundle and all written notes for each key's first eight
      characters returns nothing.
- [ ] The IMRaD outcome is recorded with its measured number and the resulting configuration.
- [ ] `docs/spikes/phase-3-acceptance-report.md` exists with every figure and the total spend.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract` all exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract && npm run build
```
Then, manually: execute steps 1–9 above on a real Zotero 10 profile and file the report. Stop
before step 3 and report the estimate for approval.

**Notes.** This card is where the phase is declared done or not, and only the human changes a
task's state to `DONE` (README §4 field rules). The spend figure recorded here is also the first
real-world calibration point for `P3-T13`'s rolling correction factor and for `docs/03` §12.1's
price table.

---

## 3. Estimate reconciliation

| | Developer-days |
|---|---|
| Sum of the 31 task cards | **23.5** |
| `docs/11` §1 Phase 3 figure (2026-09-09, *measured*) | **23.5–33** |
| Divergence | **none — the roadmap figure is derived from this sum** |

**Resolved 2026-09-09.** This section previously recorded a +47 % divergence against `docs/11`'s
old **12–15 d** guess and recommended that the roadmap be re-estimated. It has been: `docs/11`
§1 Phase 3 now reads "**23.5–33 developer-days** — *measured*: the 31 task cards in
`plan/04-phase-3-llm-summaries.md` sum to 23.5 d; the upper bound is that × 1.4. (Was 12–15 d.)",
and `docs/11` §2 and its effort summary were re-derived from it. `README.md` §7's rule — a
divergence beyond ~30 % "is a signal to re-estimate the phase in `docs/11`, not to quietly
adjust the tasks" — was followed, and the cards were not touched.

**Two cards re-estimated 2026-09-09, and the sum moved 22.0 → 23.5 with them.** The first pass
above raised the roadmap and left every card alone. That left two cards which this file itself
recorded as knowingly optimistic, and two independent review rounds flagged both. The owner
decided on 2026-09-09 to re-estimate them and propagate, on the ground that leaving a card
priced below its own `Do` steps contradicts the very decision the first pass made — and R-23,
which is about estimates being systematically low. The change is:

| Card | Was | Now | Why |
|---|---|---|---|
| `P3-T04` | 1.0 d | **1.75 d** | Scope grew to four `<provider>.baseUrl` controls with write-time validation, the NCBI and Semantic Scholar key fields, and six `role="status"` elements, with no estimate movement. §4 item 9 recorded the gap; the card's `Notes` now carry the bottom-up and top-down derivations, which land 0.10 d apart. |
| `P3-T20` | 1.0 d | **1.75 d** | Derived from the card's own steps: the 40-PDF build script across eight publisher families (0.75 d), the composition spec (0.25 d), the labels format and ingest path (0.25 d), the manifest and README (0.25 d) and the manifest validator test (0.25 d). The human's adjudication is gate **G-12** and is *not* in this figure. |

**No other card's estimate was changed**, so 22.0 + 0.75 + 0.75 = **23.5 d**, `docs/11` §1's
Phase 3 band becomes 23.5 – (23.5 × 1.4 = 32.9 → 33), the Phases 0–3 subtotal becomes
15.50 + 18.75 + 24.25 + 23.50 = **82.00 d**, and `plan/00-task-index.md` §1 and §4, `docs/11`
§1's effort summary and §2's dependency graph were re-derived from those figures in the same
pass.

**`P3-T20` and the developer/human split.** `plan/README.md` §7 and `docs/11`'s preamble both
count **developer**-days. `P3-T20`'s elapsed span is dominated by gate **G-12** in
`plan/06-human-gates.md` — the human sources 40 PDFs from their own subscribed access and
adjudicates the ground-truth section offsets for all 40, which `plan/06` rates as "days of the
human's own time" and schedules into Phase 0 for that reason (order of magnitude: 40 fixtures
× 10–15 min ≈ 7–10 h of adjudication, plus sourcing, so ≈ 2–3 human-days). None of that is in
the 1.75 d. Only the developer's own work is, which is what keeps the card comparable with
every other card in this file and what makes the phase sum a developer-day sum.

The consequence for this file is a constraint, not a finding: **the card estimates and the
roadmap figure are now the same number.** Changing any card's estimate here silently
invalidates `docs/11` §1 Phase 3, §2's critical path and `plan/00-task-index.md` §1's table.
Re-estimate a card only together with those.

Where the time went relative to the old 12–15 d figure, and why none of it was padding:

- **The IMRaD work is 2.75 d that the roadmap figure predates.** R-19b was created on 2026-09-08
  by the decision to ship `fullTextMode: auto`; `docs/11`'s 12–15 was written before the fixture
  set and its accuracy harness existed as a requirement. `P3-T20` alone is 1.75 d and produces no
  shipped code. (Was 2.0 d and 1.0 d before the 2026-09-09 re-estimate of `P3-T20` recorded
  above.)
- **Secret storage is 3.75 d across four cards** (`P3-T01`–`P3-T04`). `docs/11` folds this into
  "preferences pane: keys…", one line of one deliverable. The tier ladder, the redaction
  pipeline, the no-plaintext proof and the pane's ten UX rules are each real work, and D5 makes
  none of them optional.
- **Text acquisition is 1.5 d** (`P3-T18`, `P3-T19`) and is barely visible in the roadmap's
  deliverable list, which mentions only "input assembly" and "the R-19 extraction quality gate".
  The four-tier ladder, the eight-step cleaning pass and the JATS element table are `docs/06`
  §3–§4 in full.
- **The four adapters come in at 2.75 d**, close to the roadmap's implied budget. The adapters
  are not where the overrun is.

Two smaller notes on the sum. First, the estimates exclude review latency and time waiting for
provider key approvals, per README §7. Second, `P3-T20`'s 1.75 d assumes the owner can supply 40
suitable PDFs from an existing library; sourcing them from scratch would add at least half a day
and is not costed here.

---

## 4. Open items this file could not resolve

These are gaps in the source documents, not in the decomposition. Each is called out in the
relevant card's `Notes` and none may be closed by inventing a value (README §5 rule 2).

**Numbering is permanent.** Items 1, 2, 3 and 7 were closed by the 2026-09-09 documentation
pass, items 8 and 10 by its second round, and item 9 by the 2026-09-09 estimate re-derivation;
all seven are kept in place, struck through, so that a reader coming from an older revision of a
card finds the resolution rather than a hole. **Items 4, 5 and 6 are still open**, and all three
are gaps in the source documents — the one estimate question, item 9, is now settled.

1. ~~**No `<provider>.baseUrl` preference exists.**~~ **Closed 2026-09-09.** `docs/07` §8.5 now
   carries all four rows — `openrouter.baseUrl`, `openai.baseUrl`, `gemini.baseUrl`,
   `anthropic.baseUrl`, `string`, default `""`, "an absolute `https://` URL with no trailing
   slash, or empty" — `docs/08` §7.3 ships the `rh-or-base-url` markup, `docs/03` §14.4 owns
   resolution and the two rules on an overridden value, and `docs/11` Phase 3 names the key in
   its deliverable. `P3-T04` ships the control and its write-time validation; `P3-T06` owns
   `resolveBaseUrl()`; `P3-T15` makes the egress dialog name the effective host.
2. ~~**No consent preference exists.**~~ **Closed 2026-09-09.** §8.5 carries
   `privacy.egressAcknowledged` (⚠, `boolean`, default `false`, "Not in the pane"), and
   `docs/09` §3.6's opening paragraph gives the write-once / read-only-to-decide semantics.
   `P3-T15` adds the schema row; nothing goes in the plugin database, and the flag suppresses
   nothing.
3. ~~**No `screening.threshold` preference exists.**~~ **Closed 2026-09-09.** §8.5 carries
   `screening.threshold` (`integer`, default `60`, 0–100, Search & Import window per run, not
   the prefs pane, `0` = record scores but filter nothing) and `docs/12` §3 names the same key.
   `P3-T27` adds the schema row and seeds the control from it.
4. **Gemini billing-tier detection may have no programmatic signal.** `docs/09` §3.4 rule 4 is
   marked **Unverified**. `P3-T10` returns `"free-or-unknown"` and `P3-T15` asks the user, with
   the answer defaulted to free/unsure — which is the behaviour that document prescribes for
   exactly this case.
5. **Publisher-PDF licensing for the IMRaD corpus is an owner decision.** `docs/09` §4.4
   governs redistribution of publisher content and `P3-T20` cannot proceed past the corpus
   assembly without an answer.
6. **Cross-lingual summary quality is unmeasured.** `docs/06` §13.2's **Unverified** marker asks
   for a 20-paper multilingual fixture set before `translate_summary` is trusted as the default.
   Not decomposed here; it belongs with the Korean report work in Phase 4.
7. ~~**The rolling token-estimator correction factor has no home in the pref schema.**~~
   **Closed 2026-09-09.** §8.5 carries `llm.tokenEstimateCalibration` (⚠, `string` holding JSON,
   default `"{}"`, model ID → correction factor, written at most once per job), and `docs/03`
   §10.2 "Correcting the drift" names the same key. `P3-T13` adds the schema row and reads and
   writes it through §8.5.1's typed accessor; nothing goes in the plugin database.

**Three further items were opened by the same pass; the documentation round of 2026-09-09
closed the two that were gaps in the source documents (8 and 10), and the estimate re-derivation
later the same day closed the remaining one (9). All three are now settled.**

8. ~~**`docs/07` §4.3's `countTokens` has no `exact` flag, and `docs/03` says it should.** §4.3
   declares `countTokens(text, modelId): number` — synchronous, so it cannot call Anthropic's
   free `POST /v1/messages/count_tokens`; `docs/03` §10.2's design recommendation and §14.1's
   sketch both give it `{ tokens, exact }` and make it a promise.~~ **Closed 2026-09-09.**
   `docs/03` §10.2 gained its own authority note — "**do not implement the signature below**" —
   naming `docs/07` §4.3's synchronous `countTokens(text: string, modelId: string): number` as
   the shipped contract, marking the `{ tokens, exact }` shape a "working design from before
   that consolidation", and translating the policy onto the shipped signature: because the
   return value carries no `exact` flag, **every `countTokens()` result must be treated as
   inexact at the call site**. The §10.2 policy — never gate a hard behaviour on the count, use
   it only for chunk sizing and cost display, label displayed costs as estimates — still holds
   in full, and Anthropic's exact endpoint stays an adapter-private helper rather than an
   interface member. `P3-T06`, `P3-T08`, `P3-T09` and `P3-T13` already implement exactly that;
   no card may widen `LLMProvider` locally.
9. ~~**`P3-T04`'s scope grew without its estimate moving.** The card now also ships the four
   base-URL controls and the NCBI and Semantic Scholar key fields that `docs/11` Phase 3's
   "every key-entry surface" deliverable requires, and it is still costed at 1.0 d. The estimate
   was left alone deliberately: §3 records that the card sum *is* `docs/11`'s Phase 3 figure now,
   so raising it here silently invalidates `docs/11` §1, §2 and `plan/00-task-index.md`. The
   owner re-estimates all four together or accepts the 1.0 d as optimistic.~~ **Closed
   2026-09-09 — the owner took the first branch and re-estimated all four together.** `P3-T04`
   is now **1.75 d**, with the derivation in its own `Notes` rather than asserted; `P3-T20` was
   re-estimated in the same pass, for the same reason, from 1.0 d to **1.75 d**; the phase sum
   is **23.5 d**; and `docs/11` §1's Phase 3 band and effort summary, §2's dependency graph and
   critical path, and `plan/00-task-index.md` §1 and §4 were all re-derived in that pass. §3
   carries the change table. The alternative — accepting a card knowingly priced below its own
   `Do` steps — was rejected because it contradicts both the 2026-09-09 roadmap correction,
   which raised `docs/11`'s figures rather than shaving cards, and R-23, which is the record
   that this plan's estimates run systematically low.
10. ~~**No `<provider>.lastValidationResult` preference exists.** `docs/09` §2.4 step 3 requires
    that a rejected key be marked in prefs under that key, and `docs/07` §8.3's placement table
    names the group "Key presence flags & last-validation result" — but §8.5's table declares
    only `<provider>.keyPresent`, `<provider>.lastValidatedAt` and `secretBackend`.~~
    **Closed 2026-09-09 — the owner added the row.** `docs/07` §8.5 now declares
    `<provider>.lastValidationResult`, `string`, default `""`, values
    `ok | rejected | forbidden | inconclusive | ""` (never validated), semantics owned by
    `docs/09` §2.4, and scopes it to **the same six credential-holding IDs as `keyPresent` and
    `lastValidatedAt`** — `openrouter`, `openai`, `gemini`, `anthropic`, `ncbi`,
    `semanticscholar` — because a wrong NCBI or Semantic Scholar key fails *silently* rather
    than erroring. `docs/01` §7.2 ships the six matching `pref()` lines. It is a status, not an
    input, so `docs/08` §7.3 gives it no `preference=` binding: the per-credential `role="status"`
    element beside each key field is driven imperatively. `P3-T14` now **persists** the outcome
    and the pane's red state survives a restart.

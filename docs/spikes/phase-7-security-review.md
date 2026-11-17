# Phase 7 security review: `docs/09` §7, line by line

**Card:** `plan/10` `P7-T16`. **Date:** 2026-11-17. **Tree:** `main` at `a4fb6b3` plus the uncommitted
batch C working tree (`plan/reports/P7-batchC.md`). **Zotero:** 10.0.3 (`application.ini`
BuildID 20260917164924), Windows 11.

**How each line was checked.** Every line of `docs/09-security-privacy-and-api-keys.md` §7 has one row
below. The evidence is a named test (file and title), a lint rule or CI step, a grep (pattern and
directories), a measured report, or a declaration by name. A code comment alone is not evidence.
The first pass over the tree was made by a read-only research agent. The agent building this card
re-checked the load-bearing rows (the tags and collection name, the first-run notice, the
attribution, the `onError` reporter, the `autoSummarize` and `update_hash` tests), ran the audits,
the XPI grep and the Zotero source read below, and wrote the verdicts. No network call, keyed call or paid call was made, except
`npm audit` against the registry, which sends the lockfile's package names and versions.

**Verdicts:** *met*; *met, gap noted* (the line holds, and a weaker point is named); *partly met*;
*not met*; *release-time* (only the release itself can show it; the card that does is named).

**Totals (counted from the tables by script):** 56 lines. **The 9 `[BLOCKER]` lines:** 4 met; 2 met
with a gap noted (the plugin database, the debug output); 3 met in source, in the workflow or on the
working-tree build, and shown finally only at release time (`update_url` served, `update_hash` on the
served file, the tag's XPI). **All 56:** 35 met, 3 met with a gap noted, 12 partly met, 1 not met,
5 release-time. The not-met and partly-met lines are findings; none is a `[BLOCKER]`, so none stops
the release under §7's own rule, and under `plan/README.md` rule 9 none becomes a card by itself.
The ones that need an owner's decision are `plan/00` §6 item 395.

## Measured for this review

**1. The built XPI holds no key-shaped string.** `npm run build` on the working tree wrote
`.scaffold/build/research-helper.xpi` (729 231 bytes; SHA-256 begins `396f9bef8fd51c9c`). Unpacked
into the scratch folder, all 25 files were searched by a script for: `sk-or-v1-…`, `sk-…`/`sk-proj-…`,
`sk-ant-…`, `AIza` + 35, a 36-character hexadecimal run (NCBI's shape), a 40-character alphanumeric run
(Semantic Scholar's), GitHub tokens (`gh[pousr]_…`), a `BEGIN … PRIVATE KEY` block, a `Bearer` literal
of 20+ characters and a JWT. **0 hits.** Positive control: a file with a planted `sk-or-v1-` and an
`AIza` value was found by the same script (3 hits). The maintainer address of decision D10 is in the
XPI by design (`docs/09` §8 item 5). This is a working-tree build, not the CI build of a tag; the
release's own XPI is `P7-T26`'s.

**2. Dependency audit.** `npm audit --omit=dev`: **found 0 vulnerabilities** (exit 0). The full
`npm audit`: **17 vulnerabilities (13 moderate, 4 high), 0 critical**, every one in a development or
build dependency (the lockfile counts 2 production and 305 development packages). The four high ones:

| Package | Pulled in by | Advisories (titles, shortened) | Used for |
|---|---|---|---|
| `adm-zip` ≤ 0.6.0 | `zotero-plugin-scaffold@0.9.2` | extraction follows symlinks; decompression-bomb and size-guard bypasses; SUID bits kept; duplicate entry names | packing the XPI at build time |
| `brace-expansion` 4.0.0–5.0.11 | `eslint@10.10.0` → `minimatch@10.2.6` | (high; see `npm audit`) | lint |
| `source-map-js` 1.0.0–1.2.1 | `@vitest/coverage-v8` → `magicast`; `vite` → `postcss` | event-loop denial of service through section offsets | unit tests, coverage |
| `vite` 8.2.0–8.2.2 | `vitest@5.0.0` | `launch-editor` escaping on Windows; cross-origin script through custom middleware; `server.fs` bypasses | unit tests |

`npm audit` says a fix is available through `npm audit fix` for all 17. **Not applied**: it rewrites the
lockfile and moves the build tool, outside this card's files; `plan/00` §6 item 395(g) asks the owner.
The release gate is unaffected: §6.3 and the CI step "Audit runtime dependencies (P7-T21)" gate the
runtime tree, which is clean. Full outputs: the scratch files `audit-omitdev.txt`, `audit-full.txt`
and `audit-full.json` of this session, summarised here.

**3. Zotero's own HTTP debug lines (read from Zotero 10.0.3's shipped source).** `Zotero.HTTP.request`
in `chrome/content/zotero/xpcom/http.js` (extracted from `app/omni.ja`) logs every request as
`HTTP <method> <dispURL>`, where `dispURL` is the URL after `dispURL.replace(/key=[^&]+&?/, "")`, so the
first `key=` parameter's value is dropped; NCBI's `api_key=…` matches. It logs a string body's first
`logBodyLength` characters (default 1024); the plugin passes `logBodyLength: 0` on every
request (the HTTP client's fixed options, `src/core/http/client.ts`, handed to
`createZoteroHttpTransport` in `src/zotero/zoteroApi.ts`; pinned in
`test/unit/core/http-client.test.ts`). It never logs request headers, where every LLM and TTS key and
the Semantic Scholar key travel. So the NCBI key does not reach Zotero's own debug lines in the
release as built — **read from the source, not measured at run time**; the release checklist should
carry one run with Zotero's Debug Output Logging on and an NCBI key set (`plan/00` §6 item 395(e)).

## The checklist

### Credential storage

| §7 line | Evidence | Verdict |
|---|---|---|
| **[BLOCKER]** No code path writes an API key to `Zotero.Prefs`; a unit test asserts every `secret: true` entry has no writer | `test/unit/prefs/schema.test.ts`, describe "D5: no credential can reach a preference": "has no secret: true entry, because every PREFS entry is a writer", "refuses to write a secret definition", "declares no credential-shaped key", "declares no credential-shaped key in addon/prefs.js either". `test/unit/zotero/sessionStore.test.ts`: "keychain.ts is the only src/zotero/ module that handles a SecretId, and its exports are all classified". `test/unit/ui/preferencesPane.test.ts`: "rule 9 in the script: no Zotero.Prefs write and no network call". `test/integration/zotero/keychain.spec.ts`: "round-trips the NCBI key, sets ncbi.keyPresent, and leaves no preference holding it". Grep for preference writers over `src` and `addon`: the only writers are `setPref` and `clearPref` in `src/zotero/prefStore.ts`. | met (stronger than worded: no `secret: true` entry exists at all) |
| **[BLOCKER]** No API key is written to the plugin SQLite database | Keys live in Zotero's login manager only (`setSecret`, `src/zotero/keychain.ts`). Every persisted record passes `redactRecord` (`src/core/provenance.ts`): `test/unit/core/jobQueue.test.ts` "stores an error_json carrying a synthetic key without the key, and marks it"; `test/unit/pipeline/summarizeItem.test.ts` "stores no synthetic key planted in a warning, and marks the row"; `test/unit/pipeline/privacyPolicy.test.ts` "passes the persisted log through the gate: no synthetic key survives, and the record is marked". | met, gap noted: no test scans the whole database file after a real job, and the gate matches known key shapes (`test/unit/core/errors.test.ts` "still passes a 32-character run that is not hexadecimal — the residual gap"). Item 395(f). |
| Keys stored via `OSKeyStore.encrypt()` → `Services.logins`, origin `chrome://research-helper`, own realm | `LOGIN_ORIGIN`, `LOGIN_REALM`, `setSecret` (`src/zotero/keychain.ts`). `test/integration/zotero/secrets.spec.ts`: "round-trips a key-shaped string through encrypt -> store -> search -> decrypt, and no pref or log holds it". | met |
| The keystore is probed at startup; failure leads to a visible tier decision | `probeKeystore`, `probeAndRecordBackend` (keychain.ts). `secrets.spec.ts`: "runs the startup probe as a real round trip and returns a tier verdict". `sessionStore.test.ts`, describe "installSecretStore on a failed probe (P3-T03 step 2)": "never falls back to tier 2 silently: with no dialog to ask, no store is installed". | met |
| No plaintext fallback tier | `sessionStore.test.ts`: "offers exactly session and none: no passphrase tier, no plaintext tier". `getSecret` refuses a login that is not `oskv1:`-encrypted. | met |
| `uninstall()` clears every secret and every plugin pref; `shutdown()` does not | `uninstallSweep`, `uninstallPreferences`, `ZOTERO_UNINSTALL_STEPS` (`src/bootstrap/uninstall.ts`, `P7-T10`). `test/unit/bootstrap/uninstall.test.ts`: "clears keys, then data, then preferences, and reports each count"; "clears nothing on an upgrade or a downgrade"; describe "addon/bootstrap.js shutdown() (P3-T02)": "never calls onUninstall, for any reason". | met, gap noted: unit-tested against the real `bootstrap.js` text; an uninstall in a running Zotero is not measured (`P7-T25`'s QA run) |
| A restored data directory gives an explanatory empty-key state | `preferencesPane.test.ts`, describe "P3-T04 — the empty-key-after-restore notice (docs/09 §1.9 item 8)". | met |

### Key hygiene

| §7 line | Evidence | Verdict |
|---|---|---|
| **[BLOCKER]** No key in `Zotero.debug` output at any level; a full job at maximum debug, grepped for key prefixes | `test/integration/redactionAudit.spec.ts` (`P7-T14`): a summarize, a report and an audio job at debug level; `plan/reports/P7-T14.md`: three runs, 267 captured lines, 196 diagnostics lines and 16 URLs searched for 30 values, 0 found. Zotero's own HTTP lines: measured item 3 above. | met, gap noted: the OpenRouter and Gemini keys were exercised; the OpenAI, Anthropic, NCBI and Semantic Scholar keys were planted but not sent; Zotero's own lines are read from source, not captured (item 395(e)) |
| `Secret` wrapper; `.expose()` once per provider | Grep `\.expose\(\)` over `src`: one call each in the OpenRouter, OpenAI, Anthropic and Gemini adapters; TTS reuses Gemini's header builder. `openrouter.test.ts` "calls expose() in exactly one place: the header builder"; `openai.test.ts` "has exactly one expose() call site in src/llm/openai/"; `anthropic.test.ts` "calls Secret.expose() in exactly one place in the adapter's source"; `gemini.test.ts` "exposes the Secret exactly once per request". | partly met: the NCBI and Semantic Scholar keys and the pane's Test requests handle the raw string, not `Secret` |
| Logger redaction runs on every message and context value before emission | `createLogger` (`src/core/logger.ts`). `test/unit/core/logger-redaction.test.ts`: "redacts a secret that arrived only in the message", "redacts a secret nested inside a context object", "cannot be relaxed by a binding either". | partly met: direct `Zotero.debug` calls bypass the logger. The scope's `onError` in `src/addon.ts` prints a teardown error's message and stack without `redact` (item 395(d)); `reportSurvivors` (`src/hooks.ts`) and `addon/bootstrap.js` print counts and error names only |
| `Authorization`, `x-api-key`, `x-goog-api-key` never logged | `loggableHeaders` (`src/core/errors.ts`). `errors.test.ts`: "redacts a %s value too short for any KEY_PATTERNS shape" over the four header names. `gemini.test.ts`: "logs headers only through loggableHeaders: no logged line carries the key". Zotero never logs headers (item 3 above). | met (`x-api-key` by unit test only) |
| Gemini uses the `x-goog-api-key` header, never `key=` | `gemini.test.ts`: "carries the key only in x-goog-api-key: never in the URL, the body or another header". `test/unit/tts/geminiTts.test.ts`: "POSTs generateContent with the key in x-goog-api-key only, and returns the PCM". | met |
| `Zotero.HTTP.request` never called with `debug: true`; enforced by lint | `FORBID_HTTP_DEBUG` in `eslint.config.js` (`no-restricted-syntax`); CI step "ESLint and Prettier". Grep `debug\s*:\s*(true\|"true")` over `src`, `addon`, `scripts`: no hits. | partly met: `plan/reports/P3-T01.md` finding 4: the rule cannot see the one real call site, which calls through a local variable; the type system closes it instead (`HttpTransportOptions` has no `debug` member) |
| The debug bundle has no key and no paper content; its confirmation says so and offers a preview | `buildDiagnostics` (`P7-T13`). `test/unit/core/diagnostics.test.ts`: "keeps a planted key out of a log line, a setting, a job error and a header", "keeps a planted paper title and query in a job record out (diagnosticsJob)". The pane's **Show diagnostics** is the preview and its note says what is left out (`preferencesPane.test.ts`). | met; the confirmation dialog was struck in favour of the preview (`P7-T01`, `docs/07`); this line's wording is older |
| A 401 pauses the job, no retry, key kept, one notification | `validateCredentials.test.ts`, describe "P3-T14 — a mid-job 401 pauses the job once (docs/09 §2.4)". `errorMap.test.ts`: "does not retry a 401, a 403 or a context-length error automatically". | met (OpenAI adapter exercised) |
| The key is read per request | `gemini.test.ts` "… the key is read from the store on every request"; `anthropic.test.ts` "learns that a key was removed from the keystore when the next call reads it"; `semanticscholar.test.ts`, `pubmed-source.test.ts` likewise. | met |
| "Test key" uses a non-billing endpoint and sends no user content | `validateCredentials.test.ts`: "2xx: ok with the models, over its list endpoint on its own host, the key in a header and never a completion"; the NCBI and Semantic Scholar tests use a fixed public PMID and DOI (`preferencesPane.test.ts`). | met |
| A stored key is never re-displayed | `preferencesPane.test.ts`: "shows the first three and last four characters of a synthetic key and nothing else"; "rule 8: copy and cut on a key field are refused". | met |

### Data egress

| §7 line | Evidence | Verdict |
|---|---|---|
| **[BLOCKER]** No content sent without an explicit user action; no background, idle-time or on-import processing | **`autoSummarize`** (step 2 of the card): declared `PREFS.autoSummarize` (`src/prefs/schema.ts`) with `default: false`; `addon/prefs.js` sets `pref("autoSummarize", false)`; both pinned by `schema.test.ts` ("PREFS transcribes docs/07 §8.5" and the `addon/prefs.js` parity test). It is read only by `publishSummarySection` (`src/bootstrap/registerUI.ts`); when on, the item pane's summary section (`mayAutoSummarize`, `src/ui/panes/summarySection.ts`) starts Generate for the selected item after a debounce. Grep `autoSummarize` over `addon/content`: one hit, inside an XML comment of `preferences.xhtml`, no `preference=` binding; over `src/ui`: the reader and a comment in `preferencesPane.ts`; no `setPref("autoSummarize", …)` anywhere in `src`. Pinned: `preferencesPane.test.ts` "has no autoSummarize control, no voice preview, no format menulist, and does not bind the folder or sources (item 381; docs/08 §7.3's notes)"; `test/integration/preferences.spec.ts` asserts that no element is bound to it; `summarySection.test.ts` "issues zero Generate calls across twenty selections with autoSummarize off". Startup: `phase1-dod.spec.ts` "NFR-10: startup adds a measurable, bounded cost and issues no network request". | met. No UI path sets it; `about:config` can, which item 381 accepts. Note: a confirmed job interrupted by a quit resumes after restart without a new click (`createEgressResumeGuard`, owner, `plan/00` §6 item 250): a continuation of a confirmed run |
| **[BLOCKER]** User notes and PDF annotations not sent by default | `allowedInputScope` (`src/pipeline/shared/privacyPolicy.ts`); `privacyPolicy.test.ts` "sends notes, annotations and collection and tag names only under full, and only with their own opt-in". Grep: no caller passes an opt-in; the only note reads are of the plugin's own tagged notes (`src/zotero/notes.ts`). | met |
| Collection and tag names not sent by default | `metadataVariables` (`src/pipeline/summarize/summarizeItem.ts`) fills `{{TAGS}}` with the item's Zotero tags (the plugin's own removed), and both summary prompts print "User-supplied tags: {{TAGS}}" (`src/prompts/paper-summary-abstract.v1.0.0.md`, `paper-summary-fulltext.v1.0.0.md`). `reportVariables` (`src/pipeline/trendReport/compose.ts`) and the audio script (`src/pipeline/audioReport/script.ts`) fill `{{COLLECTION_NAME}}`. The `collectionAndTagNames` opt-in of `allowedInputScope` is read nowhere else. Only the recommendation profile withholds the name (`PROFILE_COLLECTION_NAME_WITHHELD`). | **not met.** Tags go to the provider in every mode, against §3.2 row 3a; the collection name goes in report and audio prompts, which §3.2's audio row admits and row 3b does not. Item 395(a). The README states what is sent as built |
| The pre-flight dialog states destination, model, item count, scope, mode, cost | `costConfirmDialog.test.ts`: "embeds the disclosure: items, provider, the effective host, model and mode, and its notices"; `privacyPolicy.test.ts`: "carries provider, model, item count, the scope per kind and the mode in force". | met |
| Per-collection privacy overrides exist, show at the point of action, only tighten | `effectiveMode`, `readCollectionPrivacySettings`, `loadStrictestPrivacyPolicy`; `privacyPolicy.test.ts` "returns the stricter of the two for all nine pairs…". | partly met: an override is read and only tightens, but no UI writes one, so a user cannot set it. Item 395(b) |
| OpenRouter sets `data_collection: "deny"` always, `zdr: true` in strict | `openRouterProviderBlock` (`src/llm/openrouter/mapper.ts`); `openrouter.test.ts` "adds zdr: true in strict mode and leaves it out in balanced and full mode". | met |
| A guardrail 404 from OpenRouter explains itself | `openrouter.test.ts`: "maps the synthetic guardrail 404 onto a user-facing PrivacyRoutingError naming the cause and both remedies". | met |
| `trainsOnInputByDefault === "unknown"` refused in strict, warned elsewhere | `privacyPolicy.test.ts`: "throws PolicyViolationError for an unknown policy in strict, and only warns in balanced (Done-when)"; "allows an unknown policy in full with no warning, as §3.5's table says". | partly met: full mode does not warn, as §3.5's table says; §7's "warned elsewhere" and §3.5 disagree |
| Gemini free-tier detection assumes free; the warning is not suppressible | `gemini.test.ts` describe "detectTier"; `privacyPolicy.test.ts` "shows the Gemini warning whenever the tier is free or unknown — never suppressed by the acknowledgement". Balanced mode warns and confirms (`P7-T32`, owner item 381). | met |
| The audio feature discloses Google independently | `audioDisclosure.test.ts`: "due: the audio notice first, both hosts and the script model"; `costConfirmDialog.test.ts`: "the notice names both destinations and what the TTS host receives (docs/09 §3 row 5)". | met |
| A local egress log per job | `egressLogEntry`, `withEgressLog`, `readEgressLog` (`egressDisclosure.ts`); `privacyPolicy.test.ts` "records provider, host, model, item count, scope and mode, and reads back off the stored record". | met |
| No telemetry, analytics or crash reports | Grep `telemetry\|analytics\|sentry\|crash.?report` (case-insensitive) over `src` and `addon`: comments only. Grep `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket(` over `src` and `addon`: local `resource://` reads only. NFR-10 startup test above. | met |
| Cache, summaries, job history, embeddings individually clearable; clearing summaries keeps the notes | `test/unit/core/dataReset.test.ts`, describe "P7-T10 — each clear removes its kind and nothing else"; `test/integration/preferences.spec.ts`, "P7-T10 — the stored-data actions, from the live plugin" (decline, then accept, per kind). | met |

### API terms compliance

| §7 line | Evidence | Verdict |
|---|---|---|
| One shared limiter per host, across jobs | `HOST_POLICIES` (`src/core/rateLimit/hostLimiter.ts`); `tokenBucket.test.ts` "hands out one bucket per host, and none for an unregistered host". | met |
| NCBI ≤ 3/s, ≤ 10/s keyed; `tool`/`email` always; maintainer's address; pair registered | `tokenBucket.test.ts` "sits below NCBI's published 3/s and 10/s, as §7.3 requires"; `pubmed-source.test.ts` "carries tool=research_helper and the maintainer email on every request"; `http-client.test.ts` describe "D10: NCBI receives the maintainer address and no other". | met; **release-time** for the registration (`P7-T28`, `G-04`) |
| Crossref polite pool; limiter reconfigured from response headers | `crossref.test.ts` "sends both polite-pool signals on every request…"; `hostLimiter.test.ts` "adopts Crossref's measured 3 → 1 concurrency drop, downwards only"; `container.test.ts` "sends the user's contactEmail as mailto and reconfigures the shared bucket from the response headers". | met |
| Semantic Scholar ≤ 1/s; attribution in the README and in generated reports | `semanticscholar.test.ts` "is 0.9/s in both modes, burst 1, max concurrent 1…". README: the section "Data sources and attribution" (`P7-T19`, this batch). Generated reports: grep `Semantic Scholar` over `src/pipeline/trendReport` and `src/prompts`: none. | partly met: the README carries it; generated reports do not. Item 395(c) |
| arXiv ≥ 3 s, one connection | `arxiv.test.ts` "spaces two consecutive search() calls >= 3000 ms apart…". | met |
| Europe PMC full text from the OA subset only | `jats.test.ts` "never requests fullTextXML for a record that is not open access". | met |
| bioRxiv/medRxiv conservative limit; licence respected | One bucket (`biorxiv.test.ts` "is one bucket, served by the registry…"); "reads the licence per record, verbatim, and never assumes one (docs/09 §5.6)". | met (no download path exists that would need the licence enforced) |
| `Retry-After` honoured, jittered backoff, attempt cap | `http-client.test.ts`: "waits the server's Retry-After rather than the jitter", "retries a 503 to the per-host cap and then throws UpstreamServerError". | met |
| No corpus harvesting; every request serves a bounded user action | `maxResults` bounded 10–200 (`src/prefs/schema.ts`); every opener is a menu or button (above). | partly met: declarations only; no test states the property |
| No publisher scraping, paywall circumvention or cookie reuse | Grep `addAvailablePDF\|importFromURL\|findPDF` over `src`: none. `http-client.test.ts` "disables Zotero's retry and status machinery and stays anonymous". | met (Zotero's own translators, used by the identifier import, were not assessed) |
| Two-slot contact scheme; the user's address only in Crossref's `mailto` | `userAgent.test.ts` "always carries the maintainer address, never a user's"; `crossref.test.ts` (D10). Grep `getPref("contactEmail")`: the Crossref wiring and the diagnostics' withheld list only. | met |

### Supply chain and distribution

| §7 line | Evidence | Verdict |
|---|---|---|
| **[BLOCKER]** `update_url` is HTTPS with a validating certificate | `addon/manifest.json`'s `update_url` is `https://raw.githubusercontent.com/suppakoko/research_helper/release/update.json`; `plan/10` §0's V-18 (delivery end to end, 2026-09-16). | met in source; **release-time** for the served file (`P7-T26`, `P7-T30`) |
| **[BLOCKER]** Every `update.json` entry has a CI-generated sha256 or sha512 hash | **Step 3 of the card.** `.github/workflows/release.yml`, job `build`, step "Build XPI and update manifest" runs `npm run build`; `zotero-plugin.config.ts` sets `build.makeUpdateJson.hash: true`, so the scaffold writes `update_hash: "sha512:…"` from the XPI it just packed. Step "Check the built manifests" recomputes `createHash("sha512")` over the one XPI in `dist/` and fails unless the entry for this version matches `/^sha512:[0-9a-f]{128}$/` and equals it. `test/unit/scripts/releaseWorkflow.test.ts`: "generates the update hash in the run and holds none (plan/00 §6 item 381)". No hash is typed by hand anywhere. | met by the workflow, against the corrected wording; **release-time** for the served file (`P7-T26`) |
| `update_link` pins an exact version path | `xpiDownloadLink` in `zotero-plugin.config.ts`: `…/releases/download/v{{version}}/research-helper.xpi`. | met in config; **release-time** |
| Lockfile committed; `npm ci`; runtime dependencies pinned | `package-lock.json` is tracked; both workflows install with `npm ci`; `releaseWorkflow.test.ts` "pins zotero-plugin-toolkit exactly, in package.json and the lockfile, to the installed version". | met |
| `npm audit` in CI; high-severity advisories block | CI step "Audit runtime dependencies (P7-T21)" and the release workflow's "Audit runtime dependencies": `npm audit --omit=dev --audit-level=high`; `releaseWorkflow.test.ts` "audits the runtime dependencies in the lint job, and every job reads only". Measured today: 0 runtime advisories (above). | met for the runtime tree; development advisories are not gated (item 395(g)) |
| Releases built in CI from a tag; restricted permissions; review on the workflow | `release.yml`: triggered by `v*.*.*` tags or by hand with a tag; top-level `permissions: {}`; `contents: write` only in job `publish` (`releaseWorkflow.test.ts` "holds contents: write in the publishing job alone"). | partly met; **release-time**: tag protection and required review are repository settings, and there is no `CODEOWNERS` file |
| **[BLOCKER]** No secret embedded in the XPI | Measured item 1 above (0 hits over 25 files of the built XPI). `schema.test.ts` "ships no default that the logger's redaction would treat as a credential"; `releaseWorkflow.test.ts` "sets no FIXTURE_MODE and reads no secret". | met for the working-tree build; **release-time** for the tag's XPI (`P7-T26`) |
| `SECURITY.md` exists with a contact address | `SECURITY.md` (this card). The contact is a placeholder for the owner, by the brief; item 395(h). | partly met until the owner fills the contact |
| A post-compromise plan with "rotate all configured API keys" first | `SECURITY.md`, "If a release is compromised": step 1 is "Rotate all configured API keys". | met |

### Documentation and honesty

| §7 line | Evidence | Verdict |
|---|---|---|
| **[BLOCKER]** §1.8's statement in the pane, unabbreviated, with the other-plugins sentence | `preferencesPane.test.ts`, describe "P1-T44 — rule 4, docs/09 §1.8 verbatim in the bundle": "reproduces all five paragraphs word for word"; "rule 4: the five risk paragraphs are plain always-visible paragraphs, not a disclosure or a link". | met |
| A first-run notice about peer review, confidential material and participant data, shown once, not skippable | `research-helper-egress-first-job-notice` (en-US); `privacyPolicy.test.ts` "includes the first-job notice only while privacy.egressAcknowledged is false". Grep `peer-review\|participant data` over `addon/locale`: none. | partly met: the notice is shown once and not skippable, but it does not carry §4.3's three cautions. Item 395(b) |
| No overclaimed protection | Grep (case-insensitive) `military\|data is safe\|never see your data\|fully secure\|completely private` over `addon/locale/en-US`, `src/prompts` and `README.md`: none. `policyNotes.test.ts` "claims no protection the pages do not state…". | met |
| Retention figures cite the provider's page and carry a verification date | `POLICY_NOTES`, `POLICY_NOTES_AS_OF` (`src/llm/shared/policyNotes.ts`); `policyNotes.test.ts` "gives every row an ISO date, the re-verification's, and at least one https source". | partly met: the pane shows the date; the source address is in the data and in `docs/09` §3.3, not on screen |
| Every policy claim in user-facing text traces to a source | `policyNotes.test.ts` "takes every source from docs/09 §3.3's re-verification table of that date"; `privacyPolicy.test.ts` "transcribes the Gemini warning from docs/09 §3.6 item 3, verbatim". | partly met: the policy notes and egress notices are traced; §7 points at "§8", which is now "Open decisions" (the sources are the unnumbered "Sources" section) |

## Lines not met or partly met (findings)

Not `[BLOCKER]`s; listed for the release checklist (`P7-T24`). Those needing an owner's answer are
`plan/00` §6 item 395 (a)–(h).

1. Tags and the collection name in prompts (not met) — item 395(a).
2. Per-collection overrides cannot be set, and the first-run notice lacks §4.3's cautions — item 395(b).
3. Semantic Scholar attribution in generated reports — item 395(c).
4. `src/addon.ts`'s scope `onError` prints a teardown error's message and stack without `redact` — item 395(d).
5. Keys exercised by the debug audit: two of six; Zotero's own lines read from source — item 395(e).
6. No whole-database scan after a job — item 395(f).
7. Development-dependency advisories (4 high, 13 moderate) — item 395(g).
8. `SECURITY.md`'s contact and response times — item 395(h).
9. Recorded, no question: `.expose()` not used for the NCBI and Semantic Scholar keys; the
   `debug: true` lint cannot see its call site (types close it); full mode does not warn on an unknown
   training policy (§3.5 and §7 disagree); corpus bounds are declarations only; the pane shows the
   retention date, not the page; §7's "§8" reference is stale; tag protection and review are
   repository settings with no `CODEOWNERS`.

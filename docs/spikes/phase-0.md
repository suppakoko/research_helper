# Phase 0 spike report

**Measurement dates:** 2026-09-10 → 2026-09-30 · **Report written:** 2026-09-30 · **Card:** `P0-T28`

This is a **record, not a document** (`docs/07` §2.2.1). It states what was measured, when, on
what hardware, against which version of which API. It is not revised in place: a later
measurement that disagrees becomes a dated addendum below or a second report, and the design
corpus is updated to cite the newer one. It is the R-21 bus-factor mitigation — every finding
here is reproducible from the repository without re-running the spike, because each row cites a
commit, a CI run, a log excerpt or a number.

**Redaction (`docs/09` §2.2, `docs/07` §2.2.1 rule 3):** no API key, key fragment, or unredacted
request body appears in this file. Every probe took its key from a runtime password dialog or the
process environment and printed `Authorization` only as *present*; the two keyed provider legs
report cost and latency, never credentials.

**Scope note.** 33 cards, `P0-T01`–`P0-T33`. Thirty-one are `DONE`. `P0-T21` is **still `TODO`**
and its Semantic Scholar row below is an unfilled placeholder. `P0-T28` is this report.

---

## 1. Environment

| Item | Value |
|---|---|
| Date range of the spike | **2026-09-10 → 2026-09-30** (21 calendar days; commits on 7 distinct days: 09-10, 09-14, 09-15, 09-16, 09-21, 09-29, 09-30) |
| OS and version | Windows 11 Pro 10.0.22631; i7-14700K, 32 GB; test data directory on a **spinning hard disk** |
| Zotero version (exact) | **10.0.1 → 10.0.2 → 10.0.3** — moved twice mid-phase, both times by self-update during a run. See §4. |
| Gecko / Firefox baseline | **140.15.0** (measured, `P0-T23`) |
| Node version | v22.23.0. Effective floor is **≥ 22.13** (vitest 5 needs ^22.12, eslint 10 needs ^22.13), not `docs/01` §4.6's ≥ 22.8 |
| `zotero-plugin-scaffold` version | 0.9.2 |
| `zotero-plugin-toolkit` version | 5.2.0 — **installed but no longer constructed**; `P0-T33` removed it from the bundle |
| `zotero-types` version | 4.1.3, `entries/sandbox` |
| TypeScript version | 5.9.3 (held at 5.9 by owner decision 2026-09-10 although 7.0.2 is current, to keep Phase 0 to one variable) |
| Vitest version | 5.0.0, with `@vitest/coverage-v8@5.0.0` |
| esbuild `target` that actually worked | **`firefox140`** — confirmed, not merely compiled: the `firefox140` bundle installs, enables and runs on 10.0.1/10.0.2/10.0.3, and Gecko measures 140.15.0 |
| Repository | `github.com/suppakoko/research_helper`, public, default branch `main`; plugin ID `research-helper@suppakoko.github.io` (D9), unchanged |

---

## 2. Spike results

**Verdict values** are the template's: `verified` · `workaround` · `blocked` · `failed`. Where the
answer is not uniform across a spike's targets, the verdict cell carries the qualifier — not a
footnote. **16 verified, 1 verified-with-a-blocked-branch (`V-16`), 1 workaround (`V-6`), 1 partial
and still open (`V-13`).** Nothing failed.

| # | Assumption (short) | Task | Verdict | Evidence (commit / CI run / log / fixture) | Consequence & follow-up |
|---|---|---|---|---|---|
| `V-1` | Scaffold-built plugin installs and runs on Zotero 10.0.1 Windows; version range accepted | `P0-T02`, `P0-T03`, `P0-T09`, `P0-T10` | **verified** | `f2cad58`. XPI 41,284 B (0.04 MiB against NFR-18's 3 MB). Dev profile `extensions.json` after launch: `active: true`, **`appDisabled: false`**, `signedState: 0`, `targetApplication {"minVersion":"10.0","maxVersion":"10.0.*"}`; `startup` called with `APP_STARTUP`; no compatibility/blocklist/signature line in the 65 KB debug log | `strict_max_version: "10.0.*"` is accepted in practice; Zotero does not require signing. Measured on **10.0.1 only** (§4). `docs/11`'s definition-of-done asks for an install into the *real* profile — deliberately not attempted, and still owed (gate `G-08`) |
| `V-2` | Hot reload works on Windows via `zotero-plugin serve` / RDP | `P0-T08` | **verified** | `e57ce04`. Five reload cycles, each confirmed twice: `serve` printing `src\hooks.ts changed → Reloading… → Last extension reload: <time>`, and a unique marker string reaching Zotero's debug log from the reloaded `onStartup`. All six bootstrap hooks exercised per cycle, **no plugin exception in 572 KB of log** | R-11 did **not** materialise; `server.asProxy` never touched. Two operational facts: `ZOTERO_PLUGIN_PROFILE_PATH` is a **directory path, not a `profiles.ini` name** (any empty directory works), and scaffold builds `["--purgecaches","no-remote"]` — **no leading dash**, so `-no-remote` isolation is not in effect. **Close Zotero before `npm start`** |
| `V-3` | Debugger attaches (`server.devtools` → `--jsdebugger`); breakpoints hit; debug logging usable | `P0-T08` | **verified** | `5132b33`. Over RDP: bundle found among 414 sources; line breakpoint on `createSpikeArticle` bound; 0.12 s after the menu command, `{"type":"paused","frame":{"displayName":"createSpikeArticle","where":{"line":294}},"why":{"type":"breakpoint"}}` with stack `createSpikeArticle ← run ← onCommand ← menuCommandListener`. Repeated on a fresh launch | **Only the bundle is debuggable, not `src/*.ts`** — neither esbuild nor scaffold 0.9.2 emits a source map (`sourceMapURL` null). Two debugger servers exist; a pause on either freezes the main window's timers. On Gecko 140 `why.actors` is `[null]`, so automation matches on `frame.where`. **Degradation:** scaffold's `.scaffold/logs/` capture regressed to 0-byte files once Zotero began relaunching itself (§4); Zotero's own Debug Output remained usable throughout |
| `V-4` | `shutdown()` fully tears down, verified by 5 disable/enable cycles | `P0-T07`, `P0-T11` | **verified — after a code change the spike forced** | `f67de7e` (failure), `a50930a` (fix), `01bc900`. Real `ADDON_DISABLE`/`ENABLE`/`UNINSTALL` driven against the **built XPI** twice from a clean profile. Post-fix counters: `Zotero.Reader` listeners **0** at every step (was 2 → 17); `patching getField` **0** lines (was 17); `Item.prototype` `getField`/`setField`/`isFieldOfBase` identical to pre-plugin captures; `Zotero._toolkitGlobal` absent; registry `{"alive":false,"size":0,"liveHandles":[]}` after every disable and after uninstall | **The first run failed and the five checkboxes could not see why.** Every `ZoteroToolkit` instance leaked one `Zotero.Plugins` observer (15 added, 0 removed), one `Zotero.Reader` `renderToolbar` listener, and three `Item.prototype` wrappers — registered *internally*, so the teardown registry was blind to them. `P0-T33` removed the toolkit: bundle **130,482 → 14,718 B**, XPI **45,022 → 17,738 B**. Nine-tenths of the shipped JavaScript was a library the plugin never called. **Attribute leaks by where the observer's code lives, not by call stack** — the one remaining `Zotero.Plugins` observer is Zotero's own |
| `V-5` | Scaffold in-Zotero Mocha runner works and can run on GitHub Actions Ubuntu | `P0-T13`, `P0-T14` | **verified** | `8ddaa5d`, `8421efd`, `6a3a17f`. Locally: exit **0** in 19.5 s, 3 specs green in a real Zotero (later 13, then 15 across the phase); the lifecycle spec was **proven to catch a regression** — with `unregisterAll()` removed it failed with the registry still holding `["main window / main-window Fluent bundle","Tools menu item"]`, exit 1. On CI: PR [#1](https://github.com/suppakoko/research_helper/pull/1) run [34937528845](https://github.com/suppakoko/research_helper/actions/runs/34937528845), step "Run in-Zotero tests (headless)" `success` in 28 s on `ubuntu-24.04`, **twice**; pinned Zotero 10.0.2 tarball provisioned in 5 s | Integration tests are **automatable**, so `docs/13`'s test strategy stands. Caveats: `continue-on-error: true` is still set on the job and should come off after a few more green runs; Mocha 12.0.1 and chai are fetched **unpinned** from jsDelivr/chaijs.com on first run, so CI needs that network access; the runner **hangs after reporting results** and loses its output to a broken pipe — redirect to a file with a hard timeout |
| `V-6` | `zotero-types` accurate for Zotero 10 across items, collections, notifiers, prefs panes, `Zotero.HTTP` | `P0-T06` | **workaround** — accurate in the core, lags in six places, four of which this plugin hits | `0675412`, `a6175f2`. `scripts/probe-types.ts` against the unaugmented package: **15 errors**; after `typings/zotero-augment.d.ts`: **0**. Five augmented blocks, each proven necessary by the baseline run: `SaveOptions.undoAction`/`undoActionArgs`; `HTTP.request`'s `anon`/`noRetryOnThrottle`/`userContextId` plus the five `HTTP` exception classes; `OSKeyStore` (absent entirely); `Retractions.isRetracted` (absent entirely); the four Zotero 10 plural selection getters | `docs/11`'s own prescribed remedy (a local augmentation file) is in place, which is why this is `workaround` and not `verified`. **Four compile-time holes augmentation cannot close:** `PDFWorker.getFullText` (upstream `let PDFWorker: any` → duplicate identifier), `Services.logins.removeLoginAsync`, `Fulltext.getPages().indexedPages`. **Three cases that are wrong rather than missing, and no types can help:** `_ZoteroTypes.ZoteroPane` carries `[attr: string]: any` so the singular getters that **throw** on Zotero 10 still compile; `Search.addCondition` keeps the removed `required` param; `DB.executeTransaction`'s options are all required and misspell `disableForeignKeys`. Those three are guarded only by the cards' `Do NOT` rules. Types are a compile-time claim: `V-6` is the only spike types can answer, and even it needed `P0-T10`/`P0-T20`/`P0-T23` for the runtime half |
| `V-7` | Arbitrary cross-origin POSTs with custom headers to all four LLM providers + one literature API | `P0-T15` | **verified for 3 of 5 targets — OpenAI and Anthropic direct calls are UNMEASURED, no key entered, by the owner's decision** | `54b126c` (owner run 2026-09-30 02:37 UTC, Zotero 10.0.3). OpenRouter `POST /chat/completions` → **HTTP 200 in 1,788 ms**, `finish_reason: stop`, content `"pong"`, **cost $0.00004**; read back from Gecko's channel, the D10 `User-Agent`, `HTTP-Referer`, `X-Title`, `X-OpenRouter-Title`, `X-OpenRouter-Metadata` and `Authorization` all sent and **no `Cookie`** (so `anon: true` holds and Zotero does not override a custom `User-Agent`); `openrouter_metadata` came back in the response, **which only happens if the custom header arrived**. Gemini direct via the Interactions API → **HTTP 200 in 3,024 ms**, `status: completed`, text `"pong"`, with `x-goog-api-key` as a **header** and no key in the URL. PubMed `esearch` keyless → HTTP 200, 8,915 hits, `X-RateLimit-Limit: 3`, no `Cookie`. Earlier run `65c1dd3` (2026-09-15, 10.0.2) reproduces OpenRouter and PubMed independently | **The client-side, no-backend premise is cleared for the D6 default provider**, so `docs/11` §4's stop-and-re-plan condition does not fire. But two of four providers were never called: the owner cancelled those two password dialogs, and the probe skipped the legs cleanly (itself the designed behaviour working). **The `anthropic-version` header `V-7` names explicitly has never been sent.** Escalation 4a in §7. Three implementation findings: with `successCodes: false` a failed connection **resolves with status 0 instead of throwing**, so `docs/01` §8.2's exception mapping cannot occur under `docs/07` §7.4's options (mapped to `NETWORK`); Zotero's `http.js` writes **the first 1024 characters of every string request body to `Zotero.debug`** without `debug: true`, putting prompts and possibly body-borne keys into Debug Output — the client passes `logBodyLength: 0`, which §7.4 does not list; and `core/` takes the transport by **injection**, because `docs/07` §2.2/§7.4 show `client.ts` calling `Zotero.HTTP.request` directly, which §2.3's layering and the lint rule forbid |
| `V-8` | SSE streaming responses are consumable, or cleanly not | `P0-T16` | **verified — consumable, and the sandbox-viable path is XHR, not `fetch`** | `54b126c`. Through `Zotero.HTTP.request({responseType:"text", requestObserver})` + `onprogress`: **30 progress ticks over 4,096 ms, first text delta at t+876 ms — 3,897 ms before the response completed**, 111 SSE events, end sentinel seen. `fetch` + `ReadableStream` also worked (43 chunks, first at t+628 ms) **but only in the Run JavaScript window global**. Parser self-check 6/6 against `docs/03` §6's recorded frames, offline | R-14 does not materialise: token-level streaming is available, so `docs/08` §6.2's streaming preview is buildable. **Build on XHR** — 55:2 in favour among established plugins, and the `fetch` path's prerequisites are window-only. `src/llm/shared/sse.ts` is the frame parser only, pure, no Zotero import, unit-tested. Run JavaScript is **not** the plugin sandbox (it evaluates in the main window's global), so its capabilities must never be read as the sandbox's |
| `V-8b` | `getStructuredDocumentText` exposes usable font/layout geometry | `P0-T18` | **verified — geometry yes, font size/weight/name no, and something better than either** | `c7b49d8`, `bf2a225`. Five then seven PDFs, IDs/keys/SHA-256s in `test/fixtures/pdf/README.md` (files never committed — publisher content, `docs/09` §4.4). Every block carries a page box, every text run a box with per-character widths plus `bold`/`italic` flags; **no font size, weight or name**, and run height does not separate headings from body in the Genome Biology or bioRxiv files. But the worker already **classifies heading blocks** and emits a **section outline** — native PDF bookmarks where present (clean Abstract/Background/Results/Discussion/Methods on Genome Biology and arXiv), otherwise a bundled layout model. Two-column reading order, measured band-wise: PNAS **0/306** inversions (structure API) and 0/300 (flat `getFullText`); arXiv control **0/481** and 0/455 | **IMRaD detection is feasible, and its accuracy is not established — mislabels appeared on three of four articles.** So **R-19b's 40-PDF accuracy gate stands unchanged and `auto` must stay on whole-document chunking until it passes** (gates `G-12`, `G-22`). The R-19b owner decision does **not** fire (§7 row 1). **No column-reordering pass is needed in Phase 3, on either API.** Four things a Phase 3 harness must get right, all measured: measure per vertical band, not per page (the page-wide metric reports 111/1563 on PNAS and every one is correct layout); **`style.bold` is not portable** — 0 bold and 0 italic across 2,754 runs on the arXiv file despite embedded bold Type-1 faces, against 70 bold / 258 italic on PNAS, because the detector keys on font *name*; a native outline is **not** better than an inferred one (PNAS `source:"native"`, 23 entries, only **4 anchored to a block**; arXiv inferred, 22/22 anchored); run-in headings are invisible, so IMRaD sub-structure below Results/Methods is unavailable on that layout. Scope: one article per publisher family at most — nothing measures Elsevier, Wiley, Springer, Nature-family or Cell, non-English text, or table-heavy pages |
| `V-9` | Request abortion works (`AbortController` or Zotero equivalent) | `P0-T17` | **verified for the primitive — MID-STREAM cancellation and partial-body readability are UNTESTED** | `54b126c`. Calling the `cancellerReceiver` function at t+607 ms rejected the request **0 ms later** with `Zotero.HTTP.CancelledException` — checked against all five exception classes, only that one matched — with **0 progress ticks in a 2,500 ms quiet period afterwards**. `src/core/http/client.ts` maps it to `HttpError code=CANCELLED, retryable=false`, the mapping `docs/07` §10.1 requires and the one the facade would otherwise have got wrong as `NETWORK` | Cancel is real, not cosmetic, so FR-10/FR-23/FR-42 rest on a measurement. **What the run did not establish, stated plainly: the abort fired at t+607 ms and the first byte arrived at t+677 ms on the comparable leg, so the partial body was 0 chars.** Cancelling after data has been delivered — and with it whether a partially streamed body stays readable — is untested. A cheap re-run with a later abort point is owed before Phase 3's job engine relies on partial output. The `AbortController` branch is **n/a in the plugin sandbox** (absent, `docs/01` §2.3) and **yes in a window global** (`AbortError` 0 ms after `abort()`) |
| `V-10` | Gemini TTS returns acceptable Korean audio with embedded English terms (native-speaker judged) | `P0-T25` | **verified** | `bfc4675`, `b304792`. Model `gemini-2.5-flash-preview-tts` (cheapest TTS entry off the **live** model list, not hard-coded), voice `Charon`; `mimeType: audio/L16;codec=pcm;rate=24000` **matching `docs/04` §3.1 exactly**; 108.37 s of audio, 5,201,806 PCM bytes. Owner's verdict 2026-09-30, native Korean speaker, full 108 s listened: **"음성 판정 좋음, 그대로 써도 됨"** — good and usable as shipped | **R-8 does not fire**; Gemini stays the audio path (§7 row 2). **The cost model's one unverified constant is now measured:** `usageMetadata` reported 504 prompt and 2,709 output tokens for 108.37 s = **24.998 output tokens/second**, matching to three significant figures the third-party figure `docs/04` §4.2 carried under an explicit warning that "the whole TTS cost model inherits this uncertainty". Real cost **$0.0273** against a $0.042 pre-estimate. **The finding that matters is what the script did *not* have:** it deliberately shipped six inline Latin-script terms and eleven raw numeric forms with none of `docs/04` §9.1/§9.2's mitigations — precisely the input §9.1 calls "the dominant problem in Korean scientific TTS" — and the predicted accent switches and broken prosody **did not happen**. So §9.1/§9.2's transliteration and number-expansion passes are a **quality improvement, not a prerequisite**, and Phase 6 must not schedule them as blocking. Scope, so nobody over-reads it: one script, one voice, one model, one listener, one sitting |
| `V-11` | Binary/audio response handling: arraybuffer, file write, attachment registration | `P0-T26` | **verified for the file-write and attachment halves — the `arraybuffer` clause was never exercised live** | `f742c2c`, `bfc4675`. Integration run exit 0, **15 specs green**, against the real 5 MB `P0-T25` output rather than a synthetic tone: WAV 5,201,850 B, `ChunkSize 5201842 = 36 + 5201806` (so `docs/04` §3.3's first trap holds on a real payload), re-read off disk parses as RIFF/WAVE 24 kHz mono 16-bit, registered as **`imported`** with Zotero copying it into `…\storage\3N8LR6UY\`, and a hostile LLM-shaped filename survived sanitising and was accepted. Windows' own `System.Media.SoundPlayer.Load()` accepts the file. Gotcha 20 confirmed against the shipped client: `attachments.js` out of the installed `omni.ja` has `importFromFile`, `linkFromFile`, `importEmbeddedImage` — **`importEmbeddedItems` appears nowhere** | **`V-11`'s `arraybuffer` clause is not on the Gemini TTS path at all** — Gemini's TTS returns base64 inside a JSON body, so the binary-response question matters for OpenAI TTS and PDF fetches instead. `http.js` assigns `responseType` straight onto the XHR with **no whitelist** (ll. 367–369) and resolves the raw XHR, so `docs/01` §8.4.1's claim checks out **against source only** — a live assertion is still owed, and belongs in a probe because `docs/13` §2.3 forbids external calls from integration specs. **`src/core/http/client.ts` cannot carry a binary response today** (`responseType` typed `"text"`, `body` a `string`); widening that contract is owed before shipped code fetches audio bytes through the facade. "Opens and plays" from Zotero is closed only by the owner hearing the same bytes — the spec's `after()` erases its own items. `docs/04` §10.2 contradicts itself and the implementation follows the sketch (size test, >10 MiB linked) rather than the table (always `linkFromFile`) — §7 row 8 |
| `V-12` | 100 Zotero items created in a batch within NFR-1 (≤ 10 s) without freezing the UI | `P0-T20` | **verified** | `99e41e2`, `cb02bd1`. One `Zotero.DB.executeTransaction` around 100 `save()` calls, measured **nine times**: **293–425 ms total, median 324 ms, 2.9–4.3 ms per item** — ~25× under NFR-1's 10 s ceiling, 14× under its 6 s target. A `Zotero.DB` begin callback counted **exactly one transaction** per write. NFR-3, measured without a human by a 10 ms `setInterval` recording every tick gap: **longest stall 77 ms** (cold first write), warm 34–62 ms, **no gap over 100 ms in any of the nine** | **No alternative write strategy is needed** — chunks of 25 are not required for throughput, only for a progress indicator. **Collection-tree deferral is free:** Zotero queues change notifications for the whole transaction and delivers them once after commit (child list 0 → 100 in one step), costing 60–100 ms, inside NFR-1. **NFR-3 is the thin margin** — ~23 ms on a cold write, and Windows' ~16 ms timer resolution both hides shorter blocks and overstates each gap. Machine context is needed to read these numbers: the CPU is far faster than `docs/10`'s 2023 mid-range baseline while a spinning disk and an attached Browser Toolbox cut the other way, and the library was near-empty (0 → 200 items). **Phase 1 must re-measure stalls against a ~10,000-item library**; the record-building block (14–21 ms here) grows linearly, so the mapper must yield |
| `V-13` | Abstract availability measured empirically across the seven sources | `P0-T21` | **partial — 5 of 7 sources measured; Semantic Scholar PENDING, arXiv blocked at their end. `P0-T21` is still `TODO`.** | `73cb666` (2026-09-15), `7c1af9a` (re-run 2026-09-30). Query **`CRISPR base editing`**, window 2024-01-01 … 2026-12-31, rendered per source per `docs/02` §12.2; 26 requests, **all** passing the D10 identification audit (Crossref confirmed the polite pool with `x-api-pool=polite-array`). See the per-source table in §2.1 | R-17's **High** likelihood is **confirmed for Crossref and refuted for PubMed**. Backfill is quantified and it reframes R-17: of **291 unique DOIs, only 7 were seen by two sources**, so merging result sets recovers almost nothing and backfill must be a **targeted DOI lookup** — a targeted Europe PMC lookup lifts Crossref-sourced records **42 % → 63 %** (57 DOIs sent, 30 found, 20 with an abstract) and corpus-wide coverage **79.0 % → 85.9 %**. PubMed and Europe PMC backfill each other by exactly 0. **Nothing in this report depends on the pending Semantic Scholar number:** the ~63 % figure is the *keyless* ceiling measured without it and a keyed S2 can only raise it, and Phase 1 is unaffected because PubMed is Phase 1's only source and it measured 100 % |
| `V-14` | Semantic Scholar unauthenticated behaviour measured; key application submitted | `P0-T22` | **verified** | `c286ae9`, `aa6110d`, `ffcaf7a`. **12 `/paper/search` requests over 72 s, spaced 1.2 s / 8 s / 20 s / 30 s → HTTP 429 every time: zero successes, zero transport errors**, at ~1 request per 6 s, far under the 0.9 req/s budget `docs/02` §2.4 sets for this host. `docs/02` §6.4's 2026-09-08 evidence reproduces exactly — same status, same `x-amzn-ErrorType`, byte-identical 174-byte body | **Unauthenticated Semantic Scholar is not "throttled", it is unusable**, and the throttle is on the shared anonymous pool so our own pacing changes nothing. The degraded Crossref + Europe PMC + lexical path R-3 designs as a *fallback* is the **default** path for every keyless user; build and test it as such, not as an exception branch. Three details Phase 2's typed error mapping needs: **no `Retry-After` header** (so §2.4's back-off-with-jitter branch is the only one that ever runs), `code` is the JSON *string* `"429"` while §6.10's 400/404 shape uses `error` instead of `message` (one decoder must accept both), and `statusText` is empty under HTTP/2 so nothing may match on it. §6.4's "subsequent calls succeeded intermittently" did **not** reproduce (0 of 12); a 72 s window cannot disprove it, so it stands as a single-session observation. **Key application submitted on or before 2026-09-15; the key arrived 2026-09-30 and gate `G-03` is CLOSED** — roughly two weeks, faster than R-3's "can take weeks", but one data point, not a reason to weaken R-3's week-1 rule |
| `V-15` | Zotero's existing full-text index readable from a plugin, quality adequate | `P0-T19` | **verified — YES, and no PDF parser is bundled** | `fc0b31e`, `c3b081b`. Measured on **all seven** corpus attachments, not the five the card names. `item.attachmentText` returned usable text for every file in **1–3 ms** (cache read) against 24–1,060 ms for a fresh `getFullText`, and — the result the verdict rests on — **the two were byte-identical on all seven**. Chars 7,659–149,536; letters/total 0.710–0.782; all indexed (10/10, 16/16, 51/51, 63/63, 1/1, 12/12, 11/11) | The cache is not a lossy copy, so re-parsing buys nothing: **NFR-18's 3 MB ceiling and NFR-19 are protected**. **On-demand extraction persists nothing — established by reading the source first rather than racing it:** with `pdfMaxPages = 0` a throwaway copy imported UNINDEXED, `await attachmentText` took 127 ms and returned the same 30,707 characters, and afterwards the index state, `getPages()` and the storage directory were **unchanged**. But `attachmentText` is a **getter that re-runs the whole ladder on every access** (86 ms on a second read) — **Phase 3 must read it once and keep the string.** One asymmetry in neither §3.3.2 nor §3.3.4: the on-demand rung calls `getFullText(id)` with **no `maxPages`**, so an unindexed attachment yields every page while an indexed one is capped. **Where the verdict is thin:** every file is ≤ 63 pages, under the 100-page `pdfMaxPages` default, so `INDEX_STATE_PARTIAL` and D-06-3's bypass — the one regime where the two APIs *must* differ — never arose; no non-English file, so the language check is untested; no encrypted or corrupt PDF, so the demotion path is untested |
| `V-16` | OS-keystore round-trip; unavailable-keystore behaviour; pref round-trip cost | `P0-T23` | **verified for tier 1 on Windows · the unavailable-keystore branch is BLOCKED** | `1cbec7e`, `9db88d3`. Verified twice through the integration runner (8 specs green) and once **from the plugin sandbox itself** (confirmed sandboxed by `typeof console === "undefined"`), with fake values only. Round trip: a 64-character key-shaped value encrypted to a 130-character `oskv1:` string under origin `chrome://research-helper`, found by `searchLoginsAsync`, decrypted equal; first save 360–460 ms (login-store init), later reads **2–3 ms**. `has()` returns `true` with **0** `OSKeyStore.decrypt()` calls, counted by a wrapper. Startup probe: a real encrypt/decrypt round trip returning `{"backend":"os-keychain"}` in **13–24 ms**. Preferences: a non-secret pref and a `*.keyPresent` boolean round-trip; **a pref read costs ~0.5 µs**, so hot-loop reads are not a concern. Rule 5 / D5: while stored, **0 of 5,548 prefs** and not `prefs.js` held the value or its ciphertext, `logins.json` held no plaintext, and with `signon.debug` and `toolkit.osKeyStore.loglevel=All` at maximum the value appeared in neither Debug Output nor the console services | **D5's keystore path works, so `docs/09`'s key handling stands** — but only where it could be reached. **The Linux-without-libsecret branch was never reachable on a Windows machine:** an unavailable keystore could not be produced, and only a *simulated* throwing `encrypt()` was exercised. Gate `G-09` (a libsecret-less Linux box) never materialised, so **`docs/11` §5's "Before Phase 0 ends" fallback question is a live escalation — §7 row 3, gate `G-10`.** Hole (c) settled, **and it breaks `docs/09`'s tier-1 code as written:** on 10.0.2 `removeLoginAsync` and `modifyLoginAsync` are **`undefined`** — only `addLoginAsync` and `searchLoginsAsync` are async, while synchronous `removeLogin`, `modifyLogin`, `findLogins` and `addLogin` all exist. §1.2 had described Zotero's `main` branch (already Zotero 11 on Firefox 153 ESR) as if it were the release, and its `setTier1` **would have thrown a `TypeError` the second time a key was saved**. Also: no OS prompt appears on Windows; `available` is `true` but only means Mozilla's module imported, which is why the probe does a real round trip; `decrypt()` returns an unprefixed value unchanged (legacy plaintext support), so `getSecret()` refuses anything without the `oskv1:` prefix. One persistent side effect left deliberately: the Windows credential **"Zotero Encrypted Storage"**, one key per Windows user, shared with Zotero's own sync and WebDAV credentials |
| `V-17` | Fluent `.ftl` localization works on Zotero 10 including `ko-KR`, with English fallback | `P0-T24`, `P0-T32` | **verified** | `694e977`, `88cdfe1`, `9db88d3`. Built: `locale/en-US/research-helper-mainWindow.ftl` and `locale/ko-KR/research-helper-mainWindow.ftl`, both **flat**, prefixed once, zero `researchHelper`, byte-identical in the XPI. en-US resolves `"Research Helper"` / `"Create spike item (P0-T10)"`, identically through `document.l10n` and a plain `Localization`; the old subfolder path as a control returned `[null]`. ko-KR: with `Services.locale.requestedLocales = ["ko-KR"]` the root resolves **`"리서치 헬퍼"`**. Teardown: `<link>` count 0 → 1 → 0 across one cold start and four hot reloads, never growing, and after teardown `formatMessages` returned `[null]` — the window's resolver dropped the file, not merely the DOM node | **Two-layer fallback, both layers measured:** Zotero chooses a **whole file** per locale and never merges files, so pinned to `["ko-KR"]` alone a missing key is `null`; Gecko then fills a missing **message** from the next locale, so pinned to `["ko-KR","en-US"]` it is the English string. **The raw identifier never renders**, so R-22's "a missing key degrades, never breaks" holds and a key-parity check belongs as a **warning**, not an error, until Phase 7. **Fallback exists only because the app chain ends in `en-US`** — code that formats in a chosen language (a Korean report on an English UI) must append `en-US` to its list. **This machine's default UI locale is Korean**, so any spec asserting an English label must pin the locale. `FR-56` needs no exception: the FTL registration has a real teardown, and it **throws** if an attached resource's probe message does not resolve |
| `V-18` | `update.json` delivery works end to end (v0.0.1 → v0.0.2) | `P0-T27` | **verified — R-15 retired** | `bb615ee`, `ad42bc8`. Real releases [v0.0.1](https://github.com/suppakoko/research_helper/releases/tag/v0.0.1) and [v0.0.2](https://github.com/suppakoko/research_helper/releases/tag/v0.0.2), published by GitHub Actions with the workflow's own token. Manifest reachable at the `update_url` **read out of the installed XPI**. **The measurement that matters:** a Zotero 10.0.2 running the *released* v0.0.1 (installed via `AddonManager.getInstallForURL` from the release asset, not a local build) was offered and installed v0.0.2 — `onUpdateAvailable` `0.0.1` → `0.0.2` with `sourceURI` = the v0.0.2 asset, `onUpdateFinished error: "0"`, `onInstallEnded` at `0.0.2`, then `isActive: true`, `pendingOperations: 0`: **a live upgrade with no restart**. A control run while only v0.0.1 existed returned `onNoUpdateAvailable`, so the positive result is not an artefact | **Criterion 4 fails as written and the defect is ours, not the toolchain's:** the published `update_hash` is **`sha512:`**, not `sha256:`, and it verifies exactly against the attached asset's SHA-512. Scaffold 0.9.2 hard-codes `generateHash(xpi,"sha512")` and `build.makeUpdateJson.hash` chooses only *whether* to emit a hash, never which algorithm. Zotero accepted it (`providesUpdatesSecurely: true`). The criterion's intent passes. **The manifest is served from a `release` branch, not a `release` tag** — `raw.githubusercontent.com` resolves a git ref and serves from the tree, while `zotero-plugin release`'s own model attaches `update.json` as a release *asset*, a different URL that would 404 here. Four operational facts for the runbook: `raw.githubusercontent.com` **caches the manifest for 300 s** (the first check after publishing returned `onNoUpdateAvailable` from the cached body); **CI never runs on the `release` branch** because GitHub suppresses runs for pushes made with the default `GITHUB_TOKEN`, so the manifest ref is unvalidated — which matters because §6.3's compatibility-bump lever asks people to hand-edit it; `AddonManager.UPDATE_WHEN_USER_REQUESTED === 1`, so code hard-coding `2` checks for the wrong reason; and `onCompatibilityUpdateAvailable` fires even when nothing is available |

### 2.1 `V-13` — abstract availability, per source

Query **`CRISPR base editing`**, 2024-01-01 … 2026-12-31. Re-run 2026-09-30 unless noted.

| Source | Hits | Fetched | With abstract | Shape | vs 2026-09-15 |
|---|---|---|---|---|---|
| PubMed | 8,284 | 100 | **100 %** | XML `AbstractText`, some structured with `Label=` | was 92 % (96/94/92 over three runs — treat ±4 as noise) |
| Europe PMC | 22,823 | 98 | **91.8 %** | JSON string; **33 of 93 contained inline HTML** | was 93 % |
| Crossref | 44,938 | 100 | **42 %** (49.9 % over the whole set) | JATS — a real XML parse is needed | unchanged |
| bioRxiv — DOI lookup | — | 5 | **100 %** | plain text with `O_SCPCAP`/`C_LIO_LI` tokens | **was unmeasurable** |
| bioRxiv / medRxiv — window sample | 183,179 / 51,045 | 100 each | 100 % (not the query — a window sample; no keyword search exists, `docs/02` §8.4) | as above | **was unmeasurable** |
| **Semantic Scholar** | — | — | ⬛ **PENDING — `P0-T21` is `TODO`. The key arrived 2026-09-30 (`G-03` closed, `ffcaf7a`) and the owner is running this leg. REPLACE THIS CELL WITH THE MEASURED PERCENTAGE.** | — | HTTP 429 on all 3 attempts, unchanged from 09-15 |
| arXiv | — | 0 | **blocked — HTTP 429, then HTTP 503 after a 30 s wait** | — | was 429 only |

**arXiv is blocked at their end, not by our pacing.** Seven requests over 14 minutes on 2026-09-15
all returned HTTP 429 with **no `Retry-After`**; the 2026-09-30 re-run returned 429 and then **503**,
which is an availability problem, not a rate limit a client can pace around. Re-probe from another
day or network before Phase 2 depends on it.

**A negative result was wrong, and re-probing is what caught it.** `docs/02` §8.5's "bioRxiv
`/details` is broken" was an **outage, not a design fault** — the same endpoint that returned an
empty HTTP 200 body on every request on 2026-09-15, *including the doc's own example URL*, answered
normally fifteen days later. The operational rule is unchanged either way: **treat an empty 200 body
as a failure and retry, never as "no results".** This is the phase's best argument for re-running a
cheap probe before trusting a negative.

---

## 3. Verdicts that are not clean passes

Three rows above carry a qualifier in the verdict cell rather than a footnote, because reading them
as passes would mislead a Phase 1–3 designer.

1. **`V-7` — two of four LLM providers were never called.** OpenAI and Anthropic direct remain
   unmeasured: no key was entered, by the owner's decision, and the probe skipped both legs
   cleanly. The specific header `V-7` names for Anthropic, `anthropic-version`, has never been
   sent. What *is* cleared is the premise for the D6 default provider (OpenRouter) plus Gemini
   direct and PubMed, so `docs/11` §4's stop-and-re-plan condition does not fire. Escalation 4a.
2. **`V-9` — the abort fired before the first byte.** Partial body 0 chars, so mid-stream
   cancellation and whether a partially streamed body stays readable are untested. The primitive
   works; the case Phase 3's job engine actually hits does not have a measurement.
3. **`V-13` — one source pending, one blocked.** `P0-T21` is the phase's one open card. The
   Semantic Scholar cell in §2.1 is a placeholder the coordinator replaces with one number; arXiv
   is separately unmeasurable for reasons at arXiv's end.

---

## 4. Zotero moved twice mid-phase, and what was not re-measured

Zotero went **10.0.1 → 10.0.2 → 10.0.3** during the phase, both times by **self-update during a
run**, not by anyone choosing to upgrade. The update is staged install-wide, so a profile's "no
updates" preference does not prevent it.

| Bump | When and how | Evidence |
|---|---|---|
| 10.0.1 → **10.0.2** | 2026-09-15, during `P0-T13`'s first run. A staged update had tried at 11:57:45 on 09-15 and its UAC prompt was cancelled at 11:59:47 — **which is why `P0-T08`'s `.scaffold/logs/` files were 0 bytes**: Zotero was relaunched by the updater, not by scaffold, and the stdout pipe was lost. At 13:18:13 the prompt reappeared, was approved within 2 seconds, and 10.0.2 installed | `BuildID=20260909185038`; `P0-T13` Findings |
| 10.0.2 → **10.0.3** | Between `P0-T26` (2026-09-29) and the `P0-T15`/`T16`/`T17` probe run (2026-09-30) | `P0-T15` Findings, `54b126c` |

**Findings dated before each bump were not re-measured.** `strict_max_version: "10.0.*"` admits all
three, and no version-refusal or regression was observed, but that is an argument from the absence
of a symptom, not a re-measurement.

- **Measured on 10.0.1 and never re-checked on 10.0.2 or 10.0.3:** `V-1` (the packaged-XPI install
  and the `extensions.json` evidence), `V-2` (hot reload, five cycles), `V-4`'s first failing run
  *and* its passing `P0-T33` re-run, `V-14`'s throttling measurement (a remote-service measurement
  in any case), and `V-6`'s runtime half via `P0-T10` (`collection.addItems()`, `undoAction`,
  transaction shape). `P0-T13`'s Findings state this in terms: *everything verified before
  2026-09-15 was on 10.0.1 and has not been re-checked.*
- **Measured on 10.0.2 and never re-checked on 10.0.3:** `V-3` (breakpoint over RDP), `V-5`,
  `V-8b`, `V-11`, `V-12`, `V-15`, `V-16`, `V-17`, `V-18`, and `V-13`'s first pass.
- **Measured on 10.0.3:** `V-7`, `V-8`, `V-9`.
- **Version-independent:** `V-6`'s compile-time probe, `V-13`'s re-run (it runs in Node, not in
  Zotero — and whether it was ever re-run *inside* Zotero through the `P0-T15` client, which
  `P0-T21`'s `Verify with` asks for, is not recorded).

**Consequence for R-1.** Three self-inflicted minor-version moves in three weeks, with no
observable breakage, is mild evidence *for* R-1's mitigation (a thin `src/zotero/*` adapter layer
plus a pinned `strict_max_version`) and says nothing about a **major** version. The scheduled
beta-channel CI job R-1 asks for does not exist yet.

---

## 5. Corpus defects found

Every row was found by **running code, not by re-reading prose**. The first two would have shipped
broken behaviour, and between them they are the strongest argument that this phase paid for itself.

| Document & section | What it says | What is actually true | Action |
|---|---|---|---|
| **`docs/06` §4.1 step 4** | A de-hyphenation regex for joining words split across a line break | **The rule was backwards and would have corrupted output.** A hyphenated line break arrives with the hyphen **deleted** and a newline in its place, never as `hyphen- ation`. The prescribed regex matched **18 strings in the corpus and all 18 were suspended hyphens** (`"N- and C-terminal"`, `"a- and b-wave"`): it would **corrupt 18 of 18 matches and repair none of the 66 real splits** | **Corrected `fc0b31e`.** The step now says so and leaves the replacement as a **Phase 3 decision**, because a lowercase-newline-lowercase rule is ambiguous with a real paragraph break |
| **`docs/01` §8.4** (with `docs/07` §7.4 checkpoint 3) | "Cancellation uses a standard `AbortController`" | **The plugin sandbox has no `AbortController`** — measured two independent ways in `P0-T08` (`globalThis` property lookup and bare-identifier `typeof`, in exact agreement), confirmed by `P0-T17`. Cancellation must go through `Zotero.HTTP.request`'s `cancellerReceiver`. §7.4's checkpoint 3 said cancellation is "passed as `AbortSignal` into the HTTP layer" while its own code excerpt used `cancellerReceiver` | **Corrected `e57ce04`, `54b126c`.** §8.4 now carries the measured `cancellerReceiver` result and the window-vs-sandbox boundary; the whole `fetch` reader is labelled window-only. Also absent from the sandbox: `structuredClone`, `queueMicrotask`, `console` (a stray `console.log` **throws**) and `performance` (so every NFR timing uses `Date.now()`). `setTimeout` **does** exist |
| `docs/09` §1.2 / §1.7 | A tier-1 `setTier1` using `removeLoginAsync` / `modifyLoginAsync` | Both are **`undefined`** on Zotero 10.0.2; §1.2 had described Zotero's `main` branch (already Zotero 11 on Firefox 153 ESR) as if it were the release. **`setTier1` would have thrown a `TypeError` the second time a key was saved** | Corrected to **feature-detect** (`1cbec7e`); `src/zotero/keychain.ts` does |
| `docs/01` §9.1, `docs/07` §2.2, `docs/08` §10 | Fluent bundles at `locale/<lang>/research-helper/<name>.ftl` | **Zotero 10's `registerLocales()` drops any subdirectory** under `locale/<locale>/`. Combined with `prefixFluentMessages` double-prefixing (`researchHelper-research-helper-…`) and `menuManager.js`'s `l10nFiles` option being commented out in 10.0.1, **every menu label rendered `label=""`** — and fixing any two of the three still yielded an empty label | Corrected to **flat** paths corpus-wide (`9d34a2a`, `694e977`); both scaffold prefix options set `false`. Found in `P0-T10`, split into `P0-T32` rather than widening that card |
| `docs/13` §1.4 | Scaffold `test.*` keys `timeout`, `abort`, `exit`, `reporter`, `startDelay` | **All five are type errors** (TS2353 / TS2561) and are **silently ignored at runtime**, so `npm run typecheck` is the only thing that catches a wrong key. The real keys are `entries`, `prefs`, `mocha.timeout`, `abortOnFail`, `watch`, `headless`, `startupDelay`, `waitForPlugin`, `hooks`; there is no `exit` and no `reporter`; `startupDelay` defaults to **1000**, not 10000; `waitForPlugin` must be a function *expression* (the runner `eval`s it, giving up after a fixed 10 s); `esbuildOptions` is an **array** | Corrected (`437b366`, `8ddaa5d`). The installed scaffold's **types win over its published docs** |
| `docs/13` §1.5 | `types: ["zotero-types","node"]`, `lib: ["ES2022","DOM","DOM.Iterable"]` | `entries/sandbox` already supplies six of the fifteen options; **`types` replaces rather than merges**, so the sandbox entry must be re-stated; `composite: true` from `entries/base` implies emitting; and **`lib` is `["ESNext"]` with no DOM, which is right** — a bootstrapped plugin's sandbox has no DOM. The strict flags were proved to *fire*, not merely to be set (a probe produced TS18048 and TS2375) | Corrected (`82926d3`). Revisit when UI `.ts` lands: the prefs pane and dialogs run in the `xhtml` context, which needs a **second tsconfig**, not a widened `lib` |
| `docs/01` §4.5 | `serve` passes `--purgecaches --no-remote` | Scaffold builds `["--purgecaches", "no-remote"]` — **no leading dash** — so Gecko treats it as a positional argument and the isolation is **not in effect** | Corrected (`e57ce04`). Operational rule: **close Zotero before `npm start`**, or `serve` may attach to the running production instance |
| `docs/01` §5.2 | `undoAction: 'undo-action-add-item'` | **That identifier does not exist.** `zotero.ftl` in `omni.ja` carries 30 `undo-action-*` keys and none is an add; confirmed resolving to `null` at runtime while `undo-action-add-to-collection` and `undo-action-edit-metadata` resolve | `undoAction` omitted rather than invented (`3a664f1`). Note `save()` inside a transaction takes no undo option at all |
| `docs/01` §11.2, `docs/13` §6.3 | `update_hash` is `sha256:` | It is **`sha512:`** — scaffold hard-codes `generateHash(xpi, "sha512")` and exposes no key to choose. Zotero accepted it (`providesUpdatesSecurely: true`) | Corrected (`bb615ee`) |
| `docs/13` §5.2 | Release workflow stages `git add ./*.json` | That would also stage `package.json`, `package-lock.json` and `tsconfig.json` **onto the manifest branch** | `release.yml` stages the two manifests by name; **the latent bug in §5.2 is still worth fixing there** |
| `docs/06` D-06-4 | A paragraph-structure guarantee | **Overstated.** The page mark held perfectly (`totalPages - 1` every time). The newline is **per-document**: the share of characters in 200-plus-character segments spans **0.85 → 0.39 → 0.00**. The chunker must **measure, not assume** | Corrected (`fc0b31e`) |
| `docs/13` §2.1 | A Vitest `Zotero` fake | It **did not compile** (`public id = FakeItem.nextId++` above `static nextId = 1` is TS2729 under this tsconfig), and it **diverges from real behaviour**: a real `new Zotero.Item()` has `id === null` until `save()`, is built with no type argument plus `fromJSON`, and `executeTransaction` runs begin/commit callbacks and queues behind other transactions | Both corrected (`73a71d6`, `99e41e2`). `docs/07` §2.2's tree also gained the missing `test/setup/` |
| `package.json` / `docs/13` §1.6 | `npm test` on a green tree | **It failed.** `test:contract` pointed at an empty directory and Vitest 5 exits **1** on "No test files found" — the intended no-op was a hard failure `P0-T14` would have wired straight into CI | `--passWithNoTests` added (`73a71d6`), to be removed once the directory has specs |
| `docs/02` §7.1, §8.5, §4.4, §5.4, §10.4 | Per-source request behaviour | arXiv 429 with **no `Retry-After`**, later 429-then-503; bioRxiv `/details` empty HTTP 200 (**later shown to be an outage** — §2.1); Europe PMC `PMC` records carrying no abstract despite `resultType=core`, inline HTML in a third of abstracts, and a gateway **504** §4.9 does not describe; Crossref's escaped entities; near-zero cross-source DOI overlap | All corrected as dated measurement notes (`73cb666`, `7c1af9a`) |
| `docs/09` §2.1 | Key redaction at the logger | Insufficient on its own: Zotero's `http.js` writes **the first 1024 characters of every string request body** to `Zotero.debug` **without `debug: true`**, so prompts and body-borne keys reach Debug Output. The client passes `logBodyLength: 0`, an option `docs/07` §7.4 does not list | **§2.1 should state the `logBodyLength: 0` requirement** — not yet written |
| `docs/04` §10.2 | WAV attachments | **Self-contradictory:** the table says `linkFromFile` always, the sketch three paragraphs later tests `bytes > 10 MiB`, and §10.4 argues *for* imported because sync carries imported attachments to the mobile apps | Implemented as the **size test** and **flagged for the owner** rather than silently chosen — §7 row 8 |
| `docs/04` §9.1 / §9.2 | Transliteration and number expansion are prerequisites for Korean TTS | **Measured as a quality improvement, not a prerequisite** — see `V-10` | §9.1 now carries the measurement (`b304792`) |
| `docs/01` §4.6 | Six removed toolkit APIs to strip; Node ≥ 22.8 | **Three of the eight day-one fixes were already done upstream** — only the menu API is still called in the template; `PreferencePane`/`ItemTree`/`ItemBox` already use the Zotero managers, `Shortcut` is already `ztoolkit.Keyboard`, `ReaderInstance` never appears. Node floor is effectively **≥ 22.13** | §4.6 flagged for correction; `package.json` declares ≥ 22.13 |
| `docs/01` §2.5 vs §4.4 | `rootURI` trailing slash | §2.5 was right: the measured value `jar:file:///…xpi!/` **already ends with a slash**, so `${rootURI}/content/…` produced `!//content/…`. Gecko tolerated it, but one file carried two conventions | §4.4 corrected (`f2cad58`) |
| `docs/06` §3.3.5, §4.3 | `getStructuredDocumentText` serialization; regex over flat text for sections | Full object contract now recorded in §3.3.5. §4.3 **should use `catalog.outline` and heading blocks instead of regex over flat text**, and **must not rest on `style.bold`** (not portable — see `V-8b`) | §3.3.5 corrected; §4.3 is a **Phase 3 design change, not made here** |

**Two scaffold bugs worth reporting upstream**, recorded rather than worked around silently: with
zero `.ftl` files the build writes `typings/i10n.d.ts` as an **empty union** (`export type
FluentMessageId =` followed by `;`), which is **TS1110** — and `// @ts-nocheck` suppresses semantic
errors only, so a fresh clone's `npm run build` then `npm run typecheck` fails while `typecheck`
alone passes; and `replaceDefine()` globs `addon/**/*` with **no extension filter**, reading every
match as UTF-8, so a binary containing a literal `__KEY__` byte sequence would be re-encoded and
corrupted (both icons round-trip byte-identically today, SHA-256 verified through the XPI).

**Also recorded, not a corpus defect:** `docs/13` §1.2 / §2.1's `src/platform/` tree, `docs/06`
§3.3.5's "not used in v1" and `docs/13` §1.1's `types/zotero-augment.d.ts` were **all corrected in
the corpus on 2026-09-09**, before this phase began, and are deliberately **not** re-reported here.

---

## 6. `> **Unverified:**` markers touched by this phase

| Document & section | Marker (short) | Resolution | Still open? |
|---|---|---|---|
| `docs/01` §4.5 | Scaffold 0.9.x RDP validated against Zotero 10 | **Yes.** Five hot-reload cycles over RDP on 10.0.1, each double-confirmed (`P0-T08`, `e57ce04`). §4.5's `--no-remote` claim corrected in the same pass | Retired |
| `docs/01` §5.2 | `undoAction: 'undo-action-add-item'` identifier | **Does not exist** — 30 `undo-action-*` keys in `zotero.ftl`, none an add; resolves to `null` (`P0-T10`) | Retired |
| `docs/01` §5.4 | `collection.addItems()` existence and save semantics on Zotero 10 | **Exists** on 10.0.1, schema 44, read out of `collection.js` in the shipped `omni.ja`: it calls `Zotero.DB.requireTransaction()` and needs no separate save on the collection. Deliberately **not used at creation time** — `item.setCollections([id])` before the single `save()` is one write instead of two; `addItems()` is the right call for Phase 1's add-*existing*-items path | Retired |
| `docs/01` §7.2 | Whether Zotero syncs plugin prefs | **Not answered.** `P0-T23` measured pref round-trip and cost but nothing about sync | **Open** |
| `docs/01` §8.3 | CSP on plugin XHTML loaded via `chrome://`; `fetch` from such a document | **Not answered — sidestepped by construction.** Every probe ran all network I/O in the privileged sandbox or the Run JavaScript window global, never from a dialog document, exactly as §8.3 requires. Nothing measured the CSP applied to plugin XHTML | **Open.** It becomes live when Phase 3 ships the prefs pane and dialogs |
| `docs/01` §8.4 | `res.body` streamable, `TextDecoderStream` present, `AbortController` aborts | **All three answered, and the answer is split by context** (`P0-T16`/`P0-T17`, 2026-09-30). In the Run JavaScript **window** global: `res.body` is a live `ReadableStream` — yes, 43 chunks, first at t+628 ms; `TextDecoderStream` exists — yes; `AbortController` aborts the channel — yes, `AbortError` 0 ms after `abort()`. **None of it transfers to the plugin sandbox**, where §2.3 measured `AbortController` absent. The sandbox-viable path is the XHR one, measured on the same run | Retired, and replaced with the three-way answer |
| `docs/01` §9.2 | Which `Localization` argument form to use for plugin `.ftl` files | **The resource id is the bare filename**, and both the synchronous `Localization(["research-helper-mainWindow.ftl"], true).formatMessagesSync` form and `document.l10n.formatMessages` work and agree (`P0-T32`) | Retired |
| `docs/06` §3.3.5 | Serialization of `getStructuredDocumentText` | **Decoded and recorded** — full object contract now in §3.3.5: page boxes per block, run boxes with per-character widths, `bold`/`italic` flags, heading-block classification, and a `catalog.outline` that is `native` or inferred (`P0-T18`) | Retired |
| `docs/07` §1.2 | Exact `strict_max_version` string Zotero 10 expects | **`"10.0.*"`** — the packed manifest carried it and the profile's `extensions.json` reported `appDisabled: false` with `maxVersion: "10.0.*"` (`P0-T09`) | Retired |
| `docs/13` §1.1 | `zotero-types` coverage of the Zotero 10 surface | **Broadly accurate, lags in six places, four of which this plugin hits.** 15 baseline errors → 0 after `typings/zotero-augment.d.ts`; five augmented blocks; four holes augmentation cannot close; three cases wrong rather than missing (`P0-T06`) | Retired; the augmentation file is the standing remedy |
| `docs/13` §1.4 | Scaffold `test.*` config key names; `esbuildOptions` shape; `{{version}}` templating | **Types win over the published docs** on all five key names (`P0-T02`, `P0-T13`); `esbuildOptions` is an array; every manifest placeholder substituted correctly in the built XPI, including `strict_max_version` and the `release`-branch `update_url` (`P0-T02`) | Retired |
| `docs/13` §1.5 | Gecko/Firefox baseline under Zotero 10 (`firefox140` candidate) | **Confirmed.** `target: "firefox140"` builds, and the bundle installs, enables and runs on 10.0.1/10.0.2/10.0.3; Gecko measures **140.15.0** (`P0-T23`). The conservative `firefox115` fallback is not needed | Retired |
| `docs/13` §2.1 | `Zotero.DB.executeTransaction` / `Zotero.Item` construction signatures | **Measured.** One `executeTransaction` around 100 `save()` calls; begin callback counts exactly one transaction; overlapping commands **serialise on the DB** (`Waiting for DB transaction … to finish`) rather than deadlocking; a real `new Zotero.Item()` has `id === null` until `save()` and is built with no type argument plus `fromJSON` (`P0-T10`, `P0-T20`) | Retired; the fake was corrected to match |
| `docs/13` §2.3 | Whether a plugin-consumable `Zotero.Test` API exists | **Not answered, and not needed.** Nothing in this phase looked for one; the scaffold's runner injects Mocha 12.0.1 and chai from jsDelivr/chaijs.com, and `V-5` passed without any Zotero-provided test API. §2.3's own instruction — "do not depend on it" — was followed | **Open**, as a bonus that was never sought |
| `docs/13` §5.1 | Whether `zotero-plugin test` provisions Zotero in CI | **Answered: provision it yourself.** The runner downloads Zotero only when it believes it is on CI *and* `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` is unset — then it `sudo apt`s Xvfb and `wget`s the latest **beta** tarball. `ci.yml` pins a 10.0.2 build and sets the env var, provisioning in 5 s, so scaffold never fell back to the beta channel (`P0-T13`, `P0-T14`) | Retired |

**Markers this phase deliberately left open, and said so:**

- `docs/13` §6.3 — how Zotero reconciles a **widened `strict_max_version`** in the update manifest
  against the narrower value inside an installed XPI. `P0-T27` states it is **not retired**: testing
  it means publishing a range this project is forbidden to claim (`docs/01` §11.3). A separate card
  should exercise it with something like `10.1.*`, never `11.x`.
- `docs/04` §4.2's `> **Unverified:**` on the TTS token rate **is retired for this model only** —
  24.998 output tokens/second measured on `gemini-2.5-flash-preview-tts`. Other models inherit the
  uncertainty.
- `src/hooks.ts`'s own marker on `Zotero.PreferencePanes.pluginPanes` is retired and **replaced with
  a narrower one**: `reportSurvivors()` ran on all five shutdowns and its `catch` never fired, which
  proves the property exists and enumerates — **not** that it is ever populated for us, because
  nothing registers a pane yet.

---

## 7. Decisions forced, and owner decisions raised

| # | Trigger | Decision needed | Owner | Status |
|---|---|---|---|---|
| 1 | `V-8b` (R-19b) | Ship whole-document chunking, or flip `summary.fullTextMode` back to abstracts | Product owner | **DOES NOT FIRE.** Font/layout geometry **is** available, and the document worker additionally classifies heading blocks and emits a section outline, so IMRaD detection is feasible. **R-19b's 40-PDF accuracy gate stands unchanged and `auto` must stay on whole-document chunking until it passes** — block classification was **wrong on three of four articles**, and `V-8b` measured feasibility, never accuracy. Gates `G-12` (assemble the corpus) and `G-22` (rule on the outcome) remain open and on Phase 3's critical path |
| 2 | `V-10` (R-8) | Change TTS provider, or reduce Feature 5 to the FR-43 text fallback | Product owner | **DOES NOT FIRE.** The owner, a native Korean speaker, judged the full 108 s briefing good and usable as shipped (2026-09-30, gate `G-11` satisfied). Gemini TTS stays the audio path; no provider re-evaluation is raised. Scope: one script, one voice, one model, one listener |
| 3 | `V-16`'s Linux-without-libsecret branch was **never reachable on a Windows machine** | From `docs/09` §1.7's ladder: **tier 2 session-only** (keys re-entered each launch, unattended background jobs stop working) or **tier 3 passphrase-encrypted file** — and separately, whether the passphrase tier ships in v1 at all (`docs/09` §8 item 2). Tier 4, plaintext prefs, is not a choice (D5) | **Product owner — gate `G-10`** | **🔴 LIVE ESCALATION.** `docs/11` §5's "Before Phase 0 ends" row is **still open** and Phase 0 is ending. Only a *simulated* throwing `encrypt()` was exercised; an unavailable keystore could not be produced. Gate **`G-09`** — a libsecret-less Linux box, and a macOS machine — never materialised, so **`G-10` has no measurement behind it**, and a Windows-only `V-16` cannot close `docs/09` §8 items 1 or 2. Blocks Phase 3's `SecretStore` spec beyond tier 1 and leaves the prefs-pane backend badge with no degraded state to render |
| 4 | `V-7` failed (R-13) | **Stop and re-plan before Phase 1** — the client-side, no-backend premise is invalid | Product owner | **DOES NOT FIRE.** OpenRouter (the D6 default), Gemini direct and PubMed all returned full responses with custom headers demonstrably arriving. `docs/11` §4's stop-and-re-plan condition is cleared |
| **4a** | `V-7` is **unmeasured for OpenAI and Anthropic direct** — no key entered, by the owner's decision | Accept the two provider legs as unmeasured until their Phase 3 adapter cards, or run them before Phase 1's design is frozen. **The `anthropic-version` header `V-7` names has never been sent**, and Anthropic's is the one auth shape that differs structurally from the other three | **Product owner** | **🟠 RAISED.** Low risk — the OpenRouter path proves arbitrary cross-origin POSTs with arbitrary headers work from the Zotero process, so a per-provider failure would be that provider's rejection, not a platform restriction. But `docs/11` §4.2's `V-7` says **all four**, and two are blank. Cheap to close: one probe run, two dialogs, under $0.001 |
| 5 | `V-2` hot reload unavailable (R-11) | Accept proxy-file + manual restarts as the development loop | Developer | **DOES NOT FIRE.** Hot reload works; `server.asProxy` was never touched and the proxy-file fallback was never needed. `docs/11` §1's "editing a source file reloads without a manual restart" stands as written |
| 6 | `V-5` in-Zotero tests not automatable on CI | Integration tests become manual release QA on all platforms; `docs/13` §2.3 and §5.1 change | Developer | **DOES NOT FIRE.** Headless in-Zotero tests passed on GitHub Actions `ubuntu-24.04` twice. `docs/13`'s test strategy stands. Two residual developer decisions: when to drop `continue-on-error: true`, and whether to pin Mocha/chai rather than fetch them unpinned from a CDN at runtime |
| 7 | Copyright holder string for `LICENSE` (D8) | Name to use | Product owner | **CLOSED.** `LICENSE` reads `Copyright (c) 2026 suppakoko` (`df15816`, owner-approved). Gate `G-32` (institutional IP confirmation) closed 2026-09-09 |
| 8 | `docs/04` §10.2 contradicts itself on WAV attachment mode | Imported (syncs to the mobile apps, but the data-directory copy remains **in addition to** Zotero's storage copy, so a short clip is stored twice) or linked — and whether the source file is deleted after import | **Product owner** | **🟠 RAISED.** `P0-T26` implemented the **size test** from §10.2's sketch (short clips imported, a ~29 MB ten-minute WAV linked) and flagged it rather than silently choosing. Whether the source is deleted after import is explicitly deferred to Phase 6 |
| 9 | `V-15` — the R-19 quality gate passes all seven corpus files, **and that is the problem** | Fix the definition of `docs/06` §4.1 step 8's OCR ratio, and set the two thresholds the corpus never fixes | Design decision for Phase 3 | **🟠 RAISED.** Two of the gate's four thresholds are fixed nowhere in the corpus and are marked `PROPOSAL` in code (minimum 1,500 characters; letters/total ≥ 0.60). Across real documents the OCR measure spans **0.834–0.852** against a 0.80 threshold and **the scanned page is not the minimum**, so the gate separates almost nothing; under §4.1's other possible reading (whitespace counted) every file scores 0.999–1.000 and the check is **inert**. It also misses the corpus's one real defect — a file that passes everything while being hard-wrapped with **47 words split in half**. And **R-19's "scanned means demote" instinct is wrong**: the BMJ scan's OCR layer is good prose, and demoting it would throw away usable text |
| 10 | `V-9` — mid-stream cancellation untested | Run a cheap re-probe with a later abort point before Phase 3's job engine relies on partial output | Developer | **🟠 RAISED.** One probe run, no new key needed |
| 11 | `V-13` — arXiv unmeasurable (429 then 503), `P0-T21` still `TODO` | Re-probe arXiv from another day or network before Phase 2 depends on it; complete the Semantic Scholar leg | Developer / coordinator | **🟠 OPEN.** Does not block Phase 1: PubMed is Phase 1's only source and measured 100 % |
| 12 | `P0-T27` left two throwaway public releases and a permanent `release` branch | Keep or delete v0.0.1/v0.0.2 — **deleting v0.0.2 would leave the published `update_link` pointing at a 404**, so the manifest must be deleted or re-published in the same pass. The `release` branch is permanent infrastructure the shipped `update_url` depends on | Product owner | **🟠 RAISED** (gate `G-40` approved the releases; their disposal was not decided). `package.json` on `main` is at **0.0.2**, matching the newest tag, which is the correct post-release invariant |
| 13 | `P0-T30` — the XPI ships `addon/content/icons/README.md` (11.9 KB) because `build.assets` is `addon/**/*.*` | Narrow the asset glob | Developer | **🟠 RAISED.** Harmless against NFR-18 today, but the same rule ships every future `.md` under `addon/` to every user |

**Nothing in `docs/11` §4 was left unanswerable for want of a decision.** The two rows that could
have stopped the plan — `V-7` and `V-10` — both cleared, and `docs/11` §4's closing instruction
("if `V-7` or `V-10` fails, stop and re-plan before Phase 1") does not engage.

---

## 8. Effort actual vs plan

**Read this section before quoting any number from it.** `docs/11`'s estimates are **human
developer-days** — "one experienced developer, new to Zotero plugin development, one focused 6-hour
day" (`docs/11` §1 preamble, `plan/README.md` §7). **Phase 0 was not executed that way.** It was
executed by **AI agents under the project owner's direction**, with the owner acting only as
approver and as the human for gated steps (creating the dev profile, entering keys, listening to
Korean audio, downloading a publisher PDF, submitting the Semantic Scholar application, approving
the throwaway releases). No human developer-day was spent building any of it.

| | Value |
|---|---|
| `docs/11` §1 Phase 0 estimate, as §1 now stands | **16–22 developer-days**, stated as "measured — the 30 task cards … sum to 16.0 d" |
| `docs/11` §4's closing paragraph, same document | **15.5–22 d**, "the 28 cards sum to 15.5 d" — **§1 and §4 do not agree with each other** |
| `plan/01`'s "Estimate reconciliation" section | **15.5 d / 28 cards** |
| `plan/00-task-index.md` §1 | **17.25 d / 33 cards** |
| **Actual card sum, recomputed from the 33 cards** | **17.25 d** — arithmetic confirmed card by card. `plan/00` is right; `docs/11` §1 and §4 and `plan/01`'s reconciliation are all stale |
| `docs/11` §4's sum of listed spike timeboxes | 10.75 d |
| Superseded `docs/11` §1 estimate, for reference | 6–9 d |
| **Actual elapsed human developer-days** | **Not measured, and not measurable from this phase.** See below |
| Actual calendar span | **21 days**, 2026-09-10 → 2026-09-30; 62 commits on **7 distinct days** (09-10, 09-14, 09-15, 09-16, 09-21, 09-29, 09-30) |
| Actual ÷ 17.25 — the observed correction factor (R-23) | **Cannot be computed.** The numerator would be agent wall-clock and the denominator is human developer-days; the ratio would be a category error dressed as a measurement |
| Does `docs/11` §1's effort summary need re-deriving again? | **Yes — for card-set reasons, not for effort reasons.** See below |

### 8.1 What actually happened, and what it does not tell us

Agents executed the cards across 21 calendar days, in bursts rather than continuously — seven days
carry commits and fourteen carry none, and several of the gaps are the owner's turnaround on a gate
(`P0-T25`'s native-speaker judgement took from 2026-09-21 to 2026-09-30; `P0-T22`'s key application
took from on-or-before 09-15 to 09-30) rather than work in progress. **R-23's standing instruction
to "record actual days against each card from `P0-T01` onward" was not followed:** no per-card
elapsed time was recorded by anybody, so even the agent-side figure is only reconstructible to
day granularity from `git log`.

**This gives no evidence either way about R-23's ×1.50 factor for Phases 4–7.** The factor is a
ratio of *decomposed card sums* to *prior phase-level human estimates*; validating or refuting it
requires a human-day measurement of work a human did. Phase 0 produced neither the numerator nor a
comparable denominator. Reporting 21 calendar days, or 7 active days, against "15.5–22 developer-days"
would compare an agent's wall-clock to a human's focused-day estimate and conclude something about
neither. **Phases 4–7's four scaled figures therefore remain exactly what `docs/11` §1 already calls
them — inference — and R-23 stays live and undischarged for them.**

**What would settle it.** One of:

1. A human developer executing a *decomposed* phase (Phase 1 is the next candidate) and logging
   **per-card hours** against each card's estimate, in focused 6-hour days, with review latency and
   external waits excluded per `plan/README.md` §7. That is the only measurement that speaks to
   `docs/11`'s unit directly.
2. Failing that, a deliberate, stated conversion: record **per-card agent session time** *and*
   **per-card owner time** from `P1-T01` onward as two separate columns, never summed, and treat
   the owner column alone as the human-day series. Even then it measures review-and-gate effort,
   not construction effort, so it can bound the human cost from below but cannot validate ×1.50.
3. A parallel execution of a handful of cards both ways, which is the only clean way to get a
   ratio — and is probably not worth the spend.

Until one of those exists, `docs/11` R-23's mitigation stands unchanged: **plan against the top of
each band**, decompose each of Phases 4–7 at the end of the phase before it, and replace each
scaled figure with a card sum.

### 8.2 The one estimation finding Phase 0 *does* support

It is about **card sets, not day rates**, and it is the same mechanism R-23 already names.

**Five cards were discovered mid-phase, by running the code**, and they add **1.75 d — 10 % of the
phase's final 17.25 d sum** — that no decomposition pass predicted:

| Card | Est. | Why it did not exist on 2026-09-09 |
|---|---|---|
| `P0-T29` | 0.25 d | `P0-T01` found git would rewrite the corpus to CRLF on checkout; fixing the local working copy fixes one machine |
| `P0-T30` | 0.25 d | The built manifest referenced an icon that did not exist |
| `P0-T31` | 0.25 d | `P0-T07` found the teardown registry was bypassable and `eslint.config.js` was outside its `Files` |
| `P0-T32` | 0.50 d | `P0-T10` found every menu label rendering `label=""`, from three independent causes |
| `P0-T33` | 0.50 d | `P0-T11` found `ZoteroToolkit` leaking on every cycle — a defect five passing checkboxes could not see |

Every one obeyed `plan/README.md` §5 rule 2: the discovering card **stopped and wrote a new card**
rather than widening its own scope. That is the rule working, and it is also the measurement — even
a phase decomposed to 28 cards was 5 cards short, and the shortfall was only visible once code ran.
**This is R-23's mechanism in miniature and it strengthens, without quantifying, the case that
undecomposed Phases 4–7 hide unpriced work.**

### 8.3 What `docs/11` §1 needs, mechanically

Not an effort re-estimate — a **card-sum re-derivation**, which `plan/README.md` §7 already
prescribes and which the coordinator, not this report, performs:

- Phase 0's card sum is **17.25 d**, not 16.0 d and not 15.5 d. Low end = 17.25;
  high end = 17.25 × 1.4 = 24.15 → **24**. So the row becomes **17.25–24 d**, up from 16–22.
- That moves the Phases 0–3 subtotal from 82.5 to **83.75** low and from 115 to **117** high, and
  the whole-plan total from 156–217 to **157.25–219**.
- `docs/11` §1's Phase 0 entry, its effort-summary table row and card count, §2's Mermaid label and
  §2's critical path (P0 → P1 → P2 → P4 → P6 → P7, currently 111.5–155) all re-derive from it.
- `docs/11` §1 and §4 currently state **different** Phase 0 figures (16–22 / 30 cards versus
  15.5–22 / 28 cards) and `plan/01`'s own reconciliation section states a third. All four places
  must end up quoting 17.25 / 33.
- **The ×1.50 factor is untouched by this**, and deliberately so: `docs/11` §1 already records that
  it recomputed to 1.548 and then 1.577 and was **held at 1.50** because moving an inferred figure
  on a 1.5-day change to a measured one is false precision. A 1.75-day change is the same argument.

---

## 9. Phase 0 definition of done

`docs/11` §1's five criteria, each against evidence above.

| Criterion | Status |
|---|---|
| `npm run build` produces an installable XPI; dragging it into Zotero 10.0.1 → Tools → Plugins installs cleanly on Windows | **Met, with one deviation.** The XPI installs and enables, verified from the dev profile's own `extensions.json` (`V-1`) rather than by a human at the install dialog, and **into the dev profile, not the real one** — `P0-T09`'s `Do NOT` required the dev profile and no real-profile check was requested. Gate `G-08` still owes the by-hand install |
| Editing a source file reloads the plugin in the running Zotero without a manual restart | **Met** — `V-2`, five double-confirmed cycles |
| Disabling the plugin leaves no menu item, no observer, and no error in the debug log (FR-56) | **Met, after `P0-T33`.** `V-4`: zero residue across five real disable/enable cycles plus uninstall, on the built XPI, twice from a clean profile. It was **not** met before the toolkit was removed, and the five checkboxes could not see why |
| CI is green on a clean clone | **Met** — `V-5`, four jobs green on `npm ci`, plus the headless in-Zotero job. The build job was **proved to fail** when it should (temporary size ceiling → `build` failing at "Assert XPI was produced", dependent job skipped) and to pass again after a byte-identical revert |
| The spike report is committed and every item in `docs/11` §4 is marked verified / worked-around / blocked | **This file.** All 19 ids including `V-8b` carry a verdict and evidence. **One verdict is incomplete:** `V-13`'s Semantic Scholar cell is a marked placeholder while `P0-T21` is `TODO` |

**Phase 0 is done except for `P0-T21`'s Semantic Scholar leg**, and the standing escalation `G-10`
crosses the phase boundary into Phase 3.

---

## 10. Reproducing these findings

Everything cited here is in the repository, per R-21. The probes are `scripts/spike-network.ts`
(HTTP, SSE, abort — emits a paste block for Tools → Developer → Run JavaScript),
`scripts/spike-abstract-coverage.ts` (`V-13`, runs in Node; reads `SEMANTIC_SCHOLAR_API_KEY` from
the **process environment** only and prints whether a key was sent, never its value),
`scripts/spike-tts-korean.ts` (`V-10`) and `scripts/probe-types.ts` (`V-6`). The PDF corpus's item
IDs, keys and SHA-256s are in `test/fixtures/pdf/README.md`; **the PDFs themselves are not
committed** (publisher content, `docs/09` §4.4), and the arXiv control is under arXiv's
non-exclusive licence, so it is local-testing only. Each card's `Findings` block in
`plan/01-phase-0-toolchain-spike.md` carries the full numbers this report compresses.

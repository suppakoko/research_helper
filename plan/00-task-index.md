# 00 — Task Index

> **Generated from the task cards in `01`–`04`.** If a row here disagrees with a
> card, the card wins — then regenerate this file.
> **Last updated:** 2026-10-13 · **140 tasks: 85 `DONE`, 55 `TODO`.** Phase 0 is **34 of 35** — one open card, `P0-T35`, a re-probe of cancellation with the abort fired after the first byte. Phase 1 is **44 of 46 `DONE`**, Phase 2 **7 of 28**, Phase 3 **0 of 31**. **The plan has grown from the 98 cards the four independent decompositions produced (`docs/11` §1's own account) to 140, so 42 of them exist because running the code found work no reading of the corpus had** — and the count keeps rising for the same reason each time, which is the measurement `docs/11`'s risk R-23 is about. Counts here are re-derived from the cards' `State` rows, never incremented by hand.

---

## 1. Status

Implementation has started. Thirty-one tasks are `DONE` as of 2026-09-30 — `P0-T01`,
`P0-T29`, `P0-T02`, `P0-T03`, `P0-T04`, `P0-T05`, `P0-T06`, `P0-T07` and
`P0-T30` (commits `df15816`, `010ede3`, `437b366`, `500cf7b`, `82926d3`,
`0675412`, `73a71d6`), plus `P0-T12` and `P0-T31`, and on 2026-09-14 `P0-T09`, `P0-T10` and
`P0-T32` (`f2cad58`, `3a664f1`, `694e977`), and on 2026-09-15 `P0-T11`, `P0-T33`, `P0-T08` and
`P0-T22` (`a50930a`, `5132b33`, `c286ae9`), then `P0-T13` (`8ddaa5d`) and `P0-T20` (`99e41e2`), and `P0-T14`, `P0-T23`, `P0-T24`
(`6a3a17f`, `1cbec7e`, `88cdfe1`), and `P0-T18` and `P0-T19` on 2026-09-16 (`c7b49d8`, `bf2a225`, `fc0b31e`), `P0-T27` (`bb615ee`), and `P0-T25` and `P0-T26` on 2026-09-30
(`bfc4675`, `b304792`); every other task is `TODO`. Only a human sets a task to `DONE`
(`README.md` §4), so this file will not drift on its own.

| Phase | Tasks | Task-sum estimate | `docs/11` figure (revised 2026-09-09) | Superseded figure |
|---|---|---|---|---|
| 0 — Toolchain spike | 35 | 17.75 d | 17.75–25 d | 6–9 d (+97%) |
| 1 — PubMed slice | 46 | 29.25 d | 29.25–41 d | 9–12 d (+144%) |
| 2 — Multi-source + dedup | 28 | 28.50 d | 28.50–40 d | 12–16 d (+78%) |
| 3 — LLM + summaries | 31 | 23.50 d | 23.5–33 d | 12–15 d (+57%) |
| **Phases 0–3** | **140** | **99.00 d** | **99.00–139 d** | 39–52 d (+90% over the top of the band) |
| 4–7 | not decomposed | — | 73.5–102 d ⚠ **scaled, not measured** | 35–49 d |

**Two Phase 3 cards were re-estimated on 2026-09-09, after the roadmap correction below.**
`P3-T04` moved from 1.0 d to **1.75 d** and `P3-T20` from 1.0 d to **1.75 d**. Both had been
flagged by two independent review rounds as knowingly priced below their own `Do` steps —
`P3-T04` because it grew to carry the four `<provider>.baseUrl` controls, the NCBI and Semantic
Scholar key fields and six `role="status"` elements without its figure moving (`plan/04` §4
item 9), and `P3-T20` because assembling and adjudicating a 40-PDF corpus across eight publisher
families is, in that card's own words, "the single most expensive card in the phase that
produces no shipped code". The owner decided to re-estimate rather than to accept them, because
leaving them optimistic would contradict the same-day roadmap correction and `docs/11`'s risk
**R-23**. Each card's `Notes` now carries the derivation. Phase 3's sum is **23.50 d**, the
Phases 0–3 subtotal is **82.50 d** (**84.25 d** since `P0-T31`–`P0-T35` were added, 2026-09-10 to 2026-09-30), and `docs/11` §1's Phase 3 band, its effort summary, its
total and months figure, and §2's dependency graph and critical path were all re-derived from
those numbers. **No other card's estimate was changed**, and `P3-T20`'s figure counts developer
work only — the human's PDF sourcing and ground-truth adjudication is gate **G-12** in
[`06-human-gates.md`](06-human-gates.md), not developer-days.

**Phase 2 gained two cards on 2026-09-09.** `docs/11` §1 listed FR-12's re-run control and the
`useTranslators` Strategy B import path as Phase 2 deliverables while warning, in the phase
entry itself, that neither was in `plan/03`'s card set or in its 21.5 d sum. They are now
`P2-T17` (1.5 d) and `P2-T18` (1.25 d), the sum is **24.25 d**, and `docs/11` §1's Phase 2 row,
effort-summary total, §2 Mermaid labels and §2 critical path were re-derived from it. **No
existing card's estimate was changed**; the sum moved because the card set grew by two.

**The divergence was a finding, and it has been acted on.** Four independent
agents decomposed four phases without seeing each other's numbers and all four
landed 30–72% above `docs/11`. In every case the overrun is in work `docs/11`
lists as a phase deliverable but never priced: repository bootstrap and the
directory skeleton (Phase 0), the shared core that Phases 2–3 then reuse
(Phase 1), the query parser, fan-out, backfill and UI (Phase 2), secret storage
and text acquisition (Phase 3). Per `README.md` §7 the correct response was to
re-estimate `docs/11`, not to shave the tasks, and **that is what happened on
2026-09-09** — no card was shaved, and that correction pass changed no card
estimate at all. (Two Phase 3 cards were later re-estimated *upward* the same
day, per the note above; that is the same rule applied in the same direction,
not a reversal of it.) The phase figures above
are therefore no longer a comparison: `docs/11` §1's Phases 0–3 bands are now
*derived from* these sums (low end = the sum, high end = the sum × 1.4). See
`docs/11` §1 "Why these figures changed" for the derivation, the whole-plan
total and the months figure — **this file does not restate them.**

⚠ **Phases 4–7 are scaled, not measured.** They have no cards, so `docs/11`
scaled their old figures by the ×1.50 correction factor observed here. Those
four numbers are inference. When a phase is decomposed, its card sum replaces
the scaled figure in `docs/11` §1 and this table gains a row. Risk R-23 in
`docs/11` §3 tracks the residual.

## 2. How to use this file

1. Pick the topmost task whose `Depends on` are all `DONE`.
2. Open its card in the phase file and follow `README.md` §5's execution protocol.
3. A 🔒 means the task cannot complete without a human — see
   [`06-human-gates.md`](06-human-gates.md) before starting it, not on reaching it.

**Start here:** `P0-T01`, and **on the same day** `P0-T22` — the Semantic Scholar
API key application. It has no dependencies, takes 15 minutes, and its approval
queue is what gates Phase 5 months later (`docs/11` R-3).

## 3. Entry points and terminals

**Tasks with no dependencies** (can start immediately, subject to their gate):
`P0-T01`, `P0-T22`, `P1-T01`, `P2-T15`, `P3-T01`, `P3-T18`, `P3-T24`.

**Phase terminals** (a phase is done when its terminal is `DONE`):
`P0-T28`, `P1-T23`, `P2-T15`/`P2-T16`, `P3-T31`.

`P2-T15` is both, and deliberately so: it records a decision that was settled
upstream rather than building anything, so it waits on no card and no card waits
on it. Phase 2 is done when `P2-T16` and `P2-T15` are both `DONE`.

## 4. The tasks

**✅** on a task ID means the card's `State` is `DONE`. **🔒** in the Gate
column means the card cannot complete without a human — read
[`06-human-gates.md`](06-human-gates.md) before starting it, not on reaching it.

### Phase 0

| Task | Title | Depends on | Est. | Gate |
|---|---|---|---|---|
| ✅ `P0-T01` | Initialise the repository, licence and ignore rules | — | 0.25 d |  |
| ✅ `P0-T02` | Scaffold from the template and re-baseline it | `P0-T01`, `P0-T29` | 1.0 d |  |
| ✅ `P0-T03` | Write the Zotero 10 manifest and pin the plugin identity | `P0-T02` | 0.25 d |  |
| ✅ `P0-T04` | Lay out the directory skeleton and dependency rule | `P0-T02` | 0.5 d |  |
| ✅ `P0-T05` | TypeScript config, npm scripts and a green typecheck | `P0-T04` | 0.25 d |  |
| ✅ `P0-T06` | Verify `zotero-types` against the Zotero 10 API surface | `P0-T05` | 0.5 d |  |
| ✅ `P0-T07` | `bootstrap.js` lifecycle and a central teardown registry | `P0-T05`, `P0-T06` | 0.5 d |  |
| ✅ `P0-T08` | Dev profile, `.env`, hot reload and debugger attach | `P0-T07` | 0.75 d | 🔒 |
| ✅ `P0-T09` | Build the first XPI and install it on Zotero 10.0.1 | `P0-T03`, `P0-T07`, `P0-T30` | 0.25 d | 🔒 |
| ✅ `P0-T10` | Tools-menu item that creates a `journalArticle` | `P0-T08`, `P0-T31` | 0.75 d |  |
| ✅ `P0-T11` | Prove clean teardown across five disable/enable cycles | `P0-T10`, `P0-T32`, `P0-T33` | 0.5 d | 🔒 |
| ✅ `P0-T12` | First Node unit test under Vitest | `P0-T05` | 0.5 d |  |
| ✅ `P0-T13` | First in-Zotero Mocha test via the scaffold runner | `P0-T08`, `P0-T11` | 1.0 d |  |
| ✅ `P0-T14` | CI workflow: lint, typecheck, unit test, build XPI | `P0-T12`, `P0-T13` | 0.75 d |  |
| ✅ `P0-T15` | Cross-origin POST with custom headers from inside Zotero | `P0-T08` | 1.0 d | 🔒 |
| ✅ `P0-T16` | Streaming (SSE) consumption from inside Zotero | `P0-T15` | 0.5 d |  |
| ✅ `P0-T17` | Request abortion | `P0-T15` | 0.25 d |  |
| ✅ `P0-T18` | `getStructuredDocumentText` and IMRaD feasibility | `P0-T08` | 0.5 d | 🔒 |
| ✅ `P0-T19` | Read Zotero's existing full-text index from a plugin | `P0-T18` | 0.75 d |  |
| ✅ `P0-T20` | Create 100 Zotero items in one transaction within NFR-1 | `P0-T10` | 0.5 d |  |
| ✅ `P0-T21` | Measure abstract availability across the seven sources | `P0-T08` | 0.5 d |  |
| ✅ `P0-T22` | Measure S2 throttling and submit the key application | — | 0.25 d | 🔒 |
| ✅ `P0-T23` | OS keystore and preference round-trip | `P0-T08` | 0.5 d |  |
| ✅ `P0-T24` | Fluent localization with an `en-US` and `ko-KR` bundle | `P0-T08`, `P0-T10`, `P0-T32` | 0.5 d |  |
| ✅ `P0-T25` | Gemini TTS Korean quality spike | `P0-T15` | 1.0 d | 🔒 |
| ✅ `P0-T26` | Binary/audio response handling and attachment | `P0-T25` | 0.5 d |  |
| ✅ `P0-T27` | `update.json` delivery dry run | `P0-T09`, `P0-T14` | 0.5 d | 🔒 |
| ✅ `P0-T28` | Write and commit the Phase 0 spike report | `P0-T14`, `P0-T15`, `P0-T16`, `P0-T17`, `P0-T18`, `P0-T19`, `P0-T20`, `P0-T21`, `P0-T22`, `P0-T23`, `P0-T24`, `P0-T25`, `P0-T26`, `P0-T27` | 0.5 d | 🔒 |
| ✅ `P0-T29` | Pin line endings with `.gitattributes` | `P0-T01` | 0.25 d |  |
| ✅ `P0-T30` | Create the plugin icon assets | `P0-T04` | 0.25 d |  |
| ✅ `P0-T31` | Make unscoped platform registration a lint error | `P0-T07` | 0.25 d |  |
| ✅ `P0-T32` | Make the plugin's Fluent messages actually resolve | `P0-T10` | 0.5 d |  |
| ✅ `P0-T33` | Stop constructing `ZoteroToolkit`, which leaks on every cycle | `P0-T32` | 0.5 d |  |
| ✅ `P0-T34` | Narrow `build.assets` so the XPI ships only what a user needs | `P0-T30` | 0.25 d |  |
| `P0-T35` | Re-probe cancellation with the abort fired after the first… | `P0-T17` | 0.25 d |  |

**Nine of Phase 0's 35 cards carry a gate**, not fourteen: `P0-T08`, `P0-T09`,
`P0-T11`, `P0-T15`, `P0-T18`, `P0-T22`, `P0-T25`, `P0-T27`, `P0-T28`. An earlier
generation of this table also marked `P0-T16`, `P0-T19`, `P0-T21`, `P0-T23` and
`P0-T26`; all five cards write **`Human gate` = none** and the marks are removed.
Three of the five say why in their `Notes`, and the reason is *inheritance, not
a gate*: `P0-T16` reuses the key entered for `P0-T15`, `P0-T19` reuses the PDFs
supplied for `P0-T18`, and `P0-T26` reuses the audio bytes captured in
`P0-T25`. Each of those predecessors is gated, so the human is already in the
loop before the successor starts; if a successor ever needs a
*fresh* key or file, `P0-T16`'s card says to escalate to its predecessor's gate
rather than proceeding. `P0-T21` and `P0-T23` need no human at all — all seven
sources are free and keyless for one small query, and the keystore round-trip
uses a synthetic API-key-shaped string, never a real key.

### Phase 1

| Task | Title | Depends on | Est. | Gate |
|---|---|---|---|---|
| ✅ `P1-T01` | Declare the canonical model and identifier normalizers | — | 0.75 d |  |
| ✅ `P1-T02` | Core primitives: cancellation, clock, errors, logger | `P1-T01` | 1.0 d |  |
| ✅ `P1-T03` | Typed preference schema, `PrefStore` port, `prefs.js` rows | `P1-T02` | 0.75 d |  |
| ✅ `P1-T04` | Per-host token-bucket rate limiter and backoff | `P1-T02`, `P1-T03` | 1.0 d |  |
| ✅ `P1-T05` | HTTP client over `Zotero.HTTP.request` | `P1-T02`, `P1-T03`, `P1-T04` | 1.0 d |  |
| ✅ `P1-T06` | Tier-1 `SecretStore` for the NCBI key | `P1-T03` | 0.5 d | 🔒 |
| ✅ `P1-T07` | `LiteratureSource` contract and the source registry | `P1-T01`, `P1-T02` (added 2026-09-30 — `docs/07` §4.2 imports `CancellationToken` and `ProgressReporter`, both `P1-T02`'s) | 0.5 d |  |
| ✅ `P1-T08` | PubMed query builder | `P1-T07` | 0.75 d |  |
| ✅ `P1-T09` | PubMed adapter: `esearch` → `efetch` | `P1-T05`, `P1-T06`, `P1-T07`, `P1-T08` | 1.25 d |  |
| ✅ `P1-T10` | PubMed XML → `SourceRecord` mapper | `P1-T01`, `P1-T09` | 1.25 d |  |
| ✅ `P1-T11` | Contract-test harness and PubMed fixtures | `P1-T05`, `P1-T09`, `P1-T10` | 0.75 d |  |
| ✅ `P1-T12` | `CanonicalWork` → Zotero item JSON and the `extra` rules | `P1-T01`, `P1-T02` (added 2026-09-30 — the `Notes` require `throw new ZoteroApiError(...)` for the preprint gap, and `docs/07` §10.1's hierarchy is `P1-T02`'s `src/core/errors.ts`) | 1.0 d |  |
| ✅ `P1-T13` | Existing-item detection by DOI and PMID | `P1-T01`, `P1-T12` | 0.5 d |  |
| ✅ `P1-T14` | Batched importer and collection operations | `P1-T12`, `P1-T13` | 1.0 d |  |
| ✅ `P1-T15` | `ProgressReporter` and its Zotero surfaces | `P1-T02` | 0.5 d |  |
| ✅ `P1-T16` | `searchImport` pipeline | `P1-T07`, `P1-T09`, `P1-T10`, `P1-T14`, `P1-T15`, `P1-T25`, `P1-T31` | 1.0 d |  |
| ✅ `P1-T17` | Provenance record, note writer and JSON export | `P1-T09`, `P1-T14` | 0.75 d |  |
| ✅ `P1-T18` | Localization scaffolding for the Phase 1 strings | `P1-T02` | 0.5 d | 🔒 |
| ✅ `P1-T19` | Menu entry points and the window opener | `P1-T18`, `P1-T25` (added 2026-10-01 — `P1-T25` wired `installServices()` into this card's own file) | 0.5 d |  |
| ✅ `P1-T20` | Search & Import window: markup and controls | `P1-T03`, `P1-T07`, `P1-T19` | 1.0 d |  |
| ✅ `P1-T21` | Result table, selection and filtering | `P1-T20` | 0.75 d |  |
| ✅ `P1-T22` | Wire search, import, progress, cancellation, five states | `P1-T16`, `P1-T17`, `P1-T21` | 0.75 d |  |
| ✅ `P1-T23` | Phase 1 definition-of-done run | `P1-T11`, `P1-T22`, `P1-T28`, `P1-T35`, `P1-T36`, `P1-T45`, `P1-T46` | 1.0 d | 🔒 |
| ✅ `P1-T24` | Retire the `P0-T10` spike surface from `itemMapper.ts` | `P1-T12` | 0.25 d |  |
| ✅ `P1-T25` | Composition root: construct the HTTP client, limiters and… | `P1-T04`, `P1-T05`, `P1-T15` | 1.0 d |  |
| ✅ `P1-T26` | Collapse the duplicate `Retry-After` parser and drive… | `P1-T04`, `P1-T05` | 0.5 d |  |
| ✅ `P1-T27` | Give the concurrency cap an owner, or remove it from the… | `P1-T04`, `P1-T05` | 0.5 d |  |
| ✅ `P1-T28` | Settle §7.3's retry numbers, and wire them | `P1-T05` | 0.25 d | 🔒 |
| ✅ `P1-T29` | Verify the `ProgressWindow` / `ItemProgress` signatures… | `P1-T15` | 0.25 d |  |
| ✅ `P1-T30` | Turn on `fluent.dts` and make one source of truth for message… | `P1-T18` | 0.25 d |  |
| ✅ `P1-T31` | Make a progress reporter usable for more than one job | `P1-T15`, `P1-T25` | 0.5 d |  |
| ✅ `P1-T32` | The four platform seams the composition root could not reach | `P1-T25` | 0.5 d |  |
| ✅ `P1-T33` | Retire one of the two headline ids, and record which surface… | `P1-T32` | 0.25 d |  |
| ✅ `P1-T34` | Three corpus statements measured false, corrected at the… | `P1-T19`, `P1-T32` | 0.25 d |  |
| ✅ `P1-T35` | Publish the search window's host, so the window stops… | `P1-T16`, `P1-T17`, `P1-T22` | 0.5 d |  |
| ✅ `P1-T36` | FR-8's "Export provenance as JSON" control, and the record it… | `P1-T22`, `P1-T35` | 0.5 d |  |
| `P1-T37` | Carry a named, redacted subset of an error's context, so the… | `P1-T22` | 0.5 d |  |
| `P1-T38` | The three validation sentences nobody declared, and the… | `P1-T22` | 0.25 d |  |
| ✅ `P1-T39` | A unit-test path for the search window's view model, whose… | `P1-T22` | 0.5 d |  |
| ✅ `P1-T40` | A partition assertion over `src/i18n/keys.ts` at unit speed… | `P1-T30`, `P1-T33` | 0.25 d |  |
| ✅ `P1-T41` | `P3-T02` tells its implementer to call a method that does not… | — | 0.5 d |  |
| ✅ `P1-T42` | The free-text redactor cannot see a short unprefixed… | — | 0.5 d |  |
| ✅ `P1-T43` | Stop hiding already-present papers, and carry the duplicate… | `P1-T21`, `P1-T22` | 0.5 d |  |
| ✅ `P1-T44` | A place to put a key, because the storage landed in Phase 1… | — | 1.0 d |  |
| ✅ `P1-T45` | The export control, its three strings and the file chooser… | `P1-T36` | 0.5 d | 🔒 |
| ✅ `P1-T46` | Stop three tests waiting on text the run has already… | `P1-T45` | 0.5 d |  |

### Phase 2

| Task | Title | Depends on | Est. | Gate |
|---|---|---|---|---|
| ✅ `P2-T01` | Ship the user-query parser and per-source render contract | `P1-T07`, `P1-T08` | 1.0 d |  |
| ✅ `P2-T02` | Parallel fan-out: per-source timeouts, failure isolation | `P1-T04`, `P1-T07`, `P1-T16`, `P2-T01` | 1.25 d |  |
| `P2-T03` | Europe PMC adapter | `P2-T01`, `P2-T23`, `P2-T25`, `P2-T26`, `P2-T28` | 2.0 d |  |
| `P2-T04` | Crossref adapter | `P2-T01`, `P2-T21`, `P2-T25`, `P2-T26`, `P2-T28` | 1.5 d |  |
| `P2-T05` | Semantic Scholar adapter with unauthenticated degradation | `P1-T27`, `P2-T01`, `P2-T25`, `P2-T26`, `P2-T28` | 2.0 d | 🔒 |
| `P2-T06` | arXiv adapter | `P2-T01`, `P2-T25`, `P2-T26`, `P2-T28` | 1.25 d |  |
| `P2-T07` | bioRxiv / medRxiv adapter (ID lookup and cross-walk only) | `P2-T01`, `P2-T03`, `P2-T25`, `P2-T26`, `P2-T28` | 1.5 d |  |
| `P2-T08` | `preprint` item-type mapping and server attribution | `P2-T03`, `P2-T06`, `P2-T07` | 1.0 d |  |
| `P2-T09` | Dedup engine: identifier-first cascade, fuzzy fallback | `P1-T01`, `P1-T13` | 2.0 d |  |
| `P2-T10` | Field-merge policy, source precedence, record provenance | `P2-T09` | 1.5 d |  |
| `P2-T11` | Preprint ↔ published-version linking | `P2-T04`, `P2-T05`, `P2-T06`, `P2-T07`, `P2-T09` | 1.0 d | 🔒 |
| `P2-T12` | Batched abstract-backfill pass | `P2-T03`, `P2-T04`, `P2-T05`, `P2-T10` | 0.75 d |  |
| `P2-T13` | Dedup corpus and measured precision/recall report | `P2-T09`, `P2-T10`, `P2-T11` | 2.0 d | 🔒 |
| `P2-T14` | Search & Import window: chips, badges, per-source status | `P2-T02`, `P2-T08`, `P2-T09`, `P2-T10` | 1.5 d |  |
| `P2-T17` | Re-run a search from its provenance record | `P1-T13`, `P1-T17`, `P1-T19`, `P2-T01`, `P2-T14`, `P2-T22` | 1.5 d |  |
| `P2-T18` | Translator import path behind `useTranslators` | `P1-T14`, `P2-T08`, `P2-T12` | 1.25 d |  |
| ✅ `P2-T15` | Record and enforce the settled OpenAlex decision: out of v1 | — | 0.25 d |  |
| `P2-T16` | Phase 2 end-to-end run against the definition of done | `P2-T02`, `P2-T08`, `P2-T09`, `P2-T10`, `P2-T11`, `P2-T12`, `P2-T13`, `P2-T14`, `P2-T17`, `P2-T18` | 1.0 d |  |
| `P2-T19` | Work-key detection for records with no DOI and no PMID, and… | `P1-T13`, `P2-T09` | 0.75 d |  |
| `P2-T20` | Render `languages`, `openAccessOnly` and `raw` across the… | `P1-T08` | 0.5 d |  |
| ✅ `P2-T21` | Make the concurrency cap resizable, so a tightened header… | `P1-T27`, `P1-T26` | 0.5 d |  |
| ✅ `P2-T22` | Declare the menu-context member `docs/08` mandates and… | `P1-T19` | 0.25 d |  |
| ✅ `P2-T23` | Give `hostLimiter.ts` the test file two cards already invoke | `P1-T26` | 0.25 d |  |
| `P2-T24` | Correct the three statements `P2-T21` made false, including… | `P2-T21` | 0.25 d |  |
| ✅ `P2-T25` | Make the fixture replay harness usable inside Zotero, so six… | `P1-T11` | 0.75 d |  |
| `P2-T26` | Give the source registry a test-only removal, before two… | `P2-T25` | 0.25 d |  |
| `P2-T27` | Wire `fanOut` into the running pipeline, which still fetches… | `P2-T01`, `P2-T02` | 0.5 d |  |
| `P2-T28` | Give the per-source query dialect its home in… | `P2-T01`, `P2-T26`, `P2-T27` | 0.25 d |  |

### Phase 3

| Task | Title | Depends on | Est. | Gate |
|---|---|---|---|---|
| `P3-T01` | Secret wrapper and unconditional log redaction | — | 0.5 d |  |
| `P3-T02` | `SecretStore` tier 1 — OS keychain via `Services.logins` | `P3-T01`, `P1-T41` | 0.75 d |  |
| `P3-T03` | Tier ladder — session-only and passphrase, no tier 4 | `P3-T02` | 0.75 d |  |
| `P3-T04` | Prefs pane: key fields, backend badge, remove-all | `P3-T02`, `P3-T03` | 1.75 d | 🔒 |
| `P3-T05` | LLM error taxonomy and the retry/backoff policy | `P3-T01` | 0.5 d |  |
| `P3-T06` | `LLMProvider` contract, registry, router, mock harness | `P3-T05` | 0.75 d |  |
| `P3-T07` | OpenRouter adapter (the default provider) | `P3-T02`, `P3-T05`, `P3-T06` | 1.0 d |  |
| `P3-T08` | OpenAI adapter (Responses API) | `P3-T02`, `P3-T05`, `P3-T06` | 0.5 d |  |
| `P3-T09` | Anthropic adapter (Messages API) | `P3-T02`, `P3-T05`, `P3-T06` | 0.5 d |  |
| `P3-T10` | Gemini adapter (Interactions API) | `P3-T02`, `P3-T05`, `P3-T06` | 0.75 d |  |
| `P3-T11` | SSE streaming across the four adapters | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` | 0.5 d |  |
| `P3-T12` | Structured output, validation, and the repair path | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` | 0.75 d |  |
| `P3-T13` | Model catalogue, pricing table, token estimation | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10` | 0.75 d |  |
| `P3-T14` | `validateCredentials()` and the Test-key button | `P3-T04`, `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T13` | 0.5 d | 🔒 |
| `P3-T15` | Privacy modes, egress disclosure, Gemini free-tier warning | `P3-T07`, `P3-T10`, `P3-T13` | 0.75 d |  |
| `P3-T16` | Cost estimate, confirmation gate, `BudgetGuard`, usage | `P3-T13`, `P3-T15` | 1.0 d | 🔒 |
| `P3-T17` | `llm` worker pool: concurrency, cancel, pause, resume | `P3-T05`, `P3-T06` | 0.75 d |  |
| `P3-T18` | Text acquisition tiers 1–2 (abstract, attachment text) | — | 0.75 d |  |
| `P3-T19` | Tiers 3–4, cleaning pass, OCR probe, language detection | `P3-T18` | 0.75 d |  |
| `P3-T20` | The 40-PDF IMRaD fixture set with ground-truth labels | `P3-T19` | 1.75 d | 🔒 |
| `P3-T21` | IMRaD section detector (JATS + PDF heading table) | `P3-T19` | 0.5 d |  |
| `P3-T22` | Detector accuracy harness, 85 % gate, degrade switch | `P3-T20`, `P3-T21` | 0.5 d | 🔒 |
| `P3-T23` | Chunker: section-aware, flat, and single-shot paths | `P3-T13`, `P3-T21`, `P3-T22` | 0.75 d |  |
| `P3-T24` | Prompt registry with versioned prompt files | — | 0.5 d |  |
| `P3-T25` | Per-paper summarizer, DR-1, and the grounding check | `P3-T12`, `P3-T16`, `P3-T23`, `P3-T24`, `P3-T26` | 1.0 d |  |
| `P3-T26` | Summary cache keyed per `docs/06` §11.2 | `P3-T19`, `P3-T24` | 0.5 d |  |
| `P3-T27` | Screening: retractions, non-English, duplicates, relevance | `P3-T12`, `P3-T18`, `P3-T24` | 0.75 d |  |
| `P3-T28` | Item-pane AI summary section | `P3-T25` | 0.5 d |  |
| `P3-T29` | Summarize-collection pipeline, notes, remove-notes command | `P3-T16`, `P3-T17`, `P3-T25`, `P3-T27` | 1.0 d |  |
| `P3-T30` | LLM fixtures and contract tests | `P3-T07`, `P3-T08`, `P3-T09`, `P3-T10`, `P3-T11`, `P3-T12` | 0.75 d |  |
| `P3-T31` | Phase-3 acceptance run against the definition of done | `P3-T14`, `P3-T22`, `P3-T28`, `P3-T29`, `P3-T30` | 0.75 d | 🔒 |

---

## 5. Open decisions this index surfaces

These block nothing today but should be settled before the phase they affect.
Items 1, 3, 4 and 6 are settled and kept for the record; **items 2 and 5 are the
only ones still open.**

1. ~~**The estimate divergence (§1).**~~ **Settled 2026-09-09: `docs/11` §1 was
   re-estimated from the task sums.** The alternatives — shave the cards, cut v1
   scope, or keep the roadmap figures and track against the cards — were
   rejected in favour of correcting the roadmap, because the cards are the only
   measurement available and four independent decompositions agreed. Phases 0–3
   are now derived from these sums; Phases 4–7 were scaled by the observed
   correction factor and are flagged in `docs/11` as inference. The whole-plan
   total, the revised months figure and the recomputed critical path live in
   `docs/11` §1–§2 and are not restated here. Consequence for this file: §1's
   table is a record of what changed, not an open gap.
2. **Splitting Phase 1.** Phase 1's decomposition found **6.75 d** of shared core
   infrastructure — nine of its twenty-three cards, `P1-T01`–`P1-T07` (0.75 +
   1.0 + 0.75 + 1.0 + 1.0 + 0.5 + 0.5 = 5.5 d) plus `P1-T15` (0.5 d) and
   `P1-T17` (0.75 d) — that Phases 2 and 3 reuse. (`docs/11`'s Phase 1 entry
   rounds the same nine cards to "≈ 6 d".) Splitting into Phase 1a (core) and
   Phase 1b (PubMed slice) would make the reuse visible in the plan rather than
   hidden in one phase's number.
3. ~~**OpenAlex.**~~ **Settled in the corpus by the 2026-09-09 documentation
   pass — no two documents disagree any more.** `docs/02` §9.3 formerly
   recommended shipping OpenAlex opt-in and disabled by default; that
   recommendation is now explicitly **withdrawn** in that section, which opens
   "OpenAlex is out of scope for v1. It ships no adapter, no preference, no
   `SecretId` and no rate-limit policy row", on the stated grounds that it
   contradicted `docs/00` §3 D2 and `docs/10` §4 item 10. `docs/07` §8.5
   reinforces it: `openalex` is not a valid member of the `sources` preference
   and there is no `api.openalex.org` row in §7.3's rate-limit policy table.
   `P2-T15` followed on the same day: it was a product-owner decision card
   gated on "two design documents give opposite answers", and is now
   **"Record and enforce the settled OpenAlex decision: out of v1"** with
   `Human gate` = none and no adapter to build. The estimate is unchanged at
   0.25 d, so Phase 2's sum is still 24.25 d. §4's Phase 2 row and its gate
   column were re-derived from that card for this revision.
   **Closed for `plan/03`.** That file's front and back matter have caught up
   with its cards: its "Human gates in this phase" table now lists three gates
   (`P2-T05`, `P2-T11`, `P2-T13`) and says so, and items 1 and 2 of its closing
   "Contradictions in the design corpus this decomposition surfaced" list are
   struck through as closed. Nothing in that file still contradicts `docs/02`
   §9.3 or `docs/07` §8.5 as they stand today.
4. ~~**`useTranslators`.**~~ **Settled by the 2026-09-09 documentation pass —
   both halves of the alternative happened.** The preference now ships
   defaulting **`false`** (`docs/07` §8.5, with `docs/01` §7.2's `pref()` line
   and its "MUST ship false" comment), `docs/01` §6.3 makes hand-mapping
   (Strategy A) the default path and translator lookup (Strategy B) the opt-in,
   and `docs/10` NFR-1's scope was narrowed to the hand-mapped path so the slow
   path is no longer held to a target it cannot meet. Phase 2 honours the
   preference in **`P2-T18`**. `plan/02` §3's scope table and its conflict `C4`
   have since been updated to match and now record the default as **`false`**,
   so no plan file still carries the old value in a live statement.
   **Closed for `plan/03`.** Item 7 of that file's closing "Contradictions in
   the design corpus this decomposition surfaced" list is now struck through and
   records the settlement on both sides, so no plan file asserts the old default
   any more. `P2-T18` step 1's re-assertion of the shipped default in code is
   still worth keeping, because `P1-T03` may have written `true` from the old
   text.
5. **The provenance JSON schema — who owns it.** FR-8 requires the export to
   validate against "the documented schema", and **the schema document itself
   still does not exist anywhere in `docs/`**: `P1-T17` is what creates
   `schema/provenance.schema.json`, from FR-8's own field enumeration plus
   `docs/07` §5.1's `WorkProvenance`. What changed on 2026-09-09 is that the
   file is no longer unowned. `docs/07` §5.3 ("Search provenance") now names
   `schema/provenance.schema.json` as the shipped artefact — it also appears in
   §2.2's directory tree — and declares the `SearchProvenance` interface the
   schema is to be generated from and kept in step with, so **§5.3 is the
   natural owner; a human should confirm the generated file against that
   interface and record the ownership.** `P2-T17` reads that record back for
   FR-12, so a late change to the shape costs two cards, not one.
   `P1-T17` has been brought into line: its **Read first** now opens on
   `docs/07` §5.3 "Search provenance" and on §5.3's "Where it lives", keeps
   §5.1's `WorkProvenance` only as the *other*, per-work record not to be
   conflated with it, and its **Notes** record `plan/02`'s conflict `C8` as
   closed. What is left for a human is narrow: confirm the generated
   `schema/provenance.schema.json` against §5.3's interface and record that
   §5.3 owns it.
6. ~~**Four `Blocks` back-references are owed by `plan/02`.**~~ **Closed — they
   are present.** `P2-T17` depends on `P1-T13`, `P1-T17` and `P1-T19`, and
   `P2-T18` depends on `P1-T14`; all four Phase 1 cards now name the Phase 2
   card in their **Blocks** row, which is the one direction the
   `A blocks B ⇒ B depends on A` check reads the other way round. That closes
   the last item the 2026-09-09 re-run left outstanding. Re-verified for this
   revision by extracting every `Depends on` and `Blocks` entry from all 100
   cards: **216 edges in each direction, the two sets are identical, and the
   graph is acyclic** — no `Depends on` without its matching `Blocks`, no
   `Blocks` without its matching `Depends on`, and every referenced ID exists.
   The count has moved twice. It fell from 216 to 215 when `P2-T15`'s stale
   `Depends on` = `P2-T03` and the reciprocal `Blocks` entry on `P2-T03` were
   dropped — that card was rewritten as a settled-decision record and no longer
   waits on the Europe PMC adapter. It returned to 216 in the round-2 pass,
   which added the missing `P0-T10 → P0-T24` edge: `P0-T24` step 3 binds the
   Tools-menu label `P0-T10` registers, and its `Done when` requires that label
   to render, but no edge said so — and both cards carried
   `create addon/locale/en-US/research-helper/mainWindow.ftl`, so the file's
   owner was undefined. `P0-T10` creates it; `P0-T24` now modifies it.

## 6. Measured gaps with no card yet

**This section is the intake, and the rule is `plan/README.md` §5 rule 9 (2026-10-13): an item here
becomes a card only when it blocks the finishing conditions of the phase being executed.** Items are
tagged below with the phase they would serve where that is known. Phase 1 is closed; nothing here is
Phase 1 work any more.

**Triaged 2026-10-07.** Every `Needs a card` paragraph in `plan/02-phase-1-pubmed.md` was read with its
context — eighteen of them — and the ones already carded were removed, including the `Semaphore.resize`
item, which turned out to be `P2-T21` and is `DONE`. Twenty-four candidates survived. Seven were carded
as `P1-T37`–`P1-T42` and `P2-T25`; the rest are here, with the file and line that measured each.

**This list is not a plan.** An item here has been measured and has no card, which is different from being
scheduled. Carding one is a coordinator decision, and the two groups below are deliberately ordered by
nothing at all, because ranking them without an owner's input would be a decision disguised as a list.

### 6.1 Features the corpus specifies and the build does not have

1. ~~**The duplicate-policy choice is collected and dropped.**~~ **CARDED 2026-10-08 as `P1-T43`**, with
   the hide-already-present decision the owner took the same day, because the two are one behaviour. The
   triage figure that made it a card: the mechanism is **complete and unreached** —
   `src/zotero/importer.ts` declares the three-way policy, its default, an optional request member and
   **all three branches**, and no caller in `src/` supplies a value.
2. **Per-source import counts.** The summary reports one total; §4.6 names per-database figures.
3. **A publication-type vocabulary.** Real records carry review, editorial, comment, preprint and clinical
   trial, and **every PubMed record currently maps to one of two types**. Fixing it means editing
   `docs/02` §10.2's trigger table first (`P1-T10`'s `Findings`).
4. **A query-free headline identifier for the empty state.** `P1-T22` left
   `research-helper-search-state-empty` unpopulated on purpose, because interpolating the keyword box into
   a user-visible sentence is the surface a short credential would have been shown in. `P1-T42` holds the
   measurement that decides whether that surface becomes safe.
5. ~~**A preference pane**, so the error panel's Open Preferences action has something to select.~~
   **CARDED 2026-10-08 as `P1-T44`.** The triage figure that made it a card: **the storage and the pane
   registration both already exist** — eleven exported functions in `src/zotero/keychain.ts` from Phase 1
   and `preferencePaneRegistration` from Phase 0 — so only the pane's markup and controller are missing,
   and the card that would add them was two phases away behind dependencies already satisfied.
6. **Styling for the per-database status list** — §4.6's dot leaders and its tick-and-arrow glyphs. The
   outcome already travels as a data attribute, which is the selector such a rule would use.

### 6.2 Seams, facades and corrections, each small on its own

7. **The lazy platform constructor in `src/zotero/keychain.ts`.** `Components.Constructor` evaluates in the
   module body at line 95, so importing the module outside the sandbox throws and takes a whole unit suite
   down with **zero tests collected**. Worked around with a dynamic import; the one-line fix is to make
   that constructor lazy as every other platform reference in the file already is (`P1-T16`'s `Findings`).
8. **A getter for the raw-retention flag**, so the preference takes effect without a restart.
9. **A collection-description writer** for `docs/07` §7.4's partial-import note.
   `PARTIAL_IMPORT_NOTE_PREFIX` exists and is deliberately not a Fluent message; who localizes it is the
   writer's card to decide.
10. **A page-level channel on the source interface.** `docs/07` §4.2's streaming method cannot supply
    **four** of the required provenance fields — endpoint address, transmitted address, raw hit count, and
    the extras the discarded page carries. §11.1 makes widening that interface a documented change to the
    architecture document, not a local workaround.
11. **A declared validator for the schema dialect**, replacing roughly 170 lines of hand-written test code.
12. **The log prefix is applied twice and the two spellings differ by one character** —
    `[research_helper]` from `createLogger` and `[research-helper]` from the Zotero facade, of which only
    the second matches `config.addonRef`. Cosmetic, in a line users paste into bug reports.
13. **Nothing in continuous integration exercises the production parser.** The entity decoding and text
    flattening `docs/02` §3.4 is about are asserted only against a Node stand-in. An agent checked that an
    XML implementation is reachable on this network and **did not install it**, which was the right
    restraint and left the gap.

### 6.3 Raised by `P1-T35`, 2026-10-07

14. **Move two platform reads out of `src/addon.ts`.** `Zotero.version` and `Zotero.Collections` have no
    facade in `src/zotero/` — grepped 2026-10-07: before `P1-T35`, `Zotero.Collections` was called only at
    `src/zotero/collectionOps.ts:135–136` and `Zotero.version` was called **nowhere**, every other mention
    being a comment — so the composition root cannot reach them and `P1-T35` put them on the sandbox boundary
    instead. A `zoteroVersion()` beside `userLibraryID()` and a `listCollections()` beside
    `findOrCreateCollection()` are the architecturally right homes.
15. **Two doc comments now say the opposite of the truth**, both outside `P1-T35`'s `Files`:
    `src/ui/dialogs/searchDialog.ts:182` ("Nothing publishes it in the shipped build") and
    `test/integration/searchDialog-table.spec.ts:47`. The second file's behaviour is unaffected; only its
    prose is stale.
16. **`src/pipeline/registry.ts:18–25` makes two statements measured false**, and the composition root
    carries a cast because of the second. Whether `ServiceGraph` should expose the concretely-typed
    `searchImport` pipeline so the cast can go away is the decision inside this item.
17. **`SourceRegistry` has no way to replace or remove an adapter**, so an integration spec cannot stub a
    source the build actually ships and has to register its stub under a spare identifier — which costs
    that spec the localized source display name, since no bundle names the spare. Either a documented test
    seam or a recorded decision that the registry is immutable after startup.
18. **The published host is application-scoped and holds one view model for the plugin's lifetime**, so a
    window closed and reopened reconnects to a view model still holding the previous run's records. The
    view model's own comment says "one per window", which is true for a spec-built host and not for the
    published one. **A behaviour decision nobody has made.**
19. **Whether a library-index rebuild belongs on every Search press.** `P1-T35` rebuilds it per run, which
    is `docs/02` §11.6's stated budget of one `Zotero.Search` per run, but on a very large library that is
    a visible pause before the fetch starts and the corpus states no size at which it becomes
    unacceptable. The two alternatives — a notifier observer keeping the snapshot live, or a snapshot taken
    once at startup — were not costed.

20. ~~**The integration suite's waits on transient rendered text.**~~ **CLOSED 2026-10-12 by `P1-T46`** —
    the three tests now read the recorded published states, the element's Fluent attributes and the
    bundle's own answer, and the evidence is a deterministic reproduction rather than a green streak.
    Carded 2026-10-08 as `P1-T46`,
    after a third independent measurement — three consecutive runs of an unchanged tree gave one green.
    The fix has a shape: **the spec already taps the published view state** and keeps only the latest one,
    so a transient fact is overwritten before any assertion can see it; recording the sequence makes the
    two primary waits assertable without touching a timeout. The original measurement follows.

    **The item that gates `P1-T23`.** Measured by `P1-T35`'s executing agent across 25 runs: Fluent's latency in the search
    window is **bimodal per run** — about 30 ms per test in a passing run, about 1,010 ms in a failing
    one, roughly doubling per test (1.0, 2.0, 4.0, 8.0 s) until the import lands on 22.92–22.99 s against
    a 25,000 ms cap, in 21 of the 25 runs that reached it. Three tests in `P1-T22`'s block then wait on
    text the run has already replaced. Background-timer clamping and the `ko-KR` locale
    `l10n.spec.ts` leaves behind were both measured and **refuted**. The fix is to wait on a view-state
    tap rather than on rendered text, for the states that are transient. **On a quiet machine the suite
    runs green** — 98 passed, three consecutive runs on 2026-10-08 — so this is load sensitivity, not a
    broken assertion, and the coordinator's one-run-per-condition measurement that called it a regression
    was wrong. Until it is fixed, a continuous-integration run can go red for reasons unrelated to the
    change under test.

21. **One published boolean for "a record exists" on `SearchViewState`.** `P1-T45` had to **derive** the
    export control's visibility from `state.notices` being non-empty, because the view state has a
    `cancelVisible` field for the Cancel button and **no equivalent for the retained record** — and that
    file was outside its list. The derivation is justified by measurement and has **one measured
    divergence**: a *refused* run clears the record without publishing any state, so the previous run's
    summary stays on screen, the control stays visible with nothing to export, and the attempt renders
    the failure sentence. One published boolean, set and cleared with the record, plus one line in the
    window script, removes it. Needs `src/ui/viewModels/searchImportViewModel.ts` and
    `addon/content/searchDialog.js`.

22. **Whether the documentation inside `addon/content/searchDialog.js` should ship to users.**
    **An owner's decision about a user artefact, not a code question.** That file is **copied into the
    installer verbatim** rather than bundled, and measured 2026-10-08 it is **3,100 lines, 44 % of them
    comment, 116,975 bytes**. `P1-T45` grew the installer by **5,965 bytes — about 4.5 %** — and almost
    all of that growth is comment. The comments are unusually valuable here (they carry measurements a
    reader cannot recover), so the choice is real: ship them, strip them at build time, or move the long
    passages to a document. **Nothing is wrong today**; the number simply grows with every card that
    touches that file.

### 6.4 Raised by `P1-T46`, 2026-10-12

23. **Why the search window's text rendering is bimodally slow, and why the cost doubles with every text
    request.** Measured: in a slow run the per-test cost roughly doubles — 1.0, 2.0, 4.0, 8.0 seconds —
    while the one test in that block that asks for **no** rendered text stays at **41 ms**. So the cost
    scales with **the number of text requests, not with elapsed time**. **Four candidates are refuted**:
    background-timer clamping, the `ko-KR` application locale, twelve processes saturating every core
    (the suite stayed fast and green), and watch mode (a partial slow mode once, still green). **The
    strongest untested candidate is in the configuration**: `zotero-plugin.config.ts:196` sets
    `devtools: true`, which appends `--jsdebugger`, and `:212` records that test runs inherit it, **so the
    Browser Toolbox is attached to the window in every run ever measured** — and "cost per text request"
    is the shape an attached observer would produce. Turning it off for a measurement is one line of
    configuration. The other two untested: the rebuild described in item 24, and a cold first run.
    **Nothing is broken today** — `P1-T46` made the tests immune to it — but the product renders text
    for users through the same path.

24. **`renderMessageList` and `renderSourceStatus` destroy and rebuild their children on every published
    state**, even when the message references have not changed. This is **both** the reason a notice's
    text is transient at node level — which is what actually broke the FR-51 test, measured by
    `P1-T46` — **and** a plausible contributor to item 23. Making them update in place needs
    `addon/content/searchDialog.js`.

### 6.5 Raised by `P1-T23`, 2026-10-12 — the definition-of-done run

**The figures first, because they are the deliverable.** Measured against a real Zotero **10.0.3** on
Windows, through the host the plugin publishes at startup, with the Browser Toolbox attached (so every
figure is a **ceiling**, not a best case — `zotero-plugin.config.ts:196`, re-verified in the installed
scaffold's own source at `:3737` and `:3934`). Full evidence in
[`docs/spikes/phase-1-dod.md`](../docs/spikes/phase-1-dod.md); **no state is set here, and §1's counts are
not touched.**

| figure | requirement | measured, 4 runs |
|---|---|---|
| `NFR-1` — 100 pre-fetched records to "collection contains 100" | ≤ 10,000 ms, target 6,000 | **441 / 456 / 621 / 624 ms** |
| `NFR-3` — longest main-window gap during that import | ≤ 100 ms per task | **38 / 50 / 52 / 54 ms**, 0 gaps over 100 ms |
| `NFR-10` — the plugin's own startup work | ≤ 200 ms | **10 / 13 / 14 / 16 ms** |
| `NFR-10` — HTTP requests at startup | none | **0**, with a control window in which the plugin was disabled |
| `FR-10` — cancel mid-fetch to stopped | ≤ 2,000 ms | **121 / 123 / 128 / 153 ms**, and 0 `item`/`collection` notifier events |
| `R-17` — abstract coverage on a real PubMed query | measure it | **99 % (99 of 100)**, and the plugin's own published figure agrees |
| `R-16` / `docs/07` §7.2 — write chunk | the shipped 50 | **50**, 2 transactions for 100 records, ~256–441 ms then ~180–200 ms |

**`docs/07` §7.2's chunk-size question did not need answering — `:2196` has read "MEASURED 2026-10-01
(`P1-T14`) … Ship 50" since 2026-10-01, which this card's `Notes` had not noticed (item 29).** What the
four runs add is **four independent reproductions of a table `docs/07` records from one run**, and they
confirm it: throughput is **flat** from 25 to 200 per transaction (730–1188 ms for 200 records, with no
ordering that survives four runs); what chunk size changes is the **slowest single transaction**, which
grows roughly linearly — ~200 ms at 25, ~280 at 50, ~430 at 100, ~900 at 200; and the **main window's
longest gap never exceeded 59 ms at any chunk size**, not even behind a single 1,173 ms transaction, so a
long `executeTransaction` is not one long main-thread task, exactly as §7.2 says citing `P0-T20`. **Ship
50 stands.** One correction: §7.2's "25 costs **47 %** more for nothing" is a single-run figure; four runs
put the penalty at **7–25 %**, which changes the number and not the conclusion. The live acceptance run
spent **4** HTTP requests on NCBI, two per search, against the shipped 2.5/s limiter.

25. **A developer spike command ships in the Tools menu.** `Tools ▸ Research Helper` shows
    **`Create spike item (P0-T10)`** beside `Search & Import…`. It works, so it does not breach
    `docs/11` §0 principle 5 on the letter, but it is a developer artefact labelled with an internal task
    ID and visible in a release. `plan/01-phase-0-toolchain-spike.md:3355` calls the id "deliberate and
    permanent while the spike command exists" and **no card retires the command**. Retiring it means
    rewriting two integration assertions: `l10n.spec.ts`'s `ko-KR` fallback check is built on that id, and
    `lifecycle.spec.ts` counts menu items by it.

26. **`searchDialog-flow.spec.ts`'s `P1-T45: the export control is hidden before any run` depends on being
    the first thing in the suite to touch the published host** — and the live acceptance run broke it,
    `expected false to be true`. Three shipped decisions meet: the view model is application-scoped;
    `P1-T36` deliberately left `connect()` not clearing the retained record and not resetting the view
    state; and the document derives visibility from `state.notices.length > 0`. So **any** import anywhere
    in the suite reveals the control for every later window. `phase1-dod.spec.ts` restores the precondition
    in its own `after()` with one empty search — `runJob` publishes `notices: []` at the **start** of every
    run, `searchImportViewModel.ts:1318` — but that is a restore, not a fix. The fix is a test over a fresh
    view model, or the published boolean item 21 already asks for.

27. ~~**`SourceRegistry` has no unregister, and that now has a deadline.**~~ **CARDED 2026-10-13 as `P2-T26`** under rule 9 — it blocks Phase 2's first finishing condition through the adapter cards. *(2026-10-14: only `PUBLISHED_STUB` and `STUB_SOURCE` were ever in the real registry; `CROSSREF` was `P1-T22`'s private-registry stub.)* A spec needing a stub must take a
    spare `SourceId` and leave it in the application-wide registry for the process. Two specs now do:
    `searchDialog-flow.spec.ts` takes `crossref`, `phase1-dod.spec.ts` takes `europepmc`. **Phase 2 ships
    adapters for both**, at which point neither registration succeeds and both specs break. `P1-T35` raised
    the seam as tidiness; it must now land **before the first Phase 2 adapter card**.

28. **The provenance schema validator exists three times**, ~200 lines each, in
    `test/unit/core/provenance.test.ts`, `test/integration/searchDialog-flow.spec.ts` and now
    `test/integration/phase1-dod.spec.ts`. None can import another: the unit copy needs `vitest` and
    `node:fs`, which the Zotero sandbox lacks, and each integration spec is bundled alone. `P1-T36` asked
    for the shared helper; the shape that works is a module under `test/support/` that imports **nothing**.

29. **`P1-T23`'s own `Notes` and `Do` step 2 ask for work that was finished eleven days earlier.** Both
    (`plan/02-phase-1-pubmed.md:4696–4698` and step 2) say to write the chunk-size answer back into
    `docs/07` §7.2's "unverified note". **`docs/07-architecture-and-data-model.md:2196` has read "Chunk
    size: MEASURED 2026-10-01 (`P1-T14`), this half of the marker is closed. Ship 50." since
    2026-10-01**, sweep table included; the only `> **Unverified:**` left in §7.2 is `:2219`'s
    `Zotero.Notifier` suppression, which `P1-T14` deliberately did not implement. So nothing needed
    writing back and `docs/07` was not edited. The card is: correct the `Notes` and step 2, and soften
    §7.2's "**25 costs 47 % more for nothing**" — a single-run figure that four further runs put at
    **7–25 %** — while naming how many runs each figure rests on. `plan/README.md` §5 rule 8 again, and
    this time the claim was not even grepped.

30. **Four counts in this file's own header are stale**, re-derived from the cards' `State` rows on
    2026-10-12: the header says **133 tasks, 71 `DONE`, 62 `TODO`** and "Phase 1 is 34 of 42"; the cards say
    **137 tasks** (35 + 46 + 25 + 31, which is what §1's own table already prints), **74 `DONE`, 63
    `TODO`**, and Phase 1 at **37 of 46**. §4's Phase 1 table is stale in two further ways: it stops at
    `P1-T23`, omitting `P1-T24`–`P1-T45`, and `P1-T23`'s `Depends on` cell reads `P1-T11, P1-T22` where the
    card reads `P1-T11, P1-T22, P1-T28, P1-T35, P1-T36, P1-T45, P1-T46`. **Not corrected here**: every one
    of those figures is derived from a `State`, and `P1-T23`'s `Files` row permits the measured figures and
    never a state. §7's regeneration is the card.

### 6.6 Raised by `P1-T41`, 2026-10-13

55. **Gate `G-09` still owes the system-keyring-library presence check, and two of `P3-T02`'s steps wait
    on it.** The startup probe round-trips a value through encryption, which is what was asked for —
    but **on Linux a missing keyring library does not make encryption fail**: the platform silently
    substitutes a store that keeps the key inside the user profile, so **a round trip cannot tell a
    real keyring from the degraded substitute.** `docs/09` §1.7's 2026-09-30 block says so and names
    the check as owed. **The owner's 2026-10-08 choice of the session-only fallback does not remove
    this**: choosing what to fall back *to* is a different question from being able to tell that you
    must. `P3-T02`'s steps 3 and 5 cannot be finished until the check lands.


56. **`docs/07` §7.2's "25 costs 47 % more" is a one-run figure that does not reproduce.** Four runs in
    `P1-T23` put the penalty at **7 % to 25 %**. The direction holds and "ship 50" is unaffected, and
    §7.2's other two statements reproduced exactly four times. The card is: state how many runs each
    figure rests on, which is the habit every stale number in this plan has lacked.
31. **A stale comment in shipped code** at `src/zotero/keychain.ts:462–465` says nothing calls the
    startup probe. A later card wired it — `src/bootstrap/container.ts:1537` calls it inside a
    function called at `:1320`. One comment, no behaviour change.

32. **Two stale rows in `P3-T02`'s `Files` list — an owner's decision, deliberately not pruned.** One
    row creates `test/unit/prefs/secretSchema.spec.ts`, which **does not exist and whose assertions
    already live in** `test/unit/prefs/schema.test.ts`; its filename also breaks the house convention,
    since 27 of 29 unit test files end the other way, and the matching fragment of that card's
    `Verify with` points at nothing. **Deleting the row changes the card's scope, so it was reported
    rather than removed.** The same decision should settle whether the measured shrinkage — three of
    seven steps landed, two partly — changes `P3-T02`'s 0.75 d estimate.

### 6.7 Raised by `P1-T40`, 2026-10-13

33. **The same gap this card closed, one file further out — and it is the cheaper half.** The agreement
    between the error keys `src/core/errors.ts` can actually throw and the two lists in
    `src/i18n/keys.ts` meant to cover them is checked **only** by the integration suite, at
    Zotero-launch speed. Grepped rather than assumed: `test/unit/core/errors.test.ts` **does not
    import** `src/i18n/keys.ts` at all, and carries **its own hand-written table of the same 23 keys**
    as plain strings. So two independent hand-written lists of the same keys sit in two files with
    nothing fast holding them together: **an error key renamed on one side passes the type check and
    the whole unit suite**, exactly as the Korean lists did before 2026-10-13. Constructing the error
    instances needs no Zotero, so the check is cheap. Needs `src/core/errors.ts` read and one test
    file.

34. **A stale count inside shipped code, and the clean illustration of why counts should not be
    asserted.** `src/i18n/keys.ts:463` says the two sets are "provably the same **85** ids (84 until
    `P1-T32` added the progress headline)". The measured declared set is **87**: 85 at writing, minus
    one when `P1-T33` retired an identifier, plus three from `P1-T45`. **The sentence's claim that
    the two sets are equal is still correct; only the number is wrong.** One comment, no behaviour
    change — and worth fixing by **deleting the number** rather than updating it.

35. **A trap for any future automated check of the identifier module.** The exported constant
    `L10N_EXPORT_TAKES_NO_PATH` is a **sentence of documentation**, and its value begins
    `"research-helper-search-export-written takes no …"` — **so it starts with the plugin's message
    prefix.** Verified 2026-10-13. Any future check that decides "which exported string constants are
    message identifiers" **by testing the prefix** will silently treat a documentation sentence as an
    identifier. `P1-T40`'s test lists the five real identifier constants by hand for this reason, with
    the reason beside them. **A rule that looks mechanical and has one deliberate exception is exactly
    the shape that defeats a later tool** — so either the constant is renamed out of the prefix, or the
    exception stays written down wherever a tool might look.

### 6.8 Raised by `P1-T39`, 2026-10-13

36. **The import half's rendering arithmetic is the largest unit-level hole left in the view model.**
    Uncovered: the completion summary, the abstract-coverage notice, the cancelled-import branch and
    the no-write error branch — plus everything needing a message formatter (the new unit file supplies
    none, which exercises the documented fallback to source identifiers), the import branch of progress
    folding, the module-private target resolution, and the guard that swallows a throwing view. The
    older unit file reaches the same function but asserts the retained record and the export rather
    than the notices, and the live spec asserts created-versus-linked through a real window.
    **Everything needed is already in the new file's harness**: one more describe block and a formatter
    stub.

37. **Two unit files now cover one module from the same layer, under two card numbers — a question,
    not a defect.** If the preference is one file per module, merging them is small and safe; if it is
    one file per card, nothing needs doing. **The new file's header states which file owns what**, so
    no reader is left guessing while the question is open. An owner's call.

### 6.9 Raised by `P1-T42`, 2026-10-13

38. **Swap the PubMed adapter's inline second render for `omitSecretFields`.** `P1-T42` made the
    re-render technique reusable as `src/core/errors.ts`'s `omitSecretFields(values)` — the field-name
    rule applied to a parameter list, removing rather than blanking — and the one existing caller of the
    technique, `src/sources/pubmed/pubmedSource.ts`'s request builder, still does it inline. One line,
    outside that card's list.

39. **A dozen comments now say a 32-character key is below the redactor and nothing can catch it.** True
    when written, stale since `P1-T42` added the hexadecimal shape — the NCBI shape is now caught, and
    only a non-hexadecimal short key still passes. The agent listed them with lines: the view model (four
    places), two integration specs, two unit specs, and `src/core/provenance.ts`, which also carries a
    misattribution at `:207–208` (it quotes a sentence from the adapter as if from `errors.ts`).
    None is a failing assertion. **The mirror image of the premise defect**: a true statement a later
    card makes false, left in place because nobody re-reads a comment. **Do not** let any of them be
    rewritten to say the headline is now safe — it is not; see item 4 and `docs/09` §2.1.

### 6.10 Raised by `P1-T43`, 2026-10-13

40. **The hide-existing flip is an owner-authorised schema change, and the six edits are known.** The
    default lives in four places — `docs/07` §8.5 at `:2925` (the authority), `addon/prefs.js:59`,
    `src/prefs/schema.ts:144`, `addon/content/searchDialog.js:256` — bound by `test/unit/prefs/schema.test.ts:117`
    and `:607–633` and `test/unit/ui/searchDialog.test.ts:1830–1850` (which starts from 35 drawn rows
    and must start from 40). **The integration suite needs no change**: `P1-T43` made it
    default-independent. The owner decided the flip on 2026-10-08; this item is its execution, and it
    needs the owner's authority on `docs/07` because rule 3 forbids an agent to change the schema
    document.

41. **The writer builds a library index under `import-anyway` that the importer never reads** — one
    wasted `Zotero.Search` per such run, at `src/bootstrap/registerPipelines.ts:155`. Small.

42. **Unit tests for the duplicate-policy mapping** (`DUPLICATE_POLICY_BY_CHOICE` and its lookup) in
    `test/unit/ui/searchImportViewModel.test.ts` — the same `Files` gap three cards have reported.

43. **Two comments in shipped code quote `P1-T22`'s *pre-correction* `Do NOT`** — "import exactly the
    checked set, or a hidden-but-checked row silently vanishes" — at `src/pipeline/searchImport/types.ts:62–68`
    and in `src/ui/dialogs/searchDialog.ts`'s import-request doc. The shipped rule is checked ∩ visible,
    corrected 2026-10-07. Same class as item 39.

44. **The provenance record does not carry the chosen duplicate policy**, so a record saying `skipped: 4`
    cannot say whether those were skipped **by choice**. A schema change to `schema/provenance.schema.json`
    with its own gate. `P1-T43`'s `Do NOT` asked for exactly this as a finding.

45. **One transient-text wait remains in the integration suite**, in the export test at
    `test/integration/searchDialog-flow.spec.ts` (`rendered("rh-search-notice", …)`). `P1-T46` converted
    three, `P1-T43` found and converted a fourth that had failed twice that day; this fifth did not fail
    and was left. **And a datum for item 23**: in slow runs `formatMessages` stayed fast while only
    document-translation waits doubled — whatever is slow is the path from a published state to text in
    the document, not the formatter.

### 6.11 Raised by `P1-T44`, 2026-10-13 — recorded under rule 9, none carded

46. **(Phase 3)** Schema rows for `ncbi` and `semanticscholar` `lastValidatedAt` / `lastValidationResult`, plus
    `semanticscholar.keyPresent` and its `KEY_PRESENCE_PREFS` row. `P1-T44`'s pane holds the last Test
    result **for the session only** because the schema has nowhere to put it. `docs/07` §8.5 is the
    authority, so this is an owner-authorised schema change — the same shape as item 40.

47. **(any phase that next touches `src/addon.ts`)** Move `preferences?: PreferencesHostApi` from a module
    augmentation in `src/bootstrap/registerUI.ts` into `PluginApi` proper, beside `searchWindow`. Two lines.

48. **Accepted, not open:** `test/unit/ui/preferencesPane.test.ts` stays. It was outside the card's list; the
    precedent is `P1-T20`'s window test, and fourteen of the card's sixteen mutations were cheap only
    because it exists. Recorded so the next reader does not reopen it.

49. **(before release, `G-41`)** `ko-KR` commented stubs for the 35 new pane ids, and the owner's wording for
    the status-row sentences and especially `backend-indeterminate`.

50. **(owner decision)** The badge vocabulary in `docs/09` §1.9 item 3 and `docs/08` §7.5 rule 7 has **no state
    for "the probe passed but the tier cannot be told"** — which, after `P1-T41`'s finding, is every Linux
    machine without a keyring library. `P1-T44` added `indeterminate` rather than claim a tier. Either
    the two documents gain the state, or item 55's library-presence check lands and retires it.

51. **(owner decision)** `docs/08` §7.3 and §10.1 put the pane's strings in a **fourth bundle**,
    `research-helper-preferences.ftl`; the card put them in the main-window bundle and `P1-T44` followed the
    card, recording the divergence in the bundle header, `keys.ts` and the module. Either `docs/08` is
    corrected or a fourth surface is added to `SHIPPED_SURFACES` and the localization spec.

52. **(Phase 2, when the Semantic Scholar adapter lands)** Move the two `docs/09` §2.3 Test-call request builders
    and outcome classifiers from `src/ui/prefs/preferencesPane.ts` into the source adapters, where §2.3 says
    they live. `src/sources/semanticscholar/` is empty today, which is why they are in the pane.

53. **(Phase 3 / `G-18`)** Expose the pane host's `testKey` behind `RH_DOD_LIVE` in the acceptance spec, so the
    owner can run the real Test once with a real key. Nothing establishes today what either service returns
    for an invalid key; `docs/09` §2.3's unverified marker stands.

54. **(stale comment)** `src/core/secretStore.ts` says every id but `source.ncbi` is unreachable in Phase 1 and no
    user can supply a value. `P1-T44` made `source.semanticscholar` reachable. Same class as items 31 and 39.

### 6.12 Raised by `P2-T15`, 2026-10-13 — recorded under rule 9, none carded

57. **The run-time half of the OpenAlex guard does not exist.** `P2-T15`'s third criterion wanted a typed
    error when `openalex` appears in the `sources` preference, asserted by a unit test; the card's `Files`
    list had nowhere to put it. Measured: `isSourceId` in `src/model/ids.ts` accepts the reserved member,
    `validateSearchImportInput` in `src/pipeline/searchImport/searchImportPipeline.ts` checks only that the
    list is non-empty, and the pipeline's `run` skips the member with a warning through
    `missingAdapterReport`. The two candidate homes are the `getPrefs` closure in
    `src/bootstrap/registerUI.ts` or `validateSearchImportInput`. Phase 2's sixth finishing condition (no
    OpenAlex surface) is met by the CI step; this is the stricter half and becomes a card only if a
    finishing condition needs it.

58. **(`P2-T10`)** When `src/model/merge.ts` lands with `docs/02` §10.4's four inert OpenAlex precedence
    entries, confirm the CI step still exits 0. Expected yes — the guard allowlists `src/model/` for the
    word but not for the host name — and the confirmation belongs in `P2-T10`'s Findings.

59. **The guard treats `#` as code in `.ftl` files.** Fluent comments start with `#`, which the step's
    comment pattern does not recognise, so a future bundle comment naming OpenAlex fails the build. Baseline
    has none. Either extend the pattern for `.ftl` when the need arises, or keep not mentioning it.

60. **`P2-T15`'s original `Verify with` was unsatisfiable** — a bare-word grep over two files whose comments
    state the exclusion. Corrected in the card on 2026-10-13 with the CI step as the command. The lesson
    is the one `plan/README.md` §5 rule 8 already carries: a card's verification must be run once against
    the tree before the card is written.

### 6.13 Raised by `P2-T01`, 2026-10-13 — recorded under rule 9, none carded

61. ~~**The per-source query dialect has no home in `docs/07` §4.2.**~~ **CARDED 2026-10-13 as `P2-T28`** — the owner authorised the §4.2 extension when approving `P2-T01`. `SourceCapabilities` carries
    `keywordSearch` but nothing about whether a source renders OR, NOT, phrases or which `QueryField`
    members — the very column `docs/02` §12.3 tabulates and `P2-T04`'s lossiness notice needs.
    `normalizeForSource` in `src/sources/shared/queryParse.ts` takes it as an inline object shape for now,
    and each adapter card (`P2-T03` to `P2-T07`) passes its §12.3 column inline. The fix is an extension to
    `SourceCapabilities` under `docs/07` §11.1 — an owner-authorised schema change — after which the
    parameter type and the adapters' calls change together.

62. **`P2-T01` criterion 1 cannot be read literally.** "Round-trips all nine §12.3 concept rows" names
    Date range and Pagination, which the card's own Do NOT keeps out of the tree. Met under the reading
    recorded in the card; the owner confirms the reading or rewords the criterion to the seven tree rows
    plus the `SourceQuery` boundary.

63. **`docs/02` §12.3 has no Journal row** although §12.1 names `journal:` as a user prefix and the PubMed
    renderer's `FIELD_TAGS` in `src/sources/pubmed/query.ts` renders `[Journal]`. The row would read:
    PubMed `[Journal]`, Europe PMC `JOURNAL:`, Crossref `query.container-title`, the rest n/a. A document
    edit, the owner's.

64. **`docs/07` §2.2's directory tree omits `src/sources/shared/queryParse.ts`.** `P2-T01`'s Notes already
    ask for it at the next revision of document 07.

65. **Harmless redundancy:** `Parser.parseAnd` in `queryParse.ts` has a binary-`NOT` branch that
    `parseUnary` already covers — removing it yields the same tree. Its comment explains PubMed's binary
    reading, so it is a readability choice; remove it or say so in the comment whenever the file is next
    edited.

### 6.14 Raised by `P2-T02`, 2026-10-13 — one carded under rule 9 (`P2-T27`), the rest recorded

66. ~~**`fanOut` is built and tested but nothing calls it.**~~ **CARDED 2026-10-13 as `P2-T27`** — the serial
    loop in `searchImportPipeline.ts`'s `run` (`fetchOneSource`, `queryFor`, `serialize`) still runs the
    product, and the gap blocks Phase 2's third and fourth finishing conditions. The card also threads one
    process-wide `Semaphore` through `SearchImportDeps` from `registerPipelines.ts` and settles item 67.

67. ~~**Two state functions disagree on one case.**~~ **RESOLVED 2026-10-14 by `P2-T27`:** `fetchStateFromReports` kept, `outcomeFromReports` deleted; the consequence is item 81. `outcomeFromReports` (pipeline) calls "one source errored,
    one healthy source with zero hits" `failed`; `fetchStateFromReports` (`P2-T02`) calls it `partial`,
    because a healthy zero-hit source did not fail. `docs/07` §12.1 says `Failed` is "all sources failed".
    `P2-T27` step 3 keeps one and deletes the other; the owner may overrule the default reading there.

68. **`totalAvailable` / `rawHitCount` have no route out of `searchAll`.** `SourcePage.totalAvailable` cannot
    leave an `AsyncIterable`; the header of `src/pipeline/searchImport/types.ts` already says so and says
    it needs a card. Either give the adapters a side channel (the progress reporter route the PubMed adapter
    already uses for warnings) or page `search()` in the pipeline. Becomes a card only if `P2-T14`'s
    per-source status rows cannot be rendered without it.

69. **`docs/07` does not state the 20 s per-source timeout.** `P2-T02`'s Read first said the numbers were
    document 07's; they are `docs/10` NFR-2's alone. Either restate the figure in `docs/07` §7 (a document
    edit, the owner's) or leave the code citing NFR-2, as `PER_SOURCE_TIMEOUT_MS` now does.

70. **`armDeadline`'s private token is cancelled with `{ kind: "shutdown" }`** because `CancellationReason`
    has no member for "deadline disarmed"; nothing observes the reason, and the doc comment says so. Add a
    member only if something ever reads it.

71. **Observed, not this card's:** whole-repository `lint:check` was red during the run on
    `test/integration/searchDialog-flow.spec.ts` (`no-useless-assignment`, `slashSpelling`) — an in-progress
    edit by `P2-T25`'s agent; re-check when that card lands.

### 6.15 Raised by `P2-T25`, 2026-10-13 — recorded under rule 9, none carded

72. **`docs/13` §2.2's code block is stale in two places.** It shows `node:crypto`, `readFile` and a
    one-argument `replayTransport`; the harness now hashes with `test/support/sha256.ts` and takes a
    `(dir, name)` port. A document edit, the owner's.

73. **The recorder duplicates its synthetic queries.** `scripts/record-fixtures.ts` and
    `test/support/pubmedRecordedRequests.ts` carry the same list; a Node drift guard catches divergence
    today. Let the recorder import the support module and delete its copy when the recorder is next
    touched.

74. **(owner's recording decision)** A whole-year, `retmax ≥ 10` `esearch` with its matching `efetch` would
    let the search window itself replay through the real adapter instead of a stub. Recording means one
    more live NCBI request pair and a committed fixture; until then `P2-T25` criterion 4 stays met in part.

75. **The `REDACTED` placeholder's spelling is pinned by nothing** — the equivalent mutant. It becomes
    observable the day a fixture is recorded with a key present; record one only when a keyed source is
    recorded for its own reasons.

76. **For the adapter cards `P2-T03` to `P2-T07`:** `searchAll` in `src/sources/pubmed/pubmedSource.ts`
    sizes each page as `min(limit − emitted, 200)`, so a replayed `limit` must equal a recorded `retmax`
    or the spec must page through `search()`; contract tests import `./_transport` unchanged; integration
    specs import `../support/fixtureReplay` and `../support/fixtureIo.zotero` and call
    `repositoryFixtureDir("<source>")`. Measured by `P2-T25`, stated here so no adapter card re-learns it.

77. **Observed, not interpreted:** the Zotero process printed `fatal error: ` at exit after a passing
    integration run (122 passed, runner exit 0). Seen once; look for it again before treating it as noise.

### 6.16 Raised by `P2-T27`, 2026-10-14 — recorded under rule 9, none carded (one folded into `P2-T28`)

78. **`SearchImportDeps.pool` is optional with a fallback the product never reaches**, because
    `test/integration/searchDialog-flow.spec.ts`'s `P1-T22` block constructs the pipeline without one.
    Folded into `P2-T28` step 5 (same files): pass a pool there, make the member required, delete the
    fallback; the equivalent mutant becomes killable.

79. **The pipeline still has its own `serialize`.** Three callers (`backfillAbstracts`, `notePartial`, `run`'s
    final `catch`); `stages.ts`'s copy is not exported. One `export` keyword in `stages.ts` and one deletion
    in the pipeline, the next time either file is in a card's list (`P2-T10` edits `stages.ts`).

80. **Stale prose in `stages.ts` and `types.ts`** about the loop and `outcomeFromReports` (`stages.ts` header
    "What is still the caller's", `fetchStateFromReports`'s and `serialize`'s docs; `types.ts`'s
    `SearchImportFetchState` doc). Refresh with item 79.

81. **(owner's confirmation)** With `fetchStateFromReports` kept, a run where one source errors and the
    other healthy source finds nothing is `partial`, continues to `Merging` and creates an **empty
    collection** (FR-6) with a banner naming the failed source; it previously ended `failed` with no
    collection. `docs/07` §12.1 supports the new reading; whether an empty collection is wanted is the
    owner's call.

82. **The pool is reachable only through `buildPipelineSet`.** A later metadata-fetching pipeline that must
    share the `network-metadata` pool would need it on the `ServiceGraph` in `src/bootstrap/container.ts`.
    Becomes a card when such a pipeline is carded.

### 6.17 Raised by `P2-T26`, 2026-10-14 — recorded under rule 9, none carded

83. **`P1-T22`'s private-registry `CROSSREF` stays.** It never reaches the real registry (`registryOf` starts
    empty), so renaming it would be churn; the card's criterion 1 is read as "for a real-registry stub".

84. **Both specs' `after()` restores are asserted by nothing later in the suite.** Skipping the flow spec's
    restore passed 123/123 (equivalent mutant). A one-line probe at the start of the next spec, or a
    suite-level teardown, would make a leaked stub a failure instead of a log line.

85. **Startup-traffic flake, once in six runs:** `NFR-10 … 1 host(s) were contacted while the plugin started
    … api.zotero.org` — Zotero's own traffic, which the spec's comment already names as possible. Count it
    before treating a single NFR-10 failure as a regression.

86. **`P1-T35`'s and `P1-T22`'s blocks now mint identical stub DOIs** (`10.5555/p1t22-pubmed-N`).
    `P1-T35`'s `after()` erases its items first, so no cross-block effect was observed; distinct prefixes
    per block would remove the coupling if that erase ever fails silently.

87. **For the adapter cards `P2-T03` to `P2-T07`:** a spec that needs a stand-in for a shipped source calls
    `replaceForTest` and restores in `after()`, as both specs now do; never register under a spare id.

### 6.18 Raised by `P2-T09`, 2026-10-14 — recorded under rule 9, none carded

88. **Korean and other CJK titles collapse to `""` in `normalizeTitle`** (`docs/02` §11.3.2's `[^a-z0-9]+`
    pass), so they can match on identifiers only. Decide how §11.3.2 treats non-Latin scripts and put
    Korean titles in `P2-T13`'s labelled corpus. A document decision first (`docs/02` is the owner's).

89. **Blocking recall, measured:** a pair `compareRecords` would flag (levSim 0.857) is never compared by
    `dedupeRecords` when the changed word is one of the three longest. `P2-T13` measures the recall lost and
    weighs a second signature per record; worst case (every record in one block) is 124,750 comparisons
    for 500 records, 2.4 s.

90. **`normalizePmid` and `docs/02` §11.3.1 disagree.** The shipped function strips a `PMID:` label and
    returns `null` for anything else; §11.3.1's `normPmid` strips every non-digit. One is wrong; the
    owner picks, then either `src/model/ids.ts` (with `test/unit/model/ids.test.ts`) or the document moves.

91. **§11.3.1's old-style arXiv regex rejects real identifiers** such as `cond-mat.mes-hall/0309136`
    (the class has a dotted subject). `normalizeArxivId` transcribes it verbatim; a document decision.

92. **Two internal disagreements in `docs/02` §11:** the §11.3 tier table's Tier 6 band "MATCH (0.80–0.94)"
    versus §11.3.3 row 4, where `levSim ≥ 0.80` alone is a flag; and §11.3 Tier 4 / §11.5 naming
    `s2PaperId`, which `docs/07` §5.1's `ExternalIds` does not have (only `s2CorpusId`). Document edits.

93. **When `P2-T08` lands,** move `PREPRINT_DOI_PREFIXES` and `BIORXIV_ACCESSION_PREFIXES` from `dedupe.ts`
    into `preprintServers.ts` and import them; `normalizeArxivId`'s tests move from `dedupe.test.ts` to
    `test/unit/model/ids.test.ts` the next time that file is in a card's list.

94. **`matchAgainstLibrary` keeps the first library item claiming an identifier**; a library that itself
    holds two items with one DOI is not resolved here. FR-51's wiring card decides.

95. **What the stage hookup needs** is in `plan/reports/P2-T09.md` under "What the stage hookup will need":
    `dedupeRecords` once over the fan-out output; `SourceFetchReport.recordsDeduplicatedAway` is hard-coded
    `0` at two sites in `stages.ts` and needs an attribution rule; `flags` feed `P2-T14`, `links` feed
    `P2-T11`; FR-51 belongs to the `zotero/` layer. `P2-T10` and `P2-T11` read it before starting.

## 7. Regenerating this file

**Run `npm run index:derive`.** Added 2026-10-12, because this section's rule could not be run and so
was not: `P1-T23`'s report found the header counts stale, and measuring further found §4's tables
stale too — **Phase 1's held 23 of its 46 cards, Phase 2's 18 of 25, Phase 0's 33 of 35, and Phase 1's
`DONE` ticks had never been applied at all.** `scripts/derive-task-index.ts` rebuilds all four tables
and every figure in §1's header from the cards, refuses to empty a table, and **fails loudly when one
of its patterns stops matching** rather than leaving a stale number behind. Checked against a
hand-corrected file, it reproduced the tables exactly.

The tables in §4 are derived from the cards' `ID`, `Depends on`, `Estimate` and
`Human gate` rows. After editing any card, re-derive them and re-run the
consistency check — every `A blocks B` must have a matching `B depends on A`,
and every referenced ID must exist. The check that produced this file found and
fixed **five** defects: three `P1-*` wildcard dependencies left by parallel
authoring, and two cards carrying prose in an ID-only field. (This sentence read
"four defects" while enumerating 3 + 2; the enumeration is the reliable half.)
The 2026-09-09 re-run, after `P2-T17` and `P2-T18` were added, found none in the
editable set and one outstanding item, then recorded as §5 item 6.

**Re-run for this revision (the post-review uniformity pass).** The `ID`,
title, `Depends on`, `Blocks`, `Estimate` and `Human gate` rows of all 100 cards
were re-extracted and §4's four tables were re-derived from them rather than
edited in place. The edge check is clean in both directions — **215 edges,** no
`Depends on` without its matching `Blocks`, no `Blocks` without its matching
`Depends on`, and every referenced ID exists (§5 item 6 records why the count
moved from 216). The per-phase card counts are 28 / 23 / 18 / 31 = 100 and the
estimate sums are 15.50 / 18.75 / 24.25 / 22.00 = **80.50 d**, which is what
§1's table stated at the time of this pass and what `docs/11` §1 then published
(15.5–22 / 18.75–26 / 24.25–34 / 22–31, with an 80.5–113 subtotal). **No card
estimate was changed by this pass.** Those four sums are superseded by the
re-estimate pass recorded at the end of this section, which moved Phase 3 to
23.50 d and the subtotal to 82.00 d; the mechanics described here are unchanged.
Every
state still reads `TODO`, so the header's "100 tasks, all `TODO`, 0 `DONE`"
holds.

Three kinds of divergence were found and fixed. **Eight card titles** were over
`README.md` §4's 60-character limit and were shortened in the cards, so §4's
`P1-T12`, `P1-T22`, `P2-T02`, `P2-T05`, `P2-T09`, `P2-T10`, `P2-T14` and
`P2-T16` rows carry the new wording. **`P2-T15`'s dependency on `P2-T03`** was
stale and is gone, which makes that card an entry point as well as a terminal
(§3). **The `Human gate` field was spelled four different ways** across the four
phase files — `**Yes** — …`, `**yes** — …`, `**yes — …**` and `none — …` —
so a generator keying on `**Yes**` silently missed all six Phase 3 gates and
every "none with a reason". All 100 cards now write either `**Yes** — <what the
human must do>` or the bare word `none`, and `README.md` §4's field rules pin
that spelling.

The gate total, recomputed from the cards rather than carried forward, is
**21 gated cards**: 9 in Phase 0 (`P0-T08`, `P0-T09`, `P0-T11`, `P0-T15`,
`P0-T18`, `P0-T22`, `P0-T25`, `P0-T27`, `P0-T28`), 3 in Phase 1 (`P1-T06`,
`P1-T18`, `P1-T23`), 3 in Phase 2 (`P2-T05`, `P2-T11`, `P2-T13`) and 6 in
Phase 3 (`P3-T04`, `P3-T14`, `P3-T16`, `P3-T20`, `P3-T22`, `P3-T31`). Five
Phase 0 rows that an earlier generation marked 🔒 stay unmarked — see the note
under §4's Phase 0 table — and the two Phase 2 gates retired upstream on
2026-09-09 (`P2-T14`, `P2-T15`) stay retired.

**Round-2 re-run (2026-09-09, reconciling the cards against the second
documentation pass).** All four §4 tables were re-derived from the cards and
compared row-for-row against what this file already carried: **the only row that
changed is `P0-T24`'s `Depends on`**, which gained `P0-T10` (see §5 item 6).
Everything else re-derived identically — 28 / 23 / 18 / 31 = **100 cards**,
15.50 / 18.75 / 24.25 / 22.00 = **80.50 d** (superseded later the same day by the
re-estimate pass below, which took Phase 3 to 23.50 d and the total to 82.00 d),
**21 gated cards** in the same
9 / 3 / 3 / 6 distribution, the same seven entry points (`P0-T01`, `P0-T22`,
`P1-T01`, `P2-T15`, `P3-T01`, `P3-T18`, `P3-T24`) and the same five terminals
(`P0-T28`, `P1-T23`, `P2-T15`, `P2-T16`, `P3-T31`). **No card estimate was
changed by this pass either**, so `docs/11` §1's Phases 0–3 bands and §2's
critical path stand as published. Every `Human gate` cell still reads exactly
`**Yes** — …` (21) or the bare word `none` (79), every card still carries all
eight schema fields, and every card title is still under `README.md` §4's
60-character limit — the longest are `P1-T12`'s and `P2-T15`'s, both at 59.
Every `docs/NN §X.Y`
reference in this folder was checked against the target document's real
headings and all of them resolve.

**Round-3 re-run (2026-09-09, the coordinated estimate re-derivation).** This pass
changed **exactly two card estimates and nothing else**: `P3-T04` from 1.0 d to
**1.75 d** and `P3-T20` from 1.0 d to **1.75 d**, each with its derivation written
into the card's own `Notes` so the figure can be checked rather than trusted.
Both had been flagged as knowingly optimistic by two independent review rounds and
by `plan/04` §4 item 9, which this pass closes. §4's four tables were re-derived
from the cards afterwards: the card counts are unchanged at 28 / 23 / 18 / 31 =
**100 cards**, the gate distribution is unchanged at 9 / 3 / 3 / 6 = **21 gated
cards**, the entry points and terminals are unchanged, the edge check is
unchanged, and the per-phase estimate sums are now
15.50 / 18.75 / 24.25 / **23.50** = **82.00 d**. That is what §1's table states
and what `docs/11` §1's Phases 0–3 low ends are derived from; `docs/11` §1
publishes 15.5–22 / 18.75–26 / 24.25–34 / **23.5–33** with an **82–115**
subtotal, a **155.5–217** project total and the same ≈ **7–10 months** at 21
working days per month (155.5 ÷ 21 ≈ 7.4; 217 ÷ 21 ≈ 10.3). `docs/11` §2's
Mermaid label for Phase 3, its critical path and Phase 5's float were re-derived
in the same pass: the critical path stays **P0 → P1 → P2 → P4 → P6 → P7 ≈
111–155 d** because Phase 2 (24.25–34) still exceeds Phase 3 (23.5–33), but the
margin has narrowed from 2.25 d / 3 d to **0.75 d / 1 d**, so P2 and P3 remain
jointly critical and are more nearly tied than before, not less.

**Decision, 2026-09-30 — two test files for `src/model/ids.ts`, and both stay.**
`test/unit/model/ids.spec.ts` (`P0-T12`, the spike) and `test/unit/model/ids.test.ts`
(`P1-T01`, the shipped module) test the same module with overlapping `normalizeDoi`
cases. `README.md` §4's sixteen-path relaxation covers `src/model/ids.ts` itself but
**not** its test, so this is a real duplication rather than a sanctioned one. The owner
chose to keep both: they pass, they are cheap, and the spike file is the only thing that
proves `vitest.config.ts`'s `setupFiles` ran. **Recorded rather than left implicit**, so
the next reader does not delete one as dead weight or file it as a defect. If the
duplication ever costs something — a `normalizeDoi` change needing edits in two places —
fold the spike's unique cases into `ids.test.ts` and move the `setupFiles` assertion to a
test of its own first.

**Superseded on 2026-09-30, and this paragraph is left as the dated record of the
2026-09-09 pass rather than rewritten.** Every present-tense figure in it — 100
cards, the 15.50 Phase 0 sum, the 82.00 subtotal, the 82–115 band, the 155.5–217
total, the 111–155 critical path — was true when written and is not true now.
Phase 0 finished with **35 cards summing to 17.75 d**, because seven cards
(`P0-T29`–`P0-T35`, 2.25 d) were created mid-phase by `plan/README.md` §5 rule 2
when running the code found work no reading of the corpus had. The current
figures are in §1's table above and were propagated into `docs/11` by `P0-T28` on
2026-09-30: **107 cards**, Phase 0 **17.75–25**, the Phases 0–3 subtotal
**84.25–118**, the project total **157.75–220** (≈ 7–10 months still, 157.75 ÷ 21
≈ 7.5 and 220 ÷ 21 ≈ 10.5), and the critical path **113.25–158**. Two of those
cards, `P0-T34` and `P0-T35`, were created later the same day out of `P0-T28`'s
own escalation rows 13 and 10 — the report's findings became cards, which moved
the figures the report had just corrected. The P2-versus-P3
margin quoted above is unaffected: Phase 0 is upstream of both. **The drift itself
is the finding** — §1's table was kept current card-by-card while four prose
figures in two other documents were not, which is why `P0-T28` had to re-add the
33 `**Estimate**` fields by hand to establish which of three published numbers was
real. `plan/01`'s "Estimate reconciliation" carries that record.

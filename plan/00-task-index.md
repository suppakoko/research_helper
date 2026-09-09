# 00 — Task Index

> **Generated from the task cards in `01`–`04`.** If a row here disagrees with a
> card, the card wins — then regenerate this file.
> **Last updated:** 2026-09-10 · **101 tasks: 2 `DONE`, 99 `TODO`.**

---

## 1. Status

Implementation has started. `P0-T01` and `P0-T29` are `DONE` (2026-09-10, commits `df15816` and `010ede3`);
every other task is `TODO`. Only a human sets a task to `DONE`
(`README.md` §4), so this file will not drift on its own.

| Phase | Tasks | Task-sum estimate | `docs/11` figure (revised 2026-09-09) | Superseded figure |
|---|---|---|---|---|
| 0 — Toolchain spike | 29 | 15.75 d | 15.75–22 d | 6–9 d (+75%) |
| 1 — PubMed slice | 23 | 18.75 d | 18.75–26 d | 9–12 d (+56%) |
| 2 — Multi-source + dedup | 18 | 24.25 d | 24.25–34 d | 12–16 d (+52%) |
| 3 — LLM + summaries | 31 | 23.50 d | 23.5–33 d | 12–15 d (+57%) |
| **Phases 0–3** | **101** | **82.25 d** | **82.25–115 d** | 39–52 d (+58% over the top of the band) |
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
Phases 0–3 subtotal is **82.25 d**, and `docs/11` §1's Phase 3 band, its effort summary, its
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
| `P0-T02` | Scaffold from the template and re-baseline it | `P0-T01`, `P0-T29` | 1.0 d |  |
| `P0-T03` | Write the Zotero 10 manifest and pin the plugin identity | `P0-T02` | 0.25 d |  |
| `P0-T04` | Lay out the directory skeleton and dependency rule | `P0-T02` | 0.5 d |  |
| `P0-T05` | TypeScript config, npm scripts and a green typecheck | `P0-T04` | 0.25 d |  |
| `P0-T06` | Verify `zotero-types` against the Zotero 10 API surface | `P0-T05` | 0.5 d |  |
| `P0-T07` | `bootstrap.js` lifecycle and a central teardown registry | `P0-T05`, `P0-T06` | 0.5 d |  |
| `P0-T08` | Dev profile, `.env`, hot reload and debugger attach | `P0-T07` | 0.75 d | 🔒 |
| `P0-T09` | Build the first XPI and install it on Zotero 10.0.1 | `P0-T03`, `P0-T07` | 0.25 d | 🔒 |
| `P0-T10` | Tools-menu item that creates a `journalArticle` | `P0-T08` | 0.75 d |  |
| `P0-T11` | Prove clean teardown across five disable/enable cycles | `P0-T10` | 0.5 d | 🔒 |
| `P0-T12` | First Node unit test under Vitest | `P0-T05` | 0.5 d |  |
| `P0-T13` | First in-Zotero Mocha test via the scaffold runner | `P0-T08`, `P0-T11` | 1.0 d |  |
| `P0-T14` | CI workflow: lint, typecheck, unit test, build XPI | `P0-T12`, `P0-T13` | 0.75 d |  |
| `P0-T15` | Cross-origin POST with custom headers from inside Zotero | `P0-T08` | 1.0 d | 🔒 |
| `P0-T16` | Streaming (SSE) consumption from inside Zotero | `P0-T15` | 0.5 d |  |
| `P0-T17` | Request abortion | `P0-T15` | 0.25 d |  |
| `P0-T18` | `getStructuredDocumentText` and IMRaD feasibility | `P0-T08` | 0.5 d | 🔒 |
| `P0-T19` | Read Zotero's existing full-text index from a plugin | `P0-T18` | 0.75 d |  |
| `P0-T20` | Create 100 Zotero items in one transaction within NFR-1 | `P0-T10` | 0.5 d |  |
| `P0-T21` | Measure abstract availability across the seven sources | `P0-T08` | 0.5 d |  |
| `P0-T22` | Measure S2 throttling and submit the key application | — | 0.25 d + external wait | 🔒 |
| `P0-T23` | OS keystore and preference round-trip | `P0-T08` | 0.5 d |  |
| `P0-T24` | Fluent localization with an `en-US` and `ko-KR` bundle | `P0-T08`, `P0-T10` | 0.5 d |  |
| `P0-T25` | Gemini TTS Korean quality spike | `P0-T15` | 1.0 d | 🔒 |
| `P0-T26` | Binary/audio response handling and attachment | `P0-T25` | 0.5 d |  |
| `P0-T27` | `update.json` delivery dry run | `P0-T09`, `P0-T14` | 0.5 d | 🔒 |
| ✅ `P0-T29` | Pin line endings with `.gitattributes` | `P0-T01` | 0.25 d |  |
| `P0-T28` | Write and commit the Phase 0 spike report | `P0-T14`, `P0-T15`, `P0-T16`, `P0-T17`, `P0-T18`, `P0-T19`, `P0-T20`, `P0-T21`, `P0-T22`, `P0-T23`, `P0-T24`, `P0-T25`, `P0-T26`, `P0-T27` | 0.5 d | 🔒 |

**Nine of Phase 0's 28 cards carry a gate**, not fourteen: `P0-T08`, `P0-T09`,
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
| `P1-T01` | Declare the canonical model and identifier normalizers | — | 0.75 d |  |
| `P1-T02` | Core primitives: cancellation, clock, errors, logger | `P1-T01` | 1.0 d |  |
| `P1-T03` | Typed preference schema, `PrefStore` port, `prefs.js` rows | `P1-T02` | 0.75 d |  |
| `P1-T04` | Per-host token-bucket rate limiter and backoff | `P1-T02`, `P1-T03` | 1.0 d |  |
| `P1-T05` | HTTP client over `Zotero.HTTP.request` | `P1-T02`, `P1-T03`, `P1-T04` | 1.0 d |  |
| `P1-T06` | Tier-1 `SecretStore` for the NCBI key | `P1-T03` | 0.5 d | 🔒 |
| `P1-T07` | `LiteratureSource` contract and the source registry | `P1-T01` | 0.5 d |  |
| `P1-T08` | PubMed query builder | `P1-T07` | 0.75 d |  |
| `P1-T09` | PubMed adapter: `esearch` → `efetch` | `P1-T05`, `P1-T06`, `P1-T07`, `P1-T08` | 1.25 d |  |
| `P1-T10` | PubMed XML → `SourceRecord` mapper | `P1-T01`, `P1-T09` | 1.25 d |  |
| `P1-T11` | Contract-test harness and PubMed fixtures | `P1-T05`, `P1-T09`, `P1-T10` | 0.75 d |  |
| `P1-T12` | `CanonicalWork` → Zotero item JSON and the `extra` rules | `P1-T01` | 1.0 d |  |
| `P1-T13` | Existing-item detection by DOI and PMID | `P1-T01`, `P1-T12` | 0.5 d |  |
| `P1-T14` | Batched importer and collection operations | `P1-T12`, `P1-T13` | 1.0 d |  |
| `P1-T15` | `ProgressReporter` and its Zotero surfaces | `P1-T02` | 0.5 d |  |
| `P1-T16` | `searchImport` pipeline | `P1-T09`, `P1-T10`, `P1-T14`, `P1-T15`, `P1-T07` | 1.0 d |  |
| `P1-T17` | Provenance record, note writer and JSON export | `P1-T09`, `P1-T14` | 0.75 d |  |
| `P1-T18` | Localization scaffolding for the Phase 1 strings | `P1-T02` | 0.5 d | 🔒 |
| `P1-T19` | Menu entry points and the window opener | `P1-T18` | 0.5 d |  |
| `P1-T20` | Search & Import window: markup and controls | `P1-T03`, `P1-T07`, `P1-T19` | 1.0 d |  |
| `P1-T21` | Result table, selection and filtering | `P1-T20` | 0.75 d |  |
| `P1-T22` | Wire search, import, progress, cancellation, five states | `P1-T16`, `P1-T17`, `P1-T21` | 0.75 d |  |
| `P1-T23` | Phase 1 definition-of-done run | `P1-T11`, `P1-T22` | 1.0 d | 🔒 |

### Phase 2

| Task | Title | Depends on | Est. | Gate |
|---|---|---|---|---|
| `P2-T01` | Ship the user-query parser and per-source render contract | `P1-T07`, `P1-T08` | 1.0 d |  |
| `P2-T02` | Parallel fan-out: per-source timeouts, failure isolation | `P1-T04`, `P1-T07`, `P1-T16` | 1.25 d |  |
| `P2-T03` | Europe PMC adapter | `P2-T01` | 2.0 d |  |
| `P2-T04` | Crossref adapter | `P2-T01` | 1.5 d |  |
| `P2-T05` | Semantic Scholar adapter with unauthenticated degradation | `P2-T01` | 2.0 d | 🔒 |
| `P2-T06` | arXiv adapter | `P2-T01` | 1.25 d |  |
| `P2-T07` | bioRxiv / medRxiv adapter (ID lookup and cross-walk only) | `P2-T01`, `P2-T03` | 1.5 d |  |
| `P2-T08` | `preprint` item-type mapping and server attribution | `P2-T03`, `P2-T06`, `P2-T07` | 1.0 d |  |
| `P2-T09` | Dedup engine: identifier-first cascade, fuzzy fallback | `P1-T01`, `P1-T13` | 2.0 d |  |
| `P2-T10` | Field-merge policy, source precedence, record provenance | `P2-T09` | 1.5 d |  |
| `P2-T11` | Preprint ↔ published-version linking | `P2-T04`, `P2-T05`, `P2-T06`, `P2-T07`, `P2-T09` | 1.0 d | 🔒 |
| `P2-T12` | Batched abstract-backfill pass | `P2-T03`, `P2-T04`, `P2-T05`, `P2-T10` | 0.75 d |  |
| `P2-T13` | Dedup corpus and measured precision/recall report | `P2-T09`, `P2-T10`, `P2-T11` | 2.0 d | 🔒 |
| `P2-T14` | Search & Import window: chips, badges, per-source status | `P2-T02`, `P2-T08`, `P2-T09`, `P2-T10` | 1.5 d |  |
| `P2-T15` | Record and enforce the settled OpenAlex decision: out of v1 | — | 0.25 d (recording the closed decision and wiring the guard; there is no adapter to build) |  |
| `P2-T16` | Phase 2 end-to-end run against the definition of done | `P2-T02`, `P2-T08`, `P2-T09`, `P2-T10`, `P2-T11`, `P2-T12`, `P2-T13`, `P2-T14`, `P2-T17`, `P2-T18` | 1.0 d |  |
| `P2-T17` | Re-run a search from its provenance record | `P1-T13`, `P1-T17`, `P1-T19`, `P2-T01`, `P2-T14` | 1.5 d |  |
| `P2-T18` | Translator import path behind `useTranslators` | `P1-T14`, `P2-T08`, `P2-T12` | 1.25 d |  |

### Phase 3

| Task | Title | Depends on | Est. | Gate |
|---|---|---|---|---|
| `P3-T01` | Secret wrapper and unconditional log redaction | — | 0.5 d |  |
| `P3-T02` | `SecretStore` tier 1 — OS keychain via `Services.logins` | `P3-T01` | 0.75 d |  |
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

## 6. Regenerating this file

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

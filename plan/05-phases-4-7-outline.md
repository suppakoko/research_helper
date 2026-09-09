# Phases 4–7 — Outline

> **What this file is.** The shape of Phases 4, 5, 6 and 7 at one level above task
> cards: named work areas, the conditions under which each phase can be
> decomposed, the decisions that must land first, and the specific findings that
> would restructure the phase.
>
> **What this file deliberately is not.** Task cards. Phases 0–3 are decomposed in
> [`01`](01-phase-0-toolchain-spike.md)–[`04`](04-phase-3-llm-summaries.md);
> these four are not, and §0 says why.
>
> **Owning documents.** [`docs/11`](../docs/11-implementation-roadmap.md) §1 owns
> goals, deliverables, definitions of done and effort; §3 owns the risk register;
> §4 owns the spike list; §5 owns the product-owner decision points. This file
> references those; it does not restate their values. The one exception is each
> phase's effort band in §1–§4 below, which is quoted from `docs/11` §1 together
> with its **basis** — and every one of the four is currently ⚠ *scaled ×1.50,
> not decomposed*, i.e. inference rather than measurement. `docs/11` §1 and its
> effort-summary table remain authoritative; if they move, these four lines move
> with them.
>
> **The ×1.50 factor and where it comes from.** `docs/11` §1's preamble owns the
> derivation and this file does not restate it: the factor is the Phases 0–3 card
> sum divided by 52, the top of the old 39–52-day band. It was recomputed on
> 2026-09-09 after `P3-T04` and `P3-T20` were re-estimated — 82.0 ÷ 52 = 1.577,
> against 80.5 ÷ 52 = 1.548 before — and **deliberately held at 1.50**, so the
> four bands quoted below are unchanged. The reasoning is in `docs/11` §1: a
> 1.5-day change to a measured phase moves the factor by 1.9%, which on Phase 4's
> 11-day base is 0.32 d, and chasing that would be false precision; holding at
> 1.50, which is below both computed values, also keeps the inferred figures on
> the conservative side of what the measured phases found. Read the two documents
> together — neither is to be changed without the other.
>
> **Last updated:** 2026-09-09 · **Status:** outline only; no task IDs allocated
> in the `P4-*`–`P7-*` ranges.

---

## 0. Decomposition policy

**Decompose phase N+1 at the end of phase N.** Phase 4's task cards get written
when Phase 3 is done, Phase 5's when Phase 4 is done, and so on. Until then this
outline is the plan of record for these phases.

`plan/README.md` §2 already states the reason; this section states the mechanics.

**Why front-loading is waste here, specifically.**

1. **Nineteen spikes are unresolved.** `docs/11` §4 lists V-1 … V-18 (V-8b
   included) as assumptions that "if wrong, invalidate parts of the
   architecture". Twelve of them — V-6, V-7, V-8, V-8b, V-9, V-10, V-11, V-14,
   V-15, V-16, V-17, V-18 — reach into Phases 4–7, and §§2.2, 3.2 and 4.2 below
   name V-14, V-10/V-11 and V-17/V-18 respectively as hard entry conditions for
   Phases 5, 6 and 7. A task card's `Files` and `Do NOT` fields are
   exactly the fields that a spike outcome rewrites, and the schema in
   `plan/README.md` §4 forbids a card that cannot name its files. Cards written
   now would either name the wrong files or be too vague to satisfy the schema.

2. **One spike is on the critical path by decision.** D7 (`docs/00` §3) made full
   text the default, which put the IMRaD section detector there with it
   (`docs/11` R-19b). V-8b decides whether section provenance exists at all. If
   it does not, the `PaperSummary` fields that Phase 4's digest projection
   (`docs/06` §8.2) reads change shape, and the report's §2 analysis-depth
   disclosure (`docs/06` §9.1) changes with them. That is not a tweak to a task
   card; it is a different set of task cards.

3. **The gating inputs are information, not code.** §5 of this file lists, per
   phase, the `> **Unverified:**` markers and the `docs/10` §5 open questions
   that block decomposition. Most of them are resolved by running one call,
   reading one response, or getting one answer from the product owner — none of
   which is unblocked by writing cards earlier.

4. **Task cards are cheap to write and expensive to maintain.** A card carries
   `Depends on` / `Blocks` edges that `00-task-index.md` validates. Every card
   written early is an edge that has to be re-checked each time a spike lands.

5. **The estimates would not improve.** `plan/README.md` §7 expects a phase's
   task sum to exceed `docs/11`'s phase figure, because decomposition surfaces
   hidden work. Decomposing against unverified assumptions surfaces the wrong
   work and produces a false-precision number that then gets planned against.
   Note what this argument does *not* claim: `docs/11` R-23 (new 2026-09-09)
   records that Phases 4–7's figures are the old ones scaled by the ×1.50
   correction factor measured on Phases 0–3, so they are inference and may hide
   the same unpriced deliverables the four decomposed phases did. The remedy
   `docs/11` R-23 and §5's per-phase decision row both name is decomposition **at
   the end of the phase before it** — which is exactly this policy — not
   decomposition now.

**What this outline must be good enough for.** Sequencing, staffing, and lead-time
gates. In particular, the Semantic Scholar key application (`docs/11` R-3) must
be submitted in week 1 of Phase 0 even though Phase 5 is months away — see
[`06-human-gates.md`](06-human-gates.md) G-03. That is the class of decision this
file exists to support.

**Exit from outline into cards.** A phase leaves this file when (a) its entry
conditions in §1–§4 are all satisfied or explicitly waived, (b) its decisions
are recorded in the owning documents named below, and (c) the phase before it is
`DONE`. At that point a `plan/0N-phase-N-*.md` file is written to the
`plan/README.md` §4 schema and this file's section for that phase is reduced to a
pointer. **Decomposition is not finished until the numbers move with it:**
`docs/11` §1 and R-23 both require that phase's scaled figure to be replaced by
the card sum, and `docs/11` §1's total, §2's critical path and the months figure
to be re-derived from it.

---

## 1. Phase 4 — Trend report

**Goal, deliverables, definition of done:** `docs/11` §1, Phase 4.
**Effort:** 16.5–23 developer-days — ⚠ **scaled ×1.50, not decomposed**
(`docs/11` §1, Phase 4, and the effort summary table; re-derived 2026-09-09 from
the old 8–11 band, not measured). Replace with a card sum when this phase is
decomposed, per §0 and `docs/11` R-23.
**Risks retired:** R-7, and R-6 completes here (`docs/11` §3.1 maps Phase 4 to
R-6 and R-7; §1's phase entry says "R-7, part of R-6").
**Upstream:** Phases 2 and 3 both (`docs/11` §2).

### 1.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W4-1 | **Digest projection** | The deterministic, no-LLM compression of a `StoredSummary` into the ~90–140-token digest that clustering runs on (`docs/06` §8.2) — the design's load-bearing trick and the cheapest thing in the phase to get wrong. |
| W4-2 | **Hierarchical synthesis engine** | The L0–L4 map-reduce driver with its pass counter, two-stage clustering for large N, per-theme sub-batching, and the depth-2 recursion cap (`docs/06` §8.3–§8.5); FR-27's reported pass count comes from here. |
| W4-3 | **Prompt wiring and structured-output validation** | Binding `THEME_CLUSTER`, `CLUSTER_REDUCE`, `TREND_REPORT_EN`/`_KO` and their client-side validators (`docs/12` §8–§11) to the Phase 3 provider layer under `docs/12` §18's model-agnostic rules and §17's prompt versioning. |
| W4-4 | **Client-generated report scaffolding** | Everything the model must not produce: the title block, the year table, the study-design frequency table, and Appendices A and B (`docs/06` §9.1) — generated in code precisely to remove a class of hallucination. |
| W4-5 | **Citation binding, validation, and bibliography** | The `[[itemKey]]` convention, the pre-render validator that resolves every marker against the run's valid set, and bibliography rendering through Zotero's own citation processor rather than the model (`docs/06` §10.1, §10.3); this is the whole of R-7's mitigation. |
| W4-6 | **Note rendering, saving, and Markdown export** | Markdown → Zotero note HTML with the correct `data-schema-version` wrapper, the save path, and the "Export as Markdown" action (`docs/06` §14.1–§14.3). |
| W4-7 | **Self-critique pass** | The `SELF_CRITIQUE` call and the revise/pass loop (`docs/06` §12.2, `docs/12` §12), plus the quality rubric it is scored against (`docs/06` §12.3). |
| W4-8 | **Korean report path** | `TREND_REPORT_KO` end to end (`docs/12` §11), including the requirement that titles, authors and venues stay in original script (`docs/11` §1 Phase 4 DoD). |
| W4-9 | **Report dialog and progress** | The modeless dialog, per-pass determinate progress, cancellation, and the spend counter — shaped by whether V-8 says streaming is usable (`docs/11` R-14). |
| W4-10 | **Evaluation set and determinism guard** | Three curated collections with human-checked expected themes, plus the fixed-temperature repeat-run check that `docs/11` §1's DoD requires across 3 runs (`docs/06` §11.1, §12.3). |

### 1.2 Entry conditions

Phase 4 cannot be decomposed into task cards until all of the following are true.

- **Phase 3 is `DONE`** and a real corpus of `StoredSummary` rows exists
  (`docs/07` §8.3). Phase 4 reduces summaries; it cannot be specified against a
  hypothetical summary shape.
- **V-8b has an answer, and R-19b has been closed one way or the other.**
  `docs/11` R-19b requires the 40-PDF fixture measurement before Phase 3 ships.
  Whether section provenance survives determines the digest's fields (W4-1) and
  the honesty section's analysis-depth split (W4-4). The `> **Unverified:**` in
  `docs/06` §3.3 (the serialization of `getStructuredDocumentText`) and the one
  in `docs/06` §4.3 (detector accuracy unmeasured, with the ≥ 85 % action item)
  are the two markers to check as closed.
- **V-8 has an answer.** Streaming usable or not usable decides W4-9's design
  (`docs/11` §4.2 V-8, R-14; `docs/01` §8.4 carries the matching
  `> **Unverified:**` about `res.body` being a live `ReadableStream`).
- **The bibliography entry point is confirmed or its fallback accepted.**
  `docs/06` §10.3 marks the programmatic citeproc entry point
  `> **Unverified:**` and asks whether `docs/01` or `docs/06` owns the
  verification (`docs/06` §16 question 3). W4-5 cannot name its files until that
  is answered.
- **The cache-key hash primitive is confirmed.** `docs/06` §11.2 marks
  `crypto.subtle` availability in the bootstrapped-plugin scope
  `> **Unverified:**`, with `Zotero.Utilities.Internal.md5` as the collision-risk
  fallback.
- **The note-HTML surface is confirmed.** `docs/01` §5.7 marks the sanitisation
  whitelist and the absence of a public Markdown→HTML helper
  `> **Unverified:**` — W4-6 depends on both.
- **Progress-UI API shapes are confirmed.** `docs/07` §7.7 marks the
  `Zotero.ProgressWindow` / `ItemProgress` signatures `> **Unverified:**`, and
  `docs/01` §10.4 records the decision *not* to use `Zotero.ProgressQueue`;
  W4-9 needs both settled.
- **`docs/10` §5 questions 7, 11, 12 and 19 are answered** (see §5 for what each
  gates), and question 6's residual half — whether either ceiling ships non-zero
  — is answered, because a trend-report run is the single most expensive action
  in the product.
- **Token-estimation ratios have been replaced by measurements.** `docs/06` §5.1
  marks the ratios `> **Unverified:**` with an action item to derive a rolling
  per-model correction factor from real `usage` blocks. Phase 3 produces those
  blocks; Phase 4's cost preview is only as good as they are.

### 1.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Report re-run behaviour — always a new note, or "update in place" with a diff | `docs/06` §14.2 (with the pref key, if any, in `docs/07` §8.5); the question is `docs/06` §16 item 6 |
| Whether a generated note may be overwritten when the user has edited it (hash mismatch) | `docs/07` §8.5 for the pref; the question is `docs/10` §5 question 11 |
| Group-library report visibility — shared note by default or private | `docs/09` §3 and `docs/07` §8.5; questions are `docs/06` §16 item 7 and `docs/10` §5 question 12 |
| Bibliography path — Zotero's citation processor, or the `itemToCSLJSON` fixed-format fallback that ignores the user's style | `docs/01` (the confirmed API) with `docs/06` §10.3 updated to point at it |
| Whether the report claims section provenance for full-text-derived findings | `docs/06` §4.3, following the R-19b outcome in `docs/11` §3 |
| Whether the self-critique pass runs by default, given it is an extra call on every report | `docs/07` §8.5 for the shipped default; semantics stay in `docs/06` §12.2 |
| Backlinks from cited items to the report note — on or off by default | `docs/06` §10.4 names the pref gate; the value belongs in `docs/07` §8.5 |

### 1.4 What would change the plan

- **V-8b fails (no usable geometry).** `auto` degrades to whole-document chunking
  and the summary prompt drops section provenance (`docs/11` R-19b). W4-1 loses
  its section-labelled digest fields, W4-4's §2 disclosure becomes coarser, and
  W4-3's prompts change. If the product owner instead flips D7's default back to
  abstracts, the map stage's cost drops by the 8×–32× factor named in `docs/00`
  §3 D7 and NFR-5's headroom changes — which is a Phase 3 re-plan that Phase 4
  inherits.
- **Streaming turns out to be unavailable.** W4-9 is built around determinate
  per-pass progress instead of token-level streaming, which `docs/11` R-14
  already names as an acceptable substitute. This *shrinks* the phase.
- **The citeproc entry point does not exist as a plugin-facing API.** W4-5 splits:
  the validator stays, the bibliography falls back to a fixed format built from
  `itemToCSLJSON`, and "honours the user's citation style" leaves v1 and becomes
  a README limitation (`docs/13` §7.3 item 7).
- **The determinism DoD fails** — three runs at fixed temperature not producing
  substantively equivalent themes. Either the temperature policy (`docs/06`
  §11.1) tightens, or clustering moves partly client-side onto the digests. Both
  are new work areas, not variations of existing ones.
- **`crypto.subtle` is unavailable.** The cache key falls back to
  `Zotero.Utilities.Internal.md5` with the collision caveat `docs/06` §11.2
  states, which changes cache-invalidation semantics and therefore W4-2's resume
  behaviour.
- **Cross-lingual summary quality proves poor.** `docs/06` §13.2 marks
  Korean/Chinese/Japanese source → English summary quality `> **Unverified:**`
  with a 20-paper multilingual fixture action item. A bad result adds a screening
  rule and shrinks the corpus a report may claim to cover.

---

## 2. Phase 5 — Related papers + recommendations

**Goal, deliverables, definition of done:** `docs/11` §1, Phase 5.
**Effort:** 21–29 developer-days — ⚠ **scaled ×1.50, not decomposed**
(`docs/11` §1, Phase 5, and the effort summary table; re-derived 2026-09-09 from
the old 10–14 band, not measured). `docs/11` §1's Phase 5 entry adds a second,
opposite-signed uncertainty specific to this phase — see §2.4 below.
**Risks retired:** R-3 fully, and R-19 validated at scale (`docs/11` §1 and §3.1).
**Upstream:** Phase 2's fan-out and Phase 3's LLM client (`docs/11` §2).

### 2.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W5-1 | **Seed resolution** | DOI/PMID/arXiv → canonical record, with the title-match fallback, its confidence threshold, and the disambiguation UI that must appear rather than a silent guess (FR-13, FR-14; `docs/05` §6.1). |
| W5-2 | **Citation-graph gathering** | References and citations from Crossref, Europe PMC and PubMed `elink`/pmra, which together are the path that must work with no Semantic Scholar key at all (`docs/05` §2, §4). |
| W5-3 | **Semantic Scholar Recommendations adapter** | Both endpoints, `from=recent` only, batch validation of every seed ID before a POST, the 10 MB response cap, and the conservative positive-seed cap (`docs/05` §3). |
| W5-4 | **Embedding layer** | SPECTER2 via Semantic Scholar as the default, a third-party embedding fallback, and the lexical floor when neither is available — with the never-mix-two-spaces rule and per-vector model tagging (`docs/05` §5.1, §5.3, §5.5). |
| W5-5 | **Vector storage** | Where the vectors live client-side and how the cap interacts with NFR-8 (`docs/05` §5.4; the persisted shape is `docs/07` §5.2 and §8.3). |
| W5-6 | **Collection profiler** | `CollectionProfileDraft` → the persisted `CollectionProfile`: IDF-weighted MeSH and keyword extraction, authors and venues, *k* centroids for the multi-topic case, and the editable profile UI (FR-44; `docs/05` §7.2). |
| W5-7 | **Candidate generation** | LLM-assisted query generation with a heuristic fallback, reusing Phase 2's fan-out executor (FR-45; `docs/12` §15 `COLLECTION_PROFILE`). |
| W5-8 | **Scoring, ranking and reason chips** | The blended score, the recency de-emphasis, and the human-readable reason attached to every candidate (FR-15, FR-47; `docs/05` §6.2, §7.4, `docs/12` §16 `RECOMMEND_RANK`). |
| W5-9 | **Review, exclusion and import** | Owned-item exclusion, dismissed-candidate persistence, the "in library" marking, optional Zotero *Related* linkage, and import into the dated recommendation subcollection (FR-16, FR-17, FR-18, FR-46, FR-48, FR-49). |
| W5-10 | **Rate-limit-aware batching, caching and evaluation** | The per-host budgeting, backoff and cache design that make the feature usable inside a 1 req/s ceiling (`docs/05` §9), plus the held-out precision@k harness and sanity checks that make its quality falsifiable (`docs/05` §8). |

### 2.2 Entry conditions

- **Phases 2 and 3 are `DONE`.** W5-7 reuses Phase 2's fan-out and Phase 3's
  provider layer directly.
- **V-14 has an answer.** `docs/11` §4.3 V-14 measures unauthenticated Semantic
  Scholar behaviour *and* requires the key application to have been submitted.
  The measurement decides whether the no-key path in W5-2/W5-3 is merely slower
  or unusable.
- **The Semantic Scholar key is either in hand or formally written off.** This is
  the phase's real gate and it is an approval queue, not code — `docs/11` R-3
  says issuance "can take weeks" and instructs applying in week 1 of Phase 0.
  See [`06-human-gates.md`](06-human-gates.md) G-03 and G-26.
- **`docs/10` §5 question 8 is answered** — whether a Semantic Scholar key is a
  hard requirement. If the answer moves off the recommended "no", W5-2 and W5-4's
  fallback tiers stop being optional politeness and become the phase.
- **The embedding route is decided, and the default provider's capability is
  known.** `docs/03` §13 marks OpenRouter's embedding coverage
  `> **Unverified:**` and §16's capability matrix carries the same "Unverified"
  in the OpenRouter column. D6 makes OpenRouter the default provider, so a user
  on the default path may have no embedding endpoint at all; `docs/03` §16
  already documents the Anthropic-only case as falling back to BM25.
- **The positive-seed cap is probed.** `docs/05` §3.3 marks the maximum
  `positivePaperIds`/`negativePaperIds` `> **Unverified:**` and instructs capping
  at 10–20 pending measurement. W5-6's seed-selection strategy sits on that
  number.
- **Phase 2's preprint policy is settled** (`docs/10` §5 question 2). `docs/05`
  §3.2 records that `from=recent` skews to preprints, so the recommendation UI
  inherits whatever Phase 2 decided about preprint/published pairs — including
  the `> **Unverified:**` in `docs/02` about whether legacy `10.1101/` DOIs are
  being re-minted.
- **Per-host limits used by W5-10 are as settled as they will get.** Europe PMC's
  rate limit is `> **Unverified:**` in three places (`docs/02`, `docs/07` §7.3,
  `docs/09` §5.5) and bioRxiv/medRxiv publish none at all (`docs/09` §5.6). These
  do not block decomposition, but the cards must not pretend to a number the
  documents do not have.

### 2.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Does Phase 5 ship if no Semantic Scholar key was granted, and with what reduced DoD | `docs/11` §1 Phase 5 DoD and `docs/05` §3; the question is `docs/10` §5 question 8 |
| Embedding route for v1 — SPECTER2 only, SPECTER2 + third-party fallback, or lexical only | `docs/05` §5 for the design, `docs/07` §8.5 for any pref |
| What a user on the D6 default provider gets when that provider cannot embed | `docs/03` §16's recommended-defaults table, extended |
| Vector storage layout and its share of the NFR-8 cap | `docs/05` §5.4 and `docs/07` §8.3/§8.5 |
| Whether recommendation runs may spend LLM tokens under the standard pre-run confirmation, or need their own | `docs/10` §5 question 7's answer, reflected in `docs/08`'s consent flow |
| Preprint presentation — badge, and whether a "peer-reviewed only" filter ships and defaults on | `docs/05` §3.2 and `docs/08` |
| Whether implicit user feedback (`docs/05` §8.4) is collected locally in v1 | `docs/05` §8.4 and `docs/09` §3.7's clearable-data list |

### 2.4 What would change the plan

- **The key is denied, or arrives after Phase 5 would have started.** W5-3 and the
  SPECTER2 half of W5-4 are deferred; W5-2's citation-graph path and W5-4's
  lexical floor become the product. The phase's DoD reduces to the "with no
  Semantic Scholar key" clause that `docs/11` §1 already states, and R-3 is
  retired by proving the fallback rather than by using the key. Effort probably
  drops toward the bottom of the 21–29-day band `docs/11` §1 now carries; quality
  provably drops.
- **V-14 shows unauthenticated access is unusable rather than slow.** Phase 5
  cannot be validated at all without the key, and it should be re-sequenced after
  Phase 6 so the key's queue has more calendar time. This is the single strongest
  argument for keeping this phase in outline form. The re-sequencing lever is
  weaker than it was, and that is good news rather than bad: `docs/11` §1's
  2026-09-09 re-estimate already pushes Phase 5's earliest start to ≈ 3–4 months
  in (`docs/11` R-3), so a week-1 application has most of that time to clear
  before the question arises at all. `docs/11` §2 also notes that Phase 5's
  ≈ **10.5–15 d** of float exists only if a second developer takes it in parallel;
  under single-developer serial execution there is no float to trade. (That figure
  was ≈ 13–18 d until the 2026-09-09 `P3-T04` / `P3-T20` re-estimate; `docs/11` §2
  owns it and carries both routes into P5 and the arithmetic for each.)
- **OpenRouter has no embedding endpoint.** Either a second key becomes a soft
  requirement for W5-4 — which is a new human gate and a new first-run flow — or
  BM25 (`docs/05` §5.5) is promoted from floor to default for the default
  provider, which changes W5-8's scoring weights.
- **The positive-seed cap is far below 10.** W5-6's centroid and seed-selection
  design changes from "pick the 10–20 highest-signal seeds" to iterating small
  batches, which multiplies W5-10's request budget under a 1 req/s ceiling.
- **Held-out precision@k comes back at chance level.** `docs/05` §8 exists
  precisely because "everything looks plausible"; a failing harness sends W5-8
  back to design rather than shipping a recommender nobody can falsify.

---

## 3. Phase 6 — TTS audio report

**Goal, deliverables, definition of done:** `docs/11` §1, Phase 6.
**Effort:** 15–21 developer-days — ⚠ **scaled ×1.50, not decomposed**
(`docs/11` §1, Phase 6, and the effort summary table; re-derived 2026-09-09 from
the old 7–10 band, not measured), with `docs/11` naming audio container assembly
and Korean quality iteration as the unpredictable parts — and noting that neither
is bounded by the scaling.
**Risks retired:** R-8.
**Upstream:** Phase 4's report and Phase 3's provider layer (`docs/11` §2).

### 3.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W6-1 | **TTS provider abstraction and Gemini client** | The `TTSProvider` interface R-8's mitigation requires, plus the Gemini client over whichever of the two API surfaces is chosen, with the model ID resolved from the live model list rather than hardcoded (`docs/04` §2.1, §2.2). |
| W6-2 | **Spoken-script generation** | The rewrite pass that turns a written report into speech — markdown and citation stripping, number and abbreviation expansion, target-length control — plus `validateScript()` and its single retry on leaks (`docs/04` §8, `docs/12` §13–§14). |
| W6-3 | **Korean-specific handling** | Embedded English technical terms, the per-collection glossary, numbers and units, and language defaulting (`docs/04` §9) — the part `docs/11` calls unpredictable. |
| W6-4 | **Chunking and sequencing** | Sentence- and paragraph-aware splitting with language-dependent size targets, voice consistency across chunks, and bounded concurrency (`docs/04` §5). |
| W6-5 | **Audio assembly** | Raw PCM concatenation with inter-chunk silence, the WAV header writer, and the single-chunk MP3 path (`docs/04` §3, §6). |
| W6-6 | **Delivery into Zotero** | The standalone item, the report as child note, the audio as child attachment, and the import-versus-link rule with its size threshold and `contentType` (`docs/04` §10). |
| W6-7 | **Cost estimation, duration derivation and cancellation** | Resolving `tts.targetMinutes` in its auto state via `docs/04` §12's derivation, showing chunk count and estimated duration and cost before proceeding, and making cancel real (FR-42). |
| W6-8 | **Failure and disclosure paths** | FR-43's save-the-script-as-text fallback, the unentitled-key path, and the second, independent destination disclosure that `docs/09` §3.4 rule 5 requires because audio uses Google even when summarization did not. |
| W6-9 | **Offline "Read aloud"** | The separate `speechSynthesis` action, with Korean disabled when `getVoices()` returns no `ko-*` voice and the `voiceschanged` race handled (`docs/04` §7.1, §12 item 7). |
| W6-10 | **Audio dialog** | The UI that carries voice selection, language, the live cost estimate, progress across chunks, and cancellation. |

### 3.2 Entry conditions

- **Phase 4 is `DONE`** — there must be a real report to speak.
- **V-10 passed in Phase 0** (`docs/11` §4.2): a 200-word Korean script with
  embedded English terms returned audio that a native speaker judged acceptable.
  `docs/11` §4's closing note says explicitly that if V-7 or V-10 fails, stop and
  re-plan. Phase 6 as described does not exist if V-10 failed.
- **V-11 passed** — binary/arraybuffer handling, writing a file into the storage
  directory, and registering it as an attachment. W6-5 and W6-6 are unwritable
  otherwise.
- **The audio output token rate has been measured.** `docs/04` §4.2 marks the
  25-tokens-per-second conversion `> **Unverified:**` and states that *the whole
  TTS cost model inherits this uncertainty*, with the instruction to make one
  real call, read `usageMetadata.candidatesTokenCount`, divide by the measured
  duration, and calibrate. Until that number exists, W6-7 cannot be specified
  and every per-minute figure in `docs/04` §11 is an order of magnitude, not a
  quote. `docs/04` §4.2 also asks for re-verification by 2026-12-01 regardless.
- **The per-request audio duration ceiling is understood.** `docs/04` §4.1 marks
  the absence of a documented maximum audio duration `> **Unverified:**`, and
  notes that Google's own first-party guidance about quality drift past a few
  minutes is the argument for chunking independent of any token accounting.
- **`docs/10` §5 questions 9 and 10 are answered** — the audio register, and
  Korean-native generation versus translation. `docs/11` §5 lists both as
  "Before Phase 6".
- **`docs/12` §19 item 6 is answered** — when only an English report exists,
  whether the Korean script is generated from it or a Korean report is generated
  first. This is a distinct question from `docs/10` §5 question 10 and it changes
  W6-2's call graph and cost.
- **The voice-set question is closed.** `docs/04` §2.7 marks
  `> **Unverified:**` whether the Interactions API's voice set matches the legacy
  `generateContent` set, with an explicit instruction not to hardcode the names.
- **The attachment API signature is confirmed.** `docs/04` §10.1 marks
  `Zotero.Attachments.importFromFile`'s exact signature and option set
  `> **Unverified:**`, quoting Zotero's own documentation that this area "requires
  a lot of looking around in the source code".
- **The Gemini tier position is settled and disclosed.** `docs/09` §3.3 states
  that a free-tier user generating an audio report has sent their trend report to
  Google for product improvement with human reviewers able to read it, and
  `docs/09` §3.5 refuses the Gemini free tier in strict mode. `docs/09` §3.4
  rule 4 marks `> **Unverified:**` whether a programmatic billing signal exists
  at all. See [`06-human-gates.md`](06-human-gates.md) G-06.

### 3.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Audio register (`docs/10` §5 question 9) | `docs/04` §8.1 and the `docs/12` §13/§14 templates |
| Korean script source — native generation vs. translation of the English report (`docs/10` §5 question 10; `docs/12` §19 item 6) | `docs/04` §9.4 and `docs/12` §14 |
| Primary Gemini API surface — legacy `generateContent` or Interactions | `docs/04` §2.1, with the ZDR consequence (`store: false`) recorded in `docs/09` §3.3 |
| Whether the OpenAI TTS fallback ships in v1 | `docs/04` §7.5. **No longer blocked on a missing price:** `docs/04` §7.2 carries `gpt-4o-mini-tts`'s per-token pricing re-confirmed 2026-09-08. What remains is a product decision, plus §7.2's own warning that mixing a per-character model (`tts-1`/`tts-1-hd`) and a per-token one in a single estimator is the trap (`docs/04` §11) |
| Shipped `tts.outputFormat` default, and therefore whether the typical report is imported or linked | value in `docs/07` §8.5; the rule stays in `docs/04` §10.2 |
| Whether audio is offered at all on an unconfirmed-tier Gemini key | `docs/09` §3.4 rule 4 and §3.5 |
| Whether "Read aloud" ships in v1 given no Korean system voice may exist | `docs/04` §7.1, whose Windows Korean-voice availability is `> **Unverified:**` |

### 3.4 What would change the plan

- **The measured token rate differs materially from 25/s.** Every per-minute and
  per-report figure in `docs/04` (§11 included) is re-derived, W6-7's estimator
  changes, and if the real rate is much higher the 32k-context math in `docs/04`
  §4.1 tightens the chunk targets in W6-4.
- **Korean quality is marginal rather than good.** Either Korean audio ships
  behind a flag with the FR-43 text fallback as the honest default, or OpenAI TTS
  is promoted to primary for Korean (`docs/04` §7.5 rank 2) — which needs a
  second provider key and therefore a new human gate, plus the estimator work
  `docs/04` §7.2 warns about (that model is token-priced while `tts-1`/`tts-1-hd`
  are character-priced), and it inherits §7.2's own caveat that OpenAI's voices
  are English-optimized.
- **Interactions rather than legacy is chosen as primary.** `speech_config`'s
  explicit `language` field removes the mixed-language guessing that W6-3 exists
  to mitigate (`docs/04` §2.8), and the response shape changes W6-5. It also
  binds the feature to `store: false` for any ZDR project (`docs/09` §3.3).
- **`importFromFile` differs from the assumed shape.** W6-6 is re-planned, and
  the import-versus-link threshold logic may have to move.
- **A TTS model ID is deprecated mid-phase.** All three IDs in `docs/04` §2.2
  carry `-preview`. This is why W6-1 resolves the model from the live list; a
  deprecation should cost a preference change, not a release.

---

## 4. Phase 7 — Polish, i18n, prefs, release

**Goal, deliverables, definition of done:** `docs/11` §1, Phase 7.
**Effort:** 21–29 developer-days — ⚠ **scaled ×1.50, not decomposed**
(`docs/11` §1, Phase 7, and the effort summary table; re-derived 2026-09-09 from
the old 10–14 band, not measured). `docs/11` §1 flags this as the phase whose
listed-but-unpriced work — the accessibility pass, the redaction audit, the
three-platform QA run, the Korean native-speaker review — is hardest to bound in
advance, which is the failure mode the ×1.50 factor was measured on.
**Risks retired:** R-10, R-15, R-20, R-22; R-1 moves to ongoing operational
handling (`docs/11` §1 and §3.1).
**Upstream:** Phases 4, 5 and 6 all (`docs/11` §2 — Phase 7 gates the release on
everything).

### 4.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W7-1 | **Localization completion** | Complete `en-US` and `ko-KR` Fluent bundles, no hard-coded strings, `Intl` formatting, and the CI key-parity check flipped from warn to error (FR-55, NFR-11; R-22's mitigation in `docs/11` §3). |
| W7-2 | **Korean review by a native speaker** | Review of the UI strings *and* the Korean prompts, whose academic register and term-with-English-in-parentheses convention `docs/12` §19 item 4 flags as written by a non-native-reviewed process. |
| W7-3 | **Accessibility pass** | Keyboard navigation, focus order, accessible names, light/dark contrast, and the NVDA/VoiceOver smoke test (NFR-13; `docs/08` §9). |
| W7-4 | **Preferences consolidation** | Defaults review against `docs/07` §8.5, the "Clear cache" action, per-namespace storage accounting and cap enforcement (NFR-8), and the clear/delete coverage `docs/09` §3.7 requires. |
| W7-5 | **Error-message and redaction audit** | Every message against NFR-14, the "Copy diagnostics" action, and the log-redaction audit that proves NFR-16 by grepping a full job's debug output (FR-54; `docs/09` §2, §7). |
| W7-6 | **Performance and resource profiling** | Startup, idle and peak memory, and main-thread task duration against NFR-3, NFR-7, NFR-10, plus the XPI size cap NFR-18 (R-10). |
| W7-7 | **Security review** | The `docs/09` §7 checklist end to end, with its `[BLOCKER]` items treated as release blockers rather than findings. |
| W7-8 | **Documentation** | README with all ten required sections, `README.ko.md`, CHANGELOG and screenshots (`docs/13` §7.3), plus `SECURITY.md` with a contact address and a stated response expectation, which is `docs/09` §6.3's requirement and a line item in `docs/09` §7's supply-chain checklist rather than a `docs/13` §7.3 one. |
| W7-9 | **Release engineering** | The tagged-build release workflow, generated `update.json`/`update-beta.json` with `sha256` hashes, the `strict_min_version`/`strict_max_version` policy, and a proven in-place upgrade (`docs/13` §5.2, §6.2, §6.3; R-15). |
| W7-10 | **Manual QA execution** | `docs/13` §8's full checklist on Windows, macOS and Linux, including the offline behaviour section (NFR-9) and the large-library performance runs. |
| W7-11 | **Distribution** | The Zotero Forums announcement, submission to the community lists, and the watch for the official registry (`docs/13` §7.2; R-20). |

### 4.2 Entry conditions

- **Phases 4, 5 and 6 are `DONE`.**
- **V-17 has an answer** — Fluent registration on Zotero 10 including the `ko-KR`
  bundle with English fallback (`docs/11` §4.3). Two related markers must be
  closed with it: `docs/01` §9.2's `> **Unverified:**` about which
  `Localization` argument form to use for a plugin's own files, and the
  `Zotero.ftl.addResourceIds` marker in `docs/01` §10.4, mirrored in `docs/08`
  §8.2.1.
- **V-18 has an answer** — `update.json` delivery end to end. `docs/13` §6.3
  additionally marks `> **Unverified:**` how Zotero reconciles a widened
  `strict_max_version` in the manifest against the narrower value inside an
  installed XPI, and says to verify this in V-18 *before relying on the
  manifest-only bump as the primary compatibility strategy*. That strategy is
  what `docs/13` §6.3 calls the project's single most valuable operational lever
  against R-1.
- **`docs/10` §5 question 20 is answered** — registry-listing timing. `docs/11`
  §5 lists it as the one remaining Before-Phase-7 decision now that D8 has
  settled the license.
- **`docs/09` §8's open decisions 1, 2, 3, 6 and 7 are answered.** All five become
  user-facing text or shipped behaviour in this phase: the Linux-without-libsecret
  path, whether the passphrase tier ships at all, Gemini tier detection, the
  re-verification of every remaining `Unverified`/`Partially verified` policy
  claim before it reaches user-facing text, and the policy-review cadence.
- ~~**The MIT license is confirmed with the institution's IP office.**~~
  **Satisfied — closed 2026-09-09.** D8 records MIT (`docs/00` §3) and
  `docs/10` §5 question 18 carried the instruction to confirm with the
  institution's IP office before first public release; the project owner closed
  that confirmation on 2026-09-09, question 18 is now struck through and records
  the decision itself, and it is recorded at
  [`06-human-gates.md`](06-human-gates.md) G-32. This is no longer an entry
  condition. Reopen it only if the licence changes or the work is reassigned to a
  different institution — the clearance was given for MIT, for this project,
  under its current affiliation.
- **NCBI registration is on file** for the `tool`/`email` pair. `docs/09` §5.1
  states that sending the values is not itself compliance and that registration
  is a release task; `docs/13` §8.9 carries it as a release-hygiene checkbox.
- **The accessibility surface is understood.** `docs/10` §3 marks Zotero 10's
  assistive-technology support surface `> **Unverified:**` and makes the
  NVDA/VoiceOver smoke test a Phase 7 deliverable; `docs/08` §9 additionally marks
  `> **Unverified:**` whether Zotero ships a high-contrast stylesheet that plugin
  panes inherit.
- **The build/test toolchain markers from `docs/13` are closed by Phase 0's
  report.** Specifically the scaffold `test` key names, the `esbuildOptions`
  shape and `xpiDownloadLink` templating, the Gecko target version, whether
  `zotero-plugin test` provisions a Zotero build in CI, and whether a
  `ZOTERO_CHANNEL` variable selects the beta build — all `> **Unverified:**` in
  `docs/13` §1.4, §1.5, §2, §5.1 and §5.3, and all load-bearing for W7-9 and
  W7-10.

### 4.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Registry-listing timing — list at v1.0 or wait (`docs/10` §5 question 20) | `docs/13` §7.2 |
| Linux-without-libsecret fallback: session-only or passphrase first, and whether the passphrase tier ships in v1 at all | `docs/09` §1.7 and the open note under D5 in `docs/00` §3; questions are `docs/09` §8 items 1 and 2 |
| Gemini tier-detection fallback behaviour when no programmatic billing signal exists | `docs/09` §3.4 rule 4; question is `docs/09` §8 item 3 |
| Provider-policy re-verification cadence and the date stamp shown next to retention text in the UI | `docs/09` §3.3; question is `docs/09` §8 item 7 |
| Whether advanced users may override prompts in v1 | `docs/12` §19 item 5, with cache-namespace and bug-report consequences |
| The supported-OS matrix for v1.0, given `docs/13` §8 requires all three for a minor or major release | `docs/13` §8 and the README compatibility table (`docs/13` §7.3 item 2) |
| Which NFRs, if any, ship waived rather than measured | the release checklist; `docs/11` §1 Phase 7 DoD requires each to be measured *or explicitly waived* |
| Final shipped values for the two spend ceilings (`docs/10` §5 question 6's residual half) | `docs/07` §8.5, "and nowhere else" |

### 4.4 What would change the plan

- **V-18 shows the manifest-only compatibility bump does not work.** The fallback
  `docs/13` §6.3 names is a patch release whose only change is the manifest. R-1's
  ongoing cost rises from a one-line commit to a full release cycle per Zotero
  major, which changes the maintenance budget `docs/11` R-1 assumes (~1
  developer-day per major version). **That multiplier grew on 2026-09-09:**
  `docs/11` R-1 now reckons the corrected 7–10-month span at roughly **3–7**
  Zotero majors rather than the 2–3 the old 4–5-month span implied, with §1's
  separate ~15% compatibility contingency (≈ 23–32 d) sitting on top of the
  per-version budget rather than inside it.
- **V-17 fails or is awkward.** W7-1's approach changes at the root — how strings
  are registered, and therefore what R-22's CI parity check reads. This is the
  work area most likely to change shape entirely rather than in degree.
- **The Korean review returns register-level problems, not typos.** W7-2 stops
  being a Phase 7 polish item: `docs/12` §19 item 4 names the Korean *prompts*,
  which means the `TREND_REPORT_KO` and `AUDIO_SCRIPT_KO` outputs from Phases 4
  and 6 must be regenerated and re-judged, and `docs/12` §17.6's "changing a
  prompt costs money" applies. Budget a re-run of the Phase 4 and Phase 6 Korean
  DoD items, not a string sweep.
- **Accessibility support is worse than assumed.** NFR-13 items get explicitly
  waived in the release checklist with the reason recorded, rather than silently
  missed — `docs/11` §1 Phase 7 DoD allows a waiver but not an omission.
- **The official plugin registry opens before v1.0.** W7-11 gains a submission
  task and possibly a review or signing requirement — `docs/01` §11.5 marks
  `> **Unverified:**` whether the planned directory will introduce one.
- **A `docs/09` §7 `[BLOCKER]` cannot be satisfied.** The release does not ship.
  These are the only items in the plan explicitly labelled as must-not-ship-
  unresolved.

---

## 5. What actually gates these phases: information, not code

The table below is the point of this document. For each phase, the
`> **Unverified:**` markers and `docs/10` §5 open questions that must be resolved
before decomposition. None of them is unblocked by writing code, and most are
resolved by one measurement, one API call, or one answer from a human.

### 5.1 Phase 4 — Trend report

| Gating item | Where | Why it gates Phase 4 |
|---|---|---|
| `getStructuredDocumentText` serialization | `docs/06` §3.3 `Unverified` | Decides whether the digest and report can carry section provenance (V-8b, R-19b) |
| IMRaD detector accuracy unmeasured; 40-PDF fixture, ≥ 85 % target | `docs/06` §4.3 `Unverified` | Same; the action item is a measurement, not code |
| Token-estimation ratios are estimates, not measurements | `docs/06` §5.1 `Unverified` | The report's pre-run cost estimate is derived from them |
| Programmatic bibliography entry point in Zotero 10 | `docs/06` §10.3 `Unverified` | W4-5's files cannot be named; fallback loses the user's citation style |
| `crypto.subtle` availability in the plugin scope | `docs/06` §11.2 `Unverified` | Cache key, and therefore resume semantics |
| Cross-lingual summary quality (KO/ZH/JA → EN) | `docs/06` §13.2 `Unverified` | Which items a report may claim to cover |
| Better Notes' cross-plugin entry point | `docs/06` §14.1 `Unverified` (and §16 item 4) | Only if the Better Notes integration ships |
| Note-HTML sanitisation whitelist; no public Markdown→HTML helper | `docs/01` §5.7 `Unverified` | W4-6's rendering path |
| SSE consumability in the plugin scope | `docs/01` §8.4 `Unverified`, V-8, R-14 | W4-9's progress design |
| `ProgressWindow` / `ItemProgress` signatures | `docs/07` §7.7 `Unverified` | W4-9 |
| Korean output token factor of 1.4–2.0× is an estimate | `docs/12` §11 (`TREND_REPORT_KO`, "Model / temperature") `Unverified` | Korean report cost estimate; the action item writes the measured factor into `llm.tokenEstimateCalibration` (`docs/07` §8.5), the same store `docs/06` §5.1's action item uses |
| Provider parameter and structured-output field names not re-verified | `docs/12` §18 `Unverified` | W4-3's validators |
| Q6 — should either spend ceiling ship non-zero | `docs/10` §5 | A report is the most expensive single action in the product |
| Q7 — may an LLM ever be called without a per-run confirmation | `docs/10` §5 | The report dialog's consent design |
| Q11 — editable generated notes and re-run behaviour | `docs/10` §5 | W4-6's save path |
| Q12 — writes into group libraries | `docs/10` §5 | Report visibility to other members |
| Q19 — note, Markdown export, or both | `docs/10` §5 | W4-6's scope |

### 5.2 Phase 5 — Related papers + recommendations

| Gating item | Where | Why it gates Phase 5 |
|---|---|---|
| Max `positivePaperIds` / `negativePaperIds` | `docs/05` §3.3 `Unverified` | Profiler seed strategy and request budget |
| Voyage `voyage-4` dimensions and context limits | `docs/05` §5.3 `Unverified` | Only if a Voyage adapter is contemplated |
| OpenRouter embedding coverage | `docs/03` §13 and §16 `Unverified` | The D6 default provider may have no embedding endpoint at all |
| Europe PMC rate limit | `docs/02`, `docs/07` §7.3, `docs/09` §5.5 `Unverified` | W5-10's limiter defaults |
| bioRxiv/medRxiv: no published limits, keys, or API terms | `docs/09` §5.6, `docs/07` §7.3 `Unverified` | Same |
| Crossref abstract coverage corpus-wide | `docs/02` `Unverified` | Candidate quality when Crossref is the only source with a record |
| Semantic Scholar licence identifier for API-delivered data | `docs/02` `Unverified` | Constrains any future redistribution; noted, not blocking v1 |
| Whether legacy `10.1101/` DOIs are being re-minted | `docs/02` `Unverified` | Preprint/published matching in recommendations |
| Q2 — preprint vs. published merge policy | `docs/10` §5 | `from=recent` skews preprint (`docs/05` §3.2) |
| Q7 — per-run LLM confirmation | `docs/10` §5 | W5-7's query generation spends tokens |
| Q8 — is a Semantic Scholar key a hard requirement | `docs/10` §5 | Decides whether the phase can start without the key |
| Q13 — deduplication aggressiveness | `docs/10` §5 | Owned-item exclusion reuses the same matching |

**Plus the one that is not a document marker at all:** the Semantic Scholar key
application's *outcome*. `docs/11` R-3 rates it High likelihood / Medium impact
and says issuance can take weeks. It is the only Phase 5 input with an external
queue, which is why it is a week-1-of-Phase-0 action.

`docs/11` R-3's *exposure* fell on 2026-09-09 without its *urgency* changing.
On §1's re-estimated figures R-3 records that Phase 5 cannot start before
≈ 58.5–82 developer-days in (Phase 0 + Phase 1 + the longer of Phases 2/3),
≈ 3–4 months at 21 working days per month, against ≈ 1.5–2 months on the old
figures — so the application has materially more calendar time to clear. R-3
attaches an explicit condition to that relief: *provided it is still submitted in
week 1*. Do not read the longer runway as permission to start the application
later; read it as the reason a week-1 submission is now very likely to be
answered before Phase 5 opens. See [`06-human-gates.md`](06-human-gates.md) G-03.

### 5.3 Phase 6 — TTS audio report

| Gating item | Where | Why it gates Phase 6 |
|---|---|---|
| **25 output tokens per second of audio** | `docs/04` §4.2 `Unverified` | The document states the whole TTS cost model inherits this uncertainty; W6-7 cannot be specified without a measured replacement |
| No published maximum audio duration per request | `docs/04` §4.1 `Unverified` | W6-4's chunk targets |
| Interactions-API voice set vs. legacy set | `docs/04` §2.7 `Unverified` | W6-1's voice handling; names must not be hardcoded |
| Whether a second call can transcode generated audio | `docs/04` §6 `Unverified` | The document says to assume it is unavailable |
| Korean SAPI voices on Windows only with the speech pack | `docs/04` §7.1 `Unverified` | W6-9's Korean option must be disabled when absent |
| ~~`gpt-4o-mini-tts` per-audio-token pricing~~ — **settled; no longer gates** | `docs/04` §7.2, re-confirmed 2026-09-08 | Kept in this table so the row is not re-opened by mistake. The OpenAI fallback is costable; what is left is §7.2's per-token-vs-per-character estimator trap, which is implementation work, not a missing fact |
| ElevenLabs / Azure / Google Cloud TTS model IDs and pricing | `docs/04` §7.3, §7.4 `Unverified` | Documented as future options only; not v1 |
| `Zotero.Attachments.importFromFile` signature and options | `docs/04` §10.1 `Unverified` | W6-6 |
| Whether Zotero 10's Read Aloud exposes a plugin-facing API | `docs/08` §6.4 `Unverified` | Whether W6-9 can reuse it instead of `speechSynthesis` |
| Programmatic Gemini billing-tier signal | `docs/09` §3.4 rule 4 `Unverified` | The free-tier warning's trigger, and whether audio is offered at all |
| Korean output token factor of 1.4–2.0× | `docs/12` §11 (`TREND_REPORT_KO`, "Model / temperature") `Unverified` | Korean script cost |
| Q6 — spend ceilings | `docs/10` §5 | Audio is billed purely by duration |
| Q7 — per-run LLM confirmation | `docs/10` §5 | The script rewrite is an LLM call before the TTS call |
| Q9 — audio register | `docs/10` §5 | `docs/11` §5 lists it as Before Phase 6 |
| Q10 — Korean native generation vs. translation | `docs/10` §5 | Same; and `docs/12` §19 item 6 asks the narrower version |

### 5.4 Phase 7 — Polish, i18n, prefs, release

| Gating item | Where | Why it gates Phase 7 |
|---|---|---|
| `strict_max_version` reconciliation between manifest and installed XPI | `docs/13` §6.3 `Unverified` | The primary R-1 response strategy depends on it (V-18) |
| Beta channel ignoring `strict_max_version` | `docs/01` §1.3 `Unverified` | The beta-channel CI job's premise |
| Zotero's update check interval and its controlling pref | `docs/13` §6.4 `Unverified` | README wording only — the document says not to state an interval |
| Community-list submission mechanics; `zotero-chinese/zotero-plugins` maintenance status | `docs/13` §7.2 `Unverified` | W7-11 |
| Whether the planned official directory adds review or signing | `docs/01` §11.5 `Unverified` | W7-11, and possibly the release workflow |
| Fluent argument form for a plugin's own files | `docs/01` §9.2 `Unverified` | W7-1 |
| `Zotero.ftl.addResourceIds` resolving keys for `Zotero.getString()` | `docs/01` §10.4, `docs/08` §8.2.1 `Unverified` | W7-1 |
| Whether plugin prefs sync between machines | `docs/01` §7.2 `Unverified` | What the prefs pane may promise the user |
| High-contrast / forced-colors stylesheet inheritance | `docs/08` §9 `Unverified` | W7-3 |
| Zotero 10's assistive-technology support surface | `docs/10` §3 `Unverified` | W7-3; NFR-13's measurability |
| `zotero-types` coverage of the Zotero 10 surface | `docs/13` §1.1 `Unverified` (V-6) | Whether a local augmentation file ships |
| Scaffold `test` config key names; `esbuildOptions` shape; Gecko target; CI Zotero provisioning; `ZOTERO_CHANNEL` | `docs/13` §1.4, §1.5, §2, §5.1, §5.3 `Unverified` | W7-9 and W7-10 |
| Remaining provider policy claims flagged `Unverified` / `Partially verified` | `docs/09` §3.3 and §8 item 6 | They become user-facing text in W7-8 and the prefs pane |
| Q6 — final shipped ceiling values | `docs/10` §5 | Shipped defaults are a release decision |
| Q14 — "remove all Research Helper content" command | `docs/10` §5 | W7-4's clear/delete coverage |
| Q15 — minimum supported Zotero version | `docs/10` §5 | `strict_min_version` in W7-9 |
| Q16 — update-manifest hosting strategy | `docs/10` §5 | W7-9 |
| ~~Q18 — license (decided D8, IP-office confirmation outstanding)~~ — **settled; no longer gates** | `docs/10` §5 question 18, struck through and marked decided 2026-09-09; closure recorded at [`06-human-gates.md`](06-human-gates.md) G-32 | Kept so the row is not re-opened by mistake. `docs/10` §5 question 18 now records the decision in its own text — "institutional clearance to release under MIT exists, so no further sign-off is a precondition of first public release" — and names the reopen condition: a licence change away from MIT, or reassignment to a different institution |
| Q20 — registry listing at v1.0 or later | `docs/10` §5 | W7-11 |

### 5.5 The shortest honest summary

Three answers restructure more of Phases 4–7 than any amount of code:

1. **V-8b / R-19b** — whether usable layout geometry exists, and what the 40-PDF
   fixture set measures. It reaches Phase 3's summarizer, Phase 4's digest and
   report §2, and, if the product owner responds by flipping D7, the entire cost
   model.
2. **The Gemini audio output token rate** (`docs/04` §4.2). One real call with
   `usageMetadata` read back replaces an `Unverified` third-party figure that
   every audio cost number currently rests on.
3. **The Semantic Scholar key decision** — granted, denied, or written off. Not a
   document marker and not code: an approval queue that decides whether Phase 5
   ships its primary candidate generator or its fallback.

Runner-up, and the one most likely to be missed: whether OpenRouter — the D6
default provider — exposes embeddings at all (`docs/03` §13). A "no" means the
default configuration cannot run the embedding path in Phase 5's W5-4.

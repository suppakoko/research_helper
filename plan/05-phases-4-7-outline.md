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
> with them. *Updated 2026-10-26: Phase 4 is decomposed (`plan/07`), so §1 is a
> pointer and its band is measured (23.75–33 d); the three of §2–§4 are still
> scaled.* *Updated 2026-11-02: Phase 5 is decomposed (`plan/08`), so §2 is a pointer
> too and its band is measured (35.75–50 d); the two of §3–§4 are still scaled.*
> *Updated 2026-11-16 (`plan/00` §6 item 378): Phase 6 is decomposed (`plan/09`), so §3 is a pointer
> too and its band is measured (20.00–28 d); only §4's Phase 7 is still scaled.*
> *Updated 2026-11-16, later (`plan/00` §6 item 380): Phase 7 is decomposed (`plan/10`), so §4 is a pointer
> too and its band is measured (28.50–40 d); no phase in this file is scaled any more.*
> *Re-priced 2026-11-16, later still (`plan/00` §6 item 381): Phase 7 is 29.25–41 d over 32 cards after `P7-T32`; it read 28.50–40 d.*
> *Re-priced 2026-11-17 (`plan/00` §6 item 384): Phase 6 is 20.25–28 d over 19 cards after `P6-T17` went 1.75 → 2.0 d; it read 20.00–28 d.*
> *Re-priced 2026-11-17, later (`plan/00` §6 item 393(d)): Phase 7 is 29.75–42 d over 33 cards after `P7-T33`; it read 29.25–41 d.*
> *Re-priced 2026-11-17, latest (`plan/00` §6 item 398): Phase 7 is 32.00–45 d over 38 cards after `P7-T34`–`P7-T38` and `P7-T03`'s 1.5 → 1.75 d; it read 29.75–42 d.*
> *Re-priced 2026-11-18 (`plan/00` §6 item 402(a)): Phase 7 is 32.50–46 d over 38 cards after `P7-T15` went 1.5 → 2.0 d for item 401(a); it read 32.00–45 d.*
> *Re-priced 2026-11-18, later (`plan/00` §6 item 404(a)): Phase 7 is 34.75–49 d over 40 cards after `P7-T39` and `P7-T40` (1.0 d each) were added and `P7-T15` went 2.0 → 2.25 d for item 403; it read 32.50–46 d.*
> *Re-priced 2026-11-18, later still (`plan/00` §6 item 406(a)): Phase 7 is 35.75–50 d over 41 cards after `P7-T41` (1.0 d) was added for item 405(a); it read 34.75–49 d.*
> *Re-priced 2026-11-25 (`plan/00` §6 item 414(a)): Phase 7 is 36.75–51 d over 42 cards after `P7-T42` (1.0 d) was added for item 413(a); it read 35.75–50 d.*
> *Re-priced 2026-11-05 (`plan/00` §6 item 344(b)): Phase 5's measured band is 36.25–51 d; it read 35.75–50 d.*
> *Re-priced 2026-11-02 (`plan/00` §6 item 335(g)): Phase 4's measured band is 25.25–35 d; it read 23.75–33 d.*
> *Re-priced again 2026-11-02 (`plan/00` §6 item 336(d)): it is 25.75–36 d; it read 25.25–35 d.*
>
> **The ×1.50 factor and where it comes from.** `docs/11` §1's preamble owns the
> derivation and this file does not restate it: the factor is the Phases 0–3 card
> sum divided by 52, the top of the old 39–52-day band. It was recomputed on
> 2026-09-09 after `P3-T04` and `P3-T20` were re-estimated — 82.0 ÷ 52 = 1.577,
> against 80.5 ÷ 52 = 1.548 before — and **deliberately held at 1.50**, so the
> four bands quoted below are unchanged. It has been recomputed several times
> since, as Phases 0–2 gained cards, and stands at **91.00 ÷ 52 = 1.750** as of
> 2026-10-03 — still **held at 1.50**, for the same reason, so the four bands are
> still unchanged. `docs/11` §1 carries the full sequence; this sentence exists
> only so that the 2026-09-09 figure above is not read as the current one. The reasoning is in `docs/11` §1: a
> 1.5-day change to a measured phase moves the factor by 1.9%, which on Phase 4's
> 11-day base is 0.32 d, and chasing that would be false precision; holding at
> 1.50, which is below both computed values, also keeps the inferred figures on
> the conservative side of what the measured phases found. Read the two documents
> together — neither is to be changed without the other.
>
> **Last updated:** 2026-09-09 · **Status:** outline only; no task IDs allocated
> in the `P4-*`–`P7-*` ranges. *Updated 2026-10-26: Phase 4's cards `P4-T01`–`P4-T25`
> are in `plan/07`; this file is the outline of Phases 5–7 only, and §1 is a pointer.*
> *Updated 2026-11-02: Phase 5's cards `P5-T01`–`P5-T31` are in `plan/08`; this file is
> the outline of Phases 6–7 only, and §1 and §2 are pointers.*
> *Updated 2026-11-16: Phase 6's cards `P6-T01`–`P6-T19` are in `plan/09`; this file is
> the outline of Phase 7 only, and §1–§3 are pointers.*
> *Updated 2026-11-16, later: Phase 7's cards `P7-T01`–`P7-T31` are in `plan/10`; every section
> §1–§4 is a pointer, and §5 is kept as the record of what gated each phase.*

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
   (§2.2 is `plan/08` §5.2 since 2026-11-02)
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

**Decomposed — see [`07-phase-4-trend-report.md`](07-phase-4-trend-report.md).** Reduced to this
pointer on **2026-10-26**, as §0 "Exit from outline into cards" requires: Phase 4 was decomposed into
25 task cards on 2026-10-25 (owner decision, `plan/00-task-index.md` §6 item 283(c)), reviewed the
same day, and its open lines decided on 2026-10-26 (item 286). It was decomposed at the owner's
direction (item 283(c)) before §0's exit conditions (a) and (c) held — Phase 3 is not `DONE` and
several entry conditions are open; `plan/07` §0 records which are met.

**Effort:** **25.75–36 developer-days — measured**, the sum of `plan/07`'s 25 cards (25.75 × 1.4 =
36.05 → 36), replacing the 16.5–23 d **scaled ×1.50, not decomposed** figure this section quoted
from 2026-09-09 to 2026-10-26 (`docs/11` §1, Phase 4, and the effort summary table carry the change).
*Re-priced 2026-11-02 (`plan/00` §6 item 335(g)): `P4-T22` 0.75 → 2.25 d; this read 23.75–33 (23.75 × 1.4 = 33.25 → 33).*
*Re-priced again 2026-11-02 (`plan/00` §6 item 336(d)): `P4-T23` 1.25 → 1.75 d; this read 25.25–35 (25.25 × 1.4 = 35.35 → 35).*

**Where this section's contents went.** The work areas `W4-1`–`W4-10` (§1.1), the entry conditions
(§1.2), the decisions required before decomposition (§1.3) and what would change the plan (§1.4) are
`plan/07` §5.1–§5.4, moved verbatim; `plan/07` §0's table tracks the entry conditions, and every
§1.3 decision is made. §5.1 below, Phase 4's gating list, is kept as the record it was.

---

## 2. Phase 5 — Related papers + recommendations

**Decomposed — see [`08-phase-5-related-papers.md`](08-phase-5-related-papers.md).** Reduced to this
pointer on **2026-11-02**, as §0 "Exit from outline into cards" requires: Phase 5 was decomposed into
cards on 2026-11-01 (owner decision, `plan/00-task-index.md` §6 item 318(c)), reviewed the same day, and
its open lines decided the same day (items 320, 321 and 323, and the coordinator under item 313). It was
decomposed at the owner's direction before §0's exit conditions (a) and (c) held — Phases 3 and 4 are not
`DONE` and one entry condition, the positive-seed cap, is still open; `plan/08` §0 records which are met.

**Effort:** **36.25–51 developer-days — measured**, the sum of `plan/08`'s 32 cards (36.25 × 1.4 =
50.75 → 51; *re-priced 2026-11-05, `plan/00` §6 item 344(b): it read 35.75–50 d over 31 cards*), replacing the 21–29 d **scaled ×1.50, not decomposed** figure this section quoted from
2026-09-09 to 2026-11-02 (`docs/11` §1, Phase 5, and the effort summary table carry the change).

**Where this section's contents went.** The work areas `W5-1`–`W5-10` (§2.1), the entry conditions
(§2.2), the decisions required before decomposition (§2.3) and what would change the plan (§2.4) are
`plan/08` §5.1–§5.4, moved verbatim; `plan/08` §0's table tracks the entry conditions, and every §2.3
decision is made. §5.2 below, Phase 5's gating list, is kept as the record it was.

---

## 3. Phase 6 — TTS audio report

**Decomposed — see [`09-phase-6-audio-report.md`](09-phase-6-audio-report.md).** Reduced to this
pointer on **2026-11-16**, as §0 "Exit from outline into cards" requires: Phase 6 was decomposed into
19 cards on 2026-11-16 under the coordinator's brief of that day, with four owner decisions
(`plan/00-task-index.md` §6 item 378(a)–(d)) and the remaining §3.3 decisions taken by the coordinator
under item 313. It was decomposed before §0's exit conditions (a) and (c) held — Phase 5 is not `DONE` and
`P4-T24`/`P4-T25` have not run; `plan/09` §0 records which entry conditions are met. It has had no
independent review yet.

**Effort:** **20.25–28 developer-days — measured**, the sum of `plan/09`'s 19 cards (20.25 × 1.4 =
28.35 → 28; *re-priced 2026-11-17, `plan/00` §6 item 384: it read 20.00–28, 20.00 × 1.4 = 28.0*), replacing the 15–21 d **scaled ×1.50, not decomposed** figure this section quoted from
2026-09-09 to 2026-11-16 (`docs/11` §1, Phase 6, and the effort summary table carry the change).

**Where this section's contents went.** The work areas `W6-1`–`W6-10` (§3.1), the entry conditions
(§3.2), the decisions required before decomposition (§3.3) and what would change the plan (§3.4) are
`plan/09` §5.1–§5.4, moved verbatim; `plan/09` §0's table tracks the entry conditions, and every §3.3
decision is made (`plan/09` §0.4 lines 1–11; "Read aloud" and the OpenAI fallback are out of v1.0). §5.3
below, Phase 6's gating list, is kept as the record it was.

---

## 4. Phase 7 — Polish, i18n, prefs, release

**Decomposed — see [`10-phase-7-release.md`](10-phase-7-release.md).** Reduced to this pointer on
**2026-11-16**, as §0 "Exit from outline into cards" requires: Phase 7 was decomposed into 31 cards on
2026-11-16 under the coordinator's brief of that day, with four owner decisions (`plan/00-task-index.md`
§6 item 380(a)) and the remaining choices taken by the coordinator under item 313. It was decomposed
before §0's exit conditions (a) and (c) held — Phases 3–6 are not `DONE`, and Phase 6 is not built;
`plan/10` §0 records which entry conditions are met. It has had no independent review yet.

**Effort:** **36.75–51 developer-days — measured**, the sum of `plan/10`'s 42 cards (36.75 × 1.4 =
51.45 → 51; *re-priced 2026-11-25, `plan/00` §6 item 414(a): it read 35.75–50 over 41 cards (35.75 × 1.4 = 50.05 → 50) before `P7-T42`*; *re-priced 2026-11-18, later still, `plan/00` §6 item 406(a): it read 34.75–49 over 40 cards (34.75 × 1.4 = 48.65 → 49) before `P7-T41`*; *re-priced 2026-11-18, later, `plan/00` §6 item 404(a): it read 32.50–46 over 38 cards (32.50 × 1.4 = 45.5 → 46) before `P7-T39`, `P7-T40` and `P7-T15`'s 2.0 → 2.25 d*; *re-priced 2026-11-18, `plan/00` §6 item 402(a): it read 32.00–45 before `P7-T15` went 1.5 → 2.0 d*; *re-priced 2026-11-17, latest, `plan/00` §6 item 398: it read 29.75–42 over 33 cards before `P7-T34`–`P7-T38` and `P7-T03`'s re-estimate*; *re-priced 2026-11-17, `plan/00` §6 item 393(d): it read 29.25–41 over 32 cards before `P7-T33`*; *re-priced 2026-11-16, later still, `plan/00` §6 item 381: it read 28.50–40 over 31 cards before `P7-T32`*), replacing the 21–29 d **scaled ×1.50, not decomposed** figure this section quoted from
2026-09-09 to 2026-11-16 (`docs/11` §1, Phase 7, and the effort summary table carry the change). With
it, no phase of the plan carries a scaled figure.

**Where this section's contents went.** The work areas `W7-1`–`W7-11` (§4.1), the entry conditions
(§4.2), the decisions required before decomposition (§4.3) and what would change the plan (§4.4) are
`plan/10` §5.1–§5.4, moved verbatim; `plan/10` §0's table tracks the entry conditions, and every §4.3
decision is made (`plan/10` §0.4 lines 1–9; `plan/10` §5.3 carries a note saying where each landed).
§5.4 below, Phase 7's gating list, is kept as the record it was.

---

## 5. What actually gates these phases: information, not code

The table below is the point of this document. For each phase, the
`> **Unverified:**` markers and `docs/10` §5 open questions that must be resolved
before decomposition. None of them is unblocked by writing code, and most are
resolved by one measurement, one API call, or one answer from a human.

### 5.1 Phase 4 — Trend report

*Kept as the 2026-09-09 record, 2026-10-26.* Phase 4 is decomposed: `plan/07` §0's entry-condition
table is the live status of these items, and the four `docs/10` §5 questions below — Q7 (built by
`P3-T15`/`P3-T16`), Q11, Q12 and Q19 (`plan/00` §6 item 286) — are marked decided in `docs/10` §5.
The `W4-*` work areas named here are `plan/07` §5.1's.

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

> *Kept as the record it was, 2026-11-16: Phase 6 is decomposed (`plan/09`), and `plan/09` §0's entry-condition
> table says what each row below became. In short: the token rate is measured for one model (`docs/04` §4.2);
> Q9, Q10 and `docs/12` §19 item 6 are decided; the billing-tier signal is settled as "none, ask once" (item
> 378(b)); the `importFromFile` row was closed by `P0-T26`; and the two "Read aloud" rows and the voice-set row no
> longer gate v1.0 (items 378(d), and `docs/04` §2.1's note of 2026-11-16).*

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

> *Kept as the record it was, 2026-11-16: Phase 7 is decomposed (`plan/10`), and `plan/10` §0's entry-condition
> table and §0.4 say what each row below became. In short: Q14, Q20 and the prompt-override question are decided by
> the owner (item 380); Q6's ceilings, Q15 and Q16 were already settled and are cited; Q18 stays settled; the
> policy-claim row is `plan/10` `P7-T17`'s work; the `Unverified` markers in the other rows are each named by the
> card that measures or narrows them (`P7-T01`, `P7-T06`, `P7-T21`, `P7-T22`, `P7-T23`, `P7-T30`).*

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

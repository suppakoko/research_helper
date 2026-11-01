# Phase 4 — Research-trends report

> **Plan of record since 2026-10-26.** Drafted 2026-10-25 under owner decision `plan/00` §6 item
> 283(c) ("start decomposing Phase 4 … drafted by one agent and reviewed by another before any
> estimate moves"); reviewed the same day; every open line decided by the owner on 2026-10-26
> (item 286); the estimate propagated the same day to the five places `plan/README.md` §7 names
> (`docs/11` §1–§2, `plan/00` §1, `plan/05` §1, now a pointer here). Every card is `TODO`.
>
> **Reviewed 2026-10-25 by a second agent** (`plan/reports/phase4-review.md`). The review's
> corrections are in place and each carries a dated *"Review 2026-10-25"* note where it changed a
> card; the card sum moved 22.5 → 23.25 d (`P4-T18` 1.5 → 2.0, `P4-T20` 1.0 → 1.25), re-read from
> the cards by script.
>
> **Decided 2026-10-26** (owner, `plan/00` §6 item 286): all 35 open lines as recommended. Each now
> reads `> **Decided 2026-10-26 (owner, plan/00 §6 item 286):**`, and where a decision adds a step
> (a document written first, a new prompt the owner approves) the card's `Do` list says so. Two
> cards were re-estimated because a decision put work in them that no card's `Files` had priced:
> `P4-T03` 0.75 → 1.0 d (`CLUSTER_REDUCE_MERGE` moves there from `P4-T07` and ships beside
> `THEME_MERGE`) and `P4-T16` 1.0 → 1.25 d (the report's own egress notice). The card sum is
> **23.75 d**, re-read from the cards by script.
>
> **What this file is.** The task-card decomposition of `docs/11-implementation-roadmap.md` §1
> "Phase 4 — Trend report". The card schema, the field rules and the execution protocol are
> [`README.md`](README.md) §4–§5 and bind every card below. A step that depends on a document
> change the card makes first is not executed before that change lands.
>
> **Read by `npm run index:derive`** since 2026-10-26: `scripts/derive-task-index.ts` reads this
> file with `plan/01`–`plan/04` and builds `plan/00` §4's Phase 4 table from it. The file is
> numbered `07` because `05` and `06` are taken; `plan/05` §0's `plan/0N-phase-N-*.md` pattern
> would have given it `05`.

---

## 0. Phase summary

**Goal (docs/11).** Synthesize per-paper summaries into a cited "recent research trends" report, at
any collection size.

**Why this phase is different.** Phase 3 spends the user's money once per paper. Phase 4 spends it
on the **strongest** model (`docs/12` §18.5 `strong` tier → `reportModel`), on the one artifact a
reader will quote, and its main risk is not cost but **fabrication** (`docs/11` R-6, R-7). Three
consequences run through every card:

1. **Nothing the model could invent is left to the model.** Counts, dates, the title block, the
   year and study-design tables, the appendices and the bibliography are generated in code
   (`docs/06` §9.1, §10.3; `docs/12` §1.1 rule 7).
2. **Every citation is checked before anything is saved.** A marker is an opaque `[[itemKey]]`; a key
   not in the run's valid set is replaced visibly, never silently dropped (`docs/06` §10.1).
3. **Half a report is not saved.** Cancelling discards partial synthesis output (`docs/07` §7.4,
   §12.4); summaries already made stay cached.

**Schedule and entry conditions.** `plan/05` §0 schedules this decomposition for the end of Phase 3;
the owner pulled it forward (item 283(c)) while Phase 3 waits on labels and keys (item 282). So
`plan/05` §1.2's entry conditions (§5.2 since 2026-10-26) are **not all met**, and several cards below rest on Phase 3 work
that does not exist yet (§0.3). Their status on 2026-10-25, by grep of the documents and the tree:

| `plan/05` §1.2 (§5.2) entry condition | Status 2026-10-25 | Cards it reaches |
|---|---|---|
| Phase 3 `DONE`, a real `StoredSummary` corpus | **Not met.** `StoredSummary` is not declared yet (`src/model/summary.ts` header: "`P3-T25` adds it"); no `summary` table (migrations stop at version 5) | `P4-T04`, `P4-T07`, `P4-T12`, `P4-T14`, `P4-T25` |
| V-8b answered, R-19b closed | **Not met.** `P3-T22` is unbuilt; `P3-T20`'s labels wait on the owner (items 280(b), 283(a)) | `P4-T12` (§2 analysis-depth disclosure), `P4-T25` |
| V-8 answered (streaming) | **Met.** `docs/01` §8.4 records the measured sandbox XHR path (`P0-T16`/`P0-T17`); `P3-T11` built `LLMRouter.chatStream` | `P4-T20` |
| Bibliography entry point confirmed or fallback accepted | ~~**Not met.** `docs/06` §10.3 `Unverified`; `docs/06` §16 item 3 unanswered~~ **Met 2026-10-27 (`P4-T11`):** `Zotero.Styles.get(id).getCiteProc` measured inside Zotero 10.0.3 and recorded in `docs/01` §5.11; `docs/06` §10.3 points there and §16 item 3 is answered | `P4-T11` measures it |
| Cache-key hash primitive confirmed | **Met.** `docs/06` §11.2 "Measured 2026-10-21 … (`P3-T18`)": `crypto.subtle.digest` works in the sandbox | `P4-T17` |
| Note-HTML surface confirmed | **Not met.** `docs/01` §5.7 `Unverified` (sanitisation whitelist, no Markdown helper) | `P4-T13` measures it |
| Progress-UI API shapes confirmed | **Met.** `docs/07` §7.7 "Verified 2026-10-01 (`P1-T29`), marker retired" | `P4-T20` |
| `docs/10` §5 Q7, Q11, Q12, Q19 answered; Q6 residual | Q6 **decided** 2026-10-23 (item 271(b)). Q7 effectively built by `P3-T15`/`P3-T16` (routine confirmation, "don't ask again" never skips a money-forced question, item 274(b)) but not marked decided in `docs/10`. **Q11, Q12, Q19 open** — see the open lines on `P4-T14` and `P4-T15`. **Met 2026-10-26:** Q11, Q12 and Q19 decided by item 286 (`P4-T14`, `P4-T15`), and all four marked decided in `docs/10` §5 the same day | `P4-T14`, `P4-T15`, `P4-T16` |
| Token ratios replaced by measurements | **Not met.** `P3-T13` built the calibration store (`llm.tokenEstimateCalibration`); no real run has written it (that is `P3-T31`, gate `G-21`) | `P4-T16` |

**Deliverables (docs/11 §1 Phase 4) → cards.**

| `docs/11` deliverable | Cards |
|---|---|
| Map-reduce / hierarchical reduction pipeline with a reported pass count (FR-27) | `P4-T04`, `P4-T05`, `P4-T06`, `P4-T07`, `P4-T17`, `P4-T18` |
| Report template with fixed sections (FR-25) | `P4-T03`, `P4-T08`, `P4-T12` |
| Citation binding with a validator that rejects/repairs unresolvable citations (FR-26) | `P4-T10`, `P4-T11`, `P4-T09` |
| Report note writer, tag, metadata header (FR-25, NFR-15) | `P4-T12`, `P4-T13`, `P4-T14` |
| Korean report generation path (FR-28) | `P4-T02`, `P4-T03`, `P4-T21` |
| "Export as Markdown" action | `P4-T15`, `P4-T20` |
| Evaluation set: 3 curated collections with human-checked expected themes | `P4-T23` |
| Run surface the deliverables imply but do not list (dialog, progress, cost gate) | `P4-T16`, `P4-T19`, `P4-T20` |
| Types, preferences and prompts the deliverables read | `P4-T01`, `P4-T02`, `P4-T03` |

**Risks retired.** R-7; R-6 completes here (`docs/11` §1 Phase 4 says "R-7, part of R-6"; `plan/05`
§1 says "R-6 completes here").

**Effort.** **23.75 developer-days over 25 cards** (§1), so the band these cards imply is
**23.75–33 d** (23.75 × 1.4 = 33.25 → 33). Against `docs/11`'s former scaled 16.5–23 d the low end
is **+44 %** (23.75 ÷ 16.5 = 1.44), above the ~30 % that `plan/README.md` §7 calls a signal to
re-estimate the phase in `docs/11` — which was done: **propagated 2026-10-26** (§3). *(Review
2026-10-25: was 22.5 d, 22.5–32 d, +36 %; `P4-T18` and `P4-T20` gained the composition-root wiring
their `Files` lacked. Decided 2026-10-26: was 23.25 d, 23.25–33 d, +41 %; `P4-T03` and `P4-T16`
gained work item 286 put in them, 0.25 d each.)*

### Phase definition of done

Taken from `docs/11` §1 Phase 4 "Definition of done":

- [ ] A 400-item collection produces a report without a context-length error, and the header states
      the number of reduction passes. (`P4-T22`'s offline run is the proof; a live run in `P4-T25`
      only if the owner asks for one — decided 2026-10-26, item 286, and written into `docs/11` §1.)
- [ ] 100 % of citation markers in a generated report resolve to items in the collection
      (validator-enforced). (`P4-T10`, `P4-T25`)
- [ ] The Korean report keeps titles/authors/venues in original script. (`P4-T21`'s mechanical check
      plus the owner's `G-24` reading of one Korean report, `P4-T25`)
- [ ] Regenerating with the same inputs and a fixed temperature/seed yields substantively equivalent
      themes across 3 runs: pairwise co-assignment agreement ≥ 0.8 for every pair of runs, plus the
      owner's reading of the three theme-name lists. (`P4-T24`; measure decided 2026-10-26, item 286,
      and written into `docs/11` §1.)

And two that the phase needs as hard as the above:

- [ ] Every Phase 4 test passes with **zero** live network calls and **zero** spend (`docs/13` §4);
      live runs happen only in `P4-T23`–`P4-T25`, behind their gates.
- [ ] The evaluation set exists with owner-written expected themes (`G-23`) and a recorded baseline
      score (`P4-T23`).

### 0.1 Already landed — cite these by name, do not rebuild them

Checked against the tree on 2026-10-25.

| What | Where (by name) | Landed by |
|---|---|---|
| Prompt registry, `{{VAR}}` rendering, `<<<` escaping, `maxTokensPerItem`, `cacheEpoch` lines | `createPromptRegistry`, `renderPrompt`, `escapeSourceText`, `resolveMaxTokens`, `promptCacheLine` in `src/prompts/index.ts`; `PROMPT_SOURCE_FILES`, `PROMPT_VERSIONS`, `PROMPT_CACHE_EPOCHS` in `src/prompts/bundled.ts` | `P3-T24`, item 273(a) |
| Structured output with one repair and one retry; client-side schema validation | `completeJSON`, `parseOrRepair` in `src/llm/shared/jsonMode.ts`; `validateAgainstSchema`, `SUPPORTED_ASSERTION_KEYWORDS` in `src/llm/shared/schemaValidate.ts` | `P3-T12` |
| One router, one active provider, per-purpose model, streaming | `LLMRouter` (`resolveModel`, `chat`, `chatStream`) in `src/llm/types.ts`; `createLLMRouter`, `REPORT_MODEL_PREF` in `src/llm/router.ts` | `P3-T06`, `P3-T11` |
| Budget guard that **refuses an unbudgeted call**; one price source | `withBudget`, `createBudgetGuard`, `requestEstimate` in `src/pipeline/shared/budget.ts` | `P3-T16`, `P3-T35`, item 278 |
| Map-phase estimate and the cost dialog | `estimateRun`, `MAP_CALL_BUDGETS`, `ESTIMATE_HEADROOM` in `src/pipeline/shared/estimate.ts`; `buildCostDialogModel`, `decideCostDialog` in `src/ui/dialogs/costConfirmDialog.ts` | `P3-T16` |
| Token estimator with per-model calibration | `estTokens` in `src/llm/shared/tokenEstimate.ts` | `P3-T13` |
| Privacy policy and egress disclosure | `createPrivacyPolicy`, `assertModelAllowed` in `src/pipeline/shared/privacyPolicy.ts`; `buildEgressDisclosure`, `mustAskConfirmation` in `src/pipeline/shared/egressDisclosure.ts` | `P3-T15` |
| `llm` pool, pause/resume, wall-clock budget | `runPooledItems`, `createJobQueue` in `src/core/jobQueue/queue.ts` | `P3-T17`, `P3-T34`, item 265 |
| Cache layer, key hashing, tag escaping | `cacheKey`, `stableStringify`, `encodeTagValue`, `summaryKey` in `src/core/cache/keys.ts` | `P3-T33`, `P3-T26` |
| Screening outcomes (retracted, non-English, duplicates) with Appendix A reasons | `screenItems`, `findCollectionDuplicates` in `src/pipeline/summarize/screen.ts` | `P3-T27` |
| The one gate for persisted records | `redactRecord` in `src/core/provenance.ts` | `P3-T36` |
| Search provenance per collection (for `{{SEARCH_STRATEGY}}`) | `createProvenanceStore` in `src/zotero/db.ts`; `lookupRunForCollection` on the menu host in `src/ui/menus/registerMenus.ts` | `P2-T17` |
| The collection submenu | `collectionMenuOptions` in `src/ui/menus/registerMenus.ts` (`rh-menu-collection`) | Phase 2 |
| Mock LLM harness | `mockLLM`, `mockLLMRouter`, `chatResponse` in `test/helpers/mockLLM.ts` | `P3-T06` |

### 0.2 Conventions binding on every card in this file

Items 1–10 of `plan/04` §0.2 apply unchanged (strings and `G-41`; one card adds preference rows;
test locations and the three-run rule; migrations appended; one redaction gate; no live requests;
an agent never holds a key; layering; callers named; open lines stop a step). In addition:

11. **Every LLM call carries a budget.** The shared router refuses a call without `ctx.budget`
    (item 278(a)), so each synthesis call is reserved through `withBudget` at the prices the cost
    dialog shows (item 278(b)). A synthesis stage never calls an adapter directly.
12. **Ceilings pause and ask; they never abort** (items 234, 265(a), 274(c)). A refusal mid-run pauses
    the job with the item (here: the stage) still pending.
13. **Cache keys carry `cacheEpoch`, not the full prompt version** (item 273(a)); the full version
    goes into the stored `meta` and the report's provenance appendix (`docs/12` §17.4).
14. **Prompt text is copied verbatim from `docs/12`, never edited and never translated.** The Korean
    prompt (`TREND_REPORT_KO`) is copied as `docs/12` §11 prints it; its native-speaker review is
    Phase 7 gate `G-31` (`docs/12` §19 item 4).
15. **Two kinds of Korean text, two homes.** UI strings follow `plan/04` §0.2 item 1 (`G-41`).
    Text that appears **inside a generated Korean report** (client-generated headings, table labels,
    appendix labels) is report-language text, not UI text (`docs/08` §10.4), and lives where
    `P4-T12` puts it — never machine-translated either.
16. **No live LLM call outside `P4-T23`, `P4-T24` and `P4-T25`.** Each states its expected spend,
    computed by `P4-T16`'s estimate, and stops for the owner's approval before dispatch — gate
    **`G-42`** in `plan/06` (added 2026-10-26).
17. **Item keys, not work keys, in every citation.** Markers are Zotero item keys (`docs/06` §10.1);
    see `P4-T01`'s decided line on `docs/07` §5.2's `citedWorkKeys`.
18. **A report job is a job like any other** *(added by the review, 2026-10-25)*: an interrupted
    report resumes automatically after a restart and re-passes every spend guard with the visible
    resume notice (item 250; `JobNotifier` is `P3-T29`'s, item 251); a budget refusal mid-run pauses
    with the stage pending (item 274(c)); the 30-minute wall-clock budget pauses and asks (item
    265(a)); "don't ask again" never skips a confirmation forced by money (item 274(b)); a streamed
    call is bounded by 3 minutes idle and 15 minutes in all, a plain call by 3 minutes (items 240,
    268(c)). A "stop" answered at a pause during synthesis is a cancel: synthesis output is
    discarded, summaries stay (§0 item 3).

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** *(line added by the review, 2026-10-25)*
> the reasoning **effort** each synthesis call sends. `ChatRequest.effort` exists (item 262(a);
> `docs/07` §4.3) and summaries send `low`, but no document assigned one to `THEME_CLUSTER`,
> `CLUSTER_REDUCE`, `TREND_REPORT_*` or `SELF_CRITIQUE`; `docs/03` §16's table runs the report call
> "at `medium` effort", and `docs/03` §12.3 item 1 warns that reasoning tokens are billed as output,
> "3–5× the visible text" at high effort — so where a provider counts them against `max_tokens`, they
> can also truncate a call. **Decided: `medium` on the four strong-tier synthesis prompts and `low`
> on `SELF_CRITIQUE`** (standard tier, like summaries), with `P4-T23`'s baseline recording how much
> of each ceiling reasoning used, so `docs/06` §5.2's ceilings are checked against a measurement.
> The two new strong-tier prompts (`THEME_MERGE`, `CLUSTER_REDUCE_MERGE`, both written by `P4-T03`)
> take `medium` as well — the coordinator's reading of the decision, put to the owner with their
> wording. Written into `docs/12` §18.5 (one column) and `docs/06` §5.2's note by `P4-T03` step 1.
> Applies to `P4-T05`–`P4-T09`, whose `Do` steps name the effort each call sends. (The alternative
> not taken: send no effort and let each provider's default apply.)

### 0.3 What Phase 4 needs from Phase 3

Phase 4 cards list only Phase 4 IDs in **Depends on**, because a `P3-*` ID there would need a
matching `Blocks` entry in `plan/04`, which this file may not edit (the same reason `plan/02` §1
gives for naming no `P0` ID). Each card's **Notes** starts with the Phase 3 cards it needs. **NOT
BUILT** marks a card with no `plan/reports/<card>.md` on 2026-10-25.

| Phase 3 card | State of the work | What Phase 4 takes from it | Phase 4 cards |
|---|---|---|---|
| `P3-T25` per-paper summarizer | **NOT BUILT** | `PaperSummary` and `StoredSummary` declared in `src/model/summary.ts`; the `summary` table and store; `groundingScore`, `confidence: "low"` exclusion | `P4-T04`, `P4-T07`, `P4-T12`, `P4-T14`, `P4-T22` |
| `P3-T29` summarize-collection pipeline | **NOT BUILT** | The summarize pipeline the report's `EnsuringSummaries` stage runs; how a pipeline receives Zotero reads; the `rh-menu-collection` entries and menu-count specs it changes first; the summary-note writer in `src/zotero/notes.ts`; the "remove generated notes" command | `P4-T14`, `P4-T18`, `P4-T19` |
| `P3-T23` chunker | **NOT BUILT** | `src/llm/shared/chunking.ts`, where `docs/11` §1 puts Phase 4's token packing | `P4-T07` |
| `P3-T22` IMRaD accuracy gate | **NOT BUILT** (labels wait on the owner) | Whether summaries carry section provenance — the §2 disclosure | `P4-T12`, `P4-T25` |
| `P3-T28` item-pane summary section | **NOT BUILT** | Nothing directly; it is on `P3-T31`'s path | `P4-T25` via `P3-T31` |
| `P3-T30` LLM fixtures | **NOT BUILT** (owner's recording) | Recorded adapter shapes; Phase 4 tests use the mock harness and do not need them | `P4-T25` via `P3-T31` |
| `P3-T31` Phase 3 acceptance | **NOT BUILT** | A measured map phase and the first real calibration factors before Phase 4 spends on the strong model | `P4-T23`, `P4-T25` |
| `P3-T37` keyring-less Linux | **NOT BUILT** | Nothing | — |
| `P3-T06`, `P3-T11`, `P3-T12`, `P3-T13`, `P3-T15`, `P3-T16`, `P3-T17`, `P3-T24`, `P3-T26`, `P3-T27`, `P3-T32`, `P3-T33`, `P3-T34`, `P3-T35`, `P3-T36`, `P3-T39` | Built (reports exist) | §0.1's table | most cards |

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the live cards (`P4-T23`–`P4-T25`) spend
> on the strong model, and `plan/06` had no Phase 4 spend gate (§6 listed only `G-23`, `G-24`,
> `G-25`). **Decided: a Phase 4 entry modelled on `G-21`** ("Approve the first real summarization
> job's cost estimate"), added by the coordinator to `plan/06` the same day as **`G-42`** — "Approve
> the first real report run's cost estimate, and each paid Phase 4 run after it". Each live card
> still states its own expected spend in its **Human gate** cell (`plan/README.md` §6 "Cost") and
> names `G-42` there.

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P4-T01` | Reconcile the trend types and state machine in `docs/07` | 0.75 | none |
| `P4-T02` | Preference rows Phase 4 reads | 0.5 | none |
| `P4-T03` | Synthesis prompt files and their JSON schemas | 1.0 | none |
| `P4-T04` | Digest projection (no LLM) | 0.5 | none |
| `P4-T05` | Theme clustering with client-side validation | 0.75 | none |
| `P4-T06` | Two-stage clustering and the theme-merge call | 0.75 | none |
| `P4-T07` | Per-theme analysis with sub-batching (depth ≤ 2) | 1.0 | none |
| `P4-T08` | Report composition call and structural validation | 1.25 | none |
| `P4-T09` | Self-critique pass, revision loop, warning banner | 1.0 | none |
| `P4-T10` | Citation validator and marker binding | 0.75 | none |
| `P4-T11` | Bibliography and citation nodes through Zotero | 1.25 | none |
| `P4-T12` | Client-generated title block, tables and appendices | 1.0 | none |
| `P4-T13` | Markdown → Zotero note HTML, sanitized | 1.25 | none |
| `P4-T14` | Report note writer, `report` table, report file | 1.25 | none |
| `P4-T15` | "Export as Markdown" | 0.5 | none |
| `P4-T16` | Synthesis cost estimate and the report's confirmation | 1.25 | none |
| `P4-T17` | Synthesis cache keys (`tc`, `cr`, `rp`) | 0.5 | none |
| `P4-T18` | Trend-report pipeline: stages, passes, cancel, resume | 2.0 | none |
| `P4-T19` | Report window surface, menu entry, `reportWindow` bundle | 1.0 | none |
| `P4-T20` | Report window: progress, streaming preview, delivery | 1.25 | none |
| `P4-T21` | Korean report path end to end | 0.75 | none |
| `P4-T22` | 400-item scale test on the mock provider | 0.75 | none |
| `P4-T23` | Evaluation set and regression harness | 1.25 | **Yes** |
| `P4-T24` | Determinism check across three runs | 0.75 | **Yes** |
| `P4-T25` | Phase-4 acceptance run against the definition of done | 0.75 | **Yes** |
| | **Total** | **23.75** | 3 gates |

**Entry points** (no `Depends on`): `P4-T01`, `P4-T02`, `P4-T03`. All three are documents, rows and
data files and can start before Phase 3 finishes; `P4-T10`, `P4-T11`, `P4-T13` and `P4-T17` follow
from `P4-T01` with no unbuilt Phase 3 input.

**Critical path inside the phase:** `P4-T01` → `P4-T04` → `P4-T05` → `P4-T07` → `P4-T08` →
`P4-T09` → `P4-T18` → `P4-T20` → `P4-T23` → `P4-T24` → `P4-T25`, 11.25 d (tied at `P4-T18` by
`P4-T01` → `P4-T10` → `P4-T11` → `P4-T13` → `P4-T14`, 5.25 d each), and it cannot start its second
card until `P3-T25` lands. *(Review 2026-10-25: was 10.5 d before `P4-T18` and `P4-T20` were
re-estimated.)* *(Decided 2026-10-26: unchanged by `P4-T03` 0.75 → 1.0 and `P4-T16` 1.0 → 1.25,
re-read by script — `P4-T03` → `P4-T05` is now 1.0 d against `P4-T01` → `P4-T04`'s 1.25, and
`P4-T03` → `P4-T16` reaches `P4-T18` after 2.25 d against the path's 5.25.)*

---

## 2. Task cards

### P4-T01 — Reconcile the trend types and state machine in `docs/07`

| Field | Value |
|---|---|
| **ID** | `P4-T01` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P4-T04`, `P4-T10`, `P4-T12`, `P4-T17` |
| **Retires** | none |
| **Implements** | part of `FR-25`, part of `FR-27` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `docs/07` declares the types the trend pipeline actually passes between its stages, and its
§12.4 state machine is the pipeline `docs/06` §8 specifies; `src/model/trend.ts` holds them.

**Read first.**
- `docs/07-architecture-and-data-model.md` §5.2 — `ThemeCluster`, `TrendReport`, `ReportSection` as
  declared today
- `docs/12-prompt-library.md` §8, §9, §12 "Expected output" — the `ThemeClustering`, `ThemeAnalysis`
  and `SelfCritique` shapes the prompts are contracted to emit
- `docs/06-summarization-and-trend-report.md` §8.3–§8.5 — the L0–L4 levels and the pseudocode's
  `TrendReport` return
- `docs/07-architecture-and-data-model.md` §12.4 — the trend-report state machine
- `docs/07-architecture-and-data-model.md` §2.3 — `model/` imports nothing but itself

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§5.2 types, §6.5, §12.4; dated "Decided" notes first)
- create `src/model/trend.ts` (callers: every `src/pipeline/trendReport/*` module, `P4-T04`
  onward; constructed nowhere — types only)

**Do.**
1. Write the reconciled declarations into `docs/07` §5.2 first, with a dated note naming what changed
   and why: the JSON-shaped stage outputs (`ThemeClustering`, `ThemeAnalysis`, `SelfCritique`, the
   `Digest` line set of `docs/06` §8.2), and a `TrendReport` whose structure follows `docs/06` §9.1
   (eleven sections, Appendices A, B and C — C decided 2026-10-26 on `P4-T09` — the pass count FR-27
   reports). The declarations **replace** `ThemeCluster` and `TrendReport` as decided below; they do
   not sit beside them.
2. Rewrite §12.4's diagram to `docs/06` §8.5's stages (screen → ensure summaries → digest → cluster →
   per-theme analysis → compose → critique/revise → render → write), keeping its cancel-discards and
   interrupted-resumes transitions, and leaving the audio states after `Succeeded` as they are
   (Phase 6's). **Ensure summaries runs inside the report job** — it summarizes missing items itself
   through the summarize pipeline's per-item function, with no child job, so
   `EnsuringSummaries → RunningSummarize : summaries missing` goes (decided 2026-10-26 on `P4-T18`,
   item 286; the dated note says so).
3. Declare the same types in `src/model/trend.ts`, importing only from `src/model/`.
4. Correct `docs/07` §6.5's tag to `research_helper/trend-report` in place, dated, citing `docs/10`
   FR-25 and `docs/11` §1 Phase 4, which both name it. *(Review 2026-10-25: this was an open line;
   two requirement documents settle it against one design-document bullet, so it is a correction,
   not an owner question.)*

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** replace `docs/07` §5.2's `ThemeCluster` and
> `TrendReport` rather than extending them (step 1). `docs/07` declares `ThemeCluster` with "`label`", "`workKeys`",
> "`exemplarWorkKeys`" and a `method` of `"llm-topic" | "embedding-kmeans" | "embedding-hdbscan" |
> "keyword-cooccurrence"`, and `TrendReport` with "`emergingTopics`", "`decliningTopics`" and
> "`citedWorkKeys`"; `docs/12` §8 has the model return "`themeId`", "`name`", "`definition`",
> "`itemKeys`", and `docs/06` §10.1 cites by "`[[itemKey]]`". Keep the persisted record's fields
> that `docs/07` §8.3's `report` table needs (`id`, `libraryID`, `collectionKey`, `markdown`, note
> key, `generatedAtEpochMs`, usage, model and prompt identity) and drop the embedding methods, which
> are Phase 5's (`docs/07` §13 item 5 leaves embeddings undecided). Keep the audio fields Phase 6
> reads (`audioScripts`, `audioAttachmentKeys`; `docs/07` §6.5, §12.4) as declared. Written into
> `docs/07` §5.2 by step 1. (The alternative not taken: keep the old shapes and add the new ones
> beside them.)

**Do NOT.**
- Do **not** add a field to `PaperSummary` (`docs/06` §6.3 owns it; a field there is a MAJOR prompt
  bump).
- Do **not** declare types in `docs/06` or `docs/12` — `docs/07` is the sole authority
  (`plan/README.md` §5 item 3); those documents keep their JSON schemas as prompt contracts.
- Do **not** import `pipeline/`, `llm/` or `core/` from `src/model/trend.ts`.

**Done when.**
- [ ] `docs/07` §5.2 and §12.4 carry dated notes and agree with `docs/06` §8.5 stage for stage.
- [ ] `grep -n "research_helper/report\b" docs/07-architecture-and-data-model.md` finds the
      tag only inside the dated correction.
- [ ] `src/model/trend.ts` exports the declared types and nothing else; it imports only `model/`.
- [ ] `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npx eslint .
```

**Notes.** Needs from Phase 3: nothing built (`ProviderId` and `Usage` already sit in `src/model/`).
No test file: the file holds types only, and `P4-T03`'s schema test pins the JSON shapes. `docs/07`
is a shared file under the wave rules — small exact-string edits only.

---

### P4-T02 — Preference rows Phase 4 reads

| Field | Value |
|---|---|
| **ID** | `P4-T02` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P4-T09`, `P4-T18`, `P4-T19` |
| **Retires** | none |
| **Implements** | `FR-28`, part of `FR-25` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Every `docs/07` §8.5 row the report reads exists in `PREFS`, `PREF_KEYS` and
`addon/prefs.js`, typed and defaulted as §8.5 says.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.5 "Report & audio" — `reportLanguage`,
  `report.targetWords`, `report.maxCritiqueRounds`, `report.critiqueModel`, `report.saveNote`
- `plan/04` `P3-T32` and `P3-T39` — how the last two rows cards were done, and the integer-only rule
  (item 245)
- `src/prefs/schema.ts` header — which rows are deliberately absent

**Files.**
- modify `src/prefs/schema.ts`
- modify `src/prefs/keys.ts`
- modify `addon/prefs.js`
- modify `test/unit/prefs/schema.test.ts`

**Do.**
1. Add the five rows above exactly as §8.5 declares them (`reportLanguage` `auto|en|ko|both`;
   `report.targetWords` integer `0` or ≥ 400; `report.maxCritiqueRounds` 0–2; `report.critiqueModel`
   string; `report.saveNote` boolean).
2. Keep `docs/01` §7.2's `prefs.js` byte-consistent with the defaults (`docs/07` §8.5 rule): add a
   `pref()` line to `addon/prefs.js` only for a row `docs/01` §7.2 lists (of these five, only
   `reportLanguage`); the others fall back to the schema default, as `addon/prefs.js`'s header
   records for Phase 3's rows. *(Review 2026-10-25: made explicit, so no `docs/01` edit is implied.)*
3. Extend the schema test, including the D5 block (no credential in any new row).

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** do **not** add `report.addRelatedLinks`
> (backlinks, `docs/06` §10.4) in Phase 4. No `docs/11` deliverable or definition-of-done line needs
> it, so under `plan/README.md` §5 rule 9 it goes to `plan/00` §6 tagged Phase 4 (recorded there as
> item 287(a)), and a row nothing reads is a pane promise nobody keeps. Changes nothing in
> `docs/07`.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `report.critiqueModel` ships as §8.5
> declares it; what its empty value means is **the same decision as `P4-T09`'s first decided line**
> (`summaryModel`, never an automatic pick) and is answered once, there; `P4-T09` writes it into
> `docs/07` §8.5 and `docs/06` §15. *(Review 2026-10-25: this line said "the writer's model", which
> disagreed with `P4-T09`'s recommendation of `summaryModel`; aligned to `P4-T09`.)*

**Do NOT.**
- Do **not** add a fractional row; Gecko preferences hold no fraction (item 245).
- Do **not** add a per-run "Depth" or model row for `docs/08` §6.4's wireframe (see `P4-T19`).
- Do **not** add a row `docs/07` §8.5 does not declare.

**Done when.**
- [ ] The five rows read back their §8.5 defaults through `getPref`.
- [ ] `test/unit/prefs/schema.test.ts` covers each row's allowed values and the D5 rule.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- schema` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- schema
```

**Notes.** Needs from Phase 3: `P3-T32`, `P3-T39` (built). `src/prefs/schema.ts` and its test are
shared files under the wave rules — exact-string edits only. Only this card adds Phase 4 rows
(`plan/04` §0.2 item 2 applied to this phase).

---

### P4-T03 — Synthesis prompt files and their JSON schemas

| Field | Value |
|---|---|
| **ID** | `P4-T03` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P4-T05`, `P4-T07`, `P4-T08`, `P4-T16` |
| **Retires** | part of `R-6`, part of `R-7` |
| **Implements** | `FR-25`, `FR-26`, `FR-28` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `THEME_CLUSTER`, `CLUSTER_REDUCE`, `TREND_REPORT_EN`, `TREND_REPORT_KO` and `SELF_CRITIQUE`,
and the two new prompts `THEME_MERGE` and `CLUSTER_REDUCE_MERGE` once `docs/12` carries them and the
owner has approved their wording, ship as versioned prompt files with their schemas, loaded and
validated by the existing registry; `docs/12` and `docs/06` carry every prompt-side decision of item
286 first.

**Read first.**
- `docs/12-prompt-library.md` §8–§12 — the five prompts, verbatim, with variables and parameters
- `docs/12-prompt-library.md` §1.2 — the prompt index the two new prompts join
- `docs/12-prompt-library.md` §17.3 and its 2026-10-20 decision note — front matter, `variables`,
  `maxTokensPerItem`, the import-attribute wiring in `bundled.ts`
- `docs/06-summarization-and-trend-report.md` §5.2 — the `max_tokens` column; §8.4 — the merge call
  and the sub-batch merge the two new prompts serve; §11.1 — temperatures
- `src/llm/shared/schemaValidate.ts` `SUPPORTED_ASSERTION_KEYWORDS` — what a schema may use
- `src/prompts/index.ts` `resolveMaxTokens` and the front-matter rule that a file sets exactly one of
  `defaultMaxTokens` and `maxTokensPerItem`

**Files.**
- modify `docs/12-prompt-library.md` (§1.2, §8, §10, §12, §17.3, §18.5, and two new sections
  appended after the last section, so no existing section number moves; dated "Decided" notes)
- modify `docs/06-summarization-and-trend-report.md` (§5.2 `THEME_CLUSTER`'s row and the effort
  note; §8.4's first sentence; dated)
- create `src/prompts/theme-cluster.v1.0.0.md`
- create `src/prompts/cluster-reduce.v1.0.0.md`
- create `src/prompts/trend-report-en.v1.0.0.md`
- create `src/prompts/trend-report-ko.v1.0.0.md`
- create `src/prompts/self-critique.v1.0.0.md`
- create `src/prompts/theme-merge.v1.0.0.md`
- create `src/prompts/cluster-reduce-merge.v1.0.0.md`
- create `src/prompts/schemas/theme-clustering.v1.json`
- create `src/prompts/schemas/theme-analysis.v1.json` (also `CLUSTER_REDUCE_MERGE`'s output schema)
- create `src/prompts/schemas/self-critique.v1.json`
- create `src/prompts/schemas/theme-merge.v1.json`
- modify `src/prompts/index.ts` (`PROMPT_IDS`, `PROMPT_FILE_NAMES`, `PROMPT_SCHEMAS`; `resolveMaxTokens`
  and the front-matter parser gain the ceiling's fixed part)
- modify `src/prompts/bundled.ts` (one import line per file; callers: `P4-T05`, `P4-T06`, `P4-T07`,
  `P4-T08`, `P4-T09`, through `PROMPT_REGISTRY`)
- modify `test/unit/prompts/registry.test.ts`
- modify `test/integration/prompts.spec.ts`

**Do.**
1. **Documents first** (decided 2026-10-26, item 286). Write into `docs/12`, each change under a
   dated "Decided 2026-10-26 (owner, `plan/00` §6 item 286)" note:
   1. two new sections appended after the last: **`THEME_MERGE`** (version `1.0.0`, `strong` tier,
      temperature 0.2, JSON output mapping batch-local theme ids to global ones, from the batch-local
      theme names, definitions and paper counts only — `docs/06` §8.4 step 3) with its schema; and
      **`CLUSTER_REDUCE_MERGE`** (version `1.0.0`, `strong` tier, `CLUSTER_REDUCE`'s temperature 0.3,
      whose user text says it receives *partial theme analyses*, and whose output is §9's
      theme-analysis shape); rows for both in §1.2's index and §17.3's file list;
   2. §8 "Model / temperature": `THEME_CLUSTER`'s output ceiling grows with the paper count — a fixed
      part for the themes plus a per-paper part, about 40 tokens from the schema's arithmetic,
      re-measured on `P4-T23`'s first runs (`P4-T06`); §8 "Client-side validation": a theme below
      `MIN_PAPERS_PER_THEME` moves to `unclustered` (`P4-T05`);
   3. §10 "Expected output": a missing or misordered heading triggers **one fresh generation** with
      the failure stated in `{{REVISION_NOTES}}`, and an invalid marker is never repaired by a model
      (`P4-T08`); §10 "Input variables": `{{SOURCES}}` is the database names from the collection's
      `search_provenance` runs when any exist, else the distinct `libraryCatalog` values of the
      analysed items, else "not recorded" (`P4-T08`);
   4. §12 "Input variables": `{{SUMMARIES_JSON}}` holds the summaries of **cited** items only,
      packed to budget, and section by section when that still overflows (`P4-T09`); §12 and §18.5:
      the critique runs on the active provider with `report.critiqueModel` when set, else
      `summaryModel`, never an automatically picked model and never a second provider (`P4-T09`);
   5. §18.5: the effort column — `medium` for every `strong`-tier synthesis prompt (`THEME_CLUSTER`,
      `THEME_MERGE`, `CLUSTER_REDUCE`, `CLUSTER_REDUCE_MERGE`, `TREND_REPORT_EN`, `TREND_REPORT_KO`),
      `low` for `SELF_CRITIQUE` (§0.2);
   6. §17.3: the front-matter field that carries a ceiling's fixed part beside `maxTokensPerItem`
      (today a file sets exactly one of `defaultMaxTokens` and `maxTokensPerItem`; name the change).

   And into `docs/06`: §5.2's `THEME_CLUSTER` row (the grown ceiling) and the effort note; §8.4's
   first sentence — two-stage clustering runs when the grown ceiling would exceed the model's output
   limit or the input would exceed 60 000 tokens, never on a paper count (`P4-T06`).

   The two new prompts are new prose: **show both wordings to the owner in chat and stop; ship
   neither until the owner approves it.** No other step waits on that approval except steps 2–3 for
   those two files.
2. Copy each system and user text verbatim from `docs/12`, the two approved new prompts included;
   front matter per §17.3 with `outputFormat: json` or `markdown`, the §5.2 `defaultMaxTokens`, the
   §11.1 temperature and a `variables` list.
3. Copy each "Expected output" schema into its file, checking every keyword is supported by
   `validateAgainstSchema`; report any that is not instead of dropping it. `CLUSTER_REDUCE_MERGE`
   names `theme-analysis.v1.json`; it gets no schema of its own.
4. `THEME_CLUSTER`'s output ceiling *(review 2026-10-25; decided 2026-10-26 on `P4-T06`)*: ship it as
   the fixed part plus `maxTokensPerItem` named in step 1.6, and give `resolveMaxTokens` and the
   front-matter parser the fixed part, with a registry-test case for each.
5. Extend the registry test so every shipped file parses and matches its `docs/12` block.
6. Confirm the startup comparison (`reconcilePromptVersions`) treats the seven new ids as new, not
   changed, so it invalidates nothing.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/06` §8.4 step 3 runs "a
> **theme-merge** call over the batch-local theme *names, definitions and paper counts only*", but
> `docs/12` §1.2's index and §17.3's file list have no such prompt. **Decided: write a `THEME_MERGE`
> prompt into `docs/12` first** (a new §, version `1.0.0`, `strong` tier, temperature 0.2, JSON output
> mapping local theme ids to global ones), **then ship it from this card. The prompt text is new
> prose, so the owner approves it.** Written into `docs/12` §1.2, §17.3 and a new section by step 1.1.
> (The alternative not taken: no merge step, so `P4-T06` could not be built as `docs/06` §8.4
> describes.)

**Do NOT.**
- Do **not** edit, shorten or translate any existing prompt's system or user text, Korean included
  (§0.2 item 14). Step 1 changes variables, parameters, validation rules and the two new prompts; if a
  decision seems to need an existing prompt's text changed, stop and say so.
- Do **not** ship `THEME_MERGE` or `CLUSTER_REDUCE_MERGE` before the owner approves its wording.
- Do **not** add a provider-specific variant (`docs/12` §18.1 rule 1).
- Do **not** put any `{{VAR}}` in a system text (`docs/12` §1.1 rule 2).

> **Decided 2026-10-26 (owner, `plan/00` §6 item 290(b)):** the first Do-NOT bullet's "stop and say
> so" happened: `THEME_CLUSTER`'s system text (`docs/12` §8, rules 1 and 5) held `{{MIN_THEMES}}`,
> `{{MAX_THEMES}}` and `{{MIN_PAPERS_PER_THEME}}`, against the last bullet. The owner approved in chat
> the one change to an existing prompt's text: the three numbers move to the user text, and rules 1
> and 5 refer to "the request". The version stays `1.0.0`, because no run has used the prompt.
> `docs/12` §8 carries the wording; `theme-cluster.v1.0.0.md` is regenerated from it and registered.

**Done when.**
- [ ] `docs/12` and `docs/06` carry step 1's changes, each under a dated note.
- [ ] The owner's approval of both new prompts' wording is recorded (the date and where).
      *(Decided 2026-10-26 (owner, `plan/00` §6 item 290(a)): met. The owner approved both wordings
      as drafted, their client-side validation and reasoning effort `medium` included, in chat on
      2026-10-26; recorded in `plan/00` §6 item 290(a) and in `docs/12` §1.2, §20 and §21. The State
      stays `TODO` until the owner sets it.)*
- [ ] The registry loads all seven files with no `PromptRegistryError`.
- [ ] Each schema file equals its `docs/12` block after Prettier, as `paper-summary.v1.json` does
      (item 238).
- [ ] `resolveMaxTokens` returns the fixed part plus the per-item part times the item count for
      `THEME_CLUSTER`, and the parser rejects a file that sets `defaultMaxTokens` with a per-item part.
- [ ] `test/integration/prompts.spec.ts` passes on the bundled copy inside Zotero.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- registry` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- registry && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs from Phase 3: `P3-T24`, `P3-T12` (built). `docs/12` §17.3 says CI
(`scripts/check-prompt-sync.mjs`) fails the build on drift; that script does not exist (item
239(e)) — the unit test is the check. `docs/12` and `docs/06` are shared files under the wave rules —
small exact-string edits only. *Re-estimated 2026-10-26, 0.75 → 1.0 d:* item 286 decided
`CLUSTER_REDUCE_MERGE`, a second new prompt the draft placed on `P4-T07`, whose `Files` named no
prompt, `docs/12` or registry row, so no estimate had priced writing it, shipping it or getting its
wording approved. It moved here so both new prompts reach the owner in one review and stay with the
card that owns the registry files; `THEME_MERGE` was already this card's (the draft's `Done when`
read "five (six with `THEME_MERGE`) files"). The `docs/12` edits of step 1 are otherwise one or two
sentences each. The "every file sets exactly one of the two" rule is item 2 (`maxTokensPerItem`) of
`docs/12` §17.3's 2026-10-20 decision note, and `src/prompts/index.ts`'s parser enforces it.

---

### P4-T04 — Digest projection (no LLM)

| Field | Value |
|---|---|
| **ID** | `P4-T04` |
| **State** | `TODO` |
| **Depends on** | `P4-T01` |
| **Blocks** | `P4-T05`, `P4-T08`, `P4-T12` |
| **Retires** | none |
| **Implements** | part of `FR-27` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Any stored summary becomes a deterministic ~90–140-token digest block, the input clustering
and the report call run on.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §8.2 — the digest block, line by line
- `docs/06-summarization-and-trend-report.md` §6.3 — `PaperSummary` field names
- `docs/06-summarization-and-trend-report.md` §12.1 L3 — a `confidence: "low"` summary's
  `keyFindings` are excluded from synthesis

**Files.**
- create `src/pipeline/trendReport/digest.ts` (callers: `cluster.ts`, `P4-T05`; `compose.ts`,
  `P4-T08`; `scaffold.ts`, `P4-T12`)
- create `test/unit/pipeline/trendDigest.test.ts`

**Do.**
1. A pure `toDigest` over a `StoredSummary` plus the item's year, producing `docs/06` §8.2's lines in
   that order, with fixed truncation per field so the block stays inside the token band.
2. Omit `Findings` and `Metrics` for a low-confidence summary, and say so in the block.
3. Escape `<<<` through `escapeSourceText` only at render time, not inside the digest.

**Do NOT.**
- Do **not** call a model, read a preference or read the clock.
- Do **not** add section-provenance fields: `docs/06` §8.2's digest has none.

**Done when.**
- [ ] The same input gives a byte-identical digest on every call.
- [ ] Over a 50-summary synthetic set, every digest is at most 140 tokens by `estTokens` (step 1's
      truncation enforces the cap). *(Review 2026-10-25: the line read "90–140 tokens, or the test
      names the field that pushed it out", which no result could fail.)*
- [ ] A low-confidence summary's digest carries no finding.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendDigest` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendDigest
```

**Notes.** Needs from Phase 3: **`P3-T25` (NOT BUILT)** for `StoredSummary`/`PaperSummary`; until it
lands the test cannot compile against the real type. `plan/05` §1.2 and §1.4 (§5.2, §5.4) say V-8b "determines the
digest's fields (W4-1)", but `docs/06` §8.2's digest carries no section field — V-8b reaches Phase 4
through the summaries and `P4-T12`'s §2 disclosure only (reported as a finding, not fixed).

*As built 2026-10-29 (`plan/00` §6 item 302; no model, no network; `P3-T25`'s types are built, so the
first sentence above no longer holds).* `src/pipeline/trendReport/digest.ts` declares `toDigest`,
`digestText`, `digestTokens`, `withholdsFindings`, `DigestInput`, `DIGEST_LINE_BUDGETS`,
`DIGEST_HEAD_CAPS`, `DIGEST_TIER_CAPS`, `DIGEST_WITHHELD` and `DIGEST_NO_YEAR`, and re-exports
`DIGEST_MAX_TOKENS` from `estimate.ts`; its readings are `docs/06` §8.2's note of 2026-10-29. Callers
(rule 10): nothing calls it yet. `trendReportPipeline.ts` (`P4-T18`) builds the digests at its "digest"
stage, because it holds each item's year; `cluster.ts` (`P4-T05`) joins `digestText` into
`{{DIGESTS}}`; `compose.ts` (`P4-T08`) and `scaffold.ts` (`P4-T12`) read the same blocks. Nothing is
constructed: the module is pure functions and constants. Step 3 needed no code, because `renderPrompt`
already escapes every variable.

*Decided 2026-10-29 (owner, `plan/00` §6 item 303(d)):* the card's "low-confidence" is read as `confidence`
`low` **or `none`** — `withholdsFindings` withholds findings and metrics for both, as `docs/06` §8.2's note of
2026-10-29 says. That reading is confirmed.

---

### P4-T05 — Theme clustering with client-side validation

| Field | Value |
|---|---|
| **ID** | `P4-T05` |
| **State** | `TODO` |
| **Depends on** | `P4-T03`, `P4-T04` |
| **Blocks** | `P4-T06`, `P4-T07` |
| **Retires** | none |
| **Implements** | part of `FR-27` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** N digests become a validated theme assignment in which every analysed paper appears exactly
once, from one `THEME_CLUSTER` call when the digests fit.

**Read first.**
- `docs/12-prompt-library.md` §8 "Input variables" and "Client-side validation" — the four rules
- `docs/06-summarization-and-trend-report.md` §9.2 — `MIN_THEMES`/`MAX_THEMES` by corpus size
- `docs/06-summarization-and-trend-report.md` §5.2 — `THEME_CLUSTER`'s 60 000-token input budget
- `src/llm/shared/jsonMode.ts` `completeJSON` — the one repair, one retry

**Files.**
- create `src/pipeline/trendReport/cluster.ts` (caller: `trendReportPipeline.ts`, `P4-T18`)
- create `test/unit/pipeline/trendCluster.test.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl` and
  `addon/locale/ko-KR/research-helper-mainWindow.ftl` (step 6's message; the `ko-KR` entry a commented
  stub), `src/i18n/keys.ts` (the id, on `KO_PENDING_REVIEW`) and `test/unit/i18n/keys.test.ts`.
  *Added 2026-10-27 (owner, `plan/00` §6 item 292(d)). A guess, so verify it yourself: I believe the
  main-window bundle, where the `rh-error-*` messages a stopped job shows live; if `P4-T19`'s
  `reportWindow` bundle exists by then and shows the run's stop messages, that bundle instead.*

**Do.**
1. Choose single-stage when `estTokens` of the joined digests fits the 60 000-token input budget
   **and** `THEME_CLUSTER`'s grown output ceiling for this many papers (`resolveMaxTokens`, `P4-T03`
   step 4) is within the model's output limit; otherwise hand over to `P4-T06`'s path (a stub that
   throws until it lands). Never choose on a paper count (decided 2026-10-26 on `P4-T06`).
2. Call through `completeJSON` on `resolveModel("strong")`, temperature 0.2, effort `medium` (§0.2,
   decided 2026-10-26), budgeted (§0.2 item 11).
3. Validate: every input key exactly once across `assignments` + `unclustered`; theme ids resolve;
   `itemKeys` are input keys. On a miss, re-run once; then put leftovers in a client-generated
   `Other` theme.
4. Move the papers of every theme below `MIN_PAPERS_PER_THEME` to `unclustered` in code, and drop
   the emptied theme (decided below); they still count in the report's coverage figures.
5. Count one pass for the call (FR-27's counter lives on the run, `P4-T18`).
6. A clustering answer with more themes than `MAX_THEMES` is asked for once more; if still over, the
   run stops and says so. *(Decided 2026-10-27, owner, `plan/00` §6 item 292(d): `P4-T16`'s
   estimate reserves theme calls for at most `MAX_THEMES` themes, so an answer over it would make
   calls nobody confirmed. The stop needs a user-visible message: this card adds its string to the
   `en-US` bundle and a commented stub to the `ko-KR` bundle, with the id on `KO_PENDING_REVIEW`
   (`G-41`); see the `Files` rows added with this step.)*

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/12` §8 says small themes are "merged
> into the nearest theme or moved to `unclustered`, in code", without defining "nearest". **Decided:
> move them to `unclustered`**, which needs no similarity measure and invents no grouping; a paper
> there still appears in the report's coverage count. Written into `docs/12` §8 "Client-side
> validation" by `P4-T03` step 1.2. (The alternative not taken: merge into the "nearest" theme, which
> needs a similarity rule no document defines.)

**Do NOT.**
- Do **not** send full summaries to clustering (`docs/06` §8.2: "cluster on digests").
- Do **not** silently drop a paper the model omitted.
- Do **not** call the router without a budget.

**Done when.**
- [ ] A scripted response missing two keys triggers exactly one re-run, then an `Other` theme.
- [ ] A theme id in `assignments` absent from `themes` is rejected by validation.
- [ ] A 3-paper theme with `MIN_PAPERS_PER_THEME` 4 is gone and its three papers are in
      `unclustered`, each still counted once.
- [ ] A digest set inside the input budget whose grown output ceiling exceeds the model's output
      limit takes `P4-T06`'s path.
- [ ] A scripted answer with `MAX_THEMES` + 1 themes triggers exactly one more request; a second
      answer still over `MAX_THEMES` stops the run with its message and makes no further call, and
      a second answer within it is used (step 6, item 292(d)).
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendCluster` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendCluster
```

**Notes.** Needs from Phase 3: `P3-T12`, `P3-T35` (built).

*As built 2026-10-29 (`plan/00` §6 item 306(b); fake model only).* `src/pipeline/trendReport/cluster.ts`
declares `clusterThemes`, `clusteringPath`, `clusteringProblems`, `isMiss`, `finalizeClustering`,
`themeBandFor`, `minPapersPerThemeFor`, `clusterThemesTwoStage` (`P4-T06`'s stub, which throws) and the
constants `THEME_CLUSTER_EFFORT`, `CLUSTER_REQUESTS_MAX`, `OTHER_THEME_NAME`, `OTHER_THEME_DEFINITION`,
`SMALL_THEME_REASON` and `TOO_MANY_THEMES_L10N`; its readings are `docs/12` §8's note of 2026-10-29.
Callers (rule 10): nothing calls it yet. `trendReportPipeline.ts` (`P4-T18`) calls `clusterThemes` at its
cluster stage with the digests it built (`P4-T04`), the strong model's `maxOutputTokens` it also gives
`planSynthesis`, and `ctx.llm`, `ctx.budget`, `ctx.token`; it ends the run and shows the message when the
outcome is `stopped-too-many-themes`, and adds the outcome's `passes` to the run's counter. `P4-T06`
replaces `clusterThemesTwoStage`. Nothing is constructed: the module is functions and constants. Step 6's
message is `research-helper-report-stopped-too-many-themes`, in the main-window bundles: `P4-T19`'s
`reportWindow` bundle shows no run message (its run messages are `P4-T20`'s).

~~**Open for the owner (2026-10-29; `plan/reports/followup-292.md` finding 2):**~~ **Decided 2026-10-29
(owner, `plan/00` §6 item 307(a)): as built.** Whether step 3's re-run
and step 6's "asked for once more" share one request when the second answer shows the defect the first
did not: ~~Built, until the owner rules:~~ one shared re-run (`CLUSTER_REQUESTS_MAX` 2), so missed keys then
too many themes stops the run, and too many themes then missed keys sends the leftovers to `Other`. The
alternative not taken: one re-run per defect, up to three `THEME_CLUSTER` requests. `docs/12` §8's note of
2026-10-29 carries both.

**Decided 2026-10-29 (owner, `plan/00` §6 item 307(c)):** when every theme falls below
`MIN_PAPERS_PER_THEME` and none remains, `clusterThemes` returns the outcome `stopped-no-themes`
(`NoThemesOutcome`, message `research-helper-report-stopped-no-themes` = `NO_THEMES_L10N`, main-window
bundle beside step 6's, `en-US` only and on `KO_PENDING_REVIEW`, `G-41`) instead of an empty
clustering, and makes no further call; the run stops before writing anything and says why, keeping the
summaries. `P4-T18` maps it to the job's end. `docs/12` §8's note of this date. *(Item 307(b), the
`Other` theme making `MAX_THEMES` + 1 themes, is `P4-T16`'s estimate; see that card.)*

---

### P4-T06 — Two-stage clustering and the theme-merge call

| Field | Value |
|---|---|
| **ID** | `P4-T06` |
| **State** | `TODO` |
| **Depends on** | `P4-T05` |
| **Blocks** | `P4-T18` |
| **Retires** | none |
| **Implements** | `FR-27` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Digests too large for one call are clustered in batches and merged into one global theme
set, with the extra passes counted.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §8.4 steps 1–4 — partition, batch cluster, merge,
  re-assign
- `docs/06-summarization-and-trend-report.md` §8.3 table — L1 is "1 (or 1 + ⌈N/B⌉)" calls
- `P4-T03`'s decided line on `THEME_MERGE` and its step 1 — the prompt this card's step 3 calls

**Files.**
- modify `src/pipeline/trendReport/cluster.ts`
- modify `test/unit/pipeline/trendCluster.test.ts`

**Do.**
1. Take this path only when `P4-T05` step 1 hands over — the grown output ceiling would exceed the
   model's output limit, or the digests would exceed the 60 000-token input budget — never on a paper
   count (decided below).
2. The deterministic pre-sort (first-pass `researchTheme`, top keyword, year) and batches of `B`
   (default 60).
3. `THEME_CLUSTER` per batch under the `llm` pool, then one `THEME_MERGE` call (`P4-T03`'s file),
   then re-assignment; unmapped local themes go to `unclustered`. Every call budgeted (§0.2 item 11)
   and sent at effort `medium` (§0.2, decided 2026-10-26).
4. Count the batch calls and the merge call as passes.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** when two-stage clustering runs, and how
> large `THEME_CLUSTER`'s output may be. `docs/06` §8.4 says two-stage is "for N > ~400, or with a small-context model", and
> `docs/06` §8.2 puts 200 digests at "≈ 24 k tokens", so on input alone 400 digests (~48 k) fit the
> 60 000-token budget. **But the output does not** *(found by the review, 2026-10-25)*: `docs/12`
> §8's schema returns every paper twice — its key in `themes[].itemKeys` and an `assignments`
> object (`itemKey`, `primaryThemeId`, `secondaryThemeIds`, `fit`) — roughly 30–40 tokens per paper,
> against a fixed `max_tokens: 3000` (`docs/12` §8, `docs/06` §5.2), which also holds the themes'
> names, definitions and rationales. So a single call truncates at roughly 50–80 papers, far below
> 400; the batch size `B = 60` of §8.4 is about what 3 000 tokens holds. **Decided: give
> `THEME_CLUSTER` an output ceiling that grows with N** (a fixed part for the themes plus a per-paper
> part — about 40 tokens from the schema's arithmetic, re-measured on `P4-T23`'s first runs;
> `resolveMaxTokens` in `src/prompts/index.ts` gains the fixed part, since `maxTokensPerItem` alone
> has none), and run two-stage only when that ceiling exceeds the model's output limit
> or the input exceeds 60 000 tokens — never on a paper count; `P4-T22` forces the path with a
> small simulated window. Written into `docs/12` §8 "Model / temperature", `docs/06` §5.2 and
> §8.4's first sentence by `P4-T03` step 1, and built there (step 4) and in `P4-T05` step 1 and
> step 1 above. (The alternative not taken: keep 3 000 and run two-stage at `B = 60` for every
> collection above ~60 papers, which would make `THEME_MERGE` part of almost every real report.)

**Do NOT.**
- Do **not** start this card's step 3 until `P4-T03` ships `THEME_MERGE`, which waits on the
  owner's approval of its wording (decided 2026-10-26).
- Do **not** recurse: two stages, no third.

**Done when.**
- [ ] 150 synthetic digests with a forced 20 000-token budget produce three batch calls, one merge
      call and four counted passes.
- [ ] Every input key appears exactly once after re-assignment.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendCluster` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendCluster
```

**Notes.** Needs from Phase 3: `P3-T17` (built) for the pool.

*As built 2026-10-29 (`plan/00` §6 item 308; fake model only).* `src/pipeline/trendReport/cluster.ts`
replaces `P4-T05`'s stub `clusterThemesTwoStage` and adds `presortDigests`, `partitionDigests`,
`mergeProblems`, `isMergeMiss` and the constants `UNMAPPED_THEME_REASON`, `THEME_MERGE_EFFORT` and
`THEME_MERGE_SCHEMA_NAME`; `ClusterDeps` gains `mergePrompt` and `pool`, `ClusterInput` gains
`inputBudget`, and an outcome gains `batches` and `mergePrompt` after two stages.
`src/pipeline/shared/estimate.ts` gains `clusterBatchSize`, which `planSynthesis` and the run share.
The readings are `docs/06` §8.4's and `docs/12` §20's notes of 2026-10-29 and `docs/07` §4.5's note of
the same date. Callers (rule 10): `clusterThemes` calls `clusterThemesTwoStage` itself, so the caller is
still `trendReportPipeline.ts` (`P4-T18`) through `clusterThemes`; it also passes the active
`THEME_MERGE` template as `mergePrompt` and `WorkerPools.llm` (`buildWorkerPools`,
`src/bootstrap/registerPipelines.ts`) as `pool`, and records `mergePrompt` among the run's prompts.
Nothing is constructed. ~~**Open for the owner (2026-10-29):** whether a batch answer over its own
band's `MAX_THEMES`, asked once more and still over, stops the run; built, until the owner rules, as
a stop (`docs/12` §20's note, "Open for the owner"), pinned by one "[open line, as built]" test.~~

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(e)):* a batch answer over its own band's
`MAX_THEMES` after its one re-run is **not** a stop: `clusterThemesTwoStage` sends its local themes
to the merge, whose answer is still checked against the run's `MAX_THEMES`. Before the merge request
the stage measures `{{LOCAL_THEMES}}` as rendered against `THEME_MERGE`'s 60 000-token budget and,
when it is over, ends with the new outcome `stopped-merge-over-budget` (`MergeOverBudgetOutcome`,
message `MERGE_TOO_LARGE_L10N`, `research-helper-report-stopped-merge-too-large`, on
`KO_PENDING_REVIEW` until the owner approved its Korean on 2026-10-29, `plan/00` §6 item 310(a), and on
`KO_PRESENT` since) and no merge request. The "[open line, as built]" test now pins the decided
behaviour. `docs/12` §20's note of this date. `P4-T18` maps the new stop to the job's end.

---

### P4-T07 — Per-theme analysis with sub-batching (depth ≤ 2)

| Field | Value |
|---|---|
| **ID** | `P4-T07` |
| **State** | `TODO` |
| **Depends on** | `P4-T03`, `P4-T05` |
| **Blocks** | `P4-T08` |
| **Retires** | part of `R-6` |
| **Implements** | part of `FR-27`, part of `FR-26` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Each theme becomes one validated `ThemeAnalysis` from its members' full summaries, in
parallel, splitting a theme too large for one call and recursing at most once.

**Read first.**
- `docs/12-prompt-library.md` §9 — `CLUSTER_REDUCE`, its schema and "Client-side validation"
- `docs/06-summarization-and-trend-report.md` §8.4 last paragraph — sub-batches, depth cap 2
- `docs/06-summarization-and-trend-report.md` §12.1 L3 — low-confidence `keyFindings` excluded
- `docs/06-summarization-and-trend-report.md` §5.2 — `CLUSTER_REDUCE` 40 000-token budget

**Files.**
- create `src/pipeline/trendReport/themeAnalysis.ts` (caller: `trendReportPipeline.ts`, `P4-T18`)
- modify `src/llm/shared/chunking.ts` (a `packByTokens` helper; file created by `P3-T23`; callers:
  `themeAnalysis.ts`; `compose.ts`, `P4-T08`; `critique.ts`, `P4-T09`, for the cited summaries
  decided 2026-10-26)
- modify `test/unit/llm/chunking.test.ts` (created by `P3-T23`)
- create `test/unit/pipeline/trendThemeAnalysis.test.ts`

**Do.**
1. Strip `keyFindings` from low-confidence members before serialising them.
2. One call per theme under the `llm` pool, temperature 0.3, effort `medium` (§0.2, decided
   2026-10-26), budgeted.
3. Validate: every `[[key]]` anywhere in the output, `narrative` included, is in the theme's member
   set; an out-of-theme key forces one retry, then the key is removed and the theme carries a
   warning.
4. Over budget: `packByTokens` into sub-batches, one `CLUSTER_REDUCE` call each, then one
   `CLUSTER_REDUCE_MERGE` call (`P4-T03`'s file, decided below) over the partial analyses, at the
   same temperature and effort; never deeper.
5. Count passes.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/06` §8.4 runs "one more
> `CLUSTER_REDUCE` over the sub-batch *outputs* (which are already in the theme-analysis shape)", but
> `docs/12` §9 fills `{{SUMMARIES_JSON}}` with "Full `PaperSummary` objects for members" and its text
> says "PAPER SUMMARIES". **Decided: a second prompt file, `CLUSTER_REDUCE_MERGE`, whose user text
> says it receives partial theme analyses — a new prompt the owner approves, written into `docs/12`
> first** — rather than feeding theme analyses under a label that calls them paper summaries. The
> coordinator placed the writing and shipping in `P4-T03` (step 1.1, beside `THEME_MERGE`) on
> 2026-10-26, so both new prompts reach the owner in one review; this card's step 4 calls it and does
> not start before `P4-T03` ships it. (The alternative not taken: reuse `CLUSTER_REDUCE` with
> partial analyses under the "paper summaries" label.)

**Do NOT.**
- Do **not** recurse past depth 2.
- Do **not** let one failed theme abort the run; it is recorded and the theme is reported as
  unanalysed (`docs/06` §8.5 failure policy).

**Done when.**
- [ ] A scripted out-of-theme key triggers exactly one retry, then removal with a warning.
- [ ] A theme of 60 synthetic summaries under a 40 000-token budget makes k sub-batch calls plus one
      merge call, and no third level.
- [ ] A low-confidence member's findings are absent from the request body.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendThemeAnalysis chunking` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendThemeAnalysis chunking
```

**Notes.** Needs from Phase 3: **`P3-T23` (NOT BUILT)** for `chunking.ts`; **`P3-T25` (NOT BUILT)**
for the summaries; `P3-T17` (built). `docs/11` §1 Phase 4 "Modules touched" names
`src/llm/shared/chunking.ts`, which is why packing goes there rather than into `trendReport/`.

*As built 2026-10-29 (`plan/00` §6 item 308; fake model only; `P3-T23` and `P3-T25` have since been
built).* `analyseThemes`, `summariesForReduce`, `packThemeSummaries`, `citedKeyProblems`,
`removeForeignKeys` and `maxPartialsPerMerge` in `src/pipeline/trendReport/themeAnalysis.ts`;
`packByTokens` in `src/llm/shared/chunking.ts`. The readings are `docs/12` §9's and §21's notes and
`docs/06` §8.4's, all of this date. Rule 10: nothing calls `analyseThemes` yet; `trendReportPipeline.ts`
(`P4-T18`) calls it at its analyse stage with the `clustered` outcome's clustering, the stored
summaries, its context's router, budget and token, the `llm` pool and the two templates, adds the
outcome's `passes` to the run's counter and lifts each analysed theme's `warnings`;
`src/bootstrap/registerPipelines.ts` (`P4-T18`) is the constructing file, where the pool already
exists (`buildPipelineSet`). `packByTokens`' other callers are `compose.ts` (`P4-T08`) and
`critique.ts` (`P4-T09`). Nothing is constructed here. ~~**Open for the owner (2026-10-29):**~~ a theme
that would need more than 11 sub-batches (about 231 summaries at 1 840 tokens) is reported as
unanalysed before any request, because one merge could not be sure to carry its partials (`docs/06`
§8.4's note, reading (4)); the alternative is to send the sub-batches and fail only when the measured
partials overflow. ~~And what the run does when **every** theme is unanalysed is `P4-T18`'s to decide;
no document says.~~

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(f)):* the depth-2 ceiling stays **as built**: a
theme too large for one depth-2 merge is unanalysed before any request (`theme_too_large`). The
report names it as too large to analyse; `P4-T12` builds that wording. `docs/06` §8.4's note,
reading (4).

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(g)):* when every theme is unanalysed,
`analyseThemes` returns the outcome `stopped-no-theme-analysed` (`NoThemeAnalysedOutcome`, message
`NO_THEME_ANALYSED_L10N`, `research-helper-report-stopped-no-theme-analysed`, on
`KO_PENDING_REVIEW` until the owner approved its Korean on 2026-10-29, `plan/00` §6 item 310(a), and on
`KO_PRESENT` since) instead of an `analysed` one; the summaries and cached stage results are
untouched. `ThemeAnalysisOutcome` is now that union, each member with a `status`. `P4-T18` maps it to
the job's end. `docs/12` §9's note of this date.

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(b)):* `maxPartialsPerMerge` moved to
`src/pipeline/shared/estimate.ts` (this file re-exports it) beside the new `packThemeMembers`, which
`packThemeSummaries` now calls, so `planSynthesis` counts theme calls with the same packer without an
import cycle. The comparison tests against `planSynthesis` now pin "estimate ≥ actual". `docs/07`
§4.5's note of this date.

---

### P4-T08 — Report composition call and structural validation

| Field | Value |
|---|---|
| **ID** | `P4-T08` |
| **State** | `TODO` |
| **Depends on** | `P4-T03`, `P4-T04`, `P4-T07`, `P4-T10` |
| **Blocks** | `P4-T09`, `P4-T21` |
| **Retires** | part of `R-6` |
| **Implements** | `FR-25`, part of `FR-26`, part of `FR-27` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** Theme analyses plus digests become one Markdown report with exactly the eleven required
sections, every marker in the valid set, inside the 60 000-token budget at any N.

**Read first.**
- `docs/12-prompt-library.md` §10 — variables, the eleven headings, "Expected output" checks 1–5
- `docs/06-summarization-and-trend-report.md` §8.3 last paragraph — trim digests to the
  cited-and-notable subset above ~250 papers
- `docs/06-summarization-and-trend-report.md` §9.2 — target words and themes by corpus size
- `src/core/provenance.ts` `SearchProvenance` — where `{{SEARCH_STRATEGY}}` comes from

**Files.**
- create `src/pipeline/trendReport/compose.ts` (caller: `trendReportPipeline.ts`, `P4-T18`; and
  `critique.ts`, `P4-T09`, for the rewrite)
- create `test/unit/pipeline/trendCompose.test.ts`

**Do.**
1. Build every computed variable in code: the counts, `EXCLUSION_REASONS` from the screening
   outcomes, year range, `SOURCES` (the database names from the collection's `search_provenance`
   runs when any exist, else the distinct `libraryCatalog` values of the analysed items, else "not
   recorded" — decided below), `SEARCH_STRATEGY` (or "manually curated by the user"),
   `TARGET_WORDS` from `report.targetWords` (passed in by the pipeline, which reads it through
   `ctx.config`) or the §9.2 table.
2. Trim `{{DIGESTS}}` to the members named in any `representativePapers` or cited in a theme
   analysis when the full set would exceed the budget.
3. Call `TREND_REPORT_EN` or `_KO` on `resolveModel("strong")`, temperature 0.3, effort `medium`
   (§0.2, decided 2026-10-26), budgeted, through `chatStream` with deltas forwarded to the progress
   reporter.
4. Validate per `docs/12` §10 checks 1–5 using `P4-T10`; compute density and coverage for
   Appendix B. ~~A heading failure (checks 1–2) triggers **one fresh generation** with the failure
   stated in `{{REVISION_NOTES}}`; an invalid marker is never repaired by a model — `P4-T10` replaces
   it visibly (decided below).~~ **Check 1 regenerates once; check 2 is replaced visibly, with no
   model call** (`docs/12` §10): a missing, extra or misordered heading triggers one fresh generation
   with the failure stated in `{{REVISION_NOTES}}`, and `P4-T10` replaces an invalid marker visibly
   (decided below). *(Aligned 2026-10-26, owner, `plan/00` §6 item 290: check 2 is the citation
   check, not a heading check, so "checks 1–2" was wrong.)*
5. Read a stored `report.targetWords` of 1–399 as `0`, automatic, so `TARGET_WORDS` comes from the
   §9.2 table, with a unit test (decided below). Values 0 and ≥ 400 pass through unchanged.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 290(d)):** `docs/07` §8.5 allows
> `report.targetWords` to be "`0`, or ≥ 400", but `PrefDef` can state only an inclusive range or a
> closed list, so the preference reader returns a stored 1–399 as stored (`P4-T02`'s finding, pinned
> by a test in `test/unit/prefs/schema.test.ts`). **Decided: this card reads 1–399 as `0`
> (automatic); `PrefDef` is not extended.** Built by step 5.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/12` §10 says "Failures 1–2 trigger
> a repair call", but the repair path it defines (§18.3) repairs **JSON** against a schema; nothing
> defines repairing Markdown. **Decided: a heading failure triggers one fresh generation** with the
> failure stated in `{{REVISION_NOTES}}` (the same mechanism as the critique rewrite), **and an invalid
> marker is never repaired by a model** — `P4-T10` replaces it visibly. Written into `docs/12` §10
> "Expected output" by `P4-T03` step 1.3; built by step 4. (The alternative not taken: a model repair
> pass on the Markdown, which no document defines.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `{{SOURCES}}` has no stated source for a
> manually built collection. **Decided: the database names from the collection's `search_provenance`
> runs when any exist, else the distinct Zotero `libraryCatalog` values of the analysed items, else
> "not recorded"** (step 1). *(Review
> 2026-10-25, grepped: the hand-mapped import path sets `libraryCatalog` to the winning source's
> catalogue label — `catalogLabelFor` in `src/zotero/itemMapper.ts`; a translator import writes
> Zotero's own value, and a user-added item may have none.)* Written into `docs/12` §10 "Input
> variables" by `P4-T03` step 1.3. (The alternative not taken: "not recorded" whenever there is no
> search record.)

**Do NOT.**
- Do **not** send full summaries to this call (`docs/12` §10 "Note").
- Do **not** ask the model for counts, dates or the bibliography (`docs/12` §1.1 rule 7).
- Do **not** retry a failed call here; `completeJSON`'s rules do not apply to Markdown and the
  router's retry policy already ran.

**Done when.**
- [ ] A scripted report missing `## 7.` triggers exactly one fresh generation with the failure named.
- [ ] With 300 synthetic digests the rendered request stays within 60 000 tokens by `estTokens`.
- [ ] Every computed variable is asserted against the fixture's real counts.
- [ ] A stored `report.targetWords` of 1 and of 399 gives the §9.2 table's `TARGET_WORDS`; 0 does
      too, and 400 gives 400 (item 290(d), step 5).
- [ ] A stored 4 250 is sent as 4 250 with no warning; 4 251 and 8 000 are sent as 4 250 and the
      composed report carries `TARGET_WORDS_CAPPED_WARNING` *(added 2026-10-30, owner, `plan/00` §6
      item 312(c))*.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendCompose` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendCompose
```

**Notes.** Needs from Phase 3: `P3-T11`, `P3-T24`, `P3-T27` (built). The streamed call is bounded by
3 minutes without new text and 15 minutes in all (item 268(c)). Section names: `docs/11` §1 and
FR-25 list six required topics ("scope and method, volume/time distribution, dominant themes …,
methodological shifts, contradictions/open questions, and limitations"); `docs/06` §9.1's eleven
sections cover all six, with limitations inside §2 Scope and Method. `P4-T25` records that mapping
against FR-25.

*As built 2026-10-29 (`plan/00` §6 item 310(b); fake model only).* `src/pipeline/trendReport/compose.ts`
declares `composeReport`, `prepareComposition`, `reportVariables`, `reportScopeOf`, `resolveTargetWords`,
`targetWordsFor`, `exclusionReasons`, `sourcesOf`, `searchStrategyOf`, `expectedHeadings`, `checkHeadings`,
`structureRevisionNote`, `splitSections` and `citationDensity`, with the types `ComposeInput`,
`ComposeDeps`, `ComposeOutcome` (`ComposedReport` or `StructureInvalidOutcome`), `CompositionPlan`,
`HeadingCheck`, `ComposeQuality`, `DraftDelta`, `AnalysedPaper`, `ComposeTheme` and `SearchRunSummary`;
its readings are `docs/12` §10's note and `docs/06` §9.2's note of this date. Callers (rule 10):
`trendReportPipeline.ts` (`P4-T18`) at its compose stage, calling `prepareComposition` first when it
builds the `rp` key (`targetWords`, the digests sent); `critique.ts` (`P4-T09`) for a rewrite, passing
its notes as `revisionNotes`; `P4-T21` for a Korean report (`TREND_REPORT_KO`,
`citationReplacement`). Constructing file: `src/bootstrap/registerPipelines.ts` (`P4-T18`); nothing is
constructed here. The module does not pack with `packByTokens`: it trims `{{DIGESTS}}` instead, so
`P4-T09` reaches `packByTokens` directly. ~~**Open for the owner (2026-10-29):** (1) what a regeneration that
fails check 1 again does — built provisionally as the outcome `stopped-structure-invalid` with no
message id; recommended: stop before anything is written, with a new message on
`KO_PENDING_REVIEW`; (2) the structure note's wording (`structureRevisionNote`), new prompt text sent in
English to both prompts.~~

*Decided 2026-10-30 (owner, `plan/00` §6 item 311(a), (b), (c)):* (a) a regeneration that fails check 1
again stops the run before anything is written and says why: `StructureInvalidOutcome` carries
`messageId` `STRUCTURE_INVALID_L10N` (`research-helper-report-stopped-structure-invalid`, main-window
bundle, no argument, its Korean a commented stub on `KO_PENDING_REVIEW`, `G-41` — *on `KO_PRESENT` since
decided 2026-10-30, owner, `plan/00` §6 item 312(a)*), and `P4-T18` ends the
job on it, keeping summaries and cached stage results. (b) The structure note (`structureRevisionNote`)
is approved as drafted. (c) `TREND_REPORT_EN`'s and `TREND_REPORT_KO`'s ceilings are 23 000 and 26 000
(prompt version 1.0.1, a PATCH), so `composeReport`'s call sends them through `resolveMaxTokens` with no
code change here. `docs/12` §10's, §11's and §17.3's notes of this date.

*Decided 2026-10-30 (owner, `plan/00` §6 item 312(c)):* a stored `report.targetWords` above 4 250 is sent
as 4 250, the longest target the ceilings are sized for; 400 to 4 250 is sent as stored. Built in
`compose.ts`: `TARGET_WORDS_MAX` (4 250, read by a test from `docs/12` §10's derivation) caps the figure in
`resolveTargetWords`; `isTargetWordsCapped` and `CompositionPlan.targetWordsCapped` record that the cap applied; a composed report's
`warnings` carry `TARGET_WORDS_CAPPED_WARNING` (`report_target_words_capped`), which `P4-T12` turns into the
appendix line. Pinned by unit tests: 4 250 is sent as stored with no warning, 4 251 and 8 000 are sent as
4 250 with the warning. `docs/06` §9.2's and `docs/12` §10's notes of this date. *(item 312(d) confirms
the 1.0.0 → 1.0.1 PATCH; `docs/12` §17.3.)*

---

### P4-T09 — Self-critique pass, revision loop, warning banner

| Field | Value |
|---|---|
| **ID** | `P4-T09` |
| **State** | `TODO` |
| **Depends on** | `P4-T02`, `P4-T08`, `P4-T12` |
| **Blocks** | `P4-T18` |
| **Retires** | part of `R-6`, part of `R-7` |
| **Implements** | `FR-26` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The draft is checked against its evidence; high-severity problems trigger a fresh
generation; anything left unresolved ships with a visible banner, never hidden.

**Read first.**
- `docs/12-prompt-library.md` §12 — `SELF_CRITIQUE`, schema, the different-model note
- `docs/06-summarization-and-trend-report.md` §12.2 — rounds 0–2, only `high` rewrites, the banner
- `docs/06-summarization-and-trend-report.md` §8.5 step 4 — the loop
- `docs/12-prompt-library.md` §18.5 — `SELF_CRITIQUE` is `standard` tier
- `docs/09-security-privacy-and-api-keys.md` §3 egress table row "3b. Trend report"

**Files.**
- create `src/pipeline/trendReport/critique.ts` (caller: `trendReportPipeline.ts`, `P4-T18`)
- create `test/unit/pipeline/trendCritique.test.ts`
- modify `docs/06-summarization-and-trend-report.md` (§8.5, §12.2, §15; dated "Decided" notes)
- modify `docs/07-architecture-and-data-model.md` (§8.5, what an empty `report.critiqueModel` means;
  dated)

**Do.**
1. **Documents first** (decided 2026-10-26, item 286): write the four decisions below into `docs/06`
   §12.2 (the critique model; the banner on an unchecked revision), §15 and `docs/07` §8.5 (an empty
   `report.critiqueModel` means `summaryModel`), and `docs/06` §8.5 (the critique's evidence),
   each under a dated note. `P4-T03` step 1.4 writes the `docs/12` §12 and §18.5 halves.
2. Rounds from `report.maxCritiqueRounds`; `0` skips the pass.
3. The critique model: the active provider only, `report.critiqueModel` when set, else
   `summaryModel`; never an automatically picked model and never a second provider; checked by
   `assertModelAllowed` like the report model.
4. The evidence: the summaries of the items the draft **cites** (its markers after `P4-T10`'s
   pass), packed to `SELF_CRITIQUE`'s budget by `packByTokens`; when the cited set still
   overflows, one critique call per section with that section's cited summaries, their problems
   combined.
5. Each round: the critique (temperature 0, effort `low` — §0.2, decided 2026-10-26 — budgeted),
   then, if any `high` problem, one rewrite through `P4-T08` with `{{REVISION_NOTES}}`.
6. After the last round, hand the remaining problems to `P4-T12` as the banner and Appendix C's
   rows. When a rewrite followed the last critique, the banner also states that the shipped text is
   a revision that was not re-checked.
7. When a rewrite's `composeReport` returns `stopped-structure-invalid` (its first answer and its one
   fresh generation both failed the section check), keep the earlier draft that passed it and do not
   stop the run: do not show the outcome's `messageId`, end the critique loop at that round, count the
   rewrite's usage, and hand `P4-T12` the last critique's unresolved problems with a banner that states
   the review's revision could not be applied (in place of step 6's "not re-checked" statement).
   *(Decided 2026-10-30, owner, `plan/00` §6 item 312(b); `docs/12` §10 reading (3) and §12, notes of
   this date. Ending the loop at that round is the coordinator's reading, recorded in `docs/12` §12 for
   the owner to confirm. `composeReport` needed no change: this card is the only caller that sends
   `revisionNotes`, and it holds the earlier draft.)*

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** which model critiques. `docs/06` §15 and
> `docs/07` §8.5 say
> `report.critiqueModel` empty means "pick a model different from the writer"; `docs/12` §18.5 says
> the different provider "is a provider choice, not a fourth model pref" and places `SELF_CRITIQUE`
> on `standard` (`summaryModel`); `docs/12` §19 item 1 rules that "the plugin never calls a model
> the user did not choose"; `LLMRouter.activeProvider` is "Never a fallback to another provider"
> (`src/llm/types.ts`); and `docs/09` §3 row 3b sends report content to the "Same LLM provider".
> **Decided: critique on the active provider only, with `report.critiqueModel` when set, else
> `summaryModel` (the `standard` tier) — never an automatically picked model, never a second
> provider in v1.** A second provider would need a router change (`docs/07` §4.3) and a second
> egress disclosure (`docs/09` §3.4). Written into `docs/06` §12.2 and §15 and `docs/07` §8.5 by
> step 1, and `docs/12` §12 and §18.5 by `P4-T03` step 1.4; built by step 3. (The alternative not
> taken: automatically use a different provider when two keys exist.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `{{SUMMARIES_JSON}}` is "All `PaperSummary`
> objects used" (`docs/12` §12)
> and `docs/06` §8.5 passes `summaries.map(s => s.summary)`, but `docs/06` §5.2 gives `SELF_CRITIQUE`
> a 60 000-token budget and `docs/06` §8.1 puts a summary at "900–1 600 tokens", so the evidence
> overflows above roughly 40–60 papers — and the definition of done requires 400. **Decided: send
> the summaries of cited items only, packed to budget by `packByTokens`; if the cited set still
> overflows, critique section by section with each section's cited summaries.** Written into
> `docs/06` §8.5 by step 1 and `docs/12` §12 "Input variables" by `P4-T03` step 1.4; built by
> step 4. (The alternative not taken: check against the digests instead of full summaries.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the banner says "See Appendix C"
> (`docs/06` §12.2), but `docs/06` §9.1 defined only Appendices A and B. **Decided: add "Appendix C
> — Unresolved review findings" to §9.1, generated by `P4-T12`**, which writes it into `docs/06` §9.1
> (its step 1). (The alternative not taken: list the findings inside the provenance appendix.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** with `maxCritiqueRounds: 1`, `docs/06`
> §8.5 rewrites after the critique but never critiques the rewrite, so the banner would list problems
> of a draft the user never sees. **Decided: the banner lists the last critique's unresolved problems
> and states that the shipped text is a revision that was not re-checked.** Written into `docs/06`
> §12.2 by step 1; built by step 6. (The alternative not taken: always one more paid check after a
> rewrite.)

**Do NOT.**
- Do **not** use an edit pass; a rewrite is a fresh generation (`docs/06` §12.2).
- Do **not** hide or drop a remaining problem.
- Do **not** start steps 3–5 before step 1's `docs/06` and `docs/07` notes land.

**Done when.**
- [ ] Against critiques scripted to report a `high` problem every round, with evidence that fits one
      call, rounds `0`, `1`, `2` make exactly 0, 2 and 4 calls; against a `pass` verdict, rounds
      `2` makes exactly 1. *(Review 2026-10-25: "≤ 2 and ≤ 4" passed with no call at all.)*
- [ ] A `medium`-only critique triggers no rewrite; a `high` one triggers exactly one per round.
- [ ] The critique request carries the summaries of cited items only; a cited set over budget makes
      one critique call per section.
- [ ] `report.critiqueModel` set is used; empty resolves to `summaryModel` on the active provider.
- [ ] Remaining problems produce the banner text and Appendix C rows; after a rewrite that followed
      the last critique, the banner says the text was not re-checked.
- [ ] A rewrite scripted to fail the section check twice (`stopped-structure-invalid`) ships the earlier
      draft byte for byte, makes no further critique call, does not stop the run, and the banner says
      the review's revision could not be applied *(added 2026-10-30, owner, `plan/00` §6 item 312(b))*.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendCritique` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendCritique
```

**Notes.** Needs from Phase 3: `P3-T13`, `P3-T15` (built) — `assertModelAllowed` applies to the
critique model too. The banner's words are report-language text (§0.2 item 15) and come from
`P4-T12`'s label table, which is why this card depends on `P4-T12` *(edge added by the review,
2026-10-25: `P4-T12` names `critique.ts` as a caller of `reportLabels.ts`)*. Whether the pass runs by
default (`plan/05` §1.3, now §5.3) is settled: `report.maxCritiqueRounds` ships at `1` (`docs/07` §8.5).
~~`packByTokens` is `P4-T07`'s, reached through `P4-T08`.~~ `packByTokens` is `P4-T07`'s, in
`src/llm/shared/chunking.ts`; this card calls it directly, because `P4-T08`'s `composeReport` does not pack —
it trims `{{DIGESTS}}` instead *(corrected 2026-10-30, `plan/00` §6 item 311; `plan/reports/P4-T08.md`
finding 3)*. Whether `P4-T16`'s estimate must reserve
step 4's per-section calls: verify yourself; I believe each extra call is reserved at dispatch by
`withBudget` and a refusal pauses the job with the stage pending (§0.2 item 18), so the estimate
need not price a path it cannot predict — if that is wrong, stop and say so.

*As built 2026-10-30 (`plan/00` §6 item 316; fake provider only, no live call; `plan/reports/P4-T09.md`).*
`src/pipeline/trendReport/critique.ts` declares `critiqueReport` (the stage), `planCritique`,
`draftForCritique`, `combineCritiques`, `revisionNotesFor`, `resolveCritiqueModel`, `critiqueRoundsOf`, the
types `CritiqueInput`, `CritiqueDeps`, `CritiqueResult`, `CritiquePlan`, `CritiqueUnit`, `RevisionSignal`, and
the constants `CRITIQUE_EFFORT`, `CRITIQUE_SCHEMA_NAME`, `CRITIQUE_MODEL_PREF`, `CRITIQUE_PER_SECTION_WARNING`,
`CRITIQUE_TEXT_UNCHECKED_WARNING`, `REVISION_NOTES_INSTRUCTION`, `REVISION_NOTES_LIST_LABEL`. It calls
`packByTokens` directly, `bibliographyKeys` (`P4-T12`) for the cited set, `summariesForReduce` (`P4-T07`) for the
evidence and `composeReport` (`P4-T08`) for each rewrite; `src/model/trend.ts` was not changed (it reads and
writes `CritiqueOutcome`, `revisionNotApplied` included). The readings it needed are `docs/06` §12.2's note
"As built 2026-10-30", each DECIDED 2026-10-30 (coordinator, under `plan/00` §6 item 313), except two left open
there: the wording of `REVISION_NOTES_INSTRUCTION` (new prompt text, as items 301 and 311(b)) and whether a
failed critique request or a rewrite error other than `stopped-structure-invalid` should ship the earlier draft
rather than fail the job. Step 4's estimate question is answered as believed: `planSynthesis`'s comment in
`src/pipeline/shared/estimate.ts` lists the per-section calls among those reserved at dispatch by `withBudget`.
**Rule 10:** the caller is `trendReportPipeline.ts` (`P4-T18`) at its critique stage; the constructing file is
`src/bootstrap/registerPipelines.ts` (`P4-T18`); nothing is constructed in the module. The signal of item 314(c) is
`CritiqueDeps.onRevision` (`P4-T18` passes it through; `P4-T20` shows it).

*Decided 2026-10-30 (coordinator, `plan/00` §6 item 317(b)–(d)); built by `P4-T18`'s first step:* the second
open line above is settled. A rewrite that throws (`OutputTruncatedError`, a network or upstream failure, a
content filter) is handled like a rewrite's `stopped-structure-invalid`: the earlier draft ships with
`bannerRevisionNotApplied`, the loop ends, `rewrite-not-applied` is signalled. A cancel, a budget refusal, a
rejected key, a configuration, policy or privacy error and a defect still end the stage (`rewriteErrorEndsRun`
in `critique.ts`, the split `themeAnalysis.ts` makes). A failed critique request still fails the job.
`critique_text_unchecked` gets Appendix B's line (`P4-T12`'s note of this date). `src/llm/shared/chunking.ts`'s
header no longer calls `critique.ts` "not built yet". `docs/06` §12.2's note of this date, readings (12)–(13).

---

### P4-T10 — Citation validator and marker binding

| Field | Value |
|---|---|
| **ID** | `P4-T10` |
| **State** | `TODO` |
| **Depends on** | `P4-T01` |
| **Blocks** | `P4-T08`, `P4-T11`, `P4-T13`, `P4-T15` |
| **Retires** | part of `R-7` |
| **Implements** | `FR-26` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Every `[[itemKey]]` in any generated text is resolved against the run's valid set before
rendering; an invalid one is replaced visibly; a 100 % resolution figure is computed, not assumed.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §10.1 — `CITE_RE`, the replacement text
- `docs/06-summarization-and-trend-report.md` §13.4 — a dropped duplicate's citations are
  rewritten to the kept key
- `docs/06-summarization-and-trend-report.md` §10.2 — `[n]` assigned in order of first appearance
- `docs/13-testing-build-and-release.md` §2.1 "Citation binding" row

**Files.**
- create `src/pipeline/trendReport/citations.ts` (callers: `compose.ts`, `P4-T08`; `noteHtml.ts`,
  `P4-T13`; `exportMarkdown.ts`, `P4-T15`; the run's report, `P4-T18`). *Noted 2026-10-27
  (`P4-T10`, rule 10): nothing calls it yet; also `critique.ts`, `P4-T09`, for the cited keys
  (`citedKeysOf`). Pure functions, so nothing constructs it; the logger comes from the caller's
  `PipelineContext.logger`.*
- create `test/unit/pipeline/trendCitations.test.ts`

**Do.**
1. Extract markers; rewrite duplicate keys to their kept key; check the rest against the valid set
   (analysed items only).
2. Replace each invalid marker with `[citation removed: invalid reference]` and log it, redacted.
3. Assign bibliography indices in first-appearance order; ignore markers inside code fences and flag
   them (`docs/12` §10 check 5).
4. Return the resolution figures Appendix B shows.

**The valid set is settled** *(review 2026-10-25; this was half of an open line)*: the analysed
items — `docs/12` §12's `VALID_ITEM_KEYS` is the summaries' keys, and a retracted item "never
contributes to a synthesis" under every `screening.retractionPolicy` (item 281(a); `docs/06` §13.3's
as-built note), so a marker to a retracted item is replaced like any other invalid marker.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** how a retracted item appears in §11
> Bibliography. `docs/06` §13.3 and `P3-T27`'s as-built reading of `exclude_from_synthesis` (the
> default) keep it "in the Bibliography", while §9.1 defines the Bibliography as "every cited item,
> numbered" — and it is never cited. **Decided: an unnumbered "Retracted — not used in this report"
> list after the numbered entries (built with `P4-T11`'s formatter, placed by `P4-T12`), with
> `exclude_entirely` leaving it out**, as that value already means. This card's markers are
> unchanged by it: a marker to a retracted item is still replaced as invalid. `P4-T12` writes the
> sentence into `docs/06` §9.1 and builds the list (its steps 1 and 2). (The alternative not taken:
> Appendix A only, which would change §13.3 and the as-built policy reading.)

**Do NOT.**
- Do **not** silently delete an invalid marker (`docs/06` §10.1).
- Do **not** call a model.

**Done when.**
- [ ] Markers to a non-member, a malformed key and a key in a code fence are each handled and counted.
- [ ] A duplicate's key is rewritten to the kept key and counted as resolved.
- [ ] After the pass, every remaining marker resolves (the function returns 100 % or throws).
- [ ] A combined marker (`[[KEY1, KEY2]]`, `[[KEY1; KEY2]]`) becomes one marker per part, each
      checked on its own: a valid part kept, an invalid part replaced visibly, no key re-cased or
      invented. *(Added 2026-10-27, owner, `plan/00` §6 item 292(c); the reading is `docs/06`
      §10.1's note of that date.)*
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendCitations` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendCitations
```

**Notes.** Needs from Phase 3: `P3-T27` (built) for duplicate groups. FR-26's example marker "`[Kim
2025]`" is an example; `docs/06` D-06-7's numeric `[n]` anchors satisfy it.

---

### P4-T11 — Bibliography and citation nodes through Zotero

| Field | Value |
|---|---|
| **ID** | `P4-T11` |
| **State** | `TODO` |
| **Depends on** | `P4-T10` |
| **Blocks** | `P4-T13`, `P4-T15` |
| **Retires** | part of `R-7` |
| **Implements** | `FR-26` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** The bibliography is formatted by Zotero's own citation processor in the user's style (or a
recorded fallback), and the Notable Papers and Bibliography entries are real Zotero citation nodes.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §10.3 — the `Unverified` entry point and the
  `itemToCSLJSON` fallback
- `docs/06-summarization-and-trend-report.md` §10.2 option (b) and D-06-7 — the citation node shape
  and `Zotero.URI.getItemURI`
- `docs/06-summarization-and-trend-report.md` §16 item 3 — who owns the verification

**Files.**
- create `src/zotero/bibliography.ts` (callers: `noteHtml.ts`, `P4-T13`, and `exportMarkdown.ts`,
  `P4-T15`, through a port passed in by `trendReportPipeline.ts`, `P4-T18`) *Noted 2026-10-27
  (`P4-T11`, rule 10): nothing calls it yet. The port is the constant `zoteroBibliographyPort`, so
  nothing constructs it; `trendReportPipeline.ts` (`P4-T18`) passes it to `noteHtml.ts` (`P4-T13`) and
  `exportMarkdown.ts` (`P4-T15`), and builds the report's `bibliography` and `retracted` lists with it.*
- create `test/integration/zotero/bibliography.spec.ts`
- modify `docs/01-zotero-plugin-platform.md` (a new subsection recording the measured entry point)
- modify `docs/06-summarization-and-trend-report.md` §10.3 (pointer to `docs/01`, dated)

**Do.**
1. Inside Zotero 10.0.3, measure which entry point formats a bibliography for given items in the
   user's style (`Zotero.Styles.get(...).getCiteProc`, `Zotero.Cite.makeFormattedBibliographyOrCitationList`
   or `Zotero.QuickCopy` — verify yourself; none is confirmed). Record what was called and returned in
   `docs/01`.
2. Build citation nodes per §10.2 (b): `itemToCSLJSON`, `getItemURI`, and the
   `data-citation-items` payload for the note wrapper.
3. If no entry point works, ship the `itemToCSLJSON` fixed format and record the README limitation
   §5.4 names (from `plan/05` §1.4).

**Who owns the API is settled** *(review 2026-10-25; this was an open line)*: `docs/06` §10.3's own
action item says "`01-zotero-plugin-platform.md` should own the confirmed API", and `plan/05` §1.3 (§5.3)
records the decision's home as `docs/01` with `docs/06` §10.3 pointing at it — which is this card's
`Files` list. The card's agent answers `docs/06` §16 item 3 that way in the same edit.

**Do NOT.**
- Do **not** ask the model to format a reference (`docs/06` §10.3).
- Do **not** reference `Zotero.*` outside `src/zotero/` (`research-helper/zotero-global`).

**Done when.**
- [ ] The integration spec formats three test items in two styles and gets different strings, or
      the fallback is recorded with the measurement that ruled the processor out.
- [ ] A citation node built here parses back to the same item URIs.
- [ ] `npm run typecheck` exits 0; the integration suite passes.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs from Phase 3: nothing. Measurement only; no spend, no network.

---

### P4-T12 — Client-generated title block, tables and appendices

| Field | Value |
|---|---|
| **ID** | `P4-T12` |
| **State** | `TODO` |
| **Depends on** | `P4-T01`, `P4-T04` |
| **Blocks** | `P4-T09`, `P4-T18`, `P4-T21` |
| **Retires** | part of `R-6` |
| **Implements** | `FR-25`, `FR-27`, `NFR-15` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Everything a reader could check against Zotero — the title block and metadata header, the
§3 year table, the §5 study-design table, Appendices A, B (and C) — is computed in code, in the
report's language.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §9.1 — title block, the two tables, Appendices A and B
- `docs/06-summarization-and-trend-report.md` §12.3 "Automated proxies" — Appendix B's figures
- `docs/10-requirements-and-user-stories.md` FR-25, FR-27, NFR-15 — the header's required fields,
  the pass count
- `docs/06-summarization-and-trend-report.md` §11.2 reading 7 — the mixed-model warning code
- `docs/08-ui-ux-spec.md` §10.4 — UI language versus generated-content language

**Files.**
- create `src/pipeline/trendReport/scaffold.ts` (caller: `trendReportPipeline.ts`, `P4-T18`)
- create `src/pipeline/trendReport/reportLabels.ts` (callers: `scaffold.ts`; `critique.ts`, `P4-T09`;
  `compose.ts` for the invalid-citation label, `P4-T21` — *added 2026-10-27, item 292(b)*)
- create `test/unit/pipeline/trendScaffold.test.ts`
- modify `docs/06-summarization-and-trend-report.md` (§9.1: Appendix C, the retracted list, the
  Notable Papers sentence; dated "Decided" notes)
- modify `docs/08-ui-ux-spec.md` (§10.4, one sentence on where report-language labels live; dated)

**Do.**
1. **Documents first** (decided 2026-10-26, item 286): write into `docs/06` §9.1 "Appendix C —
   Unresolved review findings" (decided on `P4-T09`), the unnumbered "Retracted — not used in this
   report" list after the numbered Bibliography (decided on `P4-T10`), and that the model writes
   Notable Papers and code checks it without ranking (decided below); and into `docs/08` §10.4 that
   report-language labels live in `reportLabels.ts`, keyed by report language. Each under a dated
   note.
2. The header: item count, date range, provider/model, prompt versions (full strings), generation
   timestamp, temperatures, **reduction pass count**, analysis-depth split — "full text" versus
   "abstract only" counts, and no claim of section-level provenance (decided below).
3. Insert the two client tables into §3 and §5 of the model's Markdown and replace §11 wholesale with
   `P4-T11`'s bibliography slot, followed by a slot for the unnumbered retracted list, filled from
   `P4-T11`'s formatter the same way and left out under `exclude_entirely`.
4. Check the model's §10 Notable Papers table: every row's key in the valid set, 8–15 rows; add no
   ranking (decided below).
5. Appendix A from the screening outcomes and failed items, with `docs/06` §9.1's reason codes;
   Appendix B with per-paper tier, confidence, grounding score, token counts, total cost, and
   mixed-model or mixed-prompt flags; Appendix C from the problems `P4-T09` leaves unresolved, and
   the banner it asks for.
6. Labels from `reportLabels.ts`, keyed by report language (`en`, `ko`). The `ko` table ships
   pending review; the coordinator drafts the Korean and the owner approves it in chat (decided
   below).
7. The label table carries the invalid-citation text: `en` `[citation removed: invalid reference]`
   (`INVALID_CITATION_TEXT`) and `ko` "[인용 삭제: 잘못된 참조]", which is passed to `P4-T10`'s
   `CitationContext.replacement` for a `ko` report. *(Decided 2026-10-27, owner, `plan/00` §6 item
   292(b): this one `ko` label is already approved, so it does not ship pending review. `P4-T21`
   wires it; this card only puts it in the table.)*

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** where report-language labels live. They are
> not UI strings (`docs/08` §10.4), so a Fluent bundle keyed by the UI locale is the wrong home, and
> no document assigned one. **Decided: `reportLabels.ts` with an `en` and a `ko` table; the
> coordinator drafts the Korean and the owner reviews it in chat, in preview batches**, as for UI
> strings under `G-41` (item 284(a); *review 2026-10-25: this said "on the `G-41` review page",
> which item 284(a) replaced*). Written into `docs/08` §10.4 (one sentence) and `docs/06` §9.1 by
> step 1. (The alternative not taken: the window's language file, which follows the menu language.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the analysis-depth disclosure and section
> provenance (`plan/05` §1.3, now §5.3, "Whether the report claims section provenance"). **Decided: §2 and the
> header state "full text" versus "abstract only" counts and never claim section-level provenance
> until `P3-T22` records a pass** (`docs/06` §4.3, R-19b); built by step 2. `docs/06` §4.3 changes
> when `P3-T22` reports, not in this card; `P4-T25` step 6 records the outcome. (The alternative
> not taken: claim section origin whenever a summary carries it.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/06` §9.1 ranks Notable Papers "by
> `citationWorthiness.score`, then by whether the paper appears in multiple themes'
> `representativePapers`", but `docs/12` §10 has the model write that table. **Decided: the model
> keeps writing it (it carries "Why it matters"), and this card checks it — every row's key valid,
> 8–15 rows — and adds no ranking** (step 4). `docs/06` §9.1's ranking sentence changes in step 1.
> (The alternative not taken: code ranks by the summaries' citation-worthiness score.)

**Do NOT.**
- Do **not** let the model produce any number in these blocks.
- Do **not** machine-translate a Korean label; ship the `ko` table with the English in a comment and
  mark it pending review until the owner approves (§0.2 item 15).
- Do **not** claim section-level provenance anywhere in the header or §2 (decided 2026-10-26).

**Done when.**
- [ ] For a 12-item fixture the header, both tables and Appendices A, B and C match hand-computed
      values; a retracted item appears in the unnumbered list and not in the numbered entries.
- [ ] A Notable Papers table of 7 rows, or one with a key outside the valid set, fails the check.
- [ ] The pass count in the header equals the run's counter.
- [ ] A model §11 is replaced, never merged.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendScaffold` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendScaffold
```

**Notes.** Needs from Phase 3: **`P3-T25` (NOT BUILT)** for `groundingScore`, `confidence`, usage per
summary; **`P3-T22` (NOT BUILT)** for the provenance claim; `P3-T27`, `P3-T16` (built).

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(f)):* a theme `analyseThemes` reports unanalysed
with the reason `theme_too_large` (`UNANALYSED_REASONS.tooLarge` in
`src/pipeline/trendReport/themeAnalysis.ts`) is named in the report as **too large to analyse**. This
card builds that wording, in the report's language, in `reportLabels.ts`' report-language label table
(its `ko` entry follows this card's Korean rule, `plan/04` §0.2 item 15). `docs/06` §8.4's note,
reading (4).

*Decided 2026-10-30 (owner, `plan/00` §6 item 312(c)):* when the stored `report.targetWords` was above
4 250 and was sent as 4 250, the report's appendix says the target was capped. This card builds that
line, in the report's language, from `TARGET_WORDS_CAPPED_WARNING` (`report_target_words_capped`) on
`composeReport`'s `warnings`, or `CompositionPlan.targetWordsCapped` (`src/pipeline/trendReport/compose.ts`),
read from the current run's plan, not a cached report (the `rp` key keys the target as sent). Which
appendix carries it is not decided; Appendix B, beside the run's other figures, is the coordinator's
reading. `docs/06` §9.2's note of this date.

*Decided 2026-10-30 (owner, `plan/00` §6 item 312(b)):* the banner `P4-T09` asks for when a rewrite failed
the section check twice states that the review's revision could not be applied (`P4-T09` step 7). Its
words are one more report-language label in `reportLabels.ts`, under this card's Korean rule.

*As built 2026-10-30 (`plan/00` §6 item 315; no model, no network; `plan/reports/P4-T12.md`).*
`src/pipeline/trendReport/scaffold.ts` declares `scaffoldReport`, `bibliographyKeys`,
`checkNotablePapers`, `yearRows`, `designFrequencies`, `qualityProxiesOf`, `titleBlock`, `qualityBanner`,
`appendixA`, `appendixB`, `appendixC`, `formatTimestamp`, `inertText`, the types `ScaffoldPaper`,
`ScaffoldInput`, `ScaffoldedReport`, `NotablePapersCheck`, `YearRow`, `DesignCount`, and the constants
`NOTABLE_PAPERS_MIN`, `NOTABLE_PAPERS_MAX`, `DOMINANT_PER_YEAR`, `PREAMBLE_DROPPED_WARNING`,
`NOTABLE_PAPERS_INVALID_WARNING`; `src/pipeline/trendReport/reportLabels.ts` declares
`EN_REPORT_LABELS`, `KO_REPORT_LABELS` (only "[인용 삭제: 잘못된 참조]", item 292(b)),
`KO_REPORT_LABELS_PENDING_REVIEW` (every other key), `STUDY_DESIGN_LABEL_KEYS`, `ReportLabelKey`,
`reportLabel`, `reportLabels`, `isKoLabelPending`, `fillLabel` and `labelPlaceholders`. The earlier
cards' English (`OTHER_THEME_NAME`, `OTHER_THEME_DEFINITION`, `SMALL_THEME_REASON`,
`UNMAPPED_THEME_REASON`, `INVALID_CITATION_TEXT`, `DEFAULT_RETRACTED_HEADING`, `DIGEST_NO_YEAR`) is
referenced as the `en` values, not moved. The readings are `docs/06` §9.1's notes of this date,
several *DECIDED 2026-10-30 (coordinator, under `plan/00` §6 item 313)*. Outside `Files`, two small
additions the decided banner needed: `CritiqueOutcome.revisionNotApplied` (optional) in `docs/07` §5.2
and `src/model/trend.ts`, with a dated note. **Callers (rule 10):** nothing calls it yet. The run
(`trendReportPipeline.ts`, `P4-T18`) calls `bibliographyKeys` on the shipped draft's sections, formats
those keys through `BibliographyPort.formatBibliography` and the retracted items through
`formatRetracted`, then calls `scaffoldReport` with the current run's `CompositionPlan` (never a cached
report's) and spreads the result into the stored `TrendReport`; `critique.ts` (`P4-T09`) sets
`CritiqueOutcome.revisionNotApplied`; `P4-T21` passes `language: "ko"`, and `reportLabel("ko",
"invalidCitation")` and the retracted heading to `compose.ts`, `exportMarkdown.ts` and `noteHtml.ts`. The
constructing file is `src/bootstrap/registerPipelines.ts` (`P4-T18`); nothing is constructed — pure
functions and constants. No section-origin claim is built (item 315): it would go in the header's analysis
line and a per-paper column of Appendix B once `P3-T22` passes.

*Decided 2026-10-30 (coordinator, `plan/00` §6 item 317(c)); built by `P4-T18`'s first step:* `ScaffoldInput`
gains the optional `critiqueWarnings` (the critique stage's `CritiqueResult.warnings`). The scaffold carries them
into the report's `warnings`, and when they hold `critique_text_unchecked` Appendix B writes the new label
`critiqueTextUnchecked` among its notes; its `ko` is on `KO_REPORT_LABELS_PENDING_REVIEW` (`G-41`). `docs/06`
§12.2's note of this date, reading (13).

*Updated 2026-11-01 (owner, `plan/00` §6 item 319; moved by `P4-T18`):* the 136 drafted `ko` labels are approved
and in `KO_REPORT_LABELS`, byte for byte from the third column of `plan/reports/ko-draft-report-labels.tsv`
(placeholders checked equal by script, `headerScope`'s in another order); `KO_REPORT_LABELS_PENDING_REVIEW`
holds only `critiqueTextUnchecked`, which waits for the next batch.

---

### P4-T13 — Markdown → Zotero note HTML, sanitized

| Field | Value |
|---|---|
| **ID** | `P4-T13` |
| **State** | `TODO` |
| **Depends on** | `P4-T10`, `P4-T11` |
| **Blocks** | `P4-T14` |
| **Retires** | part of `R-7` |
| **Implements** | part of `FR-25` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** The finished Markdown becomes note HTML inside the `data-schema-version="9"` wrapper, with
inline anchors and citation nodes, and nothing outside the measured whitelist survives.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §14.1 — the construct table, D-06-9, "Sanitize before
  insertion"
- `docs/06-summarization-and-trend-report.md` §10.2 — inline `zotero://select` anchors, the wrapper
- `docs/01-zotero-plugin-platform.md` §5.7 — the conservative subset and its `Unverified`

**Files.**
- create `src/pipeline/trendReport/noteHtml.ts` (caller: `trendReportPipeline.ts`, `P4-T18`, which
  passes the finished HTML string to `writeReportNote` in `src/zotero/notes.ts`, `P4-T14`. *Review
  2026-10-25: the caller read "`writeReportNote`", but `zotero/` may not import `pipeline/`
  (`docs/07` §2.3).*) *Noted 2026-10-27 (`P4-T13`, rule 10): nothing calls it yet. The run calls
  `renderReportNote` with the stored report, `zoteroBibliographyPort` and the bibliography's
  `BibliographyRequest`; pure functions and one port, so nothing constructs it. Files outside this
  list that the owner's decisions of 2026-10-27 (`plan/00` §6 item 296) put in the work:
  `src/zotero/bibliography.ts` (`citationNodes` takes the request; `citationPreviewText`),
  `test/integration/zotero/bibliography.spec.ts` (its two `citationNodes` calls),
  `src/pipeline/trendReport/exportMarkdown.ts` and `test/unit/pipeline/trendExport.test.ts` (item
  296(c), (d); `sectionRange`, `printedDoiAddress` shared), `src/pipeline/trendReport/citations.ts`
  (`fencedRanges` exported), `src/zotero/itemMapper.ts` (a comment, item 296(b)).*
- create `test/unit/pipeline/trendNoteHtml.test.ts`
- create `test/integration/zotero/reportNoteHtml.spec.ts` (round trip `setNote`/`getNote`)
- modify `docs/01-zotero-plugin-platform.md` §5.7 (the measured whitelist, dated)
- modify `docs/06-summarization-and-trend-report.md` (§14.1 D-06-9 and §16 item 4; dated "Decided"
  notes)

**Do.**
1. **Documents first** (decided 2026-10-26, item 286): write into `docs/06` §14.1 D-06-9 that v1
   converts with an in-house renderer for the closed construct set and bundles no Markdown library,
   and that Better Notes' converter is not used in v1; answer `docs/06` §16 item 4 the same way.
   Each under a dated note.
2. Convert the constructs in `docs/06` §14.1's table with an in-house converter written for that
   closed set (no dependency); resolve markers first (`P4-T10`) to anchors with `[n]`, and Notable
   Papers and Bibliography entries to `P4-T11`'s nodes.
3. Sanitize: drop `<script>`, event handlers, `javascript:` and `data:` URIs, and any tag or attribute
   outside the allowed set; escape raw HTML in the model's Markdown.
4. Measure in Zotero what `setNote` keeps of `div[data-schema-version]`, `span.citation`, `class`,
   `title`, inline table styles and an HTML comment; record it in `docs/01` §5.7.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the renderer. D-06-9 says "bundle a small
> Markdown renderer (e.g. `marked` or `markdown-it`)"; `package.json` has no runtime dependency but
> `zotero-plugin-toolkit`. **Decided: a hand-rolled renderer for the closed construct set** of
> `docs/06` §14.1 (the report's shape is fixed and validated), which adds no supply-chain item to
> `docs/09` §7 and escapes by default. Written into `docs/06` §14.1 D-06-9 by step 1; built by
> step 2. (The alternative not taken: bundle `marked` or `markdown-it`.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** Better Notes' converter (D-06-9's "offer to
> use its converter") is not built in Phase 4: its entry point is `Unverified` (`docs/06` §14.1) and
> no `docs/11` line needs it, so it goes to `plan/00` §6 tagged Phase 4 (rule 9; recorded there as
> item 287(b)). Answers `docs/06` §16 item 4 for v1, written there by step 1.

**Do NOT.**
- Do **not** add a Markdown library or any runtime dependency (decided 2026-10-26).
- Do **not** use the legacy `zotero-note znv1` wrapper (`docs/06` §10.2).
- Do **not** emit images.
- Do **not** trust model output: everything is escaped unless the converter produced the tag.

*Decided 2026-10-27 (owner, `plan/00` §6 item 294(b)): a citation node's visible text follows the report, not Zotero's interface language. This card makes it with the bibliography's CSL locale (`en-US`, item 294(a)) through `P4-T11`'s `zoteroBibliographyPort` rather than `Zotero.EditorInstanceUtilities.formatCitation`, escapes it, and measures inside Zotero whether the note editor rewrites the nodes' text when the note opens; the measurement goes into `docs/01` §5.11 the same day.* *Narrowed 2026-10-27 (owner, `plan/00` §6 item 296(a)): the note editor does rewrite the text (`docs/01` §5.11, measured by this card), so 294(b) holds for **the stored HTML** only; Notable Papers and the Bibliography keep citation nodes, and what the editor shows is Zotero's.*

**Done when.**
- [ ] A fixture with `<script>`, `onclick`, `javascript:` and `data:` links renders with none of them.
- [ ] Every §14.1 construct has a test.
- [ ] The integration spec records which wrapper attributes, classes and comments survive `setNote`.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendNoteHtml` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendNoteHtml && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs from Phase 3: nothing. `docs/01` §5.7's subset lists no `span` or `div`, while
`docs/06` §10.2 and §14.1 emit both; step 4's measurement settles which document is right.

---

### P4-T14 — Report note writer, `report` table, report file

| Field | Value |
|---|---|
| **ID** | `P4-T14` |
| **State** | `TODO` |
| **Depends on** | `P4-T13` |
| **Blocks** | `P4-T18` |
| **Retires** | none |
| **Implements** | `FR-25`, `NFR-15` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** A finished report is saved as a standalone, tagged note in its collection and as a
redaction-gated `report` row with its Markdown file, and re-running never destroys an earlier report.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §14.2 — the save pattern, `autoSyncDelay`, new note on
  re-run, read-only libraries
- `docs/07-architecture-and-data-model.md` §6.5 — marker comment and tag; §8.3 — the `report` DDL
  and the `reports/<id>.md` file
- `docs/06-summarization-and-trend-report.md` §11.3 D-06-8 bullet 2 — `research-helper` with a hyphen
- `docs/10-requirements-and-user-stories.md` §5 Q11, Q12 — editable notes, group libraries
- `plan/04` §0.2 item 4 — migrations append; the two tests that pin the version

**Files.**
- modify `src/zotero/notes.ts` (`writeReportNote`; caller: `trendReportPipeline.ts`, `P4-T18`)
- modify `src/zotero/db.ts` (`createReportStore`, with the Markdown file)
- modify `src/bootstrap/pluginDatabase.ts` (constructs `createReportStore` on the one connection
  beside `createProvenanceStore` and `createJobStore`, and exposes it on `OpenPluginDatabase`;
  `P4-T18` hands it to the pipeline. *Review 2026-10-25: this row named `installServices` in
  `src/bootstrap/container.ts` as the constructor, but every store on the plugin database is built
  in `installPluginDatabase`.*)
- modify `src/bootstrap/migrations.ts` (the `report` table, next free version after `P3-T25`'s)
- modify `test/unit/core/provenanceRerun.test.ts`
- modify `test/integration/zotero/provenanceStore.spec.ts`
- create `test/integration/zotero/reportNote.spec.ts`
- modify `docs/06-summarization-and-trend-report.md` (§16 items 6 and 7 answered; dated "Decided"
  notes)

**Do.**
1. **Documents first** (decided 2026-10-26, item 286): answer `docs/06` §16 item 6 (always a new
   note) and item 7 (an editable group collection, after an extra confirmation naming the group) with
   dated notes. `docs/10` §5 Q11 and Q12 were marked decided by the coordinator on 2026-10-26.
2. `writeReportNote`: `libraryID` before the collection, tag `research_helper/trend-report` (per
   `P4-T01`'s step 4), the dated title, `notifierData.autoSyncDelay`. Every run creates a new note;
   nothing is overwritten, updated in place or compared by hash (decided below).
3. Detect `library.editable` before saving; a read-only library goes to export only. A group
   library is written only after the caller passes the user's answer to an extra confirmation naming
   the group — `writeReportNote` takes that answer as an argument and refuses without it; the
   question itself is `P4-T20`'s (decided below).
4. `createReportStore`: the `report` row through `redactRecord`, the Markdown in
   `<data dir>/research-helper/reports/<id>.md`.
5. Confirm the "remove generated notes" command (`P3-T29`) also removes report notes, because the
   tag is in the `research_helper/` namespace.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** re-runs. `docs/06` §14.2 says "On re-run,
> **create a new note** rather
> than overwriting"; `docs/06` §16 item 6 still asks "Always a new note, or offer 'update in place'
> with a diff?"; `docs/10` §5 Q11 recommends "if a note has been modified since generation (hash
> mismatch), do not overwrite — create a new note and warn". **Decided: always a new note, as §14.2
> says, with no hash check and no update-in-place for v1**; `docs/06` §16 item 6 is answered by
> step 1, and `docs/10` §5 Q11 was marked decided by the coordinator on 2026-10-26. (The alternative
> not taken: update in place when the user has not edited the note.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** group libraries (`docs/10` §5 Q12, `docs/06`
> §16 item 7, gate `G-25`). **Decided: Q12's default — save into an editable group collection only
> after an extra confirmation naming the group; tests use a personal library only, and the first real
> group write is `G-25`'s. No preference**, so `docs/09` §3 and `docs/07` §8.5 do not change.
> `docs/06` §16 item 7 is answered by step 1; `docs/10` §5 Q12 was marked decided by the coordinator
> on 2026-10-26. (The alternative not taken: no group-library writes in v1.)

**Do NOT.**
- Do **not** set a parent or collection before `libraryID` (`docs/06` §14.2).
- Do **not** overwrite or delete an earlier report note.
- Do **not** write into a group library in any test.
- Do **not** add a preference for re-run or group-library behaviour (decided 2026-10-26).
- Do **not** add a redaction rule.

**Done when.**
- [ ] Two runs on one collection leave two notes with distinct dated titles.
- [ ] The note carries the tag and the marker (or the measured substitute, `P4-T13`).
      *Decided 2026-10-27 (owner, `plan/00` §6 item 296(b)): the note is found by the note item key the
      run stores (`TrendReport.zoteroNoteKey`) and by the tag `research_helper/trend-report`, never by the
      marker comment, which Zotero's note editor drops on its first save (`docs/01` §5.7, measured by
      `P4-T13`). The comment is still written, as information only; no lookup by it is built.*
- [ ] A read-only library returns "export only" and writes nothing.
- [ ] A group library without the confirmation answer is refused and writes nothing (unit-tested on
      the argument check; no test writes into a group library).
- [ ] The `report` row passes the gate; the Markdown file exists under the hyphenated directory.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- provenanceRerun` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- provenanceRerun && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs from Phase 3: **`P3-T25` (NOT BUILT)** — its `summary` migration takes the next
version first; **`P3-T29` (NOT BUILT)** — it adds the summary-note writer and the removal command to
`src/zotero/notes.ts` first; `P3-T33`, `P3-T36` (built). `src/bootstrap/pluginDatabase.ts` is a
shared file under the wave rules. Estimate risk *(review 2026-10-25)*: this card holds three pieces —
the note writer, the `report` store with its migration, and the report file — where `P3-T33` and
`P3-T34` were priced at 1.0 d each for a store and its migration; expect 1.5–1.75 d, or split the
store into its own card.

> **As built 2026-10-30 (`plan/00` §6 item 315; fake model only, personal library only).** `P3-T25` and
> `P3-T29` were built before this card, so the `report` table is **migration version 7** and the note
> writer sits beside theirs. Built: `writeReportNote`, `datedReportTitle`, `reportNoteHtml`,
> `reportMarkerComment`, `reportLibrary`, `findReportNote`, `TREND_REPORT_TAG` and the types
> `ReportNoteRequest`, `ReportNoteOutcome`, `GroupWriteConfirmation` in `src/zotero/notes.ts`;
> `createReportStore`, `ReportStore`, `gateTrendReport`, `REPORT_VERBATIM_KEYS`, `isReportId`,
> `REPORT_ID_RE`, `createReportMarkdownFiles`, `reportMarkdownDirectory`, `reportMarkdownPath` in
> `src/zotero/db.ts`; `REPORT_DDL` in `src/bootstrap/migrations.ts`; `OpenPluginDatabase.reports` and
> `PluginDatabase.reports()` in `src/bootstrap/pluginDatabase.ts`. **Rule 10:** the constructing file is
> `installPluginDatabase` (`createReportStore` on the one connection); the caller of the store, of
> `datedReportTitle` and of `writeReportNote` is `trendReportPipeline.ts` (`P4-T18`), which receives
> `graph.database.reports` through `installServices` (that card's `container.ts` row) — nothing calls
> them before that card; the
> group-library question, the "export only" path and `findReportNote` reach the user through the report
> window (`P4-T20`). Outside `Files`, each forced: `src/model/trend.ts` (`TrendReport.redaction`,
> declared in `docs/07` §5.2 first), `test/unit/zotero/reportNote.test.ts` (the argument checks), a
> `container.test.ts` case for the store's wiring, and the schema-version pin moved 6 → 7 in five unit
> tests as `P3-T25` did. Readings decided under item 313 are in `docs/06` §14.2's and `docs/07` §5.2's
> notes of this date. Step 5 holds with no change: a report note is a standalone member of its
> collection with a tag in the `research_helper/` namespace (asserted in `reportNote.spec.ts`).

---

### P4-T15 — "Export as Markdown"

| Field | Value |
|---|---|
| **ID** | `P4-T15` |
| **State** | `TODO` |
| **Depends on** | `P4-T10`, `P4-T11` |
| **Blocks** | `P4-T20` |
| **Retires** | none |
| **Implements** | part of `FR-25` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A finished report exports as a clean `.md` file with portable links to a path the user
picks.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §14.3 — `.md`, D-06-10, "Hyperlinks … must be
  `https://doi.org/...`"
- `docs/08-ui-ux-spec.md` §6.3 — "Save as Markdown" and the filename sanitiser
- `src/zotero/notes.ts` `provenanceFileWriter`, `exportProvenanceJson` — the shipped file-picker
  pattern

**Files.**
- create `src/pipeline/trendReport/exportMarkdown.ts` (caller: the Export action in
  `src/ui/viewModels/reportViewModel.ts`, `P4-T20`) *Noted 2026-10-27 (`P4-T15`, rule 10): nothing
  calls it yet. The view model calls `exportReportMarkdown` with the window's path and the writer
  `registerUI.ts` binds from `reportFileWriter()` (`P4-T20`), and suggests `reportExportFileName` in
  the save dialog; a `ko` report passes `reportLabels.ts`'s retracted-list heading (`P4-T12`,
  `P4-T21`). Pure functions and one port, so nothing constructs it.*
- modify `src/zotero/notes.ts` (a report file writer beside `provenanceFileWriter`; it reaches the
  view model through the report window host in `src/bootstrap/registerUI.ts`, `P4-T20`, the way
  `provenanceFileWriter` reaches `searchImportViewModel.ts` — `ui/` may not import `zotero/`.
  *Review 2026-10-25: the path from writer to window was unnamed.*)
- create `test/unit/pipeline/trendExport.test.ts`
- modify `docs/06-summarization-and-trend-report.md` (§14.3 D-06-10 and the marker sentence; dated
  "Decided" notes)
- modify `docs/08-ui-ux-spec.md` (§6.3, "Save as Markdown"; dated)

**Do.**
0. **Documents first** (decided 2026-10-26, item 286): write into `docs/06` §14.3 D-06-10 that v1
   ships the `.md` export to a user-chosen path only (`.html` deferred), and that exported markers
   are numeric with DOI links and no setting; into `docs/08` §6.3 that "Save as Markdown" writes a
   file the user places, not an attachment on the note (the attachment variant deferred). Each under
   a dated note. `docs/10` §5 Q19 was marked decided by the coordinator on 2026-10-26.
1. Replace each marker with `[n]` and append the numbered bibliography, with `https://doi.org/` links
   where a DOI exists. Use the entries the run already formatted through `P4-T11`, so an export makes
   no second citeproc call — verify yourself where `P4-T01`'s `TrendReport` keeps them; I believe
   the stored record must carry them *(review 2026-10-25: the source of the entries was unnamed)*.
2. Write through the native picker and `Zotero.File.putContentsAsync`; sanitise the filename per
   `docs/08` §6.3.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** scope. `docs/11` §1 and `docs/10` §5 Q19
> ask for "Export as Markdown"; `docs/06` §14.3 D-06-10 says "v1 ships **`.md` and `.html`**";
> `docs/08` §6.3 makes "Save as Markdown" an `importFromFile` **attachment on the report note**.
> **Decided: `.md` to a user-chosen path only in Phase 4; the `.html` export and the attachment
> variant go to `plan/00` §6 tagged Phase 4** (rule 9; recorded there as item 287(c)). Answers Q19
> "both — note plus Markdown export". Written into `docs/06` §14.3 D-06-10 and `docs/08` §6.3 by
> step 0. (The alternative not taken: ship `.html` now as well.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/06` §14.3 offers numeric markers or
> `zotero://select` links "per a user setting", but `docs/07` §8.5 declares no such preference.
> **Decided: numeric markers with DOI links only, no setting.** Written into `docs/06` §14.3 by
> step 0. (The alternative not taken: a new setting offering Zotero-only links too.)

**Do NOT.**
- Do **not** write `zotero://` links into an exported file by default (`docs/06` §14.3).
- Do **not** add a preference.

**Done when.**
- [ ] An export of a fixture report has no `[[`, numbered markers in order, and one DOI link per DOI.
      *Scoped 2026-10-27 (`P4-T15`, `plan/reports/P4-T10.md` finding 1): "no `[[`" holds outside
      code fences, because `P4-T10` leaves a fenced marker as written; the test checks a fence-free
      fixture for no `[[` at all and a fenced one for none outside its fence (`docs/06` §14.3's note,
      item 4).*
- [ ] A collection name with `/` and `:` gives a safe filename.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendExport` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendExport
```

**Notes.** Needs from Phase 3: nothing.

---

### P4-T16 — Synthesis cost estimate and the report's confirmation

| Field | Value |
|---|---|
| **ID** | `P4-T16` |
| **State** | `TODO` |
| **Depends on** | `P4-T03` |
| **Blocks** | `P4-T18` |
| **Retires** | part of `R-4` |
| **Implements** | `FR-24`, `NFR-5`, `FR-35`, `FR-36` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** Before any report call, the user sees one estimate covering missing summaries plus every
synthesis call, and a report-specific egress notice naming every model the run sends to; the
existing confirmation and ceilings apply to both.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §5.4 "Cost preview is mandatory" and its worked
  example — the synthesis calls it prices
- `docs/06-summarization-and-trend-report.md` §5.2 — the synthesis budgets
- `docs/12-prompt-library.md` §11 "Token budgeting note" — the Korean 1.4–2.0× factor, `Unverified`
- `src/pipeline/shared/estimate.ts` header — "the synthesis calls of the trend report are Phase 4's"
- `docs/09-security-privacy-and-api-keys.md` §3 row "3b. Trend report" — what a report run sends
- `src/pipeline/shared/egressDisclosure.ts` `EgressContentScope`, `EgressNoticeId`,
  `EgressDisclosureInput`, `buildEgressDisclosure` — the shipped disclosure, keyed by input scope and
  one model
- `docs/07-architecture-and-data-model.md` §4.5 — where the notice is declared first

**Files.**
- modify `src/pipeline/shared/estimate.ts` (synthesis call kinds; caller: `trendReportPipeline.ts`,
  `P4-T18`)
- modify `test/unit/pipeline/estimate.test.ts`
- modify `src/ui/dialogs/costConfirmDialog.ts` (the report's lines)
- modify `test/unit/ui/costConfirmDialog.test.ts`
- modify `addon/content/costConfirm.js` **only if** a new line is one the dialog script sets itself
  (`COST_DIALOG_L10N`'s comment says it repeats those ids) — verify yourself; I believe the report's
  lines arrive as ordinary `FluentLine`s and need no change there *(review 2026-10-25)*
- modify `src/i18n/keys.ts`, `addon/locale/en-US/research-helper-mainWindow.ftl`,
  `addon/locale/ko-KR/research-helper-mainWindow.ftl`, `test/unit/i18n/keys.test.ts`
- modify `src/pipeline/shared/egressDisclosure.ts` (the report notice; callers: the cost dialog
  model in `costConfirmDialog.ts`, and `trendReportPipeline.ts`, `P4-T18` step 5)
- modify `test/unit/pipeline/privacyPolicy.test.ts` (where `buildEgressDisclosure`'s unit tests
  live today, by grep on 2026-10-26 — verify yourself)
- modify `docs/07-architecture-and-data-model.md` (§4.5: the report notice declared first; dated
  "Decided" note)

**Do.**
0. **Documents first** (decided 2026-10-26 on `P4-T18`, item 286): declare in `docs/07` §4.5 a
   dedicated report notice — what a report run sends per `docs/09` §3 row 3b (the generated
   summaries, titles, years, venues and cluster statistics) and **every model the run sends to**
   (map, report and critique models) — under a dated note.
1. Add the synthesis kinds with `docs/06` §5.2's budgets: one cluster call (or the two-stage count),
   K theme calls (K from §9.2's band, upper end), one or two report calls (`both`), and per critique
   round one critique plus one possible rewrite.
2. Price them through `costOf` at the dialog's prices (item 278(b)); output at the `max_tokens`
   ceiling, never typical fill. One run uses up to three models: map calls at `summaryModel`'s
   prices, synthesis calls at `reportModel`'s, the critique at its own (`P4-T09`), each through the
   same price source; an unknown price on any of them makes the run's cost unknown. *(Review
   2026-10-25: `EstimateRunInput` takes one `modelId` today.)* `THEME_CLUSTER`'s ceiling is the grown
   ceiling decided on `P4-T06` (`resolveMaxTokens`, `P4-T03` step 4), and the cluster count follows
   the same two-stage rule as `P4-T05` step 1.
3. Add the report's lines to the cost dialog model; reuse its threshold, ceilings and
   second-acknowledgement rules unchanged — including "don't ask again" never skipping a
   confirmation forced by money (item 274(b)).
4. The report notice of step 0: a new `EgressNoticeId` member and a disclosure input that names
   every model of the run, built by `buildEgressDisclosure` and shown in the same dialog; its string
   follows `plan/04` §0.2 item 1 and goes on `KO_PENDING_REVIEW`. The summary disclosure is
   unchanged.

**The Korean factor needs no rule here** *(review 2026-10-25; this was an open line recommending
Korean output priced at 2.0×)*: output is priced at the call's `max_tokens` ceiling (step 2, item
274(b)), the ceiling is a hard cap in tokens whatever the language, and `docs/06` §5.2 already raises
`TREND_REPORT_KO`'s ceiling to 7 000 for Korean. Multiplying it would reserve tokens the call cannot
produce. The 1.4–2.0× factor matters only to the typical-fill figure, which the estimate does not
use; its measurement stays `docs/12` §11's action item for the first Korean runs (`P4-T25`).

**Do NOT.**
- Do **not** hard-code a price or a model (`plan/README.md` §5 item 4).
- Do **not** add a second confirmation dialog or a second threshold.
- Do **not** change the map-phase arithmetic `P3-T16` built.

**Done when.**
- [ ] For `docs/06` §5.4's 42-paper example with K fixed at the example's 5, the reservation is
      1 + 5 + 1 + 1 calls plus one possible rewrite at rounds `1`; with K unset it reserves the
      26–75 band's upper K, 7 (§9.2). *(Review 2026-10-25: the line asked the example's figures to
      "reproduce at its stated prices", but the example prices output "at typical fill" and step 1
      reserves the band's upper K, so the test could not pass as written.)* *(Decided 2026-10-29,
      owner, `plan/00` §6 item 309(b): the theme stage is now counted at the packer's worst, so with
      K fixed at 5 the reservation is 1 + 6 theme calls + 1 merge + 1 + 1 plus the rewrite — 38 of the
      42 summaries can fall in one theme, which takes two calls and a merge — and with K unset 9 theme
      calls and 1 merge; `docs/07` §4.5's note of this date.)*
- [ ] `both` doubles the report calls; rounds `2` adds two critique and two rewrite reservations.
- [ ] An unpriced report model triggers the second acknowledgement, as for summaries.
- [ ] A report run whose map, report and critique models differ shows one report notice naming all
      three; a summarize run's disclosure is byte-identical to today's.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- estimate costConfirmDialog keys privacyPolicy`
      passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- estimate costConfirmDialog keys privacyPolicy
```

**Notes.** Needs from Phase 3: `P3-T13`, `P3-T15`, `P3-T16`, `P3-T35` (built). New strings follow
`plan/04` §0.2 item 1 and go on `KO_PENDING_REVIEW`; the executing agent quotes each new en-US
string. *Re-estimated 2026-10-26, 1.0 → 1.25 d:* item 286 decided the dedicated report notice on
`P4-T18`'s open line, but `P4-T18`'s `Files` named neither `egressDisclosure.ts` nor a string file,
so no estimate had priced it. It is built here, beside the cost lines it is shown with, because this
card already edits the dialog model and both bundles; `P4-T18` step 5 calls it. Its nearest Phase 3
analogue, `P3-T15`, was priced at 1.0 d for the privacy modes, the whole disclosure and the Gemini
free-tier warning together.

*Decided 2026-10-29 (owner, `plan/00` §6 item 307(b)):* `P4-T05`'s client-generated `Other` theme can
make `MAX_THEMES` + 1 themes, so with K from §9.2's band `planSynthesis` reserves one more
`CLUSTER_REDUCE` call, conditional, and works the sub-batch merges out for both theme counts, keeping
the larger. A `themeCount` the run passes is its finished clustering's count and gets none, so the
Done-when's 1 + 5 + 1 + 1 figure stands; with K unset the 42-paper example now reserves 8 theme calls.
`docs/07` §4.5's note of this date.

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(b), (c)):* `planSynthesis` counts the theme stage
as `P4-T07` packs it, at its worst: for N summaries over at most T themes (T = K + 1 with K from the
band, else the run's `themeCount`; t = min(T, N)), R = t + min(⌊(N − t) ÷ p⌋, t·(m − 1))
`CLUSTER_REDUCE` calls and M = min(t, ⌊N ÷ (p + 1)⌋) merges, where p = 21 worst-size summaries per
call is asked of `packThemeMembers` and m = 11 is `maxPartialsPerMerge` (both now in `estimate.ts`).
This replaces item 307(b)'s "larger of K and K + 1" and changes the Done-when's 42-paper figure (noted
there). `SynthesisPlan.themes` is now t, the themes reserved, and `reportPlanLines` passes it as
`$themes`, so the dialog shows K + 1 (or the run's count, or the paper count when smaller). `docs/07`
§4.5's notes of this date derive the count and pin followup-307's two mixes as "estimate ≥ actual".

---

### P4-T17 — Synthesis cache keys (`tc`, `cr`, `rp`)

| Field | Value |
|---|---|
| **ID** | `P4-T17` |
| **State** | `TODO` |
| **Depends on** | `P4-T01` |
| **Blocks** | `P4-T18` |
| **Retires** | none |
| **Implements** | part of `FR-23`, part of `FR-27` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Clustering, theme analyses and the report are cached under keys that miss exactly when an
input that shaped them changed, so a resumed or repeated run does not re-pay.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §11.2 — the `tc`/`cr`/`rp` table, and decision
  readings 1, 3 and 8
- `docs/07-architecture-and-data-model.md` §9.1 — "`06` §11.2 owns the summary-cache-key component
  list … the coarser `tc` / `cr` / `rp` namespaces … are defined there too"
- `src/core/cache/keys.ts` `cacheKey`, `encodeTagValue`, `summaryKey` — the shipped pattern

**Files.**
- modify `src/core/cache/keys.ts` (three key builders; caller: `trendReportPipeline.ts`, `P4-T18`)
- create `test/unit/core/synthesisKeys.test.ts`
- modify `docs/06-summarization-and-trend-report.md` §11.2 (a dated reading for the three namespaces)

**Do.**
1. `tc`: sorted `(itemKey, contentHash)` pairs, `THEME_CLUSTER`'s `cacheEpoch`, provider, model,
   temperature, the theme-band inputs.
2. `cr`: theme id, sorted member summary hashes, `CLUSTER_REDUCE`'s epoch, provider, model.
3. `rp`: theme-analysis hashes, the report prompt's epoch, language, model, temperature, target words,
   critique settings.
4. Tags qualified by prompt line, as reading 8 does for `ps`.
5. Correct `docs/06` §11.2's coarse-namespace table in place, dated: its "version" column reads as
   `cacheEpoch` for `tc`, `cr` and `rp`. *(Review 2026-10-25: this was an open line. It is settled:
   `docs/12` §17.2's PATCH row "holds as written" by the owner's decision of 2026-10-23 (item 273(a))
   for every prompt, and this file's §0.2 item 13 already binds the rule; only the §11.2 table still
   says "version".)*

**Do NOT.**
- Do **not** reuse `StoredSummary.id` or a row id as a key.
- Do **not** add a table: entries live in `cache_entry`.

**Done when.**
- [ ] Changing one member's `contentHash` changes `tc` and that theme's `cr`, and no other `cr`.
- [ ] A PATCH-only prompt change keeps all three keys; a MINOR change moves only its own.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- synthesisKeys` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- synthesisKeys
```

**Notes.** Needs from Phase 3: `P3-T26`, `P3-T33` (built).

---

### P4-T18 — Trend-report pipeline: stages, passes, cancel, resume

| Field | Value |
|---|---|
| **ID** | `P4-T18` |
| **State** | `TODO` |
| **Depends on** | `P4-T02`, `P4-T06`, `P4-T09`, `P4-T12`, `P4-T14`, `P4-T16`, `P4-T17` |
| **Blocks** | `P4-T20`, `P4-T21`, `P4-T22` |
| **Retires** | part of `R-6` |
| **Implements** | `FR-27`, `FR-23`, `FR-36`, `FR-53` |
| **Estimate** | 2.0 d |
| **Human gate** | none |

**Goal.** One cancellable, resumable job takes a collection to a saved report through every stage,
counting its reduction passes, and saves nothing when cancelled mid-synthesis.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §8.5 — the pseudocode and the 30 % failure policy
- `docs/07-architecture-and-data-model.md` §12.4 (as reconciled by `P4-T01`) and §7.4 — "a partial
  report is discarded"
- `docs/07-architecture-and-data-model.md` §4.5 — `Pipeline`, `PipelineContext`
- `docs/09-security-privacy-and-api-keys.md` §3 row "3b. Trend report" — what this job sends
- `src/bootstrap/registerPipelines.ts` `buildPipelineSet`, `PipelineConstructionDeps` — how pipelines
  are constructed

**Files.**
- create `src/pipeline/trendReport/trendReportPipeline.ts`
- modify `src/pipeline/registry.ts` (`PipelineSet` gains `trendReport`)
- modify `src/bootstrap/registerPipelines.ts` (`buildPipelineSet` constructs it; this is the
  constructing file; `PipelineConstructionDeps` gains the report's ports)
- modify `src/bootstrap/container.ts` (`installServices` passes those ports into
  `registerPipelines` — the report store from `pluginDatabase.ts`, `P4-T14`; the note writer,
  `P4-T14`; the bibliography port, `P4-T11`; the Zotero reads. *Review 2026-10-25: added under
  `plan/README.md` §5 rule 10; `buildPipelineSet`'s only caller is `installServices`, so without this
  row the pipeline would be constructed with nothing to call.*)
- create `test/unit/pipeline/trendReportPipeline.test.ts`
- modify `src/pipeline/shared/privacyPolicy.ts` (`CollectionPrivacySettings`,
  `readCollectionPrivacySettings` and `writeCollectionPrivacySettings` gain the report run's own
  `RoutineConfirmation` record, stored in `collection_settings`), `test/unit/pipeline/privacyPolicy.test.ts`,
  and `docs/07-architecture-and-data-model.md` §4.5 (the `collection_settings.json` shape; a dated
  note). *Added 2026-10-27 (owner, `plan/00` §6 item 292(f); step 7). No migration: the record is a
  member of the existing `json` column.*

**Do.**
1. Stages in order: ~~screen, ensure summaries, estimate and confirm (`P4-T16`),~~ **screen,
   estimate and confirm (`P4-T16`), ensure summaries,** digest, cluster
   (`P4-T05`/`P4-T06`), analyse (`P4-T07`), compose (`P4-T08`), critique (`P4-T09`), scaffold
   (`P4-T12`), render (`P4-T13`), save (`P4-T14`). "Ensure summaries" summarizes the missing items
   inside this job through the summarize pipeline's per-item function (`P3-T29`), priced in
   `P4-T16`'s one estimate under one confirmation — no child job (decided below). *(Aligned
   2026-10-26, owner, `plan/00` §6 item 290: the estimate and its confirmation come before anything
   is summarized — FR-25 and item 286; `docs/07` §12.4's `Estimating → AwaitingConfirm →
   EnsuringSummaries`.)*
2. One pass counter for the run; the header shows it (FR-27).
3. Probe `tc`/`cr`/`rp` before each stage and store after; checkpoint after each stage. A run input
   option skips the three probes (never set by the UI) for `P4-T24`'s determinism runs, which keep
   `ps`. *(Review 2026-10-25: `P4-T24` needed this and no card built it.)*
4. Cancel during synthesis discards everything after the summaries; above 30 % failed papers, stop
   with one message.
5. The report's own egress notice (`P4-T16` step 4, naming every model the run sends to) and
   `assertModelAllowed` for the report model (and the critique model) before the first synthesis
   call; pause reasons as `P3-T34` defines them.
6. §0.2 item 18 end to end: automatic resume after a restart from the last checkpoint (`docs/07`
   §12.4 "restart from the last completed stage"), every spend guard re-passed, the resume notice;
   budget and wall-clock pauses keep the stage pending; "stop" at a pause discards synthesis output.
7. "Don't ask again" is recorded separately for report runs: a summarize run's record never skips a
   report run's question; only the report window's own "don't ask again" does. Declare it in
   `docs/07` §4.5 first: `collection_settings.json` gains a report run's record of the
   `RoutineConfirmation` shape beside `routineConfirmation`. The report run passes that record, never
   the summarize run's, to `mustAskConfirmation`, and stores `routineConfirmationFor` its own
   disclosure there when the report's dialog is answered with "don't ask again". *(Decided
   2026-10-27, owner, `plan/00` §6 item 292(f); `P4-T16`'s report, finding 5.)*

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** missing summaries. `docs/10` FR-25 started
> "Given a collection whose items have summaries", while `docs/07` §12.4 has `EnsuringSummaries →
> RunningSummarize : summaries missing` (a child job) and `docs/08` §6.1 runs "Stage 2 Summarize"
> inside the report job. **Decided: the report job summarizes the missing items itself through the
> summarize pipeline's per-item function (`P3-T29`), priced in the same estimate, with one
> confirmation — not a child job, which would show two dialogs.** Verify yourself how `P3-T29`
> exposes that function once it lands. `docs/07` §12.4 is rewritten by `P4-T01` step 2; `docs/10`
> FR-25's "Given" was corrected by the coordinator on 2026-10-26. (The alternatives not taken: a
> separate summarize job first, or refusing until every paper has a summary.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the disclosure. `docs/09` §3 row 3b sends "The **generated summaries** …,
> titles, years, venues, and cluster statistics", but `EgressContentScope` in
> `src/pipeline/shared/egressDisclosure.ts` counts items by input-scope kind, which has no "derived
> summaries" kind. *(Review 2026-10-25, grepped: `EgressContentScope` is
> `{ [K in InputScopeKind]: number }`, `EgressNoticeId` has three members — first job, Gemini free
> tier, Gemini declared paid — and `EgressDisclosureInput` names one `modelId`, while a report run
> may send to two or three models.)* **Decided: a dedicated report notice naming each model the run
> sends to, declared in `docs/07` §4.5 first, with its string on `KO_PENDING_REVIEW`.** The
> coordinator placed the declaration and the notice in `P4-T16` (its steps 0 and 4) on 2026-10-26,
> beside the cost lines it is shown with; this card calls it (step 5). (The alternative not taken:
> reuse the summary disclosure unchanged, which understates what row 3b sends.)

**Do NOT.**
- Do **not** save a partial report (`docs/07` §7.4).
- Do **not** touch the DOM or open a window from the pipeline (`docs/07` §2.3).
- Do **not** call `Zotero.*` from `pipeline/`; Zotero reads arrive as ports (verify how `P3-T29`
  receives them — `PipelineContext.zotero` stays `undefined` in `createPipelineContextFactory`).

*Decided 2026-10-27 (owner, `plan/00` §6 item 294): the run passes `BibliographyRequest.locale` `en-US` for every report language (294(a)), registers the cited keys in first-appearance order for every style (294(c)), and uses `userCitationStyle`'s reading of the user's style (294(d)).*

**Done when.**
- [ ] A mock run over 30 items saves one report whose header pass count equals the calls made at
      L1–L4.
- [ ] Cancelling during the theme stage saves no note, no `report` row and no file; summaries remain.
- [ ] A resumed run after a checkpoint at "analysed" makes no cluster or theme calls (cache hits).
- [ ] 11 of 30 papers failing stops the run with one message; 9 of 30 does not.
- [ ] A run interrupted after "analysed" and restarted resumes without a second confirmation only
      when no spend guard asks, and shows the resume notice.
- [ ] A budget refusal during the theme stage pauses the job with that stage pending; answering
      "stop" saves no note, no `report` row and no file.
- [ ] A collection whose only stored record is a summarize run's "don't ask again" still asks the
      report run's routine question; after the report's own "don't ask again", the next report run
      under the same provider and mode does not ask, and the summarize run's record is unchanged
      (step 7, item 292(f)).
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendReportPipeline privacyPolicy` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendReportPipeline privacyPolicy
```

**Notes.** Needs from Phase 3: **`P3-T29` (NOT BUILT)** for the summarize step and the Zotero-read
pattern; `P3-T15`, `P3-T17`, `P3-T34`, `P3-T35` (built). `src/pipeline/types.ts` is a shared file
and is not in this list; if a context member is missing, stop and say so. `src/bootstrap/container.ts`
is a shared file under the wave rules — small exact-string edits only. *Re-estimated by the review,
2026-10-25, 1.5 → 2.0 d:* the card gained the composition-root wiring of the report's ports, step 6's
resume and pause semantics and step 3's probe option; its nearest Phase 3 analogue, `P3-T29`, was
itself raised 1.0 → 1.25 d for unpriced callers, and this pipeline has eleven stages to its seven.

*Decided 2026-10-29 (owner, `plan/00` §6 item 307(c)):* the cluster stage's `clusterThemes` has two stop
outcomes, `stopped-too-many-themes` and `stopped-no-themes` (every theme below `MIN_PAPERS_PER_THEME`,
none left). This card maps both to the job's end: the run stops before anything is written, shows the
outcome's `messageId` (with its `args`, when it has them), keeps every summary, and saves no note, no
`report` row and no file. `docs/12` §8's note of this date.

*Decided 2026-10-29 (owner, `plan/00` §6 item 309(g), (e)):* two more stops end the job the same way.
The analyse stage's `analyseThemes` returns `stopped-no-theme-analysed` (`NO_THEME_ANALYSED_L10N`)
when every theme is unanalysed; this card maps it to the job's end — the run stops before anything is
written and shows its `messageId`, every summary and every cached stage result (the clustering, any
stored theme analysis) is kept, and no note, `report` row or file is saved. The cluster stage's
two-stage path gains `stopped-merge-over-budget` (`MERGE_TOO_LARGE_L10N`, no `args`), handled as the
two stops above. `docs/12` §9's and §20's notes of this date.

*Noted 2026-10-29 (`P4-T08`, rule 10):* the compose stage calls `composeReport`
(`src/pipeline/trendReport/compose.ts`). It returns `composed` or `stopped-structure-invalid` (the one
fresh generation failed the section check again), ~~whose handling is open for the owner (`docs/12`
§10's note of this date, reading (3))~~ handled as below (decided 2026-10-30). Its `onDraft` callback carries each streamed delta with its
generation number for `P4-T20`'s draft preview; a second generation replaces the first.

*Decided 2026-10-30 (owner, `plan/00` §6 item 311(a)):* the compose stage's `stopped-structure-invalid`
ends the job as the stops above do. The run stops before anything is written and shows the outcome's
`messageId` (`STRUCTURE_INVALID_L10N` in `src/pipeline/trendReport/compose.ts`,
`research-helper-report-stopped-structure-invalid`, no `args`); every summary and every cached stage
result (the clustering, the theme analyses) is kept, and no note, `report` row or file is saved. `docs/12`
§10's note of this date, reading (3). ~~*Not decided by item 311:* whether a `P4-T09` rewrite (which also
goes through `composeReport`) that returns this outcome stops the run too, or ships the draft that
already passed check 1; raised for the owner on 2026-10-30.~~

*Decided 2026-10-30 (owner, `plan/00` §6 item 312(b)):* only the compose stage's own
`stopped-structure-invalid` ends the job. When a `P4-T09` rewrite returns it, the critique stage keeps
the earlier draft that passed the section check, the run goes on to the scaffold stage with that draft,
and the banner states that the review's revision could not be applied (`P4-T09` step 7). This card does
not show that outcome's `messageId`. `docs/12` §10's note of this date, reading (3), and §12's.

*Noted 2026-10-30 (`P4-T09`, rule 10; `plan/00` §6 item 314(c)):* the critique stage calls `critiqueReport`
(`src/pipeline/trendReport/critique.ts`) with the compose stage's `composed` draft, the `ComposeInput` that made
it, every analysed paper's `StoredSummary`, the run's budgeted router, budget, token, `llm` pool, privacy policy
and config, the `SELF_CRITIQUE` and report templates, `modelInfo` and `modelConfirmed` (whether the run's
confirmation covered a model the mode passes only after one), `onDraft` and `onRevision`. It hands
`CritiqueResult.draft` and `.outcome` to `scaffoldReport` (`P4-T12`), adds `.usage` to the run's usage and
`.prompts` to the report's, and lifts `.warnings` (`critique_per_section`, `critique_text_unchecked`) into the
report's. Step 5's model check for the critique model is made inside `critiqueReport`, before its first request;
this card still names the model in the egress notice. Keying `rp` (`P4-T17`) and pricing the run (`P4-T16`), it
reads the rounds and the model with `critiqueRoundsOf` and `resolveCritiqueModel`, the same functions the stage
uses. Every error of the stage — a budget refusal (the stage stays pending), a cancel, a refused model, a failed
critique request or rewrite — reaches this card unchanged; only a rewrite's `stopped-structure-invalid` is
handled inside the stage. **The signal for `P4-T20` (item 314(c))** is `CritiqueDeps.onRevision`:
`{ kind: "rewrite-started", round }` before a rewrite's stream, whose deltas then arrive on `onDraft` as
`composeReport` sends them (generation 1, and 2 after a failed section check), and
`{ kind: "rewrite-not-applied", round, markdown }` after a rewrite that failed the section check twice, `markdown`
being the kept draft's; this card passes both through to the report window.

*As built 2026-11-01 (`plan/00` §6 items 313, 317(e); fake provider only, no live call; `plan/reports/P4-T18.md`).*
`src/pipeline/trendReport/trendReportPipeline.ts` declares `createTrendReportPipeline` (with `prepare`, `execute`,
`run`, `estimate`, `validate`, `remaining`), `remainingFromCheckpoint`, `stageSpendOf`, `measureSynthesisOverhead`,
`withDatedTitle`, `isTrendReportCheckpoint`, `tooManyPapersFailed`, `trendReportExclusivityKey`, `stopName`, the
types `TrendReportInput`, `TrendReportOutput`, `TrendReportRunView`, `TrendReportStop`, `TrendReportSurface`,
`TrendReportConfirmRequest`, `TrendReportConfirmAnswer`, `TrendReportLibrary`, `ReportRoutineStore`,
`TrendReportPipelineDeps`, `TrendReportPipeline`, `PreparedTrendReport`, `PreparedTrendState`,
`TrendReportCheckpoint`, `StageSpend`, and the constants `TREND_REPORT_STAGES`, `TREND_REPORT_STAGE_KEYS`,
`FAILED_PAPERS_SHARE`, `PAPERS_FAILED_L10N`, `NO_PAPERS_L10N`, `STOPPED_CODE`, `REPORT_FALLBACK_STYLE_ID`,
`REPORT_CSL_LOCALE`, `REPORT_OUTPUT_LIMIT_UNKNOWN`, `SYNTHESIS_CACHE_NAMESPACE`, `HEADLESS_TREND_REPORT_SURFACE`.
The readings are `docs/07` §12.4's note of 2026-11-01, each DECIDED under item 313. **Rule 10:** the constructing file
is `src/bootstrap/registerPipelines.ts` (`buildPipelineSet`, with `createZoteroTrendReportLibrary` and
`TrendReportConstructionDeps`); `installServices` (`container.ts`) passes the report store, the report run's own
"don't ask again" record, the collection's search record, the plugin version and the UTC offset, wires
`remainingFromCheckpoint` into `createSpendResumeGuards`, and runs each job `recover()` re-queued (`runResumedJob`);
the window's host is `P4-T20`'s, and nothing calls `prepare`/`execute` from a window yet (`report.enabled` stays off,
item 307(d)). **Outside `Files`**, each forced: `src/i18n/keys.ts` and both `mainWindow` bundles (two stop strings,
`ko` stubs on `KO_PENDING_REVIEW`), `typings/i10n.d.ts` (regenerated), `test/unit/bootstrap/container.test.ts` (the
resume-prerequisites pin is now empty). **What `P4-T20` binds:** a `TrendReportSurface` (`update`, `confirm` — open
`P4-T16`'s dialog when `shouldOpenCostDialog` says so, the `confirmation` decision being the report's own record's,
and return `dontAskAgain` from the dialog's box — `ask`, `onDraft`, `onRevision`); the host's prepare → enqueue with
`withEgressLog(input, egressLogEntry(prepared.disclosure, now))`, `priority: "normal"`,
`exclusivityKey: trendReportExclusivityKey(input)`, `inputVersion: TREND_REPORT_INPUT_VERSION` → `openJob({ record,
collection })` → `execute`, flushing `job.checkpoints` at the end; the output's `stop` (message id and args), `note`
(`group-confirmation-required` → ask, then `writeReportNote` again and `ReportStore.put` with the key) and
`report`; optionally `TrendReportConstructionDeps.surfaces` so a resumed job finds the window.

---

### P4-T19 — Report window surface, menu entry, `reportWindow` bundle

| Field | Value |
|---|---|
| **ID** | `P4-T19` |
| **State** | `TODO` |
| **Depends on** | `P4-T02` |
| **Blocks** | `P4-T20` |
| **Retires** | none |
| **Implements** | `FR-53`, part of `FR-28` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** "Generate Research Trends Report…" in the collection submenu opens a modeless report
window that is its own localization surface, in both locales.

**Read first.**
- `docs/08-ui-ux-spec.md` §2.4 and §2.5 — the collection block and `research-helper-menu-collection-report`
- `docs/08-ui-ux-spec.md` §10.1 — `reportWindow.xhtml` / `reportWindow.ftl`, and the rule that a
  window owns its bundle
- `docs/08-ui-ux-spec.md` §6.4 — the wireframes (language override per run)
- `src/i18n/keys.ts` `FluentSurface`, `SHIPPED_SURFACES` — `reportWindow` is declared, not shipped
- `plan/README.md` §6 — Fluent mutations, single-locale omissions, `l10n.spec.ts`

**Files.**
- create `addon/content/reportWindow.xhtml`
- create `addon/content/reportWindow.js`
- create `addon/locale/en-US/research-helper-reportWindow.ftl`
- create `addon/locale/ko-KR/research-helper-reportWindow.ftl` (commented stubs only)
- create `src/ui/panes/reportWindow.ts` (the opener; caller: `registerUI.ts`)
- modify `src/bootstrap/registerUI.ts` (publishes the opener; constructing file)
- modify `src/ui/menus/registerMenus.ts` (the entry in `collectionMenuOptions`)
- modify `src/i18n/keys.ts` (`SHIPPED_SURFACES`, the window's id list)
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`, `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- modify `test/unit/i18n/keys.test.ts`, `test/integration/l10n.spec.ts`,
  `test/integration/menus.spec.ts`, `test/integration/lifecycle.spec.ts`
- modify `docs/08-ui-ux-spec.md` (§6.4's wireframe: model as text, no Depth; dated "Decided" note)

**Do.**
0. **Documents first** (decided 2026-10-26, item 286): correct `docs/08` §6.4's wireframe — the
   resolved report model shown as text, changed in preferences, and no "Depth" control — under a
   dated note. `docs/10` FR-25's menu wording was corrected to "Generate Research Trends Report…" by
   the coordinator on 2026-10-26.
1. The menu entry "Generate Research Trends Report…" (`docs/08` §2.4, §10.2), enabled for exactly one
   selected collection.
2. The window shell per `docs/08` §4.1.1's dialog markup, with its own `<linkset>`; a language
   selector defaulting to `reportLanguage`; the resolved report model as plain text (passed in by
   the opener), with no model dropdown and no Depth control.
3. Ship the surface: both bundles, `SHIPPED_SURFACES`, typings regenerated by the build.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the menu label. `docs/10` FR-25 said
> "Research Helper → Write trends report…"; `docs/08` §2.4 and §10.2 say "Generate Research Trends
> Report…". **Decided: `docs/08`'s, which owns UI text; correct FR-25** — done by the coordinator in
> `docs/10` FR-25 on 2026-10-26. (The alternative not taken: FR-25's "Write trends report…".)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/08` §6.4's wireframe shows a per-run
> "Model" dropdown and "Depth ( ) Brief (•) Standard ( ) Detailed"; `docs/07` §8.5 declares no depth
> preference and says "No other document declares a preference". **Decided: show the resolved report
> model as text (changed in preferences) and drop Depth; `report.targetWords` stays the length
> control.** Written into `docs/08` §6.4 by step 0; built by step 2. (The alternative not taken: add
> both as new settings.)

**Do NOT.**
- Do **not** create a second collection menu (`P3-T29`'s Read first).
- Do **not** run a job from a modal dialog.
- Do **not** machine-translate; the ko-KR file holds commented stubs and every id goes on
  `KO_PENDING_REVIEW`.

**Done when.**
- [ ] The entry appears in `rh-menu-collection` and opens the window; menu-count specs updated.
- [ ] `l10n.spec.ts` resolves every `reportWindow` id in both locales.
- [ ] A disable/enable cycle leaves no window and no menu entry.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- keys` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- keys && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs from Phase 3: **`P3-T29` (NOT BUILT)** — it adds two entries to the same submenu and
moves the same menu-count specs first. `docs/07` §2.2 places the report viewer under `src/ui/panes/`;
the search window's controller sits in `src/ui/dialogs/`. This card follows `docs/07`.

*As built 2026-10-29 (`P4-T19`, plan/00 §6 item 306(b); State stays `TODO`).* `P3-T29` is built now
(`plan/reports/P3-T29.md`), so the Notes line above is history. The opener is `openReportWindow` in
`src/ui/panes/reportWindow.ts` (with `REPORT_WINDOW_L10N`, `buildReportWindowModel`,
`ReportWindowSession`); the caller is `SEARCH_MENU_COMMANDS.openReportWindow` → `openReportWindowCommand`
in `src/bootstrap/registerUI.ts`, the constructing file, which builds the session
(`createReportWindowSession`) and closes every report window in `publishReportWindowCommands`'s
teardown; the entry is `SearchMenuCommands.openReportWindow`, first in `llmJobItems`
(`src/ui/menus/registerMenus.ts`). **Left unbound for `P4-T20` and `P4-T18`:** the session has only
`describe` and `closed`; start, cancel, the stage rows, the streamed draft, the cost question and
delivery are `P4-T20`'s, over `P4-T18`'s pipeline, neither of which exists. The readings the documents
left open (the model line's wording, the language labels, one window per collection, closing at
shutdown, no `isConfigured` gate on the entry) are in `docs/08` §2.5's and §6.4's notes of this date,
for the owner to confirm.

*Decided 2026-10-29 (owner, `plan/00` §6 item 307(d)):* the entry and its window are hidden behind the
hidden preference `report.enabled` (`docs/07` §8.5), default `false`, until `P4-T18` and `P4-T20` can
generate a report (`docs/11` §0 principle 5). While it is off, `registerUI` builds the collection menu
without `SearchMenuCommands.openReportWindow`, so the entry is not created, and `openReportWindowCommand`
opens no window. `menus.spec.ts` and `lifecycle.spec.ts` turn it on for their duration and restore it.
*(Item 307(e):* `publishSummarizeCommands` now closes the summarize window at shutdown, as
`publishReportWindowCommands` does for this one.)

---

### P4-T20 — Report window: progress, streaming preview, delivery

| Field | Value |
|---|---|
| **ID** | `P4-T20` |
| **State** | `TODO` |
| **Depends on** | `P4-T15`, `P4-T18`, `P4-T19` |
| **Blocks** | `P4-T23` |
| **Retires** | none |
| **Implements** | `FR-53`, `FR-25` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** The window runs the job with per-stage determinate progress, a streaming preview of the
report call, Cancel, the spend so far, and Save / Export / Copy on completion.

**Read first.**
- `docs/08-ui-ux-spec.md` §6.2–§6.4 — preview, delivery options, the four wireframes
- `docs/08-ui-ux-spec.md` §9 — `aria-live` set only after streaming completes
- `docs/01-zotero-plugin-platform.md` §8.4 — the sandbox streaming path; `AbortController` absent
- `src/ui/viewModels/searchImportViewModel.ts` — the shipped view-model pattern

**Files.**
- create `src/ui/viewModels/reportViewModel.ts` (caller: `src/ui/panes/reportWindow.ts`)
- modify `src/ui/panes/reportWindow.ts`
- modify `src/bootstrap/registerUI.ts` (the report window host the view model calls: start and
  cancel the job through the queue, `confirmRunCost`, save as note, `P4-T15`'s file writer, copy —
  as `publishSearchWindowHost` does for the search window. *Review 2026-10-25: added under rule 10;
  `ui/` may not import `zotero/` or `llm/`, so every Zotero and job action reaches the window
  through this host.*)
- modify `addon/content/reportWindow.xhtml`, `addon/content/reportWindow.js`
- modify `addon/locale/en-US/research-helper-reportWindow.ftl`, `addon/locale/ko-KR/research-helper-reportWindow.ftl`
- modify `src/i18n/keys.ts`, `test/unit/i18n/keys.test.ts`
- create `test/unit/ui/reportViewModel.test.ts`
- create `test/integration/reportWindow-flow.spec.ts`
- modify `docs/08-ui-ux-spec.md` (§6.1 and §6.2: the streamed draft, and no adapter call from the
  window; dated "Decided" note)

**Do.**
0. **Documents first** (decided 2026-10-26, item 286): correct `docs/08` §6.1 and §6.2 — the first
   draft streams into the preview labelled "draft" and is replaced by the final text when the
   critique stage ends, and the window drives the job through its host rather than calling
   `RH.llm.streamReport` — under a dated note.
1. Drive the job through the pipeline and job queue only; stage rows with counts (summaries cached /
   new, themes done of K, critique round).
2. Paint raw text while the first draft streams, labelled "draft"; when the critique stage ends,
   replace it with the final text and render once (decided below).
3. Cancel through the job's cancellation token; show "discarded" honestly.
4. Delivery: Save as note (when `report.saveNote` and the library is editable), Export Markdown
   (`P4-T15`), Copy. Saving into a **group** library first asks an extra confirmation naming the
   group, through the host, and passes the answer to `writeReportNote` (`P4-T14` step 3; decided
   2026-10-26 on `P4-T14`); its string goes on `KO_PENDING_REVIEW`, and no test answers it against a
   real group library (`G-25`).

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the preview after a critique rewrite.
> `docs/08` §6.1 draws Stage 3 as "single LLM call over all summaries → trends report", "STREAMED
> into the preview pane", but under `docs/06` §8 synthesis is hierarchical and a critique rewrite
> replaces the streamed draft. **Decided: stream the first draft, label it "draft", and replace it
> with the final text when the critique stage ends.** Written into `docs/08` §6.1 and §6.2 by step 0
> (§6.2's code also calls `RH.llm.streamReport` from the window, which `docs/07` §2.3 forbids:
> "`ui/` never calls an adapter directly"); built by step 2. (The alternative not taken: progress
> only, and the final text at the end.)

*Noted 2026-10-30 (`P4-T09`; coordinator, `plan/00` §6 item 314(c)):* after a critique rewrite that fails the
section check twice, the preview is replaced by the kept draft and the final report's banner says why. The
signal is `CritiqueDeps.onRevision` in `src/pipeline/trendReport/critique.ts`, passed through by `P4-T18`:
`rewrite-started` (a rewrite's deltas follow on `onDraft`) and `rewrite-not-applied`, whose `markdown` is the
kept draft to paint again. Whether a rewrite's stream is shown at all is this card's choice under the decision
above; when it is, `rewrite-not-applied` must put the kept draft back.

**Do NOT.**
- Do **not** import `llm/` or `zotero/` from `src/ui/` (`research-helper/layering/ui`).
- Do **not** set `aria-live` on the preview while streaming.
- Do **not** re-parse Markdown on every delta.

**Done when.**
- [ ] View-model tests cover every stage row, cancel, and each delivery button's enabled state.
- [ ] The preview shows the streamed text labelled "draft" and then the final text; a group-library
      save asks the named-group confirmation first, and "no" saves nothing.
- [ ] The flow spec runs a mock job to "Report ready" and saves a note in the test library.
- [ ] *(Added 2026-10-29, owner, `plan/00` §6 item 307(d).)* The hidden preference is removed (or
      defaults on) once a report can be generated: `report.enabled` (`docs/07` §8.5), its row in
      `src/prefs/schema.ts` and `src/prefs/keys.ts`, and the integration specs that turn it on.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- reportViewModel keys` and the integration
      suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- reportViewModel keys && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs from Phase 3: `P3-T11`, `P3-T16` (built). New strings follow `plan/04` §0.2 item 1
(commented `ko-KR` stub, `KO_PENDING_REVIEW`, `G-41`); the executing agent quotes each new en-US
string. `src/bootstrap/registerUI.ts` is a shared file under the wave rules. *Re-estimated by the
review, 2026-10-25, 1.0 → 1.25 d,* for the host in `registerUI.ts` the card's `Files` lacked.

---

### P4-T21 — Korean report path end to end

| Field | Value |
|---|---|
| **ID** | `P4-T21` |
| **State** | `TODO` |
| **Depends on** | `P4-T08`, `P4-T12`, `P4-T18` |
| **Blocks** | `P4-T23`, `P4-T25` |
| **Retires** | none |
| **Implements** | `FR-28` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `reportLanguage` `ko` (or `auto` under a Korean UI, or `both`) produces a Korean report from
the same theme analyses, with Korean headings validated and titles, authors and venues untouched.

**Read first.**
- `docs/06-summarization-and-trend-report.md` §7.8 and D-06-6 — generated, never translated; `both`
- `docs/12-prompt-library.md` §11 — the Korean headings and rule 9 (titles stay in the original)
- `docs/10-requirements-and-user-stories.md` FR-28
- `docs/07-architecture-and-data-model.md` §8.5 `reportLanguage` — `auto` follows `Zotero.locale`

**Files.**
- modify `src/pipeline/trendReport/compose.ts` (Korean headings, `both`)
- modify `src/pipeline/trendReport/trendReportPipeline.ts` (`both` saves two notes)
- create `test/unit/pipeline/trendKorean.test.ts`

**Do.**
1. Resolve the language per run; `both` runs compose (and critique) once per language over the same
   theme analyses.
2. Validate the Korean heading strings in order.
3. Mechanical original-script check: every bibliography and Notable Papers entry is rendered from
   Zotero fields, so assert those match the item fields byte for byte.
4. A `ko` report's `validateCitations` call gets `CitationContext.replacement` from the `ko`
   invalid-citation label in `P4-T12`'s `reportLabels.ts`, "[인용 삭제: 잘못된 참조]"; an `en`
   report keeps the default. *(Decided 2026-10-27, owner, `plan/00` §6 item 292(b).)*

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the definition-of-done line "keeps
> titles/authors/venues in original script" can be proved mechanically only where code renders them
> (bibliography, citation nodes, the Notable Papers key column); a title the model translates inside
> prose cannot be detected reliably. **Decided: the mechanical check above (step 3) plus `G-24`'s
> reading of one Korean report, and that split recorded in `P4-T25`** (its step 3). Changes nothing
> in the documents. (The alternative not taken: detect translated titles inside the prose
> automatically.)

**Do NOT.**
- Do **not** translate an English report (D-06-6).
- Do **not** change the Korean prompt text (§0.2 item 14).

*Decided 2026-10-27 (owner, `plan/00` §6 item 294(a)): a Korean report's bibliography and retracted list are formatted with the `en-US` CSL locale, like an English report's; titles and names keep their original script. Its citation nodes use the same locale (item 294(b)).* *Narrowed 2026-10-27 (owner, `plan/00` §6 item 296(a)): in the stored HTML only — Zotero's note editor draws a node's text in its own interface language and saves that text on its first save (`docs/01` §5.11).*

**Done when.**
- [ ] `ko` makes one `TREND_REPORT_KO` call; `both` makes one of each from one set of theme analyses.
- [ ] A Korean draft missing `## 7. 상충과 논쟁 (Contradictions and Debates)` fails validation.
- [ ] Bibliography strings equal the fixture items' fields.
- [ ] An invalid marker in a `ko` report is replaced with "[인용 삭제: 잘못된 참조]", and in an `en`
      report with `[citation removed: invalid reference]` (step 4, item 292(b)).
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendKorean` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendKorean
```

**Notes.** Needs from Phase 3: nothing beyond `P4-T08`'s inputs.

---

### P4-T22 — 400-item scale test on the mock provider

| Field | Value |
|---|---|
| **ID** | `P4-T22` |
| **State** | `TODO` |
| **Depends on** | `P4-T18` |
| **Blocks** | `P4-T25` |
| **Retires** | none |
| **Implements** | `FR-27` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A 400-summary collection produces a report with no context-length error and a stated pass
count, proved offline on a mock whose context window is enforced.

**Read first.**
- `docs/10-requirements-and-user-stories.md` FR-27 — 400 summaries, pass count in the header
- `docs/06-summarization-and-trend-report.md` §8.3–§8.4 — the levels and the overflow paths
- `docs/13-testing-build-and-release.md` §2.2 — the mock harness and what it may not assert
- `test/helpers/mockLLM.ts` `mockLLM`, `mockLLMRouter`

**Files.**
- create `test/helpers/syntheticSummaries.ts` (callers: this card's test, `P4-T24`'s script tests)
- create `test/unit/pipeline/trendScale.test.ts`

**Do.**
1. Generate 400 deterministic synthetic stored summaries (seeded), realistic in size (900–1 600
   tokens each).
2. A mock that throws `ContextLengthExceededError` whenever `estTokens` of the request exceeds a set
   window, and `OutputTruncatedError` whenever its scripted answer is longer than the request's
   `max_tokens` (so `P4-T06`'s output-ceiling line is exercised, *review 2026-10-25*); run once at
   128 000 and once at 32 000 (forcing two-stage clustering and sub-batching).
3. Assert no context-length error, the header pass count equal to the counted calls, and every
   analysed key present once in the clustering.

**Do NOT.**
- Do **not** assert anything about prose quality (`docs/13` §2.2).
- Do **not** make a network request.

**Done when.**
- [ ] Both window sizes finish with no context-length error.
- [ ] The 32 000 run reports more passes than the 128 000 run, and each matches its call log.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendScale` passes in under 60 s.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendScale
```

**Notes.** Needs from Phase 3: `P3-T06` (built); **`P3-T25` (NOT BUILT)** for the stored-summary type
the generator fills. This is the definition-of-done line's offline proof — **the** proof, decided
2026-10-26 on `P4-T25` (a live 400-item run only if the owner asks for one).

---

### P4-T23 — Evaluation set and regression harness

| Field | Value |
|---|---|
| **ID** | `P4-T23` |
| **State** | `TODO` |
| **Depends on** | `P4-T20`, `P4-T21` |
| **Blocks** | `P4-T24` |
| **Retires** | part of `R-6` |
| **Implements** | part of `FR-25` |
| **Estimate** | 1.25 d |
| **Human gate** | **Yes** — gate `G-23`: the owner assembles three collections (about 10, 50 and 200 papers) and writes their expected themes (an agent must not, because generating them with the pipeline under test is circular), and judges which produced theme matches which expected one; then gate `G-42`: the baseline run spends real money on the owner's keys — expected roughly $5–10 for all three at `docs/06` §5.4's illustrative $3/$15 per million tokens, abstract-only, the exact figure stated from `P4-T16`'s estimate before dispatch, approved by the owner. |

**Goal.** Three curated collections with owner-written expected themes exist, and one command scores
a report run against them and records the score in the repository.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 4 deliverable 7 — "3 curated collections with
  human-checked expected themes"
- `docs/06-summarization-and-trend-report.md` §12.3 — the rubric, the automated proxies, "Store the
  scores in the repo"
- `docs/12-prompt-library.md` §17.6 — re-run before releasing a prompt change
- `plan/06-human-gates.md` `G-23`

**Files.**
- create `scripts/eval-trend-report.ts` (prints scores only; scores saved reports against the
  expected themes. *Review 2026-10-25: this row read "run by the owner inside Zotero", but a
  `scripts/` file runs in Node. The reports are produced in Zotero — through the report window, or an
  in-Zotero half on the `scripts/imrad-fixtures/extract.spec.ts` pattern (`P3-T20`); verify which
  yourself and name it before writing code.*)
- create `test/fixtures/trend-eval/` (one `expected-themes.json` per collection, metadata only)
- create `test/unit/scripts/evalTrendReport.test.ts`
- create `docs/spikes/trend-eval-baseline.md`
- modify `docs/06-summarization-and-trend-report.md` (§12.3: expected themes, not gold reports;
  dated "Decided" note)

**Do.**
0. **Documents first** (decided 2026-10-26, item 286): write into `docs/06` §12.3 that the
   evaluation set is owner-written expected themes (not gold reports) for three collections of about
   10, 50 and 200 papers, that matching a produced theme to an expected one is the owner's judgement,
   never a model's, that the rubric's eight dimensions stay a manual score, and that the evaluation is
   run manually in v1 — under a dated note.
1. Define the expected-themes format and the scoring: theme recall against the owner's list, where
   the owner records which produced theme matches which expected one (on a review page the
   coordinator prepares), plus `docs/06` §12.3's automated proxies.
2. Unit-test the scoring on hand-made inputs.
3. Stop at `G-23`; after the owner supplies the set, state the estimate and stop again at `G-42`;
   record the approved run's scores in `docs/spikes/trend-eval-baseline.md`.
4. Record in the same file, from the run's usage, how much of each synthesis call's `max_tokens`
   ceiling the reasoning used (§0.2's effort line), and the measured per-paper tokens of
   `THEME_CLUSTER`'s answer against the 40 the grown ceiling assumes (`P4-T06`'s line).

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** the evaluation target. `docs/11` §1 and
> `G-23` say "human-checked expected themes"; `docs/06` §12.3 says "three fixture collections (10, 50
> and 200 papers) with human-written gold reports", and `docs/12` §17.6 re-scores "against the
> rubric". **Decided: expected themes (not gold reports), at 10, 50 and 200 papers; matching a
> produced theme to an expected one is the owner's judgement on a review page, never a model's, and
> the rubric's eight dimensions stay a manual score.** Written into `docs/06` §12.3 by step 0. (The
> alternative not taken: owner-written full gold reports.)

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** `docs/13` §2.2 says prompt-quality
> regression is "run manually or in a nightly opt-in job". **Decided: manual only in v1** (a nightly
> job would need a key in CI, which `P3-T30`'s Do NOT forbids for the blocking suite); the nightly
> job goes to `plan/00` §6 (recorded there as item 287(d)).

**Do NOT.**
- Do **not** write, suggest or generate an expected theme.
- Do **not** commit PDFs or paper text; the fixture is item identifiers and theme lists.
- Do **not** dispatch the baseline run before the owner approves the stated estimate (`G-42`).
- Do **not** let a model decide whether a produced theme matches an expected one.

**Done when.**
- [ ] The scoring test passes on hand-made inputs.
- [ ] The owner's three expected-theme files are committed.
- [ ] The baseline scores and the actual spend are recorded, with the reasoning share of each
      ceiling and the measured per-paper tokens of `THEME_CLUSTER`'s answer.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- evalTrendReport` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- evalTrendReport
```
Then stop at `G-23`, and again at the spend.

**Notes.** Needs from Phase 3: **`P3-T31` (NOT BUILT)** — a measured map phase before the first
strong-model spend; `G-18` keys are the owner's.

---

### P4-T24 — Determinism check across three runs

| Field | Value |
|---|---|
| **ID** | `P4-T24` |
| **State** | `TODO` |
| **Depends on** | `P4-T23` |
| **Blocks** | `P4-T25` |
| **Retires** | none |
| **Implements** | `NFR-15` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — gate `G-42`: three synthesis-only runs (summaries cached) on the 50-paper evaluation collection spend real money on the owner's keys, expected under $3 in total at `docs/06` §5.4's illustrative prices, stated from `P4-T16`'s estimate and approved by the owner before dispatch; then the owner reads the three theme-name lists (`G-24`). |

**Goal.** Three regenerations with the same inputs, fixed temperatures and a seed where supported are
compared by a stated metric, and the result is recorded against a stated threshold.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 4 definition of done, line 4
- `docs/06-summarization-and-trend-report.md` §11.1 — temperatures, `top_p: 1`, seed, the
  best-effort caveat
- `docs/12-prompt-library.md` §18.1 rule 8 — "Do not rely on a `seed` parameter"

**Files.**
- create `scripts/trend-determinism.ts` (compares three runs' clusterings and prints the metric.
  *Review 2026-10-25: this row read "bypasses `tc`/`cr`/`rp`, keeps `ps`", which a Node script
  cannot do; the bypass is `P4-T18` step 3's run option, and the three runs happen inside Zotero —
  name the in-Zotero half as for `P4-T23` before writing code.*)
- create `test/unit/scripts/trendDeterminism.test.ts`
- create `docs/spikes/trend-determinism-report.md`

**Do.**
1. The comparison metric over the three clusterings — pairwise co-assignment agreement, the share
   of paper pairs placed together or apart the same way in two runs (decided below) — unit-tested on
   synthetic assignments.
2. State the run's estimate and stop for approval (`G-42`); run three times with the synthesis
   caches bypassed (`P4-T18` step 3's option).
3. Record the agreement for each of the three pairs of runs against the 0.8 threshold, the theme
   names side by side, and pass/fail; stop for the owner's reading of the three theme-name lists and
   record it.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** "substantively equivalent themes" had no
> measure in any document. **Decided: pairwise co-assignment agreement (the share of paper pairs
> placed together or apart the same way in two runs) ≥ 0.8 for every pair of runs, plus the owner's
> reading of the three theme-name lists on the `G-24` page.** If it fails, §5.4 (from `plan/05` §1.4) names the
> two remedies (tighter temperature, or client-side clustering), both new work. Written into
> `docs/11` §1 Phase 4 definition of done by the coordinator on 2026-10-26. (The alternative not
> taken: the owner's reading alone.)

**Do NOT.**
- Do **not** let the caches make three runs identical (the check would be vacuous).
- Do **not** loosen the threshold after seeing the result (`plan/README.md` §5 item 6).

**Done when.**
- [ ] The metric's test passes on synthetic identical, permuted and shuffled assignments.
- [ ] The three pairs' agreement figures, the verdict against 0.8 and the owner's reading are
      recorded.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- trendDeterminism` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- trendDeterminism
```
Then stop at the spend.

**Notes.** Needs from Phase 3: nothing beyond `P4-T23`'s.

---

### P4-T25 — Phase-4 acceptance run against the definition of done

| Field | Value |
|---|---|
| **ID** | `P4-T25` |
| **State** | `TODO` |
| **Depends on** | `P4-T21`, `P4-T22`, `P4-T24` |
| **Blocks** | none |
| **Retires** | closes `R-7`; completes `R-6` |
| **Implements** | `FR-25`, `FR-26`, `FR-27`, `FR-28`, `NFR-15` |
| **Estimate** | 0.75 d |
| **Human gate** | **Yes** — gates `G-18` (keys), `G-24` (the owner reads one English and one Korean report and checks themes, fabrication and original-script names), and `G-42` for a stated spend: one English and one Korean report on the 50-paper evaluation collection plus, only if the owner asks for one (decided 2026-10-26, item 286), one 400-item abstract-only run on a cheap model — expected under $15 in total at `docs/06` §5.4's illustrative prices, stated from `P4-T16`'s estimate and approved before dispatch. `G-25` applies only if a group library is used. |

**Goal.** Every line of the Phase 4 definition of done is demonstrated on a real Zotero profile and
recorded.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 4 "Definition of done"
- `docs/13-testing-build-and-release.md` §8.5 — the trend-report QA items
- `plan/06-human-gates.md` `G-24`, `G-25`

**Files.**
- create `docs/spikes/phase-4-acceptance-report.md`
- create `test/integration/pipeline/phase4Acceptance.spec.ts` (live parts behind `RH_DOD_LIVE`)

**Do.**
1. Record `P4-T22`'s offline 400-item result as the definition-of-done proof; run a live 400-item
   job only if the owner asks for one (decided below), behind `G-42`.
2. Generate one English and one Korean report; record the validator's resolution figure (100 %).
3. Record `P4-T24`'s verdict, and for the original-script line the split decided on `P4-T21`:
   `P4-T21`'s mechanical check where code renders the names, and the owner's `G-24` reading of one
   Korean report for the prose.
4. Stop for `G-24`; record the owner's findings verbatim.
5. Map FR-25's six required topics to the eleven sections and record it (`P4-T08` Notes).
6. Record the IMRaD outcome from `P3-T22` and how §2 discloses it.

> **Decided 2026-10-26 (owner, `plan/00` §6 item 286):** whether the 400-item line needs a live run.
> `docs/11` and `docs/13` §8.5 say "A 400-item collection produces a report without a context-length
> error". **Decided: `P4-T22`'s enforced-window mock as the proof, plus one live 400-item
> abstract-only run on a cheap model only if the owner wants it**, because the property is about
> budgeting code, not model output, and the live run's map phase alone is ~400 summary calls. Written
> into `docs/11` §1 Phase 4 definition of done (one clause) by the coordinator on 2026-10-26.
> `docs/13` §8.5's QA line is not changed by this card; if it must say the same, that is a
> `plan/00` §6 item, not this card's work. (The alternative not taken: always a live 400-paper run.)

**Do NOT.**
- Do **not** dispatch a paid run without the owner approving the estimate (`G-42`).
- Do **not** count `G-24` as passed because the validators passed (`plan/06` `G-24` "If it is not
  done").
- Do **not** mark the phase done while `P3-T22`'s outcome is unrecorded.

**Done when.**
- [ ] Each definition-of-done line has a recorded figure or verdict in the acceptance report.
- [ ] The owner's `G-24` reading is recorded.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract && npm run build
```
Then the manual steps above on a real Zotero 10 profile, stopping at each gate.

**Notes.** Needs from Phase 3: **`P3-T31` (NOT BUILT)** and **`P3-T22` (NOT BUILT)**.

---

## 3. Estimate reconciliation

`docs/11` §1 Phase 4 published **16.5–23 d, "⚠ scaled, not decomposed"** (11 d × 1.50, × 1.4) until
2026-10-26. These cards sum to **23.75 d**, a band of **23.75–33 d** (23.75 × 1.4 = 33.25 → 33)
*(review 2026-10-25: was 22.5 d, 22.5–32 d; decided 2026-10-26: was 23.25 d, 23.25–33 d)*. The low
end is 44 % above 16.5 (23.75 ÷ 16.5 = 1.44) and 3 % above the scaled top of 23; `plan/README.md` §7
says a divergence above ~30 % is "a signal to re-estimate the phase in `docs/11`, not to quietly
adjust the tasks", and that is what was done: the owner decided the open lines on 2026-10-26 (item
286, "the coordinator then propagates the estimate") and the card sum replaced the scaled figure in
all five places the same day. Where the days went, against the work areas of §5.1 (carried over from
`plan/05` §1.1):

| Work area (§5.1) | Cards | Days |
|---|---|---|
| — types, preferences, prompts (no work area) | `P4-T01`, `P4-T02`, `P4-T03` | 2.25 |
| W4-1 Digest projection | `P4-T04` | 0.5 |
| W4-2 Hierarchical synthesis engine | `P4-T05`, `P4-T06`, `P4-T07`, `P4-T17`, `P4-T18` | 5.0 |
| W4-3 Prompt wiring and validation | `P4-T08` (with `P4-T03` above) | 1.25 |
| W4-4 Client-generated scaffolding | `P4-T12` | 1.0 |
| W4-5 Citation binding and bibliography | `P4-T10`, `P4-T11` | 2.0 |
| W4-6 Note rendering, saving, export | `P4-T13`, `P4-T14`, `P4-T15` | 3.0 |
| W4-7 Self-critique | `P4-T09` | 1.0 |
| W4-8 Korean path | `P4-T21` | 0.75 |
| W4-9 Dialog, progress, cost | `P4-T16`, `P4-T19`, `P4-T20` | 3.5 |
| W4-10 Evaluation and determinism | `P4-T22`, `P4-T23`, `P4-T24` | 2.75 |
| Acceptance | `P4-T25` | 0.75 |
| **Total** | 25 cards | **23.75** |

The unpriced work the scaled figure hid is the same kind Phases 0–3 found: a localization surface
that does not exist yet (`reportWindow`), a migration with its two pinned tests, a documents-first
type reconciliation, two platform measurements (`P4-T11`, `P4-T13`), and new prompt text
(`THEME_MERGE`, `CLUSTER_REDUCE_MERGE`).

**What the 2026-10-26 decisions did to the sum.** Every open line was decided as recommended, and
the cards had been priced on the recommendations, so a decision moves an estimate only where it put
work in a card whose `Files` had not priced it. Two did: `CLUSTER_REDUCE_MERGE`, which the draft
left on `P4-T07` with no prompt, `docs/12` or registry row, now written and shipped by `P4-T03`
(0.75 → 1.0 d), and the report's own egress notice, which the draft left on `P4-T18` with no
`egressDisclosure.ts` or string row, now built by `P4-T16` (1.0 → 1.25 d): 23.25 + 0.25 + 0.25 =
**23.75**, re-read from the cards by script. The other decided steps — the documents-first edits each
card now opens with, the section-by-section critique fallback (`P4-T09`), Appendix C and the
retracted list (`P4-T12`), the group-library confirmation (`P4-T14`, `P4-T20`) — sit inside files
those cards already list and were not re-priced. The decisions that would have *added* work had they
gone the other way (a second critique provider, a third-party Markdown library, `.html` export, a
nightly evaluation job, a live 400-item run) were all declined.

**Where the sum is still likely low** *(review 2026-10-25; not re-estimated, because none of these
has a measurement yet)*: `P4-T11` and `P4-T13` are in-Zotero platform measurements, the kind that
took `P3-T21` from 0.5 to 1.5 d; `P4-T13`'s recommended hand-rolled renderer covers ten constructs
plus a sanitizer; `P4-T14` holds a note writer, a store with its migration and a file (expect
1.5–1.75 d, its Notes); `P4-T19` is the plugin's second window with its own Fluent bundle, after
`searchDialog`, whose Phase 1 build ran over several cards; and `P4-T06`'s
output-ceiling line, answered against its recommendation, puts `THEME_MERGE` on almost every run.
Together these could add 2–3 d, which would put the low end near +55 %. *(Decided 2026-10-26: the
last of the five fell away — `P4-T06`'s line was decided as recommended — and none of the other four
has been measured, so the 2–3 d is kept as stated rather than re-guessed; against 23.75 it would put
the low end near +56 % to +62 %.)*

**Propagated 2026-10-26** to the five places `plan/README.md` §7 names: this file's §1 roll-up and §0
`Effort`; `docs/11` §1's table, prose and mermaid node; `docs/11` §1's Phase 4 `Effort` paragraph and
§2's critical path and floats; `plan/00` §1's table with its percentage column; and `plan/05` §1,
now a pointer to this file.

---

## 4. What this file does not card, and why

| Item | Where the documents ask for it | Why no card |
|---|---|---|
| `.html` export (D-06-10) and the Markdown-as-attachment variant | `docs/06` §14.3; `docs/08` §6.3 | Not a `docs/11` deliverable; `P4-T15`'s decided line sends both to `plan/00` §6 (rule 9; item 287(c)) |
| `.docx` export | `docs/06` §14.3 D-06-10 | v1.1 by the document's own decision |
| Better Notes converter | `docs/06` §14.1 D-06-9 | Entry point `Unverified`; no deliverable needs it (`P4-T13`'s decided line; `plan/00` §6 item 287(b)) |
| Backlinks (`report.addRelatedLinks`) | `docs/06` §10.4 | Optional by its own text; no deliverable needs it (`P4-T02`'s decided line; `plan/00` §6 item 287(a)) |
| "Grade this report" action | `docs/06` §12.3 | "optional"; not a deliverable |
| "Clear cache for this collection" / "Clear all" | `docs/06` §11.3 ("mandatory") | Phase 7's W7-4 owns the "Clear cache" action (`plan/05` §4.1) |
| Spoken-script hand-off (`AudioHandoff`, `AUDIO_SCRIPT_*`) | `docs/06` §14.4 | Phase 6 |
| 20-paper multilingual fixture | `docs/06` §13.2 `Unverified` action item | `plan/04` §4 item 6 says it "belongs with the Korean report work in Phase 4", but it measures summaries, and no Phase 4 finishing condition needs it; under rule 9 it goes to `plan/00` §6 tagged Phase 4 (recorded there as item 287(e), 2026-10-26) *(review 2026-10-25: the reason now cites `plan/04` §4 item 6, which it contradicted silently)* |
| A nightly evaluation job | `docs/13` §2.2 | `P4-T23`'s decided line (needs a key in CI; `plan/00` §6 item 287(d)) |
| Re-measuring token ratios | `docs/06` §5.1 action item | Produced by real runs (`P3-T31`, `P4-T23`–`P4-T25`), not a card of its own |

Every `docs/11` §1 Phase 4 deliverable and definition-of-done line has at least one card (§0 tables).

---

## 5. The Phase 4 outline, carried over from `plan/05` §1

Moved here verbatim on **2026-10-26**, when `plan/05` §1 was reduced to a pointer to this file
(`plan/05` §0, "Exit from outline into cards"), because the cards, `plan/06` and `plan/05` §5.1 cite
the work areas `W4-1`–`W4-10` and these subsections. It is the outline of **2026-09-09**: where a
card, §0's entry-condition table or a decision of item 286 says otherwise, that wins. §5.2's entry
conditions are tracked in §0's table; §5.3's seven decisions are all made — re-runs and edited notes
(`P4-T14`, `docs/10` §5 Q11), group libraries (`P4-T14`, Q12), the bibliography path (`P4-T11`
measures it and `docs/01` owns it), section provenance (`P4-T12`), critique by default (`P4-T09`
Notes) and backlinks (`P4-T02`).

### 5.1 Work areas

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

### 5.2 Entry conditions

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
- **`docs/10` §5 questions 7, 11, 12 and 19 are answered** (see `plan/05` §5.1 for what each
  gates), and question 6's residual half — whether either ceiling ships non-zero
  — is answered, because a trend-report run is the single most expensive action
  in the product.
- **Token-estimation ratios have been replaced by measurements.** `docs/06` §5.1
  marks the ratios `> **Unverified:**` with an action item to derive a rolling
  per-model correction factor from real `usage` blocks. Phase 3 produces those
  blocks; Phase 4's cost preview is only as good as they are.

### 5.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Report re-run behaviour — always a new note, or "update in place" with a diff | `docs/06` §14.2 (with the pref key, if any, in `docs/07` §8.5); the question is `docs/06` §16 item 6 |
| Whether a generated note may be overwritten when the user has edited it (hash mismatch) | `docs/07` §8.5 for the pref; the question is `docs/10` §5 question 11 |
| Group-library report visibility — shared note by default or private | `docs/09` §3 and `docs/07` §8.5; questions are `docs/06` §16 item 7 and `docs/10` §5 question 12 |
| Bibliography path — Zotero's citation processor, or the `itemToCSLJSON` fixed-format fallback that ignores the user's style | `docs/01` (the confirmed API) with `docs/06` §10.3 updated to point at it |
| Whether the report claims section provenance for full-text-derived findings | `docs/06` §4.3, following the R-19b outcome in `docs/11` §3 |
| Whether the self-critique pass runs by default, given it is an extra call on every report | `docs/07` §8.5 for the shipped default; semantics stay in `docs/06` §12.2 |
| Backlinks from cited items to the report note — on or off by default | `docs/06` §10.4 names the pref gate; the value belongs in `docs/07` §8.5 |

### 5.4 What would change the plan

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

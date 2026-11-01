# Phase 5 draft — second-agent review, 2026-11-01

Reviewed: `plan/08-phase-5-related-papers.md` (the draft of 2026-11-01; its author's report is
`plan/reports/phase5-draft.md`). Edited: that file only, each change marked "Corrected 2026-11-01
(review)". Nothing in `src/`, `test/`, `addon/`, `typings/`, `scripts/`, `docs/` or any estimate site
was touched, nothing was built, tested or run in Zotero, and nothing was committed. The files `P4-T18`
is editing were read, never written.

## Verdict

The draft is sound in shape and thorough in its document work: every `docs/11` §1 Phase 5 deliverable
and definition-of-done line, every Phase 5 FR (FR-13–FR-18, FR-44–FR-49) and every `docs/13` §8.3 QA
line maps to a card; the dependency graph is symmetric and acyclic; the §1 table matches the cards;
gate cells are spelled to `plan/README.md` §4; and 23 document contradictions are named correctly (each
one re-checked here). Every name in §0.1 exists in the tree; one was cited in the wrong file.

The defects are the kinds the Phase 4 review found, plus one ordering defect of this phase's own:

- **A dependency mistake that makes `P5-T04` unexecutable as ordered.** Fixtures are keyed on the
  exact method, URL and body (`fixtureKey`, `test/support/fixtureReplay.ts`), and the
  `test/support/*RecordedRequests.ts` modules `P5-T04` edits import the shipped request builders. The
  builders for references, citations, recommendations, title match, `elink` and Crossref references
  are created by `P5-T05`–`P5-T09`, which depend on `P5-T04`. Recording first means the adapter cards
  must reproduce hand-made URLs byte for byte or re-record. Left to the coordinator (line 32 below).
- **Work other cards assume and no card builds.** FR-44's "display the profile before searching, then
  use the edited profile" needs a profile-only run that `P5-T25` does not have, although `P5-T26` step 3
  relies on it; `docs/05` §7.5's hydration of survivors and candidate vectors has no stage in the
  recommend pipeline; per-cluster generation is presupposed by `P5-T23`'s own Do NOT and `P5-T27`'s
  grouping but no step builds it; `P5-T21`'s `addedAt` has no source (the item mapper reads no
  `dateAdded`). Two cards re-estimated (`P5-T23` +0.25 d, `P5-T25` +0.5 d), one `Files` row fixed.
- **The keyless rule (§0.2 item 19) leaks through two reused paths.** The shipped `sources` default
  ticks Semantic Scholar and its adapter's `isConfigured()` is `true` without a key, so `P5-T23`'s
  keyword generator and `P5-T12`'s abstract backfill would both send unkeyed Semantic Scholar requests
  and fail `P5-T28`'s zero-request check. Both cards corrected to the draft's own convention.
- **Rule 10 and rule 8.** `P5-T17` adds `relateTo` to `ImportRequest` but omitted
  `src/bootstrap/registerPipelines.ts`, whose two `importWorks` calls are the only ones in `src/`;
  `P5-T03` named two of the four tests that pin the schema version; `P5-T05` stated an unrecorded
  response ("a 404 is no match") as a premise; `P5-T04`'s scenario list lacked four bodies later cards
  test against.
- **Two mis-stated layering rules.** `P5-T14` forbade `pipeline/` → `zotero/` (allowed by `docs/07`
  §2.3 and `eslint.config.js`; ten pipeline files do it) and `P5-T16` forbade `ui/` → `pipeline/` (allowed)
  while omitting `sources/` and `tts/` (forbidden).
- **A decided item the draft did not carry through.** Item 184's invariant ("`citationGraph` true
  exactly when the adapter exposes `findRelated`", held by `container.test.ts`) forces PubMed's
  `citationGraph` to `true` once `P5-T08` adds a pmra-only `findRelated`, which contradicts `docs/07`
  §4.2's description of the flag ("returns references / citations edges"). New line 18.
- **Open lines the documents already settle:** three of the 29 (vector storage location, which TTLs
  ship, library items outside the collection). **A privacy-document gap the draft missed:** `docs/09`
  §3 row 6 says the literature databases receive only "the generated queries", but four of the five
  recommend generators send collection identifiers, dismissed identifiers or author names (line 8,
  the owner's).

After the corrections the card sum is **34.0 d over 30 cards** (was 33.25), band **34–48 d**, **+62 %**
against the scaled 21 d, longest chain **14.25 d**. The phase is probably still under-priced: the
author's 2–3 d plus this review's 0.75–1.25 d puts the low end at 36.75–38.25 d (+75 % to +82 %). **36 open
lines** remain (29 − 3 settled + 10 added): 13 the owner's, 23 the coordinator's under item 313.

## Script check (after the edits)

Independent checker
`C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p5review-check.mjs`,
written for this review (it parses each card's rows, the §1 table, `create` rows and open-line markers).

| | Before | After |
|---|---|---|
| Cards | 30 | 30 |
| Card sum (each card's `Estimate` row) | 33.25 | **34.0** |
| §1 table sum | 33.25 | 34.0 (every card's title, estimate and gate match) |
| Gated cards | 2 (`P5-T29`, `P5-T30`) | unchanged |
| Depends/Blocks mismatches, cycles, unknown ids | 0 | 0 |
| A path `create`d by two cards | 0 | 0 |
| Titles over 60 characters; gate-cell misspellings | 0; 0 | 0; 0 |
| Entry points / terminals | `P5-T01`, `P5-T02`, `P5-T04` / `P5-T30` | unchanged |
| Longest chain | 13.5 d | **14.25 d**: `T01 → T03 → T18 → T21 → T23 → T24 → T25 → T26 → T27 → T28 → T30` |
| Feature 2 chain (`T01 → T06 → T12 → T13 → T14 → T16 → T17`) | 8.25 d, 3.5 d ahead | 8.25 d, **4.25 d** ahead of Feature 6's 12.5 d to `P5-T27` |
| `Open — recommended` markers in plan/08 | 28 (+1 in §4) | unchanged in the file; 36 in the list below |

Band: 34.0 × 1.4 = 47.6 → 48. 34.0 ÷ 21 = 1.62 (+62 %); ÷ 29 = 1.17; ÷ 14 (superseded top) = 2.43×.
Not propagated (item 318(c)): the coordinator moves the estimate after the owner answers.

## What was checked, and the result

1. **Deliverables, FRs, definition of done, QA lines → cards.** All covered. FR-13 scenario 3 (named
   error) is `P5-T11`; FR-45 scenario 2 (no provider) is `P5-T22` step 4 with `P5-T26`'s notice; FR-49's
   v1 scope (suppression only) matches `docs/10` §4 item 13. No change.
2. **Depends/Blocks.** Symmetric and acyclic. One ordering defect (recording before builders, line 32).
   Two transitive-only edges to watch: `P5-T23` and `P5-T14` reach `P5-T05` only through `P5-T20`; if
   line 3 is answered "word-overlap only" and `P5-T20` is dropped, add `P5-T05` → `P5-T23` and
   `P5-T05` → `P5-T14` directly.
3. **Names, callers and constructing files (rules 8 and 10), grepped.** Every §0.1 name exists.
   `PipelineId` is in `src/pipeline/types.ts` (fixed). `importWorks` is called only from
   `registerPipelines.ts` (fixed on `P5-T17`). The schema version is pinned to 7 in four tests:
   `provenanceRerun.test.ts`, `provenanceStore.spec.ts`, `privacyPolicy.test.ts`,
   `userPriceStore.test.ts` (fixed on `P5-T03`; `plan/04` §0.2 item 4's "two" is stale). The view models
   are constructed in `registerUI.ts` (`createSearchImportViewModel(deps)`), as `P5-T16`/`P5-T26` say.
   `SearchImportTarget.parentCollectionId` exists, so `P5-T27`'s dated subcollection needs no new
   target field. `RelatedQuery.strategy` already has `"citations" | "references" | "cocitation" |
   "embedding" | "auto"`. `PipelineContext` already carries `cache`, `sources`, `zotero`, `config`.
   `src/pipeline/related/` and `src/pipeline/recommend/` hold only `.gitkeep`. `test/integration/live/`
   does not exist yet (the runner's entry is `test/integration`, so a new subfolder is picked up).
4. **The author's open questions, answered where a grep could.** `fromZoteroItem`'s path reads no
   `dateAdded` (so the port supplies it; fixed on `P5-T18`). Fan-out under a budget: `fanOut` takes no
   budget but runs one query per call, so the generator can take from the budget before each call —
   workable without changing `fanOut`; it does need the process-wide `network-metadata` `Semaphore`
   (`FanOutOptions.pool`), which `buildPipelineSet` already builds. `/paper/search/match`'s no-match
   response is still unrecorded (`P5-T05` now asks it as a question).
5. **"Done when" lines.** All mechanically checkable. Four needed fixtures no recording produced
   (fixed on `P5-T04`).
6. **Estimates.** See "Under-priced cards" below.
7. **plan/00 §6 items.** 184: see line 18. 272(b): `P5-T03`'s no-`REFERENCES` rule follows it. 286: its
   "dropping embedding-based grouping (Phase 5's)" moved the methods out of `TrendReport`, not a
   deliverable into Phase 5; nothing owed. 292(f): applies to recommend runs too (line 36). 296: Phase 5
   writes no notes; not engaged. 303(c): correctly cited for "no resume". 305(a): a recommend run has one
   collection, so its own override and the global mode decide; nothing new. 307(d): followed (`P5-T02`).
   313: each line below is classified by it. 318(c): followed.
8. **Gates.** `G-26` and `G-27` exist and match; `G-43` is the next free number (`G-42`'s note says
   `G-26`–`G-41` were allocated; nothing above 42 exists). Expected spend is stated on `P5-T30`.

## Corrections made in plan/08 (each carries "Corrected 2026-11-01 (review)")

1. Header: a review note; §0 Effort, §1 table, total and critical path, §3 sum, band, percentages,
   work-area rows W5-7 (3.25) and W5-9 (8.5), and the "still likely low" paragraph (its +68–73 % was on
   the old sum; now +71–76 %, plus a dated paragraph for this review's additions).
2. §0.1: `PipelineId`'s file; the four version pins.
3. `P5-T03`: two missing version-pin tests in **Files**, "four" in **Done when**, both in **Verify**.
4. `P5-T04` step 1: four scenarios later cards test against — a title with no match, a 400 for an
   unknown field, `/paper/batch` with one unresolvable id, and the Recommendations size-cap 400
   (hand-written).
5. `P5-T05` step 2: "a 404 is no match" turned into a question for the agent (rule 8).
6. `P5-T12` step 3: a keyless run passes the backfill's `selected` list without Semantic Scholar (item
   194's mechanism), or §0.2 item 19 and `P5-T28` fail.
7. `P5-T14` **Do NOT**: the layering claim replaced by the port convention it really is.
8. `P5-T16` **Do NOT**: the forbidden import list corrected (`sources/`, `llm/`, `tts/`, `zotero/`).
9. `P5-T17` **Files**: `src/bootstrap/registerPipelines.ts` (rule 10).
10. `P5-T18` **Files**: the port also supplies each item's `dateAdded` for `P5-T21`.
11. `P5-T20` **Files**: `docs/03` §16's "User has only an Anthropic key" row ("BM25 + LLM re-rank")
    also turns on `P5-T22`'s `RECOMMEND_RANK` line.
12. `P5-T23`: 1.5 → **1.75 d**; keyless Semantic Scholar dropped from generator (d)'s source list;
    `docs/05` §7.3 row (d) corrected to FR-45's "the selected sources" (new **Files** row); the
    per-cluster gap recorded.
13. `P5-T25`: 1.5 → **2.0 d**; the key probe in the `container.ts` row; the three missing pieces recorded
    (profile-only run and edited-profile input; hydration and candidate vectors after the
    identifier-level filters; the key probe).
14. `P5-T28` **Files**: `docs/11` §1 Phase 2's "Risks retired. R-2, R-3, R-18" claims the same unproven
    fallback as §3's table.

## Under-priced cards, with the arithmetic

| Card | Draft | Now | Why, and against what |
|---|---|---|---|
| `P5-T25` | 1.5 | **2.0** (re-estimated) | The stages grow from the draft's 7 to about 11 (profile check, statistics, vectors, centroids, priced and confirmed profile call, edits, identifier-level filters, generate, hydrate survivors, candidate vectors, score/diversify, record) with two entry modes (profile only; edited profile in). `P4-T18`, eleven stages with pause and resume, is 2.0 d; `P3-T29`, seven stages, 1.25 d. |
| `P5-T23` | 1.5 | **1.75** (re-estimated) | Per-cluster generation (k ≤ 4 Recommendations POSTs inside the budget, interleaving and labels) plus the keyless source exclusion. |
| `P5-T04` | 1.0 | likely **1.25**, not changed | The recommended answer to line 33 needs a keyed Semantic Scholar recording path; the recorder is "No API key, by construction" and has an env-key path only for LLM providers (`--live`, `--confirm-spend-usd`). +0.5 more if line 32 moves the five builders here, offset by about −0.25 across `P5-T05`–`P5-T09`. |
| `P5-T03` | 1.0 | likely **1.25**, not changed | Three migrations, three stores with two `BLOB` codecs (centroids sliced by `centroid_count`; `Float32Array` vectors), four version pins and an integration spec, against `P4-T14`'s one table plus note writer at 1.25. +0.25 more if line 31's bound is chosen. |
| `P5-T14` | 1.5 | likely **1.75**, not changed | `P5-T16` step 3's "the run continues with the user's pick" needs the pipeline to accept a chosen seed; candidate vectors must be fetched before the similarity term; neither is a step. |
| `P5-T16`, `P5-T26`, `P5-T27` | — | the author's 2–3 d | Unchanged: second and third modes of a window whose view model is 3 171 lines and document script 3 940. |

Revised sum **34.0 d**, band **34–48 d** (+62 %). With the likely additions: 34.0 + 0.75–1.25 (this
review) + 2–3 (the author's) = 36.75–38.25 d, +75 % to +82 %.

## Questions — 36 open lines

Each line: the decision · **recommended** · main alternative · *who decides*. "Owner" is item 313's
list (scope, money, keys, privacy, finishing conditions); "coordinator" is item 313's small and medium
choices. Card ids are for the coordinator. Lines 19, 25 and 26 of the author's list are removed (end of
this section).

### Theme 1 — Without a Semantic Scholar key, and what the AI model is used for (8)

1. *(P5-T28)* Is a Semantic Scholar key required for related papers and recommendations? · **No: both
   work without it, at lower quality, and say what a key adds; `docs/10` question 8 marked decided; the
   preferences text "need a key" becomes "work better with a key"** · require the key. *Owner (scope,
   finishing conditions).* Note: `docs/10` §5 already says an unanswered question's default is what
   gets built, and `docs/11`'s definition of done has a no-key line, so "require the key" would also
   change a finishing condition.
2. *(P5-T12)* Without a key, does the plugin still try Semantic Scholar's free shared access? · **No
   request at all from these two features, their keyword searches or their abstract fill-in; keyword
   search in the search window is unchanged** · one attempt per run with back-off. *Owner (scope).*
   Evidence beyond the draft's: on 2026-10-16 the shared access refused 12 requests in a row over about
   six hours (items 222 and 226).
3. *(P5-T20)* How "similarity" is computed in v1 · **Semantic Scholar's paper vectors when a key is
   present, otherwise word-overlap similarity computed on the computer; no other vector service** ·
   word-overlap only (−1.75 d), or add a paid vector service as a fallback (+1.5 d, a new "data sent
   to" notice and cost line). *Owner (scope).*
4. *(P5-T22)* Which AI calls Phase 5 makes · **one call per collection profile, cached until the
   collection changes; ranking and reasons computed in code; the ranking prompt not built in v1** ·
   also re-rank every run with the ranking prompt (+1.5 d, a paid call per run). *Owner (scope, money).*
5. *(P5-T22)* What the profile call is sent · **one line per paper — its Zotero item key, title, year,
   journal and top subject terms — no abstracts, no summaries; the privacy document's "a sample of
   titles" becomes "every paper's title"** · send the Phase 4 paper digests, which needs a summary of
   every paper first. *Owner (privacy).* Added by this review: the line must carry the item key,
   because the prompt's answer format cites papers by 8-character item key (`exampleItemKeys`).
6. *(P5-T30)* A spending-approval gate for recommendation runs · **a new gate `G-43`, modelled on the
   report gate `G-42`** · the card states its expected spend only. *Owner (money).*
7. *(Added, P5-T22)* How much "reasoning" the profile call asks the model for · **none sent, as
   `docs/12` §18.5 says ("not assigned"); the acceptance run records how much of the 2 500-token answer
   limit was used** · medium, like the report's synthesis calls (item 286), which on some providers
   counts against the same limit and could cut the answer short. *Coordinator.*
8. *(Added, P5-T23; `docs/09` §3 row 6)* What the literature databases receive in a recommendation
   run. The privacy document says "the generated queries", but the design also sends up to 15 of the
   collection's paper identifiers and up to 10 dismissed papers' identifiers to Semantic Scholar,
   PubMed identifiers to NCBI, and the five most frequent authors' names to Europe PMC · **correct the
   privacy document to name them (public identifiers and author names, as row 2 does for one seed) and
   say so in the recommend window's notice** · send only search queries, which removes four of the five
   ways candidates are found. *Owner (privacy).*

### Theme 2 — Find related papers from one item (10)

9. *(P5-T11)* When a paper has only a title, how close a match must be · **the duplicate-detection
   thresholds already in use (title similarity ≥ 0.95, or ≥ 0.88 with year within one and the same first
   author); two or more passing → the user picks** · a new threshold tuned on a labelled sample.
   *Coordinator.*
10. *(P5-T15)* More than one item selected · **the menu entry is disabled; a tooltip only if Zotero shows
    one on a disabled entry, otherwise FR-13's wording corrected** · "Find papers related to N items"
    (+1 d). *Owner (scope).*
11. *(P5-T12)* "Co-cited" papers · **not in Phase 5; backlog** · build it now (+0.5 d). *Owner (scope).*
12. *(Added, P5-T12/T15/T16; `docs/08` §5)* Two related-papers behaviours the UI document draws and no
    card builds: a "Semantically similar" source for seeds without a PubMed id (`docs/08` §5.1 step 2;
    `docs/05` §9.5's "similar papers already in my library"), and "seed is a preprint with a published
    version — offer to fetch for the published version too" (`docs/08` §5.3) · **"similar" means
    PubMed's similar-articles list in v1 and the checkbox says so; both behaviours go to the backlog
    tagged Phase 5; `docs/08` §5 corrected** · build a local similarity search over the user's library
    (+0.5 d) and the published-version option (+0.25 d). *Coordinator (rule 9: no finishing condition
    needs either); the owner's if read as scope.*
13. *(P5-T16)* Year handling in the related window · **no year filter by default; papers outside the
    three-year window are greyed and unticked** · tick "Restrict to last 3 years" by default.
    *Coordinator.*
14. *(P5-T02)* Default of "link imported papers to the seed" · **on** · off. *Coordinator.*
15. *(P5-T17)* Which imported papers get linked to the seed · **new and already-owned alike** · new
    only. *Coordinator.*
16. *(P5-T17)* A provenance note for related or recommendation imports · **none in v1; the job record
    keeps the seed or profile** · extend the search-provenance record and its schema. *Coordinator.*
17. *(P5-T01)* What a related or recommendation job is · **it ends when results are shown; importing is
    the search window's existing import; no automatic resume after a restart (item 303(c)'s
    precedent)** · keep the job alive while the user chooses (`docs/07` §12.2's 30-minute waiting
    state). *Coordinator.*
18. *(Added, P5-T08)* PubMed's similar-articles source and the rule that a database "with the citation
    flag" is exactly one that answers related-paper requests (item 184, held by a test). Once PubMed
    answers related-paper requests the test forces the flag on, while `docs/07` §4.2 describes the flag
    as "returns references / citations" · **widen `docs/07` §4.2's description to "returns relation
    edges (references, citations, recommendations or similar articles)", which keeps item 184's rule
    and its test unchanged** · PubMed also serves its citation lists (`pubmed_pubmed_refs`,
    `pubmed_pubmed_citedin`, `docs/02` §3.6) so the old description holds (+0.25 d). *Coordinator (a
    reading of an owner decision); the owner's if read as revisiting item 184.*

### Theme 3 — Recommend new papers from a collection (11)

19. *(P5-T26)* Where the user sees and edits the profile · **a panel inside the search window's
    recommend mode, drawn in `docs/08` first** · a separate profile-editor window. *Coordinator.*
20. *(Added, P5-T25/T26)* How "show the profile first, then search with the edits" runs · **one
    recommend pipeline whose input says "profile only" or carries the edited profile; each half is its
    own job, and each asks the cost question only when a paid call is due** · two pipeline ids, which
    `PipelineId` does not have (a `docs/07` §4.5 change). *Coordinator.*
21. *(P5-T25)* Do profile edits last beyond one run · **yes, stored with the profile and re-applied
    after a rebuild** · one run only. *Coordinator.*
22. *(P5-T25)* Scope of "Not interested" · **per collection** · library-wide. *Coordinator.*
23. *(P5-T01)* Which scoring signals · **`docs/05` §7.4's eight, with "found by" a list** · `docs/07`
    §5.2's seven older ones. *Coordinator.*
24. *(P5-T24)* Preprints · **a "preprint (not peer reviewed)" label everywhere; a per-run "Peer-reviewed
    only" box, off** · a setting, on by default. *Coordinator.*
25. *(P5-T27)* The "Familiar ↔ Exploratory" slider · **per run, default 25 of 100, not saved** · a
    saved setting. *Coordinator.*
26. *(P5-T23)* Which sources of candidates · **all five the design names, including the one-request
    "new papers by your frequent authors"** · drop the author watch. *Owner (scope).*
27. *(Added, P5-T23)* Multi-topic collections · **one Semantic Scholar recommendation request per topic
    group with that group's example papers (at most 4 requests, taken from the budget first), the other
    sources once, and every candidate labelled with its nearest topic** · search once and only group the
    results by nearest topic (fewer requests on the 1-per-second host, weaker for mixed collections).
    *Coordinator.* (`P5-T23` is priced on the recommendation.)
28. *(§4)* A held-out evaluation tool (hide recent papers, check they come back) · **not a card: the
    owner's expert judgement (`G-27`) is the finishing condition; backlog** · a card now (+1 d).
    *Owner (finishing conditions).*
29. *(Added, `plan/05` §2.3)* Recording which recommendations the user adds or dismisses, to measure
    quality later (`docs/05` §8.4) · **not in v1; backlog** · record it locally now, which adds an item
    to the "data you can clear" list (`docs/09` §3.7). *Owner (privacy, scope).* `plan/05` §2.3 lists it
    as a decision required before decomposition; the draft sent it to the backlog without asking.

### Theme 4 — Data, storage, recording and testing (7)

30. *(P5-T01)* What a source returns for "related" · **each paper with its relation (reference,
    citation, recommendation, similar), rank, score and citation context, declared in `docs/07` first**
    · source-specific methods outside the shared interface. *Coordinator.* Added by this review: the
    title match, the many-paper recommendation and the vector fetch (`P5-T05`, `P5-T06`, `P5-T09`,
    `P5-T20`) are adapter-specific either way; say in `docs/07` §4.2 that pipelines reach them through
    typed adapter instances passed in by `installServices` (the `SemanticScholarSource`/`hasApiKey`
    precedent), and give `RelatedQuery.strategy` members for recommendations and similar articles
    instead of overloading `"auto"`.
31. *(Added, P5-T03/P5-T20)* A size limit on stored paper vectors. NFR-8 requires plugin data to be
    "bounded, with an LRU eviction policy", and `plan/05` §2.3 asks for the vectors' "share of the NFR-8
    cap"; the vector table has no limit · **cap it at `docs/07` §9.2's existing 100 MB vector budget
    (about 33 000 vectors), evicting the oldest vectors of papers not in the library first** · no limit
    until Phase 7's "Clear embeddings". *Coordinator.* (+0.25 d on `P5-T03` if recommended.)
32. *(Added, P5-T04)* The order of recording and building. Recorded test responses are found by the exact
    request address and body, and the files that list them import the plugin's own request builders,
    which `P5-T05`–`P5-T09` create after `P5-T04` records · **`P5-T04` creates the five request
    builders (address and body only, with tests of their shape) and records; `P5-T05`–`P5-T09` extend
    them with parsers — one recording session, one keyed session for the owner** · each adapter card
    records its own responses (five recorder edits, up to five keyed sessions). *Coordinator
    (structure).* Net about +0.25 d.
33. *(P5-T04)* Recording test responses from Semantic Scholar · **the
    owner records the Semantic Scholar responses with the key in the environment, no cost; the agent
    records the other databases** · the agent tries the shared access first, off-peak. *Owner (keys).*
    Changed from the draft's recommendation on evidence: the shared access refused all 12 attempts on
    2026-10-16 (items 222, 226) and 12 of 12 on 2026-09-09 (`docs/02` §6.4). Either way the recorder
    needs a keyed Semantic Scholar path it does not have (+0.25 d on `P5-T04`).
34. *(P5-T29)* Probe sizes for "how many example papers" · **10, 20 and 50 with 10 negatives; keep 15
    unless 15 fails** · no probe; ship at 15. *Coordinator; the run itself waits on the owner's key.*
35. *(P5-T02)* How the two features stay hidden until they work · **two hidden settings,
    `related.enabled` and `recommend.enabled`, off until `P5-T30` passes** · one shared setting.
    *Coordinator.*
36. *(Added, P5-T22/P5-T26)* "Don't ask again" on the cost question for recommendation runs · **a record
    of its own, as for report runs (item 292(f)); a confirmation forced by money still opens (item
    274(b))** · share the summarize runs' record. *Coordinator.*

*(36 numbered lines: the author's 29, less the three removed below, plus ten marked "Added". Thirteen
are the owner's — 1–6, 8, 10, 11, 26, 28, 29, 33 — and twenty-three the coordinator's, two of which
(12, 18) the owner may read as scope.)*

### Removed — settled by the documents (3)

- **Author's line 19 (P5-T24), library items outside the collection.** FR-46, a Must requirement, says
  they are marked "in library" and unticked; `docs/11`'s definition of done says recommendations
  "exclude everything already in that collection" (the collection, not the library); `docs/13` §8.3
  tests exactly that split twice. `docs/05` §7.4's library-wide filter is the defect; correcting it is a
  step of `P5-T24`, not a question.
- **Author's line 25 (P5-T03), where vectors live.** `docs/05` §9.2 says it outright — "the vectors
  themselves live in the `embedding` table of §5.4, not in `cache_entry`" — and `docs/07` §8.3 declares
  that table, §8.5's storage row says "SQLite `embedding`, `vector BLOB` … Never JSON". What is really
  open is the size limit (line 31).
- **Author's line 26 (P5-T10), which cache lifetimes ship.** Not a contradiction: `docs/05` §9.2 calls
  its ten per-signal lifetimes "this document's finer, per-signal refinement of those namespaces, and it
  is what this section owns", and `docs/07` §9.2 owns only the namespaces' defaults and caps. The code
  already stores a lifetime per entry (`CacheSetOptions.ttlMs`, as `SOURCE_RESPONSE_LOOKUP_TTL_MS`
  does). `P5-T10` step 1 becomes a cross-reference in `docs/07` §9.2.

## For the coordinator (not owner questions)

- Apply the three removals above to plan/08 and the added lines to their cards; lines 20 and 27 are
  already priced, line 31 adds 0.25 d if taken, line 32 about 0.25 d net.
- `plan/04` §0.2 item 4 says two tests pin the schema version; four do. `P5-T03` now names them.
- §0.2 item 19 governs Phase 5's runs only — the keyword search window still tries Semantic Scholar
  without a key, as `P2-T05` built it. Say so in item 19 when line 2 is decided.
- Shared-file waves: `P5-T16` and `P5-T26` have no edge between them and could run together, but both
  edit `searchDialog.js`, `searchDialog.xhtml`, `registerUI.ts`, the search-window bundles and
  `keys.ts`; run them in sequence. Likewise `P5-T05`, `P5-T06`, `P5-T20` (`semanticscholarSource.ts`)
  and `P5-T14`, `P5-T18`, `P5-T25` (`registerPipelines.ts`, `container.ts`, `registry.ts`), the last
  three also shared with `P4-T18`.
- Document corrections now assigned to cards by this review: `docs/05` §7.3 row (d) (`P5-T23`);
  `docs/03` §16's Anthropic-only row (`P5-T20`); `docs/11` §1 Phase 2's risk line (`P5-T28`). Still
  unassigned: `docs/05` §7.5 applies the abstract filter before hydration (`P5-T25`'s note splits the
  filters; the document needs the same note); `docs/11` §1 and §3's "R-19" for Phase 5 (the author's
  item).
- The author's coordinator list stands (index script, `plan/00` §4 table, `plan/README.md` §2 row,
  `plan/05` §2 to a pointer, five-site propagation, `G-43` if line 6 is accepted, `docs/10` Q2, Q8, Q13,
  `G-03`'s float figure). Phase 5's new strings will form at least one `G-41` batch for the owner.

## Not checked

- Nothing was run except the checker; no code or test changed, so typecheck and the suites are
  unaffected by this review.
- `P4-T18` is editing `registerPipelines.ts`, `container.ts`, `registerUI.ts`, `docs/07` and `docs/12`;
  the names above were grepped on 2026-11-01 and may move.
- Whether Zotero's menu shows a tooltip on a disabled entry; `/paper/search/match`'s no-match response;
  Europe PMC's real rate limit; Crossref `reference[]` coverage; library-wide term counts on a 10 000-item
  library — all still unmeasured, as the author said.
- `docs/02` §3.6's PubMed citation linknames were read only in `docs/02` §3.6's table and `docs/05` §2.1,
  not tried.
- Phase 3 and Phase 4 card bodies were not re-read; their built state was taken from `plan/00` §4's ticks
  and `plan/reports/`.

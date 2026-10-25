# Phase 4 draft — second-agent review, 2026-10-25

Reviewed: `plan/07-phase-4-trend-report.md` (the draft of 2026-10-25; its author's report is
`plan/reports/phase4-draft.md`). Edited: that file only. Nothing in `src/`, `test/`, `docs/` or any
estimate site was touched, and nothing was run in Zotero.

## Verdict

The draft is sound in shape: every `docs/11` §1 Phase 4 deliverable and definition-of-done line maps
to at least one card, the dependency graph was symmetric and acyclic, and the §1 table matched the
cards. The defects were of the kind `plan/README.md` rules 8 and 10 exist for: four cards named no
composition-root file, or named the wrong one (`P4-T13`, `P4-T14`, `P4-T18`, `P4-T20`); one missing
edge (`P4-T12` → `P4-T09`); three "Done when" lines that could not fail or could not pass (`P4-T04`,
`P4-T09`, `P4-T16`); two `Files` rows describing work a Node script cannot do (`P4-T23`, `P4-T24`);
two open lines on different cards that recommended different answers to one question (`P4-T02`,
`P4-T09`); and four open lines, plus half of a fifth, that the documents already settle. One design fact the draft missed
changes a recommendation: `THEME_CLUSTER`'s answer lists every paper and outgrows its fixed
3 000-token output ceiling at roughly 50–80 papers, so "400 digests fit the input budget" does not
mean a 400-paper collection can be grouped in one call. After the corrections the card sum is
**23.25 d over 25 cards** (was 22.5), band **23.25–33 d**, **+41 %** against the scaled 16.5 d, and
the phase is probably still under-priced by 2–3 d in five named places. **35 open lines** remain for
the owner, grouped below into four themes.

## Script check (after the edits)

Independent checker (`…/scratchpad/p4review-check.mjs`, written for this review), cross-checked with
the draft agent's `p4check.mjs`; both agree.

| | Before | After |
|---|---|---|
| Cards | 25 | 25 |
| Card sum (from each card's `Estimate` row) | 22.5 | **23.25** |
| §1 table sum | 22.5 | 23.25 (matches every card's title, estimate and gate) |
| Gated cards | 3 | 3 |
| Depends/Blocks mismatches, cycles, unknown ids | 0 | 0 |
| A path `create`d by two cards | 0 | 0 |
| Entry points / terminals | `P4-T01`–`T03` / `P4-T25` | unchanged |
| Longest chain | 10.5 d | **11.25 d**: `T01 → T04 → T05 → T07 → T08 → T09 → T18 → T20 → T23 → T24 → T25` |
| `Open — recommended` lines | 38 | **35** (4 settled and removed, 1 narrowed to its open half, 1 added, 1 rewritten) |

Band: 23.25 × 1.4 = 32.55 → 33. Not propagated (the coordinator moves it after the owner answers).

## What was checked, and the result

1. **Deliverables and definition of done → cards.** All seven deliverables and all four
   definition-of-done lines have cards; the §0 tables are accurate. FR-25's six required topics map
   onto `docs/06` §9.1's eleven sections (`P4-T25` step 5 records it). No change.
2. **Depends/Blocks.** Symmetric and acyclic as drafted. One edge was missing: `P4-T12` creates
   `reportLabels.ts` and names `critique.ts` (`P4-T09`) as a caller, but `P4-T09` did not depend on
   it. Added (`P4-T09` depends on `P4-T12`; `P4-T12` blocks `P4-T09`); it does not move the longest
   chain.
3. **Callers and constructing files (rule 10), checked against the tree.**
   - `buildPipelineSet`'s only caller is `installServices` (`src/bootstrap/container.ts`, the
     `registerPipelines({...})` call). `P4-T18` constructs the pipeline there but did not list
     `container.ts`, so the report store, note writer, bibliography and Zotero-read ports had no
     route in. **Fixed.**
   - Every store on the plugin database (`createProvenanceStore`, `createJobStore`,
     `createUserPriceStore`) is built in `installPluginDatabase` (`src/bootstrap/pluginDatabase.ts`),
     not in `installServices`. `P4-T14` named `container.ts`. **Fixed** to `pluginDatabase.ts`.
   - `P4-T13` named `writeReportNote` in `src/zotero/notes.ts` as the caller of
     `src/pipeline/trendReport/noteHtml.ts`; `zotero/` may not import `pipeline/` (`docs/07` §2.3).
     **Fixed**: the pipeline renders and passes the HTML string.
   - `P4-T20`'s view model must start and cancel the job, raise `confirmRunCost`, save a note and
     write a file, but `ui/` may not import `zotero/` or `llm/`; the search window gets all of that
     through `publishSearchWindowHost` in `src/bootstrap/registerUI.ts`. `P4-T20` did not list
     `registerUI.ts`. **Fixed**, and `P4-T15`'s file writer now names that route.
   - Names cited in §0.1 and the cards were grepped; all exist (`writeReportNote` and
     `createReportStore` are new by design). `src/llm/shared/chunking.ts` and its test do not exist
     yet — `P3-T23` creates them, as the draft says. `test/unit/scripts/`, `test/integration/pipeline/`
     and `docs/spikes/` exist.
4. **"Done when" lines.** Three fixed: `P4-T04`'s "90–140 tokens, or the test names the field that
   pushed it out" could not fail; `P4-T09`'s "≤ 2 and ≤ 4 calls" passed with no call; `P4-T16`'s
   "the 42-paper example reproduces at its stated prices" could not pass, because the example prices
   output "at typical fill" and the card reserves at the ceiling and the band's upper K (7, not the
   example's 5). Three lines added to `P4-T18` (the 30 % boundary from both sides; resume after a
   restart; a budget pause answered "stop" saves nothing).
5. **Card size.** None too thin. `P4-T14` holds three pieces (note writer; `report` store with its
   migration; report file) — recorded on the card as a split candidate and a likely 1.5–1.75 d, not
   split, because the split is a structure choice for the coordinator.
6. **Estimates against Phase 3.** Phase 3 cards run 0.25–1.75 d (mean 0.76 d over 39); the draft
   averages 0.90 d. Two cards re-estimated where this review's own `Files` fixes added work:
   `P4-T18` 1.5 → 2.0 (composition-root wiring, resume and pause semantics, a cache-probe option;
   its analogue `P3-T29` was raised 1.0 → 1.25 for unpriced callers and has seven stages to this
   card's eleven) and `P4-T20` 1.0 → 1.25 (the window host). **Still likely under-priced, not
   re-estimated because nothing is measured yet:** `P4-T11` and `P4-T13` are in-Zotero platform
   measurements, the class that took `P3-T21` from 0.5 to 1.5 d; `P4-T13`'s recommended hand-written
   renderer covers ten constructs plus a sanitizer; `P4-T14` (above); `P4-T19`, the plugin's second
   window with its own Fluent bundle; and `P4-T06`'s output-ceiling line, if answered against its
   recommendation, puts the theme-merge call on almost every report. Together about 2–3 d, which
   would put the low end near +55 %. Recorded in plan/07 §3.
7. **Inherited Phase 3 conventions.** Budget on every call, one price source, privacy and egress,
   `cacheEpoch`, cost-dialog reuse, `G-41`, and no live calls in tests were present. Missing and
   added as §0.2 item 18 and on `P4-T18`: automatic resume after restart re-passing every spend
   guard (item 250); budget refusal pauses with the stage pending (274(c)); the 30-minute
   wall-clock pause (265(a)); "don't ask again" never skips a money-forced confirmation (274(b)); the
   stream and request time bounds (240, 268(c)); and what "stop" at a pause means for a report
   (discard synthesis, keep summaries). Also added: `P4-T16` must price up to three models in one
   run (map, report, critique) — `EstimateRunInput` takes one `modelId` today; `P4-T06`'s calls
   marked budgeted; `P4-T20`'s strings under `G-41`; `P4-T12`'s Korean labels reviewed in chat, not
   on the review page (item 284(a) replaced the page).
8. **Open lines.** Each remaining line names a decision the documents leave open or contradict, and
   each has a recommendation; the main alternative is given below for every one.

## Corrections made in plan/07 (each carries a dated "Review 2026-10-25" note)

1. Header: review note; §0 Effort, §1 table and critical path, §3 table: 23.25 d, 23.25–33 d, +41 %,
   11.25 d.
2. §0.2: item 18 (inherited job conventions) and a new open line on reasoning effort.
3. `P4-T01`: the tag line became step 4 (FR-25 and `docs/11` both name `research_helper/trend-report`;
   only `docs/07` §6.5 differs) with a grep check; the type-replacement line now keeps the audio
   fields Phase 6 reads; step 2 keeps §12.4's audio states.
4. `P4-T02`: step 2 says which rows get a `pref()` line (only `reportLanguage`, per `docs/01` §7.2 and
   `addon/prefs.js`'s header); the critique-model line said "empty = the writer's model" while
   `P4-T09` recommended `summaryModel` — now one decision, answered on `P4-T09`.
5. `P4-T03`: step 5, `THEME_CLUSTER`'s ceiling follows `P4-T06`'s line.
6. `P4-T04`: "Done when" made falsifiable.
7. `P4-T06`: open line rewritten around the output ceiling (see Theme 1, line 2); calls budgeted.
8. `P4-T08`: `report.targetWords` arrives through `ctx.config`; the `libraryCatalog` question was
   answered by grep (`catalogLabelFor` in `src/zotero/itemMapper.ts` sets it on the hand-mapped
   path); stream bounds noted.
9. `P4-T09`: new edge from `P4-T12`; "Done when" made exact; Notes record that "critique on by
   default" (`plan/05` §1.3) is settled by `report.maxCritiqueRounds` = 1.
10. `P4-T10`: the valid set is settled (analysed items; `docs/12` §12; item 281(a)). The draft's
    recommendation — a retracted item appears only in Appendix A — contradicted `docs/06` §13.3 and
    `P3-T27`'s as-built reading ("kept in the Bibliography"); the line now asks only how it appears.
11. `P4-T11`: ownership of the bibliography API is settled (`docs/06` §10.3's action item and
    `plan/05` §1.3 both name `docs/01`).
12. `P4-T12`: Korean labels reviewed in chat batches (item 284(a)); now blocks `P4-T09`.
13. `P4-T13`: caller corrected (layering).
14. `P4-T14`: constructing file corrected to `pluginDatabase.ts`; estimate risk and split candidate
    noted.
15. `P4-T15`: caller chain through the window host; the source of the bibliography entries asked as
    a question.
16. `P4-T16`: the Korean 2.0× line is settled (output is reserved at the token ceiling, which is a hard
    cap in any language, and `docs/06` §5.2 already gives Korean 7 000); three-model pricing; item
    274(b); "Done when" fixed; a conditional `costConfirm.js` row marked as a guess.
17. `P4-T17`: the `cacheEpoch` line is settled (`docs/12` §17.2's PATCH row "holds as written" by the
    owner's decision, item 273(a); §0.2 item 13 already binds it) — now step 5, correcting `docs/06`
    §11.2's table.
18. `P4-T18`: `container.ts` row; a run option that skips the synthesis-cache probes (needed by
    `P4-T24`, built by nobody); step 6; egress question answered by grep (`EgressContentScope` is
    keyed by input-scope kind, `EgressNoticeId` has three members, `EgressDisclosureInput` names one
    model); three "Done when" lines; 2.0 d.
19. `P4-T20`: `registerUI.ts` row; strings note; 1.25 d.
20. `P4-T22`: the mock also enforces the output ceiling.
21. `P4-T23`, `P4-T24`: `scripts/` files run in Node and cannot run the pipeline or bypass its
    caches; rows rewritten to name the in-Zotero half as a question (`scripts/imrad-fixtures/extract.spec.ts`
    is the precedent) and to use `P4-T18`'s option.
22. §3: a paragraph naming where the sum is still likely low. §4: the multilingual-fixture reason
    now cites `plan/04` §4 item 6, which it had contradicted silently.

## Questions for the owner — 35 open lines in four themes

Each line: the decision · **recommended** · main alternative. Card ids are for the coordinator.

### Theme 1 — How the report is put together (10 lines, 11 open lines)

1. *(P4-T03)* Large collections are grouped in batches and then merged, but no instruction text
   (prompt) exists for the merge step · **write a new merge prompt into `docs/12` first; the owner
   approves its wording** · no merge step, so batch grouping cannot work as `docs/06` §8.4 designs it.
2. *(P4-T06)* The grouping call's answer lists every paper, so it outgrows its fixed 3 000-token answer
   limit at roughly 50–80 papers (an estimate from the answer format) · **let the limit grow with the
   number of papers; split into batches only when the model's own limit or the 60 000-token input
   limit would be exceeded** · keep 3 000 and always split above about 60 papers, which puts the
   merge step of line 1 on almost every report.
3. *(P4-T05)* A theme with too few papers · **move its papers to "unclustered" (they still count in
   the coverage figures)** · merge them into the "nearest" theme, which needs a similarity rule no
   document defines.
4. *(P4-T07)* A theme too large for one call is split and the partial analyses combined, but the
   existing prompt calls its input "paper summaries" · **a second prompt for combining partial
   analyses (owner approves its wording)** · reuse the existing prompt with partial analyses under
   the "paper summaries" label.
5. *(§0.2)* How much reasoning effort the report calls ask the model for · **medium for the four
   grouping and writing calls, low for the self-check; measure how much of each answer limit the
   reasoning used on the first real runs** · send nothing and accept each provider's default.
6. *(P4-T08)* The report comes back missing a required section heading · **generate it once more with
   the problem stated; a broken citation is never "repaired" by a model, only replaced visibly** · a
   model repair pass on the Markdown, which no document defines.
7. *(P4-T09, same as P4-T02's second line)* Which model checks the draft · **the same provider; the
   critique-model setting when set, otherwise the summary model; never a model picked automatically,
   no second provider in v1** · automatically use a different provider when two keys exist (a router
   change and a second data-sharing notice).
8. *(P4-T09)* The self-check is meant to see every paper summary, which no longer fits above about
   40–60 papers · **send only the summaries of cited papers, packed to fit; if still too large, check
   section by section** · check against the short digests instead of full summaries (cheaper,
   weaker).
9. *(P4-T09)* With one review round, a rewritten draft is never checked again · **the warning banner
   lists the remaining problems and says the shipped text is an unchecked revision** · always run one
   more check after a rewrite (one more paid call).
10. *(P4-T18)* Some papers in the collection have no summary yet · **the report job summarizes them
    itself, priced in the same estimate, with one confirmation** · run a separate summarize job first
    (two confirmations), or refuse until every paper has a summary (FR-25's "Given").

### Theme 2 — What the report says, cites and discloses (9)

11. *(P4-T01)* The design document's report data shapes predate the prompts · **replace them with the
    shapes the prompts produce, keeping the storage and audio fields and dropping embedding-based
    grouping (Phase 5's)** · keep the old shapes and add the new ones beside them.
12. *(P4-T08)* Which databases the method section names for a hand-built collection · **the search
    records when any exist, else each item's catalogue field, else "not recorded"** · "not recorded"
    whenever there is no search record.
13. *(P4-T10)* How a retracted paper (excluded, never cited) appears in the reference list · **a
    separate unnumbered "Retracted — not used in this report" list after the numbered entries** · the
    exclusion appendix only, which changes `docs/06` §13.3.
14. *(P4-T09)* The warning banner points to "Appendix C", which the template does not define · **add
    "Appendix C — Unresolved review findings"** · list the findings inside the provenance appendix.
15. *(P4-T12)* Where the fixed words inside a Korean report (headings, table labels) live — they
    follow the report's language, not the menu language · **a table in code with English and Korean;
    the coordinator drafts the Korean and the owner approves it in chat** · the window's language
    file, which follows the menu language and is therefore wrong for this text.
16. *(P4-T12)* Whether the report may say a finding came from a particular part of a paper (methods,
    results) · **state only how many papers were read in full and how many by abstract; claim no
    section origin until the section detector passes its accuracy test (`P3-T22`)** · claim section
    origin whenever a summary carries it.
17. *(P4-T12)* Who ranks the "Notable Papers" table · **the model writes it; code checks it (valid
    keys, 8–15 rows) and does not re-rank** · code ranks by the summaries' citation-worthiness score
    as `docs/06` §9.1 says, and the model only writes "why it matters".
18. *(P4-T21)* How to prove a Korean report keeps titles, authors and venues in their original form ·
    **an automatic check wherever code prints them, plus the owner reading one Korean report** · try
    to detect translated titles inside the prose automatically (unreliable).
19. *(P4-T18)* What the "your data will be sent to …" notice says before a report run · **a dedicated
    report notice naming every model the run sends to** · reuse the summary notice, which understates
    what is sent.

### Theme 3 — Where the report goes and what the user sees (10)

20. *(P4-T14)* Re-running a report on the same collection · **always a new note with a dated title;
    never overwrite, no update-in-place** · update in place when the user has not edited the note
    (`docs/10` question 11's hash check).
21. *(P4-T14)* Saving into a shared group library · **allowed with write permission, after an extra
    confirmation naming the group; no new setting** · no group-library writes in v1 (export only).
22. *(P4-T15)* Which export formats ship now · **a Markdown file to a location the user picks; the
    `.html` export and "attach the file to the note" go to the backlog** · ship `.html` now as well,
    as `docs/06` D-06-10 says.
23. *(P4-T15)* Citation style in an exported file · **numbers with DOI web links, no setting** · a new
    setting offering Zotero-only links too.
24. *(P4-T13)* How the report's Markdown becomes a Zotero note · **a small converter written for the
    report's fixed set of constructs, escaping everything else** · bundle a third-party Markdown
    library (`marked` or `markdown-it`), as `docs/06` suggests.
25. *(P4-T13)* Using the Better Notes plugin's converter when it is installed · **not in Phase 4
    (backlog)** · build the optional integration now.
26. *(P4-T02)* Linking each cited paper back to the report note · **not in Phase 4 (backlog)** · build
    it now as an option that ships off.
27. *(P4-T19)* The menu wording · **"Generate Research Trends Report…" (the UI document's); correct
    FR-25** · "Write trends report…" (FR-25's).
28. *(P4-T19)* The window sketch shows per-run "Model" and "Depth" controls that no setting backs ·
    **show the report model as text (changed in Settings) and drop Depth; the length setting stays the
    length control** · add both as new settings.
29. *(P4-T20)* The live preview when the self-check rewrites the draft · **stream the first draft
    labelled "draft", then replace it with the final text** · show progress only and the final text at
    the end.

### Theme 4 — Testing, evaluation and money (5)

30. *(§0.3)* A Phase 4 spend-approval gate in the gate list · **yes, modelled on `G-21` (the first
    report spend)** · each paid card states its spend in its own gate cell only.
31. *(P4-T23)* What the evaluation set contains · **owner-written expected themes for three
    collections (about 10, 50 and 200 papers); the owner judges which produced theme matches** ·
    owner-written full "gold" reports (`docs/06` §12.3), many more hours of owner time.
32. *(P4-T23)* Running the evaluation automatically every night · **manual only in v1** · a nightly
    job, which needs an API key in the build service and spends every night.
33. *(P4-T24)* How "substantively equivalent themes across three runs" is measured · **paper-pair
    agreement of at least 0.8 between every two runs, plus the owner reading the three theme lists** ·
    the owner's reading alone.
34. *(P4-T25)* Whether the 400-paper test must be a real paid run · **the offline simulated run is the
    proof; a live run only if the owner wants one** · always a live 400-paper run (about 400 summary
    calls before the report).

*(Thirty-four numbered lines; line 7 answers two open lines, `P4-T09`'s first and `P4-T02`'s second,
so 35 in all.)*

## For the coordinator (not owner questions)

- `npm run index:derive` reads `plan/01`–`plan/04` only; plan/07 needs adding to
  `scripts/derive-task-index.ts`, a "Phase 4" table in `plan/00` §4, and a row in `plan/README.md` §2.
- After the owner's answers: propagate to the five `plan/README.md` §7 sites; reduce `plan/05` §1 to a
  pointer (`plan/05` §0); mark `docs/10` question 7 decided (built by `P3-T15`/`P3-T16`).
- If line 30 is accepted, add the gate to `plan/06` §6.
- Lines 1, 2 and 4 decide whether Phase 4 writes new prompt text; lines 2 and 1 interact (answering 2
  against its recommendation makes 1 necessary for almost every report).

## Not checked

- No command was run beyond the two checkers; no code or test changed, so typecheck and the suites
  are unaffected by this review.
- The 30–40 tokens per paper for `THEME_CLUSTER`'s answer is arithmetic over `docs/12` §8's schema,
  not a measurement; the card asks for one.
- Whether every `docs/12` schema keyword is in `SUPPORTED_ASSERTION_KEYWORDS` (`P4-T03` step 2 checks
  it).
- How `P3-T29` will expose its per-item summarize function and its Zotero reads (still a question on
  `P4-T18`); whether `addon/content/costConfirm.js` needs the report's lines (a marked guess on
  `P4-T16`).
- Phase 3 card bodies other than `P3-T23` and `P3-T29` were not re-read line by line.

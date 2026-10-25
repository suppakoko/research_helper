VERDICT
The draft is written: D:\KIST\projects\research_helper\plan\07-phase-4-trend-report.md, with "DRAFT — for review, 2026-10-25" in its header and every card in State `TODO`. It has 25 cards (P4-T01…P4-T25) adding up to 22.5 developer-days, so the band they imply is 22.5–32 d (22.5 × 1.4 = 31.5, rounded to 32). Every docs/11 §1 Phase 4 deliverable and every definition-of-done line has at least one card. I edited only that plan file; no estimate site was touched (docs/11, plan/00, plan/05, README). The draft has 38 "Open — recommended" lines, and the docs contradict each other in 27 places that the cards depend on (listed below).

FILES CHANGED WITH DECLARATION NAMES
- create plan/07-phase-4-trend-report.md. Sections: §0 phase summary, with an entry-condition status table, the deliverable→card map, the definition of done, §0.1 already-landed names, §0.2 conventions (items 11–17 added to plan/04's items 1–10) and §0.3 Phase 3 dependencies. Then §1 roll-up, §2 cards, §3 estimate reconciliation and §4 the items not carded.
- Nothing else was created or modified. The check script is in the scratchpad: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p4check.mjs

SHARED-FILE EDITS QUOTED
None.

DOC NOTES ADDED
None. Every documents-first change is written as a step or open line on the card that will make it.

NEW STRINGS
None added. P4-T16, T18, T19, T20 and T12 will add strings later and are told to quote them. P4-T12 adds report-language Korean labels, which have no home yet (see the open line).

RUNS
- A Node check script (the scratchpad file above): 25 cards, sum 22.5. Every Depends/Blocks pair matches, the §1 table matches each card, and the longest dependency chain is 10.5 d.
- npm run typecheck: exit 0.
- npm run lint:check: Prettier warnings in scripts/imrad-fixtures/extract.spec.ts and test/unit/pipeline/clean.test.ts. Both belong to the cleaning-pass agent; I did not touch them.
- npx eslint .: no output (pass).
- npm run test: unit 85 files / 3970 tests passed; contract 2 / 40 passed.
- I did not start Zotero, run a build or run the integration suite.

CARD LIST (estimate; Phase 4 dependencies; Phase 3 needs, with NOT BUILT marked)
- T01 Reconcile the trend types and state machine in docs/07 — 0.75; deps none. Phase 3: none.
- T02 Preference rows Phase 4 reads — 0.5; deps none. Phase 3: T32, T39 (built).
- T03 Synthesis prompt files and their JSON schemas — 0.75; deps none. Phase 3: T24, T12 (built).
- T04 Digest projection (no LLM) — 0.5; deps T01. Phase 3: T25 NOT BUILT.
- T05 Theme clustering with client-side validation — 0.75; deps T03, T04. Phase 3: T12, T35 (built).
- T06 Two-stage clustering and the theme-merge call — 0.75; deps T05. Phase 3: T17 (built).
- T07 Per-theme analysis with sub-batching (depth ≤ 2) — 1.0; deps T03, T05. Phase 3: T23 NOT BUILT (chunking.ts), T25 NOT BUILT.
- T08 Report composition call and structural validation — 1.25; deps T03, T04, T07, T10. Phase 3: T11, T24, T27 (built).
- T09 Self-critique pass, revision loop, warning banner — 1.0; deps T02, T08. Phase 3: T13, T15 (built).
- T10 Citation validator and marker binding — 0.75; deps T01. Phase 3: T27 (built).
- T11 Bibliography and citation nodes through Zotero — 1.25; deps T10. Phase 3: none.
- T12 Client-generated title block, tables and appendices — 1.0; deps T01, T04. Phase 3: T25 NOT BUILT, T22 NOT BUILT.
- T13 Markdown → Zotero note HTML, sanitized — 1.25; deps T10, T11. Phase 3: none.
- T14 Report note writer, report table, report file — 1.25; deps T13. Phase 3: T25 NOT BUILT (migration order), T29 NOT BUILT (notes.ts and the remove command), T33, T36 (built).
- T15 "Export as Markdown" — 0.5; deps T10, T11. Phase 3: none.
- T16 Synthesis cost estimate and the report's confirmation — 1.0; deps T03. Phase 3: T13, T16, T35 (built).
- T17 Synthesis cache keys (tc, cr, rp) — 0.5; deps T01. Phase 3: T26, T33 (built).
- T18 Trend-report pipeline: stages, passes, cancel, resume — 1.5; deps T02, T06, T09, T12, T14, T16, T17. Phase 3: T29 NOT BUILT; T15, T17, T34, T35 (built).
- T19 Report window surface, menu entry, reportWindow bundle — 1.0; deps T02. Phase 3: T29 NOT BUILT (same submenu and menu-count specs).
- T20 Report window: progress, streaming preview, delivery — 1.0; deps T15, T18, T19. Phase 3: T11, T16 (built).
- T21 Korean report path end to end — 0.75; deps T08, T12, T18.
- T22 400-item scale test on the mock provider — 0.75; deps T18. Phase 3: T06 (built), T25 NOT BUILT.
- T23 Evaluation set and regression harness — 1.25; deps T20, T21. Human gate: G-23 plus a stated spend of about $5–10. Phase 3: T31 NOT BUILT.
- T24 Determinism check across three runs — 0.75; deps T23. Human gate: spend under $3.
- T25 Phase-4 acceptance run against the definition of done — 0.75; deps T21, T22, T24. Human gate: G-18, G-24, spend under $15, and G-25 only if a group library is used. Phase 3: T31, T22 NOT BUILT.

Total 22.5 d, 3 human gates. Starting cards: T01, T02, T03. Longest chain: T01→T04→T05→T07→T08→T09→T18→T20→T23→T24→T25 = 10.5 d. It ties at T18 with T01→T10→T11→T13→T14. P3-T25 must land before that chain's second card can start.

Phase 3 IDs are not in the Depends cells. Putting them there would require matching Blocks entries in plan/04, which I may not edit. They are in §0.3's table and in each card's Notes instead. P3-T28, T30 and T37 are also unbuilt but reach Phase 4 only through P3-T31.

SUM COMPARED WITH THE SCALED 16.5–23 d
22.5 d is 36 % above the scaled low end (22.5 ÷ 16.5 = 1.36) and just under the scaled top. README §7 calls more than ~30 % a signal to re-estimate the phase in docs/11. The implied band is 22.5–32 d against 16.5–23. By work area (§3): synthesis engine 4.5, rendering/saving/export 3.0, window/progress/cost 3.0, evaluation 2.75, types/prefs/prompts 2.0, citations 2.0, and the rest under 1.25 each. The unpriced work is the same kind Phases 0–3 found: a reportWindow surface and bundle that does not exist yet, a migration with its two pinned tests, a documents-first type reconciliation, and two in-Zotero measurements (the citeproc entry point and the note-HTML whitelist). Three open lines would add work if answered against the recommendation: THEME_MERGE, CLUSTER_REDUCE_MERGE, and a second critique provider.

OPEN LINES (38)
- §0.3: plan/06 has no Phase 4 spend gate. Recommend a G-21-style entry, added by the coordinator.
- T01-a: replace docs/07 §5.2's ThemeCluster/TrendReport with the docs/12 stage shapes and docs/06 §9.1's structure. Drop the embedding methods (Phase 5).
- T01-b: the tag is research_helper/trend-report. Correct docs/07 §6.5.
- T02-a: do not add report.addRelatedLinks in Phase 4 (rule 9; send it to the plan/00 §6 backlog).
- T02-b: an empty report.critiqueModel means the writer's model, not an automatic pick.
- T03: write a THEME_MERGE prompt into docs/12 first (owner approves the new prose). Otherwise P4-T06 cannot be built as docs/06 §8.4 describes.
- T05: themes below the minimum move to unclustered ("nearest theme" is undefined).
- T06: trigger two-stage clustering on the token budget only, not on "N > ~400". 400 digests (~48k tokens) fit the 60k budget.
- T07: add a CLUSTER_REDUCE_MERGE prompt for the recursive step, because CLUSTER_REDUCE labels its input "PAPER SUMMARIES".
- T08-a: a heading failure gets one fresh generation via REVISION_NOTES. An invalid marker is never "repaired" by a model.
- T08-b: {{SOURCES}} comes from search_provenance, else libraryCatalog, else "not recorded".
- T09-a: critique runs on the active provider only, using report.critiqueModel or summaryModel. No automatic pick, no second provider in v1.
- T09-b: SELF_CRITIQUE gets only the cited summaries, packed to budget, falling back to per-section critique.
- T09-c: add "Appendix C — Unresolved review findings" to docs/06 §9.1.
- T09-d: the banner states that the shipped revision was not re-checked.
- T10: a retracted item is not a valid citation target in the prose.
- T11: docs/01 owns the confirmed citeproc API (answers docs/06 §16 item 3).
- T12-a: report-language labels live in reportLabels.ts with en and ko tables. The Korean goes through the G-41 review page.
- T12-b: claim no section-level provenance until P3-T22 records a pass.
- T12-c: the model keeps writing Notable Papers; code checks it and does not rank it.
- T13-a: a hand-rolled renderer for the closed construct set, no `marked` dependency.
- T13-b: no Better Notes converter in Phase 4.
- T14-a: re-runs always create a new note; no hash check, no update-in-place (answers docs/06 §16 item 6 and docs/10 Q11).
- T14-b: group libraries get Q12's extra confirmation naming the group; G-25 covers the first real write.
- T15-a: .md to a user-chosen path only. The .html export and the attachment variant go to the plan/00 §6 backlog (answers Q19).
- T15-b: numeric markers plus DOI links, no link-style setting.
- T16: price Korean output at 2.0× until the model is calibrated.
- T17: tc/cr/rp keys also carry cacheEpoch.
- T18-a: the report job summarizes missing items itself, through P3-T29's per-item function, with one confirmation and no child job.
- T18-b: a dedicated egress notice for derived summaries, declared in docs/07 §4.5 first.
- T19-a: the menu label is docs/08's "Generate Research Trends Report…"; correct FR-25.
- T19-b: drop the per-run Depth and Model controls from docs/08 §6.4.
- T20: stream the first draft labelled as a draft, then replace it after the critique.
- T21: the original-script check is mechanical where code renders names, plus G-24 for the prose.
- T23-a: the evaluation set is expected themes at 10/50/200 papers, matched by the owner, not gold reports.
- T23-b: manual evaluation only; no nightly job, because it would need a key in CI.
- T24: the determinism metric is pairwise co-assignment agreement ≥ 0.8 for every pair of runs, plus the owner reading the theme names.
- T25: P4-T22's enforced-window mock proves the 400-item line. A live 400-item run happens only if the owner wants it.

CONTRADICTIONS / FINDINGS
1. Report tag: docs/11 §1 and docs/10 FR-25 say `research_helper/trend-report`; docs/07 §6.5 says `research_helper/report`.
2. Menu label: FR-25 says "Write trends report…"; docs/08 §2.4 and §10.2 say "Generate Research Trends Report…".
3. Synthesis shape: docs/08 §6.1 says "single LLM call over all summaries"; docs/06 §8 specifies hierarchical levels L1–L4.
4. State machine: docs/07 §12.4 has Clustering → Labelling → Analysing ("growth/decline signals") → Composing ("per-section generation") and no critique state. docs/06 §8.5 has one report call plus a critique loop.
5. Types: docs/07 §5.2's ThemeCluster/TrendReport (label, workKeys, embedding methods, emerging/declining topics, citedWorkKeys) do not match docs/12 §8–§9's JSON (themeId, name, definition, itemKeys). Citations use item keys, not work keys.
6. Critique model: five places disagree. docs/06 §15 and docs/07 §8.5 say report.critiqueModel empty means "pick a model different from the writer". docs/12 §18.5 says it is "not a fourth model pref" and puts critique on the standard tier. docs/12 §19 item 1 says the plugin "never calls a model the user did not choose". LLMRouter is "Never a fallback to another provider". docs/09 §3 row 3b says report content goes to the "Same LLM provider".
7. Critique input: SELF_CRITIQUE takes every PaperSummary (docs/06 §8.5, docs/12 §12) but has a 60k-token budget (docs/06 §5.2) at 900–1,600 tokens per summary. It overflows above roughly 40–60 papers, while the definition of done requires 400.
8. docs/06 §12.2's banner says "See Appendix C", but §9.1 defines only Appendices A and B.
9. docs/06 §8.4 calls a theme-merge step, but docs/12 has no prompt for it.
10. CLUSTER_REDUCE recursion: docs/06 §8.4 feeds theme analyses back in, but docs/12 §9's input says full PaperSummary objects.
11. Re-runs: docs/06 §14.2 says always a new note; docs/06 §16 item 6 still asks the question; docs/10 Q11 recommends a hash-mismatch rule.
12. Export: docs/11 and Q19 say Markdown; docs/06 D-06-10 says .md and .html; docs/08 §6.3 says a Markdown attachment via importFromFile; docs/06 §14.3 uses a file picker.
13. Evaluation set: docs/11 and G-23 say expected themes; docs/06 §12.3 says gold reports at 10/50/200; docs/12 §17.6 re-scores against the rubric.
14. Notable Papers: docs/06 §9.1 implies client ranking by citationWorthiness, but docs/12 §10 has the model write the table.
15. Note HTML: docs/01 §5.7's subset has no span or div, but docs/06 §10.2 and §14.1 emit both. docs/07 §6.5's marker comment surviving setNote is unverified.
16. docs/07 §6.5 says citations are zotero://select anchors; docs/06 D-06-7 says real citation nodes for the bibliography and Notable Papers.
17. docs/08 §6.2's sample code has the window call RH.llm.streamReport with fetch/AbortController. That breaks docs/07 §2.3 ("ui/ never calls an adapter directly"), and docs/01 §8.4 records AbortController as absent in the sandbox. docs/03 §6.5 is also stale (item 268).
18. Missing summaries: FR-25 says "Given a collection whose items have summaries"; docs/07 §12.4 runs a child summarize job; docs/08 §6.1 runs Stage 2 summarize inside the report job.
19. plan/05 §1.2 and §1.4 say V-8b changes the digest's fields (W4-1), but docs/06 §8.2's digest has no section field.
20. docs/12 §10's "Failures 1–2 trigger a repair call" has no Markdown repair path; docs/12 §18.3 repairs JSON only.
21. docs/06 §11.2's tc/cr/rp table keys on the prompt version, but item 273(a) moved only `ps` to cacheEpoch.
22. docs/06 §8.4's "N > ~400" against §8.2's 24k tokens per 200 digests: a 400-item run on a 128k model never takes the two-stage path, so the definition of done does not exercise it unless the window is simulated smaller.
23. docs/08 §6.4's per-run Depth and Model controls have no preference; docs/07 §8.5 says "No other document declares a preference".
24. Report-language labels for a Korean report have no home: they are not UI strings (docs/08 §10.4), and G-41 covers only UI bundles.
25. The egress disclosure (EgressContentScope, keyed by input-scope kind) has no kind for "derived summaries", which docs/09 row 3b says the report sends. I believe this rather than verified it.
26. docs/06 §8.5 with maxCritiqueRounds 1 never critiques the rewrite.
27. Smaller items: FR-26's "[Kim 2025]" example against D-06-7's [n] anchors (compatible). FR-25's six required topics map onto the eleven sections, with limitations inside §2. docs/12 §17.3 names scripts/check-prompt-sync.mjs, which does not exist (item 239(e)).

Process findings:
- `npm run index:derive` reads only plan/01–04, so plan/07 needs adding to scripts/derive-task-index.ts and a "### Phase 4" table in plan/00 after review.
- The file number 07 breaks plan/05 §0's plan/0N-phase-N pattern, which would give 05; 05 and 06 are taken. The README §2 reading-order table needs a row.
- Q7 is effectively built by P3-T15/P3-T16 but not marked decided in docs/10.

Deliverables I could not card: none. §4 lists the items deliberately not carded and why: .html/.docx export, Better Notes, backlinks, the "grade this report" action, cache-clear UI (Phase 7 W7-4), AudioHandoff (Phase 6), the multilingual fixture, the nightly evaluation job, and the token-ratio re-measurement.

WHAT I DID NOT CHECK
- That `libraryCatalog` is set by the importer (P4-T08 asks the executing agent to verify).
- How P3-T29 will feed Zotero reads to a pipeline, and which per-item function it will expose (P4-T18 asks the agent to verify once it lands).
- Whether EgressContentScope can describe derived summaries (I believe it cannot).
- Every Zotero citeproc candidate name; P4-T11 measures them.
- The dollar figures are order-of-magnitude, using docs/06 §5.4's illustrative $3/$15 per million tokens, not live prices.
- I did not re-read P3-T16/T17/T34 card bodies line by line; I relied on names in the source.

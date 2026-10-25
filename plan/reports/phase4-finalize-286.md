## Verdict
Done, with nothing committed. All 35 open lines in plan/07 now read "Decided 2026-10-26 (owner, `plan/00` §6 item 286)". Gate G-42 is added. The estimate is in all five places that `plan/README.md` §7 names. `npm run index:derive` now builds the Phase 4 table, and docs/10 is updated. All four checks pass.

**The card sum is 23.75 d, not the expected 23.25 d.** I moved two cards up by 0.25 d each, because a decision put work in each that no card's `Files` list had covered:
- **`P4-T03`, 0.75 → 1.0 d.** The second new prompt, `CLUSTER_REDUCE_MERGE`, had been left on `P4-T07`, which named no prompt, `docs/12` or registry file. I moved its writing, owner approval and shipping into `P4-T03`, next to `THEME_MERGE`, so the owner reviews both wordings at once. The draft had already counted `THEME_MERGE` as `P4-T03`'s ("six with THEME_MERGE").
- **`P4-T16`, 1.0 → 1.25 d.** The decided report-specific egress notice had been left on `P4-T18`, whose `Files` list named neither `egressDisclosure.ts` nor any string file. I moved it to `P4-T16`, which already edits the cost dialog and both string bundles. `P4-T18` step 5 calls it.

The other decided steps (per-section critique fallback, Appendix C, the retracted-papers list, the group-library confirmation, the documents-first edits) fit inside files their cards already list, so I did not re-estimate them. The longest chain inside the phase is unchanged at 11.25 d (checked by script).

## Files changed
- `D:\KIST\projects\research_helper\plan\07-phase-4-trend-report.md`
  - "DRAFT" is gone and the header is rewritten; all 25 cards are still `TODO`.
  - 35 open lines are now decided lines; where a decision adds a step, the card's `Do` list, `Files` list and Done-when say so.
  - Gated cards cite G-42.
  - §0, §1 and §3 now give 23.75 d.
  - New §5 holds `plan/05` §1.1–§1.4, moved word for word, and references to it were updated.
- `D:\KIST\projects\research_helper\plan\06-human-gates.md`
  - New G-42 ("Approve the first real report run's cost estimate, and each paid Phase 4 run after it"), modelled on G-21. G-41 was the highest number in use.
  - G-42 row added to the start-order table.
  - G-22's pointer now goes to `plan/07` §5.1.
- `D:\KIST\projects\research_helper\plan\00-task-index.md`
  - §1: Phase 4 row added, the 4–7 row becomes a 5–7 row, plus a dated note.
  - §3: Phase 4 entry points and terminal.
  - §4: Phase 4 heading and table.
  - §6: "DONE" note on item 286; new §6.61 item 287 with the five Phase 4 backlog items (a)–(e) that the decisions send there.
  - §7: a note that the script now reads plan/07.
- `D:\KIST\projects\research_helper\plan\05-phases-4-7-outline.md`
  - §1 reduced to a pointer to plan/07.
  - Dated notes in the header and in §5.1.
- `D:\KIST\projects\research_helper\plan\README.md`
  - plan/07 row added to the §2 reading-order table; plan/05's row now says Phases 5–7.
  - Dated notes in §2 and §7.
- `D:\KIST\projects\research_helper\docs\11-implementation-roadmap.md`
  - Preamble, factor paragraph, whole-plan sum and months.
  - Phase 4 Effort paragraph and two dated definition-of-done clauses.
  - Effort table, subtotal and total prose, the 15% buffer, the mermaid node.
  - §2's graph reading, critical path, route through Phase 3, Phase 5 float, measured/inferred split.
  - R-23, the risk-to-phase mapping, and the §5 decision row.
- `D:\KIST\projects\research_helper\docs\10-requirements-and-user-stories.md`
  - Questions 7, 11, 12 and 19 struck through and marked decided, with dated notes.
- `D:\KIST\projects\research_helper\scripts\derive-task-index.ts`
  - plan/07 added to the list of files read.
  - Phase 4 header count added.
  - Original-decomposition count changed from 98 to 98 + 25, so the header does not call a whole new phase "growth".
  - The header growth sentence is now matched with a regex that keeps its wording in brackets.
  - Local date instead of UTC (see Findings).

## Estimate arithmetic, before → after
- **plan/07 card sum:** 22.5 + 0.5 (`P4-T18`) + 0.25 (`P4-T20`) = 23.25, then + 0.25 (`P4-T03`) + 0.25 (`P4-T16`) = **23.75**.
  - Band: 23.75 × 1.4 = 33.25 → **33**, so 23.75–33 (was 23.25–33).
  - Against the scaled low end: 23.75 ÷ 16.5 = 1.44 → **+44%** (was +41%).
  - By work area: types/prefs/prompts 2.0 → 2.25; dialog/progress/cost 3.25 → 3.5.
- **docs/11 §1 Phase 4 row:** 16.5–23 scaled → **23.75–33, measured, 25 cards**.
- **Phases 4–7 subtotal:** 73.5–102 → 23.75 + 21 + 15 + 21 = **80.75**, and 33 + 29 + 21 + 29 = **112**.
- **Whole plan:** 183.25–256 → 109.75 + 80.75 = **190.50**, and 154 + 112 = **266**.
- **Months at 21 working days:** 9–12 → **9–13** (190.5 ÷ 21 ≈ 9.1; 266 ÷ 21 ≈ 12.7).
- **15% buffer:** 27–38 → **29–40** (190.5 × 0.15 ≈ 28.6; 266 × 0.15 ≈ 39.9).
- **Mermaid node:** "16.5-23 d (scaled)" → "23.75-33 d (measured)".
- **Critical path P0 → P1 → P2 → P4 → P6 → P7:** 132.75–186 →
  - 17.75 + 29.25 + 33.25 + 23.75 + 15 + 21 = **140.00**
  - 25 + 41 + 47 + 33 + 21 + 29 = **196**
- **Route through Phase 3:** 129.00–180 → 17.75 + 29.25 + 29.5 + 23.75 + 15 + 21 = **136.25**, high end **190**. The margin stays 3.75 d / 6 d, because Phase 4 is on both routes.
- **Phase 5 float:**
  - Main route into Phase 5 (122.25–171): 10.5–15 → 140 − 122.25 = **17.75**, and 196 − 171 = **25**. It grows by exactly Phase 4's rise, the first change that does not cancel out.
  - Route through Phase 3 (118.5–165): 14.25–21 → **21.5–31**.
- **Measured/inferred split of the critical path:** was 80.25 measured + 52.5 inferred → now 104.00 measured (17.75 + 29.25 + 33.25 + 23.75) + 36 inferred (Phases 6 and 7: 15 + 21).
- **plan/00 §1:**
  - New row "4 — Trend report | 25 | 23.75 d | 23.75–33 d | 8–11 d (+116%)", using the table's rule of card sum against the top of the old band: 23.75 ÷ 11 = 2.16.
  - The 4–7 row (73.5–102, old band 35–49) becomes "5–7 | 57–79 d" (21 + 15 + 21; 29 + 21 + 29), old band 27–38.
  - The Phases 0–3 row is unchanged.
- **plan/05 §1:** now a pointer quoting 23.75–33, measured.

## Runs
- `npm run index:derive`:
  - First run: Phase 4 went from 0 rows to 25 (0 DONE); header reads 182 tasks, 112 DONE, 70 TODO, Phase 4 0 of 25, "grown from the 123 cards … to 182, so 59".
  - Run twice after the last edit: the files were byte-identical (`cmp` matched).
- `npm run typecheck`: exit 0.
- `npm run lint:check` (eslint plus prettier): exit 0.
- `npx eslint .`: exit 0.
- `npm run test`: unit 86 files / 4013 tests passed; contract 2 files / 40 tests passed.
- An independent checker script on plan/07 found:
  - 25 cards summing to 23.75, matching the roll-up table's titles, estimates and gates.
  - No mismatched Depends/Blocks pairs, no cycles, no path created by two cards.
  - Entry points `P4-T01` to `P4-T03`; terminal `P4-T25`.
  - 35 decided lines, no open lines left.
  - All three gated cards name G-42.

## Findings
1. **Date bug fixed in the script.** It stamped "Last updated" with the UTC date, so before 09:00 in Korea it wrote yesterday. On this run it wrote 2026-10-25. It now uses the local date.
2. **Edits beyond the five listed tasks, so the documents hold the decisions before any card runs:**
   - In docs/10, FR-25's menu wording and its "Given" (missing summaries are made inside the same run).
   - In docs/11 §1, the two definition-of-done clauses: the 400-item line is proved offline, and the 0.8 pair-agreement measure.
   - Design-document changes (docs/06, 07, 08, 12) are left to the cards as documents-first steps.
3. **Moving `plan/05` §1.1–§1.4 into plan/07 §5:** without it, the work-area names `W4-1`–`W4-10` cited in G-22, G-24, `plan/05` §5.1 and plan/07 §3 would have pointed at nothing.
4. **Correction factor not changed.** Phase 4 measured 2.16 times its old top against the 1.50 still applied to Phases 5–7. I noted this in docs/11 and left it as an owner decision.
5. **Left alone:**
   - docs/11's "3–7 major Zotero versions" count, now that the span is 9–13 months (flagged in the text).
   - docs/13 §8.5's 400-item QA line.
6. **Phase 3 shows 0 of 39 done in plan/00,** because no Phase 3 card's State row reads `DONE`, even though many are built. Only the owner sets DONE, so I did not touch it.
7. **Estimate risk still open:** plan/07 §3 still names four places where the sum is likely low, by 2–3 d together. The fifth (the output-ceiling line) fell away when it was decided as recommended.

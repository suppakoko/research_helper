# P4-T23-repricing — report of the executing agent (saved verbatim, 2026-11-02)

`P4-T23` is re-priced 1.25 → 1.75 d under `plan/00` §6 item 336(d), in the five places `plan/README.md` §7 names plus `plan/05`, `plan/06` `G-03` and `plan/08`, and all your stated figures matched my computation. The notes say the extra 0.5 d is the per-call usage capture of item 335(k), by judgement after the fact and unmeasured, and the earlier 335(g) notes stay visible beside the new dated ones. The 25 card `Estimate` rows, `plan/07` §1 and §3, and `plan/00` §4 each sum to 25.75. `index:derive`, run with `OPENROUTER_API_KEY` removed, changed one line, the `P4-T23` row in `plan/00` §4. `plan/00` §6 has the same checksum before my edits and after the derive. I did not touch `src/`, `test/`, the build or commits, and did not edit docs/05, docs/07 or docs/08. Each edit re-read its file and required exactly one match, and all matched. There are two results you did not list: the contingency top moves, and `plan/07` has a phase-internal path that moved.

**Old → new figures**
- **Phase 4:** card sum 25.25 → 25.75 and band 25.25–35 → 25.75–36 (25.75 × 1.4 = 36.05 → 36).
- **W4-10:** 4.25 → 4.75.
- **`plan/00` §1 column:** +130% → +134% (25.75 ÷ 11 = 2.34).
- **Against scaled 16.5:** +53 % → +56 % (1.56).
- **Against scaled top 23:** 10 % → 12 % (1.12).
- **Phases 4–7 subtotal:** 97.00–135 → 97.50–136.
- **Plan total:** 206.75–289 → 207.25–290.
- **Months:** 9.8 and 13.8 → 9.9 and 13.8 (your 9.87 and 13.81 at the document's one decimal), band still 10–14.
- **Contingency:** 31–43 → **31–44 d**. 207.25 × 0.15 ≈ 31.1, and 290 × 0.15 = 43.5, an exact half, which rounds up under `plan/README.md` §7's rule. The old band stays struck through.
- **Critical path:** 141.50–198 → 142.00–199.
- **Measured part of the path:** 105.50 → 106.00, plus 36 inferred.
- **Phase 3 route to P7:** 137.75–192 → 138.25–193, margin still 3.75 d and 6 d.
- **Phase 5 float:** binding route stays 137.00–192; 142.00 − 137.00 = 5 d and 199 − 192 = 7 d (was 4.5–6 d). "About 4.5 d more Phase 5 cards" now reads 5 d.
- **Route into P5 through Phase 3:** stays 133.25–186; float 8.25–12 d → 8.75–13 d.
- **`plan/07` §1 critical path inside the phase:** 11.25 → **11.75 d**, because `P4-T23` lies on it. A script over the cards' dependencies confirms it. The first re-pricing did not move it, because the route through `P4-T22` ends at 10.25 d, and the note says so.
- **`plan/07` §3 note:** the unmeasured 2–3 d against 25.75 would put the low end near +68 % to +74 %.
- **Files changed:**
  - `plan/07-phase-4-trend-report.md`: header, §0, §1, card, §3
  - `docs/11-implementation-roadmap.md`: top summary, §1, §2 including the mermaid node, §5's float quote
  - `plan/00-task-index.md` §1: row and new dated paragraph
  - `plan/05-phases-4-7-outline.md`: §1 pointer and header note
  - `plan/06-human-gates.md`: `G-03`'s note, 4.5–6 d → 5–7 d
  - `plan/08-phase-5-related-papers.md`: float line, 4.5–6 d → 5–7 d

**Mismatches:** none in your figures. You listed the two flagged sites as already reading 4.5–6 d, and they did, so someone changed them after my first report.

**Left undone, on purpose**
- **Dated history:** the 335(g) notes, `plan/README.md` §7's 2026-10-26 note, R-23, `docs/11` §5's Phase 4 entry and the "+65 % to +71 %" inside the earlier `plan/07` note.
- **Records:** `plan/reports/`, including `P4-T22-repricing.md`, and all of `plan/00` §6.
- **Older stale figures, outside this job:** R-1's "≈ 23–32 d" and R-21's "≈ 8–11 months" in `docs/11` §3 were already out of date.

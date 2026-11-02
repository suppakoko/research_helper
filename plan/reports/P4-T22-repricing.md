# P4-T22-repricing — report of the executing agent (saved verbatim, 2026-11-02)

`P4-T22` is re-priced 0.75 → 2.25 d in all five places `plan/README.md` §7 names, plus `plan/05`, and every figure in the brief matched what I computed. After the edits, the 25 card `Estimate` rows, `plan/07` §1 and §3, and `plan/00` §4 each sum to 25.25. `plan/00` §6 has the same checksum before my edits and after `index:derive`, and item 335(g) was already written there. `index:derive` ran with `OPENROUTER_API_KEY` removed and changed one line, the `P4-T22` row in `plan/00` §4 (0.75 d → 2.25 d). I made no build, test, Zotero, `src/`, `test/` or commit action, and did not edit docs/05, docs/07 or docs/08. I applied the edits with a script in the scratchpad instead of the Edit tool: it re-reads the file before each edit and requires exactly one match.

**Figures by file**
- **`plan/07-phase-4-trend-report.md`**
  - Card `Estimate` 0.75 d → 2.25 d, with a dated note in the card saying both 0.75 figures are unmeasured judgement and `P4-T21` is unchanged.
  - §1 row 0.75 → 2.25 and total 23.75 → 25.25.
  - Header block 23.75 → 25.25.
  - §0 Effort 23.75–33 → 25.25–35, and +44 % → +53 %.
  - §3 prose 23.75–33 → 25.25–35, 44 % → 53 %, and 3 % → 10 % (25.25 ÷ 23 = 1.10).
  - W4-10 2.75 → 4.25 and §3 total 23.75 → 25.25.
  - New dated paragraph in §3.
- **`docs/11-implementation-roadmap.md`**
  - Top summary 205.25–287 → 206.75–289.
  - Table: Phase 4 23.75–33 → 25.25–35, Phases 4–7 subtotal 95.50–133 → 97.00–135, Total 205.25–287 → 206.75–289.
  - Months 9.8 and 13.7 → 9.8 and 13.8, band still 10–14.
  - 15 % contingency 30.8 and 43.1 → 31.0 and 43.4, still 31–43.
  - Mermaid node P4 → 25.25-35 d.
  - Phase 4 Effort paragraph → 25.25–35, 44 % → 53 %, 3 % → 10 %.
  - Critical path 140.00–196 → 141.50–198.
  - Measured part of the path 104.00 → 105.50.
  - Route through Phase 3 136.25–190 → 137.75–192, margin still 3.75 d and 6 d.
  - Single-developer sentence → 206.75–289.
  - §5's float quote 3–4 d → 4.5–6 d.
- **`plan/00-task-index.md` §1**
  - Row 23.75 d, 23.75–33 d, +116% → 25.25 d, 25.25–35 d, +130%.
  - New dated paragraph with the full working.
  - §4 row changed by `index:derive`.
- **`plan/05-phases-4-7-outline.md`**
  - §1 pointer 23.75–33 → 25.25–35, with its working, plus a note in the header.

**Float working (`docs/11` §2)**
- Phase 5's binding route P0 → P1 → P2 → P5 → P7 stays 137.00–192 because Phase 4 is not on it.
- Float: 141.50 − 137.00 = 4.5 d low and 198 − 192 = 6 d high (was 3–4 d).
- That is a rise of exactly 1.5 d and 2 d. "About 3 d more Phase 5 cards" now reads 4.5 d.
- Route through Phase 3, P0 → P1 → P3 → P5 → P7, stays 133.25–186, so its float is 8.25 d to 12 d (was 6.75 d to 10 d).

**Figures added beyond the brief's list:** the Phases 4–7 subtotal, the 15 % contingency, the measured part of the path, the Phase 3 route, the 10 % against the scaled top, and §5's float quote. All follow from the same re-pricing.

**Mismatch:** only a location. The mermaid node is in `docs/11` §2, not §1 as the brief and `plan/README.md` §7 say.

**Not done, for the coordinator to decide**
- **Now stale, outside the brief's list:** `plan/06-human-gates.md` (the `G-03` note says "now ≈ 3–4 d") and `plan/08-phase-5-related-papers.md` ("3–4 d since 2026-11-02") still give the old float. Both should read 4.5–6 d.
- **Left as dated history:**
  - `plan/README.md` §7's 2026-10-26 note.
  - `docs/11`'s R-23 and its §5 Phase 4 entry, including the owner's acceptance of 23.75 d.
  - `plan/07` §3's "+56 % to +62 %" (the new paragraph gives +65 % to +71 % against 25.25).
  - Everything in `plan/00` §6.
- **Reports:** `plan/reports/` is unchanged.

BOOKKEEPING PASS, 2026-10-20 (research_helper plan)

Files edited (only these): plan/00-task-index.md, plan/README.md, plan/03-phase-2-multi-source-dedup.md (the "Effort estimate" paragraph and the "Estimate roll-up" table only), plan/04-phase-3-llm-summaries.md (the Effort paragraph and §3 only), docs/11-implementation-roadmap.md, and docs/06-summarization-and-trend-report.md (§5.4 and §11.4 only). I did not touch src/, test/, addon/ or scripts/. I ran no tests and did not start Zotero. I committed nothing.

How the figures were checked: a scratch script read every card's Estimate, State, Depends on, Blocks and Human gate rows the same way scripts/derive-task-index.ts reads them. A second script compared each phase file's summary table with its card bodies (estimate, gate and title) and found 0 differences in Phase 2 and 0 in Phase 3. I also summed the regenerated §4 tables in plan/00 per phase, and they match the card sums.

1. NEW PHASE SUMS AND BANDS
- Phase 2: 37 cards, 33.25 d. High end 33.25 × 1.4 = 46.55, rounded to 47. Published band 33.25–47 (was 32.75–46 over 36 cards).
- Phase 3: 37 cards, 27.5 d. High end 27.5 × 1.4 = 38.5, rounded up to 39. Published band 27.5–39 (was 23.5–33 over 31 cards). Rounding a half up follows the precedent of Phase 2's 27.50 → 39 on 2026-10-07. Gated cards: 8.
- Percentage column in plan/00 §1 (the card sum against the top of the superseded band): Phase 2 is 33.25 ÷ 16, so +108% (was +105%). Phase 3 is 27.5 ÷ 15, so +83% (was +57%). Phases 0–3 is 107.75 ÷ 52, so +107% (was +99%).
- The ×1.50 factor history now continues to 107.25 ÷ 52 = 2.063 (Phase 3 re-carding) and 107.75 ÷ 52 = 2.072 (P2-T37). The factor stays held at 1.50.

2. PLAN-WIDE TOTAL AND CRITICAL PATH
- Phases 0–3: before 103.25–145 d over 148 cards; after 107.75–152 d over 155 cards. The high end is the sum of the rounded phase tops (25 + 41 + 47 + 39), which is how docs/11 builds it. Multiplying the subtotal instead (107.75 × 1.4 = 150.85) would give 151.
- Project total: before 176.75–247 d; after 181.25–254 d.
- Months at 21 working days: before ≈ 8–11 in the docs/11 preamble but ≈ 8–12 in §1; after ≈ 9–12 in both (181.25 ÷ 21 ≈ 8.6, 254 ÷ 21 ≈ 12.1, each rounded to the nearest month).
- Critical path P0 → P1 → P2 → P4 → P6 → P7: before 132.25–185; after 132.75–186. Phase 2 still sets the path.
- The Phase 3 route is now 127.00–178. Phase 2 leads it by 5.75 d at the low end and 8 d at the high end. That lead was 9.25 / 13 d this morning, and docs/11 still quoted the 2026-09-09 figure of 0.75 / 1 d.
- Phase 5 float through Phase 2: 10.5–15 d, unchanged; the route is 122.25–171 (was 121.75–170).
- Phase 5 float through the Phase 3 route: 16.25–23 d (route 116.50–163).

3. SENTENCES CHANGED, BY SITE (old figure → new figure)

Site 1, the phase files:
- plan/03 "Effort estimate": "26.75–37.45 d, published as 26.75–37 d" → "33.25–46.55 d, published as 33.25–47 d (37 cards; P2-T37 added 2026-10-20)". A dated correction note under it records that the sentence had been stale since 2026-10-06: twelve cards, P2-T25 to P2-T36 (6.0 d), never reached it.
- plan/03 roll-up: new row P2-T37 0.50. Total "36 tasks, 32.75 d" → "37 tasks, 33.25 d".
- plan/04 Effort paragraph: "27.5–38.5 d (the coordinator applies the whole-day rounding)" → "27.5–39 d". The previous figure is now given as 23.5–33 d over 31 cards, and the paragraph records that propagation is done.
- plan/04 §3: "band to publish 27.5–38.5 (× 1.4)" → "band, published 2026-10-20: 27.5–39 (27.5 × 1.4 = 38.5 → 39)". Added "Done 2026-10-20" to the "Propagation is the coordinator's" paragraph.

Site 2, docs/11 §1 table:
- Phase 2 row: 32.75–46, 36 cards → 33.25–47, 37 cards.
- Phase 3 row: 23.5–33, 31 cards → 27.5–39, 37 cards.
- Phases 0–3 subtotal: 103.25–145, 148 cards → 107.75–152, 155 cards.
- Total: 176.75–247 → 181.25–254.

Site 3, docs/11 prose and diagram:
- Preamble factor history: appended 107.25 ÷ 52 = 2.063 and 107.75 ÷ 52 = 2.072.
- Preamble total and months: "176.75–247 … ≈ 8–11 months (176.75 ÷ 21 ≈ 8.4; 247 ÷ 21 ≈ 11.8)" → "181.25–254 … ≈ 9–12 months (≈ 8.6; ≈ 12.1)". Marked Corrected, because §1 had already rounded 11.8 up to 12 while the preamble said 11.
- §1 subtotal arithmetic: "17.75 + 29.25 + 32.75 + 23.5 = 103.25 … 25 + 41 + 46 + 33 = 145 … 176.75–247" → "… 33.25 + 27.5 = 107.75 … 25 + 41 + 47 + 39 = 152 … 181.25–254".
- §1: the sentence "Phase 3's figure is now slightly overstated … P3-T04 left at 1.75 d" is struck through and marked Corrected: P3-T04 is now 1.0 d.
- §1 history list: appended Phase 2 32.75 → 33.25 (high end 46 → 47) and Phase 3 23.5 → 27.5 (high end 33 → 39).
- §1 months paragraph: "≈ 8–12 months (176.75 ÷ 21 …)" → "≈ 9–12 months (181.25 ÷ 21 ≈ 8.6; 254 ÷ 21 ≈ 12.1)".
- §1 compatibility allowance: "~15% ≈ 23–32 developer-days … 8–11-month span" → "≈ 27–38 (181.25 × 0.15 ≈ 27.2; 254 × 0.15 ≈ 38.1) … 9–12-month span". Marked Corrected, because 23–32 was 15% of the 2026-09-09 total and had never moved.
- Diagram nodes: P2 "32.75-46 d" → "33.25-47 d"; P3 "23.5-33 d" → "27.5-39 d".

Site 4, docs/11 per-phase Effort paragraphs and §2:
- Phase 2 Effort: "32.75–46 … 36 cards … 32.75 × 1.4 = 45.85 → 46" → "33.25–47 … 37 cards … 33.25 × 1.4 = 46.55 → 47". The old figure moved into the "Was" list.
- Phase 3 Effort: "23.5–33 … 31 cards … 23.5 × 1.4 = 32.9 → 33" → "27.5–39 … 37 cards … 38.5 → 39". Added a dated re-carding sentence: 23.5 − 2.0 + 2.25 + 3.75 = 27.5. Two figures marked Corrected: secret storage "3.75 d across four cards" → 2.5 d across five cards; text acquisition 1.5 d → 1.25 d.
- §2 "Reading the graph": the margin "0.75 d / 1 d" is marked Corrected → 5.75 d / 8 d (it was 9.25 / 13 this morning). I left the colour classes as drawn.
- Critical path heading and low/high bullet: 132.25–185 → 132.75–186. The arithmetic is updated and the recomputation is dated.
- Second critical-path bullet: "Phase 3 route ≈ 110.25–154 against 111–155" is marked as the 2026-09-09 figure → 127.00–178 against 132.75–186.
- Phase 5 float bullet: route 121.75–170 → 122.25–171 against 132.75–186; float stays 10.5–15. "Twenty-two re-derivations" → "twenty-three", and the list of absolute figures was extended.
- Phase 5 float through the Phase 3 route: "112.50 and 157, float 14.5–21 d" → "116.50 and 163, float 16.25–23 d". Marked Corrected, because before today's change that float was already 19.75–28, not 14.5–21.
- "Single-developer … 176.75–247-day plan" → "181.25–254".
- "≈ 58.5 d measured (P0 + P1 + P2)" → "≈ 80.25 d". Marked Corrected: 58.5 was the 2026-09-09 figure.

Site 5, plan/00 §1:
- Table rows, including the percentage column, as in section 1 above.
- New dated paragraph "2026-10-20: Phase 3 re-carded and P2-T37 added" with the sums, bands, total and critical path.

Other edits:
- plan/00 §3: the Phase 3 entry points were "P3-T01, P3-T18, P3-T24" and are corrected to P3-T01, P3-T05, P3-T24, P3-T32, P3-T36. P3-T18 now depends on P3-T32. The Phase 3 terminal is still P3-T31.
- plan/00 §6 dated DECIDED lines:
  - Item 105: retired by P2-T37.
  - Item 235: fix now, as P2-T37 (0.5 d, ungated, depends on P2-T36, blocks P2-T16). The heading of §6.46 is updated to match.
  - Item 236(e): remove continue-on-error and pin Zotero 10.0.3 once P2-T37 makes the integration suite green. Not yet done; the coordinator does it after P2-T37 lands.
  - Item 234(c), restated: pause and ask, with a note that it is written into docs/06.
  - Item 234(d), G-12: 57 candidates and 20 reserves; the coordinator recommends 40 on a page and the owner confirms there; bioRxiv licences confirmed only through api.biorxiv.org are accepted; each licence is re-checked on the PDF's first page at download; every download is asked for separately.
- docs/06 §5.4: added a note headed "Decided 2026-10-20 (owner; plan/00 §6 item 234)". It says the run pauses at the ceiling, shows the amount spent, asks whether to continue, and keeps the summaries already made. The note covers both ceilings and both moments a ceiling can be reached. The sentence "the run refuses rather than prompting" is struck through and marked "Corrected 2026-10-20".
- docs/06 §11.4: both "abort" sentences (the per-run cap and the per-session cap) are struck through and marked "Corrected 2026-10-20" with pause-and-ask wording. Nothing was deleted.
- plan/README.md:
  - §7 item 4 corrected (dated): it said "docs/11 §2's per-phase Effort paragraph", but those paragraphs are in docs/11 §1. The item now also names the P2-versus-P3 margin.
  - §7 has a dated sentence on rounding: a half rounds up, and the subtotal's high end is the sum of the rounded phase tops.
  - The header said "Last updated 2026-09-09 · no code written yet". It now points to plan/00's header for live counts, marked Corrected.

4. INDEX:DERIVE OUTPUT
The script exited 0 and no pattern failed. It printed:
  P0: 35 row(s) -> 35 (34 DONE)
  P1: 46 row(s) -> 46 (44 DONE)
  P2: 36 row(s) -> 37 (34 DONE)
  P3: 31 row(s) -> 37 (0 DONE)
  header: 155 tasks, 112 DONE, 43 TODO
The header now reads "155 tasks: 112 DONE, 43 TODO … Phase 2 34 of 37, Phase 3 0 of 37 … grown from 98 to 155, so 57". A second run changed nothing. The regenerated §4 tables sum to 17.75 / 29.25 / 33.25 / 27.5 d, with 9 / 5 / 3 / 8 gated cards.

5. EDGE CHECK (both directions, all 155 cards)
P2-T37's edges are consistent: P2-T36 blocks it, it depends on P2-T36, and it blocks P2-T16, which depends on it. Phase 3 has no mismatches. Five older mismatches remain, all in Phase 2 cards that are DONE. They are in card bodies, which were outside what I could edit, so I left them:
- P2-T27 blocks P2-T14, but P2-T14 does not depend on P2-T27.
- P2-T27 blocks P2-T16, but P2-T16 does not depend on P2-T27.
- P2-T27 depends on P2-T01, but P2-T01 does not list P2-T27 under Blocks.
- P2-T32 blocks P2-T14, but P2-T14 does not depend on P2-T32.
- P2-T32 blocks P2-T16, but P2-T16 does not depend on P2-T32.

6. INCONSISTENCIES FOUND AND LEFT ALONE
- plan/reports/G-12-candidates/coordinator.md still says "NOT FINISHED, 0 candidates". The five group files hold 57 candidates (12 + 12 + 3 + 14 + 16), which matches the figure you gave. plan/06-human-gates.md G-12 does not record today's decision; that file was outside my list.
- docs/11 §3 R-21 still says "≈ 8–11 months". R-23 still quotes "118 task cards … +97%, +90%, +59%, +57%, +72%". Neither is one of the five sites.
- docs/11 Phase 3 Deliverables still promise the passphrase tier (tier 2), which gate G-10 dropped. This is open line 1 on P3-T03, not yet decided.
- With a 5.75–8 d lead, whether Phase 2 and Phase 3 should still be drawn as jointly critical (both red in the docs/11 diagram) is your call. I left the colours as they are.
- plan/00 §3 omits the DONE entry points P1-T41, P1-T42 and P1-T44 and several terminals. I fixed the Phase 3 entry points only.
- plan/03's header still reads "Last updated 2026-09-09 · no code written yet". It sits outside the roll-up and summary figures.
- Card P2-T37 has no Notes field, which plan/README §4's template requires. It also has two "---" separators before the roll-up.
- docs/11's "Why these figures changed" section and plan/00 §1 and §7's dated history paragraphs keep their old present-tense figures. I treated them as dated records and left them.

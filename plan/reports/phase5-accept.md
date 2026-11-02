# Phase 5 plan acceptance — report of the plan-only agent (saved verbatim, 2026-11-02)

Resumed after the session break. plan/08, plan/00 and `scripts/derive-task-index.ts` were re-read first: plan/08's header through §1 in full, plan/00's header, Phase 5 table and the end of §6, and the script's diff. Nothing had been lost. Decisions keep 2026-11-01. Notes about work finished today, and the plan's acceptance, say 2026-11-02; that includes 34 notes written yesterday that claimed document edits not yet made. Nothing was committed, and no item was added to plan/00 §6.

**VERDICT**
- `plan/08-phase-5-related-papers.md` is accepted, plan of record since 2026-11-02.
- **31 cards, 35.75 developer-days, band 35.75–50 d** (35.75 × 1.4 = 50.05 → 50). 3 gated cards: `P5-T29`, `P5-T30`, `P5-T31`.
- **Longest chain in Phase 5: 15.0 d:** `P5-T01` → `P5-T03` → `P5-T18` → `P5-T21` → `P5-T23` → `P5-T24` → `P5-T25` → `P5-T26` → `P5-T27` → `P5-T28` → `P5-T30`.
- **Against the review's 34.0 d over 30 cards:** +1.75 d and one card. The low end is 70 % above the scaled 21 d (it was 62 %) and 2.55× the old top of 14 d.
- **Whole-plan critical path:** unchanged at 140.00–196 d.
- **Phase 5's float:** falls from 17.75–25 d to **3–4 d**.

**DECISIONS APPLIED** (line numbers are the review's; plan/08 §0.4 has all 36)

Owner:
| Line | Item | Where |
|---|---|---|
| 1 | 320(a) | `P5-T28`, `P5-T16` |
| 2 | 320(a) | §0.2 item 19, `P5-T11`, `P5-T12`, `P5-T23`, `P5-T25` |
| 3 | 320(b) | `P5-T20`, `P5-T14` |
| 4 | 320(c) | `P5-T22`, §4 |
| 5 | 320(d) | `P5-T22`, §0.2 item 26 |
| 6 | 321(a) | `P5-T30`, plan/06 `G-43` |
| 8 | 323(a) | `P5-T23`, `P5-T26`, §0.2 item 26 |
| 10 | 321(b) | `P5-T15` |
| 11 | 321(c) | `P5-T12`, §4 |
| 26 | 321(d) | `P5-T23` |
| 28 | 323(d) | §4 |
| 29 | 323(b) | §0.2 item 27, `P5-T03`, `P5-T25`, §4 |
| 33 | 323(c) | `P5-T04`, new `P5-T31` |

Coordinator, under item 313:
| Line | Where | Line | Where |
|---|---|---|---|
| 7 | `P5-T22`, `P5-T30` | 21 | `P5-T01`, `P5-T25` |
| 9 | `P5-T11` | 22 | `P5-T25` |
| 12 | `P5-T12`, `P5-T16`, §4 | 23 | `P5-T01`, `P5-T24` |
| 13 | `P5-T16` | 24 | `P5-T24`, `P5-T27` |
| 14 | `P5-T02` | 25 | `P5-T27` |
| 15 | `P5-T17` | 27 | `P5-T23` |
| 16 | `P5-T17` | 30 | `P5-T01`, docs/07 §4.2 |
| 17 | `P5-T01` | 31 | `P5-T03` |
| 18 | `P5-T08`, docs/07 §4.2 | 32 | `P5-T04`–`P5-T09` |
| 19 | `P5-T26` | 34 | `P5-T29` |
| 20 | `P5-T25`, `P5-T26` | 35 | `P5-T02` |
| | | 36 | `P5-T22` |

The three lines the review found settled by the documents now read "Settled by the documents": `P5-T03`, `P5-T10`, `P5-T24`.

Review gaps, now real steps with Done-when lines:
- **FR-44 two-phase run:** `P5-T25` steps 1–2, `P5-T26` step 3.
- **Metadata fill-in and candidate-vector fetch:** `P5-T25` step 3. The related pipeline's vector fetch is `P5-T14` step 2.
- **Generation per topic group:** `P5-T23` step 2.
- **`dateAdded` on the item mapper:** `P5-T18` step 1.
- **Keyless exclusion of Semantic Scholar:** `P5-T23` step 3 (keyword generator); `P5-T12` step 4 and `P5-T25` step 3 (abstract fill-in).

Item 323(b) also removed `"accepted"` from the recommendation store and from `P5-T25`.

**CARDS RE-PRICED**
| Card | Before → after | Reason |
|---|---|---|
| `P5-T03` | 1.0 → 1.5 | review's likely 1.25, plus 0.25 for line 31 |
| `P5-T04` | 1.0 → 1.75 | +0.25 keyed recording path, +0.5 for the five request builders; retitled "Request builders and the relatedness fixtures" |
| `P5-T05` | 1.0 → 0.75 | line 32's offset |
| `P5-T14` | 1.5 → 1.75 | review's likely figure |
| `P5-T18` | 1.25 → 1.5 | item-mapper change and its test; my pricing, not the review's |
| `P5-T31` | new, 0.25 | agent's half of the owner's recording; my addition |

Sum: 34.0 + 0.5 + 0.75 − 0.25 + 0.25 + 0.25 + 0.25 = 35.75.

Deliberately not re-priced: `P5-T12`, `P5-T22`, `P5-T26`, and `P5-T28`, whose two document rows moved out. Lowering a card whose scope shrank is the owner's call.

**FILES CHANGED**

The five estimate sites, before → after:
1. **plan/08 roll-up and Effort prose:** `| | **Total** | **34.0** | 2 gates |` → `**35.75** | 3 gates`; "34.0 developer-days over 30 cards … 34–48 d" → "35.75 developer-days over 31 cards … 35.75–50 d".
2. **docs/11 §1 table:**
   - `| 5 | … | 21–29 | ⚠ scaled ×1.50 |` → `| 5 | … | 35.75–50 | measured — 31 cards |`
   - Phases 4–7 subtotal 80.75–112 → 95.50–133; Phases 0–3 unchanged
   - Total 190.50–266, "Phases 0–4 measured (182 cards)" → 205.25–287, "Phases 0–5 measured (213 cards)"
3. **docs/11 prose:**
   - months 9–13 → 10–14 (9.8; 13.7); contingency 29–40 → 31–43 d
   - factor note added; the factor stays 1.50 for Phases 6–7
   - mermaid `21-29 d (scaled)` → `35.75-50 d (measured)`
4. **docs/11 Phase 5 Effort paragraph and §2:**
   - paragraph rewritten
   - binding route 122.25–171 → 137.00–192; float 17.75–25 → 3–4 d
   - route through Phase 3: float 21.5–31 → 6.75–10 d
   - critical path 140.00–196 and the Phase 2 versus Phase 3 margin (3.75 d and 6 d) unchanged
5. **plan/00 §1 table:**
   - new row `5 — Related + recommendations | 31 | 35.75 d | 35.75–50 d | 10–14 d (+155%)`
   - `5–7 … 57–79 d … 27–38 d` → `6–7 … 36–50 d … 17–24 d`
   - dated paragraph added

Other changes:
- `scripts/derive-task-index.ts`: reads plan/08, adds the Phase 5 count, and `DECOMPOSED = 98 + 25 + 30`. `P5-T31` counts as growth.
- plan/00: header, Phase 5 table, §3, the scaled-phases warning, §7.
- plan/README §2 row and two dated notes.
- plan/05 §2 is now a pointer; §2.1–§2.4 moved verbatim to plan/08 §5.
- plan/06: new `G-43` section and table row; float note on `G-03`; notes on `G-26` and `G-27`.

Back-ups of plan/08, plan/00 and docs/11, and the checker, are in the scratchpad folder `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\`. The checker is `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p5accept-check.mjs`.

**DOC NOTES ADDED** (all dated 2026-11-02)
- **docs/10:** Q2 and Q8 struck and marked decided.
- **docs/11:** R-3 row; R-19 row; Phase 2 and Phase 5 "Risks retired"; §3.1 rows 2 and 5; R-23; Phase 5 modules line; §5 row.
- **docs/09:** §3 row 6 rewritten.
- **docs/05:** §7.3 row (d); §7.5 filter split.
- **plan/04:** §0.2 item 4 now names four tests.
- **docs/07:**
  - §4.2 `citationGraph` description widened to "relation edges"
  - `RelatedPage`, `RelationEdge`, `RelationKind` declared
  - `findRelated` return type and two new `strategy` members
  - the typed-adapter rule
  - The note says the code follows in `P5-T01`.

**CHECKS RUN**
- **Script over plan/08:** 31 cards, sum 35.75, equal to the §1 table; every title, estimate and gate matches. No Depends/Blocks mismatch, cycle, unknown id, or path created twice. 0 open lines. 34 DECIDED blocks cover every line except 28 and 29, which are decided in §0.4 and §4. 3 settled blocks; §0.4 has 36 rows.
- **`npm run index:derive` twice:** P5 31 rows, 213 tasks, 112 done, 101 to do, header date now 2026-11-02. Both runs give the same file hash, so the second changed nothing.
- **`npm run typecheck`: exit 2**, two errors in files other agents hold: `test/integration/menus.spec.ts` and `test/unit/pipeline/trendScale.test.ts`.
- **`npm run lint:check` and `npx eslint .`: exit 1**, two errors in files other agents hold: `src/bootstrap/registerUI.ts` and `test/integration/lifecycle.spec.ts`.
- **Effect of those failures:** `lint:check` stopped at ESLint, so its Prettier half did not run across the tree.
- **The one code file edited here:** ESLint and Prettier both pass on the script. Typecheck reports nothing in it. Prettier ignores `*.md`, so its pass on the edited Markdown proves nothing.

**LINES THE OWNER MAY READ AS SCOPE**
- **Line 12:** "similar" means PubMed's list only; the local library similarity search and the published-version offer go to the backlog.
- **Line 18:** PubMed's `citationGraph` flag turns on, a reading of item 184.
- **Not from the review, worth raising with those two:**
  - `P5-T31`, a new gated card
  - `P5-T18`'s +0.25 d
  - withdrawing R-19's "validated at scale", which leaves that claim with no phase

**SUGGESTED FIRST WAVE**

Can start now, in parallel:
- `P5-T04`: new `src/sources` builder files, the recorder, `test/support`, fixtures, docs/13. Live requests go to Europe PMC, NCBI and Crossref only. It needs no build or Zotero and shares nothing with the other two.
- `P5-T01`: docs/07, docs/05, `src/model`, `src/sources/types.ts`.
- `P5-T02`: docs/07 §8.5, `src/prefs`, `addon/prefs.js`, the schema test.

Shared files:
- `P5-T01` and `P5-T02` share docs/07, so use exact-string edits.
- `P4-T20` also holds docs/07, `src/` and `addon/`, so `P5-T02` should re-read before editing or wait for its commit.

After `P5-T01`:
- `P5-T10` and `P5-T19` can run in parallel.
- `P5-T03` needs the integration suite, so it waits for the build owner to be free.

After `P5-T01` and `P5-T04`: `P5-T07`, `P5-T08` and `P5-T09` can run in parallel.

`P5-T05` and `P5-T06` wait on the owner's `P5-T31`. They share `semanticscholarSource.ts` with `P5-T20`, so run those in sequence.

**FINDINGS**
1. **Phase 5 is close to critical.** About 3 d more Phase 5 cards would make its route the critical path, and plan/08 §3 names two places the sum is still likely low.
2. **The key rotation is now the phase's practical blocker.** The dependency order is `P5-T31` → `P5-T05` → `P5-T20` → `P5-T14`, `P5-T21`, `P5-T24`, so both features wait on the owner's fixture recording, including their keyless paths. Worth asking the owner soon for the rotation and for `P5-T31`, which `P5-T29` then follows.
3. **No item records the owner accepting 35.75 d,** as item 288(a) did for Phase 4. docs/11 §5 now says so.
4. **For the coordinator to record in plan/00 §6:**
   - backlog items: co-citation; evaluation harness; implicit feedback log; `RECOMMEND_RANK` and model-written rationales; local library similarity; published-version offer; background prefetch
   - the coordinator's decisions and today's two placement calls, `P5-T31` and `P5-T18`
5. **Document corrections still owned by cards:**
   - docs/08 §5 and §7.4: `P5-T16`
   - docs/08 §5.4: `P5-T26`
   - docs/12 §15–§16: `P5-T22`
   - docs/05 §7.4: `P5-T24`
   - docs/03 §16: `P5-T20`
   - docs/07 §5.2 and §12: `P5-T01`
   - docs/07 §13: `P5-T20`
   - FR-13: `P5-T15`
6. **`RelatedPage` shape is my choice:** a `SourcePage` plus an index-aligned `edges` array, so existing page consumers keep working. `P5-T01` may change it, docs/07 first.
7. **Left as found:** docs/10 Q13 is still unstruck (outside this brief), and docs/11 R-21 still says 8–11 months.

**WHAT I DID NOT CHECK**
- No build, test run or Zotero run, as instructed. Tests read docs/07 and docs/09; a grep for the docs/07 §4.2 strings changed here found none in `test/`, and the docs/09 test seen pins §2.1, not §3. No test was run to confirm it.
- plan/07 was not read for the stale "two pinned tests" wording. It is off limits, and docs/11's Phase 4 paragraph still says two.
- Still unmeasured, as the review said:
  - `/paper/search/match`'s no-match response
  - tooltips on disabled menu entries
  - library-wide term counts on a 10 000-item library
  - Europe PMC's real rate limit
- The card bodies from `P5-T01` on were not re-read line by line after the break; they were checked by script and by grep. Their text was written yesterday against the tree as it stood then, and `P4-T20` and `P4-T22` have kept editing it.
- An older `rep.mjs` in the scratchpad was overwritten without being read. It held only scratch work, so no repository file is affected.

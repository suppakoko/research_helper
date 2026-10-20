**Report: cards P3-T38 and P3-T39 (2026-10-20)**

Both cards are written, every edge is updated at both ends, and the new Phase 3 sum is propagated to all five places in `plan/README.md` §7. `npm run index:derive` exited 0 twice, and the second run changed nothing. The edge check found no mismatch in anything I touched. It did find five older mismatches in Phase 2, listed at the end.

I changed only these four files: `plan/04-phase-3-llm-summaries.md`, `plan/00-task-index.md`, `docs/11-implementation-roadmap.md` and `plan/README.md`. I did not touch `src/`, `test/`, `addon/`, any other document, or git, and I ran no tests and did not start Zotero. Two helper scripts are in the scratchpad: `sums.mjs` (sums the estimates and checks the edges) and `docs11.mjs` (made the `docs/11` replacements, each one checked to match exactly once).

**1. The two cards** (in `plan/04`, after `P3-T37`, using the template's shape)

Both carry all the requested fields: ID, State `TODO`, Depends on, Blocks, Retires, Implements, Estimate, Human gate, Goal, Why this is a card, Read first, Files, Do, Do NOT, Done when, Verify with, Notes. The README §4 template has no "Why this is a card" field. I placed it after Goal, as earlier cards in `plan/01` and `plan/02` do. The script that rebuilds the index reads the card fields only up to Goal, so the extra field does not affect it.

**P3-T38 — Keep an LLM 429's body; never retry a parse failure.** 0.5 d, no human gate. Retires part of `R-4`; implements part of `FR-34`.
- Depends on `P3-T05`. Blocks `P3-T07`, `P3-T08`, `P3-T09` and `P3-T10`.
- **Two designs, left to the executor:**
  - **Option A: a hook that sees the response before `classify`.**
    - Constraint: `src/core/` may import only `src/model/` (lint rule `research-helper/layering/core`), so a `HOST_POLICIES` row cannot import `mapProviderError`. The function has to arrive through `HttpClientDeps` (built by `installServices`) or per request through `HttpOptions`.
    - Constraint: `mapProviderError` needs the request's `modelId`, which a per-host hook does not know.
  - **Option B: keep a redacted body on `RateLimitError`.**
    - This fixes recognition but not the retry, because `withRetry` decides inside its loop and `RateLimitError` is marked retryable. The card says B is complete only with a named way to stop that retry.
  - Rules both must keep: a literature host's 429 behaves as today; every body goes through `redactText` before it is attached; there stays one retry loop and one `Retry-After` parser.
- **Also in the card:** `isRetriedAutomatically` returns false for `StructuredOutputError`, while the class's own `retryable` flag stays true.
- **The test change is decided to be this card's, not `P3-T07`'s.** `backoff.test.ts` will accept a row whose `retry` is the `LLM_RETRY_BUDGET` object itself against the shared "LLM/TTS hosts" row in `docs/07` §7.3. Reason: `P3-T07`–`P3-T10` have the same dependencies and can run in parallel, so whichever adds an LLM row first would fail the test, and the fix would be written up to four times or collide. The card also warns not to rename that row's Host cell, because `llmRowCells` in `hostLimiter.test.ts` finds the row by that text.
- **Callers (rule 10):** the client's inner `issueAndClassify`, inside `createHttpClient`, which `installServices` in `src/bootstrap/container.ts` constructs. The LLM side belongs to `P3-T07`–`P3-T10`, whose adapters `registerProviders` constructs (`src/bootstrap/registerProviders.ts`, created by `P3-T06`).
- **From item 247 it takes** the stale header comments in `backoff.ts` and `hostLimiter.ts`.
- **Documents first:** `docs/07` §7.3 and `docs/03` §11.6 and §14.1, with the executor writing the dated notes.
- **Files rows that depend on the design** (`src/core/errors.ts`, `src/bootstrap/container.ts`) are marked as guesses.
- The Verify line passes its test filters as separate arguments, because Vitest treats each filter as plain text, not an alternation.

**P3-T39 — Store money preferences as whole cents.** 0.5 d, no human gate. Retires none; implements part of `FR-24` and part of `NFR-5`.
- Depends on `P3-T32`. Blocks `P3-T16`.
- **Not `P3-T04`:** that card binds `llmProvider`, `<provider>.model` and `<provider>.baseUrl` only, and `docs/08` names none of the money keys (checked with grep).
- **Proposed names:**
  - `summary.confirmAboveCents` (`summaryConfirmAboveCents`), integer, 200
  - `run.maxSpendCents` (`runMaxSpendCents`), integer, 0 (off)
  - `run.maxSessionSpendCents` (`runMaxSessionSpendCents`), integer, 0 (off)
  - The amounts are US cents, and every screen shows and accepts dollars.
- **Every place that names the old keys** (found with grep; each is corrected in place with a "Corrected 2026-10-20" mark):
  - `docs/07`: the three §8.5 rows, the §8.3 table row, and the §8.5.3 sentence
  - `docs/01` §7.2; `docs/00` D7; `docs/03` §12.3 item 3
  - `docs/06`: §5.4 (including the sample dialog text), §11.4, §15, and §16 item 1
  - `docs/10`: NFR-5, and §5 items 4 and 6
  - `docs/11` §3 risk R-4
  - `plan/04`: `P3-T16` (six places), `P3-T31` (two) and `P3-T32` (step 1)
  - `plan/06` gate `G-20`
- **Code files:** `PREFS`, `PREF_KEYS`, `addon/prefs.js`, `typings/prefs.d.ts` (regenerated by `npx zotero-plugin build`; the card says to check that `typings/i10n.d.ts` hashes the same before and after), and `test/unit/prefs/schema.test.ts`. The test names the card cites are exact.
- **Left as written:** `plan/reports/` and the text of item 245.
- **No migration:** nothing outside the five files above names the keys, the plugin has never been released, and `docs/07` §8.5.3 allows a rename before first release with document updates only.
- **Callers (rule 10):** the first readers are `P3-T16`'s `BudgetGuard`, which `P3-T35` wires through `createPipelineContextFactory`, and its estimator, called from `P3-T29`'s pipeline.

**Edges updated at both ends**
- Blocks of `P3-T05`: added `P3-T38`.
- Depends on of `P3-T07`, `P3-T08`, `P3-T09` and `P3-T10`: added `P3-T38`.
- Blocks of `P3-T32`: added `P3-T39`.
- Depends on of `P3-T16`: added `P3-T39`.

**2. Figures** (summed by script from the cards' Estimate fields)
- **Phase 3:** 39 cards, 28.5 d; 28.5 × 1.4 = 39.9, so the published range is **28.5–40 d**. Human-gated cards stay at 8.
- **Phases 0–3:** 157 cards, 108.75 d low and 25 + 41 + 47 + 40 = **153** high. The correction factor recomputes to 108.75 ÷ 52 = 2.091 and is still held at 1.50.
- **Whole plan:** **182.25–255 d**. That is about 9–12 months at 21 working days a month (8.7 and 12.1), and the 15% compatibility allowance stays 27–38 d.
- **Critical path:** unchanged. It runs P0 → P1 → P2 → P4 → P6 → P7 = **132.75–186 d**, and Phase 3 is not on it.
- **Route through Phase 3:** 128.00–179, which is 4.75 d and 7 d short of the critical path (it was 5.75 d and 8 d).
- **Phase 5 float:** 10.5–15 d, unchanged. The route into Phase 5 through Phase 3 is now 117.50–164, a float of 15.25–22 d (it was 16.25–23).

**3. Sentences changed, by site**

`plan/04`:
- The §1 table gains the `P3-T38` and `P3-T39` rows; the Total row reads **28.5**, "8 gates".
- The §0 Effort paragraph now reads: "28.5 developer-days over 39 cards (§3), so the published band is 28.5–40 d (28.5 × 1.4 = 39.9 → 40). *Updated 2026-10-20:* `P3-T38` and `P3-T39` (0.5 d each, items 244 and 245) moved it from 27.5–39 d over 37 cards; the figure before the re-carding was 23.5–33 d over 31 cards. Propagated the same day … (`plan/reports/cards-P3-T38-T39.md`; the re-carding's own propagation is `bookkeeping-2026-10-20.md`)."
- The §3 table has a new first row "Sum of the 39 task cards … **28.5**". The old row is relabelled "Sum of the 37 task cards (2026-10-20, the re-carding) 27.5", and the band row reads "28.5–40 (28.5 × 1.4 = 39.9 → 40; was 27.5–39 earlier that day)".
- §3 also gains a new paragraph, "Two cards added 2026-10-20, after the re-carding …", giving the arithmetic, the unchanged gate count and the new edges.

`docs/11` (17 exact replacements):
- **Opening paragraph on the correction factor:** appended "…and `P3-T38` and `P3-T39` later that day to 108.75 and **108.75 ÷ 52 = 2.091** — two cards carded from the owner's decisions on findings of `P3-T05` and `P3-T32` (items 244 and 245)".
- **Opening whole-plan sum:** "182.25–255 … (181.25–254 earlier on 2026-10-20, before `P3-T38` and `P3-T39`, and 176.75–247 before that)". The months arithmetic is now 182.25 ÷ 21 ≈ 8.7 and 255 ÷ 21 ≈ 12.1, with a dated note that the 9–12-month range is unchanged.
- **Phase 3 Effort paragraph:** "28.5–40 developer-days — measured: the 39 task cards … sum to 28.5 d; … (28.5 × 1.4 = 39.9 → 40). (Was 27.5–39 over 37 cards earlier on 2026-10-20, until `P3-T38` and `P3-T39` were added the same day … Was 23.5–33 over 31 cards until the re-carding that morning, …)".
- **§1 per-phase table:** Phase 3 "28.5–40 | measured — 39 cards"; subtotal "108.75–153 | measured — 157 cards"; Total "182.25–255".
- **§1 totals paragraph:** "17.75 + 29.25 + 33.25 + 28.5 = 108.75 low and 25 + 41 + 47 + 40 = 153 high; … 182.25–255 total (was 107.75–152 and 181.25–254 earlier on 2026-10-20, …)". The history parenthetical gains "…and to 28.5 over 39 cards later the same day with `P3-T38` and `P3-T39` …, moving it 39 → 40 (28.5 × 1.4 = 39.9)".
- **§1 months paragraph:** "(182.25 ÷ 21 ≈ 8.7; 255 ÷ 21 ≈ 12.1; 181.25 … earlier on 2026-10-20 …)". The 15% allowance reads "182.25 × 0.15 ≈ 27.3; 255 × 0.15 ≈ 38.3, unchanged in whole days …".
- **§2 diagram:** the Phase 3 node reads "28.5-40 d (measured)".
- **§2 "Reading the graph":** "at Phase 2's 33.25–47 against Phase 3's 28.5–40, P2 leads P3 by 4.75 d at the low end and 7 d at the high end (…5.75 d / 8 d after the re-carding, until `P3-T38` and `P3-T39` the same day) … whether a 4.75–7 d lead still reads …".
- **§2 critical-path bullet 1:** "…and nor do `P3-T38` and `P3-T39` later that day (27.5–39 → 28.5–40), for the same reason."
- **§2 critical-path bullet 2:** the route is "17.75 + 29.25 + 28.5 + 16.5 + 15 + 21 = 128.00 low and 25 + 41 + 40 + 23 + 21 + 29 = 179 high … a margin of 4.75 d … and 7 d … about 4.75 d more cards …", followed by a dated note recording the old 127.00/178 and 5.75/8.
- **§2 Phase 5 float bullet:** the route into Phase 5 through Phase 3 is "28.5 … = 117.50 low … 40 … = 164 high, float … 15.25 d to … 22 d — recomputed 2026-10-20 for `P3-T38` and `P3-T39` (it read 116.50 and 163, a float of 16.25–23 d …)". The same bullet now says "the whole 182.25–255-day plan (181.25–254 earlier on 2026-10-20 …; 176.75–247 before that)".

`plan/00`:
- **§1 table:** Phase 3 row "39 | 28.50 d | 28.5–40 d | 12–15 d (+90%)"; Phases 0–3 row "157 | 108.75 d | 108.75–153 d | 39–52 d (+109% over the top of the band)".
- **§1, new paragraph** "2026-10-20, later: `P3-T38` and `P3-T39` added …", which gives the sums, the totals, the unchanged critical path and the percentage arithmetic (28.5 ÷ 15 = 1.90 → +90%; 108.75 ÷ 52 = 2.09 → +109%; they were +83% and +107%).
- **§6 heading 6.49:** "243 to 246 wait on the owner" became "243 to 246 decided the same day". This was not asked for; the heading was false once the four items were decided.
- **§6 DECIDED lines:**
  - Item 243: both rules accepted. The line notes that `docs/09` §2.1 still says otherwise.
  - Item 244: card `P3-T38`, with its edges and scope; it also takes item 247's two transport header comments.
  - Item 245: card `P3-T39`, integer cents, the three new names, `docs/07` §8.5 first, no migration.
  - Item 246: the Korean was approved and inserted by the coordinator; the four ids are now in `KO_PRESENT`, not `KO_PENDING_REVIEW` (checked in `src/i18n/keys.ts`).
- **Generated by `index:derive`:** the header line and the §4 Phase 3 table.

`plan/README.md` §7, the worked example now reads: "(25 + 41 + 47 + 40 = 153, where 108.75 × 1.4 = 152.25 would give 152). *Updated 2026-10-20 for `P3-T38` and `P3-T39`: the example read 25 + 41 + 47 + 39 = 152 against 107.75 × 1.4 = 150.85 → 151.*"

**4. `npm run index:derive` output**

First run (exit 0):
```
  P0: 35 row(s) -> 35 (34 DONE)
  P1: 46 row(s) -> 46 (44 DONE)
  P2: 37 row(s) -> 37 (34 DONE)
  P3: 37 row(s) -> 39 (0 DONE)
  header: 157 tasks, 112 DONE, 45 TODO
plan/00-task-index.md derived from the cards
```
It changed the header line (155 → 157 tasks, 43 → 45 TODO, "Phase 3 0 of 39", "to 157, so 59 of them"), four `P3-T07`–`P3-T10` rows, the `P3-T16` row, and added the `P3-T38` and `P3-T39` rows.

Second run: exit 0 with `P3: 39 row(s) -> 39`. A byte comparison against the file after the first run showed no change.

**5. Edge check, both directions, all 157 cards**

384 edges on each side. No mismatch involves Phase 3 or any edge I added. There are five older mismatches, all in `plan/03`, which I left alone:
- `P2-T27` depends on `P2-T01`, but `P2-T01` does not block `P2-T27`.
- `P2-T27` blocks `P2-T14` and `P2-T16`, but neither depends on `P2-T27`.
- `P2-T32` blocks `P2-T14` and `P2-T16`, but neither depends on `P2-T32`.

**6. Inconsistencies left alone**
- **Phase 2:** the five mismatches above.
- **`plan/04` header:** it still says "No Phase 3 card has been executed; every task is `TODO`", but `P3-T01`, `P3-T05`, `P3-T24`, `P3-T32` and `P3-T36` have reports. The State of `P3-T05` and `P3-T32` still reads `TODO`; changing it is the owner's step.
- **`docs/09` §2.1:** it says the two `P3-T36` rules "are not part of the owner's decision", which is false after item 243.
- **Item 247 leftovers:** the `addon/prefs.js` comment and the `docs/07` §8.5 sentence on `timeoutSeconds` ("because LLM calls are long") are not in either card. Item 247's text itself is unannotated; my item-244 line records which parts `P3-T38` takes.
- **After `P3-T39`:** no preference row will use the `number` type. The card tells the executor to keep that type and report it.
- **Card designs to follow up:** the `P3-T38` design choice will need one dated line on each of `P3-T07`–`P3-T10`. The card asks the executor to report the design so the coordinator can add those lines.
- **Earlier dated paragraphs** in `plan/00` §1 and `docs/11` that quote 27.5–39 and 181.25–254 are history and were left as written.

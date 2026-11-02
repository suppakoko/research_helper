# integration-round-337 — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: The round is clean, with one proof line narrowed. Runs 3, 4 and 5, all on the final tree, each ended with exit code 0 and 261 passed. No product code changed. Nothing was committed, no card was set to DONE, and `plan/00` was not edited by this round.

**The narrowed line:** "the note and the export show none of the numbers" is false as worded, and the report has always behaved this way.
- Appendix B already prints each summary call's input and output tokens, so 60 of 60 of those figures appear in every note and export.
- The report's header also names each prompt with its version.
- The spec now asserts that nothing else appears, and comparison with a build from before the capture found no new text. Please confirm this reading.

**Runs** (each started with the key removed, the `/* MUTANT` grep empty and no test-profile Zotero running; nothing had to be killed)

| Run | Result | ko-KR totals line | Longest main-thread gap |
|---|---|---|---|
| 1 (first spec) | 258 passed, 3 failed, all in the new spec | 353 present, 1 absent; expected 353 / 1 | 72 ms |
| 2 (spec fixed, one small change still to come) | 261 passed, exit 0 | 353 / 1 | 70 ms |
| 3 (final tree) | 261 passed, exit 0 | 353 / 1 | 42 ms |
| 4 (final tree) | 261 passed, exit 0 | 353 / 1 | 71 ms |
| 5 (final tree) | 261 passed, exit 0 | 353 / 1 | 69 ms |

- **Timing assertion (`phase1-dod.spec.ts`, item 335(m)):** it did not fail in any of the 5 runs, and it was not changed. The range was 42 to 72 ms, over 5 runs.
- **Final tree:** a hash of `src`, `test`, `addon`, `scripts` and `typings` was the same before runs 3, 4 and 5 and after run 5. Only documents changed after that.
- **ko totals:** the line moved from 350 / 4 to 353 / 1, so three ids fewer are absent, not one group. `KO_PENDING_REVIEW` is now empty, and the 1 absent is the deliberate fallback fixture.

**Static checks and build** (on the final code, before run 3)
- `npm run typecheck`, `npx eslint .` and `npm run lint:check` each exit 0. `lint:check` was run again after the document edits and still exits 0.
- `npm run test`: unit 122 files, 6065 passed, 105 skipped; contract 6 files, 84 passed, 28 skipped.
- `npm run build`: exit 0.
- **Typings:** all five hashes are identical before the build, after the build and after run 5.

**Fixes** (all in the new spec; no existing test was changed, and `l10n.spec.ts` only gained a test)
1. **"None of the numbers", cause above.** The first spec treated every measured figure as forbidden. It now separates two groups:
   - Summary input and output figures may appear only in rows naming an item.
   - Every other figure and every member name may appear nowhere. That covers other stages' calls, totals, reasoning, ceilings, full-precision costs and analysis sizes.
   - Prompt ids are no longer forbidden in the note, export or preview, but they are still forbidden in the windows' own strings.
2. **Cost figure.** The mock's cost could equal a report's four-decimal cost (0.0003). It now always has a non-zero sixth decimal.
3. **Checkpoint stage.** The spec expected `Analysing` and got `EnsuringSummaries`. The 2-second throttle holds later stages back on a run this fast (finding 1), so the spec now asserts a valid checkpoint written by the real run, not its stage.
4. **Not a failure:** the spec also records Fluent ids and arguments, because a fast run can change status before its words are translated. It also folds report and user ids out of the logged note text.

**Korean check (step 2)**
- `l10n.spec.ts` did not cover these strings, so I added a test.
- All three strings render from a localization pinned to ko-KR alone, including all four stop reasons, and each differs from the English.
- The brief's "five report labels" does not match the tree. Item 335(l) is three strings plus two labels (`fitOutputLowered`, `fitAnalysesShortened`), five in total. Both labels resolve in Korean inside Zotero and their placeholders fill.
- No Korean text was added.

**Proof lines for the capture**

| Line | State | How |
|---|---|---|
| A `both` run stores the measurement on the English row only | Live | 38 entries match the mock's figures call by call; the Korean row holds none |
| Survives the row's second `put` | Live | The raw row's json holds the note key, which only the second `put` writes, and still holds the measurement |
| No marker, theme name or collection name | Live | Also no item key; the same row's other members do hold them, so the search is not empty-handed |
| Note and export show none of the numbers | Live, narrowed | See VERDICT |
| No new text on screen | Live, compared outside the suite | Runs 3 to 5 against a build of commit 2273874: 0 new strings. Run 5 lacked one passing string ("Exported."). Notes and exports had 0 differences. That build fails all six tests of this spec, as it should |
| After closing Zotero, `measure` call count equals the mock's | Run after the harness quit Zotero, on a copy of the file | `calls 38` against the mock's 38 |
| An old database prints "not measured" | Ran | On a copy of the database saved before any run of this round; no 0 printed |
| A resumed job prints the resumed line | Partly live | Resumed from a real run's checkpoint through the real runner: line printed, 4 calls against the mock's 4, 3 cached analyses listed. No real quit in the middle |

The `measure` checks ran on runs 3, 4 and 5 (also on run 2). Run 1 proved only the first three lines and the `measure` count for the `both` run. The comparison is a script against one baseline run; the suite does not assert it.

**Findings for the coordinator**
1. `docs/07` §7.6 says checkpoints are "always flushed at stage boundaries". That does not hold for `ctx.checkpoint`, which has no boundary flag.
   - Held in its first compose, the record named `EnsuringSummaries` in all 5 runs, three stages behind.
   - A crash then costs a resumed job priced from an earlier stage. The measured job made no repeat calls, because done stages came from the cache.
   - I recorded this with a dated note and changed nothing.
2. `-wal` and `-shm` files remain after the harness quits Zotero. In one check, the main file alone gave the same 11 rows and the same `measure` run total.

**Still unproved**
- A person quitting Zotero in the middle of a run and restarting. A restarted Zotero has no mock provider, so this cannot be staged honestly.
- A person closing the window. The harness quits through `Zotero.Utilities.Internal.quit`.
- Real provider field names (item 336(c)).
- `P5-T05` and `P5-T06` in Zotero: no integration spec calls their new routes, so they stay unit-only on stand-in fixtures.
- The two Korean labels and three strings as they appear in a real report or window. They were checked by resolving them, not on screen.

**Recorded, dated 2026-11-02**
- `docs/07` §5.2: the measured figures and the Appendix B fact.
- `docs/07` §7.6: finding 1.
- `docs/spikes/trend-eval-baseline.md`: the route was run on a mock, and those figures do not belong in that file.
- `docs/13` §2.3: the new spec and its two proofs outside the suite.
- `plan/06` G-41: the 353 / 1 count. No other current document states 350 / 4 except `plan/reports/integration-round-334.md`, a saved report I left as written. `plan/00` was not checked for it. The estimate figures were not touched.

**Key handling:** the name `OPENROUTER_API_KEY` was removed from every typecheck, lint, test, build, Zotero and `measure` command. Small helpers such as `grep`, `cp` and `sha256sum` did not all have it removed; none reads or prints it, and the value was never read. No live network or model call was made by the tests, and the recorder was not used.

**Files changed** (under `D:\KIST\projects\research_helper`)
- `D:\KIST\projects\research_helper\test\integration\reportMeasurement-flow.spec.ts` (new; carries its own copy of helpers from `reportWindow-flow.spec.ts`)
- `D:\KIST\projects\research_helper\test\integration\l10n.spec.ts`
- `D:\KIST\projects\research_helper\docs\07-architecture-and-data-model.md`
- `D:\KIST\projects\research_helper\docs\13-testing-build-and-release.md`
- `D:\KIST\projects\research_helper\docs\spikes\trend-eval-baseline.md`
- `D:\KIST\projects\research_helper\plan\06-human-gates.md`

**Final logs**
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\run-3.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\run-4.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\run-5.log`

**`measure` outputs**
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\post-3.out`
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\post-4.out`
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\post-5.out`

**Baseline and scripts**
- Baseline log: `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\baseline-a.log`
- Comparison script: `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\compare.mjs`
- `measure` check script: `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round337\post.mjs`
- Database from before the capture: `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\old-db\research-helper.sqlite`

These last proofs live only in the scratchpad, so a later round has to rebuild them or the coordinator has to decide to keep them.

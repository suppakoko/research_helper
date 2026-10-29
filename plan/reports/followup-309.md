VERDICT
All seven parts of plan/00 §6 item 309, (a) to (g), are applied. Documents were edited first. Each change sits under a dated "Decided 2026-10-29 (owner, plan/00 §6 item 309(x))" note. Every check passes:
- typecheck, lint:check and `npx eslint .` all exit 0.
- `npm run test`: unit 98 files, 4690 passed; contract 84 passed, 28 skipped.
- `npm run build` exits 0. Only `typings/i10n.d.ts` changed, by exactly the two new ids.
- `index:derive` ran twice, giving the same hash both times (b5016616…). The plan/00 diff is still only the coordinator's item 309 text; its diff hash, 032bf5fa…, is the same before and after.
- Integration ran three times: 226 passed each time.

Nothing was committed, and every card State stays TODO. Only the fake provider was used: no live call, no key and no secret. The `grep -rn MUTANT src test addon typings scripts` check is empty at the end.

FILES CHANGED WITH DECLARATION NAMES
- `src/pipeline/shared/estimate.ts` (b, c):
  - New `packThemeMembers`: the single packing rule. It calls `packByTokens` with each member's tokens + 1, within CLUSTER_REDUCE's budget − 1.
  - `maxPartialsPerMerge` moved here from themeAnalysis.ts, unchanged, to avoid an import cycle (themeAnalysis.ts imports estimate.ts).
  - New exported `themeStageReservation` and interface `ThemeStageReservation`, plus a private `worstSummariesPerThemeCall`. That function finds p by asking `packThemeMembers`, not by dividing.
  - Removed `ThemeStage`, `themeStage` and `largerThemeStage`.
  - `planSynthesis` L2 rewritten: T = K + `OTHER_THEME_RESERVE`, or `themeCount` when the run passes one. Theme calls at or past position K are conditional; every merge is conditional.
  - `SynthesisPlan.themes` now means "themes reserved" = min(T, papers). Its doc comment says so, and so does the `planSynthesis` doc.
- `src/pipeline/trendReport/themeAnalysis.ts` (b, g):
  - `packThemeSummaries` now calls `packThemeMembers` through a private `memberOwnTokens`; `memberTokens` is removed. It re-exports `maxPartialsPerMerge`.
  - New `NO_THEME_ANALYSED_L10N`, `ThemesAnalysedOutcome` (status "analysed") and `NoThemeAnalysedOutcome` (status "stopped-no-theme-analysed", with `messageId`).
  - `ThemeAnalysisOutcome` is now that union. The private `ThemeAnalysisOutcomeBase` holds the old fields.
  - `analyseThemes` returns the stop, with a warning log, once every theme has settled and all are unanalysed. It removes nothing.
  - An empty theme list still gives "analysed".
  - The header gains step 6.
- `src/pipeline/trendReport/cluster.ts` (e):
  - New `MERGE_TOO_LARGE_L10N` and `MergeOverBudgetOutcome`, with fields `localThemes`, `mergeInputTokens` and `mergeInputBudget`. `ClusterOutcome` now includes it.
  - In `clusterThemesTwoStage`:
    - `BatchStopped` and the `halts` parameter of `send` are removed.
    - A batch re-run still over its band only logs a warning and goes on to the merge.
    - Before the merge request, `digestTokens(localThemesVariable(locals))` is checked against `SYNTHESIS_INPUT_BUDGETS.THEME_MERGE`. When it is over, the stage stops.
    - The merge answer's check against the run's `MAX_THEMES` is unchanged.
  - The doc comments of `TOO_MANY_THEMES_L10N` and `NO_THEMES_L10N` now say the ids are on KO_PRESENT. The first comment was stale since item 307(f).
- `src/ui/dialogs/costConfirmDialog.ts` (c): only the doc comment of `reportPlanLines` changed. It still passes `plan.synthesis.themes`, which now holds K + 1.
- `src/i18n/keys.ts`, both mainWindow bundles and `typings/i10n.d.ts` (a, e, g).
- Tests:
  - `test/unit/pipeline/estimate.test.ts`:
    - Five tests updated.
    - The 307(b) block is replaced by a 309(b) block of five tests, including an exhaustive search: every N from 1 to 450 and T from 1 to 13, with the packer as oracle.
  - `test/unit/pipeline/trendThemeAnalysis.test.ts`:
    - A new 5-test block for (g).
    - Section 7 now pins "estimate ≥ actual" and checks that `packThemeSummaries` and `packThemeMembers` agree.
  - `test/unit/pipeline/trendCluster.test.ts`:
    - The open-line test is now "[decided, item 309(e)] … goes to the merge".
    - New: the merge's run-wide `MAX_THEMES` check still stops the run.
    - A new 3-test block for the merge budget.
    - The no-themes bundle test now checks the Korean against ko-review-309.ftl.
  - `test/unit/ui/costConfirmDialog.test.ts`: a new (c) test: 30 papers with K unset gives `themes: 8`.
  - `test/unit/i18n/keys.test.ts`: the no-themes id is moved to KO_PRESENT; a new 2-test block for the new ids.
- Who calls the new stops: `trendReportPipeline.ts` (P4-T18), noted on the P4-T18 card. Nothing new is constructed.

SHARED-FILE EDITS QUOTED
- `keys.ts`, `MAIN_WINDOW_MESSAGE_IDS`: two ids appended after the no-themes id, each with a comment:
  - "// P4-T06: the report run stopped because two-stage clustering's merge input was over THEME_MERGE's budget (owner, plan/00 §6 item 309(e)). See MERGE_TOO_LARGE_L10N …"
  - "// P4-T07: the report run stopped because no theme could be analysed (owner, plan/00 §6 item 309(g)). See NO_THEME_ANALYSED_L10N …"
- `keys.ts`, `KO_PENDING_REVIEW`: the no-themes id is replaced by "…left this list on 2026-10-29: the owner approved the coordinator's Korean (`G-41`, plan/00 §6 item 309(a)), so it is on KO_PRESENT." The two new ids follow, under the usual G-41 stub comment.
- `keys.ts`, `KO_PRESENT`: gains the no-themes id under "// `P4-T05`'s stop when no theme is left: Korean drafted by the coordinator and reviewed by the owner on 2026-10-29 (`G-41`, plan/00 §6 item 309(a)), inserted byte for byte from plan/reports/ko-review-309.ftl."
- ko-KR mainWindow:
  - The no-themes block's NEEDS REVIEW header and stub are replaced by "# Korean drafted by the coordinator and reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item 309(a))." followed by the Korean line.
  - Two new blocks follow, each with the standard NEEDS REVIEW header and a "# NEEDS REVIEW <id> — en-US: …" stub.
- en-US mainWindow:
  - The no-themes header's "Korean pending review (G-41)." becomes "Korean reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item 309(a))."
  - Two new blocks (header and message) are appended.
- The verify script confirmed:
  - The Korean is byte for byte the same as ko-review-309.ftl (248 bytes), the stub is gone and the comment is present.
  - Both bundles are UTF-8 with no BOM, no carriage returns and a final line feed.
  - Each new stub carries the en-US text exactly.

DOC NOTES ADDED (quoted, shortened)
- docs/07 §4.5, after the P4-T06 note, (b): "Decided 2026-10-29 (owner, plan/00 §6 item 309(b)): point (4) counts the theme stage as P4-T07 packs it, at its worst." The derivation:
  - A summary at its worst is 1 840 tokens plus 1 for its separator. Asked through `packThemeMembers`, one call carries p = 21; `maxPartialsPerMerge` gives m = 11.
  - One theme of n members takes at most min(⌈n ÷ p⌉, m) calls, plus one merge if that is more than one. The packer closes a call only when the next summary does not fit, so every call but the last holds at least p summaries. A theme too large at worst size can still pack into m calls when its summaries are shorter, so it is counted at m, never 0.
  - With t = min(T, N): **R = t + min(⌊(N − t) ÷ p⌋, t·(m − 1))** and **M = min(t, ⌊N ÷ (p + 1)⌋)**.
  - Each figure equals an exhaustive search (a unit test checks this). They come from two different clusterings, so together they may over-state but never under-state.
  - Over-statement on followup-307's examples: 150 papers need 15 + 6 and are reserved 16 + 6 (one theme call over). 400 papers need 25 + 12 and are reserved 31 + 13 (six theme calls and one merge over).
  - The 42-paper example changes: with K = 5 passed it is now 1 + 6 + 1 merge + 1 + 1 + rewrite, 53 calls, about $5.06, where it was 51 calls and $4.68. With K unset it is 9 + 1, about $5.63 (it was $5.06).
- docs/07 §4.5 (c): "Decided … 309(c): the dialog names the themes reserved. `SynthesisPlan.themes` is now … K + 1 with K from the band, the run's own `themeCount` when it passes one, and the paper count when that is smaller … `reportPlanLines` … passes it as `$themes`."
- docs/07 §8.5 `report.enabled` row (d): "**Decided 2026-10-29 (owner, `plan/00` §6 item 309(d)): the key `report.enabled` is confirmed.**"
- docs/06 §8.4:
  - In reading (4), the open line is struck through and replaced by "Decided … 309(f): as built … The report names such a theme as too large to analyse … `plan/07` `P4-T12` builds that wording in its report-language label table."
  - After reading (5), a 309(b) sentence: "the two mixes are reserved 16 + 6 and 31 + 13 … the tests pin 'estimate ≥ actual' instead."
- docs/12 §20: the open line is struck through. New text: "Decided … 309(e): a batch answer is not a stop; the merge input is measured." It records:
  - The batch re-run's answer is used whatever its theme count.
  - `{{LOCAL_THEMES}}` is measured as rendered (`digestTokens`) against 60 000; `ClusterInput.inputBudget` lowers THEME_CLUSTER's budget only.
  - When over: outcome `stopped-merge-over-budget`, message `research-helper-report-stopped-merge-too-large`, no merge request, summaries kept.
  - Only a failure now halts the other batches.
  - Recorded but not changed: the 4 000-token output ceiling was sized for 12 local themes per batch.
- docs/12 §9 (g): "Decided … 309(g): no theme analysed is a stop … outcome `stopped-no-theme-analysed` with the message `research-helper-report-stopped-no-theme-analysed` … Nothing is removed: the summaries and every cached stage result … are kept … `P4-T18` maps it to the job's end. One analysed theme is enough … A clustering with no theme … still returns an empty `analysed` outcome, as built."
- plan/07:
  - P4-T06: open line struck through; a 309(e) note.
  - P4-T07: both open lines struck through; notes for 309(f), 309(g) and 309(b) (`maxPartialsPerMerge` moved).
  - P4-T12: a 309(f) note: a `theme_too_large` theme is named "too large to analyse"; this card builds the wording in `reportLabels.ts`' report-language table.
  - P4-T16: a 309(b) note on the Done-when's 42-paper line, plus a 309(b)/(c) note with the formula.
  - P4-T18: a 309(g)/(e) note mapping both new stops to the job's end, keeping summaries and cached stage results.

NEW STRINGS (both on KO_PENDING_REVIEW with a ko-KR "# NEEDS REVIEW" stub; no argument)
- `research-helper-report-stopped-merge-too-large`: "The report was stopped before it was written: the papers were sorted into themes in several parts, and the themes the parts found were too many, or described at too much length, to combine in one request. Every summary already made is kept."
- `research-helper-report-stopped-no-theme-analysed`: "The report was stopped before it was written: none of the themes the model found could be analysed, so no theme was left to write about. Every summary already made is kept."

The coordinator should draft Korean for both.

RUNS
- Unit mutants: each applied alone, restored by copy and checked by sha256 (estimate.ts a2f4a780, cluster.ts 82745248, themeAnalysis.ts 79c96dec). All nine were killed:

| Mutant | Change | Tests failed |
|---|---|---|
| M1 | the old "packed across themes" count: proves the new count matters | 13 |
| M2 | no per-theme merge cap | 1 (the exhaustive search) |
| M3 | wrong merge count | 7 |
| M4 | no Other reserve | 8 |
| M5 | `themes` reported as K | 5 |
| M6 | no merge-budget check | 1 |
| M7 | batch over its band dropped again | 4 |
| M8 | no all-unanalysed stop | 2 |
| M9 | stop when any theme is unanalysed | 1 |

- Integration: before each run the MUTANT grep was empty, and Get-CimInstance found no zotero.exe, so nothing was killed.

| Run | Result | P1-T44 badge test |
|---|---|---|
| 1 | 226 passed | passed |
| 2 | 226 passed | passed |
| 3 | 226 passed | passed |

  - l10n spec line, every run: `[P1-T18] ko-KR totals: 306 present, 3 absent; expected 306 / 3`. The 3 absent are the two new ids plus the deliberately absent spike id.

FINDINGS
1. **One small step beyond "K + 1" in (c).** `SynthesisPlan.themes` is min(K + 1, papers). With fewer papers than K + 1, the dialog shows the paper count, because a theme needs a paper and the estimate reserves no more theme calls than that. From 7 papers up (first band, K = 5), it is K + 1.
2. **The P4-T16 Done-when figure changed.** The 42-paper example with K = 5 now reserves 1 + 6 + 1 merge + 1 + 1 + rewrite, not 1 + 5 + 1 + 1, because 38 of the 42 summaries could fall in one theme. This is recorded on the Done-when line. Routine estimates rise a little: the 42-paper example goes from $4.68 to $5.06.
3. **The summary's worst size is still an assumption.** A summary whose JSON measures over 1 840 tokens can need more calls than the estimate reserves. `withBudget` still covers that at dispatch. `MIN_PAPERS_PER_THEME` is not used to tighten the bound.
4. **Possible merge output truncation.** Now that batches are unbounded, a merge over many local themes may run out of THEME_MERGE's 4 000-token output ceiling (`OutputTruncatedError`), which ends the stage as a failure. This is recorded in docs/12 §20 and not changed.
5. **`maxPartialsPerMerge` moved** into estimate.ts and is re-exported from themeAnalysis.ts. Earlier documents that name it "in themeAnalysis.ts" still resolve through the re-export.
6. **Who handles the new stops.** I added P4-T18 notes for both new stops so the card names who handles them (rule 10). Item 309 named P4-T18 only for (g).

WHAT I DID NOT CHECK
- Real model behaviour: merge truncation with many local themes, and real summary sizes.
- That the new stop messages read well in a running report window. P4-T18 and P4-T20 do not exist yet, so nothing shows them.
- The Korean by eye in a ko-KR user interface; only the l10n spec checked it.
- The new estimate lines in an opened cost dialog in Zotero; unit tests only.

Scratch files (`edit-ftl.mjs`, `verify-ko.mjs`, `mutants.mjs`, `mutants.log`, `int-run1.log` to `int-run3.log`, backups, typings hashes) are in `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\i309\`.

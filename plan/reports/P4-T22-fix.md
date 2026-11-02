# P4-T22-fix — report of the executing agent (saved verbatim, 2026-11-02)

## P4-T22 window fix: report (2026-11-02)

### VERDICT

**FINDING P4-T22-1 is fixed and the three tests run unskipped, but a real 400-item run on a 32 000-token window may still fail.** The tests pass with the mock's small theme analyses (84 tokens at most). With larger analyses the composition stage does not fit that window (new FINDING P4-T22-2 below). I recommend the owner sees this before the card is set to DONE. I set no card to DONE.

| Done-when line | Result | Test |
|---|---|---|
| Both window sizes finish with no context-length error | Met on the mock | `finishes with no context-length error and no truncation…` (32 000 / 8 192), `still clusters in two stages when the output limit does not force them…` (32 000 / 32 000), and the existing 128 000 tests |
| The 32 000 run reports more passes than the 128 000 run, and each matches its call log | Met: 12 passes against 5, both equal to the log | `reports more passes than the 128 000 run…` |
| `npm run typecheck` exits 0; `test:unit -- trendScale` under 60 s | Met, but the margin is smaller | 20 tests. 36–51 s by wall clock with other agents running, about 20 s of test run on a quieter machine |

**Coordinator's added requirements:**
- `planSynthesis` counts with the same budgets, through the shared `synthesisBudgets`.
- The `tc` and `cr` keys carry the window.
- The notes are in `docs/06` §8.4 and `docs/07` §12.4.
- Item 327(b) is kept: `endsStage` is untouched, and a new test pins that a refused theme stays one theme's failure.

**Estimate against the 0.5–0.75 d I gave:** by my judgement this came to about the top of that range, roughly 0.75 d. I have no measured clock for it. The scope grew beyond my items 1–4:
- `THEME_MERGE`'s budget
- a batch budget separate from the single-call budget
- the guards for small windows
- the critique on its own model's window

The composition limit in FINDING P4-T22-2 is not fixed and is not in that figure.

### FILES CHANGED WITH DECLARATION NAMES

**`src/pipeline/shared/estimate.ts`**
- New: `ModelWindowLimits`, `windowInputBudget`, `SynthesisBudgets`, `SynthesisBudgetsInput`, `synthesisBudgets`, `SynthesisModel`.
- Changed: `packThemeMembers` (`inputBudget`), `maxPartialsPerMerge` (`mergeInputBudget`), `worstSummariesPerThemeCall`, `themeStageReservation` (`budgets`), `synthesisCall`, `SynthesisPlanInput`, `planSynthesis`.
- Callers of the new functions: `execute` in the pipeline and `planSynthesis`. `limitsOf` and `windowLimitsOf` in `trendReportPipeline.ts` build the limits.

**`src/pipeline/trendReport/cluster.ts`**
- `ClusterInput` gains `batchInputBudget` and `mergeInputBudget`.
- New `checkedBudget`; changed `CheckedStage`, `checkStage`, `clusterThemesTwoStage`.

**`src/pipeline/trendReport/themeAnalysis.ts`**
- `ThemeAnalysisInput` gains `inputBudget` and `mergeInputBudget`.
- `packThemeSummaries` takes `inputBudget`.
- New `memberOverBudget` and `checkedBudget`; changed `analyseThemes` and the comment on `UNANALYSED_REASONS.tooLarge`.

**`src/pipeline/trendReport/trendReportPipeline.ts`**
- New `limitsOf` and `windowLimitsOf`.
- `prepare` passes limits to the estimate.
- `execute` builds `budgets` and `windowInput` and hands the budgets to all four stages; `tcKey` and `crKeys` carry the window.
- `critiqueModel` is now resolved earlier in `execute`, because the budgets need it.

**Tests**
- `test/unit/pipeline/trendScale.test.ts`: three `it.skip` changed to `it`; `WindowProfile` gains `critiqueContextWindowTokens` and `analysisPadTokens`; new `clampedOutput`, `themesGivenUp`, `SMALL_WINDOWS` and two new describes.
- New tests also in `estimate.test.ts`, `trendCluster.test.ts`, `trendThemeAnalysis.test.ts`.
- `trendReportPipeline.test.ts`: `HarnessOptions.contextWindowTokens` plus one cache-key test.

Formatting was run on `estimate.ts` and the test files.

### DOC NOTES ADDED

- **`docs/06` §8.4:** "As built 2026-11-02": the rule, two stages, sub-batches and merges (the 11-partial ceiling becomes 6 at 32 000 / 8 192), composition and critique, the estimate, the cache.
- **`docs/07` §12.4:**
  - the old note's "the fix is not built" is struck;
  - new "As built 2026-11-02" note;
  - new "Measured 2026-11-02" note with FINDING P4-T22-2;
  - reading 5's `stageInputs` amended.
- **`plan/07` `P4-T22`:** new dated note naming the declarations and the limit of what the tests prove.

`docs/07` and `plan/07` also have other agents' uncommitted hunks, so commit by hunk. I did not touch `plan/00` or run `index:derive`.

### COORDINATOR-LEVEL DECISIONS YOU TOOK

All are DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313). (a) and (b) are recorded as decided in `docs/06` §8.4's note. (c) to (h) are recorded here and described in the notes as behaviour; please confirm that is enough.

- **(a) The formula.** The budget uses the existing `windowRoom` inequality with its 1.15 headroom, not the no-headroom formula from my scratch copy. The map stage already uses this rule, so there is one formula. It is about 13% tighter than the scratch copy.
- **(b) Wider scope.** `THEME_MERGE` and a batch's own ceiling are included. Without them a merge could go over the window, and a window under about 25 000 with a high output limit could falsely refuse clustering.
- **(c) Unknown output limit.** It takes the prompt's ceiling whole. `REPORT_OUTPUT_LIMIT_UNKNOWN` (8 192) is not used for the window sum, because nothing clamps `max_tokens` to it.
- **(d) Critique model.** The critique uses the critique model's window and limit, in both the run and the estimate. The prompt-token counts use the report model's calibration, the same call the estimate makes, so the run and the estimate compute one figure.
- **(e) Composition overhead.** It is 0 in the budget, because `prepareComposition` measures the whole rendered request. The plan still adds it when pricing, a small over-statement as before.
- **(f) Over-budget summary.** One summary alone over the reduce budget gives `theme_too_large`, one theme's failure in line with item 327(b). It does not throw a `RangeError`.
- **(g) One-call themes.** A theme that fits one call is sent even when the merge limit is 0.
- **(h) Cache keys.** The window goes into `tc` and `cr` only when known, so unknown-window keys are unchanged. Models with a known window miss their old entries once, which means one re-spend after this ships.

### RUNS

| Check | Result |
|---|---|
| `npm run typecheck` | 0 |
| `npm run lint:check` (`eslint .` plus prettier) | 0 |
| `npm run test` | Unit 5 394 passed in 113 files; contract 84 passed, 28 skipped |
| `trendScale`, 3 runs in a row | 20 of 20 each, 51.1 / 35.6 / 36.2 s |

**Earlier full run:** one failure in `test/unit/i18n/keys.test.ts`, on `L10N_MENU_ITEM_FIND_RELATED`, while another agent was editing `src/i18n/keys.ts`. A grep at that moment also listed `src/zotero/db.ts` for a `MUTANT` mark. Both had cleared on the re-run, so this is not a regression.

**Measured, 400 items:**

| Profile | Passes | `THEME_CLUSTER` | `THEME_MERGE` | `CLUSTER_REDUCE` | Merges | Report | Critique |
|---|---|---|---|---|---|---|---|
| 32 000, both output limits | 12, equal to the log | 8 (7 batches, 1 re-run) | 1 | 28 | 10 | 1 | 1 |
| 128 000 / 32 768 | 5, unchanged | 2 | 0 | 20 | 9 | 1 | 1 |

- On 32 000 nothing was refused, no theme was given up, and the largest input plus clamped output was 29 524.
- The confirmed estimate on 32 000 reserved 7, 1, 45, 13, 2 and 1 calls by kind, so at least what the run made. The clustering re-run is not reserved, by the existing rule.

**Mutants:** 30, on a scratch copy only, each restored and checked by SHA-256. The copy is deleted, and `src/` and `test/` now have no `MUTANT` mark.
- 29 were killed.
- M28 survived. It moves the `fits` packing-defect check back to the fixed budget, and I judge it equivalent because the packer already guarantees that bound.
- M29's first form failed by a reference error rather than by logic, so I re-ran it in a valid form; it was killed by the intended tests.

### SRC FIXES NEEDED

None for FINDING P4-T22-1. FINDING P4-T22-2 would need a change if the owner chooses option 1 or 2 below.

### CONTRADICTIONS/FINDINGS

**FINDING P4-T22-2 (new): the composition budget limits small windows, because theme analyses are never trimmed.** The mock's analyses are at most 84 tokens, while `CLUSTER_REDUCE`'s ceiling allows 3 000. With 11 themes:

| Window / output limit | Composition budget | Analysis size that succeeds | Analysis size that fails |
|---|---|---|---|
| 32 000 / 8 192 | 20 006 | 1 435 tokens each | 1 484 tokens each |
| 32 000 / 32 000 | 7 130 (Korean 4 521), since the 23 000 report ceiling takes the rest | 235 tokens each | 284 tokens each |
| 48 000 / 8 192 and 64 000 / 8 192 | not limiting at this size | 2 584 tokens each | not reached |

- Each failure is a clean `CONTEXT_LENGTH` before the report request: no report row, nothing refused. The earlier stages' spend is already gone by then.
- Two tests pin this, both named FINDING P4-T22-2.
- No live run has measured a real analysis's size, so I cannot say how close real runs are. The 32 000 / 32 000 case looks very likely to fail on real analyses, and that is the shape `parseCatalogueEntry` gives a model with no stated completion limit.

**Smaller findings:**
- **Small windows on the mock:**
  - 24 000 and above at the 8 192 limit: every theme analysed.
  - 14 000 to 20 000: the run "succeeds" with 10 of 11 themes given up, each named in the report's §4.
  - 8 000 to 12 000: the no-theme stop.
  - 7 500: the merge stop.
  - 6 000 and 7 000: `STRUCTURED_OUTPUT`, after 400 clustering requests at 6 000 and 58 at 7 000. The estimate does count those batches. I suspect the mock's answers to very small batches are the cause, but did not confirm it.
  - 5 000 and below: `CONFIGURATION`, with no request.
  - No `RangeError` and no refused request anywhere.
- **`view.themes.done`:** `execute` sets it to `analysis.themes.length` after Analysing, so it counts given-up themes as done. This is existing behaviour and I left it alone. The progress display can show 11 of 11 when only 1 was analysed.
- **Figures changed from my first report:** because of decision (a), `CLUSTER_REDUCE` is now 28 (was 24) and the largest request 29 524 (was 30 991).
- **Mock does not clamp:** the mock does not clamp `max_tokens` as the real mapper does, so the log shows 23 000 on the 8 192 profile. My new test applies the clamp itself (`clampedOutput`).

### OWNER-ONLY AMBIGUITIES

**Question 1 (scope, FINDING P4-T22-2): what should a 32 000-token window do when real analyses do not fit composition?** Item 327(a) says both windows must work and names no minimum, and today that holds only for small analyses. The options:
1. **Recommended: make room at composition.** Lower the report's `max_tokens` when input needs the space, then shorten analyses by dropping secondary fields, with a warning in the report. This changes report content on small windows. My rough estimate is 0.5–1 d, and the test would use realistic analysis sizes.
2. **Warn before spending.** Have the estimate warn before the run when the window cannot hold K analyses at a stated size.
3. **Accept it.** Keep the clean `CONTEXT_LENGTH` and accept that large analyses need a window of about 48 000 or more. That effectively names a minimum, which needs the owner's word.

**Question 2: should the card close?** By item 327(a)'s letter, the card closes now that the three tests run unskipped. I recommend the owner answers Question 1 first, because the offline proof is weaker than it reads.

### WHAT I DID NOT CHECK

- No build, no Zotero, no integration suite. The coordinator runs integration afterwards.
- No live model call and no real analysis sizes.
- A model with a calibration factor: the mock has none, so calibrated prompt-token counts were not exercised end to end.
- Korean and `both`: only the budget figures are tested; no Korean run at scale, since `P4-T21` is not built.
- Whether a real provider also rejects input plus `max_tokens` over the window. The new test keeps that sum within the window at the four window profiles it tests, but only when `max_tokens` is clamped.
- Truncation of the real report at an 8 192 limit. A 23 000-token ceiling clamped to 8 192 is existing behaviour; the mock's reports are short, so this is untested.
- A resumed run across a window change, beyond the cache-key test.

Scratch scripts are in `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p4t22` (`mutants3.log`, `mutants3.js`, `scan3.jsonl`). Nothing is committed.

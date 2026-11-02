# P4-T22-fix2 — report of the executing agent (saved verbatim, 2026-11-02)

P4-T22 second fix: the report for FINDING P4-T22-2 (owner's option 1, "make room at composition"). Built. Not committed; no card set to DONE.

## VERDICT

**Built in the owner's order, and proved on the requested grid. One limit needs the owner's attention: a 32 000 window does not hold analyses at the 3 000 ceiling.** It holds them up to 2 200 tokens each and stops at 2 300. The stated minimum for the ceiling is 38 500.

**Each requirement and its proof:**

| Requirement | Proof |
|---|---|
| (1) `max_tokens` comes down when the input needs it, to a chosen floor | `trendCompose.test.ts`: "(1) lowers max_tokens only as far as the input needs, and the word target follows". `trendScale.test.ts`: the 64 000 / 64 000 Korean run |
| (2) Only then, secondary fields are dropped | `trendCompose.test.ts`: "(2) only at the floor drops fields, in the stated order, across every theme, never the required ones" |
| (3) The report says so | `trendScaffold.test.ts`: "the report says what the composition changed to fit" (5 tests) |
| Korean and `both` | Whole runs in English, Korean and `both`, listed under RUNS |
| The critique still fits | `expectFitted` in `trendScale.test.ts`, including one run with a critique rewrite on 32 000 / 32 000 `both` |
| The estimate does not under-state and still counts what the run makes | `expectFitted` in every succeeded run; `estimate.test.ts`: "planSynthesis prices each report call at the floor's input and the ceiling's output" |
| Analyses up to 3 000 over 11 themes on the five profiles, three languages | The 105-run grid, under RUNS |
| The two FINDING P4-T22-2 tests replaced | A new describe block in `trendScale.test.ts`, 8 always-on tests |
| A clean stop before the report request where it cannot fit | "32 000 / 8 192 at the ceiling, both", and "the stated minimum at the ceiling" |

**The floor is 8 192 tokens, for three reasons:**
- 8 192 is the common real output limit, and is already `REPORT_OUTPUT_LIMIT_UNKNOWN`.
- By the `docs/12` §10 derivation run backwards, it holds about 1 390 English or 1 234 Korean words. That is inside the shortest band of `docs/06` §9.2 (1 200–1 800 words).
- Below about 7 994 tokens, a Korean report would be asked for fewer words than that band promises any corpus.

**The word target moves with the output.** A lower `max_tokens` with the same target would invite `OutputTruncatedError`, which is not retried and loses a paid report. So `{{TARGET_WORDS}}` follows the output, by the same derivation.

**Stated minimum window (measured on whole runs):**

| Analyses over 11 themes | Minimum window (8 192 limit, or limit equal to the window) |
|---|---|
| 2 950 tokens each, about 40% narrative (the split is an assumption) | **38 500**; stops at 38 000 |
| 3 000 tokens each, all narrative, so nothing can be dropped | **60 000**; stops at 58 000 |
| 2 500 tokens | 36 000 |
| 2 000 and 2 200 tokens | 32 000 |
| 1 500 tokens | 30 000 |
| 1 000 tokens | 26 000 |
| 500 tokens | 23 000; below that, themes are given up as before, with no stop |

The middle rows come from a grid in steps of 1 000 or 2 000 tokens, so the true minimum can be somewhat lower.

**What the reader gets at the minimum is much reduced.** At 38 500 the report asks for 1 390 English or 1 234 Korean words where 4 250 were asked for, with all five droppable fields gone.

**Time against the 0.5–1 d estimate:** unmeasured, because no clock was kept. By judgement only, about 0.75 d, inside the estimate.

## FILES CHANGED WITH DECLARATION NAMES

**Source**
- `src/pipeline/shared/estimate.ts`:
  - new `REPORT_OUTPUT_FLOOR`
  - `SynthesisBudgets.reportAtFloor`, set in `synthesisBudgets`, read by `planSynthesis`
  - `planSynthesis` now prices report calls at `reportAtFloor`
- `src/pipeline/trendReport/compose.ts`:
  - new `targetWordsForOutput`, `DROPPABLE_ANALYSIS_FIELDS`, `DroppableAnalysisField`, `CompositionFit`, `OUTPUT_LOWERED_WARNING`, `ANALYSES_SHORTENED_WARNING`
  - private constants `REPORT_TOKENS_PER_WORD`, `REPORT_MARKDOWN_TOKENS`, `REPORT_OUTPUT_PER_VISIBLE_TOKEN`
  - private functions `shortenedAnalysis`, `droppedFieldsNote`
  - `ComposeInput.windowLimits`; `CompositionPlan.maxOutputTokens` and `CompositionPlan.fit`
  - `prepareComposition` makes room; `composeReport` sends `plan.maxOutputTokens` and the note
- `src/pipeline/trendReport/trendReportPipeline.ts`:
  - `execute` passes `windowLimits`
  - `stageInputsOf` is now exported and carries `MAX_OUTPUT_TOKENS` and `ANALYSES_DROPPED`, only when set
- `src/pipeline/trendReport/scaffold.ts`:
  - new `fitLines`, written under the title and in the Appendix B parameters
  - `ScaffoldInput.composed` gains an optional `plan`
  - the Appendix B target reads the plan of the draft that shipped
- `src/pipeline/trendReport/reportLabels.ts`:
  - new `fitOutputLowered`, `fitAnalysesShortened`
  - both are on `KO_REPORT_LABELS_PENDING_REVIEW`

**Tests**
- `test/unit/pipeline/trendCompose.test.ts`: `targetWordsForOutput`, the order of steps, the stated minimum, and a composition grid that always runs (8 window pairs × 5 sizes × 2 languages).
- `test/unit/pipeline/trendScale.test.ts`:
  - `fullAnalysisAnswer`, `filler`, `entries`, `targetWordsOf`, `reportCalls`, `expectFitted`, `deliveredOf`
  - `WindowProfile` gains `analysisTokens`, `language`, `writeTargetLength`, `rewriteOnce`; `analysisPadTokens` is removed
  - the mock now clamps `max_tokens` to the limit, as the provider does
  - `themesGivenUp` now reads the report's language; it miscounted Korean reports before
  - `newReportId` is now a counter
  - the on-demand grid is behind `P4T22_FIT_MATRIX`
- `test/unit/pipeline/trendScaffold.test.ts`: the label and warning tests.
- `test/unit/pipeline/estimate.test.ts`: `reportAtFloor` and pricing.
- `test/unit/pipeline/trendKorean.test.ts`: the "Korean cannot fit" size is now `padWords: 729`. Another agent, working on item 334(d), rewrote that test's expectations while this work ran.

## DOC NOTES ADDED

All dated 2026-11-02.
- `docs/06` §8.4: new "As built" note holding the rule. Point (4) of the earlier note is struck through as superseded.
- `docs/06` §9.2: a short note that the target sent can be below the table.
- `docs/07` §12.4:
  - FINDING P4-T22-2's text now says what is built, and that its figures describe the code before the fix
  - the `P4-T21` sentence "Not fixed here" is struck through
  - a new "Measured" note holds the stated minimum and the grid
- `docs/12` §10: `max_tokens` and `{{TARGET_WORDS}}` can be below the derivation's figures, with no prompt version bump.
- `plan/07` `P4-T22`: an "As built" note naming the callers.

## COORDINATOR-LEVEL DECISIONS YOU TOOK

Each is recorded in `docs/06` §8.4's note as decided under `plan/00` §6 item 313.
1. The floor is 8 192.
2. The digest steps stay ahead of lowering `max_tokens`, so a request that fit before is sent exactly as before.
3. `max_tokens` is lowered only as far as the input needs, not straight to the floor. Room freed by a dropped field goes back to `max_tokens`.
4. The field order is `representativePapers[].why`, `methodologicalPatterns`, `gaps`, `convergentFindings`, `contradictions`. The most recoverable from what is still sent goes first; contradictions go last because no digest can show one.
5. Fields are dropped from all themes alike, not from the smallest themes first.
6. **The word cap also applies to a model's known output limit on any window, not only small ones.** See OWNER-ONLY AMBIGUITIES, item 2.
7. When fields are dropped, `{{REVISION_NOTES}}` carries an English note saying their absence is not evidence. Without it, §7's prompt rule "if the corpus contains no contradictions, say so" would produce a false statement.
8. The warning appears both under the title and in Appendix B.

## RUNS

**Checks, final state, with the key removed from the environment:**
- `npm run typecheck`: clean on the last run. One error appeared in the run before it and was gone when re-run with no edit from this card in between.
- `npx eslint .`: clean on the last run, on the same pattern (2 errors, then none).
- Prettier: clean.
- `npm run test`: 118 files, 5 859 passed, 105 skipped; second project 84 passed, 28 skipped. The 105 skipped are the on-demand grid.
- `trendScale` wall-clock, three times: 46.0 s, 46.4 s, 43.8 s. The limit is 60 s. 26 tests passed each time.

**Grid (on demand):** 105 whole runs, on the final code.
- Coverage: 7 window pairs (32 000 / 8 192, 32 000 / 32 000, 48 000 / 8 192, 48 000 / 48 000, 64 000 / 8 192, 64 000 / 64 000, 128 000 / 32 768) × 5 sizes (1 000, 1 500, 2 000, 2 500, 2 950) × 3 languages.
- No request was refused. 93 runs succeeded. 12 stopped with `CONTEXT_LENGTH` before any report request, all on the two 32 000 pairs at 2 500 and 2 950.

| Window / limit | At 2 950 tokens each |
|---|---|
| 48 000 / 8 192 and 48 000 / 48 000 | fits, with the details behind sections 4, 5 and 8 dropped |
| 64 000 / 8 192 | fits, nothing dropped |
| 64 000 / 64 000 | `max_tokens` 14 571 English or 14 518 Korean, nothing dropped |
| 128 000 / 32 768 | no lowering or dropping; only the existing digest trimming |

Extra runs fixed the 2 200 / 2 300 limit at 32 000 and the 38 000 / 38 500 limit.

**Mutants:** 32 run on a scratch copy, all killed. Two survived at first (`A12`, `A21`); tests were added and both are now killed. The copy was restored after each mutant and then deleted. A grep for `/* MUTANT` over `src` and `test` finds nothing.

## SRC FIXES NEEDED

None outstanding.

## CONTRADICTIONS/FINDINGS

1. **`docs/07` §12.4's reading 19 is now out of date on one point, not edited here.** It says Korean's budget is the smaller. At the floor both budgets are equal, so Korean alone now fails only in a band of about 46 tokens, the difference between the two templates. Another agent is editing that reading under item 334(d), so the coordinator should have it corrected.
2. **`trendKorean.test.ts`'s `padWords: 729` is brittle.** It sits inside that same 46-token band, so any change to either template's size can break the test without any fault in the code.
3. **An existing over-statement, not a defect.** At 128 000 the estimate plans two-stage clustering, because it assumes worst-size digests, while the run uses one call. So only the report call's output is compared per call in `expectFitted`.

## OWNER-ONLY AMBIGUITIES

1. **Is 38 500 acceptable, given that 32 000 stops above 2 200 tokens per analysis?** The approved steps are used up at that point. Two options go further, and neither is approved or built:
   - Send no digests at all at the last step. That saves about 8 600 tokens, which by arithmetic (not measured) brings the 2 950 minimum to about 28 600, so 32 000 would hold the ceiling.
   - Cut the narratives.
2. **The word cap on a known output limit reaches beyond small windows.** The owner was told about content changes on small windows. A model limited to 8 192 on a large window is now also asked for at most 1 390 English words. Asking it for 4 250 is a certain truncation (9 861 visible tokens). Asking for about 2 500 might have fit on a model that does little reasoning, so that case is now shorter than it needed to be. No model in `docs/12` §10's table is affected, since all allow 64 000 or more. To limit the cap to small windows, change `wordsAt` in `prepareComposition`.
3. **Korean wording for approval.** Until approved, a Korean report shows the English lines. Drafts:
   - `fitOutputLowered`: `보고서 모델의 한도로 이 보고서에 출력 토큰을 {output}개만 쓸 수 있어, {words}단어 분량으로 요청했습니다.`
   - `fitAnalysesShortened`: `보고서 모델의 컨텍스트 창에 맞추기 위해 주제 분석을 {sections}절의 세부 내용 없이 보냈습니다. 따라서 해당 절의 내용이 분석 결과보다 적을 수 있습니다.`

## WHAT I DID NOT CHECK

- **Any live model.** No real analysis size is measured, so the 40% narrative split behind 38 500 is an assumption. The 60 000 figure does not depend on it.
- **Whether a real model keeps to the lowered word target,** or how good a report is with fields dropped. The mock writes filler text.
- **Whether the English note to the model works** in a Korean request.
- **The `rp` cache across two whole runs on different windows.** Only `stageInputsOf` is tested directly.
- **Build and Zotero.** Neither was run, as instructed; `P5-T15` owns those.
- **`npm run index:derive`.** Not run.

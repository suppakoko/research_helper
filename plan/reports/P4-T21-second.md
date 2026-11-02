# P4-T21-second — report of the executing agent (saved verbatim, 2026-11-02)

P4-T21 SECOND REPORT, 2026-11-02: what changed since the first report

VERDICT: all four changes are in and pass at unit level. Nothing has run in Zotero: no build, integration run or Zotero start. Nothing is committed and no card is set to DONE. The card should stay open until the integration round.

**Checks that are not clean, from another agent's files.** `npm run typecheck` exited 0 at about 14:22. It now exits 2 on one error, in `scripts/eval-trend-report.ts`, which another agent changed at 14:29. `npm run lint:check` fails on two irregular-whitespace errors, in that script and in `test/unit/scripts/evalTrendReport.test.ts`. None of the three errors is in a file I edited.

**1. `menus.spec.ts` "one selector" (item 334(k)): corrected, not yet run**
- The count now uses `menulist:not(#rh-report-shown)`, so any other menulist, including a model dropdown, still fails the check.

**2. Why the notice spec timed out: found by reading, fixed, not yet run**
- The notice is shown correctly. The spec was looking in the wrong place.
- Zotero 10.0.3's `chrome/content/zotero/xpcom/progressWindow.js` shows `changeHeadline` writes the text into the `value` attribute of a label inside `#zotero-progress-text-headline`, so it is never in `textContent`.
- The spec now reads that attribute through a new helper, `noticesNaming`. It only counts windows naming this test's collection, because `ProgressWindowSet.closeAll` can skip a window and other notices may still be open.
- New measurement to watch: that headline label has `crop="end"`, so I added a check that the whole sentence shows. The spec also logs the label and window widths. If it fails, either the notice is cut off or this measure is wrong; look at the logged widths first.
- Earlier suite: `P5-T15-second.md` lists only two failures, so the first `both` window spec passed in those runs.

**3. A `both` run where Korean fails (item 334(d)): built**
- `execute` in `src/pipeline/trendReport/trendReportPipeline.ts` now saves English alone when Korean fails at composition, critique, bibliography, scaffold, note rendering or saving its row.
- In those cases the job ends `succeeded`, `reports` holds one delivery, and `TrendReportOutput.stop` carries `research-helper-report-stopped-korean`. The window already drew `stop` beside the outcome, so `reportViewModel.ts` needed no code change.
- A user's cancel, a "stop" answer at a pause, and a shutdown still save nothing. A failure of the English report, or of a stage both reports share, still fails the run.
- New declarations, all in the pipeline file: `KOREAN_NOT_WRITTEN_L10N`, `KoreanNotWrittenReason`, and `koreanNotWritten` (caller `execute`; nothing constructed). `TrendReportStop.args` now also takes strings.
- Coordinator-level decisions, recorded in `docs/07` §12.4 readings 19 and 20 and `docs/08` §6.3:
  - **Korean found not to fit during planning:** the run stays a stop before any report request. It spends nothing on either report, and the Language list and Generate stay available for English alone. The window says no report was written, nothing was spent on either report, every summary already made is kept, and to choose English and generate again.
  - **Other planning errors:** treated as a defect, so the run fails as before.
  - **Korean row stored but its note write threw:** the report is delivered without a note and with no line, because it was written.
- Limit recorded: a resumed `both` run that ends this way with no window open tells nobody; only the debug log has it.

**4. Jobs left `interrupted` (item 334(j)): built, and the window gap is closed**
- The window did not ask about these jobs, because `askPausedJob` listed only `paused`. It was small enough to close.
- New in `src/pipeline/trendReport/pausedReportNotice.ts`:
  - `waitingReportJobs`: callers `announcePausedReports` and `askPausedJob`.
  - `pausedForAnswer`: caller `askPausedJob`. It moves the job to `paused` with reason `user`, because `interrupted` may not go to `running`.
- Decision recorded in `docs/07` §12.4 reading 24: the rule is the record's status, so a job left `interrupted` because a resume guard threw is also announced and asked about.
- Question wording: the `other` line, "A report run for this collection was paused."

**New string (one id)**
`research-helper-report-stopped-korean`, main window, with `$reason`. The en-US entry and ko-KR `# NEEDS REVIEW` stub are in, and the id is on `KO_PENDING_REVIEW`. The Korean below is in no bundle.

| Reason | en-US | Korean draft |
|---|---|---|
| `no-room` | No report was written, and nothing was spent on either report: the Korean report does not fit this model's limits. Every summary already made is kept. To get the English report, choose English under Language and generate again. | 보고서를 쓰지 않았고, 두 보고서 모두 비용이 들지 않았습니다. 한국어 보고서가 이 모델의 한도에 맞지 않습니다. 이미 만든 요약은 모두 남아 있습니다. 영어 보고서가 필요하면 언어에서 English를 고르고 다시 생성하세요. |
| `structure` | The English report is saved. The Korean report was not written: asked twice, the model did not return it with its eleven required sections in order. To try again, choose the Korean report under Language and generate. | 영어 보고서는 저장했습니다. 한국어 보고서는 쓰지 못했습니다. 두 번 요청했지만 모델이 필요한 11개 장을 순서대로 갖춘 보고서를 돌려주지 않았습니다. 다시 시도하려면 언어에서 한국어 보고서를 고르고 생성하세요. |
| `finishing` | The English report is saved. The Korean report was written but could not be finished and saved. To try again, choose the Korean report under Language and generate. | 영어 보고서는 저장했습니다. 한국어 보고서는 작성했지만 마무리해 저장하지 못했습니다. 다시 시도하려면 언어에서 한국어 보고서를 고르고 생성하세요. |
| `request` (default) | The English report is saved. The Korean report was not written, because a request to the model failed. To try again, choose the Korean report under Language and generate. | 영어 보고서는 저장했습니다. 모델에 보낸 요청이 실패해 한국어 보고서는 쓰지 못했습니다. 다시 시도하려면 언어에서 한국어 보고서를 고르고 생성하세요. |

**Files changed**
- Source:
  - `D:\KIST\projects\research_helper\src\pipeline\trendReport\trendReportPipeline.ts`
  - `D:\KIST\projects\research_helper\src\pipeline\trendReport\pausedReportNotice.ts`
- Shared files, exact-string edits only:
  - `D:\KIST\projects\research_helper\src\bootstrap\registerUI.ts`: the imports and `askPausedJob` (the two helpers replace the old list and filter; `record` replaces `paused` on continue).
  - `D:\KIST\projects\research_helper\src\i18n\keys.ts`: the id in `MAIN_WINDOW_MESSAGE_IDS`, `KO_PENDING_REVIEW`, `FluentMessageArgsMap` and `ARGUMENT_MESSAGE_IDS`.
- Typings and bundles:
  - `D:\KIST\projects\research_helper\typings\i10n.d.ts`
  - `D:\KIST\projects\research_helper\addon\locale\en-US\research-helper-mainWindow.ftl`
  - `D:\KIST\projects\research_helper\addon\locale\ko-KR\research-helper-mainWindow.ftl`
- Documents, with dated notes:
  - `D:\KIST\projects\research_helper\docs\07-architecture-and-data-model.md`: §12.4 readings 19, 20, 23 and new 24.
  - `D:\KIST\projects\research_helper\docs\08-ui-ux-spec.md`: §6.3.
  - `D:\KIST\projects\research_helper\plan\07-phase-4-trend-report.md`: a note on my own card; estimate unchanged.
- Unit tests:
  - `D:\KIST\projects\research_helper\test\unit\pipeline\trendKorean.test.ts`: two tests that expected "neither" or `failed` now expect the new behaviour, plus new cases.
  - `D:\KIST\projects\research_helper\test\unit\pipeline\pausedReportNotice.test.ts`
  - `D:\KIST\projects\research_helper\test\unit\ui\reportViewModel.test.ts`
  - `D:\KIST\projects\research_helper\test\unit\i18n\keys.test.ts`
- Integration specs, written and not run:
  - `D:\KIST\projects\research_helper\test\integration\menus.spec.ts`
  - `D:\KIST\projects\research_helper\test\integration\reportWindow-flow.spec.ts`: the notice spec corrected, plus two new tests, "a report job left interrupted gets the same one notice…" and "a both run whose Korean report stops saves the English report and says why…".

**Runs (with `OPENROUTER_API_KEY` removed)**
- `npm run test`: 117 files, 5 767 passed and 105 skipped, then contract tests 84 passed and 28 skipped.
- `npm run test:unit -- trendKorean`: 34 of 34.
- Prettier is clean on every file I edited, and `npx eslint` was clean on the source and test files when I last ran it on them. That run predates the two small test additions and the view model test, which only the blocked `npm run lint:check` has covered since.
- The case-sensitive `/* MUTANT` grep over `src` and `test` is empty.

**Mutation sweep (scratch copy): 25 mutants, 22 killed, 3 survived, no defect shown**
- `keep-on-cancelled-token`: the next `throwIfCancelled` gives the same outcome. I kept the check so that no checkpoint is written during a shutdown.
- `round-no-break`: Korean is the last round, so the loop ends anyway.
- `drafted-ignores-bibliography`: the tested result does not change. I did not confirm why; I suspect the scaffold itself refuses the empty bibliography.

**Lines unproved until the integration round**
- The corrected `menus.spec.ts` check.
- The corrected notice spec, including the new crop check.
- The interrupted-job spec. It calls the real `graph.jobs.recover()` in the live session, which would also turn any job still running from an earlier test into `interrupted`.
- The Korean-stops spec, including real English Fluent resolution of the new string.

**Still proved by no test**
- The actual call at Zotero's start in `publishReportWindowCommands`; the specs call the same `announcePaused`.
- The Korean text of the new string, until `G-41` review.

**Owner-only**
- The Korean drafts above (`G-41`).

**Coordinator note: the interrupted case may not match the approved wording.** The approved notice says "paused" for interrupted jobs too. I read item 334(j)'s "same notice" as covering that and did not change the approved text.

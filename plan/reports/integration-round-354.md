# integration-round-354 — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: The round is clean. Three consecutive runs on the final tree each ended with exit code 0 and 345 passed, 0 failed, 2 pending. Every proof line for P5-T26, P5-T27 and P5-T28 is proved, except one line proved only in part (P5-T27 line 4). The round found five real product defects, all fixed at the cause, each with a unit test and a spec. Three of the five predate this round and affect the keyword window too. One existing unit assertion was changed because it stated one of the defects as correct (see Defect 2). Nothing was committed, no card was set to DONE, `plan/00` was not edited, no Korean was added, no key was used, and no live request was made.

The two owner decisions are at the end of Findings.

TYPINGS HASH RESULT
Same before and after `npm run build`, at the start and again on the final tree. The generator reproduces the hand edits of `typings/i10n.d.ts`.
- `global.d.ts` 020956c7f456
- `i10n.d.ts` a787e3c91094
- `prefs.d.ts` a9aa2d93d36b
- `prompts.d.ts` 4480d7967afb
- `zotero-augment.d.ts` cf994969fc0b

PROOF LINES

P5-T26
1. Real menu entry absent with `recommend.enabled` off and present with it on, after a plugin cycle: proved. New real-menu assertions in `menus.spec.ts`.
2. `menus.spec.ts` and `l10n.spec.ts` compile and pass: proved.
3. Real window opens in recommend mode and sends nothing on opening: proved.
4. Layout: proved, after Defect 1 was fixed.
   - Panel height against the table: see Defect 1 and Screenshots.
   - Chips: 20 chips on 5 lines, furthest right edge 886 of 944.
   - `html:button` and `html:input` inside the dialog: work.
   - Fluent `.title`, `.aria-label` and `.placeholder` on HTML elements: draw.
   - Enter in the term box: adds the term, focus stays, the dialog's accept is not reached. A control test shows Enter on the filter box does reach accept.
5. ko-KR counts recorded: 353 present, 117 absent. The report's forecast of 86 did not count P5-T27's 31. The arithmetic is 48 + 38 + 31.
6. Real `recordEgress` failure: proved at pipeline level and in a real window (see Added checks).
7. Real Build profile under the guard, cost dialog before any model call: proved on a fake provider in the real registry's slot. 0 model calls before the answer, then 1 model call and 1 egress record.
8. `api.recommendWindow` withdrawn at shutdown and the window closes: proved during a running run, with 0 toasts from shutting down and 0 live handles.

P5-T27
1. `recommendFlow.spec.ts` passes, 8 rows read, the sources preference holds and is restored: proved.
2. `l10n.spec.ts` resolves all 31 ids in both locales: proved. Absent count grew by 31.
3. Range slider works in a dialog and `.aria-label` lands on it: proved. Slider is 158 x 22 px; keys move it 25 to 30 to 25.
4. Heading row lines up with the hidden columns: proved only in part. Measured on a list drawn by hand through the real table: colSpan 6, 6 columns, left edges 13 and 13, right edges 1006 and 1006. A heading row from real topic centroids was not provable, because that needs vectors, and vectors need a key.
5. Enter on Not interested and on the slider does not accept, and one press dismisses one row: proved.
6. Focus after a dismissal moves to the next row's button: proved.
7. Table usable at 1019 x 600: failed at first, proved after Defect 1. Header 80 px, table 226 px, three to four whole rows, OK inside the window.
8. Real nested subcollection, second import the same day reuses it: proved.
9. Real `reject` on the real store, the row stays out of the next run: proved.
10. `existingItemIDs` links a real title-matched item: proved. One item holds the title, and the owned item's id is kept.
11. XUL checkbox `.label` and `html:span` values render: proved.

P5-T28
1. Spec bundles and reads the fixtures, including the related subdirectories: proved.
2. Both runs refuse nothing and send nothing to `api.semanticscholar.org`: proved.
3. Each list has rows in a real window, parsed by `DOMParser`: proved. Related 130 rows, recommend 30 rows.
4. Crossref row survives the fill-in with only the top 30 rows listed: proved. The assertion did not move.
5. Both notices with the key request link, status rows read "no key" and a count: proved.
6. Route and origin counts logged under `[no-key]`: done. No failure occurred to repeat.

DEFECTS

Defect 1: a long list stretched the window (predates this round, all three modes).
- Measured: 40 rows put OK and Cancel at 1639 px in a 600 px window, and the table never scrolled.
- Cause: the dialog's own content box (`::part(content-box)`) is a flex item with an automatic minimum height, so it grew with the table. Earlier measures used only a few rows.
- Fix, in `addon/content/style/searchDialog.css`:
  - Minimum height 0 on the content box and on `#rh-results-container`.
  - The recommend and related headers scroll inside themselves, with a minimum of `4em`.
  - The results area has a `45vh` floor while a table shows under one of those headers.
- A first floor on all modes pushed the keyword window's last row under OK, so the floor was narrowed to the two modes with a header.
- A media query to relax the minimum made the window open at a content height of 395 px, so it was removed.
- Tests: `searchDialog.test.ts` (unit); `searchDialog-table.spec.ts`, `searchDialog-flow.spec.ts` and `recommendWindow.spec.ts` (integration).

Defect 2: the completion toast was gone 3 ms after it was raised (predates this round, all modes).
- Cause: every view model disposes a job straight after `done()`, and `ZoteroProgressWindowSink.dispose` closed the popup.
- Fix: new `ZoteroProgressWindowSink.releaseJob`, called from the job factory in `src/bootstrap/container.ts`. Teardown still closes what it finds open.
- Measured after the fix: close at 4018 to 4087 ms after raising.
- Tests: `progress.test.ts` (three new unit tests), `keywordWindowLeftRun.spec.ts`.
- Changed assertion, for review: `test/unit/bootstrap/container.test.ts` read `firstPopup.closed() === true` after `done()` and `dispose()`. That assertion stated this defect as correct. It now reads false, with a dated comment. Its actual purpose, that a second job's surfaces are untouched, is unchanged.

Defect 3: a keyword toast had a headline over an empty line in two cases (predates this round).
- Window closed before the run ended: the words came from the window's formatter, which was gone. Fix: `toastFormatter` dependency, a Fluent `Localization` built in `src/bootstrap/registerUI.ts` that needs no window. Measured after: "0 results · 0 new".
- Cancel button, two causes:
  - `rh-error-cancelled` is in the main bundle, which the window does not link. The same `toastFormatter` fixes this.
  - The token's own `done("cancelled")` raises the surfaces first, and the run's words then found the reporter inert. Fix: `ProgressNode.done` lets a message land for the outcome already drawn.
  - Measured after: "Cancelled. 0 items were already imported."
- Tests: `searchImportViewModel.test.ts`, `progress.test.ts`, `keywordWindowLeftRun.spec.ts`.

Defect 4: a job with nothing to say raised a blank toast (Build profile, for example, or a failure whose words are in the error panel).
- This became visible only once Defect 2 was fixed.
- Fix: `ZoteroProgressWindowSink.update` raises nothing when the ending has no words.
- Test: `progress.test.ts`.

Defect 5: the Cancel toast in the recommend and related modes had no words.
- Fix: both now word a cancelled run with the existing `research-helper-search-related-status-cancelled`, "Cancelled." Measured in the recommend mode.
- Tests: `recommendViewModel.test.ts`, `relatedViewModel.test.ts`, `recommendWindow.spec.ts`.

Spec defects, with no assertion weakened:
- `recommendFlow.spec.ts`'s double answered the runner's own report to localhost, which swallowed failure text. It now passes non-live requests to the real method.
- All hand-written records shared one journal, and `MAX_PER_VENUE` is 4. Each record now has its own journal.
- `recommendWindowOn` picked the old document right after a re-open. This also caused the unexplained cost dialog timeout. It now waits for a document that was not there before the call.
- A failing test's leftover window now gets closed in the `after` hook.
- A list cached by query could add rows from another spec. Tags and the author name now carry the run's token.

ADDED CHECKS

(a) `plan/00` §6 item 350(d): the keyword window raises no left-run "cancelled" toast, so no `leaveRun`-style fix was needed. Measured in a real window on a stub source that holds its list open:
- Closing: 0 toasts, 0 lists cancelled, the run keeps going. Its end raises 1 toast with the result count.
- Re-opening: 0 toasts, 0 lists cancelled, and the new window reports `running` true.
- Cancel button: 1 toast that says cancelled.
Measuring this is what exposed Defects 2 and 3.

(b) `plan/00` §6 item 351(b): proved, with the real queue's store detached so its own `ConfigurationError` is the failure.
- `recommendLibrary.spec.ts`: outcome failed, 0 model calls, no `egress`, no record, nothing on the transport.
- `recommendWindow.spec.ts`: after the cost dialog is answered, 0 model calls, 0 records, and the panel reads "Research Helper is not configured correctly for this action."

SCREENSHOTS
Test profile and fixture data only, all under `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\`. They were taken with the final stylesheet. Only toast wording and test code changed afterwards.
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-panel-light.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-panel-dark.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-results-1019-light.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-results-1019-dark.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-results-light.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-results-large-light.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\recommend-opened-light.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round354\keyword-40-light.png`

What they show:
- Before the fix, at 1019 x 600, the header took 370 px, about one and a half table rows showed, and the buttons were off-screen.
- Results after the fix, at 1019 x 600: Build profile, Find papers, the slider and one line of terms stay visible in an 80 px header that scrolls. Below that come the table, the selection row, the import row, OK and Cancel, all in view. Light and dark both read well.
- Panel after the fix: 298 px header, with the last disclosure line cut at the header's edge and reachable by its scrollbar.
- Keyword window with 40 rows: all controls in view, table box 150 px, four rows.
- Remaining layout problem, for judgement: the table is small at the smallest window, and a reader must scroll the header to review the profile once a list shows.

STATIC CHECKS, on the final tree
- `npm run typecheck`: clean.
- `npx eslint .`: no output, clean.
- `npm run lint:check`: "All matched files use Prettier code style!"
- `npm run test`: unit 7615 passed, 105 skipped (7720). Contract 6 files, 84 passed, 28 skipped (112).

INTEGRATION RUNS
`NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`. Before each run: 0 MUTANT lines and no Zotero on the test profile. The same hash stood before each run and after the last: 2387644d34130e79.

| Run | Passed | Failed | Pending | Duration | Exit |
|---|---|---|---|---|---|
| 1 | 345 | 0 | 2 | 321 s | 0 |
| 2 | 345 | 0 | 2 | 318 s | 0 |
| 3 | 345 | 0 | 2 | 320 s | 0 |

- Pending, unchanged from last round: the real PubMed search in `phase1-dod`, and the 10 000-item index.
- ko-KR, all three runs: 353 present, 117 absent; expected 353 / 117.
- Guard, all three runs: 1197 channels read, none cancelled, away from loopback none. Hosts let through were the runner on localhost and 127.0.0.1:59321.
- No test failed in the three runs, so no failure needed the repeat rule. Subset runs before these failed only on the spec and product faults listed above.

FILES CHANGED IN THIS ROUND

Product:
- `D:\KIST\projects\research_helper\addon\content\style\searchDialog.css`: Defect 1.
- `D:\KIST\projects\research_helper\src\zotero\progressWindow.ts`: Defects 2 and 4.
- `D:\KIST\projects\research_helper\src\bootstrap\container.ts`: calls `releaseJob` (Defect 2).
- `D:\KIST\projects\research_helper\src\core\jobQueue\progress.ts`: late words on a terminal outcome (Defect 3).
- `D:\KIST\projects\research_helper\src\bootstrap\registerUI.ts`: `toastFormatter` for all three models.
- `D:\KIST\projects\research_helper\src\ui\viewModels\searchImportViewModel.ts`: `toastFormatter` dependency.
- `D:\KIST\projects\research_helper\src\ui\viewModels\relatedViewModel.ts`: `toastFormatter` dependency and cancel wording.
- `D:\KIST\projects\research_helper\src\ui\viewModels\recommendViewModel.ts`: `toastFormatter` dependency and cancel wording.

New test files:
- `D:\KIST\projects\research_helper\test\integration\pipeline\recommendWindow.spec.ts`: real window controls, layout, import, leaving a run, Cancel, cost dialog, egress failure.
- `D:\KIST\projects\research_helper\test\integration\keywordWindowLeftRun.spec.ts`: item 350(d).
- `D:\KIST\projects\research_helper\test\integration\support\recommendPage.ts`: shared transport double.

Changed test files:
- `D:\KIST\projects\research_helper\test\integration\pipeline\recommendFlow.spec.ts`: uses the shared double.
- `D:\KIST\projects\research_helper\test\integration\pipeline\noKeyRelatedness.spec.ts`: removed a stale header sentence.
- `D:\KIST\projects\research_helper\test\integration\menus.spec.ts`: real menu assertions.
- `D:\KIST\projects\research_helper\test\integration\lifecycle.spec.ts`: shutdown during a recommend run.
- `D:\KIST\projects\research_helper\test\integration\searchDialog-table.spec.ts`: 40 rows held in the window.
- `D:\KIST\projects\research_helper\test\integration\searchDialog-flow.spec.ts`: new dependency, and OK and the import row in view in the related mode.
- `D:\KIST\projects\research_helper\test\integration\zotero\recommendLibrary.spec.ts`: item 351(b).
- `D:\KIST\projects\research_helper\test\unit\core\progress.test.ts`: unit tests for the defects above.
- `D:\KIST\projects\research_helper\test\unit\bootstrap\container.test.ts`: unit test, including the changed assertion in Defect 2.
- `D:\KIST\projects\research_helper\test\unit\ui\searchDialog.test.ts`: unit test.
- `D:\KIST\projects\research_helper\test\unit\ui\searchImportViewModel.test.ts`: unit test.
- `D:\KIST\projects\research_helper\test\unit\ui\recommendViewModel.test.ts`: unit test.
- `D:\KIST\projects\research_helper\test\unit\ui\relatedViewModel.test.ts`: unit test.

Documents, dated 2026-11-06:
- `D:\KIST\projects\research_helper\docs\08-ui-ux-spec.md`: §4.3, §5.4 (the decision recorded under item 313), §8.1.
- `D:\KIST\projects\research_helper\docs\07-architecture-and-data-model.md`: §7.7, §12.5 item 8.
- `D:\KIST\projects\research_helper\docs\13-testing-build-and-release.md`: §2.3 rows.
- `D:\KIST\projects\research_helper\plan\06-human-gates.md`: ko-KR count.

KOREAN TABLE
None. No string was added. One effect to note: `research-helper-search-related-status-cancelled` is still a commented stub in ko-KR, so the related and recommend Cancel toast falls back to English until the owner's review reaches it.

FINDINGS

Re-opening during a keyword run: a window re-opened during a run reports `running` true and shows Cancel, but it draws its first panel and not the searching panel until the run ends. Left as found and recorded in `docs/08` §8.1. It blocks no finishing condition.

Window below its minimum height: the `minheight` feature applies to the outer window, so a window dragged below a content height of 600 clips the bottom of the dialog by up to 39 px, which takes most of OK. The opening size is unaffected. Recorded in `docs/08` §4.3, not fixed, because the one simple fix broke the opening size.

Toast after a disable: a completion toast of a job already over can outlast a plugin disable by up to 4 s, on Zotero's own timer. It holds nothing of the plugin's. Recorded in `docs/08` §8.1.

Closing a keyword window does not stop its requests: a keyword run goes on after its window closes, and the toast reports its end. That matches the `docs/08` §8.1 row, but it differs from the related and recommend modes, which cancel when left. The owner may want one behaviour.

Owner decision 1, opening size: at the smallest window the keyword table shows four rows and the recommend table three to four. The alternative is a larger opening size, which was not tried.

Owner decision 2, the header floor: the `45vh` floor and the scrolling header are a coordinator decision recorded under item 313. They make the profile harder to review once a list is showing, and the owner may prefer another balance.

WHAT WAS NOT CHECKED
- Real heading rows from centroids (needs vectors and a key).
- Any live service, and any real key or model. The cost dialog ran only on a fake provider.
- Layout in Korean at 1019 x 600. The layout specs and screenshots pin en-US.
- The toast seen on screen. What was measured is the calls that raise it, word it and close it, and their timing.
- A Cancel toast in the related mode in a real window. The unit test covers it; only the recommend and keyword modes were measured.
- An import cancelled in the related or recommend mode in a real window, with its words through `toastFormatter`.
- A related-window screenshot at the new floor. Only its numbers were read: table container 268 px, with OK and the import row in view.
- High-contrast mode.

# integration-round-355 — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: The finishing condition is met. At 1019 x 600, every line of the notice and every search query is in view without scrolling, with Find papers, OK and Cancel in view too. This holds on every profile measured, including the fullest one. All checks pass, and three consecutive full integration runs on the final tree each gave 346 passed, 0 failed, 2 pending. The related and keyword modes and the state with a table did not move by a pixel on any box measured.

Nothing was committed, no card was set to DONE, `plan/00` was not edited, and no Korean or Fluent id was added. No key was used and no live request was made.

One defect was found and deliberately left alone: a key notice marked `hidden` is still drawn (see Findings). The coordinator should decide on it.

## Measurement before the change (real Zotero 10.0.3, content 1019 x 600, en-US)

**`recommendWindow.spec.ts`'s collection, 20 terms, chips on 5 lines.** The header had 298 px and held 454, with its edge at 341.

| Line | Top to bottom (px) | Where it was |
|---|---|---|
| Build profile / Find papers | 43-74 | in view |
| Slider row | 74-102 | in view |
| 5 lines of chips | 102-265 | in view |
| Add a term | 267-295 | in view |
| Authors | 298-315 | in view |
| Heuristic line | 320-337 | in view |
| Notice paragraph 1, line 1 | 343-360 | under the edge |
| Notice paragraph 1, line 2 | 360-377 | under the edge |
| Notice paragraph 2, line 1 | 382-399 | under the edge |
| Notice paragraph 2, line 2 | 400-417 | under the edge |
| "Search queries" label | 422-439 | under the edge |
| The one query | 442-459 | under the edge |
| Key notice | 463-486 | under the edge |

So all of the notice was under the edge on this collection, not only its last line.

**Other profiles, same size:**
- **Same collection, chips on 4 lines:** notice line 2 was cut by 2 px, and everything after it was under the edge. The header held 421, or 469 with status rows.
- **The 30 recorded papers from `noKeyRelatedness.spec.ts`:** the header held 388. The last notice line was cut by 9 px, and the label and query were under the edge.
- **The fake model's profile:** the header held 443. Notice line 2 was cut by 2 px, and the rest, including both queries, was under the edge.

**Room held by what does nothing yet:** Filter row 32 px, placeholder area 52, Import row 36, its note 22.

The coordinator's 436 was not reproduced. The figures seen were 388, 421, 443, 454 and 469, because each run's token gives the chips different widths and so moves the wrapping.

## Measurement after the change (same size)

| Profile | Header (px it has / px it holds) | Last query ends | Result |
|---|---|---|---|
| Window spec's collection, 20 or 21 terms | 421-455 / same | 426-459 | all in view |
| The 30 recorded papers | 388 / 388 | 393 | all in view |
| Fake model's profile, 20 terms | 444 / 444 | 448 | all in view |
| With one term removed (Removed line) | 451 / 451 | 456 | all in view |
| Fullest measured: focus line, 21 terms, Removed line, 3 queries | 498 / 529 | 534 | notice and queries in view; only the key notice cut, by 19 px |
| 944 wide, the collection's true opening width | 455 / 455 | 459 | all in view |
| Find papers running | 455 / 455 | 459 | all in view, Cancel at 502-530 |

OK and Cancel stand at 559-586 in every row. The header can take at most 498 px before it scrolls.

**States outside the finishing condition:**
- **"Empty" panel:** it keeps 52 px. The notice and query stay in view. The status rows take a scroll, and so does part of the key notice on 5 lines of chips.
- **"Error" panel:** it keeps 52-64 px. Retry is cut by 7-19 px and the panel scrolls. It was cut by 19 px before, so it is no worse.

**What did not change:** the 7 baseline box readings are byte-identical before and after. They cover the recommend opening state, the recommend table, the keyword opening at its own size and at 1019 wide, the keyword table, and the related table at its own size and at 1019 wide. The recommend table still reads header 80, table 226.

**What comes back when a table shows or the profile goes:**
- With a table, a filter word typed while the row was hidden is still there, and the picker keeps "… — recommended 2026-11-06".
- With the profile gone, the boxes read the same as the opening state.

## What changed, by file

- **`addon/content/searchDialog.js`:** new `refreshRecommendRoom`, called from `showPanel`, and spec ids `filterRow`, `targetRow`, `duplicatesGroup`.
  - While a profile shows and the panel is not "results", it hides the Filter row, the Import row and the group holding its note.
  - While the panel is "initial", it also hides `rh-results-area`.
  - I kept the "empty" and "error" panels' area, a small departure from hiding everything, because they have something to say.
  - It does nothing in the other modes.
- **`addon/content/style/searchDialog.css`:** one rule removes the rule line above a row when that row is hidden. The `45vh` floor is untouched.
- **`test/unit/ui/searchDialog.test.ts`:** a new `describe` with 8 tests.
- **`test/integration/pipeline/recommendWindow.spec.ts`:** a new `it` measuring boxes at 1019 x 600, and return checks added to the table test.
- **`docs/08-ui-ux-spec.md` §5.4:** a dated note citing declarations by name, with the measurement, the behaviour, the narrowing of decision 10 and the defect below.

The recommended direction held, so no other fix was needed.

## Proof each check can fail

Each mutant was a temporary edit that was put back byte for byte, with hashes checked and the `/* MUTANT` grep empty over src, test and addon afterwards.

**Unit (U1-U18), all caught:**
- room ignoring the profile, room never taken, room kept with a table
- area hidden for "empty" and "error", area never hidden
- mode guard removed
- each row left out of the list
- `showPanel` not calling the function
- filter, tick box or picker value lost
- the rule lines staying
- results container, placeholder, "empty" panel or "error" panel taken away

**Integration, real window.** The first assertion to fail in each:

| Mutant | Assertion that failed |
|---|---|
| I1 room never taken | notice paragraph 1 above the edge: 377 against 341.9 |
| I2 rows stay hidden with a table | filter row is back |
| I3 placeholder area keeps its room | results area takes no room: 52 |
| I4 note's group keeps its room | preprint note takes no room: 17.3 |
| I5 filter value cleared | filter value: '' against 'hepatocyte' |
| I6b picker moved | picker value: 'new' against the dated default |
| I7 header capped with rows hidden | notice above the edge: only geometry sees this |
| I8 query below OK | 579 against 559 |
| I9 OK out of the window | 686 against 600 |
| I10 Cancel out of the window | 686 against 600 |
| I11 header scrolled | scrollTop 20 against 0 |
| I12 Find papers under the edge | 672 against 541.9 |
| I13 no query drawn | a search query to read |
| I14 one notice paragraph | 1 against 2 |
| I15 paragraphs swapped | notice words |
| I16 query alone under the edge | 459 against 443.9 |
| I17 filter row keeps its room | 32 against 0 |
| I18 Import row keeps its room | 36 against 0 |
| I19 area stays hidden with a table | area is back |
| I20 Import row stays hidden with a table | Import row is back |
| I21 note's group stays hidden with a table | note is back |
| I22b filter word matches no row | visible rows: 0 against 24 |

Two of my first mutants did not test what they were meant to, so I replaced them. I6 moved the picker too early to reach the picker assertion, which is why I6b exists. I22 tripped the value check first, which is why I22b exists.

Checks not mutated: `innerWidth` and `innerHeight` equal 1019 and 600, and the picker holds a non-empty default.

## Checks

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx eslint .` | exit 0, no output |
| `npm run lint:check` | exit 0, Prettier clean |
| `npm run test` | unit 7623 passed, 105 skipped; contract 84 passed, 28 skipped; exit 0 |
| `npm run build` | exit 0 |
| Typings hashes | same before and after the build, and same as the round's start: 020956c7f456, a787e3c91094, a9aa2d93d36b, 4480d7967afb, cf994969fc0b |

The command was `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`.

| Run | Passed | Failed | Pending | Duration | Exit | MUTANT lines before | Test Zotero before |
|---|---|---|---|---|---|---|---|
| 1 | 346 | 0 | 2 | 320 s | 0 | 0 | none |
| 2 | 346 | 0 | 2 | 322 s | 0 | 0 | none |
| 3 | 346 | 0 | 2 | 310 s | 0 | 0 | none |

- **Tree hash:** 25a32a186b8974d5 before and after each run, and again at the end. It covers src, test, addon, scripts and typings.
- **Guard, every run:** 1199 channels read, none cancelled, none away from loopback.
- **ko-KR, every run:** 353 present, 117 absent, as expected.
- **Pending:** the same two as last round, the real PubMed search and the 10 000-item index.
- **Repeat rule:** no run failed, so it was not needed.
- **After the runs:** I changed one phrase in `docs/08`, which is not covered by the hash, and re-ran Prettier on that file. It is clean.

## Findings

A key notice marked `hidden` is still drawn, and this defect is older than this round: `.rh-wrap`'s `display: flex` beats the hidden attribute on an `hbox`, so `#rh-recommend-key-notice` read hidden true, computed `display: flex` and 22 px, with its words and link, before any Find papers, and `#rh-related-key-notice` does the same when asked to hide, so a reader who has a Semantic Scholar key would be told "Without one, its lists are not asked" until a run ends, while unit tests pass because they read the property. I left it alone because it blocks no finishing condition and the plain fix (`.rh-wrap[hidden] { display: none }`) would change the related mode, so it is recorded in `docs/08` §5.4 for the coordinator to decide; fixing it would also give the header 22 px and clear the 19 px cut in the fullest case. Separately, a failure in the new `it` also fails the next test, because the table test reads the filter word and picker value the new `it` leaves behind, and a failure in the table test can leave the filter word in the box and time out the heading-row test; this appears only on a run that is already failing, and it showed in the mutant results.

## What was not checked

- Layout in Korean at 1019 x 600. The layout specs pin en-US, and the wrapping will differ.
- A larger Zotero font size, and high contrast. The header would scroll rather than clip, but this was not measured.
- Profile warning lines (`warningId`, `vectorsIncomplete`, `profileRebuilt`) standing above the status bar. No fixture draws one, and each would take room from the header.
- A real key or model. The fake provider stood in for the model, so the keyed path of the key notice is reasoned from the measured `hidden` state, not seen.
- The "error" panel and "profile gone" states in a real window were drawn by hand through `render`. Only "empty" came from a real run. Unit tests cover the transitions.
- The return of the rows when the profile goes has a unit test, but its real-window reading exists only in my scratch measure, not in the spec.
- A window larger than 1019 x 600 in the profile state. Hiding the rows leaves empty space above OK, and I measured no larger size. Dark mode was looked at only as a picture.

## Files

Screenshots use test profile and fixture data only, in light mode unless named dark.

Measurements:
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\measurement-before.txt
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\measurement-after-final.txt

Screenshots:
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\before-panel-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-panel-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-panel-1019-dark.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-panel-944.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-panel-f4-all-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-running-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-results-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-empty-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round355\after-error-1019.png

The same folder also holds the other before and after pictures, including the keyword and related windows.

Changed in the tree:
- D:\KIST\projects\research_helper\addon\content\searchDialog.js
- D:\KIST\projects\research_helper\addon\content\style\searchDialog.css
- D:\KIST\projects\research_helper\docs\08-ui-ux-spec.md
- D:\KIST\projects\research_helper\test\unit\ui\searchDialog.test.ts
- D:\KIST\projects\research_helper\test\integration\pipeline\recommendWindow.spec.ts

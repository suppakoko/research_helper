# integration-round-360 — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: Done. Both parts are in and their docs are written. Three consecutive full integration runs on the final tree came back clean: 355 passed, 0 failed, 2 pending each time. One earlier full run (run 1) failed on my own new test. I found the cause, fixed it, proved the fixed check can fail, and only then started the three clean runs. Nothing is committed, plan/00 is not edited, no card is set to DONE, and no Fluent id or Korean string was added.

## PART 1: the two patches (items 345(d), 348(e), 358(b))

**Cause.**
- Fix 1: `snapshotForSummary` read title, date and venue with a plain `getField`. That call answers empty for a type's own field name: a conference paper's proceedings title, a case's case name, a patent's issue date.
- Fix 2: Import's gate counts only the ticked rows. With the picker on bare "New collection…", the press did nothing visible.

**Changes by file.**
- `src/zotero/notes.ts`
  - Patch applied.
  - Your decision extended it to title and date: `snapshotForSummary` now reads title, date and venue from one `snapshotZoteroItem` read.
  - New exported `dateTextOf` turns the stored multipart date into the text Zotero's `getField("date", false, true)` returns.
  - Doc comments added on `title`, `date` and `publicationTitle` in `SummaryRunItemSnapshot`.
  - A preprint's venue stays "" (your decision).
- `addon/content/searchDialog.js`: patch applied as is. `ensureTargetNamed` reuses `promptForCollectionName` and `adoptNewCollection`. No new string, and the previous target is not restored.
- `src/ui/viewModels/searchImportViewModel.ts`: comment corrections from the patch.
- `test/unit/zotero/summaryVenue.test.ts` (new, 22 tests):
  - the patch's 8 venue tests;
  - title for case, email and statute;
  - year for patent, case and statute, both in the summary metadata and in screening;
  - 7 `dateTextOf` cases.
- `test/integration/zotero/relatedLibrary.spec.ts`: the patch's venue test, plus a new title/date test on real saved case, email, statute, patent and journal article items. It checks against Zotero's own base-mapped `getField` and against the prompt's TITLE and YEAR variables.
- `test/integration/searchDialog-flow.spec.ts`, the patch's prompt test, adapted:
  - **Measured prompt:** it is its own top-level window, `chrome://global/content/commonDialog.xhtml`. It raises `common-dialog-loaded` with that window as the subject, and holds `commonDialog`, `infoBody` and `loginTextbox`.
  - **The test cannot hang:** a 10 s timer cancels any prompt still open, and the test then fails on "no prompt was left for the guard".
  - **Enabled-button check:** it now reads the value of the `disabled` attribute. Real Zotero sets `disabled="false"` on an enabled button, which the patch's `hasAttribute` check got wrong.
  - **Cleanup:** the test erases every "RH 358b " collection and its items. Leftover items had broken the next two tests.
  - **Run 1 fix:** the named-import check now counts the non-note items in the named collection, instead of reading the notice text. That text was empty in run 1 because Fluent had not filled it yet; the file already records this race at the P1-T43 note.
- **Which cache keys move** (written in docs/06 §11.2):
  - The summary (`ps`) cache misses once, only on a run with "Re-summarize existing" ticked, for:
    - venue: conferencePaper, bookSection, webpage, blogPost, dictionaryEntry, encyclopediaArticle, forumPost, radioBroadcast, tvBroadcast;
    - title: case, email, statute;
    - year: patent, case, statute.
  - Trend report keys (`tc` clustering, `rp` report) move once for a collection holding a dated patent, case or statute, because the digest's first line carries the year (`headLine` in `digest.ts`).
  - The work key does not move.
- **Screening change, accepted:** a conference paper and its journal version a year apart are both kept now.

**Proof the checks can fail** (each mutant was removed afterwards and the restore was confirmed by sha256):

| Mutant | Result |
|---|---|
| title read the old way | 4 unit tests fail |
| date read the old way | 3 unit tests fail |
| venue read the old way | 6 unit tests fail |
| `dateTextOf` returns its input whole | 6 unit tests fail |
| `ensureTargetNamed` always returns true | 3 unit tests fail; integration fails "one prompt was drawn: expected 0 to equal 1" |
| title/venue mutants, integration | the venue test and the title/date test fail |
| the prompt test's notice topic renamed | the guard cancelled the prompt, the test failed cleanly, the other 60 passed, no hang |
| import adopts a different name | integration fails "the import created no collection named …"; its collection was still cleaned up |

## PART 2(a): Korean line breaking

**Cause.** The platform's default lets Korean break between syllables, inside words.

**Change.**
- `addon/content/style/searchDialog.css`: `#rh-search-dialog:lang(ko) { word-break: keep-all; overflow-wrap: anywhere; }`.
- Measured that it matches: the root's `lang` is "ko-KR" in Korean and "en-US" in English. `:lang(ko)` is true only in Korean, and English keeps `word-break: normal`.

**Measurements** (words broken over two lines):

| State | Before | After |
|---|---|---|
| Recommend profile and results | 2 (등장하는, 설정되어) | 0 |
| Related table at 887 x 600 | 2 (계산합니다., 태그가) | 0 |

**Korean at 1019 x 600, profile state, identical before and after:**
- the two notice paragraphs at 309–344 and 349–384;
- the query at 409–426;
- Find papers at 44–72;
- OK and Cancel at 559–586;
- all in view.

English geometry did not move.

**Proof.**
- Removing `keep-all` makes the related test fail with ['계산합니다.','태그가'].
- Removing `overflow-wrap` makes the 400-character unbroken title's box grow to 2506 px, failing "in the window".

## PART 2(b): related table state

**Cause, measured.**
- The header was held at its 4em minimum (52 px, 43–95) while its controls ran to 115. Its edge cut the Include row (88–115).
- The "blue fragments" are the tops of the four checked Include checkboxes plus the "Include" label: 9 cut elements.
- The 45vh floor held the results area at 270 px. With the related window's two extra rows (Years and scope 99–135, seed link 531–550), the column ran past 600 px. So the import note `rh-search-duplicates-group` sat at 557–580 (557–597 in Korean at 887) under OK and Cancel (559–586), with the status bar below them.
- The recommend table had the same cause: its header edge cut 10 chip elements at 1019 (Korean and English), 5 in Korean at 887 and 8 in English at 887. So it is fixed too.

**Change.**
- `addon/content/searchDialog.xhtml`: new wrappers `#rh-related-header-more` (key notice and status) and `#rh-recommend-header-more` (profile through the list note).
- `addon/content/style/searchDialog.css`:
  - the 45vh floor is removed;
  - while a table shows, the header gets `flex-shrink: 0` and the wrapper `max-height: 0`, so the header is exactly as tall as its controls;
  - the rest is still read by scrolling the header (scroll height kept: 168/189 px English, 189/206 px Korean).

**Before and after, both languages, at 1019 x 600 and 887 x 600:**

| | Before | After |
|---|---|---|
| Drawn under OK/Cancel | import note and status bar | nothing |
| Elements cut at header edge | 9 related, 5–10 recommend | 0 |
| Related header | 52 px | 72 px (43–115) |
| Related table box | 226 px | 164 px (147 in Korean at 887) |
| Related seed link / import note / status bar | 531–550 / 557–580 / under the buttons | 489–509 / 516–538 (499–538 in Korean at 887) / 545–550 |
| Recommend header | 80 px | 58 px |
| Recommend table box | 226 px | 248 px (230 in Korean at 887) |

Unchanged to the pixel: the keyword window, both openings and the recommend profile state.

**Tests.**
- `test/integration/support/drawnGeometry.ts`: new `cutAtEdge`, `drawnUnderButtons`, `wordsBrokenOverLines`.
- `relatedWindow.spec.ts`: a new block for en-US and ko-KR at both sizes. It checks: nothing under the buttons; nothing cut; the seed title and all four Include boxes whole; the header as tall as its controls; more than one row; status rows reachable by scrolling. In Korean it also checks that no word is broken and that an unbroken string wraps.
- `recommendWindow.spec.ts`: cut/under checks, and the controls inside the header edge.
- `test/unit/ui/searchDialog.test.ts`: the 45vh assertion is replaced with one for the new rule.

**Proof.**
- Putting the floor back fails the related en and ko "nothing is drawn under OK" checks and the recommend "header's edge cuts no line" check.
- Removing `max-height: 0` fails "header is as tall as its controls" (168/188 vs 72.5), the recommend selection row (708 > 600) and the existing P5-T16 room check.

**Screenshots** (10 before, 10 after: keyword table, recommend profile, recommend results, related table at 1019 and 887, each in ko and en):
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round360\before\
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round360\after\

## Docs (dated 2026-11-06 notes, names only)
- docs/07 §6.6: the "keeps the gap" sentence is struck and closed.
- docs/06 §11.2: a note after reading 6's notes on which keys move, plus the screening change.
- docs/12: the P3-T25 as-built note, item (2).
- docs/08:
  - §4.2 Import row;
  - §4.4 first step;
  - §5.2 decision (1);
  - §8.1: the second permitted prompt, with the measured prompt facts;
  - §5.4: "Superseded in part" under the floor note, with the before/after numbers;
  - the Korean measurement note's "Recorded, not fixed" text is struck and replaced with a "Fixed" note.

## Checks

| Check | Result |
|---|---|
| `npm run typecheck` | 0 (re-run after the last test edit: 0) |
| `npx eslint .` | 0 |
| `npm run lint:check` | 0 (re-run after the last edit: 0) |
| `npm run test` | 0. Unit: 137 files, 7658 passed, 105 skipped. Contract: 6 files, 84 passed, 28 skipped |
| `npm run build` | 0. Typings hashes the same before and after (global 020956c7, i10n a787e3c9, prefs a9aa2d93, prompts 4480d796, zotero-augment cf994969) |

| Integration run | Tree hash | Result | ko-KR | Guard |
|---|---|---|---|---|
| 1 (earlier tree) | f355867e | 354 passed, 1 failed (the notice-text race, fixed) | 469/1 | 1238 read, none cancelled, away from loopback [] |
| 2 | b44f38d9 | 355 passed, 2 pending | 469/1 | 1238 read, none cancelled, away from loopback [] |
| 3 | b44f38d9 | 355 passed, 2 pending | 469/1 | 1238 read, none cancelled, away from loopback [] |
| 4 | b44f38d9 | 355 passed, 2 pending | 469/1 | 1238 read, none cancelled, away from loopback [] |

- Before each run the `/* MUTANT` grep was empty and no test-profile zotero.exe was running.
- The tree hash was the same before and after each run.
- All runs used `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY`. No key value was read or used.

## Findings
The blue fragments were not a drawing fault: they were the tops of the four Include checkboxes, cut by a header held at 4em. The overlap under OK came from the 45vh floor plus the related window's two extra rows. Fixing it at the cause also fixed the same cut in the recommend table and gave that table 22 px more. The cost: the related table now shows a 164 px box (two whole rows of the 50 px test rows) instead of 226 px, because the header no longer shrinks below its controls. That is a judgement the owner may want to see.

The patch's prompt test had a wrong enabled check (`disabled="false"` in real Zotero) and left imported items behind; both are fixed. Run 1 failed because I read Fluent's notice text straight after the run, a race this file had already recorded for P1-T43. The check now reads the collection, and three clean runs followed.

## Not checked
- A keyed run.
- A Korean recommend-profile integration check with the repository's 20-term collection: the profile measures come from a scratch spec, not a repository test.
- A header scrolled before the table appears, which could still show a partial line.
- The empty and error panels in the related and recommend windows.
- Larger font, high contrast and dark mode.
- The Import prompt in related or recommend mode, or in a group library, in a real run.
- Whether Korean `keep-all` reads well in every string; only the drawn-word check was used.

The new count check (non-note items in the named collection) was not hit directly by its own mutant: the different-name mutant fails at the `collectionNamed` lookup just before it.

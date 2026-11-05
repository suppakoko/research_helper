# integration-round-356 — report of the executing agent (saved verbatim, 2026-11-02)

**VERDICT: Fixed. A key notice asked to hide is no longer drawn, in either mode.** Measured in real Zotero 10.0.3, the defect was wider than the record said: every element carrying `rh-wrap`, and three other kinds of element, stayed drawn when hidden. One stylesheet rule fixed all of them. After it, a sweep of every element in the keyword, related and recommend windows found none still drawn while hidden. All checks pass, and three full integration runs in a row on the final tree each gave 349 passed, 0 failed, 2 pending. Nothing was committed, no card was set to DONE, `plan/00` was not edited, and no Korean, Fluent id or new string was added. No key was used or written, and no live request was made.

## Step 1: measured before any change (real window, content 1019 x 600, en-US)

Method: each element in turn was asked to hide. Then its computed `display` and its box were read, and its `hidden` attribute was put back exactly as it was. This was done in the keyword opening, the related table, and the recommend opening, profile, table and fullest profile. The rule that set `display` was found with `InspectorUtils.getMatchingCSSRules`.

| Element | `hidden` now / does the window ask it to hide? | `display` while hidden | Height while hidden, where its parents show | Rule |
|---|---|---|---|---|
| `#rh-recommend-key-notice` | true from the opening; asked through `renderRecommend` | flex | **22 px, with its words, link 17 px** | `.rh-wrap` |
| `#rh-related-key-notice` | true while the run goes; asked through `renderRelated` | flex | **22 px** (read at the window's opening, run going) | `.rh-wrap` |
| `#rh-recommend-status` | asked; emptied first | flex | 0 (empty) | `.rh-wrap` |
| `#rh-related-status` | asked; emptied first | flex | 0 (empty) | `.rh-wrap` |
| `#rh-related-seed-meta` | asked when the seed is missing (`applyRelatedSeed`) | flex | 22 px when forced in the table state; the missing-seed state itself was not drawn | `.rh-wrap` |
| `#rh-related-include` | never asked itself | flex | 27 px when forced | `.rh-wrap` |
| `#rh-search-databases` | never asked itself (its group is) | flex | 27 px when forced | `.rh-wrap` |
| `#rh-recommend-terms`, `#rh-recommend-removed` | never asked (their rows are) | flex | 0 | `.rh-recommend-chips` |
| each `span.rh-recommend-chip` | never asked | flex | 30 px when forced | `.rh-recommend-chip` |
| each `div.rh-source-line` | never asked | table | 19 px when forced | `.rh-source-line` |

All other elements, between 525 and 879 per state, read `display: none` when hidden. Three more rules in `searchDialog.css` set `display` on elements the measurement did not build: `.rh-related-context`, `.rh-related-candidate` and `.rh-related-candidate-details`. `searchDialog.css` is the only file in `addon/content/style/`.

## Step 2: the fix

The fix is one rule at the head of `addon/content/style/searchDialog.css`: `[hidden] { display: none !important; }`. I used it instead of `.rh-wrap[hidden]` because four class rules beat the platform's own rule for hidden elements, and three more could. A per-class list would need seven selectors and would break with the next rule someone adds. `!important` is there so that a later rule keyed on an id cannot win either.

The sweep shows the rule changes nothing for any other element, because all of them already took `display: none` when hidden. A side effect, as intended: the related notice now hides when asked.

## Step 3: who asks the notice to hide, and when

With a usable key, the notice is asked to hide before any run, in both modes:
- **The window document:** `renderRecommend` and `renderRelated` set the notice's `hidden` to `typeof keyRequestUrl !== "string"`. The markup also starts both notices `hidden="true"`.
- **Recommend view model:** `initialRecommendViewState` has `keyRequestUrl: undefined`. A run's start in `createRecommendViewModel` sets it back to `undefined`. A list ending sets it only when `output.keyNotice` is true.
- **Related view model:** `initialRelatedViewState().related` has `keyRequestUrl: undefined`, and a run's start publishes that again. `drawRows` sets it only when `output.keyNotice` is true.

So the view state was right and no logic change was needed. The record's "until a run ends" was wrong: since hiding never worked, a reader with a key saw the false sentence in every state, after a keyed run too. That last case is reasoned from the code plus the measured "asked to hide, still drawn"; a keyed run was never seen, because no key is used.

**Behaviour change:** a reader without a key no longer sees the recommend notice before "Find papers". It shows once a run says there was no key, as docs/08 §5.2's decision 9 asks. Before, they saw it early only because of the defect.

## What changed, by file
- `addon/content/style/searchDialog.css`: the `[hidden]` rule, with a comment saying why.
- `test/integration/support/drawnGeometry.ts` (new): `drawnBox` reads an element's box, its computed `display`, its client rects and its link's box. `hiddenButDrawn` lists every element that is hidden but still has a `display`.
- `test/integration/pipeline/recommendWindow.spec.ts`: a new `it` for before any run, a check in the 1019 x 600 profile test before Find, and a check in the table test after the keyless run that the notice takes room and its link is drawn with the key-request address.
- `test/integration/relatedWindow.spec.ts`: a new `it` after the keyless run that the notice is drawn with its link, and a new `it` while a held run goes that the notice takes 0 px and has no box.
- `test/unit/ui/recommendViewModel.test.ts`: two tests. With a key, every state from the opening on has no URL. A run after a keyless list clears it as it starts.
- `test/unit/ui/relatedViewModel.test.ts`: one test. With a key, the notice is asked to hide before, during and after the run.
- `test/unit/ui/searchDialog.test.ts`: one test. The rule exists, and no other `display` declaration is `!important`.
- `docs/08-ui-ux-spec.md` §5.4: a dated note (2026-11-06) correcting the record, citing declarations by name.

## Proof each check can fail
Each mutant was applied alone, then the file was put back byte for byte, checked by sha256. The `/* MUTANT` grep over src, test and addon read 0 after each one.
- **Unit, all caught by the new tests:**
  - M1: rule removed.
  - U2: an extra `!important` display.
  - I7: related run start asks for the notice.
  - U3: recommend run start does not clear it.
  - U4: a recommend list always asks for it.
  - U6: a related list always asks for it.
  - I8 (recommend notice never asked to hide) was caught by an existing unit test.
- **Integration, the first assertion that failed:**

| Mutant | Assertion that failed |
|---|---|
| M1: rule removed | recommend before any run, and with a profile: display 'flex' against 'none'; related while the run goes: 'flex'; related after the run: "nothing asked to hide is drawn" listed `#rh-recommend-key-notice` and one more |
| I2: recommend notice shown with no room | "the notice takes room": 0 |
| I3: recommend link `display: none` | "its link is drawn": 0 |
| I4: related notice shown with no room | "the notice takes room": 0 |
| I5: related link `display: none` | "its link is drawn": 0 |
| I6: `#rh-recommend-status { display: flex !important }` | "nothing asked to hide is drawn" named `['#rh-recommend-status']`, in both specs |
| I7: related run start asks for the notice | while the run goes: asked to show, against asked to hide |
| I8: recommend notice never asked to hide | before any run, and with a profile: asked to show, against asked to hide |

In M1, I2, I3, I6 and I8 the next recommend test also failed: either the table test (filter word left empty) or the heading-row test (timeout). This is the knock-on failure already recorded under item 355(d).

## Checks and runs
| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx eslint .` | exit 0, no output |
| `npm run lint:check` | exit 0, Prettier clean |
| `npm run test` | unit: 7627 passed, 105 skipped; contract: 84 passed, 28 skipped; exit 0 |
| `npm run build` | exit 0 |
| Typings hashes | same before and after the build: 020956c7f456, a787e3c91094, a9aa2d93d36b, 4480d7967afb, cf994969fc0b |

The command was `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`.

| Run | Passed | Failed | Pending | Duration | Exit | MUTANT lines before | Test Zotero before | Tree hash before and after |
|---|---|---|---|---|---|---|---|---|
| 1 | 349 | 0 | 2 | 317 s | 0 | 0 | none | fecfcaa7ab8e11b4 / same |
| 2 | 349 | 0 | 2 | 312 s | 0 | 0 | none | same / same |
| 3 | 349 | 0 | 2 | 311 s | 0 | 0 | none | same / same |

- **Live-request guard, every run:** 1207 channels read, none cancelled, none away from loopback.
- **ko-KR, every run:** 353 present, 117 absent.
- **Pending:** the same two as last round, the real PubMed search and the 10 000-item index.
- **Repeat rule:** no run failed, so it was not needed.

## Step 5: the fullest profile at 1019 x 600
Profile: the fake model's focus line, 21 terms, a Removed line, 3 queries.
- **Before:** the header held 529 px in 498, and only the key notice was cut, by 19 px.
- **After:** it holds 507 px in 498. The notice is gone and every line of text is in view; the last query ends at 534 against an edge at 541. Something non-text fills the 9 px past the edge; I did not identify which element.
- **Recommend opening:** the header went from 93 to 71 px, with the Filter row and results area moving up 22 px. This is the notice-asked-to-hide state, as intended.
- **States where the notice shows did not move:** the recommend table (header 80, table 226), the related table (header 52), and the keyword opening and table are byte-identical before and after. The one difference is the related window's own-size line, which opened 887 wide instead of 1019; its boxes did not change.

## Findings
Before this fix, no element of these windows that one of the plugin's own class rules gives a `display` could be hidden: the seven `.rh-wrap` elements, the chip containers, each chip and each source line. Of these, the window asks to hide only the two key notices, the two status rows (emptied first, so 0 px) and the seed's meta line. The related notice drew 22 px from the window's opening while its run went, and both notices would have stayed drawn after a run with a key, so the record's "until a run ends" was wrong. One rule, `[hidden] { display: none !important; }`, fixes the whole class, and the new integration checks read layout instead of the property. One thing for the coordinator: a reader without a key now first sees the recommend notice after "Find papers", not before; this follows decision 9. The knock-on failure between the 1019 test and the table test (item 355(d)) showed again on the mutant runs and is unchanged.

## What was not checked
- A real key or a keyed run. The keyed path is reasoned from the code and the measured hide behaviour; no key was used, and no fake key or key-presence double was used for Semantic Scholar.
- The missing-seed state of the related window, and the three rules whose elements were not built in my measurement (`.rh-related-context`, `.rh-related-candidate`, `.rh-related-candidate-details`). They are covered by the one rule, but were not measured while hidden.
- Korean layout, a larger font size and high contrast.
- Which element fills the 9 px past the header's edge in the fullest profile.

## Files
Everything below is in C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\. Screenshots use test profile and fixture data only.

Measurements and logs:
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\m-before.txt (the sweep and boxes before the fix)
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\m-after.txt (the same after the fix)
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\measure.spec.ts (the throwaway measuring spec)
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\mutants-unit.log
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\mutants-integration.log
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\run-1.log, run-2.log and run-3.log, with a matching final-1.summary to final-3.summary for each

Screenshots:
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\before-opening-1019.png (the defect: the notice drawn before any run)
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\after-opening-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\before-panel-f4-all-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\after-panel-f4-all-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\after-results-1019.png
- C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round356\after-related-table-1019.png
- The same folder holds the other before and after pictures, including the keyword window and dark mode.

Changed in the tree:
- D:\KIST\projects\research_helper\addon\content\style\searchDialog.css
- D:\KIST\projects\research_helper\docs\08-ui-ux-spec.md
- D:\KIST\projects\research_helper\test\integration\support\drawnGeometry.ts (new)
- D:\KIST\projects\research_helper\test\integration\pipeline\recommendWindow.spec.ts
- D:\KIST\projects\research_helper\test\integration\relatedWindow.spec.ts
- D:\KIST\projects\research_helper\test\unit\ui\recommendViewModel.test.ts
- D:\KIST\projects\research_helper\test\unit\ui\relatedViewModel.test.ts
- D:\KIST\projects\research_helper\test\unit\ui\searchDialog.test.ts

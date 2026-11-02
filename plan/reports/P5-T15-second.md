# P5-T15-second — report of the executing agent (saved verbatim, 2026-11-02)

P5-T15 second-pass report

## VERDICT

**All P5-T15 work is finished and proved in real Zotero, but the suite is not fully green.** All 3 runs on the final tree ended 245 passed, 2 failed. Neither failure is a P5-T15 test; both trace to P4-T21's in-progress work. So the "three clean runs" you asked for did not happen, and you should re-run once P4-T21 lands. Nothing is committed, no card is set to DONE, and `plan/00` and `plan/08` are untouched.

| Done-when line | State | Proof |
|---|---|---|
| The entry appears for one item, is disabled for two, and is absent while `related.enabled` is false | PROVED | `menus.spec.ts`: "is absent while related.enabled is false…" and "appears for one regular item, is disabled for two, and hides for none" passed in all 3 runs |
| A disable/enable cycle leaves no menu and no window | PROVED | `lifecycle.spec.ts`: "leaves no item menu and no search window after a disable/enable cycle (P5-T15)" and the new "closes a search window opened in keyword mode from the Tools menu at disable (P5-T15)" passed in all 3 runs |
| `l10n.spec.ts` resolves every new id in both locales | PROVED | "P5-T15: resolves the item menu entry and the related mode in both locales…" passed in all 3 runs |
| `npm run typecheck`, `npm run test:unit -- keys` and the integration suite pass | PARTLY | `test:unit -- keys` passes (2 files, 170 tests). Typecheck and the suite are each failing now, only on other agents' files or tests (below) |

## Integration runs

Command: `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`, with the key removed. Before each run, the `/* MUTANT` grep was empty and no test-profile Zotero was running. No Zotero process needed killing.

| Run | Result | ko-KR totals line |
|---|---|---|
| Final 1 | 245 passed, 2 failed | `ko-KR totals: 336 present, 15 absent; expected 336 / 15` |
| Final 2 | 245 passed, 2 failed | same |
| Final 3 | 245 passed, 2 failed | same |

Before I added the last lifecycle test, three more full runs each gave 243 passed, 1 failed, with the same totals. P4-T21's own new test was not yet in the tree at that point.

**Totals are 15 absent, not the 13 you expected.** My 12 ids and the spike id make 13. The other two are almost certainly P4-T21's new ids: `research-helper-report-paused-notice` and `research-helper-report-shown-label` appeared in the regenerated typings in the same round. I inferred this and did not list the 15 absent ids. The test's expected figure comes from the lists, so it agrees.

**The two failures, neither P5-T15, each failing in all 3 final runs:**
1. `menus.spec.ts`, "opens the real report window… (P4-T19)": "one selector — the language; no model dropdown (item 286): expected 2 to equal 1". The cause is the new `<menulist id="rh-report-shown">` in the uncommitted `addon/content/reportWindow.xhtml`, which is P4-T21's area. Either that assertion or the item 286 reading needs P4-T21's or your decision. I did not edit it.
2. `reportWindow-flow.spec.ts`, "a report job left paused gets one notice at no cost, and none for the same pause (P4-T21; item 332(b))": timed out waiting for the notice naming the collection. This is P4-T21's own test on its own in-progress code.

**For P5-T03's line (e):** I saw no failure in P5-T03's tests in these runs, but the suite is not clean, so you decide whether that closes the line.

## Your two reported failures

1. **"is absent while related.enabled is false":** the spec is corrected per item 333(c). It now reads `Zotero.Prefs.get(RELATED_PREF, true) ?? PREFS.relatedEnabled.default`, as `getPref` in `src/prefs/index.ts` does.
2. **"opens the real window…":** the fault was in my spec, not the product.
   - The chip was always fine. The year lists' label was empty because the spec called `doc.l10n.translateRoots()`, and that removes `label` from a menulist that has its own `data-l10n-id`.
   - My first-pass worry was wrong: Fluent does word an "Any" item added at run time, and the list picks up the label.
   - On the way I tried `formatMessages` plus a `label` attribute. Once the real cause was measured I reverted it, so `addAnyYear` is as in the first pass.
   - The spec no longer calls `translateRoots`.

## Measurements (Zotero 10.0.3, Windows; recorded in `docs/08` today)

- **Tooltip on a disabled entry: it is shown.**
  - On the real entry in the real open submenu, with two items selected, Zotero's default tooltip reached state `open` with the reason as its label.
  - With one item it stayed `closed`.
  - A control on a toolbar button also showed a tooltip when the main window was active.
  - With the main window inactive, the control showed nothing either, so only the runs with the window active count.
  - The hover used a synthesized mouse, with the tooltip's state read through `InspectorUtils`. Nobody looked at it on screen.
- **`docs/10` FR-13 is NOT edited.** Its "disabled with an explanatory tooltip" is now true, so the card's correction does not apply.
- **The Any label:** works through Fluent (see above).
- **A hidden submenu:** for a selection with no regular item, the popup still ends in `MenuManager`'s `zotero-custom-menu-group-separator`, not hidden, followed by our hidden `<menu>`. I read this from the DOM and did not look at it on screen. See the note under "Your call" below.
- **A second seed:** reloads the one named window. The window count stays 1 and the Seed line shows the new seed. A seed that is a note draws the missing line.

## What changed since the first report

Everything in the first report still holds except the following.

**New behaviour: the tooltip**
- `itemMenuOptions`'s entry `onShowing` now also calls `context.setL10nArgs(JSON.stringify({ oneItem: one ? "yes" : "no" }) as unknown as object)`. The cast is needed because `menuManager.js` assigns the value to `dataset.l10nArgs`, so it must be a string, while `zotero-types` declares `object`.
- en-US `research-helper-menu-item-find-related` gained a `.tooltiptext`: "Select a single item to find papers related to it." for `no`, empty for `yes`.
- It is the same id, so no new id was added and the typings are unaffected by it. The ko-KR stub line is updated.
- `keys.ts` (small exact edits): `FluentMessageArgsMap` gains `"research-helper-menu-item-find-related": { oneItem: "yes" | "no" }`, and `ARGUMENT_MESSAGE_IDS` gains that id under a new comment. All 12 ids stay on `KO_PENDING_REVIEW`.

**Updated Korean draft for the owner:** add the tooltip to the menu label's row, "단일 항목을 선택하면 관련 논문을 찾을 수 있습니다." This is a draft in this report only, never in a bundle.

**Tests**
- `menus.spec.ts`: the preference read, no `translateRoots`, and the reason asserted on real items, as a `tooltiptext` that is non-empty for two items and empty for one. It now imports `PREFS`.
- `lifecycle.spec.ts`: the new keyword-mode shutdown test, added because a mutant survived without it.
- `itemMenu.test.ts`, `keys.test.ts`: the tooltip argument.

**Docs:** `docs/08` gained two measured notes, after the §2.5 as-built note and at the end of the §5.2 note.

**Typings hash:** `npm run build` left `typings/i10n.d.ts` unchanged (991A850D… before and after).
- The build exited 0. It was run before the current typecheck errors appeared; a build now would stop at its tsc step.
- The diff against HEAD is 14 insertions and no deletions: my 12 ids plus P4-T21's 2, so the hand edit matched the generator's order.
- The file's hash moved once, from 427A23A1… at the start of this pass, when a run regenerated it with those 2 ids.

## Other runs

- `npm run lint:check`: clean at the last whole-tree check, before the last spec was added. Afterwards eslint on my source and spec files exits 0, and prettier's whole-tree check was not repeated (a final attempt on three named files aborted because prettier has no parser for `.ftl`, so it checked nothing).
- `npm run test`: 116 files, 5543 tests passed, also at the last whole-tree check, before P5-T18-area edits arrived. The card's own unit files were re-run at the end: 170 and 182 tests passed.
- **`tsc` right now fails**, only in `src/pipeline/shared/egressDisclosure.ts`, `src/ui/dialogs/costConfirmDialog.ts`, `test/integration/prompts.spec.ts`, `test/unit/core/summaryKey.test.ts` and `test/unit/prompts/registry.test.ts`. None is mine. The ones I read are a missing `COLLECTION_PROFILE` key from a new prompt id, another agent's in-progress work. It was clean on this card's files before that arrived. **`npm run build` will stop at its tsc step until that settles.**

## Mutation sweeps (scratch copies only; `/* MUTANT` grep empty at the end)

- **Plain Node:** 74 of 74 caught, including the tooltip mutants.
- **Real Zotero, on a scratch copy of the repository with its own profile, menu and lifecycle specs only:** 10 of 10 caught.
  - Opener ignores the preference.
  - Menu registered while off.
  - Opener not withdrawn.
  - Window not closed at shutdown.
  - Related window not tracked.
  - Keyword window not tracked. This one survived at first; the new lifecycle test catches it.
  - Seed never read.
  - A note counts as a seed.
  - No disabled reason.
  - Tooltip also on the enabled entry.

## Temporary changes

To diagnose, I pointed `zotero-plugin.config.ts` at a throwaway `test/p5t15-diag` folder five times, while the whole-suite build was idle. Each time I restored it and checked the hash (108403a9…). `git status` shows the config clean and the folder gone. Any of your other agents' builds would not have been running then, as you said they start without one.

## Your call

1. The trailing separator for a notes-only selection. The plugin does not own it. Options:
   - accept it;
   - keep the submenu visible with the entry disabled for a selection with no regular item, which removes the separator but changes what §2.5 records.

   I left it as built. The first report's `docs/08` note says the submenu hides, and it stands.
2. The `menulists` assertion from item 286 against P4-T21's second menulist (failure 1 above).

## Not checked

- The tooltip, the separator and the window's layout by eye on screen.
- ko-KR rendering of the new strings in a window. They have only English until the owner reviews the Korean.
- Three clean runs, for the reason above.

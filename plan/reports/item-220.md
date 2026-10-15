# Item 220 — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent made this owner-approved change
> (`plan/00` §6 item 220, decided 2026-10-16), in the same tree as the `P2-T13` Part B recording agent. The text below
> is its report, unedited. It is a record, not an instruction. Its §6 remark on rule 3 is correct: the brief cited
> rule 3 loosely.

---

# Item 220: the all-failed panel decides from the per-source errors

## 1. Verdict
Done. When every searching source fails and at least one source reports its own error, the window now ignores the run-level `SOURCE` error. (A "run-level error" is the single error the pipeline attaches to the whole run. A "per-source error" is the error attached to one database's report.) The run-level error no longer adds a line to the details disclosure, which is the collapsible list of machine codes, and it no longer helps choose the buttons. So if every source failed only because a key was refused, the panel shows Open Preferences and no Retry, as before item 204. If every source failed only because Zotero was offline, it shows Retry alone. When no source reports an error, the run-level error is still used, for example when the run failed before any source was asked. All five checks passed.

## 2. Files, with declaration names
- `src/ui/viewModels/searchImportViewModel.ts`: inside `createSearchImportViewModel`'s inner function `renderSearchOutcome`, in the all-failed branch. A new local, `runLevelErrors`, holds `output.error` only when `perSourceErrors` is empty. The existing local `runLevel` (the run-level error's action) and the local `errors` (the input to `errorDetails`) are now built from `runLevelErrors`. The `ErrorView` fields `retry` and `openPreferences` still combine `actions` and `runLevel`. Because `runLevel` is now empty whenever any per-source error exists, each button follows the failed sources' own rows in `ERROR_ROWS`, as `P1-T22` decided. The headline rule did not change. A comment cites the owner's decision.
- `docs/08-ui-ux-spec.md` §4.6, under the "All databases failed" wireframe: a dated note ("Decided 2026-10-16 (owner; `plan/00` §6 item 220)") added before the code change. It explains the rule and says the wireframe shows a mixed run, which draws both buttons. §8.3 lists the action for each error class but does not describe the panel's buttons, so it got no note.
- `test/unit/ui/searchImportViewModel.test.ts`: one new `describe` block with a local helper, `allFailed`.
- Unchanged: `addon/content/searchDialog.js`. Its panel only reads `error.retry` and `error.openPreferences` (it sets `hidden` from them) and does not choose the buttons, so `test/unit/ui/searchDialog.test.ts` was not changed either. `test/integration/searchDialog-flow.spec.ts` was also unchanged: none of its assertions mention `SOURCE`, and its offline-only test already expected Retry alone.

## 3. Tests, by name
All are in `describe("item 220 — the all-failed panel decides from the per-source errors")`. Each uses the seven-source run that the pipeline has returned since item 204, with outcome `failed` and a run-level `SOURCE` error marked retryable:
- "shows Open Preferences and no Retry when every source failed only on a refused key" (every source fails with `AUTHORIZATION` 403)
- "shows Retry alone when every source failed only on being offline"
- "shows both buttons for a mixed run of refused keys and offline sources"
- "still shows the run-level error's own action when no source carries an error" (no source reports; the `SOURCE` error alone gives Retry, no Open Preferences, and the details list `["SOURCE"]`)
- "leaves the run-level error out of the panel's lines when per-source lines exist" (the failed-source lines are exactly the five searching sources; the details list each source's code, with no `SOURCE`)

## 4. Runs

| Command | Result |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, no errors |
| `npm run lint:check` | eslint clean; "All matched files use Prettier code style!" |
| `npx eslint .` | no output, exit code 0 |
| `npm run test` | unit tests: 47 files, 2473 passed; contract tests: 2 files, 40 passed; exit code 0 |
| `npm run test:integration -- --exit-on-finish` | "Test run completed - 158 passed", exit code 0, first attempt. No Zotero was running beforehand, and none needed stopping. The offline (OFFLINE), forced 429, and empty-keyword panel tests all passed. |

## 5. Mutation table
A mutant is a deliberate bug put into the code to show that a test catches it. Each mutant below was marked with a `/* MUTANT id */` comment, run against the whole view-model test file, then removed by copying back the saved file. The restored file's hash was checked each time (sha256 `f59b41fe…067d`, "OK" after every mutant).

| Mutant | Change | Killed by |
|---|---|---|
| M1: run-level error not skipped | `runLevelErrors` condition reduced to `output.error !== undefined` | "shows Open Preferences and no Retry…", "leaves the run-level error out of the panel's lines…" (2 failed) |
| M2: skipped even with no per-source error | condition made always false | "still shows the run-level error's own action…" and the existing "does not blame the network for a run that asked nobody" (2 failed) |
| M3: buttons taken from the run-level error | `retry` and `openPreferences` built from `output.error` regardless | "shows Open Preferences and no Retry…" (1 failed) |

`grep -rn MUTANT src test addon typings scripts` found nothing (exit code 1).

## 6. Contradictions
- The brief cites "rule 3" for the dated note. Rule 3 in `plan/README.md` §5 is about `docs/07` being the only authority for types, which does not seem to be the rule meant. The note was written before the code change anyway.
- A run can still end with outcome `failed` and no per-source error even though sources were asked (a failure after fetching). In that case the run-level error decides the buttons. The decision allows this, but no test covers that exact case; the "no per-source error" test uses an empty source list.

## 7. What I did not check
- The real dialog in Zotero with a refused key on every source. No integration test feeds an authorization-only all-failed run, and the brief did not ask for a new one. The unit tests only check the view model's flags.
- The import path's error panel (`renderImportOutcome`), which still uses only `output.error`. It is outside this decision.

## 8. Follow-ups
- Optional: an integration test where every source fails with a refused key, checking that Open Preferences is visible and Retry is hidden in the real window. The text to compare against should come from the ko-KR bundle.
- Item 220's second option, a `SOURCE` row in `ERROR_ROWS`, was not taken. The import path's panel (`renderImportOutcome`) still decides Retry from `SOURCE`'s own `retryable` value.

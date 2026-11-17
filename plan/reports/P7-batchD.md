# Phase 7 batch D — Part 0 (item 395's answers, item 397), `P7-T34`–`P7-T37`, `P7-T03`

**Date:** 2026-11-17, finished just after midnight on 2026-11-18 · **Executor:** Claude Code (agent), the tree and
Zotero owner for the batch, under the coordinator's brief of 2026-11-17 · **Commit base:** 8f1f828, **nothing
committed** (the coordinator reviews and commits) · **Cards left:** all `TODO`. `P7-T03` and `P7-T34`–`P7-T37` each
carry a dated "built, awaiting the owner's review" note. `P7-T38` is not started. Only the owner sets `DONE`.

## 1. Summary

| Part | What | Result | Report |
|---|---|---|---|
| Part 0 | Item 395(a)–(h): the owner's answers | Recorded in `plan/00` §6 as "DECIDED 2026-11-17 (owner, plan/00 §6 item 395(x))". (a), (c), (d) and (f) became `P7-T34`–`P7-T37`. (b) is a step on `P7-T03` (+0.25 d). (e) and (h) are Do steps 6 and 7 of `P7-T24`. (g) is `P7-T38` (0.5 d), placed before `P7-T26`; `npm audit fix` was not run. (h)'s contact is left to the owner. | item 395 |
| Part 0 | Item 397, "모두 승인": batch C's 20 Korean drafts | Adopted byte for byte. The ids moved from `KO_PENDING_REVIEW` to `KO_PRESENT`, and CI's l10n step lost its 20 `--allow`s. `plan/reports/ko-review-p7c.ftl` written. l10n: 569 messages, 0 allowed holes. | item 397 |
| `P7-T34` | The item's tags are not sent | Built. Both `Done when` lines hold. 6 of 6 mutants killed. | `P7-T34.md` |
| `P7-T35` | Semantic Scholar attribution in reports | Built. Both `Done when` lines hold. 16 of 16 mutants killed. Korean awaits `G-41`. | `P7-T35.md` |
| `P7-T36` | The teardown reporter goes through `redact` | Built. Both `Done when` lines hold. 4 of 4 mutants killed. | `P7-T36.md` |
| `P7-T37` | The redaction audit reads the plugin database | Built. The `Done when` line holds over the three runs in §6. It found a production defect, now fixed (item 398(i)). | `P7-T37.md` |
| `P7-T03` | Hard-coded string and `Intl` sweep, with step 5 (item 392(a)) and step 6 (item 395(b)) | Built. All three `Done when` lines hold. On `format.ts`, 17 mutants: 15 killed, 2 equivalent. On step 5, 12 of 12 killed. | `P7-T03.md` |
| `P7-T06` | Accessibility pass | **Not started** (the brief said "only if time allows"). Its NVDA part is the owner's (`G-33`). | — |

**Estimate.**
- Phase 7 is now 38 cards, 32.00 d, 32.00–45 d. Before this batch it was 33 cards and 29.75 d. The five new cards add
  2.0 d, and `P7-T03` went from 1.5 to 1.75 d.
- The project total is 228.25–320 d over 276 cards. The critical path is 160.00–224 d.
- The margin between the Phase 2 and Phase 3 routes (3 d / 4 d) and Phase 5's float (9.75–13 d) are unchanged.
- Phase 7's own critical path is 14.75 d, because `P7-T03` lies on it.
- All of this was carried to the five sites of `plan/README` §7: `plan/10` (header, §0, §1 and §3); `docs/11` §1 (the
  table, the prose, the Phase 7 Effort paragraph and the chart) and §2; `plan/00` §1. `plan/05`'s Phase 7 effort
  line was updated too.
- `npm run index:derive` was run after the last plan edit: "276 tasks, 112 DONE, 164 TODO".

**Coordinator decisions** (under item 313): item 398(a)–(j). None blocks a `Done when` line or a phase's finishing
condition.

## 2. Owner questions, each with a draft answer (none adopted)

All in `plan/00` §6 item 399.

- **(a) Privacy, measured: every stored summary is made again, not only the tagged ones.**
  - `{{TAGS}}` is part of the summary cache key.
  - An untagged item's value changed too, from `none` to `not supplied`.
  - So after `P7-T34`, every summary is made again, and paid for, on its next run. Item 395(a)'s record said "tagged
    items".
  - *Draft:* keep it as built. The release has no users yet, and sending `none` for an untagged item would tell the
    provider whether the item has tags. The alternative is to keep `none` for untagged items, which saves those
    re-runs.
- **(b) Korean (`G-41`): the two new strings.**
  - The whole first-job notice with the owner's sentence. It is a commented draft; the live Korean stays as it was
    until approved.
  - The report line `semanticScholarAttribution`: "일부 기록 출처: Semantic Scholar, Allen Institute for AI."
  - Both are side by side in `plan/reports/ko-review-p7d-draft.md`.
  - *Draft:* the drafts as written.
- **(c) Korean and scope: the five `NUMBER($megabytes, maximumFractionDigits: 1)` placeables.**
  - `P7-T03`'s Do NOT forbids `NUMBER()` options the plugin cannot test in Node. Five pane messages use them, and
    their Korean is approved.
  - *Draft:* leave them. The pane's integration spec checks their output in Zotero.

## 3. Korean awaiting review (`G-41`)

Two drafts, both commented out and not adopted. Their ids were already live, so CI needs no `--allow` and
`KO_PENDING_REVIEW` gains nothing:

| Id | Where the draft is | What the user sees until approval |
|---|---|---|
| `research-helper-egress-first-job-notice` | `addon/locale/ko-KR/research-helper-mainWindow.ftl`, under "# Draft (coordinator, 2026-11-17, not adopted; G-41, P7-T03):" | the earlier Korean notice, without the owner's sentence |
| `semanticScholarAttribution` (report text) | comment on `KO_REPORT_LABELS_PENDING_REVIEW` in `src/pipeline/trendReport/reportLabels.ts` | the English line in a Korean report |

The review page is `plan/reports/ko-review-p7d-draft.md`. The script that wrote it checked that the notice draft is
the live Korean with exactly one sentence added.

## 4. Open findings (not cards, rule 9)

- **The local cost estimate counts the tags' length.** `summarizePipeline`'s `measureOverhead` still counts it. The
  figure errs high, and no request carries it (item 398(b)).
- **Some Semantic Scholar records are not marked.** With the `rh-sources` line turned off, a Semantic Scholar record
  that has no corpus id is not marked. A report stored before 2026-11-17 prints no attribution line until it is made
  again (item 398(c)).
- **Two different Korean date forms.** `preferences.js`'s `formatDate` prints a different Korean form from
  `format.ts`'s medium date (item 398(f)).
- **One number outside `Intl`.** `relatedViewModel.ts` prints the similarity with `toFixed(2)`. Both shipped locales
  print it alike (item 398(f)).
- **The Korean notice lacks the owner's sentence** until `G-41` (item 399(b)).
- **The summarize window's second-run note is out of scope.** It is behaviour, not a string or an `Intl` call, so it
  is not under `P7-T03` (item 398(g)).
- **Fixed in this batch: the restore notice could not show** (item 398(i)). `pluginDatabaseHasData` wrote its `LIKE`
  pattern as a literal. Zotero's connection refuses that, and the pane read the refusal as "no data". The pattern is
  now bound and guarded by a unit test and an integration assertion (`P7-T37.md`).
- **Fixed in this batch: two integration specs** (item 398(j)).
  - `redactionAudit.spec.ts` now binds its own `LIKE` pattern.
  - `preferences.spec.ts`'s `P7-T10` block now pins `en-US`. Item 397's adoption made its confirmation Korean on this
    `ko-KR` machine, and the test asserts one English sentence. This was the first integration run's second failure.

## 5. Checks (after the last code edit)

All were run with `OPENROUTER_API_KEY` removed from the environment (`env -u OPENROUTER_API_KEY …`). None of them
made a live network, model, keyed or paid call.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0, "All matched files use Prettier code style!" |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's step, now without arguments) | exit 0: "check-l10n: ko-KR matches en-US: 3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | exit 0. Unit: 163 files, 8494 passed, 105 skipped. Contract: 7 files, 93 passed, 28 skipped. `container.test.ts`, which once timed out under load during the batch, passed in every full run afterwards. |
| `npm run build` | exit 0, 0 WARN lines (batch C had 10, for the 20 ids now adopted) |
| typings, sha256 (first 8 characters) before and after the build | unchanged: `global.d.ts` 020956c7, `i10n.d.ts` cd93b62a, `prefs.d.ts` 47439ca8, `prompts.d.ts` 4480d796, `zotero-augment.d.ts` cf994969 |
| XPI | `research-helper.xpi`, 730 887 bytes, sha256 begins `b800926a382391f8` |
| `/* MUTANT` grep over `src`, `test`, `scripts`, `addon` | 0 |
| `.only` in `test` | 0 |
| Mutation sweeps | `P7-T34` 6/6; `P7-T35` 16/16; `P7-T36` 4/4; `P7-T03` 29 mutants: 27 killed, 2 equivalent; the `LIKE` fix 1/1, plus one expected survivor (lower-case `like`, stated in the test) |

The full outputs are in the scratchpad (`test-d-final.txt`, `build-d-final.txt`, `mutants-*-out.json`). They are not
part of the repository.

## 6. Integration runs

Command: `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`, run in Zotero
10.0.3 on Windows 11. At its start, `zotero-plugin test` builds the plugin into `.scaffold/build/addon` from the
working tree, in test mode. The source did not change between the three runs, and nothing else built during them.

Before each run, a script checked three things and logged them:
- the `/* MUTANT` grep was empty;
- there was no `.only`;
- no `zotero.exe` was running.

No Zotero process was killed.

| Run | Start–end (2026-11-18) | Exit | Result | Live-request guard |
|---|---|---|---|---|
| 1 | 00:04:15–00:10:40 | 0 | "372 passed", 2 pending | 1329 channels read, away from loopback `[]` |
| 2 | 00:10:47–00:17:12 | 0 | "372 passed", 2 pending | 1329 channels read, away from loopback `[]` |
| 3 | 00:17:17–00:23:39 | 0 | "372 passed", 2 pending | 1329 channels read, away from loopback `[]` |

The 2 pending in each run are the same two as in batch C:
- "§2 criteria 1, 4 and 5: a real PubMed search imports…";
- "builds the index over a 10 000-item library with exactly one search pending".

The count went from batch C's 371 to 372. The new test is `bibliography.spec.ts`'s Semantic Scholar marking test.
`P7-T37` and the new `pluginDataPresent` assertion live inside existing tests.

**Runs before the recorded set, on earlier source.**
- **First run: 370 passed, 2 failed.** Both failures came from the tests, not from a regression in the plugin:
  - `P7-T37`'s query was refused by Zotero, with "Please enter a LIKE clause with bindings";
  - `P7-T10`'s English assertion met the Korean that item 397 adopted.

  Both were fixed (item 398(i), (j)).
- **Second run: 372 passed.** It was made before the `pluginDatabaseHasData` fix, so the source changed afterwards and
  the run is not counted.

Each recorded run's log also measured:
- **`P1-T18`:** "ko-KR totals: 569 present, 0 absent; expected 569 / 0". In batch C it was 549 / 20; item 397 closed
  the gap.
- **`P7-T10`:** "Remove 12 stored summaries from Research Helper's database? The notes in your Zotero library stay." →
  `removed: 12`, now drawn in `en-US`.
- **`P7-T14` / `P7-T37`:**
  - "plugin database: 11 tables, 101 rows, 459 text cells and 0 blob cells searched for 30 values; 0 found";
  - "plugin database control: 7 cells hold a summarized item's key".

The logs are in the scratchpad: `int-dr1.log`, `int-dr2.log` and `int-dr3.log`, and the pre-run checks in
`int3-summary.txt`. The two earlier runs are `int-d1.log` and `int-d2.log`.

## 7. Final tree state

`git status --short` after the last edit shows 57 entries: 44 modified files and 13 new ones (this report is one of
the 13). Nothing is staged and nothing is committed.

- **Modified, code and assets:**
  - both `research-helper-mainWindow.ftl` bundles;
  - `src/addon.ts`, `src/bootstrap/registerUI.ts`, `src/core/errors.ts`, `src/i18n/keys.ts`, `src/model/trend.ts`;
  - `src/pipeline/summarize/summarizeItem.ts`;
  - `src/pipeline/trendReport/{exportMarkdown,noteHtml,reportLabels,scaffold,trendReportPipeline}.ts`;
  - `src/ui/dialogs/{costConfirmDialog,summarizeDialog}.ts`, `src/ui/panes/summarySection.ts`;
  - `src/ui/viewModels/{reportViewModel,searchImportViewModel}.ts`;
  - `src/zotero/bibliography.ts`.
- **Modified, tests:**
  - integration: `l10n.spec.ts`, `preferences.spec.ts`, `redactionAudit.spec.ts`, `zotero/bibliography.spec.ts`,
    `zotero/summarySection.spec.ts`;
  - unit: `core/errors.test.ts`;
  - unit, pipeline: `privacyPolicy.test.ts`, `summarizeItem.test.ts`, `summarizePipeline.test.ts`,
    `trendExport.test.ts`, `trendNoteHtml.test.ts`, `trendScaffold.test.ts`;
  - unit, UI: `costConfirmDialog.test.ts`, `preferencesPane.test.ts`, `summarySection.test.ts`.
- **Modified, docs and plan:**
  - `.github/workflows/ci.yml`, `README.md`;
  - `docs/07`, `docs/08`, `docs/09`, `docs/11`, `docs/12`;
  - `plan/00`, `plan/05`, `plan/10`.
- **New:**
  - `src/i18n/format.ts`;
  - `test/unit/i18n/format.test.ts`, `test/unit/i18n/noHardcodedStrings.test.ts`,
    `test/unit/zotero/bibliographySource.test.ts`, `test/unit/bootstrap/sqlLikeBindings.test.ts`;
  - `plan/reports/P7-T03.md`, `P7-T34.md`, `P7-T35.md`, `P7-T36.md`, `P7-T37.md`, `P7-batchD.md`;
  - `plan/reports/ko-review-p7c.ftl`, `ko-review-p7d-draft.md`.

The key was never read and was removed from every command's environment, and no key was written anywhere. The planted
values exist only in memory at test time. The owner's email was not added anywhere. `npm audit fix` was not run.

# Phase 7 batch E — Part 0 (item 399's answers), `P7-T06`, `P7-T20`, `P7-T23`, `P7-T15`, `P7-T24`, `P7-T38`

**Date:** 2026-11-18 · **Executor:** Claude Code (agent), the tree and Zotero owner for the batch, under the
coordinator's brief of 2026-11-18 · **Commit base:** ff23bcd, **nothing committed** (the coordinator reviews and
commits) · **Cards left:** all `TODO`, each with a dated note in its State cell. Only the owner sets `DONE`.

## 1. Summary

| Part | What | Result | Report |
|---|---|---|---|
| Part 0 | Item 399(a)–(c): the owner's answers | Recorded as "DECIDED 2026-11-18 (owner, plan/00 §6 item 399(x))". (a) "지금대로 둠": kept as built. (b) "모두 승인": both Korean drafts went in byte for byte. (c) "그대로 둠": the `NUMBER()` placeables stay, as a named exception that `format.test.ts` pins. | item 399; §2 |
| `P7-T06` | Keyboard, focus, names, contrast | Built; both `Done when` lines hold. Three kinds of defect fixed: keyboard contracts, two unnamed radio groups, text contrast. A fourth was found and fixed: every dialog showed "OK"/"Cancel". 17 mutants, 16 killed, 1 survivor explained. The NVDA run is the owner's (`G-33`). | `P7-T06.md` |
| `P7-T20` | `README.ko.md` | Built as a draft, not adopted (`G-41`). The same 11 sections and 25 table rows as `README.md`. | `P7-T20.md` |
| `P7-T23` | Forum post and list texts | Drafts only, with placeholders. Nothing posted. The lists' processes are marked "not checked" (no network). | `P7-T23.md` |
| `P7-T15` | Profiling, the agent's part | Procedure, startup timings, `startupCost.spec.ts`. NFR-10 (test profile) and NFR-18 pass. NFR-3 and NFR-7 wait for the owner (`G-34`); NFR-7's workload figures have no method (item 401(a)). 3 of 3 mutants killed. | `P7-T15.md` |
| `P7-T24` | `docs/release/v1.0-checklist.md` | Built. Every NFR and all 84 §8 lines have a row; Do steps 6 and 7, the macOS/Linux waiver and an owner row for each open gate are in. No unmeasured figure. | `P7-T24.md` |
| `P7-T38` | `npm audit fix` | **Not done.** npm stopped with an internal error in three runs and a dry run, and changed nothing (item 401(d)). | `P7-T38.md` |

**Estimate.** Unchanged. Item 401(a)'s draft would add 0.5 d to `P7-T15`; it is not adopted, so nothing was carried to
the five sites of `plan/README` §7. `npm run index:derive` was run after the last plan edit (§8).

**Coordinator decisions** (under item 313): `plan/00` §6 item 400(a)–(i). None blocks a `Done when` line or a phase's
finishing condition.

## 2. Part 0: the owner's answers to item 399

- **(a) "지금대로 둠".** Kept as built: every stored summary is made again on its next run. Dated notes on `plan/00`
  item 399(a), `docs/12` §4 and `plan/10` `P7-T34`.
- **(b) "모두 승인".** Both drafts went in byte for byte, checked by script against `plan/reports/ko-review-p7d-draft.md`.
  - The first-job notice replaced the live `ko-KR` entry in `research-helper-mainWindow.ftl`, and the commented draft
    was removed.
  - `semanticScholarAttribution`'s Korean went into `KO_REPORT_LABELS` in `src/pipeline/trendReport/reportLabels.ts`;
    `KO_REPORT_LABELS_PENDING_REVIEW` is now empty.
  - The adopted text is in `plan/reports/ko-review-p7d.ftl` and `plan/reports/ko-review-p7d.md`.
  - `privacyPolicy.test.ts`, `trendScaffold.test.ts` and `test/integration/l10n.spec.ts` now pin both as adopted.
- **(c) "그대로 둠".** The placeables stay, as a named exception to `P7-T03`'s Do NOT (a dated note on `P7-T03`). A new
  test in `test/unit/i18n/format.test.ts` counts them: four messages, five placeables in en-US and four in ko-KR. It
  fails on any other `NUMBER()` in a bundle. Two mutants, both killed.

## 3. Owner questions, each with a draft answer (none adopted)

All in `plan/00` §6 item 401.

- **(a) Scope: NFR-7's two workload memory figures have no method.** The card forbids a paid call, and the plugin has
  no fixture mode for its provider. *Draft:* a test-profile spec with a fake provider, sampling
  `nsIMemoryReporterManager.explicit`; +0.5 d on `P7-T15`.
- **(b) Scope: the report window does not follow Zotero's dark appearance.** Its text stays black on light grey in dark
  (contrast 21:1, so `NFR-13` holds). *Draft:* leave it for v1.0; record it for `P7-T25` to see.
- **(c) Korean (`G-41`): `README.ko.md`.** The 15 open terms and the product-name question are in
  `plan/reports/ko-review-p7e-readme.md`. *Draft:* the draft as written.
- **(d) Security and scope: `npm audit fix` cannot run on this machine's npm 10.9.8.** 21 advisories remain (10
  moderate, 11 high), all in development tools; `npm audit --omit=dev` finds 0. *Draft:* the owner updates npm, and
  `P7-T38` runs again unchanged. The alternatives are `--legacy-peer-deps`, or accepting the development-only advisories
  for v1.0.

## 4. Korean awaiting review (`G-41`)

- **`README.ko.md`, the whole file** (`P7-T20`). It opens with "Draft (coordinator, 2026-11-18, not adopted; G-41,
  P7-T20)" and a visible draft line. Review page: `plan/reports/ko-review-p7e-readme.md`.
- **No `.ftl` string was added in this batch.** So no id went onto `KO_PENDING_REVIEW`, CI gained no `--allow`, and
  `plan/reports/ko-review-p7e-draft.md` was not needed. `plan/06` `G-41` has a dated note with this batch's totals.

## 5. Open findings (not cards, rule 9)

- **The report window does not follow the dark appearance** (item 401(b)).
- **The preferences pane's five price fields are named only by their placeholder.** That passes, but a visible label
  would be stronger (item 400(d)).
- **Mutant M10 survives.** The ceiling moment of the cost dialog does not show the tier question (item 400(d)).
- **NFR-7's workload method is not built** (item 401(a)).
- **`docs/13` §7.2 does not name the "community scraper repository"**, which `P7-T31` must find first (`P7-T23.md`).
- **`npm audit fix` cannot run** (item 401(d)). It blocks `P7-T38`, which blocks `P7-T26`.
- **Fixed in this batch: every plugin dialog showed "OK" and "Cancel".** Gecko reads `buttonlabel*` only while it
  builds a dialog, and the four windows set it later (item 400(c), `P7-T06.md` fix 3).

## 6. Checks (after the last source edit)

Every command ran with `OPENROUTER_API_KEY` removed from the environment. None made a live network, model, keyed or
paid call; the only network use was the npm registry, for `npm audit` and `npm audit fix`.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0; run again after the last document edit: "All matched files use Prettier code style!" |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's step, no `--allow`) | exit 0: "check-l10n: ko-KR matches en-US: 3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | exit 0. Unit: 164 files, 8498 passed, 105 skipped. Contract: 7 files, 93 passed, 28 skipped. |
| `npm run build` | exit 0 |
| typings, sha256 (first 8 characters), before and after the build | unchanged: `global.d.ts` 020956c7, `i10n.d.ts` cd93b62a, `prefs.d.ts` 47439ca8, `prompts.d.ts` 4480d796, `zotero-augment.d.ts` cf994969 |
| XPI | `research-helper.xpi`, 733 556 bytes, sha256 begins `056cad93fa4d0c6a`. A second build of the same tree gave the same 25 files with equal sha256. |
| `/* MUTANT` grep over `src`, `test`, `scripts`, `addon` | 0 |
| `.only` in `test` | 0 |
| Mutation sweeps | `P7-T06` 17: 16 killed, 1 survivor (M10); `P7-T15` 3/3; Part 0 (c) 2/2 |

**Integration runs.** Command: `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration --
--exit-on-finish`, Zotero 10.0.3 on Windows 11. `zotero-plugin test` builds the plugin in test mode at the start of
each run. The source did not change between the three runs, and nothing else built during them. A script checked
before each run that the `/* MUTANT` grep was empty, that there was no `.only`, and that no `zotero.exe` was running.
No Zotero process was killed.

| Run | Start–end (2026-11-18) | Exit | Result | Live-request guard |
|---|---|---|---|---|
| 1 | 08:53:23–09:00:02 | 0 | "382 passed", 2 pending | 1423 channels read, away from loopback `[]` |
| 2 | 09:00:10–09:06:39 | 0 | "382 passed", 2 pending | 1423 channels read, away from loopback `[]` |
| 3 | 09:06:51–09:13:14 | 0 | "382 passed", 2 pending | 1423 channels read, away from loopback `[]` |

- The 2 pending are batch D's two: "§2 criteria 1, 4 and 5: a real PubMed search imports…" and "builds the index over
  a 10 000-item library with exactly one search pending".
- The count went from batch D's 372 to 382: `accessibility.spec.ts`'s eight tests and `startupCost.spec.ts`'s two.
- **Each run also measured:**
  - `P1-T18`: "ko-KR totals: 569 present, 0 absent; expected 569 / 0";
  - `P7-T14`/`P7-T37`: "plugin database: 11 tables, 101 rows, 459 text cells and 0 blob cells searched for 30 values;
    0 found";
  - `P7-T15`: the plugin's own startup work 11, 31 and 37 ms in the instance found, 6 ms at each fresh start, and 0
    requests at start;
  - `P7-T06`: 44 contrast figures, the same in all three runs, all at least 4.5:1.

**Runs before the recorded set**, on earlier source: the two new specs were run alone while they were built
(`a11y-run1.log` to `a11y-run8.log`, `p7t15-run1.log`), and in the mutation runs. `a11y-run7.log` failed two tests on
the dialog button labels, which found the defect above.

The logs are in the scratchpad (`int-er1.log` to `int-er3.log`, `int-er-summary.txt`, `checks1.log`, `unit1.log`,
`build1.log`, `e-audit-*.txt`). They are not part of the repository.

## 7. The file list for `P7-T38`'s separate commit

**None.** `npm audit fix` changed no file: `package.json` and `package-lock.json` are byte for byte as at the base
commit. There is no `P7-T38` commit to make in this batch.

## 8. Final tree state

`git status --short` shows 41 entries: 23 modified files and 18 new entries. `docs/release/` is one entry and holds two
files, so there are 19 new files. This report is one of them. Nothing is staged and nothing is committed. `npm run index:derive` was run after the last plan
edit: "276 tasks, 112 DONE, 164 TODO".

- **Modified, code and assets:**
  - `addon/content/costConfirm.js`, `costConfirm.xhtml`, `preferences.js`, `reportWindow.js`, `searchDialog.js`,
    `searchDialog.xhtml`, `secretBackend.js`, `summarize.js`, `style/searchDialog.css`;
  - `addon/locale/ko-KR/research-helper-mainWindow.ftl`;
  - `src/addon.ts`, `src/hooks.ts`, `src/pipeline/trendReport/reportLabels.ts`.
- **Modified, tests:** `test/integration/l10n.spec.ts`; `test/unit/i18n/format.test.ts`,
  `test/unit/pipeline/privacyPolicy.test.ts`, `test/unit/pipeline/trendScaffold.test.ts`.
- **Modified, docs and plan:** `README.md`, `docs/08`, `docs/12`, `plan/00`, `plan/06`, `plan/10`.
- **New:**
  - `src/bootstrap/startupTimings.ts`;
  - `test/integration/accessibility.spec.ts`, `test/integration/startupCost.spec.ts`,
    `test/unit/bootstrap/startupTimings.test.ts`;
  - `README.ko.md`;
  - `docs/release/v1.0-checklist.md`, `docs/release/announcement-v1.0.md`;
  - `docs/spikes/phase-7-accessibility.md`, `docs/spikes/phase-7-profiling.md`;
  - `plan/reports/P7-T06.md`, `P7-T15.md`, `P7-T20.md`, `P7-T23.md`, `P7-T24.md`, `P7-T38.md`, `P7-batchE.md`;
  - `plan/reports/ko-review-p7d.ftl`, `ko-review-p7d.md`, `ko-review-p7e-readme.md`.

The key was never read and was removed from every command's environment. No key was written anywhere. The owner's
email was not added anywhere: the checklist and the drafts name `MAINTAINER_EMAIL` only. Nothing was pushed, tagged,
triggered, published, posted or registered. No PDF was added.

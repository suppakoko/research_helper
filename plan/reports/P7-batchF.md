# Phase 7 batch F — Part 0 (item 401's answers), `P7-T15`'s memory measurement, `P7-T06`'s M10, `P7-T38`

**Date:** 2026-11-18 · **Executor:** Claude Code (agent), the tree and Zotero owner for the batch, under the
coordinator's brief of 2026-11-18 (the last agent batch of Phase 7) · **Commit base:** 9500f63, **nothing committed**
(the coordinator reviews and commits) · **Cards left:** all `TODO`, each with a dated note. Only the owner sets `DONE`.

## 1. Summary

| Part | What | Result | Report |
|---|---|---|---|
| Part 0 | Item 401(a)–(d): the owner's answers | Recorded as "DECIDED 2026-11-18 (owner, plan/00 §6 item 401(x))". (a) built, +0.5 d carried; (b) the report window stays light in v1.0; (c) `README.ko.md` adopted, banner removed; (d) `P7-T38` run once with npm 11.21.3. | item 401; §2 |
| Part 1.1 | `P7-T15`: `NFR-7`'s workload memory, test profile | Built (`workloadMemory.spec.ts`) and run in all seven recorded runs. The reference workload **passes in the test profile**. The 500-item full-text job was within 400 MB in six runs and **over it by 13.9 MB in one**. §8.8's growth line is **not met**, partly because of the plugin's closed windows. A 10.5–10.7 s timer gap in 500-item jobs. 3 of 3 mutants killed. | `P7-T15.md`; §5 |
| Part 1.2 | `P7-T06`'s M10 | The ceiling moment's missing tier question is intended (`docs/08` §6.4, `docs/07` §8.5). M10 was not equivalent; a new pre-flight test kills it. Sweep 17 of 17. | `P7-T06.md`; §5 |
| Part 1.3 | Checks and runs before `P7-T38` | All checks pass. Integration: run 1 failed once in `preferences.spec.ts` (item 403(c)); runs 2–4, "385 passed" each, are the three clean consecutive runs. | §6.1 |
| Part 1.4 | `P7-T38` | **Stopped as item 401(d) says.** npm 11.21.3 changed the lockfile (21 → 16 advisories), but `picomatch`'s fix needs a breaking change. Package files restored to HEAD; XPI contents identical; every check and three integration runs ("385 passed" each) pass on the restored tree. No `P7-T38` commit. | `P7-T38.md`; §7 |

**Estimate.** Phase 7 32.00 → 32.50 d (`P7-T15` 1.5 → 2.0 d, item 401(a)), carried to the five sites of `plan/README`
§7 (item 402(a)). No other estimate changed. `npm run index:derive` was run after the last plan edit (§9).

**Coordinator decisions** (under item 313): `plan/00` §6 item 402(a)–(h). **Owner questions:** item 403(a)–(e), each
with a draft answer, none adopted.

## 2. Part 0: the owner's answers to item 401

Each is recorded as "DECIDED 2026-11-18 (owner, plan/00 §6 item 401(x))" on item 401 itself.

- **(a) "만듦".** The test-profile memory measurement was built: `test/integration/workloadMemory.spec.ts`, with a
  fake provider. It makes no network call, uses no key and spends nothing. `P7-T15` gained 0.5 d (1.5 → 2.0 d),
  carried to the five sites of `plan/README` §7 (item 402(a)):
  - Phase 7: 32.50–46 d;
  - the project: 228.75–321 d;
  - the critical path: 160.50–225 d.

  The figures are in the release checklist as **test-profile figures only**. The large-library run (`G-34`) stays the
  owner's. Figures and findings: §5 and §6 below, and `plan/reports/P7-T15.md`.
- **(b) "1.0에서는 그대로".** The report window does not follow Zotero's dark appearance in v1.0; following it is a
  later-release candidate. There are dated notes in `docs/08` §9's Visual list (where theming is described), on
  `plan/10` `P7-T06`, and in `plan/reports/P7-T06.md`.
- **(c) "모두 승인".** `README.ko.md` is approved as written.
  - Its draft comment and visible draft line were removed, and one provenance comment line took their place
    (item 402(g)).
  - A script checked every other byte against a copy of the draft (`f-README.ko.draft.md` in the scratchpad). Both
    READMEs have 11 `## ` headings.
  - `README.md`'s link no longer says "a draft awaiting review". The release checklist's three mentions were updated.
  - The approval is recorded in `plan/06` `G-41` and on `plan/10` `P7-T20` and `P7-T05`. `P7-T05`'s README part is
    settled, and the rest of `P7-T05` stays the owner's.
- **(d) "새 npm으로 한 번만 실행".** `P7-T38` was run once, last, with npm 11.21.3 through `npx`; the installed npm
  10.9.8 was not touched. The outcome: §7 below and `plan/reports/P7-T38.md`.

## 3. Owner questions, each with a draft answer (none adopted)

All in `plan/00` §6 item 403.

- **(a) Scope: `docs/13` §8.8's growth line does not hold in the test profile.** Across five reference jobs the idle
  heap grew by +21.3 to +25.6 MiB. Three of the plugin's closed windows stay in memory (18.6 MiB together). *Draft:*
  card a fix before `P7-T25` (about 1 d), and read the line as "no plugin window or plugin realm grows". The
  alternative is a waiver for v1.0.
- **(b) Scope (`NFR-3`): in each 500-item summarize job, the main thread ran no timer for 10.5–10.7 s.** The probe
  (§5) shows the summarize window's synchronous row redraws are not the cause. *Draft:* record a Gecko profile of the
  job in the test profile first, kept local (about 0.25 d), and card a fix only if the long task is the plugin's.
- **(c) Security (test design): `preferences.spec.ts`'s whole-profile sweep failed once on a platform default.** The
  hit was consistent with a four-character random needle matching inside a shipped App Store URL. *Draft:* skip
  preferences with no user value in that sweep, and keep every needle (about 0.1 d).
- **(d) Security and scope: `P7-T38`.** npm 11.21.3 fixed 6 of the 21 advisories, but `picomatch`'s needs a breaking
  change, so the package files were restored. *Draft:* accept the development-only advisories for v1.0, recorded in the
  checklist; `release.yml`'s gate passes, with `--omit=dev` at 0. The alternative is to adopt the non-breaking lockfile
  change after its own checks.
- **(e) Scope (`NFR-7`): the 500-item full-text peak reached 413.9 MB in one of seven runs.** The range was
  351.8–413.9 MB, and the spec's "within" label compares against MiB. *Draft:* treat the row as not met with any
  margin, and card a look at what the job holds at its peak (about 1 d), with the labels changed to MB. The
  alternative is to accept it as "at the budget" for v1.0.

## 4. Korean awaiting review (`G-41`)

**No Korean string was added in this batch.** So nothing went onto `KO_PENDING_REVIEW`, CI gained no `--allow`, and
`plan/reports/ko-review-p7f-draft.md` was not needed. The only Korean change is `README.ko.md`'s adoption (item
401(c)), recorded in `plan/06` `G-41`.

## 5. Part 1: what was built and found

1. **`P7-T15`: the memory measurement (item 401(a)).** `test/integration/workloadMemory.spec.ts`, two tests, run in
   every integration run. The method is in `docs/spikes/phase-7-profiling.md` §3.2–§3.3; the figures are in §6.1 there
   and in `plan/reports/P7-T15.md`. In the recorded runs, in the test profile only:

   | Figure | Budget | Seven runs (four before `P7-T38`, three after) | Result |
   |---|---|---|---|
   | Reference workload (job 1), peak over idle | ≤ 150 MB | 59.1–62.0 MiB (62.0–65.0 MB) | **pass** |
   | Any of the five reference jobs | ≤ 150 MB | ≤ 87.6 MiB (91.9 MB) | **pass** |
   | 500-item full-text job, peak over idle | ≤ 400 MB | 335.5–394.7 MiB (351.8–413.9 MB) | six within; **one over by 13.9 MB** (item 403(e)) |
   | Idle heap growth after five jobs | none | +21.3 to +26.0 MiB | **not met** (item 403(a)) |
   | The sampler's longest gap, 500-item job | (for `NFR-3`) | 10.50–10.72 s | item 403(b) |

   The four runs before `P7-T38` alone gave 353.6–395.1 MB for the full-text job, all within. The seventh run, on a
   tree whose files are identical to theirs, gave 413.9 MB. So the spread between runs is the finding, not the restore.
   The spec's own lines said "within" all seven times, because they compare against 400 **MiB** (item 402(c)).

   **Mutation:** 3 mutants on the measurement's own logic, 3 killed (W1, W2, W3; `plan/reports/P7-T15.md`).
2. **`P7-T06`'s M10.** That the ceiling moment shows no tier question is **intended**:
   - only `PreflightDialogModel` carries `tierQuestion`;
   - `docs/08` §6.4 and `docs/07` §8.5 describe it this way as built.

   M10 was **not equivalent**, because `buildAudioDialogModel` can open the pre-flight moment without a run. A new test
   in `test/integration/accessibility.spec.ts` opens an audio run's pre-flight moment with the tier question. With M10
   planted, that test failed and the other ten passed ("10 passed, 1 failed"; the group's name read `""`). `P7-T06`'s
   sweep is now 17 of 17 killed (item 402(f), `plan/reports/P7-T06.md`).
3. **The render probe** (a development run, not recorded, 12:58–13:02).
   - **Setup:** a scratch script planted three marked edits in `workloadMemory.spec.ts` and restored the file
     afterwards (sha256 equal):
     - the full-text test alone;
     - no attachments, so the items took about a minute to make;
     - `RHSummarizeWindow.renderRows` wrapped to count and time each call.
   - **Result:** in the 500-item job, `renderRows` ran **1008 times** and drew **503 500 rows**. Its own synchronous
     work totalled **964 ms**, and its longest call took **2.3 ms**, with 500 rows. No call took over 50 ms.
   - **The same job** still showed a **9.9 s** sampler gap (ending 10.1 s into a 29.8 s job).
   - **So the DOM rebuild is not the gap.** What runs during it is not established (item 403(b)).

**No production code changed in this batch.** `git status` lists only tests, docs and plan files (§9), so there was no
new production code to mutation-test. The new test code was mutation-tested: M10 for the accessibility test, and W1–W3
for the measurement.

## 6. Checks and integration runs

Every command ran with `OPENROUTER_API_KEY` removed from the environment. None made a live network, model, keyed or
paid call. The only network use was the npm registry: `npm view`, `npm audit`, and `npx -y npm@11.21.3 audit fix`. In
every integration run the live-request guard read 1465 channels, and its "away from loopback" list was `[]`.

### 6.1 Before `P7-T38` (the tree without its package changes)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0: "All matched files use Prettier code style!" (run again after the last document edit, §9) |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's step, no `--allow`) | exit 0: "check-l10n: ko-KR matches en-US: 3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | First run: exit 1, two tests timed out at 5000 ms (`container.test.ts`, `sessionStore.test.ts`; neither changed in this batch), while module transforms took 344 s, just after a Zotero run. Second run: exit 0. Unit: 164 files, 8498 passed, 105 skipped. Contract: 7 files, 93 passed, 28 skipped. |
| `npm run build` | exit 0 |
| typings, sha256 (first 8 characters), before and after the build | unchanged: `global.d.ts` 020956c7, `i10n.d.ts` cd93b62a, `prefs.d.ts` 47439ca8, `prompts.d.ts` 4480d796, `zotero-augment.d.ts` cf994969 |
| XPI | `research-helper.xpi`, 733 556 bytes, 25 files; kept as the pre-fix baseline |
| `/* MUTANT` grep over `src`, `test`, `scripts`, `addon`; `.only` in `test` | 0 and 0, before every recorded run |

**Integration runs.**
- **Command:** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`, on Zotero
  10.0.3 and Windows 11. `zotero-plugin test` builds the plugin in test mode at the start of each run.
- **The tree:** the source did not change between runs, and nothing else built during them.
- **Before each run,** a script waited for the previous run's Zotero to exit. It then checked that the `/* MUTANT`
  grep was empty, that there was no `.only`, and that no `zotero.exe` was running.
- No Zotero process was killed.

| Run | Start–end (2026-11-18) | Exit | Result |
|---|---|---|---|
| 1 | 11:46:46–12:04:30 | 1 | "384 passed, 1 failed": `preferences.spec.ts`, "no preference anywhere in the profile holds the key or its digest", hit `browser.contentblocking.report.mobile-ios.url` (item 403(c)) |
| 2 | 12:04:41–12:22:32 | 0 | "385 passed", 2 pending |
| 3 | 12:22:41–12:40:19 | 0 | "385 passed", 2 pending |
| 4 | 12:40:33–12:58:12 | 0 | "385 passed", 2 pending |

- **Runs 2–4 are the three clean consecutive runs** on one build state. Run 4 was added because run 1 failed. The
  failing test passed in runs 2–4, and in batch E's three runs. Its spec did not change in this batch.
- **The 2 pending** are batch D's two: "§2 criteria 1, 4 and 5: a real PubMed search imports…" and "builds the index
  over a 10 000-item library with exactly one search pending".
- **The count** went from batch E's 382 to 385: `workloadMemory.spec.ts`'s two tests, and `accessibility.spec.ts`'s
  pre-flight test.
- **Each run also measured** the same as batch E:
  - `P1-T18`: "ko-KR totals: 569 present, 0 absent; expected 569 / 0";
  - `P7-T14`: "plugin database: 11 tables, 101 rows, 459 text cells and 0 blob cells searched for 30 values; 0 found";
  - `P7-T15`'s startup: 13–36 ms of the plugin's own work in the instance found, 6 ms at each fresh start, and 0
    requests;
  - `P7-T06`: 44 contrast lines, identical in all four runs.
- **Each run took about 18 minutes**, about 11 more than batch E's. The memory spec's full-text test spends about
  5.5 minutes making its 500 items.

### 6.2 After `P7-T38` (the restored tree)

| Check | Result |
|---|---|
| `package.json`, `package-lock.json` | byte for byte equal to HEAD, and to the copies taken before `P7-T38` |
| every repository file outside `node_modules` | sha256 equal to the set taken before `P7-T38` (1591 files) |
| `npm ls --depth=0`; `npm ls --all` | the same as before; exit 0 |
| `npm audit`; `npm audit --omit=dev` | "21 vulnerabilities (10 moderate, 11 high)", as before; "found 0 vulnerabilities" |
| `npm run typecheck`, `npm run lint:check`, `npx eslint .` | exit 0 each |
| `npm run l10n:check` (CI's step) | exit 0: "3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | First run: exit 1, 3 failed: two time-outs at 5000 ms in `installServices` tests, and a follow-on "host rate limiters are already installed", while module transforms took 458 s, just after the reinstall. Second run: exit 0, with the same counts as §6.1 (8498 unit, 93 contract). |
| `npm run build` | exit 0; the typings' sha256 unchanged, and equal to §6.1's |
| XPI, against the pre-fix build (`xpi-cmp.sh`) | 25 files before and after; **file lists identical; every file's sha256 identical**; 733 556 bytes |

**Integration runs on the restored tree.** These used the same command and the same pre-run checks as §6.1, on one
build state. No Zotero process was killed.

| Run | Start–end (2026-11-18) | Exit | Result |
|---|---|---|---|
| 1 | 13:18:49–13:36:35 | 0 | "385 passed", 2 pending |
| 2 | 13:36:45–13:54:15 | 0 | "385 passed", 2 pending |
| 3 | 13:54:23–14:13:36 | 0 | "385 passed", 2 pending |

- **Three clean consecutive runs.**
- **The same per-run lines as §6.1:**
  - `P1-T18` 569 / 0;
  - `P7-T14` 0 found;
  - startup own work 9–37 ms in the instance found, and 6 ms at each fresh start, with 0 requests;
  - the 44 contrast lines identical to §6.1's;
  - "away from loopback: []".
- **The memory figures** of these three runs are in §5's table and `plan/reports/P7-T15.md`.

**Runs before the recorded sets** were development runs on earlier states of the new tests: `f-mem1.log`,
`f-probe1.log`, `f-mem2.log`, the four mutation runs, and the render probe. Each mutant was restored with its sha256
checked.

The logs are in the scratchpad (`f-pre1.log`–`f-pre4.log`, `f-pre-summary.txt`, `f-post1.log`–`f-post3.log`,
`f-post-summary.txt`, `f-checks-pre.log`, `f-checks-post.log`, `f-unit-pre2.log`, `f-unit-post2.log`, `f-audit-*`,
`f-t38-*`). They are not part of the repository.

## 7. `P7-T38` and the file list for its separate commit

npm 11.21.3 ran once and changed only `package-lock.json`.

- **Audits:** 21 advisories before (10 moderate, 11 high) and 16 after (2 moderate, 14 high). `--omit=dev` was 0 in
  both.
- **Lockfile diff:** 64 entries changed, 8 added, 1 removed; the details are in `plan/reports/P7-T38.md`.
- **The stop:** its own report said the remaining `picomatch` advisory needs `--force`, which would install
  `zotero-plugin-scaffold@0.1.7`, a breaking change. As item 401(d) says, the lockfile was restored byte for byte to
  HEAD, and `node_modules` was reinstalled from it with `npm ci --offline`.
- **The restored state** is the same as before `P7-T38`: every repository file's sha256, `npm ls`, and the 21
  advisories.

**The file list for `P7-T38`'s separate commit: none.** `package.json` and `package-lock.json` equal HEAD. No other
file was changed by `P7-T38`; the sha256 of all 1591 repository files outside `node_modules` was compared before and
after.

## 8. Open findings (not cards, rule 9)

- **Growth after five jobs; three plugin windows stay in memory after closing** (item 403(a)).
- **A 10.5–10.7 s timer gap in each 500-item summarize job; the cause is not established** (item 403(b)).
- **`preferences.spec.ts`'s whole-profile sweep can match a platform default by chance** (item 403(c)).
- **`P7-T38`: advisories that need a breaking change** (item 403(d)). It blocks `P7-T26`.
- **The first unit run after a Zotero run, or after a reinstall, timed out in `installServices` tests twice today.**
  Module transforms took 344 s and 458 s; the second run passed each time. These tests sit close to vitest's 5000 ms
  default when transforms are slow. *The cause was not investigated.* No card: it blocks nothing.
- **Making 500 items with attachments raised the idle heap by about 860 MiB**, mostly Zotero's own windows and strings.
  It is outside `NFR-7`'s job figures. *What holds it was not investigated.*
- **The 500-item full-text peak went over 400 MB in one of seven runs** (413.9 MB), and the spec's labels compare
  against MiB (item 403(e)).
- **npm 11 does not run install scripts without an `allowScripts` list** (`es5-ext`, `esbuild`, `@swc/core`). This
  matters only when the project moves to npm 11 (item 403(d)).

## 9. Final tree state

`git status --short` shows 18 entries: 16 modified files and 2 new files, one of them this report. Nothing is staged
and nothing is committed. The base is 9500f63. `npm run index:derive` was run after the last plan edit: "276 tasks, 112 DONE, 164 TODO".

- **Modified, tests:** `test/integration/accessibility.spec.ts` (the pre-flight test, item 402(f)).
- **New, tests:** `test/integration/workloadMemory.spec.ts` (item 401(a)).
- **Modified, docs:**
  - `README.md` and `README.ko.md` (item 401(c));
  - `docs/08` (item 401(b)), `docs/11` (item 402(a)), `docs/13` (§8.8's dated note);
  - `docs/release/v1.0-checklist.md`, `docs/spikes/phase-7-accessibility.md`, `docs/spikes/phase-7-profiling.md`.
- **Modified, plan:** `plan/00`, `plan/05`, `plan/06`, `plan/10`; `plan/reports/P7-T06.md`, `P7-T15.md`, `P7-T38.md`.
- **New, plan:** `plan/reports/P7-batchF.md`.
- **Not changed:** every file under `src/`, `addon/` and `scripts/`, and `package.json` and `package-lock.json`, which
  equal HEAD (§7).

The key was never read, and it was removed from every command's environment. No key was written anywhere. The owner's
email was not added anywhere. Nothing was pushed, tagged, triggered, published or posted. No PDF was added. Each
temporary `.only` and each planted mutant or probe was removed before the recorded runs, and the `/* MUTANT` and
`.only` greps were empty before each of the seven recorded runs.

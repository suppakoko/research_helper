# Phase 7 batch K: card P7-T42, the summarize window's row redraw, and the recorded runs

**Date:** 2026-11-25 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-25 (batch K) · **Commit base:** 7f1a6df, uncommitted. The coordinator commits.

Logs and scripts named here are in the session scratchpad
(`C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad`),
outside the repository. Batch K's own files there start with `k-`. The first session of batch K ended before any
file changed; this batch started again from step 1 at 15:50.

## 1. Summary

- **`P7-T42` is carded and built** (`plan/reports/P7-T42.md`). The summarize window keeps each row's element between
  updates, keyed by the item's key, and sets a row again only when its Fluent id or arguments change. No Fluent id,
  text, accessible name or key binding changed, and no Korean or English text was added.
- **Six recorded runs on one tree, every one 388 passed and 0 failed**: three with the debugger, three with
  `RH_DEVTOOLS=off`. Each named Zotero 10.0.8 (build 20261106171835). No run failed, so none needed repeating, and
  no `DONE` card is affected.
- **The accessibility service was on in all six recorded runs** (and in both development runs), and **the 500-item
  job's longest sampler gap was 188–638 ms**, with no gap of 1 s or more in any run. Batch J's six, with the service
  on and the old code: 3,030–4,344 ms. So **`P7-T42`'s first `Done when` line is met in all six**. The job took
  12.3–16.5 s (batch J: 211.3–360.2 s).
- **`P7-T41`'s first `Done when` line has no qualifying run.** Item 413(b) reads it on recorded runs whose log says
  the service is off, and none of batch K's (or batch J's) did. It was met in all six with the service on. Owner
  question: item 415(a).
- **Tests:** 11 new unit tests run the shipped `summarize.js` against a fake document; 9 fail on the code before the
  card. The integration spec now asserts that each summarize job adds every row once and removes none.
- **Mutants:** K1 (rebuild of all rows), K2 (missed text update), K3 (missed removal), K4 (wrong order): 4 of 4
  killed by the unit tests. K1 was also run inside Zotero, where the new assertion killed it. Every marker was taken
  out.
- **Without the debugger** (the figures of record, item 405(b)):
  - reference jobs 1–5: 49.1–68.6 MiB (51.5–71.9 MB) peak over idle, within 150 MB;
  - the 500-item full-text job: 105.8–112.8 MiB (**110.9–118.3 MB**), within 400 MB by at least 281.7 MB (batch J:
    252.5–254.4 MB);
  - growth after five jobs: the plugin's share is one group, +0.1 MiB, within the 1 MiB tolerance; the whole process
    grew +5.2 to +6.0 MiB (heap);
  - closed plugin windows alive: 0 of 20 in each run, and the 500-item job's window freed in each.
- **Estimate:** Phase 7 35.75 → 36.75 d over 42 cards (36.75–51 d); the project 232.00–325 → 233.00–326 d over 280
  cards; the critical path 163.75–229 → 164.75–230 d. Re-derived by script from the card bodies and carried to the
  five sites of `plan/README` §7 (§2).
- **Network:** every run's live-request guard listed only loopback hosts (§6).
- **The launch gate** passed at the first try before all eight launches (§7). The scaffold's npm check cache was
  written with the current time before every launch and before the build (item 411(b)).
- **Build:** `research-helper.xpi` 735,222 bytes; `typings/` unchanged (§8).
- **Decisions:** `plan/00` §6 item 414 (a)–(h). **Owner questions:** item 415 (a), with a draft not adopted.

## 2. Step 1: the card and the estimate

- `P7-T42` was added to `plan/10` from batch J's draft (§9.3 there) by `k-plan10.mjs`: State `TODO`, Depends on
  `P7-T15`, Blocks `P7-T24`, with the reverse edges added to both; Retires none; 1.0 d; no gate. Its Files name
  `renderRows`'s caller (`render`, same file) and the function that builds the rows (`buildSummarizeWindowModel` in
  `summarizeDialog.ts`), whose own caller (`createSummarizeSession` in `registerUI.ts`) is not modified (rule 10).
  Its first `Done when` line is the one item 413(b) moved from `P7-T41`.
- `P7-T41`'s first `Done when` line carries a dated note (item 413(b)): it is read on recorded runs whose log says the
  accessibility service is off.
- **The figures were re-derived by script** (`k-sums.mjs`): every card body's `Estimate` row in the eight phase files,
  the band's top as the sum × 1.4 with an exact half rounding up, and Phase 7's longest path over its `Depends on`
  rows with a check that every `Depends on` has its `Blocks`. Before the card it reproduced every published figure.

| Figure | Before | After |
|---|---|---|
| Phase 7 | 41 cards, 35.75–50 d | **42 cards, 36.75–51 d** |
| Phases 4–7 | 117 cards, 118.00–165 d | 118 cards, 119.00–166 d |
| Project | 279 cards, 232.00–325 d | **280 cards, 233.00–326 d** |
| Critical path P0 → P1 → P2 → P4 → P6 → P7 | 163.75–229 d | **164.75–230 d** |
| Route through P3 | 160.75–225 d | 161.75–226 d (margin 3 d / 4 d, unchanged) |
| Route through P5 | 154.00–216 d | 155.00–217 d (Phase 5's float 9.75–13 d, unchanged) |
| Phase 7's internal longest path | 16.50 d | 16.50 d (`P7-T42` ends at 13.25 d, tied with `P7-T39`–`P7-T41`) |
| Months at 21 working days | ≈ 11–15 | ≈ 11–15 (233.00 ÷ 21 ≈ 11.1; 326 ÷ 21 ≈ 15.5) |

- **On the critical path:** Phase 7 is on the project's critical path, so `P7-T42`'s 1.0 d is too. Inside Phase 7 it
  ties for the longest path and does not lengthen it.
- **The five sites** (`k-propagate.mjs`, unique-string replacements built from the computed figures):
  1. `plan/10`'s roll-up, §1 table, §3 table and `Effort` prose (now +75 % over the scaled low end, 27 % above the
     scaled top, +163 % over the old 10–14 d);
  2. `docs/11` §1's table (Phase 7 row, Phases 4–7 subtotal, total);
  3. `docs/11` §1's prose (the whole-plan sum, the months, the mermaid node);
  4. `docs/11`'s Phase 7 `Effort` paragraph and §2's critical path, Phase 3 route and Phase 5 float;
  5. `plan/00` §1's table, with its last column at +163 %.

  Also `plan/05`'s Phase 7 pointer. `npm run index:derive`: 280 tasks, 235 `DONE`, 45 `TODO`.

## 3. Step 2: the build

See `plan/reports/P7-T42.md` for the change, the tests and the mutation table. Development runs (each behind the
gate, without the debugger, `.only` on the reference workload and the 500-item test; neither is a recorded run):

| Run (log) | What | Accessibility service | 500-item job | Longest gap | Row elements added / removed (500-item job) | Result |
|---|---|---|---|---|---|---|
| Development 1 (`k-dev1-fix-off.log`) | the fix | on | 16.5 s | 205 ms | 500 / 0 | 2 passed |
| Mutant K1 (`k-mut-K1-off.log`) | the old rebuild put back | on | 50.5 s | 1,012 ms | 503,500 / 503,000 | 0 passed, 2 failed (killed by the new assertion) |

## 4. The recorded runs

**One tree.** Before each launch the run script (`k-run.sh`, driven by `k-record.sh`) refused the run if any of these
failed: the launch gate (§7); no build running; every one of the 1,234 files under `src`, `test`, `scripts` and
`addon` against one sha256 manifest (`k-tree.sha`) and the file count; an empty `/* MUTANT` grep; no `.only(`. Each
log's header has the sha256 of `summarize.js` (64b13af2…99cf), `summarizeDialog.ts` (b88b773e…4da9),
`registerUI.ts` (a2335c6b…8c3c, unchanged since batch J) and `workloadMemory.spec.ts` (8a06e6df…33ac).

**The command:** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`, with
`RH_DEVTOOLS=off` for the second three.

| Run | Debugger | Start | End | Result | `testProfile.spec.ts` | Accessibility service |
|---|---|---|---|---|---|---|
| `k-rec1-on.log` | on | 16:27:59 | 16:47:30 | 388 passed, 0 failed | passed; 10.0.8, debugger true | on |
| `k-rec2-on.log` | on | 16:47:34 | 17:07:06 | 388 passed, 0 failed | passed; 10.0.8, debugger true | on |
| `k-rec3-on.log` | on | 17:07:09 | 17:25:46 | 388 passed, 0 failed | passed; 10.0.8, debugger true | on |
| `k-rec1-off.log` | off | 17:25:49 | 17:39:18 | 388 passed, 0 failed | passed; 10.0.8, debugger false | on |
| `k-rec2-off.log` | off | 17:39:21 | 17:54:27 | 388 passed, 0 failed | passed; 10.0.8, debugger false | on |
| `k-rec3-off.log` | off | 17:54:30 | 18:08:16 | 388 passed, 0 failed | passed; 10.0.8, debugger false | on |

All on 2026-11-25, one after another, with no other launch between them.

**The accessibility service was on in every run**, so the brief's fallback (a development run with it forced on)
was not needed, and no machine setting was touched.

## 5. Figures (`workloadMemory.spec.ts`, test profile, fake provider)

MiB as the spec logs it; MB (10⁶ bytes) in brackets. Peaks are heap over the idle reading before the job.

### 5.1 Without the debugger (`RH_DEVTOOLS=off`): the figures of record (item 405(b))

| Run | Reference jobs 1–5, peak over idle | 500-item full-text job, peak over idle | Its time; longest gap | Growth after five jobs: plugin's groups | Growth: whole process (heap; resident; `explicit/` sum) | Closed plugin windows alive | The 500-item job's closed window | Idle after that job over idle before |
|---|---|---|---|---|---|---|---|---|
| 1 | 52.1, 54.4, 52.7, 54.0, 68.6 MiB | 105.8 MiB (**110.9 MB**) | 16.5 s; 193 ms | 1 group, +0.1 MiB (the plugin's realm); 0 over 1 MiB | +5.2; −5.0; +4.2 MiB | 0 of 20 | **freed** (asserted) | −4.2 MiB |
| 2 | 51.8, 51.4, 52.3, 50.1, 66.6 MiB | 107.0 MiB (**112.2 MB**) | 16.5 s; 190 ms | the same | +5.3; −6.7; +2.9 MiB | 0 of 20 | **freed** (asserted) | −3.9 MiB |
| 3 | 49.1, 51.5, 51.9, 51.2, 64.9 MiB | 112.8 MiB (**118.3 MB**) | 16.5 s; 188 ms | the same | +6.0; −4.4; +5.4 MiB | 0 of 20 | **freed** (asserted) | −4.3 MiB |

- **Budgets:** every reference job ≤ 68.6 MiB (71.9 MB), within 150 MB; the 500-item job ≤ 118.3 MB, within 400 MB by
  at least 281.7 MB.
- **Against batch J** (its recorded runs, the code before `P7-T42`): the 500-item peak was 252.5–254.4 MB there;
  reference jobs 64.8–78.2 MB there. The cause of the fall is not measured; the job now makes 500 row elements in all
  instead of about 500 an update.
- **After the 500-item job,** the idle heap was 3.9–4.3 MiB below the idle before it (batch J: +5.2 to +5.5 MiB above).
  The plugin's realm read +3.2 MiB in `explicit/` after the job, as in batch J.
- **Making the 500 items** took 225–232 s (Zotero's work), as before.

### 5.2 With the debugger (the default configuration), for comparison only

| Run | Reference jobs 1–5, peak over idle | 500-item full-text job, peak over idle | Its time; longest gap | Growth: plugin's groups | Growth: whole process (heap; resident; `explicit/` sum) | Closed plugin windows alive | The 500-item job's closed window |
|---|---|---|---|---|---|---|---|
| 1 | 54.7, 57.6, 56.4, 54.5, 76.0 MiB | 205.0 MiB (215.0 MB) | 14.4 s; 551 ms | 6 groups, 3 over 1 MiB: `costConfirm.xhtml` +9.5, `summarize.xhtml` +4.0, `reportWindow.xhtml` +3.0 (detached windows); not asserted | +18.7; −0.9; +34.7 MiB | 20 of 20 | alive (not asserted) |
| 2 | 55.1, 55.7, 55.9, 53.9, 75.4 MiB | 203.2 MiB (213.1 MB) | 14.5 s; 638 ms | the same | +13.8; −6.2; +35.0 MiB | 20 of 20 | alive (not asserted) |
| 3 | 50.9, 55.7, 53.5, 56.6, 76.3 MiB | 197.1 MiB (206.7 MB) | 12.3 s; 603 ms | the same | +19.8; −0.2; +34.9 MiB | 20 of 20 | alive (not asserted) |

With `--jsdebugger`, Gecko keeps every closed chrome window (item 404(h)), so the spec asserts on neither.

## 6. Network: the live-request guard's host lists

| Run | Hosts let through | Away from loopback |
|---|---|---|
| rec1-on | `127.0.0.1:59321`, `localhost:57334` | `[]` |
| rec2-on | `127.0.0.1:59321`, `localhost:58374` | `[]` |
| rec3-on | `127.0.0.1:59321`, `localhost:64663` | `[]` |
| rec1-off | `127.0.0.1:59321`, `localhost:60322` | `[]` |
| rec2-off | `127.0.0.1:59321`, `localhost:59870` | `[]` |
| rec3-off | `127.0.0.1:59321`, `localhost:62140` | `[]` |
| development 1 | `localhost:54702` | `[]` |
| mutant K1 | `localhost:53039` | `[]` |

Every host the guard let through was loopback, in every run. No log printed the scaffold's "Update:" line.

## 7. The launch gate and the scaffold's npm check (item 411(b))

The gate (`k-gate.sh`, batch J's with `k-procpath.ps1`) ran before every Zotero launch: eight launches (two
development runs and six recorded runs). Its checks: `C:\Program Files\Zotero\app\application.ini` reads
`Version=10.0.8`; no `active-update.xml` under `C:\ProgramData\Zotero\updates`; no running
`C:\Program Files\Zotero\updater.exe`, by path (`QueryFullProcessImageName`), with any other `updater.exe` logged by
path; no test-profile `zotero.exe` (a command line naming `.scaffold`).

- **All four checks passed at the first try before every launch.** No `updater.exe` of any program was running at
  any check, so none was logged. Zotero's own updater, an active update or another version was never seen.
- Nothing was done to any `updater.exe` or any process; nothing under `C:\Program Files` or `C:\ProgramData` was
  changed. No test-profile Zotero needed stopping.
- **Item 411(b):** before every Zotero launch (in `k-run.sh`) and before the build, the current time was written into
  `%LOCALAPPDATA%\tiny-update-notifier\Cache\zotero-plugin-scaffold`, so the scaffold's once-a-day npm registry check
  did not run. Each log's first line records the value written.
- No integration run ran during a build, and no build ran during an integration run.

## 8. Checks on the final tree

The last edit under `src`, `test`, `scripts` or `addon` was at 16:25 (the spec and `summarize.js` restored by sha256
after mutant K1). The checks ran at 16:25–16:28, all with `env -u OPENROUTER_API_KEY`. Nothing under those folders
changed after them: the six recorded runs and the build all match `k-tree.sha` (1,234 files).

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's call: no extra arguments) | exit 0; "ko-KR matches en-US: 3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | exit 0; unit 165 files, 8,529 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` (18:08:57, after the six runs; cache written 18:08:45) | exit 0; `research-helper.xpi` 735,222 bytes, under 3,145,728 |

`typings/` sha256 after the build, unchanged by it and equal to batch J's: `global.d.ts` 020956c7…1060, `i10n.d.ts`
cd93b62a…196b, `prefs.d.ts` 47439ca8…cc3f, `prompts.d.ts` 4480d796…760c, `zotero-augment.d.ts` cf994969…62d5.

## 9. Decisions and questions

- **Coordinator decisions:** `plan/00` §6 item 414 (a)–(h), "DECIDED 2026-11-25 (coordinator, under item 313)".
- **Owner question:** `plan/00` §6 item 415 (a), with a draft answer **not adopted**: how `P7-T41`'s first `Done when`
  line is read when no recorded run had the accessibility service off.
- No new or changed Korean or English text is needed by anything in this batch.

## 10. The final tree

- **Base:** 7f1a6df, uncommitted.
- **Modified (source):** `addon/content/summarize.js` (`renderRows`, `state.rowElements`), `src/ui/dialogs/summarizeDialog.ts`
  (`SummarizeWindowRow`; the rows' `key`).
- **Modified (tests):** `test/unit/ui/summarizeDialog.test.ts` (11 tests), `test/integration/workloadMemory.spec.ts`
  (`watchRows`, `assertRowsKept`, the `P7-T42` log line, the header comment).
- **Modified (records):** `plan/10-phase-7-release.md` (`P7-T42`; edges on `P7-T15`, `P7-T24`; `P7-T41`'s note and
  State; roll-ups), `plan/00-task-index.md` (§1, items 414 and 415, `npm run index:derive`), `plan/05-phases-4-7-outline.md`,
  `docs/11-implementation-roadmap.md`, `plan/reports/P7-T41.md` and `P7-T15.md` (batch K sections),
  `docs/13-testing-build-and-release.md` §8.8, `docs/release/v1.0-checklist.md` (rows `NFR-3`, `NFR-7`, 8.8.1, 8.8.2),
  `docs/spikes/phase-7-profiling.md` §6.1.
- **New:** `plan/reports/P7-T42.md`, `plan/reports/P7-batchK.md`.
- **Unchanged:** `src/bootstrap/registerUI.ts`, `zotero-plugin.config.ts`, every package file, every Fluent bundle,
  `.scaffold/test/profile/prefs.js` (no accessibility line was written); no PDF.
- **Card states:** every State unchanged. `P7-T41` and `P7-T42` stay `TODO`, each with a dated batch K note. No run
  failed, so no `DONE` card is affected.
- **Security:** no key was read or written; every command ran with `env -u OPENROUTER_API_KEY`, and only that name
  was read. No live network or model call. `NODE_TLS_REJECT_UNAUTHORIZED` was never set. No push, tag, trigger,
  publish or upload, and no commit. No label, theme or Korean text written; the owner's email appears nowhere new.

## Appendix: progress log

*Notes written as the batch goes, kept as written.*

- 15:50 Start (restart: the first session of batch K ended before any file changed). Tree clean at 7f1a6df, no `k-`
  file in the scratchpad.
- 15:57 Step 1 done (documents). `P7-T42` carded in `plan/10` from batch J's §9.3 draft (`k-plan10.mjs`): State
  `TODO`, Depends on `P7-T15`, Blocks `P7-T24` (reverse edges added on both), 1.0 d, callers and the constructing
  function named in Files and Notes (rule 10). `P7-T41`'s first `Done when` line carries the dated item 413(b) note.
  Estimates re-derived by script from the card bodies (`k-sums.mjs`, which reproduced every published figure before
  the change): Phase 7 42 cards, 36.75–51 d (was 41, 35.75–50); project 280 cards, 233.00–326 d (was 279,
  232.00–325); critical path P0 → P1 → P2 → P4 → P6 → P7 164.75–230 (was 163.75–229), Phase 3 route 161.75–226,
  Phase 5 route 155.00–217, so the margins are unchanged. Inside Phase 7 the longest path stays 16.50 d: `P7-T42`
  ends at 13.25 d, tied with `P7-T39`–`P7-T41` (the script names `P7-T39`). Propagated to the five sites
  (`k-propagate.mjs`). `npm run index:derive`: 280 tasks, 235 `DONE`, 45 `TODO`.
- 16:05 Step 2 built. `summarizeDialog.ts`: each row line carries its item's key (`SummarizeWindowRow`, built by
  `buildSummarizeWindowModel`). `summarize.js` `renderRows`: one `<p>` per row key, kept between updates; a row is
  set again only when its Fluent id or arguments change; created, removed or moved only when the set or order
  changes. No Fluent id, text, accessible name or key binding changed. Unit tests: 11 new in `summarizeDialog.test.ts`
  (a fake document running the shipped script); against the code before the change (K0), 9 of them fail. Unit
  mutants K1 (rebuild all rows), K2 (missed text update), K3 (missed removal), K4 (wrong order): all four killed
  (`k-mut.mjs`, logs `k-mut-K*.log`); `summarize.js` restored by sha256 (64b13af2…99cf) after each, and the
  `/* MUTANT` grep is empty. Integration: `workloadMemory.spec.ts` counts the row elements each summarize job adds
  and removes (`watchRows`, a `MutationObserver` of the window's own) and asserts one added per paper and none
  removed (`assertRowsKept`), in the reference workload and the 500-item job.
- 16:15 Development run 1 (`k-dev1-fix-off.log`, no debugger, `.only` on the reference workload and the 500-item
  test, behind the gate): 2 passed. **The accessibility service was on**, and the 500-item job took 16.5 s with a
  longest sampler gap of 205 ms (no gap of 1 s or more; batch J's recorded runs with the service on: 211–360 s,
  3,030–4,344 ms). Every summarize job added each row element once and removed none (reference jobs 100/0, the
  500-item job 500/0). Peak over idle 169.2 MiB (177.4 MB); the job's closed window freed; 0 of 20 closed windows
  alive; plugin share +0.1 MiB. Guard hosts: `localhost:54702` only.
- 16:25 Integration mutant K1 (`k-mut-K1-off.log`; every kept row dropped on each update, the old behaviour; no
  debugger, `.only` as in run 1): **killed**, 0 passed, 2 failed, each on the new assertion ("each row element is
  added once": reference job 1 added 20,700 and removed 20,600; the 500-item job added 503,500 and removed 503,000,
  about 1,007 updates). With the service on, that job took 50.5 s and its longest gap was 1,012 ms (one gap of 1 s or
  more), against 16.5 s and 205 ms with the fix 10 minutes earlier: the rebuild's cost under the service was lower
  today than in batch J (211–360 s), so the service's cost varies with what else runs, as batch J noted. Restored by
  sha256 (`summarize.js` 64b13af2…99cf; `.only` removed, spec 8a06e6df…33ac); the `/* MUTANT` and `.only(` greps are
  empty.
- 16:28 Checks before the recorded runs, all with `env -u OPENROUTER_API_KEY`, each exit 0: `npm run typecheck`,
  `npm run lint:check`, `npx eslint .`, `npm run l10n:check` (CI's call, no extra arguments: "3 file(s), 569
  message(s), 0 allowed hole(s)"), `npm run test` (unit 165 files, 8,529 passed, 105 skipped; contract 7 files, 93
  passed, 28 skipped). Manifest `k-tree.sha`: 1,234 files under `src`, `test`, `scripts`, `addon`. Recorded runs
  launched (`k-record.sh`, logs `k-rec{1,2,3}-{on,off}.log`); each run script writes the scaffold's npm check cache
  with the current time and passes the gate first.
- 17:26 Recorded runs 1–3 (with the debugger) done: each 388 passed, 0 failed; the gate passed at the first try before
  each. The accessibility service was on in all three, and the 500-item job's longest gap was under 1 s in each
  (figures in §4–§6).
- 18:08 Recorded runs 4–6 (without the debugger) done: each 388 passed, 0 failed, gate passed at the first try. **The
  accessibility service was on in all six recorded runs**, and the 500-item job's longest gap was 551–638 ms with the
  debugger and 188–193 ms without; no gap of 1 s or more in any. Each summarize job in every run added its rows once
  and removed none. 500-item peak without the debugger 110.9, 112.2, 118.3 MB over idle. The tree matched `k-tree.sha`
  after the runs; the `/* MUTANT` and `.only(` greps are empty.
- 18:09 The scaffold's npm check cache written at 18:08:45; `npm run build` exit 0 at 18:08:57; `research-helper.xpi`
  735,222 bytes; `typings/` unchanged by the build and equal to batch J's. The tree still matched the manifest.
- 18:13 Records written: `plan/reports/P7-T42.md`; batch K sections in `P7-T41.md` and `P7-T15.md`; dated State
  notes for `P7-T41` and `P7-T42` in `plan/10`; `plan/00` §6 items 414 and 415; `docs/13` §8.8, the checklist rows
  (`NFR-3`, `NFR-7`, 8.8.1, 8.8.2) and `docs/spikes/phase-7-profiling.md` §6.1. `npm run index:derive` (280 tasks,
  235 `DONE`, 45 `TODO`), then `npm run lint:check` exit 0. The tree under `src`, `test`, `scripts` and `addon` still
  matched `k-tree.sha`, with empty `/* MUTANT` and `.only(` greps.

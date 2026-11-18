# Phase 7 batch G: Part 0 (item 403's answers), `P7-T39`, `P7-T40`, `P7-T15`'s profile, `P7-T38`

**Date:** 2026-11-18 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-18 (batch G) · **Commit base:** a52225b, uncommitted. The coordinator commits.

## 1. Summary

- **Done:**
  - all five answers to item 403 are recorded;
  - `P7-T39` and `P7-T40` are built and carded;
  - `P7-T15`'s Gecko profile is recorded, with its cause;
  - `preferences.spec.ts`'s sweep is changed as item 403(c) says;
  - `P7-T38`'s acceptance is recorded;
  - the estimate is carried to the five sites;
  - every static check and the unit tests pass.
- **Not done: the three recorded integration runs, the integration mutants, and `P7-T40`'s breakdown probe.**
  - Partway through the batch, Zotero's own update check, run from the test profile, staged Zotero 10.0.8. Since
    then, every other test launch has started `updater.exe`, which asks for elevation and fails, and Zotero does not
    start.
  - Four such `updater.exe` processes from this batch's launches are still waiting.
  - The agent asked to stop them and was **not permitted**.
  - This needs the owner (item 405(d), §8).
- **Memory, test profile, one development run without the debugger, after the fixes:**
  - full-text job peak over idle **175.5 MB**;
  - reference jobs 54.3–75.3 MB;
  - growth after five jobs +8.2 MiB, with 0 of 20 closed plugin windows alive.
- **These are not recorded-run figures.**

## 2. Part 0: the owner's answers to item 403

Each is recorded as "DECIDED 2026-11-18 (owner, plan/00 §6 item 403(x))", in `plan/00` §6 item 403 and on the cards.

| Item | Answer | What was done |
|---|---|---|
| 403(a) | "둘 다 고침" | Carded as `P7-T39` (1.0 d). Built (§5.1). |
| 403(b) | "먼저 원인 기록" | Profile recorded, and the cause written into `P7-T15.md` and item 403(b). Nothing was fixed. `P7-T15` 2.0 → 2.25 d. The fix is owner question 405(a). |
| 403(c) | "기본값 설정은 건너뜀" | `allPrefsContaining` skips preferences with no user value. The tail needle is now 16 characters (`keyTail`), and a planted control preference proves the sweep still reads user values. The false-match run was batch F's run 1 (11:46:46–12:04:30). |
| 403(d) | "1.0에서는 허용" | Recorded in `P7-T38` (card and report), `docs/09` §7, `docs/13` §6 and a checklist §3 row. The gate stays `npm audit --omit=dev` = 0. No package file changed. |
| 403(e) | "둘 다 고침" | Carded as `P7-T40` (1.0 d). Built (§5.2). The spec's budgets are in MB. The workload was not lowered. |

## 3. Memory figures, before and after (test profile only)

| | Batch F: seven recorded runs, with `--jsdebugger`, before the fixes | Batch G: one development run of `workloadMemory.spec.ts` alone, without `--jsdebugger`, after the fixes |
|---|---|---|
| 500-item full-text job, peak over idle | 335.5–394.7 MiB (351.8–413.9 MB) | 167.4 MiB (**175.5 MB**) |
| Reference jobs 1–5, peak over idle | 59.1–87.6 MiB | 51.8–71.8 MiB (54.3–75.3 MB) |
| Growth after five jobs | +21.3 to +26.0 MiB | **+8.2 MiB** (note editor +4.2, SQLite +1.0, strings +1.0) |
| Closed plugin windows alive | the three windows' groups, 18.6 MiB | 0 of 20 |
| Making 500 items, idle heap increase | about 860 MiB | 37.5 MiB |

- **The columns differ in two ways at once**: the fixes, and the debugger. Neither effect is measured on its own.
- **Measured separately:**
  - with `--jsdebugger`, **every** closed chrome window stays alive, a bare `about:blank` included;
  - per paper, the strings fell from two 131,096-byte copies to 66,042 bytes.
- The development run's log is `g-dev1-nodebugger.log` in the session scratchpad.

## 4. The main-thread cause (item 403(b))

- **The task.** The 10.5–10.7 s gap is one synchronous task in summarize `prepare`: `screenItems` →
  `findCollectionDuplicates` → `sameWork` → `compareCandidates` → `levSim` → `levenshtein`.
- **Its share.** That chain holds 91.6 % of the gap's 5589 main-thread samples, 88.8 % of them inside `levenshtein`.
  `detectLanguage` holds 8.1 %.
- **Why.** At 500 items the screen compares 124,750 pairs with no yield.
- **The profile.** It was taken with Zotero's own profiler in the test profile, and written to a 195 MB local file
  in the scratchpad. Nothing was uploaded.
- Details: `plan/reports/P7-T15.md`, the batch G section.

## 5. Part 1: what was built

### 5.1 `P7-T39` (`plan/reports/P7-T39.md`)

- **The holders.** Without the debugger, `summarizeState.windows` and `reportWindowState.windows` held the last
  closed summarize and report windows until the next open.
- **The fix.** Each session's `closed()` now calls an `onClosed` callback, which drops the plugin's hold while that
  session is still the one held.
  - A closed report session waits in `closedSessions` until the next open or teardown.
  - `heldCount()` is new on both window commands.
- **New spec checks.** The hold is released on close, and a window opened again stays held. Closed windows are
  tracked by weak references, and asserted freed wherever any window can be freed.

### 5.2 `P7-T40` (`plan/reports/P7-T40.md`)

- **The finding.** At the cost dialog, each paper held two two-byte strings of 131,096 bytes: `source.text`, and
  the body that its sections were sliced from.
- **The fix.** `compactText` (a JSON round trip) and `rebaseSections`, called by `acquireSource`.
- **New tests:**
  - five unit tests;
  - one integration test of the strings per paper. Its first bound, 1.5 bytes a character, failed at 66,042 bytes
    for 40,928 characters. It is now 2 bytes (item 404(k)). The other ~25 KB a paper is **not explained**.

### 5.3 Mutation testing

| Code | Level | Result |
|---|---|---|
| `acquire.ts` (`compactText`, `rebaseSections`, their calls) | unit | **3 of 9 killed.** The survivors are memory-only or value-equivalent (`P7-T40.md`). |
| `acquire.ts` memory-only mutants | integration | **not run** (§8) |
| `registerUI.ts` (8 planned mutants) | integration | **not run** (§8); no unit test reaches it |

## 6. Coordinator decisions and owner questions

- **Coordinator decisions:** `plan/00` §6 item 404(a)–(k). Each is "DECIDED 2026-11-18 (coordinator, under item
  313)".
- **Owner questions, each with a draft and none adopted:** `plan/00` §6 item 405.
  - **(a) Scope (`NFR-3`):** the duplicate screen's fix, with a draft card of about 1.0 d.
  - **(b) Test design:** run the memory runs without `--jsdebugger` (draft: an environment switch), or keep
    recording them with it.
  - **(c) Scope:** read §8.8's line as "no plugin window or plugin realm grows".
  - **(d) Security and network:** the staged Zotero 10.0.8 update, the waiting `updater.exe` processes, and turning
    off application update in the test profile (§8).

**Korean:** no new Korean string in this batch. So there is no `plan/reports/ko-review-p7g-draft.md`, and no
`--allow` was added.

## 7. Estimate

`P7-T39` +1.0 d, `P7-T40` +1.0 d and `P7-T15` +0.25 d (item 404(a), (b)):

| Figure | Was | Now |
|---|---|---|
| Phase 7 | 38 cards, 32.50 d, band 32.50–46 | **40 cards, 34.75 d, band 34.75–49** (34.75 × 1.4 = 48.65 → 49) |
| Phase 7 against the scaled 21–29 d | +55 % | **+65 %**, and 20 % above the scaled top |
| Phase 7 against the old 10–14 d | +132 % | **+148 %** |
| Project | 228.75–321 d, 276 cards | **231.00–324 d**, 278 cards; still ≈ 11–15 months |
| Phases 4–7 | 114.75–161 d | **117.00–164 d** |
| Critical path (P0 → P1 → P2 → P4 → P6 → P7) | 160.50–225 d | **162.75–228 d** |
| Phase 3 route | 157.50–221 d | **159.75–224 d** (the 3 d / 4 d margin is unchanged) |
| Phase 5 route | 150.75–212 d | **153.00–215 d** (the 9.75–13 d float is unchanged) |
| Phase 7's internal path | 15.25 d | **16.50 d**, through `P7-T15` → `P7-T39` (or `P7-T40`); `P7-T24` ends at 14.25 d |

- **Checked by script** over the cards' edges (`g-critpath.mjs`, scratchpad).
- **Carried to the five sites:**
  - `plan/10`: the header, §0 Effort, the §1 table and notes, the critical-path text and §3;
  - `docs/11` §1: the table, the prose, the months and the chart;
  - `docs/11` §2;
  - `plan/00` §1;
  - `plan/05`.
- **Corrected on the way.** `docs/11` §1's Phases 4–7 subtotal row still read 114.25–160 from before item 402(a).
  §2's Phase 3 route sentence had not been carried for item 402(a). Both are noted where they were corrected.
- `npm run index:derive` ran after the last plan edit: 278 tasks, 112 `DONE`, 166 `TODO`.

## 8. Open findings and the blocker

- **The blocker (item 405(d)).**
  - **What happened.** During this batch's runs, Zotero's own update check, from the test profile, reached
    `www.zotero.org`. The suite's live-request guard listed the request. Zotero then staged 10.0.8 in
    `C:\ProgramData\Zotero\updates\A88A7A0EE6B236CF` (`active-update.xml`: "Install Pending"; the `update.mar` was
    114,595,465 bytes).
  - **The effect.** From then on, every other launch ran `updater.exe`, which tried to elevate, wrote "failed: 79",
    and left Zotero unstarted.
  - **What is waiting now.** Four `updater.exe` processes, PIDs 18788, 2024, 16780 and 19300, all with the test
    profile's arguments.
  - **What the agent tried.** It tried to stop the three older than ten minutes, and was **not permitted**, so it
    left them.
  - **What the owner needs to decide:**
    - cancel the staged update, or install it, which moves the test baseline from 10.0.3 to 10.0.8;
    - stop the waiting `updater.exe` processes, or allow the agent to;
    - whether the test profile should turn application update off.
  - Until then, integration runs cannot be relied on to start.
- **The configured runs keep every closed window** (item 405(b)). With `--jsdebugger`, recorded runs will show the
  windows retained whatever the plugin does.
- **About 25 KB a paper is unexplained** after `P7-T40`'s fix.
- **Item 403(b)'s gap is unchanged**: 11,193 ms in the development run. Its fix is item 405(a).
- **Not measured:** the fixes with the debugger, and either fix on its own.

## 9. Checks and integration runs

### 9.1 Checks

All run after the last source edit, with `env -u OPENROUTER_API_KEY`.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint:check` | pass, after `prettier --write` on `workloadMemory.spec.ts` and `acquire.test.ts` (formatting only) |
| `npx eslint .` | pass |
| `npm run l10n:check` (CI's arguments, no `--allow`) | pass |
| `npm run test` | pass: unit 164 files, 8503 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` | pass. The XPI is 733,771 bytes, under 3,145,728. The `typings/` hashes are unchanged by the build. |
| `/* MUTANT` grep over `src`, `test`, `scripts`, `addon` | empty |
| temporary `.only` | none |

### 9.2 Integration runs

**None recorded** (§8).

- **The development runs.**
  - One full run of `workloadMemory.spec.ts`, with `devtools` turned off temporarily (§3's figures), passed every
    test except P7-T40's first bound (§5.2).
  - Probes 1–7 were development runs; their logs are in the scratchpad.
  - Probe 8, the per-paper breakdown, hung behind the updater and was stopped.
- **Restored afterwards.** `zotero-plugin.config.ts` is back to as at a52225b, and the temporary probe spec and probe
  windows are out of the tree.

## 10. Final tree state

- **Base:** a52225b, uncommitted.
- **Modified:**
  - `docs/09-security-privacy-and-api-keys.md`
  - `docs/11-implementation-roadmap.md`
  - `docs/13-testing-build-and-release.md`
  - `docs/release/v1.0-checklist.md`
  - `docs/spikes/phase-7-profiling.md`
  - `plan/00-task-index.md`
  - `plan/05-phases-4-7-outline.md`
  - `plan/10-phase-7-release.md`
  - `plan/reports/P7-T15.md`
  - `plan/reports/P7-T38.md`
  - `src/bootstrap/registerUI.ts`
  - `src/pipeline/summarize/acquire.ts`
  - `test/integration/preferences.spec.ts`
  - `test/integration/workloadMemory.spec.ts`
  - `test/unit/pipeline/acquire.test.ts`
- **New:**
  - `plan/reports/P7-T39.md`
  - `plan/reports/P7-T40.md`
  - `plan/reports/P7-batchG.md`
- **Unchanged:** no package file, no `zotero-plugin.config.ts` change, no PDF.
- **Card states.** Every card stays `TODO`. `P7-T39` and `P7-T40` read "built, awaiting the owner's review", with a
  "not finished in the batch" note.
- **Security.** No key was read or written. No push, tag, upload or profiler upload was made. Zotero's update check
  was a network call made by Zotero itself during the test runs (§8).

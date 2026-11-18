# Phase 7 batch H: Part 0 (item 405's answers), `P7-T41`, the test profile's update preferences

**Date:** 2026-11-18 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-18 (batch H) · **Commit base:** 2ba93f1, uncommitted. The coordinator commits.

## 1. Summary

- **Done:**
  - all four answers to item 405 are recorded, in `plan/00` §6 item 405 and on the cards;
  - `P7-T41` is carded (1.0 d) and built. The duplicate screen compares only likely pairs and yields. A test proves
    that it finds the same pairs and groups as before on every fixture. 14 of 15 mutants are killed, and the 15th is
    equivalent;
  - the `RH_DEVTOOLS=off` switch (Zotero without the debugger) is built and documented;
  - `docs/13` §8.8's growth line is reworded, and the spec asserts the plugin's share;
  - the tested Zotero version reads 10.0.8 in every place the docs, plan and continuous-integration file state it;
  - the test profile turns Zotero's own update off, as far as a profile can, and two tests check this;
  - the estimate is carried to the five sites;
  - every static check, the unit tests and the build pass.
- **Not done: every integration run.** That means the three recorded runs, the memory figures, `P7-T41`'s gap
  measurement, the carried integration mutants and `P7-T40`'s breakdown probe.
  - **Why:** the launch gate never passed. At every check from 17:37 to 18:23 (when the batch was handed back, before the 2-hour window ended), the Zotero install read
    `Version=10.0.3`, and the staged 10.0.8 update was still pending (§8). The owner's install of 10.0.8 had not
    happened.
  - No `updater.exe` and no test-profile `zotero.exe` ran at any check. Zotero was not launched.
- **One owner question:** item 407(a). A profile cannot switch Zotero's update check off entirely.

## 2. Part 0: the owner's answers to item 405

Each is recorded as "DECIDED 2026-11-18 (owner, plan/00 §6 item 405(x))", in `plan/00` §6 item 405 and on the cards
(`P7-T15`, `P7-T39`, `P7-T40`, `P7-T41`).

| Item | Answer | What was done |
|---|---|---|
| 405(a) | "고침, 약 1일" | Carded as `P7-T41` (1.0 d, before `P7-T25`) and built (§3). |
| 405(b) | "디버거 없이 기록" | `zotero-plugin.config.ts`: `RH_DEVTOOLS=off` sets `server.devtools` false; the default stays on. The profile preference `researchHelper.test.devtools` tells the specs which run they are in. Documented in `docs/13` §2.3, where the integration command is described, and in the §1.4 sample and the launch-flags table. |
| 405(c) | "플러그인 몫만 봄" | `docs/13` §8.8 reads "No plugin window or plugin realm grows across 5 consecutive jobs", with the whole-process growth beside it and a dated note. In a run without the debugger, `workloadMemory.spec.ts` asserts that no plugin window or zone group grew more than 1 MiB. |
| 405(d) | "10.0.8로 직접 설치" | See the list below. |

What was done for 405(d):

- **The baseline is 10.0.8**, each with a dated note, in:
  - `README.md`;
  - `README.ko.md` (the number only, with a provenance comment);
  - `docs/release/announcement-v1.0.md`;
  - `docs/release/v1.0-checklist.md` (rows NFR-17 and 8.9.2);
  - `docs/13` §2.3;
  - `.github/workflows/ci.yml`'s `ZOTERO_VERSION`.
- **Unchanged:** dated "measured on 10.0.3" lines, which are history.
- **The test profile's update preferences** (`NO_APP_UPDATE_PREFS`, §4).
- **The checks:** a unit test of the configuration, and a spec that reads the running profile.

## 3. What was built: `P7-T41` (`plan/reports/P7-T41.md`)

- **`screen.ts`.** `candidatePairsOf` puts items into groups by cheap keys. Two items are compared only if they
  share one of these:
  - an identifier;
  - the bioRxiv accession;
  - the normalized title;
  - a fuzzy-title key ("preprint or not" plus the title's numbers), within the year window and a length bound.

  `duplicateScreen` joins items into groups with union-find over those pairs. `findCollectionDuplicatesAsync` and
  `screenItemsAsync` yield every 250 comparisons, and check the token after each yield. `screenItems` keeps its
  signature.
- **`summarizePipeline.ts`.** `prepare` awaits `screenItemsAsync`. Its language loop yields every 25 items
  (item 406(b)).
- **`workloadMemory.spec.ts`** logs the 500-item job's longest sampler gap against the 1 s line (logged, not
  asserted; item 406(f)).

**Measured in Node (2026-11-18):**

| Collection | All pairs | Pairs compared, new screen | Result | Time, new screen | Old screen |
|---|---|---|---|---|---|
| Dedup corpus, 286 items | 40,755 | **469** | the same 101 groups dropped | 22.9 ms | |
| The spec's 500 titles | 124,750 | **0** | none | 2.3 ms | 1,542 ms in Node; 10.5–10.7 s in Zotero with the debugger (batch G) |

**Tests.** `screen.test.ts` gained 12 tests, and no existing test changed. They cover:

- the old and new pair sets, compared on the whole corpus, each fixture, each of the 552 pairs, 30 seeded
  collections and the file's own fixtures;
- comparison counts;
- the yield;
- cancel;
- that the asynchronous and synchronous screens give the same result.

**Mutation sweep (`screen.ts`, 15 mutants):**

- **14 killed and 1 equivalent.** The equivalent one is `continue` in place of `break` at the year window's end:
  the group is sorted by year, so it compares the same pairs.
- Four mutants survived the first sweep and were killed by tests added for them: no accession group, a key without
  "preprint or not", a length bound of 0.99, and items with no year in a fuzzy group.
- After every mutant, the file was restored with its sha256 checked. The `/* MUTANT` grep is empty.

## 4. The test profile's update preferences (item 405(d))

**What happened in batch G.** Zotero's own update check ran from the test profile and staged 10.0.8.

**Read from Zotero 10.0.3's `omni.ja` on 2026-11-18** (Gecko 140: `UpdateService`, `UpdateTimerManager`,
`BrowserGlue`):

- **The daily check** is `UpdateTimerManager`'s `background-update-timer`. It is due when the stored last time
  (`app.update.lastUpdateTime.background-update-timer`, in seconds) plus the interval has passed. The test profile
  never kept that time, so the check was due soon after every start.
- **A second check at start-up** for an old build (`_checkForOldBuildUpdates`) is under
  `app.update.checkInstallTime`, which Zotero ships as true.
- **`app.update.enabled`**, which the scaffold sets, is read by none of `UpdateService`, `UpdateServiceStub`,
  `UpdateUtils` or `AppUpdater`.
- **`app.update.auto`** is a profile preference in Zotero's build. It stops the automatic download, not the check.

**The preferences now written into the test profile** (`zotero-plugin.config.ts`, `NO_APP_UPDATE_PREFS`; the
scaffold writes `test.prefs` last, so they win):

- `app.update.auto`, `app.update.checkInstallTime` and `app.update.staging.enabled` false;
- `app.update.enabled` false (kept);
- `app.update.lastUpdateTime.background-update-timer` set to the run's start, so the daily check is not due during
  a run.

**Checked:**

- `test/unit/integration/testProfilePrefs.test.ts` checks the configuration, and the switch's values;
- `test/integration/testProfile.spec.ts` checks each preference in the running profile, has user values, and logs
  Zotero's version and the debugger state. **That spec has not run yet** (§8).

**What a profile cannot do.** Only an enterprise policy in the install folder switches the check off entirely.
Owner question: item 407(a).

## 5. Memory figures

**None this batch.** No integration run started (§8).

| | With the debugger | Without the debugger (`RH_DEVTOOLS=off`) |
|---|---|---|
| Batch H runs | none | none |
| The last figures on record | batch F, seven recorded runs, before the fixes (`plan/reports/P7-batchG.md` §3) | batch G, one development run, not a recorded run: 175.5 MB full-text peak over idle, +8.2 MiB growth after five jobs |

## 6. Coordinator decisions and owner questions

- **Coordinator decisions:** `plan/00` §6 item 406(a)–(k), each "DECIDED 2026-11-18 (coordinator, under item 313)".
  - (a) the card's edges and estimate;
  - (b) the caller's language yield;
  - (c) the trend report's synchronous screen, recorded, not carded;
  - (d) the keys;
  - (e) the yield step;
  - (f) the gap logged, not asserted;
  - (g) the spelling `RH_DEVTOOLS=off`;
  - (h) the plugin's share, with a 1 MiB tolerance;
  - (i) the update preferences;
  - (j) the continuous-integration pin follows the baseline;
  - (k) the run names its Zotero version.
- **Owner question, with a draft not adopted:** `plan/00` §6 item 407.
  - **(a) Security and network:** a profile cannot switch Zotero's update check off entirely. *Draft:* keep the
    preferences, and read each recorded run's host list for an update host. The alternative is an enterprise policy
    added by hand.

**Korean:** no new user-visible string, so no `ko-review-p7h-draft.md` and no `--allow`. `README.ko.md` changed only
its version number, with a provenance comment.

## 7. Estimate

`P7-T41` +1.0 d (item 406(a)):

| Figure | Was | Now |
|---|---|---|
| Phase 7 | 40 cards, 34.75 d, band 34.75–49 | **41 cards, 35.75 d, band 35.75–50** (35.75 × 1.4 = 50.05 → 50) |
| Phase 7 against the scaled 21–29 d | +65 %, 20 % above the top | **+70 %**, 23 % above the scaled top |
| Phase 7 against the old 10–14 d | +148 % | **+155 %** |
| Project | 231.00–324 d, 278 cards | **232.00–325 d**, 279 cards; still ≈ 11–15 months |
| Phases 4–7 | 117.00–164 d | **118.00–165 d** |
| Critical path (P0 → P1 → P2 → P4 → P6 → P7) | 162.75–228 d | **163.75–229 d** |
| Phase 3 route | 159.75–224 d | **160.75–225 d** (the 3 d / 4 d margin is unchanged) |
| Phase 5 route | 153.00–215 d | **154.00–216 d** (the 9.75–13 d float is unchanged) |
| Phase 7's internal path | 16.50 d | **16.50 d**, unchanged; `P7-T41` ends at 13.25 d, like `P7-T39` |

- **Checked by script** over the cards' edges (`critpath.mjs`, scratchpad): 41 cards, sum 35.75, edges consistent.
- **Carried to the five sites:**
  - `plan/10`: the header, §0 Effort, the §1 table and note, the critical-path text and §3;
  - `docs/11` §1: the table, the prose, the months and the chart;
  - `docs/11` §2: the critical path, the Phase 3 route and the Phase 5 float;
  - `plan/00` §1;
  - `plan/05`.
- `npm run index:derive` ran after the last plan edit: 279 tasks, 112 `DONE`, 167 `TODO`.

## 8. The blocker: the launch gate

The brief's gate, checked by a monitor script (`h-gate.sh`, scratchpad) every 10 minutes from 17:37 to 18:23:

| Check | Result at every check |
|---|---|
| The version file (`C:\Program Files\Zotero\app\application.ini`) reads `Version=10.0.8` | **failed**: `Version=10.0.3` |
| `C:\ProgramData\Zotero\updates\` holds no staged update with "pending" status | **failed**: `A88A7A0EE6B236CF\active-update.xml`, Zotero 10.0.8, still pending |
| No `updater.exe` and no test-profile `zotero.exe` running | passed: none |

- **Nothing was launched.** `updater.exe` was not run, stopped or touched. Nothing under `C:\ProgramData` or
  `C:\Program Files` was changed.
- **What unblocks it:** the owner's install of Zotero 10.0.8 (item 405(d)). After that, the next batch can run the
  work that waits:
  - `testProfile.spec.ts`;
  - the three recorded runs, with the memory runs under `RH_DEVTOOLS=off`;
  - `P7-T41`'s gap;
  - the integration mutants;
  - the breakdown probe.

**The work that waits on it:**

- the three recorded runs (`P7-T39`, `P7-T40`, `P7-T41`, `P7-T15`);
- the memory figures with and without the debugger;
- `P7-T41`'s 500-item gap, the first Done-when line;
- `registerUI.ts`'s eight planned integration mutants (`plan/reports/P7-T39.md`);
- `acquire.ts`'s three memory-only integration mutants (`plan/reports/P7-T40.md`);
- `P7-T40`'s per-paper breakdown probe;
- the live-request guard's host list, which would show whether a run reaches an update host.

## 9. Checks and integration runs

### 9.1 Checks

All run after the last source edit, with `env -u OPENROUTER_API_KEY`.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint:check` | pass |
| `npx eslint .` | pass |
| `npm run l10n:check` (CI's arguments: none, no `--allow`) | pass |
| `npm run test` | pass: unit 165 files, 8518 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` | pass. The XPI is 734,561 bytes, under 3,145,728. The `typings/` hashes are unchanged by the build, and equal to batch G's. |
| `/* MUTANT` grep over `src`, `test`, `scripts`, `addon` | empty |
| temporary `.only` | none |

`typings/` sha256 after the build:

- `global.d.ts` 020956c7…1060
- `i10n.d.ts` cd93b62a…196b
- `prefs.d.ts` 47439ca8…cc3f
- `prompts.d.ts` 4480d796…760c
- `zotero-augment.d.ts` cf994969…62d5

### 9.2 Integration runs

**None** (§8).

## 10. Final tree state

- **Base:** 2ba93f1, uncommitted.
- **Modified:**
  - `.github/workflows/ci.yml`
  - `README.md`
  - `README.ko.md`
  - `docs/11-implementation-roadmap.md`
  - `docs/13-testing-build-and-release.md`
  - `docs/release/announcement-v1.0.md`
  - `docs/release/v1.0-checklist.md`
  - `docs/spikes/phase-7-profiling.md`
  - `plan/00-task-index.md`
  - `plan/05-phases-4-7-outline.md`
  - `plan/10-phase-7-release.md`
  - `plan/reports/P7-T15.md`
  - `plan/reports/P7-T39.md`
  - `plan/reports/P7-T40.md`
  - `src/pipeline/summarize/screen.ts`
  - `src/pipeline/summarize/summarizePipeline.ts`
  - `test/integration/workloadMemory.spec.ts`
  - `test/unit/pipeline/screen.test.ts`
  - `zotero-plugin.config.ts`
- **New:**
  - `plan/reports/P7-T41.md`
  - `plan/reports/P7-batchH.md`
  - `test/integration/testProfile.spec.ts`
  - `test/unit/integration/testProfilePrefs.test.ts`
- **Unchanged:** no package file, no PDF.
- **Card states.** Every card stays `TODO`. `P7-T41` reads "built 2026-11-18 (batch H), awaiting the owner's
  review".
- **Security.** No key was read or written; every command ran with `env -u OPENROUTER_API_KEY`. No push, tag,
  workflow trigger, upload or network call was made by the agent. Zotero was not started.

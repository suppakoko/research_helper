# Phase 7 batch J: the index probe, the full-text window, and the recorded runs

**Date:** 2026-11-24 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-24 (batch J) · **Commit base:** 661a96b, uncommitted. The coordinator commits.

Logs and scripts named here are in the session scratchpad
(`C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad`),
outside the repository. Batch J's own files there start with `j-`.

## 1. Summary

- **Six recorded runs, all on one tree, every one 388 passed and 0 failed**: three in the default configuration (with
  the debugger) and three with `RH_DEVTOOLS=off`. `test/integration/testProfile.spec.ts` passed in each, and each
  named Zotero 10.0.8 (build 20261106171835). No run failed, so no run needed repeating, and no `DONE` card is
  affected.
- **Item 411(a): the index hypothesis is not confirmed** (§2). In three development runs without the debugger,
  Zotero's own full-text index work ran for 3 to 6 ms during 500-item jobs whose gaps came to 302 to 335 s, and none of
  it fell in a gap. So no hold on index work was built.
- **The cause of the pauses is measured instead** (§2.2–§2.4). A local Gecko profile of 60 s of the summarize phase
  put 96.2 % of the main thread in Gecko's accessibility notification controller, passing about 750 show and hide
  events a refresh to Windows. The summarize window removes and recreates all 500 of its rows on every update
  (`renderRows` in `addon/content/summarize.js`). In one development run with Gecko's accessibility service turned
  off, the 500-item job took 9.5 s and its longest gap was 238 ms. A card is drafted for the owner (§9.3, item
  413(a)).
- **Item 411(c): the holder of the 500-item job's closed summarize window was the spec itself** (§3), not the plugin
  and not Zotero. With the window opened, run and closed in a function of its own, it is freed. The spec now asserts
  that, where a closed window can be freed, and the window was **freed in all three recorded runs without the
  debugger**. Mutant MJ1 was killed. No source file changed.
- **Without the debugger** (the figures of record, item 405(b)):
  - reference jobs 1–5: 61.8–74.6 MiB (64.8–78.2 MB) peak over idle, within 150 MB;
  - the 500-item full-text job: 240.8–242.6 MiB (252.5–254.4 MB), within 400 MB by at least 145.6 MB;
  - growth after five jobs: the plugin's share is one group, +0.1 MiB, within the 1 MiB tolerance; the whole process
    grew 5.6–6.2 MiB (heap);
  - closed plugin windows alive: 0 of 20 in each run, and the 500-item job's window freed in each;
  - the idle heap after the 500-item job, over the idle before it: 5.2–5.5 MiB (batch I: 10.9–11.9 MiB).
- **`P7-T41`'s first `Done when` line is not met in any of the six runs** (§6). The longest gaps were 3,030 to
  4,344 ms. Gecko's accessibility service was on in all six (each log says so). The old gap in `prepare` (the
  duplicate screen `P7-T41` fixed) did not come back. Owner questions: items 413(a) and 413(b).
- **Network:** every run's live-request guard listed only loopback hosts, and no update host (§7).
- **The launch gate** passed before all 11 launches; it refused once, at 19:01, before any launch (§8). Zotero's own
  updater, an active update and a version other than 10.0.8 were never seen.
- **Item 411(b):** the scaffold's npm check cache was written with the current time before every Zotero launch and
  before the build (§8).
- **Build:** `research-helper.xpi` 734,561 bytes; `typings/` unchanged (§10).
- **Decisions:** `plan/00` §6 item 412 (a)–(f). **Owner questions:** item 413 (a)–(c), each with a draft not adopted.

## 2. Item 411(a): the index probe, and what the pauses are

### 2.1 The development runs

Every development run was without the debugger (`RH_DEVTOOLS=off`), with `.only` on the tests it needed, behind the
launch gate. None is a recorded run. Each 500-item job summarized 500 of 500, all from the attached text, 0 failed.

| Run (log) | What it added | Accessibility service | Job time | Gaps of 1 s or more | Longest gap | Index calls in the job | Gap time covered by an index call | The job's closed window |
|---|---|---|---|---|---|---|---|---|
| Probe 1 (`j-probe1-observe-off.log`) | timing wrappers on the index functions; heap probe | not logged (on, by probe 2's profile of the same set-up) | 361.6 s | 205, 334.6 s in all | 4,142 ms | 1 (`vacuumContentIndex`, 3 ms) | **0 ms** | alive |
| Probe 2 (`j-probe2-prof-off.log`) | probe 1, a local Gecko profile of 60 s, and two later heap checks | on (the profile) | 339.2 s | 191, 302.1 s | 4,338 ms | 5 ms in all | **0 ms** | alive, and after 60 s and 120 s more |
| Probe 3 (`j-probe3-a11yoff-off.log`) | probe 1 with `accessibility.force_disabled` 1 | **off** (`accessibilityEnabled` false) | **9.5 s** | **0** | **238 ms** | 0 | 0 ms | alive, and after 60 s and 120 s more |
| Probe 4 (`j-probe4-scope-off.log`) | probe 1 with the job's window in a function of its own (§3) | on (instantiator "UNKNOWN") | 372.9 s | 202, 332.3 s | 3,292 ms | 6 ms in all | **0 ms** | **freed**, and after 60 s and 120 s more |
| Mutant MJ1 (`j-mut-MJ1-off.log`) | the final spec, holding the job's window on its global (§3) | on | 420.5 s | not counted | 4,727 ms | not wrapped | not wrapped | alive: the new assertion failed (killed) |

The wrapped functions were `Zotero.FullText`'s `processAttachmentIndexQueue`, `processAttachmentExtractionQueue`,
`processNoteIndexQueue`, `optimizeContentIndex`, `vacuumContentIndex`, `processSyncedContent` and `indexItems`
(probe code `j-idx-start.ts.txt`, `j-idx-end.ts.txt`, planted by `j-probe.mjs`). Before each job all three of Zotero's
index queues were empty (making the 500 items took about 225 s, long enough for their attachments to be indexed).

**Reading: the index hypothesis is not confirmed.** In probes 1, 2 and 4, Zotero's index work took 3 to 6 ms of
jobs whose gaps came to 302 to 335 s, and none of it fell in a gap. Under item 411(a)'s "not confirmed" branch, no
hold on index work was built, a profile was recorded (§2.2), and a card is drafted for the owner (§9.3).

### 2.2 The Gecko profile of the summarize phase (probe 2)

Recorded with `Services.profiler` from +30 s into the job for 60 s, main thread, 1 ms sampling, written to
`j-profile-summarize.json` (28.5 MB) in the scratchpad only, never uploaded. Read by batch G's `g-prof.mjs` into
`j-prof-analysis.txt`.

- **30,972 samples; 96.2 % inside `RefreshDriver tick` → `NotificationController::WillRefresh`**, Gecko's
  accessibility notification controller, which passes the accessibility events a refresh made to the operating
  system.
- **95.2 % of all samples have their leaf in `win32u.dll`, called from `user32.dll`**: a Windows system call. The
  exact function is not symbolicated (the profile has no symbols for system libraries).
- **Markers in the 60 s:**
  - 85 long tasks of `NotificationController::WillRefresh`, 57.9 s in all, the longest 881 ms (about 0.7 s each);
  - 64,090 `a11y::PlatformShowHideEvent` (34.8 s), about 750 a refresh;
  - 97,132 `DocAccessible::ContentRemovedNode` and 42,545 `DocAccessible::ShutdownChildrenInSubtree`.
- **The plugin's own script is under 1 %:** `renderRows` 65 samples, `setL10n` 21, the reflow of `summarize.xhtml`
  79.

### 2.3 With the accessibility service off (probe 3)

With `accessibility.force_disabled` 1 in the test profile's preferences for that one run, the 500-item job took
9.5 s, its longest gap was 238 ms and no gap reached 1 s, so `P7-T41`'s line was met in that run. The peak over idle
was 212.5 MiB (222.9 MB). The change was planted as `/* MUTANT A11YOFF */` in `zotero-plugin.config.ts` by
`j-a11y.mjs`, and restored by sha256 (63c0d6f0…e3e3d). The scaffold had written the line into
`.scaffold/test/profile/prefs.js`, which keeps its lines between runs, so the line was removed from there too, with
the line endings kept; against a copy taken before probe 3, only the timestamps Zotero itself writes differ.

### 2.4 What the pauses are

**Measured:** the pauses are Gecko's accessibility work on the summarize window's rows. `renderRows` in
`addon/content/summarize.js` removes and recreates all 500 row elements on every update, and `execute` in
`src/pipeline/summarize/summarizePipeline.ts` calls `show()` several times a paper. With the accessibility service
on, every such update makes about a thousand accessibility show and hide events, and the next refresh passes them to
Windows on the main thread, at about 0.7 s a refresh. With the service off, the same job takes 9.5 s.

**Not measured, but consistent:** whether the service is on depends on what else runs on the machine. Gecko starts it
when an accessibility client (a screen reader, or other software that reads windows' contents) asks for it; the
instantiator read "UNKNOWN" here. That fits the slow shape coming and going between runs since 2026-11-21, and
batch F's 35.7–40.6 s jobs on Zotero 10.0.3. No claim is made about which program turned it on.

**The plugin's share:** the redraw is the plugin's (`renderRows`), so a user with a screen reader would meet the same
pauses with 500 items. This is owner question item 413(a), with a draft card (§9.3).

## 3. Item 411(c): what held the full-text job's closed summarize window

- **Heap snapshots** (`ChromeUtils.saveHeapSnapshot`, read back with the shortest retaining paths and the dominator
  tree; probe code `j-heap.ts.txt`), in probes 1, 2 and 3, all showed the same four kinds of path to the closed
  window's document:
  1. the document's own preserved wrapper (a C++ owner);
  2. the probe's own `WeakRef` on the stack (weak, not a holder);
  3. a C++ callback object whose callback global is a `Window`;
  4. a preserved `Sandbox` whose prototype has a `document` property. Read from Zotero 10.0.8's `omni.ja` (read only,
     copied to `j-omni`): `summarize.xhtml` includes `chrome://zotero/content/include.js`, which loads
     `resource://zotero/require.js`, which makes a per-window module-loader `Sandbox` whose prototype holds `window`
     and `document`.
- **No path named a plugin object**, and the plugin held no handle (`{"summarize":0,"report":0}`). The window stayed
  alive after 60 s and 120 s more (each after a minimize), and with the accessibility service off too, so the
  accessibility service is not what holds it.
- **The holder was the spec.** The 500-item test kept `win` (a `WindowProxy`) in its own async frame until the test
  ended. A closed window's proxy keeps its inner window and document alive through Gecko's C++ window objects, which a
  JS heap snapshot shows only as C++ roots. With the job's window opened, run and closed in a function of its own
  (`summarizeAndClose` in `workloadMemory.spec.ts`), probe 4 found it **freed** at the idle reading after the job, and
  still freed after 60 s and 120 s more, with the accessibility service on. The detached `summarize.xhtml` group
  (+3.2 MiB in every earlier run) was gone from the after-job growth.
- **So the plugin is not the holder, and no source change is made under `P7-T39`** (item 411(c)'s "Zotero" branch does
  not apply either: the holder was the test). The spec now **asserts** that the job's closed window is freed where a
  closed window can be freed (`windowsCanBeFreed`, as the reference workload's check does; with the debugger, Gecko
  keeps every closed chrome window, item 404(h)).
- **Mutant MJ1** (`j-mut.mjs`; the spec keeps a strong reference to the job's window on its global): **killed**. The
  new assertion failed ("the full-text job's closed summarize window is freed: expected false to equal true"); the
  reference workload passed in the same run (0 of 20 closed windows alive). The spec was restored by sha256
  (7d7e38f2…33ff).

### 3.1 The spec changes (test-only)

`test/integration/workloadMemory.spec.ts`, sha256 a7ceae65…e2b9 → 7d7e38f29883d0d34e3b15cd392b250e9e07669927084adc4f20dfbefc8b33ff:

- `summarizeAndClose` (new): opens the summarize window, runs it, closes it, and returns the outcome with a `WeakRef`
  to the closed document;
- `accessibilityState` (new): reads `Services.appinfo.accessibilityEnabled`, and the `P7-T41` log line now ends with
  "the accessibility service is on" or "off";
- the after-job line now reads "asserted where a closed window can be freed", and the assertion follows it;
- the header comment's item 3 names the 500-item job's window.

`test/integration/zotero/removeGeneratedNotes.spec.ts`: the comment's earlier range now reads 12.9 to 20.5 s (item
410(c)). sha256 de935d8e….

## 4. The recorded runs

**One tree.** Before each launch, the run script (`j-run.sh`, driven by `j-record.sh`) checked these and refused the
run if any failed:

- the launch gate (§8);
- no build running;
- every one of the 1,234 files under `src`, `test`, `scripts` and `addon` against one sha256 manifest
  (`j-tree.sha`), and the file count;
- an empty `/* MUTANT` grep;
- no `.only`.

`workloadMemory.spec.ts` was 7d7e38f2…33ff and `src/bootstrap/registerUI.ts` a2335c6b…8c3c in every recorded run
(each log's header).

**The command:** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`, with
`RH_DEVTOOLS=off` in front for the second three.

| Run | Debugger | Start | End | Result | `testProfile.spec.ts` | Accessibility service |
|---|---|---|---|---|---|---|
| `j-rec1-on.log` | on | 20:29:34 | 20:51:08 | 388 passed, 0 failed | passed; 10.0.8, debugger true | on |
| `j-rec2-on.log` | on | 20:51:13 | 21:13:11 | 388 passed, 0 failed | passed; 10.0.8, debugger true | on |
| `j-rec3-on.log` | on | 21:13:16 | 21:34:27 | 388 passed, 0 failed | passed; 10.0.8, debugger true | on |
| `j-rec1-off.log` | off | 21:34:33 | 21:53:53 | 388 passed, 0 failed | passed; 10.0.8, debugger false | on |
| `j-rec2-off.log` | off | 21:53:58 | 22:13:49 | 388 passed, 0 failed | passed; 10.0.8, debugger false | on |
| `j-rec3-off.log` | off | 22:13:55 | 22:33:00 | 388 passed, 0 failed | passed; 10.0.8, debugger false | on |

All on 2026-11-24. The six runs ran one after another, with no other launch between them.

## 5. Memory figures (`workloadMemory.spec.ts`, test profile, fake provider)

The spec logs MiB; MB (10⁶ bytes) is in brackets. Peaks are heap (`heapAllocated + JSMainRuntimeGCHeap`) over the
idle reading before the job.

### 5.1 Without the debugger (`RH_DEVTOOLS=off`): the figures of record (item 405(b))

| Run | Reference jobs 1–5, peak over idle | 500-item full-text job, peak over idle | Growth after five jobs: plugin's groups | Growth: whole process (heap; resident; `explicit/` sum) | Closed plugin windows alive | The 500-item job's closed window | Idle after that job over idle before it |
|---|---|---|---|---|---|---|---|
| 1 | 64.3, 63.7, 61.8, 61.9, 69.3 MiB | 240.8 MiB (**252.5 MB**) | 1 group, +0.1 MiB (the plugin's realm); 0 over 1 MiB | +5.6 MiB; −1.3 MiB; +5.8 MiB | 0 of 20 | **freed** (asserted) | +5.4 MiB |
| 2 | 65.1, 62.0, 62.8, 63.6, 74.6 MiB | 242.6 MiB (**254.4 MB**) | the same | +6.2 MiB; −0.0 MiB; +5.6 MiB | 0 of 20 | **freed** (asserted) | +5.5 MiB |
| 3 | 63.1, 61.8, 62.6, 63.8, 72.9 MiB | 241.3 MiB (**253.0 MB**) | the same | +5.7 MiB; −2.6 MiB; +5.7 MiB | 0 of 20 | **freed** (asserted) | +5.2 MiB |

- **Budgets:**
  - reference workload: every job ≤ 74.6 MiB (78.2 MB), within 150 MB;
  - 500-item full-text job: ≤ 254.4 MB, within 400 MB by at least 145.6 MB across the three runs.
- **What grew across five jobs** (each run): Zotero's note editor +3.1 MiB, SQLite +1.0 to +1.1, strings +0.9 MiB.
- **After the full-text job:** the detached `summarize.xhtml` group (+3.2 MiB in all six of batch I's runs) is gone, and
  the idle heap after the job is about half of batch I's (+5.2 to +5.5 MiB against +10.9 to +11.9 MiB).
- **Against batch I** (its recorded runs, at 880fd42; batch J changed only test files and records since): the full-text job's peak was 265.5 to
  282.2 MB there and 252.5 to 254.4 MB here; reference jobs 66.8–83.5 MB there and 64.8–78.2 MB here. Batch I did
  not log the accessibility service's state.

### 5.2 With the debugger (the default configuration), for comparison only

| Run | Reference jobs 1–5, peak over idle | 500-item full-text job, peak over idle | Growth after five jobs: plugin's groups | Growth: whole process (heap; resident; `explicit/` sum) | Closed plugin windows alive | The 500-item job's closed window |
|---|---|---|---|---|---|---|
| 1 | 60.6, 64.1, 63.7, 64.2, 79.1 MiB | 198.2 MiB (207.8 MB) | 6 groups, 3 over 1 MiB: `costConfirm.xhtml` +9.5, `summarize.xhtml` +3.9, `reportWindow.xhtml` +3.0 (detached windows); not asserted | +19.5 MiB; +1.9 MiB; +34.9 MiB | 20 of 20 | alive (not asserted) |
| 2 | 58.7, 66.1, 62.0, 66.2, 79.8 MiB | 190.4 MiB (199.6 MB) | the same | +21.5 MiB; −17.0 MiB; +34.9 MiB | 20 of 20 | alive (not asserted) |
| 3 | 61.2, 65.0, 64.9, 59.3, 80.7 MiB | 191.3 MiB (200.6 MB) | the same | +21.6 MiB; −17.0 MiB; +34.9 MiB | 20 of 20 | alive (not asserted) |

With `--jsdebugger`, Gecko keeps every closed chrome window (item 404(h)), so these runs show the closed windows as
retained, and the spec asserts on neither.

## 6. `P7-T41`: the 500-item job's longest sampler gap

Counts of gaps of 1 s or more are from the spec's own line, read by batch I's `i2-gaps.mjs`.

| Run | Debugger | Accessibility service | Job time | Longest gap | Gaps of 1 s or more | `P7-T41` line (no gap over 1 s) |
|---|---|---|---|---|---|---|
| rec1-on | on | on | 258.1 s | **4,344 ms** | 104, 181.9 s in all, from the 24th paper to the 499th | **not met** |
| rec2-on | on | on | 270.3 s | **3,496 ms** | 105, 178.4 s, from the 27th to the 500th | **not met** |
| rec3-on | on | on | 211.3 s | **4,244 ms** | 75, 125.0 s, from the 9th to the 480th | **not met** |
| rec1-off | off | on | 318.2 s | **4,329 ms** | 179, 285.0 s, from the 27th to the 498th | **not met** |
| rec2-off | off | on | 360.2 s | **3,848 ms** | 202, 321.0 s, from the 18th to the 499th | **not met** |
| rec3-off | off | on | 321.6 s | **3,030 ms** | 188, 275.6 s, from the 18th to the 498th | **not met** |

- **Every slow job still completed:** 500 of 500 summarized, 0 failed, all 500 from the attached text.
- **The duplicate screen `P7-T41` fixed did not come back:** each run's first long gap ends after 9 to 27 papers are
  done. The old 10.5–10.7 s gap sat in `prepare`, before any paper.
- **The accessibility service was on in all six runs**, so all six have the slow shape. With it off (probe 3, a
  development run, §2.3) the same job took 9.5 s with a longest gap of 238 ms.
- **Reading:** the line is not met with the accessibility service on, and the cause is the summarize window's redraw,
  which `P7-T41` did not touch. Owner questions: items 413(a) (the redraw) and 413(b) (how `P7-T41`'s line is read).
  `P7-T41` stays `TODO`.

## 7. Network: the live-request guard's host lists

| Run | Hosts let through | Away from loopback | Update host? |
|---|---|---|---|
| rec1-on | `127.0.0.1:59321`, `localhost:59259` | `[]` | none |
| rec2-on | `127.0.0.1:59321`, `localhost:52938` | `[]` | none |
| rec3-on | `127.0.0.1:59321`, `localhost:59701` | `[]` | none |
| rec1-off | `127.0.0.1:59321`, `localhost:53355` | `[]` | none |
| rec2-off | `127.0.0.1:59321`, `localhost:62050` | `[]` | none |
| rec3-off | `127.0.0.1:59321`, `localhost:52011` | `[]` | none |

- **No recorded run reached an update host.** Every host the guard let through was loopback. The five development
  runs' lists were loopback only too (one `localhost` port each).
- **The only `http(s)` host the recorded logs name** is the XUL namespace
  `http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul`, a string, not a request.
- `testProfile.spec.ts` read `app.update.lastUpdateTime.background-update-timer` as set 166 to 192 s before its own
  test in each run.
- No log, recorded or development, printed the scaffold's "Update:" line (item 411(b), §8).

## 8. The launch gate (item 411(d)) and the scaffold's npm check (item 411(b))

The gate (`j-gate.sh`) ran before every Zotero launch: 11 launches (four probes, one mutant run and six recorded runs), and the one attempt it refused at 19:01. Its checks:

1. `C:\Program Files\Zotero\app\application.ini` reads `Version=10.0.8` (the brief named
   `C:\Program Files\Zotero\application.ini`, which does not exist; batch I's gate read the same `app` file);
2. no `C:\ProgramData\Zotero\updates\*\active-update.xml`;
3. **by path (item 411(d)):** no running `C:\Program Files\Zotero\updater.exe`. Each `updater.exe`'s path is read with
   `QueryFullProcessImageName` under limited query rights (`j-procpath.ps1`), which can read a path
   `Win32_Process` cannot; any other `updater.exe` is logged with its path and parent. An `updater.exe` whose path
   cannot be read is looked at again every 5 s for 30 s, and then counted as Zotero's;
4. no test-profile `zotero.exe`, recognised by a command line naming `.scaffold`.

- **The gate refused once, at 19:01**, before probe 1: four `updater.exe` processes whose path the first version of
  check 3 (`Win32_Process` only) could not read. They were gone within two minutes. Nothing was done to them.
- **At 19:08:07 Google's per-user updater** (an hourly scheduled task, `GoogleUpdaterTaskUser…`, last run 18:08:08)
  started six `updater.exe` processes, each read by the new check as
  `C:\Users\<user>\AppData\Local\Google\GoogleUpdater\159.0.8140.0\updater.exe` (`j-updwatch.log`); they were gone by
  19:08:21. Batch I's 18:08 refusal was at that task's time, and the 19:01 processes were very likely Google's too
  (not proved: their paths were not read).
- **Before each of the six recorded runs, all four checks passed at the first try** (each log's header), and no
  other `updater.exe` was running. The run script (`j-record.sh`) would have waited out a refusal that was not
  Zotero's (every 30 s, up to 10 minutes) and stopped at once on Zotero's own updater, an active update or the
  version; neither happened. An `updater.exe` whose path stays unreadable for 30 s is counted as Zotero's by the gate,
  so no launch follows it; the run script would then have tried the gate again every 30 s rather than stopping.
- **Zotero's own updater, an active update, or a version other than 10.0.8 was never seen.** Nothing was done to any
  `updater.exe`, and nothing under `C:\Program Files` or `C:\ProgramData` was changed. `omni.ja` was only read (a copy
  in `j-omni`).
- **Item 411(b):** before every Zotero launch (each run script, `j-run.sh`) and before the build, the current time was
  written into `%LOCALAPPDATA%\tiny-update-notifier\Cache\zotero-plugin-scaffold`, so the scaffold's once-a-day npm
  registry check did not run. Every run log's first line records the value written. No log printed the scaffold's
  "Update:" line.
- No integration run ran during a build, and no build ran during an integration run (the run script refuses to start
  while a build runs).

## 9. Decisions, questions and the draft card

### 9.1 Coordinator decisions: `plan/00` §6 item 412, "DECIDED 2026-11-24 (coordinator, under item 313)"

- (a) the index hypothesis is not confirmed, so no hold is built; a local profile was recorded and a card drafted;
- (b) one diagnosis run with the accessibility service off (development run only; everything restored);
- (c) the `P7-T41` log line names the accessibility service's state (test-only);
- (d) item 411(c): the holder was the spec; the spec now asserts the job's window is freed (MJ1 killed); no source
  change under `P7-T39`;
- (e) the gate reads `updater.exe` paths with `QueryFullProcessImageName`, and the version file is the `app` one;
- (f) the profile stays in the scratchpad, outside the repository.

Why: none blocks a `Done when` line or a phase's finishing condition (rule 9), each follows item 411's decided
branches, and each is test-only or a record.

### 9.2 Owner questions: `plan/00` §6 item 413, every draft **not adopted**

- (a) **Scope (`NFR-3`, `NFR-13`):** the pauses are Gecko's accessibility work on the summarize window's rows. Draft:
  adopt the card below as `P7-T42`; the alternative is a known limit in the release notes.
- (b) **How `P7-T41`'s first `Done when` line is read.** Draft: read it on runs whose log says the accessibility
  service is off, and move "no gap over 1 s with the accessibility service on" to `P7-T42`. The alternative is to keep
  `P7-T41` `TODO` until `P7-T42` is built. Either way `P7-T41` stays `TODO` until the owner says.
- (c) **The test profile and the accessibility service.** Draft: keep the service as the machine has it, and record
  its state beside each run's gap. The alternative is `accessibility.force_disabled` 1 in the test profile.

No new or changed Korean text is needed by any change in this batch, or by the draft card (it changes no Fluent id or
text).

### 9.3 The draft card (not adopted; not in `plan/10`)

**`P7-T42` — The summarize window redraws only the rows that change** (draft)

| Field | Value |
|---|---|
| **ID** | `P7-T42` (the next free number in Phase 7; not yet in `plan/10`) |
| **State** | not a card yet: owner question `plan/00` §6 item 413(a) |
| **Depends on** | `P7-T15` |
| **Blocks** | `P7-T24` |
| **Retires** | none |
| **Implements** | `NFR-3` (no main-thread task over 100 ms) with the accessibility service on; `NFR-13` (the window is usable with a screen reader) |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** An update of the summarize window changes only the rows whose line changed, so that with Gecko's
accessibility service on, the 500-item job shows no sampler gap over 1 s.

**Read first.** `plan/reports/P7-batchJ.md` (the profile: 96 % of the main thread in
`NotificationController::WillRefresh`, 64,090 accessibility show and hide events in 60 s; with the service off, the
job took 9.5 s); `addon/content/summarize.js` (`render`, `renderRows`, `setL10n`); `src/ui/dialogs/summarizeDialog.ts`
(`buildSummarizeWindowModel`, the `rows` it builds); `src/pipeline/summarize/summarizePipeline.ts` (`execute` and its
`show` calls).

**Files.**
- modify `addon/content/summarize.js` (`renderRows`: one element per row, kept between updates; only a row whose
  Fluent id or arguments changed is touched)
- modify `src/ui/dialogs/summarizeDialog.ts` (only if a row line needs a stable key, such as its item key)
- modify `test/unit/ui/summarizeDialog.test.ts` (the model's rows and their keys)
- modify `test/integration/workloadMemory.spec.ts` (the gap, logged with the accessibility service's state, as now)

**Do.**
1. Keep the row elements between updates, keyed, and change a row only when its line changed; add and remove only the
   rows that appear or go.
2. Check in a unit or integration test that an update that changes one row touches one element.
3. Run the 500-item job with the accessibility service on and record the longest gap; mutation-test the change.

**Do NOT.**
- Do **not** turn the accessibility service off in the test profile to pass: users with a screen reader run with it on.
- Do **not** change the rows' Fluent ids or their text.

**Done when.**
- [ ] In a recorded run with the accessibility service on, `workloadMemory.spec.ts`'s 500-item job shows no sampler gap
  over 1 s.
- [ ] The summarize window's tests (`accessibility.spec.ts`, `offline.spec.ts`, `redactionAudit.spec.ts`) pass
  unchanged.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && \
  NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish
```

## 10. Checks after the last source edit

The last edit under `src`, `test`, `scripts` or `addon` was at 20:27:40 (the spec restored by sha256 after mutant
MJ1). The checks ran at 20:27:56–20:29:11, all with `env -u OPENROUTER_API_KEY`. No file under those folders changed
after them: the six recorded runs and the build all match the same manifest (`j-tree.sha`, 1,234 files).

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's arguments: none) | exit 0; "ko-KR matches en-US: 3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | exit 0; unit 165 files, 8,518 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` (22:33:47, after the six runs) | exit 0; `research-helper.xpi` 734,561 bytes, under 3,145,728 |

`typings/` sha256 after the build, unchanged by it and equal to batch I's:

- `global.d.ts` 020956c7…1060
- `i10n.d.ts` cd93b62a…196b
- `prefs.d.ts` 47439ca8…cc3f
- `prompts.d.ts` 4480d796…760c
- `zotero-augment.d.ts` cf994969…62d5

No build ran during an integration run. The scaffold's npm check cache was written at 22:33:37, before the build.

After the record edits (plan, reports and docs only), `npm run index:derive` ran (279 tasks, 235 `DONE`, 44 `TODO`,
unchanged), `npm run lint:check` passed again, and the tree under `src`, `test`, `scripts` and `addon` still matched
the manifest, with an empty `/* MUTANT` grep and no `.only`.

## 11. The final tree

- **Base:** 661a96b, uncommitted.
- **Modified (test-only):**
  - `test/integration/workloadMemory.spec.ts` (`summarizeAndClose`, `accessibilityState`, the full-text window's
    assertion; item 412(c), (d))
  - `test/integration/zotero/removeGeneratedNotes.spec.ts` (the comment's range, item 410(c))
- **Modified (records):**
  - `plan/00-task-index.md` (items 412, 413; `npm run index:derive`)
  - `plan/10-phase-7-release.md` (State notes of `P7-T39` and `P7-T41`)
  - `plan/reports/P7-T39.md`, `P7-T41.md`, `P7-T15.md` (batch J sections)
  - `docs/13-testing-build-and-release.md` §8.8
  - `docs/release/v1.0-checklist.md` (rows `NFR-3`, `NFR-7`, 8.8.1, 8.8.2)
  - `docs/spikes/phase-7-profiling.md` §6.1
- **New:** `plan/reports/P7-batchJ.md`.
- **Unchanged:**
  - every file under `src` and `addon`, and `zotero-plugin.config.ts` (restored by sha256 after probe 3);
  - `.scaffold/test/profile/prefs.js` has no `accessibility.force_disabled` line;
  - no package file;
  - no PDF.
- **Card states:** every card's State is unchanged. `P7-T39` and `P7-T41` stay `TODO`, with a dated batch J note.
  No run failed, so no `DONE` card is affected.
- **No estimate changed**, so the five sites of `plan/README` §7 were not touched. The draft card's 1.0 d is not in
  any estimate until the owner adopts it.
- **Security:**
  - no key was read or written; every command ran with `env -u OPENROUTER_API_KEY`, and only that name was read;
  - no live network or model call, and no keyed or paid path;
  - `NODE_TLS_REJECT_UNAUTHORIZED` was never set;
  - the Gecko profile was written to the scratchpad only, never uploaded;
  - no push, tag, trigger, publish or upload, and no commit;
  - no label, theme or Korean text written; the owner's email appears nowhere new.

## Appendix: progress log

*Notes written as the batch went, kept as written.*

- 18:58 Start. Tree clean at 661a96b. `C:\Program Files\Zotero\application.ini` does not exist; the version file is
  `C:\Program Files\Zotero\app\application.ini` (`Version=10.0.8`), as batch I's gate read it. The gate reads that
  file.
- 19:00 Index probe planted (`j-probe.mjs apply observe heap`: timing wrappers on `Zotero.FullText`'s queue functions
  and `indexItems` during the 500-item job, `.only` on that test, plus a retained-path heap probe after it). The first
  launch was **refused by the gate**: four `updater.exe` processes whose path `Win32_Process` could not read. They
  were gone within two minutes. Nothing was done to them.
- 19:04 Google's per-user updater has an hourly scheduled task (`GoogleUpdaterTaskUser…`, `updater.exe --wake` under
  `%LOCALAPPDATA%\Google\GoogleUpdater\`): last run 18:08:08, next 19:08:08. Batch I's 18:08 failure was at that
  task's time. The gate's check 3 now reads each `updater.exe`'s path with `QueryFullProcessImageName` (limited
  query rights, which can read an elevated process's path), logs the parent, and looks again every 5 s for up to
  30 s when a path cannot be read; still unreadable after that counts as Zotero's (`j-gate.sh`, `j-procpath.ps1`).
- 19:05 `removeGeneratedNotes.spec.ts`: the comment's earlier range now reads 12.9 to 20.5 s (item 410(c)).
- 19:08 The watch (`j-updwatch.log`) saw Google's hourly task start six `updater.exe` processes at 19:08:07, each read
  by the new helper as `C:\Users\<user>\AppData\Local\Google\GoogleUpdater\159.0.8140.0\updater.exe` (parents
  `svchost.exe` and each other); gone by 19:08:21. So the helper reads paths `Win32_Process` could not, and the 19:01
  processes were very likely Google's too (not proved: their paths were not read).
- 19:10 Probe 1 launched (observe mode and heap probe, no debugger; `j-probe1-observe-off.log`).
- 19:23 **Probe 1 (`j-probe1-observe-off.log`, no debugger, `.only` on the 500-item test): the index hypothesis is not
  confirmed.** The job was slow again: 361.6 s, 205 gaps of 1 s or more (334.6 s in all), longest 4,142 ms. Before
  the job all three of Zotero's index queues were empty (attachment index 0, extraction 0, notes 0; making the 500
  items took 226.6 s, long enough for the attachments to be indexed). During the job the wrapped `Zotero.FullText`
  functions (`processAttachmentIndexQueue`, `processAttachmentExtractionQueue`, `processNoteIndexQueue`,
  `optimizeContentIndex`, `vacuumContentIndex`, `indexItems`, `processSyncedContent`) ran **once in all**:
  `vacuumContentIndex`, 3 ms, at +304 s. **0 ms of the 334.6 s of gaps overlapped any index call.** The gaps grow
  slowly through the job (about 1.0–1.4 s at papers 12–48), with one to three papers done per gap.
- 19:23 Heap probe, same run: the closed full-text summarize window's document was alive after the idle reading.
  Shortest retaining paths from the roots: (1) the document's own preserved wrapper (a C++ owner); (2) the probe's
  own `WeakRef` on the stack (weak, not a holder); (3) a C++ callback object whose callback global is a `Window`;
  (4) a preserved `Sandbox` whose prototype object has a `document` property. Read from Zotero 10.0.8's `omni.ja`
  (read only, copied to `j-omni`): `summarize.xhtml` includes `chrome://zotero/content/include.js`, which loads
  `resource://zotero/require.js`, which makes a module-loader `Sandbox` whose prototype is a globals object with
  `window` and `document`. So path (4) is Zotero's per-window module loader. No path named the spec's `win` or a
  plugin object. Owners of (1) and (3) not identified.
- 19:28 Under item 411(a)'s "not confirmed" branch: no fix is built. Probe 2 launched (`j-probe2-prof-off.log`): the same
  wrappers, a local Gecko profile of 60 s of the summarize phase (from +30 s; written to the scratchpad only), and the
  heap probe with two later checks (after 60 s and 120 s more, each after a minimize).
- 19:35 **Probe 2's Gecko profile** (`j-profile-summarize.json`, 28.5 MB, local only; read by batch G's `g-prof.mjs`
  into `j-prof-analysis.txt`): 60.2 s of the summarize phase, from +31.1 s into the job, main thread only, 1 ms
  sampling, 30,972 samples. **96.2 % of the samples are inside `RefreshDriver tick` →
  `NotificationController::WillRefresh`**, Gecko's accessibility notification controller; 95.2 % of all samples have
  their leaf in `win32u.dll`, called from `user32.dll` (a Windows system call; the exact function is not symbolicated).
  Markers in the window: 85 `LongTask`s of `NotificationController::WillRefresh`, 57.9 s in all, the longest 881 ms;
  64,090 `a11y::PlatformShowHideEvent` (34.8 s); 97,132 `DocAccessible::ContentRemovedNode`; 42,545
  `DocAccessible::ShutdownChildrenInSubtree`. The plugin's own script frames are under 1 % (`renderRows` 65 samples,
  `setL10n` 21, `Reflow` of `summarize.xhtml` 79).
- 19:35 Reading: Gecko's accessibility service is running in the test-profile Zotero, and every update of the summarize
  window removes and recreates all 500 rows (`renderRows` in `addon/content/summarize.js`; `show()` is called many
  times a paper in `execute` in `summarizePipeline.ts`), so each update makes about a thousand accessibility show and
  hide events, each passed to Windows. That is the main-thread time in the gaps. Whether the accessibility service is
  on depends on what else runs on the machine (an accessibility client turns it on), which would fit the shape coming
  and going. *Not yet measured:* a run with the accessibility service off.
- 19:42 Probe 2 ended (`j-probe2-prof-off.log`): job 339.2 s, 191 gaps (302.1 s), longest 4,338 ms; index work again
  covered 0 ms of the gaps (5 ms of index calls in all). Heap probe: the same four kinds of path as probe 1. The window
  was **still alive after 60 s and after 120 s more**, each after a minimize, with the plugin holding no handle
  (`{"summarize":0,"report":0}`).
- 19:43 Probe 3 launched (`j-probe3-a11yoff-off.log`): probe 1's wrappers and heap probe, with
  `"accessibility.force_disabled": 1` added to the test profile's preferences for this one development run
  (`j-a11y.mjs`, marked `/* MUTANT A11YOFF */` in `zotero-plugin.config.ts`, restored by sha256 afterwards; the line
  the scaffold writes into `.scaffold/test/profile/prefs.js` is removed afterwards too, since that file keeps its
  lines between runs).
- 19:53 **Probe 3 (`j-probe3-a11yoff-off.log`, accessibility service off): the 500-item job took 9.5 s, 86 samples, longest
  gap 238 ms, no gap of 1 s or more, `P7-T41` line met.** `Services.appinfo.accessibilityEnabled` read false. So with
  the accessibility service off the pauses are gone: **the cause of the pauses is Gecko's accessibility work on the
  summarize window's rows, measured.** Peak over idle 212.5 MiB (222.9 MB). The closed window was **still alive**
  with accessibility off (after the idle reading, and after 60 s and 120 s more), with the same four kinds of path, so
  the accessibility service is not what holds it.
- 19:54 `zotero-plugin.config.ts` restored by sha256 (63c0d6f0…e3e3d); the spec restored (a7ceae65…e2b9); the
  `accessibility.force_disabled` line removed from the test profile's `prefs.js` (line endings kept; against the copy
  taken before probe 3, only the timestamps Zotero itself writes differ).
- 20:11 **Probe 4 (`j-probe4-scope-off.log`): the holder of the full-text job's closed window was the spec itself.**
  The spec now opens, runs and closes that window in a function of its own (`summarizeAndClose`), so the test's own
  frame keeps no reference to it past the close. With that change alone (accessibility service on, no debugger), the
  window was **freed** at the idle reading after the job, and still freed after 60 s and 120 s more; the detached
  `summarize.xhtml` group (+3.2 MiB in every earlier run) is gone from the after-job growth. Before the change, the test's
  `win` variable (a `WindowProxy`) stayed in the test's frame until the test ended; a closed window's proxy keeps its
  inner window and document alive through C++ (Gecko's window objects), which is why the JS heap snapshot showed only
  C++ holders and no JavaScript path from the spec. The same run: accessibility service on
  (`Services.appinfo.accessibilityEnabled` true; the instantiator reads "UNKNOWN"), job 372.9 s, longest gap 3,292 ms.
- 20:12 Spec changes (test-only): `summarizeAndClose`; `accessibilityState()` added to the `P7-T41` log line; the
  job's closed window is now **asserted freed where a closed window can be freed** (`windowsCanBeFreed`, as the
  reference workload's check). Spec sha256 now 7d7e38f2…33ff. Mutant MJ1 (the spec keeps a strong reference to the
  job's window on its global) launched with `.only` on the reference workload and the 500-item test, no debugger
  (`j-mut-MJ1-off.log`).
- 20:28 **Mutant MJ1 killed** (`j-mut-MJ1-off.log`): with the spec keeping a strong reference to the job's window, the
  new assertion failed ("the full-text job's closed summarize window is freed: expected false to equal true"); the
  reference workload passed (0 of 20 closed windows alive). The spec restored by sha256 (7d7e38f2…33ff).
- 20:29 Checks before the recorded runs, all with `env -u OPENROUTER_API_KEY`: typecheck, `lint:check`, `npx eslint .`,
  `l10n:check` (569 messages, 0 holes) and `npm run test` (unit 165 files, 8,518 passed, 105 skipped; contract 7 files,
  93 passed, 28 skipped), each exit 0. Manifest `j-tree.sha`: 1,234 files under `src`, `test`, `scripts`, `addon`;
  `/* MUTANT` grep and `.only` grep empty. Recorded runs launched (`j-record.sh`).
- 20:29–22:33 **The six recorded runs** (`j-record.sh`): each 388 passed, 0 failed; the gate passed before each at the
  first try. The accessibility service was on in all six. The 500-item job's closed window was freed (asserted) in
  the three runs without the debugger. `P7-T41`'s longest gaps: 4,344, 3,496 and 4,244 ms with the debugger; 4,329,
  3,848 and 3,030 ms without.
- 22:33 The tree matched `j-tree.sha` (1,234 files), the `/* MUTANT` and `.only` greps were empty, and no
  test-profile Zotero was running. The scaffold's npm check cache written at 22:33:37; `npm run build` at 22:33:47,
  exit 0, `research-helper.xpi` 734,561 bytes, `typings/` unchanged.
- 22:38 Records written: batch J sections in `P7-T39.md`, `P7-T41.md`, `P7-T15.md`; State notes in `plan/10`; `docs/13`
  §8.8, the checklist rows and the profiling rows; `npm run index:derive` (279 tasks, 235 `DONE`, unchanged).

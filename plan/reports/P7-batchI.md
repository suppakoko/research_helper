# Phase 7 batch I: the integration runs on Zotero 10.0.8

**Date:** 2026-11-24 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-24 (batch I) · **Commit base:** a6fa4e7, uncommitted. The coordinator commits.

Logs and scripts named here are in the session scratchpad
(`C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad`),
outside the repository.

## 1. Summary

- **Six recorded runs, all on one tree, every one 388 passed and 0 failed**: three in the default configuration
  (with the debugger) and three with `RH_DEVTOOLS=off`. `test/integration/testProfile.spec.ts` passed in each, and
  each named Zotero 10.0.8 (build 20261106171835).
- **The three failures of 2026-11-21 were diagnosed** (§2). None is a product defect. Each got a test-only change:
  - `P7-T40`'s per-paper test now takes the least of three rounds;
  - the preference pane's badge text is awaited before it is read;
  - the 40-note test's timeout is 120 s.
- **Without the debugger** (the owner's configuration for memory figures, item 405(b)):
  - reference jobs 1–5: 63.7–79.6 MiB (66.8–83.5 MB) peak over idle, within 150 MB;
  - the 500-item full-text job: 253.2–269.1 MiB (265.5–282.2 MB), within 400 MB by at least 117.8 MB;
  - growth after five jobs: the plugin's share is one group, +0.1 MiB, within the 1 MiB tolerance; the whole
    process grew 6.1–6.5 MiB (heap);
  - closed plugin windows alive: 0 of 20 in each run.
- **`P7-T41`'s first Done-when line is not met.** The 500-item job's longest sampler gap was 4,298, 4,532 and
  4,386 ms without the debugger (line: no gap over 1 s). With the debugger it was 265, 672 and 5,117 ms. In each
  slow run the job took 444–511 s instead of about 16 s, with gaps all through the summarize phase. This is not the
  duplicate screen `P7-T41` fixed (the gaps start after the first papers are summarized). The cause is **not
  measured**. The working hypothesis is Zotero 10.0.8's own background full-text index work (§5). Owner question:
  item 411(a).
- **Mutants:** `registerUI.ts` 5 of 8 killed, and the 3 that survived were the ones `plan/reports/P7-T39.md`
  predicted. `acquire.ts`'s memory-only mutants: 3 of 3 killed.
- **The breakdown probe found no unexplained 25 KB a paper.** One acquired paper holds about 41.5 KB of strings,
  and 40,960 bytes of that is the one compact copy of its text. The excess in the old single-round reading was
  strings made once, early in the measurement, not per paper.
- **Network:** every run's live-request guard listed only loopback hosts, and no update host (§6).
- **The launch gate failed once, at 18:08**, after the six recorded runs (a process named `updater.exe` was
  running). Zotero was not launched again. So the probe that would have tested the hypothesis for the gaps did not
  run (§5, §9).
- **Owner questions:** item 411 (a)–(d).

## 2. The three failures of 2026-11-21

The earlier agent's runs (`i-rec1-on.log`, `i-rec2-on.log`) used the debugger, on the tree before this batch's
changes. Each failure happened once. Each was diagnosed before any run was recorded, and the six recorded runs
are the repeats.

### 2.1 `P7-T40`: "one compact copy of the paper is held: expected 287450.88 to be below 81856"

- **Verdict: not a defect, and not the debugger alone.** The old test measured one round of 50 acquisitions. Any
  string the rest of Zotero made in that window counted as the paper's.
- **Evidence:**

  | Run | Debugger | Round 1 | Round 2 | Round 3 |
  |---|---|---|---|---|
  | 2026-11-21 `i-rec1-on.log` | on | **280.7 KiB** (failed; single round) | | |
  | 2026-11-21 `i-rec2-on.log` | on | 68.6 KiB (single round) | | |
  | `i2-probe1-on.log` (dev) | on | 69.2 KiB (single round) | | |
  | `i2-probe2-off.log` (dev) | off | 63.3 KiB (single round) | | |
  | `i2-mut-NONE.log` (dev, new test) | off | 63.1 KiB | 45.9 KiB | 40.5 KiB |
  | recorded runs 1, 2 (new test) | on | 68.6, 68.7 KiB | 40.4, 40.3 KiB | 40.4, 40.4 KiB |
  | recorded run 3 (new test) | on | **280.6 KiB** | 40.4 KiB | 40.4 KiB |
  | recorded runs 1–3 (new test) | off | 63.0, 63.2, 62.1 KiB | 45.8 KiB each | 40.5 KiB each |

  The 280 KiB burst came back once in the recorded runs with the debugger, and only in the first round. What makes
  it is **not established**.
- **The change (test-only):** three rounds of 50, every result held to the end, and the least round is the paper's
  figure. A second copy of the text would add to every round, so the mutants that drop the compaction are still
  killed (§7). The bound (2 bytes a character, item 404(k)) is unchanged. Coordinator decision item 410(a).

### 2.2 `preferences.spec.ts`: "the badge is not blank: expected +0 to be above +0"

- **Verdict: test timing.** The pane's `localize` sets the badge's Fluent id, and Fluent fills the text on a later
  refresh. The 2026-11-21 log line read `badge: l10n=research-helper-prefs-backend-windows text=""`: the id was set
  and the text not yet filled.
- **The change (test-only):** the text is awaited for up to 5 s before the same assertion. A badge that stays blank
  still fails. In all six recorded runs the badge read "Protected by Windows Credential Manager". Item 410(b).

### 2.3 `removeGeneratedNotes.spec.ts`: "over one user note and 40 generated notes … Timeout of 30000ms exceeded"

- **Verdict: test timing.** The test writes 81 items and notes, one transaction each, under the runner's 30 s
  default. 64 earlier passing runs in the scratchpad took 12.9–20.5 s. The 2026-11-21 run erased 51 fixture items,
  so it was about halfway through when the timeout came.
- **The change (test-only):** the test's own timeout is 120 s. In the recorded runs it took 16.8–19.7 s with the
  debugger and 11.5–12.7 s without. Item 410(c).
- *The new comment in the spec gives the earlier range as "13.6 to 20.5 s". That range came from the 30 logs first
  read; across all 64, it is 12.9–20.5 s. The comment was left as it is, so that the recorded runs' tree stays the
  final tree.*

### 2.4 Cards touched

- **Of the cards set `DONE` in item 409(a):** `P3-T29` (the 40-note test is its spec). Only its test changed, and
  it passed in all six recorded runs. Its State was not changed.
- **Not in item 409(a):**
  - `P1-T44` owns the badge assertion. It has been `DONE` since 2026-10-13.
  - `preferences.spec.ts` was also edited by `P7-T08` and `P7-T09` (both in 409(a)), but not in the badge test.
  - `P7-T40`'s test belongs to `P7-T40`, which is `TODO`.
- **No recorded run failed**, so item 409(a)'s "the affected cards are reopened" does not apply.

## 3. The recorded runs

**One tree.** Before each launch, the run script (`i2-run.sh`) checked these and refused the run if any failed:

- the launch gate;
- every one of the 1,234 files under `src`, `test`, `scripts` and `addon` against one sha256 manifest
  (`i2-tree.sha`);
- `i-sums.txt` (`registerUI.ts` a2335c6b…8c3c, `acquire.ts` 1f3e69e5…a681);
- an empty `/* MUTANT` grep;
- no `.only`.

`workloadMemory.spec.ts` was a7ceae65…e2b9 in every recorded run.

**The command:** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`, with
`RH_DEVTOOLS=off` in front for the second three.

| Run | Debugger | Start | End | Result | `testProfile.spec.ts` |
|---|---|---|---|---|---|
| `i2-rec1-on.log` | on | 15:53:47 | 16:14:50 | 388 passed, 0 failed | passed; 10.0.8, debugger true |
| `i2-rec2-on.log` | on | 16:14:54 | 16:35:13 | 388 passed, 0 failed | passed; 10.0.8, debugger true |
| `i2-rec3-on.log` | on | 16:35:16 | 17:00:44 | 388 passed, 0 failed | passed; 10.0.8, debugger true |
| `i2-rec1-off.log` | off | 17:00:48 | 17:23:04 | 388 passed, 0 failed | passed; 10.0.8, debugger false |
| `i2-rec2-off.log` | off | 17:23:08 | 17:45:23 | 388 passed, 0 failed | passed; 10.0.8, debugger false |
| `i2-rec3-off.log` | off | 17:45:27 | 18:07:51 | 388 passed, 0 failed | passed; 10.0.8, debugger false |

All on 2026-11-24.

## 4. Memory figures (`workloadMemory.spec.ts`, test profile, fake provider)

The spec logs MiB; MB (10⁶ bytes) is in brackets. Peaks are heap (`heapAllocated + JSMainRuntimeGCHeap`) over the
idle reading before the job.

### 4.1 Without the debugger (`RH_DEVTOOLS=off`): the figures of record (item 405(b))

| Run | Reference jobs 1–5, peak over idle | 500-item full-text job, peak over idle | Growth after five jobs: plugin's groups | Growth: whole process (heap; resident; `explicit/` sum) | Closed plugin windows alive |
|---|---|---|---|---|---|
| 1 | 67.1, 64.3, 64.9, 64.7, 77.4 MiB | 259.3 MiB (**271.9 MB**) | 1 group, +0.1 MiB (the plugin's realm); 0 over 1 MiB | +6.3 MiB; −3.8 MiB; +5.6 MiB | 0 of 20 |
| 2 | 64.9, 64.4, 65.7, 66.0, 79.6 MiB | 253.2 MiB (**265.5 MB**) | the same | +6.5 MiB; −4.3 MiB; +5.6 MiB | 0 of 20 |
| 3 | 66.1, 65.4, 63.7, 64.7, 76.8 MiB | 269.1 MiB (**282.2 MB**) | the same | +6.1 MiB; −4.8 MiB; +5.5 MiB | 0 of 20 |

- **Budgets:**
  - reference workload: every job ≤ 79.6 MiB (83.5 MB), within 150 MB;
  - 500-item full-text job: ≤ 282.2 MB, within 400 MB by at least 117.8 MB across the three runs.
- **What grew across five jobs** (each run): Zotero's note editor +3.0 to +3.1 MiB, SQLite +1.0, strings +0.9 MiB.
- **After the full-text job**, in all six runs: that job's summarize window was still alive at the idle reading.
  The plugin held none (`{"summarize":0,"report":0}`), and the plugin's realm was +3.2 MiB. This is logged, not
  asserted. It is open finding §10.2 and owner question item 411(c).

### 4.2 With the debugger (the default configuration), for comparison only

| Run | Reference jobs 1–5, peak over idle | 500-item full-text job, peak over idle | Growth after five jobs: plugin's groups | Growth: whole process (heap; resident; `explicit/` sum) | Closed plugin windows alive |
|---|---|---|---|---|---|
| 1 | 59.9, 62.4, 60.3, 64.2, 78.7 MiB | 219.0 MiB (229.6 MB) | 6 groups, 3 over 1 MiB: `costConfirm.xhtml` +9.5, `summarize.xhtml` +3.9, `reportWindow.xhtml` +3.0 (detached windows); not asserted | +16.9 MiB; −3.6 MiB; +35.6 MiB | 20 of 20 |
| 2 | 61.0, 62.4, 66.1, 60.9, 80.7 MiB | 241.0 MiB (252.7 MB) | the same | +16.8 MiB; −3.9 MiB; +38.0 MiB | 20 of 20 |
| 3 | 63.5, 65.9, 69.1, 68.6, 87.0 MiB | 192.1 MiB (201.4 MB) | the same | +18.3 MiB; −0.1 MiB; +32.8 MiB | 20 of 20 |

With `--jsdebugger`, Gecko keeps every closed chrome window (item 404(h)). So these runs show the closed windows as
retained, and the spec does not assert on them.

## 5. `P7-T41`: the 500-item job's longest sampler gap

| Run | Debugger | Job time | Longest gap | Gaps of 1 s or more | `P7-T41` line (no gap over 1 s) |
|---|---|---|---|---|---|
| rec1-on | on | 16.4 s | 265 ms | 0 | met |
| rec2-on | on | 16.5 s | 672 ms | 0 | met |
| rec3-on | on | 444.2 s | **5,117 ms** | 169, 377.0 s in all, after the 3rd paper to the 498th | **not met** |
| rec1-off | off | 511.2 s | **4,298 ms** | 214, 488.5 s in all, after the 21st paper to the 500th | **not met** |
| rec2-off | off | 499.0 s | **4,532 ms** | 229, 476.8 s in all, after the 12th to the 500th | **not met** |
| rec3-off | off | 499.0 s | **4,386 ms** | 232, 478.6 s in all, after the 12th to the 500th | **not met** |

The 2026-11-21 runs had the same two shapes: 16.9 s with a longest gap of 678 ms, and 211.1 s with a longest gap of
4,036 ms (74 gaps).

**What is known:**

- **The duplicate screen `P7-T41` fixed is not the cause.** Each slow run's first long gap ends after summarizing
  has begun (3 to 21 papers done), and the gaps go on to the end. The old 10.5–10.7 s gap sat in `prepare`, before
  any paper.
- **Every slow job still completed:** 500 of 500 summarized, 0 failed, all 500 from the attached text.
- **The slow shape happened with and without the debugger**, with a heap of about 2 GB with it and about 0.55 GB
  without. So it is not a large-heap or debugger effect alone.
- **On Zotero 10.0.3** (batch F, seven runs), the 500-item job took 35.7–40.6 s, and its only long gap was the
  screen's.

**Hypothesis, not measured.** Zotero 10.0.8 has a background drain of its full-text index queues. This was read
from `chrome/content/zotero/xpcom/fulltext.js` in the installed `omni.ja`, read only, copied to the scratchpad:

- `_scheduleQueueDrain` calls `processAttachmentIndexQueue`, `processAttachmentExtractionQueue` and
  `processNoteIndexQueue`, each with `maxTime: 1000`, and schedules itself again 250 ms later;
- it runs whenever `_canDrainIndex()` holds, that is, "no Zotero window has focus, or the user has been idle for
  3 s";
- the job writes 500 notes, and the 500 attachments were made just before it.

Whether the drain ran depends on focus and on the user's input, which would fit why the shape comes and goes. **Not
checked:** whether 10.0.3 had this drain.

**The probe that would test the hypothesis did not run**, because the launch gate failed (§9). The probe is timing
wrappers on those functions during the job, with queue counts, focus and idle time (`i2-idx-start.ts.txt`,
`i2-idx-end.ts.txt`, `i2-idx.mjs`; an "observe" mode and a "suppress" mode). Owner question: item 411(a).

## 6. Network: the live-request guard's host lists (item 407(a))

| Run | Hosts let through | Away from loopback | Update host? |
|---|---|---|---|
| rec1-on | `127.0.0.1:59321`, `localhost:52296` | `[]` | none |
| rec2-on | `127.0.0.1:59321`, `localhost:49409` | `[]` | none |
| rec3-on | `127.0.0.1:59321`, `localhost:55362` | `[]` | none |
| rec1-off | `127.0.0.1:59321`, `localhost:60468` | `[]` | none |
| rec2-off | `127.0.0.1:59321`, `localhost:53659` | `[]` | none |
| rec3-off | `127.0.0.1:59321`, `localhost:65390` | `[]` | none |

- **No recorded run reached an update host.** Every host the guard let through was loopback.
- **The only `http(s)` hosts the logs name**, outside fixture text, are the XUL namespace
  `http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul` and fixture URLs (for example
  `www.zotero.org/styles/…` as citation-style identifiers). These are strings, not requests.
- `testProfile.spec.ts` read `app.update.lastUpdateTime.background-update-timer` as set a few minutes before each
  start (for example, "245 s ago" in run 1).
- **Outside Zotero:** the scaffold CLI's own once-a-day npm registry check (`tiny-update-notifier`) was kept from
  running by refreshing its cache timestamp before each launch and before the build (item 410(d)). No run printed
  its "Update:" line. The 2026-11-21 run 1 had printed "Update: 0.9.2 → 0.9.4", so that check had reached
  `registry.npmjs.org` then. Owner question: item 411(b).

## 7. Mutation results

Each mutant was one `/* MUTANT` edit, planted by `i-mutate.mjs` and run by `i2-sweep.sh`. After each one, the file
was restored from its backup with the sha256 checked, and the whole tree was checked against the manifest. All
mutant runs were without the debugger, because the assertions they target run only without it (items 404(h),
406(h)). They used `.only` on the tests each mutant targets. A baseline development run (`i2-mut-NONE.log`, no
mutant) passed 3 of 3.

**`registerUI.ts` (`P7-T39`), `.only` on "P7-T39: a closed summarize or report window …" and the reference
workload: 5 of 8 killed.**

| Mutant | Result | How |
|---|---|---|
| M1 no delete in the summarize `onClosed` callback | **killed** | both tests time out waiting for the hold to empty |
| M2 `=== session` → `true` in the summarize callback | **killed** | "the reopened window is held: expected +0 to equal 1" |
| M3 the `onClosed()` calls removed | **killed** | both tests time out |
| M4 no delete in the report callback | **killed** (second run) | both tests time out. The first run hung with the test-profile Zotero idle and no test result for 18 minutes; it was stopped (the batch's own run, older than 10 minutes) and run again (item 410(e)) |
| M5 `=== session` → `true` in the report callback | survived | predicted equivalent here (`plan/reports/P7-T39.md`) |
| M6 `closedSessions.add` removed | survived | predicted: no test closes a report window during a run |
| M7 `closedSessions.clear` removed | survived | predicted |
| M8 `heldCount` returns 0 | **killed** | "the reopened window is held: expected +0 to equal 1" |

**`acquire.ts` (`P7-T40`), memory-only mutants, `.only` on the `P7-T40` test: 3 of 3 killed.** The bound is
81,856 bytes (79.9 KiB).

| Mutant | Result | Least round (rounds) |
|---|---|---|
| A1 `compactText` returns its input | **killed** | 129.3 KiB (151.7, 134.7, 129.3) |
| A2 no compaction of `text` | **killed** | 129.4 KiB (152.1, 134.8, 129.4) |
| A3 `rebaseSections` not called | **killed** | 168.6 KiB (191.0, 174.0, 168.6) |

The `/* MUTANT` grep over `src`, `test`, `scripts` and `addon` was empty, and no `.only` was present, before every
recorded run and at the end.

## 8. `P7-T40`'s per-paper breakdown probe

The probe (`i-probe-block.ts.txt`, planted as `/* MUTANT PROBE`) acquired the same paper 50 times for each variant
and held what the variant names. It compared the `explicit/…/strings` reports, including the notable-string
entries, before and after. Two development runs: `i2-probe1-on.log` (with the debugger) and `i2-probe2-off.log`
(without).

| Held | With the debugger | Without |
|---|---|---|
| the whole result (first variant) | 51,924 B a paper | 41,475 B a paper |
| the whole result, again | 41,319 B | 41,533 B |
| the whole result, last | 41,456 B | 41,533 B |
| nothing (control) | 1,642 B | 1,637 B |
| text only | 39,368 B | 40,988 B |
| sections only | 41,151 B | 41,200 B |
| section texts only | 41,093 B | 41,101 B |
| headings only | 879 B | 1,712 B |
| abstract only (484 characters) | 1,860 B | 1,990 B |

**Finding:**

- **One acquired paper holds about 41.5 KB of strings.** 40,960 bytes of that is one Latin-1 string of 40,922
  characters (`length=40922 malloc-heap/latin1`, +2,048,000 B over 50 copies). That string is the compact text,
  and the sections are cut from it, so the sections alone keep it alive.
- **Headings, abstract and section objects add under 2 KB.**
- **No two-byte copy of the text was held in any variant.**
- **So there is no unexplained 25 KB a paper.** The earlier 66 KB reading (batch G) was the first measurement
  window's one-off strings divided by 50. For example, the first variant with the debugger also gained one two-byte
  string of 46,680 characters (131,072 B) and one of 6,938 (16,384 B).

The probe spec was taken out of the tree after the two runs, restored by sha256.

## 9. The launch gate

The gate was checked by `i2-gate.sh` before every Zotero launch: 2 probe runs, 13 mutant runs and 6 recorded runs.
Its checks:

1. `C:\Program Files\Zotero\app\application.ini` reads `Version=10.0.8`;
2. no `C:\ProgramData\Zotero\updates\*\active-update.xml`;
3. no `updater.exe`;
4. no test-profile `zotero.exe`, recognised by a command line naming `.scaffold` (item 410(f)).

**Every check passed until 18:08.** Then, before the index probe, check 3 found a process named `updater.exe`.

- **Zotero was not launched then, or again in this batch.** Nothing was done to any `updater.exe`.
- At 18:11 no `updater.exe` was running, and the gate passed again.
- **Zotero's own update files** under `C:\ProgramData\Zotero\updates\A88A7A0EE6B236CF` were unchanged since
  2026-11-21, apart from `parent.lock`, last written 2026-11-22.
- **Five programs on this machine have an `updater.exe`:** Zotero, Firefox, Google's updater, Bandizip and IZEX
  NetHelper.
- Google's updater log was last written at 18:03:53.
- **Which program the 18:08 process belonged to was not recorded.** A name-only check cannot tell them apart.
  Owner question: item 411(d).

Nothing under `C:\Program Files` or `C:\ProgramData` was changed. `omni.ja` was only read.

## 10. Decisions, questions and open findings

### 10.1 Coordinator decisions and owner questions

- **Coordinator decisions:** `plan/00` §6 item 410 (a)–(i), each "DECIDED 2026-11-24 (coordinator, under item
  313)".
- **Owner questions, each with a draft not adopted:** item 411 (a)–(d):
  - (a) the gap;
  - (b) the scaffold's npm check;
  - (c) the full-text job's summarize window;
  - (d) the gate's `updater.exe` check.

### 10.2 Open findings

- **`P7-T41`'s gap line is not met** in four of the six recorded runs (§5). Its cause is not measured.
- **The 500-item job's own summarize window stays alive after the job, in every run, with or without the
  debugger.** The plugin holds none of its windows, and the plugin's realm is +3.2 MiB after the job. `P7-T39`'s
  report had left this open ("whether it was later freed is logged in the next run, and not yet seen"). It is now
  seen: not freed by the idle reading.
- **The first-round string burst** in the `P7-T40` test (about 14 MB in one round, with the debugger, two of five
  runs): its source is not established.
- **M4's first hang** was not explained; its second run failed by timeout, as M1 and M3 did.

## 11. Checks after the last source edit

The last source edit was at 15:50 (the `P7-T40` test's comment). The checks ran at 15:51–15:53, all with
`env -u OPENROUTER_API_KEY`. No source file changed after them: the recorded runs and the end of the batch match
the same manifest.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's arguments: none) | exit 0; "ko-KR matches en-US: 3 file(s), 569 message(s), 0 allowed hole(s)" |
| `npm run test` | exit 0; unit 165 files, 8,518 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` | exit 0; `research-helper.xpi` 734,561 bytes, under 3,145,728 |

`typings/` sha256 after the build, unchanged by it and equal to batch H's:

- `global.d.ts` 020956c7…1060
- `i10n.d.ts` cd93b62a…196b
- `prefs.d.ts` 47439ca8…cc3f
- `prompts.d.ts` 4480d796…760c
- `zotero-augment.d.ts` cf994969…62d5

No build ran during an integration run.

After the record edits (plan, reports and docs only), `npm run index:derive` ran (279 tasks, 235 `DONE`, 44 `TODO`, unchanged), `npm run lint:check` passed again (exit 0), and the tree under `src`, `test`, `scripts` and `addon` still matched the manifest, with an empty `/* MUTANT` grep and no `.only`.

## 12. The final tree

- **Base:** a6fa4e7, uncommitted.
- **Modified (test-only):**
  - `test/integration/workloadMemory.spec.ts` (`P7-T40`'s three rounds)
  - `test/integration/preferences.spec.ts` (the badge wait)
  - `test/integration/zotero/removeGeneratedNotes.spec.ts` (the 120 s timeout)
- **Modified (records):**
  - `plan/00-task-index.md` (items 410, 411; `npm run index:derive`)
  - `plan/10-phase-7-release.md` (State notes of `P7-T39`, `P7-T40`, `P7-T41`)
  - `plan/reports/P7-T39.md`, `P7-T40.md`, `P7-T41.md`, `P7-T15.md` (batch I sections)
  - `docs/13-testing-build-and-release.md` §8.8
  - `docs/release/v1.0-checklist.md` (rows `NFR-3`, `NFR-7`, 8.8.1, 8.8.2)
  - `docs/spikes/phase-7-profiling.md` §6.1
- **New:** `plan/reports/P7-batchI.md`.
- **Unchanged:**
  - `src/bootstrap/registerUI.ts` and `src/pipeline/summarize/acquire.ts`, which match `i-sums.txt`;
  - no package file;
  - no PDF.
- **Card states:** every card's State is unchanged. `P7-T39`, `P7-T40` and `P7-T41` stay `TODO`, with a dated
  "integration runs recorded" note.
- **No estimate changed**, so the five sites of `plan/README` §7 were not touched.
- **Security:**
  - no key was read or written, and every command ran with `env -u OPENROUTER_API_KEY`;
  - no live network or model call, and no keyed or paid path;
  - no push, tag, trigger, publish or upload, and no commit.

## Appendix: progress log

*Notes written as the batch went, kept as written.*


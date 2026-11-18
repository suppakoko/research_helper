# Phase 7: startup, memory, main-thread and bundle profiling (`P7-T15`)

> **Status, 2026-11-18.** The agent's part is written: this procedure, the startup timings that
> `hooks.onStartup` now keeps, and `test/integration/startupCost.spec.ts`.
>
> - **Every figure from the owner's run is blank.** The owner runs §2–§5 on a **copy** of a large
>   library, in a **separate Zotero profile** (`plan/06` `G-34`; never the original library,
>   `G-38`).
> - A figure is written here only once it has been measured. The person who measured it, the
>   date and the machine go beside it.
> - The figures the agent measured in the test profile are in §6, with their source run.

## 1. What is measured, and against what

| Requirement | Budget (`docs/10`) | Measured by | Where the figure goes |
|---|---|---|---|
| `NFR-10` startup | ≤ 200 ms added to Zotero startup; no network request at startup | §2 (owner, library copy); `startupCost.spec.ts` (agent, test profile) | §6 table, row NFR-10 |
| `NFR-7` idle | ≤ 30 MB incremental, plugin loaded, no job running | §3.1 (owner, library copy) | §6, row NFR-7 idle |
| `NFR-7` reference workload | ≤ 150 MB peak incremental, 100 items | §3.2, **method not built yet** (see there) | §6, row NFR-7 workload |
| `NFR-7` 500-item full-text job | ≤ 400 MB peak incremental | §3.2, **method not built yet** | §6, row NFR-7 500 items |
| `docs/13` §8.8 line 2 | no growth after 5 consecutive jobs | §3.3 | §6, row five jobs |
| `NFR-3` main thread | no single task over 100 ms | §4 (owner: import on the library copy; agent or owner: report in the test profile) | §6, row NFR-3 |
| `NFR-18` bundle | XPI ≤ 3 MB | §5 (the build) | §6, row NFR-18 |

The release checklist (`docs/release/v1.0-checklist.md`) has one row for each of these. Each row
points to §6.

## 2. Startup (`NFR-10`)

### 2.0 Before anything: the library copy and the separate profile

1. **Copy, never move.** Close Zotero.
   - Copy the whole Zotero data directory (the folder that holds `zotero.sqlite` and `storage\`)
     to a new folder, for example `D:\rh-profiling\zotero-data\`.
   - The original stays where it is and is not opened during this procedure.
2. **A separate profile.**
   - Start `zotero.exe -P` to open the Profile Manager.
   - Create a profile named `rh-profiling` and start it.
3. **Point the profile at the copy.** Open **Settings → Advanced → Files and Folders → Data
   Directory Location → Custom…**, choose the copy, and restart when asked.
4. **No sync.** Do not sign in under **Settings → Sync** in this profile. A copy that syncs would
   write to the same online library as the original.
5. **The plugin under test.**
   - Install the release-candidate XPI (the one §5 measures) through **Tools → Plugins**.
   - Do not install any other plugin in this profile.
6. **Record the machine** in §6: CPU, RAM, Windows version, the Zotero version, and the item
   count shown at the bottom of the library's item list.

### 2.1 The plugin's own work, from its own timestamps

Since `P7-T15`, `hooks.onStartup` keeps four timestamps on the plugin object
(`src/bootstrap/startupTimings.ts`, read through `addon.data.startup`):

| Field | What it measures |
|---|---|
| `barrierMs` | Waiting for Zotero's readiness. This is Zotero's time, not the plugin's. |
| `registerUIMs` | `registerUI`: services, menus, the preferences pane, the item pane section |
| `windowsMs` | The registrations for each main window |
| `ownMs` | `registerUIMs + windowsMs`: the plugin's own work after Zotero is ready |

After each cold start in §2.2, open **Tools → Developer → Run JavaScript**, leave **Run as async
function** unticked, and run:

```js
JSON.stringify(Zotero.ResearchHelper.data.startup)
```

Record the four numbers.

**Not covered by these timestamps.** The time Gecko spends loading the plugin's script before
`onStartup` runs is not in them. §2.3 measures it.

### 2.2 Cold start with and without the plugin, median of five

1. With the plugin **enabled**, make five cold starts. A cold start is:
   - quit Zotero completely and wait 10 seconds;
   - start the `rh-profiling` profile;
   - wait until the item list has finished loading;
   - run in **Run JavaScript**:

   ```js
   JSON.stringify(Services.startup.getStartupInfo())
   ```

   Record the result and the §2.1 timings.

2. **Disable** the plugin under **Tools → Plugins** and make five more cold starts. Record
   `getStartupInfo()` each time; there are no §2.1 timings without the plugin.
3. For each start, the figure is `firstPaint − process` from `getStartupInfo()`.
   - *Unverified:* which fields Zotero 10's `getStartupInfo()` fills. If `firstPaint` is absent,
     record every field, and use the latest field that both sets of runs have.
   - The NFR-10 figure is the **median with** minus the **median without**.
4. **Network silence.** `startupCost.spec.ts` checks network silence in the test profile (§6). On
   the library copy:
   - open **Help → Debug Output Logging → Enable** before quitting, then start once more;
   - search the output for `research_helper/`, the plugin's `User-Agent` prefix. There must be no
     match from startup.

### 2.3 What the plugin's script load costs: the Gecko profiler at startup

1. Quit Zotero. In a Command Prompt, set the variables for this one start only:

   ```bat
   set MOZ_PROFILER_STARTUP=1
   set MOZ_PROFILER_SHUTDOWN=D:\rh-profiling\startup-profile.json
   "C:\Program Files\Zotero\zotero.exe" -P rh-profiling
   ```

2. When the item list has loaded, quit Zotero. The profile is written to the `.json` path.
   - *Unverified:* that Zotero 10's build honours `MOZ_PROFILER_SHUTDOWN`. If no file appears,
     record that here and skip this subsection.
3. Open https://profiler.firefox.com/ and load the file with **Load a profile from file**. The page
   reads the file in the browser. **Do not press Upload.**
4. In the main thread's **Call Tree**, search for `research-helper`. The plugin's frames carry its
   `chrome://` and `jar:` URLs. Record:
   - the total time of the tasks that contain them;
   - the longest single such task, which also counts for `NFR-3`.

## 3. Memory (`NFR-7`, `docs/13` §8.8)

**The reading.** Paste this into **Run JavaScript** to read the process's figures from Gecko's
memory reporter. *Unverified:* the attribute names are Firefox's `nsIMemoryReporterManager`;
check that they give numbers on the day.

```js
const m = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
`resident ${(m.resident / 1048576).toFixed(1)} MB, explicit ${(m.explicit / 1048576).toFixed(1)} MB`
```

**The detailed view.** `about:memory` gives the detailed view: **Measure**, then **Save…**.
Zotero has no address bar, so open it from **Run JavaScript**:

```js
Zotero.getMainWindow().openDialog("about:memory", "_blank", "chrome,resizable,width=900,height=700")
```

*Unverified:* that `about:memory` opens this way in Zotero 10. If it does not, the reading above
is the figure.

### 3.1 Idle

1. **Cold-start** with the plugin enabled.
   - Wait two minutes without touching anything.
   - Take the reading three times, a minute apart. Record the median.
2. **Disable** the plugin, restart, and repeat.
3. The `NFR-7` idle figure is **with − without**, from `explicit`. Record `resident` beside it.

### 3.2 During the reference workload and a 500-item full-text job: method not built

`NFR-7`'s two workload figures need a job to run with no paid call (`P7-T15`'s Do NOT). The
shipped plugin has no recorded-fixture mode for its AI provider.

The fake providers that exist live in the integration suite, inside the test profile:

- `reportWindow-flow.spec.ts`;
- `reportMeasurement-flow.spec.ts`;
- `offline.spec.ts`.

**So this batch built no workload measurement.** The proposal, which is not adopted, is in
`plan/reports/P7-T15.md`:

- a spec in the test profile imports 100 synthetic items, with abstracts for the reference
  workload and long attached text for the 500-item job;
- it runs **Summarize All Papers in Collection** and one report through a fake provider;
- it samples `explicit` every 100 ms and logs the peak minus the idle reading taken before the
  job.

Until it exists, the two rows in §6 stay blank.

### 3.3 Five consecutive jobs

Five consecutive jobs depend on §3.2 for the same reason. Once that harness exists, it runs the job five times. It takes
the idle reading before the first job and after the last, with the same wait (two minutes) before
each. Growth is the difference.

## 4. The main thread (`NFR-3`): long tasks during import and report

1. **Import, on the library copy.**
   - Start Zotero as in §2.3, so the profiler is running from launch.
   - Open **Tools → 리서치 헬퍼 / Research Helper → Search & Import…**.
   - Search PubMed only, for a common topic, with 100 results.
   - Import them into a new collection, then quit.
   - Literature-database searches are free and need no key. No AI provider is called.
2. **Report, in the test profile, on fixtures.** A report needs an AI provider, so it is profiled
   in the integration suite, whose provider is fake:

   ```bat
   set MOZ_PROFILER_STARTUP=1
   set MOZ_PROFILER_SHUTDOWN=D:\rh-profiling\report-profile.json
   set NODE_USE_SYSTEM_CA=1
   npm run test:integration -- --exit-on-finish
   ```

   This profiles the whole suite. Look at the stretch where `reportWindow-flow.spec.ts` runs.
   *Unverified:* that the scaffold's launcher passes these variables through to Zotero.
3. In each profile, open the main thread's **Marker Chart** and find the longest task while the
   plugin's frames are on the stack. The `NFR-3` figure is the longest such task, in ms, and the
   function at the top of its stack.

## 5. Bundle size (`NFR-18`)

`npm run build` writes `.scaffold/build/research-helper.xpi`. Its size in bytes is the figure.
CI enforces the same budget. §6 has the agent's build of 2026-11-18.

## 6. Figures

| Row | Budget | Figure | Pass? | Measured by, date, machine, source |
|---|---|---|---|---|
| NFR-10, the plugin's own work (`ownMs`), cold start on the library copy, median of five | ≤ 200 ms | | | owner, §2.1 |
| NFR-10, cold start with − without, median of five | ≤ 200 ms | | | owner, §2.2 |
| NFR-10, the script load before `onStartup` | (part of the 200 ms) | | | owner, §2.3 |
| NFR-10, no startup request, library copy | none | | | owner, §2.2 step 4 |
| NFR-10, `ownMs` and no startup request, test profile | ≤ 200 ms; none | see §6.1 | see §6.1 | agent, `startupCost.spec.ts` |
| NFR-7 idle, with − without (`explicit`) | ≤ 30 MB | | | owner, §3.1 |
| NFR-7 reference workload peak | ≤ 150 MB | | | method not built (§3.2) |
| NFR-7 500-item full-text job peak | ≤ 400 MB | | | method not built (§3.2) |
| `docs/13` §8.8, growth after five jobs | none | | | method not built (§3.3) |
| NFR-3 longest task, import on the library copy | ≤ 100 ms | | | owner, §4 step 1 |
| NFR-3 longest task, report on fixtures | ≤ 100 ms | | | §4 step 2 |
| NFR-18 XPI size | ≤ 3 MB (3,145,728 bytes) | see §6.1 | see §6.1 | agent, `npm run build` |

### 6.1 The agent's figures (test profile)

`plan/reports/P7-T15.md` holds the run logs for these figures. They come from the test profile
(`.scaffold/test`), which holds a handful of items. They say nothing about a large library.

| Figure | Value | Source |
|---|---|---|
| `ownMs`, the instance `startupCost.spec.ts` found | 11–37 ms in three runs, 2026-11-18 (budget 200 ms: **pass** in the test profile) | `[P7-T15] instance found` line |
| `ownMs`, a fresh disable/enable start | 6 ms in three runs; 32–33 ms from `enable()` by the wall clock (**pass** in the test profile) | `[P7-T15] fresh instance` line |
| requests counted at that start | 0 in each of three runs; 0 in the control window (**pass** in the test profile) | `[P7-T15] requests` line |
| XPI size | 733 556 bytes, under 3 145 728 (**pass**) | `npm run build`, 2026-11-18 |

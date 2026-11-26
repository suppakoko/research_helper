# Phase 7 batch M: item 417(b), whether a stored error's stack names the user's home folder

**Date:** 2026-11-26 · **Executor:** Claude Code (agent), the single tree and Zotero owner, under the coordinator's
brief of 2026-11-26 (batch M) · **Commit base:** 1674121, uncommitted. The coordinator commits.

Logs and scripts named here are in the session scratchpad
(`C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad`),
outside the repository. Batch M's own files there start with `m-`. In everything this batch writes, the Windows
user name is replaced by `<user>`.

## Summary

**Item 417(b)'s answer: yes.** A stored stack names the folder the add-on is loaded from. For an XPI in a profile's
`extensions` folder, that folder is under the user's home folder by default, and the job queue's gate stored such a
stack byte for byte. So `P1-T47` (Phase 1, 0.5 d) was carded and built. `redact` in `src/core/errors.ts`, the one
redactor, now reduces every file location to the plugin's resource path before its key patterns run, and every path
that stores, exports or logs a stack already goes through it. The stack itself is kept, because a bug report needs
its function names and lines.

- **Measured** on Zotero 10.0.8 in the scaffold test profile, through a temporary probe spec (since deleted):
  - one real error from the plugin's HTTP client, stored through the job queue and read back from the plugin
    database;
  - the same built bundle loaded from the built XPI in an `extensions` folder under the home folder (a copy in the
    scratchpad; no real profile touched);
  - one provenance export.
- **Built**:
  - the step in `redact`;
  - `docs/09` §2.1 and `docs/07` §5.2 amended first, with dated notes;
  - 6 unit tests and a 3-test integration spec, which plant or produce a user path and prove it is not stored,
    exported or logged;
  - unit mutants M1–M4, all killed and then removed.
- **Runs**: four recorded runs on one tree (manifest `m-tree.sha`, 1,235 files), debugger on.
  - Run 1 failed one test of `P4-T23`, by what reads as a chance collision with a random report id.
  - Runs 2, 3 and 4 passed all 395 tests.
  - The live-request guard let through loopback hosts only, in every run.
- **Checks**: typecheck, `lint:check`, eslint, l10n with CI's arguments, unit and contract tests, and the build all
  exit 0. The XPI is 736,406 bytes; the typings hashes equal batch L's.
- **Estimate**: Phase 1 29.75–42 d over 47 cards; the project 233.50–327 d over 281 cards; critical path 165.25–231 d.
- **Owner questions**: `plan/00` §6 item 419 (a)–(d). No card's `State` was changed.

## The measured frame shapes

The Windows user name is replaced by `<user>`, and the scratchpad's session folders are shortened to `…`.

| Form | Before `P1-T47` (development run 1) | After (development run 2 and the recorded runs) |
|---|---|---|
| Home folder | `file:///C:/Users/<user>/` | same |
| Test profile | `D:\KIST\projects\research_helper\.scaffold\test\profile` (not under home) | same |
| Default profile root | `C:\Users\<user>\AppData\Roaming\Zotero\Zotero\Profiles` (under home) | same |
| Development install (temporary add-on, `rootURI` `file:///D:/KIST/projects/research_helper/.scaffold/build/addon/`) | `ResearchHelperError@file:///D:/KIST/projects/research_helper/.scaffold/build/addon/content/scripts/research-helper.js:116:11`, 7 plugin frames, down to `request@…:1968:18` | `ResearchHelperError@content/scripts/research-helper.js:125:11` … `request@content/scripts/research-helper.js:1981:18` |
| XPI in an `extensions` folder under home | `listCollections@jar:file:///C:/Users/<user>/AppData/Local/Temp/claude/…/m-xpi/extensions/research-helper@suppakoko.github.io.xpi!/content/scripts/research-helper.js:59525:32` | `listCollections@content/scripts/research-helper.js:59525:32` |
| Test runner and mocha frames | `@chrome://zotero-plugin-scaffold-test-runner/content/…` | unchanged |
| Stored (`job.error_json`) | equal to the live stack, byte for byte, in both forms | the reduced frames; "names the home folder: false" in both forms |
| Exported provenance file | named no home folder (its sources had no `error`) | same |

- The line numbers moved between the two builds because the bundle grew.
- Each stack frame is `function@url:line:col`, with `async*` before an asynchronous frame.
- The stack holds no message line.

## Decisions

All are in `plan/00` §6 item 418, each marked "DECIDED 2026-11-26 (coordinator, under item 313)":
- (a) the card's place, dependencies and estimate;
- (b) reduce the stack, do not drop it;
- (c) the installed form measured on a copy, not in a profile;
- (d) `SourceProvenance.error` covered by a unit test and the code, not by a run;
- (e) the integration spec, and its log test checking both copies of an `error` line;
- (f) mutants run against the unit tests only;
- (g) the development runs' Fluent failures not called a regression;
- (h) the run scripts copied as `m-` files, and the temporary probe spec.

## Runs

| Run | Kind | Start–end | Result | Live-request guard: hosts let through; away from loopback |
|---|---|---|---|---|
| dev 1 | development, before the fix, with the probe | 10:52–11:13 | exit 1, 390 passed, 3 failed (Fluent waits in `searchDialog-flow.spec.ts`) | `127.0.0.1:59321`, `localhost:51014`; none (1,663 channels) |
| dev 2 | development, with the fix and the probe | 11:19–11:39 | exit 1, 393 passed, 3 failed (2 Fluent waits; the new spec's wrong one-copy expectation, since fixed) | `127.0.0.1:59321`, `localhost:60537`; none (1,671 channels) |
| 1 | recorded | 11:41–11:59 | exit 1, 394 passed, 1 failed (`P4-T23`, a chance collision) | `127.0.0.1:59321`, `localhost:64708`; none (1,500 channels) |
| 2 | recorded | 11:59–12:17 | exit 0, 395 passed | `127.0.0.1:59321`, `localhost:62635`; none (1,503 channels) |
| 3 | recorded | 12:17–12:35 | exit 0, 395 passed | `127.0.0.1:59321`, `localhost:51074`; none (1,503 channels) |
| 4 | recorded, the third repeat after run 1 | 12:36–12:55 | exit 0, 395 passed | `127.0.0.1:59321`, `localhost:64710`; none (1,503 channels) |

- **Before every launch:**
  - the launch gate passed all four checks: Zotero 10.0.8; no `active-update.xml`; Zotero's `updater.exe` not
    running; no test-profile `zotero.exe` running;
  - the time was written into `%LOCALAPPDATA%\tiny-update-notifier\Cache\zotero-plugin-scaffold`, as it was before
    every build.
- **Before each recorded run:** the `/* MUTANT` and `.only(` greps were empty, no build was running, and the tree
  matched `m-tree.sha`.
- **The integration command:** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration --
  --exit-on-finish`.

## Checks

Run on the final tree, after the recorded runs; the tree still matched `m-tree.sha`.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` (CI's step, `--base en-US --target ko-KR`) | exit 0; 3 files, 572 messages, 0 allowed holes |
| `npm run test` | exit 0; unit 165 files, 8,547 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` | exit 0; XPI 736,406 bytes (batch L recorded 736,260; this batch's build before the fix was 736,114) |
| Typings hashes | all five equal to batch L's (`i10n.d.ts` 86f684d1…94fc4) |

## Tree changes

Uncommitted; base 1674121.

- **Modified:**
  - `src/core/errors.ts`
  - `test/unit/core/errors.test.ts`
  - `docs/07-architecture-and-data-model.md`
  - `docs/09-security-privacy-and-api-keys.md`
  - `docs/11-implementation-roadmap.md`
  - `plan/00-task-index.md`
  - `plan/02-phase-1-pubmed.md`
- **Created:**
  - `test/integration/storedStack.spec.ts`
  - `plan/reports/P1-T47.md`
  - `plan/reports/P7-batchM.md`
- **Created and deleted:** `test/integration/zz-m-stack-probe.spec.ts`

No key, PDF, user name or e-mail address was written. No label, theme or Korean text was written, and no UI text was
needed.

## Appendix: progress log

*Notes written as the batch goes, kept as written.*

- 10:47 Start. Tree clean at 1674121. Read `plan/README.md`, `plan/reports/P7-batchL.md` and its `l-` scripts,
  `plan/00` §6 items 416–417, `toSerialized` and `SerializedError` in `src/core/errors.ts`, `redactSerializedError`,
  `redactText` and `redactRecord` in `src/core/provenance.ts`, and `fail` in `src/core/jobQueue/queue.ts` with the
  gate in `src/core/jobQueue/jobRecord.ts`.
- 10:47 How the plugin's code is loaded, read from the source: `startup` in `addon/bootstrap.js` loads the one bundle
  with `Services.scriptloader.loadSubScript(\`${rootURI}content/scripts/researchHelper.js\`, ctx)`, so every frame of
  the plugin's own code carries the add-on's `rootURI`, not a `chrome://` URL. How the test profile installs the
  plugin, read from the installed zotero-plugin-scaffold 0.9.2 (`run` and `installTemporaryPlugins` in its runner):
  `plugins.asProxy` is false, so the plugin is installed as a **temporary add-on from the directory**
  `.scaffold/build/addon` over the remote debugging protocol; no file is placed in the test profile's `extensions`
  folder (that folder does not exist at rest). An XPI installed into a profile's `extensions` folder has
  `rootURI = jar:file:///<profile>/extensions/research-helper@suppakoko.github.io.xpi!/` (the comment beside the
  `loadSubScript` call, measured 2026-09-10, `P0-T09`). Both forms are to be measured, not taken from these notes.
- 10:50 Cache written (1795657805468), then `npm run build` exit 0: XPI 736,114 bytes (production mode). The XPI was
  copied, unchanged (sha256 equal), to `m-xpi\extensions\research-helper@suppakoko.github.io.xpi` in the scratchpad, a
  folder under the home folder laid out like a profile's `extensions` folder. Nothing was placed in any real or test
  profile.
- 10:52 Development run 1 started (`m-run.sh … on dev`; the gate passed all four checks; cache written 1795657951440).
  The temporary spec `test/integration/zz-m-stack-probe.spec.ts` evaluates `m-probe.js` from the scratchpad in the
  main window, as batch L's probe spec did. What the probe does:
  1. reads the home folder, the test profile, this installation's default profile root and the add-on's `rootURI`
     from `AddonManager`;
  2. surveys every stored stack already in the test profile's plugin database (`job.error_json`,
     `search_provenance.json`);
  3. makes one fresh error with the plugin's own HTTP client (`api.services.http`, `Zotero.HTTP.request` doubled for
     one loopback URL only, answering 400), serializes it with the error's own `toSerialized`, stores it with the
     plugin's queue (`enqueue`, `start`, `fail`, the call the summarize, report and audio pipelines make), reads the
     row back with SQL and deletes it;
  4. loads the same built bundle the way `startup` does, but from a `jar:` URL into the XPI copy above, into a
     context whose `Zotero` is an empty object (so it touches nothing), makes the bundle's own code throw, and stores
     that stack through the queue's gate;
  5. runs a search and an import through the published search host with a stub in PubMed's slot that yields one
     record and then throws the error from step 3, exports the provenance record to a scratchpad file and reads the
     exported and the stored `SourceProvenance.error`; then restores the registry and erases the collection.
- 11:13 Development run 1 ended: exit 1, 390 passed, 3 failed. The three are `P1-T38`'s empty-keyword and
  no-collection tests and `P1-T22`'s cancel test in `searchDialog-flow.spec.ts`, each a 25,000 ms wait for Fluent to
  render. The tests before them slowed 1.9 s → 4.1 s → 7.9 s → 16.0 s, the doubling `P1-T46` and `plan/00` §6
  item 23 describe; the empty-keyword wait timed out still showing the previous test's headline. The probe spec runs
  last (it is `zz-`), after all three. Treated as the known Fluent slowness for now, not as a regression; the
  recorded runs decide (a failing run is repeated three times before it is called one). Live-request guard: 1,663
  channels; hosts let through `127.0.0.1:59321` and `localhost:51014`; away from loopback none.
- 11:13 **The probe's measurement** (`m-probe-result-1795659134625.txt`; the user name replaced by `<user>`):
  - Home folder `file:///C:/Users/<user>/`. Test profile `D:\KIST\projects\research_helper\.scaffold\test\profile`,
    not under home. This installation's default profile root (`DefProfRt`) is
    `C:\Users\<user>\AppData\Roaming\Zotero\Zotero\Profiles`, under home.
  - `AddonManager`: the plugin is `temporarilyInstalled`, `rootURI`
    `file:///D:/KIST/projects/research_helper/.scaffold/build/addon/`, not under home.
  - The test profile's plugin database held no job row with an error and 6 provenance records with no source error
    before the probe wrote anything.
  - **Dev-install form, a real stored error.** The plugin's HTTP client threw `BadRequestError` (code `BAD_REQUEST`);
    its `toSerialized()` gave `code, messageKey, detail, retryable, httpStatus, stack`; the queue stored it; the row's
    `error_json.stack` equals the live stack byte for byte. Its 63 frames: 7 of the plugin's own bundle, each
    `<function>@file:///D:/KIST/projects/research_helper/.scaffold/build/addon/content/scripts/research-helper.js:<line>:<col>`
    (from `ResearchHelperError@…:116:11` down to `request@…:1968:18`), then the probe spec and mocha as
    `chrome://zotero-plugin-scaffold-test-runner/content/…`. **No home folder**, because the repository is on D:,
    but an absolute local path that names the project folder.
  - **XPI form, the same bundle from an XPI in an extensions folder under home.** `rootURI`
    `jar:file:///C:/Users/<user>/AppData/Local/Temp/claude/…/scratchpad/m-xpi/extensions/research-helper@suppakoko.github.io.xpi!/`;
    the bundle loaded into the stub context (the real plugin object untouched) and its own code threw. The frame:
    `listCollections@jar:file:///C:/Users/<user>/AppData/Local/Temp/claude/…/m-xpi/extensions/research-helper@suppakoko.github.io.xpi!/content/scripts/research-helper.js:59525:32`.
    **It names the home folder.** Stored through the queue's gate, the row kept the stack **byte for byte**.
  - **Provenance.** A search and an import through the published host wrote and exported a record
    (`exportProvenance` → `written`), but its sources carried **no `error`**: the exported record is the import
    run's, whose per-source reports do not come from the search that failed. The exported file named no home
    folder. So `SourceProvenance.error` was not reached with a stack in this run; by the code,
    `redactSerializedError` puts a stack through `redactText`, which keeps a file location as `redact` does.
  - Clean-up confirmed: both probe job rows deleted (0 left), the registry restored, the probe collection and its
    item erased, the export file removed.
- 11:15 **Answer to item 417(b): yes.** In an XPI installed into a profile's `extensions` folder, every stored frame
  of the plugin's own code names the profile's folder, and Zotero's default profile root on this machine is under
  the user's home folder. The installed form was measured on a copy in a folder under home, not in a real profile:
  no real profile was touched. Step 2 follows: a card and a fix.
- 11:20 Card decided: **`P1-T47`** in `plan/02` (Phase 1), the next free id there. Phase 1 is where the persistence
  code was built: `toSerialized`'s redacted `stack` by `P1-T02` (`src/core/errors.ts`) and `SourceProvenance.error`
  with its gate by `P1-T17` (`src/core/provenance.ts`); `JobRecord.error`'s gate is `P3-T34`/`P3-T36`'s, and it calls
  the same redactor.
- 11:22 Docs first: `docs/09` §2.1's printed `redact` block gained the file-location step, with a dated paragraph
  ("A file location never leaves the plugin whole"); `docs/07` §5.2 gained a dated note on `stack`, and §10.1's copy
  of `toSerialized` a dated comment.
- 11:25 Built: `reduceFileLocations` in `src/core/errors.ts`, module-private, called first by `redact`. A `jar:` URL
  loses everything up to and including its `!/`; a `file:` URL keeps what follows its last `/content/`, or `[file]/`
  and its last segment. `KEY_PATTERNS` unchanged (eight entries, same order). Unit tests: a new block in
  `test/unit/core/errors.test.ts` (6 tests: the measured shapes on Windows, macOS and Linux, idempotence, the key
  patterns after the step, stored through `toSerialized`/`toJobRow`/`redactRecord`, exported through
  `redactSourceProvenance`, logged through `createLogger` and `teardownErrorLine`); 185 passed. New integration spec
  `test/integration/storedStack.spec.ts` (3 tests: a real plugin error stored through the queue; a planted frame
  under this machine's home folder stored; a context error logged through the plugin's logger). Typecheck, eslint
  and prettier clean on the changed files.
- 11:30 Mutants (`m-mutants.mjs`, results `m-mutants.json`), each against `test/unit/core` (1,065 tests): M1 drop
  the `jar:` reduction (5 failing), M2 drop the `file:` reduction (6), M3 `redact` skips the step (6), M4 a `file:`
  URL without `/content/` kept whole (5). **All four killed**; the file restored and its sha256 matched; the
  `/* MUTANT` grep over src, test, scripts and addon is empty.
- 11:33 Estimate propagated to `plan/README` §7's five sites by `m-propagate.mjs` (scratchpad), which re-derives
  every figure from the card bodies with batch K's `k-sums.mjs`, asserts each old text and each anchor's uniqueness,
  and checks that the Phase 3 margin (3 d / 4 d) and Phase 5's float (9.75–13 d) did not move. Phase 1: 47 cards,
  29.75–42 d (was 46, 29.25–41); Phases 0–3: 163 cards, 114.50–161 (was 114.00–160); the project: 281 cards,
  233.50–327 (was 233.00–326), still ≈ 11–15 months; critical path 165.25–231 (was 164.75–230); the Phase 3 route
  162.25–227; Phase 5's route 155.50–218. Sites: `plan/02` (the roll-up row and total, edited with the card, and the
  header's Effort line, which still read the 2026-09-09 figure 18.75–26 and is corrected with a dated note), `docs/11`
  §1 (Phase 1's Effort paragraph, the table's Phase 1, subtotal and total rows, the subtotal sentence, the months, the
  factor history: 114.50 ÷ 52 = 2.202, held at 1.50) and §2 (the Mermaid label, the low and high bullet, the Phase 3
  route, Phase 5's float, the struck-through history; the section's header still read 160.00–224 from 2026-11-17 and
  is corrected with a dated note), and `plan/00` §1 (three rows and a dated paragraph). `plan/05` covers Phases 4–7
  only and is not affected.
- 11:36 `plan/00` §6: a dated "Measured 2026-11-26" line under item 417(b). `npm run index:derive`: 281 tasks, 235
  `DONE`, 46 `TODO`; Phase 1 47 rows (44 `DONE`); the derived §4 row for `P1-T47` added. `plan/reports/P1-T47.md`
  written (its Runs section waits for the recorded runs).
- 11:40 Development run 2 ended (with the fix, the new spec and the probe; the gate passed all four checks; cache
  written 1795659562204): exit 1, 393 passed, 3 failed. Two are the Fluent waits again (`P1-T38`'s out-of-range
  headline and the FR-10 cancel test in `searchDialog-flow.spec.ts`, each 25,000 ms). The third was the new spec's
  log test: "the logger wrote the line once: expected 2 to equal 1". **The spec's expectation was wrong, not the
  fix:** an `error` line reaches `Zotero.debug` twice, once by the sink's `write` and once by its `reportError`,
  because `Zotero.logError` writes to the debug output too (`createZoteroLogSink` in
  `src/bootstrap/container.ts`). The test now checks every copy (at least one) for folders and reduced frames.
  Live-request guard: 1,671 channels; hosts let through `127.0.0.1:59321` and `localhost:60537`; away from
  loopback none. The spec's other two tests passed: the real error stored with 7 plugin frames, the first
  `ResearchHelperError@content/scripts/research-helper.js:125:11`; the planted frame stored as
  `listCollections@content/scripts/research-helper.js:59525:32`.
- 11:40 **The probe after the fix** (`m-probe-result-1795660708188.txt`): the stored dev-form stack's 7 plugin frames
  now read `ResearchHelperError@content/scripts/research-helper.js:125:11` … `request@content/scripts/research-helper.js:1981:18`
  (the line numbers moved because the bundle grew); the `chrome://` frames of the test runner are unchanged. The
  jar-form frame was stored as `listCollections@content/scripts/research-helper.js:59525:32`; "names the home folder:
  false" for both, and the exported provenance file named no home folder. Clean-up confirmed again.
- 11:42 The probe spec `test/integration/zz-m-stack-probe.spec.ts` deleted. The `/* MUTANT` and `.only(` greps over
  src, test, scripts and addon are empty; no build and no test-profile Zotero running. Manifest `m-tree.sha`: 1,235
  files (sha256 of the manifest 77926d46…5112). Recorded runs 1–3 started (`m-record.sh`, debugger on).
- 11:45 `plan/00` §6 items 418 (the coordinator's choices) and 419 (owner questions, drafts not adopted) written.
- 12:36 **Recorded runs 1–3 ended** (debugger on; tree = `m-tree.sha` before each; the gate passed all four checks
  before each; the cache written before each launch: 1795660876517, 1795661945492, 1795663070994):

  | Run | Start–end | Result | Live-request guard: hosts let through; away from loopback |
  |---|---|---|---|
  | 1 | 11:41–11:59 | exit 1, 394 passed, 1 failed | `127.0.0.1:59321`, `localhost:64708`; none (1,500 channels) |
  | 2 | 11:59–12:17 | exit 0, 395 passed | `127.0.0.1:59321`, `localhost:62635`; none (1,503 channels) |
  | 3 | 12:17–12:35 | exit 0, 395 passed | `127.0.0.1:59321`, `localhost:51074`; none (1,503 channels) |

  `P1-T47`'s three tests passed in all three: 7 plugin frames, the first
  `ResearchHelperError@content/scripts/research-helper.js:125:11`; the planted frame stored as
  `listCollections@content/scripts/research-helper.js:59525:32`; 2 log lines, neither naming a folder.
  **Run 1's failure reads as a chance collision in `P4-T23`'s step-4 test, not batch M's change.** In
  `test/integration/reportMeasurement-flow.spec.ts`, "no note and no export shows its figures or names, beyond what
  Appendix B already said of each summary" found the measured figure `9195` in the first note. The note's report
  marker carries the report's id, `ac8ee7dd-9195-4a13-…`, and `figuresIn` matches a figure that is not next to a digit
  or a point, so a four-digit hex group made only of digits that equals a measured figure counts as a leak. The
  id alone holds `9195`, which is enough for the match; the note's text is not in the log, so a real figure in it is
  not ruled out by the log alone. Runs 2 and 3 passed it on the same tree; a fourth recorded run is the third
  repeat. `P4-T23` is `TODO`, so no `DONE` card is affected.
- 12:55 Recorded run 4 (the third repeat after run 1's failure; gate passed; cache written 1795664210980): exit 0,
  395 passed; `P4-T23`'s note check found nothing; guard hosts `127.0.0.1:59321`, `localhost:64710`, none away from
  loopback. Not a regression.
- 12:57 Final checks on the final tree (`m-checks.sh`; the tree still matched `m-tree.sha`): all exit 0; cache
  written 1795665420406 before the build; XPI 736,406 bytes; typings hashes equal to batch L's.

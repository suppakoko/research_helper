Report: batch-import test failing with "expected 2 to equal 1"

VERDICT
Fixed. The cause was hypothesis 1, but the extra transaction did not come from the indexing queue the hypothesis named. It came from a preference observer inside Zotero. When `acquireFullText.spec.ts` (P3-T18) changes the preference `fulltext.pdfMaxPages`, Zotero waits 5 seconds and then re-extracts every PDF whose index was cut short by the page limit. That re-extraction writes in its own transaction on Zotero's main database. The spec's partial-index PDF was still in the library at that point, so the write landed inside the batch import's second timed write. The fix is in the test file `acquireFullText.spec.ts` only. The batch-import assertion and all product code are unchanged.

EVIDENCE
1. Temporary instrumentation. I added a "begin" callback to `batchImport.spec.ts` that recorded the time and call stack of every transaction for the whole test. It also logged the background full-text queue counts, the user idle time and main-window focus before and after each timed write.

2. A natural failure, captured. One of four instrumented full-suite runs failed exactly as reported: run 2 of 3, "DB transactions begun during the write: 2". The extra transaction began inside run 2's write window (t0=…442013, resolved=…442361, extra begin at …442301). Its stack:
   Zotero.DBConnection.prototype.executeTransaction
   <- Zotero.FullText indexString
   <- Zotero.FullText.indexPDF
   <- Zotero.FullText indexItem
   <- Zotero.FullText.indexItems
   <- Zotero.FullText.reindexTruncated
   <- Zotero.FullText.init's scheduleReindex timer callback
   After that write, Zotero's attachment content-index queue went from 0 to 1, which shows a PDF had just been re-extracted.

3. Zotero 10.0.3 source (read from the installed omni.ja, `xpcom/fulltext.js`). About 30 seconds after the interface is ready, and only when `Zotero.test` is false (it is false under this scaffold runner), `Zotero.FullText.init` registers an observer on `fulltext.pdfMaxPages`. Each change resets a 5-second timer. When the timer fires, `Zotero.FullText.reindexTruncated` re-indexes every row in `fulltextItems` where `indexedPages < totalPages` and `indexedPages` is below the new limit. The P3-T18 "INDEX_STATE_PARTIAL" fixture (2 of 5 pages indexed) is exactly such a row.

4. The spec's cleanup ran far too late. In `acquireFullText.spec.ts` the cleanup `after` hook was written at file top level. Mocha treats that as a root hook and runs it only after the last spec of the whole suite, so every P3-T18 fixture stayed in the library through `batchImport.spec.ts`.

5. Timing. The spec's last `pdfMaxPages` restore happens about 5 seconds before batch-import run 2's write. The test run includes about 1.15 s for the content-hash test, the audio attachment spec, run 1, and run 2's 1-second baseline.

6. Why it is intermittent. The observer is registered about 30 seconds after Zotero's interface is ready, and P3-T18 runs only about 48 seconds after the suite starts. Whether the observer is live in time, and whether the 5-second timer lands inside a write of about 0.35 s, varies from run to run. This is my inference from the source and the timings, not something I measured directly. My first three instrumented runs passed and the fourth failed.

7. Controlled experiment. I added a temporary change marked `/* MUTANT exp-1 */` that called `Zotero.FullText.reindexTruncated("pages", <current limit>)` at the start of run 2's write.
   - Without the fix: run 2 counted 2 transactions, with the same stack; result 186 passed, 1 failed.
   - With the fix: run 2 counted 1 transaction. The forced call finished without beginning any transaction. Result 187 passed.

8. A second leftover, also cleared by the fix. Before the fix, Zotero's background extraction queue held 2 P3-T18 attachments for the whole batch-import test: the password-protected PDF and the missing-file PDF. If the background index drain had run, it would have begun one transaction per attachment to record them as missing. After the fix the queue is 0.

Hypothesis 2 (the plugin's own database from P3-T33): ruled out. The cache prune and job recovery use the plugin's own `Zotero.DBConnection("research-helper")` (`openPluginDatabase` in `src/zotero/db.ts`). In Zotero's `db.js`, the `Zotero.DBConnection` constructor gives every connection its own `_callbacks`, and `executeTransaction` runs only `this._callbacks.begin`. So the plugin's transactions cannot fire `Zotero.DB`'s "begin" callbacks. The prune also runs only once, 30 seconds after startup, then every 6 hours. In the captured failure, every transaction came from Zotero's full-text code or from specs. This rests on reading the source; I did not run a separate runtime probe for it.

Hypothesis 3 (provider keystore refreshes, preference writes): nothing seen. The whole-test log of transactions in batch-import showed no transaction from plugin code apart from the test's own writes and later specs.

FILES CHANGED
- `test/integration/zotero/acquireFullText.spec.ts`
  - The cleanup `after` hook (it erases `created`, removes `tempFiles` and calls `setPrefStore(undefined)`) moved from file top level into `describe("P3-T18 text acquisition tiers 1-2")`. It now runs when this spec ends. Its body is unchanged.
  - New header section, "Leaving Zotero quiet for the next spec". It explains the `fulltext.pdfMaxPages` observer, why erasing the fixtures turns `reindexTruncated` into a single `SELECT` with no transaction, and that erasing also turns `Zotero.FullText.queueItem`'s delayed indexing into a no-op (`Zotero.Items.getAsync` skips IDs that no longer exist) and empties the extraction queue. It points to `plan/reports/batchimport-flake.md`.
  - Both preferences were already restored in each test's `finally` block. That is unchanged.
- `test/integration/zotero/batchImport.spec.ts`: no net change. I restored it from a backup after the instrumentation and the experiment. Its hash, e72e4909863cc1e3de28fcf5ef58f110f0cf4011793dcadb95d380a98145b112, matches the original.
- I did not need to change product code, and I did not need to change or narrow the batch-import counter.
- I did not touch the coordinator's three files (`addon/locale/ko-KR/research-helper-mainWindow.ftl`, `src/i18n/keys.ts`, `test/unit/i18n/keys.test.ts`). `l10n.spec.ts` passed in every run.
- `typings/i10n.d.ts` and `typings/prefs.d.ts` have new modification times. The scaffold rewrites them on every integration build; I did not edit them, and I could not compare their contents because the tree is not a git repository.

RUNS
- `npm run typecheck`: exit 0.
- `npm run lint:check`: exit 0 (eslint clean; Prettier: "All matched files use Prettier code style").
- `npx eslint .`: exit 0.
- `npm run test`: unit 3,189 passed in 64 files; contract 40 passed in 2 files.
- Diagnosis runs, before the fix and with instrumentation:
  - instr-run1: 187 passed.
  - instr-run2: 187 passed.
  - instr-run3: 186 passed, 1 failed. This is the natural failure captured above.
  - exp-control: 186 passed, 1 failed (forced re-extraction, no fix).
  - exp-fixed: 187 passed (forced re-extraction, with the fix).
  (An earlier attempt did not run any tests because my instrumentation had a syntax error.)
- Final runs on the clean, fixed tree: `npm run test:integration -- --exit-on-finish` (with NODE_USE_SYSTEM_CA=1):
  - Run 1, 11:05–11:08: 187 passed. Batch-import transactions per write: 1, 1, 1. Totals 304 / 371 / 337 ms.
  - Run 2, 11:08–11:11: 187 passed. 1, 1, 1. Totals 285 / 320 / 357 ms.
  - Run 3, 11:11–11:14: 187 passed. 1, 1, 1. Totals 285 / 393 / 344 ms.
- No test-profile Zotero was left running. I checked by command line (`.scaffold\test\profile`) before each run, and none needed killing.
- `grep -rn MUTANT src test addon typings scripts` returns nothing. Both temporary changes (instr-1 and exp-1) were in the batch spec and were removed by the hash-verified restore. No network calls were made.

WHAT I DID NOT CHECK
- I did not directly observe the timing race that makes the failure intermittent: whether Zotero's preference observer was already registered when P3-T18 ran. That explanation is inferred from the source and the timings.
- Three clean passes do not rule out a rare recurrence. But before the fix the forced re-extraction failed every time, and after the fix it cannot begin a transaction because no truncated row remains.
- I did not check whether other specs leave similar 5-second timers behind (for example a later spec changing `fulltext.textMaxLength`). A search of `test/integration` shows only `acquireFullText.spec.ts` sets `fulltext.*` preferences.
- Hypothesis 2 is supported by source reading and the captured stacks only, not by a separate runtime probe on the plugin's connection.
- I did not check whether the earlier P3-T18 note ("one background call for a fully indexed item during acquisition") has the same cause.
- Nothing was committed.

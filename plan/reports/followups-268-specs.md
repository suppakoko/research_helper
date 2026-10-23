Report: integration-test follow-ups to wave 5 (plan/00 §6 item 268, P3-T19 finding 1; item 264/266 cleanup of three specs)

VERDICT
Both tasks are done, and the full integration suite passed in 4 of 4 complete runs: 190 passed, 0 failed and 2 pending in each run. The 2 pending tests are skipped by design: the live PubMed criteria test and the opt-in 10,000-item test.
- Task 1: the two specs that P3-T19's cleaning pass broke now pass. Only the spec changed; no product file was touched.
- Task 2: batchImport, itemCreation and itemMapper now erase what they create, each from an `after` hook inside their own `describe`.
- No later spec depended on those items.
- The batch-import spec's database-transaction count read 1 in all 12 timed writes (3 per run × 4 runs).

Other checks:
- typecheck: exit 0.
- `npx eslint .`: exit 0.
- `npm run test`: exit 0. Unit: 3,520 tests in 76 files passed. Contract: 40 tests in 2 files passed.
- `npm run build`: exit 0. Every file under typings/ has the same SHA-256 hash before and after the build.
- `lint:check`: exit 1, caused only by Prettier on test/unit/zotero/sessionStore.test.ts. Another agent last wrote that file at 00:16, before this session started, and I did not touch it.
- `grep -rn MUTANT src test addon typings scripts` is empty.
- No Zotero test profile is left running.
- Nothing was committed.

FILES CHANGED WITH DECLARATION NAMES
All four files are under test/integration/zotero/. Backups of the originals are in C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\followups-orig\

1. acquireFullText.spec.ts (task 1)
- New constant `PAGE_WORDS` = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO"]. `pageMarker` now returns `RHP3T18-PAGE-0N-OF-0M-<WORD>`. With the word, no two pages are alike once digits are stripped. `pageMarker` calls `assert.fail` above five pages.
- New constant `FOOT_LINE` holds the generator's existing last line, unchanged. It is only logged, never asserted.
- New import: `OCR_SUSPECTED_WARNING` from src/pipeline/summarize/clean.
- One assertion changed, in "a fully indexed PDF yields Tier 2 text with zero PDFWorker calls". `assert.deepEqual(source.warnings, [])` became `assert.deepEqual(source.warnings, [OCR_SUSPECTED_WARNING])`. The new check is still exact: no other warning is allowed.
- Every other assertion in both specs is unchanged. That includes:
  - zero acquisition PDFWorker calls;
  - tier, attachmentKey and truncated=false;
  - the page checks [1,2,3], [1,2,3,4,5] and [1,2];
  - the abstract preamble;
  - 2 form feeds;
  - the content hash;
  - exactly one call with maxPages null under the cap;
  - exactly one call with maxPages [2] over the cap, with truncated=true;
  - the index state left unchanged.
- The debug line of the fully indexed spec now also prints the number of surviving foot lines, the warnings, and the first page after cleaning.
- A new header section, "What `P3-T19`'s cleaning pass changes here", records why these lines changed.

2. batchImport.spec.ts (task 2)
- New module-level sets `writtenItemIDs` and `writtenCollectionIDs`.
- They are filled in `measureOneRun` right after `const transactionsDuringWrite = begun.length`, so after the timed region and after the transaction counter is read. A collection is recorded only when `result.collectionCreated` is true.
- New `declare function after`.
- The new `after` hook inside `describe("Batch import of 100 items (P0-T20, V-12, NFR-1)")`:
  - erases the items, then the collections (`eraseTx`);
  - logs "[P0-T20] cleanup erased N items and M collections in X ms";
  - on failure, logs "cleanup FAILED … items may remain" and does not throw.
- It runs after the spec's only `it` has finished, so it cannot fall inside a timed write or be counted by the `begin` callback.
- The header gained a "Cleanup" paragraph.

3. itemCreation.spec.ts (task 2)
- New module-level sets `writtenItemIDs` and `writtenCollectionIDs`, plus `LOG_PREFIX` "[P0-T10]" and `declare function after` and `debug`.
- The spec now records `collectionExistedBefore` before the click.
- Right after the settle wait, and before any assertion, the new item IDs are recorded. The `SPIKE_COLLECTION_NAME` collection is recorded only if this click created it.
- The `after` hook inside `describe("Tools-menu spike command (P0-T10)")` reports a failure rather than throwing.
- The header sentence "nothing is cleaned up afterwards" was replaced with a "Cleanup" paragraph.

4. itemMapper.spec.ts (task 2)
- New module-level array `writtenItemIDs`. `saveMapped` pushes each saved item's ID; the overflow test also pushes the child note's ID.
- New `declare function after`.
- The `after` hook inside `describe("CanonicalWork → Zotero item JSON, validated by Zotero (P1-T12)")` erases in reverse order, so the note goes before its parent. It reports a failure rather than throwing.
- The header gained a "Cleanup" paragraph.

All four files pass Prettier and ESLint.

SHARED-FILE EDITS QUOTED
None.

DOC NOTES ADDED
None. The explanations are in the spec headers only, because no document is affected.

NEW STRINGS
None.

RUNS
Before every integration run, a script refused to start if `grep -rn MUTANT src test addon typings scripts` found anything; it was empty each time. No source file had been modified after the build, and no Zotero process with `.scaffold\test\profile` on its command line was running. Each run used `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`.

- `npm run build`, 02:23: exit 0. It printed 49 warnings of the form "I10N id … missing in locale: ko-KR". These are the ids that still have only a commented Korean stub (they wait for Korean review).
- Run 1, 02:24:09–02:27:42: 190 passed, 0 failed, 2 pending.
- Run 2, 02:30:16–02:33:39: 190 passed, 0 failed, 2 pending.
  - Between runs 1 and 2 I changed only comments and a debug line in acquireFullText.spec.ts.
- Run 3, 02:35:07–02:38:26: 190 passed, 0 failed, 2 pending.
  - npm exited 0, but the word "fatal error:" appeared, with no message, at the end of the output at shutdown. It came after "Test run completed - 190 passed".
- Run 4, 02:38:28–02:41:34: 190 passed, 0 failed, 2 pending.
  - Between runs 2 and 3 I again changed only comments. Runs 3 and 4 used the final files.
- No Zotero had to be killed, and none was running afterwards.

What the logs show, identical in all 4 runs:
- The fully indexed spec: "acquisition calls=[]", formFeeds=2, warnings=ocr_suspected.
- The partial-index spec: under the cap, `[{"maxPages":null}]` with pages [1,2,3,4,5], not truncated. Over the cap, `[{"maxPages":2}]` with pages [1,2], truncated.
- The batch import logs "library holds 0 regular items before the first run". Each of its 12 timed writes logs "DB transactions begun during the write: 1". Its cleanup then logs "erased 300 items and 3 collections" (570–914 ms).
- import-perf (P1-T14) logs "library holds 0 regular items before the first import". The after-hooks-264 report recorded 300 here.
- "[P0-T10] cleanup erased 1 items and 1 collections".
- "[P1-T12] cleanup erased 8 items" (7 saved items plus 1 child note).
- libraryIndex: the P1-T13 index covers 2 items (310 in after-hooks-264). The P2-T19 cost test covers 2,022 items.

Final checks, run after the integration runs:
- typecheck: exit 0.
- lint:check: exit 1, only Prettier on test/unit/zotero/sessionStore.test.ts (another agent's file, last written at 00:16).
- `npx eslint .`: exit 0.
- `npm run test`: exit 0. Unit: 76 files, 3,520 tests passed. Contract: 2 files, 40 tests passed.
- typings/: all five files have the same SHA-256 hash as at the start.
- MUTANT grep: empty.

CONTRADICTIONS/FINDINGS
1. The reason the marker was deleted is wider than P3-T19's report says. Zotero 10.0.3's text extractor returns each generated page as one line. Measured: "RHP3T18-PAGE-01-OF-03-ALPHA Synthetic fixture text for page 1 of 3. This line is generated by the P3-T18 integration spec.\n\n\n". That single line is both the first and the last line of the page. With the old marker, the whole line strips to the same text on every page once digits are removed. So the cleaning pass deleted the entire page body as a running head, not just the marker line. The per-page word fixes it, and the shared last line now survives too (the log shows "foot lines left=3"). The spec header records this measurement.
2. Library sizes dropped as expected, and nothing pins them:
   - import-perf compares the library size before and after inside one test (+100), so it is independent of the starting size.
   - libraryIndex only logs `itemsScanned`, or asserts `>= COST_ITEMS`.
   - The 10,000-item test is opt-in, skipped, and uses max(0, …).
   - No later spec uses the DOIs, PubMed IDs, titles or spike collection of the three specs (checked by grep).
3. The two acquisition specs make no network request through Tier 3. Their parent items have no DOI, PubMed ID or PMCID, so `fetchEpmcFullText` returns "unavailable" (no identifier) before any request is made.

WHAT I DID NOT CHECK
- I did not run the old acquireFullText.spec.ts to watch it fail. That it fails rests on P3-T19's report and on the one-line page measurement in finding 1.
- I did not check, after each cleanup, that the erased IDs are really gone. The evidence is indirect: the next spec's library counts dropped (0 before import-perf; 2 indexed by libraryIndex), and no "cleanup FAILED" line appeared in any run.
- I did not look into the bare "fatal error:" at the end of run 3, which printed after "Test run completed" while npm still exited 0.
- I did not touch plan files, src/, or the Prettier problem in sessionStore.test.ts.

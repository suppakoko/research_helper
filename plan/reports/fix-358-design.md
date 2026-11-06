# fix-358-design — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: Both fixes are designed, written as patches, and tested at unit level on a scratch copy of the tree (commit c39b20e). Fix 1 adds no helper. It reuses the base-mapped read the P5-T32 card built (`snapshotZoteroItem`, which reads the field list `BASE_MAPPED_READ_FIELDS`). Fix 2 adds no new string: when Import finds the target picker on bare "New collection…", it opens the existing name prompt. The full unit suite passes on the patched copy: 137 files, 7641 passed, 105 skipped. Typecheck, eslint and prettier pass on the touched files. The contract suite and both new integration blocks were not run, because Zotero belongs to the other agent. I did not touch the tree. Both patches still pass `git apply --check` against it. The Korean insertion round has since changed 7 other files, and none of them overlap these patches.

## Fix 1 — the summarize venue (item 345(d))

**Cause.** `snapshotForSummary` in `src/zotero/notes.ts` read the venue with `fieldOf(item, "publicationTitle")`. That is a plain `getField` call without its third argument (`includeBaseMapped`). Zotero stores a container under the type's own field name, so the plain call answers `""` for a conference paper (`proceedingsTitle`), a book section (`bookTitle`) and a webpage (`websiteTitle`). The other six types in docs/07 §6.6's list have the same gap.

**The existing solution.** P5-T32 solved this inside `snapshotZoteroItem` in `src/zotero/itemMapper.ts`: the `BASE_MAPPED_READ_FIELDS` set (`title`, `publicationTitle`) is read with `getField(name, false, true)`. Integration round 350 proved this read in real Zotero ("reads a type's own field names as a work's container and date", all three runs). `snapshotForSummary` already called `fromZoteroItem(item)`, which builds that snapshot, and then threw it away.

**Docs/07 on the venue.** docs/07 has no definition of a "summarize venue":
- §6.2 maps `containerTitle` to `publicationTitle` for a journal article and to `repository` for a preprint.
- §6.6's note dated 2026-11-05 records the base-mapped read and says the `notes.ts` read "keeps the gap".
- §12.3's state diagram reads "items → CanonicalWork".

**The change.** `snapshotForSummary` now:
- builds the snapshot once with `snapshotZoteroItem(item)`;
- takes `workKey` from `canonicalWorkFromSnapshot(snapshot).workKey`, which is the same value `fromZoteroItem` gave;
- takes `publicationTitle` from the snapshot's base-mapped field, where it used to call `fieldOf`.

The import of `fromZoteroItem` is swapped for these two functions, and a doc comment is added to `SummaryRunItemSnapshot.publicationTitle`. A preprint still reads `""`. `fieldOf` still reads the title, date, DOI, extra field and abstract.

**Patch:** `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\fix358\fix-345d-summary-venue.patch` (notes.ts, a new unit test file, one new integration test).

**Callers and what each would show differently:**
- `snapshotForSummary` is called by `readCollectionForSummary` and `readItemsForSummary`.
  - `readCollectionForSummary` serves the collection run through `createZoteroSummarizeLibrary().loadCollection`, and the integration spec `removeGeneratedNotes.spec.ts`. That spec's fixtures are journal articles, so it is unaffected.
  - `readItemsForSummary` serves the item-pane one-item run through `loadItems`.
- Both readers feed `summarizeItemFrom` in `registerPipelines.ts`, which uses the venue in two places:
  1. **`metadata.venue`:**
     - In `metadataVariables` it becomes the prompt's `{{VENUE}}`, which today reads `unknown` for these types and would now read the proceedings, book or site title. The three paper-summary prompts carry that `{{VENUE}}` slot.
     - It also feeds the cost estimate's overhead measure (`measureOverhead`), so the estimate rises slightly.
     - It is part of the summary cache key (docs/06 §11.2, reading 6). So when "Re-summarize existing" is ticked, such an item misses the cache once and pays a model call. Already-summarized items are skipped by default, so nothing re-runs on its own, and the work key does not change.
  2. **`screen.containerTitle`:** the duplicate check (`candidateOf` → `containersDiffer`, guard 3 of docs/02 §11.3.3) can now apply. Measured on stubs: a conference paper and its journal version with the same title and author, one year apart, were "journal is a duplicate of the conference paper" before and are both kept after. With equal years, one is still dropped as a duplicate.

**Tests:**
- New file `test/unit/zotero/summaryVenue.test.ts`, 8 tests:
  - the container is read for a conference paper, book section and webpage;
  - `publicationTitle` is asked once, base-mapped;
  - a journal article keeps its venue, and a preprint and a thesis stay `""`;
  - the work key equals `fromZoteroItem`'s;
  - the venue reaches both `metadata.venue` and `screen.containerTitle` through `createZoteroSummarizeLibrary().loadItems`;
  - the conference-and-journal pair is kept.
- On the unfixed `notes.ts`, 6 fail and 2 pass. The 2 that pass are the deliberate guards that nothing else moved.
- Mutants: going back to `fieldOf` fails 6. Using `CanonicalWork.containerTitle` instead fails 1 (the preprint guard).
- **Integration** (in `relatedLibrary.spec.ts`, after the base-mapped block): six real saved items, read through the product's `loadItems`. It asserts the `{{VENUE}}` text a summary request would carry and the screening container for each type. No window draws the venue, so the request text is the nearest observable thing. It fails if the read goes back to the plain call.

**Docs to update, with a dated note:**
- docs/07 §6.6: close the "keeps the gap" sentence.
- docs/06 §11.2, reading 6: one re-summarize miss for these types.
- docs/12, the "As built 2026-10-28 (P3-T25)" note under "Input variables", item (2): the venue is the base-mapped container, and a preprint has none.
- plan/00 §6 item 358(b): record the result.

**Risk to other modes:** none on the code path, since the related and recommend readers do not use `notes.ts`. Within summarize: the one-time cache misses on re-summarize, a different "skipped: duplicate" count as described above, and a slightly higher estimate.

## Fix 2 — the Import gate (item 348(e))

**What the user sees now** (reasoned from code, not watched):
1. The window opens with the picker on "New collection…". That happens with no collection selected, a related seed with no readable title, or after choosing the picker's "New collection…" entry and cancelling its prompt.
   - Choosing the entry moves the picker off the previous collection before the prompt opens, so the previous target is lost. This is reasoned from how the menu list works, and it is consistent with P5-T17's finding.
2. Rows are ticked, so Import is on: `logic.importEnabled` reads only the count.
3. The user presses Import or Enter. `import()` hands the bare "new" value on, and each mode's model refuses it with only a log line:
   - keyword mode: `runImport`'s `resolveTarget` refusal;
   - related mode: `importRows`, "a related import had nothing to write";
   - recommend mode: `importRows`, the same.
4. Nothing on screen changes.
5. In keyword mode, `runImport` also clears the retained provenance record before it refuses. This is a side effect found while reading.

**The change.**
- A new `RHSearchWindow.ensureTargetNamed` is called in `import()` after the ticked-count check. If `logic.targetNamed` says the picker names nothing, it calls the existing `promptForCollectionName`. A name goes in through `adoptNewCollection` and the import continues; a dismissed prompt imports nothing.
- docs/08 §4.2's gate ("disabled until ≥1 selected") is left as it is.
- The comments on `logic.importEnabled`, `newCollection`, and `resolveTarget` and `runImport` in `searchImportViewModel.ts` are corrected. They claimed the document gates Import on the target, which it never did.
- This fits docs/08: it is step one of §4.4, and §8.1's rule holds because the user has just pressed Import.
- **No new string.** The prompt reuses `research-helper-search-target-new` and the window title.

**Patch:** `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\fix358\fix-348e-import-target-name.patch` (searchDialog.js, comments in the view model, unit tests, one integration test, and a header note in the integration spec).

**Tests:**
- Unit: 5 new tests in keyword mode:
  - the window opens on "new" with Import on;
  - a dismissed prompt asks once, imports nothing, and leaves the picker alone;
  - a named prompt imports into `new:<name>` and lists the name in the picker;
  - a picker that already names a collection is not asked;
  - with no tick, nothing is asked.
- Unit: 1 new test in related mode (dismissed, then named).
- Two existing tests pressed Import on bare "new" and now set a target first, each with a dated comment:
  - "keeps the accept button from closing the window";
  - the recommend test "imports no row filtered out of view", which now waits for the dated default.
- Before the fix, 3 of the new tests fail. Mutants all fail tests: the check always passing (3), no adopt (2), the prompt before the count gate (3).
- **Integration** (`searchDialog-flow.spec.ts`, P1-T22 block, in the real window):
  - It clicks the real accept button on bare "new".
  - It catches the real prompt on the `common-dialog-loaded` notice and asserts one prompt was drawn, its `infoBody` text equals the entry's drawn label, and it has a box with nonzero size.
  - It cancels the prompt and asserts no new collection, notices unchanged, and no run started.
  - It presses again, types a name into `loginTextbox`, and asserts that collection exists with "Imported" in the notices.
  - Without the fix, no prompt is drawn and the first assertion fails.

**Docs to update, with a dated note:**
- docs/08 §4.2 Import row: the gate is unchanged, and Import asks for a name on bare "New collection…".
- docs/08 §4.4, step one.
- docs/08 §5.2, decision (1): with no readable seed, Import asks.
- docs/08 §8.1: the second permitted prompt.
- plan/00 §6 items 348(e) and 358(b).

**Risk to other modes:**
- Related and recommend modes name a default target, so they only ask when the picker is truly bare.
- If the user presses Import before the asynchronous default lands, the prompt shows. Then `adoptRelatedTarget` or `adoptRecommendTarget` may run inside the prompt's event loop, and the user's typed name still wins (reasoned).
- Enter in the Filter box or a year field also triggers Import, so it can now open the prompt where before it was silent.
- Every existing integration spec that presses Import names a target first (checked by searching the specs). The one exception is `relatedWindow.spec.ts`'s group-library test, which relies on the seed default: if that default ever failed, the test would now wait on a real modal until it timed out, where today it fails on its own wait.

## For the owner's decision
1. **Preprint venue.** The patch keeps `""`. Using `CanonicalWork.containerTitle` would give "bioRxiv", matching docs/07 §12.3's "items → CanonicalWork", but it moves the cache keys of re-summarized preprints. This is small enough for a coordinator decision.
2. **Scope: title and date.** The same reader still reads `title` and `date` with the plain call. So, reasoned from docs/07 §6.6's measurement, a case, email or statute has no title, and a patent, case or statute has no year. Fixing both is the same one-line change, but it is not in item 358(b) and it also changes cache keys.
3. **Screening change.** Accepting that a conference paper and its journal version a year apart are no longer counted as duplicates. This follows docs/02 §11.3.3's guard 3.
4. **Fix 2 options.** Two optional additions are not in the patch:
   - Restoring the previous target when the entry's prompt is dismissed. It needs a listener on the menu popup opening, and it does not cover a window that opened on "new".
   - A dedicated prompt wording, which would need owner-approved Korean. If wanted, a draft English: title "New collection", text "Name the collection to import into:".

## Could not determine
- Whether Zotero 10.0.3's prompt raises `common-dialog-loaded` and has the ids `commonDialog`, `infoBody` and `loginTextbox`. These come from Firefox knowledge and are unverified. If the notice never fires, the integration test hangs until its timeout.
- That choosing the picker's "New collection…" entry sets the picker before its handler runs. This is reasoned, not measured.
- Every integration assertion above is unrun.
- Not carded under rule 9: a picker holding the id of a deleted collection still passes `targetNamed` and is refused silently.

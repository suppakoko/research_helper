## VERDICT
All four decisions of plan/00 §6 item 305 are applied. Nothing is committed, and every card State stays TODO.
- **Static checks:** typecheck, lint:check, `npx eslint .`, unit and contract tests, the build and `index:derive` (twice) all pass.
- **Mutants:** 9 written, 9 killed. Each was restored by copy and its hash checked. The `MUTANT` search is empty at the end.
- **Integration:** run three times, 222 passed and 0 failed each time. The P1-T44 preferences badge test passed in all three runs.

What changed, in one line each:
- **(a)** A one-item run uses the strictest privacy mode among the item's collections and the global setting. "Strictest" is the order the code already declares in `PRIVACY_MODES` (strict, then balanced, then full), applied through `effectiveMode`, so I did not need to stop.
- **(b)** No behaviour change. The documents now record "keep asking every time" as decided.
- **(c)** Regenerate now really asks the model again. It skips the stored row and the cache entry, the cost question is asked, one real call is made, and the answer replaces both the row and the cache entry. Retry, Generate and the collection run's "Re-summarize existing" keep the cache rule.
- **(d)** The two Korean entries are inserted byte for byte. Their selector keys match en-US exactly (checked by script before inserting). Both ids moved to `KO_PRESENT`, so `KO_PENDING_REVIEW` is now empty.

## FILES CHANGED WITH DECLARATION NAMES
All paths are under `D:\KIST\projects\research_helper\`.

- `src\pipeline\shared\privacyPolicy.ts`
  - New `loadStrictestPrivacyPolicy`: applies `effectiveMode` over every listed collection; fails closed to strict when the store is missing or a row cannot be read.
  - `loadPrivacyPolicy` now calls it with one collection or none; behaviour unchanged.
- `src\bootstrap\container.ts`
  - `QueuedPipelineJobOptions.itemCollections` added.
  - `createPipelineContextFactory`'s `openJob` builds the policy with `loadStrictestPrivacyPolicy` over the job's collection plus `itemCollections`; its doc comment is updated.
- `src\zotero\notes.ts`: new `collectionsOfItem(libraryID, itemKey)`. It uses `getCollections()` and throws if the item or a collection cannot be read.
- `src\ui\dialogs\summarizeDialog.ts`
  - `ItemSummaryDeps.collectionsOf` added; `ItemSummaryDeps.openJob` gains an `itemCollections` parameter.
  - `ItemSummaryRequest.bypassCache` added.
  - `runItemSummary` reads the item's collections once, passes them to both job openings, and sets `SummarizeInput.bypassCache` only when `regenerate` and `bypassCache` are both set.
- `src\pipeline\summarize\summarizePipeline.ts`
  - `SummarizeInput.bypassCache` added.
  - New exported `bypassesStoredResult`.
  - The cache check in the planning step (`CacheProbe`, local `bypass`) counts nothing as cached under the bypass.
  - `execute`'s `call` passes `bypassCache` to `summarizeItem`.
  - `validate` reports `field: "bypassCache"` on any other kind of run.
- `src\pipeline\summarize\summarizeItem.ts`
  - `SummarizeItemInput.bypassCache` added.
  - A local `lookup` replaces both `deps.summaryCache.lookup` calls (the abstract path and the full-text paths).
  - Header item 5 updated; import of `SummaryCacheLookup`.
- `src\ui\panes\summarySection.ts`
  - `SummarySectionHost.generate`'s options gain `bypassCache?`.
  - `startGenerate` gains a `bypassCache` parameter, which only the Regenerate header button sets.
- `src\bootstrap\registerUI.ts`: `itemSummaryDeps` (`collectionsOf: collectionsOfItem`, `openJob` passes `itemCollections`); `publishSummarySection`'s `generate` passes `bypassCache`; import of `collectionsOfItem`.
- `src\i18n\keys.ts`: `KO_PENDING_REVIEW` and `KO_PRESENT`.
- `addon\locale\ko-KR\research-helper-mainWindow.ftl`
- Tests:
  - `test\unit\pipeline\summarizePipeline.test.ts`
    - `itemRun` gains collections and a privacy option.
    - The old "Regenerate … summarizes it again" test is split into a Retry test (cache rule kept) and a Regenerate test.
    - New: "the bypass needs Regenerate"; a 4-test privacy `describe`; a 3-test `bypassesStoredResult` `describe`.
  - `test\unit\pipeline\privacyPolicy.test.ts`: 3 tests for `loadStrictestPrivacyPolicy`.
  - `test\unit\bootstrap\container.test.ts`: 1 `openJob` test with `itemCollections`.
  - `test\unit\ui\summarySection.test.ts`: 1 test showing only Regenerate asks for the bypass; Retry and Generate do not.
  - `test\unit\i18n\keys.test.ts`: the pinned "pending" test now asserts `KO_PRESENT`; the `MAY_BE_EMPTY` comment is updated.
  - `test\integration\zotero\summarySection.spec.ts`
    - New test: `collectionsOfItem`, plus `openJob` giving strict, balanced and balanced in real Zotero.
    - The Generate/Retry test also asserts `bypasses` equals `[undefined, undefined]`.
- Documents: `docs\06-summarization-and-trend-report.md`, `docs\07-architecture-and-data-model.md`, `docs\08-ui-ux-spec.md`, `docs\09-security-privacy-and-api-keys.md`, `plan\04-phase-3-llm-summaries.md`. `plan\00-task-index.md` is unchanged by me: `index:derive` gave the same hash `2cb86d47…` as before I started.

## SHARED-FILE EDITS QUOTED
**`keys.ts`**
- In `KO_PENDING_REVIEW`, the stub comment and the two ids were replaced by: "// The item pane's two result lines (owner, plan/00 §6 item 303(a), (b)) // left this list on 2026-10-29: the owner approved the coordinator's Korean // (`G-41`, plan/00 §6 item 305(d)), so both are on KO_PRESENT." The list now holds no ids.
- At the end of `KO_PRESENT`: "// The item pane's two result lines (plan/00 §6 item 303(a), (b)): Korean // drafted by the coordinator and reviewed by the owner on 2026-10-29 // (`G-41`, plan/00 §6 item 305(d)), inserted byte for byte from // plan/reports/ko-review-305.ftl.", followed by the two ids.

**ko-KR bundle**
- Under the existing "## The item pane's result lines (plan/00 §6 item 303(a), (b); docs/08 §3.2)" / "##" header, the three "## NEEDS REVIEW (G-41)…" lines and both `# NEEDS REVIEW` stubs were replaced.
- In their place: "# Korean drafted by the coordinator and reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item 305(d)).", a blank line, then the two messages exactly as in `plan/reports/ko-review-305.ftl`.

**`registerUI.ts`**: `collectionsOf: collectionsOfItem,` and `itemCollections,` in `itemSummaryDeps`. In `generate`: "// Regenerate's bypass (item 305(c)); Retry never sets it." followed by `...(bypassCache === true && { bypassCache: true })`. One row of the host table and the `itemSummaryDeps` doc comment were updated.

**`container.ts`**: "// The stricter of the global mode and the collection's override; with // an item's collections (item 305(a)), the strictest of them all.", followed by `loadStrictestPrivacyPolicy(deps.privacy, [...collection, ...(itemCollections ?? [])])`.

## DOC NOTES ADDED (quoted, abridged)
**docs/09 §3.5**, a new note: "**Decided 2026-10-29 (owner, `plan/00` §6 item 305(a)); built the same day: a one-item run takes the strictest mode of the item's collections.**" It says:
- The run uses the strictest of the global `privacy.mode` and the override of every collection the item belongs to.
- "Strictest" is the order of `PRIVACY_MODES` (strict, balanced, full), which `effectiveMode` already applies; `loadStrictestPrivacyPolicy` applies it over the item's collections.
- It fails closed.
- The collections come from `collectionsOfItem` (`getCollections()`, collections not in the trash); if they cannot be read, the run stops before anything is sent.
- They reach the job through `QueuedPipelineJobOptions.itemCollections`.
- It "replaces, for that run only, item 278(c)'s 'a job over no collection follows the global privacy mode'".

**docs/08 §3.2**
- Inline marks in the item-303 note:
  - "*(superseded — Decided 2026-10-29 (owner, `plan/00` §6 item 305(a)): the strictest of the global mode and the override of every collection the item belongs to; see the note below)*"
  - "*(Decided 2026-10-29 (owner, `plan/00` §6 item 305(b)): kept as built — see the note below)*"
  - "*(Decided 2026-10-29 (owner, `plan/00` §6 item 305(c)): Regenerate also bypasses the stored result; Retry does not — see the note below.)*"
- A new note, "**Decided 2026-10-29 (owner, `plan/00` §6 item 305(a)–(c)); built the same day.**", with three bullets:
  - (a) Privacy, with `ItemSummaryDeps.collectionsOf`.
  - (b) "Kept as built: a one-item run asks the cost question every time it will make a call… `plan/reports/followup-303-304.md` finding 2 raised that the owner may find this heavy; the owner keeps asking every time. No behaviour changed."
  - (c) Regenerate's `bypassCache` path. It replaces the row (same id, `workKey:promptVersion:modelId`) and the cache entry (same key). Retry and Generate keep their rules. A summary note already saved from the old row is not rewritten.

**docs/07**
- §12.3: an inline "superseded for the item pane's run" mark, and a new note, "**Decided 2026-10-29 (owner, `plan/00` §6 item 305(a), (c)); built the same day: the item run's privacy mode, and Regenerate's bypass.**" How the bypass is keyed:
  - It is read in one place, `bypassesStoredResult`.
  - That returns true only for `bypassCache` on a run with an item list, no collection and `resummarize` on; `validate` reports it on any other run.
  - Under it, the planning step's cache check counts nothing as cached, and `summarizeItem` skips the cache lookup on the abstract, single-shot and chunked paths.
  - The answer is stored under the same cache key (overwriting the entry and its `ignoreModel` pointer) and the same row id.
  - It lives only in the run's own input: "not a preference, not a cache flag and not shared state".
  - Only Regenerate sets it; Retry and the collection run's "Re-summarize existing" are unchanged.
- §4.5's `privacy` bullet: an inline Decided-305(a) mark naming `itemCollections` and `loadStrictestPrivacyPolicy`.

**docs/06 §11.2**: "**Decided 2026-10-29 (owner, `plan/00` §6 item 305(c)): the item pane's Regenerate bypasses the lookup, never the key.**"

**plan/04 P3-T28**: "**Decided 2026-10-29 (owner, `plan/00` §6 item 305(a)–(d)); built the same day, State stays `TODO`.**" It names the declarations above.

## NEW STRINGS
None. Two existing ids gained Korean, byte for byte from `ko-review-305.ftl`:
- `research-helper-itempane-not-summarized` (keys no-text, retracted, language, existing, no-key, time-limit, *other)
- `research-helper-itempane-note-not-written` (keys read-only, *exists)

The check script said "2 approved entries checked; 0 problems": the blocks are identical, no stub is left, there are no carriage returns, and the variables match.

## RUNS
- `npm run typecheck`: exit 0. `npm run lint:check`: exit 0. `npx eslint .`: exit 0.
- `npm run test`: unit 96 files, 4541 passed; contract 84 passed, 28 skipped.
- `npm run build`: passes. The five `typings/*.d.ts` hashes are identical before and after, so `i10n.d.ts` did not change.
- `index:derive`, twice: hash `2cb86d47…` both times, the same as before I started.
- **Mutants:** 9, each marked `/* MUTANT */`, restored by copy and confirmed by hash. All 9 were killed:
  - M1: privacy rule reads only the first collection (3 tests fail)
  - M2: an override may loosen the mode (3)
  - M3: `openJob` ignores `itemCollections` (1)
  - M4: `runItemSummary` opens its jobs with no collections (2)
  - M5: `bypassesStoredResult` returns `input.resummarize`, so the bypass leaks to Retry and the collection run (5). This one shows the bypass happens only for Regenerate.
  - M6: the planning step's cache check ignores the bypass (1)
  - M7: `summarizeItem` ignores the bypass (1)
  - M8: Retry asks for the bypass (1)
  - M9: Regenerate does not ask for it (1)
  - The `MUTANT` search is empty at the end.
- **Integration**, `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`. Before every run the `MUTANT` search was empty and `Get-CimInstance` by process name found 0 `zotero.exe` with `.scaffold\test\profile`; nothing was killed.
  - Run 1: 222 passed. Run 2: 222 passed. Run 3: 222 passed. That is one more than before: the new 305(a) test.
  - The P1-T44 badge test passed in all three runs (run 3 log: "[P1-T44] badge: l10n=research-helper-prefs-backend-windows text=…").
  - l10n spec, each run: `[P1-T18] ko-KR totals: 293 present, 1 absent; expected 293 / 1`. Before this work it was 291 / 3; the 1 absent is the id kept absent on purpose.
  - P3-T28 lines as before: "cost dialog: acknowledgement not asked" (twice) and "host.onError: … HTTP 429 from provider [redacted:49]".

## FINDINGS
1. **"The item's collections" means collections not in the trash.** `Zotero.Item.getCollections()` is called with no argument. A strict collection that sits in the trash does not tighten the mode. Counting trashed collections would be the more cautious choice; that is for the owner to decide.
2. **Regenerate replaces only the row with the same id** (`workKey:promptVersion:modelId`). A row made earlier by a different model or prompt version stays, as it would after any run. The pane shows the newest row.
3. **The new row from Regenerate does not carry the old `zoteroNoteKey`.** This is the existing behaviour of any fresh row. Save as child note then finds the existing note by its tag and still writes no second note. The existing note keeps the old text; Regenerate writes no note.
4. **There are two guards on the bypass.** `runItemSummary` sets `bypassCache` only when Regenerate is pressed, and `bypassesStoredResult` also requires `resummarize`. A mutant that drops the first guard therefore survives, because the second one still holds. I did not count it.
5. **`KO_PENDING_REVIEW` is empty again;** that list is allowed to be empty.

## WHAT I DID NOT CHECK
- **Regenerate in real Zotero:** the real call, the dialog and the row replacement. These are checked by unit tests and mutants M5–M7 and M9 only. The integration test asserts only that Generate and Retry carry no bypass.
- **A full one-item run in Zotero inside a strict collection.** The integration test checks `collectionsOfItem` and the job's privacy mode, not a full Generate inside such a collection.
- **Trashed collections and group libraries** for `collectionsOfItem`.
- **The Korean lines rendering on screen.** Only the bundle and the l10n spec totals are checked.
- **Any live model or network call.**

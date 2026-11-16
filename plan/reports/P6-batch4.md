# Phase 6, batch 4 — Part 0 and cards P6-T16, P6-T17, P6-T18

**Date:** 2026-11-17 · **Executor:** Claude Code (agent), under the coordinator's brief of 2026-11-17 ·
**Commit base:** 322cd60. Nothing is committed or pushed; the coordinator reviews and commits. No card is set to
`DONE`. Every card's State stays `TODO` with a dated "built, awaiting the owner's review" note. `P6-T04` and
`P6-T19` were not touched.

## Summary

| Card | Outcome | Report |
|---|---|---|
| Part 0 | Item 384 decided and built in `P6-T17`; the `docs/07` §4.5 dollar figures restored from a recorded source | this file |
| `P6-T16` | Done, awaiting the owner's review; one owner question (`plan/00` §6 item 385) | `plan/reports/P6-T16.md` |
| `P6-T17` | Done, awaiting the owner's review; fifteen Korean drafts for `G-41` | `plan/reports/P6-T17.md` |
| `P6-T18` | Built and passing on stand-ins; stays open until `P6-T04` has run (the card's own note) | `plan/reports/P6-T18.md` |

## Part 0

- **Item 384 (the cost dialog's window did not draw the tier question).** Recorded as "DECIDED 2026-11-17
  (coordinator, under item 313)".
  - `addon/content/costConfirm.{js,xhtml}` were added to `P6-T17`'s Files, and the radio group was built there.
  - `P6-T17` was re-estimated 1.75 → 2.0 d. Phase 6 is now 20.25 d over 19 cards.
  - The re-estimate was carried to `plan/README` §7's sites: `plan/00` (header and item 384), `plan/05` §0,
    `plan/09` (`P6-T17`'s Estimate and Do step 5 note) and `docs/11` (the sums).
- **`docs/07` §4.5's lost dollar amounts.** A shell expansion in commit `8dbad15` had eaten them.
  - They were restored from item 311's own report, `plan/reports/followup-311.md`, which agrees with item 309(b)'s
    note.
  - The paragraph carries a dated correction note citing that source. No figure was recomputed.

## P6-T16 — Audio pipeline: stages, job, wiring

- **Built.**
  - **In `src/pipeline/audioReport/audioReportPipeline.ts` (new):** `createAudioReportPipeline`.
    - `prepare` refuses, in order: `disabled`, `no-report`, a read-only library or a missing collection, a refused
      tier, a missing key.
    - `execute` handles the script, the second confirmation, synthesis, delivery and the key.
    - `audioJobInput`, and a `beforeSend` hook that refuses any request whose record carries no egress log.
    - `voices()`, for `P6-T17`'s window.
  - **In `ReportStore`:** `latestForCollection` and `companionOf` (`src/zotero/db.ts`, forwarded by
    `src/bootstrap/pluginDatabase.ts`).
  - **The construction:** in `buildPipelineSet`, with `createZoteroAudioLibrary`. `container.ts` passes the TTS
    client, the key reader and the overrides.
  - **Documents:** `docs/07` §12.6's note.
- **Tests and mutants.** 42 tests in `audioReportPipeline.test.ts`. 37 of 37 mutants killed, three only after four
  tests were added.
- **Integration.** 357, 357 and 357 passed. That was before `voices()` was added; `P6-T17`'s runs below cover it.
- **Findings.**
  1. After a restart `recover()` marks the job `failed`, not `cancelled` as decided on 2026-11-16 (not a card).
  2. With `tts.model` empty, the model list is read before the confirmation: item 385, with a draft that is not
     adopted.
  3. `PipelineContext.tts` stays `undefined`.
  4. `pluginDatabase.ts` was outside the Files row.

## P6-T17 — Report window audio section and menu entry

- **Built.**
  - **The view model's section 8**, in `src/ui/viewModels/reportViewModel.ts`: `reduceAudioSection`,
    `buildAudioSectionModel` and `windowAudioModel`.
  - **In the session (`createReportWindowSession`):** `audioDescribe`, `setAudioLanguage` / `setAudioVoice`,
    `startAudio` / `cancelAudio` and the two saves.
    - The folder dialog is reached through the sink.
    - The attachment title is localised.
    - The report and audio runs exclude each other.
  - **The window's `#rh-audio` section.**
  - **"Generate Audio Report…"**, right after the report entry (`audioReportItems`), behind `audio.enabled`.
  - **The cost dialog's tier radio group** (`logic.tierAnswerFor`).
  - **Strings:** 15 new ones.
  - **Documents:** `docs/08` §6.4's note.
- **Tests and mutants.**
  - 20 view model and menu tests, 1 key test, 1 dialog test, and 1 integration test.
  - 43 mutants in the first sweep: 37 killed, 1 not applied, 5 survived. One survivor was killed by an added test,
    and the four equivalent guards were removed.
  - 7 in the second sweep, all killed.
- **Integration.** The first run failed on `P4-T19`'s menulist count, which the new section's two menulists broke.
  The test was fixed. Then three clean runs: 358, 358 and 358 passed.
- **Findings.**
  1. That test fix.
  2. `audioReportPipeline.ts` and `costConfirmDialog.test.ts` were outside the Files row.
  3. The four removed guards.
  4. The build warns "missing in locale: ko-KR" for the seven ids the markup names, as expected while they are
     drafts.

## P6-T18 — Offline end to end on recorded answers

- **Built.** `test/unit/pipeline/audioEndToEnd.test.ts`, 8 tests, 8 passed in each of three runs in a row.
  - **What runs for real:** the shipped pipeline, `createGeminiTts` over the real `HttpClient`, and the real audio
    store.
  - **What is replaced:** the transport (it replays the fixtures and counts each request), a router stand-in (the
    recorded scripts) and a fake attachment write. `fetch` and `XMLHttpRequest` throw.
- **Steps 1–5 pass on stand-ins.** The test reads all 8 sidecars, and each says `"synthetic": true`, so the card
  stays open for `P6-T04`.
- **The `docs/13` §8.6 map** is in `plan/reports/P6-T18.md`. Eight lines are proved offline in part or in whole, and
  all nine need `P6-T19`.
- **Finding (not a card).** The run's output does not carry `sourceLanguage`. Step 2 shows it another way, and
  adding the field is outside the Files row.

## Owner questions

1. **Item 385 (`P6-T16`).** Accept the model-list read before the first confirmation, as built, or price that
   confirmation with `tts.model` or the fallback and resolve after it?
2. **`P6-T16` finding 1.** Keep `failed` for an audio job the app quit during, or make it `cancelled`?
3. **Korean (`G-41`).** All of Phase 6's new strings are commented ko-KR drafts, marked "not adopted":
   - `rh-error-tts` (`P6-T14`);
   - `P6-T15`'s thirteen:
     - `research-helper-egress-audio-notice`;
     - `research-helper-cost-audio-script`;
     - `research-helper-cost-audio-provisional`;
     - `research-helper-cost-audio-length`;
     - `research-helper-cost-audio-length-warning`;
     - `research-helper-cost-audio-duration`;
     - `research-helper-cost-audio-attach`;
     - `research-helper-cost-audio-rate-unmeasured`;
     - `research-helper-cost-audio-tier-question`;
     - `research-helper-cost-audio-tier-paid`;
     - `research-helper-cost-audio-tier-free`;
     - `research-helper-cost-audio-tier-unknown`;
     - `research-helper-audio-tier-refused`.
   - `P6-T17`'s fifteen:
     - `research-helper-menu-collection-audio-report`;
     - `research-helper-audio-attachment-title`;
     - `research-helper-report-audio-heading`;
     - `research-helper-report-audio-language-label`;
     - `research-helper-report-audio-voice-label`;
     - `research-helper-report-audio-none`;
     - `research-helper-report-audio-source`;
     - `research-helper-report-audio-generate`;
     - `research-helper-report-audio-cancel`;
     - `research-helper-report-audio-stage`;
     - `research-helper-report-audio-outcome`;
     - `research-helper-report-audio-refused`;
     - `research-helper-report-audio-save-script`;
     - `research-helper-report-audio-save-audio`;
     - `research-helper-report-audio-saved`.

## Checks, after the last edit

- `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.
- `npm run test`:
  - Unit: 152 files, 8,187 passed, 105 skipped. Batch 3 ended at 150 files and 8,115 passed.
  - Contract: 7 files, 93 passed, 28 skipped (unchanged).
- `npm run build` finished.
- **Typings hashes, from the start of the batch to its end:**
  - `i10n` changed `b13a8e6d` → `f1bed3dc`, for `P6-T17`'s fifteen ids;
  - `global` stayed `020956c7`, `prefs` `7addedf1`, `prompts` `4480d796` and `zotero-augment` `cf994969`.
- `npm run index:derive`, run after the last plan edit, reports 270 tasks: 112 DONE, 158 TODO.
- The `/* MUTANT` and `.only(` greps over `src`, `test` and `scripts` are empty, and the tree holds no PDF outside
  `node_modules`.

## Integration runs

- **`P6-T16`:** 357, 357 and 357 passed. `P6-T17`'s runs cover the whole tree since.
- **`P6-T17`:** one run failed before the test fix (357 passed, 1 failed). After the fix, three in a row: 358, 358
  and 358 passed.
  - Before each run, the case-sensitive `/* MUTANT` grep over `src`, `test` and `scripts` was empty, and no
    `zotero.exe` was running.
  - Nothing was built into `.scaffold/build` during a run.
- **`P6-T18`:** none needed. It is one unit test file, and nothing that runs inside Zotero changed.

## Final state of the tree

- **Modified:**
  - `docs/07`, `docs/08` and `docs/11`;
  - `plan/00`, `plan/05` and `plan/09`;
  - the four locale files (en-US and ko-KR, main and report window);
  - `addon/content/costConfirm.{js,xhtml}` and `reportWindow.{js,xhtml}`;
  - in `src/`: `bootstrap/container.ts`, `pluginDatabase.ts`, `registerPipelines.ts` and `registerUI.ts`;
    `core/secretStore.ts`; `i18n/keys.ts`; `pipeline/registry.ts`; `ui/menus/registerMenus.ts`;
    `ui/panes/reportWindow.ts`; `ui/viewModels/reportViewModel.ts`; `zotero/db.ts`;
  - `test/integration/menus.spec.ts`, `test/unit/i18n/keys.test.ts`, `test/unit/ui/costConfirmDialog.test.ts` and
    `test/unit/ui/reportViewModel.test.ts`;
  - `typings/i10n.d.ts`.
- **New:**
  - `src/pipeline/audioReport/audioReportPipeline.ts`;
  - `test/unit/pipeline/audioReportPipeline.test.ts` and `audioEndToEnd.test.ts`;
  - `plan/reports/P6-T16.md`, `P6-T17.md`, `P6-T18.md` and this file.
- **Clean:**
  - The `/* MUTANT` and `.only(` greps over `src`, `test` and `scripts` are empty.
  - No key was read; every command ran with `OPENROUTER_API_KEY` removed.
  - No live, keyed or paid path was run.
  - No user-chosen path is logged.
  - There is no PDF in the tree.
- **`audio.enabled` stays off** (default `false`) until `P6-T19`.

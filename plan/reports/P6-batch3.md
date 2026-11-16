# Phase 6, batch 3 — Part 0 and cards P6-T07, P6-T08, P6-T10, P6-T14, P6-T15

**Date:** 2026-11-17 · **Executor:** Claude Code (agent), under the coordinator's brief of 2026-11-17 ·
**Commit base:** ef9caf4. Nothing is committed or pushed; the coordinator reviews and commits. No card is set to
`DONE`. Every card's State stays `TODO` with a dated "built, awaiting the owner's review" note. The two prompt
files' move from `src/prompts/pending/` was made with `git mv`, so it shows as a staged rename.

## Summary

| Card | Outcome | Report |
|---|---|---|
| Part 0 | Items 382 and 383 recorded and built | `plan/reports/P6-T06.md` (addendum) |
| `P6-T07` | Done, awaiting the owner's review | `plan/reports/P6-T07.md` |
| `P6-T08` | Done, awaiting the owner's review | `plan/reports/P6-T08.md` |
| `P6-T10` | Done, awaiting the owner's review | `plan/reports/P6-T10.md` |
| `P6-T14` | Done, awaiting the owner's review; the Korean of one message waits for `G-41` | `plan/reports/P6-T14.md` |
| `P6-T15` | Done in the dialog's model, awaiting the owner's review; one owner question (`plan/00` §6 item 384) and thirteen Korean drafts for `G-41` | `plan/reports/P6-T15.md` |

No estimate changed, so `plan/README` §7's five sites were not touched. `npm run index:derive`, run after the plan
edits, reports 270 tasks: 112 DONE, 158 TODO, and changes only the header's date and §6.

## Part 0

- **Item 382 (owner).** The reworded `AUDIO_SCRIPT_EN` rule 11 and `AUDIO_SCRIPT_KO` rule 12 were adopted word for
  word.
  - The two files moved from `src/prompts/pending/` into `src/prompts/` and were registered.
  - The refusal tests became load tests.
  - The card note and the addendum to `plan/reports/P6-T06.md` were written.
- **Item 383.** Recorded as "DECIDED 2026-11-17 (coordinator, under item 313)": Option A, as built. A group-library
  report whose WAV would be over 10 MiB is refused before synthesis. Option B is a later-release candidate.
- **Integration.** Three clean runs: 357, 357 and 357 passed.

## P6-T07 — Script pass

- **Built.** `src/pipeline/audioReport/script.ts` (`writeScript`, the validation and the target) and
  `citationMap.ts`.
- **Tests and mutants.** 36 tests in `audioScript.test.ts`, shared with `P6-T08`. One sweep for both cards:
  36 of 37 killed, and the survivor is equivalent.
- **Finding (not a card).** The card names `targetWordsForOutput` for the report's target. That function converts
  an output ceiling into words; the report's own target is `resolveTargetWords` (`reportTargetWordsOf`).

## P6-T08 — Korean script

- **Built.** `resolveAudioLanguage`, `chooseScriptSource` and `isSameRun`, and `src/pipeline/audioReport/korean.ts`.
- **Tests.** 5 in `audioKorean.test.ts` and 6 in `audioScript.test.ts`.
- **Finding (not a card).** No link between a `both` run's two records is stored, only the shared instant, and
  `ReportStore` has no lookup by collection. So `P6-T16`, which owns `db.ts`, finds the companion record.

## P6-T10 — TTS prices and the two-step estimate

- **Built.** `src/tts/pricing.ts` and `src/pipeline/audioReport/estimate.ts`. The `estimateChunk` stand-in in
  `synthesize.ts` is replaced by `SynthesisDeps.prices`.
- **Tests and mutants.** 6, 13 and 1 tests; 27 of 27 mutants killed.
- **Findings.**
  - **For `P6-T16` (not a card):** the group-library pre-check should test the estimate with headroom. The
    import-or-link preview is computed from the unpadded figure.
  - **Settled here:** `P6-T05`'s grep criterion now reads "outside the marked price rows".

## P6-T14 — Failure paths

- **Built.**
  - **In `src/core/errors.ts`:** `TTS_ERROR_REASONS` and `TTSError.reason`.
  - **In `src/pipeline/audioReport/failures.ts`:** `classifyAudioFailure`, `saveScriptAsText`, `saveAudioAs` and
    `withAudioScript`.
  - **The message:** `rh-error-tts`, with one variant per reason. It left the deferred list.
- **Tests and mutants.** 17 tests plus one in `keys.test.ts`. 21 mutants: 19 killed, 2 equivalent.
- **Integration.** 357, 357 and 357 passed. One caveat about run 3: while it was executing, a production build was
  written to `.scaffold/build`. `P6-T15`'s runs below cover the whole tree again.
- **Finding.** None.

## P6-T15 — Audio confirmation, tier question and disclosure

- **Built.**
  - **In `src/pipeline/audioReport/disclosure.ts`:** the tier, the strict refusal, the key fingerprint and the
    notice.
  - **In `egressDisclosure.ts`:** the `audio` members and the reason `first-audio-key`.
  - **In `costConfirmDialog.ts`:** `buildAudioDialogModel` and `tierQuestion`.
  - **Strings:** thirteen new ones.
  - **Documents:** `docs/07` §4.5 and §8.5 notes.
- **Tests and mutants.** 27 + 13 + 1 tests; 45 of 45 mutants killed.
- **Findings.**
  - **Item 384:** the dialog's window does not render the tier question, and no card owns it.
  - **For `P6-T16` and `P6-T17` (not a card):** show the refusal with its own id, and pass the stored audio jobs
    for the first-use lookup.
  - **A defect in `docs/07` §4.5 that predates this batch:** dollar amounts were lost to a shell expansion.

## Owner questions

1. **Item 384:** add `addon/content/costConfirm.js` and `costConfirm.xhtml` to `P6-T17`'s Files, as drafted, or
   create a new card of 0.25 d?
2. **Korean (`G-41`).** `rh-error-tts` (`P6-T14`) and `P6-T15`'s thirteen strings are commented ko-KR stubs with the
   coordinator's drafts, marked "not adopted".

## Checks, after the last edit

- `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.
- `npm run test`:
  - Unit: 150 files, 8,115 passed, 105 skipped. Batch 2 ended at 144 files and 7,995 passed.
  - Contract: 7 files, 93 passed, 28 skipped (unchanged).
- `npm run build` finished.
- **Typings hashes, from the start of the batch to its end:**
  - `i10n` changed, `a787e3c9` → `a8188138` → `b13a8e6d` (`P6-T14` then `P6-T15`);
  - `global` stayed `020956c7`, `prefs` `7addedf1`, `prompts` `4480d796` and `zotero-augment` `cf994969`.
- **Integration after `P6-T15`.** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration --
  --exit-on-finish` was run three times in a row. Before each run, the case-sensitive `/* MUTANT` grep over
  `src`, `test` and `scripts` was empty and no `zotero.exe` was running:
  - run 1: 357 passed, 0 failing;
  - run 2: 357 passed, 0 failing;
  - run 3: 357 passed, 0 failing.

## Final state of the tree

- **Modified:**
  - `docs/04`, `docs/07`, `docs/12` and `docs/13`;
  - `plan/00` (items 382–384 and the derived header) and `plan/09` (State cells, Findings, dated notes);
  - `plan/reports/P6-T06.md` (addendum);
  - both main-window locale files;
  - `scripts/record-fixtures.ts`;
  - in `src/`: `core/errors.ts`, `i18n/keys.ts`, `pipeline/audioReport/synthesize.ts`,
    `pipeline/shared/egressDisclosure.ts`, `prompts/bundled.ts`, `prompts/index.ts` and
    `ui/dialogs/costConfirmDialog.ts`;
  - the tests that cover them;
  - `typings/i10n.d.ts`.
- **New:**
  - `plan/reports/P6-T07.md`, `P6-T08.md`, `P6-T10.md`, `P6-T14.md`, `P6-T15.md` and this file;
  - in `src/pipeline/audioReport/`: `citationMap.ts`, `disclosure.ts`, `estimate.ts`, `failures.ts`, `korean.ts`
    and `script.ts`;
  - `src/tts/pricing.ts`;
  - their six test files.
- **Not started:** `P6-T16` and later.
- **Clean:**
  - The `/* MUTANT` and `.only(` greps over `src`, `test` and `scripts` are empty.
  - No key was read; every command ran with `OPENROUTER_API_KEY` removed.
  - No live, keyed or paid path was run.
  - No user-chosen path is logged.
  - There is no PDF in the tree.

# Phase 6, batch 1 — Part 0 and cards P6-T01, P6-T02, P6-T03, P6-T06

**Date:** 2026-11-16 · **Executor:** Claude Code (agent), under the coordinator's brief of 2026-11-16 ·
**Commit base:** 678c50f. Nothing is committed or pushed; the coordinator reviews and commits. No card is set to
`DONE`. Every card's State stays `TODO` with a dated note, because `scripts/derive-task-index.ts` cannot read
`IN PROGRESS`.

## Summary

| Card | Outcome | Report |
|---|---|---|
| Part 0 | The owner's decisions on `plan/10` §0.4 lines 18–23, recorded as `plan/00` §6 item 381 | this file, below |
| `P6-T01` | Done, awaiting the owner's review | `plan/reports/P6-T01.md` |
| `P6-T02` | Done, awaiting the owner's review | `plan/reports/P6-T02.md` |
| `P6-T03` | Done, awaiting the owner's review | `plan/reports/P6-T03.md` |
| `P6-T06` | **Blocked at an owner decision** (`plan/00` §6 item 382), built as far as allowed without it | `plan/reports/P6-T06.md` |

`npm run index:derive`, run last, reports 270 tasks: 112 DONE, 158 TODO (P6: 19 rows, P7: 32 rows).

**Blocking:** one item. `P6-T06`'s two prompts cannot load as `docs/12` §13–§14 print them, because each system
prompt holds `{{TARGET_MINUTES}}` and the registry refuses any placeholder in a system text (`docs/12` §1.1 rule 2).
The owner kept that rule for `THEME_CLUSTER` (item 290(b)), and the Korean wording is the owner's. A draft of one
sentence for each prompt is in `docs/12` §13's note of this date. This holds up `P6-T07` and `P6-T08`.

## Part 0 — the owner's 2026-11-16 decisions (`plan/00` §6 item 381)

Every line of `plan/10` §0.4 from 18 to 23 is closed, and each answer is recorded as "DECIDED 2026-11-16 (owner,
`plan/00` §6 item 381)".

- **(a) Line 18, the scheduled live-contract job: deferred.** `docs/13` §8.9's line is waived for v1.0 ("no
  secret-holding job exists"); the 180-day fixture-age rule still applies. Carried by `P7-T24`.
- **(b) Line 19, the update hash.** A CI-generated `sha512:` hash meets `docs/09` §7. Its wording now reads "a
  CI-generated sha256 or sha512 hash", with a dated note. `P7-T16` and `P7-T21` no longer stop on it.
- **(c) Line 20, Gemini chat in balanced mode: warn and confirm.** Recorded in `docs/09` §3.5, which notes that
  the rule is not built yet. The rule is carded as **`P7-T32`** (0.75 d, ungated, blocks `P7-T16`).
- **(d) Line 21, PDF-extraction quality at scale: not in v1.0.** The README's known-limitations section states it
  (`P7-T19`).
- **(e) Line 22: `P3-T31` without `P3-T37`.** The dependency edge is dropped, with dated notes on both cards in
  `plan/04`.
- **(f) Line 23: `autoSummarize` stays off and hidden.** Recorded in `docs/09` §7 and `docs/07` §8.5. Carried by
  `P7-T08` and `P7-T16`.
- **(g) Estimate.** Phase 7 is now 32 cards at 29.25–41 d (it was 28.50–40). The change is propagated to the five
  sites `plan/README` §7 lists:
  - `plan/10`;
  - `docs/11`: total 225.25–316 d over 270 cards, critical path 157.00–220;
  - `plan/00` §1;
  - `plan/05`;
  - `plan/00` §4, through `index:derive`.

## P6-T01 — Phase 6 types, files and audio states in `docs/07`

- **Built.**
  - `src/model/audio.ts` (new, types only).
  - `src/tts/types.ts`, extended with `TTSProvider` and `AudioArtifact.usage`; every spike export is kept.
  - `docs/07` §2.2, §4.4, §5.2, §6.5, §7.4 and §12.4, and a new §12.6 for the audio job's state machine, each with
    a dated note.
  - `docs/11`'s list of Phase 6 modules.
- **Tests.** None added: the card is types only, as its Notes say.
- **Checks.**
  - typecheck, lint and eslint exit 0.
  - Unit: 7,808 passed, 105 skipped. Contract: 84 passed, 28 skipped.
  - Build finished; the typings did not change.
  - No integration run: types and documents only.
- **Decisions (7).**
  - `maxInputChars` takes the language.
  - `resolveModel` is added to the interface.
  - The attachment modes are `"imported" | "linked"`.
  - `scriptUsage` sits beside `usage`.
  - `language` may be `"auto"`.
  - The validated script is stored before the second confirmation.
  - The first confirmation is drawn in `Queued`.
- **Findings (3, none carded).**
  - `src/pipeline/types.ts` still declares `TTSProvider` as an alias of `unknown`.
  - `docs/13` §2.1 still names `src/tts/ssml.ts`.
  - The index generator cannot read `IN PROGRESS`.

## P6-T02 — the preference rows Phase 6 reads

- **Built.**
  - `docs/07` §8.5 first:
    - `tts.provider` is struck in place;
    - `tts.outputFormat` allows `wav` only;
    - the ⚠ marks on `tts.language` and `tts.linkedFileDir` are cleared;
    - two new rows: `gemini.tierAnswer` and the hidden `audio.enabled`.
  - `PREFS` (`src/prefs/schema.ts`) and `PREF_KEYS` (`src/prefs/keys.ts`) gain eight rows.
  - `addon/prefs.js` gains four `pref()` lines, the rows `docs/01` §7.2 lists.
  - `typings/prefs.d.ts` was regenerated with those four keys.
- **Tests.** `test/unit/prefs/schema.test.ts` now counts 81 rows (it was 73). New tests cover each row's
  bounds and values, that `tts.provider` is absent from all three places, that no Phase 6 row is bound in the
  pane, and the D5 checks.
- **Checks.**
  - typecheck, lint and eslint exit 0.
  - `test:unit -- prefs`: 205 passed. Unit: 7,827 passed. Contract: 84 passed.
  - Build finished. The prefs typings hash went from a9aa2d93 to 7addedf1; the others did not change.
  - **Integration: three consecutive runs, 355 passed each.** Before each run the `/* MUTANT` grep was empty and
    no test-profile Zotero was running.
- **Decisions (5).**
  - `gemini.tierAnswer` sits under "LLM providers & models".
  - `tts.provider` is struck, not deleted.
  - `tts.targetMinutes` is `min` 0, `max` 60.
  - `tts.voice` has no closed list of values.
  - The pane cells of the voice and output-format rows are struck.
- **Findings (2, none carded).**
  - `docs/01` §7.2's comments on `tts.outputFormat` and `tts.model` are stale.
  - The prefs typings gained the four keys, as expected.

## P6-T03 — the recorder's Gemini TTS path and synthetic stand-ins

- **Built.**
  - **A `gemini-tts` source in `scripts/record-fixtures.ts`.**
    - It has seven scenarios (`TTS_SCENARIOS`) and sits behind `FIXTURE_MODE=record`, `--live` and
      `--confirm-spend-usd`.
    - The key is read through `LLM_KEY_ENV_VARS` alone and sent only as the `x-goog-api-key` header.
    - The model list is fetched first, and the run stops before any billed call if the model is not listed.
  - **Redaction.** It shields only the audio's base64, and refuses `x-goog-api-key`, `key=`, the key's value and
    any body over 300 KB.
  - **`--dry-run`** exits 0 without a key. It states 5 live requests, 2 billed, at most $0.0154 on
    `gemini-2.5-flash-preview-tts`.
  - **Two script scenarios on the LLM path** (`audio-script-en`, `audio-script-ko`). They are named only with
    `--only`, and stay pending until their prompts load.
  - **Stand-ins.** Generated stand-ins with `"synthetic": true` sidecars, in `test/fixtures/tts/gemini/` and, for
    the scripts, in `test/fixtures/llm/openrouter/`. A synthetic run never writes over a recording.
  - **`docs/13` §3.1.** A seven-row table and a dated note.
- **Tests.** `test/unit/scripts/recordFixturesRedaction.test.ts`: 54 tests in the file after this card, 55 after
  `P6-T06`.
  - Two mutants were each caught by 2 tests and reverted: the `key=` refusal, and the guard that keeps stand-ins
    off recordings.
- **Checks.**
  - typecheck, lint and eslint exit 0.
  - Unit: 7,845 passed. Contract: 84 passed.
  - Build finished; the typings did not change.
  - No integration run: only scripts, tests, fixtures and documents changed.
  - A grep of the new fixtures for `x-goog-api-key`, `key=` and `Bearer` is empty.
- **Decisions (9).**
  - The fixtures are keyed by scenario name.
  - The model list is unpaged and kept to its TTS entries.
  - The script scenarios are kept out of `LLM_SCENARIOS`.
  - The script stand-ins are written for OpenRouter only.
  - Each billed call is priced at 30 seconds of audio.
  - A synthetic run never writes over a recording.
  - The `_llmContract.ts` edit, outside `Files`.
  - `key=` is refused anywhere in a fixture.
  - The dropped key header is named "[the key header]" in sidecars.
- **Findings (2, none carded).**
  - `docs/13` §2.1's `ssml.ts` row is still there.
  - §3.1's mention of `src/tts/audio.ts` is now struck.

## P6-T06 — the `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` prompt files (blocked)

- **Built.**
  - **The two prompt files.** Copied verbatim from `docs/12` by a script and held unregistered in
    `src/prompts/pending/`. They are not in `PROMPT_IDS` or `bundled.ts`. Registering a file that cannot load
    would make the whole registry throw.
  - **Why `pending/`.** Eight pipeline test files load every `.md` directly in `src/prompts/`.
  - **Front matter.** Version 1.0.0, temperature 0.4, ceilings 2,500 and 3,500 tokens, `schema: none`,
    `outputFormat: text`.
  - **Documents.** Notes in `docs/12` §13 and §14 (with the draft wording for the owner), `plan/00` §6 item 382,
    and an addition to `docs/13` §3.1's note (d).
  - **The recorder.** A script scenario now counts as ready only when its file loads (`audioScriptPrompt`).
- **Tests.**
  - `test/unit/prompts/registry.test.ts`, 9 new tests:
    - each file is verbatim against `docs/12`; the test was checked with a one-word mutant;
    - the front matter is exact;
    - the parser refuses each file for exactly two reasons, the unregistered id and the placeholder;
    - `TARGET_MINUTES` is the only placeholder in each system text, and the user text holds every variable;
    - neither file is registered or bundled.
  - The recorder test has 1 test replaced and 1 added. The pending cases are covered, and the held files render
    into a correct request once a parser accepts them.
- **Checks.**
  - typecheck, lint and eslint exit 0.
  - `test:unit -- prompts` (with the recorder and `summarizeItem` tests): 205 passed.
  - Unit: 139 files, 7,855 passed, 105 skipped. Contract: 6 files, 84 passed, 28 skipped.
  - Build finished; no audio prompt is in the bundle, and the typings did not change (global 020956c7, i10n
    a787e3c9, prefs 7addedf1, prompts 4480d796, zotero-augment cf994969).
  - No integration run: the held files are not imported, and nothing that runs inside Zotero changed.
- **Decisions (6).**
  - The files are held verbatim and unregistered.
  - They sit in `pending/`.
  - `index.ts` and `bundled.ts` are not modified, though both are in `Files`.
  - The front matter values.
  - The recorder's "ready" means "the file loads".
  - The verbatim test is a block of its own.
- **Findings (2).**
  - The blocker, `plan/00` §6 item 382. The card's `Human gate` says "none", but in effect it has one.
  - The script scenarios' own dry run exits 2 while they are pending, by design. The `gemini-tts` dry run exits 0.

## Final state of the tree

- **Modified:**
  - `addon/prefs.js`;
  - `docs/07`, `docs/09`, `docs/11`, `docs/12` and `docs/13`;
  - `plan/00`, `plan/04`, `plan/05`, `plan/09` and `plan/10`;
  - `scripts/record-fixtures.ts`;
  - `src/prefs/keys.ts`, `src/prefs/schema.ts` and `src/tts/types.ts`;
  - `test/contract/llm/_llmContract.ts`;
  - `test/unit/prefs/schema.test.ts`, `test/unit/prompts/registry.test.ts` and
    `test/unit/scripts/recordFixturesRedaction.test.ts`;
  - `typings/prefs.d.ts`.
- **New:**
  - `plan/reports/P6-T01.md`, `P6-T02.md`, `P6-T03.md`, `P6-T06.md` and this file;
  - `src/model/audio.ts`;
  - `src/prompts/pending/audio-script-en.v1.0.0.md` and `audio-script-ko.v1.0.0.md`;
  - `test/fixtures/llm/openrouter/audio-script-{en,ko}.json` and their `_meta.json` sidecars;
  - `test/fixtures/tts/gemini/`, with 14 files.
- **Clean:** the `/* MUTANT` and `.only(` greps over `src`, `test` and `scripts` are empty. There is no PDF in the
  tree, and no key-shaped value in it. No key was read, and no live or paid path was run.

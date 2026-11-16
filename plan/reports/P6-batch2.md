# Phase 6, batch 2 — cards P6-T05, P6-T09, P6-T11, P6-T12, P6-T13

**Date:** 2026-11-16 · **Executor:** Claude Code (agent), under the coordinator's brief of 2026-11-16 ·
**Commit base:** 7d16009. Nothing is committed or pushed; the coordinator reviews and commits. No card is set to
`DONE`. Every card's State stays `TODO` with a dated "built, awaiting the owner's review" note.

## Summary

| Card | Outcome | Report |
|---|---|---|
| `P6-T05` | Done, awaiting the owner's review | `plan/reports/P6-T05.md` |
| `P6-T09` | Done, awaiting the owner's review | `plan/reports/P6-T09.md` |
| `P6-T11` | Done, awaiting the owner's review | `plan/reports/P6-T11.md` |
| `P6-T12` | Done, awaiting the owner's review | `plan/reports/P6-T12.md` |
| `P6-T13` | Done, awaiting the owner's review; one owner question that blocks no line (`plan/00` §6 item 383) | `plan/reports/P6-T13.md` |

No estimate changed. `npm run index:derive`, run after the plan edits, reports 270 tasks: 112 DONE, 158 TODO, with
no table change.

**Owner question (new): item 383.** Zotero accepts a linked file only in the personal library ("Linked files can
only be added to user library", `Zotero.Item.prototype._saveData` in `xpcom/data/item.js`). So a report in a
group library whose WAV is over 10 MiB cannot be linked.

- **As built (option A):** the run is refused before synthesis, so nothing is spent.
- **Option B:** import into the group whatever the size.

The draft recommends A. It is not adopted.

## P6-T05 — Gemini TTS client

- **Built.**
  - `src/tts/geminiTts.ts`, with `createGeminiTts`.
  - `readTtsModelList` in `src/llm/gemini/mapper.ts`.
  - Construction in `registerProviders`, returned as `LLMServices.tts`.
  - A comment fix in `src/model/audio.ts`, so the `src` grep finds one model ID.
  - `docs/07` §4.4's note.
- **Tests.** 46 unit and 9 contract tests. The four failure scenarios give four distinct class and reason pairs.
- **Mutants.** 10 of 10 killed.
- **Decisions (5).**
  - Every call is `singleAttempt`.
  - The failure reasons go in `TTSError.context.reason`, and HTTP answers through `mapProviderError`.
  - `resolveModel` follows a fixed order and falls back to one compiled-in ID.
  - `maxInputChars` gives 450 for any other language.
  - The secret ID is a constructor argument.
- **Findings.** None.

## P6-T09 — Chunker

- **Built.** `src/tts/chunk.ts`, with `chunkScript` and `splitSentences`. `docs/13` §2.1's `ssml.ts` row is
  corrected, which closes batch 1's finding.
- **Tests.** 27 tests on seeded 1,500-word English and 4,000-syllable Korean samples, plus a 300-round fuzz.
- **Mutants.** 10 of 10 killed.
- **Decisions (6).** Exact slices; a hard ceiling; the sentence-end rule; the order of cuts for an over-long
  sentence; Korean terminals with an English-only guard; the paragraph-gap pattern.
- **Findings.** None.

## P6-T11 — Synthesis loop

- **Built.**
  - `src/pipeline/audioReport/synthesize.ts`, with `synthesizeChunks` and `STYLE_PREFIX`.
  - `docs/04` §5.4's note.
- **Tests.** 18.
- **Mutants.** 10 of 10 killed.
- **Decisions (4).**
  - Prices are injected through `estimateChunk` until `ttsCostOf` exists.
  - The egress log is `P6-T16`'s; `beforeSend` is the per-call hook.
  - The result is a `done`/`stopped` union.
  - A change of sample rate is a `TTSError` with `reason: "sample-rate"`.
- **Findings (1, not carded).** Step 3 calls a timeout retryable, but owner item 230 does not retry timeouts. The
  loop follows item 230.

## P6-T12 — WAV assembly

- **Built.** In `src/tts/audioStore.ts`, every `P0-T26` export kept:
  - `silencePcm`, `wavHeader` and `concatPcm`;
  - `PcmChunk` and `CHUNK_SILENCE_MS`;
  - the optional `AudioFileSystem.appendFile`, which is `IOUtils.write(…, { mode: "append" })` as read in
    Zotero's `xpcom/http.js`;
  - `AudioStore.writeChunkedWav`, which writes the header and then appends.
- **Tests.** 24, in the file's first unit test.
- **Mutants.** 14 of 14 killed.
- **Decisions (4).**
  - Zotero's write appends, so no flat buffer is built there.
  - A stray WAV header is stripped by walking its sub-chunks.
  - Every check runs before the first write.
  - One shared format guard.
- **Findings.** None.

## P6-T13 — Delivery into Zotero

- **Step 1 finding.** A note cannot parent an attachment (`Zotero.Item.prototype._saveData`,
  `xpcom/data/item.js`). This is recorded in `docs/07` §6.5.
- **Built.**
  - `src/zotero/attachments.ts`, with `createZoteroAudioAttachments`.
  - `src/pipeline/audioReport/deliver.ts`, with `deliverAudio` and `checkAudioDestination`.
  - Standalone-attachment support in `audioStore.ts`: `attachStandalone`, `pathIn`, `chunkedWavByteLength`, and
    `key`/`itemKey`.
  - Two integration cases in `test/integration/zotero/attachments.spec.ts`.
- **Tests.** 24 unit tests.
- **Mutants.** 20 of 20 killed.
- **Decisions (10).**
  - A refusal is a returned value.
  - The mode comes from the assembled size.
  - A group link is refused (item 383).
  - The slug is capped so the whole stem fits 60 code points.
  - The slug keeps NFC.
  - The date is the local calendar date.
  - The written file is kept after a failure.
  - The title is English until `P6-T17` localises it.
  - Re-runs get `-2` to `-99`.
  - The folder rules.
- **Findings (1).** Item 383, above.

## Checks, after the last edit

- `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.
- `npm run test`:
  - Unit: 144 files, 7,995 passed, 105 skipped (batch 1 ended at 139 files and 7,855 passed).
  - Contract: 7 files, 93 passed, 28 skipped (it was 6 files and 84 passed).
- `npm run build` finished. **Typings hashes before and after are identical:** global 020956c7, i10n a787e3c9,
  prefs 7addedf1, prompts 4480d796, zotero-augment cf994969.
- **Integration.** `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`
  was run three times in a row, each with an empty case-sensitive `/* MUTANT` grep over `src`, `test` and
  `scripts`, and with no `zotero.exe` running:
  - run 1: 357 passed, 0 failing (355 before this batch, plus the two `P6-T13` cases);
  - run 2: 357 passed, 0 failing;
  - run 3: 357 passed, 0 failing.

## Final state of the tree

- **Modified:**
  - `docs/04`, `docs/07` and `docs/13`;
  - `plan/00` (item 383) and `plan/09` (State cells, Findings, two dated notes);
  - `src/bootstrap/registerProviders.ts`, `src/llm/gemini/mapper.ts`, `src/model/audio.ts` and
    `src/tts/audioStore.ts`;
  - `test/integration/zotero/attachments.spec.ts`.
- **New:**
  - `plan/reports/P6-T05.md`, `P6-T09.md`, `P6-T11.md`, `P6-T12.md`, `P6-T13.md` and this file;
  - `src/tts/geminiTts.ts`, `src/tts/chunk.ts`, `src/pipeline/audioReport/synthesize.ts`,
    `src/pipeline/audioReport/deliver.ts` and `src/zotero/attachments.ts`;
  - `test/unit/tts/geminiTts.test.ts`, `chunk.test.ts` and `audioStore.test.ts`;
  - `test/unit/pipeline/audioSynthesize.test.ts` and `audioDeliver.test.ts`;
  - `test/contract/tts/geminiTts.contract.test.ts`.
- **Not touched:** `P6-T07`, `P6-T08`, `P6-T10` and `src/prompts/pending/*`.
- **Clean:**
  - The `/* MUTANT` and `.only(` greps over `src`, `test` and `scripts` are empty.
  - No key was read, and no live or paid path was run.
  - No path chosen by a user is logged.
  - There is no PDF in the tree.

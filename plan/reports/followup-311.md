## VERDICT
All three decisions of item 311 and both stale comments are done. I wrote the documents first, then the code. No commit was made, the card States are still TODO, only the fake provider was used, and no key or secret was touched.

Every check passed:
- typecheck, `lint:check` and `npx eslint .` all exit 0.
- Unit tests: 4734 passed (was 4728). Contract tests: 84 passed, 28 skipped.
- Build passed.
- `index:derive` was run twice. Both runs give the same hash; the only change it makes is the header date moving to 2026-10-30.
- 12 of 12 mutants were killed.
- 3 of 3 integration runs passed with 226 tests each.
- The final `grep -rn MUTANT src test addon typings scripts` is empty.

## FILES CHANGED WITH DECLARATION NAMES
- **`src/pipeline/trendReport/compose.ts`**
  - New constant `STRUCTURE_INVALID_L10N`.
  - `StructureInvalidOutcome` gains `messageId: typeof STRUCTURE_INVALID_L10N`, and `composeReport` sets it.
  - Doc comments updated on the module header, `StructureInvalidOutcome` and `structureRevisionNote` (now "approved as drafted, item 311(b)").
  - New import of the type `MainWindowMessageId`.
- **`src/i18n/keys.ts`**: the new id is added to `MAIN_WINDOW_MESSAGE_IDS` and to `KO_PENDING_REVIEW`.
- **Both mainWindow `.ftl` bundles**: one block appended to each.
- **New prompt files** `src/prompts/trend-report-en.v1.0.1.md` and `trend-report-ko.v1.0.1.md`. The 1.0.0 files are untouched.
- **`src/prompts/index.ts`**: `PROMPT_FILE_NAMES` now points at the 1.0.1 files, with a comment saying why.
- **`src/prompts/bundled.ts`**: two new imports (`trendReportEnV101`, `trendReportKoV101`) and two new `PROMPT_SOURCE_FILES` entries. The 1.0.0 entries stay.
- **`src/llm/shared/chunking.ts`**: the module header and the doc comment of `packByTokens` are corrected.
- **Tests**:
  - `test/unit/pipeline/trendCompose.test.ts`: the prompts are now read through `PROMPT_FILE_NAMES`; the pinned figures 23_000, 26_000 and version "1.0.1" are updated; the stop test is rewritten; two new tests (a Korean second failure, and the bundle stub).
  - `test/unit/prompts/registry.test.ts`: versions and ceilings updated, plus a new describe block for the 1.0.1 PATCH with 4 tests.
  - `test/unit/pipeline/estimate.test.ts`: the docs/06 §5.2 table regex now skips a struck-out figure; the ceilings 23_000 and 26_000 are updated.
  - `test/unit/core/synthesisKeys.test.ts`: `sibling` now builds from the active version, through the new helpers `shippedVersion` and `patchOf`. It assumed the active file was 1.0.0, so the whole file failed to load.
  - `test/integration/prompts.spec.ts`: `RELEASED_FILE_SHA256` gains the two 1.0.1 hashes (en `6c27e532…`, ko `734b3b38…`). The version and count test is rewritten, and the KO ceiling assertion is now 26000.
- **Generated:** `typings/i10n.d.ts` gains one line, the new id; its hash moved from 52f68a97 to e2096226. `typings/prompts.d.ts` is unchanged (4480d796) because it declares `*.md` by pattern. The other three typings hashes are unchanged.
- **Documents:** `docs/12` §10, §11 and §17.3; `docs/06` §5.2 and §9.2; `docs/07` §4.5; `plan/07` cards P4-T08, P4-T09 and P4-T18.

## SHARED-FILE EDITS QUOTED
- **en-US bundle, appended:**
  - Header: "## The trend report run's stop when the report fails the section check twice / ## (P4-T08; plan/00 §6 item 311(a); docs/12 §10). The answer, and the one fresh / ## generation asked for with the failure named, both lacked the eleven required / ## level-2 sections in order, so the run ends before anything is written. No / ## argument. Korean pending review (G-41)."
  - Then the message line (see NEW STRINGS).
- **ko-KR bundle, appended:**
  - Header: "## The trend report run's stop when the report fails the section check twice / ## (P4-T08; plan/00 §6 item 311(a)) / ## / ## NEEDS REVIEW (G-41). The message below is a commented stub carrying its / ## en-US source; nothing was machine-translated, and it is on / ## KO_PENDING_REVIEW in src/i18n/keys.ts."
  - Then "# NEEDS REVIEW research-helper-report-stopped-structure-invalid — en-US: <the English>".
  - Written in UTF-8 with Node: no BOM, no CR, final LF.
- **keys.ts, `MAIN_WINDOW_MESSAGE_IDS`:** "// P4-T08: the report run stopped because the one fresh generation failed the section check again (owner, plan/00 §6 item 311(a)). See STRUCTURE_INVALID_L10N in src/pipeline/trendReport/compose.ts."
- **keys.ts, `KO_PENDING_REVIEW`:** "// `P4-T08`'s stop when the one fresh generation fails the section check again (owner, plan/00 §6 item 311(a), 2026-10-30). `G-41` owns the translation; the `ko-KR` bundle carries it as a commented stub with its English source, and nothing was machine-translated. The coordinator drafts the Korean for the owner."
- **chunking.ts header:** "`analyseThemes` … calls it for a theme's sub-batches, through `packThemeMembers` in `src/pipeline/shared/estimate.ts`, which the estimate shares; `critique.ts` (`P4-T09`, the cited summaries) is its other caller, not built yet. `compose.ts` (`P4-T08`) does not call it: the report trims `{{DIGESTS}}` to a cited subset instead of packing them (corrected 2026-10-30, `plan/00` §6 item 311; `plan/reports/P4-T08.md` finding 3)."
- **`plan/07` P4-T09 Notes:** the old sentence "`packByTokens` is `P4-T07`'s, reached through `P4-T08`." is struck through and followed by "`packByTokens` is `P4-T07`'s, in `src/llm/shared/chunking.ts`; this card calls it directly, because `P4-T08`'s `composeReport` does not pack — it trims `{{DIGESTS}}` instead *(corrected 2026-10-30 …)*."

## DOC NOTES ADDED (quoted or summarised)
- **docs/12 §10, reading (2):** the "Open for the owner" line is struck through. Added: "**Decided 2026-10-30 (owner, `plan/00` §6 item 311(b)): the structure note is approved as drafted**, the wording quoted in `plan/reports/P4-T08.md`; no word of it changed with the approval."
- **docs/12 §10, reading (3):** the old open line is struck through. Added: "**Decided 2026-10-30 (owner, `plan/00` §6 item 311(a)): a second failure stops the run before anything is written, and says why.** `composeReport` returns the outcome `stopped-structure-invalid` … now carries `messageId` `STRUCTURE_INVALID_L10N` … its Korean on `KO_PENDING_REVIEW` as a commented `ko-KR` stub … `P4-T18` maps it to the job's end … no note, `report` row or file is saved, and every summary and cached stage result … is kept. The alternative not taken: ship the second answer with its structure fault named in the banner."
- **docs/12 §10, Model / temperature:** "~~`max_tokens: 6000`~~ `max_tokens: 23000`", plus a Decided note (item 311(c)). Its derivation, stated as using the estimator's own ratios (`CHARS_PER_TOKEN`: Latin 3.7, Hangul 1.4), not a provider tokenizer:

| Step | English | Korean |
| --- | --- | --- |
| Prose | 1.968 tokens a word × 4 250 = 8 364. Measured on 233 Europe PMC fixture abstracts: 44 843 words, 7.28 characters a word, divided by 3.7 | English × 1.141 = 9 543. The 1.141 is `estTokens`' Korean-to-English ratio over the 77 paired messages of eight or more words in the three shipped en-US/ko-KR bundles. The prompt asks for "{{TARGET_WORDS}}단어 상당", so the content is the same |
| Citation markers | one per 15 words, 284 markers at 3.51 tokens each = 997 | 997 |
| Markdown structure | 500 | 500 |
| Visible answer | 9 861 | 11 040 |
| Reasoning allowance | 1.0 × visible = 9 861. A stated assumption: docs/03 §12.3 puts output at 3–5× the visible text at high effort, so medium is taken at half the low end. P4-T23 will measure it | 11 040 |
| Headroom | D-06-5's 1.15 ×, giving 22 680 | 25 392 |
| **Ceiling** (rounded up to the next 1 000) | **23 000** | **26 000** |

- **Check against model output limits:**
  - `DOCUMENTED_PRICE_TABLE` holds prices only, and `bundledCatalogue` leaves `maxOutputTokens` unset. So the check was made against the "Max output" column of docs/03 §2.5, §3.5 and §4.6: 128 000 for the OpenAI models, opus-5, sonnet-5 and fable-5-1; 65 536 for Gemini; 64 000 for haiku-4-5.
  - Both ceilings are below the smallest, so no listed model is refused.
  - The OpenAI, Anthropic and OpenRouter adapters clamp to a known limit; the Gemini adapter sends the value as given.
  - Also recorded there: what is not covered (a stored `targetWords` above 4 250; Korean at §11's 2.0 × leaves about 7 800 tokens for reasoning).
- **docs/12 §11:** the version line reads ~~v1.0.0~~ v1.0.1 (as in §10), and "~~`max_tokens: 7000`~~ `max_tokens: 26000`", with a Decided note pointing to §10's Korean column.
- **docs/12 §17.3, "the first version bump of a shipped prompt — front matter only, a PATCH":**
  - 1.0.0 → 1.0.1, `cacheEpoch` kept at 1.
  - Why: the messages sent are identical. A cut-off answer is never stored, so every `rp` entry finished under the old ceiling. The ceiling is not part of the `rp` key.
  - Caveat recorded for the owner: if a provider sizes its reasoning from `max_tokens`, the bump would be MINOR instead (1.1.0, epoch 2, which invalidates only `rp`). Phase 4 sits behind the hidden `report.enabled` preference, so no user holds an `rp` entry either way.
  - Applied per §17.5 and `bundled.ts`: new files, old files kept, `PROMPT_VERSIONS` 1.0.1, `PROMPT_CACHE_EPOCHS` 1, two new spec hash lines, `prompts.d.ts` unchanged, `lastReviewed` kept.
- **docs/06 §5.2:** the table rows read "~~6 000~~ 23 000" and "~~7 000~~ 26 000", with a Decided note.
- **docs/06 §9.2:** "Recorded, not changed" is struck through. Added: the targets stay; by the estimator, 4 250 English words is about 9 900 visible tokens, not 5 500.
- **docs/07 §4.5 (item 311(c)):**
  - The estimate needs no code change.
  - 42-paper example at $3 / $15 with K = 5 passed: still 53 calls, about **$5.57** ($2.60 of summaries, **$2.97** of synthesis). It was $5.06 / $2.46.
  - With K unset: 56 calls, about **$6.14** ($3.54 of synthesis). It was $5.63.
  - The difference is two English reservations, each 17 000 tokens more at $15 per million: $0.51.
  - I computed these by a temporary printout in the test, then restored the test file and verified it by hash.
- **plan/07:**
  - P4-T08: the old Open line is struck through, plus "*Decided 2026-10-30 (owner, `plan/00` §6 item 311(a), (b), (c))*".
  - P4-T18: "~~whose handling is open…~~", plus a new "*Decided 2026-10-30 (owner, … item 311(a))*" paragraph mapping the stop to the job's end.
  - P4-T09: the Notes correction quoted above.

## NEW STRINGS
- `research-helper-report-stopped-structure-invalid` (en-US): "The report was stopped before it was written: asked twice, the model did not return the report with its eleven required sections in order, so nothing was saved. Every summary already made is kept."
- No argument. The Korean is a commented stub on `KO_PENDING_REVIEW` (gate G-41).

## RUNS
- **Static checks:** typecheck, `lint:check` and `npx eslint .` all exit 0.
- **Tests:** unit 99 files, 4734 passed; contract 84 passed, 28 skipped.
- **Build:**
  - The first `npm run typecheck` failed as expected (TS2322 on the new id). `npx zotero-plugin build` regenerated `i10n.d.ts`, after which `npm run build` passed.
  - Typings hashes, final: global 020956c7, i10n e2096226, prefs a9aa2d93, prompts 4480d796, zotero-augment cf994969.
- **Mutants:** 12, all killed, each restored by copy and verified by sha256. The typings hashes were the same before and after the sweep.
  - M1: `messageId` dropped from the outcome.
  - M2: the constant names another stop's id.
  - M3: the en-US line commented out.
  - M4: the ko-KR stub's NEEDS REVIEW marker dropped.
  - M5: the id removed from `KO_PENDING_REVIEW`.
  - M6: the EN active file back to 1.0.0.
  - M7: EN ceiling 22000.
  - M8: the KO PATCH raises `cacheEpoch`.
  - M9: the EN 1.0.1 prompt text edited.
  - M10: the KO ceiling left at 7000.
  - M11: the docs/06 §5.2 row disagrees with the file.
  - M12: the KO file's version left at 1.0.0. This one was killed by the suite failing to load ("no tests").
- **Integration:** three runs of `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`. Before each run the MUTANT grep was empty and Get-CimInstance found 0 test-profile zotero.exe, so nothing was killed.

| Run | Result | P1-T44 badge | l10n spec line |
|---|---|---|---|
| 1 | 226 passed | passes ("Protected by Windows Credential Manager") | `[P1-T18] ko-KR totals: 308 present, 2 absent; expected 308 / 2` |
| 2 | 226 passed | passes | same |
| 3 | 226 passed | passes | same |

## FINDINGS
1. **Not decided by item 311:** a P4-T09 rewrite that also returns `stopped-structure-invalid`. The rewrite goes through `composeReport` too. Should the run stop, or ship the draft that already passed the section check? This is recorded as a question on the P4-T18 card.
2. **The estimator and docs/12 §11 disagree on Korean.** The estimator's Hangul ratio (1.4 characters a token, about 0.71 tokens a syllable) gives Korean only 1.14 × English. §11 says 1.4–2.0 × and "1–3 tokens" a syllable. The KO ceiling follows the estimator as instructed; at 2.0 × it would leave about 7 800 tokens for reasoning. P4-T23 should measure this.
3. **PATCH or MINOR is a judgement call.** I chose PATCH. If a provider turns an effort level into a reasoning budget as a fraction of `max_tokens`, the output could differ under the higher ceiling. I believe OpenRouter does this for budget-based models, but that is from memory and not in docs/03. The note offers MINOR as the alternative.
4. **A stored `report.targetWords` above 4 250 is still sent as stored**, and the ceilings are not sized for it.
5. **The cost estimate rises.** Each report reservation now carries the full ceiling: +$0.51 in the 42-paper example, and about +$0.57 more when the Korean report is also written.
6. **One test file still names the old prompt files.** `test/unit/pipeline/trendThemeAnalysis.test.ts` reads `trend-report-*.v1.0.0.md` by literal name. It only counts calls, and the files still exist, so I left it unchanged.

## WHAT I DID NOT CHECK
- Real tokenizer counts, and real reasoning use at effort medium (the allowance is an assumption).
- How OpenRouter or any provider maps an effort level to a token budget.
- The live catalogue's `maxOutputTokens` for models outside docs/03's tables. A smaller OpenRouter cap would be clamped, not refused.
- The Korean wording of the new stop. It is G-41's job and has not been drafted.
- Rendering of the stop message in a window (P4-T18 and P4-T20 are not built).

The P4-T08 report referenced in the docs exists (`plan/reports/P4-T08.md`). Scratch files are in `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p311\`: `measure.mjs`, `ratio.mjs`, `edit-ftl-311.mjs`, `mutants.mjs`, `mutants.log`, `fig-new.json`, `int-run1.log` to `int-run3.log`, `hashes-before.txt`, and `*.orig` backups.

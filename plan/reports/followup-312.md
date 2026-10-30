## VERDICT
All four decisions of item 312 and followup-311 finding 6 are done. The documents were written first, then the code. Nothing is committed. Every card State is still TODO. Only the fake provider was used: no live call, no key, no secret.

All checks pass:
- typecheck, `lint:check` and `npx eslint .` all exit 0.
- Unit tests: 4738 passed (4734 before; 4 new tests). Contract tests: 84 passed, 28 skipped.
- Build passes. All five typings hashes are unchanged, `i10n.d.ts` included (e2096226).
- `index:derive` was run twice with the same hash both times (ff27e1ba). It added nothing beyond the coordinator's own item 312 text.
- 8 of 8 mutants were killed.
- 3 of 3 integration runs passed with 226 tests each.
- The final MUTANT grep is empty.

## FILES CHANGED WITH DECLARATION NAMES
- **`src/pipeline/trendReport/compose.ts`**
  - New constants `TARGET_WORDS_MAX` (4_250) and `TARGET_WORDS_CAPPED_WARNING` (`"report_target_words_capped"`).
  - New function `isTargetWordsCapped`.
  - `resolveTargetWords` now returns `Math.min(stored, TARGET_WORDS_MAX)` for any stored value of 400 or more.
  - `CompositionPlan` gains `targetWordsCapped: boolean`. `reportVariables` returns it and `prepareComposition` sets it.
  - `composeReport` adds `TARGET_WORDS_CAPPED_WARNING` to `warnings` when the target was capped.
  - Doc comments updated on the module header, `STRUCTURE_INVALID_L10N`, `ComposedReport.warnings` and `StructureInvalidOutcome`.
  - **Part (b) needed no hook.** `critique.ts` is the only caller that sends `revisionNotes`, and it already holds the earlier draft, so it can tell a rewrite apart by itself.
- **`src/i18n/keys.ts`**: the id moves from `KO_PENDING_REVIEW` to `KO_PRESENT`. `KO_PENDING_REVIEW` is now empty, which `MAY_BE_EMPTY` in the keys test allows.
- **`addon/locale/ko-KR/research-helper-mainWindow.ftl`**: the stub is replaced by the approved line.
- **`test/unit/pipeline/trendCompose.test.ts`**
  - The `6_000` pin now expects 4_250.
  - New describe block "…above 4 250 is sent as 4 250 (item 312(c))" with 4 tests:
    - `TARGET_WORDS_MAX` is read from the "Words" row of the docs/12 §10 derivation table, and equals `targetWordsFor(400)`.
    - 4 250 is sent as stored; 4 251 and 8 000 are sent as 4 250; `isTargetWordsCapped` is checked.
    - A full `composeReport` run for 4250, 4251 and 8000 checks the sent text, the plan flag and the warning.
    - The plan carries the flag before any request is made.
  - The stub test is rewritten: the bundle line must equal the line in `ko-review-312.ftl`, the stub must be gone, the new header must be present, and the id must be on `KO_PRESENT` and not on `KO_PENDING_REVIEW`.
- **`test/unit/pipeline/trendThemeAnalysis.test.ts`**: `prompts.get` in the `planSynthesis` test now reads `promptFile(PROMPT_FILE_NAMES[id])` for every id other than the two cluster-reduce ids. This covers the report prompts and also THEME_CLUSTER, THEME_MERGE and SELF_CRITIQUE. The `REDUCE`/`MERGE` constants at the top of the file still use literal names.
- **Documents:** `docs/12` §10, §12 and §17.3; `docs/06` §9.2; `plan/07` cards P4-T08, P4-T09, P4-T12 and P4-T18.

## SHARED-FILE EDITS QUOTED
- **ko-KR bundle.** The three-line `## NEEDS REVIEW (G-41)…` header and the `# NEEDS REVIEW research-helper-report-stopped-structure-invalid — en-US: …` stub were replaced by:
  "# Korean drafted by the coordinator and reviewed by the owner on 2026-10-30 (G-41, plan/00 §6 item 312(a))."
  followed by a blank line, then the approved line.
- **Byte-for-byte check by script** (`verify-ko-312.mjs`): byte-equal true, 300 bytes, no byte-order mark, no carriage return, final line feed, no stub left.
- **keys.ts, `KO_PENDING_REVIEW` comment:** "`P4-T08`'s stop when the one fresh generation fails the section check again (owner, plan/00 §6 item 311(a)) left this list on 2026-10-30: the owner approved the coordinator's Korean (`G-41`, plan/00 §6 item 312(a)), so it is on KO_PRESENT."
- **keys.ts, `KO_PRESENT` entry comment:** "`P4-T08`'s stop when the report fails the section check twice: Korean drafted by the coordinator and reviewed by the owner on 2026-10-30 (`G-41`, plan/00 §6 item 312(a)), inserted byte for byte from plan/reports/ko-review-312.ftl."

## DOC NOTES ADDED
- **docs/12 §10, reading (3)**
  - Added after item 311's text: "**Decided 2026-10-30 (owner, `plan/00` §6 item 312(b)): a `P4-T09` rewrite that returns this outcome does not stop the run.** A rewrite goes through `composeReport` too, so its first answer and its one fresh generation can both fail check 1. `critique.ts` then keeps the earlier draft — the one that passed check 1 and that the last critique read — and the banner states that the review's revision could not be applied… The outcome's `messageId` is not shown and the job does not end; only a first composition's `stopped-structure-invalid` ends it (`P4-T18`). `composeReport` needs no change for this…"
  - Also added: "*since 2026-10-30 on `KO_PRESENT`: decided 2026-10-30 (owner, `plan/00` §6 item 312(a))…*"
- **docs/12 §10, Model / temperature**
  - The "Not covered" clause about values above 4 250 is struck through.
  - New note: "**Decided 2026-10-30 (owner, `plan/00` §6 item 312(c)): a stored `report.targetWords` above 4 250 is sent as 4 250**, the 'Words' row of the derivation above… `TARGET_WORDS_MAX`… a test reads it from this table's 'Words' row… `CompositionPlan.targetWordsCapped`… `TARGET_WORDS_CAPPED_WARNING`… from which `P4-T12` builds the appendix line… The automatic setting never reaches the cap."
- **docs/12 §12**: "**Decided 2026-10-30 (owner, `plan/00` §6 item 312(b)): a rewrite that fails the section check twice keeps the earlier draft, and the run does not stop.** … the banner lists that draft's unresolved problems and states that the review's revision could not be applied… **Reading, for the owner to confirm:** the critique loop ends at that round… The failed rewrite's requests are counted in the run's usage like any other. Built by `P4-T09`."
- **docs/12 §17.3**: "**Decided 2026-10-30 (owner, `plan/00` §6 item 312(d)): the PATCH is confirmed** — 1.0.0 → 1.0.1 with `cacheEpoch` kept at 1, as applied below; the MINOR alternative is not taken."
- **docs/06 §9.2**
  - "~~400 or more is sent as stored~~ 400 to 4 250 is sent as stored".
  - The old "still sent as stored" sentence is struck through.
  - New note: "**Decided 2026-10-30 (owner, `plan/00` §6 item 312(c))…**". It covers the cap, the stored preference left as it is (no maximum in `PrefDef`), the declarations, and: "The `rp` cache key keys `{{TARGET_WORDS}}` as sent, so a stored 5 000 and a stored 8 000 share one entry; the line is therefore read from the current run's plan, not from a cached report."
- **plan/07 P4-T08**
  - New "*Decided 2026-10-30 (owner, `plan/00` §6 item 312(c))*" note naming `TARGET_WORDS_MAX`, `isTargetWordsCapped`, `CompositionPlan.targetWordsCapped` and `TARGET_WORDS_CAPPED_WARNING`, and noting 312(d).
  - New Done-when line: 4 250 is sent with no warning; 4 251 and 8 000 are sent as 4 250 with the warning.
- **plan/07 P4-T09**
  - New Do step 7: keep the earlier draft, do not show the `messageId`, end the loop at that round, count the usage, and pass a banner saying the revision could not be applied. Marked as decided under 312(b), with the loop-ending reading flagged.
  - New Done-when line: a rewrite scripted to fail twice ships the earlier draft byte for byte, makes no further critique call, does not stop the run, and shows the banner.
- **plan/07 P4-T18**: the item 311 "Not decided" sentence is struck through. New 312(b) note: only the compose stage's own stop ends the job; a rewrite's stop goes on to the scaffold stage with the earlier draft.
- **plan/07 P4-T12**: two new notes.
  - 312(c): the appendix line is built from the warning or the plan flag, read from the current run's plan.
  - 312(b): the new banner wording is one more label in `reportLabels.ts`.

## NEW STRINGS
- No new Fluent message.
- New code strings: the warning code `report_target_words_capped`.
- The Korean of `research-helper-report-stopped-structure-invalid` is live, as approved: "보고서를 쓰기 전에 멈췄습니다. 두 번 요청했지만 모델이 필요한 11개 장을 순서대로 갖춘 보고서를 돌려주지 않아, 아무것도 저장하지 않았습니다. 이미 만든 요약은 모두 남아 있습니다."

## RUNS
- **Mutants**: each was restored by copy and verified by sha256; the hash check passed for all three files.

| Mutant | Change | Result |
|---|---|---|
| M1 | cap removed | killed (3 tests failed) |
| M2 | maximum set to 5 000 | killed (4) |
| M3 | warning never added | killed (1) |
| M4 | `>=` instead of `>` | killed (2) |
| M5 | plan flag always false | killed (2) |
| M6 | `TARGET_WORDS` sent uncapped | killed (1) |
| M7 | Korean line edited | killed (1) |
| M8 | id dropped from `KO_PRESENT` | killed (2) |

- **Integration**: `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`, three runs. Before each run the MUTANT grep was empty and Get-CimInstance found 0 test-profile zotero.exe, so nothing was killed.

| Run | Result | P1-T44 badge | l10n spec line |
|---|---|---|---|
| 1 | 226 passed | passes ("Protected by Windows Credential Manager") | `[P1-T18] ko-KR totals: 309 present, 1 absent; expected 309 / 1` |
| 2 | 226 passed | passes | same |
| 3 | 226 passed | passes | same |

The totals were 308 / 2 before this change.

## FINDINGS
1. **Not decided by item 312: what happens to later critique rounds after a failed rewrite.** I recorded a reading, marked for the owner to confirm, in docs/12 §12 and P4-T09 step 7: the critique loop ends at that round. The reason: with two rounds allowed, the next round would critique the same draft (a cache hit) and lead to the same rewrite. The alternative is to try the rewrite again, which costs more but might pass.
2. **Not decided: which appendix carries the "target was capped" line.** The decision says only "the report's appendix". P4-T12 records Appendix B as the coordinator's reading.
3. **The cap and the cache.** The `rp` cache key keys the target as sent, so stored values of 5 000 and 8 000 share one cache entry. The appendix line must therefore come from the current run's plan, not from a cached report. This is recorded in docs/06 §9.2 and P4-T12.
4. **The streamed draft preview after a failed rewrite.** The rewrite's streamed text would reach the preview, and nothing says how the preview gets back to the kept draft. This is for P4-T09, P4-T18 and P4-T20; it is not written into any card.
5. **`KO_PENDING_REVIEW` is now empty again.** The only id absent from the ko-KR bundles is the deliberate fallback test key (`KO_DELIBERATELY_ABSENT`).

## WHAT I DID NOT CHECK
- Any P4-T09, P4-T12 or P4-T18 behaviour. None of those cards is built; the documents only describe it.
- The Korean wording itself. It was approved by the owner; I only checked that it was copied byte for byte.
- Live providers and real token counts.

Scratch files are in `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p312\`: `edit-ftl-312.mjs`, `verify-ko-312.mjs`, `edit-test-312.mjs`, `mutants.mjs`, `mutants.log`, `int-run1.log` to `int-run3.log`, `typings-before.txt`, `typings-after.txt`, `hashes-before-mutants.txt`, and `*.orig` / `*.pre312` backups.

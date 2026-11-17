# Phase 7, batch B — Part 0 and cards P7-T08, P7-T09, P7-T17, P7-T18, P7-T13, P7-T14

**Date:** 2026-11-17 · **Executor:** Claude Code (agent), under the coordinator's brief of 2026-11-17 ·
**Commit base:** d741ff2. Nothing is committed, pushed, tagged, triggered or published (`G-35`); the coordinator
reviews and commits. No card is set to `DONE`. Every card's State stays `TODO` with a dated "built, awaiting the
owner's review" note.

## Summary

| Card | Outcome | Report |
|---|---|---|
| Part 0 | The owner's answers to items 389 and 390 applied; two old findings closed (item 392) | this file |
| `P7-T08` | Built; 25 Korean drafts for `G-41`; no default changed | `plan/reports/P7-T08.md` |
| `P7-T09` | Built; 12 Korean drafts for `G-41` | `plan/reports/P7-T09.md` |
| `P7-T17` | Built; every provider page re-read on 2026-11-17; 6 Korean drafts for `G-41` | `plan/reports/P7-T17.md` |
| `P7-T18` | Built; the `Done when` line holds, `Do` step 1 does not; one owner question (item 393) | `plan/reports/P7-T18.md` |
| `P7-T13` | Built; 7 Korean drafts for `G-41` | `plan/reports/P7-T13.md` |
| `P7-T14` | Built; the audit found no planted key | `plan/reports/P7-T14.md` |

No estimate changed, so `plan/README` §7's five sites were not touched. Item 393's draft card (0.5 d) is not
adopted, so it is not counted. `npm run index:derive` was run after the last plan edit.

## Part 0 (`plan/00` §6 item 392)

- **Item 389(a), answered "not on screen"** (item 389(f)). A details disclosure shows machine values only. `docs/10`
  NFR-14's last sentence was amended, with notes of this date in `docs/07` §10.2 and `docs/08` §8.3.
  - The surfaces were checked. The search window and the Related tab comply. The report window has no disclosure,
    and `docs/08` §6 asks for none (item 392(b)).
  - **The item pane's summary section does not comply** (item 392(a), security): a failed run shows `redact` of the
    error's `detail`, which is free text. Added as a step to `P7-T03`, whose Files hold that code. Not a card under
    rule 9.
- **Item 389(b), the 23 Korean drafts adopted** (item 389(g)), byte for byte. `KO_PENDING_REVIEW` was empty after
  that, and plain `npm run l10n:check` exited 0 (499 messages).
- **Item 390(d), answered "advance warning only"** (item 390(e)). The weekly run against the Zotero beta does not
  block a release. The wording agrees in `.github/workflows/compat.yml`, `docs/13` §5.3, §6.2 and §8.9.
- **Closed: the lockfile's root version** (item 392(c)). Both root entries now say `0.0.2`, as `package.json` does.
- **Closed: `docs/13` §5.2's and §5.3's listings** (item 392(d)). They were replaced by dated notes that make the
  workflow files the authority.

## Owner question

1. **Item 393, scope: offline, three windows do not say that Zotero is offline** (`P7-T18`).
   - Only the keyword search shows `rh-error-offline`. The report window shows its generic failure line. The related
     window says "Could not reach any database." and blames the seed item. The summarize window gives no reason.
   - This blocks Phase 7's finishing condition for `NFR-9`.
   - Draft answer, not adopted: one card, `P7-T33` (0.5 d), that shows `rh-error-offline` in those three windows,
     with no new string. `docs/07` §10.5's probe, pause, breaker and badge would become a later-release candidate.

## Korean awaiting review (`G-41`)

50 ids, each a commented draft marked "not adopted" in `addon/locale/ko-KR/research-helper-mainWindow.ftl`, each on
`KO_PENDING_REVIEW` and allowed by CI's l10n step. All start `research-helper-prefs-`:

- **`P7-T08` (25):** `search`, `default-years`, `max-results`, `hide-existing`, `report`, `report-language`,
  `language-option`, `tts-language`, `tts-language-option`, `tts-voice`, `tts-voice-note`, `tts-minutes`,
  `tts-folder`, `tts-folder-choose`, `tts-folder-clear`, `tts-folder-unset`, `tts-folder-note`,
  `tts-folder-refused`, `privacy`, `privacy-mode`, `privacy-option`, `privacy-explain`, `fulltext-mode`,
  `fulltext-option`, `fulltext-note`.
- **`P7-T09` (12):** `advanced`, `concurrency`, `timeout`, `cache-size`, `cache-usage-row`, `cache-usage-total`,
  `cache-usage-unavailable`, `debug`, `debug-note`, `data-location`, `data-location-show`,
  `data-location-unavailable`.
- **`P7-T17` (6):** `retention-title`, `retention-openai`, `retention-anthropic`, `retention-gemini-paid`,
  `retention-gemini-free`, `retention-openrouter`.
- **`P7-T13` (7):** `diagnostics-title`, `diagnostics-note`, `diagnostics-preview`, `diagnostics-text`,
  `diagnostics-save`, `diagnostics-copy`, `diagnostics-status`.

## Open findings (none is a card under rule 9, apart from item 393)

- **Part 0:** the item pane's summary section shows a failed run's free-text `detail` (item 392(a); now a step on
  `P7-T03`).
- **`P7-T08`:** `docs/08` §7.3 says "the report language and length as drawn", but the markup draws no length
  control. "Length" was read as the audio length, `tts.targetMinutes`, which the card's step 2 names.
- **`P7-T18`:**
  - item 393 (above);
  - `docs/07` §10.5 is not built as written: no connectivity probe, no `"offline"` pause, no circuit breaker and no
    badge. `FR-23` holds without them;
  - in one summarize window, a second run writes no note, because the "write notes" box is left unchecked and
    disabled. No data is lost. Recorded for `P7-T03`'s window sweep;
  - the runner's `debug` lines are lost while offline, so the spec holds them until the switch is off.
- **`P7-T13`:** the diagnostics text is English only, as `docs/07` §10.4 describes. Only the pane's labels are
  localized.
- **`P7-T14`:** the logged `Authorization` header reads `[redacted:13]` whatever the key. The value is redacted
  twice, first by `loggableHeaders` and then by the logger's key-based rule, so only the length hint is lost. No
  value leaks.
- **`P7-T18` and `P7-T14`:** `Verify with` cannot run as written. `zotero-plugin test` 0.9.2 takes no spec filter,
  so each spec ran alone during development behind a temporary `.only`, removed before the recorded runs.

## Checks, after the last edit

- `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.
- `npm run l10n:check` with the CI step's arguments: "ko-KR matches en-US: 3 file(s), 549 message(s), 50 allowed
  hole(s)".
- `npm run test`:
  - Unit: 157 files, 8,375 passed, 105 skipped. Batch A ended at 155 files and 8,294 passed.
  - Contract: 7 files, 93 passed, 28 skipped (unchanged).
- `npm run build` exit 0. After each card that changed a Fluent id, `npx zotero-plugin build` was run first to
  regenerate the typings.
- **Typings hashes, from the start of the batch to its end:**
  - `i10n` changed `501e97c5` → `a2a086d8` (`P7-T08`) → `9895dc41` (`P7-T09`) → `6f54004e` (`P7-T17`) →
    `fb3a761b` (`P7-T13`). `P7-T18` and `P7-T14` left it unchanged;
  - `prefs` changed `7addedf1` → `47439ca8` (`P7-T08`, two new `pref()` lines);
  - `global` stayed `020956c7`, `prompts` `4480d796` and `zotero-augment` `cf994969`.
- `npm run index:derive` reports 270 tasks: 112 DONE, 158 TODO.
- **Mutation sweeps:** every mutant was killed and reverted. `P7-T08` 17 of 17; `P7-T09` 19 of 19; `P7-T17` 13 of
  13; `P7-T13` 31 of 31. `P7-T18` and `P7-T14` add no production code.

## Integration runs

The command each time was `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`.
Before each run, the `/* MUTANT` grep was empty and no `zotero.exe` was running. Nothing was built during a run.

- **`P7-T08` and `P7-T09`, on one build:** 360, 360 and 360 passed (14:47:22–15:04:08). `ko-KR` read 499 present
  and 37 absent, as expected.
- **`P7-T17` and `P7-T18`, on one build:** 367, 367 and 367 passed (15:52:57–16:11:36). `ko-KR` read 499 present
  and 43 absent, as expected.
- **`P7-T13` and `P7-T14`, on one build:** 369, 369 and 369 passed (17:47:47–18:06:19). `ko-KR` read 499 present and 50 absent, as expected. `P7-T14`'s audit found 0 of 30 values in each run. An earlier set of three runs (17:26:52–17:45:34) failed 1 test each, the same test every time. The live pane's copy check had not been narrowed along with its unit counterpart (`P7-T13` decision 7). It was fixed in the test, and these runs were made after the fix.

## Final state of the tree

- **New:**
  - `src/core/diagnostics.ts`, `src/zotero/diagnosticsPlatform.ts` and `src/llm/shared/policyNotes.ts`;
  - `test/unit/core/diagnostics.test.ts`, `test/unit/llm/policyNotes.test.ts`, `test/integration/offline.spec.ts`
    and `test/integration/redactionAudit.spec.ts`;
  - the six card reports and this file, and Part 0's `plan/reports/ko-review-389-draft.md` and
    `plan/reports/ko-review-389.ftl`.
- **Clean:**
  - The `/* MUTANT` and `.only(` greps over `src`, `test`, `scripts` and `addon` are empty.
  - Every command ran with `OPENROUTER_API_KEY` removed, and no key was read.
  - No live, keyed or paid path was run.
  - There is no PDF in the tree outside `node_modules`.

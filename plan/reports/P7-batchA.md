# Phase 7, batch A — Part 0 and cards P7-T01, P7-T04, P7-T02, P7-T12, P7-T32, P7-T21, P7-T22

**Date:** 2026-11-17 · **Executor:** Claude Code (agent), under the coordinator's brief of 2026-11-17 ·
**Commit base:** 9109bcc. Nothing is committed, pushed, tagged, triggered or published (`G-35`); the coordinator
reviews and commits. No card is set to `DONE`. Every card's State stays `TODO` with a dated "built, awaiting the
owner's review" note.

## Summary

| Card | Outcome | Report |
|---|---|---|
| Part 0 | Phase 6's three follow-ups closed (items 385, 386, 387) | this file |
| `P7-T01` | Done; two findings, neither a card | `plan/reports/P7-T01.md` |
| `P7-T04` | Done; the spike command is retired and its fixture moved into the tests (item 388) | `plan/reports/P7-T04.md` |
| `P7-T02` | Built; the Korean check runs in the CI lint job | `plan/reports/P7-T02.md` |
| `P7-T12` | Built; one owner question (security), 23 Korean drafts for `G-41` (item 389) | `plan/reports/P7-T12.md` |
| `P7-T32` | Done; balanced mode warns and asks for a free Gemini key (item 391) | `plan/reports/P7-T32.md` |
| `P7-T21` | Built, not run; one owner question (item 390(d)) | `plan/reports/P7-T21.md` |
| `P7-T22` | Built, not run | `plan/reports/P7-T22.md` |

No estimate changed, so `plan/README` §7's five sites were not touched. `npm run index:derive` was run after the
last plan edit.

## Part 0

- **Item 385:** the model for text-to-speech is resolved after the first confirmation.
- **Item 387:** an audio job interrupted by quitting Zotero ends `cancelled`.
- **Item 386:** the 29 Korean drafts were adopted byte for byte.
- **Inside Zotero:** three integration runs passed 359, 359 and 359, and `ko-KR` read 498 present, 1 absent
  (`plan/06` `G-41`'s note; the addendum to `plan/reports/P6-T16.md`).

## Owner questions

1. **Item 389(a), security.** `docs/10` NFR-14 says the provider's error text appears verbatim in a details
   disclosure. `docs/07` §10.2 forbids a raw provider message on screen.
   - As built, the disclosures show machine values only, and the report window shows none.
   - Draft answer, not adopted: keep the disclosure to the code, HTTP status and host; keep the redacted provider
     text in the debug log; amend NFR-14.
2. **Item 390(d), scope.** The weekly compatibility run tests the beta channel, which is Zotero 11.0-beta.4 today.
   The manifest's `strict_max_version` is `10.0.*`.
   - Draft answer, not adopted: keep the run as advance warning, not as a release blocker.

## Korean awaiting review (`G-41`)

23 ids from `P7-T12`, each a commented draft marked "not adopted", in
`addon/locale/ko-KR/research-helper-mainWindow.ftl`:

- **New:** `rh-error-policy`. It has no live Korean, is on `KO_PENDING_REVIEW`, and falls back to English.
- **Rewritten (22):**
  - `rh-error-configuration`, `-missing-credential`, `-network`, `-offline`, `-timeout`, `-auth`, `-forbidden`,
    `-quota`;
  - `-upstream`, `-bad-request`, `-source`, `-parse`, `-zotero`, `-storage`;
  - `-llm`, `-context-length`, `-content-filter`, `-structured-output`, `-output-truncated`;
  - `-budget`, `-seed-gone`, `-recommend-too-few-items`.

  Their reviewed Korean stays live.

## Open findings (none is a card under rule 9)

- **`P7-T01`:**
  - `plan/10` §0's V-17 row wrongly calls `docs/01` §9.2 unverified;
  - no measurement of `Zotero.getString()` on a plugin key is on file.
- **`P7-T04`:**
  - `FR-55`'s fallback was unobservable while the Korean gap was empty. It is observable again since `P7-T12`.
  - Removing a Fluent id needs `npx zotero-plugin build` before `npm run build`.
- **`P7-T12`:** plain `npm run l10n:check` exits 1 until `rh-error-policy`'s Korean is adopted. The CI step allows
  it, and a stale-allow check fails the step after adoption (item 389(c)).
- **`P7-T32`:** `assertModelAllowed` has six callers, not five; the audio script check is the sixth.
- **`P7-T21`:**
  - the lockfile's root version is `0.0.0` while `package.json` says `0.0.2` (this predates the batch);
  - `docs/13` §5.2's and §5.3's listings differ from the workflow files.

## Checks, after the last edit

- `npm run typecheck` and `npm run lint:check` exit 0. `lint:check` runs `eslint .` and `prettier --check .`.
- `npm run test`:
  - Unit: 155 files, 8,294 passed, 105 skipped. Batch 4 of Phase 6 ended at 152 files and 8,187 passed.
  - Contract: 7 files, 93 passed, 28 skipped (unchanged).
- `npm run build` finished, with `zotero-plugin-toolkit` at the pinned 5.2.0.
- **Typings hashes, from the start of the batch to its end:**
  - `i10n` changed `f1bed3dc` → `728bc2c0` (`P7-T04`, one id removed) → `501e97c5` (`P7-T12`, one id added);
  - `global` stayed `020956c7`, `prefs` `7addedf1`, `prompts` `4480d796` and `zotero-augment` `cf994969`.
- `npm run index:derive` reports 270 tasks: 112 DONE, 158 TODO.
- **Mutation sweeps:** every mutant was killed and reverted.
  - `P7-T02`: 16 of 16.
  - `P7-T12`: 12 of 12.
  - `P7-T32`: 7 of 7.
  - `P7-T21` and `P7-T22`: 25 of 25, run by the fork.
- **The workflow YAML** was validated offline with the repository's `yaml` package. The workflows were never run.

## Integration runs

The command each time was `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`.
Before each run, the `/* MUTANT` grep was empty and no `zotero.exe` was running. Nothing was built during a run.

- **Part 0:** 359, 359 and 359 passed.
- **`P7-T04`:** 359, 359 and 359 passed. `ko-KR` read 498 present and 0 absent.
- **`P7-T12`:** one run passed 359.
- **`P7-T12` and `P7-T32` together, on one build:** 359, 359 and 359 passed, with 0 failing.
  - `ko-KR` read 498 present and 1 absent, as expected.
  - One gap id resolves to its English message.
  - 29 error messages shipped, none deferred.
- **None needed:** `P7-T01`, `P7-T02`, `P7-T21` and `P7-T22` change no code that runs inside Zotero.

## Final state of the tree

- **New:**
  - `scripts/check-l10n.mjs` and `.github/workflows/compat.yml`;
  - `test/integration/support/spikeArticle.ts`;
  - `test/unit/i18n/errorMessages.test.ts`, `test/unit/scripts/checkL10n.test.ts` and
    `test/unit/scripts/releaseWorkflow.test.ts`;
  - the seven card reports and this file. Part 0's `plan/reports/ko-review-386.ftl` is new too.
- **Clean:**
  - The `/* MUTANT` and `.only(` greps over `src`, `test` and `scripts` are empty.
  - Every command ran with `OPENROUTER_API_KEY` removed, and no key was read.
  - No live, keyed or paid path was run.
  - There is no PDF in the tree outside `node_modules`.

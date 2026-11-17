# Phase 7 batch C — `P7-T10`, `P7-T11`, `P7-T16`, `P7-T19`, and Part 0 (`P7-T33`, Korean batch B)

**Date:** 2026-11-17 · **Executor:** Claude Code (agent), the tree and Zotero owner for the batch, under the
coordinator's brief of 2026-11-17 and its Part 0 message of the same day · **Commit base:** a4fb6b3, **nothing
committed** (the coordinator reviews and commits) · **Cards left:** all `TODO`, each with a dated "built, awaiting
the owner's review" note; only the owner sets `DONE`.

## 1. Summary

| Part | What | Result | Report |
|---|---|---|---|
| Part 0.1 | Item 393 answered "세 창에도 같은 안내" | Recorded as item 393(d), "DECIDED 2026-11-17 (owner, plan/00 §6 item 393)". `P7-T33` (0.5 d) added and built; `P7-T03` depends on it. The probe, pause, breaker and badge are a later-release candidate, with dated notes in `docs/07` §10.5, `docs/10` NFR-9 and `docs/13` §8.7. Estimate propagated to the five sites of `plan/README` §7. | `P7-T33.md` |
| Part 0.2 | The 50 Korean drafts of batch B approved, "모두 승인" | Recorded as item 394, "DECIDED 2026-11-17 (owner, G-41)". The 50 went in byte for byte (0 mismatches by script). `plan/reports/ko-review-p7b.ftl` written. The ids left `KO_PENDING_REVIEW` and CI's `--allow` list. l10n afterwards: "549 message(s), 0 allowed hole(s)". | item 394 |
| `P7-T10` | Clear actions, delete all plugin data, reset, uninstall coverage | Built. 3 `Done when` lines hold. 24 of 24 mutants killed. One fix during the batch (`removedCount`, item 396(j)). | `P7-T10.md` |
| `P7-T11` | Remove all Research Helper content | Built. 2 `Done when` lines hold. 6 of 6 mutants killed. Items go to the Zotero trash only (item 380, decision 2). | `P7-T11.md` |
| `P7-T16` | `docs/09` §7 security review, `SECURITY.md`, dependency audit | Built. 2 `Done when` lines hold. No `[BLOCKER]` open. 8 owner questions (item 395). | `P7-T16.md` |
| `P7-T19` | README and CHANGELOG | Built. The one `Done when` line holds: §7.3's ten items map to headings. | `P7-T19.md` |
| `P7-T33` | Offline message in report, related and summarize windows | Built. 3 `Done when` lines hold. 10 of 10 mutants killed. | `P7-T33.md` |

**Estimate:** Phase 7 is now 33 cards, 29.75 d, 29.75–42 d. The project total is 226.00–317 d over 271 cards. The
critical path is 157.75–221 d. Phase 7's own critical path stays 14.5 d. Only `P7-T33` changed an estimate. The other
four cards kept theirs. `npm run index:derive` was run after the last plan edit: "271 tasks, 112 DONE, 159 TODO".

**Coordinator decisions** (under item 313): item 396(a)–(j), one per reading, none blocking a `Done when` line.

## 2. Owner questions, each with a draft answer (none adopted)

All in `plan/00` §6.

- **Item 395, from `P7-T16`'s security review.** None is a `[BLOCKER]` line.
  - (a) **Privacy.** The item's tags reach the provider in every summary prompt, and the collection's name reaches
    it in report and audio prompts, against `docs/09` §3.2 row 3a. *Draft:* stop sending tags (one card, 0.5 d); keep
    the collection name and record it in row 3b.
  - (b) **Scope.** No UI sets a per-collection privacy mode, and the first-job notice lacks §4.3's cautions.
    *Draft:* per-collection setting is a later-release candidate; add §4.3's peer-review sentence to the notice as a
    `P7-T03` step (0.25 d), with a Korean draft.
  - (c) **Terms.** Semantic Scholar attribution in generated reports. *Draft:* one line under a report's references
    (one card, 0.5 d).
  - (d) **Security.** `src/addon.ts`'s scope `onError` reporter skips `redact`. *Draft:* pass it through `redact`
    (one card, 0.25 d).
  - (e) **Security, not measured at run time.** Zotero's own HTTP lines with NCBI and Semantic Scholar keys.
    *Draft:* one release-checklist line run by the owner in `P7-T25`; no card.
  - (f) **Security.** No scan of the whole plugin database after a job. *Draft:* one step in
    `redactionAudit.spec.ts` (one card, 0.25 d).
  - (g) **Development-dependency advisories,** 17 of them. *Draft:* `npm audit fix` without `--force`, as its own
    reviewed change before `P7-T26`.
  - (h) **`SECURITY.md`'s contact and response times.** *Draft:* the owner fills the channel before `P7-T26`
    (GitHub's private vulnerability reporting, if turned on); keep 7 and 30 days.

  If (a), (c), (d) and (f) become cards, Phase 7 grows by 1.5 d. Nothing was propagated, because nothing was adopted.
- **Item 397, Korean.** The 20 preference-pane strings of this batch: the drafts as written, inserted byte for byte
  on approval as items 386, 389(g) and 394 were.

## 3. Korean awaiting review (`G-41`, item 397)

20 ids, all in `addon/locale/ko-KR/research-helper-mainWindow.ftl` as commented drafts. They are on
`KO_PENDING_REVIEW` and `--allow`ed in `ci.yml`'s l10n step, with a comment there. The en-US text and the draft side by
side are in `plan/reports/ko-review-p7c-draft.md`.

- **`P7-T10`, 16** (marker "# Draft (coordinator, 2026-11-17, not adopted; G-41, P7-T10):"):
  - `research-helper-prefs-data-title`, `-data-note`;
  - `-clear-responses`, `-clear-summaries`, `-clear-jobs`, `-clear-embeddings`, `-delete-all-data`, `-reset-defaults`;
  - `-data-confirm-title`;
  - `-confirm-clear-responses`, `-confirm-clear-summaries`, `-confirm-clear-jobs`, `-confirm-clear-embeddings`,
    `-confirm-delete-all`, `-confirm-reset`;
  - `-data-status`.
- **`P7-T11`, 4** (marker "…P7-T11):"): `research-helper-prefs-remove-content`, `-remove-content-note`,
  `-confirm-remove-content`, `-remove-content-status`.

`P7-T33` added no string.

## 4. Open findings (not cards, rule 9)

None blocks a phase's finishing conditions. Each is in its card's report.
- **`P7-T10`.**
  - A small cache rounds to "0 MB" in the confirmation.
  - Uninstall in a running Zotero is not measured; that is `P7-T25`'s manual run.
- **`P7-T11`.**
  - The linked audio folders are named only in the confirmation.
  - `uninstall()` does not remove content, by the card's **Do NOT**. The README says to run the command first.
- **`P7-T16`.** Seven findings without a question, in the review file's last section:
  - the NCBI and Semantic Scholar keys bypass `Secret`;
  - the `debug: true` lint's blind spot;
  - full mode and an unknown training policy;
  - the corpus bounds are declarations only;
  - the pane shows the retention date, not the page;
  - a stale "§8" reference;
  - no `CODEOWNERS` file.
- **`P7-T19`.**
  - Three features are described but off until `P5-T30` and `P6-T19`.
  - The checklist link is dead until `P7-T24`.
  - The privacy table follows item 395(a).
  - Screenshot placeholders for `P7-T27`.
  - The 8–32× ratio is a design estimate.
  - The Install steps were not run.
- **`P7-T33`.**
  - The related seed line of item 393(a) was not seen offline.
  - Nothing pauses offline, as decided.
- **Fixed, not open: the `P7-T10` status count.** The batch's first full integration run (20:21–20:27, before the
  fix) logged "Remove 12 stored summaries…" followed by `removed: 32`. `removedCount` now reports what the
  confirmation named (item 396(j)). The three recorded runs below were all made after the fix and log `removed: 12`.

## 5. Checks (after the last code edit)

All run with `OPENROUTER_API_KEY` removed from the environment (`env -u OPENROUTER_API_KEY …`). No live network,
model, keyed or paid call was made by any of them.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run l10n:check` with CI's 20 `--allow`s | exit 0: "check-l10n: ko-KR matches en-US: 3 file(s), 569 message(s), 20 allowed hole(s)" |
| `npm run test` | exit 0: 159 files, 8447 passed, 105 skipped; contract 7 files, 93 passed, 28 skipped |
| `npm run build` | exit 0. 10 WARN lines, "I10N id … missing in locale: ko-KR", for the 10 of the 20 awaiting ids that `preferences.xhtml` names. The other 10 are drawn from code. |
| typings, before and after the build (sha256, first 8) | unchanged: `global.d.ts` 020956c7, `i10n.d.ts` cd93b62a, `prefs.d.ts` 47439ca8, `prompts.d.ts` 4480d796, `zotero-augment.d.ts` cf994969. `i10n.d.ts` was fb3a761b at the batch's start; the 20 new ids changed it. |
| XPI | `research-helper.xpi`, 729 267 bytes, sha256 begins `eee0707cc7e87119`. Unpacked, 25 files; the key- and token-shape search of `P7-T16` found 0 hits. |
| `/* MUTANT` grep over `src`, `addon`, `test`, `scripts` | 0 |
| `.only` in `test` | 0 |
| `npm audit --omit=dev` (registry; lockfile names and versions only) | found 0 vulnerabilities |
| `npm audit` (full) | 17: 13 moderate, 4 high, 0 critical, all development and build dependencies. `npm audit fix` not run (item 395(g)). |

The full outputs are in the scratchpad (`checks-final.txt`, `test-final.txt`, `build-final.txt`, `audit-omitdev.txt`,
`audit-full.txt`, `audit-full.json`). They are not part of the repository.

## 6. Integration runs

Command: `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npm run test:integration -- --exit-on-finish`, in Zotero
10.0.3 on Windows 11. `zotero-plugin test` builds the plugin into `.scaffold/build/addon` at its start, in test
mode, from the working tree. The source did not change between the three runs, and nothing else built during them.

Before each run:
- the `/* MUTANT` grep was empty;
- there was no `.only`;
- no `zotero.exe` was running.

No Zotero process was killed.

| Run | Start–end | Exit | Result | Live-request guard |
|---|---|---|---|---|
| 1 | 20:37:52–20:44:09 | 0 | "371 passed", 2 pending | 1321 channels read, away from loopback `[]` |
| 2 | 20:44:51–20:51:03 | 0 | "371 passed", 2 pending | 1321 channels read, away from loopback `[]` |
| 3 | 20:51:22–20:57:30 | 0 | "371 passed", 2 pending | 1321 channels read, away from loopback `[]` |

The 2 pending in each run are:
- "§2 criteria 1, 4 and 5: a real PubMed search imports…";
- "builds the index over a 10 000-item library with exactly one search pending".

None failed, so no repeat was needed.

**The build after the runs.** `npm run build` was run again and made an XPI of the same size, 729 267 bytes. Its
sha256 begins `46eecf697d294684`, not `eee0707c…`, but its 25 unpacked files are byte-identical to the scanned build
(`diff -r`: no difference). Only the archive's entry timestamps differ. The typings hashes are unchanged again.

The logs are in the scratchpad (`int-r1.log`, `int-r2.log`, `int-r3.log`). The run before the fix is `int-c1.log`.

Each run's log also measured:
- **`P1-T18`.** "ko-KR totals: 549 present, 20 absent; expected 549 / 20". `research-helper-mainWindow.ftl` has 20 gap
  ids, and the other two bundles 0. The 20 gap ids resolve to their en-US message along the ko-KR, en-US chain.
- **`P7-T10`.** The confirmations and statuses:
  - "Remove 12 stored summaries from Research Helper's database? …" → `removed: 12`;
  - "Remove the history of 7 finished jobs? …" → `removed: 7`;
  - "Remove 191 cached responses (1.6 MB)? …" → `removed: 191`;
  - the reset → `removed: 60`.

  The shared test profile holds the other specs' rows, hence 12 and 191, not the spec's own 2 and 1.
- **`P7-T11`.**
  - found: user `{"generated":[…2],"provenance":[…1],"audio":[…1]}`, group `{"generated":[…1]}`;
  - "moved 4; all restored; the five kept items untouched".
- **`P7-T18`/`P7-T33`.** All three read "Zotero is offline. Connect to the internet, then try again.":
  - the summarize window's offline line;
  - the report window's stop reason;
  - the related window's headline (`rh-error-offline`), with the code in the disclosure.
- **The live-request guard.** No channel went away from loopback (`away from loopback: []`).

## 7. Final tree state

`git status --short` after the last edit: 52 entries, nothing staged, nothing committed. 34 files are modified and 18
paths are new; this report is one of the 18.
- **Modified, code and assets:**
  - `addon/bootstrap.js`, `addon/content/preferences.{js,xhtml}`, `addon/content/summarize.{js,xhtml}`;
  - both `research-helper-mainWindow.ftl` bundles;
  - `src/bootstrap/registerUI.ts`, `src/hooks.ts`, `src/i18n/keys.ts`, `src/ui/dialogs/summarizeDialog.ts`,
    `src/ui/prefs/preferencesPane.ts`, `src/ui/viewModels/relatedViewModel.ts`, `src/ui/viewModels/reportViewModel.ts`,
    `src/zotero/db.ts`, `src/zotero/notes.ts`;
  - `typings/i10n.d.ts`, which the build generates.
- **Modified, tests:**
  - `test/integration/offline.spec.ts`, `test/integration/preferences.spec.ts`;
  - `test/unit/bootstrap/uninstall.test.ts`, `test/unit/ui/preferencesPane.test.ts`,
    `test/unit/ui/relatedViewModel.test.ts`, `test/unit/ui/reportViewModel.test.ts`.
- **Modified, docs and plan:**
  - `.github/workflows/ci.yml`, `README.md`;
  - `docs/07`, `docs/09`, `docs/10`, `docs/11`, `docs/13`;
  - `plan/00`, `plan/05`, `plan/06`, `plan/10`.
- **New:**
  - `CHANGELOG.md`, `SECURITY.md`, `docs/images/.gitkeep`, `docs/spikes/phase-7-security-review.md`;
  - `src/core/dataReset.ts`, `src/bootstrap/uninstall.ts`;
  - `test/unit/core/dataReset.test.ts`, `test/unit/ui/summarizeDialog.test.ts`,
    `test/integration/zotero/removeAllContent.spec.ts`;
  - `plan/reports/P7-T10.md`, `P7-T11.md`, `P7-T16.md`, `P7-T19.md`, `P7-T33.md`, `P7-batchC.md`,
    `ko-review-p7b.ftl`, `ko-review-p7c-draft.md`;
  - `plan/reports/ko-review-p7b-draft.md`: batch B's draft list, the source item 394(a)'s byte-for-byte check was
    run against. It is untracked, and `P7-batchB.md` does not name it.

No PDF, key, export path or audio folder is in any of them. Nothing was pushed, tagged or published, and no workflow
was triggered.

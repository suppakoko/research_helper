VERDICT
All seven decisions in item 292 are applied. Every check passes:
- `npm run typecheck`, `npm run lint:check` and `npx eslint .` all exit 0.
- `npm run test`: unit 88 files, 4229 tests passed (was 4218); contract 2 files, 40 passed.
- `npm run build` exits 0 with no warnings, and all five `typings/*.d.ts` hashes are identical before and after.
- `npm run index:derive`: the first run changed only the "Last updated" date; the second run changed nothing.
- The integration suite passed 195 of 195 on all three runs. The localization line is: `[P1-T18] ko-KR totals: 251 present, 1 absent; expected 251 / 1`.

Card States stay TODO. Nothing was committed. Documents were edited before code.

FILES CHANGED WITH DECLARATION NAMES
- `D:\KIST\projects\research_helper\addon\locale\ko-KR\research-helper-mainWindow.ftl`: the four "# NEEDS REVIEW" stubs were replaced with the approved Korean for `research-helper-egress-report-notice`, `research-helper-cost-report-summaries`, `research-helper-cost-report-writing` and `research-helper-cost-report-review`.
  - The section header was rewritten, and the entries sit under "# Korean drafted by the coordinator and reviewed by the owner on 2026-10-27 (G-41, plan/00 §6 item 292(a))."
  - Structure follows the file's own precedent. The three `$calls` lines use `{ $calls -> *[other] … }`, like `research-helper-cost-calls`. `$papers` is a plain placeable, like `$items` in `research-helper-cost-items`.
  - A script compared the text with item 292(a), with its line wraps joined: all four MATCH.
- `D:\KIST\projects\research_helper\src\i18n\keys.ts`: the four ids moved from `KO_PENDING_REVIEW` (now empty, with a dated comment) to the end of `KO_PRESENT`.
- `D:\KIST\projects\research_helper\src\ui\dialogs\costConfirmDialog.ts`: only the doc comment on `REPORT_COST_L10N` changed; it no longer says the strings are pending review.
- `D:\KIST\projects\research_helper\src\pipeline\trendReport\citations.ts` (P4-T10):
  - New: the private `PART_SEPARATOR_RE` (`/\s*[,;]\s*/`) and `partsOf`.
  - The private `checkHit` is renamed `checkMarker(content, raw, …)`.
  - `validateCitations` now splits combined markers through a local `one` helper.
  - `RemovedMarker` gains `splitFrom?`, and `CitationFigures` gains `splitMarkerCount`. The log line gains `split: true` for a part.
  - The module header is updated. `assertAllMarkersResolve`, `citedKeysOf` and `bindMarkers` are unchanged.
- Tests:
  - `test\unit\pipeline\trendCitations.test.ts`: a new describe block "combined markers" with 10 tests. The malformed-marker test now uses `[[A B]]` instead of `[[A, B]]`, and the first figures test includes `splitMarkerCount`.
  - `test\unit\ui\costConfirmDialog.test.ts`: the stub test now expects real Korean entries. A new test pins the approved Korean word for word and checks that every argument the dialog model passes for the four ids appears in the Korean entry.
  - `test\unit\pipeline\privacyPolicy.test.ts`: the report-notice test now expects a real `ko-KR` entry that carries `{ $papers }` and `{ $models }`.
  - `test\unit\i18n\keys.test.ts`: the four ids are now expected on `KO_PRESENT` and never pending; the `MAY_BE_EMPTY` comment is updated.
- Documents: `docs\06-summarization-and-trend-report.md` (§10.1, §11.2), `docs\07-architecture-and-data-model.md` (§4.5) and `plan\07-phase-4-trend-report.md` (P4-T05, P4-T10, P4-T12, P4-T18, P4-T21).
- `plan\00-task-index.md`: changed only by `index:derive` (the header date).

DOC NOTES ADDED (quoted; the long ones are shortened only where marked "…")
- docs/06 §10.1, P4-T10 note, point (1) now reads: "…a malformed key (`[[abcd1234]]`, `[[ABC123]]`~~, `[[KEY1, KEY2]]`~~) fails … and is replaced with the same text; code does not ~~split or~~ re-case it. *(Changed 2026-10-27 by the owner, `plan/00` §6 item 292(c): a combined marker such as `[[KEY1, KEY2]]` is now split into one marker per part before the check — see the note below.)*"
- The same note's last sentence: "~~**Open for the owner:** …~~ **Decided 2026-10-27 (owner, `plan/00` §6 item 292(b)):** a Korean report replaces an invalid citation with "[인용 삭제: 잘못된 참조]". The text comes from `P4-T12`'s report-label table (`reportLabels.ts`, its `ko` table) and is passed as `CitationContext.replacement`; `P4-T21` wires it for a `ko` report. An English report keeps `[citation removed: invalid reference]`, the default."
- docs/06 §10.1, a new note: "**Decided 2026-10-27 (owner, `plan/00` §6 item 292(c)): a combined marker is split, and each part is checked on its own** … **What a marker is, as read here:** this section's `CITE_RE` and `12-…` §10 check 2 give a marker exactly one item key, and the one prompt that shows several citations together writes them as adjacent markers (`[[ABCD1234]] [[EFGH5678]] [[IJKL9012]]`, `12-…` §9 `CLUSTER_REDUCE`, system rule 1)…" It goes on to say:
  - Content split at each `,` or `;`, with any whitespace around it.
  - Each part checked on its own: the duplicate rewrite, then the valid set.
  - Parts joined by one space.
  - "**Code never trims, re-cases or invents a key**"; empty, lowercase or space-padded parts are malformed and replaced.
  - "**The semicolon is split as well as the comma**, because item 292(c) gives `[[KEY1, KEY2]]` as an example ("such as")…"
  - "**Whitespace alone is not a separator**".
  - Fenced markers are left as written.
  - Counting: `markerCount` = kept + replaced, plus a new `splitMarkerCount`.
  - The gate and the binder do not split, so an unsplit combined marker that reaches them throws.
- docs/06 §11.2 (g): "**Decided 2026-10-27 (`P4-T17`, ~~for the owner to confirm~~ confirmed as built — Decided 2026-10-27 (owner, `plan/00` §6 item 292(g)): a re-summarized paper re-keys its theme grouping, and any difference in what is sent, the model or a setting re-keys the stage) — how the three rows are read,…" The rest of the text is kept.
- docs/07 §4.5, Note 2 (e): "(`P4-T16`; the card's readings, ~~for the owner to confirm~~ confirmed — Decided 2026-10-27 (owner, `plan/00` §6 item 292(e)): the estimate stays wide, because it never under-states, and is revisited once `P3-T25`'s stored summaries, `P4-T04`'s digests and real runs exist): the report run's estimate…" The rest of the text is kept.
- docs/07 §4.5, Note 1, after "forces nothing on its own … item 274(b))": "*Decided 2026-10-27 (owner, `plan/00` §6 item 292(f)): "don't ask again" is recorded separately for report runs, so a summarize run's record never skips a report run's question and only the report window's own "don't ask again" does. `P4-T18` builds it: a record of its own in `collection_settings`, beside `RoutineConfirmation`.*"
- plan/07 changes:
  - **P4-T05:** a new step 6, quoting the decision verbatim plus a dated note. Its reason: P4-T16's estimate reserves theme calls for at most `MAX_THEMES` themes, so an answer over that limit would make calls nobody confirmed. The note also says the stop needs a user-visible message.
  - **P4-T05 Files:** new rows for both mainWindow bundles, `keys.ts` and `keys.test.ts`, marked as a guess about which bundle.
  - **P4-T05 Done when:** "A scripted answer with `MAX_THEMES` + 1 themes triggers exactly one more request; a second answer still over `MAX_THEMES` stops the run with its message and makes no further call, and a second answer within it is used (step 6, item 292(d))."
  - **P4-T10:** a Done-when line for combined markers, dated, pointing to the docs/06 note.
  - **P4-T12:** a new step 7, saying the label table carries `en` `[citation removed: invalid reference]` and `ko` "[인용 삭제: 잘못된 참조]" for `CitationContext.replacement`. It notes this one `ko` label is already approved, so it does not ship pending review, and that P4-T21 wires it. The `reportLabels.ts` Files row adds `compose.ts` (P4-T21) as a caller.
  - **P4-T21:** a new step 4 that wires the `ko` label into `validateCitations`, and a Done-when line for the `ko` and `en` replacement text.
  - **P4-T18:** a new step 7 for (f): a report run's own `RoutineConfirmation`-shaped record in `collection_settings`, declared in docs/07 §4.5 first. The report run passes only that record to `mustAskConfirmation` and stores `routineConfirmationFor` there.
  - **P4-T18 Files:** new rows for `src/pipeline/shared/privacyPolicy.ts` (`CollectionPrivacySettings`, `readCollectionPrivacySettings`, `writeCollectionPrivacySettings`), `privacyPolicy.test.ts` and docs/07 §4.5. No migration is needed, because the record is a member of the existing `json` column.
  - **P4-T18:** a new Done-when line, and Verify with now reads `npm run test:unit -- trendReportPipeline privacyPolicy`.

RUNS
- `npm run typecheck`: exit 0.
- `npm run lint:check`: exit 0, after Prettier reformatted my two test files.
- `npx eslint .`: exit 0.
- `npm run test`: unit 88 files, 4229 passed; contract 2 files, 40 passed.
- `npm run build`: exit 0. The typings hashes before and after are identical:
  - `i10n.d.ts` f5bd6343…
  - `global.d.ts` 020956c7…
  - `prefs.d.ts` a9aa2d93…
  - `prompts.d.ts` 4480d796…
  - `zotero-augment.d.ts` cf994969…
- `npm run index:derive`, run 1: only the header date changed. Run 2: hash 12aff955… both before and after.
- `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`, three runs:
  - Pre-flight each time: `grep -rn MUTANT src test addon typings scripts` was empty. `Get-CimInstance` by process name found no `zotero.exe` with `.scaffold\test\profile` on its command line, so nothing was killed.
  - Results: 195 passed, 195 passed, 195 passed.
  - The ko-KR line each time: "ko-KR totals: 251 present, 1 absent; expected 251 / 1".
  - The P1-T23 figures for the three runs:

| Run | Startup delta (200 ms budget) | 100 items imported | Longest main-thread gap |
|---|---|---|---|
| 1 | 28 ms | 428 ms | 66 ms |
| 2 | 22 ms | 418 ms | 51 ms |
| 3 | 19 ms | 415 ms | 70 ms |

- Mutants on `citations.ts`: 16, each marked `/* MUTANT Mn */`, applied by script, restored by copy and verified by sha256 (00cd839f…9e29 every time). All 16 were killed:

| Mutant | Change | Tests failed |
|---|---|---|
| M1 | no split | 7 |
| M2 | comma only | 3 |
| M3 | parts trimmed | 1 |
| M4 | parts re-cased | 2 |
| M5 | invalid part dropped silently | 5 |
| M6 | parts joined with nothing | 7 |
| M7 | whitespace splits | 3 |
| M8 | no duplicate rewrite for parts | 1 |
| M9 | split count not kept | 4 |
| M10 | fenced combined marker split | 1 |
| M11 | empty parts dropped | 1 |
| M12 | parts not counted as markers | 3 |
| M13 | `splitFrom` not recorded | 1 |
| M14 | split flag not logged | 1 |
| M15 | gate accepts a combined marker | 1 |
| M16 | caller's replacement ignored for parts | 1 |

- Mutants on the ko-KR bundle: 3, each restored by copy and checked by hash, with the typings unchanged. All 3 were killed:
  - K1, review text changed: 1 test failed.
  - K2, `{ $themes }` dropped: 1 test failed.
  - K3, notice turned back into a stub: 3 tests failed.
- The final `grep -rn MUTANT` is empty.

FINDINGS
1. **(d) implies a user-visible string.** P4-T05 adds it; I added no string. A suggested en-US text for P4-T05: "The report was stopped: the model twice grouped the papers into more than { $max } themes, the most this run was priced for. Summaries already made are kept; no report was saved." The argument is `$max`, a number. Which bundle and which id belong to P4-T05; its Files row marks the main-window bundle as a guess.
2. **P4-T05 must decide one interaction.** Step 3 ("on a miss, re-run once") and the new step 6 ("asked for once more") could both fire on one answer. The card does not say whether they share one re-run. P4-T16's estimate reserves neither call; `withBudget` is the backstop.
3. **(f) adds roughly 0.25 d to P4-T18.** The work is a docs/07 §4.5 declaration, one member in each of `CollectionPrivacySettings`, `readCollectionPrivacySettings` and `writeCollectionPrivacySettings`, a few `privacyPolicy` tests, and the pipeline choosing which record to read and write. The estimate is unchanged at 2.0 d.
4. **docs/07 §4.5 Note 1's header still says "the card's readings, for the owner to confirm".** Item 292 confirms Note 2 under (e) and gives Note 1 only the (f) pointer, so I left that header as it was. The owner may want it marked too.
5. **Decisions I made on (c), recorded in docs/06:**
   - Only `validateCitations` splits; the gate and the binder still throw on an unsplit combined marker.
   - Parts are not trimmed, so `[[ A, B]]` keeps " A" as written, and it is replaced as malformed.
   - An empty part (`[[A,]]`) is replaced visibly rather than ignored.
6. **P4-T12 step 6 says the `ko` table "ships pending review".** The new step 7 exempts the one approved invalid-citation label.
7. **P4-T10's report named the private helper `checkHit`.** It is now `checkMarker`.

WHAT I DID NOT CHECK
- No Fluent formatting of the new Korean entries was rendered inside Zotero. The l10n spec checks only that the ids are present; a unit test checks the text and the argument names.
- P4-T12, P4-T18 and P4-T21 do not exist yet, so the Korean replacement and the separate "don't ask again" record are written into cards only, not built.
- Splitting has not been tried on real model output; every case comes from synthetic fixtures. There were no live network or model calls.
- I did not re-check the other "for the owner to confirm" notes in docs/06 and docs/07 beyond the three item 292 names.

Scratch (backups, mutant script): C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\item292\

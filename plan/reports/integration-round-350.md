# integration-round-350 — report of the executing agent (saved verbatim, 2026-11-02)

# Integration round on P5-T16, P5-T17, P5-T24, P5-T25, P5-T32: report (2026-11-05)

## VERDICT

**The round is clean. Three consecutive runs on the final tree each ended with exit code 0 and 316 passed, 0 failed, 2 pending.** Nothing was committed, no card was set to DONE, and `plan/00` was not edited by this round (the file already held uncommitted edits).

Three things need the coordinator's attention:

- **The limit "no live request at all" was broken once in this round, before the new guard existed.** The first exploratory full run had no guard. Its report specs asked the real Europe PMC for fixture identifiers, and Zotero itself asked `api.zotero.org/retractions/search`. No request held a key or any library text beyond fixture Digital Object Identifiers (DOIs). The number sent in that run was not recorded. Earlier rounds' full runs must have done the same.
- **Two real product defects were found and fixed.**
  - Leaving a related run raised a "cancelled" toast.
  - Source text in a Fluent argument was parsed as markup.
- **The suite itself had a hole.** Two report specs sent live requests while their header said none left Zotero. This is fixed.

## The egress fix (`plan/00` §6 item 349(b))

- **What changed:**
  - `LLMCallContext.beforeSend` is new in `src/llm/types.ts`.
  - `src/llm/router.ts` awaits it in `chat` and `chatStream`, after the key check and before the adapter.
  - `ProfileCallDeps.logEgress` is new in `src/pipeline/recommend/profileCall.ts`.
  - `recommendPipeline.ts` wires it to `noteEgress` and no longer writes afterwards.
- **Behaviour now:**
  - The entry is written before the request goes.
  - A transport failure or a cancel in flight leaves exactly one entry.
  - A ceiling refusal, a missing key, a decline and a cached answer write nothing.
  - A pause that resumes and sends writes one.
- **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313):** one entry per `completeJSON` sequence, so a repair and a retry add none. A resume after a sequence was refused part-way writes a second entry.
- **Fields:** unchanged. A test asserts the record's keys and that no paper title is in it.
- **Documents:** `docs/07` §4.3 has the new member, and the §12.5 note's item 8 has a dated correction.
- **Unit tests:** transport failure, cancel in flight, repair and retry, ceiling and resume, part-way refusal, decline and no key, fields only.
- **Kill check by hand mutation on a scratch copy:** 11 of 11 mutants killed, and the control passed 244 tests before and after. Log: `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round350\kill-check.log`.
- **Real queue:** proved in Zotero; see P5-T25 line 4.

## Typings hash

The generator reproduces the hand edits of `typings/i10n.d.ts`, with no difference. All five hashes were identical before and after `npm run build` (three builds), and after run 3:

| File | SHA-256 starts |
|---|---|
| `global.d.ts` | `020956c7f456` |
| `i10n.d.ts` | `ba99657d5b01` |
| `prefs.d.ts` | `a9aa2d93d36b` |
| `prompts.d.ts` | `4480d7967afb` |
| `zotero-augment.d.ts` | `cf994969fc0b` |

## Proof lines

Every figure below rests on runs 1, 2 and 3 of the final tree.

### P5-T16

| Line | Result |
|---|---|
| 1. Three specs compile and pass | Proved |
| 2. Populated table on stub sources | Proved. "Import off" is superseded by P5-T17: Import is now on |
| 3. Fluent chips, captions on script-built headings | Proved |
| 4. Attribute-only score message | Proved: text stays `●●●●●`; `aria-label` "Score: 5 of 5 dots, relative to the highest score in this list" |
| 5. Context markup, clamp, tooltip | Proved: no element from the text, `-webkit-line-clamp` 2, `title` holds the words |
| 6. Hidden headings line up | Proved: left edges `[15,15] [53,53] [435,435] [554,554] [596,596] [927,927]` |
| 7. Include counts, year "Any" | Proved: "Citations (3)"; a real bound drops the 2001 row and "Any" lets it back |
| 8. Hide-existing off, preference unwritten | Proved |
| 9. Key link real and launches | Proved: `Zotero.launchURL` receives `SEMANTICSCHOLAR_KEY_REQUEST_URL` |
| 10. Status rows lay out acceptably, seven rows | Measured, no overflow. At 1019 x 600: three lines, 74 px; table 325 px, showing four rows. "Acceptably" is a judgement: the header takes about half the window, so the owner may want to look |
| 11. Picker | Proved on the shipped document with a stand-in host: radios keep one choice, the button enables, `doCommand` sends the pick. **Not provable** with real title-match data: a title-only seed reaches the real Crossref, so that waits for `P5-T30` |
| 12. Re-open, close, shutdown | Proved after a defect fix (see Defects). Re-open and close: lists cancelled, 0 toasts. Shutdown: 1 of 1 lists cancelled, 0 toasts, 0 live handles, no window |
| 13. `menus.spec.ts`, `lifecycle.spec.ts` make no live request | Proved by the new guard over the whole run |
| 14. Greyed rows meet NFR-13 | Proved for an unselected row: 4.76:1 light, 5.91:1 dark. Dark was asked for with the `ui.systemUsesDarkTheme` preference, and the colours changed. Selected and hover rows were not measured |

### P5-T17

All proved in `relatedLinkage.spec.ts`, first run:

- 8 created and 2 linked, `matchedOn` `[doi, caller]`, all 10 related both ways.
- Relations survive a reload from the database.
- Unticked relates nothing.
- Date Modified is unchanged on the seed and on an owned item.
- Abstracts are kept.
- An owned item is in the collection through the title match.
- Trashed and erased matches become creates (9 created, 1 linked).
- A second import creates 0 and links 10.
- A failed seed save is reported not thrown, the items stay, and no relation remains.
- An erased seed is reported and the items stay.

All proved in the flow spec:

- Import is on, and the box is shown and ticked.
- The radios are hidden and the preprint sentence is shown.
- The target is `new:Related to “P5-T16 the seed”`.
- 3 items are written and related, with the owned item's date unchanged, the table left up and Export hidden.

`menus.spec.ts` passes.

### P5-T25

| Line | Result |
|---|---|
| 1. The four proofs compile and pass | Proved. The cancel proof changed its pipeline; see Defects 7 |
| 2. Keyless run sends nothing to `api.semanticscholar.org` | Proved: real adapter, no key, rows drawn, `keyNotice` true, no non-loopback URL through `Zotero.HTTP.request` |
| 3. Cancel stops within one request | Proved: 4 requests in flight at the cancel, 0 started after it; ended 145, 166 and 153 ms later, with doubles taking 200 ms |
| 4. Egress record through the real queue | Proved for a transport failure and an answer: record `succeeded`, one each, input keys `collectionKey, egress, libraryID, mode`, no paper title |
| 5. `lexicalSpace` time through `scoreMs` | Measured 2, 2 and 3 ms, on 40 stub candidates and 6 members. This is not a real-scale figure; `P5-T30` reads the real one |

The keyless run kept 4 rows because all stub candidates share one venue and `MAX_PER_VENUE` is 4. That is test data, not a defect.

### P5-T32

"reads a type's own field names as a work's container and date" passes in all three runs, covering all its lines. Proved.

## Defects

1. **A left related run raised a toast (product).**
   - Cause: `CompositeProgressReporter` answers its token's cancel with `done("cancelled")`, and `ZoteroProgressWindowSink` paints any terminal snapshot, below the view model's own check. A fake job could not see this.
   - Measured before the fix: 1 toast on re-open.
   - Fix: `createRelatedViewModel`'s `leaveRun` closes the job's surfaces before it cancels. It leaves the token alone while `openJob` is out. The import checks it is still current before opening a job. The Cancel button keeps its toast.
   - Tests: a new block in `test/unit/ui/relatedViewModel.test.ts` on the real reporter, and `relatedWindow.spec.ts` plus `lifecycle.spec.ts` in Zotero.
   - One existing test named "lets go of a job opened…" pinned the old behaviour. It now asserts the stronger "opens no job".
2. **Source text in a Fluent argument was parsed (product).** See the markup check below.
   - Fix: `logic.fluentText` escapes `&` and `<` for the in-library title and for author names at both overflow sites.
   - Tests: unit tests and `relatedWindow.spec.ts`.
   - Hand mutation for defects 1 and 2 on a scratch copy: 11 of 11 killed, control 390 passed.
3. **Two report specs sent live requests (test suite).**
   - Cause: `reportWindow-flow.spec.ts` and `reportMeasurement-flow.spec.ts` run a real summary stage, whose full-text ladder asks Europe PMC by DOI. The guard cancelled 77 channels. That slowed the stage past a 60 s wait and stopped that run at 75 tests.
   - Fix: both use the new `answerEuropePmcWithNothing`.
4. **Zotero's own retraction lookup left the machine (test setup).**
   - Saving an item with a DOI asks `api.zotero.org/retractions/search`.
   - Fix: `zotero-plugin.config.ts` `test.prefs` sets `extensions.zotero.retractions.enabled` to false.
5. **l10n test gap.** `rh-error-recommend-too-few-items` is thrown as a plain serialized error with no class. The spec now names it.
6. **Picker stand-in (spec).** It drew in `connect`, and `init()` then showed the initial panel. It now draws in `run`, as the real view model does. No assertion was weakened; one-choice was added.
7. **Cancel proof across bundles (spec).** A spec's token given to the plugin bundle's pipeline ended `failed` with `{"code":"UNTYPED","detail":"non-Error throw"}`. The proof now builds the pipeline in the spec's bundle through `buildPipelineSet`, and also asserts that nothing is read or sent. The plugin bundle's own pipeline with a plugin-made cancel is therefore not run in this proof.

## The two added checks

### No live request (item 347(c))

The existing guards did not cover a real window starting its own run: there was only the `Zotero.Translate.Search` stub and two recorders scoped to one body each. So a guard was added.

- **`test/integration/support/liveRequestGuard.ts`:** an `http-on-modify-request` observer cancels any channel with the plugin's `User-Agent` away from loopback, or to a host on `LIVE_SERVICE_HOSTS`. The root `afterEach` then fails the test. Its self-test checks the channel's status is `NS_BINDING_ABORTED`.
- **Result in all three final runs:** 1107 channels read, none cancelled. Hosts let through were the runner's `localhost` and the closed `127.0.0.1:59321`. Away from loopback: nothing.

### Markup in a title (item 347(d)), in a real window

Drawn before the fix:

| Source text | Drawn |
|---|---|
| `<img src=x onerror=y>` | Nothing; the words were lost. No `img` element |
| `<a href="https://example.invalid">x</a>` | Plain text `x`. No `a` element |
| `<em>x</em>` | An `em` element with no attribute |
| `A &amp; B &lt;c&gt;` | `A & B <c>` |
| `p < 0.05 & q > 1` | As written |

By the brief's line this was not a security defect: only plain text or an inert safe-listed element appeared. It was still fixed, because words were lost and the row differed from every other row. DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313).

After the fix, each of these draws as written with no element, including author names in the row and on the seed. The `.value` mode chip is an attribute, is never parsed, and is unchanged.

`citation-context` holding all three markups draws no element, both before and after the fix: it is `textContent`, with the same words in the `title` attribute.

## The mutants reading

Each one would now be caught:

| Mutant | Caught by |
|---|---|
| `iw-no-known` | Linkage spec: 8 created versus 9 |
| `iw-unchecked-known` | Trashed and erased tests |
| `iw-created-only`, `iw-linked-only` | `seedLink` linked 10, and both-way relations of all 10 |
| `iw-no-report` | Asserted `report.seedLink` |
| `wire-pref` | Was uncaught. Assertion added: preference false gives an unticked box |
| `wire-library` | Was uncaught, because the user library's id is 1. Test added: an import from a real group seed lands in that group, related both ways, with nothing in the user library |
| `wire-no-url` | The `xhtml` has no static `href`, the flow spec asserts `https:`, and the launch must equal the real address |

No real mutation of these was run in Zotero, as the brief allowed.

## Static checks, on the final tree

- `npm run typecheck`: `tsc --noEmit`, exit 0.
- `npx eslint .`: exit 0, no output.
- `npm run lint:check`: exit 0, "All matched files use Prettier code style!"
- `npm run test`, exit 0:
  - Unit: "Test Files 134 passed (134)", "Tests 7360 passed | 105 skipped (7465)".
  - Contract: "Test Files 6 passed (6)", "Tests 84 passed | 28 skipped (112)".

## Integration runs on the final tree

Each run used `OPENROUTER_API_KEY` removed and `NODE_USE_SYSTEM_CA=1`. Before each: the `/* MUTANT` grep was 0 lines and no test-profile Zotero was running.

| Run | Passed | Failed | Pending | Duration | Hash before | Hash after |
|---|---|---|---|---|---|---|
| 1 | 316 | 0 | 2 | 277 s | `ec0675db45513f3c` | `ec0675db45513f3c` |
| 2 | 316 | 0 | 2 | 279 s | `ec0675db45513f3c` | `ec0675db45513f3c` |
| 3 | 316 | 0 | 2 | 282 s | `ec0675db45513f3c` | `ec0675db45513f3c` |

- **Pending:** the real PubMed search in `phase1-dod`, and the 10 000-item index.
- **Runs that do not count:**
  - The first exploratory run: 289 passed, 3 failed.
  - An earlier three-run attempt stopped at its run 1: 75 passed, 2 failed. That is how defect 3 was found, and it rests on one run. Its cause was then fixed, not repeated.
  - One whole run on a scratch copy with the guard reporting only: 316 passed, no incident.
- **ko-KR:** 353 present, 48 absent; expected 353 / 48. Recorded in `plan/06`.

## Screenshots

Taken in a throwaway run, test profile only, by drawing the window to a canvas. They use fixture data with no real library:

- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round350\related-light.png`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round350\related-dark.png`

Both show a readable table, greyed older row, in-library row with its markup as text, and clamped context. They predate the last fixes to the report specs and the guard, none of which touch the window.

## Files changed

All are under `D:\KIST\projects\research_helper`.

**Product**
- `src\llm\types.ts`, `src\llm\router.ts`, `src\pipeline\recommend\profileCall.ts`, `src\pipeline\recommend\recommendPipeline.ts`: egress before the send.
- `src\ui\viewModels\relatedViewModel.ts`: no toast from a left run.
- `addon\content\searchDialog.js`: `fluentText`, used at three sites.

**Test setup**
- `zotero-plugin.config.ts`: retraction lookups off in test runs.

**Tests**
- `test\integration\support\liveRequestGuard.ts` (new): the guard and the Europe PMC double.
- `test\integration\_suite-guards.spec.ts`: installs the guard, its self-test, the run's log line.
- `test\integration\relatedWindow.spec.ts` (new): markup, a run's end, `wire-pref`, `wire-library`.
- `test\integration\searchDialog-flow.spec.ts`: P5-T16 lines 4 to 10 and 14, picker stand-in.
- `test\integration\lifecycle.spec.ts`: shutdown during a run.
- `test\integration\zotero\recommendLibrary.spec.ts`: P5-T25's run proofs, the moved cancel proof.
- `test\integration\reportWindow-flow.spec.ts`, `test\integration\reportMeasurement-flow.spec.ts`: Europe PMC doubled, untrue header corrected.
- `test\integration\l10n.spec.ts`: names the classless error id.
- `test\unit\integration\liveRequests.test.ts` (new): the pure guard rule.
- `test\unit\llm\router.test.ts`, `test\unit\pipeline\recommendPipeline.test.ts`, `test\unit\pipeline\recommendProfileCall.test.ts`: egress.
- `test\unit\ui\relatedViewModel.test.ts`: left-run toast.
- `test\unit\ui\searchDialog.test.ts`: `fluentText`.

**Documents (dated 2026-11-05)**
- `docs\07-architecture-and-data-model.md`: §4.3 and §12.5 item 8.
- `docs\08-ui-ux-spec.md`: §5.2 toast correction, markup measurement and decision, layout and contrast figures, P5-T17 note corrected.
- `docs\13-testing-build-and-release.md`: §2.3 rows and measured notes.
- `plan\06-human-gates.md`: the `G-41` count.

## Korean table

None. This round added no user-visible string.

## Findings

1. **The recommend egress log fails open and summarize fails closed.** The pipeline's `noteEgress` catches a queue failure, warns and goes on, as `docs/07` §12.5 item 8 says, so a request can go with no entry if the queue refuses. `summarizePipeline.ts` stops when `enqueue` fails. The record's `succeeded` says only that the log was written. Recorded in the note, unchanged.
2. **Two more Fluent arguments are still parsed, by reading only.** `research-helper-search-state-empty` carries `$query`, and `research-helper-search-rerun-heading` carries `$collection`. Both are the user's own text, and the worst measured outcome is an inert element or lost words. A new collection's name now carries a seed's title, so a marked title could reach the second one. Not changed, and this blocks no finishing condition. The summarize and report windows were not read for the same pattern.
3. **The keyword search window may raise the same left-run toast.** `searchImportViewModel.ts` uses the same reporter with `openOn: "completion"`. Not measured in this round.
4. **One guard failure hides everything after it.** A root `afterEach` that throws ends the whole Mocha run, as the existing translate guard's does. A failing run can show far fewer tests than the suite holds, as the 75 above did.
5. **Earlier rounds' reports may overstate "no live request".** Until today a full integration run sent Europe PMC and retraction requests holding fixture DOIs and no key. Their test results are not put in doubt by this, but the claim is.

## What was not checked

- The real picker on title-match data (`P5-T30`).
- Any real keyed path, since no key was used.
- Selected and hover row contrast.
- `scoreMs` at real scale.
- The plugin bundle's own recommend pipeline ending Cancelled on a plugin-made token.
- The number of live requests in the first exploratory run.
- The keyword window's toast (finding 3), and the other windows' Fluent arguments (finding 2).
- Real Europe PMC answers in the report specs, which now get a canned "no such paper".

`.env` was read for variable names only, and `OPENROUTER_API_KEY` was named and removed, never read. The scratch copy of the tree is removed.

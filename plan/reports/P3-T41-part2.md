# P3-T41 part 2 — The held-out record and what it switches on

(Saved at D:\KIST\projects\research_helper\plan\reports\P3-T41-part2.md. Card `P3-T41` steps 5 and 6.
The one held-out measurement, step 4, was the coordinator's; its printout is
`plan/reports/imrad-heldout-measurement-2026-11-13.md`. Every figure below is read from that file.
The held-out measurement was **not** run again.)

**Findings.** The held-out figure is now recorded in the code. It is **92.94 %** of counted
characters put in the right section (589,282 of 634,062, over the 15 held-out papers with a normal
paper structure), measured on 2026-11-13 on commit 257b244, which meets the 85 % bar. That record
turns the validation flag (`IMRAD_DETECTOR_VALIDATED`) on. So the product now passes the section
detector's sections on: a full-text paper where the detector recognizes two or more sections is
acquired with `sectionAware: true`; a paper too long for one call is chunked by section; and the
full-text prompt keeps its sentence saying the sections are labelled. The first-set figure, 93.61 %,
is tuned and is a regression pin only; the held-out 92.94 % is the validation figure. **One thing is
open:** a paper short enough for one call (39 of the first set's 40) is sent without any
`[SECTION: …]` label in its text, so on that path the restored sentence describes labels that are not
there (section 4 below). No recorded model answer needs the owner.

## 1. The record

`src/pipeline/summarize/imrad.ts`, `IMRAD_HELDOUT_MEASUREMENT`:

| Field | Value | Source in the printout |
|---|---|---|
| `measuredOn` | `2026-11-13` | the run's timestamp, 2026-11-13T07:02:41Z |
| `set` | `"heldout"` | `--set heldout` |
| `path` | `"pdf-without-structure"` | "detectSectionsFromPdf(text, null)" |
| `papers` | 15 | "15 papers with IMRaD structure" |
| `countedChars` | 634,062 | "of 634062 counted characters" |
| `correctChars` | 589,282 | "589282 of" |
| `commit` | `"257b244"` | the brief and the report's first line |

The type stays `ImradHeldoutMeasurement | null`, so withdrawing the record (setting it back to `null`)
would turn the flag off again. `detectorValidatedBy` and `IMRAD_DETECTOR_VALIDATED` are unchanged
code; the flag is now true because the record is there.

## 2. Behaviour that changes

| Where | Before (record `null`) | Now |
|---|---|---|
| `acquireSource` (`src/pipeline/summarize/acquire.ts`) | always `sectionAware: false`, no sections | the detector's answer: `sectionAware: true` and its sections when it recognizes two or more; otherwise still `false` and none |
| The two pipelines (`summarizePipeline.ts`, `trendReportPipeline.ts`) | pass `imradDetectorValidated: false` to `summarizeItem` | pass `true` (they read the constant; no code change) |
| The chunker (`planChunks`, `src/llm/shared/chunking.ts`) | always the flat path | the section-aware path for a section-aware paper over the single-shot budget: sections in synthesis-value order, budget shares, chunk labels `[SECTION: x]` |
| `PAPER_SUMMARY_FULLTEXT` (`fullTextPromptFor`) | the clause "; sections are labelled [SECTION: name]" always dropped | kept for a section-aware paper, dropped otherwise |
| The pre-run estimate (`planItem`, `src/pipeline/shared/estimate.ts`) | priced the flat plan for every known-flat item | prices the section-aware plan for a section-aware item (more calls for a long paper, as `docs/06` §5.4's note of 2026-10-27 measured) |
| `scripts/measure-imrad.ts` | a held-out run under the flag printed the figure against the bar only | a held-out run is also checked against `IMRAD_HELDOUT_MEASUREMENT` (`recordFor`, `checkAgainstRecord`), and its printout names that record, its date and commit |

No preference, default or prompt file changed. The owner's `G-22` choice of 2026-11-10 (whole-document
chunking without labels) now stands only as the fallback.

## 3. Callers and tests that assumed the flag false

- `test/unit/pipeline/imradAccuracy.test.ts`: the test "is false while no held-out measurement is
  recorded" is removed and replaced by "records the one held-out measurement of 2026-11-13, and so is
  true", which pins all seven fields, the 92.94 %, and the flag. The degrade-switch test that expected
  the default to be flat is split in two: the default now passes the sections on; with
  `imradDetectorValidated: false` the acquisition is flat and the detector's own answer is still
  logged. A new block tests `recordFor` (each set gets its own record), the held-out reproducibility
  check (passes on the recorded totals, fails one character below, on a different paper count, or on
  a different character count), and the printed sentence. All on synthetic totals; nothing reads the
  held-out set.
- `test/integration/zotero/imradStructure.spec.ts`: the "product default is flat" check now says the
  default is section-aware with the same sections, and the flat check moved to the switch turned off.
- `test/unit/pipeline/summarizeItem.test.ts`: one title, "runs flat until G-22" → "runs flat without
  imradDetectorValidated" (the test is of `summarizeItem`'s own default, which is unchanged).
- `test/unit/pipeline/imrad.test.ts`: one comment.
- Comments: `acquire.ts` (module note and the override's note), `summarizeItem.ts` (module note and
  `SummarizeItemDeps.imradDetectorValidated`), `chunking.ts` (module note), `imrad.ts`,
  `measure-imrad.ts` (module note, exit status, `formatMeasurement`).

No other unit, contract or integration test depended on the flag: the full suites passed unchanged
apart from the above.

## 4. Open: the section sentence on the single-shot path (for the coordinator)

`summarizeItem` sends a paper that fits one call as `AcquiredSource.text` (`vars: { …, FULL_TEXT:
source.text }`). That text carries no `[SECTION: …]` label; only the chunked path labels text (each
chunk's label line, `docs/06` §5.3 step 5). `docs/12` §5's input table says `{{FULL_TEXT}}` is
"section-labelled text", and its note of 2026-10-28 reading (3) says it is sent "with no `[SECTION: …]`
label while the chunker runs flat" — which was true of every paper until today and is true of every
single-shot paper still. With the flag on, a section-aware single-shot paper's prompt now says
"sections are labelled [SECTION: name]" about a text with no such label. On the first set, 39 of 40
texts fit one call (`docs/06` §5.3, "Measured 2026-10-27"), so this is the common case.

Two ways out, neither done here because each is a design change outside this card:
- **(A)** label the single-shot text by section. Changes the text sent, so its content hash and the
  grounding check's source text; `docs/06` §5.3 and §7.2, `docs/12` §5.
- **(B)** have the prompt selector drop the clause on the single-shot path as well (pass `false` to
  `fullTextPromptFor` there). One line in `summarizeItem`; the clause would then be sent nowhere,
  since `PAPER_SUMMARY_FULLTEXT` is used only on the single-shot path.

(B) is the smaller and keeps every prompt true; (A) is what the prompt's wording assumes. Recorded in
`docs/12` §5's note "Updated 2026-11-13" and `plan/00` §6 item 377(d).

## 5. Cache, chunker, fixtures

- **Summary cache key** (`keyInput`, `src/pipeline/summarize/summaryCache.ts`) has no `sectionAware`
  component and keys each prompt by its `cacheEpoch`, which did not change. So a single-shot summary
  cached while the clause was dropped is still a hit for the same text, as `docs/12` §5's decision of
  2026-11-10 reading (1) intended. A chunked paper's key does change, because `CHUNK_REDUCE`'s key
  carries the chunk layout with each chunk's section name (`CHUNKS`); such a paper is summarized again
  on its next run, at the section-aware plan's cost. Nothing changed in the cache.
- **Chunker (`P3-T23`)**: its section-aware path was built and unit-tested before the flag existed
  (`test/unit/llm/chunking.test.ts`); nothing in it changed. It is now reached by the product.
- **Recorded model answers**: none needs re-recording. The contract snapshots
  (`test/contract/llm/__snapshots__/*.snap`) hold the abstract prompt only, and the LLM fixtures in
  `test/fixtures/llm/` are error and refusal replies. No recording of a full-text, map or reduce
  request exists. Nothing needs the owner's key.

## 6. Documents (dated notes)

- `docs/06` §4.3: new note "Measured 2026-11-13 (held-out)" — the overall figure, by family, column
  count and preprint/published, the four papers without IMRaD structure apart (81.73 %), the plain
  statement that 93.61 % is tuned and 92.94 % is the validation figure, the item 376(e) caveat, and
  `G-22`'s choice now the fallback. Dated pointers on the "Unverified" marker and on the owner's
  `G-22` note. §5.3's as-built note (1) and §5.4's critical-path note updated.
- `docs/12` §5: the 2026-11-10 decision gets a pointer, and a note "Updated 2026-11-13" says the
  clause is no longer suppressed by default, what the cache does, and the open point of section 4.
- `docs/11`: R-19b's row gains "Retired by measurement 2026-11-13", with what the measurement does
  not cover (the outline path; four families below the bar on one or two papers each). Phase 3's
  deliverable line and "Risks retired" line, and §3.1's Phase 3 row, gain dated notes saying the
  first branch (detector validated) is the one met; "the phase itself is not done".
- `docs/spikes/imrad-accuracy-report.md`: a pointer at the top, one in the tuned section, and a new
  last section "Held-out measurement, 2026-11-13" with both figures side by side, the breakdowns,
  every paper, and the caveat.
- `plan/06` `G-22`: dated note — the held-out measurement met the bar; the choice stands only as the
  fallback; only the owner marks the gate done.
- `plan/04` `P3-T41`: dated note listing the files step 5 touched outside the card's Files list.
- `test/fixtures/imrad-heldout/README.md`: one dated line with the figure.
- `plan/00` §6: item 377, inserted after item 376; `npm run index:derive` then ran (header 219
  tasks, 112 DONE; only the item was added). No card is set to DONE.

**Item 376(e)'s caveat**, written into `docs/06`, `docs/11`'s row by reference, the spike report and
item 377: the part-1 agent had read item 375(a)'s held-out heading names and added no row from them;
"Related work" was already in the table and "STAR Methods" comes from item 364(a), and both happen to
cover held-out headings (HS1's "Related work", in a paper without IMRaD structure, and HE1's
"STAR★METHODS").

## 7. Files changed

All under D:\KIST\projects\research_helper.

| File | Change |
|---|---|
| src/pipeline/summarize/imrad.ts | `IMRAD_HELDOUT_MEASUREMENT` set; module note and two doc comments |
| scripts/measure-imrad.ts | `recordFor`, `recordName`; `main` checks a held-out run against its record; printout names the record and commit; module note |
| src/pipeline/summarize/acquire.ts | comments only |
| src/pipeline/summarize/summarizeItem.ts | comments only |
| src/llm/shared/chunking.ts | comment only |
| test/unit/pipeline/imradAccuracy.test.ts | the pin, the record-check tests, the split degrade-switch test, header |
| test/unit/pipeline/imrad.test.ts | one comment |
| test/unit/pipeline/summarizeItem.test.ts | one test title |
| test/integration/zotero/imradStructure.spec.ts | product default now section-aware; flat check with the switch off |
| docs/06-summarization-and-trend-report.md | §4.3, §5.3, §5.4 |
| docs/11-implementation-roadmap.md | Phase 3 (§1), R-19b, §3.1 |
| docs/12-prompt-library.md | §5 |
| docs/spikes/imrad-accuracy-report.md | new last section, two pointers |
| plan/06-human-gates.md | G-22 |
| plan/04-phase-3-llm-summaries.md | P3-T41 dated note |
| plan/00-task-index.md | item 377 (and the derive) |
| test/fixtures/imrad-heldout/README.md | one dated line |

Nothing was committed. `plan/reports/imrad-heldout-measurement-2026-11-13.md` was already untracked
and is unchanged.

## 8. Checks

All commands ran as `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY …`.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 (eslint, and Prettier: all files formatted) |
| `npx eslint .` | exit 0 |
| `npm run test` (unit) | 139 files, 7,808 passed, 105 skipped, 0 failed |
| `npm run test` (contract) | 6 files, 84 passed, 28 skipped, 0 failed |
| `npm run build` | exit 0 |
| Typings hashes before and after the build | identical, and identical to the start of the session: global 020956c7…, i10n a787e3c9…, prefs a9aa2d93…, prompts 4480d796…, zotero-augment cf994969… |
| `npx tsx scripts/measure-imrad.ts` (first set) | exit 0, 93.61 %, "Recorded value (IMRAD_MEASUREMENT, 2026-11-13) … not below it" |
| `npx tsx scripts/measure-imrad.ts --set heldout` (no flag) | exit 3, the refusal: nothing read, no detector ran |
| Integration run 1 (16:19–16:26) | 355 passed, 0 failed, exit 0 |
| Integration run 2 (16:26–16:33) | 355 passed, 0 failed, exit 0 |
| Integration run 3 (16:33–16:39) | 355 passed, 0 failed, exit 0 |

Before each integration run the case-sensitive grep for `/* MUTANT` over src, test and scripts was
empty and no zotero.exe with `.scaffold\test\profile` on its command line was running (checked by
`scratchpad\t41b-integ.sh`). No Zotero process is running now.

The held-out measurement with `--final-heldout-measurement` was **not** run.

## 9. Not done

- The open point of section 4 (the section sentence on the single-shot path): reported, not changed.
- No mutation sweep of the new record check.
- The outline (document-structure) path is still not measured; the fixtures are text only.
- `CHUNK_REDUCE`'s rule 3, reported by `P3-T22`, now meets real section names on the chunked path;
  nothing to change, noted only.
- No card's State changed.

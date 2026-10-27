## VERDICT
Both owner rulings of plan/00 §6 item 299 are applied. Every check passes, and nothing was committed. All card states stay TODO.

- **(a) Step 3's cut-off.** It is now ruled at 0.5. The PROPOSAL markers are gone, with a dated trace kept, and docs/06 §5.3 step 3's "guaranteed by D-06-4" is corrected.
- **(b) The pre-run estimate.** It now counts the chunks the chunker would plan, so it no longer under-states a chunked paper:
  - **Sections known:** it prices exactly what `planChunks` plans.
  - **Sections not known:** it prices the chunker's worst case, 13 `CHUNK_MAP` calls (`MAX_CHUNKS`), capped at what 13 chunks can carry.
  - The budget constants are defined once, in `src/llm/shared/chunking.ts`, and `estimate.ts` re-exports them. `pipeline/` may import `llm/`, so the layering rule allows this.
  - The test that pinned the duplicate constants is removed.

**Behaviour change to know about.** A paper whose sections the caller does not pass is now always priced at 13 map calls. Callers should pass each acquisition's `sectionAware` and `sections` to get the exact figure: `estimateRun` from P3-T29's pipeline and `estimateReportRun` from P4-T18 (neither is built yet).

## FILES CHANGED WITH DECLARATION NAMES
- **modified `D:\KIST\projects\research_helper\src\llm\shared\chunking.ts`**
  - Constants and types now defined here: `MAP_CALL_BUDGETS`, `MapCallKind`, `CallBudget`, `ESTIMATE_HEADROOM`, `CHUNK_OVERLAP_TOKENS`.
  - Removed: `SINGLE_SHOT_INPUT_TOKENS`, `CHUNK_INPUT_TOKENS`, `REDUCE_INPUT_TOKENS`, `MAX_OVERLAP_TOKENS`, `TOKEN_HEADROOM`.
  - `PlanChunksOptions.prompts` is now optional. Without a registry, `MAP_CALL_BUDGETS`' output ceilings apply; they are the same §5.2 figures, and a test asserts they match the prompt files.
  - New `labelReserveTokens` and `ChunkedPlan.labelReserveTokens`.
  - `PARAGRAPH_LINE_SHARE_CUTOFF`, `measureLineShape` and the module note: PROPOSAL wording removed, ruling noted.
- **modified `D:\KIST\projects\research_helper\src\pipeline\shared\estimate.ts`**
  - Re-exports `CHUNK_OVERLAP_TOKENS`, `ESTIMATE_HEADROOM`, `MAP_CALL_BUDGETS`, `CallBudget` and `MapCallKind`.
  - `EstimateItem.source` may now also carry `itemKey`, `sectionAware` and `sections`.
  - `EstimateRunInput` and `EstimateReportRunInput` gain an optional `contextWindowTokens`.
  - `planItem` gains an optional 5th parameter (`ChunkModel`).
  - `fullTextCalls` is rewritten on top of `planChunks`, and `estimateReportRun` passes the window through.
  - These types are not declared in docs/07, so docs/07 is unchanged.
  - Callers (rule 10): `estimateRun` is called by P3-T29's pipeline and `estimateReportRun` by P4-T18, both not built yet. The product already loads the module through `src/bootstrap/registerUI.ts`, so `chunking.ts` is now in the startup bundle.
- **created `D:\KIST\projects\research_helper\test\support\syntheticPaper.ts`** — `sentence`, `flowing`, `hardWrapped`, `paper`, `SectionSpec`, `SIXTY_K`. These moved out of the chunking test so both tests share them.
- **modified `D:\KIST\projects\research_helper\test\unit\llm\chunking.test.ts`**
  - The duplicate-pinning test is replaced by a test of D-06-5's figures.
  - New: "plans the same without a prompt registry"; "cuts at the owner's 0.5"; the fixture list adds S4 (sentence) and B4 (paragraph), the nearest texts on each side of the gap.
- **modified `D:\KIST\projects\research_helper\test\unit\pipeline\estimate.test.ts`**
  - The old chunk test now expects the worst case (13 map calls).
  - New describe block "chunked papers as the chunker plans them (docs/06 §5.4, item 299(b))", 9 tests: the 30,830-token paper, sections known and unknown; flat plan exact; unknown ≥ known for 5 sizes × section-aware or flat; the 13-chunk ceiling in both directions; window followed; window passed through `estimateReportRun`.
- docs/06 and plan/04: quoted below.

## SHARED-FILE EDITS QUOTED
Each file was re-read immediately before its edit.

**docs/06 §5.3 step 3** now reads:
> 3. Within a section, split on paragraph boundaries ~~(`\n`, guaranteed by D-06-4)~~. *Corrected 2026-10-27 (owner, `plan/00` §6 item 299(a)): `\n` is not guaranteed to be a paragraph boundary (D-06-4 as corrected, §3.3.5). Each document is measured first: when its `\n`-delimited segments of at least 200 characters hold at least half of its characters, a `\n`-delimited segment is a paragraph; otherwise `\n` is a line break and the unit is the sentence (`measureLineShape`, `PARAGRAPH_LINE_SHARE_CUTOFF` 0.5, `src/llm/shared/chunking.ts`; measured in the note below).* Greedily pack … (rest unchanged)

**docs/06 §5.3 "Measured 2026-10-27" note.** The sentence `Step 3's "(`\n`, guaranteed by D-06-4)" is left as written until the owner rules.` became:
> ~~Step 3's "(`\n`, guaranteed by D-06-4)" is left as written until the owner rules.~~ **Decided 2026-10-27 (owner, `plan/00` §6 item 299(a)):** ruled as recommended, with the 0.5 cut-off; "proposed" above is the trace of how it was built, and step 3 is corrected in place.

**docs/06 §5.4**, added after the paragraph ending "…~280 k input and ~56 k output.":
> **Decided 2026-10-27 (owner, `plan/00` §6 item 299(b)): the estimate counts the chunks the chunker would plan.** Until this date the pre-run estimate (`estimateRun`, `src/pipeline/shared/estimate.ts`, `P3-T16`) priced a paper over the single-shot budget as ⌈(tokens − 250) ÷ 5 750⌉ `CHUNK_MAP` calls — the flat path's count with no ceiling. That under-states the section-aware path, where every section starts a chunk of its own (a synthetic 30 830-token paper: 12 chunks, against 6 by the old count), and over-states a paper too long for §5.3's 13-chunk ceiling, of which only 13 chunks can be sent. Now the estimate asks `planChunks` (§5.3, `src/llm/shared/chunking.ts`) with the same budget constants, which are defined once, there (`MAP_CALL_BUDGETS`, `ESTIMATE_HEADROOM`, `CHUNK_OVERLAP_TOKENS`): (1) **sections known** — the item carries its acquisition's `sectionAware` and `sections` — the estimate prices exactly the plan's calls, each `CHUNK_MAP` call carrying its prompt overhead, its label and its chunk; (2) **sections not known** — the worst case the chunker can produce for that text: the section-aware path with every section starting its own chunk, so `MAX_CHUNKS` (13) `CHUNK_MAP` calls, carrying between them at most what 13 chunks hold and at most the text, every overlap, and one token of rounding per chunk; it is never below the flat path's count. Either way one `CHUNK_REDUCE` follows. A model's context window, when the caller passes it, applies as in §5.2; without it the column alone applies, as in the chunker. Measured the same day (one paper each, 3 000 tokens of overhead per call as in the worked example, $3 / $15 per M tokens; calls include the reduce): the synthetic 30 830-token paper went from 7 calls and $0.307 to 13 calls and $0.466 with its sections, 14 calls and $0.503 without them, and stays at 7 calls ($0.305) when known to be flat; `P3-T20`'s O3 text (25 865 tokens, sections not known) from 6 calls and $0.262 to 14 calls and $0.486; a 150 016-token text from 28 calls and $1.260 to 14 calls and $0.655, the 13 chunks that can be sent.

**plan/04, P3-T23**, added after the "Open — recommended" line:
> **Decided 2026-10-27 (owner, `plan/00` §6 item 299(a)):** as recommended, with the cut-off at **0.5** (`PARAGRAPH_LINE_SHARE_CUTOFF`): a text whose `\n`-delimited segments of at least 200 characters hold at least half its characters is cut by paragraph; otherwise `\n` is a line break and the unit is the sentence. Measured on `P3-T20`'s 40 texts (6 at most 0.191, 34 at least 0.664); `docs/06` §5.3 step 3 is corrected.

**plan/04, P3-T23 "As built" note**, now reads:
> `options` carries the prompt registry (`max_tokens` through `resolveMaxTokens`; optional since item 299(b), when the estimate calls without one and `MAP_CALL_BUDGETS`' ceilings apply), the caller's measured prompt overheads, an optional token counter and the retry's `budgetScale`. … Step 3 is built on the open line's recommendation, with the cut-off of 0.5 (`PARAGRAPH_LINE_SHARE_CUTOFF`) measured on `P3-T20`'s 40 texts (`docs/06` §5.3, "Measured 2026-10-27"); ~~the owner's ruling is still open~~ ruled as recommended the same day (owner, `plan/00` §6 item 299(a), the note under the open line).

**plan/04, P3-T16 Notes**, added:
> **Corrected 2026-10-27 (owner, `plan/00` §6 item 299(b)):** step 1's chunked count was the flat path's ⌈(tokens − 250) ÷ 5 750⌉ `CHUNK_MAP` calls with no ceiling, which under-states a section-aware paper (every section starts a chunk of its own) and over-states one past the 13-chunk ceiling. `estimateRun` now asks `planChunks` (`P3-T23`, `src/llm/shared/chunking.ts`): with the item's `sectionAware` and `sections` it prices exactly that plan; without them it prices the worst case the chunker can produce — `MAX_CHUNKS` calls carrying at most what they can hold. The budget constants (`MAP_CALL_BUDGETS`, `ESTIMATE_HEADROOM`, `CHUNK_OVERLAP_TOKENS`) are defined once in `chunking.ts` and re-exported here; `EstimateItem.source` may carry `itemKey`, `sectionAware` and `sections`, and `EstimateRunInput` / `EstimateReportRunInput` an optional `contextWindowTokens`. Recorded in `docs/06` §5.4 ("Decided 2026-10-27"). Files: modify `src/pipeline/shared/estimate.ts`, `src/llm/shared/chunking.ts`, `test/unit/pipeline/estimate.test.ts` and `test/unit/llm/chunking.test.ts`; create `test/support/syntheticPaper.ts` (the synthetic papers both tests use). Callers unchanged: `estimateRun` by `P3-T29`'s pipeline, `estimateReportRun` by `P4-T18`, neither built yet; they pass the acquisitions' sections and the model's window.

**plan/04, P3-T25 Notes**, added:
> **2026-10-27 (from `P3-T23`'s report, `plan/reports/P3-T23.md`; for this card, not built there):** (1) on the section-aware path `planChunks` returns chunks in synthesis order, while `CHUNK_REDUCE`'s user text says "CHUNK EXTRACTIONS (JSON array, in document order)"; every `TextChunk` carries `start`, so sort the `CHUNK_MAP` answers by it before rendering `CHUNK_REDUCE`. (2) `docs/06` §13.5's halve-and-retry (`runWithContextRetry`) does not help a context-length error raised by the `CHUNK_REDUCE` call itself: halving the chunk budget makes more chunks and so a larger reduce input. This card decides what such an error does.

**Not touched:** docs/07, card table fields, and plan/00 by hand.

## DOC NOTES ADDED
The docs/06 §5.3 step 3 correction, the docs/06 §5.3 trace edit, the docs/06 §5.4 "Decided 2026-10-27 (owner, item 299(b))" note, the P3-T23 "Decided … 299(a)" note and its As-built trace, the P3-T16 correction and the P3-T25 note, all quoted above. No new user-facing strings.

## ESTIMATE BEFORE / AFTER
Example papers, one per run. Settings: overhead 3,000 tokens per call, $3 / $15 per million tokens, "always" mode, raw heuristic. The "before" figures come from the committed `estimate.ts` at HEAD. Calls include the reduce.

| Paper | Before | After |
|---|---|---|
| Synthetic 30,830 tokens, sections unknown | 7 calls, 58,480 raw input, 7,000 output, $0.307 | 14 calls, 87,874 raw input, 13,300 output, $0.503 |
| Same paper, sections known (section-aware) | 7 calls, $0.307 | 13 calls, 81,182 raw input, 12,400 output, $0.466 |
| Same paper, known to be flat | 7 calls, 58,480 raw input, $0.307 | 7 calls, 58,068 raw input, $0.305 |
| Synthetic 60,938 tokens, sections known (section-aware) | 12 calls, 109,338 raw input, $0.550 | 14 calls, 106,367 raw input, $0.566 |
| O3 fixture text (25,865 tokens), sections unknown | 6 calls, 49,365 raw input, $0.262 | 14 calls, 83,105 raw input, $0.486 |
| Flowing text, 150,016 tokens, sections unknown | 28 calls, 252,516 raw input, $1.260 | 14 calls, 131,934 raw input, $0.655 (the 13 chunks that can be sent) |

## RUNS
- `npm run typecheck`: exit 0.
- `npm run lint:check`: exit 0. eslint is clean and prettier reports "All matched files use Prettier code style!". The red lint from the first run is gone now that P3-T30 has finished.
- `npx eslint .`: exit 0.
- `npm run test`: unit 91 files and 4,381 tests passed; contract 6 files, 84 passed and 28 skipped.
- `npm run build`: exit 0. The five `typings/*.d.ts` hashes are unchanged across the build and the integration runs, and identical to the session start.
- `npm run index:derive` twice: plan/00 is byte-identical after each run.
- **Integration**, needed because `estimate.ts` is loaded by the product through registerUI. Three runs of `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`, each after a pre-flight that found the MUTANT grep empty and no zotero.exe with `.scaffold\test\profile` on its command line. All three: exit 0, "Test run completed - 208 passed". Nothing was killed, and no test-profile Zotero was left running afterwards.
- **Mutants**, each marked `/* MUTANT id */`, restored by copy and verified by hash:
  - estimate.ts, 9 mutants, all killed. E1 sections-known branch off; E2 worst case = flat count; E3 13-chunk cap removed; E4 overlap term dropped; E5 content lower bound weakened; E6 label dropped (known); E7 label dropped (worst case); E8 window not passed in `planRun`; E9 window not passed in `estimateReportRun`.
  - chunking.ts after the refactor, 4 mutants, all killed. C1 headroom 1; C2 cut-off 0.1; C3 wrong registry-less ceiling; C4 overlap cap ×4.
  - C2 survived at first; the pin test and the S4/B4 fixture cases kill it.
  - The MUTANT grep is empty at the end.
- **Fixtures:** the 40 `test/fixtures/imrad/text/*.txt` files are byte-identical by SHA-256, and `labels/` is still empty.

## FINDINGS
1. **Unknown sections now over-quote short chunked papers.** Without the item's sections, every chunked paper is priced at 13 map calls. O3 (25,865 tokens) went from 6 to 14 calls; its real plan, as flat, is 6. P3-T29 and P4-T18 should pass the acquisitions' `sectionAware` and `sections` to get the exact figure. The estimate has each item's text, so acquisition has already run and the sections are available.
2. **Known-flat papers can price slightly below the old estimate.** On the 30,830-token flat example the exact figure is 58,068 raw input tokens against the old 58,480. It is still not below what the chunker sends.
3. **The estimate can now throw.** `planChunks` throws `ConfigurationError` when the model's window cannot hold a chunk. Only a caller that passes such a small `contextWindowTokens` triggers it.
4. **Bundle growth.** `chunking.ts` is now in the product bundle through estimate.ts; it adds no prompt text. The build passes and all three integration runs passed.

## WHAT I DID NOT CHECK
- Real prompt overheads: the examples use the worked example's 3,000 tokens per call.
- The cost dialog's rendering of the new figures. Its shape is unchanged, but I did not exercise the UI with a chunked paper.
- Calibrated token counts in the before/after table: it uses the raw heuristic.
- No P3-T22 accuracy figure was computed, and no label was read or written.

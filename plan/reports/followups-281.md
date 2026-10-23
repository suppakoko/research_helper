WAVE 8 FOLLOW-UPS: plan/00 §6 items 281(b) and 281(c), plus the combined checks on the whole tree

VERDICT
Both follow-ups are built and tested, and every combined check passes on the final tree.
- The documents moved first. docs/08 §4.2, docs/12 §3 and docs/02 §11.3.3 each got a dated "Decided 2026-10-24 (owner, plan/00 §6 item 281(x))" note before any code changed. All three are quoted below.
- Final tree:
  - npm run typecheck: exit 0.
  - npm run lint:check: exit 0 ("All matched files use Prettier code style!").
  - npx eslint .: exit 0.
  - npm run test: unit 85 files, 3954 tests passed; contract 2 files, 40 tests passed.
- `npx zotero-plugin build` was run once for the two new message ids. typings/i10n.d.ts moved from 7099ac20… to 8af3c152… Against HEAD the file gains exactly 10 lines: P3-T27's 8 hand-inserted ids plus the 2 new ones. So the generator agrees with P3-T27's hand edit.
- `npm run build`: exit 0. All five typings files hashed the same before and after (020956c7, 8af3c152, 8c6fe067, 4480d796, cf994969).
- Integration suite, three runs: 194 passed and 0 failed in each. P3-T27's search-window code has now run inside Zotero 10.0.3 with no failure.
- Mutation sweep: 21 mutants, all killed. One survived at first and was killed after a test was added (D4 below). Every mutant was restored by copy and checked by SHA-256. The final `grep -rn MUTANT src test addon typings scripts` is empty (exit 1).
- test/fixtures/imrad/ was not touched: no file there is newer than the start of this work.
- Nothing was committed. No card State line, estimate or plan/00 line was changed. No key, live model call or network request was used.

WHAT WAS BUILT
- Item 281(b), the estimated cost of screening.
  - The line beside the checkbox. The Search & Import window shows a line beside the relevance-screening checkbox, for example "Estimated cost of screening: up to about $0.42 for up to 200 results". For a model with no known price it says that the cost cannot be estimated.
  - Why "up to". The number of results is not known before a search runs. The estimate uses the most the search can return: the per-database maximum (held to docs/07 §8.5's range) times the ticked databases that search. bioRxiv and medRxiv add none on a keyword run.
  - How the dollars are computed (`estimateRelevanceScreen`):
    - It uses the same `planBatches` rule the screen sends with. Each result is assumed to fill its share of a full batch: (8 000 − the prompt's own measured tokens) ÷ 20.
    - Input tokens are multiplied by P3-T16's 1.15 headroom.
    - Output tokens are the prompt's ceiling, 100 × the results in each call.
    - The price is read from `graph.modelPrices` for the "screening" model, the same snapshot the spend guard reserves with.
  - When the dialog opens. Above `summary.confirmAboveCents`, or when the price is unknown, pressing Search opens P3-T16's cost dialog first, through `confirmRunCost`. It is the same window and model the summary run uses; no second dialog was built. It is not opened at or below the threshold.
  - What the answers do. Run screens. Cancel starts nothing. If no estimate can be made, or the dialog cannot be shown, the search runs without screening and shows the existing "Relevance screening could not run…" line.
- Item 281(c), a number inside a title. dedupe.ts's title tiers now read each title's runs of digits. A pair that would otherwise be one work, but whose numbers differ anywhere in the title, is flagged for the user's review and never merged. Flags and links that the earlier rules gave are left exactly as they were.

FILES CHANGED WITH DECLARATION NAMES
- src/pipeline/shared/relevanceScreen.ts:
  - new section 5: `RelevanceScreenEstimateInput` and `estimateRelevanceScreen`;
  - imports of `costOf`, `ModelPrices`, `withHeadroom`, `RunEstimate` and `RunPlan`;
  - one header paragraph.
- src/ui/viewModels/searchImportViewModel.ts:
  - new `ScreeningEstimateRequest`, `ScreeningCostQuery`, `screeningResultCount`, `screeningCostLine` and `screeningNeedsConfirmation`;
  - `SearchImportViewModelDeps.screening` gains the optional `estimate`, `confirmAboveCents`, `confirm` and `locale`;
  - `SearchImportViewModel` and `SearchWindowHostApi` gain `screeningCost`;
  - inside `createSearchImportViewModel`: `confirming`, `screeningEstimate` and `screeningGate`; `runSearch` is changed; `renderSearchOutcome` takes `extraWarnings`; the host gets `screeningCost`;
  - imports of `RunEstimate`, `formatUsd`, `shouldOpenCostDialog` and `CostDialogOutcome`.
- src/ui/dialogs/costConfirmDialog.ts:
  - `PreflightDialogInput.offerDontAskAgain?` (default true);
  - `PreflightDialogModel.dontAskAgain` is now `FluentLine | undefined`;
  - `buildCostDialogModel` leaves the box out when asked to;
  - `decideCostDialog` records "don't ask again" only when the box was offered.
- addon/content/costConfirm.js: `renderPreflight` shows the box only when the model carries it.
- src/bootstrap/registerUI.ts:
  - `searchWindowDeps.screening` gains `estimate`, `confirmAboveCents`, `confirm` and `locale` (`appLocale`);
  - new `estimateScreeningCost`, `confirmScreeningCost` and `providerDisplayName`;
  - the doc-table row is updated;
  - imports of `buildEgressDisclosure`, `settleDisclosure`, `RunEstimate`, `isPrivacyMode`, `estimateRelevanceScreen`, `ScreeningEstimateRequest` and `FluentMessageId`.
- addon/content/searchDialog.xhtml: new `<description id="rh-search-screening-cost" class="rh-hint" hidden="true">` beside the checkbox, with a comment.
- addon/content/searchDialog.js:
  - `spec.screeningCost`;
  - `state.screeningCostRequest`;
  - new `refreshScreeningCost` and `renderScreeningCost`;
  - calls added in `init` (after the Databases row is drawn), in `applyRerun`, on each source checkbox's command, and on the maximum's and the keyword's `input`.
- src/sources/shared/dedupe.ts: new `titleNumbers` and `innerNumbersDiffer`; `guardTitleVerdict` gains a final check and an updated doc comment.
- Strings: src/i18n/keys.ts and both research-helper-searchDialog.ftl bundles (quoted below); typings/i10n.d.ts was regenerated.
- Tests:
  - test/unit/pipeline/relevanceScreen.test.ts: new describe "estimateRelevanceScreen (item 281(b))", 5 tests.
  - test/unit/ui/searchImportViewModel.test.ts:
    - new helper `screeningEstimateFixture`;
    - new describe "item 281(b) — what a screened search may cost", 12 tests;
    - P3-T27's `screeningPort` now carries a cheap estimate;
    - two P3-T27 tests were adjusted. The host-key filter now expects `["screeningCost"]`, a member that reads and writes nothing. The "could not run" test now passes the port.
  - test/unit/ui/searchDialog.test.ts: new describe "item 281(b) — the screening cost line", 4 tests.
  - test/unit/ui/costConfirmDialog.test.ts: new describe, 3 tests, including a fake-document render of the shipped costConfirm.js.
  - test/unit/i18n/keys.test.ts: new describe, 2 tests.
  - test/unit/sources/dedupe.test.ts: new describe "item 281(c) — a number inside the title", 7 tests, and `titleNumbers` imported.
- Prettier: `prettier --write` was run on searchImportViewModel.ts and on five test files that this work did not create:
  - searchImportViewModel.test.ts, relevanceScreen.test.ts, costConfirmDialog.test.ts, searchDialog.test.ts and dedupe.test.ts.
  - Each diff was checked first, or against HEAD: Prettier changed only lines added in this work.

SHARED-FILE EDITS QUOTED (exact-string edits only, no whole-file rewrite)
- src/i18n/keys.ts:
  - SEARCH_DIALOG_MESSAGE_IDS: after "research-helper-search-row-relevance", the comment "// Owner, 2026-10-24, `plan/00` §6 item 281(b): the estimated cost beside // the screening checkbox (docs/08 §4.2's note of that date)." followed by "research-helper-search-screening-cost" and "research-helper-search-screening-cost-unpriced".
  - KO_PENDING_REVIEW: the same two ids, after the comment "// The screening cost line (owner, 2026-10-24, `plan/00` §6 item 281(b)); a // commented `ko-KR` stub each, nothing machine-translated (`G-41`)."
  - FluentMessageArgsMap: `"research-helper-search-screening-cost": { cost: string; count: number };` and `"research-helper-search-screening-cost-unpriced": { model: string };`, under a comment explaining $cost, $count and $model.
  - ARGUMENT_MESSAGE_IDS: "// Item 281(b)." followed by the same two ids.
- The en-US searchDialog bundle: one appended section, "## The estimated cost of screening (owner, 2026-10-24, plan/00 §6 item 281(b); docs/08 §4.2, docs/12 §3)", holding the two messages with comments.
- The ko-KR searchDialog bundle: two commented stubs, each "# NEEDS REVIEW (item 281(b), 2026-10-24). en-US: "…"" followed by "# <id> =". Nothing was translated.
- Both bundles were appended byte-safely in UTF-8 with a shell append.

DOC NOTES ADDED (quoted)
1. docs/08 §4.2, after P3-T27's note: "> **Decided 2026-10-24 (owner, `plan/00` §6 item 281(b)): the checkbox shows what screening may cost, and a costly screen asks first.** Built after wave 8." It has four bullets:
   - "The line beside the checkbox." It quotes the two strings and says the line is redrawn on databases, maximum and keyword. "The number of results is not known before the search runs, so the line uses the most the search can return: the per-database maximum times the ticked databases that search (bioRxiv and medRxiv add none on a keyword run). Merging duplicates can only lower it."
   - "When it asks." "When that estimate is above `summary.confirmAboveCents`, pressing Search with the box ticked opens `P3-T16`'s cost dialog — the same window and model the summary run uses (`confirmRunCost`), not a second dialog — before anything is fetched. At or below the threshold no dialog opens. The dialog's "Don't ask again for this collection" box is not shown here: a search has no collection for it to apply to."
   - "What the answers do." "**Run** starts the screened search. **Cancel**, or closing the dialog, starts nothing: no search and no screening, and the window stays as it was."
   - "Read by the implementer, for the owner to confirm." (1) An unknown price also opens the dialog (`secondAcknowledgementFor`). (2) Cancel cancels the whole search, not only its screening. (3) "If the estimate cannot be made at all … or the dialog cannot be shown (no Zotero main window to raise it over), the search runs without screening and the window shows "Relevance screening could not run, so no result was scored and none is hidden." Nothing is screened without its estimate having been checked against the threshold." (4) "While the dialog is open, a second press of Search is ignored."
2. docs/12 §3, after P3-T27's note: "> **Decided 2026-10-24 (owner, `plan/00` §6 item 281(b)): a screen is priced before it runs, and confirmed above `summary.confirmAboveCents`.** Built after wave 8, in `estimateRelevanceScreen` (`src/pipeline/shared/relevanceScreen.ts`)." It has five bullets:
   - How many results: the most the search can return.
   - How many calls: "the same `planBatches` … Each result is assumed to fill its share of a full batch — (8 000 − the prompt's own tokens) ÷ 20, rounded down … A re-run or a per-item call is not counted."
   - Tokens: "times … §5.1's 1.15 headroom (D-06-5), as `P3-T16`'s estimate does. Output per call is this prompt's `max_tokens` ceiling, 100 × the call's results, never a typical fill."
   - Dollars: "priced with `costOf` at the prices the service graph's `modelPrices` holds for the `"screening"` model (… item 278(b)): the same snapshot the spend guard reserves the calls with. A model with no known price gives no cost, never `$0`".
   - Confirmation: "The estimate reaches `P3-T16`'s cost dialog as a `RunEstimate` in which every result is sent as an abstract. The dialog opens when `secondAcknowledgementFor` asks for the second acknowledgement … It carries `P3-T15`'s disclosure for the `"screening"` model under the global privacy mode (a search has no collection); confirming a dialog that showed the first-job notice records `privacy.egressAcknowledged` … A spend ceiling the screen would pass is not checked before the run: the budget guard refuses the call that would pass it, and the search then shows its rows unscored."
3. docs/02 §11.3.3, after the guard list: "> **Decided 2026-10-24 (owner, `plan/00` §6 item 281(c)): a number anywhere in the title, not only at its end.**" It says:
   - The series guard reads only the last word, so P3-T27's pair was merged.
   - "Now the title tiers compare each title's **numbers**: its runs of digits after §11.3.2's normalization, in order, with leading zeros dropped. When a pair would otherwise be a duplicate and the two lists differ — including a title with a number against one without — the pair is **flagged for the user's review instead, never merged** (`innerNumbersDiffer`, applied last in `guardTitleVerdict` …). A flag or a link the rules above already gave is left as it was, so a known preprint ↔ published relation (§11.4) still links. The same number written the same way ("COVID-19" and "COVID 19", "3D" and "3-D") still matches. Numbers written as words ("three") and roman numerals inside a title are not compared."
   - "*Measured the same day:* over the 534 pairs of `P2-T13`'s corpus (`test/fixtures/dedup/pairs.jsonl`, 1 058 records) no prediction changes — 103 merged, 107 linked, 141 flagged, 183 distinct before and after — so `npm run dedup:report`'s figures cannot move once the owner's labels are in. Its output today is unchanged too: the corpus is still unlabelled and the script measures nothing."

NEW STRINGS (en-US, in research-helper-searchDialog.ftl; both are on KO_PENDING_REVIEW with a commented ko-KR stub; nothing was machine-translated)
1. research-helper-search-screening-cost = "Estimated cost of screening: up to about { $cost } for up to { $count } results"
2. research-helper-search-screening-cost-unpriced = "The price of { $model } is not known, so the cost of screening cannot be estimated."

RUNS
- npm run typecheck 0; npm run lint:check 0; npx eslint . 0. npm run test: unit 85 files, 3954 passed; contract 2 files, 40 passed.
- `npx zotero-plugin build` once: exit 0, i10n.d.ts 7099ac20 → 8af3c152 (the two new ids only). `npm run build`: exit 0, typings unchanged.
- Dedup report and engine snapshot:
  - `npm run dedup:report`, with and without `--allow-partial`, before and after the change: the output is byte-identical. Exit 1: "267 of 267 label-set pairs have no label".
  - The engine itself was compared with a scratch script, C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\w8f\dedup-snapshot.mts. It runs `dedupeRecords` over the corpus pool and prints every pair's prediction.
  - Before and after the final change, the output is identical: 969 groups, 107 links, 141 flags, and all 534 pairs unchanged.
- Integration suite, `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`:
  - Pre-flight before each run: the MUTANT grep was empty (exit 1), and a PowerShell CIM query found 0 processes with `.scaffold\test\profile` on the command line (its own PID excluded). The query was also 0 after run 3.
  - Run 1, 08:31:46–08:34:53: 194 passed, 0 failed.
  - Run 2, 08:35:12–08:38:22: 194 passed, 0 failed.
  - Run 3, 08:38:33–08:41:43: 194 passed, 0 failed.
  - l10n.spec logged "ko-KR totals: 100 present, 148 absent; expected 100 / 148": 138 + P3-T27's 8 + these 2.
  - The P1-T22, P1-T21 and P2-T17 search-window specs passed with P3-T27's screening row in the window. P1-T35 lists `screening` among the supplied dependencies.
  - Logs: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\w8f\int1.log, int2.log and int3.log in the same folder.
- Mutants (runner: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\w8f\mutants.cjs). All 21 were killed and each restore was checked by hash. None touched useTranslators.
  - relevanceScreen.ts:
    - R1 headroom dropped
    - R2 output budget dropped
    - R3 unpriced counted as $0
    - R4 share ignores the prompt's tokens
  - View model:
    - V1 confirmation never asked
    - V2 Cancel treated as Run
    - V3 Cancel falls through to the search
    - V4 no estimate still screens
    - V5 cost line dropped
    - V6 lookup-only sources counted
    - V7 a failed dialog still screens
  - Window script:
    - J1 the window never asks the host
    - J2 a stale answer is kept
    - J3 no refresh on a database toggle
  - Cost dialog:
    - C1 "don't ask again" always offered
    - C2 recorded when it was not offered
    - C3 costConfirm.js shows an absent box
  - dedupe.ts:
    - D1 guard removed
    - D2 numbers compared by count only
    - D3 leading zeros kept
    - D4 guard applied to every verdict. This one survived first; it was killed after the test "leaves §11.3.3's own flag row as it was" was added.
  - Final hashes (first 12 hex characters): relevanceScreen.ts 49f091774db1, searchImportViewModel.ts dfbea19ff85b, searchDialog.js 9e9a95411d33, costConfirmDialog.ts 1c22ac48c1b3, costConfirm.js 83bb74bcbd7d, dedupe.ts d792a65c35ed, registerUI.ts 1cb6505246ae, typings/i10n.d.ts 8af3c1528d30.

CONTRADICTIONS/FINDINGS
1. The first version of the 281(c) guard was too broad. It forced "distinct" on every title-tier verdict, and the corpus snapshot showed 134 existing flags and links turning into distinct: flags 141 → 7, links 107 → 58. The owner's decision only forbids making two papers one work, so the guard was narrowed to a would-be match, which becomes a flag. Corpus output is now unchanged. The owner may prefer "distinct" over "flag" for this case; the series guard uses "distinct".
2. Readings for the owner to confirm, all recorded in docs/08 §4.2's note:
   - An unknown price opens the dialog (P3-T16's rule).
   - Cancel starts no search at all, not just no screening.
   - No estimate, or a dialog that cannot open, means an unscreened search with the "could not run" line.
3. The estimate is an upper bound, and can over-ask. With seven databases at 200, 1 400 results at docs/06 §5.4's $3 / $15 prices pass the $2.00 default threshold (a unit test pins this). Merging normally removes many results.
4. A spend ceiling is not checked before a screened search. A ceiling stop inside the screen leaves the rows unscored, as P3-T27 built.
5. The cost dialog's lines are the summary run's wording: "Papers: N · with full text: 0 · abstract only: N …". This follows from reusing the dialog. A screening-specific header would need new strings.
6. Confirming a dialog that showed the first-job notice now writes `privacy.egressAcknowledged` (`settleDisclosure`). Before this, a screened search sent abstracts with no disclosure at all; below the threshold it still shows none.
7. No catalogue refresh is made before pricing. `modelPrices` is read as it stands: the documented table until something refreshes it. A model missing from that table is "unpriced" and always opens the dialog.

WHAT I DID NOT CHECK
- The cost line and the cost dialog rendered in a live window. The test profile has no LLM key, so the screening row is hidden and no integration spec opens the dialog. Their placement and theme, and the dialog opening over the main window while the Search window is in front, were not seen.
- `providerDisplayName`'s Fluent lookup inside Zotero, and `estimateScreeningCost`'s lazy import of the bundled prompts at run time. registerUI.ts has no unit test, and no mutant was run on it.
- A real model's answer, or real prices beyond the documented table.
- Korean text for the two new strings (gate G-41).

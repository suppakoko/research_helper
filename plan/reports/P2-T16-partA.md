# P2-T16 Part A: report

Most of Part A is met: steps 2, 3, 4 and 7 pass. Step 6 is not met because of a real product defect. Repeating a search imports one record a second time, and keeps doing so on every repeat. The search benchmark finished in 12.06 s against the 30 s budget. That figure comes from a latency model, not a live measurement.

Terms used below:
- **Seam:** a hook in test code that swaps one answer for another.
- **Chip:** the small source label drawn on a result row.
- **`seenIn`:** the list of sources inside a merged record.
- **`PartialFetch`:** the run state in which some sources failed and the rest delivered.
- **Bundle:** one separately packaged piece of compiled code.
- **Mutant:** a deliberate, temporary break used to prove that a test notices it.

## 1. Verdict per Done-when item in Part A

| Done-when item | Verdict | Evidence |
|---|---|---|
| The cross-indexed paper appears exactly once, every contributing source listed (step 2) | **Met, with a qualification** | Over `corpus-q3`, two papers are each found by two sources: `10.1101/2024.10.31.24316386` (Europe PMC and Crossref) and `10.2196/66114` (PubMed and Europe PMC). Each paper is exactly one row, and its chips and its merged record's `seenIn` both name exactly its sources. The test also works out the contributing sources independently, from each source's own recorded answer. **Qualification:** no committed query returns one paper from three or more sources (section 7). |
| One source at 500 and one at 429: the others deliver and the job is `PartialFetch` (step 3) | **Met, with qualifications** | Over `corpus-q1`, arXiv answers its committed 500 and Semantic Scholar answers its recorded 429. Each is asked 3 times, the attempt cap in `docs/07` §7.3. The run ends `partial`, which is `PartialFetch` carried to the end. The run continues past fetching. Both failures show as failed status rows. PubMed, Europe PMC and Crossref deliver 25 records each, and bioRxiv and medRxiv show their "role" row. **Qualifications:** only three sources deliver, not five (section 7). The 429 is injected (section 7). The failure error codes cannot be read across the test/plugin boundary, so the test proves the classification in the test's own code instead (section 8). |
| `npm run bench:search` reports ≤ 30 s for 4 sources × 100 results and exits 0 (step 4) | **Met** | PubMed, Europe PMC, Crossref and arXiv each return 100 records. Measured times were **12.11 s** and **12.06 s**, and the script exits 0. |
| Re-running the same search creates zero new items and reports the linked count (step 6, FR-51) | **NOT met: product defect** | A repeated search imports 1 new item and links 97 of 98 rows. The FR-12 re-run does the same: 1 created, 97 already present. The record that gets duplicated is Europe PMC `PMC/PMC11693243`, which has no DOI and no PMID (defect D1). The import summaries carry the right counts in the shipped wording, read through the plugin's message files: "Imported 1 · Linked 97 · Skipped 0 duplicates · 0 failed" (still English under the Korean locale), and "가져옴 1 · 이미 있음 97 · 실패 0". |
| The XPI builds and works with `sources` excluding `semanticscholar` (step 7) | **Met, with a qualification** | `npm run build` exits 0 and writes `.scaffold/build/research-helper.xpi` (236,876 bytes). The plugin was restarted through the add-on manager with `sources` set to `pubmed,europepmc,crossref,arxiv,biorxiv,medrxiv`. After the restart, the plugin reads that list back, a search makes 6 requests with none to Semantic Scholar (not even the abstract-backfill lookup), and the outcome is `succeeded`. **Qualification:** this is a disable-and-enable restart, not a fresh install from the XPI file. |

## 2. Files

- `test/integration/pipeline/searchImportMultiSource.spec.ts` (new): the in-Zotero test for steps 2, 3, 6 and 7.
- `scripts/bench-search.ts` (new): the step 4 benchmark.
- `test/support/fixtureReplay.ts` (modified, additions only):
  - `createMultiHostReplayTransport` and `createMultiHostReplayHttpClient`: one replay client that routes each request to its host's fixture folder.
  - Two seams: `answerFor`, which returns a committed answer instead of the fixture, and `latency`, which waits before answering.
  - `readScenarioExchange`: reads a committed answer by its scenario name.
- `package.json`: adds `"bench:search": "tsx scripts/bench-search.ts"`.
- `.github/workflows/ci.yml`:
  - a bench step in the `unit` job;
  - a step in the `integration` job that fails if the new spec file is missing, so a rename cannot shrink the run silently;
  - `continue-on-error: true` kept unchanged.

The card's `test/fixtures/dedup/cross-indexed-paper/` folder was not created, and nothing was recorded. No product code was changed.

## 3. Tests, by name

All four are in the block "P2-T16 Part A: Phase 2's end-to-end run over replayed fixtures":
- "step 2: a seven-source search shows each cross-indexed paper exactly once, every contributing source in its chips and in seenIn"
- "step 3: with arXiv at 500 and Semantic Scholar at its recorded 429, the others deliver, the run is PartialFetch, and both failures are status rows"
- "step 6 (FR-51): re-running the same search creates zero new items and reports the linked and already-present counts in the shipped wording"
- "step 7: the plugin restarts with sources excluding semanticscholar and searches without asking it"

How the tests run:
- **Through the plugin's own published search window controller**, with no window opened: the same pipeline, writer, library index, provenance note and provenance store as the product.
- **Only the seven data-source connectors are replaced**, each by the same shipped connector built over the replay client. The originals are swapped back afterwards.
- **No network:** the test fails unless all seven slots hold replay connectors, and it checks that the setting that turns on Zotero's translator import (`useTranslators`) is `false`.
- **Cleanup:** every item, provenance note and collection created by the test is erased at the end.

## 4. Runs

| Run | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 ("All matched files use Prettier code style!") |
| `npm run test:unit` | exit 0: 48 files, 2,578 tests passed |
| `npm run test:contract` | exit 0: 2 files, 40 tests passed |
| `npm run test:integration -- --exit-on-finish --abort-on-fail` (Verify-with chain) | exit 1: "35 passed, 1 failed". The run stops at step 6. |
| `npm run test:integration -- --exit-on-finish`, three clean runs on the final spec | My run 5: 168 passed, 1 failed. The coordinator's run: 168 passed, 1 failed. My final run: 168 passed, 1 failed. Step 6 is the only failure every time. |
| `npm run bench:search` | exit 0, **12.06 s** (an earlier run gave 12.11 s) |
| `npm run build` | exit 0, XPI 236,876 bytes |
| Discarded runs | Run 1 failed on early versions of my own spec (fixed since). Runs 2 and 4 and the first attempt at mutant M1 hung on the first import in `phase1-dod.spec.ts`. The coordinator says run 2 was built while another agent's mutant was in the tree. Run 3 failed with EBUSY because another agent's Zotero was holding the test profile. |

Per-request detail of the bench run:

| Host | Requests | Modelled wait | Measured wait |
|---|---|---|---|
| Europe PMC | search, then the abstract lookup | 3,358 ms, 3,000 ms | 3,366 ms, 3,004 ms |
| PubMed | esearch, then efetch | 3,002 ms, 4,065 ms | 3,017 ms, 4,079 ms |
| Crossref | works | 3,074 ms | 3,078 ms |
| arXiv | query | 8,118 ms | 8,120 ms |

- **The sidecars do not record latency.** Their `recordedAt` values are 0 to 20 ms apart.
- **Where the model comes from:** for each host, the largest gap between the `date` headers of consecutive recorded responses, plus 1 s for the header's one-second resolution. That gives PubMed, Europe PMC and Crossref 3,000 ms each, and arXiv 8,000 ms.
- **Body transfer** is added on top at an assumed 2 MB/s.
- **Bodies:** the recorded `corpus-q3` answers, widened in memory to 100 records each.
- **Pacing:** the real per-host rate limiters run on the real clock.

## 5. Mutation table

Every mutant was restored by copying the original back, and the file hash matched afterwards. `grep -rn MUTANT src test addon typings scripts` is now empty.

| Id | Where | Break | Result |
|---|---|---|---|
| M1 | `src/sources/shared/dedupe.ts`, DOI tier | Two records with the same DOI are judged "distinct" | **Caught.** Step 2 fails: "10.1101/2024.10.31.24316386 is exactly one row: expected 2 to equal 1". The P2-T31 and P2-T34 tests also fail. |
| M2 | `src/pipeline/searchImport/searchImportPipeline.ts`, run output | Failed sources are dropped from the per-source reports | **Caught.** Step 3 fails: "semanticscholar has a failed status row: expected undefined to equal 'failed'". Step 2 also fails. |
| M3 | `scripts/bench-search.ts` | The latency wait is set to zero | **Caught.** Exit 1 with a wall clock of 1.33 s. Every request is flagged "waited … ms, under the 1000 ms floor — the latency model is not in effect". |
| M3b | `scripts/bench-search.ts` | The latency hook is removed | **Caught.** Exit 1: "the latency model ran for 0 of 4 requests". |
| M4 | `src/zotero/importer.ts` | The library-duplicate lookup never matches | **Detected, but the baseline is already red.** Step 6 reports 98 created on the repeat instead of the baseline's 1, and FR-51 tests in other files also fail. |

## 6. Product defects found, which become new cards

- **D1, blocks step 6. A record with no DOI and no PMID is imported again on every repeated search.**
  - Measured: Europe PMC record `PMC/PMC11693243` ("INNOVATING THE DETECTION OF CARE PRIORITIES IN HEART FAILURE") is created again on each repeat, and is not marked as already in the library.
  - Cause: the import planner (`planImport` in `src/zotero/importer.ts`) and the window's "already in library" check (`isExisting` in `src/bootstrap/registerUI.ts`) both call `findExisting(work.ids)` without the work key. That is `plan/00` §6 item 105, which is filed as "Not a Phase 2 finishing condition". The library index also has no PMCID lookup.
  - Under rule 9, the item now blocks this card's Done-when, so it needs a card.
- **Observation, not a card. Source display names are resolved once and kept.** The window controller resolves names once, and caches whatever comes back, even with no translation formatter connected. In this test run the chips and status rows therefore show ids ("semanticscholar could not complete the search."). The real window always connects with a formatter, so this probably does not reach users.
- **Observation.** `research-helper-import-summary` displays in English under the Korean locale. Whether that string is on the list awaiting Korean review was not checked.

## 7. Contradictions

- **Test file name.** The card's Files list says `searchImportMultiSource.test.ts`. The split note says `.spec.ts`. The `.spec.ts` name was used.
- **Same-paper sets cannot be replayed by one search.** The split note says the ≥ 3-source sets (DESeq2, Hamilton, UniProt 2023) can be replayed. They cannot, because each source was recorded with a different query. No committed query returns any paper from three or more sources: two at most.
- **The recorded 429 is on a different endpoint.** Semantic Scholar's committed `corpus-q1` 429 was recorded on `/paper/search`, the relevance endpoint (`semanticscholarCorpusPlan` in `scripts/record-fixtures.ts`). A pipeline search asks `/paper/search/bulk`, so that recording can never be replayed by a real search. Step 3 injects the recorded 429 through the seam instead.
- **"The other five deliver."** A seven-source keyword run has only five sources that search, because bioRxiv and medRxiv only look up identifiers (item 204). With two failures, three deliver.
- **Summary wording.** Done-when says the summary reads "linked existing: N". The shipped wording is "Linked N" for a plain import and "Already present N" for a re-run (P2-T17), which matches the split note.
- **CI configuration.**
  - The CI integration job pins Zotero 10.0.2, while the local machine runs 10.0.3.
  - The job also sets `FIXTURE_MODE: replay`, a value nothing reads.

On `continue-on-error`, the phase-0 spike verified `V-5` on CI in September and said the setting "should come off after a few more green runs". It is still on, so a red run of this new end-to-end spec does not block a pull request. I left it unchanged; removing it is the owner's decision.

## 8. What I did not check

- **Error codes and the new 429 wording end to end.** The test is bundled separately from the plugin. So errors thrown by the connectors the test builds arrive at the plugin's pipeline as `UNTYPED`, and the failure rows use the generic wording. As a result, the new owner-approved 429 row (`research-helper-search-error-rate-limit`) is not exercised end to end here. The test proves `RateLimitError` and `UpstreamServerError` in its own code instead.
- **Real network latency.** The model is an upper bound taken from one-second `date` headers, and the 2 MB/s throughput is assumed.
- **Parsing speed in Zotero.** The bench parses XML in Node, not in Zotero's engine.
- **arXiv's 3-second spacing.** It never binds in the bench, because one search makes only one arXiv request.
- **The new CI steps on GitHub.** Nothing was pushed, so they have not run there.
- **A fresh XPI install.** Step 7 used a disable-and-enable restart.
- **Semantic Scholar with an API key.**
- **The cause of the intermittent import hang.** A runner that waits for 30 quiet seconds before starting Zotero avoided it in the 5 runs that followed. That is not proof of the cause.

## 9. What Part B needs

- Step 5 (`npm run dedup:report`), once the owner has labelled P2-T13's pairs.
- The Done-when 7 gate inventory, and the sign-off.
- A decision on D1 before sign-off. Until D1 is fixed, the Verify-with chain stops red at `test:integration` (step 6).
- Optionally, a decision on removing `continue-on-error` from the CI integration job.
- To repeat these runs, the logs and the retrying suite runner (`p2t16a-runsuite.sh`) are in the session scratchpad. Another agent has reused log names there, so treat the files starting `p2t16a-` as mine.

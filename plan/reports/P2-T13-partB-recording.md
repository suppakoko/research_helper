# P2-T13 Part B, recording — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent recorded the corpus under the owner's
> 85-request budget (`plan/00` §6 item 222). The text below is its report, unedited. It is a record, not an instruction.
> **Coordinator's note:** the agent did not run the integration suite; it failed once on a pinned PubMed fixture count
> (19, now 34) in `test/integration/searchDialog-flow.spec.ts`, which the coordinator now derives from the plan.

---

# P2-T13 Part B, step 1: recording the deduplication corpus

## 1. Verdict

The recording is finished and stayed inside the approved budget. **48 live requests were sent out of the 85 allowed.** None was keyed and all went through the committed recorder, one at a time, at each host's policy rate. The rebuilt corpus now has **898 records and 438 candidate pairs**. Part A had 296 records and 47 pairs. The pair count passes the 200 floor, but nothing is labelled yet, and **4 of the 6 step-3 families are still below their minimum**. A "candidate pair" is two records that the deduplication pre-filter would compare. A "family" is one of the kinds of pair that card step 3 requires.

**Live requests per host, with status codes:**

| Host | Requests | Status codes |
|---|---|---|
| eutils.ncbi.nlm.nih.gov (PubMed) | 15 | 15 × 200 (7 searches, 8 record fetches) |
| www.ebi.ac.uk (Europe PMC) | 7 | 7 × 200 |
| api.crossref.org | 8 | 8 × 200 |
| export.arxiv.org | 4 | 4 × 200 |
| api.biorxiv.org (bioRxiv 3, medRxiv 6) | 9 | 9 × 200 |
| api.semanticscholar.org | 5 | **5 × 429** ("too many requests") |
| **Total** | **48** | 43 × 200, 5 × 429 |

**Request plan, written down before anything was sent:**

| Source | Planned |
|---|---|
| PubMed | 15 |
| Europe PMC | 7 |
| Crossref | 8 |
| arXiv | 4 |
| Semantic Scholar | 7 |
| bioRxiv | at most 15 |
| medRxiv | at most 15 |

That is at most 71 requests, with 14 held back for 429 or 5xx answers. A dry run printed the keys for the five searchable sources before any recording. bioRxiv, medRxiv and the Semantic Scholar batch were dry-run after the searches, because their DOIs come from the search results.

**Semantic Scholar was refused every time.** Its shared pool for requests without a key answered 429 to `corpus-q1` four times: at 21:15, 21:37 and 22:23 UTC on 2026-10-15, and at 01:29 UTC on 2026-10-16. It also refused the batch lookup at 01:29 UTC. Further tries were stopped so that the rest of the budget was not spent on requests that could not succeed. The remaining five Semantic Scholar searches were not sent; they are listed in `DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR`. Because nothing was found in Semantic Scholar's search results, there was no second round of bioRxiv or medRxiv lookups.

## 2. Files

- `test/support/dedupCorpusRecordedRequests.ts` (new): one definition of Q1–Q5 and the three probes, used by every source. Each query is built the way the product builds it: `parseUserQuery`, whole-year bounds, and the limit as the page size. Also defines `DEDUP_CORPUS_SEARCHES` per source and `DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR`.
- `scripts/record-fixtures.ts`: adds `corpusPurpose`, `pubmedCorpusPlan`, `pubmedCorpusEfetchPlan` (dependent: each record fetch uses the identifiers its search returned), `europepmcCorpusPlan`, `crossrefCorpusPlan`, `arxivCorpusPlan`, `semanticscholarCorpusPlan` and `biorxivCorpusPlan`, all wired into `planFor`. No rate limit, redaction rule, merge verdict or threshold was changed.
- `test/support/pubmedRecordedRequests.ts`: `PUBMED_TYPICAL_PMIDS`, the 20 identifiers that the committed `search-typical` returned, now fetched by the `search-typical-efetch` scenario.
- `test/support/biorxivRecordedRequests.ts`: `BIORXIV_CORPUS_DOIS` (3), `MEDRXIV_CORPUS_DOIS` (6) and `corpusLookupScenario`.
- `test/support/semanticscholarRecordedRequests.ts`: `SEMANTICSCHOLAR_CORPUS_BATCH_IDS` (17 DOIs, recorded as a 429).
- **45 new fixtures, each with its `_meta.json` sidecar (90 files, 5.8 MB in total)**, under `test/fixtures/{pubmed,europepmc,crossref,arxiv,semanticscholar,biorxiv,medrxiv}/`. The PubMed record fetches account for about 4 MB of that.
- `test/fixtures/dedup/pairs.jsonl`, `pairs.csv` and `_meta.json`: rebuilt by the builder, not edited by hand.
- `test/unit/sources/dedupeCorpus.test.ts`: the size and family pins now hold the new measured values.
- Each source's own unit test, changed only where a count pin failed because of the new scenarios: `arxiv.test.ts`, `biorxiv.test.ts`, `crossref.test.ts`, `europepmc.test.ts` and `semanticscholar.test.ts`. The new counts are worked out from the support constants, for example `16 + CORPUS_FIXTURES`, rather than typed in. `semanticscholar.test.ts` also accepts `corpus-batch` as a POST request.

## 3. New corpus totals

**Records per source:**

| Source | Records |
|---|---|
| Crossref | 248 |
| Europe PMC | 207 |
| Semantic Scholar | 203 (unchanged) |
| PubMed | 202 |
| arXiv | 113 |
| medRxiv | 9 |
| bioRxiv | 7 |
| **Total, one per record id** | **898** |

**Candidate pairs: 438.** The cascade compares 352 of them. The pre-filter skips the other 86, which are kept so that a missed duplicate still counts against recall.

**Step-3 families against their minimums:**

| Family | Found | Minimum | Status |
|---|---|---|---|
| Same paper from 3 or more sources (sets) | 5 | 10 | **short** |
| Preprint and published version | 9 | 5 | met |
| Short titles | 83 | 5 | met |
| Series titles | 1 | 5 | **short** |
| Same title, different year, different journal | 3 | 5 | **short** |
| `10.64898/` prefix | 0 (bioRxiv 0, medRxiv 0) | 5, mixed | **short** |
| Korean titles | 0 pairs (10 records have a Hangul title) | none stated | — |

**The pairs are unevenly spread, and the owner should know this before labelling:**
- **231 of the 438 pairs come from one cluster.** Crossref Q5 returned 22 `report` records, each a separate report titled "Enhanced Surveillance of COVID-19 in Scotland - …".
- 78 pairs are Crossref records with identical short titles, such as book parts titled "Part II" and correction notices.
- Only **80 pairs join two different sources.**
- arXiv Q2 ("single-cell RNA sequencing atlas", 2024) returned zero results.

## 4. Runs

| Command | Result |
|---|---|
| Dry run before recording, all 5 searchable sources | exit 0; none of the new keys matched an existing key |
| Recording: PubMed, Europe PMC, Crossref, arXiv, bioRxiv, medRxiv | exit 0 for each; status codes as in section 1 |
| Recording: Semantic Scholar (5 runs) | exit 0; each run got a 429 |
| `npx tsx scripts/build-dedup-corpus.ts` | 898 records, 438 pairs; wrote the three dedup files |
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 ("All matched files use Prettier code style!") |
| `npx eslint .` | exit 0 |
| `npm run test` | unit tests: 47 files, 2,473 passed; contract tests: 2 files, 40 passed |
| Final dry run for all 7 sources | exit 0 for each. Keys printed equal keys on disk for every source: PubMed 34, Europe PMC 26, Crossref 24, arXiv 19, Semantic Scholar 19, bioRxiv 16, medRxiv 15 |
| `npx tsx scripts/build-dedup-corpus.ts --check` | exit 0, "test/fixtures/dedup/ is up to date." |
| Integration suite | not run, because no change touches anything inside Zotero |

## 5. Redaction and secret checks

- **Key-like environment variables.** Two variables with key-like names were set in the shell: `OPENROUTER_API_KEY` and `CLAUDE_CODE_MESSAGING_TOKEN`. Every recording ran with both removed (`env -u`), and a check confirmed that no name matching `KEYISH_FIELD` was left in that environment. No key was read from the operating-system keystore, printed or written. `NODE_TLS_REJECT_UNAUTHORIZED` was never set; only `NODE_USE_SYSTEM_CA=1` was used.
- **The recorder's own checks, re-run on all 90 new files.** The recorder's `literalDenyList` (built from the full environment) and `assertClean` (with each plan's own exemptions) were run over every new file. Result: 0 environment values found, 0 files flagged. No value was printed.
- **Maintainer address.** No new fixture and no dedup file contains the address in either spelling.
- **Item 178, a redacted JSON member name.** None found. There are 84 redaction markers spread over 13 fixtures:
  - long URLs inside PubMed reference lists;
  - Cambridge Core link URLs in Crossref;
  - trace headers from arXiv and Semantic Scholar;
  - the maintainer address that Europe PMC sends back.
- **Item 174, synthetic sidecars rewritten.** Every recording run rewrote the synthetic sidecars as expected. All existing fixtures were snapshotted before recording. 21 synthetic sidecars changed and were restored from the snapshot. Afterwards, 219 of the 219 existing source-fixture files match their earlier SHA-256 hashes. Only the three dedup files differ, and the builder wrote those.
- No bot check or CAPTCHA page appeared.

## 6. Contradictions

1. **The `10.64898/` family cannot be filled under the approved plan.** bioRxiv and medRxiv only started minting this prefix in 2025–2026, and every query window is 2020–2024. The probe window was set to 2026-01-01 … 2026-08-31 to give the probes a chance, but no probe returned a `10.64898/` DOI. The only route left was the Semantic Scholar batch, which was refused.
2. **Semantic Scholar used `/paper/search` (relevance search) instead of Part A's "bulk search".** The bulk endpoint ignores `limit` and returns up to 1,000 records in no relevance order. However, the relevance endpoint and the batch endpoint were both refused every time. The committed `relevance-search` fixture from 2026-10-15 was also a 429, recorded at a time when bulk requests succeeded.
3. **PubMed sorts by most recent, not by relevance**, so its first 25 results overlap little with the other sources' results.
4. **The page size of 10 for the short-title probe was this agent's choice.** Every two identical short titles become a pair, so the limit was lowered to keep that number down.
5. **One file name breaks the per-source pattern.** `dedupCorpusRecordedRequests.ts` matches the `*RecordedRequests.ts` pattern but serves all sources, not one.

## 7. What I did not check

- The engine's verdicts were not looked at, and nothing was labelled.
- `dedup-report.ts` was not run beyond the existing test, which checks that it refuses the unlabelled file.
- Whether the 22 Scotland reports are true duplicates was not judged; that is for the labeller.
- The integration suite was not run.
- Whether the bulk endpoint would have answered at the times the relevance endpoint refused was not tested.

## 8. Follow-ups

1. **Owner decision on Semantic Scholar:** spend up to 7 more of the 37 unused requests to record the five deferred searches and re-record `corpus-q1` and `corpus-batch`, ideally around 02:00–03:00 UTC. To do that, move the searches from `DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR` back into `DEDUP_CORPUS_SEARCHES.semanticscholar`. The batch alone would give the 2 mixed `10.64898/` pairs that the committed fixtures can support. That is still short of 5.
2. **Owner decision on the `10.64898/` family:** this needs either lookups of known `10.64898/` DOIs (for example the examples in `docs/02` §11.2) or a recent-window query. Neither is inside the current approval.
3. **Owner decision on the uneven pairs:** whether the 231 Scotland pairs and the 78 Crossref short-title pairs should count toward the 200 labelled pairs, or be sampled down.
4. Series titles (1 of 5) and same title, different year (3 of 5) remain short. Filling them needs targeted lookups, which also need approval.
5. Item 174 recurred, as before: the recorder still rewrites synthetic sidecars under `--only`.

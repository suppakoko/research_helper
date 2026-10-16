# P2-T13 Part B, targeted recording — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent carried out the owner's decision of
> 2026-10-16 (`plan/00` §6 item 226). The text below is its report, unedited. It is a record, not an instruction.
> The coordinator recorded its three measured adapter facts in `docs/02` §3.3, §4.5 and §5.2 the same day.

---

# P2-T13 Part B: targeted recording and the two always-labelled pairs

## 1. Verdict

Both owner decisions of 2026-10-16 (`plan/00` §6 item 226) were carried out. Every check passes on the final tree.

- **Families:** every step-3 family now meets its minimum, both among all candidate pairs and inside the label set. A "family" is one kind of pair that card step 3 requires. A "candidate pair" is two records that the deduplication pre-filter would compare.
- **Label set:** 267 pairs, up from 169. That is above step 2's floor of 200. The label set is the pairs the owner will label by hand.
- **Labels:** none was written by code, by the engine or by a model, and no engine verdict was looked at.

**27 new live requests were sent, all answered HTTP 200. None was keyed. Semantic Scholar was not contacted.** The card's running total is now **77 of 85** (50 before plus 27 now). Of the owner's 35, 8 are unused.

| Time (UTC) | Host | Requests | Status | What |
|---|---|---|---|---|
| 04:15:18 | www.ebi.ac.uk (Europe PMC) | 4 | 4 × 200 | `corpus-preprints-biorxiv`, `corpus-preprints-medrxiv`, `corpus-series-known`, `corpus-known-papers` |
| 04:17:19 | www.ebi.ac.uk | 1 | 200 | `corpus-ppr-medrxiv` |
| 04:17:44 | www.ebi.ac.uk | 1 | 200 | `corpus-ppr-biorxiv` |
| 04:18:40 | api.biorxiv.org (bioRxiv) | 4 | 4 × 200 | `/details/` lookups of four `10.64898/` DOIs |
| 04:19:11 | api.biorxiv.org (medRxiv) | 4 | 4 × 200 | `/details/` lookups of four `10.64898/` DOIs |
| 04:19:33 | eutils.ncbi.nlm.nih.gov (PubMed) | 2 | 2 × 200 | two searches by quoted title phrase; both found 0 records |
| 04:21:12 | eutils.ncbi.nlm.nih.gov | 4 | 4 × 200 | two searches by title words, then two record fetches |
| 04:21:31 | api.crossref.org | 6 | 6 × 200 | one search per title |
| 04:22:19 | export.arxiv.org | 1 | 200 | `corpus-known-papers` |
| **Total** | | **27** | **27 × 200** | Europe PMC 6, PubMed 6, Crossref 6, arXiv 1, api.biorxiv.org 8 |

**The plan, written before anything was sent, and proved by a dry run of the exact scenarios:**

| Source | Planned |
|---|---|
| Europe PMC | 4 |
| PubMed | 4 (2 searches and their 2 record fetches) |
| Crossref | 6 |
| arXiv | 1 |
| bioRxiv | at most 4 |
| medRxiv | at most 4 |
| Total | at most 23, with 12 held back |

**The actual count was 4 over the plan, and still inside the budget:**
- Europe PMC needed 2 replacement searches, because the plain words "bioRxiv" and "medRxiv" returned no record with a DOI.
- PubMed needed 2 replacement searches. The quoted-phrase searches found nothing, so their planned record fetches never happened, and searches by title words were sent instead. That added 2 requests overall.
- Each replacement search was dry-run before it was sent.
- The bioRxiv and medRxiv lookups were dry-run after the Europe PMC search that supplied their DOIs.

## 2. Files

- `test/support/dedupCorpusRecordedRequests.ts`: a new "Targeted recording" section.
  - `DEDUP_CORPUS_PREPRINT_WINDOW`, `DEDUP_CORPUS_PREPRINTS_BIORXIV` / `_MEDRXIV` (the plain-word searches, kept as recorded) and `DEDUP_CORPUS_PPR_BIORXIV` / `_MEDRXIV`.
  - `DEDUP_CORPUS_SERIES_KNOWN`, `DEDUP_CORPUS_KNOWN_PAPERS`, `DEDUP_CORPUS_SERIES_WORDS`, `DEDUP_CORPUS_KNOWN_WORDS`.
  - `DEDUP_CORPUS_PUBMED_NO_RECORDS`, `DEDUP_CORPUS_TITLE_LIMIT`, `DEDUP_CORPUS_CROSSREF_TITLES`.
  - New rows in `DEDUP_CORPUS_SEARCHES`.
- `test/support/biorxivRecordedRequests.ts`: four DOIs added to `BIORXIV_CORPUS_DOIS` and four to `MEDRXIV_CORPUS_DOIS`. Each one is the first of its server, in answer order, among the Europe PMC `PPR` records whose own `bookOrReportDetails.publisher` names that server.
- `scripts/build-dedup-corpus.ts`:
  - `PART_HEADING` is new.
  - `sampledClusterOf` now admits a pair to `short-title-crossref` only when the shared title carries a book-part heading.
  - The file header and section 4b document the change.
- `test/unit/sources/dedupeCorpus.test.ts`:
  - New pins for size, label set, families, sets and the sampled-out line.
  - The shortfall test now asserts an empty list, for all pairs and for the label set.
  - 2 new tests: the two named pairs are labelled in full, and `PART_HEADING` matches whole words only.
- `test/integration/searchDialog-flow.spec.ts`: `PUBMED_FIXTURE_COUNT` now subtracts `DEDUP_CORPUS_PUBMED_NO_RECORDS.length`. It is still derived from the support constants.
- **27 new fixtures with 27 sidecars** (54 files, 719 KB), all written by the recorder:
  - Europe PMC 6, PubMed 6, Crossref 6, arXiv 1, bioRxiv 4, medRxiv 4.
- `test/fixtures/dedup/pairs.jsonl`, `pairs.csv` and `_meta.json`: rebuilt by the builder.
- `plan/03-phase-2-multi-source-dedup.md`: one paragraph, "Part B targeted recording, 2026-10-16".
- `src/` is untouched (the SHA-256 hashes of all 121 files are unchanged). `scripts/record-fixtures.ts` is untouched.

## 3. The new corpus

**Overall size:**
- **Records:** 1,058, up from 898.
- **Candidate pairs:** 534, up from 438. The engine compares 430 of them. The pre-filter skips the other 104, which are kept so that a missed duplicate still counts against recall.
- **Label set:** 267 pairs. 267 are sampled out:
  - the Scotland cluster has 231 pairs, keeps 20 and drops 211;
  - the short-title cluster has 76 pairs, keeps 20 and drops 56.
- **Cross-source pairs** (two records from different sources): 147, all in the label set. There were 80 before.

**The two always-labelled pairs:**
- The short-title cluster now holds only titles with a book-part heading, such as "Part II", "Part III" or "[Part III. Introduction]".
- "Genome Editing Using CRISPR" (Crossref and Crossref) and "Psoroptic Mange" (Crossref and Crossref) are now outside the cluster, with `labelSet: true`.
- The cluster still keeps exactly 20 pairs. They are the same 20 pair ids as before, all book-part headings.

**Families against their minimums:**

| Family | All pairs | Label set | Minimum | Before |
|---|---|---|---|---|
| Same paper from 3 or more sources (sets) | 11 | 11 | 10, met | 5 |
| Preprint and published version | 27 | 27 | 5, met | 9 |
| Short titles | 83 | 27 | 5, met | 25 in the label set |
| Series titles | 16 | 16 | 5, met | 1 |
| Same title, different year, different journal | 15 | 15 | 5, met | 3 |
| `10.64898/` prefix | 11 (bioRxiv 4, medRxiv 4) | 11 | 5, mixed, met | 0 |
| Korean titles | 0 | 0 | none stated | 0 |

**Where the new pairs come from:**
- **Series titles:**
  - 9 pairs from W. D. Hamilton's "The genetical evolution of social behaviour. I / II", recorded from PubMed, Europe PMC and Crossref;
  - 6 pairs from "UniProt: the universal protein knowledgebase in 2021 / in 2023".
- **Same title, different year, different journal:** "Focal Loss for Dense Object Detection" (ICCV 2017 against IEEE TPAMI) and "Spatial Pyramid Pooling…" (ECCV 2014 against IEEE TPAMI 2015).
- **Same-paper sets.** Six are new:
  - Hamilton I;
  - Hamilton II;
  - UniProt 2023;
  - DESeq2, with 5 records including its bioRxiv preprint;
  - Spatial Pyramid Pooling;
  - Focal Loss.
- **`10.64898/` pairs:**
  - 8 pairs of a Europe PMC `PPR` record with the server's own record (4 bioRxiv and 4 medRxiv);
  - 3 Europe PMC–Europe PMC pairs, in which a PubMed Central deposit with no DOI meets the `PPR` record of the same preprint.

## 4. Runs

| Command | Result |
|---|---|
| Dry run with `--only` before each recording | exit 0; each printed exactly the planned scenarios; no new key existed on disk |
| Recordings (9 runs) | exit 0 each; statuses as in section 1 |
| `npx tsx scripts/build-dedup-corpus.ts` | 1,058 records, 534 pairs, label set 267; "Every step-3 family meets its minimum." |
| `npx tsx scripts/build-dedup-corpus.ts --check` | exit 0, "test/fixtures/dedup/ is up to date." |
| Recorder dry run, every source, keys printed against keys on disk | all equal: PubMed 40, Europe PMC 32, Crossref 30, arXiv 20, Semantic Scholar 19, bioRxiv 20, medRxiv 19 |
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0, after `prettier --write` on the corpus test |
| `npx eslint .` | exit 0 |
| `npm run test` | unit tests: 47 files, 2,493 passed (2,491 before, plus 2 new); contract tests: 2 files, 40 passed |
| `npm run test:integration -- --exit-on-finish` | exit 0, "158 passed" on the first try; "40 sidecars aged" (the PubMed count derived from the plan) |
| `npm run dedup:report` | exit 1; it refuses the unlabelled file, as intended |
| `grep -rn MUTANT src test addon typings scripts` | empty |

- **Item 174 recurred.** The recorder rewrote 18 synthetic sidecars under `--only`. All 18 were restored from the snapshot.
- **Hash check afterwards:** all 315 files that existed before match their snapshot SHA-256 hashes, except the 3 dedup files, which the builder rewrote.

## 5. Secret and address checks

- **Key-like environment variables.** Every recording ran with `OPENROUTER_API_KEY` and `CLAUDE_CODE_MESSAGING_TOKEN` removed. These are all the variable names that match `KEYISH_FIELD`; the list was computed at each run and removed with `env -u`. A check found 0 matching names left in that environment.
- No key was read from the operating-system keystore, printed or written.
- Only `NODE_USE_SYSTEM_CA=1` was set. `NODE_TLS_REJECT_UNAUTHORIZED` was never set. No bot check or CAPTCHA page appeared.
- **The recorder's own checks on the 54 new files.** `literalDenyList`, built from the full environment with the keys present (4 values), and `assertClean`, with each plan's own exemptions, found 54 files clean, 0 flagged and 0 environment values.
- **Addresses.** A search for an address pattern finds nothing in the new files or in the dedup files. The new files hold:
  - 10 `[redacted:email-address]` placeholders, in 4 Europe PMC and PubMed fixtures and 1 Crossref fixture;
  - 10 `[redacted:maintainer-address]` placeholders;
  - 1 `[redacted:32]`, which is arXiv's `x-cloud-trace-context` header.
- The maintainer address appears in neither spelling in any new or dedup file.
- **Item 178:** no JSON member name was redacted.

## 6. Mutation table

A mutant is a deliberate small bug, used to prove that the tests notice it. Each was marked `/* MUTANT id */`, restored by file copy, and confirmed restored by SHA-256 hash.

| Id | Mutant on the heading rule | Killed by |
|---|---|---|
| M1 | Heading condition dropped (`true &&`), which is the old behaviour | 6 tests: the byte-identical files, the label-set pin, "keeps exactly 20", the whole-word test, "samples out no pair outside the two clusters", and the labelling sheet |
| M2 | `PART_HEADING` becomes the substring `/part/` | "reads a book-part heading only as whole words" |
| M3 | Heading condition inverted | 8 tests |
| M4 | The numeral may run into more letters (no trailing boundary) | "reads a book-part heading only as whole words" |

## 7. Contradictions

1. **`SRC:PPR` cannot be sent through the adapter, and `raw` cannot help.**
   - The Europe PMC renderer quotes every term value and has no `SRC` or `PUBLISHER` prefix.
   - Its `raw` passthrough appends extra parameters but never touches `query=`.
   - The plain words "bioRxiv" and "medRxiv" (2 requests) returned 25 PubMed Central deposits each, with journal title "bioRxiv : the preprint server for biology" or "medRxiv", and no DOI. They are kept as recorded fixtures and documented in the support file.
   - The search `"bioRxiv" NOT JOURNAL:"bioRxiv"` (and the medRxiv version) returned 25 `PPR` records each. 24 of the bioRxiv records and all 25 medRxiv records carry `10.64898/` DOIs.
2. **PubMed's E-utilities did not find the long quoted title phrases.**
   - Both phrase searches answered `count: 0` with every phrase under `quotedphrasesnotfound`, although Europe PMC returned the same papers with their PubMed identifiers.
   - The two zero answers are kept as recorded evidence (`DEDUP_CORPUS_PUBMED_NO_RECORDS`). Searches by title words followed.
3. **Crossref missed two targets:**
   - **UniProt 2021.** The adapter's `from-created-date` lower bound excludes a DOI registered in November 2020 for a 2021 issue.
   - **The AlphaFold Nature article.** Relevance ranking returned five "Faculty Opinions recommendation of …" records instead. So AlphaFold is not a set.
   - Those five records share an identical title and year, which forms 10 pairs among themselves, all in the label set.
4. **The family rule counts some pairs the brief may not have had in mind:**
   - The `10.64898/` rule counts a pair when either record carries the prefix, so 3 of the 11 are Europe PMC–Europe PMC pairs (a PubMed Central deposit and a `PPR` record). The server pairs alone are 8 (4 bioRxiv and 4 medRxiv), which still meets 5 mixed.
   - The same-title-other-year family also counts arXiv records against journal records, because those arXiv records carry a venue.
5. **Choices made in this run:**
   - the August–September 2026 window;
   - the rule "the first four `PPR` records per server, in answer order";
   - a page size of 5 for the Crossref title searches.
   One of the four bioRxiv lookups is a withdrawn preprint (titled "WITHDRAWN: …" in both sources).

## 8. What I did not check

- Engine verdicts were not looked at. `dedup-report.ts` was only run to confirm that it refuses the unlabelled file.
- Same-paper sets are 11 against a minimum of 10, so the margin is one set.
- Whether Europe PMC's `NOT JOURNAL:` exclusion also drops `PPR` records of other servers was not studied. Only the 50 records returned were inspected.
- `--merge-labels` was not run with the new sheet.
- The labelling web page (item 222's artifact) was not updated to the 267-pair sheet.

## 9. Follow-ups

1. **Refresh the coordinator's labelling page** from the new `test/fixtures/dedup/pairs.csv` (267 label-set pairs). Labels already written carry over by pair id.
2. **8 of the card's 85 requests are unused.** No further recording is needed for the step-3 families.
3. **Owner decision:** whether the 10 identical-title "Faculty Opinions" pairs should join a sampled cluster, or stay labelled in full.
4. **Item 174** (the recorder rewrites synthetic sidecars under `--only`) is still open.
5. **Two adapter facts are worth recording in `docs/02`:**
   - E-utilities ignores long quoted title phrases (`quotedphrasesnotfound`);
   - Crossref's `from-created-date` lower bound drops articles whose DOI was registered before their cover year.

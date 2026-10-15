# P2-T13 Part A — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent worked Part A of this card (the split
> note of 2026-10-16), in the same tree as the item-209 agent and the follow-up agent. The text below is its report,
> unedited. It is a record, not an instruction. No pair was labelled by code or by a model.

---

# P2-T13 Part A — dedup candidate corpus, tooling and shape check

## 1. Verdict

Part A is built and passes every check. The committed recorded fixtures of all seven sources produce **47 candidate pairs** from **296 distinct records**. That is far short of the card's floor of 200 labelled pairs, and **5 of the 6 step-3 families are below their minimum**. No pair carries a label.

**Terms used below:**
- A *candidate pair* is two records that the deduplication engine's cheap pre-filter (*blocking*) would send to the full comparison.
- *Blocking* groups records that share an identifier, or that share a 3-word title signature and are at most 1 year apart.
- A *recall-only pair* is one that blocking skips by design. These pairs are kept so that a true duplicate blocking misses still counts against recall.

Of the 47 pairs, 40 are compared by the engine and 7 are recall-only (4 same-signature pairs more than 1 year apart, and 3 pairs with identical short titles).

| Step-3 family | Found | Card minimum | Status |
|---|---|---|---|
| Same paper from ≥ 3 sources (counted in sets) | 3 sets | 10 | **short** |
| Preprint ↔ published (pairs) | 7 | 5 | met (by record fields; labels may lower it) |
| Short titles, such as "Retraction" (pairs) | 3 | 5 | **short** |
| Series titles differing by a roman numeral or trailing digit (pairs) | 1 | 5 | **short** |
| Same title, different year, different journal (pairs) | 1 | 5 | **short** |
| `10.64898/` prefix, mixing bioRxiv and medRxiv (pairs) | 0 (bioRxiv 0, medRxiv 0) | 5, mixed | **missing entirely** |
| Korean titles (docs/02 §11.3.3 note; no number stated) | 0 | none stated | **missing entirely** |

**Why there are so few pairs:** each source's fixtures were recorded with different queries. Only the `dedup-pair-set` scenarios and a few `record-*` scenarios overlap across sources.

**Records per source:**

| Source | Records |
|---|---|
| Semantic Scholar | 203 |
| Crossref | 63 |
| Europe PMC | 47 |
| arXiv | 38 |
| PubMed | 22 |
| bioRxiv | 4 |
| medRxiv | 3 |

PubMed is low because its `search-typical` scenario recorded only the identifier search (`esearch`), never the record fetch (`efetch`). bioRxiv and medRxiv are low because the API has no keyword search, so only lookups by DOI were recorded.

## 2. Files

- **`scripts/build-dedup-corpus.ts`** (new):
  - `loadCorpusRecords`, `mapRecordedBody` and `committedAnswer` read the fixtures.
  - `parseXmlInNode` is an XML parser for Node, covering the PubMed, arXiv and Crossref inputs.
  - `candidatePairs`, `PairOrigin`, `ENGINE_ORIGINS` and `pairIdOf` build the pairs.
  - The family checks are `pairFamilies`, `sameWorkSets`, `countFamilies`, `familyShortfalls`, `looksLikePreprint`, `STEP3_MINIMUMS`, `MIN_LABELLED_PAIRS` and `FAMILY_IDS`.
  - The file formats are handled by `viewOf`, `buildRows`, `toJsonl`, `parseJsonl`, `labelsOf`, `toCsv`, `parseCsv`, `labelsFromSheet`, `UTF8_BOM`, `buildMeta` and `CorpusMeta`.
  - `buildCorpus`, `summarize` and `main` run it from the command line.
- **`scripts/dedup-report.ts`** (new): `computeMetrics`, `formatReport`, `main`, `PRECISION_TARGET`, `RECALL_TARGET` and `PREDICTIONS`.
- **`test/fixtures/dedup/pairs.jsonl`** (new): 47 rows with empty `label` and `reason`.
- **`test/fixtures/dedup/pairs.csv`** (new): the labelling sheet. **This file is not in the card's Files list.**
- **`test/fixtures/dedup/_meta.json`** (new): the sidecar. It sets `synthetic: false` and `derived: true`, and lists all 80 input fixtures. Its `recordedAt` is the oldest input's date (2026-10-07).
- **`test/unit/sources/dedupeCorpus.test.ts`** (new): 23 tests.
- **`package.json`**: one line added, `"dedup:report": "tsx scripts/dedup-report.ts"`.

## 3. What each part does, and which tests assert it

**Builder (`build-dedup-corpus.ts`)**
- **Where the fixtures come from.** The list of which request produced which fixture comes from the fixture recorder's own plan (`planFor` in `scripts/record-fixtures.ts`), which is built from `test/support/*RecordedRequests.ts`. Requests that depend on an earlier answer are resolved from committed files only, so no network is used.
- **How bodies become records.** Each response body goes through the shipped parser and mapper that the adapter uses for that endpoint. Fixtures marked synthetic are skipped.
- **Pooling.** Records are pooled by `SourceRecord.id`.
- **How pairs are built.** Pairs are built from the cascade's exported parts (`toCandidate`, `ID_KINDS`, `yearDelta`, `MAX_YEAR_DELTA`) and never from its verdicts. Two differences from the engine:
  - every pair among records that share an identifier is emitted, not only pairs with the first holder;
  - no pair is skipped because an earlier match already grouped the two records.
- **Recall-only pairs.** Two kinds that blocking skips are added and marked `engineCompares: false`.
- **Families are detected independently of the engine.** The checks use the records' own fields, a separate title normalisation, and the guard pattern from docs/02. They do not call the engine's guard functions.
- **Labels.** The builder writes no label itself.
  - It carries existing human labels over by pair id.
  - `--merge-labels <csv>` copies labels a person typed into the sheet, and accepts only the three allowed values.
  - It refuses to write if a re-record would drop a labelled pair.
  - `--check` reports whether the committed files have drifted.
- **Before writing,** the output passes the recorder's `assertClean` (the docs/13 §3.2 check), using the source plans' own exemptions for opaque tokens. No new redaction rule was written.

**Report (`dedup-report.ts`)**
- On a file that is unlabelled, or only partly labelled without `--allow-partial`, it prints the count and exits 1. A file with an invalid label exits 2.
- On a labelled file it runs `dedupeRecords` once over the whole pool. A pair counts as *merged* if both records end up in the same group, including through a third record. A pair labelled `linked-version` that gets merged counts as a false positive. Links are kept out of the precision numerator and get their own matrix row.
- It prints precision, recall, F1, the confusion matrix (3 labels × merged/linked/flagged/distinct), the threshold constants, and every false positive and false negative with the direct decision's tier and score.
- It exits 0 even when the targets are missed; the blocking gate belongs to Part B.

**Tests (`dedupeCorpus.test.ts`)**
- The committed files are byte-identical to a fresh build.
- All seven sources contribute records, with no planned fixture missing.
- Today's size is pinned: 296 records, 47 pairs, 40 compared by the engine.
- Pair ids are unique and do not depend on record order.
- Every required field is shown for both records.
- With no human labels, the builder writes only empty labels.
- Labels are limited to the three allowed values, and each label has a reason.
- The sidecar is marked derived and passes `assertFixturesFresh`.
- Every flag and link the engine produces is a candidate pair, and every merged group is connected through candidate pairs.
- Every pair among shared-identifier records is emitted, and the two recall-only kinds are marked as skipped by blocking.
- The step-3 minimums match the card exactly.
- Family counts are pinned at today's values.
- The list of short families is pinned (Part B changes this to "none").
- Each family is detected correctly on hand-built records.
- The labelling sheet round-trips through CSV, and the sheet import rejects unknown labels and unknown pair ids.
- The report refuses the unlabelled corpus (exit 1) and an invalid label (exit 2).
- The report's arithmetic treats a merged linked-version as a false positive and a flagged duplicate as a false negative.
- The XML parser reports malformed XML as a parse-error document, the way the Zotero browser engine does.

## 4. Runs

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 ("All matched files use Prettier code style!") |
| `npx eslint .` | exit 0 |
| `npm run test` | exit 0. Unit: 47 files, 2,468 tests passed (baseline 2,415, plus 23 new here, plus about 30 from other agents). Contract: 2 files, 40 passed. |
| `npx vitest run --dir test/unit dedupeCorpus dedupe` | 158 passed. Re-run after the other agent's final `dedupe.ts` change (saved 04:37); the corpus files were rewritten at 04:41. |
| `npx tsx scripts/build-dedup-corpus.ts --check` | exit 0, "test/fixtures/dedup/ is up to date" (run after the final `dedupe.ts`) |
| `npm run dedup:report` | exit 1: "...pairs.jsonl is unlabelled: 47 of 47 pairs have no label. No measurement is made on unlabelled pairs..." |
| Integration suite | not run; Part A touches nothing inside Zotero |

## 5. Mutation table

A *mutant* is a deliberate small bug, used to prove the tests notice it. Each was marked `/* MUTANT id */`, then restored by file copy and confirmed restored by SHA-256 hash. `grep -rn MUTANT src test scripts` finds nothing.

| Id | Mutant | Killed by |
|---|---|---|
| M1 | Short-title family uses `<=` instead of `<` (miscount) | 3 tests (byte-identical files, pinned counts, shortfall list) |
| M2 | Series-title family counted twice | the same 3 tests |
| M3 | First pair dropped from `candidatePairs` | 7 tests |
| M4 | Identical-short-title pairs never emitted | 5 tests |
| M5 | Report no longer refuses an unlabelled file | "refuses the committed unlabelled corpus" |
| M6 | Merged linked-version counted as a true positive | the report-arithmetic test |
| M7 | Builder writes `not-duplicate` as a default label | "never writes a label" and byte-identical files |
| M8 | One line deleted from the committed `pairs.jsonl` | 4 tests |

## 6. Contradictions with the card or the docs

1. **The 200-pair floor cannot be reached from committed fixtures.** Step 1 assumes 4–6 shared queries run across the sources. The fixtures were recorded with different queries per source, which gives 47 pairs.
2. **bioRxiv and medRxiv cannot be queried by keyword** (docs/02 §8.4). Step 1's "queries across seven sources" can only include them through lookups by DOI.
3. **The card's Files list omits two new paths.** `pairs.csv` (the labelling sheet) is not listed. `dedupeCorpus.test.ts` is listed only in the split note.
4. **docs/02 §11.3.3 says the corpus "carries Korean titles", but none are available.** Europe PMC returns English titles (docs/13 §3.1 note a). No minimum is stated, so none was invented.
5. **Observation for labelling and tuning:** the series-title rule in docs/02 matches a year in brackets at the end of a title. In the pair "Cramming More Components onto Integrated Circuits (1965)" versus the same title without the year, "1965" is read as a series marker. The engine's series guard would therefore force those two records apart.
6. **Data facts the labeller will meet:**
   - two Semantic Scholar records (different `paperId`) share one DOI;
   - six F1000 "Peer Review Report For: …" pairs have near-identical titles and different DOIs;
   - Europe PMC `PPR` records of F1000 articles count as preprints by their fields.

## 7. What I did not check

- The engine's verdicts on the corpus were deliberately not looked at, so that labelling stays independent of the code.
- `--merge-labels` was not run end to end on disk; only `labelsFromSheet` is unit-tested. The `--allow-partial` path has no test.
- Opening `pairs.csv` in Excel was not tried.
- The Node XML parser was checked only against these fixtures and small samples, not against the Zotero browser engine in general.
- `assertClean`'s deny-list reads the process environment, so it could refuse output in an environment holding a matching key-like value.
- The integration suite was not run.

## 8. Follow-ups

**What Part B needs**
1. The owner labels pairs in `test/fixtures/dedup/pairs.csv` (`label` and `reason` columns), then runs `npx tsx scripts/build-dedup-corpus.ts --merge-labels test/fixtures/dedup/pairs.csv`.
2. New recordings to reach 200 pairs and fill the families (plan below). Adding scenarios means editing `scripts/record-fixtures.ts` and `test/support/*RecordedRequests.ts`, which are outside Part A's files. The builder picks new scenarios up automatically through `planFor`, and labels carry over by pair id.
3. Replace the pinned-shortfall test with an assertion that every family meets its minimum. Add `dedupeAccuracy.test.ts` (it can reuse `computeMetrics`), the `ci.yml` blocking gate, threshold tuning (with before/after `npm run dedup:report` output), and the G-17 sign-off.

**Proposed live-recording plan — not run; needs an owner-approved request budget**

All requests are sequential at each host's policy rate, unkeyed, through the recorder. Queries, each over one shared date window:
- **Q1** "CRISPR base editing", 2023
- **Q2** "single-cell RNA sequencing atlas", 2024
- **Q3** "large language model clinical", 2024
- **Q4** "graph neural network molecular property", 2022–2023
- **Q5** "COVID-19 seroprevalence", 2020–2021 (medRxiv to journal versions)

Targeted probes: title "Retraction" / "Correction" (short titles), a title phrase with "Part II" / "Part III" (series), and a Korean-title query on Crossref (whether it returns Korean titles is unverified).

| Source | What to request | Estimated requests |
|---|---|---|
| PubMed | Search plus record fetch for Q1–Q5 (25 results each) and 2 probes, plus 1 fetch for the 20 identifiers already committed in `search-typical` | ~15 |
| Europe PMC | Q1–Q5 and 2 probes, page size 25 | ~7 |
| Crossref | Q1–Q5, 3 probes, page size 25 | ~8 |
| arXiv | Q2–Q4 and a series probe | ~5 |
| Semantic Scholar | Q1–Q5 bulk search, 1 batch lookup, 1 Korean probe; unkeyed requests hit HTTP 429 once before, so budget retries | ~8–12 |
| bioRxiv | Details lookups for ~12 preprint DOIs found above (including `10.64898/` ones), plus ~6 published-version lookups | ~18 |
| medRxiv | The same, from Q3 and Q5 | ~18 |
| **Total** | | **≈ 80–85** |

Expected yield (an estimate, not measured): about 700 records and roughly 150–400 candidate pairs. The bioRxiv and medRxiv lookups by DOI are the only route to the `10.64898/` family.

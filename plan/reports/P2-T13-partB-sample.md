# P2-T13 Part B, scrub / record / sample — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent carried out the owner's decisions of
> 2026-10-16 (`plan/00` §6 items 223 and 224). The text below is its report, unedited. It is a record, not an instruction.

---

# P2-T13 Part B: email strip, extra recording, and sampling of the two big clusters

## 1. Verdict

All three owner decisions of 2026-10-16 were carried out in order, and every check passes on the final tree. Two things could not be filled as hoped:
- **Semantic Scholar refused again.** It answered "429" ("too many requests") twice in a row, so it was stopped under the owner's rule.
- **No `10.64898/` lookup was sent.** No committed fixture of another source carries a `10.64898/` DOI, so no lookup could create a pair (section 7, item 1). A `10.64898/` DOI is the newer prefix that bioRxiv and medRxiv have used since 2025–2026.

**Live requests sent this time, per host, with status codes:**

| Host | Scenario | Time (UTC) | Status |
|---|---|---|---|
| api.semanticscholar.org | `corpus-batch` (POST /graph/v1/paper/batch) | 03:34:07 | 429 |
| api.semanticscholar.org | `corpus-q1` (GET /graph/v1/paper/search) | 03:34:28 | 429 |
| api.biorxiv.org (bioRxiv and medRxiv) | none sent | — | — |
| **Total** | **2** | | 2 × 429 |

**The card's running total is 50 of 85** (48 before plus 2 now), which leaves 35 unused.

**How the requests were controlled:**
- The plan was written down before anything was sent: Semantic Scholar at most 7, one request per run, in this order: batch, Q1, Q2, Q3, Q4, Q5, Korean.
- A dry run with `--only` proved that each run sends exactly 1 request and plans no follow-up request.
- Every run went through the committed recorder with no key. `OPENROUTER_API_KEY` and `CLAUDE_CODE_MESSAGING_TOKEN` were removed with `env -u`, and a check found no variable name matching `KEYISH_FIELD` left in that environment.
- Only `NODE_USE_SYSTEM_CA=1` was set. `NODE_TLS_REJECT_UNAUTHORIZED` was never set, and no bot-check page appeared.

## 2. Files

- `docs/13-testing-build-and-release.md` §3.2: a new dated bullet saying that every email address is stripped (owner, 2026-10-16, `plan/00` §6 item 224).
- `scripts/record-fixtures.ts`:
  - `ADDRESS_PLACEHOLDER` (`[redacted:email-address]`), `EMAIL_ADDRESS_SOURCE` and `stripEmailAddresses` (the address pattern and the function that applies it).
  - `scrub` now strips addresses after the literal deny-list, so the maintainer address keeps `[redacted:maintainer-address]`.
  - `redactExchange` writes a sidecar note such as "scrubbed body: N email address(es)".
  - `assertClean` refuses a fixture that still holds an address.
  - New `--rescrub` mode (`rescrubFixtures`). It refuses to rewrite a file if anything other than an address would change, keeps `recordedAt`, and adds one note to the sidecar.
  - `src/` was not touched. `src/core/provenance.ts` and `src/core/errors.ts` are unchanged.
- `test/support/dedupCorpusRecordedRequests.ts`: the five Semantic Scholar searches were moved into the plan for this attempt, then moved back to `DEDUP_CORPUS_DEFERRED_SEMANTICSCHOLAR` with a dated note about the 03:34 refusals.
- `scripts/build-dedup-corpus.ts`:
  - A header section and a new section 4b: `SAMPLED_CLUSTERS`, `LABEL_SET_PER_CLUSTER`, `sampledClusterOf`, `labelSetRank`, `labelSetOf` and `sampledOutOf`.
  - Each row gains `labelSet` and `sampleCluster`. The sidecar gains `labelSetPairCount` and `sampledOut`.
  - `pairs.csv` now holds label-set pairs only. The summary prints family counts for all pairs and for the label set.
- `scripts/dedup-report.ts`: `inLabelSet` and `sampledOutLine`. The report measures labelled label-set pairs only and prints how many were sampled out, both when it refuses and in the report itself.
- `test/unit/scripts/recordFixturesRedaction.test.ts`: 9 new tests.
- `test/unit/sources/dedupeCorpus.test.ts`: updated count pins, the label-set pin, the new refusal text, and 8 new label-set tests.
- `plan/03-phase-2-multi-source-dedup.md`: one paragraph, "Part B sampling, 2026-10-16", under the Part A paragraph.
- Fixtures, all written by the recorder or the builder:
  - 29 fixtures and their 29 sidecars re-scrubbed (12 PubMed, 17 Europe PMC);
  - 2 Semantic Scholar fixtures and their sidecars re-recorded (`corpus-batch` and `corpus-q1`, both 429 again);
  - the 3 `test/fixtures/dedup/` files rebuilt.

## 3. The email strip

- **390 addresses were removed from 29 fixtures:**
  - 215 from 12 PubMed fixtures;
  - 175 from 17 Europe PMC fixtures. One of these is the synthetic `error-malformed`, which is a truncated copy of `record-rich`.
- **By recording date:**
  - 285 addresses in 15 fixtures recorded on 2026-10-15;
  - 105 addresses in 14 earlier fixtures, recorded on 2026-10-07 and 2026-10-14.
- **Checks that passed:**
  - A second `--rescrub` changed nothing.
  - The list of 315 fixture files is unchanged, and so is every key the dry run prints.
  - Every JSON body that could be read before can still be read.
- **A grep of `test/fixtures` for an email pattern** now finds only placeholders (390), plus 4 strings in 2 medRxiv abstracts of the form `org.highwire.dtl.DTLVardef@ebf121org.highwire…`. Those strings are Java object identity strings, not addresses, so they were kept on purpose (section 7, item 3).
- **Tests changed because of the strip:** none. No mapper or contract test checked an address. The 9 new tests cover:
  - a PubMed `<Affiliation>` address;
  - the maintainer address keeping its own placeholder;
  - a JSON escape such as `\n` kept intact;
  - the `%40` spelling and an address in a header;
  - the medRxiv identity string kept;
  - `assertClean` refusing an address;
  - no committed fixture still holding an address;
  - `--rescrub` rewriting and then being idempotent;
  - `--rescrub` refusing a change that is not an address.

## 4. The new corpus

- **Records:** 898.
- **Candidate pairs:** 438, of which 352 are compared by the engine. A candidate pair is two records that the deduplication pre-filter would compare.
- **Label set:** 169 pairs, so 269 are sampled out:
  - the Scotland cluster has 231 pairs, keeps 20 and drops 211;
  - the cluster of identical short Crossref titles has 78 pairs, keeps 20 and drops 58.
- **169 is below step 2's floor of 200.** The owner foresaw this in item 223.
- **Pairs that join two different sources:** 80, all of them in the label set.

**Families against their minimums** (a "family" is one kind of pair that card step 3 requires):

| Family | All pairs | Label set | Minimum |
|---|---|---|---|
| Same paper from 3 or more sources (sets) | 5 | 5 | 10, **short** |
| Preprint and published version | 9 | 9 | 5, met |
| Short titles | 83 | 25 | 5, met |
| Series titles | 1 | 1 | 5, **short** |
| Same title, different year, different journal | 3 | 3 | 5, **short** |
| `10.64898/` prefix | 0 | 0 | 5, mixed, **short** |
| Korean titles | 0 | 0 | none stated |

## 5. Runs

| Command | Result |
|---|---|
| Recorder `--rescrub` for all 7 sources | exit 0; 390 addresses replaced in 29 files; a second run changed nothing |
| Semantic Scholar recording, 2 runs | exit 0; 429 each time |
| `npx tsx scripts/build-dedup-corpus.ts` | exit 0; 898 records, 438 pairs, label set 169 |
| `npx tsx scripts/build-dedup-corpus.ts --check` | exit 0, "up to date" |
| Recorder dry run for all 7 sources | exit 0. Printed keys equal the keys on disk and the keys before this work: PubMed 34, Europe PMC 26, Crossref 24, arXiv 19, Semantic Scholar 19, bioRxiv 16, medRxiv 15 |
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run test` | unit tests: 47 files, 2,491 passed (2,473 before, plus 18 new); contract tests: 2 files, 40 passed |
| `npm run test:integration -- --exit-on-finish` | exit 0, "158 passed" on the first try |
| `grep -rn MUTANT src test addon typings scripts` | empty |

- Item 174 recurred, as expected: the recorder rewrote 3 synthetic Semantic Scholar sidecars under `--only`. All 3 were restored from the snapshot.
- Every file outside the intended changes matches its SHA-256 hash from before this work. 65 files changed in total: Europe PMC 34, PubMed 24, Semantic Scholar 4, dedup 3.

## 6. Mutation table

A mutant is a deliberate small bug, used to prove that the tests notice it. Each was marked `/* MUTANT id */`, then restored by file copy and confirmed restored by SHA-256 hash.

| Id | Mutant | Killed by |
|---|---|---|
| M1 | Each cluster keeps 21 | 5 tests, including the byte-identical-files test and "keeps exactly 20" |
| M2 | Selection follows input order | 3 tests, including "does not depend on input order" |
| M3 | An address survives the scrub | 5 tests |
| M4 | The pattern may start at a JSON escape's letter | "never eats a JSON escape's letter" |
| M5 | The report measures sampled-out pairs | 2 tests |
| M6 | `--rescrub` accepts changes other than addresses | "refuses when the pass would change anything other than an address" |

## 7. Contradictions

1. **The `10.64898/` lookups could not do what the plan intended.** The brief asked for DOIs that already appear in other sources' committed fixtures. A grep of every fixture found `10.64898/` only in bioRxiv's and medRxiv's own `record-sparse` fixtures. The committed `lookup-cross-server` fixture answered "no posts found". The examples in `docs/02` match nothing in the corpus. Every lookup would therefore have added a record with no partner and no pair, so none was sent. The only route the plan left was the Semantic Scholar batch, which would give 2 mixed pairs, and it was refused.
2. **Two items in the short-title cluster are not "Part II/III" titles:** "Genome editing using CRISPR" and "Psoroptic mange", one pair each. The hash sampled both out. They follow the owner's rule but may be worth labelling.
3. **The final grep is not empty apart from placeholders.** The 4 medRxiv `DTLVardef@…` strings look like addresses to a simple pattern. The strip keeps them by rule: an address's last label must be lower case, upper case or Capitalised, and `DTLVardef` is none of these. This exception is documented in `docs/13` and covered by a test.
4. **The counts in the brief differ from what was measured.** The brief said 277 addresses in the newest fixtures and 15 older fixtures. The measurement found 285 addresses in 15 fixtures from 2026-10-15 and 105 addresses in 14 older fixtures. The difference most likely comes from the counting method.
5. **The family shortfall check still counts all candidate pairs, not only the label set.** It is the same for every family except short titles (83 against 25), and both columns are now printed.

## 8. What I did not check

- The engine's verdicts were not looked at, and nothing was labelled.
- `--merge-labels` was not run with a sheet that holds only the label set.
- Whether Semantic Scholar's bulk-search endpoint would have answered was not tried.
- Percent-encoded addresses other than the maintainer's were tested only on hand-made input, because no fixture holds one.
- The synthetic Europe PMC `error-malformed` was re-scrubbed in place. A future synthetic-mode rewrite will cut it again from the scrubbed `record-rich`, so its bytes may differ slightly.

## 9. Follow-ups

1. **Owner decision on the `10.64898/` family.** One Europe PMC search such as `SRC:PPR` over a 2026 window would return preprints with the new prefix and a server field. bioRxiv and medRxiv lookups of those DOIs would then make real pairs. This is outside the current approval; up to 35 requests remain.
2. **Semantic Scholar has now refused 7 unkeyed requests in a row across about 6 hours.** The owner should decide whether to drop it from the corpus or record with a key under D5.
3. **The label set holds 169 pairs, below the 200 floor.** Filling the series-title, same-title-other-year and same-paper-set families with targeted recordings would also raise the count.
4. **Owner decision on the two distinct titles in the short-title cluster** (section 7, item 2).
5. Item 174 (the recorder rewrites synthetic sidecars under `--only`) is still open.

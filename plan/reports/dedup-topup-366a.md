# Dedup sample top-up, `plan/00` §6 item 366(a), 2026-11-11

**Findings.** Ten more pairs were drawn once, at random, for the owner to label in chat. They came from the 225 label-set pairs that have no label and were not among the first 60, and were drawn by the first draw's method under the new recorded seed `P2-T13 label sample top-up 2026-11-11`. The draw is stored as a second block, `topUp`, in `test/fixtures/dedup/label-sample.json`. The first block is unchanged and no label or reason was written. The ten split by today's engine outcome as merged 5, linked 1, flagged 1, distinct 3, and two of them are among the 18 pairs that `P2-T39` added. `dedup-label-sample.ts --check` passes again: it re-derives each draw from its own recorded population and seed, and checks that today's label set (285 pairs) is exactly what the top-up saw. `npm run dedup:report` now measures the 60 and the 10 together and says in its output that the two draws together are not one stratified draw. As designed, it still refuses to measure while a sampled pair is unlabelled, so **it exits 1 today** with "10 of 70 sampled pairs have no label (first draw 60 of 60 labelled, top-up 0 of 10 labelled)". This does not meet the brief's "must still exit 0"; the brief's fallback was to keep the existing design and say what it does, and that is what was done. With `--allow-partial` it exits 0 and measures the 60 as before. The chat list for the ten is at `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\dedup-topup\list.json`. It has the same shape as the earlier list and contains no engine outcome and no stratum.

## 1. Method, and where it is documented

The method is in `docs/02` §11.3, in the note "Decided 2026-11-11 (owner, `plan/00` §6 item 366(a)): a ten-pair top-up", placed directly after the 2026-10-25 sample note. It was written before the code, and a "Measured the same day" paragraph was added after the run.

- **Population.** Every label-set pair (`inLabelSet`) that has no label and is not in the first draw's `sample`. This includes the 18 pairs `P2-T39` added. The first draw has **no cluster rule**: `scripts/dedup-label-sample.ts` never excluded a pair for sharing a record or a `sampleCluster` with a pair already drawn. (`sampleCluster` belongs to the 2026-10-16 label-set sampling in `build-dedup-corpus.ts`, not to this sample.) So no cluster rule is applied to the top-up either; the note records this.
- **Strata.** Today's engine outcome for each pair, read by `outcomeIndex` from one `dedupeRecords` run over the whole record pool (`stratifyLabelSet`). This is the same reading the first draw used.
- **Allocation.** The same `allocateProportional` (largest remainder, ties in `PREDICTIONS` order, at least one pair for each stratum that has any).
- **Within a stratum.** The same `drawStratifiedSample`: the smallest `sampleRank` (SHA-256 of seed + pairId) is drawn first, ties broken by pair id.
- **Display order.** The same `displayRank`, under the new seed.
- **Seed.** `TOP_UP_SEED` = `P2-T13 label sample top-up 2026-11-11`. `TOP_UP_SIZE` = 10. `TOP_UP_DATE` = 2026-11-11.
- **How the two draws are reported.** Recorded as **DECIDED 2026-11-11 (coordinator, under item 313)** in the same note. The measured sample is the union of the 60 and the 10. The top-up was drawn after the engine changed (`P2-T38`, `P2-T39`) and from a different population, so the union is not one stratified draw. The report adds the labelled pairs of both draws together without weights, and its Wilson intervals describe those pairs, not one random sample of the label set. The report prints this in its own output, shows each draw's strata separately, and states how many of the 70 pairs have labels.

## 2. The ten pairs drawn

The top-up's population is 225 pairs: merged 125, linked 28, flagged 12, distinct 60. No labelled pair was left out, because no pair outside the first 60 carries a label. The exact proportional shares were 5.56, 1.24, 0.53 and 2.67. Rounding down gives 8; the two remaining places went to the largest remainders, distinct and flagged. Allocation: **merged 5, linked 1, flagged 1, distinct 3**.

| Chat order | Pair id | Stratum at the draw | Note |
|---|---|---|---|
| 1 | `p-17ddd9a7ba34` | flagged | |
| 2 | `p-a07afb31c1aa` | merged | |
| 3 | `p-df298cf5ca83` | merged | one of the 18 `P2-T39` pairs (origin `doi-family`) |
| 4 | `p-c24576e2fcf7` | merged | |
| 5 | `p-2eb51ec849a3` | linked | |
| 6 | `p-6512a2dca4df` | merged | |
| 7 | `p-929725332c7e` | distinct | |
| 8 | `p-7e83a20f4a2b` | merged | one of the 18 `P2-T39` pairs (origin `doi-family`) |
| 9 | `p-b5ee52803e92` | distinct | |
| 10 | `p-1860615b1c90` | distinct | |

Among the top-up's 225 pairs, 27 apart from the 18 new ones moved stratum between the first draw and today. They are counted under today's stratum, as the method says.

## 3. Files changed

- `docs/02-literature-database-apis.md`: §11.3, the new dated note (method, the coordinator decision on reporting, and what was measured that day).
- `scripts/dedup-label-sample.ts`:
  - `--extend=N` and `buildTopUp`: appends the `topUp` block. It refuses when a top-up already exists or when there is no first draw, and never writes a label.
  - `--redraw` now refuses while a top-up exists.
  - `checkLabelSample` re-derives both draws and checks the label set against what the top-up saw.
  - `serializeLabelSample` writes the block.
  - `main` takes an optional `dir`, so tests can run it on a temporary copy.
  - The header now describes the top-up.
- `scripts/dedup-report.ts`:
  - New `LabelSampleTopUp`, `DrawStrata` and `sampledPairsOf`. `parseLabelSample` checks both draws through a shared `parseDraw`, and checks that the top-up has no pair from the first draw's sample.
  - Sample mode measures the union. It prints the top-up's strata table and the statement that the union is not one stratified draw. "Labelled pairs measured" now says how many of the 70 have labels, per draw. The refusal and the `PARTIAL` line give the per-draw counts.
  - A file without a top-up prints exactly as before.
- `test/fixtures/dedup/label-sample.json`: the `topUp` block was appended by the script's one run. The first block is byte-for-byte unchanged.
- `test/unit/sources/dedupeLabelSample.test.ts`: the pins were updated with dated comments:
  - the check passes against the whole label set;
  - the 18 are unlabelled unless the top-up drew them;
  - no label appears in either draw;
  - the first draw still re-derives;
  - a draw-day check that the top-up's strata are today's outcomes;
  - the committed report test: exits 1 without `--allow-partial` while a top-up pair is unlabelled, and gives the per-draw counts;
  - the synthetic-label report test now pins the single-draw output on a copy without the top-up, plus the output for both draws together.

  New tests:
  - the population excludes labelled pairs and pairs already in the sample, and records the labelled pairs it left out;
  - the allocation sums to 10 by the same rule (125/28/12/60 gives 5/1/1/3);
  - the draw is deterministic for a seed, does not depend on input order, and changes with another seed;
  - a second top-up is refused, both by the function and by the command;
  - no label is written (rows untouched, `pairs.jsonl` byte-identical, no `"label"` key);
  - `--check` fails when the label set grows, when a first-draw pair disappears, or when the top-up is edited;
  - malformed top-up blocks are refused;
  - `--extend=10` on a temporary copy reproduces the committed file byte for byte.
- No other test pins the sample: `dedupeCorpus.test.ts` uses `--full` and is unaffected. Nothing in `src/` changed, so no integration run was needed.

## 4. Checks (key removed: `env -u OPENROUTER_API_KEY`)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 (eslint clean; Prettier: all files formatted) |
| `npx eslint .` | exit 0 |
| `npm run test` | exit 0. Unit: 138 files, 7,743 passed, 105 skipped. Contract: 6 files, 84 passed, 28 skipped |
| `npx vitest run test/unit/sources/dedupeLabelSample.test.ts` | 34 passed |
| `npm run dedup:report` | **exit 1** (the existing design): "10 of 70 sampled pairs have no label (first draw 60 of 60 labelled, top-up 0 of 10 labelled). No measurement is made on unlabelled pairs." |
| `npm run dedup:report -- --allow-partial` | exit 0. Labelled pairs measured: 60 of 70. Precision 1.0000 [0.8985, 1.0000] over 34 merged pairs, undecided. Recall 1.0000 [0.8985, 1.0000] over 34 true duplicates, undecided |
| `npx tsx scripts/dedup-label-sample.ts --check` | exit 0 (it exited 1 before the draw) |
| `npx tsx scripts/dedup-label-sample.ts --extend=10` run again | exit 1, "already holds a top-up … Nothing was written." |
| `npx tsx scripts/build-dedup-corpus.ts --check` | exit 0, "test/fixtures/dedup/ is up to date." |
| `pairs.jsonl` and `pairs.csv` SHA-256 before and after | unchanged |

Nothing was committed or pushed.

## 5. For the owner

1. **The ten pairs are ready for chat.** Ask them four at a time from `list.json`, in its order (`n` 1–10). The entries hold only the two records: title, authors (as the corpus stores them, cut after eight with "et al." plus the count), year, type, venue, source, DOI and other ids, and linked versions. As in the earlier list, the Semantic Scholar corpus id is left out. After labelling, the labels are merged with `build-dedup-corpus.ts --merge-labels` as before, and `npm run dedup:report` then exits 0 and measures all 70.
2. **Two pairs repeat one question.** Pairs 7 and 10 compare the same two papers (the 2023 "Pillars of Biology" commentary and Hamilton's 1964 paper), taken from different sources. Pairs 3 and 8 are both two eLife documents about one paper: a reviewer's report and the eLife assessment, which `P2-T38`'s rule merges. Pair 9 is one of the identical short Crossref titles, from two different encyclopaedias.
3. **What the labels can decide.** Five of the ten are pairs the engine merges. If all five are labelled "same paper" and none of the other five is, recall would be 39 of 39, with a lower end of 0.9103. That is above 0.90, so the recall target would count as met. This is worked out from labels made up inside the test, not from the owner's. A merged pair labelled "different" or "linked version" would be a false merge, and item 288(c) does not allow one.
4. **The exit code.** The brief asked for the report to "still exit 0". The existing design refuses while any sampled pair is unlabelled, and this was kept. If the owner prefers the report to exit 0 while the top-up is pending, that is a one-line change of design and would need a decision.
5. **Not done here.** No `plan/00` §6 entry was added for this work; that is the coordinator's. The labelling page and `--page-order` still cover the first draw only, because the top-up is labelled in chat.

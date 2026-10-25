VERDICT
Done. Item 284(c) is implemented: documents first, then code. Nothing is committed and no label was written. The owner's sample of 60 is drawn under seed "P2-T13 label sample 2026-10-25" and committed as test/fixtures/dedup/label-sample.json. The sample splits by the engine's verdict as merged 23, linked 15, flagged 5, distinct 17, out of a label set of 103 / 65 / 22 / 77 (267 pairs). `npm run dedup:report` now measures the labelled pairs of the sample by default and gives precision and recall each with a 95 % Wilson interval. A target counts as met only when the whole interval is at or above it, not met when the whole interval is below it, and otherwise the report says "UNDECIDED: the interval is too wide to decide the target". `--full` still measures every labelled label-set pair, and now also prints the interval.

Interval width at the expected accuracy:
- Precision over the 23 merged pairs in the sample, with no false merge: [0.857, 1], width 0.143.
- With one false merge: [0.790, 0.992]. This is still UNDECIDED.
- With two false merges: [0.732, 0.976]. This is NOT met.
- Recall of 0.90 over about 25 true duplicates (22 of 25): [0.700, 0.958], width 0.258.

The key consequence: this sample can refute precision ≥ 0.99 but can never confirm it. With no error at all, the lower end reaches 0.99 only from 381 merged pairs. Recall ≥ 0.90 can be confirmed only if the owner's labels find 35 or more duplicates in the 60, with none missed. Labelling all 267 would not have confirmed 0.99 either: 103 error-free merged pairs give a lower end of 0.964.

FILES CHANGED WITH DECLARATION NAMES
- D:\KIST\projects\research_helper\docs\02-literature-database-apis.md: new note at the end of §11.3, after the 2026-10-24 note.
- D:\KIST\projects\research_helper\plan\03-phase-2-multi-source-dedup.md:
  - P2-T13: a decision paragraph after "Part B targeted recording".
  - P2-T16: a decision paragraph after "Notes."
  - No State line or estimate was changed.
- D:\KIST\projects\research_helper\scripts\dedup-report.ts (modified):
  - new `outcomeIndex`, now used by `computeMetrics`; the verdict logic is unchanged
  - new `Z_95`, `Interval`, `wilsonInterval`, `TargetVerdict`, `judgeTarget`, `minCleanDenominator`
  - new `LABEL_SAMPLE_FILE`, `StratifiedPair`, `LabelSample`, `parseLabelSample`, `SampleContext`
  - `formatReport` takes an optional `sample` context
  - `main` gains `--full` and `--sample=<path>`; sample mode is the default and runs through the new `mainSampled`
  - the header comment is updated
- D:\KIST\projects\research_helper\scripts\dedup-label-sample.ts (created): `LABEL_SAMPLE_SEED`, `LABEL_SAMPLE_SIZE`, `sampleRank`, `displayRank`, `allocateProportional`, `StratifiedDraw`, `drawStratifiedSample`, `stratifyLabelSet`, `buildLabelSample`, `serializeLabelSample`, `pageOrderOf`, `checkLabelSample`, `main`. Its options:
  - `--check`: confirms the committed sample can be rebuilt exactly from its own seed and the pair list stored in the file
  - `--page-order=<path>`: writes the labelling page's list of ids
  - `--redraw`: overwrites the sample; without it, the script refuses to replace an existing sample
- D:\KIST\projects\research_helper\test\fixtures\dedup\label-sample.json (created):
  - the seed, the method sentence, and the per-verdict counts
  - all 267 label-set pairs with the verdict each had at the draw, so the draw can still be rebuilt after a threshold change
  - the 60 drawn pairs, and the display order
- D:\KIST\projects\research_helper\test\unit\sources\dedupeLabelSample.test.ts (created, 27 tests):
  - the allocation, including the 23/15/5/17 split and the at-least-one-per-verdict rule
  - the draw: same result under the seed, same result in any input order, a different seed gives a different draw, and each verdict keeps exactly its smallest hashes
  - the committed file: it rebuilds exactly, its pair list is today's label set, it holds no label, and the display order mixes the verdicts
  - the page list carries no verdict
  - one test pinned to the draw day (see findings)
  - Wilson values against Newcombe 1998 (81/263, 15/148, 0/20, 1/29), the exact ends, symmetry, and the docs/02 figures
  - `judgeTarget` and `minCleanDenominator` (381 and 35)
  - the report in sample mode: it refuses the unlabelled corpus, refuses a pair that has disappeared, refuses `--full` together with `--sample=`, and prints the interval lines when given a temporary copy with synthetic labels that never reaches the repository
- D:\KIST\projects\research_helper\test\unit\sources\dedupeCorpus.test.ts (modified): the report-refusal test under `describe("scripts/dedup-report.ts")` now passes `--full` and says so in its title.
- For the coordinator, not in the repository: C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\dedup-label-page-order.json. It lists the 60 pair ids in display order (`pairIds`, plus source, decision, seed and count) and contains no verdict or stratum. It can be rebuilt with `npx tsx scripts/dedup-label-sample.ts --page-order=<path>`.

SHARED-FILE EDITS QUOTED
None. No file on the shared list was touched.

DOC NOTES ADDED (quoted)
- docs/02 §11.3, opening line: "**Decided 2026-10-25 (owner, `plan/00` §6 item 284(c)): the accuracy is measured on a random sample of 60 label-set pairs and stated with its sampling error.**" The note covers:
  - how the 60 are drawn: by the engine's verdict in proportion to the 267, rounded by largest remainder (ties in the order merged/linked/flagged/distinct), with at least one pair per verdict; within a verdict, the smallest SHA-256 of `seed + "\n" + pairId`, ties by pair id; seed `P2-T13 label sample 2026-10-25`; never redrawn when the engine changes
  - the display order: a second hash (`seed + "\ndisplay\n" + pairId`) so that the page neither shows nor groups by verdict
  - why the Wilson interval was chosen, and that no finite-population correction is applied (which errs wider)
  - the met / not met / undecided rule, and the `t·z²/(1 − t)` arithmetic (381 and 35)
  - "*Measured the same day:*" the 103/65/22/77 split, the 23/15/5/17 draw, weights of 4.33–4.53 against 4.45 (the sample is self-weighting to within 3 %), and the intervals listed under VERDICT
- plan/03 P2-T13, opening line: "**Decided 2026-10-25 (owner, `plan/00` §6 item 284(c)): the owner labels a random sample of 60 of the 267 label-set pairs, and the report states its figures with their sampling error.**" It supersedes step 2's "≥ 200" and the first and fourth Done-when items. It lists the four files added and ends with "**Open for the owner:**": step 5's blocking test needs a criterion the sample can meet (for example "no false merge in the sample"), and the card does not choose one.
- plan/03 P2-T16, opening line: "**Decided 2026-10-25 (owner, `plan/00` §6 item 284(c)): Part B waits on 60 labels, not 267, and states its figures with sampling error.**" Step 5 and the fourth Done-when item now mean the interval verdict. Whether an "undecided" precision verdict can close the phase is the owner's call at sign-off.

NEW STRINGS (en-US text, quoted)
None that users see. All new text is console output from scripts in scripts/, which do not go through the translation bundles.

RUNS (commands and results)
- `npx tsx scripts/dedup-label-sample.ts --page-order=<scratchpad>/dedup-label-page-order.json`: "Wrote …label-sample.json: 60 of 267 label-set pairs, seed "P2-T13 label sample 2026-10-25"; per stratum merged 23 of 103, linked 15 of 65, flagged 5 of 22, distinct 17 of 77." Then "Wrote …: 60 pair ids in display order."
- `--check`: "re-derives from its seed and population." Running again without `--redraw`: refuses, exit 1.
- `npx tsx scripts/build-dedup-corpus.ts --check`: "test/fixtures/dedup/ is up to date."
- `npm run dedup:report`: exit 1, "…is unlabelled on the owner's sample: 60 of 60 sampled pairs have no label…"
- `npm run dedup:report -- --full`: exit 1, the old message ("267 of 267 label-set pairs").
- Mutation checks:
  - M1: Wilson formula without the z²/4n² term. 6 tests failed.
  - M2: met rule changed from ≥ to >. 1 test failed.
  - M3: largest-remainder order reversed. 5 tests failed.
  - M4: at-least-one rule removed. 1 test failed.
  - M5: each verdict keeps its largest hashes instead of its smallest. 3 tests failed.
  - All restored by copying the originals back; hashes match (dedup-report b16d0ea28c9165da, dedup-label-sample 1ce8a3a6bf783a08). `grep -rn MUTANT src test addon typings scripts` is empty.
- Final pass: `npm run typecheck` exit 0, `npm run lint:check` exit 0, `npx eslint .` exit 0, `npm run test` exit 0 (unit 86 files, 4013 tests; contract 2 files, 40 tests).
- Earlier passes failed only in test/unit/pipeline/clean.test.ts while the cleaning-pass agent was editing it (TS2304 `probeOcrQuality`, unused imports, an unterminated string, one failing case). With that file left out, my files were clean every time.
- After the final pass I changed one output phrase in scripts/dedup-report.ts ("no interval (…)" became "n/a (…)"). After that change: prettier --check, eslint, tsc and the two dedup test files all pass (61 tests).

CONTRADICTIONS/FINDINGS
1. docs/02 §11 holds no accuracy targets. The 0.99 / 0.90 targets are in docs/11 §1, in the Phase 2 definition of done, and in the cards. Three places still require "≥ 200" labelled pairs and were not edited:
   - docs/11 §1 (Phase 2 deliverable "≥ 200 hand-labelled record pairs")
   - plan/06 G-17 ("Label the ≥ 200-pair deduplication corpus")
   - `MIN_LABELLED_PAIRS = 200` in scripts/build-dedup-corpus.ts, whose `--check` still prints "(step 2 asks for ≥ 200)"
2. Neither target can be confirmed by this sample (arithmetic under VERDICT). Step 5's blocking test (dedupeAccuracy.test.ts, not yet written) needs a criterion the owner chooses. This is recorded as open on P2-T13.
3. Grouping pairs by verdict is a deliberate use of the engine's verdicts. build-dedup-corpus.ts still never reads them; only dedup-label-sample.ts does, and only to choose which pairs are shown. The page list and the display order carry no verdict.
4. The test "was stratified by the engine's own outcome on the draw day" pins the 2026-10-25 engine. It will fail by design when step 6 moves a threshold. Its comment says the sample must not be redrawn then; that check should be replaced with the count of pairs whose verdict moved, which the report already prints.
5. If the owner already labelled pairs outside the 60 on the current page, those labels are counted as "labelled outside the sample". They are measured only by `--full`.
6. test/unit/ui/preferencesPane.test.ts failed once in a full run: "failing Test call … no thrown text contains the key or the digest", at `expect(everything.includes(key.slice(-4))).toBe(false)`. It then passed 3 times in a row on its own and in the final full run. It looks intermittent, possibly a chance match of the random key's last four characters. The file is not mine and was already modified in the tree; reported, not investigated.

WHAT I DID NOT CHECK
- Zotero, `npm run build` and the integration suite were not run, per the rules.
- The labelling page was not republished (the coordinator owns that), and I did not read its database, so I do not know whether labels already exist there.
- The report's output on real owner labels: none exist yet.
- Whether any CI workflow invokes `dedup:report` in a way the new default (sample mode) would change; .github/workflows/ci.yml was not read.

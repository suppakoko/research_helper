# Dedup accuracy on the owner's 70 labelled pairs, 2026-11-11

The owner labelled the ten top-up pairs in chat and relabelled eleven earlier pairs "linked version" (plan/00 §6 items 369 and 370). Below is `npm run dedup:report` on the committed corpus after those labels and before the engine change of `P2-T40`, verbatim.

```text

> research-helper@0.0.2 dedup:report
> tsx scripts/dedup-report.ts

Dedup accuracy on D:\KIST\projects\research_helper\test\fixtures\dedup\pairs.jsonl
Mode: the owner's sample (owner, 2026-10-25): 60 label-set pairs drawn from D:\KIST\projects\research_helper\test\fixtures\dedup\label-sample.json, seed "P2-T13 label sample 2026-10-25", stratified by the engine's outcome at the draw in proportion (docs/02 §11.3)
  stratum     label set  sampled  labelled
  merged            103       23        23
  linked             65       15        15
  flagged            22        5         5
  distinct           77       17        17
Top-up (owner, 2026-11-11, plan/00 §6 item 366(a)): 10 more pairs, seed "P2-T13 label sample top-up 2026-11-11", drawn from the 225 label-set pairs that had no label and were not in the first draw, stratified by the engine's outcome on 2026-11-11 in proportion
  stratum    population  sampled  labelled
  merged            125        5         5
  linked             28        1         1
  flagged            12        1         1
  distinct           60        3         3
The measured sample is the union of the two draws (60 + 10 = 70 pairs). The top-up was drawn after the engine changed (P2-T38, P2-T39) and from a different population, so the union is NOT one stratified draw: its labelled pairs are pooled as they are, without weights, and the intervals below describe those pooled pairs, not one random sample of the label set.
Sampled pairs whose engine outcome has changed since their draw: 11 (the sample is not redrawn; they are measured under today's outcome)
Thresholds (src/sources/shared/dedupe.ts): LEVSIM_DUPLICATE_THRESHOLD 0.95, LEVSIM_CORROBORATED_THRESHOLD 0.88, JACCARD_CORROBORATED_THRESHOLD 0.8, JACCARD_REORDER_THRESHOLD 0.9, LEVSIM_FLAG_THRESHOLD 0.8, MAX_YEAR_DELTA 1, MIN_FUZZY_TITLE_TOKENS 5, SIGNATURE_TOKEN_COUNT 3
Labelled pairs measured: 70 (of the 70 sampled pairs, 70 have labels: first draw 60 of 60, top-up 10 of 10)

Confusion matrix (rows: human label; columns: engine outcome)
                      merged    linked   flagged  distinct     total
  duplicate               26         1         0         0        27
  not-duplicate            0         0         3        17        20
  linked-version          13         5         2         3        23

True positives 26, false positives 13, false negatives 1
Precision 0.6667   95 % Wilson interval [0.5098, 0.7937] over 39 merged pairs   target ≥ 0.99   NOT met (the whole interval is below the target)
Recall    0.9630   95 % Wilson interval [0.8172, 0.9934] over 27 true duplicates   target ≥ 0.9   UNDECIDED: the interval is too wide to decide the target — even with no error the low end reaches 0.9 only from 35 true duplicates
F1        0.7879
Linked versions recognised as links: 5 of 23 (not counted in precision; docs/02 §11.4)

False positives (13):
  p-136a40c667ec  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.85605: Gene editing and scalable functional genomic screening in Leishmania species using the CRISPR/Cas9 cytosine base editor toolbox LeishBASEedit
    B crossref:10.7554/elife.85605.sa2: Author response: Gene editing and scalable functional genomic screening in Leishmania species using the CRISPR/Cas9 cytosine base editor toolbox LeishBASEedit
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-3a7cc467c9f3  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.98867.1.sa0: Reviewer #2 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.3.sa1: Reviewer #2 (Public review): NK cell exhaustion in Wilson’s disease revealed by single-cell RNA sequencing predicts the prognosis of cholecystitis
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-1714f98efd0e  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.12688/f1000research.130932.1: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    B europepmc:PPR/PPR834057: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults performing resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    reason given: owner decision 2026-11-11 (versions of one F1000Research article are linked versions; item 370)
  p-6caef4b71a46  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.92046.2.sa2: Reviewer #2 (Public Review): Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord
    B crossref:10.7554/elife.92046.2.sa3: Reviewer #3 (Public Review): Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-f446658730ea  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.5256/f1000research.143730.r200814: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 1; peer review: 1 approved with reservations, 1 not approved]
    B crossref:10.5256/f1000research.143730.r219543: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 1; peer review: 1 approved with reservations, 1 not approved]
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-940c511c1fe1  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.1111/2041-210x.14397/v1/review1: Review for "Pressure to publish introduces large‐language model risks"
    B crossref:10.1111/2041-210x.14397/v1/review2: Review for "Pressure to publish introduces large‐language model risks"
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-1588230667d8  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.98867.1.sa1: Reviewer #1 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.2.sa1: Reviewer #2 (Public review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-95df2d7ba01d  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.98867.1.sa1: Reviewer #1 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.3.sa1: Reviewer #2 (Public review): NK cell exhaustion in Wilson’s disease revealed by single-cell RNA sequencing predicts the prognosis of cholecystitis
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-5671166c13d8  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.3410/f.740477161.793587507: Faculty Opinions recommendation of Highly accurate protein structure prediction with AlphaFold.
    B crossref:10.3410/f.740477161.793587604: Faculty Opinions recommendation of Highly accurate protein structure prediction with AlphaFold.
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-770263a3b79f  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.12688/f1000research.130932.1: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    B crossref:10.12688/f1000research.130932.2: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults performing resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    reason given: owner decision 2026-11-11 (versions of one F1000Research article are linked versions; item 370)
  p-f581335f8a55  labelled linked-version, engine merged
    direct decision: match, tier title-fuzzy, score 0.920
    A crossref:10.5256/f1000research.143730.r200814: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 1; peer review: 1 approved with reservations, 1 not approved]
    B crossref:10.5256/f1000research.163630.r264045: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults performing resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 2; peer review: 1 approved, 2 approved with reservations]
    reason given: owner decision 2026-11-11 (documents attached to one paper are linked versions; item 370)
  p-7e83a20f4a2b  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.92046.2.sa0: eLife assessment: Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord
    B crossref:10.7554/elife.92046.2.sa1: Reviewer #1 (Public Review): Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord
    reason given: owner, chat 2026-11-11
  p-df298cf5ca83  labelled linked-version, engine merged
    direct decision: match, tier doi, score 0.970
    A crossref:10.7554/elife.98867.1.sa0: Reviewer #2 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.1.sa2: eLife Assessment: NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    reason given: owner, chat 2026-11-11

False negatives (1):
  p-2eb51ec849a3  labelled duplicate, engine linked
    direct decision: link, tier title-exact, score 0.950
    A crossref:10.1109/iccv.2017.324: Focal Loss for Dense Object Detection
    B europepmc:MED/30040631: Focal Loss for Dense Object Detection
    reason given: owner, chat 2026-11-11
```

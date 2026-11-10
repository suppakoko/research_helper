# Dedup accuracy on the owner's 60-pair sample, 2026-11-10

The owner labelled the 60 pairs of `test/fixtures/dedup/label-sample.json` in chat on 2026-11-09 and 2026-11-10 (plan/00 §6 item 361). Below is `npm run dedup:report` on the committed corpus, verbatim.

```text
Dedup accuracy on D:\KIST\projects\research_helper\test\fixtures\dedup\pairs.jsonl
Mode: the owner's sample (owner, 2026-10-25): 60 label-set pairs drawn from D:\KIST\projects\research_helper\test\fixtures\dedup\label-sample.json, seed "P2-T13 label sample 2026-10-25", stratified by the engine's outcome at the draw in proportion (docs/02 §11.3)
  stratum     label set  sampled  labelled
  merged            103       23        23
  linked             65       15        15
  flagged            22        5         5
  distinct           77       17        17
Sampled pairs whose engine outcome has changed since the draw: 0
Thresholds (src/sources/shared/dedupe.ts): LEVSIM_DUPLICATE_THRESHOLD 0.95, LEVSIM_CORROBORATED_THRESHOLD 0.88, JACCARD_CORROBORATED_THRESHOLD 0.8, JACCARD_REORDER_THRESHOLD 0.9, LEVSIM_FLAG_THRESHOLD 0.8, MAX_YEAR_DELTA 1, MIN_FUZZY_TITLE_TOKENS 5, SIGNATURE_TOKEN_COUNT 3
Labelled pairs measured: 60

Confusion matrix (rows: human label; columns: engine outcome)
                      merged    linked   flagged  distinct     total
  duplicate               22        10         1         0        33
  not-duplicate            0         0         2        14        16
  linked-version           1         5         2         3        11

True positives 22, false positives 1, false negatives 11
Precision 0.9565   95 % Wilson interval [0.7901, 0.9923] over 23 merged pairs   target ≥ 0.99   UNDECIDED: the interval is too wide to decide the target — even with no error the low end reaches 0.99 only from 381 merged pairs
Recall    0.6667   95 % Wilson interval [0.4961, 0.8025] over 33 true duplicates   target ≥ 0.9   NOT met (the whole interval is below the target)
F1        0.7857
Linked versions recognised as links: 5 of 11 (not counted in precision; docs/02 §11.4)

False positives (1):
  p-1acc5e9fcbcc  labelled linked-version, engine merged
    direct decision: match, tier arxiv, score 0.990
    A arxiv:2609.04658v1: VizIt: A multi-view framework for exploring single-cell, spatial, and genetic data online
    B semanticscholar:bbb932b6b54a773300fc4333d0bd61581a97c35e: VizIt: A multi-view framework for exploring single-cell, spatial, and genetic data online
    reason given: owner, chat 2026-11-10

False negatives (11):
  p-136a40c667ec  labelled duplicate, engine linked
    direct decision: link, tier title-fuzzy, score 0.880
    A crossref:10.7554/elife.85605: Gene editing and scalable functional genomic screening in Leishmania species using the CRISPR/Cas9 cytosine base editor toolbox LeishBASEedit
    B crossref:10.7554/elife.85605.sa2: Author response: Gene editing and scalable functional genomic screening in Leishmania species using the CRISPR/Cas9 cytosine base editor toolbox LeishBASEedit
    reason given: owner, chat 2026-11-09
  p-3a7cc467c9f3  labelled duplicate, engine linked
    direct decision: link, tier title-exact, score 0.950
    A crossref:10.7554/elife.98867.1.sa0: Reviewer #2 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.3.sa1: Reviewer #2 (Public review): NK cell exhaustion in Wilson’s disease revealed by single-cell RNA sequencing predicts the prognosis of cholecystitis
    reason given: owner, chat 2026-11-09
  p-1714f98efd0e  labelled duplicate, engine linked
    direct decision: link, tier title-fuzzy, score 0.920
    A crossref:10.12688/f1000research.130932.1: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    B europepmc:PPR/PPR834057: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults performing resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    reason given: owner, chat 2026-11-09
  p-6caef4b71a46  labelled duplicate, engine linked
    direct decision: link, tier title-fuzzy, score 0.920
    A crossref:10.7554/elife.92046.2.sa2: Reviewer #2 (Public Review): Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord
    B crossref:10.7554/elife.92046.2.sa3: Reviewer #3 (Public Review): Spatial transcriptomics and single-nucleus RNA sequencing reveal a transcriptomic atlas of adult human spinal cord
    reason given: owner, chat 2026-11-09
  p-f446658730ea  labelled duplicate, engine linked
    direct decision: link, tier title-exact, score 0.950
    A crossref:10.5256/f1000research.143730.r200814: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 1; peer review: 1 approved with reservations, 1 not approved]
    B crossref:10.5256/f1000research.143730.r219543: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 1; peer review: 1 approved with reservations, 1 not approved]
    reason given: owner, chat 2026-11-10
  p-940c511c1fe1  labelled duplicate, engine linked
    direct decision: link, tier title-exact, score 0.950
    A crossref:10.1111/2041-210x.14397/v1/review1: Review for "Pressure to publish introduces large‐language model risks"
    B crossref:10.1111/2041-210x.14397/v1/review2: Review for "Pressure to publish introduces large‐language model risks"
    reason given: owner, chat 2026-11-09
  p-1588230667d8  labelled duplicate, engine linked
    direct decision: link, tier title-fuzzy, score 0.920
    A crossref:10.7554/elife.98867.1.sa1: Reviewer #1 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.2.sa1: Reviewer #2 (Public review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    reason given: owner, chat 2026-11-10
  p-95df2d7ba01d  labelled duplicate, engine linked
    direct decision: link, tier title-fuzzy, score 0.920
    A crossref:10.7554/elife.98867.1.sa1: Reviewer #1 (Public Review): NK Cell Exhaustion in Wilson’s Disease Revealed by Single-cell RNA Sequencing Predicts the Prognosis of Cholecystitis
    B crossref:10.7554/elife.98867.3.sa1: Reviewer #2 (Public review): NK cell exhaustion in Wilson’s disease revealed by single-cell RNA sequencing predicts the prognosis of cholecystitis
    reason given: owner, chat 2026-11-09
  p-5671166c13d8  labelled duplicate, engine linked
    direct decision: link, tier title-exact, score 0.950
    A crossref:10.3410/f.740477161.793587507: Faculty Opinions recommendation of Highly accurate protein structure prediction with AlphaFold.
    B crossref:10.3410/f.740477161.793587604: Faculty Opinions recommendation of Highly accurate protein structure prediction with AlphaFold.
    reason given: owner, chat 2026-11-09
  p-770263a3b79f  labelled duplicate, engine linked
    direct decision: link, tier title-fuzzy, score 0.920
    A crossref:10.12688/f1000research.130932.1: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    B crossref:10.12688/f1000research.130932.2: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults performing resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study
    reason given: owner, chat 2026-11-09
  p-f581335f8a55  labelled duplicate, engine flagged
    direct decision: flag, tier title-fuzzy, score 0.907
    A crossref:10.5256/f1000research.143730.r200814: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults preforming resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 1; peer review: 1 approved with reservations, 1 not approved]
    B crossref:10.5256/f1000research.163630.r264045: Peer Review Report For: Effects of Ashwagandha (Withania somnifera) standardized root extract on physical endurance and VO2max in healthy adults performing resistance training: An eight-week, prospective, randomized, double-blind, placebo-controlled study [version 2; peer review: 1 approved, 2 approved with reservations]
    reason given: owner review 2026-11-10 (consistency pass)
```

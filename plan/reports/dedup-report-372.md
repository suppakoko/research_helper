# Dedup accuracy on the owner's 90 labelled pairs, 2026-11-12

The owner labelled the twenty pairs of the second top-up in chat (plan/00 §6 item 372). Below is `npm run dedup:report` on the committed corpus after those labels, verbatim.

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
Top-up 1 (owner, 2026-11-11, plan/00 §6 item 366(a); docs/02 §11.3): 10 more pairs, seed "P2-T13 label sample top-up 2026-11-11", drawn from the 225 label-set pairs that had no label and were in no earlier draw, stratified by the engine's outcome on 2026-11-11 in proportion
  stratum    population  sampled  labelled
  merged            125        5         5
  linked             28        1         1
  flagged            12        1         1
  distinct           60        3         3
Top-up 2 (owner, 2026-11-11, plan/00 §6 item 370(d); docs/02 §11.3): 20 more pairs, seed "P2-T13 label sample top-up 2 2026-11-12", drawn from the 215 label-set pairs that had no label and were in no earlier draw, stratified by the engine's outcome on 2026-11-12 in proportion
  stratum    population  sampled  labelled
  merged             77        7         7
  linked             70        7         7
  flagged            11        1         1
  distinct           57        5         5
The measured sample is the union of the three draws (60 + 10 + 20 = 90 pairs). Each top-up was drawn after the engine changed and from a different population, so the union is NOT one stratified draw: its labelled pairs are pooled as they are, without weights, and the intervals below describe those pooled pairs, not one random sample of the label set.
Sampled pairs whose engine outcome has changed since their draw: 3 (the sample is not redrawn; they are measured under today's outcome)
Thresholds (src/sources/shared/dedupe.ts): LEVSIM_DUPLICATE_THRESHOLD 0.95, LEVSIM_CORROBORATED_THRESHOLD 0.88, JACCARD_CORROBORATED_THRESHOLD 0.8, JACCARD_REORDER_THRESHOLD 0.9, LEVSIM_FLAG_THRESHOLD 0.8, MAX_YEAR_DELTA 1, MIN_FUZZY_TITLE_TOKENS 5, SIGNATURE_TOKEN_COUNT 3
Labelled pairs measured: 90 (of the 90 sampled pairs, 90 have labels: first draw 60 of 60, top-up 1 10 of 10, top-up 2 20 of 20)

Confusion matrix (rows: human label; columns: engine outcome)
                      merged    linked   flagged  distinct     total
  duplicate               33         1         0         1        35
  not-duplicate            0         2         4        21        27
  linked-version           0        23         2         3        28

True positives 33, false positives 0, false negatives 2
Precision 1.0000   95 % Wilson interval [0.8957, 1.0000] over 33 merged pairs   target ≥ 0.99   UNDECIDED: the interval is too wide to decide the target — even with no error the low end reaches 0.99 only from 381 merged pairs
Recall    0.9429   95 % Wilson interval [0.8139, 0.9842] over 35 true duplicates   target ≥ 0.9   UNDECIDED: the interval is too wide to decide the target — even with no error the low end reaches 0.9 only from 35 true duplicates
F1        0.9706
Linked versions recognised as links: 23 of 28 (not counted in precision; docs/02 §11.4)

False positives (0):

False negatives (2):
  p-2eb51ec849a3  labelled duplicate, engine linked
    direct decision: link, tier title-exact, score 0.950
    A crossref:10.1109/iccv.2017.324: Focal Loss for Dense Object Detection
    B europepmc:MED/30040631: Focal Loss for Dense Object Detection
    reason given: owner, chat 2026-11-11
  p-117b79397fb2  labelled duplicate, engine distinct
    direct decision: link, tier title-exact, score 1.000
    A crossref:10.1109/iccv.2017.324: Focal Loss for Dense Object Detection
    B crossref:10.1109/tpami.2018.2858826: Focal Loss for Dense Object Detection
    reason given: owner, chat 2026-11-12 (first answered linked-version; owner aligned it with the earlier answer for the same conference and journal pair: same paper)
```

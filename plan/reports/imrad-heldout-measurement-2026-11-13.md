# The single held-out IMRaD measurement, 2026-11-13

`P3-T41` step 4. Run once by the coordinator on commit 257b244 (the detector change of item 376), with `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY npx tsx scripts/measure-imrad.ts --set heldout --final-heldout-measurement`; exit 0. The output below is verbatim.

```text
FINAL held-out measurement (--final-heldout-measurement, 2026-11-13T07:02:41.013Z): record this figure with its date and set; a second run on this set needs the owner's decision.

Detector: detectSectionsFromPdf(text, null), the PDF path with no document structure, over text/ in test/fixtures/imrad-heldout.

**Overall: 92.94 %** (589282 of 634062 counted characters, 15 papers with IMRaD structure) against the bar of 85.00 %: MEETS the bar. Mean of the papers' own figures: 90.68 % (information only).

| Publisher family | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |
|---|---:|---:|---:|---:|---:|
| elsevier | 2 | 97917 | 95973 | 98.01 % | 97.78 % |
| springer | 1 | 47918 | 36239 | 75.63 % | 75.63 % |
| wiley | 2 | 107433 | 107433 | 100.00 % | 100.00 % |
| oup | 1 | 66760 | 66760 | 100.00 % | 100.00 % |
| plos | 2 | 69484 | 69484 | 100.00 % | 100.00 % |
| nature | 2 | 74703 | 58806 | 78.72 % | 78.13 % |
| ieee | 1 | 37267 | 37267 | 100.00 % | 100.00 % |
| arxiv | 1 | 8376 | 6202 | 74.04 % | 74.04 % |
| biorxiv | 2 | 100484 | 94517 | 94.06 % | 94.36 % |
| us-government | 1 | 23720 | 16601 | 69.99 % | 69.99 % |

| Column count | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |
|---|---:|---:|---:|---:|---:|
| 2 columns | 7 | 357558 | 346061 | 96.78 % | 96.53 % |
| 1 column | 8 | 276504 | 243221 | 87.96 % | 85.56 % |

| Publication | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |
|---|---:|---:|---:|---:|---:|
| published | 12 | 525202 | 488563 | 93.02 % | 91.45 % |
| preprint | 3 | 108860 | 100719 | 92.52 % | 87.59 % |

Excluded (hasImradStructure false), scored the same way and not pooled: 81.73 % over 4 papers (120724 of 147711 characters).

| Paper | Family | Columns | Publication | IMRaD structure | Counted | Correct | Accuracy | sectionAware | Recognized |
|---|---|---|---|---|---:|---:|---:|---|---:|
| HE1 | elsevier | 2 columns | published | true | 43882 | 41938 | 95.57 % | true | 6 |
| HE2 | elsevier | 2 columns | published | true | 54035 | 54035 | 100.00 % | true | 6 |
| HS1 | springer | 1 column | published | false | 50214 | 50214 | 100.00 % | true | 6 |
| HS2 | springer | 1 column | published | true | 47918 | 36239 | 75.63 % | true | 5 |
| HW1 | wiley | 2 columns | published | true | 77604 | 77604 | 100.00 % | true | 5 |
| HW2 | wiley | 2 columns | published | true | 29829 | 29829 | 100.00 % | true | 5 |
| HO1 | oup | 2 columns | published | false | 21166 | 21166 | 100.00 % | true | 5 |
| HO3 | oup | 2 columns | published | true | 66760 | 66760 | 100.00 % | true | 5 |
| HP1 | plos | 1 column | published | true | 25874 | 25874 | 100.00 % | true | 6 |
| HP2 | plos | 1 column | published | true | 43610 | 43610 | 100.00 % | true | 5 |
| HN1 | nature | 2 columns | published | true | 48181 | 38628 | 80.17 % | true | 3 |
| HN2 | nature | 1 column | published | true | 26522 | 20178 | 76.08 % | true | 3 |
| HI2 | ieee | 2 columns | published | true | 37267 | 37267 | 100.00 % | true | 5 |
| HA1 | arxiv | 1 column | preprint | false | 62748 | 38933 | 62.05 % | true | 7 |
| HA2 | arxiv | 1 column | preprint | true | 8376 | 6202 | 74.04 % | true | 6 |
| HB1 | biorxiv | 1 column | preprint | true | 45401 | 44264 | 97.50 % | true | 5 |
| HB2 | biorxiv | 1 column | preprint | true | 55083 | 50253 | 91.23 % | true | 4 |
| HX1 | us-government | 1 column | published | true | 23720 | 16601 | 69.99 % | true | 4 |
| HX2 | us-government | 1 column | published | false | 13583 | 10411 | 76.65 % | true | 3 |

Table ceiling (information only, not a bound): §4.3's heading table at the owner's own heading positions gives 94.35 % overall (598211 of 634062). Per paper: HE1 100.00 %, HE2 100.00 %, HS2 75.63 %, HW1 100.00 %, HW2 100.00 %, HO3 100.00 %, HP1 100.00 %, HP2 100.00 %, HN1 87.95 %, HN2 76.08 %, HI2 100.00 %, HA2 81.40 %, HB1 100.00 %, HB2 91.23 %, HX1 76.26 %.
```

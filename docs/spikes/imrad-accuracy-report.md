# IMRaD detector accuracy — measurement (`P3-T22`)

> **What this file is.** Where `plan/04-phase-3-llm-summaries.md` `P3-T22` records the measured
> section-attribution accuracy of `docs/06` §4.3's detector, the date, the breakdowns, and the
> owner's decision at gate `G-22` (`plan/06-human-gates.md`).

**Measured 2026-11-10**, on the tree at commit `3067c0f` plus `P3-T22`'s uncommitted changes, by
`npx tsx scripts/measure-imrad.ts` (exit status 1: below the bar).

**Result: 68.00 % overall, below the 85 % bar.** So `IMRAD_DETECTOR_VALIDATED` is false
(`src/pipeline/summarize/imrad.ts`, computed from `IMRAD_MEASUREMENT`), `acquireSource` returns
`sectionAware: false` for every paper, `auto` runs whole-document flat chunking, and the full-text
prompt is sent without its section-label sentence.

**The owner's decision at `G-22`: not yet made.** The owner chooses between shipping whole-document
chunking (what the tree does now) and turning `summary.fullTextMode`'s default back to abstracts
(`docs/11` R-19b). The answer goes into `docs/06` §4.3 and `docs/11` R-19b, and here.

## What was measured

- **The corpus.** `P3-T20`'s 40 papers (`test/fixtures/imrad/`), with the owner's ground truth of
  2026-11-10 (`plan/00` §6 item 364): 34 papers with IMRaD structure, pooled; 6 without (N2, E6,
  I5, A4, A6, B2), scored the same way and reported separately.
- **The detector.** `detectSectionsFromPdf(text, null)`: the PDF path with **no document
  structure**. The committed fixtures are text only, so the outline path (`getStructuredDocumentText`'s
  outline and heading blocks, `docs/06` §3.3.5) is **not measured here**; what is measured is the
  detector's whole behaviour whenever no structure is read (no reader, a failed read, a truncated
  text).
- **The score.** Per character, as `docs/06` §4.3's note of 2026-11-10 defines: only the body from
  the owner's first labelled start counts; the detector's labels are read in the owner's vocabulary
  (background and related work are introduction; conclusion, limitations and abstract are other); a
  character is correct only when the two label sets are equal, so a results-and-discussion section
  needs both labels; other counts both ways; a paper where the detector declares failure scores
  zero; figures are pooled over characters.
- **The regression test.** `test/unit/pipeline/imradAccuracy.test.ts` re-measures on every unit run
  and fails if the figure drops below the recorded 1 002 637 of 1 474 524 characters, or if the
  corpus no longer matches the record.

## The printout

The tables below are the script's output, as printed.

Detector: detectSectionsFromPdf(text, null), the PDF path with no document structure, over text/ in test/fixtures/imrad.

**Overall: 68.00 %** (1002637 of 1474524 counted characters, 34 papers with IMRaD structure) against the bar of 85.00 %: BELOW the bar. Mean of the papers' own figures: 64.48 % (information only).

| Publisher family | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |
|---|---:|---:|---:|---:|---:|
| springer | 4 | 169720 | 135895 | 80.07 % | 83.81 % |
| nature | 3 | 169220 | 128922 | 76.19 % | 72.98 % |
| elsevier | 4 | 168142 | 126350 | 75.14 % | 74.31 % |
| wiley | 5 | 167629 | 106589 | 63.59 % | 66.16 % |
| plos | 4 | 182153 | 154493 | 84.81 % | 81.60 % |
| oup | 4 | 234858 | 180714 | 76.95 % | 75.94 % |
| ieee | 3 | 100043 | 0 | 0.00 % | 0.00 % |
| arxiv | 2 | 68665 | 23618 | 34.40 % | 26.00 % |
| biorxiv | 2 | 114158 | 112248 | 98.33 % | 97.50 % |
| us-government | 3 | 99936 | 33808 | 33.83 % | 44.25 % |

| Column count | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |
|---|---:|---:|---:|---:|---:|
| 2 columns | 23 | 986055 | 617895 | 62.66 % | 59.60 % |
| 1 column | 11 | 488469 | 384742 | 78.76 % | 74.67 % |

| Publication | Papers | Counted characters | Correct characters | Accuracy | Mean of papers |
|---|---:|---:|---:|---:|---:|
| published | 30 | 1291701 | 866771 | 67.10 % | 64.84 % |
| preprint | 4 | 182823 | 135866 | 74.32 % | 61.75 % |

Excluded (hasImradStructure false), scored the same way and not pooled: 48.70 % over 6 papers (91091 of 187051 characters).

| Paper | Family | Columns | Publication | IMRaD structure | Counted | Correct | Accuracy | sectionAware | Recognized |
|---|---|---|---|---|---:|---:|---:|---|---:|
| S1 | springer | 2 columns | published | true | 60284 | 37856 | 62.80 % | true | 6 |
| S2 | springer | 2 columns | published | true | 44636 | 44636 | 100.00 % | true | 6 |
| S4 | springer | 1 column | published | true | 41345 | 29948 | 72.43 % | true | 4 |
| S5 | springer | 2 columns | published | true | 23455 | 23455 | 100.00 % | true | 5 |
| N1 | nature | 2 columns | published | true | 77515 | 67626 | 87.24 % | true | 3 |
| N2 | nature | 2 columns | published | false | 23181 | 19017 | 82.04 % | true | 2 |
| N3 | nature | 2 columns | published | true | 47872 | 42340 | 88.44 % | true | 2 |
| N6 | nature | 1 column | published | true | 43833 | 18956 | 43.25 % | true | 3 |
| E1 | elsevier | 1 column | published | true | 41919 | 14123 | 33.69 % | true | 3 |
| E2 | elsevier | 1 column | published | true | 50546 | 46461 | 91.92 % | true | 6 |
| E4 | elsevier | 2 columns | published | true | 32392 | 25369 | 78.32 % | true | 4 |
| E5 | elsevier | 2 columns | published | true | 43285 | 40397 | 93.33 % | true | 5 |
| E6 | elsevier | 2 columns | published | false | 35606 | 34356 | 96.49 % | true | 3 |
| W1 | wiley | 2 columns | published | true | 28647 | 28647 | 100.00 % | true | 4 |
| W2 | wiley | 2 columns | published | true | 24796 | 24796 | 100.00 % | true | 4 |
| W3 | wiley | 2 columns | published | true | 50357 | 34930 | 69.36 % | true | 4 |
| W4 | wiley | 2 columns | published | true | 29643 | 18216 | 61.45 % | true | 4 |
| W5 | wiley | 2 columns | published | true | 34186 | 0 | 0.00 % | false | 1 |
| P1 | plos | 1 column | published | true | 53451 | 42639 | 79.77 % | true | 6 |
| P3 | plos | 1 column | published | true | 47483 | 47483 | 100.00 % | true | 5 |
| P5 | plos | 1 column | published | true | 31568 | 14720 | 46.63 % | true | 6 |
| P6 | plos | 1 column | published | true | 49651 | 49651 | 100.00 % | true | 6 |
| O2 | oup | 2 columns | published | true | 53042 | 43604 | 82.21 % | true | 6 |
| O3 | oup | 2 columns | published | true | 91599 | 63879 | 69.74 % | true | 5 |
| O4 | oup | 2 columns | published | true | 34907 | 18382 | 52.66 % | true | 4 |
| O5 | oup | 2 columns | published | true | 55310 | 54849 | 99.17 % | true | 5 |
| I1 | ieee | 2 columns | published | true | 24044 | 0 | 0.00 % | false | 0 |
| I3 | ieee | 2 columns | published | true | 41594 | 0 | 0.00 % | false | 0 |
| I4 | ieee | 2 columns | published | true | 34405 | 0 | 0.00 % | false | 0 |
| I5 | ieee | 2 columns | published | false | 23480 | 0 | 0.00 % | false | 0 |
| A1 | arxiv | 2 columns | preprint | true | 23247 | 0 | 0.00 % | false | 0 |
| A4 | arxiv | 2 columns | preprint | false | 39847 | 0 | 0.00 % | false | 0 |
| A5 | arxiv | 2 columns | preprint | true | 45418 | 23618 | 52.00 % | true | 5 |
| A6 | arxiv | 1 column | preprint | false | 28454 | 12021 | 42.25 % | true | 2 |
| B1 | biorxiv | 1 column | preprint | true | 75919 | 75919 | 100.00 % | true | 4 |
| B2 | biorxiv | 1 column | preprint | false | 36483 | 25697 | 70.44 % | true | 2 |
| B4 | biorxiv | 1 column | preprint | true | 38239 | 36329 | 95.01 % | true | 5 |
| X1 | us-government | 2 columns | published | true | 29088 | 17559 | 60.37 % | true | 3 |
| X2 | us-government | 2 columns | published | true | 56333 | 7736 | 13.73 % | true | 2 |
| XR2 | us-government | 1 column | published | true | 14515 | 8513 | 58.65 % | true | 4 |

Table ceiling (information only, not a bound): §4.3's heading table at the owner's own heading positions gives 79.92 % overall (1178404 of 1474524). Per paper: S1 80.95 %, S2 100.00 %, S4 100.00 %, S5 100.00 %, N1 89.29 %, N3 88.87 %, N6 90.48 %, E1 100.00 %, E2 56.51 %, E4 78.32 %, E5 78.25 %, W1 100.00 %, W2 100.00 %, W3 100.00 %, W4 100.00 %, W5 10.78 %, P1 57.56 %, P3 100.00 %, P5 100.00 %, P6 100.00 %, O2 100.00 %, O3 100.00 %, O4 100.00 %, O5 100.00 %, I1 4.21 %, I3 8.25 %, I4 3.26 %, A1 3.41 %, A5 25.58 %, B1 100.00 %, B4 100.00 %, X1 62.80 %, X2 85.24 %, XR2 63.10 %.

Recorded value (IMRAD_MEASUREMENT, 2026-11-10): 1002637 of 1474524 characters over 34 papers, 68.00 %. This run is not below it.

## Reading the figures

- **The table ceiling is below the bar too.** Handed the owner's own heading positions, §4.3's
  heading table gets 79.92 % of the counted characters right. So of the 32 points between the
  measured 68.00 % and 100 %, about 20 are lost even when every heading is found — headings the table
  cannot label, and the five owner starts that are not headings — and about 12 are lost between the
  ceiling and the measurement: headings the line scan misses or adds, and the two-section gate. The
  ceiling is not a bound on the outline path, which could anchor different headings.
- **Seven papers score zero because the detector declares failure.** I1, I3 and I4 (IEEE), A1
  (arXiv) and the excluded I5 and A4 number their headings with Roman numerals ("I. INTRODUCTION"),
  which the table's `(\d+\.?\s*)?` prefix does not allow, so no section is recognized; W5 numbers them
  "1 | INTRODUCTION", which is not matched either, and keeps one recognized label, below the two the
  gate needs.
- **Five owner section starts are lines that are not headings** (N1, N2, N3 and N6's unheaded
  introductions, E5's methods resuming after a boxed panel; item 364(f)). They count, as the owner
  ruled; the detector cannot find them.

The detector defects behind these figures, each with its paper and line, are listed in
`plan/reports/P3-T22.md` for the owner; none was fixed in `P3-T22`, because tuning the detector
against these labels would fit it to the test set.

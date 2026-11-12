# Held-out IMRaD fixture set (`P3-T40`, the `G-22` follow-up)

A second set of open-access papers, **kept apart from the detector work**: `P3-T41` tunes the
section detector (`src/pipeline/summarize/imrad.ts`) on the first set (`test/fixtures/imrad/`,
`P3-T20`) and then measures it **once** here, and `IMRAD_DETECTOR_VALIDATED` derives from that one
figure (`plan/04` `P3-T40`, `P3-T41`; `plan/00` §6 items 373 and 374). **What is committed is
extracted text, never a PDF.** The PDFs are in `D:\KIST\projects\research_helper-heldout\`, outside
the repository, with their sizes and SHA-256 in that folder's `_log.txt`.

The layout and the rules are the first set's (its `README.md` is the reference for the text, the
candidate lines and the label format); only the differences are written here.

| File | What it is |
|---|---|
| `manifest.json` | One entry per paper, same schema as the first set's (`imrad-manifest-v1`); `layout.webHeadings` is `not checked` for every paper |
| `text/<id>.txt`, `text/<id>_meta.json` | The text the plugin acquires from the PDF inside Zotero, and its sidecar |
| `candidate-headings.json` | Every line that passes the plain line-shape rule (`isCandidateLine`), with offset, context and page — **no labels** |
| `labels/` | The owner's ground truth, written only by `ingest --set heldout` from decisions the owner gives in chat. **Empty** (only `.gitkeep`) |

`test/unit/pipeline/imradHeldout.test.ts` checks all of it, and that the seal below holds.

## Composition: 19 papers, one pending

Item 374(a) names 20 papers. **19 are in. HI1 is not**, because the file `HI1.pdf` holds a
different paper: its first page is Nucleic Acids Research, doi 10.1093/nar/gkag934, "Size and
sequence variation of the Lid…", which is HO2's paper, not HI1's IEEE paper. So HI1 waits until its
PDF is the right one (`plan/00` §6 item 374(d)); its text was extracted once, found wrong, and
removed. This also means HO2 was downloaded after all, under the name `HI1.pdf`, so item 374(a)'s
premise that HO2 was not downloaded needs a second look.

Columns are as observed on the PDFs during extraction (the manifest's `columnCount`). Characters,
lines and candidate lines are counted in the committed text. No text is empty, and none contains a
control character other than `\n` and `\f`.

| Id | Family | Venue | Columns | Characters | Lines | Candidate lines | Notes |
|---|---|---|---|---|---|---|---|
| HE1 | Elsevier | iScience | 2 | 44,040 | 162 | 84 | |
| HE2 | Elsevier | Ultrasonics Sonochemistry | 2 | 56,758 | 244 | 86 | |
| HS1 | Springer | BMC Bioinformatics | 1 | 52,284 | 170 | 62 | "Article in Press" version, not the final typeset one; two columns were expected |
| HS2 | Springer | EPJ Data Science | 1 | 51,198 | 684 | 517 | "Article in Press" version; Brief Report |
| HW1 | Wiley | Advanced Science | 2 | 80,467 | 203 | 53 | |
| HW2 | Wiley | Brain and Behavior | 2 | 32,720 | 220 | 110 | |
| HO1 | OUP | Bioinformatics | 2 | 24,392 | 57 | 20 | Applications Note; 4 replacement characters (U+FFFD) in the text |
| HO3 | OUP | Nucleic Acids Research | 2 | 69,071 | 156 | 41 | Replaces HO2 (item 374(a)) |
| HP1 | PLOS | PLOS ONE | 1 | 29,554 | 152 | 91 | |
| HP2 | PLOS | PLOS Computational Biology | 1 | 46,900 | 260 | 128 | |
| HN1 | Nature | Nature Communications | 2 | 49,657 | 94 | 22 | |
| HN2 | Nature | Scientific Reports | 1 | 32,635 | 95 | 26 | |
| HI2 | IEEE | IEEE Open Journal of Engineering in Medicine and Biology | 2 | 40,797 | 122 | 50 | |
| HA1 | arXiv (LaTeX) | arXiv cs.DL | 1 | 65,113 | 370 | 137 | Preprint |
| HA2 | arXiv (LaTeX) | arXiv cs.LG | 1 | 9,682 | 133 | 77 | Preprint; the shortest text |
| HB1 | bioRxiv | bioRxiv genetics | 1 | 49,109 | 681 | 537 | Preprint |
| HB2 | bioRxiv | bioRxiv biophysics | 1 | 56,913 | 335 | 196 | Preprint |
| HX1 | US government | NASA Technical Note D-7813 (1974) | 1 | 26,643 | 442 | 308 | Scanned; OCR errors left as they are |
| HX2 | US government | NACA Technical Note 2000 (1950) | 1 | 14,579 | 210 | 119 | Scanned; OCR errors left as they are (for example "IWRODUCTI0N"); 436-byte non-PDF header cut on the owner's approval (item 373(b)) |

**2,664 candidate lines in all, 20 to 537 per paper.** Preprints: 4 (HA1, HA2, HB1, HB2). Scanned:
2 (HX1, HX2). Single-column 11, two-column 8. Nobody looked at any paper's headings before the set
was drawn, and nobody has looked at the detector's output on any of it.

## Licences and attribution

Every paper is CC BY 4.0 (17) or a US-government work, which has no copyright (17 U.S.C. 105: HX1
by NASA Langley Research Center staff, HX2 by Langley Aeronautical Laboratory staff of NACA). Where
the PDF states its licence, it was confirmed in the extracted text on 2026-11-12: HE1 on page 2;
HE2, HS2, HW1, HW2, HO1, HO3, HP1, HP2 and HI2 on page 1; HS1 names "the article's Creative Commons
licence" in its text; HB1 and HB2 in the bioRxiv header of Zotero's raw extraction, which the
cleaning pass removes as a running head. HW1 and HW2 name the Creative Commons Attribution License
without a version; the publisher's page gives 4.0. HN1, HN2, HA1 and HA2 carry no licence statement
in the text; their licence is the one their publisher's page links, read on 2026-11-11. Each paper's
`licenceEvidence` says which. All of these permit redistributing the extracted text; CC BY requires
attribution, given here.

**Changes made (CC BY §3(a)(1)(B)).** Each `text/<id>.txt` is not the version of record: it is
machine-extracted text of the PDF, with running heads, line-number gutters, the reference list and
supplementary back matter removed by the plugin's cleaning pass (`docs/06` §4.1), figures, tables
and layout lost, and extraction errors (most visibly OCR errors in HX1 and HX2) left as they are.
The authors are as printed at the head of each text and on the linked page. No endorsement by the
authors or publishers is implied.

- **HE1** — "A randomized crossover study of cardiologist reporting of severe aortic stenosis with/without assistance from artificial intelligence (AI)", iScience 29(10), 115562 (2026), https://doi.org/10.1016/j.isci.2026.115562. CC BY 4.0.
- **HE2** — "Ultrasound-assisted extraction of novel ancient tea polysaccharide NATP-60a: Process optimization, structural characterization, and mechanism of alleviating DSS-induced colitis in mice", Ultrasonics Sonochemistry 133, 108005 (2026), https://doi.org/10.1016/j.ultsonch.2026.108005. CC BY 4.0.
- **HS1** — "IXSH-FD: integrated XGBoost-SHAP hybrid framework for SNP feature discovery", BMC Bioinformatics (2026), https://doi.org/10.1186/s12859-026-06664-0. CC BY 4.0.
- **HS2** — "AIS-derived port-calling opportunity modelling in conflict-affected waters", EPJ Data Science (Brief Report) (2026), https://doi.org/10.1140/epjds/s13688-026-00699-2. CC BY 4.0.
- **HW1** — "A Facial Foundation Model for Clinical Biomarker Prediction and Real-World Mobile Deployment", Advanced Science, e77861 (2026), https://doi.org/10.1002/advs.77861. CC BY 4.0.
- **HW2** — "NIHSS and Large Artery Atherosclerosis Affect Efficacy of Dual Antiplatelet Therapy Versus Alteplase for Minor Stroke", Brain and Behavior 16(10), e71813 (2026), https://doi.org/10.1002/brb3.71813. CC BY 4.0.
- **HO1** — "GROMTools: scalable individual-level GReX imputation for mega-biobank-scale cohorts", Bioinformatics 42(10), btag719 (2026), https://doi.org/10.1093/bioinformatics/btag719. CC BY 4.0.
- **HO3** — "Structural basis of PARP2 recognition of nucleosomal DNA breaks and inhibitor trapping", Nucleic Acids Research 54(18), gkag939 (2026), https://doi.org/10.1093/nar/gkag939. CC BY 4.0.
- **HP1** — "Rehospitalization due to COVID-19 reinfection in Rio de Janeiro, 2020–2022: Associations with vaccination status, sociodemographic and clinical factors", PLOS ONE (2026), https://doi.org/10.1371/journal.pone.0332281. CC BY 4.0.
- **HP2** — "Demographic changes and behavioural responses shape vulnerability to infectious disease outbreaks", PLOS Computational Biology (2026), https://doi.org/10.1371/journal.pcbi.1014319. CC BY 4.0.
- **HN1** — "Nationwide sustainability assessment of PFAS treatment in U.S. water utilities", Nature Communications 17, 11276 (2026), https://doi.org/10.1038/s41467-026-77509-w. CC BY 4.0.
- **HN2** — "Large-scale marine eDNA database reveals seasonal latitudinal diversity gradients in Japan driven by vagrant fish", Scientific Reports 16, 30406 (2026), https://doi.org/10.1038/s41598-026-52959-w. CC BY 4.0.
- **HI2** — "An Improved Beta Burst Extraction for Chip-Based Deep Brain Stimulation With Real-Time Model Updating", IEEE Open Journal of Engineering in Medicine and Biology 7, 214–222 (2026), https://doi.org/10.1109/OJEMB.2026.3695567. CC BY 4.0.
- **HA1** — "PEDAL: Open Infrastructure for Citable AI Prompts in STEM Education and Research", arXiv (cs.DL) (2026), https://arxiv.org/abs/2610.00001. CC BY 4.0.
- **HA2** — "Reverse Item Response Theory for Sparsity-Robust Ranking in Fragmented Cancer Drug-Response Matrices", arXiv (cs.LG) (2026), https://arxiv.org/abs/2610.00002. CC BY 4.0.
- **HB1** — "SysNDD: A Systematic Database for Neurodevelopmental Disorders", bioRxiv (genetics), v1 posted 2026-10-01, https://doi.org/10.64898/2026.09.29.755401. CC BY 4.0.
- **HB2** — "3D confinement reshapes RNA folding and enhances circularisation in the Zika virus", bioRxiv (biophysics), v2 posted 2026-10-01, https://doi.org/10.64898/2026.01.10.698690. CC BY 4.0.
- **HX1** — "Calculation of the twist distribution of wings designed for cruise at transonic speeds", NASA Technical Note D-7813 (L-9832), December 1974, https://ntrs.nasa.gov/citations/19750004865. US government work (17 U.S.C. 105).
- **HX2** — "Data on shape and location of detached shock waves on cones and spheres", NACA Technical Note 2000, 1950, https://ntrs.nasa.gov/citations/19930082664. US government work (17 U.S.C. 105).

## How the text is made

Exactly as for the first set (its `README.md`, "How the text is made, and why it needs Zotero"):
inside Zotero, by `acquireZoteroSource` with Tier 3 off, then `cleanFullText`; the detector that
runs inside the acquisition has its output discarded. On 2026-11-12 the extraction ran over all 20
PDFs (20 passed, items left behind 0), and again with `--check`: **20 of 20 texts byte-identical**.
HI1's text was then removed (above).

```sh
npx tsx scripts/build-imrad-fixtures.ts extract --set heldout --pdf-dir D:\KIST\projects\research_helper-heldout
npx tsx scripts/build-imrad-fixtures.ts extract --set heldout --pdf-dir D:\KIST\projects\research_helper-heldout --check
npx tsx scripts/build-imrad-fixtures.ts candidates --set heldout
npx tsx scripts/build-imrad-fixtures.ts validate --set heldout
```

When HI1's right PDF is in: put its entry back in `manifest.json` (as item 374(a) lists it), update
its line in `_log.txt`, run `extract --set heldout --only HI1`, and add `HI1` back to `HELDOUT_IDS`
in the unit test.

## Labels

Given by the owner in chat, four papers at a time, with the owner's rules, and written by
`ingest --set heldout`; **never pre-filled by the detector or a model**, and the candidate lines
come from nothing but `isCandidateLine`. The format is the first set's (`imrad-labels-v1`).

## The seal

`scripts/measure-imrad.ts --set heldout` **refuses** (exit 3) before reading any file of this set
and before any detector runs. It measures this set only with `--final-heldout-measurement` as well,
and **that flag may be used only by `P3-T41`, once, after its detector change is committed**; a
second run on this set needs the owner's decision. Under the flag the figure is printed against the
85 % bar and is not checked against `IMRAD_MEASUREMENT`, which records the first set. The unit test
checks the refusal with a detector double and an empty set, so no detector has run on this text.

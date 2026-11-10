# IMRaD fixture set (`P3-T20`, gate `G-12`)

The corpus `docs/06` §4.3 asks for: 40 open-access papers across the publisher families that matter,
against which the section detector (`src/pipeline/summarize/imrad.ts`, `P3-T21`) is measured by
`P3-T22` (risk `R-19b`, the ≥ 85 % bar). **What is committed is extracted text, never a PDF.** The
ground-truth labels are the owner's, set on a private labelling page (`plan/00` §6 item 280(b));
until the owner has labelled a paper it has no file under `labels/` and its `hasImradStructure` in
`manifest.json` is `null`. **As of 2026-11-10 all 40 papers are labelled** (owner, in chat; `plan/00` §6 item 364, `plan/reports/imrad-labels-2026-11-10.md`): 34 have IMRaD structure and 6 do not.

| File | What it is |
|---|---|
| `candidates.md` | Steps 1–2 as the owner decided them: the approved list, the two swaps (O1 → O3, X3 → XR2), the downloads, the licence re-check |
| `manifest.json` | One entry per paper: publisher family, venue, DOI or other id, source URL, licence and where it was confirmed, preprint and scanned flags, layout notes, column count, `hasImradStructure` |
| `text/<id>.txt` | The text the plugin itself acquires from the PDF (below) |
| `text/<id>_meta.json` | Its sidecar: publisher, layout, DOI, licence, source URL, PDF size and SHA-256, text size and SHA-256, extraction date, tool versions, the cleaning pass's diagnostics, the column evidence |
| `candidate-headings.json` | The labelling page's data: every line that passes a plain line-shape rule, with its offset, text, context and page — **no labels** |
| `labels/<id>.json` | The owner's ground truth, one file per paper, written only by `ingest` from the owner's decisions (empty today) |

Everything is (re)built by `scripts/build-imrad-fixtures.ts`; `test/unit/pipeline/imradFixtureManifest.test.ts`
checks it.

## Composition

Approved by the owner on 2026-10-23 (`candidates.md`). Every family `docs/06` §4.3 names has at
least four papers — Elsevier 5, Springer 4, Wiley 5, OUP 4, PLOS 4, Nature 4, IEEE 4, arXiv-LaTeX 4 —
plus 3 bioRxiv preprints and 3 scanned US-government works. So the card's "accept the shortfall"
option was not needed. The card's other composition rules:

- **Preprints ≥ 6:** 7 (A1, A4, A5, A6, B1, B2, B4).
- **Single- and two-column layouts:** 13 single-column and 27 two-column, as observed (below).
- **A "Results and Discussion" heading:** 12 papers list one on their web page (S1, S5, N3, E1, E4,
  E6, W1, W2, W5, P3, O4, I1).
- **Unnumbered headings:** 16 papers (S1, S2, N1, N2, N3, N6, E2, E5, E6, W1, P1, P3, P6, O2, O3, O5);
  14 use Arabic numbering, 6 Roman (all IEEE and two arXiv), and 4 were not checked in advance
  (B1, B2, B4, XR2).
- **Scanned:** X1, X2 (J. Res. NBS, 1980 and 1983, text layer from OCR) and XR2 (NASA TN D-7812,
  December 1974; the candidate list said 1972, the report page says December 1974).

`layout.webHeadings`, `layout.headingNumbering` and `layout.notes` record what the coordinator saw on
each paper's web page when drawing up the list (2026-10-20). **They are composition notes, not
ground truth**, and were not checked against the text; the labels are the owner's alone.

**Column count.** The extracted text cannot show columns: Zotero 10.0.3's extractor writes one line
per text block (a paragraph is one line), so line length says nothing about the page. `columnCount`
is therefore observed on the same PDF's structured document text, read through the plugin's own
reader (`getStructuredDocumentText` in `src/zotero/fulltext.ts`): a page is two-column when at least
half of its body-paragraph area lies in boxes no wider than 55 % of the page, and a paper is
two-column when at least half of its pages with body text are (`columnGeometry` in
`scripts/imrad-fixtures/extract.spec.ts`, `columnCountFromGeometry` in the build script). The
per-paper page counts are in each sidecar's `extraction.columnGeometry`. Against the candidate
list's expectation, 38 agree; N6 was "not checked" and is single-column; **E2 (iScience) was
expected two-column and measures single-column** (3 of 16 pages two-column) — Europe PMC's PDF
render of a Cell Press article, not the journal's own typesetting.

| Id | Family | Venue | DOI or id | Licence | Pre-print | Columns (observed / expected) | Heading numbering | Candidate lines / lines |
|---|---|---|---|---|---|---|---|---|
| S1 | springer | BMC Bioinformatics 2011 | 10.1186/1471-2105-12-323 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | no | 2 / 2 | none | 143 / 293 |
| S2 | springer | Journal of Cheminformatics 2019 | 10.1186/s13321-019-0393-0 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 83 / 225 |
| S4 | springer | EPJ Data Science 2024 | 10.1140/epjds/s13688-024-00474-1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 1 | arabic | 435 / 549 |
| S5 | springer | Nano Convergence 2024 | 10.1186/s40580-024-00435-4 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 17 / 71 |
| N1 | nature | Nature Communications 2024 | 10.1038/s41467-023-43860-5 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 138 / 238 |
| N2 | nature | Nature Communications 2023 | 10.1038/s41467-023-37375-2 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 58 / 107 |
| N3 | nature | Nature Communications 2024 | 10.1038/s41467-024-50436-4 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 159 / 358 |
| N6 | nature | Scientific Reports 2022 | 10.1038/s41598-022-22473-w | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / ? | none | 110 / 242 |
| E1 | elsevier | Heliyon 2023 | 10.1016/j.heliyon.2023.e23097 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 1 | arabic | 51 / 165 |
| E2 | elsevier | iScience 2024 (Cell Press) | 10.1016/j.isci.2024.110552 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 2 | none | 116 / 206 |
| E4 | elsevier | Ultrasonics Sonochemistry 2023 | 10.1016/j.ultsonch.2023.106712 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 113 / 252 |
| E5 | elsevier | eBioMedicine 2023 | 10.1016/j.ebiom.2023.104868 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 49 / 147 |
| E6 | elsevier | Journal of Biological Chemistry 2023 | 10.1016/j.jbc.2023.105438 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 34 / 114 |
| W1 | wiley | ChemistryOpen 2023 | 10.1002/open.202300112 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 55 / 135 |
| W2 | wiley | Advanced Science 2023 | 10.1002/advs.202301332 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 15 / 82 |
| W3 | wiley | Advanced Science 2023 | 10.1002/advs.202302561 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 15 / 86 |
| W4 | wiley | Brain and Behavior 2024 | 10.1002/brb3.3269 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 393 / 495 |
| W5 | wiley | MicrobiologyOpen 2022 | 10.1002/mbo3.1301 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 489 / 580 |
| P1 | plos | PLOS ONE 2026 | 10.1371/journal.pone.0354459 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 1 | none | 157 / 312 |
| P3 | plos | PLOS ONE 2026 | 10.1371/journal.pone.0358989 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 1 | none | 168 / 322 |
| P5 | plos | PLOS Medicine 2026 | 10.1371/journal.pmed.1005277 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 1 | arabic | 92 / 195 |
| P6 | plos | PLOS Genetics 2026 | 10.1371/journal.pgen.1012322 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 1 / 1 | none | 68 / 169 |
| O2 | oup | Nucleic Acids Research 2024 | 10.1093/nar/gkae1222 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 143 / 254 |
| O3 | oup | GigaScience 2025 | 10.1093/gigascience/giaf148 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 320 / 651 |
| O4 | oup | Bioinformatics 2024 | 10.1093/bioinformatics/btae735 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | arabic | 29 / 90 |
| O5 | oup | PNAS Nexus 2024 | 10.1093/pnasnexus/pgae556 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | none | 46 / 131 |
| I1 | ieee | IEEE Open Journal of Engineering in Medicine and Biology 2023 | 10.1109/OJEMB.2023.3305190 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | roman | 80 / 151 |
| I3 | ieee | IEEE Journal of Translational Engineering in Health and Medicine 2022 | 10.1109/JTEHM.2022.3221918 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | roman | 60 / 186 |
| I4 | ieee | IEEE Journal of Translational Engineering in Health and Medicine 2023 | 10.1109/JTEHM.2023.3291925 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | roman | 48 / 152 |
| I5 | ieee | IEEE Journal of Translational Engineering in Health and Medicine 2023 | 10.1109/JTEHM.2023.3290036 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | no | 2 / 2 | roman | 34 / 99 |
| A1 | arxiv | arXiv (IEEE conference template, estimated) | arXiv:2405.00189v1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | yes | 2 / 2 | roman | 392 / 461 |
| A4 | arxiv | arXiv (AIP/REVTeX template, estimated) | arXiv:2405.00193v1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | yes | 2 / 2 | roman | 726 / 938 |
| A5 | arxiv | arXiv (ACM template, estimated) | arXiv:2405.00172v2 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | yes | 2 / 2 | arabic | 760 / 911 |
| A6 | arxiv | arXiv (Springer LNCS template, estimated) | arXiv:2405.00123v1 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | yes | 1 / 1 | arabic | 111 / 208 |
| B1 | biorxiv | bioRxiv 2024 v1 | 10.1101/2024.03.02.583133 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | yes | 1 / 1 | unknown | 67 / 261 |
| B2 | biorxiv | bioRxiv v3 (2025-08-07) | 10.1101/2024.03.01.582837 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | yes | 1 / 1 | unknown | 36 / 102 |
| B4 | biorxiv | bioRxiv v1 | 10.1101/2024.02.29.582831 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | yes | 1 / 1 | unknown | 58 / 189 |
| X1 | us-government | J Res Natl Bur Stand 1980 | 10.6028/jres.085.024 | [US government work (17 U.S.C. 105)](https://www.copyright.gov/title17/92chap1.html#105) | no | 2 / 2 | arabic | 90 / 217 |
| X2 | us-government | J Res Natl Bur Stand 1983 | 10.6028/jres.088.016 | [US government work (17 U.S.C. 105)](https://www.copyright.gov/title17/92chap1.html#105) | no | 2 / 2 | arabic | 211 / 480 |
| XR2 | us-government | NASA Technical Note D-7812, December 1974 | NTRS 19750004163 | [US government work (17 U.S.C. 105)](https://www.copyright.gov/title17/92chap1.html#105) | no | 1 / 1 | unknown | 202 / 282 |

## Licences and attribution

Every paper is CC BY 4.0 (34), CC BY 2.0 (S1), CC0 1.0 (B4) or a US-government work, which has no
copyright (17 U.S.C. 105: X1 and X2 by National Bureau of Standards staff, XR2 a NASA Technical
Note). Each licence was re-checked on the PDF on 2026-10-23 (where: `candidates.md` and each paper's
`licenceEvidence`). All of these permit redistributing the extracted text; CC BY requires
attribution, given here.

**Changes made (CC BY §3(a)(1)(B)).** Each `text/<id>.txt` is not the version of record: it is
machine-extracted text of the publisher's PDF, with running heads, line-number gutters, the
reference list and supplementary back matter removed by the plugin's cleaning pass (`docs/06` §4.1),
figures, tables and layout lost, and extraction errors (most visibly OCR errors in X1, X2 and XR2)
left as they are. The authors are as printed at the head of each text and on the linked page. No
endorsement by the authors or publishers is implied.

- **S1** — "RSEM: accurate transcript quantification from RNA-Seq data with or without a reference genome", BMC Bioinformatics 2011, https://doi.org/10.1186/1471-2105-12-323. CC BY 2.0.
- **S2** — "Randomized SMILES strings improve the quality of molecular generative models", Journal of Cheminformatics 2019, https://doi.org/10.1186/s13321-019-0393-0. CC BY 4.0.
- **S4** — "Social media sensors as early signals of influenza outbreaks at scale", EPJ Data Science 2024, https://doi.org/10.1140/epjds/s13688-024-00474-1. CC BY 4.0.
- **S5** — "Monodispersed mesoscopic star-shaped gold particles via silver-ion-assisted multi-directional growth for highly sensitive SERS-active substrates", Nano Convergence 2024, https://doi.org/10.1186/s40580-024-00435-4. CC BY 4.0.
- **N1** — "Knowledge-guided machine learning can improve carbon cycle quantification in agroecosystems", Nature Communications 2024, https://doi.org/10.1038/s41467-023-43860-5. CC BY 4.0.
- **N2** — "Native qudit entanglement in a trapped ion quantum processor", Nature Communications 2023, https://doi.org/10.1038/s41467-023-37375-2. CC BY 4.0.
- **N3** — "Turning copper into an efficient and stable CO evolution catalyst beyond noble metals", Nature Communications 2024, https://doi.org/10.1038/s41467-024-50436-4. CC BY 4.0.
- **N6** — "Effects of Rhizophagus intraradices on soybean yield and the composition of microbial communities in the rhizosphere soil of continuous cropping soybean", Scientific Reports 2022, https://doi.org/10.1038/s41598-022-22473-w. CC BY 4.0.
- **E1** — "Synthesis and characterization of polyurethane flexible foams provided from PET derivatives, fly ash, and glass wastes", Heliyon 2023, https://doi.org/10.1016/j.heliyon.2023.e23097. CC BY 4.0.
- **E2** — "Oleic acid released by sensory neurons inhibits TRPV1-mediated thermal hypersensitivity via GPR40", iScience 2024 (Cell Press), https://doi.org/10.1016/j.isci.2024.110552. CC BY 4.0.
- **E4** — "Radial and translational motions of a gas bubble in a Gaussian standing wave field", Ultrasonics Sonochemistry 2023, https://doi.org/10.1016/j.ultsonch.2023.106712. CC BY 4.0.
- **E5** — "Mycoplasma pneumoniae carriage in children with recurrent respiratory tract infections is associated with a less diverse and altered microbiota", eBioMedicine 2023, https://doi.org/10.1016/j.ebiom.2023.104868. CC BY 4.0.
- **E6** — "Deciphering specificity and cross-reactivity in tachykinin NK1 and NK2 receptors", Journal of Biological Chemistry 2023, https://doi.org/10.1016/j.jbc.2023.105438. CC BY 4.0.
- **W1** — "Methane Decomposition to Hydrogen Over Zirconia-Supported Fe Catalysts–Effects of the Modified Support", ChemistryOpen 2023, https://doi.org/10.1002/open.202300112. CC BY 4.0.
- **W2** — "Pressure-Induced Superconductivity and Topological Quantum Phase Transitions in the Topological Semimetal ZrTe2", Advanced Science 2023, https://doi.org/10.1002/advs.202301332. CC BY 4.0.
- **W3** — "Mammary Microvessels are Sensitive to Menstrual Cycle Sex Hormones", Advanced Science 2023, https://doi.org/10.1002/advs.202302561. CC BY 4.0.
- **W4** — "Effects of home-cage elevation on behavioral tests in mice", Brain and Behavior 2024, https://doi.org/10.1002/brb3.3269. CC BY 4.0.
- **W5** — "De novo biosynthesis of α-aminoadipate via multi-strategy metabolic engineering in Escherichia coli", MicrobiologyOpen 2022, https://doi.org/10.1002/mbo3.1301. CC BY 4.0.
- **P1** — "English-Persian cross-language plagiarism detection: Multilingual deep learning approach", PLOS ONE 2026, https://doi.org/10.1371/journal.pone.0354459. CC BY 4.0.
- **P3** — "Synthesis and characterization of sustainable Zinc Oxide nanoparticles for waxy crude flow assurance application", PLOS ONE 2026, https://doi.org/10.1371/journal.pone.0358989. CC BY 4.0.
- **P5** — "Comparative effectiveness of amlodipine versus nifedipine prescribed at discharge in patients with ischemic stroke or transient ischemic attack: A nationwide 5-year follow-up registry study", PLOS Medicine 2026, https://doi.org/10.1371/journal.pmed.1005277. CC BY 4.0.
- **P6** — "Genome-Wide DNA methylation profiling of tissue-plasma pairs identifies Novel cfDNA biomarkers for the diagnosis of gastric cancer", PLOS Genetics 2026, https://doi.org/10.1371/journal.pgen.1012322. CC BY 4.0.
- **O2** — "Experimental and computational investigations of RNA duplexes containing N7-regioisomers of adenosine and LNA-adenosine", Nucleic Acids Research 2024, https://doi.org/10.1093/nar/gkae1222. CC BY 4.0.
- **O3** — "An integrative multiomics random forest framework for robust biomarker discovery", GigaScience 2025, https://doi.org/10.1093/gigascience/giaf148. CC BY 4.0.
- **O4** — "SCARAP: scalable cross-species comparative genomics of prokaryotes", Bioinformatics 2024, https://doi.org/10.1093/bioinformatics/btae735. CC BY 4.0.
- **O5** — "Antibody-mediated clearance of an ER-resident aggregate that causes glaucoma", PNAS Nexus 2024, https://doi.org/10.1093/pnasnexus/pgae556. CC BY 4.0.
- **I1** — "UKSSL: Underlying Knowledge Based Semi-Supervised Learning for Medical Image Classification", IEEE Open Journal of Engineering in Medicine and Biology 2023, https://doi.org/10.1109/OJEMB.2023.3305190. CC BY 4.0.
- **I3** — "Tumor-Attentive Segmentation-Guided GAN for Synthesizing Breast Contrast-Enhanced MRI Without Contrast Agents", IEEE Journal of Translational Engineering in Health and Medicine 2022, https://doi.org/10.1109/JTEHM.2022.3221918. CC BY 4.0.
- **I4** — "Design and Evaluation of a Balanced Compliant Laparoscopic Grasper", IEEE Journal of Translational Engineering in Health and Medicine 2023, https://doi.org/10.1109/JTEHM.2023.3291925. CC BY 4.0.
- **I5** — "An Epileptic Seizure Prediction Method Based on CBAM-3D CNN-LSTM Model", IEEE Journal of Translational Engineering in Health and Medicine 2023, https://doi.org/10.1109/JTEHM.2023.3290036. CC BY 4.0.
- **A1** — "Comparing Motion Distortion Between Vehicle Field Deployments", arXiv (IEEE conference template, estimated), https://arxiv.org/abs/2405.00189. CC BY 4.0.
- **A4** — "Thawed Gaussian wavepacket dynamics with Δ-machine learned potentials", arXiv (AIP/REVTeX template, estimated), https://arxiv.org/abs/2405.00193. CC BY 4.0.
- **A5** — "Bypassing Skip-Gram Negative Sampling: Dimension Regularization as a More Efficient Alternative for Graph Embeddings", arXiv (ACM template, estimated), https://arxiv.org/abs/2405.00172. CC BY 4.0.
- **A6** — "Graph Neural Network Approach to Semantic Type Detection in Tables", arXiv (Springer LNCS template, estimated), https://arxiv.org/abs/2405.00123. CC BY 4.0.
- **B1** — "Self-organization of modular activity in immature cortical networks", bioRxiv 2024 v1, https://doi.org/10.1101/2024.03.02.583133. CC BY 4.0.
- **B2** — "Non-linear transcriptional responses to gradual modulation of transcription factor dosage", bioRxiv v3 (2025-08-07), https://doi.org/10.1101/2024.03.01.582837. CC BY 4.0.
- **B4** — "Sexually dimorphic renal expression of Klotho is directed by a kidney-specific distal enhancer responsive to HNF1b", bioRxiv v1, https://doi.org/10.1101/2024.02.29.582831. CC0 1.0.
- **X1** — "Observations on the Mechanisms of High Resistance Junction Formation in Aluminum Wire Connections", J Res Natl Bur Stand 1980, https://doi.org/10.6028/jres.085.024. US government work (17 U.S.C. 105).
- **X2** — "Size and Refractive Index Determination of Single Polystyrene Spheres", J Res Natl Bur Stand 1983, https://doi.org/10.6028/jres.088.016. US government work (17 U.S.C. 105).
- **XR2** — "Sweep effect on the drag of rows of perpendicular circular cylinders in a laminar boundary layer at supersonic free-stream velocities", NASA Technical Note D-7812, December 1974, https://ntrs.nasa.gov/citations/19750004163. US government work (17 U.S.C. 105).

## How the text is made, and why it needs Zotero

`text/<id>.txt` is, byte for byte, the `text` of `acquireZoteroSource` (`src/pipeline/summarize/acquire.ts`)
for a parent item that has the PDF as its only attachment and no abstract, DOI or `extra`, with
Tier 3 switched off (`tryEuropePmc: false`): Zotero's own text extraction (`attachmentText`, which is
`Zotero.PDFWorker.getFullText` — pdf.js in Zotero's worker — or the index cache that holds the same
output), then `P3-T19`'s cleaning pass (`cleanFullText`, `src/pipeline/summarize/clean.ts`). With no
abstract there is no preamble, so offset 0 is the first character of the cleaned attachment text. It
is written as UTF-8 without a byte-order mark; `\n` and the `\f` page separators are kept exactly. No
text file contains `\r` or NUL, so `.gitattributes`' `test/fixtures/** text eol=lf` cannot change a
byte.

**It cannot run outside Zotero** (verified, not assumed): `Zotero.PDFWorker` and the
attachment-text getter exist only inside a running Zotero, and any Node PDF library would produce a
different text with different offsets — and offsets into this exact text are what the labels are.
So `extract` runs in the integration harness: `scripts/build-imrad-fixtures.ts` starts the
zotero-plugin-scaffold test runner (the same one `npm run test:integration` uses, same profile
`.scaffold/test/profile`) with its entries narrowed to `scripts/imrad-fixtures/`, whose
`extract.spec.ts` imports each PDF as a temporary attachment, waits for Zotero's background indexer
to settle, acquires the text, writes it to a scratch directory and erases every item it created in
`after` (the run logs "items left behind: 0"). The Node half then copies the text in, writes the
sidecars and the manifest's column counts, and rebuilds `candidate-headings.json`. That spec is not
in `test/integration/`, so the integration suite never runs it.

The acquisition runs `docs/06` §4.3's detector internally (it is part of `acquireSource`); **its
output is discarded** — the spec keeps only the text and the cleaning and OCR-probe diagnostics, and
no section, label or outline count reaches any file here.

**Reproduction.** Before Zotero sees a PDF, the script checks it against the PDF folder's `_log.txt`
(size and SHA-256 prefix) and its `%PDF-` header, and refuses on any mismatch; each sidecar records
the PDF's full SHA-256. On 2026-10-24 the full build ran twice (the second time with `--check`,
which extracts into a scratch directory and compares byte for byte without writing): **40 of 40 text
files were byte-identical**, and S1 and X1 also matched a third, earlier trial run. A sidecar keeps
its `extractedAt` and `tool` while its text's SHA-256 is unchanged, so a rebuild that reproduces the
text leaves the sidecar unchanged too.

```sh
npx tsx scripts/build-imrad-fixtures.ts extract --pdf-dir D:\KIST\projects\research_helper-g12
npx tsx scripts/build-imrad-fixtures.ts extract --pdf-dir D:\KIST\projects\research_helper-g12 --check
```

`extract` needs `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` (as `npm run test:integration` does), must not run
while the integration suite runs (they share the profile), and refuses a PDF folder inside the
repository. The PDFs are only read, by Zotero's importer.

## The candidate lines (the labelling page's data)

`candidate-headings.json` lists, per paper, every line of the text that passes this rule — plain,
written down in full, and **not the detector under test** (`src/pipeline/summarize/imrad.ts` and
its heading table are never imported; the unit test checks that) and no model:

1. Split the text into lines at every `\n` and every `\f`; trim each line.
2. Keep a line when it is **1 to 120 characters** long, contains **at least one letter**, and **does
   not end with a full stop**.
3. Numbering (`2`, `2.1`, `II.`, `A`) is allowed and never required. No word list, no section
   names, no fonts, no positions.

Each candidate carries `offset` (the UTF-16 index of the line's first non-space character, so
`text.startsWith(line, offset)` holds), `line` (the trimmed line), `next` (the first 60 characters of
the next non-empty line) and `page` (1-based, counted by `\f`). Each paper also carries its text's
SHA-256, so decisions made on an older text are refused at ingestion.

The rule errs towards too many lines, and the count varies with how each extractor laid the text
out: **6,371 candidate lines in all, 15 to 760 per paper (median 91)**, out of 71 to 938 lines per
paper (rebuilt 2026-10-25 with the corrected cleaning pass, `plan/00` §6 item 283(a): 19 texts
changed and the count fell from 6,552, because stacked page furniture and seven reference lists that
used to survive are now removed — `docs/06` §4.1 steps 2, 6 and 7). The long lists are papers whose
text comes out a line per printed line or with many short table, equation or figure lines: A5 760 of
911 lines, A4 726 of 938, W5 489 of 580, S4 435 of 549,
W4 393 of 495, A1 392 of 461, O3 320 of 651. Per-paper counts are in the composition table above.
Body paragraphs mostly come out as single long lines, so most of a list is figure labels, table
cells, author and affiliation lines, captions and the occasional short paragraph that has no full
stop; the headings are among them because each heading is its own line. A heading a paper runs into
its paragraph (one line, longer than 120 characters) is not a candidate; the owner adds it by its
line text (below).

## The label format

`labels/<id>.json`, one per paper, validated by `validateLabels` in the build script:

```json
{
  "schema": "imrad-labels-v1",
  "id": "S1",
  "textFile": "text/S1.txt",
  "textSha256": "<SHA-256 of text/S1.txt>",
  "textChars": 63784,
  "hasImradStructure": true,
  "sections": [
    { "start": 4021, "heading": "Background", "labels": ["introduction"], "origin": "candidate" },
    { "start": 23456, "heading": "Results and Discussion", "labels": ["results", "discussion"], "origin": "candidate" }
  ],
  "adjudication": { "by": "owner", "source": "<export file name>", "decidedAt": "<the page's timestamp or null>" }
}
```

(The offsets in this example are illustrative, not real.)

- `start` — UTF-16 offset into the text file (the unit `AcquiredSection.start` uses). Offsets are
  integers inside the text, **strictly increasing**, each at the start of a line (white space before
  it allowed), and `text.startsWith(heading, start)` holds.
- `labels` — members of `ImradSection` (`src/model/summary.ts`), unique, in `docs/06` §4.3's table
  order; `other` stands alone. A section runs from its `start` to the next section's `start` (the
  last one to the end of the text); text before the first section belongs to none. An `other`
  heading (Acknowledgements, a Conclusions section the owner calls other, back matter) ends the
  section before it.
- `hasImradStructure` — the owner's answer to "does this paper have IMRaD structure at all?",
  `true` or `false`; the manifest carries the same value.
- `textSha256` / `textChars` bind the file to one exact text; a rebuilt text that changes fails
  validation instead of silently shifting the labels.

## Ingesting the owner's decisions

The coordinator publishes a private labelling page built from `candidate-headings.json`; its
database collection holds one document per paper, **doc id = paper id**:

```json
{
  "headings": [
    { "offset": 4021, "line": "Background", "label": "introduction" },
    { "offset": 5120, "line": "Figure 1", "label": "not-heading" }
  ],
  "added": [
    { "line": "Methods We used", "label": "methods", "occurrence": 1 }
  ],
  "hasImradStructure": true,
  "updatedAt": "2026-10-25T09:00:00Z"
}
```

- `label` is one of `introduction`, `methods`, `results`, `discussion`, `results+discussion`,
  `other`, `not-heading`. They become `["introduction"]`, `["methods"]`, `["results"]`,
  `["discussion"]`, `["results", "discussion"]`, `["other"]`, and nothing.
- A candidate the owner did not mark (missing, or `label: null`) counts as **not a heading** — the
  page should show that default.
- `added` names a heading the list missed **by its line text**: a line equal to it (trimmed), or
  failing that a line that begins with it followed by white space or punctuation (a run-in
  heading); `occurrence` (1-based) picks one when several lines match, and an ambiguous entry
  without it is refused.
- **A paper stays pending until `hasImradStructure` is `true` or `false`**: no labels file is
  written for it and its manifest value stays `null`.

The coordinator exports the collection to a JSON file and runs:

```sh
npx tsx scripts/build-imrad-fixtures.ts ingest <export.json>
npx tsx scripts/build-imrad-fixtures.ts validate
```

The export may be an object keyed by doc id, or an array of documents carrying `id` / `doc_id` /
`docId` / `_id` with the fields inline or under `data` (optionally under a top-level `docs`,
`documents`, `items` or `rows`). Ingestion writes nothing at all if any document has a problem — an
unknown paper id, a `headings` entry whose `offset` and `line` do not match a candidate, an unknown
label, an `added` line it cannot find or cannot choose between, two headings at one offset, or a
text that changed since the page was built — and lists every problem. Otherwise it writes
`labels/<id>.json` for each decided paper and sets its `hasImradStructure` in the manifest.
**Nothing but the owner's decisions becomes a label.**

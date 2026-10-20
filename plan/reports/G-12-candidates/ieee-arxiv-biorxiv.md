## Candidate list: IEEE (5+1), arXiv (6+2), bioRxiv (5+2)

No PDFs were fetched or downloaded and no files were written. Everything below comes from pages or APIs read in this session (2026-10-20).

There are three method deviations, all read-only:
- **Europe PMC search (JSON).** I used Europe PMC's REST search API (`ebi.ac.uk/europepmc/webservices/rest/search`) to find candidates and to look up preprint IDs. Every IEEE licence was then confirmed on the PMC article page.
- **arXiv via curl.** arXiv listing pages and abs pages were read with curl (HTML only), with a pause of about 2 seconds between requests. The licence `href` was taken from the abs page.
- **Europe PMC preprint page blocked.** `europepmc.org/article/PPR/PPR813819` returned HTTP 403, so I could not see bioRxiv headings anywhere.

---

### A. IEEE (two-column IEEE journal layout expected; I did not view the PDFs)

Common facts for all six:
- **Access route.** All are publisher versions in PMC. Each PMC page says "...provided here courtesy of Institute of Electrical and Electronics Engineers".
- **Licence.** Each page states "This work is licensed under a Creative Commons Attribution 4.0 License." with https://creativecommons.org/licenses/by/4.0/.
- **No IEEE Xplore link** appears on any of the PMC pages. The only publisher link is the doi.org link given in each row.
- **PDF link.** The PMC page shows a relative link `pdf/<file>`. I resolved it against the article URL and did not fetch it.
- **Heading case.** PMC shows headings like "I. Introduction". The IEEE PDF probably prints them in capitals ("I. INTRODUCTION"), but I did not confirm that.

| # | Journal / field | Title | DOI | Landing page | PDF (relative link on PMC page, resolved) | Headings in order (PMC page) and why useful |
|---|---|---|---|---|---|---|
| 1 | IEEE Open J Eng Med Biol, vol 5, pp 459–466 (2023); medical image classification | UKSSL: Underlying Knowledge Based Semi-Supervised Learning for Medical Image Classification | 10.1109/OJEMB.2023.3305190 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11186655/ (doi.org link: https://doi.org/10.1109/OJEMB.2023.3305190) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11186655/pdf/ojemb-zhang-3305190.pdf | Abstract; I. Introduction; II. Materials and Methods; **III. Results and Discussion**; IV. Conclusion; Funding Statement; Contributor Information; References. Hard case: Results and Discussion merged into one section, with no separate Discussion. |
| 2 | IEEE Open J Eng Med Biol, vol 5, pp 353–361 (2024); CT segmentation | BucketAugment: Reinforced Domain Generalisation in Abdominal CT Segmentation | 10.1109/OJEMB.2024.3397623 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11186658/ (doi.org link: https://doi.org/10.1109/OJEMB.2024.3397623) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11186658/pdf/ojemb-drotar-3397623.pdf | Abstract; I. Introduction; **II. Related Work**; III. Materials and Methods; IV. Results; V. Discussion; VI. Conclusion; Funding Statement; References. The full set of seven standard sections, all with Roman numerals. |
| 3 | IEEE J Transl Eng Health Med, vol 11, pp 32–43 (2022); MRI synthesis | Tumor-Attentive Segmentation-Guided GAN for Synthesizing Breast Contrast-Enhanced MRI Without Contrast Agents (title from the Europe PMC search result, which was cut off after "...Without Contra") | 10.1109/JTEHM.2022.3221918 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9721354/ (doi.org link: https://doi.org/10.1109/JTEHM.2022.3221918) | https://pmc.ncbi.nlm.nih.gov/articles/PMC9721354/pdf/jtehm-park-3221918.pdf | Abstract; I. Introduction; II. Materials and Methods; III. Results; IV. Discussion; V. Conclusion; **Appendix (unnumbered)**; Funding Statement; Contributor Information; References. Hard case: an unnumbered Appendix sits after the Conclusion and **before** the References. |
| 4 | IEEE J Transl Eng Health Med, vol 11, pp 451–459 (2023); surgical instrument design | Design and Evaluation of a Balanced Compliant Laparoscopic Grasper | 10.1109/JTEHM.2023.3291925 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10561751/ (doi.org link: https://doi.org/10.1109/JTEHM.2023.3291925) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10561751/pdf/jtehm-klok-3291925.pdf | Abstract; **Nomenclature**; I. Introduction; II. Materials and Methods; III. Results; IV. Discussion; V. Conclusion; Supplementary Materials; Acknowledgment; Funding Statement; References. Hard case: an unnumbered Nomenclature block comes before the Introduction. Engineering design paper. Page also shows "© 2023 The Authors." |
| 5 | IEEE J Transl Eng Health Med, vol 11, pp 417–423 (2023); EEG seizure prediction | An Epileptic Seizure Prediction Method Based on CBAM-3D CNN-LSTM Model | 10.1109/JTEHM.2023.3290036 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10328218/ (doi.org link: https://doi.org/10.1109/JTEHM.2023.3290036) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10328218/pdf/jtehm-guo-3290036.pdf | Abstract; I. Introduction; **II. Methodology**; III. Results; IV. Conclusion; Funding Statement; Contributor Information; References. Hard case: no Discussion section, and "Methodology" is used instead of "Methods". |
| R1 | IEEE J Transl Eng Health Med, vol 12, pp 382–389 (2024); speech | Improving Dysarthric Speech Segmentation With Emulated and Synthetic Augmentation | 10.1109/JTEHM.2024.3375323 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11008804/ (doi.org link: https://doi.org/10.1109/JTEHM.2024.3375323) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11008804/pdf/jtehm-naeini-3375323.pdf | Abstract; I. Introduction; II. Methods (A–E); III. Results; IV. Discussion; **V. Conclusion and Future Work**; Acknowledgment; Funding Statement; Footnotes; References. Hard case: a compound conclusion heading. |

Other IEEE pages I checked and found suitable but did not list: PMC11268943 (CPAP, IEEE Open J Eng Med Biol), PMC11100860 (ear EEG sleep scoring, IEEE J Transl Eng Health Med) and PMC11379446 (high-density surface EMG, IEEE Open J Eng Med Biol). All three are CC BY 4.0, provided courtesy of IEEE, and use the standard I–V headings.

---

### B. arXiv LaTeX preprints

Common facts:
- **Licence.** For every row, the abs-page licence link is exactly `http://creativecommons.org/licenses/by/4.0/`. Version is the latest shown on the abs page.
- **Headings.** Taken from `arxiv.org/html/<ID>v<N>` for that same version.
- **Template and columns.** The HTML pages never name the LaTeX class, so templates and column counts below are inferred and expected only, not confirmed.
- **PDF link.** The abs page links the PDF as a relative `/pdf/<ID>`. I saw that link literally only on the 2405.00123 abs page; for the others, https://arxiv.org/pdf/<ID> is built from that same pattern.

| # | Columns (expected) | Field | Title | arXiv ID | Landing page | PDF link (not fetched) | Headings in order and why useful |
|---|---|---|---|---|---|---|---|
| 1 | 2 (IEEE conference-style inferred from Roman numerals and "Index Terms") | cs.RO | Comparing Motion Distortion Between Vehicle Field Deployments | 2405.00189v1 (comment on abs page: "Accepted to the IEEE ICRA Workshop on Field Robotics 2024") | https://arxiv.org/abs/2405.00189 | https://arxiv.org/pdf/2405.00189 | Abstract; I Introduction; II Related work on UGV motion distortion features; III Motion distortion metric; IV Case study; **V Lessons learned**; VI Conclusion; References. Useful: IEEE Roman-numeral style with non-standard section names ("Case study", "Lessons learned") and no Methods or Results heading. |
| 2 | unknown (Optica-style references, inferred) | physics.optics, experimental | Polarization-Resolved Transmission Matrices of Specialty Optical Fibers | 2406.00171v1 | https://arxiv.org/abs/2406.00171 | https://arxiv.org/pdf/2406.00171 | Abstract; I Introduction; II Overview; III Experimental Design; IV Basis Functions; V Electric Field Measurements; VI Measuring Phase Drift; VII Data Acquisition Process; VIII Creating the Transmission Matrix; IX Multiplexing Holograms; X Alternate Fiber Geometries; XI Full Polarization Results; XII Far-Field Results; **XIII Discussion and Conclusion**; Data Availability Statement; References. Useful: 13 Roman-numeral sections going past X, and a merged Discussion and Conclusion. |
| 3 | 2 (REVTeX-like "II.1" subsection numbering, inferred) | physics.optics / quantum sensing, theory plus measured spectra | Nanoparticle arrays levitated in a cavity for quantum sensing | 2406.00366v3 (comment: "8 pages, 5 figures. Typos in equation 17 corrected") | https://arxiv.org/abs/2406.00366 | https://arxiv.org/pdf/2406.00366 | Abstract; I Introduction; II Spectra of levitated arrays (II.1, II.2); III Spectra of the N-particle array: 1D model (III.1 Power Spectral Densities (PSDs), III.2 Measured displacement spectra for an array); IV Force sensing: signal to error considerations; **V Discussion and conclusions**; References. Useful: likely physics two-column layout with merged closing section. The text mentions an appendix but the HTML shows none. |
| 4 | expected 2 (possible AIP/REVTeX; not confirmed) | physics.chem-ph, computational chemistry | Thawed Gaussian wavepacket dynamics with Δ-machine learned potentials (abs title: "...with $\Delta$-machine learned potentials") | 2405.00193v1 (comment: "12 pages, 3 figures") | https://arxiv.org/abs/2405.00193 | https://arxiv.org/pdf/2405.00193 | Abstract; I Introduction; II Theory (II.1–II.4); III Numerical simulations (III.1 Computational details, III.2 Photoelectron spectra of ammonia (NH3)); IV Conclusions; **Appendix A / B / C before References**. Useful: REVTeX-style appendices placed before the bibliography, and Theory / Numerical simulations instead of Methods / Results. |
| 5 | expected 2 (published at KDD, so ACM acmart likely; not confirmed) | cs.LG, graph embeddings | Bypassing Skip-Gram Negative Sampling: Dimension Regularization as a More Efficient Alternative for Graph Embeddings | 2405.00172v2 (comment: "Published in KDD'25") | https://arxiv.org/abs/2405.00172 | https://arxiv.org/pdf/2405.00172 | Abstract.; 1 Introduction; 2 Related Works (2.1–2.3); 3 From Node Repulsion to Dimension Regularization; 4 Algorithm Augmentation to Replace SGNS; 5 Experiments (5.1 Methodology, 5.2 Results); 6 Discussion; 7 Conclusion; References; **A Proofs; B Experimental Methodology; C Supplemental Evaluation (after References)**. Useful: Arabic-numbered LaTeX style with appendices after the references; the run-in "Abstract." has a trailing period. |
| 6 | 1 (PAKDD 2024 venue noted in the HTML; Springer LNCS single column likely; not confirmed) | cs.LG, table understanding | Graph Neural Network Approach to Semantic Type Detection in Tables | 2405.00123v1 | https://arxiv.org/abs/2405.00123 | https://arxiv.org/pdf/2405.00123 (relative link `/pdf/2405.00123` seen on abs page) | Abstract; 1 Introduction; 2 Related works; 3 Problem Definition; 4 GAIT (4.1–4.3); 5 Evaluation (5.1 Evaluation Method, 5.2 Results); 6 Conclusion; Acknowledgement; References. Useful: single-column "1 Introduction" style, with Results only as a subsection. |
| R1 | expected 2 (header reads "Preprint: AIP/123-QED", so AIP REVTeX) | physics.app-ph, acoustics metasurface | Hybrid ultrathin metasurface for broadband sound absorption | 2403.00369v1 (comment: "5 figures, 5 pages") | https://arxiv.org/abs/2403.00369 | https://arxiv.org/pdf/2403.00369 | Abstract; [no body section headings at all]; Acknowledgements (run-in); Conflict of interest; Data Availability Statement; References. Useful as a hard negative: a letter-style paper with no Introduction, Methods or Results headings. |
| R2 | unknown (REVTeX-like "Appendix A" style, inferred) | physics.optics, topological photonics (theory/numerics) | Versatile Braiding of Non-Hermitian Topological Edge States | 2406.00726v2 | https://arxiv.org/abs/2406.00726 | https://arxiv.org/pdf/2406.00726 | Abstract; I Introduction; II Non-Hermitian Lattice Model; III Characterizing the energy braids; IV Phase diagrams and exceptional points; V Discussion; Appendix A, Appendix B, Appendix C (before References); References. Mentions "Supplemental Materials" that are not in the HTML. |

The column mix (the list asked for some two-column and some single-column) is not confirmed: only #6 is expected to be single-column, and none of the column counts have been checked against the PDF.

Considered and not used, all CC BY 4.0 with HTML available:
- 2405.00136v2: IEEE-style "I-A" subsections, but a theory paper.
- 2405.00383v2: IEEE-style, "IV Conclusion & Future Work".
- 2406.00399v1 and 2406.00604v1: eess.SP, IEEE-style.

Several CC BY physics papers had no HTML version (404), so their headings could not be seen: 2403.01524, 2403.02822, 2403.01074, 2403.01973, 2403.00709.

---

### C. bioRxiv preprints

Common facts:
- **Licence source.** The bioRxiv API, `https://api.biorxiv.org/details/biorxiv/<DOI>`, field `license`, checked for every version.
- **Single-column.** bioRxiv preprints are expected to be single-column; I could not see the layout.
- **Headings not seen.** bioRxiv pages were not accessed (they return 429), and the Europe PMC preprint page returned 403, so no headings could be confirmed for any bioRxiv candidate. The usual bioRxiv pattern (Results then Discussion, with Methods at the end) is expected but unverified.
- **Landing and PDF URLs.** Both are **constructed from bioRxiv's URL pattern, not read from the page**. Separately, the Europe PMC search result lists a bioRxiv PDF URL of the form `https://www.biorxiv.org/content/biorxiv/early/2024/03/04/<DOI-suffix>.full.pdf` for these preprints; it is not fetched.

| # | Field (API category) | Title (from API) | DOI and version checked | API licence | Landing page (constructed) | PDF (constructed) | Notes |
|---|---|---|---|---|---|---|---|
| 1 | neuroscience | Self-organization of modular activity in immature cortical networks | 10.1101/2024.03.02.583133 v1 (only version, 2024-03-04) | `cc_by` | https://www.biorxiv.org/content/10.1101/2024.03.02.583133v1 | https://www.biorxiv.org/content/10.1101/2024.03.02.583133v1.full.pdf | API "published" field: 10.1038/s41467-024-48341-x (Nature Communications style, so Methods at the end is plausible but not verified). |
| 2 | genomics | Non-linear transcriptional responses to gradual modulation of transcription factor dosage | 10.1101/2024.03.01.582837 v1, v2, v3 all `cc_by`; latest is v3 (2025-08-07) | `cc_by` | https://www.biorxiv.org/content/10.1101/2024.03.01.582837v3 | https://www.biorxiv.org/content/10.1101/2024.03.01.582837v3.full.pdf | Three versions, so pin the version. Published as eLife 10.7554/eLife.100555.3. Europe PMC record PPR813819 also says "cc by". |
| 3 | bioengineering | Synthesis of arbitrary interference patterns using a single galvanometric mirror, and its application to Structured Illu… (title cut off in my output; complete it from the API) | 10.1101/2024.02.29.582785 v1 (only version) | `cc_by` | https://www.biorxiv.org/content/10.1101/2024.02.29.582785v1 | https://www.biorxiv.org/content/10.1101/2024.02.29.582785v1.full.pdf | Optics and instrumentation paper, likely a physics-like structure. Published 10.1021/acsphotonics.5c00516. |
| 4 | genetics | Sexually dimorphic renal expression of Klotho is directed by a kidney-specific distal enhancer responsive to HNF1b | 10.1101/2024.02.29.582831 v1 (only version) | `cc0` | https://www.biorxiv.org/content/10.1101/2024.02.29.582831v1 | https://www.biorxiv.org/content/10.1101/2024.02.29.582831v1.full.pdf | The only CC0 candidate. Europe PMC record PPR813740. |
| 5 | zoology (type "confirmatory results") | Element accumulation in the tracheal and bronchial cartilages of monkeys | 10.1101/2024.03.01.582912 v1 (only version) | `cc_by` | https://www.biorxiv.org/content/10.1101/2024.03.01.582912v1 | https://www.biorxiv.org/content/10.1101/2024.03.01.582912v1.full.pdf | A different article type (confirmatory results). Published 10.1016/j.bbrc.2024.150699. |
| R1 | microbiology | Identification of Southeast Asian Anopheles mosquito species using MALDI-TOF mass spectrometry | 10.1101/2024.03.04.583274 v1 (only version) | `cc_by` | https://www.biorxiv.org/content/10.1101/2024.03.04.583274v1 | https://www.biorxiv.org/content/10.1101/2024.03.04.583274v1.full.pdf | Unpublished according to the API ("NA"). |
| R2 | systems biology | Correlation measures in metagenomic data: the blessing of dimensionality | 10.1101/2024.02.29.582875 v1 (only version) | `cc_by` | https://www.biorxiv.org/content/10.1101/2024.02.29.582875v1 | https://www.biorxiv.org/content/10.1101/2024.02.29.582875v1.full.pdf | Quantitative and statistical paper. Unpublished according to the API ("NA"). |

Also CC BY in the API, if more are needed: 10.1101/2024.03.01.582962 v1 (neuroscience, "Dorsal CA1 silencing degrades tactile short-term memory"; Europe PMC also says "cc by") and 10.1101/2023.09.04.556273 (v1 and v2 both `cc_by`; the title changed between versions).

---

### D. Exclusion counts

**arXiv**: 84 abs pages screened in five listings (physics.app-ph 2024-03; cs.LG, q-bio.QM, physics.chem-ph and cs.RO 2024-05; physics.optics, cond-mat.mtrl-sci and eess.SP 2024-06).
- Excluded for non-commercial or no-derivatives terms: **10** (7 × `by-nc-nd/4.0`, 3 × `by-nc-sa/4.0`).
- Rejected as `nonexclusive-distrib/1.0`: **41**.
- Withdrawn with no licence shown: 1 (2406.00590).
- Acceptable: 31 × `by/4.0` and 1 × `by-sa/4.0`.

**bioRxiv**: all 233 records the API returned for 2024-03-04 were screened.
- Excluded for non-commercial or no-derivatives terms: **117** (86 `cc_by_nc_nd`, 15 `cc_by_nc`, 16 `cc_by_nd`).
- `cc_no` (no reuse licence): 66, excluded.
- Acceptable: 48 `cc_by` and 2 `cc0`.

**IEEE**:
- Non-commercial or no-derivatives pages opened and rejected: **0**. I only opened pages that Europe PMC already listed as CC BY.
- For scale only (Europe PMC aggregate, not individually checked): 2023 IEEE Open J Eng Med Biol had 11 "cc by-nc-nd" against 28 "cc by". 2023 IEEE Trans Neural Syst Rehabil Eng had 119 "cc by-nc-nd" against 355 "cc by".
- Rejected as author manuscripts, not the IEEE publisher PDF: **2**, both CC BY 4.0. PMC11249027 (IEEE Trans Neural Syst Rehabil Eng; "Author manuscript; available in PMC", pdf `nihms-2004109.pdf`) and PMC11469632 (IEEE Access; "Author manuscript", pdf `nihms-1960176.pdf`).
- Europe PMC returns **0** non-author-manuscript CC BY records for IEEE Trans Neural Syst Rehabil Eng and IEEE Access in 2023–2024. So those two journals reach PMC only as manuscripts (`nihms`), and only IEEE J Transl Eng Health Med and IEEE Open J Eng Med Biol supply IEEE publisher PDFs there.

### E. Not verified
- **IEEE:** capital-letter headings in the PDFs are not confirmed (PMC shows title case). No IEEE Xplore document links appear on the PMC pages, so none are reported.
- **arXiv:** the LaTeX class and column count are not confirmed for any paper (the HTML rendering does not show them).
- **bioRxiv:** no headings could be seen for any candidate, and all landing and PDF URLs are pattern-constructed. Licences are confirmed only through the bioRxiv API, not on the bioRxiv page.
- **bioRxiv titles:** candidate 3's title is cut off above. The full title is available from the same API call.

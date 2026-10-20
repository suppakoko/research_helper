## Candidate list: Springer (including BMC and SpringerOpen) and Nature portfolio

**How the pages were checked.** I opened every landing page in the built-in browser pane, without logging in, and hit no CAPTCHA or block page. I read the title, DOI, journal, article type, section headings, licence paragraph, licence link and "Download PDF" link from the page's own HTML using JavaScript. I did not fetch or download any PDF and did not write any files.

**Notes that apply to the whole list:**
- **Domain change.** The `*.biomedcentral.com` and SpringerOpen domains now send a permanent (301) redirect to `link.springer.com/article/<DOI>`. All BMC and SpringerOpen landing pages below are therefore on link.springer.com, which counts as the publisher's own page.
- **PDF links.** Every PDF link is relative, copied exactly from the page. Its host is the landing-page host (link.springer.com or www.nature.com).
- **Licence text.** The licence quote for each article is the opening sentence, copied exactly. The licence link URL comes from the page's own link.
- **Heading lists.** These are the article's top-level section titles as shown on the landing page, in order, ending before back matter such as "Data availability" and "References".
- **Column counts.** I did not see any PDF, so every column count is "expected from journal style". The single- or two-column call for Scientific Reports, EPJ, Journal of Big Data and Journal of Materials Science is **not verified**, and a human should check those PDFs.

### Springer / BMC / SpringerOpen — 7 candidates

**S1 | BMC Bioinformatics 12:323 (2011)**
- Columns: 2 (expected from journal style).
- Field: bioinformatics.
- Title: RSEM: accurate transcript quantification from RNA-Seq data with or without a reference genome
- DOI: 10.1186/1471-2105-12-323
- Landing page: https://link.springer.com/article/10.1186/1471-2105-12-323
- PDF: `/content/pdf/10.1186/1471-2105-12-323.pdf`
- Licence: "This article is published under license to BioMed Central Ltd. This is an Open Access article distributed under the terms of the Creative Commons Attribution License (http://creativecommons.org/licenses/by/2.0)" (CC BY 2.0)
- Headings: Abstract / Background / Implementation / Results and Discussion / Conclusions / Availability and requirements / Methods / Abbreviations
- Hard cases: merged "Results and Discussion"; Methods placed after Conclusions; "Background" used instead of Introduction. These suit a fixture.
- Caveat: the page labels the article type "Software", not a research article. The 7 additional files are separate downloads, not appended to the article PDF.

**S2 | Journal of Cheminformatics 11:71 (2019)**
- Columns: 2 (expected from journal style).
- Field: cheminformatics / machine learning.
- Title: Randomized SMILES strings improve the quality of molecular generative models
- DOI: 10.1186/s13321-019-0393-0
- Landing page: https://link.springer.com/article/10.1186/s13321-019-0393-0
- PDF: `/content/pdf/10.1186/s13321-019-0393-0.pdf`
- Licence: "Open Access This article is distributed under the terms of the Creative Commons Attribution 4.0 International License (http://creativecommons.org/licenses/by/4.0/)" (CC BY 4.0)
- Headings: Abstract / Introduction / Methods / Results / Discussion / Conclusions
- Hard case: none. This is the plain unnumbered layout, useful as a baseline. Type: "Research article".

**S3 | BMC Medicine (2026)**
- Columns: 2 (expected from journal style).
- Field: clinical medicine (cluster-randomised trial).
- Title: Community health worker-led versus facility-based type 2 diabetes care in rural Lesotho: a cluster-randomized trial within the ComBaCaL cohort study
- DOI: 10.1186/s12916-026-04943-4
- Landing page: https://link.springer.com/article/10.1186/s12916-026-04943-4
- PDF: `/content/pdf/10.1186/s12916-026-04943-4.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Background / Methods / Results / Discussion / Conclusions
- Hard case: "Background" in place of Introduction; this is classic medical layout. Type: "Research". Supplementary files are separate DOCX files.

**S4 | EPJ Data Science (SpringerOpen), 2024**
- Columns: 1 (expected from journal style, not verified).
- Field: computational social science / epidemiology.
- Title: Social media sensors as early signals of influenza outbreaks at scale
- DOI: 10.1140/epjds/s13688-024-00474-1
- Landing page: https://link.springer.com/article/10.1140/epjds/s13688-024-00474-1
- PDF: `/content/pdf/10.1140/epjds/s13688-024-00474-1.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / 1 Introduction / 2 Results / 3 Discussion / 4 Methods
- Hard cases: numbered headings combined with Methods at the end.

**S5 | Nano Convergence (SpringerOpen), 2024**
- Columns: 2 (expected from journal style, not verified).
- Field: nanomaterials / chemistry.
- Title: Monodispersed mesoscopic star-shaped gold particles via silver-ion-assisted multi-directional growth for highly sensitive SERS-active substrates
- DOI: 10.1186/s40580-024-00435-4
- Landing page: https://link.springer.com/article/10.1186/s40580-024-00435-4
- PDF: `/content/pdf/10.1186/s40580-024-00435-4.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / 1 Introduction / 2 Experimental method / 3 Results and discussion / 4 Conclusion
- Hard cases: numbered headings; "Experimental method" instead of Methods; merged "Results and discussion". Type: "Full Paper".

**S6 | Journal of Big Data (SpringerOpen), 2024**
- Columns: 1 (expected from journal style, not verified).
- Field: computer science (Internet of Things intrusion detection).
- Title: Optimizing IoT intrusion detection system: feature selection versus feature extraction in machine learning
- DOI: 10.1186/s40537-024-00892-y
- Landing page: https://link.springer.com/article/10.1186/s40537-024-00892-y
- PDF: `/content/pdf/10.1186/s40537-024-00892-y.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Related works / Methodology / Experimental setup and analysis / Result and analysis / Conclusions
- Hard cases: non-standard wording ("Methodology", singular "Result and analysis"); no Discussion section. A good negative and fuzzy-match test.

**S7 | Journal of Materials Science (Springer hybrid journal, not BMC), 2023**
- Columns: expected from journal style, not verified.
- Field: materials science / physics (battery cathodes).
- Title: Determining internal porosity in Prussian blue analogue cathode materials using positron annihilation lifetime spectroscopy
- DOI: 10.1007/s10853-023-09025-x
- Landing page: https://link.springer.com/article/10.1007/s10853-023-09025-x
- PDF: `/content/pdf/10.1007/s10853-023-09025-x.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Introduction / Methods / Results / Discussion / Conclusion
- Notes: the page's section list showed no separate "Abstract" section, which is typical for hybrid journals. The page gives the article type as "Electronic materials" (the journal's subject section). This is the hybrid open-access article with CC BY that the slice required.

### Springer reserves

**SR1 | EPJ Quantum Technology (SpringerOpen), 2024**
- Columns: expected from journal style, not verified.
- Field: quantum physics.
- Title: Numerical model of N-level cascade systems for atomic Radio Frequency sensing applications
- DOI: 10.1140/epjqt/s40507-024-00291-5
- Landing page: https://link.springer.com/article/10.1140/epjqt/s40507-024-00291-5
- PDF: `/content/pdf/10.1140/epjqt/s40507-024-00291-5.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / 1 Introduction / 2 Theory / 3 Numerical model and python packages / 4 Results and discussion / 5 Conclusion and future work
- Hard cases: numbered headings; merged Results and discussion; no Methods heading. The supplementary file is a separate PDF.

**SR2 | BMC Biology, 2024**
- Columns: 2 (expected from journal style).
- Field: genetics / vector biology.
- Title: Two highly selected mutations in the tandemly duplicated CYP6P4a and CYP6P4b genes drive pyrethroid resistance in Anopheles funestus in West Africa
- DOI: 10.1186/s12915-024-02081-y
- Landing page: https://link.springer.com/article/10.1186/s12915-024-02081-y
- PDF: `/content/pdf/10.1186/s12915-024-02081-y.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Background / Results / Discussion / Conclusions / Methods
- Hard case: Methods after Conclusions.

### Nature portfolio — 7 candidates

**N1 | Nature Communications 15, 357 (2024)**
- Columns: 2.
- Field: environmental and earth science (agroecosystem carbon cycle).
- Title: Knowledge-guided machine learning can improve carbon cycle quantification in agroecosystems
- DOI: 10.1038/s41467-023-43860-5
- Landing page: https://www.nature.com/articles/s41467-023-43860-5
- PDF: `/articles/s41467-023-43860-5.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License, which permits use, sharing, adaptation, distribution and reproduction in any medium or format, as long as you give appropriate credit to the original author(s) and the source, provide a link to the Creative Commons license, and indicate if changes were made. … To view a copy of this license, visit http://creativecommons.org/licenses/by/4.0/."
- Headings: Abstract / Introduction / Results / Discussion / Methods
- Hard cases: Methods at the end. The web page shows an "Introduction" heading, but the Nature Communications PDF style usually leaves it unheaded; this needs checking in the PDF. Supplementary Information, Peer Review File and Reporting Summary are separate PDFs.

**N2 | Nature Communications (2023)**
- Columns: 2.
- Field: physics (trapped-ion quantum computing).
- Title: Native qudit entanglement in a trapped ion quantum processor
- DOI: 10.1038/s41467-023-37375-2
- Landing page: https://www.nature.com/articles/s41467-023-37375-2
- PDF: `/articles/s41467-023-37375-2.pdf`
- Licence: same Creative Commons Attribution 4.0 International sentence as N1, with link http://creativecommons.org/licenses/by/4.0/.
- Headings: Abstract / Introduction / Results / Discussion
- Hard case: there is **no Methods section** even though the journal normally has one. This is a negative test.

**N3 | Nature Communications (2024)**
- Columns: 2.
- Field: chemistry (electrocatalysis).
- Title: Turning copper into an efficient and stable CO evolution catalyst beyond noble metals
- DOI: 10.1038/s41467-024-50436-4
- Landing page: https://www.nature.com/articles/s41467-024-50436-4
- PDF: `/articles/s41467-024-50436-4.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Results and discussion / Methods
- Hard cases: merged "Results and discussion" combined with Methods at the end.

**N4 | Scientific Reports (2023)**
- Columns: expected from journal style, not verified.
- Field: mechanical engineering / machine learning.
- Title: Deep transfer learning strategy for efficient domain generalisation in machine fault diagnosis
- DOI: 10.1038/s41598-023-33887-5
- Landing page: https://www.nature.com/articles/s41598-023-33887-5
- PDF: `/articles/s41598-023-33887-5.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Methodology / Results and discussion / Conclusion and future work
- Hard cases: "Methodology" variant; merged Results and discussion; compound conclusion heading.

**N5 | Scientific Reports (2024)**
- Columns: expected from journal style, not verified.
- Field: epidemiology / public health (Korean national survey cohort).
- Title: Association of physical activity and socio-economic status on mortality in older adults: a retrospective cohort study of KNHANES-mortality linked data
- DOI: 10.1038/s41598-024-62216-7
- Landing page: https://www.nature.com/articles/s41598-024-62216-7
- PDF: `/articles/s41598-024-62216-7.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Results / Discussion / Methods
- Hard case: Methods at the end.

**N6 | Scientific Reports (2022)**
- Columns: expected from journal style, not verified.
- Field: agronomy / soil microbiology.
- Title: Effects of Rhizophagus intraradices on soybean yield and the composition of microbial communities in the rhizosphere soil of continuous cropping soybean
- DOI: 10.1038/s41598-022-22473-w
- Landing page: https://www.nature.com/articles/s41598-022-22473-w
- PDF: `/articles/s41598-022-22473-w.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Materials and methods / Results / Discussion / Conclusions
- Hard case: "Materials and methods" placed in the middle. This contrasts with N5, where Methods comes at the end.

**N7 | Communications Biology (2023)**
- Columns: 2 (expected from journal style).
- Field: structural biology / deep learning.
- Title: Multi-domain and complex protein structure prediction using inter-domain interactions from deep learning
- DOI: 10.1038/s42003-023-05610-7
- Landing page: https://www.nature.com/articles/s42003-023-05610-7
- PDF: `/articles/s42003-023-05610-7.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Results / Discussion / Methods
- Hard case: Methods at the end. Supplementary material is separate (PDF, Excel workbooks and Reporting Summary).

### Nature reserves

**NR1 | npj Computational Materials (2022)**
- Columns: 2 (expected from journal style).
- Field: computational materials science.
- Title: A machine-learned interatomic potential for silica and its relation to empirical models
- DOI: 10.1038/s41524-022-00768-w
- Landing page: https://www.nature.com/articles/s41524-022-00768-w
- PDF: `/articles/s41524-022-00768-w.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Results / Discussion / Methods
- Hard case: Methods at the end.

**NR2 | Nature Communications (2023)**
- Columns: 2.
- Field: genomics (single-cell RNA sequencing).
- Title: Benchmarking strategies for cross-species integration of single-cell RNA sequencing data
- DOI: 10.1038/s41467-023-41855-w
- Landing page: https://www.nature.com/articles/s41467-023-41855-w
- PDF: `/articles/s41467-023-41855-w.pdf`
- Licence: "Open Access This article is licensed under a Creative Commons Attribution 4.0 International License" (link http://creativecommons.org/licenses/by/4.0/)
- Headings: Abstract / Introduction / Results / Discussion / Methods
- Hard case: Methods at the end.

### Checked and excluded for NC/ND: 3
1. Scientific Reports, 10.1038/s41598-024-75309-0, "Effects of cotton peanut rotation on crop yield soil nutrients and microbial diversity". Licence: Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International (CC BY-NC-ND 4.0).
2. Scientific Reports, 10.1038/s41598-024-77368-9, "Potential of biochar to restoration of microbial biomass and enzymatic activity in a highly degraded semiarid soil". Licence: CC BY-NC-ND 4.0.
3. EPJ Quantum Technology, 10.1140/epjqt/s40507-024-00297-z, "Practical ultra-low frequency noise laser system for quantum sensors". Licence: CC BY-NC-ND 4.0.

Both excluded Scientific Reports articles are from late 2024. Recent Scientific Reports articles may often carry the non-commercial, no-derivatives licence, so each one needs its own check.

### Rejected for other reasons, and anything I could not verify
- **Journal of Cheminformatics, Open Babel paper (10.1186/1758-2946-3-33).** Rejected because the headings are not research-article sections (Features / Implementation / Using Open Babel …). I never confirmed its licence, so it is "unconfirmed" and not counted.
- **EPJ Data Science, 10.1140/epjds/s13688-026-00685-8.** Rejected because the page offers only an accepted-manuscript PDF (`_reference.pdf`) and shows no full-text headings, even though it is CC BY 4.0.
- **Column counts.** None were checked against a PDF.
- **Publication dates.** On link.springer.com pages the date field gives only the volume's year and month (e.g. "2024/12"), not the exact online publication date.
- **S3 (BMC Medicine, 2026).** This is a very recent article. Its full text and licence are on the page, but a human should confirm that the final typeset PDF is available rather than only an accepted manuscript.
- **Supplementary material.** None of the landing pages indicate supplementary material appended inside the main PDF; every supplement is listed as a separate download. So I have no confirmed "appended supplement" hard case.

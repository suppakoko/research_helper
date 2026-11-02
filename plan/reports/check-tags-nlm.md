# check-tags-nlm — report of the executing agent (saved verbatim, 2026-11-02)

**Result: NLM publishes no single current list of check tags that I could find.** I found three NLM sources, and they disagree. All 27 `CHECK_TAGS` terms are on the 2023 list, but not on the other two. The nine history tags are on all three and missing from `CHECK_TAGS`.

No repository file changed. No certificate error appeared and no certificate check was disabled. The only pages I could not read were `CHK_010.htm` and `CHK_020.htm`, which returned 404; the `.html` form of `CHK_010` is the redirect notice under source A.

## Sources

| | Source | Date it states | Status |
|---|---|---|---|
| A | NLM course "MEDLINE Indexing Online Training Course", page "Check Tags": https://wayback.archive-it.org/org-350/20240816204639/https://www.nlm.nih.gov/bsd/indexing/training/CHK_010.html<br>The list is an image: https://wayback.archive-it.org/org-350/20240816211223im_/https://www.nlm.nih.gov/bsd/indexing/training/images/CHK_010-check-tags-ims.png | "Last Reviewed: January 24, 2017"; captured Aug 16, 2024 | Archived copy made at NLM's request. The live page says "This page is no longer being maintained." |
| B | NLM Lister Hill Center report, Le and Mork, "Check Tags MeSH Terms Indexing Research Project": https://lhncbc.nlm.nih.gov/LHC-publications/PDF/CheckTagsMeSHTermsResearchTechnicalReport.pdf | May 2023; data from the 2021 MEDLINE Baseline | A research report, not indexing policy. It says "40 most frequently indexed MeSH terms known as Check Tags". The terms come from its Figure 6 table. |
| C | Current MeSH annotations, through NLM's query service: https://id.nlm.nih.gov/mesh/sparql | Male's record: `lastUpdated` 2026-01-01. MeSH Browser pages for Humans and Guinea Pigs are titled "MeSH Descriptor Data 2026" | **NLM states no list here; I derived it** by keeping descriptors whose own annotation calls them a check tag. |

MeSH's structural class is narrower than any of these. Only `Male` and `Female` are typed `CheckTag` (2 rows from the query). NLM's XML documentation gives `3 = Check Tag, e.g., 'Male'` (https://www.nlm.nih.gov/mesh/xml_data_elements.html, "Last Reviewed: July 9, 2025").

## The lists

**A, 33 terms, as printed in the image:**
- People and pregnancy: Human, Male, Female, Pregn, Inf New (to 1 mo), Inf (1 to 23 mo), Child Pre (2-5), Child (6-12), Adolesc (13-18), Young Adult (19-24), Adult (19-44), Mid Age (45-64), Aged (65-79), Aged (80+)
- Animals: Animal, Mice, Rats, Cats, Cattle, Chick Embryo, Dogs, Guinea Pigs, Hamsters, Rabbits
- Periods: Ancient, Medieval, 15th Cent, 16th Cent, 17th Cent, 18th Cent, 19th Cent, 20th Cent, 21st Cent

**B, 40 terms:**
- The 27 `CHECK_TAGS` terms
- Bees, Chlorocebus aethiops, History of Medicine, United States
- History, Ancient; History, Medieval; History, 15th Century through History, 21st Century (7 terms)

**C, 32 terms:**
- Adolescent; Adult; Aged; Aged, 80 and over; Animals; Cats; Chick Embryo; Child; Child, Preschool; Cricetinae; Dogs; Female; Guinea Pigs; Humans; Infant; Infant, Newborn; Male; Mice; Middle Aged; Pregnancy; Rabbits; Rats; Young Adult
- The same 9 History terms as B

## On `CHECK_TAGS` but not on the source list

| Term | A (2017) | B (2023) | C (2026) | Spelling only? |
|---|---|---|---|---|
| `Horses` | absent | present | absent | No |
| `Sheep` | absent | present | absent | No |
| `Swine` | absent | present | absent | No |
| `Cattle` | present | present | absent | No (see below) |
| `Cricetinae` | printed as "Hamsters" | present | present | Different name, same tag: its annotation reads "check tag: NIM no qualifiers for HAMSTERS or any CRICETINAE" |

- **`Cattle`:** its own annotation does not call it a check tag, but other records do, for example Cattle Diseases ("check tags CATTLE (NIM) & ANIMALS").
- **`Horses`, `Sheep`, `Swine`:** their own annotations do not mention check tags. Other records name them beside the phrase, not within it, for example "don't forget also SHEEP (NIM) & check tag ANIMALS".
- **Spelling only, against A:** Humans/Human, Animals/Animal, Pregnancy/Pregn, Infant, Newborn/Inf New, Infant/Inf, Child, Preschool/Child Pre, Adolescent/Adolesc, Middle Aged/Mid Age, Aged, 80 and over/Aged (80+). The other terms on A match exactly apart from A's age ranges.
- **Against B and C:** every other term matches exactly.

## On the source list but not on `CHECK_TAGS`

None of these is a spelling difference.

| Terms | A | B | C |
|---|---|---|---|
| The 9 period tags (Ancient, Medieval, 15th to 21st Century) | present, short names | present, `History, ...` | present, `History, ...` |
| `Bees` | absent | present | absent |
| `Chlorocebus aethiops` | absent | present | absent |
| `History of Medicine` | absent | present | absent |
| `United States` | absent | present | absent |

C's annotation for the period tags reads "IM general only; NIM as check tag", or for Ancient "before 500 AD; IM general only; NIM as check tag; ...". The annotation I read for `United States` does not mention check tags. `Bees`, `Chlorocebus aethiops` and `History of Medicine` did not appear in the annotation search for "check tag".

## Singular and plural

- **`docs/05-related-work-discovery.md` §7.2 says nothing about singular or plural forms.** `Mice` appears only as a list member, at lines 867 and 876. "Mouse", "singular" and "plural" appear nowhere in the document.
- **The `Mouse` finding is elsewhere:** `plan/reports/P5-T18.md` item 3 under its limits says the singular keyword `Mouse` gets through, scored 0.438 in the measured profile, and was left as it is.
- **The sources:** all three use `Mice`, and none lists `Mouse`. Source A prints "Human" and "Animal" in the singular, where B and C use `Humans` and `Animals`.

## How far this was read

- **Read directly:** the source A image, the source B table (through `pdftotext`), and the query results as raw JSON. Source B's number columns came out misaligned, so I relied only on its term names.
- **Read through the fetch tool's summarizer:** the dates and notices on the NLM web pages, including the `xml_data_elements` quote, so those are less directly checked.
- **Source C limits:** it depends on my pattern match over 201 annotations, and I reviewed the non-matching rows by eye. I confirmed the 2026 year only as the table above states, and did not check the query service's edition separately.

Query scratch files are in `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\`: `checktag.json` and `ct.js`.

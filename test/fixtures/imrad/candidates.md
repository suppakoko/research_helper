# IMRaD fixture set — candidate list and downloads (gate `G-12`, steps 1–2)

`P3-T20` steps 1 and 2 were done by the owner, not by an agent. This file records what was decided;
nothing here was re-decided. Sources: `plan/reports/G-12-downloads.md` (the approved list, each
download, the licence re-check) and `plan/00-task-index.md` §6 items 276(b), 277 and 280(b).

## Step 1 — the candidate list and its approval

- **Decided 2026-10-20 (owner, `plan/00` §6 item 234 d):** open-access papers only, each with a
  redistributable licence, listed for the owner.
- The coordinator drew up 57 candidates and 20 reserves on a private picks page and recommended 40.
  **Decided 2026-10-23 (owner, item 276(b)):** the 40 recommended candidates are the `P3-T20` set;
  each download is still asked for (a list may be approved together), and each licence is
  re-checked on the PDF itself.
- **Swap 1, O1 → O3 (2026-10-23).** O1 (MNRAS, 10.1093/mnras/staf1405) could not be obtained without
  a bypass: the OUP site answered 403 and the paper is not in Europe PMC. The owner approved reserve
  **O3** (GigaScience 2025, 10.1093/gigascience/giaf148, CC BY 4.0, PMC12821379) in its place.
- **Swap 2, X3 → XR2 (2026-10-23, item 277).** X3 (Public Health Reports 1965, PMC1919615) failed the
  licence re-check: its authors were university staff, so it is not a US-government work by
  authorship, and no licence shows on the PDF. The owner replaced it with reserve **XR2**, NASA
  Technical Note D-7812 (NTRS 19750004163; NTRS record: distribution PUBLIC,
  `GOV_PUBLIC_USE_PERMITTED`). X3's file was removed.

## Step 2 — the downloads

The owner approved the download list on 2026-10-23. All 40 files were downloaded one at a time,
5 seconds apart, into `D:\KIST\projects\research_helper-g12\` (outside the repository; PDFs are
never committed). Every file starts with `%PDF-`; sizes and SHA-256 prefixes are in that folder's
`_log.txt`, which `scripts/build-imrad-fixtures.ts extract` checks before Zotero reads a file. No
403, 429 or bot-check page was met. PubMed Central's own PDF links answer with a script-driven
bot check, so the papers held in PubMed Central were taken from Europe PMC's official PDF render of
the same record (`europepmc.org/articles/<PMCID>?pdf=render`); nothing was bypassed. XR2 came from
NTRS (861,148 bytes).

## Composition (the 40 that were downloaded)

| Family | Ids | Count |
|---|---|---|
| Springer (BMC, EPJ, Nano Convergence) | S1, S2, S4, S5 | 4 |
| Nature (Nature Communications, Scientific Reports) | N1, N2, N3, N6 | 4 |
| Elsevier (Heliyon, iScience, Ultrasonics Sonochemistry, eBioMedicine, JBC) | E1, E2, E4, E5, E6 | 5 |
| Wiley (ChemistryOpen, Advanced Science, Brain and Behavior, MicrobiologyOpen) | W1, W2, W3, W4, W5 | 5 |
| PLOS (ONE, Medicine, Genetics) | P1, P3, P5, P6 | 4 |
| OUP (NAR, GigaScience, Bioinformatics, PNAS Nexus) | O2, O3, O4, O5 | 4 |
| IEEE (OJEMB, JTEHM) | I1, I3, I4, I5 | 4 |
| arXiv (LaTeX preprints) | A1, A4, A5, A6 | 4 |
| bioRxiv (preprints) | B1, B2, B4 | 3 |
| US government, scanned (NBS J. Res., NASA TN) | X1, X2, XR2 | 3 |
| **Total** | | **40** |

Every family `docs/06` §4.3 names has at least 4 papers, so the card's "accept the shortfall"
option was not needed. Preprints: 7 (A1, A4, A5, A6, B1, B2, B4), against the card's ≥ 6.

## Licences, as re-checked on the PDFs (2026-10-23)

| Licence | Papers | Where it was confirmed |
|---|---|---|
| CC BY 4.0 | S2, S4, S5, E1, E4, E5, E6, W1–W5, P1, P3, P5, P6, O2, O3, O4, O5, I1, I3, I4, I5, A5 | page 1 of the PDF |
| CC BY 4.0 | E2 | a later page of the PDF |
| CC BY 4.0 | N1, N2, N3, N6 | "licensed under a Creative Commons Attribution 4.0" at the end of the article |
| CC BY 4.0 | A1, A4, A6 | the PDF prints none; each arXiv abstract page links creativecommons.org/licenses/by/4.0 |
| CC BY 4.0 | B1, B2 | the bioRxiv header on page 1, "CC-BY 4.0 International license" |
| CC BY 2.0 | S1 | page 1 of the PDF |
| CC0 1.0 | B4 | page 1: "not subject to copyright under 17 USC 105 … CC0" |
| US government work | X1, X2 | page 1 of the scan: the authors' affiliation is the National Bureau of Standards (X1's second author carries a footnote mark the scan does not explain) |
| US government work | XR2 | NASA Technical Note D-7812; NTRS: distribution PUBLIC, `GOV_PUBLIC_USE_PERMITTED` |

All of these permit the extracted text to be committed (with attribution for CC BY; see
`README.md`).

# `test/fixtures/pdf/` — PDF corpus manifest

**This is a manifest directory, not a fixture set.** Every other directory under
`test/fixtures/` holds recorded API responses for one `SourceId` (or `llm/`), as
`docs/07` §2.2 declares, and tests replay them. Nothing here is replayed and no test
reads this directory. It records *which* PDFs the full-text spikes were measured on,
so that a measurement can be repeated on byte-identical files.

**No PDF is committed, and none may be.** Publisher and preprint PDFs are third-party
content (`docs/09` §4.4 covers licensing and redistribution); even the CC BY files are
kept out so the repository never becomes a redistribution channel, and file 5 is not
openly licensed at all. The files live outside the repository, on the developer's
machine, and are identified here by SHA-256.

Added by `P0-T18` (spike `V-8b`). `R-19b`'s 40-PDF Phase 3 corpus (`docs/11` §3,
`docs/06` §4.3) will be indexed in this same file.

## Where the files are

- Files: `D:\ZoteroDev\pdfs\` (developer machine, outside the repository).
- Attached as **stored** attachments (`Zotero.Attachments.importFromFile`, link mode
  0) in the **dev** library only — data directory `D:\ZoteroDev\data`, profile
  `D:\ZoteroDev\profile` (`.env`, `P0-T08`) — each under its own parent item, all in
  the collection `P0-T18 PDF corpus` (collection ID 2, key `VUZ4EVHS`).
- Attached 2026-09-15 on Zotero 10.0.2. All five were fully indexed by Zotero's own
  import path (`Zotero.Fulltext.getIndexedState` = 3, `INDEXED`; indexed pages = total
  pages) without `indexItems` being called by us.
- Item IDs are local to that data directory. If it is recreated, re-attach the files and
  update the table; the hashes are the stable identity.

## The corpus

| # | File | Layout class (as supplied → as measured) | Identity | Licence | Bytes | SHA-256 |
|---|---|---|---|---|---|---|
| 1 | `1-single-column_plosone_2023.pdf` | single-column publisher → **single-column** (0/10 pages two-column) | PLOS ONE (2023), "Improved USER cloning for TALE assembly and its application to base editing", DOI `10.1371/journal.pone.0289509`, PMC10403120 | CC BY | 1,618,550 | `e9329c58c9ee21d86af33b69e8f38360ee6ff97f5f81a8eea3d0579c206f6321` |
| 2 | `2-two-column_genomebiol_2025_s13059-025-03586-7.pdf` | two-column publisher → **single-column** body with a left sidebar on page 1 (0/16 pages two-column). **Not a two-column PDF.** | Genome Biology (2025) 26:115, "Predicting adenine base editing efficiencies in different cellular contexts by deep learning" (title confirmed from the PDF's first-page heading and its Info `Title`), DOI `10.1186/s13059-025-03586-7` | CC BY | 3,112,824 | `96bdf8b01ee50067b82d0e2eafcb657af3d29e6aefc9b7827955d323fa1ac2d3` |
| 3 | `3-arxiv_2609.11877.pdf` | arXiv preprint → **single-column** LaTeX (0/51 pages two-column) | arXiv:2609.11877v1 [q-bio.QM], "Biology-in-the-loop: Amortized Adaptive Hit Discovery in CRISPR Screens" | CC BY 4.0 | 3,931,943 | `adcaaa5b7f9bd0e3bc1f91d94d26c8d4924c5c0b3064b6625c01ba92c6eaef28` |
| 4 | `4-biorxiv_2026.02.06.703857.pdf` | bioRxiv preprint → **single-column** Word manuscript (0/63 pages two-column) | bioRxiv, "Regenerative base editing enables deep lineage recording", DOI `10.64898/2026.02.06.703857` | CC BY | 5,435,032 | `b7953bda5fa777011f25e9c7cfa81cfb2a63e225d5bfc94b2f5f5f326d19f448` |
| 5 | `5-scanned_bmj_1955_PMC1981541.pdf` | scanned → **scanned page image with an embedded OCR text layer**, **two-column** (1/1 page) | BMJ (3 Dec 1955), p. 1391, Correspondence, PMC1981541, indexed as "Penicillin". The one page carries three letters; the relevant one is headed "Fatal Overdose of Penicillin". | Free to read, **not** CC — local testing only | 255,324 | `18e6ab63a64a127c771e199e523d0f15d78677a7aafbec0c3b4280f07d520ca4` |

"As measured" is `scripts/spike-structured-text.ts`'s column test on the block
rectangles `Zotero.PDFWorker.getStructuredDocumentText` returns: a page counts as
two-column when at least two body rectangles sit wholly in each half of the page and
full-measure rectangles are rare.

## Dev-library items

| # | Parent item ID / key | Parent type | Attachment item ID / key |
|---|---|---|---|
| 1 | 5 / `LD4IEEAK` | `journalArticle` | 11 / `CARU38EN` |
| 2 | 6 / `L2P2QRS8` | `journalArticle` | 12 / `AXSL3JYK` |
| 3 | 7 / `FL9VS865` | `preprint` | 13 / `WIII3JEZ` |
| 4 | 8 / `HTWIQBBH` | `preprint` | 14 / `3NA4CNIZ` |
| 5 | 9 / `AU9VDG4E` | `journalArticle` | 15 / `ZT5EKHTJ` |

`Zotero.PDFWorker.getStructuredDocumentText` and `getFullText` take the **attachment**
ID; both throw on the parent ID.

## Known gap

The corpus has **no born-digital two-column publisher PDF**: file 2 is single-column,
and the only two-column page is file 5's 1955 scan. `V-8b`'s column-order question was
therefore answered on one OCR page only. A true two-column publisher PDF (for example
a Cell, PNAS, Nature-family or Elsevier research article) should be added as file 6
through `P0-T18`'s human gate before the answer is relied on.

## Checking a file

```sh
sha256sum D:/ZoteroDev/pdfs/*.pdf
```

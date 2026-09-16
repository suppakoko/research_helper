# `test/fixtures/pdf/` — PDF corpus manifest

**This is a manifest directory, not a fixture set.** Every other directory under
`test/fixtures/` holds recorded API responses for one `SourceId` (or `llm/`), as
`docs/07` §2.2 declares, and tests replay them. Nothing here is replayed and no test
reads this directory. It records *which* PDFs the full-text spikes were measured on,
so that a measurement can be repeated on byte-identical files.

**No PDF is committed, and none may be.** Publisher and preprint PDFs are third-party
content (`docs/09` §4.4 covers licensing and redistribution); even the CC BY files are
kept out so the repository never becomes a redistribution channel, and files 5 and 6
are not openly licensed at all. The files live outside the repository, on the
developer's machine, and are identified here by SHA-256.

Added by `P0-T18` (spike `V-8b`). `R-19b`'s 40-PDF Phase 3 corpus (`docs/11` §3,
`docs/06` §4.3) will be indexed in this same file.

## Where the files are

- Files: `D:\ZoteroDev\pdfs\` (developer machine, outside the repository).
- Attached as **stored** attachments (`Zotero.Attachments.importFromFile`, link mode
  0) in the **dev** library only — data directory `D:\ZoteroDev\data`, profile
  `D:\ZoteroDev\profile` (`.env`, `P0-T08`) — each under its own parent item, all in
  the collection `P0-T18 PDF corpus` (collection ID 2, key `VUZ4EVHS`).
- Files 1–5 attached 2026-09-15, files 6–7 attached 2026-09-16, both on Zotero 10.0.2.
  All seven were fully indexed by Zotero's own import path
  (`Zotero.Fulltext.getIndexedState` = 3, `INDEXED`; indexed pages = total pages)
  without `indexItems` being called by us.
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
| 6 | `6-two-column_arxiv_1512.03385.pdf` | born-digital two-column control → **two-column** (11/12 pages; page 612 × 792 pt, left column x 50.1–286.4, right x 308.9–545.1, page 4 is left-column figure only). **Not publisher-typeset:** an author-built CVPR-format LaTeX preprint (`pdfTeX-1.40.12`), so it evidences the *geometry* of two columns, not a publisher's typesetting pipeline — see file 7 for that. Not biomedical. | arXiv:1512.03385v1 [cs.CV], 10 Dec 2015, He, Zhang, Ren & Sun, "Deep Residual Learning for Image Recognition"; later published as CVPR 2016, pp. 770–778 | **arXiv perpetual non-exclusive licence** (`arxiv.org/licenses/nonexclusive-distrib/1.0/`), **not** CC — local testing only | 819,383 | `1e0651b6810ecba34a3dbc5b5b0209226f889004607c1f203540a48d64e5a93a` |
| 7 | `7-two-column_pnas_2024_du-et-al.pdf` | two-column publisher → **two-column** (5/11 pages; page 584.784 × 783 pt, left column x 36–283.8, right x 301.4–550.4). Page 1 mixes a full-measure title/abstract band with a two-column band; pages 3, 4, 6 and 7 are figure-only; page 8 has too little body text for the test. Publisher-typeset (`Adobe InDesign 19.3`) and biomedical — **this is `P0-T18`'s "two-column publisher" class.** | PNAS (2024) 121(48):e2416827121, Du *et al.*, "In vivo photoreceptor base editing ameliorates rhodopsin-E150K autosomal-recessive retinitis pigmentosa in mice", DOI `10.1073/pnas.2416827121` | CC BY 4.0 (stated on the PDF's own first page) | 9,454,063 | `5ff054e23b5f9408a27551960823dd7ce6fc62a0876b26e7fbb021c9dacb577c` |

"As measured" is `scripts/spike-structured-text.ts`'s column test on the block
rectangles `Zotero.PDFWorker.getStructuredDocumentText` returns: a page counts as
two-column when at least two body rectangles sit wholly in each half of the page and
rectangles wider than 48 % of the page are rare. The script prints the page width and
the body x-range for every page, so the classification can be checked rather than
believed — that is how file 2, supplied as two-column, was found to be single-column.

## Dev-library items

| # | Parent item ID / key | Parent type | Attachment item ID / key |
|---|---|---|---|
| 1 | 5 / `LD4IEEAK` | `journalArticle` | 11 / `CARU38EN` |
| 2 | 6 / `L2P2QRS8` | `journalArticle` | 12 / `AXSL3JYK` |
| 3 | 7 / `FL9VS865` | `preprint` | 13 / `WIII3JEZ` |
| 4 | 8 / `HTWIQBBH` | `preprint` | 14 / `3NA4CNIZ` |
| 5 | 9 / `AU9VDG4E` | `journalArticle` | 15 / `ZT5EKHTJ` |
| 6 | 16 / `V67I34QT` | `preprint` | 17 / `RU3SNXFX` |
| 7 | 18 / `TB65WL5P` | `journalArticle` | 19 / `Z3CMIKJG` |

`Zotero.PDFWorker.getStructuredDocumentText` and `getFullText` take the **attachment**
ID; both throw on the parent ID.

Item 16 is a `preprint` because that type — and not `conferencePaper` — carries
`repository`, `archiveID` and `genre`, the fields that actually describe an arXiv
deposit; `setField` throws on a field the type does not own, so the type is chosen
from `Zotero.ItemFields.getItemTypeFields` before any field is written.

## Column-order measurement (2026-09-16)

Files 6 and 7 close the gap this file recorded on 2026-09-15 — the corpus then had no
born-digital two-column PDF, because file 2, supplied as two-column, measured as
single-column. Both APIs were measured on the same block pairs, because Phase 3 may
use either (`docs/06` §3.3.5):

| # | Two-column pages | Bands | `getStructuredDocumentText`, band-wise | page-wide | flat `getFullText`, band-wise |
|---|---|---|---|---|---|
| 5 (1955 scan) | 1/1 | 2 | 0/52 | 0/110 | 0/52 |
| 6 (arXiv, born-digital) | 11/12 | 17 | **0/481** | 0/968 | **0/455** |
| 7 (PNAS, publisher) | 5/11 | 21 | **0/306** | 111/1563 | **0/300** |

A "right-before-left pair" is a left-column and a right-column rectangle where the
right one is emitted first — in `content[]` order for the structure, in character
offset within the page's slice of the `\f`-delimited string for the flat text.

**The band matters.** A page can stack independent flows, and pairing every
right-hand rectangle with every left-hand one then calls correct layout an error. All
111 page-wide "violations" on file 7 are one such artefact, and they resolve to a
single structural fact: on page 11 the two-column front matter (acknowledgements,
affiliations, author contributions) sits above a reference list that the worker emits
as **one** `list` block with 72 rectangles spanning both columns. The two flows do not
overlap vertically — the front matter ends at y 696, the list starts at y 635 — so
banding separates them and the count is 0. Bands are the maximal vertical intervals
the page's body rectangles cover.

## Remaining gaps

- **One publisher two-column file, one publisher family.** File 7 is a single PNAS
  article; file 6 is an author-built LaTeX preprint, not a publisher PDF. Nothing here
  measures an Elsevier, Wiley, Springer, Nature-family or Cell two-column layout, and
  `R-19b`'s 40-PDF Phase 3 corpus (`docs/11` §3, `docs/06` §4.3) is what is supposed to
  span them; it will be indexed in this same file.
- **No non-English and no multi-column table-heavy file.**
- **Column order is measured, section accuracy is not.** That is `R-19b`'s gate, not
  this card's.

## Checking a file

```sh
sha256sum D:/ZoteroDev/pdfs/*.pdf
```

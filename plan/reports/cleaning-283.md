Report: plan/00 §6 item 283(a) and 283(b). Fixes the cleaning pass, rebuilds the 40 IMRaD fixture texts, and measures scan-quality signals.

VERDICT
Done. Nothing is committed.

(a) Cleaning pass:
- The W2-style stacked footer is now removed. The heads/feet step (step 2) now repeats in rounds until a round deletes nothing.
- The reference cut now applies on all 40 papers. It used to apply on 33.
- Each of the 7 failures was diagnosed. There were four causes, and each was fixed as a general rule, never per paper.
- No section was lost on any of the 40 papers.
- The fixtures were rebuilt inside Zotero 10.0.3. `extract --check` gave 40 of 40 byte-identical, then `candidates` and `validate` ran. imradFixtureManifest passes.
- 19 texts and their sidecars changed. candidate-headings.json went from 6,552 to 6,371 candidate lines; 13 papers' counts changed.
- **The labelling page must be rebuilt** from the new candidate-headings.json. The text hashes changed on 19 papers. The owner has not labelled, so nothing is lost.

(b) Scan-quality signals:
- **No signal separates all three scans (X1, X2, XR2) from the other 37.** Only X1's OCR text is garbled. X2's and XR2's OCR reads as clean prose.
- **The stray-space split share separates X1 alone, by two orders of magnitude:** 5.00 % of its words, against at most 0.05 % on any of the other 39.
- No product behaviour changed.

Why each paper was skipped (diagnosed on the raw attachment text):
- X1: the heading is "6. References", and a section number was not allowed. Once matched, the cut is 5.1 %, which is under the 8 % floor.
- X2: the heading "References" matched, but the list is 13 entries = 1.7 %, under the 8 % floor.
- E2 (Cell Press): "REFERENCES" sits at 48.2 % of the text, outside the last-45 % window. STAR+METHODS follows it, so a cut to the end would have deleted the Methods.
- A4 (AIP style): there is no heading at all. The list starts "1E. J. Heller…".
- W1, W2, W3 (Wiley): there is no heading; the list starts "[1] …". The supplementary step (step 7) happened to remove it from "Supporting Information".
- W2 footer: every page ends "Adv. Sci. 2023, 10, 2301332 © 2023 The Authors…" and then "2301332 (n of 9)". One round only ever saw the outer line.
- E2 has five stacked furniture lines per page: ll / OPEN ACCESS / iScience 27, … / iScience / Article.

PER-PAPER BEFORE → AFTER
Columns:
- raw = attachment text in UTF-16 characters.
- removed = raw minus the final text: old pass (HEAD) → new pass.
- heads = running-head lines removed.
- ref = the reference cut.
- supp = characters removed by the supplementary step.
"Body lost" was checked by comparing, line by line, everything the new pass removes and the old one kept. Every one of the 40 papers: no section lost.
- A1 30436: 5685→5685, unchanged
- A4 50950: 25→9527 (+9502). ref none → 18.7 % numbered_list. Only the reference lines went; the text now ends with Appendix C's equations.
- A5 68596: 20527→20527, unchanged
- A6 33586: 4159→4159, unchanged
- B1 102376: 19397→24560 (+5163). heads 64→128: the bioRxiv licence lines. The line-number gutter is now stripped on 2 more pages; those are real line numbers.
- B2 61237: 20002→22382 (+2380). heads 24→72, licence lines; gutter on 2 more pages.
- B4 68290: 25035→27700 (+2665). heads 52→104, licence lines. supp 273→68.
- E1 58325: 14162→14193 (+31). 13 bare page numbers.
- E2 65281: 140→14500 (+14360). heads 17→83: the five stacked lines. ref none → 19.0 % heading_before_body, stopping at STAR+METHODS. supp 0→1154, from SUPPLEMENTAL INFORMATION to the declarations, stopping at STAR+METHODS. The Methods are kept.
- E4 39193: 5056→5096 (+40), page numbers
- E5 60334: 12174→12273 (+99), "Articles" running head
- E6 51785: 7861→8269 (+408), running title
- I1, I3, I4, I5: unchanged (8365, 11365, 5407, 6388)
- N1 95912: 16246→16858 (+612), "Article https://doi.org/…" line
- N2 34029: 9574→9778 (+204), same line
- N3 63280: 13259→13718 (+459), same line
- N6, O2, O3, O4, O5, P1, P3, P5, P6: unchanged
- S1 74097: 10313→11587 (+1274), running head
- S2 59029: 11183→11656 (+473), running head
- S4, S5: unchanged
- W1 37635: 6429→7388 (+959). heads 9→36 (ChemistryOpen / Research Article). ref → 14.3 % numbered_list. supp 6150→721.
- W2 38777: 10970→11646 (+676). Footer gone (heads 17→26). ref → 23.8 % numbered_list. supp 10401→1315.
- W3 64294: 11241→12171 (+930). Footer gone. ref → 14.9 % numbered_list. supp 10379→845.
- W4, W5: unchanged
- X1 32690: 40→1697 (+1657). ref → 5.1 % heading (numbered, short list).
- X2 59254: 67→1053 (+986). ref outside_band 1.7 % → applied.
- XR2 21430: 2665→2665, unchanged

On the 33 papers already cut, the cut starts at the same line, and none of those cuts is bounded.

One content side effect that is not furniture: on one W2 page, once its 2 footer lines are gone, 10 numeric table rows reach step 3's 50 % gutter share and lose their first cell. This is step 3's existing weakness on tables; I recorded it and did not change it.

SCAN SIGNALS (item 283(b))
How the signals were measured:
- Measured on the final 40 texts, with the script at C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\signals\signals.mts. The output is signals-out.tsv in the same folder.
- The word list is the en-US Hunspell dictionary that Zotero 10.0.3 ships in its omni.ja, with affixes expanded (129,510 forms). I used it locally only and did not ship it.

| Signal | X1 / X2 / XR2 | A4 | Others (37) | Separates? |
|---|---|---|---|---|
| Current probe (letters+digits+punctuation share) | 0.822 / 0.830 / 0.840 | 0.816 (lowest of all 40) | 0.816–0.866 | no |
| Letter share | 0.757 / 0.725 / 0.785 | — | 0.704–0.806 | no |
| Split by stray space, same line | 5.00 % / 0.00 / 0.00 | 0.03 % | 0.00–0.05 % (31 of 37 at 0.00) | **X1 only, about 100× margin** |
| Same, counted across line breaks | — | — | up to 1.11 % (W4) | no; these are the word\nword splits of step 4 |
| Out-of-dictionary words | 10.69 / 2.08 / 1.78 % | 15.17 % | 3.15–15.17 % | no |
| Out-of-dictionary, 4+ letters | 14.34 / 2.61 / 2.73 % | — | 3.36–16.70 % | no |
| Dictionary plus words found in 2 other papers | 9.83 / 1.94 / 1.71 % | 12.25 % | 1.80–12.25 % | no |
| Single letters other than a and I | 5.95 / 2.27 / 1.06 % | 10.80 % | 0.20–10.80 % | no |
| Letter-digit tokens | 0.62 / 0.19 / 0.10 % | — | 0.24–5.05 % | no |
| Mean word length | 4.61 / 4.83 / 5.18 | 4.60 | 4.60–6.21 | no |
| Junk characters ~ \| ^ ` ¬ | 0.02 / 0.33 / 0.00 % | — | 0–0.57 % | no |
| Capital inside a lower-case run | 0.21 / 0.19 / 0.00 % | — | 0–1.44 % | no |
| Letter for a digit ("O.95") | 0.05 / 0.02 / 0.00 % | — | 0–0.22 % | no |

The full 40-row table is in signals-out.tsv. The owner chooses which signal, if any, replaces the probe thresholds.

FILES CHANGED WITH DECLARATION NAMES
- src/pipeline/summarize/clean.ts:
  - New: BODY_RESUMES_HEADING, SHORT_LIST_MIN_LINES, REFERENCE_YEAR_LINE_SHARE, NUMBERED_LIST_MIN_RISES, NUMBERED_LIST_MIN_RISE_SHARE, type ReferenceCutBasis, findNumberedReferenceList.
  - New private helpers and constants: CITATION_YEAR, FIRST_ENTRY, ENTRY_NUMBER, removeRunningHeadsOnce, lineEnd, nonEmptyLines, yearLineShare, bodyResumesAt, cutSpan, removeSpan.
  - Changed: REFERENCE_HEADING (optional Arabic or Roman section number); removeRunningHeads (rounds); truncateReferences (the five forms); dropSupplementary (stops at a methods heading); ReferenceCut's applied branch gains `basis` and `bounded`. The module header is updated.
- test/unit/pipeline/clean.test.ts: added the helper `entries` and 3 new describe blocks (stacked furniture; reference widenings (1)–(5); bounded supplementary cut), 19 tests built from synthetic text. No existing test was changed. 55 tests in total.
- scripts/imrad-fixtures/extract.spec.ts: now also writes `<id>.raw.txt`, the attachment text before cleaning (via getAttachmentText), into the scratch work directory only, never the repository. This is needed to measure before/after offline. The header comment is updated.
- test/fixtures/imrad/text/*.txt and *_meta.json: 19 papers rebuilt (A4, B1, B2, B4, E1, E2, E4, E5, E6, N1, N2, N3, S1, S2, W1, W2, W3, X1, X2).
- test/fixtures/imrad/candidate-headings.json: regenerated.
- manifest.json: unchanged; it holds no text hashes.
- test/fixtures/imrad/README.md: 19 cells of the "Candidate lines / lines" column, and the totals sentence (6,371; 15–760; median 91; 71–938 lines), with a dated note.
- docs/06 §4.1: see below.

SHARED-FILE EDITS QUOTED
docs/06 only, as four exact-string appends, each re-read before the edit: at the end of step 2, step 6, step 7 and step 8. No other shared file was touched.

DOC NOTES ADDED (quoted, docs/06 §4.1)
- Step 2: "**Corrected 2026-10-25 (owner, `plan/00` §6 item 283(a)):** collect and delete in **rounds, repeated until a round deletes nothing**. Publishers stack page furniture — W2 (Wiley) ends every page with `Adv. Sci. 2023, 10, 2301332 © 2023 The Authors…` and then `2301332 (3 of 9)`, E2 (Cell Press) with five lines (`ll`, `OPEN ACCESS`, `iScience 27, 110552, …`, `iScience`, `Article`) — and a single round sees only the outermost line, so every inner line survived. Each round uses the same 60 % share of the pages with text, the same two-page minimum and the same edge-only rule for bare page numbers; a line becomes a candidate only once the furniture outside it is gone (`removeRunningHeads`, `src/pipeline/summarize/clean.ts`)."
- Step 6: "**Corrected 2026-10-25 (owner, `plan/00` §6 item 283(a)):** the rule above skipped the cut on 7 of `P3-T20`'s 40 papers, for four different reasons, and it is widened in five places — each a shape, never a paper (`truncateReferences`, `src/pipeline/summarize/clean.ts`). (1) **A numbered heading counts**: an Arabic (`6.`, `6`) or Roman (`VI.`) section number may precede the word (X1: `6. References`). (2) **The cut stops where the body resumes**: when a whole-line methods heading (`Methods`, `Online Methods`, `Materials and Methods`, `Methods and Materials`, `Experimental`, `Experimental Section`, `Experimental Procedures`, `STAR★Methods` in any punctuation, optionally numbered) follows the heading, only the span up to that heading is deleted and the rest is kept, because some publishers print part of the body after the list (E2, Cell Press: `REFERENCES` at 48 % of the text, then `STAR+METHODS` — a cut to the end would have deleted the Methods). (3) **A heading before the last 45 %** is used only in that bounded form — when such a body heading follows it **and** at least two thirds of the non-empty lines between them (at least three) carry a year (1800–2099); a heading before the tail with nothing of the kind after it is still never cut. (4) **The 8 % floor yields to an unmistakable short list**: below 8 %, the cut still applies when at least three non-empty lines follow the heading and **every** one carries a year (X1 5.1 %, X2 1.7 %: two scanned NBS reports whose lists hold 10 and 13 entries, on 4 and 9 lines); a heading followed by anything else under 8 % is still kept whole. (5) **A list with no heading at all** (A4, AIP style; W1–W3, Wiley, where step 7's `Supporting Information` cut happened to remove it) is found as a numbered list: the last line in the last 45 % that starts with entry 1 (`[1]`, `(1)`, `1.` before a capital, or `1` fused to an author's initial as in `1E. J. Heller`) and carries a year, accepted only when at least two thirds of the non-empty lines from there to the end (at least three) carry a year and the entry numbers found at line starts and after a full stop rise at least five times, in at least 80 % of consecutive pairs. Rules (2)–(5) apply only where the rule above found nothing it could cut, or (for (2)) to bound a cut it found; the 60 % ceiling binds every form. `ReferenceCut` now says which form applied (`basis`). **Measured 2026-10-25 on the 40 texts (raw `attachmentText` dumped by the extraction run, both passes applied offline, then the fixtures rebuilt inside Zotero 10.0.3 and reproduced byte for byte):** the cut now applies on 40 of 40 (33 before) — X1 and X2 by forms (1)/(4), E2 by (3), A4, W1, W2 and W3 by (5); on the 33 it already cut, it starts at the same line and none is bounded. 19 texts changed; every line the new pass removes and the old one kept was compared, and outside the seven papers they are all page furniture (bioRxiv licence lines, Nature's `Article https://doi.org/…`, running titles, bare page numbers), so no section was lost. One side effect is not furniture: on one W2 page, once its two footer lines are gone, ten numeric table rows reach step 3's 50 % gutter share and lose their first cell — step 3's existing weakness on tables, recorded, not changed."
- Step 7: "**Corrected 2026-10-25 (owner, `plan/00` §6 item 283(a)):** this cut, too, **stops at a whole-line methods heading** (step 6's correction (2)) and keeps the rest: once step 6 has taken E2's list out from in front of `STAR+METHODS`, E2's `SUPPLEMENTAL INFORMATION` line lands in the last 45 % and a cut to the end deleted the whole Methods (22,195 characters, measured on the first version of this fix). Appendices are not a body heading for either cut: an appendix after the reference list went with the cut before this correction and still does (A5's proofs, W5's tables)."
- Step 8: "**Measured 2026-10-25 (`plan/00` §6 item 283(b); the 40 `P3-T20` texts as rebuilt with the corrected steps 2, 6 and 7; nothing in the product changed).**" It goes on to give:
  - the eleven signals, and the word list (the Hunspell en-US list shipped in Zotero 10.0.3's omni.ja, 129,510 forms, read locally and not shipped);
  - "**No signal separates the three scans (X1, X2, XR2) from the other 37**, because only X1's text layer is garbled";
  - out-of-dictionary 2.1 % and 1.8 % for X2 and XR2, lower than every born-digital paper's 3.15–15.17 %;
  - A4 at 0.816 on the probe's own measure, lowest of all 40;
  - "**The stray-space split share separates X1 alone, by two orders of magnitude**: 5.00 % … against at most 0.05 % on any of the other 39 (A1, 2 of 3,659 words; 33 of the 39 at 0.00 %)";
  - counted across line breaks it no longer separates (W4 1.11 %, A5 0.87 %, S4 0.68 %);
  - every other signal puts a born-digital paper beside or beyond X1;
  - "The 0.80 and the two `PROPOSAL` thresholds are unchanged; which signal, if any, replaces them is the owner's choice (item 283(b))."
  The full text is in the file.

NEW STRINGS (en-US)
None.

RUNS
- Baseline: `extract --check --keep-work` with the raw dump gave 40 of 40 byte-identical. Running the HEAD cleaning pass offline over the raw dumps reproduced 40 of 40 committed texts, so the raw dumps are faithful.
- Rebuild: `extract --keep-work` gave 40 passed and "items left behind: 0". The raw text was identical to the baseline on 40 of 40. The 40 rebuilt texts equal the offline new pass on 40 of 40.
- `extract --check` gave 40 of 40 byte-identical. `candidates` was idempotent (same hash). `validate` reported "test/fixtures/imrad/ is consistent".
- Before every Zotero run, the MUTANT grep was empty and no `.scaffold\test\profile` process was running (excluding my own query).
- npm run typecheck: 0. npm run lint:check: 0. npx eslint .: 0.
- npm run test: unit 85 files, 3,973 passed; contract 2 files, 40 passed.
- npm run build: 0, with typings/*.d.ts hashes identical before and after. There were 53 "missing in locale: ko-KR" warnings, which are the pending Korean strings.
- Integration, `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`, with the pre-flight before each run:
  - 22:53–22:56: 194 passed
  - 22:56–23:00: 194 passed
  - 23:00–23:04: 194 passed
  Typings were unchanged across all three runs. No mutant was seen before or after, and no test-profile process is left.
- Mutants on clean.ts: 12, each marked /* MUTANT id */, restored by copy and checked by hash (4f667dd9…). All were killed:
  - M1: rounds off
  - M2: heading number prefix off
  - M3: tail cut not bounded
  - M4: before-tail year check off
  - M5: short-list override off
  - M6: every → some
  - M7: the "at least five rises" check off
  - M8: entry-1 year check off
  - M9: list year-share check off
  - M10: tail window off for the numbered list
  - M11: step 7 not bounded
  - M12: separator before the body heading dropped
  M7, M8 and M9 first survived; I added three tests and they were then killed.
- Final `grep -rn MUTANT src test addon typings scripts`: empty.

CONTRADICTIONS/FINDINGS
1. The labelling page must be rebuilt from the new candidate-headings.json (item 283(a) names it). I did not touch it.
2. Step 3 (gutter) damages one W2 table: 10 rows lose their first cell. This was triggered by the fewer lines on that page and is recorded in docs/06. A table guard for step 3 is a possible follow-up.
3. An appendix after the reference list is still deleted with it, as before: A5's "A Proofs" and W5's "APPENDIX A" tables. I deliberately did not add appendices to the body headings, so as not to change papers outside the seven. This is the owner's choice.
4. The gutter rule now fires on 2 more pages each of B1 and B2 (real bioRxiv line numbers, correct) and on 6 fewer B4 pages. The B4 change has no content effect beyond the licence lines.
5. Running-head rounds share the old rule's hazard: a body line that differs from another only by digits, at the edge of 60 % or more of the pages, is deleted. The synthetic tests had to use word-distinct bodies for this reason. On the 40 real papers no body line was hit.
6. A numbered list with no heading whose entry 1 has no year (for example "in press") is not found. This is conservative by design.
7. P3-T20 finding 4 (the OCR probe flags nothing) now has its explanation: X2 and XR2 have good OCR text, so "scan" and "bad text" are different classes.

WHAT I DID NOT CHECK
- Papers outside the 40, or any other Zotero version.
- Whether the owner wants appendices or tables kept.
- Korean review: there are no new strings.
- The labelling page itself.
- I did not commit.
- plan/00 and plan/07 are the other agent's files and were not touched.

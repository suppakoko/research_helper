# P3-T41 part 1 — Detector improvement, measured on the first set (tuned)

(Saved at D:\KIST\projects\research_helper\plan\reports\P3-T41-part1.md. Part 1 only: the detector
change and the first-set measurement. The one held-out measurement, step 4 onward, is the
coordinator's, after this change is committed.)

**Findings.** The section detector was changed to recover the losses listed in `plan/00` §6 item
365(b), using only the owner's heading-name rule (item 364(a), (b), (e)) and general heading-shape
rules. No rule names a paper or a line. Measured on the first set (`test/fixtures/imrad/`, 34 papers
with a normal paper structure), the share of body characters put in the right section rose from
**68.00 % to 93.61 %** (1,380,235 of 1,474,524). **That figure is tuned:** the changes were made
while looking at these same papers' labels, so it overstates real accuracy. Without the four heading
names taken from the owner's one-paper-at-a-time answers in item 364(e), the figure is 92.35 %. The
validation flag (`IMRAD_DETECTOR_VALIDATED`) no longer comes from the first-set figure at all. It
now comes only from a held-out record, which is empty (`null`) until the one held-out measurement is
made, so the flag is still false and the product still summarizes without section labels. Nothing
was run on the held-out set.

## 1. The first-set figure, before and after

Both runs: `npx tsx scripts/measure-imrad.ts`, the detector with no PDF outline, scored by the
unchanged rules of `docs/06` §4.3's note of 2026-11-10.

| Group | Papers | Before (2026-11-10, not tuned) | After (2026-11-13, tuned) |
|---|---:|---:|---:|
| **Overall** | 34 | **68.00 %** | **93.61 %** |
| springer | 4 | 80.07 % | 94.19 % |
| nature | 3 | 76.19 % | 77.24 % |
| elsevier | 4 | 75.14 % | 93.87 % |
| wiley | 5 | 63.59 % | 100.00 % |
| plos | 4 | 84.81 % | 99.89 % |
| oup | 4 | 76.95 % | 98.64 % |
| ieee | 3 | 0.00 % | 100.00 % |
| arxiv | 2 | 34.40 % | 62.85 % |
| biorxiv | 2 | 98.33 % | 100.00 % |
| us-government | 3 | 33.83 % | 93.29 % |
| 2 columns | 23 | 62.66 % | 93.68 % |
| 1 column | 11 | 78.76 % | 93.46 % |
| published | 30 | 67.10 % | 94.68 % |
| preprint | 4 | 74.32 % | 86.05 % |

- Papers without a normal paper structure, reported apart: 48.70 % → 77.90 %.
- Table ceiling (the table applied at the owner's own heading positions, for information only):
  79.92 % → 96.06 %.
- No paper now declares failure. Before, seven did (I1, I3, I4, I5, A1, A4, W5).
- Exit status of the script: 1 before, 0 after. On the first set 0 now means "not below the
  recorded figure and above the bar", not validation; the printout says so in its last sentence.

**Two papers went down**, both from following the owner's rules as written:
- E5 93.33 % → 78.25 %. Its boxed panel "Research in context" is now a boundary labelled other
  (item 364(a) names it other). The methods text resumes after the panel at a line that is not a
  heading (item 364(e)), which the detector cannot find.
- P6 100 % → 99.61 %. "Ethical approval" sits inside a Methods section that is the paper's last
  main heading, so the rule "back matter after the last main heading" (item 364(b)) reads it as
  back matter.

Every per-paper figure is in `docs/spikes/imrad-accuracy-report.md`, last section.

## 2. What changed in the detector

All in `src/pipeline/summarize/imrad.ts`. Written first into `docs/06` §4.3 as the note "Changed
2026-11-13", with a pointer under the original table.

| Loss in item 365(b) | Change | Source of the rule |
|---|---|---|
| Roman-numeral and pipe numbering | One numbering prefix is removed before any table row is tried (`HEADING_NUMBERING`, case-sensitive): Arabic with optional decimal parts and period, upper-case Roman I–XXXIX with its period, either one with an optional pipe. Letter labels ("A.") are not removed. Rows now match the heading's name (`headingName`). | 364(a): "numbering and case are ignored" |
| Decimal subsection numbers | Covered by the same prefix ("5.1", "2.1."). | 364(a) |
| Heading followed straight away by a numbered subheading | The line scan's next-line rule also accepts a next line starting with a digit. | heading shape |
| No row for back matter | Two rows labelled other, tried last. Row 1 (the item 364(a) names: Acknowledgements, Appendix, Availability and requirements, Author summary, Research in context, Significance statement, Highlights, Nomenclature) is a boundary anywhere. Row 2 (the item 364(b) back matter: funding, author contributions, competing interests, conflict of interest, declarations of interest, data or code availability or sharing, ethics) counts only after the last main heading (`dropEarlyBackMatter`). An other boundary never counts toward the two-section minimum. | 364(a), 364(b) |
| "Experimental Results" read as methods | "Experimental" is methods only alone or as "Experimental section / method(s) / procedure(s)"; "Experimental result(s)" is in the results row. | 364(a) |
| Section names outside the table | Added: "related works" (plural), "literature review", "STAR Methods" (any symbol between), "Experimental method(s)", "Experimental procedure(s)", "&" read as "and"; and from 364(e)'s per-paper answers "Implementation", "Theoretical model", "Data analysis". | 364(a), 364(e) |
| (also, from `P3-T22` defect (f)) running-text lines starting with a table word | A candidate line's name must start with an upper-case letter. | heading shape |

The structure path (PDF outline) gets the same table. Its "section level" still counts only IMRaD
labels, and an outline entry at the section level is a boundary wherever it stands, so the
back-matter position rule does not apply to it. The structure path is not measured by the fixtures.

**Not changed:** the 90-character bound and the no-final-period rule; the limitations row; the
abstract row; JATS handling; the scoring rules, the bar and every label. No "References" row,
because the owner does not mark References.

**Contribution of the item 364(e) names:** removing "Literature review", "Implementation",
"Theoretical model" and "Data analysis" gives 92.35 % (S1 64.59 %, E4 78.32 %). So 1.26 points of
the 93.61 % come from names the owner gave for single papers. The coordinator may drop them; the
other changes stand without them.

## 3. How the validation flag stays false

- `ImradMeasurement` now has a `set` field: `"first"` or `"heldout"`.
- `IMRAD_MEASUREMENT` is the first-set record: 2026-11-13, `set: "first"`, 34 papers, 1,474,524
  counted, 1,380,235 correct. The regression test pins it, and its comment says it is tuned and
  validates nothing.
- New `IMRAD_HELDOUT_MEASUREMENT: ImradHeldoutMeasurement | null = null`. Its type requires
  `set: "heldout"` and a `commit` string.
- New `detectorValidatedBy(record)`: true only when the record is not null, its `set` is
  `"heldout"`, it counts at least one character, and it is at or above the 85 % bar.
- `IMRAD_DETECTOR_VALIDATED = detectorValidatedBy(IMRAD_HELDOUT_MEASUREMENT)`, so it is false
  today. It no longer reads `IMRAD_MEASUREMENT` at all.
- New unit tests in `test/unit/pipeline/imradAccuracy.test.ts`: the flag equals
  `detectorValidatedBy(IMRAD_HELDOUT_MEASUREMENT)`; the held-out record is null and the flag false; a
  first-set record at 100 % does not validate, nor does the committed `IMRAD_MEASUREMENT`; a held-out
  record validates at exactly 85 % and not at 84.9 % or with no characters. The existing degrade
  switch test (flag false → `sectionAware: false`, no sections) still passes.
- For step 5, the coordinator fills `IMRAD_HELDOUT_MEASUREMENT` with the held-out run's date, counts
  and commit, then removes the "is false while no held-out measurement is recorded" test.
  `scripts/measure-imrad.ts` does not yet check a held-out run against that record (the card's Files
  row for step 5); it still prints the held-out figure against the bar only.

## 4. The seal

Nothing in `test/fixtures/imrad-heldout/` was opened, listed or read by me, and no command was
given `--set heldout` or `--final-heldout-measurement`. The diagnostic script I used
(`scratchpad\diag\diag.mts`) calls `loadCorpus()` with its default, the first set. `npm run test`
runs the existing `imradHeldout.test.ts`, which reads the held-out manifest and hashes and runs no
detector on the held-out text (its detector is a test double that must never be called); my tests do
not touch the set. The integration suite's entries are `test/integration` only, which does not touch
the held-out set.

**One thing to know:** the brief asked me to read `plan/00` §6 item 375, and item 375(a) names some
held-out headings ("Previous Literature", "Background and Related Work", "Related work", "Data and
Methods", "Data", "BASIC CONCEPTS", "6 Limitations", "STAR★METHODS", symbol lists, abbreviations).
I added no row because of them: every added name is from item 364 (or is a plural of an existing
row), and I left out "Symbols", "Abbreviations", "Data" and the limitations row, which only item 375
or my reading of it would have motivated. Two rows do happen to cover held-out names: "Related work"
was already in the table, and "STAR Methods" is in item 364(a). The coordinator should weigh this
when reading the held-out figure.

## 5. Files changed

All under D:\KIST\projects\research_helper. All are in the card's Files list.

| File | Change |
|---|---|
| src/pipeline/summarize/imrad.ts | `HEADING_NUMBERING`, `headingName`, the table (11 rows), `isBackMatterHeading`, the candidate rule, `dropEarlyBackMatter`, the structure path's section level and back-matter flag, `IMRAD_MEASUREMENT` (tuned, `set`), `IMRAD_HELDOUT_MEASUREMENT`, `detectorValidatedBy`, `IMRAD_DETECTOR_VALIDATED`. |
| scripts/measure-imrad.ts | Module note and the printout's last sentence say a first-set figure is tuned and does not validate. No change to scoring or the held-out refusal. |
| test/unit/pipeline/imrad.test.ts | Table cases for every new name and numbering shape, no-match cases ("Experimental Computational", "A. Results", "References"), `headingName`, `isBackMatterHeading`, the two candidate-rule changes, three line-scan tests (Roman headings, back matter before and after the last main heading, other boundaries and the gate). Two old cases ("Acknowledgements", "Data availability" match no row) changed to `other`; row count 9 → 11. |
| test/unit/pipeline/imradAccuracy.test.ts | `set` in the synthetic record; the old "derives from the record" test replaced by four held-out-derivation tests and a "records the first set" check. |
| docs/06-summarization-and-trend-report.md | §4.3: pointer under the table; the dated note "Changed 2026-11-13". |
| docs/spikes/imrad-accuracy-report.md | Pointer at the top; new last section with the tuned figures and the remaining losses. |

Nothing was committed. The card State is unchanged.

## 6. Checks

All commands ran as `NODE_USE_SYSTEM_CA=1 env -u OPENROUTER_API_KEY …`.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:check` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run test` (unit) | 139 files, 7,804 passed, 105 skipped, 0 failed |
| `npm run test` (contract) | 6 files, 84 passed, 28 skipped, 0 failed |
| `npm run build` | exit 0 |
| Typings hashes before and after the build | identical: global 020956c7…, i10n a787e3c9…, prefs a9aa2d93…, prompts 4480d796…, zotero-augment cf994969… |
| `npx tsx scripts/measure-imrad.ts` | exit 0, 93.61 %, not below the record |
| Integration run 1 (15:40–15:46) | 355 passed, 0 failed, exit 0 |
| Integration run 2 (15:46–15:53) | 355 passed, 0 failed, exit 0 |
| Integration run 3 (15:53–15:59) | 355 passed, 0 failed, exit 0 |

Before each integration run the case-sensitive grep for `/* MUTANT` over src, test and scripts was
empty and no zotero.exe with `.scaffold\test\profile` on its command line was running (checked by
`scratchpad\t41-integ.sh`). No Zotero process is running now.

## 7. Not done

- **Steps 4–6 of the card** (the one held-out measurement, its record, the held-out check in
  `scripts/measure-imrad.ts`): the coordinator's, after committing.
- **Losses left, because a fix would name a paper:** the unheaded introductions of N1, N2, N3 and N6
  and E5's resumed methods; N6's run-in "Results …" heading in a 423-character line; the arXiv
  papers' own chapter titles (A1, A4, A5, A6); XR2's report headings; subsections whose names are
  table names (S1 "Experimental results", O2 and E2 "Limitations of …").
- **No mutation sweep** was run on the new rules.
- **The structure (outline) path** is still not measured; the fixtures hold text only.

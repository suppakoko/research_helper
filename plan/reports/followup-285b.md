Report: plan/00 §6 item 285(b). The OCR probe is replaced by the stray-space split share. Nothing is committed.

VERDICT
Done in the code, the documents and the tests. The integration suite is NOT clean, for a reason outside this item, so read that part first.
- Integration: 15 tests failed, the same 15 in each of the 3 runs. All 15 are in the search dialog and the preferences pane, and they fail because the screen shows Korean where the test expects English. The test Zotero starts in Korean on this machine (its log line: "Zotero.locale ko-KR; intl.locale.requested (default)"). Until the coordinator added the 147 Korean strings during this round, those messages had no Korean text and fell back to English. None of the 15 touches anything this item changed. Every test of the part this item changed passed in all 3 runs.
- The threshold is **above 1 % of words, and only in a body of at least 250 words**.
- It warns `ocr_suspected` and never demotes.
- On the 40 papers it warns on X1 only: 242 of 4,844 words, 5.00 %. That figure was measured inside Zotero 10.0.3 as well as offline, and the two agree.

One decision the brief did not foresee: the measurement's definition needs a word list. A split counts only when the two halves joined are a word and at least one half is not. So the product now reads the word list the measurement used, Zotero's own en-US Hunspell dictionary inside Zotero's omni.ja, at `resource://gre/dictionaries/en-US.{aff,dic}`. The plugin ships no word list. If the dictionary cannot be read, the probe judges nothing and never warns.

Why 1 %: X1 is at 5.00 % and every other paper is at most 0.05 % (A1, 2 of 3,659 words). 1 % is 5 times below X1 and 20 times above the worst clean paper. The midpoint on a log scale would be 0.5 %; 1 % leans toward fewer false alarms, because a missed mild scan only loses a warning, while a false warning marks a good paper. With only one garbled paper in the set, the exact point is a judgement.

Why a 250-word minimum (yes, one is needed): under 100 words, one chance split already exceeds 1 %, and at A1's rate a 99-word text has about a 5 % chance of one. At 250 words three splits are needed, which a clean text reaches about 4 times in 10,000. 250 words is also roughly the old 1,500 characters. Under the minimum the probe still measures but never warns, so the 3-page test PDF no longer warns at all. The smallest of the 40 papers has 2,639 words (XR2), so the minimum changes nothing on them.

Per-paper values on the 40 (words, splits, share). Every paper is under the threshold except X1:
- X1: 4844, 242, 4.996 %. WARNS (ocr_suspected).
- Papers with any split:
  - A1: 3659, 2, 0.055 %
  - A4: 6229, 2, 0.032 %
  - O3: 11958, 3, 0.025 %
  - E4: 5065, 1, 0.020 %
  - I4: 5311, 1, 0.019 %
  - E2: 6496, 1, 0.015 %
- Zero splits (the other 33):
  - S1 8923, S2 6898, S4 6158, S5 3847
  - N1 10397, N2 3577, N3 6488, N6 5405
  - E1 6295, E5 5671, E6 5702
  - W1 4101, W2 3581, W3 6834, W4 4522, W5 4764
  - P1 6595, P3 6403, P5 4260, P6 6902
  - O2 6859, O4 5441, O5 7317
  - I1 3724, I3 6434, I5 3771
  - A5 6569, A6 4154
  - B1 10191, B2 5095, B4 5569
  - X2 8543, XR2 2639

FILES CHANGED WITH DECLARATION NAMES
- src/pipeline/summarize/clean.ts:
  - Removed: probeOcrQuality, OCR_PROBE_MIN_ALNUM_PUNCT_SHARE, OCR_PROBE_MIN_CHARS, OCR_PROBE_MIN_LETTER_SHARE, OcrProbeFailure.
  - New: OCR_SPLIT_MAX_SHARE (0.01), OCR_SPLIT_MIN_WORDS (250), probeStraySpaceSplits, and the private patterns EDGE_PUNCTUATION, LETTERS_ONLY, LOWER_CASE_WORD, STARTS_LOWER_CASE.
  - Changed: OcrProbe now holds words, splits, splitShare and suspected. cleanFullText takes an optional word list. The module header's step 8 is updated.
- src/pipeline/summarize/wordList.ts (new):
  - WordList.
  - expandHunspellWordList: the measurement's dictionary expansion, rule for rule.
- src/pipeline/summarize/acquire.ts:
  - FullTextPort gains an optional readEnglishDictionary.
  - New private WORD_LISTS and loadWordList: the list is expanded once per port, and a failed read gives no list instead of losing Tier 2.
  - tryTier2 passes the list to the cleaning pass.
  - The log fields ocrAlnumPunctShare, ocrLetterShare, ocrChars and ocrFailed are replaced by ocrWords, ocrSplits and ocrSplitShare.
  - The AcquisitionStageWarning comment is updated.
- src/zotero/fulltext.ts:
  - New: HunspellFiles, readEnglishDictionary, and the private EN_US_AFF_URL, EN_US_DIC_URL, decodeLatin1 and readBytes.
  - zoteroFullTextPort gains readEnglishDictionary. The module header is updated.
  - The files are read with the sandbox's fetch and decoded by the .aff file's SET line (ISO8859-1). The decoding is done here, because the layering rule forbids src/zotero from importing src/pipeline.
- scripts/imrad-fixtures/extract.spec.ts: KEPT_DIAGNOSTICS now keeps the three new log fields.
- test/unit/pipeline/clean.test.ts:
  - New describe blocks for probeStraySpaceSplits (11 tests) and expandHunspellWordList (3 tests).
  - The whole-pass test is split in two. The second shows that the extractor's line-broken "tar / geted" is not counted.
  - The acquireSource block: the warning test now uses a garbled text and a dictionary port, plus two new tests (no dictionary or a failed read; dictionary read once per port).
  - The over-correction guards asked for are covered: a hyphen line break (`experi\nment`, `experi-\nment`, a page break, `experi- ment`), one-letter words (`a sleep`, `widget a widget`), `et al .`, `5 mg` and `bas 5 ic`, a second half starting with a capital, a first half with punctuation, exactly 1 % does not warn, and 249 words do not warn.
- test/unit/pipeline/acquire.test.ts: the contentHash test's comment is corrected and it now expects no warning at all.
- test/integration/zotero/acquireFullText.spec.ts:
  - The module note is corrected.
  - The fully indexed PDF now expects no warning. It expected ocr_suspected (too_short) before; the new rule never warns under 250 words.
  - New test: "reads Zotero's en-US dictionary, the OCR probe's word list (item 285(b))". It checks file sizes 3,074 and 590,727, 129,510 forms, a non-ASCII word decoded correctly, and 2 splits counted in a 10-word sentence.
- test/fixtures/imrad/text/*_meta.json: all 40 sidecars, only `extraction.warnings` and `extraction.diagnostics`. X1's warnings are now ["ocr_suspected"].
  - Rebuilt from an in-Zotero `extract --check --keep-work` run, with a scratch script (C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\p285\sidecars.mts). The script refused unless every text was byte-identical, and checked that every other diagnostic and the column data were unchanged.
  - **All 40 .txt hashes are unchanged (40 of 40 OK against hashes taken before any edit).** candidate-headings.json and manifest.json are unchanged too. `validate` says the set is consistent, and the imradFixtureManifest test passes.
- docs/06: see below.

SHARED-FILE EDITS QUOTED
docs/06 only, as 4 exact-string edits, each re-read immediately before:
- one prefix at the start of §4.1 step 8;
- two appends at the end of step 8 (the decision, then the in-Zotero measurement);
- one append to §13.5's scanned-PDF row.
No other shared file was touched.

DOC NOTES ADDED (quoted, docs/06)
- Step 8, prefix: "*(Superseded 2026-10-25 by the decision at the end of this step: the probe is now the stray-space split share, and the 0.80 ratio and both `PROPOSAL` thresholds are gone.)*"
- Step 8, the decision. It opens: "**Decided 2026-10-25 (owner, `plan/00` §6 item 285(b)).** The probe is now the **stray-space split share** alone, exactly as measured above, and the 0.80 share, the 1,500-character minimum and the 0.60 letter share are gone…". It then gives:
  - the definition (same-line pairs only; "a pair across a line break never counts, because that is step 4's `word\nword`");
  - "above 1 %" and "at least 250 words";
  - the "Why 1 %" and "Why a 250-word minimum" reasoning above;
  - "**The word list is the measurement's:** Zotero's own en-US Hunspell dictionary (`resource://gre/dictionaries/en-US.aff` and `en-US.dic` …) … The plugin ships no word list. When the list cannot be read, the probe cannot judge: it reports no share and never warns. The warning therefore flags a **garbled text layer, not a scan**…"
- Step 8, the measurement: "**Measured 2026-10-25 inside Zotero 10.0.3 (item 285(b)):** the 40 PDFs re-extracted through `acquireZoteroSource` gave the 40 committed texts byte for byte and the same counts as the offline measurement on every paper — X1 242 of 4,844 words (5.00 %) with `ocr_suspected` … none of them warned; reading the two dictionary files took 18 ms and expanding them 50 ms (129,510 forms), once per session."
- §13.5's row: "**Decided 2026-10-25 (owner, `plan/00` §6 item 285(b)):** the probe is the stray-space split share (§4.1 step 8): above 1 % of the words, in a body of at least 250 words, it pushes `ocr_suspected`, still a warning only. It flags a garbled text layer rather than a scan — of `P3-T20`'s three scanned papers only X1, whose OCR is garbled, draws it; X2 and XR2 have clean OCR and draw none."

NEW STRINGS (en-US)
None.

RUNS
- Offline proof that the product counts what the measurement counted: the product code on the 40 texts, with the measurement's dictionary files, gave words and splits equal to the measurement's own logic and to signals-out.tsv on 40 of 40. The dictionary expands to 129,510 forms.
- Inside Zotero, `extract --check --keep-work`: 40 of 40 byte-identical. Every paper's in-Zotero numbers equal the offline ones, and only X1 warned.
- On the final tree (after the coordinator's Korean edits had stopped changing):
  - npm run typecheck: 0.
  - npm run lint:check: 0.
  - npx eslint .: 0.
  - npm run test: unit 86 files, 4,013 passed; contract 2 files, 40 passed.
  - npm run build: 0, with typings/*.d.ts hashes identical before and after (0 missing-locale warnings now).
- Mutants: 21, each marked /* MUTANT id */, run against the clean and acquire unit tests, restored by copy and checked by hash. **All 21 were killed.**
  - In clean.ts:
    - C1: counts across line breaks
    - C2: `>` becomes `>=`
    - C3: no minimum
    - C4: minimum `>=` becomes `>`
    - C5: "one half is not a word" becomes "both halves are not"
    - C6: half condition dropped
    - C7: punctuation reset dropped
    - C8: lower-case start check dropped
    - C9: no reset on a non-word token
    - C10: no null handling when there is no list
    - C11: cleanFullText ignores the list
    - C12: join check dropped
  - In acquire.ts:
    - A1: list not passed to the cleaning pass
    - A2: no per-port cache
    - A3: a failed read propagates
  - In wordList.ts:
    - W1: cross product ignored
    - W2: suffix condition ignored
    - W3: count line not skipped
    - W4: no lower-casing
    - W5: continuation flag kept
    - W6: strip ignored
  - Final `grep -rn MUTANT src test addon typings scripts`: empty.
- Integration (`NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`):
  - A first run at 23:53 gave 184 passed and 11 failed, while the coordinator was still applying the Korean strings. I stopped the chain and killed its leftover Zotero (my own run's processes, started 23:58).
  - After the locale files had been still for 150 s, I rebuilt and ran three times. Each run's pre-flight found MUTANT empty and 0 Zotero processes on `.scaffold\test\profile`:
    - 00:03–00:08: 180 passed, 15 failed
    - 00:08–00:14: 180 passed, 15 failed
    - 00:14–00:19: 180 passed, 15 failed
  - The same 15 each time, all Korean on screen where English is expected: the preferences pane sentence (1); search-dialog import, notice and export (3); results table, EMPTY, banner, OFFLINE, cancel (5); import counts and P1-T43 present rows (5); the completion toast (1); and P2-T36's "PubMed 결과 10건" (1).
  - Every P3-T18 test passed in all 3 runs: the indexed PDF with no warning, and the dictionary test (read 10–16 ms, expanded 47 ms). The l10n spec passed.
  - Typings were unchanged across the runs. No mutant was seen. 0 test-profile processes are left.

CONTRADICTIONS/FINDINGS
1. **The 15 integration failures come from item 284(a)'s Korean strings, not from this item.** The test Zotero starts in Korean on this machine. With real ko-KR entries, the search dialog and preferences render in Korean, and those specs assert English. The likely fix is for those specs to request en-US, as l10n.spec does. That is coordinator or Korean-agent territory, and I did not touch it.
2. The word list was not in the brief. The definition requires one, and the product reads Zotero's own dictionary at run time. Costs: about 65 ms once per session, plus a set of about 130,000 strings kept in memory. The en-US dictionary is shipped in Zotero 10.0.3's GRE omni.ja; other Zotero versions or platforms were not checked.
3. A failed dictionary read is remembered for the session, and the probe then stays silent. This is deliberate (no retry storm) and is recorded in the code.
4. docs/06 §5.4 DR-1 condition 2 still says full text must have "passed the OCR probe". That contradicts the owner's warn-only rule from item 258. I reported it and did not change it.
5. One mutant was not attempted: dropping the "first half is all lower-case after lower-casing" check. It only matters for a script without letter case, so it cannot change the result while the word list holds only cased words.
6. The scratchpad script signals.mts imports the removed probeOcrQuality and will no longer run as written. It is scratch only.
7. A pre-flight written in bash once counted 3 matching processes. Those were my own query's shell processes, which carry the profile string on their command line. A check by process name (zotero*), used for every later pre-flight, showed 0.

WHAT I DID NOT CHECK
- Papers outside the 40, other Zotero versions, macOS or Linux, or a Zotero install without the en-US dictionary.
- Whether the 15 Korean-locale failures pass with this item's changes reverted. I did not run that; the reasoning is in finding 1.
- I did not commit. plan/ files, the Korean files and the dedup scripts were not touched.

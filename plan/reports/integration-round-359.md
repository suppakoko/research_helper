# integration-round-359 — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: Done. The code supports the new English egress sentence, so the sentence and its Korean both went in. All 116 Korean strings from plan/reports/ko-review-336.ftl went in byte for byte. The ko-KR totals read 469 present and 1 absent, as expected. Every check exits 0. Three consecutive full integration runs on the final tree all passed. Nothing failed. Nothing was committed, plan/00 was not edited, and no card was set to DONE.

**1. Host trace for the recommend Find run (by declaration name), and the sentence**

In code:
- **Keyword search.** planKeyword is the only generator that reads `run.input.sourceIds`, the databases chosen in Preferences. It also leaves out openalex, and leaves out semanticscholar unless `run.hasKey`.
- **The other generators ignore `sources`:**
  - planSimilar goes to PubMed through findSimilarForSeeds (elink, then efetch).
  - planForwardCitations goes to Semantic Scholar when keyed. Otherwise it goes to Europe PMC through `ctx.sources.get(EUROPE_PMC)`.
  - planAuthorWatch goes to Europe PMC search.
  - planRecommendations returns "no-key" without a key and sends nothing.
- **Title fill-in.** In recommendPipeline.ts, fillInSurvivors asks [SEMANTIC_SCHOLAR, EUROPE_PMC, CROSSREF] when keyed and [EUROPE_PMC, CROSSREF] otherwise, for untitled survivors only (worthAsking).
- **Abstract fill-in.** backfillAbstracts uses ABSTRACT_BACKFILL_LADDER ["europepmc", "semanticscholar"]. The Semantic Scholar step runs only when keyed.
- **Embeddings.** The vector store exists only when keyed, and fetchEmbeddings also checks resolveApiKey.
- **The key test.** `keyed = deps.semanticscholar.hasUsableApiKey()` is read once in runStages. hasUsableApiKey is local and sends nothing.
- **Registry.** The source registry built in container.ts is not filtered by `sources`.
- **Model call.** The profile call to the model is disclosed separately by research-helper-egress-profile-notice, so it does not belong in this sentence.

In real runs:
- **Full suite, no key.** The recommend run's origin log showed crossref-keyword, arxiv-keyword, pubmed-elink, europepmc-author-watch, europepmc-keyword, europepmc-citations=10, pubmed-efetch-similar, pubmed-esearch=2, pubmed-efetch-keyword and europepmc-doi-lookup. Nothing went to Semantic Scholar.
- **Scratch run with only arXiv chosen.** That run showed arxiv-keyword, pubmed-elink, europepmc-author-watch, europepmc-citations=10, pubmed-efetch-similar and europepmc-doi-lookup. There was no PubMed, Europe PMC or Crossref keyword search, and nothing went to Semantic Scholar. So PubMed and Europe PMC are reached without being chosen.

Result: no host is reached that the sentence leaves out, and no named host is gated by `sources`. The en-US research-helper-search-recommend-egress-sources now reads exactly the owner's sentence, with a comment naming the code it depends on. Its reviewed Korean is in, and a new unit test pins the English line. No existing test pinned the old English word for word.

**2. Insertion count and totals**
- research-helper-mainWindow.ftl: 5 ids.
- research-helper-searchDialog.ftl: 111 ids (43 for the related window, 68 for the recommend window).
- Every review entry is present word for word, exactly once. No "NEEDS REVIEW" stub remains for these ids.
- keys.ts:
  - KO_PENDING_REVIEW is empty.
  - The 116 ids are on KO_PRESENT.
  - KO_DELIBERATELY_ABSENT still holds only research-helper-menu-spike-create-item.
- Totals line: "[P1-T18] ko-KR totals: 469 present, 1 absent; expected 469 / 1".
- The two target-default ids carry the English value and count as present.

**3. Korean layout at a content size of 1019 x 600**
- **Recommend window, profile state, 20 terms:**
  - Find papers is at 44–72. The header holds 432 pixels, which is the room it needs, and ends at 475.
  - The notice lines sit at 343–377 and the sources lines at 382–417. The query label is at 422–439 and the query at 442–459. OK and Cancel are at 559–586.
  - Every notice line, the query and all three buttons are in view without scrolling.
  - The term chips wrap onto 5 lines in Korean, against 4 in English (where the header held 399 pixels).
- **Results state:**
  - The header is 80 pixels and the table box is 226 pixels (results scroll 182–408), the same as English.
  - The notice now sits below the header's edge and is read by scrolling the header. That is the designed behaviour recorded in docs/08 ("the header gives way to the table").
- **Related window's table:**
  - The table boxes are the same as in English.
  - The header's key notice takes two lines (43 pixels, against 22 in English) inside the header's own scroll area (52 high, scroll height 189 against 168).
- **Clipping:** the overflow and crop scan found 0 flagged and 0 cropped labels in every state, in both languages.
- **Screenshots** are in C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round359\ as ko-*.png and en-*.png (opening, profile, results, results-scrolled, related-table).
- **Layout fault, older than this round, not fixed:** in the related window's table state, the import note rh-search-duplicates-group (557–580) runs under OK and Cancel (559–586). English does the same, also at the opening size of 887 x 600, so it is not a Korean fault. A fix would change English geometry, so it is only recorded in docs/08.

**4. What changed, by file**
- addon/locale/en-US/research-helper-searchDialog.ftl: the new egress sentence and a comment naming the code it depends on.
- addon/locale/ko-KR/research-helper-mainWindow.ftl: 5 reviewed entries in place of the stubs, with a review note line.
- addon/locale/ko-KR/research-helper-searchDialog.ftl: the commented stub tail replaced by two blocks (related results, and recommend mode with results) holding 111 entries, a review note and a target-default comment.
- src/i18n/keys.ts: 116 ids moved from KO_PENDING_REVIEW to KO_PRESENT, with dated comments.
- test/unit/i18n/keys.test.ts:
  - The related and recommend groups now assert present, one live Korean line and no stub.
  - New tests cover the two target defaults, the menu entry and the new English sentence.
- test/unit/pipeline/relatedSeed.test.ts: the seed-error test now asserts the owner's Korean and KO_PRESENT.
- test/integration/l10n.spec.ts:
  - The recommend-window tests (P5-T26, P5-T27) now assert that the Korean file holds the owner's Korean.
  - A new test formats all 116 ids from ko-KR alone. It checks for Korean text, checks that the target defaults equal the English, and checks the count of 116.
- plan/06-human-gates.md (G-41): a dated 2026-11-06 count note, including the three-run result.
- docs/08-ui-ux-spec.md (end of §5.4): dated notes on the changed sentence and the code check behind it, the Korean layout measurement, and the related-window overlap.
- docs/05-related-work-discovery.md §7.3 item 9: a dated sub-note on the fill-in hosts and the arXiv-only run.
- Scratch helpers stay outside the repository, in the round359 folder.

**5. Checks**

| Check | Result |
|---|---|
| npm run typecheck | exit 0 |
| npx eslint . | exit 0 |
| npm run lint:check | exit 0 (two test files needed Prettier formatting first) |
| npm run test | exit 0: unit 136 files, 7630 passed, 105 skipped; contract 6 files, 84 passed, 28 skipped |
| npm run build | exit 0; typings hashes match before and after; typings/i10n.d.ts unchanged (a787e3c9…) |
| Integration run 1 (15:04:13) | before: MUTANT grep 0 lines, no test-profile zotero.exe; exit 0 in 336 s; 350 passed, 2 pending; 469 / 1; guard 1210 channels read, none cancelled, away from loopback []; tree hash df14b832182a8019 before and after |
| Integration run 2 (15:10:18) | same pre-checks; exit 0 in 345 s; 350 passed, 2 pending; 469 / 1; guard 1210, none cancelled, away []; hash unchanged |
| Integration run 3 (15:16:44) | same pre-checks; exit 0 in 348 s; 350 passed, 2 pending; 469 / 1; guard 1210, none cancelled, away []; hash unchanged |

All integration runs used NODE_USE_SYSTEM_CA=1 with OPENROUTER_API_KEY removed. Only the name of that variable was read, never its value. No key was written or used. The earlier subset run (measure, arXiv-only and l10n specs) also passed: 27 passed, guard 314 channels read, none cancelled, none away from loopback.

**6. Findings**

The owner's sentence matches the code: only the keyword search follows the databases chosen in Preferences. The similar-papers, citations and author lists, the title fill-in and the abstract fill-in reach PubMed, Europe PMC and Crossref regardless of that choice. Every Semantic Scholar call waits on hasUsableApiKey. The Korean fits the 1019 x 600 window with no clipped or overflowing label. Korean takes one more chip line and one more notice line than English, and the related window's longer key notice scrolls inside its header. Three side notes:
- Korean text breaks lines between syllables inside words. That is left to the owner's judgement.
- An older overlap of the related window's import note under OK and Cancel exists in both languages. It is recorded in docs/08, not fixed.
- An untracked file, plan/reports/fix-358-design.md, appeared at 14:59 during this round. This round did not create or touch it; it appears to come from another agent.

**7. What was not checked**
- A run with a Semantic Scholar key.
- Crossref title fill-in for an untitled survivor in a real run. No recorded run produced one, so that path rests on the code and on the unit test "with no key both title sources are still asked".
- Hosts used by the import step after Find (pmc.ncbi.nlm.nih.gov, the identifier converter, appears only in the import and related paths).
- Korean layout at a larger font size, in high contrast or in dark mode.

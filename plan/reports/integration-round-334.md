# integration-round-334 — report of the executing agent (saved verbatim, 2026-11-02)

VERDICT: The integration round is clean. The last three consecutive runs (4, 5 and 6) each ended with exit code 0 and 254 passed. No source defect turned up: the only two fixes were in specs. Nothing was committed, nothing was marked DONE, and `plan/00` and `plan/08` were not edited. The tree is ready to commit.

**Runs**

Every run was started with the key removed, the `/* MUTANT` grep empty and no test-profile Zotero running. No process had to be killed.

| Run | Result | ko-KR totals line | Longest main-thread gap (NFR-3) |
|---|---|---|---|
| 1 | 252 passed, 2 failed | 350 present, 4 absent; expected 350 / 4 | 75 ms |
| 2 (fixes not yet applied) | 251 passed, 3 failed | 350 / 4; expected 350 / 4 | 177 ms (the third failure) |
| 3 | 254 passed | 350 / 4; expected 350 / 4 | 51 ms |
| 4 (final tree) | 254 passed, exit 0 | 350 / 4; expected 350 / 4 | 70 ms |
| 5 (final tree) | 254 passed, exit 0 | 350 / 4; expected 350 / 4 | 67 ms |
| 6 (final tree) | 254 passed, exit 0 | 350 / 4; expected 350 / 4 | 68 ms |

- **Change after run 6:** one word in `docs/05` ("three runs" became "six runs"). Code, specs and bundles are unchanged since before run 4.
- **NFR-3 in run 2:** `phase1-dod.spec.ts` asserts a stall of at most 100 ms and measured 177 ms. Treated as a flake and left untouched: it appeared in one run of six, and the other five stayed between 51 and 75 ms. It remains a timing assertion that can fail occasionally.

**Static checks and build (after the last code change)**
- `npm run typecheck`, `npx eslint .` and `npm run lint:check` all exit 0.
- `npm run test`: 118 files, 5 859 passed and 105 skipped; contract 6 files, 84 passed and 28 skipped. The 105 skipped are the on-demand grid in `trendScale.test.ts`, and the same grid is named in `plan/reports/P4-T22-fix2.md`.
- `npm run build` exit 0.
- **Typings:** hashes are identical before the build and after run 6. `typings/i10n.d.ts` is byte-identical to its pre-build backup, so the generator did not change the hand edits.

**Fixes, each with its cause**
1. `test/integration/l10n.spec.ts`, the P5-T15 test: it still expected only a `# NEEDS REVIEW` stub in ko-KR, but item 334(f) put the owner's Korean in the file. The title and assertion now expect all the ids in the ko-KR file. No Korean was touched.
2. `test/integration/zotero/recommendLibrary.spec.ts`: it assumed `Gene Editing` came before `cs.LG`, but `getTags()` gives `cs.LG` first. The spec now sorts before comparing.

**Corrections from the coordinator's item 5, all done**
- `docs/07` §12.4 reading 19 has a dated correction.
- `src/bootstrap/migrations.ts`: the comment on `REPORT_DDL` now names the script as a read-only reader. The DDL string is untouched.
- `test/unit/pipeline/trendKorean.test.ts`: `padWords: 729` and `900` are gone. `largestEnglishPad()` finds the size by running the English template, so a template change moves it. The Korean no-room test uses that size and the English-cannot-fit test uses that size plus 1. Both have a 60 000 ms timeout.

**Done-when lines**

The round ran each card's named unit commands. One command covered `recommendProfile itemMapper preprintMapping recommendProfileCall prompts keys provenanceRerun privacyPolicy userPriceStore embeddingStore`: 11 files, 750 passed. For unit-level lines, the mapping from line to test comes from each card's own report and was not re-derived this round.

- **P5-T15, all proved:**
  - Live: "appears for one regular item, is disabled for two"; "is absent while related.enabled is false"; "leaves no item menu and no search window after a disable/enable cycle".
  - `l10n.spec.ts` resolves every new id in both locales.
  - Typecheck, `keys` and the integration suite pass.
- **P5-T18:**
  - The 30-item ranking and `dateAdded` lines pass in the unit command.
  - The hash line is now also proved live: it is stable across reads, and changes when an item is modified or added.
  - The parked spec ran for the first time and passes.
  - The mutation sweep was not re-run this round.
- **P5-T22:**
  - Mock router, strict mode, repair then fallback, no reasoning-effort field and its own "don't ask again": all pass in `recommendProfileCall prompts`.
  - Live `prompts.spec.ts`: the bundled `collection-profile.v1.0.0.md` hash matches (`46c5f3ca…`, also recomputed from the file), `PROMPT_IDS.length` is 13, and `resolveMaxTokens` for `COLLECTION_PROFILE` is 2500.
  - The mutation sweep was not re-run this round.
- **P4-T22:**
  - `trendScale` passes in 39.4 s (under 60 s): 26 passed.
  - That covers both window sizes and the passes checked against the call logs. The 105 grid runs were skipped.
  - Typecheck is clean.
- **P4-T21:**
  - All five lines pass in `trendKorean`, and typecheck is clean.
  - Live for the first time: the `both` run with Export and Copy, the paused notice, the interrupted job, and the Korean stop that saves English.
- **P5-T03 line (e), proved:** typecheck exits 0, and the unit and integration suites pass. The live spec's store tests all pass.

**Measured and recorded (dated 2026-11-02, Zotero 10.0.3)**
- **`docs/08` §6.3, notice crop:** label 1192 of 1192 px, window 1240 px on a 3440 px screen, the same in all six runs. The whole sentence shows.
- **`docs/05` §7.2's note, tags, dates and search:**
  - **Tags:** one fixture item carried four tags. Only the manual tag not spelled as a subject is left out, an automatic tag stays a keyword, and a manual `MeSH*:` tag becomes a major `mesh` subject. An automatic `arXiv:` tag becomes an `arxiv-category` subject.
  - **Dates:** `dateAdded` has the shape `YYYY-MM-DD HH:MM:SS`. It is stored as UTC, because reading it as UTC fell within an hour of the clock on a computer nine hours ahead of UTC.
  - **Search:** one search, on a two-row library, took 1 to 28 ms.

**Still unproved**
- **Notice crop (recorded as unmeasured in `docs/08`):**
  - A screen narrower than about 1 240 px, several collections in one notice, and the Korean sentence were not measured.
  - The check used English and one collection.
  - The sentence crops at its end if the window cannot grow enough. Wrapping it would be a user-interface choice, so it was not changed.
- **Start-time call:** the specs call `announcePaused`, not the real call inside `publishReportWindowCommands.register`.
- **`research-helper-report-stopped-korean`:** still a ko-KR `# NEEDS REVIEW` stub until `G-41`.
- **Resumed `both` runs:** one that ends with no window open tells nobody.
- **Library read:** cost on a large real library is unmeasured; it belongs to `P5-T30`.
- **`P4-T23`'s script:** covered by lint this round but not run.
- **Real provider and gates:** no real provider was exercised, and `G-24` and `G-25` remain open.

**For the owner**
- `plan/reports/P5-T18.md` still asks the owner to confirm that a typed tag is not a keyword.

**Files changed this round** (all under `D:\KIST\projects\research_helper`)
- `D:\KIST\projects\research_helper\test\integration\zotero\recommendLibrary.spec.ts`
- `D:\KIST\projects\research_helper\test\integration\l10n.spec.ts`
- `D:\KIST\projects\research_helper\test\unit\pipeline\trendKorean.test.ts`
- `D:\KIST\projects\research_helper\src\bootstrap\migrations.ts`
- `D:\KIST\projects\research_helper\docs\05-related-work-discovery.md`
- `D:\KIST\projects\research_helper\docs\07-architecture-and-data-model.md`
- `D:\KIST\projects\research_helper\docs\08-ui-ux-spec.md`

The final-tree run logs:
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round-4.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round-5.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round-6.log`

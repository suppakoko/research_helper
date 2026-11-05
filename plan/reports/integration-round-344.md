# integration-round-344 — report of the executing agent (saved verbatim, 2026-11-02)

# Integration round on P5-T11, T12, T13, T14, T20, T21, T23: report of the executing agent (2026-11-05)

## VERDICT

**The round is clean: runs 1, 2 and 3 on the final tree each ended with exit code 0 and 267 passed, 0 failed, 2 pending.** Nothing was committed, no card was set to DONE, and `plan/00` was not edited.

- **One real defect was found and fixed.** Zotero's `case`, `email` and `statute` item types read no title.
- **The coordinator has one decision to make.** Europe PMC answered 2 of 51 on the non-biomedical set, which is past item 339(d)'s line. That set is a stand-in, because no fixture holds a non-biomedical seed's reference list. No Crossref lookup was added.

## Typings hash

The generator reproduces the hand edit. `typings/i10n.d.ts` was rewritten at 19:02:07 by `npm run build` (the file's modified time moved), and its hash did not change.

All five hashes were identical before the build, after it, after the later build, and after run 3:

| File | SHA-256 |
|---|---|
| `global.d.ts` | `020956c7…` |
| `i10n.d.ts` | `f9ae1c05…` |
| `prefs.d.ts` | `a9aa2d93…` |
| `prompts.d.ts` | `4480d796…` |
| `zotero-augment.d.ts` | `cf994969…` |

## The spec as landed

`D:\KIST\projects\research_helper\test\integration\zotero\relatedLibrary.spec.ts` has 5 tests.

**What stopped it compiling:**
- The branded `Doi` type.
- `Items.getAsync`'s `false | Item` return type.
- A bare `Notifier.registerObserver`, which the lint rule refuses, so the spec now uses `notifierRegistration` in a scope.

It was widened beyond the parked draft, because the draft would have passed without proving these lines:

| Proof line | What the spec does |
|---|---|
| `relatedSeedOfItemID`, right library | A real group library, not only the user library. A hard-coded user library would have passed the draft. |
| `undefined` cases | Trashed item, standalone note, child note, linked attachment, unknown id. |
| `readLibraryWorks` | Every type from `Zotero.ItemTypes.getAll()`, 37 of 37 (the draft had 7). Each is read once, each title is read back, and it uses one search. Trash, both note kinds, the attachment and another library's item are left out. |
| Marks | By identifier (`findExisting`, with the DOI upper-cased, and `matchAgainstLibrary`) and by title (an item with no identifier). A record nothing holds gives `null`. |
| Item version unchanged | `version`, the row's `synced`, `clientDateModified` and `dateModified`, and the notifier, each with a real save as its control. See finding 3. |
| Read time | Logged by the spec, not by the product: `libraryIndex` 1 ms, `libraryItems` 2, 7 and 3 ms, on 47 items. |
| `graph.pipelines` holds `related` | Real start: `["searchImport","related","summarize","trendReport"]`. Beyond the brief, a real run on an unknown id ends `failed` with `SEED_UNRESOLVED` and `rh-error-seed-gone`, stopping before any request. |

No assertion was weakened. One test records a measurement only (finding 2).

## Defects

**1. Three item types read no title. This is a product defect, fixed.**
- **Cause:** `item.getField("title")` without its third argument answers `""` for `case`, `email` and `statute`, which store the title as `caseName`, `subject` and `nameOfAct`. A seed of those types would report it has no title, and `readLibraryTermSources` lost the same titles.
- **Fix:** a new private `itemTitle` in `src/zotero/itemMapper.ts`, used by `snapshotZoteroItem` and `readLibraryTermSources`.
- **Tests:**
  - Two unit tests in `test/unit/zotero/itemMapper.test.ts`: a `case` reads its title, and only `title` is base-mapped.
  - The spec's every-type check. It failed before the fix on exactly `["case","email","statute"]` and passes after.
  - The spec also checks the recommend library read.
- **Side effect:** a work of those three types with no identifier and no stored `rh-work-key` now derives a different `hash:` key, because `buildWorkKey` takes the title. A cache entry under the old key would be missed once. I did not measure how many exist.

**2. `l10n.spec.ts`'s error-contract test failed. This is a test gap, fixed.**
- **Cause:** `SeedUnresolvedError` lives in `src/pipeline/related/seed.ts`, so `everyErrorInstance` never made its three keys, yet `ERROR_MESSAGE_IDS` lists them.
- **Fix:** three instances added to `everyErrorInstance`. It reads 26 shipped, none missing. The assertion is unchanged.

**3. A mistake in my own first spec.** `Zotero.DB.rowQueryAsync`'s row cannot go through `JSON.stringify` ("DB column 'toJSON' not found"). The spec now uses `valueQueryAsync`.

## Korean check (step 4)

The three strings were already covered by the general layers, so no string-specific test was added. Evidence from run 3:
- **en-US:** "resolves every declared id…" reads 219 resolved, 0 unresolved.
- **ko-KR pending path:** the exact-gap test passes, with the three ids on `KO_PENDING_REVIEW` and absent from the file.
- **Fallback:** the `ko-KR`, `en-US` chain and a Korean interface each read 0 unresolved.

## Static checks

All were run with the key removed, on the final code. `lint:check` was run again after the document edits.

```
npm run typecheck   exit 0
npx eslint .        exit 0, no output
npm run lint:check  exit 0, "All matched files use Prettier code style!"
npm run test        exit 0
  Test Files  129 passed (129)
       Tests  6758 passed | 105 skipped (6863)
  Test Files  6 passed (6)
       Tests  84 passed | 28 skipped (112)
npm run build       exit 0
```

## Integration runs

Before every run, the `/* MUTANT` grep was empty and no `zotero.exe` was running, so nothing had to be killed. The key was removed for each run.

| Run | Tree | Passed | Failed | Pending | Exit | Duration | ko-KR present / absent |
|---|---|---|---|---|---|---|---|
| Exploring 1 | First spec | 263 | 3 (causes above) | not counted | 1 | not timed | 353 / 4 |
| Exploring 2 | Fixes in, documents not | 267 | 0 | 2 | 0 | about 311 s | 353 / 4 |
| **1** | **Final** | **267** | **0** | **2** | **0** | **330 s** | **353 / 4** |
| **2** | **Final** | **267** | **0** | **2** | **0** | **277 s** | **353 / 4** |
| **3** | **Final** | **267** | **0** | **2** | **0** | **279 s** | **353 / 4** |

- **Failures:** no test needed a repeat for load. The three failures in exploring run 1 were reproducible causes and were fixed.
- **Final tree:** the hash of `src`, `test`, `addon`, `scripts` and `typings`, `d2c468d2…`, was the same before each of the three runs and after run 3.
- **Pending:** the same 2 in each run, namely the real PubMed search in `phase1-dod.spec.ts` and the 10 000-item index.
- **Timing:** the `phase1-dod.spec.ts` main-thread gap was 41, 47 and 48 ms.
- **ko-KR:** the 4 absent are the three new strings plus the deliberate fallback fixture.

## Europe PMC measurement (item 339(d))

Each row is one reading. There were 3 requests in all, against the 2 the brief named as a floor: 155 DOIs split at 100 forces 2, and the second set takes 1. All were free, unkeyed `searchPOST` calls through the shipped `lookup` with `research_helper/0.0.2 (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)`. All three answered 200 JSON, with no CAPTCHA or refusal. TLS went through `NODE_USE_SYSTEM_CA=1`.

| Set | Asked | Answered | With a title | With an abstract |
|---|---|---|---|---|
| `work-with-references`, 10.1038/s41586-023-06139-9, *Nature* | 155 | 146 | 146 | 145 |
| Same, first 100 only | 100 | 95 | 95 | 95 |
| Non-biomedical **stand-in** | 51 | 2 | 2 | 2 |
| Stand-in without the 21 book parts | 30 | 2 | 2 | not split out |

- **Line crossed?** Not on the biomedical seed (95 of 100). **Yes on the stand-in** (2 of 51, against about 10 of 51 when "fewer than about 20 of 100" is scaled).
- **The brief's premise did not hold.** `work-with-references` is a real recorded Crossref fixture, not Semantic Scholar. It is also the only fixture in `test/fixtures/crossref` with a `reference` member, so no non-biomedical seed's reference list exists to ask about.
- **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313):** the stand-in is 51 DOIs filtered from six recorded Crossref result lists (computer vision, language models, graph networks, physics, humanities book parts). Works whose title or journal names biology or medicine, and peer-review reports, were removed. **It is a set of works, not one seed's references**, and the filter is mine.
- **Supporting detail:**
  - The 2 answered are both IEEE, one each from the focal-loss and spatial-pyramid lists.
  - Inside the biomedical seed's list, the machine-learning DOIs also went unanswered: 0 of 6 under `10.48550` and 0 of 2 under `10.1109`. The other unanswered DOI is one under `10.1016`.

## Files changed

All are under `D:\KIST\projects\research_helper\`.

| File | Why |
|---|---|
| `test\integration\zotero\relatedLibrary.spec.ts` (new) | Step 3 |
| `test\integration\l10n.spec.ts` | Defect 2 |
| `src\zotero\itemMapper.ts` | Defect 1 |
| `test\unit\zotero\itemMapper.test.ts` | Defect 1's unit tests |
| `src\pipeline\shared\relatedFetch.ts`, `requestBudget.ts` | Step 5, comments only. Both headers now say `planRelatedSeeds` has no shipped caller at present. I also corrected `planRelatedSeeds`' own comment and removed the same false claim from its neighbouring header sentence. |
| `docs\05-related-work-discovery.md` §6.1 | The measurement |
| `docs\07-architecture-and-data-model.md` §6.6 | Title fix, base-named reads, `version` |
| `docs\07-architecture-and-data-model.md` §9.2 | `planRelatedSeeds` correction |
| `docs\13-testing-build-and-release.md` §2.3 | New spec row |
| `plan\06-human-gates.md` G-41 | 353 / 4 |

## Findings

1. **Crossref lookup.** On the stand-in, Europe PMC barely holds non-biomedical works, which puts the definition of done's "still returns useful candidates" at risk for a keyless, non-biomedical seed. The starting value in `docs/05` is unchanged. Item 339(d) names a Crossref `lookup` as the next step, at about 0.25 to 0.5 days by judgement. One recording of a real non-biomedical seed's references would be the stronger reading, and it was not allowed this round.

2. **Other fields lost the same way as the title (not fixed).** Measured in all three runs:
   - A `conferencePaper`'s `proceedingsTitle`, a `bookSection`'s `bookTitle` and a `webpage`'s `websiteTitle` read no `containerTitle`.
   - A `patent`'s `issueDate`, a `case`'s `dateDecided` and a `statute`'s `dateEnacted` read no year.
   - Base-mapping everything is not a safe one-line fix, because a preprint's `repository` is base-mapped onto `publisher`.
   - The effect on title marking is unmeasured. It blocks no finishing condition that I could see (rule 9), so it is recorded in `docs/07` §6.6 only.

3. **"Leaves the item version unchanged" proves nothing alone.** `item.version` read 0 before and after a real save in all three runs, because only a sync moves it. The spec checks the row and the notifier, which do move on a save.

4. **The read time says nothing about a large library.** The figures are from 47 items. Item 342(d) already sends this to `P5-T30`, and the product itself does not log this figure.

## What I did not check

- `P5-T11`, `T12`, `T13`, `T20`, `T21`, `T23` paths in Zotero beyond startup. The related pipeline's real run stops at its first read, so no generator, scoring or marking stage ran in Zotero. `P5-T23` has no path registered until `P5-T25`.
- Any real Semantic Scholar response or key.
- The three new strings on a real screen, because `P5-T16` is not built.
- The two new unit tests against the unfixed code. The integration spec did fail before the fix, but the unit tests were not run that way, and no mutation sweep was done this round.
- How many users' cache entries the new `hash:` key would miss.
- A large library, and a person using the windows.
- Network silence inside the suite. It rests on the suite's existing guards. The spec's `linkFromURL` uses `example.invalid`, the same call as `summarySection.spec.ts`, and I did not capture traffic.

**Key handling:** `OPENROUTER_API_KEY` was removed from every build, test, lint, Zotero and measurement command, except a few standalone `npx prettier` calls. Small helpers (`grep`, `sha256sum`, the process check) did not have it removed either. None of these reads it, and the value was never read or printed. No recorder ran, and no key was used.

## Logs and raw data

All are in `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\`:
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\run-1.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\run-2.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\run-3.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\explore-1.log`
- `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\explore-2.log`
- Measurement script: `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\epmc-measure.mts`
- Measurement results: `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\round344\epmc-result.json`

The parked spec was copied into the tree, not moved, so the original is still at `C:\Users\<user>\AppData\Local\Temp\claude\5d698466ada95f7c\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\relatedLibrary.spec.ts`. It is stale and can be deleted.

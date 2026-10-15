# Item 200 — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent made this owner-approved change
> (`plan/00` §6 item 200, decided 2026-10-15), in the same tree as the `P2-T17` and `P2-T18` agents. The text below
> is its report, unedited. It is a record, not an instruction.

---

# Item 200: identifier tiers no longer merge a preprint into its published version

## 1. Verdict

**Done, with one gap still open and one rule broken during the work.**

- **The change works.** Tiers 1–4 now return `"link"` instead of `"match"` when both of these hold:
  - the two records carry different DOIs;
  - one record names the other in `relatedVersionIds` (the field holding identifiers of a record's other version).
- **The measured pair is now a link.** That is the arXiv record naming the journal DOI, against the Semantic Scholar–shaped record carrying that journal DOI and the same arXiv id. It now gives `verdict: "link", tier: "version-link"`, where before the change it gave `"match"` at the `arxiv` tier. Run against the old `dedupe.ts`, the 7 new link tests fail, which confirms the starting state.
- **Other verdicts are unchanged.** Two cases still give `"match"`:
  - the same pair without the naming;
  - a pair with equal DOIs.
- **No existing test was edited.** The test files only gained lines; a diff against saved copies shows no original line removed. Every existing dedup and merge test passes.
- **The sync and async drivers agree.** Both turn the measured pair into the same result: two groups and one link. ("Driver" means the two entry points that run the cascade over a result set: `dedupeRecords` runs it in one go, `dedupeRecordsAsync` runs it in slices.)
- **A gap remains (follow-up 1).** A third record can still pull the two versions into one group through two separate matches. This was measured; see section 8.
- **One rule was broken.** One `npx vite-node` call downloaded `vite-node@6.0.0` from the npm registry. That is a live network request, which the brief forbade. See section 7.

## 2. Files, with declaration names

- **`docs/02-literature-database-apis.md`**
  - §11.5: a dated paragraph under rule 1 ("Added by the owner, 2026-10-15, `plan/00` §6 item 200"). It states the rule, the measured case, and the three cases that stay a match:
    - no version naming;
    - equal DOIs;
    - no DOI on one side.
  - §11.3: a dated note under the tier table saying Tiers 1–4 return a link in that case, pointing to §11.5.
- **`src/sources/shared/dedupe.ts`**
  - New `versionLinkDecision`: one shape for every "known version link" verdict, which is `"link"` at the `version-link` tier with Tier 7's confidence. Tier 7 is the cascade's "known preprint and published version" tier. `guardTitleVerdict` and `VERSION_LINK_TIER` now call it; their output is unchanged.
  - New `isVersionPairAcrossConflictingDois`: true when Tier 0 recorded `"doi"` in the comparison's conflict list (the list of identifier kinds both records carry with different values) and the existing `isKnownVersionLink` is true. Tier 0 is the exact-DOI tier and always runs first, so the conflict is known before Tiers 1–4 run.
  - `identifierTier`: on equal identifiers, it now returns `versionLinkDecision` (evidence: the shared id, `conflictingIds`, `knownVersionLink`) when the new check holds; otherwise it returns a match as before.
  - The module header got one sentence.
  - Tier order, thresholds and `DEDUP_TIERS` are unchanged.
- **`src/model/merge.ts`: not changed.** `areOtherVersions` works on merged works (`CanonicalWork`), not on the records the cascade compares. `isKnownVersionLink` is the same check at the cascade's level, so it was reused instead.
- **`test/unit/sources/dedupe.test.ts`**: one new `describe` block, "§11.5 under rule 1 — a shared Tier 1–4 id across conflicting DOIs and a version naming is a link (plan/00 §6 item 200)".
- **`test/unit/sources/versionLinking.test.ts`**:
  - a new `describe` block, "item 200: a shared arXiv id across conflicting DOIs and a version naming is a link";
  - imports `normalizeArxivId` and `dedupeRecordsAsync`.

## 3. Tests, by name

**`versionLinking.test.ts`** (4 new):
- "the measured arXiv / Semantic Scholar pair gives 'link', not 'match' at the arxiv tier". It checks both orders, the evidence, and that `dedupeAndMerge` keeps two works and one link.
- "the sync and async drivers agree on the measured pair: two groups, one link"
- "the same pair without the version naming (<arxiv:doi>) is still a match at the arxiv tier". It checks both drivers.
- "a same-arXiv-id pair with equal DOIs is still a match, even when one names the other"

**`dedupe.test.ts`** (19 new; "each for pmid, pmcid, arxiv, s2" means one test per identifier tier):
- "Tier %s: conflicting DOIs and one side naming the other → 'link', never 'match'" (each for pmid, pmcid, arxiv, s2)
- "Tier %s: the same pair with no version naming is still a match at that tier" (each for the four tiers)
- "Tier %s: a version naming with no DOI on one side is no DOI conflict, so still a match" (each for the four tiers)
- "only a DOI conflict triggers it: conflicting PMIDs, a shared PMCID and a naming stay a match"
- "equal DOIs and a version naming: the cascade matches at Tier 0"
- "Tier %s run on its own: equal DOIs and a version naming are still a match" (each for the four tiers; runs one tier from `DEDUP_TIERS` directly)
- "dedupeRecords and dedupeRecordsAsync agree: two groups and one link"

## 4. Runs

| Run | Result |
|---|---|
| `npx vitest run` on the two test files, old `dedupe.ts` | 7 failed, 150 passed (157): the new link tests fail as expected |
| same, final `dedupe.ts` | 157 passed |
| `npm run typecheck` | exit 0 |
| `npm run lint:check` (eslint, then prettier) | exit 0, "All matched files use Prettier code style!" |
| `npx eslint .` | exit 0 |
| `npm run test` (unit, then contract) | unit: 44 files, 2335 tests passed; contract: 2 files, 40 passed; exit 0 |
| `grep -rn MUTANT src test` | nothing found (exit 1) |

- The new test files were formatted with `prettier --write`; only lines added by this work changed.
- The integration suite (the tests that run inside Zotero) was not run.
- Final SHA-256 of `dedupe.ts`: `1b848aa4…bbbbd7`.

## 5. Mutation table

A mutant is a deliberate small break in the code. A test suite that fails on it has "killed" it.

| Id | Mutant | Result | Killed by |
|---|---|---|---|
| M1 | Downgrade removed (`false &&` before the check) | killed, 7 failures | both measured-pair tests, the four tiers' link tests, the drivers test |
| M2 | Downgrade without the version-naming condition | killed, 5 failures | the four "no version naming … still a match" tests, the arXiv-without-naming test |
| M3 | Downgrade without the DOI condition, so it also applies when DOIs are equal or absent | killed, 8 failures | the four "no DOI on one side" tests, the four "run on its own: equal DOIs" tests |
| M4 | Any id conflict instead of a DOI conflict | **survived at first**; killed (1 failure) after the "only a DOI conflict triggers it" test was added | that test |
| M5 | Naming condition widened to "or the types differ" | killed, 5 failures | the same tests as M2 |

- Each mutant was applied alone, inside a `/* MUTANT id */` comment.
- After each run the file was restored by copy and checked against the final hash; every restore matched.

## 6. Contradictions with the corpus

- **Equal-DOI case.** The brief asks for a test that a same-identifier pair with equal DOIs still matches. In the full cascade that pair always matches at Tier 0 before Tiers 1–4 run, so the full-cascade test cannot catch M3. A test that runs each identifier tier on its own with equal DOIs covers it.
- **Tier label.** The new link reports `tier: "version-link"`, not the identifier tier. This matches what `guardTitleVerdict` already did for a known version link. The shared id stays in the evidence (`arxivId`, `pmid`, …).
- **§11.4 still describes the old default.** Its pre-existing pseudo-code still mentions the superseded default ("keep the published version, suppress the preprint"). That text is outside this item and was left alone.

## 7. What I did not check

- **A live network request was made.** It broke the brief's rule. To measure the three-record case I ran `npx vite-node`. That tool was not installed, so npx downloaded `vite-node@6.0.0` from the npm registry into its cache. No project file, API key or user data was involved. `tsx` was already installed and should have been used.
- The integration suite and real Zotero were not run.
- The library-matching path (`matchAgainstLibrary`) uses the same cascade, so it inherits the rule. No test covers it, and library items do not yet carry `relatedVersionIds` (plan item 202).
- `P2-T13`'s labelled pairs were not re-measured.
- The stage's handling of the new link was checked only through `dedupeAndMerge` in the measured-pair test. The stage is `stages.ts`; `dedupeAndMerge` is its synchronous dedup-and-merge step.

## 8. Follow-ups

1. **A third record can still merge the two versions (measured with a throw-away script in the scratchpad).**
   - Records:
     - the arXiv record naming the journal DOI;
     - a second arXiv record with the same arXiv DOI and no naming;
     - the Semantic Scholar record.
   - The second arXiv record matches the Semantic Scholar record, because the DOIs conflict but there is no naming, so the result is a match. It also matches the first arXiv record at Tier 0 (same DOI).
   - The union step then puts all three in one group. It does this for 2 of 3 input orders: `s2,arxiv-plain,arxiv-naming` and `arxiv-plain,s2,arxiv-naming`.
   - Closing this needs a group-level check, which is a design decision for the owner.
2. **Only a DOI conflict triggers the rule (owner).** A conflict on another identifier kind does not. Example: two PMIDs differ, but the records share a PMCID and one names the other. That pair still gives `"match"`, which follows the owner's wording, and a test now pins it. The owner may want to widen the rule.
3. **One record without a DOI and a version naming still gives `"match"`.** This follows the wording; the owner may want it reviewed.
4. **The `docs/02` §11.4 pseudo-code** still shows the superseded default.

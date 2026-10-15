# Item 209 — executing agent's report, saved verbatim

> Saved by the coordinator on 2026-10-16 under `plan/README.md` §6. One agent made this owner-approved change
> (`plan/00` §6 item 209, decided 2026-10-16), in the same tree as the `P2-T13` Part A agent and the follow-up agent
> for items 204, 212 and 217. The text below is its report, unedited. It is a record, not an instruction.

---

# Item 209: a third record no longer merges a preprint into its published version

## 1. Verdict

**Done, with no existing test edited.**

- **The measured triple now stays two works in all six input orders.** The three records are the arXiv record naming the journal DOI, a second arXiv record with the same arXiv DOI and no naming, and the Semantic Scholar record. Every order gives the same result:
  - one work holding both arXiv records;
  - one work holding the Semantic Scholar record;
  - one link between the naming record and the Semantic Scholar record, with no merge.
- **This was confirmed with a throw-away measuring script in the scratchpad, run with `tsx`.** Before the change all six orders merged when the titles are near-identical, and four of six merged when the titles share no title block.
- **The rule is in the docs first.** `docs/02` §11.5 under rule 1 has the dated note "owner, 2026-10-16, `plan/00` §6 item 209", and §11.3 has a short pointer to it.
- **An order-independent rule existed, so no further owner decision was needed.** The rule:
  - A group is checked when one of its records names another as its other version, and the cascade did not judge that pair a match.
  - Such a group is rebuilt from single records, adding its match pairs one tier at a time in §11.3's order (Tier 0 first).
  - All match pairs of one tier are added together. Where together they would put the two versions in one work, none of that tier's pairs inside that would-be work is added.
  - A bridging record therefore joins the version it matches at the earlier, more certain tier. In the measured case the plain arXiv record shares the preprint's DOI (Tier 0) but only the arXiv id with the journal record (Tier 3, across a DOI conflict), so it joins the preprint.
  - A record matching both versions at the same tier joins neither and stays a work of its own.
  - The rebuild reads only the set of records and their pairwise verdicts, never input order.
- **One rule detail was settled from the owner's wording rather than by asking.** The owner said a named pair "must not be merged". So a named pair blocks a join whenever its own verdict is not a match, which includes a pair the cascade calls distinct because a part number differs. Such a pair stays distinct, with no link.
  - The exception: a named pair that is itself a direct match stays one work. These are item 200's documented equal-DOI and no-DOI cases.
- **Thresholds, tier order and pairwise verdicts are unchanged.** No exported declaration of `dedupe.ts` changed, so `P2-T13`'s imports are unaffected.

## 2. Files, with declaration names

- **`docs/02-literature-database-apis.md`**
  - §11.5, under rule 1, after item 200's paragraph: a dated note (owner, 2026-10-16, `plan/00` §6 item 209). It covers:
    - the measured case;
    - the three-step split;
    - which work a bridging record joins, and why;
    - the same-tier tie;
    - order independence and what `groupSplit` means;
    - the cases that never split (a named pair that is a direct match; a pair with no naming, for example rule 1's title link across conflicting DOIs);
    - a distinct named pair: it stays distinct, with no link.
  - §11.3: a dated note under the tier table, pointing to §11.5.
- **`src/sources/shared/dedupe.ts`** (final SHA-256 `aaca5602…f635a5d6d`)
  - New `GroupEdge`: one pair inside a group, by record index.
  - New `tierRank`: a tier's position in `DEDUP_TIERS`.
  - New `partitionAtVersionLinks`: the tier-by-tier rebuild of one group.
  - `dedupeCascade` changes:
    - new `decided` map, so no pair is compared twice;
    - new `linkIndexByKey`;
    - a `decidePair` generator that counts each new comparison and yields every `DEDUP_YIELD_EVERY_COMPARISONS` (250) comparisons, so both drivers share the yield;
    - the group-level check before group assembly. The check reuses `isKnownVersionLink` to find named pairs and `versionLinkDecision` to build the link.
  - Where the split is recorded:
    - The link's evidence gains `groupSplit: true`. A link already recorded for the pair is replaced in place, so there is never a second link.
    - Each new work's `decisions` holds only the match pairs that joined it.
  - The module header and the documentation comment on `dedupeRecords` gained sentences.
- **`src/pipeline/searchImport/stages.ts`: not changed, no change needed.** `mergeGroups` reads `groups` and `links` as before, and the new stage test passes.
  - During the work, a formatting run reported that `stages.ts` had changed on disk. No step of this work wrote to it; it is most likely the follow-up agent's edit.
- **`test/unit/sources/dedupe.test.ts`**: one new `describe` block, "§11.5 under rule 1 — the group-level check: a third record never joins two versions into one work (plan/00 §6 item 209)".
- **`test/unit/sources/versionLinking.test.ts`**: one new `describe` block, "item 209: a third record never joins a preprint and its published version into one work".
- **Both test files only gained lines.** A `diff` against saved copies shows 0 original lines removed (305 lines added to `dedupe.test.ts`, 123 to `versionLinking.test.ts`).

## 3. Tests, by name

**`versionLinking.test.ts`** (4 new). These use the real arXiv mapper's record shape.
- "all six input orders give the same result: the two versions in different works, one link, no merge". This also checks that the link decision is deep-equal across orders, including `groupSplit`.
- "the stage keeps two works in all six orders: the preprint (with its copy) and the journal version, one VersionLink"
- "the sync and async drivers agree in all six orders"
- "without the version naming the three are still one work (the item-200 rule does not fire)"

**`dedupe.test.ts`** (9 new):
- "the measured shape: the bridging copy matches each version, yet all six orders give two works and one link"
- "the bridging copy joins the version it matches at the earlier tier, and the split is in the group's decisions"
- "a record matching both versions at the same tier joins neither, in every order"
- "a genuine three-way duplicate with no version naming still merges into one, in every order"
- "a duplicate joined through a chain, with one pair not a match and no version naming, still merges into one"
- "only a version naming splits: a §11.5 rule 1 title link (conflicting DOIs, no naming) inside a chained group does not"
- "a named pair the cascade calls distinct (series markers differ) is split too, and stays distinct: no link"
- "dedupeRecords and dedupeRecordsAsync agree in all six orders"
- "a split of a large group still yields at most every DEDUP_YIELD_EVERY_COMPARISONS comparisons". This uses 32 records and 496 comparisons, and records the comparison count at every yield.

## 4. Runs

| Run | Result |
|---|---|
| Measuring script (`tsx`), old code, six orders | 6 of 6 merged (near-identical titles); 4 of 6 merged (titles with no shared title block) |
| Same script, final code | 6 of 6: two works and one link |
| The two test files, old `dedupe.ts` | 7 failed, 163 passed (170): the new split tests fail as expected |
| The two test files, final `dedupe.ts` | 170 passed |
| `test/unit/pipeline/searchImport.test.ts` and `test/unit/model/merge.test.ts`, final code, three runs | 138 passed, three out of three |
| `npm run typecheck` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run lint:check` | **exit 1**: eslint passes; Prettier flags two files outside this scope, `scripts/_scratch_dedup_probe.ts` and `scripts/build-dedup-corpus.ts` (created 04:27 and 04:39 today, most likely by `P2-T13` Part A); `prettier --check` on this work's three source and test files passes |
| `npm run test` (unit, then contract) | exit 0; unit: 47 files, 2468 tests passed; contract: 2 files, 40 passed |
| Earlier unit run, mid-work | 1 failure in `importStrategy.test.ts` (ko-KR stub check), caused by the coordinator's Korean strings change; gone in the final run |
| `grep -rn MUTANT src test` | nothing found (exit 1) |

## 5. Mutation table

A mutant is a deliberate small break in the code; a test suite that fails on it has "killed" it.

- Each mutant was applied alone to a copy of the final `dedupe.ts`, marked with a `/* MUTANT id */` comment.
- Each run covered the two test files plus `merge.test.ts` and `searchImport.test.ts`.
- After each run the file was restored by copy and checked by SHA-256; every restore matched.
- Some runs also showed failures in `searchImport.test.ts` tests that do not depend on dedup (item 204 and lookup-only tests). Those came from another agent editing the pipeline during the runs; the same tests passed three out of three on the final code. The "Killed by" column lists only this work's tests and existing dedup tests.

| Id | Mutant | Result | Killed by |
|---|---|---|---|
| M1 | Check removed | killed | both six-order tests, the stage test, earlier-tier, same-tier, series-distinct, large-group tests |
| M2 | Check applied to groups without a version naming (`isKnownVersionLink` filter off) | killed | "a duplicate joined through a chain…", "only a version naming splits…", existing "groups transitively across identifier tiers" |
| M3 | Order-dependent: one pair at a time in input order, first pair wins | killed | both six-order tests, the stage test, earlier-tier, same-tier, series-distinct tests |
| M4 | Async driver skips the check | killed | both "sync and async … all six orders" tests, the large-group test |
| M5 | Tier order ignored: all match pairs in one batch | killed | both six-order tests, the stage test, earlier-tier, series-distinct, large-group tests |
| M6 | The check's own comparisons never yield | killed | the large-group yield test |
| M7 | Existing link not replaced, so a second link is pushed | killed | both six-order tests, the stage test, same-tier, large-group tests |
| M8 | A split group's old match decisions kept | killed | the stage test, the earlier-tier test |
| M9 | Split recorded without `groupSplit` | killed | both six-order tests |
| M10 | Only a link verdict blocks a join (a distinct named pair is left merged) | killed | the series-distinct test |
| M11 | A distinct named pair is reported as a link | killed | the series-distinct test |

## 6. Contradictions with the corpus

- **The owner's wording against item 200's rule.** Read literally, the owner's wording ("a group holding two records naming each other … must not be merged") would split item 200's documented direct matches, where a named pair has equal DOIs or no DOI on one side. The check therefore leaves a named pair that is itself a match alone, and §11.5 says so.
- **`groupSplit` is not order-independent in every set.** Groups, links and verdicts are the same in every input order. The `groupSplit` evidence key records that the matching had joined the two versions in that run.
  - For the measured triple, the matching joins them in all six orders, so the key is identical everywhere.
  - In a set where some order never joins them, that order's link lacks the key. `docs/02` §11.5 states this.
- **"Four of six orders" in §11.5 comes from synthetic titles.** It was measured with a synthetic journal title that shares no title block with the preprint's. The `plan/00` entry says "2 of 3"; item 200's agent tested three orders only.
- **The brief says "one naming the other, the same test `isKnownVersionLink` applies".** The check finds pairs with exactly that function. Only the pair's own cascade verdict decides whether the pair blocks a join (not a match) and whether the pair gets a link (a link).

## 7. What I did not check

- The integration suite (the tests that run inside Zotero) and real Zotero were not run. Per the coordinator's note, re-run and import-summary specs may wait for English text after the Korean strings change; that comes from that change, not this one.
- The library-matching path (`matchAgainstLibrary`) compares one record against the library pair by pair and forms no groups, so the check does not apply there.
- `P2-T13`'s labelled pairs and its corpus were not re-measured.
- No timing was measured for the split. Extra comparisons happen only in a group that contains a named pair which is not a match: every pair in that group is compared once, and decisions already made are reused.
- Comparison counts change in one other case: a group of three or more joined through other records, holding a named pair that matches directly but was never compared. That costs one extra counted comparison. No existing test covers this case, and all existing tests pass.

## 8. Follow-ups

1. **A record matching both versions at the same tier stays a work of its own, with no flag (owner).** That is the simplest order-independent outcome. The owner may prefer a flag for user review between that record and each version, which would need a rule for which pairs to flag.
2. **Within a blocked tier, all pairs of the would-be work are dropped, not only those on the path between the two versions.** So an unrelated duplicate of one version that matches it at that same tier is also left out, and the result is a missed duplicate. A finer rule would remove only the pairs that connect the two versions.
3. **The check covers version naming only.** Two other non-match pairs can still sit in one group through a chain, as before: a §11.5 rule 1 title link across conflicting DOIs with no naming, or any distinct pair. A test now pins this scope ("only a version naming splits…"). The owner may want the check widened.
4. **The title-fuzzy tier ranks by tier, not by confidence (0.80–0.94).** A bridge with two fuzzy matches of different strength is therefore a tie.
5. **`lint:check` fails on Prettier formatting of two files outside this scope:** `scripts/_scratch_dedup_probe.ts` and `scripts/build-dedup-corpus.ts`, most likely `P2-T13` Part A's work in progress.
6. **Item 200's follow-ups 2–4 are unchanged:** only a DOI conflict triggers that rule; a side with no DOI stays a match; §11.4's pseudo-code still shows the superseded default.

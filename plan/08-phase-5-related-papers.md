# Phase 5 — Related papers and recommendations

> **Plan of record since 2026-11-02 (accepted).** Drafted 2026-11-01 under owner decision `plan/00` §6
> item 318(c) ("while `P4-T18` runs, a second agent decomposes Phase 5 into cards as plan work only,
> with no code … a draft as `plan/08-phase-5-related-papers.md`, an independent review, then the
> owner's questions, and only after that does any estimate move"); reviewed the same day; every open
> line decided the same day — the owner's under items 320, 321 and 323, the rest by the coordinator
> under item 313 (item 325 commissioned the pass that applied them) — and the estimate propagated on
> 2026-11-02 to the five places `plan/README.md` §7 names (`docs/11` §1–§2, `plan/00` §1, `plan/05` §2, now a
> pointer here). Every card is `TODO`. The author's report is `plan/reports/phase5-draft.md`; the
> review is `plan/reports/phase5-review.md`.
>
> **Reviewed 2026-11-01** (`plan/reports/phase5-review.md`). Mechanical corrections and two
> re-estimates (`P5-T23` 1.5 → 1.75, `P5-T25` 1.5 → 2.0) are marked "Corrected 2026-11-01 (review)"
> where they were made; the card sum was then **34.0 d** over 30 cards.
>
> **Decided 2026-11-01.** All 36 of the review's open lines are decided, each as recommended; §0.4
> lists them with the card that carries each. Every former `Open — recommended` block now reads
> `> **DECIDED 2026-11-01 (owner, plan/00 §6 item N):**` or `> **DECIDED 2026-11-01 (coordinator,
> under plan/00 §6 item 313):**`, and the three lines the review found settled by the documents read
> `> **Settled by the documents (review 2026-11-01):**`. Where a decision put work in a card, its `Do`,
> `Files` and `Done when` say so, and five cards were re-estimated — `P5-T03` 1.0 → 1.5, `P5-T04`
> 1.0 → 1.75, `P5-T05` 1.0 → 0.75, `P5-T14` 1.5 → 1.75, `P5-T18` 1.25 → 1.5 — and one card was added,
> `P5-T31` (0.25 d, the owner's keyed Semantic Scholar recording, item 323(c)). The card sum is
> **35.75 d over 31 cards**, re-read from the cards by script.
>
> **What this file is.** The task-card decomposition of `docs/11-implementation-roadmap.md` §1
> "Phase 5 — Related papers + recommendations". The card schema, the field rules and the execution
> protocol are [`README.md`](README.md) §4–§5 and bind every card below. A step that depends on a
> document change the card makes first is not executed before that change lands.
>
> **Read by `npm run index:derive`** since 2026-11-01: `scripts/derive-task-index.ts` reads this file
> with `plan/01`–`plan/04` and `plan/07` and builds `plan/00` §4's Phase 5 table from it, as it was
> extended for `plan/07` on 2026-10-26 (item 286). The file is numbered `08` because `05`–`07` are
> taken.

---

## 0. Phase summary

**Goal (docs/11).** Features 2 and 6: related papers from one seed item, and recommendations from a
whole collection.

**Why this phase is different.** Phases 3 and 4 spend the user's money; Phase 5 mostly spends **other
people's rate limits**. Its best signals sit behind Semantic Scholar's 1 request/second keyed limit,
and its unkeyed path is not slow but **unusable** (`docs/02` §6.4: `P0-T22` measured HTTP 429 on 12 of
12 anonymous requests). Three consequences run through every card:

1. **Every generator is optional, and the feature degrades, never fails.** `Promise.allSettled`
   across hosts, serial within a host, a request budget, and a cache checked before the scheduler
   (`docs/05` §9.1). A missing key or a 429 shrinks the candidate set and says so.
2. **The ranking is code, and every row carries its reason.** Scores and reason chips are computed
   client-side from the signals that produced each candidate (`docs/05` §6.2, §7.4; FR-15, FR-47);
   no model decides what the user sees (DECIDED 2026-11-01 (owner, plan/00 §6 item 320(c)): the
   model writes the collection profile only, and `RECOMMEND_RANK` is not built in v1).
3. **Nothing is added to the library without the user ticking it.** Never auto-add (`docs/05` §6.3);
   items already in the source collection are excluded, items elsewhere are marked "in library" and
   unchecked (FR-16, FR-46).

**Schedule and entry conditions.** `plan/05` §0 schedules this decomposition for the end of Phase 4;
the owner pulled it forward (item 318(c)), so §5.2's entry conditions (moved from `plan/05` §2.2 on 2026-11-02) are **not all met**.
Their status on **2026-11-01**, by grep of the documents and the tree:

| §5.2 entry condition | Status 2026-11-01 | Cards it reaches |
|---|---|---|
| Phases 2 and 3 `DONE` | **Not met.** No `plan/reports/` file for `P3-T22`, `P3-T31`, `P3-T37`; `P2-T13` and `P2-T16` Part B wait on the owner's 60-pair sample (item 284(c)). **What Phase 5 takes from them is built:** `fanOut`, `dedupeAndMergeAsync` (`src/pipeline/searchImport/stages.ts`), `importWorks` (`src/zotero/importer.ts`), both `LibraryIndex` types, `LLMRouter`, `withBudget`, `buildEgressDisclosure`, `confirmRunCost` | `P5-T12`, `P5-T22`, `P5-T23`, `P5-T30` |
| V-14 answered | **Met (measurement half).** `docs/02` §6.4 records `P0-T22`'s 12-of-12 429s: the anonymous pool is unusable, not slow. The key application half is closed (`plan/06` `G-03`, closed 2026-09-30) | `P5-T12`, `P5-T23`, `P5-T28` |
| The Semantic Scholar key in hand or written off | **In hand, not entered.** `G-03`'s status note of 2026-10-14: the key arrived, must be **rotated** (one copy was pasted into a chat) and entered only through the pane; `G-26` is open. No agent may hold it (`plan/04` §0.2 item 7). Since 2026-11-01 the owner also records the Semantic Scholar fixtures with it in the process environment (item 323(c); `P5-T31`) | `P5-T29`, `P5-T30`, `P5-T31` |
| `docs/10` §5 Q8 answered | **Met 2026-11-01.** DECIDED 2026-11-01 (owner, plan/00 §6 item 320(a)): no key is required, and without one Phase 5's runs send no Semantic Scholar request. `docs/10` §5 Q8 was marked decided on 2026-11-02; `docs/08` §7.4's "need a key" becomes "work better with a key" on `P5-T16` | `P5-T28`, `P5-T16` |
| Embedding route decided; default provider's capability known | **Met 2026-11-01.** DECIDED 2026-11-01 (owner, plan/00 §6 item 320(b)): SPECTER2 through Semantic Scholar with a key, local TF-IDF word overlap without; no third-party embedding service, so OpenRouter's `Unverified` embedding coverage no longer gates anything. `docs/07` §13 item 5 is answered by `P5-T20` | `P5-T19`, `P5-T20`, `P5-T21` |
| Positive-seed cap probed | **Not met.** `docs/05` §3.3 `Unverified` (2 positives and 1 negative tested) | `P5-T29` measures it; `P5-T21` caps at 15 until then |
| Phase 2's preprint policy settled | **Met.** `G-16` decided 2026-10-14 (keep both, linked, `research_helper/superseded-by-published`), built by `P2-T10`/`P2-T11`; `docs/10` §5 Q2 was marked decided on 2026-11-02. `docs/02` §11.2's `10.1101/` re-minting `Unverified` stands | `P5-T24`, `P5-T27` |
| Per-host limits as settled as they will get | **Unchanged.** `docs/07` §7.3's `www.ebi.ac.uk` row is 5/s "see the unverified note"; `api.biorxiv.org` has no published limit. No card states a number the documents lack | `P5-T07`, `P5-T10` |

**Deliverables (docs/11 §1 Phase 5) → cards.**

| `docs/11` deliverable | Cards |
|---|---|
| Seed resolution (DOI/PMID/arXiv → canonical; title-match fallback with a confidence threshold and disambiguation UI). FR-13, FR-14 | `P5-T05`, `P5-T09`, `P5-T11`, `P5-T15`, `P5-T16` |
| Relatedness gathering: references, citations, source-provided recommendation endpoints; scoring and reason chips. FR-15, FR-47 | `P5-T04`–`P5-T10`, `P5-T31`, `P5-T12`, `P5-T13`, `P5-T14` |
| Related-results review UI with "in library" marking and recency de-emphasis. FR-16, FR-18 | `P5-T15`, `P5-T16` |
| Optional Zotero *Related* linkage. FR-17 | `P5-T02`, `P5-T17` |
| Collection profiler: term/MeSH extraction, optional embedding centroids, editable profile UI. FR-44 | `P5-T18`, `P5-T19`, `P5-T20`, `P5-T21`, `P5-T22`, `P5-T26` |
| Candidate query generation (LLM-assisted with heuristic fallback) and fan-out reuse from Phase 2. FR-45 | `P5-T22`, `P5-T23` |
| Owned-item exclusion and dismissed-candidate persistence. FR-46, FR-49 | `P5-T03`, `P5-T24`, `P5-T25`, `P5-T27` |
| Import into a default `<Collection> — recommended <date>` subcollection. FR-48 | `P5-T27` |
| Types, preferences, tables, request builders, fixtures and the rate-limit layer the deliverables read | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T31`, `P5-T10` |
| The no-key clause of the definition of done, and the live measurements | `P5-T28`, `P5-T29`, `P5-T30` |

**Risks retired.** R-3 fully (`docs/11` §1 Phase 5). `docs/11` §1 and §3's table also listed "R-19
(validated at scale)", but R-19 is PDF full-text extraction (`docs/11` §3), which no Phase 5
deliverable touches; this file claims only R-3. *Updated 2026-11-02: `docs/11` §1's Phase 5 and Phase 2
entries and §3.1's table were corrected that day under dated notes — R-19 is not Phase 5's, and
Phase 2 proved no relatedness fallback, so R-3 is retired here, by `P5-T28` offline and `P5-T30` live.*

**Effort.** **35.75 developer-days over 31 cards** (§1), so the band these cards imply is
**35.75–50 d** (35.75 × 1.4 = 50.05 → 50). Against the scaled 21–29 d `docs/11` published before this
file was accepted, the low end is **+70 %** (35.75 ÷ 21 = 1.70) and 23 % above the scaled top
(35.75 ÷ 29 = 1.23) — above the ~30 % `plan/README.md` §7 calls a signal to re-estimate the phase in
`docs/11`, which was done. *Corrected 2026-11-01 (review): was 33.25 d, 33.25–47 d, +58 %, before `P5-T23` (+0.25 d) and
`P5-T25` (+0.5 d) were re-estimated for work their neighbours assume (notes on both cards).* *Updated
2026-11-01 (decisions): was 34.0 d over 30 cards, 34–48 d, +62 %; the decisions added 1.75 d — `P5-T03`
+0.5, `P5-T04` +0.75, `P5-T05` −0.25, `P5-T14` +0.25, `P5-T18` +0.25 and the new `P5-T31` +0.25 (§3).*
**Propagated 2026-11-02** to `docs/11` §1–§2, `plan/00` §1 and `plan/05` §2. §3 says where the days went
and where the sum is still likely low.

### Phase definition of done

Taken from `docs/11` §1 Phase 5 "Definition of done":

- [ ] From a seed with a DOI, ≥ 20 related candidates are produced with visible reasons, and importing
      10 of them creates exactly 10 items (or links existing ones). (`P5-T14`, `P5-T17`, `P5-T30`)
- [ ] With no Semantic Scholar key, the feature still returns useful candidates and says what a key
      would add. (`P5-T28`'s offline proof; `P5-T30`'s live run)
- [ ] A 30-item collection produces a profile a domain expert judges reasonable (`G-27`), and
      recommendations exclude everything already in that collection. (`P5-T24`, `P5-T25`, `P5-T30`)

And two that the phase needs as hard as the above:

- [ ] Every Phase 5 test passes with **zero** live network calls and **zero** spend (`docs/13` §4);
      live calls happen only in `P5-T04` (Europe PMC, NCBI and Crossref fixture recording, unkeyed),
      `P5-T31` (the owner's keyed Semantic Scholar recording, item 323(c)), `P5-T29` and `P5-T30`.
- [ ] `docs/13` §8.3's eight QA lines each map to a recorded result (`P5-T30`).

### 0.1 Already landed — cite these by name, do not rebuild them

Checked against the tree on 2026-11-01.

| What | Where (by name) | Landed by |
|---|---|---|
| The source contract, with an unimplemented `findRelated` and the `relatedByWork` / `citationGraph` / `lookupById` capability flags | `LiteratureSource`, `RelatedQuery`, `SourcePage`, `SourceCapabilities` in `src/sources/types.ts` | Phase 1–2 |
| "Flag true exactly when `findRelated` exists", held for every registered source | `test/unit/bootstrap/container.test.ts` (`plan/00` §6 item 184) | `P2-T34` |
| Semantic Scholar batch lookup, key header, key probe | `createSemanticScholarSource`, `lookup`, `hasApiKey`, `buildBatchRequest`, `buildPaperRequest`, `encodePaperId`, `SEMANTICSCHOLAR_BATCH_IDS_WITH_ABSTRACT`, `SEMANTICSCHOLAR_SECRET_ID` in `src/sources/semanticscholar/` | `P2-T05`, `P2-T34` |
| Europe PMC DOI lookup; PubMed efetch; Crossref works request | `createEuropePmcSource` (`lookup`); `buildEfetchRequest`, `EFETCH_MAX_IDS_PER_CALL`; `buildCrossrefWorksRequest`, `parseCrossrefWorksBody` | `P2-T03`, `P1-T09`, `P2-T04` |
| PMCID → PMID/DOI | `createPmcidConverter` in `src/sources/pubmed/idConverter.ts` | Phase 2 |
| Per-host limiter and policy table | `HOST_POLICIES`, `SEMANTICSCHOLAR_HOST`, `NCBI_HOST`, `EBI_HOST`, `CROSSREF_HOST`, `createHostLimiterRegistry` in `src/core/rateLimit/hostLimiter.ts` | Phase 1–2 |
| Fan-out over sources, merge, version links | `fanOut`, `FanOutOptions`, `dedupeAndMergeAsync`, `MergedWork`, `VersionLink` in `src/pipeline/searchImport/stages.ts` | `P2-T02`, `P2-T10` |
| Title similarity and its thresholds | `normalizeTitle`, `levSim`, `LEVSIM_DUPLICATE_THRESHOLD`, `LEVSIM_CORROBORATED_THRESHOLD`, `MAX_YEAR_DELTA`, `matchAgainstLibrary` in `src/sources/shared/dedupe.ts` | `P2-T09` |
| Identifier index of the library | `buildLibraryIndex`, `LibraryIndex.findExisting` in `src/zotero/libraryIndex.ts` | Phase 1–2 |
| Preprint detection; recency window | `isPreprintDoi`, `detectServer` (`preprintServers.ts`); `recencyWindow`, `applyClientRecencyFilter` (`recency.ts`) | Phase 2 |
| Abstract backfill | `backfillAbstracts`, `ABSTRACT_BACKFILL_LADDER` in `src/pipeline/searchImport/backfill.ts` | `P2-T12` |
| Import of a previewed result set, "link existing", relation pass | `createSearchImportPipeline` with `SearchImportInput.records` + `works` + `target`; `importWorks`, `DEFAULT_DUPLICATE_POLICY` (`"link-existing"`), `versionPairs` relation pass in `src/zotero/importer.ts`; `findOrCreateCollection(name, libraryID, parentID?)` in `src/zotero/collectionOps.ts` | Phases 1–2 |
| Zotero item → `CanonicalWork`; MeSH tags read back | `fromZoteroItem`, `snapshotZoteroItem`; the `SUBJECT_TAG` reading in `src/zotero/itemMapper.ts` | Phase 1–2 |
| The search window, its modes and its host | `openSearchWindow`, `SearchWindowMode` (already lists `related` and `recommend-from-collection`), `SearchWindowArgs.seedItemID` in `src/ui/dialogs/searchDialog.ts`; `publishSearchWindowHost`, `searchWindowDeps` in `src/bootstrap/registerUI.ts`; `RowMarker`, `toWindowRecords`, `KEY_NOTICE_SOURCE_ID` in `src/ui/viewModels/searchImportViewModel.ts` | Phases 1–2 |
| Collection submenu; no item submenu yet | `collectionMenuOptions`, `SearchMenuCommands` in `src/ui/menus/registerMenus.ts` (its header: "The item-context menu (`main/library/item`) is a later phase's") | Phases 1–4 |
| Pipeline ids, construction and registry | `PipelineId` (has `related`, `recommend`) in `src/pipeline/types.ts`; `buildPipelineSet`, `PipelineConstructionDeps`, `createZoteroSummarizeLibrary` (the Zotero-read port precedent) in `src/bootstrap/registerPipelines.ts`; `PipelineSet` in `src/pipeline/registry.ts`. *Corrected 2026-11-01 (review): `PipelineId` is declared in `src/pipeline/types.ts`, not `registerPipelines.ts` (grep).* | `P1-T16`, `P3-T29` |
| Plugin database, migrations, stores | `installPluginDatabase` (`src/bootstrap/pluginDatabase.ts`); `MIGRATIONS` at version 7 (`src/bootstrap/migrations.ts`), the version pinned to 7 in **four** tests, not `plan/04` §0.2 item 4's two (*corrected 2026-11-01 (review)*: `provenanceRerun.test.ts`, `provenanceStore.spec.ts`, `privacyPolicy.test.ts`, `userPriceStore.test.ts`, by grep); store factories in `src/zotero/db.ts` | Phases 1–4 |
| Cache with per-entry TTL | `Cache`, `CacheSetOptions.ttlMs`, `CACHE_NAMESPACE_POLICIES`, `SOURCE_RESPONSE_LOOKUP_TTL_MS` (`src/core/cache/cache.ts`); `cacheKey`, `sha256Hex` (`keys.ts`) | `P3-T33` |
| LLM path: prompts, JSON, budget, privacy, egress, cost dialog | `createPromptRegistry`, `PROMPT_IDS`, `PROMPT_FILE_NAMES`, `PROMPT_SCHEMAS`; `PROMPT_SOURCE_FILES`, `PROMPT_VERSIONS`, `PROMPT_CACHE_EPOCHS`; `completeJSON`, `validateAgainstSchema`; `withBudget`, `createBudgetGuard`; `allowedInputScope`, `InputScopeKind` (`"metadata-only"`); `buildEgressDisclosure`, `EgressNoticeId`, `mustAskConfirmation`; `estimateRun`; `confirmRunCost` | Phase 3, Phase 4 |
| An optional embedding method on providers (no adapter implements it) | `LLMProvider.embed?` in `src/llm/types.ts` | `P3-T06` |
| Hidden feature preference precedent | `report.enabled` (`reportEnabled` in `PREFS`), item 307(d); *removed 2026-11-02 by `P4-T20`, so the pattern is now read in `plan/07` `P4-T19`'s notes* | `P4-T19` |
| The fixture recorder and replay | `scripts/record-fixtures.ts` (`--source`, unkeyed by construction); `fixtureKey` (`test/support/fixtureReplay.ts`: method, credential-redacted URL and body — no header is hashed), `replayTransport`, re-exported by `test/contract/_transport.ts`; `test/support/*RecordedRequests.ts` | `P1-T11`, `P2-T33` |
| A key read from the process environment for a script, never printed | `SEMANTIC_SCHOLAR_API_KEY` in `scripts/spike-abstract-coverage.ts` (prints only whether a key was sent) — the precedent for `P5-T04`'s keyed recorder path | `P0-T21` |
| Item snapshot fields the mapper does not read today | `SummaryRunItemSnapshot.dateAdded` in `src/zotero/notes.ts` is filled from `item.dateAdded`; `ZoteroItemSnapshot` in `src/zotero/itemMapper.ts` has no `dateAdded` (both grepped 2026-11-01) | `P3-T29` |

### 0.2 Conventions binding on every card in this file

Items 1–10 of `plan/04` §0.2 apply unchanged (strings and `G-41`; one card adds preference rows;
test locations and the three-run rule; migrations appended; one redaction gate; no live requests; an
agent never holds a key; layering; callers named; open lines stop a step). Items 11–18 of `plan/07`
§0.2 apply where a card calls an LLM (budget on every call; ceilings pause; `cacheEpoch` in keys;
prompt text verbatim; the job conventions of item 18). In addition:

19. **No Semantic Scholar request without a key.** DECIDED 2026-11-01 (owner, plan/00 §6 item
    320(a)). A keyless related or recommend run skips the Semantic Scholar generators before any
    request and says what a key adds; it never "tries anyway" against the anonymous pool. That covers
    every path such a run reuses — the recommend keyword generator's `fanOut` source list (`P5-T23`) and
    the abstract fill-in's `AbstractBackfillDeps.selected` (`P5-T12`, `P5-T25`), because the shipped
    `sources` default ticks Semantic Scholar and its adapter's `isConfigured()` is `true` without a key.
    **This rule is Phase 5's only:** the keyword search window still tries Semantic Scholar without a key,
    as `P2-T05` built it, and nothing here changes that.
20. **One scheduler per host, and the budget is per run.** Generators share `HOST_POLICIES`'
    limiters and one `RequestBudget` (`P5-T10`); they degrade by doing fewer seeds, never by
    aborting mid-flight (`docs/05` §9.3).
21. **Cache before the limiter.** Every relatedness response passes through `P5-T10`'s cache with
    `docs/05` §9.2's per-signal TTL, and a 404 / unresolvable ID is cached negatively for 7 days.
22. **Never mix two vector spaces.** A vector carries its model name; cosine is computed only within
    one model (`docs/05` §5.1 item 3). The lexical floor is its own space.
23. **Never loop per paper.** `/paper/batch`, multi-`id` `elink`, Europe PMC OR-queries
    (`docs/05` §9.1 item 1). A `for … await fetch` over papers is a defect.
24. **A mutation sweep ships with every card that adds logic** (the Phase 4 practice, e.g.
    `plan/reports/P4-T12.md`, `P4-T15.md`): mutants marked `/* MUTANT id */`, restored by copy and
    checked by hash, every mutant killed or explained, and `grep -rn MUTANT src test addon typings
    scripts` empty at the end. The estimates below include it.
25. **Features hide until they work** (`docs/11` §0 principle 5; item 307(d)): the item entry and the
    recommend entry stay behind hidden preferences (`P5-T02`) until `P5-T30` passes.
26. **What leaves the machine is `docs/09` §3's rows 2 and 6, as corrected on 2026-11-02** (owner, plan/00
    §6 items 320(d) and 323(a)). The model receives one metadata line per paper (item key, title, year,
    venue, top subject terms) for the collection profile and nothing else; the literature databases
    receive queries, the collection's paper identifiers, dismissed paper identifiers and frequent
    author names. A card that would send anything else stops and reports.
27. **No record of what the user adds or dismisses, beyond hiding** (owner, plan/00 §6 item 323(b)):
    "Not interested" stores a rejection so the paper stays hidden for that collection and can be sent as
    a negative example; nothing records which recommendations were imported (`docs/05` §8.4 is backlog).

### 0.3 What Phase 5 needs from earlier phases

Phase 5 cards list only Phase 5 IDs in **Depends on**, for the reason `plan/07` §0.3 gives. Each card's
**Notes** starts with the earlier cards it needs. **NOT BUILT** marks a card with no
`plan/reports/<card>.md` on 2026-11-01.

| Earlier card | State | What Phase 5 takes from it | Phase 5 cards |
|---|---|---|---|
| `P2-T02`, `P2-T10`, `P2-T12`, `P2-T29`, `P2-T31` | Built | `fanOut`, `dedupeAndMergeAsync`, `backfillAbstracts`, the preview-import path | `P5-T12`, `P5-T17`, `P5-T23`, `P5-T27` |
| `P2-T13`, `P2-T16` (Part B) | **Waiting on owner labels** | Nothing directly; Phase 2's sign-off | `P5-T30` (records it) |
| `P3-T15`, `P3-T16`, `P3-T35` | Built | Privacy scope, egress disclosure, cost dialog, the one price source | `P5-T22` |
| `P3-T22`, `P3-T31`, `P3-T37` | **NOT BUILT** | Nothing Phase 5 calls; `P3-T31`'s measured calibration improves `P5-T22`'s estimate | `P5-T30` |
| `P4-T04` | Built | Nothing: `toDigest` was needed only if the profile call were sent digests, and item 320(d) sends metadata lines | — |
| `P4-T18` | Built 2026-11-01 (`plan/reports/P4-T18.md`; item 322) | It changed `registerPipelines.ts`, `container.ts`, `registerUI.ts`, `docs/07` and `docs/12`, which Phase 5 cards also edit; grep names before editing | `P5-T03`, `P5-T14`, `P5-T22`, `P5-T25` |
| `P4-T20`, `P4-T22` | **In progress** (other agents, item 325, 2026-11-01) | `P4-T20` edits `src/`, `addon/`, `typings/`, `docs/06`, `docs/07`, `docs/08` and `plan/07`; `P4-T22` adds test files only. Phase 5 cards that touch those files wait for `P4-T20`'s commit or take exact-string edits | every card editing `registerUI.ts`, `searchDialog.*`, `docs/07` or `docs/08` |

### 0.4 Decisions of 2026-11-01

The review's 36 open lines (`plan/reports/phase5-review.md`, "Questions — 36 open lines", numbered as
there), all decided as the review recommends. "Owner" decisions cite the `plan/00` §6 item that records
them; "coordinator" decisions were taken under item 313 and may be overturned by the owner. Each card
named carries the decision as a `DECIDED` block or a step.

| Line | Decision | By | Where |
|---|---|---|---|
| 1 | No Semantic Scholar key required; `docs/10` Q8 marked decided; the pane's text becomes "work better with a key" | owner, item 320(a) | `P5-T28`; `P5-T16` (`docs/08` §7.4); `docs/10` Q8 marked 2026-11-02 |
| 2 | No Semantic Scholar request from Phase 5's runs without a key — generators, keyword generator, abstract fill-in; the keyword search window unchanged | owner, item 320(a) | §0.2 item 19; `P5-T11`, `P5-T12`, `P5-T23`, `P5-T25`, `P5-T28` |
| 3 | SPECTER2 with a key, local TF-IDF word overlap without; no third-party embedding service | owner, item 320(b) | `P5-T20`; `P5-T14`, `P5-T19`, `P5-T21` |
| 4 | The model only for `COLLECTION_PROFILE`, once per profile, cached until the collection changes; no `RECOMMEND_RANK` in v1 | owner, item 320(c) | `P5-T22`; §4 |
| 5 | The profile call sends one line per paper: item key, title, year, venue, top subject terms | owner, item 320(d) | `P5-T22`; §0.2 item 26; `docs/09` §3 row 6 corrected 2026-11-02 |
| 6 | New gate `G-43`, modelled on `G-42`: the first real recommendation run's spend is approved first | owner, item 321(a) | `P5-T30`; `plan/06` `G-43` |
| 7 | No reasoning effort sent on the profile call (`docs/12` §18.5 "not assigned"); the acceptance run records the share of the 2 500-token limit used | coordinator | `P5-T22`, `P5-T30` |
| 8 | Literature databases receive queries, collection paper identifiers, dismissed identifiers and frequent author names; `docs/09` §3 row 6 names them; the run window's notice shows them | owner, item 323(a) | `P5-T23`, `P5-T26`; §0.2 item 26; `docs/09` §3 row 6 corrected 2026-11-02 |
| 9 | Title-match threshold: the dedupe cascade's constants; two or more passing → the user picks | coordinator | `P5-T11` |
| 10 | With several items selected the entry is disabled; a tooltip where Zotero shows one | owner, item 321(b) | `P5-T15` |
| 11 | Co-citation not built; backlog | owner, item 321(c) | `P5-T12`; §4 |
| 12 | "Similar" means PubMed's similar articles in v1 and the checkbox says so; a local similarity search over the library and the preprint's published-version offer go to the backlog; `docs/08` §5 corrected | coordinator (the owner may read it as scope) | `P5-T16`; §4 |
| 13 | No year filter by default in the related window; rows outside the three-year window greyed and unticked | coordinator | `P5-T16` |
| 14 | `related.linkToSeed` defaults to `true` | coordinator | `P5-T02` |
| 15 | The seed link goes on new and already-owned imports alike | coordinator | `P5-T17` |
| 16 | No provenance note for related or recommendation imports in v1; the job record keeps the seed or profile | coordinator | `P5-T17` |
| 17 | A related or recommend job ends when its results are shown; import is the search window's; no resume after a restart | coordinator | `P5-T01` |
| 18 | `docs/07` §4.2's `citationGraph` description widened to "relation edges", so item 184's rule and its test stand and PubMed's flag turns on with `P5-T08` | coordinator (the owner may read it as revisiting item 184) | `P5-T08`; `docs/07` §4.2 widened 2026-11-02 |
| 19 | The profile is seen and edited in a panel of the search window's recommend mode, drawn in `docs/08` first | coordinator | `P5-T26` |
| 20 | One recommend pipeline whose input says "profile only" or carries the edited profile; each half its own job; the cost question only when a paid call is due | coordinator | `P5-T25`, `P5-T26` |
| 21 | Profile edits are stored with the profile and re-applied after a rebuild | coordinator | `P5-T01`, `P5-T25` |
| 22 | "Not interested" is per collection | coordinator | `P5-T25` |
| 23 | `docs/05` §7.4's eight scoring signals, "found by" a list | coordinator | `P5-T01`, `P5-T24` |
| 24 | A "preprint (not peer reviewed)" label everywhere; a per-run "Peer-reviewed only" box, off | coordinator | `P5-T24`, `P5-T27` |
| 25 | The Familiar ↔ Exploratory slider is per run, default 25 of 100, not saved | coordinator | `P5-T27` |
| 26 | All five candidate sources, including the frequent-author watch | owner, item 321(d) | `P5-T23` |
| 27 | One Semantic Scholar recommendation request per topic group (at most 4, taken from the budget first), the other sources once, every candidate labelled with its nearest topic | coordinator | `P5-T23` |
| 28 | No held-out evaluation tool in Phase 5; `G-27` is the finishing condition; backlog | owner, item 323(d) | §4 |
| 29 | What the user adds or dismisses is not recorded in v1; "Not interested" only hides | owner, item 323(b) | §0.2 item 27; `P5-T03`, `P5-T25`; §4 |
| 30 | `findRelated` returns a `RelatedPage` with one `RelationEdge` per record; adapter-specific calls reach pipelines as typed adapter instances from `installServices`; `RelatedQuery.strategy` gains `recommendations` and `similar` | coordinator | `P5-T01`; `docs/07` §4.2 declared 2026-11-02 |
| 31 | Stored vectors capped at `docs/07` §9.2's 100 MB; the oldest vectors of papers not in the library are evicted first | coordinator | `P5-T03` (+0.25 d) |
| 32 | `P5-T04` creates the five request builders and records; `P5-T05`–`P5-T09` extend them | coordinator | `P5-T04` (+0.5 d), `P5-T05` (−0.25 d), `P5-T06`–`P5-T09` |
| 33 | The owner records the Semantic Scholar fixtures with the key in the environment, at no cost; the recorder gets a keyed path | owner, item 323(c) | `P5-T04` (+0.25 d), new `P5-T31` |
| 34 | Probe 10, 20 and 50 positives with 10 negatives; keep 15 unless 15 fails | coordinator | `P5-T29` |
| 35 | Two hidden settings, `related.enabled` and `recommend.enabled`, off until `P5-T30` passes | coordinator | `P5-T02` |
| 36 | "Don't ask again" for recommend runs is a record of its own; a confirmation forced by money still opens | coordinator | `P5-T22` |

**Settled by the documents** (the review's removals, not decisions): the draft's lines on library items
outside the collection (FR-46 wins; `P5-T24`), where vectors live (the `embedding` table, `docs/05` §9.2;
`P5-T03`) and which cache lifetimes ship (`docs/05` §9.2's ten, as its own refinement; `P5-T10`).

**Gaps the review found, now steps on named cards:** the FR-44 two-phase run (`P5-T25` steps 1–2, `P5-T26`
step 3); the stage that fills in survivors' metadata and fetches candidate vectors after the
identifier-level filters (`P5-T25` step 3; the related pipeline's counterpart is `P5-T14` step 2);
generation per topic group (`P5-T23` step 2); `dateAdded` on the item mapper (`P5-T18` step 1); the
keyless exclusion of Semantic Scholar from the keyword generator (`P5-T23` step 3) and from the
abstract fill-in (`P5-T12` step 4, `P5-T25` step 3).

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P5-T01` | Reconcile Phase 5 types and state machines in `docs/07` | 1.0 | none |
| `P5-T02` | Preference rows Phase 5 reads | 0.5 | none |
| `P5-T03` | Profile, recommendation and embedding tables | 1.5 | none |
| `P5-T04` | Request builders and the relatedness fixtures | 1.75 | none |
| `P5-T05` | Semantic Scholar references, citations, title match | 0.75 | none |
| `P5-T06` | Semantic Scholar Recommendations, one seed and many | 1.25 | none |
| `P5-T07` | Europe PMC citations and references | 0.75 | none |
| `P5-T08` | PubMed related articles (`elink` pmra) | 1.0 | none |
| `P5-T09` | Crossref deposited references and title search | 0.75 | none |
| `P5-T10` | Relatedness cache, negative cache, request budget | 1.0 | none |
| `P5-T11` | Seed resolution with a title-match threshold | 1.25 | none |
| `P5-T12` | Related-paper generators, union and hydration | 1.25 | none |
| `P5-T13` | Related scoring, reason chips, recency de-emphasis | 1.0 | none |
| `P5-T14` | Related pipeline: stages, partial results, wiring | 1.75 | none |
| `P5-T15` | Item menu entry and the window's related mode | 1.25 | none |
| `P5-T16` | Related results: relation column, picker, key notice | 1.25 | none |
| `P5-T17` | Import from related results, optional *Related* link | 1.0 | none |
| `P5-T18` | Collection reader and statistical profile | 1.5 | none |
| `P5-T19` | Lexical similarity floor (TF-IDF) | 0.75 | none |
| `P5-T20` | SPECTER2 vectors: fetch, normalise, store | 1.25 | none |
| `P5-T21` | Centroids and seed selection with negatives | 1.0 | none |
| `P5-T22` | `COLLECTION_PROFILE` call with estimate and consent | 1.5 | none |
| `P5-T23` | Recommendation candidate generators | 1.75 | none |
| `P5-T24` | Recommendation filters, scoring, diversity, reasons | 1.5 | none |
| `P5-T25` | Recommend pipeline: profile check, stages, wiring | 2.0 | none |
| `P5-T26` | Recommend entry and the editable profile panel | 1.5 | none |
| `P5-T27` | Recommendation results: dismiss, clusters, import | 1.5 | none |
| `P5-T28` | Prove the no-key path end to end | 0.75 | none |
| `P5-T29` | Probe the positive-seed cap with the real key | 0.5 | **Yes** |
| `P5-T30` | Phase-5 acceptance run against the definition of done | 1.0 | **Yes** |
| `P5-T31` | Owner-recorded Semantic Scholar fixtures | 0.25 | **Yes** |
| | **Total** | **35.75** | 3 gates |

**Entry points** (no `Depends on`): `P5-T01`, `P5-T02`, `P5-T04`. All three are documents, rows,
request builders and fixtures. `P5-T01` edits `docs/07` and `P5-T02` edits `docs/07` §8.5 and the
preference files, which `P4-T20` may also touch while it runs (item 325): run them after its commit, or
take exact-string edits. `P5-T04` touches no file `P4-T20` or `P4-T22` holds.

**Critical path inside the phase:** `P5-T01` → `P5-T03` → `P5-T18` → `P5-T21` → `P5-T23` → `P5-T24`
→ `P5-T25` → `P5-T26` → `P5-T27` → `P5-T28` → `P5-T30`, **15.0 d**, computed by script over the
**Depends on** rows. Feature 2's own chain (`P5-T04` → `P5-T31` → `P5-T06` → `P5-T12` → `P5-T13` →
`P5-T14` → `P5-T16` → `P5-T17`) is 9.5 d and finishes 3.75 d before Feature 6's (13.25 d to `P5-T27`),
so a second agent can carry it in parallel — once the owner has passed `P5-T31`'s gate. *Corrected
2026-11-01 (review): was 13.5 d and 3.5 d before the two re-estimates, both on this path.* *Updated
2026-11-01 (decisions): was 14.25 d; `P5-T03` +0.5 and `P5-T18` +0.25 lie on it. Feature 2's chain now
starts at `P5-T04` and passes the owner's recording (`P5-T31`); it was 8.25 d through `P5-T01`.* `P5-T29`
hangs off `P5-T06` and should run as early as `G-26` allows: its answer can change `P5-T21` (§5.4, "the positive-seed cap is far below 10").

---

## 2. Task cards

### P5-T01 — Reconcile Phase 5 types and state machines in `docs/07`

| Field | Value |
|---|---|
| **ID** | `P5-T01` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P5-T03`, `P5-T05`, `P5-T06`, `P5-T07`, `P5-T08`, `P5-T09`, `P5-T10`, `P5-T18`, `P5-T19` |
| **Retires** | none |
| **Implements** | part of `FR-15`, part of `FR-44`, part of `FR-47` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `docs/07` declares the shapes Phase 5 passes between stages — a related page with its
edges, a scored candidate with its signals, the profile with the user's edits — and §12.2 / §12.5 are
the pipelines the cards below build; `src/model/` holds them.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.2 (`findRelated`, `RelatedQuery`), §5.2 (`CollectionProfile`,
  `Recommendation`, `RecommendationSignals`), §12.2, §12.5 — as declared today
- `docs/05-related-work-discovery.md` §6.1–§6.2, §7.2 (`CollectionProfileDraft`), §7.4 — what the
  pipeline actually computes
- `docs/07-architecture-and-data-model.md` §2.3 — `model/` imports nothing but itself

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§2.2 tree, §5.2, §12.2, §12.5; §4.2 only if the 2026-11-02 declaration needs a change; dated notes first)
- modify `docs/05-related-work-discovery.md` (§6.1's "doc 02 §3.7" reference; dated note)
- create `src/model/related.ts` (`RelationKind`, `RelationEdge`; callers: `src/sources/types.ts`, the adapters from `P5-T05`–`P5-T09`, `src/pipeline/related/*`; types only)
- create `src/model/profile.ts` (callers: `src/pipeline/recommend/*`, `src/zotero/db.ts` from `P5-T03`; types only)
- create `src/model/recommendation.ts` (same callers; types only)
- modify `src/sources/types.ts` (`RelatedPage`; `findRelated`'s return type; `RelatedQuery.strategy`)

**Do.**
1. `docs/07` §4.2 already declares, under a dated note of 2026-11-02, `RelationKind`, `RelationEdge`
   (`kind`, `rank`, optional `score` and `contexts`), `RelatedPage` (a `SourcePage` with one edge per
   record, index-aligned), `findRelated` returning it, the strategy members `"recommendations"` and
   `"similar"`, and the rule that adapter-specific calls reach a pipeline as typed adapter instances
   from `installServices` (decided below). Check it against `docs/05` §6.2's score and FR-15's chips;
   if a field is missing, change §4.2 first under a dated note.
2. In §5.2, extend `RecommendationSignals` to `docs/05` §7.4's eight terms and let `Recommendation`
   carry every generator that found it (decided below); add `ProfileUserEdits` (removed and added
   terms) to `CollectionProfile` as `userEdits` (decided on `P5-T25`).
3. Rewrite §12.2 and §12.5 to the pipelines `P5-T14` and `P5-T25` build (decided below), §12.5 with
   its two input modes — "profile only" and "edited profile in" (decided on `P5-T25`).
4. Correct `docs/05` §6.1's "resolve IDs … (doc 02 §3.7)": §3.7 is the PMC ID converter; the
   cross-ID resolver is Semantic Scholar's `/paper/batch` (`docs/02` §6.3).
5. Declare the types in the three `src/model/` files, and `RelatedPage`, `findRelated`'s return type and
   the two strategy members in `src/sources/types.ts`, as §4.2 prints them; no adapter implements
   `findRelated` yet, so nothing else moves.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** the shape `findRelated` returns.
> `docs/07` §4.2 had it return a plain `SourcePage`, which loses whether a record is a reference, a
> citation or a recommendation, its rank, pmra's score and Semantic Scholar's citation `contexts` —
> every input to `docs/05` §6.2's score and to FR-15's reason chips. **A `RelatedPage` with one
> `RelationEdge` per record, declared in `docs/07` §4.2 first** (done 2026-11-02). The title match, the
> many-paper recommendation and the vector fetch (`P5-T05`, `P5-T06`, `P5-T09`, `P5-T20`) are
> adapter-specific either way: pipelines reach them through typed adapter instances passed in by
> `installServices` (the `SemanticScholarSource` / `hasApiKey` precedent), and `RelatedQuery.strategy`
> names `"recommendations"` and `"similar"` instead of overloading `"auto"`. (Review line 30.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** which signal set `docs/07` keeps.
> `docs/07` §5.2's `RecommendationSignals` has seven members (`embeddingSimilarity`, `subjectOverlap`,
> `termSimilarity`, `authorOverlap`, `citationLink`, `recency`, `venueAffinity`) and
> `Recommendation.discoveredVia` names one source; `docs/05` §7.4 scores eight terms (similarity,
> recency, velocity, novelty, author and venue affinity, generator agreement, coupling) over candidates
> found by several generators at once. **`docs/05` §7.4's eight, with `discoveredVia` becoming a
> list.** (Review line 23.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** what a related or recommend *job*
> is. `docs/07` §12.2 keeps the job alive in an `AwaitingSelection` state with a 30-minute timeout, and
> §12.5 is query-centric (`GeneratingQueries → Searching`). The search window already splits a run
> into a fetch-only job and an import of the previewed set (`SearchImportInput.records` + `works`).
> **Both jobs end when their results are shown; import is the search pipeline's preview import;
> neither job resumes after a restart (a re-run is cheap with `P5-T10`'s cache — item 303(c)'s
> precedent); §12.5 follows `docs/05` §7.1's five generators.** (Review line 17.)

**Do NOT.**
- Do **not** import `pipeline/`, `sources/` or `core/` from `src/model/`.
- Do **not** declare a type in `docs/05` or `docs/12`; `docs/07` is the sole authority
  (`plan/README.md` §5 item 3).
- Do **not** set `relatedByWork` or `citationGraph` anywhere; each adapter card sets its own.

**Done when.**
- [ ] `docs/07` §4.2, §5.2, §12.2 and §12.5 carry dated notes and match the declarations.
- [ ] The three `src/model/` files export only types and import only `src/model/`.
- [ ] `npm run typecheck`, `npm run lint:check` and `npx eslint .` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npx eslint .
```

**Notes.** Needs: nothing built beyond §0.1. No test file: types only; the adapter cards' tests pin
the shapes. `docs/07` is shared with `P4-T20` (item 325) — exact-string edits only, or after it
commits.

---

### P5-T02 — Preference rows Phase 5 reads

| Field | Value |
|---|---|
| **ID** | `P5-T02` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P5-T15`, `P5-T17`, `P5-T26` |
| **Retires** | none |
| **Implements** | part of `FR-17` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The rows Phase 5 reads exist in `docs/07` §8.5, `PREFS`, `PREF_KEYS` and (where `docs/01`
§7.2 lists them) `addon/prefs.js`.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.5 — the table and its "add a preference here first" rule
- `docs/10-requirements-and-user-stories.md` FR-17 — "the 'link to seed item' preference"
- `plan/07` `P4-T02` and the `report.enabled` row — the last rows card and the hidden-row precedent

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§8.5 rows; dated note)
- modify `src/prefs/schema.ts`, `src/prefs/keys.ts`
- modify `addon/prefs.js` (only rows `docs/01` §7.2 lists; the others fall back to the schema default)
- modify `test/unit/prefs/schema.test.ts`

**Do.**
1. Documents first: declare in `docs/07` §8.5 `related.linkToSeed` (boolean) and the two hidden rows
   decided below, with the defaults the decisions give.
2. Add the rows to `PREFS` and `PREF_KEYS`; extend the schema test, including the D5 block.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** `related.linkToSeed`'s default.
> FR-17 calls the linkage optional ("S") and "when the user has enabled" it; `docs/08` §5.2's wireframe
> draws the checkbox ticked. **`true`, and the window's checkbox starts from it.** (Review line 14.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** how the two features hide until
> they work. **Two hidden boolean rows, `related.enabled` and `recommend.enabled`, default `false`,
> modelled on `report.enabled` (item 307(d)); `P5-T30` sets both defaults `true` in `docs/07` §8.5
> first once the definition of done passes.** (Review line 35.)

**Do NOT.**
- Do **not** add an exploration, peer-reviewed or embedding-provider row; those are per-run controls
  or not built (decided on `P5-T20`, `P5-T24`, `P5-T27`).
- Do **not** add a fractional row (item 245).

**Done when.**
- [ ] Each new row reads back its §8.5 default through `getPref`.
- [ ] `test/unit/prefs/schema.test.ts` covers the rows and the D5 rule.
- [ ] `npm run typecheck` exits 0; `npm run test:unit -- schema` passes.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- schema
```

**Notes.** Needs: `P3-T32`, `P3-T39` (built). Only this card adds Phase 5 rows.

---

### P5-T03 — Profile, recommendation and embedding tables

| Field | Value |
|---|---|
| **ID** | `P5-T03` |
| **State** | `TODO` |
| **Depends on** | `P5-T01` |
| **Blocks** | `P5-T18`, `P5-T20`, `P5-T25` |
| **Retires** | none |
| **Implements** | part of `FR-44`, part of `FR-49`, part of `NFR-8` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** `collection_profile`, `recommendation` and `embedding` exist as migrations 8–10 with a store
each, opened by `installPluginDatabase`, and the stored vectors stay under a size cap.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.3 — the three `CREATE TABLE` statements and `idx_rec_profile`, `idx_embedding_model`; §9.2 — the `embedding` row's 100 MB
- `src/bootstrap/migrations.ts` header and `REPORT_DDL` — the byte-for-byte rule
- `plan/04` §0.2 item 4 — the pinned version tests (four, corrected 2026-11-02)
- `docs/10` NFR-8 — plugin data "bounded, with an LRU eviction policy"

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§8.3 or §9.2: the `embedding` table's cap and eviction order; dated note)
- modify `src/bootstrap/migrations.ts` (three entries appended to `MIGRATIONS`)
- modify `src/zotero/db.ts` (`createCollectionProfileStore`, `createRecommendationStore`, `createEmbeddingStore`)
- modify `src/bootstrap/pluginDatabase.ts` (constructing file: `installPluginDatabase` builds the stores)
- modify `test/unit/core/provenanceRerun.test.ts`, `test/integration/zotero/provenanceStore.spec.ts` (version pins)
- modify `test/unit/pipeline/privacyPolicy.test.ts`, `test/unit/zotero/userPriceStore.test.ts` (version pins —
  *corrected 2026-11-01 (review): both assert `LATEST_SCHEMA_VERSION` is 7 (grep), so appending a migration
  fails them; `plan/04` §0.2 item 4's "two tests" is stale*)
- create `test/integration/zotero/recommendStores.spec.ts`
- create `test/unit/zotero/embeddingStore.test.ts` (the cap and eviction order, on the store's injected database double — verify the `userPriceStore.test.ts` pattern first)

> *Added 2026-11-02 (`plan/reports/P5-T01.md`, finding 7): set `redaction` on both records, and name identifier fields to the redaction gate, or `KEY_PATTERNS` replaces them; likely `membershipHash`, `knownWorkKeys`, `profileId` and `work.workKey` — measure this, it was not measured.*

**Do.**
1. Append the three statements and both indexes exactly as `docs/07` §8.3 prints them (one migration
   per table).
2. Stores: profile get/put by `id` with the centroid blob sliced by `centroid_count`; recommendation
   put, `reject(id)` and "rejected for profile" — the only `user_action` written is `"rejected"`
   (§0.2 item 27); embedding `putMany`/`getMany(workKeys, model)`/`allForModel(model)` with
   `Float32Array` ↔ `BLOB`.
3. The cap (decided below): documents first, write it into `docs/07` under a dated note; then
   `evictToCap(isInLibrary)` on the embedding store — after a `putMany` that takes the table over
   100 MB (`dim × 4` bytes per vector), delete the oldest vectors (`created_at`) of works the
   `isInLibrary` predicate rejects, then, if still over, the oldest of the rest.
4. Every JSON column passes through `redactRecord` (`plan/04` §0.2 item 5).

> **Settled by the documents (review 2026-11-01):** where vectors live. `docs/05` §9.2 says "the vectors
> themselves live in the `embedding` table of §5.4, not in `cache_entry`", `docs/07` §8.3 declares that
> table and §8.5's storage row says "SQLite `embedding`, `vector BLOB` … Never JSON". The `embedding`
> cache namespace with `embeddingKey` (`docs/07` §9.1–§9.2, `CACHE_NAMESPACES`) stays unused; the
> table is cleared by Phase 7's "Clear embeddings" (`docs/09` §3.7). The vector route is SPECTER2
> (item 320(b)), so the migration stays.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** a size limit on stored vectors
> (NFR-8 "bounded, with an LRU eviction policy"; §5.3 (was `plan/05` §2.3) asked for "its share of the NFR-8
> cap"). **Cap the `embedding` table at `docs/07` §9.2's existing 100 MB vector budget (about 33 000
> 768-dimension vectors), evicting the oldest vectors of papers not in the library first.** +0.25 d on
> this card. (Review line 31.)

**Do NOT.**
- Do **not** edit a shipped migration; append.
- Do **not** add a `REFERENCES` clause (item 272(b) precedent).
- Do **not** write `"accepted"` or any import record into `recommendation.user_action` (item 323(b)).

**Done when.**
- [ ] `LATEST_SCHEMA_VERSION` is 10 and all four pinned tests say so (*corrected 2026-11-01 (review): was "both"*).
- [ ] The spec round-trips a profile with k = 2 centroids, a rejection, and 3 vectors byte-exact.
- [ ] A unit test with a cap lowered through the store's options evicts the oldest not-in-library vectors first, then the oldest of the rest.
- [ ] Mutation sweep per §0.2 item 24.
- [ ] `npm run typecheck` exits 0; unit suite and the integration suite pass (three runs if any fails).

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- provenanceRerun privacyPolicy userPriceStore embeddingStore && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P4-T14` (migration 7, built). No other card appends a migration today; grep
`MIGRATIONS` before choosing version numbers. *Re-estimated 2026-11-01, 1.0 → 1.5 d:* the review's
"likely 1.25" (three stores, two `BLOB` codecs, four version pins and an integration spec, against
`P4-T14`'s one table plus note writer at 1.25 d) plus 0.25 d for the cap (review line 31).

---

### P5-T04 — Request builders and the relatedness fixtures

| Field | Value |
|---|---|
| **ID** | `P5-T04` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P5-T07`, `P5-T08`, `P5-T09`, `P5-T31` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 1.75 d |
| **Human gate** | none |

**Goal.** The five request builders Phase 5's adapters send exist, the recorder records Europe PMC, NCBI
and Crossref against them, and it has a keyed Semantic Scholar path that the owner runs in `P5-T31`.

*Retitled 2026-11-01 (decisions): was "Record the relatedness fixtures". Review line 32 moved the five
builders here, because fixtures are found by the exact method, URL and body (`fixtureKey`) and the
`test/support/*RecordedRequests.ts` modules import the shipped builders; item 323(c) gave the Semantic
Scholar recording to the owner.*

**Read first.**
- `scripts/record-fixtures.ts` header — politeness rules, "No API key, by construction", `--source`, the LLM providers' `--live` path (the owner's, never an agent's)
- `docs/05` §2.1–§2.2, §3.1–§3.3, §4.2, §5.2 and `docs/02` §4.7, §6.2 — the requests and their verified shapes
- `scripts/spike-abstract-coverage.ts` — how `SEMANTIC_SCHOLAR_API_KEY` is read from the process environment and never printed
- `docs/13` §3.1 — fixture inventory rules

**Files.**
- create `src/sources/semanticscholar/graph.ts` (builders only: references, citations, title match; callers: `test/support/semanticscholarRecordedRequests.ts` now, `semanticscholarSource.ts` from `P5-T05`)
- create `src/sources/semanticscholar/recommendations.ts` (builders only: `forpaper`, the `POST /papers/` body; callers: the recorded-request module now, `P5-T06`)
- create `src/sources/europepmc/citations.ts` (builders only: `/citations`, `/references`; callers: the recorded-request module now, `P5-T07`)
- create `src/sources/pubmed/elink.ts` (builder only: `neighbor_score` with one `id=` per seed and the identity parameters; callers: the recorded-request module now, `P5-T08`)
- create `src/sources/crossref/references.ts` (builder only: `/works/{doi}` for `reference[]`, `query.bibliographic` title search; callers: the recorded-request module now, `P5-T09`)
- create `test/unit/sources/relatedRequests.test.ts`
- modify `scripts/record-fixtures.ts` (scenario lists for the new endpoints; the keyed Semantic Scholar path)
- modify `test/support/semanticscholarRecordedRequests.ts`, `test/support/europepmcRecordedRequests.ts`,
  `test/support/pubmedRecordedRequests.ts`, `test/support/crossrefRecordedRequests.ts`
- create fixtures under `test/fixtures/{europepmc,pubmed,crossref}/` (Semantic Scholar's are `P5-T31`'s)
- modify `docs/13-testing-build-and-release.md` (§3.1 inventory rows for Europe PMC, NCBI and Crossref; dated note)

**Do.**
1. The five builders, address and body only, each with a shape test: Semantic Scholar
   `/paper/{id}/references` and `/citations` (with `contexts,intents,isInfluential`), `/paper/search/match`,
   `/recommendations/v1/papers/forpaper/{id}?from=recent`, `POST /recommendations/v1/papers/` (ids in the
   body, `limit` and `fields` as query parameters); Europe PMC `/MED/{id}/citations` and `/references`;
   NCBI `elink` `cmd=neighbor_score` with separate `id` parameters and the identity parameters the
   existing PubMed builders add (D10); Crossref `/works/{doi}` and `query.bibliographic` with `rows` ≤ 5.
2. Scenarios: Semantic Scholar — references, citations, `forpaper`, the POST (2 positives, 1 negative),
   `/paper/search/match` for a title with and without a match, `/paper/batch` with `embedding.specter_v2`,
   with `references.externalIds` and with one unresolvable id among valid ones, a 404 seed, a 400 for an
   unknown field; Europe PMC citations and references, plus a hand-written 503 `text/plain` body
   (`docs/02` §4.7); NCBI `elink` with two seeds; Crossref `/works/{doi}` with a deposited `reference[]`
   and one without. Hand-written bodies — the Recommendations 400 "Response would exceed maximum size",
   the 503 — carry `"synthetic": true`. *(The scenario list keeps the review's four additions of
   2026-11-01: the no-match title, the 400 field error, the batch with one unresolvable id and the
   size-cap 400.)*
3. The keyed Semantic Scholar path (decided below): `--source semanticscholar` with `FIXTURE_MODE=record`
   and an explicit opt-in flag reads `SEMANTIC_SCHOLAR_API_KEY` from the process environment, sends it
   only as the `x-api-key` header, prints only whether a key was present, and never writes the header to
   a fixture. `fixtureKey` hashes the method, the credential-redacted URL and the body, not headers, so
   a keyed recording replays unkeyed. Without the flag the path refuses and prints the command for the
   owner.
4. Record Europe PMC, NCBI and Crossref live, unkeyed, sequentially, with `docs/05`'s probe papers, and
   add their inventory rows to `docs/13` §3.1. Do **not** record Semantic Scholar: that is `P5-T31`, the
   owner's.

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 323(c)):** how Semantic Scholar's relatedness scenarios
> get recorded. The anonymous pool refused 12 of 12 calls on 2026-09-09 (`docs/02` §6.4) and 12 in a row
> on 2026-10-16 (items 222, 226). **The owner records the Semantic Scholar responses with the key in the
> process environment, at no cost; the agent never sees the value; the recorder gets a keyed path for
> this** (+0.25 d here). (Review line 33.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** the order of recording and building.
> **This card creates the five request builders (address and body only, with shape tests) and
> records; `P5-T05`–`P5-T09` extend them with parsers — one recording session, one keyed session for the
> owner.** +0.5 d here, offset by −0.25 d on `P5-T05`, whose three builders moved. (Review line 32.)

**Do NOT.**
- Do **not** provoke a 429 or a 5xx; hand-write them.
- Do **not** loop over a result set; this recorder is not a harvester.
- Do **not** read, print or store a key (`plan/04` §0.2 item 7); do not run the keyed path yourself.
- Do **not** write a parser here; each adapter card owns its parser and its parse tests.

**Done when.**
- [ ] `relatedRequests.test.ts` pins each builder's method, URL and body.
- [ ] Every Europe PMC, NCBI and Crossref scenario in step 2 has a fixture or a `"synthetic": true` stand-in with its reason.
- [ ] `npm run fixtures:record -- --source semanticscholar --dry-run` lists the Semantic Scholar scenarios; the keyed path refuses without its opt-in flag (shown by running it without the flag and with no key set).
- [ ] `npm run typecheck` exits 0; `npm run test:contract` and `npm run test:unit -- relatedRequests` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedRequests && npm run test:contract && npm run fixtures:record -- --source semanticscholar --dry-run
```

**Notes.** Network: `NODE_USE_SYSTEM_CA=1` on this network. No mutation sweep on the recorder (data
only); the builders' shape tests are the guard. *Re-estimated 2026-11-01, 1.0 → 1.75 d:* +0.25 d for the
keyed Semantic Scholar path (item 323(c)) and +0.5 d for the five builders (review line 32).

---

### P5-T05 — Semantic Scholar references, citations, title match

| Field | Value |
|---|---|
| **ID** | `P5-T05` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T31` |
| **Blocks** | `P5-T11`, `P5-T12`, `P5-T20` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-14`, part of `FR-15` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** The Semantic Scholar adapter exposes `findRelated` for references and citations (with
`contexts`) and a title match, and declares `relatedByWork` / `citationGraph` true.

**Read first.**
- `docs/05-related-work-discovery.md` §2.1 (contexts, `intents` is a bonus never a filter), §2.2 (the silent nested-selector trap)
- `docs/02-literature-database-apis.md` §6.2, §6.3, §6.10 — endpoints, ID prefixes, error bodies
- `src/sources/semanticscholar/semanticscholarSource.ts` header — keyed/unkeyed, `code` as a string

**Files.**
- modify `src/sources/semanticscholar/graph.ts` (parsers beside `P5-T04`'s builders; caller: the source below)
- modify `src/sources/semanticscholar/semanticscholarSource.ts` (`findRelated`, `matchTitle`, capability flags)
- create `test/unit/sources/semanticscholarGraph.test.ts`
- modify `test/unit/bootstrap/container.test.ts` (only if the flag invariant needs the new member named)

> *Added 2026-11-02 (`plan/reports/P5-T09.md`, `P5-T07.md`, `P5-T04.md`; coordinator, under `plan/00` §6 item 313): `matchTitle(title, ctx)` returns a list of zero or one record, the shape `P5-T09` built, so `P5-T11` treats both sources alike. `semanticscholar.test.ts` pins the old flags and changes with this card. Correct the stale "records unauthenticated" in `semanticscholarSource.ts`'s header. A seed the source was asked about and does not hold throws `BadRequestError` with status 404; a seed lacking the identifier the source needs is an empty page with a warning and no request (item 332(c)).*

> *Added 2026-11-02 (`plan/00` §6 item 335(a); owner): built before `P5-T31` by the owner's choice, against stand-in fixtures built from `docs/02` §6's documented response shapes, each marked `"synthetic": true` with a reason. No key, no live call and no anonymous recording. The dependency on `P5-T31` stays, as the check: when the owner records, the stand-ins are replaced and this card is re-checked against what was recorded, and the card is not DONE before that.*

**Do.**
1. `findRelated` with `strategy: "references" | "citations"`: `limit` ≤ 1000, fields including
   `externalIds`, `year`, `title`, `citationCount`, and for citations `contexts,intents,isInfluential`;
   each record carries a `RelationEdge`.
2. `matchTitle(title)` over `/paper/search/match`, returning the match and its fields; "no match" is a
   result, not an error. *Corrected 2026-11-01 (review), rule 8: the draft stated "a 404 is no match" as a
   premise, but `docs/02` §6.2 lists the endpoint with no recorded response. Verify the no-match status and
   body against the no-match fixture (`P5-T31` records what it saw); I believe it is a 404 with an error message.*
3. Set `relatedByWork` and `citationGraph` true.

**Do NOT.**
- Do **not** request `citingPaper.references.*` inline; it is ignored silently (`docs/05` §2.2).
- Do **not** loop per paper; hydration is `lookup` over `/paper/batch`.
- Do **not** send a request when no key is present and the caller says keyless (§0.2 item 19).

**Done when.**
- [ ] Parsers read `P5-T31`'s fixtures; `contexts.length` survives into the edge.
- [ ] A 404 seed, a 400 field error and a 429 map to the existing error classes.
- [ ] `container.test.ts`'s invariant holds with the flags true.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- semanticscholar container` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- semanticscholar container
```

**Notes.** Needs: `P2-T05`, `P2-T34` (built). Shares `semanticscholarSource.ts` with `P5-T06` and
`P5-T20`; run them in sequence or as exact-string edits. *Re-estimated 2026-11-01, 1.0 → 0.75 d:* its
three request builders moved to `P5-T04` (review line 32).

---

### P5-T06 — Semantic Scholar Recommendations, one seed and many

| Field | Value |
|---|---|
| **ID** | `P5-T06` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T31` |
| **Blocks** | `P5-T12`, `P5-T23`, `P5-T29` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-15`, part of `FR-45` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** `forpaper` (one seed) and `POST /papers/` (positives and negatives) work, `from=recent` only,
with every seed ID validated before the POST.

**Read first.**
- `docs/05-related-work-discovery.md` §3.1–§3.3 — both endpoints, `from`, the five pitfalls, the 10 MB cap
- `docs/05` §7.2 "Negative examples" — where negatives come from

**Files.**
- modify `src/sources/semanticscholar/recommendations.ts` (parsers and `RECOMMEND_MAX_POSITIVES` beside `P5-T04`'s builders; caller: the source below)
- modify `src/sources/semanticscholar/semanticscholarSource.ts` (`findRelated` `strategy: "recommendations"` → forpaper; `recommend(positives, negatives, limit)`)
- create `test/unit/sources/semanticscholarRecommendations.test.ts`

> *Added 2026-11-02 (`plan/00` §6 item 335(a); owner): built before `P5-T31` by the owner's choice, against stand-in fixtures built from `docs/02` §6's documented response shapes, each marked `"synthetic": true` with a reason. No key, no live call and no anonymous recording. The dependency on `P5-T31` stays, as the check: when the owner records, the stand-ins are replaced and this card is re-checked against what was recorded, and the card is not DONE before that.*

**Do.**
1. `forpaper` with `from=recent`, `limit` ≤ 100 when `abstract` is requested, else up to the caller's
   200; edges of kind `recommendation` with their rank.
2. `recommend`: validate every positive and negative through one `/paper/batch` call first and drop
   the unresolvable (pitfall 2); cap positives at `RECOMMEND_MAX_POSITIVES` (15 until `P5-T29`
   measures); `limit` and `fields` as query parameters, the IDs in the body.
3. Filter the seeds out of the result (pitfall 4); treat a short list as normal (pitfall 1); a 400
   "Response would exceed maximum size" retries once at half the limit.

**Do NOT.**
- Do **not** expose or send `from=all-cs` (`docs/05` §3.2 decision).
- Do **not** filter dates server-side; there is no such parameter (pitfall 3).

**Done when.**
- [ ] One bad seed among ten does not fail the POST (a fixture-backed test).
- [ ] The size-cap 400 is retried once at half the limit and then reported.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- semanticscholarRecommendations` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- semanticscholarRecommendations
```

**Notes.** Needs: `P2-T05` (built). `P5-T29` replaces the cap of 15 with a measured figure.

---

### P5-T07 — Europe PMC citations and references

| Field | Value |
|---|---|
| **ID** | `P5-T07` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T04` |
| **Blocks** | `P5-T12`, `P5-T23` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-15` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Europe PMC's `findRelated` returns citations and references for a seed it indexes, and the
two endpoints fail independently.

**Read first.**
- `docs/02-literature-database-apis.md` §4.7 — shapes, the 503 `text/plain` maintenance body, independent outages
- `src/sources/europepmc/europepmcSource.ts` header — why `citationGraph` is false today (item 131)

**Files.**
- modify `src/sources/europepmc/citations.ts` (parsers beside `P5-T04`'s builders; caller: the source below)
- modify `src/sources/europepmc/europepmcSource.ts` (`findRelated`, flags)
- create `test/unit/sources/europepmcCitations.test.ts`

**Do.**
1. Resolve the seed to a `MED`/`PMC` source and id (PMID or PMCID from its ids; a DOI-only seed goes
   through the existing `lookup` first).
2. `findRelated` `"citations"` and `"references"`, paged to the caller's limit; records mapped through
   the existing mapper where fields allow, else as minimal records hydrated later.
3. A 503 or non-JSON body on one endpoint is reported for that endpoint only.

**Do NOT.**
- Do **not** call `databaseLinks` (`docs/02` §4.7: not related work).
- Do **not** assume a JSON envelope on error.

**Done when.**
- [ ] The 503 fixture on `/references` leaves `/citations` working (test).
- [ ] Flags true; `container.test.ts` holds.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- europepmc container` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- europepmc container
```

**Notes.** Needs: `P2-T03`, `P2-T12`, `P2-T34` (built). The `www.ebi.ac.uk` limit stays `docs/07`
§7.3's; no new number.

---

### P5-T08 — PubMed related articles (`elink` pmra)

| Field | Value |
|---|---|
| **ID** | `P5-T08` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T04` |
| **Blocks** | `P5-T12`, `P5-T23` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-15` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** PubMed's `findRelated` returns pmra neighbours with normalised scores, one linkset per seed.

**Read first.**
- `docs/05-related-work-discovery.md` §4.2–§4.4 — `neighbor_score`, normalisation, self-match, separate `id` params
- `docs/02-literature-database-apis.md` §2.2, §3.6 — identity parameters (D10), linknames
- `src/sources/pubmed/pubmedSource.ts` header — why `relatedByWork` is false today

**Files.**
- modify `src/sources/pubmed/elink.ts` (the parser beside `P5-T04`'s builder; caller: the source below)
- modify `src/sources/pubmed/pubmedSource.ts` (`findRelated`, flags)
- create `test/unit/sources/pubmedElink.test.ts`

**Do.**
1. Send `P5-T04`'s builder — `elink.fcgi?dbfrom=pubmed&db=pubmed&cmd=neighbor_score&linkname=pubmed_pubmed&retmode=json`
   with one `id=` parameter per seed and the identity parameters the existing builders add — for
   `findRelated` with `strategy: "similar"`.
2. Per linkset: drop the seed itself, normalise `score / max`, slice to the caller's limit; edges of
   kind `similar` with rank and score.
3. Hydrate survivors through the existing efetch path in batches of `EFETCH_MAX_IDS_PER_CALL`.
4. Set `relatedByWork` and `citationGraph` true (decided below).

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** PubMed's similar-articles source and
> item 184's rule that a database "with the citation flag" is exactly one that answers related-paper
> requests, held by `container.test.ts`. Once PubMed answers related-paper requests the test forces the
> flag on, while `docs/07` §4.2 described the flag as "returns references / citations". **`docs/07` §4.2's
> description is widened to "returns relation edges (references, citations, recommendations or similar
> articles)"** (done 2026-11-02 under a dated note), which keeps item 184's rule and its test unchanged;
> PubMed's citation lists (`pubmed_pubmed_refs`, `pubmed_pubmed_citedin`) are not built. (Review line
> 18; the owner may read it as revisiting item 184.)

**Do NOT.**
- Do **not** pass a comma-joined `id` list; it merges linksets and loses per-seed attribution.
- Do **not** compare raw scores across linksets.

**Done when.**
- [ ] A two-seed fixture yields two linksets with scores in (0, 1] and no seed in its own list. *(Corrected 2026-11-02, `P5-T01` decision 3: `findRelated` takes one seed per call; the several-seed call is an adapter-specific method returning one `RelatedPage` per seed. Name it in `docs/07` §4.2 first.)*
- [ ] `createHttpClient`'s NCBI identity check accepts the request (test).
- [ ] Both flags true; `container.test.ts`'s invariant holds.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- pubmed container` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- pubmed container
```

**Notes.** Needs: `P1-T09`, `P2-T34` (built). `eutils.ncbi.nlm.nih.gov` limits are `HOST_POLICIES`'.

---

### P5-T09 — Crossref deposited references and title search

| Field | Value |
|---|---|
| **ID** | `P5-T09` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T04` |
| **Blocks** | `P5-T11`, `P5-T12` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-14`, part of `FR-15` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Crossref returns a DOI's deposited `reference[]` as related records, and a title search for
seed resolution — the only reference source for a keyless, non-biomedical seed.

**Read first.**
- `docs/05-related-work-discovery.md` §2.1 — references only where publishers deposited; no citing list
- `docs/02-literature-database-apis.md` §5.2 — `query.bibliographic` is "not a resolver" for DOIs
- `src/sources/crossref/crossrefSource.ts` — `lookupById: []`, `CROSSREF_ABSTRACT_COVERAGE_NOTE`

**Files.**
- modify `src/sources/crossref/references.ts` (parsers beside `P5-T04`'s builders; caller: the source below)
- modify `src/sources/crossref/crossrefSource.ts` (`findRelated` `"references"`, `matchTitle`, flags)
- create `test/unit/sources/crossrefReferences.test.ts`

**Do.**
1. `/works/{doi}`: map each `reference[]` entry with a DOI to a minimal record (edge `reference`,
   rank = position); entries without a DOI are counted and dropped.
2. `matchTitle(title)`: `query.bibliographic` with `rows` ≤ 5, returning candidates for `P5-T11` to
   threshold.
3. Set `relatedByWork` and `citationGraph` true.

**Do NOT.**
- Do **not** treat `is-referenced-by-count` as a citation list.
- Do **not** pass a DOI to `query.bibliographic`.

**Done when.**
- [ ] The no-`reference[]` fixture yields an empty page with a warning, not an error.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- crossref container` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- crossref container
```

**Notes.** Needs: `P2-T04` (built).

---

### P5-T10 — Relatedness cache, negative cache, request budget

| Field | Value |
|---|---|
| **ID** | `P5-T10` |
| **State** | `TODO` |
| **Depends on** | `P5-T01` |
| **Blocks** | `P5-T12`, `P5-T23` |
| **Retires** | part of `R-3` |
| **Implements** | none |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Every relatedness call goes cache → budget → limiter, with `docs/05` §9.2's per-signal TTLs
and a 7-day negative cache, and a run degrades by value per request when its budget runs out.

**Read first.**
- `docs/05-related-work-discovery.md` §9.1–§9.3 — principles, the TTL table, `RequestBudget`, value order
- `docs/07-architecture-and-data-model.md` §9.1–§9.2 — key construction, the `source-response` namespace
- `src/core/cache/cache.ts` — `CacheSetOptions.ttlMs`

**Files.**
- create `src/pipeline/shared/relatedFetch.ts` (cache wrapper, TTL table, negative cache; callers: `src/pipeline/related/generators.ts` (`P5-T12`), `src/pipeline/recommend/generators.ts` (`P5-T23`))
- create `src/pipeline/shared/requestBudget.ts` (same callers)
- modify `docs/07-architecture-and-data-model.md` (§9.2: a cross-reference to `docs/05` §9.2's per-signal TTLs; dated note)
- create `test/unit/pipeline/relatedFetch.test.ts`

**Do.**
1. Documents first: a dated cross-reference in `docs/07` §9.2 saying the `source-response` namespace's
   relatedness entries carry `docs/05` §9.2's per-signal TTLs (settled below); the TTL table stays in
   `docs/05`.
2. `cachedRelated(cache, kind, key, fetch)`: cache first; on a permanent 404 write a negative entry
   for 7 days; keys through `cacheKey`.
3. `RequestBudget` with `tryTake(n)` and a generator order table (`docs/05` §9.3); a generator that
   cannot take its full share processes fewer seeds.

> **Settled by the documents (review 2026-11-01):** which TTLs ship. `docs/07` §9.2 gives
> `source-response` two TTLs (24 h for search results, 30 d for lookups) and owns only the namespaces'
> defaults and caps; `docs/05` §9.2 calls its ten per-signal TTLs (references 90 d, citations 7 d,
> recommendations 3 d, pmra 14 d, negative 7 d …) "this document's finer, per-signal refinement of those
> namespaces, and it is what this section owns". Not a contradiction: **`docs/05`'s ten ship**, each
> stored per entry through `CacheSetOptions.ttlMs` as `SOURCE_RESPONSE_LOOKUP_TTL_MS` already is.

**Do NOT.**
- Do **not** create a second cache table (`docs/05` §9.2).
- Do **not** check the cache after the limiter.

**Done when.**
- [ ] A second identical call makes no request; an expired entry does.
- [ ] A 404 seed is not re-requested within 7 days (fake clock).
- [ ] A budget of 5 with a 20-seed generator processes exactly 5 seeds.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- relatedFetch` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedFetch
```

**Notes.** Needs: `P3-T33` (built). No adapter changes: the wrapper sits in `pipeline/`.

---

### P5-T11 — Seed resolution with a title-match threshold

| Field | Value |
|---|---|
| **ID** | `P5-T11` |
| **State** | `TODO` |
| **Depends on** | `P5-T05`, `P5-T09` |
| **Blocks** | `P5-T14` |
| **Retires** | none |
| **Implements** | `FR-14`, part of `FR-13` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** A seed item resolves to identifiers across sources, or — title only — to one candidate above
a stated threshold, a list for the user to pick from, or an actionable error naming what is missing.

**Read first.**
- `docs/10-requirements-and-user-stories.md` FR-13 (third scenario), FR-14
- `docs/08-ui-ux-spec.md` §5.1 step 1 (where identifiers are read from), §5.3 (edge cases)
- `src/sources/shared/dedupe.ts` — `levSim`, `LEVSIM_*`, `MAX_YEAR_DELTA`, `normalizeFamilyName`

**Files.**
- modify `docs/05-related-work-discovery.md` (§6.1 seed-resolution threshold; dated note)
- create `src/pipeline/related/seed.ts` (`resolveSeed`; caller: `src/pipeline/related/relatedPipeline.ts`, `P5-T14`)
- create `test/unit/pipeline/relatedSeed.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T09.md`, `P5-T10.md`): call `CrossrefSource.matchTitle(title, ctx)`; the recorded title search returns non-papers (`component` items with `[[null]]` dates), so the threshold must reject them. Title matches are not cached: they have no signal kind and no row in `docs/05` §9.2.*

**Do.**
1. Documents first: write the threshold decided below into `docs/05` §6.1 (FR-14 says "per
   `05-related-work-discovery.md`", which states none).
2. Identifiers from the seed's `CanonicalWork` (`fromZoteroItem` supplies it via the pipeline's Zotero
   port); expand through S2 `lookup` when keyed, else the PMC converter for a PMCID.
3. Title only: candidates from S2 `matchTitle` (keyed) and Crossref `matchTitle`; keep those passing
   the threshold; one → resolved with a "matched by title" flag; several → `"choose"` with the list;
   none → an error naming DOI, PMID, arXiv ID and title.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** the title-match threshold. **The
> dedupe cascade's own constants — `levSim` ≥ `LEVSIM_DUPLICATE_THRESHOLD` (0.95), or ≥
> `LEVSIM_CORROBORATED_THRESHOLD` (0.88) with |year delta| ≤ `MAX_YEAR_DELTA` and the first author's
> family name matching; two or more passing → the user picks.** (Review line 9.)

**Do NOT.**
- Do **not** pick silently when two candidates pass (FR-14 scenario 2).
- Do **not** send the seed's abstract, notes or tags anywhere (`docs/09` §3 row 2).

**Done when.**
- [ ] Tests cover: DOI seed; PMID-only seed; title-only one match; two matches → `"choose"`; nothing → the named error.
- [ ] Keyless runs make no S2 call (test with a transport that fails on `api.semanticscholar.org`).
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- relatedSeed` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedSeed
```

**Notes.** Needs: `P2-T09` (built). The picker UI is `P5-T16`'s.

---

### P5-T12 — Related-paper generators, union and hydration

| Field | Value |
|---|---|
| **ID** | `P5-T12` |
| **State** | `TODO` |
| **Depends on** | `P5-T05`, `P5-T06`, `P5-T07`, `P5-T08`, `P5-T09`, `P5-T10` |
| **Blocks** | `P5-T13`, `P5-T14` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-15` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** From a resolved seed, the generators run concurrently across hosts and serially within one,
their results are unioned and merged, and only survivors are hydrated.

**Read first.**
- `docs/05-related-work-discovery.md` §6.1 — the generator list and budget, §9.4 concurrency, §9.5 degradation ladder
- `src/pipeline/searchImport/stages.ts` — `fanOut`'s per-source reports, `dedupeAndMergeAsync`

**Files.**
- create `src/pipeline/related/generators.ts` (caller: `relatedPipeline.ts`, `P5-T14`)
- create `test/unit/pipeline/relatedGenerators.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T01.md`): map `SourceRecord.id` to a list of edges, because two calls to one source can return one record. Check whether `dedupeAndMergeAsync` tolerates a duplicate `SourceRecord.id`; it was not checked.*

> *Added 2026-11-02 (`plan/reports/P5-T07.md`, `P5-T08.md`, `P5-T09.md`, `P5-T10.md`; coordinator, under `plan/00` §6 item 313). (1) `src/model/merge.ts` joins this card's Files: read `"other"` as absent when choosing `type`, because a Crossref reference record otherwise makes the merged work "other" even after it is filled in (measured by `P5-T09`). (2) Measure how many of `work-with-references`' 155 DOIs Europe PMC resolves; a keyless, non-biomedical seed's references otherwise have no route to a title. If the share is poor against the definition of done's "still returns useful candidates", add a Crossref `lookup` over `filter=doi:` with one free, unkeyed recording, and re-price this card. (3) Call `findRelated` once per named strategy inside `cachedRelated`, never `"auto"`, which hides a failed route in a warning and would cache the partial page. (4) Drop `raw` before caching. (5) Status rows: a rejected call with `BadRequestError` 404 is "not indexed"; an empty page with a warning is "could not ask" (item 332(c)). (6) PubMed's records arrive hydrated, and `lookupById` is empty there, so step 3 skips them. `PPR` rows have no identifiers: keep them as they are. A DOI-only Europe PMC seed costs one `lookup` per call, so pass a PMID when known. One record can appear under two seeds. (7) Choose a budget within `docs/05` §6.1's 5–8; `GENERATOR_VALUE_ORDER` has no Crossref row. `docs/05` §6.1's generator list gains Crossref here.*

**Do.**
1. Generators A–E of `docs/05` §6.1: S2 forpaper, references, citations (keyed only, §0.2 item 19);
   pmra (PMID) — the window's "similar" source in v1 (decided below); Europe PMC citations/references;
   Crossref references (DOI).
2. `Promise.allSettled`; a failed generator becomes a per-source status row ("not indexed", "rate
   limited", "no key"), never a failed run.
3. Union, then `dedupeAndMergeAsync`; keep every edge on the merged work; hydrate survivors through
   `lookup` (S2 batch when keyed, else Europe PMC / efetch) and `backfillAbstracts`.
4. A keyless run passes `AbstractBackfillDeps.selected` without `semanticscholar` (item 194's
   mechanism), so the abstract fill-in sends no Semantic Scholar request (§0.2 item 19).
   *Corrected 2026-11-01 (review): `ABSTRACT_BACKFILL_LADDER` includes Semantic Scholar and the shipped
   `sources` default ticks it; otherwise §0.2 item 19 and `P5-T28`'s zero-request check fail. Made a
   step on 2026-11-01; not re-priced — one argument on a call this card already makes.*

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 320(a)):** what a keyless run does with Semantic
> Scholar. `P0-T22` measured 12 of 12 anonymous requests refused, and 12 in a row were refused on
> 2026-10-16. **No S2 request at all without a key — from the generators, the keyword generator or the
> abstract fill-in; the S2 generators report "no key" and the window says what a key adds (§0.2 item
> 19).** (Review line 2.)

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 321(c)):** co-citation. FR-15 names "co-cited" as an
> example chip; `docs/05` §2.2 designs a two-request batch version gated on `citationCount ≥ 20`. **Not
> in Phase 5; backlog** (§4). (Review line 11.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** two related-paper behaviours
> `docs/08` §5 draws and no card builds — a "Semantically similar" source for seeds without a PubMed id
> (`docs/08` §5.1 step 2; `docs/05` §9.5's "similar papers already in my library") and the preprint
> seed's "offer to fetch for the published version too" (`docs/08` §5.3). **"Similar" means PubMed's
> similar-articles list in v1 and the checkbox says so; both behaviours go to the backlog tagged Phase 5
> (§4); `docs/08` §5 is corrected by `P5-T16`.** (Review line 12; the owner may read it as scope.)

**Do NOT.**
- Do **not** hydrate the raw union (`docs/05` §9.1 item 2).
- Do **not** call OpenAlex (D2).

**Done when.**
- [ ] With every generator mocked, a DOI seed's union holds each generator's edges on merged works.
- [ ] One generator throwing leaves the others' results and a status row.
- [ ] A keyless run on a transport that fails on `api.semanticscholar.org` completes with the S2 rows reading "no key".
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- relatedGenerators` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedGenerators
```

**Notes.** Needs: `P2-T02`, `P2-T10`, `P2-T12` (built).

---

### P5-T13 — Related scoring, reason chips, recency de-emphasis

| Field | Value |
|---|---|
| **ID** | `P5-T13` |
| **State** | `TODO` |
| **Depends on** | `P5-T12` |
| **Blocks** | `P5-T14` |
| **Retires** | none |
| **Implements** | part of `FR-15`, `FR-18` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Each related candidate has a score in [0, 1], a list of reason chips drawn from its edges,
and a flag when it falls outside the recency window.

**Read first.**
- `docs/05-related-work-discovery.md` §6.2 (terms, weights, agreement bonus), §6.3 (what a reason looks like)
- `docs/10` FR-15 (chip names), FR-18 (older shown, de-emphasised, unchecked)

**Files.**
- create `src/pipeline/related/score.ts` (caller: `relatedPipeline.ts`, `P5-T14`)
- create `test/unit/pipeline/relatedScore.test.ts`

**Do.**
1. `docs/05` §6.2's blend with its starting weights; the similarity term takes a value from a
   `SimilarityFn` the pipeline injects (SPECTER2 or lexical, `P5-T14`); agreement bonus
   `0.08 × min(agreement, 3)`, then clip to [0, 1].
2. Reason chips: "cites seed", "cited by seed", "recommended", "similar (PubMed)", "similar", and the
   first citation context when one exists — chip ids, not strings (the window renders them).
3. `outsideWindow` when the year is outside `recencyWindow(searchYears)`; such rows default unchecked.

**Do NOT.**
- Do **not** let a missing term be `NaN` (`docs/05` §2.3's denominator lesson); a missing signal is 0.
- Do **not** drop out-of-window rows; FR-18 keeps them.

**Done when.**
- [ ] A candidate found by pmra and the recommender outranks one found by either alone at equal terms.
- [ ] Every candidate has ≥ 1 chip; no score is `NaN`.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- relatedScore` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedScore
```

**Notes.** Needs: nothing unbuilt.

---

### P5-T14 — Related pipeline: stages, partial results, wiring

| Field | Value |
|---|---|
| **ID** | `P5-T14` |
| **State** | `TODO` |
| **Depends on** | `P5-T11`, `P5-T12`, `P5-T13`, `P5-T19`, `P5-T20` |
| **Blocks** | `P5-T16` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-15`, part of `FR-16` |
| **Estimate** | 1.75 d |
| **Human gate** | none |

**Goal.** `createRelatedPipeline` runs `docs/07` §12.2 as reconciled by `P5-T01`, is registered under
`related`, and returns a scored, filtered, in-library-marked result set.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.5 (`Pipeline`), §12.2 (as `P5-T01` left it)
- `src/bootstrap/registerPipelines.ts` — `buildPipelineSet`, `createZoteroSummarizeLibrary` (the Zotero-read port precedent)
- `src/pipeline/registry.ts` — `PipelineSet`

**Files.**
- create `src/pipeline/related/relatedPipeline.ts` (caller: `buildPipelineSet`)
- create `src/pipeline/related/types.ts`
- modify `src/pipeline/registry.ts` (`PipelineSet.related`)
- modify `src/bootstrap/registerPipelines.ts` (constructs it; `createZoteroRelatedLibrary` — seed item read, `LibraryIndex`)
- modify `src/bootstrap/container.ts` (`installServices` passes the sources, cache and key probe in)
- create `test/unit/pipeline/relatedPipeline.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T01.md`, finding 8): `resumable: false`; declare the row type with `inLibrary` (decision 5). Decide the restart corners of `docs/07` §7.6: a `paused` or `queued` job of this pipeline has no window open for its result after a restart.*

> *Added 2026-11-02 (`plan/reports/P5-T19.md`, findings 3 and 6; DECIDED, coordinator, under `plan/00` §6 item 313): the similarity space is chosen once per run, from the key. A candidate with no vector scores similarity 0; there is no per-candidate fallback to the lexical space. On the lexical path, the corpus is the seed plus the merged candidates, which needs no Zotero read. Call `lexicalSpace(corpus)` once per run.*

> *Added 2026-11-02 (`plan/reports/P5-T15.md`): `createZoteroRelatedLibrary` can reuse `canonicalWorkOfItemID` in `src/zotero/itemMapper.ts`.*

**Do.**
1. Stages: resolve seed → expand ids → generators (partial results allowed) → candidate vectors →
   score → filter (self, type) → mark in-library through `LibraryIndex.findExisting` and
   `matchAgainstLibrary`; output rows with chips, score, `inLibrary`, `outsideWindow`. The input may
   instead carry `chosenSeed` — one of the candidates `P5-T11` returned under `"choose"`, picked in
   `P5-T16`'s window — and then the run starts at "expand ids" without resolving again.
2. Candidate vectors before the similarity term: on a keyed run, one `ensureEmbeddings` pass
   (`P5-T20`) over the seed and the merged survivors, cache first, ≤ 200 ids per batch call. Inject the
   `SimilarityFn`: SPECTER2 cosine when keyed and both vectors exist (`P5-T20`), else the lexical cosine
   (`P5-T19`), never mixed within one run.
3. Cancellation through the token at every stage boundary; a keyless run carries a `keyNotice`.

**Do NOT.**
- Do **not** call `Zotero.*` from the pipeline's own files; Zotero reads arrive through the port, so the
  stages run under `vitest`. *Corrected 2026-11-01 (review): the draft called this a layering rule
  ("do not import `zotero/` from `pipeline/`"), but `docs/07` §2.3 and `eslint.config.js`'s
  `research-helper/layering/pipeline` forbid only `ui/`, and ten `src/pipeline/` files import `zotero/`;
  the port is the testability convention `createZoteroSummarizeLibrary` set.*
- Do **not** write to the library; import is `P5-T17`'s.

**Done when.**
- [ ] On mocked sources a DOI seed yields ≥ 20 scored rows, each with a chip (the DoD's count, offline).
- [ ] An owned candidate is `inLibrary` and unchecked; the seed never appears.
- [ ] Cancel mid-generation ends the job `Cancelled` with no partial write.
- [ ] A run given `chosenSeed` makes no seed-resolution call; a keyed run on mocked sources fetches candidate vectors in ⌈n / 200⌉ batch calls before scoring, and a keyless run makes none.
- [ ] Mutation sweep; `npm run typecheck`, `npm run test:unit -- relatedPipeline container` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedPipeline container && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P1-T16`, `P3-T29` (built). `registerPipelines.ts` and `container.ts` were changed by
`P4-T18` and may be by `P4-T20`; grep `buildPipelineSet` and `installServices` before editing.
*Re-estimated 2026-11-01, 1.5 → 1.75 d* (the review's "likely" figure): the picker's continuation
needs the pipeline to accept a chosen seed, and candidate vectors must be fetched before the similarity
term; neither was a step.

---

### P5-T15 — Item menu entry and the window's related mode

| Field | Value |
|---|---|
| **ID** | `P5-T15` |
| **State** | `TODO` |
| **Depends on** | `P5-T02` |
| **Blocks** | `P5-T16`, `P5-T26` |
| **Retires** | none |
| **Implements** | `FR-13` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** "Find Related Papers…" sits in a new item context submenu, enabled for exactly one regular
item, and opens the search window in `related` mode with the seed's header.

**Read first.**
- `docs/08-ui-ux-spec.md` §2.2 (context members), §2.4 (the `rh-menu-item` block), §5.2 (the wireframe's header)
- `src/ui/menus/registerMenus.ts` header — why no item menu exists yet
- `plan/README.md` §6 — Fluent mutations and `l10n.spec.ts`

**Files.**
- modify `src/ui/menus/registerMenus.ts` (a new `itemMenuOptions`)
- modify `src/bootstrap/registerUI.ts` (registers it behind `related.enabled`; the opener)
- modify `src/ui/dialogs/searchDialog.ts` (`related` mode carries `seedItemID`)
- modify `addon/content/searchDialog.xhtml`, `addon/content/searchDialog.js` (seed header, Include row)
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`, `addon/locale/ko-KR/research-helper-mainWindow.ftl`,
  `addon/locale/en-US/research-helper-searchDialog.ftl`, `addon/locale/ko-KR/research-helper-searchDialog.ftl`
- modify `src/i18n/keys.ts` (ids; `KO_PENDING_REVIEW`)
- modify `docs/10-requirements-and-user-stories.md` (FR-13's tooltip sentence — only if step 1 measures no tooltip; dated note)
- modify `test/integration/menus.spec.ts`, `test/integration/lifecycle.spec.ts`, `test/integration/l10n.spec.ts`, `test/unit/i18n/keys.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T01.md`, finding 6): `docs/07` §3.4 still says "Find related" accepts 1..N items, against `plan/00` §6 item 321(b). This card corrects it with FR-13.*

**Do.**
1. `rh-menu-item` with `research-helper-menu-item-find-related`, enabled when exactly one regular item
   is selected (decided below), hidden when `related.enabled` is false. Measure whether Zotero's menu
   shows a tooltip on a disabled entry; if it does, give the reason there, and if not, correct FR-13's
   "with an explanatory tooltip" under a dated note.
2. The window opens with `{ mode: "related", seedItemID }`; header shows title, authors, venue, year,
   DOI; the "Include" checkboxes per relation kind; year controls default to "Any" (`docs/08` §5.2).
3. Strings with commented ko-KR stubs on `KO_PENDING_REVIEW`.

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 321(b)):** multi-selection (FR-13 scenario 2). **The
> entry is disabled unless exactly one regular item is selected, as `docs/08` §2.4's code does; a
> tooltip gives the reason where Zotero's menu shows one on a disabled item — otherwise no tooltip, and
> FR-13's "with an explanatory tooltip" is corrected.** Multi-seed "Find papers related to N items"
> is not built. (Review line 10.)

**Do NOT.**
- Do **not** read `context.collectionTreeRow` (singular); `docs/08` §2.2.
- Do **not** machine-translate.

**Done when.**
- [ ] The entry appears for one item, is disabled for two, and is absent while `related.enabled` is false.
- [ ] A disable/enable cycle leaves no menu and no window.
- [ ] `l10n.spec.ts` resolves every new id in both locales.
- [ ] `npm run typecheck`, `npm run test:unit -- keys` and the integration suite pass (three runs if one fails).

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- keys && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P1-T19`, `P2-T22` (built). The first `main/library/item` registration in the plugin.

---

### P5-T16 — Related results: relation column, picker, key notice

| Field | Value |
|---|---|
| **ID** | `P5-T16` |
| **State** | `TODO` |
| **Depends on** | `P5-T14`, `P5-T15` |
| **Blocks** | `P5-T17` |
| **Retires** | part of `R-3` |
| **Implements** | `FR-15` (UI), `FR-16` (marking), `FR-18` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** The related mode runs the pipeline and shows each row's relation, reasons and score, marks
in-library rows unchecked, greys out-of-window rows, asks the user to pick an ambiguous seed, and tells
a keyless user what a key adds.

**Read first.**
- `docs/08-ui-ux-spec.md` §5.2 (Relation and Score columns), §5.3 (edge cases), §4.3 (the shared table)
- `src/ui/viewModels/searchImportViewModel.ts` — `RowMarker`, `toWindowRecords`, `KEY_NOTICE_SOURCE_ID`

**Files.**
- create `src/ui/viewModels/relatedViewModel.ts` (caller: the window host in `registerUI.ts`) — *a guess at the split:*
  if the window's document cannot host a second view model, extend `searchImportViewModel.ts` instead and report it
- modify `src/bootstrap/registerUI.ts` (`publishSearchWindowHost` hands the related pipeline in)
- modify `addon/content/searchDialog.js`, `addon/content/searchDialog.xhtml`
- modify the two `research-helper-searchDialog.ftl` bundles, `src/i18n/keys.ts`
- modify `docs/08-ui-ux-spec.md` (§5.1 step 2 "similar"; §5.2 note on years; §5.3 picker and the preprint line; §7.4 key text; dated notes)
- create `test/unit/ui/relatedViewModel.test.ts`; modify `test/integration/searchDialog-flow.spec.ts`

> *Added 2026-11-02 (`plan/reports/P5-T19.md`, finding 2): this card renders the "basic similarity" label (`LEXICAL_SIMILARITY_LABEL_ID`) that `docs/05` §5.5 requires, on a keyless run. The string goes through `G-41`.*

> *Added 2026-11-02 (`plan/reports/P5-T15.md`): give the related mode its own view model and `connectHost`, then remove `P5-T15`'s guards in `connectHost`, `search()` and `onYearChanged`. Read `query.related`; a year of `NaN` means no bound. Add the Include counts. Decide how a run starts, because the wireframe has no Search button and the button is hidden. Decide what a re-open does: opening a second seed reloads the one window, so a running job would keep running with no view (not measured).*

> *Added 2026-11-02 (owner, `plan/00` §6 item 334(c)): "Restrict to last 3 years" is not built, and `docs/08` §5.2's wireframe no longer draws it. The year lists do the same. FR-18's rule, that older candidates are shown de-emphasized and unchecked, is a separate matter and is unaffected.*

**Do.**
1. Documents first (decided below and on `P5-T12`, `P5-T28`): `docs/08` §5.2's year note cites FR-18's
   de-emphasis; §5.3 gains the title-match picker and loses the preprint seed's "fetch for the
   published version too" (backlog); §5.1 step 2's "Semantically similar" becomes PubMed's similar
   articles and its checkbox says so; §7.4's "Related papers and recommendations need a key" becomes
   "work better with a key" (item 320(a)).
2. Relation column and chips, score as dots, in-library marker (unchecked), out-of-window rows greyed
   and unchecked, per-source status rows, the keyless notice with the key-request link.
3. A `"choose"` seed shows the candidates; the run continues with the user's pick as `P5-T14`'s
   `chosenSeed`.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** year handling. FR-18 says "the
> default 3-year window is active … older candidates are still shown but visually de-emphasized and
> unchecked"; `docs/08` §5.2 draws no year filter by default and a "Restrict to last 3 years" box,
> unticked. **Both — no filter by default, and rows outside the `searchYears` window greyed and
> unchecked.** (Review line 13.)

**Do NOT.**
- Do **not** import `sources/`, `llm/`, `tts/` or `zotero/` from `ui/` (layering). *Corrected 2026-11-01
  (review): the draft listed `pipeline/`, which `ui/` may import (`docs/07` §2.3; `eslint.config.js`'s
  `research-helper/layering/ui`), and omitted `sources/` and `tts/`, which it may not.*
- Do **not** show a raw score without its chips.

**Done when.**
- [ ] The view-model test renders chips, in-library and out-of-window states from a fixture result.
- [ ] `searchDialog-flow.spec.ts` drives a related run on mocked sources to a populated table.
- [ ] Mutation sweep on the view model; `npm run typecheck` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedViewModel && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P1-T20`, `P1-T21` (built). `docs/08`, `registerUI.ts` and `searchDialog.*` are
`P4-T20`'s while it runs (item 325); wait for its commit.

---

### P5-T17 — Import from related results, optional *Related* link

| Field | Value |
|---|---|
| **ID** | `P5-T17` |
| **State** | `TODO` |
| **Depends on** | `P5-T02`, `P5-T16` |
| **Blocks** | `P5-T28` |
| **Retires** | none |
| **Implements** | `FR-16`, `FR-17` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Importing the ticked related rows creates exactly those items (or adds existing ones to the
target), with abstracts, and links each to the seed both ways when the box is ticked.

**Read first.**
- `docs/10` FR-16, FR-17; `docs/08` §5.1 step 5 (both sides, inside the batch transaction)
- `src/zotero/importer.ts` — the `versionPairs` relation pass, "an existing item is added to a collection and nothing more"
- `src/pipeline/searchImport/types.ts` — `SearchImportInput.records` / `works` / `target`

**Files.**
- modify `src/zotero/importer.ts` (`ImportRequest.relateTo?: itemID`; a second relation pass)
- modify `src/pipeline/searchImport/types.ts`, `src/pipeline/searchImport/searchImportPipeline.ts` (carry `relateTo`)
- modify `src/bootstrap/registerPipelines.ts` (the Zotero import port passes `relateTo` to `importWorks`) —
  *corrected 2026-11-01 (review), rule 10: `importWorks`'s only callers are this file's two calls (grep), so
  without it `relateTo` never reaches the importer*
- modify `src/ui/viewModels/relatedViewModel.ts` (import request; the checkbox from `related.linkToSeed`)
- modify `src/bootstrap/registerUI.ts` (the window host's import route)
- create `test/integration/zotero/relatedLinkage.spec.ts`

**Do.**
1. Import through the search pipeline's preview import, default target named after the seed
   (`docs/08` §5.2's "Related to …"), duplicate policy `link-existing`.
2. When `relateTo` is set: `seed.addRelatedItem(item)` and `item.addRelatedItem(seed)`, `save()` each
   inside one transaction, for the items decided below; a failure is reported, not thrown.
3. Verify how the preview import writes search provenance for a non-keyword run, and suppress it
   for related imports (decided below).

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** which items get the seed link.
> FR-17 says "each imported item"; `importWorks` leaves an existing item untouched except for the
> collection add. **Created items and linked-existing items alike, since the user ticked the box and a
> relation is additive and removable in Zotero's own pane.** (Review line 15.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** a provenance note for related and
> recommend imports. FR-8's provenance note is the keyword search's, and `SearchProvenance` (`docs/07`
> §5.3) is query-shaped. **None in v1; the job record keeps the seed or profile id.** (Review line 16.)

**Do NOT.**
- Do **not** write relations with `saveTx()` inside the transaction (`docs/01` §5.8).
- Do **not** import a row the user did not tick (`docs/05` §6.3: never auto-add).

**Done when.**
- [ ] Importing 10 of 20 rows, 2 of them in library, creates 8 items and links 2 (spec), each related to the seed both ways when ticked and not at all when unticked.
- [ ] Mutation sweep on the relation pass; `npm run typecheck` and the integration suite pass (three runs if one fails).

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- importStrategy && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P1-T14`, `P2-T11`, `P2-T31` (built). The DoD's "exactly 10 items (or links existing
ones)" line is proved here offline and in `P5-T30` live.

---

### P5-T18 — Collection reader and statistical profile

| Field | Value |
|---|---|
| **ID** | `P5-T18` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T03` |
| **Blocks** | `P5-T21`, `P5-T22` |
| **Retires** | none |
| **Implements** | part of `FR-44`, part of `FR-46` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** From a collection, code builds the statistical half of `CollectionProfile` — weighted MeSH and
keywords, authors, venues, years, the membership hash, the collection's and the library's owned sets —
and stores it.

**Read first.**
- `docs/05-related-work-discovery.md` §7.2 — `CollectionProfileDraft`, term weighting, the check-tag exclusion list
- `docs/07-architecture-and-data-model.md` §5.2 `CollectionProfile`, §8.3 `collection_profile`
- `src/zotero/itemMapper.ts` — `fromZoteroItem`, the `MeSH:` / `MeSH*:` tag reading

**Files.**
- create `src/pipeline/recommend/profile.ts` (`buildProfileStats`; caller: `recommendPipeline.ts`, `P5-T25`)
- modify `src/zotero/itemMapper.ts` (`ZoteroItemSnapshot.dateAdded`, optional, filled by `snapshotZoteroItem`; never copied into `CanonicalWork`)
- modify `src/bootstrap/registerPipelines.ts` (`createZoteroRecommendLibrary`: collection items, library term counts, `LibraryIndex`,
  and each item's `dateAdded` from the snapshot — *corrected 2026-11-01 (review): `P5-T21` needs `addedAt`, and
  `src/zotero/itemMapper.ts` reads no `dateAdded` (grep), so the port is the only route; this answers the
  author's open question. Updated 2026-11-01 (decisions): the port reads it through the item mapper's
  snapshot, as `SummaryRunItemSnapshot.dateAdded` does in `src/zotero/notes.ts`*)
- create `test/unit/pipeline/recommendProfile.test.ts`
- modify `test/unit/zotero/itemMapper.test.ts` (a snapshot with `dateAdded` maps to the same `CanonicalWork` as one without)

> *Added 2026-11-02 (`plan/reports/P5-T03.md`): build ids with `collectionProfileId`, and carry `userEdits` across a rebuild, because `put` replaces the row.*

**Do.**
1. `dateAdded` on the item mapper: add it to `ZoteroItemSnapshot` as an optional field (the two literal
   snapshots in `itemMapper.test.ts` and `preprintMapping.test.ts` then stay valid — grepped 2026-11-01;
   check again), fill it in `snapshotZoteroItem` from `item.dateAdded`, and leave `canonicalWorkFromSnapshot`
   ignoring it (`docs/05` §7.2: `addedAt` is not on the record). Then read the collection's regular items
   as `CanonicalWork`s with their `dateAdded` beside them; refuse fewer than 5 (FR-44).
2. Term weight `(countInCollection / size) · ln(1 + librarySize / (1 + countInLibrary))`; drop the
   check tags; prefer major-topic MeSH; authors ≥ 2 plus every last author; top venues; year histogram.
3. `membershipHash` over sorted item keys and `dateModified`; `ownedInCollection` and
   `ownedInLibrary` identifier sets, computed on each run and **not** stored on the profile *(corrected 2026-11-02, `P5-T01` decision 6: `knownWorkKeys` is the source collection only)*; persist the profile through `P5-T03`'s store.

**Do NOT.**
- Do **not** count `Humans`, `Animals`, `Male`, `Female` … as topics.
- Do **not** send anything anywhere; this card is local.

**Done when.**
- [ ] A 30-item fixture profile ranks a MeSH term present on every library item below one specific to the collection.
- [ ] The hash changes when an item is added or modified and not otherwise.
- [ ] `itemMapper.test.ts` shows `dateAdded` changes no field of the mapped `CanonicalWork`.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- recommendProfile itemMapper preprintMapping` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendProfile itemMapper preprintMapping
```

**Notes.** Needs: `P1-T12` (built). The library-wide term counts are one pass per run; measure on the
owner's library in `P5-T30`. `src/zotero/itemMapper.ts` is on `plan/README.md` §4's replaced-spike list;
this card extends it and grep its importers first. *Re-estimated 2026-11-01, 1.25 → 1.5 d:* the
`dateAdded` read moved onto the item mapper (the review's gap; coordinator's instruction under item 313).

---

### P5-T19 — Lexical similarity floor (TF-IDF)

| Field | Value |
|---|---|
| **ID** | `P5-T19` |
| **State** | `TODO` |
| **Depends on** | `P5-T01` |
| **Blocks** | `P5-T14`, `P5-T21`, `P5-T24` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-44` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A local TF-IDF cosine over title, abstract and MeSH gives a similarity in [0, 1] for any two
works, with no network and no key — the floor every similarity term falls back to.

**Read first.**
- `docs/05-related-work-discovery.md` §5.5 — weights (MeSH 2×, title 1.5×), IDF from the user's collection, "basic similarity" label

**Files.**
- create `src/pipeline/shared/lexical.ts` (callers: `relatedPipeline.ts` (`P5-T14`), `src/pipeline/recommend/score.ts` (`P5-T24`), `centroids.ts` (`P5-T21`))
- create `test/unit/pipeline/lexical.test.ts`

**Do.**
1. Tokenise with the same normalisation as `normalizeTitle`; IDF built from a supplied corpus; sparse
   vectors; cosine.
2. Expose `lexicalSpace(corpus)` returning `{ vector(work), cosine(a, b) }` and the label id
   "basic similarity".

**Do NOT.**
- Do **not** mix a lexical score with an embedding cosine in one term (§0.2 item 22).

**Done when.**
- [ ] Identical works score 1; disjoint ones 0; MeSH overlap moves the score more than abstract overlap.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- lexical` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- lexical
```

**Notes.** Needs: nothing unbuilt. `docs/03` §13.2 calls this BM25; `docs/05` §5.5 calls it TF-IDF.
This card follows `docs/05`, which owns the feature.

---

### P5-T20 — SPECTER2 vectors: fetch, normalise, store

| Field | Value |
|---|---|
| **ID** | `P5-T20` |
| **State** | `TODO` |
| **Depends on** | `P5-T03`, `P5-T05` |
| **Blocks** | `P5-T14`, `P5-T21`, `P5-T24` |
| **Retires** | none |
| **Implements** | part of `FR-44` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** With a key, SPECTER2 vectors for works the cache lacks are fetched 200 per batch call,
L2-normalised once, stored with their model name, and compared only within that model.

**Read first.**
- `docs/05-related-work-discovery.md` §5.1–§5.2 (`embedding.specter_v2`, not plain `embedding`; 200 per batch; normalise once), §5.4
- `docs/07-architecture-and-data-model.md` §13 item 5 — the open "do embeddings ship in v1"

**Files.**
- modify `docs/07-architecture-and-data-model.md` (§13 item 5 answered; dated note)
- modify `docs/03-llm-provider-integration.md` (§16's "Embeddings for recommendation" row, and its "User has only an
  Anthropic key" row, whose "BM25 + LLM re-rank" also turns on `P5-T22`'s `RECOMMEND_RANK` line; dated note —
  *corrected 2026-11-01 (review): the second row was missing*)
- modify `src/sources/semanticscholar/semanticscholarSource.ts` (`fetchEmbeddings(ids)` over `/paper/batch`)
- create `src/pipeline/shared/embeddings.ts` (`ensureEmbeddings`, `cosine`; callers: `relatedPipeline.ts`, `recommendPipeline.ts`, `centroids.ts`)
- create `test/unit/pipeline/embeddings.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T19.md`, finding 8): `docs/03` §13.2 and §16 still say "TF-IDF / BM25"; this card corrects both to TF-IDF, following `docs/05`.*

> *Added 2026-11-02 (`plan/reports/P5-T03.md`): `createEmbeddingStore` does not evict on its own, so `ensureEmbeddings` calls `evictToCap(isInLibrary)` after each `putMany`, with a synchronous predicate over library work keys. Prefer `getMany` to `allForModel`: a read returns one JavaScript number per byte, measured only at 1 000 vectors.*

**Do.**
1. Documents first: answer `docs/07` §13 item 5 and align `docs/03` §16 with the decision below.
2. `fetchEmbeddings`: `fields=embedding.specter_v2`, ≤ 200 ids per call, papers without a vector
   reported, never retried individually.
3. `ensureEmbeddings(works, model)`: store first, fetch the missing, normalise, write through the
   `embedding` store tagged `specter_v2`; `cosine` refuses vectors of two models.

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 320(b)):** the v1 embedding route (`docs/07` §13 item 5;
> §5.3, was `plan/05` §2.3). `docs/05` §5.1 defaulted to SPECTER2 with `text-embedding-3-small@768` as fallback;
> `docs/03` §16 to `gemini-embedding-2`, then `text-embedding-3-small`, then BM25; OpenRouter's coverage
> is `Unverified`. **SPECTER2 through Semantic Scholar when a key is present, `P5-T19`'s local TF-IDF
> word overlap otherwise; no third-party embedding service.** `docs/03` §16's Anthropic-only row
> loses its "LLM re-rank" too, because `RECOMMEND_RANK` is not built (item 320(c)). (Review line 3.)

**Do NOT.**
- Do **not** request plain `embedding` (SPECTER v1, a different space).
- Do **not** store vectors in a synced field, a note or a preference (`docs/05` §5.4).

**Done when.**
- [ ] 450 uncached ids cost 3 batch calls; a second run costs 0.
- [ ] A stored vector has norm 1 ± 1e-6; `cosine` throws on mixed models.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- embeddings semanticscholar` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- embeddings semanticscholar
```

**Notes.** Needs: `P2-T05` (built). Background prefetch (`docs/05` §9.6) is not here (§4).

---

### P5-T21 — Centroids and seed selection with negatives

| Field | Value |
|---|---|
| **ID** | `P5-T21` |
| **State** | `TODO` |
| **Depends on** | `P5-T18`, `P5-T19`, `P5-T20` |
| **Blocks** | `P5-T23`, `P5-T24` |
| **Retires** | none |
| **Implements** | part of `FR-44`, part of `FR-49` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** A profile carries k = 1–4 centroids when vectors exist, and 10–20 diversified positive seeds
plus up to 10 negatives from the collection's dismissals, read from the store on each run and not held on the profile *(corrected 2026-11-02, `P5-T01` decision 9)*.

**Read first.**
- `docs/05-related-work-discovery.md` §7.2 "Seed selection" (weights, `addedAt` from `dateAdded`, the 0.92 diversification cut), "Multi-topic collections" (`kMax: 4, minClusterSize: 5, minGain: 0.08`), "Negative examples"

**Files.**
- create `src/pipeline/recommend/centroids.ts` (`kmeansAuto`; caller: `recommendPipeline.ts`)
- create `src/pipeline/recommend/seeds.ts` (`selectSeeds`; caller: `recommendPipeline.ts`)
- create `test/unit/pipeline/recommendSeeds.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T19.md`, findings 1 and 5): `seeds.ts` is the lexical caller, not `centroids.ts`. §7.2's 0.92 diversification cut never triggered on 142 recorded abstracts on the lexical space, so measure it there rather than reuse the number, and record what is chosen.*

> *Added 2026-11-02 (`plan/reports/P5-T03.md`): rejected papers come from `listRejected(profileId, 10)`.*

> *Added 2026-11-02 (`plan/reports/P5-T18.md`; coordinator, under `plan/00` §6 item 313): `addedAtByWorkKey(items)` and the members from `readCollectionWorks` are the inputs. Use `rankedTerms` or `termWeights` for centroid labels. `seeds` and `centroids` start empty in the record.*

**Do.**
1. `kmeansAuto` on SPECTER2 vectors, k chosen by silhouette with `docs/05`'s guards and a seeded
   initialisation (deterministic); no centroids on the lexical path (`docs/07` §5.2: empty array).
2. `selectSeeds` as `docs/05` §7.2 writes it, `addedAt` passed in, diversification on the run's
   similarity space; cap at `RECOMMEND_MAX_POSITIVES`.
3. Negatives: the 10 most recent rejections for this collection (`P5-T03`'s store; *corrected 2026-11-02 from "this profile": "Not interested" is per collection, review line 22*).
4. *Added 2026-11-02 (`P5-T01` finding 2; coordinator, under `plan/00` §6 item 313):* name each centroid in code, by its members' highest-weighted term, into `centroidLabels`, which `P5-T27` groups by. No model call. The lexical path has no centroids, so it has no labels, and the window falls back to a numbered group.

**Do NOT.**
- Do **not** read `addedAt` off the record (`docs/05` §7.2: it is not on `CanonicalRecord`).
- Do **not** use `Math.random` unseeded; two runs must agree.

**Done when.**
- [ ] A two-topic fixture yields k = 2 and seeds from both topics.
- [ ] Two runs on unchanged input produce identical seeds and centroids.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- recommendSeeds` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendSeeds
```

**Notes.** Needs: nothing unbuilt.

---

### P5-T22 — `COLLECTION_PROFILE` call with estimate and consent

| Field | Value |
|---|---|
| **ID** | `P5-T22` |
| **State** | `TODO` |
| **Depends on** | `P5-T18` |
| **Blocks** | `P5-T25` |
| **Retires** | none |
| **Implements** | part of `FR-44`, part of `FR-45` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** When a provider is configured, one `COLLECTION_PROFILE` call per profile build supplies the
focus statement and suggested query terms *(corrected 2026-11-02, `P5-T01` finding 3: core topics and exclusion signals had no field and no reader)*, priced, disclosed and
confirmed like every other LLM job, and cached on membership, prompt and model.

**Read first.**
- `docs/12-prompt-library.md` §15 (prompt, schema, "Strong model, `temperature: 0.2`, `max_tokens: 2500`"), §18.5 (tier, effort "not assigned")
- `docs/09-security-privacy-and-api-keys.md` §3 row "6. Recommend" — what may reach the LLM
- `src/pipeline/shared/egressDisclosure.ts`, `estimate.ts`; `confirmRunCost` in `src/bootstrap/registerUI.ts`

**Files.**
- modify `docs/12-prompt-library.md` (§15 input table and §16's "not built in v1"; dated note) — `docs/09` §3 row 6 was corrected on 2026-11-02 by the pass that applied items 320 and 323; this card checks its wording against what it builds
- create `src/prompts/collection-profile.v1.0.0.md`, `src/prompts/schemas/collection-profile.v1.json`
- modify `src/prompts/index.ts` (`PROMPT_IDS`, `PROMPT_FILE_NAMES`, `PROMPT_SCHEMAS`), `src/prompts/bundled.ts`
- create `src/pipeline/recommend/profileCall.ts` (caller: `recommendPipeline.ts`, `P5-T25`)
- modify `src/pipeline/shared/estimate.ts` (one priced call), `src/pipeline/shared/egressDisclosure.ts` (a profile notice id)
- modify the two `research-helper-mainWindow.ftl` bundles, `src/i18n/keys.ts`
- create `test/unit/pipeline/recommendProfileCall.test.ts`; modify `test/integration/prompts.spec.ts`

**Do.**
1. Documents first: correct `docs/12` §15's `{{DIGESTS}}` row to the input decided below, and record
   that `RECOMMEND_RANK` (§16) is not built in v1 (decided below). `docs/09` §3 row 6 already says
   both (dated note of 2026-11-02); if what this card sends differs, stop.
2. The prompt file is `docs/12` §15 byte for byte; the schema is its "Expected output".
3. Build the per-item lines — item key, title, year, venue, top subject terms — because the answer
   cites papers by 8-character item key (`exampleItemKeys`); plan scope `metadata-only` through
   `allowedInputScope`; price one call at the `strong` tier's model with output at 2 500 tokens; send no
   reasoning-effort setting (decided below); disclose and confirm through the existing dialog
   (`mustAskConfirmation`), whose "don't ask again" is a record of its own for recommend runs (decided
   below); call through `withBudget` and `completeJSON`; validate; map
   `focusStatement`/`suggestedQueryTerms` to `narrative`/`suggestedQueries`; keep the answer's output
   token count on the profile for `P5-T30`.
4. No provider: skip the call and mark the profile "heuristic" (FR-45 scenario 2).

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 320(d)):** what `COLLECTION_PROFILE` is sent. `docs/12`
> §15 feeds it "paper digests", which `docs/06` §6.1 item 5 says are built from `PaperSummary` objects;
> `docs/09` §3 row 6 allowed "top terms, subjects, venues, years, and optionally a sample of titles".
> **One metadata line per paper — its Zotero item key, title, year, venue and top subject terms — under
> scope `metadata-only`, with no abstracts and no summaries; `docs/09` §3 row 6 corrected to say so**
> (done 2026-11-02). (Review line 5.)

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 320(c)):** which model calls Phase 5 makes at all. FR-45
> asks for LLM-assisted *query generation*; `docs/12` §16 `RECOMMEND_RANK` would also re-rank every
> candidate batch, and `docs/07` §12.5 adds "optional LLM rationales". **`COLLECTION_PROFILE` only, once
> per profile, cached until the collection changes; scores and reasons in code (`docs/05` §7.4, FR-47);
> `RECOMMEND_RANK` and model-written rationales are not built in v1 (backlog, §4).** (Review line 4.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** how much reasoning the profile call
> asks for. **None sent, as `docs/12` §18.5 says ("not assigned"); the acceptance run (`P5-T30`) records
> how much of the 2 500-token answer limit was used.** (Review line 7.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** "don't ask again" on the cost
> question for recommend runs. **A record of its own, as for report runs (item 292(f)); a confirmation
> forced by money still opens (item 274(b)).** (Review line 36.)

**Do NOT.**
- Do **not** edit or translate the prompt text.
- Do **not** call an adapter directly; the router through `withBudget` only.
- Do **not** send abstracts, notes or summaries (item 320(d)).

**Done when.**
- [ ] On the mock router, a 30-item profile makes one call; a second run with unchanged membership makes none.
- [ ] Strict privacy mode still allows `metadata-only` and the egress notice names the model and the scope.
- [ ] A schema-invalid answer is repaired once, then the profile falls back to "heuristic" with a warning.
- [ ] The request carries no reasoning-effort field; a summarize run's "don't ask again" does not skip a recommend run's question (test).
- [ ] Mutation sweep; `npm run typecheck`, `npm run test:unit -- recommendProfileCall prompts` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendProfileCall prompts && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P3-T12`, `P3-T15`, `P3-T16`, `P3-T24` (built). `docs/12` and `estimate.ts` were
changed by `P4-T18` (built); grep before editing. `docs/12` §15's cache key ("sorted `(itemKey, contentHash)`") and `docs/07`'s
`membershipHash` (item keys + `dateModified`) differ; this card keys on `membershipHash` and notes it.

---

### P5-T23 — Recommendation candidate generators

| Field | Value |
|---|---|
| **ID** | `P5-T23` |
| **State** | `TODO` |
| **Depends on** | `P5-T06`, `P5-T07`, `P5-T08`, `P5-T10`, `P5-T21` |
| **Blocks** | `P5-T24`, `P5-T25` |
| **Retires** | part of `R-3` |
| **Implements** | `FR-45` |
| **Estimate** | 1.75 d |
| **Human gate** | none |

**Goal.** From a profile, the generators of `docs/05` §7.3 run under one request budget, in value order,
and their union is merged; keyword queries go through Phase 2's `fanOut` with the recency window.

**Read first.**
- `docs/05-related-work-discovery.md` §7.3 (generators, budget per host), §9.3 (value order), §9.4
- `src/pipeline/searchImport/stages.ts` `fanOut`; `src/sources/shared/queryParse.ts` `parseUserQuery`

**Files.**
- create `src/pipeline/recommend/generators.ts` (caller: `recommendPipeline.ts`, `P5-T25`)
- create `test/unit/pipeline/recommendGenerators.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T08.md`, `P5-T10.md`): `findSimilarForSeeds` throws above 10 seeds; count one `elink` plus its `efetch` batches (up to 5 at limit 100 over 10 seeds) against `RequestBudget`, and re-read "a budget of 12 runs (a) and (b) fully" against that. `fanOut` has no cache hook, so step 1(d) wraps one source and one query at a time. For one request over several seeds: `readRelated` per seed, `tryTake(1)`, then `writeRelated` or `writeRelatedMissing` per seed. Build cache keys from identifiers, never from a URL, which can hold a key.*

> *Added 2026-11-02 (`plan/reports/P5-T18.md`, `P5-T22.md`; coordinator, under `plan/00` §6 item 313): use `rankedTerms`, which fixes the order. `suggestedQueries` can be empty with `origin: "llm"` and has no cap, because the schema has no `maxItems`, so this card falls back to the top terms and sets its own cap.*

**Do.**
1. (a) S2 `recommend` with the seeds and negatives (keyed); (b) pmra over ≤ 10 PMID seeds; (c) forward
   citations of the top seeds (S2 keyed, else Europe PMC); (d) keyword queries — the profile's
   `suggestedQueries` when the LLM ran, else its top-weighted terms — through `fanOut` over the
   `sources` preference's members with the recency window; (e) an author watch: one Europe PMC query
   OR-ing the top 5 authors over the last 90 days.
2. Per topic group (decided below): when the profile has k > 1 centroids, generator (a) runs once per
   topic group with that group's seeds — at most 4 POSTs, taken from the budget first — and the other
   generators run once; each candidate records which topic group's request found it. *Corrected 2026-11-02 (`P5-T01` finding 1 and decision 12): its nearest topic needs its vector, which `P5-T25` fetches after generation, so `topicIndex` is set at `Scoring` (`P5-T24`), and `P5-T27` groups by that.*
3. Keyless: generator (a) and the S2 half of (c) are skipped before any request, and (d)'s source list
   drops `semanticscholar` (§0.2 item 19).
4. `RequestBudget` of 40 by default, taken in `docs/05` §9.3's order; `Promise.allSettled`; per-generator
   status rows.
5. Union, `dedupeAndMergeAsync`, every generator kept on the merged work.

*Corrected 2026-11-01 (review), two gaps between this card's steps and what the cards around it assume;
made steps 2 and 3 on 2026-11-01 (decisions):*
- *Step 1 (d) fans out over the `sources` preference, whose shipped default includes `semanticscholar`,
  and the Semantic Scholar adapter's `isConfigured()` is `true` without a key (grep). Under §0.2 item 19
  a keyless run drops `semanticscholar` from (d)'s source list; otherwise `P5-T28`'s "zero requests to
  `api.semanticscholar.org`" fails on this generator. (`docs/05` §7.3 named "Europe PMC + arXiv" for (d)
  while FR-45 says "the selected sources"; FR-45 is followed, and `docs/05` §7.3's row was corrected
  under a dated note on 2026-11-02.)*
- *Per-cluster generation: this card's own **Do NOT** ("more than once per cluster") and `P5-T27`'s
  grouping by centroid assume generation per cluster (`docs/05` §7.2, "run generation per cluster and
  interleave results, labelling each group"), but no step built it. The estimate was raised 1.5 → 1.75 d
  for it.*

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 321(d)):** the generator set. **All five of `docs/05`
> §7.3, with the author watch included because it is one request and `docs/05` calls it "often the
> single most valued recommendation type".** (Review line 26.)

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 323(a)):** what the literature databases receive. Besides
> the queries, (a) sends up to 15 of the collection's paper identifiers and up to 10 dismissed papers'
> identifiers to Semantic Scholar, (b) sends PubMed identifiers to NCBI, (c) sends identifiers, and (e)
> sends the five most frequent authors' names to Europe PMC. **The design sends them; `docs/09` §3 row 6
> names them (corrected 2026-11-02) and the recommend window's notice shows them (`P5-T26`).** (Review
> line 8.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** multi-topic collections. **One
> Semantic Scholar recommendation request per topic group with that group's example papers (at most 4
> requests, taken from the budget first), the other sources once, and every candidate labelled with its
> nearest topic.** (Review line 27; priced in this card's 1.75 d.)

**Do NOT.**
- Do **not** run per-cluster generation more than once per cluster.
- Do **not** call OpenAlex.

**Done when.**
- [ ] A budget of 12 runs (a) and (b) fully and (c) for the seeds the budget allows.
- [ ] With every S2 call refused, (b), (d) and (e) still return candidates.
- [ ] A two-topic profile makes two (a) POSTs, and every candidate from them records its topic group *(corrected 2026-11-02, `P5-T01` finding 1)*.
- [ ] A keyless run on a transport that fails on `api.semanticscholar.org` makes no request there, (d) included.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- recommendGenerators` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendGenerators
```

**Notes.** Needs: `P2-T02`, `P2-T10` (built).

---

### P5-T24 — Recommendation filters, scoring, diversity, reasons

| Field | Value |
|---|---|
| **ID** | `P5-T24` |
| **State** | `TODO` |
| **Depends on** | `P5-T19`, `P5-T20`, `P5-T21`, `P5-T23` |
| **Blocks** | `P5-T25` |
| **Retires** | none |
| **Implements** | `FR-46`, `FR-47`, part of `FR-49` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** Candidates are filtered before scoring, scored with `docs/05` §7.4's eight terms, diversified,
and each carries a one-line reason built from its strongest terms.

**Read first.**
- `docs/05-related-work-discovery.md` §7.4 (terms, weights, slider invariants, hard filters), §7.5 (`diversify`, MMR), §7.6 (reason line), §8.3 (sanity checks)
- `docs/10` FR-46 — collection items excluded, library items marked

**Files.**
- create `src/pipeline/recommend/score.ts` (caller: `recommendPipeline.ts`, `P5-T25`)
- create `test/unit/pipeline/recommendScore.test.ts`
- modify `docs/05-related-work-discovery.md` (§7.4's hard filter: the collection, not the library — FR-46; dated note)

> *Added 2026-11-02 (`plan/reports/P5-T01.md`, finding 1 and decisions 4 and 12): this card sets `topicIndex` at `Scoring`, from the candidate's vector against the profile's centroids; `generatorAgreement` counts distinct `strategy` values.*

> *Added 2026-11-02 (`plan/reports/P5-T19.md`, findings 3 and 4): same one-space-per-run rule as `P5-T14`. No `(cosine + 1) / 2` on the lexical space. **Decide before building:** with no centroids, the highest cosine over the collection makes novelty exactly `1 − similarity`, so the two weights collapse and the Familiar–Exploratory slider would do little. Yield to the event loop on large runs (about 9 s extrapolated for 5,000 papers against 500 candidates).*

> *Added 2026-11-02 (`plan/reports/P5-T03.md`): rejected papers come from `listRejected(profileId)`.*

> *Added 2026-11-02 (`plan/reports/P5-T18.md`; coordinator, under `plan/00` §6 item 313): `owned.titles` is not built. Fuzzy title matching is this card's call.*

**Do.**
1. Hard filters, in two functions because only one kind can run before the survivors' metadata is
   filled in: `identifierFilters` — in the source collection; dismissed for this collection (unless
   "show dismissed"); outside the date window; a preprint whose published version the user owns — and
   `contentFilters` — no abstract and no tldr. `P5-T25` runs the first before its fill-in stage and the
   second after it (`docs/05` §7.5's dated note of 2026-11-02).
2. Library items outside the collection stay, marked `inLibrary` and unchecked (FR-46, settled below);
   correct `docs/05` §7.4's library-wide filter under a dated note.
3. The eight terms with similarity and novelty from the run's space (SPECTER2 max-over-centroids,
   else lexical); `w_sim = 0.40 − 0.40·t`, `w_nov = 0.40·t`, `t` in [0, 1] from the per-run slider
   (default 0.25); weights sum to 1.00.
4. `diversify`: `maxPerAuthor` 2, `maxPerVenue` 4, MMR λ 0.75; top K (default 30). Reason ids from the
   two strongest terms plus "recommended by Semantic Scholar" / "cites N papers in your collection" /
   "author in your collection".
5. `docs/05` §8.3's sanity checks as tests (seed never returned, ≥ 95 % in window, zero collection
   items, ≥ 5 distinct first authors, non-degenerate scores, every row has an abstract or tldr).

> **Settled by the documents (review 2026-11-01):** what happens to library items outside the
> collection. `docs/05` §7.4's hard filter drops everything owned **library-wide**; FR-46, a Must
> requirement, says items "elsewhere in the library are marked 'in library' and unchecked by default";
> `docs/11`'s definition of done excludes "everything already in that collection"; `docs/13` §8.3 tests
> exactly that split. **FR-46 — exclude the collection, mark the library; `docs/05` §7.4 is the defect
> and this card corrects it.**

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** preprints. `docs/05` §3.2 asks for a
> "preprint (not peer reviewed)" badge and a "peer-reviewed only" filter; §5.3 (was `plan/05` §2.3) asked whether
> the filter ships and defaults on. **The label on every preprint row in both features; "Peer-reviewed
> only" a per-run checkbox, default off, with no preference.** (Review line 24.)

**Do NOT.**
- Do **not** apply a hard filter as a score penalty.
- Do **not** use the bare `1 − cosine` (`docs/05` §7.4: rescale to [0, 1]).

**Done when.**
- [ ] At `t = 0.25` the weights equal the starting weights; at any `t` they sum to 1.00 ± 1e-9.
- [ ] Each `docs/05` §8.3 check is a passing test on a fixture run.
- [ ] `identifierFilters` never reads an abstract or tldr; `contentFilters` drops a row with neither (test).
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- recommendScore` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendScore
```

**Notes.** Needs: `P2-T10`, `P2-T11` (version links, built).

---

### P5-T25 — Recommend pipeline: profile check, stages, wiring

| Field | Value |
|---|---|
| **ID** | `P5-T25` |
| **State** | `TODO` |
| **Depends on** | `P5-T03`, `P5-T22`, `P5-T23`, `P5-T24` |
| **Blocks** | `P5-T26` |
| **Retires** | none |
| **Implements** | part of `FR-44`, `FR-45`, `FR-46`, `FR-49` |
| **Estimate** | 2.0 d |
| **Human gate** | none |

**Goal.** `createRecommendPipeline` runs `docs/07` §12.5 as `P5-T01` reconciled it, reuses a fresh
profile, applies the user's edits, records dismissals, and is registered under `recommend`.

**Read first.**
- `docs/07-architecture-and-data-model.md` §12.5 (as reconciled), §5.2 `CollectionProfile`
- `src/bootstrap/registerPipelines.ts` `buildPipelineSet`; `src/pipeline/registry.ts` `PipelineSet`

**Files.**
- create `src/pipeline/recommend/recommendPipeline.ts` (caller: `buildPipelineSet`)
- create `src/pipeline/recommend/types.ts`
- modify `src/pipeline/registry.ts` (`PipelineSet.recommend`)
- modify `src/bootstrap/registerPipelines.ts` (constructs it with `createZoteroRecommendLibrary` and the stores)
- modify `src/bootstrap/container.ts` (`installServices` passes the router, budget, cache, stores, and the
  Semantic Scholar key probe — *corrected 2026-11-01 (review): generators (a) and (c) and `P5-T20`'s vectors
  depend on the key, and `P5-T14`'s row passes the probe while this one did not*)
- create `test/unit/pipeline/recommendPipeline.test.ts`

> *Added 2026-11-02 (`plan/reports/P5-T01.md`, finding 8 and decisions 5 and 11): `resumable: false`; a stored profile is fresh only with an equal `membershipHash` and the same `embeddingModel` as the run's space; apply `userEdits` at read time; declare the row type with `inLibrary`; decide the restart corners of `docs/07` §7.6.*

> *Added 2026-11-02 (`plan/reports/P5-T10.md`; DECIDED, coordinator, under `plan/00` §6 item 313): this card constructs the run's one `RequestBudget` and passes it to the generators (`P5-T23`) and to hydration, so hydration is not left without one. `findSimilarForSeeds` is on `PubmedSource`, so it needs the typed instance from `installServices`; check the `pubmed` slot of `ShippedSourceAdapters`.*

> *Added 2026-11-02 (`plan/reports/P5-T03.md`): `reject(profileId, workKey)` is `reject(recommendationId(profileId, workKey), now)`, and a row must be `put` before it is rejected. The `container.ts` row passes `graph.database.collectionProfiles`, `.recommendations` and `.embeddings`. The store has no general read of non-rejected recommendations, because no card named one.*

> *Added 2026-11-02 (`plan/reports/P5-T18.md`, `P5-T22.md`; coordinator, under `plan/00` §6 items 313 and 335(h)): the order is `readProfileCollection`, the hash compare, `libraryTermSources`, `buildProfileStats`, `P5-T21`, `runProfileCall`, then `persistProfile`. `readProfileCollection` comes first because `buildProfileStats` throws `RangeError` below 5 items. `kind: "too-few-items"` maps to `Failed` in `docs/07` §12.5, and its unbuilt wording is en-US "This collection has { $count } items. Recommendations need at least 5.", Korean draft for `G-41` "이 컬렉션에는 항목이 { $count }개 있습니다. 추천을 받으려면 항목이 5개 이상 필요합니다." `profileOwnedSets` and `libraryIndex` run each time and are not stored. Compare `removedTerms` through `normalizeTitle`. `membershipHash` covers the source collection only, so a library change does not alter it. Use `planProfileCall` for `Pipeline.estimate`, which sends nothing; pass `recommendRoutineStore(collectionSettings)`, credentials, prices, `modelInfo` and `baseUrls`; treat `declined` as `Cancelled`; put `egress` on the job input through `withEgressLog`, which is also present on a fallback after a request was sent. A stored heuristic profile has an unchanged `membershipHash`, and must not read as fresh when a provider now exists.*

**Do.**
1. Two input modes of one pipeline (decided below). **Profile only:** profile check (stored profile with
   equal `membershipHash` → reuse) → build stats (`P5-T18`) → vectors and centroids (`P5-T20`,
   `P5-T21`) → profile call (`P5-T22`, priced and confirmed before anything is sent) → stored user
   edits re-applied → the profile is the result; the job ends. **Edited profile in:** the input carries
   the profile the user saw and the edits made in `P5-T26`'s panel; the edits are stored on the profile
   as `userEdits`, then generate (`P5-T23`) → step 3's stages → score/diversify (`P5-T24`) → result.
   Each mode is its own job, and each asks the cost question only when a paid call is due — the
   edited-profile run makes none unless the stored profile went stale between the two jobs.
2. FR-44's order holds: no candidate generation in a profile-only run, and an edited-profile run never
   rebuilds the profile the user did not see without saying so.
3. After generation, the stage `docs/05` §7.5 runs and no other card built: `identifierFilters`
   (`P5-T24`) → fill in the survivors' metadata (`lookup` through `/paper/batch` when keyed, else Europe
   PMC / efetch, and `backfillAbstracts` with `selected` lacking `semanticscholar` when keyless, §0.2
   item 19) → fetch the survivors' vectors (`ensureEmbeddings`, keyed only) → `contentFilters`
   (`P5-T24`) → score. Never fill in the raw union (`docs/05` §9.1 item 2).
4. `reject(profileId, workKey)` through the recommendation store — rejections only (§0.2 item 27); the
   10 most recent rejections for this collection are `P5-T21`'s negatives.
5. Cancel at stage boundaries; a pause from a budget refusal keeps the stage pending (`plan/07` §0.2
   item 18).

*Corrected 2026-11-01 (review); estimate raised 1.5 → 2.0 d. Three pieces of work that other cards rely on
and no step built:*
- *FR-44 shows the profile **before** searching and uses the edited profile. `P5-T26` step 3 runs "the
  pipeline to the profile stage", then "Find papers" continues with the edits, but step 1 above is one
  uninterrupted run whose "apply user edits" can only apply edits stored by an earlier run. The pipeline
  needs a profile-only run and a run that takes the edited profile as input (decided below; steps 1–2
  since 2026-11-01).*
- *`docs/05` §7.5 hydrates the survivors of the identifier-level filters and fetches their vectors
  (`ensureEmbeddings(candidates)`) before scoring; `P5-T23` stops at the merged union and `P5-T24` scores,
  so no stage hydrates or fetches candidate vectors. `P5-T24`'s "no abstract and no tldr" filter can
  only run after hydration, so the filters split into identifier-level ones before hydration and that one
  after (step 3 since 2026-11-01).*
- *The key probe (`container.ts` row above).*

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** how "show the profile first, then
> search with the edits" runs. **One recommend pipeline whose input says "profile only" or carries the
> edited profile; each half is its own job, and each asks the cost question only when a paid call is
> due.** (Review line 20; the alternative, two pipeline ids, would have needed a `docs/07` §4.5 change
> to `PipelineId`.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** whether the user's profile edits
> outlive one run (FR-44 says only "the edited profile is used"). **Store them as `userEdits` (removed
> and added terms) on the profile and re-apply them after a rebuild; written into `docs/07` §5.2 by
> `P5-T01`.** (Review line 21.)

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** dismissal scope (FR-49). **Per
> collection — a paper dismissed for one collection still appears for another — stored as
> `recommendation.user_action = "rejected"`, with the 10 most recent sent as negatives.** (Review line
> 22.) The owner's item 323(b) bounds it: "Not interested" only hides, and nothing records what was
> imported.

**Do NOT.**
- Do **not** spend before the confirmation; do **not** send under a privacy mode that forbids it.
- Do **not** resume after a restart (`P5-T01`'s line).

**Done when.**
- [ ] A second run on an unchanged collection makes no LLM call and reuses vectors.
- [ ] A dismissed paper is absent on the next run and present with "show dismissed".
- [ ] A profile-only run returns the profile and makes no candidate request; an edited-profile run uses the removed and added terms in its queries and makes no model call when the stored profile is fresh.
- [ ] Metadata fill-in and vector fetch see only the survivors of `identifierFilters` (a test counts the ids sent); a keyless run sends nothing to `api.semanticscholar.org`.
- [ ] No store call writes a `user_action` other than `"rejected"`.
- [ ] No result row is a collection member (the DoD's exclusion line, offline).
- [ ] Mutation sweep; `npm run typecheck`, `npm run test:unit -- recommendPipeline container` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendPipeline container && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P3-T17`, `P3-T34` (built). Shares `registerPipelines.ts` and `container.ts` with
`P5-T14` and `P4-T18`.

---

### P5-T26 — Recommend entry and the editable profile panel

| Field | Value |
|---|---|
| **ID** | `P5-T26` |
| **State** | `TODO` |
| **Depends on** | `P5-T02`, `P5-T15`, `P5-T25` |
| **Blocks** | `P5-T27` |
| **Retires** | none |
| **Implements** | `FR-44` (UI) |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** "Recommend New Papers from This Collection…" opens the window in `recommend-from-collection`
mode, which shows the derived profile before searching and lets the user remove and add terms.

**Read first.**
- `docs/08-ui-ux-spec.md` §2.4–§2.5 (the collection block, `research-helper-menu-collection-recommend`), §1 ("Three windows total")
- `docs/10` FR-44

**Files.**
- modify `docs/08-ui-ux-spec.md` (a new §5.4 "Recommend flow" wireframe; dated note)
- modify `src/ui/menus/registerMenus.ts` (`collectionMenuOptions`: the entry, behind `recommend.enabled`)
- modify `src/bootstrap/registerUI.ts` (`collectionMenuCommands`; the window host's recommend route)
- create `src/ui/viewModels/recommendViewModel.ts` (caller: the window host) — the same split caveat as `P5-T16`
- modify `addon/content/searchDialog.xhtml`, `addon/content/searchDialog.js`
- modify the four `.ftl` bundles named in `P5-T15`, `src/i18n/keys.ts`
- create `test/unit/ui/recommendViewModel.test.ts`; modify `test/integration/menus.spec.ts`, `test/integration/l10n.spec.ts`

> *Added 2026-11-02 (`plan/reports/P5-T15.md`): the recommend entry can follow `related.enabled`'s three readers for `recommend.enabled`. `openTrackedSearchWindow` already closes its mode at shutdown. It needs its own chip for `recommend-from-collection`.*

> *Added 2026-11-02 (`plan/reports/P5-T22.md`; coordinator, under `plan/00` §6 item 313): the surface `ProfileCallSurface` applies `shouldOpenCostDialog`, `settleDisclosure` and `skippedNoticeLine`, and shows `warningId`. `confirmReportRun` can be reused only if its parameter is widened.*

**Do.**
1. Documents first: write `docs/08` §5.4 — the profile panel (focus statement, read-only; term chips
   with remove and add; authors; venues; "heuristic profile" notice when no LLM ran) above the shared
   result table, as decided below, and the notice naming what the literature databases receive (step 4).
2. The entry in the collection submenu's search group (`docs/08` §2.5), one collection selected.
3. "Build profile" starts `P5-T25`'s profile-only run (with its cost question when the profile call is
   due); "Find papers" starts the edited-profile run with the profile shown and the user's removed and
   added terms (`P5-T25` steps 1–2).
4. Before "Find papers" sends anything, the window's notice says what goes to the literature databases:
   the search queries, up to 15 of the collection's paper identifiers, dismissed papers' identifiers
   and the five most frequent authors' names (`docs/09` §3 row 6 as corrected 2026-11-02; item 323(a)).
   New strings go to `KO_PENDING_REVIEW` (G-41).

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** where the profile is edited. `docs/08`
> §1 has recommendations reuse the search window and draws no profile; `docs/11` §1 lists
> "`src/ui/panes/*` (profile editor)". **A profile panel inside the search window's recommend mode,
> wireframed in `docs/08` §5.4 first.** (Review line 19.)

**Do NOT.**
- Do **not** start candidate generation before the user has seen the profile (FR-44).
- Do **not** machine-translate.

**Done when.**
- [ ] The view-model test removes a term and the pipeline input carries the edit.
- [ ] "Build profile" starts a profile-only run; "Find papers" is disabled until a profile is shown (view-model test).
- [ ] The literature-database notice is rendered before "Find papers" runs, and `l10n.spec.ts` resolves its id in both locales.
- [ ] The entry is absent while `recommend.enabled` is false; menu-count specs updated.
- [ ] Mutation sweep on the view model; `npm run typecheck`, `npm run test:unit -- keys recommendViewModel` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- keys recommendViewModel && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P2-T17` (the search group of the submenu, built). `docs/08`, `registerUI.ts` and
`searchDialog.*` are `P4-T20`'s while it runs (item 325); wait for its commit. Shares those files with
`P5-T16`; run the two in sequence.

---

### P5-T27 — Recommendation results: dismiss, clusters, import

| Field | Value |
|---|---|
| **ID** | `P5-T27` |
| **State** | `TODO` |
| **Depends on** | `P5-T26` |
| **Blocks** | `P5-T28` |
| **Retires** | none |
| **Implements** | `FR-47` (UI), `FR-48`, `FR-49` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** Recommendations show grouped by cluster with a reason line, a preprint badge, a "Not
interested" action that persists, a "show dismissed" toggle, the Familiar ↔ Exploratory slider, and
import into `<Collection> — recommended <date>` by default.

**Read first.**
- `docs/05-related-work-discovery.md` §7.6 (grouping, reason line, "we'll show fewer like this")
- `docs/10` FR-47, FR-48, FR-49; `docs/08` §5.4 (from `P5-T26`)

**Files.**
- modify `src/ui/viewModels/recommendViewModel.ts`
- modify `src/bootstrap/registerUI.ts` (dismiss and import routes)
- modify `addon/content/searchDialog.xhtml`, `addon/content/searchDialog.js`
- modify the two `research-helper-searchDialog.ftl` bundles, `src/i18n/keys.ts`
- create `test/integration/pipeline/recommendFlow.spec.ts`

> *Added 2026-11-02 (`plan/reports/P5-T19.md`, finding 2): this card renders the "basic similarity" label on a keyless recommendation run. The string goes through `G-41`.*

**Do.**
1. Rows grouped by centroid label when k > 1; reason line from `P5-T24`'s reason ids; "in library"
   rows unchecked; the preprint badge; the per-run "Peer-reviewed only" box.
2. "Not interested" records the rejection for this collection and removes the row; "Show dismissed"
   brings them back. Importing records nothing beyond the import itself (§0.2 item 27).
3. Import ticked rows through the preview import into a subcollection of the source collection named
   `<Source collection> — recommended <YYYY-MM-DD>` (`findOrCreateCollection` with `parentID`), or a
   user-chosen collection.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** the slider. `docs/05` §7.4 calls it a
> "single user-facing slider". **A per-run control, default 25 of 100, not a preference.** (Review line
> 25.)

**Do NOT.**
- Do **not** write dismissals into Zotero item data (`docs/05` §7.2: plugin SQLite only).
- Do **not** import an unticked row.

**Done when.**
- [ ] `recommendFlow.spec.ts`: build, edit, find, dismiss one, import 5 into the dated subcollection; 5 items present, the dismissed paper absent on re-run.
- [ ] `npm run typecheck` and the integration suite pass (three runs if one fails).

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P1-T14`, `P2-T31` (built).

---

### P5-T28 — Prove the no-key path end to end

| Field | Value |
|---|---|
| **ID** | `P5-T28` |
| **State** | `TODO` |
| **Depends on** | `P5-T17`, `P5-T27` |
| **Blocks** | `P5-T30` |
| **Retires** | `R-3` (fallback proven offline) |
| **Implements** | DoD line 2 |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** With no Semantic Scholar key, both features return candidates from the other sources and the
lexical floor, make **zero** requests to `api.semanticscholar.org`, and say what a key would add.

**Read first.**
- `docs/11` R-3; `docs/13` §8.3 ("Without a Semantic Scholar key …"); `docs/10` §5 Q8

**Files.**
- create `test/integration/pipeline/noKeyRelatedness.spec.ts`

*Updated 2026-11-02 (decisions): the two document rows this card carried — `docs/10` §5 Q8 marked decided,
and `docs/11`'s Phase 2 "R-3 (fallback proven)" in §1 and §3.1 — were done on 2026-11-02 by the pass that
applied items 320, 321 and 323. The estimate is left at 0.75 d: lowering a card whose scope shrank is the
owner's call (`docs/11` §1).*

**Do.**
1. A spec with a transport that fails the test on any `api.semanticscholar.org` request: a DOI seed
   with a PMID yields related rows (pmra, Europe PMC, Crossref); a 30-item fixture collection yields
   recommendations (pmra, keyword queries through every selected source, author watch), with the
   abstract fill-in running.
2. Both results carry the key notice; the related window shows it.

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 320(a)):** `docs/10` §5 Q8, "Is a Semantic Scholar API
> key a hard requirement?". **No — both features work without it, at lower quality, and say what a key
> adds; Q8 marked decided (done 2026-11-02); `docs/08` §7.4's "need a key" becomes "work better with a
> key" (`P5-T16`).** (Review line 1.)

**Do NOT.**
- Do **not** stub the generators; the spec runs the real pipelines on recorded fixtures.

**Done when.**
- [ ] The spec passes with zero S2 requests and ≥ 1 candidate per feature.
- [ ] `npm run typecheck` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** "Useful" in the DoD is judged live in `P5-T30`; this card proves "returns candidates and
says what a key adds".

---

### P5-T29 — Probe the positive-seed cap with the real key

| Field | Value |
|---|---|
| **ID** | `P5-T29` |
| **State** | `TODO` |
| **Depends on** | `P5-T06` |
| **Blocks** | `P5-T30` |
| **Retires** | part of `R-3` |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — gate `G-26`: the owner rotates the Semantic Scholar key and enters it in the preferences pane; then the owner approves one in-Zotero probe run (no money; about a dozen keyed requests at 1 per second). |

**Goal.** `docs/05` §3.3's `Unverified` cap on `positivePaperIds` / `negativePaperIds` is replaced by a
measurement, and `RECOMMEND_MAX_POSITIVES` follows it.

**Read first.**
- `docs/05-related-work-discovery.md` §3.3 item 5; `plan/06` `G-26`; §5.4 ("far below 10"; was `plan/05` §2.4)

**Files.**
- create `test/integration/live/s2SeedCap.spec.ts` (behind `RH_DOD_LIVE`)
- modify `docs/05-related-work-discovery.md` (§3.3 marker replaced; dated note)
- modify `src/sources/semanticscholar/recommendations.ts` (`RECOMMEND_MAX_POSITIVES`)

**Do.**
1. Inside Zotero, through the shipped adapter and the stored key: POST with 10, 20 and 50 positives and
   10 negatives; record status, result count and latency.
2. Write the measured cap into `docs/05` §3.3 and the constant.

> **DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313):** probe sizes. **10, 20, 50 positives
> with 10 negatives; keep 15 as the default seed count unless 15 fails.** The run itself waits on the
> owner's key (`G-26`). (Review line 34.)

**Do NOT.**
- Do **not** read, print or log the key; the plugin reads it from the keystore.
- Do **not** exceed 1 request per second.

**Done when.**
- [ ] The marker is gone from `docs/05` §3.3, replaced by dated figures.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck
```
Then the live spec with `RH_DOD_LIVE=1` on the owner's profile, after `G-26`.

**Notes.** Run as early as `G-26` allows; a cap below 10 changes `P5-T21` (§5.4, was `plan/05` §2.4).

---

### P5-T30 — Phase-5 acceptance run against the definition of done

| Field | Value |
|---|---|
| **ID** | `P5-T30` |
| **State** | `TODO` |
| **Depends on** | `P5-T28`, `P5-T29` |
| **Blocks** | none |
| **Retires** | closes `R-3` |
| **Implements** | `FR-13`–`FR-18`, `FR-44`–`FR-49` |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — gates `G-26` (key entered), `G-27` (the owner, as domain expert, judges one 30-item collection's profile and its recommendations), `G-18` (an LLM key, for the profile call), and `G-43` (the owner approves the first real recommendation run's spend before it runs) — expected under $1 in all at `docs/06` §5.4's illustrative $3/$15 per million tokens (one call of about 2 k input and ≤ 2.5 k output tokens per profile build, three builds), stated from `P5-T22`'s estimate and approved before dispatch. |

**Goal.** Every line of the Phase 5 definition of done and `docs/13` §8.3 is demonstrated on a real
Zotero profile and recorded, and the two features are switched on.

**Read first.**
- `docs/11` §1 Phase 5 "Definition of done"; `docs/13` §8.3; `plan/06` `G-26`, `G-27`

**Files.**
- create `docs/spikes/phase-5-acceptance-report.md`
- create `test/integration/pipeline/phase5Acceptance.spec.ts` (live parts behind `RH_DOD_LIVE`)
- modify `docs/07-architecture-and-data-model.md` (§8.5: `related.enabled`, `recommend.enabled` default `true`; dated note)
- modify `src/prefs/schema.ts`, `test/unit/prefs/schema.test.ts` (the two defaults)

**Do.**
1. Related: a DOI seed → count of candidates with reasons (≥ 20); import 10 → 10 items created or
   linked; the same seed with the key cleared → candidates and the key notice.
2. Recommend: stop for `G-43` before the first profile call; then a 30-item collection → profile and
   recommendations; zero collection members in the list; record how many of the profile answer's
   2 500 output tokens were used (`P5-T22`; review line 7); stop for `G-27`; record the owner's verdict
   verbatim.
3. Each `docs/13` §8.3 line → a recorded result; Phase 2's and Phase 3's open sign-offs recorded as
   they stand.
4. Only then set both feature rows' defaults to `true`, `docs/07` §8.5 first.

> **DECIDED 2026-11-01 (owner, plan/00 §6 item 321(a)):** the spend gate. `plan/06` had `G-21`
> (summaries) and `G-42` (reports) and none for recommendation runs. **A new gate `G-43`, modelled on
> `G-42`: the first real recommendation run's spend is approved by the owner before it runs** (added to
> `plan/06` §7 on 2026-11-02). (Review line 6.)

**Do NOT.**
- Do **not** count `G-27` as passed because the sanity checks passed (`plan/06` `G-27`, "If it is not done").
- Do **not** flip the feature rows before every DoD line has a recorded result.

**Done when.**
- [ ] Each DoD line and each `docs/13` §8.3 line has a recorded figure or verdict.
- [ ] The owner's `G-27` verdict is recorded.
- [ ] `npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract && npm run build
```
Then the manual steps above on a real Zotero 10 profile, stopping at each gate.

**Notes.** Needs: `P3-T31` (NOT BUILT) for a calibrated profile estimate; without it the estimate is
`P3-T13`'s ratios.

---

### P5-T31 — Owner-recorded Semantic Scholar fixtures

| Field | Value |
|---|---|
| **ID** | `P5-T31` |
| **State** | `TODO` |
| **Depends on** | `P5-T04` |
| **Blocks** | `P5-T05`, `P5-T06` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — the owner rotates the Semantic Scholar key (`G-03`'s note of 2026-10-14; the first half of `G-26`) and runs `P5-T04`'s keyed recording with the key in the process environment; no cost; the agent never sees the value (`plan/00` §6 item 323(c)). |

**Goal.** Every Semantic Scholar scenario `P5-T04` lists has a fixture recorded by the owner with the
key, checked by the agent, so `P5-T05` and `P5-T06` test against real bodies.

**Read first.**
- `P5-T04` step 3 — the keyed path and its opt-in flag
- `docs/13` §3.1 — fixture inventory rules
- `plan/06` `G-03`, `G-26` — the rotation and why no agent holds the key

**Files.**
- create fixtures under `test/fixtures/semanticscholar/` (the owner's run writes them; the agent commits them after the checks)
- modify `docs/13-testing-build-and-release.md` (§3.1 Semantic Scholar rows; dated note)

**Do.**
1. Print for the owner the exact command, the scenario list (`--dry-run`) and the expected request
   count at 1 per second; stop at the gate.
2. After the owner's run: check every scenario has a fixture or a `"synthetic": true` stand-in with its
   reason; check that no fixture holds an `x-api-key` header (grep the new files); record the no-match status and body of
   `/paper/search/match` for `P5-T05` step 2.
3. Add the inventory rows to `docs/13` §3.1.

**Do NOT.**
- Do **not** ask for, read, print or store the key; do not run the keyed path.
- Do **not** re-record a scenario the owner's run refused by trying the anonymous pool (item 320(a)).

**Done when.**
- [ ] Every Semantic Scholar scenario of `P5-T04` step 2 has a committed fixture or a synthetic stand-in with its reason.
- [ ] `grep -rli "x-api-key" test/fixtures/semanticscholar` prints nothing.
- [ ] `npm run test:contract` passes.

**Verify with.**
```bash
npm run test:contract && ! grep -rli "x-api-key" test/fixtures/semanticscholar
```

**Notes.** Added 2026-11-01 by the coordinator's pass applying item 323(c): keeping the owner's step
inside `P5-T04` would have gated `P5-T07`–`P5-T09`, which need no Semantic Scholar fixture. The 0.25 d
is the agent's checking and inventory work; the owner's time is the gate, not developer-days.

---

## 3. Estimate reconciliation

`docs/11` §1 Phase 5 published **21–29 d, "⚠ scaled, not decomposed"** (14 d × 1.50, × 1.4) until
2026-11-02. These cards sum to **35.75 d over 31 cards**, a band of **35.75–50 d** (35.75 × 1.4 = 50.05
→ 50). The low end is 70 % above 21 (35.75 ÷ 21 = 1.70) and 23 % above the scaled top of 29 (35.75 ÷
29 = 1.23); against the superseded pre-2026-09-09 top of 14 d it is 2.55×, beside Phase 4's measured
2.16× (item 288(b)). *Corrected 2026-11-01 (review): was 33.25 d, 33.25–47 d, 58 %, 15 % and 2.38×, before
`P5-T23` and `P5-T25` were re-estimated.* *Updated 2026-11-01 (decisions): was 34.0 d, 34–48 d, 62 %, 17 %
and 2.43× before the re-estimates in the table below and `P5-T31`.* `plan/README.md` §7 calls a
divergence above ~30 % a signal to re-estimate the phase in `docs/11`; **propagated 2026-11-02** to
`docs/11` §1–§2, `plan/00` §1 and `plan/05` §2.

| Card | Review sum | Accepted | Why |
|---|---|---|---|
| `P5-T03` | 1.0 | **1.5** | The review's "likely 1.25" (three stores, two `BLOB` codecs, four version pins, an integration spec) plus 0.25 d for the vector cap (line 31) |
| `P5-T04` | 1.0 | **1.75** | +0.25 d for the keyed Semantic Scholar recording path (item 323(c)); +0.5 d for the five request builders moved here (line 32) |
| `P5-T05` | 1.0 | **0.75** | Its three request builders moved to `P5-T04` (line 32's offset) |
| `P5-T14` | 1.5 | **1.75** | The review's "likely 1.75": a chosen seed as input and candidate vectors before the similarity term |
| `P5-T18` | 1.25 | **1.5** | `dateAdded` on the item mapper, with its test (the review's gap, placed by the coordinator) |
| `P5-T31` | — | **0.25** | New: the agent's half of the owner's keyed Semantic Scholar recording (item 323(c)) |
| | **34.0** | **35.75** | +1.75 d |

Not re-priced, with the reason: `P5-T12` (the keyless abstract fill-in is one argument on a call it
already makes); `P5-T22` (line 7 removes a setting, line 36 reuses item 292(f)'s pattern); `P5-T26` (the
literature-database notice is one string and a `docs/08` paragraph); `P5-T28` (two document rows moved
out to the 2026-11-02 pass — lowering a card whose scope shrank is the owner's call, `docs/11` §1).

| Work area (`plan/05` §2.1, now §5.1 below) | Cards | Days |
|---|---|---|
| — types, preferences, tables, builders, fixtures (no work area) | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T31` | 5.0 |
| W5-1 Seed resolution | `P5-T11` (+ title match in `P5-T05`, `P5-T09`) | 1.25 |
| W5-2 Citation-graph gathering | `P5-T05`, `P5-T07`, `P5-T08`, `P5-T09`, `P5-T12` | 4.5 |
| W5-3 S2 Recommendations adapter | `P5-T06` | 1.25 |
| W5-4 Embedding layer | `P5-T19`, `P5-T20` | 2.0 |
| W5-5 Vector storage | in `P5-T03` | — |
| W5-6 Collection profiler | `P5-T18`, `P5-T21`, `P5-T26` | 4.0 |
| W5-7 Candidate generation | `P5-T22`, `P5-T23` | 3.25 |
| W5-8 Scoring, ranking, reasons | `P5-T13`, `P5-T24` | 2.5 |
| W5-9 Review, exclusion, import | `P5-T14`, `P5-T15`, `P5-T16`, `P5-T17`, `P5-T25`, `P5-T27` | 8.75 |
| W5-10 Rate limits, caching, evaluation | `P5-T10`, `P5-T28`, `P5-T29` | 2.25 |
| Acceptance | `P5-T30` | 1.0 |
| **Total** | 31 cards | **35.75** |

The unpriced work the scaled figure hid is the kind Phases 0–4 found, plus one kind of its own:
**four adapter extensions** behind a contract (`findRelated`) that no adapter implements (`plan/00`
§6 item 184); a fixture-recording pass over a rate-limited, anonymous-hostile host, half of it the
owner's; two new pipelines with their composition-root wiring; the plugin's first item context menu;
two new modes of the search window, one with an editor no document drew; three migrations with their
pinned tests; a documents-first reconciliation of types that disagree between `docs/05`, `docs/07` and
`docs/12`; and a mutation sweep on every logic card.

**What the decisions did to the sum.** Every card was priced on its line's recommendation, and every
line was decided that way, so no alternative's price applies. The alternatives that were declined, for
the record: lexical-only embeddings −1.75 d; a third-party embedding fallback +1.5 d; `RECOMMEND_RANK`
+1.5 d; multi-seed related +1.0 d; co-citation +0.5 d; profile digests from stored summaries ≈ +1.0 d; a
separate profile-editor pane ≈ +0.75 d; an evaluation-harness card +1.0 d; a local similarity search
over the library +0.5 d and the published-version offer +0.25 d (line 12); PubMed's citation lists
+0.25 d (line 18).

**Where the sum is still likely low** *(not re-estimated, because none has a measurement)*:
`P5-T16` and `P5-T26`–`P5-T27` extend the search window — `searchImportViewModel.ts` (3 171 lines),
`addon/content/searchDialog.js` (3 940) and `registerUI.ts` (2 303), measured 2026-11-01 — the kind of
surface that ran over in Phase 1; `P5-T18`'s library-wide term counts are unmeasured on a 10 k-item
library (NFR-3's main-thread rule may force batching). The draft's 2–3 d named two more causes, now
settled: the Semantic Scholar recording went to the owner (`P5-T04`'s keyed path and `P5-T31` are
priced), and the review found `fanOut` usable under a per-run budget without change (the generator
takes from the budget before each one-query call). The review's own +0.75–1.25 d is applied above
(`P5-T03`, `P5-T04`, `P5-T05`, `P5-T14`). *Corrected 2026-11-01 (review), then updated the same day
(decisions): the paragraph read "2–3 d … +71 % to +76 %" and then "+0.75–1.25 d on top … 37–38 d".*

---

## 4. What this file does not card, and why

Items marked **backlog** go to `plan/00` §6 tagged Phase 5; the coordinator records them there (this
file adds no §6 item).

| Item | Where the documents ask for it | Why no card |
|---|---|---|
| Held-out precision@k harness, ablation, `research_helper: run evaluation` | `docs/05` §8.1–§8.2; `plan/05` W5-10 | DECIDED 2026-11-01 (owner, plan/00 §6 item 323(d)): no evaluation tool in Phase 5; `G-27`'s expert judgement is the finishing condition. `docs/05` §8.3's sanity checks are test lines in `P5-T24`. **Backlog** |
| Implicit feedback log and add-rate (`docs/05` §8.4) | `docs/05` §8.4; §5.3 (was `plan/05` §2.3) | DECIDED 2026-11-01 (owner, plan/00 §6 item 323(b)): not recorded in v1; "Not interested" only hides (§0.2 item 27). **Backlog** |
| Background prefetch and `background.enabled` | `docs/05` §9.6; `docs/07` §8.5 ⚠ row | Not a deliverable. **Backlog** |
| Co-citation and bibliographic-coupling generators | `docs/05` §2.2–§2.3 | DECIDED 2026-11-01 (owner, plan/00 §6 item 321(c)): co-citation not built, **backlog**; coupling stays a free scoring term in `P5-T24` when references are cached |
| `RECOMMEND_RANK`, model-written rationales, `QUERY_EXPAND` | `docs/12` §16, §2; `docs/07` §12.5 | DECIDED 2026-11-01 (owner, plan/00 §6 item 320(c)): the model writes the profile only; FR-47's reasons are computed in code. **Backlog** |
| Third-party embedding adapter (OpenAI / Gemini / Voyage) | `docs/05` §5.3; `docs/03` §13 | DECIDED 2026-11-01 (owner, plan/00 §6 item 320(b)): no third-party embedding service |
| Multi-seed "Find papers related to N items" | FR-13 scenario 2 | DECIDED 2026-11-01 (owner, plan/00 §6 item 321(b)): the entry is disabled for several items |
| A local "similar papers already in my library" search; the preprint seed's "fetch for the published version too" | `docs/08` §5.1 step 2, §5.3; `docs/05` §9.5 | DECIDED 2026-11-01 (coordinator, under plan/00 §6 item 313; review line 12): "similar" is PubMed's list in v1; `docs/08` §5 corrected by `P5-T16`. **Backlog** |
| PubMed's own citation lists (`pubmed_pubmed_refs`, `pubmed_pubmed_citedin`) | `docs/02` §3.6 | DECIDED 2026-11-01 (coordinator, under item 313; review line 18): not needed once `docs/07` §4.2's flag reads "relation edges" |
| Scheduled recommendations | FR-49 | Out of v1 by `docs/10` §4 item 13 |
| "Clear embeddings" / "Clear profiles" actions | `docs/09` §3.7 | Phase 7's W7-4 owns the clear actions (`plan/05` §4.1) |
| Semantic Scholar attribution line in README and outputs | `docs/09` §5.3, §7 checklist | Release work (Phase 7) |

Every `docs/11` §1 Phase 5 deliverable and definition-of-done line has at least one card (§0 tables).

---

## 5. The Phase 5 outline, carried over from `plan/05` §2

Moved here verbatim on **2026-11-02**, when `plan/05` §2 was reduced to a pointer to this file
(`plan/05` §0, "Exit from outline into cards"), because the cards, `plan/06` and `plan/05` §5.2 cite
the work areas `W5-1`–`W5-10` and these subsections. It is the outline of **2026-09-09**: where a card,
§0's entry-condition table or a decision of items 320, 321, 323 or §0.4 says otherwise, that wins. §5.2's
entry conditions are tracked in §0's table; §5.3's seven decisions are all made — the no-key question
(item 320(a)), the embedding route and the default provider's lack of one (item 320(b); no third-party
service, so the D6 default needs none), vector storage and its share of NFR-8 (`P5-T03`, review line 31),
the per-run LLM confirmation (`P5-T22`, with `docs/10` §5 Q7 decided on 2026-10-26), preprint
presentation (`P5-T24`, review line 24) and implicit feedback (item 323(b): not in v1). In §5.4, the
float figure and the "re-sequence after Phase 6" lever are those of 2026-09-09: the key arrived on
2026-09-30 (`plan/06` `G-03`), and `docs/11` §2 owns the float (4.5–6 d since `plan/00` §6 item 335(g), 2026-11-02; 3–4 d before it).

### 5.1 Work areas

| # | Work area | One sentence |
|---|---|---|
| W5-1 | **Seed resolution** | DOI/PMID/arXiv → canonical record, with the title-match fallback, its confidence threshold, and the disambiguation UI that must appear rather than a silent guess (FR-13, FR-14; `docs/05` §6.1). |
| W5-2 | **Citation-graph gathering** | References and citations from Crossref, Europe PMC and PubMed `elink`/pmra, which together are the path that must work with no Semantic Scholar key at all (`docs/05` §2, §4). |
| W5-3 | **Semantic Scholar Recommendations adapter** | Both endpoints, `from=recent` only, batch validation of every seed ID before a POST, the 10 MB response cap, and the conservative positive-seed cap (`docs/05` §3). |
| W5-4 | **Embedding layer** | SPECTER2 via Semantic Scholar as the default, a third-party embedding fallback, and the lexical floor when neither is available — with the never-mix-two-spaces rule and per-vector model tagging (`docs/05` §5.1, §5.3, §5.5). |
| W5-5 | **Vector storage** | Where the vectors live client-side and how the cap interacts with NFR-8 (`docs/05` §5.4; the persisted shape is `docs/07` §5.2 and §8.3). |
| W5-6 | **Collection profiler** | `CollectionProfileDraft` → the persisted `CollectionProfile`: IDF-weighted MeSH and keyword extraction, authors and venues, *k* centroids for the multi-topic case, and the editable profile UI (FR-44; `docs/05` §7.2). |
| W5-7 | **Candidate generation** | LLM-assisted query generation with a heuristic fallback, reusing Phase 2's fan-out executor (FR-45; `docs/12` §15 `COLLECTION_PROFILE`). |
| W5-8 | **Scoring, ranking and reason chips** | The blended score, the recency de-emphasis, and the human-readable reason attached to every candidate (FR-15, FR-47; `docs/05` §6.2, §7.4, `docs/12` §16 `RECOMMEND_RANK`). |
| W5-9 | **Review, exclusion and import** | Owned-item exclusion, dismissed-candidate persistence, the "in library" marking, optional Zotero *Related* linkage, and import into the dated recommendation subcollection (FR-16, FR-17, FR-18, FR-46, FR-48, FR-49). |
| W5-10 | **Rate-limit-aware batching, caching and evaluation** | The per-host budgeting, backoff and cache design that make the feature usable inside a 1 req/s ceiling (`docs/05` §9), plus the held-out precision@k harness and sanity checks that make its quality falsifiable (`docs/05` §8). |

### 5.2 Entry conditions

- **Phases 2 and 3 are `DONE`.** W5-7 reuses Phase 2's fan-out and Phase 3's
  provider layer directly.
- **V-14 has an answer.** `docs/11` §4.3 V-14 measures unauthenticated Semantic
  Scholar behaviour *and* requires the key application to have been submitted.
  The measurement decides whether the no-key path in W5-2/W5-3 is merely slower
  or unusable.
- **The Semantic Scholar key is either in hand or formally written off.** This is
  the phase's real gate and it is an approval queue, not code — `docs/11` R-3
  says issuance "can take weeks" and instructs applying in week 1 of Phase 0.
  See [`06-human-gates.md`](06-human-gates.md) G-03 and G-26.
- **`docs/10` §5 question 8 is answered** — whether a Semantic Scholar key is a
  hard requirement. If the answer moves off the recommended "no", W5-2 and W5-4's
  fallback tiers stop being optional politeness and become the phase.
- **The embedding route is decided, and the default provider's capability is
  known.** `docs/03` §13 marks OpenRouter's embedding coverage
  `> **Unverified:**` and §16's capability matrix carries the same "Unverified"
  in the OpenRouter column. D6 makes OpenRouter the default provider, so a user
  on the default path may have no embedding endpoint at all; `docs/03` §16
  already documents the Anthropic-only case as falling back to BM25.
- **The positive-seed cap is probed.** `docs/05` §3.3 marks the maximum
  `positivePaperIds`/`negativePaperIds` `> **Unverified:**` and instructs capping
  at 10–20 pending measurement. W5-6's seed-selection strategy sits on that
  number.
- **Phase 2's preprint policy is settled** (`docs/10` §5 question 2). `docs/05`
  §3.2 records that `from=recent` skews to preprints, so the recommendation UI
  inherits whatever Phase 2 decided about preprint/published pairs — including
  the `> **Unverified:**` in `docs/02` about whether legacy `10.1101/` DOIs are
  being re-minted.
- **Per-host limits used by W5-10 are as settled as they will get.** Europe PMC's
  rate limit is `> **Unverified:**` in three places (`docs/02`, `docs/07` §7.3,
  `docs/09` §5.5) and bioRxiv/medRxiv publish none at all (`docs/09` §5.6). These
  do not block decomposition, but the cards must not pretend to a number the
  documents do not have.

### 5.3 Decisions required before decomposition

| Decision | Recorded in |
|---|---|
| Does Phase 5 ship if no Semantic Scholar key was granted, and with what reduced DoD | `docs/11` §1 Phase 5 DoD and `docs/05` §3; the question is `docs/10` §5 question 8 |
| Embedding route for v1 — SPECTER2 only, SPECTER2 + third-party fallback, or lexical only | `docs/05` §5 for the design, `docs/07` §8.5 for any pref |
| What a user on the D6 default provider gets when that provider cannot embed | `docs/03` §16's recommended-defaults table, extended |
| Vector storage layout and its share of the NFR-8 cap | `docs/05` §5.4 and `docs/07` §8.3/§8.5 |
| Whether recommendation runs may spend LLM tokens under the standard pre-run confirmation, or need their own | `docs/10` §5 question 7's answer, reflected in `docs/08`'s consent flow |
| Preprint presentation — badge, and whether a "peer-reviewed only" filter ships and defaults on | `docs/05` §3.2 and `docs/08` |
| Whether implicit user feedback (`docs/05` §8.4) is collected locally in v1 | `docs/05` §8.4 and `docs/09` §3.7's clearable-data list |

### 5.4 What would change the plan

- **The key is denied, or arrives after Phase 5 would have started.** W5-3 and the
  SPECTER2 half of W5-4 are deferred; W5-2's citation-graph path and W5-4's
  lexical floor become the product. The phase's DoD reduces to the "with no
  Semantic Scholar key" clause that `docs/11` §1 already states, and R-3 is
  retired by proving the fallback rather than by using the key. Effort probably
  drops toward the bottom of the 21–29-day band `docs/11` §1 now carries; quality
  provably drops.
- **V-14 shows unauthenticated access is unusable rather than slow.** Phase 5
  cannot be validated at all without the key, and it should be re-sequenced after
  Phase 6 so the key's queue has more calendar time. This is the single strongest
  argument for keeping this phase in outline form. The re-sequencing lever is
  weaker than it was, and that is good news rather than bad: `docs/11` §1's
  2026-09-09 re-estimate already pushes Phase 5's earliest start to ≈ 3–4 months
  in (`docs/11` R-3), so a week-1 application has most of that time to clear
  before the question arises at all. `docs/11` §2 also notes that Phase 5's
  ≈ **10.5–15 d** of float exists only if a second developer takes it in parallel;
  under single-developer serial execution there is no float to trade. (That figure
  was ≈ 13–18 d until the 2026-09-09 `P3-T04` / `P3-T20` re-estimate; `docs/11` §2
  owns it and carries both routes into P5 and the arithmetic for each.)
- **OpenRouter has no embedding endpoint.** Either a second key becomes a soft
  requirement for W5-4 — which is a new human gate and a new first-run flow — or
  BM25 (`docs/05` §5.5) is promoted from floor to default for the default
  provider, which changes W5-8's scoring weights.
- **The positive-seed cap is far below 10.** W5-6's centroid and seed-selection
  design changes from "pick the 10–20 highest-signal seeds" to iterating small
  batches, which multiplies W5-10's request budget under a 1 req/s ceiling.
- **Held-out precision@k comes back at chance level.** `docs/05` §8 exists
  precisely because "everything looks plausible"; a failing harness sends W5-8
  back to design rather than shipping a recommender nobody can falsify.

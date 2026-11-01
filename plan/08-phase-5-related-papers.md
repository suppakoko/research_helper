# Phase 5 — Related papers and recommendations

> **DRAFT — for review, 2026-11-01.** Drafted under owner decision `plan/00` §6 item 318(c) ("while
> `P4-T18` runs, a second agent decomposes Phase 5 into cards as plan work only, with no code … a
> draft as `plan/08-phase-5-related-papers.md`, an independent review, then the owner's questions,
> and only after that does any estimate move"). **Nothing outside this file and its report was
> changed:** no estimate site (`docs/11` §1–§2, `plan/00` §1, `plan/05` §2, `plan/README.md`) has
> moved, and `plan/05` §2 is still the plan of record for Phase 5 until the owner decides. Every card
> is `TODO`. The author's report is `plan/reports/phase5-draft.md`.
>
> **Reviewed 2026-11-01** (`plan/reports/phase5-review.md`). Mechanical corrections and two
> re-estimates (`P5-T23` 1.5 → 1.75, `P5-T25` 1.5 → 2.0) are marked "Corrected 2026-11-01 (review)"
> where they were made; the card sum is now **34.0 d**. No open line was decided here: the review
> lists the lines it found already settled by the documents, and the lines it adds, for the owner and
> the coordinator.
>
> **What this file is.** The task-card decomposition of `docs/11-implementation-roadmap.md` §1
> "Phase 5 — Related papers + recommendations". The card schema, the field rules and the execution
> protocol are [`README.md`](README.md) §4–§5 and bind every card below. A step that depends on a
> document change the card makes first is not executed before that change lands. A step that depends
> on an `Open — recommended` line is not executed until the line is decided (§0.2 item 10 of
> `plan/04`, applied here).
>
> **Not yet read by `npm run index:derive`.** `scripts/derive-task-index.ts` reads `plan/01`–`plan/04`
> and `plan/07`; adding this file and a "Phase 5" table in `plan/00` §4 is the coordinator's step
> after the owner decides, as it was for `plan/07` (item 286). The file is numbered `08` because
> `05`–`07` are taken.

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
   no model decides what the user sees (recommended on `P5-T22`, an open line).
3. **Nothing is added to the library without the user ticking it.** Never auto-add (`docs/05` §6.3);
   items already in the source collection are excluded, items elsewhere are marked "in library" and
   unchecked (FR-16, FR-46).

**Schedule and entry conditions.** `plan/05` §0 schedules this decomposition for the end of Phase 4;
the owner pulled it forward (item 318(c)), so `plan/05` §2.2's entry conditions are **not all met**.
Their status on **2026-11-01**, by grep of the documents and the tree:

| `plan/05` §2.2 entry condition | Status 2026-11-01 | Cards it reaches |
|---|---|---|
| Phases 2 and 3 `DONE` | **Not met.** No `plan/reports/` file for `P3-T22`, `P3-T31`, `P3-T37`; `P2-T13` and `P2-T16` Part B wait on the owner's 60-pair sample (item 284(c)). **What Phase 5 takes from them is built:** `fanOut`, `dedupeAndMergeAsync` (`src/pipeline/searchImport/stages.ts`), `importWorks` (`src/zotero/importer.ts`), both `LibraryIndex` types, `LLMRouter`, `withBudget`, `buildEgressDisclosure`, `confirmRunCost` | `P5-T12`, `P5-T22`, `P5-T23`, `P5-T30` |
| V-14 answered | **Met (measurement half).** `docs/02` §6.4 records `P0-T22`'s 12-of-12 429s: the anonymous pool is unusable, not slow. The key application half is closed (`plan/06` `G-03`, closed 2026-09-30) | `P5-T12`, `P5-T23`, `P5-T28` |
| The Semantic Scholar key in hand or written off | **In hand, not entered.** `G-03`'s status note of 2026-10-14: the key arrived, must be **rotated** (one copy was pasted into a chat) and entered only through the pane; `G-26` is open. No agent may hold it (`plan/04` §0.2 item 7) | `P5-T29`, `P5-T30` |
| `docs/10` §5 Q8 answered | **Not marked decided.** Q8 carries only its recommended default ("no — degrade gracefully"); `docs/08` §7.4's pane text contradicts it ("need a key"). Open line on `P5-T28` | `P5-T28`, `P5-T16` |
| Embedding route decided; default provider's capability known | **Not met.** `docs/07` §13 item 5 ("Decide whether embeddings ship in v1") is open; `docs/03` §13 marks OpenRouter's embedding coverage `Unverified`; `docs/03` §16 and `docs/05` §5.1 name different defaults. Open line on `P5-T20` | `P5-T19`, `P5-T20`, `P5-T21` |
| Positive-seed cap probed | **Not met.** `docs/05` §3.3 `Unverified` (2 positives and 1 negative tested) | `P5-T29` measures it; `P5-T21` caps at 15 until then |
| Phase 2's preprint policy settled | **Met in `plan/06`, not in `docs/10`.** `G-16` decided 2026-10-14 (keep both, linked, `research_helper/superseded-by-published`), built by `P2-T10`/`P2-T11`; `docs/10` §5 Q2 is still unstruck. `docs/02` §11.2's `10.1101/` re-minting `Unverified` stands | `P5-T24`, `P5-T27` |
| Per-host limits as settled as they will get | **Unchanged.** `docs/07` §7.3's `www.ebi.ac.uk` row is 5/s "see the unverified note"; `api.biorxiv.org` has no published limit. No card states a number the documents lack | `P5-T07`, `P5-T10` |

**Deliverables (docs/11 §1 Phase 5) → cards.**

| `docs/11` deliverable | Cards |
|---|---|
| Seed resolution (DOI/PMID/arXiv → canonical; title-match fallback with a confidence threshold and disambiguation UI). FR-13, FR-14 | `P5-T05`, `P5-T09`, `P5-T11`, `P5-T15`, `P5-T16` |
| Relatedness gathering: references, citations, source-provided recommendation endpoints; scoring and reason chips. FR-15, FR-47 | `P5-T04`–`P5-T10`, `P5-T12`, `P5-T13`, `P5-T14` |
| Related-results review UI with "in library" marking and recency de-emphasis. FR-16, FR-18 | `P5-T15`, `P5-T16` |
| Optional Zotero *Related* linkage. FR-17 | `P5-T02`, `P5-T17` |
| Collection profiler: term/MeSH extraction, optional embedding centroids, editable profile UI. FR-44 | `P5-T18`, `P5-T19`, `P5-T20`, `P5-T21`, `P5-T22`, `P5-T26` |
| Candidate query generation (LLM-assisted with heuristic fallback) and fan-out reuse from Phase 2. FR-45 | `P5-T22`, `P5-T23` |
| Owned-item exclusion and dismissed-candidate persistence. FR-46, FR-49 | `P5-T03`, `P5-T24`, `P5-T25`, `P5-T27` |
| Import into a default `<Collection> — recommended <date>` subcollection. FR-48 | `P5-T27` |
| Types, preferences, tables, fixtures and the rate-limit layer the deliverables read | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04`, `P5-T10` |
| The no-key clause of the definition of done, and the live measurements | `P5-T28`, `P5-T29`, `P5-T30` |

**Risks retired.** R-3 fully (`docs/11` §1 Phase 5). `docs/11` §1 and §3's table also list "R-19
(validated at scale)", but R-19 is PDF full-text extraction (`docs/11` §3), which no Phase 5
deliverable touches; this file claims only R-3 and records the contradiction in the report.

**Effort.** **34.0 developer-days over 30 cards** (§1), so the band these cards imply is
**34–48 d** (34.0 × 1.4 = 47.6 → 48). Against `docs/11`'s scaled 21–29 d the low end is **+62 %**
(34.0 ÷ 21 = 1.62), above the ~30 % `plan/README.md` §7 calls a signal to re-estimate the phase in
`docs/11`. *Corrected 2026-11-01 (review): was 33.25 d, 33.25–47 d, +58 %, before `P5-T23` (+0.25 d) and
`P5-T25` (+0.5 d) were re-estimated for work their neighbours assume (notes on both cards).* **Not propagated:** item 318(c) moves the estimate only after the review and the owner's
decisions. §3 says where the days went and where the sum is still likely low.

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
      live calls happen only in `P5-T04` (unkeyed fixture recording), `P5-T29` and `P5-T30`.
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
| Hidden feature preference precedent | `report.enabled` (`reportEnabled` in `PREFS`), item 307(d) | `P4-T19` |
| The fixture recorder and replay | `scripts/record-fixtures.ts` (`--source`, unkeyed by construction); `fixtureKey`, `replayTransport` (`test/contract/_transport.ts`); `test/support/*RecordedRequests.ts` | `P1-T11`, `P2-T33` |

### 0.2 Conventions binding on every card in this file

Items 1–10 of `plan/04` §0.2 apply unchanged (strings and `G-41`; one card adds preference rows;
test locations and the three-run rule; migrations appended; one redaction gate; no live requests; an
agent never holds a key; layering; callers named; open lines stop a step). Items 11–18 of `plan/07`
§0.2 apply where a card calls an LLM (budget on every call; ceilings pause; `cacheEpoch` in keys;
prompt text verbatim; the job conventions of item 18). In addition:

19. **No Semantic Scholar request without a key, unless the owner decides otherwise** (open line on
    `P5-T12`). A keyless run skips the Semantic Scholar generators before any request and says what a
    key adds; it never "tries anyway" against the anonymous pool.
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
| `P4-T04` | Built | `toDigest` — **only if** `P5-T22`'s open line is answered against its recommendation | `P5-T22` |
| `P4-T18` | **In progress** (another agent, 2026-11-01) | It edits `registerPipelines.ts`, `container.ts`, `registerUI.ts`, `docs/07` and `docs/12`, which Phase 5 cards also edit; grep names before editing | `P5-T03`, `P5-T14`, `P5-T22`, `P5-T25` |

---

## 1. Task list at a glance

| ID | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P5-T01` | Reconcile Phase 5 types and state machines in `docs/07` | 1.0 | none |
| `P5-T02` | Preference rows Phase 5 reads | 0.5 | none |
| `P5-T03` | Profile, recommendation and embedding tables | 1.0 | none |
| `P5-T04` | Record the relatedness fixtures | 1.0 | none |
| `P5-T05` | Semantic Scholar references, citations, title match | 1.0 | none |
| `P5-T06` | Semantic Scholar Recommendations, one seed and many | 1.25 | none |
| `P5-T07` | Europe PMC citations and references | 0.75 | none |
| `P5-T08` | PubMed related articles (`elink` pmra) | 1.0 | none |
| `P5-T09` | Crossref deposited references and title search | 0.75 | none |
| `P5-T10` | Relatedness cache, negative cache, request budget | 1.0 | none |
| `P5-T11` | Seed resolution with a title-match threshold | 1.25 | none |
| `P5-T12` | Related-paper generators, union and hydration | 1.25 | none |
| `P5-T13` | Related scoring, reason chips, recency de-emphasis | 1.0 | none |
| `P5-T14` | Related pipeline: stages, partial results, wiring | 1.5 | none |
| `P5-T15` | Item menu entry and the window's related mode | 1.25 | none |
| `P5-T16` | Related results: relation column, picker, key notice | 1.25 | none |
| `P5-T17` | Import from related results, optional *Related* link | 1.0 | none |
| `P5-T18` | Collection reader and statistical profile | 1.25 | none |
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
| | **Total** | **34.0** | 2 gates |

**Entry points** (no `Depends on`): `P5-T01`, `P5-T02`, `P5-T04`. All three are documents, rows and
fixtures and can start while `P4-T18` runs, provided they keep off the files it holds (`P5-T01` edits
`docs/07`, which `P4-T18` edits too — run it after `P4-T18` commits, or take exact-string edits under
the wave rules).

**Critical path inside the phase:** `P5-T01` → `P5-T03` → `P5-T18` → `P5-T21` → `P5-T23` → `P5-T24`
→ `P5-T25` → `P5-T26` → `P5-T27` → `P5-T28` → `P5-T30`, **14.25 d**, computed by script over the
**Depends on** rows. Feature 2's own chain (`P5-T01` → `P5-T06` → `P5-T12` → `P5-T13` → `P5-T14` →
`P5-T16` → `P5-T17`) is 8.25 d and finishes 4.25 d before Feature 6's (12.5 d to `P5-T27`), so a second
agent can carry it in parallel. *Corrected 2026-11-01 (review): was 13.5 d and 3.5 d before the two
re-estimates, both on this path.* `P5-T29` hangs off `P5-T06` and should run as early as `G-26` allows: its answer can
change `P5-T21` (`plan/05` §2.4, "the positive-seed cap is far below 10").

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
- modify `docs/07-architecture-and-data-model.md` (§2.2 tree, §4.2, §5.2, §12.2, §12.5; dated notes first)
- modify `docs/05-related-work-discovery.md` (§6.1's "doc 02 §3.7" reference; dated note)
- create `src/model/related.ts` (callers: `src/sources/*` adapters from `P5-T05`, `src/pipeline/related/*`; types only)
- create `src/model/profile.ts` (callers: `src/pipeline/recommend/*`, `src/zotero/db.ts` from `P5-T03`; types only)
- create `src/model/recommendation.ts` (same callers; types only)
- modify `src/sources/types.ts` (`findRelated`'s return type; `RelatedQuery.strategy`)

**Do.**
1. Documents first, under dated notes: in `docs/07` §4.2, `findRelated` returns a `RelatedPage` — a
   `SourcePage` whose records each carry a `RelationEdge` (`kind`: `reference` | `citation` |
   `recommendation` | `similar`; `rank`; optional `score` and `contexts`) — so the scorer can tell a
   citation from a recommendation (decided below).
2. In §5.2, extend `RecommendationSignals` to `docs/05` §7.4's eight terms and let `Recommendation`
   carry every generator that found it (decided below); add `ProfileUserEdits` to `CollectionProfile`
   (open line on `P5-T25`; write it only once that line is decided).
3. Rewrite §12.2 and §12.5 to the pipelines `P5-T14` and `P5-T25` build (decided below).
4. Correct `docs/05` §6.1's "resolve IDs … (doc 02 §3.7)": §3.7 is the PMC ID converter; the
   cross-ID resolver is Semantic Scholar's `/paper/batch` (`docs/02` §6.3).
5. Declare the types in the three `src/model/` files and change `LiteratureSource.findRelated`'s
   return type in `src/sources/types.ts`; no adapter implements it yet, so nothing else moves.

> **Open — recommended:** the shape `findRelated` returns. `docs/07` §4.2 has it return a plain
> `SourcePage`, which loses whether a record is a reference, a citation or a recommendation, its rank,
> pmra's score and Semantic Scholar's citation `contexts` — every input to `docs/05` §6.2's score and
> to FR-15's reason chips. **Recommended: a `RelatedPage` with one `RelationEdge` per record, declared
> in `docs/07` §4.2 first.** (Alternative: adapter-specific methods outside `LiteratureSource`, which
> leaves the interface alone but makes the related pipeline name each adapter.)

> **Open — recommended:** which signal set `docs/07` keeps. `docs/07` §5.2's `RecommendationSignals`
> has seven members (`embeddingSimilarity`, `subjectOverlap`, `termSimilarity`, `authorOverlap`,
> `citationLink`, `recency`, `venueAffinity`) and `Recommendation.discoveredVia` names one source;
> `docs/05` §7.4 scores eight terms (similarity, recency, velocity, novelty, author and venue affinity,
> generator agreement, coupling) over candidates found by several generators at once. **Recommended:
> `docs/05` §7.4's eight, with `discoveredVia` becoming a list.** (Alternative: keep `docs/07`'s seven
> and drop velocity, novelty, agreement and coupling from the score.)

> **Open — recommended:** what a related or recommend *job* is. `docs/07` §12.2 keeps the job alive in
> an `AwaitingSelection` state with a 30-minute timeout, and §12.5 is query-centric
> (`GeneratingQueries → Searching`). The search window already splits a run into a fetch-only job and
> an import of the previewed set (`SearchImportInput.records` + `works`). **Recommended: both jobs end
> when their results are shown; import is the search pipeline's preview import; neither job resumes
> after a restart (a re-run is cheap with `P5-T10`'s cache — item 303(c)'s precedent); §12.5 follows
> `docs/05` §7.1's five generators.** (Alternative: keep the human-in-the-loop state inside the job.)

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
the shapes. `docs/07` is shared with `P4-T18` — exact-string edits only, after it commits.

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

> **Open — recommended:** `related.linkToSeed`'s default. FR-17 calls the linkage optional ("S") and
> "when the user has enabled" it; `docs/08` §5.2's wireframe draws the checkbox ticked.
> **Recommended: `true`, and the window's checkbox starts from it.** (Alternative: `false`.)

> **Open — recommended:** how the two features hide until they work. **Recommended: two hidden
> boolean rows, `related.enabled` and `recommend.enabled`, default `false`, modelled on
> `report.enabled` (item 307(d)); `P5-T30` sets both defaults `true` in `docs/07` §8.5 first once the
> definition of done passes.** (Alternative: one shared row for both features.)

**Do NOT.**
- Do **not** add an exploration, peer-reviewed or embedding-provider row; those are per-run controls
  or not built (open lines on `P5-T20`, `P5-T24`, `P5-T27`).
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
| **Implements** | part of `FR-44`, part of `FR-49` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** `collection_profile`, `recommendation` and `embedding` exist as migrations 8–10 with a store
each, opened by `installPluginDatabase`.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.3 — the three `CREATE TABLE` statements and `idx_rec_profile`, `idx_embedding_model`
- `src/bootstrap/migrations.ts` header and `REPORT_DDL` — the byte-for-byte rule
- `plan/04` §0.2 item 4 — the two pinned version tests

**Files.**
- modify `src/bootstrap/migrations.ts` (three entries appended to `MIGRATIONS`)
- modify `src/zotero/db.ts` (`createCollectionProfileStore`, `createRecommendationStore`, `createEmbeddingStore`)
- modify `src/bootstrap/pluginDatabase.ts` (constructing file: `installPluginDatabase` builds the stores)
- modify `test/unit/core/provenanceRerun.test.ts`, `test/integration/zotero/provenanceStore.spec.ts` (version pins)
- modify `test/unit/pipeline/privacyPolicy.test.ts`, `test/unit/zotero/userPriceStore.test.ts` (version pins —
  *corrected 2026-11-01 (review): both assert `LATEST_SCHEMA_VERSION` is 7 (grep), so appending a migration
  fails them; `plan/04` §0.2 item 4's "two tests" is stale*)
- create `test/integration/zotero/recommendStores.spec.ts`

**Do.**
1. Append the three statements and both indexes exactly as `docs/07` §8.3 prints them (one migration
   per table).
2. Stores: profile get/put by `id` with the centroid blob sliced by `centroid_count`; recommendation
   put, `setAction(id, action)` and "rejected for profile"; embedding `putMany`/`getMany(workKeys,
   model)`/`allForModel(model)` with `Float32Array` ↔ `BLOB`.
3. Every JSON column passes through `redactRecord` (`plan/04` §0.2 item 5).

> **Open — recommended:** where vectors live. `docs/07` §8.3 and `docs/05` §5.4 put them in the
> `embedding` table, while `docs/07` §9.1–§9.2 and `CACHE_NAMESPACES` also declare an `embedding`
> cache namespace (100 MB) with `embeddingKey`. **Recommended: the table only; the cache namespace
> stays unused and `docs/05` §9.2's sentence naming it is corrected; the table is cleared by Phase 7's
> "Clear embeddings" (`docs/09` §3.7).** (Alternative: store vectors in `cache_entry`, which brings
> eviction for free but stores 3 KB vectors as cache values.) If `P5-T20`'s line is answered
> "lexical only", drop the `embedding` migration from this card (−0.25 d).

**Do NOT.**
- Do **not** edit a shipped migration; append.
- Do **not** add a `REFERENCES` clause (item 272(b) precedent).

**Done when.**
- [ ] `LATEST_SCHEMA_VERSION` is 10 and all four pinned tests say so (*corrected 2026-11-01 (review): was "both"*).
- [ ] The spec round-trips a profile with k = 2 centroids, a rejection, and 3 vectors byte-exact.
- [ ] Mutation sweep per §0.2 item 24.
- [ ] `npm run typecheck` exits 0; unit suite and the integration suite pass (three runs if any fails).

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- provenanceRerun privacyPolicy userPriceStore && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P4-T14` (migration 7, built). `P4-T18` may append nothing here; grep
`MIGRATIONS` before choosing version numbers.

---

### P5-T04 — Record the relatedness fixtures

| Field | Value |
|---|---|
| **ID** | `P5-T04` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P5-T05`, `P5-T06`, `P5-T07`, `P5-T08`, `P5-T09` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Recorded responses exist for every endpoint Phase 5 calls, so the adapter cards test against
real bodies with no network.

**Read first.**
- `scripts/record-fixtures.ts` header — politeness rules, unkeyed by construction, `--source`
- `docs/05` §2.1–§2.2, §3.1–§3.3, §4.2, §5.2 and `docs/02` §4.7, §6.2 — the requests and their verified shapes
- `docs/13` §3.1 — fixture inventory rules

**Files.**
- modify `scripts/record-fixtures.ts` (scenario lists for the new endpoints)
- modify `test/support/semanticscholarRecordedRequests.ts`, `test/support/europepmcRecordedRequests.ts`,
  `test/support/pubmedRecordedRequests.ts`, `test/support/crossrefRecordedRequests.ts`
- create fixtures under `test/fixtures/{semanticscholar,europepmc,pubmed,crossref}/`
- modify `docs/13-testing-build-and-release.md` (§3.1 inventory rows; dated note)

**Do.**
1. Scenarios: S2 `/paper/{id}/references` and `/citations` (with `contexts,intents,isInfluential`),
   `/recommendations/v1/papers/forpaper/{id}?from=recent`, `POST /recommendations/v1/papers/` (2 positives,
   1 negative), `/paper/search/match`, `/paper/batch` with `embedding.specter_v2` and with
   `references.externalIds`, a 404 seed; Europe PMC `/MED/{id}/citations` and `/references`, plus a
   hand-written 503 `text/plain` body (`docs/02` §4.7); NCBI `elink` `cmd=neighbor_score` with two
   separate `id` params; Crossref `/works/{doi}` with a deposited `reference[]` and one without.
   *Corrected 2026-11-01 (review): the list lacked four bodies that later cards' "Done when" lines test —
   `/paper/search/match` for a title with no match (`P5-T05` step 2), a 400 for an unknown field (`P5-T05`),
   `/paper/batch` with one unresolvable id among valid ones (`P5-T06`'s "one bad seed among ten"), and
   the Recommendations 400 "Response would exceed maximum size" (`P5-T06`; hand-written, `"synthetic": true`).*
2. Record live, unkeyed, sequentially, with `docs/05`'s probe papers; hand-written error bodies carry
   `"synthetic": true`.
3. Add the inventory rows to `docs/13` §3.1.

> **Open — recommended:** how Semantic Scholar's relatedness scenarios get recorded, since the
> anonymous pool returned 429 on 12 of 12 calls (`docs/02` §6.4) yet the 2026-10-15 search fixtures
> were recorded unkeyed. **Recommended: the agent records unkeyed per the recorder's rule, retrying
> off-peak; any scenario the anonymous pool refuses is recorded by the owner with the key in the
> process environment (the `P3-T30` precedent, no spend; `x-api-key` is a header, so `fixtureKey` is
> unchanged).** (Alternative: the owner records every S2 scenario keyed from the start.)

**Do NOT.**
- Do **not** provoke a 429 or a 5xx; hand-write them.
- Do **not** loop over a result set; this recorder is not a harvester.
- Do **not** read, print or store a key (`plan/04` §0.2 item 7).

**Done when.**
- [ ] Every scenario in step 1 has a fixture or a `"synthetic": true` stand-in with its reason.
- [ ] `npm run test:contract` still passes; `npm run fixtures:record -- --source semanticscholar --dry-run` lists the new scenarios.

**Verify with.**
```bash
npm run test:contract && npm run fixtures:record -- --source semanticscholar --dry-run
```

**Notes.** Network: `NODE_USE_SYSTEM_CA=1` on this network. No mutation sweep (data only). The adapter
cards each add their parse tests against these files.

---

### P5-T05 — Semantic Scholar references, citations, title match

| Field | Value |
|---|---|
| **ID** | `P5-T05` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T04` |
| **Blocks** | `P5-T11`, `P5-T12`, `P5-T20` |
| **Retires** | part of `R-3` |
| **Implements** | part of `FR-14`, part of `FR-15` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The Semantic Scholar adapter exposes `findRelated` for references and citations (with
`contexts`) and a title match, and declares `relatedByWork` / `citationGraph` true.

**Read first.**
- `docs/05-related-work-discovery.md` §2.1 (contexts, `intents` is a bonus never a filter), §2.2 (the silent nested-selector trap)
- `docs/02-literature-database-apis.md` §6.2, §6.3, §6.10 — endpoints, ID prefixes, error bodies
- `src/sources/semanticscholar/semanticscholarSource.ts` header — keyed/unkeyed, `code` as a string

**Files.**
- create `src/sources/semanticscholar/graph.ts` (request builders and parsers; caller: the source below)
- modify `src/sources/semanticscholar/semanticscholarSource.ts` (`findRelated`, `matchTitle`, capability flags)
- create `test/unit/sources/semanticscholarGraph.test.ts`
- modify `test/unit/bootstrap/container.test.ts` (only if the flag invariant needs the new member named)

**Do.**
1. `findRelated` with `strategy: "references" | "citations"`: `limit` ≤ 1000, fields including
   `externalIds`, `year`, `title`, `citationCount`, and for citations `contexts,intents,isInfluential`;
   each record carries a `RelationEdge`.
2. `matchTitle(title)` over `/paper/search/match`, returning the match and its fields; "no match" is a
   result, not an error. *Corrected 2026-11-01 (review), rule 8: the draft stated "a 404 is no match" as a
   premise, but `docs/02` §6.2 lists the endpoint with no recorded response. Verify the no-match status and
   body against `P5-T04`'s no-match fixture; I believe it is a 404 with an error message.*
3. Set `relatedByWork` and `citationGraph` true.

**Do NOT.**
- Do **not** request `citingPaper.references.*` inline; it is ignored silently (`docs/05` §2.2).
- Do **not** loop per paper; hydration is `lookup` over `/paper/batch`.
- Do **not** send a request when no key is present and the caller says keyless (§0.2 item 19).

**Done when.**
- [ ] Parsers read `P5-T04`'s fixtures; `contexts.length` survives into the edge.
- [ ] A 404 seed, a 400 field error and a 429 map to the existing error classes.
- [ ] `container.test.ts`'s invariant holds with the flags true.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- semanticscholar container` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- semanticscholar container
```

**Notes.** Needs: `P2-T05`, `P2-T34` (built). Shares `semanticscholarSource.ts` with `P5-T06` and
`P5-T20`; run them in sequence or as exact-string edits.

---

### P5-T06 — Semantic Scholar Recommendations, one seed and many

| Field | Value |
|---|---|
| **ID** | `P5-T06` |
| **State** | `TODO` |
| **Depends on** | `P5-T01`, `P5-T04` |
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
- create `src/sources/semanticscholar/recommendations.ts` (caller: the source below)
- modify `src/sources/semanticscholar/semanticscholarSource.ts` (`findRelated` `strategy: "auto"` → forpaper; `recommend(positives, negatives, limit)`)
- create `test/unit/sources/semanticscholarRecommendations.test.ts`

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
- create `src/sources/europepmc/citations.ts` (caller: the source below)
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
- create `src/sources/pubmed/elink.ts` (request builder and parser; caller: the source below)
- modify `src/sources/pubmed/pubmedSource.ts` (`findRelated`, flags)
- create `test/unit/sources/pubmedElink.test.ts`

**Do.**
1. `elink.fcgi?dbfrom=pubmed&db=pubmed&cmd=neighbor_score&linkname=pubmed_pubmed&retmode=json` with
   one `id=` parameter per seed and the identity parameters the existing builders add.
2. Per linkset: drop the seed itself, normalise `score / max`, slice to the caller's limit; edges of
   kind `similar` with rank and score.
3. Hydrate survivors through the existing efetch path in batches of `EFETCH_MAX_IDS_PER_CALL`.

**Do NOT.**
- Do **not** pass a comma-joined `id` list; it merges linksets and loses per-seed attribution.
- Do **not** compare raw scores across linksets.

**Done when.**
- [ ] A two-seed fixture yields two linksets with scores in (0, 1] and no seed in its own list.
- [ ] `createHttpClient`'s NCBI identity check accepts the request (test).
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
- create `src/sources/crossref/references.ts` (caller: the source below)
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
- modify `docs/07-architecture-and-data-model.md` (§9.2 rows for the per-signal TTLs; dated note)
- create `test/unit/pipeline/relatedFetch.test.ts`

**Do.**
1. Documents first: write `docs/05` §9.2's per-signal TTLs into `docs/07` §9.2 as rows of the
   `source-response` namespace (decided below).
2. `cachedRelated(cache, kind, key, fetch)`: cache first; on a permanent 404 write a negative entry
   for 7 days; keys through `cacheKey`.
3. `RequestBudget` with `tryTake(n)` and a generator order table (`docs/05` §9.3); a generator that
   cannot take its full share processes fewer seeds.

> **Open — recommended:** which TTLs ship. `docs/07` §9.2 gives `source-response` two TTLs (24 h for
> search results, 30 d for lookups); `docs/05` §9.2 gives ten per-signal TTLs (references 90 d,
> citations 7 d, recommendations 3 d, pmra 14 d, negative 7 d …) and calls them a refinement.
> **Recommended: `docs/05`'s ten, as rows under `source-response` in `docs/07` §9.2.** (Alternative:
> `docs/07`'s two, which re-fetches references weekly and recommendations for 24 h only.)

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

**Do.**
1. Documents first: write the threshold decided below into `docs/05` §6.1 (FR-14 says "per
   `05-related-work-discovery.md`", which states none).
2. Identifiers from the seed's `CanonicalWork` (`fromZoteroItem` supplies it via the pipeline's Zotero
   port); expand through S2 `lookup` when keyed, else the PMC converter for a PMCID.
3. Title only: candidates from S2 `matchTitle` (keyed) and Crossref `matchTitle`; keep those passing
   the threshold; one → resolved with a "matched by title" flag; several → `"choose"` with the list;
   none → an error naming DOI, PMID, arXiv ID and title.

> **Open — recommended:** the title-match threshold. **Recommended: the dedupe cascade's own
> constants — `levSim` ≥ `LEVSIM_DUPLICATE_THRESHOLD` (0.95), or ≥ `LEVSIM_CORROBORATED_THRESHOLD`
> (0.88) with |year delta| ≤ `MAX_YEAR_DELTA` and the first author's family name matching.** (Alternative:
> a new threshold tuned on sampled seeds, which needs a labelled sample.)

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

**Do.**
1. Generators A–E of `docs/05` §6.1: S2 forpaper, references, citations (keyed only, §0.2 item 19);
   pmra (PMID); Europe PMC citations/references; Crossref references (DOI).
2. `Promise.allSettled`; a failed generator becomes a per-source status row ("not indexed", "rate
   limited", "no key"), never a failed run.
3. Union, then `dedupeAndMergeAsync`; keep every edge on the merged work; hydrate survivors through
   `lookup` (S2 batch when keyed, else Europe PMC / efetch) and `backfillAbstracts`.
   *Corrected 2026-11-01 (review): `ABSTRACT_BACKFILL_LADDER` includes Semantic Scholar and the shipped
   `sources` default ticks it, so a keyless run passes `AbstractBackfillDeps.selected` without
   `semanticscholar` (item 194's mechanism); otherwise §0.2 item 19 and `P5-T28`'s zero-request check fail.*

> **Open — recommended:** what a keyless run does with Semantic Scholar. `P0-T22` measured 12 of 12
> anonymous requests refused. **Recommended: no S2 request at all without a key; the S2 generators
> report "no key" and the window says what a key adds (§0.2 item 19).** (Alternative: one anonymous
> attempt per run with the host's backoff, which adds seconds of 429s to most keyless runs.)

> **Open — recommended:** co-citation. FR-15 names "co-cited" as an example chip; `docs/05` §2.2
> designs a two-request batch version gated on `citationCount ≥ 20`. **Recommended: not in Phase 5
> (rule 9: no finishing condition needs it); `plan/00` §6 tagged Phase 5.** (Alternative: build it now,
> +0.5 d.)

**Do NOT.**
- Do **not** hydrate the raw union (`docs/05` §9.1 item 2).
- Do **not** call OpenAlex (D2).

**Done when.**
- [ ] With every generator mocked, a DOI seed's union holds each generator's edges on merged works.
- [ ] One generator throwing leaves the others' results and a status row.
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
| **Estimate** | 1.5 d |
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

**Do.**
1. Stages: resolve seed → expand ids → generators (partial results allowed) → score → filter (self,
   type) → mark in-library through `LibraryIndex.findExisting` and `matchAgainstLibrary`; output rows
   with chips, score, `inLibrary`, `outsideWindow`.
2. Inject the `SimilarityFn`: SPECTER2 cosine when keyed and both vectors exist (`P5-T20`), else the
   lexical cosine (`P5-T19`), never mixed within one run.
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
- [ ] Mutation sweep; `npm run typecheck`, `npm run test:unit -- relatedPipeline container` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- relatedPipeline container && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P1-T16`, `P3-T29` (built). `registerPipelines.ts` and `container.ts` are being
edited by `P4-T18`; grep `buildPipelineSet` and `installServices` before editing.

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
- modify `test/integration/menus.spec.ts`, `test/integration/lifecycle.spec.ts`, `test/integration/l10n.spec.ts`, `test/unit/i18n/keys.test.ts`

**Do.**
1. `rh-menu-item` with `research-helper-menu-item-find-related`, enabled when exactly one regular item
   is selected (decided below), hidden when `related.enabled` is false.
2. The window opens with `{ mode: "related", seedItemID }`; header shows title, authors, venue, year,
   DOI; the "Include" checkboxes per relation kind; year controls default to "Any" (`docs/08` §5.2).
3. Strings with commented ko-KR stubs on `KO_PENDING_REVIEW`.

> **Open — recommended:** multi-selection (FR-13 scenario 2). **Recommended: the entry is disabled
> unless exactly one regular item is selected, as `docs/08` §2.4's code does; a tooltip only if the
> agent measures that Zotero's menu manager shows one on a disabled item — otherwise no tooltip, and
> FR-13's "with an explanatory tooltip" is corrected.** (Alternative: multi-seed "Find papers related
> to N items" through `recommend`, +1 d.)

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
- modify `docs/08-ui-ux-spec.md` (§5.2 note on years; §5.3 picker; §7.4 key text; dated notes)
- create `test/unit/ui/relatedViewModel.test.ts`; modify `test/integration/searchDialog-flow.spec.ts`

**Do.**
1. Documents first (decided below): `docs/08` §5.2's year note cites FR-18's de-emphasis; §5.3 gains
   the title-match picker; §7.4's "Related papers and recommendations need a key" becomes "work better
   with a key" (open line on `P5-T28`).
2. Relation column and chips, score as dots, in-library marker (unchecked), out-of-window rows greyed
   and unchecked, per-source status rows, the keyless notice with the key-request link.
3. A `"choose"` seed shows the candidates; the run continues with the user's pick.

> **Open — recommended:** year handling. FR-18 says "the default 3-year window is active … older
> candidates are still shown but visually de-emphasized and unchecked"; `docs/08` §5.2 draws no year
> filter by default and a "Restrict to last 3 years" box, unticked. **Recommended: both — no filter by
> default, and rows outside the `searchYears` window greyed and unchecked.** (Alternative: tick
> "Restrict to last 3 years" by default, which hides the foundational references `docs/08` warns about.)

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

**Notes.** Needs: `P1-T20`, `P1-T21` (built).

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

> **Open — recommended:** which items get the seed link. FR-17 says "each imported item"; `importWorks`
> leaves an existing item untouched except for the collection add. **Recommended: created items and
> linked-existing items alike, since the user ticked the box and a relation is additive and removable
> in Zotero's own pane.** (Alternative: created items only.)

> **Open — recommended:** a provenance note for related and recommend imports. FR-8's provenance note
> is the keyword search's, and `SearchProvenance` (`docs/07` §5.3) is query-shaped. **Recommended: none
> in v1; the job record keeps the seed or profile id.** (Alternative: extend `SearchProvenance` and its
> JSON schema with a run kind.)

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
| **Estimate** | 1.25 d |
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
- modify `src/bootstrap/registerPipelines.ts` (`createZoteroRecommendLibrary`: collection items, library term counts, `LibraryIndex`,
  and each item's `dateAdded` — *corrected 2026-11-01 (review): `P5-T21` needs `addedAt`, and
  `src/zotero/itemMapper.ts` reads no `dateAdded` (grep), so the port is the only route; this answers the
  author's open question*)
- create `test/unit/pipeline/recommendProfile.test.ts`

**Do.**
1. Read the collection's regular items as `CanonicalWork`s; refuse fewer than 5 (FR-44).
2. Term weight `(countInCollection / size) · ln(1 + librarySize / (1 + countInLibrary))`; drop the
   check tags; prefer major-topic MeSH; authors ≥ 2 plus every last author; top venues; year histogram.
3. `membershipHash` over sorted item keys and `dateModified`; `ownedInCollection` and
   `ownedInLibrary` identifier sets; persist through `P5-T03`'s store.

**Do NOT.**
- Do **not** count `Humans`, `Animals`, `Male`, `Female` … as topics.
- Do **not** send anything anywhere; this card is local.

**Done when.**
- [ ] A 30-item fixture profile ranks a MeSH term present on every library item below one specific to the collection.
- [ ] The hash changes when an item is added or modified and not otherwise.
- [ ] Mutation sweep; `npm run typecheck` and `npm run test:unit -- recommendProfile` pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendProfile
```

**Notes.** Needs: `P1-T12` (built). The library-wide term counts are one pass per run; measure on the
owner's library in `P5-T30`.

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

**Do.**
1. Documents first: answer `docs/07` §13 item 5 and align `docs/03` §16 with the decision below.
2. `fetchEmbeddings`: `fields=embedding.specter_v2`, ≤ 200 ids per call, papers without a vector
   reported, never retried individually.
3. `ensureEmbeddings(works, model)`: store first, fetch the missing, normalise, write through the
   `embedding` store tagged `specter_v2`; `cosine` refuses vectors of two models.

> **Open — recommended:** the v1 embedding route (`docs/07` §13 item 5; `plan/05` §2.3). `docs/05`
> §5.1 defaults to SPECTER2 with `text-embedding-3-small@768` as fallback; `docs/03` §16 defaults to
> `gemini-embedding-2`, then `text-embedding-3-small`, then BM25; OpenRouter's coverage is
> `Unverified`. **Recommended: SPECTER2 through Semantic Scholar when a key is present, `P5-T19`'s
> lexical floor otherwise; no third-party embedding provider in v1** — it adds a second content egress,
> a consent path and a cost line for an "optional" deliverable, and the key is already in hand.
> (Alternatives: lexical only, −1.75 d across `P5-T03`, `P5-T20`, `P5-T21`; or add
> `text-embedding-3-small` as a fallback, +1.5 d and a new egress notice.)

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
plus up to 10 negatives from the collection's dismissals.

**Read first.**
- `docs/05-related-work-discovery.md` §7.2 "Seed selection" (weights, `addedAt` from `dateAdded`, the 0.92 diversification cut), "Multi-topic collections" (`kMax: 4, minClusterSize: 5, minGain: 0.08`), "Negative examples"

**Files.**
- create `src/pipeline/recommend/centroids.ts` (`kmeansAuto`; caller: `recommendPipeline.ts`)
- create `src/pipeline/recommend/seeds.ts` (`selectSeeds`; caller: `recommendPipeline.ts`)
- create `test/unit/pipeline/recommendSeeds.test.ts`

**Do.**
1. `kmeansAuto` on SPECTER2 vectors, k chosen by silhouette with `docs/05`'s guards and a seeded
   initialisation (deterministic); no centroids on the lexical path (`docs/07` §5.2: empty array).
2. `selectSeeds` as `docs/05` §7.2 writes it, `addedAt` passed in, diversification on the run's
   similarity space; cap at `RECOMMEND_MAX_POSITIVES`.
3. Negatives: the 10 most recent rejections for this profile (`P5-T03`'s store).

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
focus statement, core topics, exclusion signals and suggested query terms, priced, disclosed and
confirmed like every other LLM job, and cached on membership, prompt and model.

**Read first.**
- `docs/12-prompt-library.md` §15 (prompt, schema, "Strong model, `temperature: 0.2`, `max_tokens: 2500`"), §18.5 (tier, effort "not assigned")
- `docs/09-security-privacy-and-api-keys.md` §3 row "6. Recommend" — what may reach the LLM
- `src/pipeline/shared/egressDisclosure.ts`, `estimate.ts`; `confirmRunCost` in `src/bootstrap/registerUI.ts`

**Files.**
- modify `docs/12-prompt-library.md` (§15 input table; dated note), `docs/09-security-privacy-and-api-keys.md` (§3 row 6; dated note)
- create `src/prompts/collection-profile.v1.0.0.md`, `src/prompts/schemas/collection-profile.v1.json`
- modify `src/prompts/index.ts` (`PROMPT_IDS`, `PROMPT_FILE_NAMES`, `PROMPT_SCHEMAS`), `src/prompts/bundled.ts`
- create `src/pipeline/recommend/profileCall.ts` (caller: `recommendPipeline.ts`, `P5-T25`)
- modify `src/pipeline/shared/estimate.ts` (one priced call), `src/pipeline/shared/egressDisclosure.ts` (a profile notice id)
- modify the two `research-helper-mainWindow.ftl` bundles, `src/i18n/keys.ts`
- create `test/unit/pipeline/recommendProfileCall.test.ts`; modify `test/integration/prompts.spec.ts`

**Do.**
1. Documents first: correct `docs/12` §15's `{{DIGESTS}}` row and `docs/09` §3 row 6 to the input
   decided below, and record that `RECOMMEND_RANK` (§16) is not built in v1 (decided below).
2. The prompt file is `docs/12` §15 byte for byte; the schema is its "Expected output".
3. Build the per-item lines; plan scope `metadata-only` through `allowedInputScope`; price one call at
   the `strong` tier's model with output at 2 500 tokens; disclose and confirm through the existing
   dialog (`mustAskConfirmation`); call through `withBudget` and `completeJSON`; validate; map
   `focusStatement`/`suggestedQueryTerms` to `narrative`/`suggestedQueries`.
4. No provider: skip the call and mark the profile "heuristic" (FR-45 scenario 2).

> **Open — recommended:** what `COLLECTION_PROFILE` is sent. `docs/12` §15 feeds it "paper digests",
> which `docs/06` §6.1 item 5 says are built from `PaperSummary` objects — so a run would first need a
> summary of every item; `docs/09` §3 row 6 allows "top terms, subjects, venues, years, and optionally a
> sample of titles", and abstracts only "in a distinct, labelled" mode. **Recommended: one line per item
> — title, year, venue, top MeSH/keywords — under scope `metadata-only`, with no abstracts and no
> summaries; `docs/09` row 6 is corrected from "a sample of titles" to "every item's title".**
> (Alternative: `P4-T04`'s digests over stored summaries, which needs the report's ensure-summaries
> step, its cost and the distinct labelled mode.) *Privacy rule — the owner's (item 313).*

> **Open — recommended:** which LLM calls Phase 5 makes at all. FR-45 asks for LLM-assisted *query
> generation*; `docs/12` §16 `RECOMMEND_RANK` would also re-rank every candidate batch (a paid call per
> run, rule 2 "do not reward citation count" against `docs/05` §7.4's velocity term), and `docs/07`
> §12.5 adds "optional LLM rationales". **Recommended: `COLLECTION_PROFILE` only; scores and reasons in
> code (`docs/05` §7.4, FR-47); `RECOMMEND_RANK` and model-written rationales go to `plan/00` §6 tagged
> Phase 5.** (Alternative: ship `RECOMMEND_RANK` as an optional re-rank, +1.5 d and a cost line per run.)

**Do NOT.**
- Do **not** edit or translate the prompt text.
- Do **not** call an adapter directly; the router through `withBudget` only.
- Do **not** send abstracts, notes or summaries under the recommended line.

**Done when.**
- [ ] On the mock router, a 30-item profile makes one call; a second run with unchanged membership makes none.
- [ ] Strict privacy mode still allows `metadata-only` and the egress notice names the model and the scope.
- [ ] A schema-invalid answer is repaired once, then the profile falls back to "heuristic" with a warning.
- [ ] Mutation sweep; `npm run typecheck`, `npm run test:unit -- recommendProfileCall prompts` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- recommendProfileCall prompts && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P3-T12`, `P3-T15`, `P3-T16`, `P3-T24` (built). `docs/12` and `estimate.ts` are
shared with `P4-T18`. `docs/12` §15's cache key ("sorted `(itemKey, contentHash)`") and `docs/07`'s
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
- modify `docs/05-related-work-discovery.md` (§7.3 row d: "the selected sources", per FR-45; dated note) —
  *corrected 2026-11-01 (review); see the note under **Do***

**Do.**
1. (a) S2 `recommend` with the seeds and negatives (keyed); (b) pmra over ≤ 10 PMID seeds; (c) forward
   citations of the top seeds (S2 keyed, else Europe PMC); (d) keyword queries — the profile's
   `suggestedQueries` when the LLM ran, else its top-weighted terms — through `fanOut` over the
   `sources` preference's members with the recency window; (e) an author watch: one Europe PMC query
   OR-ing the top 5 authors over the last 90 days.
2. `RequestBudget` of 40 by default, taken in `docs/05` §9.3's order; `Promise.allSettled`; per-generator
   status rows.
3. Union, `dedupeAndMergeAsync`, every generator kept on the merged work.

*Corrected 2026-11-01 (review), two gaps between this card's steps and what the cards around it assume:*
- *Step 1 (d) fans out over the `sources` preference, whose shipped default includes `semanticscholar`,
  and the Semantic Scholar adapter's `isConfigured()` is `true` without a key (grep). Under §0.2 item 19
  a keyless run drops `semanticscholar` from (d)'s source list; otherwise `P5-T28`'s "zero requests to
  `api.semanticscholar.org`" fails on this generator. (`docs/05` §7.3 names "Europe PMC + arXiv" for (d)
  while FR-45 says "the selected sources"; FR-45 is followed here and `docs/05` §7.3's row is corrected
  under a dated note.)*
- *Per-cluster generation: this card's own **Do NOT** ("more than once per cluster") and `P5-T27`'s
  grouping by centroid assume generation per cluster (`docs/05` §7.2, "run generation per cluster and
  interleave results, labelling each group"), but no step built it. How many requests it may take is a
  new open line in the review (`plan/reports/phase5-review.md`); the estimate is raised 1.5 → 1.75 d for
  it.*

> **Open — recommended:** the generator set. **Recommended: all five of `docs/05` §7.3, with the
> author watch included because it is one request and `docs/05` calls it "often the single most valued
> recommendation type".** (Alternative: drop the author watch, which no FR names.)

**Do NOT.**
- Do **not** run per-cluster generation more than once per cluster.
- Do **not** call OpenAlex.

**Done when.**
- [ ] A budget of 12 runs (a) and (b) fully and (c) for the seeds the budget allows.
- [ ] With every S2 call refused, (b), (d) and (e) still return candidates.
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

**Do.**
1. Hard filters: in the source collection; dismissed (unless "show dismissed"); outside the date
   window; no abstract and no tldr; a preprint whose published version the user owns.
2. Library items outside the collection stay, marked `inLibrary` and unchecked (FR-46, decided below).
3. The eight terms with similarity and novelty from the run's space (SPECTER2 max-over-centroids,
   else lexical); `w_sim = 0.40 − 0.40·t`, `w_nov = 0.40·t`, `t` in [0, 1] from the per-run slider
   (default 0.25); weights sum to 1.00.
4. `diversify`: `maxPerAuthor` 2, `maxPerVenue` 4, MMR λ 0.75; top K (default 30). Reason ids from the
   two strongest terms plus "recommended by Semantic Scholar" / "cites N papers in your collection" /
   "author in your collection".
5. `docs/05` §8.3's sanity checks as tests (seed never returned, ≥ 95 % in window, zero collection
   items, ≥ 5 distinct first authors, non-degenerate scores, every row has an abstract or tldr).

> **Open — recommended:** what happens to library items outside the collection. `docs/05` §7.4's hard
> filter drops everything owned **library-wide**; FR-46 says items "elsewhere in the library are marked
> 'in library' and unchecked by default". **Recommended: FR-46 — exclude the collection, mark the
> library; correct `docs/05` §7.4 in place.** (Alternative: `docs/05`'s library-wide exclusion.)

> **Open — recommended:** preprints. `docs/05` §3.2 asks for a "preprint (not peer reviewed)" badge and
> a "peer-reviewed only" filter; `plan/05` §2.3 asks whether the filter ships and defaults on.
> **Recommended: the badge on every preprint row in both features; "Peer-reviewed only" a per-run
> checkbox, default off, with no preference.** (Alternative: a preference, default on.)

**Do NOT.**
- Do **not** apply a hard filter as a score penalty.
- Do **not** use the bare `1 − cosine` (`docs/05` §7.4: rescale to [0, 1]).

**Done when.**
- [ ] At `t = 0.25` the weights equal the starting weights; at any `t` they sum to 1.00 ± 1e-9.
- [ ] Each `docs/05` §8.3 check is a passing test on a fixture run.
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

**Do.**
1. Stages: profile check (stored profile with equal `membershipHash` → reuse) → build stats
   (`P5-T18`) → vectors and centroids (`P5-T20`, `P5-T21`) → profile call (`P5-T22`, priced and
   confirmed before anything is sent) → apply user edits → generate → filter/score/diversify → result.
2. `recordAction(profileId, workKey, "rejected" | "accepted")` through the recommendation store.
3. Cancel at stage boundaries; a pause from a budget refusal keeps the stage pending (`plan/07` §0.2
   item 18).

*Corrected 2026-11-01 (review); estimate raised 1.5 → 2.0 d. Three pieces of work that other cards rely on
and no step built:*
- *FR-44 shows the profile **before** searching and uses the edited profile. `P5-T26` step 3 runs "the
  pipeline to the profile stage", then "Find papers" continues with the edits, but step 1 above is one
  uninterrupted run whose "apply user edits" can only apply edits stored by an earlier run. The pipeline
  needs a profile-only run and a run that takes the edited profile as input (the shape is a new open line
  in the review).*
- *`docs/05` §7.5 hydrates the survivors of the identifier-level filters and fetches their vectors
  (`ensureEmbeddings(candidates)`) before scoring; `P5-T23` stops at the merged union and `P5-T24` scores,
  so no stage hydrates or fetches candidate vectors. `P5-T24`'s "no abstract and no tldr" filter can
  only run after hydration, so the filters split into identifier-level ones before hydration and that one
  after.*
- *The key probe (`container.ts` row above).*

> **Open — recommended:** whether the user's profile edits outlive one run (FR-44 says only "the edited
> profile is used"). **Recommended: store them as `userEdits` (removed and added terms) on the profile
> and re-apply them after a rebuild; written into `docs/07` §5.2 by `P5-T01`.** (Alternative: edits
> apply to one run only.)

> **Open — recommended:** dismissal scope (FR-49). **Recommended: per profile — a paper dismissed for
> one collection still appears for another — stored as `recommendation.user_action = "rejected"`, with
> the 10 most recent sent as negatives.** (Alternative: library-wide dismissals.)

**Do NOT.**
- Do **not** spend before the confirmation; do **not** send under a privacy mode that forbids it.
- Do **not** resume after a restart (`P5-T01`'s line).

**Done when.**
- [ ] A second run on an unchanged collection makes no LLM call and reuses vectors.
- [ ] A dismissed paper is absent on the next run and present with "show dismissed".
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

**Do.**
1. Documents first: write `docs/08` §5.4 — the profile panel (focus statement, read-only; term chips
   with remove and add; authors; venues; "heuristic profile" notice when no LLM ran) above the shared
   result table, as decided below.
2. The entry in the collection submenu's search group (`docs/08` §2.5), one collection selected.
3. "Build profile" runs the pipeline to the profile stage (with its cost question); "Find papers"
   continues with the edited profile.

> **Open — recommended:** where the profile is edited. `docs/08` §1 has recommendations reuse the
> search window and draws no profile; `docs/11` §1 lists "`src/ui/panes/*` (profile editor)".
> **Recommended: a profile panel inside the search window's recommend mode, wireframed in `docs/08`
> §5.4 first.** (Alternative: a separate profile-editor pane, a fourth window.)

**Do NOT.**
- Do **not** start candidate generation before the user has seen the profile (FR-44).
- Do **not** machine-translate.

**Done when.**
- [ ] The view-model test removes a term and the pipeline input carries the edit.
- [ ] The entry is absent while `recommend.enabled` is false; menu-count specs updated.
- [ ] Mutation sweep on the view model; `npm run typecheck`, `npm run test:unit -- keys recommendViewModel` and the integration suite pass.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- keys recommendViewModel && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Needs: `P2-T17` (the search group of the submenu, built).

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

**Do.**
1. Rows grouped by centroid label when k > 1; reason line from `P5-T24`'s reason ids; "in library"
   rows unchecked; the preprint badge; the per-run "Peer-reviewed only" box.
2. "Not interested" records the rejection and removes the row; "Show dismissed" brings them back.
3. Import ticked rows through the preview import into a subcollection of the source collection named
   `<Source collection> — recommended <YYYY-MM-DD>` (`findOrCreateCollection` with `parentID`), or a
   user-chosen collection.

> **Open — recommended:** the slider. `docs/05` §7.4 calls it a "single user-facing slider".
> **Recommended: a per-run control, default 25 of 100, not a preference.** (Alternative: a preference
> `recommend.exploration`, integer 0–100, so the user's choice persists.)

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
- modify `docs/10-requirements-and-user-stories.md` (§5 Q8 marked decided — after the owner decides)
- create `test/integration/pipeline/noKeyRelatedness.spec.ts`
- modify `docs/11-implementation-roadmap.md` (§3's risk-retirement table: Phase 2 "R-3 (fallback proven)" corrected, and
  §1 Phase 2's "**Risks retired.** R-2, R-3, R-18", which claims the same; dated note — *corrected 2026-11-01
  (review): the §1 line was missing*)

**Do.**
1. A spec with a transport that fails the test on any `api.semanticscholar.org` request: a DOI seed
   with a PMID yields related rows (pmra, Europe PMC, Crossref); a 30-item fixture collection yields
   recommendations (pmra, keyword queries, author watch).
2. Both results carry the key notice; the related window shows it.
3. Correct `docs/11` §3: Phase 2 proved no relatedness fallback — no adapter had `findRelated`
   (`plan/00` §6 item 184).

> **Open — recommended:** `docs/10` §5 Q8, "Is a Semantic Scholar API key a hard requirement?".
> **Recommended: no — degrade gracefully, as Q8's default says; mark it decided; correct `docs/08` §7.4's
> "need a key" to "work better with a key" (done by `P5-T16`).** (Alternative: require the key and show
> only the notice without one.)

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
- `docs/05-related-work-discovery.md` §3.3 item 5; `plan/06` `G-26`; `plan/05` §2.4 ("far below 10")

**Files.**
- create `test/integration/live/s2SeedCap.spec.ts` (behind `RH_DOD_LIVE`)
- modify `docs/05-related-work-discovery.md` (§3.3 marker replaced; dated note)
- modify `src/sources/semanticscholar/recommendations.ts` (`RECOMMEND_MAX_POSITIVES`)

**Do.**
1. Inside Zotero, through the shipped adapter and the stored key: POST with 10, 20 and 50 positives and
   10 negatives; record status, result count and latency.
2. Write the measured cap into `docs/05` §3.3 and the constant.

> **Open — recommended:** probe sizes. **Recommended: 10, 20, 50 positives with 10 negatives; keep 15 as
> the default seed count unless 15 fails.** (Alternative: no probe; ship at 15.)

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

**Notes.** Run as early as `G-26` allows; a cap below 10 changes `P5-T21` (`plan/05` §2.4).

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
| **Human gate** | **Yes** — gates `G-26` (key entered), `G-27` (the owner, as domain expert, judges one 30-item collection's profile and its recommendations), `G-18` (an LLM key, for the profile call), and a spend gate for the profile calls — expected under $1 in all at `docs/06` §5.4's illustrative $3/$15 per million tokens (one call of about 2 k input and ≤ 2.5 k output tokens per profile build, three builds), stated from `P5-T22`'s estimate and approved before dispatch (open line below). |

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
2. Recommend: a 30-item collection → profile and recommendations; zero collection members in the list;
   stop for `G-27`; record the owner's verdict verbatim.
3. Each `docs/13` §8.3 line → a recorded result; Phase 2's and Phase 3's open sign-offs recorded as
   they stand.
4. Only then set both feature rows' defaults to `true`, `docs/07` §8.5 first.

> **Open — recommended:** the spend gate. `plan/06` has `G-21` (summaries) and `G-42` (reports) and none
> for recommendation runs. **Recommended: a `G-43` modelled on `G-42`, added by the coordinator — "approve
> the first real recommendation run's cost estimate, and each paid Phase 5 run after it".**
> (Alternative: the card states its spend in this cell only.)

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

## 3. Estimate reconciliation

`docs/11` §1 Phase 5 publishes **21–29 d, "⚠ scaled, not decomposed"** (14 d × 1.50, × 1.4). These
cards sum to **34.0 d**, a band of **34–48 d** (34.0 × 1.4 = 47.6 → 48). The low end is 62 % above
21 (34.0 ÷ 21 = 1.62) and 17 % above the scaled top of 29 (34.0 ÷ 29 = 1.17); against the superseded
pre-2026-09-09 top of 14 d it is 2.43×, beside Phase 4's measured 2.16× (item 288(b)). *Corrected
2026-11-01 (review): was 33.25 d, 33.25–47 d, 58 %, 15 % and 2.38×, before `P5-T23` and `P5-T25` were
re-estimated.* `plan/README.md` §7 calls a divergence
above ~30 % a signal to re-estimate the phase in `docs/11`. **Not propagated**: item 318(c).

| Work area (`plan/05` §2.1) | Cards | Days |
|---|---|---|
| — types, preferences, tables, fixtures (no work area) | `P5-T01`, `P5-T02`, `P5-T03`, `P5-T04` | 3.5 |
| W5-1 Seed resolution | `P5-T11` (+ title match in `P5-T05`, `P5-T09`) | 1.25 |
| W5-2 Citation-graph gathering | `P5-T05`, `P5-T07`, `P5-T08`, `P5-T09`, `P5-T12` | 4.75 |
| W5-3 S2 Recommendations adapter | `P5-T06` | 1.25 |
| W5-4 Embedding layer | `P5-T19`, `P5-T20` | 2.0 |
| W5-5 Vector storage | in `P5-T03` | — |
| W5-6 Collection profiler | `P5-T18`, `P5-T21`, `P5-T26` | 3.75 |
| W5-7 Candidate generation | `P5-T22`, `P5-T23` | 3.25 |
| W5-8 Scoring, ranking, reasons | `P5-T13`, `P5-T24` | 2.5 |
| W5-9 Review, exclusion, import | `P5-T14`, `P5-T15`, `P5-T16`, `P5-T17`, `P5-T25`, `P5-T27` | 8.5 |
| W5-10 Rate limits, caching, evaluation | `P5-T10`, `P5-T28`, `P5-T29` | 2.25 |
| Acceptance | `P5-T30` | 1.0 |
| **Total** | 30 cards | **34.0** |

The unpriced work the scaled figure hid is the kind Phases 0–4 found, plus one kind of its own:
**four adapter extensions** behind a contract (`findRelated`) that no adapter implements (`plan/00`
§6 item 184); a fixture-recording pass over a rate-limited, anonymous-hostile host; two new pipelines
with their composition-root wiring; the plugin's first item context menu; two new modes of the
search window, one with an editor no document draws; three migrations with their pinned tests; a
documents-first reconciliation of types that disagree between `docs/05`, `docs/07` and `docs/12`; and
a mutation sweep on every logic card.

**What the open lines would do to the sum.** Each card is priced on its recommendation. Answered the
other way: lexical-only embeddings −1.75 d (`P5-T20`, part of `P5-T03`, `P5-T21`); a third-party
embedding fallback +1.5 d; `RECOMMEND_RANK` +1.5 d; multi-seed related +1.0 d; co-citation +0.5 d;
profile digests from stored summaries (instead of metadata) adds an ensure-summaries step, ≈ +1.0 d;
a separate profile-editor pane ≈ +0.75 d; an evaluation-harness card (§4) +1.0 d.

**Where the sum is still likely low** *(not re-estimated, because none has a measurement)*:
`P5-T16` and `P5-T26`–`P5-T27` extend the search window — `searchImportViewModel.ts` (3 171 lines),
`addon/content/searchDialog.js` (3 940) and `registerUI.ts` (2 303), measured 2026-11-01 — the kind of
surface that ran over in Phase 1; `P5-T04` depends on the
anonymous Semantic Scholar pool, which may push its S2 half to the owner; `P5-T12`/`P5-T23` assume
`fanOut` accepts a per-run budget without change (unverified); `P5-T18`'s library-wide term counts
are unmeasured on a 10 k-item library (NFR-3's main-thread rule may force batching). Together these
could add 2–3 d, which would put the low end near +71 % to +76 % (36–37 d; *corrected 2026-11-01 (review):
was +68 % to +73 % on the 33.25 d sum*).

*Added 2026-11-01 (review), not re-estimated here:* `P5-T04` ≈ +0.25 d for a keyed Semantic Scholar
recording path the recorder does not have ("No API key, by construction"), and up to +0.5 d more if the
coordinator moves the new request builders into it (review, recording-order line); `P5-T03` ≈ +0.25 d
(three stores with two `BLOB` codecs and four version pins, against `P4-T14`'s one table at 1.25 d);
`P5-T14` ≈ +0.25 d (the picker's continuation needs the pipeline to accept a chosen seed, and candidate
vectors must be fetched before the similarity term). About +0.75–1.25 d on top of the 2–3 d above, so the
low end is likely near 37–38 d (+76 % to +81 %).

---

## 4. What this file does not card, and why

| Item | Where the documents ask for it | Why no card |
|---|---|---|
| Held-out precision@k harness, ablation, `research_helper: run evaluation` | `docs/05` §8.1–§8.2; `plan/05` W5-10 | No `docs/11` DoD line needs it; `G-27`'s expert judgement is the finishing condition (rule 9). `docs/05` §8.3's sanity checks are test lines in `P5-T24`. Open line in the report; `plan/00` §6 tagged Phase 5 if confirmed |
| Implicit feedback log and add-rate (`docs/05` §8.4) | `docs/05` §8.4; `plan/05` §2.3 | Not a deliverable; `docs/09` §3.7 would need a clear action. Backlog |
| Background prefetch and `background.enabled` | `docs/05` §9.6; `docs/07` §8.5 ⚠ row | Not a deliverable. Backlog |
| Co-citation and bibliographic-coupling generators | `docs/05` §2.2–§2.3 | `P5-T12`'s open line (co-citation); coupling stays a free scoring term in `P5-T24` when references are cached |
| `RECOMMEND_RANK`, model-written rationales, `QUERY_EXPAND` | `docs/12` §16, §2; `docs/07` §12.5 | `P5-T22`'s open line; FR-47 asks for code-derivable reasons |
| Third-party embedding adapter (OpenAI / Gemini / Voyage) | `docs/05` §5.3; `docs/03` §13 | `P5-T20`'s open line |
| Multi-seed "Find papers related to N items" | FR-13 scenario 2 | `P5-T15`'s open line |
| Scheduled recommendations | FR-49 | Out of v1 by `docs/10` §4 item 13 |
| "Clear embeddings" / "Clear profiles" actions | `docs/09` §3.7 | Phase 7's W7-4 owns the clear actions (`plan/05` §4.1) |
| Semantic Scholar attribution line in README and outputs | `docs/09` §5.3, §7 checklist | Release work (Phase 7) |

Every `docs/11` §1 Phase 5 deliverable and definition-of-done line has at least one card (§0 tables).

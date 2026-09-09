# Phase 2 — Six more sources, normalization, deduplication

> **What this file is.** The task-card decomposition of Phase 2 in
> [`docs/11-implementation-roadmap.md`](../docs/11-implementation-roadmap.md) §1.
> Schema, field rules and execution protocol: [`README.md`](README.md) §4–§5.
>
> **Last updated:** 2026-09-09 · **Status:** no code written yet; every task is `TODO`.

---

## Phase goal

Add **Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv and medRxiv** behind the
`LiteratureSource` interface Phase 1 shipped, fan them out in parallel with independent failure
isolation, and **merge their results correctly** — identifier-first, conservative on fuzzy matches,
never silently losing a record.

Phase 1 delivered the PubMed adapter, `LiteratureSource`, the per-host rate-limit governor, the HTTP
layer, the normalizer, the importer and the Search & Import window. Phase 2 does not rebuild any of
them; it adds adapters and the merge layer above them.

## Effort estimate

`docs/11` §1 Phase 2 is now **24.25–33.95 d, published as 24.25–34 d** — a band *derived from* the
task sum in this file (low = the sum, high = the sum × 1.4, rounded to whole days), not an
independent guess. The figure it superseded on 2026-09-09 was **12–16 developer-days** ("six
adapters at ~1.5 days each plus 4–6 days for dedup and its evaluation corpus"). The reconciliation
is at the end of this file.

## Risks retired

| Risk | How Phase 2 retires it |
|---|---|
| **R-2** — literature API terms/endpoints change | Six adapters isolated behind `LiteratureSource`; each registers its own host policy row and its own fixture set, so one source can be disabled without touching the rest (`docs/11` §3). |
| **R-3** — Semantic Scholar rate limits / key delay | *Fallback proven*, not fully retired (`docs/11` §3.1 assigns full retirement to Phase 5). `P2-T05` must demonstrate the plugin is usable with S2 unconfigured. |
| **R-18** — deduplication makes false merges | `P2-T09`/`P2-T10`/`P2-T11` implement identifier-first matching with flag-don't-merge below threshold; `P2-T13` measures it against a labelled corpus at precision ≥ 0.99. |
| part of **R-17** — poor abstract coverage | `P2-T12` ships the batched abstract-backfill pass from `docs/02` §10.4. |

## Requirements implemented

FR-2, FR-4, FR-5, FR-6 (in part — the optional translator import path, `P2-T18`), FR-7,
FR-8 (per-source provenance rows, and the stored record `P2-T17` reads back), FR-9, FR-11,
**FR-12** (`P2-T17`), FR-50, FR-51, FR-53, NFR-1 (in part — `P2-T18` must keep the hand-mapped
path inside the budget and must not measure the opt-in path against it), NFR-2, NFR-3, NFR-6.

## Phase definition of done

Straight from `docs/11` §1 "Phase 2 — Definition of done", plus the four conditions this
decomposition adds — the last two because `docs/11` §1 lists FR-12's re-run control and the
`useTranslators` import path as Phase 2 deliverables but its definition-of-done block predates
both:

- [ ] A single query across all seven sources returns a merged list where a known cross-indexed
      paper appears **exactly once**, with all contributing sources listed.
- [ ] Dedup **precision ≥ 0.99** on the labelled corpus; **recall ≥ 0.90**.
- [ ] One source returning 500 or 429 does not prevent the others from delivering results.
- [ ] **NFR-2 measured:** 4-source search of 100/source completes in ≤ 30 s.
- [ ] Every human gate in this file is either closed or explicitly deferred in writing by the
      product owner (`06-human-gates.md`).
- [ ] The plugin is installable and non-broken with Semantic Scholar unconfigured, and ships **no
      OpenAlex surface at all** — no adapter, no `sources` member, no `SecretId`, no rate-limit row
      (`docs/02` §9.3, `docs/11` §0 principle 5; asserted by `P2-T15`).
- [ ] **FR-12:** a collection filled by an earlier run re-opens the window pre-filled from its
      stored `search_provenance` row, and re-importing an unchanged collection adds 0 items and
      reports "already present: N" (`P2-T17`).
- [ ] **`useTranslators`:** the preference reads `false` on a clean profile; with it off a
      100-record import makes no `Zotero.Translate.Search` call and stays inside NFR-1; with it
      on, a record whose lookup fails is still imported by hand-mapping (`P2-T18`).

## Conventions specific to this file

- **Cross-phase dependencies name real Phase 1 card IDs.** `02-phase-1-pubmed.md` has landed with
  `P1-T01`–`P1-T23`, so every `Depends on` row below resolves there: `P1-T01` (canonical model),
  `P1-T03` (pref schema), `P1-T04` (rate limiter), `P1-T07` (`LiteratureSource` + registry),
  `P1-T08` (query builder), `P1-T13` (existing-item detection), `P1-T14` (importer), `P1-T16`
  (`searchImport` pipeline), `P1-T17` (provenance record), `P1-T19` (menus and the window opener).
  An earlier draft of this file used a placeholder `P1-*` because those IDs were being assigned in
  parallel; no card uses it now, and none should.
- **`docs/07` is the sole authority for types, the preference schema and the rate-limit numbers**
  (`README.md` §5 rules 3–4). `docs/02` §10.1 and §12.1 carry deliberately divergent working-name
  sketches (`CanonicalRecord`, `op`/`text`, `titleAbstract`, `venue`, `all`) that each say "doc 07
  wins". Do not declare a second type system from them.
- **`SourceId` already lists every id this phase needs** — the seven v1 sources plus `openalex`,
  which `docs/07` §5.1 marks **reserved, not shipped** (no adapter, no `sources` membership, no
  policy row; `P2-T15`). Step 3 of the `docs/07` §11.1 add-a-source checklist is therefore already
  satisfied for every source in this phase — do not re-declare, widen or narrow the union.

---

### P2-T01 — Ship the user-query parser and per-source render contract

| Field | Value |
|---|---|
| **ID** | `P2-T01` |
| **State** | `TODO` |
| **Depends on** | `P1-T07`, `P1-T08` |
| **Blocks** | `P2-T03`, `P2-T04`, `P2-T05`, `P2-T06`, `P2-T07`, `P2-T17` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-4`, part of `FR-8` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** One user string parses into a `QueryNode` tree that every adapter can render into its own
native syntax, and the exact transmitted query is recoverable for provenance and the debug log.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.2 — **owns the shipped `QueryNode`, `QueryField`,
  `SourceQuery` and `explainQuery`**; the discriminant is `kind` with lowercase members, the term
  node's text is `value`. This is the only correct spelling.
- `docs/02-literature-database-apis.md` §12.1 — what the AST must be able to *express* (quotes,
  `AND`/`OR`/`NOT`, `-` for NOT, parentheses, `field:` prefixes, bare words default to AND) and the
  unparseable-input fallback rule. Its type block is a superseded sketch; read it for behaviour only.
- `docs/02-literature-database-apis.md` §12.3 — the summary translation table each adapter's
  `query.ts` will be measured against; it tells you which `QueryField` values every source can
  actually honour.
- `docs/10-requirements-and-user-stories.md` FR-4 — the three acceptance scenarios, including
  "the exact URL (with API keys redacted) is written to the provenance record and to the debug log".

**Files.**
- modify `src/sources/shared/queryParse.ts` (created by `P1-T08`; this card generalises it and
  adds `normalizeForSource`)
- modify `test/unit/sources/queryParse.test.ts`
- modify `src/sources/types.ts` (re-export the parser's entry point only; the types themselves are
  already declared per `docs/07` §4.2)

**Do.**
1. Extend the `parseUserQuery(input: string): QueryNode` that `P1-T08` already shipped in
   `src/sources/shared/queryParse.ts`, so it produces `docs/07` §4.2's exact node shapes for the
   full syntax below. **Do not create a second parser module.** `P1-T08` built this file for the
   PubMed-only slice; this card is where it becomes the multi-source contract.
2. Support: double-quoted phrases (`phrase: true`), uppercase `AND`/`OR`/`NOT`, leading `-` as NOT,
   parentheses, and the `field:` prefixes `title:`, `abstract:`, `author:`, `journal:` mapped onto
   `QueryField`. Bare adjacent terms combine with `kind: "and"`.
3. On any parse failure, return a single `{ kind: "term", value: <raw input>, field: "any" }` node.
   Never throw, never surface a syntax error to the user (`docs/02` §12.1).
4. Add a `normalizeForSource(node, capabilities)` helper that reports, per source, which parts of the
   tree that source cannot express — this is what drives the Crossref lossiness notice in `P2-T04`.
5. Unit-test each of the nine `docs/02` §12.3 concept rows (AND, OR, NOT, phrase, title field,
   abstract, author, date range, pagination): the example query
   `("base editing" OR "prime editing") AND title:CRISPR NOT mouse` must produce one stable tree.

**Do NOT.**
- Do **not** declare `QueryNode`, `QueryField` or `SourceQuery` here, and do not copy `docs/02`
  §12.1's `op`/`text`/`titleAbstract`/`venue`/`all` spellings. `docs/02` §12.1's own authority note
  says doc 07 wins; typing from the sketch builds a parallel, wrong type system (`README.md` §5 rule 3).
- Do **not** model the date window inside `QueryNode`. `docs/02` §12.1's `ParsedQuery` wrapper is
  not the shipped request object — `fromDate`/`toDate`/`limit`/`cursor` live on `SourceQuery`
  (`docs/07` §4.2).
- Do **not** expand or rewrite the user's query. Synonym/MeSH expansion is `docs/02` §12.4's
  optional LLM feature with a non-negotiable "never silently expand" rule; it is not in Phase 2.
- Do **not** emit a query for a source whose `capabilities.keywordSearch` is false — bioRxiv has no
  keyword search at all (`docs/02` §8.4).
- Do **not** create a rival parser module. `P1-T08` shipped
  `src/sources/shared/queryParse.ts`, this card depends on `P1-T08`, and a second file under a
  near-identical name (`queryParser.ts`) is the same class of defect the corpus records for
  `searchWindow.*` vs `searchDialog.*` (`plan/02` §4, `C3`): two names for one module, and the
  adapters would import whichever one they met first.

**Done when.**
- [ ] `parseUserQuery` round-trips all nine `docs/02` §12.3 concept rows in unit tests.
- [ ] A deliberately malformed input (`"unclosed AND (`) returns a single `term` node and does not
      throw, asserted in a test.
- [ ] `npm run typecheck` exits 0 with no new type declarations under `src/sources/shared/`.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- queryParse
```

**Notes.** `explainQuery(query): string` is already on the `LiteratureSource` interface
(`docs/07` §4.2) and exists "for UI preview + logs" — every adapter card below implements it, and
FR-4's third scenario is satisfied by writing its output into the provenance record. The parser
lives in a file not present in `docs/07` §2.2's tree, which lists only `dedupe.ts` and `recency.ts`
under `src/sources/shared/`: `P1-T08` created `queryParse.ts` there and this card extends it. One
module, one name — add it to the tree when doc 07 is next revised.

---

### P2-T02 — Parallel fan-out: per-source timeouts, failure isolation

| Field | Value |
|---|---|
| **ID** | `P2-T02` |
| **State** | `TODO` |
| **Depends on** | `P1-T04`, `P1-T07`, `P1-T16` |
| **Blocks** | `P2-T14`, `P2-T16` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-9`, `NFR-2`, `NFR-6`, `NFR-3` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** N selected sources are queried concurrently; a source that times out, 500s or 429s
produces a warning row instead of failing the search, and the job reaches `PartialFetch` rather than
`Failed`.

**Read first.**
- `docs/07-architecture-and-data-model.md` §12.1 — the search→import state machine; **`PartialFetch`
  is a first-class state, not an error**, and `Failed` is reached only when *all* sources fail.
- `docs/07-architecture-and-data-model.md` §7.2 — the `network-metadata` pool is fixed at 4 and is
  **not** user-configurable; `concurrency` sizes the `llm` pool only.
- `docs/07-architecture-and-data-model.md` §7.3 — one `TokenBucket` per **host**, shared by every
  job; `penalize()` parks every waiter on that host on a 429/503 with `Retry-After`.
- `docs/07-architecture-and-data-model.md` §7.4 — cancellation is cooperative and checked inside
  `RateLimiter.acquire`, so a source parked on a token bucket must still cancel; and `HttpClient`
  already sets `noRetryOnThrottle: true` / `errorDelayMax: 0` / `successCodes: false`.
- `docs/07-architecture-and-data-model.md` §10.1 — the typed error hierarchy the fan-out must
  classify into (`RateLimitError`, `UpstreamServerError`, `TimeoutError`, `SourceError`).
- `docs/10-requirements-and-user-stories.md` NFR-2 — "per-source timeouts of 20 s and overall
  cancellation always available"; NFR-6 — the numbers are doc 07's, not this task's.
- `docs/10-requirements-and-user-stories.md` FR-9 — the two acceptance scenarios (one source 500s,
  one source 429s) this task's tests must mirror.

**Files.**
- modify `src/pipeline/searchImport/stages.ts`
- modify `src/pipeline/searchImport/types.ts`
- create `test/unit/pipeline/fanout.test.ts`

**Do.**
1. Implement the `fanOut` stage: for each selected `LiteratureSource`, build its `SourceQuery`
   (`P2-T01`'s tree + the shared recency window from `src/sources/shared/recency.ts`) and run
   `searchAll` under the `network-metadata` pool.
2. Wrap each source in a **20 s per-source timeout** (NFR-2) that produces a `TimeoutError` for that
   source only and leaves the others running.
3. Collect per-source outcomes into a result object carrying, per source: transmitted query
   (`explainQuery`), requested limit, `totalAvailable` as reported by the server, records retrieved,
   and either `ok` or a `SerializedError` (`docs/07` §10.1 `toSerialized()`).
4. Emit `PartialFetch` when ≥ 1 source succeeded and ≥ 1 failed; `Failed` only when all failed.
5. Propagate `ctx.token` into every adapter call so Cancel aborts in-flight requests
   (`docs/07` §7.4, FR-10).
6. Feed `SourcePage.warnings` through to the per-source status rows without failing the job.

**Do NOT.**
- Do **not** use `Promise.all` over the sources. `docs/07` §7.1 names it explicitly: it trips rate
  limits, freezes the UI and loses everything on quit.
- Do **not** create a rate limiter per adapter instance or per job — `docs/07` §7.3: "two concurrent
  jobs would each get a full budget and together exceed the policy".
- Do **not** add a second retry/backoff shape here. `docs/02` §2.4 defers the exact backoff to
  `docs/07` §7.3 (decorrelated jitter + `limiter.penalize()`), and `docs/07` §7.4 already disables
  Zotero's own internal retry loop. A retry below the token bucket is a retry the limiter cannot see.
- Do **not** retry a **400** or a **404** (`docs/02` §2.4). A 400 is a query bug; retrying it burns
  the user's budget and hides the defect.
- Do **not** make a failing source abort the collection creation. `docs/07` §7.4's cancellation
  semantics for `searchImport` are "items already written are KEPT, no rollback".

**Done when.**
- [ ] A test with 4 fake sources — one 500, one 429 with `Retry-After`, two healthy — returns both
      healthy result sets and two warning rows, and the job state is `PartialFetch`.
- [ ] A test where every source fails ends in `Failed`, not `PartialFetch`.
- [ ] A source that never responds is cut at 20 s while the other three complete.
- [ ] Cancelling mid-fan-out settles all in-flight adapter promises within 2 s (FR-10).

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- fanout
```

**Notes.** The NFR-2 wall-clock measurement itself is `P2-T16`; this card only has to make it
*possible* by not serializing the sources. Note that arXiv's `maxConcurrent: 1` and 3-second minimum
spacing (`docs/07` §7.3) means a 100-result arXiv page set alone costs ≥ 3 s per page — arXiv is
the source most likely to dominate the 30 s budget.

---

### P2-T03 — Europe PMC adapter

| Field | Value |
|---|---|
| **ID** | `P2-T03` |
| **State** | `TODO` |
| **Depends on** | `P2-T01` |
| **Blocks** | `P2-T07`, `P2-T08`, `P2-T12` |
| **Retires** | part of `R-2`, part of `R-17` |
| **Implements** | `FR-2`, `FR-4`, `FR-11` |
| **Estimate** | 2.0 d |
| **Human gate** | none |

**Goal.** Europe PMC is a fully working `LiteratureSource` — the project's default general-purpose
source — returning inline abstracts in one round trip, with cursor pagination and preprint coverage.

**Read first.**
- `docs/02-literature-database-apis.md` §4.1 — no key, page size 1–1000, and the **corrected**
  1500-character story: the figure is in the service's own error text but is *not enforced*; the
  real ceiling is URI length (nginx 414).
- `docs/02-literature-database-apis.md` §4.2 — the endpoint table and the `{source}` corpus codes
  (`MED`, `PMC`, `PPR`, …); `searchPOST` is the escape hatch above the URL budget.
- `docs/02-literature-database-apis.md` §4.3 — the field-prefix vocabulary and `FIRST_PDATE` vs
  `PUB_YEAR`. The default run is the **whole-year** form, `PUB_YEAR:[2024 TO 2026]` in 2026, or
  equivalently `FIRST_PDATE:[2024-01-01 TO 2026-12-31]`; `FIRST_PDATE` is for an explicit
  custom range with day precision. §4.3 records that an earlier draft recommended `FIRST_PDATE`
  as *the* mechanism on the grounds that it gives a rolling window — "a rolling window is not
  what the feature is". `docs/02` §2.0 and `docs/08` §4.2 own the window; this card renders it.
- `docs/02-literature-database-apis.md` §12.2, "Europe PMC" block — the rendered query as the
  plugin actually emits it, on the calendar-year window.
- `docs/02-literature-database-apis.md` §4.4 — `resultType` semantics; **only `core` carries
  `abstractText`**, and the real trimmed response shape your mapper must parse.
- `docs/02-literature-database-apis.md` §4.6 — `cursorMark` rules, including the unencoded spaces in
  `nextPageUrl` and the termination condition.
- `docs/02-literature-database-apis.md` §4.9 — errors arrive **inside HTTP 200** under `errCode`.
- `docs/02-literature-database-apis.md` §10.2 — the Europe PMC column of the response→canonical
  mapping table, field by field.
- `docs/07-architecture-and-data-model.md` §4.2 — the `LiteratureSource` and `SourceCapabilities`
  contract to declare honestly.
- `docs/07-architecture-and-data-model.md` §5.1 — `CanonicalWork`, `Author`, `PartialDate`,
  `ExternalIds`, `SourceRecord` — what the mapper must emit.
- `docs/07-architecture-and-data-model.md` §7.3 — the `www.ebi.ac.uk` row: **5/s, burst 5, 3
  concurrent**. Copy it; do not raise it.
- `docs/07-architecture-and-data-model.md` §11.1 — the twelve-step add-a-source checklist this card
  executes.
- `docs/13-testing-build-and-release.md` §3.1 — the thirteen fixtures required per literature source.

**Files.**
- create `src/sources/europepmc/europepmcSource.ts`
- create `src/sources/europepmc/mapper.ts`
- create `src/sources/europepmc/query.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `src/bootstrap/registerSources.ts`
- modify `src/model/merge.ts`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/sources/europepmc.test.ts`
- create `test/fixtures/europepmc/` (the `docs/13` §3.1 set)

**Do.**
1. Implement `query.ts`: render `QueryNode` into Europe PMC syntax per `docs/02` §4.3/§12.2, append
   `AND (FIRST_PDATE:[<from> TO <to>])` when a window is set, and implement `explainQuery`.
2. Switch to `POST /searchPOST` with an `application/x-www-form-urlencoded` body when the rendered
   query exceeds the 1500-character **design budget** (`docs/02` §12.2).
3. Implement `search()` against `GET /search` with `resultType=core&format=json`, `pageSize` from
   `SourceQuery.limit` clamped to 1–1000, `cursorMark=*` on the first page.
4. Implement pagination: read `nextCursorMark`, stop when it equals the cursor you sent or
   `resultList.result` is empty.
5. Implement `mapper.ts` per the `docs/02` §10.2 Europe PMC column onto `CanonicalWork`, including
   `abstractText`, `authorList.author[]` (`lastName`/`firstName`/affiliations),
   `journalInfo.journal` (title, `medlineAbbreviation`, `issn`/`essn`), `firstPublicationDate`,
   `pubTypeList`, `keywordList`, `meshHeadingList`, `fullTextUrlList`, and
   `{ id, source }` into the Europe PMC identifier slot.
6. Declare `capabilities`: `keywordSearch: true`, `abstractsInSearch: true`, `dateFilter: true`,
   `citationGraph: true`, `benefitsFromApiKey: false`, `maxPageSize: 1000`.
7. Add the `www.ebi.ac.uk` policy row to `hostLimiter.ts` copied verbatim from `docs/07` §7.3.
8. Send the maintainer `User-Agent` on every request and `email=` **maintainer** (`docs/02` §2.2
   final assignment table — Europe PMC has no per-user benefit).
9. Record and commit the `docs/13` §3.1 fixture set; write the mapper tests `docs/07` §11.1 step 6
   requires (journal article, preprint, no abstract, partial date, 50+ authors, CJK title).
10. Add the merge-precedence entry for `europepmc` in `src/model/merge.ts` and extend the precedence
    test.

**Do NOT.**
- Do **not** read `resultList` before checking for an `errCode` key. `docs/02` §4.9: Europe PMC
  returns application errors inside **HTTP 200** bodies. A 200 is not a success.
- Do **not** assume every Europe PMC response body is JSON. `docs/02` §4.7 observed `/references`
  answering **HTTP 503 with `Content-Type: text/plain`** and a plain-English body; check the content
  type or attempt the parse defensively.
- Do **not** let a `/references` failure disable the `/citations` path — `docs/02` §4.7: individual
  Europe PMC endpoints go down independently. (Neither endpoint is used for search in Phase 2, but
  the adapter's error handling must not couple them.)
- Do **not** call `fullTextXML` from this card's search path. `docs/02` §4.8: it answers **404 with
  an empty body** both for "indexed but not open access here" and for "no such ID", so a 404 tells
  you nothing about whether the ID is valid and must not be treated as an ID error. Gate any future
  call on `inEPMC:"Y"` / `isOpenAccess:"Y"`.
- Do **not** use `resultType=lite`. It is the API default and it has **no abstract**
  (`docs/02` §4.4) — the whole reason Europe PMC is a one-round-trip source is `core`.
- Do **not** mix `cursorMark` with `page=` (`docs/02` §4.6), and do **not** use `nextPageUrl`
  without URL-decoding it first — Europe PMC returns it with unencoded spaces.
- Do **not** code an assertion that a query over 1500 characters will be rejected. `docs/02` §4.1
  probed 1500/2000/3000/5000-character queries and all returned HTTP 200.
- Do **not** raise the 5/s budget. `docs/07` §7.3 and `docs/09` §5.5 both mark the underlying 10/s
  figure **Unverified** — it comes from a mailing-list thread, not an SLA — and require contacting
  the Europe PMC team before raising it.
- Do **not** attempt programmatic full-text retrieval outside the OA subset: `docs/09` §5.5 quotes
  the explicit prohibition on bulk downloading non-OA content.

**Done when.**
- [ ] `search()` against the `search-typical` fixture yields ≥ 20 `SourceRecord`s, every one with a
      non-empty `abstract` where `abstractText` was present.
- [ ] A fixture whose body is `{"errCode":404,"errMsg":"..."}` under HTTP 200 produces a typed
      `SourceError`, not a parsed empty result set.
- [ ] The `paginated` fixture drives the cursor loop to termination without an infinite loop, and
      the loop stops when `nextCursorMark` repeats.
- [ ] The `record-unicode` fixture maps to a `CanonicalWork` with the CJK title intact.
- [ ] `hostLimiter.ts` contains a `www.ebi.ac.uk` row whose values match `docs/07` §7.3 exactly,
      asserted by a test.
- [ ] All thirteen `docs/13` §3.1 fixtures exist under `test/fixtures/europepmc/` with sidecar
      `_meta.json` files.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- europepmc && npm run test:unit -- hostLimiter
```

**Notes.** `docs/02` §4.1 calls Europe PMC "the single best general-purpose source for this project"
and says to make it the default; every downstream card (preprint search `P2-T07`, abstract backfill
`P2-T12`, and `P2-T15`'s OpenAlex decision record, whose second reason for leaving OpenAlex out is
"Search → Europe PMC + Crossref") assumes it works. Build it first among the adapters.
`docs/02` §2.4 marks `email=` as accepted-but-not-enforced here — send it anyway per `docs/02` §2.2.

---

### P2-T04 — Crossref adapter

| Field | Value |
|---|---|
| **ID** | `P2-T04` |
| **State** | `TODO` |
| **Depends on** | `P2-T01` |
| **Blocks** | `P2-T11`, `P2-T12` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-2`, `FR-4`, `FR-11` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** Crossref is a working `LiteratureSource` giving cross-disciplinary DOI and venue authority,
in the polite pool, with its Boolean lossiness handled explicitly rather than silently.

**Read first.**
- `docs/02-literature-database-apis.md` §5.1 — the pools table and the **corrected, verified**
  finding that a contact address in **either** `mailto` **or** the `User-Agent` promotes the request;
  plus the instruction to reconfigure the governor from `x-rate-limit-*` on every response.
- `docs/02-literature-database-apis.md` §5.2 — the parameter and filter tables:
  `query.bibliographic` is the one for keyword search, `select` is mandatory, `rows` max 1000,
  `offset` capped at 10,000, `cursor` for deep paging.
- `docs/02-literature-database-apis.md` §5.3 — the real response shape: `title` and
  `container-title` are **arrays**, `issued.date-parts` is an array-of-arrays with 1, 2 or 3 inner
  elements.
- `docs/02-literature-database-apis.md` §5.4 — abstracts are raw **JATS XML**, deposited by only
  some publishers, and must be parsed with `DOMParser` in XML mode.
- `docs/02-literature-database-apis.md` §12.2 "Crossref" — the degradation rule: flatten OR-groups
  into the bag of words, promote `title:` into `query.title`, **drop NOT clauses and filter
  client-side**, and tell the user the results are approximate.
- `docs/02-literature-database-apis.md` §10.2 — the Crossref column of the mapping table.
- `docs/07-architecture-and-data-model.md` §7.3 — the `api.crossref.org` row: **start at 2/interval,
  burst 2, 3 concurrent, header-driven**, and the note that *list* endpoints are 1/s public and 3/s
  polite since 2025-12-01.
- `docs/00-overview.md` §3 D10 — the `mailto` parameter carries the **user's** address from
  `contactEmail` when set, maintainer otherwise; the `User-Agent` always carries the maintainer's.
- `docs/07-architecture-and-data-model.md` §11.1 — the add-a-source checklist.

**Files.**
- create `src/sources/crossref/crossrefSource.ts`
- create `src/sources/crossref/mapper.ts`
- create `src/sources/crossref/query.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `src/core/http/userAgent.ts`
- modify `src/bootstrap/registerSources.ts`
- modify `src/model/merge.ts`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/sources/crossref.test.ts`
- create `test/fixtures/crossref/` (the `docs/13` §3.1 set)

**Do.**
1. Implement `query.ts` per `docs/02` §12.2: bag-of-words into `query.bibliographic`, `title:` terms
   into `query.title`, `author:` into `query.author`, date window into
   `filter=from-pub-date:…,until-pub-date:…`, and return the dropped NOT terms as a client-side
   filter list plus a warning string for `SourcePage.warnings`.
2. Always send `select=` with an explicit field whitelist (`docs/02` §5.2) — at minimum the fields
   the `docs/02` §10.2 mapping consumes.
3. Add `from-created-date` as a secondary filter alongside `from-pub-date` (`docs/02` §5.2 caveat:
   publisher-supplied `issued` cover dates can lead reality by months or years).
4. Paginate with `cursor=*` → `message.next-cursor`, stopping when `message.items` is empty.
5. Implement `mapper.ts`, unwrapping the arrays: `title[0]`, `container-title[0]`,
   `short-container-title[0]`, `ISSN[]`, and `issued.date-parts[0]` handled for lengths 1, 2 and 3
   into `PartialDate`.
6. Implement JATS→text for `abstract` with `DOMParser` XML mode: strip the `jats:` namespace, unwrap
   `<jats:p>` into paragraph breaks, drop `<jats:boxed-text>`/`<jats:title>` decoration, decode
   entities.
7. Read `x-rate-limit-limit`, `x-rate-limit-interval` and `x-concurrency-limit` off every response
   and call `limiter.reconfigure()` (`docs/07` §7.3).
8. Send both polite-pool signals: the `mailto` query parameter (user's `contactEmail` if set, else
   maintainer) and the maintainer `User-Agent`.
9. Declare `capabilities` with `abstractsInSearch: true` but note in the display string that coverage
   is partial; `dateFilter: true`; `maxPageSize: 1000`; `maxTotalResults` unbounded via cursor.
10. Record fixtures, write mapper tests, add the `crossref` merge-precedence entry.

**Do NOT.**
- Do **not** send Boolean operators in `query.*`. `docs/02` §12.2: "Crossref has **no** Boolean
  operator support in `query.*`. Terms are scored, not filtered." Sending `AND`/`OR`/`NOT` makes them
  scored search terms.
- Do **not** silently drop the user's NOT clauses. `docs/02` §12.2 requires filtering results
  client-side against the NOT terms **and** documenting the lossiness in the UI, because Crossref is
  the only source where the user's Boolean intent is not honoured.
- Do **not** treat the polite pool as requiring `mailto` **and** `User-Agent` together. `docs/02`
  §5.1 verified each mechanism alone promotes the request — a user who leaves `contactEmail` empty
  still gets the polite pool. Send both; do not gate one on the other.
- Do **not** put the user's address in the `User-Agent`, and do **not** put the maintainer address
  in `mailto` when the user has set `contactEmail` (`docs/00` §3 D10, `docs/02` §2.2).
- Do **not** treat `title` or `container-title` as strings, or `issued.date-parts` as a flat array.
  `docs/02` §5.3 shows both shapes; the inner date array may have 1, 2 or 3 elements.
- Do **not** regex-strip the JATS abstract. `docs/02` §5.4: "regex stripping will mangle nested
  markup like the example above."
- Do **not** omit `select`. `docs/02` §5.2: "use it, responses are otherwise enormous" — and
  `docs/02` §5.6 lists 504 timeouts on heavy queries whose fix is to reduce `rows` and add `select`.
- Do **not** use `offset` past 10,000 (`docs/02` §5.5); use the cursor.
- Do **not** hardcode 3 req/s. `docs/07` §7.3 starts at **2/interval** and the interval is not fixed
  at one second — it comes back in `x-rate-limit-interval`.
- Do **not** assume Crossref abstract coverage generalises. `docs/02` §5.4's 51 % is marked
  **Unverified** for the corpus as a whole; it was measured within one recent biomedical query.

**Done when.**
- [ ] A request built from the `docs/02` §12.2 example query contains no `AND`/`OR`/`NOT` token in
      any `query.*` parameter, asserted by a test.
- [ ] The `record-jats-abstract` fixture maps to plain-text `abstract` with paragraph breaks and no
      residual `<jats:` markup.
- [ ] A fixture whose `issued.date-parts` is `[[2026]]`, one that is `[[2026,9]]`, and one that is
      `[[2026,9,3]]` all map to a valid `PartialDate` with the right precision.
- [ ] A response carrying `x-rate-limit-limit: 3` / `x-rate-limit-interval: 1s` triggers
      `limiter.reconfigure()`, asserted with a fake limiter.
- [ ] A NOT term present in the user query removes the matching record from the returned page and
      adds a warning to `SourcePage.warnings`.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- crossref
```

**Notes.** `docs/02` §5.4's architectural consequence is load-bearing for `P2-T12`: "Crossref alone
is not sufficient for features 1 and 3, which need abstracts" — Crossref supplies DOI and venue
authority, and abstracts are backfilled from Europe PMC or Semantic Scholar. Crossref Plus
(`Crossref-Plus-API-Token`) is out of scope: `docs/02` §2.3 notes it would need a new `SecretId`
added to `docs/09` §1.7 first.

---

### P2-T05 — Semantic Scholar adapter with unauthenticated degradation

| Field | Value |
|---|---|
| **ID** | `P2-T05` |
| **State** | `TODO` |
| **Depends on** | `P2-T01` |
| **Blocks** | `P2-T11`, `P2-T12` |
| **Retires** | `R-3` (fallback proven — full retirement is Phase 5 per `docs/11` §3.1) |
| **Implements** | `FR-2`, `FR-4`, `FR-11`, open question 8 in `docs/10` §5 |
| **Estimate** | 2.0 d |
| **Human gate** | **Yes** — a human must paste the approved Semantic Scholar API key into the prefs pane before the keyed path can be exercised end to end. The key application is submitted in Phase 0 (`docs/11` §4.2 V-14) and issuance can take weeks (`R-3`). |

**Goal.** Semantic Scholar works as an *enhancer*: with a key it contributes abstracts, `tldr` and
the best cross-ID resolution of any source; without one the plugin still works and says why results
are thin.

**Read first.**
- `docs/02-literature-database-apis.md` §6.4 — **read this before designing anything.** The
  unauthenticated pool is 1000 req/s shared across every anonymous user on the internet and returned
  HTTP 429 on the first attempt in live probing; a key gives a guaranteed but lower **1 req/s**. This
  section also lists the four design decisions it forces.
- `docs/02-literature-database-apis.md` §6.2 — the endpoint table, including `/paper/search/match`
  and `/paper/batch`.
- `docs/02-literature-database-apis.md` §6.5 — `/paper/search` takes **plain text only, no query
  syntax**, and hyphenated terms yield no matches.
- `docs/02-literature-database-apis.md` §6.6 — `/paper/search/bulk` is the endpoint with real
  operators (`+`, `|`, `-`, `"…"`, `*`, `( )`, `~N`) and token pagination.
- `docs/02-literature-database-apis.md` §6.8 — `/paper/batch`: up to 500 IDs, **unknown IDs return
  `null` entries positionally aligned with `ids`**, 10 MB response cap.
- `docs/02-literature-database-apis.md` §6.3 — the accepted `{paper_id}` prefixes; this is "the best
  cross-ID resolver of any source in this document".
- `docs/02-literature-database-apis.md` §6.7 — the real `/paper/{id}` response and the warning that
  **author names are abbreviated**, so S2 must lose the author precedence contest.
- `docs/02-literature-database-apis.md` §12.2 "Semantic Scholar" — the two renderings, and the
  hyphen/NOT collision: replace `-` inside a term with a space **before** using `-` as the NOT
  operator.
- `docs/05-related-work-discovery.md` §2.2 — `citingPaper.references.*` on `/paper/{id}/citations`
  is **accepted with HTTP 200 and silently ignored** (no `references` key at all); the working shape
  is a separate `/paper/batch` POST.
- `docs/07-architecture-and-data-model.md` §7.3 — the `api.semanticscholar.org` row: **0.9/s in both
  modes, burst 1, max concurrent 1**.
- `docs/09-security-privacy-and-api-keys.md` §1.7 — `SecretId` `"source.semanticscholar"`, the
  `Zotero.OSKeyStore` → `Services.logins` path, and the origin/realm constants.
- `docs/07-architecture-and-data-model.md` §8.5 "Non-secret key-presence flags" — the only pref this
  source may write is `semanticscholar.keyPresent`.
- `docs/08-ui-ux-spec.md` §7.3 (Semantic Scholar groupbox) — the key field, the Test button, the
  backend badge and the deep link to the key-request form; **no `preference` binding on the input**.
- `docs/10-requirements-and-user-stories.md` FR-2 third scenario — the inline notice in the search
  dialog when S2 is enabled but unconfigured.
- `docs/09-security-privacy-and-api-keys.md` §5.3 — the ToS: stay under 1/s in either mode, attribute
  Semantic Scholar, do not use the API as a bulk channel.

**Files.**
- create `src/sources/semanticscholar/semanticscholarSource.ts`
- create `src/sources/semanticscholar/mapper.ts`
- create `src/sources/semanticscholar/query.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `src/bootstrap/registerSources.ts`
- modify `src/model/merge.ts`
- modify `src/prefs/schema.ts` (the `semanticscholar.keyPresent` row only)
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/sources/semanticscholar.test.ts`
- create `test/fixtures/semanticscholar/` (the `docs/13` §3.1 set, plus an unauthenticated-429 scenario)

**Do.**
1. Implement `query.ts` with **two** renderings (`docs/02` §12.2): the bulk-endpoint form with
   `+`/`|`/`-`/quotes/parentheses, and the plain-text form for `/paper/search`. Normalise hyphens
   inside terms to spaces **first**, then apply `-` as NOT.
2. Use `/paper/search/bulk` as the default search path (`docs/02` §6.6: "use bulk for feature 1 and
   feature 6 candidate generation"); fall back to `/paper/search` only when relevance ranking is
   explicitly requested.
3. Read the key through the `SecretStore` (`SecretId` `"source.semanticscholar"`) and send it as the
   `x-api-key` header. Implement `isConfigured()` from key presence and `healthCheck()` from the
   cheapest authenticated call available.
4. Implement graceful degradation: when no key is present, still attempt the call, and on 429
   surface a typed `RateLimitError` with the localized "add a key to improve results" message rather
   than failing the whole search. The plugin must remain usable with S2 unconfigured.
5. Implement `lookup()` over `/paper/batch` with **index-matched** results and a batch size of ~100
   when `abstract` is requested (`docs/02` §6.8's 10 MB cap).
6. Implement `mapper.ts` per `docs/02` §10.2's S2 column, including `externalIds` →
   `ExternalIds` (note `PubMedCentral` arrives **bare**, without the `PMC` prefix), `tldr.text`, and
   `openAccessPdf.disclaimer` → the OA rights notice.
7. Declare `capabilities` with `benefitsFromApiKey: true`, `lookupById` covering DOI/PMID/PMCID/arXiv,
   `abstractsInSearch: true`, `citationGraph: true`, `maxPageSize: 100` for `/paper/search`.
8. Add the `api.semanticscholar.org` policy row verbatim from `docs/07` §7.3.
9. Record fixtures including a real unauthenticated 429 body, and test the degraded path.

**Do NOT.**
- Do **not** write the API key to a preference. Decision **D5** (`docs/00` §3), `docs/09` §1.7:
  there is no plaintext-prefs tier and `src/prefs/schema.ts` has a unit test asserting no
  `secret: true` entry has a `Zotero.Prefs` writer. Only `semanticscholar.keyPresent` is a pref.
- Do **not** send query operators to `/paper/search`. `docs/02` §6.5: "plain text only — no query
  syntax. Hyphenated terms yield no matches."
- Do **not** apply `-` as NOT before normalising hyphens inside terms. `docs/02` §12.2 warns the two
  collide.
- Do **not** assume `/paper/batch` returns a 1:1 non-null mapping. `docs/02` §6.8: "unknown IDs come
  back as `null` entries, so index-match".
- Do **not** request `abstract` on 500-ID batches. `docs/02` §6.8: the whole response must stay under
  10 MB or you get a 400; keep batches to ~100 with abstracts.
- Do **not** build anything on `citingPaper.references.*`. `docs/05` §2.2 tested it on 2026-09-09:
  it returns **HTTP 200 with no `references` key at all** — the selector is ignored, not rejected.
  Co-citation built on it returns zeroes that look like real data. The working shape is one
  `citations` call for IDs then one `/paper/batch` POST with `references.externalIds`.
- Do **not** let S2 win the author-name precedence contest. `docs/02` §6.7 and §10.4: S2 returns
  `"C. Theodoris"` where PubMed returns the full given name.
- Do **not** request `embedding` when you mean SPECTER2 — `docs/02` §6.9: bare `embedding` yields
  SPECTER **v1**; the field is `embedding.specter_v2`. (Embeddings are Phase 5; do not fetch them
  here at all — they are ~16 KB per paper.)
- Do **not** exceed 0.9 req/s or 1 concurrent connection in either mode. `docs/07` §7.3 explains the
  counter-intuitive reason: there is no mode in which going faster is safe.
- Do **not** make any Phase 2 feature a hard dependency on S2. `docs/10` §5 open question 8's
  recommended default is "no — degrade gracefully", and `docs/11` R-3's mitigation is "treat
  Semantic Scholar as an enhancer, never a hard dependency".
- Do **not** use the API as a bulk channel (`docs/09` §5.3): S2's own guidance directs high-rate
  users to the downloadable datasets.

**Done when.**
- [ ] With no key configured, a search with S2 enabled completes, S2's row shows a rate-limit
      warning, and the other sources' results are unaffected (tested against the recorded 429).
- [ ] With a key configured, `x-api-key` is present on every request and no request is issued faster
      than the `api.semanticscholar.org` bucket allows, asserted against a fake clock.
- [ ] A `/paper/batch` fixture containing a `null` at index 2 maps to a result set that skips index 2
      without shifting the remaining records.
- [ ] The bulk query renderer emits `("base editing" | "prime editing") + CRISPR - mouse` for the
      `docs/02` §12.2 example, asserted exactly.
- [ ] A grep of `src/` finds no `Zotero.Prefs` write whose value could be the S2 key.
- [ ] `semanticscholar.keyPresent` is the only new pref row, and its default is `false` — the
      `docs/07` §8.5 row and `P1-T03`'s "no `secret: true` entry has a `Zotero.Prefs` writer"
      assertion both still pass (`npm run test:unit -- prefs`).

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- semanticscholar && npm run test:unit -- prefs
```

**Notes — human gate.** If the key has not arrived when this card is picked up, implement and ship
the adapter in unauthenticated-degraded mode, mark the card `DONE` for the degraded path, and open a
follow-up card for the keyed acceptance criteria. Do **not** block Phase 2 on the key — that is
precisely the R-3 outcome the design is built to survive. Record the state in `06-human-gates.md`.

---

### P2-T06 — arXiv adapter

| Field | Value |
|---|---|
| **ID** | `P2-T06` |
| **State** | `TODO` |
| **Depends on** | `P2-T01` |
| **Blocks** | `P2-T08`, `P2-T11` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-2`, `FR-4`, `FR-11` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** arXiv is a working `LiteratureSource` for physics/CS/math/q-bio coverage, honouring its
hard one-request-per-three-seconds Terms of Use obligation.

**Read first.**
- `docs/02-literature-database-apis.md` §7.1 — the rate limit is **1 request / 3 s, single
  connection**, a hard ToU obligation; Atom XML only; **no CORS headers**; use `https://` directly
  because plain `http://` answers 301 with an empty body.
- `docs/02-literature-database-apis.md` §7.2 — the parameter table and the field prefixes (`ti:`,
  `au:`, `abs:`, `cat:`, `all:`, …) plus `ANDNOT`.
- `docs/02-literature-database-apis.md` §7.3 — the `submittedDate:[YYYYMMDDTTTT TO YYYYMMDDTTTT]`
  range format, its URL encoding, the cosmetic bracket→quote echo, and the fact that `submittedDate`
  filters on **v1 submission**.
- `docs/02-literature-database-apis.md` §7.5 — the seven parsing notes; every one of them is a bug
  you will otherwise ship.
- `docs/02-literature-database-apis.md` §12.2 "arXiv" — the rendering, including `NOT` → `ANDNOT`
  and the percent-encoding table.
- `docs/02-literature-database-apis.md` §10.2 — the arXiv column of the mapping table.
- `docs/07-architecture-and-data-model.md` §7.3 — the `export.arxiv.org` row: **0.33/s, burst 1,
  maxConcurrent 1**, enforced with `minIntervalMs: 3000`.
- `docs/09-security-privacy-and-api-keys.md` §5.4 — the ToU wording, the "all of the machines under
  your control as a whole" aggregation clause, and the note that arXiv imposes **no**
  contact-identification requirement (so do not document the UA as compliance).
- `docs/02-literature-database-apis.md` §7.6 — metadata is CC0; e-prints are not, and must not be
  re-hosted.

**Files.**
- create `src/sources/arxiv/arxivSource.ts`
- create `src/sources/arxiv/mapper.ts`
- create `src/sources/arxiv/query.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `src/bootstrap/registerSources.ts`
- modify `src/model/merge.ts`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/sources/arxiv.test.ts`
- create `test/fixtures/arxiv/` (the `docs/13` §3.1 set, plus an arXiv error-feed scenario)

**Do.**
1. Implement `query.ts`: render `QueryNode` into `search_query` with `ti:`/`au:`/`abs:`/`all:`
   prefixes, `AND`/`OR`/`ANDNOT`, and the `submittedDate` range in `YYYYMMDDTTTT` GMT form,
   percent-encoding `(`→`%28`, `)`→`%29`, `"`→`%22`, `[`→`%5B`, `]`→`%5D`, spaces→`+`.
2. Parse the Atom feed with `DOMParser` using the **namespaced** accessors for the Atom, arXiv and
   OpenSearch namespaces (`docs/02` §7.5).
3. Detect the error feed: HTTP status stays 200 and the single entry's `<id>` is
   `http://arxiv.org/api/errors` — map it to a typed `SourceError`.
4. Normalise `<summary>` and `<title>` whitespace (`text.replace(/\s+/g, ' ').trim()`) — both are
   hard-wrapped.
5. Extract the arXiv ID from `<id>`: strip the version for cross-source matching, keep the version
   for the Zotero `archiveID` value.
6. Construct the DataCite DOI `10.48550/arXiv.<id>` (it is not in the feed). If `<arxiv:doi>` is
   present, record it as the **journal** DOI and set the preprint→published signal for `P2-T11`.
7. Map `category[@term]` into `subjects` with scheme `arxiv-category`, and always emit
   `type: "preprint"` with the repository name `arXiv`.
8. Add the `export.arxiv.org` policy row verbatim from `docs/07` §7.3.
9. Declare `capabilities`: `maxPageSize: 2000`, `maxTotalResults: 30000`, `dateFilter: true`,
   `abstractsInSearch: true`, `citationGraph: false`, `benefitsFromApiKey: false`.

**Do NOT.**
- Do **not** use `getElementsByTagName`. `docs/02` §7.5 note 1: "Namespaces are mandatory.
  `getElementsByTagName('entry')` fails; use the NS variants."
- Do **not** treat `<arxiv:doi>` as the arXiv DOI. `docs/02` §7.5 note 5: when present it is the
  **journal** DOI, which means the preprint has been published — a direct preprint↔published link.
  The arXiv DOI must be constructed as `10.48550/arXiv.<id>`.
- Do **not** treat a non-200 status as the only error path. `docs/02` §7.5 note 6: arXiv error
  responses are **Atom feeds with HTTP 200**.
- Do **not** treat `<opensearch:totalResults>` of `0` with no entries as a failure — `docs/02` §7.5
  note 7 says that is a normal empty result.
- Do **not** send quotes around the `submittedDate` range yourself. `docs/02` §7.3: arXiv echoes the
  brackets back as double quotes in the feed `<title>`; that is cosmetic and the filter applies.
- Do **not** issue arXiv calls inside a per-item loop, and do **not** raise `maxConcurrent` above 1.
  `docs/02` §7.1 and `docs/09` §5.4: the limit is aggregated "across all of the machines under your
  control as a whole" — this is an anti-circumvention clause, not advice.
- Do **not** rely on redirect following from `http://export.arxiv.org` — `docs/02` §7.1: it answers
  301 with an **empty body**, so a client that does not follow redirects sees nothing at all.
- Do **not** move arXiv calls into an unprivileged context. `docs/02` §2.1: arXiv is the only source
  that sends no `Access-Control-Allow-Origin` header.
- Do **not** document the `User-Agent` as an arXiv compliance obligation (`docs/07` §7.3 note,
  `docs/09` §5.4) — send it as good citizenship only, and never a user address.
- Do **not** download or store e-print PDFs on the plugin's own initiative (`docs/02` §7.6).

**Done when.**
- [ ] The `docs/02` §12.2 example query renders to a `search_query` containing `ANDNOT`, not `NOT`,
      asserted exactly.
- [ ] The error-feed fixture produces a typed `SourceError`, not an empty result set.
- [ ] A `<summary>` fixture with hard-wrapped lines maps to a single-spaced abstract.
- [ ] `2609.04658v1` maps to `ExternalIds.arxivId === "2609.04658"` and to an `archiveID` value of
      `arXiv:2609.04658v1`.
- [ ] A fixture entry carrying `<arxiv:doi>` produces a published-version signal, and its
      `ExternalIds.doi` is not silently set to the journal DOI as if it were the preprint's.
- [ ] Two consecutive `search()` calls against a fake clock are spaced ≥ 3000 ms apart.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- arxiv
```

**Notes.** `docs/02` §12.2 suggests skipping arXiv entirely when the query has no obvious
physics/CS relevance rather than spending a 3-second slot on it. That is a planner optimisation, not
part of this card — but it is the natural mitigation if `P2-T16`'s NFR-2 measurement comes in over
30 s. `docs/02` §7.3 also notes `submittedDate` excludes a 2022 paper revised in 2025; exposing
`lastUpdatedDate` as an option is a post-v1 nicety, not Phase 2 scope.

---

### P2-T07 — bioRxiv / medRxiv adapter (ID lookup and cross-walk only)

| Field | Value |
|---|---|
| **ID** | `P2-T07` |
| **State** | `TODO` |
| **Depends on** | `P2-T01`, `P2-T03` |
| **Blocks** | `P2-T08`, `P2-T11` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-2`, `FR-4`, `FR-11` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** bioRxiv and medRxiv are two registered `SourceId`s served by one adapter, correctly scoped
to identifier lookup and preprint↔published resolution — with keyword search for preprints routed
through Europe PMC instead.

**Read first.**
- `docs/02-literature-database-apis.md` §8.4 — **the fatal limitation**: there is no keyword search,
  a 3-year client-side sweep would be ~2,000 requests / 35 minutes, and the routing table that says
  keyword search of preprints goes to Europe PMC `SRC:PPR`.
- `docs/02-literature-database-apis.md` §8.2 — the endpoint templates and page sizes (`/details/`
  **30**, `/pubs/` 100) and the `{server}` / `{interval}` grammar.
- `docs/02-literature-database-apis.md` §8.3 — the real `/details/` and `/pubs/` bodies, including
  `server`, `published`, `preprint_doi`/`published_doi` and the per-record `license`.
- `docs/02-literature-database-apis.md` §8.5 — errors arrive **inside HTTP 200** under
  `messages[0].status`; per-record `license` goes to the Zotero `rights` field.
- `docs/02-literature-database-apis.md` §11.2 — the `10.64898/` prefix change, verified: **medRxiv
  uses it too, so the prefix does not distinguish the two servers**; use the publisher/server field.
- `docs/02-literature-database-apis.md` §4.5 — the Europe PMC `SRC:PPR` route and
  `bookOrReportDetails.publisher` carrying the server name.
- `docs/07-architecture-and-data-model.md` §7.3 — the `api.biorxiv.org` row: **1/s, burst 2, 2
  concurrent**, self-imposed because no limit is published.
- `docs/07-architecture-and-data-model.md` §2.2 — "`biorxiv/` — bioRxiv + medRxiv share one adapter,
  two servers".
- `docs/07-architecture-and-data-model.md` §4.2 — `SourceCapabilities` must be declared **honestly**;
  the planner uses them, and faking `keywordSearch` here would route real user queries into a
  35-minute sweep.
- `docs/09-security-privacy-and-api-keys.md` §5.6 — no key, no published rate limit, no API ToU; the
  per-preprint author-selected license must be read per record, never assumed.

**Files.**
- create `src/sources/biorxiv/biorxivSource.ts`
- create `src/sources/biorxiv/mapper.ts`
- create `src/sources/biorxiv/query.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `src/bootstrap/registerSources.ts`
- modify `src/model/merge.ts`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/sources/biorxiv.test.ts`
- create `test/fixtures/biorxiv/` and `test/fixtures/medrxiv/` (the `docs/13` §3.1 set for each)

**Do.**
1. Register **two** `LiteratureSource` instances — `id: "biorxiv"` and `id: "medrxiv"` — from one
   implementation parameterised by `{server}`, both sharing the `api.biorxiv.org` limiter.
2. Declare `capabilities.keywordSearch: false` on both, with `lookupById` covering `doi` only.
3. Implement `search()` as a **delegation**: when the planner asks these sources for keyword results,
   return an empty page with a warning explaining that preprint keyword search runs through Europe
   PMC `SRC:PPR`, and have the search planner add the `SRC:PPR` clause to the Europe PMC query when
   either preprint source is enabled and Europe PMC is enabled. The empty page is a **role**, not a
   failure and not a zero-result search: `docs/02` §8.4 and `docs/08` §4.2 (decided 2026-09-09)
   require the UI to render `⊕ ID lookup · preprint matching` for it, so emit an outcome `P2-T14`
   can tell apart from both `✓ 0 results` and `⚠ error` — the source's own
   `capabilities.keywordSearch: false` is that signal.
4. Implement `lookup()` over `/details/{server}/{DOI}/na/json` and the preprint→published cross-walk
   over `/pubs/{server}/{DOI}/na/json`, producing the `relatedVersionIds` signal `P2-T11` consumes.
5. Implement `mapper.ts`: split `authors` from the `"Last, F.; Last, F."` string form, map
   `abstract` (from `/details/`) or `preprint_abstract` (from `/pubs/`), `category` → `subjects`,
   `license` → the OA license field, `server` → the repository name, `date` → `PartialDate`, and
   always `type: "preprint"`.
6. Determine the server from the record's `server` / publisher field and set the correct `SourceId`
   on the emitted `SourceRecord`.
7. Add the `api.biorxiv.org` policy row verbatim from `docs/07` §7.3.
8. Record fixtures for both servers, including a `10.64898/` record and a legacy `10.1101/` record.

**Do NOT.**
- Do **not** implement keyword search here, and do **not** "approximate" it by sweeping `/details/`
  over a date interval and filtering client-side. `docs/02` §8.4: ~2,000 requests and ~35 minutes for
  a 3-year window — "that is not a viable interactive feature."
- Do **not** detect bioRxiv or medRxiv with `doi.startsWith('10.1101/')`. `docs/02` §11.2: preprints
  are now minted under **`10.64898/`**, both prefixes are live simultaneously, and any code testing
  the legacy prefix "is now wrong."
- Do **not** use the DOI prefix to tell bioRxiv from medRxiv. `docs/02` §11.2, verified 2026-09-09:
  **medRxiv uses `10.64898/` too** — "the prefix therefore does not distinguish bioRxiv from
  medRxiv — use the publisher/server field, never the DOI prefix, for server detection."
  `docs/02` §10.1's `SourceId` comment says the same thing.
- Do **not** check only the HTTP status. `docs/02` §8.5: errors arrive as
  `{"messages":[{"status":"error", …}]}` inside HTTP 200 — check `messages[0].status === "ok"`.
- Do **not** use `/pub/` or `/publisher/` for metadata: `docs/02` §8.3 says they do **not** include
  abstracts.
- Do **not** page `/details/` as if it returned 100 records — it returns **30** (`docs/02` §8.2).
- Do **not** assume a reuse license. `docs/09` §5.6: licensing is per-preprint and author-selected,
  and ranges from CC BY to "no reuse without permission"; read the record's `license` field.
- Do **not** raise the self-imposed 1/s. `docs/07` §7.3 and `docs/09` §5.6 both flag the absence of a
  published limit as a genuine documentation gap: "absence of enforcement is not permission"
  (`docs/02` §8.5).

**Done when.**
- [ ] `registerSources.ts` registers both `biorxiv` and `medrxiv`, and both resolve to the
      `api.biorxiv.org` limiter instance (same object, asserted by identity).
- [ ] `capabilities.keywordSearch` is `false` for both, asserted by a test.
- [ ] Enabling bioRxiv or medRxiv in a search adds `SRC:PPR` to the Europe PMC query, asserted
      against `explainQuery` output.
- [ ] A `10.64898/…` record with `server: "medRxiv"` maps to `SourceId` `medrxiv`, and a
      `10.64898/…` record with `server: "bioRxiv"` maps to `biorxiv` — same prefix, different source.
- [ ] A legacy `10.1101/…` record still maps correctly.
- [ ] A grep of `src/` finds **zero** occurrences of `startsWith('10.1101` and zero of
      `startsWith("10.1101`.
- [ ] An HTTP-200 body with `messages[0].status === "error"` produces a typed `SourceError`.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- biorxiv && ! grep -rn "startsWith(['\"]10\.1101" src/
```

**Notes — both servers ship enabled, and that is now decided.** `docs/07` §8.5's `sources` default
is `"pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv"` — all seven — and the prose
under that table records that an earlier draft "shipped five and silently dropped both preprint
servers". `docs/02` §8.4 and `docs/08` §4.2 carry the matching UI decision of 2026-09-09: shipping
them unchecked was **rejected**, because a user who ticks the box still gets nothing back and still
has no idea why. So this adapter runs on every keyword search and must be honest about contributing
nothing to the *search* half of it — hence the empty page plus warning in step 3, and hence
`P2-T14`'s reserved `⊕ ID lookup · preprint matching` status row.

`docs/07` §2.2's fixture-directory list is now `pubmed/ europepmc/ crossref/ semanticscholar/
arxiv/ biorxiv/ medrxiv/` — "one directory per `SourceId`, per §11.1 step 5 — no abbreviations". It
has a `medrxiv/` entry and no `s2/`, so both directories in **Files** are the tree's own names.

---

### P2-T08 — `preprint` item-type mapping and server attribution

| Field | Value |
|---|---|
| **ID** | `P2-T08` |
| **State** | `TODO` |
| **Depends on** | `P2-T03`, `P2-T06`, `P2-T07` |
| **Blocks** | `P2-T14`, `P2-T16`, `P2-T18` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-7` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Every preprint imports as a Zotero `preprint` item with `repository` and `archiveID`
populated, and no code anywhere identifies a preprint server by DOI prefix.

**Read first.**
- `docs/07-architecture-and-data-model.md` §6.1 — the **verified** `preprint` field list: it has
  **no `PMID`, no `PMCID`, no `ISSN`, no `publicationTitle`**; the server goes in `repository` and
  the server-native identifier in `archiveID`.
- `docs/07-architecture-and-data-model.md` §6.2 — the `CanonicalWork` → Zotero mapping table,
  including the `preprint` column and `archiveID` value form `arXiv:2401.01234`.
- `docs/07-architecture-and-data-model.md` §6.3 — the `extra` field contract: plugin lines are
  prefixed **`rh-`**, foreign lines are preserved byte-for-byte, standard non-namespaced lines
  (`PMID:`, `PMCID:`, `arXiv:`) are written **only** when the item type has no dedicated field and
  no such line already exists, and total growth is capped at ~500 characters.
- `docs/02-literature-database-apis.md` §10.3 "`preprint`" — the same mapping from the source side,
  and the warning that `journalArticle` **does** have native `PMID`/`PMCID` in schema 42.
- `docs/02-literature-database-apis.md` §10.2 "`type` mapping rules" — every trigger that yields
  `preprint`: EPMC `source == 'PPR'`, Crossref `type == 'posted-content'`, any arXiv or bioRxiv
  record, S2 venue ∈ {bioRxiv, medRxiv, arXiv, Research Square, SSRN}.
- `docs/02-literature-database-apis.md` §11.2 — the preprint-DOI **prefix set**
  `['10.1101/', '10.64898/', '10.48550/', '10.21203/', '10.2139/']` and why a single-prefix test is
  wrong.
- `docs/07-architecture-and-data-model.md` §5.1 — `WorkType`'s shipped kebab-case union
  (`"preprint"`, `"journal-article"`, …), which is **not** the Zotero item-type spelling.
- `docs/10-requirements-and-user-stories.md` FR-7 — the three acceptance scenarios, including the
  `research_helper/uncertain-type` tag for undeterminable types.

**Files.**
- modify `src/zotero/itemMapper.ts`
- modify `src/zotero/extraField.ts`
- create `src/sources/shared/preprintServers.ts`
- modify `src/model/canonicalWork.ts` (type-guard helpers only; the interface is doc 07's)
- create `test/unit/zotero/preprintMapping.test.ts`
- create `test/integration/zotero/preprintRoundTrip.test.ts`

**Do.**
1. Create `preprintServers.ts` exporting the `docs/02` §11.2 prefix **set** and a
   `detectServer(record)` function whose primary input is the publisher/server field
   (`bookOrReportDetails.publisher` for Europe PMC, `server` for bioRxiv, the literal `arXiv` for
   arXiv) with the prefix set used only as a weak corroborating signal.
2. Extend `itemMapper.ts` so `WorkType === "preprint"` maps to Zotero item type `preprint` with
   `repository` from the server name and `archiveID` from the arXiv ID in the form
   `arXiv:<id><version>`.
3. Route `ids.pmid` / `ids.pmcid` on a preprint into `extra` as `PMID:` / `PMCID:` lines per
   `docs/07` §6.3's rules, and drop `issn` entirely for preprints.
4. Set `genre` from the source's publication type (e.g. `"Preprint"`) per `docs/02` §10.3.
5. Apply the `research_helper/uncertain-type` tag when the type cannot be determined and default to
   `journalArticle` (FR-7 scenario 3).
6. Add an in-Zotero integration test that creates one arXiv, one bioRxiv and one medRxiv item and
   reads the fields back.

**Do NOT.**
- Do **not** write `PMID` or `PMCID` into a preprint's native fields — they do not exist
  (`docs/07` §6.1). Attempting it silently drops the value.
- Do **not** write `ISSN` on a preprint (`docs/07` §6.1: no `ISSN`), and do not write
  `publicationTitle` — use `repository`.
- Do **not** put the arXiv ID in `extra` for a `preprint`. `docs/07` §6.2: `archiveID` is the field;
  the `extra: arXiv:` line is the `journalArticle` fallback only.
- Do **not** stuff `PMID:` into `extra` for a `journalArticle`. `docs/07` §6.1 note for
  implementers: PMID and PMCID are first-class fields in Zotero 10's schema and the old convention is
  obsolete.
- Do **not** use `research_helper-sources` / `research_helper-key` as the `extra` prefix. The shipped
  prefix is **`rh-`** (`rh-work-key`, `rh-sources`), owned by `docs/07` §6.2/§6.3 — and `docs/02`
  §10.3 now says so too: an earlier draft of that section wrote the two lines with the
  `research_helper-` spelling and "both spellings are gone, because two prefixes over one field is
  how an import written by one release becomes invisible to the next". If you find the old spelling
  anywhere, it is stale text, not a second convention.
- Do **not** overwrite or reorder foreign `extra` lines. `docs/07` §6.3: writes replace only the
  plugin's own lines and preserve everything else byte-for-byte, including ordering.
- Do **not** declare a second `WorkType` from `docs/02` §10.1's Zotero-spelling union. `docs/02`
  §10.1's own note says those are working labels and doc 07 §5.1's kebab-case union ships.
- Do **not** identify the server from the DOI prefix (see `P2-T07`).

**Done when.**
- [ ] An arXiv record round-trips to a Zotero `preprint` with `repository === "arXiv"` and
      `archiveID === "arXiv:2609.04658v1"`, asserted in the in-Zotero integration test.
- [ ] A bioRxiv record with a PMID writes `PMID: …` into `extra` and leaves no orphan native field.
- [ ] An `extra` field containing a foreign line (e.g. Better BibTeX's `Citation Key:`) is byte-identical
      after a plugin write, asserted by a test.
- [ ] `detectServer` returns `medRxiv` for a `10.64898/` DOI whose publisher field says medRxiv, and
      `bioRxiv` for a `10.64898/` DOI whose publisher field says bioRxiv.
- [ ] A record with no determinable type imports as `journalArticle` and carries the
      `research_helper/uncertain-type` tag.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- preprintMapping && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/02` §11.2 leaves one thing **Unverified**: whether legacy `10.1101/` DOIs are being
re-minted under the new prefix. Both prefixes were seen live in the same `/details/` page, which is
consistent with "new prefix from a cutover date, legacy DOIs left alone" — but if re-minting is
happening, the same preprint could carry two DOIs and `P2-T09`'s Tier 0 would treat them as distinct.
`docs/02` §11.2's suffix-matching note (the accession `2026.08.20.745440` is stable across both
prefixes) is the mitigation; implement it as the secondary key in `P2-T09`.

---

### P2-T09 — Dedup engine: identifier-first cascade, fuzzy fallback

| Field | Value |
|---|---|
| **ID** | `P2-T09` |
| **State** | `TODO` |
| **Depends on** | `P1-T01`, `P1-T13` |
| **Blocks** | `P2-T10`, `P2-T11`, `P2-T13`, `P2-T14`, `P2-T16` |
| **Retires** | `R-18` (with `P2-T10`, `P2-T11`, `P2-T13`) |
| **Implements** | `FR-50`, `FR-51` |
| **Estimate** | 2.0 d |
| **Human gate** | none |

**Goal.** Two `SourceRecord`s that are the same work are matched on an identifier where one exists,
matched conservatively on title+author+year where none does, and **flagged rather than merged**
below the confidence threshold.

**Read first.**
- `docs/02-literature-database-apis.md` §11.3 — the eight-tier matching cascade with its confidence
  values, run in order, stopping at the first confident match.
- `docs/02-literature-database-apis.md` §11.1 — `normalizeDoi` and the three real cases it handles
  (OpenAlex URL prefixes, S2's uppercase suffixes, JSON-escaped slashes), plus the caution about
  storing the first-seen original form for display.
- `docs/02-literature-database-apis.md` §11.3.1 — `normPmid` / `normPmcid` / `normArxiv`, including
  the real S2-returns-bare-PMCID case.
- `docs/02-literature-database-apis.md` §11.3.2 — `normalizeTitle` and exactly which transformations
  it applies (NFKD, combining marks, JATS/HTML tags, entities, unicode dashes, smart quotes,
  PubMed's trailing period).
- `docs/02-literature-database-apis.md` §11.3.3 — the two similarity measures, the **cheap blocking
  step**, the four-row threshold table, and the three named false-positive families.
- `docs/02-literature-database-apis.md` §11.2 — the bioRxiv prefix change; the accession suffix is a
  useful secondary key.
- `docs/02-literature-database-apis.md` §11.6 — matching against the existing Zotero library: build
  the index once per run, skip trashed items.
- `docs/10-requirements-and-user-stories.md` FR-50 — the four acceptance scenarios, especially the
  fourth (below-threshold → flagged, never auto-merged) and FR-51 (link, don't duplicate).
- `docs/10-requirements-and-user-stories.md` §5 open question 13 — the recorded product position:
  "conservative… False merges are unrecoverable-feeling; false splits are not."
- `docs/11-implementation-roadmap.md` §3 R-18 — the mitigation this card implements verbatim:
  auto-merge only on exact identifier match.
- `docs/07-architecture-and-data-model.md` §5.1 — `ExternalIds`' branded types; the normalizers must
  produce branded values, and `model/ids.ts` already owns DOI/PMID/arXiv normalization.

**Files.**
- create `src/sources/shared/dedupe.ts`
- modify `src/model/ids.ts` (normalizers, if Phase 1 left them stubbed)
- modify `src/pipeline/searchImport/stages.ts`
- create `test/unit/sources/dedupe.test.ts`

**Do.**
1. Implement the `docs/02` §11.3 cascade as an ordered, data-driven tier list returning
   `{ verdict: "match" | "link" | "flag" | "distinct", tier, confidence, evidence }`.
2. Implement the normalizers exactly as `docs/02` §11.1 and §11.3.1 specify, in `model/ids.ts`, and
   have `dedupe.ts` consume them. Keep the first-seen original DOI form on the record for display and
   for the Zotero write; use the normalized form only as a dictionary key.
3. Implement `normalizeTitle` per `docs/02` §11.3.2 verbatim.
4. Implement blocking **before** any pairwise comparison: bucket by publication year ±1 and by a
   3-token signature of the longest words in the normalized title; compare only within a bucket.
5. Implement `levSim` and `jaccard` and apply the four-row threshold table from `docs/02` §11.3.3.
6. Implement all three false-positive guards: titles under 5 normalized tokens require an exact ID
   match; a trailing `/\b(part\s+)?([ivxlc]+|\d+)$/` difference forces *distinct*; same title +
   different year + different journal is a link, not a merge.
7. Add the bioRxiv accession-suffix secondary key (`docs/02` §11.2 implication 2).
8. Implement the existing-library index of `docs/02` §11.6 (`byDoi`, `byPmid`, `byArxiv`, `byTitle`),
   built once per run, skipping `item.deleted` items, feeding FR-51.
9. Make every threshold a named exported constant so `P2-T13` can tune and re-measure without
   touching the algorithm.

**Do NOT.**
- Do **not** auto-merge on any fuzzy signal. `docs/11` R-18 and `docs/10` FR-50 scenario 4: "the
  records are **not** merged automatically; they are flagged as 'possible duplicate' for user
  review."
- Do **not** test `doi.startsWith('10.1101/')` anywhere in the dedup path. `docs/02` §11.2: preprints
  now use `10.64898/`, both prefixes are live, and the prefix does not distinguish the servers.
  Use the `docs/02` §11.2 prefix **set** from `P2-T08`'s `preprintServers.ts`.
- Do **not** store the lowercased DOI as the record's DOI. `docs/02` §11.1: lowercasing is correct
  for *matching* only; a handful of publishers mint case-sensitive-looking DOIs, so the first-seen
  original form is what gets written to Zotero.
- Do **not** assume PMCIDs arrive with the `PMC` prefix. `docs/02` §11.3.1: Semantic Scholar returns
  `"PubMedCentral": "10949956"` bare while PubMed returns `PMC10949956` for the same paper.
- Do **not** run O(n²) Levenshtein over the result set or the library. `docs/02` §11.3.3: "Cheap
  blocking first — never run O(n²) Levenshtein over a whole library."
- Do **not** fuzzy-merge short titles. `docs/02` §11.3.3: `"Retraction"`, `"Editorial"`,
  `"Correction"` need an exact ID match.
- Do **not** let `levSim ≥ 0.95` alone decide on a series title. `docs/02` §11.3.3: `"… Part II"` vs
  `"… Part III"` rates ~0.97 and must be forced distinct.
- Do **not** merge two records that matched on title but carry **conflicting** DOIs. `docs/02` §11.5
  rule 1: that is *evidence they are not duplicates* — downgrade to a link and log it (`P2-T11`).
- Do **not** index trashed Zotero items. `docs/02` §11.6: check `item.deleted` and skip, so a paper
  the user deliberately deleted can be re-recommended.
- Do **not** hardcode thresholds inline. `docs/02` §11.3.3 says to tune them against a real library
  before shipping, and `docs/11` §4.4 lists dedup thresholds as safe-to-tune, not architectural.

**Done when.**
- [ ] Every tier in `docs/02` §11.3's table has at least one passing unit test with a real fixture
      pair.
- [ ] `normalizeTitle("Transfer learning enables predictions in network biology.")` equals
      `normalizeTitle("Transfer learning enables predictions in network biology")`, the real case
      from `docs/02` §11.3.2.
- [ ] A pair scoring `levSim` 0.82 with nothing else corroborating returns `verdict: "flag"`, and
      no code path can turn a `"flag"` into a merge.
- [ ] `"… Part II"` vs `"… Part III"` returns `distinct` despite `levSim > 0.95`.
- [ ] A 500-record synthetic set completes dedup with fewer than 500² / 10 pairwise comparisons,
      asserted by instrumenting the comparison counter.
- [ ] Every threshold is reachable as an exported constant.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- dedupe
```

**Notes.** `docs/02` §11.3.3's thresholds are the starting point, not the shipped values —
`P2-T13` measures them and may move them. Keep the algorithm and the constants separable so that
tuning is a one-line diff plus a re-run of the corpus report.

---

### P2-T10 — Field-merge policy, source precedence, record provenance

| Field | Value |
|---|---|
| **ID** | `P2-T10` |
| **State** | `TODO` |
| **Depends on** | `P2-T09` |
| **Blocks** | `P2-T12`, `P2-T13`, `P2-T14`, `P2-T16` |
| **Retires** | part of `R-18`, part of `R-17` |
| **Implements** | `FR-50`, `FR-8` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** A merged `CanonicalWork` is assembled field by field from an explicit, testable precedence
order, and every contested field records which source won.

**Read first.**
- `docs/07-architecture-and-data-model.md` §5.1 "Merge rules" — **how each field is combined**:
  `ids` union with a warning, longest non-truncated title, longest abstract, most-complete author
  list wholesale, earliest *complete* date, highest citation count with `fieldOrigin` recorded,
  subject union by `(scheme, term)`, and the requirement that precedence be a single exported
  constant. Read its lead-in note carefully: this table **does not** restate the per-field *source
  ordering* — "Source precedence is owned by `02-literature-database-apis.md` §10.4" — and an earlier
  draft of it did, with a different order for `title`. Where §10.4 lists OpenAlex, that entry is
  inert in v1.
- `docs/07-architecture-and-data-model.md` §5.1 `WorkProvenance` — `recordIds`, `fieldOrigin`,
  `seenIn`: the exact shape provenance must be written into.
- `docs/02-literature-database-apis.md` §10.4 — **the corpus's single source of per-field source
  precedence** (§11.5 says so normatively), with the *why* for each row: S2 abbreviates given names;
  OpenAlex abstracts are reconstructed; Crossref cover dates lead reality; only PubMed and Europe PMC
  have MeSH. Its opening paragraph also states that OpenAlex appears in four of the orderings and is
  **inert in v1** — no adapter ships, so no record ever carries that source and the remaining sources
  keep their relative order. The entries stay in place because they are the ordering a v1.1 adoption
  would need.
- `docs/02-literature-database-apis.md` §11.5 — the two additional rules: IDs are unioned never
  overwritten, and `sources` accumulates so "why did the plugin pick this title?" is answerable.
- `docs/10-requirements-and-user-stories.md` FR-50 scenario 2 — "field values are chosen by the
  documented source-priority order, all contributing sources are listed, and the merge decision
  (rule fired, similarity score) is recorded in provenance".
- `docs/07-architecture-and-data-model.md` §8.3 — the `work` and `source_record` tables; keeping
  `SourceRecord`s "enables re-merge without refetch", which is why the merge must be a pure function.
- `docs/11-implementation-roadmap.md` §3 R-17 — "prefer sources with reliable abstracts when
  merging" is a mitigation this precedence order carries.

**Files.**
- modify `src/model/merge.ts`
- modify `src/model/sourceRecord.ts` (guards only)
- modify `src/pipeline/searchImport/stages.ts`
- create `test/unit/model/merge.test.ts`
- create `test/unit/model/precedence.test.ts`

**Do.**
1. Export a single `PRECEDENCE` constant capturing the per-field source order, taken from
   `docs/02` §10.4 — the owner of that ordering — with each field's *combination* rule taken from
   `docs/07` §5.1. Drop nothing and reorder nothing to account for OpenAlex: skip the inert entry in
   place, so the surviving sources keep their relative order exactly as §10.4 lists them.
2. Implement `merge(records: SourceRecord[]): { work: CanonicalWork; conflicts: IdConflict[] }` as a
   **pure, deterministic** function — same inputs, same output, no clock, no network.
3. Union `ExternalIds` across records; on a conflicting value for the same ID type, keep the
   higher-precedence source's value and push an `IdConflict` — never silently overwrite.
4. Populate `WorkProvenance`: `recordIds` in merge order, `fieldOrigin` for every contested field,
   `seenIn` as the deduplicated set of contributing `SourceId`s.
5. Compute `workKey` per `docs/07` §5.1's scheme — **prefixed** (`doi:<doi>`, `pmid:<pmid>`,
   `arxiv:<id>`, `s2:<corpusId>`, `hash:<sha1(title|year|firstAuthor)>`), not the bare value form
   `docs/02` §10.1 sketches.
6. Write the merge decision (tier fired, confidence, contributing sources) into the search
   provenance record FR-8 requires.
7. Add a precedence test that feeds the same work from five sources and asserts the winning source
   for every field in the `docs/02` §10.4 table.

**Do NOT.**
- Do **not** implement "first source wins". `docs/02` §10.4 opens by ruling it out explicitly.
- Do **not** overwrite a present identifier with a conflicting one. `docs/02` §10.4 (`ids.*` row) and
  §11.5 rule 1: "never overwrite a present ID with a conflicting one — flag instead", and a DOI
  conflict on a title match is evidence the records are *not* duplicates.
- Do **not** interleave author lists. `docs/07` §5.1: "Source with the most complete list wins
  wholesale (never interleave)."
- Do **not** let a year-only date override a full date. `docs/07` §5.1 `publishedDate` rule:
  "Earliest *complete* date wins."
- Do **not** let Semantic Scholar win `authors`. `docs/02` §6.7 and §10.4: S2 abbreviates given
  names.
- Do **not** let a reconstructed abstract outrank a real one, and do **not** promote OpenAlex out of
  last place in the `abstract` ordering while transcribing the table. `docs/02` §9.2: "Prefer any
  other source's abstract over OpenAlex's". No OpenAlex record can reach the merge in v1 (`P2-T15`),
  so the entry is inert — but it is the ordering a v1.1 adoption inherits.
- Do **not** compute `workKey` as a bare identifier. `docs/02` §10.1's authority note: doc 07
  prefixes the key with its ID scheme, and `docs/07` §6.2 writes it into `extra` as `rh-work-key`.
- Do **not** make `merge` depend on wall-clock time or on network state. `docs/07` §8.3 keeps
  `SourceRecord`s specifically so the merge can be re-run with improved rules without refetching.
- Do **not** discard the `SourceRecord`s after merging. Same reason, plus provenance auditability.

**Done when.**
- [ ] The precedence test asserts the winning source for every field in `docs/02` §10.4's table.
- [ ] Merging the same five records in any input order produces a byte-identical `CanonicalWork`,
      asserted over all permutations of a 4-record set.
- [ ] Two records with conflicting DOIs produce an `IdConflict` and **no** overwritten `ids.doi`.
- [ ] `provenance.fieldOrigin` names a `SourceId` for `title`, `abstract`, `authors`,
      `publishedDate` and `citationCount` on every merged work in the test corpus.
- [ ] `workKey` for a DOI-bearing work is `doi:<lowercased doi>`, asserted exactly.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- merge && npm run test:unit -- precedence
```

**Notes.** `docs/02` §10.4 and `docs/07` §5.1 used to be two views of the same policy with two
different `title` orderings. That was resolved upstream on 2026-09-09 by giving the ordering one
owner: §10.4 holds the per-field source precedence, §5.1 holds the per-field combination rules and
says so in its lead-in, and §10.4 declares its OpenAlex entries inert rather than deleting them.
There is nothing left to reconcile — but record in a comment on `PRECEDENCE` which document each
half came from, so the next reader does not re-derive it.

---

### P2-T11 — Preprint ↔ published-version linking

| Field | Value |
|---|---|
| **ID** | `P2-T11` |
| **State** | `TODO` |
| **Depends on** | `P2-T04`, `P2-T05`, `P2-T06`, `P2-T07`, `P2-T09` |
| **Blocks** | `P2-T13`, `P2-T16` |
| **Retires** | part of `R-18` |
| **Implements** | `FR-50` scenario 3 |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — `docs/11` §5 lists "Preprint/published merge policy (open question 2)" as a decision **required before Phase 2** and blocking the dedup engine. `docs/10` §5 open question 2 is still open; its recommended default is "keep both, link via Zotero *Related*, tag the preprint `research_helper/superseded-by-published`". |

**Goal.** A preprint and its published version are recognised as related works, linked, and never
silently merged into one record.

**Read first.**
- `docs/02-literature-database-apis.md` §11.4 — "These are **different works** with different DOIs…
  **Link them; do not silently merge**", the seven detection signals in confidence order, and the
  Zotero-side representation (related-item relation when both are imported; `Preprint DOI:` /
  `Published DOI:` in `extra` when only one is).
- `docs/02-literature-database-apis.md` §11.3 Tier 7 — a known preprint↔published link is a **LINK,
  not a merge**, and sits below the fuzzy tiers in the cascade.
- `docs/07-architecture-and-data-model.md` §5.1 — `CanonicalWork.relatedVersionIds` is the shipped
  field (`docs/02` §11.4's `linkedVersion` is the working-name sketch).
- `docs/07-architecture-and-data-model.md` §6.5 — how related items are recorded on the Zotero side.
- `docs/02-literature-database-apis.md` §8.4 — the routing table row: "Preprint → published version
  link | bioRxiv `/pubs/` by DOI, or Crossref `relation.is-preprint-of`, or the `published` field in
  `/details/`".
- `docs/02-literature-database-apis.md` §7.5 note 5 — `<arxiv:doi>` present in an arXiv entry is a
  confidence-1.00 preprint→published signal.
- `docs/10-requirements-and-user-stories.md` §5 open question 2 — the recorded recommended default
  and its rationale ("merging loses the preprint's date, which matters for trend analysis").
- `docs/10-requirements-and-user-stories.md` FR-50 scenario 3 — the behaviour must follow "the
  explicit, configurable rule" and "the default is documented in the UI".

**Files.**
- modify `src/sources/shared/dedupe.ts`
- modify `src/model/merge.ts`
- modify `src/zotero/itemMapper.ts`
- modify `src/zotero/extraField.ts`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/sources/versionLinking.test.ts`

**Do.**
1. Implement the `docs/02` §11.4 signal table in confidence order, harvesting each signal from the
   adapter that produces it: bioRxiv `published_doi` / `published != "NA"`, Crossref
   `relation.is-preprint-of` / `is-published-in`, arXiv `<arxiv:doi>`, arXiv `<arxiv:journal_ref>`,
   a shared S2 `paperId` across two DOIs.
2. Set `relatedVersionIds` on both records, in both directions.
3. Insert the link as **Tier 7** of the cascade: reached only after the identifier and fuzzy tiers,
   and returning `verdict: "link"`, never `"match"`.
4. Apply the product decision recorded at the human gate. If the gate closes on the recommended
   default, implement: keep both, add a Zotero related-item relation between them, tag the preprint
   `research_helper/superseded-by-published`, and write `Published DOI:` / `Preprint DOI:` into
   `extra` when only one side is imported.
5. Surface the chosen default in the Search & Import window's duplicate-handling area (`P2-T14`).
6. Downgrade any title-matched pair with conflicting DOIs to a link (`docs/02` §11.5 rule 1).

**Do NOT.**
- Do **not** merge a preprint into its published version, whatever the title similarity.
  `docs/02` §11.4 and `docs/10` §5 open question 2: "Merging loses the preprint's date, which matters
  for trend analysis", and both records are legitimately wanted by some users.
- Do **not** implement the "suppress the preprint from results" behaviour as an unconditional
  default. `docs/02` §11.4 proposes it *with a preference to keep both*; `docs/10` §5 open question 2
  recommends keeping both. Do not resolve this from a task card — it is the human gate.
- Do **not** treat the fuzzy-derived signal (confidence 0.75 in `docs/02` §11.4's table) as a link.
  That row says **flag**, not link.
- Do **not** identify the preprint side by DOI prefix (`docs/02` §11.2 — see `P2-T07`).
- Do **not** use `<arxiv:journal_ref>` as a resolved link. `docs/02` §11.4 rates it 0.90 and notes it
  is "text only, must be resolved".
- Do **not** declare a `linkedVersion` field. `docs/02` §11.4's code block is a working sketch;
  `docs/07` §5.1's `relatedVersionIds: ExternalIds` is the shipped shape.
- Do **not** build the bioRxiv `/pubs/` cross-walk as a per-record loop — the `api.biorxiv.org`
  bucket is 1/s (`docs/07` §7.3) and `/pubs/` accepts a DOI-scoped lookup per call.

**Done when.**
- [ ] A bioRxiv fixture with a non-`"NA"` `published` field produces `relatedVersionIds` on both
      sides and **two** records in the output, not one.
- [ ] An arXiv entry carrying `<arxiv:doi>` produces a confidence-1.00 link, and the arXiv record's
      own DOI remains the constructed `10.48550/arXiv.<id>`.
- [ ] A title-matched pair with conflicting DOIs returns `verdict: "link"`, never `"match"`.
- [ ] The chosen default is stated in a localized string present in both `en-US` and `ko-KR`.
- [ ] `06-human-gates.md` records the closed decision and the date.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- versionLinking
```

**Notes — human gate.** This is the one Phase 2 gate `docs/11` §5 schedules *before* the phase
begins. If it is still open when the card is reached, implement the recommended default from
`docs/10` §5 open question 2 behind a named constant so a later decision is a one-line change, and
say so in the card's state — but do **not** invent a preference key for it; `docs/07` §8.5 is the
complete list of preferences and a new one has to be added there first.

---

### P2-T12 — Batched abstract-backfill pass

| Field | Value |
|---|---|
| **ID** | `P2-T12` |
| **State** | `TODO` |
| **Depends on** | `P2-T03`, `P2-T04`, `P2-T05`, `P2-T10` |
| **Blocks** | `P2-T16`, `P2-T18` |
| **Retires** | part of `R-17` |
| **Implements** | `FR-50`, part of `NFR-6` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A merged record that still has no abstract gets one from a cheaper source in a **batched**
lookup, so a 200-record import costs a handful of requests rather than 400.

**Read first.**
- `docs/02-literature-database-apis.md` §10.4 "Backfill pass" — the ordered three-step ladder
  (Europe PMC by DOI → S2 `/paper/batch` → Crossref `/works/{doi}?select=abstract`), the
  stop-at-first-hit rule, and the explicit budget: "A 200-record collection needs **2 Europe PMC
  calls and 2 S2 calls**, not 400 requests."
- `docs/07-architecture-and-data-model.md` §12.1 — `BackfillingAbstracts` is a named state between
  `Deduping` and `CreatingCollection`, and it is checkpointed and cancellable.
- `docs/02-literature-database-apis.md` §6.8 — the `/paper/batch` mechanics and the ~100-ID limit
  when `abstract` is requested.
- `docs/02-literature-database-apis.md` §5.4 — Crossref abstracts are JATS and low-hit-rate, which is
  why they are last.
- `docs/11-implementation-roadmap.md` §3 R-17 — "backfill abstracts from Europe PMC/Semantic Scholar
  by DOI when the primary source lacks one; show abstract-coverage percentage in the import summary".
- `docs/07-architecture-and-data-model.md` §4.2 — `fetchAbstract` is an optional method on
  `LiteratureSource`, "kept separate so the planner can decide whether the extra call is worth it".

**Files.**
- create `src/pipeline/searchImport/backfill.ts`
- modify `src/pipeline/searchImport/stages.ts`
- modify `src/sources/europepmc/europepmcSource.ts`
- modify `src/sources/semanticscholar/semanticscholarSource.ts`
- modify `src/sources/crossref/crossrefSource.ts`
- create `test/unit/pipeline/backfill.test.ts`

**Do.**
1. After dedup and merge, collect every `CanonicalWork` with no `abstract` **and** a DOI.
2. Step 1: one Europe PMC `search?query=DOI:"…" OR DOI:"…"`-style batched query per page of DOIs,
   `resultType=core`.
3. Step 2: for the remainder, `/paper/batch` in chunks of ~100 with `fields=abstract,tldr`.
4. Step 3: for what is still missing and only if it is a small remainder, Crossref
   `/works/{doi}?select=abstract` with the JATS→text converter from `P2-T04`.
5. Record the backfilling source in `provenance.fieldOrigin.abstract` so the merged record still
   answers "where did this abstract come from".
6. Report abstract-coverage percentage in the import summary (R-17 mitigation).
7. Make the whole pass cancellable and checkpointed per `docs/07` §12.1.

**Do NOT.**
- Do **not** issue one lookup per record. `docs/02` §10.4: "Batch these: never issue one lookup per
  record."
- Do **not** request `abstract` on 500-ID S2 batches (`docs/02` §6.8's 10 MB cap — keep to ~100).
- Do **not** put Crossref first. `docs/02` §10.4 orders it last because it is JATS and low-hit-rate,
  and `docs/02` §5.4 says Crossref alone is not sufficient for a feature that needs abstracts.
- Do **not** call Europe PMC `fullTextXML` here. Full text is a Phase 3 concern; `docs/02` §4.8 also
  warns it is 50–150× larger than an abstract and its 404 is uninformative.
- Do **not** fabricate an abstract when none is found. `docs/11` R-6/R-17 and FR-21: skip rather than
  invent, and record the gap.
- Do **not** let a backfill failure fail the import. It is an enhancement pass; a missing abstract is
  a reported statistic, not an error.

**Done when.**
- [ ] A 200-record synthetic set with 60 missing abstracts issues ≤ 2 Europe PMC requests and ≤ 1
      S2 batch request, asserted by counting calls on a fake transport.
- [ ] A record backfilled from Europe PMC has `provenance.fieldOrigin.abstract === "europepmc"`.
- [ ] Cancelling during backfill leaves the already-merged records intact and the job in
      `Cancelled`, not `Failed`.
- [ ] The import summary reports an abstract-coverage percentage.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- backfill
```

**Notes.** `docs/11` §4.3 V-13 measures abstract availability per source empirically in Phase 0; if
that spike produced numbers, use them to decide whether step 3 (Crossref) is worth shipping at all.

---

### P2-T13 — Dedup corpus and measured precision/recall report

| Field | Value |
|---|---|
| **ID** | `P2-T13` |
| **State** | `TODO` |
| **Depends on** | `P2-T09`, `P2-T10`, `P2-T11` |
| **Blocks** | `P2-T16` |
| **Retires** | `R-18` (this is the card that proves it) |
| **Implements** | `FR-50` |
| **Estimate** | 2.0 d |
| **Human gate** | **Yes** — the ≥ 200 pairs must be **hand-labelled** by a human who can read the records, and the measured precision/recall must be signed off against the thresholds before Phase 2 closes. |

**Goal.** The dedup engine's accuracy is a measured number, not an opinion: ≥ 200 hand-labelled
record pairs, a reproducible report, and a CI gate that fails if precision drops below 0.99.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 2 deliverables — "Dedup unit-test corpus: ≥ 200
  hand-labelled record pairs (true/false duplicates) with a measured precision/recall report", and
  the definition of done's "**precision ≥ 0.99** (a false merge is the expensive error); recall
  ≥ 0.90".
- `docs/11-implementation-roadmap.md` §3 R-18 — "Labelled evaluation corpus with a precision target
  of ≥ 0.99. Every merge recorded in provenance and reversible in the preview before import."
- `docs/13-testing-build-and-release.md` §3.1 — the `dedup-pair-set` fixture: "the same paper as
  returned by ≥3 different sources — **the single most valuable fixture we own**".
- `docs/13-testing-build-and-release.md` §3.2 — the mandatory redaction pass and the `_meta.json`
  sidecar every recorded fixture carries.
- `docs/13-testing-build-and-release.md` §3.3 — the staleness rules (warning at 180 days, failure at
  365) that will apply to this corpus too.
- `docs/02-literature-database-apis.md` §11.3.3 — "Thresholds (tune against a real user library
  before shipping)"; this card is where that tuning happens.
- `docs/02-literature-database-apis.md` §11.3.3 "Guards against known false-positive families" — the
  corpus must contain examples of all three families or the guards are untested.

**Files.**
- create `test/fixtures/dedup/pairs.jsonl`
- create `test/fixtures/dedup/_meta.json`
- create `scripts/build-dedup-corpus.ts`
- create `scripts/dedup-report.ts`
- modify `package.json` (add the `dedup:report` script — `docs/13` §1.6's eleven scripts do not
  include it, and **Verify with** below invokes it)
- create `test/unit/sources/dedupeAccuracy.test.ts`
- modify `.github/workflows/ci.yml`

**Do.**
1. Build the corpus from real recorded fixtures across the seven sources — run 4–6 realistic
   biomedical and CS queries, capture the raw `SourceRecord`s, and emit every candidate pair the
   blocking step would compare.
2. Have a human label each pair `duplicate` / `not-duplicate` / `linked-version`, storing the label
   plus a one-line reason in `pairs.jsonl`. **≥ 200 labelled pairs minimum.**
3. Ensure the corpus deliberately contains: at least 10 same-paper-from-≥3-sources sets; at least 5
   preprint↔published pairs; at least 5 short-title pairs (`"Retraction"`, `"Correction"`); at least
   5 series-title pairs differing by a roman numeral or trailing digit; at least 5 same-title
   different-year different-journal pairs; and at least 5 pairs with the `10.64898/` prefix, mixing
   bioRxiv and medRxiv.
4. Write `scripts/dedup-report.ts` to run the engine over the corpus and print precision, recall, F1,
   the confusion matrix, and every false positive with its tier and score.
5. Add `test/unit/sources/dedupeAccuracy.test.ts` asserting **precision ≥ 0.99** and
   **recall ≥ 0.90** against the committed corpus, and wire it into CI as a blocking gate.
6. Tune the `docs/02` §11.3.3 thresholds — which `P2-T09` exported as constants — against the corpus
   and record the before/after numbers in the report.
7. Apply the `docs/13` §3.2 redaction pass and write the `_meta.json` sidecar.

**Do NOT.**
- Do **not** label pairs with the dedup engine itself, or with an LLM, and then call the result
  hand-labelled. The whole value of the corpus is that the labels are independent of the code under
  test.
- Do **not** relax a threshold to make the test pass. `README.md` §5 rule 6: "If it fails, report the
  failure — do not adjust the criterion to match the code." A precision miss is R-18 materialising.
- Do **not** trade precision for recall. `docs/11` Phase 2 DoD states the asymmetry explicitly:
  "a false merge is the expensive error"; `docs/10` §5 open question 13 says false splits are
  recoverable and false merges are not.
- Do **not** count a correctly-identified preprint↔published **link** as a duplicate in the
  precision numerator. They are different works (`docs/02` §11.4) and belong in their own row of the
  confusion matrix.
- Do **not** edit a fixture by hand to make a test pass. `docs/13` §3.3 rule 4: re-record, or add a
  new scenario.
- Do **not** commit unredacted fixtures. `docs/13` §3.2: the recorder aborts if a fixture still
  matches a secret pattern after redaction, and `mailto` values are stripped.
- Do **not** make the accuracy test a warning. `docs/11` makes this a Phase 2 *deliverable* with a
  numeric definition of done; it is a blocking CI gate.

**Done when.**
- [ ] `test/fixtures/dedup/pairs.jsonl` contains ≥ 200 human-labelled pairs, each with a label and a
      reason.
- [ ] All six deliberately-included pair families from step 3 are present, asserted by a corpus
      shape test.
- [ ] `npm run dedup:report` prints precision, recall, F1 and the full confusion matrix.
- [ ] Measured **precision ≥ 0.99** and **recall ≥ 0.90**, and the numbers are committed in the
      report output.
- [ ] The accuracy test fails the CI job when a threshold constant is deliberately loosened
      (verified once, then reverted).
- [ ] The human sign-off is recorded in `06-human-gates.md` with the measured numbers and the date.

**Verify with.**
```bash
npm run typecheck && npm run dedup:report && npm run test:unit -- dedupeAccuracy
```

**Notes — human gate.** Budget the labelling itself as human time outside the 2.0 d estimate, which
covers the tooling, the corpus assembly, the report and the CI wiring. `docs/11` §4.4 lists dedup
thresholds under "build without verifying" precisely because this card is where they get verified —
so expect to move them, and expect the report diff to be the evidence.

---

### P2-T14 — Search & Import window: chips, badges, per-source status

| Field | Value |
|---|---|
| **ID** | `P2-T14` |
| **State** | `TODO` |
| **Depends on** | `P2-T02`, `P2-T08`, `P2-T09`, `P2-T10` |
| **Blocks** | `P2-T16`, `P2-T17` |
| **Retires** | part of `R-2`, part of `R-18` |
| **Implements** | `FR-2`, `FR-5`, `FR-9`, `FR-50`, `FR-53` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** The results table shows which sources contributed each row, flags possible duplicates
without merging them, and reports per-source progress and failure as separate lines.

**Read first.**
- `docs/08-ui-ux-spec.md` §4.2 — the control table: the seven-database checkbox row (**all on**, the
  `sources` default of `docs/07` §8.5), "Max results per DB", and the result-table columns
  (☑ / Title / Authors / Year / **Source** / Type / DOI). Its closing note is the **decision of
  2026-09-09** this card implements: bioRxiv and medRxiv ship enabled, and their status row states
  their *role* — `⊕ ID lookup · preprint matching` — never a count, a spinner or a zero result. The
  `⊕` glyph is reserved for that state and must not be reused for errors or for empty searches.
- `docs/08-ui-ux-spec.md` §4.3 — **the decision to use a plain scrollable `<html:table>` for v1**,
  and the `getRowString` / `label` accessibility requirements that hold whichever table is used.
- `docs/08-ui-ux-spec.md` §4.5 — the wireframe showing a single row carrying **two stacked source
  labels** (`PubMed` / `Crossref`) and the `⚠ already in library:` row treatment.
- `docs/08-ui-ux-spec.md` §4.6 "Searching" — the per-database status block, its seven-line worked
  example (five sources with counts, bioRxiv and medRxiv with `⊕ ID lookup · preprint matching`),
  and the sentence that governs this card: "Per-database status is essential: partial failure across
  seven sources is the *normal* case, and collapsing it into one spinner hides the fact that a whole
  database was missed."
- `docs/08-ui-ux-spec.md` §4.6 "All databases failed" — the error state naming each source and its
  status, with an "Open Preferences…" affordance.
- `docs/08-ui-ux-spec.md` §4.4 — the import pipeline the button drives, including the
  skip / add-existing / import-anyway duplicate choice.
- `docs/10-requirements-and-user-stories.md` FR-2 — seven independent checkboxes, the disabled-Search
  state when none is selected, and the Semantic Scholar no-key inline notice.
- `docs/10-requirements-and-user-stories.md` FR-5 — each row shows title, first author, year, venue,
  **source(s)**, DOI/PMID/arXiv ID and a checkbox.
- `docs/07-architecture-and-data-model.md` §11.1 step 9 and step 11 — there is **no per-source
  `enabled` boolean**; membership in the `sources` pref *is* the enable flag, and the source list is
  rendered from the registry.
- `docs/07-architecture-and-data-model.md` §10.2 — what a user-facing error may contain: a localized
  string plus one actionable next step; never a stack trace or a raw provider message.

**Files.**
- modify `addon/content/searchDialog.xhtml`
- modify `addon/content/style/searchDialog.css`
- modify `addon/content/searchDialog.js` (the in-window controller `P1-T20`/`P1-T22` created)
- modify `src/ui/viewModels/searchImportViewModel.ts` (the view model `P1-T22` created)
- modify `addon/locale/en-US/research-helper/searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/ui/searchImportViewModel.test.ts`

**Do.**
1. Render the database checkbox row from the source registry, not a hardcoded list
   (`docs/07` §11.1 step 11), reading and writing the `sources` pref as the enable flag.
2. Render **source chips** per result row from `provenance.seenIn`, so a work found by three sources
   shows three chips.
3. Render a **duplicate badge** on rows the engine returned as `verdict: "flag"` — visually distinct
   from the `⚠ already in library` treatment, with a tooltip naming the tier and the similarity
   score. Flagged rows are shown separately and are **never** pre-merged.
4. Render the per-source status block of `docs/08` §4.6 live during fan-out: queued / searching /
   ✓ N results / ⚠ error, one line per selected source, driven by `P2-T02`'s per-source outcomes.
   For a source whose `capabilities.keywordSearch` is `false` — bioRxiv and medRxiv, `P2-T07` — render
   the reserved `⊕ ID lookup · preprint matching` row instead, with the hover sentence `docs/08` §4.2
   requires (it names Europe PMC `SRC:PPR` and Crossref `type:posted-content` as where keyword
   discovery of preprints actually happens). A real failure on those adapters still renders as an
   error.
5. Render the all-failed state with one line per source naming the error class and an
   "Open Preferences…" button.
6. Show the FR-2 inline notice when Semantic Scholar is enabled without a key, linking to the
   key-request form (`docs/08` §7.3 already carries the URL).
7. Add every new string to **both** `en-US` and `ko-KR` FTL files (`docs/07` §11.1 step 10, R-22).

**Do NOT.**
- Do **not** introduce `VirtualizedTable`. `docs/08` §4.3's recorded decision is a plain scrollable
  `<html:table>` for v1, chosen specifically to remove the CJS-loader/window-scope hazard — the same
  section notes Zotero's own code warns that getting `require.js`'s window scope wrong "will segfault
  Zotero".
- Do **not** call `ztoolkit`'s `setLocale()` if any toolkit table helper is used — `docs/08` §4.3:
  it mutates the global `Zotero.Intl.strings`.
- Do **not** add a per-source `enabled` preference. `docs/07` §11.1 step 9: membership in `sources`
  *is* the enable flag, and §8.5 is the complete list of preferences.
- Do **not** change the `sources` default from a task card. `docs/07` §8.5 is authoritative — it now
  ships all seven — and §8.5.3 requires a migration entry for any shipped-pref change. Render the
  checkboxes from the pref; do not hardcode a shorter list and do not ship two of FR-2's seven boxes
  unchecked.
- Do **not** draw a count, a `⟳ searching…` spinner, or a zero-result line for bioRxiv or medRxiv on
  a keyword run. `docs/02` §8.4 and `docs/08` §4.2 (decided 2026-09-09): they contribute ID lookup
  and preprint matching, so "no search results" is not a failure for them and must not be drawn as
  one — that is what the reserved `⊕` row is for.
- Do **not** build the "Relevance threshold" control that `docs/08` §4.2's table now lists. It is
  "shown only when LLM relevance screening is available and enabled for the run", `docs/12` §3 owns
  its behaviour, and there is no LLM layer until Phase 3 — its default already has a `docs/07` §8.5
  row (`screening.threshold`, `60`), so nothing needs adding there either.
- Do **not** collapse the seven sources into one progress spinner (`docs/08` §4.6).
- Do **not** show a raw upstream error body or a stack trace in the status rows
  (`docs/07` §10.2) — use the localized `messageKey` plus one next step.
- Do **not** auto-merge a flagged pair from the UI. FR-50 scenario 4 and R-18: flagged means the
  user decides, and the merge must be reversible in the preview before import.
- Do **not** ship an English-only string. `docs/11` R-22's mitigation is a CI check that every
  `en-US` key exists in `ko-KR`.

**Done when.**
- [ ] A result row contributed by three sources renders three source chips, asserted in a view-model
      unit test.
- [ ] A `verdict: "flag"` pair renders a duplicate badge and both rows remain independently
      selectable.
- [ ] The per-source status block renders one line per selected source and updates independently,
      asserted against a scripted fan-out result.
- [ ] On a clean profile the seven checkboxes all render checked, driven by `docs/07` §8.5's
      `sources` default, asserted against a fake `PrefStore`.
- [ ] bioRxiv and medRxiv render `⊕ ID lookup · preprint matching` on a keyword run — never a count,
      a spinner or a zero-result line — asserted against a scripted fan-out result.
- [ ] With every source unchecked, the Search button is disabled and an inline message is shown
      (FR-2 scenario 2).
- [ ] With Semantic Scholar enabled and no key, the FR-2 scenario-3 notice renders.
- [ ] Every new FTL key exists in both `en-US` and `ko-KR`: the two message-ID sets are identical,
      asserted by the `diff` in **Verify with**, which exits non-zero on any gap.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- searchImportViewModel && \
diff <(grep -oE '^[a-z0-9-]+' addon/locale/en-US/research-helper/searchDialog.ftl | sort) \
     <(grep -oE '^[a-z0-9-]+' addon/locale/ko-KR/research-helper/searchDialog.ftl | sort)
```

**Notes.** The `sources` default is no longer an open question: `docs/07` §8.5 ships
`"pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv"` and records that an earlier
draft "shipped five and silently dropped both preprint servers". The three answers this card used to
put to the product owner are moot — the first one was taken. What survives is the *rendering*
question, which `docs/08` §4.2 also settled: shipping the two servers unchecked was rejected because
it hides the limitation rather than explaining it.

The FTL parity script is deliberately a `diff` and not an npm script: `docs/13` §5.1's
`check-l10n.mjs` does not exist yet, `P0-T14` left it as a commented placeholder, and `docs/11` R-22
keeps the localization gate warn-only until Phase 7. Do not invent a `lint:i18n` script here — the
eleven scripts in `docs/13` §1.6 are the shipped set.

The search-window file names were aligned upstream on 2026-09-09: `docs/08` §4.1 now points at
`docs/07` §2.2's tree (`addon/content/searchDialog.xhtml`, `searchDialog.js`, `src/ui/dialogs/`),
and the entry point stays `openSearchWindow` because the surface is a modeless window. Phase 1 built
it that way (`P1-T18`–`P1-T22`); this card extends those files rather than adding new ones.

---

### P2-T17 — Re-run a search from its provenance record

| Field | Value |
|---|---|
| **ID** | `P2-T17` |
| **State** | `TODO` |
| **Depends on** | `P1-T13`, `P1-T17`, `P1-T19`, `P2-T01`, `P2-T14` |
| **Blocks** | `P2-T16` |
| **Retires** | none |
| **Implements** | `FR-12`, part of `FR-8` |
| **Estimate** | 1.5 d |
| **Human gate** | none |

**Goal.** A collection filled by a previous run can be searched again from its own provenance
record: the window opens pre-filled with the recorded query, sources and date window, and the
import reports "already present: N" instead of duplicating what is already there.

**Read first.**
- `docs/10-requirements-and-user-stories.md` FR-12 — the two acceptance criteria this card is
  measured against: the dialog opens **pre-filled with the recorded parameters**, with the date
  window *optionally* advanced to today; and on import, items already present by DOI/PMID match
  are **not duplicated** and are reported as "already present: N". FR-12 deliberately restates
  neither the surface nor the data model: it names `docs/08` §2.5 and §4.6 as the surface and
  `docs/07` §5.3 as the data model, all three of which are read-first entries below.
- `docs/07-architecture-and-data-model.md` §5.3 — the exact `SearchProvenance` field names this
  card reads back (`schemaVersion`, `runId`, `userQuery`, `dateFilter` including its `"none"`
  form, `targetLibraryId`, `targetCollectionKey`, `perSource[].sourceId`,
  `perSource[].requestedLimit`). Nothing else is a source of re-run parameters.
- `docs/07-architecture-and-data-model.md` §5.3, "**Where it lives**" — the authoritative copy
  is the SQLite `search_provenance` row keyed by `runId` and **indexed by target collection so
  FR-12 can find the record for a collection**; the standalone note is a *projection*, "never
  the source of truth". This is the sentence that decides where this card reads from.
- `docs/07-architecture-and-data-model.md` §8.3 — the `search_provenance` DDL (`run_id`,
  `library_id`, `collection_key`, `note_key`, `json`, `started_at`, `finished_at`) and
  `CREATE INDEX idx_provenance_collection ON search_provenance(library_id, collection_key)`,
  the index this lookup uses; plus the `schema_version` table the migration bookkeeping needs.
- `docs/07-architecture-and-data-model.md` §8.3 placement table, row "`SearchProvenance`
  (authoritative)" — "Read back by 'Export provenance as JSON' (FR-8) and by 'Re-run this
  search' (FR-12), which needs it keyed by collection."
- `docs/07-architecture-and-data-model.md` §8.4 — plugin-owned files go in the **data
  directory** via `Zotero.DataDirectory.dir`, never the profile directory, and neither path may
  be hard-coded.
- `docs/07-architecture-and-data-model.md` §8.2, trap 3 — `Zotero.DBConnection` is confirmed
  present but carries no stability guarantee, which is why the store is reached through a port
  rather than called from the pipeline.
- `docs/07-architecture-and-data-model.md` §12.1, the note under the diagram — "existing library
  items are checked by DOI/PMID so re-running a search does not create duplicates; matched items
  are added to the new collection instead". The re-run reuses that behaviour; it does not add a
  second duplicate check.
- `docs/07-architecture-and-data-model.md` §2.3 — the dependency rule: `src/core/` may not
  import Zotero globals, so the record type and the re-hydration stay in `core/provenance.ts`
  and only `src/zotero/db.ts` touches SQLite.
- `docs/08-ui-ux-spec.md` §2.5, "Collection context menu" wireframe and the paragraph under it —
  **the specified surface**: the entry is labelled **"Re-run This Search…"**, sits below the
  submenu's separator beside "Recommend New Papers from This Collection…", and is the only entry
  in that submenu that is **absent rather than merely disabled** when the collection has no
  stored `SearchProvenance` row. Build what is drawn there; do not invent a placement.
- `docs/08-ui-ux-spec.md` §2.4 — the registration code, which now carries this `menuitem`
  verbatim: `l10nID: "research-helper-menu-collection-rerun"`, an `onShowing` that calls
  `context.setVisible(RH.provenance.hasRunForCollection(row.ref.id))` — **`setVisible`, not
  `setEnabled`** — and an `onCommand` that calls
  `RH.ui.openSearchWindow({ mode: "rerun", collectionID: row.ref.id })`.
- `docs/08-ui-ux-spec.md` §4.6, "**Re-run (pre-filled from provenance)**" — the specified window
  state: the banner copy, the **radio pair** `(•) as recorded ( ) advance to today` (not a
  checkbox), and the four rules the state must hold — everything stays editable and a re-run
  writes its own new record; "as recorded" is the default and "advance to today" moves only the
  *upper* bound and must **not** recompute §4.2's calendar-year window; the target collection is
  fixed to the invoked collection with "New collection…" still offered; and import reports
  `Imported 9 · Already present 128 · 1 failed` rather than counting duplicates as imports.
- `docs/08-ui-ux-spec.md` §4.2, "Search mode chip" row — the chip reads
  `Re-run: <collection name>` and `rerun` is one of the four `mode` values `openSearchWindow`
  accepts.
- `docs/08-ui-ux-spec.md` §10.2 — the FTL entries already specified for this entry in both
  locales: `research-helper-menu-collection-rerun` with `.label = Re-run This Search…` and
  `.label = 이 검색 다시 실행…`. Use those IDs and those strings; do not mint new ones for the
  menu entry.
- `docs/08-ui-ux-spec.md` §11, "States" — the FR-12 checklist line this card is signed off
  against: hidden when there is no `search_provenance` row, pre-filled per §4.6, controls
  editable, "as recorded" the default date choice, import reports "already present".
- `docs/08-ui-ux-spec.md` §2.3 — one top-level item per context, and that a top-level
  `separator` makes `_validate()` reject **the whole menu registration** silently.
- `docs/08-ui-ux-spec.md` §4.1 — the search window is a modeless singleton keyed by its window
  *name*; invoking it again must re-focus, not open a second window. Arguments arrive as
  `window.arguments[0]`, shaped `{ mode, seedItemID?, collectionID? }`.
- `docs/01-zotero-plugin-platform.md` §3.4(a) — `ZoteroPane.getSelectedCollection()` (singular)
  **throws** on Zotero 10; the handler must use the plural getter.
- `docs/09-security-privacy-and-api-keys.md` §2.1 — the `KEY_PATTERNS` redaction that runs
  *before* a provenance record is stored, which is why `transmittedUrl` cannot be replayed.

**Files.**
- create `src/zotero/db.ts`
- create `src/bootstrap/migrations.ts`
- modify `src/core/provenance.ts`
- modify `src/ui/menus/registerMenus.ts`
- modify `src/ui/dialogs/searchDialog.ts`
- modify `src/ui/viewModels/searchImportViewModel.ts`
- modify `src/pipeline/searchImport/stages.ts`
- modify `addon/locale/en-US/research-helper/mainWindow.ftl` (the menu entry's label)
- modify `addon/locale/ko-KR/research-helper/mainWindow.ftl`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl` (the re-run banner and the
  "already present: N" string)
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/core/provenanceRerun.test.ts`
- create `test/integration/zotero/provenanceStore.spec.ts`

**Do.**
1. Create `src/zotero/db.ts` over `Zotero.DBConnection("research-helper")` with the database
   file resolved from `Zotero.DataDirectory.dir`, exposing exactly two operations for now:
   `putProvenance(record, libraryId, collectionKey, noteKey)` and
   `findProvenanceByCollection(libraryId, collectionKey)` returning the most recent row.
2. Create `src/bootstrap/migrations.ts` with the `schema_version` table and **version 1** =
   the `search_provenance` DDL and `idx_provenance_collection` of `docs/07` §8.3, copied
   column-for-column. No other table.
3. In `src/core/provenance.ts`, declare the `ProvenanceStore` port (the two operations above)
   and `toSearchParams(record, { advanceDateWindow })`, a pure function that turns a stored
   `SearchProvenance` into the search window's parameter object: `userQuery`, the source ID set
   taken from `perSource[].sourceId`, `requestedLimit`, and the date window — either the
   recorded `dateFilter`, or, when `advanceDateWindow` is set, `fromIso` kept and `toIso` moved
   to today. `dateFilter: "none"` re-hydrates as "All years" (FR-3).
4. Persist the record from the `searchImport` stage that already builds it (`P1-T17`): write
   the note as today **and** the `search_provenance` row, in that order, storing the note key
   on the row so the projection stays findable.
5. Add the **Re-run This Search…** entry to the existing collection submenu from `P1-T19`,
   exactly as `docs/08` §2.4 registers it and where §2.5's wireframe places it — below the
   separator, above "Recommend New Papers from This Collection…". Its `onShowing` calls
   `context.setVisible(...)`, so the entry is **hidden**, not disabled, when
   `findProvenanceByCollection` returns no row for the single selected collection, read via
   `ZoteroPane.getSelectedCollections()`.
6. On invoke, call `openSearchWindow({ mode: "rerun", collectionID })` per `docs/08` §2.4, and
   have the window load the record itself and repaint with the recorded values; the window is a
   named singleton, so it re-focuses if already open. Render `docs/08` §4.2's mode chip as
   `Re-run: <collection name>`.
7. Render `docs/08` §4.6's **Re-run (pre-filled from provenance)** state as the window's initial
   state for this mode: the banner naming the collection and the recorded run's date and counts,
   every control seeded from the record and left editable, the target collection fixed to the
   invoked collection with "New collection…" still offered, and the date choice as a **radio
   pair** with `as recorded` selected by default and `advance to today` moving only `toIso`.
   Once Search is pressed, the searching / results / error states are the keyword run's.
8. Re-run the query through `P2-T01`'s parser and per-source renderers so each source gets a
   freshly built request; the recorded `transmittedQuery`/`transmittedUrl` are displayed as
   provenance only.
9. Count already-present items using `P1-T13`'s DOI/PMID detector during import and surface
   the FR-12 string "already present: N" in the import summary, in `docs/08` §4.6 rule 4's
   shape — `Imported 9 · Already present 128 · 1 failed`.
10. Write a **new** provenance record for the re-run, with its own `runId`, and leave the
    original row untouched.
11. Add every new string to both `en-US` and `ko-KR` FTL files (`docs/07` §11.1 step 10, R-22).
    The menu entry's IDs and strings are already specified in `docs/08` §10.2 — take them from
    there; only the §4.6 banner and the "already present" summary strings are new.

**Do NOT.**
- Do **not** read the parameters back out of the Zotero note. `docs/07` §5.3: the note is a
  projection, "never the source of truth", and FR-8's export "serialises the stored object
  rather than re-parsing the note". A note the user has edited would silently change a re-run.
- Do **not** replay `SourceProvenance.transmittedUrl`. `docs/07` §5.3 and `docs/09` §2.1: API
  keys are redacted **before** the value is stored, so the stored URL is not a runnable URL.
  Rebuild every request from `userQuery` through `P2-T01`.
- Do **not** call `ZoteroPane.getSelectedCollection()`. `docs/01` §3.4(a): the singular getter
  **throws** on Zotero 10, and Zotero's own docs page still shows it.
- Do **not** register a second top-level menu item or a top-level separator. `docs/08` §2.3:
  one submenu costs one slot in the grouping budget, and `_validate()` rejects a top-level
  separator by failing registration for **the whole menu**, silently.
- Do **not** open a second search window. `docs/08` §4.1: the window *name* makes it a
  singleton that re-focuses, which matters for a tens-of-seconds search.
- Do **not** advance the date window without asking. FR-12 says *optionally* and `docs/08` §4.6
  rule 2 makes "as recorded" the default; silently moving `toIso` changes what the run means and
  makes two provenance records incomparable.
- Do **not** recompute the window from `docs/08` §4.2's calendar-year rule when the user picks
  "advance to today". §4.6 rule 2: only the *upper* bound moves — recomputing would move the
  lower bound too "and silently change what is being compared".
- Do **not** merely *disable* the menu entry when there is no provenance row. `docs/08` §2.5
  makes it "the only entry in this submenu that can be *absent* rather than merely disabled",
  and §2.4 registers it with `context.setVisible`. A disabled entry advertises a feature a
  hand-built collection can never reach.
- Do **not** lock the pre-filled controls. `docs/08` §4.6 rule 1: the record seeds the controls,
  it does not freeze them, and an adjusted re-run is a normal run.
- Do **not** add a second duplicate check. `docs/07` §12.1 and `P1-T13` already check existing
  items by DOI/PMID before any Zotero write; a re-run reuses that path and reports its count.
- Do **not** overwrite the original provenance row. Each run is "written once, when the run
  finishes or is cancelled" (`docs/07` §5.3); a re-run is a new `runId`, not an update.
- Do **not** add a column, an index or a table that `docs/07` §8.3 does not declare, and do
  **not** store the last search in a preference — §8.5 is the complete list of preferences and
  §8.5.2 places job and run state in SQLite.
- Do **not** put the database in the profile directory or hard-code either path. `docs/07`
  §8.4: plugin-owned files go in the data directory, resolved through
  `Zotero.DataDirectory.dir`, because a user may have relocated it.
- Do **not** import SQLite from `src/core/`. `docs/07` §2.3: `core/` has no Zotero imports;
  the pipeline talks to the `ProvenanceStore` port.
- Do **not** ship an English-only string (`docs/11` R-22).

**Done when.**
- [ ] A fresh profile creates `research-helper.sqlite` under `Zotero.DataDirectory.dir` with a
      `schema_version` of 1 and a `search_provenance` table whose columns and index match
      `docs/07` §8.3 exactly, asserted by reading the schema back.
- [ ] A completed run writes exactly one `search_provenance` row whose `json` still validates
      against `schema/provenance.schema.json`.
- [ ] `findProvenanceByCollection` on a collection with three recorded runs returns the one
      with the greatest `finished_at`.
- [ ] Right-clicking a collection with no provenance row shows **no** "Re-run This Search…"
      entry at all; with one, the entry is present — asserted in the integration suite.
- [ ] `toSearchParams` on a record with `dateFilter: "none"` yields "All years", and with
      `advanceDateWindow: true` yields the recorded `fromIso` **unchanged** and today's `toIso`
      — asserted against a record whose `fromIso` predates `currentYear − 2`, so a recomputation
      of §4.2's window would fail the assertion.
- [ ] The window opened with `mode: "rerun"` shows the mode chip `Re-run: <collection name>`,
      the §4.6 banner, and `as recorded` selected; every seeded control is editable.
- [ ] Re-running a collection whose 40 items are all still present imports 0 new items and the
      summary reads "already present: 40" in §4.6 rule 4's shape.
- [ ] A re-run leaves the original row unchanged and adds a second row with a different
      `runId`.
- [ ] Invoking the entry twice focuses one window; a repository grep finds no
      `getSelectedCollection(` (singular) call.
- [ ] Every new FTL key exists in both `en-US` and `ko-KR`: for `mainWindow.ftl` and
      `searchDialog.ftl` the two message-ID sets are identical, asserted by the `diff` in
      **Verify with**, which exits non-zero on any gap. (There is no `lint:i18n` script — `docs/13`
      §5.1's `check-l10n.mjs` is not built until Phase 7, `docs/11` R-22 keeps that gate warn-only
      until then, and `docs/13` §1.6's eleven scripts are the shipped set.)
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- provenanceRerun && \
for f in mainWindow searchDialog; do \
  diff <(grep -oE '^[a-z0-9-]+' addon/locale/en-US/research-helper/$f.ftl | sort) \
       <(grep -oE '^[a-z0-9-]+' addon/locale/ko-KR/research-helper/$f.ftl | sort) || exit 1; \
done && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes — this card is the plan's first plugin-owned SQLite write, and that is deliberate.**
`docs/11` §1 assigns FR-12 to Phase 2 because its surface — the multi-source search window — is
finished here, while its input, the FR-8 provenance record, ships in Phase 1 via `P1-T17`.
`docs/07` §5.3 makes the `search_provenance` row the authoritative copy, so the re-run cannot be
built on the note. `plan/02` §3 defers "SQLite (`docs/07` §8.3)" to Phase 3 as part of the
*job queue*; this card does not build the job queue. It ships `src/zotero/db.ts` and
`src/bootstrap/migrations.ts` with **one table**, and Phase 3 widens both — `P3-T15` and
`P3-T29` already list `src/zotero/db.ts` as `modify`, which only works if something created it
first.

**Two things stay Phase 3 and must not be pulled in here:** the `docs/07` §8.2 capability probe
that decides whether SQLite is usable, and the `JsonFilePluginStore` fallback that §8.3 requires
be "a real, shipped fallback — not a stub". Until they exist, a profile where
`Zotero.DBConnection` fails must degrade to "Re-run this search…" being unavailable, not to a
broken menu item (`docs/11` §0 principle 5). Flag that degradation to the product owner when
this card lands — it is the one gap this decomposition knowingly leaves open.

**`docs/08` now specifies the whole surface, so nothing here is invented.** An earlier revision
of this card noted that §2.5's submenu listed three commands with no re-run among them and that
§4.6 had no pre-filled state, and told the implementer to follow the shape of the existing
entries and file the addition later. The 2026-09-09 documentation pass filed it: §2.5's wireframe
now draws **Re-run This Search…** with the hidden-not-disabled rule, §2.4 registers the
`menuitem` with `mode: "rerun"`, §4.2 lists the `rerun` mode chip, §4.6 draws the
**Re-run (pre-filled from provenance)** state with its four rules, §10.2 ships the FTL entries in
both locales, and §11's States checklist carries the FR-12 line. Build what those sections say.

---

### P2-T18 — Translator import path behind `useTranslators`

| Field | Value |
|---|---|
| **ID** | `P2-T18` |
| **State** | `TODO` |
| **Depends on** | `P1-T14`, `P2-T08`, `P2-T12` |
| **Blocks** | `P2-T16` |
| **Retires** | none |
| **Implements** | part of `FR-6`, part of `NFR-1` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** A user who values Zotero-canonical metadata over speed can turn on `useTranslators`
and have records with a DOI, PMID or arXiv ID imported through Zotero's own identifier lookup,
with hand-mapping as the per-record fallback — and everyone else keeps the fast path unchanged.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.5, "Sources & search" — the `useTranslators` row:
  boolean, default **`false`**, semantics owned by `docs/01` §6.3. The prose under the table
  ("**`useTranslators` ships off**") gives the reason — one network lookup per record, which
  "puts a 100-record import outside NFR-1's budget by construction" — and states that it is
  "read once, at the entry to the `WritingItems` state". An earlier draft shipped it `true`.
- `docs/07-architecture-and-data-model.md` §12.1, the paragraph after the state diagram —
  `WritingItems` is where the two strategies are selected between; it reads the pref **once** on
  entry, falls back to Strategy A **per record** on failure or timeout, and applies the abstract
  backfill after **either** path.
- `docs/01-zotero-plugin-platform.md` §6.3 items 2–4 — Strategy A is the shipped default and the
  path NFR-1 is measured against; Strategy B is the opt-in; and the abstract backfill is "the
  single highest-value post-processing step for a summarisation plugin".
- `docs/01-zotero-plugin-platform.md` §6.2 — the verified pipeline
  `Zotero.Utilities.extractIdentifiers` → `new Zotero.Translate.Search()` → `setIdentifier()` →
  `getTranslators()` → `setTranslator()` → `translate()`, the `importByIdentifier` reference
  implementation (which opens with `await Zotero.Schema.schemaUpdatePromise`), and why the
  **whole** translator list is passed to `setTranslator`: `complete` falls through to the next
  translator when one fails.
- `docs/01-zotero-plugin-platform.md` §6.2, "What `extractIdentifiers` actually accepts" — the
  strict `DOI → ISBN → arXiv → adsBibcode → PMID` priority that stops at the first match, arXiv
  version-suffix stripping, the loose PMID fallback regex, that **PMCID is not recognised at
  all**, and that Zotero's own lookup batches PMIDs 200 at a time as `[{ PMID: [...] }]`.
- `docs/01-zotero-plugin-platform.md` §6.2, "Which translators actually participate" — Europe
  PMC's translator is **web-only** so `Zotero.Translate.Search` never invokes it, and there is no
  Semantic Scholar search translator; "that is precisely why Strategy A remains the fallback".
- `docs/01-zotero-plugin-platform.md` §6.2, the closing warning — `Zotero.Translate.Search` is
  **undocumented internal API** with no stability guarantee across major versions: wrap it in
  try/catch and keep Strategy A working.
- `docs/10-requirements-and-user-stories.md` NFR-1, the **Scope** bullet — the ≤ 10 s target
  covers "the hand-mapped import path only"; the translator path "is outside this budget by
  construction" because the lookup *is* the import and cannot be mocked away.
- `docs/07-architecture-and-data-model.md` §8.5.1 — the typed `getPref` accessor, that plugin
  code never calls `Zotero.Prefs` directly, and that anything off the startup list is read on
  demand so a change takes effect on the next run without a restart.
- `docs/01-zotero-plugin-platform.md` §7.2 — the shipped `pref()` line for `useTranslators`,
  with its comment "MUST ship false", which must stay byte-consistent with §8.5.
- `docs/11-implementation-roadmap.md` §3 R-1 — Zotero's release cadence, and the mitigation this
  card must honour: keep the Zotero API surface behind `src/zotero/*` so breakage is localized.

**Files.**
- create `src/zotero/translatorImport.ts`
- modify `src/pipeline/searchImport/stages.ts`
- modify `src/prefs/schema.ts`
- modify `addon/prefs.js`
- create `addon/locale/en-US/research-helper/preferences.ftl` (the preference's label and its
  slower-path caveat; the file is first created here and `P3-T04`'s pane binds it)
- create `addon/locale/ko-KR/research-helper/preferences.ftl`
- modify `addon/locale/en-US/research-helper/searchDialog.ftl` (the per-run Strategy A/B counts
  in the import summary)
- modify `addon/locale/ko-KR/research-helper/searchDialog.ftl`
- create `test/unit/pipeline/importStrategy.test.ts`
- create `test/integration/zotero/translatorImport.spec.ts`

**Do.**
1. Reconcile the shipped default first: `useTranslators` must read `boolean` / `false` in
   `src/prefs/schema.ts` and `pref("extensions.zotero.research-helper.useTranslators", false);`
   in `addon/prefs.js`, matching `docs/07` §8.5 and `docs/01` §7.2. Correct it if `P1-T03`
   shipped `true`.
2. Read it **once**, through `getPref("useTranslators")`, at the entry to the `WritingItems`
   stage in `src/pipeline/searchImport/stages.ts` (`docs/07` §12.1) — not at startup, not per
   record — and carry the resulting strategy on the stage's context.
3. Off — the shipped default — every record hand-maps through `P1-T14` exactly as today. This
   path must be untouched, byte for byte, in its request count and its timings.
4. On, in `src/zotero/translatorImport.ts`: `await Zotero.Schema.schemaUpdatePromise`, then per
   record derive the identifier from the merged `CanonicalWork`'s DOI, PMID or arXiv ID,
   construct `Zotero.Translate.Search`, `setIdentifier`, `await getTranslators()`, pass the
   **whole list** to `setTranslator`, and `translate({ libraryID, collections, saveAttachments })`.
5. Batch PMID-only records 200 at a time as `[{ PMID: [id1, id2, …] }]`, per `docs/01` §6.2's
   note on Zotero's own bulk lookup.
6. Route a PMCID-only record through `P2-T03`'s Europe PMC adapter to obtain a PMID or DOI
   first; a record that still has no usable identifier goes straight to Strategy A without a
   lookup attempt.
7. Per-record fallback: a throw, an empty translator list, an empty result, or a per-record
   timeout falls back to Strategy A **for that record only**, is logged, and is counted.
8. Run `P2-T12`'s abstract backfill after **either** path, since translators frequently drop
   `abstractNote` (`docs/01` §6.3 item 4).
9. Apply `P2-T08`'s preprint-server attribution to items produced by either path. Strategy B
   returns Zotero-canonical item types, so write the attribution without re-mapping its type,
   and record which path produced each item in `provenance.fieldOrigin`.
10. Report per-run counts in the import summary: imported via Strategy B, fell back to
    Strategy A, and the fallback reason class.
11. Add the FTL strings for the preference's label — "Fetch metadata through Zotero translators
    (slower, more accurate)" (`docs/01` §6.3 item 3) — and its slower-path caveat, in **both**
    locales, so `P3-T04`'s preferences pane can bind them without inventing new keys.

**Do NOT.**
- Do **not** ship the preference on. `docs/07` §8.5 and `docs/01` §7.2's comment ("MUST ship
  false"): shipping it `true` "promised a path no phase built and a throughput target it could
  not meet at the same time".
- Do **not** read the pref per record or at startup. `docs/07` §12.1 and §8.5.1: once, at the
  entry to `WritingItems`, so a mid-run change cannot split one import across two strategies.
- Do **not** measure NFR-1 with the preference on, or report a translator-path run against it.
  `docs/10` NFR-1's scope bullet puts that path outside the budget by construction.
- Do **not** pass `translators[0]` to `setTranslator`. `docs/01` §6.2: passing the whole list is
  deliberate, because `Zotero.Translate.Search.prototype.complete` falls through to the next
  translator when one fails.
- Do **not** call `Zotero.Utilities.Internal.extractIdentifiers`. `docs/01` §6.2: it is
  deprecated and now only logs a notice and forwards; use the non-`Internal` form.
- Do **not** feed a PMCID to `setIdentifier`. `docs/01` §6.2: PMCID "is not recognised at all",
  and `setIdentifier` accepts only `DOI`, `ISBN`, `PMID`, `arXiv` and `adsBibcode`.
- Do **not** expect identifier lookup to reach Europe PMC or Semantic Scholar. `docs/01` §6.2:
  Europe PMC's translator is web-only and `Translate.Search` will never invoke it, and S2 has no
  search translator — its web translator delegates to DOI content negotiation.
- Do **not** let a lookup failure fail the run. `docs/01` §6.2's loop logs the error and keeps
  going; the record falls back to Strategy A.
- Do **not** delete or bypass Strategy A. `docs/01` §6.2: `Zotero.Translate.Search` is
  undocumented internal API with no stability guarantee across major versions (R-1), so the
  hand-mapped path is the thing that must still work after a Zotero upgrade.
- Do **not** skip the abstract backfill on the Strategy B path. `docs/01` §6.3 item 4:
  "Zotero's translators frequently drop abstracts", and a summarization plugin without an
  abstract has nothing to summarize (FR-21).
- Do **not** call `Zotero.Translate` from anywhere outside `src/zotero/`. `docs/07` §2.3: that
  directory is the only one allowed to import Zotero globals, and R-1's mitigation depends on
  the breakage staying localized there.
- Do **not** add the prefs-pane checkbox here. The preferences pane is Phase 3 (`P3-T04`,
  `docs/11` §1); this card ships the strings and the behaviour, and until the pane lands the
  preference is reachable through `about:config` only — which is exactly `docs/11` §0
  principle 5's "feature flags in prefs hide incomplete work".
- Do **not** add a per-source, per-record or per-run override preference. `docs/07` §8.5 is the
  complete list of preferences.
- Do **not** call `Zotero.Prefs.get` directly (`docs/07` §8.5.1) or add a second `pref()` line.
- Do **not** ship an English-only string (`docs/11` R-22).

**Done when.**
- [ ] `getPref("useTranslators")` returns `false` on a clean profile, and `addon/prefs.js`
      carries the line with `false`; a test asserts the schema default and the `pref()` line
      agree.
- [ ] With the pref off, a 100-record import constructs **zero** `Zotero.Translate.Search`
      objects, asserted with a spy, and still completes inside NFR-1's ≤ 10 s budget on
      `P0-T20`'s harness.
- [ ] With the pref on, a record carrying a DOI produces exactly one `Translate.Search`, and the
      value passed to `setTranslator` is the full array returned by `getTranslators()`, not its
      first element.
- [ ] With the pref on and the translator stubbed to throw, the record is still imported by
      Strategy A, the run succeeds, and the summary reports one fallback.
- [ ] A PMCID-only record never reaches `setIdentifier`: it is resolved to a PMID or DOI first,
      or routed to Strategy A.
- [ ] The preference is read exactly once across a 50-record import, asserted with a spying
      `PrefStore`.
- [ ] A Strategy B item returned without `abstractNote` has one after the run, proving the
      backfill runs on both paths.
- [ ] A repository grep finds no `Zotero.Translate` reference outside `src/zotero/`.
- [ ] Every new FTL key exists in both `en-US` and `ko-KR`: for `preferences.ftl` and
      `searchDialog.ftl` the two message-ID sets are identical, asserted by the `diff` in
      **Verify with**. (No `lint:i18n` script exists — see `P2-T14`'s note.)
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- importStrategy && \
for f in preferences searchDialog; do \
  diff <(grep -oE '^[a-z0-9-]+' addon/locale/en-US/research-helper/$f.ftl | sort) \
       <(grep -oE '^[a-z0-9-]+' addon/locale/ko-KR/research-helper/$f.ftl | sort) || exit 1; \
done && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes — the default flipped, and this card exists because of it.** `docs/07` §8.5 now ships
`useTranslators` **`false`**, `docs/01` §6.3 makes hand-mapping (Strategy A) the default path
with translator lookup (Strategy B) the opt-in, and `docs/10` NFR-1 was re-scoped so the slow
path is not held to the fast path's throughput target. Both plan files now record the change:
`plan/00-task-index.md` §5 item 4, and `plan/02` §3's scope table, whose row for Strategy B reads
"Resolved 2026-09-09: `useTranslators` now ships **`false`** … Phase 1 correctly reads nothing"
(its conflict **C4** is struck through for the same reason). Step 1 of **Do** survives that
cleanup: `P1-T03` may still have shipped `true` from the older text, and the pref schema and
`prefs.js` line have to be checked against `docs/07` §8.5 rather than assumed.

The residual risk is R-1, not R-16. Strategy B rests on `Zotero.Translate.Search`, which
`docs/01` §6.2 records as undocumented internal API with no stability guarantee — a Zotero major
version can remove it. Keeping every call inside `src/zotero/translatorImport.ts` and keeping
Strategy A as the live fallback means such a break degrades one opt-in preference rather than
the import feature.

`docs/07` §2.2's `src/zotero/` listing does not name `translatorImport.ts`; it is a new file
inside a directory that section does declare, following the same convention as
`P2-T12`'s `src/pipeline/searchImport/backfill.ts`. Do not move the Zotero calls anywhere else
to avoid adding a file.

---

### P2-T15 — Record and enforce the settled OpenAlex decision: out of v1

| Field | Value |
|---|---|
| **ID** | `P2-T15` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | none |
| **Retires** | part of `R-2` |
| **Implements** | part of `FR-2` |
| **Estimate** | 0.25 d (recording the closed decision and wiring the guard; there is no adapter to build) |
| **Human gate** | none |

**Goal.** The closed OpenAlex decision — **out of v1** — is written down where an implementer will
find it, and a mechanical guard makes it impossible to acquire an OpenAlex surface by accident: no
adapter, no preference member, no `SecretId`, no rate-limit row.

**Read first.**
- `docs/02-literature-database-apis.md` §9.3 — **the decision, in the document that used to argue the
  other way**: "OpenAlex is out of scope for v1. It ships no adapter, no preference, no `SecretId`
  and no rate-limit policy row. The evaluation above is retained as v1.1 research." The section
  records that its former "ship it opt-in, disabled by default" recommendation is **withdrawn**,
  because a confirmed decision (`docs/00` §3 D2) and a scope statement (`docs/10` §4 item 10) outrank
  a technical recommendation. Do not read §9.1/§9.2 as authorisation to build anything.
- `docs/00-overview.md` §3 D2 — the confirmed v1 source list. OpenAlex is not in it.
- `docs/10-requirements-and-user-stories.md` §4 out-of-scope item 10 — "Scopus, Web of Science,
  Dimensions, **OpenAlex** and CORE are out. **OpenAlex is the most likely v1.1 addition.**"
- `docs/07-architecture-and-data-model.md` §5.1 — the `SourceId` union comment: `openalex` is
  **RESERVED, not shipped**. It stays in the union so the id, the `OpenAlexId` brand and the
  `ExternalIds.openAlexId` slot cannot be reused for something else, and so doc 02's mirrored copy
  does not have to diverge. The three v1 rules that follow are stated there: nothing may put
  `openalex` in the `sources` preference, §7.3 has no `api.openalex.org` row, and `docs/02` §10.4's
  OpenAlex precedence entries are inert.
- `docs/07-architecture-and-data-model.md` §8.5 "Sources & search" — the `sources` row: the default
  is the seven v1 sources and the Values column reads "from the `SourceId` union (§5.1) **minus
  `openalex`**"; the prose states `openalex` is "**not** a valid member".
- `docs/07-architecture-and-data-model.md` §7.3 — the shipped policy table has **no
  `api.openalex.org` row**, and `docs/02` §2.4's `BUDGETS` block says the same thing with the reason:
  OpenAlex would be *budget-bound* (a daily USD meter, §9.1) rather than rate-bound, so the row has
  to be designed, not copied.
- `docs/02-literature-database-apis.md` §9.2 — abstracts arrive as an **inverted index** needing
  lossy reconstruction: "Prefer any other source's abstract over OpenAlex's." This is why the
  `docs/02` §10.4 abstract ordering puts OpenAlex last, and why that inert entry must stay last if
  the source is ever adopted.
- `docs/02-literature-database-apis.md` §2.3 and §12.2 "OpenAlex" — the residual v1.1 hooks: an
  OpenAlex key would need a new `SecretId` in `docs/09` §1.7 first, and the query renderer emits **no
  OpenAlex query in v1**.

**Files.**
- create `plan/decisions/D-P2-openalex.md` (the decision record: what was decided, by which
  documents, on what date, and what a v1.1 reversal would cost)
- modify `.github/workflows/ci.yml` (the guard step below)

**Do.**
1. Write `plan/decisions/D-P2-openalex.md` recording the **closed** decision: OpenAlex is out of v1,
   decided in `docs/02` §9.3 on 2026-09-09, on the authority of `docs/00` §3 D2 and `docs/10` §4
   item 10. State that the former §9.3 recommendation is withdrawn, and link the three documents so
   the next reader does not re-litigate it from §9.1/§9.2.
2. Record in the same file what a v1.1 adoption would cost, copied from `docs/02` §9.3's own list so
   the estimate is not a surprise: a new `SecretId` in `docs/09` §1.7, an `openalex.keyPresent` row
   in `docs/07` §8.5, an `api.openalex.org` row in `docs/07` §7.3, a budget-exhausted UI state, and
   asking the user for a **third** API key after Semantic Scholar and their LLM provider — with the
   three document rows going in **before** any code (`docs/07` §11.1 steps 4 and 9).
3. Record why the evaluation is kept rather than deleted (`docs/02` §9.3): §9.1/§9.2 are the only
   place in the corpus that records the February 2026 metering change, the verified per-call prices,
   the two working key-transmission mechanisms, the inverted-index reconstruction, and the fact that
   the `mailto=` polite pool is superseded. That is the evidence a v1.1 decision needs.
4. Add the guard as a CI step: `sources`-membership validation rejects `openalex` at the point the
   preference is read, and a repository grep fails the build if an OpenAlex adapter directory,
   preference row, `SecretId` or `api.openalex.org` policy row appears. Keep the reserved `SourceId`
   member itself out of the grep — it is deliberately present (`docs/07` §5.1).
5. Note in the decision record that the `openalex` `SourceId`, the `OpenAlexId` brand and
   `ExternalIds.openAlexId` are **reserved and must not be reused** for a different source.

**Do NOT.**
- Do **not** implement, scaffold or stub an OpenAlex adapter, and do **not** create
  `src/sources/openalex/`. `docs/07` §2.2's tree carries the explicit "NO `openalex/`" annotation,
  and `README.md` §5 rule 2 forbids widening scope from inside a task.
- Do **not** re-open the decision from `docs/02` §9.1/§9.2. Those sections are retained **v1.1
  research** and §9's own opening line says so: "Nothing in §9.1 or §9.2 authorises building an
  adapter."
- Do **not** delete the `openalex` member from the `SourceId` union, the `OpenAlexId` brand or
  `ExternalIds.openAlexId`. `docs/07` §5.1 keeps them deliberately; removing them frees the id for
  accidental reuse and forces doc 02's mirrored union to diverge.
- Do **not** add an `api.openalex.org` rate-limit row, an OpenAlex `SecretId`, or an
  `openalex.keyPresent` pref. `docs/07` §11.1 step 9 and §11.2 step 5 both say the document row goes
  in **first**, and `docs/07` §8.5 is the complete list of preferences.
- Do **not** accept `openalex` as a member of the `sources` preference, and do **not** render a
  checkbox for it. `docs/07` §8.5: it is "**not** a valid member"; `docs/10` FR-2 has exactly seven
  sources.
- Do **not** emit an OpenAlex query from `P2-T01`'s renderer. `docs/02` §12.2's OpenAlex block is
  headed "v1.1 research — no query is emitted in v1".
- Do **not** delete `docs/02` §10.4's OpenAlex precedence entries or renumber the orderings around
  them. §10.4 says they are **inert in v1** and left in place because they are the ordering a v1.1
  adoption would need; the remaining sources keep their relative order (`P2-T10`).
- Do **not** store an OpenAlex key in a preference (D5) if the source is ever adopted, and do **not**
  put it in a URL query parameter in any logged form — `docs/13` §3.2's redaction strips
  `api_key`/`key`/`token` params from fixtures for exactly this reason.
- Do **not** treat the `mailto=` polite pool as still available — `docs/02` §9.1: it is superseded by
  the metered key.

**Done when.**
- [ ] `plan/decisions/D-P2-openalex.md` exists, is dated, names `docs/02` §9.3 / `docs/00` §3 D2 /
      `docs/10` §4 item 10 as the deciding records, and states the v1.1 reversal cost.
- [ ] A repository grep finds no OpenAlex adapter, preference row, `SecretId` or
      `api.openalex.org` policy row, and the CI step that asserts it fails when one is added
      (verified once, then reverted).
- [ ] Setting the `sources` preference to a list containing `openalex` is rejected with a typed
      error rather than silently registering a source, asserted by a unit test.
- [ ] `06-human-gates.md` needs no new row: this card closes with a decision record, not a gate.

**Verify with.**
```bash
npm run typecheck && test -f plan/decisions/D-P2-openalex.md && \
! grep -rniE "openalex" src/sources/ addon/prefs.js src/core/rateLimit/hostLimiter.ts
```

**Notes.** This card used to be a ship-or-defer gate, because `docs/02` §9.3 recommended shipping
OpenAlex opt-in while `docs/00` §3 D2 and `docs/10` §4 item 10 put it out of v1. **That
contradiction was resolved upstream on 2026-09-09 in favour of "out of v1"**, and §9.3 now carries
the reasoning and the withdrawal. What is left is bookkeeping plus a guard: the decision is worth a
file of its own because the evaluation that argued the other way is still in the corpus, in detail,
and an implementer who reads §9.1/§9.2 without reaching §9.3 will conclude the opposite. The guard is
worth the CI step for the same reason.

---

### P2-T16 — Phase 2 end-to-end run against the definition of done

| Field | Value |
|---|---|
| **ID** | `P2-T16` |
| **State** | `TODO` |
| **Depends on** | `P2-T02`, `P2-T08`, `P2-T09`, `P2-T10`, `P2-T11`, `P2-T12`, `P2-T13`, `P2-T14`, `P2-T17`, `P2-T18` |
| **Blocks** | none |
| **Retires** | `R-2`, `R-18` (closes them), `R-3` (fallback proven) |
| **Implements** | `FR-9`, `FR-50`, `FR-51`, `NFR-2`, `NFR-6` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Every bullet of `docs/11` §1's Phase 2 definition of done is demonstrated by a command that
exits non-zero on failure, and the phase can be signed off.

**Read first.**
- `docs/11-implementation-roadmap.md` §1 Phase 2 "Definition of done" — the four criteria this card
  proves, verbatim.
- `docs/10-requirements-and-user-stories.md` NFR-2 — "A 4-source search returning ≤ 100 results per
  source shall complete in **≤ 30 seconds** wall-clock… with per-source timeouts of 20 s".
- `docs/13-testing-build-and-release.md` §2.2 — the record/replay contract-test transport and its
  four assertions; a missing fixture is a test failure naming the record command, never a live call.
- `docs/13-testing-build-and-release.md` §2.3 — the in-Zotero integration layer, which is where the
  "known cross-indexed paper appears exactly once" assertion has to run.
- `docs/13-testing-build-and-release.md` §4 — the invariant: "no test at any layer performs a live
  network call", except the scheduled `live-contract` job.
- `docs/07-architecture-and-data-model.md` §12.1 — the states the end-to-end run must pass through,
  including `PartialFetch`.
- `docs/13-testing-build-and-release.md` §8.2 "Search and import" — the manual QA checklist items
  this card's automation should reduce.

**Files.**
- create `test/integration/pipeline/searchImportMultiSource.test.ts`
- create `test/fixtures/dedup/cross-indexed-paper/` (one known paper as returned by ≥ 3 sources)
- create `scripts/bench-search.ts`
- modify `package.json` (add the `bench:search` script; `dedup:report` arrives with `P2-T13`)
- modify `.github/workflows/ci.yml`

**Do.**
1. Record the `dedup-pair-set` fixture `docs/13` §3.1 calls "the single most valuable fixture we own":
   one known cross-indexed paper as returned by PubMed, Europe PMC, Crossref, Semantic Scholar and
   (where applicable) arXiv/bioRxiv.
2. Write an in-Zotero integration test that runs a full seven-source search over replayed fixtures
   and asserts the paper appears **exactly once** in the preview, with all contributing sources
   listed in its chips and in `provenance.seenIn`.
3. Write a test in which one source's fixture is a 500 and another's is a 429: assert the other five
   deliver results, the job reaches `PartialFetch`, and both failures appear as status rows.
4. Write `scripts/bench-search.ts` measuring wall-clock for a 4-source search at 100 results per
   source against a replay transport with realistic per-response latency, and assert **≤ 30 s**.
5. Re-run `P2-T13`'s accuracy report and record the final precision/recall numbers in the phase
   sign-off.
6. Assert FR-51 end to end: re-running the same search links to the existing items rather than
   creating duplicates, and reports "linked existing: N".
7. Confirm the plugin still installs and functions with Semantic Scholar unconfigured
   (`docs/11` §0 principle 5).

**Do NOT.**
- Do **not** make any test in this card hit the network. `docs/13` §4 states the invariant across all
  layers; the only exception is the separately-scheduled `live-contract` workflow.
- Do **not** measure NFR-2 with zero-latency fixtures. A replay transport that answers instantly
  proves nothing about a 30-second budget; inject realistic per-host latency, and remember arXiv's
  3-second minimum spacing (`docs/07` §7.3) is a floor no amount of concurrency removes.
- Do **not** relax the ≤ 30 s or the precision ≥ 0.99 assertion to make the suite green
  (`README.md` §5 rule 6). If NFR-2 misses, the fix is planner work — e.g. `docs/02` §12.2's suggestion to
  skip arXiv for queries with no physics/CS relevance — not a looser number.
- Do **not** count `PartialFetch` as a failure in the assertions. `docs/07` §12.1: it is a
  first-class state and "a total failure would be a worse outcome".
- Do **not** sign the phase off with an open human gate unrecorded. The phase DoD in this file
  requires every gate to be closed or explicitly deferred in writing.

**Done when.**
- [ ] The cross-indexed paper appears exactly once, with every contributing source listed.
- [ ] With one source at 500 and one at 429, the other five deliver and the job is `PartialFetch`.
- [ ] `npm run bench:search` reports ≤ 30 s for 4 sources × 100 results and exits 0.
- [ ] `npm run dedup:report` reports precision ≥ 0.99 and recall ≥ 0.90.
- [ ] Re-running the same search creates zero new items and reports "linked existing: N" (FR-51).
- [ ] The XPI builds and installs with `sources` set to a list that excludes `semanticscholar`.
- [ ] Every human gate in this file is closed or recorded as deferred in `06-human-gates.md`.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit && npm run test:contract && npm run test:integration -- --exit-on-finish --abort-on-fail && npm run bench:search && npm run dedup:report && npm run build
```

**Notes.** This card is the phase gate, not new functionality. If it uncovers work, that work becomes
a new `P2-T17`+ card per `README.md` §3, not a silent fix inside this one.

---

## Estimate roll-up

| Task | Title | Estimate (d) |
|---|---|---|
| `P2-T01` | Query parser and per-source render contract | 1.0 |
| `P2-T02` | Parallel fan-out with timeouts and failure isolation | 1.25 |
| `P2-T03` | Europe PMC adapter | 2.0 |
| `P2-T04` | Crossref adapter | 1.5 |
| `P2-T05` | Semantic Scholar adapter + degradation | 2.0 |
| `P2-T06` | arXiv adapter | 1.25 |
| `P2-T07` | bioRxiv / medRxiv adapter | 1.5 |
| `P2-T08` | `preprint` item-type mapping and server attribution | 1.0 |
| `P2-T09` | Deduplication engine | 2.0 |
| `P2-T10` | Field-merge policy and provenance | 1.5 |
| `P2-T11` | Preprint ↔ published-version linking | 1.0 |
| `P2-T12` | Batched abstract backfill | 0.75 |
| `P2-T13` | Dedup corpus and precision/recall report | 2.0 |
| `P2-T14` | UI: source chips, duplicate badges, per-source status | 1.5 |
| `P2-T15` | OpenAlex decision record and guard | 0.25 |
| `P2-T16` | Phase 2 end-to-end verification | 1.0 |
| `P2-T17` | Re-run a search from its provenance record | 1.5 |
| `P2-T18` | Translator import path behind `useTranslators` | 1.25 |
| **Total** | **18 tasks** | **24.25 d** |

**Reconciliation with `docs/11`, revised 2026-09-09 (second pass).** The relationship has been
inverted since the first pass: `docs/11` §1's Phase 2 band is now *derived from* this sum rather
than compared against it. The rule that document states is **low = the card sum, high = the sum ×
1.4, rounded to whole days**, which makes Phase 2 **24.25–34 developer-days**
(24.25 × 1.4 = 33.95 → 34).

Two passes produced that figure:

1. **First pass — the 16 original cards summed to 21.5 d** against the superseded 12–16 d guess,
   **+34 % over the top of the band**, which crossed `README.md` §7's ~30 % threshold. Per that
   rule the response was to re-estimate `docs/11`, not to trim the cards, and that is what
   happened. Where that 21.5 d sat:
   - The adapters landed close to `docs/11`'s own arithmetic: five adapter cards plus the
     preprint-mapping card total **9.25 d** against "six adapters at ~1.5 days each" = 9 d.
     bioRxiv and medRxiv share one adapter (`docs/07` §2.2), so "six adapters" is really five plus
     a two-server split.
   - The dedup family (`P2-T09`, `P2-T10`, `P2-T11`, `P2-T13`) totals **6.5 d** against "4–6 days
     for dedup and its evaluation corpus" — inside that band at the top.
   - The **5.75 d** the old arithmetic did not account for is `P2-T01` (query parser), `P2-T02`
     (fan-out), `P2-T12` (backfill), `P2-T14` (UI) and `P2-T16` (verification) — **5.5 d**, all
     five listed as Phase 2 *deliverables* in `docs/11` §1 and none of them costed — plus
     `P2-T15`'s **0.25 d**, which `docs/11` did not list at the time, because settling the
     OpenAlex question was a corpus contradiction rather than a deliverable.
     9.25 + 6.5 + 5.75 = 21.5. `docs/11` §1's Phase 2 paragraph now names all **eight**
     uncosted cards — `P2-T01`, `P2-T02`, `P2-T12`, `P2-T14`, `P2-T15`, `P2-T16`, `P2-T17`,
     `P2-T18`, summing to the 8.5 d that closes 24.25 − 9.25 − 6.5 — and records that an
     earlier draft named only seven of them (8.25 d), the omission being `P2-T15`. The two
     arithmetics agree: 5.75 d of that 8.5 d is the first pass's shortfall and 2.75 d is the
     second pass's two new cards.
2. **Second pass — `P2-T17` and `P2-T18` add 2.75 d**, taking the sum to **24.25 d**. These are
   the two deliverables `docs/11` §1 listed for Phase 2 with a standing warning that they were
   "not in `plan/03`'s card set" and were not included in the 21.5 d sum: **FR-12's re-run
   control** (1.5 d, `P2-T17`) and the **`useTranslators` Strategy B import path** (1.25 d,
   `P2-T18`). Both are now cards, so the warning is discharged and the band re-derived.

**No existing card's estimate changed in either pass.** The sum moved from 21.5 d to 24.25 d
because the card set grew by two, and for no other reason.

`P2-T17` carries the larger of the two figures because it is the first plugin-owned SQLite write
in the plan: `docs/07` §5.3 makes the `search_provenance` row the authoritative copy of the
provenance record, so FR-12 cannot be built on the Zotero note projection, and `src/zotero/db.ts`
plus a one-table `src/bootstrap/migrations.ts` come with the card. See that card's **Notes** for
what is deliberately left to Phase 3 (the §8.2 capability probe and the `JsonFilePluginStore`
fallback).

## Human gates in this phase

| Card | Gate |
|---|---|
| `P2-T05` | A human enters the approved Semantic Scholar API key. Applied for in Phase 0 (`docs/11` §4.2 V-14); issuance can take weeks (R-3). Phase 2 must not block on it — ship degraded. |
| `P2-T11` | Product-owner decision on `docs/10` §5 open question 2 (preprint vs published: merge or keep both). `docs/11` §5 schedules it **before Phase 2** and names the dedup engine as what it blocks. |
| `P2-T13` | A human hand-labels ≥ 200 record pairs and signs off the measured precision/recall against ≥ 0.99 / ≥ 0.90. |

**Three gates, not five.** [`06-human-gates.md`](06-human-gates.md) already carries all three:
`G-03`/`G-26` (the Semantic Scholar key), `G-16` (the preprint/published merge policy, scheduled
*before* Phase 2) and `G-17` (labelling the dedup corpus). Two gates this file used to list were
**closed upstream on 2026-09-09 and are gone**, which is why `06-human-gates.md` has no row for
either: the `sources` pref default (`docs/07` §8.5 now ships all seven, `docs/08` §4.2 decides how
the two preprint servers render — `P2-T14`) and the OpenAlex question (`docs/02` §9.3 withdrew the
"ship it opt-in" recommendation; OpenAlex is out of v1 — `P2-T15`).

## Contradictions in the design corpus this decomposition surfaced

Eight were recorded; **all eight were closed by the 2026-09-09 documentation pass** and are kept
here, struck through, so that nobody re-opens them from the older text that is still quotable in
places. Item 8 was the last to close, in the pass's second round. `README.md` §5 rule 2 still
forbids settling any of these from inside a task card.

1. ~~**OpenAlex is both in and out of v1** — `docs/02` §9.3 vs `docs/10` §4 item 10 / `docs/00` §3
   D2.~~ **Closed: out of v1.** `docs/02` §9.3 **withdrew** its "ship it opt-in, disabled by
   default" recommendation and now opens "OpenAlex is out of scope for v1. It ships no adapter, no
   preference, no `SecretId` and no rate-limit policy row", keeping §9.1/§9.2 as v1.1 research.
   `docs/07` §5.1 marks the `SourceId` member **reserved, not shipped**, §8.5 makes `openalex` an
   invalid `sources` member, §7.3 has no `api.openalex.org` row, `docs/02` §2.4's `BUDGETS` block
   says the same, and §2.2's tree carries an explicit "NO `openalex/`". `P2-T15` is now the decision
   record plus the guard, not a gate.
2. ~~**The `sources` pref default omits the two preprint servers** — `docs/07` §8.5 vs `docs/10`
   FR-2 and `docs/08` §4.2.~~ **Closed: all seven ship enabled.** `docs/07` §8.5's default is
   `"pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv"` and records that the
   five-source draft "silently dropped both preprint servers". `docs/02` §8.4 and `docs/08` §4.2 add
   the UI half of the decision: the status block renders `⊕ ID lookup · preprint matching` for those
   two — never a count, a spinner or a zero result. `P2-T07` and `P2-T14` implement it; the gate is
   gone.
3. ~~**Two `extra`-field prefixes are specified** — `docs/07` §6.2/§6.3 ships `rh-`; `docs/02` §10.3
   writes `research_helper-`.~~ **Closed: `rh-`.** `docs/02` §10.3 now writes `rh-sources` /
   `rh-work-key` and states that both `research_helper-` spellings "are gone, because two prefixes
   over one field is how an import written by one release becomes invisible to the next". `P2-T08`
   keeps the trap as a trap.
4. ~~**Two title-precedence orders** — `docs/02` §10.4 includes OpenAlex, `docs/07` §5.1 does
   not.~~ **Closed by giving the ordering one owner.** `docs/02` §10.4 is "the corpus's single
   source of per-field source precedence" (§11.5 says so normatively); `docs/07` §5.1 now carries
   only the per-field *combination* rules and defers, noting that an earlier draft restated the
   ordering with a different `title` row. OpenAlex stays in four of §10.4's orderings and is
   declared **inert in v1**. `P2-T10` transcribes it that way.
5. ~~**Two search-window paths** — `docs/08` §4.1 vs `docs/07` §2.2.~~ **Closed:
   `searchDialog.*` under `docs/07` §2.2's tree.** `docs/08` §4.1 now defers to that tree
   (`addon/content/searchDialog.xhtml`, `searchDialog.js`, `src/ui/dialogs/`) and records that the
   `searchWindow.*` draft is withdrawn — "two file-naming conventions for one surface is a defect,
   not a preference" — while the *behaviour* stays a modeless singleton window, which is why the
   entry point is still `openSearchWindow`. The locale layout went with it: per-surface FTL files
   under `research-helper/`, not one flat `research-helper.ftl`. Phase 1 built it that way
   (`P1-T18`–`P1-T22`), and this file's `Files` rows follow Phase 1.
6. ~~**`docs/07` §2.2's fixture-directory list has no `medrxiv/`** and abbreviates
   `semanticscholar/` to `s2/`.~~ **Closed.** The tree now reads `pubmed/ europepmc/ crossref/
   semanticscholar/ arxiv/ biorxiv/ medrxiv/` with the rule stated inline: "one directory per
   `SourceId`, per §11.1 step 5 — **no abbreviations**". `P2-T05` and `P2-T07` use those names.
7. ~~**The `useTranslators` default is settled, but two plan files still record the old one.**~~
   **Closed on both sides.** `docs/07` §8.5 ships it **`false`**, `docs/01` §6.3 and §7.2 agree,
   `docs/10` NFR-1 was re-scoped to exclude the translator path, and both plan files have been
   updated — `plan/00-task-index.md` §5 item 4 and `plan/02` §3, whose scope table now reads
   "Resolved 2026-09-09 … hand-mapping is the default path". `P2-T18` step 1 still re-asserts the
   default in code, because `P1-T03` may have shipped `true` from the old text.
8. ~~**`docs/08` has no surface for FR-12.** §2.5's collection submenu listed three commands —
   Generate Research Trends Report…, Summarize All Papers in Collection, Recommend New Papers
   from This Collection… — and none was "Re-run this search…"; §4.6's window states did not
   include a pre-filled re-run, while `docs/10` FR-12 and `docs/07` §5.3 both require the
   control.~~ **Closed: the surface is now specified.** `docs/08` §2.5's wireframe draws
   **Re-run This Search…** below the submenu separator and states the hidden-not-disabled rule;
   §2.4 registers the `menuitem` with `l10nID: "research-helper-menu-collection-rerun"`, a
   `context.setVisible` guard and `onCommand` → `openSearchWindow({ mode: "rerun", collectionID })`;
   §4.2 lists `rerun` among the mode-chip values; §4.6 draws the **Re-run (pre-filled from
   provenance)** state with its four rules; §10.2 ships the FTL entries in `en-US` and `ko-KR`;
   and §11's States checklist carries the FR-12 line. `docs/10` FR-12 was rewritten to name §2.5
   and §4.6 as the surface and stop restating it. `P2-T17` now implements that specification
   rather than following the shape of neighbouring entries.

# Phase 1 — Keyword → PubMed → Zotero collection

> **Reading order.** [`README.md`](README.md) owns the task-card schema and the
> execution protocol; read it before executing any card here.
> [`docs/11-implementation-roadmap.md`](../docs/11-implementation-roadmap.md) §1
> "Phase 1" owns the phase goal, deliverables, definition of done, effort and
> risks. This file is the executable decomposition of that section and nothing
> more.
>
> **Last updated:** 2026-09-09 · **State:** every task `TODO`; no code written.

---

## 1. Phase goal

A complete, shippable vertical slice: **query → PubMed → preview → Zotero
collection**, with abstracts and provenance. After this phase the plugin does
one real, useful thing end to end, and every piece of core infrastructure that
the remaining six phases stand on (HTTP, rate limiting, cancellation, progress,
the canonical model, the Zotero item mapper) exists and is tested.

**Effort in `docs/11` §1:** **18.75–26 developer-days** — re-derived on
2026-09-09 *from* the card sum below (it was 9–12 d). The reconciliation is
recorded in §7.

**Risks retired** (`docs/11` §1, Phase 1; register in `docs/11` §3):

| Risk | What retires it here |
|---|---|
| `R-16` — Zotero item creation slower than NFR-1 allows | `P1-T14` batches writes in transactions and `P1-T23` measures the 100-item import against NFR-1. |
| `R-17` — abstract coverage is poor | `P1-T10` + `P1-T23` measure the PubMed abstract-coverage percentage on a real query and report it in the import summary. Phase 2 retires the cross-source half. |
| part of `R-2` — literature API terms/endpoints change | `P1-T07` puts PubMed behind `LiteratureSource` so one adapter can be disabled without touching the rest; `P1-T04`/`P1-T05` ship the polite-use identification and conservative limits. |

**Phase 0 dependency.** Every card here assumes Phase 0 has delivered a
building, hot-reloading plugin skeleton that can create one Zotero item, and
that the spike report has answered `V-6`, `V-9`, `V-12`, `V-13`, `V-16` and
`V-17` (`docs/11` §4). Where a card depends on a specific spike answer it says
so in **Notes**. Phase 0 task IDs are `P0-T*` and are owned by
[`01-phase-0-toolchain-spike.md`](01-phase-0-toolchain-spike.md); cards here
name `P0` only in prose, never in **Depends on**, because the Phase 0
decomposition is being written in parallel and its IDs are not yet stable.

---

## 2. Phase definition of done

Verbatim from `docs/11` §1, Phase 1 — a task is not what closes the phase, this
list is:

- [ ] A search for a real term imports ≥ 50 items into a new collection, each
      with a non-empty `abstractNote` where PubMed provides one.
- [ ] NFR-1 measured: 100 pre-fetched records import in ≤ 10 s.
- [ ] Cancel mid-search leaves zero items (FR-10).
- [ ] Provenance note present and JSON export validates against the schema.
- [ ] Re-running the same search links rather than duplicates.

Plus the standing rule from `README.md` §6 and `docs/11` §0 principle 5: **the
plugin is installable and non-broken at the end of the phase.** Nothing
half-built is reachable from a menu.

`P1-T23` is the card that executes this list.

---

## 3. Scope boundaries

Phase 1 is one source and one pipeline. These things are *deliberately not
built here*, each because another phase owns it:

| Not in Phase 1 | Owner | Why it would otherwise leak in |
|---|---|---|
| Six more source adapters, fan-out, deduplication, merge | Phase 2 (`docs/11` §1) | `LiteratureSource` and the registry ship here (`P1-T07`) so Phase 2 is additive, but only `pubmed` is registered. |
| Persistent job queue, `JobRecord`, the `job`/`work`/`source_record`/`cache_entry` tables (`docs/07` §8.3), checkpoint/resume | Phase 3 ("Job engine", `docs/11` §1) | The Phase 1 pipeline runs interactively from the dialog with a `CancellationToken` and a `ProgressReporter`; no `JobQueue` and no `research-helper.sqlite`. `docs/07` §4.5's `JobQueue`/`JobHandle` are **not** implemented here. |
| The `search_provenance` SQLite table (`docs/07` §8.3), which §5.3 makes the *authoritative* copy of the provenance record | Phase 2, card `P2-T17` (`docs/11` §1, Phase 2) | `P2-T17` ships the first plugin-owned SQLite table because FR-12 ("re-run this search") needs the record keyed by collection. Phase 1 therefore holds `SearchProvenance` in memory for the run and emits the two FR-8 surfaces only — the standalone note and the JSON export (`P1-T17`). That is a deliberate, temporary inversion of §5.3's "the note is a projection, never the source"; `P1-T17`'s **Notes** records it. |
| Caching layer (`docs/07` §9) | Phase 3 | `SourceCallContext.bypassCache` is accepted and ignored in Phase 1; document that in the adapter. |
| Preferences pane UI, key-entry UI, `SecretStore` tiers 2 and 3, all LLM/TTS secrets | Phase 3 (`docs/11` §1: "Preferences pane: keys…" and "`SecretStore` tiers 2 and 3, and every key-entry surface") | Not a judgement call any more: `docs/11` §1's Phase 1 deliverable list itself scopes this to "**Tier-1 `SecretStore` for `source.ncbi` only**", with the startup backend probe, the `ncbi.keyPresent` / `secretBackend` flags, and "**no key-entry UI ships in this phase**". `P1-T06` builds exactly that rung and nothing above it. |
| Zotero translator identifier lookup (`docs/01` §6.2, Strategy B) | Phase 2, card `P2-T18` | Resolved 2026-09-09: `useTranslators` now ships **`false`** (`docs/07` §8.5), hand-mapping is the default path, and `docs/11` assigns Strategy B to Phase 2. Phase 1 correctly reads nothing. |
| `preprint` item-type mapping | Phase 2 (`docs/11` §1: "`preprint` item-type mapping for arXiv/bioRxiv/medRxiv") | PubMed returns published records; `P1-T12` maps `journalArticle` and routes every other `WorkType` to `journalArticle` per `docs/07` §6.2. |
| `elink`, `esummary`, PMC ID Converter | Phase 2/Phase 5 | Listed in `docs/02` §3.2 but not in Phase 1's deliverables. `P1-T09`'s **Do NOT** keeps them out. |
| LLM query expansion, relevance screening | Phase 3+ | `docs/02` §12.4's *free* expansion (reading `translationset`) is captured in `P1-T09` for provenance only; no LLM call exists in Phase 1. |

---

## 4. Conflicts in the corpus, and how each was settled

Eight review rounds left a handful of places where two documents disagreed.
The 2026-09-09 documentation pass closed all of them upstream; the rows below
are kept, struck through, because the cards that hit them still carry the
reasoning and an implementer needs to know the question was asked and answered.
**Every conflict in this table is now closed.** `C9` and `C10` were found in this
review round and were closed upstream by the second 2026-09-09 documentation
pass, in both cases confirming the provisional resolution the cards were already
written against, so no card changed behaviour. `C7` was never a conflict and is
kept as an implementation instruction.

| # | Conflict | Resolution |
|---|---|---|
| **C1** | ~~`docs/07` §6.1/§6.3 write plugin `extra` lines as `rh-work-key:` / `rh-sources:`; `docs/02` §10.3 writes them as `research_helper-key:` / `research_helper-sources:`.~~ | **Resolved upstream 2026-09-09.** `docs/02` §10.3 now writes `rh-sources:` / `rh-work-key:` and opens with "**The plugin's `extra` prefix is `rh-`, and `07-…` §6.3 owns it**", recording that both `research_helper-` spellings "are gone, because two prefixes over one field is how an import written by one release becomes invisible to the next". `docs/07` §6.3 is the single contract. `P1-T12` uses it. |
| **C2** | ~~`docs/10` FR-6 required PMID/PMCID in `Extra` as `PMID: 12345678`; `docs/07` §6.1 and `docs/02` §10.3 say `PMID`/`PMCID` are **native fields** on `journalArticle` in schema 42.~~ | **Resolved upstream 2026-09-09.** FR-6 now requires the native `PMID`/`PMCID` fields for `journalArticle` and "**not** in `Extra`", and keeps the ecosystem-standard `Extra` line only for item types with no native field (`preprint`, `conferencePaper`, arXiv IDs outside `preprint`). That is exactly what `P1-T12` builds; nothing is superseded any more. |
| **C3** | ~~`docs/07` §2.2, `docs/08` §4.1/§4.1.1/§10.1 and `docs/01` §9.1 disagreed on the search surface's file names and locale layout.~~ | **Resolved upstream 2026-09-09.** The docs were aligned on `searchDialog.*` under `docs/07` §2.2's tree, with the per-surface FTL subfolder layout. The entry-point function stays `openSearchWindow` because the surface is a modeless window, not a modal dialog — `docs/08` §4.1 now says so, and it heads its own code block `src/ui/dialogs/searchDialog.ts`, so the **module** is named for the surface even though the **function** is not. Cards `P1-T18`–`P1-T22` use the aligned names. |
| **C4** | ~~`docs/01` §6.3 makes translator lookup the *preferred* import path and `docs/07` §8.5 shipped `useTranslators` defaulting `true`, yet `docs/11`'s Phase 1 deliverables named only the hand-mapped importer and NFR-1 is unreachable through per-item network lookup.~~ | **Resolved upstream 2026-09-09.** The default was changed to **`false`**, `docs/01` §6.3 now makes hand-mapping (Strategy A) the default path and translator lookup (Strategy B) the opt-in, NFR-1's applicability was re-scoped so the slow path is not held to the fast path's target, and `docs/11` gives Phase 2 the job of honouring the pref (`P2-T18`). Phase 1 still ships hand-mapping only. |
| **C5** | ~~`docs/01` §8.1 advised letting `Zotero.HTTP.request` do the retrying (`errorDelayMax: 60000`); `docs/07` §7.4 explicitly disables it (`noRetryOnThrottle: true`, `errorDelayMax: 0`, `successCodes: false`) so retries stay visible to the per-host limiter.~~ | **Resolved upstream 2026-09-09.** `docs/01` §8.1 now states the same three overrides, names `docs/07` §7.4 as their owner, puts all 429/5xx handling in `src/core/rateLimit/` and `src/core/http/retry.ts`, and records that "an earlier draft of this section advised exactly that, with `errorDelayMax: 60000`". `P1-T05` implements the shared answer. |
| **C6** | ~~`docs/11` and `docs/13` §2.1 named `src/core/http.ts`, `src/core/rateLimiter.ts`, `src/platform/`; `docs/07` §2.2's tree had `src/core/http/client.ts`, `src/core/rateLimit/tokenBucket.ts` and no provenance module at all.~~ | **Resolved upstream 2026-09-09.** `docs/07` §2.2 now declares `src/core/provenance.ts` ("pure, imports only `model/` — satisfies §2.3") and the top-level `schema/provenance.schema.json`; `docs/13` §2.1 opens with "Module paths below are `07-…` §2.2's" and names the flattened invented paths as the earlier draft's defect; `docs/11` §1 says the same. One tree, and it is §2.2's. `P1-T17`. |
| **C7** | FR-10 and `docs/11`'s DoD say cancel leaves **zero items**; `docs/07` §7.4 says `searchImport` cancellation **keeps** items already written. | Not actually a conflict, and must be implemented as stated: cancel during *fetching* or from the preview table creates nothing (FR-5, FR-10); cancel during *writing* keeps what is already committed and annotates the collection (`docs/07` §7.4). `P1-T16`, `P1-T22`. |
| **C8** | ~~FR-8 requires the provenance JSON to validate "against the documented schema"; **no document declares that schema.**~~ | **Resolved upstream 2026-09-09.** `docs/07` §5.3 "Search provenance" now declares `SearchProvenance` and `SourceProvenance`, ships `schema/provenance.schema.json` as the artefact (§2.2), and names the `search_provenance` table (§8.3) as the authoritative store; FR-8 now points at §5.3 and keeps only the field list. `P1-T17` **implements** that declaration and no longer invents one. |
| **C9** | ~~`docs/02` §11.1 says to store "the **first-seen original form**" of a DOI "for display and writing to Zotero", using the lowercased form only as a dictionary key. But `docs/07` §5.1 types `ExternalIds.doi` as the branded `Doi` — commented *"lowercase, no prefix"* — with **no field for an original form**, §6.2 maps `ids.doi` straight to Zotero's `DOI`, and `docs/10` FR-6 requires the field be "set in normalized lowercase form".~~ | **Resolved upstream 2026-09-09.** `docs/02` §11.1 **withdrew** the instruction: it now says "**This does not mean the plugin keeps a second spelling. `normalizeDoi()`'s lowercase output is the only DOI the plugin stores, displays, or writes to Zotero**", names the earlier "store the first-seen original form" draft as withdrawn "because there is nowhere to put it", and cites the same three requirements — `docs/07` §5.1's brand, §6.2's mapping and FR-6 — as the reason. The case-sensitivity caution is kept as a caution and no longer as an instruction. That is exactly what `P1-T01` and `P1-T12` build. |
| **C10** | ~~The default recency window has two different definitions. `docs/10` FR-3 said "the last 3 calendar years (**rolling from today**)" and worked its acceptance criterion as *"today is 2026-09-08 … the effective lower bound is 2023-09-08"* — a rolling 36 months. `docs/08` §4.2 computes `fromYear = currentYear - 2` and labels the span `2024 – 2026` — three whole calendar years, a window ~8 months wider. No document declared precedence between them.~~ | **Resolved upstream 2026-09-09, in favour of the calendar-year window — the provisional resolution these cards were already written against.** FR-3 was rewritten to "the last 3 **calendar** years — the current year and the two years before it", records the project owner's decision, works its acceptance criterion as `2024-01-01 … 2026-12-31`, and defers the computation to `docs/08` §4.2 outright; `docs/02` gained **§2.0** declaring the same window and naming §4.2 as its owner, reversed §4.3's `FIRST_PDATE` advice to the calendar form (`PUB_YEAR:[2024 TO 2026]`, `FIRST_PDATE` only for an explicit custom range), and moved all seven of §12.2's rendered queries onto `2024-01-01 … 2026-12-31`. `docs/10` §5 question 1 records the width as decided and leaves only hard-versus-soft open (gate `G-13`). No card changed: `P1-T07`, `P1-T08` and `P1-T20` already ship §4.2's window, and §8's FR-3 asterisk is discharged. |

---

## 5. Dependency graph

```
T01 model ──┬─ T02 core primitives ─┬─ T03 prefs ─┬─ T04 rateLimit ─┐
            │                       │             │                 │
            │                       │             └─ T06 secrets ───┤
            │                       │                               │
            │                       └───────────────────────────────┴─ T05 http
            │                                                            │
            ├─ T07 LiteratureSource + registry ──┬─ T08 query ───────────┤
            │                                    ├─ T09 adapter ─────────┘
            │                                    └─ T10 mapper ─ T11 fixtures
            │
            ├─ T12 itemMapper ─┬─ T13 existing-item detection ─┐
            │                  └─ T14 importer ────────────────┤
            │                                                  │
            └─ T15 progress ───────────────────────────────────┴─ T16 pipeline
                                                                     │
       T17 provenance (after T09, T14) ──────────────────────────────┤
       T18 l10n ─── T19 menus ─── T20 window ─── T21 table ─── T22 wiring
                                                                     │
                                                              T23 phase DoD
```

The **Depends on** / **Blocks** fields on the cards are authoritative and are
mutually consistent; this diagram is a reading aid.

---

## 6. Task cards

### P1-T01 — Declare the canonical model and identifier normalizers

| Field | Value |
|---|---|
| **ID** | `P1-T01` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P1-T02`, `P1-T07`, `P1-T10`, `P1-T12`, `P1-T13`, `P2-T09` |
| **Retires** | none |
| **Implements** | part of `FR-6`, part of `FR-7` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** `CanonicalWork` and every type it references exist as compiling
TypeScript, and a DOI/PMID/PMCID from any upstream spelling normalizes to one
canonical branded value.

**Read first.**
- `docs/07-architecture-and-data-model.md` §5.1 — the **sole** authoritative
  declaration of `Doi`/`Pmid`/`Pmcid`/`ArxivId`, `SourceId`, `ExternalIds`,
  `Author`, `WorkType`, `PartialDate`, `OpenAccessInfo`, `CanonicalWork`,
  `Subject`, `WorkProvenance`, `SourceRecord`. Copy these verbatim.
- `docs/07-architecture-and-data-model.md` §2.3 — the dependency rule that puts
  `SourceId` in `model/ids.ts` rather than in `sources/types.ts`, and forbids
  `model/` from importing anything.
- `docs/02-literature-database-apis.md` §11.1 — the `normalizeDoi` reference
  implementation and the real upstream spellings it has to survive, plus its
  closing rule: "**`normalizeDoi()`'s lowercase output is the only DOI the plugin
  stores, displays, or writes to Zotero**". The "store the first-seen original
  form" instruction an earlier draft carried is **withdrawn** (closed conflict
  `C9`, §4); `docs/07` §5.1 brands `Doi` lowercase and gives `ExternalIds`
  nowhere to keep a second form.
- `docs/00-overview.md` §3, D2 — the closed list of v1 sources, which is why the
  `SourceId` union has exactly those members.

**Files.**
- create `src/model/ids.ts`
- create `src/model/canonicalWork.ts`
- create `src/model/sourceRecord.ts`
- create `test/unit/model/ids.test.ts`
- create `test/unit/model/canonicalWork.test.ts`

**Do.**
1. Transcribe `docs/07` §5.1's three blocks into the three files, unchanged.
   Keep the doc comments — they carry the invariants.
2. Implement `normalizeDoi` from `docs/02` §11.1 exactly, returning `Doi | null`.
3. Implement `normalizePmid` (digits only) and `normalizePmcid` (`PMC` + digits,
   adding the `PMC` prefix when the source omitted it, per `docs/02` §10.2's
   Semantic Scholar row) as the same shape.
4. Implement `buildWorkKey(ids, title, year, firstAuthor)` producing the first
   available of `doi:<doi>` | `pmid:<pmid>` | `arxiv:<id>` | `s2:<corpusId>` |
   `hash:<sha1(title|year|firstAuthor)>`, exactly as `docs/07` §5.1's
   `workKey` doc comment specifies.
5. Export type guards (`isCanonicalWork`) used by the mapper tests.
6. Unit-test every branch of `normalizeDoi` against the three real cases named
   in `docs/02` §11.1 plus an unparseable input.

**Do NOT.**
- Do **not** declare a second `QueryNode`, `QueryField`, `WorkType` or
  `CanonicalRecord`. `docs/02` §10.1 and §12.1 both carry explicit "doc 07 wins"
  notes over deliberately divergent working-name sketches; typing from those
  blocks builds a parallel, wrong type system (`README.md` §5 rule 3).
- Do **not** uppercase or otherwise "prettify" a DOI, and do **not** add a
  second "original spelling" field to `ExternalIds`. `docs/07` §5.1 brands
  `Doi` as *"lowercase, no prefix"*, `ExternalIds` has no such field, FR-6
  requires the lowercase form in Zotero's `DOI`, and `docs/02` §11.1 now says the
  same in its own words. This was conflict **C9** in §4 and is closed; the
  case-sensitivity caution that remains in §11.1 is a caution, not an
  instruction to widen the model.
- Do **not** import anything from `core/`, `sources/` or `zotero/` here —
  `docs/07` §2.3: `model/` imports nothing but itself.
- Do **not** add a `preprint`-specific field or an `epmc` id; those belong to
  Phase 2 sources and `docs/07` §5.1 already fixes the `ExternalIds` shape.

**Done when.**
- [ ] `normalizeDoi("https://doi.org/10.1056/NEJMoa2300709")` ===
      `"10.1056/nejmoa2300709"`, and `normalizeDoi("not a doi")` === `null`.
- [ ] `normalizePmcid("7605294")` === `"PMC7605294"`.
- [ ] `buildWorkKey` prefers DOI over PMID over the title hash, asserted.
- [ ] Every field name in `src/model/canonicalWork.ts` matches `docs/07` §5.1
      character-for-character (reviewed by diff, not by memory).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- model
```

**Notes.** This card is pure transcription plus two small functions, and it is
first because five other cards import from it. `sha1` must come from a
dependency-free implementation or from `crypto.subtle` behind an injected port —
`docs/07` §2.3 forbids `model/` reaching for a platform global, so if a hash
needs a platform API, take it as an argument rather than importing one.

---

### P1-T02 — Core primitives: cancellation, clock, errors, logger

| Field | Value |
|---|---|
| **ID** | `P1-T02` |
| **State** | `TODO` |
| **Depends on** | `P1-T01` |
| **Blocks** | `P1-T03`, `P1-T04`, `P1-T05`, `P1-T15`, `P1-T18` |
| **Retires** | none |
| **Implements** | `FR-10`, part of `FR-54`, `NFR-14`, part of `NFR-16` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Cooperative cancellation, an injectable clock, the typed error
hierarchy and a redacting logger exist, so that every later card can throw a
classified error and honour a cancel.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.1 — the exact `CancellationToken`,
  `CancellationReason` and `CancellationTokenSource` interfaces to implement,
  including the `signal: AbortSignal` interop member.
- `docs/07-architecture-and-data-model.md` §10.1 — the complete typed error
  hierarchy: base class shape, `code`/`messageKey`/`retryable`/`userFacing`, and
  every subclass Phase 1 throws (`NetworkError`, `OfflineError`, `TimeoutError`,
  `AuthenticationError`, `AuthorizationError`, `RateLimitError`,
  `UpstreamServerError`, `BadRequestError`, `SourceError`, `ParseError`,
  `ZoteroApiError`, `OperationCancelledError`) — `AuthorizationError` is the 403
  arm `P1-T05` maps onto. Also `SerializedError`, the `toSerialized()` return
  shape, which `P1-T17`'s `SourceProvenance.error` field stores.
- `docs/07-architecture-and-data-model.md` §10.3 — what structured logging must
  emit and the fact that redaction runs *at the logger*, unconditionally.
- `docs/09-security-privacy-and-api-keys.md` §2.1 — the `KEYISH_FIELD` /
  `KEY_PATTERNS` redaction rules the logger enforces; NFR-16 hangs on this.
- `docs/07-architecture-and-data-model.md` §7.4 — the four places cancellation is
  checked, which is what makes the token's `onCancelled` contract necessary.
- `docs/10-requirements-and-user-stories.md` NFR-14 — "no bare 'An error
  occurred'": every error carries a `messageKey`, never an English sentence.

**Files.**
- create `src/core/jobQueue/cancellation.ts`
- create `src/core/clock.ts`
- create `src/core/errors.ts`
- create `src/core/logger.ts`
- create `src/core/result.ts`
- create `src/core/concurrency.ts`
- create `test/unit/core/cancellation.test.ts`
- create `test/unit/core/errors.test.ts`
- create `test/unit/core/logger-redaction.test.ts`

**Do.**
1. Implement `CancellationTokenSource` / `CancellationToken` per `docs/07` §4.1,
   backed by an internal `AbortController` so `token.signal` is real.
2. `throwIfCancelled()` throws `OperationCancelledError` carrying the
   `CancellationReason` — same object, not a copy.
3. Implement `Clock` as `{ now(): number; sleep(ms, token?): Promise<void> }`
   with a test double; `docs/07` §7.3's `TokenBucket` takes it as a constructor
   argument, so its shape is fixed by that call site.
4. Transcribe `docs/07` §10.1 in full. Implement `redact()` and `redactUrl()`
   from `docs/09` §2.1's patterns; `toSerialized()` must already be redacted.
5. Implement `Logger` with levels from the `logLevel` pref values
   (`error|warn|info|debug`, `docs/07` §8.5) writing through `Zotero.debug` —
   but take the sink as an injected port so `core/` stays Zotero-free
   (`docs/07` §2.3).
6. Implement `mapWithConcurrency` and `Semaphore` in `concurrency.ts`; the
   `network-metadata` pool of 4 (`docs/07` §7.2) is expressed with them.

**Do NOT.**
- Do **not** import `Zotero.*` anywhere under `src/core/` — `docs/07` §2.3 makes
  `src/zotero/` the only directory allowed to, and ~80% of the codebase is
  runnable under `vitest` only because of that rule.
- Do **not** put an English sentence in a user-facing error. `docs/07` §10.1
  requires a Fluent `messageKey`; a raw string here becomes an unlocalizable
  string in the UI and silently breaks FR-55/NFR-11.
- Do **not** make redaction conditional on `logLevel` or on `logRequestBodies`.
  `docs/10` FR-54 is explicit: **there is no preference that unlocks keys**
  (D5), and `logRequestBodies` is a content switch, not a verbosity one.
- Do **not** implement `JobQueue`, `JobHandle`, `JobRecord` or the persistent
  store from `docs/07` §4.5/§7.6. Phase 3 owns the job engine (`docs/11` §1);
  building it here is out-of-scope work that Phase 3 would rewrite.
- Do **not** treat `OperationCancelledError` as user-facing — `docs/07` §10.1
  sets `userFacing = false` on it deliberately; a cancel toast that reads like a
  failure is a documented UX defect.

**Done when.**
- [ ] A token cancelled while a `clock.sleep` is pending rejects that sleep with
      `OperationCancelledError` within one tick.
- [ ] `token.signal.aborted` becomes `true` when `cancel()` is called.
- [ ] Every class in `docs/07` §10.1 that Phase 1 uses exists with the exact
      `code` string from that section.
- [ ] A logger call carrying `{ api_key: "abc123", url: "…?api_key=abc123" }`
      emits neither occurrence of the secret, at every level including `debug`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- core
```

**Notes.** Spike `V-9` (`docs/11` §4.2) confirms request abortion actually
works; if the spike report says it does not, `P1-T05` needs a different
mechanism and this card's `signal` member becomes decoration — check the report
before building on it. The full `docs/07` §10.1 hierarchy is transcribed now
rather than grown incrementally, because Phase 3's `LLMError` subtree is already
in it and a partial copy diverges.

---

### P1-T03 — Typed preference schema, `PrefStore` port, `prefs.js` rows

| Field | Value |
|---|---|
| **ID** | `P1-T03` |
| **State** | `TODO` |
| **Depends on** | `P1-T02` |
| **Blocks** | `P1-T04`, `P1-T05`, `P1-T06`, `P1-T20` |
| **Retires** | none |
| **Implements** | part of `FR-3`, part of `FR-11`, part of `NFR-16` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Every preference Phase 1 reads has exactly one declaration, is typed,
is coerced on read, and no code path can write a secret to it.

**Read first.**
- `docs/07-architecture-and-data-model.md` §8.5 — **authoritative for every key,
  type, default and allowed-value set.** Phase 1 needs the "Sources & search"
  block (`sources`, `searchYears`, `maxResults`, `useTranslators`,
  `hideExisting`, `contactEmail`), plus `timeoutSeconds`, `logLevel`,
  `logRequestBodies`, `ncbi.keyPresent`, `secretBackend`, `prefsSchemaVersion`.
- `docs/07-architecture-and-data-model.md` §8.5.1 — the two call conventions
  (branch-relative from plugin code, fully qualified in markup and `prefs.js`),
  the `PrefDef` shape, and the `coerce()` foot-gun: the pane's `preference=`
  binding stringifies numbers on the way out.
- `docs/07-architecture-and-data-model.md` §8.5.2 — the "deliberately not a
  preference" table; it is the spec for the D5 unit test.
- `docs/01-zotero-plugin-platform.md` §7.1 — the pref branch
  `extensions.zotero.research-helper.` and why it nests under Zotero's own.
- `docs/01-zotero-plugin-platform.md` §7.2 — the literal `prefs.js` file that
  must stay byte-consistent with `docs/07` §8.5's defaults.
- `docs/13-testing-build-and-release.md` §1.4 — the scaffold prefixes keys in
  `prefs.js` at build time, so source files may carry bare keys.

**Files.**
- create `src/prefs/schema.ts`
- create `src/prefs/keys.ts`
- create `src/prefs/index.ts`
- create `src/core/config.ts`
- create `src/zotero/prefStore.ts`
- modify `addon/prefs.js`
- create `test/unit/prefs/schema.test.ts`

**Do.**
1. Write one `PREFS` entry per §8.5 row that Phase 1 reads, using `docs/07`
   §8.5.1's `PrefDef` shape verbatim, including `min`/`max`/`values`.
2. Implement `getPref`/`setPref`/`clearPref`/`observePref` exactly as
   §8.5.1 sketches them, with `coerce()` routing every `integer`/`number`
   through `Number()` and checking it against the declared `min`/`max`.
3. `getPref` must never throw, and it does **not** clamp: §8.5.1's `coerce()`
   returns "the schema default when the value is absent, the wrong type, **or
   out of range**". A stored `searchYears` of `99` yields `3`, not `20`.
4. Declare the `PrefStore` port in `src/core/config.ts` and implement it in
   `src/zotero/prefStore.ts` over `Zotero.Prefs`, so `core/` stays Zotero-free.
5. Add the `pref()` lines to `addon/prefs.js` for exactly the Phase 1 keys, with
   `docs/07` §8.5's defaults.
6. Write the D5 test required by `docs/09` §1.7 and `docs/07` §8.5: assert that
   no `secret: true` entry is reachable from `setPref`, and that no key in
   `PREFS` matches `/apikey|api_key|\.key$/i`.

**Do NOT.**
- Do **not** add a preference that `docs/07` §8.5 does not declare, and do not
  change a default. §8.5 says it plainly: add the preference there first, then
  to `prefs.js`, then to the pane.
- Do **not** create a `debug` boolean. §8.5's Diagnostics block records that an
  earlier draft shipped one and that it was removed: two switches over one
  logger is exactly how a checkbox and a level drift apart.
- Do **not** name the contact-address pref `ncbi.email` or wire it to NCBI.
  `docs/02` §2.2 calls that naming "actively misleading" — NCBI is the one host
  that ignores it (D10). It fills Crossref's `mailto` only, which Phase 2 uses.
- Do **not** call `Zotero.Prefs` from anywhere but `src/zotero/prefStore.ts`
  (§8.5.1: "plugin code never calls `Zotero.Prefs` directly").
- Do **not** do string arithmetic on `maxResults` or `searchYears`. §8.5.1 names
  this as "a classic and very confusing bug".

**Done when.**
- [ ] `getPref("maxResults")` returns `100` as a `number` when the stored value
      is the string `"100"`.
- [ ] `getPref("searchYears")` returns the default `3` when the stored value is
      `"abc"`, `0`, or `99`.
- [ ] The D5 test fails if a `secret: true` entry is added with a writer.
- [ ] Every `pref()` line in `addon/prefs.js` has a matching `PREFS` entry and
      an identical default, asserted by a test that reads both.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- prefs
```

**Notes.** `prefsSchemaVersion` ships at `0` and no migration entry exists yet —
`docs/07` §8.5.3 is explicit that renames applied *before* first release need no
migration entry, only document updates.

---

### P1-T04 — Per-host token-bucket rate limiter and backoff

| Field | Value |
|---|---|
| **ID** | `P1-T04` |
| **State** | `TODO` |
| **Depends on** | `P1-T02`, `P1-T03` |
| **Blocks** | `P1-T05`, `P2-T02` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-11`, `NFR-6` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** One shared token bucket per host paces every outbound request, a 429
parks every waiter on that host, and the NCBI budget changes when a key appears.

**Read first.**
- `docs/07-architecture-and-data-model.md` §7.3 — **the authority for every
  rate-limit number and for the retry shape.** It gives the `TokenBucket` class
  skeleton, the policy table (NCBI: no-key vs. with-key rate, burst, max
  concurrent), the 429/`Retry-After` → `penalize()` rule, and decorrelated
  jitter `sleep = min(cap, random(base, prev*3))`.
- `docs/07-architecture-and-data-model.md` §4.1 — the `RateLimiter`,
  `RateLimiterConfig` and `RateLimiterStats` interfaces to implement, including
  `reconfigure()` ("e.g. after the user enters an NCBI API key") and the
  cancellable `acquire(cost, token)`.
- `docs/02-literature-database-apis.md` §2.4 — the documented upstream limits
  these enforcement values sit below, the "never retry a 400 or a 404" rule, and
  the explicit instruction not to implement a second backoff shape.
- `docs/02-literature-database-apis.md` §3.1 — NCBI's published 3/s and 10/s
  figures, and the live-verified `X-Ratelimit-Limit` / `X-Ratelimit-Remaining`
  response headers the governor should read rather than assume.
- `docs/07-architecture-and-data-model.md` §7.2 — the three worker pools;
  `network-metadata` is 4 and is **not** user-configurable.

**Files.**
- create `src/core/rateLimit/tokenBucket.ts`
- create `src/core/rateLimit/hostLimiter.ts`
- create `src/core/rateLimit/backoff.ts`
- create `test/unit/core/tokenBucket.test.ts`
- create `test/unit/core/backoff.test.ts`

**Do.**
1. Implement `TokenBucket` from `docs/07` §7.3's skeleton, taking `Clock` from
   `P1-T02` so tests use fake time.
2. `acquire(cost, token)` must reject with `OperationCancelledError` while
   waiting — `docs/07` §7.4 point 2 makes this one of the four cancellation
   checkpoints.
3. Implement `penalize(untilEpochMs, reason)` so it parks *all* waiters on the
   key, not just the caller's.
4. Implement `hostLimiter.ts` as a process-wide registry keyed by host, seeded
   from `docs/07` §7.3's policy table. Phase 1 registers only the
   `eutils.ncbi.nlm.nih.gov` row; leave the table shape ready for Phase 2 rows.
5. Wire the with-key/no-key switch: read `ncbi.keyPresent` (`P1-T03`) at
   registry construction and call `reconfigure()` when it changes.
6. Implement `backoff.ts`: `parseRetryAfter(headerValue)` handling both the
   delta-seconds and the HTTP-date forms, and `decorrelatedJitter(prev, base,
   cap)` exactly as §7.3 writes it, with a per-host attempt cap.
7. Test under fake timers: sustained rate, burst depth, `minIntervalMs`,
   cancellation while queued, `penalize` releasing at the deadline, and jitter
   bounds.

**Do NOT.**
- Do **not** invent, round, or "tune" a rate number. `docs/07` §7.3 owns them and
  `README.md` §5 rule 4 forbids hardcoding a limit anywhere else; `docs/02` §2.4
  carries a `NOT AUTHORITATIVE` banner over its own copy for exactly this reason.
- Do **not** create a limiter per adapter instance or per job. `docs/07` §7.3
  opens with the reason: two concurrent jobs would each get a full budget and
  together exceed the policy.
- Do **not** implement a second backoff in the HTTP layer or in the adapter.
  `docs/02` §2.4 defers the shape to `docs/07` §7.3 explicitly.
- Do **not** retry a 400 or a 404. `docs/02` §2.4: a 400 is a query bug, and
  PubMed returns query errors *inside* an HTTP 200 anyway (`P1-T09`).
- Do **not** make the NCBI bucket 3/s or 10/s. `docs/07` §7.3 sits deliberately
  below the published figures for clock-skew headroom.

**Done when.**
- [ ] Under a fake clock, 20 `acquire()` calls against the no-key NCBI config
      complete in the wall time §7.3's rate implies, ±1 tick.
- [ ] A `penalize(now + 5000)` call blocks a waiter for 5 s and releases it.
- [ ] `acquire()` on a cancelled token rejects with `OperationCancelledError`
      and does not consume a token.
- [ ] `reconfigure()` with the with-key config raises throughput without
      dropping queued waiters.
- [ ] `parseRetryAfter("120")` and `parseRetryAfter("<an HTTP-date>")` both
      yield the right millisecond delta.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- tokenBucket backoff
```

**Notes.** `docs/07` §7.3 also notes NCBI's own guidance to schedule large jobs
off-peak (weekends, or 21:00–05:00 US Eastern). Phase 1 does not schedule
anything, but do not delete that note when you copy the table — Phase 2's
fan-out will want it.

---

### P1-T05 — HTTP client over `Zotero.HTTP.request`

| Field | Value |
|---|---|
| **ID** | `P1-T05` |
| **State** | `TODO` |
| **Depends on** | `P1-T02`, `P1-T03`, `P1-T04` |
| **Blocks** | `P1-T09`, `P1-T11` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-11`, `FR-9`, part of `FR-10`, `NFR-9`, part of `NFR-16` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** One outbound choke point that paces through the limiter, identifies
the plugin per D10, cancels for real, classifies every failure into the §10.1
taxonomy, and can be swapped for a replay transport in tests.

**Read first.**
- `docs/07-architecture-and-data-model.md` §7.4 — the `HttpClient.request`
  excerpt: the exact option set (`responseType`, `timeout`, `successCodes:
  false`, `noRetryOnThrottle: true`, `errorDelayMax: 0`, `cancellerReceiver`),
  and the two paragraphs explaining why Zotero's own retry machinery is
  disabled. Also the verified note that `responseType` is passed straight to XHR
  and is not validated.
- `docs/01-zotero-plugin-platform.md` §8.1 — the full option table and the
  exception classes (`UnexpectedStatusException`, `TimeoutException`,
  `BrowserOfflineException`, `SecurityException`, `CancelledException`) that
  must be mapped, plus the 30 000 ms default `timeout` and `anon`.
- `docs/02-literature-database-apis.md` §2.2 — the exact `User-Agent` string and
  the per-host contact-parameter assignment table (D10).
- `docs/00-overview.md` §3, D10 — why the maintainer address, and only the
  maintainer address, goes to NCBI.
- `docs/07-architecture-and-data-model.md` §10.1 — the error classes this maps
  onto (`AuthenticationError` 401, `AuthorizationError` 403, `RateLimitError`
  429, `UpstreamServerError` 5xx, `BadRequestError` other 4xx, `TimeoutError`,
  `OfflineError`).
- `docs/13-testing-build-and-release.md` §2.2 — the requirement that this module
  be *the single outbound choke point*, replaceable by a replay transport.
- `docs/07-architecture-and-data-model.md` §8.5, `timeoutSeconds` row —
  `timeoutSeconds × 1000` is the `timeout` passed to `Zotero.HTTP.request`.

**Files.**
- create `src/core/http/client.ts`
- create `src/core/http/retry.ts`
- create `src/core/http/userAgent.ts`
- create `src/zotero/zoteroApi.ts`
- create `test/unit/core/http-client.test.ts`
- create `test/unit/core/userAgent.test.ts`

**Do.**
1. Declare `HttpClient`, `HttpOptions`, `HttpResponse`, the `httpRequest(req)`
   entry point `docs/13` §2.2 names, and a `Transport` port in
   `client.ts`; `core/` must not name `Zotero`, so the actual
   `Zotero.HTTP.request` call lives behind the port implemented in
   `src/zotero/zoteroApi.ts`.
2. Implement the request path exactly as `docs/07` §7.4's excerpt: acquire from
   the host limiter first, then issue, with `cancellerReceiver` wired to
   `token.onCancelled` and the unsubscribe in a `finally`.
3. Build the `User-Agent` in `userAgent.ts` from `docs/02` §2.2's literal string
   with the version substituted at build time; export a per-host contact-param
   function returning `{ tool, email }` for NCBI per D10.
4. Classify responses: on 429/503 read `Retry-After`, call
   `limiter.penalize(...)`, throw `RateLimitError`; map the rest per `docs/07`
   §10.1. Retry only retryable classes, using `P1-T04`'s jitter and cap.
5. Set `timeout` from the `timeoutSeconds` pref × 1000, `anon: true`, and
   `responseType` from the caller (PubMed `efetch` needs `"text"` so the XML is
   parsed by our own `DOMParser`, not by XHR's `document` handling).
6. Log every request at `info` as `{ method, host, path, status, ms }` with the
   URL redacted through `P1-T02`'s `redactUrl`.

**Do NOT.**
- Do **not** leave `Zotero.HTTP.request`'s retry machinery on. `docs/07` §7.4:
  a retry that happens *below* the token bucket is a retry the rate limiter
  cannot see or pace, and `errorDelayMax` defaults to **one hour**, invisible to
  cancellation. `docs/01` §8.1 now says the same and names §7.4 as the owner
  (conflict C5, closed) — but note that §8.1's own worked sketch deliberately
  leaves `successCodes` on, so do not copy that sketch wholesale.
- Do **not** leave `timeout` at Zotero's 30 000 ms default and do **not** hardcode
  60 000. Read `timeoutSeconds` (`docs/07` §8.5). Pass `0` only where a
  deliberately unbounded progressive read is needed, and never for a metadata
  call.
- Do **not** put a user's e-mail in NCBI's `tool`/`email`. D10 and NBK25497
  require the *developer's* address, "not that of a third-party end user"; the
  `contactEmail` pref must not reach `eutils.ncbi.nlm.nih.gov` at all.
- Do **not** ship an unsubstituted `User-Agent` placeholder. `docs/02` §2.2: the
  build must **fail** rather than ship one.
- Do **not** call `Zotero.HTTP.request` from a dialog document. `docs/01` §8.3
  warns that `fetch()`/XHR from an XHTML document may re-enter a CORS-checked
  context; do all network I/O in the privileged sandbox and pass results in.
- Do **not** use `successCodes`' default. `docs/07` §7.4 sets `false` so we
  classify statuses ourselves.

**Done when.**
- [ ] A stubbed transport returning 429 with `Retry-After: 2` produces a
      `RateLimitError` with `retryAfterMs === 2000` and calls `penalize` once.
- [ ] A 404 is not retried; a 503 is retried up to the per-host cap and then
      throws `UpstreamServerError`.
- [ ] Cancelling the token mid-flight invokes the function handed to
      `cancellerReceiver` and rejects with `OperationCancelledError`.
- [ ] The emitted `User-Agent` matches `docs/02` §2.2's string with a real
      version, asserted by regex.
- [ ] No test can construct a request to `eutils.ncbi.nlm.nih.gov` carrying an
      `email` other than the maintainer address — asserted.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- http userAgent
```

**Notes.** `docs/07` §7.4 records as *verified* that `responseType` is not
validated by `Zotero.HTTP.request` — it is assigned straight to the XHR — so
`"text"` for XML and `"json"` for `esearch` are both safe. `docs/13` §2.2 fixes
the exported entry point of this module: `src/core/http/client.ts` exposes
`httpRequest(req): Promise<HttpResponse>` and is the single outbound choke
point — use that exact name, because it is what `P1-T11`'s replay transport and
`docs/13` §2.3's integration stub substitute.

---

### P1-T06 — Tier-1 `SecretStore` for the NCBI key

| Field | Value |
|---|---|
| **ID** | `P1-T06` |
| **State** | `TODO` |
| **Depends on** | `P1-T03` |
| **Blocks** | `P1-T09` |
| **Retires** | none |
| **Implements** | part of `FR-11`, `NFR-16` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — a human must supply a real NCBI API key to verify the with-key path; the agent stops and reports rather than obtaining or embedding one. |

**Goal.** The optional NCBI API key can be read from the OS keychain, its
presence is reflected in `ncbi.keyPresent`, and no code path can put it in a
preference.

**Read first.**
- `docs/09-security-privacy-and-api-keys.md` §1.7 — the `SecretStore` interface,
  the `SecretId` union (`source.ncbi` is a member), the `LOGIN_ORIGIN` /
  `LOGIN_REALM` constants, the `setTier1` reference implementation, and the
  startup probe that round-trips a throwaway value.
- `docs/00-overview.md` §3, D5 — the binding decision: keystore only, no
  plaintext tier, ever.
- `docs/07-architecture-and-data-model.md` §8.3 placement table, first two rows —
  origin, realm, username = the `SecretId`, one login entry per ID.
- `docs/07-architecture-and-data-model.md` §8.5, "Non-secret key-presence flags"
  — `ncbi.keyPresent` and `secretBackend` are the only things that go to prefs.
- `docs/02-literature-database-apis.md` §3.1 — what the key buys (`api_key=`
  parameter; the higher rate), and that it is genuinely optional.

**Files.**
- create `src/zotero/keychain.ts`
- create `src/core/secretStore.ts`
- create `test/integration/zotero/keychain.spec.ts`

**Do.**
1. Declare the `SecretStore` port in `src/core/secretStore.ts` with `docs/09`
   §1.7's exact members (`backend`, `unattended`, `get`, `set`, `clear`, `has`,
   `listStoredIds`) and the full `SecretId` union.
2. Implement tier 1 only in `src/zotero/keychain.ts` — `Zotero.OSKeyStore.encrypt`
   → `Services.logins`, following §1.7's `setTier1` shape literally.
3. Implement the startup probe: round-trip a throwaway value; on success write
   `secretBackend = "oskeystore"`; on failure write `""` and log a warning.
   Phase 1 stops there.
4. Maintain `ncbi.keyPresent` from `has("source.ncbi")` — written only by this
   module, per `docs/07` §8.5.
5. Write an integration spec (runs inside Zotero) that round-trips an
   API-key-shaped string and asserts it appears in no preference.

**Do NOT.**
- Do **not** implement tiers 2 and 3, the passphrase file, or the degradation
  dialog. `docs/09` §1.7 owns them and Phase 3 ships them with the prefs pane
  (`docs/11` §1); a half-built ladder is worse than one rung.
- Do **not** add a plaintext fallback. `docs/09` §1.7 tier 4 is *not implemented*
  by decision, and D5 states that adding it is what turns a decision back into a
  preference.
- Do **not** log, note, export or clipboard the key value. NFR-16 lists all four
  channels; `P1-T02`'s redaction covers the logger, not your `console`.
- Do **not** build a key-entry UI. `docs/11` Phase 3 owns the prefs pane; in
  Phase 1 the key is absent for every real user and the limiter simply stays on
  the no-key budget.
- Do **not** widen the `SecretId` union or store any other secret here.

**Done when.**
- [ ] `set("source.ncbi", v)` then `get("source.ncbi")` returns `v` inside a real
      Zotero instance.
- [ ] After `set`, `Zotero.Prefs` contains `ncbi.keyPresent === true` and no
      value resembling the key anywhere under the plugin branch — asserted by
      enumerating the branch.
- [ ] `clear` removes the login entry and flips the flag to `false`.
- [ ] With no key stored, `get` resolves `undefined` and throws nothing.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/11` §1 no longer leaves this to inference: Phase 1's deliverable
list names the tier-1 `SecretStore` for `source.ncbi`, the startup probe and the
two flags outright, and says no key-entry UI ships in this phase — so in Phase 1
the key is absent for every real user and the limiter simply stays on the no-key
budget. Phase 3 completes the ladder. Spike `V-16`
(`docs/11` §4.3) is the prerequisite: if the keystore round-trip failed there,
stop and re-plan rather than inventing a fallback. Human gate details go in
[`06-human-gates.md`](06-human-gates.md).

---

### P1-T07 — `LiteratureSource` contract and the source registry

| Field | Value |
|---|---|
| **ID** | `P1-T07` |
| **State** | `TODO` |
| **Depends on** | `P1-T01` |
| **Blocks** | `P1-T08`, `P1-T09`, `P1-T16`, `P1-T20`, `P2-T01`, `P2-T02` |
| **Retires** | part of `R-2` |
| **Implements** | part of `FR-2`, part of `FR-4` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The adapter contract every future source implements exists, and a
registry the UI and the pipeline can enumerate exists with `pubmed` as its only
member.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.2 — the **complete** authoritative
  declaration of `SourceCapabilities`, `SourceQuery`, `QueryNode`, `QueryField`,
  `SourcePage`, `RelatedQuery`, `SourceCallContext`, `LiteratureSource` and
  `SourceHealth`. Transcribe, do not paraphrase.
- `docs/07-architecture-and-data-model.md` §11.1 — the 12-step "adding a
  literature source" checklist; this card builds the scaffolding steps 1–3 and 8
  depend on.
- `docs/07-architecture-and-data-model.md` §2.3 — `sources/` may import `core/`
  and `model/` and must not import `pipeline/`, `ui/` or `zotero/`.
- `docs/02-literature-database-apis.md` §12.1 — the authority note over its own
  `QueryNode` sketch; read it so you copy from `docs/07` §4.2, not from there.
- `docs/02-literature-database-apis.md` §2.0 — "What 'the last 3 years' means,
  and who owns it": the window is three calendar years, `docs/08` §4.2 owns the
  computation, and the per-source date literals further down §4–§8 are syntax
  illustrations (several captured from the 2026-09-08 probe run, so some show a
  36-month span) and **not** the plugin's default window. `src/sources/shared/recency.ts`
  is written against §4.2, not against those examples.

**Files.**
- create `src/sources/types.ts`
- create `src/sources/registry.ts`
- create `src/sources/shared/recency.ts`
- create `src/bootstrap/registerSources.ts`
- create `test/unit/sources/registry.test.ts`
- create `test/unit/sources/recency.test.ts`

**Do.**
1. Transcribe `docs/07` §4.2 into `src/sources/types.ts`, re-exporting `SourceId`
   from `model/ids.ts` as §4.2's comment instructs.
2. Implement `SourceRegistry`: register, `get(id)`, `list()`, and
   `listConfigured()` filtered by `isConfigured()`.
3. Implement `src/sources/shared/recency.ts`: given "last N years" and a clock,
   produce the `{ fromDate, toDate }` ISO pair. Follow `docs/08` §4.2's
   definition — three *calendar* years, `fromYear = currentYear - 2` — and
   expose the exact span so the UI can label it (`2024 – 2026`).
4. Implement the client-side recency filter used when a source reports
   `capabilities.dateFilter === false`, and have it record
   `dateFilterApplied: "client"` for provenance (FR-3).
5. `registerSources.ts` registers `pubmed` only, from the container.

**Do NOT.**
- Do **not** add a member to `LiteratureSource` that `docs/07` §4.2 does not
  declare. §11.1 closes with the rule: if a pipeline change is needed, the
  interface is wrong and should be *extended* — as a documented change to
  `docs/07`, not as a local addition.
- Do **not** fake a capability. §11.1 step 2: "if the API has no server-side
  date filter, set `dateFilter: false` and let the shared recency filter handle
  it; do not fake it."
- Do **not** implement `findRelated`, `lookup` or `fetchAbstract` here — they are
  optional members and Phase 1 needs none of them.
- Do **not** compute "3 years" as 1095 days in the UI-facing path. `docs/08` §4.2
  fixes the *displayed* semantics as three calendar years; `docs/02` §3.3(a)'s
  `reldate=1095` is a different mechanism and `P1-T08` chooses between them
  explicitly.

**Done when.**
- [ ] `src/sources/types.ts` declares every member of `docs/07` §4.2 with
      identical names (reviewed by diff).
- [ ] With the clock at 2026-09-09 and `searchYears = 3`, `recency` yields a
      window starting 2024-01-01 and a label of `2024 – 2026`.
- [ ] The registry returns exactly one source and `listConfigured()` includes it.
- [ ] An ESLint `no-restricted-imports` rule fails the build if `src/sources/`
      imports from `src/pipeline/`, `src/ui/` or `src/zotero/` (`docs/07` §2.3).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:unit -- sources
```

**Notes.** The ESLint dependency-rule config is the mechanically enforceable
half of `docs/07` §2.3 and is cheapest to add now, while there is one adapter to
break. The recency window this card computes was conflict **C10** (§4) and is
now settled: `docs/08` §4.2's calendar-year span is what ships, FR-3 was
rewritten to require it and defers the computation to §4.2, and `docs/02` §2.0
declares the same window corpus-wide. Keep the span the function returns and the
span the label shows the same value — that is the whole point of §4.2's rule.

---

### P1-T08 — PubMed query builder

| Field | Value |
|---|---|
| **ID** | `P1-T08` |
| **State** | `TODO` |
| **Depends on** | `P1-T07` |
| **Blocks** | `P1-T09`, `P2-T01` |
| **Retires** | none |
| **Implements** | `FR-4`, part of `FR-3` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** A `SourceQuery` renders into a valid Entrez `term` plus the right
date parameters, and free-text the user types parses into a `QueryNode` without
ever showing a syntax error.

**Read first.**
- `docs/02-literature-database-apis.md` §12.2, "PubMed" block — the exact field
  tags (`[Title]`, `[Title/Abstract]`, `[Author]`, `[Journal]`, `[MeSH Terms]`,
  `[All Fields]`), the uppercase-Boolean rule, and the worked example.
- `docs/02-literature-database-apis.md` §12.1 — the small user syntax to accept
  (quotes, `AND`/`OR`/`NOT`, `-`, parentheses, `field:` prefixes), the
  bare-words-default-to-AND rule, and the "anything unparseable becomes one
  `term` node" fallback.
- `docs/02-literature-database-apis.md` §3.3 — the `esearch` parameter table and
  the three interchangeable date mechanisms (a) `reldate`, (b)
  `mindate`/`maxdate`, (c) in-term `[PDAT]` range — plus the "default to `edat`,
  expose `pdat` as an advanced option" ruling and the reason for it.
- `docs/07-architecture-and-data-model.md` §4.2 — `QueryNode`/`QueryField` are
  declared here and nowhere else; `explainQuery` on `LiteratureSource` is what
  the UI shows.
- `docs/13-testing-build-and-release.md` §2.1, "Query builders" row — the tests
  this card must have: boolean translation, parenthesis balancing, date-range
  rendering, URL encoding, key redaction in the recorded URL.

**Files.**
- create `src/sources/pubmed/query.ts`
- create `src/sources/shared/queryParse.ts`
- create `test/unit/sources/pubmed-query.test.ts`
- create `test/unit/sources/queryParse.test.ts`

**Do.**
1. Implement the parser in `queryParse.ts`: string → `QueryNode` per `docs/02`
   §12.1's accepted syntax, mapping `title:`/`abstract:`/`author:`/`journal:`
   onto the `QueryField` members `docs/07` §4.2 declares.
2. Implement `renderPubmedTerm(node)` per `docs/02` §12.2, with uppercase
   `AND`/`OR`/`NOT`, balanced parentheses, quoted phrases, and `[All Fields]`
   for unfielded terms.
3. Implement the date window using `mindate`/`maxdate` + `datetype=edat` —
   mechanism (b) with `docs/02` §3.3's default `datetype`. Both `mindate` and
   `maxdate` are required together.
4. Implement `explainQuery(query)` returning the human-readable rendered term
   for the UI preview and the provenance record.
5. Build the full `esearch` parameter set as an ordered, URL-encoded string so it
   is deterministic and fixture-hashable (`docs/13` §2.2 keys fixtures on the
   URL).

**Do NOT.**
- Do **not** lowercase the Boolean operators. `docs/02` §12.2: "Booleans **must
  be uppercase**" — PubMed silently treats a lowercase `and` as a search term.
- Do **not** declare a local `QueryNode`/`QueryField`. `docs/02` §12.1's own
  authority note calls its sketch "not a second declaration" and says doc 07
  wins; two shapes here poison every adapter written after.
- Do **not** show the user a syntax error. `docs/02` §12.1: an unparseable query
  falls back to a single `{ kind: "term", field: "any" }` node containing the
  raw string — "never show a syntax error for a natural-language query".
- Do **not** send `mindate` without `maxdate` or vice versa — `docs/02` §3.3
  marks them "**both required together**".
- Do **not** default to `datetype=pdat`. `docs/02` §3.3 records a live
  observation of a September-2026 search returning a record with a future print
  cover date; `edat` is the default and `pdat` is the advanced option.
- Do **not** use `reldate=1095`. It is a valid mechanism but a *rolling-days*
  one, and `docs/08` §4.2 fixes the UI semantics as three calendar years; mixing
  them makes the label lie. FR-3 was rewritten on 2026-09-09 to require calendar
  years and to defer the computation to §4.2 (closed conflict **C10**, §4), and
  `docs/02` §2.0 says the same corpus-wide, so a rolling window is not what the
  feature is. §4.2 is what this card renders.

**Done when.**
- [ ] `("base editing" OR "prime editing") AND title:CRISPR NOT mouse` renders to
      the `docs/02` §12.2 example term, modulo whitespace, asserted.
- [ ] Every rendered term has balanced parentheses, asserted by a property test
      over 100 generated inputs.
- [ ] A query containing `&`, `+`, `#` and a Korean phrase round-trips through
      URL encoding unchanged.
- [ ] An unparseable input yields a single `term` node and no thrown error.
- [ ] The recorded URL used for provenance has `api_key` redacted.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- query
```

**Notes.** `docs/02` §3.3's live response shows PubMed's `querytranslation` and
`translationset` — free MeSH expansion the plugin gets for nothing. `P1-T09`
captures both into provenance; this card only has to not interfere with them.

---

### P1-T09 — PubMed adapter: `esearch` → `efetch`

| Field | Value |
|---|---|
| **ID** | `P1-T09` |
| **State** | `TODO` |
| **Depends on** | `P1-T05`, `P1-T06`, `P1-T07`, `P1-T08` |
| **Blocks** | `P1-T10`, `P1-T11`, `P1-T16`, `P1-T17` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-4`, `FR-11`, part of `FR-9` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** `LiteratureSource.search`/`searchAll` for PubMed: one `esearch` for
PMIDs, batched `efetch` calls for full records, honest capabilities, correct
paging, and a loud failure on the errors PubMed hides inside HTTP 200.

**Read first.**
- `docs/02-literature-database-apis.md` §3.1 — base URL, the `api_key=`
  parameter, and the `tool=`/`email=` obligation on **every** request.
- `docs/02-literature-database-apis.md` §3.3 — the `esearch` parameter table,
  `retmax` max 10 000, **`retstart` max 9998**, the verified error body returned
  inside an HTTP 200 at `retstart=9999`, and the history-server option.
- `docs/02-literature-database-apis.md` §3.4 — `efetch`: batch up to **200
  PMIDs** per call, POST when the URL would exceed ~2000 chars,
  `retmode=xml` is the only useful mode, and `retmode=json` is **not supported**
  for PubMed `efetch`.
- `docs/02-literature-database-apis.md` §3.8 — the error table: 429 for rate,
  HTTP 200 + `esearchresult.ERROR` for a bad query, empty
  `<PubmedArticleSet/>` for an unknown PMID, 5xx for overload.
- `docs/07-architecture-and-data-model.md` §4.2 — the `LiteratureSource` members
  to implement and the `SourceCapabilities` fields to fill honestly, especially
  `maxPageSize`, `maxTotalResults` and `benefitsFromApiKey`.
- `docs/07-architecture-and-data-model.md` §7.3, NCBI row — `rateLimitKey` is
  the host `eutils.ncbi.nlm.nih.gov`, and the with-key/no-key switch.
- `docs/00-overview.md` §3, D10 — `tool`/`email` carry the maintainer address,
  always.

**Files.**
- create `src/sources/pubmed/pubmedSource.ts`
- create `test/unit/sources/pubmed-source.test.ts`

**Do.**
1. Implement `id`, `displayNameKey`, `rateLimitKey`, `isConfigured()` (always
   true — the key is optional) and `capabilities` with
   `maxTotalResults: 9999` from `docs/02` §3.3's ceiling and
   `abstractsInSearch: false` (abstracts require the `efetch` round trip).
2. `search()`: build the `esearch` URL from `P1-T08`, append `db=pubmed`,
   `retmode=json`, `retmax`, `retstart`, `tool`, `email`, and `api_key` when
   `P1-T06` returns one; issue it through `P1-T05`.
3. **Check `esearchresult.ERROR` before anything else** and throw `SourceError`
   with the upstream text; a 200 with an error body must never look like zero
   results.
4. Clamp `retstart` to ≤ 9998 and stop paging at the ceiling, emitting a
   `SourcePage.warnings` entry that says the result set was truncated.
5. Capture `count`, `querytranslation` and `translationset` from the response
   and expose them on the page for `P1-T17`'s provenance record.
6. `efetch`: chunk the PMID list into batches of ≤ 200, `retmode=xml`,
   `rettype=abstract`; switch to POST when the URL would exceed ~2000 chars;
   request `responseType: "text"` so `P1-T10` parses the body with `DOMParser`.
7. `searchAll()`: an `AsyncIterable<SourceRecord>` that pages until `limit` or
   exhaustion, calls `ctx.token.throwIfCancelled()` before each page and each
   `efetch` batch, and reports progress through `ctx.progress`.
8. `healthCheck()`: a single `esearch` with `retmax=0` — cheap, per §4.2's "must
   not consume meaningful quota".
9. `explainQuery()` delegates to `P1-T08`.

**Do NOT.**
- Do **not** page past `retstart=9998`. `docs/02` §3.3 verified live that 9999
  returns `{"esearchresult":{"ERROR":"… 'retstart' cannot be larger than 9998
  …"}}` **inside an HTTP 200**, and the section is explicit that the adapter must
  detect it and fail loudly rather than silently returning zero results.
- Do **not** ask `efetch` for `retmode=json`. `docs/02` §3.4: it is **not
  supported** for PubMed `efetch`; `retmode=text&rettype=abstract` gives an
  unparseable blob.
- Do **not** send more than 200 PMIDs in one `id=` list, and do not build a
  2000+ character GET URL — `docs/02` §3.4 gives both limits and the POST escape.
- Do **not** put the user's `contactEmail` in `email=`. D10 / NBK25497: NCBI gets
  the maintainer address unconditionally; this is the documented exception to the
  per-user scheme.
- Do **not** implement `esummary`, `elink` or the PMC ID Converter here. They are
  Phase 2/5 work (§3). If you do reach for the converter later, note `docs/02`
  §3.7: the classic URL now 301s, the new endpoint no longer auto-detects ID
  types, and a DOI without an explicit `idtype=doi` returns HTTP 400.
- Do **not** implement your own 429 handling. `P1-T04`/`P1-T05` own it
  (`docs/02` §2.4 → `docs/07` §7.3).
- Do **not** hold the raw XML on the `SourceRecord` unless `logRequestBodies` is
  on — `docs/07` §5.1's `raw` field comment and NFR-7 both require dropping it
  after mapping.

**Done when.**
- [ ] An `esearch` body containing `esearchresult.ERROR` throws `SourceError`
      and never returns an empty page.
- [ ] A requested `limit` of 12 000 stops at the 9998 ceiling and the returned
      page carries a truncation warning.
- [ ] A 250-PMID result set issues exactly two `efetch` calls.
- [ ] Every issued URL carries `tool=research_helper` and the maintainer
      `email=`, asserted against the transport spy.
- [ ] With `ncbi.keyPresent` true and a stubbed key, `api_key=` is present and
      the limiter was reconfigured to the with-key budget.
- [ ] Cancelling between pages stops before the next request is issued.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- pubmed-source
```

**Notes.** `docs/02` §3.3's history-server path (`usehistory=y` → `WebEnv` +
`query_key`) is the documented alternative for very large fetches and is *not*
built here — Phase 1's `maxResults` ceiling is 200 (`docs/07` §8.5). If a later
phase needs it, `WebEnv` is transient: treat it as valid for one session and
re-issue `esearch` on failure.

---

### P1-T10 — PubMed XML → `SourceRecord` mapper

| Field | Value |
|---|---|
| **ID** | `P1-T10` |
| **State** | `TODO` |
| **Depends on** | `P1-T01`, `P1-T09` |
| **Blocks** | `P1-T11`, `P1-T16` |
| **Retires** | `R-17` (measured) |
| **Implements** | part of `FR-6`, part of `FR-7` |
| **Estimate** | 1.25 d |
| **Human gate** | none |

**Goal.** A `PubmedArticle` element becomes a `SourceRecord` whose `work` is a
faithful `CanonicalWork`, including flattened structured abstracts, MeSH
subjects with their UIs and major-topic flags, and a date that is actually
parseable.

**Read first.**
- `docs/02-literature-database-apis.md` §3.4 — the real trimmed `PubmedArticle`
  XML and, crucially, the seven numbered **parsing notes**: structured
  abstracts, inline markup, numeric character references, the four date shapes,
  missing abstracts, MeSH `@UI`/`@MajorTopicYN`, and where the PMCID lives.
- `docs/02-literature-database-apis.md` §10.2, PubMed column — the field-by-field
  source paths for title, abstract, authors, ORCID, affiliations, ids, venue,
  dates, volume/issue/pages, language, keywords, MeSH and publication types.
- `docs/07-architecture-and-data-model.md` §5.1 — the target types
  (`CanonicalWork`, `Author`, `Subject`, `PartialDate`, `SourceRecord`),
  including `missingFields` and `retrievedAtEpochMs`.
- `docs/07-architecture-and-data-model.md` §5.1, merge-rules table, `abstract`
  row — "PubMed structured abstracts are flattened with section labels
  preserved", which fixes the flattening format.
- `docs/13-testing-build-and-release.md` §2.1, "Normalizers" row — the required
  test matrix: author-name splitting, dates across `2024`, `2024-03`,
  `2024 Mar 15`, `2024 Spring`, abstract stripping, DOI normalization,
  item-type mapping.
- `docs/13-testing-build-and-release.md` §3.1 — the fixture names this mapper is
  tested against (`record-rich`, `record-sparse`, `record-unicode`,
  `record-jats-abstract`, …).

**Files.**
- create `src/sources/pubmed/mapper.ts`
- create `test/unit/sources/pubmed-mapper.test.ts`

**Do.**
1. Parse with `DOMParser` (`text/xml`) over the `responseType: "text"` body from
   `P1-T09`; iterate `PubmedArticleSet > PubmedArticle`.
2. Title from `Article/ArticleTitle` via `textContent`; strip the trailing `.`
   PubMed appends (noted in `docs/02` §10.4's title-precedence row).
3. Abstract: collect every `Abstract/AbstractText`. One unlabelled element →
   its text. Multiple, or any with a `Label=` → join as `"{Label}: {text}"`
   with `\n\n` between, per `docs/02` §3.4 note 1 and `docs/07` §5.1.
4. Authors: `LastName`/`ForeName`, `Identifier[@Source='ORCID']` → `orcid`,
   `AffiliationInfo/Affiliation` → `affiliations`, `sequence` from document
   order. Drop an author with no usable name (`docs/07` §5.1: "an author with no
   name is dropped").
5. Dates: prefer `PubmedData/History/PubMedPubDate[@PubStatus='pubmed']`, then
   `ArticleDate`, then `JournalIssue/PubDate`, handling `<MedlineDate>` free
   text. Emit a `PartialDate` with the precision actually available.
6. IDs: `PMID`, `ArticleId[@IdType='doi']`, `ArticleId[@IdType='pmc']` — through
   `P1-T01`'s normalizers.
7. Subjects: one `Subject` per `MeshHeading/DescriptorName` with
   `scheme: "mesh"`, `id` from `@UI`, `isMajor` from `@MajorTopicYN === "Y"`.
   Keywords from `KeywordList/Keyword` as `keywords`.
8. `type`: `docs/02` §10.2's type-mapping rules — default `journal-article`
   (the `docs/07` §5.1 kebab-case spelling) when a venue with an ISSN exists.
9. Populate `missingFields` with every canonical field the record could not
   supply, so `P1-T22` can report abstract coverage (R-17).
10. Emit `SourceRecord` with `id = "pubmed:<pmid>"`, `nativeId`,
    `retrievedAtEpochMs` from the injected clock.

**Do NOT.**
- Do **not** parse XML with regexes or string slicing. `docs/02` §3.4 note 3:
  numeric character references like `&#x2009;` and `&#xa9;` appear routinely and
  "a real XML parser handles these; regex parsing does not".
- Do **not** read `innerHTML` on `AbstractText`. `docs/02` §3.4 note 2: `<sup>`,
  `<sub>`, `<i>`, `<b>` appear *inside* it; use `textContent`.
- Do **not** assume one `AbstractText` element. Note 1: structured abstracts have
  several, each with `Label=`/`NlmCategory=`.
- Do **not** assume `<Abstract>` exists. Note 5: editorials and older papers
  frequently have none — that is a `missingFields` entry, not an error.
- Do **not** take the date from `JournalIssue/PubDate` first. Note 4 ranks
  `PubMedPubDate[@PubStatus='pubmed']` first precisely because `PubDate` can be
  `<MedlineDate>2023 Jun-Jul</MedlineDate>` free text.
- Do **not** drop the MeSH `@UI` or the major-topic flag. Note 6: `@UI` is the
  stable identifier and `@MajorTopicYN="Y"` is what collection profiling uses
  later (`docs/05`).
- Do **not** use the five Zotero item-type spellings from `docs/02` §10.2's
  `type` row. `docs/02` §10.1's authority note says the shipped `WorkType` is
  `docs/07` §5.1's kebab-case union, and `docs/07` §6.2 owns the mapping to
  Zotero types.
- Do **not** write `workKey`, `provenance` or `normalizedAtEpochMs` here —
  `docs/07` §5.1 types `SourceRecord.work` as `Omit<CanonicalWork, …>` for those
  three fields on purpose; the pipeline fills them.

**Done when.**
- [ ] The `docs/02` §3.4 sample (PMID 37258680) maps to a record with 6 MeSH
      subjects, 3 of them `isMajor`, DOI `10.1038/s41586-023-06139-9`, PMCID
      `PMC10949956`, and `publishedDate.iso === "2023-06-01"`.
- [ ] A structured abstract with `BACKGROUND`/`METHODS`/`RESULTS`/`CONCLUSIONS`
      flattens to four `\n\n`-separated `LABEL: text` paragraphs.
- [ ] `&#x2009;` in the source appears as a thin space, not as the literal
      entity.
- [ ] A record with no `<Abstract>` maps successfully with `abstract` undefined
      and `"abstract"` in `missingFields`.
- [ ] A `<MedlineDate>2023 Jun-Jul</MedlineDate>` record yields a year-only
      `PartialDate` rather than throwing.
- [ ] A CJK title and a Greek-letter title round-trip byte-identically.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- pubmed-mapper
```

**Notes.** `docs/07` §11.1 step 6 fixes the minimum mapper test set: a journal
article, a preprint, an item with no abstract, an item with a partial date, an
item with 50+ authors, and a Unicode/CJK title. PubMed returns no preprints, so
that one case is legitimately absent here — record the reason in the test file.

---

### P1-T11 — Contract-test harness and PubMed fixtures

| Field | Value |
|---|---|
| **ID** | `P1-T11` |
| **State** | `TODO` |
| **Depends on** | `P1-T05`, `P1-T09`, `P1-T10` |
| **Blocks** | `P1-T23` |
| **Retires** | part of `R-2` |
| **Implements** | part of `FR-9` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Recorded PubMed responses replay in CI with no network, a missing
fixture fails loudly with the command to record it, and every error shape the
adapter claims to handle has a fixture proving it.

**Read first.**
- `docs/13-testing-build-and-release.md` §2.2 — the record/replay mechanism, the
  `fixtureKey` hashing function, the `replayTransport` implementation, the
  four things contract tests assert, and the rule that a missing fixture is a
  test failure and never a silent network call.
- `docs/13-testing-build-and-release.md` §3.1 — the required fixture inventory
  per source: `search-typical`, `search-empty`, `search-single`, `record-rich`,
  `record-sparse`, `record-unicode`, `record-jats-abstract`, `error-429`,
  `error-500`, `error-malformed`, `paginated`.
- `docs/13-testing-build-and-release.md` §3.2 — recording and redaction:
  real keys come from `.env`, and the redaction pass strips keys,
  `Authorization` headers and `mailto` values *before* writing.
- `docs/13-testing-build-and-release.md` §3.3 — the freshness policy for
  fixtures.
- `docs/02-literature-database-apis.md` §3.8 — the four PubMed error conditions
  that need fixtures, including the HTTP-200-with-`ERROR` case.

**Files.**
- create `test/contract/_transport.ts`
- create `test/contract/pubmed.contract.test.ts`
- create `scripts/record-fixtures.ts`
- create `test/fixtures/pubmed/` (recorded JSON files)
- modify `package.json` (add `fixtures:record`)

**Do.**
1. Implement `fixtureKey` and `replayTransport` from `docs/13` §2.2 verbatim.
2. Implement `scripts/record-fixtures.ts` driving a fixed, versioned scenario
   list so recordings are reproducible, with the redaction pass from §3.2.
3. Record the §3.1 inventory for `esearch` and `efetch`. `error-429` and
   `error-500` are hand-written when they cannot be provoked politely — say so
   in a comment; deliberately provoking NCBI rate limits risks the IP block
   `docs/02` §3.1 warns about.
4. Add the PubMed-specific fixture the other six sources will not have: an
   `esearch` response carrying `esearchresult.ERROR` (the `retstart=9999` body
   is quoted verbatim in `docs/02` §3.3).
5. Assert all four `docs/13` §2.2 categories: request shape, parser snapshot,
   typed errors, and pagination to the configured limit.

**Do NOT.**
- Do **not** let a contract test reach the network. `docs/13` §2.2: a missing
  fixture must fail "with the exact command to record it, never a silent network
  call".
- Do **not** commit a fixture before the redaction pass runs. §3.2 strips API
  keys, `Authorization` headers **and `mailto` values**; the maintainer address
  is in every recorded URL by construction.
- Do **not** hammer NCBI to produce an `error-429`. `docs/02` §3.1 quotes the
  policy: "failure to comply with this policy may result in an IP address being
  blocked from accessing NCBI."
- Do **not** snapshot the whole `CanonicalWork` with a live timestamp in it —
  `retrievedAtEpochMs`/`normalizedAtEpochMs` come from the injected clock, so
  freeze it.

**Done when.**
- [ ] `npm run test:contract` passes with the network unplugged.
- [ ] Deleting one fixture file makes exactly one test fail, and the failure
      message contains the record command.
- [ ] `grep -ri "suppakoko@gmail.com\|api_key=" test/fixtures/` returns nothing.
- [ ] The `esearchresult.ERROR` fixture produces a `SourceError`, not an empty
      page.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:contract
```

**Notes.** These fixtures are the regression guard for the whole of `docs/02`
§3, and Phase 2 copies this harness six more times — spend the time on
`_transport.ts` now rather than on the sixth adapter.

---

### P1-T12 — `CanonicalWork` → Zotero item JSON and the `extra` rules

| Field | Value |
|---|---|
| **ID** | `P1-T12` |
| **State** | `TODO` |
| **Depends on** | `P1-T01` |
| **Blocks** | `P1-T13`, `P1-T14` |
| **Retires** | none |
| **Implements** | `FR-6`, `FR-7` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** A `CanonicalWork` becomes Zotero item JSON that `item.fromJSON()`
accepts in strict mode, with native `PMID`/`PMCID`, automatic tags, and an
`extra` field that never damages a line the plugin did not write.

**Read first.**
- `docs/07-architecture-and-data-model.md` §6.1 — the verified `journalArticle`
  field list, the verified creator types, and the implementer's note that
  `PMID`/`PMCID` are **first-class fields** and must not go in `extra` for that
  type.
- `docs/07-architecture-and-data-model.md` §6.2 — the full mapping table,
  including automatic tags (`{tag, type: 1}`), the `MeSH: ` prefix rule,
  `rh-work-key`, `rh-sources`, `accessDate`, `libraryCatalog`, and single-field
  creator mode for `literal`-only authors.
- `docs/07-architecture-and-data-model.md` §6.3 — the `extra` contract: `rh-`
  prefix, byte-for-byte preservation of foreign lines, standard non-namespaced
  lines only when there is no native field, and the ~500-character growth cap.
- `docs/01-zotero-plugin-platform.md` §5.2.1 — why `fromJSON()` beats
  field-by-field `setField()`, its Extra migration behaviour, and the **two hard
  rules**: it is a replace not a merge, and development runs `{ strict: true }`.
- `docs/01-zotero-plugin-platform.md` §5.3 — `Zotero.Schema.schemaUpdatePromise`
  gating, `isValidForType`, base-field mapping, and the instruction to
  feature-detect (`Zotero.ItemFields.getID('PMID')`) rather than version-check.
- `docs/02-literature-database-apis.md` §10.3 — the same mapping from the API
  side, including the tag conventions (`MeSH: ` vs `MeSH*: `) and the
  `research_helper` run tag.

**Files.**
- create `src/zotero/itemMapper.ts`
- create `src/zotero/extraField.ts`
- create `test/unit/zotero/itemMapper.test.ts`
- create `test/unit/zotero/extraField.test.ts`
- create `test/integration/zotero/itemMapper.spec.ts`

**Do.**
1. Implement `toZoteroItemJSON(work)` per `docs/07` §6.2's table, emitting
   `itemType: "journalArticle"` for everything Phase 1 sees.
2. Creators: `{creatorType:"author", firstName, lastName}`, or
   `{creatorType:"author", name, fieldMode: 1}` when only `literal` is known
   (`docs/01` §5.2 and `docs/07` §6.2 agree on the shape).
3. Tags: subjects and keywords as **automatic** tags (`type: 1`), MeSH prefixed
   `MeSH: ` (and `MeSH*: ` for major topics, `docs/02` §10.3), plus the
   `research_helper` run tag.
4. Implement `extraField.ts`: parse `extra` into `(key, value, lineIndex)`
   triples, replace only `rh-`-prefixed lines, preserve every foreign line and
   its ordering byte-for-byte, and enforce the ~500-character cap by falling back
   to a child note carrying only `rh-work-key`.
5. Feature-detect `PMID`/`PMCID` with `Zotero.ItemFields.getID('PMID')` after
   awaiting `Zotero.Schema.schemaUpdatePromise`; write the native field when it
   exists and the `PMID: ` extra line only when it does not.
6. Write an integration spec that runs `item.fromJSON(json, { strict: true })`
   inside a real Zotero and asserts no `ZoteroInvalidDataError`.

**Do NOT.**
- Do **not** map fields with a chain of `setField()` calls. `docs/01` §5.2.1:
  `setField` throws on an invalid field for the type, so hand-mapping means
  owning a validation matrix that changes with every schema bump.
- Do **not** use `fromJSON` to patch an existing item. `docs/01` §5.2.1 hard rule
  1: it clears every field present on the item but absent from the JSON. Abstract
  backfill uses `setField` (`P1-T14`).
- Do **not** write `PMID: 12345678` into `extra` for a `journalArticle`.
  `docs/07` §6.1, `docs/02` §10.3 **and FR-6** now all say the native field
  exists in schema 42 and that the identifier goes there "and **not** in
  `Extra`" (conflict C2, closed). FR-6's remaining `Extra` clause covers only
  item types with no native field — `preprint`, `conferencePaper`, and arXiv IDs
  outside `preprint` — none of which Phase 1 emits.
- Do **not** rewrite, reorder or normalize a line in `extra` that the plugin did
  not write. `docs/07` §6.3: `extra` is shared with the user, with Better BibTeX
  and with other plugins.
- Do **not** revive the `research_helper-key:` / `research_helper-sources:`
  spellings. `docs/07` §6.3's `rh-` prefix is the only contract, and `docs/02`
  §10.3 now records that both older spellings "are gone" (conflict C1, closed) —
  so if you meet one in a real `extra` field it is a foreign line and gets
  preserved byte-for-byte, not rewritten.
- Do **not** store the DOI as a URL. `docs/07` §6.2: bare `10.1234/abc`, never
  `https://doi.org/…`. Write the branded lowercase `Doi` from
  `work.ids.doi` — that is what §5.1 types and what FR-6 requires — and do
  **not** try to restore an original spelling: `docs/02` §11.1 withdrew that
  instruction and now states that `normalizeDoi()`'s lowercase output is the only
  DOI the plugin writes to Zotero (conflict C9, §4, closed; the shipped
  `ExternalIds` carries no such value either way).
- Do **not** call `Zotero.ItemFields.getID()` before awaiting
  `Zotero.Schema.schemaUpdatePromise` — `docs/01` §5.3 says it throws
  `Zotero.Exception.UnloadedDataException`.
- Do **not** hardcode the field list. `docs/01` §5.3 recommends generating it at
  runtime and committing the output as a fixture, because the schema is versioned
  independently of Zotero releases.

**Done when.**
- [ ] A rich `CanonicalWork` maps to JSON that `fromJSON(json, {strict: true})`
      accepts inside a real Zotero (integration spec).
- [ ] `PMID` and `PMCID` land in the native fields, and nothing resembling
      `PMID:` appears in `extra`.
- [ ] Given an existing `extra` of `"Citation Key: smith2024\nPMID: 999"`,
      writing `rh-work-key` leaves both original lines byte-identical and in
      order.
- [ ] MeSH tags are `type: 1` and major topics carry the distinguishing prefix.
- [ ] An author with only `literal` produces `fieldMode: 1`.
- [ ] A work that would add > 500 characters of `extra` gets a child note and
      only `rh-work-key` in `extra`.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- itemMapper extraField && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/07` §6.2 lists a `preprint` column; leave the branch
unimplemented with an explicit `throw new ZoteroApiError(...)` rather than a
half-mapping, because Phase 2 owns preprints and a silent wrong mapping is worse
than a loud gap.

---

### P1-T13 — Existing-item detection by DOI and PMID

| Field | Value |
|---|---|
| **ID** | `P1-T13` |
| **State** | `TODO` |
| **Depends on** | `P1-T01`, `P1-T12` |
| **Blocks** | `P1-T14`, `P2-T09`, `P2-T17` |
| **Retires** | none |
| **Implements** | `FR-51` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Before any write, an incoming record that already exists in the
library is recognised, so it is added to the target collection instead of
duplicated.

**Read first.**
- `docs/01-zotero-plugin-platform.md` §5.5 — the `findByDOI` / `findByPMID`
  reference implementations, the fact that every item field is automatically a
  search condition, the **Zotero 10 breaking changes** (`addCondition`'s fourth
  argument now throws; `groupStart`/`groupEnd`; `fulltextWord` removed), and the
  explicit "do not use `Zotero.Duplicates` for this" ruling with its reason.
- `docs/01-zotero-plugin-platform.md` §3.4(a) — the singular collection-pane
  getters that **throw** on Zotero 10 and their plural replacements.
- `docs/02-literature-database-apis.md` §11.6 — the build-the-index-once pattern
  (`byDoi`/`byPmid`/`byTitle` maps) and the rule to skip trashed items.
- `docs/02-literature-database-apis.md` §11.1 — normalized DOI as the dictionary
  key, original form for display.
- `docs/10-requirements-and-user-stories.md` FR-51 — the acceptance criterion:
  link and report "linked existing: N", never create a second item.

**Files.**
- create `src/zotero/libraryIndex.ts`
- create `test/integration/zotero/libraryIndex.spec.ts`

**Do.**
1. Build the index once per run from a single `Zotero.Search` over the library,
   populating `byDoi` (normalized) and `byPmid`, per `docs/02` §11.6.
2. Populate PMIDs from **both** the native `PMID` field and `extra` lines —
   `docs/01` §5.5: "Run both branches. Many items in a real library were saved
   before schema 34."
3. Exclude trashed items (`item.deleted`), per `docs/02` §11.6.
4. Expose `findExisting(ids): { itemID, matchedOn: "doi" | "pmid" } | undefined`.
5. Keep a fallback that runs two flat searches and unions the results, per
   `docs/01` §5.5's unverified note about condition-group semantics.

**Do NOT.**
- Do **not** pass a fourth argument to `addCondition`. `docs/01` §5.5: the legacy
  `required` argument **throws** on Zotero 10.
- Do **not** build this on `groupStart`/`groupEnd` without verifying it first.
  `docs/01` §5.5 flags the `joinMode`-inside-a-group semantics as **unverified**
  and says to check it in Tools → Developer → Run JavaScript before building
  duplicate detection on it, keeping the two-flat-searches fallback.
- Do **not** use `Zotero.Duplicates`. `docs/01` §5.5: it is a library-wide,
  UI-oriented heuristic scan, "useless for 'does this DOI already exist'".
- Do **not** call `ZoteroPane.getSelectedCollection()`, `getSelectedLibraryID()`
  or `getCollectionTreeRow()`. `docs/01` §3.4(a) and §12: the singular getters
  **throw** on Zotero 10 and Zotero's own documentation page still shows them.
  Use the plural forms and handle a multi-row selection explicitly.
- Do **not** do a per-candidate library search. `docs/02` §11.6: one library read
  is far cheaper, and a 200-candidate run would otherwise issue 200 searches.
- Do **not** fuzzy-match on title in Phase 1. FR-50's fuzzy cascade is Phase 2
  (`docs/11` §1), and `R-18` makes a false merge the expensive error.

**Done when.**
- [ ] An item saved with a native `PMID` is found; an item carrying only
      `PMID: <n>` in `extra` is also found.
- [ ] A trashed item with a matching DOI is **not** returned.
- [ ] Matching is case-insensitive across DOI spellings
      (`10.18653/V1/...` matches `10.18653/v1/...`).
- [ ] Building the index over a 10 000-item library issues one search, not N.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/08` §4.5's wireframe gives the user a per-run duplicate policy
(Skip / Add existing item to collection / Import anyway) — it is a wireframe row,
not one of §4.2's control-table rows — and `docs/07` §8.5's
`hideExisting` controls whether matched rows are hidden in the table. This card
supplies the detection; `P1-T21`/`P1-T22` wire the choice.

---

### P1-T14 — Batched importer and collection operations

| Field | Value |
|---|---|
| **ID** | `P1-T14` |
| **State** | `TODO` |
| **Depends on** | `P1-T12`, `P1-T13` |
| **Blocks** | `P1-T16`, `P1-T17`, `P2-T18` |
| **Retires** | `R-16` |
| **Implements** | `FR-6`, `FR-7`, `FR-51`, `NFR-1`, `NFR-3` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** N selected records become N Zotero items in a named collection, in
batched transactions, fast enough for NFR-1 and without freezing the UI.

**Read first.**
- `docs/01-zotero-plugin-platform.md` §5.8 — the transaction rules: `save()`
  inside `executeTransaction`, never `saveTx()`; batch the imports; **do not
  await network I/O inside a transaction**; WAL does not change single-writer.
- `docs/07-architecture-and-data-model.md` §7.2, "Zotero write batching" — chunks
  of ~50 items, `await Zotero.Promise.delay(0)` between chunks so the UI stays
  responsive, the notifier disable/enable window, and the instruction to
  instrument the chunk size rather than trust 50.
- `docs/01-zotero-plugin-platform.md` §5.4 — creating a collection, and the
  **unverified** note on `collection.addItems()` with the "safest,
  definitely-correct" item-side pattern to use instead.
- `docs/01-zotero-plugin-platform.md` §5.2.1 — `fromJSON` again, and the
  `schemaUpdatePromise` gate before the batch.
- `docs/10-requirements-and-user-stories.md` NFR-1 — 100 pre-fetched records in
  ≤ 10 s of plugin+DB time, target ≤ 6 s, measured from click to "collection
  contains 100 items".
- `docs/08-ui-ux-spec.md` §4.4 — the import pipeline the button runs, in order,
  including the abstract-backfill step and the final "Imported N · Skipped N ·
  N failed" report.

**Files.**
- create `src/zotero/collectionOps.ts`
- create `src/zotero/importer.ts`
- create `test/integration/zotero/importer.spec.ts`
- create `test/integration/zotero/import-perf.spec.ts`

**Do.**
1. `collectionOps.ts`: find-or-create a collection by name under a chosen
   parent, using `docs/01` §5.4's shape; return the collection.
2. `importer.ts`: take an array of `CanonicalWork` plus the target collection and
   the duplicate policy; resolve existing items through `P1-T13` **before**
   opening any transaction.
3. Await `Zotero.Schema.schemaUpdatePromise` once, before the loop.
4. Chunk into batches of 50. Per batch: one `Zotero.DB.executeTransaction`, one
   `item.fromJSON()` + `item.setCollections([id])` + `item.save()` per record,
   then `await Zotero.Promise.delay(0)` between batches.
5. For matched existing items, add them to the collection using the item-side
   `addToCollection` + `save()` pattern from `docs/01` §5.4, and count them as
   "linked existing".
6. Abstract backfill: after creation, if `abstractNote` is empty and the record
   has one, set it with `setField` (never `fromJSON`) — `docs/01` §6.3 step 4
   calls this "the single highest-value post-processing step".
7. Return an `ImportReport { created, linkedExisting, failed[], abstractCoverage }`
   — abstract coverage is the R-17 measurement.
8. Write `import-perf.spec.ts` measuring 100 pre-fetched records against NFR-1,
   with the generous CI multiplier `docs/13` §2.3 prescribes.

**Do NOT.**
- Do **not** call `saveTx()` inside `executeTransaction()`. `docs/01` §5.8 states
  the rule flatly; the nested transaction is the classic Zotero import bug.
- Do **not** await any HTTP call inside `executeTransaction`. `docs/01` §5.8:
  Zotero's DB is single-writer and holding a transaction across a round-trip
  stalls the whole application. Fetch everything first.
- Do **not** import 50 records as 50 `saveTx()` calls — that is 50 transactions
  and "will be visibly slow" (`docs/01` §5.8), and it is precisely what R-16
  predicts.
- Do **not** use `collection.addItems()` without verifying it exists. `docs/01`
  §5.4 marks it **unverified** on Zotero 10 and gives the item-side pattern that
  is definitely correct.
- Do **not** run raw SQL against `zotero.sqlite`. `docs/01` §5.8: the schema is
  not a public API.
- Do **not** read `useTranslators` or call `Zotero.Translate.Search`. Phase 1 ships
  the hand-mapped path only; `P2-T18` owns Strategy B and the pref (which ships
  `false` — `docs/07` §8.5).
- Do **not** hold the main thread for the whole import. NFR-3 caps a single task
  at 100 ms and `docs/07` §7.2 prescribes `await Zotero.Promise.delay(0)`
  between chunks — that is what the inter-batch yield is for.
- Do **not** delete or modify a user-authored item. `docs/07` §6.2:
  "Never overwrite a user-authored `extra` line"; existing items are *added to a
  collection*, nothing more.

**Done when.**
- [ ] Importing 100 pre-fetched records creates 100 items in the target
      collection in ≤ 10 s of plugin+DB time (NFR-1), recorded in the spec
      output.
- [ ] Re-running the same import creates 0 new items and reports
      `linkedExisting: 100` (FR-51).
- [ ] Every created item carries the `research_helper` automatic tag.
- [ ] A record whose mapping throws is counted in `failed[]` and does not abort
      the batch or the remaining batches.
- [ ] `abstractCoverage` is reported and matches a hand count on a fixture set.
- [ ] The UI is interactive during a 200-item import (manual observation noted in
      the spec comments; NFR-3).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/07` §7.2 marks both the chunk size of 50 and the safety of
notifier suppression as **unverified** and says to "start at 50 and instrument
it" against a real 200-item import. Record the measured numbers in the spec so
`docs/07` can be updated with a verified value; spike `V-12` is the Phase 0
precursor.

---

### P1-T15 — `ProgressReporter` and its Zotero surfaces

| Field | Value |
|---|---|
| **ID** | `P1-T15` |
| **State** | `TODO` |
| **Depends on** | `P1-T02` |
| **Blocks** | `P1-T16` |
| **Retires** | none |
| **Implements** | `FR-53`, part of `NFR-3` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** One progress tree drives the dialog's status bar and a throttled
Zotero progress surface, with current/total counts, an ETA and a working Cancel.

**Read first.**
- `docs/07-architecture-and-data-model.md` §4.1 — the `ProgressReporter`
  interface: `setMessage`, `setProgress`, `increment`, `child(label, from, to)`,
  `warn`, `done`, and the fact that a reporter is a *tree*.
- `docs/07-architecture-and-data-model.md` §7.7 — the two v1 surfaces
  (`Zotero.ProgressWindow` and the plugin's own in-window status list), why
  `Zotero.ProgressQueue` is not one of them, the verified `Zotero.ProgressWindow`
  API listing, the `ZoteroProgressWindowReporter` sketch with its 250 ms repaint
  throttle, the `alwaysontop` caveat, and the unverified note on the
  `ProgressWindow` / `ItemProgress` signatures.
- `docs/08-ui-ux-spec.md` §8.2 — how `Zotero.ProgressWindow` is used in this
  plugin, and §8.2.1 for the decision *not* to build on `ProgressQueue`.
- `docs/08-ui-ux-spec.md` §4.4 — progress lives *inside the search window's
  status bar* because that is where the Cancel button is; a toast is raised only
  on completion.
- `docs/10-requirements-and-user-stories.md` FR-53 — current/total counts, an
  estimated remaining time, and cancellable.

**Files.**
- create `src/core/jobQueue/progress.ts`
- create `src/zotero/progressWindow.ts`
- create `test/unit/core/progress.test.ts`

**Do.**
1. Implement a `CompositeProgressReporter` in `core/` fanning out to registered
   sinks, with `child()` mapping a `0..1` sub-range into its slice of the parent.
2. Compute an ETA from completed/total and elapsed time, exposed on the
   snapshot; FR-53 requires it.
3. Implement the Zotero sink in `src/zotero/progressWindow.ts` following
   `docs/07` §7.7's sketch, including the ≥ 250 ms repaint throttle.
4. Implement a dialog sink that the search window's status bar subscribes to
   (`docs/08` §4.4).
5. `warn()` collects non-fatal issues for the completion summary rather than
   raising a popup (`docs/07` §4.1).

**Do NOT.**
- Do **not** repaint per item. `docs/07` §7.7: at most ~4×/second; "a 200-item
  loop must not repaint 200 times", and NFR-3 caps main-thread work at 100 ms.
- Do **not** leave a `Zotero.ProgressWindow` open for the life of a long job.
  `docs/07` §7.7 records the `alwaysontop=yes` complaint — it floats above other
  applications — and prescribes `startCloseTimer()` aggressively.
- Do **not** use `Zotero.showZoteroPaneProgressMeter`. `docs/07` §7.7: it is
  reserved for blocking operations and "nothing in this plugin should block the
  pane".
- Do **not** assume the `ProgressWindow`/`ItemProgress` signatures are right.
  `docs/07` §7.7 marks them **unverified against Zotero 10** and says to confirm
  against `progressWindow.js`; wrap the calls so a signature change is one edit.
- Do **not** build a sink on `Zotero.ProgressQueue`. `docs/08` §8.2.1 and
  `docs/01` §10.4 decide against it — fixed three-column dialog, `getString()`
  throws on a plugin FTL key, a session-long leak, no Cancel button — and
  `docs/07` §7.7 defers to them. The bulk surface is the dialog sink in step 4.

**Done when.**
- [ ] `child("fetch", 0, 0.6)` reporting 50 % maps to 30 % on the parent.
- [ ] Under a fake clock, 200 `increment()` calls produce ≤ 4 sink repaints per
      simulated second.
- [ ] `done("cancelled")` makes all further calls no-ops.
- [ ] The ETA is `undefined` while `total` is undefined and becomes a number
      once it is known.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- progress
```

**Notes.** `searchImport` needs the "200 items, 187 succeeded, 13 failed" shape
that `ProgressQueue`'s per-row `ROW_QUEUED/PROCESSING/FAILED/SUCCEEDED` model
expresses, but not that widget: `docs/08` §8.2.1 and `docs/01` §10.4 both decide
against `Zotero.ProgressQueue`, and `docs/07` §7.7 defers to them. The two sinks
this card ships — the `ProgressWindow` toast and the in-window status bar of
`docs/08` §4.4 — are therefore the complete v1 set, not a first instalment.
`P3-T29` reports per-item summarize progress through the same interface, into
`docs/08` §6.4's list.

---

### P1-T16 — `searchImport` pipeline

| Field | Value |
|---|---|
| **ID** | `P1-T16` |
| **State** | `TODO` |
| **Depends on** | `P1-T09`, `P1-T10`, `P1-T14`, `P1-T15`, `P1-T07` |
| **Blocks** | `P1-T22`, `P2-T02` |
| **Retires** | part of `R-2` |
| **Implements** | `FR-9`, `FR-10`, `FR-53`, part of `FR-3` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The stages between "user pressed Search" and "items are in the
collection" run in order, honour cancellation at every documented checkpoint,
and survive a source failure without losing the run.

**Read first.**
- `docs/07-architecture-and-data-model.md` §12.1 — the `searchImport` state
  machine: `Planning → Fetching → Merging → Deduping → BackfillingAbstracts →
  CreatingCollection → WritingItems`, with `PartialFetch` as a **first-class
  state**, and the transitions into `Cancelling`/`Failed`.
- `docs/07-architecture-and-data-model.md` §7.4 — the four cancellation
  checkpoints and, critically, the per-pipeline semantics: for `searchImport`,
  items already written are **kept**, the collection is kept with a note that the
  import was partial, and there is **no rollback**.
- `docs/07-architecture-and-data-model.md` §4.5 — `Pipeline<TInput, TOutput>`,
  `StageDescriptor`, `ValidationResult`, `PipelineEstimate`, `PipelineContext`;
  implement the interface even though Phase 1 runs it directly.
- `docs/10-requirements-and-user-stories.md` FR-9 and FR-10 — partial failure
  keeps the other sources' results and names the failed one; cancel aborts
  in-flight requests within 2 s and creates no items.
- `docs/08-ui-ux-spec.md` §8.4 — the five states every list-bearing surface
  needs (INITIAL / LOADING / EMPTY / PARTIAL / ERROR), with PARTIAL called out as
  the one plugins forget — and `docs/08` §4.6 for how the search window draws
  them. §4.6 also draws a fifth panel, **Re-run (pre-filled from provenance)**,
  which is FR-12's and belongs to `P2-T17`; it is not one of §8.4's five.

**Files.**
- create `src/pipeline/types.ts`
- create `src/pipeline/registry.ts`
- create `src/pipeline/searchImport/searchImportPipeline.ts`
- create `src/pipeline/searchImport/stages.ts`
- create `src/pipeline/searchImport/types.ts`
- create `src/bootstrap/container.ts`
- create `src/bootstrap/registerPipelines.ts`
- create `test/unit/pipeline/searchImport.test.ts`

**Do.**
1. Transcribe `docs/07` §4.5's `Pipeline` and `PipelineContext` types; implement
   `validate()` (empty query, no source selected, limit out of range) and a
   trivial `estimate()` returning request counts and zero cost — Phase 1 spends
   no money, but §11.3 requires the member to exist.
2. Declare `stages` matching `docs/07` §12.1's states, with weights, so
   `P1-T15`'s progress tree can be built from them.
3. Implement `run()` stage by stage. With one source, `Merging` and `Deduping`
   are identity passes — implement them as named no-op stages so Phase 2 has the
   seam, and say so in a comment.
4. Wrap each source's `searchAll` in its own try/catch, collecting a
   `{ sourceId, error }` list; if at least one source succeeded, enter
   `PartialFetch` and continue. Only an all-sources failure is `Failed`.
5. Call `ctx.token.throwIfCancelled()` before each page, each `efetch` batch,
   each write batch, and between stages (`docs/07` §7.4's four places).
6. On cancel during `WritingItems`, keep what is written and append the partial
   note to the collection description; on cancel before `CreatingCollection`,
   create nothing.
7. Build a tiny typed DI container in `src/bootstrap/container.ts` — enough to
   hand the pipeline its `PipelineContext` dependencies.

**Do NOT.**
- Do **not** roll back written items on cancel. `docs/07` §7.4 is explicit:
  "deleting user-visible items on cancel is surprising and destructive". FR-10's
  "no items are created" applies to cancelling *the search*, before any write
  (conflict C7).
- Do **not** treat one source's failure as the run's failure. `docs/07` §12.1:
  "`PartialFetch` is a first-class state, not an error"; FR-9 requires the other
  sources' results plus a non-blocking banner.
- Do **not** implement `checkpoint()`/`resumeState` for real. Phase 3 owns the
  persistent queue (§3); accept the members and make `checkpoint()` a no-op,
  with `resumable: false`.
- Do **not** call an adapter from the UI. `docs/07` §2.3: "`ui/` never calls an
  adapter directly — only pipelines and the job queue."
- Do **not** touch the DOM from `pipeline/` (`docs/07` §2.3).
- Do **not** let `Deduping` merge anything in Phase 1. `R-18` makes a false merge
  the expensive error and Phase 2 owns the cascade with its labelled corpus.

**Done when.**
- [ ] A stubbed source that throws on page 2 yields the page-1 records plus one
      warning naming the source, and the run succeeds.
- [ ] All sources failing produces a `Failed` outcome carrying each source's
      typed error.
- [ ] Cancelling during `Fetching` aborts the in-flight request and creates zero
      items and zero collections (FR-10).
- [ ] Cancelling during `WritingItems` keeps the already-written items and the
      collection, and the run reports `cancelled` with a count.
- [ ] Stage weights sum to 1 and the progress tree reaches exactly 100 % on
      success.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- searchImport
```

**Notes.** The two-second abort budget in FR-10 is achievable only because
`P1-T05` wires `cancellerReceiver`; if spike `V-9` reported that abortion does
not work, this card's cancellation criteria cannot be met and the phase needs
re-planning before it starts.

---

### P1-T17 — Provenance record, note writer and JSON export

| Field | Value |
|---|---|
| **ID** | `P1-T17` |
| **State** | `TODO` |
| **Depends on** | `P1-T09`, `P1-T14` |
| **Blocks** | `P1-T22`, `P2-T17` |
| **Retires** | none |
| **Implements** | `FR-8`, part of `FR-4` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Every run leaves a machine-readable record of exactly what was asked
of PubMed and what came back, as a note in the collection and as an exportable
JSON file that validates.

**Read first.**
- `docs/07-architecture-and-data-model.md` §5.3 "Search provenance" — the
  **sole authoritative declaration** of `SearchProvenance` and
  `SourceProvenance`: type names, field names, field types, the
  `schemaVersion: 1` literal, `runId`, `userQuery`, the
  `dateFilter: {fromIso,toIso} | "none"` union, `targetLibraryId` /
  `targetCollectionKey`, the `totals` block, and per source `endpointBaseUrl`,
  `transmittedQuery`, `transmittedUrl`, `dateFilterApplied`, `requestedLimit`,
  `rawHitCount`, `recordsRetrieved`, `recordsDeduplicatedAway`,
  `recordsImported`, `error: SerializedError | undefined` and `sourceExtras`.
  Transcribe it, do not paraphrase. §5.3 also states the division of labour:
  it owns the *shape*, FR-8 owns the *field list*, and a field in one with no
  counterpart in the other is a defect worth reporting rather than papering over.
- `docs/07-architecture-and-data-model.md` §5.3, "Where it lives", and §8.3's
  `search_provenance` DDL — read them to know what Phase 1 does **not** build:
  the authoritative SQLite row is `P2-T17`'s (§3).
- `docs/10-requirements-and-user-stories.md` FR-8 — the **required field list**
  §5.3's shape has to satisfy: per source, endpoint base URL, transmitted query
  string (keys redacted), date filter, requested limit, raw hit count reported
  by the source, records retrieved, records deduplicated away, records imported
  — "required even when they are zero"; the note title format
  `Research Helper — search provenance <ISO timestamp>`; and the "Export
  provenance as JSON" action.
- `docs/10-requirements-and-user-stories.md` FR-3 — the provenance fields
  `dateFilter: none` and `dateFilterApplied: client` that the date handling must
  record.
- `docs/10-requirements-and-user-stories.md` FR-4 — "the exact URL (with API
  keys redacted) is written to the provenance record and to the debug log".
- `docs/07-architecture-and-data-model.md` §5.1, `WorkProvenance` — the *other*
  provenance type, per-work and carried on `CanonicalWork` (`recordIds`,
  `fieldOrigin`, `seenIn`). Read it so you do not conflate the two: §5.3's
  run-level record holds counts and transmitted URLs and does **not** enumerate
  works, and this card writes none of `WorkProvenance`'s fields.
- `docs/01-zotero-plugin-platform.md` §5.7 — how a standalone note is created
  and set into a collection, and the warning that note content is **HTML**: do
  not paste Markdown into `setNote()`.
- `docs/13-testing-build-and-release.md` §2.1, "Provenance" row — the two tests:
  JSON-schema conformance and key redaction.
- `docs/09-security-privacy-and-api-keys.md` §2.1 — the redaction rules NFR-16
  requires here; a provenance record is one of the four named leak channels.

**Files.**
- create `src/core/provenance.ts`
- create `src/zotero/notes.ts`
- create `schema/provenance.schema.json`
- create `test/unit/core/provenance.test.ts`

**Do.**
1. Transcribe `docs/07` §5.3's two interfaces into `src/core/provenance.ts`
   unchanged — including the file's own header comment, "pure; imports only
   `model/` (§2.3)". Do not add a field and do not drop one. PubMed's `count`,
   `querytranslation` and `translationset` from `P1-T09` go in
   `SourceProvenance.sourceExtras`, which §5.3 declares for exactly that
   purpose; they are not new top-level fields.
2. Generate `schema/provenance.schema.json` **from** those interfaces — a JSON
   Schema draft 2020-12 document, as §5.3 specifies — and validate a real
   `SearchProvenance` object against it in the unit test (`docs/13` §2.1's
   "Provenance" row). The file is declared in `docs/07` §2.2's tree and in
   `docs/13` §1.2's layout; this card creates it, it does not invent its
   contents.
3. Render the note as the conservative HTML subset `docs/01` §5.7 lists, titled
   per FR-8, tagged `research_helper`, written as a standalone note in the target
   collection.
4. Implement `exportJson(path)` writing the same object, pretty-printed.
5. Redact `api_key` from every recorded URL before it reaches either output.

**Do NOT.**
- Do **not** put a key, or anything key-shaped, in the record. NFR-16 names
  provenance records explicitly, and `docs/09` §2.1's patterns are the test.
- Do **not** write Markdown into `setNote()`. `docs/01` §5.7: "it will render as
  literal text"; convert to the allowed HTML subset yourself.
- Do **not** declare a local provenance type. `docs/07` §5.3 is the sole
  declaration (`README.md` §5 rule 3), `P2-T17` reads these exact records back
  for FR-12, and `docs/13` §2.1 validates them against the shipped schema file —
  a second shape breaks all three.
- Do **not** invent fields that change FR-8's meaning, and do not omit one.
  `totals.deduplicatedAway` and each source's `recordsDeduplicatedAway` are `0`
  in Phase 1 with one source — §5.3 says so in the field's own comment ("`0`,
  not absent") and FR-8 requires the counts "even when they are zero". Record
  the `0`, or Phase 2's records become incomparable.
- Do **not** widen `sourceExtras` into a dumping ground. §5.3: "Never a
  credential, never a raw body."
- Do **not** store the record only in the note. FR-8's export must produce the
  machine-readable object, so the note is a projection of it, not the source.
- Do **not** attach it to an item. FR-8 says a **standalone note in the
  collection**.

**Done when.**
- [ ] A completed run produces a note whose title matches
      `/^Research Helper — search provenance \d{4}-\d{2}-\d{2}T/`.
- [ ] The exported JSON validates against `schema/provenance.schema.json`.
- [ ] Every field name in `src/core/provenance.ts` matches `docs/07` §5.3
      character-for-character (reviewed by diff, not by memory), and every FR-8
      quantity has a field, including a `0` for deduplicated-away.
- [ ] `schemaVersion` is the literal `1` and the emitted JSON carries it.
- [ ] A run made with a stubbed NCBI key produces a record in which
      `grep -c "api_key=" ` is 0 and the redaction marker is present.
- [ ] `dateFilter: "none"` is recorded when the user chose "All years" (FR-3).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:unit -- provenance
```

**Notes.** Conflict C8 is closed: `docs/07` §5.3 declares the record and names
`schema/provenance.schema.json` as its artefact, so this card *implements* a
declaration instead of inventing one. Two consequences worth holding in mind
while building it. First, §5.3 says the authoritative copy is a row in the
SQLite `search_provenance` table and that the note is "a *projection* of that
row, never the source of truth" — but Phase 1 ships no plugin-owned SQLite
(§3), so here the run's in-memory `SearchProvenance` is the source and the note
and the export are both projections of it. `P2-T17` adds the table and inherits
this object unchanged, which is why the shape must not drift. Second, `docs/02`
§12.4 notes PubMed's `translationset` is free MeSH expansion "worth surfacing to
the user"; `SourceProvenance.sourceExtras` is where §5.3 puts it, and `docs/02`
§12.4 itself now points there.

---

### P1-T18 — Localization scaffolding for the Phase 1 strings

| Field | Value |
|---|---|
| **ID** | `P1-T18` |
| **State** | `TODO` |
| **Depends on** | `P1-T02` |
| **Blocks** | `P1-T19` |
| **Retires** | none |
| **Implements** | part of `FR-55`, `NFR-11` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes** — a native Korean speaker must review the `ko-KR` bundle. An agent may draft it but must not sign it off. |

**Goal.** Every string Phase 1 introduces exists as a Fluent message in both
`en-US` and `ko-KR`, resolves in the right document, and falls back to English
rather than showing an identifier.

**Read first.**
- `docs/01-zotero-plugin-platform.md` §9.1 — Fluent is the only mechanism, files
  are auto-registered with **no registration call**, and the per-plugin directory
  layout.
- `docs/01-zotero-plugin-platform.md` §9.3 — **both namespace footguns**: Fluent
  IDs share a global namespace per document (prefix every ID
  `research-helper-`), and *filenames* share a global namespace too. A collision
  silently shadows.
- `docs/08-ui-ux-spec.md` §10.1 — the per-surface file list, the Zotero 10
  rework of plugin localization (`registerLocales`, per-file per-locale
  fallback), the mechanism table for each surface, the "insert the FTL **before**
  touching the DOM" rule and the removal-on-unload rule, and the warning that a
  plugin shipping only `ko-KR` shows Korean to every user on the pre-10 path.
- `docs/08-ui-ux-spec.md` §10.2 — the sample strings and message shapes to
  follow, including the plural selector form.
- `docs/08-ui-ux-spec.md` §10.3 — never concatenate; format numbers and dates
  with `Intl` using `Zotero.locale`; do not translate database or provider names.
- `docs/07-architecture-and-data-model.md` §10.1 — every error class carries a
  `messageKey`; those keys must exist in both bundles or errors render as IDs.

**Files.**
- create `addon/locale/en-US/research-helper-mainWindow.ftl`
- create `addon/locale/en-US/research-helper-searchDialog.ftl`
- create `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- create `addon/locale/ko-KR/research-helper-searchDialog.ftl`
- create `src/i18n/ftl.ts`
- create `src/i18n/keys.ts`
- create `test/integration/l10n.spec.ts`

**Do.**
1. Create the four `.ftl` files under the `research-helper/` subfolder in both
   locales, per `docs/01` §9.1 and `docs/08` §10.1.
2. Enumerate every Phase 1 string: the two menu entries, every control label and
   tooltip in the search window, the five list states (`docs/08` §8.4), the
   import-summary counts, the provenance note title, every `messageKey` in
   `docs/07` §10.1 that Phase 1 can throw, and the PubMed `displayNameKey`.
3. Use one Fluent message with `{ $count }` for anything counted; `docs/08`
   §10.3 forbids concatenation, and §10.2 shows the selector shape.
4. Implement `src/i18n/keys.ts` as typed message IDs and `ftl.ts` as the lookup
   helper, following the template's `src/utils/locale.ts` rather than guessing —
   `docs/01` §9.2 marks the exact `Localization` argument form **unverified**.
5. Draft `ko-KR` and hand it to a human reviewer. Korean has a single plural
   category, so keep the selector with only `*[other]` (`docs/08` §10.3 note).

**Do NOT.**
- Do **not** ship an ID without the `research-helper-` prefix, and do not put a
  file anywhere but flat under `locale/<lang>/`, named `research-helper-<surface>.ftl` (Zotero 10 drops subdirectories there — `docs/01` §9.1, `P0-T32`). `docs/01` §9.3: "A
  collision does not error — it silently shadows, which is far worse."
- Do **not** omit `en-US`. `docs/08` §10.1: on the pre-Zotero-10 fallback path a
  plugin shipping only `ko-KR` shows Korean strings to *every* user.
- Do **not** write `"Imported " + n + " items"` anywhere. `docs/08` §10.3: it
  breaks Korean word order.
- Do **not** translate "PubMed", "Zotero", "DOI", "PMID", or a model ID
  (`docs/08` §10.3).
- Do **not** use `formatValueSync()` — `docs/08` §10.1 calls it "strongly
  discouraged" in Mozilla's own words.
- Do **not** specify a font family for Korean. `docs/08` §10.3: "Korean glyph
  coverage is the OS's job."
- Do **not** modify the DOM of a shared window before inserting the FTL — the
  Zotero 7 docs quoted in `docs/08` §10.1 are explicit about the ordering.

**Done when.**
- [ ] Every `data-l10n-id` used in Phase 1 markup resolves in `en-US`, asserted
      by a test that scrapes the XHTML and diffs against the FTL keys.
- [ ] Both bundles have identical key sets, asserted.
- [ ] With `Services.locale.requestedLocales = ["ko-KR"]` (the switch `P0-T24` found actually works; restore it afterwards), a known key resolves to Korean; a key
      deliberately removed from `ko-KR` falls back to English, not to an
      identifier (integration spec; spike `V-17`).
- [ ] `grep -c "^[a-z]" ` on each FTL shows no ID lacking the
      `research-helper-` prefix.
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Conflict C3 is closed on this half too: `docs/07` §2.2's tree now
shows flat `addon/locale/en-US/` and `ko-KR/` holding `research-helper-<surface>.ftl` files (corrected 2026-09-14) and
defers the per-surface file list to `docs/08` §10.1, which is the layout this
card builds — one `.ftl` per surface, same names in both locales. `docs/08`
§10.1 lists four surfaces (`mainWindow`, `searchDialog`, `reportWindow`,
`preferences`); Phase 1 ships only the first two, and the other two arrive with
the surfaces that need them. Spike `V-17` (`docs/11` §4.3) must have confirmed
that Zotero 10's consolidated FTL registration works with a `ko-KR` bundle before
this card's fallback criterion can pass. Human gate details go in
[`06-human-gates.md`](06-human-gates.md).

---

### P1-T19 — Menu entry points and the window opener

| Field | Value |
|---|---|
| **ID** | `P1-T19` |
| **State** | `TODO` |
| **Depends on** | `P1-T18` |
| **Blocks** | `P1-T20`, `P2-T17` |
| **Retires** | none |
| **Implements** | `FR-1`, part of `FR-56` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** "Search literature…" is reachable from the Tools menu and from a
collection's context menu with that collection pre-selected as the target, and
every registration is removed cleanly on shutdown.

**Read first.**
- `docs/08-ui-ux-spec.md` §2.1 — `Zotero.MenuManager.registerMenu`, the verbatim
  `VALID_TARGETS` list (`main/menubar/tools` and `main/library/collection` are
  the two Phase 1 needs), and the `MenuOptions`/`MenuData` typedefs.
- `docs/08-ui-ux-spec.md` §2.3 — auto-grouping for `main/library/collection`:
  Zotero prepends its own separator, overflows into a submenu, and **rejects
  top-level separators**; register exactly one top-level submenu per context.
- `docs/08-ui-ux-spec.md` §2.4 — the registration code shape and the
  `registeredMenuIDs` teardown list. Its collection block now also carries the
  FR-12 `research-helper-menu-collection-rerun` `menuitem` with its
  `context.setVisible(...)` guard and `mode: "rerun"`; that entry is **Phase 2's**
  (`P2-T17`) and is not built here — see **Do NOT**.
- `docs/08-ui-ux-spec.md` §2.5 — the collection-submenu wireframe, so the entries
  this card does register land in the documented order.
- `docs/08-ui-ux-spec.md` §2.4.1 and §2.4.2 — why hand-injecting `<menuitem>` is
  wrong, and that `ztoolkit.Menu.register` has been **deleted**.
- `docs/08-ui-ux-spec.md` §4.1 — `openDialog` with a window *name* for a
  modeless singleton, the `chrome://researchhelper/content/` namespace, and the
  warning against passing a `jar:file:///…!/` URL.
- `docs/01-zotero-plugin-platform.md` §2.5 — registering the `chrome://`
  namespace via `amIAddonManagerStartup.registerChrome`.
- `docs/01-zotero-plugin-platform.md` §3.4(a) — the plural collection-selection
  getters; the context-menu handler reads the selection.
- `docs/10-requirements-and-user-stories.md` FR-1 — the three acceptance
  criteria, including that `Escape` closes the dialog "with no side effects and
  no network request".

**Files.**
- create `src/ui/menus/registerMenus.ts`
- create `src/ui/dialogs/searchDialog.ts`
- create `src/bootstrap/registerUI.ts`
- modify `src/hooks.ts`
- create `test/integration/menus.spec.ts`

**Do.**
1. Register exactly one top-level submenu on `main/menubar/tools` and one on
   `main/library/collection`, with `l10nID`s from `P1-T18`.
2. The collection entry reads `ZoteroPane.getSelectedCollections()`, requires
   exactly one, and passes its ID as the pre-selected import target.
3. Implement `openSearchWindow(args)` per `docs/08` §4.1: `openDialog` with the
   window name `research-helper-search`, `dialog=no`, `centerscreen`,
   `resizable`, and `args` as `window.arguments[0]`.
4. Keep `registeredMenuIDs` and unregister everything in `onMainWindowUnload` /
   `onShutdown` (FR-56).
5. Register the `chrome://researchhelper/content/` namespace in `bootstrap.js`
   per `docs/01` §2.5.

**Do NOT.**
- Do **not** register a top-level `separator` for `main/library/collection`.
  `docs/08` §2.3: `_validate()` rejects it and **registration silently fails for
  the whole menu**.
- Do **not** register more than one top-level item per context. §2.3: one
  submenu costs one slot in the grouping budget regardless of how many commands
  it holds, so menu placement stays stable whatever else the user has installed.
- Do **not** hand-inject `<menuitem>` elements (§2.4.1) and do **not** call
  `ztoolkit.Menu.register` — §2.4.2 records that it has been deleted.
- Do **not** copy the `research-helper-menu-collection-rerun` entry out of
  `docs/08` §2.4's block, even though it is now shown there. Its `onShowing`
  guard calls `RH.provenance.hasRunForCollection(...)`, which reads the
  `search_provenance` SQLite table that does not exist until `P2-T17` creates it;
  a Phase 1 copy would either throw or register a permanently invisible entry.
  FR-12 is a Phase 2 deliverable (`docs/11` §1). Same for the other three
  collection commands in that block, which belong to Phases 2–3.
- Do **not** call `ZoteroPane.getSelectedCollection()` (singular). `docs/01`
  §3.4(a): it **throws** on Zotero 10, and Zotero's own docs page still shows it.
- Do **not** pass `rootURI + 'content/…'` to `openDialog`. `docs/08` §4.1: a
  `jar:` URL "is used in the wild but is **not** the documented path".
- Do **not** issue any network request when the window opens or when `Escape`
  closes it — FR-1's third criterion.
- Do **not** open a second window. The window *name* makes it a singleton that
  re-focuses; `docs/08` §4.1 explains why that matters for a tens-of-seconds
  search.

**Done when.**
- [ ] Tools ▸ Research Helper ▸ Search literature… opens the window.
- [ ] Right-clicking a collection offers the entry and the opened window has that
      collection pre-selected as the target.
- [ ] Invoking the menu twice focuses the existing window instead of opening a
      second one.
- [ ] `Escape` closes the window with no network request in the debug log.
- [ ] Disable/enable cycling the plugin five times leaves no menu item and no
      error in the debug log (FR-56).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** Conflict C3 was resolved upstream on 2026-09-09: the docs now agree on
`searchDialog.*`. The **module** is `src/ui/dialogs/searchDialog.ts` — that is
the header on `docs/08` §4.1's own code block — while the **exported function**
remains `openSearchWindow` and the controller object in the document is
`RHSearchWindow`, because the surface is a modeless window, not a modal dialog.
Do not "tidy" either name into agreement with the other.
The disable/enable criterion is the same one spike `V-4` answers in Phase 0 — if
that spike found residue, fix it there, not here.

---

### P1-T20 — Search & Import window: markup and controls

| Field | Value |
|---|---|
| **ID** | `P1-T20` |
| **State** | `TODO` |
| **Depends on** | `P1-T03`, `P1-T07`, `P1-T19` |
| **Blocks** | `P1-T21` |
| **Retires** | none |
| **Implements** | `FR-1`, `FR-2`, `FR-3`, part of `FR-5`, `NFR-13` |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** The window exists with every control `docs/08` §4.2 specifies, sized
and themed the Zotero way, keyboard-navigable, with the date range defaulting to
the last three calendar years and a target-collection picker.

**Read first.**
- `docs/08-ui-ux-spec.md` §4.1.1 — the Zotero 7+ `<window><dialog>` markup to
  copy, and its **four non-obvious requirements**: XUL `width`/`height` are
  ignored (use CSS), `Zotero.UIProperties.registerRoot(rootEl)` must be called in
  `init()`, a new window needs its own `<tooltip id="html-tooltip">` element,
  and arguments arrive via `window.arguments[0]`.
- `docs/08-ui-ux-spec.md` §4.2 — the complete control table and the date-default
  rule: `fromYear = currentYear - 2`, computed at window open, with the exact
  span shown in the label (`2024 – 2026`). Read the table for *which controls
  exist and in what shape*, not for their defaults: `docs/07` §8.5 owns every
  default, and §4.2's rows now say so themselves — the "Max results per DB" row
  deliberately no longer restates a number and defers to §8.5 (see **Do NOT**).
  The row's "Search mode chip" lists four `mode` values; Phase 1 ships
  `keyword` only.
- `docs/08-ui-ux-spec.md` §4.5 — the wireframe, which fixes the layout order.
  Its "Max per database" field reads `[100]`, matching `docs/07` §8.5.
- `docs/08-ui-ux-spec.md` §4.6 — it draws **five** states; **four of them are
  this card's**: initial, searching (the per-database status list), no results,
  all databases failed. The fifth, **Re-run (pre-filled from provenance)**, is
  FR-12's and belongs to `P2-T17` in Phase 2 — do not build it here. A sixth,
  PARTIAL, is `docs/08` §8.4's and is wired in `P1-T22`.
- `docs/08-ui-ux-spec.md` §9 — accessibility: keyboard navigation, focus,
  accessible names.
- `docs/10-requirements-and-user-stories.md` NFR-13 — full keyboard navigation,
  `Escape` cancels, `Enter` confirms, WCAG AA contrast in both themes.
- `docs/07-architecture-and-data-model.md` §8.5 — the defaults the controls seed
  from: `searchYears`, `maxResults`, `hideExisting`, `sources`.

**Files.**
- create `addon/content/searchDialog.xhtml`
- create `addon/content/searchDialog.js`
- create `addon/content/style/searchDialog.css`
- modify `src/ui/dialogs/searchDialog.ts`

**Do.**
1. Copy `docs/08` §4.1.1's markup shape exactly, including the `<linkset>` with
   the `searchDialog.ftl` localization link and the `<tooltip>` element.
2. Call `Zotero.UIProperties.registerRoot(document.getElementById('rh-search-dialog'))`
   in `init()` — §4.1.1 calls omitting it "a real accessibility defect".
3. Lay the controls out per §4.2 and §4.5: keyword input (focused on open, Enter
   triggers Search), the year range with its computed label, max-per-database,
   the source checkbox row rendered from the registry, the filter box and
   "Hide items already in my library", the target-collection picker with
   "New collection…", the duplicate-policy radio group, the status bar and
   Cancel, and the Import button (disabled until ≥ 1 row is selected).
4. Seed every default from `P1-T03`'s typed prefs, not from literals.
5. Implement the four states from §4.6 as swappable panels in the results area.
6. Size with CSS `min-width`/`min-height`; §4.1.1 requirement 1.

**Do NOT.**
- Do **not** set `width`/`height` attributes on the XUL `<window>`. `docs/08`
  §4.1.1: they have not been recognised since Firefox 115.
- Do **not** skip `Zotero.UIProperties.registerRoot` — without it the dialog
  ignores the user's Zotero font size, density and RTL setting.
- Do **not** rely on `tooltiptext` alone. §4.1.1 requirement 3: in a *new* window
  you need the XUL `<tooltip>` element plus `tooltip="html-tooltip"`, or no
  tooltip appears at all.
- Do **not** hard-code "last 3 years" as a fixed year pair or as 1095 days.
  §4.2 computes it at window open and requires the exact span in the label "so
  the user is never guessing". FR-3 now requires the same three calendar years
  and defers the computation to §4.2 (closed conflict **C10**, §4).
- Do **not** seed "Max results per DB" from a literal in `docs/08`. §4.2's row
  no longer states a number — it defers to `docs/07` §8.5, which ships
  `maxResults` at **`100`** (10–200, step 10) and states outright that where
  another document restates a default and disagrees, "this table wins and the
  other document is the defect". An earlier draft of that row named `50`; if you
  meet that figure anywhere, it is the stale one. Same rule for every other
  control on that table — read `P1-T03`'s typed prefs, never the §4.2 column.
- Do **not** put an inline `<script>` or a remote resource in the XHTML. `docs/01`
  §8.3: CSP applies to documents you create.
- Do **not** make a network call from this document. `docs/01` §8.3: do all
  network I/O in the privileged sandbox and pass results in.
- Do **not** fix widths on labels or buttons — `docs/08` §10.3: Korean menu
  labels can be longer, and a fixed width truncates them.
- Do **not** hard-code an English string in the markup; every visible string is a
  `data-l10n-id` from `P1-T18`.

**Done when.**
- [ ] The window opens at ≥ 880×600, honours the user's Zotero font size, and
      renders correctly in both light and dark themes.
- [ ] With today at 2026-09-09 the year range reads `2024 – 2026` and the label
      says the span explicitly.
- [ ] Tab order reaches every control, `Escape` closes, `Enter` in the keyword
      field starts a search.
- [ ] Unchecking every source disables Search and shows the inline message FR-2
      requires.
- [ ] Every visible string comes from the FTL bundle (no literal survives a grep
      of the XHTML).
- [ ] `npm run typecheck` exits 0 and `npm run build` produces an XPI.

**Verify with.**
```bash
npm run typecheck && npm run build && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** FR-2 requires seven source checkboxes; Phase 1 has one registered
source, so the row renders one checkbox from the registry (`docs/07` §11.1 step
11: "the source appears automatically in the search dialog because it is
rendered from the registry"). Do not fake the other six — a checkbox that
searches nothing is worse than an absent one, and Phase 2 adds them by
registration alone.

---

### P1-T21 — Result table, selection and filtering

| Field | Value |
|---|---|
| **ID** | `P1-T21` |
| **State** | `TODO` |
| **Depends on** | `P1-T20` |
| **Blocks** | `P1-T22` |
| **Retires** | none |
| **Implements** | `FR-5`, part of `FR-51`, `NFR-13` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** Search results are reviewable before anything is written: one row per
record with the columns FR-5 names, per-row checkboxes, select-all/none/invert,
a client-side filter, and an "already in my library" marker.

**Read first.**
- `docs/08-ui-ux-spec.md` §4.3 — the **decision for `research_helper`: use a
  plain scrollable `<html:table>` for v1**, with the reasoning; plus, if
  `VirtualizedTable` is ever adopted, the CJS-loader and window-scope hazards,
  the missing `getRowData` prop, and the `setLocale()` warning.
- `docs/08-ui-ux-spec.md` §4.2 — the column set (☑ / Title / Authors / Year /
  Source / Type / DOI), the select-all header checkbox, the filter box and the
  hide-existing checkbox. Its "Result table" row now reads *plain scrollable
  `<html:table>` (**§4.3**)* and names §4.3 as the owner, so the two agree; an
  earlier draft of that row said "virtualized table", and if you meet that
  wording it is the stale one. Take the columns from §4.2 and the widget from
  §4.3.
- `docs/08-ui-ux-spec.md` §4.5 — the wireframe, including how an
  already-in-library row is marked.
- `docs/10-requirements-and-user-stories.md` FR-5 — all rows checked by default;
  unchecking 5 of 40 imports exactly 35; Cancel creates zero items and performs
  **zero database writes**.
- `docs/08-ui-ux-spec.md` §9 — accessible table name and row strings.
- `docs/07-architecture-and-data-model.md` §8.5 — `hideExisting` default `true`,
  mirrored by the checkbox.

**Files.**
- modify `addon/content/searchDialog.js` (extend what `P1-T20` created)
- modify `addon/content/searchDialog.xhtml`
- modify `addon/content/style/searchDialog.css`
- create `test/integration/searchDialog-table.spec.ts`

**Do.**
1. Render a plain scrollable `<html:table>` inside an `overflow` container, per
   `docs/08` §4.3's decision for v1.
2. Columns exactly as §4.2 lists; all rows checked on arrival (FR-5).
3. Select all / none / invert, plus a live selected count feeding the Import
   button label.
4. Client-side filter over the fetched results, and the "Hide items already in my
   library" checkbox seeded from `hideExisting`, driven by `P1-T13`'s index.
5. Mark an already-present row visibly *and* textually — NFR-13: colour is never
   the sole carrier of meaning.
6. Give the table an accessible name and each row an accessible string
   (`docs/08` §4.3's `label` / `getRowString` requirement carries over to the
   plain-table implementation as `aria-label` and row text).

**Do NOT.**
- Do **not** reach for `VirtualizedTable` in Phase 1. `docs/08` §4.3's decision
  is explicit, and adopting it costs the `include.js`-in-the-right-window
  problem, whose failure mode Zotero's own source describes as "segfault Zotero".
- Do **not** call `VirtualizedTableHelper.setLocale()` if you ever do adopt it —
  §4.3: it mutates the global `Zotero.Intl.strings`.
- Do **not** write anything to the database when the user clicks Cancel. FR-5:
  "zero Zotero items are created and **zero database writes occur**".
- Do **not** filter server-side. §4.2: the filter is a client-side filter over
  already-fetched results.
- Do **not** convey "already in library" with a colour alone (NFR-13).
- Do **not** hide an existing row without a way to see it — `hideExisting`
  is a checkbox, and hiding must be reversible without re-running the search.

**Done when.**
- [ ] 40 results arrive with all 40 checked; unchecking 5 and importing creates
      exactly 35 items (FR-5).
- [ ] Cancel after a search performs zero database writes, asserted by a
      notifier spy.
- [ ] Typing in the filter narrows rows without re-issuing a request.
- [ ] Toggling "Hide items already in my library" hides and restores the marked
      rows.
- [ ] The table is reachable and operable by keyboard alone, and every row
      exposes a text label (NFR-13).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/08` §4.3's bounded-result-set argument (≤ 200 per database, a
few hundred rows) holds while `maxResults` caps at 200 (`docs/07` §8.5). If a
later phase raises that cap, revisit the decision — the section says to adopt
`VirtualizedTable` only if profiling shows a problem, and to budget time for the
window-scope hazard when doing so.

---

### P1-T22 — Wire search, import, progress, cancellation, five states

| Field | Value |
|---|---|
| **ID** | `P1-T22` |
| **State** | `TODO` |
| **Depends on** | `P1-T16`, `P1-T17`, `P1-T21` |
| **Blocks** | `P1-T23` |
| **Retires** | `R-17` (reported) |
| **Implements** | `FR-5`, `FR-6`, `FR-8`, `FR-9`, `FR-10`, `FR-51`, `FR-53`, `NFR-14` |
| **Estimate** | 0.75 d |
| **Human gate** | none |

**Goal.** The window drives the pipeline end to end: Search fills the table,
Import writes the collection and the provenance note, progress and Cancel work,
and every failure mode renders as one of the five documented states with an
actionable message.

**Read first.**
- `docs/08-ui-ux-spec.md` §4.4 — the exact ordered import pipeline the button
  runs, and the rule that progress lives in the window's status bar (because that
  is where Cancel is) with a completion toast only.
- `docs/08-ui-ux-spec.md` §4.6 — the rendered states, including the
  per-database status list ("Per-database status is essential") and the
  all-failed panel with its two actions. Four of §4.6's five states are Phase 1's;
  the **Re-run (pre-filled from provenance)** state is FR-12's and is `P2-T17`'s
  in Phase 2. The "five states" this card's title counts are `docs/08` §8.4's —
  INITIAL / LOADING / EMPTY / PARTIAL / ERROR — not §4.6's panel list.
- `docs/08-ui-ux-spec.md` §8.3 — the error taxonomy → user message table:
  `RATE_LIMIT`, `TIMEOUT`, `OFFLINE`, `UPSTREAM`, `PARSE`, `CANCELLED`, each with
  the action offered.
- `docs/08-ui-ux-spec.md` §8.4 — the five-state checklist, with PARTIAL named as
  the one plugins forget and the most common outcome for an aggregator.
- `docs/10-requirements-and-user-stories.md` NFR-14 — every error states what
  failed, which service, and one concrete next action; provider text goes in a
  details disclosure.
- `docs/10-requirements-and-user-stories.md` FR-10 — in-flight requests aborted
  within 2 s; the main window stays responsive.
- `docs/07-architecture-and-data-model.md` §10.2 — user-facing vs.
  developer-facing error content.

**Files.**
- modify `addon/content/searchDialog.js`
- modify `src/ui/dialogs/searchDialog.ts`
- create `src/ui/viewModels/searchImportViewModel.ts`
- create `test/integration/searchDialog-flow.spec.ts`

**Do.**
1. Implement the view model in `src/ui/` subscribing to `P1-T15`'s reporter and
   the pipeline's outcome; the window document only renders it.
2. Search: run `P1-T16`'s pipeline through the fetch stages, render the
   per-database status list from `docs/08` §4.6 as it progresses, and populate
   the table on completion.
3. Import: run the write stages in `docs/08` §4.4's order, then write the
   provenance note (`P1-T17`), then show the summary — "Imported N · Linked N ·
   Skipped N duplicates · N failed" plus the abstract-coverage percentage that
   measures R-17.
4. Cancel: cancel the token; render the `CANCELLED` message from `docs/08` §8.3
   with the count of items already imported.
5. Map every typed error from `docs/07` §10.1 onto `docs/08` §8.3's row, with the
   action that row offers, and put the raw upstream text behind a disclosure.
6. Raise the completion `ProgressWindow` toast only at the end, per §4.4.

**Do NOT.**
- Do **not** collapse per-database status into one spinner. `docs/08` §4.6:
  "partial failure across seven sources is the *normal* case, and collapsing it
  into one spinner hides the fact that a whole database was missed."
- Do **not** show a bare "An error occurred". NFR-14 forbids it, and `docs/07`
  §10.2 forbids showing a stack trace or a raw provider message as the primary
  text.
- Do **not** show a modal for a partial failure — FR-9 requires a **non-blocking**
  banner.
- Do **not** run the search on the document's own thread with synchronous
  parsing. FR-10 and NFR-3: the main Zotero window must stay responsive, in
  ≤ 100 ms slices.
- Do **not** import from the table's *filtered* view when rows are hidden —
  import exactly the checked set, or a hidden-but-checked row silently vanishes.
- Do **not** write the provenance note before the import finishes; its counts
  are outputs of the import (FR-8).

**Done when.**
- [ ] A real search populates the table and the per-database line shows
      `PubMed …… ✓ N results`.
- [ ] Import creates the collection, the items and exactly one provenance note.
- [ ] Cancel during fetching stops within 2 s and creates nothing (FR-10).
- [ ] With the network disconnected, the window shows the `OFFLINE` message and
      its Retry action, not a stack trace (NFR-9, NFR-14).
- [ ] A forced 429 renders the `RATE_LIMIT` row's message with its retry
      countdown.
- [ ] The summary reports linked-existing separately from created (FR-51).
- [ ] `npm run typecheck` exits 0.

**Verify with.**
```bash
npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** `docs/08` §8.3's table is written in terms of `{provider}` for LLM
errors; for a literature source substitute the source display name from its
`displayNameKey`. Everything user-visible here is a Fluent key added in
`P1-T18` — if a string is missing, add it there rather than inlining English.

---

### P1-T23 — Phase 1 definition-of-done run

| Field | Value |
|---|---|
| **ID** | `P1-T23` |
| **State** | `TODO` |
| **Depends on** | `P1-T11`, `P1-T22` |
| **Blocks** | none |
| **Retires** | `R-16`, `R-17`, part of `R-2` |
| **Implements** | `NFR-1`, `NFR-3`, `NFR-9`, `NFR-10` |
| **Estimate** | 1.0 d |
| **Human gate** | **Yes** — the DoD run hits the live NCBI API and a human must sign off the five criteria and the measured numbers before the phase is marked done. Only a human sets a task to `DONE` (`README.md` §4). |

**Goal.** Every bullet of §2 is executed against a real Zotero 10 and a real
PubMed, the numbers R-16 and R-17 need are recorded, and the phase is either
closed or its gaps are written up as new cards.

**Read first.**
- `docs/11-implementation-roadmap.md` §1, Phase 1 "Definition of done" — the five
  criteria this card executes, verbatim.
- `docs/13-testing-build-and-release.md` §8.1 and §8.2 — the manual QA checklist
  rows for install/lifecycle and for search and import; run them, they are the
  release gate this phase inherits.
- `docs/10-requirements-and-user-stories.md` NFR-1 — the measurement conditions:
  network pre-fetched/mocked, measured click-to-collection-contains-100.
- `docs/10-requirements-and-user-stories.md` NFR-10 — ≤ 200 ms added to Zotero
  startup and **no network request at startup**; measure it now, while the
  plugin is small.
- `docs/11-implementation-roadmap.md` §3, R-16 and R-17 — what each risk needs in
  order to be recorded as retired.
- `docs/02-literature-database-apis.md` §3.1 — NCBI's usage policy, before
  pointing a real run at it.

**Files.**
- create `test/integration/phase1-dod.spec.ts`
- create `docs/spikes/phase-1-dod.md` (measurements and sign-off)
- modify `plan/00-task-index.md` (mark states)

**Do.**
1. Run the five §2 criteria against Zotero 10.0.1 on the developer machine, with
   a real biomedical query returning ≥ 50 records.
2. Measure and record: NFR-1 (100 pre-fetched records, wall time), abstract
   coverage percentage (R-17), the write chunk size actually used and the time
   per chunk (R-16, feeding `docs/07` §7.2's unverified note), and NFR-10 startup
   delta.
3. Run `docs/13` §8.1 and §8.2's manual QA rows and record pass/fail per row.
4. Verify the re-run criterion: run the same search twice and confirm the second
   run links rather than duplicates.
5. Validate the exported provenance JSON against `schema/provenance.schema.json`.
6. Confirm the plugin is installable and non-broken: no menu item leads to an
   unimplemented feature (`docs/11` §0 principle 5).
7. Write anything that failed as a new `P1-T24+` card rather than fixing it
   silently, per `README.md` §5 rule 2.

**Do NOT.**
- Do **not** adjust a criterion to match the code. `README.md` §5 rule 6: if
  `Verify with` fails, report the failure.
- Do **not** run a large or repeated live search to get a number. `docs/02` §3.1
  quotes NCBI's guidance to schedule large jobs off-peak and warns that
  non-compliance can get the IP blocked.
- Do **not** mark the phase done with a red manual-QA row. `docs/11` §0 principle
  4: a phase is not done until its risks are demonstrably retired or explicitly
  re-classified.
- Do **not** set any task to `DONE` yourself — `README.md` §4: only the human
  does.
- Do **not** count a mocked import as the NFR-1 measurement *and* as the live
  acceptance run; they are two different bullets.

**Done when.**
- [ ] All five §2 criteria pass, each with evidence pasted into
      `docs/spikes/phase-1-dod.md`.
- [ ] NFR-1 measured and recorded; the figure is ≤ 10 s.
- [ ] Abstract coverage measured and recorded (R-17).
- [ ] Startup delta measured and ≤ 200 ms with zero startup network requests
      (NFR-10).
- [ ] `docs/13` §8.1/§8.2 rows recorded pass/fail.
- [ ] Every failure has a new task card, not a silent fix.
- [ ] A human has signed the report.

**Verify with.**
```bash
npm run lint:check && npm run typecheck && npm run test:unit && npm run test:contract && npm run build && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** This is the card that turns `docs/07` §7.2's "**Unverified:** the
exact optimal transaction chunk size" into a measured number — write the answer
back into `docs/07` in the same change. Human gate details go in
[`06-human-gates.md`](06-human-gates.md).

---

## 7. Estimate roll-up

| Task | Title | Est. (d) | Human gate |
|---|---|---|---|
| `P1-T01` | Canonical model and identifier normalizers | 0.75 | — |
| `P1-T02` | Core primitives: cancellation, clock, errors, logger | 1.00 | — |
| `P1-T03` | Preference schema, `PrefStore` port, `prefs.js` | 0.75 | — |
| `P1-T04` | Per-host token bucket and backoff | 1.00 | — |
| `P1-T05` | HTTP client over `Zotero.HTTP.request` | 1.00 | — |
| `P1-T06` | Tier-1 `SecretStore` for the NCBI key | 0.50 | **Yes** |
| `P1-T07` | `LiteratureSource` contract and registry | 0.50 | — |
| `P1-T08` | PubMed query builder | 0.75 | — |
| `P1-T09` | PubMed adapter: `esearch` → `efetch` | 1.25 | — |
| `P1-T10` | PubMed XML → `SourceRecord` mapper | 1.25 | — |
| `P1-T11` | Contract-test harness and PubMed fixtures | 0.75 | — |
| `P1-T12` | `CanonicalWork` → Zotero item JSON, `extra` contract | 1.00 | — |
| `P1-T13` | Existing-item detection by DOI and PMID | 0.50 | — |
| `P1-T14` | Batched importer and collection operations | 1.00 | — |
| `P1-T15` | `ProgressReporter` and its Zotero surfaces | 0.50 | — |
| `P1-T16` | `searchImport` pipeline | 1.00 | — |
| `P1-T17` | Provenance record, note writer, JSON export | 0.75 | — |
| `P1-T18` | Localization scaffolding (en-US + ko-KR) | 0.50 | **Yes** |
| `P1-T19` | Menu entry points and window opener | 0.50 | — |
| `P1-T20` | Search & Import window: markup and controls | 1.00 | — |
| `P1-T21` | Result table, selection and filtering | 0.75 | — |
| `P1-T22` | Wire search, import, progress, cancellation, states | 0.75 | — |
| `P1-T23` | Phase 1 definition-of-done run | 1.00 | **Yes** |
| | **Total** | **18.75 d** | **3 gates** |

### Comparison with `docs/11` — reconciled 2026-09-09

| | Days |
|---|---|
| `docs/11` §1, Phase 1 estimate, **current** | **18.75–26** |
| Task sum here | **18.75** |
| Divergence against the bottom of the band | **0 %** |
| (`docs/11`'s *previous* figure, for the record) | 9–12 |

There is no gap left to argue about: `docs/11` §1 was re-estimated **from this
table** on 2026-09-09 and now reads "18.75–26 developer-days — *measured*: the 23
task cards in `plan/02-phase-1-pubmed.md` sum to 18.75 d; the upper bound is that
× 1.4. (Was 9–12 d.)" `README.md` §7's rule — a divergence above ~30 % "is a
signal to re-estimate the phase in `docs/11`, not to quietly adjust the tasks" —
was applied in that direction. **No estimate in this file was adjusted to close
the gap**, then or since.

The reason the old figure was low is recorded in `docs/11` §1 itself and is
visible in the card list: the 9–12 d priced Phase 1 as "one adapter plus a
dialog", while its own "Modules touched" line commits the phase to the whole
shared core — `src/core/rateLimit/*`, `src/core/http/*`, `src/core/provenance.ts`,
`src/core/logger.ts`, `src/zotero/itemMapper.ts`, `src/model/canonicalWork.ts`,
the progress adapter and the l10n bundles. Nine of the twenty-three cards
(`P1-T01`–`P1-T07`, `P1-T15`, `P1-T17`) build machinery that Phases 2–7 consume
unchanged and never pay for again; they are ≈ 6.0 d of the 18.75, which is why
the whole-plan total moved by less than the per-phase numbers did.

One decision is still open, and it is **not** an estimate question: whether to
**split Phase 1 into 1a (core infrastructure, ≈ 6 d) and 1b (PubMed slice,
≈ 12.75 d)**, so that the "one vertical slice early" principle (`docs/11` §0
principle 2) is honest about its prerequisite. That proposal lives in
`plan/00-task-index.md` §5 item 2 and is flagged in `docs/11` §1; `docs/11` says
plainly that "that split is not made here". Whoever settles it changes `docs/11`
§1 and this file's headings, not any card's estimate.

---

## 8. Requirement coverage

**Fully implemented in Phase 1:** `FR-1`, `FR-3`, `FR-5`, `FR-6`, `FR-8`,
`FR-9`, `FR-10`, `FR-11`, `FR-51`, `FR-53`.

`FR-3` carried an asterisk here until 2026-09-09, because its worked example made
the default lower bound a rolling 36 months (`2026-09-08` → `2023-09-08`) while
`docs/08` §4.2 — which `docs/07` §8.5 names as the semantics owner of
`searchYears` — makes it three calendar years (`2024-01-01`). That was conflict
**C10** in §4, and it is now closed: FR-3 was rewritten to three calendar years
and defers the computation to §4.2, which is what Phase 1 already ships. Every
FR-3 clause is met, including `2024-01-01 … 2026-12-31` as the effective window,
`dateFilter: none` for "All years", and `dateFilterApplied: client`.

**Partially implemented, by design:**

| FR | What lands here | What is missing, and where it lands |
|---|---|---|
| `FR-2` | The dialog's source list, rendered from the registry, with the "at least one source" rule. | Six of the seven checkboxes, and the Semantic Scholar key notice — Phase 2. |
| `FR-4` | PubMed query translation, and the transmitted URL in provenance and the debug log. | The other six renderings, and Crossref's documented lossiness note — Phase 2. |
| `FR-7` | `journalArticle` mapping, and the `research_helper/uncertain-type` default. | `preprint` mapping — Phase 2 (`docs/11` §1). |
| `FR-54` | Redacted structured logging through `logLevel`, which FR-4 forces into Phase 1. | The debug bundle, the diagnostics export, and the prefs-pane checkbox — Phase 3 / Phase 7. |
| `FR-55` | Both bundles exist and fall back correctly for Phase 1's strings. | Every later phase's strings, and the release-time completeness check. |
| `FR-56` | Menu and window teardown (`P1-T19`). | Full lifecycle teardown of the job engine and panes — later phases. |

**NFRs exercised:** `NFR-1`, `NFR-3`, `NFR-6`, `NFR-9`, `NFR-10`, `NFR-11`,
`NFR-13`, `NFR-14`, `NFR-16`.

**Phase-1-adjacent FRs, and where they went:** `FR-12` (re-run a previous
search) is `(S)` and was placed in **Phase 2** by the 2026-09-09 documentation
pass — `docs/11` §1 now lists it as a Phase 2 deliverable and card `P2-T17`
implements it, "because its input — the FR-8 provenance record — ships in Phase 1
while its surface, the multi-source search window, is finished [in Phase 2]".
`P1-T17` is therefore a prerequisite of `P2-T17`, and its **Blocks** row says so.
`FR-52` (preferences pane) is Phase 3; `FR-50` (deduplication) is Phase 2.

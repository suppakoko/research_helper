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
| **State** | `DONE` — approved 2026-09-30; 111 unit tests green, field names diffed against `docs/07` §5.1 with 0 mismatches, three corpus defects fixed including §6.6's missing `s2:` work-key arm. |
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

**Findings, 2026-09-30 — all five criteria pass; six corpus defects found, one
of which needs a new card.**

**Verification, real output.** `Verify with` (`npm run typecheck && npm run
test:unit -- model`) exits **0**: 3 test files, **111 tests** passed.
`npm run lint:check` (`eslint . && prettier --check .`) exits **0** with zero
warnings; `npx eslint .` alone exits **0**. `npm run test` (unit + contract)
exits **0**. Exit codes were read with `echo $?` on the command itself, never
through a pipe — the `… | tail -5; echo $?` trap `P0-T12` hit reads `tail`'s
status.

**Coverage**, from `coverage/coverage-final.json` (the terminal table hides
fully-covered files; Vitest 5 turns on `coverage.skipFull` in an agent
environment, per `P0-T12`): `src/model` **99.17% statements / 100% functions**
overall — `ids.ts` 106/106 statements and 9/9 functions, `canonicalWork.ts`
15/15 and 5/5, `sourceRecord.ts` types only so 0/0. The only uncovered branches
are the `?? 0` index fallbacks inside `sha1Hex`'s block loop (lines 369–372,
377, 403), which `noUncheckedIndexedAccess` forces and which are unreachable by
construction — the array is padded to a multiple of 64 before the loop runs.

**Criterion 4 was measured, not eyeballed.** A throwaway script extracted
§5.1's four fenced `ts` blocks from `docs/07`, tokenised every
`export interface` / `export type` name, every `readonly <field>: <type>` and
every string-literal union arm, unwrapped Prettier's line wrapping, and diffed
the sequences against the three source files: **16 tokens for `ids.ts`, 56 for
`canonicalWork.ts`, 9 for `sourceRecord.ts`, 0 mismatches**, including the
`SourceId`, `ProviderId` and `WorkType` arm lists. The script lives in the
session scratchpad, not the repository — nothing in `Files` covers it.

**`sha1` resolution.** The injected-port option this card's Notes offers is not
open: §5.1 fixes `buildWorkKey`'s four parameters, and `crypto.subtle.digest`
is async, so a port would make a pure key-builder `await`. `src/model/ids.ts`
therefore carries a dependency-free FIPS 180-4 SHA-1 plus a hand-written UTF-8
encoder (`TextEncoder` is itself a platform global). It is asserted against the
three published RFC 3174 vectors *and* cross-checked against `node:crypto` on
ASCII, 2-byte, 3-byte (Korean) and 4-byte (emoji, surrogate-pair) input and on
every block-boundary length in 55/56/64/119/120/1000 bytes.

**Six corpus defects.**

1. **`docs/07` §5.1 has four code blocks, not three.** `Do` step 1 says
   "transcribe §5.1's three blocks into the three files"; the second block is
   `src/model/usage.ts` (`Usage`), which this card's `Files` list does not
   name. Nothing here references `Usage`, so nothing broke — but see defect 2.
2. **Three `src/model/` paths are `modify`ed by a card and `create`d by
   none**, against `plan/README.md` §4's rule that within a phase a path is
   created by exactly one card: `src/model/merge.ts` (first touched by
   `P2-T03`, `modify`), `src/model/usage.ts` (`P3-T06`, `modify`) and
   `src/model/summary.ts` (`P3-T18`, `modify`). **This is the one that needs a
   new card** — `usage.ts` is also the `AudioArtifact.usage` field
   `src/tts/types.ts` is already carrying as a documented absence.
3. **§2.2's directory comment and §5.1's code block disagree on where
   `ExternalIds` lives.** §2.2 line 189 attributes it to `canonicalWork.ts`;
   §5.1's first block declares it in `ids.ts`. §5.1 is the declaration and this
   card names it the sole authority, so `ids.ts` has it and
   `canonicalWork.ts` imports it. §2.2's comment should be corrected.
4. **§5.1 and §6.6 give the work key different derivations.** §5.1's `workKey`
   comment has five arms (`doi:` | `pmid:` | `arxiv:` | `s2:` | `hash:`); §6.6
   says "a key is derived from DOI → PMID → arXiv → title hash" — four arms,
   no `s2:`. §5.1's five are implemented. If §6.6's reader ever derives a key
   for an S2-only record it will produce a different string from the one that
   was written, which is precisely the failure §6.6 exists to avoid.
5. **§5.1 under-specifies the hash arm.** `sha1(title|year|firstAuthor)` does
   not say whether the title is case-folded, whitespace-collapsed or
   punctuation-stripped, nor what an absent year or author contributes. The
   literal reading was implemented and documented in the function's doc
   comment: `|`-joined verbatim, absent components empty, no other
   normalization. `P2-T09` keys deduplication on this, so it should be pinned
   down upstream rather than re-decided there.
6. **The card's test path collides with a Phase 0 file.** `Files` says create
   `test/unit/model/ids.test.ts`, but `P0-T12` already shipped
   `test/unit/model/ids.spec.ts` for the same module, and
   `plan/README.md` §4's sixteen-path relaxation list covers
   `src/model/ids.ts` and not its test. Both files now exist and both pass
   (the spike's `normalizeDoi` cases still hold against the shipped module,
   and it is the only proof that `vitest.config.ts`'s `setupFiles` ran). The
   overlap is left for a human: deleting a Phase 0 file is outside this card's
   `Files`.

**One `P0-T12` open question is now decided, as specified.** That card's
Findings asked `P1-T01` to rule on `docs/02` §11.1's trailing-punctuation strip
`[.,;)\]]+$` having no leading counterpart, so that a DOI lifted from
parenthesized prose normalizes to `null`. Decision: **implement as specified,
do not widen the regex** — it is a reference implementation three other cards
read. The behaviour is now asserted rather than latent
(`normalizeDoi("(10.1056/nejmoa2300709);") === null`).

**Three values were added that §5.1 does not declare**, all in support of
`Do` step 5's guards and each tied to its union at compile time by
`satisfies Record<Union, true>`, so neither can drift: `SOURCE_IDS` /
`isSourceId` in `ids.ts`, `WORK_TYPES` / `isWorkType` in `canonicalWork.ts`,
and `sha1Hex` exported from `ids.ts` so the hash arm is assertable against an
external vector. They are not second declarations of `SourceId` or `WorkType`
— adding a member to either union without updating its key set fails to
compile, which is the behaviour `docs/07` §11.1 step 3 asks for.

---

### P1-T02 — Core primitives: cancellation, clock, errors, logger

| Field | Value |
|---|---|
| **ID** | `P1-T02` |
| **State** | `DONE` — approved 2026-09-30; 206 tests in its own files, 406 across the suite. Found that `docs/07` §10.1's error hierarchy **does not compile** as printed (15 `TS2416` errors, reproduced in isolation) and that its `toSerialized()` **leaked the unredacted message through `Error.stack`** into a user-exportable file. `result.ts` and `concurrency.ts` gained their missing tests; `result.ts` went 0 % → 100 %. |
| **Depends on** | `P1-T01` |
| **Blocks** | `P1-T03`, `P1-T04`, `P1-T05`, `P1-T07`, `P1-T12`, `P1-T15`, `P1-T18` |
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
- create `src/core/jobQueue/progress.ts` (**the `docs/07` §4.1 `ProgressReporter` interface only** — added 2026-09-30; `P1-T15` implements it)
- create `src/core/clock.ts`
- create `src/core/errors.ts`
- create `src/core/logger.ts`
- create `src/core/result.ts`
- create `src/core/concurrency.ts`
- create `test/unit/core/cancellation.test.ts`
- create `test/unit/core/errors.test.ts`
- create `test/unit/core/logger-redaction.test.ts`
- create `test/unit/core/result.test.ts` (**added 2026-09-30** — `plan/README.md` §6 requires a test
  with the task or a reason in `Notes`, and this card's `Notes` gave none; `result.ts` measured at
  **0 % coverage** without it)
- create `test/unit/core/concurrency.test.ts` (**added 2026-09-30**, same reason — the
  cancellation-facing half was covered from `cancellation.test.ts`, the rest was not)

**Do.**
1. Implement `CancellationTokenSource` / `CancellationToken` per `docs/07` §4.1.
   ~~backed by an internal `AbortController` so `token.signal` is real.~~
   **Corrected 2026-09-30 (`P1-T02` D3): taken literally this step was a module-load throw in the
   product.** `AbortController` is **absent from the plugin sandbox** — measured 2026-09-10 on
   Zotero 10.0.1 by `P0-T08` with two agreeing probes (`docs/01` §2.3) — and `docs/07` §7.4 says so
   itself ("*not* an `AbortSignal`, which does not exist in the plugin sandbox"). Use a real
   `AbortController` when `typeof AbortController === "function"` (Node and vitest, so criterion 2
   is asserted against the genuine platform type) and a documented same-shape stand-in otherwise.
   This card's `Notes` already anticipated that `signal` "becomes decoration"; the step's wording
   did not.
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


**Findings, 2026-09-30 — four of five criteria pass; criterion 5 failed on another card's file.**
`src/core/jobQueue/cancellation.ts`, `clock.ts`, `errors.ts`, `logger.ts`, `result.ts`,
`concurrency.ts` and three test files. **206 tests in this card's three files, 406 across the unit
suite, all green; `npm run lint:check` exits 0 project-wide.** Coverage of the card's modules clears
`docs/13` §2's 85 % line bar everywhere except `result.ts` — see the defect list.

**Criterion 5 (`npm run typecheck` exits 0) failed as written, and the cause was not this card.**
Exit 2, one error: `src/sources/types.ts(51,39)` importing `../core/jobQueue/progress`. A scoped
`tsc` over `src/core` + `src/model` + `test/unit/core` with the project's own `compilerOptions` exits
**0**, so no file this card owns produced a diagnostic. Reported rather than adjusted
(`plan/README.md` §5 rule 6). **The plan, not the code, was at fault** — see the `Files` note above:
`src/core/jobQueue/progress.ts` was `P1-T15`'s `create` while five cards that precede `P1-T15`
already need it, so typecheck could not have reached 0 for five cards. Fixed by moving the §4.1
interface here and making `P1-T15`'s entry a `modify`.

**Two corpus defects that stop `docs/07` §10.1 from compiling at all, both reproduced before being
fixed.** **D1:** `readonly code = "NETWORK"` gives the property the *literal* type `"NETWORK"`, so
`OfflineError`'s `override readonly code = "OFFLINE"` is `TS2416` — **15 errors** across the five
subclass-of-a-concrete-class pairs §10.1 declares. Not a strict-flag artefact; ordinary subtype
checking under plain `strict`. I reproduced it in isolation on TypeScript 5.9.3 before believing the
report: `Type '"OFFLINE"' is not assignable to type '"NETWORK"'`. The repair is `: string` /
`: boolean` annotations on the concrete members, which **changes no runtime value** — all 23 code
strings are asserted by test. **D2:** §10.1's `toSerialized()` assigns `httpStatus` and `stack` as
plain properties, but §5.2 declares them optional and `tsconfig.json` sets
`exactOptionalPropertyTypes`, so the assignment is rejected; a conditional spread omits the keys
instead of writing `undefined`, which is also the right shape for `schema/provenance.schema.json`.
Both are corrected in `docs/07`.

**D3 — this card's own step 1 was a trap, and the card contradicted itself.** Step 1 said to back the
token with "an internal `AbortController` so `token.signal` is real". `AbortController` is **absent
from the plugin sandbox** (measured 2026-09-10, `P0-T08`, two agreeing probes, `docs/01` §2.3) and
`docs/07` §7.4 says so in terms. Taken literally, step 1 is a module-load throw in the product —
while this card's own `Notes` already anticipated that `signal` "becomes decoration". The
implementation feature-detects and falls back to a same-shape stand-in, with seven dedicated tests
for the sandbox branch rather than trusting it by inspection. Step 1's wording is corrected above.

**Three more under-specifications recorded rather than invented around.** **D4:** §10.3 said the
redaction patterns come "from one place" without naming it, and the only corpus candidate carrying a
path header, `src/prefs/secrets.ts`, is unreachable from `core/` under §2.3's rule — now pinned to
`src/core/errors.ts` in §10.3. **D9:** §4.1 declares `CancellationToken`, `ProgressReporter`,
`RateLimiter` and `Cache` but **not `Clock`**, so two cards in one day inferred its shape from
§7.3's call site; `P1-T07` typed its parameter structurally as `{ now(): number }` specifically to
avoid declaring a second one. Recorded as a gap in §4.1. **D8:** `docs/06` §13.1 attributes a
30 %-failure-rate abort to `mapWithConcurrency`, but §13's own callback never throws, so the
threshold is a policy over recorded outcomes rather than a property of the mapper; the primitive
ships plain fail-on-first-rejection and **Phase 3 must settle where the threshold lives.**

**Two gaps this card cannot close itself, reported under rule 2 and not absorbed.** **D5:**
`src/core/result.ts` is a `Files` entry that **no `Do` step mentions**, and the whole corpus says one
thing about it — §2.2's tree comment. A conservative surface shipped with the gap documented in the
file header; a specific shape needs a doc section. **D6:** `plan/README.md` §6 requires a card whose
`Files` list has no test file to give a reason in `Notes`, and this card's `Notes` give none for
`result.ts` or `concurrency.ts`. Measured consequence: **`result.ts` is at 0 % coverage.** The
cancellation-facing `Semaphore` and `mapWithConcurrency` assertions went into `cancellation.test.ts`
(lifting `concurrency.ts` to 93.75 % lines), but `result.ts` is untested and that is an open item.

**One real bug found and fixed in its own code, recorded because it would be expensive to
rediscover.** `Semaphore.acquire` threw **synchronously** for an already-cancelled token while
declaring `Promise<…>`; a method that sometimes throws before returning its promise and sometimes
rejects it cannot be handled in one place. Made `async`, with the fast path still running
synchronously to the return so two callers cannot both see a free permit.
---

### P1-T03 — Typed preference schema, `PrefStore` port, `prefs.js` rows

| Field | Value |
|---|---|
| **ID** | `P1-T03` |
| **State** | `DONE` — approved 2026-09-30; 57 tests, the D5 refusal and the `prefs.js` ↔ `PREFS` check both **proven by mutation**. Criterion 1 is unfalsifiable as written (100 is also the default) and a sibling test was added beside it. Three §8.5.1 defects corrected; `secretBackend`'s allowed values still disagree across two documents. |
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


**Findings, 2026-09-30 — all five criteria pass, and criterion 1 is weaker than it looks.**
`src/prefs/keys.ts`, `schema.ts`, `index.ts`, `src/core/config.ts`'s `PrefStore` port,
`createZoteroPrefStore()` and twelve `pref()` rows, with **57 tests**. typecheck, lint and the full
suite exit 0.

**Criterion 1 is unfalsifiable as written, proven by mutation.** It asks that `getPref("maxResults")`
return `100` as a `number` when the stored value is the string `"100"` — but **`100` is also
`maxResults`'s schema default**, so a build with the `Number()` coercion deleted entirely still
returns 100 and still passes. Measured: a mutant replacing the coercion with
`typeof raw === "number" ? raw : undefined` passed criterion 1 and failed four other tests. The
criterion was left untouched (§5 rule 6) and a sibling added that stores `"150"` / `"120"` and
asserts `150` / `120` plus `getPref("maxResults") + 1 === 151`; the same mutant now fails five tests.
**The criterion should be reworded to name a non-default value.**

**The D5 refusal is proven by mutation too, not by inspection.** Adding `secret: true` to a real
`PREFS` entry made the suite exit 1 with two failures, including the writer itself throwing. A third
test drives the writer against a synthetic secret definition and asserts it throws, that the store
stays empty, and that the message contains neither the value nor a key-shaped string. Criterion 4's
`prefs.js` ↔ `PREFS` check was mutation-tested the same way.

**Three corpus defects, all in §8.5.1, now corrected there.** Its code block **calls `Zotero.Prefs`
from `src/prefs/`**, which §2.3 of the same document forbids and eslint enforces — §2.3 wins and the
port shape shipped. Its `PrefValue<K> = (typeof PREFS)[K]["default"]` beside an `as const` `PREFS`
resolves to the **literal type `3`**, so `setPref("searchYears", 5)` is a compile error; `as const` is
load-bearing for `PrefName`, so the repair is a `Widen<T>` helper. And its `observePref(...): symbol`
is unreachable: `Zotero.Prefs.registerObserver` is confined to `registrations.ts` by `FR-56`, whose
factory returns a `ScopedRegistration` — a function, not a `Symbol` — and `core/` may not name
bootstrap's types. An opaque `PrefObserverHandle` ships; **`P1-T25` is where it becomes a real one.**

**`secretBackend`'s allowed values disagree across two documents.** §8.5's row is
`oskeystore | session | passphrase | ""`; `docs/09` §1.7's `SecretBackend` is
`"os-keychain" | "session-only" | "passphrase"` — **two of three spellings differ** and it has no
unprobed member. §8.5 ships, since it is the authority for a preference's allowed values, and the
conflict is recorded in both. Note that `G-09`'s 2026-09-30 measurement added a **fifth** live case
neither set has a member for, so the answer may be five values.

**`plan/README.md` §4's relaxation is false for one path, and this is the card that found it.** §4
says of the sixteen dual-`create` paths that "nothing in a spike version of those files is
load-bearing". For `src/zotero/prefStore.ts` it is: `P0-T23`'s `test/integration/zotero/secrets.spec.ts`
imports **eight symbols from it by name** and **is not in this card's `Files` list**, so a literal
replacement breaks typecheck on a file this card may not touch. The raw layer was kept and the port
added on top. **§4 needs a sentence saying a spike file with a shipped importer is extended, not
replaced** — the same judgement `P1-T12` and `P1-T05` reached independently for `itemMapper.ts` and
`zoteroApi.ts`.

**A silent-blindness bug in this card's own test, worth more than the test it broke.** The first
`prefs.js` parser was line-anchored, and Prettier had split the `sources` `pref()` call across four
lines because its value is 63 characters. The parser silently matched **11 of 12** rows — every
assertion in criterion 4's block was vacuously true for exactly the longest and most defect-prone row,
**and the suite still reported green.** The parser is now newline-tolerant and **throws** if the
number of `pref(` tokens it consumed differs from the number in the file, so a future formatting
change cannot blind it again.

**Removing `pref("enable", true)` left a false comment in a file this card may not touch.** Criterion 4
plus the `Do NOT` require it gone (a scaffold-template placeholder in no §8.5 row, read by nothing).
`secrets.spec.ts:101` still says `DEFAULT_ONLY_PREF_KEY = "enable"` with the comment "Shipped by
`addon/prefs.js`, so it reads from the default branch" — now false. **No assertion breaks**, but that
measurement now duplicates the absent-pref one instead of being a default-branch reading. One-line
repair: use `prefsSchemaVersion`.
---

### P1-T04 — Per-host token-bucket rate limiter and backoff

| Field | Value |
|---|---|
| **ID** | `P1-T04` |
| **State** | `DONE` — approved 2026-09-30; 62 tests, all on a manual clock. Found that a bare `Date.parse` on `Retry-After` turns even a **valid** delta-seconds header into "retry immediately" against a host that just asked us to stop. `maxConcurrent` is unenforceable as §4.1 stands and the gap is asserted rather than hidden — `P1-T27` owns it. |
| **Depends on** | `P1-T02`, `P1-T03` |
| **Blocks** | `P1-T05`, `P1-T25`, `P1-T26`, `P1-T27`, `P2-T02` |
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


**Findings, 2026-09-30 — all six criteria pass in substance; criterion 5's literal signature does
not compile.** `TokenBucket` per §4.1 with §7.3's refill arithmetic, the host policy registry and the
backoff primitives, with **62 tests** — every one driven by `createManualClock()`, no `Date.now()`, no
real time, no network. typecheck, lint and the full suite exit 0.

**The finding worth the card: `Retry-After` must not be parsed with a bare `Date.parse`.** Reproduced
before being recorded, on this repository's Node 22 / V8:

```
Date.parse("120")   === -58380424072000   // year 0119
Date.parse("+120")  === -58380424072000
Date.parse("120.5") === -58369969672000   // year 0120
Date.parse("-5")    ===   988642800000    // 2001
```

**`Number.isNaN` is `false` for all four**, so the usual
`if (Number.isNaN(Date.parse(v))) …/* else a date */` guard sends even a **valid** delta-seconds
header down the date branch and computes a deadline ~1900 years in the past. Clamped at zero that is
**"retry immediately" against a host that has just asked us to stop** — `docs/02` §3.1's stated route
to an IP being blocked from NCBI. The date branch is gated on an explicit HTTP-date shape check, with
**`asctime` deliberately excluded** because it carries no timezone and would be read in the local
zone. The three malformed strings are asserted to return `undefined`, and §7.3 now carries the warning
because **`P3-T05` step 6 re-parses the same header.**

**Criterion 5's one-argument `parseRetryAfter(headerValue)` cannot compile.** The HTTP-date form
yields no delta without a reference instant, and `core/` may read wall time only through the injected
`Clock` — a `Date.now()` here would be the single call the port exists to remove and would make the
date branch untestable under a manual clock. Shipped as `parseRetryAfter(headerValue, nowEpochMs)`;
the criterion's intent is asserted and its text was not touched.

**`maxConcurrent` is unenforceable as §4.1 stands, and the gap is asserted rather than hidden.**
`RateLimiter` declares `key`, `acquire`, `tryAcquire`, `penalize`, `reconfigure` and `stats`.
**`acquire` resolves `void`; there is no release handle and no `run()`** — nothing signals that a
request finished, so an `inFlight` counter could never be decremented and gating `acquire` on one
would **deadlock the bucket permanently** after `maxConcurrent` calls. §7.3's skeleton declares
`private inFlight = 0` and stops. The limiter paces by rate only and reports `inFlight: 0`, asserted
so the hole is visible in the suite, with the cap carried as policy data. **`P1-T27` owns the fix, and
Phase 2's arXiv row is `maxConcurrent: 1`.**

**One design point that makes `penalize` and `reconfigure` cheap.** A parked `acquire` holds no sleep
of its own: one sleep is scheduled for the **head** of the FIFO queue and `drain()` serves everything
affordable on waking, with a generation counter abandoning a superseded sleep. That is what lets one
deadline move instead of *n*, and it preserves `concurrency.ts`'s recorded invariant —
`unsubscribe()` before `resolve()`, or a token goes to a promise nobody awaits.

**Refused rather than invented (§5 rule 4).** §7.3 publishes **no `base`, no `cap` and no attempt-cap
number** although `docs/02` §2.4 and `docs/05` §9.4 both name it as their owner, and §8.5 has no retry
rows — so `RetryBudget` ships with no defaults and **`P1-T05` step 4's "using `P1-T04`'s jitter and
cap" has no numbers to use**. `P1-T28` and its human gate own that. Likewise `limiterFor()` returns
`undefined` for a host with no policy row rather than a guessed conservative bucket.

**A pre-existing conflict flagged for `P3-T05`:** §7.3 and `docs/05` §9.4 specify **decorrelated**
jitter `min(cap, random(base, prev*3))` and §9.4 explicitly forbids a second shape, while `P3-T05`
step 7 instructs **full** jitter over `min(cap, base * 2**attempt)` from `docs/03` §11.6 — and
`P3-T05`'s `Files` list modifies **this same file**. Two differently-shaped backoffs will otherwise
land in one module. Only §7.3's is implemented.

**`P2-T03`'s `Verify with` will fail on a gap in this card's `Files` list.** It runs
`npm run test:unit -- hostLimiter`, and `test:unit` is `vitest run --dir test/unit` with **no
`--passWithNoTests`**, so a filter matching zero files exits non-zero. The registry's 12 tests live in
`tokenBucket.test.ts` because that is what this card's `Files` names, and `plan/README.md` §6's
required `Notes` reason for a module with no test file of its own is absent. Either this card creates
`test/unit/core/hostLimiter.test.ts` or `P2-T03`'s command changes.
---

### P1-T05 — HTTP client over `Zotero.HTTP.request`

| Field | Value |
|---|---|
| **ID** | `P1-T05` |
| **State** | `DONE` — approved 2026-09-30; 70 tests. The D10 guard refuses a foreign `email`/`tool` to NCBI **before** pacing, logging or issuing, with `transport.calls` asserted at 0. Two numbers refused rather than invented (§7.3 publishes no attempt cap), and the spike client's importers were checked before it was replaced. |
| **Depends on** | `P1-T02`, `P1-T03`, `P1-T04` |
| **Blocks** | `P1-T09`, `P1-T11`, `P1-T25`, `P1-T26`, `P1-T27`, `P1-T28` |
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


**Findings, 2026-09-30 — all six criteria pass.** The shipped client over an injected transport,
`retry.ts`, the shipped `userAgent.ts` and `createZoteroHttpTransport()`, with **70 tests**. typecheck,
eslint and the full suite exit 0.

**Every measured spike property was carried forward rather than re-derived**, because each cost a
probe run: `anon: true`, `successCodes: false`, `noRetryOnThrottle: true`, `errorDelayMax: 0`,
`logBodyLength: 0`, `debug` never passed, the typed `HttpError` with `OFFLINE`/`TIMEOUT`/`CANCELLED`/
`NETWORK`, and the `cancelRequested` flag so a status-0 **resolve** after an abort maps to `CANCELLED`
rather than `NETWORK`.

**The D10 guard is the part to read.** A request to `eutils.ncbi.nlm.nih.gov` carrying an `email` or
`tool` other than the maintainer's throws `PolicyViolationError` **before** pacing, logging or
issuing, and the offending address never enters the message or the context. Four tests assert it,
including that `transport.calls` stays at **0**.

**§7.4's own excerpt cannot be implemented as printed.** It calls `Zotero.HTTP.request` inline and
reads the `timeoutSeconds` pref, both of which §2.3 and `eslint.config.js` forbid from `src/core/**`.
Resolved with the transport port the spike already had plus an **injected timeout getter**, so the
composition root supplies the pref. Reported, not coded around. Related: `docs/01` §8.2's sketch
leaves `successCodes` on, which would route mapping through `UnexpectedStatusException`; §7.4 wins,
exactly as this card's `Do NOT` warns.

**Two things refused rather than invented (§5 rule 4).** §7.3 names "a per-host attempt cap" and
publishes **no number**, so `RetryPolicy.maxAttempts` is injected and, absent a policy, the client
makes exactly **one** attempt — `P1-T28` owns the numbers. And no penalty deadline is invented when
`Retry-After` is absent.

**Replacing the spike `client.ts` did not break its importers, which is why they were checked first.**
`scripts/spike-network.ts` and `scripts/spike-tts-korean.ts` import six symbols from it;
`src/bootstrap/registerUI.ts` and `test/integration/zotero/itemCreation.spec.ts` import from
`zoteroApi.ts` — and **`P1-T19` is rewriting `registerUI.ts`**. `zoteroApi.ts` is on §4's sixteen-path
list, but the transport was **added** rather than the file replaced, because a literal `create` would
have broken a file this card may not touch. Same judgement `P1-T12` reached for `itemMapper.ts` and
`P1-T03` for `prefStore.ts` — **three cards in one day**, which is why §4's relaxation needs the
qualifying sentence. One behaviour change to record: the two spike scripts now receive the §10.1
classes where they received `HttpError`, so their `instanceof` reporting fires only via `.cause` and
their verdict strings need a one-line change to keep printing the measured code.

**A duplicate this card created with `P1-T04`, by both following their own steps.** Step 4 here and
`P1-T04` step 6 both require a `Retry-After` parser and both shipped one —
`parseRetryAfterMs` in `core/http/retry.ts` and `parseRetryAfter` in `core/rateLimit/backoff.ts`,
each file's header acknowledging the other, and **both independently landing on the same
two-argument shape**. `P1-T26` collapses them into `backoff.ts`.

**`docs/07` §10.1's `TimeoutError(timeoutMs, url)` and `OperationCancelledError(reason)` accept no
`cause`**, so the measured platform exception cannot be attached on those two arms while it is
attached on `OfflineError` and `NetworkError`. Worth a §10.1 note if the debug bundle is expected to
carry it on every arm. And §4.1 still declares no `Clock`; this is the **third** card to take its
shape from a call site.
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
| **State** | `DONE` — approved 2026-09-30; 29 tests at 100 % across all four metrics. Criterion 1 was proven by extracting §4.2 and diffing (93 tokens, 0 mismatches). **Criterion 4 genuinely fails** — `sources → zotero` passes eslint — and criterion 5 failed on a plan defect: `ProgressReporter` was five cards away from its first consumer. |
| **Depends on** | `P1-T01`, `P1-T02` (added 2026-09-30 — `docs/07` §4.2 imports `CancellationToken` and `ProgressReporter`, both `P1-T02`'s) |
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
- modify `eslint.config.js` (added 2026-09-30 — criterion 4 requires a lint rule and this card's `Notes` already scope the work, but `Files` omitted the file it lives in)

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


**Findings, 2026-09-30 — three of five criteria pass, and the two failures are both plan defects
rather than code defects.** `src/sources/types.ts`, `registry.ts`, `shared/recency.ts`,
`src/bootstrap/registerSources.ts` and two test files. **29 tests, 100 % of statements, branches,
functions and lines across the three implementation files.** Scoped to this card's six files,
`eslint` and `prettier --check` both exit 0.

**Criterion 1 was measured twice rather than eyeballed.** A script extracted §4.2's fenced block,
tokenised declared type names, member names with their optionality and every string-literal union
arm in order, and diffed: **93 doc tokens, 93 file tokens, 0 mismatches.** A stricter whole-text
comparison with comments stripped and Prettier's wrapping normalised reports **2309 vs 2309
characters, identical.** `findRelated` / `lookup` / `fetchAbstract` are declared and implemented by
nobody, as the card requires.

**Criterion 4 (ESLint fails `sources/` importing `zotero/`) FAILED, and I confirmed it myself.**
A throwaway probe under `src/sources/` importing each layer in turn: `sources → pipeline` eslint
exit 1, `sources → ui` exit 1, **`sources → zotero` exit 0 — no error at all.** Two separate causes.
*Mechanical:* `P0-T04`'s `layering/adapters` override groups `src/sources/**`, `src/llm/**`,
`src/tts/**` **and `src/zotero/**`** under one rule forbidding `pipeline` and `ui`; `zotero` cannot
be added to that group's forbidden list without forbidding `src/zotero/` from importing its own
siblings, so the fix is a *separate* override for the three non-`zotero` adapter directories.
*Corpus:* `docs/07` §2.3's bullet said the adapters must not import "`pipeline/` or `ui/`" — **two**
— while §4.2's `LiteratureSource` comment says **three**, adding `zotero/`. §4.2 is the more specific
statement; §2.3 is corrected, and the two-directory reading is exactly why `P0-T04` enforced two
arms. **The card's `Files` list omitted `eslint.config.js` while its own `Notes` scope the work**
("the ESLint dependency-rule config is … cheapest to add now"), so the file is now listed.

**Criterion 5 (`typecheck` exits 0) FAILED, on the plan's dependency edges.** `docs/07` §4.2 imports
`ProgressReporter` from `src/core/jobQueue/progress.ts`, which `plan/02` gave to **`P1-T15`** as a
`create` — while `P1-T07`, `P1-T08`, `P1-T09`, `P1-T10` and `P1-T11` all precede `P1-T15`. **As the
plan was written, typecheck could not reach exit 0 for five consecutive cards.** Not worked around:
declaring `ProgressReporter` locally would build a parallel copy of a `core/` type inside `sources/`,
and dropping `SourceCallContext.progress` would break criterion 1. Fixed by moving the §4.1
interface into `P1-T02` and making `P1-T15`'s entry a `modify`; `P1-T02` is now in this card's
`Depends on`, which it should always have been — §4.2 also imports `CancellationToken` from
`P1-T02`'s file, and that import resolved during this run only because the `P1-T02` agent happened
to be writing it concurrently.

**A corpus defect in §4.2's own import block: it does not resolve.** It read
`import type { CanonicalWork, ExternalIds } from "../model/canonicalWork"`, but §5.1 — the
declaration, and therefore the authority — puts `ExternalIds` in `model/ids.ts`, and
`canonicalWork.ts` imports it without re-exporting. Same defect class as the §2.2 directory-comment
mis-attribution `P1-T01` found. Corrected in §4.2.

**A product gap recorded rather than decided silently: FR-3 says nothing about a record with no
parsed publication date.** Its third acceptance criterion says the plugin "filters client-side using
the parsed publication date"; neither FR-3, §4.2 nor §5.3 covers the absent-date case. Such records
are **kept** and counted as `ClientRecencyFilterResult.keptWithoutDate`, reasoning that a record with
no date cannot be *shown* to be outside the window and dropping it would lose results a server-side
filter would have returned. **Reversible in one line plus a test if the owner wants them dropped.**

**A trap for every later date-handling card.** §5.1's `PartialDate.iso` is variable-precision
(`"2024"`, `"2024-03"`, `"2024-03-07"`), so comparing it directly against `fromDate` would drop
**every year-only record in the first year of the window** — and year-only is the common case
precisely for the sources that have no server-side date filter. The implementation compares each
record's possible day span against the window for overlap, with a regression test pinning `"2024"`
against `"2024-01-01"`. `P1-T08` and the Phase 2 adapters should not re-derive this.
---

### P1-T08 — PubMed query builder

| Field | Value |
|---|---|
| **ID** | `P1-T08` |
| **State** | `DONE` — approved 2026-09-30; 46 tests. Found that §12.2's field-tag list had six entries against `QueryField`'s eight, so `affiliation` **silently widened to `[All Fields]`**, and pinned the Boolean case rule because a lowercase `not` would turn "patients not receiving therapy" into a negation. |
| **Depends on** | `P1-T07` |
| **Blocks** | `P1-T09`, `P2-T01`, `P2-T20` |
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

**Clarification added 2026-09-30, without changing a criterion (`plan/README.md`
§5 rule 6).** Criterion 1 and step 3 ask for different things and both are right:
`docs/02` §12.2's example block carries the date **in the term**, `("2024/01/01"[EDAT] :
"2026/12/31"[EDAT])` — §3.3 mechanism **(c)** — while step 3 mandates mechanism
**(b)**, `mindate`/`maxdate`. **The full §12.2 string is therefore not producible as a
`term=` value under step 3, and it should not be.** Criterion 1 is about step 4's
`explainQuery` rendering, which is where the in-term form belongs; the Boolean tree
alone is what `term=` carries on the wire. §3.3 calls the three mechanisms
"interchangeable", so the preview does not misdescribe the filter.

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


**Findings, 2026-09-30 — all six criteria pass.** `src/sources/shared/queryParse.ts`,
`src/sources/pubmed/query.ts` and two test files; **46 tests**. No network call was made, and none
was needed. `typecheck`, `eslint` and the unit suite all exit 0; the only `prettier` complaint at the
time belonged to a concurrently-running card.

**Two criteria were met in ways worth recording, because a weaker reading would have passed too.**
Criterion 2 asks for balanced parentheses over 100 generated inputs: the property test builds them
from a 22-piece pool with a **seeded** `mulberry32` PRNG, so a failure is reproducible rather than
flaky, and asserts `expect(offenders).toEqual([])` so the message prints the offending input *and* its
rendering. Making it true of **all** input rather than well-formed input required stripping
`" ( ) [ ]` out of term values, because §12.1's raw-string fallback puts arbitrary user text inside a
term. Criterion 3's URL round-trip is asserted twice, and **the second assertion is the one that
matters**: reading `term` back through `URLSearchParams.get()` would fail if spaces had been encoded
as `+`, since `URLSearchParams` decodes `+` to a space.

**The card asks for two different date mechanisms, and both are right.** `docs/02` §12.2's example
block carries the date **in the term** — `("2024/01/01"[EDAT] : "2026/12/31"[EDAT])`, §3.3 mechanism
(c) — while `Do` step 3 mandates mechanism (b), `mindate`/`maxdate`. **The full §12.2 string is
therefore not producible as a `term=` value under step 3.** Resolved without bending either:
`renderPubmedTerm()` renders the Boolean tree, which is what `term=` carries on the wire, and
`explainPubmedQuery()` — step 4's preview and provenance rendering — appends the in-term clause and so
reproduces §12.2 verbatim. §3.3 calls the three mechanisms "interchangeable", so the preview does not
misdescribe the filter. A clarification was added to the `Do` list; **no criterion was edited**
(`plan/README.md` §5 rule 6).

**A plan contradiction about who owns the parameter set, now fixed.** This card's step 5 says "build
the **full** `esearch` parameter set as an ordered, URL-encoded string"; `P1-T09` step 2 said "build
the `esearch` URL from `P1-T08`, **append** `db=pubmed`, `retmode=json`, `retmax`, `retstart`, `tool`,
`email`, and `api_key`". Both cannot be true of one string, and appending would have destroyed the
deterministic parameter order `docs/13` §2.2 keys fixtures on **and** put D10's `tool`/`email` in two
places. `P1-T09` step 2 now reads "by **passing** … in as options".

**Two corpus gaps in the PubMed field-tag mapping, both fixed in `docs/02` §12.2.** `docs/07` §4.2's
`QueryField` has **eight** members and §12.2's tag list had **six**: **`affiliation` had no mapping
anywhere in the corpus**, §12.3's summary table included. That is not harmless — the fallback would
have been `[All Fields]`, which **silently widens an affiliation restriction to the whole record**. It
renders as `[Affiliation]`, a real Entrez tag. Separately, **`abstract` and `titleOrAbstract`
necessarily collide on PubMed**: there is no abstract-only Entrez tag and §12.3 maps the abstract
concept to `[Title/Abstract]`, so an `abstract:` term is rendered *wider* than asked and a title hit
satisfies it. A property of PubMed rather than a defect, and now recorded where anyone comparing
PubMed and Europe PMC result counts will find it.

**§12.1 never stated whether the user's Booleans are case-sensitive; they are uppercase-only, and the
third reason is the real one.** It is PubMed's own rule so input and output agree; the
bare-words-default-to-AND rule makes a lowercase `and` cost only a stopword PubMed's translation drops
anyway; and **accepting a lowercase `not` would turn "patients not receiving therapy" into a
negation.** Prose must not be silently reinterpreted as an operator. Pinned in §12.2.

**`docs/07` §4.2's `not` is unary; Entrez's `NOT` is binary, and nothing says what a left-operandless
`NOT` should do.** `renderPubmedTerm` emits a bare `NOT mouse[All Fields]`, which PubMed rejects —
deliberately loud. The rejected alternative was synthesising an implicit left operand, which turns
"not mouse" into a multi-million-record query the user never asked for. **If the owner wants the UI to
block this earlier, that is a product decision and a card.** Note also that the parser handles `NOT`
in two positions because it *is* two things: Entrez's binary `A NOT B` becomes `and([A, not(B)])` to
fit §4.2's unary node.

**A mechanical consequence of reusing `redactUrl`, worth knowing before someone keys a fixture on the
wrong field.** `redactUrl` rebuilds the URL through `URL`/`URLSearchParams` **whenever it actually
removes a parameter**, so with an `api_key` present the recorded `transmittedUrl` comes back in
`URLSearchParams` encoding (space → `+`, `(` → `%28`) rather than byte-identical to what was sent.
Same request, different bytes. **`docs/13` §2.2's fixture key must be computed from the live `url`,
redacted at hash time as §2.2's own `fixtureKey` does — never from the stored `transmittedUrl`.**

**Defensive choices recorded so they are not mistaken for accidents.** A 32-level paren-depth limit
turns a pasted `((((((…` into the §12.1 raw-string fallback instead of a stack overflow **inside the
job queue**. A half-open date window throws `RangeError` rather than inventing the missing bound,
because §3.3 requires `mindate` and `maxdate` together. `reldate` is never emitted and a test pins
that negative, since C10 settled the window as calendar years rather than a rolling 1095 days.

**Needs a new card (rule 2, reported and not absorbed).** `docs/07` §4.2 declares `languages`,
`openAccessOnly` and `raw` on `SourceQuery`, and PubMed can express the first two (`[Language]`,
`free full text[sb]`). **Neither this card's `Do` nor `P1-T09`'s mentions any of them**, so a caller
that sets them today has them silently dropped. The module header states they are unrendered, so the
gap is visible at the call site rather than at the result count.
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
2. `search()`: build the `esearch` URL from `P1-T08` by **passing** `db=pubmed`,
   `retmode=json`, `retmax`, `retstart`, `tool`, `email`, and `api_key` (when
   `P1-T06` returns one) **in as options**; issue it through `P1-T05`.
   **Reworded 2026-09-30 (`P1-T08`): this step said "append", which contradicted
   `P1-T08` step 5's "build the **full** `esearch` parameter set as an ordered,
   URL-encoded string".** Both cannot be true of one string, and appending would
   destroy the deterministic parameter order `docs/13` §2.2 keys fixtures on **and**
   put D10's `tool`/`email` in two places. `buildEsearchRequest()` owns the whole
   ordered string; this card supplies the values.
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
| **State** | `DONE` — approved 2026-09-30; 60 unit tests plus a seven-case integration spec against a real Zotero 10.0.3. Measured that strict-mode `fromJSON` accepts a native `PMID` **and** an `extra` `PMID:` line and preserves the latter byte-identical, and caught a CRLF parser bug that would have appended a duplicate `rh-work-key` on every write. |
| **Depends on** | `P1-T01`, `P1-T02` (added 2026-09-30 — the `Notes` require `throw new ZoteroApiError(...)` for the preprint gap, and `docs/07` §10.1's hierarchy is `P1-T02`'s `src/core/errors.ts`) |
| **Blocks** | `P1-T13`, `P1-T14`, `P1-T24` |
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


**Findings, 2026-09-30 — six of seven criteria pass; criterion 7 failed on another card's file.**
`src/zotero/extraField.ts` and the shipped `src/zotero/itemMapper.ts`, with 60 unit tests and a
**seven-case integration spec run against a real Zotero 10.0.3**. `npm run lint:check` exits 0
project-wide; the whole integration suite is green at 22 passed.

**The integration spec is the evidence, not the unit tests.** All six substantive criteria were
asserted through `fromJSON(json, { strict: true })` in a live Zotero: strict mode accepted the
mapping and round-tripped its fields; `PMID` and `PMCID` landed in the **native** fields with nothing
matching `/(^|\n)\s*PMID\s*:/i` in `extra`; an existing
`"Citation Key: smith2024\nPMID: 999"` survived **byte-identical and in order**; every MeSH tag came
back `type === 1` with `MeSH*:` for major topics; a `literal`-only author produced `fieldMode === 1`;
and a > 500-character `extra` reduced to `rh-work-key` alone with the remainder in a child note.

**Criterion 7 (`typecheck` exits 0) failed as written, with zero diagnostics in this card's five
files.** The single error was `src/sources/types.ts` — `P1-T07`'s file — importing a
`src/core/jobQueue/progress` that no card had yet created. Reported, not adjusted; the plan defect
behind it is recorded under `P1-T02` and `P1-T07`.

**Two measured facts worth more than the criteria they served.** First, **`fromJSON` in strict mode
accepts a JSON carrying both a native `PMID` field and an `extra` line `PMID: 999`** — it neither
threw, nor migrated the line into the field, nor deduplicated, and the foreign line stayed
byte-identical in place. §6.3's whole preservation rule depends on that, and it is now asserted
rather than assumed; `docs/01` §5.2.1 documents the Extra→field migration only for *non*-strict mode,
so this closes the open question for strict. Second, **Zotero 10.0.3 reports
`globalSchemaVersion = 44`** while §6.1 and `docs/02` §10.3 verify their field lists against **42** —
two versions stale, nothing broken, now recorded in §6.1.

**A bug found and fixed in its own code, worth reading before anyone writes another `extra` parser.**
The line regex first used `.*` for the value group. **`\r` is a JavaScript line terminator, so `.`
does not match it** — on a **CRLF** `extra` field every line parsed as key-less, which would have made
the plugin append a **duplicate `rh-work-key` on every write**. Fixed to `[\s\S]*`, and the CRLF unit
test that caught it now guards it.

**A contradiction between the plan and `docs/07`, resolved toward the plan and flagged.** §6.2's
`type` row maps `conference-paper` → `conferencePaper`, but `plan/02` §2 and this card's `Do` step 1
route **every** non-`journal-article` type to `journalArticle`. Implementing the `conferencePaper` arm
would mean inventing a field mapping the authority does not supply: §6.1 verifies field lists for
`journalArticle` and `preprint` only, §6.2's table has no `conferencePaper` column, and
`conferencePaper` has `proceedingsTitle` rather than `publicationTitle` and no `PMID`/`PMCID`. So a
non-`journal-article` type becomes a `journalArticle` carrying `rh-work-type: <type>` — recoverable,
and §6.2 now records that Phase 1 ships neither arm. **Shipping `conferencePaper` needs a field
mapping in §6.2 first, and a card.**

**Four under-specifications pinned rather than guessed.** Two new `extra` keys §6.3 never named are
now in its contract: **`rh-issn`** for §6.2's "additional ISSNs" (a bare second `ISSN:` line is
*forbidden* by §6.3, since `journalArticle` has a native `ISSN` holding `issn[0]`) and
**`rh-work-type`** for the "note in `extra`". `libraryCatalog` takes a source **label**, not §4.2's
`displayNameKey` — that field is typed as a Fluent message id, so writing it would put
`rh-source-pubmed` into a user's library; `docs/02` §10.3's label form is what ships, behind an
override. "The winning source" is `provenance.seenIn[0]`, since nothing on `CanonicalWork` names one
and §10.4's precedence is Phase 2's. The overflow note's body is `<!-- rh:extra v=1 workKey=… -->`
plus one escaped `<p>Key: value</p>` per deferred line, in §6.4's marker idiom so it is re-writable
rather than duplicated — **worth pinning in §6.3 before `P1-T14` writes one.**

**Two items this card could not close, reported under rule 2.** The `Notes` require
`throw new ZoteroApiError(...)` for the preprint gap, but §10.1's hierarchy is `P1-T02`'s
`src/core/errors.ts` and this card declared no dependency on it — the edge is now added, and the
throw is a plain `Error` carrying the work key and doc citation with a `TODO(P1-T02)` naming the
swap. And **`create src/zotero/itemMapper.ts` cannot literally replace the `P0-T10` spike**:
`src/zotero/zoteroApi.ts`, `test/integration/zotero/itemCreation.spec.ts` and
`test/integration/zotero/batchImport.spec.ts` all import `buildJournalArticle` /
`JournalArticleRecord` / `RESEARCH_HELPER_TAG` / `AUTOMATIC_TAG_TYPE` from it and **none of the three
is in this card's `Files`** — verified. The spike surface is kept verbatim in a fenced section with
the reason recorded; **retiring it together with its two specs needs its own card.**
---

### P1-T13 — Existing-item detection by DOI and PMID

| Field | Value |
|---|---|
| **ID** | `P1-T13` |
| **State** | `DONE` — approved 2026-09-30; six integration tests against a real Zotero. Answered the 10 000-item question by measurement: **69–72 ms, one search**, then 200 lookups in 0–1 ms with zero searches. Found `docs/01` §5.5's reference implementation **case-sensitive on Zotero 10**, contradicting this card's own third criterion, with the mechanism read out of `data/search.js`. |
| **Depends on** | `P1-T01`, `P1-T12` |
| **Blocks** | `P1-T14`, `P2-T09`, `P2-T17`, `P2-T19` |
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


**Findings, 2026-09-30 — all five criteria pass, and the 10 000-item question now has a measured
answer.** `src/zotero/libraryIndex.ts` and a six-test integration spec against a real Zotero 10.0.3,
`globalSchemaVersion = 44`. typecheck, lint, unit and integration all exit 0.

**The scale numbers, measured rather than extrapolated.** Index build over **exactly 10 000 items:
69–72 ms with ONE search**, counted from a patched `Zotero.Search.prototype.search` rather than the
module's self-report. Then **200 `findExisting()` calls in 0–1 ms with zero searches.** The
per-candidate approach the card forbids would have been ≥200 searches for that run, ≥400 once §5.5's
PMID `extra` branch is counted. Insertion also measured: **9 685 items in 12.2 s, ~1.26 ms/item** —
*faster* per item than `P0-T20`'s 3.5–4.5 ms at 100 items against a near-empty library, so **insertion
does not degrade with library size.** `findExisting` is **synchronous**, which is the compile-time
proof the hot path cannot reach the DB.

**`docs/01` §5.5's reference implementation returns the wrong answer, and the mechanism was read out
of Zotero 10.0.3's own `data/search.js`:**

```js
var useNormalized = condition.normalizedField &&
  typeof condition.value == 'string' &&
  ['contains', 'doesNotContain', 'beginsWith'].includes(condition.operator);
```

**`is` is not in that list**, so `addCondition('DOI','is',doi)` compares against the raw `itemData.value`
column with an un-normalized term and **misses an item a translator stored as `10.18653/V1/…`** — which
is exactly what this card's third criterion requires to work. Only `contains`/`doesNotContain`/
`beginsWith` use the normalized shadow column with a `normalizeForSearch()`-ed term and SQLite `LIKE`.
The working shape is `contains` **plus exact in-memory verification**, since `contains` is a substring
match and `10.1/abc` would match `10.1/abcd`. §5.5 also **does not compile** (`s.libraryID = libraryID`
against a `readonly` declaration, `dataObject.d.ts:65`) and uses `cleanDOI()` where `docs/02` §11.1
makes `normalizeDoi()` the only normalizer — **two normalizers for one field means an index key and a
search term can disagree.** All three corrected in §5.5.

**Two platform facts that make "one identifier, one home" false.** `setField` performs **no**
Extra→field migration: an item whose `extra` is `PMID: 900000002` keeps an empty native `PMID`.
Together with `P1-T12`'s strict-mode `fromJSON` measurement, **detection genuinely cannot assume an
identifier lives in one place**, and both branches are read for both identifiers, always. And the CRLF
trap `P1-T12` found by reasoning is now asserted **against a real field**: a CRLF `extra` round-trips
byte-identical, so a line regex using `.*` would have made that item invisible to PMID detection.

**Two smaller measured facts.** `setField("DOI", …)` stores verbatim — reading `item.js` in 10.0.3,
**`ISBN` is the only field `setField` rewrites**. And `getField()` on a field invalid for the item's
type returns `""` rather than throwing, so scanning every item for `DOI`/`PMID`/`extra` is safe
including standalone notes and attachments.

**The fixture was gated after the fact, and the reason is worth keeping.** The 10 000-item test leaves
the library at 10 000 items for **every spec that runs after this one**, and
`entries: ["test/integration"]` is a directory enumerated in filesystem order — an accident, not a
guarantee. `P0-T20` happens to run first and its NFR-1 numbers came in unchanged at 422/352/446 ms; if
that order shifted, **`P0-T20` would silently start measuring NFR-1 against a 10 000-item library.**
The test is now opt-in behind a pref. Pinning the entries list was rejected as worse: a spec added
later would be silently omitted.

**Reported, not absorbed.** `matchedOn` is `"doi" | "pmid"` only, so Phase 2's arXiv- and S2-only
records are unmatchable and §6.6's `fromZoteroItem` is declared nowhere — `P2-T19` owns both, plus
§11.6's unowned `byArxiv`. **§11.6's trashed-item advice ("add it to a persistent dismissed list") is
feature-6 advice and must not reach the importer**: for `FR-51` a trashed item simply must not block
an import. And this card names **no unit-test file with no `Notes` reason**, against
`plan/README.md` §6, so the pure parts have no plain-Node coverage.
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
| **State** | `DONE` — approved 2026-09-30; 46 tests on a manual clock. §4.1's interface is implementable exactly as declared. Found §7.7's sketch does not compile, contradicts this card's architecture, and passes the argument `docs/08` §8.2 calls a live Zotero bug — while `zotero-types` contradicts §8.2 in turn. `P1-T29` owns the measurement. |
| **Depends on** | `P1-T02` |
| **Blocks** | `P1-T16`, `P1-T25`, `P1-T29`, `P1-T31` |
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
- modify `src/core/jobQueue/progress.ts` (was `create`; corrected 2026-09-30 — `P1-T02` now declares the §4.1 interface, this card adds `CompositeProgressReporter`, `child()` and the ETA)
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


**Findings, 2026-09-30 — all five criteria pass, and §4.1's interface is implementable exactly as
declared.** `CompositeProgressReporter`, the `ProgressSink` port, `createObservableProgressSink()` and
the Zotero window adapter, with **46 tests** on a manual clock. typecheck, lint and the full suite exit
0 project-wide.

**§4.1's interface was implemented with no widening, no added member and no cast** — and two
properties of it are worth recording. `setProgress(completed, total?)`'s "`total === undefined` means
indeterminate", read literally, means **omitting `total` on a later call resets a known total to
indeterminate**; `increment()` is the call that keeps one. That is a live trap for `P1-T16`'s stage
code. And the interface is **write-only**: no member reads state back and none releases resources, so
the ETA, the counts and teardown are class members *outside* it. A consumer typed as `ProgressReporter`
can drive the bar but **cannot read the ETA `FR-53` requires** — the snapshot reaches the UI through
the sink, which is what `createObservableProgressSink()` is for.

**`docs/07` §7.7's sketch has three defects and was not implemented as written, all corrected there.**
It **does not compile**: it declares `implements ProgressReporter` but defines only `setProgress`, with
`setMessage` and `done` as trailing `//` comments and `increment`, `child` and `warn` absent, and it
calls an undeclared `getString(headlineKey)`. It **contradicts this card's own step 1**, which puts one
reporter in `core/` fanning out to sinks — implementing the sketch literally would mean a second copy
of `child()`'s arithmetic and the ETA inside `src/zotero/`. And it passes an **icon URI** as
`ItemProgress`'s first argument, which `docs/08` §8.2 — read from `progressWindow.js` — says is an
**item type string**, calling the path form "a live Zotero bug. Do not copy it."

**`zotero-types@4.1.3` contradicts `docs/08` §8.2 outright.** It declares `setIcon(iconSrc: string)`
and **no `setItemTypeAndIcon`**, and types `ItemProgress`'s first parameter as `iconSrc`. The two agree
that it is a `string`, so no cast was needed — but **a caller who trusts the typings passes an icon
path and hits the bug §8.2 names.** Neither icon setter is called, the whole surface is behind
`openZoteroProgressWindow()` so a correction is one function, and **`P1-T29` owns the measurement**
§7.7's `Unverified` marker asks for.

**`getString()` cannot be used for a plugin key.** `docs/08` §8.2.1 records that it **throws** on an
unknown key when `Zotero.locale === "en-US"`, because a plugin's `.ftl` lives in `L10nRegistry` and not
in that synchronous bundle. The sink therefore takes `headline` as an **already-localized string**, the
same shape `P1-T18` independently arrived at.

**Two corpus tensions resolved by option rather than by picking a winner.** `docs/08` §4.4 says the
toast is raised "**only on completion**" while §7.7 says "**one window per job**", closed a few seconds
after the job *starts* — both are `Read first` sections of this card and neither step says which governs
`searchImport`. An `openOn: "progress" | "completion"` option carries both, and `searchImport` passes
`"completion"`. And §4.1's `warn(message, detail?)` targets "the `JobRecord`'s warnings", which is
Phase 3's store — rather than drop `detail`, it fans to `ProgressSink.warn?`, so Phase 3's sink becomes
a subscriber and nothing here changes.

**Criterion 2's throttle arithmetic is stated rather than hidden.** The throttle is **leading-edge**, so
over a *closed* 1001 ms window `[0, 1000]` it admits **5** paints (t = 0, 250, 500, 750, 1000); the
long-run rate is exactly 4/s and the extra is the one-off leading paint. The test measures a span that
counts 4 with nothing excluded and documents the arithmetic. **The ETA also stays `undefined` in two
cases a number would be a fabrication** — `fraction <= 0`, and zero elapsed time — both asserted. If
criterion 4 is read as "a number the instant `total` arrives, even at `completed === 0`", that reading
**fails** and wants a decision rather than a fabricated number.

**Reported, not absorbed.** §4.1's `child()` doc promises "weights let stages of unequal cost divide
the bar fairly" while its parameters are `fromFraction`/`toFraction`; the weight carrier is §4.5's
`StageDescriptor.weight` and **no card's `Files` names a home for the conversion** (`P1-T16` step 2 is
the natural owner) — recorded in §4.1. The card also requires an ETA "exposed on the snapshot" while
the only snapshot type in the corpus is §4.5's `JobProgressSnapshot`, declared in Phase 3's
`queue.ts`; a name-for-name subset ships here so Phase 3 extends rather than reconciles. **And nobody
constructs any of it** — `P1-T25` owns that.
---

### P1-T16 — `searchImport` pipeline

| Field | Value |
|---|---|
| **ID** | `P1-T16` |
| **State** | `TODO` |
| **Depends on** | `P1-T07`, `P1-T09`, `P1-T10`, `P1-T14`, `P1-T15`, `P1-T25`, `P1-T31` |
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
- modify `src/bootstrap/container.ts` (**was `create`; corrected 2026-10-01, `P1-T25`.** This card
  **depends on** `P1-T25`, which `modify`s that path — so the card that `create`d it ran *after* the
  card that modified it, and step 7 would have found a 717-line file where it expected to write one.
  §4's one-`create`-per-phase rule was satisfied on paper while the ordering was inverted.)
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
7. **Add the service locator to the object graph `P1-T25` already installed** in
   `src/bootstrap/container.ts` — `installServices()` is the construction site and `ServiceGraph` is
   what it returns; extend them rather than starting a container. ~~Build a tiny typed DI container
   in `src/bootstrap/container.ts`~~ — enough to
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
| **State** | `DONE` — approved 2026-09-30; 84 en-US messages, 11 integration tests, **nothing machine-translated**. Two criteria fail as literally written and both are card defects: criterion 2 contradicts criterion 3 of the same card, and criterion 4 cannot hold while §10.1 fixes 16 `rh-error-*` keys. Gate **`G-41`** was created because this card's gate did not exist. The Korean review is owed. |
| **Depends on** | `P1-T02` |
| **Blocks** | `P1-T19`, `P1-T30` |
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
1. Create the four `.ftl` files **flat under `locale/<lang>/`** in both
   ~~under the `research-helper/` subfolder~~ **(corrected 2026-09-30, `P1-T18`: this step
   contradicted this card's own `Do NOT` four lines below, which says "do not put a file anywhere
   but flat under `locale/<lang>/`". `P0-T32` measured Zotero 10 silently dropping subdirectories
   there, and `docs/01` §9.1 carries the measurement; the step was not updated when it landed.)**
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


**Findings, 2026-09-30 — three of five criteria pass; two fail as literally written and both were
reported, not adjusted.** **84 en-US messages** across two flat bundles, `src/i18n/keys.ts`, the shipped
`ftl.ts`, and **11 integration tests** (33 in the suite). typecheck, lint, unit (772) and integration
all exit 0.

**Nothing was machine-translated.** The `ko-KR` bundles carry only the 4 strings the owner already
wrote or that must not be translated (`PubMed`, `DOI`); the other **79** appear as commented stubs
carrying their English source, in the order a reviewer meets them, so the workflow is "uncomment and
translate in place". **The gap is not silent:** `KO_PENDING_REVIEW` / `KO_DELIBERATELY_ABSENT` are
machine-readable and the spec asserts the present and absent sets as exact sorted deep-equals, so a new
`en-US` string cannot land without either a Korean entry or an explicit admission. Gate **`G-41`** now
exists for the review — **it did not**: `plan/00` counts this card among the 21 gated cards and the
`Notes` say details go in `06-human-gates.md`, but `grep T18` there returned **nothing**, and the
nearest gate `G-31` is for *prompt* review with "Blocks: the release".

**Criterion 2 ("both bundles have identical key sets") is unsatisfiable, and contradicts criterion 3 of
this same card.** Criterion 3 requires a key **deliberately removed** from `ko-KR` so the fallback can
be proven, and `P0-T24` created that fixture and the spec is built on it. Identical key sets would
delete it. The sibling assertion added instead is exact and falsifiable. **Suggested rewrite:** "the
`ko-KR` key sets differ from `en-US`'s by exactly the documented review list plus the one deliberate
fallback fixture, asserted."

**Criterion 4 ("no ID lacking the `research-helper-` prefix") fails for 16 ids.** `docs/01` §9.3 says
"every ID starts with `research-helper-` … **No exceptions**", while §10.1 fixes the error
`messageKey`s as `rh-error-*`, `src/core/errors.ts` ships 23 of them and `P1-T02` asserts all 23 by
name — **the two documents could not both hold.** §9.3 now sanctions `rh-` as the one second prefix and
says what the alternative costs, rather than leaving a contradiction a later reader resolves by
guessing. Note the criterion as printed (`grep -c "^[a-z]"`, a bare count with nothing to compare
against) **can never fail**; the spec's prefix test replaces it.

**This card contradicted itself.** `Do` step 1 said to create the files **under a `research-helper/`
subfolder** while its own `Do NOT` four lines below forbids anything but **flat** — which is what
`P0-T32` measured (Zotero 10 silently drops subdirectories there). Step 1 was never updated when that
measurement landed; corrected.

**`docs/08`'s chrome namespace was wrong in two places.** It writes `chrome://researchhelper/content/`
while `package.json`'s `addonRef` is `research-helper` and `bootstrap.js` registers that. **`P1-T19`
step 5 and `P1-T20` would both have copied it.** And a measured trap came with the fix: fetching the
hyphenated URL for a **missing** file returns an **empty response**, not an unknown-package error — so
absence must be detected on the content, not on a throw.

**One id had to be invented to unblock `P1-T19`:** `research-helper-menu-collection-search-import`,
because `docs/08` §2.4/§2.5 list **no collection-context entry for Phase 1** although `P1-T19`'s Goal
requires one. Listed in `G-41` as an owner wording decision.

**Criterion 1's markup scrape is written, runs, and is vacuously satisfied — and says so in its own
log.** Phase 1's only document is `P1-T20`'s. Asserting it exists would have left the integration suite
**red for every card in between, including `P1-T19` which depends on this one** — measured: the first
run failed exactly there.

**Three placement rules downstream cards must follow**, none of which the corpus made: a string a
*document* resolves lives in that document's surface file, while one **JavaScript** formats and hands
to more than one surface lives in `mainWindow.ftl` — **so the search window must not resolve an
`rh-error-*` id**, the view model formats it and passes a localized string, exactly as `P1-T15`'s sink
does. The attribute each `searchDialog` entry sets is tabulated at the top of that bundle and
**`P1-T20` must match it or the labels come back blank.** And 7 `rh-error-*` strings are deliberately
deferred to Phase 3, asserted via `DEFERRED_ERROR_MESSAGE_IDS` so wiring one into Phase 1 fails the
suite instead of rendering a blank.

**Four more corpus defects recorded for later cards.** `docs/08` §10.1's directory listing is the stale
subfolder layout **and** its own table names the files unprefixed — the one place the authoritative list
is wrong in both respects. §8.3 and §10.2 give `OFFLINE` two different en-US strings ("Zotero is
offline." vs "No internet connection."; §8.3 followed). §8.3 supplies **no wording for five keys** §10.1
declares. And the import summary line has **four spellings** across §4.4, §4.6, `P1-T22` step 3 and
`FR-51`; `P1-T22`'s was followed because it is the only one that both separates linked-from-created
(`FR-51`) and keeps the duplicate count. **`P1-T30`** owns turning on `fluent.dts` so `keys.ts` stops
being a second source of truth for the vocabulary.
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
| **Depends on** | `P1-T11`, `P1-T22`, `P1-T28` |
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

### P1-T24 — Retire the `P0-T10` spike surface from `itemMapper.ts`

| Field | Value |
|---|---|
| **ID** | `P1-T24` |
| **State** | `TODO` |
| **Depends on** | `P1-T12` |
| **Blocks** | none |
| **Retires** | `P0-T10`'s spike mapper surface |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** `src/zotero/itemMapper.ts` contains one mapper, not two. The `P0-T10` spike exports —
`buildJournalArticle`, `JournalArticleRecord`, `RESEARCH_HELPER_TAG`, `AUTOMATIC_TAG_TYPE` — are
gone, and everything that imported them uses the shipped mapper instead.

**Why this is a card and not part of `P1-T12`.** `P1-T12`'s `Files` list says
`create src/zotero/itemMapper.ts`, which reads as "replace the spike". It cannot: **three files
import the spike exports and none of them is in `P1-T12`'s `Files`** — verified 2026-09-30 —
`src/zotero/zoteroApi.ts` (line 36), `test/integration/zotero/itemCreation.spec.ts` (line 33) and
`test/integration/zotero/batchImport.spec.ts` (line 55). Deleting the surface there would have
broken code that card does not own, so `P1-T12` kept it verbatim in a fenced section and reported
the gap under `plan/README.md` §5 rule 2. **The consequence of leaving it is not neutral:** the
spike mapper ships inside the XPI to every user, and two expressions of the same mapping coexist in
one file, which is exactly the drift `P0-T33` and `P0-T34` were about.

**Read first.**
- `src/zotero/itemMapper.ts` — the fenced `P0-T10` section and the shipped `toZoteroMapping` /
  `toZoteroItemJSON` above it. Read both before assuming they agree.
- `plan/01-phase-0-toolchain-spike.md` `P0-T10` and `P0-T20` **Findings** — what the two integration
  specs actually assert. `P0-T20` measured 100 items in **293–425 ms, median 324**, with no
  main-thread stall over 100 ms; that assertion is the one thing here that must not be weakened, and
  it is `NFR-1`'s only live measurement.
- `src/zotero/zoteroApi.ts` — how it consumes `buildJournalArticle`, and whether it needs the shipped
  mapper's `options` or only its default path.
- `docs/07` §6.2 and §6.3 — the shipped contract the three call sites must move to.

**Files.**
- modify `src/zotero/itemMapper.ts`
- modify `src/zotero/zoteroApi.ts`
- modify `test/integration/zotero/itemCreation.spec.ts`
- modify `test/integration/zotero/batchImport.spec.ts`

**Do.**
1. Move each of the three call sites to `toZoteroItemJSON` / `toZoteroMapping`. `JournalArticleRecord`
   was a spike shape; the shipped mapper takes a `CanonicalWork`, so each call site needs a minimal
   fixture rather than a renamed import.
2. Delete the fenced `P0-T10` section from `itemMapper.ts`.
3. Re-run **both** integration specs against a real Zotero and record the numbers. `P0-T20`'s timing
   assertion must still hold; if the shipped mapper is slower, **report the measurement rather than
   relaxing the threshold** (`plan/README.md` §5 rule 6).
4. Confirm the built XPI no longer contains the spike identifiers, read out of the **packed**
   artifact the way `P0-T34` did — not out of `.scaffold/build/`.

**Do NOT.**
- Do not weaken or delete an assertion to make a spec pass. If the shipped mapper genuinely cannot
  satisfy one, that is a finding about the mapper.
- Do not change `toZoteroMapping`'s behaviour to suit the old call sites. The spike is being retired,
  not preserved behind a shim.
- Do not touch `src/zotero/collectionOps.ts` or the batch-insert path itself; only the mapping call.

**Criteria.**
- [ ] `grep -r 'buildJournalArticle\|JournalArticleRecord' src test` returns nothing.
- [ ] Both integration specs pass against a real Zotero, with their timings recorded and `P0-T20`'s
      ≤ 10 s / no-stall-over-100 ms assertions still asserted, not relaxed.
- [ ] The packed XPI contains none of the four spike identifiers.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.**
```bash
grep -rn 'buildJournalArticle\|JournalArticleRecord\|RESEARCH_HELPER_TAG\|AUTOMATIC_TAG_TYPE' src test \
  && echo 'FAIL: spike surface still referenced' || echo 'OK: spike surface gone'
```

**Notes.** `RESEARCH_HELPER_TAG` and `AUTOMATIC_TAG_TYPE` may deserve to survive as shared constants
rather than being deleted — the shipped mapper needs both. If so, move them to where the shipped
code declares them and delete only the spike's copies; the criterion's grep should then be narrowed
to the two spike-only names, and the change recorded in `Findings` rather than made silently.

---

### P1-T25 — Composition root: construct the HTTP client, limiters and progress reporter

| Field | Value |
|---|---|
| **ID** | `P1-T25` |
| **State** | `TODO` |
| **Depends on** | `P1-T04`, `P1-T05`, `P1-T15` |
| **Blocks** | `P1-T16`, `P1-T31`, `P1-T32` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 1.0 d |
| **Human gate** | none |

**Goal.** Something constructs the machinery Phase 1 has built. `httpRequest()` reaches a real
transport, a request to NCBI is paced by a real bucket, a job's progress reaches a real window, and
every one of those is torn down when the plugin is disabled.

**Why this is a card.** Four cards shipped a seam and none of them owns the other side of it,
measured 2026-09-30: `P1-T05` reports "nothing yet calls `setHttpClient`"; `P1-T04` reports that
`reconfigure()` is in place and "the caller is missing"; `P1-T15` reports "nobody constructs the
sink" and that **neither `P1-T16`'s nor `P1-T20`'s `Files` list contains `src/zotero/progressWindow.ts`
or any `src/zotero/*` path**. `P1-T15`'s `dispose()` exists and is tested; what is missing is the
scope that calls it. `src/bootstrap/container.ts` is on `plan/README.md` §4's sixteen-path list and
currently ships only `P0-T07`'s teardown registry — its own header says the service-locator half is
unwritten.

**Read first.**
- `src/bootstrap/container.ts` (`P0-T07`) and `src/zotero/registrations.ts` (`P0-T31`, `P0-T32`) — the
  `Scope` / `Registration` contract, and the **only** file allowed to call Zotero's four registration
  APIs. `P0-T11` proved the teardown across five disable/enable cycles and `P0-T33` found that
  constructing the toolkit leaked a listener on every cycle; a registration with no matching removal
  is the failure mode both exist to prevent.
- `src/core/http/client.ts`'s `createHttpClient` / `setHttpClient` and its `HttpClientDeps` — note
  `timeoutMs` is a **getter**, because `core/` may not import `src/prefs/`.
- `src/core/rateLimit/hostLimiter.ts` — `createHostLimiterRegistry`, `installHostLimiters`, and the
  `PrefStore`-driven `ncbi.keyPresent` observer.
- `src/core/jobQueue/progress.ts`'s `CompositeProgressReporter` and `createObservableProgressSink`,
  and `src/zotero/progressWindow.ts`'s `ZoteroProgressWindowSink` with its `openOn` option.
- `docs/07` §2.3 — what may name what. The composition root is the one place allowed to know all of
  it.

**Files.**
- modify `src/bootstrap/container.ts`
- modify `src/bootstrap/registerUI.ts`
- create `test/unit/bootstrap/container.test.ts`

**Do.**
1. Build the object graph once, at startup, in dependency order: `PrefStore` → limiter registry →
   `HttpClient` (transport, user agent, timeout getter, `limiterFor`, clock, logger) → progress
   reporter and its sinks. Call `setHttpClient()` with it.
2. Register every disposable with the existing scope so `shutdown()` undoes all of it, and assert
   that in the test rather than by inspection.
3. Supply `observePref`'s handle at this level. `docs/07` §8.5.1 sketches a `Symbol` return, which
   `P1-T03` measured as unreachable — `Zotero.Prefs.registerObserver` is confined to
   `registrations.ts` by `FR-56`, whose factory returns a `ScopedRegistration`, and `core/` may not
   name bootstrap's types. The port carries an opaque handle; **this card is where it becomes a real
   one.**
4. Prove the cycle: construct, dispose, construct again, and assert no listener, observer or window
   survives — the `P0-T11` discipline, at the composition root rather than per registration.

**Do NOT.**
- Do not call a registration API from anywhere but `src/zotero/registrations.ts`; `P0-T31` made that
  a lint error precisely so this card cannot take a shortcut.
- Do not construct a second `HttpClient`, limiter registry or reporter anywhere else. If a caller
  needs one, it takes it as a parameter. Two graphs means two rate limiters and a paced host that
  is not actually paced.
- Do not read a pref from `src/core/`. Pass a getter.

**Criteria.**
- [ ] `httpRequest()` issues through the real transport after startup, asserted with a fake transport
      installed at the root rather than by patching the module.
- [ ] A second request to the same host is paced by the registry's bucket, asserted on the clock.
- [ ] Construct → dispose → construct leaves zero surviving registrations, observers or windows.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- container`

**Notes.** `P1-T05` left the exact call shape in its report; start from it rather than re-deriving.
The `openOn` option decides §7.7-vs-§4.4 behaviour per pipeline — `searchImport` passes
`"completion"`. If this card finds it needs a path no `Files` list names, that is the same class of
defect `P1-T15` reported, and it should be reported rather than absorbed.


**Findings, 2026-10-01 — all four criteria pass, and two design consequences surfaced that neither
this card nor `P1-T15` could have found without wiring it up.** `installServices()` in
`src/bootstrap/container.ts` is the one construction site; `registerUI.ts` chooses the
implementations; **15 tests**. typecheck, lint:check and the whole suite exit 0 — **787 unit tests**,
up from 772. Verified independently: the constructors appear in `container.ts` and nowhere else.

**§4's corrected rule applied, and it mattered for the fourth time.** Both paths are on the
sixteen-path relaxation list. Grepped first: `container.ts` is imported by **`src/addon.ts`** and
**`src/zotero/registrations.ts`**, and `registerUI.ts` by **`src/hooks.ts`** — **none of the three in
this card's `Files`.** Both files were extended; every previously exported symbol is still exported
and all three importers still resolve. The qualifying sentence added to §4 earlier the same day paid
for itself immediately.

**The double-install guard is the `Do NOT` made mechanical rather than remembered.** A second
`installServices()` throws `ConfigurationError` **before mutating anything**, so the standing graph
survives the attempt. That matters because two graphs means two rate limiters and a host paced at
twice its documented rate — a silent correctness bug whose symptom is someone else's 429, not a
local error.

**Criterion 2 was asserted on an observation, not an assumption.** Two requests to
`eutils.ncbi.nlm.nih.gov`: after a microtask flush the fake transport has **one** call, so the second
caller is parked inside `TokenBucket.acquire` — *before the wire*, which is §7.4's step order. The
manual clock then advances **one millisecond at a time** until the second call lands, and the
transport records `clock.now()` itself: `calls[0].atMs === t0`, `calls[1].atMs === t0 + 400`, with 400
**derived from the shipped §7.3 row** rather than restated, so a change to the policy table fails
this loudly. A sibling asserts the deliberate opposite — an unregistered host has no limiter and both
requests go straight through (`P1-T04` rule 4).

**Criterion 3 was run five times, because the leak class it guards against is per-cycle.** Five
construct/dispose cycles, each actually running a job so the popup is genuinely raised. After each
`unregisterAll()`: `liveHandles()` empty, the fake store's observers 1 → **0**, the popup's `close()`
called, `getHttpClient()` / `peekHostLimiters()` / `getPrefStore()` all `undefined` — **which is why
the next cycle can construct at all**, since `installHostLimiters` refuses a second install — and
zero teardown failures. A sibling asserts the teardown *order*: progress surfaces out first,
`PrefStore` last. `P0-T33`'s leak was exactly this shape and invisible to a single cycle.

**`observePref`'s handle became real, and it was not a cast.** Two shapes arrive and they are
**semantic opposites**, both functions and both satisfying `object`: `createZoteroPrefStore()` returns
a `ScopedRegistration` whose call **registers** the observer, while `createMemoryPrefStore()` returns
the unsubscribe thunk, whose call **unregisters** it. So `typeof handle === "function"` cannot tell
"register me" from "undo me", and **guessing wrong silently removes the observer just installed** —
`ncbi.keyPresent` would stop raising the NCBI budget with nothing at all to see. They are
discriminated on **arity**, the only property that separates them, and a non-callable handle throws
rather than leaking. All three branches are asserted, including the live path end to end:
`ncbi.keyPresent` → `notify` → `refresh()` → the bucket's rate rises to the with-key row, and stops
responding after teardown. **The real fix is a discriminated return type on `PrefStore.observe` in
`src/core/config.ts`, outside this card's `Files`** — §8.5.1's sketched `Symbol` remains unbuildable
exactly as `P1-T03` measured, and the "refuses a handle it cannot bind" test is that measurement's
regression guard.

**An assertion this card wrote itself FAILED, and it was reported rather than weakened.**
`CompositeProgressReporter.dispose()` **does not stop the reporter tree.** Verified in
`src/core/jobQueue/progress.ts`: a node is inert when `this.finished || this.root.terminal ||
this.parent?.inert`, and **`disposed` is not one of the three** — `root.terminal` is set only by
`done()`. So a job that outlives the plugin still fans out. The two shipped sinks then **disagree**:
`ZoteroProgressWindowSink` carries its own `disposed` guard, which is what criterion 3's "no window
survives" actually rests on, while `createObservableProgressSink()` has none — its `dispose()` clears
`latest` but does not **latch**, so the next `update()` repopulates a sink nothing can subscribe to.
That is what made `expect(latest).toBeUndefined()` fail. The test now asserts the measured asymmetry
and names it, in the pattern `tokenBucket.ts` used for `inFlight: 0`, so the gap is **visible in the
suite** rather than rediscovered by `P1-T16`. **Needs a card.**

**The consequence `P1-T16` will hit on its first second job: one app-scoped reporter can report
exactly one job per plugin lifetime.** §4.1's `done()` is terminal, and this card's step 1 and `Do
NOT` require one reporter constructed at the root — so `graph.progress` works for the first job and
**silently ignores every later one**. A per-job tree over the root's sinks does not fix it either,
because `reporter.dispose()` disposes the **shared** sinks, so the first job to finish would close the
application's surfaces. The card's one reporter shipped, with both halves recorded on `ServiceGraph`
rather than a factory invented (rule 2). **Needs a card**, and the same root cause makes `openOn`
wrong from Phase 4: it is per-pipeline per this card's `Notes` but the reporter is per-application, so
the `"completion"` default is correct only while `searchImport` is the only pipeline.

**Two platform facades are missing and the log is lossy because of it.** `src/core/logger.ts`'s
`LogSink.write(line, zoteroLevel)` is documented as passing the level straight to `Zotero.debug`'s
second argument — and `zoteroApi.debug(message)` **takes no second argument**, so every line lands at
Zotero's default level and Zotero-side filtering is dead. Worse, **`LogSink.reportError` has no
implementation at all**, because `Zotero.logError()` has no facade in `src/zotero/` whatsoever, so an
`error()` line never reaches the Mozilla error console or `Zotero.getErrors()` (`docs/07` §10.3). The
lossy sink shipped rather than `NULL_LOG_SINK`, because lines at the wrong level beat no lines at all
in a log users paste into bug reports; both losses are documented at the call site. **Needs a card.**
Cosmetic, same area: `createLogger` prefixes `[research_helper]` and `zoteroApi.debug` prefixes
`[research-helper]`, so every product line carries both — **differing by one character**, with only
the second matching `config.addonRef`.

**No Fluent id exists for the progress-window headline.** The sink requires an **already-localized**
string (`getString()` throws on a plugin key per `docs/08` §8.2.1, and Fluent is async), and
`src/i18n/keys.ts` declares no such id — the nearest three are argument-bearing status ids for the
search dialog, not a popup headline. `config.addonName` ships, which is a brand name rather than a
translatable sentence. **Needs a card**, and note the hard part is not the id: resolution is async and
per-window while this graph is built app-scoped at startup.

**Not run, and it matters here: `npm run test:integration`.** `test/integration/lifecycle.spec.ts`
cycles disable/enable and asserts zero survivors, and that path now runs the whole service graph —
including a **real** `Zotero.Prefs.registerObserver` and a real `Zotero.HTTP` read. The unit suite
proves the cycle over fakes five times and proves the global holders are empty afterwards, but **the
real `registerObserver`/`unregisterObserver` pair is unverified on the platform.** One manual
disable/enable cycle on a running Zotero is owed before this card is approved.
---

### P1-T26 — Collapse the duplicate `Retry-After` parser and drive `reconfigure()` from live headers

| Field | Value |
|---|---|
| **ID** | `P1-T26` |
| **State** | `TODO` |
| **Depends on** | `P1-T04`, `P1-T05` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** One `Retry-After` parser in the codebase, and the rate limiter reconfigured from the
headers the servers actually send rather than from a table.

**Why this is a card.** Two measured defects, both found 2026-09-30 and both left in place under
rule 2. **First, the duplicate:** `P1-T05` step 4 and `P1-T04` step 6 both require a `Retry-After`
parser and both shipped one — `parseRetryAfterMs` in `src/core/http/retry.ts` and `parseRetryAfter`
in `src/core/rateLimit/backoff.ts`. Verified present, with each file's header acknowledging the
other; they independently landed on the same two-argument shape. **Second, the missing caller:** this
card's `Read first` in `P1-T04` says the governor "should read rather than assume" NCBI's live
`X-RateLimit-Limit` / `X-RateLimit-Remaining`, and `docs/07` §7.3 says `reconfigure()` "is called
from those headers on every response" for Crossref. Reading a response header needs a response,
which lives in `src/core/http/` — a path `P1-T04` may not touch — and `P1-T05`'s `Do` steps do not
mention it. **The seam is in place and nothing calls it.**

**Read first.**
- `src/core/rateLimit/backoff.ts`'s `parseRetryAfter` and its header comment. **Read the `Date.parse`
  warning there and in `docs/07` §7.3 before touching the parser:** `Date.parse("120")` returns year
  0119 with `isNaN` false, so the usual guard sends a **valid** delta-seconds header down the date
  branch and produces "retry immediately" against a host that just asked us to stop — `docs/02`
  §3.1's route to an IP block. The three malformed strings are asserted; keep those assertions.
- `src/core/http/retry.ts`'s `parseRetryAfterMs` — the copy being removed.
- `docs/02` §3.1 (NCBI's live headers, verified) and `docs/07` §7.3 (Crossref's
  `x-rate-limit-limit` / `x-rate-limit-interval`).
- `P0-T21`'s `Findings` — 26 identified requests across five hosts with no throttling, so the
  headers are observable in practice.

**Files.**
- modify `src/core/http/client.ts`
- modify `src/core/http/retry.ts`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `test/unit/core/http-client.test.ts`

**Do.**
1. Delete `parseRetryAfterMs` and point `client.ts` at `backoff.ts`'s `parseRetryAfter`. `backoff.ts`
   is the better home: it already owns the jitter and the budget.
2. On every response, read the host's rate-limit headers when present and call `reconfigure()` with
   them. **Only when present** — an absent header is not a signal to guess.
3. Assert the reconfiguration end to end: a response carrying a lower limit slows the next acquire,
   driven by the manual clock.

**Do NOT.**
- Do not reintroduce a bare `Date.parse` guard, and do not accept `asctime` — it carries no timezone
  and would be read in the local zone.
- Do not invent a rate when a header is absent or malformed. `limiterFor()` returning `undefined` for
  an unknown host is deliberate (`P1-T04`, rule 4).
- Do not widen this into the per-host default-policy question; that is a separate open item.

**Criteria.**
- [ ] `grep -rn 'parseRetryAfterMs' src test` returns nothing.
- [ ] A 429 carrying `Retry-After: 120` still penalizes by exactly 120 000 ms, and the three
      malformed strings still return `undefined` — the existing assertions survive the move.
- [ ] A response whose rate-limit headers tighten the limit demonstrably slows the next acquire.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- http tokenBucket backoff`

---

### P1-T27 — Give the concurrency cap an owner, or remove it from the interface

| Field | Value |
|---|---|
| **ID** | `P1-T27` |
| **State** | `TODO` |
| **Depends on** | `P1-T04`, `P1-T05` |
| **Blocks** | `P2-T05` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** `maxConcurrent` either works or is gone. A config member that cannot be enforced is worse
than no member, because every later reader assumes it is doing something.

**Why this is a card, and why it blocks Phase 2.** Measured 2026-09-30 (`P1-T04`) and confirmed
against §4.1: `RateLimiter` declares `key`, `acquire`, `tryAcquire`, `penalize`, `reconfigure` and
`stats`. **`acquire` resolves `void`, there is no release handle and no `run()`** — so nothing ever
signals that a request finished, an `inFlight` counter could never be decremented, and gating
`acquire` on one would **deadlock the bucket permanently** after `maxConcurrent` calls. §7.3's own
skeleton declares `private inFlight = 0` and stops there. `TokenBucket` therefore paces by rate only
and reports `inFlight: 0`, asserted so the gap is visible in the suite, with the cap carried as
policy data. **Phase 2's arXiv row is `maxConcurrent: 1`** — and §7.3 says that limit is
"aggregated across all of the machines under your control as a whole", so it is not decoration.

**Read first.**
- `docs/07` §4.1 (`RateLimiter`, `RateLimiterConfig.maxConcurrent`, `RateLimiterStats.inFlight`) and
  §7.3's skeleton.
- `src/core/rateLimit/tokenBucket.ts` — the `inFlight: 0` assertion, which is the thing that must
  stop being true.
- `src/core/concurrency.ts`'s `Semaphore` — **it already models exactly this**, including the
  recorded invariant that `unsubscribe()` runs before `resolve()` or a permit leaks to a promise
  nobody awaits, and `run()` releasing in a `finally`. Reuse it; do not write a second one.
- `docs/02` §5 for arXiv's published limit.

**Files.**
- modify `docs/07-architecture-and-data-model.md`
- modify `src/core/rateLimit/tokenBucket.ts`
- modify `src/core/http/client.ts`
- modify `test/unit/core/tokenBucket.test.ts`

**Do.**
1. Decide where the in-flight count lives and record the reasoning in §4.1. Two honest shapes: give
   `RateLimiter` a `run<T>(fn, cost?, token?)` that holds a `Semaphore` permit for the call's
   lifetime, or leave the limiter rate-only and count in-flight in the HTTP client, which is the one
   place that knows when a request ends. **The first keeps the cap where the config declares it; the
   second keeps the limiter synchronous-ish and testable. Pick one and say why.**
2. Implement it, and make `stats.inFlight` report a real number.
3. Assert the cap with a gated fake transport: `maxConcurrent: 1` must serialise two overlapping
   requests, and the second must start only after the first settles — **including when the first
   rejects**, which is the case a missing `finally` breaks.
4. Assert that a cancelled request releases its slot.

**Do NOT.**
- Do not gate `acquire` on a counter nothing decrements. That is the deadlock this card exists to
  prevent, and it would pass a naive test that only issues `maxConcurrent` requests.
- Do not invent a `maxConcurrent` value for a host §7.3 does not give one.

**Criteria.**
- [ ] With `maxConcurrent: 1`, two overlapping requests are serialised, asserted on start order.
- [ ] A rejecting request still releases its slot; a cancelled one does too.
- [ ] `stats.inFlight` is non-zero while a request is in flight and returns to 0 after.
- [ ] §4.1 records which shape was chosen and why.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- tokenBucket http`

---

### P1-T28 — Settle §7.3's retry numbers, and wire them

| Field | Value |
|---|---|
| **ID** | `P1-T28` |
| **State** | `TODO` |
| **Depends on** | `P1-T05` |
| **Blocks** | `P1-T23` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes** — the owner supplies the three numbers; an agent may not invent them (`plan/README.md` §5 rule 4). |

**Goal.** The retry policy has numbers, they live in one place, and `P1-T05`'s injected budget is
actually populated.

**Why this is a card.** Measured 2026-09-30 (`P1-T04`, `P1-T05`): `docs/02` §2.4 and `docs/05` §9.4
both name `docs/07` §7.3 as the owner of "the shipped backoff shape **and attempt cap**" — and
§7.3's policy table has columns for rate, burst and max-concurrent **only**. There is no `base`, no
`cap` and no attempt-cap number anywhere, and `docs/07` §8.5 has no retry rows either. `docs/03`
§11.6's `maxAttempts = 5 / baseMs = 1000 / capMs = 60_000` are the **LLM** defaults for a
**differently shaped** backoff and must not be borrowed. So `RetryBudget` shipped with no defaults
and **`P1-T05` step 4's "using `P1-T04`'s jitter and cap" has no numbers to use** — absent a policy,
the client makes exactly one attempt. Both agents refused to invent them, correctly.

**Read first.**
- `docs/07` §7.3's policy table — the columns that exist, and the sentence that claims ownership.
- `src/core/rateLimit/backoff.ts`'s `RetryBudget` / `createBackoff`, and §7.3's decorrelated-jitter
  shape `min(cap, random(base, prev*3))`. **`docs/05` §9.4 explicitly forbids a second shape.**
- `src/core/http/retry.ts`'s `RetryPolicy`, the injection point.
- `P0-T21`'s `Findings` for what real hosts did under load, and `P0-T22`'s — Semantic Scholar
  returned **429 on 12 of 12** unauthenticated requests over 72 s, which is the shape of evidence an
  attempt cap should be argued from.

**Files.**
- modify `docs/07-architecture-and-data-model.md`
- modify `src/core/rateLimit/hostLimiter.ts`
- modify `test/unit/core/backoff.test.ts`

**Do.**
1. **Stop and ask the owner for `base`, `cap` and the per-host attempt cap.** Report the evidence
   above; do not propose a number as if it were measured.
2. Add the three columns to §7.3's table, per host, with the source of each value named.
3. Put the values on the policy rows in `hostLimiter.ts` and assert them against §7.3 by reading the
   shipped row rather than restating it — the pattern `P1-T04`'s pacing test already uses, so a
   change to §7.3 fails loudly.

**Do NOT.**
- Do not copy `docs/03` §11.6's numbers. Different shape, different subsystem, and §9.4 forbids a
  second shape.
- Do not hardcode a limit outside the policy table (`plan/README.md` §5 rule 4).

**Criteria.**
- [ ] §7.3's table has `base`, `cap` and attempt-cap columns, each value's source named.
- [ ] The shipped policy rows carry them and a test reads §7.3's values from the row.
- [ ] A 503 retried under the real policy stops at the cap, asserted on the transport call count.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- backoff http`

**Notes.** There is a second, pre-existing conflict this card should flag but **not** resolve:
`P3-T05` step 7 instructs **full** jitter over `min(cap, base * 2**attempt)` from `docs/03` §11.6,
while §7.3 and `docs/05` §9.4 specify **decorrelated** jitter — and `P3-T05`'s `Files` list modifies
`backoff.ts`. Two differently-shaped backoffs will otherwise end up in one file. Report it; the
decision is the owner's.

---

### P1-T29 — Verify the `ProgressWindow` / `ItemProgress` signatures against a running Zotero

| Field | Value |
|---|---|
| **ID** | `P1-T29` |
| **State** | `TODO` |
| **Depends on** | `P1-T15` |
| **Blocks** | none |
| **Retires** | `docs/07` §7.7's `> **Unverified:**` marker |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** The one wrapper that names Zotero's progress-window API is confirmed against the running
application, and `docs/01` records the result — which is what §7.7's `Unverified` marker asks for by
name.

**Why this is a card.** Three sources disagree about the arguments, measured 2026-09-30 (`P1-T15`).
`docs/07` §7.7's sketch passes an **icon URI** as `ItemProgress`'s first argument. `docs/08` §8.2,
read from `progressWindow.js`, says it is an **item type string** and that passing a path is "a live
Zotero bug. Do not copy it." And **`zotero-types@4.1.3` declares `setIcon(iconSrc: string)` and no
`setItemTypeAndIcon` at all**, contradicting §8.2 outright. The shipped sink follows §8.2 and calls
neither icon setter. Nothing has been run against a real window.

**Read first.**
- `src/zotero/progressWindow.ts` — `openZoteroProgressWindow()` is the **only** place the platform
  class is named, so a correction is one function.
- `docs/08` §8.2 and §8.2.1, `docs/07` §7.7's marker and `node_modules/zotero-types/types/xpcom/progressWindow.d.ts`.
- `docs/13` §2.3 — what an integration spec may do.

**Files.**
- create `test/integration/zotero/progressWindow.spec.ts`
- modify `src/zotero/progressWindow.ts`
- modify `docs/01-zotero-plugin-platform.md`

**Do.**
1. Open a real popup, add a line, set 45 %, set an error, close it. Assert no throw.
2. **Report which of `setIcon` and `setItemTypeAndIcon` actually exists**, and what `ItemProgress`
   does with each kind of first argument. That is the measurement.
3. Record it in `docs/01` §10.x as the marker instructs, and retire the marker only if the answer is
   complete.
4. Correct the wrapper if the measurement disagrees with §8.2.

**Do NOT.**
- Do not pass an icon path to see what happens in a way that leaves a broken popup behind; close
  what you open.
- Do not widen the wrapper's surface. It is narrow on purpose.

**Criteria.**
- [ ] The spec runs against a real Zotero and reports which icon setter exists.
- [ ] `docs/01` §10.x carries the measured signatures, dated.
- [ ] §7.7's `Unverified` marker is retired or narrowed to exactly what is still open.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail`
— and **check the test count, not just the exit code**: this runner has been seen to exit 0 after
running nothing.

---

### P1-T30 — Turn on `fluent.dts` and make one source of truth for message ids

| Field | Value |
|---|---|
| **ID** | `P1-T30` |
| **State** | `TODO` |
| **Depends on** | `P1-T18` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** The `FluentMessageId` union is generated from the bundles, and `src/i18n/keys.ts` derives
from it rather than restating it.

**Why this is a card.** `zotero-plugin.config.ts`'s comment reads "Off until the first `.ftl` file
lands (`P0-T24` owns localization) … Turn this back on in `P0-T24`, when there are messages to put in
the union, and file the bug upstream." `P0-T24` did not turn it on, and **`P1-T18` shipped 84
messages**, so the scaffold's generated union would no longer be the empty-union parse error the
switch was disabled around. Until it is on, `keys.ts`'s hand-written union and the generated one are
**two sources of truth for the same vocabulary**, and a bundle edit that forgets `keys.ts` is an
invisible blank label rather than a compile error.

**Read first.**
- `zotero-plugin.config.ts`'s `fluent` block and its comment.
- `src/i18n/keys.ts` — the hand-written `FluentMessageId`, `FluentMessageArgsMap`, `ERROR_MESSAGE_IDS`
  and the `KO_*` lists. The **argument type map** is the part the generator does not produce, so it
  stays hand-written whatever happens to the id union.
- `test/integration/l10n.spec.ts`'s vocabulary self-consistency tests — they are what will catch a
  bad reconciliation.

**Files.**
- modify `zotero-plugin.config.ts`
- modify `src/i18n/keys.ts`
- modify `test/integration/l10n.spec.ts`

**Do.**
1. Turn `fluent.dts` on and check what it generates for 84 messages across two surfaces.
2. Make **one** of the two authoritative and derive the other. The generated union is the honest
   direction — it cannot drift from the bundles — so `keys.ts` should narrow or re-export it.
3. Keep the per-message argument map hand-written, and keep the test that asserts every id in it
   exists in a bundle.
4. If the scaffold's empty-union bug is still reproducible, **file it upstream** and link the issue in
   the config comment, which is what the comment asks for.

**Do NOT.**
- Do not delete `keys.ts`'s `KO_PENDING_REVIEW` / `KO_DELIBERATELY_ABSENT` / `DEFERRED_ERROR_MESSAGE_IDS`.
  Those encode decisions, not vocabulary, and the spec asserts them.
- Do not turn the switch on and leave two unions in place. That is the current state.

**Criteria.**
- [ ] `typings/` carries a generated id union covering all 84 messages.
- [ ] `keys.ts` derives from it; a bundle id removed without touching `keys.ts` is a **compile**
      error, asserted by trying it.
- [ ] The `KO_*` and deferred-error lists still hold and their tests still pass.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:integration -- --exit-on-finish --abort-on-fail`

---
### P1-T31 — Make a progress reporter usable for more than one job

| Field | Value |
|---|---|
| **ID** | `P1-T31` |
| **State** | `TODO` |
| **Depends on** | `P1-T15`, `P1-T25` |
| **Blocks** | `P1-T16` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.5 d |
| **Human gate** | none |
**Goal.** A second job reports progress. Today it does not, silently.

**Why this is a card, and why it blocks `P1-T16`.** Two measured facts from 2026-10-01 (`P1-T25`),
both verified against `src/core/jobQueue/progress.ts`:

1. **One app-scoped reporter can report exactly one job per plugin lifetime.** §4.1's `done()` is
   terminal — "further calls are ignored" — and `P1-T25` step 1 and its `Do NOT` require **one**
   reporter constructed at the root. So `ServiceGraph.progress` works for the first job and **silently
   ignores every later one.** The symptom is a progress bar that never moves on the second search,
   with no error anywhere.
2. **`dispose()` does not stop the reporter tree.** A node is inert when
   `this.finished || this.root.terminal || this.parent?.inert` — and **`disposed` is not one of the
   three**; `root.terminal` is set only by `done()`. So a job that outlives the plugin still fans out.

And the obvious fix does not work: a per-job tree over the **root's** sinks cannot simply be newed up,
because `reporter.dispose()` disposes the **shared** sinks — so the first job to finish would close
the application's progress surfaces out from under every other job.

**A third symptom with the same root cause.** `openOn` is **per-pipeline** (`P1-T25`'s `Notes`:
`searchImport` passes `"completion"`, §7.7's `related` and `audioReport` want `"progress"`) while the
reporter and its sinks are **per-application**. The `"completion"` default is correct only while
`searchImport` is Phase 1's only pipeline, and stops being correct the moment Phase 4 or 6 lands.

**Read first.**
- `src/core/jobQueue/progress.ts` — `ProgressNode.inert`, `done()`'s `root.terminal = true`,
  `CompositeProgressReporter.dispose()`, and `createObservableProgressSink()`. **Read why the two
  shipped sinks disagree:** `ZoteroProgressWindowSink` carries its own `disposed` guard and
  **`P1-T25`'s criterion 3 ("no window survives") actually rests on that guard**, while the
  observable sink clears `latest` without latching, so the next `update()` repopulates a sink nothing
  can subscribe to.
- `src/bootstrap/container.ts`'s `installServices()` and `ServiceGraph.progress` — the construction
  site, and the comment recording both halves of this problem.
- `docs/07` §4.1 (`ProgressReporter`, and that it is **write-only** — no member reads state back and
  none releases resources) and §4.5 (`JobProgressSnapshot`, `JobHandle.subscribe`).
- `docs/08` §4.4 and `docs/07` §7.7 — the two popup behaviours `openOn` carries.

**Files.**
- modify `src/core/jobQueue/progress.ts`
- modify `src/bootstrap/container.ts`
- modify `test/unit/core/progress.test.ts`
- modify `test/unit/bootstrap/container.test.ts`

**Do.**
1. Decide the shape and record the reasoning in the module header. Two honest options: a **factory**
   on the graph (`graph.progress.forJob(label, { openOn })`) that builds a fresh tree over sinks it
   does **not** own, with the application owning the sinks' lifetime; or **per-job sinks** built
   alongside each tree, with the graph owning only the factory. **The first keeps one popup and one
   observable stream for the whole plugin; the second lets two jobs report at once. Say which, and
   why.**
2. Make `dispose()` latch the tree — add disposal to the inert condition — so a job that outlives the
   plugin stops fanning out.
3. Give `createObservableProgressSink()` the latch `ZoteroProgressWindowSink` already has, so the two
   sinks stop disagreeing. **`P1-T25`'s test asserts the current asymmetry by name; update that
   assertion rather than deleting it**, so the fix is visibly the fix.
4. Move `openOn` to the per-job call. Assert that two pipelines with different `openOn` values both
   behave correctly in one plugin lifetime.
5. Assert the thing that does not work today: **job 1 runs to `done("succeeded")`, then job 2 reports
   and is observed.** That single assertion is this card.

**Do NOT.**
- Do not let a per-job reporter's `dispose()` close the application's shared surfaces. That is the
  trap that makes the obvious fix wrong, and its symptom is the *first* job's completion killing every
  later job's progress bar.
- Do not widen §4.1's `ProgressReporter` interface. `P1-T15` measured it as implementable exactly as
  declared; the factory and the lifetime belong **outside** it, as `snapshot` and `dispose()` already
  do.
- Do not construct a second set of sinks at the root. `P1-T25`'s double-install guard exists because
  two graphs means two rate limiters.

**Criteria.**
- [ ] After job 1 reaches `done("succeeded")`, job 2 reports and its progress is observed — the
      assertion that fails today.
- [ ] Two concurrent jobs do not corrupt each other's counts or `currentStageKey`.
- [ ] A disposed reporter's further calls reach **no** sink, and the observable sink's `latest` stays
      cleared after disposal — the asymmetry `P1-T25` recorded is gone and its test says so.
- [ ] The first job's completion does not close surfaces a second job is still using.
- [ ] Two pipelines with different `openOn` values both behave correctly in one lifetime.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- progress container`

**Notes.** §4.1's `child()` doc promises weights its signature does not carry and no card owns the
weight-to-fraction conversion (recorded in §4.1 by `P1-T15`). If this card's factory makes that
conversion's home obvious, say so — but **do not write it**; `P1-T16` step 2 is its natural owner.

---
### P1-T32 — The three platform seams the composition root could not reach

| Field | Value |
|---|---|
| **ID** | `P1-T32` |
| **State** | `TODO` |
| **Depends on** | `P1-T25` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | part of `NFR-16` |
| **Estimate** | 0.5 d |
| **Human gate** | none |
**Goal.** An `error()` line reaches Zotero's error console, a log line carries its level, the progress
popup has a localizable headline, and `PrefStore.observe`'s handle says what it is.

**Why these are one card.** All four are the same shape — a seam `P1-T25` had to bind from inside its
own two files because **no card's `Files` names the other side** — and each is small on its own.
Measured 2026-10-01.

**1. `LogSink.reportError` has no implementation at all.** `docs/07` §10.3 routes `error()` to
`Zotero.logError()` so it reaches the Mozilla error console and `Zotero.getErrors()` — and
**`Zotero.logError` has no facade in `src/zotero/` whatsoever**, so that path is dead. This is the one
of the four with a user-visible cost: an error the user is asked to paste into a bug report is not
there.

**2. Every log line lands at Zotero's default level.** §10.3 documents `LogSink.write(line,
zoteroLevel)` as passing the level "straight through as `Zotero.debug`'s second argument", and the
only facade available, `zoteroApi.debug(message)`, **takes no second argument** — so Zotero-side level
filtering is dead and `docs/08` §7.3's log-level control has nothing to act on. `P1-T25` shipped the
lossy sink deliberately, because lines at the wrong level beat no lines in a pasted log, and
documented both losses at the call site.

**3. No Fluent id exists for the progress-window headline.** `ZoteroProgressWindowSink` requires an
**already-localized** string — `Zotero.getString()` **throws** on a plugin key when the locale is
`en-US` (`docs/08` §8.2.1), because a plugin's `.ftl` lives in `L10nRegistry` and not in that
synchronous bundle — and `src/i18n/keys.ts` declares no headline id; the nearest three are
argument-bearing status ids for the search dialog. `config.addonName` ships today, a brand name rather
than a translatable sentence. **The hard part is not the id**: Fluent resolution is async and
per-window, while the graph is built app-scoped at startup.

**4. `PrefStore.observe`'s return type cannot be discriminated.** Two implementations return handles
that are **semantic opposites** — the Zotero store's call **registers** the observer, the memory
store's **unregisters** it — and both are functions satisfying `object`, so `typeof` cannot tell them
apart. `P1-T25` discriminates on **arity**, the only property that separates them, because guessing
wrong **silently removes the observer just installed** and `ncbi.keyPresent` would stop raising the
NCBI budget with nothing to see. `docs/07` §8.5.1's sketched `Symbol` return remains unbuildable,
exactly as `P1-T03` measured.

**Read first.**
- `src/core/logger.ts`'s `LogSink` and `NULL_LOG_SINK`, and `docs/07` §10.3's line shape and level
  mapping.
- `src/zotero/zoteroApi.ts`'s `debug` — and **`src/zotero/registrations.ts`**, because adding a facade
  must not add a registration. `P0-T31` made a bare registration call a **lint error**.
- `src/bootstrap/container.ts`'s `adoptPrefObserverHandle()` — the arity discrimination and the
  "refuses a handle it cannot bind" test, which is `P1-T03`'s measurement's regression guard. **Keep
  that test passing**; it should become redundant, not deleted.
- `src/core/config.ts`'s `PrefStore` / `PrefObserverHandle`, and `src/i18n/keys.ts`'s surface id
  tuples and argument map.
- `docs/08` §10.1's placement rule as `P1-T18` recorded it: a string **JavaScript** formats and hands
  to more than one surface lives in `mainWindow.ftl`.

**Files.**
- modify `src/zotero/zoteroApi.ts`
- modify `src/core/config.ts`
- modify `src/bootstrap/container.ts`
- modify `src/i18n/keys.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- modify `test/unit/bootstrap/container.test.ts`

**Do.**
1. Give `zoteroApi.debug` the level argument §10.3 requires, and add a `logError` facade. Then build
   the real `LogSink` and assert both channels — **including that an `error()` line reaches
   `reportError`**, which is the half with no implementation today.
2. Make `PrefStore.observe`'s return a **discriminated** type, so the composition root binds it by
   tag rather than by arity. Keep `adoptPrefObserverHandle`'s refusal path.
3. Add one `mainWindow` headline id and its `en-US` string. **Add the `ko-KR` entry to
   `KO_PENDING_REVIEW` and leave it as a commented stub** — gate `G-41` owns the translation and
   machine translation is forbidden.
4. Resolve it where resolution is possible. If an app-scoped startup cannot await Fluent, **say so and
   pass a resolver rather than a string** — do not fall back to a brand name silently, which is what
   today's code does with a comment.
5. Fix the double prefix while in the area: `createLogger` emits `[research_helper]` and
   `zoteroApi.debug` emits `[research-helper]`, so every product line carries **both, differing by one
   character**, and only the second matches `config.addonRef`.

**Do NOT.**
- Do not machine-translate the Korean headline (`G-41`, and `P1-T18`'s discipline: a plausible wrong
  translation is worse than a visible gap).
- Do not call a Zotero registration API outside `src/zotero/registrations.ts`.
- Do not widen `zoteroApi.ts` beyond these two facades. It is on §4's sixteen-path list and
  `P1-T05`/`P1-T25` both **extended** it rather than replacing it; keep doing that, and grep for
  importers first (`plan/README.md` §4, corrected 2026-09-30).

**Criteria.**
- [ ] An `error()` call reaches `Zotero.logError`, asserted through the facade with a fake.
- [ ] A `debug()` line carries its mapped Zotero level, asserted on the second argument.
- [ ] `PrefStore.observe`'s handle is discriminated by tag; the composition root no longer inspects
      arity, and the refusal test still passes.
- [ ] The headline resolves from Fluent in `en-US`, and `ko-KR` falls back to English with the id on
      the `G-41` review list.
- [ ] A product log line carries **one** prefix.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- container logger`

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
| `P1-T24` | Retire the `P0-T10` spike surface from `itemMapper.ts` | 0.25 | — |
| `P1-T25` | Composition root: HTTP client, limiters, progress reporter | 1.00 | — |
| `P1-T26` | Collapse the duplicate `Retry-After` parser; `reconfigure()` from headers | 0.50 | — |
| `P1-T27` | Give the concurrency cap an owner | 0.50 | — |
| `P1-T28` | Settle §7.3's retry numbers | 0.25 | **Yes** |
| `P1-T29` | Verify the `ProgressWindow` signatures against a running Zotero | 0.25 | — |
| `P1-T30` | Turn on `fluent.dts`; one source of truth for message ids | 0.25 | — |
| `P1-T31` | Make a progress reporter usable for more than one job | 0.50 | — |
| `P1-T32` | The three platform seams the composition root could not reach | 0.50 | — |
| | **Total** | **22.75 d** | **4 gates** |

### Comparison with `docs/11` — reconciled 2026-09-09

| | Days |
|---|---|
| `docs/11` §1, Phase 1 estimate, **current** | **22.75–32** |
| Task sum here | **22.75** |
| Divergence against the bottom of the band | **0 %** |
| (`docs/11`'s *previous* figure, for the record) | 9–12 |

There is no gap left to argue about: `docs/11` §1 was re-estimated **from this
table** on 2026-09-09 and now reads "18.75–26 developer-days — *measured*: the 23
task cards in `plan/02-phase-1-pubmed.md` sum to 18.75 d; the upper bound is that
× 1.4. (Was 9–12 d.)" `README.md` §7's rule — a divergence above ~30 % "is a
signal to re-estimate the phase in `docs/11`, not to quietly adjust the tasks" —
was applied in that direction. **No estimate in this file was adjusted to close
the gap**, then or since.

**Re-derived 2026-09-30: 24 cards, 19.00 d.** `P1-T24` was created after `P1-T12` measured that
`create src/zotero/itemMapper.ts` cannot literally replace the `P0-T10` spike — three files import
the spike exports and none is in `P1-T12`'s `Files`, so deleting the surface there would have broken
code that card does not own. That is `plan/README.md` §5 rule 2 operating as designed for the third
time in this project: **eight of the plan's 108 cards now exist because running the code found work
no reading of the corpus had.** `docs/11` §1's Phase 1 row, the Phases 0–3 subtotal, the whole-plan
total and §2's critical path were all re-derived from this table on the same day.

**`P1-T02`'s estimate was NOT raised** when `test/unit/core/result.test.ts` and
`test/unit/core/concurrency.test.ts` were added to its `Files` on 2026-09-30. `plan/README.md` §6
already requires tests to ship with the task, so those two files were always inside the 1.00 d —
their absence from `Files` was the defect, not their cost. Recorded so the omission is not later
read as an unpriced addition.

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

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
| **State** | `DONE` — approved 2026-10-07; the port is declared in `src/core/secretStore.ts` and the Phase 0 spike's 286-line keychain was **extended, not replaced**. The real gap was the key-presence flag, which **nothing in the product wrote** while the limiter registry read it. The write is proved load-bearing rather than decorative: the spec asserts that `refresh()` names the host after a `set`, nothing on an immediate second call, and the host again after a `clear` — so deleting either write makes it read empty. The flag is **derived, never asserted** (read back out of the login manager), because a key wrongly believed present would pace NCBI at 8 requests per second against a published ceiling of 3. **Verified by the coordinator and recorded honestly: nothing calls the store at startup, so the bundler removes the module entirely** — the shipped script holds the flag's reader and not its writer. The human gate sits on a card that cannot discharge it, which is recorded rather than worked around. |
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
stop and re-plan rather than inventing a fallback.

> **The gate this card names does not exist under that name — corrected 2026-10-07, reported by the
> executing agent.** This `Notes` read "Human gate details go in `06-human-gates.md`", and **that
> file has no `P1-T06` entry and no Phase 1 gate for the NCBI key**. The nearest is **`G-04`**, filed
> under **Phase 0** gates, whose subject is registering the `tool`/`email` pair as a release task
> with the optional key as a secondary clause — and whose "agent behaviour on reaching it" is
> written about the release checklist rather than about this card. **A second half of the same
> mismatch is worse:** the gate sits on a card that **cannot discharge it**. The missing assertion is
> that a real key is accepted by E-utilities as `api_key=` and raises the observed ceiling from 3 to
> 10 requests per second, and **nothing in this card's scope issues an HTTP request**. The card that
> does is `P1-T09`, whose own `Human gate` cell reads `none`. All five of this card's criteria were
> satisfied with a dummy value, so the gate blocked nothing here.

**Findings, 2026-10-07 — all five criteria pass, and the flag nobody wrote now has a writer that is
proven to move the rate limiter.** Verified independently: **67 integration tests** (up from 63),
**916 unit tests in 23 files, unchanged**, typecheck 0, `lint:check` 0, `grep -rn MUTANT src test`
clean, and the test profile's `prefs.js` free of the deliberate violation written during mutation.

**The work was far smaller than the card, because the spike had already built most of it.**
`src/zotero/keychain.ts` existed at 286 lines with the whole tier-1 implementation; the card says
`create`. It was **extended to 529 lines, with nothing removed and nothing changed in behaviour** apart
from the two flag calls. The genuinely new work was the port — `src/core/secretStore.ts`, 106 lines,
declaring §1.7's seven members and naming no `Zotero` global — and the flag.

**The key-presence flag was the real gap, and the test that proves the write is not vacuous is the
best thing in this card.** The obvious version — assert that the function just written sets the
preference just chosen — proves nothing. Instead the spec asserts that
`createHostLimiterRegistry(...).refresh()` returns `["eutils.ncbi.nlm.nih.gov"]` after a `set`, `[]` on
an immediate second call, and the host again after a `clear`. `refresh()` names a host only when a
*different* frozen configuration object is selected, which happens only when the flag actually reads
true. Live: `after set(): ncbi.keyPresent=true; registry.refresh() reconfigured
[eutils.ncbi.nlm.nih.gov]; withoutKey 2.5/s -> withKey 8/s`. **Deleting either flag write makes those
assertions read `[]`** — mutations A1 and B, with the failure text recorded.

**The flag is derived, never asserted, and the error direction is why.** `refreshKeyPresence` reads
the answer back out of the login manager rather than inferring it from what the caller asked for, so a
`set` whose login the platform refused cannot leave the flag claiming a key is present. **A key wrongly
believed present paces NCBI at 8 requests per second against a published 3-per-second ceiling** — the
expensive direction — so the cheap direction was chosen deliberately.

**The one thing this card does not achieve is a scope boundary, and the coordinator verified it rather
than taking the report's word.** `src/bootstrap/container.ts` is outside `Files`, so nothing calls
`createKeychainSecretStore()` or `probeAndRecordBackend()` at startup — and the consequence is sharper
than "not wired": the bundler **removes the whole module as unused**. Measured on the built script:
`grep -c 'research_helper API Keys'` returns **0** while `grep -c 'ncbi.keyPresent'` returns **2**, and
the installer stayed **byte-identical at 76,388 bytes**. So the shipped plugin contains the flag's
*reader* and not its *writer*, `secretBackend` still reads `""` in a running plugin, and **a real key
could not be stored today even if the owner had one.** The writer exists and is proven; wiring it needs
a card.

**The human gate is attached to the card that cannot discharge it, which is a defect worth fixing
rather than working around.** No key was obtained, embedded or simulated, and the gate blocks **no
listed criterion** — all five were satisfied with a dummy value. The missing assertion is precisely
that a real key stored through `set("source.ncbi", …)` is accepted by E-utilities as the `api_key=`
parameter and raises the observed ceiling, i.e. a live response carrying `X-Ratelimit-Limit: 10`
instead of `3`. **That assertion cannot be written on this card even with a key in hand, because
nothing in this card's scope issues an HTTP request.** The card that does is `P1-T09`, whose step 2
sends `api_key` "when `P1-T06` returns one" — and whose `Human gate` cell reads `none`. Reported under
rule 6 rather than adjusted.

**The duplicate-spec question was settled by evidence from another phase, which is the right kind of
answer.** `Files` names a new `keychain.spec.ts` while `secrets.spec.ts` already existed; the deciding
fact is that **`plan/04`'s `P3-T02` lists `modify test/integration/zotero/keychain.spec.ts` in its own
`Files`**, so extending the other file would leave a later card with a `modify` of a file that does not
exist. The two specs do not overlap: `secrets.spec.ts` measures the **platform** — which login-manager
methods Zotero 10 exposes, that the keystore round-trips, and that no preference, no `prefs.js`, no
`logins.json`, no Debug Output and neither console channel ever holds a stored value — borrowing a
different secret id entirely. The new file measures **this card's product surface**. The deep leak
sweep was not repeated; only the branch enumeration criterion 2 names, against `source.ncbi`.
**And both specs refuse to run if a login already exists for the id they use**, so a real key stored
later will not be overwritten, read or even measured for length.

**A measured preference-branch enumeration, which is what criterion 2 actually asks for.** Twelve
preferences under the plugin branch, named in the log, and **zero holding the dummy value, its
`oskv1:` ciphertext, or that ciphertext without its prefix** — three separate needles. The flag is
asserted both through the typed reader and through `Zotero.Prefs` raw, so a coercion cannot manufacture
the pass.

**The spelling conflict between two authority documents bit one phase earlier than both predicted, and
the schema caught it.** `docs/07` §8.5 ships `secretBackend` as one of `"oskeystore" | "session" |
"passphrase" | ""` while `docs/09` §1.7's `SecretBackend` spells the first `"os-keychain"`; both
documents say the mismatch bites at `P3-T02`'s startup probe, and `Do` step 3 ships that probe **here**.
Mutation A3 made the mapping return §1.7's spelling and the typed write was **rejected** —
`a string is not a usable string (one of "oskeystore", "session", "passphrase", "")` — rather than a
status badge silently reading empty. That is the argument for routing the write through the typed
accessor instead of the raw preference store, and `docs/07` §8.5's standing instruction that one of the
two documents must be corrected is still outstanding.

**A later card repeats a claim this project has already retracted, and following it literally would
reproduce a known crash.** `plan/04`'s `P3-T02` tells its implementer that "`findLogins()` is a
throwing stub and the sync `addLogin`/`removeLogin`/`searchLogins` were removed on the esr153 base, so
every call here is `await`ed and uses the `Async` name", and that `clear()` goes via
`removeLoginAsync`. **Both are false on Zotero 10.0.3, re-measured in this run**: `removeLoginAsync`
and `modifyLoginAsync` are `undefined`, and the synchronous forms all exist. `docs/09` §1.2 already
carries the dated correction. `P3-T02` also contradicts this card about where the port is declared.
**Needs a card or a correction before `P3-T02` runs.**

**`docs/09` §1.7 itself is clean, checked line by line.** The only remaining `esr153` text is in §1.2
and already carries its 2026-09-15 correction immediately after it; §1.7's removal call is
feature-detected with the correct comment, and its measured platform block cites the right Gecko
branch. Two §1.7 divergences are not branch errors and are recorded in the code: the section places the
three type declarations in the platform module where the card puts them in the port — resolved for the
card and `docs/07` §2.3, with re-exports so §1.7's reading still holds — and §1.7's reference
implementation has no guard on the encrypt result, where the shipped code refuses to store an
unprefixed value, which is the spike's strictly safer addition.

**A deliberate violation was written into the test profile and cleaned up, disclosed unprompted.**
Mutation C made `setSecret` write the key value to a preference, to prove criterion 2's branch
enumeration catches a D5 breach; it did, naming the offending preference and taking the branch count
from 12 to 13. The `user_pref` line was then removed from the test profile with Zotero confirmed
stopped, and the next clean run printed 12 again. **Writing a real violation to prove a real guard is
the right experiment, and saying so afterwards is what makes it safe.**

**Two notes on the hand-out, in the agent's favour.** It checked all six facts the coordinator supplied
and found one imprecise: of the three files named as referencing the keychain module, **only
`secrets.spec.ts` imports from it** — the other two mention the path in a message string and in
comments. The coordinator's wording said "reference", which is accurate, but "importer" would not have
been, and the distinction is what the §4 grep exists to make. It also found the spec imports **ten**
symbols rather than the nine implied. Separately, `P1-T06`'s `Notes` says "human gate details go in
`06-human-gates.md`" and **that file has no `P1-T06` entry**; the nearest is `G-04`, filed under Phase 0,
whose subject is registering the `tool`/`email` pair as a release task with the key as a secondary
clause. The card should name `G-04` by identifier.

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
| **State** | `DONE` — approved 2026-10-07; `esearch` then `efetch`, parameters **passed into** `P1-T08`'s builder rather than appended, the body-level error checked before the identifier list, batches of 200 with POST past 2,000 characters, and the identity pair unoverridable so neither builder can forget it. 53 tests, **zero live network requests**, 19 mutations — one of which broke nothing and was reported as a **redundant guard rather than missing coverage**. **A test found a real defect before review did:** the identifier list was not truncated to the `retmax` asked for, so a server returning more identifiers than requested would walk past the 9,998 ceiling by the back door. Criterion 4 **cannot pass as written** — it says "every issued URL" while `docs/02` §3.4 mandates a POST, which has no URL parameters — reported under rule 6 and reworded. Left the most useful thing possible for whoever gets a key: the corpus has **never observed** the rate-limit header reading 10, and one `healthCheck()` with a real key settles it. |
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
- [ ] Every issued **request** carries `tool=research_helper` and the maintainer
      > **Reworded 2026-10-07 after the executing agent reported it under rule 6.** This read "Every
      > issued **URL**", which **cannot hold alongside `docs/02` §3.4**: that section requires a POST
      > once the URL would pass about 2,000 characters, a full 200-identifier `efetch` batch of
      > eight-digit identifiers passes it, and **a POST carries no parameters in its URL at all**. So
      > the criterion forbade what the same document mandates. Decision D10 and `docs/02` §3.1
      > oblige the pair on every *request*, which is what is asserted — in the URL for each GET and
      > in the form body for the POST, across all three requests of a 250-identifier search.
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

**Findings, 2026-10-07 — six of seven criteria pass, the seventh cannot pass as written, and the
adapter is correct but unreachable until something constructs it.** Verified independently: an
864-line adapter and a 1,176-line spec with **53 tests**, the suite at **974 in 24 files**, typecheck 0,
`lint:check` 0, build 0 — and **zero live network requests**, every response served by a stub.

**Criterion 4 is unsatisfiable as written, and the reason is a conflict inside the corpus rather than a
shortfall in the work.** It says "**Every issued URL** carries `tool=research_helper` and the maintainer
`email=`". But `docs/02` §3.4 requires a **POST** once the URL would pass about 2,000 characters, and a
full 200-identifier batch of eight-digit identifiers passes it — **and a POST carries no parameters in
its URL at all.** So the criterion forbids what the same document mandates. What decision D10 and
`docs/02` §3.1 actually oblige is "on **every request**", and that is what is asserted: across all three
requests of a 250-identifier search the pair is present — in the URL for each GET and **in the form body
for the POST**. Reported under rule 6 rather than adjusted; the card text now carries the repair.

**One real defect was found by a test rather than by review, which is the best thing in this report.**
The identifier list returned by `esearch` was not truncated to the `retmax` that was asked for — so a
server returning more identifiers than requested would walk the adapter **past the 9,998 ceiling by the
back door**. The ceiling assertion caught it on its first run. The fix is cited to the card's own
`Do NOT` in a comment, and mutation 14 now pins it.

**Nineteen mutations, and the one that failed to break anything was reported as such rather than
quietly dropped.** Removing `searchAll`'s own cancellation check broke **nothing**, because a second
guard at the top of `esearch()` still stops the request before it is issued — so the stated behaviour
remained true. The agent recorded it as a **redundant guard rather than as missing coverage** and re-ran
with both guards removed, which then failed two tests. **That distinction is the difference between an
honest mutation table and a padded one.**

**The capability flags were kept honest in the direction that costs something.** `relatedByWork`,
`citationGraph` and `lookupById` are all off and the corresponding methods are **absent entirely**,
because the card's `Do NOT` keeps the related-articles, summary and identifier-converter endpoints out
of this card — and §4.2's requirement to advertise capabilities "honestly" rules out a flag promising an
unimplemented method. Easy to get wrong in the flattering direction.

**Provenance was added without widening a shared type.** `docs/07` §4.2's `SourcePage` has exactly four
members and `src/sources/types.ts` is outside this card's `Files`, so a local `PubmedSearchPage` extends
it with one member whose three keys are **NCBI's own spellings** — `count`, `querytranslation`,
`translationset` — because `docs/07` §5.3 types that field as extras "keyed by the source's own field
names" and names those three, and a test pins the key
> **Corrected 2026-10-07: this said `P1-T17` "can assign the object straight across". It cannot.**
> `PubmedSourceExtras` is an `interface`, and TypeScript synthesises an implicit index signature only
> for *type aliases* of object types, so assigning it to §5.3's `Readonly<Record<string, unknown>>`
> fails. Measured by the coordinator with a throwaway probe under this repository's own
> configuration: `error TS2322 … Index signature for type 'string' is missing in type
> 'PubmedSourceExtras'`. **The repair was measured too, so the eventual caller does not have to:
> `{ ...extras }` typechecks**, because an anonymous object type does get the implicit signature. The
> three keys themselves are correct and go straight into `sourceExtras` as §5.3 intends; only the
> assignment needs a spread. The fix belongs to whichever card wires the adapter into the pipeline.
> **This is a claim the coordinator wrote into a `Findings` block without compiling it** — a later
> agent would have inherited it as a premise, which is what `plan/README.md` §5 rule 8 exists to
> stop.
set to exactly those three.

**The access-key route is settled and verified step by step rather than asserted.** The adapter takes an
optional `SecretStore` — the port in `src/core/secretStore.ts`, a `core/` module — reads `source.ncbi`
before each request, and goes out unkeyed when no store is given. A store that throws is treated as "no
key" and logs a line naming **neither the value nor the error**. What a later card must supply is a
**constructor dependency, not a new per-call context member**, because a per-call credential channel
would put the key at every call site instead of in one wiring point. The route: `P1-T16` step 7 extends
`installServices()`, that path is already in `P1-T16`'s `Files`, and `P1-T16` already depends on this
card — so no plan change is needed, only a note that the key store is one of the dependencies step 7
must wire, since that step does not mention credentials at all.

**The rate-limit half needs no new code, and that was checked rather than hoped.** `keychain.ts` maps
`source.ncbi` to the key-presence preference and writes it inside `set()`, and the limiter registry
observes that flag and raises the bucket. **Storing a real key therefore raises the budget with no
further wiring** — which is `P1-T06`'s work paying off one card later.

**The adapter is correct and unreachable, measured the same way `P1-T06`'s store was.** `npm run build`
exits 0 and the bundled script contains `efetch.fcgi` **zero** times: nothing constructs the adapter, so
the bundler removes it. Confirmed by the coordinator. **Two cards in a row have now shipped working code
that the installer does not contain**, and both point at the same missing construction site.

**The exact assertion a real key would unlock, which is the most useful thing left for whoever gets
one.** `docs/09` records that the corpus has **never observed** the rate-limit header reading `10` on a
keyed request — only `3` unkeyed — while §2.3's healthy row for NCBI *assumes* the header tracks the
documented rate. `healthCheck()` already reads both headers into a quota hint, and it is the cheapest
request in the codebase. So: **one health check carrying a real key returning HTTP 200 with a quota hint
of `<remaining>/10`.** That single observation discharges §2.3's assumption and settles an open item, and
it is what the human gate recorded against `P1-T06` actually exists to buy — on the card that can issue
a request, which `P1-T06` cannot.

**One claim in the hand-out was false, and it was load-bearing in the argument I built on it.** I wrote
that `src/sources/**` may not import `src/zotero/**` and called it ESLint-enforced. **It is not.**
Verified: `eslint.config.js`'s adapter-tier override groups `src/sources/**` and `src/zotero/**`
**together in the same tier** and forbids both only from `pipeline/` and `ui/`; `P1-T07`'s own findings
record that a `sources → zotero` import probe exits 0 with no error at all, and `docs/07` §2.3 explains
why the arm cannot simply be added to that group. The rule is documented and was obeyed here anyway —
the adapter imports only `core/`, `model/` and its own directory — so the conclusion survives for a
better reason than the one I gave. **`eslint.config.js` is already in `P1-T07`'s `Files`, so this is an
open item on that card rather than a new one.**

**Two further corpus problems, both genuine and neither absorbed.** `docs/07` §4.2 says `search`
"throws `SourceError` subclasses", which cannot hold alongside this card's `Do NOT`: the client
classifies every status into §10.1 classes — rate limit, upstream server, timeout, offline — none of
which is a `SourceError` subclass, and wrapping them would discard the `retryable` flag and the
classification two earlier cards own. Transport classes therefore propagate **unwrapped** and only
PubMed-specific failures become a source or parse error, with a test pinning it; §4.2 needs either a
qualification or an explicit statement that adapters re-throw §10.1 classes untouched. And
**`SourceHealth.messageKey` has no vocabulary at all** — sixteen error identifiers exist and nothing
resembling a health status — so a healthy probe currently returns the source-name identifier, which
renders as "PubMed". Both are single named constants, so the substitution is one line once the
vocabulary exists.

**A real gap in credential redaction, found because this card ships the first request body that can
carry a key.** The URL redactor removes the key **by name** and is sound. The free-text redactor has no
pattern for this credential and its only applicable rule matches runs of **40 or more** characters — so
**any shorter key is untouched** in a log line or a form body, and the corpus records no length for an
NCBI key, so it cannot even say whether this one is safe. The adapter sidesteps it: the POST body is
never logged and never placed in an error, and the redacted form offered to callers is **re-rendered
from the same values without the key** rather than pattern-matched. That is the right local answer and
the general one needs a card — it is an NFR-16 gap, not a style point.

**Cross-card attribution was handled correctly in both directions.** This card named a transient
typecheck failure in `backoff.test.ts` as the other agent's, noted that `hostLimiter.ts` and `docs/07`
changed under it mid-run while every exported name it imports stayed intact, and attributed the
installer's 31-byte growth to the other card by observing that its own module contributes **zero** bytes
to the bundle. The other card reported the mirror image. **With two cards in flight that arithmetic is
what keeps a report from becoming a muddle.**

**The integration suite was deliberately skipped with a reason, not an omission.** Nothing here touches
the Zotero global, a preference or a file, so no integration assertion can reach it — and starting a
second Zotero profile to exercise unreachable code, while another agent might be running suites, was the
worse trade. No process was inspected and none was killed.

---

### P1-T10 — PubMed XML → `SourceRecord` mapper

| Field | Value |
|---|---|
| **ID** | `P1-T10` |
| **State** | `DONE` — approved 2026-10-07; PubMed responses map to canonical records, with the parse behind an injected port because the sandbox has a document parser and Node does not, and an element port narrow enough that **every path is an exact parent-to-child walk** — no query selector, no tag search, so a stray nested element can never be picked up. Raw payloads are omitted by default on NFR-7's wording and shared **by reference** when the preference turns them on. **The suite caught a defect in the shipped code on its first run rather than in a mutation:** a whitespace collapse was rewriting the thin space in `docs/02` §3.4's own captured sample into an ordinary space — reproduced by the coordinator, and `trim()` has the same reach. **Built the absent-versus-not-understood distinction no criterion asked for**, and named the fields where it cannot exist. Two mutations broke nothing and were diagnosed as a message-quality guard and a fixture gap rather than dismissed as dead code. |
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
- `docs/13-testing-build-and-release.md` §2.1, **"Mappers (`src/sources/*/mapper.ts`)"** row
  (line 395) — the required
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

**Findings, 2026-10-07 — all seven criteria pass, and the suite caught a real defect in the shipped
code on its first run rather than in a mutation.** Verified independently: a mapper and a 90-test spec,
the suite at **1,115 in 26 files**, typecheck 0, `lint:check` 0, build 0 with the installer
**byte-identical at 76,419** — so this module contributes zero bytes, the third card in a row.
**Zero live network requests.**

**The defect worth reading about: `\s` reaches the thin space, and the shipped whitespace collapse was
rewriting the corpus's own sample.** `docs/02` §3.4's real captured response contains `30` **U+2009**
`million`, and a `/\s+/gu` collapse turned U+2009 into an ordinary U+0020 — **three tests failed on the
first run, including the card's third criterion.** Reproduced by the coordinator: `/\s+/gu` yields
`U+0020`, `/[\t\n\f\r ]+/gu` preserves `U+2009`, and `String.prototype.trim()` has the same reach, so
the trim had to be spelled out too. **This is exactly the silent-success direction a parsing card fails
in** — it would have read as correct whitespace handling forever, and only a fixture holding a real
non-ASCII space could see it.

**The distinction between "absent in the source" and "not understood by the mapper" was built even
though no criterion asks for it, and the agent said so plainly.** Two channels: absent means the field
is gone, named in `missingFields`, and **nothing logged**; not-understood means the same plus a warning
naming the field, the path, the reason and a truncated value. A caller tells them apart by whether a
warning accompanied the gap, and tests assert both directions for the abstract, the date, the
identifier, the authors and the subjects — including `expect(warnings).toEqual([])` on the absent side.
The agent also **named the fields where the distinction does not exist** and why: plain text with no
shape to misunderstand cannot be misparsed, and a present-but-empty title is weak because §5.1 types the
field as a plain string. **Offering to strip the channel if it counted as scope creep, while saying what
would be lost, is the right way to raise it.**

**`missingFields` is drawn from one list of sixteen names, and the reason is a downstream number.** A
field PubMed never supplies — citation count, open access, publisher, a link — is **never** reported as
missing, because a false gap would corrupt the coverage figure a later card computes. Both halves are
asserted.

**`raw` is omitted by default, on NFR-7's own words.** The requirement says raw payloads "must not be
retained after normalization", §5.1 names the single exception, and `sources/` may not read a
preference — so it arrives as an injected flag for the composition root to wire. When on, **every record
of a batch shares the one response string by reference** rather than 200 re-serializations, which also
avoids depending on a serializer the sandbox's measured global list does not promise. Asserted by
identity, not equality.

**The parser is an injected port for a measured reason.** `docs/01` §2.3's sandbox global list — probed
two independent ways in Phase 0 — has `DOMParser` present, so that is the real production path; but Node
has none and this repository declares no XML implementation, so the parse is a port with a real-DOM
default. The element port is deliberately the smallest slice that works — local name, text, attribute,
direct children — with **no query selector and no tag search**, so every path is an exact parent-to-child
walk and a stray nested element can never be picked up. **No regex parses XML.**

**Two mutations broke nothing, and neither was reported as dead code — both were diagnosed and then
closed.** Removing the malformed-body branch still threw, just with a message that lost the parser's own
diagnostic, so it is a **message-quality guard** and the agent added the distinguishing assertion rather
than calling it redundant. Removing a trim broke nothing because **no fixture was indented**, which is a
fixture gap and not a redundant guard — real NLM responses pretty-print some records — so the missing
case was added. **Both now fail.**

**A methodology note that is worth more than any single assertion.** The first two mutation runs reported
every mutant caught with no per-test detail, and that was a **harness bug**: the reporter name does not
exist in this version, so every run died at startup having executed nothing, and the non-zero exit looked
like a caught mutation. The agent's own conclusion is the thing to keep: **treat an all-mutants-caught
result with no per-test detail as a harness failure, not a win.**

**The one real fixture is re-read from the document at test time.** The §3.4 sample is transcribed
character for character, and a test **re-reads the fenced block out of `docs/02` and asserts byte
equality** — so a transcription drift or a document reorganisation fails loudly instead of quietly
asserting against a stale copy. Everything else is synthesised from that skeleton with one thing changed
and labelled with the document row it is built from. The agent then **said plainly which fields are
verified against real captured text and which are inferred from prose**, and that the preprint case is
legitimately absent because PubMed returns none — which the card asked to have recorded.

**Two errors in this card's text, both the coordinator's.** The `Read first` cites `docs/13` §2.1's
"Normalizers" row; **`Normalizers` appears zero times in that document** and the row is "Mappers
(`src/sources/*/mapper.ts`)" at line 395. Verified. No work changed, because the row's content is what
the card listed — but it is rule 8's shape again. And §11.1 step 6 names the spec
`test/unit/sources/<source>.test.ts` while the card's `Files` says `pubmed-mapper.test.ts`; the card
wins, and the two should be reconciled before Phase 2 copies the pattern six times.

**Three corpus defects, one of which makes a mapping table unfollowable.** `docs/02` note 2 says "the
example above contains `<sup>1,2</sup>`" — **the sample contains no `<sup>` at all**, verified at zero
matches, though the trap it describes is real and implemented. §10.2's PubMed `type` cell promises a
mapping from the publication-type list, but **its own trigger table names no PubMed condition** beyond
the journal-article default, so review, conference paper, book chapter and preprint are unreachable and
that element is read by nothing. And two §10.2 PubMed rows have **no destination in §5.1** at all. The
agent implemented only what the trigger table licenses, which is the right call.

**Needs a card.** (a) A documented publication-type mapping — real records carry review, editorial,
comment, preprint and clinical trial, and today **every PubMed record is one of two types**; fixing it
means editing `docs/02` §10.2's trigger table first. (b) **Nothing in continuous integration exercises
the production parser**, so the entity decoding and text flattening that §3.4's notes are about are
asserted only against a Node stand-in; the agent checked that an XML implementation is reachable on this
network and **did not install it**, which is the correct restraint. (c) A third unwired dependency — the
raw-retention flag — joins the two the previous card reported, and all three land on the same bootstrap
card.

---

### P1-T11 — Contract-test harness and PubMed fixtures

| Field | Value |
|---|---|
| **ID** | `P1-T11` |
| **State** | `DONE` — approved 2026-10-07; **17 fixtures over 30 live requests, all 200**, paced under 1.5 per second against a documented ceiling of 3, unkeyed — the recordings themselves carry `x-ratelimit-limit: 3` as direct evidence. **Recording found that a fact the corpus calls "verified live" is stale:** `retstart=9999` no longer returns an error inside a 200; today the service returns an empty list and a *warning*, so **it now fails silently where it used to fail loudly** — precisely the failure mode §3.3 warns the adapter about. Both behaviours are recorded, the historical one re-read from the document at run time. **Twelve of the thirty requests were wasted and said so**, one because the recorder's own redaction guard refused a sidecar — the first time a safety check in this project fired on real data. Two criteria reported under rule 6. **Also found that the contract suite does not run in continuous integration at all**, and that 13 third-party author addresses and 9 publisher copyright notices are now committed, which is an owner's decision rather than a defect. |
| **Depends on** | `P1-T05`, `P1-T09`, `P1-T10` |
| **Blocks** | `P1-T23`, `P2-T25` |
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
- [ ] Deleting one fixture file makes the scenario's own test fail with a message naming the record
      command, and the corpus-integrity test notice the orphaned sidecar — **two** failures, and the
      failure
      > **Reworded 2026-10-07 after the executing agent reported it under rule 6.** This read
      > "**exactly one** test fail". Measured by deleting a fixture: **two** tests fail — the
      > scenario's own, whose message is exactly what this criterion asks for, and the
      > corpus-integrity test, which notices the now-orphaned sidecar. **"Exactly one" is reachable
      > only by dropping the integrity test, and that test is what catches a half-written
      > recording.** The agent reported the criterion rather than weakening the suite to match its
      > wording, which is the right order. Both messages are actionable and the record command
      > appears twice in the output.
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

**Findings, 2026-10-07 — the fixture corpus is real, and recording it found that a fact the corpus
calls "verified live" is no longer true.** Verified independently: **17 fixtures, 369,368 bytes**, of
which **13 carry a genuine National Center for Biotechnology Information header set** (`server:
Finatra`, the rate-limit pair) and four are marked synthetic; **28 contract tests pass, exit 0**; and
`grep -ri "suppakoko@gmail.com\|api_key=" test/fixtures/` returns **nothing**.

**The finding that outlives this card: the service changed behaviour and now fails silently where it
used to fail loudly.** `docs/02` §3.3 says "**Verified live** — `retstart=9999` returns an error inside
an HTTP 200". Read out of the recorded fixture: today it returns `count: "840"`, `retmax: "0"`, an
**empty identifier list**, **no `ERROR` member at all**, and a *warning* — "Restrictions achieved. start
and count adjusted to 9999, 0". **So the adapter's guard against an error inside a 200 is correct and
simply unreachable from a `retstart` overflow, and the service now returns zero results where it once
objected** — which is precisely the failure mode §3.3 warns the adapter about. **Both behaviours are
kept**: the present-day response as a recorded fixture with a service-tagged test, and the body §3.3
quotes as a second fixture whose test **re-reads the fenced block out of the document at run time and
asserts byte equality**, so a drift in either artefact fails loudly. That is `P1-T10`'s pattern, reused.

**Thirty live requests, all successful, and the two wasted runs disclosed rather than buried.** Every
request went to the two documented endpoints inside a ten-minute window; all 30 returned HTTP 200, with
**zero failures, zero rate-limit refusals and zero certificate failures** under the system-certificate
flag. Observed latencies of 272–1,272 ms against a 400 ms floor kept the effective rate **under 1.5 per
second against a documented ceiling of 3** — and the recordings themselves carry
`x-ratelimit-limit: 3` with `x-ratelimit-remaining: 2`, which is direct evidence both that the ceiling
was never approached **and** that the requests went out unkeyed. Pacing lives **inside** the transport,
so no code path can issue a request without waiting, and the gap is read from the policy table rather
than written down.

**Twelve of the thirty were wasted, and the reason is worth keeping.** The "about twenty results"
scenario was written as one multi-word term, and the query renderer **quotes any value that is not a
single bare word** — so it went out as an exact phrase that matches essentially nothing, and the
scenario came back empty. Fixed by splitting it into two bare terms, **confirmed with a single probe
request rather than another full run**. The same run then aborted before writing anything, because the
recorder's own redaction guard refused a sidecar whose explanatory note contained the literal text
`api_key=`. **The guard was right and the prose was wrong** — and that is the only time in this project
a safety check has fired on real data rather than on a mutation.

**The service-versus-code distinction was built into the test names, so the suite's own output is the
evidence.** Verified in the file: **3 tests fail only if the service changes**, 12 if either side moves,
13 only if this project's code changes. The three service-tagged ones pin the response envelope's six
members, seventeen exact element and attribute spellings the mapper depends on, and the new
`retstart` behaviour. **And one structural point is stronger than any assertion**: the fixture filename
is a hash of the method, the credential-redacted address and the body, so **a resolved fixture proves
the transmitted request is byte-identical to the recorded one** — swapping two parameters in the
ordering list made 12 of 28 tests fail with "Missing fixture".

**What a reader should do when a fixture goes stale is written where they will hit it, not only in a
header.** Five numbered steps sit in the module header, and the same guidance is reachable without
opening a file: the missing-fixture message names the record command verbatim, and the staleness failure
names the command **and repeats the rule** — never hand-edit a fixture to make a test pass; re-record,
read the difference, and if the service changed shape fix the parser in the same commit. **A contract
test that fails with "the service changed" and no guidance is a test people delete.**

**A deliberate deviation from the testing document, and it is the right one.** That document puts the
replay seam at the HTTP facade; doing so would skip the client's status classification, and then its own
assertion category "error responses produce the expected typed errors" **would assert nothing** — a
rate-limit fixture would arrive as an ordinary response object and no error would ever be constructed.
The seam was put one layer lower, at the platform port, **so the typed errors are produced by production
code**. The document's own helper is still exported unchanged.

**Criterion 2 fails as written and the deviation is an improvement.** Deleting one fixture makes **two**
tests fail, not one: the scenario's own test, whose message is exactly what the criterion asks for, and
the corpus-integrity test that notices the **orphaned sidecar**. "Exactly one" is reachable only by
dropping the integrity test, which is what catches a half-written recording. Reported under rule 6
rather than weakening the test to match the wording.

**Two mutations broke nothing and both were diagnosed rather than dismissed.** Disabling the recorder's
redaction abort changed no result, because that guard runs only on the write path, which **no test
invokes** — the suite checks the outcome (the committed fixtures hold no credential) and never the
guard. The guard demonstrably works, having fired for real during recording. That is a **genuine
coverage gap** and needs a test path no card's `Files` names. And removing the identifier-list slice
broke nothing because **the real service honours the requested count on all six recorded responses**, so
no recording can exercise it; the correct layer is a stub and `P1-T09`'s suite already has one, read
rather than assumed. **A fixture gap no recording can close is a different thing from dead code.**

**A cross-agent hazard that is worth recording as an operational fact.** Another agent, working in
parallel, **overwrote a shared scratchpad script mid-run**, which silently turned two of this card's
mutation reverts into no-ops and left a source file mutated — invalidating one result. It was caught by
`grep -rn MUTANT`, repaired from a backup verified by diff, and the mutation re-run; later mutations ran
from a single long-lived process with the revert in-process and a byte comparison afterwards. Separately,
a leftover mutation marker was live in that other card's own source for a period, so **a suite run
during that window may have given that card a misleading result.** The shared scratchpad and `/tmp` are
not safe between concurrent agents, and that is now known the hard way.

**The contract suite does not run in continuous integration, measured rather than assumed.** Verified:
the only reference to the contract directory in the workflow is **inside a comment block**, and the
stated blocker — "`test/contract/` is empty until Phase 1" — **is now gone**. So these 28 tests would
silently protect nothing on a pull request. The workflow is in no card's `Files`.

> **Done 2026-10-07 by the coordinator, and recorded here rather than carded, because the placeholder
> named its own condition.** The step sat commented out with the instruction "Restore when the first
> contract spec lands" and the reason "`test/contract/` is empty". This card landed the spec, so the
> condition was met and **restoring a left instruction is not new scope**. Verified: the step now sits
> in the `unit` job between the unit tests and the coverage upload, the file has no tab characters and
> no misindented `run:`, and **the exact command the workflow will run passes today with 28 tests**.
>
> **The placeholder's own `env: FIXTURE_MODE: replay` was deliberately not restored**, which is the one
> judgement in the edit. Measured: `replay` is a mode **nothing recognises** — the recorder reads
> `record` and `synthetic` and treats anything else as a dry run, and all three `FIXTURE_MODE` mentions
> under `test/contract/` sit inside **message text** telling a reader how to re-record. Nothing reads
> the variable to change behaviour, so setting it would only invite a future reader to believe a replay
> mode exists. **`--passWithNoTests` is also omitted**, so a deleted or renamed spec fails the build
> instead of passing silently — which is the failure this whole item was about.

**A defect in the shared harness that will bite Phase 2 six times over.** The fixture key redacts a
credential **by value**, so a keyed recording hashes differently from a keyless replay and the fixture is
reported missing. The intent was clearly that the two should match. It works for sources that carry a
key in a header and **fails for every source that carries one in the query string** — which is why
recording unkeyed here is not merely convenient but the only way the fixtures are reachable from a
keyless automated run.

**Personal data and copyrighted text are now committed, and this needs an owner's decision rather than
a fix.** Counted by the coordinator: **13 distinct third-party e-mail addresses** inside affiliation
elements — corresponding-author addresses the National Library of Medicine publishes as part of the
bibliographic record — and **9 publisher copyright notices**, meaning nine abstracts under publisher
copyright. The agent reported 7; the difference is in the counting and the direction is upward, so take
9. The tension is between two instructions the project already holds: the testing document says fixtures
are committed to the repository, while `docs/02` §3.8 says abstracts are **not** public domain, are
typically under publisher copyright, and that bulk redistribution may require permission. **Both
instructions were followed.** Whether nine abstracts and thirteen addresses in a repository is
acceptable is above this card.

**One fidelity loss, found and reported rather than left to be discovered.** The project's free-text
redactor replaced **five legitimate address slugs** inside reference lists — 241 bytes across two
fixtures — because its last-resort pattern matches any long opaque run. The security document
explicitly accepts that trade **for logs**, where a false positive costs a debugging inconvenience;
applied to a recorded body it costs fidelity instead. **No mapped field is affected** and every instance
is greppable. The pass was left at full strength rather than narrowed, because narrowing it is a
decision.

**Four more corpus problems.** The testing document instructs reading real keys from a plaintext file,
which binding decision D5 and `.env.example` both forbid — D5 was followed and no key was read from
anywhere. `docs/02` note 1 says structured abstracts carry a category attribute; the recorded record
carries **five labels and no category at all**, so the mapper keying on the label alone is right, and
both directions are now asserted. And the two inventory rows this card did not record are Phase 2's by
the card's own reading.

**`package.json` needed no edit at all**, which is the conservative reading of the extend-rather-than-
replace rule: the script entry already existed and pointed at a file that did not, so **creating the
file resolved the forward reference** without touching a shared file two other agents were working
around. Verified byte-identical.

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
| **State** | `DONE` — approved 2026-10-01; 11 integration tests, 100 records in 588 ms. **Closed §7.2's chunk-size marker with a number: ship 50** — 25 costs 47 % more for nothing and above 50 buys ≤ 5 % while costing chunk granularity. Found a limit on `P1-T13`'s search-counting technique (a write window also counts Zotero's own notifier searches) and a `P2-T09` trap: **DOI precedence decides which match wins, not whether there is one.** Criterion 6 was unfalsifiable as written — it made a comment the artefact — and was reported, not adjusted. |
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

**Findings, 2026-10-01 — all seven criteria pass, and criterion 6 was unfalsifiable as written.**
`src/zotero/importer.ts` (~760 lines), `collectionOps.ts` **extended**, and 11 integration tests
against a real Zotero 10.0.3. The suite is at **51 passed, 0 failed**; typecheck, lint:check and the
unit suite (**787**) all exit 0.

**§4's corrected rule landed for the fourth time in three days, and it was needed.** `collectionOps.ts`
is on the sixteen-path list and this card's row says `create`. Grepping first found **two importers,
neither in this card's `Files`**: `src/zotero/zoteroApi.ts` (`findOrCreateCollection`) and
`test/integration/zotero/batchImport.spec.ts` (`saveNewItemsToCollection`, `BatchSaveResult`). So the
file was **extended** — every `P0-T10`/`P0-T20` export keeps its name, signature and behaviour,
verified: `findOrCreateCollection`, `BatchSaveResult` and `saveNewItemsToCollection` are all still
exported, with `addExistingItemsToCollection` added beside them. `findOrCreateCollection` gained an
**optional trailing** `parentID?`, so omitting it reproduces the spike's top-level lookup
byte-for-byte, and `batchImport.spec.ts` still passes with `P0-T20`'s numbers intact.

**§7.2's chunk-size marker is closed with a number: ship 50.** Four sizes over a real 200-item import,
each with its own stall monitor — 25 costs **47 % more for nothing**; 50, 100 and 200 are within noise
of each other, so above 50 buys ≤ 5 % and costs **chunk granularity**, the slowest chunk going
261 → 418 → 892 ms. That granularity is the resolution of cancellation and of any future progress
tick, not of NFR-3 — **and NFR-3 is not the constraint at any size**, because no gap exceeded 100 ms
even at 200-in-one-transaction. The table is now in §7.2; its **notifier-suppression half stays open**,
and suppression was deliberately not implemented: `P0-T20` measured that Zotero already queues a
transaction's notifier events and delivers them once post-commit at 60–100 ms, **which is `R-16`'s
mitigation already in force**, so suppression would buy an unverified risk for nothing measurable.

**Slower per item than `P0-T20` and the breakdown says why, so it is not a regression.** 100 items in
**588 ms** (5.9 ms/item) against the spike's 293–425 ms (2.9–4.3), decomposed as index 4 + mapping 20
+ write 560. The shipped path adds the dedup pass, `toZoteroMapping`'s ~16 fields plus `extra`, tags,
`accessDate` and `libraryCatalog` against the spike's four, and ran against a **150× larger library**
(302 items vs 2). The chunkSize-200 sweep — `P0-T20`'s exact shape at twice the scale — lands at
**4.53 ms/record**, so a richer item costs ~1–1.5 ms/item more than the spike's. Coherent with
`P1-T13`'s ~1.26 ms/item for `setField`-only bulk inserts, and **insertion still does not degrade with
library size**: the sweep ran as the library grew past 1,200 items with no upward trend.

**Criterion 6 was unfalsifiable as written and was not adjusted.** It asks that the UI be interactive
during a 200-item import, "**manual observation noted in the spec comments**" — a comment cannot fail,
and nobody watches the window during a runner run. **Sibling assertions** now state mechanically what
interactive means: the main window's event loop ran **≥ 10 times** (observed **107**) and no single gap
exceeded half the import's duration (longest **35 ms** of 847). The NFR-3 figure itself is **recorded
per chunk size rather than asserted**, matching `P0-T20`'s equivalent criterion, because the measured
number also contains Windows' ~16 ms timer resolution and Zotero's own post-commit refresh — which
`P0-T20` measured alone at 60–100 ms. Every observed figure is well inside budget, so the choice hides
nothing.

**A limit on `P1-T13`'s search-counting technique, found by this card's own test failing.** Patching
`Zotero.Search.prototype.search` around a window that **writes** does not count only the plugin's
searches: **Zotero runs searches of its own while delivering a transaction's notifier events.**
Measured: 3 commits + 1 index build → **4** calls; 1 commit + 1 index build → **2**; 1 commit and **no**
index build → also **2**. The surplus is not a clean function of commit count. A first draft asserted
`searches === 1`, then `searches <= 1 + transactions` — which held three times and failed on the
fourth. **`libraryIndex.spec.ts` is unaffected**, because it counts around a pure index build with no
write in the window. The card's actual property is now asserted the way it *is* falsifiable:
`stats.indexSearchCount` for the plugin's half, plus a test proving the observed total is **identical
for 2 and for 20 candidates** (2 and 2). Worth recording in `docs/13` §2.1 as a constraint on the
technique.

**A trap for `P2-T09`, found by this card's own fixture generator being wrong.** It namespaced only
DOIs and reused one PMID range across batches, so **100 of 200 "fresh" records were linked instead of
created.** The reasoning that failed was "DOI precedence means a fresh DOI makes the record new" —
**DOI precedence decides *which* match wins, not *whether* there is one**, so a record whose DOI misses
falls through to the PMID arm. In production that is a **silent under-import**. Recorded in the spec
header.

**Fixtures are cleaned up rather than gated, and that is better than `P1-T13`'s pref for this size.**
Both specs erase every item and collection they wrote in `after()` — ~940 items in ~2 s, verified in
the log. The fixture does not outlive the spec at all, so **no later spec can be perturbed whatever
order the runner enumerates `test/integration` in**, and the criteria still run on every ordinary run
instead of only when a pref is set by hand. `P1-T13` could not do this because 9,685 erases cost more
than the measurement they would protect. A failed erase is reported through `debug()` and swallowed, so
cleanup can never turn a green run red.

**Design choices worth keeping.** Everything decidable outside a transaction is: dedup resolution,
`toZoteroMapping()`, and `new Zotero.Item()` + `fromJSON()`. `buildLibraryIndex()` runs **once per
run** before any transaction, `findExisting` stays synchronous, and `"import-anyway"` builds no index
at all because nothing would read it. `DuplicatePolicy` is a **parameter, not a pref**, because
`docs/07` §8.5 declares no row for it. `strict` is caller-supplied rather than a read of `__env__`,
which `P0-T20` found the scaffold's test bundler does not define. `failed[]` entries carry §10.1's
**redacted** `SerializedError`, and a non-`ResearchHelperError` throw is wrapped so `failed[]` has one
shape and `docs/08` §8.3 has a `messageKey` to map. **No HTTP is reachable from the module at all.**

**The import summary line was not emitted, by design.** The importer returns counters, not a string,
because `docs/08` §10.3 forbids concatenating translated fragments — and the four counters are
**name-for-name** the four arguments of `P1-T18`'s shipped
`research-helper-import-summary`, with `abstractCoverage.percent` filling
`research-helper-import-abstract-coverage`'s `$percent`. So the one spelling `P1-T18` chose out of the
corpus's four is followed **by construction rather than by a second string.**

**Reported, not absorbed.** The card's `ImportReport` shape **cannot express `docs/08` §4.4's own
`skip` policy** — a dropped record would vanish from the report, and `P1-T18`'s message has a
`$skipped` argument with nothing to fill it; `skipped` was added as a **sibling** field, never removing
or renaming one of the four, and the shape needs blessing. `FR-53`'s cancel message wants "the count of
items already imported" and `OperationCancelledError` carries no counts, so the token checkpoint is
implemented and **the count question left open** rather than a shape invented.
`toZoteroMapping`'s `overflowNote` is produced and dropped — writing the child note is a second item
per record that this card's `Files`, counters and criteria do not cover. And only **one** intra-request
dedup rule shipped (same `workKey` → skip); two *different* work keys sharing a DOI is cross-source
identity and belongs to `P2-T09`, not to a second rule beside `LibraryIndex`'s.

**`matchedOn` was not widened** — still `"doi" | "pmid"`. `docs/02` §11.6's "persistent dismissed list"
advice did **not** reach the importer, and a trashed duplicate provably does not block an import.
`useTranslators` is never read and `Zotero.Translate` is never imported.

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
| **State** | `DONE` — approved 2026-10-07; **the installer moved for the first time in five cards**, 76,419 → 111,969 bytes, and three of the four stranded modules now reach it — the key store, the adapter and the mapper, with the startup keystore probe and `registerSources` called for the first time. The agent **separated its own 23,052 bytes from a concurrent card's by A/B build rather than by inference.** One defect blocked the whole card and is instructive: the keychain module evaluates a platform global **in its module body**, so merely importing it threw and took a unit suite down with **zero tests collected** — *the module graph of a layer-one test is as much a part of its contract as its assertions*. Criterion 1 passes as `"partial"` rather than `"succeeded"`, argued from §12.1 rather than assumed. Three mutations broke nothing and all three became real assertions, including one where **the test's own stub was performing the check under test**. |
| **Depends on** | `P1-T07`, `P1-T09`, `P1-T10`, `P1-T14`, `P1-T15`, `P1-T25`, `P1-T31` |
| **Blocks** | `P1-T22`, `P2-T02`, `P1-T35` |
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
      warning naming the source, and the run ends in a **success** outcome — which is `"partial"`,
      not `"succeeded"`.
      > **Clarified 2026-10-07 after the executing agent reported it under rule 6.** This read "the
      > run succeeds", which reads as the literal outcome `"succeeded"`. **That value would be
      > wrong here**: `FR-9` asks for a non-blocking banner naming the failed source, and a plain
      > success gives the window nothing to raise it from. `docs/07` §12.1 makes partial fetch "a
      > first-class state, not an error", so `"partial"` **is** the success outcome for this case.
      > Verified: page-one records kept, exactly one warning naming the source, the typed error
      > preserved on that source's report, and the import completed.
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

**Findings, 2026-10-07 — the installer moved for the first time in five cards, and three of the four
stranded modules now reach it.** Verified independently: **the installer is 111,969 bytes**, up from the
76,419 it had held across `P1-T06`, `P1-T09`, `P1-T10`, `P1-T17` and `P1-T11`. Bundle occurrence counts
read **non-zero for the first time** on the key store, the startup keystore probe, `registerSources`,
the adapter factory, the mapper factory, both E-utilities endpoints and the key-presence preference —
and **zero, correctly, on the provenance modules**, which belong to a later card. 50 unit tests,
typecheck 0, `lint:check` 0.

**The agent separated its own contribution from a concurrent card's by A/B build rather than by
inference**, neutralising its own wiring and rebuilding: **23,052 bytes of the growth are this card's**
and 12,498 are `P1-T21`'s window files, with `container.ts` restored byte-identically before the final
build. **With three cards in flight, a measured split is the difference between a number and a guess.**

**One defect blocked the whole card and is a genuinely instructive one.** `src/zotero/keychain.ts`
evaluates `Components.Constructor(...)` **in its module body** — verified at brace depth 0, line 95 — so
`Components`, a platform global, runs on import. Merely *adding the import* to the composition root threw
`ReferenceError: Components is not defined` and took a whole unit suite down with **zero tests
collected**: the suite went from 1,115 passing to 1,110 with one failed *file*, from a change that added
no test and touched no assertion. **The module graph of a layer-one test is as much a part of its
contract as its assertions.** Worked around with a dynamic import inside the install function, which
moves evaluation to first call where the existing error handling already covers it and degrades to "no
secret backend" under the test runner. **The one-line fix — make that constructor lazy, as every other
platform reference in that file already is — is outside this card's `Files`.** Needs a card.

**The end-to-end path is real, and the agent said exactly where the doubles are.** A search input runs
through the real pipeline, the real query parser, the real adapter, the real query builder, the real HTTP
client, the real response parser, the real mapper and the real merge lift, with assertions on the
artefacts that only a real run can produce: both endpoint addresses **and their order**, the identifiers
reaching the second call being the ones the first returned, **no credential parameter on any address**,
and the derived work key. The doubles are the Zotero write surface — because the real writer reaches the
database before its first suspension point, and the testing document says wanting a richer platform fake
is a signal the code belongs in an integration test, where a spec already covers it — plus the two
bytes-on-the-wire boundaries. **And the agent named which assertions would survive swapping a real stage
for a stub and which would not**, which is the question a pipeline test usually dodges.

**Three mutations broke nothing and all three were diagnosed into real assertions, taking the suite from
48 to 50.** Each diagnosis is worth more than the mutation. (a) Removing the pipeline's own cancellation
check between write batches changed nothing because **the test's own stub writer was performing that
check** — the double was providing the very thing under test; fixed by removing it from the stub, so the
pipeline's checkpoint is the only thing between a cancel and the next batch. (b) A clamp that forces the
last progress slice to end at exactly 1 is invisible **because the shipped weights already sum to 1**; a
weight set summing to 1.0000000000000002 now exercises it, which is why the tolerance exists and why a
later card re-tuning the weights would otherwise reintroduce a bar that never reaches 100 %. (c)
Replacing an increment with a set-progress call leaves the **final** snapshot identical, so nothing
failed — but during the write it drops the total and **the bar goes indeterminate halfway through an
import**, which is exactly what a user would see; now asserted on every mid-stage snapshot.

**Criterion 1 passes on a reading the agent argued for rather than assumed.** A source failing on its
second page yields `"partial"`, not the literal `"succeeded"` the criterion names — and `"succeeded"`
would be **wrong**, because the requirement asks for a non-blocking banner naming the failed source and a
plain success gives the window nothing to raise it from. `docs/07` §12.1 makes partial fetch "a
first-class state, not an error". Reported under rule 6 rather than adjusted. Page-one records are kept,
exactly one warning names the source, and the typed error survives on that source's report.

**Criterion 4 forced a decision the corpus had deferred.** The importer's own documentation says a thrown
error "carries no counts; reported as needing a decision rather than invented here" — so a cancel during
the write could not report how many items had been created. The decision taken: **the pipeline batches
the works itself and calls the writer once per batch**, so a cancel between batches leaves the
accumulated counts on the run, and the production writer builds the library index once per run and makes
one pipeline batch one database transaction, which is what the requirement asks for. Verified: one batch
written, two items created, the collection kept, and the partial note text carrying the count.

**Five things the first integration surfaced that no earlier card could have.** Beyond the import
defect: **nothing in the corpus converts a source record into a canonical work** — the former is the
latter minus three fields and the writer requires the full type, so the lift mints them via the declared
key algorithm, deliberately using the same function that re-derives the key when an item is read back,
because deriving it any other way would break the round trip. **`docs/07` §7.4's partial-import note has
no write path anywhere** — nothing in the platform layer sets a collection description, and the file that
would is outside this card's `Files`, so the pipeline composes the note, logs it, and leaves the seam.
**`logRequestBodies` is read once at construction**, so toggling it mid-session does not change what the
mapper retains until the plugin restarts; the default direction is the safe one. And **eleven Fluent
message identifiers do not exist in either bundle** — seven stage labels, the pipeline display name and
three validation keys — which costs nothing until a surface renders a stage name, and that is the next
card's.

**A corpus finding that is larger than it looks.** `docs/07` §4.5's pipeline context names **four types
declared nowhere in the entire corpus** — one occurrence each, the member itself — and three more that
are declared but implemented by no module. The agent reproduced §4.5's member list name for name using
forward aliases to `unknown`, so a diff finds no difference, **nothing can read a service Phase 1 has not
built without writing a narrowing that makes the gap visible**, and replacing an alias with a re-export
is a one-line change as each ships. Two of the seven have **no home anywhere**. That is the right
treatment of a specification that names things that do not exist.

**Two errors in the hand-out, both the coordinator's.** First: "all seven of this card's dependencies
have landed." Verified — **six are `DONE` and `P1-T10` is `TODO`.** Its work has landed and carries a
`Findings` block, so the dependency is satisfied **in code but not in approval**, and only a human can
change that. The word "landed" was defensible; the inference a reader draws is not, and the agent was
right to separate them. Second: the extras-spread trap I warned about **does not arise in this card** —
this card fetches through the streaming method as its own step instructs, and that method never yields a
page, so the extras never reach the pipeline layer at all. **This card is not the first caller**, and the
first caller is whichever card extends the port or reads the paged method directly.

**And that is itself a finding worth more than the correction.** `docs/07` §4.2's streaming method
**cannot supply four of the required provenance fields**: the endpoint address is on no member of the
interface, the transmitted address is built inside the adapter and never returned, the raw hit count is
reachable only through a progress total the adapter clamps, and the extras live on the page the streaming
method discards. One field — the explained query — *is* reachable and is recorded. §11.1's closing rule
says widening that interface is a documented change to the architecture document, not a local workaround.
**Needs a card, and that card is where the spread trap will finally bite.**

**Security: nothing in the added path can carry a credential, stated concretely rather than generally.**
The store is handed to the adapter, which reads the key per request and logs only the redacted address
with the named parameter **removed**. The install function logs a failure class, a platform error name
and a boolean — never a value — and the probe's plaintext is a throwaway string it never stores. The
key-presence write is a boolean to a row that is not marked secret, and the preference layer refuses a
write to a secret row before coercion. The pipeline layer never sees a key: the recorded query comes from
the interface's own explain method, asserted alongside **no credential parameter on any issued address**.
**Redaction is not re-implemented anywhere.** And `P1-T17`'s two holes are neither reopened nor forgotten
— nothing added puts raw text through the free-text path, and an untyped error contributes its **name**
rather than its message, because an arbitrary message has not been through the redactor.

**The keyed path is a gate, not a result.** The owner supplied no key, so the eight-requests-a-second
branch was not exercised end to end and the keystore probe cannot reach tier one under the test runner.
Reported as a gate rather than worked around.

**The integration suite could not be measured and no number is claimed for it.** The run entered watch
mode and the log shows the three window files changing **during** it — another card was rewriting them —
ending in a window-opening security error inside that card's own spec block. No Zotero process was left
behind and none was killed. **Saying "not verifiable, and here is whose edit made it so" is the correct
report.**

**Needs a card.** The lazy platform constructor in the keychain module; a collection-description writer
for the partial-import note; either a page-level channel on the source interface or a pipeline that pages
the non-streaming method, so the four provenance fields become reachable; declarations and homes for the
two undeclared context types, and re-exports replacing the five forward aliases as each service ships;
the eleven Fluent messages; and a getter for the raw-retention flag so the preference takes effect
without a restart.

---

### P1-T17 — Provenance record, note writer and JSON export

| Field | Value |
|---|---|
| **ID** | `P1-T17` |
| **State** | `DONE` — approved 2026-10-07; the provenance record, the human note and the JSON export, with the in-memory record as the authority and the asymmetry **disclosed**: a new field reaches the export and the schema check automatically, the note only when someone edits the renderer. **Closed two real credential leaks the project's own redaction could not see**, both reproduced by the coordinator — a bare query string parses as a *path*, so the parameter list is empty and nothing is removed; and a URL inside free text is invisible to the free-text redactor. A 32-character key is below its 40-character threshold. **One of the two was a live defect in the first draft, not a mutation.** Criterion 5's second half cannot hold, because the shipped redactor *removes* a named parameter and an empty value is the one thing a marker cannot express. **Separated conformance assertions from self-consistency ones**, and shipped no reader, so no round-trip can pass by agreeing with itself. |
| **Depends on** | `P1-T09`, `P1-T14` |
| **Blocks** | `P1-T22`, `P2-T17`, `P1-T35` |
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
      `grep -c "api_key=" ` is 0 and the record contains no key-shaped run.
      > **Reworded 2026-10-07 after the executing agent reported it under rule 6.** The second half
      > read "and the redaction marker is present", which **cannot hold for a key carried as
      > `api_key`**: `docs/09` §2.1 and the shipped `redactUrl` **remove** a named secret parameter
      > rather than blanking it, and `src/core/errors.ts` says why — "an empty value is the one thing
      > `[redacted:<len>]` cannot express". So no marker can appear for the very case the criterion
      > names. The agent shipped the strongest true form instead, pinning the marker where one *is*
      > possible: a key-shaped run in free text.
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

**Findings, 2026-10-07 — six criteria pass, one passes in half, and the card closed two real credential
leaks that the project's own redaction could not see.** Verified independently: four new files
(404 + 344 + 160 + 1,026 lines), **51 tests**, the suite at **1,115 in 26 files**, typecheck 0,
`lint:check` 0, build 0 with the installer **byte-identical at 76,419**.

**The two holes are real and the coordinator reproduced both.** An NCBI key is **32 characters** and the
free-text redactor's last-resort pattern starts at **40** — verified at
`src/core/errors.ts`'s `/\b[A-Za-z0-9_-]{40,}\b/g` — so such a key is invisible to it. On top of that:

- **A bare query string is a no-op for the URL redactor.** Reproduced: `new URL("db=pubmed&api_key=…",
  base)` parses the whole thing as a **path**, so the parameter list is **empty** and nothing is found
  to remove; prefixing `?` yields three parameters. The fix prefixes the `?` so the **shipped** secret
  parameter list applies, rather than re-declaring that list.
- **A URL embedded in free text is invisible to the free-text redactor**, which has no notion of
  parameters. The fix puts every `https?://…` run through the URL redactor first.

**One of those was found as a live defect in the agent's own first draft, not as a mutation**: the
serialized error detail leaked the key. **Both outputs of this card are human-readable or shareable**, so
that was the direction that mattered.

**One gate rather than a convention, and it is idempotent on purpose.** A single entry point redacts, and
the export boundary redacts **again**, so a caller that forgets costs nothing — provable only because the
URL redactor *removes* a named parameter and the marker it leaves matches no secret pattern. Every field
that can carry free text goes through it, including **every string at any depth inside the extras
object**, because one of its three keys is an array of objects. The remaining fields are closed
enumerations, numbers or identifiers. **No new redaction rule was invented** — everything delegates to
the reference implementations.

**Criterion 5's second half cannot hold, and the reason is a design decision recorded in the code.** It
asks that a stubbed key produce a record where the parameter is absent **and the redaction marker is
present**. The shipped redactor **removes** a named secret parameter rather than blanking it, because
`src/core/errors.ts` says "an empty value is the one thing `[redacted:<len>]` cannot express" — so **no
marker can appear for the very case the criterion names**. The agent shipped the strongest true form,
pinning the marker where one *is* possible, and reported the rest under rule 6. Criterion reworded above.

**The authority among the three shapes was chosen and the asymmetry disclosed rather than hidden.** The
in-memory record is the authority; the export is a projection of the **whole** record rather than a field
list, so a new field reaches it with no code change; the schema does **not** follow automatically but the
drift is **caught**, because a test compares the schema's property set against the keys of a fully
populated record. The note does not follow and **nothing fails** — deliberately, because the note is for
a human and forcing every future field into it would be wrong. **"A new field reaches the export and the
schema check automatically, and the note only when someone edits the renderer" is the kind of sentence a
reader needs and rarely gets.**

**The schema is validated, by exactly one thing, and the agent said which.** Nothing else reads it: it is
outside the type system's include list, it is JSON regardless, **it does not ship in the installer**
(verified), and continuous integration reaches it only through the unit suite. The validator is 170 lines
inside the test file, because **this repository declares no JSON Schema validator** — verified: no such
dependency is declared, and the one present transitively is an older major version that cannot read this
dialect, and declaring a dependency is outside the card's `Files`. **The failure mode a hand-written
validator has and a real one does not — silently ignoring a keyword — was closed**: a guard walks the
schema along the validator's own traversal and fails on any keyword it does not implement, proven by a
mutation that adds one. Seven negative tests prove it actually rejects.

**One mutation broke nothing and was correctly diagnosed as a coverage gap rather than a redundant
guard.** An empty query string renders as nothing in the note editor, which a reader would take as "not
recorded" rather than "empty" — and the branch is reachable from a shipped caller. The agent added the
assertion; the suite went 50 to 51.

**Self-consistency and conformance were separated explicitly**, which is the distinction most test
reports blur. Ten assertions are conformance — field names and order diffed mechanically against the
printed interface block at **27 declarations, zero differences**; the requirement's literal note title
including its em dash; its eight per-source quantities as both the schema's required list and the note's
labels, zeros included; the permitted HTML element list asserted by subtracting the allowed set from
every tag in the rendered note; the "no Markdown" rule asserted negatively; the identifier union as the
schema's enumeration. Five are the drift alarm and prove the artefacts agree rather than that either is
right. **And no reader was shipped, so there is no round-trip that could pass by agreeing with itself.**

**A claim the coordinator wrote into a `Findings` block without compiling it, now corrected.** The
previous card's record said this card "can assign the object straight across". **It cannot** — verified
with a throwaway probe under this repository's own configuration: the extras type is an `interface`, and
TypeScript synthesises an implicit index signature only for *type aliases*, so the assignment fails with
`Index signature for type 'string' is missing`. **The repair was measured too** — a spread typechecks —
so the eventual caller does not have to rediscover it. The three keys themselves are right. **A later
agent would have inherited that premise**, which is what rule 8 exists to stop.

**Two more corpus problems, both resolved in the stricter direction.** The interface's own header says it
imports only the model layer while one of its fields is typed by a sibling in the same layer — harmless,
because the rule forbids layers *above*, and an existing module already does the same. And §5.3 calls the
user's query "verbatim" while NFR-16 says keys shall **never** be written to a provenance record; a key
pasted into the search box makes those incompatible, and the agent resolved it **in the requirement's
favour**, noting that a key-shaped run is never a legitimate search term and the stricter reading costs
nothing. A one-line amendment would close it.

**Measured rather than assumed: this code ships nowhere.** No importer outside the two new files, the
installer byte-identical, and the bundle holds **zero** occurrences of five named symbols — confirmed by
the coordinator. **Three cards in a row have now shipped working, tested modules the installer does not
contain**, all pointing at the same missing construction site.

**Nothing was written anywhere real.** No note was created, no file written, no preference touched, the
integration suite not run, and the only key-shaped string in the tree is an invented placeholder that
exists so the tests can assert its **absence** from both outputs.

**Needs a card.** (a) A declared validator for this schema dialect, replacing 170 lines of test code.
(b) The construction site, which belongs to the card this one blocks. (c) The spread at whichever card
assembles the record. (d) The one-line amendment reconciling "verbatim" with NFR-16.

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
| **State** | `DONE` — approved 2026-10-05; the Tools submenu is **extended, not replaced** (Search & Import first, above `P0-T10`'s spike item) and the collection menu is one item gated on a single selection. `openSearchWindow` takes the host window as a **parameter**, because `docs/08` §4.1's printed `Zotero.getMainWindow()` call is a lint error twice over inside `src/ui/` — and the parameter is the better behaviour, since it raises the dialog over the window that owns the clicked item. **Criteria 1–4 rest on a document `P1-T20` creates, and `P1-T20` depends on this card**: not weakened, each mechanism asserted, and a **self-activating** test prints `PENDING P1-T20` until the document lands. 63 integration tests; eight deliberate defects failed 10 of 12 tests. Found that `docs/08` §2.2's "Hook timing" is **wrong as a description of the mechanism** (read from Zotero 10.0.1's `menuManager.js`) while the user-visible behaviour is still correct — both facts now asserted. |
| **Depends on** | `P1-T18`, `P1-T25` (added 2026-10-01 — `P1-T25` wired `installServices()` into this card's own file) |
| **Blocks** | `P1-T20`, `P2-T17`, `P1-T34`, `P2-T22` |
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
- modify `src/bootstrap/registerUI.ts` (**was `create`; corrected 2026-10-01.** `P1-T25` has since
  `modify`ed that file to call `installServices()` — a literal `create` here would delete the whole
  service-graph construction. Same ordering inversion as the one `P1-T25` found in `P1-T16`'s
  `container.ts` row: §4's one-`create`-per-phase rule was satisfied on paper while the card that
  creates ran after the card that modified. Extend `registerUI()`; `installServices()` must still
  run **before** the menu registrations, because a menu handler can issue a request the moment the
  item exists, and teardown being LIFO the menu then comes apart first.)
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

**Findings, 2026-10-02 — two criteria pass, one passes in half, and three are reportably
unverifiable because the card they need is the card this one blocks.** `P1-T20` creates
`addon/content/searchDialog.xhtml` and **depends on `P1-T19`**, so criteria 1–4's "the window opens"
cannot be exercised today. They were **not weakened** (rule 6). Instead each one's mechanism is
asserted — the derived `chrome://` URL, the window *name*, `docs/08` §4.1's feature string verbatim,
`args` as `openDialog`'s fourth argument, `focus()` on every invocation, and no network call — and a
**self-activating** test probes the chrome URL for *content* and runs the real open/singleton
assertions the moment the document lands. Today it prints `PENDING P1-T20: … yields no response, so
the real-window criteria … are NOT verified by this spec`, so the shortfall is **in the test output
rather than in prose nobody re-reads**. Criteria 5 and 6 pass outright.

**Verified independently of the report: 63 integration tests pass (51 baseline + 12), exit 0 under
`--abort-on-fail`; typecheck 0; `lint:check` 0; 816 unit tests in 21 files, unchanged.** Exactly four
files, all in `Files`.

**§4.1's printed `openSearchWindow` cannot be written where §4.1 puts it**, and this is the third
doc-sketch in the corpus that does not compile in its stated location (after §7.7 and §10.1 of
`docs/07`). It calls `Zotero.getMainWindow()` from `src/ui/dialogs/searchDialog.ts`, which
`eslint.config.js` rejects **twice**: `research-helper/zotero-global`, and `layering/ui` bars
`src/ui/**` from importing `src/zotero/**` at all. The host window became a parameter — **which is
also the better behaviour**: `registerMenus.ts` passes the window that owns the *clicked* item, while
`getMainWindow()` returns the most recently active one and can raise the dialog over the wrong window.

**`docs/08` §2.2's "Hook timing" is wrong as a description of the mechanism, read from Zotero 10.0.1's
own `menuManager.js`.** A top-level `onShowing` runs synchronously **only when `updateMenuPopup`
receives an `event`**; with none it is attached as a `{ once: true }` `popupshowing` listener on the
parent popup — and `zoteroPane.js` passes **no `event`** for `main/library/collection` or
`main/library/item` (it does for `addAttachment`/`addNote`; `standalone.js` passes one for all six
menubar targets). **The user-visible behaviour is still correct**, because
`onCollectionsContextMenuOpen` awaits `buildCollectionContextMenu()` *before* `openPopupAtScreen()`.
This cost a failed run before it was found: any test that reproduces the build without the
`popupshowing` sees the guard unapplied. Both facts are now asserted (`hiddenOnBuild` vs `hidden`, and
`_initMenu` re-using the element without resetting `hidden`) — the integration log shows
`hiddenOnBuild:false, hidden:true` on first open and `hiddenOnBuild:true` on the second — **so a
change in that order fails a test rather than shipping.**

**Eight defects applied at once; 10 of 12 tests failed, each on its intended assertion** — and the
two that stayed green were correct to (the `P1-T20`-gated one, and one covered by another defect's
failure). The ones worth naming: moving Search & Import to the end of the Tools submenu failed the
order test with `Received [spike, "", search-import]`; `length >= 1` in place of `=== 1` failed "two
selected -> hidden"; dropping `collectionID` from the args failed the pre-selection test; suppressing
the missing-host `onError` failed "an unhandled rejection in the sandbox is the FR-56 failure";
removing the collection registration failed **both** the menu test and cycle 1 of the five-cycle test.
All four files restored from backup and every figure above re-measured on the restored tree.

**`FR-56` is clean on both surfaces, by two independent measures.** Five cycles; after each disable
`scope.liveHandles()` is `[]` **and** both popups hold 0 of our top-level items; after each enable
exactly 1 of each. `lifecycle.spec.ts`'s single cycle still passes unchanged.

**The collection entry reuses `P1-T18`'s `research-helper-menu-collection-search-import` rather than
the Tools id**, which was the right call for a reason the card did not state: `keys.ts` already
carries that id in `MAIN_WINDOW_MESSAGE_IDS` and admits it in `KO_PENDING_REVIEW`, and
`l10n.spec.ts` asserts the ko-KR gap equals **exactly** those lists — so reusing the Tools id would
have left a declared, shipped, **never-rendered** message id. No new id was minted, so none of
`P1-T30`'s three obligations was incurred.

**`src/hooks.ts` is in `Files` and was correctly left untouched.** Do step 4 asks for a
`registeredMenuIDs` array; `P0-T07` replaced that with the `Scope` registry and `onShutdown` already
calls `unregisterAll()` + `reportSurvivors()`. Do step 5's chrome registration was already satisfied
by `P0-T02`. **Both are now measurements rather than assumptions:**
`chrome://research-helper/content/icons/favicon.png` → **1723 bytes**;
`chrome://researchhelper/...` → **`undefined`**, the request rejects. The hyphenated package is the
real one, and a test says so.

**`zotero-types@4.1.3` types the trap and omits the replacement.** `MenuManager.LibraryMenuContext`
declares `collectionTreeRow?` — the singular member `docs/08` §2.2 shows **throwing** on a
multi-row selection and labels "Never read" — and declares **no `collectionTreeRows` at all**;
`typings/zotero-augment.d.ts` §5 augments `ZoteroPane.getSelectedCollections()` but not this. That is
the second reason the handlers go through `ZoteroPane`. **It blocks `P2-T17`**, whose rerun entry
reads `context.collectionTreeRows[0].ref.id` in `docs/08` §2.4's own block. Separately
`BaseMenuContext.menuElem` is declared **required** while §2.2 and `menuManager.js` (a `WeakRef`
deref) make it optional, so the context parameter is taken as a local structural type with
`menuElem?` and the optional reads are honest.

**Four corpus defects found, none absorbed (rule 2).** (a) `docs/08` §2.4's `ICON`
`chrome://research-helper/content/icons/menu-16.svg` **does not exist** — `addon/content/icons/` holds
only `favicon.png`, `favicon@0.5x.png` and a README — so setting `icon` would paint a broken image and
neither menu sets one. (b) `docs/08` §4.1 **still writes the namespace unhyphenated**, in its code
block *and* its prose at line 865, and **this card's own Do steps 3 and 5 repeat it**; §2.4 was
corrected on 2026-09-30 and §4.1 was not. (c) This card's Goal and criterion 1 say **"Search
literature…"** while §2.4/§2.5 and `P1-T18`'s shipped FTL say **"Search & Import…"** — user-visible
text, so an **owner decision**, and the agent correctly followed the shipped bundle. (d) **An open
Search & Import window outlives teardown**: nothing closes it on disable, which is `docs/01` §12
gotcha 10's shape; it is unreachable from a handler (handlers get commands, not the `Scope`) and
cannot be exercised until the document exists.

**A spec-ordering leak worth knowing before someone asserts an English label.** `l10n.spec.ts`
restores `intl.locale.requested` but the negotiated chain stays `["ko-KR","en-US"]` for later specs,
so this card's label test logged `root="리서치 헬퍼" tools="검색 및 가져오기…"` beside an English
`collection="Search & Import into This Collection…"`. Its assertion is "non-empty label", hence
locale-agnostic and sound — but **any later spec asserting English text verbatim will be surprised by
spec order**, and the mixed line above is what that looks like.

**One coordinator error, and it was mine.** This card's brief gave the unit baseline as **802**; the
tree measured **816 before the agent wrote a line**, because `P1-T31` added 14 tests to the same 21
files while this card was in flight. The agent reported the discrepancy rather than quietly matching
it. The number was stale the moment two cards ran in parallel — **a brief's baseline is a reading, not
a constant, and parallel cards need the reading taken at hand-out.**

---

### P1-T20 — Search & Import window: markup and controls

| Field | Value |
|---|---|
| **ID** | `P1-T20` |
| **State** | `DONE` — approved 2026-10-07; the window exists with `docs/08` §4.2's controls in §4.5's order, sized by CSS, every visible string from the Fluent bundle, and `registerRoot` called so it follows the user's font size and density. **Shipping the first plugin document switched on two assertions that had been passing vacuously** — `P1-T19`'s self-activating probe now opens the real window twice to check the singleton, and the markup scrape went from "0 of 1 documents present, satisfied only vacuously" to 26 message ids with 0 undeclared. **Two defects were findable only by opening the real window:** the year label rendered `2,024 – 2,026` because Fluent puts a bare number through a number formatter, and a label with a Fluent *value* rendered nothing at all. The asset glob had to grow and the card's `Files` did not name it; verified by reverting. Honest about what was not checked: **nobody looked at the window**, and the dark-theme warning colour measures **3.06 : 1** against the 4.5 : 1 requirement. |
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
- modify `zotero-plugin.config.ts`
- create `test/unit/ui/searchDialog.test.ts`

> **Two rows added 2026-10-06, after the executing agent reported both as outside the list.**
> The asset glob in `zotero-plugin.config.ts` had to gain `.xhtml` and `.css`, and the coordinator
> verified why by reverting the change: **the window document vanishes from the installer and the
> build still exits 0**, so this card could have passed its own `Verify with` while shipping a dead
> file. `P0-T34` wrote that glob as an explicit list so that adding an asset type would be a visible
> decision; the decision belongs here. The unit spec is required by `plan/README.md` §6, and
> everything it asserts is about the three files this card creates.

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

**Findings, 2026-10-06 — the window exists, and shipping the first plugin document turned two
previously-vacuous assertions into real ones.** Verified independently: the three files are on disk
(markup 13,140 bytes, script 35,676, stylesheet 5,009), **916 unit tests in 23 files** (up from 863 in
22), **63 integration tests with zero failures**, typecheck 0, `lint:check` 0, and
`npm run build` exits 0 with an installer of **76,388 bytes** (was 58,932).

**The one file outside `Files` was load-bearing, and the coordinator proved it rather than accepting
the report.** `zotero-plugin.config.ts`'s asset glob had to gain `.xhtml` and `.css`. Reverting that
one change and rebuilding: **the window document vanishes from the installer and the build still exits
0.** So without it this card's own `Verify with` would have passed while shipping a dead file — the
document would sit in the repository, `chrome://research-helper/content/searchDialog.xhtml` would
return an **empty response rather than an error** (`P1-T18`'s measurement), and nothing would have
said so. `P0-T34` wrote that glob as an explicit list precisely so a new asset type would be "a
visible decision rather than an accident"; this card is that decision and **the card's `Files` row for
it is missing**. The addition also carries the `__addonRef__` substitution into both new files, so
neither spells the chrome package name — the stale-hyphen trap `P1-T18` and `P1-T19` each had to
measure separately.

**Two assertions that were passing vacuously now do real work, and that is the most valuable thing
this card produced.** `P1-T19` deliberately shipped a self-activating probe; before this card the log
read `PENDING P1-T20: … yields no response, so the real-window criteria … are NOT verified by this
spec`. **That line is now absent from the output entirely**, and the test opens the real window twice
and asserts the same object comes back: `✔ opens the real window as a singleton once P1-T20 ships the
document`. Separately — and the card does not mention this one — `l10n.spec.ts`'s markup scrape went
from `0 of 1 Phase 1 documents present … satisfied only vacuously` to **`26 distinct data-l10n-id, 0
undeclared []`**, so `P1-T18`'s first criterion is non-vacuous for the first time. **A card that
retires two vacuous assertions is worth more than its own criteria suggest.**

**Two defects in the first draft were found only by opening the real window, and neither was findable
from Node.** First, the year label rendered **`2,024 – 2,026`**: Fluent formats a bare number argument
through `Intl.NumberFormat`, so the year grew a thousands separator, and §4.2 requires the literal
`2024 – 2026`. Fixed by passing the years as strings while `years` stays a number so it still selects
the plural variant. Second, a `<label data-l10n-id>` **showed nothing at all**: the message is a bare
Fluent *value*, which Fluent assigns to `textContent`, and `<label value=…>` does not render
`textContent`. Fixed by using `<description>`, and the same fix applied to two more elements. **Both
are the kind of defect a unit test cannot see**, which is the argument for this card's integration
work rather than against it.

**The zero-registered-source situation, measured and reported rather than worked around.** Nothing
calls `registerSources()` or `installServices()` at startup — both are reached only from their own unit
tests — so the registry is empty, there is no preference store installed at runtime, and `src/addon.ts`
publishes nothing on the plugin instance. The Databases row therefore renders **zero** checkboxes,
confirmed in a live window, and **no source identifier appears in the markup at all** (asserted
mechanically; a faked checkbox is caught by a mutant). "Done when" item 4 is consequently **half
verified and said to be half verified**: the *zero-registry* half is asserted end to end in a live
window — Search disabled, the inline message on screen with its resolved English text — while the
*user-unchecks-everything* half is asserted only at unit level, because there is no checkbox to drive.
Rule 6: the criterion was left exactly as written.

**The agent declined to mint a message identifier, which was the right call.** The existing FR-2 string
("Select at least one database to search.") is reused for the empty-registry case because it is the
same gate with the same consequence — but it is **advice the user cannot act on** when nothing is
registered, since there is no database to select. A distinct string would be better, the bundle has
none, and new strings belong to `P1-T18` and gate `G-41`. **Reported, not minted.**

**Accessibility: `registerRoot` is asserted at two levels, and the theme behaviour was measured rather
than eyeballed.** The live dialog root reports `--zotero-font-size`, `--zotero-ui-density` and a
computed `font-size: 13px`, and those custom properties exist **only** because
`Zotero.UIProperties.registerRoot` ran; the unit suite independently asserts the call happens exactly
once with the right element. Themes were measured by forcing Gecko's dark-theme preference in a
throwaway profile and reading computed colours both ways, which is better evidence than a screenshot.

**One accessibility number is worse than the report said, recomputed here.** The inline warning colour
is Zotero's own `--accent-red`. On the light background it reaches **4.74 : 1**, which passes the
AA requirement of 4.5 : 1. On the dark background the composited colour is `rgb(200,43,55)` on
`rgb(30,30,30)`, which is **3.06 : 1** — the report estimated ≈3.6 : 1, and the true figure is lower.
NFR-13 asks for AA in both themes and the dark case does not reach it for body-sized text. **Needs a
card**, together with the one genuinely human check this card cannot do.

**What the agent said it did not verify, which is the part worth reading.** "Renders correctly in both
light and dark themes" — meaning no clipping, no overlap, no unreadable pairing — **was not checked by
looking at the window.** Tab *order* was read from document order plus the measured absence of any
`tabindex`, not by pressing Tab. Enter-in-the-keyword-field was asserted at unit level only; Escape was
driven as a real synthesised key event in a live window and closed it. **Stating which of a
user-interface card's criteria were measured, which were inferred, and which were not checked at all
is the only honest way to report this kind of card**, and the inferences are sound ones.

**A conflict inside the card's own instructions, resolved and documented.** `Do` step 1 says to copy
§4.1.1's markup "exactly", and §4.1.1's sample hard-codes three English strings — the window title,
`buttonlabelaccept="Import"`, and the cancel label — while the card's `Do NOT` forbids any hard-coded
English string in the markup. The agent resolved it for the `Do NOT` and sets all three from Fluent in
`init()`. Verified: the markup contains **no** `label=`, `title=`, `tooltiptext=`, `placeholder=`,
`accesskey=` or `buttonlabel*=` attribute at all, and the only `value=` attributes are four
machine-readable values (`new`, `skip`, `link`, `import`); the live window reports a resolved title and
button labels.

**New noise in the build log that is not a regression.** The build now prints **26** warnings, one per
message identifier in the new document that the Korean bundle does not translate. That bundle ships
exactly one message by design, `KO_PENDING_REVIEW` enumerates the rest, and `l10n.spec.ts` asserts the
missing set equals that list — so this is gate `G-41`'s known, deliberate gap becoming visible, exactly
as `plan/06`'s `G-41` entry anticipated when it named "the Korean half of `P1-T20`". No `.ftl` file was
changed. **Flagged because someone will read 26 warnings as a defect.**

**Thirteen mutants, every one caught**, including the two that matter most for a document nothing
type-checks: removing `registerRoot`, and putting `width="880"` back on the window element. Note why
the mutants carry so much weight here — `tsconfig.json` **excludes `addon`**, so none of the three
delivered files is type-checked at all, and `skipLibCheck` is irrelevant because these are not
declaration files. The new unit spec reads the shipped files off disk and evaluates the script against
a hand-built fake document, which is the only way to reach a classic chrome script with no exports.

**A test file was added outside `Files`, and the reason is `plan/README.md` §6.** The card names no
test file and gives no reason in `Notes`, which §4 requires. Everything the new spec asserts is about
the three files this card creates, so the gap is in the list rather than in the work.

**Five corpus problems found, four of them latent traps for the next card.** (a) `src/i18n/keys.ts`
types the year-span message's `from` and `to` as **`number`**, which is exactly what produced
`2,024 – 2,026`; the same mistake sits in the empty-state message that `P1-T22` will populate next.
(b) The English bundle's own attribute table maps "XUL label caption" to `.value`, but four of its
messages are bare values that a `<label>` cannot render, and it has no row for a window title at all.
(c) The card's `Do` step 1 names the localization link as `searchDialog.ftl`; the registered resource
is **`research-helper-searchDialog.ftl`**, flat and prefixed, because Zotero 10 drops directory
entries — taken literally the card's phrasing yields a link that resolves to nothing. (d) §4.2's
target-collection row and §4.5's wireframe describe **different controls**, and the agent built both
rather than guessing. (e) `docs/07` §8.5 declares **no preference** for the duplicate policy while
§4.5's wireframe shows one radio pre-selected, so the wireframe is the sole authority for that default
and the agent recorded it in exactly one place.

**One precision point about the hand-out, in the agent's favour.** The brief said `P1-T09` "is blocked
behind a human gate — the owner has not supplied the … key that `P1-T06` needs", which named the right
card; the agent noted that `P1-T09`'s own `Human gate` cell reads `none` and the block is transitive
through `Depends on`. The conclusion is unchanged and the precision is worth keeping, because "this
card has a gate" and "this card waits on a gated card" need different answers from an owner.

---

### P1-T21 — Result table, selection and filtering

| Field | Value |
|---|---|
| **ID** | `P1-T21` |
| **State** | `DONE` — approved 2026-10-07; selection is keyed on a **stable row key over the whole fetched set**, never an index, with a duplicate host key falling back to an ordinal because two rows sharing a checkbox would turn "exactly 35" into 34. Filtering writes nothing to the selection, commands act on visible rows only, and every count plus the list Import receives is selection ∩ visible. **The defect the hand-out warned about got past the card's own first test pass** — an over-reaching command leaves the *visible* count exactly right, and the pure-logic tests cannot see a wrong argument at the DOM call site. **A tightened assertion then failed on unmutated code**, finding a class the row builder sets with no rule behind it. Two defects only a live window could show. Honest about the dark theme, Tab traversal and screen reader being unchecked — and **a dimming colour was deliberately removed** rather than added, because dimming a data row would risk its contrast for decoration. **Found the hole `P1-T22` must close: the empty-state message interpolates the query verbatim.** |
| **Depends on** | `P1-T20` |
| **Blocks** | `P1-T22`, `P1-T43` |
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
- modify `test/unit/ui/searchDialog.test.ts`

> **Row added 2026-10-07, after the executing agent reported it as outside the list.** The
> selection model is pure logic whose counts are readable in isolation, which is exactly where a
> filter-versus-selection defect hides and exactly what a live window cannot isolate — and **two
> of this card's mutants were caught only there**. 29 tests added. Same gap `P1-T20` reported for
> that file's existence, so the gap is in the list rather than in the work.

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
      exactly 35 items (FR-5) — **the window half only; the item-creation half is `P1-T22`'s.**
      > **Split 2026-10-07 after the executing agent reported it under rule 6.** Nothing imports
      > yet: the import entry point belongs to `P1-T22` and no host publishes it at runtime, so
      > "creates exactly 35 items" is unreachable here. Verified instead, in a live window: the
      > request handed to the import entry point carries **exactly the right 35 records**, and the
      > collected list is selection intersected with visible. **The item-creation half must be
      > re-checked under `P1-T22`.** The same applies to this card's cancel criterion, whose
      > "after a search" is vacuous while zero sources are registered — what is non-vacuous is
      > that a full table session produced **zero** notifier events and the script names no
      > database, item or collection surface at all.
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

**Findings, 2026-10-07 — the table ships, and the selection defect this card was warned about got past
its own first test pass before being caught.** Verified independently: **1,194 unit tests in 27 files**
and **82 integration tests** (up from 67, all fifteen this card's), typecheck 0, `lint:check` 0.

**The selection model is the substance of this card and it is keyed correctly.** Selection is held on a
**stable row key over the whole fetched set** — never an index, never a subset of the visible rows — with
the host's work key preferred and an arrival ordinal as the fallback, including when the host hands back
a **duplicate** key, because two rows sharing one key would share a checkbox and "exactly 35" would
quietly become 34. Three consequences, all asserted: changing the filter **writes nothing** to the
selection; the four selection commands act on the **visible** rows only; and every count the user reads,
plus the list Import receives, is selection intersected with visible — **so what the table shows and
what Import does are the same set by construction.**

**The assertion that pins it is the one worth copying.** Forty arrive selected, five are unchecked to
make 35, the filter narrows to three rows, then "select none" runs — and the count must be **32**. That
number is reachable only if the command touched the visible rows and nothing else: a selection held as
indices into the visible list would have cleared three *different* rows, and a command applied to the
whole set would have left zero. **A single number that distinguishes three implementations.**

**Two mutants genuinely survived the first test pass, and they were the exact class the hand-out named.**
Pointing a selection command at the fetched set instead of the visible set broke **nothing**, because the
unit tests exercised the commands only on an **unfiltered** table where the two sets are identical — and
an over-reaching command leaves the *visible* count exactly right, so the damage is invisible until the
filter is cleared. The pure-logic tests could not catch it at all, since they pass explicit keys and a
wrong argument at the DOM call site is outside their reach. A new test filters, runs all four commands,
clears the filter and checks the hidden rows. **The warning was given, the agent built the right model,
and the test to prove it still had to be found by mutation** — which is the honest shape of this kind of
defect.

**The same false-pass trap caught this card as caught another today, and here it was closed
structurally.** A non-existent reporter name made every mutation run die at startup, so **all nineteen
read as caught**. Beyond fixing the flag, the harness now asserts an explicit passing-test count, so an
infrastructure failure can never again be mistaken for a caught mutant. **Two independent agents hit the
same trap on the same day; one of them also had its scratchpad file overwritten by the other.** Both are
now recorded project facts rather than folklore.

**A tightened assertion found a real defect on the clean tree.** A mutation that renamed a stylesheet
rule survived because the test used a substring check, and a renamed selector still *contains* the
original name. Tightened to a selector-boundary pattern — which immediately failed on the **unmutated**
code: a class the row builder sets had **no rule behind it at all**. Fixed by moving the hover rule onto
that class. **A loose assertion was hiding a live gap, and sharpening it was what surfaced it.**

**Two defects only a real window could show.** The Import button read "Import 40 items" with **35**
selected: message formatting is asynchronous and every selection change starts a new request, so an
earlier one resolved last and overwrote the later. Fixed with an out-of-order guard and pinned by a test
that resolves two requests in reverse deliberately. And the agent's first integration assertion — that no
module loader is present in the window — was simply **wrong**: the window loads a Zotero script that
installs one. The assertion now records the fact and asserts the right thing, and the correction carries
a useful by-product: the hazard a later virtualised-table adoption would face is **already satisfied** in
this window.

**The column captions are deliberately not marked up for translation, and the reason is `P1-T20`'s
measured defect.** The bundle supplies each column as an attribute-shaped message, and a plain table cell
renders its text content and ignores that attribute — so a translation marker there would set something
nothing draws. They are resolved in script instead, by the same technique and for the same reason as the
window title. **Recognising that the previous card's trap applies to a different element is the kind of
transfer that does not happen by itself.**

**Two criteria cannot pass as written, and both were reported rather than adjusted.** "Importing creates
exactly 35 items" — **nothing imports yet**; the import entry point belongs to the next card and no host
publishes it at runtime, so what is verified is the window's half: the request handed over carries
exactly the right 35 records. And "cancel after a search performs zero database writes" is **vacuous
today**, because no search can run with zero registered sources; what is non-vacuous is that a full table
session produced **zero** notifier events and the script names no database, item or collection surface at
all. Both halves must be re-checked under the next card.

**The zero-result case is handled, and the one thing it does not do is explained.** An empty result set
renders an empty table rather than an error, with the count hidden and Import disabled — and it
deliberately does **not** switch to the dedicated empty panel, because that panel's message takes the
query and the year bounds as arguments, which only a finished run knows, so switching without them would
paint a raw placeholder for a frame and log an error. **Left for the next card, and recorded in both the
code and the test** rather than half-built.

**A forward-looking security finding that is specific, verified, and not this card's to fix.** The
table itself is safe: a row is built from the host's record and nothing else, the query controls are read
only to *match* against and never to display, and a 32-character key typed into both boxes appears in no
text node, no attribute and not in the window title — asserted mechanically and in a live window, with a
mutation proving the assertion bites. **But the empty-state message renders the query back to the user
verbatim.** Confirmed by the coordinator: the message interpolates the raw query, and at 32 characters an
access key is **below** the free-text redactor's 40-character threshold that an earlier card measured. So
**the table is safe and the empty state will not be**, the moment the next card populates it. **Needs
raising with that card explicitly.**

**What was not checked, stated plainly.** The **dark theme was not measured** — the previous card did
measure both by forcing the preference, and this card's criteria name no theme or contrast requirement,
so instead every colour in the stylesheet is asserted to come from a Zotero variable. **Tab traversal of
the whole window was not automated**, only the absence of any explicit tab order plus document order.
**No screen reader was used.** And **nobody looked at the window.** Against that, one deliberate
subtraction is worth more than a claim: a row-level dimming colour was **removed** after being written,
because dimming a whole data row to a secondary-text token would put that row's contrast at risk for the
sake of decoration — the marker is a border instead, which no contrast rule governs.

**The author-name cap had to be chosen because the document contradicts itself.** The wireframe draws the
overflow form **twice with different name counts** — three names for eight authors, one name for twelve —
and no rule satisfies both; no section states a cap at all. Three was chosen as the widest drawn row,
recorded in exactly one place with the reasoning, and **reported as a choice rather than presented as the
document's**. Four more clarifications are owed by the corpus: whether the result count describes the
fetched set or the rows on screen, which fields the filter covers, that the accessibility section's grid
role is a statement about a widget this card does not use, and **what "select all" means** — the very
ambiguity that produced this card's two surviving mutants.

**No message identifier was minted.** Every string the table needs already existed; the markup went from
26 to 38 markers and the window now resolves 47 of the bundle's 59. Two genuine gaps were **reported**:
there is **no work-type vocabulary anywhere**, so the type column currently shows a raw internal value,
and there is no message for a filter that matches nothing. Both belong to the localization card and the
Korean gate.

**The installer split was measured, not estimated**, using pristine copies the previous card had left: of
the growth from 76,419 to 111,969 bytes, **11,676 is this card's three window files** and the rest is the
pipeline bundle. The tree was restored and re-verified afterwards.

**A `Files` gap, reported with its reason.** The unit spec for the window was extended by 29 tests and the
card's `Files` does not name it — **and two of the mutants were caught only there**, because the selection
model is pure logic whose counts are readable in isolation, which is exactly where a filter-versus-
selection defect hides and exactly what a live window cannot isolate. Same gap the previous card reported
for that file's existence, so the gap is in the list rather than in the work.

**Declared against itself: one read-only `git status`**, against an instruction to run none. Nothing was
changed, and saying so first is the behaviour to want.

---

### P1-T22 — Wire search, import, progress, cancellation, five states

| Field | Value |
|---|---|
| **ID** | `P1-T22` |
| **State** | `DONE` — approved 2026-10-08; the window drives the real pipeline into a real library, and the empty-state headline is **deliberately unpopulated** because redaction cannot clean a 32-character credential interpolated into a sentence. Two further surfaces were closed unasked. One criterion was reported as unpassable as written rather than adjusted, and the three unrenderable error rows are a named constant — `P1-T37` empties two of them. |
| **Depends on** | `P1-T16`, `P1-T17`, `P1-T21` |
| **Blocks** | `P1-T23`, `P1-T35`, `P1-T36`, `P1-T37`, `P1-T38`, `P1-T39`, `P1-T43` |
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
- Import exactly the set the table shows as picked — **checked ∩ visible**, which is `P1-T21`'s
  shipped selection model.
  > **Corrected 2026-10-07 after the executing agent reported the conflict.** This read "do **not**
  > import from the table's *filtered* view when rows are hidden — import exactly the checked set,
  > or a hidden-but-checked row silently vanishes", i.e. a hidden-but-checked row **should** be
  > imported. **`P1-T21` decided the opposite, deliberately**, with its reasoning in a fenced block
  > and two test files asserting it: what the table shows and what Import does are the same set by
  > construction. **The shipped behaviour was kept**, because importing a row the user explicitly
  > asked to hide is worse than not importing it, and the displayed count then matches the number
  > created. Neither `docs/08` §4.2 nor §4.5 settles it.
  >
  > **The consequence is larger than the wording and is now asserted rather than described:** the
  > shipped default hides already-present rows, a hidden row is never imported, so **the only rows
  > §4.4's duplicate-policy control is about are the hidden ones** — which makes "add existing item
  > to collection" unreachable from the window as shipped. **An owner's decision.**
- Do **not** write the provenance note before the import finishes; its counts
  are outputs of the import (FR-8).

**Done when.**
- [ ] A real search populates the table and the per-database line shows
      `PubMed …… ✓ N results`.
- [ ] Import creates the collection, the items and exactly one provenance note.
- [ ] Cancel during fetching stops within 2 s and creates nothing (FR-10).
- [ ] With the network disconnected, the window shows the `OFFLINE` message and
      its Retry action, not a stack trace (NFR-9, NFR-14).
- [ ] A forced 429 renders the `RATE_LIMIT` row's message, with the code and the status in the
      disclosure — **not a retry countdown.**
      > **Reworded 2026-10-07 after the executing agent reported it under rule 6, for two
      > independent reasons.** First, `docs/07` §5.2's serialized-error projection **drops the
      > thrower's `context`**, where the retry delay lives, so the number does not exist by the time
      > any view sees the failure. Second, **even with it the message would be false**: no retry
      > policy is supplied at the composition root — `P1-T04` and `P1-T05` both declined to invent a
      > per-host cap and `P1-T28` owns it — so the client makes **one** attempt and nothing retries.
      > A countdown would promise a retry that never happens. What ships is NFR-14's first two
      > requirements: *what* failed and *which* service, plus a Retry action. **The three rows that
      > cannot render are declared as a named constant and asserted**, so the gap is something a
      > later card deletes rather than a surprise it discovers.
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

**Findings, 2026-10-07 — a search ran end to end into a real library, and the window still ships inert
because publishing its host needs a file this card may not touch.** Verified independently: **93
integration tests, zero failures** (up from 82), 1,194 unit and 28 contract unchanged, typecheck 0,
`lint:check` 0, installer **121,920 bytes** (from 111,969), exactly the card's four files touched, and
`grep -rn MUTANT` clean.

**The end-to-end run is real and the evidence is in the log.** Real items were created in the **scaffold
test profile's** library and erased afterwards: `cleanup erased 6 item(s) and 2 collection(s)`. The
import summary reads `Imported 3 · Linked 0 · Skipped 0 duplicates · 0 failed` with abstract coverage at
100 %, and a **re-import of four records of which three were already present** reads `Imported 1 ·
Linked 3` — so FR-51's separate reporting works on real data rather than on a stub. Cancellation
measured at **133 ms** against a 2-second requirement, with a notifier spy recording **zero** write
events. Everything was real except the literature sources themselves, and **zero network requests were
made**, because the fixture replay transport imports Node modules the Zotero sandbox does not have — so
the double is a *source* rather than a transport, and the real adapter stays covered by the 28
fixture-backed contract tests.

**The security hole was closed by not building the surface, and the reasoning is the best part of this
card.** The empty-state headline is **not populated at all**. The decisive fact is that **redaction
cannot clean the shape that matters**: an access key is 32 characters and the free-text pattern starts at
40, which `P1-T17` measured — so redacting before interpolating would have produced a panel that still
showed the key **while looking handled**, which the agent correctly calls the worst available outcome. A
sharper rule in the view layer would have been a second redactor in a second place, which the project
forbids. Truncation leaks a prefix. And what is lost is affordable: the headline states only that nothing
was found and what the year range was, and **both are already on screen** — the result count reads
`0 results · 0 new` and the two year controls show the range — while §8.4's actionable half, the
suggestions line, takes no arguments and renders.

**Two more surfaces were closed that nobody had flagged.** The error disclosure carries **`code` and
`httpStatus` only**, because the serialized error's free-text detail is built from the failing request —
the adapter's own failure message is built from a URL — and the free-text redactor misses a
32-character key inside it. And the import collection name is **never derived from the keyword box**,
because a collection name is written to the database and read back for the life of the library. **Both
were found by applying the same reasoning one step further than asked**, and both assertions were proven
to bite: the headline mutant fails with the literal text `expected 'No papers found for
"0123456789abcdef…' to equal ''`.

**The window ships inert, and that was reported rather than worked around.** Verified by the coordinator:
`src/addon.ts:64` still sets `this.api = {}` and nothing writes to it. The run-time graph **does** exist
— `registerUI()` calls `installServices()`, which calls `registerSources()` itself — but `registerUI()`
holds the graph **nowhere**, deliberately and with its own reason recorded there. So publishing the host
is **one line in a file outside this card's `Files`**, and nothing was edited there. What exists instead
is the host object itself, correctly typed, plus a named constant recording the property, plus an
integration spec that installs it — **which is currently the only place the end-to-end path runs.**
**Highest-priority card**: `P1-T23` cannot check its criteria against the product until it lands.

**Two defects found by running the thing rather than reading it, and the first is the kind only a live
window shows.** **The search window was missing a Fluent bundle.** Its markup links one resource, and
**every string this card renders lives in the other one** — the error rows, the source name, the import
summary, the coverage line. The first run rendered **seven surfaces as empty strings**, because a message
identifier whose resource is unlinked resolves to nothing and leaves the element alone. Fixed by adding
the resource at run time rather than editing another card's markup. **Natural experiment: seven failures
without it, zero with it.** And the in-flight per-database list named **every registered adapter rather
than the ones asked**, so a source the user had unchecked showed as searching and then vanished from the
final list.

**A criterion cannot pass, for two independent reasons rather than one.** The rate-limit row's retry
countdown: first, the serialized error projection **drops the thrower's context**, where the retry delay
lives, so the number does not exist by the time any view sees the failure; second, **even with it the
message would be false**, because no retry policy is supplied — one attempt is made and nothing retries.
What ships is what failed and which service, plus a Retry action, with the code and status in the
disclosure. **The three unrenderable rows are declared as a named constant and asserted**, so the gap is
something a later card deletes rather than a surprise it discovers.

**This card's own `Do NOT` contradicts the shipped behaviour of the previous one, and the agent kept the
shipped one and argued for it.** This card says a hidden-but-checked row **should** be imported, or it
"silently vanishes". `P1-T21` decided the opposite deliberately, with its reasoning in a fenced block and
two test files asserting it: what the table shows and what Import does are the same set by construction.
**`P1-T21`'s behaviour was kept**, because importing a row the user explicitly asked to hide is worse
than not importing it, and the displayed count then matches the number created. The `Do NOT`'s phrasing
is corrected above; neither document section settles it.

**And that contradiction has a consequence worth more than the wording.** The shipped default hides
already-present rows, a hidden row is never imported, and so **the only rows the duplicate-policy control
is about are the hidden ones** — which makes "add existing item to collection" unreachable from the
window as shipped. **Asserted rather than described**: the re-import test rebuilds the library index,
checks that three of four rows disappear, and checks that unticking the box brings them back. Owner's
decision. Separately, the duplicate-policy control is **inert**: the choice is collected and dropped,
because the pipeline's target type has no member for it.

**A defect in the card's own mutation harness, found and reported rather than hidden.** Four mutations
produced two *extra* failures each, always the same pair, and the diagnosis was **not** the mutation: a
ten-second cap on waiting for text to render **expired under load**, because nine full suites ran back to
back and individual tests that take under 40 ms in a green run took seconds. Raised to 25 seconds with
the measurement recorded. **"A cap that can expire on a loaded machine turns a green suite into a coin
toss"** is the sentence to keep — it is the same class as the reporter-name trap that cost two other
cards a whole sweep this week.

**A false claim in a source file was corrected in place, and the coordinator traced where it came from.**
The window script's header asserted that the service installer "is called only from a unit test" and
concluded that at run time there is no source registry and no preference store at all. **Both halves are
false and were false when written.** Traced: the claim entered in `P1-T20`'s commit. The
`registerSources` half came from the coordinator's hand-out and was **true at that time**; the installer
half was not in that hand-out, and the coordinator had **already corrected that same claim** when another
agent made it — so the route into the file cannot be pinned down from here, which is itself the point.
**A false premise that reaches a source-file comment outlives the card that wrote it**, and the next
reader inherits it as fact. Now replaced with the grep and the one-line truth.

**What was not checked, stated plainly.** No idle-tick sampler ran during a search, so the responsiveness
requirement is unmeasured here and belongs to the definition-of-done card; record counts were 3–40,
well below the case that would strain it. The new-collection prompt was **never opened**, because it is
modal and would block the run — the picker half is driven through a seam. **Nobody looked at the
window**, and light and dark were not compared. And the completion popup was **never drawn**, because
that needs a second service graph the installer refuses; what is asserted instead is the contract asked
of the factory — the popup requested on completion for every one of eleven jobs, and exactly one
completion call per job carrying the summary.

**One deviation on the per-database line, bounded honestly.** The dot leaders and the tick-and-arrow
glyphs §4.6 draws are not rendered, because the stylesheet that would carry them belongs to another card.
The outcome travels as a data attribute — **which is the selector such a rule would use** — and the
accessibility requirement is met without it, because the words carry the state.

**Needs a card, and the first one blocks the phase.** Publish the window's host by holding the graph and
binding the two platform ports. Then: a query-free headline identifier; carrying a redacted subset of an
error's context so three of the error rows can render at all; the three validation messages, now
reachable from a button press where they were not before; carrying the duplicate-policy choice through to
the writer; resolving the hide-existing conflict; a work-type vocabulary; where the second bundle link
belongs; styling the status list; a preference pane so the Open Preferences action can select one;
per-source import counts; the JSON export action; and **a fixture replay transport usable inside Zotero**,
which would stop all seven Phase 2 sources hand-rolling a double.

**One `Files` gap, the same one the previous card reported.** No unit-test path exists for the new view
model, whose arithmetic — the error table, the selection round-trip, the latching, the per-source
attribution — is exactly what a layer-one test isolates cheaply, and all of it is currently asserted only
through a live window at integration cost. Nothing was added there. **The gap is in the list, not in the
work.**

---

### P1-T23 — Phase 1 definition-of-done run

| Field | Value |
|---|---|
| **ID** | `P1-T23` |
| **State** | `TODO` |
| **Depends on** | `P1-T11`, `P1-T22`, `P1-T28`, `P1-T35`, `P1-T36`, `P1-T45` |
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
| **State** | `DONE` — approved 2026-10-01; the spike mapper is gone, `itemMapper.ts` 729 → 636 lines, and **`P0-T20`'s timings did not move** (stall 79 → 78 ms, no gap over 100 ms, NFR constants byte-identical). Found **four errors in this card's own text**, all the coordinator's, including an importer claim written in from `P1-T12`'s report without being checked against the file. |
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
`create src/zotero/itemMapper.ts`, which reads as "replace the spike". It cannot: **two files import
the spike exports and neither is in `P1-T12`'s `Files`** — `src/zotero/zoteroApi.ts` and
`test/integration/zotero/batchImport.spec.ts`.

**Corrected 2026-10-01, and the error was the coordinator's.** This block originally said *three*
importers and named `test/integration/zotero/itemCreation.spec.ts` as the third. That file imports
`AUTOMATIC_TAG_TYPE` and `RESEARCH_HELPER_TAG` from `itemMapper.ts` — both **shipped** constants
declared in its §1, not spike exports. The claim came from `P1-T12`'s report and was written into
this card **without being checked against the file**, which is precisely the thing every card prompt
asks agents not to do. Two importers is still enough to make the point: `P1-T12` could not do the
retirement, and the card stands. Deleting the surface there would have
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
- [ ] No **import or identifier reference** to `buildJournalArticle`, `JournalArticleRecord`,
      `ArticleCreator` or `toSpikeCreatorJSON` survives in `src` or `test`. **Doc-comment prose that
      records what was retired does not count** — corrected 2026-10-01, because a card whose job is
      to retire a *named* surface cannot record what it retired without naming it, which made the
      original wording unsatisfiable by construction. `src/zotero/collectionOps.ts`'s `@param` doc
      also names `buildJournalArticle()` and that file is **not** in this card's `Files`, so the
      original criterion was not satisfiable by this card at all.
- [ ] Both integration specs pass against a real Zotero, with their timings recorded and `P0-T20`'s
      ≤ 10 s / no-stall-over-100 ms assertions still asserted, not relaxed.
- [ ] The packed XPI contains none of the four spike identifiers.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.**
```bash
# Corrected 2026-10-01: the original grepped all four names, two of which (RESEARCH_HELPER_TAG,
# AUTOMATIC_TAG_TYPE) are SHIPPED constants that must survive — so it could never pass. It also
# counted doc-comment prose. This greps the four spike-only names and excludes comment lines.
grep -rn 'buildJournalArticle\|JournalArticleRecord\|ArticleCreator\|toSpikeCreatorJSON' src test \
  | grep -vE ':[0-9]+: \*|:[0-9]+://' \
  && echo 'FAIL: spike surface still referenced in code' || echo 'OK: spike surface gone from code'
```

**Notes.** `RESEARCH_HELPER_TAG` and `AUTOMATIC_TAG_TYPE` **survive, and there is nothing to move.**

**Corrected 2026-10-01.** This note used to say to "move them to where the shipped code declares them
and delete only the spike's copies". **There were no spike copies.** Both are declared exactly once,
in `itemMapper.ts`'s §1 — the shipped half — at lines 103 and 110 of the pre-retirement file, while
the spike section began at line 630 and *imported* them from there. The shipped `tagsFor()` needs
both. So: delete nothing, move nothing, rename nothing. They are additionally imported by
`test/integration/zotero/itemMapper.spec.ts` and `test/unit/zotero/itemMapper.test.ts`, outside this
card's `Files`, so deletion was never available either.

The criterion's grep is narrowed accordingly — see criterion 1.


**Findings, 2026-10-01 — two of four criteria pass as written, two were unsatisfiable because this
card's own text was wrong, and the errors were mine.** The spike section is deleted;
`src/zotero/itemMapper.ts` went 729 → 636 lines and now contains one mapper. typecheck, lint:check
and the whole unit suite exit 0 (**787 tests**), and the integration suite is at **38 passed** — up
from 33 only because `P1-T29` added five concurrently; **every pass line present before this change is
still present under the same name, and there is nothing to attribute.**

**The retirement itself.** `SPIKE_RECORD: JournalArticleRecord` became `SPIKE_WORK: CanonicalWork`
with the same four values in §5.1's shape, the DOI through `normalizeDoi()` so it is a real `Doi`, and
`provenance.seenIn` **empty on purpose** — that record came from no literature source, so no
`SourceId` honestly belongs there, which is why no `rh-sources` line and no `libraryCatalog` are
written. `newItemFromMapping()` now owns the `new Zotero.Item()` / `fromJSON(json, { strict })` block,
and the separate `addTag()` call is gone: `toZoteroMapping()` already puts `research_helper` at
`AUTOMATIC_TAG_TYPE` into the JSON, so it is **one write instead of two**.

**`P0-T20`'s timings did not move, and the card's own brief misread one number.** Three runs before
and three after, on Zotero 10.0.3: totals 458/391/361 before, 400/364/384 after; mapping 17/16/17 →
19/17/15; longest stall 79 → 78 ms; **gaps over 100 ms: none, in every run**; one DB transaction
throughout. The after-medians sit inside `P0-T20`'s recorded 293–425 ms band. The mapping step costs
about **+0.02 ms/item** for doing the whole of §6.2's table instead of four fields — at or below this
harness's noise floor. `NFR1_CEILING_MS`, `NFR1_TARGET_MS`, `NFR3_TASK_MS`, `CI_MULTIPLIER`,
`ITEM_COUNT`, `RUNS` and the `isAtMost` loop are **byte-identical** to before.

**The 7,379 ms figure quoted in the card brief is not the insert.** The insert is 336–462 ms; the
~7.25 s is the spec deliberately spending `3 × (1000 + 1000) = 6 s` sampling the stall monitor idle
and post-commit, plus three ~0.4 s writes and `Zotero.Items.getAll()` setup. Measured wall was
**7,311 ms before** this change and **7,254 ms after** — slightly faster. Recorded because the brief
invited a regression reading and the agent checked the spec instead of accepting it.

**`P0-T20`'s band is from a different Zotero, and the pre-change baseline already exceeded it.** Its
Findings record 293–425 ms, median 324, stall 77 ms on **10.0.2**. This machine runs **10.0.3**, and
the *untouched spike mapper* measured 361–458, median 391, stall 79 — **the top of the band and the
stall maximum were already past before this card touched anything.** Worth knowing so the next card
does not read these after-numbers as a regression this change introduced.

**Criterion 3 passes as the `Notes` narrow it, and the method matters more than the result.** The
packed XPI (49,558 B, 16 entries) was read by walking the zip central directory **and inflating each
entry**, because a raw `latin1` regex over the archive bytes **cannot see a string inside a deflated
entry** and every code entry here is method 8 — it would have reported "clean" for a file that was
present. Eight needles were scanned, not four: the two spike-only exports, the two tag constants,
plus `ArticleCreator`, `toSpikeCreatorJSON` and the spike's own creator literals, which would survive
a merely renamed export. **Six of eight absent, including all four spike-only ones**; the two hits are
the shipped constants that must ship. With a positive control on the same inflated bundle proving the
scanner can see what is there: `createSpikeArticle` true, `toZoteroItemJSON` true,
`newItemFromMapping` true, `rh-work-key` true, `buildJournalArticle` **false**.

**Four errors in this card's text, all the coordinator's, all now corrected above.** (1) The "Why
this is a card" block said **three** importers and named `itemCreation.spec.ts` as the third; that
file imports `AUTOMATIC_TAG_TYPE` and `RESEARCH_HELPER_TAG` — **shipped** constants from §1 — and the
claim came from `P1-T12`'s report and was written into the card **without being checked against the
file.** Verified: the two constants sit at lines 103 and 110, the spike section began at 630. (2) The
`Notes` told the card to "delete only the spike's copies" of those constants; **there were no copies**
— the spike imported them from §1. (3) Criterion 1 and (4) the `Verify with` both grepped all four
names, **two of which must ship**, so neither could ever pass; and both counted doc-comment prose,
which a card whose job is to retire a *named* surface cannot avoid producing. One of the surviving
prose hits is in `src/zotero/collectionOps.ts`, **outside this card's `Files`**, so the original
criterion was not satisfiable by this card at all.

**An assertion in `batchImport.spec.ts` was narrowed rather than weakened, and it is flagged against
the card's own `Do NOT`.** The spec asserted `item.getField("extra") === ""`, true **only** because
`P0-T10`'s mapper wrote no `extra`. The shipped mapper **cannot** produce an empty `extra` — §6.3
makes `rh-work-key` mandatory and first. So "each call site needs a minimal fixture rather than a
renamed import" was not sufficient; one call site needed an assertion change. There are now **two**
assertions where there was one: `readWorkKey(extra)` equals the item's own `workKey`, **and** `extra`
equals `"rh-work-key: <workKey>"` exactly. That is strictly stronger against the shipped mapper than
`=== ""` was: it still fails on any stray line, and it additionally pins each item's `extra` to *its
own* key rather than merely to emptiness, with a guard so neither can pass on `undefined === undefined`.

**Also found: `P0-T34`'s own `Verify with` was wrong twice and was never the command its Findings
used.** It globbed `build/*.xpi` — **there is no `build/`** — and used the `latin1` method that cannot
see into a deflated entry. Corrected in that card, because the next reader would have run it, seen
"clean", and believed it.

**Reported, not absorbed.** `src/zotero/collectionOps.ts`'s `@param` still documents
`saveNewItemsToCollection`'s argument as "e.g. from `buildJournalArticle()`", a dangling reference to
a function that no longer exists — that file is `P1-T14`'s, in flight. `newItemFromMapping()` sits in
`zoteroApi.ts` only because this card's `Files` allowed nowhere else; **`src/zotero/importer.ts`
(`P1-T14`) is its long-term home.** And `logFieldSupport()` still feature-detects only the spike's
three fields while the shipped mapper writes the whole of §6.2's table through the same `fromJSON`;
purely diagnostic, so left alone, but a schema bump moving `accessDate` would now produce a less
useful log line than it should.
---

### P1-T25 — Composition root: construct the HTTP client, limiters and progress reporter

| Field | Value |
|---|---|
| **ID** | `P1-T25` |
| **State** | `DONE` — approved 2026-10-01; one construction site, 15 tests, and the integration lifecycle spec confirms the **real `registerObserver`/`unregisterObserver` pair** through the whole graph. An assertion it wrote itself **failed and was reported rather than weakened**: `dispose()` does not latch the reporter tree. Surfaced the consequence `P1-T31` now owns — **one app-scoped reporter can report exactly one job per plugin lifetime** — and the `P1-T16`/`P1-T19` ordering inversions. |
| **Depends on** | `P1-T04`, `P1-T05`, `P1-T15` |
| **Blocks** | `P1-T16`, `P1-T19`, `P1-T31`, `P1-T32` |
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
| **State** | `DONE` — approved 2026-10-05; one `Retry-After` parser, and `reconfigure()` driven by the headers hosts actually send — **including a 429's**, since the response that says most about a host's limits is the one that refused you. **Adoption is tighten-only, and the reasoning is the card's best part**: §7.3's NCBI rates sit deliberately *below* NCBI's documented 3/s and 10/s for clock-skew headroom, and the live `X-Ratelimit-Limit` is exactly the 3 the table stays under, so adopting it upwards would spend that headroom and let a response header overrule §7.3 as rule 4's authority. OpenAlex's measured `X-RateLimit-Limit: 1000` is a **daily** budget — what a per-second reading of an interval-less header gets wrong by three orders of magnitude. 833 unit tests; ten mutants, one of which survived first and exposed a test that proved nothing. |
| **Depends on** | `P1-T04`, `P1-T05` |
| **Blocks** | `P2-T21`, `P2-T23` |
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

**Findings, 2026-10-02 — all four criteria pass. One parser, and the limiter now reads the headers
the hosts actually send, but only ever *downwards*.** `parseRetryAfterMs` is gone;
`backoff.ts`'s `parseRetryAfter` is the one parser, which is the better home because it already owns
the jitter and the budget. A new `adoptLimits()` runs in `issueAndClassify` **after logging and
before `classify`**, so a 429's headers are read too — the response that says most about a host's
limits is the one that refused you — and `penalize` is still the last word. Verified independently of
the report: **833 unit tests in 21 files** (up from 816), typecheck 0, `lint:check` 0, and **63
integration tests, exit 0**. Exactly the four files in `Files`.

**The load-bearing deviation: advertised limits are adopted only downwards, and the reasoning is
better than the card's own framing.** `docs/07` §7.3's Crossref cell reads as though a generous header
should also *raise* the rate from the "start at 2/interval" default. That half was deliberately not
implemented, because §7.3's NCBI basis says in as many words that 2.5/s and 8/s "sit below both for
clock-skew headroom" against NCBI's documented 3/s and 10/s — and `docs/02` §3.1's **live header is
`X-Ratelimit-Limit: 3`, exactly the figure the table deliberately stays under.** Adopting it would
spend the headroom whose stated purpose is avoiding §3.1's "may result in an IP address being
blocked". Taking the smaller of two measured numbers invents nothing, so rule 4 is satisfied in both
directions; raising the rate above §7.3 on the strength of a header would make a response header
overrule §7.3 as rule 4's authority, which **no card authorises**. The upward half needs its own
decision and is listed below.

**The header case trap was real but the diagnosis was sharper than the trap.** `HttpResponse.header()`
is case-insensitive on **both** sides — `client.ts` stores `line.slice(0, colon).trim().toLowerCase()`
(line 883) and looks up `byName.get(name.toLowerCase())` (line 895), both verified. But the two hosts'
names differ by **more than case**: NCBI's is `X-Ratelimit-Limit` with **no hyphen inside
`Ratelimit`**, Crossref's is `x-rate-limit-limit` with one. A single name would have missed one host
*regardless* of case handling, so `ADVERTISED_RATE_LIMIT_HEADERS` holds both and tries them in order.
Proven by breaking the **storage** side rather than the lookup: that mutation makes the NCBI path a
silent no-op and is caught as `expected 2.5 to be 1`.

**`docs/02` spells NCBI's one header three different ways, and that is what makes a case-sensitive
reader look correct on inspection.** Verified line by line: `X-RateLimit-Limit` (lines 101 and 283),
`X-Rate-Limit-Limit` (line 227's code comment, borrowing Crossref's hyphenation), and
`X-Ratelimit-Limit` (line 280 — **the verified raw response**, which is the measurement and should
win). Harmless in practice given case-insensitive lookup on both sides; dangerous to a reader
transcribing by eye.

**`X-RateLimit-Remaining` drives nothing, deliberately, and the reasoning is recorded at the
parser.** It is a remaining count against a window **NCBI never states**; converting it to a rate
means inventing the window, which rule 4 and the card's `Do NOT` forbid. It is also redundant — a
remaining budget is exactly what `TokenBucket` models from a rate we are allowed to know, and
`RateLimiterStats.available` reports it. The one thing it says that a rate does not is `Remaining: 0`,
and the host answers that case with a 429 and a `Retry-After`, which `penalize()` already honours with
a deadline the server actually sent. Asserted (`parseAdvertisedLimits` over `X-Ratelimit-Remaining: 2`
is `{}`) and proven by a mutant.

**A third measurement changed the design, and it is the strongest argument for tighten-only.**
`docs/02` §9.1's verified OpenAlex response carries `X-RateLimit-Limit: 1000` where the 1000 is a
**daily** budget. The one assumption in the parser — absent interval ⇒ one second — would read it as
1000/s, three orders of magnitude too generous. D2 keeps OpenAlex out of v1 so `limiterFor` never
hands it a response, but every error that assumption can make is in the "too generous" direction, and
too generous is exactly what tighten-only discards. **One refinement to that argument, measured here
rather than in the report:** the same response does carry `X-RateLimit-Reset: 58798`, so for OpenAlex
the window *is* discoverable (≈16 h, consistent with a daily budget) — the window is unstated for
**NCBI**, not universally. The conclusion stands and is in fact strengthened: a reader that assumed
one second would be wrong on a host whose real window was sitting in the next header.

**The `resize()` interaction, settled precisely: not reachable in Phase 1, for two independent
verified reasons.** NCBI's measured response (`docs/02` §3.1, lines ~277–284) carries **no**
`x-concurrency-limit` at all, so `parseAdvertisedLimits` returns no `maxConcurrent` for the only host
Phase 1 reaches over the network; and even if it did, NCBI's row is `maxConcurrent: 3` in both key
modes, so a tighten-only adoption from an advertised 3 is a no-op. **It becomes reachable the moment
Phase 2 registers `api.crossref.org`**, where `docs/02` §5.1 measures `x-concurrency-limit: 3` polite
and **1** public against a §7.3 row of 3 — one pool demotion away. `reconfigure` records the new cap
in `wantedConcurrency` but `applyWantedConcurrency` refuses to swap a busy gate, so under continuous
traffic the old cap of 3 stays in force until a gap appears. **Two facts bound the severity and
belong in the card that fixes it:** because adoption is tighten-only the deferral can only leave the
cap *too high*, never raise a cap behind a permit holder's back — so `Semaphore`'s recorded invariant
is never at risk, only its promptness — and `run()`'s `finally` already calls
`applyWantedConcurrency()` on **every** release, so the change lands at the first idle instant rather
than at the next `reconfigure`.

**Criterion 1 failed first and was fixed rather than reinterpreted.** The first implementation left
the dead identifier in two *prose* comments, so `grep -rn 'parseRetryAfterMs' src test` returned two
hits. The criterion says "returns nothing" and it was taken literally: both comments were reworded to
describe the deleted copy without spelling it, and each now records that the absence is deliberate
*because* of this criterion. Re-verified here: the grep exits 1 with no output.

**Criterion 3 was made to fail without the call, and then made to carry the criterion alone.**
Measured over a **real `TokenBucket`** on a manual clock rather than a spy: 10/s burst 1, response
advertises `x-rate-limit-limit: 1` + `x-rate-limit-interval: 1s`, so the next token is 100 ms away at
the configured rate and 1000 ms away at the adopted one. The test asserts the second request is **not**
on the wire at +100 ms, then steps the clock 1 ms at a time and asserts it goes out at exactly
+1000 ms. With `adoptLimits` removed it fails at the +100 ms line, and that was confirmed with the
`currentConfig` assertion **also** removed — so the timing assertion alone is load-bearing.

**Ten mutants, and the one worth reading is the one that survived.** A "no-op for a limiter that
publishes no config" test **passed with the guard gone**, because the invented default happened not to
be tightened by the header in play — a test that proved nothing, found by mutation rather than by
review. It was rewritten to cover both halves of the seam separately: a limiter with `reconfigure`
but no `currentConfig` must produce **zero calls**, *counted* rather than inferred from a return
value, and one with `currentConfig` but no `reconfigure` must return `undefined` without throwing. The
mutant then fails on the second half. Also caught: reinstating the bare `Date.parse` guard at the call
site fails all four malformed-`Retry-After` cases with `expected +0 to be undefined` — **"retry
immediately", the exact defect the card names, reproduced on demand.** `grep -rn MUTANT src test`
re-verified clean here.

**`RateLimiterPort` gained two *optional* members and the composition root did not change.**
`currentConfig` and `reconfigure` are optional — unlike `P1-T27`'s required `run` — because §7.3's
table stays the floor when a host advertises nothing, and a stub that only paces must keep compiling.
`TokenBucket` already supplies both, so `container.ts`'s existing `limiterFor` wires the feature with
no edit, which is why **no file outside `Files` was needed**. The header→policy mapping went into
`hostLimiter.ts`, §7.3's policy module and by its own header "the only place in the product where a
rate number may appear"; the card's step 1 already spends the `core/http` → `core/rateLimit` boundary,
and nothing under `core/rateLimit/` imports `core/http/` (grepped), so no cycle and no new module in
the bundle. One statement this card made false was corrected in place: `client.ts`'s claim that
"`core/http` does not have to compile against `core/rateLimit` to be tested" — now does, by step 1.

**`docs/07` §7.3's Crossref cell is now confirmed wrong from both sides.** `P1-T27` found that the
cell cannot express its own row; this card measured the same mismatch from the *headers* — the cell
says "10 requests/interval, 3 concurrent (public pool is 5/1)" while the verified
`x-rate-limit-limit` is **3** polite and **1** public, because those are the list-endpoint figures and
the parenthetical is the single-DOI one. The cell also now **overstates what `reconfigure()` does**:
"called from those headers on every response" is true as of this card, but beside "start at
2/interval" it implies the header also raises the rate, which this implementation deliberately does
not. `docs/07` is outside this card's `Files`, so nothing was changed there and a doc amendment is
owed.

**No doc code block failed to compile where the doc puts it** — the first card in a while to be able
to say that. §4.1's `RateLimiter`, §7.3's `TokenBucket` skeleton and §7.4's option set were all read
and all match the shipped code.

**An operational fact measured during this verification and recorded nowhere in the corpus.** The
first integration re-run **exited 1 having run no tests at all**:
`EBUSY: resource busy or locked, unlink '.scaffold\test\profile\cert9.db'`. The cause is that
`zotero-plugin test --exit-on-finish` **leaves the test-profile Zotero running after the run
completes** — ten processes were still alive, the parent on
`-profile .scaffold\test\profile --dataDir .scaffold\test\data no-remote` — so the next run cannot
clean the profile. Recovery is to terminate that instance, identified **by its command line** and not
by name, because the user's own Zotero runs the same binary. `docs/13` documents the flag and says
nothing about this; the failure is silent about its real cause and looks like a test failure.
**Needs a doc line, and it is a trap for CI and for the next agent.**

---

### P1-T27 — Give the concurrency cap an owner, or remove it from the interface

| Field | Value |
|---|---|
| **ID** | `P1-T27` |
| **State** | `DONE` — approved 2026-10-02; `maxConcurrent` is enforced by a new `run<T>()` holding a `Semaphore` permit for the call's lifetime, because **the missing thing was never a counter, it was a scope — an end.** `acquire` stays rate-only and ungated, which is what makes the deadlock unreachable. The slot-before-token ordering was **proven, not argued**: flipping it produced two consecutive starts 1,000 ms apart under `minIntervalMs: 3000`. Criterion 3 measures the reporting rather than the cap, so sibling assertions were added, not the criterion adjusted. The Crossref 3 → 1 concurrency gap is recorded, not hidden. |
| **Depends on** | `P1-T04`, `P1-T05` |
| **Blocks** | `P2-T05`, `P2-T21` |
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
- `docs/02` **§7** for arXiv's published limit — *1 request per 3 seconds, single connection at a
  time*, and the "all of the machines under your control" quote. **Corrected 2026-10-01: this said
  §5, which is Crossref.** Note §7.3's Crossref "max concurrent: 3" cell is the **polite-pool**
  figure only; `docs/02` §5.1's verified table gives the public pool **1**, so that one cell cannot
  express the row — Phase 2's Crossref card inherits it.

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

**Findings, 2026-10-01 — all five criteria pass. Shape 1 chosen: `run<T>(fn, cost?, token?)` on
`RateLimiter`, holding a `Semaphore` permit for the call's lifetime.** `maxConcurrent` now works, and
it works where the config declares it. typecheck, lint:check and the whole suite exit 0 — **802 unit
tests, up from 787, in the same 21 files**.

**The insight that decided the shape: the missing thing was never a counter, it was a *scope* — an
end.** `acquire` resolves `void`, so it has no end; `run` does, and its `finally` is the whole
enforcement. `gate` is `src/core/concurrency.ts`'s existing `Semaphore`, so no second one was
written, and `stats.inFlight` is `gate.permits - gate.available` — a real number at last.

**`acquire` and `tryAcquire` stay rate-only and ungated, and that is what makes the deadlock
unreachable.** A bare `acquire` neither takes a slot nor counts toward `inFlight`, because it has no
end. §4.1's `acquire` contract is unchanged, so the three cards already built against it are
untouched.

**One sub-decision is load-bearing and was proven, not argued: the slot is taken *before* the
token.** The other order takes a token while the caller is still queued behind the cap, so
`minIntervalMs` — §4.1's "minimum spacing between request **starts**" — would be measured from an
instant at which nothing started. **Flipping the implementation to token-first failed two tests**, and
one of them reported `starts = [t0, t0+5000, t0+6000]` against the expected `[t0, t0+5000, t0+8000]`
— **two consecutive request starts 1,000 ms apart under `minIntervalMs: 3000`.** So the rejected
ordering is a live `minIntervalMs` violation rather than an aesthetic preference, and it matters for
exactly the host that has both: `export.arxiv.org`, `maxConcurrent: 1` *and* `minIntervalMs: 3000`.

**That falsification test did not falsify on its first attempt, and the agent caught it.** With a
single `clock.advance(5000)` jump both orderings coincide, because `take()` stamps `lastStartMs` at
the jumped-to reading rather than at the deadline. Rewritten to advance a millisecond at a time, with
the reason recorded in the test. **Worth knowing generally: a `ManualClock` jump can hide a
`lastStartMs` divergence** — the same class of blind spot as `P1-T03`'s line-anchored `prefs.js`
parser.

**Shape 2 was rejected on four measured costs, all recorded in §4.1.** It would have needed **a
second host→gate map** beside the registry, duplicating §7.3's one-bucket-per-host rule under another
name, because the client holds no per-host state. It would not have known the number: §4.1 exposes
**no reader for the config in force**, so the cap would have to be injected separately from the
`policyFor(host)` row that already carries it. Its gate would sit **outside** the token queue, giving
the limiter a token to a caller the client was still holding back — the same `minIntervalMs` defect,
relocated. And the cap would bind only `HttpClient.request` callers, so **the streaming path would
escape it silently.** Against that, shape 1's advertised cost — "changes an interface three cards
implement against" — **did not materialise, and that was checked before the signature changed**:
adding a method breaks implementers, not consumers, and there is exactly one implementer.

**A limitation recorded rather than hidden, and it is a real Phase 2 gap.** `Semaphore`'s permit count
is fixed at construction — deliberately, because resizing from outside is exactly the "hand out or
revoke a permit behind a holder's back" its recorded invariant forbids. So `reconfigure()` adopts a
changed `maxConcurrent` only when the host **next goes idle**; rate, burst and spacing still change
immediately. Phase 1 never reaches it (NCBI is `maxConcurrent: 3` in both key modes, asserted). But
`docs/02` §5.1 **measures** Crossref at `x-concurrency-limit: 3` polite and **1** public, verified
live, and §7.3 says `reconfigure()` is called from those headers on every response — so a live 3 → 1
change is a measured scenario in which **the cap could be exceeded for as long as Crossref traffic is
continuous.** The fix is a `resize()` on `Semaphore`, outside this card's `Files`. **Needs a card, and
it should gate or be depended on by whichever Phase 2 card adds the Crossref row.**

**Every new assertion was checked by breaking the implementation, not only by passing.** Reverting the
client to a bare `acquire` failed all three new HTTP tests, confirming they measure the `run` span and
not a stub. Criterion 2's "a cancelled one does too" does not say *when* cancelled, so all three
moments are covered as separate code paths — cancelled while holding a slot and parked on tokens (the
case the slot-first ordering creates), cancelled while the call runs, and an already-cancelled token
which **rejects** rather than throwing synchronously. Plus an impossible `cost` rejecting `RangeError`
**and giving the slot back**, proven by a following `run` that starts.

**Criterion 3 is weaker than it looks, and sibling assertions were added rather than the criterion
adjusted.** "`stats.inFlight` is non-zero while a request is in flight and returns to 0 after" is
satisfied by a counter incremented in `run` and decremented in `finally` **with no gating whatsoever**
— it measures the *reporting*, not the *cap*. And criterion 1 at only two calls with
`maxConcurrent: 1` is exactly the naive test this card's brief warned about. So: **five** calls at
`maxConcurrent: 2`, asserting after every single release that the admitted count went up by **exactly
one** — never two, never zero — and that `inFlight` tracks `min(2, remaining)`. A counter nothing
decrements deadlocks there; a double-release over-admits there. The two-call test catches neither.

**Two files outside `Files` were extended under §4's corrected rule, and the grep came first.**
`test/unit/core/http-client.test.ts` had to gain `run` on its stub limiter and its `paced` literal,
because `RateLimiterPort` gained a **required** member. Making `run` *optional* was considered and
rejected: an optional `run` means a limiter can be injected that paces rate and **silently ignores the
cap** — this card's defect one layer down. And `hostLimiter.ts`'s `policyFor` doc read "including the
`maxConcurrent` the bucket cannot enforce", which this change made actively false **in the module that
owns the policy table**; corrected in one line. The grep is how the test-file breakage was found
rather than discovered by a red run, and it confirmed **no importer blocked the signature change**.

**The integration suite was not run, and the reason is sound.** `grep` over `test/integration/`
returns nothing for `limiterFor`, `RateLimiter`, `TokenBucket`, `installServices`, `httpRequest` or
`http/client`, so no integration spec imports either changed module, and the card's `Verify with` does
not include it. `npm run build` was run instead to prove the changed sources still bundle. **So the
51-test integration baseline is unverified by this card** — stated plainly rather than implied.

**Two errors in this card's text, both the coordinator's, both corrected.** The `Read first` cited
"`docs/02` §5 for arXiv's published limit"; **§5 is Crossref and arXiv is §7** (verified: §5 at line
929, §7 at 1395). And `P1-T04`'s `Retry-After` blockquote had been written **inside** §4.1's
TypeScript code fence, so the fence was not valid TypeScript — this card placed its own decision
block *outside* the fence rather than copying the pattern, and did not touch the other (rule 2).
The blockquote is now
`//` comments and **no markdown blockquote survives inside any `ts` fence in `docs/07`**, checked
mechanically.

**One more pre-existing defect flagged and left alone:** `src/core/concurrency.ts`'s header says
"What consumes them: `docs/07` §7.2's three worker pools", and `Semaphore` now also backs §7.3's
per-host cap. Not false, just incomplete, and the file is outside this card's `Files`.

---

### P1-T28 — Settle §7.3's retry numbers, and wire them

| Field | Value |
|---|---|
| **ID** | `P1-T28` |
| **State** | `DONE` — approved 2026-10-07; `base` 1000 ms, `cap` 30 000 ms and an attempt cap of 3 are in §7.3's table **with a named source each**, and on the shipped NCBI row. **The test parses §7.3 out of the document and compares it against the row the registry serves**, so editing either side fails — changing the document from 1000 to 1200 ms fails the test. **That is the first test in this repository to read an authority document**, and the pattern the card told the agent to copy did not exist. Criterion 3 asserts the transport count is **exactly 3**, not "more than 1", so the retries-versus-attempts off-by-one fails it. Reported rather than absorbed: the numbers are **not yet in effect**, because `retryFor` is still unsupplied at the composition root, which is outside this card's `Files`. |
| **Depends on** | `P1-T05` |
| **Blocks** | `P1-T23` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | **Yes — satisfied 2026-10-07.** The owner supplied `base` 1000 ms, `cap` 30 000 ms and an attempt cap of 3; an agent may not invent them (`plan/README.md` §5 rule 4), and the reasoning behind each is recorded under `Do` step 1. |

**Goal.** The retry policy has numbers, they live in one place, and `P1-T05`'s injected budget is
actually populated.

**Why this is a card.** Measured 2026-09-30 (`P1-T04`, `P1-T05`): `docs/02` §2.4 and `docs/05` §9.5
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
  shape `min(cap, random(base, prev*3))`. **`docs/05` §9.5 explicitly forbids a second shape.**
  > **Section number corrected 2026-10-07.** Every citation of this rule in the corpus said §9.4,
  > which is "Concurrency shape"; the authority note is in **§9.5 "Backoff and degradation"**. The
  > executing agent found **eight** wrong citations — three in `src/core/rateLimit/backoff.ts`, four
  > elsewhere in this file, and one in the hand-out prompt. Three of the eight were in this card.
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

> **The owner supplied the three numbers on 2026-10-07, so `Do` step 1's "stop and ask" is
> discharged. `base` = **1000 ms**, `cap` = **30 000 ms**, per-host attempt cap = **3**, for
> `eutils.ncbi.nlm.nih.gov`.** The reasoning was put to the owner with the evidence and is recorded
> here so step 2 can name a source for each value:
>
> - **`base` = 1000 ms.** The shipped no-key pacing for this host is 2.5 requests per second, i.e.
>   400 ms between request *starts*, so a first backoff shorter than the pacing interval cannot
>   change anything. 1000 ms is the smallest round value comfortably above it.
>   **This coincides with `docs/03` §11.6's LLM `baseMs` and was not taken from it** — the `Do NOT`
>   forbids borrowing those numbers and the derivation above is independent. The coincidence is
>   recorded rather than hidden, because the next reader will notice it.
> - **`cap` = 30 000 ms.** `P1-T26` **honours** `Retry-After: 120` as an absolute deadline
>   (**corrected 2026-10-07: the coordinator wrote "measured", and 120 is a *test fixture* in
>   `P1-T26`'s own criterion, not an observation. Grepping every `Retry-After` mention in `docs/` and
>   `plan/`, no host has ever been recorded sending the header at all — `docs/02` §7.1 records arXiv's
>   429 explicitly *without* one. The reasoning survives: 120 000 ms is the largest delay the shipped
>   code is *specified* to honour, and §8.5's 60-second `timeoutSeconds` is a second anchor**)
>   when a server sends one, and these three numbers apply **only** when none is sent. Letting the
>   silent case wait as long as the loudest measured explicit case would make a user sit in front
>   of the Search window for two minutes with nothing said. 30 s also means the cap does not bind
>   at an attempt cap of 3 (**corrected 2026-10-07: this read "the third wait tops out near 9 s",
>   and at a cap of 3 there is no third wait — there are two, topping out at 1 s and 3 s**), so it is
>   a guard against a later
>   raise of the attempt cap rather than a value the shipped path reaches.
> - **Attempt cap = 3.** Worst case **4 s** of waiting before the job fails and §7.3's
>   "Retry later" is offered — tolerable inside an interactive search. Five attempts reach ≈ 2 min,
>   which is not. The decisive evidence is `P0-T21`'s arXiv measurement: **7 of 7 requests over
>   ~14 minutes returned 429 with no `Retry-After`**, some taking up to 46 s merely to fail, while
>   the 3-second rule was obeyed — a limit that may key on this network's shared address. **Where a
>   limit is not per-request, more attempts buy nothing and cost the user the wait.** That argument
>   is about arXiv rather than NCBI, so step 2 should name it as the shape of the reasoning and not
>   as a measurement of this host.
>
> **Arithmetic corrected 2026-10-07, before the card was handed out.** The reasoning above first
> read "worst case 1 + 3 + 9 ≈ 13 s", which assumed **three** waits. `RetryBudget.maxAttempts` is
> counted as **total attempts including the first**, so a budget of 3 allows **2** retries and
> therefore two waits: `min(cap, max(base, prev * 3))` gives 1 s then 3 s, i.e. **4 s** worst case.
> Computed from `withRetry` (`src/core/http/retry.ts`), which seeds `previousDelayMs = 0`, so
> `decorrelatedJitter` collapses to exactly `base` on the first wait. **Corrected 2026-10-07, reported
> by the executing agent: this read "computed from the shipped `decorrelatedJitter`, whose first call
> passes `prevMs = base`", which describes `createBackoff` — and `createBackoff` gives 12 / 39 / 69 s,
> not 4 / 13 / 40.** The figures were right and the derivation was wrong. `withRetry` is the seam that
> ships: `src/core/http/client.ts` calls it, and **no production code calls `createBackoff` at all**,
> which is itself worth a card (see below). The error
> was the coordinator's, and the direction is favourable, so the owner's three numbers stand
> unchanged — but the figures a later reader would size a change by are these: **3 attempts → 4 s,
> 4 → 13 s, 5 → 40 s**. The owner approved 3 against the 13 s figure, which is now known to be the
> cost of **4**. Anyone revisiting the attempt cap should be told the corrected table, not the one
> the decision was taken against.
>
> Phase 2 hosts get their own three values with their own rows; nothing here is a global default.
2. Add the three columns to §7.3's table, per host, with the source of each value named.
3. Put the values on the policy rows in `hostLimiter.ts` and assert them against §7.3 by reading the
   shipped row rather than restating it, so a
   change to §7.3 fails loudly.

**Do NOT.**
- Do not copy `docs/03` §11.6's numbers. Different shape, different subsystem, and §9.5 forbids a
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
while §7.3 and `docs/05` §9.5 specify **decorrelated** jitter — and `P3-T05`'s `Files` list modifies
`backoff.ts`. Two differently-shaped backoffs will otherwise end up in one file. Report it; the
decision is the owner's.

**Findings, 2026-10-07 — the retry numbers have a home, a named source each, and the first test in this
repository that reads an authority document.** Verified independently: typecheck 0, `lint:check` 0,
**974 unit tests in 24 files**, and `backoff` alone at **27**. The gate was discharged before hand-out,
so `Do` step 1's "stop and ask" did not fire.

**Criterion 2 passes on the stronger of two readings, and that is the most durable thing here.** The
test does not merely read the shipped row — it **parses §7.3's table out of `docs/07` and compares it
against the row** `createHostLimiterRegistry(...).policyFor(NCBI_HOST).retry` serves, so editing
*either* side fails. Mutant E proves it: changing the **document** from `1000 ms` to `1200 ms` fails
with `expected 1000 to be 1200`. **So §7.3 is load-bearing rather than decorative, which it has never
been before** — see the correction below about what the card claimed on this point.

**The vacuity guard fired for real while the test was being written, which is the best evidence it
works.** The parser first matched every table line in §7.3 and so mixed the new cost table into the
policy table; it failed loudly — `§7.3's policy table has a row of 4 cells against 8 columns` —
instead of quietly asserting over a ragged parse. It now takes the contiguous block from the `| Host |`
header, resolves columns **by name** so inserting a column cannot silently shift the test onto the
wrong cell, and requires at least one data row with every row's cell count equal to the header's.

**Criterion 3 was made non-vacuous in exactly the way that mattered.** With an attempt cap of 3 the
transport count must be **3**, not "more than 1": the test drives a real client over a counting stub
and asserts the count equals the shipped `maxAttempts` **and** equals 3 **and** that the recorded sleeps
are `[1000, 3000]`. Mutant D — the composition-root error of reading 3 as three *retries* — fails it at
`expected … to have a length of 3 but got 4`.

**One mutation was deliberately not run, and the restraint was right.** The most direct probe of the
off-by-one would have been to break `src/core/http/retry.ts`'s `attempt >= maxAttempts` comparison —
but the other agent was compiling against that module graph at the time, and a transient defect there
would have surfaced in its run as a confusing unrelated failure. Mutant D proves the same property from
a file this card owns. **Six mutants, all caught; `grep -rn MUTANT src test` clean and all three files
`diff`-identical to their pre-mutation copies.**

**Six errors in this card's text and the hand-out prompt, all the coordinator's, all corrected above —
and four of the six are about the same arithmetic.**

1. **"worst case 1 + 3 + 9 ≈ 13 s"** — conflated attempts with retries. `maxAttempts` counts total
   attempts including the first, so a cap of 3 means **two** waits.
2. **The correction then named the wrong code path.** It said the 4 / 13 / 40 figures were "computed
   from the shipped `decorrelatedJitter`, whose first call passes `prevMs = base`" — that describes
   `createBackoff`, which gives **12 / 39 / 69**. The figures come from `withRetry`, which seeds
   `previousDelayMs = 0` so the first wait collapses to exactly `base`. Verified here:
   `backoff.ts:257` is `let prevMs = budget.baseMs`, `retry.ts:151` is `let previousDelayMs = 0`, and
   **no production code calls `createBackoff` at all** while `client.ts` calls `withRetry`. **The
   numbers were right and the derivation was wrong**, which is the harder error to catch.
3. **"the third wait tops out near 9 s" at a cap of 3** — there is no third wait.
4. **"`P1-T26` measured and honours `Retry-After: 120`"** — 120 is a **test fixture** in `P1-T26`'s own
   criterion, not an observation. Grepping every mention in `docs/` and `plan/`, **no host has ever
   been recorded sending the header**; `docs/02` §7.1 records arXiv's 429 explicitly *without* one. The
   reasoning survives — it is the largest delay the shipped code is *specified* to honour — but the word
   was wrong.
5. **"the pattern `P1-T04`'s pacing test already uses, so a change to §7.3 fails loudly"** — false.
   Verified: before this card **no test in the repository read any `docs/*.md`**; the only tests that
   read a file at all read `addon/prefs.js`, `package.json` and the window's own three files, and
   `P1-T04`'s pacing tests read the shipped row and then compare it to **restated literals**. The
   pattern the agent actually followed is `test/unit/prefs/schema.test.ts`'s — parse the authoritative
   file, then count what was consumed against what is there, so a parse matching nothing cannot read as
   "nothing to assert". **Naming a pattern that did not exist sent the agent looking for it.**
6. **`docs/05` §9.4 should be §9.5** throughout. §9.4 is "Concurrency shape"; the authority note and
   the ownership sentence are both in §9.5 "Backoff and degradation", verified at
   `docs/05-related-work-discovery.md:1330`. The agent found **eight** wrong citations in the corpus;
   **three were in this card** and one was in the hand-out prompt. The three in the card are fixed; the
   rest need a card.

**Two things this card could not reach, and the first means the numbers are not yet in effect.**
`src/bootstrap/container.ts` still reads that `retryFor` is "deliberately **not** supplied", and that
file is outside this card's `Files` — so **the shipped client still makes exactly one attempt.** The
card's Goal says `P1-T05`'s injected budget is "actually populated", and only half of that is reachable
inside the card's own scope: the numbers exist and the row carries them, nothing consumes them. Flagged
in the row's doc comment rather than done quietly.

**The second is a genuine seam defect worth its own card:** `createBackoff` seeds `prev = base` while
`withRetry` seeds `prev = 0`, so **one published `base` means 1 s or 3 s depending on which helper a
caller picks**, and a threefold difference in every published cost figure. `createBackoff` is currently
dead production code, which is why nobody has noticed. Both files are outside this card's `Files`.

**A type was widened as optional rather than required, and the reasoning is the `Files` rule applied to
a type.** `HostRateLimitPolicy.retry` is optional because `grep` found exactly one policy-row literal
outside `hostLimiter.ts` — in `test/unit/core/tokenBucket.test.ts` — and a required member would have
made that file a typecheck error **outside this card's `Files`**. A test asserts instead that every
shipped row carries one, which is the enforcement a required type would have given without breaking a
file the card may not touch. **Reported rather than done quietly**, which is the distinction that
matters.

**No exported name or signature in `hostLimiter.ts` changed** — verified, because the other agent was
compiling against it: one `import type`, one optional member, one object property and comments. The
installer grew by **31 bytes**.

**The integration suite was skipped and the justification is a grep, not an assumption.**
`grep -rn "HOST_POLICIES\|backoff\|RetryBudget\|retryFor\|\.retry\b" test/integration` finds nothing,
the one integration spec importing `hostLimiter` reads only `policyFor(NCBI_HOST).withoutKey.ratePerSecond`
— which an added optional sibling cannot affect — and no integration spec reads `docs/07`. No Zotero
process was started or killed.

**Mid-run failures were correctly attributed to the other card rather than absorbed.** Two transient
breakages appeared in `src/sources/pubmed/pubmedSource.ts` and its spec; the agent named them, said it
had touched neither file, and confirmed the final runs clean. **With two cards in flight that is the
difference between a report and a muddle.**

**Needs a card.** (a) Populate `retryFor` at the composition root, with the three now-stale comments in
`backoff.ts`, `retry.ts` and `container.ts` folded in. (b) Settle the first wait between the two seams.
(c) Fix the remaining `docs/05` §9.4 citations. (d) **`P3-T05` specifies full jitter over
`min(cap, base * 2**attempt)` from `docs/03` §11.6 while §7.3 and §9.5 specify decorrelated jitter and
§9.5 forbids a second shape — and `P3-T05`'s `Files` modifies `backoff.ts`, so two shapes would land in
one file.** The agent copied none of those numbers and mutant C proves the test would catch someone who
did. **That one is an owner decision, not a correction.**

---

### P1-T29 — Verify the `ProgressWindow` / `ItemProgress` signatures against a running Zotero

| Field | Value |
|---|---|
| **ID** | `P1-T29` |
| **State** | `DONE` — approved 2026-10-01; the three-way disagreement is **settled decisively: `docs/08` §8.2 right on every point, `zotero-types@4.1.3` wrong on every one.** `setItemTypeAndIcon` exists, `setIcon` does not. A path first argument **throws nothing and silently shows the generic icon**, which is why the typings' `iconSrc` naming is dangerous rather than merely inaccurate. §7.7's marker retired, with the one question the source read opened filed separately rather than swept up. |
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
- modify `docs/07-architecture-and-data-model.md` (**added 2026-10-01.** This card's `Retires` field
  and criterion 3 both require editing §7.7's `> **Unverified:**` marker, and `Files` named only the
  three paths above — so the card could not satisfy its own `Retires` field. The coordinator's
  omission, the fifth of its kind today.)

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


**Findings, 2026-10-01 — all five criteria pass, and the three-way disagreement is settled
decisively: `docs/08` §8.2 is right on every disputed point and `zotero-types@4.1.3` is wrong on
every one.** Five integration tests against Zotero **10.0.3** (BuildID `20260917164924`, Gecko
140.15.0); the suite went 33 → **38 passed**, 0 failing. typecheck, lint:check and the unit suite
(**787**) all exit 0. **The wrapper needed no code change** — only its comments were stale.

**Measured twice, two independent ways that agree.** Reflectively inside a running Zotero (own and
prototype property names, `typeof` per member, live parameter lists), **and** by extracting
`chrome/content/zotero/xpcom/progressWindow.js` from the installed `omni.ja` and reading it. I
re-extracted it here to check the headline myself: line 349 is
`ItemProgress.prototype.setItemTypeAndIcon = _deferUntilWindowLoad(function (itemType, cssIcon =
'item-type')` — **the first parameter is literally named `itemType`** — and there is no `setIcon`
anywhere in the file.

**`setIcon` does not exist at all.** Absent from `ItemProgress.prototype`'s own property names,
`typeof` is `"undefined"`, and calling it would be a `TypeError`. §8.2's "there is **no
`setIcon()`**" is literally correct, and `zotero-types` declares a method that is not there.

**What a path first argument actually does, which is worse than throwing.** Both shapes take the
same path: the constructor does `if (itemType) this.setItemTypeAndIcon(itemType)`, which writes the
argument **verbatim** into `data-item-type` and sets one fixed class. So `'journalArticle'` resolves
to `…/item-type/16/light/journal-article.svg` while a `chrome://…png` path resolves to the generic
`…/document.svg` — **nothing throws, nothing is logged, and the popup looks plausible with the wrong
icon.** That is exactly the live Zotero bug §8.2 names, and it is why the typings' `iconSrc` naming
is *dangerous* rather than merely inaccurate: it makes the wrong call compile and the resulting
defect invisible.

**A caveat that will mislead the next probe, now in the record.** Every member except `show`,
`close` and `startCloseTimer` is wrapped in the file's private `_deferUntilWindowLoad(fn)`, which
returns `function () { … arguments … }`. So `changeHeadline`, `addLines`, `addDescription`, the
`ItemProgress` constructor and **all four** prototype methods reflect as **arity 0 with an empty
parameter list**. **A probe that trusts reflection here measures the wrapper, not the method.**

**`startCloseTimer` before `show()` — confirmed behaviourally and then refined.**
`startCloseTimer(1500)` before `show()` left the popup open 4,500 ms later; the same call after
`show()` closed it. The guard is `if (_windowLoaded || _windowLoading)` and **`show()` sets
`_windowLoading = true` synchronously**, so the real condition is "`show()` has been *called*" — the
window need not have finished loading. `ZoteroProgressWindowSink.paint()` already orders it that way,
so **the sink's ordering is now verified rather than assumed.**

**§7.7's `Unverified` marker retired, and one genuinely open question filed separately rather than
buried in the retirement.** Every member the marker named is measured. But the source read surfaced a
new question — §7.7's `alwaysontop` caveat may not apply to a popup with a parent window, because in
10.0.3 `alwaysontop=yes` is on the **windowless** `nsIWindowWatcher.openWindow` branch only while the
`options.window` branch opens `"chrome,dialog=no,titlebar=no,dependent=yes"`. That is source-read,
not observed, and the complaint §7.7 cites is macOS — so it is recorded as its own narrow
`> **Unverified:**` in `docs/01` §10.2.1 with the caveat and its prescription explicitly **still
standing**. Retiring a marker by moving its unanswered part somewhere visible is the right shape; one
loose end was not swept up with the rest.

**Three defects filed against `zotero-types@4.1.3`, and which declarations do match.** `iconSrc`
should be `itemType`; `setIcon` is declared but does not exist; `setItemTypeAndIcon` is missing
entirely; and `Translation` is declared on `ItemProgress` instead of on the progress-window instance.
Two extras also recorded: `show()` returns `false` if already shown, and **`close()` before `show()`
swallows a `TypeError` into `Zotero.logError()`**, so it logs spuriously.

**A latent sharp edge the sink's option surface can reach, reported not guarded.** `setProgress(100)`
assigns `_image.className = this._iconClassName`, and `_iconClassName` is set **only** by
`setItemTypeAndIcon` — which the constructor skips on a **falsy** first argument (verified: line 291
is `if (itemType)`, line 337 assigns `_iconClassName`, line 351 is the only place it is set). So an
empty-string item type — **exactly what §7.7's sketch passed** — makes a later `setProgress(100)`
write the literal class `"undefined"`. `ZoteroProgressWindowSinkOptions.itemType` is caller-supplied
and uses `??`, so `""` passes straight through. Not live today, and guarding it would widen the
wrapper, so it was left alone. **Worth a one-line card.**

**Nothing broken was left behind**, which matters for a card that opens real windows: teardown logged
`0 progress window(s) left open` and no `zotero.exe` survived the run.

**Two more things reported rather than absorbed.** The project's recorded Zotero version is a patch
stale — `.env`'s comment and anything in `docs/` pinning **10.0.1** is behind the installed
**10.0.3 / 20260917164924**; `docs/13` §1.6 is the natural owner of a sweep. And `Zotero.locale` in
the dev profile is **`ko-KR`**, so `docs/08` §8.2.1's `getString()`-throws condition
(`Zotero.locale === 'en-US'`) **is not exercised locally by default** — the adjacent `Unverified`
about whether `Zotero.ftl.addResourceIds` makes plugin FTL keys reachable from `getString()` is still
open with no card against it, and `l10n.spec.ts` already has the locale-switching machinery that
would settle it.
---

### P1-T30 — Turn on `fluent.dts` and make one source of truth for message ids

| Field | Value |
|---|---|
| **ID** | `P1-T30` |
| **State** | `DONE` — approved 2026-10-01; the generated union is authoritative and `keys.ts` re-exports it. The sharp criterion was **proven in both directions by actually breaking it** — removing *and* adding a bundle id are both compile errors now. Reported an honest CI-visible limit (the typecheck that consumes the union runs before the step that writes it) and **declined to file the upstream issue**, correctly: no `gh`, and opening a public issue on someone else's repository is not an agent's call. |
| **Depends on** | `P1-T18` |
| **Blocks** | `P1-T40` |
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
3. Keep the per-message argument map hand-written, and **write** the check that every id in it
   exists in a bundle. **Corrected 2026-10-01: there was no such test to keep.** `P1-T18` shipped
   `FluentMessageArgsMap` with **no check of any kind** — verified, the previous `l10n.spec.ts` has
   zero references to it — and because an `interface` accepts any string key, a renamed message left
   an entry pointing at nothing. The coordinator's wording assumed a test that does not exist; the
   work is inside this card's `Files` either way.
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

**Findings, 2026-10-01 — all four criteria pass, and the sharp one was proven in both directions by
actually breaking it.** `fluent.dts` is on; `typings/i10n.d.ts` carries **exactly 84** `| 'id'`
members and `src/i18n/keys.ts` **re-exports** it (verified: line 85 imports, line 103 re-exports), so
the generated union is authoritative and cannot drift from the bundles. `diff` of the generated list
against the 25 + 59 declared ids is empty, and the generator independently confirms `P1-T18`'s
**68 `research-helper-` + 16 `rh-error-`** split. typecheck, lint:check and the unit suite (**787**)
all exit 0.

**Three properties of the generator shaped the design, read from the installed 0.9.2 and then
measured.** It emits an `export type` in a **module** `.d.ts`, so it is imported by path and
`// @ts-nocheck` suppresses errors inside it only — consumers stay checked. It is the union **over
all locales**, so a typo in `ko-KR` *widens* the union rather than being caught, which is why the
reverse check below exists. And **it carries no surface information at all**, so it cannot express
"this id belongs to `searchDialog.ftl` and must not also be in `mainWindow.ftl`" — the silent
collision `docs/01` §9.3 calls worse than an error. That is upstream issue **#125**, and it is why
the two per-surface arrays could not simply be deleted.

**So the arrays survive as a compiler-checked partition, not a second union** — the only shape that
works given the lost surface split. Each gained `as const satisfies readonly FluentMessageId[]`
(declared ⊆ generated), a new `UndeclaredBundleMessageId` asserts the other direction (generated ⊆
declared), and the pre-existing no-duplicate test makes the halves disjoint. Together those make the
two sets **provably the same 84 ids with neither side able to move alone.**

**The sharp criterion, proven by doing it and then restored byte-for-byte.** Removing
`research-helper-search-details-hide` from the `en-US` bundle and rebuilding **without touching
`keys.ts`** gave `TS2820` / `TS2322` at three sites. Appending a new message gave
`TS2344 … does not satisfy the constraint 'never'` from the reverse check — **which is what makes it
one source of truth rather than one checked copy.** Both argument-map checks were exercised the same
way. Every experimental edit was restored and verified by `cmp` and md5, the union is back at 84,
and `tsc --noEmit` exits 0.

**An honest sharpness limit on that criterion, and it is CI-visible.** `npm run build` is
`tsc --noEmit && zotero-plugin build`, so the typecheck that *consumes* the union runs **before** the
step that *writes* it — the compile error appears on the typecheck after the next build, exactly as
`typings/prefs.d.ts` already behaves. And `ci.yml` runs lint+typecheck in one job and
`npm run build` in a different one, so **a PR that edits an `.ftl` and forgets to rebuild passes
CI's typecheck against the committed union.** Reported, not papered over; the fix is one
`git diff --exit-code -- typings/` after the build step, and neither `package.json` nor `ci.yml` is
in this card's `Files`.

**The argument map had no check at all before this card, which is worse than the card assumed.**
`P1-T18` shipped `FluentMessageArgsMap` with none — verified, zero references to it in the previous
`l10n.spec.ts` — and an `interface` accepts any string key, so **a renamed message left an entry
pointing at nothing.** Now `UndeclaredArgumentMessageId` makes a bogus key a compile error, and
`ARGUMENT_MESSAGE_IDS` (29 ids) mirrors the map in both directions so a spec can walk it.
Separately verified by parsing the `en-US` bundles that the map's 29 ids **and all of their variable
names** match the bundles' placeables exactly, 15 in `mainWindow` and 14 in `searchDialog` — so
`P1-T18`'s map is correct as shipped.

**The three decision lists hold, and the header now records why a generator can never absorb them:**
it can only report what the bundles contain, never record that an id **must stay missing forever**.
`ko-KR totals: 4 present, 80 absent; expected 4 / 80`; `KO_DELIBERATELY_ABSENT` still the
`FR-55`/`V-17` fixture and still absent; `deferred present []`. One consequence stated plainly: with
the reverse check in place, **adding an `en-US` string now has three obligations, not two** — a
surface-list entry *and* a `KO_PENDING_REVIEW` / `KO_DELIBERATELY_ABSENT` admission. Intended
tightening, not a surprise.

**The bundles are still byte-identical through the build** — all four `cmp`-clean against
`.scaffold/build/addon/locale/**` before, after turning `dts` on, and after the runner's test-mode
build. `dts` writes only the typings file; `prefixLocaleFiles` / `prefixFluentMessages` remain off
(`P0-T32`) and the shipped ids are still flat.

**The upstream bug is still fully reproducible, measured end to end rather than inferred.**
`buildLocale()` calls `generateFluentDts()` whenever `dts` is set with **no guard on the message
count**; narrowing `build.assets` so the dist got zero `.ftl` produced a five-line file ending
`export type FluentMessageId =` then `;`, and `tsc` gave `TS1110: Type expected` — **so the
2026-09-10 finding stands verbatim, including that `@ts-nocheck` does not suppress it.** It was
**not** filed: there is no `gh` on this machine, and **opening a public issue on someone else's
repository is not an agent's call** without being asked. A read-only search found no existing
report. A `TODO(P1-T30)` in the `fluent` block names the title, the artifact, the `TS1110` output,
the reproduction, the two functions and the one-line fix — **a human needs to post it and replace
the TODO with the URL.**

**Reported, not absorbed.** The `rh-error-` narrative is now **stale in four files** — `docs/01`
§9.3 was amended on 2026-09-30 to *sanction* the second prefix, while `keys.ts`'s header still calls
it "not a sanctioned pattern", `ftl.ts`'s comment says `P1-T18` "reports that conflict rather than
resolving it", `l10n.spec.ts`'s header says "**Both cannot hold**", and the `en-US` `mainWindow`
bundle calls it "a corpus defect". Two are in this card's `Files` and two are not, and the prefix
split is not this card's subject, so none were changed. Also noticed: `ci.yml` carries a
commented-out `scripts/check-l10n.mjs` step attributed to `P0-T14` with the script still absent —
the `ko-KR` gap is now asserted by `l10n.spec.ts`, so that placeholder may be dead rather than
pending.

**On the integration suite:** the "33 passed" baseline in this card's brief was already stale by the
time it ran — `P1-T29` added 5, `P1-T24` touched two specs and `P1-T14` added `importer.spec.ts`
concurrently. A full run without `--abort-on-fail` gave **44 passed, 4 failed, and all four failures
are in `P1-T14`'s in-flight `importer.spec.ts`** (`Zotero.Search` call counts), none
localization-related. **All 13 tests in `l10n.spec.ts` pass**, including the two this card added.

---
### P1-T31 — Make a progress reporter usable for more than one job

| Field | Value |
|---|---|
| **ID** | `P1-T31` |
| **State** | `DONE` — approved 2026-10-02; **a reporter per job, not per plugin**. `ServiceGraph.progress` is a `JobProgressFactory` and the root constructs no sinks at all, so `P1-T25`'s trap — one app-scoped reporter silently reporting exactly one job per plugin lifetime — **disappears structurally rather than behind a flag**. 816 unit tests (up from 802). The shape was chosen on three measured counts, and **criterion 5 was unreachable under the alternative without leaving this card's `Files`** — verified by pinning `openOn` at the root again and watching five tests fail. Six mutations, all caught; the pre-card state fails five. Closed the `docs/07` §7.7 ambiguity that **was the defect's entry point** — "one tree per job, not one per plugin". Reported rather than absorbed: nothing in the type system says a reporter must own its sinks, two concurrent jobs now float two `alwaysontop` popups, and `JobProgress` lives in `src/bootstrap/` where Phase 3's `core/jobQueue/queue.ts` will want it. |
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

**Findings, 2026-10-02 — all six criteria pass. Shape chosen: per-job sinks behind a factory on the
graph.** `ServiceGraph.progress` is now a `JobProgressFactory`; `forJob(label, opts)` builds a fresh
observable sink, a fresh Zotero window sink and a fresh tree over them, and **the root constructs no
sinks at all.** `ServiceGraphOptions.openOn` moved to `JobProgressOptions`. **816 unit tests, up from
802**, in the same 21 files; typecheck exits 0 and the card's four files pass `eslint` and `prettier`
on their own.

**The trap this card existed to avoid disappears structurally rather than behind a flag.**
`reporter.dispose()` disposes the sinks it was given, and those sinks are now **the job's** — so no
`ownsSinks` escape hatch was needed and `dispose()` stays the plain thing it reads as. `P1-T25`'s
`Do NOT` ("do not construct a second set of sinks at the root") holds as written, and §4.1's
`ProgressReporter` was **not widened**: no member added, no signature changed.

**Three measured counts decided the shape over a factory sharing the root's sinks**, and the third
was decisive. `docs/07` §7.7 says "**One window per job**", and shared sinks give one window per
*plugin* — job 2's toast would repaint job 1's line, and `openOn`, `lastPaintMs`, `closesAtMs` and
`autoClosed` are all per-instance state, so two jobs would share one close deadline. §4.5 declares
`subscribe` on `JobHandle`, i.e. **per job**, and one app-scoped observable carries no job identity,
so a status bar could not tell which snapshot was its own. And **criterion 5 is unreachable under the
alternative without leaving this card's `Files`**: `openOn` is a *constructor* option of
`ZoteroProgressWindowSink`, so making it per-job over one shared sink would mean carrying it on every
`ProgressSink.update()` — widening the port **and** editing `src/zotero/progressWindow.ts`, which the
`Files` list does not name. Verified, not assumed: pinning `openOn` at the root again failed five
tests including criterion 5's.

**The cost is stated rather than buried: one popup per concurrent job, and a `JobProgress` whose
`dispose()` the caller must run.** So the factory keeps a registry of open reporters and
`installServices` defers `disposeAll()` into the `Scope` — **`FR-56` does not depend on a pipeline
reaching its `finally`** — and the five-cycle teardown test asserts exactly that by never calling
`job.dispose()`.

**Both latches are in, and `dispose()` deliberately does not fake an outcome.** `ProgressNode.inert`
is now `finished || root.terminal || root.disposed || parent?.inert`, with
`CompositeProgressReporter`'s private `disposed` folded into the shared state so there is one source
of truth. `createObservableProgressSink()` latches: `update()` ignored after `dispose()`, `latest`
stays `undefined`, `dispose()` idempotent, and a `subscribe()` arriving after disposal registers
nothing and returns a callable no-op. A plugin disabled under a running job leaves `status: "running"`
rather than a synthesised terminal state — **the honest reading, and asserted.**

**`P1-T25`'s asymmetry assertion was updated rather than deleted, and it was also vacuous.** It
became "latches both sinks after teardown — the `P1-T25` asymmetry is gone", in the same place, with
the 2026-10-01 measurement kept verbatim in the doc comment and a paragraph naming which two lines
closed it. The line asserting the accepted-after-dispose snapshot now asserts
`job.events.latest` is `undefined`, and under the pre-card implementation it fails with
`expected { status: 'succeeded', … } to be undefined` — **the fix is visibly the fix.** Separately:
the old version's *window* half was **vacuous**, because `seen` was 0 both before and after teardown —
nothing had opened a popup. The new one opens a real popup with `openOn: "progress"` first, so "no
window survives" has something to survive.

**Six mutations, every one caught, every one reverted** (`grep -rn MUTANT src test` → none, with a
final clean re-run). Dropping `root.disposed` from `inert` failed the "reaches no sink from any member
after dispose()" test with *expected length 1 but got 3*. Dropping the observable sink's latch failed
both new sink tests. **Both together — the true pre-card state — failed five**, including the rewritten
asymmetry test. Making `forJob` return one cached job, i.e. `P1-T25`'s shape, failed criteria 1, 2, 4
and 5 — with criterion 1 reporting *expected [] to have a length of 1 but got +0*, **the silent no-op
reproduced**. Making one job's `dispose()` dispose every open job — the trap — failed criterion 4.
And making `scope.defer` dispose nothing failed the five-cycle `FR-56` test.

**Two honest observations about criterion quality, recorded rather than acted on.** Criterion 3's
"reaches no sink" is now **over-determined in the shipped graph**, because both shipped sinks latch
independently — so removing the tree latch alone is caught only by a *non*-latching sink, which is why
it is asserted at the core level with a plain recording sink. And criterion 2 was already true of two
independently-constructed reporters before this card; what was impossible was **getting** two, which
`P1-T25`'s `Do NOT` forbade — so it stays falsifiable via `openJobs`, and the cached-job mutation
fails it.

**The corpus ambiguity that let the defect in, now fixed in §7.7.** "Two surfaces in v1, driven by one
`ProgressReporter` tree" sat **two lines above** "One window per job", and the two cannot both be read
literally once a plugin runs more than one job. `P1-T25`'s `Do NOT` read it as one tree per *plugin* —
**which is precisely how the defect got in.** §7.7 now says "one tree **per job** — not one per
plugin", with the history and the cost recorded. Also flagged: §7.7 assigns `searchImport` to the
in-window status list and reserves the popup for `related`/`audioReport`, while `docs/08` §4.4 says the
import *does* raise a toast "only on completion" — they reconcile as toast-plus-status-bar, which is
what `openOn` encodes, but §7.7's sentence reads as excluding the popup entirely and those two
sections are now **the only thing deciding a per-job argument**.

**Importers grepped before any signature change, per §4 as corrected.** `container.ts` is imported by
`src/addon.ts`, `src/zotero/registrations.ts` and `src/bootstrap/registerUI.ts` — **none in this
card's `Files`** — and none blocked a change: `P0-T07`'s §1 registry is **byte-identical**,
`installServices`' signature is unchanged, and `registerUI.ts` never passed `openOn` and discards the
returned graph, so removing `openOn`/`progressSinks`/`progressEvents` reaches it only through a doc
link that still resolves. `progress.ts`'s importers lost no exported name or signature; the two
latches are one term in a private predicate and one flag in a closure.

**The weight→fraction helper was asked about and deliberately not written.** `forJob` **does** make
its home obvious — it is the single per-job construction site and §4.5's `StageDescriptor.weight`
arrives with the pipeline, so `forJob(label, { stages })` is the natural signature. But
`StageDescriptor` lives in §4.5's `src/pipeline/types.ts`, **which does not exist** (`src/pipeline/*`
is seven empty directories and `grep -rn StageDescriptor src/` finds nothing), and `P1-T16` step 2
owns it.

**Three things reported rather than absorbed.** **Nothing in the type system says a reporter must own
its sinks** — the invariant is enforced only by comments, so the trap this card sidestepped is still
*expressible* by the next card, and making it unexpressible is a design decision worth its own card.
**Two concurrent jobs now float two `alwaysontop` popups**, and §7.7's macOS caveat is written for one
long job; Phase 1 cannot hit it with one pipeline, but it arrives with the second. And
**`JobProgress` / `JobProgressFactory` live in `src/bootstrap/`** while Phase 3's
`src/core/jobQueue/queue.ts` will want them — §2.3 forbids `core/` importing `bootstrap/`, so either
the progress half moves down with the Zotero sink injected, or Phase 3 re-declares a parallel shape.
Better settled before `queue.ts` is written.

**The integration suite was not run and nothing in the diff can reach it:** the only integration spec
touching progress imports **only** `openZoteroProgressWindow` and `ProgressWindowHandle` from
`src/zotero/progressWindow.ts`, which this card did not modify. **So the 51-test baseline is
unverified by this card** — stated rather than implied.

---
### P1-T32 — The four platform seams the composition root could not reach

| Field | Value |
|---|---|
| **ID** | `P1-T32` |
| **State** | `DONE` — approved 2026-10-05; four seams closed — `error()` reaches `Zotero.logError`, `debug()` carries its level, `PrefObserverHandle` is a discriminated union so the root binds by tag not arity, and the progress headline resolves from Fluent once in `installServices` with a `warn` and a named fallback instead of a silent brand name. The double prefix was fixed on the **documented** side (§10.3 spells it with an underscore), so `logger.ts` was untouched and `zoteroApi.ts` imports its constant idempotently. `zoteroApi.reportError` was left alone and **signposted**: it reaches `Zotero.debug` only, and `registerUI.ts`'s comment claiming otherwise is very likely why the gap survived two cards. 843 unit tests; ten mutants, all caught. **This card's item 3 rested on a premise that was false when written** — a headline id already existed, added by `P1-T18` before the card — which the agent caught; corrected in place, and `P1-T33` now owns the drift it created. |
| **Depends on** | `P1-T25` |
| **Blocks** | `P1-T33`, `P1-T34` |
| **Retires** | none |
| **Implements** | part of `NFR-16` |
| **Estimate** | 0.5 d |
| **Human gate** | none |
**Goal.** An `error()` line reaches Zotero's error console, a log line carries its level, the progress
popup has a localizable headline, and `PrefStore.observe`'s handle says what it is.

**Why these are one card.** All four are the same shape — a seam `P1-T25` had to bind from inside its
own two files because **no card's `Files` names the other side** — and each is small on its own.
Measured 2026-10-01. **Title corrected 2026-10-03 (coordinator): it read "three platform seams" while
the list below has always had four numbered items, and an undercount in a title is exactly what makes
an executing agent read its scope short.** `Do` step 5's double prefix is a fifth item but is a
tidy-up in the same files rather than a seam, so it is not counted.

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
synchronous bundle. `config.addonName` ships today, a brand name rather than a translatable sentence.
**The hard part is not the id**: Fluent resolution is async and per-window, while the graph is built
app-scoped at startup.

> **This item's premise was false when written, and the executing agent caught it. Corrected
> 2026-10-03 (coordinator).** The sentence here read "`src/i18n/keys.ts` declares no headline id; the
> nearest three are argument-bearing status ids for the search dialog." Both halves are wrong:
> **`research-helper-import-toast-header` already existed** at `keys.ts:176`, in the en-US bundle and
> already on `KO_PENDING_REVIEW`, introduced by `P1-T18` — which landed **before** this card was
> written, so the claim was false at the moment of writing. It is also the nearest thing in the file,
> not a search-dialog status id. The cause is the same as `P1-T24`'s: **a claim about a file written
> into a card without grepping the file**, which is precisely what every card prompt tells an agent
> not to do. What survives is the *seam* — no code anywhere names either id, so the headline is still
> a brand name in the product — and the overlap this error created is now live drift in the one module
> built to prevent drift. It needs its own card.

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

**Findings, 2026-10-03 — all six criteria pass, and the card's own item 3 turned out to rest on a
false premise the agent caught.** Verified independently of the report: **843 unit tests in 21 files**
(up from 833), **63 integration tests, exit 0**, typecheck 0, `lint:check` 0, `grep -rn MUTANT`-clean.
Eleven files changed — the seven in `Files` plus four the card's list could not have avoided.

**The false premise was mine, and it is the same class of error as `P1-T24`'s.** Item 3 read
"`src/i18n/keys.ts` declares no headline id; the nearest three are argument-bearing status ids for the
search dialog." Both halves are wrong: **`research-helper-import-toast-header` already existed** at
`keys.ts:176`, in the en-US bundle, already on `KO_PENDING_REVIEW`, added by `P1-T18` — whose commit
**precedes** the one that wrote this card, so the claim was false the moment it was written and
`git show` of that commit finds the id already there. **A claim about a file, written into a card
without grepping the file** — exactly what every card prompt tells an agent not to do. The card's
title was separately wrong too ("three platform seams" over a four-item list), corrected before
hand-out. What survives is the *seam*: **no code anywhere names either id**, so the headline is still
a brand name in the product. What the error created is live drift — two ids, one en-US string, one
probable surface — **in the one module that exists to prevent drift.** Needs a card.

**The `reportError` trap was handled the right way: a new facade, and the decoy left standing with a
sign on it.** `zoteroApi.reportError(message, error)` reached `Zotero.debug` only and `Zotero.logError`
was named **nowhere** in `src/zotero/`. Rather than redirect it — which would change behaviour for
`registerUI.ts`'s menu `onError` and seven integration specs — a separate single-argument
`logError(message)` was added, and `reportError`'s doc comment now says in so many words that it is
**not** `LogSink.reportError`'s implementation and that wiring it there would make criterion 1 *look*
satisfied while the missing channel stayed missing. **`Zotero.logError` takes an `Error`, not a
string** (`zotero-types@4.1.3`), so the facade constructs one. The mutant that wires the decoy is
caught three ways.

**`LogSink.reportError` stays optional, on a reason worth keeping.** The silence was never caused by
optionality — it was caused by **no implementation existing anywhere**. Making the member required
would force edits to `NULL_LOG_SINK` (outside `Files`) and to every test sink, and would be satisfied
by `reportError() {}` everywhere, which buys nothing. The regression guard is instead a test asserting
the **product** sink opens the channel. `logger.ts:309`'s `sink.reportError?.(line)` needed no edit.

**`registerUI.ts` was asserting something false about the code, and that comment is very likely why
the gap survived two cards.** Lines 121–123 claimed `reportError` is "`zoteroApi.ts`'s
`Zotero.logError` + `Zotero.debug` pair". It was neither. **The file that wires the sink said the
other channel already existed** — so `P1-T25` and `P1-T19` both had a reason not to look. Corrected in
place with a dated note.

**The double prefix was fixed on the documented side, and the grep decided it.** `docs/07` §10.3 is
normative for the log line and spells it **`[research_helper]` with an underscore** (verified at
`docs/07:3493`), as do `docs/01` §12's examples. So `logger.ts` was **not touched at all**; instead
`zoteroApi.ts` deleted its own hyphenated constant and **imports** `logger.ts`'s, applying it
**idempotently** — a message already carrying the prefix passes through. The grep that decided it:
`logger.ts`'s exported `LOG_PREFIX` has exactly **one** importer, which uses it *symbolically*, so
**no test asserted the literal underscore form**, and `logger.ts:259`'s doc-comment example stays
accurate. One behaviour change is flagged rather than buried: direct `debug()` callers now emit the
underscore form, which affects two helpers and seven integration specs that each already carry their
own `[P0-T23]`-style tag. The hyphenated spelling survives where it belongs — on **thrown error
messages**, a different convention, `addonRef`-derived. The card's own parenthetical ("only the second
matches `config.addonRef`") read as an argument for the hyphen; the agent went the other way **on
documented grounds and said so**, which is the right order of authority.

**Criterion 4's obstacle was not where I predicted, and the correction is the useful part.** I warned
that per-window async Fluent could not be reached from an app-scoped startup. **The per-window part is
not the obstacle:** `docs/08` §10.1's mechanism table has a "From JS, no window" row —
`new Localization([...])` — which `l10n.spec.ts` already exercises as the form the sandbox uses, and
`installServices` is **already `async`**. What genuinely cannot await is **`forJob`**, which is
synchronous by §7.7's one-popup-per-job design and needs a `string`. So the headline resolves **once**
in `installServices`. Measured inside a live Zotero 10.0.3: the new id resolves from
`L10nRegistry.generateBundles(["en-US"])`; the `ko-KR` gap is **asserted** to equal
`KO_PENDING_REVIEW ∪ KO_DELIBERATELY_ABSENT` exactly; and an unpinned `new Localization` under a
`ko-KR` UI resolves every mainWindow id, so English fallback is measured rather than assumed.
**There is no silent brand-name fallback left** — a failed resolve logs at `warn` naming the id before
using the fallback, and startup is deliberately not failed on it, because losing the plugin's menus
over a string would be the worse outcome. Three tests cover resolved / `undefined` / throwing.

**The one thing criterion 4 does not verify, reported rather than redefined: the *timing*.** Whether
Zotero's `registerLocales()` has contributed this plugin's bundle to the `zotero-plugins`
`L10nFileSource` **at the instant `startup` runs `registerUI()`** is unproven. `l10n.spec.ts` reads
after startup from a loaded window; `lifecycle.spec.ts` passed `registerUI()` six times, but the
resolver swallows failure by design, so that is not proof. The plugin's own `warn` could not be read
back either — `P0-T23` recorded the runner profile's `Debug Output: storing was false`. **Filed as a
card rather than absorbed.**

**What made the arity-refusal test redundant is the sharpest thing in this report.** `PrefObserverHandle`
is now a closed union of `{ kind: "scoped-registration" }` and `{ kind: "unsubscribe" }`, so an
untagged handle is a **compile error at every `PrefStore.observe` implementation** — the site that
knows which semantic it meant. The only way left to produce one is a cast, and **the cast is now in
the test**: before the tag, the assertion described a reachable runtime state; now it describes what
happens after the type system has been circumvented. It was kept, because it guards a *leak*, and
annotated with that reasoning. The complementary case arity could never catch was added: a handle that
**is** callable but carries an unrecognised tag — arity would have bound it as a registration. And
`register` is typed `(scope: never) => void | Promise<void>` rather than `object`, because `core/` may
not name `Scope` and `never` in parameter position makes the real shape assignable **without a cast on
the implementation side**; one narrowing cast remains, at the composition root, where the old one was.
**Swapping the two tags is no longer expressible in the adapters at all** — the mutant needed an edit
to the composition root *and* two casts to compile, which is itself the measurement of what the tag
bought.

**Criterion 5 was asserted where the defect actually lived.** The duplicate was added **by the
facade**, so a test stopping at the sink physically could not see it; the assertion is on the string
that reached `Zotero.debug` — one prefix, exactly one occurrence, no hyphenated form, and the
remainder still parsing as §10.3's single-line JSON payload with the right `lvl`.

**Four files outside `Files`, each forced, none replaced.** `src/zotero/prefStore.ts` is the only
platform implementation of `observe` and a discriminated return whose sole adapter does not produce
the discriminant **does not typecheck**. `src/bootstrap/registerUI.ts` is **the other side of all four
seams** — it holds `logSink:` and `progressHeadline:`, so leaving it would have left every seam dead
in the product while passing in tests, *the exact failure this card was written against*.
`test/unit/prefs/schema.test.ts` had one assertion the tag invalidates, and it **failed loudly rather
than silently**. And `typings/i10n.d.ts` is generated-but-committed, which exposed an ordering trap
worth recording: **`npm run build` typechecks *before* it regenerates**, so a card that adds a Fluent
id must run `npx zotero-plugin build` directly or its own typecheck fails on the id it just declared.
All four built `.ftl` files verified byte-identical to `addon/locale/**` per `P0-T32`.

**`docs/08` §10.1 contradicts itself within four lines, and worse than the report put it.** Its file
tree shows `locale/en-US/research-helper/mainWindow.ftl` — a **subdirectory with unprefixed
filenames** — while the table immediately below says "FTL in `locale/<locale>/` (**flat**,
`research-helper-` prefixed)", which is what ships and what `registerLocales()` requires (`docs/01`
§9.1 drops subdirectories). The paragraph *between* them asserts "**This section owns the surface set
and its names** … where the two disagree, this list wins and the tree is the defect" — so the section
claims authority over a tree it then prints wrongly. **It is exactly the kind of block a future card
would type straight from.** Needs a card.

**`G-41`'s headline numbers are now stale, and that matters because a human sizes the gate by them.**
`plan/06-human-gates.md` says "79 strings" in **four** places — lines 48, 650, 661 and 667 — and "all 84 ids" in a fifth; (**corrected 2026-10-05**: this read "three places", missing line 667's "Three of the 79". The `P1-T34` card below listed all four correctly, so the undercount lived only here — and when reporting it I then misattributed it to that card, which is a second slip on the same fact.)
`test/integration/l10n.spec.ts:45` says "79 of their 84". The live run reads **85 declared ids**
(mainWindow 26) and `ko-KR totals: 4 present, 81 absent` — 80 pending plus one deliberately absent.
Prose only, no assertion, and `plan/06` is a gate document, so the agent correctly left all five
alone.

**Also recorded without a card: `ko-KR` is this machine's live UI locale.** The run reports
`Zotero.locale ko-KR; app locales ["ko-KR","en-US"]`, which is why `P1-T19`'s label test logged Korean
menu labels beside an English collection label. Any later spec asserting English text verbatim will be
surprised by spec order, and the fallback path is therefore the **default** path here, not the
exception — which is a good thing for how much of `G-41` is exercised incidentally.

### P1-T33 — Retire one of the two headline ids, and record which surface owns the string

| Field | Value |
|---|---|
| **ID** | `P1-T33` |
| **State** | `DONE` — approved 2026-10-07; one surface, so one id. The fact that settles it is that `docs/08` §8.2.2 searched Zotero 7–10 and found **no notification mechanism at all**, so §4.4's "completion toast" *is* the progress window and the word names a timing rather than a mechanism — and the shipped sink's own comment already said so. Which id survived was **forced rather than chosen**: retiring the other would have required editing two files outside the card's `Files`, so the card could only be executed if the decision went one way, which is a flaw in the card and is recorded as one. Criterion 1 **could not hold together with `Do` step 1** — reasoning that may not name what was retired is not reasoning — and the agent **declined to contort the record to satisfy a string match**. |
| **Depends on** | `P1-T32` |
| **Blocks** | `P1-T40` |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none — the surviving id's Korean string stays inside `G-41`'s existing scope |

**Goal.** One Fluent id for the progress surface's headline, owned by a named surface, with the other
retired from `keys.ts` and both bundles.

**Why this is a card.** Two ids now carry the same en-US string for what may be one surface, and
**neither is named by any code**. Measured 2026-10-03:

- `research-helper-import-toast-header` — `src/i18n/keys.ts:176`, in `MAIN_WINDOW_MESSAGE_IDS` and on
  `KO_PENDING_REVIEW`, added by `P1-T18`. Its bundle comment reads "Header of the completion
  `ProgressWindow` toast (`docs/08` §4.4, §8.2)". en-US value: `Research Helper`.
- `research-helper-progress-headline` — added by `P1-T32` for `docs/07` §7.7's popup. Same en-US
  value.
- `grep` over `src/` finds **neither id named by any code**; the only hits outside `keys.ts` are the
  `.ftl` bundles that declare them.

**This duplication is a coordinator error, not a design choice, and it is recorded as one.**
`P1-T32`'s item 3 asserted "`src/i18n/keys.ts` declares no headline id" — false when written, since
`P1-T18`'s commit precedes it. The executing agent found it, followed `Do` step 3 as written, and
reported the overlap rather than silently picking a side. So the drift is live **inside the one module
built to prevent drift**, which is why it should not sit.

**The substantive question the card has to answer** is whether §4.4's completion toast and §7.7's
per-job progress popup are **one surface or two**. `docs/08` §4.4 says the import raises a toast "only
on completion"; `docs/07` §7.7 assigns `searchImport` to the in-window status list and reserves the
popup for `related`/`audioReport`. `P1-T31`'s `Findings` already flagged that pair as reconciling only
as toast-plus-status-bar, which is what `openOn` encodes — and noted that **those two sections are now
the only thing deciding a per-job argument**. Decide it here, for the headline only.

**Read first.**
- `src/i18n/keys.ts` — `MAIN_WINDOW_MESSAGE_IDS`, `KO_PENDING_REVIEW`, `KO_DELIBERATELY_ABSENT`,
  `L10N_PROGRESS_HEADLINE`'s doc comment (which records the overlap), and `surfaceOfMessage()`.
- `docs/08` §4.4 (the completion toast) and §8.2; `docs/07` §7.7 (the popup, and `P1-T31`'s
  clarification that it is one tree **per job**).
- `src/bootstrap/container.ts`'s `ProgressHeadlineSource` and `resolveProgressHeadline()` — where the
  port and the resolver are **declared**.
  > **Corrected 2026-10-05, reported by the executing agent.** This read "**the only consumer of either
  > id**, once one is wired", which is false: `container.ts` declares `readonly messageId: string` and
  > forwards `source.messageId`, and names no id. The **assignment** is
  > `src/bootstrap/registerUI.ts:236-237`'s `PROGRESS_HEADLINE`, which is **not in this card's `Files`**.
  > Same failure as `P1-T32` item 3 — a claim about where a thing lives, written without grepping.
- `P1-T30`'s `Findings`: `typings/i10n.d.ts` is **generated but committed** and is the single source of
  truth for `FluentMessageId`. **`npm run build` typechecks *before* it regenerates**, so removing an
  id means running `npx zotero-plugin build` directly or the typecheck fails on the id you just
  deleted. `P1-T32` hit this and recorded it.
- `test/integration/l10n.spec.ts` — it asserts the `ko-KR` gap equals
  `KO_PENDING_REVIEW ∪ KO_DELIBERATELY_ABSENT` **exactly**, so retiring an id without updating the
  lists fails an integration test rather than passing quietly.

**Files.**
- modify `src/i18n/keys.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/locale/ko-KR/research-helper-mainWindow.ftl`
- modify `src/bootstrap/container.ts`
- modify `typings/i10n.d.ts` *(generated — regenerate, do not hand-edit)*

**Do.**
1. Decide which id survives and **write the reasoning into `keys.ts`**, naming the surface that owns
   it. If the answer is that §4.4's toast and §7.7's popup are genuinely two surfaces, then **both ids
   stay** and the deliverable is the comment that says so plus a distinct en-US string for each —
   report that outcome rather than forcing a retirement.
2. Retire the loser from `MAIN_WINDOW_MESSAGE_IDS`, `KO_PENDING_REVIEW`, both bundles, and the
   generated typings.
3. Record the surface ownership in `container.ts`, where `ProgressHeadlineSource` and
   `progressHeadline` are declared.
   > **Corrected 2026-10-05.** This step said "Point `container.ts`'s
   > `ProgressHeadlineSource.messageId` at the survivor", which is **a no-op**: that assignment lives in
   > `src/bootstrap/registerUI.ts`, outside this card's `Files`. It already pointed at
   > `research-helper-progress-headline`, and **that is one of the reasons the survivor had to be that
   > id** — retiring the other would have required editing `registerUI.ts` and
   > `test/unit/bootstrap/container.test.ts`, neither listed. **So the card as written could only be
   > executed if the decision went one particular way**, which is a defect in the card, not in the
   > decision.
4. Regenerate `typings/i10n.d.ts` with `npx zotero-plugin build` and verify the four built `.ftl`
   files are byte-identical to `addon/locale/**` (`P0-T32`'s requirement).

**Do NOT.**
- Do not invent an en-US sentence for the survivor. `P1-T32` recorded that **the corpus supplies no
  wording** — `docs/08` §8.2's own example call passes the product name as the headline — and shipped
  the string already on screen so the owner can change one string without touching code. Keep that
  discipline; wording is `G-41`'s and the owner's.
- Do not machine-translate the Korean string (`G-41`, and `P1-T18`'s recorded discipline: a plausible
  wrong translation is worse than a visible gap).
- Do not touch `docs/07` §7.7 or `docs/08` §4.4. If the decision implies a doc amendment, **report
  it** — those sections are outside this card's `Files` and §7.7 was last amended by `P1-T31`.

**Criteria.**
- [ ] No **declaration** and no **string literal** of the retired id survives in `src test addon
      typings`; prose naming the retirement is expected. Or the card reports that both ids survive and
      why.
      > **Reworded 2026-10-05 after the executing agent reported it under rule 6.** It read "returns
      > nothing", which **cannot hold together with `Do` step 1**: step 1 requires writing the reasoning
      > for the retirement, and reasoning that may not name what was retired is not reasoning. The agent
      > measured 6 hits, **all of them comments**, declined to spell the id as `…-import-toast-header` to
      > satisfy a string match — "that contorts the record to satisfy a string match, which is the
      > opposite of rule 6" — and proposed this wording. Zero declarations, zero literals, zero live
      > references, six tombstones; re-verified by the coordinator.
- [ ] `keys.ts` names the surface that owns the surviving id, in a comment, with the §4.4-versus-§7.7
      reasoning.
- [ ] `test/integration/l10n.spec.ts`'s `ko-KR` gap assertion passes with the updated lists — it is
      an exact-set assertion, so a stale list fails it.
- [ ] The progress headline still resolves in `en-US` and still falls back to English under `ko-KR`.
- [ ] `typings/i10n.d.ts` is regenerated, not hand-edited, and the built bundles are byte-identical to
      the source bundles.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run typecheck && npm run test:unit -- container && npm run test:integration -- --exit-on-finish --abort-on-fail`

**Notes.** **This card's `Files` names no test file, and `plan/README.md` §6 requires a reason here —
added 2026-10-05 after the executing agent reported the omission.** The reason: every direction of this
edit except one is already a **compile error** (`P1-T30`'s generated union, plus the `satisfies
readonly FluentMessageId[]` guards), and the one exception — a stale `KO_PENDING_REVIEW` — is caught by
`test/integration/l10n.spec.ts`'s existing exact-set assertion, which is **`P1-T34`'s file and in
flight**. The agent proved both halves by mutation rather than asserting them. Writing a new unit spec
would have duplicated a guard that already exists.

The integration suite is in the `Verify with` deliberately: the `ko-KR` gap assertion and
the live Fluent resolution are both integration-level, and a unit run cannot see either. If the
integration run fails to start with `EBUSY: … unlink '.scaffold\test\profile\cert9.db'`, that is the
known harness leak and **not** a test failure — `zotero-plugin test --exit-on-finish` leaves the
test-profile Zotero running. Terminate that instance **identified by its command line**
(`-profile …\.scaffold\test\profile`), never by process name, because the user's own Zotero runs the
same binary.

**Findings, 2026-10-05 — one surface, so one id. `research-helper-import-toast-header` retires;
`research-helper-progress-headline` survives, owned by `docs/07` §7.7's `Zotero.ProgressWindow`, one
per job.** Verified independently of the report: **843 unit tests in 21 files**, **63 integration**,
typecheck 0, `lint:check` 0, all four built `.ftl` bundles `cmp`-identical to source, and a partition
check over `keys.ts` reading **25 + 59 = 84 declared, 79 + 4 + 1 = 84**, no orphans, no uncovered ids,
no duplicates, and the retired id present as **no literal**.

**The decision rests on a fact that settles it outright: there is no second mechanism for a second
string to belong to.** `docs/08` §8.2.2 searched Zotero 7–10 and found **no notification surface at
all** — no `Zotero.Notifications`, no toast element among the ~55 files in `elements/`, no plugin entry
point to the pane's banners. So §4.4's "completion toast" **is** a `Zotero.ProgressWindow`: the word
names a *timing*, not a mechanism. §7.7 allows one window per job and §4.4 describes the `searchImport`
job, so the completion toast is that job's one window. What the two sections disagree about is **when**
it opens, which is exactly `JobProgressOptions.openOn` — and the shipped code already said so:
`ZoteroProgressWindowSink`'s lifecycle comment reads *"This is the completion toast `docs/08` §4.4 asks
for."* **The implementation had already decided; the corpus had not caught up.**

**Which id survived was forced, not chosen, and that exposed a defect in this card.**
`research-helper-progress-headline` is the id the composition root actually resolves
(`registerUI.ts:236-241`, asserted four times), its name describes the surface rather than one
pipeline, and the `import-` prefix scoped to `searchImport` a string that `ServiceGraphOptions` already
records as application-scoped. Retiring the other one instead would have required editing
`registerUI.ts` and `test/unit/bootstrap/container.test.ts`, **neither in this card's `Files`** — so
**the card could only be executed if the decision went one particular way.** That is a flaw in the card
rather than in the decision, and it is recorded at `Do` step 3.

**Criterion 1 could not hold together with `Do` step 1, and the agent reported it rather than
satisfying it.** The grep returns **6 hits, every one a comment**, and each exists *because* step 1
requires writing the reasoning — reasoning that may not name what was retired is not reasoning. The
agent could have passed by writing the id as `…-import-toast-header` and **declined**: "that contorts
the record to satisfy a string match, which is the opposite of rule 6." Re-verified here: **zero
declarations, zero string literals, zero non-comment references, six tombstones.** The criterion is
reworded above with the reason.

**Every direction of this edit except one is a compile error — and the exception is the whole reason
the integration suite was not optional.** Five mutants:
`UndeclaredBundleMessageId` caught the retired id left in the lists against a stale union
(**which the agent hit for real**, exactly as the hand-out predicted); the `satisfies readonly
FluentMessageId[]` guard caught it left on `KO_PENDING_REVIEW` alone; dropping the **survivor** from
`MAIN_WINDOW_MESSAGE_IDS` and deleting its en-US declaration both failed the typecheck, the latter with
**five errors across three files**. The exception is **M3** — the survivor dropped from
`KO_PENDING_REVIEW` only: **typecheck exits 0, the compiler cannot see it**, and it is caught solely by
`l10n.spec.ts`'s exact-set assertion, which failed with `expected [ …(80) ] to deeply equal [ …(79) ]`.
So that spec really is the arbiter, and `P1-T30`'s generated-union design carries everything else.

**The build-order trap fired for real and the recorded recovery worked.** `npm run typecheck` after
editing `keys.ts` failed with `TS2344: Type '"research-helper-import-toast-header"' does not satisfy
the constraint 'never'` — `UndeclaredBundleMessageId` firing on the **stale committed union**, because
`npm run build` typechecks *before* it regenerates. `npx zotero-plugin build` directly, then clean.
`P1-T32` recorded this trap and the record paid for itself one card later.

**Two agents reached the same answer from the same sections, independently.** `P1-T34` was running
concurrently and wrote into `plan/06` that `P1-T33` had decided the two sections are "one surface, not
two", re-deriving that gate's counts to the post-retirement 79 / 84 — without having been told the
decision. That is not proof, but it is the only corroboration available for a judgement call.

**The documented harness leak did not reproduce, which revises what we know about it.** Across three
integration runs `--exit-on-finish` closed Zotero every time and left no leak. The `EBUSY` the agent
*did* hit was **the other card's live runner** — identified by command line and by a creation time nine
seconds before its own run started — and it **killed nothing**, waited for that PID to exit, and
re-ran. Both agents handled the race correctly without being told which process was whose.
**So the recorded recovery's assumption that the harness always leaks is wrong**; it leaks sometimes,
and the recovery must therefore always identify the process before acting. My own earlier cleanup of
ten leaked processes stands as a real occurrence, not a universal one.

**No doc amendment is implied, and the agent checked rather than assumed.** `docs/08` §4.4's "a
`Zotero.ProgressWindow` toast is raised only on completion" and §8.1's backgrounded-job row both
describe *when* the popup is raised, which stays true; §8.2.2 already says "toast" names no separate
mechanism.

**Reported rather than absorbed.** `ProgressHeadlineSource.messageId` is typed `string`, so a retired
or renamed headline id is a compile error in `keys.ts`, in the bundles and in `registerUI.ts` — but
**not at the port that carries it**. Tightening it to `FluentMessageId` costs nothing (every caller
already passes the literal type) but touches two files outside this card's `Files`. The agent found
**no record of a decision either way** on the current `string` and said exactly that in the doc
comment rather than inventing a rationale. **Needs a small card.** Separately: this card's `Files`
names no test file and `plan/README.md` §6 requires a reason in `Notes` — the agent reported the
schema omission rather than letting it pass, and the reason is now written there.

**`G-41`'s owner decision (2) names the retired id, and both agents left it alone — correctly.** The
decision is unchanged and still owed; only the id it hangs on has moved, to
`research-helper-progress-headline`. `P1-T34` flagged it in place with a dated note; this card
concurred and edited nothing. **It is a one-line edit by the gate's owner, not a card** — a card that
rewrote a gate's decisions would be the wrong instrument.

---
### P1-T34 — Three corpus statements measured false, corrected at the source

| Field | Value |
|---|---|
| **ID** | `P1-T34` |
| **State** | `DONE` — approved 2026-10-07; three statements measured false, corrected at the source, **plus a fourth the card did not name** — `docs/08` §4.1's preamble cited `docs/01` §9.1 as authority for the **opposite** of what §9.1 measures. The deliverable turned out to be the **derivation rule, not the numbers**: `P1-T32` took the counts to 80/85 and `P1-T33` took them back to 79/84, so the old literals are accidentally right again after a spell of being wrong, and the gate now says how to recompute them. The agent **defended against a torn read of `keys.ts` twice**, refusing to snapshot a state in which the three lists did not partition the declared set — stricter than it was asked to be. |
| **Depends on** | `P1-T19`, `P1-T32` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | none |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** Three statements that contradict measured reality say what was measured instead.

**Why these are one card.** All three are the same shape — a corpus statement a card has already
**measured** to be false, each a few lines, none requiring a judgement — and each is too small to
carry its own card. None of them changes any code. Every figure below was verified on 2026-10-02/03
and the measuring card is named, so this card's job is transcription and checking, not investigation.

**1. `docs/08` still writes the chrome namespace unhyphenated in two sections.** Verified: lines 646,
647, 651, 652, 680, 681, 689, **853**, **865** and 891 all say `chrome://researchhelper/...`, including
the prose at 865. §2.4 was corrected on 2026-09-30; these were not.
> **Corrected 2026-10-05, reported by the executing agent.** The heading said "**§4.1**" and the ten
> lines were presented as all being there. They are not: **§3.3 starts at line 632 and §4 at 849**, so
> seven of them (646–689, the item-pane `registerSection` block) are **§3.3**, and only 853, 865 and
> 891 are §4.1/§4.1.1. The line numbers were grepped and are right; **the section attribution was
> written without checking which section the lines fall in** — the same class of error as the two in
> `P1-T32` item 3 and `P1-T33` step 3. `P1-T19` **measured** that the unhyphenated package does not
resolve at all: `chrome://research-helper/content/icons/favicon.png` returns **1723 bytes** and
`chrome://researchhelper/...` **rejects** (`undefined`), and both are now integration assertions.
`P1-T19`'s own `Do` steps 3 and 5 repeated the wrong spelling, which is how it reached an executing
agent.

**2. `docs/08` §10.1 contradicts itself within four lines.** Its file-tree code block shows
`locale/en-US/research-helper/mainWindow.ftl` — a **subdirectory with unprefixed filenames** — while
the table immediately below it says "FTL in `locale/<locale>/` (**flat**, `research-helper-`
prefixed)". The shipped layout is flat and prefixed (`addon/locale/en-US/research-helper-mainWindow.ftl`,
verified), and `docs/01` §9.1 / `P0-T32` establish that Zotero 10's `registerLocales()` **drops
subdirectories**, so the tree as printed would not work. The paragraph *between* the two says "**This
section owns the surface set and its names** … where the two disagree, this list wins and the tree is
the defect" — so the section claims authority over a tree it then prints wrongly. **It is exactly the
kind of block a future card would type straight from.** Found by `P1-T32`.

**3. `G-41`'s headline counts are stale, and a human sizes the gate by them.** Verified:
`plan/06-human-gates.md` says **79** at lines 48 (the gate table), 650 (the heading), 661 (the body)
and 667 ("Three of the 79"), and "all **84** ids" at line 680; `test/integration/l10n.spec.ts:45`
says "79 of their 84 strings". At the time this card was written the live run read **85 declared ids**
(mainWindow 26, searchDialog 59) and `ko-KR totals: 4 present, 81 absent` — i.e. **80** pending review
plus one deliberately absent. `P1-T18` set the original figures and `P1-T32` added the 85th id.
> **These figures moved while the card was being executed — recorded 2026-10-05.** `P1-T33` retired an
> id concurrently, so the live run now reads **84 declared** (mainWindow 25, searchDialog 59) and
> `4 present, 80 absent` — **79** pending plus the one deliberate hole, which is exactly what
> `plan/06` already said. **The literals became correct again by coincidence**, having been wrong in
> between with nothing in the text to say how to recompute them. That is why this card's deliverable
> is the **derivation rule**, not the number, and why the executing agent had to defend against a torn
> read of `keys.ts` to take a self-consistent snapshot at all.

**Read first.**
- `docs/08` §4.1 in full, and §2.4's 2026-09-30 correction, so the fix matches the house pattern for
  a dated in-place correction.
- `docs/08` §10.1's code block, the paragraph under it, and its table; `docs/01` §9.1 on
  `registerLocales()`.
- `plan/06-human-gates.md`'s `G-41` section — **read what the gate asks a human to do** before
  touching its numbers.
- `src/i18n/keys.ts`'s `KO_PENDING_REVIEW` and `KO_DELIBERATELY_ABSENT`, which are where the live
  numbers come from, and `test/integration/l10n.spec.ts`'s exact-set assertion.

**Files.**
- modify `docs/08-ui-ux-spec.md`
- modify `plan/06-human-gates.md`
- modify `test/integration/l10n.spec.ts`

**Do.**
1. Correct §4.1's namespace in both the code blocks and the prose at 865, with a dated note recording
   that the unhyphenated form was **measured not to resolve** and naming `P1-T19`.
2. Correct §10.1's file tree to the flat, prefixed layout that ships, with a dated note naming the
   contradiction and `docs/01` §9.1's subdirectory behaviour.
3. **Re-derive** `G-41`'s counts from `keys.ts` rather than by adding one to the old number, and state
   in the gate section how the figure is derived, so the next id does not silently stale it again.
4. Update `l10n.spec.ts:45`'s comment to match. It is a comment, not an assertion — **do not** turn it
   into an assertion here; the exact-set assertion already exists further down the file.

**Do NOT.**
- Do not change what `G-41` asks a human to do, or its gate semantics. This card touches **counts and
  their derivation only**. The three owner *decisions* inside `G-41` stay exactly as they are.
- Do not change any `.ftl` file, `keys.ts`, or any code. If a count will not reconcile from `keys.ts`,
  that is a finding to report — the lists may genuinely disagree with the bundles, which is what the
  integration assertion exists to catch.
- Do not "tidy" `docs/08` §4.1's `openSearchWindow` code block beyond the namespace. `P1-T19`
  separately measured that it **cannot compile where §4.1 puts it** — it calls `Zotero.getMainWindow()`
  from `src/ui/dialogs/searchDialog.ts`, which `eslint.config.js` rejects twice over — and that is a
  different defect needing its own decision about whether the doc or the layering rule moves.

**Criteria.**
- [ ] `grep -rn 'researchhelper' docs/08-ui-ux-spec.md` returns nothing.
- [ ] §10.1's file tree matches `find addon/locale -type f` exactly in shape, and the dated note names
      the contradiction.
- [ ] `G-41`'s counts equal what `keys.ts` yields, and the gate section says how they are derived.
- [ ] The integration run's `[P1-T18] ko-KR totals` line agrees with `plan/06`'s stated figures.
- [ ] No file under `src/`, `addon/` or `typings/` is modified.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0.

**Verify with.** `npm run lint:check && npm run test:integration -- --exit-on-finish --abort-on-fail`

**Notes.** `plan/06-human-gates.md` is a gate document. A card may re-derive a **measured** number in
it, which is what this one does; it may not change what a gate asks for, who owns it, or whether it is
satisfied. If the distinction is unclear in any specific edit, leave that edit and report it.

The same `EBUSY` harness caveat as `P1-T33` applies to the integration run — see that card's `Notes`.

---

**Findings, 2026-10-05 — all six criteria pass, and the deliverable turned out to be the derivation
rule rather than any number.** Verified independently: `grep -rn 'researchhelper'
docs/08-ui-ux-spec.md` exits 1 with no output; `plan/06`'s five figures are all derivations with dated
snapshots; `l10n.spec.ts:45` is still a comment and not an assertion; exactly **three** files touched,
all in `Files`; **843 unit, 63 integration, typecheck 0, lint:check 0**.

**The numbers came back to where they started, which is the one outcome the card did not anticipate.**
`P1-T32` took the counts 79 → 80 and 84 → 85; `P1-T33`, running concurrently, retired an id and took
them **back to 79 / 84** — exactly the literals `plan/06` already carried. So the *numbers* needed no
change. **In between they were simply wrong, with nothing in the text to say how to recompute them**,
and the agent wrote that history into the gate note explicitly so the coincidence is not mistaken for
the figures never having been stale. Five rules now sit in `G-41`, each a one-line read of `keys.ts`,
plus the instruction that matters: **"if a later card adds or retires an id, re-read the rules, do not
add one to the snapshot."**

**The agent defended against a torn read of `keys.ts`, twice, without being asked to.** Its first read
gave 84 declared but 80 pending — `P1-T33` had removed the retired id from `MAIN_WINDOW_MESSAGE_IDS`
and not yet from `KO_PENDING_REVIEW`, so the three lists did not partition the declared set. **It did
not snapshot that.** It polled for a read that was self-consistent *and* unchanged for 45 s; a second
tear appeared later and settled back. **This is stricter than the instruction it was given**, which
only asked it to timestamp a late read. Re-verified at commit time with a partition check:
25 + 59 = 84 declared, 79 + 4 + 1 = 84, no orphans, no uncovered, no duplicates — **the snapshot still
holds.**

**My own partition check first reported "OK" having parsed zero ids.** It anchored on the list names'
first occurrence, which is a doc comment, and found no array. A check that passes on a parse failure is
worse than no check — the exact vacuous-assertion class these card reviews keep catching in test code.
Rewritten to anchor on `export const NAME = [`, balance the brackets, strip comments so a
commented-out id is not counted, and **throw if any list parses empty**.

**The sharpest find is a fourth instance the card did not name, and it cites its own refutation.**
`docs/08` §4.1's preamble (line 853) said the bundle is "`searchDialog.ftl` in the per-surface locale
folder" **citing `docs/01` §9.1** — and §9.1 is precisely what measures the opposite: Zotero 10's
`registerLocales()` drops directory entries, so the layout is flat and prefixed. **A statement citing
as authority the document that refutes it.** Same file, same measured-false class, same measuring
source, so I accept the absorption rather than calling it scope-widening; the agent flagged it for
that judgement instead of burying it.

**§10.1's tree was corrected without changing the surface set, and criterion 2's literal reading was
refused for a stated reason.** The tree is now flat and prefixed, but it still lists **four** surfaces
while `find addon/locale -type f` returns two plus three `.gitkeep` placeholders — because §10.1
*owns the surface set*, and two of the four are Phase 3 and so have no files yet. They are annotated
`; Phase 3` and the note says what `find` actually reads. **Forcing a literal match would have changed
the surface set**, which the card's `Do NOT` and §10.1's own authority paragraph forbid. The agent
flagged the interpretation rather than deciding it silently — the right instinct, and I agree with the
call.

**One figure could not be reconciled and was reported, not reconstructed.** `G-41` said the
searchDialog strings include "**23** state and status strings". No list in `keys.ts` yields 23; the
file's own state/status grouping is **16**. The clause now reads 16 with its derivation named, and the
note records that "the 23 may have counted a wider set under a definition that was never recorded; it
is reported rather than reconstructed." **Someone who knows what the 23 counted should confirm 16 is
right** — it does not block the gate's headline counts, all of which reconcile.

**Neither dated note can spell the string it is correcting**, because criterion 1 forbids the literal
anywhere in the file — so both say "the same package name with the hyphen removed". A small thing, but
it is what a criterion written as a grep does to the prose around it.

**Three coordinator errors in this card's own text, all mine, all corrected above.** (a) The heading
said "**§4.1**" for ten lines of which **seven are §3.3** — §3.3 starts at 632 and §4 at 849. The line
numbers were grepped and right; the section attribution was written without checking. (b) Item 3's
live-run figures (85 declared, 81 absent) went stale during execution and now read 84 / 80. (c) And
when reporting the "three places" undercount I **misattributed it to this card**, which lists all four
lines correctly — it lives in `P1-T32`'s `Findings`, where it is now fixed. **A card whose whole
subject is figures stated without re-deriving them, carrying three of exactly that defect, is the
point rather than an irony** — and in each case the executing agent caught it.

**`plan/06` is a gate document and the boundary held.** The agent re-derived counts and did not touch
a single gate semantic, and when `P1-T33`'s retirement left owner decision (2) naming a retired id it
**added a dated flag and refused to rewrite the decision**, recording that re-pointing it is the
gate owner's call. That is the correct instrument: a card that rewrites a gate's decisions is the
wrong one.

**Needs a card, raised by both agents and worth taking.** A **unit-level partition assertion** over
`keys.ts` — that `KO_PENDING_REVIEW ∪ KO_PRESENT ∪ KO_DELIBERATELY_ABSENT` partitions
`MAIN_WINDOW_MESSAGE_IDS ∪ SEARCH_DIALOG_MESSAGE_IDS`. `l10n.spec.ts` catches the equivalent gap
against the **built bundles**, which needs a full Zotero run; `P1-T33`'s M3 mutant proved that gap is
**invisible to the compiler**. A sub-second unit check would turn a whole class of half-finished id
edits into an immediate failure — and this card's two torn reads are the evidence that the class is
real rather than hypothetical.

### P1-T35 — Publish the search window's host, so the window stops shipping inert

| Field | Value |
|---|---|
| **ID** | `P1-T35` |
| **State** | `DONE` — approved 2026-10-08; the host is published and the window is live. The view model `P1-T22` built had been **removed entirely by the bundler** until this card constructed it. Criterion 4 is enforced twice from the type. Criterion 5 passes on a quiet machine — 98 tests, three consecutive runs — and the load sensitivity behind the earlier failures is `plan/00` §6 item 20, which **gates `P1-T23`**. |
| **Depends on** | `P1-T16`, `P1-T17`, `P1-T22` |
| **Blocks** | `P1-T23`, `P1-T36` |
| **Retires** | none |
| **Implements** | part of `FR-1`, part of `FR-8` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** Pressing Search in a real Zotero does something: the window finds its host, the host drives
`P1-T16`'s pipeline, and the provenance note lands in the collection.

**Why this is a card, and why it blocks `P1-T23`.** Everything the window needs exists and **nothing
connects it.** Measured 2026-10-07, after `P1-T22` landed:

- `src/addon.ts:64` sets `this.api = {}` and **nothing writes to it**. The window looks for its host at
  `Zotero.<addonInstance>.api.searchWindow` and falls back to an empty object, so **every control is
  inert in a real Zotero.**
- The run-time graph **does** exist. `src/hooks.ts` awaits `registerUI()`, which calls
  `installServices()` at line 267, and `installServices` calls `registerSources()` itself. So at run time
  there is a filled source registry, a preference store, an HTTP client, a pipeline registry and
  `ServiceGraph.pipelineContext` (declared at `container.ts:830`, constructed at `:1419`).
- What is missing is that **`registerUI()` holds the graph nowhere.** That is deliberate and the file
  says why at line 258 — and **the reason has expired**:

  > "nothing in Phase 1 yet has a pipeline to hand the fourth to, and the typed service locator is
  > `P1-T16` step 7's — it `create`s this path for that. Standing up a holder with no consumer is the
  > dead code `P0-T07` declined to write for the same reason."

  `P1-T16` landed and built the pipeline. **There is now a consumer**, so the holder is no longer dead
  code. This card is that consumer arriving, not a reversal of `P0-T07`'s judgement.
- `P1-T22` built the host object itself — `createSearchImportViewModel(...).host`, typed as
  `SearchWindowHostApi` — and named the property in `SEARCH_WINDOW_API_PROPERTY`. **The only place the
  end-to-end path currently runs is `test/integration/searchDialog-flow.spec.ts`, which installs the host
  itself.**

> **Two claims in this card were measured false by the executing agent and are corrected above
> (coordinator, 2026-10-07).** The first read "`grep -rn '\.api\b' src/` returns **that line and nothing
> else**"; the grep returns **fourteen** lines — three doc comments in `src/ui/dialogs/searchDialog.ts`,
> two more in `src/addon.ts`, and the publication sites this card added. The claim that nothing *writes*
> to `api` was correct; the claim about the grep's output was not checked. The second said **three**
> members of `SearchImportViewModelDeps` are required and then listed six; **six are required and five
> optional**. Both are `plan/README.md` §5 rule 8 instances: a line number was right and the sentence
> built on top of it was not re-read.

**Read first.**
- `src/bootstrap/registerUI.ts` lines 250–270 — the paragraph quoted above, and what `installServices`
  is already handed. **Do not delete that paragraph; amend it**, so the next reader sees why the holder
  exists now and did not before.
- `src/ui/viewModels/searchImportViewModel.ts`'s `SearchImportViewModelDeps` — **six members are
  required** (`pipeline`, `jobs`, `logger`, `pluginVersion`, `zoteroVersion`, `clock`) and **five are
  optional** (`listSources`, `listCollections`, `getPrefs`, `isExisting`, `writeProvenanceNote`). **An optional member left out compiles and degrades silently**, which is the
  failure mode this card has to avoid: a window that opens, searches, and quietly writes no provenance
  note.
- `src/zotero/notes.ts`'s `writeProvenanceNote` and `src/zotero/libraryIndex.ts` (or whichever module
  `P1-T13` shipped the existing-item check in — **grep for it, do not assume the path**). `bootstrap/` may
  import `zotero/`; `registerUI.ts` already imports `createZoteroPrefStore` from there.
- `src/addon.ts` — how `hooks` is assigned, and what type `api` has.
- `docs/07` §2.3 — the layering. `src/ui/` may **not** import `src/zotero/**`, which is exactly why the
  two platform ports are injected rather than imported by the view model.
- `P1-T22`'s `Findings` in this file, for what it verified and what it left.

**Files.**
- modify `src/bootstrap/registerUI.ts`
- modify `src/addon.ts`
- modify `test/integration/searchDialog-flow.spec.ts`

**Do.**
1. Hold the `ServiceGraph` that `installServices()` returns, in `registerUI()`, and amend the paragraph
   that explains why it was not held.
2. Build the host from `createSearchImportViewModel`, supplying **every** optional dependency the view
   model declares — including `isExisting` and `writeProvenanceNote`, bound to the platform modules.
3. Publish it on the plugin instance at the property `SEARCH_WINDOW_API_PROPERTY` names, so the window's
   own lookup finds it. **Do not respell that property here**; import the constant.
4. Make the integration spec prove the **published** host, not a host the spec built: it should read the
   host from the plugin instance the way the window does, and fail if it is absent.
5. Assert that **no optional dependency is silently missing** — a test that enumerates the view model's
   optional members against what the composition root supplies, so adding one later without wiring it
   fails here rather than degrading in a user's library.

**Do NOT.**
- Do not change `SearchImportViewModelDeps`' shape, and do not make an optional member required. The
  optionality is what lets the unit tests construct a view model without a platform; the fix for silent
  degradation is an assertion at the composition root, not a type change.
- Do not import `src/zotero/**` from `src/ui/**`. That is `docs/07` §2.3 and the one layering arm ESLint
  does enforce.
- Do not build a second service graph. `installServices` refuses one, and `P1-T22` recorded that as the
  reason its spec cannot draw the completion popup.
- Do not add a preference pane, a JSON-export action, or any missing Fluent message. Each is its own card
  and `P1-T22` listed them.
- Do not touch `addon/content/searchDialog.js` or the window markup. The window already looks in the
  right place; this card is the other half.

**Criteria.**
- [ ] In a real Zotero, the window's own host lookup returns an object with **every** member of the
      documented contract, asserted through the plugin instance rather than through a spec-built host.
- [ ] A search started from the window reaches `P1-T16`'s pipeline and fills the table, with no part of
      the path supplied by the spec.
- [ ] An import writes the collection, the items **and exactly one provenance note**, with the note's
      presence asserted — this is the member most likely to be left unbound.
- [ ] Every optional member of `SearchImportViewModelDeps` is supplied, asserted by enumeration so a
      later addition cannot be forgotten silently.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` all exit 0, and
      `npm run test:integration` passes with no fewer tests than before.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** **This card is where `P1-T23` becomes possible**, so its criteria are deliberately about the
*published* path rather than about new behaviour: everything it wires has already been tested by the card
that built it. The risk is not that a piece is wrong but that a piece is **not connected and nothing
says so** — which is why criterion 4 exists and why criterion 3 names the provenance note specifically.
`P1-T22` measured that the note's binding has to be made in `bootstrap/`, because `src/ui/` may not reach
`src/zotero/notes.ts`.

The installer size is a useful tell: `P1-T22` left it at **121,920 bytes**. If this card's wiring is
reachable the number must move, and `src/zotero/notes.ts` should appear in the bundle for the first time
— it has read **zero** occurrences across four cards.

**Findings, 2026-10-08 — the window is live: a search started from the document now reaches the pipeline
and writes items, a collection and one provenance note, with no part of the path supplied by a spec. All
five criteria pass, criterion 5 only after a disagreement about measurement that the coordinator lost.**

**Verified by the coordinator on a quiet machine:** typecheck 0, `lint:check` 0, 1,194 unit in 27 files,
28 contract, installer **121,920 → 131,919 bytes**, and `npm run test:integration` at **98 passed, 0
failed, three consecutive runs**. Exactly the card's three files were touched and `grep -rn MUTANT` is
clean.

**The single most telling number is one nobody asked for: `createSearchImportViewModel` read **zero**
occurrences in the shipped bundle before this card.** Not the host, not the binding — **the entire view
model `P1-T22` built was being removed by the bundler**, because nothing constructed it. `src/zotero/
notes.ts` likewise appeared for the first time, note writer, note renderer and note title together. The
window was not merely inert; the code behind it was not in the installer at all.

**Criterion 4 is enforced twice, from the type rather than from a list of today's names.** At compile time
the composition root's dependency builder returns `Required<SearchImportViewModelDeps>`, so adding any
member — optional or not — fails `npm run typecheck` until it is wired, while the interface's own
optionality is untouched and unit tests can still build a view model with no platform. At run time the
spec enumerates `Record<keyof SearchImportViewModelDeps, true>` against the keys the plugin actually
published. **The staleness claim was tested rather than asserted**: a temporary optional member made both
halves fail with named `TS2741`s, quoted in the report, and was removed.

**A diagnostic that bricked the plugin, found by a mutation and worth more than the mutation.** With
`listSources` forced to `undefined` the run died with `Plugin awaiting timeout` and **zero tests
collected** — because the new "host is published" log line called `deps.listSources().length`, so the
diagnostic itself threw, the exception left `registerUI`, and startup never completed. **A diagnostic
that bricks the thing it describes is the opposite of a diagnostic.** Fixed to read the registry size off
the graph, re-mutated, and now caught by the enumeration test like the other four. Fifteen mutations in
all, every one reverted; one assertion could not be broken and is **reported as a redundant guard rather
than counted as coverage**, with the defect class it would catch named.

**Criterion 5, and the coordinator's own error, recorded because the next reader should trust the method
rather than the verdict.** Three tests in `P1-T22`'s block failed in the executing agent's runs. The
agent reported them as **pre-existing**. The coordinator measured one run per condition — clean tree 93
passed, work restored 95 passed and 3 failed, work restored with only the new `describe` skipped 93
passed — and concluded from those three samples that the card had caused a **regression**, saying so to
the owner and returning the card. **That conclusion was wrong.** The agent had measured **25 runs** with
the two trees alternated in matched pairs, and on re-measurement afterwards the clean tree ran green
**four times out of four** and the finished tree **three times out of three at 98 passed**. One sample
per condition cannot distinguish a code effect from a load effect, which is the very trap this phase had
already recorded twice — `P1-T22` raised a wait cap for it, and the memory note about leaked test
profiles exists because of it. **The agent's refusal to fix `P1-T22`'s tests from inside this card was
correct**, and so was its diagnosis.

**What the failures actually are, measured by the executing agent across 25 runs.** Fluent's latency in
this window is **bimodal per run**: the first test in `P1-T22`'s block costs about 30 ms in a passing
run and about 1,010 ms in nearly every failing one, and the cost then roughly doubles per test — 1.0,
2.0, 4.0, 8.0 seconds — until the import lands on 22.92–22.99 s against a 25,000 ms cap, in 21 of the 25
runs that reached it. The waits are on **transient** text that the run has already replaced by the time
the translation lands. Two candidate causes were measured and **refuted**: background-timer clamping
(`Zotero.Promise.delay(25)` delivered 29–33 ms inside a failing run, six samples) and the `ko-KR`
application locale `l10n.spec.ts` leaves behind (identical in passing and failing runs — worth knowing
on its own, since every later spec then renders through a fallback chain). **The fix is to change what
those tests wait on — a view-state tap instead of rendered text for states that are transient — and that
is its own card, not this one's.**

**One scope note reported rather than absorbed, and it is a layering gap.** `zoteroVersion` and
`listCollections` are required by the view model and have **no facade in `src/zotero/`**: grepped
2026-10-07, `Zotero.Collections` was called only at `src/zotero/collectionOps.ts:135–136` and
`Zotero.version` was called **nowhere**, every other mention being a comment. The lint rule forbids the
`Zotero` global outside `src/zotero/**`, `addon/**` and the three lifecycle entry files, and
`registerUI.ts` is not among them — **so this card's own premise, that the platform ports can simply be
bound in `bootstrap/`, is true for the note writer and the existing-item check and false for these
two.** They were put on `src/addon.ts`, which is in the `Files` list and is the sandbox boundary
`docs/07` §2.2 describes, following the shape already there for the error reporter. The right homes are
beside `userLibraryID()` and `findOrCreateCollection()`; that is `plan/00` §6 item 14.

**Four corpus statements measured false, each with a file and line.** `src/pipeline/registry.ts:18–25`
makes two: `get()` is typed `Pipeline<never, unknown>` and not `Pipeline<unknown, unknown>`, and the
claim that a caller "is better served by being handed the concretely-typed pipeline at the construction
site (which is what `installServices` does)" is false — `PipelineSet.searchImport` is itself erased at
`:145`, so the composition root **cannot** avoid the cast that paragraph says it avoids, and this card
carries one with the quotation beside it. Two doc comments now say the opposite of the truth and are
outside this card's `Files`: `src/ui/dialogs/searchDialog.ts:182` and
`test/integration/searchDialog-table.spec.ts:47`. And **two claims in this card's own text**, corrected
above with a dated note.

**What the integration block can and cannot reach, stated rather than glossed.** `SourceRegistry.register`
throws on a duplicate and the interface declares no unregister, so the real PubMed adapter **cannot** be
replaced by a stub and the new block registers its stub under a spare identifier. No bundle names a
display name for that identifier, so the new block's Source column shows the documented fallback and the
localized-name path stays covered by `P1-T22`'s block, which drives its own registry. Both blocks and the
reason for the split are written into the file's header. **Zero network requests were made**, in this
block or anywhere in the card's work, and real library items were created and erased every run.

**Security.** No access key reached any file, preference, log, note, export, clipboard or repository. The
three surfaces `P1-T22` closed stay closed: the empty-state headline is still deliberately unpopulated,
the error disclosure still carries code and status only, and the collection name still never comes from
the keyword box. No second redaction rule was written; the note binding is handed the already-redacted
record, with that fact recorded at the binding. Certificate verification was never disabled.

**Needs a card.** The flaky waits above, which is the one that gates `P1-T23`. Then the six items now in
`plan/00` §6.3: the two platform facades, the two stale doc comments, `src/pipeline/registry.ts`'s
header and whether `ServiceGraph` should expose the concretely-typed pipeline, a test seam on
`SourceRegistry` or a recorded decision that it has none, what the application-scoped view model should do
when a window is closed and reopened, and whether a library-index rebuild belongs on every Search press.

---

### P1-T36 — FR-8's "Export provenance as JSON" control, and the record it needs to still exist

| Field | Value |
|---|---|
| **ID** | `P1-T36` |
| **State** | `TODO` |
| **Depends on** | `P1-T22`, `P1-T35` |
| **Blocks** | `P1-T23`, `P1-T45` |
| **Retires** | none |
| **Implements** | the third scenario of `FR-8` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A user who has just run a search can write that run's provenance record to a file of their
choosing, and the file validates against `schema/provenance.schema.json`.

**Why this is a card, and why it blocks `P1-T23`.** Phase 1's completion criterion 4 has two halves — the
provenance note, and the JSON export. **The note half passes and the export half cannot be checked at
all**, because no control exists to press. Measured 2026-10-07:

- `FR-8`'s third scenario is explicit and names the action in the user's own words: *"**When** the user
  chooses "Export provenance as JSON", **Then** a JSON file matching the documented schema is written to a
  user-chosen path"* (`docs/10` §FR-8). So the behaviour is specified; only the surface is not.
- Both halves of the machinery already exist and **nothing calls either**. `exportJson` is at
  `src/core/provenance.ts:398`; `exportProvenanceJson` at `src/zotero/notes.ts:339`, a one-line
  convenience over it; `provenanceFileWriter` at `src/zotero/notes.ts:323`, which writes through
  `Zotero.File.putContentsAsync`. **No product code calls either.**
  > **Corrected 2026-10-08 after the executing agent measured it.** This read "a grep for callers of either
  > export function across `src/`, `addon/` and `test/` returns **zero**", which is false for one of the
  > two: `exportJson` was already called by its own unit test at `test/unit/core/provenance.test.ts:799`
  > and by `exportProvenanceJson` itself at `src/zotero/notes.ts:343`. `exportProvenanceJson` had zero
  > callers and **still has zero**, because this card deliberately calls `exportJson` through the port so
  > the serialisation stays in `src/core/`. The claim that nothing in the **product** called either was
  > right; the sentence built on top of it was not checked. `plan/README.md` §5 rule 8.
- **The record is built and then dropped on the floor.** At
  `src/ui/viewModels/searchImportViewModel.ts:1475` the import handler composes the record, redacts it,
  hands it to the note writer, and returns — the record is a **local `const` inside that handler** and
  nothing retains it. So even with a button wired to `exportProvenanceJson`, **there would be no record to
  pass it.** Retaining the record is the real work of this card; the file writing is already done.
- **`docs/08` specifies no export control anywhere.** §4.5's wireframe ends with
  `[  Close  ]  [  Import 28 items  ]`, and a grep of every document for an export control finds only the
  source-tree comment (`docs/07`:179), the roadmap lines (`docs/11`:77, :89) and the test and release
  checklists (`docs/13`:571, :1273). **Where the control goes is therefore a decision this card makes, not
  one it looks up** — see *Placement* below.
- A file-chooser has **never been opened by this project**. `FilePickerHelper` is on `P0-T02` fix 8's list
  of individually imported toolkit helpers (`addon/bootstrap.js`:56, `docs/01` §4.6 item 8), and
  `docs/01`:436 records one constraint on the underlying interface: *"`BrowsingContext` must be passed to
  `nsIFilePicker.init`."* Nothing in `src/` or `addon/` imports or uses either name.

**Read first.**
- `docs/10` §FR-8, all three scenarios. The third is this card; the first two shipped in `P1-T22`.
- `src/ui/viewModels/searchImportViewModel.ts` around line 1475 — where the record is composed and
  discarded — and `SearchImportViewModelDeps` (lines 557–586) for which members are required and which
  optional. `P1-T35` asserts by enumeration that **every** optional member is supplied at the composition
  root, so a new optional dependency added here **must be bound there too or that test fails**. That is
  deliberate: it is the guard that stops this card degrading silently the way the note binding did.
- `src/zotero/notes.ts` lines 320–344, and `src/core/provenance.ts`'s `exportJson` and
  `serializeProvenance`.
- `docs/07` §2.3 — the layering. `src/ui/` may **not** import `src/zotero/**`, so the writer and the
  file-chooser are injected, exactly as `P1-T35` injects the note writer and the existing-item check.
- `addon/content/searchDialog.xhtml` lines 417–433 — the status bar, whose Cancel button is `hidden="true"`
  in the markup and revealed by state. That is the idiom the *Placement* default copies.
- `P1-T22`'s and `P1-T35`'s `Findings` in this file.

**Placement — a decision, with the reasoning, because no document settles it.** Export the record of the
**run the window is currently showing**, from a control in the status bar (`#rh-search-status-bar`),
`hidden` until a record exists and revealed when one does — the same hidden-until-relevant pattern the
Cancel button in that row already uses. Reasons: the record exists only after a run, the status bar is
where that run's outcome already speaks, and the row already holds a spacer and a state-toggled button, so
no new layout is invented. The two alternatives considered and **not** taken: the selection row
(`#rh-results-selection-row`, verified to hold three buttons, a spacer and the count) is about which rows
are picked, not about the run; and an entry on the provenance note in the library would mean parsing the
note's HTML back into a record, which is a new parser and a second source of truth. **This is an owner's
decision and may be overturned** — if the owner moves it, only the markup, the handler and one Fluent
string move with it.

**Files.**
- modify `src/ui/viewModels/searchImportViewModel.ts`
- modify `src/bootstrap/registerUI.ts`
- modify `addon/content/searchDialog.xhtml`
- modify `addon/content/searchDialog.js`
- modify `addon/locale/en-US/research-helper-searchDialog.ftl`
- new `test/unit/ui/searchImportViewModel-export.test.ts`
- modify `test/integration/searchDialog-flow.spec.ts`

**Do.**
1. Retain the run's record in the view model after the import handler composes it, and expose an export
   action on the host that writes it. **Retain the redacted record**, the one `redactSearchProvenance`
   returns — never the unredacted one — so that what is retained is already safe to write.
2. Add the destination-chooser and the file writer as **optional** dependencies of
   `SearchImportViewModelDeps`, and bind both in `src/bootstrap/registerUI.ts` beside the two ports
   `P1-T35` binds there. `src/ui/` must not reach `src/zotero/**`.
3. **Work out which scope can supply the `BrowsingContext` that `docs/01`:436 requires, and write the
   answer into the `Findings`.** The window has a window; the composition root may not. If the chooser has
   to be opened from the window script and the path handed inward, say so — that is a legitimate shape and
   it keeps the toolkit helper out of `src/`.
4. Add the control per *Placement*, its Fluent label, and messages for the two outcomes a user can see:
   written, and failed. No string for "cancelled" — a user who dismisses the chooser knows they did.
5. Unit-test the retention and the export action at layer one: a record is retained after a run, a second
   run replaces it, the export action passes **that** record to the writer, and an export attempted with no
   record is refused rather than writing an empty file.
6. In the integration spec, run a search, export to a temporary path, **read the file back and validate it
   against `schema/provenance.schema.json`**, then delete it. `docs/13`:1273 makes that validation a
   release-checklist item, so assert it here rather than leaving it to a human.

**Do NOT.**
- Do not write a second redaction rule, anywhere, for any reason. `src/core/provenance.ts` is the project's
  single gate and `serializeProvenance` is the only way the record becomes text.
- Do not retain the unredacted record "in case the export needs more detail". It does not, and a retained
  unredacted record is a leak waiting for the next feature to find it.
- Do not put the chosen path into the provenance record, the note, or the exported file. **Check `docs/09`
  for whether a chosen filesystem path may be written to the log; if it does not say, log the outcome
  without the path and record the question in the `Findings`** — a path can carry an account name.
- Do not make any existing member of `SearchImportViewModelDeps` required, and do not change the shape of
  the ones that exist. `P1-T35` recorded why the optionality stays.
- Do not add the preference pane, the query-free headline identifier, or the per-source import counts.
  Each is its own card; `P1-T22` listed them.
- Do not change `exportJson` or `exportProvenanceJson`. They were written for this caller and this card is
  that caller arriving.

**Criteria.**
- [ ] After a search and import in a real Zotero, the control is visible, and pressing it writes a file to
      a path the user chose.
- [ ] The written file **validates against `schema/provenance.schema.json`**, asserted by reading the file
      back in the integration spec rather than by eye.
- [ ] The exported record is the redacted one: a test proves that a value the redactor removes is absent
      from the file's bytes.
- [ ] The export action with no record present does not write a file.
- [ ] `P1-T35`'s enumeration test still passes, with the new optional dependency bound.
      > **Corrected 2026-10-08: "two" was wrong, and only one such dependency can exist.** Measured by the
      > executing agent: the destination chooser cannot be bound at the composition root, for three
      > independent reasons. `docs/01:436` requires a `BrowsingContext` for `nsIFilePicker.init` and only a
      > window has one; the view model is built once at startup and has no window; and
      > `eslint.config.js`'s `research-helper/zotero-global` rule does not exempt
      > `src/bootstrap/registerUI.ts`, so that file cannot name the `Zotero` global to borrow one. **So the
      > chooser belongs in the window document and the chosen path is handed inward** — which is the shape
      > step 3 called legitimate, and it keeps `nsIFilePicker` out of `src/` entirely.
- [ ] `npm run typecheck`, `npm run lint:check`, `npm run test` and `npm run test:integration` all exit 0,
      with no fewer tests than before.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** **This card closes the second half of Phase 1's completion criterion 4**, which is why it blocks
`P1-T23`. The order matters: `P1-T35` publishes the host, and this card adds a method to a host that is
already reachable — attempted in the other order, the control would be inert for the same reason every
other control was.

The risk here is not the file writing, which is one existing line, but **the record's lifetime**. A record
retained too long is stale (a second run must replace it), a record retained unredacted is a leak, and a
record not retained at all is the state the code is in today. Criteria 3 and 4 are the two ends of that.

**Findings, 2026-10-08 — the record now survives the run that made it, the export writes a
schema-valid file in a real Zotero, and the control that would press it cannot be built inside this card's
`Files` list. Five criteria pass; criterion 1 is reported under rule 6 rather than adjusted.**

**Verified by the coordinator:** typecheck 0, `lint:check` 0, **1,208 unit in 28 files** (from 1,194 in
27), 28 contract unchanged, installer **131,925 → 132,417 bytes**, exactly four files touched and the fifth
new. The integration suite was run three times: **97 passed with 3 failed, 97 passed with 3 failed, then
100 passed** — the three failures are the known load-sensitive ones in `P1-T22`'s block, named in
`plan/00` §6 item 20, and **neither of this card's two new integration tests failed in any run**. The
executing agent saw the same thing across eight runs, green in seven.

**That makes item 20 more urgent than its size suggests.** It is a 0.25–0.5 d fix, and on this machine the
suite now fails more often than it passes. **`P1-T23` cannot be run until it lands**, because a
definition-of-done run that is a coin toss settles nothing.

**The retention was the work, and its lifetime is three rules with a test each.** One variable holds the
**redacted** record — the value `redactSearchProvenance` returns — set immediately after the redaction
call, cleared at the **start** of every run so a search that replaces the table also replaces what can be
exported, and never set from an unredacted value because the handler never binds one to a name. The export
action returns one of five plain values rather than message references, so a later card can render them
without changing the method.

**Why the control is missing, measured rather than argued, and the measurement is the finding.** Three
Fluent strings are needed — a button label and two outcome messages. The agent appended **one probe
message** and ran the build: the build regenerated `typings/i10n.d.ts`, and `npm run typecheck` then
failed with `TS2344: Type '"research-helper-search-probe-mutant"' does not satisfy the constraint 'never'`
— `UndeclaredBundleMessageId` at `src/i18n/keys.ts:423–433`, which exists precisely to make a bundle
message with no assigned surface a compile error. **So every new user-visible string in this project
requires `src/i18n/keys.ts` and the regenerated `typings/i10n.d.ts`, and neither is in this card's
`Files`.** Two further consequences the agent measured: a new string raises `KO_PENDING_REVIEW`, which is
the count the Korean gate `G-41` publishes — **so the card's `Human gate: none` was wrong** — and the
`ko-KR` bundle needs a stub for each id. **A button with no label is worse than no button**, so nothing
was added to the markup and three of the seven `Files` rows were deliberately left untouched. The probe
was removed and both files verified byte-identical by hash.

**Eighteen mutations, and three of them are reported as unbreakable-alone rather than counted as
coverage.** Retaining the **unredacted** record cannot be caught from outside the module, because
`serializeProvenance` runs the gate again on the way out and the gate is repeatable, so the bytes on disk
are identical either way; bypassing the gate on the way out cannot be caught alone for the mirror reason;
**the two together are caught.** So the redaction assertion is a layered guard whose real defect class is
"a future export path skips `serializeProvenance` while something upstream retains a raw record" — worth
having, and weaker than the criterion's wording. The third, `retained ??= provenance`, is an **equivalent
mutation**: the record is cleared before every run, so `??=` always assigns. Paired with the clear removed
it becomes a real defect and is caught. **What holds the no-raw-retention rule is code shape plus the
gate's repeatability, not a test**, and the agent said so plainly instead of claiming the test proved it.

**A trap hit and correctly diagnosed.** While reverting a mutation a brace was left unbalanced; the run
exited 1 with `Tests no tests` and a parse error. **At the exit-code level that is indistinguishable from
a caught mutation** — only the per-test detail showed nothing had run. Same class as the
reporter-name trap, and the reason every mutation in the report carries a named test and its message.

**A behaviour of the single redaction gate that corrected one of the agent's own assertions.** The two
free-text fields of the record are cleaned by **different** mechanisms: the user's query goes through the
text redactor, which substitutes a marker, while the per-source transmitted query goes through the
query-string redactor, which **removes the whole parameter** rather than marking its value
(`src/core/provenance.ts:183–189` and `:275`). A first draft expected a marker in both places and failed
against unmutated code. Both assertions now match the measured behaviour, and the distinction is written
into the test file.

**The credential-shaped test string is 48 characters, not 32, and the reason is worth keeping.** The
last-resort redaction pattern starts at 40 characters and the key shape this project worries about is 32.
**A test using 32 characters and watching the value survive would be asserting the hole rather than the
gate** — which is exactly what `P1-T42` exists to close.

**One decision taken, with the shipped behaviour as the reason.** The view model is built once at startup,
not once per window, so closing and reopening the window does **not** clear the retained record, and
`connect()` was deliberately left not clearing it: the view state is not reset either, so a reopened window
still shows the previous run's table, and clearing the record would refuse to export the very run the user
is looking at. **The record and the screen always agree.** What an application-scoped view model should do
across a reopen is `plan/00` §6 item 18, and this card follows what ships rather than pre-empting it. An
owner may overturn it.

**The scope of the export, stated because it will surprise someone.** `docs/07:2073` makes a database row
the authoritative copy and says the export "serialises the stored object rather than re-parsing the note" —
and Phase 1 ships **no plugin-owned database**; `P2-T17` creates the table. So until then the retained
value **is** the stored object, and the export's reach is **one plugin session**. Recorded in the code.

**The question this card was asked to record, now answered.** `docs/09` makes **no statement** about
whether a user-chosen file-system path may be written to the debug log — the agent checked §2.1, §2.2 and
§3.2's egress table. The implementation follows the card's `Do NOT` to the letter and an assertion enforces
it. **The owner answered on 2026-10-08: do not log the path.** `docs/09` §2.2 now says so.

**Needs a card.** The control, its three strings and the file chooser — the highest-value one, because the
host method it calls already exists and is tested, and because it closes Phase 1's completion criterion 4.
It **carries `G-41`** and must say so. The chooser's shape is already decided and recorded: open it in the
window document, hand the path inward. Then: a shared test helper for the schema validator, which now
exists twice because the unit copy imports the test framework and Node's file system and the Zotero sandbox
has neither — the duplication is written into the spec with its reason rather than hidden.

---

### P1-T37 — Carry a named, redacted subset of an error's context, so the error rows that cannot render start rendering

| Field | Value |
|---|---|
| **ID** | `P1-T37` |
| **State** | `TODO` |
| **Depends on** | `P1-T22` |
| **Blocks** | none |
| **Retires** | part of `UNRENDERABLE_ERROR_ROWS` |
| **Implements** | part of `NFR-14`, part of `docs/08` §8.3 |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A timed-out request and an unreachable host each render the sentence `docs/08` §8.3 writes for
them, naming the host and the number of seconds, instead of falling through to the generic row.

**Why this is a card.** Three of `docs/08` §8.3's error rows **cannot be drawn at all today**, and the
reason is one missing member rather than three missing features. Measured 2026-10-07:

- `src/ui/viewModels/searchImportViewModel.ts:434` declares `UNRENDERABLE_ERROR_ROWS = ["RATE_LIMIT",
  "TIMEOUT", "NETWORK"]`, and the comment above it records exactly what each row is missing:
  `RATE_LIMIT` wants `seconds`, `TIMEOUT` wants `host` and `seconds`, `NETWORK` wants `host`. All three
  fall through to `genericSourceError`, which names the database and offers Retry.
- **The values exist at the throw site and are thrown away at the serialization boundary.**
  `src/core/errors.ts:170` declares `SerializedError` with six members and **no context**, while
  `AppError.context` (`:216`) is documented as "MUST already be redacted by the thrower". `toSerialized`
  (`:256`) copies `code`, `messageKey`, `detail`, `retryable`, and lifts `httpStatus` and `stack` —
  **`httpStatus` is lifted as a public class member, through a cast, not read out of `context`.** That is
  the precedent this card should follow rather than invent a new mechanism.
- What each thrower already has, measured in `src/core/errors.ts` lines 294–341 and
  `src/core/http/client.ts` lines 728–743:
  - `TimeoutError(timeoutMs, url)` — **`timeoutMs` is already a public `readonly` member**, so `seconds`
    is one division away. Its context holds `url: redactUrl(url)` and `timeoutMs`. **No host member.**
  - `RateLimitError(status, retryAfterMs, host)` — **`retryAfterMs` is already a public `readonly`
    member**; `host` is a plain constructor parameter and reaches `context` only.
  - `NetworkError` and `OfflineError` have **no constructor of their own**; the call site passes
    `{ url: error.url, method: error.method }`.
- **`RATE_LIMIT` will still not render after this card, for a reason this card must not paper over.**
  `UNRENDERABLE_ERROR_ROWS`' comment records it: "Retrying in {n}s" asserts an automatic retry, and
  `src/bootstrap/container.ts` supplies **no `retryFor`**, so the client makes one attempt and nothing
  retries. `P1-T28` owns that behind a human gate. **This card closes `TIMEOUT` and `NETWORK` and leaves
  `RATE_LIMIT` in the constant with its reason narrowed to the retry policy alone.**

**The one defect to fix on the way, found while measuring this.** `TimeoutError` redacts its URL at the
throw site; **`NetworkError` and `OfflineError` do not** — `client.ts:731` and `:741` pass `error.url`
raw into a context whose own documentation says it must arrive redacted. Nothing reads it today, so
nothing leaks today: `src/core/logger.ts`'s `redactValue` (`:195`) treats an `Error` value as
`{ name, message, stack }` and **never walks `context`**, verified by reading that branch. But this card
is the first reader of that context, and **a contract violation becomes a leak the moment someone obeys
the contract.** Fix both call sites with `redactUrl`.

**Read first.**
- `src/ui/viewModels/searchImportViewModel.ts` lines 395–440 — the table of what each row needs, and the
  constant. The comment there is the specification for this card; read it before reading anything else.
- `src/core/errors.ts` lines 160–180 (`SerializedError`) and 240–270 (`toSerialized`, and how
  `httpStatus` travels).
- `docs/07` §5.2 at lines 1995–2003, which declares `SerializedError`, and `src/core/errors.ts:14`
  and `:160`, which both say the declaration is transcribed **verbatim**. Widening it is therefore a
  documented change to the architecture document, not a local edit — `docs/07` §11.1's closing rule.
  `docs/07:3317` carries a second copy of `toSerialized`; check whether it needs the same amendment.
- `src/core/http/client.ts` lines 722–748, the one function that builds all four transport errors.
- `addon/locale/en-US/research-helper-searchDialog.ftl` — whether the three rows' messages exist as ids
  already, or whether this card adds them. **Grep; do not assume.**

**Files.**
- modify `src/core/errors.ts`
- modify `src/core/http/client.ts`
- modify `src/ui/viewModels/searchImportViewModel.ts`
- modify `docs/07-architecture-and-data-model.md`
- modify `test/unit/core/errors.test.ts`
- modify `addon/locale/en-US/research-helper-searchDialog.ftl` (only if the ids are missing)

**Do.**
1. Decide how the two values travel, and **write the reason into the code**. The constraint is that
   **an open record must not cross into the view layer**: `context` is redacted only by the thrower's own
   discipline, while everything in `SerializedError` has been through
   `src/core/provenance.ts`'s and `src/core/errors.ts`' gate. A pair of narrowly typed optional members
   is the shape this card expects — a host string and a seconds number — carried the way `httpStatus`
   already is. If measurement says otherwise, say so and do the other thing.
2. Amend `docs/07` §5.2 in the same change, and say in the amendment **why** the member exists, so the
   next reader of the "verbatim" claim finds the widening rather than a contradiction.
3. Give `NetworkError` and `OfflineError` their host, and **redact the URL at both call sites.**
4. Make `TIMEOUT` and `NETWORK` render their §8.3 sentences, and remove exactly those two from
   `UNRENDERABLE_ERROR_ROWS`. **Leave `RATE_LIMIT` in it**, and rewrite its recorded reason so only the
   retry-policy half remains.
5. Assert that a host reaches a view and **a path and a query string never do** — the test that matters
   here is the negative one.

**Do NOT.**
- Do not add `context` itself, or any `Record<string, unknown>`, to `SerializedError`. That is the one
  shape this card exists to avoid: it would put arbitrary thrower-supplied text in front of a view with
  no gate in between.
- Do not write a second redaction rule. `src/core/errors.ts`' `redact` and `redactUrl` are the gate.
- Do not render `RATE_LIMIT`'s countdown. There is no retry, and a countdown would promise one. If the
  temptation is strong, read `UNRENDERABLE_ERROR_ROWS`' comment again — `P1-T22` reported this under
  `plan/README.md` §5 rule 6 rather than adjusting the criterion.
- Do not widen the source interface or touch the pipeline. The values are already at the throw site.

**Criteria.**
- [ ] A forced timeout renders §8.3's timeout sentence with the host and the seconds, asserted on the
      rendered text.
- [ ] A forced transport failure renders §8.3's network sentence with the host.
- [ ] A test proves that **no path and no query string** from the failing request reaches the view, and
      fails if the whole context is passed instead of the named members.
- [ ] `UNRENDERABLE_ERROR_ROWS` contains `RATE_LIMIT` and nothing else, with its narrowed reason.
- [ ] `docs/07` §5.2 and the code agree, and the "verbatim" claims in `src/core/errors.ts` are either
      still true or corrected.
- [ ] `npm run typecheck`, `npm run lint:check`, `npm run test` and `npm run test:integration` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** The cheap version of this card — spread the context into the serialized error — is the version
that leaks. The whole value here is in the **narrowing**: two named values, each with a type, each
chosen because a view needs it, and nothing else. `P1-T22` wrote the table of what is missing and
`P1-T17` wrote the gate; this card is only the wire between them.

---

### P1-T38 — The three validation sentences nobody declared, and the second bundle link's permanent home

| Field | Value |
|---|---|
| **ID** | `P1-T38` |
| **State** | `TODO` |
| **Depends on** | `P1-T22` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | part of `NFR-14`, part of `G-41` |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** Pressing Search with an empty keyword box, an out-of-range limit, or no import target says what
is wrong in a sentence, and the window's second message bundle is linked where a reader expects to find
it.

**Why this is a card.** Two small holes, both in the window's strings, both reported by the card that
found them rather than fixed there. Measured 2026-10-07:

- `src/pipeline/searchImport/searchImportPipeline.ts:105` declares `SEARCH_IMPORT_VALIDATION_KEYS` with
  **four** identifiers, and the pipeline throws all four (`:329`, `:335`, `:349`, `:357`). Checked one by
  one against the message bundles and against `src/i18n/keys.ts`:

  | identifier | in a bundle | in `keys.ts` |
  |---|---|---|
  | `research-helper-search-query-empty` | **no** | **no** |
  | `research-helper-search-databases-none` | yes | yes |
  | `research-helper-search-max-results-range` | **no** | **no** |
  | `research-helper-search-target-missing` | **no** | **no** |

  So "three validation messages" is the right count, and the fourth is already shipped — **which is the
  one to copy for tone and argument shape.**
- An unresolvable identifier does not fail loudly. `P1-T22` measured the behaviour on a live window:
  a message whose resource is unlinked "resolves to nothing and leaves the element alone", which rendered
  **seven surfaces as empty strings**. So a missing validation id shows the user an empty panel, not an
  error.
- `src/ui/viewModels/searchImportViewModel.ts:1326` records the consequence and why it got worse rather
  than better: the empty-keyword path reaches the error panel through `Planning` rejecting the input, so
  the headline falls back to `rh-error-configuration` — **"not the right sentence either"** — and the path
  is now **reachable from a button press** where before it was reachable only from a pipeline call.
- The second bundle: `addon/content/searchDialog.xhtml:57` links **one** resource,
  `__addonRef__-searchDialog.ftl`. The strings this window needs for its error rows, source names, import
  summary and coverage line live in `__addonRef__-mainWindow.ftl`, and
  `addon/content/searchDialog.js:1120` adds that second resource **at run time** with
  `document.l10n.addResourceIds([...])`, guarded by a check that the method exists (`:1116`). That was the
  right move for a card that may not edit another card's markup. **Whether it is the right permanent home
  is this card's decision** — see below.

**The decision this card makes.** Either the second resource joins the first in the markup's
`<linkset>`, or the run-time call stays and the markup carries a comment pointing at it. **Prefer the
markup**, for one reason that can be stated as a fact: a reader looking for "which strings does this
window have" reads the markup, and a run-time addition is invisible there. If measurement shows the
markup route fails — and `addon/content/searchDialog.xhtml` lines 30–34 already record that this bundle's
entries do not target the XUL attributes the dialog's own buttons use, so **check before assuming** —
keep the run-time call, delete nothing, and write the measurement into the `Findings`.

**Read first.**
- `src/pipeline/searchImport/searchImportPipeline.ts` lines 100–120, for the four identifiers and the
  order the pipeline checks them in.
- `addon/locale/en-US/research-helper-searchDialog.ftl`, the entry for
  `research-helper-search-databases-none`, as the model for the three new ones.
- `src/i18n/keys.ts` — `SEARCH_DIALOG_MESSAGE_IDS`, `ARGUMENT_MESSAGE_IDS` and the three Korean lists.
  **An id added to a bundle and not to the right lists is the half-finished edit `P1-T33` and `P1-T40`
  are both about.** Check which lists a new id belongs on, and add it to all of them.
- `addon/content/searchDialog.js` lines 1095–1125, and `addon/content/searchDialog.xhtml` lines 28–60.
- `docs/08` §8.3 and §8.4 for the wording these sentences should have, and `NFR-14` for what a failure
  message must say.

**Files.**
- modify `addon/locale/en-US/research-helper-searchDialog.ftl`
- modify `src/i18n/keys.ts`
- modify `src/ui/viewModels/searchImportViewModel.ts`
- modify `addon/content/searchDialog.xhtml`
- modify `addon/content/searchDialog.js`
- modify `test/integration/searchDialog-flow.spec.ts`

**Do.**
1. Write the three missing sentences, in the tone of the one that exists, and register each identifier on
   **every** list in `src/i18n/keys.ts` that it belongs on. Say in the `Findings` which lists those were
   and how that was determined.
2. Make the empty-keyword path headline itself with `research-helper-search-query-empty` rather than
   `rh-error-configuration`, and the other two likewise. The comment at
   `searchImportViewModel.ts:1326` names the surface to change.
3. Settle the second bundle link per *The decision this card makes*, and leave the reason at the place a
   reader will look.
4. Assert all three paths from a button press, in the integration spec: a rendered sentence, not an empty
   element. **The assertion must fail if the element is empty**, because that is the exact failure mode
   `P1-T22` measured — an unresolvable id leaves the element alone.

**Do NOT.**
- Do not invent a fourth validation message or change what the pipeline validates. Four identifiers exist;
  three sentences are missing. `plan/README.md` §5 rule 2.
- Do not translate into Korean here. `G-41` is a gate with a human on it, and an untranslated id belongs
  on `KO_PENDING_REVIEW` — which is the registration step 1 asks for, not a translation.
- Do not add the query-free headline identifier, the preference pane, or any error-row work. `P1-T37` owns
  the error rows and each of the others is its own card.
- Do not remove the run-time `addResourceIds` guard if the run-time route is kept. It is there because
  `addResourceIds` belongs to `Localization` and the window cannot assume the object it has is one.

**Criteria.**
- [ ] Each of the three validation paths, started from the Search button in a real Zotero, renders a
      sentence that names what is wrong, asserted on text rather than on an element's presence.
- [ ] All four identifiers appear in a bundle and on every `src/i18n/keys.ts` list they belong on, with
      the determination recorded.
- [ ] The second bundle's home is settled, and the reason is written where a reader will find it.
- [ ] `npm run typecheck`, `npm run lint:check`, `npm run test` and `npm run test:integration` exit 0,
      and the localization spec still passes with no new pending identifier left unregistered.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && npm run test:integration -- --exit-on-finish --abort-on-fail
```

**Notes.** This is the cheapest card in the group and the one a user notices first: three of the four ways
to get the input wrong currently produce a panel with nothing in it. The trap is the registration — an
identifier that reaches a bundle without reaching `src/i18n/keys.ts`' lists is invisible to the compiler,
which is what `P1-T33`'s mutation proved and what `P1-T40` exists to catch in under a second.

---

### P1-T39 — A unit-test path for the search window's view model, whose arithmetic is currently only tested through a live Zotero

| Field | Value |
|---|---|
| **ID** | `P1-T39` |
| **State** | `TODO` |
| **Depends on** | `P1-T22` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | `docs/13` §1.6's layer-one tier for this module |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** The view model's pure functions are asserted in a sub-second unit run, so a change to them fails
in seconds instead of inside a Zotero launch.

**Why this is a card.** **Two cards in a row reported the same gap and neither could close it**, because
neither card's `Files` list named a unit-test path. Measured 2026-10-07:

- `src/ui/viewModels/searchImportViewModel.ts` is **1,594 lines** and exports **twenty-two** names,
  including eight plain functions — `message`, `errorView`, `errorDetails`, `initialViewState`,
  `toWindowRecords`, `toPipelineInput`, `sourceStatusLine`, `buildProvenance` — plus
  `createSearchImportViewModel`.
- `grep -rl searchImportViewModel test/` finds it reached **only** from
  `test/integration/searchDialog-flow.spec.ts`, which needs a real Zotero to run.
- A unit-test directory for this layer **already exists**: `test/unit/ui/searchDialog.test.ts`, 2,229
  lines, with describe blocks for the window controller's pure model *and* for the same model against a
  real document. So the pattern to follow is in the repository; what is missing is a file, not a
  mechanism.
- `vitest.config.ts` configures **no `include` globs** (`:12` says so and explains why), so a new spec
  under `test/unit/` is collected without configuration.

**What makes this worth 0.5 d rather than 0.1.** The valuable assertions are the ones the integration
suite cannot make cheaply, and `P1-T22` named them: the error table, the selection round-trip, the
latching, and the per-source attribution. Each is a calculation over a value, and each currently costs a
Zotero launch to check once.

**Read first.**
- `src/ui/viewModels/searchImportViewModel.ts`'s exports, and `SearchImportViewModelDeps` (lines 556–592)
  — **six members are required** (`pipeline`, `jobs`, `logger`, `pluginVersion`, `zoteroVersion`,
  `clock`) and **five are optional**, which is what makes a unit construction cheap: a view model can be
  built with a pipeline double, a job factory double, a logger, a clock and two version strings, and
  nothing else.
- `test/unit/ui/searchDialog.test.ts`'s "pure model" describe block, as the shape to follow.
- `docs/13` §1.6 for what belongs at layer one and what does not.
- `test/integration/searchDialog-flow.spec.ts`'s header, which states what is real and what is doubled
  there — **do not duplicate an assertion that spec already makes against the real platform**; the point
  here is the arithmetic, not the wiring.

**Files.**
- new `test/unit/ui/searchImportViewModel.test.ts`

**Do.**
1. Assert the pure functions directly: `errorView` for every key of `ERROR_ROWS` **and** for every member
   of `UNRENDERABLE_ERROR_ROWS` (the second group must reach the generic row), `errorDetails` against
   `ERROR_DETAIL_FIELDS`, `toWindowRecords`, `toPipelineInput`, `sourceStatusLine` and `buildProvenance`.
2. Build a view model over doubles and assert the state machine: a run publishes the panels in order, a
   second run replaces the first run's records, the selection survives a re-render, and the latched
   values stay latched.
3. Assert the two security constants hold their meaning rather than merely their value:
   `EMPTY_HEADLINE_OMITTED` means the empty-state headline is **not** populated, and `ERROR_DETAIL_FIELDS`
   means the disclosure carries machine values only. **A test that only compares the constant to a literal
   is vacuous** — assert the behaviour the constant describes.
4. Check every new assertion by breaking the implementation it measures, and record in the `Findings`
   which mutation each one caught. An assertion that passes against a deliberately wrong implementation is
   worse than no assertion.

**Do NOT.**
- Do not change `src/ui/viewModels/searchImportViewModel.ts`. If something cannot be tested without
  changing it, **report that** rather than reshaping production code to suit a test — and say exactly
  which member blocks it.
- Do not import `src/zotero/**` or touch a Zotero global. If a test needs one, it is an integration test
  and belongs in the other suite.
- Do not move or rewrite assertions that already live in the integration spec. Adding a cheap copy of an
  expensive test is fine; deleting the expensive one is not this card's call.
- Do not add a snapshot test. A snapshot of a view state records what the code does, not what it should
  do, and the next person to change the code will update the snapshot.

**Criteria.**
- [ ] Every exported function of the module is reached by at least one assertion, and the `Findings` list
      any that are not, with the reason.
- [ ] `UNRENDERABLE_ERROR_ROWS`' members are asserted to reach the generic row — so the day one of them
      becomes renderable, this test tells whoever did it to come here too.
- [ ] Each new assertion is shown to catch a mutation, listed in the `Findings`.
- [ ] `npm run test` exits 0, the unit count rises by the number of tests added, and the suite's wall
      time stays in the same order of magnitude.
- [ ] `npm run typecheck` and `npm run lint:check` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test
```

**Notes.** This card buys nothing a user can see, which is why it keeps being deferred, and it is the
cheapest insurance in the phase: every later card that touches the window's arithmetic currently pays a
Zotero launch to find out whether it broke something. `P1-T22`'s own report put it plainly — the gap "is
in the list, not in the work."

---

### P1-T40 — A partition assertion over `src/i18n/keys.ts` at unit speed, because the compiler cannot see a half-finished identifier edit

| Field | Value |
|---|---|
| **ID** | `P1-T40` |
| **State** | `TODO` |
| **Depends on** | `P1-T30`, `P1-T33` |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | part of `G-41`'s machinery |
| **Estimate** | 0.25 d |
| **Human gate** | none |

**Goal.** Moving a message identifier between the Korean lists, or adding one to a surface and forgetting
the other list, fails in a sub-second unit run instead of in a Zotero launch.

**Why this is a card.** **Both agents who worked on the identifier lists asked for this**, and the gap has
a measured shape. Verified 2026-10-07:

- `src/i18n/keys.ts` declares eleven exported lists and constants, among them
  `MAIN_WINDOW_MESSAGE_IDS` (`:159`), `SEARCH_DIALOG_MESSAGE_IDS` (`:318`), `ERROR_MESSAGE_IDS` (`:463`),
  `DEFERRED_ERROR_MESSAGE_IDS` (`:495`), `KO_PENDING_REVIEW` (`:526`), `KO_DELIBERATELY_ABSENT` (`:625`),
  `KO_PRESENT` (`:634`) and `ARGUMENT_MESSAGE_IDS` (`:735`).
- The equivalent check exists **only in the integration suite**.
  `test/integration/l10n.spec.ts:611` reasons carefully about which parts of the partition are compile-time
  facts and which are not, and lines 766–807 check the three Korean lists against the **live `ko-KR`
  bundles** — which needs a full Zotero launch. Its own first line says so: an integration spec runs
  inside a live Zotero.
- **The compiler does not catch the gap.** `P1-T33`'s mutation M3 demonstrated it: `satisfies readonly
  FluentMessageId[]` constrains what may be *in* a list, and nothing constrains what must be. So an
  identifier moved out of one Korean list and not into another typechecks, passes the unit suite, and is
  caught only by the slowest test in the repository.

**A warning from this project's own experience, which the executing agent should treat as a requirement
rather than advice.** A partition check written in haste for this exact file printed "PARTITION: OK"
having parsed **zero** identifiers: it anchored on the first occurrence of a list's name, which was a
documentation comment rather than the declaration. **A partition assertion over an empty set is vacuously
true, and that is the single most likely way this card fails while appearing to succeed.**

**Read first.**
- `src/i18n/keys.ts`, all eleven declarations, and the doc comments that say what each list is for. **Work
  out which unions are supposed to partition which — do not assume the three Korean lists over the two
  surface lists is the only one.** `ERROR_MESSAGE_IDS`, `DEFERRED_ERROR_MESSAGE_IDS` and
  `ARGUMENT_MESSAGE_IDS` each stand in some relation to the surfaces, and the card wants that relation
  asserted too where it is a partition or an inclusion.
- `test/integration/l10n.spec.ts` lines 600–630 and 760–810 — what is already asserted, and at what cost.
  **Do not duplicate what is a compile-time fact there**; that file explains which parts are.
- `P1-T33`'s `Findings` in this file for mutation M3.

**Files.**
- new `test/unit/i18n/keys.test.ts`

**Do.**
1. Assert every partition and inclusion the lists are meant to satisfy, each as its own named assertion,
   with the relation stated in the assertion message rather than only in a comment.
2. **Make the test fail if any list it reads is empty.** This is not optional and it is not paranoia: it is
   the measured failure mode. Import the lists as values rather than parsing the file as text, which makes
   the empty case impossible by construction — and if text parsing is unavoidable for some claim, assert a
   plausible minimum count explicitly.
3. Assert the lists are disjoint where they must be disjoint, and that no identifier appears twice within
   one list.
4. Prove each assertion bites, by moving one identifier out of a list and watching the named assertion
   fail — not merely the suite. Record which assertion caught which move.

**Do NOT.**
- Do not change `src/i18n/keys.ts`. If a list turns out **not** to partition what it should, that is a
  finding to report, not a list to edit quietly — and it may be a real bug in the shipped bundles.
- Do not duplicate the live-bundle assertions. This card reads the source lists; the bundles stay the
  integration suite's business, and deleting an expensive assertion is not this card's call.
- Do not assert a count. `G-41`'s headline numbers are stale in four places precisely because somebody
  wrote a number down; a partition assertion that compares sets does not go stale.

**Criteria.**
- [ ] Every relation between the lists that is supposed to be a partition or an inclusion is asserted by
      name, and the `Findings` say which relations were found and how.
- [ ] The test **fails** if any list it reads is empty, demonstrated by making one empty.
- [ ] Moving one identifier out of `KO_PENDING_REVIEW` without adding it elsewhere fails this test, and
      the failure message names the identifier.
- [ ] `npm run test` exits 0 and the whole file runs in well under a second.
- [ ] `npm run typecheck` and `npm run lint:check` exit 0.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test
```

**Notes.** The value here is entirely in the **speed**: the same class of defect is already caught, and it
is caught by the one test that costs a Zotero launch, so in practice it is caught late or not at all. Two
cards reported identifier edits that were torn between lists; both were found by a human reading a diff.

---

### P1-T41 — `P3-T02` tells its implementer to call a method that does not exist, and to build what Phase 1 already built

| Field | Value |
|---|---|
| **ID** | `P1-T41` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | `P3-T02` |
| **Retires** | none |
| **Implements** | nothing — a corpus correction, like `P1-T34` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** An agent handed `P3-T02` can execute it without reproducing a crash this project already
measured and retracted, and without re-declaring an interface that exists in another layer.

**Why this is a card.** `P3-T02` was written before the Phase 0 spike measured the platform and before
Phase 1 shipped the secret store. **Followed literally today it would fail in two different ways.**
Measured 2026-10-07:

1. **A retracted claim, repeated as a premise.** `plan/04-phase-3-llm-summaries.md:233–234` tells the
   implementer, in its `Read first`, that "`findLogins()` is a throwing stub and the sync
   `addLogin`/`removeLogin`/`searchLogins` were removed on the esr153 base, so every call here is
   `await`ed and uses the `Async` name", and `:279–281`'s `Do NOT` repeats it as a prohibition.
   `docs/09` §1.2 lines 141–145 carry the **dated correction, measured 2026-09-15 by `P0-T23`**: that text
   describes Zotero's `main` branch, and in the Zotero 10 plugin sandbox **`removeLoginAsync` and
   `modifyLoginAsync` are `undefined`** while the synchronous forms exist. The shipped code already
   feature-detects — `src/zotero/keychain.ts:328–332` tests `typeof
   Services.logins.removeLoginAsync === "function"` before calling it. `P3-T02` step 2 says `clear()` goes
   "via `removeLoginAsync`", which on this platform is a call to `undefined`.
2. **Most of the card has already landed, in a different file and a different layer.** `P3-T02` step 1
   says to declare `SecretBackend`, `SecretId` and `SecretStore` "in `src/zotero/keychain.ts` exactly as
   `docs/09` §1.7 gives them". The interface is declared at **`src/core/secretStore.ts:95`** — the port,
   which is where `docs/07` §2.3's layering puts it — and `src/zotero/keychain.ts` is **529 lines** with
   the backend, the probe, the key-presence writers and a factory. So an agent following step 1 would
   declare a second copy of a live interface, in the layer that may not own it.

**What this card does and does not decide.** It corrects the false claims and **measures** which of
`P3-T02`'s seven `Do` steps have already landed, writing the measurement into `P3-T02` as a dated note.
It does **not** redesign `P3-T02` or delete its steps: which of the landed steps are finished and which
merely exist is a judgement about Phase 3's scope, and the card's owner makes that. **Report the list;
do not prune it.**

**Read first.**
- `plan/04-phase-3-llm-summaries.md` `P3-T02` in full — the `Read first` list, all seven `Do` steps, the
  `Files` list and every `Do NOT`.
- `docs/09` §1.2, the whole section including the correction block at lines 141–145, and §1.7.
- `src/zotero/keychain.ts` in full, and `src/core/secretStore.ts`. **For each of `P3-T02`'s seven steps,
  find the shipped code that does it or establish that none exists.** That enumeration is this card's main
  product.
- `plan/02-phase-1-pubmed.md`'s `P1-T09` and `P1-T17` `Findings`, and the paragraph in this file that
  first reported this (search for "`P3-T02` also contradicts this card about where the port is
  declared").
- `plan/README.md` §5 rule 8, which exists because of exactly this failure mode, and §4 for what a
  coordinator may change in a card that is still `TODO`.

**Files.**
- modify `plan/04-phase-3-llm-summaries.md`
- modify `docs/09-security-privacy-and-api-keys.md` (only if a statement there is itself wrong)

**Do.**
1. Correct both places in `P3-T02` that state the removed-synchronous-forms claim, and **leave the
   correction visible** — a dated note saying what the text said, what was measured, and where the
   measurement lives, in the style `P1-T34` and `P2-T24` used. Do not silently reword: the next reader must
   be able to tell this was wrong rather than wonder whether the correction is itself drift.
2. Point step 2's `clear()` at the feature-detected shape the shipped code uses, by reference rather than
   by transcription.
3. Correct step 1 to say where `SecretStore`, `SecretId` and `SecretBackend` **are** declared, and note
   that `docs/09` §1.7's placement and `docs/07` §2.3's layering disagree — with the resolution Phase 1
   already took, which is re-exports from the platform module so that §1.7's reading still holds.
4. Add a dated note to `P3-T02` listing, step by step, what has already landed and where. Mark each as
   *landed*, *partly landed* or *not started*, with the file and line that settles it.
5. Check the rest of `P3-T02` against the shipped code for any **other** claim that has gone stale —
   especially its `Files` list, which names files that may now exist, and its `Depends on`.

**Do NOT.**
- Do not change `P3-T02`'s `Estimate`, `State`, `Depends on` or `Blocks`. Re-estimating a card whose scope
  may have shrunk is the owner's call, and this card's job is to put the measurement in front of that
  decision.
- Do not delete a `Do` step because it looks done. "Looks done" is what this card exists to replace with a
  file and a line number.
- Do not touch any file under `src/`. No production behaviour changes here.
- Do not correct `docs/09` §1.2's quoted upstream text. The quote is accurate about the branch it
  describes; the correction block beneath it is the mechanism, and it already works.

**Criteria.**
- [ ] Neither place in `P3-T02` states the removed-synchronous-forms claim as fact, and both carry a dated
      correction naming `docs/09` §1.2's measurement.
- [ ] Step 1 names the file where each of the three types is actually declared.
- [ ] Every one of `P3-T02`'s seven `Do` steps carries a *landed* / *partly landed* / *not started* mark
      with a file and line.
- [ ] No `src/` file is modified, and `git status` shows only plan and documentation files.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` still exit 0 — this card changes no
      code, so a failure here means something else moved.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && git status --porcelain
```

**Notes.** This is the third card in this phase whose whole content is "a document says something that was
measured false". The pattern is worth naming: **a claim written into a card outlives the card, and an
agent inherits a premise it would have tested had it been written as a question.** `plan/README.md` §5
rule 8 was added for this, and the reason this particular one is worth a card of its own rather than a
line in someone's `Findings` is the blast radius — `P3-T02` blocks six Phase 3 cards, and the crash it
would reproduce has already cost this project one measurement.

---

### P1-T42 — The free-text redactor cannot see a short unprefixed credential, and the project's own measurement of that length is in no document

| Field | Value |
|---|---|
| **ID** | `P1-T42` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | none |
| **Retires** | none |
| **Implements** | part of `NFR-16` |
| **Estimate** | 0.5 d |
| **Human gate** | none |

**Goal.** A credential short enough to slip past the catch-all pattern either stops slipping past it, or the
reason it cannot be caught is written where the next person to rely on the redactor will read it.

**Why this is a card.** Three cards have now worked around the same gap locally and each one said the
general fix needs a card. Measured 2026-10-07:

- `src/core/errors.ts:79–87` declares `KEY_PATTERNS`: six vendor-prefixed shapes — Anthropic, OpenRouter,
  two OpenAI shapes, Google, and any `Bearer` token — plus **one last-resort net,
  `/\b[A-Za-z0-9_-]{40,}\b/g`.** A credential with **no vendor prefix** and **fewer than 40 characters**
  matches none of them.
- The project has measured exactly such a credential. Two cards' `Findings` record a literature-database
  access key at **32 characters**, which is 8 short of the net. **That measurement appears in no document
  and in no code comment**: a grep for the length across `docs/` and `src/` returns nothing. So a reader of
  `docs/09` §2.1 cannot see that the gap exists, and the corpus still says, in the words `P1-T12` quoted,
  that it records no length for this key at all.
- **The gap is narrower than it first looks, and the narrowing is the useful part.** Two other rules catch
  most real cases before the patterns run:
  - `KEYISH_FIELD` (`src/core/errors.ts:63`) matches the **field name** — `api_key`, `token`, `secret`,
    `authoriz`, `password`, `bearer`, `credential` — and `src/core/logger.ts`'s `redactValue` applies it per
    key at every depth, so a named field is redacted **whatever its length**.
  - `redactUrl` removes the named parameter, and both `src/core/logger.ts:133` and
    `src/core/provenance.ts`'s free-text path route a URL-shaped run through it first.
  So what is left uncovered is a credential appearing in **free text, with no field name around it and no
  URL to parse** — a sentence, an exception message, a form body. That is exactly the case
  `P1-T12` hit when it shipped the first request body able to carry a key, and it sidestepped it by
  **re-rendering the redacted form from the original values without the key** rather than
  pattern-matching. That remains the right local answer; it does not generalise.

**What this card has to decide, and the decision may be "it cannot be closed".** `docs/09` §2.1 states the
trade in its own words: the catch-all "will occasionally redact a legitimate long token (a base64 chunk, a
hash). That is the correct trade: a false-positive redaction costs a debugging inconvenience; a false
negative publishes a billing credential to a GitHub issue." **Lowering the threshold is therefore within
the documented policy, not a violation of it** — but how far it can be lowered is an empirical question
about this repository's own text, not a matter of taste. **Measure it. Do not argue it.**

**Read first.**
- `docs/09` §2.1 in full — the patterns, the trade, and the reference implementation `src/core/errors.ts`
  says it transcribes unchanged.
- `src/core/errors.ts` lines 55–120 — `KEYISH_FIELD`, `KEY_PATTERNS`, `redact`, `redactUrl`, and the
  comment explaining why the patterns' `/g` flag is safe where it is used and unsafe elsewhere.
- `src/core/logger.ts` lines 119–230 — the three-rule order (field name, URL shape, content) and the depth
  limit, so you can see which of the three a change here would affect.
- `src/core/provenance.ts`'s `redactText` and `redactQueryString`, and the note that this module is the
  project's **single** redaction gate.
- `P1-T12`'s, `P1-T17`'s and `P1-T22`'s `Findings` in `plan/02-phase-1-pubmed.md`, which are the three
  local workarounds.

**Files.**
- modify `src/core/errors.ts`
- modify `docs/09-security-privacy-and-api-keys.md`
- modify `test/unit/core/errors.test.ts`
- modify `test/unit/core/logger-redaction.test.ts`

**Do.**
1. **Record the measured length in the corpus first**, in `docs/09` §2.1, with the date and the card that
   measured it. Do this step even if every later step turns out to be impossible: a measured fact that
   lives only in a report is a fact the next reader does not have.
2. Measure the false-positive cost of lowering the catch-all threshold, **against this repository's own
   text** — the fixtures, the test names, the log lines the suites emit, the identifiers in `src/`, the
   documentation. Report the count of runs between the candidate threshold and 40 characters, and what they
   are. **A number with examples, not an opinion.**
3. Decide from that measurement: lower the threshold, add a shape for this specific credential, or
   neither — and write the decision and its evidence into `docs/09` §2.1 beside the trade it rests on. If
   the answer is "neither", say what a caller must do instead, which is step 4.
4. Whatever the outcome, make the **local** answer reusable: `P1-T12`'s technique — re-render the redacted
   form from the original values rather than pattern-matching the rendered one — is the only sound answer
   for a body that definitely contains a key, and it is currently a technique one card used rather than
   something a later caller can find.
5. Assert the outcome both ways: a string containing the credential shape is redacted (or is documented as
   not redacted, with the assertion written to prove the documented behaviour), and a legitimate run that
   the chosen threshold must **not** touch stays intact.

**Do NOT.**
- Do not write a second redaction rule in a second place. `src/core/errors.ts` holds the patterns and
  `src/core/provenance.ts` is the gate; a sharper rule at a call site is the thing this project forbids,
  and `P1-T22` declined to build a surface rather than break that rule.
- Do not put a real credential, or anything resembling one, into a test fixture, a test name, a commit
  message or a document. Build test inputs from obviously synthetic strings of the right **shape**.
- Do not accept a key pasted into a conversation, and do not add a code path that reads one from a file, a
  preference or a log. Keys come from a password dialog or the process environment only.
- Do not raise the threshold, or make redaction conditional on a preference or a log level.
  `src/core/logger.ts`'s header names that as the defect its design forecloses.
- Do not change `redactUrl`'s parameter removal. An empty value is the one thing the `[redacted:<len>]`
  form cannot express, which is why that function removes rather than blanks.

**Criteria.**
- [ ] `docs/09` §2.1 records the measured credential length, dated, with the card that measured it.
- [ ] The false-positive measurement is in the `Findings` as a count with examples, and names the corpus it
      was taken over.
- [ ] The decision is implemented and asserted, in both directions — what must be redacted, and what must
      survive.
- [ ] No second redaction rule exists anywhere; `grep` for the pattern shapes finds them in one module.
- [ ] `npm run typecheck`, `npm run lint:check` and `npm run test` exit 0, and the redaction suites' counts
      rise.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test
```

**Notes.** The most likely honest outcome is a small threshold change plus a documented residual gap, and
**the documentation is worth more than the change.** The reason this is not merely tidy-up: `P1-T22`
declined to populate the window's empty-state headline **because of this gap** — a 32-character key
interpolated into a user-visible sentence would have been shown in full while looking handled — so
whichever way this card goes, it should say plainly whether that surface becomes safe. **Check that
claim rather than inheriting it**: the headline's safety depends on what the chosen rule can match, and
this card is the one holding the measurement.

---

### P1-T43 — Stop hiding already-present papers, and carry the duplicate choice to the importer that already implements it

| Field | Value |
|---|---|
| **ID** | `P1-T43` |
| **State** | `TODO` |
| **Depends on** | `P1-T21`, `P1-T22` |
| **Blocks** | none |
| **Retires** | the conflict `P1-T22` escalated |
| **Implements** | part of `FR-51`, `docs/08` §4.4 |
| **Estimate** | 0.5 d |
| **Human gate** | none — **the decision this card exists to implement was taken by the owner on 2026-10-08** |

**Goal.** A paper already in the library appears in the result list, marked, and the three-way duplicate
control decides what happens to it — because all three outcomes are already implemented and nobody ever
chooses between them.

**The owner's decision, 2026-10-08.** `P1-T22` escalated a conflict: the shipped default **hides**
already-present rows, a hidden row is never imported, and therefore the only rows the duplicate-policy
control could be about were the hidden ones — which made "add existing item to collection" unreachable
from the window as shipped. **The owner chose: stop hiding by default, and let the user decide.**

**Why this is much smaller than it looks.** Measured 2026-10-08, and the measurement is the useful part:
**the mechanism is complete and unreached.** `src/zotero/importer.ts` declares
`DuplicatePolicy = "link-existing" | "skip" | "import-anyway"` (`:112`), a
`DEFAULT_DUPLICATE_POLICY` of `"link-existing"` (`:115`), an optional `duplicatePolicy?` on its request
(`:137`), reads it as `request.duplicatePolicy ?? DEFAULT_DUPLICATE_POLICY` (`:352`), and **implements all
three branches** (`:633`, `:673`, `:677`). The report type even documents the vocabulary:
`types.ts:217` says a record is "Dropped without a write: a library duplicate under `"skip"`, or a
repeat."

And the window already collects the choice: `addon/content/searchDialog.js:2700` puts it on the query,
`:263` pre-selects `"link"`, and `src/ui/dialogs/searchDialog.ts:257` declares
`readonly duplicates: string`. **A grep of `src/` for any reader of that member returns nothing.** So the
value is collected, carried across one type boundary, and dropped — and what it would have selected is the
behaviour that happens unconditionally today.

**So this card is a flip and a wire, with two traps.**

**Trap 1 — the default lives in two places and changing one is worse than changing neither.**
`src/prefs/schema.ts:141–144` has `hideExisting` with `default: true`, and
`addon/content/searchDialog.js:252` has its own `hideExisting: { default: true }` inside `prefBounds`.
`src/bootstrap/registerUI.ts:385` seeds the query from the preference. **Work out which one the window
actually honours at run time, say so in the `Findings`, and leave both consistent.** A window that honours
its own literal would ignore a changed preference, and a user who then unticks the box would see a
different list from the one the preference promised.

**Trap 2 — the two layers use different words for the same three outcomes, and the type will not catch it.**
The window's radio values are `skip`, `link` and `import` (`addon/content/searchDialog.xhtml:396–412`);
the importer's are `"skip"`, `"link-existing"` and `"import-anyway"`. `SearchWindowQuery.duplicates` is
typed **`string`**, so passing `"link"` straight through compiles, reaches
`request.duplicatePolicy ?? DEFAULT_DUPLICATE_POLICY`, and **silently falls back to the default** — the
exact failure this card exists to end, wearing a different hat. **Narrow the window-facing type to a union
of the three values it can hold, and make the mapping to `DuplicatePolicy` explicit and total**, so adding
a fourth outcome later fails to compile rather than falling back.

**Read first.**
- `src/zotero/importer.ts` lines 100–145 and 340–360 and 620–690 — the policy type, its default, where it
  is read, and all three branches. **Read these before writing anything**: the point of this card is that
  none of it needs to be written again.
- `src/pipeline/searchImport/types.ts` — `SearchImportInput` (line 90), `SearchImportTarget`,
  `SearchImportWriter.openTarget` (line 335) and the report's `created` / `linkedExisting` / `skipped`
  members (lines 213–220). **Where the policy member belongs is your call**: the pipeline input, the
  target, or the write session. Say which you chose and why.
- `addon/content/searchDialog.js` lines 240–270 (the defaults, and the comment explaining that
  `docs/07` §8.5 declares **no** preference for the duplicate policy, so `docs/08` §4.5's wireframe is the
  only default there is) and line 2690–2705 (`collectQuery`).
- `P1-T21`'s `Findings` and its selection model. **Its invariant must survive**: Import takes exactly the
  rows the table shows as picked — checked ∩ visible. With hiding off, an already-present row is visible
  and checkable, so the invariant holds unchanged and the policy decides what happens to it. **That is why
  the two halves of this card are one card.**
- `docs/08` §4.4 for the control and §4.5 for the wireframe's pre-selected radio.
- `P1-T22`'s `Findings`, for the re-import test that asserts the current behaviour — **it will have to
  change, and changing it is correct here** because the behaviour it asserts is the one the owner replaced.

**Files.**
- modify `src/prefs/schema.ts`
- modify `src/ui/dialogs/searchDialog.ts`
- modify `src/ui/viewModels/searchImportViewModel.ts`
- modify `src/pipeline/searchImport/types.ts`
- modify `src/pipeline/searchImport/searchImportPipeline.ts`
- modify `addon/content/searchDialog.js`
- modify `test/integration/searchDialog-flow.spec.ts`
- modify `test/integration/zotero/importer.spec.ts` (only if a policy branch gains an assertion — grepped 2026-10-08: the importer has **no unit-test file**; it is covered by that spec, by `test/integration/zotero/import-perf.spec.ts` and by `test/unit/pipeline/searchImport.test.ts`)

**Do.**
1. Change `hideExisting`'s default to **false** in `src/prefs/schema.ts`, and reconcile the window's own
   default with it per trap 1.
2. Narrow the window-facing duplicate member to a union of its three values, and carry it through to the
   importer's `duplicatePolicy` with an **explicit, total** mapping per trap 2.
3. Leave the pre-selected radio as it is. `docs/08` §4.5's wireframe draws "add existing to collection"
   selected, the importer's own default is `"link-existing"`, and those already agree — **changing a
   default nobody asked you to change is how a card grows.**
4. Keep an already-present row **visible and marked**. The badge and the row class already exist
   (`addon/content/searchDialog.js:208–210`, and the two Fluent ids at `:315–316`) — check whether they
   render when the row is not hidden, which has never been exercised, and say so either way.
5. Assert each of the three outcomes end to end: a re-import under "add to collection" links and creates
   nothing, under "skip" does neither, and under "import anyway" creates a second item. The report's
   `created` / `linkedExisting` / `skipped` counts are the assertion.
6. Update `P1-T22`'s re-import test to the new behaviour, and **say in the `Findings` what it asserted
   before**, so the change is legible as a decision rather than as a test that was in the way.

**Do NOT.**
- Do not re-implement any policy branch. All three exist. If one is wrong, that is a finding, not a rewrite.
- Do not break `P1-T21`'s invariant. Import takes checked ∩ visible, and that is deliberate with two test
  files behind it.
- Do not add a preference for the duplicate policy. `docs/07` §8.5 declares none, and adding one is a
  schema change with an owner.
- Do not change what "already present" means. `P1-T13`'s existing-item check is the definition; this card
  changes only whether such a row is hidden.
- Do not touch the provenance record's shape. If the chosen policy ought to be recorded there, **say so as
  a finding** — it is a schema change and `schema/provenance.schema.json` has its own gate.

**Criteria.**
- [ ] With the preference at its new default, a search whose results include already-present papers shows
      those rows, marked, and the marking renders in a real Zotero.
- [ ] Each of the three duplicate outcomes is reachable from the control and asserted end to end by the
      report's own counts.
- [ ] A value the window cannot produce **fails to compile** rather than falling back to the default,
      demonstrated by a mutation.
- [ ] The two places holding the hide default agree, and the `Findings` say which one the window honours.
- [ ] `P1-T21`'s selection invariant still holds, with its existing tests unchanged.
- [ ] `npm run typecheck`, `npm run lint:check`, `npm run test` and `npm run test:integration` exit 0.
      **Repeat the integration run three times** and report all three — that suite is load-sensitive
      (`plan/00` §6 item 20).

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && npm run test:integration -- --exit-on-finish
```

**Notes.** This is the cheapest card in the group and the one that changes what a user sees most. The whole
value is in **not writing the thing that already exists**: three policy branches, a default, and an
optional request member, all of them shipped and none of them chosen. `P1-T22` found the conflict and
escalated it instead of picking a side, which is what made the owner's decision possible — and the
decision turned out to cost a flip and a wire.

---

### P1-T44 — A place to put a key, because the storage landed in Phase 1 and the window is still scheduled for Phase 3

| Field | Value |
|---|---|
| **ID** | `P1-T44` |
| **State** | `TODO` |
| **Depends on** | none |
| **Blocks** | none |
| **Retires** | the literature-source half of `P3-T04` |
| **Implements** | the source-credential half of `docs/08` §7.5 and `docs/09` §1.9 |
| **Estimate** | 1.0 d |
| **Human gate** | none to build. **Entering a real key is `G-18`'s** and stays the owner's. |

**Goal.** A key the owner has in hand can be stored in the operating system's keystore through the
plugin's own preferences, and never appears anywhere else.

**Why this is a card, and why it is in Phase 1.** **Everything a key needs already exists except the
place to type it.** Measured 2026-10-08:

- **The storage shipped in Phase 1.** `src/zotero/keychain.ts` exports `setSecret`, `getSecret`,
  `hasSecret`, `clearSecret`, `listStoredIds`, `probeKeystore`, `probeAndRecordBackend`,
  `secretBackendPrefValue`, `createKeychainSecretStore`, `KEY_PRESENCE_PREFS` and `refreshKeyPresence` —
  529 lines of it — and `src/core/secretStore.ts` declares the port.
- **The pane registration shipped in Phase 0.** `preferencePaneRegistration` is at
  `src/zotero/registrations.ts:144`, paired with an explicit unregister and visible to the leak check.
- **So what is missing is the pane's markup and its controller, and nothing else.**
- **The schedule is why nobody noticed.** The pane is `P3-T04` — "Prefs pane: key fields, backend badge,
  remove-all", `plan/04`, 1.75 d — and its `Depends on` reads `P3-T02`, `P3-T03`: the keystore tier and
  the tier ladder. That ordering was right when the plan was written. **It is now wrong**, because
  `P3-T02`'s substance arrived in Phase 1 by another route and `P3-T03`'s tier 3 was cancelled by the
  owner on 2026-10-08. `P1-T41` is the card that measures `P3-T02` step by step; **this card does not
  wait for it**, because what this card needs is the shipped code, not the corrected text.
- **The consequence today is concrete.** The literature-source key the owner applied for can arrive any
  day and there is nowhere to put it — which means it would sit in an e-mail, and `docs/09` is emphatic
  that a key must not sit anywhere a person might copy it from. The optional key for the other source has
  the same problem; that is why `G-04` deliberately defers obtaining it.

**Scope — the source half only, and the reason for the line.** `P3-T04` carries six credentials, four
provider base URLs, spend ceilings and the cache rows. **This card builds the pane and the two
literature-source credential blocks, and leaves every summarizing-provider control to `P3-T04`.** The line
is drawn there because the two source keys are the ones that can arrive before Phase 3, and because a pane
that exists is also what makes the search window's **Open Preferences** action have a target at all.
**That button already exists and already works** — `addon/content/searchDialog.js:2507` calls
`Zotero.Utilities.Internal.openPreferences()` behind a `typeof` guard — and its own comment, dated
2026-10-07, says what it opens: *"This plugin registers no preference pane yet … So the button opens
Zotero's preferences window without selecting a pane of ours."* **So the gap is already visible in the
product, from a button a user can press** (`plan/00` §6 item 5).

**What must ship with the very first key field, and is not negotiable.** These are `docs/09` §1.9's and
`docs/08` §7.5's, not this card's inventions, and they are security requirements rather than polish:

1. The field is `type="password"` always, with a **hold-to-show** reveal — **not** a sticky toggle.
2. Once stored, the key is **never re-displayed**. The field shows a digest: first three and last four
   characters only.
3. A **storage-backend badge** beside the fields names the active tier, or warns when the probe failed.
   `secretBackendPrefValue` already computes the value.
4. **The residual-risk text of `docs/09` §1.8 is visible in the pane, verbatim, not behind a link** —
   including the sentence about other Zotero plugins. This ships with the first field, not later.
5. A per-credential status row: present or absent, last validated when and with what result, and a
   **Test** button that makes one minimal call and reports inline — never a modal.
6. A **Remove all stored keys** button that clears every stored id and reports how many were removed.
7. On paste, trim whitespace and strip a leading `Bearer `.
8. **No key on the clipboard, ever, and no "copy key" affordance.**
9. **The key field carries no preference attribute and no key is ever written to `Zotero.Prefs`** —
   decision D5. Only the non-secret presence flags go to preferences, and `KEY_PRESENCE_PREFS` already
   names them.

**The one tension in those rules, named so it is not "fixed" by accident.** Rule 2's digest shows seven
characters of a real key. That is a deliberate exception to this project's habit, and the habit exists for
a reason: `P1-T22` rejected truncation as a redaction strategy because **"truncation leaks a prefix"**, and
`P1-T42` exists because the free-text redactor cannot see a short key. **The exception holds only because
the pane is the owner's own screen showing the owner's own key.** So: compute the digest and **never let it
travel** — not into a log line, not into an error, not into the provenance record, not into a note. If a
test needs to assert the digest, assert it against a synthetic value.

**Read first.**
- `docs/09` §1.9 in full — the nine rules — and §1.8 for the residual-risk text to reproduce verbatim.
- `docs/08` §7.4's wireframe and §7.5's rules. §7.5 says it restates `docs/09` §1.9 and **must not diverge
  from it**; if the two disagree, `docs/09` wins and the disagreement is a finding.
- `src/zotero/keychain.ts` — every exported function listed above, and in particular what
  `probeAndRecordBackend` writes and what `refreshKeyPresence` is for. **Call these; do not reimplement
  any of them.**
- `src/zotero/registrations.ts` lines 115–175 — `PreferencePaneOptions` and
  `preferencePaneRegistration`, including the two traps `P0-T07` recorded: `defaultXUL` is **not** a caller
  option, and there is no `l10nID` — `label` is a raw string.
- `src/bootstrap/registerUI.ts` — how the search window's registration is scoped, and where this one goes.
- `addon/content/searchDialog.xhtml` and its controller as the shape to follow for markup plus a
  controller, including how that window links its Fluent resources.
- `src/i18n/keys.ts` — **every new string needs an id on the right lists**, which is the half-finished edit
  `P1-T40` exists to catch.
- `docs/07` §8.5 for the presence and validation preference rows this pane may write, and **only those**.

**Files.**
- new `addon/content/preferences.xhtml`
- new `addon/content/preferences.js`
- new `src/ui/prefs/preferencesPane.ts`
- modify `src/bootstrap/registerUI.ts`
- modify `src/i18n/keys.ts`
- modify `addon/locale/en-US/research-helper-mainWindow.ftl`
- modify `addon/prefs.js` (only if a non-secret row is missing)
- new `test/integration/preferences.spec.ts`
- modify `test/unit/ui/searchDialog.test.ts` (only if the Open Preferences action gains a target to assert)

**Do.**
1. Build the pane, register it through the existing helper inside the same scope the other registrations
   use, and confirm it disappears on a plain disable — the leak check is already there to tell you.
2. Build the two source-credential blocks against the shipped storage functions. **Write no new storage
   code.** If a function you need is missing, report that rather than adding one here.
3. Ship all nine rules above. Assert each one that can be asserted.
4. Make the search window's **Open Preferences** action select this pane, and assert it does.
5. Prove the negative, which is the assertion that matters most: after storing a synthetic key, **the key's
   characters appear in no log line, no preference value, no error, and no note.** Drive a failing Test
   call as well as a succeeding one, because a failure path is where a value usually escapes.

**Do NOT.**
- Do not add any summarizing-provider control, base URL, or spend ceiling. Those are `P3-T04`'s and this
  card's `Retires` line is deliberately narrow.
- Do not write a key to a preference, a file, a note, the clipboard, or a log, at any level, for any
  reason. Do not add a "copy key" button.
- Do not implement the session-only or passphrase tiers. The owner chose session-only as the fallback on
  2026-10-08 and **it is not built**; on a machine whose keystore probe fails, this pane must say so
  through the badge and refuse to store, which is the honest behaviour until `P3-T03` lands.
- Do not accept a key from a test fixture, an environment variable read at run time, or a conversation.
  Tests use synthetic values of the right shape.
- Do not re-display a stored key, and do not let the digest travel.
- Do not touch the search window's markup beyond the Open Preferences target.

**Criteria.**
- [ ] The pane appears in Zotero's preferences, and disappears on a plain disable with no survivor
      reported.
- [ ] A synthetic key can be stored, its presence shown, its digest shown, re-entered to replace, and
      cleared — through the shipped storage functions, verified by reading the keystore back.
- [ ] The backend badge names the tier actually probed, and says so plainly when the probe failed.
- [ ] `docs/09` §1.8's residual-risk text is visible in the pane, verbatim.
- [ ] **The stored key's characters appear in no log line, no preference, no error and no note**, asserted
      on both a succeeding and a failing Test call.
- [ ] The search window's Open Preferences action selects this pane.
- [ ] Every new string is registered on every `src/i18n/keys.ts` list it belongs on.
- [ ] `npm run typecheck`, `npm run lint:check`, `npm run test` and `npm run test:integration` exit 0.
      **Run the integration suite three times** and report all three; that suite is load-sensitive
      (`plan/00` §6 item 20).

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && npm run test:integration -- --exit-on-finish
```

**Notes.** This card exists because of a **scheduling error, not a missing capability**: a pane whose two
dependencies had already been satisfied by other cards sat two phases away, and the only visible symptom
was that an arriving key would have nowhere to go. That is worth remembering as a class — **a card's
`Depends on` is written once and never re-read, so work that arrives early by another route leaves the
schedule quietly wrong.** `P1-T41` is the same discovery from the other end.

The expensive part here is not the pane. It is rule 4 and the negative assertion in criterion 5: the
residual-risk text has to be reproduced exactly, and proving a key does not escape means driving the
failure path as well as the success path.

---

### P1-T45 — The export control, its three strings and the file chooser, which is the boundary `P1-T36` stopped at

| Field | Value |
|---|---|
| **ID** | `P1-T45` |
| **State** | `TODO` |
| **Depends on** | `P1-T36` |
| **Blocks** | `P1-T23` |
| **Retires** | nothing |
| **Implements** | the rest of the third scenario of `FR-8` |
| **Estimate** | 0.5 d |
| **Human gate** | **Yes — `G-41`.** Three new user-visible strings raise `KO_PENDING_REVIEW`, which is the count that gate publishes. **The Korean translation itself is deferred** (owner, 2026-10-08), so what this card owes the gate is registration, not translation. |

**Goal.** A user who has just imported can press a control, choose a file, and get the run's provenance
record written to it — with a sentence telling them it worked or did not.

**Why this is a separate card.** `P1-T36` built and tested everything behind the control and then stopped,
correctly, at a boundary it measured rather than guessed. Its evidence, which this card inherits as fact:

- **The host method exists and is tested.** `exportProvenance(path)` is on the view model and on the
  published host, returns one of five plain values — `written`, `no-record`, `no-writer`, `no-path`,
  `failed` — and writes through `src/core/provenance.ts`'s `exportJson`, which runs the single redaction
  gate again. Fourteen unit tests and two integration tests cover it, including a file read back off disk
  and validated against `schema/provenance.schema.json`.
- **Three Fluent strings are the whole blockage.** `P1-T36` appended one probe message, ran the build, and
  `npm run typecheck` failed with `TS2344: Type '"research-helper-search-probe-mutant"' does not satisfy
  the constraint 'never'` — `UndeclaredBundleMessageId` at `src/i18n/keys.ts:423–433`. **So a new bundle
  message requires `src/i18n/keys.ts` and the regenerated `typings/i10n.d.ts`**, and `P1-T36`'s `Files`
  named neither. That is this card's first job, and the probe's own failure is the proof it is needed.
- **The chooser's shape is already decided, with three independent measurements behind it.**
  `docs/01:436` requires a `BrowsingContext` for `nsIFilePicker.init` and only a window has one; the view
  model is built once at startup and has none; and `eslint.config.js`'s `research-helper/zotero-global`
  rule does not exempt `src/bootstrap/registerUI.ts`, so that file cannot name the `Zotero` global to
  borrow one. **So the chooser opens in the window document and the chosen path is handed inward to
  `host.exportProvenance(path)`.** Do not relitigate this; if you find it wrong, say what you measured.
- **The placement is already decided too**: the status bar (`#rh-search-status-bar`), hidden until a record
  exists, copying the pattern the Cancel button in that row already uses — `addon/content/searchDialog.js`
  sets that button's hidden flag from one view-state field. `P1-T36` found no measurement against it.

**Read first.**
- `P1-T36`'s `Findings` in this file, all of it. It is the specification for this card.
- `src/i18n/keys.ts` — `SEARCH_DIALOG_MESSAGE_IDS`, `ARGUMENT_MESSAGE_IDS`, and the three Korean lists.
  **Work out which lists each new id belongs on**; `P1-T40` exists because a half-finished id edit is
  invisible to the compiler.
- `addon/content/searchDialog.xhtml` lines 417–433 (the status bar) and `addon/content/searchDialog.js`'s
  controller — how it reads view state, toggles hidden flags, and resolves the host.
- `src/ui/viewModels/searchImportViewModel.ts`'s `exportProvenance` and the five values it returns.
- `docs/01` §4.6's toolkit-helper list, which includes a file-picker helper — **and `P1-T36`'s measurement
  that the window script is copied as an asset rather than bundled, so it cannot import it** and would use
  the platform interface directly. Verify that yourself before choosing.
- `plan/06-human-gates.md`'s `G-41`, including the 2026-10-08 deferral note, so you register the ids the
  way the gate expects without translating them.
- `docs/09` §2.2's 2026-10-08 paragraph: **the chosen path is never logged.** The existing assertion
  enforces it; do not weaken it when the chooser starts supplying real paths.

**Files.**
- modify `addon/content/searchDialog.xhtml`
- modify `addon/content/searchDialog.js`
- modify `addon/locale/en-US/research-helper-searchDialog.ftl`
- modify `addon/locale/ko-KR/research-helper-searchDialog.ftl`
- modify `src/i18n/keys.ts`
- modify `typings/i10n.d.ts` (regenerated by the build; commit what the build writes)
- modify `test/integration/searchDialog-flow.spec.ts`
- modify `test/unit/ui/searchDialog.test.ts`

**Do.**
1. Add the three strings — a control label, a written message, a failed message — and register every id on
   every `src/i18n/keys.ts` list it belongs on. **Say in the `Findings` which lists those were and how you
   determined it.** Then run the build and commit the regenerated typings as the build writes them.
2. Add the `ko-KR` stub for each new id, as a commented placeholder in the form that file already uses, so
   `KO_PENDING_REVIEW` accounts for them and the localization spec still passes.
3. Add the control to the status bar, hidden until a record exists, revealed from view state the way the
   Cancel button is.
4. Open the chooser in the window document and hand the path inward. Handle the user dismissing it: that is
   the one outcome with **no** message, because a user who cancelled knows they did.
5. Render each of the five return values: two have strings, `no-record` should not be reachable from a
   visible control, and the remaining two are failures. **Decide what the two unreachable-in-theory ones
   show if they ever happen, and do not leave an empty element** — `P1-T22` measured that an unresolvable
   id leaves the element alone, which is how seven surfaces once rendered blank.
6. Assert from a live window: the control is hidden before a run and visible after an import, pressing it
   with a path writes the file, and the written message renders **as text**. Assert the failure path too, by
   making the writer fail.

**Do NOT.**
- Do not change `exportProvenance`, its five return values, or anything in `src/core/provenance.ts`. The
  behaviour is built and tested; this card is the surface.
- Do not translate the new strings into Korean. The owner deferred Korean to before the release on
  2026-10-08; a stub on `KO_PENDING_REVIEW` is what this card owes.
- Do not log the chosen path, at any level, and do not put it in the record, the note, or the exported file.
- Do not raise any wait cap to make the integration suite green. Three tests in `P1-T22`'s block fail
  under load and that is `plan/00` §6 item 20, not yours.
- Do not import the toolkit into the window script before verifying it can be imported there at all.
- Do not add a preference for the export, a second control, or an export of anything other than the current
  run's record.

**Criteria.**
- [ ] In a real Zotero, the control is hidden before a run and visible after an import, and pressing it
      opens a chooser.
- [ ] A chosen path receives the file, and the success message renders as text — asserted on the text, not
      on an element being present.
- [ ] A failing write renders the failure message, asserted the same way.
- [ ] Dismissing the chooser writes nothing and shows nothing.
- [ ] Every new id is in both bundles and on every `src/i18n/keys.ts` list it belongs on, with the
      determination recorded, and the localization spec passes.
- [ ] The chosen path appears in no log line, asserted.
- [ ] `npm run typecheck`, `npm run lint:check`, `npm run test` and `npm run test:integration` exit 0.
      **Run the integration suite three times and report all three.** On this machine it currently fails
      more often than it passes, for reasons that are not yours.

**Verify with.**
```bash
npm run typecheck && npm run lint:check && npm run test && npm run test:integration -- --exit-on-finish
```

**Notes.** **This card closes the second half of Phase 1's completion criterion 4**, which is why it blocks
`P1-T23`. It is deliberately small: everything hard was done by `P1-T36`, and what is left is a label, a
chooser and two sentences.

The one thing worth care is step 1. The Fluent vocabulary in this project has a compile-time gate that
turns a forgotten registration into a type error — which is why `P1-T36` could not cross this boundary and
also why crossing it is safe: **if you get the registration wrong, the build tells you.** The part the
compiler cannot tell you is which *list* an id belongs on, and that is what `P1-T40` exists to catch.

---

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
| `P1-T32` | The four platform seams the composition root could not reach | 0.50 | — |
| `P1-T33` | Retire one of the two headline ids | 0.25 | — |
| `P1-T34` | Three corpus statements measured false | 0.25 | — |
| `P1-T35` | Publish the search window's host | 0.50 | — |
| `P1-T36` | FR-8's JSON-export control, and the record it needs | 0.50 | — |
| `P1-T37` | Carry a named, redacted subset of an error's context | 0.50 | — |
| `P1-T38` | The three validation sentences, and the second bundle link | 0.25 | — |
| `P1-T39` | A unit-test path for the view model | 0.50 | — |
| `P1-T40` | A partition assertion over `keys.ts`, at unit speed | 0.25 | — |
| `P1-T41` | Correct `P3-T02`'s retracted claims and measure what landed | 0.50 | — |
| `P1-T42` | The free-text redactor's short-credential gap | 0.50 | — |
| `P1-T43` | Stop hiding already-present papers; wire the duplicate choice | 0.50 | — |
| `P1-T44` | A preferences pane, so an arriving key has somewhere to go | 1.00 | — |
| `P1-T45` | The export control, its three strings and the file chooser | 0.50 | **Yes** |
| | **Total** | **28.75 d** | **5 gates** |

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

# 10 — Requirements and User Stories

**Project:** `research_helper` — a Zotero plugin for literature discovery, LLM summarization, trend reporting, and audio briefings.
**Target platform:** Zotero 10.x (bootstrapped plugin: `manifest.json` + `bootstrap.js`).
**Deployment model:** fully client-side; no backend server; user-supplied API keys stored via `Zotero.OSKeyStore.encrypt()` + `Services.logins`, never in Zotero preferences (decision D5, `00-overview.md` §3).
**Status of this document:** requirements baseline for v1.

Related documents (do not duplicate their content — cross-reference instead):

| File | Owns |
| --- | --- |
| `01-zotero-plugin-platform.md` | Zotero 10 plugin runtime, bootstrap lifecycle, item/collection APIs, UI hook points |
| `02-literature-database-apis.md` | PubMed/Europe PMC, Crossref, Semantic Scholar, arXiv/bioRxiv/medRxiv API contracts, rate limits, field mappings |
| `03-llm-provider-integration.md` | OpenRouter / OpenAI / Gemini / Anthropic request shapes, streaming, token accounting, retries |
| `04-audio-report-tts.md` | Gemini TTS API, voice selection, PCM/WAV handling, Korean output, attachment storage |
| `05-related-work-discovery.md` | Citation-graph and embedding-based relatedness, recommendation algorithms |
| `06-summarization-and-trend-report.md` | Map-reduce summarization, chunking, trend-report structure, evaluation |
| `07-architecture-and-data-model.md` | Module boundaries, persistence, job queue, prefs schema, item/collection mapping |
| `08-ui-ux-spec.md` | Dialogs, panes, progress UI, wording, keyboard flows |
| `09-security-privacy-and-api-keys.md` | Key storage, threat model, data egress, consent |
| `11-implementation-roadmap.md` | Phasing, effort, risk register |
| `12-prompt-library.md` | Concrete prompt templates |
| `13-testing-build-and-release.md` | Toolchain, tests, CI, release |

---

## 1. Personas

### 1.1 Persona A — Dr. Ji-woo Han, biomedical researcher (principal investigator)

**Context.** Runs a small wet-lab group at a Korean research institute. Publishes 4–6 papers a year in immunology and single-cell biology. Uses Zotero as the lab's shared reference manager; has ~8,000 items in a personal library plus two group libraries. Reads English fluently but prefers Korean for skimming and for briefing junior lab members. Commutes 50 minutes each way by subway.

**Goals.**

- G-A1: Stay current on 3–5 narrow topics without reading 200 abstracts a week.
- G-A2: Produce a "what changed in the last 3 years" narrative to open grant proposals and lab meetings.
- G-A3: Turn a reading backlog into something consumable during a commute.
- G-A4: Keep everything inside Zotero — no new SaaS account, no institutional data-governance review.
- G-A5: Brief Korean-speaking students in Korean without re-translating by hand.

**Pain points.**

- P-A1: PubMed search results are noisy; deduplicating across PubMed, Crossref, and preprint servers is manual.
- P-A2: Institutional IT is slow to approve external services; a cloud service that ingests the library is a non-starter.
- P-A3: Existing AI reading tools require re-uploading PDFs to a third-party platform that already has the metadata.
- P-A4: LLM cost is opaque; unwilling to run an unbounded job over 400 papers without a number up front.
- P-A5: Cannot easily tell whether a summary is grounded in the abstract or hallucinated.

**Success signal.** Once a week, one click produces a Korean audio briefing plus an English written trend report for a topic collection, at a predictable cost of a few dollars.

---

### 1.2 Persona B — Minseo Park, graduate student (2nd year, PhD)

**Context.** Working toward a first-author paper. Zotero library of ~600 items, mostly unread. Comfortable with technical tools, low budget (personal OpenRouter account with a $20 balance, or a free-tier Gemini key). Writes a literature review chapter.

**Goals.**

- G-B1: Given one seed paper the advisor sent, find the 30 most relevant recent papers and get them into a Zotero collection.
- G-B2: Decide quickly which of those 30 are worth reading in full.
- G-B3: Have a defensible, cited paragraph-level summary of the subfield to paste into a draft (with the intent to rewrite, not to submit verbatim).
- G-B4: Not accidentally spend the whole month's API budget in one job.

**Pain points.**

- P-B1: Does not know the right MeSH terms; keyword searches return either 12 or 12,000 results.
- P-B2: Related-work discovery today means manually walking reference lists.
- P-B3: Free-tier LLM rate limits cause half-finished jobs with no way to resume.
- P-B4: Abstract-only summaries are sometimes too shallow; full-text PDFs are inconsistently attached.
- P-B5: Uses a slower laptop; a plugin that freezes the Zotero UI for 30 seconds is unusable.

**Success signal.** From one selected item, a 30-item collection appears in under two minutes, each with a 5-bullet summary note, for well under $1.

---

### 1.3 Persona C — Dr. Elena Ruiz, systematic-review author / research librarian

**Context.** Supports a hospital evidence-synthesis unit. Runs PRISMA-compliant reviews. Zotero is the screening staging area before records move to Covidence/Rayyan. Extremely sensitive to reproducibility, provenance, and completeness. Frequently works with a shared group library.

**Goals.**

- G-C1: Run a *reproducible* multi-source search and record exactly what query was sent to which API on what date, with result counts.
- G-C2: Deduplicate across sources by DOI/PMID/title with an auditable log of what was merged and why.
- G-C3: Export the search provenance for the PRISMA flow diagram and the methods section.
- G-C4: Use LLM output only as a triage aid, clearly labeled as machine-generated, never silently mixed into human notes.
- G-C5: Guarantee that nothing leaves the machine except what she explicitly approved.

**Pain points.**

- P-C1: Tools that "improve" a query silently break reproducibility.
- P-C2: Dedup heuristics that merge two genuinely different records are worse than no dedup.
- P-C3: A hard 3-year window is wrong for a systematic review; she needs to override it.
- P-C4: Machine-generated notes indistinguishable from her own notes contaminate the review.
- P-C5: No way to audit which items were sent to an LLM provider.

**Success signal.** A search run produces a machine-readable provenance record (query string, endpoint, timestamp, raw hit count, imported count, dedup decisions) attached to the collection, and every LLM-generated note is tagged and visually distinct.

---

### 1.4 Persona-to-feature emphasis

| Feature | A (PI) | B (Grad student) | C (SR author) |
| --- | --- | --- | --- |
| 1. Keyword multi-source search | High | Medium | Critical |
| 2. Related papers for one item | Low | Critical | Medium |
| 3. Summaries + trend report | Critical | High | Medium (triage only) |
| 4. Multi-provider LLM keys | Medium | Critical (cost) | High (governance) |
| 5. Audio report (EN/KO) | Critical | Low | Low |
| 6. Recommendations from a collection | High | High | Low |

---

## 2. Functional Requirements

Conventions:

- Each FR has a stable ID. IDs are never reused.
- Priority: **M** = must-have for v1, **S** = should-have for v1, **C** = could-have (v1 if cheap), **W** = won't-have in v1 (listed in §4 Out of Scope).
- Acceptance criteria are Given/When/Then. "the user" means the person operating Zotero.
- "the plugin" means `research_helper` running in the Zotero process.

### 2.1 Feature Group 1 — Keyword search across literature databases → Zotero collection

---

**FR-1 — Launch a keyword search from the Zotero UI.** (M)

The plugin shall expose a "Search literature…" entry point that opens a search dialog, reachable from at least the Tools menu and the collections-pane context menu.

- **Given** Zotero 10 is running with `research_helper` enabled,
  **When** the user opens the Tools menu,
  **Then** a "Research Helper → Search literature…" item is present and enabled.
- **Given** the user right-clicks a collection in the collections pane,
  **When** the context menu appears,
  **Then** a "Search literature into this collection…" item is present and pre-selects that collection as the import target.
- **Given** the search dialog is open,
  **When** the user presses `Escape`,
  **Then** the dialog closes with no side effects and no network request is issued.

---

**FR-2 — Compose a query with explicit source selection.** (M)

The search dialog shall accept a free-text query and let the user enable/disable each source independently: PubMed (E-utilities), Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv, medRxiv.

- **Given** the search dialog is open,
  **When** the user inspects the source list,
  **Then** each of the seven sources is listed with an independent checkbox and a per-source result-limit field.
- **Given** the user unchecks every source,
  **When** the user attempts to run the search,
  **Then** the Search button is disabled and an inline message states that at least one source must be selected.
- **Given** the user has enabled Semantic Scholar but has not configured a Semantic Scholar API key,
  **When** the dialog renders,
  **Then** an inline notice states that unauthenticated access is heavily rate-limited and links to the key-request page (see `02-literature-database-apis.md`).

---

**FR-3 — Default 3-year recency window, user-overridable.** (M)

The plugin shall default the publication-date filter to the last 3 **calendar** years — the current year and the two years before it — and allow the user to change or disable it.

**Decided 2026-09-09 by the project owner: three calendar years, not a rolling 36 months.** An earlier draft of this requirement specified a window rolling from today (a lower bound of 2023-09-08 on 2026-09-08), which is roughly eight months narrower than the calendar-year span and disagreed with the UI specification. The calendar-year definition wins. **The computation is owned by `08-ui-ux-spec.md` §4.2** — `fromYear = currentYear − 2`, `toYear = currentYear`, evaluated at window open rather than hard-coded — and this requirement deliberately defers to it rather than restating it. Wherever this document says "the last 3 years" it means three calendar years; it never means a rolling 36-month window.

- **Given** today is any date in 2026 and the user has not changed the date filter,
  **When** the query is built,
  **Then** the effective window is `2024-01-01 … 2026-12-31` (or each source's nearest supported granularity — a whole-year range such as `2024–2026` where the source filters by year only) for every source that supports date filtering.
- **Given** the user (Persona C) sets the range to "All years",
  **When** the query is built,
  **Then** no date restriction is added to any source query and the provenance record states `dateFilter: none`.
- **Given** a source does not support server-side date filtering,
  **When** results are returned,
  **Then** the plugin filters client-side using the parsed publication date and records `dateFilterApplied: client` in provenance.

---

**FR-4 — Per-source query translation.** (M)

The plugin shall translate the user's query into each selected source's native syntax rather than sending an identical raw string everywhere.

- **Given** the query `single-cell AND (glioma OR glioblastoma)`,
  **When** the PubMed query is built,
  **Then** it is a valid E-utilities `term` with balanced parentheses and the date filter expressed as a `[dp]` range or `mindate`/`maxdate` parameters.
- **Given** the same query,
  **When** the Crossref query is built,
  **Then** boolean operators unsupported by Crossref are handled per the documented degradation rule in `02-literature-database-apis.md` and the actual transmitted query is recorded in provenance.
- **Given** any source,
  **When** the query is built,
  **Then** the exact URL (with API keys redacted) is written to the provenance record and to the debug log.

---

**FR-5 — Preview results before import.** (M)

The plugin shall show a reviewable result list before creating any Zotero item.

- **Given** a search has completed,
  **When** results are displayed,
  **Then** each row shows title, first author, year, venue, source(s), DOI/PMID/arXiv ID, and a checkbox, and all rows are checked by default.
- **Given** the result list is shown,
  **When** the user unchecks 5 of 40 rows and clicks Import,
  **Then** exactly 35 Zotero items are created.
- **Given** the result list is shown,
  **When** the user clicks Cancel,
  **Then** zero Zotero items are created and zero database writes occur.

---

**FR-6 — Create a Zotero collection and import items with metadata + abstracts.** (M)

The plugin shall create (or reuse) a Zotero collection and add items populated from bibliographic metadata including the abstract.

- **Given** the user provides the new collection name "Glioma scRNA 2023–2026",
  **When** the import completes,
  **Then** a collection with that exact name exists under the chosen parent, containing the imported items.
- **Given** a result carries an abstract from any source,
  **When** the item is created,
  **Then** `abstractNote` is populated with the abstract text, with HTML/JATS markup stripped to plain text.
- **Given** a result has a DOI,
  **When** the item is created,
  **Then** `DOI` is set in normalized lowercase form without a `https://doi.org/` prefix.
- **Given** a `journalArticle` result with a PMID or PMCID,
  **When** the item is created,
  **Then** those identifiers go in Zotero's **native `PMID` and `PMCID` fields**, which `journalArticle` has carried since schema v34 (`01-zotero-plugin-platform.md` §6.1, `02-literature-database-apis.md` §10.3, `07-architecture-and-data-model.md` §6.1), and **not** in `Extra`.
- **Given** a result whose item type has no native field for one of its identifiers — a `preprint` or `conferencePaper` with a PMID or PMCID, or any item type with an arXiv ID other than a `preprint`, which uses `archiveID`,
  **When** the item is created,
  **Then** that identifier is preserved as an `Extra` line in the ecosystem-standard form (`PMID: 12345678` / `PMCID: PMC123456` / `arXiv: 2501.01234`), written only when no such line already exists, per the `extra` contract in `07-architecture-and-data-model.md` §6.3.
- **Given** the import is running,
  **When** items are written,
  **Then** they are created inside a single Zotero transaction per batch so a failure does not leave a half-populated collection.

---

**FR-7 — Correct Zotero item-type mapping.** (M)

- **Given** a journal article result,
  **When** the item is created,
  **Then** its item type is `journalArticle` with `publicationTitle`, `volume`, `issue`, `pages`, `date`, and `ISSN` populated where available.
- **Given** an arXiv/bioRxiv/medRxiv record,
  **When** the item is created,
  **Then** its item type is `preprint` with `repository` and `archiveID` populated (see `07-architecture-and-data-model.md` for the field map).
- **Given** a record whose type cannot be determined,
  **When** the item is created,
  **Then** it defaults to `journalArticle` and a `research_helper/uncertain-type` tag is applied.

---

**FR-8 — Provenance record for every search run.** (M) *(Persona C, G-C1/G-C3)*

The plugin shall persist a machine-readable provenance record for each executed search.

- **Given** a search run completes,
  **When** the user opens the target collection,
  **Then** a standalone note (or attachment, per `07-architecture-and-data-model.md`) titled `Research Helper — search provenance <ISO timestamp>` exists in that collection.
- **Given** the provenance record,
  **When** it is inspected,
  **Then** it contains, per source: endpoint base URL, transmitted query string (keys redacted), date filter, requested limit, raw hit count reported by the source, number of records retrieved, number deduplicated away, and number imported.
- **Given** the provenance record,
  **When** the user chooses "Export provenance as JSON",
  **Then** a JSON file matching the documented schema is written to a user-chosen path.

**The documented schema is `07-architecture-and-data-model.md` §5.3**, which declares the `SearchProvenance` / `SourceProvenance` types and ships the JSON Schema artefact the export is validated against as `schema/provenance.schema.json` (`07-architecture-and-data-model.md` §2.2). This requirement owns the *field list* — the enumerations above are what must be recorded, and the per-source counts are required even when they are zero — while §5.3 owns the *shape*: type names, field names, field types, and where the record is stored. A field in §5.3 that no clause here requires, or a clause here with no field in §5.3, is a defect.

---

**FR-9 — Graceful partial failure across sources.** (M)

- **Given** four sources are selected and one returns HTTP 500 on all retries,
  **When** the search completes,
  **Then** results from the other three are still shown, and a non-blocking banner names the failed source and the error class.
- **Given** a source returns HTTP 429,
  **When** the plugin retries,
  **Then** it applies exponential backoff with jitter, honours a `Retry-After` header when present, and gives up after the configured attempt limit without blocking other sources.

---

**FR-10 — Cancellable, non-blocking search.** (M)

- **Given** a search is in progress,
  **When** the user clicks Cancel,
  **Then** all in-flight requests are aborted within 2 seconds and no items are created.
- **Given** a search is in progress,
  **When** the user interacts with the main Zotero window,
  **Then** the UI remains responsive (no synchronous network or JSON parsing on the main thread beyond 50 ms slices).

---

**FR-11 — Respect polite-use requirements of each API.** (M)

- **Given** any outbound request,
  **When** it is issued,
  **Then** it carries a `User-Agent` identifying `research_helper/<version>` and, for Crossref, a mailto in the polite pool per `02-literature-database-apis.md`.
- **Given** PubMed E-utilities,
  **When** requests are issued,
  **Then** the client-side rate limiter caps request rate at the documented unauthenticated/authenticated limit, whichever applies given the configured NCBI key.

---

**FR-12 — Re-run a previous search.** (S)

The surface is `08-ui-ux-spec.md` §2.5 (the collection submenu entry, labelled **"Re-run This Search…"**) and §4.6 (the pre-filled window state); the data model is `07-architecture-and-data-model.md` §5.3. This requirement does not restate either.

- **Given** a collection with a provenance record,
  **When** the user chooses "Re-run This Search…",
  **Then** the search dialog opens pre-filled with the recorded parameters, with the date window optionally advanced to today.
- **Given** a re-run,
  **When** items are imported,
  **Then** items already present in the collection (by DOI/PMID match) are not duplicated and are reported as "already present: N".

---

### 2.2 Feature Group 2 — Find related papers for a selected item

---

**FR-13 — Launch "Find related papers" from an item.** (M)

- **Given** exactly one item is selected in the items pane,
  **When** the user right-clicks it,
  **Then** a "Research Helper → Find related papers…" entry is enabled.
- **Given** multiple items are selected,
  **When** the context menu opens,
  **Then** the entry is either disabled with an explanatory tooltip, or (if multi-seed is implemented) labeled "Find papers related to N items".
- **Given** a selected item with no DOI, PMID, arXiv ID, or title,
  **When** the entry is invoked,
  **Then** the plugin shows an actionable error naming the missing identifiers.

---

**FR-14 — Resolve the seed item to external identifiers.** (M)

- **Given** a seed item with only a title,
  **When** relatedness lookup starts,
  **Then** the plugin attempts identifier resolution via Crossref/Semantic Scholar title match and requires a confidence threshold before proceeding, per `05-related-work-discovery.md`.
- **Given** resolution is ambiguous,
  **When** more than one candidate exceeds the threshold,
  **Then** the user is shown the candidates and asked to pick, rather than the plugin guessing.

---

**FR-15 — Retrieve related papers using multiple signals.** (M)

- **Given** a resolved seed,
  **When** the plugin gathers candidates,
  **Then** it uses at least: references of the seed, papers citing the seed, and a source-provided "recommendations"/"related" endpoint where available (see `05-related-work-discovery.md`).
- **Given** candidates from multiple signals,
  **When** they are ranked,
  **Then** each candidate carries a visible reason chip (e.g. "cited by seed", "cites seed", "co-cited", "recommended") and a score.

---

**FR-16 — Review and import related papers.** (M)

- **Given** related candidates are shown,
  **When** the user selects a subset and chooses a target collection (existing or new),
  **Then** only the selected candidates are imported, with abstracts, following FR-6/FR-7 rules.
- **Given** a candidate already exists in the user's library,
  **When** the list is rendered,
  **Then** it is marked "in library" and unchecked by default, and importing it adds the existing item to the target collection rather than creating a duplicate.

---

**FR-17 — Optional Zotero "Related" linkage.** (S)

- **Given** imported related papers,
  **When** the user has enabled the "link to seed item" preference,
  **Then** each imported item is added to the seed item's Zotero *Related* list (bidirectional).

---

**FR-18 — Recency filter applies to related discovery.** (S)

- **Given** the default 3-year window is active,
  **When** related candidates are listed,
  **Then** older candidates are still shown but visually de-emphasized and unchecked by default, so a seminal 2011 reference is discoverable but not silently imported.

---

### 2.3 Feature Group 3 — Summarize a collection and write a trend report

---

**FR-19 — Summarize every item in a collection.** (M)

- **Given** a collection is selected and an LLM provider is configured,
  **When** the user chooses "Research Helper → Summarize collection…",
  **Then** a job dialog shows item count, estimated token usage, estimated cost, and the model to be used, and requires explicit confirmation before any request is sent.
- **Given** the job runs,
  **When** each item is summarized,
  **Then** a child note is attached to that item containing the structured summary defined in `06-summarization-and-trend-report.md`.
- **Given** an item that already has a `research_helper` summary note,
  **When** the job runs,
  **Then** it is skipped by default, with a "Re-summarize existing" option available.

---

**FR-20 — Machine-generated content is labeled and separable.** (M) *(Persona C, G-C4)*

- **Given** any note created by the plugin,
  **When** it is created,
  **Then** it carries the tag `research_helper/ai-summary` (and a provider/model tag), and its first line is a machine-generated disclaimer including provider, model ID, and UTC timestamp.
- **Given** the user wants to remove all AI content,
  **When** they choose "Research Helper → Remove generated notes from collection",
  **Then** only notes carrying the `research_helper/` tag namespace are deleted, after a confirmation naming the exact count.

---

**FR-21 — Summaries are grounded and traceable.** (M) *(P-A5)*

- **Given** a summary is generated from an abstract only,
  **When** the note is written,
  **Then** it states `Source: abstract only` in the metadata header.
- **Given** a summary is generated from extracted full text,
  **When** the note is written,
  **Then** it states `Source: full text (<N> chars extracted from <attachment name>)`.
- **Given** an item with neither abstract nor extractable text,
  **When** the job runs,
  **Then** the item is skipped, counted in a "skipped: no text" bucket, and reported at the end — no summary is fabricated from title alone.

---

**FR-22 — Use full text when available, abstract otherwise.** (M) *(decision D7, `00-overview.md` §3)*

- **Given** an item has a PDF attachment with an existing Zotero full-text index or extractable text, or an Europe PMC JATS full text,
  **When** the summarization input is assembled and `summary.fullTextMode` is `auto` (**the shipped default**) or `always`,
  **Then** the full text is chunked per `06-summarization-and-trend-report.md` and used.
- **Given** `summary.fullTextMode` is `auto`,
  **When** the available full text does not materially exceed the abstract,
  **Then** the abstract is used instead, per the decision rule in `06-summarization-and-trend-report.md` §5.4.
- **Given** full-text extraction fails, yields fewer than a configured minimum number of characters, or fails the quality gate (risk R-19),
  **When** the input is assembled,
  **Then** the plugin falls back to the abstract without aborting the job and records the fallback in the note header (FR-21).

---

**FR-23 — Resumable, cancellable batch jobs.** (M) *(P-B3)*

- **Given** a summarization job over 200 items,
  **When** the user cancels at item 87,
  **Then** the 86 completed summaries are retained, no partial note is written for item 87, and the job status shows "cancelled at 87/200".
- **Given** a cancelled or failed job,
  **When** the user re-runs the same job,
  **Then** already-summarized items are skipped and the job resumes at the first unsummarized item.
- **Given** Zotero is closed mid-job,
  **When** Zotero restarts,
  **Then** no corrupt state remains, and re-running the job resumes correctly (job state need not survive restart in v1, but completed work must).

---

**FR-24 — Cost estimate and hard budget ceiling.** (M) *(P-A4, G-B4)*

- **Given** a job is about to start,
  **When** the confirmation dialog is shown,
  **Then** it shows estimated input tokens, estimated output tokens, and estimated cost in USD for the selected model, plus the wording "estimate; actual cost may differ".
- **Given** a per-job budget ceiling is configured,
  **When** cumulative actual (or best-estimate) spend for the job reaches the ceiling,
  **Then** the job pauses and asks the user to raise the ceiling or stop; it does not silently continue.
- **Given** the estimated cost exceeds the configured warning threshold,
  **When** the confirmation dialog is shown,
  **Then** the confirm button requires a second, explicit acknowledgement.

---

**FR-25 — Generate a "recent research trends" report.** (M)

- **Given** a collection whose items have summaries,
  **When** the user chooses "Research Helper → Write trends report…",
  **Then** a report is produced covering at minimum: scope and method, volume/time distribution, dominant themes with representative citations, methodological shifts, contradictions/open questions, and limitations.
- **Given** the report is generated,
  **When** it is stored,
  **Then** it is written as a standalone note in the collection, tagged `research_helper/trend-report`, with a header listing the item count, date range, model, and generation timestamp.

---

**FR-26 — Every claim in the report is citable.** (M)

- **Given** the report body,
  **When** a thematic claim is made,
  **Then** it is followed by one or more citation markers that resolve to items in the collection (e.g. `[Kim 2025]` with a resolvable link or a listed key).
- **Given** the report is generated,
  **When** it is rendered,
  **Then** it ends with a reference list of every cited item, and no cited item is absent from the collection.

---

**FR-27 — Handle collections too large for one context window.** (M)

- **Given** a collection of 400 summaries whose concatenation exceeds the model's context window,
  **When** the report is generated,
  **Then** the plugin uses the documented map-reduce/hierarchical strategy from `06-summarization-and-trend-report.md` and reports the number of reduction passes in the report header.

---

**FR-28 — Report language selection.** (S)

- **Given** the report language preference is set to Korean,
  **When** the trend report is generated,
  **Then** the narrative prose is Korean while paper titles, author names, and venue names remain in their original form.

---

### 2.4 Feature Group 4 — LLM access via user-supplied API keys

---

**FR-29 — Support four providers.** (M)

The plugin shall support OpenRouter, OpenAI, Google Gemini, and Anthropic as LLM providers through a common internal interface.

- **Given** the preferences pane,
  **When** the user opens the LLM section,
  **Then** all four providers are listed, each with its own API key field, base-URL override, and model selector.
- **Given** a provider is selected as active,
  **When** any LLM operation runs,
  **Then** requests go only to that provider's endpoint (or the user-specified base-URL override).

The base-URL override is the `<provider>.baseUrl` preference — one key per provider, empty by default, meaning "use the base URL `03-llm-provider-integration.md` documents for that provider". Key, type, default and allowed values are `07-architecture-and-data-model.md` §8.5's; the control is in the per-provider block of the preferences pane (`08-ui-ux-spec.md` §7.3).

---

**FR-30 — Keys are entered, stored, and used without leaving the client.** (M)

- **Given** the user enters an API key,
  **When** it is saved,
  **Then** it is encrypted with `Zotero.OSKeyStore.encrypt()` and stored through `Services.logins` — never in a Zotero preference, which is plaintext `prefs.js` (decision D5; see `09-security-privacy-and-api-keys.md`) — and is never transmitted to any endpoint other than the owning provider.
- **Given** the OS keystore is unavailable (e.g. Linux without libsecret),
  **When** the user tries to save a key,
  **Then** the plugin offers only the documented non-plaintext fallbacks (session-only, or passphrase-encrypted file) per `09-security-privacy-and-api-keys.md`, and never writes the key to a preference.
- **Given** the preferences pane is displayed,
  **When** a stored key is shown,
  **Then** it is masked by default with a reveal toggle.
- **Given** any log output or error dialog,
  **When** it includes a request URL or headers,
  **Then** API keys are redacted.

---

**FR-31 — Connection test.** (M)

- **Given** a provider key has been entered,
  **When** the user clicks "Test connection",
  **Then** the plugin issues a minimal, cheap request and reports success (with the resolved model list where the provider supports it) or a specific failure (401 / 403 / network / CORS-equivalent) within 15 seconds.

---

**FR-32 — Model selection and per-task model assignment.** (S)

- **Given** a configured provider,
  **When** the user opens the model selector,
  **Then** models are listed from the provider's model endpoint where available, with a free-text fallback field.
- **Given** the preferences pane,
  **When** the user configures models,
  **Then** they may assign different models to (a) per-paper summarization, (b) trend-report synthesis, and (c) query expansion, since these have different cost/quality profiles.

---

**FR-33 — No key, no silent failure.** (M)

- **Given** no LLM provider is configured,
  **When** the user invokes any LLM feature,
  **Then** a dialog explains what is missing and offers a direct link to the preferences pane; no request is attempted.

---

**FR-34 — Provider-agnostic error handling and retry.** (M)

- **Given** a provider returns 429 or 5xx,
  **When** the request fails,
  **Then** the plugin retries with exponential backoff and jitter up to a configured attempt limit and surfaces the provider's error message verbatim on final failure.
- **Given** a provider returns a context-length error,
  **When** the request fails,
  **Then** the plugin automatically reduces the chunk size once and retries before reporting failure.

---

**FR-35 — Usage accounting.** (S)

- **Given** any completed LLM request,
  **When** the provider returns usage data,
  **Then** input/output token counts are accumulated in a per-session and per-job counter visible in the job dialog and in a "Usage" section of preferences.
- **Given** a provider does not return usage data,
  **When** accounting is updated,
  **Then** the estimate is used and marked as estimated.

---

**FR-36 — Data-egress transparency.** (M) *(G-C5)*

- **Given** a user is about to run any LLM job,
  **When** the confirmation dialog is shown,
  **Then** it names the provider, the endpoint host, the number of items, and what content will be transmitted (titles + abstracts, or full text), per `09-security-privacy-and-api-keys.md`.
- **Given** the user has never run an LLM job before,
  **When** the first job is confirmed,
  **Then** a one-time consent notice is shown and the acknowledgement is recorded in the `privacy.egressAcknowledged` preference (key, type and default: `07-architecture-and-data-model.md` §8.5; the notice itself is `09-security-privacy-and-api-keys.md` §3.6).
- **Given** the acknowledgement has been recorded,
  **When** a later job runs,
  **Then** the one-time notice is not shown again, but the per-job disclosure in the first clause above still is — the acknowledgement is not a suppression switch, and it never suppresses a provider change, a privacy-mode change, the first use of full-text sending, or the Gemini free-tier warning (`09-security-privacy-and-api-keys.md` §3.6).

---

### 2.5 Feature Group 5 — Audio reports via Gemini TTS

---

**FR-37 — Generate an audio version of a report.** (M)

- **Given** a generated trend report (or a per-paper summary set),
  **When** the user chooses "Research Helper → Generate audio report…",
  **Then** the plugin synthesizes speech via Gemini TTS and produces an audio file.

---

**FR-38 — Language choice: English or Korean.** (M)

- **Given** the audio dialog,
  **When** the user chooses a language,
  **Then** English and Korean are both offered, with a voice selector per `04-audio-report-tts.md`.
- **Given** Korean is selected and the source report is English,
  **When** audio is generated,
  **Then** the plugin first produces a Korean spoken-form script via the LLM, then synthesizes it — it does not feed English text to a Korean voice.

---

**FR-39 — Audio is script-driven, not raw-report-driven.** (S)

- **Given** a trend report containing markdown, tables, and bracketed citations,
  **When** the audio script is prepared,
  **Then** markup and citation markers are converted to spoken form (or removed) per the rules in `04-audio-report-tts.md`, so the listener does not hear "open square bracket Kim twenty twenty five close square bracket".

---

**FR-40 — Audio is stored as a Zotero attachment.** (M)

- **Given** audio generation succeeds,
  **When** the file is stored,
  **Then** it is attached to the trend-report note's parent context as a stored file attachment with a descriptive title including language and date, and is playable/openable from Zotero.
- **Given** the platform cannot store the audio as an attachment,
  **When** generation succeeds,
  **Then** the user is offered a "Save as…" path instead, and this fallback is documented.

---

**FR-41 — Long reports are chunked and concatenated.** (S)

- **Given** a script exceeding the TTS request length limit,
  **When** audio is generated,
  **Then** the script is segmented on sentence/paragraph boundaries, synthesized per segment, and concatenated into one file without audible truncation.

---

**FR-42 — Audio generation is cancellable and cost-aware.** (M)

- **Given** an audio job,
  **When** the confirmation dialog is shown,
  **Then** it shows the script character count and the estimated TTS cost.
- **Given** an audio job in progress,
  **When** the user cancels,
  **Then** in-flight requests abort and any partial file is discarded.

---

**FR-43 — Graceful degradation when TTS is unavailable.** (M)

- **Given** the Gemini TTS model is unavailable, deprecated, or the key lacks entitlement,
  **When** audio generation is attempted,
  **Then** a specific error is shown, the written report remains intact, and the plugin offers to save the spoken-form script as text so the user can use an external TTS.

---

### 2.6 Feature Group 6 — Recommend and search new papers from an existing collection

---

**FR-44 — Profile a collection.** (M)

- **Given** a collection with ≥5 items,
  **When** the user chooses "Research Helper → Recommend new papers…",
  **Then** the plugin builds a topic profile from the collection (keywords/MeSH terms/embedding centroids per `05-related-work-discovery.md`) and displays the derived profile to the user before searching.
- **Given** the derived profile is displayed,
  **When** the user edits or removes terms,
  **Then** the edited profile is used.

---

**FR-45 — Generate candidate queries and run them.** (M)

- **Given** an approved topic profile,
  **When** recommendation runs,
  **Then** the plugin generates N candidate queries (LLM-assisted where a provider is configured, heuristic otherwise), runs them against the selected sources with the recency window, and merges results.
- **Given** no LLM provider is configured,
  **When** recommendation runs,
  **Then** it still works using purely heuristic term extraction, at reduced quality, and says so.

---

**FR-46 — Exclude what the user already has.** (M)

- **Given** candidate results,
  **When** the list is rendered,
  **Then** items already in the source collection are excluded entirely, and items elsewhere in the library are marked "in library" and unchecked by default.

---

**FR-47 — Explain each recommendation.** (S)

- **Given** the recommendation list,
  **When** a row is displayed,
  **Then** it shows a one-line rationale (matched terms, citation overlap, or similarity score) so the user can judge relevance without opening the paper.

---

**FR-48 — Import recommendations into a chosen collection.** (M)

- **Given** selected recommendations,
  **When** the user imports them,
  **Then** they are added to a user-chosen collection (default: a new subcollection named `<Source collection> — recommended <date>`), following FR-6/FR-7.

---

**FR-49 — Scheduled/repeat recommendations.** (C)

- **Given** a collection previously used for recommendations,
  **When** the user re-runs recommendations,
  **Then** previously-rejected candidates (explicitly unchecked and dismissed) are suppressed by default, with a "show dismissed" toggle.

> **Unverified:** background/scheduled execution while Zotero is idle has not been validated against Zotero 10's plugin lifecycle, and there is no Phase 0 spike for it in `11-implementation-roadmap.md` §4. **Scheduling is therefore out of scope for v1** (§4, item 13). What FR-49 delivers in v1 is only the dismissed-candidate suppression described above, built in Phase 5 (`11-implementation-roadmap.md`); the "scheduled/repeat" name is retained because FR IDs are never reused.

---

### 2.7 Cross-cutting functional requirements

---

**FR-50 — Deduplication across sources.** (M) *(G-C2, P-A1)*

- **Given** results from multiple sources,
  **When** they are merged,
  **Then** records are matched by, in order: DOI (normalized), PMID, arXiv ID, then normalized title + first-author surname + year.
- **Given** two records merge,
  **When** the merged record is produced,
  **Then** field values are chosen by the documented source-priority order, all contributing sources are listed, and the merge decision (rule fired, similarity score) is recorded in provenance.
- **Given** a preprint and its published version are both retrieved,
  **When** they are merged or kept separate,
  **Then** the behaviour follows the explicit, configurable rule in `02-literature-database-apis.md`, and the default is documented in the UI.
- **Given** a title-similarity match below the configured confidence threshold,
  **When** merging is considered,
  **Then** the records are **not** merged automatically; they are flagged as "possible duplicate" for user review. *(P-C2)*

---

**FR-51 — Never create duplicate Zotero items.** (M)

- **Given** an import,
  **When** an incoming record matches an existing library item by DOI or PMID,
  **Then** the existing item is added to the target collection instead of a new item being created, and the count is reported as "linked existing: N".

---

**FR-52 — Preferences pane.** (M)

- **Given** Zotero's Settings window,
  **When** the user opens it,
  **Then** a "Research Helper" pane is registered via the documented Zotero preference-pane API (see `01-zotero-plugin-platform.md`) containing sections for LLM providers, literature-source keys, defaults, language, and budget.

---

**FR-53 — Progress and job feedback.** (M)

- **Given** any long-running operation,
  **When** it runs,
  **Then** progress is shown with current/total counts and an estimated remaining time, and the operation is cancellable.

---

**FR-54 — Logging and diagnostics.** (M)

- **Given** the plugin is running,
  **When** it performs network or LLM operations,
  **Then** structured entries are written via Zotero's debug logging at the level set by `logLevel`, and **API keys are redacted unconditionally — there is no preference that unlocks them** (decision D5; the redaction patterns are `09-security-privacy-and-api-keys.md` §2.1's and are enforced at the logger, not at call sites). Full request bodies are a separate, off-by-default opt-in, `logRequestBodies`, which carries an explicit warning that abstracts and prompts will reach the log.
- The "verbose diagnostics" checkbox in `08-ui-ux-spec.md` §7.3 raises `logLevel` and **does not** enable `logRequestBodies`; the two must not be conflated, and an earlier draft of this requirement did conflate them. Keys, types and defaults for both are `07-architecture-and-data-model.md` §8.5's.
- **Given** a failure,
  **When** the user exports diagnostics,
  **Then** a redacted, shareable report is produced — the debug bundle specified in `07-architecture-and-data-model.md` §10.4 (plugin version, Zotero version, OS, settings with secret-flagged values replaced, recent jobs, the last N log lines), written to a file the user chooses. Nothing is uploaded, and no API key and no paper content is included.

---

**FR-55 — Localization: English and Korean UI.** (M)

- **Given** Zotero's locale is `ko-KR`,
  **When** the plugin UI renders,
  **Then** all plugin strings appear in Korean via Fluent `.ftl` files.
- **Given** a string is missing from the Korean bundle,
  **When** the UI renders,
  **Then** it falls back to English rather than showing an identifier.

---

**FR-56 — Clean install/uninstall.** (M)

- **Given** the plugin is disabled or uninstalled without restarting Zotero,
  **When** `shutdown()` runs,
  **Then** all registered menu items, panes, observers, timers, and windows are removed, and no errors appear in the debug log.
- **Given** the plugin is uninstalled,
  **When** the user restarts Zotero,
  **Then** items, collections, and notes previously created remain intact (they are ordinary Zotero data).

---

## 3. Non-Functional Requirements

Performance targets below assume: a mid-range 2023 laptop (4 physical cores, 16 GB RAM, SSD), a Zotero library of ~10,000 items, and Zotero 10.x. All targets **exclude external API latency** unless stated. All are measured on the plugin's own code paths.

---

**NFR-1 — Item import throughput.** (M)
Importing 100 already-fetched records into a Zotero collection shall complete in **≤ 10 seconds** of plugin+Zotero-DB time, excluding network time. Target: ≤ 6 s.

- Measured from "user clicks Import" to "collection contains 100 items", with all network responses pre-fetched/mocked.
- Rationale: Zotero item creation is transactional; batching is required. See `07-architecture-and-data-model.md`.
- **Scope: the hand-mapped import path only** (`useTranslators` off, which is its shipped default — `07-architecture-and-data-model.md` §8.5). The optional Zotero-translator path (`01-zotero-plugin-platform.md` §6.3 Strategy B) issues one `Zotero.Translate.Search` identifier lookup per record; that lookup *is* the import, so it cannot be pre-fetched or mocked away and the run is outside this budget by construction. Turning the preference on is a documented trade of speed for Zotero-canonical metadata, and the UI says so.

**NFR-2 — Search wall-clock budget.** (M)
A 4-source search returning ≤ 100 results per source shall complete in **≤ 30 seconds** wall-clock under normal network conditions, including API latency, with per-source timeouts of 20 s and overall cancellation always available.

**NFR-3 — UI responsiveness.** (M)
The plugin shall never block the Zotero main thread for more than **100 ms** in a single task. Long parsing/normalization work is chunked with yields. No spinner-free freeze is acceptable.

**NFR-4 — Summarization throughput budget.** (M)
Summarizing **100 abstracts** shall complete within **≤ 8 minutes** wall-clock using a small/fast model with a concurrency of 4 in-flight requests, and shall consume **≤ 15 seconds** of plugin CPU time in aggregate (i.e. the job is API-bound, not plugin-bound).

- Note that 4 is the **measurement condition**, not the shipped default: the `llm` worker pool ships at **3** (`07-architecture-and-data-model.md` §7.2, pref `concurrency`, user-configurable 1–8 per §8.5), so 4 is a value the user can legitimately select. Run the benchmark at 4 and record the shipped-default figure alongside it.

- Given typical abstracts of ~250 words, expected token volume is on the order of 60k–120k input tokens and 20k–40k output tokens for 100 papers.
- **Unverified:** exact wall-clock depends on the provider's throughput and rate limits; the 8-minute figure is a design target to be validated in Phase 3, not a vendor guarantee.

**NFR-5 — Cost ceiling for a reference workload.** (M)
The reference workload — 100 abstracts summarized + one trend report over those 100 summaries — shall cost **≤ USD 1.00** when using a provider's small/cheap tier, and the plugin shall display an estimate before running.

- The plugin shall support a configurable hard per-job ceiling, which pauses the job when reached (FR-24), **and** a configurable hard per-session ceiling distinct from it. Those ceilings are the `run.maxSpendUSD` and `run.maxSessionSpendUSD` preferences, and the warning threshold that forces a second acknowledgement is `summary.confirmAboveUSD`; **their keys, types and shipped defaults are owned by `07-architecture-and-data-model.md` §8.5** and are not restated here. The difference between the two ceilings — the session counter accumulates across jobs and resets when Zotero restarts — is owned by `06-summarization-and-trend-report.md` §11.4.
- Full-text summarization is expected to be roughly an order of magnitude more expensive and shall carry its own, higher default ceiling and a distinct warning.

**NFR-6 — Concurrency limits.** (M)
Outbound concurrency shall be bounded per host and per worker pool, with conservative defaults, and the plugin shall never exceed a source's documented rate limit. **`07-architecture-and-data-model.md` §7.2 (worker pools) and §7.3 (per-host limiters) own the numbers**, and §8.5 owns the one preference: `concurrency`, which sizes the `llm` pool only. The `network-metadata` and `zotero-write` pools and the per-host token buckets are fixed, not user-configurable — an earlier draft of this requirement asked for a separately configurable limit per literature source and per LLM provider, which the architecture deliberately does not offer.

**NFR-7 — Memory footprint inside the Zotero process.** (M)
Steady-state incremental memory attributable to the plugin (idle, plugin loaded, no job running) shall be **≤ 30 MB**. During the reference workload (100 items) peak incremental usage shall be **≤ 150 MB**; during a 500-item full-text job, **≤ 400 MB**.

- Enforced by streaming/chunking: raw API payloads and extracted full text must not be retained after normalization; only normalized records and summaries stay resident.
- Rationale: the plugin shares a process with Zotero; OOM-ing Zotero is a data-integrity risk.

**NFR-8 — Storage footprint.** (M)
Plugin-managed state outside Zotero items (caches, fixtures of past runs, dismissed-recommendation lists) shall be bounded, with an LRU eviction policy and a "Clear cache" button in preferences. **The per-namespace caps and the TTLs are owned by `07-architecture-and-data-model.md` §9.2, and the user-configurable global cap is the `cache.maxSizeMB` preference declared in §8.5** — its default and range are that row's, and are not restated here. An earlier draft of this requirement named a 50 MB cap, which is smaller than §9.2's cap for the `summary` namespace alone; a second draft restated the global default here, which §8.5 now owns.

**NFR-9 — Offline behaviour.** (M)
With no network connectivity, the plugin shall: load and register its UI without error; show a clear "no network" message rather than a stack trace when a network action is invoked; and keep all previously created items, notes, and audio attachments fully usable. No feature may cause data loss when the network drops mid-job (FR-23).

**NFR-10 — Startup impact.** (M)
The plugin shall add **≤ 200 ms** to Zotero startup, and shall defer all non-essential initialization (model list fetches, cache warming) until first use. No network request shall be issued at startup.

**NFR-11 — Localization.** (M)
All user-visible strings shall live in Fluent `.ftl` resources with complete `en-US` and `ko-KR` bundles at release. No string concatenation that assumes English word order. Dates and numbers formatted via `Intl` using the Zotero locale.

**NFR-12 — Content-language independence.** (S)
UI language and generated-content language are independent settings: a Korean UI may produce English reports and vice versa (FR-28, FR-38).

**NFR-13 — Accessibility.** (M)
All plugin dialogs shall be fully keyboard navigable (logical tab order, visible focus ring, `Escape` to cancel, `Enter` to confirm). All controls shall have accessible names. Colour shall never be the sole carrier of meaning (dedup/AI/status indicators need text or icon). Contrast shall meet WCAG 2.1 AA (4.5:1 body text) in both Zotero light and dark themes. Progress dialogs shall announce completion to assistive technology.

> **Unverified:** the exact assistive-technology support surface of Zotero 10's XHTML/XUL dialogs has not been tested; an accessibility smoke test with NVDA (Windows) and VoiceOver (macOS) is a Phase 7 deliverable.

**NFR-14 — Error transparency.** (M)
Every user-facing error shall state what failed, which service was involved, and one concrete next action. No bare "An error occurred". Provider error text is surfaced verbatim in a details disclosure.

**NFR-15 — Determinism for auditability.** (S)
Where a provider supports it, the plugin shall send a fixed `temperature` (default low) and a `seed`, and shall record model ID, parameters, and prompt-template version in every generated note so output is reproducible-by-description even when not bit-identical.

**NFR-16 — Security of secrets.** (M)
API keys shall never be written to the debug log, to notes, to provenance records, to clipboard diagnostics, or to any endpoint other than the owning provider. See `09-security-privacy-and-api-keys.md` for the storage decision and its residual risk.

**NFR-17 — Compatibility.** (M)
The plugin shall declare `strict_min_version` / `strict_max_version` for Zotero 10 and shall be verified on Windows, macOS, and Linux builds of Zotero 10.x. See `13-testing-build-and-release.md` for the versioning policy under Zotero's 6–10-week release cadence.

**NFR-18 — Bundle size.** (S)
The built XPI shall be **≤ 3 MB**. No bundled model weights, no bundled Chromium, no unnecessary polyfills.

**NFR-19 — Dependency hygiene.** (S)
Runtime dependencies shall be minimal and vendored through the bundler; no runtime `npm` fetch, no remote script loading, no `eval` of remote content.

**NFR-20 — Data integrity.** (M)
The plugin shall never delete or modify user-authored items or notes. Modification is limited to: creating items, adding items to collections, creating child/standalone notes owned by the plugin, adding `research_helper/` tags, and (opt-in) adding Related links. Deletion is limited to plugin-owned, tagged notes after explicit confirmation.

---

## 4. Out of Scope for v1

Explicitly **not** built in v1. Each is listed with the reason, so the decision is not relitigated informally.

1. **Downloading PDFs from behind paywalls.** No credential handling, no proxy/EZproxy integration, no Sci-Hub-style resolution. The plugin uses metadata + abstracts and, optionally, PDFs the user already has attached. *(Legal and ethical exposure; Zotero already has a Find Full Text feature and a connector.)*
2. **Automatic open-access PDF fetching.** Even for legitimately open PDFs, v1 does not auto-download. Users can use Zotero's built-in "Find Available PDF". *(Scope and bandwidth; revisit in v1.1.)*
3. **Cloud sync of plugin state.** Preferences, caches, dismissed lists, and job state stay local. Only ordinary Zotero data (items, collections, notes, attachments) syncs, because Zotero syncs it. *(No backend; conflict resolution is a project of its own.)*
4. **Collaborative or multi-user features.** No shared jobs, no shared prompt libraries, no per-user attribution in group libraries beyond Zotero's own. *(No backend.)*
5. **A hosted backend, proxy, or shared API key.** All calls originate from the user's machine with the user's keys. *(Explicit project decision; changing it changes the entire security and cost model.)*
6. **Fine-tuning, embedding indexes over the whole library, or local model inference.** No bundled ONNX/llama.cpp, no persistent vector store over 10k items. Relatedness in v1 uses external APIs and lightweight lexical signals. *(Memory footprint NFR-7; complexity.)*
7. **A general chat interface over the library.** v1 has task-shaped commands, not an open chatbot. *(Scope; evaluation difficulty.)*
8. **Automatic screening decisions for systematic reviews.** The plugin will not label items include/exclude. It is a triage aid only. *(Methodological integrity; Persona C requirement G-C4.)*
9. **Citation-style formatting, bibliography generation, or word-processor integration.** Zotero already does this.
10. **Additional literature sources beyond the seven named** (PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv, medRxiv — see FR-2). Scopus, Web of Science, Dimensions, OpenAlex and CORE are out. OpenAlex is the most likely v1.1 addition. *(Licensing and effort.)*
11. **Additional TTS providers** (OpenAI TTS, ElevenLabs, Azure). Gemini TTS only in v1. *(Scope; see FR-43 fallback.)*
12. **Languages other than English and Korean** for UI or generated content.
13. **Scheduled/background jobs running without the user present.** See the FR-49 caveat.
14. **Mobile / Zotero for iOS or Android.** Plugins are not supported there.
15. **Zotero 7/8/9 backward compatibility.** v1 targets 10.x only; older-version support is a separate branch decision if demand appears.
16. ~~**Encrypted key storage backed by an OS keychain.**~~ **Moved into v1 scope.** This was originally deferred on the assumption that an OS-keychain backend was expensive to build. Research disproved that: Zotero already exposes `Zotero.OSKeyStore.encrypt()` (Windows DPAPI / macOS Keychain / libsecret) and uses it with `Services.logins` for its own zotero.org API key, so the plugin reuses an existing, first-party code path rather than building one. Storing spendable credentials in plaintext when a one-call alternative exists is not a defensible v1 trade-off. *(Design: `09-security-privacy-and-api-keys.md`. Roadmap: this retires risk R-9 rather than accepting it.)*
17. **Telemetry or analytics of any kind.** No usage pings, no crash reporting to a remote endpoint.
18. **A Job Center window** — a dedicated, durable job-management surface listing running and past jobs with pause / resume / cancel / retry, per-job stage breakdown, warnings and cost, surviving a Zotero restart. **DECIDED 2026-09-09 by the project owner: out of v1, deferred to v1.1.** The two progress surfaces `07-architecture-and-data-model.md` §7.7 already describes — Zotero's own `ProgressWindow` for the transient signal, and the plugin's own in-window status list (`08-ui-ux-spec.md` §6.4) for bulk item operations — cover what v1 needs. (`Zotero.ProgressQueue` is **not** one of them: `08-ui-ux-spec.md` §8.2.1 and `01-zotero-plugin-platform.md` §10.4 own the decision against it, and an earlier draft of this entry named it here.) A dedicated job-management window is a convenience for a plugin that runs many long jobs, which is a v1.1 problem once there is evidence users hit it. *(No requirement is orphaned: no FR or NFR named the window. FR-53 asks for progress with current/total counts and a cancel affordance, which the two progress surfaces provide; FR-23 already states that job state need not survive a restart in v1 so long as completed work does. The deferred design is kept, not deleted — `07-architecture-and-data-model.md` §7.7.1 — and `08-ui-ux-spec.md` §10.1 records the surface's removal from the v1 surface set.)*

---

## 5. Open Questions for the Product Owner

Each question has a **recommended default**. If no decision is made, the default is what gets built. Questions that have since been **decided** are struck through and carry the decision and its ID in `00-overview.md` §3; they are kept here (rather than deleted) so the IDs referenced from `11-implementation-roadmap.md` §5 stay stable.

1. **Is the 3-year window a hard default or a soft one?**
   *Recommended default:* soft — default to 3 years, always overridable in the search dialog, and always recorded in provenance (FR-3). Persona C cannot use a hard window.
   *The width of the window is no longer open.* **DECIDED 2026-09-09 — three calendar years (the current year and the two before it), not a rolling 36 months.** The computation belongs to `08-ui-ux-spec.md` §4.2 and FR-3 defers to it. Only the hard-versus-soft question above remains open.

2. **Preprint vs. published version: merge or keep both?**
   *Recommended default:* keep both by default, link them via Zotero *Related*, and mark the preprint with a `research_helper/superseded-by-published` tag when a DOI match is found. Merging loses the preprint's date, which matters for trend analysis.

3. ~~**Where do per-paper summaries live: child notes, the `Extra` field, or a separate note per collection?**~~
   **DECIDED — the question conflated two artifacts, and both now have owners.** The *machine-readable* summary is a `StoredSummary` row in the plugin's own SQLite `summary` table (`07-architecture-and-data-model.md` §8.3; design decision D-06-8 in `06-summarization-and-trend-report.md` §11.3 records why the earlier "one child note per item" answer was overruled — 200 papers would mean 200 notes the user never asked for, and any user edit silently corrupts the cache). The *human-readable* child note is a real feature but an **opt-in** one, tagged `research_helper/ai-summary`, governed by the `report.perPaperNotes` preference and by the explicit "Save as note" action in `08-ui-ux-spec.md` §3.2 — never written automatically. `Extra` is ruled out permanently (doc 06 §11.3 option B). Bulk removal (FR-20) covers the tagged notes. Shipped defaults for `report.perPaperNotes` are `07-architecture-and-data-model.md` §8.5's.

4. ~~**Do summaries default to abstract-only or full-text-when-available?**~~
   **DECIDED 2026-09-08 — decision D7 (`00-overview.md` §3): full text whenever available.** `summary.fullTextMode` ships as `auto`. Cost is controlled by a mandatory pre-run estimate with a confirmation above `summary.confirmAboveUSD` (that threshold's shipped value is `07-architecture-and-data-model.md` §8.5's), not by preferring the cheap path (FR-22, FR-24, NFR-5). The consequence is that the IMRaD section detector is on the critical path — see risks R-19 and R-19b in `11-implementation-roadmap.md`. The earlier recommendation here was abstract-only; it was overruled.

5. ~~**Which LLM provider is the recommended default in the setup flow?**~~
   **DECIDED 2026-09-08 — decision D6 (`00-overview.md` §3): OpenRouter is the default provider.** One key reaches every model, and OpenRouter's public catalogue is the only machine-readable price source among the four, which makes the pre-run cost estimate real. Gemini remains required for audio reports (F5) and a first-class picker option, but is not what a user gets by not choosing. The earlier recommendation of "no provider preselected, neutral chooser" was overruled; the first-run flow prompts for OpenRouter (`03-llm-provider-integration.md` §16). Every OpenRouter request must send `provider.data_collection: "deny"`.

6. **Should the cost ceilings ship switched on?**
   Both ceilings now exist as preferences — `run.maxSpendUSD` (per job) and `run.maxSessionSpendUSD` (per Zotero session, NFR-5) — and **their shipped values are `07-architecture-and-data-model.md` §8.5's, not this document's.** As the schema stands, both ship **off**, and what actually protects Persona B is the mandatory pre-run estimate plus the confirmation forced above `summary.confirmAboveUSD` (07-architecture-and-data-model.md §8.5 again for that figure). The earlier text here named two dollar figures as if they were the shipped defaults; they were not, and one of them collided with `summary.confirmAboveUSD`, which is a *warning threshold*, not a ceiling.
   *The residual question, and it is a real one:* should either ceiling ship non-zero, i.e. should a first run be able to stop itself rather than only warn? Turning them on protects a user who dismisses the estimate; leaving them off means no job ever aborts on a limit the user did not set. If the answer is yes, change the defaults in 07-architecture-and-data-model.md §8.5 — and nowhere else. Semantics for both are `06-summarization-and-trend-report.md` §11.4's.

7. **Should the plugin ever call an LLM without an explicit per-run confirmation?**
   *Recommended default:* no. Every LLM-invoking action requires confirmation showing item count and cost estimate, with a "don't ask again for jobs under $X" opt-out.

8. **Is a Semantic Scholar API key a hard requirement for relatedness features?**
   *Recommended default:* no — degrade gracefully. Unauthenticated Semantic Scholar access is heavily rate-limited, so the plugin should be usable with reference/citation signals from Crossref and Europe PMC alone, and should tell the user what improves with a key.

9. **What register should the audio report use?**
   The *length* half of this question is answered: it is the `tts.targetMinutes` preference (`07-architecture-and-data-model.md` §8.5 for key, type, default and range), which ships in its auto state and is resolved from the report's own target length by `04-audio-report-tts.md` §12. This document does not name a duration; the earlier "5–8 minutes / 800–1,200 words" text here was a third, unowned figure alongside doc 04 §11's worked example and doc 06 §9.2's length table.
   *Recommended default for the register, which is the part still open:* conversational, no citation markers read aloud, with the written companion report as the source of record — matching `04-audio-report-tts.md` §8.1's rewrite rules.

10. **Korean audio: translate the English report, or generate the Korean script natively?**
    *Recommended default:* generate the Korean spoken script natively from the summaries (not by translating the finished English report), because translated academic prose reads badly aloud. Keep titles/venues untranslated.

11. **Should generated notes be editable by the user, and what happens on re-run?**
    *Recommended default:* editable. On re-run, if a note has been modified since generation (hash mismatch), do not overwrite — create a new note and warn.

12. **Does the plugin write anything into group libraries?**
    *Recommended default:* yes, if the user targets a group collection and has write permission — but show an extra confirmation naming the group, because generated content becomes visible to all members.

13. **How aggressive should title-based deduplication be?**
    *Recommended default:* conservative. Auto-merge only on identifier match; title matches above the threshold are flagged for review, never auto-merged (FR-50). False merges are unrecoverable-feeling; false splits are not.

14. **Do we ship a "remove all Research Helper content" command?**
    *Recommended default:* yes (FR-20). It costs little and materially reduces adoption risk for Persona C.

15. **Minimum supported Zotero version — 10.0 only, or 10.0 with a floor at 9.x?**
    *Recommended default:* `strict_min_version` at the 10.0 series only. Zotero 10 changed selection and search APIs in breaking ways (see `01-zotero-plugin-platform.md`); supporting 9.x means a compatibility shim for a version that will be superseded in weeks.

16. **What is the update-manifest hosting strategy?**
    *Recommended default:* a `release` git tag/branch in the GitHub repo serving `update.json`, referenced by `update_url` in `manifest.json`, as generated by `zotero-plugin-scaffold`. See `13-testing-build-and-release.md`.

17. **Do we support a user-supplied custom OpenAI-compatible base URL (self-hosted / vLLM / Ollama)?**
    *Recommended default:* yes, as a base-URL override on the OpenAI provider. It costs one text field and unlocks fully-local operation for privacy-constrained users — a strong differentiator for Persona C.

18. ~~**What is the licensing model for the plugin?**~~
    **DECIDED 2026-09-08 — decision D8 (`00-overview.md` §3): MIT.** The earlier recommendation of AGPL-3.0 (matching `zotero-plugin-scaffold`'s own license) was overruled; `zotero-plugin-scaffold` is a build-time tool, not a linked runtime dependency, so its license does not propagate.
    **The residual pre-release action is also closed. DECIDED 2026-09-09 by the project owner: institutional clearance to release under MIT exists, so no further sign-off is a precondition of first public release.** The earlier text here said "Confirm with the institution's IP office before first public release"; that condition is discharged and is no longer a release gate. *Reopen condition:* a change of licence away from MIT, or reassignment of the work to a different institution — either invalidates the clearance and this question reopens.

19. **Should the trend report be a Zotero note, a markdown file export, or both?**
    *Recommended default:* both — a note is the primary artifact (syncs, searchable), with an "Export as Markdown" action for pasting into a manuscript.

20. **Do we pursue listing in the community plugin registry at v1.0 or wait?**
    *Recommended default:* list at v1.0. There is currently no official Zotero plugin directory, so listing means announcing in the Zotero Forums and submitting to the community lists (see `13-testing-build-and-release.md`); this is cheap and reversible.

---

## 6. Traceability Matrix

FR → design documents that specify the implementation. `07-architecture-and-data-model.md` and `08-ui-ux-spec.md` are load-bearing for almost everything; they are listed only where they carry primary responsibility.

| FR | Summary | Primary design doc(s) | Supporting |
| --- | --- | --- | --- |
| FR-1 | Search entry points | `08-ui-ux-spec.md` | `01-zotero-plugin-platform.md` |
| FR-2 | Query + source selection | `08-ui-ux-spec.md` | `02-literature-database-apis.md` |
| FR-3 | 3-year window | `02-literature-database-apis.md` | `08-ui-ux-spec.md` |
| FR-4 | Per-source query translation | `02-literature-database-apis.md` | `07-architecture-and-data-model.md` |
| FR-5 | Result preview | `08-ui-ux-spec.md` | `07-architecture-and-data-model.md` |
| FR-6 | Collection + item creation | `07-architecture-and-data-model.md` | `01-zotero-plugin-platform.md` |
| FR-7 | Item-type mapping | `07-architecture-and-data-model.md` | `02-literature-database-apis.md` |
| FR-8 | Search provenance | `07-architecture-and-data-model.md` | `08-ui-ux-spec.md`, `09-security-privacy-and-api-keys.md` |
| FR-9 | Partial failure | `02-literature-database-apis.md` | `07-architecture-and-data-model.md` |
| FR-10 | Cancellable search | `07-architecture-and-data-model.md` | `08-ui-ux-spec.md` |
| FR-11 | Polite API use | `02-literature-database-apis.md` | — |
| FR-12 | Re-run search | `07-architecture-and-data-model.md` | `08-ui-ux-spec.md` |
| FR-13 | Related-papers entry point | `08-ui-ux-spec.md` | `01-zotero-plugin-platform.md` |
| FR-14 | Seed identifier resolution | `05-related-work-discovery.md` | `02-literature-database-apis.md` |
| FR-15 | Multi-signal relatedness | `05-related-work-discovery.md` | `02-literature-database-apis.md` |
| FR-16 | Review + import related | `08-ui-ux-spec.md` | `07-architecture-and-data-model.md` |
| FR-17 | Zotero Related linkage | `07-architecture-and-data-model.md` | `01-zotero-plugin-platform.md` |
| FR-18 | Recency in related | `05-related-work-discovery.md` | `08-ui-ux-spec.md` |
| FR-19 | Summarize collection | `06-summarization-and-trend-report.md` | `03-llm-provider-integration.md`, `12-prompt-library.md` |
| FR-20 | AI content labeling | `07-architecture-and-data-model.md` | `09-security-privacy-and-api-keys.md`, `08-ui-ux-spec.md` |
| FR-21 | Grounding + traceability | `06-summarization-and-trend-report.md` | `12-prompt-library.md` |
| FR-22 | Full text vs abstract | `06-summarization-and-trend-report.md` | `07-architecture-and-data-model.md` |
| FR-23 | Resumable jobs | `07-architecture-and-data-model.md` | `08-ui-ux-spec.md` |
| FR-24 | Cost estimate + ceiling | `03-llm-provider-integration.md` | `08-ui-ux-spec.md` |
| FR-25 | Trend report | `06-summarization-and-trend-report.md` | `12-prompt-library.md` |
| FR-26 | Citable claims | `06-summarization-and-trend-report.md` | `12-prompt-library.md` |
| FR-27 | Map-reduce for large collections | `06-summarization-and-trend-report.md` | `03-llm-provider-integration.md` |
| FR-28 | Report language | `06-summarization-and-trend-report.md` | `12-prompt-library.md` |
| FR-29 | Four providers | `03-llm-provider-integration.md` | `07-architecture-and-data-model.md` |
| FR-30 | Key storage | `09-security-privacy-and-api-keys.md` | `03-llm-provider-integration.md` |
| FR-31 | Connection test | `03-llm-provider-integration.md` | `08-ui-ux-spec.md` |
| FR-32 | Model selection | `03-llm-provider-integration.md` | `08-ui-ux-spec.md` |
| FR-33 | No key → guided error | `08-ui-ux-spec.md` | `03-llm-provider-integration.md` |
| FR-34 | Provider error/retry | `03-llm-provider-integration.md` | — |
| FR-35 | Usage accounting | `03-llm-provider-integration.md` | `08-ui-ux-spec.md` |
| FR-36 | Egress transparency | `09-security-privacy-and-api-keys.md` | `08-ui-ux-spec.md` |
| FR-37 | Audio generation | `04-audio-report-tts.md` | `03-llm-provider-integration.md` |
| FR-38 | EN/KO audio | `04-audio-report-tts.md` | `12-prompt-library.md` |
| FR-39 | Spoken-form script | `04-audio-report-tts.md` | `12-prompt-library.md` |
| FR-40 | Audio as attachment | `04-audio-report-tts.md` | `07-architecture-and-data-model.md` |
| FR-41 | Chunk + concatenate audio | `04-audio-report-tts.md` | — |
| FR-42 | Audio cancel/cost | `04-audio-report-tts.md` | `08-ui-ux-spec.md` |
| FR-43 | TTS unavailable fallback | `04-audio-report-tts.md` | `08-ui-ux-spec.md` |
| FR-44 | Collection profiling | `05-related-work-discovery.md` | `06-summarization-and-trend-report.md` |
| FR-45 | Candidate query generation | `05-related-work-discovery.md` | `02-literature-database-apis.md`, `12-prompt-library.md` |
| FR-46 | Exclude owned items | `05-related-work-discovery.md` | `07-architecture-and-data-model.md` |
| FR-47 | Recommendation rationale | `05-related-work-discovery.md` | `08-ui-ux-spec.md` |
| FR-48 | Import recommendations | `07-architecture-and-data-model.md` | `08-ui-ux-spec.md` |
| FR-49 | Dismissed/repeat recs | `05-related-work-discovery.md` | `07-architecture-and-data-model.md` |
| FR-50 | Cross-source dedup | `02-literature-database-apis.md` | `07-architecture-and-data-model.md` |
| FR-51 | No duplicate items | `07-architecture-and-data-model.md` | `01-zotero-plugin-platform.md` |
| FR-52 | Preferences pane | `01-zotero-plugin-platform.md` | `08-ui-ux-spec.md`, `09-security-privacy-and-api-keys.md` |
| FR-53 | Progress UI | `08-ui-ux-spec.md` | `07-architecture-and-data-model.md` |
| FR-54 | Logging/diagnostics | `01-zotero-plugin-platform.md` | `09-security-privacy-and-api-keys.md` |
| FR-55 | i18n EN/KO | `01-zotero-plugin-platform.md` | `08-ui-ux-spec.md` |
| FR-56 | Clean install/uninstall | `01-zotero-plugin-platform.md` | `13-testing-build-and-release.md` |

### 6.1 NFR traceability

| NFR | Theme | Primary doc(s) |
| --- | --- | --- |
| NFR-1, NFR-2, NFR-4 | Throughput | `07-architecture-and-data-model.md`, `13-testing-build-and-release.md` |
| NFR-3, NFR-10 | UI responsiveness / startup | `01-zotero-plugin-platform.md`, `07-architecture-and-data-model.md` |
| NFR-5 | Cost ceilings | `03-llm-provider-integration.md` |
| NFR-6 | Concurrency/rate limits | `02-literature-database-apis.md`, `03-llm-provider-integration.md` |
| NFR-7, NFR-8, NFR-18 | Memory / storage / bundle | `07-architecture-and-data-model.md`, `13-testing-build-and-release.md` |
| NFR-9 | Offline | `07-architecture-and-data-model.md` |
| NFR-11, NFR-12 | Localization | `01-zotero-plugin-platform.md`, `08-ui-ux-spec.md` |
| NFR-13 | Accessibility | `08-ui-ux-spec.md` |
| NFR-14 | Error transparency | `08-ui-ux-spec.md` |
| NFR-15 | Determinism | `03-llm-provider-integration.md`, `12-prompt-library.md` |
| NFR-16 | Secrets | `09-security-privacy-and-api-keys.md` |
| NFR-17 | Compatibility | `13-testing-build-and-release.md`, `01-zotero-plugin-platform.md` |
| NFR-19, NFR-20 | Dependencies / data integrity | `07-architecture-and-data-model.md`, `13-testing-build-and-release.md` |

### 6.2 Requirement coverage gaps to watch

- FR-49's *scheduling* aspect has no verified platform mechanism and no Phase 0 spike covering it, so it is out of scope for v1 (§4, item 13); only dismissed-candidate suppression ships.
- NFR-13 (accessibility) depends on Zotero 10 dialog behaviour that has not been tested with a screen reader.
- NFR-4/NFR-5 depend on provider pricing and throughput that change without notice; they must be re-validated at each release (see the manual QA checklist in `13-testing-build-and-release.md`).

---

## Sources

- [Zotero Plugin Development — zotero.org](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero 7 for Developers — zotero.org](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero 10 for Developers — zotero.org](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [A Faster Release Cycle for Zotero — Zotero Blog](https://www.zotero.org/blog/a-faster-release-cycle-for-zotero/)
- [Plugins for Zotero — zotero.org](https://www.zotero.org/support/plugins)
- [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [zotero-plugin-dev/zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold)
- [Zotero Plugin Dev Community](https://zotero-plugin.dev/)
- [WCAG 2.1 — W3C](https://www.w3.org/TR/WCAG21/)

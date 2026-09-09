# research_helper — Product Overview & Scope

> **Status:** Research / design phase. No implementation code exists yet.
> **Last updated:** 2026-09-09
> **Target platform:** Zotero 10.x (bootstrapped plugin architecture)
> **Architecture:** Fully client-side — no backend server

---

## 1. What this is

**research_helper** is a Zotero plugin that turns a Zotero library from a passive
reference store into an active research assistant. It closes the loop between
*finding* literature, *organizing* it in Zotero, *understanding* it, and
*deciding what to read next* — without ever leaving Zotero.

The plugin is aimed primarily at biomedical and life-science researchers (PubMed
is a first-class source), but every capability is subject-agnostic through
Crossref, Semantic Scholar, and arXiv.

---

## 2. The six capabilities

| # | Capability | One-line description | Primary design doc |
|---|---|---|---|
| **F1** | **Keyword → Library** | Enter a topic; the plugin searches multiple literature databases for the last 3 years, pulls bibliographic metadata + abstracts, deduplicates, and creates a Zotero collection. | [02](02-literature-database-apis.md) |
| **F2** | **Related-paper expansion** | Select a paper already in Zotero; the plugin finds related work via citation graphs and semantic recommendation APIs and adds it to a collection. | [05](05-related-work-discovery.md) |
| **F3** | **Collection → Trend report** | Point at a collection; the plugin summarizes each paper and synthesizes a "recent research trends" report from those summaries. | [06](06-summarization-and-trend-report.md) |
| **F4** | **Multi-provider LLM access** | All AI features run through user-supplied API keys for OpenRouter, OpenAI, Google Gemini, or Anthropic — the user chooses provider and model. | [03](03-llm-provider-integration.md) |
| **F5** | **Audio report** | The trend report is rewritten as a spoken script and synthesized to audio in English or Korean via Gemini TTS. | [04](04-audio-report-tts.md) |
| **F6** | **Collection-based recommendation** | Profile an existing collection and recommend + fetch new papers the user does not yet have. | [05](05-related-work-discovery.md) |

---

## 3. Confirmed design decisions

D1–D9 were decided with the project owner on 2026-09-08; **D10 on 2026-09-09**.
All are binding for v1 — changing any of them invalidates parts of the design docs.
Each decision states its own date, so this list stays accurate as it grows.

### D1 — Target Zotero 10.x, bootstrapped plugin architecture

The owner runs **Zotero 10.0.1** (released 2026-08-24). Zotero moved to a rapid
release cycle during 2026, going 7 → 8 → 9 → 10 in a single year. The plugin
model, however, is still the **bootstrapped plugin** introduced in Zotero 7:
a WebExtension-style `manifest.json` plus a `bootstrap.js` exposing lifecycle
hooks, with full access to platform internals (XPCOM, filesystem, `Zotero.*`).

**Consequence:** the plugin gets enormous power, but Zotero explicitly warns that
plugins using full API access must be maintained across major versions. Version
compatibility management is therefore a first-class concern, not an afterthought
— see [11](11-implementation-roadmap.md) (risk register) and
[13](13-testing-build-and-release.md) (`strict_max_version` strategy).

### D2 — Literature sources for v1

- **PubMed** (NCBI E-utilities) and **Europe PMC**
- **Crossref**
- **Semantic Scholar** (Academic Graph + Recommendations)
- **arXiv / bioRxiv / medRxiv**

All are free and have public APIs. Paid sources (Scopus, Web of Science) are
explicitly out of scope for v1.

### D3 — Fully client-side, no backend

The plugin holds the user's API keys locally (see D5 for where) and calls every
external API — literature databases, LLM providers, TTS — directly from the
Zotero process.

**Why this is acceptable:** a Zotero plugin runs in a privileged Gecko context,
so it is not subject to web-page CORS restrictions, and there is no origin
whitelist problem. Installation is a single `.xpi` with nothing else to run.

**What it costs us**, and which must be documented honestly to users:

- API keys have to live somewhere on the user's machine. They must **not** go in
  Zotero prefs, which are plaintext `user_pref(...)` lines in the profile's
  `prefs.js`. The plugin instead uses `Zotero.OSKeyStore.encrypt()` +
  `Services.logins` — the same path Zotero uses for its own zotero.org API key,
  backed by Windows DPAPI / macOS Keychain / libsecret. This does not defend
  against other Zotero plugins, which share the same privileged context; that
  residual risk is stated in the UI. See
  [09](09-security-privacy-and-api-keys.md).
- Heavy work (PDF parsing, many concurrent HTTP calls) happens inside the Zotero
  process and must not block the UI. See the job-queue design in
  [07](07-architecture-and-data-model.md).
- There is no server-side place to hide a shared key, so **every user brings
  their own keys**. The plugin ships with no credentials.

### D4 — Documentation in English

All design docs and code comments are English. The *product UI* is localized to
English and Korean, and generated reports can be produced in either language.

### D5 — API keys go in the OS keystore, never in prefs

Tier 1 is `Zotero.OSKeyStore.encrypt()` → `Services.logins`, the same path Zotero
uses for its own zotero.org API key.

Where the OS keystore is unavailable — most realistically a Linux box without
libsecret — the plugin **degrades explicitly and visibly** down the ladder in
[09](09-security-privacy-and-api-keys.md) §1.7: tier 2 session-only memory (keys
re-entered each launch, so unattended background jobs stop working), then tier 3
a passphrase-encrypted file in the profile directory. **There is no tier 4.**
Plaintext storage is not implemented and must not be added — that is what makes
D5 a decision rather than a preference.

The prefs pane always shows which tier is in effect, and doc 09 §1.8 gives the
verbatim residual-risk text the UI must display: this protects keys from file
theft and other user accounts, but **not** from other Zotero plugins, which share
the same privileged context and can decrypt exactly as we do.

> **Open:** whether tier 2 or tier 3 is the right fallback on Linux without
> libsecret — see doc 09 §8 open question 1. Both are implemented; the question
> is which is offered first.

### D6 — Default LLM provider is OpenRouter

One key reaches every model, and OpenRouter's public model catalogue is the only
machine-readable price source among the four providers, which makes the pre-run
cost estimate real rather than hardcoded. Gemini has the only usable free tier
and is the easiest first run — but Google trains on free-tier traffic, including
generated report audio, so it is not what a user should get by *not* choosing.
Gemini remains required for audio reports (F5) and a first-class picker option.

The plugin must send `provider.data_collection: "deny"` on every OpenRouter
request; the API's own default is `"allow"`.

### D7 — Summaries use full text whenever it is available

`summary.fullTextMode` ships as `auto`, meaning: use the PDF or JATS full text
whenever it exists and materially exceeds the abstract, and fall back to the
abstract otherwise. Cost is controlled by a mandatory pre-run estimate with a
confirmation dialog above `summary.confirmAboveUSD` (default $2.00) — not by
silently preferring the cheap path.

**This decision has a cost.** Full-text runs cost roughly **8×** an abstract-only run for a
typical journal-article corpus, and up to **~32×** when papers are long enough to require
chunking — that upper bound is the number to budget against. It also puts the
IMRaD section detector on the critical path, where it was previously shielded. See [06](06-summarization-and-trend-report.md) §5.4 and
risks R-19 / R-19b in [11](11-implementation-roadmap.md).

### D8 — License: MIT

### D9 — Plugin ID

`research-helper@suppakoko.github.io` — confirmed 2026-09-08.

> This ID is **permanent once released**: it is the plugin's identity in the
> user's profile and the root of its preference branch. It appears in 15 places
> across these documents and must stay identical in `manifest.json`,
> `Zotero.PreferencePanes.register({ pluginID })`, `Zotero.MenuManager`
> registrations, and `update.json`.

### D10 — Contact identity for the literature APIs

Confirmed by the project owner on **2026-09-09**.

- **`User-Agent`, every request, every host:** the maintainer address
  `suppakoko@gmail.com`, fixed at build time and shipped in the XPI. This is what
  NCBI's registration requirement and arXiv's terms are asking for, and it is the
  only address that can receive an abuse report and act on it.
- **NCBI `tool` / `email` parameters:** the maintainer address, always. NBK25497
  states the address must be the developer's *"and not that of a third-party end
  user"*, so NCBI is an explicit exception to the per-user scheme below.
- **Crossref `mailto` parameter:** the user's address from
  `extensions.zotero.research-helper.contactEmail` when set, maintainer otherwise.
  A per-installation identity earns its own throttle bucket instead of pooling
  every user of the plugin behind one.

The user-facing pref is a **general contact address**, not an NCBI one — NCBI is
the single host that ignores it. See [02](02-literature-database-apis.md) §2.2 for
the per-host table.

> The maintainer address is published in every outbound request and inside the
> XPI. Changing it later means editing docs 01, 02, 05, 09 and 13.

---

## 4. End-to-end flows

### F1: Keyword → Library

```
User enters "gut microbiome and Parkinson disease"
        │
        ▼
[optional] LLM query expansion → per-database query strings (MeSH, Boolean)
        │
        ▼
Parallel fan-out, date filter = last 3 years, per-host rate limiters
  ├─ PubMed esearch → efetch (abstracts, MeSH)
  ├─ Europe PMC search (resultType=core)
  ├─ Crossref /works (filter=from-pub-date)
  ├─ Semantic Scholar /paper/search
  └─ arXiv / bioRxiv / medRxiv
        │
        ▼
Normalize to CanonicalWork  →  Deduplicate (DOI / PMID / fuzzy title+year)
        │
        ▼
[optional] LLM relevance screening (score 0–100, drop below threshold)
        │
        ▼
Review table in UI — user selects which to keep
        │
        ▼
Create Zotero items (journalArticle / preprint) → add to target collection
```

### F3: Collection → Trend report

```
Collection (N items)
        │
        ▼
Per paper: acquire text  (abstractNote → indexed PDF full text → EuropePMC XML)
        │
        ▼
Per paper: structured JSON summary
        │   cached by (itemKey, contentHash, model, promptVersion)
        ▼
Theme clustering  →  per-cluster reduction  →  final trend report (map-reduce)
        │
        ▼
Self-critique pass (flag unsupported claims)
        │
        ├─→ Zotero note / Markdown / DOCX export
        └─→ Audio script rewrite → Gemini TTS → WAV attachment
```

### F2 / F6: Discovery

```
F2  seed item ──► Semantic Scholar recommendations
                  + references / citations
                  + PubMed elink pmra "related articles"
                          │
F6  collection ──► collection profile (keywords, MeSH, venues, authors,
                   centroid embeddings (k, one per sub-topic), seed DOIs)
                          │
                          ▼
              candidate pool  →  score (similarity × recency × impact × novelty)
                          │
                          ▼
              filter out items already in the library  →  ranked list  →  import
```

---

## 5. Documentation map

| Doc | Contents |
|---|---|
| [00-overview.md](00-overview.md) | This document — scope, decisions, flows |
| [01-zotero-plugin-platform.md](01-zotero-plugin-platform.md) | Zotero 10 plugin model, lifecycle, `Zotero.*` APIs, packaging |
| [02-literature-database-apis.md](02-literature-database-apis.md) | Every literature API: endpoints, limits, schemas, normalization, dedup |
| [03-llm-provider-integration.md](03-llm-provider-integration.md) | OpenAI / Anthropic / Gemini / OpenRouter, unified adapter, costs |
| [04-audio-report-tts.md](04-audio-report-tts.md) | Gemini TTS, chunking, WAV assembly, Korean audio, fallbacks |
| [05-related-work-discovery.md](05-related-work-discovery.md) | Citation graphs, recommendation APIs, embeddings, ranking |
| [06-summarization-and-trend-report.md](06-summarization-and-trend-report.md) | Text acquisition, chunking, summary schema, map-reduce, report template |
| [07-architecture-and-data-model.md](07-architecture-and-data-model.md) | Modules, interfaces, canonical types, job queue, persistence, caching |
| [08-ui-ux-spec.md](08-ui-ux-spec.md) | Menus, dialogs, item pane, prefs pane, wireframes |
| [09-security-privacy-and-api-keys.md](09-security-privacy-and-api-keys.md) | Key storage, data egress, provider retention policies, API ToS |
| [10-requirements-and-user-stories.md](10-requirements-and-user-stories.md) | Personas, FR/NFR with acceptance criteria, out-of-scope, open questions |
| [11-implementation-roadmap.md](11-implementation-roadmap.md) | Phased plan, effort estimates, risk register |
| [12-prompt-library.md](12-prompt-library.md) | Every prompt, verbatim, with schemas and versioning |
| [13-testing-build-and-release.md](13-testing-build-and-release.md) | Toolchain, tests, CI YAML, `update.json`, distribution |

**Suggested reading order for an implementer:**
00 → 10 → 07 → 01 → 11, then the domain docs (02–06, 12) as each phase begins,
with 09 and 13 read before the first release.

---

## 6. Design principles

1. **Zotero is the database.** The plugin does not build a parallel library.
   Papers become real Zotero items; summaries and reports become real Zotero
   notes and attachments. If the plugin is uninstalled, the user keeps everything.
2. **The user brings their own keys, and owns their costs.** Every AI action
   shows an estimated token/dollar cost before it runs.
3. **Nothing is silently sent anywhere.** The user chooses per-feature what
   leaves the machine (abstract-only vs. full text), and the plugin says so.
4. **Grounded, not generative.** The trend report may only assert what appears in
   the per-paper summaries, and every claim carries a link back to a Zotero item.
5. **Degrade, don't fail.** No API key → search still works. No PDF → summarize
   the abstract. One source down → the others still return results.
6. **Cache aggressively.** Summaries are expensive; key them by content hash and
   prompt version so re-running a report is nearly free.
7. **Survive Zotero upgrades.** Isolate every `Zotero.*` call behind a thin
   adapter layer so a breaking release is a one-file fix, not a rewrite.

---

## 7. Out of scope for v1

- Paid databases (Scopus, Web of Science, Embase).
- Downloading paywalled PDFs, or any bypass of publisher access controls.
- Syncing plugin-generated state through Zotero's cloud sync.
- Collaboration / multi-user features.
- A hosted backend, shared API keys, or any telemetry.
- Systematic-review-grade PRISMA screening workflows (a possible v2).

The authoritative list, with rationale, is in
[10-requirements-and-user-stories.md](10-requirements-and-user-stories.md).

---

## Sources

- [Zotero Version History (changelog)](https://www.zotero.org/support/changelog)
- [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Frequent major-version changes and the current plugin compatibility model — Zotero Forums](https://forums.zotero.org/discussion/133127/frequent-major-version-changes-and-the-current-plugin-compatibility-model)
- [A faster release cycle for Zotero — Zotero Forums](https://forums.zotero.org/discussion/129153/a-faster-release-cycle-for-zotero)

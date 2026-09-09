# research_helper

A Zotero plugin that searches the literature, builds collections, summarizes what
it finds, and writes — and speaks — a research trends report.

> **Current status: design / research phase.** This repository contains
> specification and research documents only. No plugin code has been written yet.
> Start at [`docs/00-overview.md`](docs/00-overview.md).

---

## What it will do

| | Feature |
|---|---|
| **F1** | Search PubMed, Europe PMC, Crossref, Semantic Scholar, and arXiv/bioRxiv/medRxiv for a keyword, limited to the last 3 years, and build a Zotero collection from the deduplicated results — metadata and abstracts included. |
| **F2** | Take any paper in your library and pull in related work via citation graphs and semantic recommendation APIs. |
| **F3** | Summarize every paper in a collection and synthesize a structured "recent research trends" report. |
| **F4** | Run all of the above through your own API key for OpenRouter, OpenAI, Google Gemini, or Anthropic. |
| **F5** | Turn the report into a spoken audio briefing in English or Korean via Gemini TTS. |
| **F6** | Recommend new papers based on what a collection already contains, and fetch them. |

## Platform

- **Zotero 10.x**, bootstrapped plugin architecture (`manifest.json` + `bootstrap.js`)
- **Fully client-side** — no backend server, no telemetry, no shared keys; every request goes
  straight from Zotero to the service you configured. Your API keys never leave your machine.
  The *content* you ask the plugin to summarize does: paper metadata, abstracts and — by
  default — extracted PDF/JATS full text are sent to your chosen LLM provider, and the report
  script is sent to Gemini TTS. Every such job shows what will be sent, and to whom, before it
  runs. See [09 — Security, privacy & API keys](docs/09-security-privacy-and-api-keys.md).
- TypeScript, built with the `zotero-plugin-scaffold` / `zotero-plugin-toolkit` ecosystem
- UI localized in English and Korean

## Documentation

| Doc | What it covers |
|---|---|
| [00 — Overview](docs/00-overview.md) | Scope, confirmed decisions, end-to-end flows, design principles |
| [01 — Zotero plugin platform](docs/01-zotero-plugin-platform.md) | Plugin lifecycle, `Zotero.*` APIs, item creation, prefs, packaging |
| [02 — Literature database APIs](docs/02-literature-database-apis.md) | Endpoints, rate limits, schemas, normalization, deduplication |
| [03 — LLM provider integration](docs/03-llm-provider-integration.md) | OpenAI / Anthropic / Gemini / OpenRouter, unified adapter, cost model |
| [04 — Audio report & TTS](docs/04-audio-report-tts.md) | Gemini TTS, chunking, WAV assembly, Korean narration, fallbacks |
| [05 — Related-work discovery](docs/05-related-work-discovery.md) | Citation graphs, recommendation APIs, embeddings, ranking |
| [06 — Summarization & trend report](docs/06-summarization-and-trend-report.md) | Text acquisition, summary schema, map-reduce synthesis, report template |
| [07 — Architecture & data model](docs/07-architecture-and-data-model.md) | Modules, interfaces, canonical types, job queue, persistence, caching |
| [08 — UI/UX spec](docs/08-ui-ux-spec.md) | Menus, dialogs, item pane, preferences pane, wireframes |
| [09 — Security, privacy & API keys](docs/09-security-privacy-and-api-keys.md) | Key storage, data egress, provider retention, API terms compliance |
| [10 — Requirements & user stories](docs/10-requirements-and-user-stories.md) | Personas, FR/NFR with acceptance criteria, out-of-scope, open questions |
| [11 — Implementation roadmap](docs/11-implementation-roadmap.md) | Phased plan, effort estimates, risk register |
| [12 — Prompt library](docs/12-prompt-library.md) | Every prompt, verbatim, with output schemas and versioning |
| [13 — Testing, build & release](docs/13-testing-build-and-release.md) | Toolchain, test strategy, CI workflows, `update.json`, distribution |

**New here?** Read 00 → 10 → 07 → 01 → 11 in that order.

## The plan

[`plan/`](plan/) is the executable layer under the roadmap: **100 task cards**
covering Phases 0–3, each naming the files to touch, the design sections to read
first, the traps to avoid, and the command that proves it done. Phases 4–7 are
outlined rather than decomposed, because nineteen unvalidated spikes in Phase 0
would rewrite them.

| Doc | Contents |
|---|---|
| [plan/README.md](plan/README.md) | Task-card schema, execution protocol, conventions |
| [plan/00-task-index.md](plan/00-task-index.md) | All 100 tasks, dependencies, estimates, where to start |
| [plan/01](plan/01-phase-0-toolchain-spike.md)–[04](plan/04-phase-3-llm-summaries.md) | Phase 0–3 task cards |
| [plan/05](plan/05-phases-4-7-outline.md) | Phases 4–7 outline and entry conditions |
| [plan/06](plan/06-human-gates.md) | The 40 points where a human must act |

**Start with `P0-T01`, and apply for a Semantic Scholar API key the same day**
(`P0-T22`) — the approval queue, not the code, is what gates Phase 5.

## Bring your own keys

The plugin ships with no credentials. You will need, at minimum, one LLM
provider key. Optional but recommended:

| Key | Why | Cost |
|---|---|---|
| **OpenRouter** (default) | All AI features, through one key for every model | Pay-as-you-go; a few free models exist but there is no usable free tier |
| — or OpenAI / Gemini / Anthropic directly | Same features, native APIs | Pay-as-you-go |
| Google Gemini | **Required** for audio reports (F5) | Pay-as-you-go, or a genuinely usable free tier — but Google trains on free-tier traffic, including your report audio, and the plugin warns about it every session it cannot rule the free tier out ([09 §3.4](docs/09-security-privacy-and-api-keys.md)) |
| Semantic Scholar API key | Related papers and recommendations (F2, F6) are impractical without one | Free, but **apply early** — approval takes time |
| NCBI API key | Raises the PubMed rate limit from 3/s to 10/s | Free |
| Your contact email for Crossref | The "polite pool": 3 req/s instead of 1 | Free |

Keys are encrypted with your operating system's keystore (Windows DPAPI, macOS
Keychain, or libsecret on Linux) via `Zotero.OSKeyStore` and held in the login
manager — the same mechanism Zotero uses for its own API key. They are never
written to Zotero preferences, which are plaintext. Read
[09 — Security, privacy & API keys](docs/09-security-privacy-and-api-keys.md)
before entering any key; it explains the threat model, including the one thing
this does *not* protect against (other Zotero plugins share the same privileged
context and can decrypt what we can).

## License

MIT.

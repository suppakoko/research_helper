# Research Helper for Zotero

Korean: [`README.ko.md`](README.ko.md).

A Zotero plugin that searches the literature, builds collections, summarizes what it finds, and
writes — and speaks — a research trends report. It runs entirely inside Zotero, with your own API
keys; there is no Research Helper server.

> **Status: not released yet.** Version 1.0 is in its release phase. Until the first release is
> published under [Releases](https://github.com/suppakoko/research_helper/releases), there is
> nothing to install. In the current development build, **Find Related Papers**, **Recommend New
> Papers** and the **audio report** are switched off until their release checks pass; the other
> features are on.

## What it does

<!-- screenshot: docs/images/search-import.png (P7-T27) -->

| | Feature | Where you start it |
|---|---|---|
| **Search & import** | Search PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv and medRxiv for a topic (the last 3 years by default), remove duplicates, and import the results into a Zotero collection with their metadata and abstracts. | **Tools → Research Helper → Search & Import…**, or a collection's context menu |
| **Related papers** | Take one paper in your library and find related work through citations, references and recommendation services. | An item's context menu: **Find Related Papers…** |
| **Summaries and a trends report** | Summarize every paper in a collection, then write a structured "recent research trends" report from those summaries, saved as a Zotero note. | A collection's context menu: **Summarize All Papers in Collection**, **Generate Research Trends Report…** |
| **Your choice of AI provider** | Every AI step runs through your own key for OpenRouter, OpenAI, Google Gemini or Anthropic, with the model you choose. | **Settings → Research Helper** |
| **Audio report** | Turn the report into a spoken briefing in English or Korean with Gemini text-to-speech, saved in the collection as an audio attachment. | A collection's context menu: **Generate Audio Report…** |
| **Recommendations** | Profile a collection and suggest new papers it does not have yet. | A collection's context menu: **Recommend New Papers from This Collection…** |

<!-- screenshot: docs/images/report-window.png (P7-T27) -->

Before anything is sent to an AI provider, a confirmation shows where it goes, which model, how
many papers, what part of each paper, the privacy mode, and the estimated cost.

<!-- screenshot: docs/images/cost-confirmation.png (P7-T27) -->

## Compatibility

| Research Helper | Zotero | Windows | macOS | Linux |
|---|---|---|---|---|
| 1.0 (not yet released) | 10.0.x only | Tested | **Untested** | **Untested** |

<!-- Baseline moved 2026-11-18 from Zotero 10.0.3 to 10.0.8 (owner, plan/00 §6 item 405(d)). -->
"Tested" means the automated integration suite runs in Zotero 10.0.8 on Windows 11, and the
release's manual check is recorded in the release checklist
([`docs/release/v1.0-checklist.md`](docs/release/v1.0-checklist.md)). macOS and Linux have not been
checked, because no machine was available; they are expected to work but nobody has confirmed it.
Reports from either are welcome. The interface is in English and Korean.

## Install

1. Download `research-helper.xpi` from the release you want on the
   [Releases](https://github.com/suppakoko/research_helper/releases) page. Each release also
   carries `SHA256SUMS.txt`, so you can check the file.
2. In Zotero, open **Tools → Plugins** and drag the `.xpi` file onto that window (or use the gear
   menu's **Install Plugin From File…**).
3. Restart Zotero if it asks you to.

**Updates** come through Zotero's own plugin updates: Zotero reads the plugin's `update.json`
from this repository's `release` branch and offers a newer version when there is one. You can
also check by hand under **Tools → Plugins**.

## Setup

Open **Settings → Research Helper** (on macOS, **Zotero → Settings**). You need at least one AI
provider key. Everything else is optional.

| Key | What it is for | Where to get it |
|---|---|---|
| **OpenRouter** (the default provider) | Summaries, reports and recommendations, with one key for many models | [openrouter.ai](https://openrouter.ai/) → your account → Keys |
| **or OpenAI** | The same features, on OpenAI's own API | [platform.openai.com](https://platform.openai.com/) → API keys |
| **or Google Gemini** | The same features on Gemini; **required for the audio report** | [aistudio.google.com](https://aistudio.google.com/) → Get API key |
| **or Anthropic** | The same features, on Claude models | [console.anthropic.com](https://console.anthropic.com/) → API keys |
| **NCBI** (optional) | A higher PubMed rate limit | [NCBI account settings](https://www.ncbi.nlm.nih.gov/account/) → API key management |
| **Semantic Scholar** (optional) | Related papers and recommendations work much better with one; apply early, because approval takes time | [Semantic Scholar API](https://www.semanticscholar.org/product/api#api-key-form) |
| **Your email for Crossref** (optional) | Puts your Crossref requests in its "polite pool" | Type it in the Search section |

Each key field has a **Test** button, which checks the key with a request that sends none of your
content. Use a key made only for this plugin, with a spending limit set at the provider.

<!-- screenshot: docs/images/preferences-keys.png (P7-T27) -->

## Your data and privacy

**There is no Research Helper server.** Every request goes straight from your Zotero to the
service named below, and the plugin sends no telemetry, analytics or crash reports to anyone.

**Your API keys** are encrypted with Zotero's `OSKeyStore` and kept in Zotero's login manager,
never in Zotero preferences. The settings pane names the store in use (for example Windows
Credential Manager). If your computer has no working credential store — this can happen on Linux
without a system keyring — the plugin does not fall back to saving keys unencrypted: it offers to
keep them **for this Zotero session only**, and you enter them again after a restart. A stored key
is never shown again; the pane shows its first three and last four characters.

**What this does not protect against.** Any program running under your own user account —
including any other Zotero plugin — can decrypt the stored keys, because your operating system
decrypts them for anything running as you, and Zotero does not isolate plugins from each other.
The settings pane shows this warning in full. Treat the keys like passwords saved in your browser,
set spending limits, and rotate a key you think may have been exposed.

**What is sent where.** Content leaves your computer only when you start an action, and an AI
action shows its destination first.

| When you… | It goes to | What is sent |
|---|---|---|
| Search & import | The databases you tick: `eutils.ncbi.nlm.nih.gov` (PubMed), `www.ebi.ac.uk` (Europe PMC), `api.crossref.org`, `api.semanticscholar.org`, `export.arxiv.org`, `api.biorxiv.org` (bioRxiv and medRxiv), and `pmc.ncbi.nlm.nih.gov` to convert PubMed identifiers | Your search words, the date range and the result limit. Your NCBI or Semantic Scholar key, if set, goes to its own service only. |
| Find related papers, recommend | The same databases, and `pmc.ncbi.nlm.nih.gov` to convert identifiers | The paper's public identifiers (DOI, PubMed or arXiv ID), or its title when it has none; for recommendations, search words made from the collection and some of its papers' identifiers and author names |
| Summarize | Your AI provider: `openrouter.ai`, `api.openai.com`, `generativelanguage.googleapis.com` (Gemini) or `api.anthropic.com` | Per paper: its title, authors, year, venue, item type, DOI, Zotero item key, the abstract and, by default, the full text extracted from its PDF or from Europe PMC's open-access text |
| Generate a trends report | Your AI provider | The summaries already made, the papers' titles, years and venues, and **the collection's name** |
| Recommend new papers | Your AI provider | One line per paper in the collection (item key, title, year, venue, subject terms) and counts; not abstracts and not the collection's name |
| Generate an audio report | Your AI provider, then Google's `generativelanguage.googleapis.com` | The report's text to write a spoken script, then the script to Google's text-to-speech, which can say the collection's name and cited authors aloud |
| Use the plugin at all | Zotero contacts `raw.githubusercontent.com` and `github.com` | Zotero's own update check and download for the plugin |

Every literature-database request carries a `User-Agent` naming the plugin and its maintainer's
contact address, as those services ask; Crossref also gets your email if you typed one. Notes, your
tags, PDF annotations and other papers' content are never sent. If you set a custom base URL for a
provider in the settings, requests for that provider go to that address instead.

**Privacy modes.** The **Privacy** section's mode (Balanced by default) decides what may be sent
and to which models: **Strict** sends abstracts only and refuses models whose provider may train
on your input, **Full** allows the most. On OpenRouter every request asks to be routed only to providers that do
not collect your data (`data_collection: deny`). Google's **free** Gemini tier may use what you send to improve its
products; the plugin warns you about this whenever it cannot tell that your key is a paid one.

**Removing what the plugin made.** **Settings → Research Helper → Advanced → Remove all Research
Helper content…** shows how many generated notes, provenance notes and audio attachments it found,
in which libraries, and on confirmation moves them to the Zotero trash, where you can restore
them, and deletes the plugin's stored data. Imported items, their tags and your own notes stay.
A linked audio file stays on disk, and the confirmation names its folder. Removing the plugin itself
leaves these notes and attachments in your library, so run this command first if you want them gone. For one collection, its
context menu has **Remove Generated Notes from Collection…**. The same Advanced section can clear
cached responses, stored summaries, job history or embeddings separately, or reset the settings.

The full account, with the providers' retention terms and the dates they were checked, is in
[`docs/09-security-privacy-and-api-keys.md`](docs/09-security-privacy-and-api-keys.md). Security
problems: see [`SECURITY.md`](SECURITY.md).

## Cost

All AI and text-to-speech use is billed by the provider to **your own key**. The plugin itself
is free.

- **Measured cost:** the cost of the reference workload (100 abstracts summarized, then one trends
  report over them, on a provider's small and cheap tier; the target is at most US $1.00) is
  measured in the release checklist,
  [`docs/release/v1.0-checklist.md`](docs/release/v1.0-checklist.md).
- **Full text is the default.** Summaries use a paper's full text whenever it is available and
  much longer than the abstract, which sends far more text than an abstract-only run. The design
  estimate is roughly 8 times the input of an abstract-only run for a typical journal-article
  collection and up to about 32 times for very long papers; this is an estimate, not a
  measurement. You can choose abstracts only in the settings.
- **Before each run** the confirmation shows the estimated cost.
- **Spending limits as shipped:** a per-session limit of **US $5.00** (it resets when Zotero
  restarts) and no per-run limit. Both can be changed in the settings; 0 turns a limit off.
- Provider prices change, so an estimate is only as current as the price it was made with.

## Known limitations

- **No paywalled PDFs.** The plugin uses PDFs already in your library and open-access full text;
  it never downloads from publisher websites.
- **English and Korean only**, for both the interface and the generated reports.
- **No scheduled or background jobs.** Everything runs when you start it.
- **PDF text extraction is best-effort.** When no usable full text can be extracted, the summary
  uses the abstract. The section detector that labels Introduction, Methods, Results and
  Discussion was measured once on a held-out set of 19 papers at **92.94 %** of characters in the
  right section, over the 15 papers that have that structure (see
  [`docs/06-summarization-and-trend-report.md`](docs/06-summarization-and-trend-report.md) §4.3).
  There has been no larger validation of PDF extraction quality.
- **macOS and Linux are untested** (see Compatibility).

## Troubleshooting

- **Diagnostics.** **Settings → Research Helper → Advanced** has **Show diagnostics**, which shows
  a text with the plugin and Zotero versions, your settings, recent jobs, the last log lines and
  recent errors, without any API key or paper content. Read it, then use **Copy diagnostics** or
  **Save diagnostics…** to attach it to a report.
- **More detail.** Tick **Verbose debug logging** in the same section, repeat what went wrong, then
  show the diagnostics again. Zotero's own **Help → Debug Output Logging** also captures the
  plugin's lines.
- **Report a problem** on [GitHub Issues](https://github.com/suppakoko/research_helper/issues).
  For a security problem, follow [`SECURITY.md`](SECURITY.md) instead.

## Data sources and attribution

Search results come from PubMed (NCBI), Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv and
medRxiv. Data from Semantic Scholar is provided by the Allen Institute for AI under the
[Semantic Scholar API License Agreement](https://www.semanticscholar.org/product/api/license).
Each service's terms of use apply to what it returns.

## Contributing

Issues and pull requests are welcome. The plugin is TypeScript, built with
`zotero-plugin-scaffold` and `zotero-plugin-toolkit`:

```bash
npm ci
npm run typecheck && npm run lint:check && npm run test   # no network, no keys needed
npm run build                                             # writes .scaffold/build/research-helper.xpi
```

The design documents are in [`docs/`](docs/) (start with
[`docs/00-overview.md`](docs/00-overview.md)), and the work plan is in [`plan/`](plan/). Changes are
recorded in [`CHANGELOG.md`](CHANGELOG.md).

## License

[MIT](LICENSE).

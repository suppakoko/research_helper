# v1.0 announcement and community-list entries (drafts)

> **Draft (coordinator, 2026-11-18, not adopted; `G-36`, `plan/10` `P7-T23`).** Nothing here has been
> posted, submitted or opened as a pull request. No account was created. The owner does all of that
> under `G-36`, after `P7-T31` step 1 has re-checked each list's live process on the day.
>
> **Placeholders.** Text in `{BRACES}` is for the owner to fill in on the day. The owner's name,
> forum account and contact details are deliberately absent. The plugin's contact address is
> `MAINTAINER_EMAIL` in `src/core/http/userAgent.ts` and is not repeated here.
>
> **Sources.** Every statement below is taken from `README.md` as of 2026-11-18. The post adds
> nothing that the README does not say. If the README changes before the post goes up, the post
> follows the README.

## 1. Zotero Forums post

**Where:** the [Zotero Forums](https://forums.zotero.org/), in the category the owner chooses on the
day. The forum's categories were not checked in this batch because it had no network access.

**Title:** Research Helper 1.0: search, import, summarize and write a trends report, inside Zotero
with your own API keys

---

Hello all,

I have released **Research Helper {VERSION}**, a free, open-source (MIT) plugin for **Zotero 10**:
{RELEASE_URL}

**What it does**

- **Search & import:** search PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv and
  medRxiv for a topic (the last 3 years by default). It removes duplicates and imports the results,
  with their metadata and abstracts, into a Zotero collection.
- **Related papers:** start from one paper in your library and find related work through
  citations, references and recommendation services.
- **Summaries and a trends report:** summarize every paper in a collection, then write a
  structured "recent research trends" report from those summaries, saved as a Zotero note.
- **Audio report:** turn the report into a spoken briefing in English or Korean with Gemini
  text-to-speech, saved in the collection as an audio attachment.
- **Recommendations:** profile a collection and suggest new papers it does not have yet.
- **Your choice of AI provider:** OpenRouter, OpenAI, Google Gemini or Anthropic, with your own key
  and the model you choose.

The interface is in English and Korean.

**Compatibility**

Zotero 10.0.x only. Tested on Windows 11 with Zotero 10.0.3. **macOS and Linux are untested**,
because no machine was available. They are expected to work but nobody has confirmed it, and
reports from either are very welcome.

**It runs entirely inside Zotero: there is no Research Helper server**

Every request goes straight from your Zotero to the service doing the work. The plugin sends no
telemetry, analytics or crash reports to anyone.

**You supply the API keys: where they are kept**

You need at least one AI provider key. NCBI and Semantic Scholar keys are optional. Keys are
encrypted with Zotero's `OSKeyStore` and kept in Zotero's login manager, never in Zotero
preferences. If your computer has no working credential store, the plugin does not save keys
unencrypted: it offers to keep them for the current Zotero session only.

What this does **not** protect against: any program running under your user account, including
any other Zotero plugin, can decrypt the stored keys. Zotero does not isolate plugins from each
other. So please use a key made only for this plugin, with a spending limit set at the provider.

**What data goes where**

Content leaves your computer only when you start an action, and every AI action shows its
destination, model, paper count, what part of each paper is sent, the privacy mode and the
estimated cost before anything is sent.

- *Search & import:* your search words, date range and result limit, to the literature
  databases you tick.
- *Related papers and recommendations:* the paper's public identifiers (or its title when it has
  none), and for recommendations some search words, identifiers and author names from the
  collection, to the same databases.
- *Summaries:* per paper, the title, authors, year, venue, item type, DOI, Zotero item key and
  abstract, and by default the full text extracted from its PDF or from Europe PMC's open-access
  text, to your AI provider.
- *Trends report:* the summaries, the papers' titles, years and venues, and the collection's
  name, to your AI provider.
- *Recommendations:* one line per paper (item key, title, year, venue, subject terms) and counts,
  to your AI provider. No abstracts are sent, and not the collection's name.
- *Audio report:* the report's text to your AI provider to write a script, then the script to
  Google's text-to-speech.

Your notes, tags, PDF annotations and other papers' content are never sent. A privacy mode
(Strict, Balanced or Full) controls what may be sent and to which models. The full table, with
every host name, is in the README's "Your data and privacy" section:
https://github.com/suppakoko/research_helper#your-data-and-privacy

**Cost**

AI and text-to-speech use is billed by the provider to your own key. Summaries use full text by
default, which sends far more text than abstracts only. You can switch to abstracts only in the
settings. {REFERENCE_COST_SENTENCE: one sentence with the measured reference-workload cost from
`docs/release/v1.0-checklist.md`, row NFR-5, with its date. Leave this out if that row has no
measured figure.}

**Known limitations**

No paywalled PDFs: it uses PDFs already in your library and open-access full text. English and
Korean only. No scheduled or background jobs. PDF text extraction is best-effort and falls back to
the abstract.

**Install, source and licence**

- Download `research-helper.xpi` from {RELEASE_URL} and drag it onto **Tools → Plugins**. Each
  release carries `SHA256SUMS.txt`.
- Source, README and issue tracker: https://github.com/suppakoko/research_helper
- Licence: MIT.

As the [Plugins for Zotero](https://www.zotero.org/support/plugins) page says, a plugin has full
access to Zotero and your computer. Please only install plugins whose code and data handling you
are comfortable with. That is why everything above is spelled out.

Bug reports and questions are welcome here or on GitHub Issues.

{OWNER_SIGNATURE}

---

### `docs/13` §7.2 item 2: each point the post must cover

- [x] What it does: "What it does".
- [x] Zotero compatibility: "Compatibility" (Windows tested, macOS and Linux untested; Zotero
  10.0.x only).
- [x] Fully client-side: "It runs entirely inside Zotero".
- [x] Requires user-supplied API keys: "You supply the API keys".
- [x] Where keys are stored: `OSKeyStore` and the login manager, never preferences, and the
  remaining risk.
- [x] What data is sent where: "What data goes where", with a link to the README's full table.
- [x] The licence: MIT, in "Install, source and licence".
- [x] The repository link: in "Install, source and licence".

## 2. Community plugin lists

`docs/13` §7.2 item 3 names two lists.

**Not checked in this batch.** This batch had no network access, so neither list's current
submission instructions or maintenance status was read. This is DECIDED 2026-11-18 (coordinator,
under `plan/00` §6 item 313).

- `docs/13` §7.2's `Unverified` note already says to confirm the live process "immediately before
  submitting", and `P7-T31` step 1 does that on the day.
- Each entry below therefore gives the **facts** a submission needs, not a file in a format that
  nobody has checked.

| List | Process checked | Status recorded in `docs/13` §7.2 |
|---|---|---|
| zotero-chinese plugin list (`zotero-chinese/zotero-plugins`, shown at zotero-chinese.com/plugins) | **not checked**; `P7-T31` step 1 checks it on the day | its README "carried a 'maintenance suspended' note at the time of writing" (September 2026) |
| The community scraper repository that feeds the in-Zotero plugin-browser plugins | **not checked**; `P7-T31` step 1 checks it on the day | `docs/13` does not record its name or address. `P7-T31` step 1 identifies it first. |

### 2.1 The facts each entry needs

Each fact is from `README.md`, `addon/manifest.json` or `package.json`.

| Field | Value |
|---|---|
| Repository | `suppakoko/research_helper` (https://github.com/suppakoko/research_helper) |
| Name | Research Helper |
| One-line description | Search and import literature, summarize a collection and write a research trends report inside Zotero, with your own AI provider keys; no server. |
| Zotero version | 10.0.x only (`strict_min_version` "10.0", `strict_max_version` "10.0.*") |
| Release tag | `{RELEASE_TAG}`, the tag of the published v1.0 GitHub Release |
| Download | the release's `research-helper.xpi` asset |
| Licence | MIT |
| Interface languages | English, Korean |
| Tested platforms | Windows; macOS and Linux untested |

### 2.2 zotero-chinese plugin list: entry draft

{ENTRY_IN_THE_LIST'S_CURRENT_FORMAT: on the day, read the list's README and contribution guide,
and write the entry from §2.1 in exactly the format they show. If the list is still marked as
unmaintained, do not submit. Record that here with the date, and tell the owner.}

### 2.3 Community scraper repository: entry draft

{ENTRY_IN_THE_REPOSITORY'S_CURRENT_FORMAT: on the day, identify the repository, read how it
collects plugins (some read a list file, some search GitHub themselves), and write what it needs
from §2.1. Record its name, address and the date checked here.}

## 3. When each list's process was checked

| List | Checked on | By | Result |
|---|---|---|---|
| zotero-chinese plugin list | {DATE} | {WHO} | {PROCESS, OR "unmaintained"} |
| Community scraper repository | {DATE} | {WHO} | {NAME, ADDRESS, PROCESS} |
| Zotero Forums category | {DATE} | {WHO} | {CATEGORY} |

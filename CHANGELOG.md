# Changelog

All notable changes to Research Helper are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release states the Zotero series
and the operating systems it was checked on.

## [Unreleased]

The first release, planned as 1.0.0, with a 0.9.0 release candidate before it.

**Compatibility:** Zotero 10.0.x only. Windows tested; macOS and Linux untested.

### Added

- **Search & Import.** Search PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv and
  medRxiv for a topic, remove duplicates across them, and import the results into a Zotero
  collection with metadata and abstracts. A collection remembers its search, so it can be run
  again.
- **Find Related Papers** for one item, through references, citations and recommendation
  services.
- **Summaries** of every paper in a collection, from the full text by default and from the
  abstract otherwise, saved as Zotero notes, with a cost confirmation before each run.
- **Research trends report** for a collection, written from its summaries, saved as a Zotero note
  and exportable as Markdown.
- **Audio report:** the trends report as a spoken briefing in English or Korean, through Gemini
  text-to-speech.
- **Recommend New Papers** from a collection's profile.
- **Your own AI provider:** OpenRouter, OpenAI, Google Gemini or Anthropic, with the model you
  choose; per-session and per-run spending limits; privacy modes (Strict, Balanced, Full).
- **Keys in the operating system's credential store**, through Zotero's `OSKeyStore`, never in
  Zotero preferences; a session-only mode where no credential store works.
- **Settings pane** with search, report and audio, privacy and advanced sections: cache usage,
  verbose logging, diagnostics to show, save or copy, clearing each kind of stored data, deleting
  all plugin data, resetting the settings, and removing all Research Helper content to the Zotero
  trash.
- **Offline:** with Zotero offline, the plugin starts, its windows open, stored summaries,
  reports, notes and audio stay usable, and network actions end with the message that Zotero is
  offline.
- **English and Korean** interface.

[Unreleased]: https://github.com/suppakoko/research_helper/commits/main

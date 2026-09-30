# research_helper — Korean strings for the Search & Import window.
#
# Same file name, same surface and the same identifiers as
# `locale/en-US/research-helper-searchDialog.ftl`; read that file's header for
# the placement rule, the attribute each entry sets, and the prefix rules
# (`docs/01` §9.1, §9.3, `docs/08` §10.1).
#
# ## This bundle carries exactly ONE message, and that is the human gate
#
# `P1-T18` carries a **human gate**: a native Korean speaker must review the
# `ko-KR` bundles, and an agent may draft them but must not sign them off.
# Nothing here was machine-translated. `docs/08` §10.2 ships owner-written
# Korean for the main-window menus only — it supplies **no Korean at all for
# this surface** — so the only entry below is the one `docs/08` §10.3 forbids
# translating:
#
# * `research-helper-search-col-doi` — "DOI" is not translated.
#
# Every other identifier in the en-US bundle is listed below as a comment with
# its English source. Until a native speaker fills them in, a Korean UI shows
# this entire window in English, resolved from `en-US` through the per-message
# fallback Gecko's `Localization` walks along the app-locale chain — measured
# on Zotero 10.0.1, not assumed (`docs/01` §9.1, `P0-T24`).
#
# **This is the single largest item the gate has to clear**, and it is reported
# as such: 58 strings, listed here in the order a reviewer will meet them in
# the window. `src/i18n/keys.ts` exports the same list as `KO_PENDING_REVIEW`
# and `test/integration/l10n.spec.ts` asserts that the messages actually
# missing from this file are exactly that list, so a new en-US string cannot be
# added without either a Korean entry or an explicit entry on the review list.
#
# ## Notes for the reviewer
#
# * **Never concatenate.** Every counted string is one message with a
#   `{ $count }` selector. Korean has a single plural category, so keep the
#   selector with only `*[other]` rather than flattening it — that keeps the
#   English source and the Korean translation structurally parallel
#   (`docs/08` §10.2's note, §10.3).
# * **Do not translate** "PubMed", "Zotero", "DOI", "PMID", a provider name or
#   a model ID (`docs/08` §10.3).
# * **Do not set a font family** anywhere for Korean: glyph coverage is the
#   OS's job (`docs/08` §10.3).
# * Labels must not be given fixed widths — Korean menu labels can be longer
#   than English (`docs/08` §10.3). That is `P1-T20`'s markup, not this file's,
#   but it is what makes a longer Korean string safe to write.
# * A placeable may need to move: `{ $from }–{ $to }` and `{ $count }` can sit
#   anywhere in the Korean sentence. That freedom is the reason these are
#   single messages rather than assembled fragments.


## Window
##
# NEEDS REVIEW. en-US: "Research Helper — Search & Import"
# research-helper-search-window-title =


## Query row (docs/08 §4.2, §4.5)
##
# NEEDS REVIEW. en-US `.value`: "Keyword"
# research-helper-search-keyword-label =
#
# NEEDS REVIEW. en-US `.aria-label`: "Search keyword"
# research-helper-search-keyword-input =
#
# NEEDS REVIEW. en-US `.label`: "Search"; `.tooltiptext`: "Run the search
# across selected databases"
# research-helper-search-run =
#
# NEEDS REVIEW. en-US `.value`: "Keyword"  (the read-only mode chip)
# research-helper-search-mode-keyword =


## Date range (docs/08 §4.2, FR-3)
##
# NEEDS REVIEW. en-US `.value`: "Years"
# research-helper-search-years-label =
#
# NEEDS REVIEW. en-US, a `{ $years }` selector: "{ $from } – { $to } (last
# calendar year)" / "{ $from } – { $to } (last { $years } calendar years)".
# Keep the selector with only `*[other]`.
# research-helper-search-years-span =
#
# NEEDS REVIEW. en-US `.aria-label`: "Earliest publication year"
# research-helper-search-years-from =
#
# NEEDS REVIEW. en-US `.aria-label`: "Latest publication year"
# research-helper-search-years-to =
#
# NEEDS REVIEW. en-US `.label`: "Custom…"
# research-helper-search-years-custom =


## Per-database result limit (docs/08 §4.2)
##
# NEEDS REVIEW. en-US `.value`: "Max per database"
# research-helper-search-max-results-label =
#
# NEEDS REVIEW. en-US `.aria-label`: "Maximum results per database"
# research-helper-search-max-results-input =


## Database selection (docs/08 §4.2, FR-2)
##
# NEEDS REVIEW. en-US `.value`: "Databases"
# research-helper-search-databases-label =
#
# NEEDS REVIEW. en-US: "Select at least one database to search."
# research-helper-search-databases-none =


## Client-side filtering (docs/08 §4.2, §4.5)
##
# NEEDS REVIEW. en-US `.value`: "Filter"
# research-helper-search-filter-label =
#
# NEEDS REVIEW. en-US `.aria-label`: "Filter the results already fetched"
# research-helper-search-filter-input =
#
# NEEDS REVIEW. en-US `.label`: "Hide items already in my library"
# research-helper-search-hide-existing =
#
# NEEDS REVIEW. en-US: "{ $total } results · { $new } new"
# research-helper-search-result-count =


## Result table (docs/08 §4.2, §4.3, §9)
##
# NEEDS REVIEW. en-US `.aria-label`: "Search results"
# research-helper-search-table =
#
# NEEDS REVIEW. en-US `.aria-label`: "Select"
# research-helper-search-col-select =
#
# NEEDS REVIEW. en-US `.label`: "Title"
# research-helper-search-col-title =
#
# NEEDS REVIEW. en-US `.label`: "Authors"
# research-helper-search-col-authors =
#
# NEEDS REVIEW. en-US `.label`: "Year"
# research-helper-search-col-year =
#
# NEEDS REVIEW. en-US `.label`: "Source"
# research-helper-search-col-source =
#
# NEEDS REVIEW. en-US `.label`: "Type"
# research-helper-search-col-type =

# Not translated (docs/08 §10.3). The one message this bundle ships.
research-helper-search-col-doi =
    .label = DOI

# NEEDS REVIEW. en-US: "{ $names } +{ $count }"
# research-helper-search-authors-overflow =
#
# NEEDS REVIEW. en-US: "Already in library: { $title }"
# research-helper-search-row-existing =
#
# NEEDS REVIEW. en-US `.aria-label`: "Already in my library"
# research-helper-search-row-existing-badge =


## Selection controls (docs/08 §4.5, FR-5)
##
# NEEDS REVIEW. en-US `.label`: "Select all"
# research-helper-search-select-all =
#
# NEEDS REVIEW. en-US `.label`: "Select none"
# research-helper-search-select-none =
#
# NEEDS REVIEW. en-US `.label`: "Invert"
# research-helper-search-select-invert =
#
# NEEDS REVIEW. en-US, a `{ $count }` selector: "1 selected" /
# "{ $count } selected". Keep the selector with only `*[other]`.
# research-helper-search-selected-count =


## Import target and duplicate policy (docs/08 §4.2, §4.4, §4.5, FR-51)
##
# NEEDS REVIEW. en-US `.value`: "Import into"
# research-helper-search-target-label =
#
# NEEDS REVIEW. en-US `.aria-label`: "Target collection"
# research-helper-search-target-picker =
#
# NEEDS REVIEW. en-US `.label`: "New collection…"
# research-helper-search-target-new =
#
# NEEDS REVIEW. en-US `.value`: "Duplicates"
# research-helper-search-duplicates-label =
#
# NEEDS REVIEW. en-US `.label`: "Skip"
# research-helper-search-duplicates-skip =
#
# NEEDS REVIEW. en-US `.label`: "Add existing item to collection"
# research-helper-search-duplicates-link =
#
# NEEDS REVIEW. en-US `.label`: "Import anyway"
# research-helper-search-duplicates-import =


## Window buttons (docs/08 §4.5, FR-1, NFR-13)
##
# NEEDS REVIEW. en-US `.label`: "Close"
# research-helper-search-close =
#
# NEEDS REVIEW. en-US `.label`: "Cancel"
# research-helper-search-cancel =
#
# NEEDS REVIEW. en-US `.label`, a `{ $count }` selector: "Import 1 item" /
# "Import { $count } items". Keep the selector with only `*[other]`.
# research-helper-search-import =


## 1. INITIAL (docs/08 §8.4)
##
# NEEDS REVIEW. en-US: "Enter a keyword and press Search to query the selected
# databases for papers from the last { $years } calendar years."
# research-helper-search-state-initial =


## 2. LOADING (docs/08 §4.6, §8.4)
##
# NEEDS REVIEW. en-US: "Searching…"
# research-helper-search-source-searching =
#
# NEEDS REVIEW. en-US, a `{ $count }` selector: "1 result" /
# "{ $count } results". Keep the selector with only `*[other]`.
# research-helper-search-source-results =
#
# NEEDS REVIEW. en-US: "Failed — { $reason }". `{ $reason }` arrives already
# localized from `research-helper-mainWindow.ftl`'s `rh-error-*` block.
# research-helper-search-source-failed =
#
# NEEDS REVIEW. en-US: "{ $done } of { $total } databases"
# research-helper-search-progress-databases =
#
# NEEDS REVIEW. en-US: "Searching { $database }…". `{ $database }` is a source
# display name and is not translated.
# research-helper-search-status-searching =
#
# NEEDS REVIEW. en-US: "Importing { $done } of { $total }…"
# research-helper-search-status-importing =


## 3. EMPTY (docs/08 §4.6, §8.4)
##
# NEEDS REVIEW. en-US: "No papers found for “{ $query }” in { $from }–{ $to }."
# research-helper-search-state-empty =
#
# NEEDS REVIEW. en-US: "Try broadening the year range, removing quotation
# marks, or enabling more databases."
# research-helper-search-state-empty-suggestions =
#
# NEEDS REVIEW. en-US: "No abstract or indexed full text — skipped."
# research-helper-search-row-no-content =


## 4. PARTIAL (docs/08 §8.4, FR-9)
##
# NEEDS REVIEW. en-US, a `{ $failed }` selector: "1 database could not be
# searched. The results below come from the other { $succeeded }." /
# "{ $failed } databases could not be searched. The results below come from the
# other { $succeeded }." Keep the selector with only `*[other]`.
# research-helper-search-state-partial =


## 5. ERROR (docs/08 §4.6, §8.4)
##
# NEEDS REVIEW. en-US: "Could not reach any database."
# research-helper-search-state-error =
#
# NEEDS REVIEW. en-US `.label`: "Open Preferences…"
# research-helper-search-state-error-open-preferences =
#
# NEEDS REVIEW. en-US `.label`: "Retry"
# research-helper-search-state-error-retry =


## Error detail disclosure (NFR-14)
##
# NEEDS REVIEW. en-US `.label`: "Show details"
# research-helper-search-details-show =
#
# NEEDS REVIEW. en-US `.label`: "Hide details"
# research-helper-search-details-hide =

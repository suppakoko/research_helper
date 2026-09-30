# research_helper — strings for the Search & Import window.
#
# `docs/08` §10.1 owns the surface list; this is the **searchDialog** surface —
# `addon/content/searchDialog.xhtml` and, from Phase 2, the Related Papers
# reuse of it (`docs/08` §5). It earns its own file because it owns a *window*:
# its own document, its own `<linkset>`, and it can be open while the main
# window is not.
#
# Flat under `locale/en-US/`, plugin-unique filename, every identifier
# prefixed `research-helper-` — `docs/01` §9.1 (Zotero 10.0.1 drops
# subdirectories) and §9.3 (identifiers *and* filenames are global namespaces;
# a collision silently shadows rather than erroring).
#
# ## What is here and what is not
#
# Everything this window's own document resolves through `data-l10n-id`. Three
# vocabularies it *renders* live in `research-helper-mainWindow.ftl` instead,
# because more than one surface shows them and no id may be declared in two
# files: the `rh-error-*` messages, the import summary, and the literature
# source display names (`LiteratureSource.displayNameKey`). The view model
# formats those and hands this document an **already localized string** — the
# same rule `P1-T15` applies to the progress sink, and the reason every
# `$reason` / `$database` placeable below takes a string rather than a key.
#
# ## The attribute each entry sets
#
# `P1-T20` writes the markup and must match these. The convention is the
# element's own labelling attribute:
#
# | Element | Attribute set here |
# |---|---|
# | XUL `<label>` caption | `.value` |
# | `<button>`, `<checkbox>`, `<radio>`, `<menuitem>`, `<tab>` | `.label` |
# | text / number input, `<menulist>`, the results table | `.aria-label` |
# | anything with a tooltip | `.tooltiptext` |
# | panel prose and status text | the message value itself, no attribute |
#
# A new window needs its own XUL `<tooltip id="html-tooltip">` element or no
# `.tooltiptext` appears at all (`docs/08` §4.1.1 requirement 3).
#
# ## Counts
#
# Every counted string is one Fluent message with a `{ $count }` selector.
# `docs/08` §10.3: `"Imported " + n + " items"` breaks Korean word order, so
# concatenation is forbidden — and §10.2's note keeps the selector even for
# Korean, which has a single plural category, so the two bundles stay
# structurally parallel.
#
# ## Not translated
#
# "PubMed", "Zotero", "DOI", "PMID" and model IDs stay as they are
# (`docs/08` §10.3). The `ko-KR` bundle therefore ships `DOI` verbatim rather
# than waiting on review.
#
# ## Phase scope
#
# Phase 1 ships the `keyword` mode only. `docs/08` §4.2's three other mode
# chips (`related`, `recommend-from-collection`, `rerun`) and §4.6's **Re-run
# (pre-filled from provenance)** panel are FR-12's and Phase 2's (`P2-T17`);
# their strings arrive with that card, not here (`plan/README.md` §5 rule 2).
# The `⊕ ID lookup · preprint matching` status row belongs to bioRxiv and
# medRxiv, which Phase 1 does not register, for the same reason.


## Window

research-helper-search-window-title = Research Helper — Search & Import


## Query row (docs/08 §4.2, §4.5)

research-helper-search-keyword-label =
    .value = Keyword

research-helper-search-keyword-input =
    .aria-label = Search keyword

# Verbatim from `docs/01` §9.2's own example of this entry.
research-helper-search-run =
    .label = Search
    .tooltiptext = Run the search across selected databases

# The read-only mode chip. Phase 1 ships `keyword` only.
research-helper-search-mode-keyword =
    .value = Keyword


## Date range (docs/08 §4.2 "Date defaults", FR-3)
##
## Computed at window open — `fromYear = currentYear - 2` — never hard-coded,
## and the span is stated in the label "so the user is never guessing whether
## '3 years' means rolling 36 months or three calendar years". One message, so
## the parenthetical cannot be concatenated onto the range.

research-helper-search-years-label =
    .value = Years

research-helper-search-years-span =
    { $years ->
        [one] { $from } – { $to } (last calendar year)
       *[other] { $from } – { $to } (last { $years } calendar years)
    }

research-helper-search-years-from =
    .aria-label = Earliest publication year

research-helper-search-years-to =
    .aria-label = Latest publication year

research-helper-search-years-custom =
    .label = Custom…


## Per-database result limit (docs/08 §4.2)
##
## The number itself is `docs/07` §8.5's `maxResults`, seeded from `P1-T03`'s
## typed prefs. No default is named here.

research-helper-search-max-results-label =
    .value = Max per database

research-helper-search-max-results-input =
    .aria-label = Maximum results per database


## Database selection (docs/08 §4.2, FR-2)
##
## The row is rendered from the source registry, and each checkbox label is the
## source's `displayNameKey` from `research-helper-mainWindow.ftl` — not an id
## in this file.

research-helper-search-databases-label =
    .value = Databases

# FR-2: with every source unchecked, Search is disabled and an inline message
# states that at least one source must be selected.
research-helper-search-databases-none = Select at least one database to search.


## Client-side filtering (docs/08 §4.2, §4.5)

research-helper-search-filter-label =
    .value = Filter

research-helper-search-filter-input =
    .aria-label = Filter the results already fetched

research-helper-search-hide-existing =
    .label = Hide items already in my library

research-helper-search-result-count = { $total } results · { $new } new


## Result table (docs/08 §4.2 columns, §4.3, §9)
##
## `docs/08` §4.3 requires an accessible table name and an accessible string
## per row even for the plain `<html:table>` v1 decision.

research-helper-search-table =
    .aria-label = Search results

research-helper-search-col-select =
    .aria-label = Select

research-helper-search-col-title =
    .label = Title

research-helper-search-col-authors =
    .label = Authors

research-helper-search-col-year =
    .label = Year

research-helper-search-col-source =
    .label = Source

research-helper-search-col-type =
    .label = Type

# Not translated (docs/08 §10.3).
research-helper-search-col-doi =
    .label = DOI

# The wireframe's "Kim, Park, Novak +5". One message: the list and the overflow
# count are never concatenated by the caller.
research-helper-search-authors-overflow = { $names } +{ $count }

# NFR-13: "already in library" is never carried by colour alone, so the row
# also says it in words (`docs/08` §4.5's `⚠ already in library:` marker).
research-helper-search-row-existing = Already in library: { $title }

research-helper-search-row-existing-badge =
    .aria-label = Already in my library


## Selection controls (docs/08 §4.5, FR-5)

research-helper-search-select-all =
    .label = Select all

research-helper-search-select-none =
    .label = Select none

research-helper-search-select-invert =
    .label = Invert

research-helper-search-selected-count =
    { $count ->
        [one] 1 selected
       *[other] { $count } selected
    }


## Import target and duplicate policy (docs/08 §4.2, §4.4, §4.5, FR-51)

research-helper-search-target-label =
    .value = Import into

research-helper-search-target-picker =
    .aria-label = Target collection

research-helper-search-target-new =
    .label = New collection…

research-helper-search-duplicates-label =
    .value = Duplicates

research-helper-search-duplicates-skip =
    .label = Skip

research-helper-search-duplicates-link =
    .label = Add existing item to collection

research-helper-search-duplicates-import =
    .label = Import anyway


## Window buttons (docs/08 §4.5, FR-1, NFR-13)

research-helper-search-close =
    .label = Close

research-helper-search-cancel =
    .label = Cancel

research-helper-search-import =
    .label =
        { $count ->
            [one] Import 1 item
           *[other] Import { $count } items
        }


## The five list states (docs/08 §8.4)
##
## INITIAL / LOADING / EMPTY / PARTIAL / ERROR. §8.4 names PARTIAL as "the one
## plugins usually forget" and the most common outcome for an aggregator, and
## §4.6 draws the panels.


## 1. INITIAL — an instruction, not a spinner

research-helper-search-state-initial = Enter a keyword and press Search to query the selected databases for papers from the last { $years } calendar years.


## 2. LOADING — per-source progress, cancellable
##
## `docs/08` §4.6: "Per-database status is essential: partial failure across
## seven sources is the *normal* case, and collapsing it into one spinner hides
## the fact that a whole database was missed." One entry per row state, so the
## row is never assembled from a name plus a fragment.

research-helper-search-source-searching = Searching…

research-helper-search-source-results =
    { $count ->
        [one] 1 result
       *[other] { $count } results
    }

# `$reason` is an already-localized `rh-error-*` string from
# `research-helper-mainWindow.ftl`, never a message id.
research-helper-search-source-failed = Failed — { $reason }

research-helper-search-progress-databases = { $done } of { $total } databases

research-helper-search-status-searching = Searching { $database }…

research-helper-search-status-importing = Importing { $done } of { $total }…


## 3. EMPTY — why, plus concrete suggestions (docs/08 §4.6, §8.4)

research-helper-search-state-empty = No papers found for “{ $query }” in { $from }–{ $to }.

research-helper-search-state-empty-suggestions = Try broadening the year range, removing quotation marks, or enabling more databases.

# §8.3's NO_CONTENT row: per-item and non-fatal.
research-helper-search-row-no-content = No abstract or indexed full text — skipped.


## 4. PARTIAL — results plus per-source warnings (docs/08 §8.4)
##
## FR-9 requires a non-blocking banner here, never a modal.

research-helper-search-state-partial =
    { $failed ->
        [one] 1 database could not be searched. The results below come from the other { $succeeded }.
       *[other] { $failed } databases could not be searched. The results below come from the other { $succeeded }.
    }


## 5. ERROR — cause plus retry (docs/08 §4.6 "All databases failed", §8.4)

research-helper-search-state-error = Could not reach any database.

research-helper-search-state-error-open-preferences =
    .label = Open Preferences…

research-helper-search-state-error-retry =
    .label = Retry


## Error detail disclosure (NFR-14, docs/07 §10.2)
##
## Raw upstream text goes behind a disclosure; it is never the primary message
## and never a stack trace.

research-helper-search-details-show =
    .label = Show details

research-helper-search-details-hide =
    .label = Hide details

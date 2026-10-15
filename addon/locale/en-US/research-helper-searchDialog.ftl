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

# FR-2's third scenario (P2-T14): shown while Semantic Scholar is ticked and the
# `semanticscholar.keyPresent` flag says no key is stored. The window only ever
# knows whether a key is present, never the key. The link text opens the
# key-request form `docs/08` §7.3 already links to.
research-helper-search-s2-no-key = Semantic Scholar has no API key, so its requests share an anonymous pool that is heavily rate-limited.
research-helper-search-s2-no-key-request = Request a free API key


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

# P2-T14 step 3: a pair the deduplication engine flagged as a possible duplicate
# and did NOT merge (FR-50 scenario 4). Both rows carry the badge and both stay
# selectable. `{ $tier }` is the deduplication tier's identifier
# (`docs/02` §11.3), a token like a DOI; `{ $score }` is the similarity as a
# whole percentage. The badge's glyph is the stylesheet's.
research-helper-search-row-duplicate = Possible duplicate
    .title = Possible duplicate of another row ({ $tier }, { $score }% similar). Nothing was merged: review both rows and untick the one you do not want.

# P2-T14 (plan/00 §6 item 146): a pair kept as two linked works, such as a
# preprint and its published version (gate G-16). Both rows are kept.
research-helper-search-row-linked = Other version
    .title = Another row is a different version of this work, such as its preprint. Both are kept; nothing was merged.


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

# The preprint/published-version rule (docs/10 FR-50 scenario 3: "the default
# is documented in the UI"), as decided at gate G-16 on 2026-10-14 and built by
# P2-T11. Plain text; P2-T14 places it in the duplicate-handling area. The tag
# name is data written into the library and stays verbatim in every locale.
research-helper-search-preprint-policy = A preprint and its published version are kept as two items, linked as Related; the preprint is tagged research_helper/superseded-by-published.


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


## Provenance export (FR-8's third scenario, P1-T45)
##
## The control sits in the status bar beside Cancel and is hidden until the
## current run has a provenance record, so the label is written for a user who
## has just imported.
##
## **None of these three takes an argument, and the missing one is deliberate.**
## The obvious success message would name the file that was just written, but
## `docs/09` §2.2 forbids the chosen path leaving the window at all — a path
## carries a user account name — so the sentence confirms the outcome without
## naming the destination. The user chose the destination one dialog ago and
## their file manager can show it; `src/core/provenance.ts` is the only thing
## that ever sees the path, and it does not keep it.

# FR-8's own words for the action, which is what a user searching the window
# for it will look for. The ellipsis follows this bundle's convention for a
# control that opens a dialog (`research-helper-search-target-new`,
# `research-helper-search-state-error-open-preferences`).
research-helper-search-export =
    .label = Export provenance as JSON…

# Status text, not an attribute: it lands on a `<description>`'s `textContent`
# in the status bar, like `research-helper-search-status-importing`.
research-helper-search-export-written = Provenance record exported.

# Every outcome that is not "written" and not "the user dismissed the chooser"
# renders this one sentence. There are three such outcomes and no string per
# outcome: two of them cannot be reached from a visible control at all (see
# `exportProvenance` in addon/content/searchDialog.js), and inventing a
# distinct sentence for each would be three strings on `G-41` for one
# user-visible event.
research-helper-search-export-failed = Could not export the provenance record. Try a different location.


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

# The reserved role row for a source with no keyword search — bioRxiv and
# medRxiv (`docs/08` §4.2, decided 2026-09-09; P2-T14). Never a count, a
# spinner or a zero result. The `⊕` glyph is the stylesheet's
# (`.rh-source-role`) and is reserved for this row alone. `.title` is the
# one-sentence hover §4.2 requires.
research-helper-search-source-role = ID lookup · preprint matching
    .title = This server has no keyword search, so it looks up identifiers and matches preprints to their published versions; keyword search of preprints happens through Europe PMC (SRC:PPR) and Crossref (type:posted-content).


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

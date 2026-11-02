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
# Phase 1 shipped the `keyword` mode only. `P2-T17` (2026-10-15) adds the
# `rerun` mode chip and §4.6's **Re-run (pre-filled from provenance)** panel,
# FR-12's; `P5-T15` (2026-11-02) adds the `related` chip and §5.2's Seed and
# Include rows, FR-13's; the `recommend-from-collection` chip is still a later
# card's. The `⊕ ID lookup · preprint matching` status row arrived with
# `P2-T14`.


## Window

research-helper-search-window-title = Research Helper — Search & Import

# `docs/08` §5.2's wireframe title (P5-T15).
research-helper-search-window-title-related = Research Helper — Related Papers


## Query row (docs/08 §4.2, §4.5)

research-helper-search-keyword-label =
    .value = Keyword

research-helper-search-keyword-input =
    .aria-label = Search keyword

# Verbatim from `docs/01` §9.2's own example of this entry.
research-helper-search-run =
    .label = Search
    .tooltiptext = Run the search across selected databases

# The read-only mode chip, one message per `mode` value `openSearchWindow`
# accepts (docs/08 §4.2). `keyword` since Phase 1; `rerun` since P2-T17.
research-helper-search-mode-keyword =
    .value = Keyword

# FR-12 (P2-T17): `docs/08` §4.2's `Re-run: <collection name>`. `$collection`
# is the collection's own name — the user's data, not a translatable string.
research-helper-search-mode-rerun =
    .value = Re-run: { $collection }

# FR-13 (P5-T15): `docs/08` §4.2's `Related to: <title>`. `$title` is the seed's
# own title, the user's data, cut by the window to fit the chip.
research-helper-search-mode-related =
    .value = Related to: { $title }


## Related mode's Seed and Include rows — docs/08 §5.2 (P5-T15)
##
## The seed's title, authors, venue, year and DOI are data and are written
## straight into the window. "PubMed" stays as it is (`docs/08` §10.3).

research-helper-search-related-seed-label =
    .value = Seed

# The item was deleted, or could not be read, between the click and the window.
research-helper-search-related-seed-missing = This item could not be read. Select it in your library and choose Find Related Papers… again.

research-helper-search-related-include-label =
    .value = Include

# The seed cites these (FR-15's "cited by seed").
research-helper-search-related-include-reference =
    .label = References

# These cite the seed (FR-15's "cites seed").
research-helper-search-related-include-citation =
    .label = Citations

research-helper-search-related-include-recommendation =
    .label = Recommended

# `plan/08` §0.4 line 12: "similar" means PubMed's similar articles in v1, and
# the checkbox says so.
research-helper-search-related-include-similar =
    .label = Similar articles (PubMed)


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

# The related mode's default for both year lists: no bound (`docs/08` §5.2).
research-helper-search-years-any =
    .label = Any


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
# selectable. `{ $tier }` is the deciding tier's name, one of the
# `research-helper-search-tier-*` messages below, already resolved (owner,
# 2026-10-19, plan/00 §6 item 206; before that it was the tier's identifier,
# such as `title-fuzzy`); `{ $score }` is the similarity as a whole
# percentage. The badge's glyph is the stylesheet's.
research-helper-search-row-duplicate = Possible duplicate
    .title = Possible duplicate of another row ({ $tier }, { $score }% similar). Nothing was merged: review both rows and untick the one you do not want.

# P2-T14 (plan/00 §6 item 146): a pair kept as two linked works, such as a
# preprint and its published version (gate G-16). Both rows are kept.
research-helper-search-row-linked = Other version
    .title = Another row is a different version of this work, such as its preprint. Both are kept; nothing was merged.

# Owner, 2026-10-19, plan/00 §6 item 206: the name of each deduplication tier
# that can flag or link a pair, shown inside the duplicate badge's tooltip as
# `{ $tier }`, so lower case and no full stop. Worded from `docs/02` §11.3's
# own tier table: Tier 5 "Normalized title exact", Tier 6 "Fuzzy title",
# Tier 7 "Known preprint↔published link". The identifier tiers (DOI, PMID,
# PMCID, arXiv, Semantic Scholar) only ever merge, so they have no name here.
research-helper-search-tier-title-exact = exact title match
research-helper-search-tier-title-fuzzy = close title match
research-helper-search-tier-version-link = known preprint–published link


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

# The same panel in the related mode (P5-T15), which has no keyword to enter.
research-helper-search-state-initial-related = Papers related to this item will be listed here.


## 1a. Re-run (pre-filled from provenance) — FR-12, docs/08 §4.6 (P2-T17)
##
## The window's initial state when it is opened from a collection's
## "Re-run This Search…" entry. Every control is seeded from the collection's
## stored search_provenance row and stays editable. `$collection` is the
## collection's own name; `$date` the recorded run's finish date, already
## formatted by the window; the three counts are the record's own totals.
##
## Two deliberate departures from §4.6's drawn panel, both reported with
## P2-T17: the record stores no client-side filter (`docs/07` §5.3 has no
## field for one), so the second line does not claim the filters are
## pre-filled; and the importer can tell "already in the library" but not
## "already in this collection", and it honours "Import anyway", so the third
## line says what the count actually is.

research-helper-search-rerun-heading = Re-run of the search that built “{ $collection }”

research-helper-search-rerun-recorded =
    { $databases ->
        [one] Recorded { $date } · 1 database · { $retrieved } retrieved · { $imported } imported
       *[other] Recorded { $date } · { $databases } databases · { $retrieved } retrieved · { $imported } imported
    }

# The date choice is a radio pair, "as recorded" selected by default
# (docs/08 §4.6 rule 2). "advance to today" moves only the upper bound.
research-helper-search-rerun-as-recorded =
    .label = as recorded

research-helper-search-rerun-advance =
    .label = advance to today

research-helper-search-rerun-prefilled = Keyword, sources and max-per-database are pre-filled from the stored provenance record, and all stay editable.

research-helper-search-rerun-press-search = Press Search to run it again. Unless Import anyway is chosen below, items already in your library are counted as “already present” and never imported twice.

# Replaces the year span while the re-run's window is the recorded
# "All years" (FR-3: `dateFilter: none`), which the two year menulists cannot
# show.
research-helper-search-rerun-all-years = All years, as recorded

# FR-12's second scenario, in docs/08 §4.6 rule 4's shape. Used instead of
# research-helper-import-summary for an import made from the re-run state.
# `$present` counts the records that matched an item already in the library
# by DOI or PMID, which were therefore not imported again.
research-helper-search-import-summary-rerun = Imported { $imported } · Already present { $present } · { $failed } failed


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

# A source the host still refused with HTTP 429 after the client's own retries
# (`plan/00` §6 item 232, owner, 2026-10-21; `docs/08` §8.3's dated note).
# Shown in that source's status row and in its line of this panel, in place of
# `rh-error-rate-limit`'s "Retrying in { $seconds }s", which would be false:
# the retries have already happened inside the request, and nothing is
# retrying when this is shown. `$database` is the source's display name, not
# translated. The action offered is Retry.
research-helper-search-error-rate-limit = { $database }: too many requests, refused · try again in a moment


## Error detail disclosure (NFR-14, docs/07 §10.2)
##
## Raw upstream text goes behind a disclosure; it is never the primary message
## and never a stack trace.

research-helper-search-details-show =
    .label = Show details

research-helper-search-details-hide =
    .label = Hide details

## Relevance screening (P3-T27; docs/08 §4.2's threshold row, docs/12 §3)
##
## Shown only while the active AI provider has a key, and only after the user
## ticks the checkbox for this run: screening sends each result's title and
## abstract to the AI model, which costs money. The threshold is the run's own
## and is never saved.

# The per-run checkbox. Unticked every time the window opens.
research-helper-search-screening-enable =
    .label = Screen results for relevance with the AI model

research-helper-search-screening-threshold-label =
    .value = Relevance threshold

research-helper-search-screening-threshold-input =
    .aria-label = Relevance threshold, from 0 to 100

# Brings back the rows the threshold hides, so a wrongly excluded paper can be
# rescued (docs/12 §3: never hard-filter without showing the number).
research-helper-search-screening-show-excluded =
    .label = Show excluded

# Beside the threshold, updated as the number changes. `{ $kept }` counts the
# rows the threshold keeps (unscored rows included), `{ $total }` every row,
# `{ $excluded }` the scored rows below the threshold.
research-helper-search-screening-count = Importing { $kept } of { $total } results · { $excluded } below the threshold

# A banner line: some rows have no score. `{ $count }` is how many.
research-helper-search-screening-unscored = The AI model could not score { $count } results. They are shown without a score and are never hidden.

# A banner line: screening was chosen but could not run at all (no key, a
# privacy setting that refuses the model, a spending limit, a network error).
research-helper-search-screening-failed = Relevance screening could not run, so no result was scored and none is hidden.

# The badge on a scored row. `{ $score }` is the model's score, 0 to 100.
research-helper-search-row-relevance = Relevance { $score }
    .title = Relevance score from the AI model, from 0 to 100. A row below the threshold is hidden unless Show excluded is ticked.

## The estimated cost of screening (owner, 2026-10-24, plan/00 §6 item 281(b);
## docs/08 §4.2, docs/12 §3)

# Beside the screening checkbox. `{ $cost }` is the estimate, already formatted
# as currency; `{ $count }` is the most results the ticked databases can return
# (the per-database maximum times the databases that search). Both are upper
# bounds, because merging duplicates leaves fewer results to score.
research-helper-search-screening-cost = Estimated cost of screening: up to about { $cost } for up to { $count } results

# Beside the screening checkbox when the model's price is not known.
# `{ $model }` is the model's id, not translated.
research-helper-search-screening-cost-unpriced = The price of { $model } is not known, so the cost of screening cannot be estimated.

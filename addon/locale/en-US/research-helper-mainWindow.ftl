# research_helper — strings injected into Zotero's own main window.
#
# `docs/08` §10.1 owns the surface list; this is the **mainWindow** surface.
#
# ## What belongs in this file, and what belongs in a sibling
#
# `docs/08` §10.1 gives this surface two jobs, and `P1-T18` adds the third,
# which the corpus implies rather than states:
#
# 1. Strings that appear inside a window **Zotero** owns — the Tools and
#    collection-context menus today, the Phase 3 item-pane section later.
# 2. Strings for dialogs raised *from* the main window (§10.1's "main-window
#    rule"): they resolve against this bundle, already inserted by
#    `insertFTLIfNeeded`, and get no FTL file of their own.
# 3. **Strings that JavaScript formats and hands to more than one surface.**
#    §10.1's "From JS, no window" row names this bundle for
#    `new Localization([…])`, and the plugin-wide vocabularies below are each
#    rendered in at least two places:
#      * the `rh-error-*` block — the search window's status bar and error
#        panel, a completion toast, and a provenance record;
#      * the import summary — the search window's status bar *and* the
#        completion `ProgressWindow` toast (`docs/08` §4.4);
#      * the source display names (`LiteratureSource.displayNameKey`,
#        `docs/07` §4.2) — the database checkbox row, the result table's
#        Source column, every error message's `$database`, the provenance
#        note and the toast.
#    Putting them here means one lookup formats a string every surface can
#    show, and no id is declared twice across two files. It also keeps the
#    `P1-T15` rule intact: a sink or a document receives an **already
#    localized string**, never a message id. `Zotero.getString()` throws on an
#    unknown key under `en-US` (`docs/08` §8.2.1) and a plugin `.ftl` lives in
#    `L10nRegistry`, not in `getString`'s synchronous bundle, so anything that
#    hands a message id to a synchronous getter is a bug.
#
# Strings a *document* resolves through its own `data-l10n-id` live in that
# document's surface file — the Search & Import window's are in
# `research-helper-searchDialog.ftl`.
#
# ## Identifier prefixes
#
# Every identifier is prefixed `research-helper-` **except the `rh-error-*`
# block**, whose ids are fixed by `src/core/errors.ts` (`docs/07` §10.1) and
# asserted there by `P1-T02`'s tests. See that block's own comment: the
# divergence is a corpus defect reported by `P1-T18`, not a licence to invent
# a third prefix. Fluent identifiers share one global namespace per DOM
# document, so an unprefixed id silently shadows Zotero's own (`docs/01` §9.3,
# §12 gotcha 16).
#
# The file sits directly under `locale/en-US/` with a plugin-unique name, not
# in a `research-helper/` subfolder: Zotero 10.0.1's `registerLocales()` drops
# subdirectories and shares one flat filename namespace across all plugins
# (`docs/01` §9.1, `P0-T32`). The prefixes are written here by hand;
# `zotero-plugin.config.ts` adds none (`prefixLocaleFiles` and
# `prefixFluentMessages` are both off).
#
# ## This file is the fallback for every locale
#
# `locale/ko-KR/research-helper-mainWindow.ftl` carries the subset of these
# identifiers a native Korean speaker has signed off (`docs/08` §10.2 supplies
# two of them; the rest await the `P1-T18` human gate). Zotero picks a *whole
# file* per locale and never merges files, and Gecko's `Localization` then
# fills a missing *message* from the next locale in the chain — which ends in
# `en-US` (`docs/01` §9.1, measured by `P0-T24`). So this file must stay the
# complete one: a plugin shipping only `ko-KR` shows Korean to every user on
# the pre-Zotero-10 path (`docs/08` §10.1).
#
# `research-helper-menu-spike-create-item` is absent from the `ko-KR` bundle
# **on purpose** and must stay so: it is the key `test/integration/l10n.spec.ts`
# uses to prove that a Korean UI falls back to this file's English rather than
# to the identifier (`FR-55`, spike `V-17`, `P0-T24`).


## Tools ▸ Research Helper, and the collection context menu (docs/08 §2.4, §2.5)
##
## `Zotero.MenuManager` has no plain `label` property — `l10nID` is the only
## labelling mechanism it offers, and the FTL entry **must** set `.label`
## (docs/08 §10.1's mechanism table, §2.1's verbatim typedef).

research-helper-menu-root =
    .label = Research Helper

research-helper-menu-search-import =
    .label = Search & Import…

# The collection-context entry `P1-T19` registers, which opens the Search &
# Import window with that collection pre-selected as the import target.
#
# **This id is not in the corpus.** `docs/08` §2.4's collection block and
# §2.5's collection wireframe list four entries — report, summarize-all,
# re-run, recommend — and none of them is Phase 1's. `P1-T19`'s Goal requires
# the entry ("reachable … from a collection's context menu with that
# collection pre-selected as the target"), so `P1-T18` declares the id it
# needs. Reported as a `docs/08` §2.4/§2.5 gap; the wording here is
# provisional until the owner rules on it.
research-helper-menu-collection-search-import =
    .label = Search & Import into This Collection…

# `P0-T10`'s spike command. Kept deliberately: `src/ui/menus/toolsMenu.ts`
# names this id, and it is the key the ko-KR fallback assertion is built on
# (see the header). Removing it breaks both.
research-helper-menu-spike-create-item =
    .label = Create spike item (P0-T10)


## Literature source display names — `LiteratureSource.displayNameKey`
##
## Phase 1 registered one source. The others arrive with their adapters in
## Phase 2 (`docs/07` §11.1 step 11: a source appears in the UI by
## registration alone), and each brings its own entry here — Europe PMC's
## landed with `P2-T32`, Crossref's with `P2-T04`. One declaration per id, in
## this bundle only
## (`docs/01` §9.3).
##
## **Never translated** (`docs/08` §10.3: database names are not translated),
## so the ko-KR bundle carries these verbatim rather than awaiting review.

research-helper-source-pubmed = PubMed
research-helper-source-europepmc = Europe PMC
research-helper-source-crossref = Crossref


## Search provenance (FR-8, P1-T17)
##
## FR-8 fixes the note title format literally as
## `Research Helper — search provenance <ISO timestamp>`. One message with a
## placeable, never concatenation (`docs/08` §10.3).

research-helper-provenance-note-title = Research Helper — search provenance { $timestamp }


## Import outcome (docs/08 §4.4, FR-51)
##
## One message per line of reporting, each with its own placeables. `docs/08`
## §10.3 forbids assembling these from fragments: "Imported " + n + " items"
## breaks Korean word order.

# The status-bar and toast summary. FR-51 requires linked-existing to be
# reported separately from created.
research-helper-import-summary = Imported { $imported } · Linked { $linked } · Skipped { $skipped } duplicates · { $failed } failed

# The abstract-coverage figure that measures risk R-17 (`P1-T22` step 3).
research-helper-import-abstract-coverage = Abstracts present for { $percent }% of imported items


## The progress popup's headline — `docs/07` §7.7, `docs/08` §8.2 (P1-T32)
##
## **`research-helper-import-toast-header` stood here and was retired by
## `P1-T33`.** It declared "the header of the completion `ProgressWindow`
## toast (`docs/08` §4.4)" with this same text, and `P1-T33` decided §4.4's
## completion toast and §7.7's per-job popup are one surface: §8.2.2 found no
## toast mechanism in Zotero 7–10, so §4.4's "toast" is this popup raised at
## a different moment (`openOn`, `P1-T31`), and the sink has one headline.
## The reasoning is in `src/i18n/keys.ts`'s `L10N_PROGRESS_HEADLINE`. One id,
## one string, one owner decision.
##
## `changeHeadline(text, …)`'s first argument, for the `Zotero.ProgressWindow`
## every job raises (`docs/07` §7.7's "One window per job", `P1-T31`). It is
## **application-scoped**: the product's name for the surface, not the job's —
## a per-job string is the `ItemProgress` line's text, which the reporter
## carries separately.
##
## It lives in this bundle rather than in `searchDialog.ftl` because JavaScript
## formats it and hands it to a surface that is not a document of ours, which
## is §10.1's "From JS, no window" row and this file's third job (see the
## header). Before `P1-T32` the composition root passed `config.addonName`, a
## brand name read out of `package.json`, so a Korean UI showed English with
## nothing in the log to say a string had never been looked up.
##
## **The en-US text is the product name, and the corpus supplies no sentence.**
## `docs/08` §8.2's own example call is
## `changeHeadline("Research Helper", "library", "Summarizing…")` — product
## name as the headline, activity as the trailing text — and Zotero's own
## in-tree call puts a sentence there instead
## (`Zotero.getString("ingester.scrapingTo")`). Nothing in `docs/07` §7.7 or
## `docs/08` §8.2 states which of the two shapes is ours, so the shipped text
## is the one that was already on screen, and the owner can change this one
## string without touching code. The point of the id is that it is now
## translatable at all.

research-helper-progress-headline = Research Helper


## User-facing error strings — `ResearchHelperError.messageKey`
##
## ### The prefix on this block is `rh-error-`, not `research-helper-`
##
## Every `messageKey` in `docs/07` §10.1 is `rh-error-<code>`, the values are
## fixed in `src/core/errors.ts`, and all 23 of them are asserted by
## `P1-T02`'s `test/unit/core/errors.test.ts`. A mismatch here is a blank
## label at runtime, not a compile error, so these ids are transcribed from
## the code and must not be "corrected" to the plugin prefix from this side.
##
## That leaves `docs/01` §9.3's rule ("every ID starts with `research-helper-`",
## "No exceptions") in conflict with `docs/07` §10.1, and `P1-T18`'s fourth
## criterion, which greps for exactly that prefix, cannot pass while the
## conflict stands. `P1-T18` reports it rather than picking a side in code:
## renaming the keys touches `src/core/errors.ts`, its unit test and `docs/07`
## §10.1, none of which is in this card's `Files` list.
##
## ### The message text
##
## `docs/08` §8.3 owns the en-US wording and the action offered; `docs/07`
## §10.2 carries a shorter paraphrase of the same table. Where the two differ
## §8.3 is followed, because it is the UI spec and its column is headed
## "Message (en-US)" — the one divergence is `OFFLINE`, reported.
## NFR-14: what failed, which service, one concrete next action.
##
## ### What is deliberately absent
##
## Seven of §10.1's 23 keys belong to subsystems Phase 1 does not contain, and
## `plan/README.md` §5 rule 2 forbids adding them here on spec: `rh-error-llm`,
## `rh-error-context-length`, `rh-error-content-filter`,
## `rh-error-structured-output`, `rh-error-tts`, `rh-error-budget` and
## `rh-error-policy` arrive with the Phase 3 cards that can throw them.
## `src/i18n/keys.ts` exports that list as `DEFERRED_ERROR_MESSAGE_IDS` and
## `test/integration/l10n.spec.ts` asserts it is exactly the set missing, so a
## new error class cannot be added without this file noticing.

rh-error-configuration = Research Helper is not configured correctly for this action.

# `MissingCredentialError`. §8.3's NO_KEY row. Action: Open Preferences.
rh-error-missing-credential = No API key configured for { $provider }.

rh-error-network = Could not reach { $host }.

# §8.3's OFFLINE row reads "Zotero is offline."; `docs/07` §10.2's summary
# table reads "No internet connection." for the same class. §8.3 wins here and
# the divergence is reported.
rh-error-offline = Zotero is offline.

rh-error-timeout = { $host } did not respond within { $seconds }s.

# §8.3 folds 401 and 403 into one AUTH row; `docs/07` §10.1 gives each its own
# key, so the 403 wording below is derived from the row rather than quoted.
rh-error-auth = { $provider } rejected the API key (HTTP { $status }).

rh-error-forbidden = { $provider } refused the request (HTTP { $status }).

rh-error-rate-limit = { $provider } rate limit reached. Retrying in { $seconds }s.

rh-error-quota = { $provider } reports the account is out of credit.

rh-error-upstream = { $database } is temporarily unavailable (HTTP { $status }). Other databases were still searched.

# `BadRequestError` carries `userFacing = false` ("almost always our bug",
# `docs/07` §10.1), so this should never be rendered. It exists because the
# `messageKey` contract is unconditional: every class has one, and a key with
# no message is a blank label if the flag is ever wrong.
rh-error-bad-request = Research Helper sent a request { $database } could not accept.

rh-error-source = { $database } could not complete the search.

# `ParseError` is also `userFacing = false` — §10.2: "Logged; item counted as
# failed with a generic message".
rh-error-parse = Could not read the response from { $database }.

rh-error-zotero = Zotero could not complete the change.

rh-error-storage = Research Helper could not write to storage.

# §8.3's CANCELLED row. `OperationCancelledError` is `userFacing = false`
# because cancellation is not a failure, but `P1-T22` step 4 renders this text
# with the count of items already imported, which is why it takes `$imported`.
rh-error-cancelled =
    { $imported ->
        [one] Cancelled. 1 item was already imported.
       *[other] Cancelled. { $imported } items were already imported.
    }


## The preference pane — literature-source credentials (docs/08 §7.3–7.5,
## docs/09 §1.8–1.9; P1-T44)
##
## ### Why these are in this bundle and not in `research-helper-preferences.ftl`
##
## `docs/08` §10.1 plans a fourth surface file for the pane. `P1-T44`'s `Files`
## list names this bundle instead, and this bundle's own header gives the
## reason that fits: the pane is a fragment inside a window **Zotero** owns
## (`zotero:pref`), which is this file's first job. A fourth bundle also needs
## a fourth entry in `src/i18n/keys.ts`'s `SHIPPED_SURFACES` and in the
## localization spec, none of which the card's `Files` list covers. Reported
## with the card as a divergence from §10.1; moving the block later is a
## rename, not a rewrite.
##
## ### The residual-risk statement is verbatim and must stay so
##
## `research-helper-prefs-risk-1` … `-5` are the five paragraphs of `docs/09`
## §1.8's blockquote, reproduced word for word with only the Markdown emphasis
## markers dropped (`docs/09` §1.9 item 4, `docs/08` §7.5 rule 8: "verbatim and
## visible, not behind a link"). `test/unit/ui/preferencesPane.test.ts` reads
## §1.8 off disk and fails if a word here differs. Edit `docs/09` first.
##
## ### The badge wording is load-bearing, not decorative
##
## `docs/09` §1.8 (corrected 2026-09-30): "the text is only true if the badge
## is accurate". `-backend-indeterminate` exists because the startup probe
## cannot tell a Linux system keyring from Gecko's in-profile `NSSKeyStore`
## substitute (`P1-T41`, 2026-10-13); until gate `G-09`'s library-presence
## check lands, a Linux badge may not claim either tier. `G-41` owns the
## wording of all of these, as it owns every string in this file.

research-helper-prefs-storage = Stored API keys

research-helper-prefs-backend-windows = Protected by Windows Credential Manager
research-helper-prefs-backend-mac = Protected by the macOS Keychain
# Linux, or an unrecognised platform: the probe passed, but which store answered
# it cannot yet be determined. Deliberately not "System keyring".
research-helper-prefs-backend-indeterminate = Encrypted by your operating system. Research Helper cannot yet tell whether this is your system keyring or Zotero's own database — read the third paragraph below before storing a key on this computer.
research-helper-prefs-backend-unavailable = No credential store is available on this computer. Keys cannot be stored here until one is.

research-helper-prefs-risk-1 = Your API keys are encrypted using your operating system's credential store and stored in Zotero's login manager. The preferences pane names the store actually in use next to the key fields.
research-helper-prefs-risk-2 = When that store is Windows Credential Manager, the macOS Keychain, or your Linux system keyring, the key is held outside your Zotero folder: copying that folder, or restoring it from a backup, does not carry the key with it, and another user account on this computer cannot read it.
research-helper-prefs-risk-3 = When the pane says the key is stored in Zotero's own database instead, that protection does not apply: the key is inside your Zotero profile, so it travels with a copy or a backup of it, and it is protected only by Zotero's primary password if you have set one. Set one, or do not store keys on that machine.
research-helper-prefs-risk-4 = It does not protect them from software running under your own user account. Any program you run — including any other Zotero plugin — can decrypt them, because your operating system will decrypt them for anything running as you. Zotero does not isolate plugins from each other.
research-helper-prefs-risk-5 = Treat these keys as you would a password saved in your browser. Set spending limits with your provider, and rotate any key you think may have been exposed.

research-helper-prefs-remove-all =
    .label = Remove all stored keys
# docs/09 §1.9 item 6: the button "reports how many were removed".
research-helper-prefs-remove-all-done =
    { $count ->
        [one] Removed 1 stored key.
       *[other] Removed { $count } stored keys.
    }

research-helper-prefs-ncbi = NCBI (PubMed)
# docs/02 §3.1: the keyed budget is 10 requests per second, the unkeyed 3.
research-helper-prefs-ncbi-note = An NCBI API key raises the request limit from 3 to 10 per second. Searches work without one, more slowly.
research-helper-prefs-ncbi-key =
    .value = API key

research-helper-prefs-s2 = Semantic Scholar
# docs/08 §7.4's wireframe text for this block.
research-helper-prefs-s2-note = Related papers and recommendations need a key — the anonymous pool is rate-limited to the point of being unusable. Free, but approval takes time.
research-helper-prefs-s2-key =
    .value = API key
research-helper-prefs-s2-request = Request an API key

# docs/09 §1.9 item 1: hold-to-show, never a sticky toggle. The label says so.
research-helper-prefs-reveal =
    .label = Hold to show
research-helper-prefs-test-key =
    .label = Test
research-helper-prefs-clear-key =
    .label = Clear

## The per-credential status row (docs/09 §1.9 item 5). Painted by
## `addon/content/preferences.js`; never bound to a preference. `$time` is a
## clock time already formatted by the script with `Intl.DateTimeFormat` over
## `Zotero.locale` (docs/08 §10.3).

research-helper-prefs-key-absent = No key stored.
# docs/09 §1.9 item 8's restore explanation, shown only when the badge names an
# operating-system store — under the NSSKeyStore fallback the key *does* travel
# with the profile, so this sentence would be false there (G-09, 2026-09-30).
research-helper-prefs-key-absent-os = No key stored. API keys are stored in this computer's credential store and do not travel with your Zotero data folder.
# "This session": the last test result is not yet persisted — docs/07 §8.5's
# lastValidatedAt / lastValidationResult rows have no schema entry yet (P1-T44).
research-helper-prefs-key-present = A key is stored. Not tested yet this session.
research-helper-prefs-key-cleared = Key removed.
research-helper-prefs-store-unavailable = This key was not stored: no credential store is available on this computer.
research-helper-prefs-store-empty = Nothing to store: the field is empty after trimming.
research-helper-prefs-test-running = Testing…
research-helper-prefs-test-ok = Key accepted · checked { $time }
# docs/09 §2.3 maps every non-success outcome for the two source credentials to
# `inconclusive`; docs/08 §7.5 rule 2 permits only this neutral wording there.
research-helper-prefs-test-inconclusive = Could not verify this key · checked { $time }
research-helper-prefs-test-rejected = The service rejected this key (HTTP 401) · checked { $time }
research-helper-prefs-test-forbidden = The service refused the request (HTTP 403) · checked { $time }
research-helper-prefs-test-absent = Store a key before testing it.
research-helper-prefs-test-unavailable = No credential store is available, so there is no key to test.

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

# FR-12's entry (P2-T17), verbatim from `docs/08` §10.2. Shown only when the
# collection has a stored search_provenance row: absent, not disabled,
# otherwise (`docs/08` §2.4, §2.5).
research-helper-menu-collection-rerun =
    .label = Re-run This Search…

# FR-25's entry (P4-T19), verbatim from `docs/08` §2.4 and §10.2; FR-25's
# wording was corrected to match (owner, 2026-10-26, `plan/00` §6 item 286).
# It opens the report window, whose strings are in
# research-helper-reportWindow.ftl.
research-helper-menu-collection-report =
    .label = Generate Research Trends Report…

# FR-13's entry (P5-T15), verbatim from `docs/08` §2.4 and §10.2. It sits on the
# item context menu, and only while the hidden `related.enabled` preference is
# on. It opens the search window, whose strings are in
# research-helper-searchDialog.ftl.
research-helper-menu-item-find-related =
    .label = Find Related Papers…
    .tooltiptext =
        { $oneItem ->
            [yes] { "" }
           *[no] Select a single item to find papers related to it.
        }

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
## landed with `P2-T32`, Crossref's with `P2-T04`, arXiv's with `P2-T06`,
## Semantic Scholar's with `P2-T05`, bioRxiv's and medRxiv's with `P2-T07`
## (two ids, one adapter). One declaration per id, in this bundle
## only (`docs/01` §9.3).
##
## **Never translated** (`docs/08` §10.3: database names are not translated),
## so the ko-KR bundle carries these verbatim rather than awaiting review.

research-helper-source-pubmed = PubMed
research-helper-source-europepmc = Europe PMC
research-helper-source-crossref = Crossref
research-helper-source-arxiv = arXiv
research-helper-source-semanticscholar = Semantic Scholar
research-helper-source-biorxiv = bioRxiv
research-helper-source-medrxiv = medRxiv


## LLM provider display names — `LLMProvider.displayNameKey` (docs/07 §4.3)
##
## One per adapter (`P3-T07`–`P3-T10`), one id scheme,
## `research-helper-provider-<id>` (owner, 2026-10-21, `plan/00` §6 item
## 262(b)). **Never translated** (`docs/08` §10.3: provider names are not
## translated), so the ko-KR bundle carries these verbatim, like the source
## names above.

research-helper-provider-openrouter = OpenRouter
research-helper-provider-openai = OpenAI
research-helper-provider-anthropic = Anthropic
research-helper-provider-gemini = Google Gemini


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

# The import-path counts of a run with `useTranslators` on (`P2-T18` step 10;
# `docs/01` §6.3 item 3). `$translated` items came through Zotero's own
# identifier lookup; `$handMapped` were built from the search results, either
# because the lookup could not resolve them or because they had no identifier.
# Here, beside the import summary, because the same view model formats both.
research-helper-import-paths = Through Zotero translators { $translated } · From search results { $handMapped }

# Why records went to the search-results path while translators were on, one
# line per reason class (`P2-T18` step 7). `$cause` is one of the five tokens
# below and is never shown; `$count` is how many records.
research-helper-import-fallback-reason =
    { $cause ->
        [lookup-error] Translator lookup failed: { $count }
        [no-translators] No translator for the identifier: { $count }
        [no-result] Translator lookup found nothing: { $count }
        [timeout] Translator lookup timed out: { $count }
       *[no-identifier] No DOI, PMID or arXiv ID: { $count }
    }


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
## Three of §10.1's 23 keys belong to subsystems not built yet, and
## `plan/README.md` §5 rule 2 forbids adding them here on spec: `rh-error-tts`,
## `rh-error-budget` and `rh-error-policy` arrive with the cards that can throw
## them. Until 2026-10-20 the list also held the four LLM keys, which `P3-T05`
## added at the end of this block. *(Updated 2026-10-23, `P3-T16`:
## `rh-error-budget` left the list, and its entry closes this block; two remain.)*
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

# The LLM subtree of `docs/07` §10.1 (`P3-T05`, 2026-10-20), mapped from each
# provider's failure by `mapProviderError` in `src/llm/shared/errorMap.ts`.
# `docs/08` §8.3 has no rows for these yet, so only the content-filter
# sentence is quoted (from `docs/07` §10.2); the other three are this card's
# wording, written to NFR-14: what failed and which service. `$provider` and
# `$model` are untranslated names (`docs/08` §10.3).

# `LLMError` itself: a provider failure no narrower class describes.
rh-error-llm = { $provider } could not complete the request.

# `ContextLengthExceededError` is `userFacing = false`: the pipeline re-chunks
# and retries before the user would see it.
rh-error-context-length = The text is too long for { $model } to read in one request.

# `docs/07` §10.2: the item is marked skipped and the job continues.
rh-error-content-filter = The model declined to summarize this paper.

rh-error-structured-output = { $provider } returned a summary Research Helper could not read.

# `OutputTruncatedError` (owner, 2026-10-21, `plan/00` §6 item 265(c);
# `docs/07` §10.1): the answer stopped at the output length limit
# (`finishReason` "length"), so the summary is incomplete. The item counts as
# failed and the job continues. `$model` is the model ID, untranslated
# (`docs/08` §10.3).
rh-error-output-truncated = The summary was cut off by the output length limit of { $model }.

# `PrivacyRoutingError` (owner, 2026-10-21, `plan/00` §6 item 262(c);
# `docs/07` §10.1): OpenRouter's guardrail 404, which `docs/09` §3.4 rule 2
# says gets a real explanation naming the cause and both ways out. The second
# way out is scoped on purpose: `data_collection: "deny"` is sent in every
# mode (`docs/09` §3.5), so leaving Strict drops only the zero-retention
# requirement, and in Balanced only another model helps. "Strict" and
# "Balanced" are the privacy-mode menu's labels (`docs/08` §7.3).
# `$model` is the model ID, untranslated (`docs/08` §10.3).
rh-error-privacy-routing = OpenRouter has no provider for { $model } that meets your privacy mode. Choose a different model, or change the privacy mode from Strict to Balanced if it is set to Strict. Balanced allows providers that keep your text for a time and sends PDF full text, but still refuses providers that may train on your data.
# `BudgetExceededError` (P3-T16; docs/07 §10.1, §4.3's note "BudgetGuard, as
# built"): a spend ceiling was reached, and the job paused rather than stopped
# (owner, 2026-10-20, plan/00 §6 item 234). `$limit` and `$spent` are dollar
# amounts the caller formatted with Intl (docs/08 §10.3). The question that
# follows ("Continue" / "Stop") is the cost dialog's ceiling moment.
rh-error-budget = Paused at the { $limit } spending limit. { $spent } is spent so far, and summaries already made are kept.


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
## `-risk-1-session` is §1.8's tier-2 sentence (2026-10-23), held to the same
## rule; the pane shows it instead of `-risk-1` under the session-only badge.
## `-risk-4-session` is §1.8's tier-2 replacement for paragraph 4 (2026-10-23,
## item 275(b)), held to the same rule; the pane shows it instead of `-risk-4`
## under the same badge.
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
# it cannot yet be determined. Deliberately not "System keyring". The wording is
# the owner's, from docs/09 §1.9 (decided 2026-10-15, review row 50; P2-T34).
research-helper-prefs-backend-indeterminate = Indeterminate — this operating system does not reveal the key-storage tier
research-helper-prefs-backend-unavailable = No credential store is available on this computer. Keys cannot be stored here until one is.

research-helper-prefs-risk-1 = Your API keys are encrypted using your operating system's credential store and stored in Zotero's login manager. The preferences pane names the store actually in use next to the key fields.
research-helper-prefs-risk-2 = When that store is Windows Credential Manager, the macOS Keychain, or your Linux system keyring, the key is held outside your Zotero folder: copying that folder, or restoring it from a backup, does not carry the key with it, and another user account on this computer cannot read it.
research-helper-prefs-risk-3 = When the pane says the key is stored in Zotero's own database instead, that protection does not apply: the key is inside your Zotero profile, so it travels with a copy or a backup of it, and it is protected only by Zotero's primary password if you have set one. Set one, or do not store keys on that machine.
research-helper-prefs-risk-4 = It does not protect them from software running under your own user account. Any program you run — including any other Zotero plugin — can decrypt them, because your operating system will decrypt them for anything running as you. Zotero does not isolate plugins from each other.
research-helper-prefs-risk-5 = Treat these keys as you would a password saved in your browser. Set spending limits with your provider, and rotate any key you think may have been exposed.
# docs/09 §1.8's tier-2 sentence, verbatim: the pane shows it in place of
# -risk-1 while `secretBackend` is `session` (owner, 2026-10-23, plan/00 §6
# item 274(a); gate G-19). Edit docs/09 first.
research-helper-prefs-risk-1-session = Your API keys are held in memory only, for this Zotero session. They are written nowhere — not to your operating system's credential store, not to Zotero's login manager, not to disk — and they are gone when Zotero closes, so you will need to enter them again after a restart.
# docs/09 §1.8's tier-2 replacement for paragraph 4, verbatim: the pane shows it
# in place of -risk-4 while `secretBackend` is `session` (owner, 2026-10-23,
# plan/00 §6 item 275(b)). Edit docs/09 first.
research-helper-prefs-risk-4-session = Even held in memory, the keys are not protected from software running under your own user account: any program you run — including any other Zotero plugin — can read them. Zotero does not isolate plugins from each other.

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
# A stored key with no stored Test result. Test results are stored since P3-T14
# (docs/07 §8.5's lastValidatedAt / lastValidationResult), so "this session" was
# dropped (owner, 2026-10-23, plan/00 §6 item 279(d)).
research-helper-prefs-key-present = A key is stored. Not tested yet.
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

## The LLM provider blocks, tier 2's badge and the restore notice (P3-T04;
## docs/08 §7.3, docs/09 §1.9 items 3 and 8, docs/03 §14.4)
##
## `-backend-session` is docs/09 §1.9 item 3's tier-2 wording, verbatim. The
## base-URL messages answer a write the pane refused or made; a refused value
## is never stored, so each refusal says the previous setting is kept. The
## paid-tier checkbox is a declaration only the user makes (docs/07 §8.5
## `gemini.paidTier`; owner, plan/00 §6 items 269(b) and 270): its label says
## so, and its note says what turning it on changes (docs/09 §3.5, §3.6 item 3).

research-helper-prefs-backend-session = Not saved between sessions
research-helper-prefs-restore-note = No API key is stored on this computer, but this Zotero data folder already holds Research Helper data. If you restored or copied the folder from another computer, enter your keys again: API keys are stored in this computer's credential store and do not travel with your Zotero data folder.
research-helper-prefs-providers = LLM providers
research-helper-prefs-active-provider =
    .value = Active provider
research-helper-prefs-api-key =
    .value = API key
research-helper-prefs-model =
    .value = Model
research-helper-prefs-base-url =
    .value = Base URL
research-helper-prefs-base-url-saved = Saved. Requests to this provider now go to this address.
research-helper-prefs-base-url-default = Cleared. Requests to this provider go to its own address, shown in the empty field.
research-helper-prefs-base-url-not-https = Not saved: the address must start with https://. The previous setting is kept.
research-helper-prefs-base-url-trailing-slash = Not saved: remove the slash at the end of the address. The previous setting is kept.
research-helper-prefs-base-url-invalid = Not saved: enter a full address such as https://proxy.example/v1, without a user name, password, ? or #. The previous setting is kept.
research-helper-prefs-gemini-paid-tier =
    .label = I declare that this key's Google Cloud project is billing-linked (Google's paid tier)
research-helper-prefs-gemini-paid-tier-note = This is your own statement: Research Helper cannot check a key's tier, so this stays off unless you turn it on. On Google's free tier, what you send may be used to improve Google products and read by human reviewers. While this is on, Gemini models are allowed in every privacy mode, and every job still shows a reminder that the key is marked as paid.


## The import-path preference (P2-T18; docs/01 §6.3 item 3, docs/07 §8.5, §12.1)
##
## `docs/08` §7.3's markup binds this id on the Search group's checkbox; the
## checkbox itself is `P3-T04`'s. A XUL `<checkbox>` needs `.label` rather than a
## value (`docs/08` §10.1, measured 2026-10-15), and `docs/07` §12.1 requires the
## tooltip to say the path is slower before a user turns it on. The label text is
## `docs/01` §6.3 item 3's, verbatim.

research-helper-prefs-use-translators =
    .label = Fetch metadata through Zotero translators (slower, more accurate)
    .tooltiptext = Each record is looked up through Zotero's translators over the network, one at a time, so an import takes longer. A record the lookup cannot resolve is imported from the search results instead.


## The job queue's resume notice (P3-T34; docs/07 §7.6, plan/00 §6 item 250)
##
## Shown once when jobs that the last quit of Zotero interrupted resume on their
## own, after every spend guard has passed. `$count` is how many jobs resumed.

research-helper-job-resumed =
    { $count ->
        [one] Research Helper resumed 1 background task that was interrupted when Zotero closed.
       *[other] Research Helper resumed { $count } background tasks that were interrupted when Zotero closed.
    }


## The batch wall-clock budget's question (owner, 2026-10-21, plan/00 §6 item
## 265; docs/03 §11.6, docs/07 §7.5)
##
## Asked when a job has paused at its time limit (pause reason
## `wall-clock-budget`). `$minutes` is the limit in minutes (30), `$total` the
## job's item count, and `$done` the items settled so far, so a yes runs the
## other `$total` − `$done`. The surface is `P3-T29`'s.

research-helper-job-wall-clock-budget =
    { $minutes ->
        [one] Paused after 1 minute of work. { $done } of { $total } done — continue the rest?
       *[other] Paused after { $minutes } minutes of work. { $done } of { $total } done — continue the rest?
    }

## P3-T29: the collection submenu's summarize and removal entries, the
## summarize window (`addon/content/summarize.xhtml`) and the removal
## command's prompt (docs/08 §2.5's note of 2026-10-29). The summarize-all
## label is `docs/08` §10.2's, verbatim; every other wording is provisional
## (G-41) and its Korean is pending review. `$title` and `$collection` are the
## user's own text; `$provider` is a provider's name, never translated.

research-helper-menu-collection-summarize-all =
    .label = Summarize All Papers in Collection
research-helper-menu-collection-remove-notes =
    .label = Remove Generated Notes from Collection…
research-helper-summarize-title = Research Helper — Summarize Collection
research-helper-summarize-collection =
    { $count ->
        [one] { $name } — 1 paper
       *[other] { $name } — { $count } papers
    }
research-helper-summarize-resummarize =
    .label = Re-summarize existing summaries
research-helper-summarize-write-notes =
    .label = Save a summary note on each paper
research-helper-summarize-notes-readonly = This library is read-only, so no notes can be saved. Use Export Summaries… after the run instead.
research-helper-summarize-start =
    .label = Summarize
research-helper-summarize-cancel =
    .label = Cancel
research-helper-summarize-close =
    .label = Close
research-helper-summarize-export =
    .label = Export Summaries…
research-helper-summarize-stage =
    { $stage ->
        [loading] Reading the collection…
        [planning] Reading each paper's text…
        [estimating] Estimating the cost…
        [confirming] Waiting for your confirmation…
        [waiting] Paused — waiting for your answer.
        [writing] Saving notes…
        [done] Finished.
       *[summarizing] Summarizing papers
    }
research-helper-summarize-progress = { $done } / { $total } ({ $cached } cached, { $fresh } new)
research-helper-summarize-remaining =
    { $minutes ->
        [0] Less than a minute remaining
        [one] About 1 minute remaining
       *[other] About { $minutes } minutes remaining
    }
research-helper-summarize-row =
    { $status ->
        [done] ✓ { $title }
        [cached] ✓ { $title } (cached)
        [running] ⟳ { $title }
        [failed] ⚠ { $title } — failed
        [skipped-existing] · { $title } — already summarized, skipped
        [skipped-no-text] ⚠ { $title } — no abstract or full text, skipped
        [skipped-retracted] ⚠ { $title } — retracted, skipped
        [skipped-duplicate] · { $title } — a duplicate in this collection, skipped
        [skipped-language] · { $title } — not in English, skipped
       *[queued] · { $title }
    }
research-helper-summarize-counts = Full text used: { $fulltext } · Fell back to abstract: { $abstract } · Skipped, no text: { $notext } · Skipped, retracted: { $retracted } · Skipped, duplicate: { $duplicate }
research-helper-summarize-outcome =
    { $outcome ->
        [cancelled] Cancelled at { $at }/{ $total }. Every summary already made is kept.
        [declined] Nothing was sent.
        [stopped-outage] Stopped after { $failed } papers failed — more than 30 % of those tried. The provider may be down or the key may not work. Every summary already made is kept.
        [failed] The run stopped because of an error. Every summary already made is kept.
        [nothing] Every paper here already has a summary. Tick “Re-summarize existing summaries” to make them again.
        [unavailable] Research Helper's database is not open, so no summary can be stored. Nothing was sent.
       *[succeeded] Finished: { $done } of { $total } papers summarized, { $failed } failed, { $notes } notes saved.
    }
research-helper-summarize-key-needed = No API key for { $provider } is available. Add it in Research Helper's preferences, then press Continue. Nothing has been sent.
research-helper-summarize-continue =
    .label = Continue
research-helper-summarize-stop =
    .label = Stop
research-helper-summarize-export-outcome =
    { $outcome ->
        [written] The summaries were saved to the file you chose.
       *[failed] The summaries could not be saved to that file.
    }
research-helper-remove-notes-title = Remove Generated Notes
research-helper-remove-notes-confirm =
    { $count ->
        [one] Move 1 note generated by Research Helper in “{ $collection }” to the trash? Only notes tagged research_helper/… are affected; your own notes are not touched.
       *[other] Move { $count } notes generated by Research Helper in “{ $collection }” to the trash? Only notes tagged research_helper/… are affected; your own notes are not touched.
    }
research-helper-remove-notes-none = No notes generated by Research Helper were found in “{ $collection }”.
research-helper-remove-notes-done =
    { $count ->
        [one] 1 note was moved to the trash.
       *[other] { $count } notes were moved to the trash.
    }


## The egress disclosure's two notices (P3-T15; docs/09 §3.6)
##
## Data the cost dialog (P3-T16) embeds; never a second dialog. The first-job
## notice is shown while `privacy.egressAcknowledged` is false and suppresses
## nothing once acknowledged. The Gemini warning is docs/09 §3.6 item 3's text,
## verbatim (edit docs/09 first): shown on every job whose Gemini key's tier is
## free or unknown, with no way to turn it off.

research-helper-egress-first-job-notice = Research Helper runs on your computer, uses your own API key, and sends nothing to its authors. That does not keep your material private from the provider: the content listed above leaves your computer for the provider you chose, which handles it under its own terms. Confirming records that you have read this notice. It does not turn off this dialog or any warning in it.
research-helper-egress-gemini-free-tier = This Google API key appears to be on the free tier. Google's terms state that content you send on the unpaid tier is used to improve Google products, and that human reviewers may read it. Do not use the free tier for unpublished or confidential material.
# The reminder that replaces the Gemini warning when the user has declared the
# key paid (gemini.paidTier; owner, 2026-10-22, plan/00 §6 item 269(b)). It is
# docs/09 §3.6 item 3's extension, verbatim (edit docs/09 first), and is shown
# on every such job, with no way to turn it off.
research-helper-egress-gemini-declared-paid = This Google API key is marked as a paid key in Research Helper's settings. If it is actually on the free tier, Google may use the content you send to improve its products.


## The cost confirmation dialog and the Usage readout (P3-T16; docs/06 §5.4,
## docs/10 FR-24, docs/09 §3.6, docs/06 §11.4)
##
## The dialog is `addon/content/costConfirm.xhtml`; every id is placed by
## `addon/content/costConfirm.js` from the model `src/ui/dialogs/costConfirmDialog.ts`
## builds (`COST_DIALOG_L10N`). Money, token counts and dates arrive formatted
## with Intl over the application locale (docs/08 §10.3): `$cost`, `$limit`,
## `$spent`, `$raised`, `$threshold`, `$tokens`, `$input`, `$output`, `$date`
## are strings. `$ceiling` is `run` or `session` and `$mode` is `strict`,
## `balanced` or `full`, both selectors only. `$provider`, `$host` and `$model`
## are names, never translated. FR-24 requires the words "estimate; actual cost
## may differ"; the egress notices of the section above are shown in the same
## dialog, never in a second one.

research-helper-cost-title = Research Helper — estimated cost
research-helper-cost-items = Papers: { $items } · with full text: { $fullText } · abstract only: { $abstract } · already summarized: { $cached } · no text to send: { $metadata }
research-helper-cost-destination =
    Sent to { $provider } at { $host }, model { $model }. Privacy mode: { $mode ->
        [strict] Strict
        [full] Full
       *[balanced] Balanced
    }.
research-helper-cost-calls =
    { $calls ->
        [one] 1 call to the model
       *[other] { $calls } calls to the model
    }
research-helper-cost-input = Estimated input: about { $tokens } tokens
research-helper-cost-output = Estimated output: up to { $tokens } tokens
research-helper-cost-total = Estimated cost: about { $cost }
research-helper-cost-unpriced = The price of { $model } is not known, so this run's cost cannot be estimated.
research-helper-cost-disclaimer = This is an estimate; actual cost may differ. Prices as of { $date }.
research-helper-cost-above-threshold = This is above your { $threshold } confirmation threshold.
research-helper-cost-acknowledge =
    .label = I understand this run may cost about { $cost }.
research-helper-cost-acknowledge-unpriced =
    .label = I understand that the cost of this run is not known.
research-helper-cost-downgrade =
    .label = Use abstracts instead (about { $cost })
research-helper-cost-downgrade-preselected = This run has more than { $max } papers, so abstracts are selected. Clear the box to send full text.
research-helper-cost-ceiling-preflight =
    { $ceiling ->
        [session] This estimate would pass your spending limit for this Zotero session, { $limit }, of which { $spent } is already spent. Running raises that limit to { $raised } for this run only.
       *[run] This estimate would pass your spending limit per run, { $limit }. Running raises that limit to { $raised } for this run only.
    }
research-helper-cost-ceiling-reached =
    { $ceiling ->
        [session] Paused at your spending limit for this Zotero session, { $limit }. { $spent } is spent so far this session, and every summary already made is kept. Continue raises the limit to { $raised } for this run only.
       *[run] Paused at your spending limit per run, { $limit }. { $spent } is spent so far in this run, and every summary already made is kept. Continue raises the limit to { $raised } for this run only.
    }
research-helper-cost-usage-job =
    This job so far: { $calls ->
        [one] 1 call
       *[other] { $calls } calls
    }, { $input } input and { $output } output tokens, { $cost }.
research-helper-cost-usage-session =
    This Zotero session: { $calls ->
        [one] 1 call
       *[other] { $calls } calls
    }, { $input } input and { $output } output tokens, { $cost }.
research-helper-cost-usage-estimated = Some of these figures are estimates, because a provider did not report its usage or a price was not known.
research-helper-cost-dont-ask =
    .label = Don't ask again for this collection
research-helper-cost-run =
    .label = Run
research-helper-cost-cancel =
    .label = Cancel
research-helper-cost-continue =
    .label = Continue
research-helper-cost-stop =
    .label = Stop
# The job's progress line when the dialog did not open (docs/09 §3.6's dated
# note of 2026-10-23): the number is still shown.
research-helper-cost-skipped-notice =
    Estimated cost: about { $cost } for { $calls ->
        [one] 1 call
       *[other] { $calls } calls
    }. This is an estimate; actual cost may differ.
# The preference pane's Usage section (P3-T16 step 6). The session's figures
# reuse research-helper-cost-usage-session above.
research-helper-prefs-usage = Usage
research-helper-prefs-usage-limit = Spending limit for this Zotero session: { $limit }. It resets when Zotero restarts.
research-helper-prefs-usage-limit-off = No spending limit is set for this Zotero session.


## The trend report's lines in the cost dialog, and its own egress notice
## (P4-T16; docs/06 §5.2, §5.4; docs/09 §3 row 3b; docs/07 §4.5's note of
## 2026-10-27)
##
## Shown in the same cost dialog as the two sections above, never in a second
## one; built by `src/ui/dialogs/costConfirmDialog.ts` (`REPORT_COST_L10N`).
## `$calls`, `$themes` and `$papers` are numbers. `$model` is a model ID and
## `$models` a list of model IDs already joined with Intl.ListFormat over the
## application locale (docs/08 §10.3): names, never translated. "Up to": the
## counts include calls the run makes only when an earlier answer asks for
## them (a rewrite after a check, a later check round, a theme too large for
## one call). Korean pending review (G-41).

research-helper-egress-report-notice =
    To write the report, the summaries of { $papers ->
        [one] 1 paper
       *[other] { $papers } papers
    }, with their titles, years and venues and statistics about the themes they fall into, are sent to { $models }. The papers themselves are not sent again.
research-helper-cost-report-summaries =
    { $calls ->
        [one] Summaries still to make: 1 call to { $model }.
       *[other] Summaries still to make: { $calls } calls to { $model }.
    }
research-helper-cost-report-writing =
    { $calls ->
        [one] Grouping the papers into up to { $themes } themes and writing the report: up to 1 call to { $model }.
       *[other] Grouping the papers into up to { $themes } themes and writing the report: up to { $calls } calls to { $model }.
    }
research-helper-cost-report-review =
    { $calls ->
        [one] Checking the report against the summaries: up to 1 call to { $model }.
       *[other] Checking the report against the summaries: up to { $calls } calls to { $model }.
    }


## The LLM Test, the model suggestions and the user price table (P3-T14;
## docs/09 §2.3, docs/03 §9, plan/00 §6 item 265(b))
##
## Placed by `addon/content/preferences.js`. `$time` and `$date` arrive
## formatted with Intl over the application locale, and the four prices with
## Intl.NumberFormat (docs/08 §10.3). `$provider` is a provider's display name
## and `$model` a model ID: names, never translated. No message takes any part
## of a key.

# docs/09 §2.3: an HTTP 429 on the Test call means the key was accepted.
research-helper-prefs-test-ok-rate-limited = Key accepted. The provider is limiting requests right now (HTTP 429) · checked { $time }
# The Test was answered "out of credit" (a spend cap: OpenAI's insufficient_quota,
# Anthropic's spend limit, OpenRouter's 402): the key itself was accepted (owner,
# 2026-10-23, plan/00 §6 item 279(a)).
research-helper-prefs-test-ok-no-credit = Key accepted, but the account has no credit left · checked { $time }
# The first, empty item of each provider's model-suggestion list.
research-helper-prefs-model-suggestions =
    .label = Choose a suggested model…
research-helper-prefs-models-as-of = Suggestions from the provider's model list as of { $date }. You can also type any model ID.
research-helper-prefs-models-stale = The live model list could not be fetched. These suggestions are the built-in list of { $date } and may be out of date. You can also type any model ID.
research-helper-prefs-prices = Your model prices
research-helper-prefs-prices-note = A price you enter here replaces the catalogue's price for that model when Research Helper estimates a cost. Enter US dollars per million tokens and the date you read the price. A new row is saved for the provider chosen above.
research-helper-prefs-price-row = { $provider } · { $model }: input { $input }, output { $output }, cached input { $cached } US dollars per million tokens · as of { $date }
research-helper-prefs-price-row-no-cached = { $provider } · { $model }: input { $input }, output { $output } US dollars per million tokens · as of { $date }
research-helper-prefs-price-model =
    .placeholder = Model ID
research-helper-prefs-price-input =
    .placeholder = Input price
research-helper-prefs-price-output =
    .placeholder = Output price
research-helper-prefs-price-cached =
    .placeholder = Cached input price (optional)
research-helper-prefs-price-as-of =
    .placeholder = As of (YYYY-MM-DD)
research-helper-prefs-price-save = Save price
research-helper-prefs-price-remove = Remove
research-helper-prefs-price-saved = Price saved.
research-helper-prefs-price-removed = Price removed.
research-helper-prefs-price-invalid = Not saved: enter a model ID, input and output prices of zero or more (such as 0.25), and a date such as 2026-10-23.
research-helper-prefs-price-refused = Not saved: this row cannot be stored. Check that the model field holds a model name, not an API key.
research-helper-prefs-price-unavailable = The plugin database is not available, so prices cannot be saved.


## The key-storage degradation dialog (P3-T03; docs/09 §1.7, gate G-10)
##
## Shown at startup when the operating system's credential store fails the
## probe. It offers session-only storage with its cost, or running without
## stored keys; it never chooses for the user, and there is no third option
## (tier 3, the passphrase file, does not ship in v1). The document is
## `addon/content/secretBackend.xhtml`. `-title` and the two button labels are
## formatted by `addon/content/secretBackend.js`, because XUL carries them in
## attributes; the other three are `data-l10n-id`s in the document.

research-helper-secret-backend-title = Research Helper cannot save API keys on this computer
research-helper-secret-backend-explain = Research Helper keeps API keys only in your operating system's credential store, and that store could not be used. Keys are never saved anywhere else. Choose how to continue.
research-helper-secret-backend-session = Keep keys for this session only. They are held in memory and written nowhere. You will enter them again each time Zotero starts, and background tasks that need a key stop until you do.
research-helper-secret-backend-none = Continue without stored keys. Searching and importing still work, more slowly without an NCBI key. Summaries and other features that need a key stay off.
research-helper-secret-backend-accept =
    .label = Keep keys for this session
research-helper-secret-backend-decline =
    .label = Continue without keys


## The item pane's AI summary section (P3-T28; docs/08 §3)
##
## Drawn in the library item pane and in the reader's context pane. The body's
## buttons are `html:button`s, so their messages carry a value, not `.label`
## (docs/08 §10.2's note of 2026-10-29); the header takes `.label`, the side
## navigation and the two section buttons `.tooltiptext`, as Zotero's own
## sections do. Everything the section shows from a stored summary is model
## output, set as text by `src/ui/panes/summarySection.ts`; no message here
## takes it as an argument.

research-helper-itempane-header =
    .label = Research Helper
research-helper-itempane-sidenav =
    .tooltiptext = Research Helper summary
research-helper-itempane-empty = No summary yet for this item.
research-helper-itempane-generate = Generate summary
research-helper-itempane-loading = Summarizing…
research-helper-itempane-cancel = Cancel
research-helper-itempane-failed = The summary could not be generated.
research-helper-itempane-retry = Retry
research-helper-itempane-no-key = No LLM API key configured. Add a key for OpenRouter, OpenAI, Gemini, or Anthropic to enable summaries.
research-helper-itempane-open-preferences = Open Preferences…
research-helper-itempane-research-question = Research question
research-helper-itempane-key-findings = Key findings
research-helper-itempane-limitations = Limitations
research-helper-itempane-btn-regenerate =
    .tooltiptext = Regenerate summary
research-helper-itempane-btn-save-note =
    .tooltiptext = Save summary as a child note

## The item pane's result lines (plan/00 §6 item 303(a), (b); docs/08 §3.2's
## note of 2026-10-29). `$reason` is a selector.

research-helper-itempane-not-summarized =
    { $reason ->
        [no-text] This item has no abstract or full text to summarize, so nothing was sent.
        [retracted] This item is marked as retracted, so it was not summarized.
        [language] This item is not in English, so it was not summarized.
        [existing] This item already has a summary note. Use Regenerate to summarize it again.
        [no-key] No API key is available for the AI provider. Add it in Research Helper's preferences, then press Retry. Nothing was sent.
        [time-limit] The run reached its time limit and was stopped before the summary was stored. Press Retry to try again.
       *[other] The run stopped before a summary was stored.
    }
research-helper-itempane-note-not-written =
    { $reason ->
        [read-only] This library is read-only, so the summary was not saved as a note.
       *[exists] This item already has a summary note, so no second note was written.
    }

## The trend report run's stop for too many themes (P4-T05; plan/00 §6 item
## 292(d); docs/12 §8). The run's estimate reserved theme calls for at most
## `$max` themes, so a clustering answer over it, asked for once more and still
## over, ends the run. `$themes` and `$max` are numbers, `$themes` always the
## larger and both at least 5 in a real run, so neither needs a plural
## selector. Korean reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item
## 307(f)).

research-helper-report-stopped-too-many-themes = The report was stopped before it was written: asked twice, the model grouped the papers into { $themes } themes, more than the { $max } this run's cost was confirmed for. Every summary already made is kept.

## The trend report run's stop when no theme is left (P4-T05; plan/00 §6 item
## 307(c); docs/12 §8). Every theme the clustering answer made, the
## client-generated `Other` included, fell below MIN_PAPERS_PER_THEME and was
## dropped, so the run ends before anything is written. No argument. Korean
## reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item 309(a)).

research-helper-report-stopped-no-themes = The report was stopped before it was written: every theme the model found had too few papers, so no theme was left to write about. Every summary already made is kept.

## The trend report run's stop when the theme merge's input is too large
## (P4-T06; plan/00 §6 item 309(e); docs/12 §20). In two-stage clustering a
## batch answer over its own band is no longer a stop, so the batches' local
## themes can outgrow THEME_MERGE's 60 000-token input budget; the run then ends
## before the merge request and before anything is written. No argument. Korean
## reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item 310(a)).

research-helper-report-stopped-merge-too-large = The report was stopped before it was written: the papers were sorted into themes in several parts, and the themes the parts found were too many, or described at too much length, to combine in one request. Every summary already made is kept.

## The trend report run's stop when no theme could be analysed (P4-T07; plan/00
## §6 item 309(g); docs/12 §9). Every theme of the clustering ended unanalysed,
## so the run ends before anything is written. No argument. Korean reviewed by
## the owner on 2026-10-29 (G-41, plan/00 §6 item 310(a)).

research-helper-report-stopped-no-theme-analysed = The report was stopped before it was written: none of the themes the model found could be analysed, so no theme was left to write about. Every summary already made is kept.

## The trend report run's stop when the report fails the section check twice
## (P4-T08; plan/00 §6 item 311(a); docs/12 §10). The answer, and the one fresh
## generation asked for with the failure named, both lacked the eleven required
## level-2 sections in order, so the run ends before anything is written. No
## argument. Korean pending review (G-41).

research-helper-report-stopped-structure-invalid = The report was stopped before it was written: asked twice, the model did not return the report with its eleven required sections in order, so nothing was saved. Every summary already made is kept.

## The trend report run's stop when more than 30 % of the papers it would
## analyse could not be summarized (P4-T18; docs/06 §8.5's failure policy).
## $failed is the number of papers whose summary failed, $total the papers the
## report would analyse. Korean pending review (G-41).

research-helper-report-stopped-papers-failed = The report was stopped before it was written: { $failed } of { $total } papers could not be summarized, more than 30 percent, which usually means a problem with the API key, the account's credit or the provider. Every summary already made is kept.

## The trend report run's stop when no paper of the collection can be analysed:
## each was excluded (retracted, a duplicate, not in English) or has no abstract
## or full text (P4-T18; docs/07 §12.4). No argument. Korean pending review (G-41).

research-helper-report-stopped-no-papers = The report was stopped before it was written: no paper in this collection can be analysed, because each one was excluded or has no abstract or full text. Nothing was sent.

## Why a both run wrote no Korean report (P4-T21; owner, plan/00 §6 item 334(d);
## docs/08 §6.3). `no-room` is a stop with no report; the others are shown beside
## "Report ready". `$reason` is a token, never displayed.

research-helper-report-stopped-korean =
    { $reason ->
        [no-room] No report was written, and nothing was spent on either report: the Korean report does not fit this model's limits. Every summary already made is kept. To get the English report, choose English under Language and generate again.
        [structure] The English report is saved. The Korean report was not written: asked twice, the model did not return it with its eleven required sections in order. To try again, choose the Korean report under Language and generate.
        [finishing] The English report is saved. The Korean report was written but could not be finished and saved. To try again, choose the Korean report under Language and generate.
       *[request] The English report is saved. The Korean report was not written, because a request to the model failed. To try again, choose the Korean report under Language and generate.
    }

## Shown once when Zotero starts, for report jobs left paused (P4-T21; owner,
## plan/00 §6 item 332(b)). $count is how many collections, $collections their
## names joined by commas. Nothing is sent or spent by showing it.

research-helper-report-paused-notice =
    { $count ->
        [one] A report run for the collection { $collections } is paused and waiting for your answer. Open that collection's report window to continue or stop it. Nothing is spent until you do.
       *[other] { $count } report runs are paused and waiting for your answer, in the collections { $collections }. Open a collection's report window to continue or stop its run. Nothing is spent until you do.
    }

## A recommend run's notice on the cost dialog (P5-T22; docs/09 §3 row 6). $papers
## is how many papers have a line in the request, $model the model it goes to.

research-helper-egress-profile-notice =
    { $papers ->
        [one] To build this collection's profile, metadata only is sent to { $model }: one line for one paper, with its item key, title, year, venue and top subject terms. No abstract, summary, full text, note or collection name is sent.
       *[other] To build this collection's profile, metadata only is sent to { $model }: one line for each of { $papers } papers, with its item key, title, year, venue and top subject terms. No abstract, summary, full text, note or collection name is sent.
    }

## Shown when the model's answer could not be used, or not one line fits the
## model, and the profile stays statistical (P5-T22; docs/12 §15's note, items 4
## and 6). No argument.

research-helper-recommend-profile-unusable = The model could not describe this collection, so its profile comes from the collection's own terms, and the search may find less.

# research_helper — Korean strings injected into Zotero's own main window.
#
# Same file name, same surface and the same identifiers as
# `locale/en-US/research-helper-mainWindow.ftl`; read that file's header for
# the placement rule, the prefix rules and the `rh-error-*` exception
# (`docs/01` §9.1, §9.3). The locale code is `ko-KR` exactly — there is no
# bare `ko` (`docs/08` §10.1).
#
# ## This bundle is INCOMPLETE, and that is the current state of the card
#
# `P1-T18` carries a **human gate**: a native Korean speaker must review this
# bundle, and an agent may draft it but must not sign it off. No string below
# was machine-translated. What is present is only what an owner has already
# supplied or what must not be translated at all:
#
# * `research-helper-menu-root` and `research-helper-menu-search-import` —
#   taken verbatim from `docs/08` §10.2, which ships owner-written Korean for
#   them. `"리서치 헬퍼"` is measured working on Zotero 10.0.1 (`P0-T24`).
# * `research-helper-source-pubmed` — `docs/08` §10.3 forbids translating a
#   database name, so the Korean bundle carries it unchanged. Not a
#   translation, and nothing for a reviewer to decide.
#
# **Every other identifier in the en-US bundle is listed below as a comment,
# with its English source, and needs a native speaker.** Until then a Korean UI
# resolves them from `en-US` through the second fallback layer Gecko's
# `Localization` provides along the app-locale chain — measured, not assumed
# (`docs/01` §9.1, `P0-T24`). That is a visible gap, which is the point: a
# plausible-looking wrong translation is worse than English.
#
# `src/i18n/keys.ts` exports the pending list as `KO_PENDING_REVIEW` and
# `test/integration/l10n.spec.ts` asserts that the messages actually missing
# from this file are exactly that list — so a new en-US string cannot be added
# without either a Korean entry or an explicit entry on the review list.
#
# ## One key is absent permanently, not pending
#
# `research-helper-menu-spike-create-item` exists in `en-US` and is absent here
# **on purpose**, so that `FR-55`'s English fallback for a missing key stays
# observable. `test/integration/l10n.spec.ts` asserts both that it is absent
# from this bundle and that it still resolves to the English label under a
# Korean UI (spike `V-17`, `P0-T24`). It is on `KO_DELIBERATELY_ABSENT`, not on
# the review list. Do not "fix" the gap without moving the fallback assertion
# to another key.


## Tools ▸ Research Helper, and the collection context menu (docs/08 §2.4, §2.5)

research-helper-menu-root =
    .label = 리서치 헬퍼

research-helper-menu-search-import =
    .label = 검색 및 가져오기…

# NEEDS REVIEW. en-US: "Search & Import into This Collection…"
# `docs/08` §10.2 supplies no Korean for this entry, and the id itself is new
# (see the en-US bundle's note on the §2.4/§2.5 gap).
# research-helper-menu-collection-search-import =
#     .label =


## Literature source display names — never translated (docs/08 §10.3)

research-helper-source-pubmed = PubMed


## Search provenance (FR-8)
##
# NEEDS REVIEW. en-US: "Research Helper — search provenance { $timestamp }"
# FR-8 fixes the *English* title format literally. Whether a Korean UI should
# write a Korean note title at all, or keep FR-8's exact English string so the
# notes of one library stay greppable, is an owner decision and not a
# translator's — reported with the gate.
# research-helper-provenance-note-title =


## Import outcome (docs/08 §4.4, FR-51)
##
# NEEDS REVIEW. en-US: "Imported { $imported } · Linked { $linked } · Skipped
# { $skipped } duplicates · { $failed } failed"
# research-helper-import-summary =
#
# NEEDS REVIEW. en-US: "Abstracts present for { $percent }% of imported items"
# research-helper-import-abstract-coverage =
#
# NEEDS REVIEW. en-US: "Research Helper"
# The toast header is the product name. `docs/08` §10.2 renders the product
# name as `리서치 헬퍼` in menu labels, so this one probably follows — but it is
# the same owner decision as the note title above, so it is not drafted here.
# research-helper-import-toast-header =


## User-facing error strings — `ResearchHelperError.messageKey`
##
## All sixteen need a native speaker. Their ids are fixed by
## `src/core/errors.ts` and carry the `rh-error-` prefix, not
## `research-helper-` — see the en-US bundle's note on that conflict.
##
## `docs/08` §10.3 applies to every one of them: do not translate a provider
## name, a database name or a model ID, and never reorder by concatenating
## fragments — each is a single message with placeables, and Korean word order
## may place them differently from English, which is exactly why a translator
## rather than a substitution is needed.
##
# NEEDS REVIEW. en-US: "Research Helper is not configured correctly for this action."
# rh-error-configuration =
#
# NEEDS REVIEW. en-US: "No API key configured for { $provider }."
# rh-error-missing-credential =
#
# NEEDS REVIEW. en-US: "Could not reach { $host }."
# rh-error-network =
#
# NEEDS REVIEW. en-US: "Zotero is offline."
# rh-error-offline =
#
# NEEDS REVIEW. en-US: "{ $host } did not respond within { $seconds }s."
# rh-error-timeout =
#
# NEEDS REVIEW. en-US: "{ $provider } rejected the API key (HTTP { $status })."
# rh-error-auth =
#
# NEEDS REVIEW. en-US: "{ $provider } refused the request (HTTP { $status })."
# rh-error-forbidden =
#
# NEEDS REVIEW. en-US: "{ $provider } rate limit reached. Retrying in { $seconds }s."
# rh-error-rate-limit =
#
# NEEDS REVIEW. en-US: "{ $provider } reports the account is out of credit."
# rh-error-quota =
#
# NEEDS REVIEW. en-US: "{ $database } is temporarily unavailable (HTTP { $status }). Other databases were still searched."
# rh-error-upstream =
#
# NEEDS REVIEW. en-US: "Research Helper sent a request { $database } could not accept."
# rh-error-bad-request =
#
# NEEDS REVIEW. en-US: "{ $database } could not complete the search."
# rh-error-source =
#
# NEEDS REVIEW. en-US: "Could not read the response from { $database }."
# rh-error-parse =
#
# NEEDS REVIEW. en-US: "Zotero could not complete the change."
# rh-error-zotero =
#
# NEEDS REVIEW. en-US: "Research Helper could not write to storage."
# rh-error-storage =
#
# NEEDS REVIEW. en-US, a `{ $imported }` selector: "Cancelled. 1 item was
# already imported." / "Cancelled. { $imported } items were already imported."
# Korean has a single plural category, so the Korean entry keeps the selector
# with only `*[other]` (`docs/08` §10.2's note, §10.3).
# rh-error-cancelled =

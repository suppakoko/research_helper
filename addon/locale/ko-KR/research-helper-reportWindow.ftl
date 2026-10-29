# research_helper — Korean strings for the report window.
#
# Same file name, same surface and the same identifiers as
# `locale/en-US/research-helper-reportWindow.ftl`; read that file's header for
# the placement rule and the attribute each entry sets (`docs/01` §9.1, §9.3,
# `docs/08` §10.1).
#
# ## This bundle carries NO message yet, and that is the human gate
#
# `G-41`: a native Korean speaker reviews every `ko-KR` string, and an agent
# may draft one but must not sign it off. Nothing here was machine-translated.
# `docs/08` §10.2 ships no Korean for this surface, so every identifier of the
# en-US bundle is listed below as a commented stub with its English source, and
# all ten are on `KO_PENDING_REVIEW` in `src/i18n/keys.ts` (`P4-T19`, plan/00 §6
# item 306(b): the coordinator drafts their Korean for the owner). Until then a
# Korean UI shows this window in English, resolved from `en-US` through the
# per-message fallback Gecko's `Localization` walks along the app-locale chain
# (`docs/01` §9.1, `P0-T24`).
#
# The file exists although it holds no message, so that Zotero registers a
# `ko-KR` file for this surface (`docs/01` §9.1: fallback is chosen per file,
# per locale) and `test/integration/l10n.spec.ts` can state the gap exactly.

## P4-T19: the report window — NEEDS REVIEW (G-41)
##
# NEEDS REVIEW research-helper-report-title — en-US: Research Helper — Collection Report
# NEEDS REVIEW research-helper-report-collection — en-US: [one] { $name } — 1 paper / *[other] { $name } — { $count } papers
# NEEDS REVIEW research-helper-report-language-label — en-US: .value = Language
# NEEDS REVIEW research-helper-report-language-auto — en-US: .label = Same as Zotero's language
# NEEDS REVIEW research-helper-report-language-en — en-US: .label = English
# NEEDS REVIEW research-helper-report-language-ko — en-US: .label = 한국어
# NEEDS REVIEW research-helper-report-language-both — en-US: .label = English and Korean
# NEEDS REVIEW research-helper-report-model — en-US: Model: { $model } ({ $provider }) — set in Research Helper's preferences.
# NEEDS REVIEW research-helper-report-model-none — en-US: No report model is set. Choose an AI provider and its model in Research Helper's preferences.
# NEEDS REVIEW research-helper-report-close — en-US: .label = Close

# research_helper — Korean strings for the report window.
#
# Same file name, same surface and the same identifiers as
# `locale/en-US/research-helper-reportWindow.ftl`; read that file's header for
# the placement rule and the attribute each entry sets (`docs/01` §9.1, §9.3,
# `docs/08` §10.1).
#
# ## The human gate, cleared for these ten
#
# `G-41`: a native Korean speaker reviews every `ko-KR` string, and an agent
# may draft one but must not sign it off. Nothing here was machine-translated.
# `docs/08` §10.2 ships no Korean for this surface. Until 2026-10-29 every
# identifier of the en-US bundle was listed here as a commented stub with its
# English source and was on `KO_PENDING_REVIEW` in `src/i18n/keys.ts`
# (`P4-T19`, plan/00 §6 item 306(b)). The coordinator drafted the Korean and
# the owner approved it as drafted (plan/00 §6 item 307(f)); the ten messages
# below are inserted byte for byte from plan/reports/ko-review-307.ftl, and all
# ten are on `KO_PRESENT`. A message `P4-T20` adds goes here as a commented
# stub until its Korean is reviewed.

## P4-T19: the report window (plan/00 §6 item 306(b))
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-29 (G-41, plan/00 §6 item 307(f)).

research-helper-report-title = Research Helper — 컬렉션 보고서
research-helper-report-collection = { $name } — 논문 { $count }편
research-helper-report-language-label =
    .value = 언어
research-helper-report-language-auto =
    .label = Zotero 언어와 같게
research-helper-report-language-en =
    .label = English
research-helper-report-language-ko =
    .label = 한국어
research-helper-report-language-both =
    .label = 영어와 한국어 모두
research-helper-report-model = 모델: { $model } ({ $provider }) — Research Helper 설정에서 정합니다.
research-helper-report-model-none = 보고서 모델이 정해져 있지 않습니다. Research Helper 설정에서 AI 제공자와 모델을 고르세요.
research-helper-report-close =
    .label = 닫기

## P4-T20: the run — NEEDS REVIEW (G-41)
##
# Commented stubs: each id is on KO_PENDING_REVIEW in src/i18n/keys.ts until its
# Korean is reviewed; nothing here was machine-translated.
# NEEDS REVIEW research-helper-report-generate — en-US: .label = Generate report
# NEEDS REVIEW research-helper-report-cancel — en-US: .label = Cancel
# NEEDS REVIEW research-helper-report-save-note — en-US: .label = Save as note
# NEEDS REVIEW research-helper-report-export — en-US: .label = Export Markdown…
# NEEDS REVIEW research-helper-report-copy — en-US: .label = Copy
# NEEDS REVIEW research-helper-report-continue — en-US: .label = Continue
# NEEDS REVIEW research-helper-report-stop — en-US: .label = Stop
# NEEDS REVIEW research-helper-report-group-save — en-US: .label = Save in the group
# NEEDS REVIEW research-helper-report-group-skip — en-US: .label = Don't save
# NEEDS REVIEW research-helper-report-stage — en-US: { $stage -> [reading] Reading the collection… [confirming] Waiting for your confirmation… [summaries] Summarizing papers… [themes] Finding and analysing themes… [writing] Writing the report… [reviewing] Reviewing the draft… [finishing] Adding tables and references, and saving… [waiting] Paused — waiting for your answer. *[done] Done. }
# NEEDS REVIEW research-helper-report-row-reading — en-US: Read the collection and estimate the cost
# NEEDS REVIEW research-helper-report-row-summaries — en-US: Summaries: { $made } new and { $cached } from the cache, of { $toMake } to make; { $failed } failed
# NEEDS REVIEW research-helper-report-row-themes — en-US: Themes: { $done } of { $total } analysed
# NEEDS REVIEW research-helper-report-row-writing — en-US: Write the report
# NEEDS REVIEW research-helper-report-row-review — en-US: { $round -> [0] Review the draft *[other] Review the draft — revision { $round } }
# NEEDS REVIEW research-helper-report-row-finishing — en-US: Add tables and references, and save
# NEEDS REVIEW research-helper-report-spend — en-US: Spent so far in this run: { $cost }
# NEEDS REVIEW research-helper-report-preview-label — en-US: { $state -> [draft] Draft — the text may still change [final] The report *[discarded] The draft was discarded; nothing was saved. }
# NEEDS REVIEW research-helper-report-outcome — en-US: { $outcome -> [succeeded] Report ready. [cancelled] Cancelled. The report was discarded; every summary already made is kept. [declined] Nothing was sent. [interrupted] Zotero is closing. The run will continue from where it stopped the next time Zotero starts. [unavailable] The collection or the report run is not available. *[failed] The report could not be generated. Every summary already made is kept. }
# NEEDS REVIEW research-helper-report-note — en-US: { $state -> [written] Saved as a note in this collection. [export-only] This library cannot be written to, so no note was saved. Use Export Markdown or Copy. [no-collection] The collection is gone, so no note was saved. Use Export Markdown or Copy. [declined] Not saved in the group library. [off] Not saved as a note. *[failed] The note could not be saved. }
# NEEDS REVIEW research-helper-report-group-question — en-US: Save this report as a note in the group library “{ $group }”? Everyone in the group will be able to read it.
# NEEDS REVIEW research-helper-report-export-outcome — en-US: { $outcome -> [written] Exported. [invalid-report] The report could not be exported: its citations and references do not agree. *[failed] The file could not be written. }
# NEEDS REVIEW research-helper-report-copied — en-US: Copied to the clipboard.
# NEEDS REVIEW research-helper-report-key-needed — en-US: No API key for { $provider } is available. Add it in Research Helper's preferences, then press Continue. Everything done so far is kept.
# NEEDS REVIEW research-helper-report-paused-job — en-US: { $reason -> [budget-stop] A report run for this collection was paused at a spending limit. [awaiting-confirmation] A report run for this collection was paused until you confirm what the rest will cost. [egress-unacknowledged] A report run for this collection was paused until you confirm where its data is sent. [credential-required] A report run for this collection was paused because no API key was available. [wall-clock-budget] A report run for this collection was paused at its time limit. *[other] A report run for this collection was paused. } Everything it had done is kept. Continue it, or stop it?

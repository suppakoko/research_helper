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

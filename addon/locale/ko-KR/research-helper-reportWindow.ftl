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
# ten are on `KO_PRESENT`. `P4-T20`'s twenty-five followed on 2026-11-02, byte
# for byte from plan/reports/ko-review-333.ftl (plan/00 §6 item 333). A message a
# later card adds goes here as a commented stub until its Korean is reviewed.

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

## P4-T20: the run (plan/00 §6 item 333)
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-11-02 (G-41, plan/00 §6 item 333).

research-helper-report-generate =
    .label = 보고서 만들기
research-helper-report-cancel =
    .label = 취소
research-helper-report-save-note =
    .label = 노트로 저장
research-helper-report-export =
    .label = Markdown으로 내보내기…
research-helper-report-copy =
    .label = 복사
research-helper-report-continue =
    .label = 계속
research-helper-report-stop =
    .label = 중지
research-helper-report-group-save =
    .label = 그룹에 저장
research-helper-report-group-skip =
    .label = 저장하지 않기
research-helper-report-stage =
    { $stage ->
        [reading] 컬렉션을 읽는 중…
        [confirming] 확인을 기다리는 중…
        [summaries] 논문을 요약하는 중…
        [themes] 주제를 찾아 분석하는 중…
        [writing] 보고서를 쓰는 중…
        [reviewing] 초안을 검토하는 중…
        [finishing] 표와 참고문헌을 넣고 저장하는 중…
        [waiting] 일시 중지됨 — 답을 기다리고 있습니다.
       *[done] 끝났습니다.
    }
research-helper-report-row-reading = 컬렉션 읽기와 비용 추정
research-helper-report-row-summaries = 요약: 만들 { $toMake }편 가운데 새로 { $made }편, 캐시에서 { $cached }편; 실패 { $failed }편
research-helper-report-row-themes = 주제: { $total }개 가운데 { $done }개 분석
research-helper-report-row-writing = 보고서 쓰기
research-helper-report-row-review =
    { $round ->
        [0] 초안 검토
       *[other] 초안 검토 — { $round }차 수정
    }
research-helper-report-row-finishing = 표와 참고문헌 넣기, 저장
research-helper-report-spend = 이번 실행에서 지금까지 쓴 금액: { $cost }
research-helper-report-preview-label =
    { $state ->
        [draft] 초안 — 내용이 바뀔 수 있습니다
        [final] 보고서
       *[discarded] 초안을 버렸고 아무것도 저장하지 않았습니다.
    }
research-helper-report-outcome =
    { $outcome ->
        [succeeded] 보고서가 준비되었습니다.
        [cancelled] 취소했습니다. 보고서는 버렸고 이미 만든 요약은 모두 남아 있습니다.
        [declined] 아무것도 보내지 않았습니다.
        [interrupted] Zotero가 닫히고 있습니다. 다음에 Zotero를 시작하면 멈춘 곳부터 이어서 실행합니다.
        [unavailable] 컬렉션이나 보고서 실행을 사용할 수 없습니다.
       *[failed] 보고서를 만들지 못했습니다. 이미 만든 요약은 모두 남아 있습니다.
    }
research-helper-report-note =
    { $state ->
        [written] 이 컬렉션에 노트로 저장했습니다.
        [export-only] 이 라이브러리에는 쓸 수 없어 노트를 저장하지 않았습니다. Markdown으로 내보내거나 복사하세요.
        [no-collection] 컬렉션이 없어져 노트를 저장하지 않았습니다. Markdown으로 내보내거나 복사하세요.
        [declined] 그룹 라이브러리에 저장하지 않았습니다.
        [off] 노트로 저장하지 않았습니다.
       *[failed] 노트를 저장하지 못했습니다.
    }
research-helper-report-group-question = 이 보고서를 그룹 라이브러리 “{ $group }”에 노트로 저장할까요? 그룹의 모든 사람이 읽을 수 있습니다.
research-helper-report-export-outcome =
    { $outcome ->
        [written] 내보냈습니다.
        [invalid-report] 보고서를 내보내지 못했습니다. 인용과 참고문헌이 맞지 않습니다.
       *[failed] 파일을 쓰지 못했습니다.
    }
research-helper-report-copied = 클립보드에 복사했습니다.
research-helper-report-key-needed = { $provider }의 API 키가 없습니다. Research Helper 설정에서 키를 추가한 뒤 '계속'을 누르세요. 지금까지 한 작업은 모두 남아 있습니다.
research-helper-report-paused-job =
    { $reason ->
        [budget-stop] 이 컬렉션의 보고서 실행이 지출 한도에 도달해 일시 중지되었습니다.
        [awaiting-confirmation] 이 컬렉션의 보고서 실행이 남은 비용을 확인할 때까지 일시 중지되었습니다.
        [egress-unacknowledged] 이 컬렉션의 보고서 실행이 데이터를 보낼 곳을 확인할 때까지 일시 중지되었습니다.
        [credential-required] 이 컬렉션의 보고서 실행이 API 키가 없어 일시 중지되었습니다.
        [wall-clock-budget] 이 컬렉션의 보고서 실행이 시간 제한에 걸려 일시 중지되었습니다.
       *[other] 이 컬렉션의 보고서 실행이 일시 중지되었습니다.
    } 지금까지 한 작업은 모두 남아 있습니다. 계속할까요, 중지할까요?

# Korean drafted by the coordinator and reviewed by the owner on 2026-11-02 (G-41, plan/00 §6 item 334).
research-helper-report-shown-label =
    .value = 표시할 보고서

## P6-T17: the audio section (docs/08 §6.4's note of 2026-11-17). Commented
## stubs with the English source and the coordinator's drafts (2026-11-17, not
## adopted); the owner reviews them (G-41). Until then these resolve from
## en-US.

# research-helper-report-audio-heading
# English source:
#   Audio (spoken report)
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-heading = 오디오 (음성 보고서)
# research-helper-report-audio-language-label
# English source:
#   .value = Audio language
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-language-label =
#     .value = 오디오 언어
# research-helper-report-audio-voice-label
# English source:
#   .value = Voice
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-voice-label =
#     .value = 음성
# research-helper-report-audio-none
# English source:
#   No report is stored for this collection yet. Generate a report first, then make its audio.
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-none = 이 컬렉션에 저장된 보고서가 아직 없습니다. 먼저 보고서를 생성한 뒤 오디오를 만드세요.
# research-helper-report-audio-source
# English source:
#   { $script ->
#   [ko] { $report -> [ko] Korean script written from the Korean report *[en] Korean script written from the English report }
#   *[en] { $report -> [ko] English script written from the Korean report *[en] English script written from the English report }
#   }
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-source =
#     { $script ->
#         [ko]
#             { $report ->
#                 [ko] 한국어 보고서로 쓴 한국어 대본
#                *[en] 영어 보고서로 쓴 한국어 대본
#             }
#        *[en]
#             { $report ->
#                 [ko] 한국어 보고서로 쓴 영어 대본
#                *[en] 영어 보고서로 쓴 영어 대본
#             }
#     }
# research-helper-report-audio-generate
# English source:
#   .label = Generate audio
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-generate =
#     .label = 오디오 생성
# research-helper-report-audio-cancel
# English source:
#   .label = Cancel audio
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-cancel =
#     .label = 오디오 취소
# research-helper-report-audio-stage
# English source:
#   { $stage ->
#   [checking] Checking the report, the library and the key…
#   [scripting] Writing the spoken script…
#   [confirming] Waiting for your confirmation…
#   [synthesizing] Generating audio… part { $done } of { $total }
#   [attaching] Attaching the audio to the collection…
#   [waiting] Paused — waiting for your answer.
#   *[done] Done.
#   }
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-stage =
#     { $stage ->
#         [checking] 보고서, 라이브러리, 키를 확인하는 중…
#         [scripting] 음성 대본을 쓰는 중…
#         [confirming] 확인을 기다리는 중…
#         [synthesizing] 오디오 생성 중… { $total }개 중 { $done }번째
#         [attaching] 컬렉션에 오디오를 첨부하는 중…
#         [waiting] 일시 중지 — 답을 기다리는 중입니다.
#        *[done] 완료.
#     }
# research-helper-report-audio-outcome
# English source:
#   { $outcome ->
#   [succeeded] The audio is attached to the report's collection.
#   [declined] Nothing was generated.
#   [cancelled] Cancelled. No audio was kept; a spoken script already written is kept.
#   [interrupted] Zotero closed during the run. No audio was kept; a spoken script already written is kept.
#   [refused] No audio was generated.
#   *[failed] The audio could not be generated.
#   }
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-outcome =
#     { $outcome ->
#         [succeeded] 보고서의 컬렉션에 오디오를 첨부했습니다.
#         [declined] 아무것도 생성하지 않았습니다.
#         [cancelled] 취소했습니다. 오디오는 남기지 않았고, 이미 쓴 음성 대본은 남아 있습니다.
#         [interrupted] 실행 중에 Zotero가 닫혔습니다. 오디오는 남기지 않았고, 이미 쓴 음성 대본은 남아 있습니다.
#         [refused] 오디오를 생성하지 않았습니다.
#        *[failed] 오디오를 생성하지 못했습니다.
#     }
# research-helper-report-audio-refused
# English source:
#   { $reason ->
#   [no-report] The report is no longer stored. Generate a report first.
#   [no-key] No Google Gemini API key is set. Add it in Research Helper's preferences.
#   [read-only] This library cannot be written to, so no audio can be attached to it.
#   [no-collection] The report's collection is gone or in the trash.
#   [linked-needs-personal-library] The audio file would be too large to store in a group library, and only your personal library can link a file instead.
#   [no-folder] No folder was chosen for the audio file.
#   [disabled] Audio reports are turned off.
#   *[other] No audio was generated.
#   }
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-refused =
#     { $reason ->
#         [no-report] 보고서가 더 이상 저장되어 있지 않습니다. 먼저 보고서를 생성하세요.
#         [no-key] Google Gemini API 키가 설정되지 않았습니다. Research Helper 설정에서 추가하세요.
#         [read-only] 이 라이브러리에는 쓸 수 없어 오디오를 첨부할 수 없습니다.
#         [no-collection] 보고서의 컬렉션이 없어졌거나 휴지통에 있습니다.
#         [linked-needs-personal-library] 오디오 파일이 너무 커서 그룹 라이브러리에 저장할 수 없고, 파일 링크는 내 라이브러리에서만 할 수 있습니다.
#         [no-folder] 오디오 파일을 저장할 폴더를 고르지 않았습니다.
#         [disabled] 오디오 보고서가 꺼져 있습니다.
#        *[other] 오디오를 생성하지 않았습니다.
#     }
# research-helper-report-audio-save-script
# English source:
#   .label = Save Script as Text…
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-save-script =
#     .label = 대본을 텍스트로 저장…
# research-helper-report-audio-save-audio
# English source:
#   .label = Save Audio As…
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-save-audio =
#     .label = 오디오를 다른 이름으로 저장…
# research-helper-report-audio-saved
# English source:
#   { $outcome ->
#   [saved] { $kind -> [audio] Audio saved. *[script] Spoken script saved. }
#   *[failed] The file could not be written.
#   }
# Draft (coordinator, 2026-11-17, not adopted):
# research-helper-report-audio-saved =
#     { $outcome ->
#         [saved]
#             { $kind ->
#                 [audio] 오디오를 저장했습니다.
#                *[script] 음성 대본을 저장했습니다.
#             }
#        *[failed] 파일을 쓰지 못했습니다.
#     }

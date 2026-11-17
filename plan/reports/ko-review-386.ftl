# Owner approvals of 2026-11-17, given in chat (G-41, plan/00 §6 item 386): all 29 drafts approved as written.
# Inserted byte for byte from the commented drafts in the two ko-KR bundles; the review page was plan/reports/ko-review-386-draft.md.

## research-helper-mainWindow.ftl

research-helper-menu-collection-audio-report =
    .label = 오디오 보고서 생성…

rh-error-tts = { $reason ->
    [unentitled] 이 Gemini 키로는 Gemini 음성 합성을 쓸 수 없어 오디오를 만들지 못했습니다. 보고서는 그대로입니다. Google AI Studio에서 키의 사용 권한을 확인하거나, 음성 대본을 텍스트로 저장하세요.
    [model-gone] Gemini 음성 합성 모델을 더 이상 쓸 수 없어 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 나중에 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
    [no-audio] Gemini가 오디오 없이 응답해 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
    [sample-rate] Gemini가 보낸 오디오 조각들의 샘플링 레이트가 서로 달라 하나로 합칠 수 없었습니다. 보고서는 그대로입니다. 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
    [script-rejected] 한 번 다시 시도한 뒤에도 음성 대본에 문서 서식이 남아 있어 오디오를 만들지 않았고, Gemini에는 아무것도 보내지 않았습니다. 보고서는 그대로입니다. 대본을 텍스트로 저장하거나 다시 시도하세요.
    [rate-limited] Gemini 음성 합성에 요청이 너무 많아 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 몇 분 뒤 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
   *[other] Gemini 음성 합성이 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
}

research-helper-egress-audio-notice =
    { $script ->
        [due] 오디오를 만들기 위해 보고서의 각 절, 컬렉션 이름, 항목 수와 연도 범위, 그리고 인용된 논문마다 한 줄(Zotero 항목 키, 제1저자의 성, 연도)이 음성 대본 작성을 위해 { $scriptHost }의 { $scriptModel }(으)로 전송됩니다. 그런 다음 컬렉션 이름과 인용된 저자를 소리 내어 언급할 수 있는 음성 대본이 낭독을 위해 { $ttsHost }의 { $ttsModel }(으)로 전송됩니다.
       *[stored] 이 보고서용으로 이미 작성된 음성 대본(컬렉션 이름과 인용된 저자를 소리 내어 언급할 수 있음)이 낭독을 위해 { $ttsHost }의 { $ttsModel }(으)로 전송됩니다. 이번에는 대본을 새로 작성하지 않으므로 그 밖의 내용은 전송되지 않습니다.
    }

research-helper-cost-audio-script =
    { $calls ->
       *[other] 음성 대본 작성: 약 { $minutes } 분량의 오디오를 위해 { $model }에 최대 { $calls }회 호출.
    }

research-helper-cost-audio-provisional = 이어서 { $model }(으)로 낭독: 목표 길이로 추정한 약 { $duration }. 대본이 작성되면 오디오를 만들기 전에 실제 길이로 다시 확인합니다.

research-helper-cost-audio-length =
    { $chunks ->
       *[other] 음성 대본: { $chars }자, { $chunks }개 부분으로 나누어 낭독.
    }

research-helper-cost-audio-length-warning =
    { $unit ->
        [syllables] 대본 길이가 한글 { $count }음절로, 목표인 약 { $target }음절과 차이가 있어 오디오가 계획보다 길거나 짧아집니다.
       *[words] 대본 길이가 { $count }단어로, 목표인 약 { $target }단어와 차이가 있어 오디오가 계획보다 길거나 짧아집니다.
    }

research-helper-cost-audio-duration = 오디오: 약 { $duration }, WAV 파일로 약 { $size }.

research-helper-cost-audio-attach =
    { $mode ->
        [linked] 파일이 Zotero에 저장하기에는 너무 커서, 직접 고른 폴더에 저장하고 보고서의 컬렉션에서 링크합니다. Zotero는 링크된 파일을 동기화하지 않습니다.
       *[imported] 파일은 Zotero의 보고서 컬렉션에 저장되며 다른 첨부 파일처럼 동기화됩니다.
    }

research-helper-cost-audio-rate-unmeasured = 이 비용은 다른 Gemini 음성 합성 모델에서 측정한 오디오 토큰 비율을 사용하므로 덜 정확할 수 있습니다.

research-helper-cost-audio-tier-question = 이 Google API 키의 Google Cloud 프로젝트에 결제가 연결되어 있나요(Google 유료 등급)? Research Helper는 이를 직접 확인할 수 없어 한 번만 묻습니다. "모름"은 무료 등급으로 취급됩니다. 답은 나중에 Research Helper 설정의 Gemini 키 항목에서 바꿀 수 있습니다.

research-helper-cost-audio-tier-paid =
    .label = 예, 결제가 연결되어 있습니다(유료 등급)

research-helper-cost-audio-tier-free =
    .label = 아니요, 무료 등급입니다

research-helper-cost-audio-tier-unknown =
    .label = 모름

research-helper-audio-tier-refused = 엄격 개인정보 보호 모드에서는 이 Google API 키로 오디오를 만들지 않습니다. 이 키가 무료 등급일 수 있고, 무료 등급에서는 Google이 전송된 내용을 자사 제품 개선에 사용할 수 있기 때문입니다. 오디오를 만들려면 Google Cloud 프로젝트에 결제가 연결된 경우 Research Helper 설정에서 이 키를 유료로 표시하거나, 덜 엄격한 개인정보 보호 모드를 선택하세요.

research-helper-audio-attachment-title =
    { $language ->
        [ko] 오디오 보고서 (한국어), { $date }
       *[en] 오디오 보고서 (영어), { $date }
    }

## research-helper-reportWindow.ftl

research-helper-report-audio-heading = 오디오 (음성 보고서)

research-helper-report-audio-language-label =
    .value = 오디오 언어

research-helper-report-audio-voice-label =
    .value = 음성

research-helper-report-audio-none = 이 컬렉션에 저장된 보고서가 아직 없습니다. 먼저 보고서를 생성한 뒤 오디오를 만드세요.

research-helper-report-audio-source =
    { $script ->
        [ko]
            { $report ->
                [ko] 한국어 보고서로 쓴 한국어 대본
               *[en] 영어 보고서로 쓴 한국어 대본
            }
       *[en]
            { $report ->
                [ko] 한국어 보고서로 쓴 영어 대본
               *[en] 영어 보고서로 쓴 영어 대본
            }
    }

research-helper-report-audio-generate =
    .label = 오디오 생성

research-helper-report-audio-cancel =
    .label = 오디오 취소

research-helper-report-audio-stage =
    { $stage ->
        [checking] 보고서, 라이브러리, 키를 확인하는 중…
        [scripting] 음성 대본을 쓰는 중…
        [confirming] 확인을 기다리는 중…
        [synthesizing] 오디오 생성 중… { $total }개 중 { $done }번째
        [attaching] 컬렉션에 오디오를 첨부하는 중…
        [waiting] 일시 중지 — 답을 기다리는 중입니다.
       *[done] 완료.
    }

research-helper-report-audio-outcome =
    { $outcome ->
        [succeeded] 보고서의 컬렉션에 오디오를 첨부했습니다.
        [declined] 아무것도 생성하지 않았습니다.
        [cancelled] 취소했습니다. 오디오는 남기지 않았고, 이미 쓴 음성 대본은 남아 있습니다.
        [interrupted] 실행 중에 Zotero가 닫혔습니다. 오디오는 남기지 않았고, 이미 쓴 음성 대본은 남아 있습니다.
        [refused] 오디오를 생성하지 않았습니다.
       *[failed] 오디오를 생성하지 못했습니다.
    }

research-helper-report-audio-refused =
    { $reason ->
        [no-report] 보고서가 더 이상 저장되어 있지 않습니다. 먼저 보고서를 생성하세요.
        [no-key] Google Gemini API 키가 설정되지 않았습니다. Research Helper 설정에서 추가하세요.
        [read-only] 이 라이브러리에는 쓸 수 없어 오디오를 첨부할 수 없습니다.
        [no-collection] 보고서의 컬렉션이 없어졌거나 휴지통에 있습니다.
        [linked-needs-personal-library] 오디오 파일이 너무 커서 그룹 라이브러리에 저장할 수 없고, 파일 링크는 내 라이브러리에서만 할 수 있습니다.
        [no-folder] 오디오 파일을 저장할 폴더를 고르지 않았습니다.
        [disabled] 오디오 보고서가 꺼져 있습니다.
       *[other] 오디오를 생성하지 않았습니다.
    }

research-helper-report-audio-save-script =
    .label = 대본을 텍스트로 저장…

research-helper-report-audio-save-audio =
    .label = 오디오를 다른 이름으로 저장…

research-helper-report-audio-saved =
    { $outcome ->
        [saved]
            { $kind ->
                [audio] 오디오를 저장했습니다.
               *[script] 음성 대본을 저장했습니다.
            }
       *[failed] 파일을 쓰지 못했습니다.
    }

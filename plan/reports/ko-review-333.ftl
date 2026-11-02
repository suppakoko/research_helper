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

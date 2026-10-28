# Owner-approved Korean, plan/00 §6 item 304 (2026-10-29; G-41). Drafted by the coordinator and approved by the
# owner in chat as drafted, in two batches. Inserted byte for byte into
# addon/locale/ko-KR/research-helper-mainWindow.ftl, replacing each id's "# NEEDS REVIEW" stub.

## Batch 1: P3-T28's item-pane AI summary section (15)

research-helper-itempane-header =
    .label = Research Helper
research-helper-itempane-sidenav =
    .tooltiptext = Research Helper 요약
research-helper-itempane-empty = 이 논문의 요약이 아직 없습니다.
research-helper-itempane-generate = 요약 만들기
research-helper-itempane-loading = 요약하는 중…
research-helper-itempane-cancel = 취소
research-helper-itempane-failed = 요약을 만들지 못했습니다.
research-helper-itempane-retry = 다시 시도
research-helper-itempane-no-key = AI 모델 API 키가 설정되어 있지 않습니다. 요약을 쓰려면 OpenRouter, OpenAI, Gemini, Anthropic 중 하나의 키를 추가하세요.
research-helper-itempane-open-preferences = 설정 열기…
research-helper-itempane-research-question = 연구 질문
research-helper-itempane-key-findings = 핵심 발견
research-helper-itempane-limitations = 한계
research-helper-itempane-btn-regenerate =
    .tooltiptext = 요약 다시 만들기
research-helper-itempane-btn-save-note =
    .tooltiptext = 요약을 하위 노트로 저장

## Batch 2: P3-T29's summarize window and removal command (24)

research-helper-menu-collection-remove-notes =
    .label = 컬렉션에서 생성된 노트 지우기…
research-helper-summarize-title = Research Helper — 컬렉션 요약
research-helper-summarize-collection = { $name } — 논문 { $count }편
research-helper-summarize-resummarize =
    .label = 이미 있는 요약도 다시 만들기
research-helper-summarize-write-notes =
    .label = 논문마다 요약 노트 저장
research-helper-summarize-notes-readonly = 이 라이브러리는 읽기 전용이라 노트를 저장할 수 없습니다. 실행이 끝난 뒤 '요약 내보내기…'를 쓰세요.
research-helper-summarize-start =
    .label = 요약 시작
research-helper-summarize-cancel =
    .label = 취소
research-helper-summarize-close =
    .label = 닫기
research-helper-summarize-export =
    .label = 요약 내보내기…
research-helper-summarize-stage =
    { $stage ->
        [loading] 컬렉션을 읽는 중…
        [planning] 논문마다 본문을 읽는 중…
        [estimating] 비용을 어림하는 중…
        [confirming] 확인을 기다리는 중…
        [waiting] 일시 정지 — 답을 기다리는 중입니다.
        [writing] 노트를 저장하는 중…
        [done] 끝났습니다.
       *[summarizing] 논문을 요약하는 중
    }
research-helper-summarize-progress = { $done } / { $total } (저장된 요약 { $cached }, 새로 { $fresh })
research-helper-summarize-remaining =
    { $minutes ->
        [0] 1분 이내 남음
       *[other] 약 { $minutes }분 남음
    }
research-helper-summarize-row =
    { $status ->
        [done] ✓ { $title }
        [cached] ✓ { $title } (저장된 요약)
        [running] ⟳ { $title }
        [failed] ⚠ { $title } — 실패
        [skipped-existing] · { $title } — 이미 요약되어 건너뜀
        [skipped-no-text] ⚠ { $title } — 초록도 본문도 없어 건너뜀
        [skipped-retracted] ⚠ { $title } — 철회된 논문이라 건너뜀
        [skipped-duplicate] · { $title } — 이 컬렉션 안의 중복이라 건너뜀
        [skipped-language] · { $title } — 영어가 아니라 건너뜀
       *[queued] · { $title }
    }
research-helper-summarize-counts = 본문 사용: { $fulltext } · 초록으로 대신함: { $abstract } · 글이 없어 건너뜀: { $notext } · 철회되어 건너뜀: { $retracted } · 중복이라 건너뜀: { $duplicate }
research-helper-summarize-outcome =
    { $outcome ->
        [cancelled] { $total }편 중 { $at }번째에서 취소했습니다. 이미 만든 요약은 모두 남아 있습니다.
        [declined] 아무것도 보내지 않았습니다.
        [stopped-outage] 시도한 논문의 30%가 넘는 { $failed }편이 실패해 멈췄습니다. 제공자에 문제가 있거나 키가 작동하지 않을 수 있습니다. 이미 만든 요약은 모두 남아 있습니다.
        [failed] 오류로 실행이 멈췄습니다. 이미 만든 요약은 모두 남아 있습니다.
        [nothing] 이 컬렉션의 모든 논문에 이미 요약이 있습니다. 다시 만들려면 '이미 있는 요약도 다시 만들기'를 선택하세요.
        [unavailable] Research Helper 데이터베이스가 열려 있지 않아 요약을 저장할 수 없습니다. 아무것도 보내지 않았습니다.
       *[succeeded] 끝났습니다: 논문 { $total }편 중 { $done }편 요약, { $failed }편 실패, 노트 { $notes }개 저장.
    }
research-helper-summarize-key-needed = { $provider } API 키가 없습니다. Research Helper 설정에서 키를 추가한 뒤 '계속'을 누르세요. 아직 아무것도 보내지 않았습니다.
research-helper-summarize-continue =
    .label = 계속
research-helper-summarize-stop =
    .label = 멈추기
research-helper-summarize-export-outcome =
    { $outcome ->
        [written] 요약을 고르신 파일에 저장했습니다.
       *[failed] 요약을 그 파일에 저장하지 못했습니다.
    }
research-helper-remove-notes-title = 생성된 노트 지우기
research-helper-remove-notes-confirm = “{ $collection }”에서 Research Helper가 만든 노트 { $count }개를 휴지통으로 옮길까요? research_helper/… 태그가 붙은 노트만 옮기며, 직접 쓰신 노트는 건드리지 않습니다.
research-helper-remove-notes-none = “{ $collection }”에서 Research Helper가 만든 노트를 찾지 못했습니다.
research-helper-remove-notes-done = 노트 { $count }개를 휴지통으로 옮겼습니다.

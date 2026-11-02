## research-helper-searchDialog.ftl
research-helper-search-window-title-related = Research Helper — 관련 논문
research-helper-search-mode-related =
    .value = 관련 대상: { $title }
research-helper-search-related-seed-label =
    .value = 기준 논문
research-helper-search-related-seed-missing = 이 항목을 읽을 수 없습니다. 라이브러리에서 항목을 선택한 뒤 관련 논문 찾기…를 다시 선택하세요.
research-helper-search-related-include-label =
    .value = 포함
research-helper-search-related-include-reference =
    .label = 참고문헌
research-helper-search-related-include-citation =
    .label = 인용 논문
research-helper-search-related-include-recommendation =
    .label = 추천 논문
research-helper-search-related-include-similar =
    .label = 유사 논문 (PubMed)
research-helper-search-years-any =
    .label = 전체
research-helper-search-state-initial-related = 이 항목과 관련된 논문이 여기에 표시됩니다.

## research-helper-reportWindow.ftl
research-helper-report-shown-label =
    .value = 표시할 보고서

## research-helper-mainWindow.ftl
research-helper-report-paused-notice =
    { $count ->
        [one] 컬렉션 { $collections }의 보고서 실행이 일시 중지되어 답을 기다리고 있습니다. 해당 컬렉션의 보고서 창을 열어 계속하거나 중지하세요. 그때까지 비용은 들지 않습니다.
       *[other] 보고서 실행 { $count }건이 일시 중지되어 답을 기다리고 있습니다. 컬렉션: { $collections }. 컬렉션의 보고서 창을 열어 계속하거나 중지하세요. 그때까지 비용은 들지 않습니다.
    }
research-helper-menu-item-find-related =
    .label = 관련 논문 찾기…
    .tooltiptext =
        { $oneItem ->
            [yes] { "" }
           *[no] 항목을 하나만 선택하면 관련 논문을 찾을 수 있습니다.
        }

## research-helper-mainWindow.ftl
research-helper-report-stopped-korean =
    { $reason ->
        [no-room] 보고서를 쓰지 않았고, 두 보고서 모두 비용이 들지 않았습니다. 한국어 보고서가 이 모델의 한도에 맞지 않습니다. 이미 만든 요약은 모두 남아 있습니다. 영어 보고서가 필요하면 언어에서 English를 고르고 다시 생성하세요.
        [structure] 영어 보고서는 저장했습니다. 한국어 보고서는 쓰지 못했습니다. 두 번 요청했지만 모델이 필요한 11개 장을 순서대로 갖춘 보고서를 돌려주지 않았습니다. 다시 시도하려면 언어에서 한국어 보고서를 고르고 생성하세요.
        [finishing] 영어 보고서는 저장했습니다. 한국어 보고서는 작성했지만 마무리해 저장하지 못했습니다. 다시 시도하려면 언어에서 한국어 보고서를 고르고 생성하세요.
       *[request] 영어 보고서는 저장했습니다. 모델에 보낸 요청이 실패해 한국어 보고서는 쓰지 못했습니다. 다시 시도하려면 언어에서 한국어 보고서를 고르고 생성하세요.
    }
research-helper-egress-profile-notice = 이 컬렉션의 프로필을 만들기 위해 메타데이터만 { $model }에 보냅니다. 논문 { $papers }편마다 한 줄씩, 항목 키, 제목, 연도, 게재처, 주요 주제어가 들어갑니다. 초록, 요약, 전문, 노트, 컬렉션 이름은 보내지 않습니다.
research-helper-recommend-profile-unusable = 모델이 이 컬렉션을 설명하지 못해 프로필은 컬렉션 자체의 용어로 만들었습니다. 검색 결과가 줄어들 수 있습니다.

## src/pipeline/trendReport/reportLabels.ts, KO_REPORT_LABELS
# fitOutputLowered = 보고서 모델의 한도로 이 보고서에 출력 토큰을 {output}개만 쓸 수 있어, {words}단어 분량으로 요청했습니다.
# fitAnalysesShortened = 보고서 모델의 컨텍스트 창에 맞추기 위해 주제 분석을 {sections}절의 세부 내용 없이 보냈습니다. 따라서 해당 절의 내용이 분석 결과보다 적을 수 있습니다.

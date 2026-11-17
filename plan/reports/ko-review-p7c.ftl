# The 20 Korean preference-pane strings of Phase 7 batch C (P7-T10, P7-T11),
# approved by the owner in chat on 2026-11-17 ("모두 승인"; G-41, plan/00 §6 item 397).
# Byte for byte as inserted in addon/locale/ko-KR/research-helper-mainWindow.ftl.

# P7-T10
research-helper-prefs-data-title = 저장된 데이터
research-helper-prefs-data-note = Research Helper가 자체 데이터베이스에 보관한 내용을 지웁니다. Zotero 항목과 노트는 그대로 남고, API 키도 그대로 남습니다.
research-helper-prefs-clear-responses =
    .label = 캐시된 응답 지우기…
research-helper-prefs-clear-summaries =
    .label = 저장된 요약 지우기…
research-helper-prefs-clear-jobs =
    .label = 작업 기록 지우기…
research-helper-prefs-clear-embeddings =
    .label = 임베딩 지우기…
research-helper-prefs-delete-all-data =
    .label = 플러그인 데이터 모두 삭제…
research-helper-prefs-reset-defaults =
    .label = 설정을 기본값으로 되돌리기…
research-helper-prefs-data-confirm-title = Research Helper
research-helper-prefs-confirm-clear-responses = 캐시된 응답 { $entries }개({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)를 지울까요? 다음에 필요할 때 다시 가져옵니다.
research-helper-prefs-confirm-clear-summaries = Research Helper 데이터베이스에서 저장된 요약 { $rows }개를 지울까요? Zotero 라이브러리의 노트는 그대로 남습니다.
research-helper-prefs-confirm-clear-jobs = 끝난 작업 { $rows }개의 기록을 지울까요? 대기 중이거나 실행 중이거나 일시 중지된 작업은 그대로 남습니다.
research-helper-prefs-confirm-clear-embeddings = 저장된 임베딩 { $rows }개를 지울까요? 다음에 필요할 때 다시 계산합니다.
research-helper-prefs-confirm-delete-all = Research Helper에 저장된 데이터를 모두 삭제할까요? 저장된 기록 { $rows }개와 캐시 항목 { $entries }개({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)입니다. Zotero 항목과 노트, API 키는 그대로 남습니다. 되돌릴 수 없습니다.
research-helper-prefs-confirm-reset = Research Helper의 모든 설정을 기본값으로 되돌릴까요? API 키와 저장된 데이터는 그대로 남습니다.
research-helper-prefs-data-status =
    { $outcome ->
        [cleared] 저장된 기록 { $removed }개를 지웠습니다.
        [reset] 설정을 기본값으로 되돌렸습니다.
        [nothing] 지울 것이 없습니다.
        [declined] 아무것도 바꾸지 않았습니다.
        [failed] 실행하지 못했습니다.
       *[unavailable] 지금은 Research Helper 데이터베이스가 열려 있지 않습니다.
    }

# P7-T11
research-helper-prefs-remove-content =
    .label = Research Helper 콘텐츠 모두 제거…
research-helper-prefs-remove-content-note = Research Helper가 만든 노트와 오디오 첨부 파일을 Zotero 휴지통으로 옮기고(휴지통에서 복원할 수 있습니다), 저장된 데이터를 삭제합니다. 가져온 항목과 직접 쓴 노트는 그대로 남습니다.
research-helper-prefs-confirm-remove-content =
    Research Helper가 만든 모든 것을 Zotero 휴지통으로 옮기고(휴지통에서 복원할 수 있습니다), 저장된 데이터를 삭제할까요?
    생성된 노트: { $generated }. 검색 출처 노트: { $provenance }. 오디오 첨부 파일: { $audio }. 저장된 기록: { $records }.{ $libraryCount ->
        [0] {""}
       *[other] {" "}위치: { $libraries }.
    }{ $folderCount ->
        [0] {""}
       *[other] {" "}링크된 오디오 파일은 디스크의 다음 폴더에 그대로 남습니다: { $folders }.
    }{ $skippedCount ->
        [0] {""}
       *[other] {" "}편집 권한이 없어 바꾸지 않는 라이브러리: { $skipped }.
    }
    가져온 항목과 그 태그, 직접 쓴 노트는 그대로 남습니다.
research-helper-prefs-remove-content-status =
    { $outcome ->
        [removed] Zotero 휴지통으로 옮긴 항목: { $moved }. 삭제한 저장 기록: { $records }.
        [nothing] Research Helper가 만든 것 중 제거할 것이 없습니다.
        [declined] 아무것도 바꾸지 않았습니다.
        [failed] 실행하지 못했습니다.
       *[unavailable] 지금은 Research Helper 데이터베이스가 열려 있지 않습니다.
    }

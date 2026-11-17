# Owner approvals of 2026-11-17, given in chat (G-41, plan/00 §6 item 389(b)): all 23 drafts approved as written.
# Inserted byte for byte from the commented drafts in the ko-KR mainWindow bundle; the review page was plan/reports/ko-review-389-draft.md.

## research-helper-mainWindow.ftl

rh-error-llm = { $provider }에서 요청을 처리하지 못했습니다. 다시 시도하거나, Research Helper 설정에서 다른 모델을 고르세요.

rh-error-context-length = 글이 너무 길어 { $model } 모델이 한 번에 읽을 수 없습니다. Research Helper 설정에서 더 긴 글을 읽을 수 있는 모델을 고르세요.

rh-error-content-filter = 모델이 이 논문의 요약을 거절했습니다. 이 논문은 건너뛰었습니다. 요약하려면 Research Helper 설정에서 다른 AI 제공자의 모델을 고르세요.

rh-error-structured-output = { $provider }에서 받은 요약을 Research Helper가 읽지 못했습니다. 다시 시도하거나, Research Helper 설정에서 다른 모델을 고르세요.

rh-error-output-truncated = { $model } 모델의 출력 길이 한도에 걸려 요약이 잘렸습니다. 다시 시도하거나, Research Helper 설정에서 출력 한도가 더 큰 모델을 고르세요.

rh-error-budget = 지출 한도({ $limit })에 도달해 멈췄습니다. 지금까지 쓴 금액: { $spent }. 이미 만든 요약은 그대로 있습니다. 계속하려면 Research Helper의 한도를 올리고, 아니면 멈추세요.

rh-error-seed-gone = 이 항목이 더 이상 라이브러리에 없어 관련 논문을 찾을 수 없습니다. 다른 항목을 고른 뒤 다시 시도하세요.

rh-error-recommend-too-few-items = 이 컬렉션에는 항목이 { $count }개 있습니다. 추천을 받으려면 항목이 5개 이상 필요합니다. 컬렉션에 항목을 추가한 뒤 다시 시도하세요.

rh-error-configuration = 이 작업에 필요한 Research Helper 설정이 올바르지 않습니다. Research Helper 설정을 확인한 뒤 다시 시도하세요.

rh-error-missing-credential = { $provider }의 API 키가 설정되어 있지 않습니다. Research Helper 설정에서 키를 추가하세요.

rh-error-network = { $host }에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.

rh-error-offline = Zotero가 오프라인 상태입니다. 인터넷에 연결한 뒤 다시 시도하세요.

rh-error-timeout = { $host }에서 { $seconds }초 안에 응답이 없습니다. 몇 분 뒤에 다시 시도하세요.

rh-error-auth = { $provider }에서 API 키를 거부했습니다(HTTP { $status }). Research Helper 설정에서 키를 확인하세요.

rh-error-forbidden = { $provider }에서 요청을 거절했습니다(HTTP { $status }). { $provider } 계정에서 키의 권한을 확인하세요.

rh-error-quota = { $provider } 계정의 크레딧이 모두 소진되었습니다. { $provider } 계정에 크레딧을 추가한 뒤 다시 시도하세요.

rh-error-upstream = { $database } 서비스를 일시적으로 사용할 수 없습니다(HTTP { $status }). 다른 데이터베이스는 계속 검색했습니다. 이 데이터베이스는 나중에 다시 시도하세요.

rh-error-bad-request = Research Helper가 보낸 요청을 { $database }에서 받아들이지 못했습니다. 다시 시도하고, 같은 문제가 반복되면 알려 주세요.

rh-error-source = { $database }에서 검색을 끝내지 못했습니다. 나중에 다시 시도하세요.

rh-error-parse = { $database }의 응답을 읽을 수 없습니다. 나중에 다시 시도하고, 같은 문제가 반복되면 알려 주세요.

rh-error-zotero = Zotero에서 변경을 완료하지 못했습니다. 다시 시도하고, 같은 문제가 반복되면 Zotero를 다시 시작하세요.

rh-error-storage = Research Helper가 저장소에 쓰지 못했습니다. 디스크에 여유 공간이 있는지 확인한 뒤 다시 시도하세요.

rh-error-policy = 개인정보 모드에서 허용하지 않는 요청이라 Research Helper가 보내기 전에 멈췄습니다. Research Helper 설정에서 개인정보 모드를 확인하세요.

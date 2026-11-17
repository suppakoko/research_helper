# 오류 안내 한국어 문구 검토 (초안, 2026-11-17, 항목 389)

오류 안내마다 "다음에 할 일" 한 문장을 덧붙였습니다. 각 항목: 새 영어 원문 → 한국어 초안. 고칠 것만 말씀해 주시면 됩니다.

## 1. rh-error-llm

영어:
```
rh-error-llm = { $provider } could not complete the request. Try again, or choose another model in Research Helper's preferences.
```
한국어 초안:
```
rh-error-llm = { $provider }에서 요청을 처리하지 못했습니다. 다시 시도하거나, Research Helper 설정에서 다른 모델을 고르세요.
```

## 2. rh-error-context-length

영어:
```
rh-error-context-length = The text is too long for { $model } to read in one request. Choose a model that reads longer text in Research Helper's preferences.
```
한국어 초안:
```
rh-error-context-length = 글이 너무 길어 { $model } 모델이 한 번에 읽을 수 없습니다. Research Helper 설정에서 더 긴 글을 읽을 수 있는 모델을 고르세요.
```

## 3. rh-error-content-filter

영어:
```
rh-error-content-filter = The model declined to summarize this paper. The paper was skipped; to summarize it, choose a model from another AI provider in Research Helper's preferences.
```
한국어 초안:
```
rh-error-content-filter = 모델이 이 논문의 요약을 거절했습니다. 이 논문은 건너뛰었습니다. 요약하려면 Research Helper 설정에서 다른 AI 제공자의 모델을 고르세요.
```

## 4. rh-error-structured-output

영어:
```
rh-error-structured-output = { $provider } returned a summary Research Helper could not read. Try again, or choose another model in Research Helper's preferences.
```
한국어 초안:
```
rh-error-structured-output = { $provider }에서 받은 요약을 Research Helper가 읽지 못했습니다. 다시 시도하거나, Research Helper 설정에서 다른 모델을 고르세요.
```

## 5. rh-error-output-truncated

영어:
```
rh-error-output-truncated = The summary was cut off by the output length limit of { $model }. Try again, or choose a model with a larger output limit in Research Helper's preferences.
```
한국어 초안:
```
rh-error-output-truncated = { $model } 모델의 출력 길이 한도에 걸려 요약이 잘렸습니다. 다시 시도하거나, Research Helper 설정에서 출력 한도가 더 큰 모델을 고르세요.
```

## 6. rh-error-budget

영어:
```
rh-error-budget = Paused at the { $limit } spending limit. { $spent } is spent so far, and summaries already made are kept. Raise Research Helper's limit to continue, or stop.
```
한국어 초안:
```
rh-error-budget = 지출 한도({ $limit })에 도달해 멈췄습니다. 지금까지 쓴 금액: { $spent }. 이미 만든 요약은 그대로 있습니다. 계속하려면 Research Helper의 한도를 올리고, 아니면 멈추세요.
```

## 7. rh-error-seed-gone

영어:
```
rh-error-seed-gone = This item is no longer in your library, so related papers cannot be looked up. Choose another item, then try again.
```
한국어 초안:
```
rh-error-seed-gone = 이 항목이 더 이상 라이브러리에 없어 관련 논문을 찾을 수 없습니다. 다른 항목을 고른 뒤 다시 시도하세요.
```

## 8. rh-error-recommend-too-few-items

영어:
```
rh-error-recommend-too-few-items = { $count ->
    [one] This collection has { $count } item. Recommendations need at least 5. Add items to the collection, then try again.
   *[other] This collection has { $count } items. Recommendations need at least 5. Add items to the collection, then try again.
```
한국어 초안:
```
rh-error-recommend-too-few-items = 이 컬렉션에는 항목이 { $count }개 있습니다. 추천을 받으려면 항목이 5개 이상 필요합니다. 컬렉션에 항목을 추가한 뒤 다시 시도하세요.
```

## 9. rh-error-configuration

영어:
```
rh-error-configuration = Research Helper is not configured correctly for this action. Check Research Helper's preferences, then try again.
```
한국어 초안:
```
rh-error-configuration = 이 작업에 필요한 Research Helper 설정이 올바르지 않습니다. Research Helper 설정을 확인한 뒤 다시 시도하세요.
```

## 10. rh-error-missing-credential

영어:
```
rh-error-missing-credential = No API key configured for { $provider }. Add the key in Research Helper's preferences.
```
한국어 초안:
```
rh-error-missing-credential = { $provider }의 API 키가 설정되어 있지 않습니다. Research Helper 설정에서 키를 추가하세요.
```

## 11. rh-error-network

영어:
```
rh-error-network = Could not reach { $host }. Check your internet connection, then try again.
```
한국어 초안:
```
rh-error-network = { $host }에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.
```

## 12. rh-error-offline

영어:
```
rh-error-offline = Zotero is offline. Connect to the internet, then try again.
```
한국어 초안:
```
rh-error-offline = Zotero가 오프라인 상태입니다. 인터넷에 연결한 뒤 다시 시도하세요.
```

## 13. rh-error-timeout

영어:
```
rh-error-timeout = { $host } did not respond within { $seconds }s. Try again in a few minutes.
```
한국어 초안:
```
rh-error-timeout = { $host }에서 { $seconds }초 안에 응답이 없습니다. 몇 분 뒤에 다시 시도하세요.
```

## 14. rh-error-auth

영어:
```
rh-error-auth = { $provider } rejected the API key (HTTP { $status }). Check the key in Research Helper's preferences.
```
한국어 초안:
```
rh-error-auth = { $provider }에서 API 키를 거부했습니다(HTTP { $status }). Research Helper 설정에서 키를 확인하세요.
```

## 15. rh-error-forbidden

영어:
```
rh-error-forbidden = { $provider } refused the request (HTTP { $status }). Check the key's permissions in your { $provider } account.
```
한국어 초안:
```
rh-error-forbidden = { $provider }에서 요청을 거절했습니다(HTTP { $status }). { $provider } 계정에서 키의 권한을 확인하세요.
```

## 16. rh-error-quota

영어:
```
rh-error-quota = { $provider } reports the account is out of credit. Add credit in your { $provider } account, then try again.
```
한국어 초안:
```
rh-error-quota = { $provider } 계정의 크레딧이 모두 소진되었습니다. { $provider } 계정에 크레딧을 추가한 뒤 다시 시도하세요.
```

## 17. rh-error-upstream

영어:
```
rh-error-upstream = { $database } is temporarily unavailable (HTTP { $status }). Other databases were still searched. Try this database again later.
```
한국어 초안:
```
rh-error-upstream = { $database } 서비스를 일시적으로 사용할 수 없습니다(HTTP { $status }). 다른 데이터베이스는 계속 검색했습니다. 이 데이터베이스는 나중에 다시 시도하세요.
```

## 18. rh-error-bad-request

영어:
```
rh-error-bad-request = Research Helper sent a request { $database } could not accept. Try again, and report the problem if it happens again.
```
한국어 초안:
```
rh-error-bad-request = Research Helper가 보낸 요청을 { $database }에서 받아들이지 못했습니다. 다시 시도하고, 같은 문제가 반복되면 알려 주세요.
```

## 19. rh-error-source

영어:
```
rh-error-source = { $database } could not complete the search. Try again later.
```
한국어 초안:
```
rh-error-source = { $database }에서 검색을 끝내지 못했습니다. 나중에 다시 시도하세요.
```

## 20. rh-error-parse

영어:
```
rh-error-parse = Could not read the response from { $database }. Try again later, and report the problem if it happens again.
```
한국어 초안:
```
rh-error-parse = { $database }의 응답을 읽을 수 없습니다. 나중에 다시 시도하고, 같은 문제가 반복되면 알려 주세요.
```

## 21. rh-error-zotero

영어:
```
rh-error-zotero = Zotero could not complete the change. Try again, or restart Zotero if it happens again.
```
한국어 초안:
```
rh-error-zotero = Zotero에서 변경을 완료하지 못했습니다. 다시 시도하고, 같은 문제가 반복되면 Zotero를 다시 시작하세요.
```

## 22. rh-error-storage

영어:
```
rh-error-storage = Research Helper could not write to storage. Check that the disk has free space, then try again.
```
한국어 초안:
```
rh-error-storage = Research Helper가 저장소에 쓰지 못했습니다. 디스크에 여유 공간이 있는지 확인한 뒤 다시 시도하세요.
```

## 23. rh-error-policy (새 문구)

영어:
```
rh-error-policy = Research Helper stopped this request before sending it, because your privacy mode does not allow it. Check the privacy mode in Research Helper's preferences.
```
한국어 초안:
```
rh-error-policy = 개인정보 모드에서 허용하지 않는 요청이라 Research Helper가 보내기 전에 멈췄습니다. Research Helper 설정에서 개인정보 모드를 확인하세요.
```

# Owner approvals of 2026-11-06, given in chat (plan/00 §6 item 357).
# The two target-default ids keep the English value by the owner's choice: they become stored collection names.

## research-helper-mainWindow.ftl

rh-error-seed-gone = 이 항목이 더 이상 라이브러리에 없어 관련 논문을 찾을 수 없습니다.

rh-error-seed-no-identifier = 이 항목에는 DOI, PMID, arXiv ID, 제목이 모두 없어 관련 논문을 찾을 수 없습니다. 이 중 하나를 항목에 추가한 뒤 다시 시도하세요.

rh-error-seed-no-match = 이 항목의 제목과 충분히 일치하는 논문을 찾지 못했고, 항목에 DOI, PMID, arXiv ID도 없습니다. 이 중 하나를 항목에 추가하거나 제목을 고친 뒤 다시 시도하세요.

rh-error-recommend-too-few-items = 이 컬렉션에는 항목이 { $count }개 있습니다. 추천을 받으려면 항목이 5개 이상 필요합니다.

research-helper-menu-collection-recommend =
    .label = 이 컬렉션을 기반으로 새 논문 추천…

## research-helper-searchDialog.ftl

research-helper-search-related-include-reference-count =
    .label = 참고문헌 ({ $count })

research-helper-search-related-include-citation-count =
    .label = 인용 논문 ({ $count })

research-helper-search-related-include-recommendation-count =
    .label = 추천 논문 ({ $count })

research-helper-search-related-include-similar-count =
    .label = 유사 논문 (PubMed) ({ $count })

research-helper-search-related-col-relation =
    .label = 관계

research-helper-search-related-col-score =
    .label = 점수

research-helper-search-related-chip-cites-seed = 기준 논문을 인용함

research-helper-search-related-chip-cited-by-seed = 기준 논문이 인용함

research-helper-search-related-chip-recommended = Semantic Scholar 추천

research-helper-search-related-chip-similar-pubmed = PubMed 유사 논문

research-helper-search-related-chip-similar = 유사도 { $value }

research-helper-search-related-chip-basic-similarity = 기본 유사도 { $value }

research-helper-search-related-chip-context-label = 인용 문맥:

research-helper-search-related-chip-outside-window = 최근 기간 밖

research-helper-search-related-score =
    .title = 점 5개 중 { $dots }개, 이 목록의 최고 점수 기준
    .aria-label = 점수: 점 5개 중 { $dots }개, 이 목록의 최고 점수 기준

research-helper-search-related-generator-s2-recommendations = 추천 논문 (Semantic Scholar)

research-helper-search-related-generator-pmra = 유사 논문 (PubMed)

research-helper-search-related-generator-s2-citations = 인용 논문 (Semantic Scholar)

research-helper-search-related-generator-s2-references = 참고문헌 (Semantic Scholar)

research-helper-search-related-generator-europepmc-citations = 인용 논문 (Europe PMC)

research-helper-search-related-generator-europepmc-references = 참고문헌 (Europe PMC)

research-helper-search-related-generator-crossref-references = 참고문헌 (Crossref)

research-helper-search-related-source-no-key = 요청 안 함: 키 없음

research-helper-search-related-source-not-indexed = 색인되지 않음

research-helper-search-related-source-could-not-ask = 요청 안 함: 이 목록에 쓸 수 있는 식별자가 이 논문에 없음

research-helper-search-related-source-rate-limited = 요청이 너무 많음 · 잠시 후 다시 시도하세요

research-helper-search-related-source-over-budget = 요청 안 함: 이번 실행의 요청 한도 초과

research-helper-search-related-source-failed = 실패 ({ $code })

research-helper-search-related-key-notice = Semantic Scholar 키가 있으면 관련 논문을 더 잘 찾습니다. 키가 없으면 Semantic Scholar 목록은 요청하지 않으며 유사도는 기본 방식으로 계산합니다.

research-helper-search-related-matched-by-title = 식별자를 찾지 못해 제목으로 찾았습니다. 결과가 덜 정확할 수 있습니다.

research-helper-search-related-seed-failures = 이 항목에 대해 일부 서비스에 요청하지 못해, 해당 서비스 없이 계속 진행했습니다.

research-helper-search-related-similarity-no-store = 논문 벡터 저장소를 열 수 없어 이번 실행의 유사도는 기본 방식으로 계산했습니다.

research-helper-search-related-similarity-fetch-failed = Semantic Scholar의 논문 벡터를 모두 가져오지 못해, 이번 실행에서 일부 논문에는 유사도가 표시되지 않습니다.

research-helper-search-related-state-empty = 이 항목의 관련 논문을 찾지 못했습니다.

research-helper-search-related-state-failed = 관련 논문을 조회할 수 없습니다.

research-helper-search-related-status-running = 관련 논문을 찾는 중…

research-helper-search-related-status-cancelled = 취소했습니다.

research-helper-search-related-picker-prompt = 이 항목에는 식별자가 없고, 제목이 일치하는 논문이 여러 편 있습니다. 어느 논문입니까?

research-helper-search-related-picker-use =
    .label = 이 논문 사용

research-helper-search-related-link-to-seed =
    .label = 가져온 항목을 기준 논문의 “관련 항목”으로 연결

research-helper-search-related-target-default = Related to “{ $title }”

research-helper-search-related-link-failed = 논문은 가져왔지만 일부를 기준 논문에 “관련 항목”으로 연결하지 못했습니다.

research-helper-search-related-seed-gone = 이 논문들을 찾을 때 쓴 항목이 더 이상 라이브러리에 없어 아무것도 가져오지 않았습니다.

research-helper-search-window-title-recommend = Research Helper — 새 논문 추천

research-helper-search-mode-recommend =
    .value = 컬렉션 기준: { $collection }

research-helper-search-state-initial-recommend = 컬렉션 프로필을 확인하면 추천 논문이 여기에 표시됩니다.

research-helper-search-recommend-build =
    .label = 프로필 만들기

research-helper-search-recommend-find =
    .label = 논문 찾기

research-helper-search-recommend-focus-label =
    .value = 초점

research-helper-search-recommend-terms-label =
    .value = 용어

research-helper-search-recommend-removed-label =
    .value = 제거됨

research-helper-search-recommend-authors-label =
    .value = 저자

research-helper-search-recommend-venues-label =
    .value = 게재처

research-helper-search-recommend-queries-label =
    .value = 검색어

research-helper-search-recommend-term-remove = ×
    .title = “{ $term }” 제거
    .aria-label = “{ $term }” 제거

research-helper-search-recommend-term-restore = 되돌리기
    .title = “{ $term }” 되돌리기
    .aria-label = “{ $term }” 되돌리기

research-helper-search-recommend-term-input =
    .placeholder = 용어 추가
    .aria-label = 용어 추가

research-helper-search-recommend-term-add =
    .label = 추가

research-helper-search-recommend-term-refused = API 키처럼 보여 추가하지 않았습니다.

research-helper-search-recommend-heuristic = 단어 집계 프로필: 모델이 작성하지 않았으므로 용어는 컬렉션 자체의 단어를 세어 뽑았습니다.

research-helper-search-recommend-heuristic-no-provider = 단어 집계 프로필: 설정된 모델이 없어 용어는 컬렉션 자체의 단어를 세어 뽑았습니다.

research-helper-search-recommend-heuristic-too-large = 단어 집계 프로필: 컬렉션이 너무 커서 모델에 보낼 수 없으므로 용어는 컬렉션 자체의 단어를 세어 뽑았습니다.

research-helper-search-recommend-egress-notice = “논문 찾기”를 누르면 다음 내용이 문헌 데이터베이스로 전송됩니다: 아래 검색어, 이 컬렉션의 논문 식별자 최대 { $papers }개, 제외한 논문의 식별자 최대 { $dismissed }개, 가장 자주 등장하는 저자 { $authors }명의 이름.

research-helper-search-recommend-egress-sources = 검색어는 환경설정에서 선택한 데이터베이스로 전송됩니다. 논문과 저자에 관한 요청은 환경설정 선택과 상관없이 PubMed, Europe PMC, Crossref로 전송되며, 키가 설정되어 있으면 Semantic Scholar로도 전송됩니다.

research-helper-search-recommend-queries-none = 검색어 없음: 모든 용어가 제거되었습니다.

research-helper-search-recommend-generator-recommendations = Semantic Scholar 추천 논문

research-helper-search-recommend-generator-similar = 유사 논문

research-helper-search-recommend-generator-forward-citations = 이 컬렉션을 인용한 논문

research-helper-search-recommend-generator-keyword-search = 키워드 검색

research-helper-search-recommend-generator-author-watch = 자주 등장하는 저자

research-helper-search-recommend-source-partial = 일부만 응답함

research-helper-search-recommend-source-could-not-ask = 요청 안 함: 요청할 내용 없음

research-helper-search-recommend-key-notice = Semantic Scholar 키가 있으면 추천이 더 좋아집니다. 키가 없으면 해당 목록은 요청하지 않고 유사도는 기본 방식으로 계산합니다.

research-helper-search-recommend-vectors-incomplete = 일부 논문의 벡터를 가져오지 못해 이 프로필을 저장하지 않았으며, 다음에 다시 만듭니다.

research-helper-search-recommend-profile-rebuilt = 프로필을 표시한 뒤 컬렉션이 바뀌어 검색 전에 프로필을 다시 만들었습니다.

research-helper-search-recommend-state-empty = 이 프로필로 찾은 논문이 없습니다. 용어를 바꿔 보세요.

research-helper-search-recommend-state-failed = 추천 논문을 찾지 못했습니다.

research-helper-search-recommend-collection-gone = 이 컬렉션은 더 이상 라이브러리에 없습니다.

research-helper-search-recommend-status-building = 컬렉션 프로필을 만드는 중…

research-helper-search-recommend-status-finding = 논문을 찾는 중…

research-helper-search-recommend-col-reason =
    .label = 이유

research-helper-search-recommend-col-dismiss =
    .label = 제외

research-helper-search-recommend-slider =
    .aria-label = 이 컬렉션에서 얼마나 멀리 찾을지 (익숙함에서 탐색까지)

research-helper-search-recommend-slider-familiar = 익숙함

research-helper-search-recommend-slider-exploratory = 탐색

research-helper-search-recommend-peer-reviewed =
    .label = 동료 심사 논문만

research-helper-search-recommend-show-dismissed =
    .label = 제외한 논문 표시

research-helper-search-recommend-dismissed-hint = 이전 실행에서 제외한 논문은 “논문 찾기”를 누르면 다시 나타납니다.

research-helper-search-recommend-not-interested = 관심 없음
    .title = 이 컬렉션에서 이 논문을 더 이상 표시하지 않기

research-helper-search-recommend-row-dismissed = 제외됨

research-helper-search-recommend-preprint = 프리프린트 (동료 심사 전)

research-helper-search-recommend-reason-recommended = Semantic Scholar 추천

research-helper-search-recommend-reason-cites = 컬렉션의 논문 { $count }편을 인용

research-helper-search-recommend-reason-author = { $names }: 컬렉션에 있는 저자

research-helper-search-recommend-reason-similarity = 컬렉션과 유사

research-helper-search-recommend-reason-similarity-basic = 컬렉션과 유사 (기본 유사도)

research-helper-search-recommend-reason-recency = 최근 논문

research-helper-search-recommend-reason-velocity = 빠르게 인용됨

research-helper-search-recommend-reason-novelty = 기존 논문과 다른 방향

research-helper-search-recommend-reason-venue = 컬렉션에 있는 학술지에 실림

research-helper-search-recommend-reason-agreement = 여러 검색에서 발견

research-helper-search-recommend-reason-coupling = 컬렉션과 참고문헌 공유

research-helper-search-recommend-reason-found = 이 컬렉션을 위해 찾은 논문

research-helper-search-recommend-group-numbered = 주제 { $number }

research-helper-search-recommend-group-none = 주제에 속하지 않음

research-helper-search-recommend-novelty-note = 이 목록은 컬렉션과 다른 방향의 논문을 더 많이 보여 줍니다. 기본 유사도는 여기 있는 모든 논문에서 거의 같게 나오므로 행마다 표시하지 않습니다.

research-helper-search-recommend-dismissed-status = 제외했습니다. 앞으로 이런 논문을 덜 보여 드립니다.

research-helper-search-recommend-dismissed-status-no-key = 제외했습니다. 이 논문은 이 컬렉션의 추천 논문에 나타나지 않습니다.

research-helper-search-recommend-dismiss-failed = 이 논문을 관심 없음으로 표시하지 못했습니다. 다음 실행에서 다시 나타날 수 있습니다.

research-helper-search-recommend-target-default = { $collection } — recommended { $date }

research-helper-search-recommend-similarity-no-vectors = 이 컬렉션의 어떤 논문에도 Semantic Scholar 벡터가 없어 이번 실행에서는 기본 유사도를 사용합니다.

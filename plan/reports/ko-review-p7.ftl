# P7-T05 1단계: 아직 검토하지 않은 ko-KR 문구 목록 (2026-11-21)
#
# 결과: 0개. 아직 검토하지 않은 화면 문구가 없어, 아래에 나란히 적을 문구도 없습니다.
#
# 확인한 방법 (2026-11-21, 커밋 0106721 의 작업 트리. f779190 다음의 이 커밋은 SECURITY.md, 출시 점검표, plan/00 만 바꿈):
# - en-US 묶음 세 개의 문구 569개, ko-KR 묶음 세 개의 문구 569개. 한국어가 없는 문구 0개, 주석으로만 남은 초안 0개.
# - src/i18n/keys.ts 의 KO_PENDING_REVIEW 는 비어 있습니다 (설명 주석만 있음). KO_DELIBERATELY_ABSENT 도 비어 있습니다.
# - src/pipeline/trendReport/reportLabels.ts 의 KO_REPORT_LABELS_PENDING_REVIEW (보고서 안 이름표) 도 비어 있습니다.
# - 한국어 문구마다 git 기록을 보고, 한국어를 마지막으로 정한 뒤에 영어가 바뀐 문구가 있는지 찾았습니다: 0개.
# - 지금 ko-KR 문구 가운데 335개는 승인 기록 파일 (plan/reports/ko-review-*.ftl, ko-review-*-draft.md) 의 글과 글자 그대로 같습니다.
#   나머지 234개는 그런 파일이 생기기 전에 들어갔고, 들어간 커밋의 기록에 승인이 적혀 있습니다:
#   2026-10-26 커밋 c00e82c (plan/00 6절 284번 (a), "검토 대기 147개 모두 검토") 133개, 2026-10-23 커밋 dc61675 44개,
#   946b2be 12개, d293a7e 8개, ff41539 6개, f109725 4개, 2c651f0 3개, 94af944 2개, 92d1b21, 188f988, 896b1ac, e9fb19b 각 1개.
#   메뉴 이름 5개 (menu-root, menu-search-import, menu-collection-rerun, menu-collection-summarize-all, menu-collection-report) 는
#   docs/08 10.2절에 직접 쓰신 한국어이고, prefs-backend-indeterminate 1개는 docs/09 1.9절의 한국어입니다.
#   데이터베이스 이름 7개, 제공 회사 이름 4개, DOI 열 이름 1개는 docs/08 10.3절에 따라 번역하지 않는 이름입니다.
# - 마지막 화면 문구 승인은 2026-11-18 (plan/00 6절 399번 (b), 첫 작업 안내 문구). 그 뒤 addon/locale 을 바꾼 커밋은 없습니다.
#
# 그래서 이번 검토는 지시문 두 개만 다룹니다: plan/reports/ko-review-p7-prompts.md, 채팅용 plan/reports/ko-review-p7-chat.md.

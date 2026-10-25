# research_helper — Korean strings for the Search & Import window.
#
# Same file name, same surface and the same identifiers as
# `locale/en-US/research-helper-searchDialog.ftl`; read that file's header for
# the placement rule, the attribute each entry sets, and the prefix rules
# (`docs/01` §9.1, §9.3, `docs/08` §10.1).
#
# ## This bundle carries exactly ONE message, and that is the human gate
#
# `P1-T18` carries a **human gate**: a native Korean speaker must review the
# `ko-KR` bundles, and an agent may draft them but must not sign them off.
# Nothing here was machine-translated. `docs/08` §10.2 ships owner-written
# Korean for the main-window menus only — it supplies **no Korean at all for
# this surface** — so the only entry below is the one `docs/08` §10.3 forbids
# translating:
#
# * `research-helper-search-col-doi` — "DOI" is not translated.
#
# Every other identifier in the en-US bundle is listed below as a comment with
# its English source. Until a native speaker fills them in, a Korean UI shows
# this entire window in English, resolved from `en-US` through the per-message
# fallback Gecko's `Localization` walks along the app-locale chain — measured
# on Zotero 10.0.1, not assumed (`docs/01` §9.1, `P0-T24`).
#
# **This is the single largest item the gate has to clear**, and it is reported
# as such: 61 strings, listed here in the order a reviewer will meet them in
# the window — 58 from `P1-T18` and the three `P1-T45` added for FR-8's
# provenance export. Fifteen more were reviewed by the owner on 2026-10-16 and
# are live: the five `P2-T14` added for the Semantic Scholar no-key notice, the
# two row badges and the `⊕` role row, `P2-T11`'s preprint policy line, and the
# nine `P2-T17` added for FR-12's re-run state. `src/i18n/keys.ts` exports the same list as
# `KO_PENDING_REVIEW`
# and `test/integration/l10n.spec.ts` asserts that the messages actually
# missing from this file are exactly that list, so a new en-US string cannot be
# added without either a Korean entry or an explicit entry on the review list.
#
# ## Notes for the reviewer
#
# * **Never concatenate.** Every counted string is one message with a
#   `{ $count }` selector. Korean has a single plural category, so keep the
#   selector with only `*[other]` rather than flattening it — that keeps the
#   English source and the Korean translation structurally parallel
#   (`docs/08` §10.2's note, §10.3).
# * **Do not translate** "PubMed", "Zotero", "DOI", "PMID", a provider name or
#   a model ID (`docs/08` §10.3).
# * **Do not set a font family** anywhere for Korean: glyph coverage is the
#   OS's job (`docs/08` §10.3).
# * Labels must not be given fixed widths — Korean menu labels can be longer
#   than English (`docs/08` §10.3). That is `P1-T20`'s markup, not this file's,
#   but it is what makes a longer Korean string safe to write.
# * A placeable may need to move: `{ $from }–{ $to }` and `{ $count }` can sit
#   anywhere in the Korean sentence. That freedom is the reason these are
#   single messages rather than assembled fragments.


## Window
##


## Query row (docs/08 §4.2, §4.5)
##
research-helper-search-mode-rerun =
    .value = 다시 실행: { $collection }


## Date range (docs/08 §4.2, FR-3)
##


## Per-database result limit (docs/08 §4.2)
##


## Database selection (docs/08 §4.2, FR-2)
##
research-helper-search-s2-no-key = Semantic Scholar에 API 키가 없어, 요청이 익명 공용 한도를 함께 쓰므로 제한이 심합니다.
#
# (P2-T14) Reviewed by the owner 2026-10-16 (G-41). en-US: "Request a free API key"
research-helper-search-s2-no-key-request = 무료 API 키 신청


## Client-side filtering (docs/08 §4.2, §4.5)
##


## Result table (docs/08 §4.2, §4.3, §9)
##

# Not translated (docs/08 §10.3). The one message this bundle ships.
research-helper-search-col-doi =
    .label = DOI

research-helper-search-row-duplicate = 중복 가능성
    .title = 다른 행과 중복일 수 있습니다({ $tier }, 유사도 { $score }%). 합친 것은 없습니다. 두 행을 확인하고 원하지 않는 행의 체크를 해제하세요.
#
# (P2-T14) Reviewed by the owner 2026-10-16 (G-41). en-US: "Other version"; `.title`: "Another row is a
# different version of this work, such as its preprint. Both are kept;
# nothing was merged."
research-helper-search-row-linked = 다른 판본
    .title = 다른 행이 이 논문의 다른 판본(예: 프리프린트)입니다. 둘 다 유지하며 합치지 않았습니다.
#
# (item 206) The deduplication tier names, shown inside the duplicate
# tooltip's `{ $tier }`; lower case, no full stop in en-US.
#
# Reviewed by the owner 2026-10-19 (G-41). en-US: "exact title match"
research-helper-search-tier-title-exact = 제목 완전 일치
#
# Reviewed by the owner 2026-10-19 (G-41). en-US: "close title match"
research-helper-search-tier-title-fuzzy = 제목 근사 일치
#
# Reviewed by the owner 2026-10-19 (G-41). en-US: "known preprint–published link"
research-helper-search-tier-version-link = 알려진 프리프린트–출판본 연결


## Selection controls (docs/08 §4.5, FR-5)
##


## Import target and duplicate policy (docs/08 §4.2, §4.4, §4.5, FR-51)
##
research-helper-search-preprint-policy = 프리프린트와 정식 출판본은 두 항목으로 유지되며 '관련 항목'으로 연결됩니다. 프리프린트에는 research_helper/superseded-by-published 태그가 붙습니다.


## Window buttons (docs/08 §4.5, FR-1, NFR-13)
##


## Provenance export (FR-8, P1-T45)
##
## None of these three takes a placeable, and the success sentence deliberately
## does not name the file that was written — `docs/09` §2.2 forbids the chosen
## path leaving the window. Do not add the path when translating.
##


## 1. INITIAL (docs/08 §8.4)
##


## 1a. Re-run, pre-filled from provenance (docs/08 §4.6, FR-12; P2-T17)
##
## `$collection` is the collection's own name and `$date` a date the window has
## already formatted; neither is translated. Keep the `{ $databases }` selector
## with only `*[other]`.
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US: "Re-run of the search that built
# “{ $collection }”"
research-helper-search-rerun-heading = “{ $collection }” 컬렉션을 만든 검색 다시 실행
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US, a `{ $databases }` selector: "Recorded { $date }
# · 1 database · { $retrieved } retrieved · { $imported } imported" /
# "Recorded { $date } · { $databases } databases · { $retrieved } retrieved ·
# { $imported } imported"
research-helper-search-rerun-recorded = { $date } 기록 · 데이터베이스 { $databases }개 · { $retrieved }건 받음 · { $imported }건 가져옴
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US `.label`: "as recorded"
research-helper-search-rerun-as-recorded =
    .label = 기록된 그대로
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US `.label`: "advance to today"
research-helper-search-rerun-advance =
    .label = 오늘까지로 늘리기
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US: "Keyword, sources and max-per-database are
# pre-filled from the stored provenance record, and all stay editable."
research-helper-search-rerun-prefilled = 키워드, 데이터베이스, 데이터베이스별 최대 건수는 저장된 검색 기록에서 채웠으며, 모두 고칠 수 있습니다.
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US: "Press Search to run it again. Unless Import
# anyway is chosen below, items already in your library are counted as
# “already present” and never imported twice."  ("Import anyway" is the label
# of research-helper-search-duplicates-import; keep the two in step.)
research-helper-search-rerun-press-search = '검색'을 누르면 다시 실행합니다. 아래에서 '그래도 가져오기'를 고르지 않으면, 이미 내 라이브러리에 있는 항목은 '이미 있음'으로 세고 두 번 가져오지 않습니다.
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US: "All years, as recorded"
research-helper-search-rerun-all-years = 모든 연도, 기록된 그대로
#
# (P2-T17) Reviewed by the owner 2026-10-16 (G-41). en-US: "Imported { $imported } · Already present
# { $present } · { $failed } failed"
research-helper-search-import-summary-rerun = 가져옴 { $imported } · 이미 있음 { $present } · 실패 { $failed }


## 2. LOADING (docs/08 §4.6, §8.4)
##
research-helper-search-source-role = ID 조회 · 프리프린트 대조
    .title = 이 서버는 키워드 검색이 없어 식별번호를 조회하고 프리프린트를 정식 출판본과 대조합니다. 프리프린트의 키워드 검색은 Europe PMC(SRC:PPR)와 Crossref(type:posted-content)에서 이루어집니다.


## 3. EMPTY (docs/08 §4.6, §8.4)
##


## 4. PARTIAL (docs/08 §8.4, FR-9)
##


## 5. ERROR (docs/08 §4.6, §8.4)
##

# Item 232: a source refused with HTTP 429 after the client's retries.
# `{ $database }` is a source display name and is not translated. Drafted by
# the coordinator, reviewed by the owner 2026-10-20 (G-41).
research-helper-search-error-rate-limit = { $database }: 요청이 너무 많아 거절됨 · 잠시 뒤 다시 시도하세요


## Error detail disclosure (NFR-14)
##

## Relevance screening (P3-T27; docs/08 §4.2, docs/12 §3)
##

## The estimated cost of screening (owner, 2026-10-24, plan/00 §6 item 281(b))
##


## Owner-reviewed Korean, item 284(a), batches 5-7 (G-41)
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-25 (G-41,
# plan/00 §6 item 284(a), batches 5-7).

research-helper-search-window-title = Research Helper — 검색 및 가져오기
research-helper-search-keyword-label =
    .value = 키워드
research-helper-search-keyword-input =
    .aria-label = 검색 키워드
research-helper-search-run =
    .label = 검색
    .tooltiptext = 선택한 데이터베이스에서 검색합니다
research-helper-search-mode-keyword =
    .value = 키워드
research-helper-search-years-label =
    .value = 연도
research-helper-search-years-span =
    { $years ->
       *[other] { $from } – { $to } (최근 { $years }년)
    }
research-helper-search-years-from =
    .aria-label = 가장 이른 출판 연도
research-helper-search-years-to =
    .aria-label = 가장 늦은 출판 연도
research-helper-search-years-custom =
    .label = 직접 지정…
research-helper-search-max-results-label =
    .value = 데이터베이스별 최대
research-helper-search-max-results-input =
    .aria-label = 데이터베이스별 최대 결과 수
research-helper-search-databases-label =
    .value = 데이터베이스
research-helper-search-databases-none = 검색할 데이터베이스를 하나 이상 선택하세요.
research-helper-search-filter-label =
    .value = 거르기
research-helper-search-filter-input =
    .aria-label = 이미 가져온 결과 안에서 거르기
research-helper-search-hide-existing =
    .label = 내 라이브러리에 이미 있는 항목 숨기기
research-helper-search-result-count = 결과 { $total }건 · 새 항목 { $new }건
research-helper-search-table =
    .aria-label = 검색 결과
research-helper-search-col-select =
    .aria-label = 선택
research-helper-search-col-title =
    .label = 제목
research-helper-search-col-authors =
    .label = 저자
research-helper-search-col-year =
    .label = 연도
research-helper-search-col-source =
    .label = 출처
research-helper-search-col-type =
    .label = 유형
research-helper-search-authors-overflow =
    { $names } 외 { $count }명
research-helper-search-row-existing = 이미 라이브러리에 있음: { $title }
research-helper-search-row-existing-badge =
    .aria-label = 내 라이브러리에 이미 있음
research-helper-search-select-all =
    .label = 모두 선택
research-helper-search-select-none =
    .label = 선택 해제
research-helper-search-select-invert =
    .label = 선택 반전
research-helper-search-selected-count =
    { $count ->
       *[other] { $count }개 선택됨
    }
research-helper-search-target-label =
    .value = 가져올 곳
research-helper-search-target-picker =
    .aria-label = 대상 컬렉션
research-helper-search-target-new =
    .label = 새 컬렉션…
research-helper-search-duplicates-label =
    .value = 중복 항목
research-helper-search-duplicates-skip =
    .label = 건너뛰기
research-helper-search-duplicates-link =
    .label = 기존 항목을 컬렉션에 추가
research-helper-search-duplicates-import =
    .label = 그래도 가져오기
research-helper-search-close =
    .label = 닫기
research-helper-search-cancel =
    .label = 취소
research-helper-search-import =
    .label =
        { $count ->
           *[other] { $count }개 항목 가져오기
        }
research-helper-search-export =
    .label = 출처 기록을 JSON으로 내보내기…
research-helper-search-export-written = 출처 기록을 내보냈습니다.
research-helper-search-export-failed = 출처 기록을 내보내지 못했습니다. 다른 위치를 골라 보세요.
research-helper-search-state-initial = 키워드를 입력하고 검색을 누르면 선택한 데이터베이스에서 최근 { $years }년 동안의 논문을 찾습니다.
research-helper-search-source-searching = 검색하는 중…
research-helper-search-source-results =
    { $count ->
       *[other] 결과 { $count }건
    }
research-helper-search-source-failed = 실패 — { $reason }
research-helper-search-progress-databases = 데이터베이스 { $total }개 중 { $done }개 완료
research-helper-search-status-searching =
    { $database } 검색 중…
research-helper-search-status-importing =
    { $total }개 중 { $done }개 가져오는 중…
research-helper-search-state-empty =
    { $from }–{ $to } 기간에 “{ $query }”에 해당하는 논문이 없습니다.
research-helper-search-state-empty-suggestions = 연도 범위를 넓히거나, 따옴표를 빼거나, 데이터베이스를 더 선택해 보세요.
research-helper-search-row-no-content = 초록도, 색인된 본문도 없어 건너뜁니다.
research-helper-search-state-partial =
    { $failed ->
       *[other] 데이터베이스 { $failed }개를 검색하지 못했습니다. 아래 결과는 나머지 { $succeeded }개에서 가져온 것입니다.
    }
research-helper-search-state-error = 어떤 데이터베이스에도 연결할 수 없습니다.
research-helper-search-state-error-open-preferences =
    .label = 설정 열기…
research-helper-search-state-error-retry =
    .label = 다시 시도
research-helper-search-details-show =
    .label = 자세히 보기
research-helper-search-details-hide =
    .label = 자세히 숨기기
research-helper-search-screening-enable =
    .label = AI 모델로 결과의 관련도 걸러내기
research-helper-search-screening-threshold-label =
    .value = 관련도 기준
research-helper-search-screening-threshold-input =
    .aria-label = 관련도 기준(0~100)
research-helper-search-screening-show-excluded =
    .label = 걸러낸 결과도 보기
research-helper-search-screening-count = 결과 { $total }건 중 { $kept }건 가져옴 · 기준 미만 { $excluded }건
research-helper-search-screening-unscored = AI 모델이 결과 { $count }건의 점수를 매기지 못했습니다. 이 결과는 점수 없이 보이며 숨기지 않습니다.
research-helper-search-screening-failed = 관련도 걸러내기를 실행하지 못해, 어떤 결과에도 점수가 없고 숨긴 결과도 없습니다.
research-helper-search-row-relevance =
    관련도 { $score }
    .title = AI 모델이 매긴 관련도 점수(0~100)입니다. 기준보다 낮은 줄은 ‘걸러낸 결과도 보기’를 켜야 보입니다.
research-helper-search-screening-cost = 걸러내기 예상 비용: 결과 최대 { $count }건에 최대 약 { $cost }
research-helper-search-screening-cost-unpriced = 모델 { $model }의 가격을 알 수 없어 걸러내기 비용을 어림할 수 없습니다.

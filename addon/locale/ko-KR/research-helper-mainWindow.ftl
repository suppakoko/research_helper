# research_helper — Korean strings injected into Zotero's own main window.
#
# Same file name, same surface and the same identifiers as
# `locale/en-US/research-helper-mainWindow.ftl`; read that file's header for
# the placement rule, the prefix rules and the `rh-error-*` exception
# (`docs/01` §9.1, §9.3). The locale code is `ko-KR` exactly — there is no
# bare `ko` (`docs/08` §10.1).
#
# ## This bundle is INCOMPLETE, and that is the current state of the card
#
# `P1-T18` carries a **human gate**: a native Korean speaker must review this
# bundle, and an agent may draft it but must not sign it off. No string below
# was machine-translated. What is present is only what an owner has already
# supplied or what must not be translated at all:
#
# * `research-helper-menu-root`, `research-helper-menu-search-import` and
#   `research-helper-menu-collection-rerun` (`P2-T17`) — taken verbatim from
#   `docs/08` §10.2, which ships owner-written Korean for them.
#   `"리서치 헬퍼"` is measured working on Zotero 10.0.1 (`P0-T24`).
# * `research-helper-source-pubmed`, `research-helper-source-europepmc`,
#   `research-helper-source-crossref`, `research-helper-source-arxiv`,
#   `research-helper-source-semanticscholar`, `research-helper-source-biorxiv` and
#   `research-helper-source-medrxiv` — `docs/08` §10.3 forbids translating a
#   database name, so the Korean bundle carries them unchanged. Not translations, and nothing for a reviewer to
#   decide.
# * `research-helper-provider-openrouter`, `research-helper-provider-openai`,
#   `research-helper-provider-anthropic` and `research-helper-provider-gemini`
#   — provider names, which `docs/08` §10.3 likewise forbids translating
#   (owner, 2026-10-21, `plan/00` §6 item 262(b)).
# * `research-helper-prefs-backend-indeterminate` — taken verbatim from
#   `docs/09` §1.9, which ships the owner's Korean for the key-storage
#   badge's fifth state (decided 2026-10-15, owner review row 50; `P2-T34`).
#
# **Every other identifier in the en-US bundle is listed below as a comment,
# with its English source, and needs a native speaker.** Until then a Korean UI
# resolves them from `en-US` through the second fallback layer Gecko's
# `Localization` provides along the app-locale chain — measured, not assumed
# (`docs/01` §9.1, `P0-T24`). That is a visible gap, which is the point: a
# plausible-looking wrong translation is worse than English.
#
# `src/i18n/keys.ts` exports the pending list as `KO_PENDING_REVIEW` and
# `test/integration/l10n.spec.ts` asserts that the messages actually missing
# from this file are exactly that list — so a new en-US string cannot be added
# without either a Korean entry or an explicit entry on the review list.
#
# ## One key is absent permanently, not pending
#
# `research-helper-menu-spike-create-item` exists in `en-US` and is absent here
# **on purpose**, so that `FR-55`'s English fallback for a missing key stays
# observable. `test/integration/l10n.spec.ts` asserts both that it is absent
# from this bundle and that it still resolves to the English label under a
# Korean UI (spike `V-17`, `P0-T24`). It is on `KO_DELIBERATELY_ABSENT`, not on
# the review list. Do not "fix" the gap without moving the fallback assertion
# to another key.


## Tools ▸ Research Helper, and the collection context menu (docs/08 §2.4, §2.5)

research-helper-menu-root =
    .label = 리서치 헬퍼

research-helper-menu-search-import =
    .label = 검색 및 가져오기…


# FR-12's entry (P2-T17), taken verbatim from `docs/08` §10.2, which ships the
# owner's Korean for it beside the en-US "Re-run This Search…".
research-helper-menu-collection-rerun =
    .label = 이 검색 다시 실행…


## Literature source display names — never translated (docs/08 §10.3)

research-helper-source-pubmed = PubMed
research-helper-source-europepmc = Europe PMC
research-helper-source-crossref = Crossref
research-helper-source-arxiv = arXiv
research-helper-source-semanticscholar = Semantic Scholar
research-helper-source-biorxiv = bioRxiv
research-helper-source-medrxiv = medRxiv


## LLM provider display names — never translated (docs/08 §10.3)

research-helper-provider-openrouter = OpenRouter
research-helper-provider-openai = OpenAI
research-helper-provider-anthropic = Anthropic
research-helper-provider-gemini = Google Gemini


## Search provenance (FR-8)
##


## Import outcome (docs/08 §4.4, FR-51)
##
research-helper-import-paths = Zotero 중계기로 { $translated } · 검색 결과에서 { $handMapped }
#
# (P2-T18) Reviewed by the owner 2026-10-16 (G-41). en-US, a `{ $cause }` selector over five tokens, each
# variant ending ": { $count }": [lookup-error] "Translator lookup failed",
# [no-translators] "No translator for the identifier", [no-result] "Translator
# lookup found nothing", [timeout] "Translator lookup timed out",
# *[no-identifier] "No DOI, PMID or arXiv ID". "DOI", "PMID" and "arXiv" stay
# as they are (`docs/08` §10.3).
research-helper-import-fallback-reason =
    { $cause ->
        [lookup-error] 중계기 조회 실패: { $count }
        [no-translators] 식별번호에 맞는 중계기 없음: { $count }
        [no-result] 중계기 조회 결과 없음: { $count }
        [timeout] 중계기 조회 시간 초과: { $count }
       *[no-identifier] DOI, PMID, arXiv ID 없음: { $count }
    }


## The progress popup's headline (docs/07 §7.7, docs/08 §8.2 — P1-T32, P1-T33)
##
## **One stub fewer than before.** `research-helper-import-toast-header` stood
## here with a stub carrying the identical en-US source, `Research Helper`, and
## was retired by `P1-T33`: §4.4's completion toast and §7.7's per-job popup
## are one surface, so the headline is one id. `G-41` therefore has one
## product-name decision here, not two identical ones. Nothing was translated
## by that card; the reasoning is in `src/i18n/keys.ts`.
##
# The headline of the `Zotero.ProgressWindow` each job raises. `G-41` owns this
# translation and `P1-T32` is forbidden to draft it: the en-US text is the
# product name, `docs/08` §10.2 renders the product name as `리서치 헬퍼` in menu
# labels, and whether the headline follows that or becomes a Korean sentence
# (Zotero's own in-tree headline is a sentence — see the en-US bundle's note)
# is an owner decision. Until the gate clears a Korean UI resolves this from
# `en-US` through the second fallback layer `P0-T24` measured, which is a
# visible gap and is the point: a plausible wrong translation is worse than
# English. On `KO_PENDING_REVIEW` in `src/i18n/keys.ts`.


## User-facing error strings — `ResearchHelperError.messageKey`
##
## All twenty need a native speaker (sixteen until `P3-T05` added the four
## LLM strings on 2026-10-20). Their ids are fixed by
## `src/core/errors.ts` and carry the `rh-error-` prefix, not
## `research-helper-` — see the en-US bundle's note on that conflict.
##
## `docs/08` §10.3 applies to every one of them: do not translate a provider
## name, a database name or a model ID, and never reorder by concatenating
## fragments — each is a single message with placeables, and Korean word order
## may place them differently from English, which is exactly why a translator
## rather than a substitution is needed.
##

# `P3-T05` (2026-10-20): the four LLM error strings. Drafted by the
# coordinator and reviewed by the owner on 2026-10-20 (G-41); nothing was
# machine-translated. `{ $provider }` and `{ $model }` stay untranslated
# (`docs/08` §10.3).
rh-error-llm = { $provider }에서 요청을 처리하지 못했습니다.
rh-error-context-length = 글이 너무 길어 { $model } 모델이 한 번에 읽을 수 없습니다.
rh-error-content-filter = 모델이 이 논문의 요약을 거절했습니다.
rh-error-structured-output = { $provider }에서 받은 요약을 Research Helper가 읽지 못했습니다.

# Item 265(c) (owner, 2026-10-21): `OutputTruncatedError`, a truncated answer.
# The coordinator drafts the Korean and the owner reviews it (G-41); nothing
# was machine-translated. `{ $model }` stays untranslated (`docs/08` §10.3).
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-21 (G-41).
rh-error-output-truncated = { $model } 모델의 출력 길이 한도에 걸려 요약이 잘렸습니다.

# Item 262(c) (owner, 2026-10-21): OpenRouter's guardrail 404. The coordinator
# drafts the Korean and the owner reviews it (G-41); nothing was
# machine-translated. Keep "Strict" and "Balanced" as the privacy-mode menu's
# Korean labels once those exist; `{ $model }` stays untranslated.
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-21 (G-41).
rh-error-privacy-routing = OpenRouter에는 개인정보 모드 조건에 맞게 { $model } 모델을 제공하는 곳이 없습니다. 다른 모델을 고르거나, 개인정보 모드가 ‘엄격’이면 ‘균형’으로 바꾸세요. ‘균형’은 글을 일정 기간 보관하는 제공자와 PDF 본문 전송을 허용하지만, 데이터를 학습에 쓸 수 있는 제공자는 여전히 거부합니다.

# P3-T16 (2026-10-23): BudgetExceededError, a spend ceiling reached (the job
# pauses; plan/00 §6 item 234). $limit and $spent are dollar amounts formatted
# by the caller.
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-23 (G-41,
# plan/00 §6 item 274).
rh-error-budget = 지출 한도({ $limit })에 도달해 멈췄습니다. 지금까지 쓴 금액: { $spent }. 이미 만든 요약은 그대로 있습니다.


## The preference pane's key-storage badge (docs/09 §1.9; P1-T44, P2-T34)
##
## One string of the pane is owner-written: the indeterminate state's wording
## is `docs/09` §1.9's, Korean included (owner, 2026-10-15, review row 50).
## Every other `research-helper-prefs-*` id is still on `KO_PENDING_REVIEW` and
## resolves from en-US until a native speaker reviews it.

research-helper-prefs-backend-indeterminate = 확인 불가 — 이 운영체제에서는 열쇠 보관 등급을 판별할 수 없습니다


## The import-path preference (P2-T18; docs/01 §6.3 item 3, docs/07 §8.5, §12.1)
##
## (P2-T18) Reviewed by the owner 2026-10-16 (G-41). en-US `.label`: "Fetch metadata through Zotero
## translators (slower, more accurate)". en-US `.tooltiptext`: "Each record is
## looked up through Zotero's translators over the network, one at a time, so an
## import takes longer. A record the lookup cannot resolve is imported from the
## search results instead." "Zotero" stays as it is (`docs/08` §10.3). Nothing
## here was machine-translated; the Korean below was reviewed by the owner on 2026-10-16.
research-helper-prefs-use-translators =
    .label = Zotero 중계기로 서지 정보 가져오기(느리지만 더 정확함)
    .tooltiptext = 각 기록을 Zotero 중계기로 네트워크에서 하나씩 조회하므로 가져오기가 오래 걸립니다. 조회로 찾지 못한 기록은 검색 결과에서 가져옵니다.


## The job queue's resume notice (P3-T34; docs/07 §7.6, plan/00 §6 item 250)
##
## Drafted by the coordinator and reviewed by the owner on 2026-10-21 (G-41);
## nothing here was machine-translated. Korean has a single plural category,
## so the entry keeps the selector with only `*[other]` (`docs/08` §10.2).

research-helper-job-resumed =
    { $count ->
       *[other] Zotero가 닫히면서 중단된 백그라운드 작업 { $count }개를 Research Helper가 다시 시작했습니다.
    }


## The batch wall-clock budget's question (owner, 2026-10-21, plan/00 §6 item
## 265; docs/03 §11.6, docs/07 §7.5)
##
## The coordinator drafts the Korean and the owner reviews it (G-41); nothing
## here was machine-translated. Korean has a single plural category, so the
## entry keeps the selector with only `*[other]` (`docs/08` §10.2).
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-21 (G-41).

research-helper-job-wall-clock-budget =
    { $minutes ->
       *[other] { $minutes }분 동안 작업한 뒤 멈췄습니다. { $total }편 중 { $done }편 완료 — 나머지를 계속할까요?
    }


## The egress disclosure's two notices (P3-T15; docs/09 §3.6)
##
## The coordinator drafts the Korean and the owner reviews it (G-41); nothing
## here was machine-translated. "Research Helper", "API" and "Google" stay as
## they are (`docs/08` §10.3).
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-22 (G-41,
# plan/00 §6 item 269(a)).

research-helper-egress-first-job-notice = Research Helper는 사용자의 컴퓨터에서 실행되고 사용자의 API 키를 쓰며, 개발자에게는 아무것도 보내지 않습니다. 그렇다고 제공자에게까지 자료가 비공개로 유지되는 것은 아닙니다. 위에 적힌 내용은 사용자가 고른 제공자에게 전송되며, 제공자는 자체 약관에 따라 이를 처리합니다. 확인을 누르면 이 안내를 읽었다는 사실만 기록됩니다. 이 창이나 창 안의 경고가 꺼지지는 않습니다.
research-helper-egress-gemini-free-tier = 이 Google API 키는 무료 등급으로 보입니다. Google 약관에 따르면 무료 등급으로 보낸 내용은 Google 제품 개선에 쓰이며, 사람 검토자가 읽을 수 있습니다. 발표하지 않았거나 기밀인 자료에는 무료 등급을 쓰지 마세요.

# Korean drafted by the coordinator and reviewed by the owner on 2026-10-23 (G-41,
# plan/00 §6 item 270(b)).
research-helper-egress-gemini-declared-paid = 이 Google API 키는 Research Helper 설정에서 유료 키로 표시되어 있습니다. 실제로 무료 등급이라면 Google이 보낸 내용을 제품 개선에 쓸 수 있습니다.


## The cost confirmation dialog and the Usage readout (P3-T16; docs/06 §5.4,
## docs/10 FR-24, docs/09 §3.6)
##
## Money, counts and dates arrive formatted by the caller; `$ceiling`
## (`run` / `session`) and `$mode` (`strict` / `balanced` / `full`) are
## selectors; `$provider`, `$host` and `$model` are never translated. Korean
## has one plural category, so `$calls` keeps only `*[other]` (`docs/08`
## §10.2). Text is never joined to a placeholder by a particle.
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-23 (G-41,
# plan/00 §6 item 274).

research-helper-cost-title = Research Helper — 예상 비용
research-helper-cost-items = 논문 { $items }편 · 본문 포함 { $fullText } · 초록만 { $abstract } · 이미 요약됨 { $cached } · 보낼 내용 없음 { $metadata }
research-helper-cost-destination =
    { $provider }({ $host })의 { $model } 모델로 보냅니다. 개인정보 모드: { $mode ->
        [strict] 엄격
        [full] 전체
       *[balanced] 균형
    }.
research-helper-cost-calls =
    { $calls ->
       *[other] 모델 호출 { $calls }회
    }
research-helper-cost-input = 예상 입력: 약 { $tokens } 토큰
research-helper-cost-output = 예상 출력: 최대 { $tokens } 토큰
research-helper-cost-total = 예상 비용: 약 { $cost }
research-helper-cost-unpriced = 모델 { $model }의 가격을 알 수 없어 이번 실행의 비용을 어림할 수 없습니다.
research-helper-cost-disclaimer = 어림값이며 실제 비용과 다를 수 있습니다. 가격 기준일: { $date }.
research-helper-cost-above-threshold = 설정하신 확인 기준액({ $threshold })보다 많습니다.
research-helper-cost-acknowledge =
    .label = 이번 실행에 약 { $cost }의 비용이 들 수 있음을 이해합니다.
research-helper-cost-acknowledge-unpriced =
    .label = 이번 실행의 비용을 알 수 없음을 이해합니다.
research-helper-cost-downgrade =
    .label = 대신 초록만 보내기(약 { $cost })
research-helper-cost-downgrade-preselected = 논문이 { $max }편을 넘어 ‘초록만 보내기’가 선택되어 있습니다. 본문을 보내려면 선택을 해제하세요.
research-helper-cost-ceiling-preflight =
    { $ceiling ->
        [session] 이 예상 비용은 이번 Zotero 세션의 지출 한도({ $limit })를 넘습니다. 이미 쓴 금액: { $spent }. 실행하면 이번 실행에 한해 한도가 { $raised }까지 올라갑니다.
       *[run] 이 예상 비용은 실행당 지출 한도({ $limit })를 넘습니다. 실행하면 이번 실행에 한해 한도가 { $raised }까지 올라갑니다.
    }
research-helper-cost-ceiling-reached =
    { $ceiling ->
        [session] 이번 Zotero 세션의 지출 한도({ $limit })에 도달해 멈췄습니다. 이번 세션에 지금까지 쓴 금액: { $spent }. 이미 만든 요약은 모두 그대로 있습니다. 계속하면 이번 실행에 한해 한도가 { $raised }까지 올라갑니다.
       *[run] 실행당 지출 한도({ $limit })에 도달해 멈췄습니다. 이번 실행에서 지금까지 쓴 금액: { $spent }. 이미 만든 요약은 모두 그대로 있습니다. 계속하면 이번 실행에 한해 한도가 { $raised }까지 올라갑니다.
    }
research-helper-cost-usage-job =
    이 작업의 지금까지 사용량: { $calls ->
       *[other] 호출 { $calls }회
    }, 입력 토큰 { $input }개, 출력 토큰 { $output }개, { $cost }.
research-helper-cost-usage-session =
    이번 Zotero 세션 사용량: { $calls ->
       *[other] 호출 { $calls }회
    }, 입력 토큰 { $input }개, 출력 토큰 { $output }개, { $cost }.
research-helper-cost-usage-estimated = 제공자가 사용량을 알려 주지 않았거나 가격을 알 수 없어, 일부 수치는 어림값입니다.
research-helper-cost-dont-ask =
    .label = 이 컬렉션은 다시 묻지 않기
research-helper-cost-run =
    .label = 실행
research-helper-cost-cancel =
    .label = 취소
research-helper-cost-continue =
    .label = 계속
research-helper-cost-stop =
    .label = 중지
research-helper-cost-skipped-notice =
    예상 비용: { $calls ->
       *[other] 호출 { $calls }회
    }에 약 { $cost }. 어림값이며 실제 비용과 다를 수 있습니다.
research-helper-prefs-usage = 사용량
research-helper-prefs-usage-limit = 이번 Zotero 세션의 지출 한도: { $limit }. Zotero를 다시 시작하면 초기화됩니다.
research-helper-prefs-usage-limit-off = 이번 Zotero 세션에는 지출 한도가 설정되어 있지 않습니다.


## The key-storage degradation dialog (P3-T03; docs/09 §1.7, gate G-10)
##
## The coordinator drafts the Korean and the owner reviews it (G-41); nothing
## here was machine-translated. "API", "NCBI" and "Zotero" stay as they are
## (`docs/08` §10.3).
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-22 (G-41,
# plan/00 §6 item 268(a)).

research-helper-secret-backend-title = Research Helper가 이 컴퓨터에 API 키를 저장할 수 없습니다
research-helper-secret-backend-explain = Research Helper는 API 키를 운영체제의 자격 증명 저장소에만 보관하는데, 그 저장소를 쓸 수 없습니다. 키는 다른 어디에도 저장하지 않습니다. 어떻게 계속할지 고르세요.
research-helper-secret-backend-session = 이번 세션 동안만 키를 보관합니다. 키는 메모리에만 두고 어디에도 쓰지 않습니다. Zotero를 시작할 때마다 다시 입력해야 하며, 입력할 때까지 키가 필요한 백그라운드 작업은 멈춥니다.
research-helper-secret-backend-none = 키를 저장하지 않고 계속합니다. 검색과 가져오기는 그대로 되지만, NCBI 키가 없으면 더 느립니다. 요약처럼 키가 필요한 기능은 꺼진 채로 있습니다.
research-helper-secret-backend-accept =
    .label = 이번 세션만 키 보관
research-helper-secret-backend-decline =
    .label = 키 없이 계속


## The LLM provider blocks, tier 2's badge and the restore notice (P3-T04;
## docs/08 §7.3, docs/09 §1.9 items 3 and 8, docs/03 §14.4)
##
## "API", "URL", "Zotero", "Research Helper", "Google" and "https://" stay as
## they are (`docs/08` §10.3).
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-23 (G-41,
# plan/00 §6 item 274).

research-helper-prefs-backend-session = 세션 사이에 저장되지 않음
research-helper-prefs-restore-note = 이 컴퓨터에는 저장된 API 키가 없지만, 이 Zotero 데이터 폴더에는 이미 Research Helper 데이터가 있습니다. 다른 컴퓨터에서 폴더를 복원하거나 복사했다면 키를 다시 입력하세요. API 키는 이 컴퓨터의 자격 증명 저장소에 저장되며 Zotero 데이터 폴더와 함께 옮겨지지 않습니다.
research-helper-prefs-providers = AI 모델 제공자
research-helper-prefs-active-provider =
    .value = 사용할 제공자
research-helper-prefs-api-key =
    .value = API 키
research-helper-prefs-model =
    .value = 모델
research-helper-prefs-base-url =
    .value = 기본 URL
research-helper-prefs-base-url-saved = 저장했습니다. 이제 이 제공자에 대한 요청은 이 주소로 갑니다.
research-helper-prefs-base-url-default = 지웠습니다. 이 제공자에 대한 요청은 빈 칸에 표시된 제공자 자체 주소로 갑니다.
research-helper-prefs-base-url-not-https = 저장하지 않았습니다. 주소는 https://로 시작해야 합니다. 이전 설정을 유지합니다.
research-helper-prefs-base-url-trailing-slash = 저장하지 않았습니다. 주소 끝의 슬래시(/)를 지우세요. 이전 설정을 유지합니다.
research-helper-prefs-base-url-invalid = 저장하지 않았습니다. https://proxy.example/v1 처럼 완전한 주소를 사용자 이름, 비밀번호, ?, # 없이 입력하세요. 이전 설정을 유지합니다.
research-helper-prefs-gemini-paid-tier =
    .label = 이 키의 Google Cloud 프로젝트에 결제 계정이 연결되어 있음을 직접 확인합니다(Google 유료 등급)
research-helper-prefs-gemini-paid-tier-note = 사용자 본인의 확인입니다. Research Helper는 키의 등급을 확인할 수 없으므로, 직접 켜지 않는 한 꺼져 있습니다. Google 무료 등급에서는 보낸 내용이 Google 제품 개선에 쓰이고 사람 검토자가 읽을 수 있습니다. 이 항목을 켜 두면 모든 개인정보 모드에서 Gemini 모델을 쓸 수 있으며, 작업마다 키가 유료로 표시되어 있다는 알림은 계속 보입니다.


## docs/09 §1.8's two tier-2 replacements, shown in place of risk paragraphs
## 1 and 4 while `secretBackend` is `session` (owner, 2026-10-23, plan/00 §6
## items 274(a) and 275(b); gate G-19). G-41 owns the translation; nothing was
## machine-translated.

# Korean drafted by the coordinator and reviewed by the owner on 2026-10-23 (G-41, plan/00 §6 item 275).
research-helper-prefs-risk-1-session = API 키는 이번 Zotero 세션 동안 메모리에만 보관됩니다. 운영체제의 자격 증명 저장소, Zotero의 로그인 관리자, 디스크 어디에도 쓰지 않으며, Zotero를 닫으면 사라지므로 다시 시작한 뒤에는 키를 다시 입력해야 합니다.
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-23 (G-41, plan/00 §6 item 275).
research-helper-prefs-risk-4-session = 메모리에 있는 키도 같은 사용자 계정에서 실행되는 다른 프로그램(다른 Zotero 플러그인 포함)으로부터는 보호되지 않습니다. Zotero는 플러그인끼리 격리하지 않습니다.


## The LLM Test, the model suggestions and the user price table (P3-T14;
## docs/09 §2.3, docs/03 §9, plan/00 §6 item 265(b)). G-41 owns the
## translation; every entry is a commented stub with its English source, and
## nothing was machine-translated. `$provider` and `$model` are names, never
## translated (docs/08 §10.3).


## Owner-reviewed Korean, item 284(a), batches 1-4 (G-41)
##
# Korean drafted by the coordinator and reviewed by the owner on 2026-10-25 (G-41,
# plan/00 §6 item 284(a), batches 1-4).

research-helper-menu-collection-search-import =
    .label = 이 컬렉션으로 검색 및 가져오기…
research-helper-provenance-note-title = Research Helper — 검색 출처 기록 { $timestamp }
research-helper-import-summary = 가져옴 { $imported } · 연결됨 { $linked } · 중복 건너뜀 { $skipped } · 실패 { $failed }
research-helper-import-abstract-coverage = 가져온 항목 중 초록이 있는 비율: { $percent }%
research-helper-progress-headline = Research Helper
rh-error-configuration = 이 작업에 필요한 Research Helper 설정이 올바르지 않습니다.
rh-error-missing-credential =
    { $provider }의 API 키가 설정되어 있지 않습니다.
rh-error-network =
    { $host }에 연결할 수 없습니다.
rh-error-offline = Zotero가 오프라인 상태입니다.
rh-error-timeout =
    { $host }에서 { $seconds }초 안에 응답이 없습니다.
rh-error-auth =
    { $provider }에서 API 키를 거부했습니다(HTTP { $status }).
rh-error-forbidden =
    { $provider }에서 요청을 거절했습니다(HTTP { $status }).
rh-error-rate-limit =
    { $provider } 요청 한도에 도달했습니다. { $seconds }초 뒤에 다시 시도합니다.
rh-error-quota =
    { $provider } 계정의 크레딧이 모두 소진되었습니다.
rh-error-upstream =
    { $database } 서비스를 일시적으로 사용할 수 없습니다(HTTP { $status }). 다른 데이터베이스는 계속 검색했습니다.
rh-error-bad-request = Research Helper가 보낸 요청을 { $database }에서 받아들이지 못했습니다.
rh-error-source =
    { $database }에서 검색을 끝내지 못했습니다.
rh-error-parse =
    { $database }의 응답을 읽을 수 없습니다.
rh-error-zotero = Zotero에서 변경을 완료하지 못했습니다.
rh-error-storage = Research Helper가 저장소에 쓰지 못했습니다.
rh-error-cancelled =
    { $imported ->
       *[other] 취소했습니다. 이미 { $imported }개 항목을 가져왔습니다.
    }
research-helper-prefs-storage = 저장된 API 키
research-helper-prefs-backend-windows = Windows 자격 증명 관리자로 보호됨
research-helper-prefs-backend-mac = macOS 키체인으로 보호됨
research-helper-prefs-backend-unavailable = 이 컴퓨터에는 사용할 수 있는 자격 증명 저장소가 없습니다. 저장소가 생기기 전까지는 키를 저장할 수 없습니다.
research-helper-prefs-risk-1 = API 키는 운영체제의 자격 증명 저장소로 암호화되어 Zotero의 로그인 관리자에 저장됩니다. 실제로 쓰이는 저장소는 설정 화면의 키 입력란 옆에 표시됩니다.
research-helper-prefs-risk-2 = 그 저장소가 Windows 자격 증명 관리자, macOS 키체인 또는 Linux 시스템 키링이면 키는 Zotero 폴더 밖에 보관됩니다. 그 폴더를 복사하거나 백업에서 복원해도 키는 함께 옮겨지지 않으며, 이 컴퓨터의 다른 사용자 계정은 키를 읽을 수 없습니다.
research-helper-prefs-risk-3 = 설정 화면에 키가 Zotero 자체 데이터베이스에 저장된다고 표시되면 이 보호가 적용되지 않습니다. 키가 Zotero 프로필 안에 있으므로 프로필을 복사하거나 백업하면 키도 함께 옮겨지고, Zotero 기본 비밀번호를 설정한 경우에만 그것으로 보호됩니다. 기본 비밀번호를 설정하거나, 그 컴퓨터에는 키를 저장하지 마세요.
research-helper-prefs-risk-4 = 이 방식은 같은 사용자 계정에서 실행되는 소프트웨어로부터는 키를 보호하지 않습니다. 운영체제는 사용자 권한으로 실행되는 모든 프로그램에 키를 복호화해 주므로, 사용자가 실행하는 어떤 프로그램(다른 Zotero 플러그인 포함)도 키를 복호화할 수 있습니다. Zotero는 플러그인끼리 격리하지 않습니다.
research-helper-prefs-risk-5 = 이 키는 브라우저에 저장한 비밀번호처럼 다루세요. 제공자 쪽에 지출 한도를 설정하고, 노출되었을 수 있는 키는 바꾸세요.
research-helper-prefs-remove-all =
    .label = 저장된 키 모두 지우기
research-helper-prefs-remove-all-done =
    { $count ->
       *[other] 저장된 키 { $count }개를 지웠습니다.
    }
research-helper-prefs-ncbi = NCBI (PubMed)
research-helper-prefs-ncbi-note = NCBI API 키가 있으면 초당 요청 한도가 3회에서 10회로 늘어납니다. 키가 없어도 검색은 되지만 더 느립니다.
research-helper-prefs-ncbi-key =
    .value = API 키
research-helper-prefs-s2 = Semantic Scholar
research-helper-prefs-s2-note = 관련 논문과 추천 기능에는 키가 필요합니다. 키 없이 쓰는 공용 한도는 거의 쓸 수 없을 만큼 제한되어 있습니다. 무료이지만 승인에 시간이 걸립니다.
research-helper-prefs-s2-key =
    .value = API 키
research-helper-prefs-s2-request = API 키 신청하기
research-helper-prefs-reveal =
    .label = 누르고 있는 동안 보기
research-helper-prefs-test-key =
    .label = 시험
research-helper-prefs-clear-key =
    .label = 지우기
research-helper-prefs-key-absent = 저장된 키가 없습니다.
research-helper-prefs-key-absent-os = 저장된 키가 없습니다. API 키는 이 컴퓨터의 자격 증명 저장소에 저장되며 Zotero 데이터 폴더와 함께 옮겨지지 않습니다.
research-helper-prefs-key-present = 키가 저장되어 있습니다. 아직 시험하지 않았습니다.
research-helper-prefs-key-cleared = 키를 지웠습니다.
research-helper-prefs-store-unavailable = 이 키는 저장되지 않았습니다. 이 컴퓨터에는 사용할 수 있는 자격 증명 저장소가 없습니다.
research-helper-prefs-store-empty = 저장할 내용이 없습니다. 앞뒤 공백을 지우니 입력란이 비어 있습니다.
research-helper-prefs-test-running = 시험하는 중…
research-helper-prefs-test-ok = 키가 유효합니다 · { $time } 확인
research-helper-prefs-test-inconclusive = 이 키를 확인하지 못했습니다 · { $time } 확인
research-helper-prefs-test-rejected = 서비스가 이 키를 거부했습니다(HTTP 401) · { $time } 확인
research-helper-prefs-test-forbidden = 서비스가 요청을 거절했습니다(HTTP 403) · { $time } 확인
research-helper-prefs-test-absent = 시험하기 전에 키를 저장하세요.
research-helper-prefs-test-unavailable = 사용할 수 있는 자격 증명 저장소가 없어 시험할 키가 없습니다.
research-helper-prefs-test-ok-no-credit = 키는 유효하지만 계정 잔액이 없습니다 · { $time } 확인
research-helper-prefs-test-ok-rate-limited = 키가 유효합니다. 제공자가 지금 요청을 제한하고 있습니다(HTTP 429) · { $time } 확인
research-helper-prefs-model-suggestions =
    .label = 추천 모델 고르기…
research-helper-prefs-models-as-of =
    { $date } 기준 제공자 모델 목록에서 가져온 추천입니다. 어떤 모델 ID든 직접 입력할 수도 있습니다.
research-helper-prefs-models-stale = 실시간 모델 목록을 가져오지 못했습니다. 이 추천은 { $date } 기준 내장 목록이라 오래되었을 수 있습니다. 어떤 모델 ID든 직접 입력할 수도 있습니다.
research-helper-prefs-prices = 직접 입력한 모델 가격
research-helper-prefs-prices-note = 여기에 입력한 가격은 Research Helper가 비용을 어림할 때 해당 모델의 목록 가격 대신 쓰입니다. 100만 토큰당 미국 달러 가격과 그 가격을 확인한 날짜를 입력하세요. 새 항목은 위에서 고른 제공자에 저장됩니다.
research-helper-prefs-price-row =
    { $provider } · { $model }: 입력 { $input }, 출력 { $output }, 캐시된 입력 { $cached } (100만 토큰당 미국 달러) · { $date } 기준
research-helper-prefs-price-row-no-cached =
    { $provider } · { $model }: 입력 { $input }, 출력 { $output } (100만 토큰당 미국 달러) · { $date } 기준
research-helper-prefs-price-model =
    .placeholder = 모델 ID
research-helper-prefs-price-input =
    .placeholder = 입력 가격
research-helper-prefs-price-output =
    .placeholder = 출력 가격
research-helper-prefs-price-cached =
    .placeholder = 캐시된 입력 가격(선택)
research-helper-prefs-price-as-of =
    .placeholder = 기준일(YYYY-MM-DD)
research-helper-prefs-price-save = 가격 저장
research-helper-prefs-price-remove = 지우기
research-helper-prefs-price-saved = 가격을 저장했습니다.
research-helper-prefs-price-removed = 가격을 지웠습니다.
research-helper-prefs-price-invalid = 저장하지 않았습니다. 모델 ID, 0 이상의 입력·출력 가격(예: 0.25), 2026-10-23 같은 날짜를 입력하세요.
research-helper-prefs-price-refused = 저장하지 않았습니다. 이 항목은 저장할 수 없습니다. 모델 칸에 API 키가 아니라 모델 이름이 들어 있는지 확인하세요.
research-helper-prefs-price-unavailable = 플러그인 데이터베이스를 쓸 수 없어 가격을 저장할 수 없습니다.

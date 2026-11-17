# 설정 화면 한국어 문구 검토 (초안, 2026-11-17)

설정 화면에 새로 생긴 문구 50개입니다. 각 항목: 영어 원문 → 한국어 초안. 고칠 문구만 말씀해 주시면 됩니다.

---

# 설정 화면: 검색, 보고서와 오디오, 개인정보

## 1. search

영어:
```
research-helper-prefs-search = Search
```
한국어 초안:
```
research-helper-prefs-search = 검색
```

## 2. default-years

영어:
```
research-helper-prefs-default-years =
    .value = Default date range, in years
```
한국어 초안:
```
research-helper-prefs-default-years =
    .value = 기본 검색 기간(년)
```

## 3. max-results

영어:
```
research-helper-prefs-max-results =
    .value = Results to fetch from each database
```
한국어 초안:
```
research-helper-prefs-max-results =
    .value = 데이터베이스마다 가져올 결과 수
```

## 4. hide-existing

영어:
```
research-helper-prefs-hide-existing =
    .label = Hide items already in my library
```
한국어 초안:
```
research-helper-prefs-hide-existing =
    .label = 내 라이브러리에 이미 있는 항목 숨기기
```

## 5. report

영어:
```
research-helper-prefs-report = Report & audio
```
한국어 초안:
```
research-helper-prefs-report = 보고서와 오디오
```

## 6. report-language

영어:
```
research-helper-prefs-report-language =
    .value = Report language
```
한국어 초안:
```
research-helper-prefs-report-language =
    .value = 보고서 언어
```

## 7. language-option

영어:
```
research-helper-prefs-language-option =
    .label =
        { $language ->
            [en] English
            [ko] 한국어
            [both] Both English and Korean
           *[auto] Zotero's language
        }
```
한국어 초안:
```
research-helper-prefs-language-option =
    .label =
        { $language ->
            [en] English
            [ko] 한국어
            [both] 영어와 한국어 모두
           *[auto] Zotero 언어
        }
```

## 8. tts-language

영어:
```
research-helper-prefs-tts-language =
    .value = Audio language
```
한국어 초안:
```
research-helper-prefs-tts-language =
    .value = 오디오 언어
```

## 9. tts-language-option

영어:
```
research-helper-prefs-tts-language-option =
    .label =
        { $language ->
            [en] English
            [ko] 한국어
           *[auto] The report's language
        }
```
한국어 초안:
```
research-helper-prefs-tts-language-option =
    .label =
        { $language ->
            [en] English
            [ko] 한국어
           *[auto] 보고서 언어
        }
```

## 10. tts-voice

영어:
```
research-helper-prefs-tts-voice =
    .value = Voice
```
한국어 초안:
```
research-helper-prefs-tts-voice =
    .value = 음성
```

## 11. tts-voice-note

영어:
```
research-helper-prefs-tts-voice-note = The voices listed are Google Gemini's documented voices. Opening this list sends nothing; to hear a voice, make the audio in the report window.
```
한국어 초안:
```
research-helper-prefs-tts-voice-note = 목록의 음성은 Google Gemini가 문서로 안내하는 음성입니다. 목록을 열어도 아무것도 보내지 않습니다. 음성을 들어 보려면 보고서 창에서 오디오를 만드세요.
```

## 12. tts-minutes

영어:
```
research-helper-prefs-tts-minutes =
    .value = Audio length in minutes (0 sets it from the report's length)
```
한국어 초안:
```
research-helper-prefs-tts-minutes =
    .value = 오디오 길이(분, 0이면 보고서 길이에 맞춤)
```

## 13. tts-folder

영어:
```
research-helper-prefs-tts-folder =
    .value = Folder for long recordings
```
한국어 초안:
```
research-helper-prefs-tts-folder =
    .value = 긴 녹음을 둘 폴더
```

## 14. tts-folder-choose

영어:
```
research-helper-prefs-tts-folder-choose =
    .label = Choose…
```
한국어 초안:
```
research-helper-prefs-tts-folder-choose =
    .label = 선택…
```

## 15. tts-folder-clear

영어:
```
research-helper-prefs-tts-folder-clear =
    .label = Forget this folder
```
한국어 초안:
```
research-helper-prefs-tts-folder-clear =
    .label = 이 폴더 잊기
```

## 16. tts-folder-unset

영어:
```
research-helper-prefs-tts-folder-unset = No folder chosen. Research Helper asks the first time a recording is too large to store in Zotero.
```
한국어 초안:
```
research-helper-prefs-tts-folder-unset = 선택한 폴더가 없습니다. 녹음이 너무 커서 Zotero에 저장할 수 없을 때 처음 한 번 묻습니다.
```

## 17. tts-folder-note

영어:
```
research-helper-prefs-tts-folder-note = A recording over 10 MiB (about 3.6 minutes) is kept in this folder and linked from Zotero, so it does not sync to Zotero's mobile apps.
```
한국어 초안:
```
research-helper-prefs-tts-folder-note = 10 MiB(약 3.6분)를 넘는 녹음은 이 폴더에 두고 Zotero에서 링크하므로, Zotero 모바일 앱에는 동기화되지 않습니다.
```

## 18. tts-folder-refused

영어:
```
research-helper-prefs-tts-folder-refused = That folder cannot be used: choose an existing folder that is not a temporary one. The folder you had stays chosen.
```
한국어 초안:
```
research-helper-prefs-tts-folder-refused = 이 폴더는 쓸 수 없습니다. 임시 폴더가 아닌, 이미 있는 폴더를 고르세요. 원래 폴더는 그대로 선택되어 있습니다.
```

## 19. privacy

영어:
```
research-helper-prefs-privacy = Privacy
```
한국어 초안:
```
research-helper-prefs-privacy = 개인정보
```

## 20. privacy-mode

영어:
```
research-helper-prefs-privacy-mode =
    .value = Privacy mode
```
한국어 초안:
```
research-helper-prefs-privacy-mode =
    .value = 개인정보 모드
```

## 21. privacy-option

영어:
```
research-helper-prefs-privacy-option =
    .label =
        { $mode ->
            [strict] Strict
            [full] Full
           *[balanced] Balanced
        }
```
한국어 초안:
```
research-helper-prefs-privacy-option =
    .label =
        { $mode ->
            [strict] 엄격
            [full] 전체
           *[balanced] 균형
        }
```

## 22. privacy-explain

영어:
```
research-helper-prefs-privacy-explain =
    { $mode ->
        [strict] Strict: each paper's title, authors, venue, year and abstract are sent, never its PDF full text, your notes or annotations, or collection and tag names. Models that may train on what you send, or whose data policy is unknown, are refused.
        [full] Full: PDF full text is sent as well. Your notes, annotations, and collection and tag names are sent only if you allow it separately. Models that may train on what you send need your confirmation.
       *[balanced] Balanced: PDF full text is sent as well, when the full-text setting below allows it. Your notes, annotations, and collection and tag names are never sent. A model whose data policy is unknown is warned about; a model that may train on what you send is refused, or, for a Google Gemini key not marked as paid, needs your confirmation.
    }
```
한국어 초안:
```
research-helper-prefs-privacy-explain =
    { $mode ->
        [strict] 엄격: 논문의 제목, 저자, 게재처, 연도, 초록을 보내며, PDF 본문, 내 노트와 주석, 컬렉션과 태그 이름은 보내지 않습니다. 보낸 내용을 학습에 쓸 수 있거나 데이터 정책을 알 수 없는 모델은 거부합니다.
        [full] 전체: PDF 본문도 보냅니다. 내 노트와 주석, 컬렉션과 태그 이름은 따로 허용한 경우에만 보냅니다. 보낸 내용을 학습에 쓸 수 있는 모델은 확인을 받은 뒤에 씁니다.
       *[balanced] 균형: 아래 본문 설정이 허용하면 PDF 본문도 보냅니다. 내 노트와 주석, 컬렉션과 태그 이름은 보내지 않습니다. 데이터 정책을 알 수 없는 모델은 경고하고, 보낸 내용을 학습에 쓸 수 있는 모델은 거부합니다. 단, 유료로 표시하지 않은 Google Gemini 키는 확인을 받은 뒤에 씁니다.
    }
```

## 23. fulltext-mode

영어:
```
research-helper-prefs-fulltext-mode =
    .value = Full text in summaries
```
한국어 초안:
```
research-helper-prefs-fulltext-mode =
    .value = 요약에 쓸 본문
```

## 24. fulltext-option

영어:
```
research-helper-prefs-fulltext-option =
    .label =
        { $mode ->
            [never] Never: abstracts only
            [always] Whenever full text is found
           *[auto] When it adds to the abstract
        }
```
한국어 초안:
```
research-helper-prefs-fulltext-option =
    .label =
        { $mode ->
            [never] 쓰지 않음(초록만)
            [always] 본문을 찾으면 항상
           *[auto] 초록보다 내용이 많을 때
        }
```

## 25. fulltext-note

영어:
```
research-helper-prefs-fulltext-note = Each run's cost confirmation can still switch to abstracts only. Strict privacy mode never sends full text, whatever is chosen here.
```
한국어 초안:
```
research-helper-prefs-fulltext-note = 실행할 때마다 비용 확인 창에서 초록만 보내기로 바꿀 수 있습니다. 개인정보 모드가 ‘엄격’이면 여기서 무엇을 고르든 본문을 보내지 않습니다.
```

---

# 설정 화면: 고급

## 26. advanced

영어:
```
research-helper-prefs-advanced = Advanced
```
한국어 초안:
```
research-helper-prefs-advanced = 고급
```

## 27. concurrency

영어:
```
research-helper-prefs-concurrency =
    .value = Model tasks run in parallel (1–8)
```
한국어 초안:
```
research-helper-prefs-concurrency =
    .value = 동시에 실행할 모델 작업 수(1–8)
```

## 28. timeout

영어:
```
research-helper-prefs-timeout =
    .value = Time limit for one literature database request, in seconds
```
한국어 초안:
```
research-helper-prefs-timeout =
    .value = 문헌 데이터베이스 요청 한 건의 제한 시간(초)
```

## 29. cache-size

영어:
```
research-helper-prefs-cache-size =
    .value = Cache size limit, in MB
```
한국어 초안:
```
research-helper-prefs-cache-size =
    .value = 캐시 크기 한도(MB)
```

## 30. cache-usage-row

영어:
```
research-helper-prefs-cache-usage-row =
    { $namespace ->
        [source-response] Literature database answers
        [canonical-work] Merged records
        [summary] Summaries
        [embedding] Embeddings
        [llm-completion] Model answers
        [recommendation] Recommendations
       *[report] Reports
    }: { NUMBER($megabytes, maximumFractionDigits: 1) } MB, { $entries ->
        [one] 1 entry
       *[other] { $entries } entries
    }
```
한국어 초안:
```
research-helper-prefs-cache-usage-row =
    { $namespace ->
        [source-response] 문헌 데이터베이스 응답
        [canonical-work] 병합한 기록
        [summary] 요약
        [embedding] 임베딩
        [llm-completion] 모델 응답
        [recommendation] 추천
       *[report] 보고서
    }: { NUMBER($megabytes, maximumFractionDigits: 1) } MB, { $entries }개
```

## 31. cache-usage-total

영어:
```
research-helper-prefs-cache-usage-total =
    Cache in use: { NUMBER($megabytes, maximumFractionDigits: 1) } MB, { $entries ->
        [one] 1 entry
       *[other] { $entries } entries
    }
```
한국어 초안:
```
research-helper-prefs-cache-usage-total = 사용 중인 캐시: { NUMBER($megabytes, maximumFractionDigits: 1) } MB, { $entries }개
```

## 32. cache-usage-unavailable

영어:
```
research-helper-prefs-cache-usage-unavailable = The cache's size cannot be read now.
```
한국어 초안:
```
research-helper-prefs-cache-usage-unavailable = 지금은 캐시 크기를 읽을 수 없습니다.
```

## 33. debug

영어:
```
research-helper-prefs-debug =
    .label = Verbose debug logging
```
한국어 초안:
```
research-helper-prefs-debug =
    .label = 자세한 디버그 기록
```

## 34. debug-note

영어:
```
research-helper-prefs-debug-note = Writes more detail to Zotero's debug output, to help find a problem. API keys are never written there. Turn it off when you are done.
```
한국어 초안:
```
research-helper-prefs-debug-note = 문제를 찾을 수 있도록 Zotero 디버그 출력에 더 자세한 내용을 씁니다. API 키는 절대 기록하지 않습니다. 다 쓴 뒤에는 꺼 두세요.
```

## 35. data-location

영어:
```
research-helper-prefs-data-location = Research Helper's database: { $path }
```
한국어 초안:
```
research-helper-prefs-data-location = Research Helper 데이터베이스: { $path }
```

## 36. data-location-show

영어:
```
research-helper-prefs-data-location-show =
    .label = Show in folder
```
한국어 초안:
```
research-helper-prefs-data-location-show =
    .label = 폴더에서 보기
```

## 37. data-location-unavailable

영어:
```
research-helper-prefs-data-location-unavailable = Research Helper's database is not open, so its location is not shown.
```
한국어 초안:
```
research-helper-prefs-data-location-unavailable = Research Helper 데이터베이스가 열려 있지 않아 위치를 보여 줄 수 없습니다.
```

---

# 설정 화면: 서비스별 자료 보관 안내

## 38. retention-title

영어:
```
research-helper-prefs-retention-title = What each provider's own pages say about what it receives:
```
한국어 초안:
```
research-helper-prefs-retention-title = 각 제공자가 자기 문서에서 받은 데이터에 대해 밝힌 내용:
```

## 39. retention-openai

영어:
```
research-helper-prefs-retention-openai = OpenAI: API data is not used for training unless you opt in. Abuse-monitoring logs are kept for up to 30 days, or longer when the law requires it or to protect its services or others from harm. Verified { $date }.
```
한국어 초안:
```
research-helper-prefs-retention-openai = OpenAI: 사용자가 동의하지 않으면 API 데이터를 학습에 쓰지 않습니다. 오남용 감시 기록은 최대 30일 보관하며, 법이 요구하거나 서비스나 다른 사람을 해로부터 보호해야 할 때는 더 오래 보관합니다. { $date }에 확인함.
```

## 40. retention-anthropic

영어:
```
research-helper-prefs-retention-anthropic = Anthropic: API inputs and outputs are not used for training by default, and are deleted within 30 days. When flagged for a Usage Policy violation, inputs and outputs may be kept for up to 2 years and classification scores for up to 7 years. Verified { $date }.
```
한국어 초안:
```
research-helper-prefs-retention-anthropic = Anthropic: API 입력과 출력을 기본적으로 학습에 쓰지 않으며 30일 안에 삭제합니다. 이용 정책 위반으로 표시되면 입력과 출력은 최대 2년, 분류 점수는 최대 7년 보관할 수 있습니다. { $date }에 확인함.
```

## 41. retention-gemini-paid

영어:
```
research-helper-prefs-retention-gemini-paid = Gemini, paid tier: prompts and responses are not used to improve Google's products. They are kept for 55 days to detect and prevent policy violations. Verified { $date }.
```
한국어 초안:
```
research-helper-prefs-retention-gemini-paid = Gemini 유료 등급: 프롬프트와 응답을 Google 제품 개선에 쓰지 않습니다. 정책 위반을 찾고 막기 위해 55일 동안 보관합니다. { $date }에 확인함.
```

## 42. retention-gemini-free

영어:
```
research-helper-prefs-retention-gemini-free = Gemini, free tier: prompts and responses are used to improve Google's products, and human reviewers may read them. Verified { $date }.
```
한국어 초안:
```
research-helper-prefs-retention-gemini-free = Gemini 무료 등급: 프롬프트와 응답을 Google 제품 개선에 쓰며, 사람 검토자가 읽을 수 있습니다. { $date }에 확인함.
```

## 43. retention-openrouter

영어:
```
research-helper-prefs-retention-openrouter = OpenRouter: inputs and outputs are not used for training, and inputs are not stored after they are categorized unless you opt in to logging. The model provider a request is routed to has its own policy, and some may use inputs and outputs for training. Verified { $date }.
```
한국어 초안:
```
research-helper-prefs-retention-openrouter = OpenRouter: 입력과 출력을 학습에 쓰지 않으며, 로그 기록에 동의하지 않으면 입력을 분류한 뒤 저장하지 않습니다. 요청이 전달되는 모델 제공자에게는 각자의 정책이 있으며, 일부는 입력과 출력을 학습에 쓸 수 있습니다. { $date }에 확인함.
```

---

# 설정 화면: 진단 정보

## 44. diagnostics-title

영어:
```
research-helper-prefs-diagnostics-title = Diagnostics
```
한국어 초안:
```
research-helper-prefs-diagnostics-title = 진단 정보
```

## 45. diagnostics-note

영어:
```
research-helper-prefs-diagnostics-note = To help find a problem, Research Helper can put together a text with its version and Zotero's, your settings, recent jobs, the last log lines, recent errors and cache counts. No API key and no paper content is included. Nothing is sent: you save or copy it yourself.
```
한국어 초안:
```
research-helper-prefs-diagnostics-note = 문제를 찾을 수 있도록 Research Helper와 Zotero의 버전, 설정, 최근 작업, 마지막 로그 줄, 최근 오류, 캐시 개수를 담은 텍스트를 만들 수 있습니다. API 키와 논문 내용은 들어가지 않습니다. 아무것도 보내지 않으며, 저장하거나 복사하는 것은 사용자입니다.
```

## 46. diagnostics-preview

영어:
```
research-helper-prefs-diagnostics-preview =
    .label = Show diagnostics
```
한국어 초안:
```
research-helper-prefs-diagnostics-preview =
    .label = 진단 정보 보기
```

## 47. diagnostics-text

영어:
```
research-helper-prefs-diagnostics-text =
    .aria-label = Diagnostics text
```
한국어 초안:
```
research-helper-prefs-diagnostics-text =
    .aria-label = 진단 정보 텍스트
```

## 48. diagnostics-save

영어:
```
research-helper-prefs-diagnostics-save =
    .label = Save diagnostics…
```
한국어 초안:
```
research-helper-prefs-diagnostics-save =
    .label = 진단 정보 저장…
```

## 49. diagnostics-copy

영어:
```
research-helper-prefs-diagnostics-copy =
    .label = Copy diagnostics
```
한국어 초안:
```
research-helper-prefs-diagnostics-copy =
    .label = 진단 정보 복사
```

## 50. diagnostics-status

영어:
```
research-helper-prefs-diagnostics-status =
    { $outcome ->
        [saved] Diagnostics saved.
        [copied] Diagnostics copied.
        [failed] Diagnostics could not be saved or copied.
       *[unavailable] Diagnostics cannot be put together now.
    }
```
한국어 초안:
```
research-helper-prefs-diagnostics-status =
    { $outcome ->
        [saved] 진단 정보를 저장했습니다.
        [copied] 진단 정보를 복사했습니다.
        [failed] 진단 정보를 저장하거나 복사하지 못했습니다.
       *[unavailable] 지금은 진단 정보를 만들 수 없습니다.
    }
```

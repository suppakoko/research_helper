# Owner-approved Korean, plan/00 §6 item 305(d) (2026-10-29; G-41). Drafted by the coordinator and approved by the
# owner in chat as drafted. Inserted byte for byte into addon/locale/ko-KR/research-helper-mainWindow.ftl,
# replacing each id's "# NEEDS REVIEW" stub. The selector keys must match the en-US messages' keys exactly.

research-helper-itempane-not-summarized =
    { $reason ->
        [no-text] 이 논문에는 요약할 초록도 본문도 없어 아무것도 보내지 않았습니다.
        [retracted] 이 논문은 철회된 것으로 표시되어 있어 요약하지 않았습니다.
        [language] 이 논문은 영어가 아니라 요약하지 않았습니다.
        [existing] 이 논문에는 이미 요약 노트가 있습니다. 다시 요약하려면 '요약 다시 만들기'를 누르세요.
        [no-key] AI 제공자의 API 키가 없습니다. Research Helper 설정에서 키를 추가한 뒤 '다시 시도'를 누르세요. 아무것도 보내지 않았습니다.
        [time-limit] 시간 제한에 걸려 요약을 저장하기 전에 멈췄습니다. 다시 하려면 '다시 시도'를 누르세요.
       *[other] 요약을 저장하기 전에 실행이 멈췄습니다.
    }
research-helper-itempane-note-not-written =
    { $reason ->
        [read-only] 이 라이브러리는 읽기 전용이라 요약을 노트로 저장하지 않았습니다.
       *[exists] 이 논문에는 이미 요약 노트가 있어 두 번째 노트를 만들지 않았습니다.
    }

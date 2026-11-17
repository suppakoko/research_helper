# 단계 6 한국어 문구 검토 (초안, 2026-11-17)

각 항목: 영어 원문 → 한국어 초안. 고칠 문구만 말씀해 주시면 됩니다.

## 1. research-helper-menu-collection-audio-report  (mainWindow)

영어:
```
.label = Generate Audio Report…
```
한국어 초안:
```
research-helper-menu-collection-audio-report =
    .label = 오디오 보고서 생성…
```

## 2. rh-error-tts  (mainWindow)

영어:
```
unentitled: This Gemini key cannot use Gemini text-to-speech, so no audio was made. Your report is unchanged. Check the key's access in Google AI Studio, or save the spoken script as text.
  model-gone: The Gemini text-to-speech model is no longer available, so no audio was made. Your report is unchanged. Try again later, or save the spoken script as text.
  no-audio: Gemini answered without audio, so no audio was made. Your report is unchanged. Try again, or save the spoken script as text.
  sample-rate: Gemini returned the parts of the audio at different sample rates, so they could not be joined. Your report is unchanged. Try again, or save the spoken script as text.
  script-rejected: The spoken script still contained written formatting after one retry, so no audio was made and nothing was sent to Gemini. Your report is unchanged. Save the script as text, or try again.
  rate-limited: Gemini text-to-speech is receiving too many requests, so no audio was made. Your report is unchanged. Try again in a few minutes, or save the spoken script as text.
  other: Gemini text-to-speech could not make the audio. Your report is unchanged. Try again, or save the spoken script as text.
```
한국어 초안:
```
rh-error-tts = { $reason ->
    [unentitled] 이 Gemini 키로는 Gemini 음성 합성을 쓸 수 없어 오디오를 만들지 못했습니다. 보고서는 그대로입니다. Google AI Studio에서 키의 사용 권한을 확인하거나, 음성 대본을 텍스트로 저장하세요.
    [model-gone] Gemini 음성 합성 모델을 더 이상 쓸 수 없어 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 나중에 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
    [no-audio] Gemini가 오디오 없이 응답해 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
    [sample-rate] Gemini가 보낸 오디오 조각들의 샘플링 레이트가 서로 달라 하나로 합칠 수 없었습니다. 보고서는 그대로입니다. 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
    [script-rejected] 한 번 다시 시도한 뒤에도 음성 대본에 문서 서식이 남아 있어 오디오를 만들지 않았고, Gemini에는 아무것도 보내지 않았습니다. 보고서는 그대로입니다. 대본을 텍스트로 저장하거나 다시 시도하세요.
    [rate-limited] Gemini 음성 합성에 요청이 너무 많아 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 몇 분 뒤 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
   *[other] Gemini 음성 합성이 오디오를 만들지 못했습니다. 보고서는 그대로입니다. 다시 시도하거나, 음성 대본을 텍스트로 저장하세요.
}
```

## 3. research-helper-egress-audio-notice  (mainWindow)

영어:
```
{ $script ->
  [due] To make the audio, the report's sections, the collection's name, its counts and year range, and one line for each cited paper (its Zotero item key, first author's surname and year) are sent to { $scriptModel } at { $scriptHost } to write a spoken script. The spoken script, which can name the collection and cited authors aloud, is then sent to { $ttsModel } at { $ttsHost } to be read aloud.
  *[stored] The spoken script already written for this report, which can name the collection and cited authors aloud, is sent to { $ttsModel } at { $ttsHost } to be read aloud. No script is written this time, so nothing else is sent.
  }
```
한국어 초안:
```
research-helper-egress-audio-notice =
    { $script ->
        [due] 오디오를 만들기 위해 보고서의 각 절, 컬렉션 이름, 항목 수와 연도 범위, 그리고 인용된 논문마다 한 줄(Zotero 항목 키, 제1저자의 성, 연도)이 음성 대본 작성을 위해 { $scriptHost }의 { $scriptModel }(으)로 전송됩니다. 그런 다음 컬렉션 이름과 인용된 저자를 소리 내어 언급할 수 있는 음성 대본이 낭독을 위해 { $ttsHost }의 { $ttsModel }(으)로 전송됩니다.
       *[stored] 이 보고서용으로 이미 작성된 음성 대본(컬렉션 이름과 인용된 저자를 소리 내어 언급할 수 있음)이 낭독을 위해 { $ttsHost }의 { $ttsModel }(으)로 전송됩니다. 이번에는 대본을 새로 작성하지 않으므로 그 밖의 내용은 전송되지 않습니다.
    }
```

## 4. research-helper-cost-audio-script  (mainWindow)

영어:
```
{ $calls ->
  [one] Writing the spoken script: 1 call to { $model }, for about { $minutes } of audio.
  *[other] Writing the spoken script: up to { $calls } calls to { $model }, for about { $minutes } of audio.
  }
```
한국어 초안:
```
research-helper-cost-audio-script =
    { $calls ->
       *[other] 음성 대본 작성: 약 { $minutes } 분량의 오디오를 위해 { $model }에 최대 { $calls }회 호출.
    }
```

## 5. research-helper-cost-audio-provisional  (mainWindow)

영어:
```
Then reading it aloud with { $model }: about { $duration }, estimated from the target length. Once the script is written you confirm again, with its real length, before any audio is made.
```
한국어 초안:
```
research-helper-cost-audio-provisional = 이어서 { $model }(으)로 낭독: 목표 길이로 추정한 약 { $duration }. 대본이 작성되면 오디오를 만들기 전에 실제 길이로 다시 확인합니다.
```

## 6. research-helper-cost-audio-length  (mainWindow)

영어:
```
{ $chunks ->
  [one] Spoken script: { $chars } characters, read aloud in 1 part.
  *[other] Spoken script: { $chars } characters, read aloud in { $chunks } parts.
  }
```
한국어 초안:
```
research-helper-cost-audio-length =
    { $chunks ->
       *[other] 음성 대본: { $chars }자, { $chunks }개 부분으로 나누어 낭독.
    }
```

## 7. research-helper-cost-audio-length-warning  (mainWindow)

영어:
```
{ $unit ->
  [syllables] The script is { $count } Hangul syllables long, against a target of about { $target }, so the audio will be longer or shorter than planned.
  *[words] The script is { $count } words long, against a target of about { $target }, so the audio will be longer or shorter than planned.
  }
```
한국어 초안:
```
research-helper-cost-audio-length-warning =
    { $unit ->
        [syllables] 대본 길이가 한글 { $count }음절로, 목표인 약 { $target }음절과 차이가 있어 오디오가 계획보다 길거나 짧아집니다.
       *[words] 대본 길이가 { $count }단어로, 목표인 약 { $target }단어와 차이가 있어 오디오가 계획보다 길거나 짧아집니다.
    }
```

## 8. research-helper-cost-audio-duration  (mainWindow)

영어:
```
Audio: about { $duration }, about { $size } as a WAV file.
```
한국어 초안:
```
research-helper-cost-audio-duration = 오디오: 약 { $duration }, WAV 파일로 약 { $size }.
```

## 9. research-helper-cost-audio-attach  (mainWindow)

영어:
```
{ $mode ->
  [linked] The file is too large to store in Zotero, so it is saved in a folder you choose and linked from the report's collection. Zotero does not sync a linked file.
  *[imported] The file is stored in Zotero, in the report's collection, and syncs like your other attachments.
  }
```
한국어 초안:
```
research-helper-cost-audio-attach =
    { $mode ->
        [linked] 파일이 Zotero에 저장하기에는 너무 커서, 직접 고른 폴더에 저장하고 보고서의 컬렉션에서 링크합니다. Zotero는 링크된 파일을 동기화하지 않습니다.
       *[imported] 파일은 Zotero의 보고서 컬렉션에 저장되며 다른 첨부 파일처럼 동기화됩니다.
    }
```

## 10. research-helper-cost-audio-rate-unmeasured  (mainWindow)

영어:
```
This cost uses an audio token rate measured on a different Gemini text-to-speech model, so it may be less accurate.
```
한국어 초안:
```
research-helper-cost-audio-rate-unmeasured = 이 비용은 다른 Gemini 음성 합성 모델에서 측정한 오디오 토큰 비율을 사용하므로 덜 정확할 수 있습니다.
```

## 11. research-helper-cost-audio-tier-question  (mainWindow)

영어:
```
Is this Google API key's Google Cloud project billing-linked (Google's paid tier)? Research Helper cannot check this itself, so it asks once. "Don't know" counts as the free tier. You can change the answer later in Research Helper's settings, under the Gemini key.
```
한국어 초안:
```
research-helper-cost-audio-tier-question = 이 Google API 키의 Google Cloud 프로젝트에 결제가 연결되어 있나요(Google 유료 등급)? Research Helper는 이를 직접 확인할 수 없어 한 번만 묻습니다. "모름"은 무료 등급으로 취급됩니다. 답은 나중에 Research Helper 설정의 Gemini 키 항목에서 바꿀 수 있습니다.
```

## 12. research-helper-cost-audio-tier-paid  (mainWindow)

영어:
```
.label = Yes, billing is linked (paid tier)
```
한국어 초안:
```
research-helper-cost-audio-tier-paid =
    .label = 예, 결제가 연결되어 있습니다(유료 등급)
```

## 13. research-helper-cost-audio-tier-free  (mainWindow)

영어:
```
.label = No, it is on the free tier
```
한국어 초안:
```
research-helper-cost-audio-tier-free =
    .label = 아니요, 무료 등급입니다
```

## 14. research-helper-cost-audio-tier-unknown  (mainWindow)

영어:
```
.label = Don't know
```
한국어 초안:
```
research-helper-cost-audio-tier-unknown =
    .label = 모름
```

## 15. research-helper-audio-tier-refused  (mainWindow)

영어:
```
Strict privacy mode makes no audio with this Google API key, because it may be on the free tier, where Google may use what you send to improve its products. To make audio, mark the key as paid in Research Helper's settings if its Google Cloud project is billing-linked, or choose a less strict privacy mode.
```
한국어 초안:
```
research-helper-audio-tier-refused = 엄격 개인정보 보호 모드에서는 이 Google API 키로 오디오를 만들지 않습니다. 이 키가 무료 등급일 수 있고, 무료 등급에서는 Google이 전송된 내용을 자사 제품 개선에 사용할 수 있기 때문입니다. 오디오를 만들려면 Google Cloud 프로젝트에 결제가 연결된 경우 Research Helper 설정에서 이 키를 유료로 표시하거나, 덜 엄격한 개인정보 보호 모드를 선택하세요.
```

## 16. research-helper-audio-attachment-title  (mainWindow)

영어:
```
{ $language ->
  [ko] Audio report (Korean), { $date }
  *[en] Audio report (English), { $date }
  }
```
한국어 초안:
```
research-helper-audio-attachment-title =
    { $language ->
        [ko] 오디오 보고서 (한국어), { $date }
       *[en] 오디오 보고서 (영어), { $date }
    }
```

## 17. research-helper-report-audio-heading  (reportWindow)

영어:
```
Audio (spoken report)
```
한국어 초안:
```
research-helper-report-audio-heading = 오디오 (음성 보고서)
```

## 18. research-helper-report-audio-language-label  (reportWindow)

영어:
```
.value = Audio language
```
한국어 초안:
```
research-helper-report-audio-language-label =
    .value = 오디오 언어
```

## 19. research-helper-report-audio-voice-label  (reportWindow)

영어:
```
.value = Voice
```
한국어 초안:
```
research-helper-report-audio-voice-label =
    .value = 음성
```

## 20. research-helper-report-audio-none  (reportWindow)

영어:
```
No report is stored for this collection yet. Generate a report first, then make its audio.
```
한국어 초안:
```
research-helper-report-audio-none = 이 컬렉션에 저장된 보고서가 아직 없습니다. 먼저 보고서를 생성한 뒤 오디오를 만드세요.
```

## 21. research-helper-report-audio-source  (reportWindow)

영어:
```
{ $script ->
  [ko] { $report -> [ko] Korean script written from the Korean report *[en] Korean script written from the English report }
  *[en] { $report -> [ko] English script written from the Korean report *[en] English script written from the English report }
  }
```
한국어 초안:
```
research-helper-report-audio-source =
    { $script ->
        [ko]
            { $report ->
                [ko] 한국어 보고서로 쓴 한국어 대본
               *[en] 영어 보고서로 쓴 한국어 대본
            }
       *[en]
            { $report ->
                [ko] 한국어 보고서로 쓴 영어 대본
               *[en] 영어 보고서로 쓴 영어 대본
            }
    }
```

## 22. research-helper-report-audio-generate  (reportWindow)

영어:
```
.label = Generate audio
```
한국어 초안:
```
research-helper-report-audio-generate =
    .label = 오디오 생성
```

## 23. research-helper-report-audio-cancel  (reportWindow)

영어:
```
.label = Cancel audio
```
한국어 초안:
```
research-helper-report-audio-cancel =
    .label = 오디오 취소
```

## 24. research-helper-report-audio-stage  (reportWindow)

영어:
```
{ $stage ->
  [checking] Checking the report, the library and the key…
  [scripting] Writing the spoken script…
  [confirming] Waiting for your confirmation…
  [synthesizing] Generating audio… part { $done } of { $total }
  [attaching] Attaching the audio to the collection…
  [waiting] Paused — waiting for your answer.
  *[done] Done.
  }
```
한국어 초안:
```
research-helper-report-audio-stage =
    { $stage ->
        [checking] 보고서, 라이브러리, 키를 확인하는 중…
        [scripting] 음성 대본을 쓰는 중…
        [confirming] 확인을 기다리는 중…
        [synthesizing] 오디오 생성 중… { $total }개 중 { $done }번째
        [attaching] 컬렉션에 오디오를 첨부하는 중…
        [waiting] 일시 중지 — 답을 기다리는 중입니다.
       *[done] 완료.
    }
```

## 25. research-helper-report-audio-outcome  (reportWindow)

영어:
```
{ $outcome ->
  [succeeded] The audio is attached to the report's collection.
  [declined] Nothing was generated.
  [cancelled] Cancelled. No audio was kept; a spoken script already written is kept.
  [interrupted] Zotero closed during the run. No audio was kept; a spoken script already written is kept.
  [refused] No audio was generated.
  *[failed] The audio could not be generated.
  }
```
한국어 초안:
```
research-helper-report-audio-outcome =
    { $outcome ->
        [succeeded] 보고서의 컬렉션에 오디오를 첨부했습니다.
        [declined] 아무것도 생성하지 않았습니다.
        [cancelled] 취소했습니다. 오디오는 남기지 않았고, 이미 쓴 음성 대본은 남아 있습니다.
        [interrupted] 실행 중에 Zotero가 닫혔습니다. 오디오는 남기지 않았고, 이미 쓴 음성 대본은 남아 있습니다.
        [refused] 오디오를 생성하지 않았습니다.
       *[failed] 오디오를 생성하지 못했습니다.
    }
```

## 26. research-helper-report-audio-refused  (reportWindow)

영어:
```
{ $reason ->
  [no-report] The report is no longer stored. Generate a report first.
  [no-key] No Google Gemini API key is set. Add it in Research Helper's preferences.
  [read-only] This library cannot be written to, so no audio can be attached to it.
  [no-collection] The report's collection is gone or in the trash.
  [linked-needs-personal-library] The audio file would be too large to store in a group library, and only your personal library can link a file instead.
  [no-folder] No folder was chosen for the audio file.
  [disabled] Audio reports are turned off.
  *[other] No audio was generated.
  }
```
한국어 초안:
```
research-helper-report-audio-refused =
    { $reason ->
        [no-report] 보고서가 더 이상 저장되어 있지 않습니다. 먼저 보고서를 생성하세요.
        [no-key] Google Gemini API 키가 설정되지 않았습니다. Research Helper 설정에서 추가하세요.
        [read-only] 이 라이브러리에는 쓸 수 없어 오디오를 첨부할 수 없습니다.
        [no-collection] 보고서의 컬렉션이 없어졌거나 휴지통에 있습니다.
        [linked-needs-personal-library] 오디오 파일이 너무 커서 그룹 라이브러리에 저장할 수 없고, 파일 링크는 내 라이브러리에서만 할 수 있습니다.
        [no-folder] 오디오 파일을 저장할 폴더를 고르지 않았습니다.
        [disabled] 오디오 보고서가 꺼져 있습니다.
       *[other] 오디오를 생성하지 않았습니다.
    }
```

## 27. research-helper-report-audio-save-script  (reportWindow)

영어:
```
.label = Save Script as Text…
```
한국어 초안:
```
research-helper-report-audio-save-script =
    .label = 대본을 텍스트로 저장…
```

## 28. research-helper-report-audio-save-audio  (reportWindow)

영어:
```
.label = Save Audio As…
```
한국어 초안:
```
research-helper-report-audio-save-audio =
    .label = 오디오를 다른 이름으로 저장…
```

## 29. research-helper-report-audio-saved  (reportWindow)

영어:
```
{ $outcome ->
  [saved] { $kind -> [audio] Audio saved. *[script] Spoken script saved. }
  *[failed] The file could not be written.
  }
```
한국어 초안:
```
research-helper-report-audio-saved =
    { $outcome ->
        [saved]
            { $kind ->
                [audio] 오디오를 저장했습니다.
               *[script] 음성 대본을 저장했습니다.
            }
       *[failed] 파일을 쓰지 못했습니다.
    }
```

# Korean review, Phase 7 batch C (`P7-T10`, `P7-T11`): 20 drafts

For `G-41` (`plan/00-task-index.md` §6 item 397). Each id below shows the en-US entry and the Korean
draft as it stands, commented out, in `addon/locale/ko-KR/research-helper-mainWindow.ftl` under the
markers "# Draft (coordinator, 2026-11-17, not adopted; G-41, P7-T10):" and "…P7-T11):". Generated
by script from the two bundles on 2026-11-17. Not adopted.

## 1. `research-helper-prefs-data-title`

en-US:

```ftl
research-helper-prefs-data-title = Stored data
```

ko-KR draft:

```ftl
research-helper-prefs-data-title = 저장된 데이터
```

## 2. `research-helper-prefs-data-note`

en-US:

```ftl
research-helper-prefs-data-note = These remove what Research Helper keeps in its own database. Your Zotero items and notes stay, and so do your API keys.
```

ko-KR draft:

```ftl
research-helper-prefs-data-note = Research Helper가 자체 데이터베이스에 보관한 내용을 지웁니다. Zotero 항목과 노트는 그대로 남고, API 키도 그대로 남습니다.
```

## 3. `research-helper-prefs-clear-responses`

en-US:

```ftl
research-helper-prefs-clear-responses =
    .label = Clear cached responses…
```

ko-KR draft:

```ftl
research-helper-prefs-clear-responses =
    .label = 캐시된 응답 지우기…
```

## 4. `research-helper-prefs-clear-summaries`

en-US:

```ftl
research-helper-prefs-clear-summaries =
    .label = Clear stored summaries…
```

ko-KR draft:

```ftl
research-helper-prefs-clear-summaries =
    .label = 저장된 요약 지우기…
```

## 5. `research-helper-prefs-clear-jobs`

en-US:

```ftl
research-helper-prefs-clear-jobs =
    .label = Clear job history…
```

ko-KR draft:

```ftl
research-helper-prefs-clear-jobs =
    .label = 작업 기록 지우기…
```

## 6. `research-helper-prefs-clear-embeddings`

en-US:

```ftl
research-helper-prefs-clear-embeddings =
    .label = Clear embeddings…
```

ko-KR draft:

```ftl
research-helper-prefs-clear-embeddings =
    .label = 임베딩 지우기…
```

## 7. `research-helper-prefs-delete-all-data`

en-US:

```ftl
research-helper-prefs-delete-all-data =
    .label = Delete all plugin data…
```

ko-KR draft:

```ftl
research-helper-prefs-delete-all-data =
    .label = 플러그인 데이터 모두 삭제…
```

## 8. `research-helper-prefs-reset-defaults`

en-US:

```ftl
research-helper-prefs-reset-defaults =
    .label = Reset settings to defaults…
```

ko-KR draft:

```ftl
research-helper-prefs-reset-defaults =
    .label = 설정을 기본값으로 되돌리기…
```

## 9. `research-helper-prefs-data-confirm-title`

en-US:

```ftl
research-helper-prefs-data-confirm-title = Research Helper
```

ko-KR draft:

```ftl
research-helper-prefs-data-confirm-title = Research Helper
```

## 10. `research-helper-prefs-confirm-clear-responses`

en-US:

```ftl
research-helper-prefs-confirm-clear-responses =
    { $entries ->
        [one] Remove 1 cached response ({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)? It is fetched again the next time it is needed.
       *[other] Remove { $entries } cached responses ({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)? They are fetched again the next time they are needed.
    }
```

ko-KR draft:

```ftl
research-helper-prefs-confirm-clear-responses = 캐시된 응답 { $entries }개({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)를 지울까요? 다음에 필요할 때 다시 가져옵니다.
```

## 11. `research-helper-prefs-confirm-clear-summaries`

en-US:

```ftl
research-helper-prefs-confirm-clear-summaries =
    { $rows ->
        [one] Remove 1 stored summary from Research Helper's database? The notes in your Zotero library stay.
       *[other] Remove { $rows } stored summaries from Research Helper's database? The notes in your Zotero library stay.
    }
```

ko-KR draft:

```ftl
research-helper-prefs-confirm-clear-summaries = Research Helper 데이터베이스에서 저장된 요약 { $rows }개를 지울까요? Zotero 라이브러리의 노트는 그대로 남습니다.
```

## 12. `research-helper-prefs-confirm-clear-jobs`

en-US:

```ftl
research-helper-prefs-confirm-clear-jobs =
    { $rows ->
        [one] Remove the history of 1 finished job? Jobs that are queued, running or paused stay.
       *[other] Remove the history of { $rows } finished jobs? Jobs that are queued, running or paused stay.
    }
```

ko-KR draft:

```ftl
research-helper-prefs-confirm-clear-jobs = 끝난 작업 { $rows }개의 기록을 지울까요? 대기 중이거나 실행 중이거나 일시 중지된 작업은 그대로 남습니다.
```

## 13. `research-helper-prefs-confirm-clear-embeddings`

en-US:

```ftl
research-helper-prefs-confirm-clear-embeddings =
    { $rows ->
        [one] Remove 1 stored embedding? It is computed again the next time it is needed.
       *[other] Remove { $rows } stored embeddings? They are computed again the next time they are needed.
    }
```

ko-KR draft:

```ftl
research-helper-prefs-confirm-clear-embeddings = 저장된 임베딩 { $rows }개를 지울까요? 다음에 필요할 때 다시 계산합니다.
```

## 14. `research-helper-prefs-confirm-delete-all`

en-US:

```ftl
research-helper-prefs-confirm-delete-all =
    Delete all of Research Helper's stored data: { $rows ->
        [one] 1 stored record
       *[other] { $rows } stored records
    } and { $entries ->
        [one] 1 cached entry
       *[other] { $entries } cached entries
    } ({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)? Your Zotero items and notes stay, and so do your API keys. This cannot be undone.
```

ko-KR draft:

```ftl
research-helper-prefs-confirm-delete-all = Research Helper에 저장된 데이터를 모두 삭제할까요? 저장된 기록 { $rows }개와 캐시 항목 { $entries }개({ NUMBER($megabytes, maximumFractionDigits: 1) } MB)입니다. Zotero 항목과 노트, API 키는 그대로 남습니다. 되돌릴 수 없습니다.
```

## 15. `research-helper-prefs-confirm-reset`

en-US:

```ftl
research-helper-prefs-confirm-reset = Restore every Research Helper setting to its default? Your API keys and stored data stay.
```

ko-KR draft:

```ftl
research-helper-prefs-confirm-reset = Research Helper의 모든 설정을 기본값으로 되돌릴까요? API 키와 저장된 데이터는 그대로 남습니다.
```

## 16. `research-helper-prefs-data-status`

en-US:

```ftl
research-helper-prefs-data-status =
    { $outcome ->
        [cleared] { $removed ->
            [one] Removed 1 stored record.
           *[other] Removed { $removed } stored records.
        }
        [reset] Settings restored to their defaults.
        [nothing] There was nothing to remove.
        [declined] Nothing was changed.
        [failed] It could not be done.
       *[unavailable] Research Helper's database is not open now.
    }
```

ko-KR draft:

```ftl
research-helper-prefs-data-status =
    { $outcome ->
        [cleared] 저장된 기록 { $removed }개를 지웠습니다.
        [reset] 설정을 기본값으로 되돌렸습니다.
        [nothing] 지울 것이 없습니다.
        [declined] 아무것도 바꾸지 않았습니다.
        [failed] 실행하지 못했습니다.
       *[unavailable] 지금은 Research Helper 데이터베이스가 열려 있지 않습니다.
    }
```

## 17. `research-helper-prefs-remove-content`

en-US:

```ftl
research-helper-prefs-remove-content =
    .label = Remove all Research Helper content…
```

ko-KR draft:

```ftl
research-helper-prefs-remove-content =
    .label = Research Helper 콘텐츠 모두 제거…
```

## 18. `research-helper-prefs-remove-content-note`

en-US:

```ftl
research-helper-prefs-remove-content-note = Moves the notes and audio attachments Research Helper created to the Zotero trash, where you can restore them, and deletes its stored data. Imported items and your own notes stay.
```

ko-KR draft:

```ftl
research-helper-prefs-remove-content-note = Research Helper가 만든 노트와 오디오 첨부 파일을 Zotero 휴지통으로 옮기고(휴지통에서 복원할 수 있습니다), 저장된 데이터를 삭제합니다. 가져온 항목과 직접 쓴 노트는 그대로 남습니다.
```

## 19. `research-helper-prefs-confirm-remove-content`

en-US:

```ftl
research-helper-prefs-confirm-remove-content =
    Move everything Research Helper created to the Zotero trash, where you can restore it, and delete its stored data?
    Generated notes: { $generated }. Search provenance notes: { $provenance }. Audio attachments: { $audio }. Stored records: { $records }.{ $libraryCount ->
        [0] {""}
       *[other] {" "}In: { $libraries }.
    }{ $folderCount ->
        [0] {""}
       *[other] {" "}Linked audio files stay on disk in: { $folders }.
    }{ $skippedCount ->
        [0] {""}
       *[other] {" "}Not changed, because you cannot edit them: { $skipped }.
    }
    Imported items, their tags and your own notes stay.
```

ko-KR draft:

```ftl
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
```

## 20. `research-helper-prefs-remove-content-status`

en-US:

```ftl
research-helper-prefs-remove-content-status =
    { $outcome ->
        [removed] Items moved to the Zotero trash: { $moved }. Stored records deleted: { $records }.
        [nothing] Research Helper has created nothing to remove.
        [declined] Nothing was changed.
        [failed] It could not be done.
       *[unavailable] Research Helper's database is not open now.
    }
```

ko-KR draft:

```ftl
research-helper-prefs-remove-content-status =
    { $outcome ->
        [removed] Zotero 휴지통으로 옮긴 항목: { $moved }. 삭제한 저장 기록: { $records }.
        [nothing] Research Helper가 만든 것 중 제거할 것이 없습니다.
        [declined] 아무것도 바꾸지 않았습니다.
        [failed] 실행하지 못했습니다.
       *[unavailable] 지금은 Research Helper 데이터베이스가 열려 있지 않습니다.
    }
```

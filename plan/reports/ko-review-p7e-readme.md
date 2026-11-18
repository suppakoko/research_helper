# Korean review: `README.ko.md` (P7-T20, batch E)

**Status:** a draft written by the coordinator on 2026-11-18. Nothing in it is adopted
(`G-41`). It goes to the owner with `P7-T05`'s review. Only the owner approves it.

**What this report covers.** `README.ko.md` is a section-by-section Korean version of
`README.md` as it stood on 2026-11-18. This report lists the following, for the owner to settle:

- the terms that have no settled Korean equivalent;
- the choices made for each;
- the menu names taken from Zotero rather than from this plugin.

**What was checked, and how.**

| Check | Result |
|---|---|
| `grep -c "^## " README.md README.ko.md` | 11 and 11, in the same order |
| Table rows (`grep -c "^| "`) | 25 and 25 |
| Every URL in `README.md` appears in `README.ko.md` (sorted lists compared) | equal |
| Every inline code span in `README.md` appears in `README.ko.md` | equal, except `README.ko.md` itself (the link added at the top of `README.md`) |
| Every number in `README.md` appears in `README.ko.md` | equal; the extra numbers in the Korean file are in its draft comment (the date, `G-41`, `P7-T20`) |
| No sentence states something `README.md` does not | read through line by line. The one addition is the draft banner at the top, which describes the document's status and makes no claim about the plugin. |

## 1. Control names: where each one comes from

The plugin's own control names are copied from `addon/locale/ko-KR/` (Fluent ids below).
Zotero's own menu names are copied from Zotero 10.0.3's `ko-KR` locale, read from the installed
`omni.ja`. That locale leaves several names in English, so the README does too.

| English in `README.md` | Korean in `README.ko.md` | Source |
|---|---|---|
| Tools → Research Helper → Search & Import… | 도구 → 리서치 헬퍼 → 검색 및 가져오기… | Zotero `toolsMenu.label`; plugin `research-helper-menu-root`, `research-helper-menu-search-import` |
| Find Related Papers… | 관련 논문 찾기… | `research-helper-menu-item-find-related` |
| Summarize All Papers in Collection | 컬렉션의 모든 논문 요약 | `research-helper-menu-collection-summarize-all` |
| Generate Research Trends Report… | 최신 연구 동향 보고서 생성… | `research-helper-menu-collection-report` |
| Generate Audio Report… | 오디오 보고서 생성… | `research-helper-menu-collection-audio-report` |
| Recommend New Papers from This Collection… | 이 컬렉션을 기반으로 새 논문 추천… | `research-helper-menu-collection-recommend` |
| Remove Generated Notes from Collection… | 컬렉션에서 생성된 노트 지우기… | `research-helper-menu-collection-remove-notes` |
| Test | 시험 | `research-helper-prefs-test-key` |
| Search (section) | 검색 | `research-helper-prefs-search` |
| Privacy (section) | 개인정보 | `research-helper-prefs-privacy` |
| Balanced / Strict / Full | 균형 / 엄격 / 전체 | `research-helper-prefs-privacy-option` |
| Advanced | 고급 | `research-helper-prefs-advanced` |
| Remove all Research Helper content… | Research Helper 콘텐츠 모두 제거… | `research-helper-prefs-remove-content` |
| Show diagnostics / Copy diagnostics / Save diagnostics… | 진단 정보 보기 / 진단 정보 복사 / 진단 정보 저장… | `research-helper-prefs-diagnostics-preview`, `-copy`, `-save` |
| Verbose debug logging | 자세한 디버그 기록 | `research-helper-prefs-debug` |
| provenance notes | 검색 출처 노트 | the term in `research-helper-prefs-remove-content`'s confirmation |
| Windows Credential Manager | Windows 자격 증명 관리자 | `research-helper-prefs-backend-windows` |
| venue | 게재처 | the bundle's term (used 4 times) |
| text-to-speech | 음성 합성 | the bundle's term (used 5 times) |
| Help → Debug Output Logging | 도움말 → 디버그 출력 로그 | Zotero `helpMenuWin.label`, `debugOutputLogging.label` |
| Trash | 휴지통 | Zotero `pane.collections.trash` |
| Tools → Plugins | 도구 → Plugins | Zotero `menu-tools-plugins`: Zotero's `ko-KR` locale has "Plugins" in English |
| Settings → Research Helper | Settings → Research Helper | Zotero's `ko-KR` locale has "Settings" in English. The pane's name in the Settings sidebar is the plugin's manifest name, which is not localized. |
| Install Plugin From File… | Install Plugin From File… | not in Zotero's own `zotero` locale folder. It comes from the add-ons manager, whose Korean was not read in this batch, so it is left in English. |

## 2. Terms with no settled Korean: for the owner

Each row is a choice made in the draft. None is adopted.

| English | Draft Korean | Why this choice, and the alternative |
|---|---|---|
| Research Helper (product name in running text) | Research Helper | The menu root reads 리서치 헬퍼, but the Settings pane, the item pane section and the Remove-content button all read "Research Helper". Running text keeps the English name. *Alternative:* 리서치 헬퍼 throughout. |
| Related papers / Recommendations (feature names in the table) | 관련 논문 / 추천 | No control has these short names. The menu items' names are used where the README names a control. |
| Recommend New Papers (short name in the status note) | 새 논문 추천 | The menu item is longer (이 컬렉션을 기반으로 새 논문 추천…). The status note in `README.md` also uses a short name. |
| Tested / Untested | 검증됨 / 검증 안 됨 | *Alternative:* 시험함 / 시험 안 함. 시험 is the Test button's word, so it was avoided for the meaning "checked on this OS". |
| telemetry, analytics or crash reports | 원격 측정, 분석, 충돌 보고 | The usual Korean for Firefox's own settings. |
| polite pool (Crossref) | "polite pool" | Crossref's own name for the service tier, kept in English and in quotes. |
| paywalled PDFs | 유료 구독 PDF | *Alternative:* 유료 장벽 뒤의 PDF. |
| best-effort | 최선을 다하는 수준 | *Alternative:* 완벽하지 않습니다. |
| held-out set of 19 papers | 따로 떼어 둔 논문 19편 | Plain words instead of the statistics term (검증용 보류 집합). |
| Profile a collection | 컬렉션의 프로필을 만들어 | *Alternative:* 컬렉션을 분석해. |
| spending limit | 지출 한도 | The bundle's cost dialog was not compared term for term. Check it against the cost-confirmation strings. |
| the free Gemini tier | 무료 Gemini 등급 | *Alternative:* 무료 요금제. |
| Data sources and attribution | 데이터 출처와 저작자 표시 | 저작자 표시 is the usual Korean for licence attribution. |
| Provider sites' own labels (Keys, API keys, Get API key, API key management) | left in English | These are the labels on the providers' websites, which are in English. |
| Releases, GitHub Issues | left in English | GitHub's own names, and link text. |

## 3. What is not in this draft

- **No review by a Korean reader** has happened. The owner's review is `P7-T05` (`G-41`).
- **The Korean of the add-ons manager** ("Install Plugin From File…") was not read; see §1's last
  row.
- **The screenshots** (`P7-T27`) are the same placeholders as in `README.md`; a Korean UI
  screenshot set is not planned.

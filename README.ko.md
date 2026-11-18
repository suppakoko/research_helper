<!--
Draft (coordinator, 2026-11-18, not adopted; G-41, P7-T20).
A Korean draft of README.md for the owner's review: the terms with no settled
Korean, and each choice made here, are listed in
plan/reports/ko-review-p7e-readme.md. It states nothing README.md does not
state; where the two differ, README.md is the authority. The plugin's control
names are the ko-KR bundle's (addon/locale/ko-KR/) as of 2026-11-18, and
Zotero's own menu names are those of Zotero 10.0.3's ko-KR locale, which leaves
"Plugins" and "Settings" in English.
-->

# Zotero용 Research Helper

> **검토 전 초안입니다.** 이 문서는 [README.md](README.md)의 한국어 번역 초안이며, 아직 검토를
> 거쳐 채택되지 않았습니다.

문헌을 검색하고, 컬렉션을 만들고, 찾은 논문을 요약하고, 연구 동향 보고서를 써서 음성으로도
들려주는 Zotero 플러그인입니다. 모든 작업은 Zotero 안에서 여러분의 API 키로 실행되며, Research
Helper 서버는 없습니다.

> **상태: 아직 출시되지 않았습니다.** 버전 1.0은 출시 단계에 있습니다. 첫 릴리스가
> [Releases](https://github.com/suppakoko/research_helper/releases)에 게시되기 전까지는 설치할
> 것이 없습니다. 현재 개발 빌드에서는 **관련 논문 찾기**, **새 논문 추천**, **오디오 보고서**가
> 출시 점검을 통과할 때까지 꺼져 있으며, 나머지 기능은 켜져 있습니다.

## 기능

<!-- screenshot: docs/images/search-import.png (P7-T27) -->

| | 기능 | 시작하는 곳 |
|---|---|---|
| **검색 및 가져오기** | PubMed, Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv, medRxiv에서 주제를 검색하고(기본값은 최근 3년), 중복을 없앤 뒤, 결과를 메타데이터·초록과 함께 Zotero 컬렉션으로 가져옵니다. | **도구 → 리서치 헬퍼 → 검색 및 가져오기…**, 또는 컬렉션의 컨텍스트 메뉴 |
| **관련 논문** | 라이브러리에 있는 논문 한 편에서 출발해 인용, 참고문헌, 추천 서비스를 통해 관련 연구를 찾습니다. | 항목의 컨텍스트 메뉴: **관련 논문 찾기…** |
| **요약과 동향 보고서** | 컬렉션의 모든 논문을 요약한 다음, 그 요약으로 구조화된 "최신 연구 동향" 보고서를 써서 Zotero 노트로 저장합니다. | 컬렉션의 컨텍스트 메뉴: **컬렉션의 모든 논문 요약**, **최신 연구 동향 보고서 생성…** |
| **AI 제공자 선택** | 모든 AI 단계는 여러분이 고른 모델로, 여러분의 OpenRouter, OpenAI, Google Gemini 또는 Anthropic 키를 거쳐 실행됩니다. | **Settings → Research Helper** |
| **오디오 보고서** | 보고서를 Gemini 음성 합성으로 영어 또는 한국어 음성 브리핑으로 바꾸어, 컬렉션에 오디오 첨부 파일로 저장합니다. | 컬렉션의 컨텍스트 메뉴: **오디오 보고서 생성…** |
| **추천** | 컬렉션의 프로필을 만들어, 컬렉션에 아직 없는 새 논문을 제안합니다. | 컬렉션의 컨텍스트 메뉴: **이 컬렉션을 기반으로 새 논문 추천…** |

<!-- screenshot: docs/images/report-window.png (P7-T27) -->

AI 제공자에게 무엇이든 보내기 전에, 확인 창이 전송 대상, 모델, 논문 수, 각 논문의 어느 부분을
보내는지, 개인정보 모드, 예상 비용을 보여 줍니다.

<!-- screenshot: docs/images/cost-confirmation.png (P7-T27) -->

## 호환성

| Research Helper | Zotero | Windows | macOS | Linux |
|---|---|---|---|---|
| 1.0 (아직 출시 전) | 10.0.x만 | 검증됨 | **검증 안 됨** | **검증 안 됨** |

"검증됨"은 자동화된 통합 테스트 묶음이 Windows 11의 Zotero 10.0.3에서 실행되고, 릴리스의 수동
점검이 릴리스 체크리스트([`docs/release/v1.0-checklist.md`](docs/release/v1.0-checklist.md))에
기록된다는 뜻입니다. macOS와 Linux는 쓸 수 있는 컴퓨터가 없어 점검하지 못했습니다. 작동할 것으로
예상하지만 아무도 확인하지 않았습니다. 두 운영체제에서의 사용 보고를 환영합니다. 인터페이스는
영어와 한국어로 제공됩니다.

## 설치

1. [Releases](https://github.com/suppakoko/research_helper/releases) 페이지에서 원하는 릴리스의
   `research-helper.xpi`를 내려받습니다. 각 릴리스에는 `SHA256SUMS.txt`도 함께 있어 파일을
   확인할 수 있습니다.
2. Zotero에서 **도구 → Plugins**를 열고 `.xpi` 파일을 그 창으로 끌어다 놓습니다(또는 톱니바퀴
   메뉴의 **Install Plugin From File…**을 씁니다).
3. Zotero가 다시 시작하라고 하면 다시 시작합니다.

**업데이트**는 Zotero 자체의 플러그인 업데이트로 받습니다. Zotero가 이 저장소 `release` 브랜치의
플러그인 `update.json`을 읽고, 더 새 버전이 있으면 알려 줍니다. **도구 → Plugins**에서 직접
확인할 수도 있습니다.

## 설정

**Settings → Research Helper**를 엽니다(macOS에서는 **Zotero → Settings**). AI 제공자 키가 하나
이상 필요합니다. 나머지는 모두 선택 사항입니다.

| 키 | 용도 | 받는 곳 |
|---|---|---|
| **OpenRouter** (기본 제공자) | 요약, 보고서, 추천. 키 하나로 여러 모델을 씁니다 | [openrouter.ai](https://openrouter.ai/) → 계정 → Keys |
| **또는 OpenAI** | 같은 기능을 OpenAI 자체 API로 | [platform.openai.com](https://platform.openai.com/) → API keys |
| **또는 Google Gemini** | 같은 기능을 Gemini로. **오디오 보고서에는 꼭 필요합니다** | [aistudio.google.com](https://aistudio.google.com/) → Get API key |
| **또는 Anthropic** | 같은 기능을 Claude 모델로 | [console.anthropic.com](https://console.anthropic.com/) → API keys |
| **NCBI** (선택) | 더 높은 PubMed 요청 한도 | [NCBI 계정 설정](https://www.ncbi.nlm.nih.gov/account/) → API key management |
| **Semantic Scholar** (선택) | 있으면 관련 논문과 추천이 훨씬 잘 작동합니다. 승인에 시간이 걸리므로 일찍 신청하세요 | [Semantic Scholar API](https://www.semanticscholar.org/product/api#api-key-form) |
| **Crossref용 이메일** (선택) | Crossref 요청을 "polite pool"에 넣습니다 | **검색** 섹션에 입력합니다 |

각 키 칸에는 **시험** 버튼이 있어, 여러분의 콘텐츠를 전혀 보내지 않는 요청으로 키를 확인합니다.
이 플러그인만을 위해 만든 키를 쓰고, 제공자 쪽에서 지출 한도를 걸어 두세요.

<!-- screenshot: docs/images/preferences-keys.png (P7-T27) -->

## 데이터와 개인정보

**Research Helper 서버는 없습니다.** 모든 요청은 여러분의 Zotero에서 아래에 적힌 서비스로 곧바로
가며, 플러그인은 누구에게도 원격 측정, 분석, 충돌 보고를 보내지 않습니다.

**API 키**는 Zotero의 `OSKeyStore`로 암호화되어 Zotero의 로그인 관리자에 보관되며, Zotero 환경설정에는
저장되지 않습니다. 설정 창은 사용 중인 저장소의 이름(예: Windows 자격 증명 관리자)을 보여 줍니다.
컴퓨터에 작동하는 자격 증명 저장소가 없으면(시스템 키링이 없는 Linux에서 그럴 수 있습니다)
플러그인은 키를 암호화하지 않은 채 저장하는 쪽으로 물러서지 않습니다. 대신 **이번 Zotero 세션
동안만** 보관하겠다고 제안하며, 다시 시작한 뒤에는 키를 다시 입력해야 합니다. 저장된 키는 다시
표시되지 않습니다. 설정 창에는 키의 앞 세 글자와 마지막 네 글자만 보입니다.

**이것이 막지 못하는 것.** 여러분의 사용자 계정으로 실행되는 모든 프로그램은 — 다른 Zotero
플러그인도 포함해 — 저장된 키를 복호화할 수 있습니다. 운영체제는 여러분의 권한으로 실행되는
모든 것에 키를 복호화해 주고, Zotero는 플러그인을 서로 격리하지 않기 때문입니다. 설정 창은 이
경고를 전문으로 보여 줍니다. 키를 브라우저에 저장한 비밀번호처럼 다루고, 지출 한도를 걸어 두고,
노출되었을지 모르는 키는 교체하세요.

**무엇이 어디로 가는가.** 콘텐츠는 여러분이 작업을 시작할 때만 컴퓨터 밖으로 나가며, AI 작업은
전송 대상을 먼저 보여 줍니다.

| 이런 작업을 하면… | 가는 곳 | 보내는 것 |
|---|---|---|
| 검색 및 가져오기 | 체크한 데이터베이스: `eutils.ncbi.nlm.nih.gov`(PubMed), `www.ebi.ac.uk`(Europe PMC), `api.crossref.org`, `api.semanticscholar.org`, `export.arxiv.org`, `api.biorxiv.org`(bioRxiv와 medRxiv), 그리고 PubMed 식별자를 변환하는 `pmc.ncbi.nlm.nih.gov` | 검색어, 기간, 결과 수 한도. NCBI나 Semantic Scholar 키를 설정했다면 그 키는 해당 서비스로만 갑니다. |
| 관련 논문 찾기, 추천 | 같은 데이터베이스, 그리고 식별자를 변환하는 `pmc.ncbi.nlm.nih.gov` | 논문의 공개 식별자(DOI, PubMed 또는 arXiv ID), 식별자가 없으면 제목. 추천에서는 컬렉션으로 만든 검색어와 일부 논문의 식별자 및 저자 이름 |
| 요약 | AI 제공자: `openrouter.ai`, `api.openai.com`, `generativelanguage.googleapis.com`(Gemini) 또는 `api.anthropic.com` | 논문마다 제목, 저자, 연도, 게재처, 항목 유형, DOI, Zotero 항목 키, 초록, 그리고 기본값으로 PDF나 Europe PMC 오픈 액세스 본문에서 추출한 전문 |
| 동향 보고서 생성 | AI 제공자 | 이미 만든 요약, 논문의 제목·연도·게재처, 그리고 **컬렉션 이름** |
| 새 논문 추천 | AI 제공자 | 컬렉션의 논문마다 한 줄(항목 키, 제목, 연도, 게재처, 주제어)과 개수. 초록과 컬렉션 이름은 보내지 않습니다 |
| 오디오 보고서 생성 | AI 제공자, 이어서 Google의 `generativelanguage.googleapis.com` | 음성 대본을 쓰기 위한 보고서 본문, 이어서 Google 음성 합성으로 보내는 대본. 이 음성은 컬렉션 이름과 인용된 저자를 소리 내어 읽을 수 있습니다 |
| 플러그인을 쓰는 것만으로 | Zotero가 `raw.githubusercontent.com`과 `github.com`에 접속합니다 | 이 플러그인에 대한 Zotero 자체의 업데이트 확인과 다운로드 |

문헌 데이터베이스로 가는 모든 요청에는 그 서비스들이 요청하는 대로, 플러그인과 관리자 연락처
주소를 밝히는 `User-Agent`가 붙습니다. 이메일을 입력했다면 Crossref는 그 이메일도 받습니다.
노트, 여러분의 태그, PDF 주석, 다른 논문의 내용은 보내지 않습니다. 설정에서 제공자의 사용자 지정
기본 URL을 정하면, 그 제공자로 가는 요청은 대신 그 주소로 갑니다.

**개인정보 모드.** **개인정보** 섹션의 모드(기본값은 균형)가 무엇을 어떤 모델로 보낼 수 있는지
정합니다. **엄격**은 초록만 보내고, 제공자가 입력을 학습에 쓸 수 있는 모델을 거부합니다.
**전체**는 가장 많이 허용합니다. OpenRouter에서는 모든 요청이 데이터를 수집하지 않는 제공자로만
라우팅해 달라고 요청합니다(`data_collection: deny`). Google의 **무료** Gemini 등급은 보낸 내용을
제품 개선에 쓸 수 있습니다. 플러그인은 키가 유료 키인지 알 수 없을 때마다 이를 경고합니다.

**플러그인이 만든 것 지우기.** **Settings → Research Helper → 고급 → Research Helper 콘텐츠 모두
제거…**는 찾아낸 생성된 노트, 검색 출처 노트, 오디오 첨부 파일이 몇 개이고 어느 라이브러리에
있는지 보여 주고, 확인하면 그것들을 Zotero 휴지통으로 옮기며(휴지통에서 복원할 수 있습니다)
플러그인이 저장한 데이터를 삭제합니다. 가져온 항목, 그 태그, 여러분이 쓴 노트는 그대로 남습니다.
링크된 오디오 파일은 디스크에 남으며, 확인 창이 그 폴더를 알려 줍니다. 플러그인 자체를 제거해도
이 노트와 첨부 파일은 라이브러리에 남으므로, 없애고 싶다면 이 명령을 먼저 실행하세요. 컬렉션
하나에 대해서는 그 컨텍스트 메뉴의 **컬렉션에서 생성된 노트 지우기…**를 씁니다. 같은 고급
섹션에서 캐시된 응답, 저장된 요약, 작업 기록, 임베딩을 따로 지우거나 설정을 되돌릴 수도 있습니다.

제공자들의 보존 조건과 그것을 확인한 날짜까지 담은 전체 설명은
[`docs/09-security-privacy-and-api-keys.md`](docs/09-security-privacy-and-api-keys.md)에 있습니다.
보안 문제는 [`SECURITY.md`](SECURITY.md)를 보세요.

## 비용

모든 AI 및 음성 합성 사용료는 제공자가 **여러분의 키**에 청구합니다. 플러그인 자체는
무료입니다.

- **측정된 비용:** 기준 작업량(초록 100편을 요약한 다음 그 요약으로 동향 보고서 하나를 쓰는 작업,
  제공자의 작고 저렴한 등급 사용, 목표는 최대 US $1.00)의 비용은 릴리스 체크리스트
  [`docs/release/v1.0-checklist.md`](docs/release/v1.0-checklist.md)에서 측정합니다.
- **기본값은 전문입니다.** 요약은 논문의 전문을 쓸 수 있고 그것이 초록보다 훨씬 길면 언제나 전문을
  쓰므로, 초록만 쓰는 실행보다 훨씬 많은 텍스트를 보냅니다. 설계 추정치로는 일반적인 학술지 논문
  컬렉션에서 초록만 쓰는 실행 입력의 약 8배, 아주 긴 논문에서는 최대 약 32배입니다. 이것은
  측정값이 아니라 추정치입니다. 설정에서 초록만 쓰도록 고를 수 있습니다.
- **실행할 때마다** 확인 창이 예상 비용을 보여 줍니다.
- **출시할 때의 지출 한도:** 세션당 한도 **US $5.00**(Zotero를 다시 시작하면 초기화됩니다)이고,
  실행당 한도는 없습니다. 둘 다 설정에서 바꿀 수 있으며, 0으로 하면 한도가 꺼집니다.
- 제공자의 가격은 바뀌므로, 추정치는 그 추정에 쓴 가격만큼만 최신입니다.

## 알려진 제한 사항

- **유료 구독 PDF는 받지 않습니다.** 플러그인은 라이브러리에 이미 있는 PDF와 오픈 액세스 전문을
  쓰며, 출판사 웹사이트에서 내려받지 않습니다.
- 인터페이스와 생성되는 보고서 모두 **영어와 한국어만** 지원합니다.
- **예약 작업이나 백그라운드 작업은 없습니다.** 모든 것은 여러분이 시작할 때 실행됩니다.
- **PDF 텍스트 추출은 최선을 다하는 수준입니다.** 쓸 만한 전문을 추출할 수 없으면 요약은 초록을
  씁니다. 서론, 방법, 결과, 고찰을 구분하는 섹션 감지기는 따로 떼어 둔 논문 19편으로 한 번
  측정했으며, 그 구조를 가진 15편에서 문자의 **92.94 %**가 올바른 섹션에 들어갔습니다
  ([`docs/06-summarization-and-trend-report.md`](docs/06-summarization-and-trend-report.md) §4.3
  참고). PDF 추출 품질을 이보다 큰 규모로 검증한 적은 없습니다.
- **macOS와 Linux는 검증되지 않았습니다**(호환성 참고).

## 문제 해결

- **진단 정보.** **Settings → Research Helper → 고급**에 있는 **진단 정보 보기**는 플러그인과
  Zotero 버전, 설정, 최근 작업, 마지막 로그 줄, 최근 오류를 담은 텍스트를 보여 주며, API 키나 논문
  내용은 담지 않습니다. 읽어 본 다음 **진단 정보 복사** 또는 **진단 정보 저장…**으로 보고에
  첨부하세요.
- **더 자세히.** 같은 섹션에서 **자세한 디버그 기록**을 체크하고, 잘못된 작업을 다시 해 본 다음,
  진단 정보를 다시 보세요. Zotero 자체의 **도움말 → 디버그 출력 로그**에도 플러그인의 로그 줄이
  기록됩니다.
- **문제 보고**는 [GitHub Issues](https://github.com/suppakoko/research_helper/issues)에 해 주세요.
  보안 문제라면 대신 [`SECURITY.md`](SECURITY.md)를 따르세요.

## 데이터 출처와 저작자 표시

검색 결과는 PubMed(NCBI), Europe PMC, Crossref, Semantic Scholar, arXiv, bioRxiv, medRxiv에서
옵니다. Semantic Scholar의 데이터는
[Semantic Scholar API License Agreement](https://www.semanticscholar.org/product/api/license)에
따라 Allen Institute for AI가 제공합니다. 각 서비스가 돌려주는 내용에는 그 서비스의 이용 약관이
적용됩니다.

## 기여하기

이슈와 풀 리퀘스트를 환영합니다. 플러그인은 TypeScript로 작성되었고 `zotero-plugin-scaffold`와
`zotero-plugin-toolkit`으로 빌드합니다:

```bash
npm ci
npm run typecheck && npm run lint:check && npm run test   # 네트워크와 키가 필요 없습니다
npm run build                                             # .scaffold/build/research-helper.xpi를 만듭니다
```

설계 문서는 [`docs/`](docs/)에 있고([`docs/00-overview.md`](docs/00-overview.md)부터 읽으세요),
작업 계획은 [`plan/`](plan/)에 있습니다. 변경 사항은 [`CHANGELOG.md`](CHANGELOG.md)에 기록됩니다.

## 라이선스

[MIT](LICENSE).

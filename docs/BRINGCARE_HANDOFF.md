# 브링케어 마케팅·블로그 운영 인수인계서

최종 정리일: 2026-08-31  
대상 저장소: `bringengineering1008-pixel/FM`  
작업 브랜치: `codex/bringcare-blogpeople-redesign`  
기준 커밋: `136925cf` 이후

## 1. 이 저장소의 목적

이 저장소는 브링케어의 네이버 블로그 운영, 콘텐츠 기획·검증, 텔레그램 승인 리모컨, 관련 이미지·매뉴얼·성과 원장을 함께 관리한다.

브링케어의 핵심 설명은 다음과 같다.

> 원주 원룸·다가구의 문의, 점검, 청소, 수리 연결, 공실과 입·퇴실 준비를 한 창구에서 관리하고 처리 결과를 사진으로 보고하는 건물관리 회사

핵심 메시지는 두 문장을 함께 사용한다.

- `건물의 일을, 한 곳에서 끝냅니다.`
- `퇴실 14일 전부터 다음 임대를 준비합니다.`

`공실 0일`이나 `24시간 해결`은 모든 현장에서 보장되는 표현이 아니다. 수리·자재·건조·전문업체 일정 등 변수가 있으므로, 실제 상품 안내에서는 적용 조건과 제외 조건을 함께 적고 `목표` 또는 `임대 준비`라는 표현을 사용한다.

## 2. 인수 첫날에 할 일

1. 회사 GitHub 계정으로 저장소 접근 권한을 확인한다.
2. 이 브랜치를 내려받고 아래 검증 명령을 실행한다.
3. 네이버 작업 전 현재 로그인 계정이 브링케어 운영 계정인지 확인한다.
4. 텔레그램 토큰을 새 운영자의 Windows 계정에서 다시 설정한다. 기존 `token.dpapi`는 다른 Windows 사용자에게 이전할 수 없다.
5. 네이버 공개 블로그에서 공지 3편, 상단 메뉴, 프로필 문구, 최근 게시물의 공개 상태를 직접 확인한다.
6. `blog/automation/alerts.md`와 성과 원장을 읽고 미해결 장애와 성과 확인 기한을 확인한다.

```powershell
git clone https://github.com/bringengineering1008-pixel/FM.git
cd FM
git switch codex/bringcare-blogpeople-redesign
python -m pytest tests automation/tests -q --ignore=tests/test_bringcare_automation_prompt.py
```

저장소 테스트와 별도로 `tests/test_bringcare_automation_prompt.py`는
`C:\Users\<Windows사용자>\.codex\automations\automation\automation.toml`을 검사하는 PC별 테스트다.
자동화 설정을 해당 PC에 설치한 뒤 별도로 실행한다.

```powershell
python -m pytest tests/test_bringcare_automation_prompt.py -q
```

테스트가 실패하면 발행 작업부터 진행하지 말고, 로컬 Codex 스킬·자동화 설치 여부와 파일 경로를 먼저 확인한다.

## 3. 저장소에서 먼저 읽을 문서

| 우선순위 | 문서 | 용도 |
|---|---|---|
| 1 | `manuals/브링케어_네이버블로그_마스터매뉴얼_v1.2.docx` | 최종 글 작성·편집·검수 기준 |
| 2 | `blog/redesign/2026-08-29/home-first-page-copy.md` | 블로그 첫 화면, 메뉴, 공지 구조 |
| 3 | `docs/superpowers/specs/2026-08-29-bringcare-blogpeople-home-redesign.md` | 공식 블로그 분석 기반 개편 설계 |
| 4 | `docs/superpowers/specs/2026-08-26-bringcare-blog-turnover-redesign.md` | 입·퇴실 24H 상품과 표현 기준 |
| 5 | `docs/superpowers/specs/2026-08-20-bringcare-three-engine-media-design.md` | 콘텐츠 3개 엔진 운영 기준 |
| 6 | `automation/bringcare_telegram/README.md` | 텔레그램 승인 리모컨 설치·운영 |
| 7 | `blog/automation/performance-ledger.csv` | 발행 글별 성과 원장 |
| 8 | `blog/automation/topic-cooldown.csv` | 반복 주제 방지 |
| 9 | `blog/automation/alerts.md` | 로그인·CAPTCHA·검증 장애 기록 |

## 4. 콘텐츠 운영 체계

최근 공개 글 10개를 기준으로 세 엔진을 다음 비율로 운영한다.

| 엔진 | 목표 | 역할 | 상담 유도 |
|---|---:|---|---|
| 대중 유입 `traffic` | 5개 | 실제 인기 검색어로 신규 방문 확보 | 넣지 않음 |
| 구매·제휴 `affiliate` | 3개 | 승인된 상품의 구매 문제 해결 | 정확한 광고 고지와 승인 링크만 사용 |
| 브랜드·현장 `brand_field` | 2개 | 실제 현장과 서비스로 신뢰·상담 확보 | 자연스러울 때 CTA 하나 |

매 회차 후보는 최소한 다음 구성을 조사한다.

- 실제 실시간 인기 검색어 5개
- 구매 의도 키워드 3개
- 브랜드·현장 후보 2개

대중 유입 글은 브링케어와 관련이 없어도 된다. 대신 억지 회사소개, 상담 문단, 상담 배너를 넣지 않는다. 현장 글은 사용자가 제공한 실제 사진과 확인된 작업 정보가 있을 때만 작성하며, 다른 업체 사진을 브링케어 작업처럼 표현하면 안 된다.

## 5. 네이버 글 작성·편집 필수 규칙

- 제목을 제외한 본문 문단은 가운데 정렬한다.
- 한 문장 또는 완결된 의미 묶음 뒤에 빈 문단을 둔다.
- 소제목은 이모티콘 1개, 굵게, 밑줄 또는 제한된 색상 강조로 본문과 구분한다.
- 핵심 판단에는 네이버 실제 인용구 1~3개를 사용한다.
- 내용 블록 전환에는 네이버 실제 구분선 3~5개를 사용한다.
- 이미지는 관련 문단 가까이에 분산하고 짧은 캡션을 붙인다.
- 현장 사진은 한 장을 과도하게 크게 반복하지 말고, 가능한 경우 2~3장 묶음으로 다양한 작업 장면을 보여준다.
- PPT·서비스 안내 이미지는 글 중간의 해당 설명 위치에 배치하며, 글 전체를 이미지로 대체하지 않는다.
- 본문 하단에 출처·URL·태그·연락처를 덤프하지 않는다. 태그는 네이버 태그 입력란에만 등록한다.
- 상담 CTA는 글당 하나만 사용한다. 상담 배너가 필요한 글은 맨 마지막에 정확히 한 번 넣고 그 뒤에 아무 콘텐츠도 추가하지 않는다.
- AI 이미지는 실제 현장, 고객 사례, 전후 사진의 증거로 사용하지 않는다.

## 6. 대표 공지와 첫 화면

첫 화면의 목적은 방문자가 몇 초 안에 `무슨 회사인지`, `무엇을 맡길 수 있는지`, `어떻게 문의하는지` 이해하게 하는 것이다.

대표 공지 3편:

1. 브링케어 회사·역할 안내  
   `https://blog.naver.com/bringcare/224391303897`
2. 퇴실 14일 전부터 준비하는 입퇴실 24H 패키지  
   `https://blog.naver.com/bringcare/224391289128`
3. 정기관리·입퇴실청소·보수 연결 가격 안내  
   `https://blog.naver.com/bringcare/224367210845`

권장 상단 메뉴:

- 브링케어 안내
- 입퇴실 24H
- 현장 기록
- 건물주 가이드

헤더 시안과 첫 화면 문구는 `blog/redesign/2026-08-29/`에 있다. 공개 화면에 실제 반영됐는지는 네이버 블로그에서 별도로 확인해야 한다.

## 7. 텔레그램 승인 리모컨

텔레그램 리모컨은 OpenAI API를 쓰지 않는 규칙형 명령 시스템이다. 상태 조회, 수정 요청 기록, 승인·취소를 처리한다. 네이버 편집 화면을 스스로 열어 글을 작성하거나 CAPTCHA를 해결하는 기능은 아니다.

최초 설정:

```powershell
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/setup-telegram.ps1
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/install-remote-task.ps1
Start-ScheduledTask -TaskName "BringCare Telegram Remote"
```

상태 확인:

```powershell
Get-ScheduledTask -TaskName "BringCare Telegram Remote"
Get-ScheduledTaskInfo -TaskName "BringCare Telegram Remote"
python -X utf8 -m automation.bringcare_telegram.cli approval-status
```

발행 절차:

1. 원고·브리프·이미지 검증 완료
2. 네이버 편집 화면에서 서식·카테고리·태그·공개 설정 확인
3. `ready`로 승인 대기 등록
4. 등록된 개인 텔레그램 채팅에서 발행 요청 후 정확히 `승인`
5. 승인 상태를 단 한 번 선점
6. 최종 재검증 후 발행
7. 공개 페이지 QA
8. 공개 URL 기록 및 알림

승인이 있어도 로그인 만료, CAPTCHA, 편집기 변경, 정책 경고, 사실·권리 검증 실패가 있으면 발행하지 않는다.

## 8. 보안과 계정

절대 Git에 올리지 않는 항목:

- 텔레그램 봇 토큰
- 네이버 비밀번호와 로그인 쿠키
- Chat ID가 포함된 로컬 설정
- API 키, 개인키, OAuth 클라이언트 비밀
- `automation/secrets/`, `automation/state/`, `token.dpapi`, `local-config.json`

이 항목들은 `.gitignore`에 포함되어 있다. 새 운영자는 토큰 값을 전달받아 파일로 복사하지 말고 설정 스크립트로 다시 등록한다. 과거 채팅이나 화면 캡처에 노출된 토큰은 반드시 BotFather에서 폐기하고 새 토큰으로 교체한다.

네이버 상태 변경 전에는 항상 로그인 계정을 확인한다. 요청된 계정과 다르면 글 작성·수정·발행을 중단한다.

## 9. 로컬 Codex 스킬 의존성

글 작성과 검증에는 다음 로컬 스킬이 사용된다.

`C:\Users\user\.codex\skills\writing-bringcare-naver-blog`

이 폴더는 현재 Git 저장소 밖에 있으므로 이 브랜치를 복제하는 것만으로 자동 설치되지 않는다. 새 PC에서는 해당 스킬을 별도로 설치·이관하고 다음 파일이 있는지 확인한다.

- `SKILL.md`
- `scripts/validate_brief.py`
- `scripts/validate_draft.py`
- `references/content-system.md`
- `references/naver-format-qa.md`
- `references/blogpeople-100-patterns.md`
- `assets/naver-post-template*.md`

현재 일부 테스트는 기존 PC의 절대 경로를 참조한다. 다른 사용자명이나 다른 드라이브에서 운영하려면 테스트 경로를 환경변수 또는 저장소 상대경로로 바꾸는 작업이 필요하다.

## 10. 성과 기록 원칙

발행 후 72시간, 7일, 14일, 30일 성과를 확인한다. 실제로 확인할 수 없는 값은 `0`이 아니라 `NA`로 기록한다.

- 대중 유입: 조회, 검색·홈피드 유입, 반응, 저장·공유, 재방문 신호
- 구매·제휴: 클릭, 구매 행동, 글별 수익
- 브랜드·현장: 프로필 이동, 관련 글 이동, 상담, 계약 가능 신호

네이버 AI 브리핑 인용수는 노출 신호로 참고할 수 있지만 상담·매출 성과와 동일하게 해석하지 않는다. 제목, 대표 이미지, 도입부, 검색 의도와 현장 증거를 분리해 개선한다.

## 11. 현재 인수 시점의 상태

- 회사 GitHub 원격: `https://github.com/bringengineering1008-pixel/FM.git`
- 전달 브랜치: `codex/bringcare-blogpeople-redesign`
- 블로그 공식 패턴 100개 표본 분석과 첫 화면 개편 자료가 커밋되어 있다.
- 마스터 매뉴얼 v1.2와 헤더 이미지가 포함되어 있다.
- 텔레그램 리모컨 코드는 저장소에 있으나, 실제 토큰과 Windows 예약 작업 상태는 각 운영 PC에서 다시 확인해야 한다.
- 저장소 자체 테스트는 인수인계 작성 시점에 `276 passed, 3 subtests passed`였다. PC별 자동화 설정 테스트 1개는 로컬 `automation.toml`이 설치된 환경에서 별도로 실행해야 한다.
- `blog/automation/alerts.md`의 저장소 기준 열린 장애는 없다.
- 네이버의 실제 예약발행 수, 임시저장 수, 현재 로그인 세션, 공개 화면 반영 상태는 저장소만으로 확정할 수 없다. 인수자가 네이버 관리 화면에서 확인해야 한다.
- 이 브랜치는 회사 저장소의 기본 브랜치에 아직 병합되지 않았다. Pull Request 검토 후 병합한다.

## 12. 권장 후속 작업

1. 이 브랜치로 Pull Request를 만들고 문서·이미지·매뉴얼을 검토한다.
2. 로컬 Codex 스킬을 저장소 내부의 재현 가능한 패키지로 이관한다.
3. 절대 경로를 환경변수 또는 상대경로로 교체한다.
4. 네이버 공개 블로그의 대표 공지 3편과 첫 화면 구조를 실제 화면 기준으로 QA한다.
5. 실제 작업 사진의 소유권·개인정보 확인 기록을 자산별로 남긴다.
6. 텔레그램 토큰을 새 운영자 Windows 계정에서 재발급·등록하고 테스트 알림을 확인한다.
7. 성과 원장의 72시간·7일·14일·30일 기한을 정기 운영 일정에 넣는다.

## 13. 최종 인수 체크리스트

- [ ] 회사 GitHub 저장소 읽기·쓰기 권한 확인
- [ ] 전달 브랜치 체크아웃 및 테스트 통과
- [ ] 로컬 Codex 스킬 설치·경로 확인
- [ ] 네이버 운영 계정 확인
- [ ] 대표 공지 3편과 첫 화면 공개 QA
- [ ] 텔레그램 새 토큰 등록 및 테스트 알림 수신
- [ ] Windows 예약 작업 실행 상태 확인
- [ ] 공개·예약·임시저장 글 수 직접 확인
- [ ] 이미지 권리와 개인정보 확인
- [ ] 성과 원장과 주제 쿨다운 확인
- [ ] Pull Request 검토 및 기본 브랜치 병합

## 14. GitHub 링크

- 브랜치: `https://github.com/bringengineering1008-pixel/FM/tree/codex/bringcare-blogpeople-redesign`
- Pull Request 생성: `https://github.com/bringengineering1008-pixel/FM/pull/new/codex/bringcare-blogpeople-redesign`

# BRING Care 민원 자동화 인수인계

최종 정리일: 2026-07-27  
저장소: `bringengineering/FM`  
작업 브랜치: `claude/jolly-davinci-zl27wm`

## 1. 프로젝트 개요

세입자가 Google Form 또는 브링케어 카카오톡 채널로 민원을 접수하면
Google Apps Script가 접수 내용을 분석해 Firebase 케이스를 만들고,
GitHub Pages 대시보드에서 17단계 업무를 관리하는 시스템이다.

현재 핵심 목표는 아래 흐름이다.

1. 민원 접수와 계약 건물 매칭
2. 세입자·건물주 접수 문자 발송
3. 상담 내용과 업체 분류 자동 작성
4. 업체 선택 후 견적 요청 MMS 발송
5. 견적서·사업자등록증 업로드 및 브링 엑셀 생성
6. 최저가 견적 추천
7. 건물주 추천 MMS와 모바일 승인 링크 발송
8. 관리자 입금 확인
9. 업체 연결·일정 단계 진입

## 2. 현재 운영 주소

| 구분 | 주소 |
|---|---|
| 관리자 대시보드 | <https://bringengineering.github.io/FM/> |
| 건물주 모바일 승인 화면 | <https://bringengineering.github.io/FM/approve.html?c={caseId}> |
| Google Form | <https://docs.google.com/forms/d/e/1FAIpQLSfzi-H-abXT-dgsU5rF8vgkWuKtbltr9acgWClVeQ5W297DiA/viewform> |
| Google 응답 시트 | <https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit> |
| Apps Script 웹 앱 | <https://script.google.com/macros/s/AKfycbxGAdtEDoNifxkM-e_Jm7dBkCnjM4oPJqz8RxZXoMoSKod5M_m9Yj2b11-nI97zmfd6Jw/exec> |
| 카카오톡 채널 | <http://pf.kakao.com/_xnaRfX> |
| 카카오 챗봇 중계 Worker | <https://bring-care-kakao-intake.bringengineering1008.workers.dev> |
| Firebase RTDB | `https://bring-fm-hj-default-rtdb.asia-southeast1.firebasedatabase.app` |

Apps Script 웹 앱 URL은 새 버전을 배포해도 같은 배포를 수정하면 유지된다.

## 3. 현재 배포 버전

- 대시보드 `APP_VERSION`: `5.25`
- Apps Script `AUTOMATION_BUILD`: `complaint-workflow-20260729-v42`
- 추천 이미지 설계 버전: `owner-summary-v4`
- Apps Script 배포 버전: `99`
- Cloudflare Worker: `2026-07-27-v2`
- Cloudflare Worker 배포 버전 ID: `8bc0a1d8-9d8d-46cc-8d0b-b0cf6327d5b4`

동작을 수정했는데 사이트에서 예전 기능이 보이면 아래 두 버전을 먼저 확인한다.

1. `index.html`의 `APP_VERSION`
2. Apps Script 배포 관리 화면의 최신 버전

## 4. 시스템 구성

```text
Google Form --------------------+
                                |
카카오톡 채널 -> Kakao i Open Builder
              -> Cloudflare Worker
                                |
                                v
                         Apps Script 웹 앱
                                |
                                v
                       Google Sheets 응답
  -> Apps Script 트리거
  -> Drive 문서 검색·저장
  -> 카카오 알림톡 / SENS SMS·MMS
  -> Firebase Realtime Database
  -> GitHub Pages 관리자 대시보드
  -> 건물주 모바일 승인 화면
```

### 역할 구분

- Google Form: 세입자 민원 입력
- 카카오톡 채널·챗봇: 대화형 세입자 민원 입력과 최근 접수 상태 조회
- Cloudflare Worker: 카카오 스킬 요청 검증, Apps Script 중계, 1분 간격 예열
- Google Sheets: 원본 응답과 자동 분석 결과 보관
- Apps Script: 중앙 자동화, 알림톡/SENS, Drive, Firebase 처리
- Firebase: 케이스 상태와 업로드 결과 실시간 저장
- GitHub Pages: 관리자 화면과 건물주 승인 화면
- Google Drive: 온보딩 파일, 견적 원본, 사업자등록증, 브링 엑셀 보관
- MinerU: 문서 분석 보조. 실패해도 기본 추출 로직으로 진행

## 5. 단계별 현재 동작

| 단계 | 현재 동작 | 자동/수동 |
|---|---|---|
| ① 문의 접수 / 정보 입력 | 폼·카카오 접수, 온보딩 파일 매칭 후 케이스 생성 | 자동 |
| ② 접수확인 발송 | 세입자·건물주 알림톡 또는 SENS 문자 발송 | 자동 |
| ③ 상담·요청 파악 | 폼 내용으로 상담카드 작성 | 자동 |
| ④ 민원·요청 분류 | 문제 유형과 업체 분류 작성 | 자동 |
| ⑤ 업체 견적 요청 | 업체 선택 후 현장 사진 MMS 발송 | 수동 |
| ⑥ 견적 비교 | 견적서·사업자등록증 업로드 | 수동 |
| ⑦ 최적 추천 | 원본 금액이 가장 낮은 업체 추천 | 자동 |
| ⑧ 건물주에 추천 발송 | 추천 이미지와 승인 링크 MMS 발송 | 자동 |
| ⑨ 승인·입금 (계약) | 건물주가 승인 또는 다른 견적 요청 선택 | 건물주 |
| ⑩ 입금 확인 → 자동 진행 | 관리자가 고정 계좌 입금을 확인 | 수동 |
| ⑪ 업체 연결·일정 | 입금 확인 후 자동으로 진행중 전환 | 미구현 |
| ⑫ 공사 진행 (점검표) | 후속 작업 예정 | 미구현 |
| ⑬ 작업 사진(전/후) | 후속 작업 예정 | 미구현 |
| ⑭ B/A 보고서 | 후속 작업 예정 | 미구현 |
| ⑮ 정산·증빙 | 후속 작업 예정 | 미구현 |
| ⑯ 월간 리포트 | 후속 작업 예정 | 미구현 |
| ⑰ 유지관리·사후관리 | 후속 작업 예정 | 미구현 |

### 자동화가 멈추는 정상 지점

- ⑤: 관리자가 업체를 선택하고 견적 요청 MMS를 보내야 한다.
- ⑥: 관리자가 견적서와 필요 시 사업자등록증을 올려야 한다.
- ⑨: 건물주 응답을 기다린다.
- ⑩: 관리자가 실제 계좌 입금을 확인해야 한다.
- ⑪ 이후: 아직 운영 자동화가 구현되지 않았다.

### 카카오 접수 자동 진행

1. 챗봇이 건물명과 주소를 받아 Firebase에 동기화된 온보딩 계약 건물을 먼저 확인한다.
2. 건물명과 주소가 함께 일치하지 않으면 계약 건물 없음 안내 후 주소·건물명 재입력을 받는다.
3. 계약 확인 후 호실, 연락처, 문제 유형, 증상, 방문 가능 시간을 수집한다. 세입자 성명은 묻지 않는다.
4. Cloudflare Worker가 Apps Script로 요청을 중계한다.
5. Apps Script가 연락처를 문자열로 보존해 응답 시트와 Firebase 대기 케이스를 동시에 만든다. 카카오 사진은 원본 주소만 대기열에 기록해 챗봇 성공 응답을 먼저 반환한다.
6. 시간 기반 트리거가 카카오 사진의 Drive 저장, 계약 매칭, 상담카드, 업체 분류를 처리한다.
7. 세입자·건물주 접수 알림이 모두 성공하면 ②·③·④를 완료하고 ⑤를 진행중으로 전환한다.
8. 일부 발송 상태에서는 성공한 수신자 기록을 보존하고 누락된 수신자만 재시도한다.

## 6. 단계 전환 규칙

### ① 온보딩 매칭

1. 건물명과 주소 정확 일치
2. 정규화한 건물명 일치
3. 건물명 60%와 주소 40% 유사도 최고 후보
4. 동점이면 주소 유사도와 Drive 최신 수정일로 결정
5. 후보가 없을 때만 `계약확인보류`

### ⑤ 업체 견적 요청

- ⑤ 화면에서 업체를 선택한다.
- 선택 업체 모두에 MMS 발송이 성공해야 ⑤ 완료, ⑥ 진행중이 된다.
- 첨부 사진이 없거나 SENS 오류가 있으면 ⑤에 머문다.
- 업체에게는 개인정보와 건물명이 포함되지 않도록 구성했다.
- 견적서와 사업자등록증 회신 주소는 `bringengineering1008@gmail.com`이다.

### ⑥ 견적 비교

- 견적서와 사업자등록증은 한 번에 선택해 업로드할 수 있다.
- 사업자등록증은 견적 카드에 표시하지 않는다.
- 금액이 확인된 견적서가 1건 이상이고 업로드 작업이 끝나면 ⑥ 완료가 가능하다.
- 사업자등록증은 공급자 정보 빈칸 보충용이며 완료 필수 조건이 아니다.
- 목록 제거는 Firebase 목록에서만 제거하고 Drive 원본은 보존한다.

### ⑦ 최적 추천과 브링 금액

- 추천은 원본 견적금액이 가장 낮은 업체 기준이다.
- 브링 엑셀에는 원본 금액의 10%를 가산한다.
- 브링 최종금액은 100원 단위로 반올림한다.
- 재작성 때는 원본 기준금액으로 다시 계산해 10%가 중복 가산되지 않게 한다.

### ⑧~⑩ 승인과 입금

- ⑧ MMS에는 추천 업체, 브링 최종금액, 추천 이미지, 모바일 승인 링크가 포함된다.
- 건물주가 `승인하고 입금 진행`을 선택하면 ⑨ 완료, ⑩ 진행중이다.
- `다른 견적 요청`을 선택하면 ⑤로 되돌아간다.
- 건물주가 입금 완료 버튼을 누르는 구조는 사용하지 않는다.
- 관리자가 실제 계좌 입금을 확인하고 ⑩의 `입금 확인`을 누른다.
- 확인 성공 시 ⑩ 완료, ⑪ 진행중이다.

## 7. 중요 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 관리자 대시보드 전체 UI와 클라이언트 자동화 |
| `approve.html` | 건물주 모바일 승인 화면 |
| `apps-script/complaint-intake-to-firebase.gs` | Apps Script 운영 코드 |
| `apps-script/appsscript.json` | Apps Script 권한과 고급 Drive 서비스 |
| `apps-script/README.md` | Apps Script 설치 및 기능 설명 |
| `database.rules.json` | Firebase RTDB 규칙 |
| `firebase.json` | Firebase 관련 설정 |
| `data/building-maintenance-companies.js` | 업체 목록 데이터 |
| `mineru-server/` | MinerU 연동 서버 관련 코드 |
| `apps-script/*.test.js` | 자동화 시뮬레이션과 회귀 테스트 |

## 8. 현재 연결 ID

아래 값은 `apps-script/complaint-intake-to-firebase.gs`의
`COMPLAINT_CONFIG`가 최종 기준이다.

| 설정 | 값 |
|---|---|
| 응답 Spreadsheet ID | `1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA` |
| 응답 시트명 | `설문지 응답 시트1` |
| 온보딩 Drive 폴더 ID | `1GKI8oc4iicdEw7MnPKpfZrwKd4ZGKnBZ` |
| 견적 Drive 폴더 ID | `11QX5F-KRQvvYNc0hso3QACuMS7lMZw4r` |
| 브링 견적 템플릿 ID | `1JXP8NEaU0I_96ZMAZFn2GlYQHkLsbhSJCawsdMgqH7w` |
| 납부 관리 Drive 폴더 ID | `1q1uKquSngjyi0upoCRmjnRxm_CD1sAcN` |
| Firebase 케이스 경로 | `cases` |

과거 README에 다른 온보딩 폴더 ID가 남아 있을 수 있으므로 반드시 실행 코드의
`CONTRACT_DRIVE_FOLDER_ID`를 확인한다.

## 9. Apps Script 속성

비밀값은 GitHub나 HTML에 넣지 않는다. Apps Script의
`프로젝트 설정 > 스크립트 속성`에만 저장한다.

### Naver Cloud SENS

- `NCP_SENS_SERVICE_ID`
- `NCP_ACCESS_KEY`
- `NCP_SECRET_KEY`
- `NCP_SENS_FROM`
- `NCP_SENS_TEST_TO`
- `SMS_ENABLED`

`NCP_SENS_FROM`은 SENS에서 승인된 발신번호와 숫자까지 정확히 같아야 한다.

### MinerU

- `MINERU_API_KEY`
- `MINERU_API_URL`
- `MINERU_MODEL_VERSION`
- `MINERU_LANGUAGE`
- `MINERU_SYNC_ENABLED`
- `MINERU_MAX_WAIT_SECONDS`

### 기타

- `VENDOR_QUOTE_REPLY_EMAIL`
- `PAYMENT_SCHEDULE_SPREADSHEET_ID`

## 10. 반드시 교체할 테스트 정보

현재 고정 입금 계좌는 테스트용이다.

```text
계좌번호: 123-456-789012
예금주: 브링케어
```

실운영 전 아래 세 파일을 같은 값으로 함께 바꿔야 한다.

- `index.html`
- `approve.html`
- `apps-script/complaint-intake-to-firebase.gs`

한 곳만 바꾸면 관리자 화면, 건물주 화면, 문자 내용이 서로 달라질 수 있다.

## 11. 배포 방법

### GitHub Pages 대시보드

1. `index.html` 또는 `approve.html`을 수정한다.
2. 사용자에게 보이는 변경이면 `APP_VERSION`과 변경 내역을 올린다.
3. JavaScript 문법과 테스트를 확인한다.
4. 커밋 후 현재 브랜치를 원격으로 푸시한다.
5. GitHub Pages 반영까지 약 1~2분 기다린다.
6. 브라우저에서 `Ctrl+Shift+R`로 강력 새로고침한다.

### Apps Script

1. 로컬 `apps-script/complaint-intake-to-firebase.gs`를 수정한다.
2. `AUTOMATION_BUILD`를 올린다.
3. 전체 코드를 Apps Script의 `Code.gs`에 붙여넣고 저장한다.
4. 권한 범위를 바꿨다면 `appsscript.json`도 반영한다.
5. `배포 > 배포 관리 > 수정 > 새 버전`을 선택한다.
6. 설명을 입력하고 배포한다.
7. 기존 웹 앱 배포를 수정하면 URL은 바뀌지 않는다.

트리거를 다시 만들 때는 `setupComplaintAutomation()`을 실행한다. Drive 권한 문제가
있으면 `authorizeDriveAccess()`를 실행해 다시 승인한다.

## 12. 테스트 명령

저장소 루트에서 아래 테스트를 실행한다.

```powershell
node apps-script/workflow-simulation.test.js
node apps-script/onboarding-field.test.js
node apps-script/payment-calendar.test.js
node apps-script/tenant-payment-sync.test.js
git diff --check
```

배포 전 실제 테스트 접수도 1건 확인한다.

1. 폼 접수 후 ①~④ 자동 완료와 ⑤ 진행중
2. ⑤ 업체 MMS 성공 후 ⑥ 진행중
3. 견적 업로드 후 ⑦ 추천
4. ⑧ 건물주 MMS와 승인 링크
5. 건물주 승인 후 ⑩ 진행중
6. 관리자 입금 확인 후 ⑪ 진행중

## 13. 데이터 저장 원칙

- Firebase 저장은 `cases/{caseId}` 또는 필요한 자식 경로만 `PATCH`한다.
- 전체 `cases` 트리를 통째로 덮어쓰지 않는다.
- 완료된 상태를 오래된 브라우저 데이터로 되돌리지 않는다.
- 케이스 삭제는 실제 삭제가 아니라 `archived` 보관 방식이다.
- 휴지통에서는 복원 또는 영구 삭제를 선택한다.
- 견적 목록에서 제거해도 Drive 원본은 감사 기록을 위해 유지한다.
- 문자, 업로드, 승인 요청은 요청 ID를 저장해 중복 실행을 막는다.

## 14. 자주 발생한 문제

### 코드는 바꿨는데 동작이 그대로임

- GitHub Pages 캐시 또는 Apps Script 새 버전 미배포가 원인인 경우가 많다.
- `APP_VERSION`, `AUTOMATION_BUILD`, Apps Script 배포 버전을 확인한다.

### `from is not an authenticated tel number`

- `NCP_SENS_FROM`이 승인된 발신번호와 다르다.
- 하이픈 유무와 숫자를 포함해 SENS 등록값과 맞춘다.

### Drive 권한 오류

- `appsscript.json`에 Drive 쓰기 권한이 있는지 확인한다.
- `authorizeDriveAccess()`를 실행하고 권한을 승인한다.
- 승인 후 반드시 Apps Script 새 버전을 배포한다.

### MinerU HTTP 403

- 토큰, API URL, 사용 가능량 또는 지원 형식을 확인한다.
- MinerU 실패 시 기본 DOCX/XLSX/HWPX/Drive OCR 추출로 fallback한다.

### 단계가 완료와 진행중 사이에서 깜빡이거나 뒤로 감

- 브라우저의 오래된 전체 케이스 저장이 원인일 가능성이 높다.
- 전체 `set(cases)`를 사용하지 말고 케이스별 또는 상태별 `PATCH`만 사용한다.

### 삭제한 케이스나 견적이 다시 나타남

- 늦게 도착한 Apps Script 결과가 과거 데이터를 덮는지 확인한다.
- 보관 상태를 병합 시 보존하고, 제거한 `quoteId`를 전체 케이스 쓰기로 복구하지 않게 한다.

### 온보딩 파일 미매칭

- 실제 코드의 온보딩 폴더 ID를 확인한다.
- DOCX 본문에 건물명과 주소가 들어 있는지 확인한다.
- Apps Script 실행 계정이 해당 폴더와 파일을 열 수 있어야 한다.

### ⑧에서 문자만 오고 다음 단계로 안 넘어감

- SENS 요청 결과, 승인 링크 생성, 추천 이미지 생성 결과를 확인한다.
- Apps Script 최신 배포가 반영됐는지 확인한다.
- `ownerRecommendationMms` 성공 상태와 `status/c8`, `status/c9`를 확인한다.

### 카카오 접수 연락처의 첫 `0`이 사라짐

- Google Sheets가 전화번호를 숫자로 처리하면 `010...`의 첫 `0`이 사라질 수 있다.
- v35부터 카카오 연락처 셀을 텍스트 형식으로 먼저 지정한 후 저장한다.
- v36부터 과거 값이 `102...`처럼 저장돼도 `010...`으로 복구하고 시트·Firebase·문자 상태를 함께 보정한다.

### 카카오 챗봇에서 “연결이 원활하지 않습니다”가 표시됨

- Apps Script 콜드 스타트가 카카오 스킬 응답 제한 시간을 넘긴 경우가 많다.
- v42부터 마지막 동의 요청에서 카카오 사진을 동기 저장하지 않고 1분 대기열로 넘겨 응답 지연을 줄였다.
- Cloudflare Worker의 Cron Trigger가 1분마다 Apps Script keepalive를 호출하도록 배포되어 있다.
- Worker `/health` 응답과 Cloudflare `Workers Logs`, Apps Script 실행 내역을 순서대로 확인한다.

## 15. 보안 주의사항

- SENS 키와 MinerU 토큰을 커밋하지 않는다.
- Cloudflare의 `APPS_SCRIPT_SKILL_URL` 비밀값과 Apps Script 챗봇 토큰을 커밋하지 않는다.
- GitHub Pages는 정적 공개 사이트이므로 원본 개인정보를 직접 넣지 않는다.
- 대시보드는 개인정보를 마스킹하지만 운영 전 인증 체계 보강이 필요하다.
- Apps Script 웹 앱은 GitHub Pages 호출을 위해 공개 접근으로 배포되어 있다.
- 실운영 전 Apps Script 요청에 공유 비밀키 또는 Firebase ID 토큰 검증을 추가한다.
- Firebase 규칙도 운영 계정 중심으로 다시 제한하는 것이 좋다.

## 16. 다음 개발 권장 순서

가장 먼저 ⑪ `업체 연결·일정`을 구현한다.

권장 흐름은 다음과 같다.

1. ⑩ 입금 확인 시 추천 업체를 ⑪ 배정 업체로 확정
2. 업체와 세입자의 방문 가능 시간을 모아 일정 후보 생성
3. 관리자가 일정 하나를 선택
4. 업체와 세입자에게 일정 확정 문자 발송
5. 양쪽 발송 성공 시 ⑪ 완료, ⑫ 진행중
6. ⑫에 점검표와 작업 전 사진 업로드 연결

그다음 순서는 ⑫ 점검표, ⑬ 전후 사진, ⑭ B/A 보고서, ⑮ 정산·증빙이 적합하다.

## 17. 인수 직후 확인 체크리스트

- [ ] GitHub 저장소와 현재 브랜치 접근 가능
- [ ] Google Form과 응답 시트 편집 가능
- [ ] Apps Script 프로젝트 편집 및 배포 가능
- [ ] Firebase 프로젝트 접근 가능
- [ ] 온보딩·견적 Drive 폴더 접근 가능
- [ ] SENS 프로젝트와 발신번호 상태 확인
- [ ] Apps Script 속성 존재 여부 확인
- [ ] 테스트용 고정 계좌를 실제 계좌로 교체
- [ ] 실제 테스트 민원 1건으로 ①~⑪ 흐름 확인
- [ ] GitHub Pages와 Apps Script 공개 접근 보안 재검토


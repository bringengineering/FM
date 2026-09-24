# 회사 비전·조직·연간/반기 목표 입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the existing isolated integration checkout. Steps use checkbox (`- [ ]`) syntax for tracking. No subagent was requested.

**Goal:** 관리자가 CRM에서 비전·보고 관계·연간/반기 목표를 초안으로 저장하고 명시적으로 게시하면 직원이 프로젝트 관리에서 승인본을 읽는다. 기존 분기 Objective/KR은 그대로 보존한다.

**Architecture:** `companyStrategyDrafts/<year>`와 `companyStrategyPublications/<year>`를 별도 Firebase RTDB 경로로 둔다. 초안은 관리자만 읽고 쓰며, 게시본은 인증된 직원이 읽되 관리자만 새 revision으로 교체한다. TV 서비스 조회 권한은 이번 단계에서 주지 않는다. 기존 `objectives`는 읽기 전용 연결로 유지하고 ID를 이동하지 않는다. 로컬 검증과 RTDB 규칙이 같은 필드 집합을 검사한다.

**Tech Stack:** Electron/Node CommonJS, 브라우저 UMD 코어, Firebase Realtime Database REST와 Emulator Rules, 기존 CRM `app.js`/`remote.js`/`main.js`.

---

## 파일 책임

- `desktop-crm/src/company-strategy-core.js`: 안전한 필드 정규화·초안/게시 전 검증. 서버 요청의 원본은 UI가 아닌 이 모듈이다.
- `desktop-crm/src/remote.js`: 관리자 초안 조회·저장·게시와 인증된 직원의 게시본 조회. 저장 전 현재 revision을 다시 읽고, 충돌을 실패로 반환한다.
- `database.rules.json`: 관리자/직원 읽기 구분, 삭제 금지, revision 단조 증가, 필드 크기/형식 검증.
- `desktop-crm/src/main.js`, `preload.js`: 좁은 `load/save/publish` IPC. 기존 원격 세션 guard를 재사용한다.
- `desktop-crm/src/app.js`, `index.html`, `toss.css`: 프로젝트 관리 홈의 게시본과 관리자 편집기. 새 디자인은 `Light Mist` 범위에만 적용한다.
- `desktop-crm/test/company-strategy-core.test.js`, `company-strategy-wiring.test.js`, `company-site/tests/field/database-rules.test.ts`: 계산/권한/화면 경계 검증.

## 저장 계약

경로별 레코드는 같은 `year`, `revision`, `vision`, `organization`, `goals`, `updatedAt`, `updatedBy`를 갖는다. `organization`은 UID 키 아래 `{uid,role,reportsToUid}`를, `goals`는 고정 ID 키 아래 `{id,period,title,unit,baseline,target,current,source}`를 둔다. `period`는 `annual`, `H1`, `H2`만 허용한다. `unit`은 `count`, `percent`, `krw`, `day`, `milestone` 중 하나다. `milestone`은 숫자 진행률을 계산하지 않는다. 숫자 목표도 `source`가 비어 있거나 `current`가 미확인인 경우 달성률 대신 `확인 필요`를 표시한다. 게시본에는 `publishedAt`, `publishedBy`, `sourceRevision`이 추가된다. 고객·계약·출입정보·급여·평가 내용은 이 저장소에 넣지 않는다.

## Task 1: 입력 계약과 실패 우선 테스트

**Files:** create `desktop-crm/src/company-strategy-core.js`; create `desktop-crm/test/company-strategy-core.test.js`.

- [x] **Step 1:** `validateDraft({year:'2026',vision:'공간 운영을 투명하게',organization:[{uid:'u1',role:'대표',reportsToUid:''}],goals:[{id:'g1',period:'annual',title:'건물 데이터 3동',unit:'count',baseline:0,target:3,current:null,source:'CRM 건물 ID'}]})`가 `ok:true`와 정규화된 레코드를 반환하고, `percent:null`인 투영 테스트를 작성한다.
- [x] **Step 2:** `node --test test/company-strategy-core.test.js`를 실행해 아직 모듈이 없어서 실패함을 확인한다.
- [x] **Step 3:** `validateDraft`, `validatePublication`, `projectStrategy`를 UMD로 구현한다. 문자열 상한은 비전 500, 역할 60, 목표 제목 200, 출처 200자; 연도는 `^20[0-9]{2}$`; 조직 30명, 목표 30개; 고유 UID/목표 ID와 연간/반기 기간을 검사한다. 정규화 결과에 원본 객체를 spread하지 않는다.
- [x] **Step 4:** 같은 테스트에서 누락 출처, 유효하지 않은 숫자, 중복 ID, 존재하지 않는 상위 보고자, 순환 보고 관계, 비전/목표가 없는 게시를 각각 거부하게 만든다. 핵심 실패를 먼저 보고 구현을 보강한다.
- [x] **Step 5:** 집중 테스트와 `git diff --check`를 통과한다.

## Task 2: 서버 권한과 revision

**Files:** modify `database.rules.json`; modify `company-site/tests/field/database-rules.test.ts`.

- [x] **Step 1:** Emulator 테스트에 관리자/직원/viewer/TV-reader 4개 신분을 두고, 초안 관리자만 읽기·쓰기, 게시본 직원 조회, TV-reader 거부, 삭제 거부, 같은 revision 재저장/건너뛰기 거부를 먼저 작성한다.
- [x] **Step 2:** 로컬 기본 database 포트 9000이 사용 중이어서 검증 전용 임시 설정의 9010으로 동일 규칙을 로드했다. 집중 테스트에서 새 경로 쓰기가 권한 거부로 실패함을 확인했다.
- [x] **Step 3:** `crmCompany/companyStrategyDrafts/$year`와 `companyStrategyPublications/$year`에 각각 좁은 `.read`, `.write`, `.validate`를 추가한다. 관리자 조건은 기존 `projects` 규칙과 같은 활성·이메일 검증·역할 검사다. `revision`은 첫 저장 1, 이후 이전 값+1이다. `$other`는 false로 닫는다. 게시의 `sourceRevision`은 같은 연도 초안 revision과 같아야 한다.
- [x] **Step 4:** 전체 Rules 135개를 다른 로컬 포트의 에뮬레이터에서 통과했다. 기존 인접 경로의 거부 테스트도 함께 실행됐다. 임시 설정 파일은 제거했다.
- [ ] **Step 5:** 규칙과 테스트만 별도 커밋한다. 운영 규칙 배포는 하지 않는다.

## Task 3: 서버 읽기·쓰기와 IPC

**Files:** modify `desktop-crm/src/remote.js`, `main.js`, `preload.js`; create `desktop-crm/test/company-strategy-remote.test.js`.

- [ ] **Step 1:** 실패 테스트에서 `loadCompanyStrategy`의 관리자만 draft 접근, 직원의 published 접근, `saveCompanyStrategyDraft`의 이전 revision 재조회, `publishCompanyStrategy`의 초안 검증 및 명시적 관리자 실행을 확인한다.
- [ ] **Step 2:** 집중 테스트를 실행해 메서드/IPC 부재로 실패함을 확인한다.
- [ ] **Step 3:** `remote.js`에서 기존 `requireOfficeSession`, `captureSessionGuard`, `dbRequest`를 사용해 경로를 연도 하나로 고정한다. 게시 전 같은 해 초안을 다시 읽고 코어 검증 후 새 게시 revision을 작성한다. 요청·오류에 비밀이나 원문을 출력하지 않는다.
- [ ] **Step 4:** `crm:company-strategy-load`, `crm:company-strategy-draft-save`, `crm:company-strategy-publish`를 narrow IPC로 연결하고, 세션 변경/권한 하락/서버 거부가 저장 성공으로 보이지 않음을 테스트한다.
- [ ] **Step 5:** 집중 테스트와 전체 `npm test`를 통과한다.

## Task 4: 프로젝트 홈에서 입력·승인본 확인

**Files:** modify `desktop-crm/src/app.js`, `index.html`, `toss.css`; create `desktop-crm/test/company-strategy-wiring.test.js`.

- [ ] **Step 1:** 목표 편집 중 자동 갱신이 폼을 교체하지 않는 것, 직원이 draft/게시 버튼을 보지 못하는 것, 게시 전에는 TV 표시 문구가 없는 것, 실패 시 입력이 남는 것, 초안과 게시본 상태가 분명히 다른 것을 검증하는 실패 테스트를 작성한다.
- [ ] **Step 2:** 집중 테스트의 예상 실패를 확인한다.
- [ ] **Step 3:** 프로젝트 홈에 `회사 방향` 카드와 관리자 전용 편집기를 넣는다. 비전, 인원별 역할·보고 대상 선택, 연간/상·하반기 목표·단위·기준값·목표값·확인값·출처를 입력받는다. `초안 저장`과 `직원에게 게시`를 분리한다. 구 Objective/KR은 새 입력과 합치거나 삭제하지 않는다.
- [ ] **Step 4:** 1366×768 및 좁은 창에서 카드·입력/오류 상태를 확인하고, 전체 `npm test`·`git diff --check`를 통과한다.
- [ ] **Step 5:** 코드와 테스트를 검토 요청에 올린다. 실제 회사 문구·목표값은 입력하지 않고 운영 배포도 하지 않는다.

## 검수 게이트

회사 자료를 넣기 전까지 게시본은 빈 상태여야 한다. 이 단계는 CRM 입력/조회까지다. TV 투영은 개인정보 필터·관리자 게시본·기기 권한·서버 갱신 경로를 검증하는 별도 변경에서만 추가한다. 회계 매출과 Gemini는 원천/비용/권한 결정 이후 별도 계획으로 진행한다.

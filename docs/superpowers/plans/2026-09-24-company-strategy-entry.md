# 회사 비전·조직·연간/반기 목표 입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the existing isolated integration checkout. Steps use checkbox (`- [ ]`) syntax for tracking. No subagent was requested.

**Goal:** 관리자가 CRM에서 비전·보고 관계·연간/반기 목표를 초안으로 저장하고 명시적으로 게시하면 직원이 프로젝트 관리에서 승인본을 읽는다. 기존 분기 Objective/KR은 그대로 보존한다.

**Architecture:** `companyStrategyDrafts/<year>`와 `companyStrategyPublications/<year>`를 별도 Firebase RTDB 경로로 둔다. 초안은 관리자만 읽고 쓰며, 게시본은 인증된 직원이 읽되 관리자만 새 revision으로 교체한다. TV 서비스 조회 권한은 이번 단계에서 주지 않는다. 기존 `objectives`는 읽기 전용 연결로 유지하고 ID를 이동하지 않는다. 초안의 구조화된 필드와 함께 승인 대상 전체를 직렬화한 `content`를 저장하고, 게시본은 이 `content`와 메타데이터만 갖는다. RTDB 규칙은 게시 `content`와 현재 초안 `content`의 완전 일치를 검사한다. 게시를 읽는 CRM은 파싱 후 로컬 검증을 다시 수행한다. 이는 RTDB 규칙이 동적 자식 맵의 누락을 검사할 수 없다는 에뮬레이터 검증 결과를 반영한 변경이다.

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

초안 레코드는 `year`, `revision`, `vision`, `organization`, `goals`, `content`, `updatedAt`, `updatedBy`를 갖는다. 게시 레코드는 `year`, `revision`, `content`, `updatedAt`, `updatedBy`, `publishedAt`, `publishedBy`, `sourceRevision`만 갖는다. `content`는 초안의 승인 대상 전체(`year`, `vision`, `organization`, `goals`)를 직렬화한 30,000자 이하 문자열이다. `organization`은 Firebase 안전 키 아래 `{uid,role,reportsToUid}`를, `goals`는 고정 ID 키 아래 `{id,period,title,unit,baseline,target,current,source}`를 둔다. `period`는 `annual`, `H1`, `H2`만 허용한다. `unit`은 `count`, `percent`, `krw`, `day`, `milestone` 중 하나다. `milestone`은 숫자 진행률을 계산하지 않는다. 숫자 목표도 `source`가 비어 있거나 `current`가 미확인인 경우 달성률 대신 `확인 필요`를 표시한다. 고객·계약·출입정보·급여·평가 내용은 이 저장소에 넣지 않는다.

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
- [x] **Step 5:** 규칙과 테스트를 별도 커밋했다. 운영 규칙 배포는 하지 않았다.

## Task 3: 서버 읽기·쓰기와 IPC

**Files:** modify `desktop-crm/src/remote.js`, `main.js`, `preload.js`; create `desktop-crm/test/company-strategy-remote.test.js`.

- [x] **Step 1:** 실패 테스트에서 `loadCompanyStrategy`의 관리자만 draft 접근, 직원의 published 접근, `saveCompanyStrategyDraft`의 이전 revision 재조회, `publishCompanyStrategy`의 초안 검증 및 명시적 관리자 실행을 확인했다.
- [x] **Step 2:** 집중 테스트를 실행해 메서드/IPC 부재로 실패함을 확인했다.
- [x] **Step 3:** `remote.js`에서 기존 세션·ETag 경계를 사용해 저장·게시 경로를 연도 하나로 고정했다. 게시 전 같은 해 초안을 다시 읽고 검증한다.
- [x] **Step 4:** 세 IPC와 mutation-policy 분류를 연결했다. 세션 변경·관리자 권한·revision 충돌 테스트를 통과했다.
- [x] **Step 5:** 집중 테스트와 전체 `npm test` 2,325 통과·2 skip·0 fail.

## Task 4: 프로젝트 홈에서 입력·승인본 확인

**Files:** modify `desktop-crm/src/app.js`, `index.html`, `toss.css`; create `desktop-crm/test/company-strategy-wiring.test.js`.

- [x] **Step 1:** 신규 IPC·화면·편집 상태·좁은 화면·인증 변경 캐시 무효화 실패 테스트를 작성했다.
- [x] **Step 2:** 집중 테스트의 예상 실패를 확인했다.
- [x] **Step 3:** 프로젝트 홈에 `회사 방향` 카드와 관리자 전용 편집기를 넣었다. 비전, 인원별 역할·보고 대상 선택, 연간/상·하반기 목표·단위·기준값·목표값·확인값·출처를 입력받는다. `초안 저장`과 `직원에게 게시`를 분리한다. 구 Objective/KR은 변경하지 않았다.
- [ ] **Step 4:** 1366×768 및 좁은 창에서 카드·입력/오류 상태를 확인하고, 전체 `npm test`·`git diff --check`를 통과한다.
- [ ] **Step 5:** 코드와 테스트를 검토 요청에 올린다. 실제 회사 문구·목표값은 입력하지 않고 운영 배포도 하지 않는다.

## 검수 게이트

회사 자료를 넣기 전까지 게시본은 빈 상태여야 한다. 이 단계는 CRM 입력/조회까지다. TV 투영은 개인정보 필터·관리자 게시본·기기 권한·서버 갱신 경로를 검증하는 별도 변경에서만 추가한다. 회계 매출과 Gemini는 원천/비용/권한 결정 이후 별도 계획으로 진행한다.

**직접 관리자 쓰기 제한:** RTDB 규칙은 초안 `content`의 길이와 게시본의 정확한 문자열 복사까지 검증하지만, 초안의 동적 `organization`·`goals` 맵과 `content`의 의미상 동등성은 규칙만으로 검사하지 못한다. 일반 CRM 저장·게시 경로는 직렬화를 생성하고 게시 전 다시 비교한다. 관리자 계정으로 Firebase에 직접 쓴 초안은 이 UI 계약을 우회할 수 있으므로 직접 수정은 지원하지 않으며, 운영 배포 전 관리자 권한 계정과 직접 쓰기 경로를 별도로 감사한다.

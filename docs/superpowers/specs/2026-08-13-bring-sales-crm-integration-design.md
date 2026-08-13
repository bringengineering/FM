# BRING 건물 영업 CRM 통합 설계

- 작성일: 2026-08-13
- 기준 버전: BRING CRM Desktop `v1.6.3` (`crm-v1.6.3`, `ac6c24f`)
- 상태: 사용자 승인 요구사항을 최신 데스크톱 CRM 구조에 반영
- 대상 저장소: `bringengineering/FM`
- 대상 사용자: 현재 BRING CRM에 로그인해 사용하는 팀원 전원

## 1. 목적

현재 BRING CRM의 `영업 관리` 화면을 건물 중심의 실제 영업 작업공간으로 확장한다. 팀원은 별도 프로그램으로 이동하지 않고 건물 발굴, 연락처 확보, 접촉, 공실 매물접수, 광고게시, 임대차계약, 유료관리 전환과 청소·수리 등 추가서비스 기회까지 같은 공용 데이터에서 기록한다.

이 기능은 새 CRM이나 새 로그인 체계를 만드는 프로젝트가 아니다. `desktop-crm/src/index.html`에 이미 있는 `data-view="pipeline"` 메뉴와 현재 Google 로그인 세션, Electron IPC 저장 흐름, 회사 Firebase 공용 저장소를 그대로 사용한다.

## 2. 사업 기준과 확정 원칙

BRING의 영업 기준 문장은 다음과 같다.

> 공실 해결로 첫 관계를 만들고, 임대관리 성과를 보여준 뒤 청소·수리·건물관리로 확장한다.

구현 원칙은 다음과 같다.

1. 새 로그인, 회원가입, 팀원 승인, 별도 비밀번호 화면을 만들지 않는다.
2. 현재 데스크톱 CRM의 Google 로그인과 공용 저장·실시간 동기화를 그대로 재사용한다.
3. 영업 기능만을 위한 대표·직원 권한 모델을 추가하지 않는다. 기존 CRM의 로그인 사용자와 쓰기 권한 판정을 그대로 따른다.
4. 새 메뉴를 추가하지 않고 기존 `영업 관리` 화면을 교체·확장한다.
5. 영업 기준 카드는 고객이 아니라 영업대상 건물이다.
6. 운영 중인 `buildings`·`customers`와 영업후보를 자동으로 섞지 않는다. 영업대상은 별도 컬렉션에 두고 확인된 경우에만 기존 레코드 ID로 연결한다.
7. 기존 고객 영업 6단계, 민원·공사 케이스 17단계와 새 건물 영업 13단계를 구분한다.
8. 매물접수와 광고게시는 각각 별도의 완료증거 이벤트로 기록한다.
9. 견적요청과 견적승인은 매출로 계산하지 않는다. `매출기록` 이벤트가 있는 추가서비스 기회만 매출 KPI에 포함한다.
10. 실제 주소가 없는 `1호 건물` 같은 익명 PoC 정보를 추측하거나 운영 데이터에 자동 생성하지 않는다.
11. 기존 민원 CRM, 입금 캘린더, BRING FIELD, 건물지도와 사용자 수정 파일 `wonju-map.html`의 동작을 변경하지 않는다.

## 3. 최신 CRM 통합 구조

### 3.1 화면 진입점

- 기존 사이드바의 `<button data-view="pipeline">영업 관리</button>`를 그대로 사용한다.
- `desktop-crm/src/app.js`의 `renderPipeline()`을 건물 중심 화면으로 확장한다.
- `desktop-crm/src/index.html`에는 전용 스타일·도메인 모듈을 `app.js`보다 먼저 로드한다.
- 별도의 HTML 페이지, 브라우저 창, 외부 링크나 새 Electron `WebContentsView`를 만들지 않는다.
- `main.js`·`preload.js`에 새 로그인 또는 새 저장 IPC를 추가하지 않는다. 기존 `api.load()`·`api.save()` 경로가 새 컬렉션도 함께 저장한다.

### 3.2 파일 책임

- `desktop-crm/src/sales-core.js`: 영업 단계·이벤트·추가서비스 상태, 레코드 생성·정규화·검증, 단계 계산과 KPI 집계 같은 순수 도메인 로직
- `desktop-crm/src/sales-standards.js`: 승인된 S1~S12 대본, CL01~CL08 체크리스트, 금지문구와 인계기준의 버전 있는 정적 자료
- `desktop-crm/src/sales.css`: 영업 KPI, 13단계 탐색, 건물 카드, 상세 패널과 표준자료 센터 전용 스타일
- `desktop-crm/src/core.js`: 공용 저장소의 여섯 영업 컬렉션을 빈 저장소와 정규화 결과에 보존
- `desktop-crm/src/remote.js`: 여섯 영업 컬렉션을 기존 공용 Firebase 직렬화·병합·차이 계산에 포함
- `desktop-crm/src/app.js`: 기존 `pipeline` 화면 렌더링, 모달·드로어 입력, 감사기록, 저장 예약과 사용자 상호작용 연결
- `desktop-crm/src/index.html`: 새 CSS와 UMD 모듈을 `app.js`보다 먼저 로드

### 3.3 로그인과 회사 저장소 재사용

데스크톱 CRM은 `remote.js`에서 기존 클라이언트 경로 `crmShared/data`를 회사 namespace와 결합해 실제 `crmCompany/data`에 저장한다. 영업 컬렉션도 이 객체의 자식으로 저장한다.

```text
crmCompany/data/
  customers/{id}
  buildings/{id}
  ...기존 공용 컬렉션
  salesProspects/{id}
  salesContacts/{id}
  salesUnits/{id}
  salesActivities/{id}
  salesEvents/{id}
  salesOpportunities/{id}
```

이 구조를 사용하면 현재 인증, `loadStore`·`saveStore`, 오프라인 pending 저장, 실시간 갱신과 Firebase 규칙의 경계를 그대로 활용할 수 있다. 별도 `salesCrm` 최상위 경로와 새 보안 규칙은 만들지 않는다.

## 4. 화면 구조

### 4.1 영업 대시보드

`영업 관리` 상단에는 같은 기준기간을 사용하는 KPI를 배치한다.

- 전체 활성 대상 건물
- 이번 주 신규 접촉 건물
- 응답 건물
- 유효관심 건물
- 미팅 확정 건물
- 현장진단 완료 건물
- 매물접수 호실
- 광고게시 호실
- 임대차계약 호실
- 유료관리 전환 건물
- 추가서비스 작업완료 건수
- 추가서비스 매출기록 금액
- 오늘 후속연락과 기한 초과 건물
- 담당자별 활성 건물 수

`전체 활성 대상 건물`과 후속연락은 대상 건물 상태에서 계산하고, 영업성과 KPI는 완료증거가 저장된 `salesEvents`에서 계산한다. 현재 단계 문자열만 바꾼 레코드는 성과로 집계하지 않는다.

### 4.2 13단계 건물 파이프라인

단계는 안정적인 코드와 한국어 표시명을 함께 사용한다.

| 순서 | 단계 코드 | 표시명 | 완료증거 이벤트 |
|---:|---|---|---|
| 1 | `candidate` | 건물후보 | `prospect_created` |
| 2 | `contact_ready` | 유효 연락처 확보 | `contact_verified` |
| 3 | `first_contact` | 최초접촉 | `contact_attempted` |
| 4 | `replied` | 응답 | `reply_received` |
| 5 | `qualified_interest` | 유효관심 | `interest_qualified` |
| 6 | `meeting_confirmed` | 미팅 확정 | `meeting_confirmed` |
| 7 | `diagnosis_done` | 현장진단 완료 | `diagnosis_completed` |
| 8 | `listing_received` | 매물접수 | `listing_received` |
| 9 | `ad_published` | 광고게시 | `ad_published` |
| 10 | `tenant_inquiry_visit` | 임차문의·방문 | `tenant_inquiry` 또는 `tenant_visit` |
| 11 | `lease_signed` | 임대차계약 | `lease_signed` |
| 12 | `paid_management` | 유료관리 전환 | `paid_management_started` |
| 13 | `paused_closed` | 보류·종료 | `prospect_paused` 또는 `prospect_closed` |

13개 열을 무조건 한 화면에 압축하지 않는다. 단계 탐색 막대와 선택 단계의 건물 카드 목록을 기본으로 하고, 전체 흐름을 볼 수 있는 가로 스크롤 보기를 제공한다. 건물 카드에는 건물명·주소, 공실·퇴실예정 호실 수, 담당자, 현재단계, 마지막 활동, 다음 행동과 기한을 표시한다.

### 4.3 대상 건물 상세

건물 카드를 열면 한 드로어 안에서 다음 내용을 확인·수정한다.

- 기본정보: 건물명·별칭, 주소, 지역, 건물유형, 수요거점, 발굴경로, 담당자, 우선순위
- 연결정보: 확인된 경우에만 기존 운영 건물 `crmBuildingId` 표시·변경
- 건물주·연락처: 이름, 역할, 전화번호, 출처, 확인일, 수신거부, 기존 고객 `crmCustomerId`
- 호실: 호실명, 공실·퇴실예정·임대중·확인필요 상태, 퇴실예정일, 보증금·월세·관리비, 사진·자료 증거
- 활동이력: 문자, 전화, 방문, 미팅, 내부메모, 결과, 응답 내용, 사용 대본 ID·버전, 다음 행동
- 성과이벤트: 이벤트 종류, 대상 호실, 발생시각, 증거 종류·링크·메모, 기록자
- 추가서비스: 청소, 입주청소, 퇴실청소, 장판·도배, 방수, 설비·수리, 사이니지, 기타
- 변경이력: 기존 `auditLogs`에 남긴 등록·수정·단계변경·보관·복원 기록

### 4.4 표준자료 센터

`영업 관리` 화면에서 표준자료 패널을 열어 다음 자료를 검색·확인한다.

- S1~S12 문자·전화·방문 대본: ID, 제목, 사용단계, 버전, 본문
- CL01~CL08 단계별 체크리스트: ID, 제목, 적용단계, 확인항목
- 금지문구와 안전한 대체표현
- 공인중개사·협력업체·기존 민원 케이스로 넘기는 기준
- BRING 영업 원칙과 지표 정의

활동에는 긴 자료 전문을 복사하지 않고 사용한 대본 ID·버전만 저장한다. 이벤트에는 적용 체크리스트 ID와 완료증거만 저장한다.

## 5. 데이터 모델

모든 영업 레코드는 문자열 `id`, ISO 시각, 생성·수정 사용자 이메일을 가진다. 영구삭제 대신 `archivedAt`·`archivedBy`로 보관하고 복원한다.

### 5.1 `salesProspects`

```js
{
  id, name, address, normalizedAddress, region, buildingType,
  demandAnchors: [], source, owner, priority,
  stage, vacancyCount, upcomingVacancyCount,
  lastActivityAt, nextAction, nextActionAt,
  crmBuildingId,
  archivedAt, archivedBy,
  createdAt, createdBy, updatedAt, updatedBy
}
```

- `name` 또는 `address` 중 하나는 필수다.
- `normalizedAddress`는 중복 경고용이며 ID로 사용하지 않는다.
- `stage`는 화면 표시 성능을 위한 현재값이다. 성과 판정과 KPI는 `salesEvents`를 기준으로 한다.
- `crmBuildingId`는 사용자가 확인한 기존 운영 건물만 연결한다. 연결하지 않은 영업후보가 `buildings`에 자동 생성되지 않는다.

### 5.2 `salesContacts`

```js
{
  id, prospectId, name, role, phone,
  source, sourceEvidence, verifiedAt,
  doNotContact, doNotContactAt, doNotContactReason,
  crmCustomerId,
  archivedAt, archivedBy,
  createdAt, createdBy, updatedAt, updatedBy
}
```

- `prospectId`와 전화번호가 필수다.
- 한 영업대상 건물에 여러 연락처를 둘 수 있다.
- `doNotContact`가 참인 연락처에는 문자·전화 활동을 새로 등록할 수 없다.
- 기존 고객과 확인 후 연결할 때만 `crmCustomerId`를 넣는다.

### 5.3 `salesUnits`

```js
{
  id, prospectId, label, status, moveOutAt,
  deposit, rent, maintenanceFee,
  photoUrl, evidenceUrl, note,
  archivedAt, archivedBy,
  createdAt, createdBy, updatedAt, updatedBy
}
```

- 상태는 `vacant`, `upcoming`, `occupied`, `unknown` 중 하나다.
- 매물접수·광고게시·계약 이벤트는 해당 `unitId`를 요구한다.
- 금액은 원 단위 숫자로 저장한다.

### 5.4 `salesActivities`

```js
{
  id, prospectId, contactId, unitId,
  type, occurredAt, result,
  summary, responseText,
  scriptId, scriptVersion,
  nextAction, nextActionAt, owner,
  createdAt, createdBy, updatedAt, updatedBy
}
```

- 활동 유형은 `sms`, `call`, `visit`, `meeting`, `memo`다.
- 문자·전화는 유효한 `contactId`가 필요하고 수신거부 연락처를 차단한다.
- `scriptId`가 있으면 현재 표준자료에 존재하는 ID와 버전을 함께 보존한다.
- 활동 저장 시 대상 건물의 `lastActivityAt`, `nextAction`, `nextActionAt` 캐시를 갱신한다.

### 5.5 `salesEvents`

```js
{
  id, prospectId, unitId, opportunityId,
  type, occurredAt,
  evidenceType, evidenceUrl, evidenceNote,
  checklistIds: [], owner,
  createdAt, createdBy
}
```

- 이벤트별 필수 증거를 도메인 검증에서 강제한다.
- `listing_received`, `ad_published`, `lease_signed`는 `unitId`가 필수다.
- `contact_verified`는 해당 건물의 보관되지 않은 유효 연락처가 필요하다.
- `prospect_paused`·`prospect_closed`는 사유가 `evidenceNote`에 필요하다.
- 이벤트 저장 후 단계 매핑으로 `salesProspects.stage`를 갱신한다.
- KPI는 기간 안의 이벤트를 건물 또는 호실 단위로 중복 제거해 집계한다.

### 5.6 `salesOpportunities`

```js
{
  id, prospectId, unitId,
  serviceType, stage, requirements,
  owner, dueAt,
  quoteAmount, revenueAmount,
  evidenceUrl, workflowCaseId,
  archivedAt, archivedBy,
  createdAt, createdBy, updatedAt, updatedBy
}
```

추가서비스 상태는 다음 다섯 단계다.

`discovered → quote_requested → quote_approved → work_completed → revenue_recorded`

- 서비스 유형은 `common_cleaning`, `move_in_cleaning`, `move_out_cleaning`, `flooring_wallpaper`, `waterproofing`, `repair`, `signage`, `other`다.
- `quote_requested`와 `quote_approved`는 영업 진행 건수에는 포함할 수 있지만 매출에는 포함하지 않는다.
- `work_completed`는 완료 증거가 필요하다.
- `revenue_recorded`는 1원 이상의 `revenueAmount`와 증거가 필요하다.
- 실제 민원·공사 실행이 시작되면 기존 케이스 ID를 `workflowCaseId`로 연결할 수 있다. 새 케이스 저장구조를 영업 컬렉션에 복제하지 않는다.

## 6. 단계와 증거 규칙

1. 대상 건물 생성 시 `prospect_created` 이벤트를 함께 만든다.
2. 사용자가 다음 단계 완료를 선택하면 해당 단계의 이벤트 입력 폼을 먼저 연다.
3. 필수 연락처·호실·증거가 없으면 이벤트와 단계 변경을 모두 저장하지 않는다.
4. 저장 성공 시 이벤트를 추가하고 대상 건물의 `stage`·`updatedAt`을 같은 로컬 저장 스냅샷에서 갱신한 뒤 기존 저장 예약을 호출한다.
5. 보류·종료 후 재개할 때는 이전 이벤트를 삭제하지 않고 재개 감사기록과 선택한 현재 단계를 남긴다.
6. 이벤트를 화면에서 영구삭제하지 않는다. 잘못 기록한 이벤트는 정정 이벤트 또는 감사기록이 있는 보관 방식으로 처리한다.
7. 매물접수와 광고게시 이벤트는 같은 호실에서 각각 기록할 수 있고 KPI도 각각 계산한다.

## 7. 기존 데이터와 PoC 연결

- 기존 `customers`, `buildings`, `activities`, `tasks`와 영업 컬렉션은 서로 독립적으로 보존한다.
- 기존 고객 중심 6단계 파이프라인을 새 영업대상으로 자동 변환하지 않는다.
- 대상 건물의 `crmBuildingId`와 연락처의 `crmCustomerId`는 사용자가 실제 동일 대상을 확인한 뒤 선택한다.
- 동일한 정규화 주소를 가진 활성 `salesProspects`가 있으면 생성 전에 경고하되, 주소가 같은 별동 등 정당한 사유가 있으면 사용자가 계속할 수 있다.
- 현재 알려진 5개 건물·7개 호실 PoC 숫자는 운영 레코드로 자동 입력하지 않는다. 실제 명칭·주소를 확인한 뒤 화면에서 등록하거나 연결한다.
- 테스트와 데모 데이터는 운영 Firebase에 자동 생성하지 않는다.

## 8. 접근, 감사와 보관

- 기존 CRM 로그인 게이트와 `canWriteCRM()` 판정을 그대로 사용한다.
- 영업 기능 전용 역할, 사용자 허용목록과 인증 IPC를 추가하지 않는다.
- 기존 쓰기 가능 사용자는 영업 레코드를 동일하게 생성·수정할 수 있고 조회 전용 사용자는 볼 수만 있다.
- 생성·수정·단계변경·운영건물 연결·보관·복원에는 기존 `auditLogs`를 사용해 사용자 이메일, 시각, 대상 ID와 행동을 남긴다.
- 대상 건물, 연락처, 호실과 추가서비스 기회는 일반 화면에서 영구삭제하지 않는다.
- 수신거부 설정과 해제도 감사기록을 남긴다.

## 9. 입력 검증과 실패 처리

- 대상 건물 이름과 주소가 모두 비어 있으면 저장하지 않는다.
- 유효 연락처 없이 `contact_verified` 이벤트를 만들지 않는다.
- 최초접촉에는 채널, 담당자, 시각과 결과가 필요하다.
- 수신거부 연락처에는 문자·전화 활동을 등록하지 않는다.
- 매물접수에는 호실, 발생시각과 중개 인계 증거가 필요하다.
- 광고게시에는 호실, 게시시각, 게시채널과 확인 증거가 필요하다.
- 임대차계약에는 해당 호실과 협력 공인중개사 완료확인 증거만 저장하며 계약서 작성 기능은 만들지 않는다.
- 유료관리 전환에는 시작일과 서비스 범위 증거가 필요하다.
- 다음 행동 기한이 지나면 카드와 KPI에 지연으로 표시한다.
- 기존 저장 호출이 실패하면 성공 메시지를 표시하지 않고 현재 CRM의 pending·재시도 흐름을 따른다.
- 실제 주민등록번호, 비밀번호와 출입코드는 기존 `Core.assertNoProhibitedSecrets` 검사를 그대로 통과해야 한다.

## 10. 테스트 전략

### 10.1 순수 도메인 테스트

- 여섯 영업 컬렉션이 `blankStore`·`sanitizeStore`에서 항상 배열로 보존된다.
- `toRemoteStore`·`mergeRemoteStore`·`diffRemoteStores`가 여섯 컬렉션을 `crmCompany/data` 공용 객체의 자식으로 왕복한다.
- 13단계와 이벤트 매핑이 안정적인 코드를 사용한다.
- 연락처·호실·활동·이벤트·추가서비스 검증이 필수값과 수신거부를 차단한다.
- 이벤트 기반 KPI가 매물접수와 광고게시를 분리하고 중복 이벤트를 건물·호실 단위로 중복 집계하지 않는다.
- 견적요청·견적승인은 매출에서 제외하고 `revenue_recorded`만 금액을 집계한다.
- 보관된 대상과 기회는 기본 활성 목록과 KPI에서 제외된다.

### 10.2 UI 계약 테스트

- 기존 사이드바에는 `영업 관리` 메뉴가 정확히 하나만 존재한다.
- `sales.css`, `sales-core.js`, `sales-standards.js`가 `app.js`보다 먼저 로드된다.
- 새 로그인 폼·인증 IPC·별도 영업 HTML이 추가되지 않는다.
- `renderPipeline()`이 `salesProspects`를 사용하고 13단계 탐색, KPI, 표준자료 진입점을 렌더링한다.
- 쓰기 동작은 기존 `canWriteCRM`, `logAudit`, `scheduleSave`를 거친다.
- 기존 `customers`, `buildings`, BRING FIELD, 케이스와 입금 화면의 진입점이 유지된다.

### 10.3 실행 검증

- `desktop-crm`에서 `npm.cmd test`
- `desktop-crm`에서 `npm.cmd run smoke`
- `desktop-crm`에서 `npm.cmd run build:win`
- Windows Electron 화면에서 1280×720과 1920×1080 기준 가독성 확인
- 로그인한 두 세션에서 대상 건물 추가·수정이 실시간 반영되는지 확인
- 오프라인 저장 후 재연결했을 때 영업 컬렉션이 기존 pending 흐름으로 동기화되는지 확인

## 11. 배포와 작업 안전

- 구현 기준 브랜치는 최신 데스크톱 릴리스 `crm-v1.6.3`을 포함한 `origin/codex/bring-field-platform`이다.
- 별도 worktree와 `codex/sales-crm-integration` 브랜치에서 작업한다.
- `wonju-map.html`은 수정·스테이징·커밋하지 않는다.
- 기존 회사 Firebase 데이터의 자동 마이그레이션과 익명 PoC 자동 시딩은 하지 않는다.
- 전체 자동테스트와 smoke가 통과한 뒤 데스크톱 버전을 올리고 Windows 설치파일을 만든다.
- GitHub Release에는 설치파일, blockmap과 `latest.yml`을 함께 올려 기존 자동업데이트가 새 버전을 인식하게 한다.
- 설치·재시작은 사용자 확인 후 진행하고, 기존 데이터가 유지되는지 실제 설치본에서 확인한다.

## 12. 제외 범위

- 새 로그인·회원관리·역할관리
- 영업 전용 Firebase 최상위 경로와 별도 규칙
- 공인중개 계약서 작성 또는 전자서명
- 문자 자동발송과 통신사 연동
- 협력업체 자동발주·자동정산
- 내부 원가·마진·중개수익 배분 회계
- 확인되지 않은 PoC 건물 자동 생성
- 기존 운영 건물·고객의 일괄 자동변환
- `wonju-map.html` 수정

## 13. 완료 기준

1. 현재 로그인 상태에서 기존 `영업 관리`를 열면 건물 중심 영업 작업공간이 표시된다.
2. 새 로그인이나 별도 영업 페이지 없이 현재 공용 저장·동기화가 작동한다.
3. 대상 건물 아래 여러 연락처·호실·활동·이벤트·추가서비스 기회를 관리한다.
4. 13단계 진행과 KPI가 완료증거 이벤트를 기준으로 계산된다.
5. 매물접수와 광고게시, 견적과 매출이 명확히 구분된다.
6. 수신거부, 필수증거, 중복주소, 보관·복원과 감사기록이 동작한다.
7. S1~S12와 CL01~CL08을 CRM 안에서 검색·열람하고 활동·이벤트에 사용 버전을 연결한다.
8. 확인된 영업대상만 기존 운영 건물·고객 ID에 수동 연결할 수 있다.
9. 현재 CRM 사용자는 기존 권한 범위 안에서 같은 영업 기능을 사용한다.
10. 기존 고객·건물·BRING FIELD·민원 케이스·입금 기능이 회귀 없이 동작한다.
11. 자동테스트, Electron smoke와 Windows 패키징이 통과한다.
12. 새 GitHub Release를 통해 현재 설치본의 자동업데이트 경로로 배포할 수 있다.

# Work Completion Operations Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업관리의 완료 작업을 운영 분석 기록과 중복 없이 자동 연결하고 실패 시 안전하게 재시도할 수 있게 한다.

**Architecture:** 순수 변환·병합 규칙은 새 `operations-work-sync.js` 모듈에 둔다. Electron main 프로세스가 작업 저장 성공 후 별도 단계로 운영 기록을 upsert하며, 작업 저장 성공과 분석 연동 실패를 분리한다. 렌더러는 서버가 반환한 연동 결과와 운영 분석 조회 결과를 이용해 상태와 재시도 동작만 표시한다.

**Tech Stack:** Electron, CommonJS JavaScript, Firebase Realtime Database REST/ETag, Node.js test runner

---

## 파일 구조

- Create: `desktop-crm/src/operations-work-sync.js` — 작업→운영 기록 변환, 시스템 필드 병합, 연동 상태 계산
- Create: `desktop-crm/test/operations-work-sync.test.js` — 순수 도메인 규칙 테스트
- Modify: `desktop-crm/src/operations-intelligence-core.js` — 원본 작업 참조 필드 정규화
- Modify: `desktop-crm/src/main.js` — 완료 후 upsert, 조회, 재시도 IPC
- Modify: `desktop-crm/src/preload.js` — 제한된 재시도 브리지
- Modify: `desktop-crm/src/work-management.js` — 연동 상태 배지와 재시도 버튼
- Modify: `desktop-crm/src/operations-intelligence-ui.js` — 원본 작업 출처 표시
- Modify: `desktop-crm/src/app.js` — 연동 결과 반영과 재시도 이벤트
- Modify: `desktop-crm/test/operations-intelligence.test.js` — 저장 경계와 출처 UI 계약
- Modify: `desktop-crm/test/work-management.test.js` — 상태 UI 계약

### Task 1: 작업-운영 변환 규칙

**Files:**
- Create: `desktop-crm/src/operations-work-sync.js`
- Create: `desktop-crm/test/operations-work-sync.test.js`
- Modify: `desktop-crm/src/operations-intelligence-core.js`

- [ ] **Step 1: 실패하는 변환 테스트 작성**

```js
test("completed service record maps to one completed operation source", () => {
  const result = Sync.operationSourceFromWork({
    id: "service_1", status: "completed", title: "예초", buildingId: "building_1",
    serviceType: "grounds_cutting", completedAt: "2026-08-15", owner: "김현진",
    vendorName: "사계절", amount: 150000, summary: "예초 완료",
  });
  assert.equal(result.sourceWorkRecordId, "service_1");
  assert.equal(result.status, "completed");
  assert.equal(result.category, "조경");
  assert.equal(result.subcategory, "예초 작업");
  assert.equal(result.sourceAmount, 150000);
});

test("non-completed service record has no operation source", () => {
  assert.equal(Sync.operationSourceFromWork({ id: "service_1", status: "planned" }), null);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test desktop-crm/test/operations-work-sync.test.js`

Expected: FAIL because `operations-work-sync.js` does not exist.

- [ ] **Step 3: 최소 변환 구현**

```js
function operationSourceFromWork(record) {
  if (!record || record.status !== "completed" || !record.id) return null;
  const types = {
    grounds_cutting: ["조경", "예초 작업"], stair_cleaning: ["청소", "계단 청소"],
    cleaning: ["청소", "일반 청소"], repair: ["시설", "수리"],
    inspection: ["시설", "점검"], meeting: ["운영", "방문·미팅"], other: ["기타", "기타 작업"],
  };
  const [category, subcategory] = types[record.serviceType] || types.other;
  return {
    sourceWorkRecordId: String(record.id), sourceVendorName: String(record.vendorName || ""),
    sourceAmount: Math.max(0, Math.round(Number(record.amount) || 0)), title: String(record.title || subcategory),
    description: String(record.summary || ""), outcome: String(record.summary || ""), buildingId: String(record.buildingId || ""),
    category, subcategory, trigger: "작업관리 완료", assigneeId: String(record.owner || ""), status: "completed",
    completedAt: String(record.completedAt || ""),
  };
}
```

- [ ] **Step 4: 사용자 분석 필드 보존 병합 테스트와 구현**

```js
test("sync updates source fields without overwriting analyst fields", () => {
  const merged = Sync.mergeWorkSource({ id:"op_1", sourceWorkRecordId:"service_1", directMinutes:80, reworkRequired:true, version:3 }, { title:"수정된 예초", sourceAmount:160000 });
  assert.equal(merged.title, "수정된 예초");
  assert.equal(merged.sourceAmount, 160000);
  assert.equal(merged.directMinutes, 80);
  assert.equal(merged.reworkRequired, true);
});
```

`mergeWorkSource`는 `sourceWorkRecordId`, `sourceVendorName`, `sourceAmount`, `title`, `description`, `outcome`, `buildingId`, `category`, `subcategory`, `trigger`, `assigneeId`, `completedAt`만 원본에서 갱신한다.

- [ ] **Step 5: 정규화 필드 추가 후 전체 도메인 테스트 확인**

Run: `node --test desktop-crm/test/operations-work-sync.test.js desktop-crm/test/operations-intelligence.test.js`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/src/operations-work-sync.js desktop-crm/src/operations-intelligence-core.js desktop-crm/test/operations-work-sync.test.js desktop-crm/test/operations-intelligence.test.js
git commit -m "feat(crm): map completed work to operations"
```

### Task 2: Main 프로세스 멱등 upsert와 실패 격리

**Files:**
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/test/operations-work-sync.test.js`

- [ ] **Step 1: upsert 계약 실패 테스트 작성**

```js
test("sync contract is idempotent by sourceWorkRecordId", () => {
  const found = Sync.findBySourceWorkRecordId([{ id:"op_1", sourceWorkRecordId:"service_1" }], "service_1");
  assert.equal(found.id, "op_1");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test desktop-crm/test/operations-work-sync.test.js`

Expected: FAIL because `findBySourceWorkRecordId` is missing.

- [ ] **Step 3: 조회 규칙 구현 후 main upsert 추가**

`syncCompletedWorkRecord(record, context)`는 다음 순서를 지킨다.

```js
const source = OperationsWorkSync.operationSourceFromWork(record);
if (!source) return { status: "not-required", sourceWorkRecordId: String(record.id || "") };
const map = localTestMode ? localIntelligenceOperations : await remoteClient.dbRequest("operationsIntelligence/operations", { method:"GET" }) || {};
const existing = OperationsWorkSync.findBySourceWorkRecordId(Object.values(map), source.sourceWorkRecordId);
```

기존 기록이 없으면 `OperationsIntelligence.createOperation` 후 `complete`를 사용하고, 있으면 ETag로 다시 읽은 최신 기록에 `mergeWorkSource`를 적용해 조건부 PUT 한다. 성공 응답은 `{ status:"synced", operationId, sourceWorkRecordId }`, 실패 응답은 예외를 외부로 전파하지 않고 `{ status:"required", sourceWorkRecordId, error }`로 정규화한다.

- [ ] **Step 4: 작업 저장 성공 뒤 연동 호출**

`crm:building-schedule-commit` 핸들러에서 기존 commit 결과를 먼저 확정한 뒤 아래 결과를 추가한다.

```js
const operationsSync = result.record.status === "completed"
  ? await trySyncCompletedWorkRecord(result.record)
  : { status:"not-required", sourceWorkRecordId:result.record.id };
return { ok:true, record:result.record, repeated:result.repeated === true, operationsSync };
```

- [ ] **Step 5: 저장 실패 격리와 중복 방지 테스트 실행**

Run: `node --test desktop-crm/test/building-schedule-commit.test.js desktop-crm/test/operations-work-sync.test.js`

Expected: 작업 commit 성공은 유지되고 연동 결과만 `required`; 동일 작업 반복 저장 시 운영 기록 수는 1건. 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/src/main.js desktop-crm/test/operations-work-sync.test.js
git commit -m "feat(crm): sync completed work after commit"
```

### Task 3: 연동 상태와 재시도 UI

**Files:**
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/work-management.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/test/work-management.test.js`
- Modify: `desktop-crm/test/operations-intelligence.test.js`

- [ ] **Step 1: 상태 배지 실패 테스트 작성**

```js
test("completed work renders operations sync state and retry only when required", () => {
  const required = Work.renderDashboard(Work.buildModel({ buildings:store.buildings, serviceRecords:[{ ...store.serviceRecords[0], operationsSyncStatus:"required" }], serviceContracts:[] }));
  assert.match(required, /운영 분석 연동 필요/);
  assert.match(required, /data-work-sync-retry="mow"/);
  const synced = Work.renderDashboard(Work.buildModel({ buildings:store.buildings, serviceRecords:[{ ...store.serviceRecords[0], operationsSyncStatus:"synced" }], serviceContracts:[] }));
  assert.match(synced, /운영 분석 연동 완료/);
  assert.doesNotMatch(synced, /data-work-sync-retry/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test desktop-crm/test/work-management.test.js`

Expected: FAIL because sync status markup is absent.

- [ ] **Step 3: 재시도 IPC와 렌더러 상태 구현**

`preload.js`에 아래 제한된 브리지를 추가한다.

```js
retryWorkOperationsSync: recordId => ipcRenderer.invoke("crm:work-operations-sync-retry", { recordId })
```

main 핸들러는 현재 서버의 작업을 ID로 다시 읽고 완료 상태인지 검증한 뒤 `trySyncCompletedWorkRecord`만 호출한다. 렌더러는 commit 응답의 `operationsSync`를 해당 작업의 화면 전용 상태에 반영하고, 실패 시 경고 토스트와 재시도 버튼을 표시한다.

작업관리 화면을 열 때 기존 `loadOperationsIntelligence()`를 재사용해 운영 기록을 함께 조회한다. 완료 작업의 ID가 운영 기록의 `sourceWorkRecordId`에 있으면 `synced`, 없으면 `required`로 계산하므로 앱을 다시 실행한 뒤에도 상태가 복원된다. 조회 중에는 상태를 단정하지 않고 `확인 중`으로 표시하며, 조회 실패는 빈 데이터가 아니라 `연동 상태 확인 실패`로 표시한다.

- [ ] **Step 4: 운영 분석 출처 표시**

운영 상세 폼에서 `sourceWorkRecordId`가 있으면 다음 읽기 전용 안내를 표시한다.

```html
<div class="info-box">작업관리에서 자동 생성됨 · 원본 작업 ID: …</div>
```

- [ ] **Step 5: UI와 IPC 계약 테스트 실행**

Run: `node --test desktop-crm/test/work-management.test.js desktop-crm/test/operations-intelligence.test.js`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add desktop-crm/src/preload.js desktop-crm/src/work-management.js desktop-crm/src/app.js desktop-crm/src/operations-intelligence-ui.js desktop-crm/test/work-management.test.js desktop-crm/test/operations-intelligence.test.js
git commit -m "feat(crm): show and retry operations sync"
```

### Task 4: 통합 검증과 릴리스 준비

**Files:**
- Modify only if a failing regression requires a scoped fix.

- [ ] **Step 1: CRM 전체 테스트**

Run: `npm test`

Workdir: `desktop-crm`

Expected: all tests PASS with no unhandled rejection.

- [ ] **Step 2: 패키지 빌드**

Run: `npm run dist`

Workdir: `desktop-crm`

Expected: installer, blockmap, and `latest.yml` are generated successfully.

- [ ] **Step 3: 변경 범위 확인**

Run: `git diff --check HEAD~3..HEAD && git status --short`

Expected: no whitespace errors and no unrelated files.

- [ ] **Step 4: 최종 통합 커밋이 필요할 때만 생성**

```bash
git add desktop-crm
git commit -m "test(crm): verify work operations sync"
```

- [ ] **Step 5: 운영 브랜치 최신 상태와 fast-forward 가능 여부 확인**

Run: `git fetch origin --prune && git merge-base --is-ancestor origin/codex/bring-field-platform HEAD`

Expected: exit code 0 before force 없는 fast-forward push. 실패하면 최신 운영 브랜치에서 새 작업 트리를 만들고 기능 커밋만 순서대로 적용해 재검증한다.

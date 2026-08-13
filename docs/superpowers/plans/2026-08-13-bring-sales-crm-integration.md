# BRING Building Sales CRM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 BRING CRM Desktop의 로그인·공용 저장·`영업 관리` 화면을 재사용해 건물 중심 13단계 영업, 증거 기반 KPI, 추가서비스 기회와 영업 표준자료를 실제로 기록·공유하게 만든다.

**Architecture:** 운영 `buildings`·`customers`와 분리된 여섯 영업 컬렉션을 기존 `crmCompany/data` 공유 store 안에 추가하고, `sales-core.js`가 순수 도메인 규칙을 담당한다. `app.js`는 기존 `pipeline` 화면과 모달·드로어를 연결하며, 현재 `api.load()`·`api.save()`·Google 로그인·실시간 동기화·감사로그를 그대로 사용한다. 새 HTML, 새 로그인, 새 IPC, 새 Firebase 최상위 경로는 만들지 않는다.

**Tech Stack:** Electron 39, CommonJS/브라우저 UMD JavaScript, HTML/CSS, Node.js built-in test runner, electron-builder, Firebase Realtime Database REST client

---

## 작업 전제와 파일 지도

작업 위치는 `FM/.worktrees/sales-crm-integration`이고 기준 커밋은 `crm-v1.6.2`를 포함한 `cc67b18`이다. 모든 명령은 저장소 루트 또는 명시된 `desktop-crm` 경로에서 실행한다. `wonju-map.html`은 어떤 단계에서도 수정하거나 스테이징하지 않는다.

| 파일 | 책임 |
|---|---|
| `desktop-crm/src/sales-core.js` | 단계·이벤트·엔터티 생성/검증·단계 계산·KPI·중복주소 같은 순수 영업 규칙 |
| `desktop-crm/src/sales-standards.js` | S1~S12, CL01~CL08, 금지문구, 인계기준의 버전 있는 정적 자료 |
| `desktop-crm/src/sales.css` | 영업 대시보드, 13단계, 건물 카드, 상세, 표준자료 전용 스타일 |
| `desktop-crm/src/core.js` | 여섯 영업 배열을 공용 store 기본값과 sanitize 결과에 보존 |
| `desktop-crm/src/remote.js` | 여섯 영업 컬렉션의 원격 map 직렬화·병합·diff |
| `desktop-crm/src/index.html` | 새 CSS와 UMD 스크립트를 `app.js`보다 먼저 로드 |
| `desktop-crm/src/app.js` | 기존 `pipeline` 렌더링, 입력 폼, 이벤트 처리, 감사기록과 저장 연결 |
| `desktop-crm/test/sales-store.test.js` | 공용 store 및 원격 round-trip 계약 |
| `desktop-crm/test/sales-core.test.js` | 도메인 생성·검증·단계·KPI·추가기회 계약 |
| `desktop-crm/test/sales-standards.test.js` | 대본·체크리스트 완전성과 버전 계약 |
| `desktop-crm/test/sales-ui-entry.test.js` | 기존 화면·로그인 재사용과 정적 UI 배선 회귀 계약 |
| `desktop-crm/test/company-release.test.js` | 최종 데스크톱 버전과 설치파일 이름 계약 |

## 공통 도메인 계약

다음 공개 API 이름을 모든 작업에서 동일하게 사용한다.

```js
// window.BringSalesCore / require("../src/sales-core")
{
  SALES_STAGES, SALES_EVENT_TYPES, OPPORTUNITY_STAGES, SERVICE_TYPES,
  normalizeAddress,
  createProspect, createContact, createUnit, createActivity, createEvent, createOpportunity,
  assertProspect, assertContact, assertUnit, assertActivity, assertEvent, assertOpportunity,
  duplicateProspects, nextStageFromEvents, computeSalesKpis,
  archiveRecord, restoreRecord
}

// window.BringSalesStandards / require("../src/sales-standards")
{
  VERSION, SCRIPTS, CHECKLISTS, PROHIBITED_PHRASES, HANDOFF_RULES,
  findStandard
}
```

오류는 `Error`에 안정적인 `code`를 붙인다. UI는 `error.message`를 토스트로 보여준다.

---

### Task 1: 공용 store에 영업 컬렉션 보존

**Files:**
- Create: `desktop-crm/test/sales-store.test.js`
- Modify: `desktop-crm/src/core.js:164-215`
- Modify: `desktop-crm/src/remote.js:29-37`

- [ ] **Step 1: 영업 컬렉션 round-trip 실패 테스트 작성**

`desktop-crm/test/sales-store.test.js`를 다음 계약으로 만든다.

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../src/core");
const { SHARED_COLLECTIONS, toRemoteStore, mergeRemoteStore } = require("../src/remote");

const SALES_KEYS = [
  "salesProspects", "salesContacts", "salesUnits",
  "salesActivities", "salesEvents", "salesOpportunities",
];

test("blank and sanitized stores preserve every isolated sales collection", () => {
  const blank = Core.blankStore();
  SALES_KEYS.forEach((key) => assert.deepEqual(blank[key], []));
  const sanitized = Core.sanitizeStore(Object.fromEntries(
    SALES_KEYS.map((key) => [key, [{ id: `${key}-1`, value: key }]]),
  ));
  SALES_KEYS.forEach((key) => assert.equal(sanitized[key][0].id, `${key}-1`));
});

test("remote serialization round-trips sales records under the shared store", () => {
  SALES_KEYS.forEach((key) => assert.ok(SHARED_COLLECTIONS.includes(key)));
  const local = Core.blankStore();
  SALES_KEYS.forEach((key) => { local[key] = [{ id: `${key}-1`, value: key }]; });
  const remote = toRemoteStore(local, "staff@bring.test");
  SALES_KEYS.forEach((key) => assert.equal(remote[key][`${key}-1`].value, key));
  const merged = mergeRemoteStore(Core, remote, Core.blankStore(), { email: "staff@bring.test" });
  SALES_KEYS.forEach((key) => assert.equal(merged[key][0].id, `${key}-1`));
});
```

- [ ] **Step 2: 테스트가 빠진 컬렉션 때문에 실패하는지 확인**

Run:

```powershell
node --test desktop-crm/test/sales-store.test.js
```

Expected: `blank.salesProspects`가 `undefined`이거나 `SHARED_COLLECTIONS`에 키가 없어 FAIL.

- [ ] **Step 3: 기존 store와 원격 공유 목록에 여섯 배열 추가**

`blankStore()`의 공용 배열 줄에 다음 키를 추가하고, `sanitizeStore()` 반환 객체에는 입력이 배열일 때만 보존한다.

```js
salesProspects: [], salesContacts: [], salesUnits: [],
salesActivities: [], salesEvents: [], salesOpportunities: [],
```

```js
salesProspects: Array.isArray(src.salesProspects) ? src.salesProspects.filter(Boolean) : [],
salesContacts: Array.isArray(src.salesContacts) ? src.salesContacts.filter(Boolean) : [],
salesUnits: Array.isArray(src.salesUnits) ? src.salesUnits.filter(Boolean) : [],
salesActivities: Array.isArray(src.salesActivities) ? src.salesActivities.filter(Boolean) : [],
salesEvents: Array.isArray(src.salesEvents) ? src.salesEvents.filter(Boolean) : [],
salesOpportunities: Array.isArray(src.salesOpportunities) ? src.salesOpportunities.filter(Boolean) : [],
```

`remote.js`의 `SHARED_COLLECTIONS` 끝에 같은 여섯 키를 넣는다. 별도 경로나 IPC는 추가하지 않는다.

- [ ] **Step 4: 새 테스트와 전체 회귀 테스트 확인**

Run:

```powershell
node --test desktop-crm/test/sales-store.test.js
npm.cmd --prefix desktop-crm test
```

Expected: 새 2개 테스트와 기존 22개 테스트가 모두 PASS.

- [ ] **Step 5: store 변경만 커밋**

```powershell
git add -- desktop-crm/src/core.js desktop-crm/src/remote.js desktop-crm/test/sales-store.test.js
git commit -m "feat: persist isolated sales CRM collections"
```

---

### Task 2: 13단계 영업 도메인과 입력 검증

**Files:**
- Create: `desktop-crm/src/sales-core.js`
- Create: `desktop-crm/test/sales-core.test.js`

- [ ] **Step 1: 단계·생성·수신거부·중복주소 실패 테스트 작성**

`desktop-crm/test/sales-core.test.js`의 첫 묶음을 다음과 같이 만든다.

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const Sales = require("../src/sales-core");

const NOW = "2026-08-13T09:00:00.000Z";
const actor = { email: "owner@bring.test" };

test("defines the approved building-centered 13 stages in order", () => {
  assert.deepEqual(Sales.SALES_STAGES.map((item) => item.code), [
    "candidate", "contact_ready", "first_contact", "replied", "qualified_interest",
    "meeting_confirmed", "diagnosis_done", "listing_received", "ad_published",
    "tenant_inquiry_visit", "lease_signed", "paid_management", "paused_closed",
  ]);
});

test("creates a prospect without creating an operational building", () => {
  const item = Sales.createProspect({ name: "대학로 원룸", address: "강원 원주시 대학로 1" }, actor, NOW);
  assert.equal(item.stage, "candidate");
  assert.equal(item.crmBuildingId, "");
  assert.equal(item.createdBy, actor.email);
  assert.doesNotThrow(() => Sales.assertProspect(item));
});

test("warns about an active normalized-address duplicate but ignores archived records", () => {
  const active = Sales.createProspect({ address: "강원도 원주시 대학로 1" }, actor, NOW);
  const archived = { ...active, id: "archived", archivedAt: NOW };
  const candidate = Sales.createProspect({ address: "강원 원주시 대학로 1" }, actor, NOW);
  assert.deepEqual(Sales.duplicateProspects([active, archived], candidate).map((item) => item.id), [active.id]);
});

test("blocks call and SMS activity for a do-not-contact contact", () => {
  const contact = Sales.createContact({ prospectId: "prospect-1", phone: "010-1111-2222", doNotContact: true }, actor, NOW);
  const activity = Sales.createActivity({ prospectId: "prospect-1", contactId: contact.id, type: "sms", summary: "공실 확인" }, actor, NOW);
  assert.throws(
    () => Sales.assertActivity(activity, { contacts: [contact], scripts: [] }),
    (error) => error.code === "SALES_CONTACT_OPTED_OUT",
  );
});
```

- [ ] **Step 2: 모듈 부재로 RED 확인**

Run:

```powershell
node --test desktop-crm/test/sales-core.test.js
```

Expected: `Cannot find module '../src/sales-core'`로 FAIL.

- [ ] **Step 3: UMD 도메인 모듈과 안정적인 레코드 기본값 구현**

`sales-core.js`는 `core.js`와 같은 UMD 형태를 사용하고 다음 상수·검증 계약을 구현한다.

```js
(function attachBringSalesCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringSalesCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringSalesCore() {
  const SALES_STAGES = Object.freeze([
    ["candidate", "건물후보"], ["contact_ready", "유효 연락처 확보"],
    ["first_contact", "최초접촉"], ["replied", "응답"],
    ["qualified_interest", "유효관심"], ["meeting_confirmed", "미팅 확정"],
    ["diagnosis_done", "현장진단 완료"], ["listing_received", "매물접수"],
    ["ad_published", "광고게시"], ["tenant_inquiry_visit", "임차문의·방문"],
    ["lease_signed", "임대차계약"], ["paid_management", "유료관리 전환"],
    ["paused_closed", "보류·종료"],
  ].map(([code, label], index) => Object.freeze({ code, label, index })));
  const SALES_EVENT_TYPES = Object.freeze([
    "prospect_created", "contact_verified", "contact_attempted", "reply_received",
    "interest_qualified", "meeting_confirmed", "diagnosis_completed", "listing_received",
    "ad_published", "tenant_inquiry", "tenant_visit", "lease_signed",
    "paid_management_started", "prospect_paused", "prospect_closed",
  ]);
  const OPPORTUNITY_STAGES = Object.freeze([
    "discovered", "quote_requested", "quote_approved", "work_completed", "revenue_recorded",
  ]);
  const SERVICE_TYPES = Object.freeze([
    "common_cleaning", "move_in_cleaning", "move_out_cleaning", "flooring_wallpaper",
    "waterproofing", "repair", "signage", "other",
  ]);
  // 구현 함수는 아래 공개 API 이름을 정확히 export한다.
  return {
    SALES_STAGES, SALES_EVENT_TYPES, OPPORTUNITY_STAGES, SERVICE_TYPES,
    normalizeAddress, createProspect, createContact, createUnit, createActivity,
    createEvent, createOpportunity, assertProspect, assertContact, assertUnit,
    assertActivity, assertEvent, assertOpportunity, duplicateProspects,
    nextStageFromEvents, computeSalesKpis, archiveRecord, restoreRecord,
  };
});
```

공통 생성 시각은 세 번째 인수로 받은 ISO 문자열을 사용하고 없으면 현재시각을 만든다. ID 접두사는 각각 `spr`, `sct`, `sun`, `sac`, `sev`, `sop`를 사용한다. `normalizeAddress()`는 Unicode NFKC, 소문자화, `강원도`→`강원`, 모든 공백·구두점 제거를 적용한다. 생성자는 설계서 5장의 모든 필드를 명시적인 기본값으로 채우며 `createdBy`·`updatedBy`에는 `actor.email || ""`를 넣는다. `values.id`, `values.createdAt`, `values.createdBy`가 있으면 이를 보존하고 `updatedAt`·`updatedBy`만 새 메타데이터로 바꿔 편집 시 ID와 생성이력이 유지되게 한다.

검증 오류는 다음 코드와 한국어 메시지를 사용한다.

| 함수 | 조건 | 코드 | 메시지 |
|---|---|---|---|
| `assertProspect` | 이름·주소 모두 없음 | `SALES_PROSPECT_IDENTITY_REQUIRED` | `건물명 또는 주소를 입력해 주세요.` |
| `assertContact` | 건물 ID 또는 전화번호 없음 | `SALES_CONTACT_REQUIRED` | `대상 건물과 연락처를 확인해 주세요.` |
| `assertUnit` | 건물 ID 또는 호실명 없음 | `SALES_UNIT_REQUIRED` | `대상 건물과 호실명을 입력해 주세요.` |
| `assertActivity` | 문자·전화 대상이 수신거부 | `SALES_CONTACT_OPTED_OUT` | `수신거부 연락처에는 문자·전화를 기록할 수 없습니다.` |
| `assertActivity` | 문자·전화인데 연락처 없음 | `SALES_ACTIVITY_CONTACT_REQUIRED` | `문자·전화 대상 연락처를 선택해 주세요.` |
| `assertActivity` | 요약 없음 | `SALES_ACTIVITY_SUMMARY_REQUIRED` | `영업활동 내용을 입력해 주세요.` |

`duplicateProspects()`는 자기 ID와 보관 레코드를 제외하고 `normalizedAddress`가 같은 항목만 반환한다. `archiveRecord(record, actor, at)`와 `restoreRecord(record, actor, at)`는 원본을 변경하지 않고 새 객체를 반환한다.

- [ ] **Step 4: 순수 도메인 테스트 GREEN 확인**

Run:

```powershell
node --test desktop-crm/test/sales-core.test.js
```

Expected: 4개 테스트 PASS.

- [ ] **Step 5: 도메인 기본 계약 커밋**

```powershell
git add -- desktop-crm/src/sales-core.js desktop-crm/test/sales-core.test.js
git commit -m "feat: define building sales CRM domain"
```

---

### Task 3: 증거 이벤트, 단계 계산과 KPI·추가서비스 규칙

**Files:**
- Modify: `desktop-crm/test/sales-core.test.js`
- Modify: `desktop-crm/src/sales-core.js`

- [ ] **Step 1: 증거·단계·KPI·매출 실패 테스트 추가**

같은 테스트 파일에 다음 계약을 추가한다.

```js
test("requires a unit and evidence for listing, advertising, and lease events", () => {
  const event = Sales.createEvent({ prospectId: "p1", type: "ad_published" }, actor, NOW);
  assert.throws(() => Sales.assertEvent(event, { contacts: [], units: [], opportunities: [] }),
    (error) => error.code === "SALES_EVENT_UNIT_REQUIRED");
  const unit = Sales.createUnit({ id: "u1", prospectId: "p1", label: "201호" }, actor, NOW);
  assert.throws(() => Sales.assertEvent({ ...event, unitId: unit.id }, { contacts: [], units: [unit], opportunities: [] }),
    (error) => error.code === "SALES_EVENT_EVIDENCE_REQUIRED");
});

test("derives the stage from the most recent mapped event, including pause", () => {
  const events = [
    Sales.createEvent({ prospectId: "p1", type: "contact_attempted", evidenceNote: "문자 발송" }, actor, "2026-08-13T09:00:00.000Z"),
    Sales.createEvent({ prospectId: "p1", type: "listing_received", unitId: "u1", evidenceNote: "중개 인계" }, actor, "2026-08-13T10:00:00.000Z"),
  ];
  assert.equal(Sales.nextStageFromEvents("p1", events), "listing_received");
  events.push(Sales.createEvent({ prospectId: "p1", type: "prospect_paused", evidenceNote: "겨울 재연락" }, actor, "2026-08-13T11:00:00.000Z"));
  assert.equal(Sales.nextStageFromEvents("p1", events), "paused_closed");
});

test("counts evidenced unit outcomes separately and de-duplicates retries", () => {
  const event = (id, type, unitId) => ({ id, prospectId: "p1", unitId, type, occurredAt: NOW, evidenceNote: "확인" });
  const kpis = Sales.computeSalesKpis({
    salesProspects: [{ id: "p1", owner: "김현진", nextActionAt: "2026-08-12", archivedAt: "" }],
    salesEvents: [event("e1", "listing_received", "u1"), event("e2", "listing_received", "u1"), event("e3", "ad_published", "u1")],
    salesOpportunities: [],
  }, { from: "2026-08-11T00:00:00.000Z", to: "2026-08-14T00:00:00.000Z", now: NOW });
  assert.equal(kpis.listingReceivedUnits, 1);
  assert.equal(kpis.adPublishedUnits, 1);
  assert.equal(kpis.overdueFollowups, 1);
});

test("counts revenue only at revenue_recorded", () => {
  const base = { prospectId: "p1", serviceType: "waterproofing", evidenceUrl: "https://evidence.test/1" };
  const kpis = Sales.computeSalesKpis({
    salesProspects: [{ id: "p1", archivedAt: "" }], salesEvents: [],
    salesOpportunities: [
      Sales.createOpportunity({ ...base, stage: "quote_approved", revenueAmount: 500000 }, actor, NOW),
      Sales.createOpportunity({ ...base, id: "revenue", stage: "revenue_recorded", revenueAmount: 300000 }, actor, NOW),
    ],
  }, { from: "2026-08-13T00:00:00.000Z", to: "2026-08-14T00:00:00.000Z", now: NOW });
  assert.equal(kpis.revenueAmount, 300000);
});
```

- [ ] **Step 2: 새 검증이 아직 구현되지 않아 RED인지 확인**

Run:

```powershell
node --test desktop-crm/test/sales-core.test.js
```

Expected: `assertEvent`, 단계 계산 또는 KPI 기대값에서 FAIL.

- [ ] **Step 3: 이벤트 요구사항과 집계 규칙 구현**

이벤트→단계 매핑을 다음처럼 고정한다. `tenant_inquiry`와 `tenant_visit`는 모두 `tenant_inquiry_visit`로 간다.

```js
const EVENT_STAGE = Object.freeze({
  prospect_created: "candidate", contact_verified: "contact_ready",
  contact_attempted: "first_contact", reply_received: "replied",
  interest_qualified: "qualified_interest", meeting_confirmed: "meeting_confirmed",
  diagnosis_completed: "diagnosis_done", listing_received: "listing_received",
  ad_published: "ad_published", tenant_inquiry: "tenant_inquiry_visit",
  tenant_visit: "tenant_inquiry_visit", lease_signed: "lease_signed",
  paid_management_started: "paid_management", prospect_paused: "paused_closed",
  prospect_closed: "paused_closed",
});
```

`assertEvent()`는 건물 ID·허용 이벤트·발생시각을 공통 확인한 뒤 다음을 강제한다.

- `contact_verified`: 같은 `prospectId`의 보관되지 않은 연락처 존재
- `listing_received`, `ad_published`, `lease_signed`: 같은 건물의 보관되지 않은 `unitId`
- `contact_attempted`, `reply_received`, `interest_qualified`, `meeting_confirmed`, `diagnosis_completed`, `listing_received`, `ad_published`, `lease_signed`, `paid_management_started`, `prospect_paused`, `prospect_closed`: `evidenceUrl` 또는 `evidenceNote`
- `prospect_paused`, `prospect_closed`: 공백이 아닌 `evidenceNote`

오류 코드는 `SALES_EVENT_UNIT_REQUIRED`, `SALES_EVENT_CONTACT_REQUIRED`, `SALES_EVENT_EVIDENCE_REQUIRED`, `SALES_EVENT_REASON_REQUIRED`를 사용한다.

`computeSalesKpis(store, range)`는 보관되지 않고 `stage !== "paused_closed"`인 활성 건물, 보관되지 않은 기회와 `[from, to)` 기간만 사용한다. 건물 이벤트는 `type + prospectId`, 호실 이벤트는 `type + prospectId + unitId`로 중복 제거한다. 반환 키는 다음으로 고정한다.

```js
{
  activeProspects, firstContacts, repliedProspects, qualifiedProspects,
  meetingsConfirmed, diagnosesCompleted, listingReceivedUnits,
  adPublishedUnits, leasesSignedUnits, paidManagementProspects,
  opportunityWorkCompleted, revenueAmount, todayFollowups,
  overdueFollowups, activeByOwner
}
```

`assertOpportunity()`는 허용 서비스·상태를 확인하고 `work_completed`에는 증거, `revenue_recorded`에는 증거와 1원 이상의 `revenueAmount`를 요구한다. 오류 코드는 `SALES_OPPORTUNITY_EVIDENCE_REQUIRED`, `SALES_OPPORTUNITY_REVENUE_REQUIRED`를 사용한다.

- [ ] **Step 4: 도메인 전체 테스트 실행**

Run:

```powershell
node --test desktop-crm/test/sales-core.test.js
npm.cmd --prefix desktop-crm test
```

Expected: 영업 도메인 8개 테스트와 전체 회귀 테스트 PASS.

- [ ] **Step 5: 증거·KPI 규칙 커밋**

```powershell
git add -- desktop-crm/src/sales-core.js desktop-crm/test/sales-core.test.js
git commit -m "feat: enforce evidence-based sales outcomes"
```

---

### Task 4: S1~S12·CL01~CL08 표준자료 모듈

**Files:**
- Create: `desktop-crm/src/sales-standards.js`
- Create: `desktop-crm/test/sales-standards.test.js`

- [ ] **Step 1: 자료 개수·ID·검색 실패 테스트 작성**

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const Standards = require("../src/sales-standards");

test("ships one versioned set of twelve scripts and eight checklists", () => {
  assert.equal(Standards.VERSION, "2026.08.13-v1");
  assert.deepEqual(Standards.SCRIPTS.map((item) => item.id), Array.from({ length: 12 }, (_, index) => `S${index + 1}`));
  assert.deepEqual(Standards.CHECKLISTS.map((item) => item.id), Array.from({ length: 8 }, (_, index) => `CL${String(index + 1).padStart(2, "0")}`));
  [...Standards.SCRIPTS, ...Standards.CHECKLISTS].forEach((item) => {
    assert.ok(item.title);
    assert.ok(item.stageCodes.length);
    assert.ok(item.body || item.items.length);
  });
});

test("finds standards by id, title, stage, and body text", () => {
  assert.equal(Standards.findStandard("S1")[0].id, "S1");
  assert.ok(Standards.findStandard("공실").some((item) => item.id === "S1"));
  assert.ok(Standards.findStandard("waterproofing").some((item) => item.id === "S12"));
});
```

- [ ] **Step 2: 모듈 부재로 RED 확인**

Run:

```powershell
node --test desktop-crm/test/sales-standards.test.js
```

Expected: 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: 버전 있는 표준자료를 UMD 모듈로 작성**

S1 본문은 사용자가 승인한 다음 문구를 그대로 넣는다.

```text
안녕하세요. 이지부동산중개법인(주)입니다.
원주 지역 원룸·다가구 임대차 중개를 진행하고 있습니다.
혹시 현재 공실이나 퇴실 예정인 호실이 있으실까요?
건물주분께는 별도의 중개보수를 받지 않으며, 임차인 측 중개보수만 법정 기준에 따라 진행하고 있습니다.
편하게 공실 여부만 답변 주시면 감사하겠습니다. 감사합니다.
```

S2~S12에는 다음 원문과 단계·검색태그를 넣는다. 대괄호는 입력 변수가 아니라 사용자가 발송 전에 바꾸는 안내표시이므로 그대로 보존한다.

| ID | 제목·단계 | 본문 |
|---|---|---|
| S2 | 최초문자 무응답 후속 · `first_contact` | `안녕하세요. 며칠 전 원룸·다가구 공실 여부를 여쭤본 이지부동산중개법인(주)입니다. 현재 공실이나 퇴실 예정 호실이 있으시면 “있음”이라고만 답해 주셔도 확인 후 안내드리겠습니다. 해당 사항이 없으시면 “없음”, 더 이상 안내를 원치 않으시면 “수신거부”라고 회신해 주세요. 감사합니다.` |
| S3 | 공실 응답 감사 · `replied` | `답변 감사합니다. 정확한 매물 안내를 위해 건물 주소, 공실 또는 퇴실 예정 호실, 입주 가능일, 보증금·월세·관리비를 알려주실 수 있을까요? 통화가 편하신 시간도 함께 남겨주시면 그 시간에 연락드리겠습니다.` |
| S4 | 매물접수 안내 · `qualified_interest` | `공실 접수에 필요한 내용은 주소, 호실, 입주 가능일, 보증금·월세·관리비, 옵션, 내부 사진입니다. 확인된 내용은 이지부동산중개법인(주) 담당자에게 인계해 매물접수 절차를 진행하며, 광고는 건물주 확인 후 게시하겠습니다.` |
| S5 | 촬영 일정 확인 · `meeting_confirmed` | `[날짜] [시간]에 [건물/호실]의 공실 상태와 광고용 사진을 확인하겠습니다. 촬영 범위와 게시 가능 여부를 현장에서 다시 확인하겠습니다. 출입에 필요한 정보는 CRM 문자에 남기지 않고 방문 직전에 안전한 방법으로 확인하겠습니다. 일정 변경이 필요하시면 회신 부탁드립니다.` |
| S6 | 광고게시 완료 · `ad_published` | `[호실] 매물 광고를 [채널]에 [게시일] 게시했습니다. 보증금·월세·관리비·입주 가능일은 전달받은 조건으로 반영했습니다. 수정할 내용이 있으면 회신해 주세요. 임차 문의와 방문 요청은 확인되는 대로 정리해 알려드리겠습니다.` |
| S7 | 임차문의 보고 · `tenant_inquiry_visit` | `[기간] 동안 [호실]에 임차 문의 [건수]건이 있었습니다. 주요 질문은 [질문 요약]이며 방문 희망은 [일정]입니다. [건물주 확인사항]을 확인해 주시면 문의자에게 정확히 안내하겠습니다.` |
| S8 | 방문 일정 확인 · `tenant_inquiry_visit` | `[날짜] [시간]에 [호실] 방문이 예정되어 있습니다. 현장 연락 담당은 [담당자]입니다. 방문 가능 여부나 시간이 달라지면 회신 부탁드립니다. 변경사항은 임차 희망자와 협력 공인중개사에게 함께 전달하겠습니다.` |
| S9 | 계약 진행 확인 · `lease_signed` | `[호실] 임대차 진행 여부를 협력 공인중개사에게 확인하고 있습니다. 계약조건 협의와 계약서 작성은 공인중개사가 법정 절차에 따라 진행하며, 브링케어 CRM에는 계약완료 여부와 확인일만 기록하겠습니다. 완료 또는 변경사항을 확인해 주시면 반영하겠습니다.` |
| S10 | 임대관리 확장 제안 · `paid_management` | `이번 공실 광고와 문의 대응 결과를 바탕으로 공실·입퇴실 일정, 입주자 민원 접수, 필요한 업체 연결까지 한곳에서 관리해 드릴 수 있습니다. 건물주님은 중요한 결정만 확인하시도록 범위와 월 관리비를 건물 상황에 맞춰 설명드리겠습니다. 상담 가능한 시간을 알려주시면 정리해 안내드리겠습니다.` |
| S11 | 청소 제안 · `paid_management` | `현재 건물의 공용부 청소 또는 입주·퇴실청소도 함께 확인할 수 있습니다. 대상 공간과 오염 상태를 먼저 보고 필요한 작업 범위와 금액을 안내드린 뒤 승인된 내용만 진행합니다. 확인이 필요한 층이나 호실이 있으면 알려주세요.` |
| S12 | 수리·방수 제안 · `diagnosis_done` | `말씀하신 수리·방수 문제를 정확히 확인하려면 발생 위치, 현재 증상, 사진, 희망 일정을 알려주세요. 현장 확인 후 작업 범위를 정리하고 적합한 업체의 견적과 가능한 일정을 비교해 안내드리겠습니다. 승인 전에는 작업을 확정하지 않습니다.` |

S12에는 검색태그 `waterproofing`, `repair`, `방수`, `수리`를 넣는다. CL01~CL08에는 다음 항목을 그대로 사용한다.

```js
const checklistItems = {
  CL01: ["학교·병원·직장 등 수요거점을 기록했다", "대상 지역을 직접 순회했다", "건물명·주소·유형·발굴경로를 기록했다", "공실·퇴실예정 단서와 출처를 기록했다", "동일 주소 영업대상 중복을 확인했다"],
  CL02: ["공개 표시된 연락처와 출처 증거를 기록했다", "건물주·관리인·상가 관계자 등 역할을 확인하거나 미확인으로 표시했다", "연락처 확인일을 기록했다", "접촉 전 수신거부 여부를 확인했다", "비밀번호·출입코드·주민등록번호를 저장하지 않았다"],
  CL03: ["접촉 채널·담당자·일시를 기록했다", "사용한 대본 ID와 버전을 기록했다", "보장 표현 없이 확인된 사실만 안내했다", "접촉 결과와 다음 행동·기한을 기록했다", "수신거부 회신을 즉시 반영했다"],
  CL04: ["응답 원문 또는 사실 요약을 기록했다", "공실·퇴실예정 호실 수를 확인했다", "필요 서비스와 희망 시기를 확인했다", "유효관심 판단 근거를 증거 메모에 남겼다", "다음 연락일과 담당자를 정했다"],
  CL05: ["미팅 일시·목적·참석자를 확정했다", "주소와 확인할 호실을 재확인했다", "출입코드를 CRM에 저장하지 않았다", "사진 촬영·광고 사용 동의를 확인할 질문을 준비했다", "임대조건·공실원인·관리 요구 질문을 준비했다"],
  CL06: ["호실별 공실·퇴실예정 상태를 확인했다", "사진과 현장 상태 증거를 연결했다", "청소·장판·방수·설비 등 문제와 긴급도를 분리했다", "보증금·월세·관리비·입주 가능일을 확인했다", "중개 인계와 추가서비스의 다음 행동을 각각 정했다"],
  CL07: ["호실별 매물접수 완료증거를 기록했다", "임대조건과 광고 가능한 사진을 확인했다", "협력 공인중개사와 인계시각을 기록했다", "광고게시를 매물접수와 별도 이벤트로 기록했다", "문의·방문·계약 결과를 호실별로 기록했다"],
  CL08: ["공실 해결 결과를 건물주에게 요약했다", "유료관리 범위·시작일·증거를 기록했다", "청소·수리·방수 등 추가 요구를 별도 기회로 만들었다", "견적요청·승인과 매출기록을 구분했다", "실제 작업은 기존 민원 케이스 ID로 인계했다"],
};
```

`PROHIBITED_PHRASES`는 다음 금지·대체 쌍을 정확히 가진다.

```js
[
  { prohibited: "무조건 임대됩니다", replacement: "현재 조건을 확인해 광고와 문의 대응을 진행하겠습니다." },
  { prohibited: "수익을 보장합니다", replacement: "예상 효과와 조건을 설명드리며 실제 결과는 임대차 진행 상황에 따라 달라질 수 있습니다." },
  { prohibited: "저희가 계약서를 대신 작성합니다", replacement: "계약서는 협력 공인중개사가 법정 절차에 따라 진행합니다." },
  { prohibited: "허락 없이 광고부터 올리겠습니다", replacement: "건물주 확인과 매물접수 완료 후 광고를 게시합니다." },
]
```

`HANDOFF_RULES`의 `brokerage`는 호실·임대조건·건물주 확인·사진·인계시각, `workflowCase`는 문제·긴급도·현장사진·승인상태·비밀정보 미포함, `partnerVendor`는 작업범위·주소·희망일·견적조건·건물주 승인 여부를 각각 문장 배열로 제공한다.

`findStandard(query)`는 ID·제목·단계·본문·태그·체크항목을 NFKC 소문자로 합쳐 부분검색하고, 빈 검색어에는 전체 자료를 반환한다.

- [ ] **Step 4: 표준자료 테스트 확인**

Run:

```powershell
node --test desktop-crm/test/sales-standards.test.js
npm.cmd --prefix desktop-crm test
```

Expected: 표준자료 2개 테스트와 전체 테스트 PASS.

- [ ] **Step 5: 표준자료 커밋**

```powershell
git add -- desktop-crm/src/sales-standards.js desktop-crm/test/sales-standards.test.js
git commit -m "feat: add BRING sales scripts and checklists"
```

---

### Task 5: 기존 `영업 관리` 화면을 건물 파이프라인으로 교체

**Files:**
- Create: `desktop-crm/test/sales-ui-entry.test.js`
- Create: `desktop-crm/src/sales.css`
- Modify: `desktop-crm/src/index.html:8-14,94-95`
- Modify: `desktop-crm/src/app.js:1-120,560-590,1353-1360,3282-3291,3321-3330`

- [ ] **Step 1: 기존 화면·로그인 재사용 배선 테스트 작성**

```js
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const source = (file) => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("loads sales modules inside the existing CRM before app.js", async () => {
  const html = await source("index.html");
  assert.equal((html.match(/data-view="pipeline"/g) || []).length, 1);
  assert.ok(html.indexOf("sales.css") < html.indexOf("</head>"));
  assert.ok(html.indexOf("sales-core.js") < html.indexOf("app.js"));
  assert.ok(html.indexOf("sales-standards.js") < html.indexOf("app.js"));
  assert.doesNotMatch(html, /sales-crm\.html/);
});

test("renders the existing pipeline from isolated building prospects", async () => {
  const app = await source("app.js");
  assert.match(app, /const SalesCore = window\.BringSalesCore/);
  assert.match(app, /const SalesStandards = window\.BringSalesStandards/);
  assert.match(app, /function renderPipeline\(\)/);
  assert.match(app, /store\.salesProspects/);
  assert.match(app, /SalesCore\.computeSalesKpis/);
  assert.doesNotMatch(app, /고객 카드를 다음 단계로 옮기세요/);
});

test("does not add a sales login or authentication IPC", async () => {
  const [html, preload, main] = await Promise.all([source("index.html"), source("preload.js"), source("main.js")]);
  assert.equal((html.match(/id="loginGate"/g) || []).length, 1);
  assert.doesNotMatch(preload, /sales.*login|login.*sales/i);
  assert.doesNotMatch(main, /crm:sales-auth|sales.*login/i);
});
```

- [ ] **Step 2: 새 자산과 건물 파이프라인이 없어 RED인지 확인**

Run:

```powershell
node --test desktop-crm/test/sales-ui-entry.test.js
```

Expected: `sales.css`, `sales-core.js` 배선과 `salesProspects` 렌더 계약에서 FAIL.

- [ ] **Step 3: HTML에 전용 자산을 기존 앱 내부로 로드**

`index.html`의 마지막 CSS 뒤에 다음을 추가한다.

```html
<link rel="stylesheet" href="./sales.css">
```

본문 끝 스크립트 순서를 다음으로 고정한다.

```html
<script src="./core.js"></script>
<script src="./sales-core.js"></script>
<script src="./sales-standards.js"></script>
<script src="./app.js"></script>
```

- [ ] **Step 4: `renderPipeline()`을 건물 중심 대시보드로 교체**

`app.js` 상단에서 두 UMD 전역을 읽고, 상태값을 추가한다.

```js
const SalesCore = window.BringSalesCore;
const SalesStandards = window.BringSalesStandards;
let salesStageFilter = "all";
let salesBoardMode = "focus";
let selectedSalesProspectId = "";
```

기존 `SALES_BOARD_STAGES`와 고객 drag/drop 렌더를 제거한다. 새 `renderPipeline()`은 다음 순서로 출력한다.

1. 제목 `건물 영업 파이프라인`과 `＋ 대상 건물`, `영업 표준자료` 버튼
2. `SalesCore.computeSalesKpis(store, thisWeekRange())` 결과의 핵심 KPI 카드
3. 13단계 선택 막대와 `집중 보기`·`전체 흐름` 전환
4. `store.salesProspects.filter(item => !item.archivedAt)`의 건물 카드
5. 오늘·지연 후속연락 요약

단계별 숫자는 `prospect.stage`, 성과 숫자는 KPI 함수만 사용한다. 검색은 기존 `globalSearch` 값을 건물명·주소·담당자·수요거점에 적용한다. 카드는 다음 data 속성을 사용한다.

```html
<article class="sales-prospect-card" data-sales-prospect-open="{id}">...</article>
<button data-sales-stage-filter="{stageCode}">...</button>
<button data-sales-board-mode="focus|flow">...</button>
```

`window.__crmTest.snapshot()`에는 `salesProspects`, `salesEvents`, `salesOpportunities` 개수를 추가해 smoke에서 상태를 관찰할 수 있게 한다.

- [ ] **Step 5: 가독성 높은 전용 CSS 작성**

`sales.css`는 기존 CSS 변수를 사용하고 다음 최소값을 지킨다.

```css
.sales-crm h2{font-size:24px}.sales-crm p{font-size:13px;line-height:1.6}
.sales-kpi-grid{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:12px}
.sales-stage-strip{display:flex;gap:8px;overflow-x:auto;padding:4px 0 10px}
.sales-stage-button{min-height:44px;font-size:12px;white-space:nowrap}
.sales-prospect-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.sales-prospect-card{min-height:190px;padding:18px;border:1px solid #cfe2ed;border-radius:16px;background:#fff}
@media(max-width:1380px){.sales-kpi-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.sales-kpi-grid{grid-template-columns:repeat(2,1fr)}.sales-prospect-grid{grid-template-columns:1fr}}
```

13단계 전체 흐름은 폭을 줄여 글자를 찌그러뜨리지 말고 `.sales-flow-board{display:grid;grid-template-columns:repeat(13,minmax(260px,1fr));overflow-x:auto}`를 사용한다.

- [ ] **Step 6: UI 계약과 전체 회귀 테스트 실행**

Run:

```powershell
node --test desktop-crm/test/sales-ui-entry.test.js
npm.cmd --prefix desktop-crm test
```

Expected: UI 계약 3개와 전체 테스트 PASS.

- [ ] **Step 7: 화면 골격 커밋**

```powershell
git add -- desktop-crm/src/index.html desktop-crm/src/app.js desktop-crm/src/sales.css desktop-crm/test/sales-ui-entry.test.js
git commit -m "feat: replace sales board with building pipeline"
```

---

### Task 6: 대상 건물·연락처·호실·활동 입력과 상세 드로어

**Files:**
- Modify: `desktop-crm/src/app.js:1600-2100,2400-2780,2780-3060`
- Modify: `desktop-crm/src/sales.css`
- Modify: `desktop-crm/test/sales-ui-entry.test.js`

- [ ] **Step 1: CRUD·연결·보관 UI 실패 계약 추가**

`sales-ui-entry.test.js`에 다음 검사를 추가한다.

```js
test("wires prospect detail forms through existing save, audit, and write permission paths", async () => {
  const app = await source("app.js");
  ["salesProspectForm", "salesContactForm", "salesUnitForm", "salesActivityForm"].forEach((id) => assert.match(app, new RegExp(id)));
  assert.match(app, /data-sales-prospect-archive/);
  assert.match(app, /data-sales-prospect-restore/);
  assert.match(app, /crmBuildingId/);
  assert.match(app, /crmCustomerId/);
  assert.match(app, /SalesCore\.duplicateProspects/);
  assert.match(app, /logAudit\(/);
  assert.match(app, /scheduleSave\(\)/);
});
```

- [ ] **Step 2: 폼과 보관 액션 부재로 RED 확인**

Run:

```powershell
node --test desktop-crm/test/sales-ui-entry.test.js
```

Expected: 네 폼 ID 또는 보관 data 속성이 없어 FAIL.

- [ ] **Step 3: 대상 건물 편집기와 중복 확인 구현**

`salesProspectEditor(id = "")`는 기존 `modalContent`와 `.modal-body` 패턴을 사용한다. 필드는 건물명, 주소, 지역, 건물유형, 수요거점(쉼표 입력→배열), 발굴경로, 담당자, 우선순위, 공실 수, 퇴실예정 수, 다음 행동·기한, 기존 운영 건물 선택이다.

`salesProspectForm` 제출 순서는 고정한다.

```js
const now = new Date().toISOString();
const candidate = SalesCore.createProspect(Object.assign({}, existing || {}, values), currentActor(), now);
SalesCore.assertProspect(candidate);
const duplicates = SalesCore.duplicateProspects(store.salesProspects, { ...candidate, id: existing?.id || candidate.id });
// 중복이 있고 form.dataset.duplicateConfirmed !== "true"이면 requestConfirmation 후 재제출한다.
// 신규이면 prospect와 prospect_created 이벤트를 함께 push한다.
// 수정이면 생성 메타데이터를 보존하고 Object.assign(existing, candidate)한다.
logAudit({ category: existing ? "변경" : "등록", targetType: "영업대상 건물", targetId: candidate.id, targetLabel: candidate.name || candidate.address, action: existing ? "영업대상 수정" : "영업대상 등록", reason: "건물 영업 관리" });
scheduleSave();
```

신규 `prospect_created` 이벤트에는 `evidenceType: "crm_record"`, `evidenceNote: "영업대상 등록"`을 넣는다. 기존 `buildings`를 자동 생성하지 않는다.

- [ ] **Step 4: 건물 상세와 세 하위 레코드 편집기 구현**

`renderSalesProspectDrawer(id)`는 `selectedSalesProspectId`를 저장하고 기본정보, 연결 연락처, 호실, 활동 타임라인, 이벤트, 추가서비스, 감사·보관 영역을 렌더한다.

폼별 저장 규칙은 다음과 같다.

| 폼 | 생성·검증 | 저장 후 대상 캐시 | 감사 `targetType` |
|---|---|---|---|
| `salesContactForm` | `createContact`→`assertContact` | 없음 | `영업 연락처` |
| `salesUnitForm` | `createUnit`→`assertUnit` | 활성 호실 상태로 공실·퇴실예정 수 재계산 | `영업 호실` |
| `salesActivityForm` | `createActivity`→`assertActivity({contacts, scripts:SCRIPTS})` | `lastActivityAt`, `nextAction`, `nextActionAt` | `영업 활동` |

연락처에는 기존 고객 선택 `crmCustomerId`, 대상 건물에는 기존 건물 선택 `crmBuildingId`만 저장한다. 실제 고객·건물 레코드는 수정하지 않는다. 수신거부 설정·해제 시 별도 감사로그를 남긴다. 연락처·호실 행은 수정과 보관만 제공한다.

- [ ] **Step 5: 대상·하위 레코드 보관과 복원 구현**

`data-sales-prospect-archive`는 확인창 후 `SalesCore.archiveRecord`, `data-sales-prospect-restore`는 `restoreRecord`를 사용한다. 연락처·호실에도 같은 패턴을 적용한다. 영구삭제 버튼은 만들지 않는다. 각 행동은 `logAudit()` 후 `scheduleSave()`를 호출한다.

읽기 전용 사용자는 기존 `canWriteCRM()`과 `.crm-read-only`를 따르도록 새 생성·수정·보관 버튼 data 속성을 CSS 숨김 목록에 포함한다.

- [ ] **Step 6: 계약과 전체 회귀 테스트 실행**

Run:

```powershell
node --test desktop-crm/test/sales-ui-entry.test.js desktop-crm/test/sales-core.test.js
npm.cmd --prefix desktop-crm test
```

Expected: 대상·연락처·호실·활동 계약과 전체 테스트 PASS.

- [ ] **Step 7: 상세 입력 흐름 커밋**

```powershell
git add -- desktop-crm/src/app.js desktop-crm/src/sales.css desktop-crm/test/sales-ui-entry.test.js
git commit -m "feat: manage sales prospects contacts units and activities"
```

---

### Task 7: 완료증거 이벤트·추가서비스·표준자료 센터 연결

**Files:**
- Modify: `desktop-crm/src/app.js:1353-1360,1600-2100,2400-3060`
- Modify: `desktop-crm/src/sales.css`
- Modify: `desktop-crm/test/sales-ui-entry.test.js`

- [ ] **Step 1: 이벤트·기회·표준자료 UI 실패 계약 추가**

```js
test("wires evidenced events, addon opportunities, and standards into the sales workspace", async () => {
  const app = await source("app.js");
  assert.match(app, /salesEventForm/);
  assert.match(app, /SalesCore\.assertEvent/);
  assert.match(app, /SalesCore\.nextStageFromEvents/);
  assert.match(app, /salesOpportunityForm/);
  assert.match(app, /SalesCore\.assertOpportunity/);
  assert.match(app, /SalesStandards\.findStandard/);
  assert.match(app, /data-sales-standard-open/);
});
```

- [ ] **Step 2: 이벤트·표준자료 배선이 없어 RED 확인**

Run:

```powershell
node --test desktop-crm/test/sales-ui-entry.test.js
```

Expected: `salesEventForm` 또는 표준자료 검색 배선이 없어 FAIL.

- [ ] **Step 3: 완료증거 이벤트 폼과 단계 전환 구현**

`salesEventEditor(prospectId, suggestedType = "")`에는 이벤트 종류, 관련 호실, 발생시각, 증거 종류, 증거 URL, 증거 메모, 적용 체크리스트, 담당자를 표시한다. 이벤트 종류에 따라 호실·증거 필수 안내를 동적으로 보여준다.

제출은 다음 순서를 유지한다.

```js
const eventItem = SalesCore.createEvent(values, currentActor(), new Date().toISOString());
SalesCore.assertEvent(eventItem, {
  contacts: store.salesContacts,
  units: store.salesUnits,
  opportunities: store.salesOpportunities,
});
store.salesEvents.push(eventItem);
prospect.stage = SalesCore.nextStageFromEvents(prospect.id, store.salesEvents);
prospect.updatedAt = new Date().toISOString();
prospect.updatedBy = currentActor().email;
logAudit({ category: "변경", targetType: "영업 성과", targetId: eventItem.id, targetLabel: prospect.name || prospect.address, action: `완료증거 기록 · ${eventItem.type}`, reason: eventItem.evidenceNote || "영업 단계 완료" });
scheduleSave();
```

보류·종료 후 재개는 `data-sales-prospect-resume` 확인창에서 재개할 단계 코드를 선택하고 감사로그를 남긴다. 기존 이벤트는 삭제하지 않는다.

- [ ] **Step 4: 추가서비스 다섯 단계 흐름 구현**

`salesOpportunityEditor(prospectId, opportunityId = "")`는 서비스 유형, 상태, 요구사항, 담당자, 기한, 견적금액, 매출금액, 증거 URL, 기존 민원 케이스 ID를 편집한다. `createOpportunity`와 `assertOpportunity`를 통과한 뒤 저장한다.

- `quote_requested`·`quote_approved`: 견적금액은 저장하지만 매출 KPI에는 미포함
- `work_completed`: 증거 URL 또는 완료 메모 필수
- `revenue_recorded`: 증거와 1원 이상의 매출금액 필수
- 기존 케이스 선택은 `activeCases()` 목록의 ID만 허용하고 케이스 객체를 복사하지 않음
- 수정·상태변경·보관·복원마다 기존 `auditLogs` 사용

- [ ] **Step 5: 표준자료 센터와 기록 연결 구현**

`data-sales-standard-open`은 모달에서 `SCRIPTS`, `CHECKLISTS`, `PROHIBITED_PHRASES`, `HANDOFF_RULES` 탭을 연다. 검색 입력은 `SalesStandards.findStandard(query)`로 즉시 필터링한다. 대본의 `활동에 사용` 버튼은 활동 폼을 열고 `scriptId`와 `scriptVersion = SalesStandards.VERSION`을 미리 채운다. 체크리스트의 `증거에 사용` 버튼은 이벤트 폼의 `checklistIds`를 미리 선택한다.

표준자료 모달은 읽기 권한 사용자도 열 수 있지만 레코드 생성 버튼은 기존 쓰기 권한을 따른다.

- [ ] **Step 6: 전체 자동테스트와 Electron smoke 실행**

Run:

```powershell
npm.cmd --prefix desktop-crm test
npm.cmd --prefix desktop-crm run smoke
```

Expected: 모든 Node 테스트 PASS. smoke JSON에서 `ready:true`, `view:"dashboard"`, 기존 로그인 상태와 `salesProspects`·`salesEvents`·`salesOpportunities` 숫자가 출력되고 프로세스가 0으로 종료.

- [ ] **Step 7: 실제 화면 수동 검증**

Run:

```powershell
npm.cmd --prefix desktop-crm start
```

로그인한 테스트 계정에서 다음을 순서대로 확인한다.

1. 기존 `영업 관리`가 새 건물 화면으로 열리고 새 메뉴나 새 로그인이 생기지 않는다.
2. 1280×720과 1920×1080에서 KPI·단계명·건물 카드가 잘리지 않는다.
3. 대상 건물→연락처→호실→활동→매물접수→광고게시를 기록하면 두 KPI가 각각 1이다.
4. 수신거부 연락처로 문자 활동을 저장할 때 차단 메시지가 나온다.
5. 방수 기회를 견적승인으로 두면 매출 0원이고 매출기록으로 바꾸면 입력금액이 표시된다.
6. 보관한 대상은 기본 목록과 KPI에서 빠지고 복원하면 다시 나타난다.
7. 표준자료 검색 `S1`, `공실`, `waterproofing` 결과가 맞는다.
8. 고객·건물·BRING FIELD·케이스·입금 화면이 정상적으로 열린다.

- [ ] **Step 8: 이벤트·표준자료 흐름 커밋**

```powershell
git add -- desktop-crm/src/app.js desktop-crm/src/sales.css desktop-crm/test/sales-ui-entry.test.js
git commit -m "feat: connect sales evidence opportunities and playbooks"
```

---

### Task 8: 릴리스 회귀검증, v1.7.0 패키지와 배포 준비

**Files:**
- Modify: `desktop-crm/package.json:3`
- Modify: `desktop-crm/package-lock.json:3,9`
- Modify: `desktop-crm/test/company-release.test.js:5-10`
- Verify only: `desktop-crm/src/main.js`, `desktop-crm/src/preload.js`, `wonju-map.html`

- [ ] **Step 1: 다음 릴리스 버전 실패 테스트 작성**

`company-release.test.js`의 버전 기대값만 다음으로 변경한다.

```js
assert.equal(packageJson.version, "1.7.0");
```

- [ ] **Step 2: 버전 테스트 RED 확인**

Run:

```powershell
node --test desktop-crm/test/company-release.test.js
```

Expected: 실제 `1.6.2`와 기대 `1.7.0` 차이로 FAIL.

- [ ] **Step 3: package와 lockfile 버전을 1.7.0으로 맞춤**

`desktop-crm/package.json`의 최상위 `version`, `package-lock.json`의 최상위 `version`과 `packages[""] .version` 세 곳만 `1.7.0`으로 바꾼다. `appId`, `productName`, `artifactName`, `publish` 설정은 변경하지 않는다.

- [ ] **Step 4: 로그인·공유 저장·기존 화면 회귀를 포함한 전체 검증**

Run:

```powershell
npm.cmd --prefix desktop-crm test
npm.cmd --prefix desktop-crm run smoke
git diff --check
git status --short
```

Expected: 모든 테스트와 smoke PASS, whitespace 오류 없음, `wonju-map.html` 변경 없음. `google-login.test.js`, `company-firebase-routing.test.js`, `field-platform-entry.test.js`가 기존 인증·회사 namespace·FIELD 진입점을 계속 보장해야 한다.

- [ ] **Step 5: Windows 설치파일 생성과 산출물 확인**

Run:

```powershell
npm.cmd --prefix desktop-crm run build:win
Get-ChildItem desktop-crm/dist/BRING.CRM.Company.Setup.1.7.0.exe, desktop-crm/dist/BRING.CRM.Company.Setup.1.7.0.exe.blockmap, desktop-crm/dist/latest.yml | Select-Object Name,Length
Get-FileHash desktop-crm/dist/BRING.CRM.Company.Setup.1.7.0.exe -Algorithm SHA256
Select-String -Path desktop-crm/dist/latest.yml -Pattern 'version: 1.7.0','BRING.CRM.Company.Setup.1.7.0.exe'
```

Expected: 세 산출물이 존재하고 크기가 0보다 크며 `latest.yml`이 버전과 설치파일명을 정확히 가리킨다. SHA-256은 릴리스 설명에 기록한다.

- [ ] **Step 6: 버전 변경 커밋**

```powershell
git add -- desktop-crm/package.json desktop-crm/package-lock.json desktop-crm/test/company-release.test.js
git commit -m "release: prepare BRING CRM v1.7.0"
```

- [ ] **Step 7: 작업 브랜치를 회사 GitHub에 올리고 릴리스 자산 게시**

```powershell
git push -u origin codex/sales-crm-integration
git tag -a crm-v1.7.0 -m "BRING CRM v1.7.0 building sales CRM"
git push origin crm-v1.7.0
```

GitHub Release `crm-v1.7.0`에 다음 세 파일을 정확히 첨부한다.

- `desktop-crm/dist/BRING.CRM.Company.Setup.1.7.0.exe`
- `desktop-crm/dist/BRING.CRM.Company.Setup.1.7.0.exe.blockmap`
- `desktop-crm/dist/latest.yml`

게시 후 GitHub Release API에서 태그 `crm-v1.7.0`, `draft:false`, `prerelease:false`, 자산 3개의 `state:"uploaded"`와 로컬 파일 크기 일치를 확인한다. 릴리스 게시 전에 태그가 잘못된 커밋을 가리키면 자산을 올리지 말고 중단한다.

- [ ] **Step 8: 기존 설치본 업데이트는 사용자 확인 뒤 검증**

현재 설치본에서 `업데이트 확인`이 v1.7.0을 찾고 다운로드를 마칠 때까지 확인한다. `지금 재시작` 또는 설치 동작은 사용자 확인 후 진행한다. 업데이트 뒤 버전 v1.7.0, 기존 고객·건물 데이터 유지, Google 로그인 유지, `영업 관리`의 새 화면과 두 PC 실시간 동기화를 확인한다.

---

## 최종 완료 확인

- [ ] 별도 로그인·영업 HTML·영업 최상위 DB 경로가 없다.
- [ ] 여섯 영업 컬렉션이 기존 `crmCompany/data` 공유 저장을 왕복한다.
- [ ] 운영 `buildings`·`customers`는 자동 생성·자동변환되지 않고 확인된 ID만 연결된다.
- [ ] 13단계와 KPI는 증거 이벤트를 기준으로 작동한다.
- [ ] 매물접수·광고게시와 견적·매출이 분리된다.
- [ ] S1~S12, CL01~CL08, 금지문구와 인계기준을 CRM에서 찾을 수 있다.
- [ ] 보관·복원·수신거부·감사로그·읽기전용 제한이 유지된다.
- [ ] `npm.cmd --prefix desktop-crm test`, smoke, Windows build가 모두 통과한다.
- [ ] `wonju-map.html`은 변경되지 않는다.
- [ ] v1.7.0 릴리스 자산 3개가 게시되고 자동업데이트가 이를 확인한다.

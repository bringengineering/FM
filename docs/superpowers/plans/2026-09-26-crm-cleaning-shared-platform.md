# CRM·클리닝센터·TV 공통 플랫폼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 CRM의 고객·건물 원본을 유지하면서 클리닝 주문의 정식 서버 저장·업무 흐름을 제공하고 CRM 및 TV에서 같은 주문을 안전하게 확인하도록 한다.

**Architecture:** Firebase Functions를 주문 명령의 인증·권한·검증 경계로 사용하고 Realtime Database의 `crmCompany/cleaningOrders`를 신규 주문 원본으로 둔다. 고객·건물은 기존 `crmCompany/data/customers`·`buildings` 정식 ID를 참조한다. Electron의 클리닝센터는 Functions API를 호출하며, TV는 검증된 집계 projection만 읽는다. 온톨로지는 용어·관계·상태 계약으로 관리하고, n8n은 핵심 저장 경로가 안정된 후 알림부터 별도 도입한다.

**Tech Stack:** Electron, JavaScript, TypeScript, Firebase Functions v2, Firebase Realtime Database, Vitest, Node test runner.

---

## 구현 경계와 현재 상태

- 기능 화면·상태 흐름은 [`../specs/2026-09-26-crm-cleaning-shared-platform-design.md`](../specs/2026-09-26-crm-cleaning-shared-platform-design.md)를 따른다.
- 현재 `desktop-crm/src/cleaning-center-ui.js`는 기존 CRM 화면으로 이동하는 허브와 요약 KPI다. 이를 주문 정식 저장 기능으로 오인하지 않는다.
- 기존 CRM에는 고객·건물, `workOrders`, `serviceRecords`, `workReports`, `deliveryFlows`, 계약/청구 기능이 있다. 클리닝 주문을 기존 업무 데이터와 중복 저장하지 않도록 `cleaningOrderId` 참조를 우선 사용한다.
- 작업 트리에 이미 수정된 `desktop-crm/src/app.js`, `desktop-crm/src/index.html`, `desktop-crm/src/workspace-shell.js`, 신규 `cleaning-center-ui.js`, `cleaning-center.css`가 있다. 이 변경을 보존하고 필요한 부분만 좁게 수정한다.
- 운영 Firebase Rules/Functions, Cloudflare Worker, TV 운영 스케줄은 승인·출시 검수 전 배포하지 않는다.

## 파일 책임

- Create `functions/src/cleaning-orders/contracts.ts`: 주문 입력·저장 레코드·상태·오류 계약
- Create `functions/src/cleaning-orders/core.ts`: 순수 입력 정규화, ID 관계 검증, 상태 전이 결정
- Create `functions/src/cleaning-orders/runtime.ts`: Firebase 트랜잭션·멱등 요청 영수증 어댑터
- Modify `functions/src/index.ts`: 인증된 list/create/update/transition 요청 엔트리포인트
- Modify `database.rules.json`: 주문·요청 영수증의 직접 클라이언트 쓰기 차단, 읽기 정책 최소화
- Create `functions/test/cleaning-orders.test.ts`: 코어 계약과 상태 전이 테스트
- Create `functions/test/cleaning-orders-runtime.test.ts`: 멱등성·동시수정·관계 검증 테스트
- Modify `desktop-crm/src/preload.js`, `desktop-crm/src/main.js`, `desktop-crm/src/remote.js`: 기존 IPC/원격 인증 패턴을 따라 주문 API 노출
- Modify `desktop-crm/src/cleaning-center-ui.js`, `desktop-crm/src/app.js`, `desktop-crm/src/cleaning-center.css`: 주문 목록·접수·상세·상태 진행 UI 연결
- Create `desktop-crm/test/cleaning-center-orders.test.js`: 화면 모델·렌더링 및 API 상태 처리
- Modify TV 게시/집계 모듈 및 해당 테스트: 고객 개인정보 없이 상태 집계만 제공

## Task 1: 정식 주문 계약과 상태 전이 코어

**Files:**
- Create: `functions/test/cleaning-orders.test.ts`
- Create: `functions/src/cleaning-orders/contracts.ts`
- Create: `functions/src/cleaning-orders/core.ts`

- [ ] **Step 1: 상태 계약의 실패 테스트 작성**

`functions/test/cleaning-orders.test.ts`에서 Vitest로 다음을 먼저 고정한다.

```ts
import { describe, expect, it } from "vitest";
import { decideCleaningOrderTransition } from "../src/cleaning-orders/core.js";

describe("decideCleaningOrderTransition", () => {
  it("allows received to move to reviewing", () => {
    expect(decideCleaningOrderTransition("received", "reviewing", "member")).toEqual({ ok: true });
  });

  it("does not allow a worker to approve final quality review", () => {
    expect(decideCleaningOrderTransition("review_pending", "completed", "worker")).toMatchObject({
      ok: false,
      error: "cleaning_order_transition_forbidden",
    });
  });

  it("does not allow completed orders to return to in progress", () => {
    expect(decideCleaningOrderTransition("completed", "in_progress", "admin")).toMatchObject({
      ok: false,
      error: "cleaning_order_transition_forbidden",
    });
  });
});
```

- [ ] **Step 2: RED 확인**

Run: `pnpm --dir functions exec vitest run test/cleaning-orders.test.ts`
Expected: FAIL because `../src/cleaning-orders/core.js` does not exist.

- [ ] **Step 3: 계약 및 최소 상태 결정 구현**

Define exact statuses `received`, `reviewing`, `quote_pending`, `approval_pending`, `scheduled`, `in_progress`, `review_pending`, `revision_requested`, `completed`, `cancelled`; use only current company roles `admin`, `member`, `viewer` in v1. `decideCleaningOrderTransition(from,to,role)` returns `{ok:true}` or `{ok:false,error}`. Encode allowed edges and role restrictions in a frozen transition table. `viewer` cannot mutate. Members may submit work to `review_pending`; only admins may mark `review_pending` as `completed`. Terminal `completed` and `cancelled` do not transition back. Do not grant a new external partner role in v1.

- [ ] **Step 4: Verify GREEN and typecheck**

Run: `pnpm --dir functions exec vitest run test/cleaning-orders.test.ts`
Expected: all three transition tests PASS.
Run: `pnpm --dir functions run build`
Expected: TypeScript build succeeds.

- [ ] **Step 5: Add contract validation tests before validators**

Test that create input rejects empty `requestId`, empty title, client-supplied status or audit fields, invalid date, unsupported service kind, and overlong free text. Test that a valid normalized input preserves canonical customer/building IDs; database existence is checked transactionally in Task 2.

## Task 2: Atomic server runtime and idempotency

**Files:**
- Create: `functions/test/cleaning-orders-runtime.test.ts`
- Create: `functions/src/cleaning-orders/runtime.ts`

- [ ] **Step 1: Write RED runtime tests** for duplicate `requestId`, two concurrent updates with the same expected revision, missing/archived customer or building, and actor without write role.
- [ ] **Step 2: Verify RED** with `pnpm --dir functions exec vitest run test/cleaning-orders-runtime.test.ts`.
- [ ] **Step 3: Implement dependency-injected database transaction adapter** that atomically checks `crmCompany/data/customers/{customerId}`, `crmCompany/data/buildings/{buildingId}`, current order revision and `crmCompany/cleaningOrderRequests/{uid}/{requestId}` before writing. Store only a safe command receipt at the idempotency path; never persist raw auth tokens.
- [ ] **Step 4: Return the original saved result for a replayed identical `requestId`; reject the same key with a different normalized payload. Reject expected revision mismatch with `cleaning_order_version_conflict`.**
- [ ] **Step 5: Verify runtime tests and run `pnpm --dir functions run test`.**

## Task 3: Authenticated Functions and Firebase Rules

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `database.rules.json`
- Modify: `functions/test/cleaning-orders-runtime.test.ts`

- [ ] **Step 1: Add endpoint contract tests** for list permissions (`admin/member/viewer`), create/update permissions (`admin/member`), assigned worker transition scope, invalid auth, unknown fields, and request limits.
- [ ] **Step 2: Verify endpoint tests fail** before route implementation.
- [ ] **Step 3: Add HTTPS Functions using existing company access verification, verified email/UID binding, rate limiting, and Firebase Admin transactions.** Export `listCleaningOrders`, `createCleaningOrder`, and `transitionCleaningOrder`; do not expose admin database credentials or make client-writable rules.
- [ ] **Step 4: Set `.read`/`.write` false at `/crmCompany/cleaningOrders` and `/crmCompany/cleaningOrderRequests`; Admin SDK Functions remain the only writer. Permit an enabled wallboard reader to read only the separate `/crmCompany/wallboard/cleaningOperations` projection path.**
- [ ] **Step 5: Run focused tests, Functions typecheck, and database rules emulator tests.**

## Task 4: Electron bridge and repository client

**Files:**
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/remote.js`
- Create: `desktop-crm/test/cleaning-center-orders.test.js`

- [ ] **Step 1: Add failing tests** that the renderer API exposes only `listCleaningOrders`, `createCleaningOrder`, and `transitionCleaningOrder`, and that the main/remote client forwards auth through the existing Firebase company API without exposing tokens to renderer payloads.
- [ ] **Step 2: Run `npm --prefix desktop-crm test -- --test-name-pattern="cleaning center orders"` and confirm the new tests fail for missing methods.**
- [ ] **Step 3: Add narrow IPC handlers and preload methods following existing `loadWorkOrders`/`commitCanonicalCrmEntity` patterns.** Keep input allowlists in main and errors structured for UI display.
- [ ] **Step 4: Add remote client calls for the three Functions; do not put order data into the broad `save(data)` payload.**
- [ ] **Step 5: Run the focused tests and complete `npm --prefix desktop-crm test`.**

## Task 5: Operational Cleaning Center UI

**Files:**
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/cleaning-center.css`
- Modify: `desktop-crm/test/cleaning-center-orders.test.js`

- [ ] **Step 1: Add render tests** for empty/loading/error/list states, privacy-safe customer/building labels, create form validation, conflict display, and allowed transition actions.
- [ ] **Step 2: Run the focused test and verify expected RED.**
- [ ] **Step 3: Replace placeholder navigation-only content with an order queue and a create/detail flow while retaining current CRM folder/nav shell and its link access to existing customer, quote, work-report, contract, and billing pages.**
- [ ] **Step 4: Populate the customer/building selector from existing authenticated CRM store by canonical IDs; never make a second customer/building record during order creation.**
- [ ] **Step 5: Use `api.listCleaningOrders/createCleaningOrder/transitionCleaningOrder`; show save pending, success, retryable network error, permission denial, and version conflict as distinct UI states.**
- [ ] **Step 6: Verify focused rendering tests, all desktop tests, and a local Electron smoke flow using synthetic test records.**

## Task 6: Link orders to existing field work, evidence, and CRM timeline

**Files:**
- Modify: `desktop-crm/src/work-order-core.js`
- Modify: `desktop-crm/src/work-report-core.js`
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/test/work-order-core.test.js`
- Modify: `desktop-crm/test/work-report-core.test.js`

- [ ] **Step 1: Add tests that a work order/report can reference one `cleaningOrderId` and that unrelated work without this reference behaves unchanged.**
- [ ] **Step 2: Verify RED for linked detail/timeline lookup.**
- [ ] **Step 3: Add optional `cleaningOrderId` reference through the existing work-order/report transaction path; do not clone customer/building fields or binary media into the order row.**
- [ ] **Step 4: Render order history on CRM customer/building detail by reference.**
- [ ] **Step 5: Run focused work-order/report tests and desktop full regression tests.**

## Task 7: TV-safe projection

**Files:**
- Create: `functions/src/cleaning-orders/wallboard-projection.ts`
- Modify: `functions/src/index.ts`
- Modify: `database.rules.json`
- Modify: `functions/test/cleaning-orders-wallboard.test.ts`
- Modify: `crm-ai-worker/src/wallboard-server-refresh.js`
- Modify: `crm-ai-worker/src/wallboard-publication.js`
- Modify: `crm-ai-worker/test/wallboard-server-refresh.test.js`
- Modify: `desktop-crm/src/company-wallboard.js`
- Modify: `desktop-crm/src/wallboard-publication-schema.js`
- Modify: `desktop-crm/test/company-wallboard.test.js`
- Modify: `desktop-crm/test/wallboard-revenue.test.js`

- [ ] **Step 1: Add tests to `functions/test/cleaning-orders-wallboard.test.ts` proving the projection contains only aggregate counts by status, overdue count, and update timestamp; assert customer names, phones, addresses, notes, order IDs, assignee identifiers, and evidence references are absent.**
- [ ] **Step 2: Run `pnpm --dir functions exec vitest run test/cleaning-orders-wallboard.test.ts` and confirm expected RED before projection changes.**
- [ ] **Step 3: Implement deterministic `buildCleaningWallboardProjection(orders, now)` and a Firebase trigger in `functions/src/index.ts` that writes only the aggregate to a dedicated projection path.**
- [ ] **Step 4: Update `database.rules.json` so only an enabled wallboard reader can read the projection path; deny direct reads/writes to raw orders and request receipts.**
- [ ] **Step 5: Add the projection source to `crm-ai-worker/src/wallboard-server-refresh.js` through the existing verified TV reader credential; never grant TV access to `crmCompany/cleaningOrders`.**
- [ ] **Step 6: Add the versioned aggregate fields to `desktop-crm/src/company-wallboard.js` and `desktop-crm/src/wallboard-publication-schema.js`; preserve last valid TV snapshot on source failure.**
- [ ] **Step 7: Run `pnpm --dir functions run test`, `pnpm --dir functions run build`, `npm --prefix crm-ai-worker test`, and `npm --prefix desktop-crm test -- --test-name-pattern="wallboard"`; verify privacy, stale fallback, and existing scene rotation. Do not deploy or enable scheduled production refresh.**

## Task 8: Ontology contract and documentation

**Files:**
- Create: `docs/ontology/bring-service-operations-v1.json`
- Create: `docs/ontology/README.md`
- Create: `functions/test/cleaning-ontology.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-crm-cleaning-shared-platform-design.md`

- [ ] **Step 1: Add schema tests** requiring stable entity IDs, versioned statuses, allowed relationship endpoints, and deprecated-term mappings.
- [ ] **Step 2: Run `pnpm --dir functions exec vitest run test/cleaning-ontology.test.ts` and confirm expected RED for the missing ontology artifact/validator.**
- [ ] **Step 3: Define `Customer`, `Building`, `Space`, `CleaningOrder`, `Quote`, `WorkExecution`, `Evidence`, `Invoice`, `Receipt`, and existing `User`/`Partner` references; specify relationships and data sensitivity.**
- [ ] **Step 4: Document that this contract is a vocabulary/schema reference, not a graph database and not a second source of truth.**
- [ ] **Step 5: Verify schema tests and ensure code API/status constants match ontology version.**

## Task 9: Full regression and release gate

**Files:**
- Tests only, plus runbook updates if the verified release gate changes.

- [ ] **Step 1: Run `pnpm --dir functions run test` and `pnpm --dir functions run build`.**
- [ ] **Step 2: Run `npm --prefix desktop-crm test`, `npm --prefix desktop-crm run smoke` in the supported local environment, and `npm --prefix crm-ai-worker test` only if its boundary changed.**
- [ ] **Step 3: Run Firebase database/storage rules emulator tests for denied direct writes and allowed authenticated Functions behavior.**
- [ ] **Step 4: Validate an end-to-end synthetic order across CRM → Cleaning Center → field work/report → TV aggregate and compare every persisted ID/revision.**
- [ ] **Step 5: Verify diff includes no real customer data, secrets, production-only credentials, deployment, or unrelated cleanup.**
- [ ] **Step 6: Report implemented vs unverified items separately; request a distinct production deployment approval after release checks.**

## Progress and completion evidence

The feature is complete only when all tasks pass, end-to-end synthetic flow and privacy assertions pass, existing CRM/field/billing/TV regression tests pass, and production deployment remains explicitly gated. A passing unit suite alone does not prove shared live data, TV propagation latency, Firebase production rules, or real-TV readability.

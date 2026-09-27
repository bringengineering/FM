# CRM·클리닝센터·TV 공통 플랫폼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 CRM의 고객·건물 원본을 유지하면서 클리닝 주문의 정식 서버 저장·업무 흐름을 제공하고 CRM 및 TV에서 같은 주문을 안전하게 확인하도록 한다.

**Architecture:** Firebase Functions를 주문 명령의 인증·권한·검증 경계로 사용하고 Realtime Database의 `crmCompany/cleaningOrders`를 신규 주문 원본으로 둔다. 고객·건물은 기존 `crmCompany/data/customers`·`buildings` 정식 ID를 참조한다. Electron의 클리닝센터는 Functions API를 호출하며, TV는 검증된 집계 projection만 읽는다. 온톨로지는 용어·관계·상태 계약으로 관리하고, n8n은 핵심 저장 경로가 안정된 후 알림부터 별도 도입한다.

**Tech Stack:** Electron, JavaScript, TypeScript, Firebase Functions v2, Firebase Realtime Database, Vitest, Node test runner.

## 구현 현황 (2026-09-26)

- 구현 및 자동화 테스트 통과: 주문 계약·상태전이·원자적 생성/버전 갱신, canonical 고객·건물 상태 및 연결 검증, Functions API 인증/권한, Electron API, 주문 목록·접수 UI, TV 개인정보 제거 집계, 온톨로지 용어 매핑 테스트.
- 추가 연결: 기존 업무지시와 결과보고서는 선택적으로 `cleaningOrderId`를 참조한다. 주문 상세에서 관련 업무·보고서·증빙 개수를 확인하고, CRM 고객·건물 상세에도 정식 ID 기준 주문 이력을 표시한다. 주문-업무-보고서 참조는 건물 일치 여부를 UI와 Firebase Rules에서 검증한다.
- 주문 큐 보완: 서비스 유형 라벨과 접수 상세를 주문별로 펼쳐 확인하도록 했고, 접수 내용은 HTML 이스케이프 후 렌더링한다. 상세가 없는 구버전 주문은 빈 펼침 UI를 만들지 않는다. 조회 전용 계정에는 주문 등록·단계 변경을 비활성화하고 권한 안내를 표시하며, 서버 오류 코드는 행동 가능한 한국어 안내로 바꾼다.
- 대량 주문 대응: Functions 목록 API와 Electron 목록 UI에 200건 단위 커서 페이지네이션을 추가했다. `(createdAt, orderId)` 복합 커서를 검증하고 같은 시각 주문도 누락·중복 없이 이어 읽으며, 화면은 현재 검색/상태 필터를 유지한 채 페이지를 추가한다.
- 견적 검수: 주문별 견적 revision을 서버에서 append-only로 저장하고, 기존 견적 편집기에서 초안을 작성·연결한다. 관리자 승인/반려 이력은 견적 내용을 덮어쓰지 않으며, 고객 수락·청구·입금과 분리되어 있다.
- 완료 증거 강제: `review_pending → completed` 전환은 같은 주문·건물·서비스 유형·현장 작업 회차에 연결된 결과보고서가 있어야 허용한다. 주문 유형에 맞는 필수 체크 항목, 완료 항목의 전·후 사진, 미수행 사유, 최소 1개 수행 항목을 서버에서 검증한다. `review_pending`부터 `completed`까지 연결 보고서 수정은 Firebase Rules에서 잠그며, `revision_requested`로 반려되면 다시 수정할 수 있다. CRM은 검수/완료 잠금을 표시하고 증거 사진을 읽기 전용 링크로 열어 준다.
- 미완료: 회사 실제 Firebase에 배포된 Functions/Rules 통합, 실제 CRM 사용자·고객·건물로 등록/작업/보고까지 수행, 작업·보고서의 Firebase 영속 저장부터 TV 실기기까지의 전파시간 실측, 운영 배포 승인.
- 검증(2026-09-26 최신): Functions 전체 50개 파일·1,236 테스트 통과 및 TypeScript 빌드 통과(Node 24 경고; 저장소 기준 Node 22). API 권한 회귀에는 조회 전용 계정의 목록 허용·변경 거부, 마케팅 전용 계정 차단, 미지원 action과 불완전 커서의 HTTP 400이 포함된다. Auth·Database·Functions Emulator HTTP 통합 2/2 통과: 테스트 계정 인증→API 주문 생성/조회/상태 변경→동일 건물에 연결된 CRM 업무지시·결과보고 영속 저장→잘못된 건물 연결 거부→개인정보 없는 TV 집계 갱신→클라이언트 원본 주문 읽기 차단, 견적 revision 생성·재시도·관리자 반려·개정·승인까지 검증. 206건 페이지네이션 및 같은 시각 커서 경계는 Functions API 단위 회귀 테스트 1/1에서 검증한다. 205건을 Functions 에뮬레이터에 한 번에 적재하던 테스트는 실제 기능 문제가 아닌 에뮬레이터 이벤트 폭주를 일으켜 해당 검증을 경량 단위 테스트로 분리했다. Database·Storage·마케팅 귀속·Cleaning Center Rules Emulator 통합 142/142 통과. Company-site field 테스트 50개 파일 통과/3개 skip·505 pass/132 skip, 필드 타입 검사 통과, Electron Node 전체 2,447 pass/0 fail/2 skip, Worker 137 pass. Company-site production build는 이전 검증 결과 통과(큰 클라이언트 번들 경고는 남음). 실제 Electron 39.8.10 main/preload/renderer 로컬 smoke는 사용자 승인 후 실행해 통과했으며 전체 desktop suite 2,447 pass/0 fail/2 skip도 재검증했다. 패키징된 NSIS 설치·업데이터 경로, 회사 Firebase 배포, 실제 CRM→TV 전파시간, 실데이터, 물리 TV 가독성은 미검증이다. TV 집계는 서버 write-through와 RTDB 이벤트 트리거 보조 경로를 둔다. Emulator에서 트리거가 로드되는 것은 운영 리전 전달이나 TV 전파시간 보증이 아니다. 운영 배포·스케줄 활성화·실데이터 입력은 하지 않았다.
- 운영 배포·스케줄 활성화·실데이터 입력은 하지 않았다.

- 최신 UI 회귀 확인(2026-09-26): 결과보고서 편집 접근 테스트 및 잠긴 보고서의 사진 링크/수정 컨트롤 분리 테스트 통과. 전체 desktop Node 테스트 2,450 pass / 0 fail / 2 skip. Electron main/preload/renderer smoke 통과. Windows x64 NSIS 설치 파일을 `--publish never`로 로컬 생성했으며, 파일은 [`BRING.CRM.Company.Setup.1.8.0.exe`](../../../desktop-crm/dist/BRING.CRM.Company.Setup.1.8.0.exe) (93.4 MB)이다. 생성만 검증했으며 자동 업데이트 피드나 GitHub Release에는 올리지 않았다.
- 긴급 후속(2026-09-27): 주문별 읽기 전용 상세 모달을 추가해 접수·고객/건물·견적·일정/배정·업무지시·결과/사진 수·상태 이력을 한 화면에서 확인하고 기존 CRM 레코드 화면으로 이동하게 했다. 작성자 UID는 표시하지 않고 사용자 텍스트를 HTML 이스케이프한다. 전체 desktop Node 테스트 2,463 pass / 0 fail / 2 skip, `node --check` 및 `git diff --check` 통과. 변경 반영판 NSIS x64 설치 파일은 `desktop-crm/dist-crm-urgent-check-v2/BRING.CRM.Company.Setup.1.8.0.exe` (97,945,832 bytes; SHA-256 `2E1B6208CB285F4327C122BE40351647A8C075299C10A5627CDF9800EF75B277`)이며 `--publish never`로 로컬 생성만 했다. 공식 업데이트 채널·GitHub Release·운영 Firebase에는 게시/배포하지 않았으며 회사 PC 설치 및 실제 계정 데이터/TV 검증은 미완료다. 운영 배포 게이트(`release/firebase-targets.json`의 `functionsDeploymentAllowed:false` 및 Cleaning Functions 보관 대상)가 유지 중이므로 승인 전에는 운영 반영하지 않는다.
- 기준자료 대조(2026-09-27): `BRING_Cleaning_Center_v1.0_Final_34_Screens`의 34개 PNG와 index를 목록화하고 화면별 MVP/기존 CRM 재사용/후속 미구현 범위를 [`2026-09-27-cleaning-34-screen-coverage-audit.md`](2026-09-27-cleaning-34-screen-coverage-audit.md)에 기록했다. 이 배포를 34개 화면 전체 구현이라고 표현하지 않는다. 주문 상세 참조 화면(06)을 시각 검토했으며, 현 MVP 모달은 접수·견적·연결 업무/보고·상태 이력을 빠르게 찾는 기능으로 한정한다.
- 주문 상세 보강(2026-09-27): 결과보고서 항목별 완료/일부/미수행 상태와 작업 전·후 사진 수, 수행률, 메모를 주문 상세에 연결해 표시한다. 상세 내용은 기존 결과보고를 참조하며 수정/저장 동작을 만들지 않는다. 테스트에서 HTML escaping과 비공개 actor UID 미노출을 확인했다. Desktop 전체 테스트 2,463 pass / 0 fail / 2 skip 및 NSIS 로컬 패키징 통과. 최신 검수용 패키지는 `desktop-crm/dist-crm-urgent-check-v3/BRING.CRM.Company.Setup.1.8.0.exe`이며 SHA-256은 `2D6A036B8B32227288B8A071BA82C2C164EC8B7E1FEF5D112948BF74C649A391`이다. `--publish never`; 운영 Firebase/업데이트 채널에는 반영하지 않았다.
- 다중 패키지 재검증(2026-09-27): desktop Node 2,463 pass / 0 fail / 2 skip; Functions 51 files / 1,253 tests 통과 및 TypeScript build 통과; TV Worker 140 tests 통과. 현재 개발 셸은 저장소 권장 Node 22가 아닌 Node 24.15.0이어서 엔진 경고가 발생한다. 이 검증은 운영 배포, Firebase Rules 실제 적용, 회사 실데이터 또는 실제 TV 지연 측정을 증명하지 않는다.

---

## 구현 경계와 현재 상태

- 기능 화면·상태 흐름은 [`../specs/2026-09-26-crm-cleaning-shared-platform-design.md`](../specs/2026-09-26-crm-cleaning-shared-platform-design.md)를 따른다.
- 현재 `desktop-crm/src/cleaning-center-ui.js`는 CRM 내부 클리닝센터 화면으로 요약 KPI·주문 목록·접수 흐름을 제공한다. 현장 결과보고서까지 연결되었다고 오인하지 않는다.
- 기존 CRM에는 고객·건물, `workOrders`, `serviceRecords`, `workReports`, `deliveryFlows`, 계약/청구 기능이 있다. 클리닝 주문을 기존 업무 데이터와 중복 저장하지 않도록 `cleaningOrderId` 참조를 우선 사용한다.
- 작업 트리에 이미 수정된 `desktop-crm/src/app.js`, `desktop-crm/src/index.html`, `desktop-crm/src/workspace-shell.js`, 신규 `cleaning-center-ui.js`, `cleaning-center.css`가 있다. 이 변경을 보존하고 필요한 부분만 좁게 수정한다.
- 운영 Firebase Rules/Functions, Cloudflare Worker, TV 운영 스케줄은 승인·출시 검수 전 배포하지 않는다.

## 파일 책임

- Create `functions/src/cleaning-orders/contracts.ts`: 주문 입력·저장 레코드·상태·오류 계약
- Create `functions/src/cleaning-orders/core.ts`: 순수 입력 정규화, ID 관계 검증, 상태 전이 결정
- Create `functions/src/cleaning-orders/runtime.ts`: canonical 연결 검증과 Firebase 트랜잭션·멱등 어댑터
- Modify `functions/src/index.ts`: 인증된 `cleaningOrdersApi`와 TV 집계 projection trigger
- Modify `database.rules.json`: 주문 직접 접근 차단, 업무지시의 주문 참조 검증, TV 집계 읽기 정책
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

- [x] **Step 1: 상태 계약의 실패 테스트 작성**

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

- [x] **Step 2: RED 확인**

Run: `pnpm --dir functions exec vitest run test/cleaning-orders.test.ts`
Expected: FAIL because `../src/cleaning-orders/core.js` does not exist.

- [x] **Step 3: 계약 및 최소 상태 결정 구현**

Define exact statuses `received`, `reviewing`, `quote_pending`, `approval_pending`, `scheduled`, `in_progress`, `review_pending`, `revision_requested`, `completed`, `cancelled`; use only current company roles `admin`, `member`, `viewer` in v1. `decideCleaningOrderTransition(from,to,role)` returns `{ok:true}` or `{ok:false,error}`. Encode allowed edges and role restrictions in a frozen transition table. `viewer` cannot mutate. Members may submit work to `review_pending`; only admins may mark `review_pending` as `completed`. Terminal `completed` and `cancelled` do not transition back. Do not grant a new external partner role in v1.

- [x] **Step 4: Verify GREEN and typecheck**

Run: `pnpm --dir functions exec vitest run test/cleaning-orders.test.ts`
Expected: all three transition tests PASS.
Run: `pnpm --dir functions run build`
Expected: TypeScript build succeeds.

- [x] **Step 5: Add contract validation tests before validators**

Test that create input rejects empty `requestId`, empty title, client-supplied status or audit fields, invalid date, unsupported service kind, and overlong free text. Test that a valid normalized input preserves canonical customer/building IDs; database existence is checked transactionally in Task 2.

## Task 2: Atomic server runtime and idempotency

**Files:**
- Create: `functions/test/cleaning-orders-runtime.test.ts`
- Create: `functions/src/cleaning-orders/runtime.ts`

- [x] **Step 1: Write RED runtime tests** for duplicate `requestId`, two concurrent updates with the same expected revision, missing/archived customer or building, and actor without write role.
- [x] **Step 2: Verify RED** with `pnpm --dir functions exec vitest run test/cleaning-orders-runtime.test.ts`.
- [x] **Step 3: Implement transaction adapter** that verifies active canonical customer/building records and their CRM relationship, then creates atomically at `crmCompany/cleaningOrders/{requestId}`. The UUID is order ID and idempotency key; no separate request-receipt tree is used.
- [x] **Step 4: Return the original saved result for a replayed identical `requestId`; reject the same key with a different normalized payload. Reject expected revision mismatch with a conflict.**
- [x] **Step 5: Verify runtime tests and run `pnpm --dir functions run test`.**

## Task 3: Authenticated Functions and Firebase Rules

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `database.rules.json`
- Modify: `functions/test/cleaning-orders-runtime.test.ts`

- [x] **Step 1: Add endpoint contract tests** for list permissions (`admin/member/viewer`), create/update permissions (`admin/member`), invalid auth, marketing-only member denial, unsupported action status, and request limits. V1 has no worker role or order assignee field; assigned-worker-specific access remains out of scope until an assignment model is approved.
- [x] **Step 2: Verify endpoint contract behavior.** A new invalid-action regression failed because it returned HTTP 503 despite an input-error body; after the mapping fix it returns HTTP 400. This is a regression RED/GREEN check, not a claim that the already-existing API route was implemented after these tests.
- [x] **Step 3: Add authenticated `cleaningOrdersApi`** using company access verification, verified email/UID binding, rate limiting, and Firebase Admin transactions. The one endpoint routes list/create/transition; no Admin credentials or client-writable order rules are exposed.
- [x] **Step 4: Deny direct reads/writes at `/crmCompany/cleaningOrders`; permit an enabled wallboard reader to read only `/crmCompany/wallboard/cleaningOperations`.**
- [x] **Step 5: Run focused tests, Functions typecheck, and database rules emulator tests.** Functions build/full suite pass; added emulator checks for raw-order denial and TV aggregate reader access (2/2). Report relationship-write and API end-to-end gates remain in Task 9.

## Task 4: Electron bridge and repository client

**Files:**
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/remote.js`
- Create: `desktop-crm/test/cleaning-center-orders.test.js`

- [x] **Step 1: Add failing tests** that the renderer API exposes only the narrow `loadCleaningOrders`, `createCleaningOrder`, and `transitionCleaningOrder` surface, and that the main/remote client forwards auth through the existing Firebase company API without exposing tokens to renderer payloads.
- [x] **Step 2: Run the focused desktop Node tests and confirm the new tests fail for missing methods.**
- [x] **Step 3: Add narrow IPC handlers and preload methods following existing trusted bridge patterns.** Keep input allowlists in main and errors structured for UI display.
- [x] **Step 4: Add remote client calls to `cleaningOrdersApi`; do not put order data into the broad `save(data)` payload.**
- [x] **Step 5: Run the focused tests and complete `npm --prefix desktop-crm test`.** Desktop full suite: 2,426 pass, 0 fail, 2 skipped.

## Task 5: Operational Cleaning Center UI

**Files:**
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/cleaning-center.css`
- Modify: `desktop-crm/test/cleaning-center-orders.test.js`

- [x] **Step 1: Add render tests** for empty/loading/error/list states, privacy-safe customer/building labels, create form validation, conflict display, and allowed transition actions.
- [x] **Step 2: Run the focused test and verify expected RED.**
- [x] **Step 3: Replace placeholder navigation-only content with an order queue and create flow while retaining the CRM folder/nav shell and access to existing CRM modules.**
- [x] **Step 4: Populate customer choices from CRM and restrict buildings to canonical buildings linked to that customer; repeat relationship validation on the server. Never create duplicate customer/building records.**
- [x] **Step 5: Use `api.loadCleaningOrders/createCleaningOrder/transitionCleaningOrder`; distinguish network, permission, and version errors, and retain the same UUID for an uncertain create retry.**
- [x] **Step 6: Verify focused rendering tests, all desktop tests, and a local Electron smoke flow using synthetic test records.** The installed Electron binary is unavailable pending install-script authorization, so the production renderer was additionally loaded in installed Chrome with a synthetic API bridge only. Browser smoke verified the real folder entry, linked-customer building restriction, service type starts unselected and must be chosen, failed create retains the form and retries with the same idempotency key, transition cancel makes zero API calls, and successful transition sends the expected revision/reason and refreshes the visible state. No company write API was called. Queue search/filter/pagination tests remain covered. Full desktop suite: 2,437 pass / 0 fail / 2 skipped.

## Task 6: Link orders to existing field work, evidence, and CRM timeline

**Files:**
- Modify: `desktop-crm/src/work-order-core.js`
- Modify: `desktop-crm/src/work-report-core.js`
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/test/work-order-core.test.js`
- Modify: `desktop-crm/test/work-report-core.test.js`

- [x] **Step 1: Add tests that a work order can optionally reference one `cleaningOrderId` and unrelated work without this reference behaves unchanged.**
- [x] **Step 2: Add and verify linked detail/timeline lookup tests.** Exact-ID lookups cover work orders and reports; unrelated and legacy records remain unlinked.
- [x] **Step 3: Add optional `cleaningOrderId` reference through the existing work-order save path and UI; do not clone customer/building fields or binary media into the order row.**
- [x] **Step 4: Render order history on CRM customer/building detail by reference.** Customer and building details link to the canonical cleaning order.
- [x] **Step 5: Run focused work-order/report tests and desktop full regression tests.** Focused tests pass 62/62; full desktop suite passes 2,422 tests with 0 failures (2 skipped).

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

- [x] **Step 1: Add tests to `functions/test/cleaning-orders-wallboard.test.ts` proving the projection contains only aggregate counts by status, overdue count, and update timestamp; assert customer names, phones, addresses, notes, order IDs, assignee identifiers, and evidence references are absent.**
- [x] **Step 2: Run `pnpm --dir functions exec vitest run test/cleaning-orders-wallboard.test.ts` and confirm expected RED before projection changes.**
- [x] **Step 3: Implement deterministic `buildCleaningWallboardProjection(orders, now)`; refresh the aggregate after authenticated order create/transition and retain a Firebase trigger as recovery path. Only aggregate fields are written; mutation responses report whether the immediate projection refresh succeeded.**
- [x] **Step 4: Update `database.rules.json` so only an enabled wallboard reader can read the projection path; deny direct reads/writes to raw orders and request receipts.** Emulator rules suite 3/3 passes.
- [x] **Step 5: Add the projection source to `crm-ai-worker/src/wallboard-server-refresh.js` through the existing verified TV reader credential; never grant TV access to raw orders.**
- [x] **Step 6: Add aggregate fields to the existing health scene and publication schema; preserve the last valid TV snapshot on source failure.**
- [x] **Step 7: Run `pnpm --dir functions run test`, `pnpm --dir functions run build`, `npm --prefix crm-ai-worker test`, and `npm --prefix desktop-crm test -- --test-name-pattern="wallboard"`; verify privacy, stale fallback, and existing scene rotation. Do not deploy or enable scheduled production refresh.** Full Functions (1,232), build, Worker (137), and latest full desktop regression (2,447 passed / 2 skipped), including TV-projection failure messaging, passed; no production deployment or scheduled refresh.

## Task 8: Ontology contract and documentation

**Files:**
- Create: `docs/ontology/bring-service-operations-v1.json`
- Create: `docs/ontology/README.md`
- Create: `functions/test/cleaning-ontology.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-crm-cleaning-shared-platform-design.md`

- [x] **Step 1: Add schema tests** requiring stable entity IDs, versioned statuses, allowed relationship endpoints, and Korean workflow-term mappings.
- [x] **Step 2: Run the ontology test and confirm RED for the missing Korean term mapping.** Test failed on absent `workflowTermMappings` before the mapping was added.
- [x] **Step 3: Define `Customer`, `Building`, `Space`, `CleaningOrder`, `Quote`, `WorkExecution`, `Evidence`, `Invoice`, `Receipt`, and existing `User`/`Partner` references; specify relationships and data sensitivity.**
- [x] **Step 4: Document that this contract is a vocabulary/schema reference, not a graph database and not a second source of truth.** Explicitly state that mapping labels does not claim historical persisted aliases and does not migrate records.
- [x] **Step 5: Verify schema tests and ensure code API/status constants match ontology version.** Ontology tests: 4/4.

## Task 9: Full regression and release gate

**Files:**
- Tests only, plus runbook updates if the verified release gate changes.

- [x] **Step 1: Run `pnpm --dir functions run test` and `pnpm --dir functions run build`.** 1,232 tests pass; TypeScript build succeeds.
- [x] **Step 2: Run the desktop Node tests, a local Electron smoke flow using synthetic test records, and Worker tests when its boundary changes.** Desktop Node suite: 2,432 pass, 0 fail (2 skipped). A prior local smoke verifies the cleaning-center route, local-only empty queue, and required intake form. This turn could not rerun Electron startup smoke because pnpm blocked Electron native dependency build scripts. Worker: 137/137.
- [x] **Step 3: Run Firebase database/storage rules emulator tests for denied direct writes and allowed authenticated Functions behavior.** Database, Storage, marketing attribution, and Cleaning Center rules: 142/142 pass with local emulators. Storage test isolation now uses its own demo project ID so parallel suite initialization cannot replace Storage emulator rules. Auth + Database + Functions demo-project emulator: authenticated create/list/transition, report/work-order link, TV projection, raw-order read denial, 205-row cursor pages, and persisted quote revision/review lifecycle all pass (3/3).
- [ ] **Step 4: Validate an end-to-end synthetic order across the user-operated CRM → Cleaning Center → field work/report → TV aggregate and compare every persisted ID/revision.** Authenticated Functions + Firebase Emulator now verifies the strict completion-evidence rejection and successful retry with a complete linked report, then freezes the report after completion and updates the privacy-safe TV aggregate. Existing coverage also checks create/list/transition, quote review, matching CRM work/report IDs, mismatch rejection, raw-order read denial, and cursor pagination. This is still synthetic/local evidence; the installed CRM with a real operator and the physical TV have not been exercised together, so keep this release gate open.
- [x] **Step 5: Verify diff includes no real customer data, secrets, production-only credentials, deployment, or unrelated cleanup.** Current diff check is clean; new/modified implementation paths contain no customer data or credential-like secrets; touched files are scoped to this approved feature. Existing CRLF normalization warnings are informational.
- [x] **Step 6: Report implemented vs unverified items separately; request a distinct production deployment approval after release checks.** This handoff and the implementation summary below explicitly distinguish local verification from production rollout, TV latency, real data, and on-device readability. Production deployment remains disabled pending its separate approval.
- [x] Add the TV Worker to the CRM CI path filters and run its test suite in an isolated Node 22 job, so changes to the server-side TV projection cannot bypass automated regression checks. Workflow YAML parsed successfully; the matching Worker test command passed 137/137.

## Task 10: Cursor-paginated order queue

**Files:** `functions/src/index.ts`, `functions/test/index-entrypoints.test.ts`, Electron preload/main/remote bridge, Cleaning Center UI, and `company-site/tests/field/cleaning-orders-functions-emulator.test.ts`.

- [x] API validates the paired timestamp/ID cursor, rejects malformed cursors, sorts descending by timestamp then ID, and returns at most 200 rows plus `hasMore`/`nextCursor`.
- [x] Electron forwards the cursor through the authenticated main-process bridge; the UI appends and de-duplicates pages while retaining search and status filters.
- [x] Authenticated emulator test covers 205 orders with identical timestamps plus an older existing order, proves no gaps/duplicates, and rejects malformed or incomplete cursors with HTTP 400.
- [x] Verification: endpoint contract 147/147; Functions suite 1,219/1,219 and build; emulator integration 2/2 including authenticated create/list/transition and cursor pagination through the main-process IPC handlers and `FirebaseRemoteClient`; desktop Node 2,432 pass/0 fail/2 skip; company-site field suite 504 pass/131 skip, typecheck and build.

## Progress and completion evidence

2026-09-26 update: still partial, not release-complete. Work orders and work reports can reference cleaning orders; CRM customer/building details show order history. Cleaning Center provides linked work-order drafting, queue text search, status filtering, 200-row cursor pagination, read-only permission guidance, and user-facing errors. Functions 1,219 tests/build, desktop Node 2,431 tests (2 skipped), Worker 137 tests, and company-site field tests/typecheck/build pass. Auth+Database+Functions emulator verifies create/list/transition, revision 1→2, same-building work-order/report persistence, invalid building-link denial, privacy-safe TV projection, raw-order client-read denial, and tied-timestamp pagination (2/2 integration tests). A prior Electron smoke used only local in-memory fixtures; it was not rerun because pnpm blocked native dependency build scripts. Ontology maps approved Korean workflow labels to canonical status IDs without claiming legacy persisted data or migrating records. Create/transition API refreshes TV projection after successful mutations; a Firebase trigger remains the recovery path. Production-region delivery, live CRM-to-TV propagation latency, approved real data, and physical-TV readability remain unverified. No production deployment, schedule activation, or operational-data changes were made.

The feature is complete only when all tasks pass, end-to-end synthetic flow and privacy assertions pass, existing CRM/field/billing/TV regression tests pass, and production deployment remains explicitly gated. A passing unit suite alone does not prove shared live data, TV propagation latency, Firebase production rules, or real-TV readability.

2026-09-26 verification addendum: the emulator integration now invokes the same `createCleaningOrderIpcHandlers` factory registered by Electron main and the actual `FirebaseRemoteClient` for authenticated create/list/transition and both pagination pages. Focused IPC tests pass 21/21; desktop Node suite is 2,432 pass / 0 fail / 2 skipped; company-site field typecheck passes; emulator integration passes 2/2. Electron binary is absent in the current checkout (`desktop-crm/node_modules/.bin/electron.cmd` exists but its `dist/electron.exe` does not), and install is gated by ignored native build scripts; do not bypass that gate.

Additional contract coverage: authenticated emulator e2e now replays identical create and transition requests through the Electron main IPC handler and verifies one persisted order/revision (create stays revision 1; transition stays revision 2). Integration suite remains 2/2.

## Task 11: CRM-styled order transition reason modal

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/src/cleaning-center.css`
- Modify: `desktop-crm/test/cleaning-center-orders.test.js`

- [x] Add a regression test proving the cleaning-order action opens a CRM modal with order title, current/next statuses, required reason, cancel/confirm buttons, and no `window.prompt` call in that action path.
- [x] Run the focused Node test and confirm it fails because the action currently calls `window.prompt`.
- [x] Replace only the cleaning-order transition prompt with the existing `#modal`/`#modalContent` flow; require a non-empty trimmed reason (max 500 characters); cancel, close, Escape, or backdrop dismissal must perform no API call.
- [x] On explicit form submit, retain the current `expectedRevision`/idempotent request behavior, call the same `api.transitionCleaningOrder`, refresh the queue, surface conflicts through existing toast handling, and close the modal without writing if canceled. Regression coverage asserts validation, stable request/revision forwarding, refresh only after a successful API response, error messaging, busy-state cleanup, and cancellation's shared close-only route.
- [x] Verify focused/full desktop tests and typecheck; keep the change limited to cleaning-order transitions and do not modify other existing browser prompts. (`node --test test/cleaning-center-orders.test.js` 26/26; full desktop suite 2,437 passed, 2 skipped; `company-site` field typecheck passed.) Chrome renderer smoke with a synthetic in-page bridge verified the folder-selection route, linked building filtering, explicit service type selection, same-key retry after a simulated create network failure, transition cancel-with-zero-API-calls, transition submit payload/revision, modal close, queue refresh, and updated status with no uncaught page errors.

2026-09-26 renderer smoke addendum: Electron itself remains unavailable because its executable is absent and its install script awaits user authorization. To increase coverage without installing it, the production `src/index.html`/renderer was served locally to the already-installed Chrome with a synthetic `window.bringCRM` bridge; no CRM or Firebase credentials, customer data, or writes were used. The test clicked the actual workspace Cleaning Center card, opened/canceled/reopened the real status modal, submitted a synthetic transition, and verified `expectedRevision: 1`, note, request ID, no write on cancellation, refresh/render to “검토 중”, closed modal, and zero uncaught renderer exceptions. This is renderer-only evidence, not a substitute for Electron preload/main or live Firebase/TV validation.

2026-09-26 intake validation addendum: detected and fixed a misclassification risk where the required service type defaulted to `move_in_cleaning`; it now starts blank and the form requires an explicit choice. The new regression test passed. A second Chrome renderer-only synthetic flow selected one customer, verified only that customer's canonical building was offered, simulated one create network failure, and verified the form remained open and the retry reused the exact same request ID and selected `move_out_cleaning`. Latest desktop Node suite: 2,437 passed / 0 failed / 2 skipped. `git diff --check` remains clean apart from existing CRLF normalization warnings. No operational data was changed.

## Task 12: Order detail and status audit visibility

- [x] Add a collapsed per-order detail panel using the canonical order ID, revision, creation/update timestamps, and server status history; keep it hidden for legacy rows without audit history.
- [x] Render status labels and escaped reason text; omit `changedByUid` from the employee-facing timeline to avoid exposing internal account identifiers.
- [x] Add compact responsive styles consistent with the existing CRM Cleaning Center; do not invent quote, assignment, invoice, or receipt values that are not yet stored on the order.
- [x] TDD verification: new regression failed on missing order details before implementation, then focused test 27/27 and full desktop suite 2,438 passed / 0 failed / 2 skipped.

## Task 13: Cleaning-order-linked field report draft

- [x] Add distinct report checklist templates for move-out, common-area, and general cleaning; preserve existing move-in, stairs, and special-cleaning templates.
- [x] Map the five Cleaning Center service types to explicit report templates. Unknown types return no mapping rather than silently defaulting to move-in.
- [x] Extend Drive folder classification for move-out/common/general reports so photo folders join the matching checklist keys; keep AI/photo classification review-only.
- [x] Add a pure draft factory that requires the exact canonical building ID, service type, and caller-supplied report ID; it returns a blank checklist draft linked by `cleaningOrderId`, with no fabricated photo evidence.
- [x] Add a Cleaning Center action available only while the order is `in_progress` or `revision_requested` and the current user can write reports. It opens the existing Work Reports editor; it does not save, upload, or advance the order automatically. It preserves an unrelated unsaved report draft and blocks navigation if that would overwrite work.
- [x] Extend the Firebase `workReports.kind` allowlist for all six report templates; Emulator Rules verified these accepted values and still rejects unknown kinds. `npm run typecheck:field` passed; `npm run test:rules` under Database Emulator: 133 passed / 5 skipped.
- [x] TDD/desktop regression: focused Cleaning Center, report-core, and photo-plan tests 75/75; full desktop suite 2,442 passed / 0 failed / 2 skipped.

## Task 14: Server-owned quote revisions and administrator review

**Files:**
- Create: `functions/src/cleaning-orders/quotes.ts`
- Create: `functions/test/cleaning-order-quotes.test.ts`
- Modify: `functions/src/cleaning-orders/firebase-adapter.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/test/index-entrypoints.test.ts`
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`
- Modify: `company-site/tests/field/cleaning-orders-rules.test.ts`

- [x] Add tests for bounded quote drafts, derived totals, canonical order/building links, member-only creation, retry idempotency, admin-only review, stale-revision conflicts, immutable appended revisions, and explicit separation from customer acceptance/billing. The asynchronous retry test also verifies review notes are snapshotted before entering the transaction.
- [x] Run `pnpm --dir functions exec vitest run test/cleaning-order-quotes.test.ts`; tests cover the intended contract and malformed/ineligible paths.
- [x] Implement pure quote command cores and persist append-only revisions beneath `crmCompany/cleaningOrderQuotes/{orderId}`; derive totals and bind the building ID from the validated stored order. Admin review appends an event separately from quote content.
- [x] Extend the Firebase adapter with parent-level transactions, expected-revision checks, request-ID idempotency, and revision/history limits. Raw client access remains denied; only authenticated Functions use Admin SDK.
- [x] Extend `cleaningOrdersApi` with authenticated quote list/create/admin-review actions. Quote actions do not refresh the TV projection or mutate billing. HTTP error codes distinguish validation, permission, and revision conflicts.
- [x] Add static database-rule assertions for client/TV direct access denial. The dedicated Rules Emulator cases are present, but were skipped in this run because the emulator was not started.
- [x] Run focused Functions quote/API tests, Functions TypeScript build, and full desktop regressions. Current verification: Functions 50 files / 1,232 tests pass; TypeScript build passes (Node 24 runtime warns package expects Node 22); desktop 2,447 pass / 0 fail / 2 skipped. No production deployment or data writes.

- [x] Connect the existing quote editor to order-linked draft save and administrator review controls through guarded Electron IPC. Cleaning Center shows revision/review status, permission/conflict feedback is surfaced, and internal approval is explicitly not customer acceptance. There is no customer auto-send or invoice/receipt creation.
- [x] Run the complete Firebase Rules Emulator suite before considering this release-ready: Database, Storage, marketing attribution, and Cleaning Center rules 142/142 pass.
- [x] Run a real Electron renderer + preload/main local smoke before considering this release-ready. After explicit user approval, restored only Electron 39.8.10 with `npm rebuild electron --prefix desktop-crm` and ran `npm run smoke --prefix desktop-crm`; the actual Electron main/renderer/preload path passed local-only Cleaning Center assertions using an isolated temporary profile. The packaged NSIS installer/updater path and production deployment remain unverified.

2026-09-26 quote/rules update: Functions full suite 1,232/1,232 and TypeScript build pass. Firebase Database + Storage + marketing attribution + Cleaning Center Rules Emulator suite 142/142 passes after isolating the Storage test's demo project ID from Database rules tests. Desktop full suite is 2,447 pass / 0 fail / 2 skipped. A newly detected quote-history gap was fixed: authorized CRM users can still open a saved quote after an order advances beyond quote review; a new revision is only offered while the order remains in quote_pending/approval_pending. Focused regression tests pass. The installed-Electron launch gate, production deployment, live CRM-to-TV latency, real-data verification, and physical-TV readability remain open.

2026-09-26 quote persistence/emulator update: An authenticated emulator test exposed two RTDB-specific cases that unit mocks had missed: empty arrays can be omitted and object-key order changes after persistence, and parent transaction callbacks may initially receive a null local snapshot. Quote equality now canonicalizes stored snapshots before comparing, and quote create/review transactions use the pre-read snapshot on the initial-null callback with revision guards retained. Red/green regressions pass (quote core 10/10; adapter 4/4). The authenticated Functions + Database emulator suite passed 3/3 at that point, including quote create/replay, member review denial, admin return, immutable next revision, and final approval through the same IPC bridge. This remains synthetic local evidence only; Electron executable/install gate, production deployment, CRM-to-live-TV latency, real data, and TV readability remain unverified.

2026-09-26 wallboard recovery update: API mutations already rebuild the aggregate synchronously; the RTDB trigger is recovery-only. Added a tested timestamp guard so delayed trigger events covered by a newer whole-source projection skip a duplicate root read/rebuild, and allow 10 concurrent freshness checks on a single recovery-trigger instance. Functions regression passes 50 files / 1,236 tests; TypeScript build passes (host Node 24 warns package expects Node 22). The first 205-row emulator fixture caused repeated trigger-start failures and downstream test timeouts. Moving the 206-row cursor-boundary case to the authenticated API unit test preserves end-to-end query, same-timestamp tie, and no-duplicate coverage without producing 205 synthetic RTDB trigger events. The remaining Auth+Database+Functions emulator flow passes 2/2 (normal order create/update/projection and quote create/replay/review). Keep bulk-import trigger delivery and production-region propagation unverified until a real service test is approved. No production deployment or real-data writes were performed.

2026-09-26 CI update: Added the authenticated cleaning-order + TV aggregate Functions/Database/Auth Emulator integration suite to the backend-and-rules CI job on the isolated `demo-bring-cleaning-functions` project. Workflow YAML parses; latest local equivalent passes 2/2. Production services, credentials, and data are not used by this check. The >200-row pagination/timestamp tie-boundary test runs in the Functions unit suite.

2026-09-26 Electron smoke update: With explicit user approval, installed the pinned Electron binary only (no full `npm ci`) and ran the actual desktop app smoke. `npm run smoke --prefix desktop-crm` exited 0 and reported `ready`, `initialized`, `cleaningCenterSmoke.pass`, `localOnly: true`; this exercised the Electron main/preload/renderer flow with synthetic customer/building fixtures and the isolated temp profile. The full desktop suite then passed 2,447 tests with 2 skipped. No company Firebase, production endpoint, or real customer data was used.

2026-09-26 Windows package check: Built `desktop-crm/dist/BRING.CRM.Company.Setup.1.8.0.exe` with `npm run build:win --prefix desktop-crm -- --publish never`; electron-builder exited 0 and produced the NSIS installer plus `win-unpacked` app. The unpacked app launched with `BRING_CRM_SMOKE=1`, exited 0, and created the isolated temp profile. The NSIS installer itself was not run/installed, and no release was published.

## Task 15: Server-enforced cleaning completion evidence

- [x] Add shared service-type → field-report checklist contracts for move-in, move-out, common-area, stairs, and general cleaning; verify keys against the CRM's existing report templates.
- [x] Reject administrator `review_pending → completed` unless a linked report matches order ID, building ID, service/report kind, and current work attempt; require each service checklist key, before+after Drive references for every `done` item, a reason for every `skipped` item, and at least one performed item. Existing CRM rules allow `partial` without photos, so keep that behavior consistent.
- [x] Close the verification/edit race by freezing report creation, edits, and unlinking while the order is `review_pending` or `completed`; unlock on `revision_requested`, then require a fresh work attempt and re-verify evidence on resubmission.
- [x] Protect validation evidence: index `workReports.cleaningOrderId`, cap the Functions lookup at 50 records, and use Firebase Rules to reject edits, new links, and unlinking on an order under review or completed.
- [x] Surface a Korean actionable CRM message for the server precondition and map it to HTTP 409. Rejection writes no order status/revision/history.
- [x] Verify red/green helper/runtime tests, Database Rules Emulator freeze/unfreeze tests, and authenticated Functions + Auth/Database Emulator: incomplete evidence rejected with no revision change, review freezes the report, returned revisions unlock it, a fresh work attempt permits resubmission, complete evidence permits completion, TV aggregate reflects it, and post-completion edits fail.
- [ ] Real Firebase release, real CRM user/order/report verification, physical TV propagation/readability, and production deployment remain gated; no deployment performed.

2026-09-26 completion-evidence verification addendum: Functions full suite 1,243/1,243 and TypeScript build passed; desktop full suite 2,448 pass / 0 fail / 2 skipped; Cleaning Center Rules Emulator 5/5; authenticated Functions + Auth/Database Emulator 2/2. Local e2e proved reject-before-write and successful completion after checklist/photo evidence is saved, plus report freeze and aggregate update. This remains synthetic emulator evidence only; no production Firebase/Worker deployment or live TV validation was performed.

2026-09-26 race-hardening addendum: review found that checking a valid report and freezing it only after completion left a narrow report-edit race during administrator review. Firebase Rules now lock linked reports from `review_pending` through `completed`, but release the lock in `revision_requested`; integration coverage returns an incomplete report for revision, resumes a new work attempt, updates evidence, and completes only after the second review request. The rules regression first reproduced the missing lock (RED), then passed after the rules change (GREEN). Re-run the combined emulator/typecheck suite before the next handoff.

2026-09-26 latest local release verification: desktop Node suite 2,450 pass / 0 fail / 2 skipped; `npm run smoke` passed the Electron main/preload/renderer path with synthetic local-only fixtures; Windows x64 NSIS installer built locally with `--publish never` (93.4 MB, not installed or published). Functions suite 1,243/1,243 and TypeScript build pass (host Node 24.15.0 warns package targets Node 22); Worker suite 137/137 pass; company-site field typecheck passes and field suite 505 pass / 132 skipped. After the race-hardening change, authenticated Functions + Auth/Database Emulator flow passes 2/2 and Cleaning Center Database Rules tests pass 5/5. Test emulators were stopped. `git diff --check` exits 0 with only existing CRLF-normalization notices. Remaining release gate is actual company Firebase/Worker deployment plus real CRM-user and physical-TV validation; no operating data or production services were changed.

2026-09-26 completion evidence trust hardening: closed a validation gap found in review. Server completion now requires before/after evidence links to exact HTTPS `drive.google.com` or `docs.google.com` hosts (not arbitrary HTTPS or lookalike domains); the desktop report model applies the same host rule, and the editor marks absent/invalid links as needing verification rather than rendering a dead/unsafe link. Added actionable completion-block guidance and regression coverage. Fresh verification: desktop suite 2,452 pass / 0 fail / 2 skipped; Functions suite 1,244/1,244 and TypeScript build pass (Node 24 host warning remains); Database Rules Emulator 6/6; authenticated Auth/Database/Functions Emulator flow 2/2; company-site field typecheck passes; Electron smoke passes; Windows x64 installer rebuilt locally via `--publish never` (not installed or published); `git diff --check` exits 0 with CRLF notices only. Production deployment and real-account / physical-TV validation remain release-gated.

2026-09-26 CI integration execution fix: audit showed the authenticated emulator test was silently skipped unless all three emulator-host environment variables were present, while CRM CI supplied only the Functions host. Added a regression check that failed before the fix, then added explicit Auth (`127.0.0.1:9099`) and Database (`127.0.0.1:9000`) hosts alongside Functions (`127.0.0.1:5001`) in the emulator job. Confirmed the suite now executes rather than skips and passes 2/2 on local Auth/Database/Functions emulators. Fresh full desktop suite: 2,453 pass / 0 fail / 2 skipped. No production or GitHub workflow run was triggered from this checkout.

2026-09-26 cross-repository regression sweep: Functions 1,244/1,244 plus TypeScript build passed; CRM Worker 137/137; company-site typecheck and build passed; FIELD suite 505 passed / 133 skipped; Database + Storage + marketing Rules Emulator suite 138/138 passed; authenticated Cleaning Center Auth/Database/Functions Emulator flow 2/2 passed. An initial full FIELD run overlapped typecheck/build and hit one 5-second KPI-test timeout; focused KPI test passed in 0.9 seconds, and the full suite passed when rerun without competing jobs (36.96 seconds). This is recorded as a local resource-contention observation, not a product-code change. The site build reports an existing >500 kB client-chunk warning and dynamic-route-classification notice. No production or GitHub writes were made.

2026-09-26 production-client report-path hardening: strengthened authenticated emulator E2E to save the linked work order and work report through the CRM's actual `FirebaseRemoteClient` methods, with requests hard-fenced to loopback Auth/Database/Functions emulators. This reproduced a Firebase Rules mismatch: the normalized CRM report always includes `category`, `categoryEtc`, `ownerContact`, and `followUp`, while the report rules rejected those legitimate fields. Added bounded validators and an enum allowlist matching `WorkReportCore`; the integration test now verifies these fields persist and that incomplete evidence blocks completion until a verified report is submitted. Auth/Database/Functions emulator integration plus Cleaning Center Rules: 8/8 passed; `npm run typecheck:field` passed; report-core/wiring desktop tests 42/42 passed; `git diff --check` exits 0 with CRLF notices only. No production Firebase, Worker, GitHub, or user operational data was changed. The actual installed CRM and physical TV remain unverified; Task 9.4 / release gate stays open.

2026-09-26 post-fix full local regression: desktop suite 2,453 passed / 0 failed / 2 skipped; Functions suite 1,244/1,244 and TypeScript build passed; company-site field suite 505 passed / 133 skipped; field typecheck passed; TV Worker 137/137; authenticated Auth/Database/Functions + Cleaning Center Rules focused emulator checks 8/8. Host Node is 24.15 while the Functions package targets Node 22, so the existing engine warning remains; the bundled runtime is also Node 24.19. No production deployment, live CRM account, or physical TV test was performed. Production and human-operated validation remain open.

2026-09-26 current Electron local smoke: launched the actual Windows Electron binary in a hidden window with `BRING_CRM_SMOKE=1`; exit code 0. The real main/preload/renderer path opened the Cleaning Center, verified the local-only empty queue and required intake fields, constrained building choices to the selected synthetic customer, and closed the form without a write. Output explicitly reported `localOnly: true` and `fixtureOnly: true`; no company account, Firebase production endpoint, or customer data was used. This does not satisfy the user-operated production/physical-TV release gate.

2026-09-26/27 review hardening addendum: Read-only code review found four issues and the fixes are included in the current uncommitted branch: completion checks photo IDs against live Google Drive metadata (matching, non-trashed image files), requires each view link to identify that same Drive file, and requires distinct before/after photos; overlapping TV refreshes publish via freshness-guarded RTDB transaction; historical linked reports fetch their exact order before permitting edits; and committed quote retries replay even after the order advances. Drive verification fails closed in production if OAuth/API checks fail; only the isolated Functions Emulator treats synthetic fixture IDs as verified. TDD red/green coverage was added for the fixes. Final verification: Functions 1,250/1,250 plus TypeScript build; desktop 2,455 passed / 0 failed / 2 skipped; authenticated Auth/Database/Functions emulator flow 2/2; `git diff --check` exits 0 with line-ending normalization notices only. No production data, GitHub, or deployment was touched. Local code/test work is complete; release remains gated on live CRM/physical-TV propagation checks and separate deployment approval.

2026-09-27 fresh local release verification: Functions suite 1,250/1,250 and TypeScript build pass (host Node 24.15.0 emits the existing Node 22 engine warning); desktop suite 2,455 passed / 0 failed / 2 skipped; TV Worker suite 137/137; source Electron smoke and the packaged Windows x64 app smoke both exit 0 using synthetic/local-only fixtures. Rebuilt `desktop-crm/dist/BRING.CRM.Company.Setup.1.8.0.exe` locally (97,940,432 bytes) with publishing disabled. This confirms a local installer artifact only; it was not installed on a company PC, uploaded, or published. No production Firebase/Worker writes or GitHub changes were made. Live operator CRM → physical-TV propagation/readability and a separately approved production release remain open.

2026-09-27 authenticated emulator recheck: the Auth + Database + Functions integration test passed 2/2 against loopback emulators using the `demo-bring-cleaning-functions` project; it exercises authenticated order creation, work/report linkage, evidence-gated completion, and the TV aggregate. The default Vitest fork worker exited unexpectedly when nested under `emulators:exec` on this Windows host; running the same test against the already-running emulators with `--pool=threads --maxWorkers=1` passed. Emulator processes were stopped afterward. No production deployment or write was performed.

2026-09-27 assignment-gated scheduling follow-up: added server-side fail-closed validation before `approval_pending → scheduled`: a canonical CRM work order must match both cleaning-order and building IDs, be `assigned`, include a valid assignee UID, and have a valid ISO due date. The Firebase adapter queries the shared `crmCompany/workOrders` collection by indexed `cleaningOrderId`. The CRM now allows admins to create the linked assignment from approval-pending, routes through the existing work-order editor, and gives a clear next step if scheduling is attempted before assignment. TDD coverage includes reject-with-no-write, successful assigned scheduling, adapter query path, and UI visibility. Fresh Functions suite 1,253/1,253 + TypeScript build; desktop full suite 2,458 passed / 0 failed / 2 skipped; TV Worker 140/140; Database Rules Emulator cleaning suite 6/6. No production deployment, release publication, customer data or TV validation was performed. The official release workflow still targets `codex/bring-field-platform` while this branch is `codex/cleaning-center`; production Functions/Rules are undeployed. Tomorrow's installed CRM cannot use this work until branch/release alignment, explicit deployment approval, official release, and company-PC/TV smoke verification are completed.

2026-09-27 roadmap executive-panel update: the CRM roadmap now places its board beside a compact right-side performance panel, matching the requested dashboard structure. It shows average progress for active projects with explicitly recorded progress, work-order review completion rate, unique project counts by active/paused/done status, and the three nearest open work-order deadlines. Missing, loading, and failed aggregates are not rendered as 0%. Board overflow scrolls within its own panel; narrow widths stack the panels. Verification: focused roadmap suite 13/13; full desktop suite 2,459 passed / 0 failed / 2 skipped; actual Electron synthetic preview screenshot captured at 1540×940 logical window and confirmed 4 performance cards, nonzero panel width, detail visible, and one un-repeated today marker. Preview used synthetic data only. No release publication or production deployment.

2026-09-27 Cleaning Center tomorrow-readability update: added six clickable order-stage indicators (intake/review, estimate/approval, scheduled, in progress, review/revision, completed) and a separate overdue filter, all derived only from the canonical Cleaning Center orders already loaded from the authenticated server. The dashboard explicitly marks partial-page scope, distinguishes loading/error/empty states instead of inventing zeroes, and labels its scope as cleaning orders rather than revenue or company-wide workload. Existing cross-CRM count cards remain available under a collapsed “existing CRM connections” disclosure. TDD: focused Cleaning Center suite 42/42; full desktop suite 2,460 passed / 0 failed / 2 skipped (run after implementation; later test-only assertion also passed in focused suite). `node --check` passed for app.js and cleaning-center-ui.js. No production deploy, release publication, company data read, or TV verification. Until official branch alignment, approved release, and live PC/TV smoke checks, this remains in source/local work only and is not confirmed on the installed CRM or physical TV.

2026-09-27 urgent tomorrow-use preparation: strengthened the Electron local-only smoke to require all six Cleaning Center order-stage cards and the true “confirmed total 0 orders” scope in addition to queue/intake/linkage checks. Source smoke passed; then rebuilt and launched the packaged Windows x64 app with the same synthetic-only checks, all passing (`cleaningStageCardCount: 6`, `emptyQueueScopeVisible: true`, exit 0). Windows NSIS installer is `desktop-crm/dist/BRING.CRM.Company.Setup.1.8.0.exe` (97,944,480 bytes), rebuilt with publishing disabled. Full desktop suite 2,460 passed / 0 failed / 2 skipped. This file remains a local, uninstalled artifact; it was not uploaded, installed on a company PC, published via the update channel, or validated with the live CRM/TV. Production release remains blocked pending explicit deployment approval and release-branch alignment.

2026-09-27 KPI fidelity correction: matched the Cleaning Center seven-item management summary in the approved design: intake/review, quote/approval, scheduled/in-progress, review pending, revision requested, completed, and overdue. Overdue is now a first-class card, defined as non-completed/non-cancelled orders with a valid desired date before today; the UI discloses overlap with status buckets. Dashboard stage cards continue to derive solely from loaded canonical orders, and their click filters use the same status buckets. Added regression expectations first (RED reproduced the old combined buckets), then implemented. Cleaning Center suite 42/42; full desktop suite 2,460 passed / 0 failed / 2 skipped; source Electron smoke passes all seven cards; rebuilt x64 NSIS installer and ran the packaged app in isolated local-only mode, which reports `cleaningStageCardCount: 7`, `emptyQueueScopeVisible: true`, and exit 0. Updated the design spec to pin these definitions. The artifact is still not installed/published and Firebase/TV production behavior remains unverified.

2026-09-27 urgent validation follow-up: added a repeatable screenshot action for the existing CRM Cleaning Center and verified the packaged rendering has all seven stage cards, truthful confirmed-order scope, and last-refresh time. Visual evidence: `%TEMP%/bring-cleaning-center-packaged.png` (synthetic local profile only). Changed the wide layout to seven columns, four columns below 1300px, then three/two at narrower breakpoints. Cleaning Center tests 43/43; full desktop suite 2,461 passed / 0 failed / 2 skipped. The normal `dist/win-unpacked` build hit an EPERM rename lock in the OneDrive-synced output folder, so built successfully to the separate `dist-crm-urgent-check` output instead; Windows x64 NSIS installer was generated with publishing disabled, and its packaged UI screenshot action exited 0 with `cleaningStageCardCount: 7`, empty confirmed queue scope, refresh time visible. This remains synthetic local evidence: no official release-branch alignment, update-channel publication, installation on an employee PC, company-data order check, Functions/Rules production deployment, TV synchronization or physical TV check has happened. Do not describe tomorrow's live operation as ready until those release and production gates are explicitly authorized and verified.

2026-09-27 roadmap visual recheck: existing CRM weekly and daily timeline screenshot actions both pass with one today marker, selected-project detail, four performance cards, and no modal/overlapping repeated today markers; daily axis contains eight consecutive dates. Evidence files: `%TEMP%/bring-roadmap-final-review.png` and `%TEMP%/bring-roadmap-day-review.png`; both use synthetic local test data and are not installed/live screenshots.

2026-09-27 cross-component verification: Functions full suite 51 files / 1,253 tests pass and TypeScript build succeeds (host Node 24 vs project Node 22 warning). Cleaning rules emulator: 6/6 pass; authenticated Auth+Database+Functions emulator flow: 2/2 pass with demo-only customer/building/order, covering server API and TV projection. Worker direct Node suite 140/140 pass; `pnpm test` itself could not start because pnpm policy blocks ignored `esbuild`/`workerd` install scripts, so tests were executed directly against the already-present runtime. Emulator startup attempted Secret Manager reads for the *demo project* and received 403 before any secret value was returned; no production Firebase records were read or written. `git diff --check` and JavaScript syntax checks pass. The authenticated emulator proof is still not production proof. Release branch currently diverges (local `codex/cleaning-center` is 2 commits ahead/3 behind its configured remote) and retains broad uncommitted CRM/Functions/Worker edits; do not publish that worktree wholesale without a deliberate release review.

2026-09-27 resumed-plan verification: re-ran the desktop suite (2,463 passed / 0 failed / 2 skipped), Functions suite (1,253/1,253), Functions TypeScript build, FIELD typecheck, and TV Worker suite (140/140). Re-ran the authenticated Auth/Database/Functions emulator flow (2/2) and Cleaning Center Rules Emulator (6/6), both with demo-only project IDs. The local NSIS installer in `desktop-crm/dist-crm-urgent-check-v3/BRING.CRM.Company.Setup.1.8.0.exe` remains byte-identical to the previously smoke-tested artifact (SHA-256 `2D6A036B8B32227288B8A071BA82C2C164EC8B7E1FEF5D112948BF74C649A391`) and was built after the latest source timestamp; it is still unpublished and not installed on a company PC. No production Firebase, Worker, GitHub, or customer data was changed. The primary release manifest and bootstrap tests still intentionally prohibit Functions deployment; official update-channel release, production Functions/Rules, real account verification, and physical TV propagation remain outstanding.

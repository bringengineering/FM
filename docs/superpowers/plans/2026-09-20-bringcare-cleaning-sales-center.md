# BRING CARE Cleaning Sales Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 기존 BRING CRM 안에서 청소 문의부터 견적·예약·배차·현장보고·QC·결제·CS까지 한 흐름으로 관리하는 Cleaning Sales Center를 구축한다.

**Architecture:** 기존 공유 저장소와 저장 경계를 확장해 청소 주문 컬렉션을 추가하고, 순수 도메인 모듈이 상태·가격·검증·KPI를 담당한다. UI 모듈은 도메인 데이터만 받아 화면을 렌더링하며 app.js가 기존 권한·저장·감사 흐름과 연결한다.

**Tech Stack:** Electron, vanilla JavaScript, HTML/CSS, Node test runner.

---

### Task 1: 청소 주문 도메인

**Files:**
- Create: desktop-crm/src/cleaning-core.js
- Create: desktop-crm/test/cleaning-core.test.js

- [ ] **Step 1: Write the failing domain tests**

Test the approved order stages, normalization, no-on-site-surcharge invariant, quote arithmetic, status transition validation, QC gate, message template variables, and KPI calculation.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/cleaning-core.test.js
Expected: FAIL because cleaning-core.js does not exist.

- [ ] **Step 3: Implement the domain API**

Export CLEANING_ORDER_STAGES, normalizeCleaningOrder, validateCleaningOrder, createCleaningOrder, transitionCleaningOrder, calculateCleaningQuote, calculateCleaningKpis, and renderMessageTemplate through CommonJS and window.BringCleaningCore.

- [ ] **Step 4: Run test to verify it passes**

Run: node --test test/cleaning-core.test.js
Expected: PASS.

### Task 2: 공유 저장소 연결

**Files:**
- Modify: desktop-crm/src/core.js
- Modify: desktop-crm/src/remote.js
- Modify: desktop-crm/src/app.js
- Create: desktop-crm/test/cleaning-store-integration.test.js

- [ ] **Step 1: Write failing integration tests**

Assert cleaningOrders, cleaningDispatches, cleaningReports, cleaningQcReviews, cleaningMessages, and cleaningPartners exist in defaults, normalization, shared rebase, pending sync, and remote collections.

- [ ] **Step 2: Run test and verify the expected failure**

Run: node --test test/cleaning-store-integration.test.js

- [ ] **Step 3: Add the six collections without changing existing schemas**

Add empty defaults, array normalization, shared-store collection registration, pending collection registration, and remote collection registration.

- [ ] **Step 4: Run integration and existing storage tests**

Run: node --test test/cleaning-store-integration.test.js test/sales-pending-compat.test.js test/field-canonical-crm.test.js

### Task 3: Cleaning Sales Center UI

**Files:**
- Create: desktop-crm/src/cleaning-ui.js
- Create: desktop-crm/src/cleaning.css
- Create: desktop-crm/test/cleaning-ui.test.js
- Modify: desktop-crm/src/index.html

- [ ] **Step 1: Write failing UI contract tests**

Test the dashboard KPI cards, 15-stage pipeline, order cards, no-site-surcharge notice, quick filters, empty state, and accessible labels.

- [ ] **Step 2: Run and verify failure**

Run: node --test test/cleaning-ui.test.js

- [ ] **Step 3: Implement pure renderers and load assets**

Implement renderCleaningCenter and renderCleaningOrderDetail, add the 청소센터 navigation button, load cleaning-core.js and cleaning-ui.js before app.js, and load cleaning.css.

- [ ] **Step 4: Run UI tests**

Run: node --test test/cleaning-ui.test.js

### Task 4: CRM 화면·신규 주문 연결

**Files:**
- Modify: desktop-crm/src/app.js
- Create: desktop-crm/test/cleaning-app-integration.test.js

- [ ] **Step 1: Write failing app integration tests**

Verify navigation, renderCleaningCenter, a labeled order form, save through scheduleSave, order detail opening, status transition, QC recording, and audit logging.

- [ ] **Step 2: Run and verify failure**

Run: node --test test/cleaning-app-integration.test.js

- [ ] **Step 3: Wire UI to the existing app lifecycle**

Add view metadata, render switch, search behavior, query restoration, order editor, submit handler, transition handler, and order detail drawer. Reuse signed-in actor, scheduleSave, logAudit, modal, drawer, and toast helpers.

- [ ] **Step 4: Run app integration tests**

Run: node --test test/cleaning-app-integration.test.js

### Task 5: Automated messages and operational gates

**Files:**
- Modify: desktop-crm/src/cleaning-core.js
- Modify: desktop-crm/src/cleaning-ui.js
- Modify: desktop-crm/src/app.js
- Modify: desktop-crm/test/cleaning-core.test.js
- Modify: desktop-crm/test/cleaning-app-integration.test.js

- [ ] **Step 1: Add failing tests**

Test template rendering for missed call, quote, deposit, reminder, dispatch, arrival, QC completion, balance, complaint, and rework. Test that final completion cannot occur without a passed QC review.

- [ ] **Step 2: Run and verify failure**

Run: node --test test/cleaning-core.test.js test/cleaning-app-integration.test.js

- [ ] **Step 3: Implement templates and gates**

Add the approved message catalog, required variables, message preview, message log creation, and QC completion protection.

- [ ] **Step 4: Run focused tests**

Run: node --test test/cleaning-core.test.js test/cleaning-app-integration.test.js

### Task 6: Full verification

**Files:**
- Modify only if verification finds a defect.

- [ ] **Step 1: Run all tests**

Run: npm test
Expected: all tests pass.

- [ ] **Step 2: Run Electron smoke**

Run: npm run smoke
Expected: CRM initializes with the cleaningCenter view available and no renderer exception.

- [ ] **Step 3: Inspect the diff**

Run: git diff --check and git status --short.
Expected: no whitespace errors and only intended files changed.

## Self-review

- Spec coverage: order lifecycle, no-site-surcharge promise, pricing arithmetic, dispatch, field report, QC, messages, Partner link, KPI, audit, storage, navigation, and mobile-compatible markup are assigned to tasks.
- Placeholder scan: implementation steps specify exact behaviors and files; no undefined future task is required for phase-one operation.
- Type consistency: all modules use cleaningOrderId as the durable relation key and the six named cleaning collections consistently.

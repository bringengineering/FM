# Customer Save Permission Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 기본정보 저장이 마케팅 전용 필드를 변경하지 않아 Firebase `Permission denied` 없이 서버에 저장되게 한다.

**Architecture:** 고객 기본정보 폼과 마케팅 전용 폼의 책임을 분리한다. 일반 고객 저장은 기존 마케팅 객체를 그대로 두고, 마케팅 변경은 기존 전용 CAS API만 사용한다.

**Tech Stack:** Electron, browser JavaScript, Node.js test runner, Firebase Realtime Database Rules

---

### Task 1: 고객 기본 저장에서 마케팅 변경 제거

**Files:**
- Modify: `desktop-crm/src/app.js`
- Test: `desktop-crm/test/customer-building-management.test.js`

- [ ] **Step 1: 실패하는 회귀 테스트 작성**

`customerFromForm`에 `customer.marketing = parseMarketingAttribution(raw)`가 없고, 일반 `customerForm` HTML에 `marketingAttributionFields`가 없음을 검사한다.

- [ ] **Step 2: 실패 확인**

Run: `node --test test/customer-building-management.test.js`
Expected: 고객 기본 폼이 아직 마케팅을 대입하고 렌더링하므로 FAIL.

- [ ] **Step 3: 최소 구현**

`customerFromForm`의 마케팅 대입 한 줄과 일반 고객 추가정보 영역의 `marketingAttributionFields(customerMarketing)`를 제거한다. `customerMarketingForm`과 전용 API는 유지한다.

- [ ] **Step 4: 집중 테스트와 전체 테스트**

Run: `node --test test/customer-building-management.test.js test/marketing-attribution-boundary.test.js test/marketing-entry.test.js`
Expected: PASS.

Run: `npm test`
Expected: 모든 테스트 PASS.

- [ ] **Step 5: 앱 실행·빌드 검증**

Run: `npm run smoke`
Expected: `ready:true`, `syncStatus:"connected"`인 JSON 출력.

Run: `npm run build:win -- --publish never`
Expected: Windows NSIS 설치본 생성, exit 0.

- [ ] **Step 6: 커밋·운영 반영·실사용 확인**

변경을 커밋하고 `codex/bring-field-platform`에 fast-forward push한다. 자동 릴리스 성공 후 설치 앱을 업데이트하고 동일 고객의 수정 저장을 눌러 오류가 사라지고 서버 연결 표시가 정상으로 돌아오는지 확인한다.

# CRM Work Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CRM-native work management dashboard that reliably shows the confirmed mowing work and planned weekly stair-cleaning contract from the shared server.

**Architecture:** Keep `serviceRecords`, `serviceContracts`, and `serviceSchedules` in the existing shared Firebase store. Add a pure work-management view-model/UI module, mount it as a first-class CRM navigation view, and route all writes through the existing shared PATCH save flow. Building detail reuses the same normalized selectors so the dashboard and building page cannot disagree.

**Tech Stack:** Electron 39, vanilla JavaScript, HTML/CSS, Node test runner, Firebase Realtime Database REST client.

---

## File map

- Create `desktop-crm/src/work-management.js`: pure normalization, filtering, KPI, and safe HTML rendering.
- Create `desktop-crm/test/work-management.test.js`: dashboard model and rendering behavior.
- Modify `desktop-crm/src/index.html`: load module and add sidebar view button.
- Modify `desktop-crm/src/app.js`: view state, rendering, filters, detail modal, create/update handlers, evidence opening.
- Modify `desktop-crm/src/styles.css`: CRM-native dashboard, cards, filters, responsive layout.
- Modify `desktop-crm/src/service-operations-ui.js`: reuse canonical work selectors for building detail.
- Modify `desktop-crm/test/service-operations-ui.test.js`: prevent dashboard/building-detail divergence.
- Modify `desktop-crm/test/company-release.test.js`, `desktop-crm/package.json`, and `desktop-crm/package-lock.json`: ship as version 1.8.0 after verification.

### Task 1: Canonical work-management view model

**Files:**
- Create: `desktop-crm/src/work-management.js`
- Create: `desktop-crm/test/work-management.test.js`

- [ ] **Step 1: Write the failing model test**

```js
test("builds separate completed-cost and recurring-cost KPIs", () => {
  const model = WorkManagement.buildModel(store, { month: "2026-08", today: "2026-08-17" });
  assert.equal(model.kpis.completed, 1);
  assert.equal(model.kpis.planned, 1);
  assert.equal(model.kpis.completedCost, 150000);
  assert.equal(model.kpis.recurringMonthlyCost, 60000);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/work-management.test.js`

Expected: FAIL because `../src/work-management` does not exist.

- [ ] **Step 3: Implement bounded normalization and KPI functions**

Export `normalizeRecord`, `normalizeContract`, `buildModel`, `filterItems`, `renderDashboard`, and `renderWorkDetail`. `buildModel` must keep completed work cost separate from planned monthly contract cost and synthesize a read-only planned card for a contract without a schedule.

- [ ] **Step 4: Add invalid/missing-server-state tests**

```js
test("does not label an unavailable server payload as an empty work list", () => {
  const model = WorkManagement.buildModel(null, { available: false });
  assert.equal(model.available, false);
  assert.match(WorkManagement.renderDashboard(model), /동기화 확인 필요/);
});
```

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test test/work-management.test.js`

Expected: all work-management tests PASS.

Commit: `git commit -m "feat(crm): add work management view model"`

### Task 2: First-class CRM navigation and dashboard

**Files:**
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Test: `desktop-crm/test/work-management.test.js`

- [ ] **Step 1: Add a failing navigation integration test**

Assert that `index.html` contains one `data-view="work-management"` button, loads `work-management.js` before `app.js`, and `app.js` renders `WorkManagement.renderDashboard(...)` for that view.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/work-management.test.js`

Expected: FAIL because the menu and app routing are absent.

- [ ] **Step 3: Add the dashboard route**

Add a sidebar item labeled `작업관리`, page title `작업관리`, action `＋ 새 작업`, and a render branch that passes shared store data, active filters, selected building, and current permissions to the pure renderer.

- [ ] **Step 4: Add CRM-native responsive styling**

Implement KPI cards, a left filter panel, readable work cards, status badges, and a single-column layout below 900px. Use existing CSS variables and preserve WCAG-readable text contrast.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test test/work-management.test.js`

Expected: navigation and dashboard tests PASS.

Commit: `git commit -m "feat(crm): add work management dashboard"`

### Task 3: Work detail and safe shared-store mutations

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/work-management.js`
- Test: `desktop-crm/test/work-management.test.js`

- [ ] **Step 1: Add failing permission and mutation tests**

Test that viewer markup has no create/edit/complete actions, while admin/member actions create closed `serviceRecords` values and call the existing `scheduleSave()` path. Test that Drive evidence opens only through the existing HTTPS external-link API.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/work-management.test.js`

Expected: FAIL because action handlers and forms are absent.

- [ ] **Step 3: Implement create/edit/complete forms**

Use exact fields from the approved spec. Save records by ID, preserve `createdAt`, set `updatedAt`, add an audit record containing actor/action/entity/time, and never accept secret-shaped keys. Completion requires `completedAt`; cancellation requires a reason in `summary`.

- [ ] **Step 4: Implement filtering and detail opening**

Wire status, building, owner, service type, and period filters. Open a work detail modal from each card and use `api.openExternal` only for a validated `https://drive.google.com/` evidence URL.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test test/work-management.test.js`

Expected: all permissions, mutation, and evidence tests PASS.

Commit: `git commit -m "feat(crm): manage building work records"`

### Task 4: Make building detail and dashboard use one source of truth

**Files:**
- Modify: `desktop-crm/src/service-operations-ui.js`
- Modify: `desktop-crm/src/index.html`
- Test: `desktop-crm/test/service-operations-ui.test.js`
- Test: `desktop-crm/test/work-management.test.js`

- [ ] **Step 1: Add a failing parity test**

Given the same store, assert that both dashboard and building detail display `예초 작업`, `2026-08-15`, `150,000원`, `계단 청소`, `주 1회`, and `60,000원`.

- [ ] **Step 2: Run the two focused tests and verify RED**

Run: `node --test test/work-management.test.js test/service-operations-ui.test.js`

Expected: FAIL until building detail consumes the same normalized model.

- [ ] **Step 3: Reuse the work-management selectors**

Load `work-management.js` before `service-operations-ui.js` and render building services from `buildModel(...).items` filtered by exact building ID. Keep the existing empty-state wording only when the server payload is available and truly empty.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test test/work-management.test.js test/service-operations-ui.test.js`

Expected: all parity tests PASS.

Commit: `git commit -m "fix(crm): unify building and work service records"`

### Task 5: Production data verification and release

**Files:**
- Modify: `desktop-crm/package.json`
- Modify: `desktop-crm/package-lock.json`
- Modify: `desktop-crm/test/company-release.test.js`

- [ ] **Step 1: Verify production records with the installed encrypted CRM session**

Use a one-time non-committed Electron verification helper with the installed `userData` path. Read only the exact building, service record, and service contract IDs. Output IDs/status/counts only; never output tokens or the vendor phone.

Expected: building `building_bukwon_2475_93`, one completed mowing record, one planned stair-cleaning contract.

- [ ] **Step 2: Run full desktop verification**

Run: `npm.cmd test`

Expected: 0 failures.

Run: `npm.cmd run smoke`

Expected: exit 0 with renderer initialized and connected.

- [ ] **Step 3: Bump and build version 1.8.0**

Update package versions and the release assertion, then run:

`electron-builder --win nsis --x64 --config.directories.output=../outputs/BRING-CRM-1.8.0-build-20260817`

Expected: installer, blockmap, and `latest.yml` generated from the same build.

- [ ] **Step 4: Install locally without opening a foreground window**

Run the exact generated installer with `/S`, then verify the installed file version is 1.8.0 and installed `app.asar` contains `src/work-management.js`.

- [ ] **Step 5: Commit release metadata**

Commit: `git commit -m "chore(crm): release work management dashboard"`

## Final acceptance

- The separate `작업관리` menu is visible in installed BRING CRM 1.8.0.
- The server-backed mowing and stair-cleaning entries appear without manual local seeding.
- Completed and recurring costs are not added into one misleading number.
- Viewer remains read-only.
- Building detail and work dashboard show the same records.
- Full tests, smoke, build, installed-version, and installed-asar checks are fresh and green.

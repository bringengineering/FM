# Contract Readiness Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-approved Google Drive contract-source registry and customer-level contract readiness checklist.

**Architecture:** A company gateway checks only admin-approved Drive file IDs and stores immutable source versions. A pure CRM core converts approved templates into customer checklists; employees may update checklist status but only admins may approve source changes.

**Tech Stack:** Electron, vanilla JavaScript, Node test runner, existing company gateway, Google Drive API, Firebase CRM persistence

---

### Task 1: Contract source and checklist domain model

**Files:**
- Create: `desktop-crm/src/contract-readiness-core.js`
- Create: `desktop-crm/test/contract-readiness-core.test.js`

- [ ] Write failing tests for approved source IDs, immutable versions, contract types, checklist statuses (`pending`, `complete`, `not_applicable`), evidence links, and audit metadata.
- [ ] Run `node --test test/contract-readiness-core.test.js`; expect FAIL for missing module.
- [ ] Implement `normalizeSourceRegistry`, `diffApprovedTemplate`, `createReadinessChecklist`, and `summarizeReadiness` with strict allow-lists.
- [ ] Re-run the test; expect PASS.
- [ ] Commit with `git commit -m "feat(crm): define contract readiness model"`.

### Task 2: Drive change-check gateway and admin permissions

**Files:**
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Create: `desktop-crm/test/contract-drive-ipc.test.js`
- Modify: `desktop-crm/test/sensitive-data-guard.test.js`

- [ ] Write failing tests proving only admins can register a source ID, request immediate checks, compare versions, approve, or defer changes; general staff can read only approved templates.
- [ ] Run `node --test test/contract-drive-ipc.test.js test/sensitive-data-guard.test.js`; expect FAIL.
- [ ] Add gateway-backed IPC calls that never expose Google credentials, use file IDs rather than filename matching, and return last-check/error metadata while retaining the previous approved version on failure.
- [ ] Re-run the focused tests; expect PASS.
- [ ] Commit with `git commit -m "feat(crm): add approved Drive contract source gateway"`.

### Task 3: Admin source registry and change approval UI

**Files:**
- Create: `desktop-crm/src/contract-readiness-ui.js`
- Create: `desktop-crm/src/contract-readiness.css`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/contract-readiness-ui.test.js`

- [ ] Write failing tests for source registration, last checked/modified times, duplicate-title warnings, `지금 확인`, item-level diff, approve, and defer controls hidden from non-admins.
- [ ] Run `node --test test/contract-readiness-ui.test.js`; expect FAIL.
- [ ] Implement the isolated UI module and wire it into the existing contract area without restructuring unrelated customer screens.
- [ ] Re-run the test plus `node --test test/one-off-contract.test.js test/login-ui-contract.test.js`; expect PASS.
- [ ] Commit with `git commit -m "feat(crm): add contract source approval console"`.

### Task 4: Customer contract preparation workflow

**Files:**
- Modify: `desktop-crm/src/contracts.css`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/customer-contract-readiness.test.js`
- Modify: `desktop-crm/test/one-off-contract.test.js`

- [ ] Write failing tests for suggested contract type, employee override, source/version citation, required party documents, company documents, vendor qualification/insurance, signature/handover checks, owner/due date, and conversion of missing items to CRM tasks.
- [ ] Run `node --test test/customer-contract-readiness.test.js test/one-off-contract.test.js`; expect FAIL.
- [ ] Implement customer checklist creation from approved templates and persist employee status changes through confirmed server save.
- [ ] Re-run the focused tests; expect PASS.
- [ ] Commit with `git commit -m "feat(crm): add customer contract readiness checklist"`.

### Task 5: Daily schedule, failure behavior, and audit trail

**Files:**
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/remote.js`
- Create: `desktop-crm/test/contract-readiness-sync.test.js`

- [ ] Write failing tests for once-daily checks, manual refresh, unchanged detection, Drive failure retaining the approved version, pending changes not affecting staff checklists, and approval audit records.
- [ ] Run `node --test test/contract-readiness-sync.test.js`; expect FAIL.
- [ ] Implement the schedule guard and persisted synchronization metadata using the existing server-confirmed mutation path.
- [ ] Re-run the focused test; expect PASS.
- [ ] Commit with `git commit -m "feat(crm): synchronize approved contract guidance"`.

### Task 6: Full verification and release readiness

**Files:**
- Modify only files required by failing regression tests.

- [ ] Run `node --test test/contract-readiness-*.test.js test/customer-contract-readiness.test.js test/one-off-contract.test.js test/sensitive-data-guard.test.js`; expect all pass.
- [ ] Run `npm test`; expect zero failures.
- [ ] Run `npm run smoke`; expect `ready: true` and `syncStatus: "connected"`.
- [ ] Run `npm run build:win -- --publish never`; expect installer, blockmap, and `latest.yml`.
- [ ] Inspect `git diff --check` and commit only intentional fixes with `git commit -m "test(crm): verify contract readiness workflow"`.


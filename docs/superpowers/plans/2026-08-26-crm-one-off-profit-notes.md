# CRM One-Off Profit and Customer Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-off work contracts with revenue, vendor cost, profit, collection/vendor-payment status, calendar visibility, and a visible customer private-notes field, then seed the two August jobs.

**Architecture:** Extend the existing contract record rather than duplicating one-off data in the monthly payment schedule store. Pure helpers in `core.js` normalize and calculate one-off contracts; `app.js` renders and edits them alongside existing payment rows. Generic CRM sync persists contracts and the existing `notes` customer field.

**Tech Stack:** Electron, vanilla JavaScript, Firebase Realtime Database REST, Node test runner, electron-builder/GitHub Actions.

---

### Task 1: One-off contract domain rules

**Files:**
- Modify: `desktop-crm/src/core.js`
- Test: `desktop-crm/test/one-off-contract.test.js`

- [ ] Write failing tests proving `normalizeContract` accepts `billingCycle: "건별"`, normalizes dates/statuses and computes `grossProfit = amount - vendorCost` without trusting an input profit.
- [ ] Run `npm test -- --test-name-pattern="one-off contract"` and confirm the missing behavior fails.
- [ ] Add `normalizeOneOffContract()` and call it from `normalizeContract()` for 건별 contracts. Reject negative/invalid financial values through an exported validator used by the form.
- [ ] Re-run the focused test and commit `feat(crm): model one-off contract profit`.

### Task 2: One-off contracts in the payment calendar

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Test: `desktop-crm/test/one-off-contract.test.js`

- [ ] Write failing tests for month filtering, building filtering, total revenue/cost/profit, and calendar due-date projection of one-off contracts.
- [ ] Run the focused tests and confirm failure because projection helpers do not exist.
- [ ] Add pure exported helpers that select active 건별 contracts for a month and map them into calendar rows without writing to `paymentCalendars/shared`.
- [ ] Add `정기 납부 / 단건 계약` tabs, one-off KPI cards, calendar events, and a table showing work date, due date, revenue, cost, profit and both statuses.
- [ ] Add a one-off editor with customer/building linkage and validation; save through the existing generic CRM store path so offline retry behavior remains intact.
- [ ] Run focused tests and commit `feat(crm): add one-off payment calendar`.

### Task 3: Visible customer private notes

**Files:**
- Modify: `desktop-crm/src/app.js`
- Test: `desktop-crm/test/customer-private-notes.test.js`

- [ ] Write a failing markup/submit regression test proving `notes` appears once in the basic form under `currentIssue` with label `개인 메모·고객 특징`.
- [ ] Run the focused test and confirm the current optional `고객 메모` markup fails.
- [ ] Move the existing `notes` textarea into the basic form and preserve the existing submit mapping `notes: raw.notes.trim()`.
- [ ] Run the focused test and commit `feat(crm): surface customer private notes`.

### Task 4: Seed August operational records

**Files:**
- Create: `desktop-crm/scripts/seed-one-off-2026-08.js`
- Test: `desktop-crm/test/seed-one-off-2026-08.test.js`

- [ ] Write failing tests for deterministic IDs, idempotent patches, exact 2026-08-15/27 amounts, and linkage to `building_bukwon_2475_93` and `cus_msw117cqgmca`.
- [ ] Implement a pure patch builder and an authenticated execution entry point that refuses any project other than `bring-fm`.
- [ ] Run tests, execute once with the active Google Cloud credential, and GET each record back to verify exact values.
- [ ] Commit `data(crm): register August one-off jobs` without committing credentials or tokens.

### Task 5: Full verification and release

**Files:**
- Modify only files required by test findings.

- [ ] Run `npm test` in `desktop-crm` and require zero failures.
- [ ] Run `npm run smoke`, `node --check src/core.js`, `node --check src/app.js`, and `git diff --check`.
- [ ] Build or launch the local CRM against non-destructive test data and capture the payment calendar and customer editor showing the new results.
- [ ] Fast-forward the operating branch without force, monitor `CRM Automatic Release`, and verify the next immutable release has exactly EXE, blockmap and `latest.yml`.
- [ ] Probe the live updater channel; do not deploy Functions or Hosting.

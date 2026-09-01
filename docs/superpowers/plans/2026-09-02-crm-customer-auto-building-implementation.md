# CRM Customer Auto-Building Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a new customer to be registered with a required customer name and either link a selected building or create and link a same-name building automatically.

**Architecture:** Keep the existing customer modal and shared-store save pipeline. Extract the submit decision into a small pure helper so the three registration paths are testable, then let the existing submit handler apply the returned customer/building linkage.

**Tech Stack:** Electron renderer JavaScript, Node.js built-in test runner, existing CRM Core/store APIs.

---

### Task 1: Reproduce the registration bug

**Files:**
- Modify: `desktop-crm/test/customer-building-management.test.js`
- Modify: `desktop-crm/src/app.js`

- [ ] **Step 1: Write a failing renderer contract test**

Add assertions that the new-customer form renders `고객명 *`, does not mark `buildingId` as required, and contains a submit path that accepts no selected building for a new customer.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test desktop-crm/test/customer-building-management.test.js`

Expected: FAIL because the current form requires `buildingId` and rejects an empty selection.

### Task 2: Implement automatic building creation

**Files:**
- Modify: `desktop-crm/src/app.js`
- Test: `desktop-crm/test/customer-building-management.test.js`

- [ ] **Step 1: Make customer name required and building optional**

Render the customer name input with `required`, remove `required` from the building select, and explain that leaving it empty creates a same-name building.

- [ ] **Step 2: Add the minimal submit branch**

For a new customer with no selected building, create a building through the existing building factory using:

```js
{
  name: customer.name,
  type: "기타",
  status: "영업후보",
  ownerCustomerId: customer.id,
  manager: customer.owner
}
```

Append the generated building ID to the customer link list. For an explicitly selected building, retain the existing linking path. For an existing customer with no selection, retain all current links and create nothing.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run: `node --test desktop-crm/test/customer-building-management.test.js`

Expected: PASS.

### Task 3: Verify and release

**Files:**
- Modify only if tests expose a direct regression in the changed behavior.

- [ ] **Step 1: Run the full desktop suite**

Run: `npm test --prefix desktop-crm`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Build the Windows installer**

Run: `npm run build:win --prefix desktop-crm -- --publish never`

Expected: exit code 0 and exact EXE, blockmap, and `latest.yml` assets.

- [ ] **Step 3: Commit and fast-forward the operating branch**

Commit only the design, plan, test, and implementation. Rebase onto `origin/codex/bring-field-platform`, push the feature branch with lease if necessary, then push to the operating branch without force.

- [ ] **Step 4: Verify CI and automatic release**

Wait for CRM CI and CRM Automatic Release. Confirm the published release contains the feature commit and the live update-channel probe succeeds.

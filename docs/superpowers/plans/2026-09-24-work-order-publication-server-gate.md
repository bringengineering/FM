# Work Order Publication Server Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a newly published work order from bypassing the CRM's required purpose, owner, deadline, deliverable, and completion criteria through IPC or a direct database write.

**Architecture:** Keep existing work orders editable under the legacy validation contract. For a new record, validate publication after the server reads the target path. Mirror the new-record minimum in Firebase rules; do not silently classify an incomplete record as published.

**Tech Stack:** Electron, JavaScript, Node test runner, Firebase Realtime Database rules.

---

### Task 1: Server-side new-record validation

**Files:** `desktop-crm/src/remote.js`, `desktop-crm/test/work-order-publication-gate.test.js`

- [x] Add a Node test that calls `saveWorkOrder` with an incomplete, otherwise valid new order and expects `PUBLICATION_INCOMPLETE` with zero writes.
- [x] Run `node --test test/work-order-publication-gate.test.js` and confirm the assertion fails because the new order is accepted.
- [x] After reading the existing record, use `validatePublication(source)` for a missing record and `validateOrder(source)` for an existing record. Keep concurrency and evidence preservation unchanged.
- [x] Run the focused tests and confirm the new test and existing edit-preservation tests pass.

### Task 2: Direct database write boundary

**Files:** `database.rules.json`, `desktop-crm/test/work-order-publication-gate.test.js`

- [x] Add a rule-contract test requiring a new-record publication clause for `dueDate`, `deliverableKind`, `deliverable`, and counted deliverable quantity.
- [x] Run the test and confirm it fails because the clause is missing.
- [x] Add the new-record-only clause to `workOrders/$orderId/.validate`, leaving legacy edits unchanged.
- [x] Run focused tests, the database rules emulator suite, the complete `desktop-crm` test suite, and `git diff --check`; commit only these scoped files.

**Release boundary:** Local code and tests only. Production rules deployment is a separate reviewed release decision.

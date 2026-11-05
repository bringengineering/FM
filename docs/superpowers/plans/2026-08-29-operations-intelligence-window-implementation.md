# Operations Intelligence Window Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development and verification before completion.

**Goal:** Add a secure, server-backed Operations Intelligence window while preserving all existing CRM behavior and data.

**Architecture:** A dedicated Electron BrowserWindow uses its own preload, renderer, domain module, IPC allowlist, and Firebase subtree. The existing CRM only receives a launcher. Existing CRM entities are loaded as read-only references.

**Tech Stack:** Electron 39, vanilla HTML/CSS/JavaScript, Firebase Realtime Database REST client, Node test runner.

---

### Task 1: Lock the separation boundary with tests

- Add tests proving the launcher is the only existing-renderer integration seam.
- Add tests proving the new window has a dedicated preload and trusted sender validation.
- Run focused tests and confirm failure before implementation.

### Task 2: Build the operation domain model

- Add lifecycle constants, normalization, validation, transition history, completion capture, and KPI aggregation.
- Cover valid and invalid transitions, timestamps, intervention categories, and metrics with unit tests.

### Task 3: Add isolated server persistence

- Add dedicated database rules for `crmCompany/operationsIntelligence`.
- Add remote load/create/update methods using authenticated requests and optimistic versioning.
- Verify viewer read-only and member/admin write policy in rule-contract tests.

### Task 4: Add the secure separate window

- Add `operations-intelligence.html`, CSS, renderer, and preload.
- Add singleton window lifecycle and exact-sender IPC handlers.
- Add a visible launcher to existing CRM without registering a new CRM view.

### Task 5: Build V1 workflows

- Implement KPI dashboard and filters.
- Implement operation creation.
- Implement lifecycle transitions and 20–30 second quick completion.
- Implement human-work distribution and recent bottleneck summary.

### Task 6: Verify non-regression and package readiness

- Run focused tests, then full CRM suite.
- Run an Electron smoke test and capture the separate window screenshot.
- Compare the shared CRM data before/after an operation save test.
- Review the diff for accidental edits to existing operational modules.
- Commit and push only the isolated feature branch; do not force-push or merge over 현진님의 branch.

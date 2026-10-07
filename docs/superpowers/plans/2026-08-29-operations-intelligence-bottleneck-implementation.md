# Operations Intelligence Bottleneck Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the isolated Operations Intelligence window with trustworthy bottleneck analysis and evidence-based improvement candidates without choosing an R&D technology prematurely.

**Architecture:** Keep the existing dedicated BrowserWindow and Firebase subtree. Extend the pure domain module for normalized capture, deterministic aggregation, and candidate selection; keep the renderer limited to presentation and input. Preserve existing CRM data as read-only references and enforce optimistic versioning at the server boundary.

**Tech Stack:** Electron 39, vanilla HTML/CSS/JavaScript, Firebase Realtime Database Rules and REST, Node test runner, TypeScript/Vitest company-site checks.

---

### Task 1: Repair the existing CI type failure

**Files:**
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] Add an explicit Firebase sign-in-provider union to `crmPasswordClaims` and run `pnpm --dir company-site typecheck:field` to confirm the current failure.
- [ ] Apply only the narrow type annotation so `"password"` and `"google.com"` remain accepted test values.
- [ ] Run typecheck and the database-rules test, then commit.

### Task 2: Extend the operation capture model

**Files:**
- Modify: `desktop-crm/test/operations-intelligence.test.js`
- Modify: `desktop-crm/src/operations-intelligence-core.js`

- [ ] Write failing tests for repeatability, manager intervention, manager minutes, evidence metadata, and system-owned counters.
- [ ] Run the focused test and confirm failures are caused by missing normalization.
- [ ] Add bounded normalization and reject unsafe evidence references.
- [ ] Run the focused test and commit.

### Task 3: Add deterministic bottleneck analysis

**Files:**
- Modify: `desktop-crm/test/operations-intelligence.test.js`
- Modify: `desktop-crm/src/operations-intelligence-core.js`

- [ ] Write failing tests for category/subcategory grouping, period filtering, rates, medians, sample exclusion, and input-order independence.
- [ ] Implement `bottlenecks(operations, options)` as a pure function.
- [ ] Write failing tests proving candidates need at least five samples and two observed signals.
- [ ] Implement `improvementCandidates(analysis)` without generating scores or technology names.
- [ ] Run focused tests and commit.

### Task 4: Protect automatic counters and concurrent saves

**Files:**
- Modify: `desktop-crm/test/operations-intelligence.test.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `database.rules.json`

- [ ] Write source-contract tests for expected version, ETag conditional PUT, server-owned counters, and immutable creation metadata.
- [ ] Make save requests require `expectedVersion` on updates and use an ETag conditional PUT.
- [ ] Calculate assignment and schedule changes from the server record, ignoring renderer-supplied counter values.
- [ ] Tighten Rules validation for bounded arrays, metadata, counts, and version succession.
- [ ] Run focused tests and commit.

### Task 5: Build the three-tab user experience

**Files:**
- Modify: `desktop-crm/src/operations-intelligence.html`
- Modify: `desktop-crm/src/operations-intelligence.css`
- Modify: `desktop-crm/src/operations-intelligence.js`
- Modify: `desktop-crm/test/operations-intelligence.test.js`

- [ ] Write failing UI contract tests for the three tabs, shared period filter, sample labels, candidate evidence, and viewer behavior.
- [ ] Add tab navigation and preserve the selected period across renders.
- [ ] Add bottleneck comparison cards/table and improvement-candidate cards.
- [ ] Extend the operation editor with repeatability, manager intervention, and safe evidence-reference entry.
- [ ] Run focused tests and commit.

### Task 6: Complete verification and PR delivery

**Files:**
- Modify only when a failing verification proves a defect.

- [ ] Run `npm test` in `desktop-crm` and confirm zero failures.
- [ ] Run company-site typecheck and test commands used by CI.
- [ ] Run Windows NSIS build.
- [ ] Capture all three tabs in the isolated Electron window and inspect them visually.
- [ ] Confirm no diff exists in existing work-management, service-record, customer, building, or contract modules.
- [ ] Push the feature branch, monitor PR #44 checks to completion, and report the result without merging the production branch.

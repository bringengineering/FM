# Project Weekly Report Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn project weekly source counts into traceable, submitted, reviewed and immutable approved reports without duplicating work orders.

**Architecture:** The existing project-weekly-report-core derives one report from the latest authorized work-order view. A snapshot records the selected period, source order IDs/statuses/update times and counted totals. A separate report lifecycle record stores author text, review status and approval; approval freezes that version, while a correction creates a new version linked to the previous approved ID. The existing CRM remote layer and Firebase rules enforce roles, with the project report tab as the only editing surface. TV reads approved/reportable values from the same authorized source and never writes.

**Tech Stack:** Electron, plain JavaScript, Node test runner, Firebase Realtime Database rules.

---

### Task 1: Verifiable source snapshot

**Files:** `desktop-crm/src/project-weekly-report-core.js`, `desktop-crm/test/project-weekly-report-core.test.js`

- [ ] Write a failing test: `Report.snapshot({orders, projectId:'p1', asOf:'2026-09-24', capturedAt:'2026-09-24T12:00:00Z'})` must return one record for each latest source ID, counts identical to `summarize`, and no snapshot if source is unavailable.
- [ ] Run `node --test test/project-weekly-report-core.test.js`; verify failure is the missing API.
- [ ] Implement `snapshot` from `summarize` and `selectProjectOrders`, copying only bounded plain values (`id`, `status`, `updatedAt`, `assigneeUid`) so later source mutation does not alter the captured result.
- [ ] Re-run targeted tests; commit the source snapshot and tests.

### Task 2: Report state model

**Files:** `desktop-crm/src/project-weekly-report-core.js`, `desktop-crm/test/project-weekly-report-core.test.js`

- [ ] Write tests for `draft → submitted → approved` and `submitted → returned`, member-only own submission, admin-only review, required review reason on return, and approved-record correction as a new linked version.
- [ ] Verify red with targeted Node tests.
- [ ] Implement `normalizeReport`, `validateReport`, `transitionReport` with explicit status, author UID, project ID, week start, evidence snapshot and bounded narrative/decision fields. Approval must not recompute the submitted snapshot.
- [ ] Verify green and commit.

### Task 3: Authenticated server persistence

**Files:** `desktop-crm/src/remote.js`, `desktop-crm/src/main.js`, `desktop-crm/src/preload.js`, `database.rules.json`, focused `desktop-crm/test/*-wiring.test.js` and rules tests.

- [ ] Write failing tests for IPC methods and RTDB rules: read for authorized staff; member write only own draft/submission; admin review; no delete or overwrite of approved records; no arbitrary fields.
- [ ] Verify red with targeted Node tests.
- [ ] Add narrow load/save APIs using the existing office session guard and conditional writes. Approved amendments use a new ID and `supersedesId`, never update the approved path. Validate records both before request and in database rules.
- [ ] Verify targeted tests and commit.

### Task 4: Project report screen

**Files:** `desktop-crm/src/app.js`, `desktop-crm/src/app.css` (or existing style file), `desktop-crm/test/project-workspace-wiring.test.js`.

- [ ] Write failing DOM/source tests for a dated report composer, source evidence drill-down, submit/review actions, loading/error states, and read-only approved versions.
- [ ] Verify red.
- [ ] Wire the existing project report tab to server reports. Preserve the current live source summary and distinguish it clearly from submitted/approved snapshots. Show author narratives, incomplete work, next actions, evidence links and decision requests. Avoid re-rendering while a user types.
- [ ] Verify targeted tests and a local UI smoke test, then commit.

### Task 5: Export and TV consistency

**Files:** export module under `desktop-crm/src/`, matching tests, TV projection code and focused tests.

- [ ] Write failing tests proving Word/PPT export uses the same approved snapshot totals and source IDs, and TV never counts a submitted-only report as approved.
- [ ] Verify red.
- [ ] Add printable/exportable report data contract and TV projection from approved records; do not expose personal notes or customer private data.
- [ ] Run full `npm test`, `git diff --check`, local render/TV smoke checks; commit only scoped files. Do not deploy without the separate release gate.

**Safety gates:** Never infer missing source data as zero; never silently reclassify orders; do not use current live totals to rewrite an approved snapshot; preserve existing CRM schedule and work-order records. Production deployment and TV-machine verification are separate from local implementation.

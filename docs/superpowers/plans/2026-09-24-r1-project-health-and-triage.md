# R1 Project Health and Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project home show truthful review-completion, overdue, and review-waiting counts, plus an actionable classification-needed view, without rewriting existing project or work-order records.

**Architecture:** Extend the existing read-only `project-workspace-core.js` with a single health selector over latest unique work-order IDs. Render its result in the existing `renderWorkOrders()` workspace; keep the existing work-order cards and project editing APIs as the only mutation path. The selector never treats unknown statuses, missing data, or submitted orders as completed work.

**Tech Stack:** Electron renderer JavaScript/CSS and Node `node:test`. The accepted master design is `docs/superpowers/specs/2026-09-24-bring-project-control-room-master-design.md`.

**Checkpoint (2026-09-24):** Tasks 1–2 are implemented locally. `npm test` passed 2,228 tests, 0 failures, 2 skipped. The synthetic browser fixture passed at 375/390/700/760/1280/1366/1920 px; 1366 and 1920 screenshots were visually inspected. A today action opened its original card despite the initial date filter. The previously open `localhost:50089` has no active listener and was not used as evidence for this worktree. Real-account, server-save and TV-device tests remain open.

---

### Task 1: Source-backed project health selector

**Files:**
- Modify: `desktop-crm/src/project-workspace-core.js`
- Modify: `desktop-crm/test/project-workspace-core.test.js`

- [ ] Write a failing test for `health({ orders, today })` with duplicate IDs, done, submitted, returned, overdue, undated, and unknown statuses. Expect `{ done: 1, total: 4, overdue: 2, review: 1, undated: 1 }` from a fixture whose latest known unique active records produce those counts. A duplicate older `done` must not be counted when its newer status is unknown.
- [ ] Run `node --test test/project-workspace-core.test.js`; verify RED is the missing `health` function, not a syntax error.
- [ ] Implement `health` using existing `uniqueOrders` and date validation. `done` counts only status `done`; `overdue` requires a valid due date before today and status other than `done`; `review` counts `submitted` once; `undated` counts non-done records without valid dates. For invalid `today`, return `null` rather than invented counts. Export it from the UMD API.
- [ ] Re-run focused tests and then `npm test`; commit only these two files.

### Task 2: Project home KPI and classification path

**Files:**
- Modify: `desktop-crm/src/app.js` inside `renderWorkOrders()`
- Modify: `desktop-crm/src/toss.css`
- Modify: `desktop-crm/test/project-workspace-wiring.test.js`

- [ ] Write failing source-wiring tests for `workspaceCore.health`, the three distinct labels `업무 검수 완료`, `기한 초과`, `검수 대기`, and a `data-wo-project="__none"` path to unlinked orders. Assert a classification-needed count remains visible even if no real project exists.
- [ ] Run `node --test test/project-workspace-wiring.test.js` and verify RED.
- [ ] Render three compact KPI cards above the read-only project list. Show `done/total` with `건수 기준`, overdue count, submitted review count. If loading/error/invalid date, show `조회 확인 필요`, never zero. Classification-needed is a visible disclosure with a direct `프로젝트 없음` filter button and preserved legacy filters; do not auto-map or change IDs.
- [ ] Scope CSS to `.project-workspace-*`; use a light shell, solid text surfaces, ≥14px data text, visible focus, and stacked layout under 1050px. Do not change shared CRM tokens or the TV.
- [ ] Run focused tests, `node --check src/app.js`, and `npm test`. Review the diff and commit only these three files.

### Task 3: Runtime checkpoint

**Files:** no production changes unless a failing behavior is reproduced first.

- [ ] Determine whether the current local preview serves this worktree. If so, inspect 1366×768 and 1920×1080 and navigate from the KPI/triage to the original order. If not, report visual inspection as pending rather than attributing another build's screen to this code.
- [ ] Compare before/after project and order IDs in test fixtures and confirm no server mutation path was added. Record verified commands and open limitations in the delivery note.

This is the next R1 slice only. Persistent portfolio metadata, administrator-confirmed mapping, weekly report snapshots, TV synchronization, revenue, and Gemini adapter remain governed by the master design and require separate implementation and release gates.

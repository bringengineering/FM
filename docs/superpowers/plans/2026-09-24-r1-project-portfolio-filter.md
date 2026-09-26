# R1 Project Portfolio Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff find real CRM projects by business area, including unclassified projects, without changing company-wide metrics or legacy work-order links.

**Architecture:** The existing `portfolioId` on real projects is the only classification source. A pure workspace-core filter narrows only the real-project list. The CRM view stores the selected category in ephemeral UI state and keeps the overview metrics and legacy disclosure unfiltered.

**Tech Stack:** Electron renderer, vanilla JavaScript, Node `node:test`.

---

### Task 1: Pure real-project filter

**Files:** `desktop-crm/src/project-workspace-core.js`, `desktop-crm/test/project-workspace-core.test.js`.

- [ ] Add a test with projects `{id:'pj-care'}`, `{id:'real-1',portfolioId:'pf-care'}`, `{id:'real-2',portfolioId:''}`. Assert `filterRealProjects(input,'__all')` gives `real-1,real-2`, `'pf-care'` gives `real-1`, and `'__unclassified'` gives `real-2`.
- [ ] Run `node --test test/project-workspace-core.test.js`; expect failure because `filterRealProjects` is missing.
- [ ] Implement `filterRealProjects(input, filter)` by calling `partitionProjects({projects:input}).projects`, then selecting by exact `portfolioId`; export it. No mutation, no server access.
- [ ] Run the same test; expect all tests to pass.

### Task 2: Scoped CRM selection and view

**Files:** `desktop-crm/src/app.js`, `desktop-crm/src/toss.css`, `desktop-crm/test/project-workspace-wiring.test.js`.

- [ ] Add a wiring test asserting state `portfolioFilter`, a labelled `data-wo-portfolio-filter` selector drawn from `P.PORTFOLIOS`, `workspaceCore.filterRealProjects`, and a `change` handler that rerenders only the CRM view. Assert `data-wo-project` still uses each real project's ID.
- [ ] Run `node --test test/project-workspace-wiring.test.js`; expect the new test to fail because the selector is absent.
- [ ] Add `portfolioFilter: '__all'` to `workOrderState`. In the real-project section, render a select with all, six category options, and unclassified; show the filtered count and empty-state message. Change handler stores only a recognized value and calls `renderWorkOrders`, unless a form is being edited. Style the selector within `.project-workspace-projects` and keep 1366px width usable.
- [ ] Run focused tests, `node --check src/app.js`, `npm test`, and `git diff --check`. Record visual QA as pending if no safe worktree-owned renderer is available.

**Exit check:** All-project metrics and legacy records are unaffected, filtering never writes to the server, and selecting a project still opens its original ID.

**Execution note (2026-09-24):** The pure filter and CRM selector were implemented after focused red tests, then the focused suite passed 28/28. This plan changes no database records or server rules. Desktop visual QA and production rollout remain separate gates.

# R1 Portfolio Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each real project an optional, explicit business-area link while retaining the six legacy project IDs and all existing work-order links.

**Architecture:** `project-core.js` owns a closed catalog of six portfolio IDs separate from the six legacy project IDs. Project records gain optional `portfolioId`; the current admin project editor selects it and the existing save path persists it. The project home shows the category or “분류 필요,” without moving or recreating projects or orders.

**Tech Stack:** Electron/vanilla JavaScript, Firebase Realtime Database rules, Node `node:test`.

**Safety:** No migration or bulk rewrite. Existing records without `portfolioId` remain valid; the six legacy projects remain legacy projects, not category records. Only selected project saves write the optional new field. Production deployment is a separate gate.

**Execution note (2026-09-24):** Tasks 1–3 were implemented as one cohesive change because the new normalized field and database rule must ship together. The existing `company-site/tests/field/database-rules.test.ts` suite was extended instead of creating a second rules file. TDD failures were observed for the catalog/UI, missing server field, missing project-home labels, and legacy-project server guard. CRM suite: 2320 passed, 2 skipped; database emulator: 123 passed. Automated checks do not replace a desktop visual review or production deployment approval.

---

### Task 1: Closed catalog and project record

**Files:** `desktop-crm/src/project-core.js`, `desktop-crm/test/project-core.test.js`.

- [ ] Add a failing test asserting distinct `pf-*` category IDs, legacy ID mapping, optional normalized `portfolioId`, and rejection of unknown nonempty IDs:

```js
const P = require('../src/project-core');
assert.equal(P.PORTFOLIOS.length, 6);
assert.equal(P.portfolioForLegacy('pj-care').id, 'pf-care');
assert.equal(P.normalizeProject({id:'p-real',name:'현장',portfolioId:'pf-care'}).portfolioId, 'pf-care');
assert.equal(P.normalizeProject({id:'p-old',name:'현장'}).portfolioId, '');
assert.equal(P.validateProject({id:'p-real',name:'현장',portfolioId:'pf-invented'}).ok, false);
```

- [ ] Run `node --test test/project-core.test.js` from `desktop-crm` and observe the new assertion fail because `PORTFOLIOS` is absent.
- [ ] Add the six `PORTFOLIOS` entries (`pf-care`, `pf-crm`, `pf-marketing`, `pf-rnd`, `pf-base`, `pf-study`) with their respective `pj-*` legacy IDs. Export `portfolioForLegacy(id)` and `portfolioLabel(id)`. Preserve nonempty unknown input through normalization long enough for `validateProject` to reject it; empty stays valid for legacy records.
- [ ] Re-run the focused test and `node --test test/project-workspace-core.test.js`; confirm zero failures. Commit only those two files.

### Task 2: Server contract and admin selection

**Files:** `database.rules.json`, `desktop-crm/src/app.js`, `desktop-crm/test/project-wiring.test.js`, `desktop-crm/test/project-workspace-wiring.test.js`, `company-site/tests/field/project-portfolio-rules.test.ts`.

- [ ] Write failing tests that the admin project form includes a `portfolioId` select drawn from `P.PORTFOLIOS`, preserves the saved value, and submits it through `saveProject`; add emulator tests proving old records without the field remain writable, valid `pf-*` IDs are accepted, and an arbitrary ID is denied.
- [ ] Run `node --test test/project-wiring.test.js test/project-workspace-wiring.test.js` and the focused Firebase emulator rule test to observe behavioral failures.
- [ ] Add one optional `portfolioId` validation child under `crmCompany/projects/$projectId` rules: empty or one of the six exact catalog IDs. In the project editor, render `사업영역` with blank `분류 필요`; include `portfolioId` in the existing form payload. Do not change work-order project links or seed IDs.
- [ ] Run the focused Node tests, emulator test, `node --check src/app.js`, and `git diff --check`. Commit only task files.

### Task 3: Project home label and navigation

**Files:** `desktop-crm/src/app.js`, `desktop-crm/src/toss.css`, `desktop-crm/test/project-workspace-wiring.test.js`.

- [ ] Write a failing test that real project rows show the business-area label or `분류 필요` while legacy projects remain in the collapsed section, and that the category label does not alter the `data-wo-project` target.
- [ ] Run `node --test test/project-workspace-wiring.test.js` and observe the label assertion fail.
- [ ] Render one compact label from `P.portfolioLabel(project.portfolioId)` in each real project row and project overview. Keep the existing `data-wo-project` ID and add only workspace-scoped styles for a readable label on 1366×768.
- [ ] Run focused tests and `npm test` from `desktop-crm`. Inspect local preview at 1366×768 if a worktree-owned renderer is available; otherwise report that visual inspection is pending. Commit only task files.

**Exit check:** Existing seed IDs and order IDs remain unchanged in fixtures, missing portfolio links remain visible as unclassified, server rules deny arbitrary category values, and no deployed database record is modified by this plan.

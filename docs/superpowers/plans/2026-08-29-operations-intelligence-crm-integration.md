# BRING CRM Operations Analysis Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Operations Intelligence from a separate Electron window into the normal BRING CRM navigation and content area.

**Architecture:** Keep `operations-intelligence-core.js` and the Firebase operation records as the domain layer. Add a focused CommonJS UI renderer for the integrated page, connect it to `app.js` state/events, and expose the existing validated load/save handlers through the main CRM preload. Remove the separate-window launch path only after integrated navigation and persistence tests pass.

**Tech Stack:** Electron 39, CommonJS JavaScript, Firebase Realtime Database REST, Node test runner, HTML/CSS.

---

### Task 1: Lock the integrated navigation contract

**Files:**
- Modify: `desktop-crm/test/operations-intelligence.test.js`
- Modify: `desktop-crm/src/index.html`

- [ ] **Step 1: Write the failing navigation test**

Replace the separate-window assertions with assertions that require exactly one `data-view="operationsIntelligence"` menu item, require it after `workManagement`, and reject the launcher action and `별도 창` label.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test desktop-crm/test/operations-intelligence.test.js`

Expected: FAIL because `index.html` still contains `data-action="open-operations-intelligence"`.

- [ ] **Step 3: Implement the menu seam**

Use this markup directly after the work-management button:

```html
<button class="nav-item" data-view="operationsIntelligence"><span>▥</span><b>운영 분석</b></button>
```

- [ ] **Step 4: Run the focused test**

Run: `node --test desktop-crm/test/operations-intelligence.test.js`

Expected: the navigation assertion passes; later integration assertions may still fail until Tasks 2–4.

### Task 2: Add a focused CRM page renderer

**Files:**
- Create: `desktop-crm/src/operations-intelligence-ui.js`
- Create: `desktop-crm/test/operations-intelligence-ui.test.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/operations-intelligence.css`

- [ ] **Step 1: Write failing renderer tests**

Require the new module and assert that `renderPage()` renders the three tabs, period selector, KPI data, and writable-only registration button. Assert that `renderForm()` includes `expectedVersion` and hides persistence controls for read-only users.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `node --test desktop-crm/test/operations-intelligence-ui.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the renderer**

Export the following stable interface:

```js
module.exports = Object.freeze({
  renderPage,
  renderForm,
  formPayload
});
```

`renderPage({ operations, buildings, tab, period, writable, loading, error })` delegates metrics, bottlenecks, and candidates to `OperationsIntelligenceCore`. `formPayload(form, existing, user)` preserves safe attachment metadata and converts checkboxes and multi-select values to the existing save contract.

- [ ] **Step 4: Include the module and reuse scoped styles**

Load `operations-intelligence-core.js` and `operations-intelligence-ui.js` before `app.js`. Prefix integrated selectors with `.operations-intelligence-page` where needed so existing CRM styles remain unchanged.

- [ ] **Step 5: Run renderer tests and verify GREEN**

Run: `node --test desktop-crm/test/operations-intelligence-ui.test.js`

Expected: PASS.

### Task 3: Connect data loading and CRM rendering

**Files:**
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/test/operations-intelligence.test.js`

- [ ] **Step 1: Write failing integration assertions**

Assert that the preload exposes `saveOperation`, that `app.js` routes `currentView === "operationsIntelligence"` to `renderOperationsIntelligence`, and that it no longer calls `openOperationsIntelligence`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test desktop-crm/test/operations-intelligence.test.js`

Expected: FAIL because the main CRM currently exposes only load plus a window launcher.

- [ ] **Step 3: Expose the validated save path to the trusted CRM window**

Add this preload method:

```js
saveOperation: input => ipcRenderer.invoke("crm:operation-save", input)
```

Register `crm:operation-save` with the same `saveOperationsIntelligence` domain function used by the existing isolated window, protected by the main-window trusted IPC wrapper.

- [ ] **Step 4: Add page state and rendering**

Maintain `operationsIntelligenceState` with `items`, `loading`, `error`, `tab`, and `period`. Load on first entry, call the UI renderer from `render()`, and preserve tab/period while switching CRM pages.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test desktop-crm/test/operations-intelligence.test.js`

Expected: PASS.

### Task 4: Connect tabs, filtering, modal editing, and saving

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/test/operations-intelligence.test.js`
- Modify: `desktop-crm/test/operations-intelligence-ui.test.js`

- [ ] **Step 1: Write failing interaction contract tests**

Assert source-level routing for `data-operations-tab`, `data-operations-period`, `new-operation`, operation row editing, `operationForm`, and failure handling that updates local records only after `{ ok: true }`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test desktop-crm/test/operations-intelligence*.test.js`

Expected: FAIL because the integrated interactions do not exist.

- [ ] **Step 3: Implement event handling**

On tab or period change, update the isolated page state and rerender. Open the shared CRM modal with `renderForm()`. On submit, build the payload with `formPayload()`, await `window.crm.saveOperation(payload)`, replace or append the returned server operation only on success, then close and rerender.

- [ ] **Step 4: Implement viewer and error behavior**

Do not render create/edit controls when `canWriteCRM()` is false. Keep the modal open and preserve local records when saving fails or returns `{ ok: false }`; show the returned conflict/server message using the CRM toast.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test desktop-crm/test/operations-intelligence*.test.js`

Expected: PASS.

### Task 5: Retire the separate-window user path and verify regression safety

**Files:**
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/test/operations-intelligence.test.js`

- [ ] **Step 1: Write the failing retirement assertions**

Assert that the main CRM no longer exposes `openOperationsIntelligence`, no `crm:open-operations-intelligence` handler is registered, and normal startup does not create the isolated window.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test desktop-crm/test/operations-intelligence.test.js`

Expected: FAIL while the launcher and BrowserWindow entry point remain.

- [ ] **Step 3: Remove the obsolete runtime path**

Remove the launcher API, launcher action handler, dedicated BrowserWindow creation, and isolated-window-only IPC registrations. Keep the domain save/load helpers, core module, and reusable styles used by the integrated page.

- [ ] **Step 4: Run all desktop tests**

Run: `npm --prefix desktop-crm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Run smoke and package verification**

Run: `npm --prefix desktop-crm run smoke`

Expected: process exits successfully with a passing smoke result.

Run: `npm --prefix desktop-crm run build:win`

Expected: exit code 0 and a Windows NSIS artifact in `desktop-crm/dist`.

- [ ] **Step 6: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors and only planned files changed.


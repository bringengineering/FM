# CRM Manual Quote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-free manual quote workflow while preserving current quote exports.

**Architecture:** `quote-core.js` owns deterministic blank manual draft creation. `app.js` owns the AI/manual mode switch and reuses the existing normalized quote editor and exporters.

**Tech Stack:** Electron renderer, vanilla JavaScript, Node test runner.

---

### Task 1: Manual draft model
**Files:** Modify `desktop-crm/src/quote-core.js`; test `desktop-crm/test/quote-core.test.js`.
- [ ] Write a failing test for a deterministic editable manual draft with no AI input.
- [ ] Run `node --test test/quote-core.test.js` and confirm it fails because `createManualDraft` is missing.
- [ ] Implement `createManualDraft` with one editable 1,000-won placeholder item.
- [ ] Run the focused test and confirm it passes.

### Task 2: Manual quote UI
**Files:** Modify `desktop-crm/src/app.js`; test `desktop-crm/test/ai-ui.test.js`.
- [ ] Write failing source-contract tests for the mode buttons, manual creation handler, project-name editor, and absence of `api.assist` in the manual handler.
- [ ] Run the focused UI test and confirm expected failures.
- [ ] Add mode state, buttons, manual creation handler, and editable project name while reusing current item and export controls.
- [ ] Run focused tests and the full desktop CRM suite.

### Task 3: Runtime verification
**Files:** Modify the existing screenshot smoke route in `desktop-crm/src/main.js` only if needed.
- [ ] Run syntax checks and `git diff --check`.
- [ ] Run the full `node --test test/*.test.js` suite.
- [ ] Verify the manual mode in Electron with a blank draft and confirm no AI request is required before editing.

### Task 4: Editable quote identity and dates
**Files:** Modify `desktop-crm/src/quote-core.js`, `desktop-crm/src/app.js`; test `desktop-crm/test/quote-core.test.js`, `desktop-crm/test/ai-ui.test.js`.
- [ ] Write failing tests for explicit validity dates and the editable project, site address, issue date, and valid-until fields.
- [ ] Preserve explicit valid-until values during normalization and export.
- [ ] When the issue date changes in the renderer, calculate a new seven-day validity date; allow a later direct valid-until edit.
- [ ] Run focused and full regression tests before pushing.

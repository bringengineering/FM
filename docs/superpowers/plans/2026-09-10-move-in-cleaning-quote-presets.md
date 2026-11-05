# Move-In Cleaning Quote Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed five-item move-in cleaning quote template with selectable totals from 100,000 to 200,000 won in 10,000-won increments.

**Architecture:** Keep pricing and template rules in `quote-core.js`, where AI and manual quote flows can share them. Add one narrowly scoped selector to the existing quote editor and apply the core preset without persisting any new CRM data. Existing item editing and export paths remain unchanged.

**Tech Stack:** Electron, browser JavaScript, Node.js built-in test runner

---

### Task 1: Fixed move-in cleaning pricing core

**Files:**
- Modify: `desktop-crm/test/quote-core.test.js`
- Modify: `desktop-crm/src/quote-core.js`

- [ ] **Step 1: Write the failing core tests**

Add tests that request every total from `100000` through `200000` in `10000` increments and assert five fixed item names, `1식`, the `25/20/20/20/15` split, exact totals, detailed descriptions, and rejection of an amount outside the allowed preset range. Add a test proving an AI-provided item list cannot replace the fixed move-in template.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/quote-core.test.js`

Expected: FAIL because the current move-in cleaning template has three items and accepts AI-provided item names.

- [ ] **Step 3: Implement the minimal shared preset API**

In `quote-core.js`, replace only the `입주청소` template with the approved five rows. Export `MOVE_IN_CLEANING_AMOUNTS` and `applyMoveInCleaningPreset(quote, totalAmount)`. The function validates the allowed amount, preserves recipient, phone, site address, issue dates and supplier, sets service to `입주청소`, applies the fixed rows, and adds the approved exclusions and additional-cost notes. In `createDraftFromPrompt`, always use the fixed template when the inferred service is `입주청소`; retain existing AI behavior for every other service.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/quote-core.test.js`

Expected: all quote-core tests pass.

- [ ] **Step 5: Commit the core behavior**

Commit message: `feat(crm): standardize move-in cleaning quote items`

### Task 2: Price selector in the quote editor

**Files:**
- Modify: `desktop-crm/test/ai-ui.test.js`
- Modify: `desktop-crm/src/app.js`

- [ ] **Step 1: Write the failing UI contract test**

Assert that the quote editor renders `data-move-in-quote-amount`, contains all eleven price options, explains that applying it replaces current items, and routes the change through `QuoteCore.applyMoveInCleaningPreset` followed by `refreshQuotesView()`.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `node --test test/ai-ui.test.js`

Expected: FAIL because the selector and change handler do not exist.

- [ ] **Step 3: Add the existing-style selector and handler**

Render an `입주청소 표준 견적` control above the item editor. Offer `10만원` through `20만원` at one-man-won intervals. On selection, replace the current items through the core API, clear the quote error, redraw the quote view, and show a success notice. Leave the individual item fields editable.

- [ ] **Step 4: Run focused UI tests and verify GREEN**

Run: `node --test test/ai-ui.test.js`

Expected: all AI/quote UI tests pass.

- [ ] **Step 5: Commit the UI behavior**

Commit message: `feat(crm): add move-in cleaning price selector`

### Task 3: Regression, build and release

**Files:**
- Verify only

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 2: Build the Windows installer**

Run: `npm run build:win -- --publish never`

Expected: exit code 0 with installer, blockmap and `latest.yml` generated.

- [ ] **Step 3: Check the final diff and history**

Run: `git diff --check` and inspect the commits against `origin/codex/bring-field-platform`.

Expected: no whitespace errors and only the approved quote behavior plus tests and documents.

- [ ] **Step 4: Fast-forward the operating branch**

Fetch the latest remote branch, verify it is an ancestor, and push without force to `codex/bring-field-platform`.

- [ ] **Step 5: Verify automatic release**

Watch `CRM Automatic Release` through successful tests, build, immutable release publication, update-channel advance, and live update probe. Confirm the next version and release assets.

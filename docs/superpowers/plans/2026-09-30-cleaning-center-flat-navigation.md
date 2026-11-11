# Cleaning Center flat page navigation implementation plan

> **For agentic execution:** This task is authorized for inline execution. Keep each step small and verify before moving on.

**Goal:** Show all 34 Cleaning Center screens as directly selectable, individually routed pages under the Cleaning Center sidebar folder.

**Architecture:** Preserve the immutable page registry and route dispatcher. Replace collapsible subgroups with one ordered child list, retaining page number, label, active state, and sidebar scrolling. No CRM records or business actions change.

**Tech Stack:** Electron, vanilla JavaScript, CSS, Node built-in test runner.

---

### Task 1: Prove flat navigation behavior

**Files:**
- Modify: `desktop-crm/test/cleaning-center-pages.test.js`

- [x] Update navigation tests to assert all 34 links are direct children in registry order, unique, individually labelled, and free of subgroup toggles.
- [x] Run `node --test test/cleaning-center-pages.test.js` from `desktop-crm`; confirm the new flat-list assertions fail against the grouped renderer.

### Task 2: Render the 34 destinations as one list

**Files:**
- Modify: `desktop-crm/src/cleaning-center-pages.js`
- Modify: `desktop-crm/src/styles.css`
- Modify: `desktop-crm/src/app.js` only if removal of group toggling requires it.

- [x] Make `renderNavigation(activeView)` render one direct child button per registry entry in order, with a visible reference number and descriptive accessible name.
- [x] Keep each link on its existing `data-cleaning-view` route and preserve active styling.
- [x] Style the list as a compact vertical navigation rail with a viewport-bounded scroll container so every page stays discoverable at common window sizes.
- [x] Remove obsolete subgroup disclosure styling and event handling if no longer used; scroll the active page into view.

### Task 3: Verify routes and UI

**Files:**
- Modify: `desktop-crm/test/cleaning-center-pages.test.js`
- Review: `desktop-crm/src/app.js`, `desktop-crm/src/index.html`

- [x] Re-run `node --test test/cleaning-center-pages.test.js` and confirm all route-specific pages still render independently.
- [x] Run `npm test` from `desktop-crm` and fix any regressions.
- [x] Run the existing CRM smoke check, visit every one of the 34 entries in order, verify the selected nav item remains visible, and capture the final pages.
- [x] Create a self-contained HTML/ZIP review artifact with the 34 page captures.

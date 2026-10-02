# Implement Cleaning Center as 34 dedicated CRM pages

> **For agentic execution:** use the executing-plans or subagent-driven-development skill to implement this plan task by task. This task is already authorized for inline execution in the current session.

**Goal:** Make every one of the 34 supplied Cleaning Center reference screens a separate CRM view under a compact, grouped Cleaning Center navigation tree, while keeping the existing CRM records and guarded write flows authoritative.

**Architecture:** Define the 34 screen identifiers, labels, nav groups, and page kinds in one tested registry. Route and page metadata consume the registry. Refactor the current all-in-one Cleaning Center renderer into focused page rendering entry points; reuse current source-backed panels and canonical CRM workflows. For dialogs/mobile/system references, provide focused dedicated CRM pages that launch or describe the real existing workflow in the same CRM shell. No screenshot is used as a flattened background and no extra data store is introduced.

**Tech stack:** Electron desktop CRM, vanilla JavaScript, HTML/CSS, Node built-in test runner.

## Task 1: Build a failing 34-screen registry test

**Files:**
- Create: `desktop-crm/test/cleaning-center-pages.test.js`
- Inspect: `desktop-crm/src/cleaning-center-ui.js`

1. Write tests asserting the 34 ordered reference numbers, unique view IDs, titles, owner groups and route kinds.
2. Add coverage checks against the user's original `index.html`/PNG filename list through a checked-in source fixture containing only the 34 reference number/title pairs (no copied images).
3. Run `node --test test/cleaning-center-pages.test.js` from `desktop-crm`; confirm it fails because the registry is absent.

## Task 2: Add the screen registry and grouped Cleaning Center navigation

**Files:**
- Create: `desktop-crm/src/cleaning-center-pages.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/test/cleaning-center-orders.test.js`
- Modify: `desktop-crm/test/cleaning-center-pages.test.js`

1. Add the 34-entry immutable registry with exact reference number/title, stable unique view key, group and source-backed/static/action page classification.
2. Render the nav from registry data or provide a shared deterministic helper that produces all 34 entries in the 8 approved groups.
3. Keep `센터 홈` as reference #01 and preserve CTI as #02. Add the remaining entries under the 8 collapsible categories from the design document.
4. Update the old test that required a two-destination Cleaning Center folder to require complete registry coverage and no duplicate global navigation entries.
5. Run the registry and navigation tests; verify the 34 entries are distinct and ordered.

## Task 3: Wire stable view routing and metadata

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/test/cleaning-center-pages.test.js`

1. Add page metadata for every view without duplicating title/group definitions.
2. Ensure workspace switching preserves the selected Cleaning Center route, active nav highlight, query/deep-link restoration, and page title.
3. Verify all 34 routes are accepted by query parsing and that unrelated routes keep their existing behavior.
4. Add failing tests for deep links, nav state, and title mapping before implementation.

## Task 4: Split the monolithic Center Home renderer

**Files:**
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/styles.css`
- Modify: `desktop-crm/test/cleaning-center-pages.test.js`
- Modify: relevant existing Cleaning Center tests

1. Change #01 to render the dashboard without partner search, dispatch, schedule, support, finance and queue panels.
2. Implement focused render entry points for existing CRM-backed order intake/detail, partner search/management, dispatch tower, schedule, work order, photo review, CS, payment/settlement, analytics and CTI functions.
3. For #20–25 and #27–34, expose each current guarded flow on a dedicated page, using canonical order/customer/partner selection and existing confirmation, auth, audit and local-preview boundaries.
4. For #16–19, build a focused partner-app entry/preview, business-flow map, system architecture view, and data-model view; adapt mobile/diagram layouts to the desktop shell while preserving the source hierarchy.
5. Add page-specific loading, empty, error, permission and not-connected states; never substitute test/demo facts into live pages.
6. Add tests proving that #01 is focused and each view renders a uniquely labelled page rather than all modules together.
7. Run the relevant test files and fix regressions before broad testing.

## Task 5: Match the supplied references and verify runtime behavior

**Files:**
- Modify: `desktop-crm/src/styles.css`
- Modify: `desktop-crm/test/cleaning-center-pages.test.js`
- Optional: add/update screenshots in a dedicated local review directory; do not replace the user's original references.

1. Compare the current app with the supplied reference gallery and adjust page-specific layout, hierarchy, spacing, status emphasis, button labels and Korean copy.
2. Run all `desktop-crm` tests with `npm test`.
3. Run the existing local Electron CRM smoke and visit each route programmatically; capture screenshots of representative pages from each group and every exception page (#20–34).
4. Confirm no deployment, outbound SMS, PG operation, bank payout, Firebase rules mutation, or production data mutation occurred.
5. Report the count of individually navigable pages, test/smoke results, screenshot evidence path, fidelity gaps, and any external capabilities that remain unavailable.

## Execution notes

- Work inline in the existing isolated `codex/cleaning-center-production-integration` worktree. Preserve pre-existing untracked `demo/` user deliverables; never stage them as part of this task.
- Existing focused baseline: 77 targeted cleaning order/CTI tests passed before this plan.
- Expected visual and workflow detail from the reference images is not equivalent to permission to send customer communications, execute payments/refunds, or pay partners.

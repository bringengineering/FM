# Cleaning Partner Management Implementation Plan

> **For agentic workers:** Execute this plan inline in this session. Keep the supplied screen scope and use the canonical CRM partner/vendor records.

**Goal:** Add cleaning-specific partner coverage, onboarding, manual availability, and compliance review to the existing CRM partner/vendor workflow.

**Architecture:** Normalize a closed `cleaningProfile` object on existing `partnerVendors`, render and edit that profile in the canonical vendor list/detail, and let Cleaning Center search structured service/region values with a legacy fallback. Existing shared-store authorization and audit writes remain the persistence boundary.

**Tech Stack:** Electron renderer, CommonJS CRM core/UI modules, Firebase Realtime Database shared CRM store, Node.js built-in test runner, CSS.

---

### Task 1: Define and test the canonical cleaning profile

**Files:**
- Modify: `desktop-crm/src/core.js`
- Create: `desktop-crm/test/cleaning-partner-management.test.js`

- [x] Add tests for service-type allow-listing, trimmed unique regions, date validation, closed status enums, profile removal on non-cleaning vendors, and legacy vendor normalization.
- [x] Run `node --test test/cleaning-partner-management.test.js`; confirm failures identify missing `cleaningProfile` normalization.
- [x] Add `normalizeCleaningPartnerProfile` and the closed enums in `core.js`; preserve unrelated vendor fields and keep non-cleaning vendors without a profile.
- [x] Re-run the targeted test and verify round-trip normalization is stable.

### Task 2: Add testable partner-management summaries and search behavior

**Files:**
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/test/cleaning-partner-management.test.js`

- [x] Add tests for onboarding and compliance totals, unknown availability counts, service-type matching, region matching, escaped vendor names, and legacy service/region fallback.
- [x] Run the targeted test and confirm the new helper assertions fail before implementation.
- [x] Add pure exported helpers for cleaning partner summary and structured-profile filtering.
- [x] Re-run the targeted test and verify empty, invalid, and populated vendor records render safely.

### Task 3: Connect the canonical vendor list and detail to cleaning profiles

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/test/cleaning-partner-management.test.js`

- [x] Add assertions for cleaning-specific status KPIs, filter controls, detail fields, and canonical edit action.
- [x] Verify the new assertions fail against the current generic-only partner screen.
- [x] Add a cleaning-partner summary area and a filter for `industry === "청소"` or an existing explicit cleaning profile; keep the all-vendor screen and quote history available.
- [x] Add a cleaning profile section to the existing vendor editor with service types, service regions, onboarding, manual availability, compliance review, check dates, and a bounded note.
- [x] Save the cleaned profile through the existing `partnerVendorForm` shared-store mutation; add an audit log entry describing cleaning profile changes.
- [x] Re-run targeted partner and shared-save tests.

### Task 4: Use structured coverage in the Cleaning Center partner search

**Files:**
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/test/cleaning-partner-management.test.js`
- Modify: `desktop-crm/test/cleaning-center-orders.test.js`

- [x] Add tests proving structured service types and regions drive cleaning partner search, while legacy vendors still match their existing `service` and `region` fields.
- [x] Verify those tests fail with the current generic-only mapping.
- [x] Map normalized profile fields into Cleaning Center partner candidates; do not add ratings, prices, response metrics, or live availability.
- [x] Re-run targeted cleaning partner and cleaning-center order tests.

### Task 5: Style and verify the integrated screen

**Files:**
- Modify: `desktop-crm/src/cleaning-center.css`
- Modify: `docs/superpowers/plans/2026-09-27-cleaning-34-screen-coverage-audit.md`

- [x] Add responsive styles for cleaning partner summary cards, profile status chips, and editor sections.
- [x] Update screen 14 evidence and explicitly retain the original-reference and production-verification limitations.
- [x] Run `npm test` from `desktop-crm`.
- [x] Run `node --check src/app.js`, `node --check src/core.js`, and `node --check src/cleaning-center-ui.js` from `desktop-crm`.
- [x] Run `npm run smoke` from `desktop-crm` and confirm the Cleaning Center route remains visible.
- [x] Run `git diff --check` from the repository root and review all screen-14 changes without reverting unrelated wallboard work.

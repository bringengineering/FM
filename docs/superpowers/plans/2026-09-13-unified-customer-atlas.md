# Unified Customer Building Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Put native 3D inside customer/building management, retaining original CRM records and editing paths.

**Architecture:** The existing CRM store remains authoritative. A customer workspace composes a filtered customer/building browser, native atlas host, customer profile, and related record tabs. Atlas reads only the selected building ID; customer records are never copied into model exports. Missing model/location remains explicitly unknown.

**Tech Stack:** Existing vanilla JavaScript, native atlas ES modules, CSS, Node test runner.

## Approved requirements

- Sidebar has only customer/building management, not a separate 3D menu.
- Left selection, center model, right profile/private memo, bottom related records.
- Customer and building editing use existing handlers; existing detailed customer view remains accessible.
- Multiple buildings per customer and customers without buildings remain supported.
- CRM updates refresh related data without discarding atlas drafts.
- No inferred physical location, new authentication, schema migration, production data write, or deployment.

## Task 1: Integrated workspace and navigation

Files: `desktop-crm/src/app.js`, `src/index.html`, `src/styles.css` (or existing stylesheet), `src/building-atlas/crm-host.mjs`, `src/building-atlas/crm-host.css`; tests under `desktop-crm/test`.

- [ ] Add failing behavior tests for customer selection, no-building empty state, related data without model, and draft cancellation. Update navigation assertion to zero standalone atlas entries.
- [ ] Run `node --test desktop-crm/test/building-atlas-navigation.test.js desktop-crm/test/building-atlas-host.test.js` plus the new workspace tests; confirm failures correspond to missing integration.
- [ ] Add embedded host options and externally controlled selection with awaited draft guard, preserving standalone compatibility for legacy callers. Compose workspace around the host; reuse existing customer/building relationships and edit handlers. Map legacy atlas navigation into the customer workspace.
- [ ] Render actual related records in tabs and explicit location-unassigned records. Model empty/error states must leave CRM information usable. Never invent floor/room associations from string guesses.
- [ ] Apply the approved bright white/blue/ivory responsive layout from `.superpowers/brainstorm/800-1789306804/content/customer-building-unified.html`; do not import its fixture data.
- [ ] Run focused tests, syntax checks, and regression tests. Commit only task files after spec and quality review.

## Task 2: Explicit CRM record references on geometry

Files: native `mount.mjs`, `crm-host.mjs`, `customer-workspace.mjs`, CRM projection in `app.js`, focused tests.

- [ ] Expose selection of a native model record without copying CRM data into it.
- [ ] Offer only current-building CRM units, cases, and service records as explicit reference targets. Store type and ID only through existing model save gate after user chooses a target; never infer coordinates.
- [ ] Resolve selected model references against current CRM data to display latest associated information. Missing or cross-building target must display unavailable, never unrelated data.
- [ ] Test selected record callback, reference storage without data copying, cross-building rejection, readonly rejection, and failed-save preservation before implementation.

## Task 3: Verification and delivery

- [ ] Independent spec review against approved requirements and corrective changes.
- [ ] Independent quality review covering lifecycle, data preservation, escaping, stale loads, and existing editing.
- [ ] Run relevant full tests and isolated synthetic-data browser preview. Never sign into a test account in the installed production EXE.
- [ ] Report exact verified scope and outstanding physical-data linkage, if any. Do not claim server deployment or actual models were created.

## Baseline

Existing isolated branch `codex/crm-building-atlas-integration`, HEAD b7f69a6. Focused atlas host/navigation baseline: 27 passed, 0 failed. Existing dist-atlas-verification directories are untracked and must stay untouched.

## Execution evidence

- Task 1 implementation, spec review, and quality review completed. Fixed filtered-customer orphan misclassification, cross-building record mixing, customer intent races, drawer draft-loss paths, and omitted customer-common contracts.
- Root full regression run: 2,001 tests, 2,000 passed, 0 failed, 1 environment-dependent skip.
- Browser verified no standalone 3D entry, model-less building contract lookup, unlinked customer isolation, selected customer in existing consultation form, search without false orphan rows, and native model rendering in unified screen.
- Task 2 implemented and independently passed spec and quality review. Archived units were excluded after review and covered by regression tests.
- Final root regression: 2,007 tests, 2,006 passed, 0 failed, 1 environment-dependent skip. `git diff --check` passed.
- Browser verified explicit unit linking, live unit display, failed-save preservation, read-only rejection, and clearing the previous reference when switching buildings. WebGL-unavailable fallback retained CRM unit information. Console had no runtime errors during normal-path checks.
- Preview uses synthetic records with outbound connections blocked and memory-only atlas writes; installed EXE login and production CRM records were not touched.
- Physical locations remain unverified; no coordinates were inferred from CRM records. Production data, authentication, rules, and deployment unchanged. Delivery is a local development branch and actual-code preview, not an installed update.

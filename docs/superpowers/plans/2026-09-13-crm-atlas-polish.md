# CRM Atlas Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Use checkbox steps.

**Goal:** Apply the user-approved existing CRM visual language without changing data or save behavior.
**Architecture:** Presentation-only changes in the existing workspace/embedded CSS and DOM composition. Keep host/model identity and lifecycle unchanged.
**Tech Stack:** Vanilla JS DOM, CSS, Node tests.

## Task 1 — Clear hierarchy and CRM tokens

Files: desktop-crm/src/building-atlas/customer-workspace.mjs, customer-workspace.css, native/embedded.css; desktop-crm/src/app.js (customer atlas header only); desktop-crm/test/customer-atlas-workspace.test.js, customer-atlas-projection.test.js.

- [ ] Add failing assertions for a labelled profile section, selected building heading, compact metadata rows and accessible tab panels. Preserve all existing draft and selection tests.
- [ ] Run `node --test test/customer-atlas-workspace.test.js test/customer-atlas-projection.test.js` from desktop-crm; verify expected missing presentation behavior fails.
- [ ] Compose profile metadata as labelled DOM rows using `textContent`, e.g. `const row=document.createElement('div'); row.className='customer-atlas-meta-row'; row.textContent=line;`. Do not render source data as HTML.
- [ ] Use existing CRM variables with fallbacks: `--blue:#3182F6; --ink:#191F28; --line:#E5E8EB; --radius:16px`. Make left selection compact, model dominant (desktop viewport >=420px), right card compact and independent from history height. Remove duplicate profile building heading/address when identical to selected model header.
- [ ] Move related history under model in the layout while retaining customer profile and reference panel on the right. Use CSS grid areas and stack left/model/profile/history at narrow widths. Buttons remain visible, >=44px targets on touch screens. Use 150ms color transitions, disabled semantics and focus-visible outline; reduced motion disables transitions.
- [ ] Keep safety warning visible as a compact summary, with original full warning available via details if modified; no assertion of verified building geometry.
- [ ] Run focused tests, syntax checks and desktop/375px browser verification. Check model continues rendering, controls wrap, editing handlers still open, reference binding still works.
- [ ] Independent spec then quality review; root commits task-only files after corrections.

## Task 2 — Delivery

- [ ] Run full desktop tests and diff checks; preserve untracked dist directories.
- [ ] Push normal fast-forward to existing feature branch and update PR #116; no merge/release/tag action.
- [ ] Display actual-code synthetic preview and report production update is pending review.

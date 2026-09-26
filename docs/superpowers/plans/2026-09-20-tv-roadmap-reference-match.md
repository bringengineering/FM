# TV Roadmap Reference Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the real TV roadmap scene and CRM preview to the approved full-width roadmap with three bottom performance panels.

**Architecture:** Keep the existing sanitized publication model and scene rotation. Change only the roadmap render structure and responsive CSS in the desktop preview and public Worker assets.

**Tech Stack:** Electron renderer JavaScript, vanilla DOM, CSS Grid, Cloudflare Worker, Node/Vitest tests.

---

### Task 1: Lock the reference layout in tests

**Files:**
- Modify: `desktop-crm/test/company-wallboard.test.js`
- Modify: `crm-ai-worker/test/wallboard-web.test.js`

- [ ] Add assertions for a full-width roadmap and a three-column performance panel.
- [ ] Run both focused tests and confirm they fail before the CSS change.

### Task 2: Match CRM preview and public TV

**Files:**
- Modify: `desktop-crm/src/company-wallboard.js`
- Modify: `desktop-crm/src/company-wallboard.css`
- Modify: `desktop-crm/src/company-wallboard-theme.css`
- Modify: `crm-ai-worker/src/wallboard-web-assets.js`

- [ ] Move the performance summary below the roadmap.
- [ ] Render overall progress as a circular visual with a text percentage.
- [ ] Keep health and milestone cards beside it.
- [ ] Add 1080p and 768p compaction rules without horizontal scrolling.
- [ ] Increment the public TV web version once.

### Task 3: Verify and release

**Files:**
- Modify only if verification exposes a defect.

- [ ] Run focused desktop, Worker, and company-site wallboard tests.
- [ ] Run full desktop and Worker suites plus company-site field tests.
- [ ] Push the existing branch without force and confirm both GitHub checks pass.
- [ ] Deploy only the Cloudflare Worker and confirm `/tv/version` returns the new version.

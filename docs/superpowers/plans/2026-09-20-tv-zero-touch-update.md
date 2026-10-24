# TV Zero-Touch Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web TV client update data and its own deployed application without manual Ctrl+F5.

**Architecture:** Serve a no-cache version manifest beside the existing TV assets. The already-running TV client polls the manifest once per minute and reloads with a cache-busting query only when the deployed version changes; existing 15-second board polling remains unchanged.

**Tech Stack:** Cloudflare Worker, browser JavaScript, Node.js test runner

---

### Task 1: Define the zero-touch web contract

**Files:**
- Modify: `crm-ai-worker/test/wallboard-web.test.js`

- [ ] Add a failing test asserting `/tv/version` returns JSON with a stable version and `cache-control: no-store`.
- [ ] Add failing assertions that HTML, CSS, and JavaScript use `no-store` and the client polls the version endpoint every 60 seconds.
- [ ] Run `node --test test/wallboard-web.test.js` from `crm-ai-worker` and confirm the new assertions fail for the missing contract.

### Task 2: Implement automatic application refresh

**Files:**
- Modify: `crm-ai-worker/src/wallboard-web-assets.js`

- [ ] Add a single exported web version constant and a `/tv/version` JSON asset.
- [ ] Embed the current version in the client and poll `/tv/version` every 60 seconds with `cache: 'no-store'`.
- [ ] Reload with a version query parameter when the remote version differs; ignore temporary version-check failures while keeping the board visible.
- [ ] Serve HTML, CSS, JavaScript, and the version manifest with `cache-control: no-store`.
- [ ] Run `node --test test/wallboard-web.test.js` and confirm it passes.

### Task 3: Regression verification and deployment

**Files:**
- Verify: `crm-ai-worker/test/*.test.js`

- [ ] Run `npm test` in `crm-ai-worker` and confirm the complete Worker suite passes.
- [ ] Deploy with the existing authenticated Cloudflare Worker configuration.
- [ ] Verify the public `/tv/version` response, cache headers, pairing continuity, board rendering, and scene rotation.
- [ ] Tell the user when the final one-time `Ctrl+F5` should be performed.

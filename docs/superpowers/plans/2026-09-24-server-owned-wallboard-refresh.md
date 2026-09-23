# Server-Owned Wallboard Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use inline execution in this thread; no subagent was requested.

**Goal:** Rebuild and publish the TV snapshot from confirmed Firebase data after a team member saves work, even when an administrator's CRM is closed.

**Architecture:** A new authenticated Worker action accepts only an empty refresh request, verifies the Firebase ID token against the existing company allowlist, then reads five necessary RTDB paths (`workOrders`, `projects`, `data/serviceRecords`, `access`, `teamProfiles`) using that same token and its security rules. The Worker projects a bounded, privacy-reduced snapshot and publishes it to the existing Durable Object with optimistic version retry; the desktop sends the refresh request after successful writes without changing the save result. TV pairing, device tokens, and presentation settings remain unchanged. Production release requires Worker-first rollout and a two-account/two-device check.

**Tech Stack:** Cloudflare Worker ES modules, Firebase RTDB REST, existing `company-wallboard.js` projector and `wallboard-publication-schema.js`, Electron main process, Node tests.

---

### Task 1: Server-side read and publication

**Files:** Create `crm-ai-worker/src/wallboard-server-refresh.js`; create `crm-ai-worker/test/wallboard-server-refresh.test.js`.

- [x] Write a failing test with fake Firebase responses and a fake Durable Object. Assert one project, one done work order, fixed schedule type label, retained playlist, and no source title/phone in the command payload. RED confirmed.
- [x] Add failure tests for denied/oversize/malformed Firebase reads. Assert no `publish` command is sent. RED confirmed.
- [x] Implement `refreshWallboardFromFirebase({idToken, identity, env, fetchImpl, now})`: use only the configured host and five allowlisted paths, `GET`, `auth=<ID_TOKEN>`, a 2 MiB cap per response, and no-store. Use enabled team names, the shared projector and schema, one version-conflict retry, and a version/time-only response.
- [x] Run focused tests, full Worker tests, `git diff --check`, and `wrangler deploy --dry-run`. No service account secret.

### Task 2: Authenticated refresh route

**Files:** Modify `crm-ai-worker/src/wallboard-http.js`, `crm-ai-worker/src/index.js`, `crm-ai-worker/wrangler.toml`; modify `crm-ai-worker/test/wallboard-http.test.js`.

- [x] Add a failing route test: `POST /v1/wallboard/refresh` with `{}` and verified company member calls the server refresh function; unverified identity and non-empty body fail closed. RED confirmed.
- [x] Add `refresh` to the strict action allowlist, verify identity before the source read, rate-limit by verified UID, invoke the refresh module, and return only `{ok,version,publishedAt}`. Add the public RTDB host (not a secret) as `WALLBOARD_FIREBASE_DATABASE_URL`.
- [x] Run route tests and full Worker tests. Pairing/display and prior admin publish pass.

### Task 3: Post-save desktop signal and release gate

**Files:** Create `desktop-crm/src/wallboard-refresh-client.js`; create `desktop-crm/test/wallboard-refresh-client.test.js`; modify `desktop-crm/src/main.js` and the save-signal tests.

- [x] Add a failing client test for a token-authenticated empty `POST` to `/v1/wallboard/refresh`, and retain the existing failed-save/no-signal tests. RED confirmed.
- [x] Implement a bounded background refresh using the existing session token, no redirected endpoint, and a 15-second timeout. Keep confirmed saves successful if refresh fails. Existing local administrator reconciliation remains a fallback.
- [x] Expose a bounded warning for a failed remote refresh in the wallboard sync status, separately from local reconciliation and without raw errors.
- [x] Trigger refresh after a confirmed building-schedule write, but not after an idempotent replay.
- [x] Keep completed projects in the portfolio progress denominator and show `—` when there are no projects.
- [x] Make server publications idempotent for unchanged snapshots while preserving the existing manual publish behavior.
- [ ] Run Electron and browser TV visual QA, `git diff --check`, then commit only intended files; preserve unrelated dirty files.
- [ ] Record release order: Worker route and compatible schema first, then desktop; do not claim the 10-second or administrator-PC-off criterion until a real two-account/two-device test passes. No automatic production deploy in this plan.

**Boundaries:** No AI call, new secret, Firebase rules write, TV device-token change, or customer/source raw payload in the public request. A malformed or forbidden read preserves the last published board instead of replacing it with zeroes.

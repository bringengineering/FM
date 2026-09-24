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

---

## Approved extension: autonomous recovery while all CRM windows are closed

The preceding tasks deliberately use an employee's short-lived ID token. The user approved a separate, read-only Firebase Authentication identity and a five-minute Cloudflare Cron Trigger on 2026-09-24. This extension supersedes the preceding boundary **only** for the dedicated identity, its Worker secret, and the seven path-specific read grants below. It does not authorize a service-account private key, broad Firebase Admin access, a paid plan, or production deployment before the field gate.

### Task 4: Dedicated reader rules, tested in the RTDB emulator

**Files:** `database.rules.json`; `company-site/tests/field/database-rules.test.ts`.

- [ ] Add a fixture identity `wallboard-reader` with a verified email and a `crmCompany/wallboardReaders/wallboard-reader` marker containing `enabled: true` and the exact email. Add a failing rules test: this identity reads exactly `access`, `workOrders`, `projects`, `data/serviceRecords`, `teamProfiles`, `projectWeeklyReports`, and `projectWeeklyReportReviews`; it cannot read another CRM collection or write any of those seven paths. A missing/disabled marker, different UID, unverified email, or changed email must deny.
- [ ] Run the field rules test with the existing Firebase emulator and confirm the expected denial/failed assertion first.
- [ ] Add the marker path with `.read: false` and `.write: false`; bootstrap/revoke it only through a separately confirmed Firebase administrator operation. Extend only the seven existing `.read` expressions with a service condition of the form `auth != null && auth.token.email_verified === true && root.child('crmCompany/wallboardReaders').child(auth.uid).child('enabled').val() === true && root.child('crmCompany/wallboardReaders').child(auth.uid).child('email').val() === auth.token.email`. Do not add the reader to normal `access` roles, and do not change any existing `.write` expression.
- [ ] Re-run the focused and full emulator rules suites. Review the JSON diff to prove the new branch cannot write or read unrelated collections. Commit only rules and tests.

### Task 5: Worker scheduled refresh, tested without credentials

**Files:** `crm-ai-worker/src/wallboard-service-auth.js` (new), `crm-ai-worker/src/wallboard-server-refresh.js`, `crm-ai-worker/src/index.js`, `crm-ai-worker/wrangler.toml`, and focused tests under `crm-ai-worker/test/`.

- [ ] Add failing tests for a disabled schedule, missing secrets, Firebase refresh-token exchange failure, mismatched returned UID, seven successful Firebase reads, and a failed read preserving the prior TV publication. Prove the public `/v1/wallboard/refresh` cannot select the internal service path or supply its own UID.
- [ ] Implement an internal-only token exchange: POST `grant_type=refresh_token` and `refresh_token=<secret>` to `https://securetoken.googleapis.com/v1/token?key=<existing FIREBASE_WEB_API_KEY>`, reject redirects, enforce an 8-second timeout and small response size, and require the returned `user_id` to equal `WALLBOARD_READER_UID`. Never log the refresh token, ID token, API key, or raw Firebase payload.
- [ ] Refactor the existing source-read/project/publish routine so employee-triggered refresh retains its enabled-member check, while only the `scheduled()` handler may call the service-reader path. Keep the seven allowlisted source URLs and fail-closed publication behavior.
- [ ] Add `scheduled(controller, env, ctx)` with `WALLBOARD_SCHEDULED_REFRESH_ENABLED === 'true'` as a release gate. Add `crons = ['*/5 * * * *']` to Wrangler configuration; five minutes is a missed-signal recovery interval, not the normal 20-second TV freshness target.
- [ ] Run focused and full Worker tests, `git diff --check`, and `wrangler deploy --dry-run` locally. Commit only intended code/tests/config. No production secret or deployment in this task.

### Task 6: Provisioning, deployment, and two-device acceptance gate

- [ ] Confirm the company Cloudflare account ID `3c3bcd08bb6ed3a7a8f98c292386c327`, its free plan, and the intended `bring-crm-ai-gateway.bringengineering1008.workers.dev` Worker before any write. The currently configured terminal token belongs to a different account and must never be used for this deployment.
- [ ] With action-time confirmation, create a dedicated Firebase Auth user under the company's Firebase project. Store the UID/email marker in RTDB, configure `WALLBOARD_READER_UID` and the refresh token in Cloudflare Worker variables/secrets through an authorized company session, and activate the schedule only after the deny/allow permission probe succeeds. The credential is entered by the user through a protected UI; it is never pasted into chat, GitHub, or an EXE.
- [ ] Before production rollout, compare the current deployed Worker configuration against the repository, including the currently absent `WALLBOARD_FIREBASE_DATABASE_URL`; preserve existing secrets and TV device storage. Deploy Worker-first with a rollback version recorded.
- [ ] On one paired Windows TV, run at least 30 real saves from a member account with the administrator PC closed. Record server-save confirmation, Worker publication, and TV receive times; accept normal-path median ≤20 seconds and p95 ≤30 seconds. Separately test a deliberately missed signal and prove five-minute scheduled recovery, disabled reader denial, network outage/recovery, and no TV private data. Do not call the path operationally complete before these checks.

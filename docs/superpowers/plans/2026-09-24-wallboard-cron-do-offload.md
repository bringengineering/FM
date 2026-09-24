# TV Cron Durable Object Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the free Cloudflare Cron invocation below its short CPU budget while preserving 5-minute server-owned TV publication.

**Architecture:** Cron only dispatches a private request to a new SQLite-backed `WallboardRefreshJobs` Durable Object. The object runs the existing `refreshWallboardFromService`, which continues to read Firebase with the dedicated account and publish through the existing `WallboardDevices` object. No public refresh endpoint or new credential is introduced.

**Tech Stack:** Cloudflare Workers, SQLite Durable Objects, Wrangler, Node test runner.

---

### Task 1: Fail-first dispatch contract

**Files:** Modify `crm-ai-worker/test/index.test.js`; modify `crm-ai-worker/src/index.js`.

- [ ] Add a test where `createWorker().scheduled` receives `WALLBOARD_REFRESH_JOBS` stub and asserts exactly one private `/refresh` POST and no direct heavy refresh invocation.
- [ ] Run `node --test test/index.test.js`; expect failure because Cron still calls the heavy refresh function directly.
- [ ] Change `scheduled` to resolve the named refresh object and POST `/refresh`, throwing a generic error on non-2xx.
- [ ] Run `node --test test/index.test.js`; expect pass.

### Task 2: Dedicated private refresh object

**Files:** Create `crm-ai-worker/src/wallboard-refresh-jobs.js`; create `crm-ai-worker/test/wallboard-refresh-jobs.test.js`; modify `crm-ai-worker/src/index.js`.

- [ ] Test that only `POST /refresh` is accepted and that it invokes the injected refresh function with the object environment. Test that failures produce a generic 503 without credential text.
- [ ] Run `node --test test/wallboard-refresh-jobs.test.js`; expect failure because the class does not exist.
- [ ] Implement `WallboardRefreshJobs` with constructor `(ctx, env)`, private route check, and `refreshWallboardFromService({env, trace:safeStageLogger})`. Export the class from `index.js`.
- [ ] Run the focused test; expect pass.

### Task 3: Bind, deploy, verify

**Files:** Modify `crm-ai-worker/wrangler.toml`; modify `crm-ai-worker/test/deployment-config.test.js`.

- [ ] Add failing assertions for `WALLBOARD_REFRESH_JOBS` binding and `wallboard-refresh-sqlite-v1` migration.
- [ ] Add the binding and migration for `WallboardRefreshJobs`, keeping the current 5-minute Cron and reader secrets unchanged.
- [ ] Run `npm test` and `git diff --check`; expect pass.
- [ ] Deploy under company Cloudflare OAuth only; inspect two consecutive Cron results, CPU usage, and safe `publish-ok` stage. If unsuccessful, disable the scheduled flag rather than claiming completion.
- [ ] Commit only plan-related source/tests/config; preserve unrelated dirty workspace files.

## Self-review

- The existing Firebase reader UID, secret, rules, TV pairing, and presentation validation remain unchanged.
- The new object is accessible only through a Worker binding, never a public URL.
- No user credentials, Firebase responses, or source records are logged.
- The TV display still polls the same published board; no client reinstall is required.

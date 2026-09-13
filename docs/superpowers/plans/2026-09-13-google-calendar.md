# Read-only Google Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Read selected company Google calendars into the existing work calendar without altering CRM-authored schedules.
**Architecture:** A separate Worker calendar module handles OAuth, synchronization, encrypted token storage and external event cache. Existing Firebase identity protects CRM requests. A serialized Durable Object stores company calendar state and schedules reconciliation. Desktop IPC calls one fixed gateway URL; renderer receives sanitized external events only.
**Tech Stack:** Worker Web APIs, Durable Object storage/alarm, Google OAuth/Calendar REST, Electron IPC, existing vanilla JS calendar.

## Task 1 — Desktop contract and read-only rendering

Files: desktop-crm/src/google-calendar-client.js, google-calendar-ui.js/css, main.js, preload.js, app.js (calendar/settings sections), work-calendar.js, index.html; corresponding google-calendar tests.

- [ ] Write failing tests for validation and external-event rendering. Example: `assert.doesNotMatch(WorkCalendar.render(model,{canWrite:true}), /data-work-calendar-edit="google:/)`; verify CRM records remain editable in the same output.
- [ ] Fixed IPC `googleCalendar(input)` calls POST `/v1/calendar` with Firebase bearer. Allowed actions: `status`, `connect`, `calendars`, `select`, `sync`, `events`, `disconnect`. `events` accepts month YYYY-MM; `select` accepts up to 5 calendar IDs plus `shareConfirmed:true`. `disconnect` requires confirmation in UI. All other input keys rejected.
- [ ] Client uses timeout, fixed HTTPS endpoint, sanitized errors and no raw token logging. `connect` opens only a returned HTTPS accounts.google.com/o/oauth2/v2/auth URL in system browser from main process; browser URL is never accepted from the renderer.
- [ ] Render settings card with company account, selected calendars, minimum shared fields notice, status and last successful sync. Unconfigured API returns a clear non-connected state. Existing calendar renders regardless of external failure.
- [ ] Existing `WorkCalendar.buildModel(store,{externalEvents:[...]})` consumes normalized external events separately from serviceRecords. External event fields: id,calendarId,title,description,location,start,end,allDay,status. Expand multi-day spans into visible dates only, end exclusive for all-day, timed dates in Asia/Seoul. Cancellation excluded, calendar+event identity de-duplicated, escaped data. External items show Google/read-only label, never edit/complete buttons.
- [ ] Renderer refreshes only calendar cache/status every 60 seconds while calendar view is active and on explicit refresh. Authenticate generation/UID guards discard stale responses and clear cached data on logout. No persisted external data in regular CRM store.
- [ ] Run client/model/UI tests red then green, full desktop tests; independent spec/quality review before commit.

## Task 2 — Google sync engine

Files: crm-ai-worker/src/calendar/google-api.js, sync.js; crm-ai-worker/test/calendar-sync.test.js.

- [ ] Failing tests: pagination failure leaves old snapshot/token; changed event replaces same ID; cancellation removes external only; 410 rebuilds; invalid dates rejected; bounded request/page limits.
- [ ] Implement exported `syncCalendar({calendarId,previous,accessToken,fetchImpl,now,window})`. Initial full fetch uses singleEvents=true, showDeleted=true, maxResults=1000, a stored bounded window covering 90 days past and 365 future. Incremental requests use stored syncToken and fixed compatible params, excluding timeMin/timeMax. Refresh bounded window via full sync daily. Do not publish partial page results. Clamp cache to the stored window after each successful cycle.
- [ ] Sanitize only id/calendarId/title/description/location/start/end/allDay/status. No attendee email or attachment import. Limits: 50 pages, 10,000 retained events/calendar; fail explicitly without clearing old data on overflow. Handle 429/5xx as retryable and 401/invalid_grant as reconnect state.
- [ ] Test actual engine using injected fetch; no live Google calls or credentials needed.

## Task 3 — OAuth, secure store and Worker routes

Files: crm-ai-worker/src/calendar/index.js, oauth.js, store.js; crm-ai-worker/src/index.js; crm-ai-worker/wrangler.toml; corresponding tests.

- [ ] Disabled by default (`CALENDAR_ENABLED=false`). Missing client ID/secret, public callback origin, configured company email, encryption key or CALENDAR_STATE binding returns status `unconfigured`, not false success.
- [ ] Add serialized Durable Object `CompanyCalendarState` (one company ID) with AES-GCM encrypted OAuth refresh token under a 32-byte base64 Worker secret `CALENDAR_ENCRYPTION_KEY`. Plaintext token never leaves server. OAuth state/verifier expires after 10min and consumed once; start is admin-only, PKCE S256, exact configured redirect. Scopes: openid,email,calendar.calendarlist.readonly,calendar.events.readonly. Callback validates state, token scope and Google userinfo verified email equals configured `GOOGLE_CALENDAR_COMPANY_EMAIL` before enabling account.
- [ ] Connect/select/disconnect/sync require allowed verified admin identity; events/status allowed CRM identity. Reuse gateway Firebase validation, fail closed on disabled users. Callback and webhook are narrowly public routes, not bypasses to other actions. No arbitrary redirect, endpoint or company/calendar IDs supplied by clients.
- [ ] Return contract: status `{ok:true,status,accountEmail,selectedCalendars,lastSyncedAt,errorCode,canManage}`; calendars `{ok:true,calendars:[{id,name}]}`; events `{ok:true,events,lastSyncedAt,status,window}`; connect `{ok:true,authorizationUrl}`. Selected calendars must be fetched from this connected account's list; `shareConfirmed` required.
- [ ] Select does complete first sync before publishing selection/cache. Use original connection unchanged if a replacement OAuth fails. Disconnect stops collection/channels, revokes when possible, clears imported event cache and token, never CRM-native records.
- [ ] Register watches per selected calendar, validate webhook channel/resource/token then refetch. Durable Object alarm every 5min reconciles changes and renews channels before expiry. Serialize all state mutations so concurrent OAuth/select/webhook cannot lose updates. Keep last successful snapshot on failure and expose stale status.
- [ ] Preserve existing Worker handlers/config. New binding/migration is source configuration only until explicitly deployed. Test OAuth replay/mismatch, readonly, bad webhook, pagination, expired token, failed select and disconnect.
- [ ] Independent security/spec then quality review. Run `node --test test/*.test.js` from crm-ai-worker.

## Task 4 — Integration and release handoff

- [ ] Synthetic preview exercises connected/disconnected/permission-expired states, calendar/date rendering, readonly Google items and existing CRM editing.
- [ ] Document exact setup fields, registered callback/webhook URLs, secret names (not values), selected calendar sharing, OAuth consent and reconnect procedure in release/google-calendar-setup.md.
- [ ] Check configured infrastructure read-only. Do not extract unrelated credentials, change company IAM or create access grants implicitly. Missing OAuth app or user consent stops live activation, not local code/testing.
- [ ] Root tests both suites, pushes feature branch normally and updates PR #116. No merge, release tag, Functions or Hosting deployment.

## Verification baseline

Desktop baseline: 2,007 tests, 2,006 pass, 0 fail, 1 environment skip. PR #116 existing CI desktop and backend/rules both passed. UI polish is a separate concurrent presentation task; calendar modifications to app.js are confined to calendar/settings and must preserve its changes.

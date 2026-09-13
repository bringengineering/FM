# Google Calendar read-only company integration

This change is **disabled by default** (`CALENDAR_ENABLED = "false"`). No production deployment, OAuth consent, account connection, or secret provisioning is part of this change. Deploying the existing Worker for any other reason also applies its newly declared Durable Object migration; obtain approval before doing so.

## Provisioning checklist (separate approved operation)

1. Enable Google Calendar API in the chosen Google Cloud project. Create a **Web application** OAuth client and configure its consent audience/test user appropriately for the company account.
2. Set `GOOGLE_CALENDAR_PUBLIC_ORIGIN` to the exact canonical HTTPS Worker origin, with no trailing slash, path, credentials, query, or fragment. Register this exact authorized redirect URI: `<GOOGLE_CALENDAR_PUBLIC_ORIGIN>/v1/calendar/oauth/callback`.
3. Google push notifications target `<GOOGLE_CALENDAR_PUBLIC_ORIGIN>/v1/calendar/webhook`. The origin must be public HTTPS and meet Google's push-channel address requirements. No arbitrary callback/notification URL is accepted from CRM clients.
4. Provision Worker secrets through the approved secret-management process, without pasting their values into source, logs, screenshots, or release notes:

   - `GOOGLE_CALENDAR_CLIENT_ID`
   - `GOOGLE_CALENDAR_CLIENT_SECRET`
   - `CALENDAR_ENCRYPTION_KEY`: cryptographically random **32 bytes**, standard Base64-encoded. Retain securely; changing it prevents decrypting the existing refresh token and requires reconnection.

5. Set configuration `GOOGLE_CALENDAR_COMPANY_EMAIL` to the one authorized company Google account and `GOOGLE_CALENDAR_PUBLIC_ORIGIN` as above. Existing `FIREBASE_WEB_API_KEY`, `CRM_ALLOWED_EMAILS`, `CRM_ADMIN_EMAILS`, and `ALLOWED_ORIGINS` continue to govern CRM access. Administrators must also be allowed CRM users and have a verified Firebase email. Disabled Firebase users are rejected.
6. The checked-in `CALENDAR_STATE` binding references exported class `CompanyCalendarState`; migration `calendar-v1` declares `new_sqlite_classes = ["CompanyCalendarState"]`. This is a dedicated strongly consistent Durable Object, not the existing AI/document KV namespaces. Review and deploy this migration only with approval.
7. Only after all configuration is in place, approve enabling `CALENDAR_ENABLED = "true"`. Missing/invalid configuration fails closed. Authenticate in CRM as a verified allowed administrator, choose Connect, consent using the configured company Google account, return to CRM, and choose 1–5 calendars. Explicitly confirm that their imported event details may be shown to all allowed CRM users. The first complete sync must succeed before the new selection is published.

Requested OAuth scopes are exactly `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.events.readonly`. Google’s canonical `userinfo.email` spelling is accepted in the returned grant. Calendar write scopes are rejected. OAuth uses PKCE S256 and a 10-minute one-use state; the callback verifies the Google account’s verified email. Failed replacement attempts do not overwrite the original connection. Successful replacement clears the previous selection and requires a new explicit sharing confirmation.

## Desktop API

All actions use `POST /v1/calendar`, `Authorization: Bearer <Firebase ID token>`, and JSON. The only public endpoints are exact `GET /v1/calendar/oauth/callback` and `POST /v1/calendar/webhook`; the latter validates channel ID, resource ID, secret channel token, expiration, and resource state. Webhook bodies are never imported as events.

| Action | Input fields besides `action` | Access | Result |
| --- | --- | --- | --- |
| `status` | none | Allowed CRM identity | `ok,status,accountEmail,selectedCalendars,lastSyncedAt,errorCode,canManage` |
| `events` | `month: "YYYY-MM"` | Allowed CRM identity | `ok,events,lastSyncedAt,status,window` |
| `connect` | none | Verified allowed administrator | `ok,authorizationUrl` |
| `calendars` | none | Verified allowed administrator | `ok,calendars: [{id,name}]` |
| `select` | `calendarIds: [...]`, `shareConfirmed: true` | Verified allowed administrator | Status response after atomic selection/sync |
| `sync` | none | Verified allowed administrator | Status response after successful sync |
| `disconnect` | none | Verified allowed administrator | Disconnected status |

Status is one of `unconfigured`, `disconnected`, `awaiting_selection`, `connected`, `stale`, `reconnect`. `selectedCalendars` contains only `{id,name}`. Timestamp fields are ISO strings or `null`. Events contain only `id,calendarId,title,description,location,start,end,allDay,status`. Timed dates retain their explicit offset; all-day dates stay `YYYY-MM-DD`, with Google's exclusive end date. No attendee/attachment fields are requested or returned. Description text is untrusted and must be rendered as escaped text by the desktop.

`window` is `{timeMin,timeMax}`. Month reads include a one-day UTC boundary cushion so the desktop can perform local-month filtering correctly. Error envelopes are `{ok:false,code}`; common codes are `CALENDAR_UNCONFIGURED`, `CALENDAR_RECONNECT`, `CALENDAR_INVALID_INPUT`, `CALENDAR_TEMPORARY_FAILURE`, `FORBIDDEN`, and `AUTH_REQUIRED`. Additional safe validation codes cover sharing confirmation, OAuth state/scope/account mismatch, and cache limits; clients should display a generic failure for unknown codes.

## Synchronization and recovery

- Single company object serializes actions, callbacks, webhooks, and alarms. Snapshot shards and their manifest are committed atomically in a storage transaction; AI usage, document delivery, and CRM records are never modified.
- Full reads expand recurring instances with `singleEvents=true`, include deletions, request up to 1,000 events/page, and use a rolling 90-day past / 365-day future range. Full window refresh occurs at least daily. Incremental reads reuse compatible parameters and omit `timeMin/timeMax` with `syncToken`.
- Limits: 50 pages/calendar, 10,000 retained events across the company, and 16 MB serialized imported snapshot data. Limit failures preserve the previous published snapshot; narrow the selected calendars to recover.
- Every Google request uses a 12-second timeout and rejects redirects. Paging has a fixed maximum; large first syncs can outlast the desktop’s 20-second request timeout. If the desktop times out, leave the connection intact and refresh status later; no incomplete snapshot is published.
- HTTP 410 rebuilds a full calendar snapshot. HTTP 429/5xx/network failures retain the last cache, expose `stale`, and retry on the five-minute alarm. Invalid/revoked refresh grants expose `reconnect`, retaining old cache until a successful reconnect or disconnect.
- Watches are registered for selected calendars and renewed an hour before expiration. Failed watch registration falls back to five-minute reconciliation and is retried. Valid webhook hints schedule an early alarm; alarms fetch Google again. Notification loss does not prevent periodic reconciliation.
- Disconnect clears the integration’s encrypted refresh token, imported events, pending OAuth state, and alarm, then best-effort stops Google watch channels and revokes the grant. It does not delete Google events or CRM records. Grant revocation may require manual cleanup in the Google account if Google is unavailable.

## Local verification and launch gate

Run `npm test` in `crm-ai-worker`. Injected-fetch tests cover auth/config closure, disabled users, PKCE/state expiry/replay, account mismatch, scope rejection, encrypted storage, admin-only mutations, atomic failed selection, pagination failure, cancellation, HTTP 410/429, daily windows, cache limits, webhook validation, alarm re-fetching, and concurrent callback serialization. These tests do not contact Google or Cloudflare.

Before production enablement, separately approve and perform a staging smoke test with the actual Google client, HTTPS push registration, the deployed SQLite-backed Durable Object, initial selection, recurring/all-day/time-zone examples, incremental edit/cancellation, reconnect, and disconnect. Node unit tests do not substitute for this live configuration/runtime check.

Reference: [Google incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync), [events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [push notifications](https://developers.google.com/workspace/calendar/api/guides/push), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

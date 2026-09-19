# TV pairing implementation plan

**Goal:** Connect a read-only Windows TV using administrator-approved enrollment, without copying staff credentials.
**Architecture:** A pairing state machine uses a serializable repository. Only the authenticated gateway may provide administrator identity. HTTP routes remain disabled until durable storage and request limiting are configured and tested.
**Tech stack:** Existing Worker JavaScript, Web Crypto, node:test; durable transaction adapter next.

- [x] Add failing lifecycle tests in `crm-ai-worker/test/wallboard-pairing.test.js`.
- [x] Implement `createPairingService` in `crm-ai-worker/src/wallboard-pairing.js`.
- [x] Check admin approval, ten-minute expiry, one-time redemption, concurrency, revocation, pending and approval attempt limits, hashed token storage.
- [x] Run `node --test test/*.test.js` in `crm-ai-worker`: 44 passed.
- [ ] Implement and test real durable transaction storage adapter. In-memory test repository is not production storage.
- [ ] Add fail-closed HTTP routes: trusted Firebase admin verification, request size limits, public enrollment rate limits, no-store responses, fixed service binding.
- [ ] Add administrator device list/approval/revocation UI, TV enrollment UI and protected Windows token storage.
- [ ] Add approved display snapshot and versioned playlist publication with server-side schema validation.
- [ ] Verify actual two-client playback, revocation and restart before production deployment.

## HTTP/storage implementation progress
- Added `/v1/wallboard/start|poll|approve|revoke|list` POST routes. They return unavailable unless explicit enablement, dedicated storage binding and rate limiter all exist.
- Administrator identity comes only from the existing Firebase verifier plus verified email/admin allowlist. Request bodies cannot inject identity.
- `WallboardDevices` adapter stores pairing state inside a durable storage transaction. Node tests use a transactional stand-in; actual Cloudflare runtime verification is still required.
- Payload reads are bounded to 4096 bytes. Enrollment token is accepted only through Authorization and never forwarded for administrator actions. Responses are no-store.
- No Wrangler bindings/migrations were added and no cloud deployment was performed.

## Administrator UI progress
- Added `wallboard-admin-ui.js` under the board with registration code/name, refreshable device list and confirmation before revoke.
- Added canonical IPC/preload bridge. Employee ID token stays in main process; client accepts only list/approve/revoke and a fixed gateway origin, disables redirects, uses timeout and sanitizes returned fields.
- Registered the bridge as a mutation in the existing marketing restriction policy. Server remains authoritative for administrator permissions.
- Verified desktop tests: 2157 passed, 2 skipped. Three DOM test files: 27 passed.
- Actual production registration remains unavailable until backend deployment. Windows TV enrollment/display client is not implemented yet.

## Published board delivery
- Added strict publication schema: bounded staff aggregates, exact count totals, generic schedule entries, date, notice and approved playlist keys. Unexpected fields are rejected recursively.
- `publish` requires verified administrator identity and expected version; concurrent outdated publication is rejected rather than overwriting newer content.
- `display` requires device token and checks revocation in the same transaction as reading board data; response never contains pairing/admin credentials.
- Server-generated version/publishedAt accompany the source data date. No automatic refresh or freshness claim is added: current publication is an explicit snapshot.
- Worker suite: 52 passed. Actual cloud runtime and desktop publication button still require implementation/verification.

## Desktop publication control
- Added explicit publish button with notice/privacy confirmation, source date and current local playlist.
- Uses last loaded server revision; conflicts fail visibly and require refresh. Source load failure or age over two minutes blocks publication.
- Main-process bridge handles credentials; renderer receives only sanitized revision/timestamps and roster fields.
- Verification: desktop 2158 passed / 2 skipped; UI suites 28 passed.
- Still manual snapshot publication: continuous automatic refresh publication and dedicated Windows TV playback are unfinished. Cloud storage/deployment and actual TV acceptance tests remain mandatory.

## Windows TV client implementation
- Added separate `wallboard-tv-main.js` entry (`npm run tv` for developer execution), its own BRING-TV user-data directory, restricted preload and read-only renderer.
- Device token stays in main process; Windows safeStorage encryption is required before persistence. Renderer receives only code/expiry or validated publication. CRM staff session is not loaded.
- TV polls approval every 5 seconds while pending, and publications every 60 seconds; playback follows posted ordering/durations. Revocation removes displayed board. Offline state retains the last display with a warning.
- Shared publication schema is reused by Worker and desktop. Tests cover enrollment secrecy, temporary network failure, revocation and renderer lifecycle.
- No installed TV executable yet. Actual Windows encryption/restart, TV viewport verification, Worker bundling with shared schema, cloud runtime, deployment and automatic source refresh remain unverified/unfinished.

No deployment configuration or cloud resources changed. Existing AI, Telegram and Kakao endpoints remain unchanged.
Storage reference: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/

## Actual local Worker runtime verification
- Added isolated `test/runtime/verify-wallboard.cjs` with a local-only fixture/config. Its synthetic administrator identity is for this fixture only; never deploy it. Production Firebase verification is unchanged.
- Verified real workerd SQLite Durable Object storage: concurrent enrollment redemption yields one success and one unauthorized response; concurrent version-0 publications yield one success and one conflict; a complete runtime stop/restart preserves the board/device; revoked devices receive 401.
- The bundled local runtime supports compatibility date 2026-05-22, so the fixture uses that date. Production remains 2026-08-30. This is local runtime evidence, not verification of production configuration/date or Firebase login.
- Production Worker dry-run bundling passed, including shared desktop publication schema. No remote resources or deployments were created.
- Next required work: automatic source publication, Windows encryption/restart and installer, actual production bindings/approval, two-computer acceptance. The remote TV feature is not yet production-ready.

## Automatic publication implementation
- Added explicit start/stop controls and main-process 60-second publisher; navigating away from the board does not stop it. App exit stops it, restart requires renewed opt-in. This is not an always-on cloud scheduler.
- Publication freezes the approved notice/playlist; work aggregates and today's service schedule are re-read. Source uses read-only server requests, not `loadStore`, because that existing function can resume pending writes and merge local data.
- Authentication change stops publication. Requests never overlap. Source/network failure keeps the previous revision and displays an error; authorization or revision conflict stops the publisher. Manual publishing stops this local automatic publisher.
- TV playback keeps its current scene/page when only data version changes, preventing frequent refreshes from starving later scenes.
- Verified desktop suite: 2167 passed, 2 skipped, 0 failures. Three focused UI suites: 9 passed. No production deployment/installation performed. Actual two-computer automatic delivery and Windows installer remain unverified.

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

No deployment configuration or cloud resources changed. Existing AI, Telegram and Kakao endpoints remain unchanged.
Storage reference: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/

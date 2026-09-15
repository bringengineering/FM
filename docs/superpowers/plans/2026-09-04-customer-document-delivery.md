# Customer Document Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a review-first CRM workflow that sends quotation and completion-report links through Kakao Alimtalk or SMS and records delivery state safely.

**Architecture:** A pure `document-delivery-core` module owns validation, message composition, state transitions, expiry, and retry rules. The existing customer-message workspace renders the document-delivery tab and calls narrow preload/main APIs; the main process forwards authenticated requests to the company gateway without storing provider credentials. Until a gateway reports a configured channel, the UI remains usable for preview and history but external send is disabled.

**Tech Stack:** Electron, browser JavaScript UMD modules, Node.js, Firebase-backed CRM store, company gateway HTTP API, Node test runner.

---

### Task 1: Document delivery domain model

**Files:**
- Create: `desktop-crm/src/document-delivery-core.js`
- Create: `desktop-crm/test/document-delivery-core.test.js`

- [ ] **Step 1: Write failing validation and transition tests**

Test that `createDraft` accepts only `quote` and `completion_report`, normalizes a Korean phone number, defaults to `kakao`, calculates a 14-day expiry, and never stores raw PDF bytes. Test `markRequested`, `markDelivered`, `markFailed`, `markOpened`, `markExpired`, and `createSmsFallback` as immutable state transitions; fallback must require a failed Kakao record and create a new SMS record with its own ID.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/document-delivery-core.test.js`
Expected: FAIL because `document-delivery-core.js` does not exist.

- [ ] **Step 3: Implement the minimal pure domain module**

Export `DOCUMENT_TYPES`, `CHANNELS`, `STATUSES`, `createDraft(input, options)`, `composeMessage(draft)`, `transition(record, status, metadata)`, and `createSmsFallback(record, options)`. Reject invalid phone numbers, missing customer/document IDs, expiry over 14 days, invalid transitions, and message text containing advertising language when `purpose` is `informational`.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test test/document-delivery-core.test.js`
Expected: PASS.

Commit: `feat(crm): add document delivery domain model`

### Task 2: Customer-message document delivery UI

**Files:**
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/message-ui.js`
- Modify: `desktop-crm/src/message.css`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/test/message-ui.test.js`
- Create: `desktop-crm/test/document-delivery-ui.test.js`

- [ ] **Step 1: Write failing UI contract tests**

Assert that the message workspace has `안내 메시지` and `문서 발송` tabs; the document form exposes customer, document type, document ID, Kakao/SMS channel, expiry, message preview, PDF preview, send confirmation, and delivery history. Assert that quotation and completion-report views expose `data-document-send-entry` buttons.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test test/message-ui.test.js test/document-delivery-ui.test.js`
Expected: FAIL because the document tab and entry actions are absent.

- [ ] **Step 3: Implement render-only document workflow and state wiring**

Load `document-delivery-core.js` before `message-ui.js`. Add `selectedMessageMode`, selected document/customer/channel/expiry state in `app.js`; render a review card from `MessageUI.renderDocumentDelivery`. A document entry action opens `customerMessages`, selects the linked customer and document, and never sends during navigation or preview.

- [ ] **Step 4: Add responsive styles and run tests**

Run: `node --test test/message-ui.test.js test/document-delivery-ui.test.js test/ai-ui.test.js`
Expected: PASS, including mobile single-column layout and no hidden horizontal overflow.

Commit: `feat(crm): add customer document delivery workspace`

### Task 3: Narrow gateway and Electron bridge

**Files:**
- Create: `desktop-crm/src/document-delivery-client.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/app.js`
- Create: `desktop-crm/test/document-delivery-client.test.js`
- Create: `desktop-crm/test/document-delivery-bridge.test.js`

- [ ] **Step 1: Write failing request-boundary tests**

Test `GET /v1/document-delivery/capabilities`, `POST /v1/document-delivery/documents`, `POST /v1/document-delivery/messages`, `GET /v1/document-delivery/messages/:id`, and `POST /v1/document-delivery/documents/:id/revoke`. Require an authenticated session token, bounded PDF size, allowlisted MIME type, idempotency key, timeout, and sanitized errors. Assert that renderer APIs expose no provider key and cannot choose arbitrary URLs.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test test/document-delivery-client.test.js test/document-delivery-bridge.test.js`
Expected: FAIL because the client and IPC endpoints are absent.

- [ ] **Step 3: Implement the client and IPC boundary**

Add a fixed company-gateway base URL, authenticated request helper, response schema validation, and narrow IPC handlers. Expose `readDocumentDeliveryCapabilities`, `createDocumentDeliveryLink`, `sendCustomerDocument`, `readCustomerDocumentDelivery`, and `revokeCustomerDocument` through preload. Do not persist PDF bytes, bearer tokens, public links, or provider responses in renderer state.

- [ ] **Step 4: Wire safe disabled and error states**

If both channels are unavailable, keep preview/history enabled and show `연동 준비 필요`; if one channel is configured, enable only that channel. A send request is created only after a confirmation dialog, and unknown outcomes remain `확인 중` until status refresh.

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/document-delivery-client.test.js test/document-delivery-bridge.test.js test/document-delivery-ui.test.js`
Expected: PASS.

Commit: `feat(crm): connect document delivery gateway boundary`

### Task 4: CRM history projection and fallback

**Files:**
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/message-ui.js`
- Create: `desktop-crm/test/document-delivery-history.test.js`

- [ ] **Step 1: Write failing history tests**

Test that delivery records retain document version, customer ID, masked phone, channel, template version, actor, timestamps, provider message ID, status, failure code, and fallback parent ID. Ensure secret keys, complete provider responses, PDF bytes, and public links are removed during normalization.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test test/document-delivery-history.test.js`
Expected: FAIL because normalized CRM delivery history lacks the new document fields.

- [ ] **Step 3: Implement normalized history and manual SMS fallback**

Persist only the allowlisted audit fields through the existing server-save path. Render status chips for requested, delivered, failed, opened, expired, and revoked. Show `SMS로 다시 보내기` only for failed Kakao messages and require a second confirmation.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/document-delivery-history.test.js test/message-ui.test.js`
Expected: PASS.

Commit: `feat(crm): track document delivery history and fallback`

### Task 5: Full verification and release

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-customer-document-delivery-design.md` only if verification reveals a documented mismatch.

- [ ] **Step 1: Run syntax and focused security checks**

Run: `node --check src/app.js && node --check src/main.js && node --check src/preload.js`
Expected: all commands exit 0.

- [ ] **Step 2: Run the complete desktop suite**

Run: `node --test test/*.test.js`
Expected: all tests PASS with zero failures.

- [ ] **Step 3: Check the patch and repository state**

Run: `git diff --check && git status --short`
Expected: no whitespace errors and only intended files changed.

- [ ] **Step 4: Push without force and verify automation**

Run: `git push origin HEAD:codex/bring-field-platform`
Expected: fast-forward push. Monitor `CRM CI` and `CRM Automatic Release`, then confirm the published release contains exactly the installer, blockmap, and `latest.yml` and that the public update pointer reports the new version.

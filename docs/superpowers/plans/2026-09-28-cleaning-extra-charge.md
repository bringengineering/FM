# Cleaning Extra Charge Implementation Plan

> **For agentic workers:** Execute task-by-task in this session, retaining the verified user-approved screen scope. Use test-first changes and do not report delivery or approval that did not occur.

**Goal:** Implement screenshot 32 as a persisted extra-charge request, customer-approval communication attempt, and auditable manual customer decision flow.

**Architecture:** Add a dedicated revisioned request collection instead of changing invoices or dispatch records. The server validates canonical order/customer/partner relationships and admin authorization. The CRM detail modal uses only canonical facts and authenticated Drive evidence. Customer SMS goes through the existing allow-listed customer-message path; delivery failure stays visible and never counts as approval.

**Tech Stack:** Firebase Functions TypeScript, Realtime Database transactions, Apps Script customer-message template allow-list, desktop CRM JavaScript, node:test, Vitest.

---

### Task 1: Extra-charge domain contract

**Files:**
- Modify: `functions/src/cleaning-partners/contracts.ts`
- Modify: `functions/src/cleaning-partners/core.ts`
- Test: `functions/test/cleaning-partners.test.ts`

- [x] Add test cases before implementation for invalid amount, invalid reason, more than five evidence references, duplicate ID, stale revision, terminal request, and approval without evidence.
- [x] Run `pnpm exec vitest run test/cleaning-partners.test.ts` and confirm the new cases fail because the request lifecycle does not exist.
- [x] Add bounded `CleaningExtraChargeRequest` fields: request/order/customer/building/partner IDs, service type, positive integer KRW, reason, up to five Drive file IDs, `revision`, `createdAt`, `updatedAt`, status `draft | awaiting_customer_approval | approved | declined`, sender/provider result, approval evidence/time, and append-only events.
- [x] Add pure create/send-result/review decisions. Customer delivery acceptance may change only communication state; approval/decline must require an authenticated admin, expected revision, timestamp, and evidence reference.
- [x] Run `pnpm exec vitest run test/cleaning-partners.test.ts` and confirm all lifecycle and validation cases pass.

### Task 2: Transactional canonical persistence and admin endpoint

**Files:**
- Modify: `functions/src/cleaning-partners/firebase-adapter.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/test/cleaning-partners-firebase-adapter.test.ts`
- Test: `functions/test/index-entrypoints.test.ts`

- [ ] Write adapter tests proving request creation checks the canonical cleaning order, customer/building match, and a currently accepted partner; prove concurrent revision updates fail without overwriting.
- [ ] Write endpoint tests proving only admin CRM sessions can create, inspect and record a customer decision; reject extra input fields, invalid evidence IDs and stale revisions.
- [ ] Run the two focused Vitest files and observe the new assertions fail before adding production code.
- [ ] Persist under `crmCompany/cleaningPartnerExtraCharges/{orderId}/{requestId}` with RTDB transactions. Do not write invoice, receipt or settlement collections.
- [ ] Add admin actions for create, inspect and record decision. Re-read canonical order/customer/vendor before every mutation and return only masked customer contact details.
- [ ] Run focused tests and `pnpm exec tsc --noEmit -p tsconfig.json`.

### Task 3: Customer approval message path

**Files:**
- Modify: `apps-script/complaint-intake-to-firebase.gs`
- Test: `apps-script/customer-message-policy.test.js`
- Test: `apps-script/customer-message-delivery.test.js`
- Modify: `desktop-crm/src/remote.js`
- Test: `desktop-crm/test/cleaning-partner-management.test.js`

- [ ] Add a non-marketing `cleaning_extra_charge_approval` template key with source validation against canonical cleaning orders and bounded variables for order ID, service, amount, and reply instructions.
- [ ] Test that a missing approved provider template or failed provider response is rejected/recorded as unsent, while a successful provider acceptance records a delivery ID and does not mutate customer approval status.
- [ ] Verify red tests before implementation; then add the template route and CRM API wrapper that calls the existing allow-listed customer-message workflow with the customer's explicit selected channel.
- [ ] Preserve the provider's actual `accepted` / `failed` status and request ID in the extra-charge event; never infer delivery from opening the send form.
- [ ] Run the existing Apps Script/CRM messaging tests and the focused partner management test.

### Task 4: CRM modal and audit trail

**Files:**
- Modify: `desktop-crm/src/cleaning-center-ui.js`
- Modify: `desktop-crm/src/cleaning-center.css`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/remote.js`
- Test: `desktop-crm/test/cleaning-partner-management.test.js`

- [ ] Add UI tests for the exact screen fields, five-photo maximum, pending/sent/failed states, request event history, required reason, and required customer-decision evidence.
- [ ] Run tests to verify the reference UI and interactions are missing before implementation.
- [ ] Add an authenticated native picker/upload action for up to five JPEG/PNG/WebP work photos under a cleaning-order extra-charge evidence folder; use actual Drive file IDs in the request.
- [ ] Add a modal reachable from the cleaning order detail and partner work context. Populate order/customer/partner/current-service from canonical records, show masked phone, allow only evidence uploaded by that action, and show current approval state and history.
- [ ] Add separate actions to save a request, send the configured customer message, and record a manually confirmed customer response with evidence. Disable sending if the customer/template/channel is ineligible; do not treat staff clicks as customer approval.
- [ ] Run the focused test and `node --check src/app.js`.

### Task 5: Full relevant verification and screen audit

**Files:**
- Modify: `docs/superpowers/plans/2026-09-27-cleaning-34-screen-coverage-audit.md`

- [ ] Run partner core/adapter/endpoint tests, CRM partner tests, Apps Script messaging tests, field partner tests, and Functions/Field TypeScript checks.
- [ ] Run the full CRM suite with `node --test test/*.test.js`.
- [ ] Inspect the final diff, `git diff --check`, and confirm no invoice, payment, or settlement mutation is introduced by this feature.
- [ ] Update screen 32's evidence and limitations in the 34-screen audit only after all relevant checks pass.

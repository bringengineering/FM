# Cleaning Partner App and Dispatch Implementation Plan

> **For agentic workers:** Execute inline in this thread, task-by-task. Keep the goal active until the referenced screens and security behavior are implemented and verified.

**Goal:** Implement the mobile partner dashboard and its real, vendor-scoped work offer, response, and reassignment flow for reference screens 16 and 20–23.

**Architecture:** Add a server-owned partner account binding and dispatch offer store, exposed only through an authenticated Functions endpoint. Admin CRM users bind a verified login email to a vendor and issue offers; the partner app authenticates with Firebase, obtains only that vendor's minimal offer records, and responds through revision-checked server mutations. The app must not expose customer contact/address before accepted work starts, and must show payout only when a real offer contains an approved integer amount.

**Tech Stack:** Firebase Functions (TypeScript), Realtime Database transactions, Firebase Auth/App Check, Next.js/React partner route, desktop CRM partner/dispatch controls, Vitest and Node tests.

---

## Scope and invariants

- Build screens 16 (partner dashboard), 20 (offer), 21 (decline), 22 (no response/expiry), and 23 (reassignment) as one connected flow.
- Bind a normalized, verified email to exactly one active cleaning vendor. Do not grant a partner a CRM `admin/member/viewer` role.
- Keep account bindings and offer state server-owned; direct client reads/writes are denied by existing default-deny database rules.
- Each offer has a server-generated ID, canonical cleaning order ID, vendor ID, supplier amount in won, expiry, status, revision, and audit events.
- Accept and decline are conditional transactions. Expired offers cannot be accepted; a second vendor cannot accept after another vendor has won the order.
- Partner responses are scoped to the vendor resolved from the verified Firebase token. Never accept a vendor ID supplied by the partner client as authority.
- The app receives only region, service, size, date and the offer amount before acceptance. Customer identity, full address, and phone stay out of the partner response payload.
- Do not invent earnings, ratings, settlement completion, travel times, or live location. Show missing sources as unavailable.
- Keep production deployment disabled; verify with local unit tests and emulator tests only.

## File map

- Create `functions/src/cleaning-partners/contracts.ts` and `functions/src/cleaning-partners/core.ts` for offer validation and state decisions.
- Create `functions/src/cleaning-partners/runtime.ts` for injected database operations and transactional partner actions.
- Modify `functions/src/index.ts` to add token/App Check authorization, server endpoint, and admin-only account binding/offer creation.
- Add `functions/test/cleaning-partners.test.ts` and extend `functions/test/index-entrypoints.test.ts` for authorization and endpoint behavior.
- Add `company-site/app/partner/page.tsx`, `PartnerApp.tsx`, `partner.css`, and `lib/cleaning-partner-api.client.ts` for the mobile partner experience.
- Extend `desktop-crm/src/cleaning-center-ui.js`, `desktop-crm/src/app.js`, and `desktop-crm/src/cleaning-center.css` with vendor account binding and offer/reassignment actions.
- Extend `desktop-crm/test/cleaning-partner-management.test.js` and add `desktop-crm/test/cleaning-partner-app.test.js` for admin UI and route contracts.
- Update the 34-screen coverage audit only after corresponding behavior is implemented and verified.

## Tasks

### Task 1: Define a closed offer contract and transition rules

- Write tests first for valid/invalid offer records, duplicate response, expiry, reason requirements, safe payout amount, and allowed progress states.
- Add `contracts.ts` with the closed status, decline reason, event, and offer types.
- Add `core.ts` with validation, vendor/email normalization, and pure transition decisions.
- Run `pnpm --dir functions test -- cleaning-partners.test.ts` and keep this task red/green independently.

### Task 2: Add transactional server runtime

- Test fake-database transactions for account email uniqueness, offer creation, accept race, decline audit, expiry, and replacement offer.
- Add injected runtime functions for binding, issuing, listing a vendor's offers, responding, progress updates, and reassigning.
- Ensure each mutation checks expected revision and writes an audit event in the same transaction.
- Run focused Functions tests and `pnpm --dir functions build`.

### Task 3: Add authenticated Functions endpoint

- Test verified-email account lookup, missing/disabled binding, wrong vendor, App Check, role separation, malformed payloads, no-store headers, and absence of customer PII in partner GET results.
- Add a partner identity resolver that verifies/revocation-checks Firebase ID tokens, verified email binding, and App Check; do not use employee CRM roles for partners.
- Add admin-only actions that require existing CRM admin authorization for bind/offer/reassign; partner actions derive vendor ID from server binding.
- Run endpoint tests and Functions build.

### Task 4: Add vendor binding and offer controls to the desktop CRM

- Add tests for binding an account email to a vendor and issuing an offer with a real order/vendor/date/amount.
- Add controls to the partner profile editor and dispatch order view. Offer creation must be explicit and must collect a positive supplier amount, response deadline, and vendor selection.
- Add offer status and reassignment history to the relevant order detail.
- Run focused desktop CRM tests and `npm test`.

### Task 5: Build the mobile partner dashboard

- Test the Firebase auth gate, server-loaded vendor scope, new-offer accept/decline form, current job milestones, today's schedule, payout source labels, and unavailable settlement/rating shortcuts.
- Add a `/partner` page that does not import the employee Field app or grant employee roles.
- Implement mobile layout and accessible state controls matching the provided image; show customer data only after the server confirms work has started.
- Run `pnpm --dir company-site typecheck:field`, partner UI tests, and local page build.

### Task 6: Verify the joined flow and update the audit

- Run Functions tests/build, relevant company-site tests/typecheck, the desktop CRM suite, and emulator security tests when the configured emulator is available.
- Verify direct Firebase reads/writes remain denied, wrong-vendor tokens cannot enumerate or mutate offers, expiry blocks acceptance, and only one vendor can win an order.
- Inspect the rendered partner page at mobile width against screenshot 16 and compare admin offer screens 20–23 with their references.
- Update screens 16 and 20–23 in the audit with exact verified behavior and remaining data limitations; do not claim deployment readiness.

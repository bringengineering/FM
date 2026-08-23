# BRING CARE CRM·카카오 상담 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every advertising-landing estimate request in the company CRM and take successful applicants directly to BRING CARE KakaoTalk consultation.

**Architecture:** A same-origin Firebase Hosting rewrite sends JSON to a public HTTPS function. A focused, dependency-injected lead-ingest core validates and plans idempotent CRM mutations, while the HTTP adapter applies rate limiting and Admin SDK transactions. The landing form sends only to this endpoint and the completion page exposes the verified Kakao channel URL.

**Tech Stack:** React 19, Vinext/Next-compatible routing, TypeScript, Firebase Functions v2, Firebase Realtime Database Admin SDK, Vitest, Testing Library.

---

### Task 1: Public lead contract and CRM mutation planner

**Files:**
- Create: `functions/src/marketing/submit-marketing-lead.ts`
- Create: `functions/test/submit-marketing-lead.test.ts`

- [ ] **Step 1: Write failing validation and mapping tests**

Test the wished-for `normalizeMarketingLeadInput` and `buildMarketingLeadRecords` API with a valid 010 phone, required consent, allowed source paths, UTM capture, service mapping, and rejected invalid inputs. Assert that records use CRM-compatible `customers`, `activities`, `salesProspects`, `salesContacts`, `salesOpportunities`, and `salesEvents` fields.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/submit-marketing-lead.test.ts`

Expected: FAIL because `src/marketing/submit-marketing-lead.ts` does not exist.

- [ ] **Step 3: Implement the minimum pure core**

Create bounded string helpers, phone normalization, enum allowlists, service mapping, SHA-256 phone indexing, CRM record builders, and an injected `submitMarketingLeadCore(input, dependencies)` that reserves an idempotency receipt, resolves an existing customer by phone hash, and applies one multi-location update.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run test/submit-marketing-lead.test.ts`

Expected: all focused tests PASS.

### Task 2: Firebase HTTPS endpoint and hosting route

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `firebase.json`
- Test: `functions/test/submit-marketing-lead-http.test.ts`

- [ ] **Step 1: Write failing HTTP policy tests**

Test POST-only behavior, JSON content type, allowed production/localhost origins, honeypot handling, IP-derived rate-limit identity, stable success JSON, and safe error JSON without personal data.

- [ ] **Step 2: Run the focused HTTP test and verify RED**

Run: `pnpm vitest run test/submit-marketing-lead-http.test.ts`

Expected: FAIL because the HTTP handler adapter does not exist.

- [ ] **Step 3: Implement the endpoint and same-origin rewrite**

Export `submitMarketingLead` with region `asia-northeast3`, `cors: false`, Admin Database dependencies, rate limiting under a non-CRM security path, and `Cache-Control: no-store`. Add a Hosting rewrite from `/api/marketing-leads` to that function.

- [ ] **Step 4: Verify server tests and TypeScript build**

Run: `pnpm test && pnpm build`

Expected: 0 failures and TypeScript exit code 0.

### Task 3: CRM-first landing form

**Files:**
- Modify: `company-site/app/landing/QuickEstimateForm.tsx`
- Modify: `company-site/tests/landing/quick-estimate-form.test.tsx`

- [ ] **Step 1: Write failing form tests**

Require a `상담 니즈` field, assert 010-format validation, assert JSON POST to `/api/marketing-leads`, verify service/source/UTM/request ID payload, and verify navigation to `/consult/complete?receipt=<safe-id>` only after server success.

- [ ] **Step 2: Run landing tests and verify RED**

Run: `pnpm test:landing`

Expected: FAIL because the current form posts FormData to FormSubmit and lacks the needs field.

- [ ] **Step 3: Implement the CRM-first submission**

Replace the primary mail delivery with JSON submission, add needs and optional customer-type input, update consent copy, keep the phone/copy failure alternative, and never persist or route personal information.

- [ ] **Step 4: Run landing tests and verify GREEN**

Run: `pnpm test:landing`

Expected: all landing tests PASS.

### Task 4: Kakao-first completion experience

**Files:**
- Modify: `company-site/app/consult/complete/page.tsx`
- Modify: `company-site/tests/landing/landing-page.test.tsx`
- Modify: `company-site/app/globals.css`

- [ ] **Step 1: Write failing completion-page assertions**

Assert CRM receipt language, the verified `https://pf.kakao.com/_xnaRfX/chat` external link, phone fallback, and removal of email-only completion claims.

- [ ] **Step 2: Run landing tests and verify RED**

Run: `pnpm test:landing`

Expected: FAIL because the completion page still describes email delivery and lacks the Kakao chat link.

- [ ] **Step 3: Implement the completion page**

Make KakaoTalk the primary action, explain that the application is registered and a manager will respond, retain phone/home alternatives, and style the Kakao action accessibly without changing the established landing brand.

- [ ] **Step 4: Run landing tests and verify GREEN**

Run: `pnpm test:landing`

Expected: all landing tests PASS.

### Task 5: Full verification and publication

**Files:**
- Verify: all files above

- [ ] **Step 1: Run complete verification**

Run in `functions`: `pnpm test && pnpm build`

Run in `company-site`: `pnpm test:landing && pnpm lint && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 2: Review privacy and requirement checklist**

Confirm no phone/name in URLs or browser storage, the database is written only by Admin SDK, duplicate requests are idempotent, repeated phone numbers reuse customers, all three landings use the shared form, and the exact verified Kakao URL appears on completion.

- [ ] **Step 3: Export and deploy the validated site and function**

Run the repository's Firebase export/deploy workflow for Hosting and `submitMarketingLead`, then confirm the production routes and function-backed form endpoint respond without exposing personal data.

# BRING CARE CRM·카카오 상담 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every advertising-landing estimate request in the company CRM and take successful applicants directly to BRING CARE KakaoTalk consultation.

**Architecture:** The free Spark-compatible path writes one App Check-backed, create-only record to a private Realtime Database CRM inbox. Strict Database Rules validate every public field and prevent reads, updates, deletes, or arbitrary CRM writes. The desktop CRM loads the inbox as a read-only overlay, while the completion page exposes the verified Kakao channel URL.

**Tech Stack:** React 19, Vinext/Next-compatible routing, TypeScript, Firebase App Check, Firebase Realtime Database, Electron CRM, Vitest, Testing Library, Firebase Rules Emulator.

---

### Task 1: Free public CRM inbox contract and security rules

**Files:**
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] **Step 1: Write failing validation and mapping tests**

Add emulator tests proving an unauthenticated visitor can create one valid `crmCompany/marketingLeadInbox/{requestId}` record, cannot read it, cannot update/delete it, and cannot add unknown or malformed fields. Assert authorized CRM roles can read it and only admin/member can update its processing status.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test:rules`

Expected: FAIL because `crmCompany/marketingLeadInbox` has no public create rule.

- [ ] **Step 3: Implement the minimum pure core**

Add a create-only public rule with exact child-field validation, 010 phone validation, allowed services and paths, consent enforcement, server-time bounds, and staff-only read/status-update permissions.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test:rules`

Expected: all focused tests PASS.

### Task 2: CRM read-only marketing inbox overlay

**Files:**
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/app.js`
- Test: `desktop-crm/test/core.test.js`
- Test: `desktop-crm/test/remote.test.js`

- [ ] **Step 1: Write failing HTTP policy tests**

Test that inbox records are sanitized as renderer-only overlays, loaded from `crmCompany/marketingLeadInbox`, never included in shared-store writes, and displayed on the dashboard without rendering unsafe HTML.

- [ ] **Step 2: Run the focused HTTP test and verify RED**

Run: `node --test test/core.test.js test/remote.test.js`

Expected: FAIL because the CRM does not yet load or render marketing leads.

- [ ] **Step 3: Implement the endpoint and same-origin rewrite**

Add `marketingLeads` to renderer overlays, load the inbox alongside field summaries, preserve the non-authoritative overlay boundary, and add a visible `광고 신규 문의` dashboard panel.

- [ ] **Step 4: Verify server tests and TypeScript build**

Run: `pnpm test`

Expected: 0 failures and TypeScript exit code 0.

### Task 3: Free CRM-inbox landing submission

**Files:**
- Create: `company-site/app/landing/marketingLeadClient.ts`
- Modify: `company-site/app/landing/QuickEstimateForm.tsx`
- Modify: `company-site/tests/landing/quick-estimate-form.test.tsx`

- [ ] **Step 1: Write failing form tests**

Require a `상담 니즈` field, assert 010-format validation, assert an App Check-backed create to the private CRM inbox, verify service/source/UTM/request ID payload, and verify navigation to `/consult/complete?receipt=<safe-id>` only after database success.

- [ ] **Step 2: Run landing tests and verify RED**

Run: `pnpm test:landing`

Expected: FAIL because the current form posts FormData to FormSubmit and lacks the needs field and CRM inbox client.

- [ ] **Step 3: Implement the CRM-first submission**

Replace primary mail delivery with Firebase `set` to the create-only inbox, require App Check, add needs and customer-type input, update consent copy, keep the phone/copy failure alternative, and never persist or route personal information.

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

Run in `desktop-crm`: `pnpm test`

Run in `company-site`: `pnpm test:landing && pnpm test:rules && pnpm lint && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 2: Review privacy and requirement checklist**

Confirm no phone/name in URLs or browser storage, anonymous users cannot read/update/delete inbox records or touch other CRM paths, duplicate request IDs are create-only, all three landings use the shared form, CRM staff can see the inbox, and the exact verified Kakao URL appears on completion.

- [ ] **Step 3: Export and deploy the validated site and function**

Run the repository's Spark-compatible Database Rules and Firebase Hosting deployment workflow, then confirm the production form writes one private inbox record and opens the Kakao completion path without exposing personal data.

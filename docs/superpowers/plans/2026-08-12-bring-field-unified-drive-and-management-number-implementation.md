# BRING FIELD Unified Drive and Management Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `bringengineering1008@gmail.com` the unified BRING FIELD and Drive account, and issue immutable `BR-WJ-{AREA}-{YY}-{NNNN}` management numbers automatically.

**Architecture:** The browser obtains a short-lived Drive token during Firebase Google login and silently reacquires it with a fixed login hint without persisting credentials. Management numbers are derived from a pure address classifier and allocated inside the registration root transaction so the counter, building graph, and replay receipt commit atomically.

**Tech Stack:** React 19, TypeScript, Firebase Authentication, Realtime Database, Cloud Functions v2, Google Identity Services, Vitest.

---

### Task 1: Unify the FIELD and Drive account

**Files:**
- Modify: `company-site/app/field/lib/auth.client.ts`
- Modify: `company-site/app/field/lib/drive-auth.client.ts`
- Modify: `company-site/app/field/components/DriveConnectionControl.tsx`
- Test: `company-site/tests/field/auth-redirect.test.ts`
- Test: `company-site/tests/field/drive-auth.test.ts`

- [ ] **Step 1: Write failing account-invariant tests**

Add tests proving the Firebase credential email must equal `bringengineering1008@gmail.com`, the popup token is adopted only for that account, and the Drive token client receives `login_hint: "bringengineering1008@gmail.com"`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm.cmd exec vitest run tests/field/auth-redirect.test.ts tests/field/drive-auth.test.ts --reporter=verbose`

Expected: failures for missing company-account enforcement and missing `login_hint`.

- [ ] **Step 3: Implement the account invariant**

Export `BRING_COMPANY_GOOGLE_ACCOUNT`, reject mismatched Firebase users with `field_company_account_required`, and extend `GoogleOAuth2.initTokenClient` with `login_hint` and `include_granted_scopes: true`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all focused tests pass.

### Task 2: Reconnect Drive without repeated consent

**Files:**
- Modify: `company-site/app/field/lib/drive-auth.client.ts`
- Modify: `company-site/app/field/components/DriveConnectionControl.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Test: `company-site/tests/field/drive-auth.test.ts`
- Test: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing silent-reconnect tests**

Cover `connect("")` requesting `prompt: ""`, automatic mount-time reconnect, no consent prompt while a token is valid, and a recoverable “회사 Drive 다시 연결” state when silent authorization fails.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm.cmd exec vitest run tests/field/drive-auth.test.ts tests/field/components.test.tsx --reporter=verbose`

Expected: the component does not attempt silent reconnect and still renders the old permanent connection button.

- [ ] **Step 3: Implement silent reconnect and conditional UI**

Start `driveTokenManager.connect("")` once after an authenticated FIELD session mounts, validate the fixed Drive root, resume queued uploads on success, and show the manual recovery button only after a silent failure.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all focused tests pass.

### Task 3: Classify Wonju addresses and format management numbers

**Files:**
- Create: `functions/src/field/management-number.ts`
- Create: `functions/test/management-number.test.ts`
- Create: `company-site/app/field/lib/management-number.ts`
- Create: `company-site/tests/field/management-number.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

Cover `무실동 -> MUSIL`, `단계동 -> DANGYE`, `반곡동 -> BANGOK`, `지정면 -> JIJEONG`, unknown Wonju district fallback, missing district `ETC`, year `2026 -> 26`, and serial formatting `1 -> 0001`, `10000 -> 10000`.

- [ ] **Step 2: Run focused tests and verify RED**

Run FIELD and Functions focused test commands. Expected: missing module failures.

- [ ] **Step 3: Implement deterministic classification and formatting**

Expose `classifyWonjuArea(address)`, `managementNumberCounterKey(area, year)`, and `formatManagementNumber({area, year, sequence})`. Keep the browser helper presentation-only; server output remains authoritative.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: all classifier and formatter cases pass.

### Task 4: Allocate the number atomically during registration

**Files:**
- Modify: `functions/src/field/save-field-registration.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/test/save-field-registration.test.ts`
- Modify: `functions/test/index-entrypoints.test.ts`
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] **Step 1: Write failing transaction tests**

Prove a new registration increments `fieldPlatform/managementNumberCounters/{YY}/{AREA}`, writes the generated number to the building, returns it in the receipt, replays the same request without another increment, and gives concurrent new requests distinct sequences.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: registration still requires the client-provided management number and no counter is written.

- [ ] **Step 3: Implement the root transaction reducer and adapter**

Remove `managementNumber` from the trusted input projection. Inside the root transaction, read the replay receipt first; otherwise allocate the next sequence and write counter, entities, projections, and receipt together.

- [ ] **Step 4: Lock down counters and immutability in rules**

Set client `.read` and `.write` to false for `managementNumberCounters`, preserve the server-owned receipt path, and add validation that an existing building's management number cannot change.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: transaction, entrypoint, and static rule tests pass.

### Task 5: Remove manual entry and display the issued number

**Files:**
- Modify: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/app/field/lib/registration-draft.ts`
- Modify: `company-site/app/field/lib/validation.ts`
- Modify: `company-site/app/field/lib/field-api.client.ts`
- Modify: `company-site/app/field/lib/direct-field-api.client.ts`
- Test: `company-site/tests/field/components.test.tsx`
- Test: `company-site/tests/field/registration-draft.test.ts`
- Test: `company-site/tests/field/validation.test.ts`
- Test: `company-site/tests/field/direct-field-api.test.ts`

- [ ] **Step 1: Write failing wizard tests**

Prove no editable “내부 관리번호” textbox exists, the address shows an expected area preview, save payload omits management number, and the completion card displays the server-returned number.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: the old required textbox remains and projections still require its value.

- [ ] **Step 3: Implement the read-only automatic-number UX**

Replace the input with “저장 시 자동 발급”, remove client validation, accept `managementNumber` in `SaveFieldRegistrationResult`, and display it after save.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: wizard, draft, validation, and direct API tests pass.

### Task 6: Propagate the number into Drive and advertising

**Files:**
- Modify: `company-site/app/field/lib/drive-folders.ts`
- Modify: `company-site/app/field/lib/direct-drive-media-upload.ts`
- Modify: `company-site/app/field/lib/direct-ad-package.client.ts`
- Test: `company-site/tests/field/drive-folders.test.ts`
- Test: `company-site/tests/field/direct-drive-media-upload.test.ts`
- Test: `company-site/tests/field/direct-ad-package.test.ts`

- [ ] **Step 1: Write failing propagation tests**

Prove the building folder is `{managementNumber}_{area}_{buildingName}`, media uploads read the number from the building record, and the advertising summary contains exactly the same number.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: the current folder is based only on building name and address.

- [ ] **Step 3: Implement propagation**

Add `managementNumber` to `DriveFolderPlanInput`, update upload binding validation, and preserve the number in generated advertising artifacts.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: all three propagation suites pass.

### Task 7: Provision, verify, and deploy

**Files:**
- Modify production Firebase data: `fieldPlatformAllowedEmails/{sha256(bringengineering1008@gmail.com)}`
- Build output: `company-site/firebase-public/**`

- [ ] **Step 1: Run complete verification**

Run FIELD tests, Functions tests, `pnpm.cmd typecheck:field`, Functions TypeScript build, company-site production build, and `git diff --check`. Expected: zero failures.

- [ ] **Step 2: Add the company email hash as active admin**

Write only the SHA-256 key and `{active: true, role: "admin"}`; do not store the plaintext email in Realtime Database.

- [ ] **Step 3: Build the Firebase static export and deploy**

Deploy Functions, database rules, and Hosting to project `bring-fm`.

- [ ] **Step 4: Verify the Android production flow**

Open `https://bring-fm.web.app/field`, sign in as `bringengineering1008@gmail.com`, confirm Drive root validation, register two test buildings in one area, verify distinct management numbers, capture one photo/video, and confirm the Drive folder and advertising preview use the same number.

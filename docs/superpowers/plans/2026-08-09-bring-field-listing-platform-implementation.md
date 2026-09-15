# BRING Field Listing Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal installable PWA where BRING staff register buildings and vacant units, complete configurable field checklists, capture media offline, synchronize originals to the company Google Drive, show properties on the authenticated Naver map, and generate reviewed Daangn/Naver Real Estate advertising packages.

**Architecture:** Add a focused `/field` React application to the existing `company-site` Vinext project instead of expanding the legacy root `index.html`. Store operational metadata in the existing Firebase Realtime Database, upload media resumably to Firebase Storage, and use isolated Firebase Functions to provision staff claims, synchronize files to Google Drive with the company OAuth account, and generate advertising package files. Keep the existing vendor map working while adding an authenticated property layer backed by pure, separately tested mapping functions.

**Tech Stack:** React 19, TypeScript 5.9, Vinext/Vite, Firebase Authentication, Realtime Database, Firebase Storage, Firebase Functions v2, IndexedDB, Naver Maps JavaScript SDK, Google Drive API, Vitest, Testing Library, Firebase Emulator Suite, Node test runner.

---

## Delivery sequence

This specification spans several subsystems. Execute it as three checkpoints while keeping one source of truth and one test suite:

1. **Core platform:** Tasks 1-6 produce an authenticated building/unit/listing platform that works on mobile and PC.
2. **Field capture and Drive:** Tasks 7-10 add configurable checklists, offline media upload, Drive synchronization, and advertising packages.
3. **Map and release:** Tasks 11-13 add the authenticated property map layer, deployment integration, security verification, and field acceptance tests.

Do not start a later checkpoint while the earlier checkpoint's full verification command is failing.

## File structure

### Existing files to modify

- `company-site/package.json` - frontend dependencies and test commands.
- `company-site/scripts/export-firebase.mjs` - export `/field` routes and copy the service worker.
- `company-site/tests/rendered-html.test.mjs` - published route smoke tests.
- `firebase.json` - add Functions and Storage Rules deployment targets.
- `database.rules.json` - isolate and authorize `fieldPlatform` records.
- `wonju-map.html` - authenticated building/property layer UI.

### Frontend files to create

- `company-site/app/field/layout.tsx` - field-app metadata, viewport, icons, and styles.
- `company-site/app/field/page.tsx` - `/field` route entry.
- `company-site/app/field/FieldApp.tsx` - authenticated shell and route state.
- `company-site/app/field/field.css` - BRING platform tokens and responsive layout.
- `company-site/app/field/manifest.ts` - installable PWA manifest.
- `company-site/app/field/lib/types.ts` - canonical domain types.
- `company-site/app/field/lib/validation.ts` - deterministic form validation.
- `company-site/app/field/lib/firebase.client.ts` - Firebase singleton clients.
- `company-site/app/field/lib/auth.client.ts` - Google login and claim provisioning.
- `company-site/app/field/lib/repository.ts` - Realtime Database reads and writes.
- `company-site/app/field/lib/audit.ts` - audit-event construction.
- `company-site/app/field/lib/checklist.ts` - versioned checklist evaluation.
- `company-site/app/field/lib/offline-queue.ts` - IndexedDB draft/media queue.
- `company-site/app/field/lib/media-upload.ts` - resumable Storage upload orchestrator.
- `company-site/app/field/lib/ad-package.ts` - safe advertising projection.
- `company-site/app/field/components/AppShell.tsx` - desktop/mobile navigation.
- `company-site/app/field/components/Dashboard.tsx` - assignments and failure summary.
- `company-site/app/field/components/BuildingWizard.tsx` - building/unit/listing steps.
- `company-site/app/field/components/ChecklistRunner.tsx` - dynamic checklist UI.
- `company-site/app/field/components/CaptureGuide.tsx` - required media slots.
- `company-site/app/field/components/UploadQueue.tsx` - queue progress and retries.
- `company-site/app/field/components/AdPackageReview.tsx` - photo ordering and package approval.
- `company-site/public/field-sw.js` - app-shell cache and safe offline navigation.
- `company-site/public/field-icons/icon-192.png` and `icon-512.png` - install icons.

### Backend files to create

- `functions/package.json` and `functions/tsconfig.json` - isolated Firebase Functions package.
- `functions/src/index.ts` - exported callable and queue functions.
- `functions/src/auth/provision-field-user.ts` - allowlist-to-custom-claims provisioning.
- `functions/src/drive/google-auth.ts` - Google OAuth client from secrets.
- `functions/src/drive/folders.ts` - idempotent Drive folder creation.
- `functions/src/drive/sync-media.ts` - Storage-to-Drive streaming upload.
- `functions/src/packages/create-ad-package.ts` - safe text/PDF package generation.
- `functions/src/security/advertising-projection.ts` - explicit field allowlist.
- `functions/scripts/google-drive-oauth.mjs` - one-time company-account authorization helper.
- `storage.rules` - authenticated media access rules.

### Tests to create

- `company-site/tests/field/types.test.ts`
- `company-site/tests/field/validation.test.ts`
- `company-site/tests/field/auth.test.ts`
- `company-site/tests/field/repository.test.ts`
- `company-site/tests/field/checklist.test.ts`
- `company-site/tests/field/offline-queue.test.ts`
- `company-site/tests/field/media-upload.test.ts`
- `company-site/tests/field/ad-package.test.ts`
- `company-site/tests/field/components.test.tsx`
- `company-site/tests/field/map-model.test.ts`
- `company-site/tests/field/database-rules.test.ts`
- `company-site/tests/field/storage-rules.test.ts`
- `functions/test/provision-field-user.test.ts`
- `functions/test/folders.test.ts`
- `functions/test/sync-media.test.ts`
- `functions/test/create-ad-package.test.ts`
- `data/field-map-model.js` - pure property-to-map projection shared by the legacy page.
- `data/field-map-model.test.js` - Node tests for the legacy integration.

## Checkpoint 1: Core platform

### Task 1: Establish the `/field` PWA test harness and shell

**Files:**
- Modify: `company-site/package.json`
- Create: `company-site/vitest.config.ts`
- Create: `company-site/tests/field/setup.ts`
- Create: `company-site/app/field/layout.tsx`
- Create: `company-site/app/field/page.tsx`
- Create: `company-site/app/field/FieldApp.tsx`
- Create: `company-site/app/field/field.css`
- Create: `company-site/app/field/manifest.ts`
- Create: `company-site/app/field/components/AppShell.tsx`
- Create: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Add the failing shell test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppShell from "../../app/field/components/AppShell";

describe("AppShell", () => {
  it("renders the five approved platform destinations", () => {
    render(<AppShell active="home"><div>내용</div></AppShell>);
    for (const label of ["홈", "지도", "건물", "촬영", "패키지"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Install the bounded frontend dependencies and run the failing test**

Run:

```bash
pnpm --dir company-site add firebase idb
pnpm --dir company-site add -D vitest jsdom @testing-library/react @testing-library/jest-dom
pnpm --dir company-site test:field -- --run tests/field/components.test.tsx
```

Expected: FAIL because `AppShell` and `test:field` do not exist before the implementation is added.

- [ ] **Step 3: Add Vitest configuration and scripts**

Add these scripts to `company-site/package.json`:

```json
{
  "scripts": {
    "test:field": "vitest",
    "test:field:run": "vitest run tests/field"
  }
}
```

Configure `vitest.config.ts` with `environment: "jsdom"`, `setupFiles: ["./tests/field/setup.ts"]`, and the `@` alias pointing at the company-site root. In `setup.ts`, import `@testing-library/jest-dom/vitest`.

- [ ] **Step 4: Implement the installable shell**

Implement `AppShell` with a typed active destination:

```ts
export type FieldDestination = "home" | "map" | "buildings" | "capture" | "packages";
```

Render a desktop sidebar above 960 px and a five-item bottom navigation below 960 px. Use buttons with `aria-current="page"` for the active item. `FieldApp` owns the current destination and initially renders the home dashboard placeholder. `layout.tsx` imports only `field.css`; it must not change the marketing-site global styles.

Return this manifest from `manifest.ts`:

```ts
export default function manifest() {
  return {
    name: "BRING 현장 매물 플랫폼",
    short_name: "BRING Field",
    start_url: "/field",
    display: "standalone",
    background_color: "#f6f8fb",
    theme_color: "#173b6c",
    icons: [
      { src: "/field-icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/field-icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site build
```

Expected: all field tests PASS and Vinext build exits 0 with a `/field` route.

- [ ] **Step 6: Commit**

```bash
git add company-site/package.json company-site/pnpm-lock.yaml company-site/vitest.config.ts company-site/tests/field company-site/app/field
git commit -m "feat: add BRING field platform shell"
```

### Task 2: Define canonical domain types and validation

**Files:**
- Create: `company-site/app/field/lib/types.ts`
- Create: `company-site/app/field/lib/validation.ts`
- Create: `company-site/tests/field/types.test.ts`
- Create: `company-site/tests/field/validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from "vitest";
import { validateListingDraft } from "../../app/field/lib/validation";

describe("validateListingDraft", () => {
  it("requires the approved core advertising fields", () => {
    expect(validateListingDraft({})).toEqual(expect.arrayContaining([
      "buildingId", "unitLabel", "depositWon", "monthlyRentWon", "maintenanceFeeWon"
    ]));
  });

  it("accepts zero maintenance fee without treating it as missing", () => {
    expect(validateListingDraft({
      buildingId: "building-1", unitLabel: "201호", depositWon: 3000000,
      monthlyRentWon: 350000, maintenanceFeeWon: 0
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm --dir company-site test:field -- --run tests/field/validation.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement explicit types**

Define string unions for `UserRole`, `ListingStatus`, `VisitType`, `MediaKind`, `MediaZone`, `UploadState`, and `DriveSyncState`. Define interfaces for `FieldUser`, `Building`, `Unit`, `Listing`, `Visit`, `ChecklistTemplate`, `ChecklistSubmission`, `MediaRecord`, `AdPackage`, `SecureAccess`, and `AuditEvent`.

Use ISO-8601 strings for timestamps, integer won amounts for money, and stable string IDs. Keep public advertising fields out of `SecureAccess`; do not put passwords or phone numbers on `Building` or `Listing`.

- [ ] **Step 4: Implement deterministic validation**

`validateBuildingDraft`, `validateListingDraft`, and `validateVisitCompletion` return arrays of field keys. Treat numeric zero as present, trim strings, reject invalid latitude/longitude, and require every checklist field marked `required` plus every required media slot before visit completion.

- [ ] **Step 5: Run tests and type-check**

Run:

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site exec tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add company-site/app/field/lib/types.ts company-site/app/field/lib/validation.ts company-site/tests/field
git commit -m "feat: define field platform domain model"
```

### Task 3: Add allowlisted Google authentication and role claims

**Files:**
- Create: `company-site/app/field/lib/firebase.client.ts`
- Create: `company-site/app/field/lib/auth.client.ts`
- Create: `company-site/tests/field/auth.test.ts`
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `functions/src/index.ts`
- Create: `functions/src/auth/provision-field-user.ts`
- Create: `functions/test/provision-field-user.test.ts`
- Modify: `firebase.json`

- [ ] **Step 1: Write failing client auth tests**

Test that `loginFieldUser()` calls Google sign-in, invokes `provisionFieldUser`, refreshes the ID token, and rejects a result whose claims do not contain `fieldPlatform: true`. Inject Firebase dependencies so the test does not contact Google.

- [ ] **Step 2: Write failing Functions tests**

Test these exact outcomes for `provisionFieldUserCore`:

```ts
expect(await provisionFieldUserCore({ email: "staff@example.com", uid: "u1" }, deps))
  .toEqual({ fieldPlatform: true, fieldRole: "staff" });
await expect(provisionFieldUserCore({ email: "blocked@example.com", uid: "u2" }, deps))
  .rejects.toThrow("field_user_not_allowed");
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --dir company-site test:field -- --run tests/field/auth.test.ts
pnpm --dir functions test
```

Expected: both suites FAIL because the auth modules and Functions package do not exist.

- [ ] **Step 4: Implement Firebase clients and claim provisioning**

Use the existing project values from `index.html` in `firebase.client.ts`, but export singleton `auth`, `database`, `storage`, and `functions` clients. `auth.client.ts` uses `GoogleAuthProvider`, calls the callable `provisionFieldUser`, then forces `getIdTokenResult(true)`.

The callable function must:

1. Require an authenticated Google account with a verified email.
2. Read `fieldPlatformAllowedEmails/{sha256(normalizedEmail)}` using Admin SDK.
3. Reject missing or inactive records.
4. Set custom claims `{ fieldPlatform: true, fieldRole: record.role }`.
5. Write `fieldPlatform/users/{uid}` without storing the email in a public path.
6. Return only role and enabled state.

Use the default region `asia-northeast3` for all new Functions.

- [ ] **Step 5: Configure Functions deployment**

Add to `firebase.json`:

```json
"functions": [{ "source": "functions", "codebase": "field-platform" }]
```

Add Node 22, `firebase-admin`, `firebase-functions`, `vitest`, and TypeScript to `functions/package.json`. Export `provisionFieldUser` from `functions/src/index.ts`.

Use these package scripts and dependency families:

```json
{
  "engines": { "node": "22" },
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@pdf-lib/fontkit": "^1.1.1",
    "@fontsource/noto-sans-kr": "^5.2.8",
    "firebase-admin": "^13.5.0",
    "firebase-functions": "^6.4.0",
    "googleapis": "^155.0.0",
    "pdf-lib": "^1.17.1"
  },
  "devDependencies": {
    "@types/node": "^22.19.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 6: Run both suites and build**

Run:

```bash
pnpm --dir company-site test:field:run
pnpm --dir functions test
pnpm --dir functions build
```

Expected: all tests PASS and Functions TypeScript build exits 0.

- [ ] **Step 7: Commit**

```bash
git add company-site/app/field/lib company-site/tests/field functions firebase.json
git commit -m "feat: secure field platform sign-in"
```

### Task 4: Enforce database and storage authorization

**Files:**
- Modify: `database.rules.json`
- Create: `storage.rules`
- Create: `company-site/tests/field/database-rules.test.ts`
- Create: `company-site/tests/field/storage-rules.test.ts`
- Modify: `company-site/package.json`
- Modify: `firebase.json`

- [ ] **Step 1: Write emulator tests that fail against current rules**

Cover four callers: unauthenticated, staff, reviewer, admin. Assert that:

- unauthenticated callers cannot read or write `fieldPlatform`;
- staff can write assigned buildings, listings, visits, and their own queued media;
- reviewers can read advertising fields and update package review state but cannot read `secureAccess`;
- only admin or a specifically assigned staff UID can read a building's `secureAccess`;
- clients cannot write `auditLogs`, `driveSyncJobs`, or completed Drive IDs;
- Storage accepts authenticated uploads only under `field-media/{uid}/{captureSessionId}/...` for the same UID and rejects files over the configured photo/video limits.

- [ ] **Step 2: Run emulator tests to verify failure**

Run:

```bash
pnpm --dir company-site exec firebase --config ../firebase.json --project bring-fm-hj emulators:exec --only database,storage "pnpm test:rules"
```

Expected: FAIL because `fieldPlatform` is denied and `storage.rules` is absent.

- [ ] **Step 3: Implement the isolated rules**

Add `fieldPlatform` under the current default-deny root. Use `auth.token.fieldPlatform === true` and `auth.token.fieldRole` checks. Validate immutable IDs, known status enums, integer money values greater than or equal to zero, latitude range `-90..90`, longitude range `-180..180`, and server-owned sync fields.

Add to `firebase.json`:

```json
"storage": { "rules": "storage.rules" }
```

Set photo maximum to 25 MB and video maximum to 500 MB in Storage Rules using path prefixes `photos/` and `videos/` plus MIME validation.

Add this exact script to `company-site/package.json`:

```json
{
  "scripts": {
    "test:rules": "vitest run tests/field/database-rules.test.ts tests/field/storage-rules.test.ts"
  }
}
```

- [ ] **Step 4: Run rule tests**

Run the emulator command from Step 2.

Expected: all database and storage rule tests PASS.

- [ ] **Step 5: Commit**

```bash
git add database.rules.json storage.rules firebase.json company-site/package.json company-site/pnpm-lock.yaml company-site/tests/field
git commit -m "security: protect field platform data and media"
```

### Task 5: Implement repository, audit, and idempotent writes

**Files:**
- Create: `company-site/app/field/lib/repository.ts`
- Create: `company-site/app/field/lib/audit.ts`
- Create: `company-site/tests/field/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Inject a database adapter and verify that `saveBuildingWithAudit` performs one multi-location update containing:

```ts
{
  "fieldPlatform/buildings/building-1": expect.objectContaining({ id: "building-1" }),
  "fieldPlatform/auditLogs/event-1": expect.objectContaining({ action: "building.saved" })
}
```

Also verify `findBuildingByNormalizedAddress` detects an existing building before creation and `saveListing` never accepts secure access fields.

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --dir company-site test:field -- --run tests/field/repository.test.ts`

Expected: FAIL because repository modules do not exist.

- [ ] **Step 3: Implement focused repository functions**

Implement `listAssignedBuildings`, `findBuildingByNormalizedAddress`, `saveBuildingWithAudit`, `saveUnitWithAudit`, `saveListingWithAudit`, `saveSecureAccess`, `subscribeDashboard`, and `requestDriveSync`. Use Firebase multi-location updates for entity plus audit changes. Generate stable IDs before writes; never derive identity from a mutable building name.

- [ ] **Step 4: Run tests**

Run: `pnpm --dir company-site test:field:run`

Expected: all field tests PASS.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/field/lib/repository.ts company-site/app/field/lib/audit.ts company-site/tests/field/repository.test.ts
git commit -m "feat: add field platform repositories"
```

### Task 6: Build the building, unit, and listing workflow

**Files:**
- Create: `company-site/app/field/components/Dashboard.tsx`
- Create: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/field.css`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Add failing component tests**

Test that the wizard:

- searches an existing normalized address before enabling create;
- models one building with multiple units;
- preserves `0` maintenance fee;
- displays validation errors next to fields;
- autosaves a valid step and restores it after remount;
- displays desktop status cards and mobile assignments.

- [ ] **Step 2: Run the component tests to verify failure**

Run: `pnpm --dir company-site test:field -- --run tests/field/components.test.tsx`

Expected: FAIL because the dashboard and wizard do not exist.

- [ ] **Step 3: Implement the seven-step wizard**

Use these approved steps: 건물, 임대조건, 상태점검, 옵션, 촬영, 입지, 검토. The first release's building and listing fields must match the design document. Use large touch targets, explicit currency units, a completion bar, Back/Next controls, and a persistent Save status.

Address selection returns `{ roadAddress, jibunAddress, latitude, longitude }`. If GPS differs by more than 150 m, show a warning and allow the user to keep the searched address or move the pin; do not silently overwrite it.

- [ ] **Step 4: Run core checkpoint verification**

Run:

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site lint
pnpm --dir company-site build
pnpm --dir functions test
pnpm --dir functions build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/field company-site/tests/field
git commit -m "feat: add building and vacancy workflow"
```

## Checkpoint 2: Field capture and Drive

### Task 7: Add versioned configurable checklists

**Files:**
- Create: `company-site/app/field/lib/checklist.ts`
- Create: `company-site/app/field/checklists/initial-template.ts`
- Create: `company-site/app/field/components/ChecklistRunner.tsx`
- Create: `company-site/tests/field/checklist.test.ts`
- Modify: `company-site/app/field/components/BuildingWizard.tsx`

- [ ] **Step 1: Write failing checklist tests**

Test that a submission stores `templateId` and `templateVersion`, required unanswered items block completion, hidden optional items do not, and a later template edit does not alter a serialized earlier submission.

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm --dir company-site test:field -- --run tests/field/checklist.test.ts`

Expected: FAIL because the checklist engine is missing.

- [ ] **Step 3: Encode the approved Word checklist**

Create `initial-template.ts` with two templates: `vacancy-first-visit@1` and `building-maintenance@1`. Include every section listed in the design document and these field kinds only: `text`, `number`, `date`, `singleChoice`, `multiChoice`, `rating`, `measurement`, and `mediaEvidence`. Use stable field IDs such as `building.elevator`, `listing.depositWon`, and `inspection.commonArea.stairsCleanliness`.

- [ ] **Step 4: Implement the runner and admin-safe versioning**

`ChecklistRunner` renders from data, not hard-coded field names. Saving a template creates a new numeric version rather than updating an existing version. A submission embeds a snapshot of labels and choices needed for historical display.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --dir company-site test:field:run
git add company-site/app/field company-site/tests/field/checklist.test.ts
git commit -m "feat: add versioned field checklists"
```

### Task 8: Implement offline drafts and media queue

**Files:**
- Create: `company-site/app/field/lib/offline-queue.ts`
- Create: `company-site/app/field/components/UploadQueue.tsx`
- Create: `company-site/public/field-sw.js`
- Create: `company-site/tests/field/offline-queue.test.ts`
- Modify: `company-site/app/field/FieldApp.tsx`

- [ ] **Step 1: Write failing queue tests**

Use fake IndexedDB to verify enqueue, deduplication by `captureSessionId + slotId + contentHash`, status transitions, retry count, restoration after a new queue instance, and removal only after both Firebase and Drive states are complete.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --dir company-site test:field -- --run tests/field/offline-queue.test.ts`

Expected: FAIL because the queue does not exist.

- [ ] **Step 3: Implement IndexedDB stores**

Create stores `drafts`, `mediaQueue`, and `syncState` at schema version 1. Persist `Blob` objects plus metadata. Expose `saveDraft`, `loadDraft`, `enqueueMedia`, `listPendingMedia`, `markFirebaseUploaded`, `markDriveSynced`, `markFailed`, and `retryFailed`.

- [ ] **Step 4: Implement the safe service worker**

Cache only the `/field` app shell and immutable built assets. Never cache Firebase API responses, signed media URLs, secure-access routes, or POST requests. On offline navigation under `/field`, return the cached field shell. Register the worker only after successful authenticated shell load.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --dir company-site test:field:run
git add company-site/app/field company-site/public/field-sw.js company-site/tests/field/offline-queue.test.ts
git commit -m "feat: preserve field work offline"
```

### Task 9: Add guided capture and resumable Firebase uploads

**Files:**
- Create: `company-site/app/field/lib/media-upload.ts`
- Create: `company-site/app/field/components/CaptureGuide.tsx`
- Create: `company-site/tests/field/media-upload.test.ts`
- Modify: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/app/field/components/UploadQueue.tsx`

- [ ] **Step 1: Write failing media tests**

Test required slot completion, shared building-photo reuse, photo/video MIME rejection, maximum sizes, resumable progress propagation, retry after network error, and creation of a `driveSyncJobs` record only after Firebase upload completes.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --dir company-site test:field -- --run tests/field/media-upload.test.ts`

Expected: FAIL because capture and uploader modules do not exist.

- [ ] **Step 3: Implement approved capture slots**

Create required/default slots for exterior, road/entrance, parking, common entrance, corridor/stairs, recycling, room overview, window/daylight, kitchen, bathroom, options/storage, boiler/equipment, repair evidence, and vertical video. Each slot specifies `scope: "building" | "unit"`, accepted MIME patterns, whether it is required, and a Korean framing hint.

- [ ] **Step 4: Implement resumable upload**

Use Firebase `uploadBytesResumable`. Upload to:

```text
field-media/{uid}/{captureSessionId}/photos/{mediaId}.{ext}
field-media/{uid}/{captureSessionId}/videos/{mediaId}.{ext}
```

Write the final Storage path, size, MIME, hash, capture slot, and state to `fieldPlatform/media/{mediaId}`. Create `fieldPlatform/driveSyncJobs/{jobId}` through the repository request function; clients may request a job but cannot mark it completed.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --dir company-site test:field:run
git add company-site/app/field company-site/tests/field/media-upload.test.ts
git commit -m "feat: guide and upload field media"
```

### Task 10: Synchronize media and advertising packages to Google Drive

**Files:**
- Create: `functions/src/drive/google-auth.ts`
- Create: `functions/src/drive/folders.ts`
- Create: `functions/src/drive/sync-media.ts`
- Create: `functions/src/security/advertising-projection.ts`
- Create: `functions/src/packages/create-ad-package.ts`
- Create: `functions/scripts/google-drive-oauth.mjs`
- Create: `functions/test/folders.test.ts`
- Create: `functions/test/sync-media.test.ts`
- Create: `functions/test/create-ad-package.test.ts`
- Create: `company-site/app/field/lib/ad-package.ts`
- Create: `company-site/app/field/components/AdPackageReview.tsx`
- Create: `company-site/tests/field/ad-package.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write failing Drive folder tests**

Given building `BR-0001`, name `○○빌`, locality `우산동`, unit `201호`, and session date `2026-08-09`, assert that `ensureDriveStructure` requests these sanitized folders exactly once and reuses existing IDs on retry:

```text
BR-0001_우산동_○○빌/201호/2026-08-09_공실촬영/
01_광고용_대표사진
02_전체원본사진
03_세로영상
```

- [ ] **Step 2: Write failing security projection tests**

Construct a source object containing `ownerPhone`, `commonDoorPassword`, `keyLocation`, and `internalMemo`. Assert none of those keys or values appears in `buildAdvertisingProjection(source)`, while rent, fee, parking, options, and approved media do appear.

- [ ] **Step 3: Write failing sync tests**

Mock Storage and Drive adapters. Verify stream upload, resumable retry, idempotent reuse of `driveFileId`, state transitions `queued -> syncing -> complete`, failure transitions with a safe error code, and no deletion of the Firebase source.

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
pnpm --dir functions test
pnpm --dir company-site test:field -- --run tests/field/ad-package.test.ts
```

Expected: FAIL because Drive and package modules do not exist.

- [ ] **Step 5: Implement company OAuth setup**

`google-drive-oauth.mjs` must request offline access for `https://www.googleapis.com/auth/drive.file`, print the authorization URL, accept the returned code from stdin, and print the refresh token once. Store production values only with Firebase Secrets:

```bash
firebase functions:secrets:set DRIVE_CLIENT_ID
firebase functions:secrets:set DRIVE_CLIENT_SECRET
firebase functions:secrets:set DRIVE_REFRESH_TOKEN
firebase functions:secrets:set DRIVE_ROOT_FOLDER_ID
```

Set `DRIVE_ROOT_FOLDER_ID` to `1A7JZQLNkuSWMrpAbVcse6EoUeUAKoN3S`. Never commit secret values or write them to Realtime Database.

- [ ] **Step 6: Implement folder and media synchronization**

Use Google Drive API queries scoped by parent ID, exact name, non-trashed state, and folder MIME type. Record every resulting folder/file ID under the job. Stream the Firebase Storage object to a resumable Drive upload. On retry, return the stored Drive file ID when the size and checksum match.

- [ ] **Step 7: Implement reviewed package generation**

The callable `createAdPackage` requires reviewer or admin role, validates listing completion, uses only `buildAdvertisingProjection`, creates UTF-8 `04_당근_매물설명.txt` and `05_네이버부동산_입력정보.txt`, and copies approved media references into the ordered package folders. Generate `06_현장체크리스트.pdf` from the immutable checklist submission snapshot with `pdf-lib`, `@pdf-lib/fontkit`, and the Korean font bytes from the installed `@fontsource/noto-sans-kr` package; do not depend on a host OS font. Store package version, reviewer UID, creation time, Drive folder ID, and file IDs.

- [ ] **Step 8: Implement package review UI**

Allow the reviewer to drag representative photos into order, exclude unsuitable media without deleting originals, preview both text files, and request generation. Display generation and Drive sync states; disable the button while required fields or required media are missing.

- [ ] **Step 9: Run checkpoint verification and commit**

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site build
pnpm --dir functions test
pnpm --dir functions build
git add functions company-site/app/field company-site/tests/field
git commit -m "feat: sync field media and ad packages to Drive"
```

Expected: all commands exit 0 before commit.

## Checkpoint 3: Map and release

### Task 11: Add the authenticated property layer to the existing Naver map

**Files:**
- Create: `data/field-map-model.js`
- Create: `data/field-map-model.test.js`
- Modify: `wonju-map.html`
- Modify: `index.html`

- [ ] **Step 1: Write failing pure map-model tests**

Use Node's test runner. Verify that:

- only records with valid coordinates produce markers;
- status maps to stable colors (`lead`, `vacant`, `managed`, `archived`);
- the default popup contains building name, vacancy count, approved rent summary, parking, and capture status;
- secure access, owner contact, and internal notes never appear;
- filters can independently toggle vendor and property layers.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test data/field-map-model.test.js`

Expected: FAIL because the model file does not exist.

- [ ] **Step 3: Implement the pure projection**

Export `toPropertyMarkers`, `propertyMarkerColor`, `filterMapItems`, and `safePropertyPopupModel` from `field-map-model.js` using a UMD-compatible wrapper so Node tests and the legacy browser page can both load it.

- [ ] **Step 4: Integrate authenticated Firebase data**

In `wonju-map.html`, preserve the current vendor dataset and filters. Add Firebase Auth/Database compatibility SDKs, require a claim with `fieldPlatform: true` before reading properties, subscribe to `fieldPlatform/buildings`, `units`, and `listings`, and add independent property layer checkboxes. Redirect unauthenticated users to `/field` with a return URL.

Change the existing `index.html` `건물지도` link to `/field?view=map` for internal users while retaining the legacy URL for compatibility. Do not change the vendor dataset behavior.

- [ ] **Step 5: Run map and legacy tests**

Run:

```bash
node --test data/field-map-model.test.js
node --test apps-script/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add data/field-map-model.js data/field-map-model.test.js wonju-map.html index.html
git commit -m "feat: show authenticated properties on building map"
```

### Task 12: Export, deploy, and preserve existing products

**Files:**
- Modify: `company-site/scripts/export-firebase.mjs`
- Modify: `company-site/tests/rendered-html.test.mjs`
- Modify: `company-site/package.json`
- Modify: `firebase.json`
- Create: `docs/field-platform-operations.md`

- [ ] **Step 1: Add failing published-output tests**

Assert that the export contains `field/index.html`, the PWA manifest link, `field-sw.js`, both icons, no source maps containing Firebase secrets, and the Korean title `BRING 현장 매물 플랫폼`.

- [ ] **Step 2: Run export tests to verify failure**

Run: `pnpm --dir company-site test`

Expected: FAIL because `/field` is not yet exported.

- [ ] **Step 3: Extend the exporter**

Add `/field` to the route list, copy `field-sw.js` and `field-icons`, and make the export fail if any required PWA artifact is absent. Add appropriate Firebase Hosting headers: `no-store` for `/field/index.html` and the service worker, immutable caching only for hashed assets.

- [ ] **Step 4: Write the operator runbook**

Document exact procedures for:

- adding/removing allowed staff emails;
- assigning roles and secure-access permission;
- rotating Drive OAuth secrets;
- changing the root Drive folder;
- retrying failed Drive jobs;
- recovering deleted records;
- updating checklist templates by creating a new version;
- checking Firebase Storage and Drive capacity;
- rolling back Hosting and Functions independently.

- [ ] **Step 5: Run full automated verification**

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site lint
pnpm --dir company-site test
pnpm --dir functions test
pnpm --dir functions build
node --test data/field-map-model.test.js
node --test cloudflare-worker/test/*.test.js
node --test apps-script/*.test.js
pnpm --dir company-site exec firebase --config ../firebase.json --project bring-fm-hj emulators:exec --only database,storage "pnpm test:rules"
git diff --check
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 6: Commit**

```bash
git add company-site firebase.json docs/field-platform-operations.md
git commit -m "build: publish BRING field platform"
```

### Task 13: Complete device, failure-recovery, and acceptance verification

**Files:**
- Create: `docs/field-platform-acceptance.md`
- Modify only when a verified defect is found: relevant implementation and test files

- [ ] **Step 1: Create a test-only building and unit**

Use `테스트_우산동_BRING빌` and `TEST-201호`. Mark all records with `testData: true`. Do not use a real door code, owner phone, or tenant data.

- [ ] **Step 2: Run the mobile workflow on iPhone Safari**

Verify Google login, home-screen installation, address search, GPS warning, offline checklist, one photo in every required slot, a 10-20 second vertical video, reconnect, progress display, and Firebase upload completion. Record pass/fail and device/browser version in `docs/field-platform-acceptance.md`.

- [ ] **Step 3: Repeat critical workflow on Android Chrome and PC Chrome**

Verify login, draft restoration, upload retry, desktop dashboard, package review, and map layer. Record each result.

- [ ] **Step 4: Verify Drive output exactly**

Confirm the folder is under Drive root ID `1A7JZQLNkuSWMrpAbVcse6EoUeUAKoN3S`, file counts match the approved media list, UTF-8 Korean text opens correctly, videos play, retries create no duplicates, and the checklist PDF contains the immutable submission.

- [ ] **Step 5: Verify security boundaries**

Using staff, reviewer, admin, and blocked accounts, confirm the approved role matrix. Search generated text and PDF files for the test sentinel strings `TEST-DOOR-SECRET`, `TEST-OWNER-PHONE`, and `TEST-INTERNAL-MEMO`; all searches must return zero matches.

- [ ] **Step 6: Verify failure recovery**

Interrupt a video upload, revoke Drive authorization temporarily, force a duplicate job delivery, and restore connectivity/authorization. Confirm the queue resumes, the dashboard reports a safe error, the source media remains intact, and only one Drive file exists after recovery.

- [ ] **Step 7: Remove test data and run final verification**

Move test Drive folders to trash, remove `testData: true` Firebase records through the admin recovery flow, then rerun the complete command block from Task 12 Step 5.

- [ ] **Step 8: Commit acceptance evidence**

```bash
git add docs/field-platform-acceptance.md
git commit -m "test: verify BRING field platform release"
```

## Final release gate

Release only when all conditions are true:

- Every automated command in Task 12 Step 5 exits 0.
- The iPhone, Android, and PC acceptance rows are marked PASS.
- A real-size video survives interrupted upload and resumes.
- A Drive retry does not create a duplicate.
- The Naver map shows the new property within one refresh cycle.
- The advertising package contains all approved media and no secure/internal values.
- Existing FM, vendor map, Apps Script, Cloudflare Worker, and company site tests still pass.
- The operations runbook has a named administrator and the production allowed-email list has been reviewed.

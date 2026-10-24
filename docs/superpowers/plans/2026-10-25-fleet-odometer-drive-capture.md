# Fleet Odometer Drive Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make start odometer and camera evidence mandatory and store the captured image in the exact company Google Drive `브링 케어/BRING CAR` folder before creating a trip.

**Architecture:** Reuse the server-side company Google Drive OAuth secrets and Drive adapter behind an App Check-protected callable function. The function validates the configured `BRING CAR` folder, creates `계기판 사진/YYYY-MM`, uploads an idempotently named JPEG, then the client persists only validated Drive receipt metadata in Realtime Database.

**Tech Stack:** React, TypeScript, Firebase Realtime Database rules, Google Identity Services, Google Drive API, Vitest, Firebase Emulator Suite, Vinext PWA.

---

## File map

- Create `functions/src/fleet/upload-odometer-evidence.ts`: server-side input validation, folder planning, idempotent Drive upload and receipt validation.
- Modify `functions/src/index.ts`: authenticated App Check-protected callable and company Drive adapter wiring.
- Create `company-site/app/fleet/FleetPhotoCapture.tsx`: mobile camera input, preview and retake UI.
- Modify `company-site/app/fleet/fleet-policy.ts`: require explicit integer start km and validate Drive receipt metadata.
- Modify `company-site/app/fleet/fleet-repository.client.ts`: upload first, persist Drive metadata, never persist image data URLs.
- Modify `company-site/app/fleet/FleetApp.tsx`: Drive connection state, mandatory camera control and upload progress/error flow.
- Modify `company-site/app/fleet/fleet.css`: camera card, preview and Drive state styles.
- Modify `database.rules.json`: require Drive evidence metadata and reject legacy data URLs for new trips.
- Create/modify `company-site/tests/field/fleet-drive-evidence.test.ts`, `fleet-policy.test.ts`, `fleet-rules.test.ts`: behavior and security coverage.

### Task 1: Resolve and verify the exact Drive destination

- [ ] **Step 1: Read the Google Drive Desktop metadata for the local folder**

Inspect the DriveFS account containing `H:\내 드라이브\브링 케어\BRING CAR` and resolve its stable Google Drive item ID without changing folder contents.

- [ ] **Step 2: Verify the folder through Drive API**

Use the existing company Drive OAuth flow and `files.get(fields=id,name,mimeType,parents,capabilities)` to prove the resolved folder is named `BRING CAR`, is a folder, and permits adding children.

- [ ] **Step 3: Record only the non-secret folder ID in fleet configuration**

Add `FLEET_DRIVE_ROOT_FOLDER_ID` to `fleet-drive-evidence.client.ts`. Do not store OAuth tokens or account credentials.

### Task 2: Make start km explicitly mandatory

- [ ] **Step 1: Write failing policy tests**

Extend `company-site/tests/field/fleet-policy.test.ts` so blank, decimal, non-numeric and lower-than-current start km fail, while an integer equal to or above current km passes.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `pnpm vitest run tests/field/fleet-policy.test.ts` from `company-site`; expect the blank-km case to fail because it currently falls back to current km.

- [ ] **Step 3: Implement minimal validation**

Update `prepareTripStart` to return `출발 km를 입력해 주세요.` for blank input and reject non-integer values.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same test and expect all policy cases to pass.

- [ ] **Step 5: Commit**

Commit as `test(fleet): require explicit start odometer`.

### Task 3: Add deterministic server-side Drive upload planning

- [ ] **Step 1: Write failing Drive evidence tests**

Create `functions/test/fleet-odometer-evidence.test.ts` covering:

- `계기판 사진/2026-10` for a 2026-10-25 Korean timestamp.
- sanitized `20261025-0930_김민욱_1280km_trip1234.jpg`.
- rejection of a folder response that is not the configured root or cannot add children.
- reuse of an existing file carrying the same `bringFleetTripId` app property.

- [ ] **Step 2: Run and confirm RED**

Run `pnpm vitest run test/fleet-odometer-evidence.test.ts` from `functions`; expect module-not-found failure.

- [ ] **Step 3: Implement the fleet Drive evidence module**

Export `uploadFleetOdometerEvidenceCore` and wire an App Check-protected callable using the server Drive OAuth secrets. It must validate the fixed root, ensure folders, find the trip idempotency property and upload JPEG bytes, returning `{ driveFileId, driveUrl, fileName, uploadState: "complete" }` only after validating the Drive response.

- [ ] **Step 4: Run and confirm GREEN**

Run the focused test and expect all cases to pass.

- [ ] **Step 5: Commit**

Commit as `feat(fleet): add Drive odometer evidence uploader`.

### Task 4: Add mobile capture, preview and retake UI

- [ ] **Step 1: Write a failing component/source contract test**

Create a test proving the camera input uses `accept="image/jpeg,image/png,image/webp"`, `capture="environment"`, and `required`, and that selecting a file creates a preview with a `다시 촬영` action.

- [ ] **Step 2: Run and confirm RED**

Run the focused component test; expect it to fail because `FleetPhotoCapture` does not exist.

- [ ] **Step 3: Implement `FleetPhotoCapture`**

Keep the native file input accessible, label the primary action `계기판 사진 촬영`, show the selected preview using an object URL, revoke replaced/unmounted URLs, and clear the input for retake.

- [ ] **Step 4: Integrate Drive connection and upload state**

Render the existing `DriveConnectionControl` in the start form. Disable submission while disconnected/uploading, preserve fields and preview on failure, and show `Drive 저장 중…` until the receipt is returned.

- [ ] **Step 5: Style and verify focused tests**

Add mobile-safe styles to `fleet.css`; run component, policy and Drive evidence tests.

- [ ] **Step 6: Commit**

Commit as `feat(fleet): add mandatory camera capture flow`.

### Task 5: Persist Drive receipts atomically and harden rules

- [ ] **Step 1: Write failing repository and rules tests**

Add tests proving upload happens before `set`, upload failure performs no trip write, successful trip data contains all four Drive receipt fields, missing/invalid receipt fields fail rules, and `data:image/...` evidence is rejected.

- [ ] **Step 2: Run focused tests and confirm RED**

Run repository tests and the fleet rules emulator; expect failures against the current `evidenceUrl` schema.

- [ ] **Step 3: Implement upload-before-write repository flow**

Generate the trip push key first, upload using that key as the idempotency property, then save the trip. On DB retry, find and reuse the already-uploaded Drive file.

- [ ] **Step 4: Update Firebase rules**

Require `evidenceDriveFileId`, a canonical `https://drive.google.com/file/d/.../view` URL, bounded `evidenceFileName`, and `evidenceUploadState === "complete"`. Reject new `evidenceUrl` fields while preserving read compatibility for historical trips.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the repository tests and `pnpm exec firebase --config ../firebase.json --project demo-bring-fm emulators:exec --only database,storage "pnpm test:rules"`.

- [ ] **Step 6: Commit**

Commit as `security(fleet): require completed Drive evidence`.

### Task 6: Build, export, live Drive verification and deployment

- [ ] **Step 1: Run full local verification**

Run fleet tests, all 153+ Firebase rules tests, `pnpm run typecheck:field`, `pnpm exec eslint app/fleet`, `pnpm run build`, `pnpm run export:firebase`, and `git diff --check`.

- [ ] **Step 2: Preserve PWA compatibility assets**

Re-run `fleet-production-compat.test.ts` after export and restore the recorded legacy bootstraps if the deterministic export removed them.

- [ ] **Step 3: Verify one real upload**

Using the company Drive connection, upload one small labeled verification JPEG to `BRING CAR/계기판 사진/YYYY-MM`, verify its Drive file ID and visible folder path, then remove the verification file so no test artifact remains.

- [ ] **Step 4: Create and merge a pull request**

Push the feature branch, create a PR to `codex/bring-field-platform`, wait for all checks, attach the PR, and merge only when green.

- [ ] **Step 5: Back up and deploy**

Run the rules snapshot workflow, deploy database rules and hosting, and verify the live asset and rules releases.

- [ ] **Step 6: Verify live mobile behavior**

Open the production fleet route, sign in with an approved company account, confirm km and photo required states, camera capture attributes, Drive connection control, preview/retake UI, and successful Drive receipt persistence without creating a real business trip. Use the dedicated upload verification path rather than submitting an operational trip.


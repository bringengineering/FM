# Fleet Start, Weekend Booking, and Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trip purpose free-text, destination and odometer photo mandatory, start km optional with a safe fallback, enforce approved weekend reservations, and apply the official transparent BRING logo.

**Architecture:** Extract form and booking rules into a pure `fleet-policy.ts` module so UI and repository share one testable contract. Keep Firebase as the real-time source, validate the same invariants in Realtime Database rules, and use a checked-in transparent logo asset served by Firebase Hosting.

**Tech Stack:** React 19, TypeScript, Firebase Realtime Database, Vitest, Firebase Rules emulator, Vinext, Firebase Hosting.

---

### Task 1: Add pure trip and reservation policy

**Files:**
- Create: `company-site/app/fleet/fleet-policy.ts`
- Create: `company-site/tests/field/fleet-policy.test.ts`

- [ ] **Step 1: Write failing tests** for trimming free-text purpose/destination, optional km fallback, mandatory evidence, weekend approval, and half-open interval overlap.
- [ ] **Step 2: Run** `pnpm vitest run tests/field/fleet-policy.test.ts` and confirm failures are caused by missing policy exports.
- [ ] **Step 3: Implement** `prepareTripStart`, `isWeekendAt`, `hasApprovedWeekendReservation`, and `overlapsReservation` with explicit return errors.
- [ ] **Step 4: Re-run the policy tests** and expect all cases to pass.
- [ ] **Step 5: Commit** `test/field/fleet-policy.test.ts` and `app/fleet/fleet-policy.ts`.

### Task 2: Update the mobile forms and repository

**Files:**
- Modify: `company-site/app/fleet/FleetApp.tsx`
- Modify: `company-site/app/fleet/fleet-repository.client.ts`
- Modify: `company-site/app/fleet/fleet.css`
- Test: `company-site/tests/field/fleet-policy.test.ts`

- [ ] **Step 1: Extend failing policy tests** to prove whitespace-only purpose/destination and missing photo are rejected while blank km resolves to current km.
- [ ] **Step 2: Run the focused test** and confirm the new cases fail.
- [ ] **Step 3: Replace the purpose `<select>` with a required text input**, keep destination required, remove required/default from the km input, and mark the photo input required.
- [ ] **Step 4: Call the policy before `startTrip`** and block weekend departure without an approved reservation covering the current time.
- [ ] **Step 5: Add reservation overlap checks** before create and before admin approval; show Korean errors without exposing another employee's details.
- [ ] **Step 6: Run policy tests, typecheck, and lint**, then commit.

### Task 3: Tighten Firebase rules

**Files:**
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/fleet-rules.test.ts`
- Modify: `company-site/package.json`

- [ ] **Step 1: Add emulator tests** proving trip creation fails without nonblank purpose, nonblank destination, or JPEG evidence and succeeds when km is resolved to a number.
- [ ] **Step 2: Add emulator tests** proving member reservations are created only for the authenticated user and admin-only decisions remain enforced.
- [ ] **Step 3: Run the emulator suite** and confirm the new invalid-write expectations expose the current loose validation.
- [ ] **Step 4: Add bounded string, evidence prefix/size, timestamp, and reservation validation** to `crmCompany/fleetManagement`.
- [ ] **Step 5: Run the full Database/Storage emulator rule suite** and commit.

### Task 4: Retrieve and prepare the official logo

**Files:**
- Create or replace: `company-site/public/fleet/bring-engineering-logo.png`
- Modify: `company-site/public/fleet/manifest.webmanifest`
- Modify: `company-site/app/fleet/FleetApp.tsx`
- Modify: `company-site/app/fleet/fleet.css`

- [ ] **Step 1: Search Google Drive** for BRING/브링엔지니어링 logo files and verify the candidate by filename, MIME type, dimensions, and visual preview.
- [ ] **Step 2: Prefer an existing SVG/transparent PNG**; otherwise remove the background and export a tightly cropped transparent PNG.
- [ ] **Step 3: Inspect transparency and edges** on light and dark backgrounds.
- [ ] **Step 4: Apply the logo** to the login screen, top navigation, and PWA manifest while preserving aspect ratio and accessible alt text.
- [ ] **Step 5: Build and visually inspect mobile and desktop routes**, then commit.

### Task 5: Release and production verification

**Files:**
- Regenerate: `company-site/firebase-public/**`

- [ ] **Step 1: Run** focused tests, full rules emulator tests, `pnpm run typecheck:field`, fleet lint, build, and `pnpm run export:firebase`.
- [ ] **Step 2: Confirm** `git diff --check` and inspect the final staged diff for every requirement.
- [ ] **Step 3: Push a feature branch, create a PR, wait for all repository checks, and merge into `codex/bring-field-platform`.**
- [ ] **Step 4: Back up current live rules, deploy Database Rules and Hosting, and verify both workflows or perform the authenticated manual hosting fallback if the known service-account IAM issue recurs.
- [ ] **Step 5: Verify** `https://bring-fm.web.app/fleet`, PWA manifest, logo asset, required form behavior, weekend booking behavior, and live Firebase data/rules.

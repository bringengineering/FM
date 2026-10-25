# Fleet Multi-Vehicle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Kia Morning `23모 0648` as a second independently managed shared vehicle alongside the existing EV4.

**Architecture:** Introduce a small vehicle-selection domain and make every repository mutation accept an explicit vehicle ID. Keep the existing Firebase shape and filter the home, calendar, records, and admin actions by the selected vehicle. Seed the Morning idempotently without overwriting existing fleet data.

**Tech Stack:** React, TypeScript, Firebase Realtime Database, Vitest, Testing Library, Firebase Hosting

---

### Task 1: Vehicle selection domain and initialization

**Files:**
- Create: `company-site/app/fleet/fleet-vehicles.ts`
- Modify: `company-site/app/fleet/fleet-repository.client.ts`
- Test: `company-site/tests/field/fleet-vehicles.test.ts`

- [ ] **Step 1: Write failing tests**

Test that `FLEET_VEHICLES` contains `ev4-001` and `morning-001`, that the Morning has plate `23모 0648`, and that helpers filter records by an explicit vehicle ID.

- [ ] **Step 2: Verify the tests fail**

Run `pnpm exec vitest run tests/field/fleet-vehicles.test.ts`; expect a missing-module failure.

- [ ] **Step 3: Implement the vehicle domain**

Export typed vehicle IDs, fixed display metadata, `recordsForVehicle`, and `currentOdometerForVehicle`. Change initialization to update only missing vehicle records and add `vehicles/morning-001` with no fabricated odometer reading.

- [ ] **Step 4: Verify and commit**

Run the focused test and commit the domain/repository changes.

### Task 2: Make writes vehicle-aware

**Files:**
- Modify: `company-site/app/fleet/fleet-repository.client.ts`
- Modify: `company-site/app/fleet/fleet-start.ts`
- Test: `company-site/tests/field/fleet-multi-vehicle-writes.test.ts`

- [ ] **Step 1: Write failing tests**

Test that reservation, trip-start upload metadata, and issue payload builders preserve `morning-001` instead of hard-coding `ev4-001`.

- [ ] **Step 2: Verify the tests fail**

Run `pnpm exec vitest run tests/field/fleet-multi-vehicle-writes.test.ts`; expect assertions to show `ev4-001`.

- [ ] **Step 3: Implement explicit vehicle IDs**

Require `vehicleId` in create-reservation, start-trip, and report-issue inputs. Validate against known vehicles before writing. Include the chosen vehicle ID in Drive upload metadata and file naming inputs.

- [ ] **Step 4: Verify and commit**

Run the focused write tests and existing photo/start tests, then commit.

### Task 3: Add the vehicle switcher and filtered screens

**Files:**
- Create: `company-site/app/fleet/FleetVehicleSwitcher.tsx`
- Modify: `company-site/app/fleet/FleetApp.tsx`
- Modify: `company-site/app/fleet/FleetSchedule.tsx`
- Modify: `company-site/app/fleet/fleet.css`
- Test: `company-site/tests/field/fleet-multi-vehicle-ui.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Render both vehicle tabs, switch to Morning, and assert the plate, first-drive odometer label, schedule filtering, and Morning-specific write callbacks.

- [ ] **Step 2: Verify the tests fail**

Run `pnpm exec vitest run tests/field/fleet-multi-vehicle-ui.test.tsx`; expect missing switcher and unfiltered data failures.

- [ ] **Step 3: Implement the UI**

Keep `selectedVehicleId` in `FleetApp`, render a 44px minimum accessible tab control, filter trips/reservations/issues by it, and pass it to all mutations. Prevent starting a vehicle that already has any active trip. Show `첫 운행 시 등록` when the Morning has no odometer evidence.

- [ ] **Step 4: Make conflicts vehicle-specific**

Filter overlap checks by matching `vehicleId`, allowing simultaneous reservations on different vehicles.

- [ ] **Step 5: Verify and commit**

Run the UI, schedule, calendar, policy, and start tests; commit the UI change.

### Task 4: Export, regression test, and deploy

**Files:**
- Modify: `company-site/public/fleet/sw.js`
- Modify: `company-site/firebase-public/**`
- Test: `company-site/tests/field/fleet-service-worker.test.ts`

- [ ] **Step 1: Rotate the PWA cache**

Advance the Fleet cache version so installed phones receive the two-vehicle UI.

- [ ] **Step 2: Run full verification**

Run the fleet test suite, `pnpm run typecheck:field`, `pnpm exec eslint app/fleet`, `pnpm run build`, Firebase rules tests, and `git diff --check`.

- [ ] **Step 3: Export and commit**

Generate `company-site/firebase-public`, preserve required legacy PWA assets, and commit the reviewed export.

- [ ] **Step 4: Integrate and deploy**

Push a PR, wait for CI, merge after success, deploy Firebase Hosting only, and verify the live site by switching between EV4 and Morning without submitting production test data.

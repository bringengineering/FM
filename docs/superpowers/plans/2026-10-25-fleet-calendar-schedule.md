# Fleet Calendar Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate vehicle reservation entry point with a polished monthly calendar where employees inspect availability, select a date, and submit a reservation in context.

**Architecture:** Keep the existing Firebase reservation schema and repository writes. Add pure Korea-time calendar utilities, focused calendar/day-panel components, and integrate them into `FleetApp` while preserving existing approval and overlap rules. The UI remains a single installable React PWA with responsive CSS.

**Tech Stack:** React 19, TypeScript, CSS, Firebase Realtime Database, Vitest, Testing Library, vinext.

---

## File map

- Create `company-site/app/fleet/fleet-calendar.ts`: pure month-grid, date-key, grouping, and reservation validation helpers.
- Create `company-site/app/fleet/FleetCalendar.tsx`: accessible month navigation and 7-column date grid.
- Create `company-site/app/fleet/FleetSchedule.tsx`: selected-day agenda and in-context reservation form.
- Modify `company-site/app/fleet/FleetApp.tsx`: replace reserve screen/entry point and connect live reservations.
- Modify `company-site/app/fleet/fleet.css`: calendar-first responsive visual system.
- Create `company-site/tests/field/fleet-calendar.test.ts`: date and grouping unit tests.
- Create `company-site/tests/field/fleet-schedule.test.tsx`: interaction and reservation-form tests.
- Modify `company-site/public/fleet/sw.js`: advance PWA cache version.
- Modify `company-site/tests/field/fleet-service-worker.test.ts`: assert the new cache version.

### Task 1: Calendar domain utilities

**Files:**
- Create: `company-site/app/fleet/fleet-calendar.ts`
- Test: `company-site/tests/field/fleet-calendar.test.ts`

- [ ] **Step 1: Write failing month-grid and grouping tests**

Test that October 2026 yields a Monday-first 42-cell grid, date keys remain `YYYY-MM-DD` in Korea time, reservations spanning midnight appear on both dates, and rejected reservations are excluded from public day counts.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/field/fleet-calendar.test.ts`

Expected: FAIL because `fleet-calendar.ts` does not exist.

- [ ] **Step 3: Implement pure helpers**

Export:

```ts
export type CalendarDay = { key: string; date: Date; dayNumber: number; inMonth: boolean; isToday: boolean };
export function koreaDateKey(value: Date | string): string;
export function buildMonthGrid(month: Date, today?: Date): CalendarDay[];
export function reservationsForDay(reservations: Reservation[], dayKey: string): Reservation[];
export function reservationStatusCounts(reservations: Reservation[]): { approved: number; pending: number };
export function validateReservationRange(startAt: string, endAt: string, now?: Date): string | null;
```

Use `Asia/Seoul` formatting, Monday-first grid padding, half-open reservation ranges, and reject equal/reversed/past ranges.

- [ ] **Step 4: Run the focused test and verify green**

Run: `pnpm vitest run tests/field/fleet-calendar.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/fleet/fleet-calendar.ts company-site/tests/field/fleet-calendar.test.ts
git commit -m "feat(fleet): add calendar scheduling domain"
```

### Task 2: Accessible calendar component

**Files:**
- Create: `company-site/app/fleet/FleetCalendar.tsx`
- Test: `company-site/tests/field/fleet-schedule.test.tsx`

- [ ] **Step 1: Write failing calendar interaction tests**

Render October 2026 and assert weekday headers, 42 date buttons, visible month label, accessible previous/next/today buttons, selected state, and reservation status text. Click a date and verify its key is returned.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/field/fleet-schedule.test.tsx`

Expected: FAIL because `FleetCalendar` does not exist.

- [ ] **Step 3: Implement `FleetCalendar`**

Use semantic buttons with `aria-pressed`, `aria-label`, visible `승인 N` / `대기 N` chips, and stateful month navigation. Every control must have at least a 44px hit target.

- [ ] **Step 4: Run the focused test and verify green**

Run: `pnpm vitest run tests/field/fleet-schedule.test.tsx`

Expected: calendar tests PASS.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/fleet/FleetCalendar.tsx company-site/tests/field/fleet-schedule.test.tsx
git commit -m "feat(fleet): add accessible reservation calendar"
```

### Task 3: Selected-day schedule and contextual form

**Files:**
- Create: `company-site/app/fleet/FleetSchedule.tsx`
- Modify: `company-site/tests/field/fleet-schedule.test.tsx`

- [ ] **Step 1: Add failing day-panel tests**

Assert that selecting `2026-10-31` displays the date, existing approved/pending reservations, an empty `예약 가능` state when appropriate, and a form whose start/end fields default to the selected date. Verify weekends default to `weekend`, invalid ranges show inline errors, and a successful submit preserves the selected date.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/field/fleet-schedule.test.tsx`

Expected: FAIL because `FleetSchedule` does not exist.

- [ ] **Step 3: Implement `FleetSchedule`**

Compose `FleetCalendar` with a selected-day panel. Keep form state locally, infer weekend approval type, allow an explicit next-day end date for overnight reservations, call `validateReservationRange`, check overlaps against pending/approved reservations, and call the provided async submit callback. Keep the panel open and show a clear saving state.

- [ ] **Step 4: Run the focused test and verify green**

Run: `pnpm vitest run tests/field/fleet-schedule.test.tsx`

Expected: all schedule tests PASS.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/fleet/FleetSchedule.tsx company-site/tests/field/fleet-schedule.test.tsx
git commit -m "feat(fleet): reserve from selected calendar date"
```

### Task 4: App integration and administrator workflow

**Files:**
- Modify: `company-site/app/fleet/FleetApp.tsx`
- Modify: `company-site/tests/field/fleet-schedule.test.tsx`

- [ ] **Step 1: Add failing integration assertions**

Assert the home action is named `차량 일정표`, not `예약 신청`, and that admins see pending reservation actions within the schedule workflow while regular employees do not.

- [ ] **Step 2: Run the tests and verify red**

Run: `pnpm vitest run tests/field/fleet-schedule.test.tsx`

Expected: FAIL against the old home entry point.

- [ ] **Step 3: Integrate the schedule**

Replace screen `reserve` with `schedule`, render `FleetSchedule`, connect `createReservation`, keep the existing overlap check, and display approval controls for admins. Remove the old standalone `ReservationForm`. Preserve the selected schedule screen after successful save rather than returning home.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm vitest run tests/field/fleet-schedule.test.tsx tests/field/fleet-policy.test.ts
pnpm run typecheck:field
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add company-site/app/fleet/FleetApp.tsx company-site/tests/field/fleet-schedule.test.tsx
git commit -m "feat(fleet): make schedule the reservation entry point"
```

### Task 5: Responsive visual redesign

**Files:**
- Modify: `company-site/app/fleet/fleet.css`

- [ ] **Step 1: Implement calendar design tokens and layouts**

Add semantic surface, text, border, navy, lime, pending, approved, and rejected tokens. Style the 7-column grid, month toolbar, selected day, today, status chips, day agenda, and form. At widths above 900px use a two-column calendar/panel layout; at 375px keep all content inside the viewport.

- [ ] **Step 2: Add accessibility states**

Provide `:focus-visible` rings, hover/pressed states without layout shift, 44px minimum targets, high-contrast status labels, and a `prefers-reduced-motion` override.

- [ ] **Step 3: Run lint and build**

Run:

```bash
pnpm exec eslint app/fleet
pnpm run typecheck:field
pnpm run build
```

Expected: exit 0 for all commands.

- [ ] **Step 4: Commit**

```bash
git add company-site/app/fleet/fleet.css
git commit -m "style(fleet): redesign calendar scheduling experience"
```

### Task 6: PWA release and complete verification

**Files:**
- Modify: `company-site/public/fleet/sw.js`
- Modify: `company-site/tests/field/fleet-service-worker.test.ts`
- Regenerate: `company-site/firebase-public/**`

- [ ] **Step 1: Write the failing cache-version assertion**

Advance the expected fleet cache from `bring-fleet-v3` to `bring-fleet-v4`, run the service-worker test, and confirm it fails.

- [ ] **Step 2: Update the service worker and registration query**

Set the cache to `bring-fleet-v4` and update the registration query in `FleetApp.tsx` so installed clients fetch the release.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
pnpm vitest run tests/field/fleet-calendar.test.ts tests/field/fleet-schedule.test.tsx tests/field/fleet-policy.test.ts tests/field/fleet-photo-capture.test.tsx tests/field/fleet-start.test.ts tests/field/fleet-service-worker.test.ts tests/field/fleet-production-compat.test.ts
pnpm run typecheck:field
pnpm exec eslint app/fleet
pnpm run build
pnpm exec firebase --config ../firebase.json --project demo-bring-fm emulators:exec --only database,storage "pnpm test:rules"
pnpm run export:firebase
```

Expected: all tests pass, lint/typecheck/build exit 0, and export completes.

- [ ] **Step 4: Preserve tracked legacy PWA chunks and rerun compatibility tests**

Restore only tracked chunks removed by the exporter, keep the newly generated assets, then run:

```bash
pnpm vitest run tests/field/fleet-production-compat.test.ts tests/field/fleet-service-worker.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add company-site/public/fleet/sw.js company-site/tests/field/fleet-service-worker.test.ts company-site/app/fleet/FleetApp.tsx company-site/firebase-public
git commit -m "chore(fleet): export calendar scheduling release"
```

### Task 7: Review, merge, deploy, and live verification

**Files:** none beyond review fixes.

- [ ] **Step 1: Review the branch diff and rerun affected tests after fixes**

Run `git diff --check origin/codex/bring-field-platform...HEAD` and inspect every changed file for calendar, reservation, accessibility, and legacy behavior coverage.

- [ ] **Step 2: Push and create a PR**

Push `codex/fleet-calendar-schedule`, create a PR to `codex/bring-field-platform`, attach it to the task, and wait for all CI checks.

- [ ] **Step 3: Merge only after CI succeeds**

Use a merge commit and leave the managed worktree intact.

- [ ] **Step 4: Deploy Database Rules only if changed, then Hosting**

Deploy the exact changed Firebase targets with `--project bring-fm --non-interactive`; this feature should normally require Hosting only.

- [ ] **Step 5: Verify live behavior**

Open `https://bring-fm.web.app/fleet`, confirm the authenticated home shows `차량 일정표`, open it, select another date, verify the form date follows the selection, verify reservation status labels and responsive layout, and avoid submitting production test data.

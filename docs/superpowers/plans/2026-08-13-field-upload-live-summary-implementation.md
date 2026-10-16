# BRING FIELD Live Upload Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real-time, device-wide counts for today's captures, uploads in progress, completed Drive uploads, failures, and overall progress.

**Architecture:** A pure summary module converts IndexedDB queue records into an Asia/Seoul-aware snapshot. `FieldWorkspace` polls the existing queue every second and refreshes on focus, online recovery, and Drive reconnection, then passes the snapshot to the existing shell and capture workspace.

**Tech Stack:** React 19, TypeScript, IndexedDB/idb, Vitest, Testing Library, CSS, Firebase Hosting.

---

### Task 1: Pure upload summary

**Files:**
- Create: `company-site/app/field/lib/upload-summary.ts`
- Create: `company-site/tests/field/upload-summary.test.ts`

- [ ] **Step 1: Write the failing summary tests**

Test `summarizeUploadRecords(records, now)` with Seoul midnight boundaries, previous-day pending and failed records, today-only completed records, and a rounded average progress value.

```ts
expect(summarizeUploadRecords(records, "2026-08-13T15:30:00.000Z")).toEqual({
  todayTotal: 3,
  uploading: 2,
  completedToday: 1,
  failed: 1,
  progressPercent: 50,
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/field/upload-summary.test.ts --reporter=verbose`

Expected: FAIL because `upload-summary.ts` does not exist.

- [ ] **Step 3: Implement the pure summary function**

Create an exported `UploadSummary` type, `EMPTY_UPLOAD_SUMMARY`, and `summarizeUploadRecords`. Use `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })` for date keys. Count all non-final pending states as uploading except `failed`; count all failures regardless of date; count finalized+Drive-complete records captured today as completed.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd exec vitest run tests/field/upload-summary.test.ts --reporter=verbose`

Expected: all summary tests PASS.

### Task 2: Live queue observer in the workspace

**Files:**
- Modify: `company-site/app/field/FieldApp.tsx`
- Test: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing live-refresh tests**

Use fake timers and a queue whose `list(uid)` response changes. Assert the shell receives new counts after one second, on `focus`, and on `online`; assert a changed session resets the snapshot before the next read.

```ts
await vi.advanceTimersByTimeAsync(1_000);
expect(screen.getByRole("status", { name: "업로드 현황" }))
  .toHaveTextContent("오늘 2업로드 중 1완료 1실패 0");
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/field/components.test.tsx --reporter=verbose`

Expected: FAIL because only `pendingCount` exists.

- [ ] **Step 3: Implement the polling lifecycle**

Replace `pendingCount` UI state with `{ summary, delayed }`. After opening the queue, call `queue.list(session.uid)` immediately, every 1,000 ms, and from `focus`/`online` listeners. Ignore stale async responses with a revision token; on read failure retain the last snapshot and set `delayed: true`. Refresh immediately from `DriveConnectionControl.onConnected`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd exec vitest run tests/field/components.test.tsx --reporter=verbose`

Expected: live-refresh tests PASS.

### Task 3: Compact global and detailed capture UI

**Files:**
- Modify: `company-site/app/field/components/AppShell.tsx`
- Modify: `company-site/app/field/components/CaptureWorkspace.tsx`
- Modify: `company-site/app/field/field.css`
- Test: `company-site/tests/field/components.test.tsx`
- Test: `company-site/tests/field/capture-workspace.test.tsx`
- Test: `company-site/tests/field/mobile-layout.test.ts`

- [ ] **Step 1: Write failing presentation tests**

Assert the shell renders `오늘`, `업로드 중`, `완료`, and `실패` counts in one accessible status region. Assert the capture screen renders the same four values plus a progress bar with `aria-valuenow`, and that the mobile CSS keeps the summary compact.

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/field/components.test.tsx tests/field/capture-workspace.test.tsx tests/field/mobile-layout.test.ts --reporter=verbose`

Expected: FAIL because the new summary props and progress bar are absent.

- [ ] **Step 3: Implement the UI**

Pass `UploadSummary` and the delayed flag through `AppShell` and `CaptureWorkspace`. Use four compact labels in the top bar, warning styling only when `failed > 0`, and a native ARIA progressbar in the capture workspace. Preserve the existing fixed-height mobile navigation and non-sticky top bar behavior.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd exec vitest run tests/field/components.test.tsx tests/field/capture-workspace.test.tsx tests/field/mobile-layout.test.ts --reporter=verbose`

Expected: all targeted UI tests PASS.

### Task 4: Regression verification and deployment

**Files:**
- Modify generated export only through existing scripts: `company-site/firebase-public/**`

- [ ] **Step 1: Run the complete field suite**

Run: `pnpm.cmd run test:field:run`

Expected: all non-emulator tests PASS; emulator-dependent tests may remain explicitly skipped when Java/emulators are unavailable.

- [ ] **Step 2: Run typecheck and build**

Run: `pnpm.cmd run typecheck:field`

Run: `pnpm.cmd run build`

Expected: both commands exit 0.

- [ ] **Step 3: Export and deploy Hosting**

Run: `pnpm.cmd run export:firebase`

Run: `pnpm.cmd exec firebase deploy --only hosting --project bring-fm --non-interactive`

Expected: Firebase reports `Deploy complete` for `https://bring-fm.web.app`.

- [ ] **Step 4: Verify the deployed bundle**

Fetch `/field` with a cache-busting query, resolve the emitted `FieldApp-*.js` asset, and confirm the production bundle contains the four Korean labels and the one-second refresh interval.

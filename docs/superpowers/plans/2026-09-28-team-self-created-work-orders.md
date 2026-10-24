# 팀원 본인 업무지시 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** CRM team members can directly create a complete official work order assigned only to themselves, while managers retain control of assignments, instruction edits, and completion review.

**Architecture:** Reuse the existing work-order editor and `RemoteClient.saveWorkOrder` path. The renderer exposes a self-service creation mode, the remote client enforces member-only self-creation and server-authored audit fields, and Firebase Realtime Database rules independently enforce the same constraints for member-created records.

**Tech Stack:** Electron renderer JavaScript, Node.js test runner, Firebase Realtime Database security rules and emulator tests.

---

## File Map

- Modify `desktop-crm/src/app.js`: show member CTA, lock member assignment to the authenticated UID, and protect create/edit event handlers.
- Modify `desktop-crm/src/remote.js`: allow member creation only when no record exists and the requested assignee is the current UID; force initial status/progress and audit metadata.
- Modify `database.rules.json`: enforce self-assignment and initial-state requirements for member-created work orders.
- Modify `desktop-crm/test/work-order-wiring.test.js`: cover visible self-create affordance and role-bounded renderer behavior.
- Modify `desktop-crm/test/work-order-concurrent-progress.test.js` or add `desktop-crm/test/work-order-member-create.test.js`: exercise the actual `RemoteClient.saveWorkOrder` method for member/admin/viewer creation and editing cases.
- Modify the existing Firebase rules emulator test file found by `rg --files` under `desktop-crm/test` or repository rules tests: exercise member self-create, reject other-assignee creation and malformed initial state, and preserve admin behavior.

### Task 1: Pin creation permissions in tests

**Files:**
- Modify: `desktop-crm/test/work-order-wiring.test.js`
- Create: `desktop-crm/test/work-order-member-create.test.js`

- [x] **Step 1: Write failing RemoteClient tests**

Test that a member can create a valid order for its own UID; the saved record is forced to `assigned`, progress `0`, and session-authored `createdBy`/`updatedBy`. Test that a member cannot create for another UID or modify an existing order. Test that viewer creation is rejected before reads/writes, and admin creation remains allowed.

- [x] **Step 2: Run the new tests and verify the expected failures**

Run: `node --test test/work-order-member-create.test.js`
Expected: member creation currently rejects with `WORK_ORDER_FORBIDDEN`; the negative cases should demonstrate the missing member-specific policy rather than fixture errors.

- [x] **Step 3: Write failing renderer wiring tests**

Assert that member mode exposes an `내 업무 추가` action, its form does not offer an assignee picker, and attempts to use the generic `새 지시` event path cannot assign another UID. Preserve admin assignment controls and viewer absence.

- [x] **Step 4: Run the focused wiring test**

Run: `node --test test/work-order-wiring.test.js`
Expected: fail because the current CTA and create handler are admin-only.

### Task 2: Enable secure self-creation in the remote client

**Files:**
- Modify: `desktop-crm/src/remote.js`
- Test: `desktop-crm/test/work-order-member-create.test.js`

- [x] **Step 1: Keep the existing admin policy and permit member creation only**

Change `saveWorkOrder(input)` to read the session role, reject viewer/other roles immediately, fetch the target record, reject member writes when the ID already exists, and reject member payloads unless the assignee equals `session.uid`. Preserve `validatePublication` for creation and `validateOrder` for admin edits.

- [x] **Step 2: Set authoritative creation fields**

For every new record set `status: "assigned"`, `progress: 0`, empty review/progress history, `createdBy` from the authenticated session display name/email, `createdAt` to the current time, and `updatedBy` to the session UID. Ignore client-supplied audit/state values for member-created orders.

- [x] **Step 3: Run the focused RemoteClient tests**

Run: `node --test test/work-order-member-create.test.js`
Expected: all member/admin/viewer positive and negative cases pass, including no database write after rejected payloads.

### Task 3: Enforce the same policy in the renderer

**Files:**
- Modify: `desktop-crm/src/app.js`
- Test: `desktop-crm/test/work-order-wiring.test.js`

- [x] **Step 1: Add the member-only creation action**

Render `내 업무 추가` when `workOrderState.canWork` is true and the signed-in role is not admin; retain the current `새 지시` and project controls for admins only.

- [x] **Step 2: Lock assignment and create behavior for members**

Use the session UID/name to prefill and lock the member assignee. Add a distinct self-create event path or an explicit creation mode, and make the save handler reject member edit state and any assignee mismatch before invoking `api.saveWorkOrder`.

- [x] **Step 3: Preserve existing validation, refresh, and sync flow**

Reuse the current publication validator, API, optimistic conflict handling, success message, list refresh, and wallboard sync signal. Do not make a failed save appear in the list.

- [x] **Step 4: Run focused renderer and regression tests**

Run: `node --test test/work-order-wiring.test.js test/project-workspace-wiring.test.js`
Expected: member can open only the self-create flow; admin can still assign/edit; viewer remains read-only.

### Task 4: Add Firebase rules enforcement

**Files:**
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`: exercise member self-create, reject other-assignee creation and malformed initial state, and preserve admin behavior.

- [x] **Step 1: Add failing emulator cases**

Add authenticated member cases that attempt self-assigned valid creation, creation for another UID, creation with a non-`assigned` status, and admin creation. Assert only the two legitimate creations succeed.

- [x] **Step 2: Verify the expected failure**

Run: `pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-fm emulators:exec --only database,storage "pnpm test:rules"`
Expected: the self-assigned creation should currently be rejected by the present create/update condition.

- [x] **Step 3: Update the create validation branch**

Require member-created records to have `assigneeUid === auth.uid`, an existing nonempty `projectId`, `status === assigned`, `progress === 0`, nonempty session-authored `createdBy`, `updatedBy === auth.uid`, valid timestamps, and the existing title/why/what/doneWhen/dueDate/deliverable/hour validations. Reject forged results/review state at creation. Keep admin creation and existing member progress-only writes unchanged.

- [x] **Step 4: Run the emulator tests**

Run: `pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-fm emulators:exec --only database,storage "pnpm test:rules"`
Expected: new cases and all existing rule tests pass.

### Task 5: Full verification and release

**Files:**
- No additional source files unless a regression is exposed.

- [x] **Step 1: Run full desktop tests and internal-data packaging gate**

Run in `desktop-crm`: `npm test`
Run in `desktop-crm`: `node scripts/release/check-internal-data.js`
Expected: all CRM tests pass and no internal weekly assignment data enters the release package.

- [x] **Step 2: Review the final diff and Firebase rule scope**

Run: `git diff --check`; inspect that member creation cannot modify existing work and that member-created tasks are always self-assigned.

- [x] **Step 3: Commit the feature and publish through the existing CRM release channel**

Push the verified CRM changes to `codex/bring-field-platform`; wait for the signed installer build, stable release publication, and live updater-channel probe to succeed before reporting the version.

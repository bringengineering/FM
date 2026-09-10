# CRM Immediate Server Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every explicit shared-CRM form save wait for confirmed company-server persistence before closing its UI or reporting success.

**Architecture:** Add a strict `saveNow` IPC path that uses the existing serialized remote mutation queue but never writes an offline pending file. Add one renderer transaction helper that snapshots shared state, performs strict persistence, rolls the in-memory mutation back on failure, and runs UI success callbacks only after confirmation. Keep canonical building/unit, schedule CAS, marketing, operations, messaging, and other dedicated server APIs unchanged.

**Tech Stack:** Electron IPC, Node.js, Firebase Realtime Database client, `node:test`, electron-builder

---

### Task 1: Strict remote save transport

**Files:**
- Modify: `desktop-crm/src/remote.js:3684-3720`
- Modify: `desktop-crm/src/main.js:2774-2794,6360`
- Modify: `desktop-crm/src/preload.js:41`
- Test: `desktop-crm/test/remote-save-merge.test.js`
- Test: `desktop-crm/test/production-auth.test.js`

- [ ] **Step 1: Write failing tests for a strict save**

Add assertions proving that `saveStoreNow` uses `enqueueSharedMutation`, calls the same guarded remote push, returns `pending: false`, and propagates retryable network errors without `writePendingStore`. Add preload/main assertions for the closed `crm:save-now` IPC endpoint.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/remote-save-merge.test.js test/production-auth.test.js`

Expected: FAIL because `saveStoreNow`, `crm:save-now`, and `api.saveNow` do not exist.

- [ ] **Step 3: Implement the strict transport**

Add this public remote method and a locked implementation mirroring the successful half of `saveStoreLocked`:

```js
async saveStoreNow(input) {
  const guard = this.captureSessionGuard();
  return this.enqueueSharedMutation(() => this.saveStoreNowLocked(input, guard));
}

async saveStoreNowLocked(input, guardValue) {
  const guard = guardValue || this.captureSessionGuard();
  this.assertSessionGuardActive(guard);
  this.requireMutationPermission();
  const overlays = this.Core.sanitizeRendererOverlays(input);
  const local = this.Core.sanitizeSharedStore(input);
  this.Core.assertNoProhibitedSecrets(local);
  local.updatedAt = new Date().toISOString();
  const result = await this.pushStoreLocked(local, guard);
  if (!result || !this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
  this.startStream();
  return { ok: true, data: mergeRendererOverlays(this.Core, result, overlays.buildingUnits, overlays.fieldSummaries), pending: false };
}
```

Expose `saveNow: data => ipcRenderer.invoke("crm:save-now", data)` in preload. Add `writeStoreNow` in main with the same local-test behavior as `writeStore`, and register it through `secureHandle("crm:save-now", data => writeStoreNow(data))`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/remote-save-merge.test.js test/production-auth.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/remote.js desktop-crm/src/main.js desktop-crm/src/preload.js desktop-crm/test/remote-save-merge.test.js desktop-crm/test/production-auth.test.js
git commit -m "feat(crm): add confirmed server save transport"
```

### Task 2: Renderer shared-save transaction

**Files:**
- Modify: `desktop-crm/src/app.js:110-1189`
- Test: `desktop-crm/test/customer-building-management.test.js`
- Test: `desktop-crm/test/remote-save-merge.test.js`

- [ ] **Step 1: Write failing transaction-contract tests**

Assert that the renderer has `saveStoreNow`, waits for `saveInFlight`, calls `api.saveNow`, rejects missing or pending results, updates `synchronizedStore` only from confirmed data, and exposes `commitSharedFormMutation`. Assert that the transaction helper restores the supplied `beforeStore`, leaves the form open, and reports an error when strict persistence fails.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/customer-building-management.test.js test/remote-save-merge.test.js`

Expected: FAIL because the strict renderer transaction does not exist.

- [ ] **Step 3: Implement confirmed renderer persistence**

Add a strict renderer save that clears the debounce timer, waits for any existing background save, snapshots the latest `store`, invokes `api.saveNow`, rejects `pending`, then installs the confirmed response into both `store` and `synchronizedStore`.

Add the transaction boundary:

```js
async function commitSharedFormMutation({ form, beforeStore, onSaved }) {
  if (form.dataset.submitting === "true") return false;
  form.dataset.submitting = "true";
  try {
    await saveStoreNow();
    if (typeof onSaved === "function") await onSaved();
    return true;
  } catch (error) {
    store = cloneStore(beforeStore);
    ensureSalesStore(store);
    queuedSave = null;
    clearTimeout(saveTimer);
    saveTimer = null;
    showToast(error.message || "회사 서버에 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.", "error");
    return false;
  } finally {
    delete form.dataset.submitting;
  }
}
```

Do not render or close the modal in the failure path, so its existing input elements retain the user's values.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/customer-building-management.test.js test/remote-save-merge.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/app.js desktop-crm/test/customer-building-management.test.js desktop-crm/test/remote-save-merge.test.js
git commit -m "feat(crm): confirm shared saves before UI success"
```

### Task 3: Correct customer registration semantics

**Files:**
- Modify: `desktop-crm/src/app.js:3732-3768,7477-7529`
- Test: `desktop-crm/test/customer-building-management.test.js`
- Test: `desktop-crm/test/customer-phone-format.test.js`

- [ ] **Step 1: Write a failing customer registration test**

Assert that a new customer with an empty `buildingId` does not call `commitCanonicalEntity`, does not create a building, and calls `commitSharedFormMutation`. Assert that an explicitly selected existing building remains in `buildingIdLinks` and is saved in the same strict shared-store transaction.

- [ ] **Step 2: Run the customer tests and verify RED**

Run: `node --test test/customer-building-management.test.js test/customer-phone-format.test.js`

Expected: FAIL because the current flow automatically creates a canonical building.

- [ ] **Step 3: Remove automatic building creation and use strict save**

Keep the optional existing-building selector, change its empty label to `건물 연결 안 함`, and remove the canonical-building block. Snapshot `beforeStore` before `customerFromForm(form)`, then call `commitSharedFormMutation`; only its `onSaved` callback may write the audit entry, close the modal, render, open the customer drawer, and show success.

- [ ] **Step 4: Run customer tests and verify GREEN**

Run: `node --test test/customer-building-management.test.js test/customer-phone-format.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/app.js desktop-crm/test/customer-building-management.test.js desktop-crm/test/customer-phone-format.test.js
git commit -m "fix(crm): save customers without creating buildings"
```

### Task 4: Migrate all generic shared forms

**Files:**
- Modify: `desktop-crm/src/app.js:6673-7764`
- Test: `desktop-crm/test/immediate-shared-save.test.js`

- [ ] **Step 1: Write a failing coverage test**

Create a source-contract test listing every generic shared form: `messageConsentForm`, `salesProspectForm`, `salesContactForm`, `salesActivityForm`, `salesEventForm`, `salesEventArchiveForm`, `salesResumeForm`, `salesOpportunityForm`, `contractForm`, `customerForm`, `partnerVendorForm`, `partnerQuoteForm`, `taskForm`, `relationshipActivityForm`, `activityForm`, `consultationForm`, `relationshipPlanForm`, `securityReturnForm`, `securityDispositionForm`, `securityAssetForm`, `accessRoleForm`, `auditForm`, `incidentForm`, and `settingsForm`. Require each branch to call `await commitSharedFormMutation` and forbid `scheduleSave()` followed by a success UI action inside those branches.

- [ ] **Step 2: Run the coverage test and verify RED**

Run: `node --test test/immediate-shared-save.test.js`

Expected: FAIL for every branch still using deferred `scheduleSave()`.

- [ ] **Step 3: Migrate each listed form**

For each branch, clone `beforeStore` immediately before the first mutation. Replace deferred save plus success UI statements with:

```js
await commitSharedFormMutation({
  form,
  beforeStore,
  onSaved: () => {
    closeModal();
    render();
    showToast("서버에 저장했습니다.", "success");
  },
});
```

Preserve each branch's existing destination view, drawer refresh, audit record, and Korean success text inside `onSaved`. Do not migrate forms already using dedicated APIs: marketing attribution, operations intelligence, building schedules, work records, Drive decisions, canonical sales units/buildings/units, workflow cases, payment APIs, vacancy APIs, customer messaging, login, or password change.

- [ ] **Step 4: Run coverage and focused feature tests**

Run: `node --test test/immediate-shared-save.test.js test/customer-building-management.test.js test/sales-ui.test.js test/security-governance.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-crm/src/app.js desktop-crm/test/immediate-shared-save.test.js
git commit -m "feat(crm): persist explicit forms immediately"
```

### Task 5: Full verification and release

**Files:**
- Verify only

- [ ] **Step 1: Run the full desktop suite**

Run: `npm test --prefix desktop-crm`

Expected: zero failures.

- [ ] **Step 2: Run smoke and Windows build**

Run: `npm run smoke --prefix desktop-crm`

Expected: JSON with `ready:true`, `initialized:true`, and `syncStatus:"connected"`.

Run: `npm run build:win --prefix desktop-crm -- --publish never`

Expected: exit code 0 with EXE and blockmap generated.

- [ ] **Step 3: Check the diff and worktree**

Run: `git diff --check && git status --short`

Expected: no diff errors and only intended files before the final commit; clean after commits.

- [ ] **Step 4: Push without force and monitor CI/release**

Push the feature branch and fast-forward `codex/bring-field-platform`. Watch the exact-SHA CRM CI and CRM Automatic Release runs through completion.

- [ ] **Step 5: Verify public updater assets**

Confirm the new stable release contains exactly the installer EXE, EXE blockmap, and `latest.yml`; confirm the release tag contains the feature commit; confirm `crm-update-channel/latest.json` points to the new version; confirm the live updater probe succeeded.

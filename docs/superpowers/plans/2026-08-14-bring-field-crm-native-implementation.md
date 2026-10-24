# BRING FIELD CRM-Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate, demo-heavy BRING FIELD experience with a secure CRM-native field-operations workflow that uses CRM entities as the source of truth and preserves the mobile capture strengths.

**Architecture:** `crmCompany` remains the canonical customer/building/unit store, while `fieldPlatform/v2` owns work execution, evidence, review, upload state, projections, and audit history. The Electron CRM keeps its existing shell and embeds a content-only FIELD React workspace through a versioned, allow-listed message bridge. All workflow writes go through server functions; clients read only minimal projections and upload original files only to the existing guarded Storage staging path.

**Tech Stack:** Electron 39, Node test runner, React 19, TypeScript 5.9, Vitest 4, Firebase Auth/App Check/Realtime Database/Storage, Firebase Functions v2, IndexedDB, CSS design tokens.

---

## File map

### New server modules

- `functions/src/field-v2/contracts.ts` — canonical v2 identifiers, records, statuses, command envelopes, and validation helpers.
- `functions/src/field-v2/policies.ts` — immutable six-job policy catalogue and next-action calculation.
- `functions/src/field-v2/work-items.ts` — create, assign, claim, schedule, cancel, and transition cores.
- `functions/src/field-v2/projections.ts` — operator, unassigned, map, CRM summary, and KPI projections.
- `functions/src/field-v2/canonical-crm.ts` — optimistic canonical CRM entity commit core.
- `functions/src/field-v2/review.ts` — evidence readiness, review, revision, privacy, and approval rules.
- `functions/src/field-v2/secure-reveal.ts` — short-lived access-detail reveal policy.
- `functions/src/field-v2/migration.ts` — dry-run manifests, deterministic candidates, and cutover validation.

### New FIELD client modules

- `company-site/app/field/lib/v2/contracts.ts` — browser-safe mirror of the public v2 protocol.
- `company-site/app/field/lib/v2/field-v2-api.client.ts` — callable-only command/query gateway.
- `company-site/app/field/lib/v2/operator-profile.client.ts` — active operator selection stored on the device.
- `company-site/app/field/lib/v2/desktop-bridge.client.ts` — strict CRM/FIELD message envelope and request correlation.
- `company-site/app/field/components/v2/FieldOperationsHome.tsx` — real KPI and work-list workspace.
- `company-site/app/field/components/v2/FieldWorkItemDetail.tsx` — one-primary-action detail view.
- `company-site/app/field/components/v2/FieldMobileNav.tsx` — four-item mobile navigation.
- `company-site/app/field/components/v2/FieldOperatorPicker.tsx` — device operator profile selector.
- `company-site/app/field/components/v2/FieldStatusState.tsx` — loading, empty, stale, offline, and error states.

### Modified boundaries

- `functions/src/index.ts` exports v2 callables, the canonical CRM HTTPS endpoint, handoff correction, and current-project triggers.
- `database.rules.json` protects v2 and canonical CRM records from client writes and limits projection reads.
- `storage.rules` keeps staging uploads scoped by authenticated UID/session and finalized objects server-only.
- `desktop-crm/src/{index.html,app.js,main.js,preload.js,field-preload.js,field-view-policy.js,styles.css}` turns FIELD into a true CRM view and hosts the typed bridge.
- `desktop-crm/src/{core.js,remote.js}` adds persistent building-unit views, FIELD summaries, operator profiles, and canonical endpoint calls without adding canonical or v2 server-owned collections to the offline rebase store.
- `company-site/app/field/{FieldApp.tsx,field.css}` selects content-only desktop mode and the standalone mobile shell.
- Existing capture/review components are adapted to v2 IDs and server APIs; no second building master is created.

---

### Task 1: Freeze v2 contracts, access, release gates, policies, and state transitions

**Files:**
- Create: `functions/src/field-v2/contracts.ts`
- Create: `functions/src/field-v2/access.ts`
- Create: `functions/src/field-v2/release-gate.ts`
- Create: `functions/src/field-v2/policies.ts`
- Create: `functions/test/field-v2-contracts.test.ts`
- Create: `functions/test/field-v2-access.test.ts`
- Create: `functions/test/field-v2-release-gate.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/test/desktop-field-handoff.test.ts`
- Modify: `functions/test/index-entrypoints.test.ts`

- [ ] **Step 1: Write the failing contract and transition tests**

```ts
import { describe, expect, it } from "vitest";
import {
  FIELD_JOB_TYPES,
  FIELD_WORKFLOW_STATUSES,
  assertFieldCommandEnvelope,
} from "../src/field-v2/contracts.js";
import { fieldJobPolicies, nextFieldAction, transitionFieldStatus } from "../src/field-v2/policies.js";

describe("FIELD v2 contracts", () => {
  it("publishes exactly six supported job types", () => {
    expect(FIELD_JOB_TYPES).toEqual([
      "vacancy_capture",
      "move_out_check",
      "cleaning_before_after",
      "maintenance_inspection",
      "complaint_check",
      "repair_before_after",
    ]);
  });

  it("uses a versioned, bounded command envelope", () => {
    expect(assertFieldCommandEnvelope({
      protocolVersion: 2,
      type: "field.command",
      requestId: "8f738cdc-cc9a-4f23-8b27-a87661232806",
      payload: { command: "claimJob", jobId: "job_123" },
    }).protocolVersion).toBe(2);
    expect(() => assertFieldCommandEnvelope({
      protocolVersion: 1,
      type: "field.command",
      requestId: "bad",
      payload: { value: "x".repeat(33_000) },
    })).toThrow("field_protocol_invalid");
  });

  it("pins a complete policy to every job", () => {
    for (const type of FIELD_JOB_TYPES) {
      expect(fieldJobPolicies[type].policyVersion).toMatch(/^FIELD_V2_/);
      expect(fieldJobPolicies[type].checklistId).toMatch(/_V1$/);
      expect(fieldJobPolicies[type].requiredEvidence.length).toBeGreaterThan(0);
    }
  });

  it("returns one Korean primary action and rejects illegal jumps", () => {
    expect(nextFieldAction("vacancy_capture", "requested").label).toBe("내가 맡기");
    expect(transitionFieldStatus("vacancy_capture", "review_pending", "changes_requested")).toBe("changes_requested");
    expect(transitionFieldStatus("complaint_check", "approved", "completed")).toBe("completed");
    expect(() => transitionFieldStatus("complaint_check", "requested", "completed"))
      .toThrow("field_transition_invalid");
  });

  it("keeps accepted in capture-pending statuses", () => {
    expect(FIELD_WORKFLOW_STATUSES).toContain("accepted");
    expect(nextFieldAction("vacancy_capture", "accepted").label).toBe("촬영 시작");
  });
});
```

Add access and release-gate tests that establish these exact rules:

```ts
it("maps CRM roles and requires an active operator profile", async () => {
  await expect(resolveFieldActorCore({ authUid: "uid_1", operatorId: "operator_kim" }, dependencies))
    .resolves.toMatchObject({ authUid: "uid_1", operatorId: "operator_kim", role: "member" });
  await expect(resolveFieldActorCore({ authUid: "uid_1", operatorId: "operator_disabled" }, dependencies))
    .rejects.toThrow("field_operator_inactive");
});

it("safe mode permits exact replay and upload recovery but blocks new work", () => {
  expect(assertFieldReleaseAllows(RELEASE_SAFE, { kind: "receiptReplay", requestId: REQUEST_ID })).toEqual({ allowed: true });
  expect(assertFieldReleaseAllows(RELEASE_SAFE, { kind: "uploadRecovery", requestId: REQUEST_ID })).toEqual({ allowed: true });
  expect(() => assertFieldReleaseAllows(RELEASE_SAFE, { kind: "createJob", requestId: REQUEST_ID }))
    .toThrow("field_safe_mode_read_only");
});

it("validates protocol, desktop build, PWA build, and enabled operator", () => {
  expect(assertFieldReleaseCompatible(RELEASE_ACTIVE, {
    protocolVersion: 2,
    clientKind: "desktop",
    buildVersion: "1.8.0",
    operatorId: "operator_kim",
  })).toEqual({ compatible: true });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-contracts.test.ts test/field-v2-access.test.ts test/field-v2-release-gate.test.ts test/desktop-field-handoff.test.ts test/index-entrypoints.test.ts`

Expected: FAIL because `src/field-v2/contracts.ts` and `src/field-v2/policies.ts` do not exist.

- [ ] **Step 3: Implement the exact public contract**

```ts
export const FIELD_PROTOCOL_VERSION = 2 as const;
export const FIELD_V2_ROOT = "fieldPlatform/v2" as const;
export const FIELD_JOB_TYPES = [
  "vacancy_capture", "move_out_check", "cleaning_before_after",
  "maintenance_inspection", "complaint_check", "repair_before_after",
] as const;
export const FIELD_WORKFLOW_STATUSES = [
  "requested", "assigned", "accepted", "in_progress", "evidence_ready",
  "review_pending", "changes_requested", "approved", "completed", "cancelled",
] as const;
export const FIELD_UPLOAD_STATUSES = [
  "none", "queued", "uploading", "partial_failure", "failed", "synced",
] as const;

export interface FieldCommandEnvelope {
  protocolVersion: 2;
  type: "field.command";
  requestId: string;
  payload: Record<string, unknown>;
}

export function assertFieldCommandEnvelope(value: unknown): FieldCommandEnvelope {
  const source = value as Partial<FieldCommandEnvelope> | null;
  if (!source || source.protocolVersion !== FIELD_PROTOCOL_VERSION ||
      source.type !== "field.command" ||
      typeof source.requestId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(source.requestId) ||
      !source.payload || Array.isArray(source.payload) ||
      typeof source.payload !== "object" ||
      Buffer.byteLength(JSON.stringify(source), "utf8") > 32_768) {
    throw new Error("field_protocol_invalid");
  }
  return source as FieldCommandEnvelope;
}
```

Implement `fieldJobPolicies`, `transitionFieldStatus`, and `nextFieldAction` with the six policy rows and Korean action labels from design section 8.8. `changes_requested` returns to `in_progress`; completed and cancelled records do not transition in place.

Implement `resolveFieldActorCore` against `crmCompany/access/{authUid}` and `crmCompany/teamProfiles/{operatorId}`; roles remain `admin`, `member`, and `viewer`, and `operatorId` is explicitly an operational label on the shared account. Implement a version parser and release gate for `protocolVersion`, minimum/maximum desktop version, minimum PWA version, enabled operator IDs, `v2WritesEnabled`, `canonicalCrmEnabled`, `safeMode`, and `cutoverAt`. Check an existing request receipt before the safe-mode write gate so an exact replay can finish safely.

Replace the legacy `bring-fm-hj` handoff verifier in `functions/src/index.ts` with the current default `adminAuth` verifier. Keep the 60-second, one-time, hashed-code and rate-limit protections. Handoff remains the fallback for a missing shared Firebase session; it is not a new login flow.

- [ ] **Step 4: Verify the task**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-contracts.test.ts test/field-v2-access.test.ts test/field-v2-release-gate.test.ts test/desktop-field-handoff.test.ts test/index-entrypoints.test.ts && pnpm.cmd run build`

Expected: the new tests pass and TypeScript emits without errors.

- [ ] **Step 5: Commit**

```powershell
git add functions/src/field-v2 functions/src/index.ts functions/test/field-v2-contracts.test.ts functions/test/field-v2-access.test.ts functions/test/field-v2-release-gate.test.ts functions/test/desktop-field-handoff.test.ts functions/test/index-entrypoints.test.ts
git commit -m "feat: define field v2 access contracts"
```

### Task 2: Add idempotent work creation, assignment, visits, and projections

**Files:**
- Create: `functions/src/field-v2/work-items.ts`
- Create: `functions/src/field-v2/projections.ts`
- Create: `functions/test/field-v2-work-items.test.ts`
- Create: `functions/test/field-v2-projections.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/test/index-entrypoints.test.ts`

- [ ] **Step 1: Write RED tests for CRM-backed creation and atomic claiming**

```ts
it("creates one visit with independent work items for two units", async () => {
  const result = await createFieldJobsCore({
    requestId: REQUEST_ID,
    jobType: "vacancy_capture",
    crmSalesProspectId: "prospect_1",
    crmSalesUnitIds: ["sales_unit_1", "sales_unit_2"],
    dueDate: "2026-08-15",
    operatorId: "operator_hwang",
  }, ACTOR, dependencies);
  expect(result.visitId).toBe("visit_1");
  expect(result.jobIds).toEqual(["job_1", "job_2"]);
  expect(patch["fieldPlatform/v2/visits/visit_1"].workItemIds).toEqual(["job_1", "job_2"]);
});

it("returns the same receipt for a repeated requestId", async () => {
  dependencies.readReceipt.mockResolvedValue({ visitId: "visit_1", jobIds: ["job_1"] });
  expect(await createFieldJobsCore(INPUT, ACTOR, dependencies)).toEqual({
    visitId: "visit_1", jobIds: ["job_1"], repeated: true,
  });
  expect(dependencies.writePatch).not.toHaveBeenCalled();
});

it("lets only one operator claim an unassigned job", async () => {
  dependencies.claimTransaction.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(claimFieldJobCore(CLAIM_INPUT, ACTOR, dependencies)).resolves.toMatchObject({ assignedOperatorId: "operator_kim" });
  await expect(claimFieldJobCore(CLAIM_INPUT, ACTOR, dependencies)).rejects.toThrow("field_job_already_claimed");
});
```

- [ ] **Step 2: Run focused tests and verify missing-module RED**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-work-items.test.ts test/field-v2-projections.test.ts`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement dependency-injected work-item cores**

Expose these exact functions from `work-items.ts`:

```ts
export async function createFieldJobsCore(input: CreateFieldJobsInput, actor: FieldV2Actor, deps: WorkItemDependencies): Promise<CreateFieldJobsResult>;
export async function claimFieldJobCore(input: ClaimFieldJobInput, actor: FieldV2Actor, deps: WorkItemDependencies): Promise<FieldWorkItem>;
export async function assignFieldJobCore(input: AssignFieldJobInput, actor: FieldV2Actor, deps: WorkItemDependencies): Promise<FieldWorkItem>;
export async function changeFieldVisitCore(input: ChangeFieldVisitInput, actor: FieldV2Actor, deps: WorkItemDependencies): Promise<ChangeFieldVisitResult>;
export async function transitionFieldJobCore(input: TransitionFieldJobInput, actor: FieldV2Actor, deps: WorkItemDependencies): Promise<FieldWorkItem>;
```

Creation accepts either `crmBuildingId` or `crmSalesProspectId`, validates every referenced unit through dependencies, snapshots CRM fields with `sourceVersion`, writes one visit plus N work items plus projections plus `fieldPlatform/v2/requestReceipts/{scope}/{requestId}` plus audit in one patch, and never infers an address relationship. Visit reassignment splits only the selected not-started unit work; existing media remains attached to its original visit.

- [ ] **Step 4: Implement deterministic projections and Seoul-date KPIs**

```ts
export interface FieldKpis {
  todayVisits: number;
  capturePending: number;
  uploadFailures: number;
  reviewPending: number;
  unassigned: number;
  overdue: number;
  adminActionRequired: number;
}

export function calculateFieldKpis(items: readonly FieldWorkItem[], now: Date): FieldKpis;
export function buildOperatorProjection(item: FieldWorkItem): FieldOperatorJobProjection;
export function buildUnassignedProjection(item: FieldWorkItem): FieldUnassignedProjection | null;
export function buildCrmFieldSummary(item: FieldWorkItem): CrmFieldSummary;
```

`calculateFieldKpis` uses `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })`, excludes archived/cancelled/completed records where the metric requires active work, includes `accepted` in capture pending, and reports query failures separately at the API layer rather than converting them to zero.

- [ ] **Step 5: Export callable entrypoints and test App Check**

Add `createFieldJobs`, `claimFieldJob`, `assignFieldJob`, `changeFieldVisit`, `transitionFieldJob`, and `listFieldOperationsWorkspace` to `functions/src/index.ts`, all in `asia-northeast3` with `enforceAppCheck: true`. Each callable must validate Auth, CRM access, active team profile, role, and requestId before calling the core.

- [ ] **Step 6: Verify and commit**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-contracts.test.ts test/field-v2-work-items.test.ts test/field-v2-projections.test.ts test/index-entrypoints.test.ts && pnpm.cmd run build`

Expected: all selected tests pass.

```powershell
git add functions/src/field-v2 functions/src/index.ts functions/test/field-v2-work-items.test.ts functions/test/field-v2-projections.test.ts functions/test/index-entrypoints.test.ts
git commit -m "feat: add field v2 work orchestration"
```

### Task 3: Add canonical CRM units and server-authoritative summaries

**Files:**
- Create: `functions/src/field-v2/canonical-crm.ts`
- Create: `functions/test/canonical-crm-entity.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `desktop-crm/src/core.js`
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Create: `desktop-crm/test/field-canonical-crm.test.js`
- Modify: `desktop-crm/test/company-firebase-routing.test.js`

- [ ] **Step 1: Write RED optimistic-lock and parent-integrity tests**

```ts
it("commits a building unit only when its parent exists and version matches", async () => {
  dependencies.readEntity.mockResolvedValue({ id: "unit_1", entityVersion: 4, crmBuildingId: "building_1" });
  dependencies.readParent.mockResolvedValue({ id: "building_1", archivedAt: "" });
  await expect(commitCanonicalCrmEntityCore({
    requestId: REQUEST_ID,
    entityType: "buildingUnits",
    entityId: "unit_1",
    expectedVersion: 4,
    patch: { unitLabel: "202호" },
  }, ACTOR, dependencies)).resolves.toMatchObject({ entityVersion: 5 });
});

it("rejects stale, forbidden, linked-delete, and secret-bearing writes", async () => {
  dependencies.readEntity.mockResolvedValue({ id: "unit_1", entityVersion: 5, externalRefs: { fieldWorkItemIds: ["job_1"] } });
  await expect(commitCanonicalCrmEntityCore(STALE_INPUT, ACTOR, dependencies)).rejects.toThrow("crm_entity_version_conflict");
  await expect(commitCanonicalCrmEntityCore(DELETE_INPUT, ACTOR, dependencies)).rejects.toThrow("crm_entity_linked_archive_required");
  await expect(commitCanonicalCrmEntityCore(SECRET_INPUT, ACTOR, dependencies)).rejects.toThrow("crm_secret_field_forbidden");
});
```

- [ ] **Step 2: Run RED tests**

Run: `cd functions && pnpm.cmd vitest run test/canonical-crm-entity.test.ts`

Expected: FAIL because the canonical commit module does not exist.

- [ ] **Step 3: Implement the canonical endpoint core and HTTPS adapter**

`commitCanonicalCrmEntityCore` accepts only `buildings`, `buildingUnits`, and `salesUnits`, validates an allow-list per entity, increments `entityVersion`, keeps immutable IDs/parents/created metadata, rejects physical deletion, writes an audit record, and uses one transaction. Export `commitCanonicalCrmEntity` as an `onRequest` endpoint that accepts only POST, verifies `Authorization: Bearer <bring-fm ID token>`, checks `crmCompany/access`, limits body size, and returns structured JSON error codes.

- [ ] **Step 4: Add CRM-side building-unit views without rebase pollution**

Add `buildingUnits: []` to the renderer's sanitized in-memory model so the CRM UI can display formal rooms, but keep both `buildingUnits` and `fieldSummaries` out of `SHARED_COLLECTIONS`, pending-store serialization, whole-store PUT/PATCH, and offline rebase diffs. Load canonical `buildingUnits` from `crmCompany/data/buildingUnits` through a separate read method, load `fieldSummaries` from `crmCompany/fieldSummaries`, merge both only into the renderer snapshot, and save building-unit changes only through `commitCanonicalCrmEntity`. Add these exact remote methods:

```js
async loadFieldSummaries() {
  return this.dbRequest("fieldSummaries", { method: "GET" });
}

async loadCanonicalBuildingUnits() {
  return this.dbRequest("crmShared/data/buildingUnits", { method: "GET" });
}

async commitCanonicalCrmEntity(input) {
  this.requireMutationPermission(input);
  const token = await this.ensureIdToken(false);
  return this.requestJson(CANONICAL_CRM_ENDPOINT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  }, "CANONICAL_CRM_COMMIT_FAILED");
}
```

Expose only those methods through secure main-process handlers and preload. Add regression tests proving a legacy pending store and a normal `pushStore` cannot emit a `buildingUnits/*` patch, while a successful canonical endpoint result refreshes the renderer-only building-unit snapshot.

- [ ] **Step 5: Verify and commit**

Run: `cd functions && pnpm.cmd vitest run test/canonical-crm-entity.test.ts test/index-entrypoints.test.ts && pnpm.cmd run build`

Run: `cd desktop-crm && npm.cmd test`

Expected: both suites pass with no legacy pending deletion regression.

```powershell
git add functions/src/field-v2/canonical-crm.ts functions/src/index.ts functions/test/canonical-crm-entity.test.ts desktop-crm/src/core.js desktop-crm/src/remote.js desktop-crm/src/main.js desktop-crm/src/preload.js desktop-crm/test/field-canonical-crm.test.js desktop-crm/test/company-firebase-routing.test.js
git commit -m "feat: connect canonical crm units to field"
```

### Task 4: Define v2 database and storage boundaries without cutting over legacy CRM

**Files:**
- Modify: `database.rules.json`
- Modify: `storage.rules`
- Modify: `company-site/tests/field/database-rules.test.ts`
- Modify: `company-site/tests/field/storage-rules.test.ts`

- [ ] **Step 1: Add RED rules tests**

Test these exact outcomes with the Firebase rules emulator:

```ts
await assertFails(anonymous.ref("fieldPlatform/v2/workItems/job_1").get());
await assertFails(member.ref("fieldPlatform/v2/workItems/job_1").set(validJob));
await assertSucceeds(member.ref("crmCompany/data/buildings/building_1").update({ name: "전환 전 호환 저장" }));
await assertSucceeds(member.ref("fieldPlatform/v2/projections/operatorJobs/operator_kim").get());
await assertFails(member.ref("fieldPlatform/v2/projections/operatorJobs/operator_hwang").get());
await assertFails(viewer.ref("fieldPlatform/v2/projections/unassigned").get());
await assertSucceeds(member.ref("crmCompany/fieldSummaries/job_1").get());
await assertFails(member.ref("crmCompany/fieldSummaries/job_1").set({ status: "approved" }));
```

Also assert staging MIME/size/metadata, cross-user denial, finalized overwrite denial, and no parent `/fieldPlatform/v2/media` collection read.

- [ ] **Step 2: Run rules tests and confirm RED**

Run: `cd company-site && pnpm.cmd test:rules`

Expected: the new v2 reads/writes do not match existing rules.

- [ ] **Step 3: Implement explicit rules**

Add server-owned `fieldPlatform/v2` rules: record collections deny direct writes, operators can read only their projection, admin/member can read unassigned projections, and CRM users can read `fieldSummaries`. Keep the existing staging path writable only when Auth UID, session ID, MIME, size, metadata ID, and generation constraints pass. At this task, preserve the existing `crmCompany/data` parent write so older desktop builds continue to work while the canonical endpoint is disabled. Add a pending cutover rules fixture to the tests that proves the final collection-level rules, but deploy that stricter fixture only in Task 10 after the new desktop version and queue checks pass.

- [ ] **Step 4: Verify and commit**

Run: `cd company-site && pnpm.cmd test:rules`

Expected: all v2 rule tests pass while legacy CRM compatibility tests still pass.

```powershell
git add database.rules.json storage.rules company-site/tests/field/database-rules.test.ts company-site/tests/field/storage-rules.test.ts
git commit -m "fix: enforce field v2 data boundaries"
```

### Task 5: Make FIELD a real CRM navigation state with a typed bridge

**Files:**
- Modify: `desktop-crm/src/index.html`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/field-preload.js`
- Modify: `desktop-crm/src/field-view-policy.js`
- Modify: `desktop-crm/src/styles.css`
- Modify: `desktop-crm/test/field-platform-entry.test.js`
- Modify: `desktop-crm/test/field-web-contents.test.js`
- Create: `desktop-crm/test/field-message-bridge.test.js`

- [ ] **Step 1: Write RED native-navigation and bridge tests**

```js
test("FIELD is a CRM view with CRM-native title and action", async () => {
  const html = await source("index.html");
  assert.match(html, /data-view="fieldOperations"/);
  assert.match(html, /data-field-subtitle>BRING FIELD</);
  assert.doesNotMatch(html, /data-field-platform-link/);
});

test("bridge rejects wrong senders, versions, routes, IDs, and oversized payloads", () => {
  assert.equal(validateFieldMessage(validReady, expectedSender).ok, true);
  assert.equal(validateFieldMessage({ ...validReady, protocolVersion: 1 }, expectedSender).ok, false);
  assert.equal(validateFieldMessage({ ...validReady, payload: { route: "javascript:alert(1)" } }, expectedSender).ok, false);
  assert.equal(validateFieldMessage(validReady, expectedSender + 1).ok, false);
});

test("bounds use renderer-measured content rectangle", () => {
  assert.deepEqual(fieldBounds({ x: 236, y: 88, width: 1282, height: 812 }), {
    x: 236, y: 88, width: 1282, height: 812,
  });
});
```

- [ ] **Step 2: Run the desktop tests and verify RED**

Run: `cd desktop-crm && node --test test/field-platform-entry.test.js test/field-web-contents.test.js test/field-message-bridge.test.js`

Expected: the current separate link, fixed bounds, and one-event preload fail the new contract.

- [ ] **Step 3: Implement CRM-native navigation and measured layout**

Change the sidebar control to `data-view="fieldOperations"`; when selected, set the CRM header title to `현장 업무`, subtitle to `BRING FIELD`, search placeholder to `현장 업무 검색`, and primary action to `+ 현장 업무 생성`. Viewer accounts do not see the create action. The renderer sends the actual workspace `getBoundingClientRect()` on view entry and resize; main applies it directly instead of hard-coded 232/115 offsets. Reopening an existing view preserves the current FIELD route.

- [ ] **Step 4: Implement the strict message bridge**

Use this shared envelope shape at each boundary:

```js
const envelope = {
  protocolVersion: 2,
  type,
  requestId: crypto.randomUUID(),
  payload,
};
```

Allow only the message types in design section 10, 32KB maximum, 10-second request timeout, requestId correlation, verified FIELD WebContents sender, exact `https://bring-fm.web.app` frame origin, allow-listed routes/entity types/ID patterns, and one result per request. `field.openExternal` directly opens only approved hosts; other HTTPS hosts require a confirmation dialog; non-HTTPS schemes are rejected. CRM logout asks FIELD for pending-upload state before clearing the shared session.

- [ ] **Step 5: Verify and commit**

Run: `cd desktop-crm && npm.cmd test && npm.cmd run smoke`

Expected: all desktop tests pass and smoke exits 0.

```powershell
git add desktop-crm/src desktop-crm/test/field-platform-entry.test.js desktop-crm/test/field-web-contents.test.js desktop-crm/test/field-message-bridge.test.js
git commit -m "feat: embed field as a native crm workspace"
```

### Task 6: Build the v2 client gateway, operator profile, and real dashboard

**Files:**
- Create: `company-site/app/field/lib/v2/contracts.ts`
- Create: `company-site/app/field/lib/v2/field-v2-api.client.ts`
- Create: `company-site/app/field/lib/v2/operator-profile.client.ts`
- Create: `company-site/app/field/lib/v2/desktop-bridge.client.ts`
- Create: `company-site/app/field/components/v2/FieldOperationsHome.tsx`
- Create: `company-site/app/field/components/v2/FieldOperatorPicker.tsx`
- Create: `company-site/app/field/components/v2/FieldStatusState.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/components/AppShell.tsx`
- Modify: `company-site/app/field/components/Dashboard.tsx`
- Modify: `company-site/app/field/field.css`
- Create: `company-site/tests/field/field-v2-api.client.test.ts`
- Create: `company-site/tests/field/field-operations-home.test.tsx`
- Create: `company-site/tests/field/crm-native-theme.test.ts`

- [ ] **Step 1: Write RED API and dashboard tests**

```tsx
it("loads only server projections and never the legacy collection roots", async () => {
  const callable = vi.fn().mockResolvedValue({ data: WORKSPACE_FIXTURE });
  const api = createFieldV2Api({ callable });
  await expect(api.loadWorkspace()).resolves.toEqual(WORKSPACE_FIXTURE);
  expect(callable).toHaveBeenCalledWith("listFieldOperationsWorkspace", {
    protocolVersion: 2,
    operatorId: "operator_kim",
  });
});

it("renders real KPI values and a drill-down list", async () => {
  render(<FieldOperationsHome loadWorkspace={async () => WORKSPACE_FIXTURE} />);
  expect(await screen.findByRole("heading", { name: "현장 업무" })).toBeVisible();
  expect(screen.getByRole("button", { name: "미배정 2건 보기" })).toBeVisible();
  expect(screen.queryByText("24")).not.toBeInTheDocument();
});

it("shows collection failure as 확인 필요 instead of zero", async () => {
  render(<FieldOperationsHome loadWorkspace={async () => { throw new Error("unavailable"); }} />);
  expect(await screen.findByText("현황을 불러오지 못했습니다")).toBeVisible();
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-v2-api.client.test.ts tests/field/field-operations-home.test.tsx`

Expected: FAIL because v2 browser modules and components do not exist.

- [ ] **Step 3: Implement callable-only v2 client and operator selection**

The client calls named Firebase callables with Auth and App Check and never reads legacy `buildings`, `units`, `listings`, or parent `media`. The operator profile module accepts only an active profile returned by the server, stores `{ operatorId, selectedAt }` in device local storage, and sends both `authUid` and `operatorId` with every command. The selector copy states that this is a work label on a shared account, not an additional login or personal security proof.

- [ ] **Step 4: Replace fake dashboard data and nested desktop chrome**

Desktop embedded mode renders content only; the CRM owns sidebar, header, search, and create action. Standalone mobile retains branding and the operator switcher. Dashboard cards show only server values and use the exact Korean labels `오늘 방문`, `촬영 대기`, `업로드 실패`, `광고 검수 대기`, `미배정`, `기한 초과`, and `관리자 조치 필요`. Every card is a button that applies the corresponding list filter. Loading uses reserved-size skeletons; empty and error states provide one clear action; `aria-live="polite"` announces background refresh.

Use existing BRING CRM semantic tokens, 16px mobile body text, 44px minimum controls, visible focus rings, 4/8px spacing rhythm, and no emoji icons. `crm-native-theme.test.ts` extracts the CRM and embedded FIELD semantic values and asserts parity for background, panel, text, muted text, line, primary action, success, warning, danger, radius, and shadow tokens.

- [ ] **Step 5: Verify and commit**

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-v2-api.client.test.ts tests/field/field-operations-home.test.tsx tests/field/crm-native-theme.test.ts && pnpm.cmd typecheck:field`

Expected: selected tests and typecheck pass.

```powershell
git add company-site/app/field company-site/tests/field/field-v2-api.client.test.ts company-site/tests/field/field-operations-home.test.tsx company-site/tests/field/crm-native-theme.test.ts
git commit -m "feat: add crm-native field operations home"
```

### Task 7: Implement mobile today-work, assignment, visit grouping, and secure access

**Files:**
- Create: `company-site/app/field/components/v2/FieldMobileNav.tsx`
- Create: `company-site/app/field/components/v2/FieldWorkItemDetail.tsx`
- Create: `company-site/app/field/components/v2/FieldVisitBundle.tsx`
- Create: `functions/src/field-v2/secure-reveal.ts`
- Create: `functions/test/field-secure-reveal.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/field.css`
- Create: `company-site/tests/field/field-mobile-work.test.tsx`

- [ ] **Step 1: Write RED mobile workflow and secure-reveal tests**

```tsx
it("uses four labeled mobile destinations and one primary job action", async () => {
  render(<FieldAppHarness viewportWidth={375} workspace={WORKSPACE_FIXTURE} />);
  expect(screen.getAllByRole("navigation")[0]).toHaveTextContent("오늘촬영업로드더보기");
  await user.click(screen.getByRole("button", { name: /101호 공실 촬영/ }));
  expect(screen.getAllByRole("button", { name: "촬영 시작" })).toHaveLength(1);
});

it("claims unassigned work and replaces it with the server result", async () => {
  render(<FieldWorkItemDetail item={UNASSIGNED_JOB} api={api} />);
  await user.click(screen.getByRole("button", { name: "내가 맡기" }));
  expect(api.claimJob).toHaveBeenCalledWith(UNASSIGNED_JOB.id);
  expect(await screen.findByText("김현진 담당")).toBeVisible();
});
```

```ts
it("reveals access details only to the current assignee for 60 seconds", async () => {
  const result = await secureRevealCore({ jobId: "job_1", operatorId: "operator_kim" }, ACTOR, dependencies);
  expect(result.expiresAtMs - dependencies.nowMs()).toBe(60_000);
  expect(result).not.toHaveProperty("persistentPath");
});

it("rejects unassigned, other-assignee, expired, and reassigned access", async () => {
  await expect(secureRevealCore(INPUT, ACTOR, otherAssigneeDeps)).rejects.toThrow("field_secure_access_forbidden");
});
```

- [ ] **Step 2: Verify RED**

Run: `cd functions && pnpm.cmd vitest run test/field-secure-reveal.test.ts`

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-mobile-work.test.tsx`

Expected: missing modules/components fail.

- [ ] **Step 3: Implement mobile work and visit behavior**

The bottom nav contains exactly four destinations: `오늘`, `촬영`, `업로드`, and `더보기`. Today work shows assigned jobs, an authorized unassigned section with atomic `내가 맡기`, overdue and blocked markers, schedule/reassign/cancel in a secondary menu, and exactly one primary action derived from policy. A visit bundle displays shared exterior/common-area evidence once and keeps each unit’s checklist, media, review, and ad status independent.

- [ ] **Step 4: Implement secure reveal**

Export `secureRevealFieldAccess` with Auth and App Check. It validates active access, current assignment, operator profile, TTL, and reassignment version; reads the secret only from the CRM security source; logs a secret-free audit event; and returns a 60-second response. The client keeps the value in component memory, masks it on blur/background, never writes it to URL/log/IPC/IndexedDB, and provides call/approval-request fallbacks.

- [ ] **Step 5: Verify and commit**

Run: `cd functions && pnpm.cmd vitest run test/field-secure-reveal.test.ts test/index-entrypoints.test.ts && pnpm.cmd run build`

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-mobile-work.test.tsx && pnpm.cmd typecheck:field`

```powershell
git add functions/src/field-v2/secure-reveal.ts functions/src/index.ts functions/test/field-secure-reveal.test.ts company-site/app/field company-site/tests/field/field-mobile-work.test.tsx
git commit -m "feat: add mobile field assignment workflow"
```

### Task 8: Move capture, upload, review, and ad packages onto v2

**Files:**
- Create: `functions/src/field-v2/review.ts`
- Create: `functions/test/field-v2-review.test.ts`
- Modify: `functions/src/field/finalize-field-media.ts`
- Modify: `functions/src/index.ts`
- Modify: `company-site/app/field/components/CaptureWorkspace.tsx`
- Modify: `company-site/app/field/components/CaptureGuide.tsx`
- Modify: `company-site/app/field/components/AdPackageReview.tsx`
- Modify: `company-site/app/field/lib/offline-queue.ts`
- Modify: `company-site/app/field/lib/firebase-media-upload.ts`
- Modify: `company-site/app/field/lib/ad-package.ts`
- Create: `company-site/tests/field/field-v2-capture.test.tsx`
- Create: `company-site/tests/field/field-v2-review.test.tsx`

- [ ] **Step 1: Write RED capture/review lifecycle tests**

```ts
it("moves to review pending when required Storage objects are finalized even if Drive is queued", async () => {
  const result = await finalizeV2EvidenceCore(FINALIZE_INPUT, ACTOR, {
    ...dependencies,
    listFinalizedEvidence: vi.fn().mockResolvedValue(REQUIRED_EVIDENCE),
    driveState: vi.fn().mockResolvedValue("queued"),
  });
  expect(result.workflowStatus).toBe("review_pending");
  expect(result.uploadStatus).toBe("synced");
  expect(result.adminActionRequired).toBe(false);
});

it("never lets the capture completion path approve advertising", async () => {
  await finalizeV2EvidenceCore(FINALIZE_INPUT, ACTOR, dependencies);
  expect(writePatch).not.toHaveProperty(expect.stringMatching(/advertisingApproved/));
  expect(writePatch).not.toHaveProperty(expect.stringMatching(/reviewedBy/));
});

it("requires a different operator label or an admin exception reason", async () => {
  await expect(reviewFieldJobCore(SELF_APPROVAL, ACTOR, dependencies)).rejects.toThrow("field_review_separation_required");
  await expect(reviewFieldJobCore(ADMIN_EXCEPTION_WITHOUT_REASON, ADMIN, dependencies)).rejects.toThrow("field_review_exception_reason_required");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-review.test.ts test/finalize-field-media.test.ts`

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-v2-capture.test.tsx tests/field/field-v2-review.test.tsx`

Expected: v2 lifecycle exports and UI behavior are absent.

- [ ] **Step 3: Implement the server lifecycle**

Start capture against an existing v2 work item and visit; do not create a building or listing from the capture UI. Staging upload uses the existing UID/session path and requestId. Server finalization validates generation, MIME, size, metadata, job/session/visit ownership, and required evidence; writes finalized metadata and Drive outbox idempotently; recomputes upload/workflow state without waiting for Drive. No code reads the entire media parent.

Review creates an immutable revision record. Rejection records reason and required recapture items and returns the work item to `in_progress`. Approval records reviewer operator label, optional admin exception reason, privacy/advertising eligibility, and never mutates prior evidence. Ad packages contain only approved `advertisingEligible=true` media and store `packageVersion`, `sourceHash`, and `mediaHash`; `fieldPlatform/v2/channelPublications/{publicationId}` keeps each channel's publish, update-required, withdrawal-required, and withdrawn state independent. A changed CRM source marks the package `source_stale` until an operator refreshes the snapshot or records a reasoned override.

- [ ] **Step 4: Adapt the client capture experience**

Before capture, show camera/photo permission, estimated free storage, offline readiness, and access-ready status. Each file displays `대기`, `업로드 중`, `원본 저장됨`, `서버 확인 중`, `동기화 완료`, or `실패`; errors show original-preservation state, responsible person, and recovery action. State copy truthfully says iOS/browser background upload can pause and resumes when the app is reopened. No embedded Drive-connect control or browser Drive OAuth is used.

- [ ] **Step 5: Verify and commit**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-review.test.ts test/finalize-field-media.test.ts test/drive-sync-runtime.test.ts test/create-ad-package.test.ts && pnpm.cmd run build`

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-v2-capture.test.tsx tests/field/field-v2-review.test.tsx tests/field/offline-queue.test.ts && pnpm.cmd typecheck:field`

```powershell
git add functions/src functions/test company-site/app/field company-site/tests/field
git commit -m "feat: complete field v2 evidence lifecycle"
```

### Task 9: Correct address resolution, map projections, and CRM deep links

**Files:**
- Modify: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/app/field/components/FieldMapPanel.tsx`
- Modify: `functions/src/field/map-projection.ts`
- Modify: `functions/src/field/rebuild-map-projection.ts`
- Modify: `functions/src/index.ts`
- Create: `company-site/tests/field/field-address-resolution.test.tsx`
- Modify: `company-site/tests/field/field-map-panel.test.tsx`
- Modify: `functions/test/map-projection.test.ts`

- [ ] **Step 1: Write RED fixed-coordinate, unresolved, and leasing-only tests**

```tsx
it("never substitutes Wonju center coordinates for an unresolved address", async () => {
  render(<AddressResolution address="강원 원주시 확인되지 않은 주소" geocode={async () => null} />);
  expect(await screen.findByText("좌표 미확인")).toBeVisible();
  expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ latitude: null, longitude: null }));
});

it("shows leasing-only work without requiring a management contract", async () => {
  render(<FieldMapPanel load={async () => ({ markers: [LEASING_ONLY_MARKER], unresolved: [] })} />);
  expect(await screen.findByRole("button", { name: /영업 현장.*101호/ })).toBeVisible();
});
```

- [ ] **Step 2: Verify RED, then implement**

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-address-resolution.test.tsx tests/field/field-map-panel.test.tsx`

Remove the default coordinate path. Accept only normalized, geocoded results; query CRM candidates and v2 links before proposing a new connection; keep unresolved items in a visible list. Map projection includes CRM-managed, leasing-only, and connected-candidate marker types, exposes Korean status text, and shows actual disconnected/error states. `field.openCrmEntity` preserves the FIELD route/filter/scroll state and returns to the correct CRM building, unit, sales target, or case.

- [ ] **Step 3: Verify and commit**

Run: `cd functions && pnpm.cmd vitest run test/map-projection.test.ts && pnpm.cmd run build`

Run: `cd company-site && pnpm.cmd vitest run tests/field/field-address-resolution.test.tsx tests/field/field-map-panel.test.tsx && pnpm.cmd typecheck:field`

```powershell
git add company-site/app/field company-site/tests/field functions/src/field functions/src/index.ts functions/test/map-projection.test.ts
git commit -m "fix: connect verified field locations"
```

### Task 10: Build deterministic migration and cutover safety

**Files:**
- Create: `functions/src/field-v2/migration.ts`
- Create: `functions/test/field-v2-migration.test.ts`
- Create: `functions/scripts/field-v2-migration.mjs`
- Modify: `functions/package.json`
- Modify: `functions/src/index.ts`
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`
- Create: `docs/field-v2-cutover-runbook.md`

- [ ] **Step 1: Write RED manifest, candidate, and cutover tests**

```ts
it("creates the same candidate and receipt IDs on every dry run", () => {
  const first = planFieldMigration(FIXTURE, { migrationVersion: "v2.0.0", runId: "run_1" });
  const second = planFieldMigration(FIXTURE, { migrationVersion: "v2.0.0", runId: "run_2" });
  expect(first.candidates.map(value => value.id)).toEqual(second.candidates.map(value => value.id));
  expect(first.manifest.sourceKeyHash).toBe(second.manifest.sourceKeyHash);
});

it("auto-confirms only an existing exact canonical link", () => {
  expect(planFieldMigration(EXACT_LINK_FIXTURE, OPTIONS).candidates[0].decision).toBe("confirmed_existing_link");
  expect(planFieldMigration(ADDRESS_MATCH_FIXTURE, OPTIONS).candidates[0].decision).toBe("human_review_required");
});

it("blocks cutover until clients are current, queues are acknowledged, and deltas match", () => {
  expect(() => assertFieldCutoverReady(BLOCKED_CUTOVER)).toThrow("field_cutover_not_ready");
  expect(assertFieldCutoverReady(READY_CUTOVER)).toEqual({ ready: true });
});
```

- [ ] **Step 2: Run RED and implement dry-run first**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-migration.test.ts`

Implement inventory for every legacy FIELD root listed in design section 13.1, counts, sorted-key SHA-256, source updated high-water mark, Drive/Storage existence results, deterministic candidate IDs, reason codes, and receipts. Persist every run under `fieldPlatform/v2/migrationRuns/{runId}` with version, timestamps, high-water mark, counts, hashes, relationship errors, object checks, checkpoint, and resume receipt. Explicitly inventory the public legacy roots `workflow`, `caseSettings`, `cases`, and `signage`. The script defaults to dry-run and refuses apply unless `--apply`, `--run-id`, `--expected-manifest-hash`, and `--cutover-at` all match.

- [ ] **Step 3: Implement release configuration and safe mode**

`fieldPlatform/v2/config/release` contains protocolVersion, minimum/maximum desktop build, minimum PWA build, enabled operator IDs, `v2WritesEnabled`, `safeMode`, `cutoverAt`, and `legacyReadOnly`. Both clients check compatibility before enabling v2 commands. After the first v2 write, rollback never returns to the legacy direct-write screen; safe mode is a v2-aware read-only screen with pending-upload recovery and export instructions.

Only after the new desktop build is deployed, `minDesktopVersion` excludes legacy direct writers, all active client heartbeats meet the minimum version, every queue is zero and acknowledged, and the canonical API rehearsal succeeds, apply the final CRM rules: remove the `crmCompany/data` parent `.write`; keep collection-level member writes for noncanonical legacy collections; deny direct client writes to `buildings`, `buildingUnits`, and `salesUnits`; keep `fieldSummaries`, team profiles, v2 records, receipts, links, and audits server-write-only. Do not enable `canonicalCrmEnabled` or `v2WritesEnabled` until the stricter rules are active. Public legacy paths are inventoried and migrated before their anonymous access is closed in a separate verified checkpoint.

- [ ] **Step 4: Verify and commit**

Run: `cd functions && pnpm.cmd vitest run test/field-v2-migration.test.ts && pnpm.cmd run build`

Run: `cd company-site && pnpm.cmd test:rules`

Run: `cd functions && pnpm.cmd field:v2:migration -- --dry-run --fixture test/fixtures/field-v2-migration.json`

Expected: tests pass and the dry-run prints a stable manifest without writes.

```powershell
git add functions/src/field-v2/migration.ts functions/test/field-v2-migration.test.ts functions/scripts/field-v2-migration.mjs functions/package.json functions/src/index.ts database.rules.json company-site/tests/field/database-rules.test.ts docs/field-v2-cutover-runbook.md
git commit -m "feat: add field v2 migration safety"
```

### Task 11: Full regression, visual QA, and release readiness

**Files:**
- Modify: `desktop-crm/package.json`
- Modify: `desktop-crm/CHANGELOG.md`
- Modify: `company-site/tests/field/field-shell-visual.test.tsx`
- Create: `docs/field-v2-verification-report.md`

- [ ] **Step 1: Run every automated suite from a clean worktree**

Run: `cd desktop-crm && npm.cmd test`

Run: `cd company-site && pnpm.cmd test:field:run && pnpm.cmd typecheck:field && pnpm.cmd test:rules && pnpm.cmd run build`

Run: `cd functions && pnpm.cmd test && pnpm.cmd run build`

Expected: all suites pass with zero failures; no test-count value is hard-coded in release criteria.

- [ ] **Step 2: Run desktop smoke and production-like FIELD export**

Run: `cd desktop-crm && npm.cmd run smoke`

Run: `cd company-site && pnpm.cmd export:firebase`

Expected: smoke exits 0 and the exported `/field` artifact references the new content-only bundle.

- [ ] **Step 3: Perform visual and accessibility checks**

Verify desktop at 1280x800 and 1920x1080; mobile at 375x812, 768x1024, and 844x390. Capture screenshots for dashboard, filtered work list, work detail, job creation, capture, upload failure, review, unresolved map, offline, safe mode, and viewer role. Confirm no nested FIELD chrome, no horizontal overflow, 200% zoom usability, visible keyboard focus, sequential headings, live upload announcements, 44px touch targets, Korean labels instead of raw status codes, and reduced-motion behavior.

- [ ] **Step 4: Audit security and data integrity**

Confirm anonymous v2 denial, cross-operator projection denial, server-only canonical writes, no secrets in logs/IPC/IndexedDB/URL, request replay idempotency, version conflicts, self-approval operating warning, Storage finalized immutability, Drive outbox retry idempotency, and no direct legacy media-parent reads.

- [ ] **Step 5: Update version and create a fresh build only after review**

Raise the desktop version once, document changes and minimum compatible FIELD protocol, build into a new unique output directory, and verify executable, blockmap, and `latest.yml` hashes from that single build. Do not publish or tag from the feature branch. The PR base is explicitly `codex/bring-field-platform`; tag the merged base SHA and publish the draft GitHub Release only after uploaded artifacts are verified.

- [ ] **Step 6: Commit verification artifacts**

```powershell
git add desktop-crm/package.json desktop-crm/CHANGELOG.md company-site/tests/field/field-shell-visual.test.tsx docs/field-v2-verification-report.md
git commit -m "chore: verify crm-native field release"
```

---

## Plan self-review

- Spec coverage: tasks 1–4 cover data ownership, policies, permissions, canonical CRM commits, and v2 paths; tasks 5–7 cover CRM shell, bridge, roles, assignment, visits, mobile navigation, and secure access; tasks 8–9 cover capture, Storage/Drive, review, ad packages, privacy, addresses, maps, and deep links; tasks 10–11 cover migration, version gates, safe mode, testing, and release.
- Placeholder scan: no deferred implementation markers are used; every task names the exact files, RED command, expected failure, required public APIs, GREEN command, and commit.
- Type consistency: the plan consistently uses `protocolVersion: 2`, `operatorId`, `workItems`, `visits`, `buildingUnits`, `fieldSummaries`, `workflowStatus`, `uploadStatus`, `requestId`, `entityVersion`, `sourceVersion`, and `fieldPlatform/v2`.
- Scope control: the first release does not add a new login, public customer portal, payroll/settlement, automatic ad posting, or cryptographic per-person identity. Shared-account `operatorId` remains an explicitly labeled operational identity.

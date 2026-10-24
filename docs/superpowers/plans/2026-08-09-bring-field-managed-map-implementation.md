# BRING Managed Building Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative management-contract workflow and a secure, same-origin map that shows either maintenance vendors or active BRING-managed buildings, while keeping address-derived coordinates internal to registration.

**Architecture:** Version the registration draft and submit it through an idempotent Firebase callable instead of direct client writes. Firebase Functions own contract-state transitions and maintain an allowlisted `fieldPlatform/mapProjections/{buildingId}` record; the legacy map reads only that projection after verifying the current Firebase custom claim and enabled-user record. The standalone map defaults to vendors, while the `/field` iframe defaults to the mutually exclusive managed-building mode.

**Tech Stack:** React 19, TypeScript 5.9, Vinext/Vite, Firebase Authentication, Realtime Database, Firebase Functions v2, Firebase Emulator Suite, Vitest, Testing Library, Node test runner, Naver Maps JavaScript SDK.

---

## Scope boundary

This plan delivers management contracts, registration persistence, safe map projections, exclusive map modes, hidden coordinate inputs, data/rule migration, and map release checks. The approved owner-note, fixed action-dock, and camera/offline-queue work are implemented by their companion plans; this plan exposes the optional `ownerNoteDrafts` save boundary but rejects non-empty notes until the owner-note task adds their atomic writes.

## File structure

### Frontend files

- Create `company-site/app/field/lib/registration-draft.ts` for versioned serializable drafts, migration, and callable payload mapping.
- Create `company-site/app/field/lib/field-api.client.ts` for callable wrappers, pending-contract subscription, and current claim inspection.
- Create `company-site/app/field/components/ManagementContractQueue.tsx` for the admin-only pending approval queue.
- Modify `company-site/app/field/lib/types.ts` for management-contract, map-projection, and audit types.
- Modify `company-site/app/field/lib/validation.ts` for management-start-date validation while retaining internal coordinate validation.
- Modify `company-site/app/field/lib/auth.client.ts` to remove the hardcoded email fallback and require real claims.
- Modify `company-site/app/field/lib/firebase.client.ts` to initialize Firebase App Check for the protected callables.
- Modify `company-site/app/field/components/BuildingWizard.tsx` to use the versioned draft, add the contract request controls, remove coordinate inputs, and call the server save callback.
- Modify `company-site/app/field/components/FieldMapPanel.tsx` to use only the same-origin embedded map URL.
- Modify `company-site/app/field/FieldApp.tsx` to wire the callable save and mount the self-hiding admin queue.

### Functions files

- Create `functions/src/field/contracts.ts` for callable payload/result and persisted server types.
- Create `functions/src/field/map-projection.ts` for the strict map allowlist and active-contract projection builder.
- Create `functions/src/field/save-field-registration.ts` for deterministic IDs and an idempotent multi-path registration write.
- Create `functions/src/field/set-management-contract-status.ts` for admin-only activation, pause, and termination.
- Create `functions/src/field/rebuild-map-projection.ts` for projection repair after building, listing, or media writes.
- Modify `functions/src/index.ts` to expose two App-Check-protected callables and three Realtime Database projection-refresh triggers.

### Map, rules, documentation, and tests

- Modify `data/field-map-model.js` and `data/field-map-model.test.js` for exclusive modes and projection-only marker/filter logic.
- Create `data/field-map-integration.test.js` for same-origin/auth/path static assertions.
- Modify `wonju-map.html` for the two modes, managed filters, claim verification, and the `mapProjections` subscription.
- Modify `database.rules.json` and `company-site/tests/field/database-rules.test.ts` for enabled-user checks and server-owned contracts/projections/receipts.
- Modify `company-site/tests/field/components.test.tsx`, `validation.test.ts`, `types.test.ts`, and `auth.test.ts` for the user-facing contract and coordinate behavior.
- Create `company-site/tests/field/registration-draft.test.ts` and `field-api.test.ts` for migration, serialization, and client API behavior.
- Create `functions/test/map-projection.test.ts`, `save-field-registration.test.ts`, `set-management-contract-status.test.ts`, and `rebuild-map-projection.test.ts` for server behavior.
- Create `docs/field-platform-managed-map-release.md` for migration, deployment order, Naver domain checks, and rollback.

## Task 1: Add the versioned management-contract registration draft and hide coordinate inputs

**Files:**
- Create: `company-site/app/field/lib/registration-draft.ts`
- Create: `company-site/tests/field/registration-draft.test.ts`
- Modify: `company-site/app/field/lib/types.ts`
- Modify: `company-site/app/field/lib/validation.ts`
- Modify: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/tests/field/types.test.ts`
- Modify: `company-site/tests/field/validation.test.ts`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing domain, migration, and component tests**

Add these assertions before changing production code:

```ts
// company-site/tests/field/registration-draft.test.ts
import { describe, expect, it } from "vitest";
import {
  migrateRegistrationDraft,
  toSaveFieldRegistrationInput,
} from "../../app/field/lib/registration-draft";

describe("registration draft migration", () => {
  it("preserves address-derived coordinates and defaults old contracts to none", () => {
    const draft = migrateRegistrationDraft({
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
      },
      units: [{ localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 }],
      listing: { depositWon: 3_000_000, monthlyRentWon: 350_000, maintenanceFeeWon: 0 },
      addressVerified: true,
      duplicateBuilding: null,
    }, undefined, () => "fixed-id");

    expect(draft).toMatchObject({
      draftVersion: 2,
      draftId: "fixed-id",
      requestId: "fixed-id",
      building: {
        latitude: 37.3422,
        longitude: 127.9202,
        managementContractRequested: false,
        managementStartedOn: "",
      },
    });
  });

  it("maps one primary unit and a requested contract to the callable input", () => {
    const draft = migrateRegistrationDraft({
      draftVersion: 2,
      draftId: "draft-12345678",
      requestId: "request-12345678",
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
        managementContractRequested: true,
        managementStartedOn: "2026-08-09",
      },
      units: [{ localId: "unit-1", unitLabel: "201호" }],
      listing: { depositWon: 3_000_000, monthlyRentWon: 350_000, maintenanceFeeWon: 0 },
      addressVerified: true,
      duplicateBuilding: null,
    }, undefined, () => "unused-id");

    expect(toSaveFieldRegistrationInput(draft)).toMatchObject({
      requestId: "request-12345678",
      draftId: "draft-12345678",
      primaryUnitLocalId: "unit-1",
      managementContract: { requested: true, startedOn: "2026-08-09" },
      building: { latitude: 37.3422, longitude: 127.9202 },
      ownerNoteDrafts: [],
    });
  });
});
```

Extend `company-site/tests/field/components.test.tsx` with:

```tsx
it("keeps geocoded coordinates internal and shows the contract request fields", async () => {
  render(<BuildingWizard draftKey="hidden-map-position" checkAddress={async () => ({
    selection: {
      roadAddress: "강원특별자치도 원주시 서원대로 1",
      latitude: 37.3422,
      longitude: 127.9202,
    },
    existingBuilding: null,
  })} />);

  expect(screen.queryByLabelText("위도")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("경도")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("BRING 관리계약 건물"));
  expect(screen.getByLabelText("관리 시작일")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("도로명주소"), {
    target: { value: "강원특별자치도 원주시 서원대로 1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "주소 중복 확인" }));
  await screen.findByText("새 건물로 등록할 수 있는 주소입니다.");

  const saved = JSON.parse(localStorage.getItem("hidden-map-position") || "{}");
  expect(saved.building).toMatchObject({ latitude: 37.3422, longitude: 127.9202 });
});
```

Add a validation test that `requested: true` without a valid `YYYY-MM-DD` start date returns `managementStartedOn`, while `requested: false` returns no contract error.

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/registration-draft.test.ts tests/field/types.test.ts tests/field/validation.test.ts tests/field/components.test.tsx
```

Expected: FAIL because `registration-draft.ts` and management-contract types do not exist, and the current wizard still renders `위도` and `경도` inputs.

- [ ] **Step 3: Define the canonical contract and projection types**

Add these exact types to `company-site/app/field/lib/types.ts` and add `managementContract?: ManagementContractInfo` to `Building` so old records remain readable as `none`:

```ts
export type ManagementContractStatus = "none" | "pending" | "active" | "paused" | "ended";

export interface ManagementContractInfo {
  status: ManagementContractStatus;
  startedOn?: string;
  endedOn?: string;
  updatedAt: ISODateTime;
  updatedBy: EntityId;
}

export interface FieldMapProjection {
  buildingId: EntityId;
  name: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  markerStatus: "vacant" | "managed";
  vacancyCount: number;
  approvedRentSummary: string;
  parkingSummary: string;
  captureStatus: "notStarted" | "inProgress" | "complete";
  updatedAt: ISODateTime;
}
```

Add `"managementContract"` to `AuditEvent["entityType"]`. Update the type fixture so a current managed building contains `managementContract: { status: "active", startedOn: "2026-08-09", updatedAt: NOW, updatedBy: user.id }`.
Add `locationDescription?: string` to `Listing` so the current wizard's location note has a canonical persisted destination.

- [ ] **Step 4: Implement the serializable draft and migration boundary**

Create `company-site/app/field/lib/registration-draft.ts` with these public payload shapes and exports:

```ts
export const REGISTRATION_DRAFT_VERSION = 2 as const;

export interface ManagementContractDraft {
  requested: boolean;
  startedOn?: string;
}

export interface OwnerNoteDraftInput {
  localId: string;
  body: string;
  recordedAt: string;
}

export interface BuildingDraftPayload {
  managementNumber: string;
  name: string;
  roadAddress: string;
  jibunAddress?: string;
  latitude: number;
  longitude: number;
  purpose?: string;
  completionYear?: number;
  floorCount?: number;
  elevator: boolean;
  parking: { available: boolean; totalSpaces?: number };
}

export interface UnitDraftPayload {
  localId: string;
  unitLabel: string;
  structure?: string;
  floor?: number;
  options: string[];
  isVacant: boolean;
}

export interface ListingDraftPayload {
  depositWon: number;
  monthlyRentWon: number;
  maintenanceFeeWon: number;
  maintenanceFeeItems: string[];
  availableFrom?: string;
  contractTermMonths?: number;
  parkingDescription: string;
  petPolicy: string;
  vacancyReason?: string;
  vacantSince?: string;
  moveInCondition?: string;
  locationDescription?: string;
  options: string[];
}

export interface SaveFieldRegistrationInput {
  requestId: string;
  draftId: string;
  building: BuildingDraftPayload;
  units: UnitDraftPayload[];
  listing: ListingDraftPayload;
  primaryUnitLocalId: string;
  managementContract: ManagementContractDraft;
  ownerNoteDrafts?: OwnerNoteDraftInput[];
}

export interface SaveFieldRegistrationResult {
  buildingId: string;
  unitIds: Record<string, string>;
  listingId: string;
  visitId: string;
}
```

Move the wizard draft-state interfaces from `BuildingWizard.tsx` into this module. `BuildingWizardDraft` must include `draftVersion`, `draftId`, and `requestId`; `BuildingDraftState` must add `managementContractRequested: boolean` and `managementStartedOn: string`. Export these exact functions:

```ts
export function createRegistrationDraft(
  initial?: RegistrationDraftInitial,
  idFactory: () => string = () => crypto.randomUUID(),
): BuildingWizardDraft;

export function migrateRegistrationDraft(
  raw: unknown,
  initial?: RegistrationDraftInitial,
  idFactory: () => string = () => crypto.randomUUID(),
): BuildingWizardDraft;

export function toSaveFieldRegistrationInput(
  draft: BuildingWizardDraft,
): SaveFieldRegistrationInput;
```

`migrateRegistrationDraft` must merge old objects into current empty objects, preserve numeric latitude/longitude, give missing contracts `false` and an empty date, and never copy `File`, Blob, base64, or `blob:` values. `toSaveFieldRegistrationInput` must trim strings, split `maintenanceFeeItems` on commas, choose `units[0].localId` as `primaryUnitLocalId`, retain coordinate numbers, and emit `ownerNoteDrafts: []`.

- [ ] **Step 5: Update validation and the wizard UI**

Add this validator to `company-site/app/field/lib/validation.ts`:

```ts
export function validateManagementContractDraft(input: {
  requested: boolean;
  startedOn?: string;
}): string[] {
  if (!input.requested) return [];
  return /^\d{4}-\d{2}-\d{2}$/.test(input.startedOn || "")
    ? []
    : ["managementStartedOn"];
}
```

In `BuildingWizard.tsx`, initialize local state through `migrateRegistrationDraft`, use `createRegistrationDraft` only when there is no stored value, and retain the current `validateBuildingDraft` coordinate checks. Remove both coordinate `<Field>` elements. Render one map-position error below the address status when either internal coordinate error exists:

```tsx
{(errors.includes("latitude") || errors.includes("longitude")) && (
  <p className="field-inline-error" role="alert">
    주소 확인으로 지도 위치를 설정해 주세요.
  </p>
)}
```

Add these controls after the address block:

```tsx
<Toggle
  label="BRING 관리계약 건물"
  checked={draft.building.managementContractRequested}
  onChange={(checked) => updateBuilding("managementContractRequested", checked)}
/>
{draft.building.managementContractRequested && (
  <Field
    label="관리 시작일"
    required
    error={errors.includes("managementStartedOn") ? "관리 시작일을 입력해 주세요." : ""}
  >
    <input
      id="managementStartedOn"
      type="date"
      value={draft.building.managementStartedOn}
      onChange={(event) => updateBuilding("managementStartedOn", event.target.value)}
    />
  </Field>
)}
```

Combine contract errors with building errors in step 1. Keep the copy under the toggle explicit: `직원 등록은 관리계약 확인 요청으로 저장되며, 관리자 확인 후 지도에 표시됩니다.` The server decides `pending` versus `active`; the client never submits a status string.

- [ ] **Step 6: Run focused tests and type-check**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/registration-draft.test.ts tests/field/types.test.ts tests/field/validation.test.ts tests/field/components.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: all selected tests PASS and TypeScript exits 0. The rendered wizard has no latitude/longitude labels, while the migrated draft and callable payload retain both coordinates.

- [ ] **Step 7: Commit the draft and coordinate work**

```bash
git add company-site/app/field/lib/types.ts company-site/app/field/lib/validation.ts company-site/app/field/lib/registration-draft.ts company-site/app/field/components/BuildingWizard.tsx company-site/tests/field/types.test.ts company-site/tests/field/validation.test.ts company-site/tests/field/registration-draft.test.ts company-site/tests/field/components.test.tsx
git commit -m "feat(field): add management contract registration draft"
```

## Task 2: Build the server-owned active-management map projection

**Files:**
- Create: `functions/src/field/contracts.ts`
- Create: `functions/src/field/map-projection.ts`
- Create: `functions/test/map-projection.test.ts`

- [ ] **Step 1: Write the failing projection tests**

Create `functions/test/map-projection.test.ts` with fixtures for `none`, `pending`, `active`, `paused`, `ended`, and archived buildings. The key assertions are:

```ts
expect(buildMapProjection({ ...source, building: activeBuilding })).toEqual(
  expect.objectContaining({
    buildingId: "building-1",
    markerStatus: "vacant",
    vacancyCount: 1,
    approvedRentSummary: "보증금 300만 · 월세 35만 · 관리비 0원",
    parkingSummary: "주차 가능 · 총 8대",
    captureStatus: "inProgress",
  }),
);

for (const status of ["none", "pending", "paused", "ended"] as const) {
  expect(buildMapProjection({
    ...source,
    building: { ...activeBuilding, managementContract: { ...activeBuilding.managementContract, status } },
  })).toBeNull();
}

expect(JSON.stringify(buildMapProjection({ ...source, building: {
  ...activeBuilding,
  ownerPhone: "TEST-OWNER-PHONE",
  internalMemo: "TEST-INTERNAL-MEMO",
} }))).not.toMatch(/TEST-OWNER-PHONE|TEST-INTERNAL-MEMO/);
```

- [ ] **Step 2: Run the projection test and verify failure**

Run: `pnpm --dir functions exec vitest run test/map-projection.test.ts`

Expected: FAIL because `functions/src/field/map-projection.ts` does not exist.

- [ ] **Step 3: Define matching server contracts**

Create `functions/src/field/contracts.ts`. Duplicate the callable wire types from `registration-draft.ts` deliberately because Functions is a separate package, and export the following server-only types:

```ts
export type FieldRole = "admin" | "staff" | "reviewer";
export type ManagementContractStatus = "none" | "pending" | "active" | "paused" | "ended";

export interface FieldActor {
  uid: string;
  role: FieldRole;
  enabled: boolean;
}

export interface ManagementContractInfo {
  status: ManagementContractStatus;
  startedOn?: string;
  endedOn?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FieldMapProjection {
  buildingId: string;
  name: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  markerStatus: "vacant" | "managed";
  vacancyCount: number;
  approvedRentSummary: string;
  parkingSummary: string;
  captureStatus: "notStarted" | "inProgress" | "complete";
  updatedAt: string;
}
```

Also export the exact `SaveFieldRegistrationInput`, `SaveFieldRegistrationResult`, `BuildingDraftPayload`, `UnitDraftPayload`, `ListingDraftPayload`, `ManagementContractDraft`, and `OwnerNoteDraftInput` shapes from Task 1.

- [ ] **Step 4: Implement the strict projection builder**

Export this signature from `functions/src/field/map-projection.ts`:

```ts
export function buildMapProjection(input: {
  building: ProjectionBuilding | null;
  listings: ProjectionListing[];
  media: ProjectionMedia[];
  updatedAt: string;
}): FieldMapProjection | null;
```

Export the input interfaces `ProjectionBuilding`, `ProjectionListing`, and `ProjectionMedia` from the same module so registration, contract-transition, and refresh services all use one projection boundary.

Return `null` unless all of these conditions are true: the building exists, is not archived, has `managementContract.status === "active"`, and has finite coordinates in valid latitude/longitude ranges. Count listings whose status is not `closed`; select only an `advertisingApproved === true` non-closed listing for the rent summary; count only finalized media for capture completion. Construct and return a fresh object containing exactly the eleven `FieldMapProjection` keys. Never spread a building, listing, or media source object into the output.

Use these stable labels:

```ts
const markerStatus = vacancyCount > 0 ? "vacant" : "managed";
const captureStatus = media.some((item) =>
  item.uploadState === "finalized" || item.uploadState === "firebaseComplete"
) ? "inProgress" : "notStarted";
```

This foundation slice must not claim full completion from the presence of one file. The capture/upload companion plan extends the same three-value contract with the fixed required-zone/minimum policy and is the only slice that may produce `complete`.

Format integer won amounts as `0원`, whole 만원, whole 억원, or a comma-formatted 원 value; missing or invalid values become `확인 필요`.

- [ ] **Step 5: Run the projection test and Functions build**

Run:

```bash
pnpm --dir functions exec vitest run test/map-projection.test.ts
pnpm --dir functions build
```

Expected: the projection test PASSes, the secure sentinel strings are absent, and TypeScript exits 0.

- [ ] **Step 6: Commit the projection boundary**

```bash
git add functions/src/field/contracts.ts functions/src/field/map-projection.ts functions/test/map-projection.test.ts
git commit -m "feat(field): define safe managed map projection"
```

## Task 3: Implement idempotent `saveFieldRegistrationCore`

**Files:**
- Create: `functions/src/field/save-field-registration.ts`
- Create: `functions/test/save-field-registration.test.ts`

- [ ] **Step 1: Write failing staff, admin, retry, and note-boundary tests**

Create `functions/test/save-field-registration.test.ts` around an in-memory dependency adapter. Assert these exact outcomes:

```ts
const staffResult = await saveFieldRegistrationCore(validInput, {
  uid: "staff-1", role: "staff", enabled: true,
}, dependencies);
expect(staffResult).toEqual({
  buildingId: expect.stringMatching(/^building_/),
  unitIds: { "unit-1": expect.stringMatching(/^unit_/) },
  listingId: expect.stringMatching(/^listing_/),
  visitId: expect.stringMatching(/^visit_/),
});
expect(lastPatch[`fieldPlatform/buildings/${staffResult.buildingId}`]).toMatchObject({
  managementContract: { status: "pending", startedOn: "2026-08-09", updatedBy: "staff-1" },
});
expect(lastPatch[`fieldPlatform/mapProjections/${staffResult.buildingId}`]).toBeNull();

const adminResult = await saveFieldRegistrationCore(validInput, {
  uid: "admin-1", role: "admin", enabled: true,
}, dependencies);
expect(lastPatch[`fieldPlatform/buildings/${adminResult.buildingId}`]).toMatchObject({
  managementContract: { status: "active" },
});
expect(lastPatch[`fieldPlatform/mapProjections/${adminResult.buildingId}`]).toMatchObject({
  buildingId: adminResult.buildingId,
});
```

Call the core twice with the same UID/request ID and a stored receipt; expect identical results and one multi-path update. Expect a reviewer or disabled actor to reject with `field_registration_forbidden`. Expect a non-empty `ownerNoteDrafts` array to reject with `field_owner_notes_not_enabled` so data cannot be silently discarded.

- [ ] **Step 2: Run the save-core test and verify failure**

Run: `pnpm --dir functions exec vitest run test/save-field-registration.test.ts`

Expected: FAIL because `save-field-registration.ts` does not exist.

- [ ] **Step 3: Implement deterministic IDs and the exact core signature**

Export these interfaces and function from `functions/src/field/save-field-registration.ts`:

```ts
export interface RegistrationRequestReceipt {
  requestHash: string;
  result: SaveFieldRegistrationResult;
  completedAt: string;
}

export interface SaveFieldRegistrationDependencies {
  getReceipt(uid: string, requestId: string): Promise<RegistrationRequestReceipt | null>;
  updateRoot(patch: Record<string, unknown>): Promise<void>;
  now(): string;
}

export async function saveFieldRegistrationCore(
  input: SaveFieldRegistrationInput,
  actor: FieldActor,
  dependencies: SaveFieldRegistrationDependencies,
): Promise<SaveFieldRegistrationResult>;
```

Generate stable path-safe IDs with SHA-256:

```ts
function entityId(prefix: string, uid: string, draftId: string, localId: string): string {
  const digest = createHash("sha256")
    .update(`${uid}\0${draftId}\0${localId}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}
```

Derive the building from `draftId`, each unit from its `localId`, and the listing/visit from `primaryUnitLocalId`. Validate path-safe `requestId`, `draftId`, and local IDs; nonblank required strings; finite coordinates; integer nonnegative money; unique units; and an existing primary unit. Reject invalid input with `field_invalid_registration`.

- [ ] **Step 4: Build one atomic registration patch**

For a requested contract, store `pending` for staff and `active` for admin. A non-requested contract becomes `none`. Require `startedOn` for requested contracts and use `dependencies.now()` plus `actor.uid` for server-owned metadata.

The single `updateRoot` call must include:

```ts
{
  [`fieldPlatform/buildings/${buildingId}`]: building,
  [`fieldPlatform/units/${unitId}`]: unit,
  [`fieldPlatform/listings/${listingId}`]: listing,
  [`fieldPlatform/visits/${visitId}`]: visit,
  [`fieldPlatform/buildingAssignments/${buildingId}/${actor.uid}`]: true,
  [`fieldPlatform/auditLogs/${registrationAuditId}`]: registrationAudit,
  [`fieldPlatform/auditLogs/${contractAuditId}`]: contractAudit,
  [`fieldPlatform/mapProjections/${buildingId}`]: projection,
  [`fieldPlatform/registrationRequests/${actor.uid}/${input.requestId}`]: receipt,
}
```

Add one unit path per `input.units`. Populate `assignedStaffIds: [actor.uid]`, an `initial` visit assigned to the actor, a `draft` listing for the primary unit, and immutable created/updated audit stamps. Build the projection through `buildMapProjection`; it is a safe object only for an admin-created active contract and `null` for staff pending/none.

Hash a normalized input with SHA-256. If `getReceipt` returns the same hash, return its stored result without writing. If it returns another hash for the same request ID, throw `field_request_id_conflict`. Deterministic entity and audit IDs ensure concurrent or ACK-loss retries cannot create duplicate entities.

- [ ] **Step 5: Run save-core tests and build**

Run:

```bash
pnpm --dir functions exec vitest run test/save-field-registration.test.ts
pnpm --dir functions build
```

Expected: all save-core tests PASS and the Functions build exits 0.

- [ ] **Step 6: Commit the registration core**

```bash
git add functions/src/field/save-field-registration.ts functions/test/save-field-registration.test.ts
git commit -m "feat(field): save registrations through idempotent server core"
```

## Task 4: Implement admin management-contract transitions

**Files:**
- Create: `functions/src/field/set-management-contract-status.ts`
- Create: `functions/test/set-management-contract-status.test.ts`

- [ ] **Step 1: Write failing authorization, activation, termination, and retry tests**

Add tests with a pending building fixture. Assert a staff actor receives `field_management_admin_required`. Assert admin activation writes `status: "active"`, requires a start date, emits `managementContract.active`, and creates a projection. Starting from active, set `status: "ended"` with `endedOn: "2026-12-31"`; assert the building retains its history and the projection path is `null`. Repeating the same request ID must return the stored result without a second update.

- [ ] **Step 2: Run the transition test and verify failure**

Run: `pnpm --dir functions exec vitest run test/set-management-contract-status.test.ts`

Expected: FAIL because the transition module does not exist.

- [ ] **Step 3: Implement the transition core**

Export these exact types and function:

```ts
export interface SetManagementContractStatusInput {
  requestId: string;
  buildingId: string;
  status: "active" | "paused" | "ended";
  startedOn?: string;
  endedOn?: string;
}

export interface SetManagementContractStatusResult {
  buildingId: string;
  status: "active" | "paused" | "ended";
}

export interface SetManagementContractStatusDependencies {
  getBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  getListings(buildingId: string): Promise<ProjectionListing[]>;
  getMedia(buildingId: string): Promise<ProjectionMedia[]>;
  getReceipt(uid: string, requestId: string): Promise<ContractRequestReceipt | null>;
  updateRoot(patch: Record<string, unknown>): Promise<void>;
  now(): string;
}

export async function setManagementContractStatusCore(
  input: SetManagementContractStatusInput,
  actor: FieldActor,
  dependencies: SetManagementContractStatusDependencies,
): Promise<SetManagementContractStatusResult>;
```

Require `actor.enabled === true` and `actor.role === "admin"`. Permit `none -> active`, `pending -> active|ended`, `active -> paused|ended`, and `paused -> active|ended`; reject every other edge with `field_management_transition_invalid`. Require `YYYY-MM-DD` `startedOn` when activating and `endedOn` when ending. Preserve the previous start date unless the admin explicitly supplies a valid one.

Write the updated building, one deterministic audit record, one request receipt under `fieldPlatform/managementContractRequests/{uid}/{requestId}`, and the rebuilt projection in one root update. `paused` and `ended` write `null` to the projection path.

- [ ] **Step 4: Run transition tests and Functions build**

Run:

```bash
pnpm --dir functions exec vitest run test/set-management-contract-status.test.ts
pnpm --dir functions build
```

Expected: all transition tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the transition core**

```bash
git add functions/src/field/set-management-contract-status.ts functions/test/set-management-contract-status.test.ts
git commit -m "feat(field): add admin management contract transitions"
```

## Task 5: Export secured callables and keep projections current

**Files:**
- Create: `functions/src/field/rebuild-map-projection.ts`
- Create: `functions/test/rebuild-map-projection.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing projection-rebuild test**

Create a fake reader/writer test asserting that `rebuildMapProjectionForBuilding("building-1", deps)` reads the building plus only that building's listings/media and writes the safe projection. When the building is missing, archived, or no longer active, assert it calls `setProjection("building-1", null)`.

- [ ] **Step 2: Run the rebuild test and verify failure**

Run: `pnpm --dir functions exec vitest run test/rebuild-map-projection.test.ts`

Expected: FAIL because `rebuild-map-projection.ts` does not exist.

- [ ] **Step 3: Implement the reusable projection repair function**

Create `functions/src/field/rebuild-map-projection.ts` with:

```ts
export interface RebuildMapProjectionDependencies {
  getBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  getListings(buildingId: string): Promise<ProjectionListing[]>;
  getMedia(buildingId: string): Promise<ProjectionMedia[]>;
  setProjection(buildingId: string, projection: FieldMapProjection | null): Promise<void>;
  now(): string;
}

export async function rebuildMapProjectionForBuilding(
  buildingId: string,
  dependencies: RebuildMapProjectionDependencies,
): Promise<void>;
```

It must call `buildMapProjection` and write only the returned allowlist object or `null`.

- [ ] **Step 4: Add authenticated callable adapters to `functions/src/index.ts`**

Add `requireFieldActor(request)` that requires `request.auth.token.fieldPlatform === true`, accepts only the three known roles, and reads `fieldPlatform/users/{uid}/enabled`; reject absent/disabled users with `permission-denied`. Export callables with these names and options:

```ts
export const saveFieldRegistration = onCall(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => saveFieldRegistrationCore(request.data, await requireFieldActor(request), saveDeps),
);

export const setManagementContractStatus = onCall(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => setManagementContractStatusCore(
    request.data,
    await requireFieldActor(request),
    contractDeps,
  ),
);
```

The adapters must query by `buildingId`, use `adminDatabase.ref().update(patch)` for root patches, read request receipts before core execution, and convert the core's stable error strings to `HttpsError("invalid-argument"|"permission-denied"|"already-exists", code)`.

- [ ] **Step 5: Export projection refresh triggers**

Use `onValueWritten` from `firebase-functions/v2/database` with database instance `bring-fm-hj-default-rtdb` and region `asia-southeast1`. Export triggers for:

```text
/fieldPlatform/buildings/{buildingId}
/fieldPlatform/listings/{listingId}
/fieldPlatform/media/{mediaId}
```

For listing/media changes, take `buildingId` from `after.val()` or `before.val()`. Each trigger calls `rebuildMapProjectionForBuilding`; it never copies event data directly into `mapProjections`.

- [ ] **Step 6: Run server tests and build**

Run:

```bash
pnpm --dir functions test
pnpm --dir functions build
```

Expected: every Functions test PASSes and the TypeScript build exits 0 with both callables and all three triggers exported.

- [ ] **Step 7: Commit server entrypoints and refresh triggers**

```bash
git add functions/src/index.ts functions/src/field/rebuild-map-projection.ts functions/test/rebuild-map-projection.test.ts
git commit -m "feat(field): expose registration and projection services"
```

## Task 6: Wire the client callable and admin approval queue

**Files:**
- Create: `company-site/app/field/lib/field-api.client.ts`
- Create: `company-site/app/field/components/ManagementContractQueue.tsx`
- Create: `company-site/tests/field/field-api.test.ts`
- Modify: `company-site/app/field/lib/firebase.client.ts`
- Modify: `company-site/app/field/lib/auth.client.ts`
- Modify: `company-site/tests/field/auth.test.ts`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing client API and queue tests**

Test that `saveFieldRegistration` returns the callable's `.data` unchanged and that `setManagementContractStatus` sends the exact request. In the component suite, inject an admin role resolver, a pending subscription that yields one building, and an approval spy. Enter `2026-08-09`, click `관리 중으로 승인`, and assert:

```ts
expect(approve).toHaveBeenCalledWith({
  requestId: expect.any(String),
  buildingId: "building-1",
  status: "active",
  startedOn: "2026-08-09",
});
```

Inject a staff role resolver and assert the approval region is not rendered. Replace the existing auth fallback test with one asserting that `dpvld858@gmail.com` without `fieldPlatform` claims is signed out and rejected.

- [ ] **Step 2: Run the client tests and verify failure**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/field-api.test.ts tests/field/auth.test.ts tests/field/components.test.tsx
```

Expected: FAIL because the API/queue modules do not exist and the current auth client still accepts the hardcoded email fallback.

- [ ] **Step 3: Implement `field-api.client.ts` with injectable boundaries**

Export these functions:

```ts
export async function saveFieldRegistration(
  input: SaveFieldRegistrationInput,
  invoke: SaveRegistrationInvoker = defaultSaveInvoker,
): Promise<SaveFieldRegistrationResult>;

export async function setManagementContractStatus(
  input: SetManagementContractStatusInput,
  invoke: SetContractInvoker = defaultSetContractInvoker,
): Promise<SetManagementContractStatusResult>;

export async function getCurrentFieldRole(): Promise<UserRole | null>;

export function subscribePendingManagementContracts(
  listener: (buildings: Building[]) => void,
  onError?: (error: Error) => void,
): () => void;
```

Declare client `SetManagementContractStatusInput` and `SetManagementContractStatusResult` with the exact Task 4 fields so the callable wire contract cannot drift between packages.

Use `httpsCallable` names `saveFieldRegistration` and `setManagementContractStatus`. `getCurrentFieldRole` must read `auth.currentUser.getIdTokenResult()` and return a role only when `fieldPlatform === true`. Query `fieldPlatform/buildings` with `orderByChild("managementContract/status")` and `equalTo("pending")`; normalize object results to a `Building[]`.

In `firebase.client.ts`, initialize App Check once when `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` is present:

```ts
const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckSiteKey && typeof window !== "undefined") {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
```

The release runbook must treat a missing production site key as a failed release precondition; local unit tests continue to use injected callable invokers.

- [ ] **Step 4: Remove the legacy email authorization path**

Delete `existingFirebaseAdmins` and the email branch from `sessionFromUser` in `auth.client.ts`. A successful field session requires both `fieldPlatform: true` and a valid `fieldRole`. Do not suppress callable provisioning errors as a legacy fallback; translate `functions/permission-denied` to `field_access_denied` and other failures to `field_provision_failed` so `AuthGate` retains its current denied-versus-network copy.

- [ ] **Step 5: Implement and mount the admin queue**

`ManagementContractQueue.tsx` must accept injectable `resolveRole`, `subscribe`, and `approve` props with the Task 6 API functions as defaults. On mount, resolve the current claim; return `null` unless it is `admin`. For admins, show pending building name/address/requested start date, allow an editable start date, and call `setManagementContractStatus` with a new UUID. Keep failed rows visible with `승인 실패 · 다시 시도해 주세요`; remove a row only after the callable succeeds or the live query no longer includes it.

In `FieldApp.tsx`, change the Buildings branch to:

```tsx
<section className="field-building-workspace">
  <ManagementContractQueue />
  <BuildingWizard
    onComplete={(draft) => saveFieldRegistration(toSaveFieldRegistrationInput(draft))}
  />
</section>
```

The queue's own claim check avoids competing with the shared session-context work in the owner-note plan.

- [ ] **Step 6: Run client tests and type-check**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/field-api.test.ts tests/field/auth.test.ts tests/field/components.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: all selected tests PASS, the hardcoded email no longer authorizes a claimless user, staff cannot see the approval queue, and TypeScript exits 0.

- [ ] **Step 7: Commit the client API and approval UI**

```bash
git add company-site/app/field/lib/field-api.client.ts company-site/app/field/lib/firebase.client.ts company-site/app/field/lib/auth.client.ts company-site/app/field/components/ManagementContractQueue.tsx company-site/app/field/FieldApp.tsx company-site/tests/field/field-api.test.ts company-site/tests/field/auth.test.ts company-site/tests/field/components.test.tsx
git commit -m "feat(field): connect registration and contract approval UI"
```

## Task 7: Lock down management contracts, receipts, and map projections in Database Rules

**Files:**
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] **Step 1: Write failing enabled-user and server-owned-path rule tests**

Seed enabled `staff-1`, `reviewer-1`, and `admin-1` user records. Add an active projection and a disabled user with valid-looking claims. The disabled user may read only their own enabled flag so the UI can explain the state, but no operational collection. Assert:

```ts
await assertSucceeds(get(ref(admin, "fieldPlatform/mapProjections/building-1")));
await assertFails(set(ref(admin, "fieldPlatform/mapProjections/building-1/name"), "조작"));
await assertFails(set(ref(admin, "fieldPlatform/registrationRequests/admin-1/r1"), { ok: true }));
await assertFails(update(ref(staff, "fieldPlatform/buildings/building-1/managementContract"), {
  status: "active",
  startedOn: "2026-08-09",
  updatedAt: NOW,
  updatedBy: "staff-1",
}));
await assertSucceeds(get(ref(disabled, "fieldPlatform/users/disabled-1/enabled")));
await assertFails(get(ref(disabled, "fieldPlatform/buildings/building-1")));
```

Also assert that a missing `managementContract` is readable and behaves as migrated `none`, while an invalid stored enum cannot survive a client update.

- [ ] **Step 2: Run emulator tests and verify failure**

Run:

```bash
pnpm --dir company-site exec firebase --config ../firebase.json --project bring-fm-hj emulators:exec --only database,storage "pnpm test:rules"
```

Expected: FAIL because current rules do not require `users/{uid}/enabled`, have no `mapProjections` rule, and allow an assigned staff member to modify the embedded contract object.

- [ ] **Step 3: Add the enabled-user guard to every field-platform client rule**

Every operational `fieldPlatform` read/write expression must include:

```text
auth != null && auth.token.fieldPlatform === true && root.child('fieldPlatform/users').child(auth.uid).child('enabled').val() === true
```

Retain each path's current role/assignment restrictions after this common guard. Add `".indexOn": ["managementContract/status"]` under `fieldPlatform/buildings`.

Keep a narrow exception at `fieldPlatform/users/$uid`: a claimed user may read only their own user record even when `enabled` is false, while an enabled admin may read another user record. This makes `비활성화된 계정` distinguishable without granting access to buildings, projections, assignments, or media. Add `".indexOn": ["buildingId"]` under both `fieldPlatform/listings` and `fieldPlatform/media` for projection-refresh queries.

- [ ] **Step 4: Make contract state and projections server-owned**

For client building writes, require:

```text
newData.child('managementContract').val() === data.child('managementContract').val()
```

Keep missing `managementContract` valid. When it exists, validate the five enum values, `YYYY-MM-DD` start/end strings when present, nonblank `updatedBy`, and a string `updatedAt`. Add these paths:

```json
"mapProjections": {
  ".read": "auth != null && auth.token.fieldPlatform === true && root.child('fieldPlatform/users').child(auth.uid).child('enabled').val() === true",
  ".write": false
},
"registrationRequests": { ".read": false, ".write": false },
"managementContractRequests": { ".read": false, ".write": false }
```

Admin SDK callables and triggers bypass client rules and remain the only writers.

- [ ] **Step 5: Run rule tests**

Run the emulator command from Step 2.

Expected: all database and storage rule tests PASS. Enabled staff retain their existing assigned-record permissions; disabled, anonymous, reviewer-without-path-access, and all client projection/receipt writes are denied.

- [ ] **Step 6: Commit the rule migration**

```bash
git add database.rules.json company-site/tests/field/database-rules.test.ts
git commit -m "security(field): protect managed map projections and contracts"
```

## Task 8: Replace independent layers with one exclusive map mode

**Files:**
- Modify: `data/field-map-model.js`
- Modify: `data/field-map-model.test.js`

- [ ] **Step 1: Replace the old layer test with failing mode/projection tests**

Remove the test named `vendor and property layers can be toggled independently`. Add:

```js
test("map mode always resolves to exactly one context", () => {
  assert.equal(resolveMapMode({ requestedMode: "vendors", embedded: true }), "vendors");
  assert.equal(resolveMapMode({ storedMode: "managed", embedded: false }), "managed");
  assert.equal(resolveMapMode({ embedded: true }), "managed");
  assert.equal(resolveMapMode({ embedded: false }), "vendors");
  assert.deepEqual(filterMapItems(layers, "managed"), {
    vendors: [], managedBuildings: layers.managedBuildings,
  });
  assert.deepEqual(filterMapItems(layers, "vendors"), {
    vendors: layers.vendors, managedBuildings: [],
  });
});
```

Add projection fixtures rather than raw buildings/listings/media. Test managed search by name/address, `hasVacancy|full`, and `notStarted|inProgress|complete`. Keep the secure sentinel assertion against `safePropertyPopupModel`.

- [ ] **Step 2: Run the map-model test and verify failure**

Run: `node --test data/field-map-model.test.js`

Expected: FAIL because `resolveMapMode`, projection-based markers, and managed filters do not exist, while `filterMapItems` still accepts two independent booleans.

- [ ] **Step 3: Implement the projection-only model API**

Export these functions from the existing UMD wrapper:

```js
resolveMapMode({ requestedMode, storedMode, embedded })
filterMapItems({ vendors, managedBuildings }, mode)
toManagedBuildingMarkers(projections)
filterManagedBuildings(records, { query, vacancy, capture })
propertyMarkerColor(markerStatus)
safePropertyPopupModel(marker)
```

`resolveMapMode` accepts only `vendors` or `managed`; requested URL mode wins, stored mode is second, then embedded defaults to `managed` and standalone defaults to `vendors`. `filterMapItems` returns vendors or managed buildings, never both or neither. `toManagedBuildingMarkers` validates only projection coordinates and copies only projection keys. `safePropertyPopupModel` must omit coordinates, IDs not needed by the popup, management metadata, owner/contact/access/note values, and unknown fields.

- [ ] **Step 4: Run the map-model test**

Run: `node --test data/field-map-model.test.js`

Expected: all map-model tests PASS, including mutually exclusive modes and secure sentinel exclusion.

- [ ] **Step 5: Commit the pure map mode**

```bash
git add data/field-map-model.js data/field-map-model.test.js
git commit -m "feat(map): separate vendor and managed building modes"
```

## Task 9: Integrate the same-origin authenticated map iframe

**Files:**
- Modify: `wonju-map.html`
- Modify: `company-site/app/field/components/FieldMapPanel.tsx`
- Modify: `company-site/tests/field/components.test.tsx`
- Create: `data/field-map-integration.test.js`

- [ ] **Step 1: Write failing iframe and static integration tests**

Change the component test to require the exact source:

```ts
expect(screen.getByTitle("BRING 원주 건물 유지보수 지도"))
  .toHaveAttribute("src", "/wonju-map.html?embedded=field&mode=managed");
```

Create `data/field-map-integration.test.js` that reads `wonju-map.html` and `FieldMapPanel.tsx` and asserts:

```js
assert.match(html, /fieldPlatform\/mapProjections/);
assert.match(html, /getIdTokenResult/);
assert.match(html, /fieldPlatform\/users\/\$\{user\.uid\}\/enabled/);
assert.doesNotMatch(html, /FIELD_ADMIN_EMAIL|dpvld858@gmail\.com/);
assert.doesNotMatch(html, /fieldPlatform\/(buildings|listings|media)/);
assert.doesNotMatch(html, /fieldState|\["buildings",\s*"listings",\s*"media"\]/);
assert.match(panel, /\/wonju-map\.html\?embedded=field&mode=managed/);
assert.doesNotMatch(panel, /bringengineering\.github\.io\/FM\/wonju-map\.html/);
```

- [ ] **Step 2: Run integration tests and verify failure**

Run:

```bash
node --test data/field-map-integration.test.js
pnpm --dir company-site exec vitest run tests/field/components.test.tsx
```

Expected: FAIL because the iframe switches localhost to GitHub Pages, the map reads raw collections, and the map authorizes one hardcoded email.

- [ ] **Step 3: Make `FieldMapPanel` same-origin only**

Delete `DEPLOYED_MAP_URL`, `useEffect`, and the localhost host check. Use:

```ts
const EMBEDDED_MAP_URL = "/wonju-map.html?embedded=field&mode=managed";
const FULL_MAP_URL = "/wonju-map.html?mode=managed";
```

Set iframe `src={EMBEDDED_MAP_URL}` and the full-screen anchor `href={FULL_MAP_URL}`. Update the copy to say the two work contexts are separated and remove the statement that local preview uses the GitHub Pages map.

- [ ] **Step 4: Replace layer checkboxes with tab-style radios in `wonju-map.html`**

Use one radio group:

```html
<div class="map-mode-tabs" role="radiogroup" aria-label="지도 업무 선택">
  <label><input type="radio" name="mapMode" value="vendors"> 유지보수 업체 지도</label>
  <label><input type="radio" name="mapMode" value="managed"> BRING 관리계약 건물</label>
</div>
```

Wrap existing vendor stats/filters/list/legend in `data-mode-panel="vendors"`. Put managed count/vacancy count, building/address search, vacancy filter, capture filter, sync status, managed list, and managed legend in `data-mode-panel="managed"`. `setMapMode(mode, { persist })` must set exactly one radio, hide the other panel, clear the inactive marker collection, close the info window, and render only the chosen mode. Call it with `persist: false` for initial URL/default resolution and `persist: true` only for a user's radio change; this prevents the iframe's explicit managed mode from silently changing the standalone default.

Resolve the first mode through:

```js
const embedded = params.get("embedded") === "field";
const mapMode = FIELD_MODEL.resolveMapMode({
  requestedMode: params.get("mode"),
  storedMode: localStorage.getItem("bring_map_mode"),
  embedded,
});
```

When embedded, add an `embedded` body class and hide the standalone heading/link block without hiding the mode radios or filters. Naver SDK failure must leave radios, filters, lists, and the explicit map error usable.

- [ ] **Step 5: Replace raw Firebase subscriptions with one claim-gated projection subscription**

Remove `FIELD_ADMIN_EMAIL`, `fieldState`, and subscriptions to `buildings`, `listings`, and `media`. After `onAuthStateChanged`, call `user.getIdTokenResult()` and require `claims.fieldPlatform === true` plus a known role. Then read `fieldPlatform/users/${user.uid}/enabled`; subscribe to `fieldPlatform/mapProjections` only when it equals `true`.

Use these user-visible states: `내부 로그인 필요`, `권한 등록 필요`, `비활성화된 계정`, `Firebase 동기화 중`, `Firebase 실시간 연결됨`, and `Firebase 연결 확인 필요`. The standalone managed tab may retain a Google popup button, but it must never send tokens through URL parameters, fragments, or `postMessage` and must not authorize by email.

Feed the projection snapshot to `toManagedBuildingMarkers`, apply `filterManagedBuildings`, and render only safe popup fields: building name, address, vacancy count, approved rent summary, parking summary, and capture status.

Change the `data/field-map-model.js` script query in `wonju-map.html` to `v=20260809-managed-2` so Hosting and browser caches cannot retain the independent-layer model.

- [ ] **Step 6: Sync the canonical map and run focused tests**

Run:

```bash
pnpm --dir company-site sync:field-map
node --test data/field-map-model.test.js data/field-map-integration.test.js
pnpm --dir company-site exec vitest run tests/field/components.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: all commands PASS. The synchronized public map is generated from root `wonju-map.html`; do not edit or stage the generated copy separately.

- [ ] **Step 7: Commit the same-origin map integration**

```bash
git add wonju-map.html data/field-map-integration.test.js company-site/app/field/components/FieldMapPanel.tsx company-site/tests/field/components.test.tsx
git commit -m "feat(map): connect active managed buildings securely"
```

## Task 10: Document migration, run full verification, and perform browser acceptance

**Files:**
- Create: `docs/field-platform-managed-map-release.md`
- Modify only when a failing assertion exposes a verified defect: files already named in Tasks 1-9

- [ ] **Step 1: Write the migration and release runbook**

Create `docs/field-platform-managed-map-release.md` with these exact operational decisions and commands:

- Missing `managementContract` is interpreted as `none`; no existing building becomes managed automatically.
- Drafts without `draftVersion` are upgraded locally to version 2 while coordinates are preserved.
- Deploy Functions first, then Database Rules, then Hosting, so the client never calls a missing mutation endpoint or reads an unprotected projection.
- Provision `fieldPlatform` and `fieldRole` claims plus `fieldPlatform/users/{uid}/enabled === true`; a company email alone is insufficient.
- Configure `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` with the Firebase App Check reCAPTCHA Enterprise site key before the production build; a build without it must not be released while callables enforce App Check.
- Approve pending records only after checking the signed management contract and start date.
- Register every Firebase Hosting/custom production domain in the Naver Maps Web service URL list; localhost tile failure does not block list/filter verification.
- Roll back Hosting and Functions independently through Firebase release history; retaining safe `mapProjections` during rollback does not expose raw records.

Include:

```bash
pnpm --dir functions test
pnpm --dir functions build
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
pnpm --dir company-site build
firebase deploy --only functions:field-platform
firebase deploy --only database
firebase deploy --only hosting:bringcare
```

- [ ] **Step 2: Run the complete automated verification gate**

Run from the repository worktree root:

```bash
pnpm --dir functions test
pnpm --dir functions build
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
pnpm --dir company-site lint
pnpm --dir company-site build
node --test data/field-map-model.test.js data/field-map-integration.test.js
pnpm --dir company-site exec firebase --config ../firebase.json --project bring-fm-hj emulators:exec --only database,storage "pnpm test:rules"
git diff --check
```

Expected: every command exits 0; no test is skipped except emulator-aware tests outside the launched database/storage emulators.

- [ ] **Step 3: Verify the registration and contract transition in the local browser**

At `/field` with a staff test account, confirm the coordinate fields are absent, address verification enables the next step, a requested contract saves as pending, and it does not appear on the managed map. With an admin test account, approve the same building with a start date and confirm it appears after the projection refresh. End that test contract and confirm the marker disappears while the building/audit history remains.

- [ ] **Step 4: Verify both map entry modes and security states**

Open `/wonju-map.html` directly and confirm `유지보수 업체 지도` is selected. Open `/field`, choose 지도, and confirm `BRING 관리계약 건물` is selected. Switch repeatedly and verify only one marker/list/filter context is visible. Sign out and use a disabled account to confirm managed data is replaced by the explicit login/permission state, with no cached marker remaining.

- [ ] **Step 5: Commit the release runbook**

```bash
git add docs/field-platform-managed-map-release.md
git commit -m "docs(field): add managed map migration runbook"
```

## Completion criteria

- Staff contract requests persist as `pending`; an admin can activate them, and only active, non-archived contracts have projections.
- Ending or pausing a contract removes its projection without deleting building or audit history.
- Registration is idempotent for repeated request IDs and returns `{ buildingId, unitIds, listingId, visitId }`.
- `mapProjections` contains only the explicit advertising-safe allowlist and rejects every client write.
- The map iframe is same-origin, verifies custom claims plus enabled-user state, and never uses an email allowlist or raw building/listing/media subscriptions.
- Standalone defaults to vendors, `/field` defaults to managed buildings, and exactly one mode is active at a time.
- Latitude and longitude remain in the draft, server record, projection, GPS check, and marker, but no numeric coordinate input or internal-coordinate error copy is visible.
- Old records without contract metadata stay off the managed map, and old local drafts preserve their coordinates after migration.
- All focused, full, rules-emulator, build, type-check, lint, and browser acceptance checks pass.

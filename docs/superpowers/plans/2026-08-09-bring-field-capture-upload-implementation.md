# BRING Field Capture & Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one production-ready photo/video capture workflow shared by the building wizard and the standalone Capture tab, with UID-isolated offline persistence, resumable Firebase staging uploads, server-authoritative finalization, and private finalized-media access.

**Architecture:** `CaptureGuide` writes validated blobs to a UID-namespaced IndexedDB queue before showing “기기에 저장됨”; a single `MediaUploadCoordinator` reconciles that queue with create-only Firebase Storage staging objects whenever the authenticated app is online. App Check-protected callables verify assignment, object generation, MIME, size, checksum, and stable IDs, then copy the object to a server-only finalized path and atomically write the media record, audit event, Drive outbox job, capture session, and safe map projection. Finalized objects are never exposed through long-lived download tokens; an authorization callable issues five-minute signed URLs after rechecking current assignment or reviewer/admin authority.

**Tech Stack:** React 19, TypeScript 5.9, Vinext, Firebase Auth/App Check/Realtime Database/Storage/Functions v2, `idb` 8, IndexedDB, Vitest, Testing Library, Firebase Emulator Suite, Firebase Admin Storage, scheduled Functions.

---

## Required foundation and execution boundary

Complete and merge the owner-note/session and managed-map foundation plan before Task 1. This plan relies on these exact shared contracts and does not recreate them:

- `AuthGate` mounts `FieldSessionProvider`; authenticated components obtain `{ uid, displayName, role }` with `useFieldSession()`.
- `company-site/app/field/lib/field-api.client.ts` exports `saveFieldRegistration(input)`.
- `saveFieldRegistration` returns `{ buildingId: string; unitIds: Record<string, string>; listingId: string; visitId: string }`, where `unitIds` is keyed by the wizard unit `localId`.
- The save input contains `requestId`, `draftId`, `building`, `units`, `listing`, `primaryUnitLocalId`, `managementContract`, and optional `ownerNoteDrafts`.
- `functions/src/field/save-field-registration.ts` exports `saveFieldRegistrationCore`; `functions/src/index.ts` exports the callable.
- `functions/src/field/map-projection.ts` is the sole server helper that constructs `fieldPlatform/mapProjections/{buildingId}`.

This plan creates the durable Drive outbox entry but does not perform the Drive API copy. Drive processing remains an independently retryable consumer of `fieldPlatform/driveSyncJobs`; media finalization succeeds once that outbox record is durably queued.

## Locked file structure

### Frontend files to create

- `company-site/app/field/lib/capture-policy.ts` — MIME/size/path policy, zone catalogue, attachment descriptors, and video guidance.
- `company-site/app/field/lib/offline-queue.ts` — the only IndexedDB schema and UID-scoped draft/media/sync API.
- `company-site/app/field/lib/media-upload.ts` — Storage reconciliation and sequential upload/finalize coordinator.
- `company-site/app/field/components/CaptureGuide.tsx` — shared zone cards, native camera inputs, previews, warnings, replace/exclude/retry actions.
- `company-site/app/field/components/CaptureWorkspace.tsx` — assigned target selection and new/resumed standalone sessions.
- `company-site/app/field/components/FieldServiceWorker.tsx` — scoped service-worker registration.
- `company-site/public/field-sw.js` — safe `/field` app-shell cache only.

### Frontend files to modify

- `company-site/app/field/lib/types.ts` — finalized upload states, capture-session records, serializable attachment contracts.
- `company-site/app/field/lib/field-api.client.ts` — start/finalize/access callables and capture-target/session reads.
- `company-site/app/field/lib/firebase.client.ts` — Firebase App Check initialization.
- `company-site/app/field/components/BuildingWizard.tsx` — render `CaptureGuide` at step 5 and store descriptors, never blobs, in the JSON draft.
- `company-site/app/field/components/AppShell.tsx` — real user identity, pending-upload indicator, guarded sign-out action.
- `company-site/app/field/FieldApp.tsx` — shared coordinator, standalone Capture tab, registration binding, service worker, guarded logout.
- `company-site/app/field/field.css` — capture cards, preview grid, progress/failure states, mobile safe-area layout.
- `company-site/package.json` — `fake-indexeddb` test dependency.
- `company-site/tests/field/setup.ts` — deterministic browser API shims used by capture tests.

### Backend files to create

- `functions/src/field/media-policy.ts` — server-side MIME, size, UUID, staging/final-path checks.
- `functions/src/field/start-capture-session.ts` — idempotent assigned-building visit/capture-session creation.
- `functions/src/field/finalize-field-media.ts` — pure finalization core and atomic patch construction.
- `functions/src/field/exclude-field-media.ts` — assignment-checked, audited advertising exclusion without object deletion.
- `functions/src/field/get-field-media-access.ts` — current-authority check and five-minute read URL contract.
- `functions/src/field/cleanup-orphan-media.ts` — deterministic seven-day staging cleanup core.
- `functions/src/security/rate-limit.ts` — transaction-backed user/session callable limiter.

### Backend/security files to modify

- `functions/src/field/map-projection.ts` — existing strict eleven-field map allowlist consumed unchanged by finalization.
- `functions/src/index.ts` — App Check-protected callables plus daily cleanup schedule.
- `database.rules.json` — server-owned media/session completion/outbox/projection paths and assignment-scoped reads.
- `storage.rules` — UUID paths, exact MIME allowlist, create-only staging, uploader-only staging read, no finalized direct read.

### Tests and release evidence to create

- `company-site/tests/field/capture-policy.test.ts`
- `company-site/tests/field/offline-queue.test.ts`
- `company-site/tests/field/media-upload.test.ts`
- `company-site/tests/field/capture-components.test.tsx`
- `company-site/tests/field/capture-workspace.test.tsx`
- `company-site/tests/field/service-worker.test.ts`
- `functions/test/start-capture-session.test.ts`
- `functions/test/finalize-field-media.test.ts`
- `functions/test/get-field-media-access.test.ts`
- `functions/test/rate-limit.test.ts`
- `functions/test/cleanup-orphan-media.test.ts`
- `docs/superpowers/verification/2026-08-09-field-capture-device-acceptance.md`

## Canonical contracts

Use the following names unchanged throughout the tasks:

```ts
export type UploadState =
  | "queued"
  | "uploading"
  | "objectStored"
  | "finalizing"
  | "finalized"
  | "failed";

export type DriveSyncState =
  | "notRequested"
  | "queued"
  | "syncing"
  | "complete"
  | "failed";

export interface CaptureBinding {
  buildingId?: string;
  unitId?: string;
  listingId?: string;
  visitId?: string;
  draftId?: string;
  unitLocalId?: string;
}

export interface CaptureAttachmentDescriptor {
  mediaId: string;
  captureSessionId: string;
  kind: MediaKind;
  zone: MediaZone;
  slotId: string;
  required: boolean;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  capturedAt: ISODateTime;
  uploadState: UploadState;
  uploadProgress: number;
  failureCode?: string;
  replacesMediaId?: string;
  videoMetadata?: { durationSeconds: number; width: number; height: number };
}

export interface CaptureSessionRecord {
  id: string;
  requestId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitId: string;
  createdBy: string;
  status: "open" | "complete";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
```

`CaptureAttachmentDescriptor` is the only media shape allowed inside the wizard JSON/localStorage draft. `Blob`, `File`, base64 text, `blob:` URLs, signed URLs, and Firebase download tokens belong in neither the descriptor nor `MediaRecord`.

### Task 1: Lock media policy, zones, and serializable domain contracts

**Files:**
- Create: `company-site/app/field/lib/capture-policy.ts`
- Create: `company-site/tests/field/capture-policy.test.ts`
- Modify: `company-site/app/field/lib/types.ts:13-48,230-258`

- [ ] **Step 1: Write the failing policy tests**

```ts
import { describe, expect, it } from "vitest";
import {
  CAPTURE_ZONES,
  buildStagingPath,
  describeCaptureFile,
  evaluateVerticalVideo,
} from "../../app/field/lib/capture-policy";

const SESSION = "11111111-1111-4111-8111-111111111111";
const MEDIA = "22222222-2222-4222-8222-222222222222";

describe("capture policy", () => {
  it("accepts only the approved MIME types and derives the path extension", () => {
    const descriptor = describeCaptureFile(new File(["photo"], "room.any", {
      type: "image/jpeg",
      lastModified: 10,
    }), { mediaId: MEDIA, captureSessionId: SESSION, zone: "roomOverview", slotId: "roomOverview-1", required: true });
    expect(descriptor.mimeType).toBe("image/jpeg");
    expect(buildStagingPath("staff-1", descriptor)).toBe(
      `field-media/staff-1/${SESSION}/photos/${MEDIA}.jpg`,
    );
    expect(() => describeCaptureFile(new File(["<svg/>"] , "x.svg", { type: "image/svg+xml" }), {
      mediaId: MEDIA, captureSessionId: SESSION, zone: "exterior", slotId: "exterior-1", required: true,
    })).toThrow("capture_mime_not_allowed");
  });

  it("defines the complete approved zone order and flags invalid vertical video", () => {
    expect(CAPTURE_ZONES.map((zone) => zone.id)).toEqual([
      "exterior", "accessRoad", "parking", "commonEntrance", "corridorStairs", "recycling",
      "roomOverview", "windowDaylight", "kitchen", "bathroom", "optionsStorage",
      "boilerEquipment", "repairEvidence", "verticalVideo",
    ]);
    expect(evaluateVerticalVideo({ durationSeconds: 8, width: 1920, height: 1080 })).toEqual({
      countsAsComplete: false,
      warnings: ["영상은 10~20초로 촬영해 주세요.", "휴대전화를 세로로 들고 촬영해 주세요."],
    });
  });

  it("keeps the JSON descriptor free of binary and transient URLs", () => {
    const descriptor = describeCaptureFile(new File(["photo"], "room.jpg", { type: "image/jpeg" }), {
      mediaId: MEDIA, captureSessionId: SESSION, zone: "roomOverview", slotId: "roomOverview-1", required: true,
    });
    expect(JSON.stringify(descriptor)).not.toMatch(/blob:|base64|data:|downloadToken/);
  });
});
```

- [ ] **Step 2: Run the tests and verify the red state**

Run: `pnpm --dir company-site exec vitest run tests/field/capture-policy.test.ts`

Expected: FAIL with `Failed to resolve import "../../app/field/lib/capture-policy"`.

- [ ] **Step 3: Implement the exact policy**

In `capture-policy.ts`, export these fixed maps and functions:

```ts
export const MEDIA_POLICY = {
  photo: {
    maxBytes: 25 * 1024 * 1024,
    mimeToExtension: {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
      "image/heic": "heic", "image/heif": "heif",
    },
  },
  video: {
    maxBytes: 500 * 1024 * 1024,
    mimeToExtension: {
      "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    },
  },
} as const;

export const CAPTURE_ZONES = [
  { id: "exterior", label: "외관", scope: "building", kind: "photo", required: true, minimum: 1, guide: "건물 전체와 상호·출입구가 함께 보이게 촬영" },
  { id: "accessRoad", label: "도로·진입부", scope: "building", kind: "photo", required: true, minimum: 1, guide: "차량과 보행 진입 폭이 보이게 촬영" },
  { id: "parking", label: "주차", scope: "building", kind: "photo", required: false, minimum: 1, guide: "주차 위치와 진입 동선을 촬영" },
  { id: "commonEntrance", label: "공동현관", scope: "building", kind: "photo", required: true, minimum: 1, guide: "문과 공동현관 상태를 촬영" },
  { id: "corridorStairs", label: "복도·계단", scope: "building", kind: "photo", required: false, minimum: 1, guide: "호실까지 이동 동선을 촬영" },
  { id: "recycling", label: "분리수거장", scope: "building", kind: "photo", required: false, minimum: 1, guide: "배출 위치와 이용 동선을 촬영" },
  { id: "roomOverview", label: "전체구조", scope: "unit", kind: "photo", required: true, minimum: 2, guide: "방 모서리에서 반대 방향으로 두 장 촬영" },
  { id: "windowDaylight", label: "창문·채광", scope: "unit", kind: "photo", required: true, minimum: 1, guide: "창 크기와 채광이 함께 보이게 촬영" },
  { id: "kitchen", label: "주방", scope: "unit", kind: "photo", required: true, minimum: 1, guide: "싱크대와 조리 공간 전체를 촬영" },
  { id: "bathroom", label: "욕실", scope: "unit", kind: "photo", required: true, minimum: 1, guide: "변기·세면대·샤워 공간을 촬영" },
  { id: "optionsStorage", label: "옵션·수납", scope: "unit", kind: "photo", required: false, minimum: 1, guide: "제공 옵션과 수납공간을 촬영" },
  { id: "boilerEquipment", label: "보일러·설비", scope: "unit", kind: "photo", required: true, minimum: 1, guide: "보일러와 주요 설비 상태를 촬영" },
  { id: "repairEvidence", label: "수리 필요부위", scope: "unit", kind: "photo", required: false, minimum: 1, guide: "전체 위치 한 장과 손상 부위 근접 사진 촬영" },
  { id: "verticalVideo", label: "10~20초 세로영상", scope: "unit", kind: "video", required: true, minimum: 1, guide: "현관에서 방 전체를 세로로 천천히 촬영" },
] as const;

export function describeCaptureFile(
  file: File,
  input: Pick<CaptureAttachmentDescriptor, "mediaId" | "captureSessionId" | "zone" | "slotId" | "required">,
): CaptureAttachmentDescriptor;
export function buildStagingPath(uid: string, descriptor: CaptureAttachmentDescriptor): string;
export function evaluateVerticalVideo(input: { durationSeconds: number; width: number; height: number }): {
  countsAsComplete: boolean;
  warnings: string[];
};
```

`describeCaptureFile` must reject an unknown MIME with `capture_mime_not_allowed`, reject a file over the per-kind limit with `capture_file_too_large`, derive `kind` from the allowlist rather than the filename, set `capturedAt` to a new ISO timestamp, and initialize `uploadState: "queued"` and `uploadProgress: 0`. `buildStagingPath` must validate RFC 4122 UUID shape for the session and media IDs and use only the allowlist-derived extension.

Update `types.ts` to the canonical contracts above; make `MediaRecord.contentHash` optional for large video, add required immutable `requestId`, add `captureQualityState: "valid" | "warning"`, add `objectGeneration`, `objectMd5Hash`, `replacesMediaId`, `excludedAt`, and `excludedBy` as optional strings, and replace `firebaseComplete` with the six-state `UploadState` union. Keep the map helper's legacy read compatibility for old `firebaseComplete` strings without permitting new records to write that state.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/capture-policy.test.ts tests/field/types.test.ts
pnpm --dir company-site typecheck:field
```

Expected: both commands PASS; TypeScript reports no errors.

- [ ] **Step 5: Commit the policy contract**

```bash
git add company-site/app/field/lib/types.ts company-site/app/field/lib/capture-policy.ts company-site/tests/field/capture-policy.test.ts
git commit -m "feat(field): define capture media policy"
```

### Task 2: Build the UID-isolated IndexedDB queue and quota guard

**Files:**
- Create: `company-site/app/field/lib/offline-queue.ts`
- Create: `company-site/tests/field/offline-queue.test.ts`
- Modify: `company-site/package.json`
- Modify: `company-site/pnpm-lock.yaml`

- [ ] **Step 1: Add the test-only IndexedDB implementation**

Run: `pnpm --dir company-site add -D fake-indexeddb`

Expected: `fake-indexeddb` appears in `devDependencies` and the lockfile changes.

- [ ] **Step 2: Write failing queue tests**

```ts
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { ensureCaptureCapacity, openOfflineQueue } from "../../app/field/lib/offline-queue";

const dbName = `capture-${crypto.randomUUID()}`;
afterEach(() => deleteDB(dbName));

describe("offline capture queue", () => {
  it("stores the Blob only for the owning UID and removes it after finalization", async () => {
    const queue = await openOfflineQueue(dbName);
    await queue.enqueue({ uid: "u1", mediaId: "m1", captureSessionId: "s1", requestId: "r1",
      descriptor: { mediaId: "m1", captureSessionId: "s1", kind: "photo", zone: "exterior",
        slotId: "exterior-1", required: true, originalFileName: "a.jpg", mimeType: "image/jpeg",
        sizeBytes: 3, lastModified: 1, capturedAt: "2026-08-09T00:00:00.000Z",
        uploadState: "queued", uploadProgress: 0 },
      blob: new Blob(["abc"], { type: "image/jpeg" }), binding: { draftId: "d1" } });
    expect((await queue.list("u1"))[0].blob).toBeInstanceOf(Blob);
    expect(await queue.list("u2")).toEqual([]);
    await queue.markFinalized("u1", "m1", { storagePath: "field-media-finalized/b1/m1.jpg", driveSyncState: "queued" });
    expect((await queue.list("u1"))[0].blob).toBeUndefined();
  });

  it("rejects insufficient estimated space before starting a transaction", async () => {
    await expect(ensureCaptureCapacity(10_000_000, async () => ({ usage: 95_000_000, quota: 100_000_000 })))
      .rejects.toThrow("capture_storage_quota");
  });

  it("keeps draft and sync records isolated by UID", async () => {
    const queue = await openOfflineQueue(dbName);
    await queue.putDraft("u1", "d1", 4, { captureSessionId: "s1", captureAttachments: [] });
    await queue.putSyncState("u1", { lastAttemptAt: "2026-08-09T00:00:00.000Z", pendingCount: 1 });
    expect(await queue.getDraft("u1", "d1")).toEqual(expect.objectContaining({ ownerUid: "u1", draftVersion: 4 }));
    expect(await queue.getDraft("u2", "d1")).toBeUndefined();
    expect(await queue.getSyncState("u1")).toEqual(expect.objectContaining({ pendingCount: 1 }));
    expect(await queue.getSyncState("u2")).toBeUndefined();
  });

  it("binds draft media through the registration unit-id map", async () => {
    const queue = await openOfflineQueue(dbName);
    await enqueueQueuedPhoto(queue, { uid: "u1", mediaId: "m1", captureSessionId: "s1",
      binding: { draftId: "d1", unitLocalId: "unit-1" } });
    await queue.bindRegistration("u1", "s1", { buildingId: "b1", unitIds: { "unit-1": "u-101" }, listingId: "l1", visitId: "v1" });
    expect((await queue.get("u1", "m1"))?.binding).toEqual({ buildingId: "b1", unitId: "u-101", listingId: "l1", visitId: "v1", draftId: "d1", unitLocalId: "unit-1" });
  });
});
```

Define `enqueueQueuedPhoto` inside the test file; it calls the public `enqueue` method with a one-byte JPEG, `requestId: "r1"`, and the canonical descriptor defaults. Do not add a test-only method to the production queue.

- [ ] **Step 3: Verify the queue tests fail**

Run: `pnpm --dir company-site exec vitest run tests/field/offline-queue.test.ts`

Expected: FAIL because `offline-queue.ts` does not exist.

- [ ] **Step 4: Implement one versioned database and a narrow queue port**

Use `idb.openDB` with database name `bring-field-offline`, version `1`, and exactly these stores/indexes:

```ts
interface FieldOfflineDatabase extends DBSchema {
  drafts: { key: string; value: OfflineDraftRecord; indexes: { "by-uid": string } };
  mediaQueue: {
    key: string;
    value: QueuedMediaRecord;
    indexes: { "by-uid": string; "by-session": [string, string]; "by-state": [string, UploadState] };
  };
  syncState: { key: string; value: CaptureSyncState };
}

export interface QueuedMediaRecord {
  key: string;
  uid: string;
  mediaId: string;
  requestId: string;
  captureSessionId: string;
  descriptor: CaptureAttachmentDescriptor;
  binding: CaptureBinding;
  blob?: Blob;
  stagingPath?: string;
  objectGeneration?: string;
  objectMd5Hash?: string;
  storagePath?: string;
  driveSyncState: DriveSyncState;
  retryCount: number;
  lastError?: string;
}

export interface OfflineQueuePort {
  putDraft(uid: string, draftId: string, draftVersion: number, value: Record<string, unknown>): Promise<void>;
  getDraft(uid: string, draftId: string): Promise<OfflineDraftRecord | undefined>;
  removeDraft(uid: string, draftId: string): Promise<void>;
  putSyncState(uid: string, state: Omit<CaptureSyncState, "uid">): Promise<void>;
  getSyncState(uid: string): Promise<CaptureSyncState | undefined>;
  enqueue(input: Omit<QueuedMediaRecord, "key" | "retryCount" | "driveSyncState">): Promise<void>;
  get(uid: string, mediaId: string): Promise<QueuedMediaRecord | undefined>;
  list(uid: string, captureSessionId?: string): Promise<QueuedMediaRecord[]>;
  listPending(uid: string): Promise<QueuedMediaRecord[]>;
  patch(uid: string, mediaId: string, patch: Partial<QueuedMediaRecord>): Promise<void>;
  markFinalized(uid: string, mediaId: string, result: { storagePath: string; driveSyncState: DriveSyncState }): Promise<void>;
  bindRegistration(uid: string, captureSessionId: string, ids: SaveFieldRegistrationResult): Promise<void>;
  countPending(uid: string): Promise<number>;
  deleteCompleted(uid: string, mediaId: string): Promise<void>;
  close(): void;
}
```

Define `OfflineDraftRecord` as `{ key: string; ownerUid: string; draftId: string; draftVersion: number; value: Record<string, unknown>; updatedAt: string }` and `CaptureSyncState` as `{ uid: string; lastAttemptAt?: string; lastSuccessAt?: string; pendingCount: number; lastError?: string }`. Every public lookup must build an owner key (`${uid}:${draftId}`, `${uid}:${mediaId}`, or `uid`) or query a UID index and then recheck the record owner; no method accepts an optional UID. `bindRegistration` must throw `capture_unit_binding_missing` when a queued `unitLocalId` has no entry in `unitIds`. `markFinalized` must commit the state change and `delete record.blob` in the same read-write transaction. `deleteCompleted` must reject any state other than `finalized` with Drive state `complete`.

`ensureCaptureCapacity` reserves `fileBytes + max(5 MiB, ceil(fileBytes * 0.05))`. If estimate data is unavailable, it permits the IndexedDB attempt; `enqueue` catches `QuotaExceededError` and rethrows `capture_storage_quota` without writing a descriptor. Export `requestPersistentCaptureStorage()` and call `navigator.storage.persist()` only from a user click handler.

- [ ] **Step 5: Run queue tests and typecheck**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/offline-queue.test.ts
pnpm --dir company-site typecheck:field
```

Expected: PASS; the account-isolation, quota, and Blob-removal assertions succeed.

- [ ] **Step 6: Commit the offline queue**

```bash
git add company-site/package.json company-site/pnpm-lock.yaml company-site/app/field/lib/offline-queue.ts company-site/tests/field/offline-queue.test.ts
git commit -m "feat(field): add isolated offline media queue"
```

### Task 3: Add idempotent standalone capture-session creation

**Files:**
- Create: `functions/src/field/start-capture-session.ts`
- Create: `functions/test/start-capture-session.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `company-site/app/field/lib/field-api.client.ts`

- [ ] **Step 1: Write failing core tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { startCaptureSessionCore } from "../src/field/start-capture-session.js";

const input = {
  requestId: "11111111-1111-4111-8111-111111111111",
  captureSessionId: "22222222-2222-4222-8222-222222222222",
  visitId: "33333333-3333-4333-8333-333333333333",
  buildingId: "building-1",
  unitId: "unit-1",
  listingId: "listing-1",
  visitType: "vacancyRefresh" as const,
};

it("creates one assigned visit, session, and audit patch", async () => {
  const write = vi.fn(async () => undefined);
  const result = await startCaptureSessionCore(input, { uid: "staff-1", role: "staff" }, {
    isEnabled: async () => true, isAssigned: async () => true, readSession: async () => null,
    readVisit: async () => null, writePatch: write, now: () => "2026-08-09T00:00:00.000Z",
  });
  expect(result).toEqual({ captureSessionId: input.captureSessionId, visitId: input.visitId });
  expect(write).toHaveBeenCalledWith(expect.objectContaining({
    [`fieldPlatform/captureSessions/${input.captureSessionId}`]: expect.objectContaining({ createdBy: "staff-1", status: "open" }),
    [`fieldPlatform/visits/${input.visitId}`]: expect.objectContaining({ assignedUserId: "staff-1" }),
  }));
});

it("returns an identical existing session without writing again", async () => {
  const write = vi.fn();
  await startCaptureSessionCore(input, { uid: "staff-1", role: "staff" }, {
    isEnabled: async () => true, isAssigned: async () => true,
    readSession: async () => ({ ...input, id: input.captureSessionId, createdBy: "staff-1", status: "open", createdAt: "x", updatedAt: "x" }),
    readVisit: async () => ({ id: input.visitId, buildingId: input.buildingId, assignedUserId: "staff-1" }),
    writePatch: write, now: () => "2026-08-09T00:00:00.000Z",
  });
  expect(write).not.toHaveBeenCalled();
});

it("rejects disabled, unassigned, and mismatched replay requests", async () => {
  const base = { isEnabled: async () => true, isAssigned: async () => false, readSession: async () => null,
    readVisit: async () => null, writePatch: vi.fn(), now: () => "x" };
  await expect(startCaptureSessionCore(input, { uid: "staff-1", role: "staff" }, base))
    .rejects.toThrow("field_building_assignment_required");
});
```

- [ ] **Step 2: Verify the test is red**

Run: `pnpm --dir functions exec vitest run test/start-capture-session.test.ts`

Expected: FAIL with `Cannot find module "../src/field/start-capture-session.js"`.

- [ ] **Step 3: Implement the pure session core and callable**

Export this API from `start-capture-session.ts`:

```ts
export interface StartCaptureSessionInput {
  requestId: string;
  captureSessionId: string;
  visitId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitType: "initial" | "vacancyRefresh";
}

export async function startCaptureSessionCore(
  input: StartCaptureSessionInput,
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
  dependencies: StartCaptureSessionDependencies,
): Promise<{ captureSessionId: string; visitId: string }>;
```

Validate all three request/entity IDs as UUIDs; reject reviewers; require `users/{uid}/enabled === true`; require assignment unless role is `admin`; ensure optional unit/listing records belong to the building; and compare every stable binding field on an existing session before treating a retry as successful. The first write must be one root multipath update containing the visit, capture session, and `auditLogs/capture-session-{requestId}`.

Export `startFieldCaptureSession` from `functions/src/index.ts` with:

```ts
onCall({ region: "asia-northeast3", enforceAppCheck: true, consumeAppCheckToken: true }, handler)
```

The handler maps identity/validation errors to `HttpsError("unauthenticated" | "permission-denied" | "invalid-argument" | "already-exists", code)` and delegates all decisions to the core.

Add a typed `startFieldCaptureSession(input)` wrapper to `field-api.client.ts` using `httpsCallable`; never accept a UID argument from the component.

- [ ] **Step 4: Verify server and client contracts**

Run:

```bash
pnpm --dir functions exec vitest run test/start-capture-session.test.ts
pnpm --dir functions build
pnpm --dir company-site typecheck:field
```

Expected: all three commands PASS.

- [ ] **Step 5: Commit session creation**

```bash
git add functions/src/field/start-capture-session.ts functions/test/start-capture-session.test.ts functions/src/index.ts company-site/app/field/lib/field-api.client.ts
git commit -m "feat(field): create capture sessions idempotently"
```

### Task 4: Implement server-authoritative media finalization and safe map projection

**Files:**
- Create: `functions/src/field/media-policy.ts`
- Create: `functions/src/field/finalize-field-media.ts`
- Create: `functions/test/finalize-field-media.test.ts`
- Modify without changing its public shape: `functions/src/field/map-projection.ts`

- [ ] **Step 1: Write failing finalizer tests for success, replay, and conflicts**

```ts
import { describe, expect, it, vi } from "vitest";
import { finalizeFieldMediaCore } from "../src/field/finalize-field-media.js";

const input = {
  requestId: "11111111-1111-4111-8111-111111111111",
  mediaId: "22222222-2222-4222-8222-222222222222",
  captureSessionId: "33333333-3333-4333-8333-333333333333",
  objectGeneration: "1740000000000000",
  stagingPath: "field-media/staff-1/33333333-3333-4333-8333-333333333333/photos/22222222-2222-4222-8222-222222222222.jpg",
  buildingId: "building-1", unitId: "unit-1", listingId: "listing-1", visitId: "visit-1",
  kind: "photo" as const, zone: "roomOverview" as const, slotId: "roomOverview-1",
  required: true, originalFileName: "room.jpg", capturedAt: "2026-08-09T00:00:00.000Z",
};

function dependencies(overrides = {}) {
  return {
    isEnabled: async () => true, isAssigned: async () => true,
    readVisit: async () => ({ id: "visit-1", buildingId: "building-1", unitId: "unit-1", listingId: "listing-1", assignedUserId: "staff-1" }),
    readSession: async () => ({ id: input.captureSessionId, buildingId: "building-1", visitId: "visit-1", createdBy: "staff-1", status: "open" }),
    readMedia: async () => null, listFinalizedSessionMedia: async () => [],
    inspectStagingObject: async () => ({ generation: input.objectGeneration, sizeBytes: 1024,
      contentType: "image/jpeg", md5Hash: "server-md5", crc32c: "server-crc",
      timeCreated: "2026-08-09T00:00:00.000Z",
      customMetadata: { capturedBy: "staff-1", mediaId: input.mediaId, captureSessionId: input.captureSessionId } }),
    copyToFinalized: vi.fn(async () => ({ path: `field-media-finalized/building-1/${input.mediaId}.jpg`, generation: "2" })),
    writePatch: vi.fn(async () => undefined), deleteStaging: vi.fn(async () => undefined),
    now: () => "2026-08-09T00:00:10.000Z", ...overrides,
  };
}

it("copies once and atomically queues media, audit, Drive, session, and projection records", async () => {
  const deps = dependencies();
  const result = await finalizeFieldMediaCore(input, { uid: "staff-1", role: "staff" }, deps);
  expect(result).toEqual(expect.objectContaining({ mediaId: input.mediaId, uploadState: "finalized", driveSyncState: "queued" }));
  expect(deps.writePatch).toHaveBeenCalledWith(expect.objectContaining({
    [`fieldPlatform/media/${input.mediaId}`]: expect.objectContaining({ objectMd5Hash: "server-md5", capturedBy: "staff-1" }),
    [`fieldPlatform/driveSyncJobs/${input.mediaId}`]: expect.objectContaining({ status: "queued" }),
    [`fieldPlatform/auditLogs/media-finalized-${input.requestId}`]: expect.objectContaining({ action: "media.finalized" }),
    [`fieldPlatform/captureSessions/${input.captureSessionId}/updatedAt`]: "2026-08-09T00:00:10.000Z",
    [`fieldPlatform/mapProjections/building-1`]: expect.objectContaining({ captureStatus: "inProgress" }),
  }));
  expect(deps.deleteStaging).toHaveBeenCalledWith(input.stagingPath, input.objectGeneration);
});

it("returns the existing result after an ACK loss without copying or writing again", async () => {
  const existing = { id: input.mediaId, requestId: input.requestId, capturedBy: "staff-1",
    captureSessionId: input.captureSessionId, buildingId: input.buildingId, uploadState: "finalized",
    driveSyncState: "queued", storagePath: `field-media-finalized/building-1/${input.mediaId}.jpg` };
  const deps = dependencies({ readMedia: async () => existing });
  await expect(finalizeFieldMediaCore(input, { uid: "staff-1", role: "staff" }, deps))
    .resolves.toEqual(expect.objectContaining({ mediaId: input.mediaId, uploadState: "finalized" }));
  expect(deps.copyToFinalized).not.toHaveBeenCalled();
  expect(deps.writePatch).not.toHaveBeenCalled();
});

it.each([
  ["generation", { inspectStagingObject: async () => ({ ...(await dependencies().inspectStagingObject()), generation: "wrong" }) }, "field_media_generation_mismatch"],
  ["assignment", { isAssigned: async () => false }, "field_building_assignment_required"],
  ["mime", { inspectStagingObject: async () => ({ ...(await dependencies().inspectStagingObject()), contentType: "image/svg+xml" }) }, "field_media_mime_not_allowed"],
])("rejects %s conflicts before the database patch", async (_name, override, code) => {
  const deps = dependencies(override);
  await expect(finalizeFieldMediaCore(input, { uid: "staff-1", role: "staff" }, deps)).rejects.toThrow(code);
  expect(deps.writePatch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the finalizer test and confirm the missing-module failure**

Run: `pnpm --dir functions exec vitest run test/finalize-field-media.test.ts`

Expected: FAIL because `finalize-field-media.ts` is absent.

- [ ] **Step 3: Implement the server policy and core API**

`media-policy.ts` must contain the same seven MIME mappings and two limits as Task 1, an RFC 4122 UUID validator, and these functions:

```ts
export function validateFinalizeInput(input: FinalizeFieldMediaInput): void;
export function validateStoredObject(input: FinalizeFieldMediaInput, actorUid: string, object: StoredObject): void;
export function finalizedPath(buildingId: string, mediaId: string, contentType: string): string;
```

Reject traversal, a filename-derived path, non-UUID session/media/request IDs, an unapproved MIME, a mismatched `kind`, size above 25 MiB/500 MiB, generation mismatch, custom metadata mismatch, and an invalid ISO `capturedAt`. Limit `slotId` to `[A-Za-z0-9_-]{1,80}` and strip directory segments from `originalFileName` before storing at most 255 characters.

Export these exact finalizer contracts:

```ts
export interface FinalizeFieldMediaInput {
  requestId: string; mediaId: string; captureSessionId: string; objectGeneration: string;
  stagingPath: string; buildingId: string; unitId?: string; listingId?: string; visitId: string;
  kind: "photo" | "video"; zone: MediaZone; slotId: string; required: boolean;
  originalFileName: string; capturedAt: string; replacesMediaId?: string;
  videoMetadata?: { durationSeconds: number; width: number; height: number };
}

export interface FinalizeFieldMediaResult {
  mediaId: string; uploadState: "finalized"; storagePath: string;
  driveSyncState: "queued"; finalizedAt: string;
}

export async function finalizeFieldMediaCore(
  input: FinalizeFieldMediaInput,
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
  dependencies: FinalizeFieldMediaDependencies,
): Promise<FinalizeFieldMediaResult>;
```

The core order is fixed:

1. Validate input and require enabled staff/admin plus building assignment (admin bypasses assignment; reviewer is rejected).
2. If `media/{mediaId}` already exists, return only when `requestId`, UID, session, visit, building, and IDs all match; otherwise throw `field_media_id_conflict`.
3. Verify visit/session/unit/listing bindings and inspect the exact staging generation.
4. Copy with destination precondition `ifGenerationMatch: 0` to `field-media-finalized/{buildingId}/{mediaId}.{ext}`. If it exists, verify source MD5/CRC32C and size before reusing it.
5. Read the building and its listings/finalized media, append the new media in memory, compute the current session's required zone/minimum counts, set the capture session to `complete` only when all requirements pass (otherwise keep `open`), call the foundation's `buildMapProjection`, and build one root multipath update containing the immutable finalized `MediaRecord`, `auditLogs/media-finalized-{requestId}`, `driveSyncJobs/{mediaId}`, capture-session timestamp/status, and the complete safe projection at `mapProjections/{buildingId}` when the helper returns a value.
6. Commit the patch, then best-effort delete the exact staging generation. A delete failure does not undo the committed record; the scheduled cleanup owns that residue.

Never calculate a whole-file browser hash on the server input. Store Admin Storage’s MD5/CRC32C as integrity evidence. Re-evaluate supplied finite video metadata on the server: only 10–20 seconds with `height > width` receives `captureQualityState: "valid"`; an absent/invalid/out-of-range video receives `warning` and cannot satisfy the required vertical-video count, though the original still finalizes. Photos receive `valid`. The final database media record uses `uploadProgress: 100`, `uploadState: "finalized"`, `driveSyncState: "queued"`, and never stores a signed URL or Firebase download token.

- [ ] **Step 4: Preserve the managed-map projection contract**

Import and extend the foundation's existing `buildMapProjection({ building, listings, media, updatedAt })` without changing its flat `captureStatus: "notStarted" | "inProgress" | "complete"` contract or adding media details to the projection. Use the server `MEDIA_POLICY` required zones and minimum counts, group finalized non-excluded media by `captureSessionId`, and return `complete` only when at least one session satisfies every required zone/minimum. Return `notStarted` when no finalized media exists and `inProgress` otherwise. Assert all three cases in `finalize-field-media.test.ts`, including that one finalized file remains `inProgress`. Also assert that the finalizer writes a full allowlisted projection with exactly the foundation's eleven keys and that its serialized form omits `originalFileName`, `storagePath`, `capturedBy`, notes, contacts, and URLs.

- [ ] **Step 5: Run focused server tests and build**

Run:

```bash
pnpm --dir functions exec vitest run test/finalize-field-media.test.ts
pnpm --dir functions build
```

Expected: PASS; the generated patch assertions and strict TypeScript build both succeed.

- [ ] **Step 6: Commit the finalizer core**

```bash
git add functions/src/field/media-policy.ts functions/src/field/finalize-field-media.ts functions/src/field/map-projection.ts functions/test/finalize-field-media.test.ts
git commit -m "feat(field): finalize media atomically"
```

### Task 5: Protect finalization and issue short-lived finalized-media access

**Files:**
- Create: `functions/src/security/rate-limit.ts`
- Create: `functions/src/field/get-field-media-access.ts`
- Create: `functions/src/field/exclude-field-media.ts`
- Create: `functions/test/rate-limit.test.ts`
- Create: `functions/test/get-field-media-access.test.ts`
- Create: `functions/test/exclude-field-media.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `company-site/app/field/lib/field-api.client.ts`

- [ ] **Step 1: Write failing rate-limit and access tests**

```ts
it("allows 60 media calls per UID/session in ten minutes and rejects the 61st", async () => {
  const limiter = createInMemoryRateLimiter({ limit: 60, windowMs: 600_000, now: () => 1_000 });
  for (let index = 0; index < 60; index += 1) await limiter.consume("u1", "s1");
  await expect(limiter.consume("u1", "s1")).rejects.toThrow("field_rate_limit_exceeded");
  await expect(limiter.consume("u2", "s1")).resolves.toBeUndefined();
});

it("issues a five-minute URL only for finalized media and current authority", async () => {
  const signReadUrl = vi.fn(async (_path: string, expiresAt: number) => `https://signed.example/${expiresAt}`);
  const result = await getFieldMediaAccessCore({ mediaId: "media-1" }, { uid: "staff-1", role: "staff" }, {
    isEnabled: async () => true, readMedia: async () => ({ id: "media-1", buildingId: "b1",
      uploadState: "finalized", storagePath: "field-media-finalized/b1/media-1.jpg" }),
    isAssigned: async () => true, signReadUrl, nowMs: () => 1_000,
  });
  expect(result).toEqual({ url: "https://signed.example/301000", expiresAt: "1970-01-01T00:05:01.000Z" });
  expect(signReadUrl).toHaveBeenCalledWith("field-media-finalized/b1/media-1.jpg", 301_000);
});

it("denies staging, unassigned staff, and disabled users", async () => {
  const dependencies = { isEnabled: async () => true, isAssigned: async () => false,
    readMedia: async () => ({ id: "m1", buildingId: "b1", uploadState: "objectStored",
      storagePath: "field-media/u1/s1/photos/m1.jpg" }), signReadUrl: vi.fn(), nowMs: () => 1_000 };
  await expect(getFieldMediaAccessCore({ mediaId: "m1" }, { uid: "staff-1", role: "staff" }, dependencies))
    .rejects.toThrow("field_media_not_finalized");
});

it("excludes finalized media with an audit update but never deletes the object", async () => {
  const writePatch = vi.fn(async () => undefined);
  const deleteObject = vi.fn();
  await excludeFieldMediaCore({ mediaId: UUID_1, requestId: UUID_2 },
    { uid: "staff-1", role: "staff" }, {
      isEnabled: async () => true, isAssigned: async () => true,
      readMedia: async () => ({ id: UUID_1, buildingId: "b1", uploadState: "finalized" }),
      writePatch, deleteObject, now: () => "2026-08-09T00:00:00.000Z",
    });
  expect(writePatch).toHaveBeenCalledWith(expect.objectContaining({
    [`fieldPlatform/media/${UUID_1}/excludedAt`]: "2026-08-09T00:00:00.000Z",
    [`fieldPlatform/media/${UUID_1}/excludedBy`]: "staff-1",
    [`fieldPlatform/auditLogs/media-excluded-${UUID_2}`]: expect.objectContaining({ action: "media.excluded" }),
  }));
  expect(deleteObject).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify both new tests fail**

Run: `pnpm --dir functions exec vitest run test/rate-limit.test.ts test/get-field-media-access.test.ts test/exclude-field-media.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement the limiter and access core**

`rate-limit.ts` must export `consumeRateLimit(ref, { limit, windowMs, nowMs })`; use one Realtime Database transaction at `fieldPlatform/rateLimits/{operation}/{uid}/{sessionId}` with `{ windowStartedAt, count }`. Reset after the window, abort the transaction at the limit, and surface `field_rate_limit_exceeded`. Export the in-memory adapter only for deterministic unit tests.

`get-field-media-access.ts` must export:

```ts
export async function getFieldMediaAccessCore(
  input: { mediaId: string },
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
  dependencies: FieldMediaAccessDependencies,
): Promise<{ url: string; expiresAt: string }>;
```

Require `enabled === true`; require `uploadState === "finalized"`; require a `field-media-finalized/` path; allow admin/reviewer or currently assigned staff; issue exactly five minutes; and never write the URL to Database, Storage metadata, logs, IndexedDB, or localStorage.

`exclude-field-media.ts` exports `excludeFieldMediaCore({ mediaId, requestId }, actor, dependencies)`. It requires an enabled current assignee or admin/reviewer, requires a finalized record, and writes `excludedAt`, `excludedBy`, an idempotent `media-excluded-{requestId}` audit event, and a rebuilt safe map projection in one root update. A repeated identical request returns success; a reused request ID for another media item fails. It never calls Storage delete and never changes the Drive object. When finalizing a replacement whose `replacesMediaId` is set, `finalizeFieldMediaCore` applies this same exclusion fields/audit rule in its existing atomic patch.

- [ ] **Step 4: Wire callables with App Check and rate limits**

In `functions/src/index.ts`, export `finalizeFieldMedia`, `getFieldMediaAccess`, and `excludeFieldMedia` with the same `onCall` options as Task 3. Before calling their cores, check auth, enabled status, and consume:

```ts
await consumeRateLimit(rateRef("finalize", uid, input.captureSessionId), { limit: 60, windowMs: 600_000, nowMs: Date.now() });
await consumeRateLimit(rateRef("mediaAccess", uid, input.mediaId), { limit: 120, windowMs: 600_000, nowMs: Date.now() });
```

Use Admin Storage `getMetadata`, generation-matched copy/delete, and V4 signed `read` URLs. Map finalizer errors to stable callable codes; do not expose raw GCS messages.

In `field-api.client.ts`, add typed `finalizeFieldMedia(input)`, `getFieldMediaAccess(mediaId)`, and `excludeFieldMedia({ mediaId, requestId })` wrappers. Do not import or call `getDownloadURL` anywhere under `app/field`.

- [ ] **Step 5: Run tests, build, and assert the forbidden API is absent**

Run:

```bash
pnpm --dir functions exec vitest run test/rate-limit.test.ts test/get-field-media-access.test.ts test/exclude-field-media.test.ts test/finalize-field-media.test.ts
pnpm --dir functions build
pnpm --dir company-site typecheck:field
rg -n "getDownloadURL" company-site/app/field
```

Expected: tests/build/typecheck PASS; `rg` exits 1 with no matches.

- [ ] **Step 6: Commit callable protection and media access**

```bash
git add functions/src/security/rate-limit.ts functions/src/field/get-field-media-access.ts functions/src/field/exclude-field-media.ts functions/src/index.ts functions/test/rate-limit.test.ts functions/test/get-field-media-access.test.ts functions/test/exclude-field-media.test.ts company-site/app/field/lib/field-api.client.ts
git commit -m "security(field): protect media finalization and access"
```

### Task 6: Enforce server ownership and create-only Storage staging

**Files:**
- Modify: `storage.rules`
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/storage-rules.test.ts`
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] **Step 1: Extend emulator tests before changing rules**

Use valid UUID paths and exact custom metadata in all successful uploads:

```ts
const sessionId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const photoPath = `field-media/staff-1/${sessionId}/photos/${mediaId}.jpg`;
const metadata = { contentType: "image/jpeg", customMetadata: {
  capturedBy: "staff-1", captureSessionId: sessionId, mediaId,
} };

await assertSucceeds(uploadBytes(ref(staffStorage, photoPath), new Uint8Array(1024), metadata));
await assertFails(uploadBytes(ref(staffStorage, photoPath), new Uint8Array(1024), metadata));
await assertFails(deleteObject(ref(staffStorage, photoPath)));
await assertSucceeds(getMetadata(ref(staffStorage, photoPath)));
await assertFails(getMetadata(ref(reviewerStorage, photoPath)));
await assertFails(uploadBytes(ref(staffStorage,
  `field-media/staff-1/${sessionId}/photos/not-a-uuid.jpg`), new Uint8Array(10), metadata));
await assertFails(uploadBytes(ref(staffStorage,
  `field-media/staff-1/${sessionId}/photos/${crypto.randomUUID()}.svg`), new Uint8Array(10),
  { ...metadata, contentType: "image/svg+xml" }));
```

Seed a finalized object under `field-media-finalized/building-1/{mediaId}.jpg` with rules disabled, then assert staff, reviewer, and admin direct `getMetadata` calls all fail. In Database tests, seed media/capture-session/outbox/projection records with rules disabled; assert assigned staff can read its session/finalized media, reviewer can read finalized media metadata, unassigned staff cannot read it, and every client role fails to write `media`, `auditLogs`, `driveSyncJobs`, `captureSessions/*/status`, or `mapProjections`.

- [ ] **Step 2: Run the rule tests and observe the existing permissive failures**

Run:

```bash
pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-field-platform emulators:exec --only database,storage "pnpm test:rules"
```

Expected: FAIL because current Storage permits update and reviewer/admin staging reads, accepts broad `image/*`, and current Database permits client media writes.

- [ ] **Step 3: Replace Storage rules with exact create-only policy**

Keep a separate match for photos and videos. Each `allow create` must require:

```text
request.auth != null
request.auth.token.fieldPlatform == true
request.auth.uid == uid
captureSessionId is an RFC 4122 UUID
fileName is an RFC 4122 UUID plus an allowed lowercase extension
request.resource.contentType is exactly in the approved MIME list
request.resource.size is within the approved limit
request.resource.metadata.capturedBy == uid
request.resource.metadata.captureSessionId == captureSessionId
request.resource.metadata.mediaId == the filename UUID
```

Allow staging `read` only to the matching uploader. Declare no `update` or `delete` grant. Add an explicit `match /field-media-finalized/{allPaths=**} { allow read, write: if false; }`. Remove reviewer/admin access to every staging prefix.

- [ ] **Step 4: Make server-owned Database paths immutable to clients**

Under `fieldPlatform`, set `.write: false` for `media`, `auditLogs`, `driveSyncJobs`, `mapProjections`, and final capture-session fields. Media/session reads must require `isEnabled()` from the foundation and one of: current building assignment, record owner for an open session, reviewer, or admin. Do not grant reviewers building secrets or owner notes. Add validation for the six upload states, five Drive states, `uploadProgress` integer `0..100`, path/UID/session equality, and immutable IDs. Keep the server using Admin SDK, which bypasses these client rules.

- [ ] **Step 5: Re-run both emulator suites**

Run:

```bash
pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-field-platform emulators:exec --only database,storage "pnpm test:rules"
```

Expected: PASS with no skipped rule suite and exit code 0.

- [ ] **Step 6: Commit the rule boundary**

```bash
git add storage.rules database.rules.json company-site/tests/field/storage-rules.test.ts company-site/tests/field/database-rules.test.ts
git commit -m "security(field): lock media staging and records"
```

### Task 7: Reconcile and upload the offline queue sequentially

**Files:**
- Create: `company-site/app/field/lib/media-upload.ts`
- Create: `company-site/tests/field/media-upload.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

```ts
it("uploads a missing object, finalizes it, then drops the local Blob", async () => {
  const queue = createQueueWith(queuedPhoto());
  const port = { inspect: vi.fn(async () => null), upload: vi.fn(async (_item, progress) => {
      progress(50); progress(100); return matchingObject({ generation: "7" });
    }), finalize: vi.fn(async () => ({ mediaId: "m1", uploadState: "finalized",
      storagePath: "field-media-finalized/b1/m1.jpg", driveSyncState: "queued", finalizedAt: NOW })) };
  const coordinator = new MediaUploadCoordinator(queue, port, { isOnline: () => true });
  await coordinator.resume("u1");
  expect(port.upload).toHaveBeenCalledOnce();
  expect(port.finalize).toHaveBeenCalledWith(expect.objectContaining({ objectGeneration: "7" }));
  expect((await queue.get("u1", "m1"))?.blob).toBeUndefined();
});

it("recovers after reload by finalizing a matching completed staging object", async () => {
  const queue = createQueueWith(queuedPhoto());
  const port = { inspect: vi.fn(async () => matchingObject({ generation: "8" })), upload: vi.fn(),
    finalize: vi.fn(async () => finalizedResult()) };
  await new MediaUploadCoordinator(queue, port, { isOnline: () => true }).resume("u1");
  expect(port.upload).not.toHaveBeenCalled();
  expect(port.finalize).toHaveBeenCalledWith(expect.objectContaining({ objectGeneration: "8" }));
});

it("replays finalization before inspection after an ACK loss", async () => {
  const queue = createQueueWith(queuedPhoto({ uploadState: "finalizing", objectGeneration: "8" }));
  const port = { inspect: vi.fn(), upload: vi.fn(), finalize: vi.fn(async () => finalizedResult()) };
  await new MediaUploadCoordinator(queue, port, { isOnline: () => true }).resume("u1");
  expect(port.finalize).toHaveBeenCalledWith(expect.objectContaining({ objectGeneration: "8" }));
  expect(port.inspect).not.toHaveBeenCalled();
  expect(port.upload).not.toHaveBeenCalled();
});

it("never overwrites a mismatched stable path and never processes another UID", async () => {
  const queue = createQueueWith(queuedPhoto(), queuedPhoto({ uid: "u2", mediaId: "m2" }));
  const port = { inspect: vi.fn(async () => matchingObject({ sizeBytes: 999 })), upload: vi.fn(), finalize: vi.fn() };
  await new MediaUploadCoordinator(queue, port, { isOnline: () => true }).resume("u1");
  expect((await queue.get("u1", "m1"))?.lastError).toBe("storage_object_conflict");
  expect(port.upload).not.toHaveBeenCalled();
  expect(await queue.get("u2", "m2")).toEqual(expect.objectContaining({ descriptor: expect.objectContaining({ uploadState: "queued" }) }));
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --dir company-site exec vitest run tests/field/media-upload.test.ts`

Expected: FAIL because `media-upload.ts` is absent.

- [ ] **Step 3: Implement the port, Firebase adapter, and coordinator**

Export these contracts:

```ts
export interface StoredMediaObject {
  path: string; generation: string; sizeBytes: number; contentType: string;
  timeCreated: string; md5Hash?: string; crc32c?: string; customMetadata: Record<string, string>;
}
export interface MediaUploadPort {
  inspect(path: string): Promise<StoredMediaObject | null>;
  upload(item: QueuedMediaRecord, onProgress: (percent: number) => void): Promise<StoredMediaObject>;
  finalize(input: FinalizeFieldMediaInput): Promise<FinalizeFieldMediaResult>;
}
export class MediaUploadCoordinator {
  constructor(queue: OfflineQueuePort, port: MediaUploadPort, environment?: { isOnline(): boolean });
  start(uid: string): () => void;
  resume(uid: string): Promise<void>;
  retry(uid: string, mediaId: string): Promise<void>;
}
```

The Firebase adapter uses `getMetadata` and `uploadBytesResumable` against Task 1’s stable staging path. Upload custom metadata contains only `capturedBy`, `captureSessionId`, and `mediaId`; GCS `timeCreated` is the trusted lifecycle timestamp. It never contains building-owner notes, access codes, signed URLs, or user-controlled path segments.

Process one large file at a time. Persist `objectGeneration` and state `finalizing` in IndexedDB before invoking the finalizer. On restart, an `objectStored`/`finalizing` item with a generation calls the idempotent finalizer first, before Storage inspection; this recovers an ACK loss even when the server already deleted staging. For `queued`/upload failures, reconcile before every upload. A matching object requires exact size, MIME, media ID, session ID, and captured UID; then transition `queued/failed -> objectStored -> finalizing -> finalized` without uploading. A missing object requires a Blob and uploads from byte zero after a browser restart. A conflicting object sets `failed/storage_object_conflict`; `retry` clones the same Blob under a fresh media UUID and marks the old descriptor excluded/replaced instead of overwriting. A network/permission failure increments `retryCount`, retains the Blob, and maps to `network_retry`, `field_claim_required`, or `storage_upload_failed`.

`start(uid)` calls `resume(uid)` immediately, again on `window.online`, and returns a cleanup that removes the listener and prevents stale UID work from committing. It must never rely solely on Background Sync.

Before and after each resume pass, write the active UID's `CaptureSyncState`: set `lastAttemptAt`, exact `pendingCount`, and redacted `lastError`; on a pass with no failures set `lastSuccessAt`. Never aggregate another UID's records into these counts.

- [ ] **Step 4: Add the finalized Drive reconciliation hook**

Add `subscribeMediaRecord(mediaId, listener)` to `field-api.client.ts` in the implementation step. When a finalized server record reaches `driveSyncState: "complete"`, call `queue.deleteCompleted(uid, mediaId)`; on `failed`, retain descriptor metadata and expose retry state. Do not restore or retain the Blob after server finalization.

- [ ] **Step 5: Run upload, queue, and type tests**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/media-upload.test.ts tests/field/offline-queue.test.ts
pnpm --dir company-site typecheck:field
```

Expected: PASS; reload reconciliation skips upload, cross-UID work is untouched, and finalized Blob deletion is verified.

- [ ] **Step 6: Commit upload reconciliation**

```bash
git add company-site/app/field/lib/media-upload.ts company-site/app/field/lib/field-api.client.ts company-site/tests/field/media-upload.test.ts
git commit -m "feat(field): reconcile and upload captured media"
```

### Task 8: Build the shared native-camera CaptureGuide

**Files:**
- Create: `company-site/app/field/components/CaptureGuide.tsx`
- Create: `company-site/tests/field/capture-components.test.tsx`
- Modify: `company-site/tests/field/setup.ts`
- Modify: `company-site/app/field/field.css`

- [ ] **Step 1: Add browser shims and failing component tests**

In `setup.ts`, install deterministic `URL.createObjectURL`, `URL.revokeObjectURL`, `navigator.storage.estimate`, and `navigator.storage.persist` mocks, restoring them after each test. Then add:

```tsx
it("renders native rear-camera photo and video inputs", async () => {
  render(<CaptureGuide context={draftContext} queue={queue} coordinator={coordinator} />);
  expect(screen.getByLabelText("외관 사진 촬영")).toHaveAttribute("accept", "image/*");
  expect(screen.getByLabelText("외관 사진 촬영")).toHaveAttribute("capture", "environment");
  expect(screen.getByLabelText("10~20초 세로영상 촬영")).toHaveAttribute("accept", "video/*");
  expect(screen.getByLabelText("10~20초 세로영상 촬영")).toHaveAttribute("capture", "environment");
});

it("shows saved status only after the IndexedDB commit and resets the input", async () => {
  const enqueue = vi.fn(async () => undefined);
  render(<CaptureGuide context={draftContext} queue={{ ...queue, enqueue }} coordinator={coordinator} />);
  const input = screen.getByLabelText("외관 사진 촬영") as HTMLInputElement;
  const file = new File(["photo"], "outside.jpg", { type: "image/jpeg", lastModified: 1 });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByText("기기에 저장됨 · 서버 등록 대기")).toBeInTheDocument();
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ uid: "staff-1", blob: file }));
  expect(input.value).toBe("");
});

it("revokes every preview URL after replace, exclude, account change, and unmount", async () => {
  const view = render(<FieldSessionProvider session={staffOne}>
    <CaptureGuide context={draftContext} queue={queueWithPhoto} coordinator={coordinator} />
  </FieldSessionProvider>);
  await screen.findByAltText("외관 미리보기");
  fireEvent.click(screen.getByRole("button", { name: "외관 사진 제외" }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
  view.rerender(<FieldSessionProvider session={staffTwo}>
    <CaptureGuide context={draftContext} queue={queue} coordinator={coordinator} />
  </FieldSessionProvider>);
  expect(screen.queryByAltText("외관 미리보기")).not.toBeInTheDocument();
  view.unmount();
});

it("keeps an invalid vertical video but excludes it from required completion", async () => {
  render(<CaptureGuide context={draftContext} queue={queueWithVideo} coordinator={coordinator} />);
  fireEvent.loadedMetadata(screen.getByLabelText("세로영상 미리보기"), {
    target: { duration: 8, videoWidth: 1920, videoHeight: 1080 },
  });
  expect(screen.getByText("영상은 10~20초로 촬영해 주세요.")).toBeInTheDocument();
  expect(screen.getByText("휴대전화를 세로로 들고 촬영해 주세요.")).toBeInTheDocument();
  expect(screen.getByText(/필수 촬영 미완료/)).toBeInTheDocument();
});

it("requests a short-lived preview for finalized media without persisting the URL", async () => {
  const getFieldMediaAccess = vi.fn(async () => ({ url: "https://signed.example/temporary",
    expiresAt: "2026-08-09T00:05:00.000Z" }));
  render(<CaptureGuide context={visitContext} queue={queueWithFinalizedDescriptor}
    coordinator={coordinator} getFieldMediaAccess={getFieldMediaAccess} />);
  expect(await screen.findByAltText("외관 미리보기")).toHaveAttribute("src", "https://signed.example/temporary");
  expect(getFieldMediaAccess).toHaveBeenCalledWith(FINALIZED_MEDIA_ID);
  expect(JSON.stringify(await queueWithFinalizedDescriptor.get("staff-1", FINALIZED_MEDIA_ID)))
    .not.toContain("signed.example");
});
```

- [ ] **Step 2: Run the component test and verify the missing component**

Run: `pnpm --dir company-site exec vitest run tests/field/capture-components.test.tsx`

Expected: FAIL because `CaptureGuide.tsx` is absent.

- [ ] **Step 3: Implement one shared component API**

```ts
export type CaptureContext =
  | { mode: "draft"; draftId: string; captureSessionId: string; unitLocalId: string }
  | { mode: "visit"; captureSessionId: string; buildingId: string; unitId?: string; listingId?: string; visitId: string };

export interface CaptureGuideProps {
  context: CaptureContext;
  queue?: OfflineQueuePort;
  coordinator?: MediaUploadCoordinator;
  onDescriptorsChange?: (descriptors: CaptureAttachmentDescriptor[]) => void;
  getFieldMediaAccess?: (mediaId: string) => Promise<{ url: string; expiresAt: string }>;
}
```

`CaptureGuide` obtains UID only from `useFieldSession()`, loads only `queue.list(session.uid, context.captureSessionId)`, and clears all local state/object URLs whenever UID or captureSessionId changes. Render `CAPTURE_ZONES` in order. Each card must show guide text, required/optional badge, valid count/minimum, queue/upload/finalization status, camera button, previews, replace, exclude, and failed-item retry. For video, create the preview, await `loadedmetadata` (with a five-second timeout), then persist only finite `durationSeconds`, `videoWidth`, and `videoHeight` in the same enqueue transaction; a timeout queues the original with missing metadata and a warning. Use `evaluateVerticalVideo` to decide the UI's valid required count and send those numbers to the finalizer for server re-evaluation. Do not start that video's upload until this enqueue transaction commits.

Render the file controls literally as:

```tsx
<input className="field-sr-only" type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
<input className="field-sr-only" type="file" accept="video/*" capture="environment" onChange={handleVideo} />
```

Photo preview uses `<img>` only when the browser can decode it; HEIC/HEIF falls back to filename, formatted size, and status. Video uses:

```tsx
<video aria-label="세로영상 미리보기" controls playsInline preload="metadata" src={previewUrl} />
```

For a finalized descriptor whose Blob is already removed, request Task 5's five-minute access URL on demand, hold it only in component memory, and refresh it no earlier than 30 seconds before `expiresAt` while the preview remains mounted. Drop it on session/media change and unmount. Never place the signed URL in props callbacks, queue patches, draft JSON, service-worker cache, logs, or DOM data attributes beyond the media element's transient `src`.

Camera cancel (`files.length === 0`) leaves state unchanged and shows no error. Before enqueue, call `ensureCaptureCapacity`; after a successful user click, offer `requestPersistentCaptureStorage`. Only the resolved IndexedDB transaction may produce “기기에 저장됨 · 서버 등록 대기”. Online finalization produces “서버 등록 완료”; neither phrase may imply Drive completion.

Replacing always creates a new `mediaId` and `requestId`, sets `replacesMediaId` on the new descriptor, and excludes the old descriptor; it never updates an existing Storage object. Excluding an already finalized item calls Task 5's `excludeFieldMedia({ mediaId, requestId })`, which updates only server-owned exclusion metadata, its audit record, and the safe projection after current authorization; it never deletes either Storage or Drive originals.

- [ ] **Step 4: Style responsive capture cards**

Add `.field-capture-guide`, `.field-capture-zone-grid`, `.field-capture-zone`, `.field-capture-preview-grid`, `.field-upload-state`, and `.field-capture-warning`. At 320 px, cards are one column, buttons have at least 44 px hit targets, media never exceeds container width, and the final card remains reachable above the fixed wizard/mobile navigation safe area. At 960 px, use two cards per row; do not add horizontal scrolling.

- [ ] **Step 5: Run focused UI tests and accessibility/type checks**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/capture-components.test.tsx tests/field/offline-queue.test.ts
pnpm --dir company-site typecheck:field
pnpm --dir company-site lint
```

Expected: PASS; native input attributes, status timing, video warning, and URL cleanup are all asserted.

- [ ] **Step 6: Commit the shared guide**

```bash
git add company-site/app/field/components/CaptureGuide.tsx company-site/app/field/field.css company-site/app/field/lib/field-api.client.ts company-site/tests/field/capture-components.test.tsx company-site/tests/field/setup.ts functions/src/index.ts
git commit -m "feat(field): add guided native camera capture"
```

### Task 9: Connect CaptureGuide to registration and bind saved IDs safely

**Files:**
- Modify: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/lib/registration-draft.ts`
- Modify: `company-site/tests/field/registration-draft.test.ts`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing wizard integration tests**

```tsx
it("uses CaptureGuide in step five and persists descriptors without binary data", async () => {
  render(<FieldSessionProvider session={staffOne}>
    <BuildingWizard draftKey="capture-wizard" initialStep={4} queue={queue} coordinator={coordinator} />
  </FieldSessionProvider>);
  expect(screen.getByLabelText("외관 사진 촬영")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("외관 사진 촬영"), {
    target: { files: [new File(["x"], "outside.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText("기기에 저장됨 · 서버 등록 대기");
  const saved = allRegistrationDraftStorageForUid(window.localStorage, "staff-1").join("\n");
  expect(saved).toContain("captureSessionId");
  expect(saved).toContain("outside.jpg");
  expect(saved).not.toMatch(/blob:|data:|base64/);
});

it("saves registration, creates the server session, binds unit IDs, then resumes uploads in order", async () => {
  const events: string[] = [];
  render(<RegisteredFieldApp dependencies={{
    saveFieldRegistration: async () => { events.push("save"); return { buildingId: "b1", unitIds: { "unit-1": "u1" }, listingId: "l1", visitId: "v1" }; },
    startFieldCaptureSession: async () => { events.push("session"); return { captureSessionId: "s1", visitId: "v1" }; },
    bindRegistration: async () => { events.push("bind"); }, resume: async () => { events.push("resume"); },
  }} />);
  fireEvent.click(screen.getByRole("button", { name: "등록 내용 저장" }));
  await waitFor(() => expect(events).toEqual(["save", "session", "bind", "resume"]));
});
```

Define `allRegistrationDraftStorageForUid(storage, uid)` in the test file by iterating `storage.key(index)`, selecting versioned keys that start with `bring-field-wizard:v` and contain `:${encodeURIComponent(uid)}:`, and returning their non-null values. Ignore the separate `bring-field-wizard:active:${encodeURIComponent(uid)}` pointer. This is test inspection only; production code continues to use `registration-draft.ts` helpers.

- [ ] **Step 2: Verify the new integration assertions fail**

Run: `pnpm --dir company-site exec vitest run tests/field/components.test.tsx -t "CaptureGuide|binds unit IDs"`

Expected: FAIL because step five still contains “다음 기능에서 촬영 체크리스트가 연결됩니다.”

- [ ] **Step 3: Add descriptors and the shared guide to the draft**

In the foundation's `registration-draft.ts`, bump `REGISTRATION_DRAFT_VERSION` from 3 to 4 and add stable `captureSessionId` plus `captureAttachments: CaptureAttachmentDescriptor[]`. Preserve the existing `draftId`, `requestId`, `primaryUnitLocalId`, `ownerNoteDrafts`, UID-scoped envelope keys, and malformed/legacy migration behavior. Generate the capture-session UUID only when absent; filter restored descriptors through a strict serializable-shape guard and never replace valid media IDs. Add migration tests proving a version-3 owner-note draft becomes version 4 with an empty attachment list and unchanged IDs. On each successful envelope save, also call `queue.putDraft(session.uid, draft.draftId, 4, serializableDraft)`; on startup use that UID-matched IDB record only as fallback when the canonical localStorage envelope is absent/corrupt. Remove both copies after successful registration binding. Replace the step-4 placeholder with:

```tsx
<CaptureGuide
  context={{ mode: "draft", draftId: draft.draftId, captureSessionId: draft.captureSessionId,
    unitLocalId: draft.primaryUnitLocalId }}
  queue={queue}
  coordinator={coordinator}
  onDescriptorsChange={(captureAttachments) => setDraft((current) => ({ ...current, captureAttachments }))}
/>
```

The wizard review lists per-zone counts and distinguishes “기기 저장·서버 대기”, “서버 등록 완료”, and “Drive 동기화 완료”. Missing required media is a warning, not a reason to discard the rest of the registration draft.

- [ ] **Step 4: Implement the fixed completion order**

In `FieldApp`, pass the foundation save input unchanged plus `primaryUnitLocalId`. After it returns:

```ts
const ids = await saveFieldRegistration(input);
await startFieldCaptureSession({
  requestId: crypto.randomUUID(), captureSessionId: draft.captureSessionId,
  visitId: ids.visitId, buildingId: ids.buildingId,
  unitId: ids.unitIds[draft.primaryUnitLocalId], listingId: ids.listingId, visitType: "initial",
});
await queue.bindRegistration(session.uid, draft.captureSessionId, ids);
await coordinator.resume(session.uid);
```

If save/session/bind fails, retain the draft and queue unchanged, show the specific recoverable code, and let the stable `draftId`, captureSessionId, request IDs, and media IDs make a retry idempotent. Clear the local form draft only after registration/session binding succeeds; do not wait for Drive completion.

- [ ] **Step 5: Run wizard, queue, and type tests**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/components.test.tsx tests/field/registration-draft.test.ts tests/field/capture-components.test.tsx tests/field/offline-queue.test.ts
pnpm --dir company-site typecheck:field
```

Expected: PASS, including strict save→session→bind→resume ordering.

- [ ] **Step 6: Commit wizard capture integration**

```bash
git add company-site/app/field/components/BuildingWizard.tsx company-site/app/field/FieldApp.tsx company-site/app/field/lib/registration-draft.ts company-site/tests/field/registration-draft.test.ts company-site/tests/field/components.test.tsx
git commit -m "feat(field): connect capture to registration"
```

### Task 10: Replace the standalone Capture placeholder with assigned work sessions

**Files:**
- Create: `company-site/app/field/components/CaptureWorkspace.tsx`
- Create: `company-site/tests/field/capture-workspace.test.tsx`
- Modify: `company-site/app/field/lib/field-api.client.ts`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/field.css`

- [ ] **Step 1: Write failing target/session tests**

```tsx
it("offers assigned managed buildings and assigned advertising listings without mixing map rules", async () => {
  render(<CaptureWorkspace loadTargets={async () => [
    { id: "managed-b1", buildingName: "관리 건물", unitId: "u1", unitLabel: "201호", source: "management" },
    { id: "listing-l2", buildingName: "광고 매물", unitId: "u2", unitLabel: "302호", source: "advertising" },
  ]} startSession={startSession} />);
  expect(await screen.findByRole("option", { name: "관리 건물 · 201호" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "광고 매물 · 302호" })).toBeInTheDocument();
});

it("starts a fresh visit or resumes an owned open session", async () => {
  render(<CaptureWorkspace loadTargets={loadTargets} loadOpenSessions={async () => [openSession]}
    startSession={startSession} />);
  fireEvent.click(await screen.findByRole("button", { name: "진행 중 촬영 이어서 하기" }));
  expect(await screen.findByLabelText("외관 사진 촬영")).toBeInTheDocument();
  expect(startSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "새 방문 촬영 시작" }));
  expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ visitType: "vacancyRefresh" }));
});
```

- [ ] **Step 2: Verify the standalone test is red**

Run: `pnpm --dir company-site exec vitest run tests/field/capture-workspace.test.tsx`

Expected: FAIL because `CaptureWorkspace.tsx` is absent.

- [ ] **Step 3: Implement assignment-safe target and session reads**

In `field-api.client.ts`, export:

```ts
export interface CaptureTarget {
  id: string; buildingId: string; buildingName: string; unitId?: string; unitLabel?: string;
  listingId?: string; source: "management" | "advertising";
}
export async function listCaptureTargets(): Promise<CaptureTarget[]>;
export async function listOpenCaptureSessions(): Promise<CaptureSessionRecord[]>;
```

Derive management targets from current `buildingAssignments` plus `managementContract.status === "active"`; derive advertising targets separately from assigned listings in a capture-capable status. Deduplicate identical building/unit/listing triples without converting every assigned listing into a managed-map building. Read only the authenticated session’s open sessions; reviewers receive an empty capture target list.

- [ ] **Step 4: Implement target selection and reuse CaptureGuide**

`CaptureWorkspace` shows target selector, source badge, open sessions newest first, “새 방문 촬영 시작”, pending counts, and retry summary. A new session generates stable request/session/visit UUIDs, calls `startFieldCaptureSession`, and renders:

```tsx
<CaptureGuide context={{ mode: "visit", captureSessionId, buildingId, unitId, listingId, visitId }} />
```

Resuming passes the existing IDs unchanged. Switching sessions revokes all prior preview URLs and cannot display another UID’s IndexedDB records. Replace the `capture` `DestinationPlaceholder` branch in `FieldApp` with `<CaptureWorkspace />`.

- [ ] **Step 5: Run the standalone and shared-guide tests**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/capture-workspace.test.tsx tests/field/capture-components.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: PASS; both entry points render the same native input labels from `CaptureGuide`.

- [ ] **Step 6: Commit the standalone workspace**

```bash
git add company-site/app/field/components/CaptureWorkspace.tsx company-site/app/field/lib/field-api.client.ts company-site/app/field/FieldApp.tsx company-site/app/field/field.css company-site/tests/field/capture-workspace.test.tsx
git commit -m "feat(field): add standalone capture workspace"
```

### Task 11: Add App Check, safe shell caching, and guarded account exit

**Files:**
- Modify: `company-site/app/field/lib/firebase.client.ts`
- Create: `company-site/app/field/components/FieldServiceWorker.tsx`
- Create: `company-site/public/field-sw.js`
- Create: `company-site/tests/field/service-worker.test.ts`
- Modify: `company-site/app/field/components/AppShell.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/tests/field/components.test.tsx`
- Modify: `company-site/scripts/export-firebase.mjs`
- Modify: `company-site/README.md`

- [ ] **Step 1: Write failing cache and account-exit tests**

```ts
it("caches only same-origin GET shell assets and excludes protected traffic", async () => {
  const source = await readFile(resolve("public/field-sw.js"), "utf8");
  expect(source).toContain('request.method !== "GET"');
  expect(source).toContain('url.origin !== self.location.origin');
  for (const forbidden of ["/field-media", "/field-media-finalized", "/__/auth", "/api/"]) {
    expect(source).toContain(forbidden);
  }
  expect(source).not.toMatch(/cache\.put\([^\n]*(firebase|media|signed)/i);
});

it("shows the owning UID pending count before logout and cancels safely", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<AuthenticatedFieldApp queue={queueWithTwoPendingForStaffOne} session={staffOne} />);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(window.confirm).toHaveBeenCalledWith("서버 등록 대기 파일이 2개 있습니다. 로그아웃하면 이 계정으로 다시 로그인할 때까지 업로드가 멈춥니다. 로그아웃할까요?");
  expect(logoutFieldUser).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm --dir company-site exec vitest run tests/field/service-worker.test.ts tests/field/components.test.tsx -t "logout|caches only"`

Expected: FAIL because no service worker or logout control exists.

- [ ] **Step 3: Initialize Firebase App Check explicitly**

In `firebase.client.ts`, initialize `ReCaptchaEnterpriseProvider` once in the browser using the foundation plan's `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` and `isTokenAutoRefreshEnabled: true`. Permit a debug token only when `NODE_ENV !== "production"` and `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN === "true"`; production startup must log a blocking configuration error when the site key is absent. Document both environment names, Firebase Console App Check registration, Storage enforcement, and callable enforcement in `company-site/README.md`. Do not reintroduce the removed approved-email fallback: capture requires a refreshed token with `fieldPlatform === true`, a known `fieldRole`, and an enabled user record.

- [ ] **Step 4: Implement a non-sensitive `/field` service worker**

Register `/field-sw.js` with scope `/field` from `FieldServiceWorker`. The worker uses cache name `bring-field-shell-v1`, pre-caches `/field`, `/field/manifest.webmanifest`, and the two icons, serves `/field` navigation network-first with cached fallback, and serves only same-origin immutable script/style/icon assets cache-first. It must bypass non-GET, cross-origin, requests with `Authorization`, query parameters, `/__/auth`, `/api/`, `/field-media`, and `/field-media-finalized`; it must never cache Firebase REST responses, signed URLs, POST bodies, owner notes, secure access, or media. `export-firebase.mjs` must copy the worker to `firebase-public/field-sw.js`.

- [ ] **Step 5: Guard logout/account switching and clear transient state**

Show the real `FieldSession` identity in `AppShell`. Before `logoutFieldUser`, call `queue.countPending(session.uid)` and display the exact confirmation above when nonzero. On confirmed logout, stop the coordinator and revoke previews before signing out. On any provider UID change, reconstruct Capture workspace state from `queue.list(newUid)` only; never delete or reveal the prior UID’s records. Add a `beforeunload` warning only while the active UID has queued/uploading/objectStored/finalizing files.

- [ ] **Step 6: Verify tests, build, and exported worker**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/service-worker.test.ts tests/field/components.test.tsx tests/field/capture-components.test.tsx
pnpm --dir company-site typecheck:field
pnpm --dir company-site build
Test-Path company-site/firebase-public/field-sw.js
```

Expected: tests/typecheck/build PASS; PowerShell prints `True`.

- [ ] **Step 7: Commit PWA and account safety**

```bash
git add company-site/app/field/lib/firebase.client.ts company-site/app/field/components/FieldServiceWorker.tsx company-site/public/field-sw.js company-site/app/field/components/AppShell.tsx company-site/app/field/FieldApp.tsx company-site/scripts/export-firebase.mjs company-site/tests/field/service-worker.test.ts company-site/tests/field/components.test.tsx company-site/README.md
git commit -m "security(field): protect capture sessions and shell cache"
```

### Task 12: Clean abandoned staging objects without touching live/finalized media

**Files:**
- Create: `functions/src/field/cleanup-orphan-media.ts`
- Create: `functions/test/cleanup-orphan-media.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the failing cleanup test**

```ts
it("deletes only staging objects older than seven days and reports malformed metadata", async () => {
  const remove = vi.fn(async () => undefined);
  const result = await cleanupOrphanMediaCore({ nowMs: 10 * DAY, retentionMs: 7 * DAY }, {
    listStaging: async () => [
      object("old", { timeCreatedMs: 1 * DAY, mediaId: UUID_1 }),
      object("young", { timeCreatedMs: 9 * DAY, mediaId: UUID_2 }),
      object("invalid", { timeCreatedMs: Number.NaN, mediaId: UUID_3 }),
    ],
    readMedia: async () => null,
    remove,
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith("field-media/u/s/photos/old.jpg");
  expect(result).toEqual({ scanned: 3, deleted: 1, skippedYoung: 1, malformed: 1, errors: 0 });
});

it("can remove stale staging left after successful finalization but never a finalized prefix", async () => {
  const remove = vi.fn();
  await cleanupOrphanMediaCore({ nowMs: 10 * DAY, retentionMs: 7 * DAY }, {
    listStaging: async () => [object("stale", { timeCreatedMs: 1, mediaId: UUID_1 })],
    readMedia: async () => ({ id: UUID_1, uploadState: "finalized" }), remove,
  });
  expect(remove).toHaveBeenCalledOnce();
  expect(remove.mock.calls[0][0]).toMatch(/^field-media\//);
  expect(remove.mock.calls[0][0]).not.toMatch(/^field-media-finalized\//);
});
```

- [ ] **Step 2: Verify the cleanup test fails**

Run: `pnpm --dir functions exec vitest run test/cleanup-orphan-media.test.ts`

Expected: FAIL because `cleanup-orphan-media.ts` is absent.

- [ ] **Step 3: Implement and schedule cleanup**

Export `ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000` and `cleanupOrphanMediaCore(options, dependencies)`. List only prefix `field-media/`; refuse any returned path outside it; derive `timeCreatedMs` from GCS's server-owned `timeCreated`, never client custom metadata; delete only objects strictly older than retention; continue after individual errors and return exact counters. A missing/malformed server timestamp is reported and retained for administrator review, not guessed. Finalized objects are outside the listed prefix and therefore unreachable.

In `functions/src/index.ts`, export `cleanupOrphanFieldMedia` with `onSchedule({ schedule: "every day 03:00", timeZone: "Asia/Seoul", region: "asia-northeast3" })`; use Admin Storage listing pagination and generation-safe delete. Log counts only, never filenames or signed URLs.

- [ ] **Step 4: Test and build Functions**

Run:

```bash
pnpm --dir functions exec vitest run test/cleanup-orphan-media.test.ts
pnpm --dir functions test
pnpm --dir functions build
```

Expected: all commands PASS.

- [ ] **Step 5: Commit lifecycle cleanup**

```bash
git add functions/src/field/cleanup-orphan-media.ts functions/test/cleanup-orphan-media.test.ts functions/src/index.ts
git commit -m "chore(field): clean abandoned media staging"
```

### Task 13: Run release verification and record real-device acceptance

**Files:**
- Create: `docs/superpowers/verification/2026-08-09-field-capture-device-acceptance.md`
- Modify only if a test exposes a defect: the smallest source/test files from Tasks 1-12

- [ ] **Step 1: Run the complete automated suite from a clean shell**

Run:

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
pnpm --dir company-site lint
pnpm --dir company-site build
pnpm --dir functions test
pnpm --dir functions build
pnpm --dir company-site exec firebase --config ../firebase.json --project demo-bring-field-platform emulators:exec --only database,storage "pnpm test:rules"
git diff --check
```

Expected: every command exits 0; rule tests run rather than skip; `git diff --check` prints nothing.

- [ ] **Step 2: Test automated offline/reload/error recovery in the browser**

Run `pnpm --dir company-site dev`, open `/field`, and use browser devtools to verify these exact outcomes:

1. At 320×568 and 390×844, every zone/card/button fits without horizontal overflow and the final zone remains reachable above fixed navigation.
2. Capture/select one photo and one 10–20 second portrait video; previews render and the queue says “기기에 저장됨 · 서버 등록 대기” only after IndexedDB contains each Blob.
3. Go offline, reload, and confirm the owning UID restores both queue items; another UID sees zero items.
4. Return online; confirm one upload at a time, finalization, Blob removal, media/outbox/projection records, and no `getDownloadURL` token.
5. Interrupt after Storage upload but before finalizer response; reload and confirm metadata reconciliation skips the second upload and idempotent finalization creates one media/outbox/audit record.
6. Fill simulated storage until `QuotaExceededError`; confirm the new file is absent from the queue and the UI instructs the user to free space or upload online.
7. Confirm logout warns with the active UID’s exact pending count, cancel leaves the session intact, and confirmed logout stops uploads.

Expected: all seven behaviors match with no binary/base64/blob/signed URL in localStorage.

- [ ] **Step 3: Perform mandatory iPhone Safari/PWA acceptance**

On an iPhone using the deployed HTTPS preview:

1. Open Safari, sign in with an approved claimed account, add BRING FIELD to Home Screen, and launch standalone.
2. Tap photo for exterior; verify the rear camera opens, cancel returns without an error, then capture and preview a photo.
3. Tap video; verify the rear camera opens, record a 10–20 second portrait clip, play it inline, replace it, and confirm the first media remains excluded rather than overwritten.
4. Enable airplane mode, capture another photo, kill/relaunch the PWA, and verify “기기 저장·서버 등록 대기”. Restore network and verify upload/finalization resumes.
5. Lock/unlock during an upload; verify either same-page resumable continuation or restart-from-Blob reconciliation, never a false completion.

Expected: every item passes on current iOS Safari and installed PWA.

- [ ] **Step 4: Perform mandatory Android Chrome/PWA acceptance**

Repeat the five iPhone scenarios on Android Chrome and the installed PWA. Also verify camera/file-picker fallback when camera permission is denied and that retry affects only the failed item.

Expected: every item passes on current Android Chrome and installed PWA.

- [ ] **Step 5: Record evidence without secrets**

Create `docs/superpowers/verification/2026-08-09-field-capture-device-acceptance.md` after executing the tests, not before. Start with heading `# BRING Field Capture Device Acceptance — 2026-08-09`. Add a seven-column table headed `Surface`, `Photo / cancel / retake`, `Portrait video / warning`, `Offline relaunch`, `Upload recovery`, `Account isolation`, and `Result`; write one fully populated row for iPhone Safari, iPhone installed PWA, Android Chrome, and Android installed PWA. Every cell must contain `PASS — {device/OS/browser version} — {UTC timestamp}` or `FAIL — {redacted issue reference}` based on the observed run. After the table, add fully populated lines for `App Check enforcement`, `Storage App Check enforcement`, `Callable rate-limit verification`, and `Orphan-cleanup dry-run counters` using the same PASS/FAIL convention.

Do not record account emails, UIDs, filenames, addresses, owner notes, access codes, URLs, or Firebase tokens. Do not create fictional PASS evidence, and do not mark this task complete while any cell is absent or failed.

- [ ] **Step 6: Commit verified release evidence**

```bash
git add docs/superpowers/verification/2026-08-09-field-capture-device-acceptance.md
git commit -m "test(field): verify capture on mobile devices"
```

## Final acceptance gates

The capture/upload release is complete only when all of these are true:

- The wizard and standalone tab import the same `CaptureGuide`; there is one zone catalogue and one upload coordinator.
- Photo/video inputs retain the exact `accept` and `capture="environment"` attributes.
- IndexedDB commit precedes “기기에 저장됨”; localStorage contains descriptors only.
- Queue reads, previews, upload work, retry work, and logout counts are all namespaced by the current `FieldSession.uid`.
- A restarted browser reconciles a matching completed staging object before reuploading; a conflict is never overwritten.
- Storage staging is exact-MIME, size-limited, UUID-shaped, uploader-read/create-only; reviewers/admins cannot browse it.
- Finalized Storage objects deny all direct client reads and are available only through a five-minute server-issued URL after current authorization.
- `finalizeFieldMedia` is idempotent and atomically writes one media record, one audit event, one Drive outbox job, session status, and safe map capture projection.
- Finalized local Blobs are removed immediately; trace metadata is removed after Drive completion.
- App Check, enabled-user checks, rate limits, token revocation operations, and seven-day staging cleanup are configured and verified.
- Automated suites and all four real-device rows pass.

## Implementation handoff

Execute with `subagent-driven-development`: one fresh implementation subagent per task, followed by specification-compliance review and code-quality review before the next task. Tasks 1–7 establish data/security boundaries; do not begin UI Tasks 8–10 until the Task 6 emulator suite and Task 7 reconciliation tests pass. Do not deploy Functions or rules until Task 13’s automated suite passes, and do not enable production capture for staff until both device families pass manual acceptance.

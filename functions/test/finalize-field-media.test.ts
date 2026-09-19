import { describe, expect, it, vi } from "vitest";

import {
  finalizeFieldMediaCore,
  type FinalizeFieldMediaDependencies,
  type FinalizeFieldMediaInput,
  type StoredObject,
} from "../src/field/finalize-field-media.js";
import {
  CAPTURE_ZONES,
  MEDIA_POLICY,
  finalizedPath,
  sanitizeOriginalFileName,
  validateFinalizeInput,
  validateStoredObject,
} from "../src/field/media-policy.js";
import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionMedia,
} from "../src/field/map-projection.js";
import { buildDriveRecoveryKey } from "../src/drive/recovery-key.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const REPLACED_MEDIA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const VISIT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-09T00:00:10.000Z";
const CAPTURED_AT = "2026-08-09T00:00:00.000Z";
const SOURCE_GENERATION = "1740000000000000";
const FINAL_GENERATION = "1740000000000001";
const STAGING_PATH =
  `field-media/staff-1/${SESSION_ID}/photos/${MEDIA_ID}.jpg`;
const FINAL_PATH = `field-media-finalized/building-1/${MEDIA_ID}.jpg`;

const input: FinalizeFieldMediaInput = {
  requestId: REQUEST_ID,
  mediaId: MEDIA_ID,
  captureSessionId: SESSION_ID,
  objectGeneration: SOURCE_GENERATION,
  stagingPath: STAGING_PATH,
  buildingId: "building-1",
  unitId: "unit-1",
  listingId: "listing-1",
  visitId: VISIT_ID,
  kind: "photo",
  zone: "roomOverview",
  slotId: "roomOverview-1",
  required: true,
  originalFileName: "room.jpg",
  capturedAt: CAPTURED_AT,
};

const activeBuilding: ProjectionBuilding = {
  id: "building-1",
  name: "상지 원룸",
  roadAddress: "강원특별자치도 원주시 상지대길 1",
  latitude: 37.369,
  longitude: 127.928,
  parking: { available: true, totalSpaces: 8 },
  managementContract: {
    status: "active",
    startedOn: "2026-08-01",
    updatedAt: NOW,
    updatedBy: "admin-1",
  },
};

const storedObject: StoredObject = {
  generation: SOURCE_GENERATION,
  sizeBytes: 1_024,
  contentType: "image/jpeg",
  md5Hash: "server-md5",
  crc32c: "server-crc",
  timeCreated: CAPTURED_AT,
  customMetadata: {
    capturedBy: "staff-1",
    mediaId: MEDIA_ID,
    captureSessionId: SESSION_ID,
  },
};

function baseExistingMedia(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: MEDIA_ID,
    requestId: REQUEST_ID,
    buildingId: "building-1",
    unitId: "unit-1",
    listingId: "listing-1",
    visitId: VISIT_ID,
    captureSessionId: SESSION_ID,
    capturedBy: "staff-1",
    kind: "photo",
    zone: "roomOverview",
    slotId: "roomOverview-1",
    required: true,
    originalFileName: "room.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1_024,
    capturedAt: CAPTURED_AT,
    storagePath: FINAL_PATH,
    uploadState: "finalized",
    uploadProgress: 100,
    driveSyncState: "queued",
    captureQualityState: "valid",
    objectGeneration: FINAL_GENERATION,
    objectMd5Hash: "server-md5",
    objectCrc32c: "server-crc",
    advertisingApproved: false,
    finalizedAt: NOW,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<FinalizeFieldMediaDependencies> = {},
) {
  const defaults: FinalizeFieldMediaDependencies = {
    isEnabled: vi.fn(async () => true),
    isAssigned: vi.fn(async () => true),
    readMedia: vi.fn(async () => null),
    readFinalizationAudit: vi.fn(async () => null),
    readVisit: vi.fn(async () => ({
      id: VISIT_ID,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      assignedUserId: "staff-1",
    })),
    readSession: vi.fn(async () => ({
      id: SESSION_ID,
      requestId: "55555555-5555-4555-8555-555555555555",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: VISIT_ID,
      createdBy: "staff-1",
      status: "open",
      createdAt: CAPTURED_AT,
      updatedAt: CAPTURED_AT,
    })),
    readUnit: vi.fn(async () => ({
      id: "unit-1",
      buildingId: "building-1",
    })),
    readListing: vi.fn(async () => ({
      id: "listing-1",
      buildingId: "building-1",
      unitId: "unit-1",
    })),
    readBuilding: vi.fn(async () => activeBuilding),
    listBuildingListings: vi.fn(async () => [{
      id: "listing-1",
      buildingId: "building-1",
      status: "advertising",
      advertisingApproved: true,
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 50_000,
      privateOwnerContact: "010-0000-0000",
    }]),
    listFinalizedBuildingMedia: vi.fn(async () => []),
    inspectStagingObject: vi.fn(async () => storedObject),
    copyToFinalized: vi.fn(async () => ({
      status: "copied" as const,
      path: FINAL_PATH,
      generation: FINAL_GENERATION,
    })),
    inspectFinalizedObject: vi.fn(async () => null),
    writePatch: vi.fn(async () => undefined),
    deleteStaging: vi.fn(async () => undefined),
    now: () => NOW,
  };
  return Object.assign(defaults, overrides);
}

function finalizedProjectionMedia(
  sessionId: string,
  zone: ProjectionMedia["zone"],
  kind: "photo" | "video",
  overrides: Partial<ProjectionMedia> = {},
): ProjectionMedia {
  return {
    buildingId: "building-1",
    captureSessionId: sessionId,
    uploadState: "finalized",
    kind,
    zone,
    captureQualityState: "valid",
    ...overrides,
  };
}

function requiredSessionMedia(sessionId = SESSION_ID): ProjectionMedia[] {
  return [
    finalizedProjectionMedia(sessionId, "exterior", "photo"),
    finalizedProjectionMedia(sessionId, "accessRoad", "photo"),
    finalizedProjectionMedia(sessionId, "commonEntrance", "photo"),
    finalizedProjectionMedia(sessionId, "roomOverview", "photo"),
    finalizedProjectionMedia(sessionId, "roomOverview", "photo"),
    finalizedProjectionMedia(sessionId, "windowDaylight", "photo"),
    finalizedProjectionMedia(sessionId, "kitchen", "photo"),
    finalizedProjectionMedia(sessionId, "bathroom", "photo"),
    finalizedProjectionMedia(sessionId, "boilerEquipment", "photo"),
    finalizedProjectionMedia(sessionId, "verticalVideo", "video"),
  ];
}

describe("server media policy", () => {
  it("keeps the seven approved MIME mappings and exact byte limits", () => {
    expect(MEDIA_POLICY.photo.maxBytes).toBe(25 * 1_024 * 1_024);
    expect(MEDIA_POLICY.video.maxBytes).toBe(500 * 1_024 * 1_024);
    expect(MEDIA_POLICY.photo.mimeToExtension).toEqual({
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    });
    expect(MEDIA_POLICY.video.mimeToExtension).toEqual({
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
    });
    expect(CAPTURE_ZONES.filter((zone) => zone.required).map((zone) => [
      zone.id,
      zone.kind,
      zone.minimum,
    ])).toEqual([
      ["exterior", "photo", 1],
      ["accessRoad", "photo", 1],
      ["commonEntrance", "photo", 1],
      ["roomOverview", "photo", 2],
      ["windowDaylight", "photo", 1],
      ["kitchen", "photo", 1],
      ["bathroom", "photo", 1],
      ["boilerEquipment", "photo", 1],
      ["verticalVideo", "video", 1],
    ]);
  });

  it("derives the finalized path from server MIME policy", () => {
    expect(finalizedPath("building-1", MEDIA_ID, "image/jpeg")).toBe(FINAL_PATH);
    expect(() => finalizedPath("../building-1", MEDIA_ID, "image/jpeg"))
      .toThrow("field_media_invalid");
    expect(() => finalizedPath("building-1", MEDIA_ID, "image/svg+xml"))
      .toThrow("field_media_mime_not_allowed");
  });

  it("stores only a 255-character basename from the original file name", () => {
    const longName = `${"가".repeat(300)}.jpg`;
    const sanitized = sanitizeOriginalFileName(`C:\\fakepath\\folder/${longName}`);
    expect([...sanitized]).toHaveLength(255);
    expect(sanitized).not.toMatch(/[\\/]/);
  });

  it.each([
    ["request UUID", { requestId: "request-1" }],
    ["media UUID", { mediaId: "media-1" }],
    ["session UUID", { captureSessionId: "session-1" }],
    ["generation", { objectGeneration: "0" }],
    ["generation type", { objectGeneration: 123 as unknown as string }],
    ["traversal", { stagingPath: `field-media/staff-1/${SESSION_ID}/photos/../x.jpg` }],
    ["slot", { slotId: "room overview" }],
    ["slot type", { slotId: 123 as unknown as string }],
    ["zone kind", { kind: "video" as const }],
    ["required flag", { required: false }],
    ["canonical capturedAt", { capturedAt: "2026-08-09T00:00:00Z" }],
  ])("rejects invalid %s input", (_label, override) => {
    expect(() => validateFinalizeInput({ ...input, ...override }))
      .toThrow("field_media_invalid");
  });

  it.each([
    ["generation", { generation: "2" }, "field_media_generation_mismatch"],
    ["MIME", { contentType: "image/svg+xml" }, "field_media_mime_not_allowed"],
    ["kind", { contentType: "video/mp4" }, "field_media_kind_mismatch"],
    ["oversize", { sizeBytes: 25 * 1_024 * 1_024 + 1 }, "field_media_too_large"],
    ["empty", { sizeBytes: 0 }, "field_media_size_invalid"],
    [
      "capturedBy metadata",
      { customMetadata: { ...storedObject.customMetadata, capturedBy: "staff-2" } },
      "field_media_metadata_mismatch",
    ],
    [
      "media metadata",
      { customMetadata: { ...storedObject.customMetadata, mediaId: "wrong" } },
      "field_media_metadata_mismatch",
    ],
    [
      "session metadata",
      { customMetadata: { ...storedObject.customMetadata, captureSessionId: "wrong" } },
      "field_media_metadata_mismatch",
    ],
  ])("rejects stored-object %s mismatch", (_label, override, code) => {
    expect(() => validateStoredObject(input, "staff-1", {
      ...storedObject,
      ...override,
    })).toThrow(code);
  });

  it("accepts exact MIME size limits and rejects filename-derived path extensions", () => {
    expect(() => validateStoredObject(input, "staff-1", {
      ...storedObject,
      sizeBytes: MEDIA_POLICY.photo.maxBytes,
    })).not.toThrow();
    expect(() => validateStoredObject(
      { ...input, stagingPath: STAGING_PATH.replace(/\.jpg$/, ".png") },
      "staff-1",
      storedObject,
    )).toThrow("field_media_path_mismatch");
  });

  it("enforces the independent video size boundary", () => {
    const videoInput: FinalizeFieldMediaInput = {
      ...input,
      kind: "video",
      zone: "verticalVideo",
      slotId: "verticalVideo-1",
      stagingPath: `field-media/staff-1/${SESSION_ID}/videos/${MEDIA_ID}.mp4`,
    };
    const videoObject: StoredObject = {
      ...storedObject,
      contentType: "video/mp4",
      sizeBytes: MEDIA_POLICY.video.maxBytes,
    };
    expect(() => validateStoredObject(videoInput, "staff-1", videoObject))
      .not.toThrow();
    expect(() => validateStoredObject(videoInput, "staff-1", {
      ...videoObject,
      sizeBytes: MEDIA_POLICY.video.maxBytes + 1,
    })).toThrow("field_media_too_large");
  });
});

describe("finalizeFieldMediaCore", () => {
  it("copies once and atomically queues media, audit, Drive, session, and projection records", async () => {
    const deps = dependencies();

    const result = await finalizeFieldMediaCore(
      { ...input, originalFileName: "C:\\fakepath\\folder/room.jpg" },
      { uid: "staff-1", role: "staff" },
      deps,
    );

    expect(result).toEqual({
      mediaId: MEDIA_ID,
      uploadState: "finalized",
      storagePath: FINAL_PATH,
      driveSyncState: "queued",
      finalizedAt: NOW,
    });
    expect(deps.copyToFinalized).toHaveBeenCalledWith({
      sourcePath: STAGING_PATH,
      sourceGeneration: SOURCE_GENERATION,
      destinationPath: FINAL_PATH,
      ifGenerationMatch: 0,
    });
    expect(deps.inspectStagingObject).toHaveBeenCalledWith(
      STAGING_PATH,
      SOURCE_GENERATION,
    );
    expect(deps.writePatch).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(new Set(Object.keys(patch))).toEqual(new Set([
      `fieldPlatform/media/${MEDIA_ID}`,
      `fieldPlatform/driveSyncJobs/${MEDIA_ID}`,
      `fieldPlatform/auditLogs/media-finalized-${REQUEST_ID}`,
      `fieldPlatform/captureSessions/${SESSION_ID}/updatedAt`,
      `fieldPlatform/captureSessions/${SESSION_ID}/status`,
      "fieldPlatform/mapProjections/building-1",
    ]));
    expect(patch[`fieldPlatform/media/${MEDIA_ID}`]).toMatchObject({
      id: MEDIA_ID,
      requestId: REQUEST_ID,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: VISIT_ID,
      captureSessionId: SESSION_ID,
      capturedBy: "staff-1",
      kind: "photo",
      zone: "roomOverview",
      slotId: "roomOverview-1",
      required: true,
      originalFileName: "room.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1_024,
      capturedAt: CAPTURED_AT,
      storagePath: FINAL_PATH,
      uploadState: "finalized",
      uploadProgress: 100,
      driveSyncState: "queued",
      captureQualityState: "valid",
      objectGeneration: FINAL_GENERATION,
      objectMd5Hash: "server-md5",
      objectCrc32c: "server-crc",
      advertisingApproved: false,
      finalizedAt: NOW,
    });
    expect(patch[`fieldPlatform/driveSyncJobs/${MEDIA_ID}`]).toMatchObject({
      id: MEDIA_ID,
      mediaId: MEDIA_ID,
      buildingId: "building-1",
      storagePath: FINAL_PATH,
      status: "queued",
      recoveryKey: buildDriveRecoveryKey("queued", NOW, MEDIA_ID),
    });
    expect(patch[`fieldPlatform/auditLogs/media-finalized-${REQUEST_ID}`])
      .toMatchObject({
        id: `media-finalized-${REQUEST_ID}`,
        actorId: "staff-1",
        action: "media.finalized",
        entityType: "media",
        entityId: MEDIA_ID,
        occurredAt: NOW,
        requestId: REQUEST_ID,
      });
    expect(patch[`fieldPlatform/captureSessions/${SESSION_ID}/updatedAt`])
      .toBe(NOW);
    expect(patch[`fieldPlatform/captureSessions/${SESSION_ID}/status`])
      .toBe("open");

    const projection = patch["fieldPlatform/mapProjections/building-1"] as
      Record<string, unknown>;
    expect(Object.keys(projection)).toEqual([
      "buildingId",
      "name",
      "roadAddress",
      "latitude",
      "longitude",
      "markerStatus",
      "vacancyCount",
      "approvedRentSummary",
      "parkingSummary",
      "captureStatus",
      "updatedAt",
    ]);
    expect(projection).toMatchObject({
      buildingId: "building-1",
      captureStatus: "inProgress",
      updatedAt: NOW,
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /room\.jpg|field-media|staff-1|privateOwnerContact|owner|notes?|contacts?|https?:|downloadToken|signedUrl/i,
    );
    expect(deps.deleteStaging).toHaveBeenCalledWith(
      STAGING_PATH,
      SOURCE_GENERATION,
    );
  });

  it("accepts the plan's direct copied-object result contract", async () => {
    const deps = dependencies({
      copyToFinalized: vi.fn(async () => ({
        path: FINAL_PATH,
        generation: FINAL_GENERATION,
      })) as FinalizeFieldMediaDependencies["copyToFinalized"],
    });

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toMatchObject({ storagePath: FINAL_PATH });
    expect(deps.inspectFinalizedObject).not.toHaveBeenCalled();
  });

  it("does not require the optional request-audit conflict guard adapter", async () => {
    const deps = dependencies();
    delete (deps as Partial<FinalizeFieldMediaDependencies>)
      .readFinalizationAudit;

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toMatchObject({ mediaId: MEDIA_ID });
  });

  it("returns an exact existing result after ACK loss without copying or writing again", async () => {
    const deps = dependencies({
      readMedia: vi.fn(async () => baseExistingMedia()),
    });

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toEqual({
      mediaId: MEDIA_ID,
      uploadState: "finalized",
      storagePath: FINAL_PATH,
      driveSyncState: "queued",
      finalizedAt: NOW,
    });
    expect(deps.inspectStagingObject).not.toHaveBeenCalled();
    expect(deps.copyToFinalized).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
    expect(deps.deleteStaging).not.toHaveBeenCalled();
  });

  it.each([
    ["requestId", { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["capturedBy", { capturedBy: "staff-2" }],
    ["captureSessionId", { captureSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["visitId", { visitId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["buildingId", { buildingId: "building-2" }],
    ["unitId", { unitId: "unit-2" }],
    ["listingId", { listingId: "listing-2" }],
  ])("rejects an existing mediaId whose %s binding conflicts", async (_field, override) => {
    const deps = dependencies({
      readMedia: vi.fn(async () => baseExistingMedia(override)),
    });

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow("field_media_id_conflict");
    expect(deps.copyToFinalized).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("rejects requestId reuse for another media before overwriting its audit", async () => {
    const deps = dependencies({
      readFinalizationAudit: vi.fn(async () => ({
        requestId: REQUEST_ID,
        actorId: "staff-1",
        entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })),
    });

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow("field_media_id_conflict");
    expect(deps.inspectStagingObject).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it.each([
    ["reviewer", { uid: "reviewer-1", role: "reviewer" as const }, {}, "field_media_forbidden"],
    ["disabled", { uid: "staff-1", role: "staff" as const }, { isEnabled: vi.fn(async () => false) }, "field_media_forbidden"],
    ["unassigned", { uid: "staff-1", role: "staff" as const }, { isAssigned: vi.fn(async () => false) }, "field_building_assignment_required"],
  ])("rejects %s before Storage or Database mutation", async (_label, actor, override, code) => {
    const deps = dependencies(override);
    await expect(finalizeFieldMediaCore(input, actor, deps)).rejects.toThrow(code);
    expect(deps.inspectStagingObject).not.toHaveBeenCalled();
    expect(deps.copyToFinalized).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("lets an enabled admin bypass assignment", async () => {
    const adminPath = STAGING_PATH.replace("staff-1", "admin-1");
    const deps = dependencies({
      isAssigned: vi.fn(async () => false),
      readVisit: vi.fn(async () => ({
        id: VISIT_ID,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        assignedUserId: "admin-1",
      })),
      readSession: vi.fn(async () => ({
        id: SESSION_ID,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        visitId: VISIT_ID,
        createdBy: "admin-1",
        status: "open",
      })),
      inspectStagingObject: vi.fn(async () => ({
        ...storedObject,
        customMetadata: {
          ...storedObject.customMetadata,
          capturedBy: "admin-1",
        },
      })),
    });

    await expect(finalizeFieldMediaCore(
      { ...input, stagingPath: adminPath },
      { uid: "admin-1", role: "admin" },
      deps,
    )).resolves.toMatchObject({ mediaId: MEDIA_ID });
    expect(deps.isAssigned).not.toHaveBeenCalled();
  });

  it.each([
    ["visit building", { readVisit: vi.fn(async () => ({ id: VISIT_ID, buildingId: "building-2", unitId: "unit-1", listingId: "listing-1", assignedUserId: "staff-1" })) }, "field_media_visit_mismatch"],
    ["session owner", { readSession: vi.fn(async () => ({ id: SESSION_ID, buildingId: "building-1", unitId: "unit-1", listingId: "listing-1", visitId: VISIT_ID, createdBy: "staff-2", status: "open" })) }, "field_media_session_mismatch"],
    ["unit building", { readUnit: vi.fn(async () => ({ id: "unit-1", buildingId: "building-2" })) }, "field_media_unit_mismatch"],
    ["listing unit", { readListing: vi.fn(async () => ({ id: "listing-1", buildingId: "building-1", unitId: "unit-2" })) }, "field_media_listing_mismatch"],
  ])("rejects %s binding mismatch before copying", async (_label, override, code) => {
    const deps = dependencies(override);
    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow(code);
    expect(deps.copyToFinalized).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it.each([
    ["generation", { generation: "999" }, "field_media_generation_mismatch"],
    ["MIME", { contentType: "image/svg+xml" }, "field_media_mime_not_allowed"],
    ["size", { sizeBytes: MEDIA_POLICY.photo.maxBytes + 1 }, "field_media_too_large"],
    ["metadata", { customMetadata: { ...storedObject.customMetadata, capturedBy: "staff-2" } }, "field_media_metadata_mismatch"],
  ])("rejects object %s conflicts before copy and patch", async (_label, objectOverride, code) => {
    const deps = dependencies({
      inspectStagingObject: vi.fn(async () => ({
        ...storedObject,
        ...objectOverride,
      })),
    });
    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow(code);
    expect(deps.copyToFinalized).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("reuses a destination left by a failed patch only after checksum and size verification", async () => {
    const deps = dependencies({
      copyToFinalized: vi.fn(async () => ({ status: "alreadyExists" as const })),
      inspectFinalizedObject: vi.fn(async () => ({
        ...storedObject,
        generation: FINAL_GENERATION,
      })),
    });

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toMatchObject({ storagePath: FINAL_PATH });
    expect(deps.inspectFinalizedObject).toHaveBeenCalledWith(FINAL_PATH);
    expect(deps.writePatch).toHaveBeenCalledTimes(1);
    expect(deps.deleteStaging).toHaveBeenCalledWith(
      STAGING_PATH,
      SOURCE_GENERATION,
    );
  });

  it("treats equivalent destination custom metadata as order-independent", async () => {
    const deps = dependencies({
      copyToFinalized: vi.fn(async () => ({ status: "alreadyExists" as const })),
      inspectFinalizedObject: vi.fn(async () => ({
        ...storedObject,
        generation: FINAL_GENERATION,
        customMetadata: {
          captureSessionId: SESSION_ID,
          mediaId: MEDIA_ID,
          capturedBy: "staff-1",
        },
      })),
    });

    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toMatchObject({ storagePath: FINAL_PATH });
  });

  it.each([
    ["size", { sizeBytes: 2_048 }],
    ["MD5", { md5Hash: "other-md5" }],
    ["CRC32C", { crc32c: "other-crc" }],
    ["MIME", { contentType: "image/png" }],
  ])("rejects an existing destination with a different %s", async (_label, objectOverride) => {
    const deps = dependencies({
      copyToFinalized: vi.fn(async () => ({ status: "alreadyExists" as const })),
      inspectFinalizedObject: vi.fn(async () => ({
        ...storedObject,
        generation: FINAL_GENERATION,
        ...objectOverride,
      })),
    });
    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow("field_media_destination_conflict");
    expect(deps.writePatch).not.toHaveBeenCalled();
    expect(deps.deleteStaging).not.toHaveBeenCalled();
  });

  it("does not delete staging when the root patch fails", async () => {
    const deps = dependencies({
      writePatch: vi.fn(async () => {
        throw new Error("database_down");
      }),
    });
    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow("database_down");
    expect(deps.deleteStaging).not.toHaveBeenCalled();
  });

  it("keeps the committed finalization successful when exact-generation staging cleanup fails", async () => {
    const deps = dependencies({
      deleteStaging: vi.fn(async () => {
        throw new Error("cleanup_failed");
      }),
    });
    await expect(finalizeFieldMediaCore(
      input,
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toMatchObject({ mediaId: MEDIA_ID });
    expect(deps.writePatch).toHaveBeenCalledTimes(1);
    expect(deps.deleteStaging).toHaveBeenCalledWith(
      STAGING_PATH,
      SOURCE_GENERATION,
    );
  });

  it.each([
    [undefined, "warning"],
    [{ durationSeconds: Number.NaN, width: 1080, height: 1920 }, "warning"],
    [{ durationSeconds: 9.99, width: 1080, height: 1920 }, "warning"],
    [{ durationSeconds: 20.01, width: 1080, height: 1920 }, "warning"],
    [{ durationSeconds: 15, width: 1920, height: 1080 }, "warning"],
    [{ durationSeconds: 10, width: 1080, height: 1920 }, "valid"],
    [{ durationSeconds: 20, width: 1080, height: 1920 }, "valid"],
  ])("server re-evaluates video metadata %j as %s", async (videoMetadata, expectedQuality) => {
    const videoInput: FinalizeFieldMediaInput = {
      ...input,
      kind: "video",
      zone: "verticalVideo",
      slotId: "verticalVideo-1",
      stagingPath: `field-media/staff-1/${SESSION_ID}/videos/${MEDIA_ID}.mp4`,
      originalFileName: "walkthrough.mp4",
      videoMetadata,
    };
    const videoObject: StoredObject = {
      ...storedObject,
      contentType: "video/mp4",
    };
    const videoFinalPath = `field-media-finalized/building-1/${MEDIA_ID}.mp4`;
    const deps = dependencies({
      inspectStagingObject: vi.fn(async () => videoObject),
      copyToFinalized: vi.fn(async () => ({
        status: "copied" as const,
        path: videoFinalPath,
        generation: FINAL_GENERATION,
      })),
    });

    await finalizeFieldMediaCore(
      videoInput,
      { uid: "staff-1", role: "staff" },
      deps,
    );
    expect(vi.mocked(deps.writePatch).mock.calls[0][0][
      `fieldPlatform/media/${MEDIA_ID}`
    ]).toMatchObject({ captureQualityState: expectedQuality });
  });

  it("marks the session and projection complete only when the new valid vertical video completes one session", async () => {
    const existingRequiredPhotos = requiredSessionMedia().filter(
      (media) => media.zone !== "verticalVideo",
    );
    const videoInput: FinalizeFieldMediaInput = {
      ...input,
      kind: "video",
      zone: "verticalVideo",
      slotId: "verticalVideo-1",
      stagingPath: `field-media/staff-1/${SESSION_ID}/videos/${MEDIA_ID}.mp4`,
      originalFileName: "walkthrough.mp4",
      videoMetadata: { durationSeconds: 15, width: 1080, height: 1920 },
    };
    const deps = dependencies({
      listFinalizedBuildingMedia: vi.fn(async () => existingRequiredPhotos),
      inspectStagingObject: vi.fn(async () => ({
        ...storedObject,
        contentType: "video/mp4",
      })),
      copyToFinalized: vi.fn(async () => ({
        status: "copied" as const,
        path: `field-media-finalized/building-1/${MEDIA_ID}.mp4`,
        generation: FINAL_GENERATION,
      })),
    });

    await finalizeFieldMediaCore(
      videoInput,
      { uid: "staff-1", role: "staff" },
      deps,
    );
    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(patch[`fieldPlatform/captureSessions/${SESSION_ID}/status`])
      .toBe("complete");
    expect(patch["fieldPlatform/mapProjections/building-1"])
      .toMatchObject({ captureStatus: "complete" });
  });

  it("atomically excludes replacement media without deleting its Storage or changing its Drive job", async () => {
    const replaced = {
      ...baseExistingMedia({
        id: REPLACED_MEDIA_ID,
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        storagePath: `field-media-finalized/building-1/${REPLACED_MEDIA_ID}.jpg`,
      }),
    };
    const deps = dependencies({
      readMedia: vi.fn(async (mediaId) =>
        mediaId === REPLACED_MEDIA_ID ? replaced : null),
      listFinalizedBuildingMedia: vi.fn(async () => [
        replaced as unknown as ProjectionMedia,
      ]),
    });

    await finalizeFieldMediaCore(
      { ...input, replacesMediaId: REPLACED_MEDIA_ID },
      { uid: "staff-1", role: "staff" },
      deps,
    );

    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(patch[`fieldPlatform/media/${REPLACED_MEDIA_ID}/excludedAt`])
      .toBe(NOW);
    expect(patch[`fieldPlatform/media/${REPLACED_MEDIA_ID}/excludedBy`])
      .toBe("staff-1");
    expect(patch[`fieldPlatform/auditLogs/media-excluded-${REQUEST_ID}`])
      .toMatchObject({
        action: "media.excluded",
        entityId: REPLACED_MEDIA_ID,
        requestId: REQUEST_ID,
      });
    expect(Object.keys(patch).join("\n")).not.toContain(
      `driveSyncJobs/${REPLACED_MEDIA_ID}`,
    );
    expect(deps.deleteStaging).toHaveBeenCalledTimes(1);
    expect(deps.deleteStaging).toHaveBeenCalledWith(
      STAGING_PATH,
      SOURCE_GENERATION,
    );
  });

  it("finalizes a replacement whose predecessor was already safely excluded", async () => {
    const excludedAt = "2026-08-09T00:00:05.000Z";
    const replaced = {
      ...baseExistingMedia({
        id: REPLACED_MEDIA_ID,
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        storagePath: `field-media-finalized/building-1/${REPLACED_MEDIA_ID}.jpg`,
      }),
      excludedAt,
      excludedBy: "staff-1",
    };
    const deps = dependencies({
      readMedia: vi.fn(async (mediaId) =>
        mediaId === REPLACED_MEDIA_ID ? replaced : null),
      listFinalizedBuildingMedia: vi.fn(async () => [
        replaced as unknown as ProjectionMedia,
      ]),
    });

    await expect(finalizeFieldMediaCore(
      { ...input, replacesMediaId: REPLACED_MEDIA_ID },
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toMatchObject({
      mediaId: MEDIA_ID,
      uploadState: "finalized",
    });

    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(Object.hasOwn(
      patch,
      `fieldPlatform/media/${REPLACED_MEDIA_ID}/excludedAt`,
    )).toBe(false);
    expect(Object.hasOwn(
      patch,
      `fieldPlatform/media/${REPLACED_MEDIA_ID}/excludedBy`,
    )).toBe(false);
    expect(Object.hasOwn(
      patch,
      `fieldPlatform/auditLogs/media-excluded-${REQUEST_ID}`,
    )).toBe(false);
    expect(deps.deleteStaging).toHaveBeenCalledWith(
      STAGING_PATH,
      SOURCE_GENERATION,
    );
  });
});

describe("safe map projection capture completion", () => {
  const project = (media: ProjectionMedia[]) => buildMapProjection({
    building: activeBuilding,
    listings: [],
    media,
    updatedAt: NOW,
  });

  it("returns notStarted with no finalized media and inProgress with one file", () => {
    expect(project([])?.captureStatus).toBe("notStarted");
    expect(project([
      finalizedProjectionMedia(SESSION_ID, "exterior", "photo"),
    ])?.captureStatus).toBe("inProgress");
  });

  it("returns complete when one session satisfies every required minimum", () => {
    expect(project(requiredSessionMedia())?.captureStatus).toBe("complete");
  });

  it("does not combine required media across capture sessions", () => {
    const split = requiredSessionMedia().map((media, index) => ({
      ...media,
      captureSessionId: index % 2 === 0
        ? SESSION_ID
        : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));
    expect(project(split)?.captureStatus).toBe("inProgress");
  });

  it("does not count excluded media or warning-quality vertical video", () => {
    const excluded = requiredSessionMedia().map((media) =>
      media.zone === "kitchen" ? { ...media, excludedAt: NOW } : media
    );
    const warningVideo = requiredSessionMedia().map((media) =>
      media.zone === "verticalVideo"
        ? { ...media, captureQualityState: "warning" }
        : media
    );
    expect(project(excluded)?.captureStatus).toBe("inProgress");
    expect(project(warningVideo)?.captureStatus).toBe("inProgress");
  });

  it("keeps legacy firebaseComplete media as presence-only compatibility", () => {
    expect(project([{
      buildingId: "building-1",
      uploadState: "firebaseComplete",
      captureSessionId: SESSION_ID,
      zone: "exterior",
      kind: "photo",
    }])?.captureStatus).toBe("inProgress");
  });
});

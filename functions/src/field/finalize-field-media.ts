import {
  captureSessionMeetsRequiredPolicy,
  finalizedPath,
  isSafeMediaPathSegment,
  sanitizeOriginalFileName,
  validateFinalizeInput,
  validateStoredObject,
  type MediaZone,
} from "./media-policy.js";
import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionListing,
  type ProjectionMedia,
} from "./map-projection.js";
import { buildDriveRecoveryKey } from "../drive/recovery-key.js";

export interface FinalizeFieldMediaInput {
  requestId: string;
  mediaId: string;
  captureSessionId: string;
  objectGeneration: string;
  stagingPath: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitId: string;
  kind: "photo" | "video";
  zone: MediaZone;
  slotId: string;
  required: boolean;
  originalFileName: string;
  capturedAt: string;
  replacesMediaId?: string;
  videoMetadata?: {
    durationSeconds: number;
    width: number;
    height: number;
  };
}

export interface FinalizeFieldMediaResult {
  mediaId: string;
  uploadState: "finalized";
  storagePath: string;
  driveSyncState: "queued";
  finalizedAt: string;
}

export interface StoredObject {
  generation: string;
  sizeBytes: number;
  contentType: string;
  md5Hash?: string;
  crc32c?: string;
  timeCreated?: string;
  customMetadata?: Record<string, string>;
}

export interface CopyToFinalizedInput {
  sourcePath: string;
  sourceGeneration: string;
  destinationPath: string;
  ifGenerationMatch: 0;
}

export type CopyToFinalizedResult =
  | {
      status: "copied";
      path: string;
      generation: string;
    }
  | { status: "alreadyExists" }
  | {
      path: string;
      generation: string;
    };

export interface FinalizeFieldMediaDependencies {
  isEnabled(uid: string): Promise<boolean>;
  isAssigned(buildingId: string, uid: string): Promise<boolean>;
  readMedia(mediaId: string): Promise<unknown | null>;
  readFinalizationAudit?(requestId: string): Promise<unknown | null>;
  readVisit(visitId: string): Promise<unknown | null>;
  readSession(captureSessionId: string): Promise<unknown | null>;
  readUnit(unitId: string): Promise<unknown | null>;
  readListing(listingId: string): Promise<unknown | null>;
  readBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  listBuildingListings(buildingId: string): Promise<ProjectionListing[]>;
  listFinalizedBuildingMedia(buildingId: string): Promise<ProjectionMedia[]>;
  inspectStagingObject(
    path: string,
    generation: string,
  ): Promise<StoredObject | null>;
  copyToFinalized(input: CopyToFinalizedInput): Promise<CopyToFinalizedResult>;
  inspectFinalizedObject(path: string): Promise<StoredObject | null>;
  writePatch(patch: Record<string, unknown>): Promise<void>;
  deleteStaging(path: string, generation: string): Promise<void>;
  now(): string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function actorForbidden(): never {
  throw new Error("field_media_forbidden");
}

function assertActor(
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
): asserts actor is { uid: string; role: "admin" | "staff" } {
  if (
    !isRecord(actor)
    || !isSafeMediaPathSegment(actor.uid)
    || (actor.role !== "admin" && actor.role !== "staff")
  ) {
    actorForbidden();
  }
}

function stableValueMatches(
  value: UnknownRecord,
  key: string,
  expected: unknown,
): boolean {
  return value[key] === expected;
}

function existingResult(
  existing: unknown,
  input: FinalizeFieldMediaInput,
  actorUid: string,
): FinalizeFieldMediaResult | null {
  if (!isRecord(existing)) return null;
  const originalFileName = sanitizeOriginalFileName(input.originalFileName);
  const stableFields: Record<string, unknown> = {
    id: input.mediaId,
    requestId: input.requestId,
    capturedBy: actorUid,
    captureSessionId: input.captureSessionId,
    visitId: input.visitId,
    buildingId: input.buildingId,
    unitId: input.unitId,
    listingId: input.listingId,
    kind: input.kind,
    zone: input.zone,
    slotId: input.slotId,
    required: input.required,
    originalFileName,
    capturedAt: input.capturedAt,
    replacesMediaId: input.replacesMediaId,
  };
  if (
    Object.entries(stableFields).some(
      ([key, expected]) => !stableValueMatches(existing, key, expected),
    )
    || existing.uploadState !== "finalized"
    || typeof existing.storagePath !== "string"
    || !isCanonicalIsoDateTime(existing.finalizedAt)
  ) {
    throw new Error("field_media_id_conflict");
  }
  return {
    mediaId: input.mediaId,
    uploadState: "finalized",
    storagePath: existing.storagePath,
    driveSyncState: "queued",
    finalizedAt: existing.finalizedAt,
  };
}

function assertRequestAuditAvailable(
  existingAudit: unknown,
  input: FinalizeFieldMediaInput,
  actorUid: string,
): void {
  if (existingAudit === null || existingAudit === undefined) return;
  if (
    !isRecord(existingAudit)
    || existingAudit.requestId !== input.requestId
    || existingAudit.entityId !== input.mediaId
    || existingAudit.actorId !== actorUid
  ) {
    throw new Error("field_media_id_conflict");
  }
  // The media and audit records are committed in the same root update. An
  // audit without its media record is therefore corrupt/conflicting state.
  throw new Error("field_media_id_conflict");
}

function assertVisitBinding(
  value: unknown,
  input: FinalizeFieldMediaInput,
  actorUid: string,
): void {
  if (
    !isRecord(value)
    || value.id !== input.visitId
    || value.buildingId !== input.buildingId
    || value.unitId !== input.unitId
    || value.listingId !== input.listingId
    || value.assignedUserId !== actorUid
  ) {
    throw new Error("field_media_visit_mismatch");
  }
}

function assertSessionBinding(
  value: unknown,
  input: FinalizeFieldMediaInput,
  actorUid: string,
): asserts value is UnknownRecord {
  if (
    !isRecord(value)
    || value.id !== input.captureSessionId
    || value.buildingId !== input.buildingId
    || value.unitId !== input.unitId
    || value.listingId !== input.listingId
    || value.visitId !== input.visitId
    || value.createdBy !== actorUid
    || (value.status !== "open" && value.status !== "complete")
  ) {
    throw new Error("field_media_session_mismatch");
  }
}

function assertUnitBinding(
  value: unknown,
  input: FinalizeFieldMediaInput,
): void {
  if (
    !isRecord(value)
    || value.id !== input.unitId
    || value.buildingId !== input.buildingId
  ) {
    throw new Error("field_media_unit_mismatch");
  }
}

function assertListingBinding(
  value: unknown,
  input: FinalizeFieldMediaInput,
): void {
  if (
    !isRecord(value)
    || value.id !== input.listingId
    || value.buildingId !== input.buildingId
    || value.unitId !== input.unitId
  ) {
    throw new Error("field_media_listing_mismatch");
  }
}

function isGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,30}$/.test(value);
}

function sameCustomMetadata(
  left: StoredObject["customMetadata"],
  right: StoredObject["customMetadata"],
): boolean {
  if (!left || !right) return left === right;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    );
}

function assertReusableDestination(
  source: StoredObject,
  destination: StoredObject | null,
): asserts destination is StoredObject {
  const sourceHasDigest =
    (typeof source.md5Hash === "string" && source.md5Hash.length > 0)
    || (typeof source.crc32c === "string" && source.crc32c.length > 0);
  if (
    !destination
    || !isGeneration(destination.generation)
    || destination.sizeBytes !== source.sizeBytes
    || destination.contentType !== source.contentType
    || !sourceHasDigest
    || (source.md5Hash !== undefined
      && destination.md5Hash !== source.md5Hash)
    || (source.crc32c !== undefined
      && destination.crc32c !== source.crc32c)
    || !sameCustomMetadata(
      destination.customMetadata,
      source.customMetadata,
    )
  ) {
    throw new Error("field_media_destination_conflict");
  }
}

function videoQuality(
  input: FinalizeFieldMediaInput,
): "valid" | "warning" {
  if (input.kind === "photo") return "valid";
  const metadata = input.videoMetadata;
  if (!metadata || !isRecord(metadata)) return "warning";
  return Number.isFinite(metadata.durationSeconds)
      && metadata.durationSeconds >= 10
      && metadata.durationSeconds <= 20
      && Number.isFinite(metadata.width)
      && Number.isFinite(metadata.height)
      && metadata.width > 0
      && metadata.height > metadata.width
    ? "valid"
    : "warning";
}

function finalizedMediaRecord(
  input: FinalizeFieldMediaInput,
  actorUid: string,
  object: StoredObject,
  storagePath: string,
  finalGeneration: string,
  finalizedAt: string,
): UnknownRecord {
  return {
    id: input.mediaId,
    requestId: input.requestId,
    buildingId: input.buildingId,
    ...(input.unitId === undefined ? {} : { unitId: input.unitId }),
    ...(input.listingId === undefined ? {} : { listingId: input.listingId }),
    visitId: input.visitId,
    captureSessionId: input.captureSessionId,
    capturedBy: actorUid,
    kind: input.kind,
    zone: input.zone,
    slotId: input.slotId,
    required: input.required,
    originalFileName: sanitizeOriginalFileName(input.originalFileName),
    mimeType: object.contentType,
    sizeBytes: object.sizeBytes,
    capturedAt: input.capturedAt,
    storagePath,
    uploadState: "finalized",
    uploadProgress: 100,
    driveSyncState: "queued",
    captureQualityState: videoQuality(input),
    objectGeneration: finalGeneration,
    ...(object.md5Hash === undefined
      ? {}
      : { objectMd5Hash: object.md5Hash }),
    ...(object.crc32c === undefined
      ? {}
      : { objectCrc32c: object.crc32c }),
    ...(input.replacesMediaId === undefined
      ? {}
      : { replacesMediaId: input.replacesMediaId }),
    advertisingApproved: false,
    finalizedAt,
  };
}

function driveJob(
  input: FinalizeFieldMediaInput,
  storagePath: string,
  finalGeneration: string,
  now: string,
): UnknownRecord {
  return {
    id: input.mediaId,
    mediaId: input.mediaId,
    buildingId: input.buildingId,
    ...(input.unitId === undefined ? {} : { unitId: input.unitId }),
    ...(input.listingId === undefined ? {} : { listingId: input.listingId }),
    storagePath,
    objectGeneration: finalGeneration,
    status: "queued",
    recoveryKey: buildDriveRecoveryKey("queued", now, input.mediaId),
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function replacementRecord(
  value: unknown,
  input: FinalizeFieldMediaInput,
): UnknownRecord | null {
  if (input.replacesMediaId === undefined) return null;
  const hasExcludedAt = isRecord(value) && value.excludedAt !== undefined;
  const hasExcludedBy = isRecord(value) && value.excludedBy !== undefined;
  if (
    !isRecord(value)
    || value.id !== input.replacesMediaId
    || value.buildingId !== input.buildingId
    || value.uploadState !== "finalized"
    || hasExcludedAt !== hasExcludedBy
    || (hasExcludedAt && !isCanonicalIsoDateTime(value.excludedAt))
    || (hasExcludedBy && !isSafeMediaPathSegment(value.excludedBy))
  ) {
    throw new Error("field_media_replacement_conflict");
  }
  return value;
}

export async function finalizeFieldMediaCore(
  input: FinalizeFieldMediaInput,
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
  dependencies: FinalizeFieldMediaDependencies,
): Promise<FinalizeFieldMediaResult> {
  validateFinalizeInput(input);
  assertActor(actor);
  if (await dependencies.isEnabled(actor.uid) !== true) actorForbidden();
  if (
    actor.role === "staff"
    && await dependencies.isAssigned(input.buildingId, actor.uid) !== true
  ) {
    throw new Error("field_building_assignment_required");
  }

  const existing = await dependencies.readMedia(input.mediaId);
  if (existing !== null && existing !== undefined) {
    const result = existingResult(existing, input, actor.uid);
    if (result) return result;
  }
  if (dependencies.readFinalizationAudit) {
    assertRequestAuditAvailable(
      await dependencies.readFinalizationAudit(input.requestId),
      input,
      actor.uid,
    );
  }
  const replacement = input.replacesMediaId === undefined
    ? null
    : replacementRecord(
        await dependencies.readMedia(input.replacesMediaId),
        input,
      );

  const [visit, session] = await Promise.all([
    dependencies.readVisit(input.visitId),
    dependencies.readSession(input.captureSessionId),
  ]);
  assertVisitBinding(visit, input, actor.uid);
  assertSessionBinding(session, input, actor.uid);
  if (input.unitId !== undefined) {
    assertUnitBinding(await dependencies.readUnit(input.unitId), input);
  }
  if (input.listingId !== undefined) {
    assertListingBinding(await dependencies.readListing(input.listingId), input);
  }

  const sourceObject = await dependencies.inspectStagingObject(
    input.stagingPath,
    input.objectGeneration,
  );
  if (!sourceObject) throw new Error("field_media_object_missing");
  validateStoredObject(input, actor.uid, sourceObject);

  const destinationPath = finalizedPath(
    input.buildingId,
    input.mediaId,
    sourceObject.contentType,
  );
  const copyResult = await dependencies.copyToFinalized({
    sourcePath: input.stagingPath,
    sourceGeneration: input.objectGeneration,
    destinationPath,
    ifGenerationMatch: 0,
  });
  let finalGeneration: string;
  if (!("status" in copyResult) || copyResult.status === "copied") {
    if (
      copyResult.path !== destinationPath
      || !isGeneration(copyResult.generation)
    ) {
      throw new Error("field_media_destination_conflict");
    }
    finalGeneration = copyResult.generation;
  } else if (copyResult.status === "alreadyExists") {
    const destination = await dependencies.inspectFinalizedObject(
      destinationPath,
    );
    assertReusableDestination(sourceObject, destination);
    finalGeneration = destination.generation;
  } else {
    throw new Error("field_media_destination_conflict");
  }

  const now = dependencies.now();
  if (!isCanonicalIsoDateTime(now)) {
    throw new Error("field_media_state_invalid");
  }
  const [building, listings, existingBuildingMedia] = await Promise.all([
    dependencies.readBuilding(input.buildingId),
    dependencies.listBuildingListings(input.buildingId),
    dependencies.listFinalizedBuildingMedia(input.buildingId),
  ]);
  const mediaRecord = finalizedMediaRecord(
    input,
    actor.uid,
    sourceObject,
    destinationPath,
    finalGeneration,
    now,
  );
  const shouldExcludeReplacement = replacement !== null
    && replacement.excludedAt === undefined;
  let replacementFound = false;
  const mediaForProjection = existingBuildingMedia.map((item) => {
    if (
      replacement === null
      || (item as ProjectionMedia & { id?: unknown }).id !== replacement.id
    ) {
      return item;
    }
    replacementFound = true;
    return shouldExcludeReplacement
      ? { ...item, excludedAt: now, excludedBy: actor.uid }
      : replacement as unknown as ProjectionMedia;
  });
  if (replacement !== null && !replacementFound) {
    mediaForProjection.push(shouldExcludeReplacement
      ? {
          ...(replacement as unknown as ProjectionMedia),
          excludedAt: now,
          excludedBy: actor.uid,
        }
      : replacement as unknown as ProjectionMedia);
  }
  mediaForProjection.push(mediaRecord as unknown as ProjectionMedia);
  const projection = buildMapProjection({
    building,
    listings,
    media: mediaForProjection,
    updatedAt: now,
  });
  const auditId = `media-finalized-${input.requestId}`;
  const patch: Record<string, unknown> = {
    [`fieldPlatform/media/${input.mediaId}`]: mediaRecord,
    [`fieldPlatform/driveSyncJobs/${input.mediaId}`]: driveJob(
      input,
      destinationPath,
      finalGeneration,
      now,
    ),
    [`fieldPlatform/auditLogs/${auditId}`]: {
      id: auditId,
      actorId: actor.uid,
      action: "media.finalized",
      entityType: "media",
      entityId: input.mediaId,
      occurredAt: now,
      requestId: input.requestId,
    },
    ...(!shouldExcludeReplacement
      ? {}
      : {
          [`fieldPlatform/media/${replacement.id as string}/excludedAt`]: now,
          [`fieldPlatform/media/${replacement.id as string}/excludedBy`]: actor.uid,
          [`fieldPlatform/auditLogs/media-excluded-${input.requestId}`]: {
            id: `media-excluded-${input.requestId}`,
            actorId: actor.uid,
            action: "media.excluded",
            entityType: "media",
            entityId: replacement.id,
            occurredAt: now,
            requestId: input.requestId,
            changes: {
              replacedByMediaId: { after: input.mediaId },
            },
          },
        }),
    [`fieldPlatform/captureSessions/${input.captureSessionId}/updatedAt`]: now,
    [`fieldPlatform/captureSessions/${input.captureSessionId}/status`]:
      captureSessionMeetsRequiredPolicy(
        mediaForProjection,
        input.captureSessionId,
      )
        ? "complete"
        : "open",
    ...(projection === null
      ? {}
      : { [`fieldPlatform/mapProjections/${input.buildingId}`]: projection }),
  };

  await dependencies.writePatch(patch);
  try {
    await dependencies.deleteStaging(
      input.stagingPath,
      input.objectGeneration,
    );
  } catch {
    // A scheduled cleanup owns exact-generation staging residue. Database
    // finalization and the durable Drive outbox remain committed.
  }

  return {
    mediaId: input.mediaId,
    uploadState: "finalized",
    storagePath: destinationPath,
    driveSyncState: "queued",
    finalizedAt: now,
  };
}

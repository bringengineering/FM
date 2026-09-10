import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionListing,
  type ProjectionMedia,
} from "./map-projection.js";
import { isRfc4122Uuid, isSafeMediaPathSegment } from "./media-policy.js";

export interface ExcludeFieldMediaInput {
  mediaId: string;
  requestId: string;
}

export interface ExcludeFieldMediaResult {
  mediaId: string;
  excludedAt: string;
  excludedBy: string;
}

type ListedProjectionMedia = ProjectionMedia & { id?: unknown };

export interface ExcludeFieldMediaDependencies {
  isEnabled(uid: string): Promise<boolean>;
  isAssigned(buildingId: string, uid: string): Promise<boolean>;
  readMedia(mediaId: string): Promise<unknown | null>;
  readAudit(requestId: string): Promise<unknown | null>;
  readBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  listBuildingListings(buildingId: string): Promise<ProjectionListing[]>;
  listBuildingMedia(buildingId: string): Promise<ListedProjectionMedia[]>;
  writePatch(patch: Record<string, unknown>): Promise<void>;
  now(): string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function forbidden(): never {
  throw new Error("field_media_exclusion_forbidden");
}

function idempotentResult(
  media: UnknownRecord,
  audit: unknown,
  input: ExcludeFieldMediaInput,
  actorUid: string,
): ExcludeFieldMediaResult | null {
  if (audit === null || audit === undefined) {
    if (media.excludedAt !== undefined || media.excludedBy !== undefined) {
      throw new Error("field_media_exclusion_conflict");
    }
    return null;
  }
  if (
    !isRecord(audit)
    || audit.requestId !== input.requestId
    || audit.entityId !== input.mediaId
    || audit.actorId !== actorUid
  ) {
    throw new Error("field_media_exclusion_request_conflict");
  }
  if (
    !canonicalIso(media.excludedAt)
    || media.excludedBy !== actorUid
    || audit.occurredAt !== media.excludedAt
  ) {
    throw new Error("field_media_exclusion_conflict");
  }
  return {
    mediaId: input.mediaId,
    excludedAt: media.excludedAt,
    excludedBy: actorUid,
  };
}

export async function excludeFieldMediaCore(
  input: ExcludeFieldMediaInput,
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
  dependencies: ExcludeFieldMediaDependencies,
): Promise<ExcludeFieldMediaResult> {
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.mediaId)
    || !isRfc4122Uuid(input.requestId)
    || !isRecord(actor)
    || !isSafeMediaPathSegment(actor.uid)
    || !["admin", "staff", "reviewer"].includes(actor.role)
  ) {
    throw new Error("field_media_exclusion_invalid");
  }
  if (await dependencies.isEnabled(actor.uid) !== true) forbidden();
  const media = await dependencies.readMedia(input.mediaId);
  if (!isRecord(media) || media.id !== input.mediaId) {
    throw new Error("field_media_not_found");
  }
  if (media.uploadState !== "finalized") {
    throw new Error("field_media_not_finalized");
  }
  if (!isSafeMediaPathSegment(media.buildingId)) {
    throw new Error("field_media_exclusion_state_invalid");
  }
  if (
    actor.role === "staff"
    && await dependencies.isAssigned(media.buildingId, actor.uid) !== true
  ) {
    forbidden();
  }
  const audit = await dependencies.readAudit(input.requestId);
  const replay = idempotentResult(media, audit, input, actor.uid);
  if (replay) return replay;

  const now = dependencies.now();
  if (!canonicalIso(now)) {
    throw new Error("field_media_exclusion_state_invalid");
  }
  const [building, listings, existingMedia] = await Promise.all([
    dependencies.readBuilding(media.buildingId),
    dependencies.listBuildingListings(media.buildingId),
    dependencies.listBuildingMedia(media.buildingId),
  ]);
  let found = false;
  const excludedMedia = existingMedia.map((item) => {
    if (item.id !== input.mediaId) return item;
    found = true;
    return { ...item, excludedAt: now, excludedBy: actor.uid };
  });
  if (!found) {
    excludedMedia.push({
      ...(media as unknown as ListedProjectionMedia),
      excludedAt: now,
      excludedBy: actor.uid,
    });
  }
  const projection = buildMapProjection({
    building,
    listings,
    media: excludedMedia,
    updatedAt: now,
  });
  const auditId = `media-excluded-${input.requestId}`;
  const patch: Record<string, unknown> = {
    [`fieldPlatform/media/${input.mediaId}/excludedAt`]: now,
    [`fieldPlatform/media/${input.mediaId}/excludedBy`]: actor.uid,
    [`fieldPlatform/auditLogs/${auditId}`]: {
      id: auditId,
      actorId: actor.uid,
      action: "media.excluded",
      entityType: "media",
      entityId: input.mediaId,
      occurredAt: now,
      requestId: input.requestId,
    },
    ...(projection === null
      ? {}
      : { [`fieldPlatform/mapProjections/${media.buildingId}`]: projection }),
  };
  await dependencies.writePatch(patch);
  return { mediaId: input.mediaId, excludedAt: now, excludedBy: actor.uid };
}

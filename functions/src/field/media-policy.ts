import type {
  FinalizeFieldMediaInput,
  StoredObject,
} from "./finalize-field-media.js";

const MEBIBYTE = 1_024 * 1_024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/;
const SLOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PATH_SEGMENT_BYTES = 128;
const MAX_FILE_NAME_CHARACTERS = 255;

export type MediaKind = "photo" | "video";
export type MediaZone =
  | "exterior"
  | "accessRoad"
  | "parking"
  | "commonEntrance"
  | "corridorStairs"
  | "recycling"
  | "roomOverview"
  | "windowDaylight"
  | "kitchen"
  | "bathroom"
  | "optionsStorage"
  | "boilerEquipment"
  | "repairEvidence"
  | "verticalVideo";

export const MEDIA_POLICY = Object.freeze({
  photo: Object.freeze({
    maxBytes: 25 * MEBIBYTE,
    mimeToExtension: Object.freeze({
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    }),
  }),
  video: Object.freeze({
    maxBytes: 500 * MEBIBYTE,
    mimeToExtension: Object.freeze({
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
    }),
  }),
});

export interface CaptureZonePolicy {
  id: MediaZone;
  scope: "building" | "unit";
  kind: MediaKind;
  required: boolean;
  minimum: number;
}

export const CAPTURE_ZONES = Object.freeze([
  { id: "exterior", scope: "building", kind: "photo", required: true, minimum: 1 },
  { id: "accessRoad", scope: "building", kind: "photo", required: true, minimum: 1 },
  { id: "parking", scope: "building", kind: "photo", required: false, minimum: 1 },
  { id: "commonEntrance", scope: "building", kind: "photo", required: true, minimum: 1 },
  { id: "corridorStairs", scope: "building", kind: "photo", required: false, minimum: 1 },
  { id: "recycling", scope: "building", kind: "photo", required: false, minimum: 1 },
  { id: "roomOverview", scope: "unit", kind: "photo", required: true, minimum: 2 },
  { id: "windowDaylight", scope: "unit", kind: "photo", required: true, minimum: 1 },
  { id: "kitchen", scope: "unit", kind: "photo", required: true, minimum: 1 },
  { id: "bathroom", scope: "unit", kind: "photo", required: true, minimum: 1 },
  { id: "optionsStorage", scope: "unit", kind: "photo", required: false, minimum: 1 },
  { id: "boilerEquipment", scope: "unit", kind: "photo", required: true, minimum: 1 },
  { id: "repairEvidence", scope: "unit", kind: "photo", required: false, minimum: 1 },
  { id: "verticalVideo", scope: "unit", kind: "video", required: true, minimum: 1 },
] as const satisfies readonly CaptureZonePolicy[]);

export interface CaptureCompletionCandidate {
  uploadState?: unknown;
  captureSessionId?: unknown;
  kind?: unknown;
  zone?: unknown;
  captureQualityState?: unknown;
  excludedAt?: unknown;
}

export function captureSessionMeetsRequiredPolicy(
  media: readonly CaptureCompletionCandidate[],
  captureSessionId: string,
): boolean {
  const eligible = media.filter(
    (item) =>
      item.uploadState === "finalized"
      && item.captureSessionId === captureSessionId
      && (item.excludedAt === undefined || item.excludedAt === null),
  );
  return CAPTURE_ZONES.filter((zone) => zone.required).every((zone) => {
    const count = eligible.filter(
      (item) =>
        item.zone === zone.id
        && item.kind === zone.kind
        && (zone.id !== "verticalVideo"
          || item.captureQualityState === "valid"),
    ).length;
    return count >= zone.minimum;
  });
}

const ZONE_BY_ID = new Map<MediaZone, CaptureZonePolicy>(
  CAPTURE_ZONES.map((zone) => [zone.id, zone]),
);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("field_media_invalid");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function isRfc4122Uuid(value: unknown): value is string {
  return typeof value === "string"
    && value !== NIL_UUID
    && UUID_PATTERN.test(value);
}

export function isSafeMediaPathSegment(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && value !== "."
    && value !== ".."
    && byteLength(value) <= MAX_PATH_SEGMENT_BYTES
    && !/[\\/#$\[\]\u0000-\u001f\u007f]/u.test(value);
}

function isCanonicalIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function kindAndExtensionForMime(contentType: unknown): {
  kind: MediaKind;
  extension: string;
} | null {
  if (typeof contentType !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(
    MEDIA_POLICY.photo.mimeToExtension,
    contentType,
  )) {
    return {
      kind: "photo",
      extension: MEDIA_POLICY.photo.mimeToExtension[
        contentType as keyof typeof MEDIA_POLICY.photo.mimeToExtension
      ],
    };
  }
  if (Object.prototype.hasOwnProperty.call(
    MEDIA_POLICY.video.mimeToExtension,
    contentType,
  )) {
    return {
      kind: "video",
      extension: MEDIA_POLICY.video.mimeToExtension[
        contentType as keyof typeof MEDIA_POLICY.video.mimeToExtension
      ],
    };
  }
  return null;
}

function captureZone(value: unknown): CaptureZonePolicy {
  if (typeof value !== "string") return invalid();
  const policy = ZONE_BY_ID.get(value as MediaZone);
  return policy ?? invalid();
}

function allowedExtensions(kind: MediaKind): ReadonlySet<string> {
  return new Set(Object.values(MEDIA_POLICY[kind].mimeToExtension));
}

export function sanitizeOriginalFileName(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const segments = value.split(/[\\/]/u);
  const baseName = (segments[segments.length - 1] ?? "").trim();
  if (
    baseName.length === 0
    || baseName === "."
    || baseName === ".."
    || /[\u0000-\u001f\u007f]/u.test(baseName)
  ) {
    return invalid();
  }
  return [...baseName].slice(0, MAX_FILE_NAME_CHARACTERS).join("");
}

export function validateFinalizeInput(input: FinalizeFieldMediaInput): void {
  if (!isRecord(input)) invalid();
  if (
    !isRfc4122Uuid(input.requestId)
    || !isRfc4122Uuid(input.mediaId)
    || !isRfc4122Uuid(input.captureSessionId)
    || typeof input.objectGeneration !== "string"
    || !GENERATION_PATTERN.test(input.objectGeneration)
    || !isSafeMediaPathSegment(input.buildingId)
    || !isSafeMediaPathSegment(input.visitId)
    || (input.unitId !== undefined && !isSafeMediaPathSegment(input.unitId))
    || (input.listingId !== undefined && !isSafeMediaPathSegment(input.listingId))
    || (input.replacesMediaId !== undefined
      && !isRfc4122Uuid(input.replacesMediaId))
    || (input.kind !== "photo" && input.kind !== "video")
    || typeof input.slotId !== "string"
    || !SLOT_ID_PATTERN.test(input.slotId)
    || typeof input.required !== "boolean"
    || !isCanonicalIsoDateTime(input.capturedAt)
  ) {
    invalid();
  }

  const zone = captureZone(input.zone);
  if (zone.kind !== input.kind || zone.required !== input.required) invalid();
  sanitizeOriginalFileName(input.originalFileName);

  if (typeof input.stagingPath !== "string") invalid();
  const expectedSegmentCount = input.stagingPath.split("/").length;
  if (expectedSegmentCount !== 5) invalid();
  const [root, uid, sessionId, collection, fileName] =
    input.stagingPath.split("/");
  if (
    root !== "field-media"
    || !isSafeMediaPathSegment(uid)
    || sessionId !== input.captureSessionId
    || collection !== (input.kind === "photo" ? "photos" : "videos")
  ) {
    invalid();
  }
  const match = /^([0-9a-f-]+)\.([A-Za-z0-9]+)$/.exec(fileName ?? "");
  if (
    !match
    || match[1] !== input.mediaId
    || !allowedExtensions(input.kind).has(match[2].toLowerCase())
  ) {
    invalid();
  }
}

export function validateStoredObject(
  input: FinalizeFieldMediaInput,
  actorUid: string,
  object: StoredObject,
): void {
  if (!isRecord(object)) throw new Error("field_media_object_missing");
  if (object.generation !== input.objectGeneration) {
    throw new Error("field_media_generation_mismatch");
  }
  const mimePolicy = kindAndExtensionForMime(object.contentType);
  if (!mimePolicy) throw new Error("field_media_mime_not_allowed");
  if (mimePolicy.kind !== input.kind) {
    throw new Error("field_media_kind_mismatch");
  }
  if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes <= 0) {
    throw new Error("field_media_size_invalid");
  }
  if (object.sizeBytes > MEDIA_POLICY[mimePolicy.kind].maxBytes) {
    throw new Error("field_media_too_large");
  }

  const expectedPath = [
    "field-media",
    actorUid,
    input.captureSessionId,
    input.kind === "photo" ? "photos" : "videos",
    `${input.mediaId}.${mimePolicy.extension}`,
  ].join("/");
  if (input.stagingPath !== expectedPath) {
    throw new Error("field_media_path_mismatch");
  }

  const metadata = object.customMetadata;
  if (
    !isRecord(metadata)
    || Object.keys(metadata).length !== 3
    || metadata.capturedBy !== actorUid
    || metadata.mediaId !== input.mediaId
    || metadata.captureSessionId !== input.captureSessionId
  ) {
    throw new Error("field_media_metadata_mismatch");
  }
}

export function finalizedPath(
  buildingId: string,
  mediaId: string,
  contentType: string,
): string {
  if (!isSafeMediaPathSegment(buildingId) || !isRfc4122Uuid(mediaId)) {
    invalid();
  }
  const policy = kindAndExtensionForMime(contentType);
  if (!policy) throw new Error("field_media_mime_not_allowed");
  return `field-media-finalized/${buildingId}/${mediaId}.${policy.extension}`;
}

import type { MediaKind, MediaZone } from "./types";

const MEBIBYTE = 1_024 * 1_024;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_PATH_SEGMENT_BYTES = 128;
const SLOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export const MEDIA_POLICY = {
  photo: {
    maxBytes: 25 * MEBIBYTE,
    mimeToExtension: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    },
  },
  video: {
    maxBytes: 500 * MEBIBYTE,
    mimeToExtension: {
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
    },
  },
} as const;

export interface CaptureZoneDefinition {
  id: MediaZone;
  label: string;
  scope: "building" | "unit";
  kind: MediaKind;
  required: boolean;
  minimum: number;
  guide: string;
}

export const CAPTURE_ZONES = [
  {
    id: "exterior",
    label: "외관",
    scope: "building",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "건물 전체와 상호·출입구가 함께 보이게 촬영",
  },
  {
    id: "accessRoad",
    label: "도로·진입부",
    scope: "building",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "차량과 보행 진입 동선이 보이게 촬영",
  },
  {
    id: "parking",
    label: "주차",
    scope: "building",
    kind: "photo",
    required: false,
    minimum: 1,
    guide: "주차 위치와 진입 동선을 촬영",
  },
  {
    id: "commonEntrance",
    label: "공동현관",
    scope: "building",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "출입문과 공동현관 상태를 촬영",
  },
  {
    id: "corridorStairs",
    label: "복도·계단",
    scope: "building",
    kind: "photo",
    required: false,
    minimum: 1,
    guide: "호실까지 이어지는 공용 동선을 촬영",
  },
  {
    id: "recycling",
    label: "분리수거장",
    scope: "building",
    kind: "photo",
    required: false,
    minimum: 1,
    guide: "분리수거 위치와 이용 동선을 촬영",
  },
  {
    id: "roomOverview",
    label: "전체구조",
    scope: "unit",
    kind: "photo",
    required: true,
    minimum: 2,
    guide: "방 모서리에서 반대 방향으로 두 장 촬영",
  },
  {
    id: "windowDaylight",
    label: "창문·채광",
    scope: "unit",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "창 크기와 채광이 함께 보이게 촬영",
  },
  {
    id: "kitchen",
    label: "주방",
    scope: "unit",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "싱크대와 조리 공간 전체를 촬영",
  },
  {
    id: "bathroom",
    label: "욕실",
    scope: "unit",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "변기·세면대·샤워 공간이 보이게 촬영",
  },
  {
    id: "optionsStorage",
    label: "옵션·수납",
    scope: "unit",
    kind: "photo",
    required: false,
    minimum: 1,
    guide: "제공 옵션과 수납공간을 촬영",
  },
  {
    id: "boilerEquipment",
    label: "보일러·설비",
    scope: "unit",
    kind: "photo",
    required: true,
    minimum: 1,
    guide: "보일러와 주요 설비 상태를 촬영",
  },
  {
    id: "repairEvidence",
    label: "수리 필요부분",
    scope: "unit",
    kind: "photo",
    required: false,
    minimum: 1,
    guide: "문제가 있는 위치의 전체 모습과 손상 부위를 촬영",
  },
  {
    id: "verticalVideo",
    label: "10~20초 세로영상",
    scope: "unit",
    kind: "video",
    required: true,
    minimum: 1,
    guide: "현관에서 방 전체를 세로로 천천히 촬영",
  },
] as const satisfies readonly CaptureZoneDefinition[];

export type AllowedPhotoMime = keyof typeof MEDIA_POLICY.photo.mimeToExtension;
export type AllowedVideoMime = keyof typeof MEDIA_POLICY.video.mimeToExtension;
export type AllowedMediaMime = AllowedPhotoMime | AllowedVideoMime;

export interface CaptureFileLike {
  name: string;
  type: string;
  size: number;
  lastModified?: number;
}

export interface CaptureAttachmentDescriptor {
  mediaId: string;
  captureSessionId: string;
  kind: MediaKind;
  zone: MediaZone;
  slotId: string;
  required: boolean;
  originalFileName: string;
  mimeType: AllowedMediaMime;
  sizeBytes: number;
  lastModified: number;
  capturedAt: string;
  uploadState: "queued";
  uploadProgress: 0;
}

export interface DescribeCaptureFileInput {
  mediaId: string;
  captureSessionId: string;
  zone: MediaZone;
  slotId: string;
  required?: boolean;
}

const ZONES_BY_ID = new Map<MediaZone, CaptureZoneDefinition>(
  CAPTURE_ZONES.map((zone) => [zone.id, zone]),
);

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    bytes += codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
          ? 3
          : 4;
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function mediaKindForMime(mimeType: string): MediaKind | null {
  if (Object.prototype.hasOwnProperty.call(
    MEDIA_POLICY.photo.mimeToExtension,
    mimeType,
  )) {
    return "photo";
  }
  if (Object.prototype.hasOwnProperty.call(
    MEDIA_POLICY.video.mimeToExtension,
    mimeType,
  )) {
    return "video";
  }
  return null;
}

function extensionForMime(
  kind: MediaKind,
  mimeType: string,
): string | null {
  if (kind === "photo") {
    return MEDIA_POLICY.photo.mimeToExtension[
      mimeType as AllowedPhotoMime
    ] || null;
  }
  return MEDIA_POLICY.video.mimeToExtension[
    mimeType as AllowedVideoMime
  ] || null;
}

function validFileName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0
    && [...trimmed].length <= MAX_FILE_NAME_LENGTH
    && trimmed !== "."
    && trimmed !== ".."
    && !/[\\/\u0000-\u001f\u007f]/u.test(trimmed);
}

function captureZone(value: unknown): CaptureZoneDefinition {
  if (typeof value !== "string") throw new Error("capture_zone_invalid");
  const zone = ZONES_BY_ID.get(value as MediaZone);
  if (!zone) throw new Error("capture_zone_invalid");
  return zone;
}

export function isSafePathSegment(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || value === "."
    || value === ".."
    || utf8ByteLength(value) > MAX_PATH_SEGMENT_BYTES
  ) {
    return false;
  }
  return !/[\\/.#$\[\]\u0000-\u001f\u007f]/u.test(value);
}

export function isSafeCaptureId(value: unknown): value is string {
  return typeof value === "string"
    && value !== NIL_UUID
    && UUID_PATTERN.test(value);
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

export function describeCaptureFile(
  file: CaptureFileLike,
  input: DescribeCaptureFileInput,
  now: () => string = () => new Date().toISOString(),
): CaptureAttachmentDescriptor {
  if (!isRecord(file) || !validFileName(file.name)) {
    throw new Error("capture_file_name_invalid");
  }
  if (typeof file.type !== "string") {
    throw new Error("capture_mime_not_allowed");
  }
  const kind = mediaKindForMime(file.type);
  if (!kind) throw new Error("capture_mime_not_allowed");

  const zone = captureZone(input.zone);
  if (kind !== zone.kind) throw new Error("capture_kind_mismatch");
  if (!isSafeCaptureId(input.mediaId) || !isSafeCaptureId(input.captureSessionId)) {
    throw new Error("capture_id_invalid");
  }
  if (!SLOT_ID_PATTERN.test(input.slotId)) {
    throw new Error("capture_slot_id_invalid");
  }
  if (input.required !== undefined && input.required !== zone.required) {
    throw new Error("capture_required_mismatch");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error("capture_file_size_invalid");
  }
  if (file.size === 0) throw new Error("capture_file_empty");
  if (file.size > MEDIA_POLICY[kind].maxBytes) {
    throw new Error("capture_file_too_large");
  }

  const lastModified = file.lastModified ?? 0;
  if (!Number.isSafeInteger(lastModified) || lastModified < 0) {
    throw new Error("capture_file_last_modified_invalid");
  }
  const capturedAt = now();
  if (!isCanonicalIsoTimestamp(capturedAt)) {
    throw new Error("capture_timestamp_invalid");
  }

  return {
    mediaId: input.mediaId,
    captureSessionId: input.captureSessionId,
    kind,
    zone: zone.id,
    slotId: input.slotId,
    required: zone.required,
    originalFileName: file.name.trim(),
    mimeType: file.type as AllowedMediaMime,
    sizeBytes: file.size,
    lastModified,
    capturedAt,
    uploadState: "queued",
    uploadProgress: 0,
  };
}

export function buildStagingPath(
  uid: string,
  descriptor: CaptureAttachmentDescriptor,
): string {
  if (!isSafePathSegment(uid)) throw new Error("capture_uid_invalid");
  if (
    !isRecord(descriptor)
    || !isSafeCaptureId(descriptor.mediaId)
    || !isSafeCaptureId(descriptor.captureSessionId)
  ) {
    throw new Error("capture_id_invalid");
  }

  const zone = captureZone(descriptor.zone);
  const mimeKind = mediaKindForMime(descriptor.mimeType);
  if (
    !mimeKind
    || descriptor.kind !== mimeKind
    || descriptor.kind !== zone.kind
  ) {
    throw new Error("capture_kind_mismatch");
  }
  if (!SLOT_ID_PATTERN.test(descriptor.slotId)) {
    throw new Error("capture_slot_id_invalid");
  }
  if (descriptor.required !== zone.required) {
    throw new Error("capture_required_mismatch");
  }

  const extension = extensionForMime(descriptor.kind, descriptor.mimeType);
  if (!extension) throw new Error("capture_mime_not_allowed");
  const collection = descriptor.kind === "photo" ? "photos" : "videos";
  return [
    "field-media",
    uid,
    descriptor.captureSessionId,
    collection,
    `${descriptor.mediaId}.${extension}`,
  ].join("/");
}

export function evaluateVerticalVideo(input: {
  durationSeconds: number;
  width: number;
  height: number;
}): { countsAsComplete: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const validDuration = Number.isFinite(input.durationSeconds)
    && input.durationSeconds >= 10
    && input.durationSeconds <= 20;
  const portrait = Number.isFinite(input.width)
    && Number.isFinite(input.height)
    && input.width > 0
    && input.height > input.width;

  if (!validDuration) warnings.push("영상은 10~20초로 촬영해 주세요.");
  if (!portrait) warnings.push("휴대전화를 세로로 들고 촬영해 주세요.");
  return { countsAsComplete: warnings.length === 0, warnings };
}

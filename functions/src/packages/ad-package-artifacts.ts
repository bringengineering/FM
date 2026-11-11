import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  CAPTURE_ZONES,
  finalizedPath,
  isRfc4122Uuid,
  isSafeMediaPathSegment,
  MEDIA_POLICY,
} from "../field/media-policy.js";

export const ARTIFACT_SET_VERSION = 1 as const;

const MAX_MEDIA = 100;
const MAX_REPRESENTATIVE_MEDIA = 20;
const MAX_TEXT_BYTES = 64 * 1_024;
const MAX_SHORT_TEXT_BYTES = 512;
const MAX_LONG_TEXT_BYTES = 4 * 1_024;
const MAX_ARRAY_ITEMS = 50;
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;
const DRIVE_MD5_PATTERN = /^[0-9a-f]{32}$/u;
const PACKAGE_ID_PATTERN = /^ad-package-([0-9a-f-]{36})$/u;

type UnknownRecord = Record<string, unknown>;

export interface FrozenMediaManifestItem {
  id: string;
  buildingId: string;
  captureSessionId: string;
  kind: "photo" | "video";
  zone: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  storagePath: string;
  objectGeneration: string;
  driveMd5Checksum: string;
  captureQualityState?: "valid" | "warning";
  advertisingOrder: number;
}

export interface FrozenNaverListingFields {
  buildingName: string;
  roadAddress: string;
  unitLabel: string;
  depositWon: number;
  monthlyRentWon: number;
  maintenanceFeeWon: number;
  maintenanceFeeItems: string[];
  availableFrom: string;
  structure: string;
  floor: number | "";
  direction: string;
  parkingAvailable: boolean;
  parkingTotalSpaces: number | "";
  parkingDescription: string;
  petPolicy: string;
  options: string[];
  locationDescription: string;
  representativeMediaIds: string[];
}

export interface FrozenAdPackageSource {
  id: string;
  listingId: string;
  buildingId: string;
  version: number;
  artifactSetVersion: typeof ARTIFACT_SET_VERSION;
  captureSessionId: string;
  representativeMediaIds: string[];
  allApprovedMediaIds: string[];
  mediaManifest: FrozenMediaManifestItem[];
  daangnDescription: string;
  naverListingFields: FrozenNaverListingFields;
}

export interface AdPackageMediaArtifact {
  artifactKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum: string;
  sourceMediaId: string;
  sourceObjectGeneration: string;
}

export interface AdPackageTextArtifact {
  artifactKey: "daangn-text" | "naver-text";
  name: "04_당근_매물설명.txt" | "05_네이버부동산_입력정보.txt";
  mimeType: "text/plain";
  bytes: Uint8Array;
  sizeBytes: number;
  md5Checksum: string;
}

export interface AdPackageArtifacts {
  packageId: string;
  version: number;
  artifactSetVersion: typeof ARTIFACT_SET_VERSION;
  sourceFingerprint: string;
  packageFolderName: string;
  representativePhotos: AdPackageMediaArtifact[];
  originalPhotos: AdPackageMediaArtifact[];
  verticalVideos: AdPackageMediaArtifact[];
  daangn: AdPackageTextArtifact;
  naver: AdPackageTextArtifact;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("ad_package_artifact_source_invalid");
}

export function storageBase64Md5ToDriveHex(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new Error("ad_package_media_checksum_invalid");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    throw new Error("ad_package_media_checksum_invalid");
  }
  if (bytes.length !== 16 || bytes.toString("base64") !== value) {
    throw new Error("ad_package_media_checksum_invalid");
  }
  return bytes.toString("hex");
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function boundedString(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
): value is string {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function boundedScalarString(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
): value is string {
  return boundedString(value, maximumBytes, allowEmpty)
    && !/[\r\n\t]/u.test(value);
}

function boundedStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_ARRAY_ITEMS
    && value.every((item) => boundedScalarString(item, MAX_SHORT_TEXT_BYTES));
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalValue(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  return invalid();
}

function strictExtension(kind: "photo" | "video", mimeType: string): string {
  const map = MEDIA_POLICY[kind].mimeToExtension as Record<string, string>;
  const extension = map[mimeType];
  return extension ?? invalid();
}

function frozenMedia(value: unknown, expectedOrder: number): FrozenMediaManifestItem {
  if (!isRecord(value)) return invalid();
  const kind = value.kind;
  if (kind !== "photo" && kind !== "video") return invalid();
  const zone = CAPTURE_ZONES.find((item) => item.id === value.zone);
  if (
    zone === undefined
    || zone.kind !== kind
    || !isRfc4122Uuid(value.id)
    || !isSafeMediaPathSegment(value.buildingId)
    || !isRfc4122Uuid(value.captureSessionId)
    || !isSafeMediaPathSegment(value.zone)
    || typeof value.mimeType !== "string"
    || !nonnegativeInteger(value.sizeBytes)
    || value.sizeBytes < 1
    || value.sizeBytes > MEDIA_POLICY[kind].maxBytes
    || !canonicalIso(value.capturedAt)
    || typeof value.objectGeneration !== "string"
    || !GENERATION_PATTERN.test(value.objectGeneration)
    || typeof value.driveMd5Checksum !== "string"
    || !DRIVE_MD5_PATTERN.test(value.driveMd5Checksum)
    || (value.captureQualityState !== undefined
      && value.captureQualityState !== "valid"
      && value.captureQualityState !== "warning")
    || (zone.id === "verticalVideo" && value.captureQualityState !== "valid")
    || value.advertisingOrder !== expectedOrder
    || typeof value.storagePath !== "string"
  ) {
    return invalid();
  }
  const extension = strictExtension(kind, value.mimeType);
  const pathMatch = /^field-media-finalized\/([^/]+)\/([^/]+)\.([a-z0-9]+)$/u
    .exec(value.storagePath);
  if (
    pathMatch === null
    || pathMatch[1] !== value.buildingId
    || pathMatch[2] !== value.id
    || pathMatch[3] !== extension
  ) {
    return invalid();
  }
  try {
    if (finalizedPath(pathMatch[1], value.id, value.mimeType) !== value.storagePath) {
      return invalid();
    }
  } catch {
    return invalid();
  }
  return {
    id: value.id,
    buildingId: value.buildingId,
    captureSessionId: value.captureSessionId,
    kind,
    zone: value.zone,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    capturedAt: value.capturedAt,
    storagePath: value.storagePath,
    objectGeneration: value.objectGeneration,
    driveMd5Checksum: value.driveMd5Checksum,
    ...(value.captureQualityState === undefined
      ? {}
      : { captureQualityState: value.captureQualityState }),
    advertisingOrder: value.advertisingOrder,
  };
}

function stringField(
  value: UnknownRecord,
  key: string,
  maximumBytes = MAX_LONG_TEXT_BYTES,
): string {
  const field = value[key];
  return boundedScalarString(field, maximumBytes, true) ? field : invalid();
}

function moneyField(value: UnknownRecord, key: string): number {
  const field = value[key];
  return nonnegativeInteger(field) ? field : invalid();
}

function optionalIntegerOrEmpty(value: unknown): number | "" {
  return value === "" || nonnegativeInteger(value) ? value : invalid();
}

function frozenNaverFields(value: unknown): FrozenNaverListingFields {
  if (!isRecord(value)) return invalid();
  if (
    !boundedStringArray(value.maintenanceFeeItems)
    || !boundedStringArray(value.options)
    || !Array.isArray(value.representativeMediaIds)
    || value.representativeMediaIds.length > MAX_REPRESENTATIVE_MEDIA
    || value.representativeMediaIds.some((id) => !isRfc4122Uuid(id))
    || new Set(value.representativeMediaIds).size
      !== value.representativeMediaIds.length
    || typeof value.parkingAvailable !== "boolean"
  ) {
    return invalid();
  }
  return {
    buildingName: stringField(value, "buildingName"),
    roadAddress: stringField(value, "roadAddress"),
    unitLabel: stringField(value, "unitLabel", MAX_SHORT_TEXT_BYTES),
    depositWon: moneyField(value, "depositWon"),
    monthlyRentWon: moneyField(value, "monthlyRentWon"),
    maintenanceFeeWon: moneyField(value, "maintenanceFeeWon"),
    maintenanceFeeItems: [...value.maintenanceFeeItems],
    availableFrom: stringField(value, "availableFrom", MAX_SHORT_TEXT_BYTES),
    structure: stringField(value, "structure", MAX_SHORT_TEXT_BYTES),
    floor: optionalIntegerOrEmpty(value.floor),
    direction: stringField(value, "direction", MAX_SHORT_TEXT_BYTES),
    parkingAvailable: value.parkingAvailable,
    parkingTotalSpaces: optionalIntegerOrEmpty(value.parkingTotalSpaces),
    parkingDescription: stringField(value, "parkingDescription"),
    petPolicy: stringField(value, "petPolicy"),
    options: [...value.options],
    locationDescription: stringField(value, "locationDescription"),
    representativeMediaIds: [...value.representativeMediaIds],
  };
}

export function readFrozenAdPackage(value: unknown): FrozenAdPackageSource {
  if (!isRecord(value)) return invalid();
  const packageMatch = typeof value.id === "string"
    ? PACKAGE_ID_PATTERN.exec(value.id)
    : null;
  if (
    packageMatch === null
    || !isRfc4122Uuid(packageMatch[1])
    || !isSafeMediaPathSegment(value.listingId)
    || !isSafeMediaPathSegment(value.buildingId)
    || !Number.isSafeInteger(value.version)
    || (value.version as number) < 1
    || (value.version as number) > 999_999
    || value.artifactSetVersion !== ARTIFACT_SET_VERSION
    || !isRfc4122Uuid(value.captureSessionId)
    || !Array.isArray(value.allApprovedMediaIds)
    || value.allApprovedMediaIds.length === 0
    || value.allApprovedMediaIds.length > MAX_MEDIA
    || value.allApprovedMediaIds.some((id) => !isRfc4122Uuid(id))
    || new Set(value.allApprovedMediaIds).size !== value.allApprovedMediaIds.length
    || !Array.isArray(value.representativeMediaIds)
    || value.representativeMediaIds.length === 0
    || value.representativeMediaIds.length > MAX_REPRESENTATIVE_MEDIA
    || value.representativeMediaIds.some((id) => !isRfc4122Uuid(id))
    || new Set(value.representativeMediaIds).size
      !== value.representativeMediaIds.length
    || !Array.isArray(value.mediaManifest)
    || value.mediaManifest.length !== value.allApprovedMediaIds.length
    || !boundedString(value.daangnDescription, MAX_TEXT_BYTES)
  ) {
    return invalid();
  }
  const id = value.id as string;
  const listingId = value.listingId as string;
  const buildingId = value.buildingId as string;
  const captureSessionId = value.captureSessionId as string;
  const approvedMediaIds = value.allApprovedMediaIds as string[];
  const representativeMediaIds = value.representativeMediaIds as string[];
  const daangnDescription = value.daangnDescription as string;
  const mediaManifest = value.mediaManifest.map((item, index) =>
    frozenMedia(item, index + 1));
  if (!mediaManifest.every((item, index) =>
    item.id === approvedMediaIds[index]
    && item.buildingId === buildingId
    && item.captureSessionId === captureSessionId)) {
    return invalid();
  }
  if (!CAPTURE_ZONES.filter((zone) => zone.required).every((zone) =>
    mediaManifest.filter((item) =>
      item.zone === zone.id
      && item.kind === zone.kind
      && (zone.id !== "verticalVideo"
        || item.captureQualityState === "valid"))
      .length >= zone.minimum)) {
    return invalid();
  }
  const mediaById = new Map(mediaManifest.map((item) => [item.id, item]));
  if (representativeMediaIds.some((id) =>
    mediaById.get(id)?.kind !== "photo")) {
    return invalid();
  }
  const naverListingFields = frozenNaverFields(value.naverListingFields);
  if (
    naverListingFields.representativeMediaIds.length
      !== representativeMediaIds.length
    || naverListingFields.representativeMediaIds.some((id, index) =>
      id !== representativeMediaIds[index])
  ) {
    return invalid();
  }
  return {
    id,
    listingId,
    buildingId,
    version: value.version as number,
    artifactSetVersion: ARTIFACT_SET_VERSION,
    captureSessionId,
    representativeMediaIds: [...representativeMediaIds],
    allApprovedMediaIds: [...approvedMediaIds],
    mediaManifest,
    daangnDescription,
    naverListingFields,
  };
}

export function adPackageSourceFingerprint(value: unknown): string {
  const source = readFrozenAdPackage(value);
  return createHash("sha256")
    .update(canonicalValue(source), "utf8")
    .digest("hex");
}

export function canonicalUtf8Text(value: unknown): Uint8Array {
  if (!boundedString(value, MAX_TEXT_BYTES)) return invalid();
  const canonical = value.normalize("NFC")
    .replace(/\r\n|\r/gu, "\n")
    .replace(/\n+$/gu, "")
    .replace(/\n/gu, "\r\n") + "\r\n";
  const bytes = Buffer.from(canonical, "utf8");
  if (bytes.byteLength > MAX_TEXT_BYTES) return invalid();
  return new Uint8Array(bytes);
}

function scalar(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "가능" : "불가";
  return String(value);
}

function naverText(fields: FrozenNaverListingFields): string {
  const lines: Array<[string, string | number | boolean | string[]]> = [
    ["건물명", fields.buildingName],
    ["도로명주소", fields.roadAddress],
    ["호실", fields.unitLabel],
    ["보증금(원)", fields.depositWon],
    ["월세(원)", fields.monthlyRentWon],
    ["관리비(원)", fields.maintenanceFeeWon],
    ["관리비 포함항목", fields.maintenanceFeeItems],
    ["입주가능일", fields.availableFrom],
    ["구조", fields.structure],
    ["층", fields.floor],
    ["방향", fields.direction],
    ["주차가능", fields.parkingAvailable],
    ["총 주차대수", fields.parkingTotalSpaces],
    ["주차안내", fields.parkingDescription],
    ["반려동물", fields.petPolicy],
    ["옵션", fields.options],
    ["위치설명", fields.locationDescription],
    ["대표사진 ID", fields.representativeMediaIds],
  ];
  return lines.map(([label, value]) =>
    `${label}: ${Array.isArray(value) ? value.join(", ") : scalar(value)}`)
    .join("\n");
}

function mediaArtifact(
  prefix: "representative" | "original" | "vertical",
  item: FrozenMediaManifestItem,
  index: number,
): AdPackageMediaArtifact {
  const sequence = String(index + 1).padStart(3, "0");
  return {
    artifactKey: `${prefix}:${sequence}:${item.id}`,
    name: `${sequence}_${item.id}.${strictExtension(item.kind, item.mimeType)}`,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    md5Checksum: item.driveMd5Checksum,
    sourceMediaId: item.id,
    sourceObjectGeneration: item.objectGeneration,
  };
}

function textArtifact(
  artifactKey: "daangn-text" | "naver-text",
  name: AdPackageTextArtifact["name"],
  value: string,
): AdPackageTextArtifact {
  const bytes = canonicalUtf8Text(value);
  return {
    artifactKey,
    name,
    mimeType: "text/plain",
    bytes,
    sizeBytes: bytes.byteLength,
    md5Checksum: createHash("md5").update(bytes).digest("hex"),
  };
}

export function buildAdPackageArtifacts(value: unknown): AdPackageArtifacts {
  const source = readFrozenAdPackage(value);
  const sourceFingerprint = adPackageSourceFingerprint(source);
  if (!isRecord(value) || value.sourceFingerprint !== sourceFingerprint) {
    return invalid();
  }
  const mediaById = new Map(source.mediaManifest.map((item) => [item.id, item]));
  const representativePhotos = source.representativeMediaIds.map((id, index) =>
    mediaArtifact("representative", mediaById.get(id) ?? invalid(), index));
  const originalPhotos = source.mediaManifest.filter((item) => item.kind === "photo")
    .map((item, index) => mediaArtifact("original", item, index));
  const verticalVideos = source.mediaManifest.filter((item) => item.kind === "video")
    .map((item, index) => mediaArtifact("vertical", item, index));
  return {
    packageId: source.id,
    version: source.version,
    artifactSetVersion: ARTIFACT_SET_VERSION,
    sourceFingerprint,
    packageFolderName: `광고패키지_v${String(source.version).padStart(3, "0")}`,
    representativePhotos,
    originalPhotos,
    verticalVideos,
    daangn: textArtifact(
      "daangn-text",
      "04_당근_매물설명.txt",
      source.daangnDescription,
    ),
    naver: textArtifact(
      "naver-text",
      "05_네이버부동산_입력정보.txt",
      naverText(source.naverListingFields),
    ),
  };
}

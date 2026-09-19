import { Buffer } from "node:buffer";

import {
  CAPTURE_ZONES,
  finalizedPath,
  isRfc4122Uuid,
  isSafeMediaPathSegment,
  MEDIA_POLICY,
} from "../field/media-policy.js";
import {
  buildAdvertisingProjection,
  type AdvertisingMediaProjection,
  type AdvertisingProjection,
} from "../security/advertising-projection.js";
import {
  ARTIFACT_SET_VERSION,
  adPackageSourceFingerprint,
  storageBase64Md5ToDriveHex,
} from "./ad-package-artifacts.js";
import { buildAdPackageRecoveryKey } from "./generation-recovery-key.js";

export interface CreateAdPackageInput {
  requestId: string;
  listingId: string;
  approvedMediaIds: string[];
  representativeMediaIds: string[];
}

export interface CreateAdPackageResult {
  packageId: string;
  listingId: string;
  version: number;
  status: "reviewed";
}

export interface AdPackageCommitInput extends CreateAdPackageInput {
  actorId: string;
  occurredAt: string;
}

export type AdPackageCommitDecision =
  | {
      status: "committed";
      write: true;
      state: unknown;
      result: CreateAdPackageResult;
    }
  | {
      status: "alreadyCommitted";
      write: false;
      state: unknown;
      result: CreateAdPackageResult;
    }
  | {
      status: "requestConflict";
      write: false;
      state: unknown;
    };

export interface CreateAdPackageDependencies {
  isEnabled(uid: string): Promise<boolean>;
  commit(input: AdPackageCommitInput): Promise<AdPackageCommitDecision>;
  now(): string;
}

export type FieldRole = "admin" | "staff" | "reviewer";
type UnknownRecord = Record<string, unknown>;

const MAX_APPROVED_MEDIA = 100;
const MAX_REPRESENTATIVE_MEDIA = 20;
const MAX_ARRAY_ITEMS = 50;
const MAX_ARRAY_ITEM_BYTES = 256;
const MAX_SHORT_TEXT_BYTES = 512;
const MAX_LONG_TEXT_BYTES = 2_048;
const MAX_PACKAGE_BYTES = 512 * 1_024;
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  required = true,
): value is string {
  if (value === undefined && !required) return false;
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function boundedOptionalString(value: unknown, maximumBytes: number): boolean {
  return value === undefined || boundedString(value, maximumBytes);
}

function boundedStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_ARRAY_ITEMS
    && value.every((item) => boundedString(item, MAX_ARRAY_ITEM_BYTES));
}

function forbidden(): never {
  throw new Error("ad_package_forbidden");
}

function incomplete(): never {
  throw new Error("ad_package_listing_incomplete");
}

function sameIds(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validatePublicInput(
  input: CreateAdPackageInput,
  actor: { uid: string; role: FieldRole },
): void {
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.requestId)
    || !isSafeMediaPathSegment(input.listingId)
    || !Array.isArray(input.approvedMediaIds)
    || input.approvedMediaIds.length === 0
    || input.approvedMediaIds.length > MAX_APPROVED_MEDIA
    || input.approvedMediaIds.some((mediaId) => !isRfc4122Uuid(mediaId))
    || new Set(input.approvedMediaIds).size !== input.approvedMediaIds.length
    || !Array.isArray(input.representativeMediaIds)
    || input.representativeMediaIds.length === 0
    || input.representativeMediaIds.length > MAX_REPRESENTATIVE_MEDIA
    || input.representativeMediaIds.some((mediaId) => !isRfc4122Uuid(mediaId))
    || new Set(input.representativeMediaIds).size
      !== input.representativeMediaIds.length
  ) {
    throw new Error("ad_package_invalid");
  }
  if (
    !isRecord(actor)
    || !isSafeMediaPathSegment(actor.uid)
    || (actor.role !== "admin" && actor.role !== "reviewer")
  ) {
    forbidden();
  }
}

function validateCommitInput(input: AdPackageCommitInput): void {
  validatePublicInput(input, { uid: input.actorId, role: "reviewer" });
  if (!canonicalIso(input.occurredAt)) {
    throw new Error("ad_package_state_invalid");
  }
}

function branch(root: UnknownRecord, key: string): UnknownRecord {
  const value = root[key];
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("ad_package_state_invalid");
  return value;
}

function existingPackageResult(
  value: unknown,
  packageId: string,
  input: AdPackageCommitInput,
): CreateAdPackageResult | null {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value)
    || value.id !== packageId
    || value.requestId !== input.requestId
    || value.listingId !== input.listingId
    || value.createdBy !== input.actorId
    || !Number.isSafeInteger(value.version)
    || (value.version as number) < 1
    || (value.status !== "reviewed"
      && value.status !== "generating"
      && value.status !== "failed"
      && value.status !== "complete")
    || value.artifactSetVersion !== ARTIFACT_SET_VERSION
    || typeof value.sourceFingerprint !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.sourceFingerprint)
    || !sameIds(value.allApprovedMediaIds, input.approvedMediaIds)
    || !sameIds(value.representativeMediaIds, input.representativeMediaIds)
  ) {
    return null;
  }
  try {
    if (adPackageSourceFingerprint(value) !== value.sourceFingerprint) return null;
  } catch {
    return null;
  }
  return {
    packageId,
    listingId: input.listingId,
    version: value.version as number,
    status: "reviewed",
  };
}

function assertProjectionSourceBounds(
  building: UnknownRecord,
  unit: UnknownRecord,
  listing: UnknownRecord,
): void {
  if (
    !boundedString(building.managementNumber, MAX_SHORT_TEXT_BYTES)
    || !boundedString(building.name, MAX_SHORT_TEXT_BYTES)
    || !boundedString(building.roadAddress, MAX_LONG_TEXT_BYTES)
    || !boundedOptionalString(building.jibunAddress, MAX_LONG_TEXT_BYTES)
    || !boundedOptionalString(building.purpose, MAX_SHORT_TEXT_BYTES)
    || !boundedString(unit.unitLabel, MAX_SHORT_TEXT_BYTES)
    || !boundedOptionalString(unit.structure, MAX_SHORT_TEXT_BYTES)
    || !boundedOptionalString(unit.direction, MAX_SHORT_TEXT_BYTES)
    || !boundedStringArray(unit.options)
    || !boundedString(listing.unitLabel, MAX_SHORT_TEXT_BYTES)
    || !boundedString(listing.availableFrom, MAX_SHORT_TEXT_BYTES)
    || !boundedOptionalString(listing.moveInCondition, MAX_SHORT_TEXT_BYTES)
    || !boundedString(listing.locationDescription, MAX_LONG_TEXT_BYTES)
    || !boundedString(listing.parkingDescription, MAX_LONG_TEXT_BYTES)
    || !boundedString(listing.petPolicy, MAX_LONG_TEXT_BYTES)
    || !boundedStringArray(listing.maintenanceFeeItems)
    || !boundedStringArray(listing.options)
  ) {
    incomplete();
  }
}

function assertCompleteListing(
  listing: UnknownRecord,
  listingId: string,
): { buildingId: string; unitId: string } {
  if (listing.id !== listingId) incomplete();
  if (listing.advertisingApproved !== true) {
    throw new Error("ad_package_listing_not_approved");
  }
  if (
    (listing.status !== "ready" && listing.status !== "advertising")
    || !isSafeMediaPathSegment(listing.buildingId)
    || !isSafeMediaPathSegment(listing.unitId)
  ) {
    incomplete();
  }
  return { buildingId: listing.buildingId, unitId: listing.unitId };
}

function selectedMediaForReview(
  mediaBranch: UnknownRecord,
  input: AdPackageCommitInput,
  binding: { buildingId: string; unitId: string },
): UnknownRecord[] {
  return input.approvedMediaIds.map((mediaId, index) => {
    const value = mediaBranch[mediaId];
    if (!isRecord(value) || value.id !== mediaId) {
      throw new Error("ad_package_approved_media_invalid");
    }
    const zone = CAPTURE_ZONES.find((candidate) => candidate.id === value.zone);
    const scopeMatches = zone?.scope === "unit"
      ? value.unitId === binding.unitId && value.listingId === input.listingId
      : (value.unitId === undefined || value.unitId === binding.unitId)
        && (value.listingId === undefined || value.listingId === input.listingId);
    if (
      !zone
      || value.buildingId !== binding.buildingId
      || !scopeMatches
      || !isRfc4122Uuid(value.captureSessionId)
      || value.uploadState !== "finalized"
      || (value.excludedAt !== undefined && value.excludedAt !== null)
      || value.kind !== zone.kind
      || value.required !== zone.required
      || !isSafeMediaPathSegment(value.slotId)
      || typeof value.mimeType !== "string"
      || !Object.prototype.hasOwnProperty.call(
        MEDIA_POLICY[zone.kind].mimeToExtension,
        value.mimeType,
      )
      || !Number.isSafeInteger(value.sizeBytes)
      || (value.sizeBytes as number) < 1
      || (value.sizeBytes as number) > MEDIA_POLICY[zone.kind].maxBytes
      || !canonicalIso(value.capturedAt)
      || typeof value.objectGeneration !== "string"
      || !GENERATION_PATTERN.test(value.objectGeneration)
      || typeof value.objectMd5Hash !== "string"
      || (zone.id === "verticalVideo" && value.captureQualityState !== "valid")
    ) {
      throw new Error("ad_package_approved_media_invalid");
    }
    let expectedPath: string;
    try {
      expectedPath = finalizedPath(binding.buildingId, mediaId, value.mimeType);
    } catch {
      throw new Error("ad_package_approved_media_invalid");
    }
    if (value.storagePath !== expectedPath) {
      throw new Error("ad_package_approved_media_invalid");
    }
    try {
      storageBase64Md5ToDriveHex(value.objectMd5Hash);
    } catch {
      throw new Error("ad_package_approved_media_invalid");
    }
    return {
      ...value,
      advertisingApproved: true,
      advertisingOrder: index + 1,
    };
  });
}

function assertCaptureSession(
  captureSessions: UnknownRecord,
  selectedMedia: readonly UnknownRecord[],
  binding: { buildingId: string; unitId: string; listingId: string },
): string {
  const ids = new Set(selectedMedia.map((item) => item.captureSessionId));
  if (ids.size !== 1) {
    throw new Error("ad_package_capture_session_invalid");
  }
  const [captureSessionId] = ids;
  if (!isRfc4122Uuid(captureSessionId)) {
    throw new Error("ad_package_capture_session_invalid");
  }
  const session = captureSessions[captureSessionId];
  if (
    !isRecord(session)
    || session.id !== captureSessionId
    || session.status !== "complete"
    || session.buildingId !== binding.buildingId
    || session.unitId !== binding.unitId
    || session.listingId !== binding.listingId
  ) {
    throw new Error("ad_package_capture_session_invalid");
  }
  return captureSessionId;
}

function assertRequiredMedia(media: readonly AdvertisingMediaProjection[]): void {
  if (!CAPTURE_ZONES.filter((zone) => zone.required).every((zone) =>
    media.filter((item) =>
      item.zone === zone.id
      && item.kind === zone.kind
      && (zone.id !== "verticalVideo" || item.captureQualityState === "valid"))
      .length >= zone.minimum)) {
    throw new Error("ad_package_required_media_missing");
  }
}

function assertRepresentativeOrder(
  representativeMediaIds: readonly string[],
  approvedMediaIds: readonly string[],
  projection: AdvertisingProjection,
): void {
  const approvedPhotos = new Set(
    projection.media.filter((item) => item.kind === "photo").map((item) => item.id),
  );
  if (representativeMediaIds.some((id) =>
    !approvedMediaIds.includes(id) || !approvedPhotos.has(id))) {
    throw new Error("ad_package_representative_media_invalid");
  }
}

function formatWon(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function unitDisplayLabel(value: string): string {
  return value.endsWith("호") ? value : `${value}호`;
}

function daangnDescription(projection: AdvertisingProjection): string {
  const { building, unit, listing } = projection;
  return [
    `${building.name} ${unitDisplayLabel(unit.unitLabel)}`,
    `보증금 ${formatWon(listing.depositWon)} / 월세 ${formatWon(listing.monthlyRentWon)}`,
    `관리비 ${formatWon(listing.maintenanceFeeWon)}`,
    `입주 가능일 ${listing.availableFrom ?? "확인 필요"}`,
    `주차 ${listing.parkingDescription}`,
    `옵션 ${listing.options.length > 0 ? listing.options.join(", ") : "없음"}`,
    listing.locationDescription ?? "",
  ].filter((line) => line.length > 0).join("\n");
}

function naverListingFields(
  projection: AdvertisingProjection,
  representativeMediaIds: readonly string[],
): Record<string, string | number | boolean | string[]> {
  const { building, unit, listing } = projection;
  return {
    buildingName: building.name,
    roadAddress: building.roadAddress,
    unitLabel: unit.unitLabel,
    depositWon: listing.depositWon,
    monthlyRentWon: listing.monthlyRentWon,
    maintenanceFeeWon: listing.maintenanceFeeWon,
    maintenanceFeeItems: [...listing.maintenanceFeeItems],
    availableFrom: listing.availableFrom ?? "",
    structure: unit.structure ?? "",
    floor: unit.floor ?? "",
    direction: unit.direction ?? "",
    parkingAvailable: building.parking.available,
    parkingTotalSpaces: building.parking.totalSpaces ?? "",
    parkingDescription: listing.parkingDescription,
    petPolicy: listing.petPolicy,
    options: [...listing.options],
    locationDescription: listing.locationDescription ?? "",
    representativeMediaIds: [...representativeMediaIds],
  };
}

function mediaManifest(
  projection: AdvertisingProjection,
  buildingId: string,
) {
  return projection.media.map((media) => ({
    id: media.id,
    buildingId,
    captureSessionId: media.captureSessionId,
    kind: media.kind,
    zone: media.zone,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    capturedAt: media.capturedAt,
    storagePath: media.storagePath,
    objectGeneration: media.objectGeneration,
    driveMd5Checksum: storageBase64Md5ToDriveHex(media.objectMd5Hash),
    ...(media.captureQualityState === undefined
      ? {}
      : { captureQualityState: media.captureQualityState }),
    advertisingOrder: media.advertisingOrder,
  }));
}

export function reduceAdPackageCommit(
  currentFieldPlatform: unknown,
  input: AdPackageCommitInput,
): AdPackageCommitDecision {
  validateCommitInput(input);
  if (!isRecord(currentFieldPlatform)) {
    throw new Error("ad_package_listing_incomplete");
  }
  const root = currentFieldPlatform;
  const packageId = `ad-package-${input.requestId}`;
  const packages = branch(root, "adPackages");
  const existingValue = packages[packageId];
  if (existingValue !== undefined && existingValue !== null) {
    const existing = existingPackageResult(existingValue, packageId, input);
    return existing
      ? {
          status: "alreadyCommitted",
          write: false,
          state: currentFieldPlatform,
          result: existing,
        }
      : {
          status: "requestConflict",
          write: false,
          state: currentFieldPlatform,
        };
  }

  const listings = branch(root, "listings");
  const listing = listings[input.listingId];
  if (!isRecord(listing)) incomplete();
  const { buildingId, unitId } = assertCompleteListing(listing, input.listingId);
  const buildings = branch(root, "buildings");
  const units = branch(root, "units");
  const building = buildings[buildingId];
  const unit = units[unitId];
  if (
    !isRecord(building)
    || !isRecord(unit)
    || building.id !== buildingId
    || unit.id !== unitId
    || unit.buildingId !== buildingId
  ) incomplete();
  assertProjectionSourceBounds(building, unit, listing);

  const media = branch(root, "media");
  const captureSessions = branch(root, "captureSessions");
  const selectedMedia = selectedMediaForReview(media, input, { buildingId, unitId });
  const captureSessionId = assertCaptureSession(
    captureSessions,
    selectedMedia,
    { buildingId, unitId, listingId: input.listingId },
  );

  let projection: AdvertisingProjection;
  try {
    projection = buildAdvertisingProjection({
      building,
      unit,
      listing,
      media: selectedMedia,
    });
  } catch {
    incomplete();
  }
  if (projection.media.length !== input.approvedMediaIds.length) {
    throw new Error("ad_package_approved_media_invalid");
  }
  assertRequiredMedia(projection.media);
  assertRepresentativeOrder(
    input.representativeMediaIds,
    input.approvedMediaIds,
    projection,
  );

  const versions = branch(root, "adPackageVersions");
  const currentVersion = versions[input.listingId] ?? 0;
  if (!Number.isSafeInteger(currentVersion) || (currentVersion as number) < 0) {
    throw new Error("ad_package_version_state_invalid");
  }
  const version = (currentVersion as number) + 1;
  if (!Number.isSafeInteger(version)) {
    throw new Error("ad_package_version_state_invalid");
  }

  const auditId = `ad-package-created-${input.requestId}`;
  const adPackage = {
    id: packageId,
    requestId: input.requestId,
    listingId: input.listingId,
    buildingId,
    version,
    status: "reviewed",
    artifactSetVersion: ARTIFACT_SET_VERSION,
    representativeMediaIds: [...input.representativeMediaIds],
    allApprovedMediaIds: [...input.approvedMediaIds],
    mediaManifest: mediaManifest(projection, buildingId),
    captureSessionId,
    daangnDescription: daangnDescription(projection),
    naverListingFields: naverListingFields(
      projection,
      input.representativeMediaIds,
    ),
    reviewerId: input.actorId,
    reviewedAt: input.occurredAt,
    createdAt: input.occurredAt,
    createdBy: input.actorId,
  };
  const sourceFingerprint = adPackageSourceFingerprint(adPackage);
  Object.assign(adPackage, {
    sourceFingerprint,
    generation: {
      status: "reviewed",
      attemptCount: 0,
      generationNumber: 0,
      sourceFingerprint,
      updatedAt: input.occurredAt,
      recoveryKey: buildAdPackageRecoveryKey(
        "reviewed",
        input.occurredAt,
        packageId,
      ),
    },
  });
  if (Buffer.byteLength(JSON.stringify(adPackage), "utf8") > MAX_PACKAGE_BYTES) {
    incomplete();
  }
  const audit = {
    id: auditId,
    actorId: input.actorId,
    action: "adPackage.created",
    entityType: "adPackage",
    entityId: packageId,
    occurredAt: input.occurredAt,
    requestId: input.requestId,
    changes: { version: { after: version } },
  };

  const nextMedia: UnknownRecord = { ...media };
  for (const [mediaId, value] of Object.entries(media)) {
    if (!isRecord(value) || value.buildingId !== buildingId) continue;
    const session = typeof value.captureSessionId === "string"
      ? captureSessions[value.captureSessionId]
      : undefined;
    if (
      !isRecord(session)
      || session.status !== "complete"
      || session.buildingId !== buildingId
      || session.unitId !== unitId
      || session.listingId !== input.listingId
    ) continue;
    const cleared: UnknownRecord = { ...value, advertisingApproved: false };
    delete cleared.advertisingOrder;
    nextMedia[mediaId] = cleared;
  }
  selectedMedia.forEach((item) => {
    nextMedia[item.id as string] = item;
  });
  const state: UnknownRecord = {
    ...root,
    media: nextMedia,
    adPackages: { ...packages, [packageId]: adPackage },
    adPackageVersions: { ...versions, [input.listingId]: version },
    adPackageLatest: {
      ...branch(root, "adPackageLatest"),
      [input.listingId]: packageId,
    },
    auditLogs: { ...branch(root, "auditLogs"), [auditId]: audit },
  };
  const result: CreateAdPackageResult = {
    packageId,
    listingId: input.listingId,
    version,
    status: "reviewed",
  };
  return { status: "committed", write: true, state, result };
}

export async function createAdPackageCore(
  input: CreateAdPackageInput,
  actor: { uid: string; role: FieldRole },
  dependencies: CreateAdPackageDependencies,
): Promise<CreateAdPackageResult> {
  validatePublicInput(input, actor);
  if (await dependencies.isEnabled(actor.uid) !== true) forbidden();
  const occurredAt = dependencies.now();
  if (!canonicalIso(occurredAt)) {
    throw new Error("ad_package_state_invalid");
  }
  const decision = await dependencies.commit({
    requestId: input.requestId,
    listingId: input.listingId,
    approvedMediaIds: [...input.approvedMediaIds],
    representativeMediaIds: [...input.representativeMediaIds],
    actorId: actor.uid,
    occurredAt,
  });
  if (decision.status === "requestConflict") {
    throw new Error("ad_package_request_conflict");
  }
  return decision.result;
}

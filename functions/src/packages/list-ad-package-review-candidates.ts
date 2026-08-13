import { Buffer } from "node:buffer";

import {
  CAPTURE_ZONES,
  finalizedPath,
  isRfc4122Uuid,
  isSafeMediaPathSegment,
  MEDIA_POLICY,
} from "../field/media-policy.js";
import type { FieldRole } from "./create-ad-package.js";

type UnknownRecord = Record<string, unknown>;
type EligibleListingStatus = "reviewPending" | "ready" | "advertising";

export interface ListAdPackageReviewCandidatesDependencies {
  isEnabled(uid: string): Promise<boolean>;
  listListingsByStatus(
    status: EligibleListingStatus,
    limit: number,
    cursor?: string,
  ): Promise<unknown[]>;
  readBuilding(buildingId: string): Promise<unknown | null>;
  readUnit(unitId: string): Promise<unknown | null>;
  listMediaByListing(listingId: string, limit: number): Promise<unknown[]>;
  listMediaByBuilding(buildingId: string, limit: number): Promise<unknown[]>;
  readCaptureSession(captureSessionId: string): Promise<unknown | null>;
  listPackagesByListing(listingId: string, limit: number): Promise<unknown[]>;
  readLatestPackageId(listingId: string): Promise<unknown | null>;
  readPackage(packageId: string): Promise<unknown | null>;
}

export interface ListAdPackageReviewCandidatesResult {
  candidates: unknown[];
  nextCursor?: string;
}

const LISTING_LIMIT = 50;
const MEDIA_LIMIT = 100;
const PACKAGE_LIMIT = 20;
const MAX_ARRAY_ITEMS = 50;
const MAX_ITEM_BYTES = 256;
const MAX_SHORT_BYTES = 512;
const MAX_LONG_BYTES = 2_048;
const STATUSES = ["reviewPending", "ready", "advertising"] as const;
const FIREBASE_INTEGER_KEY = /^-?(0*)\d{1,10}$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firebaseIntegerKey(value: string): number | null {
  if (!FIREBASE_INTEGER_KEY.test(value)) return null;
  const parsed = Number(value);
  return parsed >= -2_147_483_648 && parsed <= 2_147_483_647 ? parsed : null;
}

function firebaseKeyCompare(left: string, right: string): number {
  if (left === right) return 0;
  const leftInteger = firebaseIntegerKey(left);
  const rightInteger = firebaseIntegerKey(right);
  if (leftInteger !== null) {
    if (rightInteger === null) return -1;
    const difference = leftInteger - rightInteger;
    return difference === 0 ? left.length - right.length : difference;
  }
  if (rightInteger !== null) return 1;
  return left < right ? -1 : 1;
}

function listingQueryEntry(
  value: unknown,
  status: EligibleListingStatus,
): { key: string; status: EligibleListingStatus; value: unknown } | null {
  if (!isRecord(value)) return null;
  if (isSafeMediaPathSegment(value.id)) {
    return { key: value.id, status, value };
  }
  if (
    isSafeMediaPathSegment(value.key)
    && Object.prototype.hasOwnProperty.call(value, "value")
  ) return { key: value.key, status, value: value.value };
  return null;
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function boundedString(value: unknown, maximumBytes = MAX_SHORT_BYTES): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function optionalBoundedString(
  value: unknown,
  maximumBytes = MAX_SHORT_BYTES,
): string | undefined {
  return boundedString(value, maximumBytes) ? value : undefined;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function strings(value: unknown): string[] | null {
  if (
    !Array.isArray(value)
    || value.length > MAX_ARRAY_ITEMS
    || !value.every((item) => boundedString(item, MAX_ITEM_BYTES))
  ) return null;
  return [...value];
}

function projectListing(value: unknown, expectedStatus: EligibleListingStatus) {
  if (
    !isRecord(value)
    || !isSafeMediaPathSegment(value.id)
    || !isSafeMediaPathSegment(value.buildingId)
    || !isSafeMediaPathSegment(value.unitId)
    || !boundedString(value.unitLabel)
    || value.status !== expectedStatus
    || typeof value.advertisingApproved !== "boolean"
    || !nonNegativeInteger(value.depositWon)
    || !nonNegativeInteger(value.monthlyRentWon)
    || !nonNegativeInteger(value.maintenanceFeeWon)
    || !boundedString(value.parkingDescription, MAX_LONG_BYTES)
    || !boundedString(value.petPolicy, MAX_LONG_BYTES)
  ) return null;
  const maintenanceFeeItems = strings(value.maintenanceFeeItems);
  const options = strings(value.options);
  if (!maintenanceFeeItems || !options) return null;
  const availableFrom = optionalBoundedString(value.availableFrom);
  const moveInCondition = optionalBoundedString(value.moveInCondition);
  const locationDescription = optionalBoundedString(
    value.locationDescription,
    MAX_LONG_BYTES,
  );
  return {
    id: value.id,
    buildingId: value.buildingId,
    unitId: value.unitId,
    unitLabel: value.unitLabel,
    status: value.status,
    advertisingApproved: value.advertisingApproved,
    depositWon: value.depositWon,
    monthlyRentWon: value.monthlyRentWon,
    maintenanceFeeWon: value.maintenanceFeeWon,
    maintenanceFeeItems,
    ...(availableFrom === undefined ? {} : { availableFrom }),
    ...(nonNegativeInteger(value.contractTermMonths)
      ? { contractTermMonths: value.contractTermMonths }
      : {}),
    ...(moveInCondition === undefined ? {} : { moveInCondition }),
    ...(locationDescription === undefined ? {} : { locationDescription }),
    parkingDescription: value.parkingDescription,
    petPolicy: value.petPolicy,
    options,
  };
}

function projectBuilding(value: unknown, buildingId: string) {
  if (
    !isRecord(value)
    || value.id !== buildingId
    || !boundedString(value.managementNumber)
    || !boundedString(value.name)
    || !boundedString(value.roadAddress, MAX_LONG_BYTES)
    || !isRecord(value.parking)
    || typeof value.parking.available !== "boolean"
  ) return null;
  const purpose = optionalBoundedString(value.purpose);
  return {
    id: buildingId,
    managementNumber: value.managementNumber,
    name: value.name,
    roadAddress: value.roadAddress,
    ...(purpose === undefined ? {} : { purpose }),
    ...(nonNegativeInteger(value.completionYear)
      ? { completionYear: value.completionYear }
      : {}),
    ...(nonNegativeInteger(value.floorCount) ? { floorCount: value.floorCount } : {}),
    ...(typeof value.elevator === "boolean" ? { elevator: value.elevator } : {}),
    parking: {
      available: value.parking.available,
      ...(nonNegativeInteger(value.parking.totalSpaces)
        ? { totalSpaces: value.parking.totalSpaces }
        : {}),
    },
  };
}

function projectUnit(value: unknown, unitId: string, buildingId: string) {
  if (
    !isRecord(value)
    || value.id !== unitId
    || value.buildingId !== buildingId
    || !boundedString(value.unitLabel)
  ) return null;
  const options = strings(value.options);
  if (!options) return null;
  const structure = optionalBoundedString(value.structure);
  const direction = optionalBoundedString(value.direction);
  return {
    id: unitId,
    buildingId,
    unitLabel: value.unitLabel,
    ...(structure === undefined ? {} : { structure }),
    ...(nonNegativeInteger(value.floor) ? { floor: value.floor } : {}),
    ...(direction === undefined ? {} : { direction }),
    options,
  };
}

function projectMedia(
  value: unknown,
  binding: { buildingId: string; unitId: string; listingId: string },
) {
  if (!isRecord(value) || !isRfc4122Uuid(value.id)) return null;
  const zone = CAPTURE_ZONES.find((candidate) => candidate.id === value.zone);
  const scopeMatches = zone?.scope === "unit"
    ? value.unitId === binding.unitId && value.listingId === binding.listingId
    : (value.unitId === undefined || value.unitId === binding.unitId)
      && (value.listingId === undefined || value.listingId === binding.listingId);
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
    || !/^[1-9][0-9]{0,30}$/u.test(value.objectGeneration)
    || typeof value.advertisingApproved !== "boolean"
    || (zone.id === "verticalVideo" && value.captureQualityState !== "valid")
  ) return null;
  try {
    if (value.storagePath !== finalizedPath(
      binding.buildingId,
      value.id,
      value.mimeType,
    )) return null;
  } catch {
    return null;
  }
  const objectMd5Hash = optionalBoundedString(value.objectMd5Hash);
  return {
    id: value.id,
    buildingId: binding.buildingId,
    ...(value.unitId === undefined ? {} : { unitId: value.unitId as string }),
    ...(value.listingId === undefined ? {} : { listingId: value.listingId as string }),
    captureSessionId: value.captureSessionId,
    kind: value.kind,
    zone: value.zone,
    slotId: value.slotId,
    required: value.required,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    capturedAt: value.capturedAt,
    storagePath: value.storagePath,
    uploadState: "finalized" as const,
    advertisingApproved: value.advertisingApproved,
    ...(value.captureQualityState === "valid" || value.captureQualityState === "warning"
      ? { captureQualityState: value.captureQualityState }
      : {}),
    objectGeneration: value.objectGeneration,
    ...(objectMd5Hash === undefined ? {} : { objectMd5Hash }),
    ...(Number.isSafeInteger(value.advertisingOrder)
      && (value.advertisingOrder as number) >= 1
      ? { advertisingOrder: value.advertisingOrder as number }
      : {}),
  };
}

function projectCaptureSession(
  value: unknown,
  captureSessionId: string,
  binding: { buildingId: string; unitId: string; listingId: string },
) {
  if (
    !isRecord(value)
    || value.id !== captureSessionId
    || value.status !== "complete"
    || value.buildingId !== binding.buildingId
    || value.unitId !== binding.unitId
    || value.listingId !== binding.listingId
  ) return null;
  return { id: captureSessionId, ...binding, status: "complete" as const };
}

function projectPackage(value: unknown, listingId: string) {
  if (
    !isRecord(value)
    || !isSafeMediaPathSegment(value.id)
    || value.listingId !== listingId
    || !Number.isSafeInteger(value.version)
    || (value.version as number) < 1
    || !boundedString(value.status)
  ) return null;
  const representativeMediaIds = Array.isArray(value.representativeMediaIds)
    && value.representativeMediaIds.length <= 20
    && value.representativeMediaIds.every(isRfc4122Uuid)
    ? [...value.representativeMediaIds]
    : null;
  const allApprovedMediaIds = Array.isArray(value.allApprovedMediaIds)
    && value.allApprovedMediaIds.length <= 100
    && value.allApprovedMediaIds.every(isRfc4122Uuid)
    ? [...value.allApprovedMediaIds]
    : null;
  if (!representativeMediaIds || !allApprovedMediaIds) return null;
  return {
    id: value.id,
    listingId,
    version: value.version as number,
    representativeMediaIds,
    allApprovedMediaIds,
    status: value.status as string,
  };
}

function validateInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) throw new Error("ad_review_candidates_invalid");
  const keys = Object.keys(input);
  if (keys.length === 0) return undefined;
  if (
    keys.length !== 1
    || keys[0] !== "cursor"
    || !isSafeMediaPathSegment(input.cursor)
  ) throw new Error("ad_review_candidates_invalid");
  return input.cursor;
}

export async function listAdPackageReviewCandidatesCore(
  input: unknown,
  actor: { uid: string; role: FieldRole },
  dependencies: ListAdPackageReviewCandidatesDependencies,
): Promise<ListAdPackageReviewCandidatesResult> {
  const cursor = validateInput(input);
  if (
    !isSafeMediaPathSegment(actor.uid)
    || (actor.role !== "admin" && actor.role !== "reviewer")
    || await dependencies.isEnabled(actor.uid) !== true
  ) {
    throw new Error("ad_package_forbidden");
  }

  const listingRows = await Promise.all(STATUSES.map(async (status) => ({
    status,
    values: cursor === undefined
      ? await dependencies.listListingsByStatus(status, LISTING_LIMIT)
      : await dependencies.listListingsByStatus(status, LISTING_LIMIT, cursor),
  })));
  const byId = new Map<
    string,
    { key: string; status: EligibleListingStatus; value: unknown }
  >();
  for (const { status, values } of listingRows) {
    for (const value of values.slice(0, LISTING_LIMIT)) {
      const entry = listingQueryEntry(value, status);
      if (
        entry
        && (cursor === undefined || firebaseKeyCompare(entry.key, cursor) > 0)
        && !byId.has(entry.key)
      ) byId.set(entry.key, entry);
    }
  }
  const rawListingPage = [...byId.values()]
    .sort((left, right) => firebaseKeyCompare(left.key, right.key))
    .slice(0, LISTING_LIMIT);
  const listings = rawListingPage
    .map((entry) => {
      const projected = projectListing(entry.value, entry.status);
      return projected?.id === entry.key ? projected : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const buildingCache = new Map<string, Promise<unknown | null>>();
  const unitCache = new Map<string, Promise<unknown | null>>();
  const listingMediaCache = new Map<string, Promise<unknown[]>>();
  const buildingMediaCache = new Map<string, Promise<unknown[]>>();
  const sessionCache = new Map<string, Promise<unknown | null>>();
  const cached = <T>(map: Map<string, Promise<T>>, id: string, load: () => Promise<T>) => {
    const existing = map.get(id);
    if (existing) return existing;
    const pending = load();
    map.set(id, pending);
    return pending;
  };

  const candidates = (await Promise.all(listings.map(async (listing) => {
    const [
      rawBuilding,
      rawUnit,
      rawListingMedia,
      rawBuildingMedia,
      rawPackages,
      rawLatestPackageId,
    ] = await Promise.all([
      cached(buildingCache, listing.buildingId, () =>
        dependencies.readBuilding(listing.buildingId)),
      cached(unitCache, listing.unitId, () => dependencies.readUnit(listing.unitId)),
      cached(listingMediaCache, listing.id, () =>
        dependencies.listMediaByListing(listing.id, MEDIA_LIMIT)),
      cached(buildingMediaCache, listing.buildingId, () =>
        dependencies.listMediaByBuilding(listing.buildingId, MEDIA_LIMIT)),
      dependencies.listPackagesByListing(listing.id, PACKAGE_LIMIT),
      dependencies.readLatestPackageId(listing.id),
    ]);
    const building = projectBuilding(rawBuilding, listing.buildingId);
    const unit = projectUnit(rawUnit, listing.unitId, listing.buildingId);
    if (!building || !unit) return null;
    const binding = {
      buildingId: listing.buildingId,
      unitId: listing.unitId,
      listingId: listing.id,
    };
    const mediaById = new Map<string, unknown>();
    for (const value of [
      ...rawListingMedia.slice(0, MEDIA_LIMIT),
      ...rawBuildingMedia.slice(0, MEDIA_LIMIT),
    ]) {
      if (isRecord(value) && isRfc4122Uuid(value.id) && !mediaById.has(value.id)) {
        mediaById.set(value.id, value);
      }
    }
    const media = [...mediaById.values()]
      .map((value) => projectMedia(value, binding))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) =>
        (left.advertisingOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.advertisingOrder ?? Number.MAX_SAFE_INTEGER)
        || left.capturedAt.localeCompare(right.capturedAt)
        || left.id.localeCompare(right.id))
      .slice(0, MEDIA_LIMIT);
    const sessionIds = [...new Set(media.map((item) => item.captureSessionId))];
    const captureSessions = (await Promise.all(sessionIds.map(async (id) =>
      projectCaptureSession(
        await cached(sessionCache, id, () => dependencies.readCaptureSession(id)),
        id,
        binding,
      )))).filter((value): value is NonNullable<typeof value> => value !== null);
    const validSessionIds = new Set(captureSessions.map((session) => session.id));
    const sessionBoundMedia = media.filter((item) =>
      validSessionIds.has(item.captureSessionId));
    const rawLatestPackage = isSafeMediaPathSegment(rawLatestPackageId)
      ? await dependencies.readPackage(rawLatestPackageId)
      : null;
    const packagesById = new Map<string, unknown>();
    for (const value of [rawLatestPackage, ...rawPackages.slice(0, PACKAGE_LIMIT)]) {
      if (isRecord(value) && isSafeMediaPathSegment(value.id) && !packagesById.has(value.id)) {
        packagesById.set(value.id, value);
      }
    }
    const packages = [...packagesById.values()]
      .map((value) => projectPackage(value, listing.id))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) => right.version - left.version)
      .slice(0, PACKAGE_LIMIT);
    return {
      listing,
      building,
      unit,
      media: sessionBoundMedia,
      captureSessions,
      packages,
    };
  }))).filter((value): value is NonNullable<typeof value> => value !== null);

  const nextCursor = rawListingPage.length >= LISTING_LIMIT
    ? rawListingPage[rawListingPage.length - 1].key
    : undefined;
  return {
    candidates,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

"use client";

import { CAPTURE_ZONES } from "./capture-policy";
import type { ListingStatus, MediaKind, MediaZone } from "./types";

export const AD_PACKAGE_SOURCE_PATHS = [
  "fieldPlatform/listings",
  "fieldPlatform/buildings",
  "fieldPlatform/units",
  "fieldPlatform/media",
  "fieldPlatform/adPackages",
  "fieldPlatform/captureSessions",
] as const;

export type AdvertisingRootPath = typeof AD_PACKAGE_SOURCE_PATHS[number];
export type AdvertisingPathReader = (path: AdvertisingRootPath) => Promise<unknown>;

export interface AdReviewBuilding {
  id: string;
  managementNumber: string;
  name: string;
  roadAddress: string;
  purpose?: string;
  completionYear?: number;
  floorCount?: number;
  elevator?: boolean;
  parking: { available: boolean; totalSpaces?: number };
}

export interface AdReviewUnit {
  id: string;
  buildingId: string;
  unitLabel: string;
  structure?: string;
  floor?: number;
  direction?: string;
  options: string[];
}

export interface AdReviewListing {
  id: string;
  buildingId: string;
  unitId: string;
  unitLabel: string;
  status: Extract<ListingStatus, "reviewPending" | "ready" | "advertising">;
  advertisingApproved: boolean;
  depositWon: number;
  monthlyRentWon: number;
  maintenanceFeeWon: number;
  maintenanceFeeItems: string[];
  availableFrom?: string;
  contractTermMonths?: number;
  moveInCondition?: string;
  locationDescription?: string;
  parkingDescription: string;
  petPolicy: string;
  options: string[];
}

export interface AdReviewMedia {
  id: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  captureSessionId: string;
  kind: MediaKind;
  zone: MediaZone;
  slotId: string;
  required: boolean;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  storagePath: string;
  uploadState: "finalized";
  advertisingApproved: boolean;
  captureQualityState?: "valid" | "warning";
  driveFileId?: string;
  objectGeneration?: string;
  objectMd5Hash?: string;
  advertisingOrder?: number;
}

export interface AdReviewCaptureSession {
  id: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  status: "complete";
}

export interface AdReviewPackage {
  id: string;
  listingId: string;
  version: number;
  representativeMediaIds: string[];
  allApprovedMediaIds: string[];
  status: string;
}

export interface AdPackageReviewCandidate {
  listing: AdReviewListing;
  building: AdReviewBuilding;
  unit: AdReviewUnit;
  media: AdReviewMedia[];
  captureSessions: AdReviewCaptureSession[];
  packages: AdReviewPackage[];
}

export interface AdPackageReviewWorkspacePage {
  candidates: AdPackageReviewCandidate[];
  nextCursor?: string;
}

export interface AdPackageReadiness {
  ready: boolean;
  reasons: string[];
}

export interface AdPackagePreview {
  daangnDescription: string;
  naverFields: Array<{ label: string; value: string }>;
}

type UnknownRecord = Record<string, unknown>;

const eligibleStatuses = new Set(["reviewPending", "ready", "advertising"]);
const mediaZones = new Set<MediaZone>(CAPTURE_ZONES.map((zone) => zone.id));
const mediaZoneScopes = new Map<MediaZone, "building" | "unit">(
  CAPTURE_ZONES.map((zone) => [zone.id, zone.scope]),
);
const FIREBASE_KEY_MAX_BYTES = 128;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function safeFirebaseKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && utf8ByteLength(value) <= FIREBASE_KEY_MAX_BYTES
    && !/[.#$\[\]\/]/u.test(value)
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => nonEmpty(item))
    : [];
}

function records(value: unknown): Array<[string, UnknownRecord]> {
  if (!isRecord(value)) return [];
  return Object.entries(value).filter(
    (entry): entry is [string, UnknownRecord] => nonEmpty(entry[0]) && isRecord(entry[1]),
  );
}

function normalizeBuilding(id: string, value: UnknownRecord): AdReviewBuilding | null {
  if (
    value.id !== id
    || !nonEmpty(value.managementNumber)
    || !nonEmpty(value.name)
    || !nonEmpty(value.roadAddress)
    || !isRecord(value.parking)
    || typeof value.parking.available !== "boolean"
  ) return null;
  const totalSpaces = finiteNonNegativeInteger(value.parking.totalSpaces)
    ? value.parking.totalSpaces
    : undefined;
  return {
    id,
    managementNumber: value.managementNumber,
    name: value.name,
    roadAddress: value.roadAddress,
    ...(nonEmpty(value.purpose) ? { purpose: value.purpose } : {}),
    ...(finiteNonNegativeInteger(value.completionYear)
      ? { completionYear: value.completionYear }
      : {}),
    ...(finiteNonNegativeInteger(value.floorCount) ? { floorCount: value.floorCount } : {}),
    ...(typeof value.elevator === "boolean" ? { elevator: value.elevator } : {}),
    parking: {
      available: value.parking.available,
      ...(totalSpaces === undefined ? {} : { totalSpaces }),
    },
  };
}

function normalizeUnit(id: string, value: UnknownRecord): AdReviewUnit | null {
  if (
    value.id !== id
    || !nonEmpty(value.buildingId)
    || !nonEmpty(value.unitLabel)
  ) return null;
  return {
    id,
    buildingId: value.buildingId,
    unitLabel: value.unitLabel,
    ...(nonEmpty(value.structure) ? { structure: value.structure } : {}),
    ...(finiteNonNegativeInteger(value.floor) ? { floor: value.floor } : {}),
    ...(nonEmpty(value.direction) ? { direction: value.direction } : {}),
    options: stringArray(value.options),
  };
}

function normalizeListing(id: string, value: UnknownRecord): AdReviewListing | null {
  if (
    value.id !== id
    || !nonEmpty(value.buildingId)
    || !nonEmpty(value.unitId)
    || !nonEmpty(value.unitLabel)
    || !eligibleStatuses.has(String(value.status))
    || typeof value.advertisingApproved !== "boolean"
    || !finiteNonNegativeInteger(value.depositWon)
    || !finiteNonNegativeInteger(value.monthlyRentWon)
    || !finiteNonNegativeInteger(value.maintenanceFeeWon)
    || !nonEmpty(value.parkingDescription)
    || !nonEmpty(value.petPolicy)
  ) return null;
  return {
    id,
    buildingId: value.buildingId,
    unitId: value.unitId,
    unitLabel: value.unitLabel,
    status: value.status as AdReviewListing["status"],
    advertisingApproved: value.advertisingApproved,
    depositWon: value.depositWon,
    monthlyRentWon: value.monthlyRentWon,
    maintenanceFeeWon: value.maintenanceFeeWon,
    maintenanceFeeItems: stringArray(value.maintenanceFeeItems),
    ...(nonEmpty(value.availableFrom) ? { availableFrom: value.availableFrom } : {}),
    ...(finiteNonNegativeInteger(value.contractTermMonths)
      ? { contractTermMonths: value.contractTermMonths }
      : {}),
    ...(nonEmpty(value.moveInCondition) ? { moveInCondition: value.moveInCondition } : {}),
    ...(nonEmpty(value.locationDescription)
      ? { locationDescription: value.locationDescription }
      : {}),
    parkingDescription: value.parkingDescription,
    petPolicy: value.petPolicy,
    options: stringArray(value.options),
  };
}

function normalizeMedia(id: string, value: UnknownRecord): AdReviewMedia | null {
  if (
    value.id !== id
    || value.uploadState !== "finalized"
    || (value.excludedAt !== undefined && value.excludedAt !== null)
    || !nonEmpty(value.buildingId)
    || !nonEmpty(value.captureSessionId)
    || (value.kind !== "photo" && value.kind !== "video")
    || typeof value.zone !== "string"
    || !mediaZones.has(value.zone as MediaZone)
    || !nonEmpty(value.slotId)
    || typeof value.required !== "boolean"
    || !nonEmpty(value.mimeType)
    || !finiteNonNegativeInteger(value.sizeBytes)
    || !nonEmpty(value.capturedAt)
    || !nonEmpty(value.storagePath)
    || typeof value.advertisingApproved !== "boolean"
  ) return null;
  return {
    id,
    buildingId: value.buildingId,
    ...(nonEmpty(value.unitId) ? { unitId: value.unitId } : {}),
    ...(nonEmpty(value.listingId) ? { listingId: value.listingId } : {}),
    captureSessionId: value.captureSessionId,
    kind: value.kind,
    zone: value.zone as MediaZone,
    slotId: value.slotId,
    required: value.required,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    capturedAt: value.capturedAt,
    storagePath: value.storagePath,
    uploadState: "finalized",
    advertisingApproved: value.advertisingApproved,
    ...(value.captureQualityState === "valid" || value.captureQualityState === "warning"
      ? { captureQualityState: value.captureQualityState }
      : {}),
    ...(nonEmpty(value.driveFileId) ? { driveFileId: value.driveFileId } : {}),
    ...(nonEmpty(value.objectGeneration) ? { objectGeneration: value.objectGeneration } : {}),
    ...(nonEmpty(value.objectMd5Hash) ? { objectMd5Hash: value.objectMd5Hash } : {}),
    ...(finiteNonNegativeInteger(value.advertisingOrder)
      ? { advertisingOrder: value.advertisingOrder }
      : {}),
  };
}

function normalizeSession(id: string, value: UnknownRecord): AdReviewCaptureSession | null {
  if (
    value.id !== id
    || value.status !== "complete"
    || !nonEmpty(value.buildingId)
  ) return null;
  return {
    id,
    buildingId: value.buildingId,
    ...(nonEmpty(value.unitId) ? { unitId: value.unitId } : {}),
    ...(nonEmpty(value.listingId) ? { listingId: value.listingId } : {}),
    status: "complete",
  };
}

function normalizePackage(id: string, value: UnknownRecord): AdReviewPackage | null {
  if (
    value.id !== id
    || !nonEmpty(value.listingId)
    || !finiteNonNegativeInteger(value.version)
    || !nonEmpty(value.status)
  ) return null;
  return {
    id,
    listingId: value.listingId,
    version: value.version,
    representativeMediaIds: stringArray(value.representativeMediaIds),
    allApprovedMediaIds: stringArray(value.allApprovedMediaIds),
    status: value.status,
  };
}

export async function loadAdPackageReviewCandidates(
  readPath: AdvertisingPathReader,
): Promise<AdPackageReviewCandidate[]> {
  const values = await Promise.all(
    AD_PACKAGE_SOURCE_PATHS.map((path) => readPath(path)),
  );
  const roots = Object.fromEntries(
    AD_PACKAGE_SOURCE_PATHS.map((path, index) => [path, values[index]]),
  );
  const buildings = new Map(records(roots["fieldPlatform/buildings"])
    .map(([id, value]) => [id, normalizeBuilding(id, value)] as const)
    .filter((entry): entry is readonly [string, AdReviewBuilding] => entry[1] !== null));
  const units = new Map(records(roots["fieldPlatform/units"])
    .map(([id, value]) => [id, normalizeUnit(id, value)] as const)
    .filter((entry): entry is readonly [string, AdReviewUnit] => entry[1] !== null));
  const media = records(roots["fieldPlatform/media"])
    .map(([id, value]) => normalizeMedia(id, value))
    .filter((item): item is AdReviewMedia => item !== null);
  const sessions = records(roots["fieldPlatform/captureSessions"])
    .map(([id, value]) => normalizeSession(id, value))
    .filter((item): item is AdReviewCaptureSession => item !== null);
  const packages = records(roots["fieldPlatform/adPackages"])
    .map(([id, value]) => normalizePackage(id, value))
    .filter((item): item is AdReviewPackage => item !== null);

  return records(roots["fieldPlatform/listings"])
    .map(([id, value]) => normalizeListing(id, value))
    .filter((listing): listing is AdReviewListing => listing !== null)
    .flatMap((listing) => {
      const building = buildings.get(listing.buildingId);
      const unit = units.get(listing.unitId);
      if (!building || !unit || unit.buildingId !== building.id) return [];
      return [{
        listing,
        building,
        unit,
        media: media.filter((item) => {
          if (item.buildingId !== building.id) return false;
          if (mediaZoneScopes.get(item.zone) === "unit") {
            return item.unitId === unit.id && item.listingId === listing.id;
          }
          return (item.unitId === undefined || item.unitId === unit.id)
            && (item.listingId === undefined || item.listingId === listing.id);
        }),
        captureSessions: sessions.filter((item) =>
          item.buildingId === building.id
          && item.unitId === unit.id
          && item.listingId === listing.id),
        packages: packages
          .filter((item) => item.listingId === listing.id)
          .sort((left, right) => right.version - left.version),
      }];
    })
    .sort((left, right) =>
      left.building.name.localeCompare(right.building.name, "ko")
      || left.unit.unitLabel.localeCompare(right.unit.unitLabel, "ko"));
}

function normalizedCandidate(value: unknown): AdPackageReviewCandidate | null {
  if (!isRecord(value) || !isRecord(value.listing) || !isRecord(value.building)
    || !isRecord(value.unit) || !Array.isArray(value.media)
    || !Array.isArray(value.captureSessions) || !Array.isArray(value.packages)
    || !nonEmpty(value.listing.id) || !nonEmpty(value.building.id)
    || !nonEmpty(value.unit.id)) return null;
  const listing = normalizeListing(value.listing.id, value.listing);
  const building = normalizeBuilding(value.building.id, value.building);
  const unit = normalizeUnit(value.unit.id, value.unit);
  if (!listing || !building || !unit || listing.buildingId !== building.id
    || listing.unitId !== unit.id || unit.buildingId !== building.id) return null;

  const media = value.media.map((item) => {
    if (!isRecord(item) || !nonEmpty(item.id)) return null;
    return normalizeMedia(item.id, item);
  });
  const captureSessions = value.captureSessions.map((item) => {
    if (!isRecord(item) || !nonEmpty(item.id)) return null;
    return normalizeSession(item.id, item);
  });
  const packages = value.packages.map((item) => {
    if (!isRecord(item) || !nonEmpty(item.id)) return null;
    return normalizePackage(item.id, item);
  });
  if (media.some((item) => item === null)
    || captureSessions.some((item) => item === null)
    || packages.some((item) => item === null)) return null;

  return {
    listing,
    building,
    unit,
    media: (media as AdReviewMedia[]).filter((item) => {
      if (item.buildingId !== building.id) return false;
      if (mediaZoneScopes.get(item.zone) === "unit") {
        return item.unitId === unit.id && item.listingId === listing.id;
      }
      return (item.unitId === undefined || item.unitId === unit.id)
        && (item.listingId === undefined || item.listingId === listing.id);
    }),
    captureSessions: (captureSessions as AdReviewCaptureSession[]).filter((item) =>
      item.buildingId === building.id
      && item.unitId === unit.id
      && item.listingId === listing.id),
    packages: (packages as AdReviewPackage[])
      .filter((item) => item.listingId === listing.id)
      .sort((left, right) => right.version - left.version),
  };
}

export function normalizeAdPackageReviewWorkspace(
  value: unknown,
): AdPackageReviewWorkspacePage | null {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return null;
  const hasNextCursor = Object.prototype.hasOwnProperty.call(value, "nextCursor");
  if (hasNextCursor && !safeFirebaseKey(value.nextCursor)) return null;
  const candidates = value.candidates.map(normalizedCandidate);
  if (candidates.some((item) => item === null)) return null;
  const normalized = candidates as AdPackageReviewCandidate[];
  if (new Set(normalized.map((item) => item.listing.id)).size !== normalized.length) return null;
  return {
    candidates: normalized.sort((left, right) =>
      left.building.name.localeCompare(right.building.name, "ko")
      || left.unit.unitLabel.localeCompare(right.unit.unitLabel, "ko")),
    ...(hasNextCursor ? { nextCursor: value.nextCursor as string } : {}),
  };
}

function hasCompleteRequiredSession(
  candidate: AdPackageReviewCandidate,
  approvedMediaIds: Set<string>,
): boolean {
  const approvedMedia = candidate.media.filter((item) => approvedMediaIds.has(item.id));
  const captureSessionIds = new Set(approvedMedia.map((item) => item.captureSessionId));
  if (approvedMedia.length !== approvedMediaIds.size || captureSessionIds.size !== 1) {
    return false;
  }
  const [captureSessionId] = captureSessionIds;
  const session = candidate.captureSessions.find((item) =>
    item.id === captureSessionId
    && item.buildingId === candidate.building.id
    && item.unitId === candidate.unit.id
    && item.listingId === candidate.listing.id);
  if (!session) return false;
  return CAPTURE_ZONES.filter((zone) => zone.required).every((zone) =>
    approvedMedia.filter((item) =>
      item.zone === zone.id
      && item.kind === zone.kind
      && (zone.id !== "verticalVideo" || item.captureQualityState === "valid"))
      .length >= zone.minimum);
}

export function analyzeAdPackageReadiness(
  candidate: AdPackageReviewCandidate,
  approvedMediaIds: string[],
  representativeMediaIds: string[],
): AdPackageReadiness {
  const reasons: string[] = [];
  const approved = new Set(approvedMediaIds);
  const available = new Map(candidate.media.map((item) => [item.id, item]));
  if (candidate.listing.status !== "ready" && candidate.listing.status !== "advertising") {
    reasons.push("매물 검토 완료 또는 광고 준비 상태가 필요합니다.");
  }
  if (!candidate.listing.advertisingApproved) reasons.push("매물 광고 승인이 필요합니다.");
  if (!candidate.listing.availableFrom) reasons.push("입주 가능일을 입력해 주세요.");
  if (!candidate.listing.locationDescription) reasons.push("입지 설명을 입력해 주세요.");
  if (!candidate.listing.parkingDescription) reasons.push("주차 정보를 입력해 주세요.");
  if (!candidate.listing.petPolicy) reasons.push("반려동물 정책을 입력해 주세요.");
  if (approved.size === 0 || approvedMediaIds.some((id) => !available.has(id))) {
    reasons.push("광고에 포함할 완료 미디어를 선택해 주세요.");
  }
  if (
    representativeMediaIds.length === 0
    || new Set(representativeMediaIds).size !== representativeMediaIds.length
    || representativeMediaIds.some((id) => !approved.has(id) || available.get(id)?.kind !== "photo")
  ) {
    reasons.push("광고에 포함된 사진에서 대표사진 순서를 지정해 주세요.");
  }
  if (candidate.media.some((item) =>
    approved.has(item.id)
    && item.zone === "verticalVideo"
    && item.captureQualityState !== "valid")) {
    reasons.push("세로영상 검증을 완료해 주세요.");
  }
  if (!hasCompleteRequiredSession(candidate, approved)) {
    reasons.push("필수 구역이 하나의 완료된 촬영 세션에 모두 있어야 합니다.");
  }
  return { ready: reasons.length === 0, reasons };
}

function won(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function unitDisplayLabel(value: string): string {
  return value.endsWith("호") ? value : `${value}호`;
}

export function buildAdPackagePreview(
  candidate: AdPackageReviewCandidate,
  approvedMediaIds: string[],
  representativeMediaIds: string[],
): AdPackagePreview {
  const { building, unit, listing } = candidate;
  const daangnDescription = [
    `${building.name} ${unitDisplayLabel(unit.unitLabel)}`,
    `보증금 ${won(listing.depositWon)} · 월세 ${won(listing.monthlyRentWon)}`,
    `관리비 ${won(listing.maintenanceFeeWon)}`,
    `입주 가능일 ${listing.availableFrom ?? "확인 필요"}`,
    `주차 ${listing.parkingDescription}`,
    `옵션 ${listing.options.length ? listing.options.join(", ") : "없음"}`,
    listing.locationDescription ?? "입지 설명 확인 필요",
  ].join("\n");
  return {
    daangnDescription,
    naverFields: [
      { label: "소재지", value: building.roadAddress },
      { label: "호실", value: unit.unitLabel },
      { label: "보증금", value: won(listing.depositWon) },
      { label: "월세", value: won(listing.monthlyRentWon) },
      { label: "관리비", value: won(listing.maintenanceFeeWon) },
      { label: "구조", value: unit.structure ?? "확인 필요" },
      { label: "층", value: unit.floor === undefined ? "확인 필요" : `${unit.floor}층` },
      { label: "방향", value: unit.direction ?? "확인 필요" },
      { label: "주차", value: listing.parkingDescription },
      { label: "옵션", value: listing.options.join(", ") || "없음" },
      { label: "광고 미디어", value: `${approvedMediaIds.length}개` },
      { label: "대표사진", value: representativeMediaIds.join(" → ") },
    ],
  };
}

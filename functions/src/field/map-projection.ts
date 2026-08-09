import type {
  FieldMapProjection,
  ManagementContractInfo,
} from "./contracts.js";

export interface ProjectionBuilding {
  id: string;
  name: string;
  roadAddress: string;
  latitude?: unknown;
  longitude?: unknown;
  parking?: {
    available?: unknown;
    totalSpaces?: unknown;
  } | null;
  managementContract?: ManagementContractInfo | null;
  archivedAt?: unknown;
}

export interface ProjectionListing {
  listingId: string;
  buildingId: string;
  status: string;
  advertisingApproved?: unknown;
  depositWon?: unknown;
  monthlyRentWon?: unknown;
  maintenanceFeeWon?: unknown;
}

export interface ProjectionMedia {
  buildingId: string;
  uploadState?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function formatWon(value: unknown): string {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return "확인 필요";
  }

  if (value === 0) {
    return "0원";
  }

  if (value % 100_000_000 === 0) {
    return `${value / 100_000_000}억`;
  }

  if (value % 10_000 === 0) {
    return `${value / 10_000}만`;
  }

  return `${value.toLocaleString("en-US")}원`;
}

function buildRentSummary(listing: ProjectionListing | undefined): string {
  return [
    `보증금 ${formatWon(listing?.depositWon)}`,
    `월세 ${formatWon(listing?.monthlyRentWon)}`,
    `관리비 ${formatWon(listing?.maintenanceFeeWon)}`,
  ].join(" · ");
}

function buildParkingSummary(parking: unknown): string {
  if (isRecord(parking) && parking.available === false) {
    return "주차 불가";
  }

  if (!isRecord(parking) || parking.available !== true) {
    return "주차 정보 확인 필요";
  }

  const totalSpaces = parking.totalSpaces;
  if (
    typeof totalSpaces !== "number" ||
    !Number.isSafeInteger(totalSpaces) ||
    totalSpaces < 0
  ) {
    return "주차 가능 · 총 대수 확인 필요";
  }

  return `주차 가능 · 총 ${totalSpaces}대`;
}

export function buildMapProjection(input: {
  building: ProjectionBuilding | null;
  listings: ProjectionListing[];
  media: ProjectionMedia[];
  updatedAt: string;
}): FieldMapProjection | null {
  const building: unknown = input.building;
  const updatedAt: unknown = input.updatedAt;

  if (!isRecord(building)) {
    return null;
  }

  const {
    id: buildingId,
    name,
    roadAddress,
    latitude,
    longitude,
    parking,
    managementContract,
    archivedAt,
  } = building;

  if (
    !isNonEmptyString(buildingId) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(roadAddress) ||
    !isNonEmptyString(updatedAt) ||
    (archivedAt !== undefined && archivedAt !== null) ||
    !isRecord(managementContract) ||
    managementContract.status !== "active" ||
    !isValidCoordinate(latitude, -90, 90) ||
    !isValidCoordinate(longitude, -180, 180)
  ) {
    return null;
  }

  const rawListings: unknown = input.listings;
  const listings = Array.isArray(rawListings)
    ? rawListings.filter(
        (item): item is ProjectionListing =>
          isRecord(item) &&
          item.buildingId === buildingId &&
          isNonEmptyString(item.listingId) &&
          isNonEmptyString(item.status),
      )
    : [];
  const rawMedia: unknown = input.media;
  const media = Array.isArray(rawMedia)
    ? rawMedia.filter(
        (item): item is ProjectionMedia =>
          isRecord(item) && item.buildingId === buildingId,
      )
    : [];

  const vacancyCount = listings.filter((listing) => listing.status !== "closed").length;
  const markerStatus: FieldMapProjection["markerStatus"] =
    vacancyCount > 0 ? "vacant" : "managed";
  const approvedListing = listings
    .filter(
      (listing) =>
        listing.status !== "closed" && listing.advertisingApproved === true,
    )
    .reduce<ProjectionListing | undefined>(
      (selected, listing) =>
        selected === undefined || listing.listingId < selected.listingId
          ? listing
          : selected,
      undefined,
    );
  const captureStatus: FieldMapProjection["captureStatus"] = media.some(
    (item) =>
      item.uploadState === "finalized" || item.uploadState === "firebaseComplete",
  )
    ? "inProgress"
    : "notStarted";

  return {
    buildingId,
    name,
    roadAddress,
    latitude,
    longitude,
    markerStatus,
    vacancyCount,
    approvedRentSummary: buildRentSummary(approvedListing),
    parkingSummary: buildParkingSummary(parking),
    captureStatus,
    updatedAt,
  };
}

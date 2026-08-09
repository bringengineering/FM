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
  status: string;
  advertisingApproved?: unknown;
  depositWon?: unknown;
  monthlyRentWon?: unknown;
  maintenanceFeeWon?: unknown;
}

export interface ProjectionMedia {
  uploadState?: unknown;
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
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
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

function buildParkingSummary(parking: ProjectionBuilding["parking"]): string {
  if (parking?.available === false) {
    return "주차 불가";
  }

  if (parking?.available !== true) {
    return "주차 정보 확인 필요";
  }

  const totalSpaces = parking.totalSpaces;
  if (
    typeof totalSpaces !== "number" ||
    !Number.isFinite(totalSpaces) ||
    !Number.isInteger(totalSpaces) ||
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
  const { building } = input;
  if (
    building === null ||
    (building.archivedAt !== undefined && building.archivedAt !== null) ||
    building.managementContract?.status !== "active" ||
    !isValidCoordinate(building.latitude, -90, 90) ||
    !isValidCoordinate(building.longitude, -180, 180)
  ) {
    return null;
  }

  const vacancyCount = input.listings.filter((listing) => listing.status !== "closed").length;
  const markerStatus: FieldMapProjection["markerStatus"] =
    vacancyCount > 0 ? "vacant" : "managed";
  const approvedListing = input.listings.find(
    (listing) => listing.status !== "closed" && listing.advertisingApproved === true,
  );
  const captureStatus: FieldMapProjection["captureStatus"] = input.media.some(
    (item) =>
      item.uploadState === "finalized" || item.uploadState === "firebaseComplete",
  )
    ? "inProgress"
    : "notStarted";

  return {
    buildingId: building.id,
    name: building.name,
    roadAddress: building.roadAddress,
    latitude: building.latitude,
    longitude: building.longitude,
    markerStatus,
    vacancyCount,
    approvedRentSummary: buildRentSummary(approvedListing),
    parkingSummary: buildParkingSummary(building.parking),
    captureStatus,
    updatedAt: input.updatedAt,
  };
}

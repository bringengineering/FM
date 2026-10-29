import {
  CAPTURE_ZONES,
  MEDIA_POLICY,
  type MediaZone,
} from "../field/media-policy.js";

type UnknownRecord = Record<string, unknown>;

export interface AdvertisingProjectionSource {
  building: unknown;
  unit: unknown;
  listing: unknown;
  media: unknown;
}

export interface AdvertisingMediaProjection {
  id: string;
  kind: "photo" | "video";
  zone: string;
  slotId: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  storagePath: string;
  objectGeneration: string;
  objectMd5Hash?: string;
  captureSessionId: string;
  captureQualityState?: "valid" | "warning";
  previewStoragePath?: string;
  advertisingOrder?: number;
}

export interface AdvertisingProjection {
  building: {
    id: string;
    managementNumber: string;
    name: string;
    roadAddress: string;
    jibunAddress?: string;
    purpose?: string;
    completionYear?: number;
    floorCount?: number;
    elevator?: boolean;
    parking: { available: boolean; totalSpaces?: number };
  };
  unit: {
    id: string;
    buildingId: string;
    unitLabel: string;
    structure?: string;
    floor?: number;
    direction?: string;
    options: string[];
  };
  listing: {
    id: string;
    buildingId: string;
    unitId: string;
    unitLabel: string;
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
  };
  media: AdvertisingMediaProjection[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error("advertising_projection_invalid");
  return value;
}

function requiredString(record: UnknownRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("advertising_projection_invalid");
  }
  return value;
}

function optionalString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function requiredMoney(record: UnknownRecord, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("advertising_projection_invalid");
  }
  return value as number;
}

function optionalInteger(
  record: UnknownRecord,
  key: string,
  minimum = 0,
): number | undefined {
  const value = record[key];
  return Number.isSafeInteger(value) && (value as number) >= minimum
    ? value as number
    : undefined;
}

function stringArray(record: UnknownRecord, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function parkingProjection(value: unknown): {
  available: boolean;
  totalSpaces?: number;
} {
  const parking = requiredRecord(value);
  if (typeof parking.available !== "boolean") {
    throw new Error("advertising_projection_invalid");
  }
  const totalSpaces = optionalInteger(parking, "totalSpaces");
  return {
    available: parking.available,
    ...(totalSpaces === undefined ? {} : { totalSpaces }),
  };
}

function mediaProjection(
  value: unknown,
  binding: { buildingId: string; unitId: string; listingId: string },
): AdvertisingMediaProjection | null {
  if (!isRecord(value)) return null;
  const zonePolicy = CAPTURE_ZONES.find((candidate) => candidate.id === value.zone);
  if (
    zonePolicy === undefined
    || value.uploadState !== "finalized"
    || value.advertisingApproved !== true
    || (value.excludedAt !== undefined && value.excludedAt !== null)
    || value.buildingId !== binding.buildingId
    || (zonePolicy.scope === "unit" && value.unitId !== binding.unitId)
    || (zonePolicy.scope === "unit" && value.listingId !== binding.listingId)
    || (zonePolicy.scope === "building"
      && value.unitId !== undefined
      && value.unitId !== binding.unitId)
    || (zonePolicy.scope === "building"
      && value.listingId !== undefined
      && value.listingId !== binding.listingId)
  ) {
    return null;
  }
  const kind = value.kind;
  const sizeBytes = value.sizeBytes;
  if (
    (kind !== "photo" && kind !== "video")
    || zonePolicy.kind !== kind
    || typeof value.mimeType !== "string"
    || !Object.prototype.hasOwnProperty.call(MEDIA_POLICY[kind].mimeToExtension, value.mimeType)
    || !Number.isSafeInteger(sizeBytes)
    || (sizeBytes as number) <= 0
    || (zonePolicy.id === "verticalVideo" && value.captureQualityState !== "valid")
  ) {
    return null;
  }
  const required = [
    "id",
    "slotId",
    "mimeType",
    "capturedAt",
    "storagePath",
    "objectGeneration",
    "captureSessionId",
  ]
    .map((key) => optionalString(value, key));
  if (required.some((item) => item === undefined)) return null;
  const [
    id,
    slotId,
    mimeType,
    capturedAt,
    storagePath,
    objectGeneration,
    captureSessionId,
  ] = required as string[];
  if (!/^[1-9][0-9]{0,30}$/u.test(objectGeneration)) return null;
  const previewStoragePath = optionalString(value, "previewStoragePath");
  const objectMd5Hash = optionalString(value, "objectMd5Hash");
  const captureQualityState = value.captureQualityState === "valid"
    || value.captureQualityState === "warning"
    ? value.captureQualityState
    : undefined;
  const advertisingOrder = optionalInteger(value, "advertisingOrder", 1);
  return {
    id,
    kind,
    zone: zonePolicy.id as MediaZone,
    slotId,
    mimeType,
    sizeBytes: sizeBytes as number,
    capturedAt,
    storagePath,
    objectGeneration,
    captureSessionId,
    ...(objectMd5Hash === undefined ? {} : { objectMd5Hash }),
    ...(captureQualityState === undefined ? {} : { captureQualityState }),
    ...(previewStoragePath === undefined ? {} : { previewStoragePath }),
    ...(advertisingOrder === undefined ? {} : { advertisingOrder }),
  };
}

export function buildAdvertisingProjection(
  source: AdvertisingProjectionSource,
): AdvertisingProjection {
  const building = requiredRecord(source.building);
  const unit = requiredRecord(source.unit);
  const listing = requiredRecord(source.listing);
  const buildingId = requiredString(building, "id");
  const unitId = requiredString(unit, "id");
  const listingId = requiredString(listing, "id");
  if (
    unit.buildingId !== buildingId
    || listing.buildingId !== buildingId
    || listing.unitId !== unitId
  ) {
    throw new Error("advertising_projection_invalid");
  }

  const media = (Array.isArray(source.media) ? source.media : [])
    .map((value) => mediaProjection(value, { buildingId, unitId, listingId }))
    .filter((value): value is AdvertisingMediaProjection => value !== null)
    .sort((left, right) =>
      (left.advertisingOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.advertisingOrder ?? Number.MAX_SAFE_INTEGER)
      || left.capturedAt.localeCompare(right.capturedAt)
      || left.id.localeCompare(right.id));

  const jibunAddress = optionalString(building, "jibunAddress");
  const purpose = optionalString(building, "purpose");
  const completionYear = optionalInteger(building, "completionYear");
  const floorCount = optionalInteger(building, "floorCount");
  const elevator = typeof building.elevator === "boolean"
    ? building.elevator
    : undefined;
  const structure = optionalString(unit, "structure");
  const floor = optionalInteger(unit, "floor");
  const direction = optionalString(unit, "direction");
  const availableFrom = optionalString(listing, "availableFrom");
  const contractTermMonths = optionalInteger(listing, "contractTermMonths", 1);
  const moveInCondition = optionalString(listing, "moveInCondition");
  const locationDescription = optionalString(listing, "locationDescription");

  return {
    building: {
      id: buildingId,
      managementNumber: requiredString(building, "managementNumber"),
      name: requiredString(building, "name"),
      roadAddress: requiredString(building, "roadAddress"),
      ...(jibunAddress === undefined ? {} : { jibunAddress }),
      ...(purpose === undefined ? {} : { purpose }),
      ...(completionYear === undefined ? {} : { completionYear }),
      ...(floorCount === undefined ? {} : { floorCount }),
      ...(elevator === undefined ? {} : { elevator }),
      parking: parkingProjection(building.parking),
    },
    unit: {
      id: unitId,
      buildingId,
      unitLabel: requiredString(unit, "unitLabel"),
      ...(structure === undefined ? {} : { structure }),
      ...(floor === undefined ? {} : { floor }),
      ...(direction === undefined ? {} : { direction }),
      options: stringArray(unit, "options"),
    },
    listing: {
      id: listingId,
      buildingId,
      unitId,
      unitLabel: requiredString(listing, "unitLabel"),
      depositWon: requiredMoney(listing, "depositWon"),
      monthlyRentWon: requiredMoney(listing, "monthlyRentWon"),
      maintenanceFeeWon: requiredMoney(listing, "maintenanceFeeWon"),
      maintenanceFeeItems: stringArray(listing, "maintenanceFeeItems"),
      ...(availableFrom === undefined ? {} : { availableFrom }),
      ...(contractTermMonths === undefined ? {} : { contractTermMonths }),
      ...(moveInCondition === undefined ? {} : { moveInCondition }),
      ...(locationDescription === undefined ? {} : { locationDescription }),
      parkingDescription: requiredString(listing, "parkingDescription"),
      petPolicy: requiredString(listing, "petPolicy"),
      options: stringArray(listing, "options"),
    },
    media,
  };
}

import { CAPTURE_ZONES, MEDIA_POLICY } from "./capture-policy";
import type {
  CaptureAttachmentDescriptor,
  MediaKind,
  OwnerNoteDraft,
  UploadState,
} from "./types";

export const REGISTRATION_DRAFT_VERSION = 4 as const;
export const LEGACY_WIZARD_DRAFT_KEY = "bring-field-building-draft";

export class RegistrationDraftCompatibilityError extends Error {
  readonly code = "registration_draft_future_version";

  constructor(readonly draftVersion: number) {
    super("registration_draft_future_version");
    this.name = "RegistrationDraftCompatibilityError";
  }
}

export class RegistrationDraftProjectionError extends Error {
  readonly code = "registration_draft_units_required";

  constructor() {
    super("registration_draft_units_required");
    this.name = "RegistrationDraftProjectionError";
  }
}

export class RegistrationDraftOwnerNoteMismatchError extends Error {
  readonly code = "registration_draft_owner_note_mismatch";

  constructor() {
    super("registration_draft_owner_note_mismatch");
    this.name = "RegistrationDraftOwnerNoteMismatchError";
  }
}

export interface ManagementContractDraft {
  requested: boolean;
  startedOn?: string;
}

export interface OwnerNoteDraftInput {
  localId: string;
  body: string;
  recordedAt: string;
}

export interface BuildingDraftPayload {
  managementNumber: string;
  name: string;
  roadAddress: string;
  jibunAddress?: string;
  latitude: number;
  longitude: number;
  purpose?: string;
  completionYear?: number;
  floorCount?: number;
  elevator: boolean;
  parking: { available: boolean; totalSpaces?: number };
}

export interface UnitDraftPayload {
  localId: string;
  unitLabel: string;
  structure?: string;
  floor?: number;
  options: string[];
  isVacant: boolean;
}

export interface ListingDraftPayload {
  depositWon: number;
  monthlyRentWon: number;
  maintenanceFeeWon: number;
  maintenanceFeeItems: string[];
  availableFrom?: string;
  contractTermMonths?: number;
  parkingDescription: string;
  petPolicy: string;
  vacancyReason?: string;
  vacantSince?: string;
  moveInCondition?: string;
  locationDescription?: string;
  options: string[];
}

export interface SaveFieldRegistrationInput {
  requestId: string;
  draftId: string;
  building: BuildingDraftPayload;
  units: UnitDraftPayload[];
  listing: ListingDraftPayload;
  primaryUnitLocalId: string;
  managementContract: ManagementContractDraft;
  ownerNoteDrafts?: OwnerNoteDraftInput[];
}

export interface SaveFieldRegistrationResult {
  buildingId: string;
  unitIds: Record<string, string>;
  listingId: string;
  visitId: string;
}

export interface BuildingDraftState {
  managementNumber: string;
  name: string;
  roadAddress: string;
  jibunAddress: string;
  latitude: number | "";
  longitude: number | "";
  purpose: string;
  completionYear: number | "";
  floorCount: number | "";
  elevator: boolean;
  parkingAvailable: boolean;
  parkingSpaces: number | "";
  managementContractRequested: boolean;
  managementStartedOn: string;
}

export interface UnitDraftState {
  localId: string;
  unitLabel: string;
  structure: string;
  floor: number | "";
  options: string[];
  isVacant: boolean;
}

export interface ListingDraftState {
  depositWon: number | "";
  monthlyRentWon: number | "";
  maintenanceFeeWon: number | "";
  maintenanceFeeItems: string;
  availableFrom: string;
  contractTermMonths: number | "";
  parkingDescription: string;
  petPolicy: string;
  vacancyReason: string;
  vacantSince: string;
  conditionNote: string;
  options: string[];
  locationNote: string;
}

export interface DuplicateBuildingDraft {
  id: string;
  name: string;
}

export interface BuildingWizardDraft {
  draftVersion: typeof REGISTRATION_DRAFT_VERSION;
  draftId: string;
  requestId: string;
  building: BuildingDraftState;
  units: UnitDraftState[];
  listing: ListingDraftState;
  addressVerified: boolean;
  duplicateBuilding: DuplicateBuildingDraft | null;
  ownerNoteDrafts: OwnerNoteDraft[];
  captureSessionId: string;
  captureAttachments: CaptureAttachmentDescriptor[];
}

export interface StoredRegistrationDraft {
  ownerUid: string;
  draftId: string;
  updatedAt: string;
  value: BuildingWizardDraft;
}

export interface LegacyRegistrationDraftClaim {
  ownerUid: string;
  draftId: string;
  fingerprint: string;
}

export interface PreparedRegistrationDraft {
  envelope: StoredRegistrationDraft;
  legacyKeyToRemove: string | null;
  legacyClaim: LegacyRegistrationDraftClaim | null;
  needsInitialSave: boolean;
}

export type RegistrationDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface RegistrationDraftInitial {
  building?: Partial<BuildingDraftState>;
  units?: Array<Partial<UnitDraftState>>;
  listing?: Partial<ListingDraftState>;
}

const EMPTY_BUILDING: BuildingDraftState = {
  managementNumber: "",
  name: "",
  roadAddress: "",
  jibunAddress: "",
  latitude: "",
  longitude: "",
  purpose: "",
  completionYear: "",
  floorCount: "",
  elevator: false,
  parkingAvailable: false,
  parkingSpaces: "",
  managementContractRequested: false,
  managementStartedOn: "",
};

const EMPTY_LISTING: ListingDraftState = {
  depositWon: "",
  monthlyRentWon: "",
  maintenanceFeeWon: "",
  maintenanceFeeItems: "",
  availableFrom: "",
  contractTermMonths: "",
  parkingDescription: "",
  petPolicy: "확인 필요",
  vacancyReason: "",
  vacantSince: "",
  conditionNote: "",
  options: [],
  locationNote: "",
};

function emptyUnit(index = 1): UnitDraftState {
  return {
    localId: `unit-${index}`,
    unitLabel: "",
    structure: "",
    floor: "",
    options: [],
    isVacant: true,
  };
}

function isBinaryValue(value: unknown): boolean {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    !isBinaryValue(value);
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasAsciiAt(bytes: Uint8Array, offset: number, signature: string): boolean {
  if (bytes.length < offset + signature.length) return false;
  return [...signature].every((character, index) =>
    bytes[offset + index] === character.charCodeAt(0));
}

function decodeBase64Prefix(value: string): Uint8Array | null {
  const prefix = value.slice(0, 64);
  if (prefix.length % 4 === 1 || typeof globalThis.atob !== "function") return null;
  const padded = prefix + "=".repeat((4 - (prefix.length % 4)) % 4);
  try {
    const decoded = globalThis.atob(padded);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function hasBinaryFileSignature(bytes: Uint8Array): boolean {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const jpeg = [0xff, 0xd8, 0xff];
  const ebml = [0x1a, 0x45, 0xdf, 0xa3];
  const zipLocal = [0x50, 0x4b, 0x03, 0x04];
  const zipEmpty = [0x50, 0x4b, 0x05, 0x06];
  const zipSpanned = [0x50, 0x4b, 0x07, 0x08];

  return startsWithBytes(bytes, png) ||
    startsWithBytes(bytes, jpeg) ||
    hasAsciiAt(bytes, 0, "GIF87a") ||
    hasAsciiAt(bytes, 0, "GIF89a") ||
    hasAsciiAt(bytes, 0, "%PDF-") ||
    (hasAsciiAt(bytes, 0, "RIFF") && hasAsciiAt(bytes, 8, "WEBP")) ||
    startsWithBytes(bytes, zipLocal) ||
    startsWithBytes(bytes, zipEmpty) ||
    startsWithBytes(bytes, zipSpanned) ||
    hasAsciiAt(bytes, 4, "ftyp") ||
    startsWithBytes(bytes, ebml) ||
    hasAsciiAt(bytes, 0, "OggS");
}

function isBlockedString(value: string): boolean {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (
    normalized.startsWith("blob:") ||
    normalized.startsWith("base64,") ||
    /^data:[^,]*;base64,/.test(normalized)
  ) {
    return true;
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return false;
  }

  const decoded = decodeBase64Prefix(compact);
  return decoded ? hasBinaryFileSignature(decoded) : false;
}

const CAPTURE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CAPTURE_SLOT_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const CAPTURE_FILE_NAME_MAX_LENGTH = 255;
const CAPTURE_UPLOAD_STATES = new Set<UploadState>([
  "queued",
  "uploading",
  "objectStored",
  "finalizing",
  "finalized",
  "failed",
]);
const CAPTURE_ZONE_KINDS = new Map(
  CAPTURE_ZONES.map((zone) => [zone.id, zone.kind] as const),
);

function canonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function mediaKindForMime(value: unknown): MediaKind | null {
  if (typeof value !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(MEDIA_POLICY.photo.mimeToExtension, value)) {
    return "photo";
  }
  if (Object.prototype.hasOwnProperty.call(MEDIA_POLICY.video.mimeToExtension, value)) {
    return "video";
  }
  return null;
}

function captureAttachmentValue(
  value: unknown,
  captureSessionId: string,
): CaptureAttachmentDescriptor | null {
  if (!isRecord(value)) return null;
  const mimeKind = mediaKindForMime(value.mimeType);
  const zoneKind = typeof value.zone === "string"
    ? CAPTURE_ZONE_KINDS.get(value.zone as never)
    : undefined;
  if (
    typeof value.mediaId !== "string"
    || !CAPTURE_UUID_PATTERN.test(value.mediaId)
    || value.captureSessionId !== captureSessionId
    || !CAPTURE_UUID_PATTERN.test(captureSessionId)
    || (value.kind !== "photo" && value.kind !== "video")
    || mimeKind !== value.kind
    || zoneKind !== value.kind
    || typeof value.zone !== "string"
    || typeof value.slotId !== "string"
    || !CAPTURE_SLOT_PATTERN.test(value.slotId)
    || typeof value.required !== "boolean"
    || typeof value.originalFileName !== "string"
    || value.originalFileName.length === 0
    || value.originalFileName.length > CAPTURE_FILE_NAME_MAX_LENGTH
    || isBlockedString(value.originalFileName)
    || /[\\/\u0000-\u001f\u007f]/u.test(value.originalFileName)
    || typeof value.mimeType !== "string"
    || !Number.isSafeInteger(value.sizeBytes)
    || (value.sizeBytes as number) <= 0
    || (value.sizeBytes as number) > MEDIA_POLICY[value.kind].maxBytes
    || !Number.isSafeInteger(value.lastModified)
    || (value.lastModified as number) < 0
    || !canonicalIsoTimestamp(value.capturedAt)
    || typeof value.uploadState !== "string"
    || !CAPTURE_UPLOAD_STATES.has(value.uploadState as UploadState)
    || !Number.isSafeInteger(value.uploadProgress)
    || (value.uploadProgress as number) < 0
    || (value.uploadProgress as number) > 100
  ) {
    return null;
  }

  if (
    value.failureCode !== undefined
    && (
      typeof value.failureCode !== "string"
      || !value.failureCode
      || isBlockedString(value.failureCode)
    )
  ) {
    return null;
  }
  if (
    value.replacesMediaId !== undefined
    && (
      typeof value.replacesMediaId !== "string"
      || !CAPTURE_UUID_PATTERN.test(value.replacesMediaId)
    )
  ) {
    return null;
  }

  let videoMetadata: CaptureAttachmentDescriptor["videoMetadata"];
  if (value.videoMetadata !== undefined) {
    if (
      value.kind !== "video"
      || !isRecord(value.videoMetadata)
      || typeof value.videoMetadata.durationSeconds !== "number"
      || !Number.isFinite(value.videoMetadata.durationSeconds)
      || value.videoMetadata.durationSeconds <= 0
      || typeof value.videoMetadata.width !== "number"
      || !Number.isFinite(value.videoMetadata.width)
      || value.videoMetadata.width <= 0
      || typeof value.videoMetadata.height !== "number"
      || !Number.isFinite(value.videoMetadata.height)
      || value.videoMetadata.height <= 0
    ) {
      return null;
    }
    videoMetadata = {
      durationSeconds: value.videoMetadata.durationSeconds,
      width: value.videoMetadata.width,
      height: value.videoMetadata.height,
    };
  }

  return {
    mediaId: value.mediaId,
    captureSessionId,
    kind: value.kind,
    zone: value.zone as CaptureAttachmentDescriptor["zone"],
    slotId: value.slotId,
    required: value.required,
    originalFileName: value.originalFileName,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes as number,
    lastModified: value.lastModified as number,
    capturedAt: value.capturedAt,
    uploadState: value.uploadState as UploadState,
    uploadProgress: value.uploadProgress as number,
    ...(value.failureCode === undefined ? {} : { failureCode: value.failureCode }),
    ...(value.replacesMediaId === undefined
      ? {}
      : { replacesMediaId: value.replacesMediaId }),
    ...(videoMetadata ? { videoMetadata } : {}),
  };
}

function ownerNoteDraftValue(value: unknown, draftId: string): OwnerNoteDraft | null {
  if (!isRecord(value)) return null;
  if (!(typeof value.localId === "string" &&
    /^[A-Za-z0-9_-]{8,128}$/.test(value.localId) &&
    value.draftId === draftId &&
    typeof value.body === "string" &&
    Boolean(value.body.trim()) &&
    !isBlockedString(value.body) &&
    typeof value.recordedAt === "string" &&
    Number.isFinite(Date.parse(value.recordedAt)))) return null;
  return {
    localId: value.localId,
    draftId,
    body: value.body,
    recordedAt: value.recordedAt,
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && !isBlockedString(value) ? value : fallback;
}

function identifierValue(value: unknown, fallback: string): string {
  const candidate = stringValue(value, "").trim();
  return candidate || fallback;
}

function numberOrEmpty(value: unknown, fallback: number | ""): number | "" {
  if (value === "") return "";
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((item) => {
    const candidate = stringValue(item, "");
    return candidate ? [candidate] : [];
  });
}

function mergeRegistrationDraft(
  base: BuildingWizardDraft,
  raw: unknown,
): BuildingWizardDraft {
  if (!isRecord(raw)) return base;

  const rawBuilding = isRecord(raw.building) ? raw.building : {};
  const rawListing = isRecord(raw.listing) ? raw.listing : {};
  const building: BuildingDraftState = {
    managementNumber: stringValue(
      rawBuilding.managementNumber,
      base.building.managementNumber,
    ),
    name: stringValue(rawBuilding.name, base.building.name),
    roadAddress: stringValue(rawBuilding.roadAddress, base.building.roadAddress),
    jibunAddress: stringValue(rawBuilding.jibunAddress, base.building.jibunAddress),
    latitude: numberOrEmpty(rawBuilding.latitude, base.building.latitude),
    longitude: numberOrEmpty(rawBuilding.longitude, base.building.longitude),
    purpose: stringValue(rawBuilding.purpose, base.building.purpose),
    completionYear: numberOrEmpty(
      rawBuilding.completionYear,
      base.building.completionYear,
    ),
    floorCount: numberOrEmpty(rawBuilding.floorCount, base.building.floorCount),
    elevator: booleanValue(rawBuilding.elevator, base.building.elevator),
    parkingAvailable: booleanValue(
      rawBuilding.parkingAvailable,
      base.building.parkingAvailable,
    ),
    parkingSpaces: numberOrEmpty(rawBuilding.parkingSpaces, base.building.parkingSpaces),
    managementContractRequested: booleanValue(
      rawBuilding.managementContractRequested,
      base.building.managementContractRequested,
    ),
    managementStartedOn: stringValue(
      rawBuilding.managementStartedOn,
      base.building.managementStartedOn,
    ),
  };

  const listing: ListingDraftState = {
    depositWon: numberOrEmpty(rawListing.depositWon, base.listing.depositWon),
    monthlyRentWon: numberOrEmpty(rawListing.monthlyRentWon, base.listing.monthlyRentWon),
    maintenanceFeeWon: numberOrEmpty(
      rawListing.maintenanceFeeWon,
      base.listing.maintenanceFeeWon,
    ),
    maintenanceFeeItems: stringValue(
      rawListing.maintenanceFeeItems,
      base.listing.maintenanceFeeItems,
    ),
    availableFrom: stringValue(rawListing.availableFrom, base.listing.availableFrom),
    contractTermMonths: numberOrEmpty(
      rawListing.contractTermMonths,
      base.listing.contractTermMonths,
    ),
    parkingDescription: stringValue(
      rawListing.parkingDescription,
      base.listing.parkingDescription,
    ),
    petPolicy: stringValue(rawListing.petPolicy, base.listing.petPolicy),
    vacancyReason: stringValue(rawListing.vacancyReason, base.listing.vacancyReason),
    vacantSince: stringValue(rawListing.vacantSince, base.listing.vacantSince),
    conditionNote: stringValue(rawListing.conditionNote, base.listing.conditionNote),
    options: stringArray(rawListing.options, base.listing.options),
    locationNote: stringValue(rawListing.locationNote, base.listing.locationNote),
  };

  let units = base.units;
  if (Array.isArray(raw.units) && raw.units.length > 0) {
    const unitSources = raw.units.flatMap((value, index) =>
      isRecord(value) ? [{ value, index }] : []);
    const reservedLocalIds = new Set(
      unitSources
        .map(({ value }) => identifierValue(value.localId, ""))
        .filter(Boolean),
    );
    const assignedLocalIds = new Set<string>();
    let generatedUnitNumber = 1;
    const nextAvailableLocalId = () => {
      let candidate = `unit-${generatedUnitNumber}`;
      while (reservedLocalIds.has(candidate) || assignedLocalIds.has(candidate)) {
        generatedUnitNumber += 1;
        candidate = `unit-${generatedUnitNumber}`;
      }
      generatedUnitNumber += 1;
      return candidate;
    };

    const migratedUnits = unitSources.map(({ value, index }) => {
      const fallback = base.units[index] || emptyUnit(index + 1);
      const preferredLocalId = identifierValue(value.localId, "");
      const fallbackLocalId = identifierValue(fallback.localId, "");
      let localId = preferredLocalId;
      if (!localId && fallbackLocalId && !reservedLocalIds.has(fallbackLocalId) &&
        !assignedLocalIds.has(fallbackLocalId)) {
        localId = fallbackLocalId;
      }
      if (!localId || assignedLocalIds.has(localId)) {
        localId = nextAvailableLocalId();
      }
      assignedLocalIds.add(localId);

      return {
        localId,
        unitLabel: stringValue(value.unitLabel, fallback.unitLabel),
        structure: stringValue(value.structure, fallback.structure),
        floor: numberOrEmpty(value.floor, fallback.floor),
        options: stringArray(value.options, fallback.options),
        isVacant: booleanValue(value.isVacant, fallback.isVacant),
      };
    });
    if (migratedUnits.length > 0) units = migratedUnits;
  }

  let duplicateBuilding = base.duplicateBuilding;
  if (raw.duplicateBuilding === null) {
    duplicateBuilding = null;
  } else if (isRecord(raw.duplicateBuilding)) {
    const id = identifierValue(raw.duplicateBuilding.id, "");
    const name = stringValue(raw.duplicateBuilding.name, "");
    duplicateBuilding = id && name ? { id, name } : null;
  }

  const draftId = identifierValue(raw.draftId, base.draftId);
  const requestId = identifierValue(raw.requestId, base.requestId);
  const rawCaptureSessionId = identifierValue(raw.captureSessionId, "");
  const captureSessionId = CAPTURE_UUID_PATTERN.test(rawCaptureSessionId)
    ? rawCaptureSessionId
    : base.captureSessionId;
  const ownerNoteDrafts = Array.isArray(raw.ownerNoteDrafts)
    ? raw.ownerNoteDrafts.flatMap((note) => {
      const projected = ownerNoteDraftValue(note, draftId);
      return projected ? [projected] : [];
    })
    : base.ownerNoteDrafts;
  const captureAttachments = Array.isArray(raw.captureAttachments)
    ? raw.captureAttachments.flatMap((attachment) => {
      const projected = captureAttachmentValue(attachment, captureSessionId);
      return projected ? [projected] : [];
    })
    : base.captureAttachments;

  return {
    draftVersion: REGISTRATION_DRAFT_VERSION,
    draftId,
    requestId,
    building,
    units,
    listing,
    addressVerified: booleanValue(raw.addressVerified, base.addressVerified),
    duplicateBuilding,
    ownerNoteDrafts,
    captureSessionId,
    captureAttachments,
  };
}

export function createRegistrationDraft(
  initial?: RegistrationDraftInitial,
  idFactory: () => string = () => crypto.randomUUID(),
): BuildingWizardDraft {
  const id = idFactory();
  const captureSessionId = idFactory();
  const draft: BuildingWizardDraft = {
    draftVersion: REGISTRATION_DRAFT_VERSION,
    draftId: id,
    requestId: id,
    building: { ...EMPTY_BUILDING },
    units: [emptyUnit()],
    listing: { ...EMPTY_LISTING },
    addressVerified: false,
    duplicateBuilding: null,
    ownerNoteDrafts: [],
    captureSessionId,
    captureAttachments: [],
  };

  return mergeRegistrationDraft(draft, initial);
}

export function migrateRegistrationDraft(
  raw: unknown,
  initial?: RegistrationDraftInitial,
  idFactory: () => string = () => crypto.randomUUID(),
): BuildingWizardDraft {
  if (
    isRecord(raw) &&
    typeof raw.draftVersion === "number" &&
    raw.draftVersion > REGISTRATION_DRAFT_VERSION
  ) {
    throw new RegistrationDraftCompatibilityError(raw.draftVersion);
  }
  const existingDraftId = isRecord(raw) ? identifierValue(raw.draftId, "") : "";
  const existingRequestId = isRecord(raw) ? identifierValue(raw.requestId, "") : "";
  const rawCaptureSessionId = isRecord(raw)
    ? identifierValue(raw.captureSessionId, "")
    : "";
  const existingCaptureSessionId = CAPTURE_UUID_PATTERN.test(rawCaptureSessionId)
    ? rawCaptureSessionId
    : "";
  let baseIdCall = 0;
  const baseIdFactory = () => {
    baseIdCall += 1;
    if (baseIdCall === 1 && existingDraftId && existingRequestId) {
      return existingDraftId;
    }
    if (baseIdCall === 2 && existingCaptureSessionId) {
      return existingCaptureSessionId;
    }
    return idFactory();
  };
  return mergeRegistrationDraft(createRegistrationDraft(initial, baseIdFactory), raw);
}

export function wizardDraftStorageKey(uid: string, draftId: string): string {
  return `bring-field-wizard:v${REGISTRATION_DRAFT_VERSION}:${encodeURIComponent(uid)}:${encodeURIComponent(draftId)}`;
}

export function activeWizardDraftKey(uid: string): string {
  return `bring-field-wizard:active:${encodeURIComponent(uid)}`;
}

export function legacyWizardDraftClaimKey(legacyKey: string): string {
  return `bring-field-wizard:legacy-claim:v${REGISTRATION_DRAFT_VERSION}:${encodeURIComponent(legacyKey)}`;
}

export function getOrCreateActiveWizardDraftId(
  storage: RegistrationDraftStorage,
  uid: string,
  idFactory: () => string,
): string {
  const existing = storage.getItem(activeWizardDraftKey(uid));
  if (existing) return existing;
  const created = idFactory();
  storage.setItem(activeWizardDraftKey(uid), created);
  return created;
}

export function readActiveWizardDraftId(
  storage: RegistrationDraftStorage,
  uid: string,
): string | null {
  return storage.getItem(activeWizardDraftKey(uid));
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function legacyDraftFingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${raw.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function parseLegacyDraftClaim(raw: string | null): LegacyRegistrationDraftClaim | null {
  const value = parseRecord(raw);
  if (!value || typeof value.ownerUid !== "string" || !value.ownerUid ||
    typeof value.draftId !== "string" || !value.draftId ||
    typeof value.fingerprint !== "string" || !value.fingerprint) return null;
  return {
    ownerUid: value.ownerUid,
    draftId: value.draftId,
    fingerprint: value.fingerprint,
  };
}

function scopedDraftValue(
  raw: unknown,
  draftId: string,
  initial: RegistrationDraftInitial | undefined,
  idFactory: () => string,
): BuildingWizardDraft {
  const migrated = migrateRegistrationDraft(raw, initial, idFactory);
  return {
    ...migrated,
    draftId,
    ownerNoteDrafts: migrated.ownerNoteDrafts.filter((note) => note.draftId === draftId),
  };
}

export function prepareWizardDraft(
  storage: RegistrationDraftStorage,
  options: {
    uid: string;
    draftId: string;
    legacyKey?: string;
    initial?: Parameters<typeof createRegistrationDraft>[0];
    idFactory?: Parameters<typeof createRegistrationDraft>[1];
    now?: () => string;
  },
): PreparedRegistrationDraft {
  const key = wizardDraftStorageKey(options.uid, options.draftId);
  let generatedId = 0;
  const idFactory = options.idFactory ??
    (() => `${options.draftId}-generated-${++generatedId}`);
  const legacyKey = options.legacyKey ?? null;
  const legacyRaw = legacyKey ? storage.getItem(legacyKey) : null;
  const legacy = parseRecord(legacyRaw);
  const fingerprint = legacyRaw !== null && legacy
    ? legacyDraftFingerprint(legacyRaw)
    : null;
  const claimKey = legacyKey ? legacyWizardDraftClaimKey(legacyKey) : null;
  const storedClaim = claimKey
    ? parseLegacyDraftClaim(storage.getItem(claimKey))
    : null;
  const matchingClaim = storedClaim && fingerprint &&
    storedClaim.fingerprint === fingerprint
    ? storedClaim
    : null;
  const claimOwnedByCurrentDraft = matchingClaim?.ownerUid === options.uid &&
    matchingClaim.draftId === options.draftId;
  const legacyClaimedElsewhere = Boolean(matchingClaim && !claimOwnedByCurrentDraft);
  const scoped = parseRecord(storage.getItem(key));
  if (scoped?.ownerUid === options.uid && scoped.draftId === options.draftId) {
    const shouldCleanLegacy = Boolean(legacy && claimOwnedByCurrentDraft && legacyKey);
    const nextClaim = shouldCleanLegacy && fingerprint
      ? {
          ownerUid: options.uid,
          draftId: options.draftId,
          fingerprint,
        }
      : null;
    return {
      envelope: {
        ownerUid: options.uid,
        draftId: options.draftId,
        updatedAt: typeof scoped.updatedAt === "string" ? scoped.updatedAt : "",
        value: scopedDraftValue(scoped.value, options.draftId, options.initial, idFactory),
      },
      legacyKeyToRemove: shouldCleanLegacy ? legacyKey : null,
      legacyClaim: nextClaim,
      needsInitialSave: false,
    };
  }

  const eligibleLegacy = legacy && !legacyClaimedElsewhere ? legacy : null;
  const migrated = scopedDraftValue(
    eligibleLegacy,
    options.draftId,
    options.initial,
    idFactory,
  );
  const envelope: StoredRegistrationDraft = {
    ownerUid: options.uid,
    draftId: options.draftId,
    updatedAt: (options.now ?? (() => new Date().toISOString()))(),
    value: migrated,
  };
  const nextClaim = eligibleLegacy && fingerprint
    ? {
        ownerUid: options.uid,
        draftId: options.draftId,
        fingerprint,
      }
    : null;
  return {
    envelope,
    legacyKeyToRemove: nextClaim ? legacyKey : null,
    legacyClaim: nextClaim,
    needsInitialSave: true,
  };
}

/** Read and migrate a draft without mutating browser storage. */
export function loadWizardDraft(
  storage: RegistrationDraftStorage,
  options: Parameters<typeof prepareWizardDraft>[1],
): StoredRegistrationDraft {
  return prepareWizardDraft(storage, options).envelope;
}

export function commitPreparedWizardDraft(
  storage: RegistrationDraftStorage,
  prepared: PreparedRegistrationDraft,
  options: { activeUid?: string; updatedAt?: string } = {},
): void {
  if (options.activeUid && options.activeUid !== prepared.envelope.ownerUid) {
    throw new Error("registration_draft_active_uid_mismatch");
  }

  let shouldCleanLegacy = false;
  let claimKeyToWrite: string | null = null;
  if (prepared.legacyClaim && prepared.legacyKeyToRemove) {
    const currentLegacyRaw = storage.getItem(prepared.legacyKeyToRemove);
    const currentFingerprint = currentLegacyRaw === null
      ? null
      : legacyDraftFingerprint(currentLegacyRaw);
    const claimKey = legacyWizardDraftClaimKey(prepared.legacyKeyToRemove);
    const currentClaim = parseLegacyDraftClaim(storage.getItem(claimKey));
    const ownedClaim = currentClaim?.fingerprint === prepared.legacyClaim.fingerprint &&
      currentClaim.ownerUid === prepared.legacyClaim.ownerUid &&
      currentClaim.draftId === prepared.legacyClaim.draftId;
    if (currentLegacyRaw === null) {
      if (!ownedClaim) throw new Error("registration_draft_legacy_changed");
    } else {
      if (currentFingerprint !== prepared.legacyClaim.fingerprint) {
        throw new Error("registration_draft_legacy_changed");
      }
      if (currentClaim && currentClaim.fingerprint === currentFingerprint && !ownedClaim) {
        throw new Error("registration_draft_legacy_claimed");
      }
      claimKeyToWrite = claimKey;
      shouldCleanLegacy = true;
    }
  }

  if (options.activeUid) {
    storage.setItem(
      activeWizardDraftKey(options.activeUid),
      prepared.envelope.draftId,
    );
  }
  if (claimKeyToWrite && prepared.legacyClaim) {
    storage.setItem(claimKeyToWrite, JSON.stringify(prepared.legacyClaim));
  }

  saveWizardDraft(
    storage,
    prepared.envelope,
    options.updatedAt ?? prepared.envelope.updatedAt,
  );

  if (shouldCleanLegacy && prepared.legacyKeyToRemove) {
    storage.removeItem(prepared.legacyKeyToRemove);
  }
}

export function saveWizardDraft(
  storage: RegistrationDraftStorage,
  envelope: StoredRegistrationDraft,
  updatedAt = new Date().toISOString(),
): void {
  const value = scopedDraftValue(
    envelope.value,
    envelope.draftId,
    undefined,
    () => envelope.value.requestId || envelope.draftId,
  );
  storage.setItem(wizardDraftStorageKey(envelope.ownerUid, envelope.draftId), JSON.stringify({
    ownerUid: envelope.ownerUid,
    draftId: envelope.draftId,
    updatedAt,
    value,
  } satisfies StoredRegistrationDraft));
}

export function removeWizardDraft(
  storage: RegistrationDraftStorage,
  uid: string,
  draftId: string,
): void {
  storage.removeItem(wizardDraftStorageKey(uid, draftId));
  if (storage.getItem(activeWizardDraftKey(uid)) === draftId) {
    storage.removeItem(activeWizardDraftKey(uid));
  }
}

function trimmedString(value: string): string {
  return isBlockedString(value) ? "" : value.trim();
}

function optionalString(value: string): string | undefined {
  return trimmedString(value) || undefined;
}

function requiredNumber(value: number | ""): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: number | ""): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function toSaveFieldRegistrationInput(
  draft: BuildingWizardDraft,
): SaveFieldRegistrationInput {
  if (draft.units.length === 0) {
    throw new RegistrationDraftProjectionError();
  }
  if (draft.ownerNoteDrafts.some((note) => note.draftId !== draft.draftId)) {
    throw new RegistrationDraftOwnerNoteMismatchError();
  }

  const units = draft.units.map((unit) => ({
    localId: trimmedString(unit.localId),
    unitLabel: trimmedString(unit.unitLabel),
    structure: optionalString(unit.structure),
    floor: optionalNumber(unit.floor),
    options: unit.options.map(trimmedString).filter(Boolean),
    isVacant: unit.isVacant,
  }));

  return {
    requestId: trimmedString(draft.requestId),
    draftId: trimmedString(draft.draftId),
    building: {
      managementNumber: trimmedString(draft.building.managementNumber),
      name: trimmedString(draft.building.name),
      roadAddress: trimmedString(draft.building.roadAddress),
      jibunAddress: optionalString(draft.building.jibunAddress),
      latitude: requiredNumber(draft.building.latitude),
      longitude: requiredNumber(draft.building.longitude),
      purpose: optionalString(draft.building.purpose),
      completionYear: optionalNumber(draft.building.completionYear),
      floorCount: optionalNumber(draft.building.floorCount),
      elevator: draft.building.elevator,
      parking: {
        available: draft.building.parkingAvailable,
        totalSpaces: optionalNumber(draft.building.parkingSpaces),
      },
    },
    units,
    listing: {
      depositWon: requiredNumber(draft.listing.depositWon),
      monthlyRentWon: requiredNumber(draft.listing.monthlyRentWon),
      maintenanceFeeWon: requiredNumber(draft.listing.maintenanceFeeWon),
      maintenanceFeeItems: draft.listing.maintenanceFeeItems
        .split(",")
        .map(trimmedString)
        .filter(Boolean),
      availableFrom: optionalString(draft.listing.availableFrom),
      contractTermMonths: optionalNumber(draft.listing.contractTermMonths),
      parkingDescription: trimmedString(draft.listing.parkingDescription),
      petPolicy: trimmedString(draft.listing.petPolicy),
      vacancyReason: optionalString(draft.listing.vacancyReason),
      vacantSince: optionalString(draft.listing.vacantSince),
      moveInCondition: optionalString(draft.listing.conditionNote),
      locationDescription: optionalString(draft.listing.locationNote),
      options: draft.listing.options.map(trimmedString).filter(Boolean),
    },
    primaryUnitLocalId: units[0].localId,
    managementContract: {
      requested: draft.building.managementContractRequested,
      startedOn: draft.building.managementContractRequested
        ? optionalString(draft.building.managementStartedOn)
        : undefined,
    },
    ownerNoteDrafts: draft.ownerNoteDrafts.map(({ localId, body, recordedAt }) => ({
      localId,
      body: body.trim(),
      recordedAt,
    })),
  };
}

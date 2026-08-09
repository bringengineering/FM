export const REGISTRATION_DRAFT_VERSION = 2 as const;

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
}

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
  if (compact.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return false;
  }

  const hasBinaryMagic = /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|JVBERi0|UklGR|UEsDB)/.test(compact);
  return hasBinaryMagic || (compact.length >= 256 && /[+/=]/.test(compact));
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

  return {
    draftVersion: REGISTRATION_DRAFT_VERSION,
    draftId: identifierValue(raw.draftId, base.draftId),
    requestId: identifierValue(raw.requestId, base.requestId),
    building,
    units,
    listing,
    addressVerified: booleanValue(raw.addressVerified, base.addressVerified),
    duplicateBuilding,
  };
}

export function createRegistrationDraft(
  initial?: RegistrationDraftInitial,
  idFactory: () => string = () => crypto.randomUUID(),
): BuildingWizardDraft {
  const id = idFactory();
  const draft: BuildingWizardDraft = {
    draftVersion: REGISTRATION_DRAFT_VERSION,
    draftId: id,
    requestId: id,
    building: { ...EMPTY_BUILDING },
    units: [emptyUnit()],
    listing: { ...EMPTY_LISTING },
    addressVerified: false,
    duplicateBuilding: null,
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
  return mergeRegistrationDraft(createRegistrationDraft(initial, idFactory), raw);
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
    ownerNoteDrafts: [],
  };
}

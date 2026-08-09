import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  BuildingDraftPayload,
  FieldActor,
  ListingDraftPayload,
  ManagementContractInfo,
  SaveFieldRegistrationInput,
  SaveFieldRegistrationResult,
  UnitDraftPayload,
} from "./contracts.js";
import { buildMapProjection } from "./map-projection.js";
import {
  buildInitialOwnerNotePatch,
  normalizeOwnerNoteDrafts,
  resolveOwnerNoteActorName,
  type OwnerNoteActor,
  type OwnerNoteDraftInput,
} from "./owner-notes.js";

export const FIELD_REGISTRATION_LIMITS = Object.freeze({
  idBytes: 128,
  domainStringBytes: 4_096,
  units: 200,
  stringArrayItems: 100,
  normalizedPayloadBytes: 256 * 1_024,
});

export interface RegistrationRequestReceipt {
  requestHash: string;
  result: SaveFieldRegistrationResult;
  completedAt: string;
}

export interface RegistrationReservation {
  uid: string;
  requestId: string;
  draftId: string;
  requestHash: string;
  result: SaveFieldRegistrationResult;
  claimedAt: string;
  ownerNoteCreatedByName?: string;
}

export type RegistrationReservationOutcome =
  | { status: "acquired"; reservation: RegistrationReservation }
  | { status: "requestConflict" }
  | { status: "draftConflict" };

export interface SaveFieldRegistrationDependencies {
  getReceipt(
    uid: string,
    requestId: string,
  ): Promise<RegistrationRequestReceipt | null>;
  /**
   * Atomically claims both requestId and draftId below one UID-scoped
   * transaction boundary. A same-request/hash retry must return the original
   * reservation unchanged so a crash before the root patch can replay it.
   */
  reserveRegistration(
    proposed: RegistrationReservation,
  ): Promise<RegistrationReservationOutcome>;
  updateRoot(patch: Record<string, unknown>): Promise<void>;
  getUserDisplayName(uid: string): Promise<string | null>;
  now(): string;
}

type UnknownRecord = Record<string, unknown>;

interface NormalizedRegistrationInput {
  requestId: string;
  draftId: string;
  building: BuildingDraftPayload;
  units: UnitDraftPayload[];
  listing: ListingDraftPayload;
  primaryUnitLocalId: string;
  managementContract:
    | { requested: false }
    | { requested: true; startedOn: string };
  ownerNoteDrafts: OwnerNoteDraftInput[];
}

function invalidRegistration(): never {
  throw new Error("field_invalid_registration");
}

const OWNER_NOTE_REGISTRATION_VALIDATION_ERRORS = new Set([
  "owner_note_drafts_invalid",
  "owner_note_draft_invalid",
  "owner_note_id_invalid",
  "owner_note_id_duplicate",
  "owner_note_body_required",
  "owner_note_body_too_long",
  "owner_note_recorded_at_invalid",
]);

function normalizeRegistrationOwnerNoteDrafts(
  value: unknown,
): OwnerNoteDraftInput[] {
  try {
    return normalizeOwnerNoteDrafts(value);
  } catch (error) {
    if (
      error instanceof Error
      && OWNER_NOTE_REGISTRATION_VALIDATION_ERRORS.has(error.message)
    ) {
      invalidRegistration();
    }
    throw error;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathSafeId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > FIELD_REGISTRATION_LIMITS.idBytes ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }

  return ![".", "#", "$", "[", "]", "/"].some((character) =>
    value.includes(character),
  );
}

function normalizeId(value: unknown): string {
  if (!isPathSafeId(value)) invalidRegistration();
  return value;
}

function normalizeRequiredString(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") >
      FIELD_REGISTRATION_LIMITS.domainStringBytes ||
    value.trim().length === 0
  ) {
    invalidRegistration();
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") >
      FIELD_REGISTRATION_LIMITS.domainStringBytes
  ) {
    invalidRegistration();
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > FIELD_REGISTRATION_LIMITS.stringArrayItems
  ) {
    invalidRegistration();
  }
  return value.map((item) => normalizeRequiredString(item));
}

function normalizeStringSet(value: unknown): string[] {
  const normalized = normalizeStringArray(value);
  return [...new Set(normalized)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalidRegistration();
  return value;
}

function normalizeSafeInteger(
  value: unknown,
  minimum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    invalidRegistration();
  }
  return value;
}

function normalizeOptionalSafeInteger(
  value: unknown,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  return normalizeSafeInteger(value, minimum);
}

function normalizeCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidRegistration();
  }
  return value;
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function normalizeOptionalDate(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) return undefined;
  if (!isValidIsoDate(normalized)) invalidRegistration();
  return normalized;
}

function normalizeBuilding(value: unknown): BuildingDraftPayload {
  if (!isRecord(value) || !isRecord(value.parking)) invalidRegistration();

  const building: BuildingDraftPayload = {
    managementNumber: normalizeRequiredString(value.managementNumber),
    name: normalizeRequiredString(value.name),
    roadAddress: normalizeRequiredString(value.roadAddress),
    latitude: normalizeCoordinate(value.latitude, -90, 90),
    longitude: normalizeCoordinate(value.longitude, -180, 180),
    elevator: normalizeBoolean(value.elevator),
    parking: {
      available: normalizeBoolean(value.parking.available),
    },
  };

  const jibunAddress = normalizeOptionalString(value.jibunAddress);
  const purpose = normalizeOptionalString(value.purpose);
  const completionYear = normalizeOptionalSafeInteger(value.completionYear, 0);
  const floorCount = normalizeOptionalSafeInteger(value.floorCount, 0);
  const totalSpaces = normalizeOptionalSafeInteger(value.parking.totalSpaces, 0);
  if (jibunAddress !== undefined) building.jibunAddress = jibunAddress;
  if (purpose !== undefined) building.purpose = purpose;
  if (completionYear !== undefined) building.completionYear = completionYear;
  if (floorCount !== undefined) building.floorCount = floorCount;
  if (totalSpaces !== undefined) building.parking.totalSpaces = totalSpaces;

  return building;
}

function normalizeUnit(value: unknown): UnitDraftPayload {
  if (!isRecord(value)) invalidRegistration();

  const unit: UnitDraftPayload = {
    localId: normalizeId(value.localId),
    unitLabel: normalizeRequiredString(value.unitLabel),
    options: normalizeStringSet(value.options),
    isVacant: normalizeBoolean(value.isVacant),
  };
  const structure = normalizeOptionalString(value.structure);
  const floor = normalizeOptionalSafeInteger(value.floor, Number.MIN_SAFE_INTEGER);
  if (structure !== undefined) unit.structure = structure;
  if (floor !== undefined) unit.floor = floor;
  return unit;
}

function normalizeListing(value: unknown): ListingDraftPayload {
  if (!isRecord(value)) invalidRegistration();

  const listing: ListingDraftPayload = {
    depositWon: normalizeSafeInteger(value.depositWon, 0),
    monthlyRentWon: normalizeSafeInteger(value.monthlyRentWon, 0),
    maintenanceFeeWon: normalizeSafeInteger(value.maintenanceFeeWon, 0),
    maintenanceFeeItems: normalizeStringArray(value.maintenanceFeeItems),
    parkingDescription: normalizeRequiredString(value.parkingDescription),
    petPolicy: normalizeRequiredString(value.petPolicy),
    options: normalizeStringSet(value.options),
  };

  const availableFrom = normalizeOptionalDate(value.availableFrom);
  const contractTermMonths = normalizeOptionalSafeInteger(
    value.contractTermMonths,
    1,
  );
  const vacancyReason = normalizeOptionalString(value.vacancyReason);
  const vacantSince = normalizeOptionalDate(value.vacantSince);
  const moveInCondition = normalizeOptionalString(value.moveInCondition);
  const locationDescription = normalizeOptionalString(value.locationDescription);
  if (availableFrom !== undefined) listing.availableFrom = availableFrom;
  if (contractTermMonths !== undefined) {
    listing.contractTermMonths = contractTermMonths;
  }
  if (vacancyReason !== undefined) listing.vacancyReason = vacancyReason;
  if (vacantSince !== undefined) listing.vacantSince = vacantSince;
  if (moveInCondition !== undefined) listing.moveInCondition = moveInCondition;
  if (locationDescription !== undefined) {
    listing.locationDescription = locationDescription;
  }

  return listing;
}

function normalizeManagementContract(
  value: unknown,
): NormalizedRegistrationInput["managementContract"] {
  if (!isRecord(value) || typeof value.requested !== "boolean") {
    invalidRegistration();
  }
  if (!value.requested) return { requested: false };

  const startedOn = normalizeRequiredString(value.startedOn);
  if (!isValidIsoDate(startedOn)) invalidRegistration();
  return { requested: true, startedOn };
}

function normalizeRegistrationInput(
  input: SaveFieldRegistrationInput,
): NormalizedRegistrationInput {
  const value: unknown = input;
  if (!isRecord(value)) invalidRegistration();
  if (
    value.ownerNoteDrafts !== undefined &&
    !Array.isArray(value.ownerNoteDrafts)
  ) {
    invalidRegistration();
  }
  if (
    !Array.isArray(value.units) ||
    value.units.length === 0 ||
    value.units.length > FIELD_REGISTRATION_LIMITS.units
  ) {
    invalidRegistration();
  }

  const units = value.units.map((unit) => normalizeUnit(unit));
  const localIds = new Set(units.map((unit) => unit.localId));
  if (localIds.size !== units.length) invalidRegistration();
  units.sort((left, right) =>
    left.localId < right.localId ? -1 : left.localId > right.localId ? 1 : 0,
  );

  const primaryUnitLocalId = normalizeId(value.primaryUnitLocalId);
  if (!localIds.has(primaryUnitLocalId)) invalidRegistration();

  return {
    requestId: normalizeId(value.requestId),
    draftId: normalizeId(value.draftId),
    building: normalizeBuilding(value.building),
    units,
    listing: normalizeListing(value.listing),
    primaryUnitLocalId,
    managementContract: normalizeManagementContract(value.managementContract),
    ownerNoteDrafts: normalizeRegistrationOwnerNoteDrafts(value.ownerNoteDrafts),
  };
}

function assertAuthorizedActor(actor: FieldActor): void {
  const value: unknown = actor;
  if (
    !isRecord(value) ||
    value.enabled !== true ||
    (value.role !== "admin" && value.role !== "staff")
  ) {
    throw new Error("field_registration_forbidden");
  }
  if (!isPathSafeId(value.uid)) invalidRegistration();
}

function serializeNormalizedInput(input: NormalizedRegistrationInput): string {
  const serialized = JSON.stringify(input);
  if (
    Buffer.byteLength(serialized, "utf8") >
    FIELD_REGISTRATION_LIMITS.normalizedPayloadBytes
  ) {
    invalidRegistration();
  }
  return serialized;
}

function requestHash(serializedInput: string): string {
  return createHash("sha256").update(serializedInput).digest("hex");
}

function entityId(
  prefix: string,
  uid: string,
  draftId: string,
  localId: string,
): string {
  const digest = createHash("sha256")
    .update(`${uid}\0${draftId}\0${localId}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

export async function saveFieldRegistrationCore(
  input: SaveFieldRegistrationInput,
  actor: FieldActor,
  dependencies: SaveFieldRegistrationDependencies,
): Promise<SaveFieldRegistrationResult> {
  assertAuthorizedActor(actor);

  const normalized = normalizeRegistrationInput(input);
  const normalizedHash = requestHash(serializeNormalizedInput(normalized));
  const storedReceipt = await dependencies.getReceipt(
    actor.uid,
    normalized.requestId,
  );
  if (storedReceipt) {
    if (storedReceipt.requestHash !== normalizedHash) {
      throw new Error("field_request_id_conflict");
    }
    return storedReceipt.result;
  }

  const ownerNoteActor: OwnerNoteActor = {
    uid: actor.uid,
    role: actor.role,
    tokenDisplayName: actor.tokenDisplayName,
    sessionId: actor.sessionId,
  };
  const proposedOwnerNoteCreatedByName =
    normalized.ownerNoteDrafts.length === 0
      ? undefined
      : await resolveOwnerNoteActorName(
        ownerNoteActor,
        dependencies.getUserDisplayName,
      );

  const proposedBuildingId = entityId(
    "building",
    actor.uid,
    normalized.draftId,
    normalized.draftId,
  );
  const proposedUnitIds = Object.fromEntries(
    normalized.units.map((unit) => [
      unit.localId,
      entityId("unit", actor.uid, normalized.draftId, unit.localId),
    ]),
  );
  const proposedListingId = entityId(
    "listing",
    actor.uid,
    normalized.draftId,
    normalized.primaryUnitLocalId,
  );
  const proposedVisitId = entityId(
    "visit",
    actor.uid,
    normalized.draftId,
    normalized.primaryUnitLocalId,
  );
  const proposedResult: SaveFieldRegistrationResult = {
    buildingId: proposedBuildingId,
    unitIds: proposedUnitIds,
    listingId: proposedListingId,
    visitId: proposedVisitId,
  };

  const reservationOutcome = await dependencies.reserveRegistration({
    uid: actor.uid,
    requestId: normalized.requestId,
    draftId: normalized.draftId,
    requestHash: normalizedHash,
    result: proposedResult,
    claimedAt: dependencies.now(),
    ...(proposedOwnerNoteCreatedByName === undefined
      ? {}
      : { ownerNoteCreatedByName: proposedOwnerNoteCreatedByName }),
  });
  if (reservationOutcome.status === "requestConflict") {
    throw new Error("field_request_id_conflict");
  }
  if (reservationOutcome.status === "draftConflict") {
    throw new Error("field_draft_id_conflict");
  }

  const {
    claimedAt: now,
    result,
    ownerNoteCreatedByName,
  } = reservationOutcome.reservation;
  const { buildingId, unitIds, listingId, visitId } = result;
  const auditStamp = {
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  };
  const contractStatus: ManagementContractInfo["status"] = normalized
    .managementContract.requested
    ? actor.role === "admin"
      ? "active"
      : "pending"
    : "none";
  const managementContract: ManagementContractInfo = {
    status: contractStatus,
    ...(normalized.managementContract.requested
      ? { startedOn: normalized.managementContract.startedOn }
      : {}),
    updatedAt: now,
    updatedBy: actor.uid,
  };
  const building = {
    id: buildingId,
    ...normalized.building,
    unitCount: normalized.units.length,
    assignedStaffIds: [actor.uid],
    managementContract,
    ...auditStamp,
  };
  const primaryUnit = normalized.units.find(
    (unit) => unit.localId === normalized.primaryUnitLocalId,
  );
  if (!primaryUnit) invalidRegistration();
  const primaryUnitId = unitIds[normalized.primaryUnitLocalId];

  const units = normalized.units.map((unit) => ({
    id: unitIds[unit.localId],
    buildingId,
    unitLabel: unit.unitLabel,
    ...(unit.structure === undefined ? {} : { structure: unit.structure }),
    ...(unit.floor === undefined ? {} : { floor: unit.floor }),
    options: [...unit.options],
    isVacant: unit.isVacant,
    ...(unit.localId === normalized.primaryUnitLocalId
      ? { currentListingId: listingId }
      : {}),
    ...auditStamp,
  }));
  const listing = {
    id: listingId,
    buildingId,
    unitId: primaryUnitId,
    unitLabel: primaryUnit.unitLabel,
    status: "draft",
    depositWon: normalized.listing.depositWon,
    monthlyRentWon: normalized.listing.monthlyRentWon,
    maintenanceFeeWon: normalized.listing.maintenanceFeeWon,
    maintenanceFeeItems: [...normalized.listing.maintenanceFeeItems],
    ...(normalized.listing.availableFrom === undefined
      ? {}
      : { availableFrom: normalized.listing.availableFrom }),
    ...(normalized.listing.contractTermMonths === undefined
      ? {}
      : { contractTermMonths: normalized.listing.contractTermMonths }),
    ...(normalized.listing.moveInCondition === undefined
      ? {}
      : { moveInCondition: normalized.listing.moveInCondition }),
    ...(normalized.listing.locationDescription === undefined
      ? {}
      : { locationDescription: normalized.listing.locationDescription }),
    parkingDescription: normalized.listing.parkingDescription,
    petPolicy: normalized.listing.petPolicy,
    ...(normalized.listing.vacancyReason === undefined
      ? {}
      : { vacancyReason: normalized.listing.vacancyReason }),
    ...(normalized.listing.vacantSince === undefined
      ? {}
      : { vacantSince: normalized.listing.vacantSince }),
    options: [...normalized.listing.options],
    advertisingApproved: false,
    ...auditStamp,
  };
  const visit = {
    id: visitId,
    buildingId,
    unitId: primaryUnitId,
    listingId,
    type: "initial",
    assignedUserId: actor.uid,
    checklistTemplateId: "initial",
    checklistTemplateVersion: 1,
    ...auditStamp,
  };

  const registrationAuditId = entityId(
    "audit",
    actor.uid,
    normalized.draftId,
    `registration:${normalized.requestId}`,
  );
  const contractAuditId = entityId(
    "audit",
    actor.uid,
    normalized.draftId,
    `contract:${normalized.requestId}`,
  );
  const registrationAudit = {
    id: registrationAuditId,
    actorId: actor.uid,
    action: "building.registered",
    entityType: "building",
    entityId: buildingId,
    occurredAt: now,
    requestId: normalized.requestId,
  };
  const contractAudit = {
    id: contractAuditId,
    actorId: actor.uid,
    action: `managementContract.${contractStatus}`,
    entityType: "managementContract",
    entityId: buildingId,
    occurredAt: now,
    changes: {
      status: { after: contractStatus },
      ...(normalized.managementContract.requested
        ? { startedOn: { after: normalized.managementContract.startedOn } }
        : {}),
    },
    requestId: normalized.requestId,
  };
  const projection = buildMapProjection({
    building,
    listings: [listing],
    media: [],
    updatedAt: now,
  });
  const receipt: RegistrationRequestReceipt = {
    requestHash: normalizedHash,
    result,
    completedAt: now,
  };

  const patch: Record<string, unknown> = {
    [`fieldPlatform/buildings/${buildingId}`]: building,
    [`fieldPlatform/listings/${listingId}`]: listing,
    [`fieldPlatform/visits/${visitId}`]: visit,
    [`fieldPlatform/buildingAssignments/${buildingId}/${actor.uid}`]: true,
    [`fieldPlatform/auditLogs/${registrationAuditId}`]: registrationAudit,
    [`fieldPlatform/auditLogs/${contractAuditId}`]: contractAudit,
    [`fieldPlatform/mapProjections/${buildingId}`]: projection,
    [`fieldPlatform/registrationRequests/${actor.uid}/${normalized.requestId}`]:
      receipt,
  };
  for (const unit of units) {
    patch[`fieldPlatform/units/${unit.id}`] = unit;
  }

  if (normalized.ownerNoteDrafts.length > 0) {
    if (!ownerNoteCreatedByName) {
      throw new Error("field_registration_claim_state_invalid");
    }
    Object.assign(
      patch,
      await buildInitialOwnerNotePatch({
        buildingId,
        drafts: normalized.ownerNoteDrafts,
        actor: ownerNoteActor,
        createdAt: now,
        createdByName: ownerNoteCreatedByName,
      }),
    );
  }

  await dependencies.updateRoot(patch);
  return result;
}

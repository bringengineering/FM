import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  FieldActor,
  ManagementContractStatus,
} from "./contracts.js";
import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionListing,
  type ProjectionMedia,
} from "./map-projection.js";

type UnknownRecord = Record<string, unknown>;

const ID_BYTES = 128;
const STORED_STRING_BYTES = 4_096;

export interface SetManagementContractStatusInput {
  requestId: string;
  buildingId: string;
  status: "active" | "paused" | "ended";
  startedOn?: string;
  endedOn?: string;
}

export interface SetManagementContractStatusResult {
  buildingId: string;
  status: "active" | "paused" | "ended";
}

type TargetManagementContractStatus =
  SetManagementContractStatusInput["status"];

export interface ContractRequestReceipt {
  requestHash: string;
  result: SetManagementContractStatusResult;
  completedAt: string;
}

export interface ContractTransitionReservation {
  uid: string;
  requestId: string;
  buildingId: string;
  requestHash: string;
  previousContractStatus: ManagementContractStatus;
  previousContractUpdatedAt: string;
  previousContractFingerprint: string;
  result: SetManagementContractStatusResult;
  claimedAt: string;
}

export type ContractTransitionReservationOutcome =
  | { status: "acquired"; reservation: ContractTransitionReservation }
  | { status: "requestConflict" }
  | { status: "buildingConflict" };

export interface SetManagementContractStatusDependencies {
  getBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  getListings(buildingId: string): Promise<ProjectionListing[]>;
  getMedia(buildingId: string): Promise<ProjectionMedia[]>;
  getReceipt(
    uid: string,
    requestId: string,
  ): Promise<ContractRequestReceipt | null>;
  /**
   * Atomically claims both the actor-scoped request ID and the building's
   * current contract fingerprint/version at one shared claims ancestor.
   * A same UID/request/hash retry must return the original stored reservation
   * unchanged. Reusing a request for different semantics returns
   * requestConflict; competing claims on the same building version return
   * buildingConflict. No entity root patch may run before acquisition.
   */
  reserveTransition(
    proposed: ContractTransitionReservation,
  ): Promise<ContractTransitionReservationOutcome>;
  updateRoot(patch: Record<string, unknown>): Promise<void>;
  now(): string;
}

interface NormalizedTransitionInput {
  requestId: string;
  buildingId: string;
  status: TargetManagementContractStatus;
  startedOn: string | null;
  endedOn: string | null;
}

interface ValidatedContract {
  status: ManagementContractStatus;
  startedOn?: string;
  endedOn?: string;
  updatedAt: string;
  updatedBy: string;
}

interface ValidatedBuilding {
  value: ProjectionBuilding & UnknownRecord;
  contract: ValidatedContract;
}

function invalidTransition(): never {
  throw new Error("field_management_transition_invalid");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathSafeId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > ID_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }

  return ![".", "#", "$", "[", "]", "/"].some((character) =>
    value.includes(character),
  );
}

function normalizeId(value: unknown): string {
  if (!isPathSafeId(value)) invalidTransition();
  return value;
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= STORED_STRING_BYTES
  );
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

function normalizeOptionalDate(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !isValidIsoDate(value)) {
    invalidTransition();
  }
  return value;
}

function normalizeInput(
  input: SetManagementContractStatusInput,
): NormalizedTransitionInput {
  const value: unknown = input;
  if (!isRecord(value)) invalidTransition();

  const status = value.status;
  if (status !== "active" && status !== "paused" && status !== "ended") {
    invalidTransition();
  }

  const startedOn = normalizeOptionalDate(value.startedOn);
  const endedOn = normalizeOptionalDate(value.endedOn);

  return {
    requestId: normalizeId(value.requestId),
    buildingId: normalizeId(value.buildingId),
    status,
    // Only dates that can affect the requested target participate in the
    // semantic hash. Valid but irrelevant date fields are deliberately ignored.
    startedOn: status === "active" ? startedOn : null,
    endedOn: status === "ended" ? endedOn : null,
  };
}

function assertAuthorizedActor(actor: FieldActor): void {
  const value: unknown = actor;
  if (
    !isRecord(value) ||
    value.enabled !== true ||
    value.role !== "admin"
  ) {
    throw new Error("field_management_admin_required");
  }
  normalizeId(value.uid);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashInput(input: NormalizedTransitionInput): string {
  return sha256(JSON.stringify(input));
}

function normalizeStoredContract(value: unknown): ValidatedContract {
  if (!isRecord(value)) invalidTransition();

  const { status, startedOn, endedOn, updatedAt, updatedBy } = value;
  if (
    status !== "none" &&
    status !== "pending" &&
    status !== "active" &&
    status !== "paused" &&
    status !== "ended"
  ) {
    invalidTransition();
  }
  if (!isBoundedNonEmptyString(updatedAt) || !isPathSafeId(updatedBy)) {
    invalidTransition();
  }
  if (
    (startedOn !== undefined &&
      (typeof startedOn !== "string" || !isValidIsoDate(startedOn))) ||
    (endedOn !== undefined &&
      (typeof endedOn !== "string" || !isValidIsoDate(endedOn)))
  ) {
    invalidTransition();
  }

  if (
    (status === "none" && (startedOn !== undefined || endedOn !== undefined)) ||
    (status === "pending" &&
      (typeof startedOn !== "string" || endedOn !== undefined)) ||
    ((status === "active" || status === "paused") &&
      (typeof startedOn !== "string" || endedOn !== undefined)) ||
    (status === "ended" &&
      (typeof startedOn !== "string" || typeof endedOn !== "string"))
  ) {
    invalidTransition();
  }

  return {
    status,
    ...(startedOn === undefined ? {} : { startedOn }),
    ...(endedOn === undefined ? {} : { endedOn }),
    updatedAt,
    updatedBy,
  };
}

function validateBuilding(
  value: ProjectionBuilding | null,
  buildingId: string,
): ValidatedBuilding {
  const raw: unknown = value;
  if (!isRecord(raw)) invalidTransition();
  if (
    raw.id !== buildingId ||
    !isPathSafeId(raw.id) ||
    !isBoundedNonEmptyString(raw.name) ||
    !isBoundedNonEmptyString(raw.roadAddress) ||
    typeof raw.latitude !== "number" ||
    !Number.isFinite(raw.latitude) ||
    raw.latitude < -90 ||
    raw.latitude > 90 ||
    typeof raw.longitude !== "number" ||
    !Number.isFinite(raw.longitude) ||
    raw.longitude < -180 ||
    raw.longitude > 180 ||
    (raw.archivedAt !== undefined && raw.archivedAt !== null)
  ) {
    invalidTransition();
  }

  return {
    value: raw as ProjectionBuilding & UnknownRecord,
    contract: normalizeStoredContract(raw.managementContract),
  };
}

function assertAllowedTransition(
  current: ManagementContractStatus,
  target: TargetManagementContractStatus,
): void {
  const allowed =
    (current === "none" && target === "active") ||
    (current === "pending" && (target === "active" || target === "ended")) ||
    (current === "active" && (target === "paused" || target === "ended")) ||
    (current === "paused" && (target === "active" || target === "ended"));
  if (!allowed) invalidTransition();
}

function nextContract(
  current: ValidatedContract,
  input: NormalizedTransitionInput,
  updatedAt: string,
  updatedBy: string,
): ValidatedContract {
  if (input.status === "active") {
    const startedOn = input.startedOn ??
      (current.status === "paused" ? current.startedOn : undefined);
    if (startedOn === undefined) invalidTransition();
    return { status: "active", startedOn, updatedAt, updatedBy };
  }

  if (input.status === "paused") {
    if (current.startedOn === undefined) invalidTransition();
    return {
      status: "paused",
      startedOn: current.startedOn,
      updatedAt,
      updatedBy,
    };
  }

  if (input.endedOn === null || current.startedOn === undefined) {
    invalidTransition();
  }
  return {
    status: "ended",
    startedOn: current.startedOn,
    endedOn: input.endedOn,
    updatedAt,
    updatedBy,
  };
}

function contractFingerprint(contract: ValidatedContract): string {
  return sha256(
    JSON.stringify({
      status: contract.status,
      startedOn: contract.startedOn ?? null,
      endedOn: contract.endedOn ?? null,
      updatedAt: contract.updatedAt,
      updatedBy: contract.updatedBy,
    }),
  );
}

function auditId(uid: string, buildingId: string, requestId: string): string {
  return `audit_${sha256(`${uid}\0${buildingId}\0${requestId}`).slice(0, 24)}`;
}

function buildChanges(
  before: ValidatedContract,
  after: ValidatedContract,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {
    status: { before: before.status, after: after.status },
  };
  if (before.startedOn !== after.startedOn) {
    changes.startedOn = {
      ...(before.startedOn === undefined ? {} : { before: before.startedOn }),
      ...(after.startedOn === undefined ? {} : { after: after.startedOn }),
    };
  }
  if (before.endedOn !== after.endedOn) {
    changes.endedOn = {
      ...(before.endedOn === undefined ? {} : { before: before.endedOn }),
      ...(after.endedOn === undefined ? {} : { after: after.endedOn }),
    };
  }
  return changes;
}

function validateAcquiredReservation(
  reservation: ContractTransitionReservation,
  proposed: ContractTransitionReservation,
): void {
  if (
    !isRecord(reservation) ||
    reservation.uid !== proposed.uid ||
    reservation.requestId !== proposed.requestId ||
    reservation.buildingId !== proposed.buildingId ||
    reservation.requestHash !== proposed.requestHash ||
    reservation.previousContractStatus !== proposed.previousContractStatus ||
    reservation.previousContractUpdatedAt !== proposed.previousContractUpdatedAt ||
    reservation.previousContractFingerprint !==
      proposed.previousContractFingerprint ||
    !isBoundedNonEmptyString(reservation.claimedAt) ||
    !isRecord(reservation.result) ||
    reservation.result.buildingId !== proposed.result.buildingId ||
    reservation.result.status !== proposed.result.status
  ) {
    invalidTransition();
  }
}

export async function setManagementContractStatusCore(
  input: SetManagementContractStatusInput,
  actor: FieldActor,
  dependencies: SetManagementContractStatusDependencies,
): Promise<SetManagementContractStatusResult> {
  assertAuthorizedActor(actor);
  const normalized = normalizeInput(input);
  const requestHash = hashInput(normalized);

  const storedReceipt = await dependencies.getReceipt(
    actor.uid,
    normalized.requestId,
  );
  if (storedReceipt) {
    if (storedReceipt.requestHash !== requestHash) {
      throw new Error("field_request_id_conflict");
    }
    return storedReceipt.result;
  }

  const validated = validateBuilding(
    await dependencies.getBuilding(normalized.buildingId),
    normalized.buildingId,
  );
  assertAllowedTransition(validated.contract.status, normalized.status);

  // Validate all transition-specific dates before claiming either key.
  nextContract(
    validated.contract,
    normalized,
    validated.contract.updatedAt,
    actor.uid,
  );

  const result: SetManagementContractStatusResult = {
    buildingId: normalized.buildingId,
    status: normalized.status,
  };
  const proposed: ContractTransitionReservation = {
    uid: actor.uid,
    requestId: normalized.requestId,
    buildingId: normalized.buildingId,
    requestHash,
    previousContractStatus: validated.contract.status,
    previousContractUpdatedAt: validated.contract.updatedAt,
    previousContractFingerprint: contractFingerprint(validated.contract),
    result,
    claimedAt: dependencies.now(),
  };
  if (!isBoundedNonEmptyString(proposed.claimedAt)) invalidTransition();

  const outcome = await dependencies.reserveTransition(proposed);
  if (outcome.status === "requestConflict") {
    throw new Error("field_request_id_conflict");
  }
  if (outcome.status === "buildingConflict") {
    throw new Error("field_management_transition_conflict");
  }
  validateAcquiredReservation(outcome.reservation, proposed);

  const reservation = outcome.reservation;
  const managementContract = nextContract(
    validated.contract,
    normalized,
    reservation.claimedAt,
    actor.uid,
  );
  const updatedBuilding = {
    ...validated.value,
    managementContract,
    updatedAt: reservation.claimedAt,
    updatedBy: actor.uid,
  };
  const id = auditId(actor.uid, normalized.buildingId, normalized.requestId);
  const audit = {
    id,
    actorId: actor.uid,
    action: `managementContract.${reservation.result.status}`,
    entityType: "managementContract",
    entityId: reservation.result.buildingId,
    occurredAt: reservation.claimedAt,
    changes: buildChanges(validated.contract, managementContract),
    requestId: normalized.requestId,
  };

  let projection = null;
  if (reservation.result.status === "active") {
    const [listings, media] = await Promise.all([
      dependencies.getListings(normalized.buildingId),
      dependencies.getMedia(normalized.buildingId),
    ]);
    projection = buildMapProjection({
      building: updatedBuilding,
      listings,
      media,
      updatedAt: reservation.claimedAt,
    });
    if (projection === null) invalidTransition();
  }

  const receipt: ContractRequestReceipt = {
    requestHash,
    result: reservation.result,
    completedAt: reservation.claimedAt,
  };
  await dependencies.updateRoot({
    [`fieldPlatform/buildings/${reservation.result.buildingId}`]: updatedBuilding,
    [`fieldPlatform/auditLogs/${id}`]: audit,
    [`fieldPlatform/mapProjections/${reservation.result.buildingId}`]: projection,
    [`fieldPlatform/managementContractRequests/${actor.uid}/${normalized.requestId}`]:
      receipt,
  });

  return reservation.result;
}

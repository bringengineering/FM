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
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

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

export interface ContractTransitionSnapshot {
  status: ManagementContractStatus;
  startedOn?: string;
  endedOn?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ContractTransitionReservation {
  uid: string;
  requestId: string;
  buildingId: string;
  requestHash: string;
  previousContractStatus: ManagementContractStatus;
  previousContractUpdatedAt: string;
  previousContractFingerprint: string;
  previousContract: ContractTransitionSnapshot;
  nextContractFingerprint: string;
  nextContract: ContractTransitionSnapshot;
  result: SetManagementContractStatusResult;
  claimedAt: string;
}

export type ContractTransitionReservationOutcome =
  | { status: "acquired"; reservation: ContractTransitionReservation }
  | { status: "requestConflict" }
  | { status: "buildingConflict" };

export interface ContractTransitionCommitInput {
  uid: string;
  requestId: string;
  requestHash: string;
  buildingId: string;
  expectedPreviousContractFingerprint: string;
  expectedNextContractFingerprint: string;
  nextContract: ContractTransitionSnapshot;
  result: SetManagementContractStatusResult;
  patch: Record<string, unknown>;
}

export type ContractTransitionCommitOutcome =
  | { status: "committed" }
  | { status: "alreadyCommitted" }
  | { status: "staleConflict" };

export interface SetManagementContractStatusDependencies {
  getBuilding(buildingId: string): Promise<ProjectionBuilding | null>;
  getListings(buildingId: string): Promise<ProjectionListing[]>;
  getMedia(buildingId: string): Promise<ProjectionMedia[]>;
  getReceipt(
    uid: string,
    requestId: string,
  ): Promise<ContractRequestReceipt | null>;
  /**
   * Reads an already claimed actor/request reservation. This lookup is the
   * recovery source of truth after a missing or stale completed receipt and
   * must return the originally stored reservation without regenerating it.
   */
  getReservation(
    uid: string,
    requestId: string,
  ): Promise<ContractTransitionReservation | null>;
  /**
   * Atomically claims both the actor-scoped request ID and the building's
   * current contract fingerprint/version at one shared claims ancestor.
   * A same UID/request/hash retry returns the original reservation unchanged.
   * A competing request for the same building/fingerprint returns
   * buildingConflict, while a later claim for a newer fingerprint may acquire.
   * No entity root patch may run before acquisition.
   */
  reserveTransition(
    proposed: ContractTransitionReservation,
  ): Promise<ContractTransitionReservationOutcome>;
  /**
   * Performs the authoritative receipt-first compare-and-set at one common
   * Firebase ancestor. The Task 5 adapter must implement this with a Firebase
   * transaction/CAS, never `ref().update()`: inside the same transaction it
   * returns alreadyCommitted for a matching receipt, otherwise compares the
   * current building contract fingerprint and, only on an exact previous
   * fingerprint match, applies the granular patch and receipt all-or-nothing.
   */
  commitTransitionAtomically(
    input: ContractTransitionCommitInput,
  ): Promise<ContractTransitionCommitOutcome>;
  /**
   * Retained for base-adapter compatibility. Transition commits never call
   * this unconditional update method.
   */
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

interface ValidatedBuilding {
  value: ProjectionBuilding & UnknownRecord;
  contract: ContractTransitionSnapshot;
}

interface ExpectedRequest {
  uid: string;
  input: NormalizedTransitionInput;
  requestHash: string;
  result: SetManagementContractStatusResult;
}

interface ValidatedReservation {
  value: ContractTransitionReservation;
  previousContract: ContractTransitionSnapshot;
  nextContract: ContractTransitionSnapshot;
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

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (!isBoundedNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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
    startedOn: status === "active" ? startedOn : null,
    endedOn: status === "ended" ? endedOn : null,
  };
}

function assertAuthorizedActor(actor: FieldActor): void {
  const value: unknown = actor;
  if (!isRecord(value) || value.enabled !== true || value.role !== "admin") {
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

function normalizeStoredContract(value: unknown): ContractTransitionSnapshot {
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
  if (!isCanonicalUtcTimestamp(updatedAt) || !isPathSafeId(updatedBy)) {
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
      (typeof startedOn !== "string" ||
        typeof endedOn !== "string" ||
        endedOn < startedOn))
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
  current: ContractTransitionSnapshot,
  input: NormalizedTransitionInput,
  updatedAt: string,
  updatedBy: string,
): ContractTransitionSnapshot {
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

  if (
    input.endedOn === null ||
    current.startedOn === undefined ||
    input.endedOn < current.startedOn
  ) {
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

export function managementContractFingerprint(
  contract: ContractTransitionSnapshot,
): string {
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
  before: ContractTransitionSnapshot,
  after: ContractTransitionSnapshot,
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

function validateReceipt(
  value: unknown,
  expected: ExpectedRequest,
): SetManagementContractStatusResult | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.requestHash !== "string" ||
    !SHA_256_PATTERN.test(value.requestHash)
  ) {
    invalidTransition();
  }
  if (value.requestHash !== expected.requestHash) {
    throw new Error("field_request_id_conflict");
  }
  if (
    !isRecord(value.result) ||
    value.result.buildingId !== expected.result.buildingId ||
    value.result.status !== expected.result.status ||
    !isCanonicalUtcTimestamp(value.completedAt)
  ) {
    invalidTransition();
  }
  return { ...expected.result };
}

function validateReservation(
  value: unknown,
  expected: ExpectedRequest,
): ValidatedReservation {
  if (
    !isRecord(value) ||
    typeof value.requestHash !== "string" ||
    !SHA_256_PATTERN.test(value.requestHash)
  ) {
    invalidTransition();
  }
  if (value.requestHash !== expected.requestHash) {
    throw new Error("field_request_id_conflict");
  }
  if (
    value.uid !== expected.uid ||
    value.requestId !== expected.input.requestId ||
    value.buildingId !== expected.input.buildingId ||
    !isCanonicalUtcTimestamp(value.claimedAt) ||
    !isRecord(value.result) ||
    value.result.buildingId !== expected.result.buildingId ||
    value.result.status !== expected.result.status
  ) {
    invalidTransition();
  }

  const previousContract = normalizeStoredContract(value.previousContract);
  const next = normalizeStoredContract(value.nextContract);
  assertAllowedTransition(previousContract.status, expected.input.status);
  const expectedNext = nextContract(
    previousContract,
    expected.input,
    value.claimedAt,
    expected.uid,
  );
  const previousFingerprint = managementContractFingerprint(previousContract);
  const nextFingerprint = managementContractFingerprint(next);
  if (
    value.previousContractStatus !== previousContract.status ||
    value.previousContractUpdatedAt !== previousContract.updatedAt ||
    value.previousContractFingerprint !== previousFingerprint ||
    value.nextContractFingerprint !== nextFingerprint ||
    nextFingerprint !== managementContractFingerprint(expectedNext) ||
    next.status !== expected.result.status ||
    next.updatedAt !== value.claimedAt ||
    next.updatedBy !== expected.uid
  ) {
    invalidTransition();
  }

  const reservation: ContractTransitionReservation = {
    uid: expected.uid,
    requestId: expected.input.requestId,
    buildingId: expected.input.buildingId,
    requestHash: expected.requestHash,
    previousContractStatus: previousContract.status,
    previousContractUpdatedAt: previousContract.updatedAt,
    previousContractFingerprint: previousFingerprint,
    previousContract,
    nextContractFingerprint: nextFingerprint,
    nextContract: next,
    result: { ...expected.result },
    claimedAt: value.claimedAt,
  };
  return {
    value: reservation,
    previousContract,
    nextContract: next,
  };
}

async function persistReservation(
  reservation: ValidatedReservation,
  building: ValidatedBuilding,
  expected: ExpectedRequest,
  dependencies: SetManagementContractStatusDependencies,
): Promise<SetManagementContractStatusResult> {
  const { claimedAt, result } = reservation.value;
  const projectionBuilding = {
    ...building.value,
    managementContract: reservation.nextContract,
    updatedAt: claimedAt,
    updatedBy: expected.uid,
  };
  let projection = null;
  if (result.status === "active") {
    const [listings, media] = await Promise.all([
      dependencies.getListings(result.buildingId),
      dependencies.getMedia(result.buildingId),
    ]);
    projection = buildMapProjection({
      building: projectionBuilding,
      listings,
      media,
      updatedAt: claimedAt,
    });
    if (projection === null) invalidTransition();
  }

  const id = auditId(expected.uid, result.buildingId, expected.input.requestId);
  const audit = {
    id,
    actorId: expected.uid,
    action: `managementContract.${result.status}`,
    entityType: "managementContract",
    entityId: result.buildingId,
    occurredAt: claimedAt,
    changes: buildChanges(
      reservation.previousContract,
      reservation.nextContract,
    ),
    requestId: expected.input.requestId,
  };
  const receipt: ContractRequestReceipt = {
    requestHash: expected.requestHash,
    result,
    completedAt: claimedAt,
  };

  const patch: Record<string, unknown> = {
    [`fieldPlatform/buildings/${result.buildingId}/managementContract`]:
      reservation.nextContract,
    [`fieldPlatform/buildings/${result.buildingId}/updatedAt`]: claimedAt,
    [`fieldPlatform/buildings/${result.buildingId}/updatedBy`]: expected.uid,
    [`fieldPlatform/auditLogs/${id}`]: audit,
    [`fieldPlatform/mapProjections/${result.buildingId}`]: projection,
    [`fieldPlatform/managementContractRequests/${expected.uid}/${expected.input.requestId}`]:
      receipt,
  };
  const outcome = await dependencies.commitTransitionAtomically({
    uid: expected.uid,
    requestId: expected.input.requestId,
    requestHash: expected.requestHash,
    buildingId: result.buildingId,
    expectedPreviousContractFingerprint:
      reservation.value.previousContractFingerprint,
    expectedNextContractFingerprint:
      reservation.value.nextContractFingerprint,
    nextContract: reservation.nextContract,
    result,
    patch,
  });
  if (outcome.status === "committed" || outcome.status === "alreadyCommitted") {
    return result;
  }
  if (outcome.status === "staleConflict") {
    throw new Error("field_management_transition_conflict");
  }
  return invalidTransition();
}

async function recoverReservation(
  rawReservation: unknown,
  expected: ExpectedRequest,
  dependencies: SetManagementContractStatusDependencies,
  building?: ValidatedBuilding,
): Promise<SetManagementContractStatusResult> {
  const reservation = validateReservation(rawReservation, expected);
  const current = building ?? validateBuilding(
    await dependencies.getBuilding(expected.input.buildingId),
    expected.input.buildingId,
  );
  return persistReservation(reservation, current, expected, dependencies);
}

export async function setManagementContractStatusCore(
  input: SetManagementContractStatusInput,
  actor: FieldActor,
  dependencies: SetManagementContractStatusDependencies,
): Promise<SetManagementContractStatusResult> {
  assertAuthorizedActor(actor);
  const normalized = normalizeInput(input);
  const expected: ExpectedRequest = {
    uid: actor.uid,
    input: normalized,
    requestHash: hashInput(normalized),
    result: { buildingId: normalized.buildingId, status: normalized.status },
  };

  const receipt = validateReceipt(
    await dependencies.getReceipt(actor.uid, normalized.requestId),
    expected,
  );
  if (receipt !== null) return receipt;

  const existingReservation = await dependencies.getReservation(
    actor.uid,
    normalized.requestId,
  );
  if (existingReservation !== null) {
    return recoverReservation(existingReservation, expected, dependencies);
  }

  const building = validateBuilding(
    await dependencies.getBuilding(normalized.buildingId),
    normalized.buildingId,
  );
  const racedReservation = await dependencies.getReservation(
    actor.uid,
    normalized.requestId,
  );
  if (racedReservation !== null) {
    return recoverReservation(
      racedReservation,
      expected,
      dependencies,
      building,
    );
  }

  try {
    assertAllowedTransition(building.contract.status, normalized.status);
  } catch (error) {
    const lateReservation = await dependencies.getReservation(
      actor.uid,
      normalized.requestId,
    );
    if (lateReservation !== null) {
      return recoverReservation(
        lateReservation,
        expected,
        dependencies,
        building,
      );
    }
    throw error;
  }

  const claimedAt = dependencies.now();
  if (!isCanonicalUtcTimestamp(claimedAt)) invalidTransition();
  const next = nextContract(
    building.contract,
    normalized,
    claimedAt,
    actor.uid,
  );
  const proposed: ContractTransitionReservation = {
    uid: actor.uid,
    requestId: normalized.requestId,
    buildingId: normalized.buildingId,
    requestHash: expected.requestHash,
    previousContractStatus: building.contract.status,
    previousContractUpdatedAt: building.contract.updatedAt,
    previousContractFingerprint: managementContractFingerprint(
      building.contract,
    ),
    previousContract: building.contract,
    nextContractFingerprint: managementContractFingerprint(next),
    nextContract: next,
    result: expected.result,
    claimedAt,
  };

  const outcome = await dependencies.reserveTransition(proposed);
  if (outcome.status === "requestConflict") {
    throw new Error("field_request_id_conflict");
  }
  if (outcome.status === "buildingConflict") {
    throw new Error("field_management_transition_conflict");
  }
  const reservation = validateReservation(outcome.reservation, expected);
  const latestBuilding = validateBuilding(
    await dependencies.getBuilding(normalized.buildingId),
    normalized.buildingId,
  );
  return persistReservation(
    reservation,
    latestBuilding,
    expected,
    dependencies,
  );
}

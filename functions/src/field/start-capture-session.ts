import { Buffer } from "node:buffer";

export type CaptureVisitType = "initial" | "vacancyRefresh";
export type CaptureSessionActorRole = "admin" | "staff" | "reviewer";

export interface StartCaptureSessionInput {
  requestId: string;
  captureSessionId: string;
  visitId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitType: CaptureVisitType;
}

export interface StartCaptureSessionResult {
  captureSessionId: string;
  visitId: string;
}

export interface StartCaptureSessionDependencies {
  isEnabled(uid: string): Promise<boolean>;
  isAssigned(buildingId: string, uid: string): Promise<boolean>;
  readSession(captureSessionId: string): Promise<unknown | null>;
  readVisit(visitId: string): Promise<unknown | null>;
  readUnit(unitId: string): Promise<unknown | null>;
  readListing(listingId: string): Promise<unknown | null>;
  writePatch(patch: Record<string, unknown>): Promise<void>;
  now(): string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MAX_PATH_SEGMENT_BYTES = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && value !== NIL_UUID
    && UUID_PATTERN.test(value);
}

function isSafePathSegment(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || value === "."
    || value === ".."
    || Buffer.byteLength(value, "utf8") > MAX_PATH_SEGMENT_BYTES
  ) {
    return false;
  }
  return !/[\\/.#$\[\]\u0000-\u001f\u007f]/u.test(value);
}

function isCanonicalIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function invalid(): never {
  throw new Error("field_capture_session_invalid");
}

function normalizeInput(input: StartCaptureSessionInput): StartCaptureSessionInput {
  if (!isRecord(input)) invalid();

  const requestId = input.requestId;
  const captureSessionId = input.captureSessionId;
  const visitId = input.visitId;
  const buildingId = input.buildingId;
  const unitId = input.unitId;
  const listingId = input.listingId;
  const visitType = input.visitType;

  if (
    !isUuid(requestId)
    || !isUuid(captureSessionId)
    || !isUuid(visitId)
    || !isSafePathSegment(buildingId)
    || (unitId !== undefined && !isSafePathSegment(unitId))
    || (listingId !== undefined && !isSafePathSegment(listingId))
    || (visitType !== "initial" && visitType !== "vacancyRefresh")
  ) {
    invalid();
  }

  return {
    requestId,
    captureSessionId,
    visitId,
    buildingId,
    ...(unitId === undefined ? {} : { unitId }),
    ...(listingId === undefined ? {} : { listingId }),
    visitType,
  };
}

function assertActor(
  actor: { uid: string; role: CaptureSessionActorRole },
): asserts actor is { uid: string; role: "admin" | "staff" } {
  if (
    !isRecord(actor)
    || !isSafePathSegment(actor.uid)
    || (actor.role !== "admin" && actor.role !== "staff")
  ) {
    throw new Error("field_capture_session_forbidden");
  }
}

function hasStableFields(
  value: unknown,
  expected: Record<string, unknown>,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Object.entries(expected).every(([key, expectedValue]) =>
    value[key] === expectedValue
  );
}

function assertOwnedRecord(
  value: unknown,
  id: string,
  buildingId: string,
  errorCode: string,
): asserts value is Record<string, unknown> {
  if (
    !isRecord(value)
    || value.id !== id
    || value.buildingId !== buildingId
  ) {
    throw new Error(errorCode);
  }
}

export async function startCaptureSessionCore(
  input: StartCaptureSessionInput,
  actor: { uid: string; role: CaptureSessionActorRole },
  dependencies: StartCaptureSessionDependencies,
): Promise<StartCaptureSessionResult> {
  const normalized = normalizeInput(input);
  assertActor(actor);

  if (await dependencies.isEnabled(actor.uid) !== true) {
    throw new Error("field_capture_session_forbidden");
  }
  if (
    actor.role === "staff"
    && await dependencies.isAssigned(normalized.buildingId, actor.uid) !== true
  ) {
    throw new Error("field_building_assignment_required");
  }

  const [existingSession, existingVisit] = await Promise.all([
    dependencies.readSession(normalized.captureSessionId),
    dependencies.readVisit(normalized.visitId),
  ]);

  const result = {
    captureSessionId: normalized.captureSessionId,
    visitId: normalized.visitId,
  };

  if (existingSession !== null) {
    const expectedSessionBindings = {
      id: normalized.captureSessionId,
      requestId: normalized.requestId,
      buildingId: normalized.buildingId,
      unitId: normalized.unitId,
      listingId: normalized.listingId,
      visitId: normalized.visitId,
      visitType: normalized.visitType,
      createdBy: actor.uid,
    };
    if (
      !hasStableFields(existingSession, expectedSessionBindings)
      || (existingSession.status !== "open" && existingSession.status !== "complete")
    ) {
      throw new Error("field_capture_session_conflict");
    }
  }

  if (existingVisit !== null) {
    const expectedVisitBindings = {
      id: normalized.visitId,
      buildingId: normalized.buildingId,
      unitId: normalized.unitId,
      listingId: normalized.listingId,
      type: normalized.visitType,
      assignedUserId: actor.uid,
      checklistTemplateId: normalized.visitType,
      checklistTemplateVersion: 1,
      createdBy: actor.uid,
    };
    if (!hasStableFields(existingVisit, expectedVisitBindings)) {
      throw new Error("field_capture_visit_conflict");
    }
  } else if (existingSession !== null) {
    throw new Error("field_capture_visit_conflict");
  }

  if (existingSession !== null && existingVisit !== null) return result;

  if (normalized.unitId !== undefined) {
    const unit = await dependencies.readUnit(normalized.unitId);
    assertOwnedRecord(
      unit,
      normalized.unitId,
      normalized.buildingId,
      "field_capture_unit_mismatch",
    );
  }
  if (normalized.listingId !== undefined) {
    const listing = await dependencies.readListing(normalized.listingId);
    assertOwnedRecord(
      listing,
      normalized.listingId,
      normalized.buildingId,
      "field_capture_listing_mismatch",
    );
  }

  const now = dependencies.now();
  if (!isCanonicalIsoDateTime(now)) {
    throw new Error("field_capture_session_state_invalid");
  }

  const visit = existingVisit ?? {
    id: normalized.visitId,
    buildingId: normalized.buildingId,
    ...(normalized.unitId === undefined ? {} : { unitId: normalized.unitId }),
    ...(normalized.listingId === undefined
      ? {}
      : { listingId: normalized.listingId }),
    type: normalized.visitType,
    assignedUserId: actor.uid,
    checklistTemplateId: normalized.visitType,
    checklistTemplateVersion: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  };
  const captureSession = {
    id: normalized.captureSessionId,
    requestId: normalized.requestId,
    buildingId: normalized.buildingId,
    ...(normalized.unitId === undefined ? {} : { unitId: normalized.unitId }),
    ...(normalized.listingId === undefined
      ? {}
      : { listingId: normalized.listingId }),
    visitId: normalized.visitId,
    visitType: normalized.visitType,
    createdBy: actor.uid,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const auditId = `capture-session-${normalized.requestId}`;

  await dependencies.writePatch({
    [`fieldPlatform/visits/${normalized.visitId}`]: visit,
    [`fieldPlatform/captureSessions/${normalized.captureSessionId}`]: captureSession,
    [`fieldPlatform/auditLogs/${auditId}`]: {
      id: auditId,
      actorId: actor.uid,
      action: "captureSession.started",
      entityType: "visit",
      entityId: normalized.visitId,
      occurredAt: now,
      requestId: normalized.requestId,
      changes: {
        captureSessionId: { after: normalized.captureSessionId },
      },
    },
  });

  return result;
}

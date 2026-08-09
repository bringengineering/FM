import { Buffer } from "node:buffer";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase, ServerValue } from "firebase-admin/database";
import { getStorage } from "firebase-admin/storage";
import { onValueWritten } from "firebase-functions/v2/database";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";

import {
  provisionFieldUserCore,
  type FieldRole,
} from "./auth/provision-field-user.js";
import type {
  FieldActor,
  SaveFieldRegistrationInput,
} from "./field/contracts.js";
import {
  excludeFieldMediaCore,
  type ExcludeFieldMediaDependencies,
  type ExcludeFieldMediaInput,
} from "./field/exclude-field-media.js";
import {
  finalizeFieldMediaCore,
  type FinalizeFieldMediaDependencies,
  type FinalizeFieldMediaInput,
  type StoredObject,
} from "./field/finalize-field-media.js";
import {
  getFieldMediaAccessCore,
  type FieldMediaAccessDependencies,
} from "./field/get-field-media-access.js";
import {
  listCaptureWorkspaceCore,
  type ListCaptureWorkspaceDependencies,
} from "./field/list-capture-workspace.js";
import {
  reduceAuthoritativeProjectionRebuild,
  reduceRegistrationClaim,
  reduceTransitionClaim,
  reduceTransitionCommit,
} from "./field/firebase-transaction-state.js";
import type {
  ProjectionBuilding,
  ProjectionListing,
  ProjectionMedia,
} from "./field/map-projection.js";
import {
  appendOwnerNoteCore,
  archiveOwnerNoteCore,
  isOwnerNoteActorId,
  normalizeStoredOwnerNoteRecord,
  type OwnerNoteDependencies,
} from "./field/owner-notes.js";
import {
  rebuildMapProjectionForBuilding,
  type RebuildMapProjectionDependencies,
} from "./field/rebuild-map-projection.js";
import {
  saveFieldRegistrationCore,
  type RegistrationRequestReceipt,
  type SaveFieldRegistrationDependencies,
} from "./field/save-field-registration.js";
import {
  setManagementContractStatusCore,
  type ContractRequestReceipt,
  type ContractTransitionReservation,
  type SetManagementContractStatusDependencies,
  type SetManagementContractStatusInput,
} from "./field/set-management-contract-status.js";
import {
  startCaptureSessionCore,
  type StartCaptureSessionDependencies,
  type StartCaptureSessionInput,
} from "./field/start-capture-session.js";
import { consumeRateLimit } from "./security/rate-limit.js";

if (getApps().length === 0) {
  initializeApp();
}

const adminAuth = getAuth();
const adminDatabase = getDatabase();
const mediaBucket = getStorage().bucket();
const FIELD_ID_BYTES = 128;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldRole(value: unknown): value is FieldRole {
  return value === "admin" || value === "staff" || value === "reviewer";
}

function isPathSafeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Buffer.byteLength(value, "utf8") <= FIELD_ID_BYTES &&
    !/[\u0000-\u001f\u007f.#$\[\]\/]/u.test(value)
  );
}

function snapshotValues<T>(value: unknown): T[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value) as T[];
}

function denyFieldAccess(): never {
  throw new HttpsError("permission-denied", "field_access_denied");
}

function rejectConsumedAppCheckToken(request: CallableRequest<unknown>): void {
  if (request.app?.alreadyConsumed === true) {
    throw new HttpsError("unauthenticated", "field_app_check_replayed");
  }
}

export async function requireFieldActor(
  request: CallableRequest<unknown>,
): Promise<FieldActor> {
  const uid = request.auth?.uid;
  const claimedRole = request.auth?.token.fieldRole;
  if (
    !isOwnerNoteActorId(uid) ||
    request.auth?.token.fieldPlatform !== true ||
    !isFieldRole(claimedRole)
  ) {
    return denyFieldAccess();
  }

  const snapshot = await adminDatabase.ref(`fieldPlatform/users/${uid}`).get();
  const storedUser: unknown = snapshot.val();
  if (
    !isRecord(storedUser) ||
    storedUser.enabled !== true ||
    !isFieldRole(storedUser.role) ||
    storedUser.role !== claimedRole
  ) {
    return denyFieldAccess();
  }

  const tokenDisplayName = request.auth.token.name;
  const authTime = request.auth.token.auth_time;
  return {
    uid,
    role: claimedRole,
    enabled: true,
    ...(typeof tokenDisplayName === "string"
      ? { tokenDisplayName }
      : {}),
    ...(typeof authTime === "number" && Number.isFinite(authTime)
      ? { sessionId: authTime.toString(10) }
      : {}),
  };
}

function rethrowAsCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : null;

  if (
    message === "field_invalid_registration" ||
    message === "field_management_transition_invalid"
  ) {
    throw new HttpsError("invalid-argument", message);
  }
  if (
    message === "field_registration_forbidden" ||
    message === "field_management_admin_required"
  ) {
    throw new HttpsError("permission-denied", message);
  }
  if (
    message === "field_request_id_conflict" ||
    message === "field_draft_id_conflict" ||
    message === "field_management_transition_conflict"
  ) {
    throw new HttpsError("already-exists", message);
  }

  throw error;
}

const OWNER_NOTE_INPUT_ERRORS = new Set([
  "owner_note_building_id_invalid",
  "owner_note_id_invalid",
  "owner_note_id_duplicate",
  "owner_note_drafts_invalid",
  "owner_note_draft_invalid",
  "owner_note_body_required",
  "owner_note_body_too_long",
  "owner_note_recorded_at_invalid",
]);

function rethrowOwnerNoteCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "owner_note_unknown";

  if (
    message === "owner_note_forbidden"
    || message === "owner_note_archive_forbidden"
  ) {
    throw new HttpsError("permission-denied", message);
  }
  if (
    message === "owner_note_building_not_found"
    || message === "owner_note_not_found"
  ) {
    throw new HttpsError("not-found", message);
  }
  if (message === "owner_note_id_conflict") {
    throw new HttpsError("already-exists", message);
  }
  if (message === "owner_note_rate_limited") {
    throw new HttpsError("resource-exhausted", message);
  }
  if (OWNER_NOTE_INPUT_ERRORS.has(message)) {
    throw new HttpsError("invalid-argument", message);
  }
  throw new HttpsError("internal", "owner_note_internal");
}

function rethrowCaptureSessionCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error
    ? error.message
    : "field_capture_session_unknown";

  if (
    message === "field_capture_session_invalid"
    || message === "field_capture_unit_mismatch"
    || message === "field_capture_listing_mismatch"
  ) {
    throw new HttpsError("invalid-argument", message);
  }
  if (
    message === "field_capture_session_forbidden"
    || message === "field_building_assignment_required"
  ) {
    throw new HttpsError("permission-denied", message);
  }
  if (
    message === "field_capture_session_conflict"
    || message === "field_capture_visit_conflict"
  ) {
    throw new HttpsError("already-exists", message);
  }
  throw new HttpsError("internal", "field_capture_session_internal");
}

const MEDIA_INVALID_ERRORS = new Set([
  "field_media_invalid",
  "field_media_access_invalid",
  "field_media_exclusion_invalid",
  "field_rate_limit_invalid",
]);
const MEDIA_FORBIDDEN_ERRORS = new Set([
  "field_media_forbidden",
  "field_media_access_forbidden",
  "field_media_exclusion_forbidden",
  "field_building_assignment_required",
]);
const MEDIA_NOT_FOUND_ERRORS = new Set([
  "field_media_not_found",
  "field_media_object_missing",
]);
const MEDIA_CONFLICT_ERRORS = new Set([
  "field_media_id_conflict",
  "field_media_destination_conflict",
  "field_media_exclusion_conflict",
  "field_media_exclusion_request_conflict",
  "field_media_replacement_conflict",
]);
const MEDIA_PRECONDITION_ERRORS = new Set([
  "field_media_not_finalized",
  "field_media_path_invalid",
  "field_media_path_mismatch",
  "field_media_generation_mismatch",
  "field_media_mime_not_allowed",
  "field_media_kind_mismatch",
  "field_media_size_invalid",
  "field_media_too_large",
  "field_media_metadata_mismatch",
  "field_media_visit_mismatch",
  "field_media_session_mismatch",
  "field_media_unit_mismatch",
  "field_media_listing_mismatch",
]);

function rethrowMediaCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "field_media_unknown";
  if (message === "field_rate_limit_exceeded") {
    throw new HttpsError("resource-exhausted", message);
  }
  if (MEDIA_INVALID_ERRORS.has(message)) {
    throw new HttpsError("invalid-argument", message);
  }
  if (MEDIA_FORBIDDEN_ERRORS.has(message)) {
    throw new HttpsError("permission-denied", message);
  }
  if (MEDIA_NOT_FOUND_ERRORS.has(message)) {
    throw new HttpsError("not-found", message);
  }
  if (MEDIA_CONFLICT_ERRORS.has(message)) {
    throw new HttpsError("already-exists", message);
  }
  if (MEDIA_PRECONDITION_ERRORS.has(message)) {
    throw new HttpsError("failed-precondition", message);
  }
  throw new HttpsError("internal", "field_media_internal");
}

async function getBuilding(
  buildingId: string,
): Promise<ProjectionBuilding | null> {
  const snapshot = await adminDatabase
    .ref(`fieldPlatform/buildings/${buildingId}`)
    .get();
  return snapshot.val() as ProjectionBuilding | null;
}

async function getListings(buildingId: string): Promise<ProjectionListing[]> {
  const snapshot = await adminDatabase
    .ref("fieldPlatform/listings")
    .orderByChild("buildingId")
    .equalTo(buildingId)
    .get();
  return snapshotValues<ProjectionListing>(snapshot.val());
}

async function getMedia(buildingId: string): Promise<ProjectionMedia[]> {
  const snapshot = await adminDatabase
    .ref("fieldPlatform/media")
    .orderByChild("buildingId")
    .equalTo(buildingId)
    .get();
  return snapshotValues<ProjectionMedia>(snapshot.val());
}

async function rebuildProjectionFromAuthoritativeState(
  buildingId: string,
  updatedAt: string,
): Promise<void> {
  const input = { buildingId, updatedAt };
  await adminDatabase.ref("fieldPlatform").transaction(
    (current) => {
      return reduceAuthoritativeProjectionRebuild(current, input).state;
    },
    undefined,
    false,
  );
}

function projectionDependenciesForEvent(
  eventTime: string,
): RebuildMapProjectionDependencies {
  return {
    getBuilding,
    getListings,
    getMedia,
    setProjection: (buildingId, _projection) =>
      rebuildProjectionFromAuthoritativeState(buildingId, eventTime),
    now: () => eventTime,
  };
}

const saveDependencies: SaveFieldRegistrationDependencies = {
  async getReceipt(uid, requestId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/registrationRequests/${uid}/${requestId}`)
      .get();
    return snapshot.val() as RegistrationRequestReceipt | null;
  },
  async reserveRegistration(proposed) {
    const reference = adminDatabase.ref(
      `fieldPlatform/registrationClaims/${proposed.uid}`,
    );
    const transaction = await reference.transaction(
      (current) => {
        const decision = reduceRegistrationClaim(current, proposed);
        return decision.write ? decision.state : undefined;
      },
      undefined,
      false,
    );
    const finalDecision = reduceRegistrationClaim(
      transaction.snapshot.val(),
      proposed,
    );
    if (finalDecision.status === "acquired") {
      return {
        status: "acquired",
        reservation: finalDecision.reservation,
      };
    }
    return { status: finalDecision.status };
  },
  async updateRoot(patch) {
    await adminDatabase.ref().update(patch);
  },
  async getUserDisplayName(uid) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/users/${uid}/displayName`)
      .get();
    const value: unknown = snapshot.val();
    return typeof value === "string" ? value : null;
  },
  now: () => new Date().toISOString(),
};

const ownerNoteDependencies: OwnerNoteDependencies = {
  nowIso: () => new Date().toISOString(),
  async consumeRateLimit(uid, sessionId, action, limit) {
    const safeSessionId = /^\d{1,20}$/.test(sessionId) ? sessionId : "current";
    const rateReference = adminDatabase.ref(
      `fieldPlatform/serverState/rateLimits/ownerNotes/${uid}/${safeSessionId}/${action}`,
    );
    const now = Date.now();
    const result = await rateReference.transaction(
      (current: { windowStartedAt?: number; count?: number } | null) => {
        if (
          !current
          || typeof current.windowStartedAt !== "number"
          || !Number.isFinite(current.windowStartedAt)
          || now - current.windowStartedAt >= 60_000
          || now < current.windowStartedAt
        ) {
          return { windowStartedAt: now, count: 1 };
        }
        const count = typeof current.count === "number" && Number.isFinite(current.count)
          ? Math.max(0, Math.floor(current.count))
          : 0;
        return count >= limit
          ? undefined
          : { windowStartedAt: current.windowStartedAt, count: count + 1 };
      },
      undefined,
      false,
    );
    return result.committed;
  },
  async isEnabled(uid) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/users/${uid}/enabled`)
      .get();
    return snapshot.val() === true;
  },
  async buildingExists(buildingId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/buildings/${buildingId}`)
      .get();
    return snapshot.exists();
  },
  async getUserDisplayName(uid) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/users/${uid}/displayName`)
      .get();
    const value: unknown = snapshot.val();
    return typeof value === "string" ? value : null;
  },
  async isAssigned(buildingId, uid) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/buildingAssignments/${buildingId}/${uid}`)
      .get();
    return snapshot.val() === true;
  },
  async readNote(buildingId, noteId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/ownerNotes/${buildingId}/${noteId}`)
      .get();
    const value: unknown = snapshot.val();
    return value === null
      ? null
      : normalizeStoredOwnerNoteRecord(value, buildingId, noteId);
  },
  async createNoteIfAbsent(buildingId, noteId, note) {
    const noteReference = adminDatabase.ref(
      `fieldPlatform/ownerNotes/${buildingId}/${noteId}`,
    );
    const candidate = normalizeStoredOwnerNoteRecord(
      note,
      buildingId,
      noteId,
    );
    const result = await noteReference.transaction(
      (current) => current ?? candidate,
      undefined,
      false,
    );
    const stored: unknown = result.snapshot.val();
    return normalizeStoredOwnerNoteRecord(stored, buildingId, noteId);
  },
  async archiveNote(buildingId, noteId, archive) {
    const noteReference = adminDatabase.ref(
      `fieldPlatform/ownerNotes/${buildingId}/${noteId}`,
    );
    const result = await noteReference.transaction(
      (current: unknown) => {
        if (current === null || current === undefined) return undefined;
        const stored = normalizeStoredOwnerNoteRecord(
          current,
          buildingId,
          noteId,
        );
        if (stored.archivedAt && stored.archivedBy) return current;
        return { ...stored, ...archive };
      },
      undefined,
      false,
    );
    const stored: unknown = result.snapshot.val();
    if (stored === null || stored === undefined) {
      throw new Error("owner_note_not_found");
    }
    const normalized = normalizeStoredOwnerNoteRecord(
      stored,
      buildingId,
      noteId,
    );
    return {
      archivedAt: normalized.archivedAt as string,
      archivedBy: normalized.archivedBy as string,
    };
  },
};

const captureSessionDependencies: StartCaptureSessionDependencies = {
  async isEnabled(uid) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/users/${uid}/enabled`)
      .get();
    return snapshot.val() === true;
  },
  async isAssigned(buildingId, uid) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/buildingAssignments/${buildingId}/${uid}`)
      .get();
    return snapshot.val() === true;
  },
  async readSession(captureSessionId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/captureSessions/${captureSessionId}`)
      .get();
    return snapshot.val() as unknown | null;
  },
  async readVisit(visitId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/visits/${visitId}`)
      .get();
    return snapshot.val() as unknown | null;
  },
  async readUnit(unitId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/units/${unitId}`)
      .get();
    return snapshot.val() as unknown | null;
  },
  async readListing(listingId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/listings/${listingId}`)
      .get();
    return snapshot.val() as unknown | null;
  },
  async writePatch(patch) {
    await adminDatabase.ref().update(patch);
  },
  now: () => new Date().toISOString(),
};

function gcsErrorCode(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const code = error.code;
  if (typeof code === "number" && Number.isInteger(code)) return code;
  if (typeof code === "string" && /^\d{3}$/.test(code)) return Number(code);
  return null;
}

function stringMetadata(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function storedObjectFromMetadata(value: unknown): StoredObject {
  if (!isRecord(value)) throw new Error("field_media_storage_state_invalid");
  const size = typeof value.size === "string" ? Number(value.size) : value.size;
  if (
    typeof value.generation !== "string"
    || typeof size !== "number"
    || !Number.isSafeInteger(size)
    || typeof value.contentType !== "string"
  ) {
    throw new Error("field_media_storage_state_invalid");
  }
  return {
    generation: value.generation,
    sizeBytes: size,
    contentType: value.contentType,
    ...(typeof value.md5Hash === "string" ? { md5Hash: value.md5Hash } : {}),
    ...(typeof value.crc32c === "string" ? { crc32c: value.crc32c } : {}),
    ...(typeof value.timeCreated === "string"
      ? { timeCreated: value.timeCreated }
      : {}),
    ...(stringMetadata(value.metadata) === undefined
      ? {}
      : { customMetadata: stringMetadata(value.metadata) }),
  };
}

async function inspectStorageObject(
  path: string,
  generation?: string,
): Promise<StoredObject | null> {
  try {
    const [metadata] = await mediaBucket.file(
      path,
      generation === undefined ? undefined : { generation },
    ).getMetadata();
    return storedObjectFromMetadata(metadata);
  } catch (error) {
    if (gcsErrorCode(error) === 404) return null;
    throw error;
  }
}

async function isEnabledFieldUser(uid: string): Promise<boolean> {
  const snapshot = await adminDatabase
    .ref(`fieldPlatform/users/${uid}/enabled`)
    .get();
  return snapshot.val() === true;
}

async function isAssignedFieldUser(
  buildingId: string,
  uid: string,
): Promise<boolean> {
  const snapshot = await adminDatabase
    .ref(`fieldPlatform/buildingAssignments/${buildingId}/${uid}`)
    .get();
  return snapshot.val() === true;
}

async function readFieldRecord(path: string): Promise<unknown | null> {
  const snapshot = await adminDatabase.ref(path).get();
  return snapshot.val() as unknown | null;
}

const finalizeMediaDependencies: FinalizeFieldMediaDependencies = {
  isEnabled: isEnabledFieldUser,
  isAssigned: isAssignedFieldUser,
  readMedia: (mediaId) => readFieldRecord(`fieldPlatform/media/${mediaId}`),
  readFinalizationAudit: (requestId) => readFieldRecord(
    `fieldPlatform/auditLogs/media-finalized-${requestId}`,
  ),
  readVisit: (visitId) => readFieldRecord(`fieldPlatform/visits/${visitId}`),
  readSession: (captureSessionId) => readFieldRecord(
    `fieldPlatform/captureSessions/${captureSessionId}`,
  ),
  readUnit: (unitId) => readFieldRecord(`fieldPlatform/units/${unitId}`),
  readListing: (listingId) => readFieldRecord(
    `fieldPlatform/listings/${listingId}`,
  ),
  readBuilding: getBuilding,
  listBuildingListings: getListings,
  listFinalizedBuildingMedia: getMedia,
  inspectStagingObject: inspectStorageObject,
  async copyToFinalized(input) {
    const source = mediaBucket.file(input.sourcePath, {
      generation: input.sourceGeneration,
    });
    const destination = mediaBucket.file(input.destinationPath);
    try {
      const [copied] = await source.copy(destination, {
        preconditionOpts: { ifGenerationMatch: input.ifGenerationMatch },
      });
      const [metadata] = await copied.getMetadata();
      if (!isRecord(metadata) || typeof metadata.generation !== "string") {
        throw new Error("field_media_storage_state_invalid");
      }
      return {
        status: "copied",
        path: input.destinationPath,
        generation: metadata.generation,
      };
    } catch (error) {
      if (gcsErrorCode(error) === 412) return { status: "alreadyExists" };
      throw error;
    }
  },
  inspectFinalizedObject: (path) => inspectStorageObject(path),
  async writePatch(patch) {
    await adminDatabase.ref().update(patch);
  },
  async deleteStaging(path, generation) {
    await mediaBucket.file(path, { generation }).delete({
      ifGenerationMatch: generation,
    });
  },
  now: () => new Date().toISOString(),
};

const mediaAccessDependencies: FieldMediaAccessDependencies = {
  isEnabled: isEnabledFieldUser,
  isAssigned: isAssignedFieldUser,
  readMedia: (mediaId) => readFieldRecord(`fieldPlatform/media/${mediaId}`),
  async signReadUrl(path, expiresAt) {
    const [url] = await mediaBucket.file(path).getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAt,
    });
    return url;
  },
  nowMs: () => Date.now(),
};

const excludeMediaDependencies: ExcludeFieldMediaDependencies = {
  isEnabled: isEnabledFieldUser,
  isAssigned: isAssignedFieldUser,
  readMedia: (mediaId) => readFieldRecord(`fieldPlatform/media/${mediaId}`),
  readAudit: (requestId) => readFieldRecord(
    `fieldPlatform/auditLogs/media-excluded-${requestId}`,
  ),
  readBuilding: getBuilding,
  listBuildingListings: getListings,
  listBuildingMedia: getMedia,
  async writePatch(patch) {
    await adminDatabase.ref().update(patch);
  },
  now: () => new Date().toISOString(),
};

async function listFieldCollection(path: string): Promise<unknown[]> {
  const snapshot = await adminDatabase.ref(path).get();
  return snapshotValues<unknown>(snapshot.val());
}

const captureWorkspaceDependencies: ListCaptureWorkspaceDependencies = {
  async listAssignedBuildingIds(uid) {
    const snapshot = await adminDatabase
      .ref("fieldPlatform/buildingAssignments")
      .get();
    const assignments = snapshot.val();
    if (!isRecord(assignments)) return [];
    return Object.entries(assignments)
      .filter(([buildingId, value]) => (
        isPathSafeId(buildingId)
        && isRecord(value)
        && value[uid] === true
      ))
      .map(([buildingId]) => buildingId);
  },
  listBuildings: () => listFieldCollection("fieldPlatform/buildings"),
  listUnits: () => listFieldCollection("fieldPlatform/units"),
  listListings: () => listFieldCollection("fieldPlatform/listings"),
  listCaptureSessions: () => listFieldCollection("fieldPlatform/captureSessions"),
};

function mediaRateReference(
  operation: "finalize" | "mediaAccess" | "exclude" | "captureWorkspace",
  uid: string,
  sessionId: string,
) {
  if (!isPathSafeId(uid) || !isPathSafeId(sessionId)) {
    throw new Error("field_rate_limit_invalid");
  }
  return adminDatabase.ref(
    `fieldPlatform/rateLimits/${operation}/${uid}/${sessionId}`,
  );
}

const contractDependencies: SetManagementContractStatusDependencies = {
  getBuilding,
  getListings,
  getMedia,
  async getReceipt(uid, requestId) {
    const snapshot = await adminDatabase
      .ref(`fieldPlatform/managementContractRequests/${uid}/${requestId}`)
      .get();
    return snapshot.val() as ContractRequestReceipt | null;
  },
  async getReservation(uid, requestId) {
    const snapshot = await adminDatabase
      .ref(
        `fieldPlatform/managementContractClaims/requests/${uid}/${requestId}`,
      )
      .get();
    return snapshot.val() as ContractTransitionReservation | null;
  },
  async reserveTransition(proposed) {
    const reference = adminDatabase.ref(
      "fieldPlatform/managementContractClaims",
    );
    const transaction = await reference.transaction(
      (current) => {
        const decision = reduceTransitionClaim(current, proposed);
        return decision.write ? decision.state : undefined;
      },
      undefined,
      false,
    );
    const finalDecision = reduceTransitionClaim(
      transaction.snapshot.val(),
      proposed,
    );
    if (finalDecision.status === "acquired") {
      return {
        status: "acquired",
        reservation: finalDecision.reservation,
      };
    }
    return { status: finalDecision.status };
  },
  async commitTransitionAtomically(input) {
    const reference = adminDatabase.ref("fieldPlatform");
    const transaction = await reference.transaction(
      (current) => {
        const decision = reduceTransitionCommit(current, input);
        return decision.write ? decision.state : undefined;
      },
      undefined,
      false,
    );
    const finalDecision = reduceTransitionCommit(
      transaction.snapshot.val(),
      input,
    );

    if (transaction.committed) {
      if (finalDecision.status !== "alreadyCommitted") {
        throw new Error("field_management_transition_state_invalid");
      }
      return { status: "committed" };
    }
    if (finalDecision.status === "alreadyCommitted") {
      return { status: "alreadyCommitted" };
    }
    if (finalDecision.status === "staleConflict") {
      return { status: "staleConflict" };
    }
    throw new Error("field_management_transition_state_invalid");
  },
  async updateRoot(patch) {
    await adminDatabase.ref().update(patch);
  },
  now: () => new Date().toISOString(),
};

export const provisionFieldUser = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const uid = request.auth?.uid;
    const email = request.auth?.token.email;
    const emailVerified = request.auth?.token.email_verified;

    if (!uid || typeof email !== "string" || emailVerified !== true) {
      throw new HttpsError("unauthenticated", "field_verified_google_account_required");
    }

    try {
      const claims = await provisionFieldUserCore(
        { uid, email },
        {
          async getAllowedEmail(emailHash) {
            const snapshot = await adminDatabase
              .ref(`fieldPlatformAllowedEmails/${emailHash}`)
              .get();
            const value = snapshot.val() as { active?: unknown; role?: unknown } | null;

            if (!value || value.active !== true) {
              return null;
            }

            return {
              active: true,
              role: value.role as FieldRole,
            };
          },
          async setCustomClaims(userId, fieldClaims) {
            const user = await adminAuth.getUser(userId);
            await adminAuth.setCustomUserClaims(userId, {
              ...user.customClaims,
              ...fieldClaims,
            });
          },
          async writeFieldUser(userId, record) {
            await adminDatabase.ref(`fieldPlatform/users/${userId}`).update(record);
          },
          now: () => ServerValue.TIMESTAMP,
        },
      );

      return { enabled: true, role: claims.fieldRole };
    } catch (error) {
      if (error instanceof Error && error.message === "field_user_not_allowed") {
        throw new HttpsError("permission-denied", error.message);
      }
      throw error;
    }
  },
);

export const saveFieldRegistration = onCall<SaveFieldRegistrationInput>(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => {
    try {
      return await saveFieldRegistrationCore(
        request.data,
        await requireFieldActor(request),
        saveDependencies,
      );
    } catch (error) {
      return rethrowAsCallableError(error);
    }
  },
);

export const setManagementContractStatus = onCall<SetManagementContractStatusInput>(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => {
    try {
      return await setManagementContractStatusCore(
        request.data,
        await requireFieldActor(request),
        contractDependencies,
      );
    } catch (error) {
      return rethrowAsCallableError(error);
    }
  },
);

export const startFieldCaptureSession = onCall<StartCaptureSessionInput>(
  {
    region: "asia-northeast3",
    enforceAppCheck: true,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "field_auth_required");
    }
    rejectConsumedAppCheckToken(request);
    try {
      const actor = await requireFieldActor(request);
      return await startCaptureSessionCore(
        request.data,
        { uid: actor.uid, role: actor.role },
        captureSessionDependencies,
      );
    } catch (error) {
      return rethrowCaptureSessionCallableError(error);
    }
  },
);

const protectedMediaCallableOptions = {
  region: "asia-northeast3" as const,
  enforceAppCheck: true,
  consumeAppCheckToken: true,
};

export const finalizeFieldMedia = onCall<FinalizeFieldMediaInput>(
  protectedMediaCallableOptions,
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "field_auth_required");
    }
    rejectConsumedAppCheckToken(request);
    try {
      const actor = await requireFieldActor(request);
      await consumeRateLimit(
        mediaRateReference(
          "finalize",
          actor.uid,
          request.data.captureSessionId,
        ),
        { limit: 60, windowMs: 600_000, nowMs: Date.now() },
      );
      return await finalizeFieldMediaCore(
        request.data,
        { uid: actor.uid, role: actor.role },
        finalizeMediaDependencies,
      );
    } catch (error) {
      return rethrowMediaCallableError(error);
    }
  },
);

export const getFieldMediaAccess = onCall<{ mediaId: string }>(
  protectedMediaCallableOptions,
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "field_auth_required");
    }
    rejectConsumedAppCheckToken(request);
    try {
      const actor = await requireFieldActor(request);
      await consumeRateLimit(
        mediaRateReference("mediaAccess", actor.uid, request.data.mediaId),
        { limit: 120, windowMs: 600_000, nowMs: Date.now() },
      );
      return await getFieldMediaAccessCore(
        request.data,
        { uid: actor.uid, role: actor.role },
        mediaAccessDependencies,
      );
    } catch (error) {
      return rethrowMediaCallableError(error);
    }
  },
);

export const excludeFieldMedia = onCall<ExcludeFieldMediaInput>(
  protectedMediaCallableOptions,
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "field_auth_required");
    }
    rejectConsumedAppCheckToken(request);
    try {
      const actor = await requireFieldActor(request);
      await consumeRateLimit(
        mediaRateReference("exclude", actor.uid, request.data.mediaId),
        { limit: 60, windowMs: 600_000, nowMs: Date.now() },
      );
      return await excludeFieldMediaCore(
        request.data,
        { uid: actor.uid, role: actor.role },
        excludeMediaDependencies,
      );
    } catch (error) {
      return rethrowMediaCallableError(error);
    }
  },
);

export const listFieldCaptureWorkspace = onCall<Record<string, never>>(
  protectedMediaCallableOptions,
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "field_auth_required");
    }
    rejectConsumedAppCheckToken(request);
    try {
      const actor = await requireFieldActor(request);
      await consumeRateLimit(
        mediaRateReference(
          "captureWorkspace",
          actor.uid,
          actor.sessionId ?? "current",
        ),
        { limit: 60, windowMs: 600_000, nowMs: Date.now() },
      );
      return await listCaptureWorkspaceCore(
        { uid: actor.uid, role: actor.role },
        captureWorkspaceDependencies,
      );
    } catch (error) {
      return rethrowMediaCallableError(error);
    }
  },
);

export const appendOwnerNote = onCall(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => {
    try {
      const actor = await requireFieldActor(request);
      const note = await appendOwnerNoteCore(
        request.data,
        actor,
        ownerNoteDependencies,
      );
      return { note };
    } catch (error) {
      return rethrowOwnerNoteCallableError(error);
    }
  },
);

export const archiveOwnerNote = onCall(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => {
    try {
      const actor = await requireFieldActor(request);
      return await archiveOwnerNoteCore(
        request.data,
        actor,
        ownerNoteDependencies,
      );
    } catch (error) {
      return rethrowOwnerNoteCallableError(error);
    }
  },
);

function buildingIdsFromWriteValues(
  beforeValue: unknown,
  afterValue: unknown,
): string[] {
  const buildingIds = new Set<string>();
  for (const value of [beforeValue, afterValue]) {
    if (isRecord(value) && isPathSafeId(value.buildingId)) {
      buildingIds.add(value.buildingId);
    }
  }
  return [...buildingIds];
}

export const rebuildMapProjectionOnBuildingWrite = onValueWritten(
  {
    ref: "/fieldPlatform/buildings/{buildingId}",
    instance: "bring-fm-hj-default-rtdb",
    region: "asia-southeast1",
  },
  async (event) => {
    const buildingId = event.params.buildingId;
    if (!isPathSafeId(buildingId)) return;
    const dependencies = projectionDependenciesForEvent(event.time);
    await rebuildMapProjectionForBuilding(
      buildingId,
      dependencies,
    );
  },
);

export const rebuildMapProjectionOnListingWrite = onValueWritten(
  {
    ref: "/fieldPlatform/listings/{listingId}",
    instance: "bring-fm-hj-default-rtdb",
    region: "asia-southeast1",
  },
  async (event) => {
    const buildingIds = buildingIdsFromWriteValues(
      event.data.before.val(),
      event.data.after.val(),
    );
    const dependencies = projectionDependenciesForEvent(event.time);
    await Promise.all(
      buildingIds.map((buildingId) =>
        rebuildMapProjectionForBuilding(
          buildingId,
          dependencies,
        ),
      ),
    );
  },
);

export const rebuildMapProjectionOnMediaWrite = onValueWritten(
  {
    ref: "/fieldPlatform/media/{mediaId}",
    instance: "bring-fm-hj-default-rtdb",
    region: "asia-southeast1",
  },
  async (event) => {
    const buildingIds = buildingIdsFromWriteValues(
      event.data.before.val(),
      event.data.after.val(),
    );
    const dependencies = projectionDependenciesForEvent(event.time);
    await Promise.all(
      buildingIds.map((buildingId) =>
        rebuildMapProjectionForBuilding(
          buildingId,
          dependencies,
        ),
      ),
    );
  },
);

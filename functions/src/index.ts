import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase, ServerValue } from "firebase-admin/database";
import { getStorage } from "firebase-admin/storage";
import {
  onValueCreated,
  onValueWritten,
} from "firebase-functions/v2/database";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  provisionFieldUserCore,
  type FieldRole,
} from "./auth/provision-field-user.js";
import {
  consumeDesktopFieldHandoffCore,
  issueDesktopFieldHandoffCore,
  sha256Base64Url,
  type DesktopHandoffDependencies,
  type DesktopHandoffRecord,
} from "./auth/desktop-field-handoff.js";
import {
  createFinalizedMediaStorageAdapter,
  createGoogleDriveMediaAdapterFromOAuth,
  type FinalizedMediaBucketLike,
} from "./drive/google-drive-adapter.js";
import { readDriveOAuthConfig } from "./drive/google-auth.js";
import { driveRecoveryRange } from "./drive/recovery-key.js";
import {
  DriveSyncRetryableError,
  processDriveSyncJob,
  runDriveSyncRecovery,
  type DriveSyncRuntimeDatabase,
  type DriveSyncRuntimeDependencies,
  type RecoveryJobRecord,
} from "./drive/runtime.js";
import type { DriveMediaAdapter } from "./drive/sync-media.js";
import {
  createAdPackageCore,
  reduceAdPackageCommit,
  type CreateAdPackageDependencies,
  type CreateAdPackageInput,
} from "./packages/create-ad-package.js";
import { adPackageRecoveryRange } from "./packages/generation-recovery-key.js";
import {
  AD_PACKAGE_RECOVERY_LIMIT,
  AdPackageGenerationRetryableError,
  processAdPackageGeneration,
  runAdPackageGenerationRecovery,
  type AdPackageGenerationRuntimeDatabase,
  type AdPackageGenerationRuntimeDependencies,
  type AdPackageRecoveryRecord,
} from "./packages/generation-runtime.js";
import {
  listAdPackageReviewCandidatesCore,
  type ListAdPackageReviewCandidatesDependencies,
} from "./packages/list-ad-package-review-candidates.js";
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
import {
  assertFieldActorCanMutate,
  resolveFieldActorCore,
} from "./field-v2/access.js";
import {
  FIELD_PROTOCOL_VERSION,
  FieldV2Error,
  isFieldRequestId,
  type FieldReleaseClient,
  type FieldReleaseConfiguration,
  type FieldV2Actor,
} from "./field-v2/contracts.js";
import {
  assertFieldReleaseAllows,
  assertFieldReleaseCompatible,
  type FieldReleaseGateDependencies,
} from "./field-v2/release-gate.js";
import {
  assignFieldJobCore,
  changeFieldVisitCore,
  claimFieldJobCore,
  createFieldJobsCore,
  listFieldOperationsWorkspaceCore,
  transitionFieldJobCore,
  type AssignFieldJobInput,
  type ChangeFieldVisitInput,
  type ClaimFieldJobInput,
  type CreateFieldJobsInput,
  type FieldAtomicCreateCommand,
  type FieldAtomicCreateOutcome,
  type FieldMutationReceipt,
  type FieldVisit,
  type FieldWorkItem,
  type FieldWorkTransactionDecision,
  type FieldWorkTransactionSelector,
  type FieldWorkTransactionSnapshot,
  type TransitionFieldJobInput,
  type WorkItemDependencies,
} from "./field-v2/work-items.js";
import { consumeRateLimit } from "./security/rate-limit.js";

if (getApps().length === 0) {
  initializeApp();
}

const adminAuth = getAuth();
const adminDatabase = getDatabase();
const mediaBucket = getStorage().bucket();
const FIELD_ID_BYTES = 128;

const driveClientId = defineSecret("DRIVE_CLIENT_ID");
const driveClientSecret = defineSecret("DRIVE_CLIENT_SECRET");
const driveRefreshToken = defineSecret("DRIVE_REFRESH_TOKEN");
const driveRootFolderId = defineSecret("DRIVE_ROOT_FOLDER_ID");
const driveRootMode = defineSecret("DRIVE_ROOT_MODE");
const driveSecrets = [
  driveClientId,
  driveClientSecret,
  driveRefreshToken,
  driveRootFolderId,
  driveRootMode,
];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldRole(value: unknown): value is FieldRole {
  return value === "admin" || value === "staff" || value === "reviewer";
}

function boundedCallableString(value: unknown, maximumBytes: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("desktop_handoff_invalid");
  }
  return value;
}

function desktopRateKey(value: string): string {
  return sha256Base64Url(value).slice(0, 43);
}

function safeRequestIp(request: CallableRequest<unknown>): string {
  const ip = request.rawRequest?.ip;
  return typeof ip === "string" && ip.length > 0 ? ip.slice(0, 128) : "unknown";
}

function desktopHandoffReference(codeHash: string) {
  return adminDatabase.ref(`fieldPlatform/desktopHandoffs/${codeHash}`);
}

function normalizeDesktopHandoffRecord(value: unknown): DesktopHandoffRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.crmUid !== "string"
    || typeof value.fieldUid !== "string"
    || typeof value.emailHash !== "string"
    || !isFieldRole(value.role)
    || typeof value.displayName !== "string"
    || !Number.isSafeInteger(value.issuedAt)
    || !Number.isSafeInteger(value.expiresAt)
    || (value.usedAt !== null && !Number.isSafeInteger(value.usedAt))
  ) return null;
  return value as unknown as DesktopHandoffRecord;
}

function createDesktopHandoffDependencies(): DesktopHandoffDependencies {
  return {
    now: () => Date.now(),
    randomBytes: (size) => randomBytes(size),
    async getAllowedEmail(emailHash) {
      const snapshot = await adminDatabase
        .ref(`fieldPlatformAllowedEmails/${emailHash}`)
        .get();
      const value = snapshot.val() as { active?: unknown; role?: unknown } | null;
      if (!value || value.active !== true || !isFieldRole(value.role)) return null;
      return { active: true, role: value.role };
    },
    async resolveFieldUser(input) {
      let user;
      try {
        user = await adminAuth.getUserByEmail(input.email);
      } catch (error) {
        const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
        if (code !== "auth/user-not-found") throw error;
        user = await adminAuth.createUser({
          email: input.email,
          emailVerified: true,
          displayName: input.displayName || undefined,
        });
      }
      await adminAuth.setCustomUserClaims(user.uid, {
        ...user.customClaims,
        fieldPlatform: true,
        fieldRole: input.role,
      });
      await adminDatabase.ref(`fieldPlatform/users/${user.uid}`).update({
        role: input.role,
        enabled: true,
        displayName: input.displayName,
        updatedAt: ServerValue.TIMESTAMP,
      });
      return user.uid;
    },
    async save(codeHash, record) {
      await desktopHandoffReference(codeHash).set(record);
    },
    async consume(codeHash, now) {
      let rejection = "desktop_handoff_invalid";
      const transaction = await desktopHandoffReference(codeHash).transaction(
        (current) => {
          const record = normalizeDesktopHandoffRecord(current);
          if (!record) {
            rejection = "desktop_handoff_invalid";
            return undefined;
          }
          if (record.usedAt !== null) {
            rejection = "desktop_handoff_used";
            return undefined;
          }
          if (record.expiresAt <= now) {
            rejection = "desktop_handoff_expired";
            return undefined;
          }
          return { ...record, usedAt: now };
        },
        undefined,
        false,
      );
      if (!transaction.committed) throw new Error(rejection);
      const record = normalizeDesktopHandoffRecord(transaction.snapshot.val());
      if (!record) throw new Error("desktop_handoff_invalid");
      return record;
    },
    async createCustomToken(uid, claims) {
      return adminAuth.createCustomToken(uid, claims);
    },
  };
}

function rethrowDesktopHandoffError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message === "field_rate_limit_exceeded") {
    throw new HttpsError("resource-exhausted", "desktop_handoff_rate_limited");
  }
  if (message === "desktop_handoff_expired") {
    throw new HttpsError("deadline-exceeded", "desktop_handoff_expired");
  }
  if (message === "desktop_handoff_not_allowed") {
    throw new HttpsError("permission-denied", "desktop_handoff_not_allowed");
  }
  if (message === "desktop_handoff_email_unverified") {
    throw new HttpsError("unauthenticated", "desktop_handoff_email_unverified");
  }
  if (
    message === "desktop_handoff_invalid"
    || message === "desktop_handoff_used"
    || message === "desktop_handoff_invalid_identity"
  ) {
    throw new HttpsError("failed-precondition", "desktop_handoff_invalid");
  }
  throw new HttpsError("internal", "desktop_handoff_unavailable");
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

function snapshotKeyedValues(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).map(([key, record]) => ({ key, value: record }));
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

type FieldV2CallableData = Record<string, unknown> & {
  protocolVersion?: unknown;
  clientKind?: unknown;
  buildVersion?: unknown;
  operatorId?: unknown;
  requestId?: unknown;
};

function requireFieldV2Data(value: unknown): FieldV2CallableData {
  if (!isRecord(value)) throw new FieldV2Error("field_work_input_invalid");
  return value as FieldV2CallableData;
}

async function requireFieldV2Actor(
  request: CallableRequest<unknown>,
  data: FieldV2CallableData,
): Promise<FieldV2Actor> {
  const authUid = request.auth?.uid;
  const authenticatedEmail = request.auth?.token.email;
  const emailVerified = request.auth?.token.email_verified;
  if (
    !isPathSafeId(authUid)
    || typeof authenticatedEmail !== "string"
    || emailVerified !== true
  ) {
    throw new FieldV2Error("field_access_forbidden");
  }
  return resolveFieldActorCore({
    authUid,
    operatorId: data.operatorId as string,
  }, {
    authenticatedEmail,
    async read(path) {
      return (await adminDatabase.ref(path).get()).val();
    },
  });
}

function fieldV2ReleaseClient(data: FieldV2CallableData): FieldReleaseClient {
  return {
    protocolVersion: data.protocolVersion as number,
    clientKind: data.clientKind as FieldReleaseClient["clientKind"],
    buildVersion: data.buildVersion as string,
    operatorId: data.operatorId as string,
  };
}

async function readFieldV2ReleaseConfiguration(): Promise<FieldReleaseConfiguration> {
  let value: unknown;
  try {
    value = (await adminDatabase.ref("fieldPlatform/v2/config/release").get()).val();
  } catch {
    throw new FieldV2Error("field_release_unavailable");
  }
  if (!isRecord(value)) throw new FieldV2Error("field_release_config_invalid");
  return value as unknown as FieldReleaseConfiguration;
}

function fieldV2ReleaseDependencies(): FieldReleaseGateDependencies {
  return {
    async readReceipt({ scope, requestId }) {
      return (await adminDatabase
        .ref(`fieldPlatform/v2/requestReceipts/${scope}/${requestId}`)
        .get()).val();
    },
    async readUploadRecovery(uploadJobId) {
      return (await adminDatabase
        .ref(`fieldPlatform/v2/uploadJobs/${uploadJobId}`)
        .get()).val();
    },
  };
}

async function prepareFieldV2Request(
  request: CallableRequest<unknown>,
  operationKind:
    | "createJob"
    | "claimJob"
    | "assignJob"
    | "changeVisit"
    | "transitionJob"
    | "read",
): Promise<{
  actor: FieldV2Actor;
  config: FieldReleaseConfiguration;
  data: FieldV2CallableData;
}> {
  const data = requireFieldV2Data(request.data);
  if (operationKind !== "read" && !isFieldRequestId(data.requestId)) {
    throw new FieldV2Error("field_request_id_invalid");
  }
  const actor = await requireFieldV2Actor(request, data);
  if (operationKind !== "read") assertFieldActorCanMutate(actor);
  const config = await readFieldV2ReleaseConfiguration();
  assertFieldReleaseCompatible(config, fieldV2ReleaseClient(data));
  if (operationKind === "read") {
    await assertFieldReleaseAllows(
      config,
      { kind: "read" },
      fieldV2ReleaseDependencies(),
    );
  }
  return { actor, config, data };
}

const FIELD_V2_INVALID_ERRORS = new Set([
  "field_work_input_invalid",
  "field_request_id_invalid",
  "field_operator_invalid",
  "field_operator_mismatch",
  "field_parent_reference_invalid",
  "field_unit_references_invalid",
  "field_unit_references_duplicate",
  "field_due_date_invalid",
  "field_priority_invalid",
  "field_job_type_invalid",
  "field_assignee_invalid",
  "field_change_reason_required",
  "field_visit_change_empty",
  "field_release_config_invalid",
  "field_release_operation_invalid",
  "field_client_invalid",
  "field_client_kind_invalid",
  "field_build_version_invalid",
]);
const FIELD_V2_PERMISSION_ERRORS = new Set([
  "field_access_forbidden",
  "field_mutation_forbidden",
  "field_operator_inactive",
  "field_operator_not_enabled",
  "field_job_operator_forbidden",
]);
const FIELD_V2_NOT_FOUND_ERRORS = new Set([
  "field_job_not_found",
  "field_visit_not_found",
  "field_crm_reference_not_found",
]);
const FIELD_V2_CONFLICT_ERRORS = new Set([
  "field_request_id_conflict",
  "field_job_already_claimed",
  "field_assignment_unchanged",
]);
const FIELD_V2_UNAVAILABLE_ERRORS = new Set([
  "field_release_unavailable",
  "field_workspace_unavailable",
  "field_workspace_invalid",
  "field_crm_reference_unavailable",
]);
const FIELD_V2_PRECONDITION_ERRORS = new Set([
  "field_safe_mode_read_only",
  "field_v2_writes_disabled",
  "field_protocol_mismatch",
  "field_client_upgrade_required",
  "field_client_version_unsupported",
  "field_transition_invalid",
  "field_inspection_outcome_invalid",
  "field_review_action_required",
  "field_assignment_action_required",
  "field_assignment_required",
  "field_job_inactive",
  "field_started_job_change_forbidden",
  "field_crm_reference_archived",
  "field_crm_reference_mismatch",
  "field_crm_reference_changed",
  "field_crm_reference_adapter_unavailable",
  "field_request_receipt_invalid",
]);

function rethrowFieldV2CallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const code = error instanceof FieldV2Error
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
  if (FIELD_V2_INVALID_ERRORS.has(code)) {
    throw new HttpsError("invalid-argument", code);
  }
  if (FIELD_V2_PERMISSION_ERRORS.has(code)) {
    throw new HttpsError("permission-denied", code);
  }
  if (FIELD_V2_NOT_FOUND_ERRORS.has(code)) {
    throw new HttpsError("not-found", code);
  }
  if (FIELD_V2_CONFLICT_ERRORS.has(code)) {
    throw new HttpsError("already-exists", code);
  }
  if (FIELD_V2_UNAVAILABLE_ERRORS.has(code)) {
    throw new HttpsError("unavailable", code);
  }
  if (FIELD_V2_PRECONDITION_ERRORS.has(code)) {
    throw new HttpsError("failed-precondition", code);
  }
  throw new HttpsError("internal", "field_v2_internal");
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

function rethrowAdPackageCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "ad_package_unknown";
  if (message === "field_rate_limit_exceeded") {
    throw new HttpsError("resource-exhausted", message);
  }
  if (
    message === "ad_package_invalid"
    || message === "ad_review_candidates_invalid"
    || message === "ad_package_representative_media_invalid"
    || message === "ad_package_approved_media_invalid"
  ) {
    throw new HttpsError("invalid-argument", message);
  }
  if (message === "ad_package_forbidden") {
    throw new HttpsError("permission-denied", message);
  }
  if (message === "ad_package_request_conflict") {
    throw new HttpsError("already-exists", message);
  }
  if (
    message === "ad_package_listing_incomplete"
    || message === "ad_package_listing_not_approved"
    || message === "ad_package_required_media_missing"
    || message === "ad_package_capture_session_invalid"
    || message === "ad_package_media_state_invalid"
  ) {
    throw new HttpsError("failed-precondition", message);
  }
  throw new HttpsError("internal", "ad_package_internal");
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

const adPackageDependencies: CreateAdPackageDependencies = {
  isEnabled: isEnabledFieldUser,
  async commit(input) {
    const reference = adminDatabase.ref("fieldPlatform");
    const transaction = await reference.transaction(
      (current) => {
        const decision = reduceAdPackageCommit(current, input);
        return decision.write ? decision.state : undefined;
      },
      undefined,
      false,
    );
    const finalDecision = reduceAdPackageCommit(
      transaction.snapshot.val(),
      input,
    );
    if (transaction.committed && finalDecision.status === "alreadyCommitted") {
      return {
        status: "committed",
        write: true,
        state: transaction.snapshot.val(),
        result: finalDecision.result,
      };
    }
    return finalDecision;
  },
  now: () => new Date().toISOString(),
};

const adReviewCandidateDependencies: ListAdPackageReviewCandidatesDependencies = {
  isEnabled: isEnabledFieldUser,
  async listListingsByStatus(status, limit, cursor) {
    let query = adminDatabase
      .ref("fieldPlatform/listings")
      .orderByChild("status");
    query = cursor === undefined
      ? query.equalTo(status)
      : query.startAfter(status, cursor).endAt(status);
    const snapshot = await query.limitToFirst(limit).get();
    return snapshotKeyedValues(snapshot.val());
  },
  readBuilding: (buildingId) => readFieldRecord(
    `fieldPlatform/buildings/${buildingId}`,
  ),
  readUnit: (unitId) => readFieldRecord(`fieldPlatform/units/${unitId}`),
  async listMediaByListing(listingId, limit) {
    const snapshot = await adminDatabase
      .ref("fieldPlatform/media")
      .orderByChild("listingId")
      .equalTo(listingId)
      .limitToFirst(limit)
      .get();
    return snapshotValues<unknown>(snapshot.val());
  },
  async listMediaByBuilding(buildingId, limit) {
    const snapshot = await adminDatabase
      .ref("fieldPlatform/media")
      .orderByChild("buildingId")
      .equalTo(buildingId)
      .limitToFirst(limit)
      .get();
    return snapshotValues<unknown>(snapshot.val());
  },
  readCaptureSession: (captureSessionId) => readFieldRecord(
    `fieldPlatform/captureSessions/${captureSessionId}`,
  ),
  async listPackagesByListing(listingId, limit) {
    const snapshot = await adminDatabase
      .ref("fieldPlatform/adPackages")
      .orderByChild("listingId")
      .equalTo(listingId)
      .limitToLast(limit)
      .get();
    return snapshotValues<unknown>(snapshot.val());
  },
  readLatestPackageId: (listingId) => readFieldRecord(
    `fieldPlatform/adPackageLatest/${listingId}`,
  ),
  readPackage: (packageId) => readFieldRecord(
    `fieldPlatform/adPackages/${packageId}`,
  ),
};

const driveSyncRuntimeDatabase: DriveSyncRuntimeDatabase = {
  async transactionRoot(update) {
    const transaction = await adminDatabase.ref("fieldPlatform").transaction(
      update,
      undefined,
      false,
    );
    return {
      committed: transaction.committed,
      state: transaction.snapshot.val(),
    };
  },
  async listRecoveryJobs(input) {
    const reference = adminDatabase.ref("fieldPlatform/driveSyncJobs");
    const range = input.kind === "queued"
      ? driveRecoveryRange("queued")
      : driveRecoveryRange(
        input.kind === "failedDue" ? "failed" : "syncing",
        input.dueAtOrBefore,
      );
    const query = reference
      .orderByChild("recoveryKey")
      .startAt(range.startAt)
      .endAt(range.endAt)
      .limitToFirst(input.limit);
    const snapshot = await query.get();
    const value: unknown = snapshot.val();
    if (!isRecord(value)) return [];
    return Object.entries(value).map(([id, job]): RecoveryJobRecord => ({
      id,
      value: job,
    }));
  },
};

function createDriveSyncRuntimeDependencies(
  now: () => string = () => new Date().toISOString(),
): DriveSyncRuntimeDependencies {
  let config: ReturnType<typeof readDriveOAuthConfig> | undefined;
  const readConfig = () => {
    config ??= readDriveOAuthConfig({
      DRIVE_CLIENT_ID: driveClientId.value(),
      DRIVE_CLIENT_SECRET: driveClientSecret.value(),
      DRIVE_REFRESH_TOKEN: driveRefreshToken.value(),
      DRIVE_ROOT_FOLDER_ID: driveRootFolderId.value(),
      DRIVE_ROOT_MODE: driveRootMode.value(),
    });
    return config;
  };
  let validatedDrive: Promise<ReturnType<
    typeof createGoogleDriveMediaAdapterFromOAuth
  >> | undefined;
  const resolveDrive = () => {
    validatedDrive ??= (async () => {
      const currentConfig = readConfig();
      const adapter = createGoogleDriveMediaAdapterFromOAuth(currentConfig);
      await adapter.validateRootFolder({
        rootFolderId: currentConfig.rootFolderId,
        rootMode: currentConfig.rootMode,
      });
      return adapter;
    })();
    return validatedDrive;
  };
  const drive: DriveMediaAdapter = {
    async listExactFolders(input) {
      return (await resolveDrive()).listExactFolders(input);
    },
    async createFolder(input) {
      return (await resolveDrive()).createFolder(input);
    },
    async listExactMediaFiles(input) {
      return (await resolveDrive()).listExactMediaFiles(input);
    },
    async uploadMediaFile(input) {
      return (await resolveDrive()).uploadMediaFile(input);
    },
    async startResumableMediaUpload(input) {
      return (await resolveDrive()).startResumableMediaUpload(input);
    },
    async probeResumableMediaUpload(input) {
      return (await resolveDrive()).probeResumableMediaUpload(input);
    },
    async uploadResumableMediaChunk(input) {
      return (await resolveDrive()).uploadResumableMediaChunk(input);
    },
  };
  return {
    database: driveSyncRuntimeDatabase,
    storage: createFinalizedMediaStorageAdapter(
      mediaBucket as unknown as FinalizedMediaBucketLike,
    ),
    drive,
    get rootFolderId() {
      return readConfig().rootFolderId;
    },
    now,
    randomToken: () => randomUUID(),
  };
}

const adPackageGenerationRuntimeDatabase: AdPackageGenerationRuntimeDatabase = {
  async transactionRoot(update) {
    const transaction = await adminDatabase.ref("fieldPlatform").transaction(
      update,
      undefined,
      false,
    );
    return {
      committed: transaction.committed,
      state: transaction.snapshot.val(),
    };
  },
  async listRecoveryPackages(input) {
    const status = input.kind === "reviewed"
      ? "reviewed"
      : input.kind === "failedDue"
        ? "failed"
        : "generating";
    const range = adPackageRecoveryRange(status, input.dueAtOrBefore);
    const snapshot = await adminDatabase
      .ref("fieldPlatform/adPackages")
      .orderByChild("generation/recoveryKey")
      .startAt(range.startAt)
      .endAt(range.endAt)
      .limitToFirst(Math.min(input.limit, AD_PACKAGE_RECOVERY_LIMIT))
      .get();
    const value: unknown = snapshot.val();
    if (!isRecord(value)) return [];
    return Object.entries(value).map(([id, pkg]): AdPackageRecoveryRecord => ({
      id,
      value: pkg,
    }));
  },
};

function createAdPackageGenerationRuntimeDependencies(
  now: () => string = () => new Date().toISOString(),
): AdPackageGenerationRuntimeDependencies {
  let config: ReturnType<typeof readDriveOAuthConfig> | undefined;
  const readConfig = () => {
    config ??= readDriveOAuthConfig({
      DRIVE_CLIENT_ID: driveClientId.value(),
      DRIVE_CLIENT_SECRET: driveClientSecret.value(),
      DRIVE_REFRESH_TOKEN: driveRefreshToken.value(),
      DRIVE_ROOT_FOLDER_ID: driveRootFolderId.value(),
      DRIVE_ROOT_MODE: driveRootMode.value(),
    });
    return config;
  };
  let validatedDrive: Promise<ReturnType<
    typeof createGoogleDriveMediaAdapterFromOAuth
  >> | undefined;
  const resolveDrive = () => {
    validatedDrive ??= (async () => {
      const currentConfig = readConfig();
      const adapter = createGoogleDriveMediaAdapterFromOAuth(currentConfig);
      await adapter.validateRootFolder({
        rootFolderId: currentConfig.rootFolderId,
        rootMode: currentConfig.rootMode,
      });
      return adapter;
    })();
    return validatedDrive;
  };
  return {
    database: adPackageGenerationRuntimeDatabase,
    resolveDrive,
    now,
    randomToken: () => randomUUID(),
  };
}

function mediaRateReference(
  operation:
    | "finalize"
    | "mediaAccess"
    | "exclude"
    | "captureWorkspace"
    | "createPackage"
    | "reviewCandidates",
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

function readNestedRecord(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return current ?? null;
}

function writeNestedRecord(
  root: UnknownRecord,
  path: readonly string[],
  value: unknown,
): void {
  if (path.length === 0) throw new FieldV2Error("field_work_patch_invalid");
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const child = current[segment];
    if (!isRecord(child)) current[segment] = {};
    current = current[segment] as UnknownRecord;
  }
  current[path[path.length - 1]] = value;
}

function applyRootPatch(current: unknown, patch: Readonly<Record<string, unknown>>): UnknownRecord {
  const next: UnknownRecord = isRecord(current)
    ? structuredClone(current)
    : {};
  for (const [rawPath, value] of Object.entries(patch)) {
    const path = rawPath.split("/").filter(Boolean);
    if (path.length === 0 || path.some((segment) => !isPathSafeId(segment))) {
      throw new FieldV2Error("field_work_patch_invalid");
    }
    writeNestedRecord(next, path, value);
  }
  return next;
}

function parseReceipt(value: unknown): FieldMutationReceipt | null {
  if (
    !isRecord(value)
    || typeof value.scope !== "string"
    || typeof value.requestId !== "string"
    || typeof value.requestHash !== "string"
  ) return null;
  return value as unknown as FieldMutationReceipt;
}

function currentCrmSourceMatches(
  root: unknown,
  expectation: FieldAtomicCreateCommand["sourceExpectations"][number],
): boolean {
  const value = readNestedRecord(root, expectation.path.split("/").filter(Boolean));
  if (
    !isRecord(value)
    || value.id !== expectation.id
    || value.updatedAt !== expectation.updatedAt
    || (value.archivedAt !== undefined
      && value.archivedAt !== null
      && value.archivedAt !== "")
  ) return false;
  if (expectation.parentField && expectation.parentId) {
    if (expectation.parentField === "prospectId") {
      return (value.prospectId ?? value.crmSalesProspectId) === expectation.parentId;
    }
    return value[expectation.parentField] === expectation.parentId;
  }
  return true;
}

function currentOperatorsAreActive(
  root: unknown,
  operatorIds: readonly string[] | undefined,
): boolean {
  return (operatorIds ?? []).every((operatorId) => {
    const value = readNestedRecord(root, [
      "crmCompany", "teamProfiles", operatorId,
    ]);
    return isRecord(value) && value.active === true;
  });
}

async function runFieldRootTransaction<Result>(
  selector: FieldWorkTransactionSelector,
  decide: (
    snapshot: FieldWorkTransactionSnapshot,
  ) => FieldWorkTransactionDecision<Result>,
): Promise<Result> {
  let chosen: FieldWorkTransactionDecision<Result> | null = null;
  const transaction = await adminDatabase.ref().transaction(
    (current) => {
      const selectedItem = selector.jobId
        ? readNestedRecord(current, ["fieldPlatform", "v2", "workItems", selector.jobId])
        : null;
      const itemVisitId = isRecord(selectedItem) && typeof selectedItem.visitId === "string"
        ? selectedItem.visitId
        : undefined;
      const visitId = selector.visitId ?? itemVisitId;
      const visit = visitId
        ? readNestedRecord(current, ["fieldPlatform", "v2", "visits", visitId])
        : null;
      const visitIds = isRecord(visit) && Array.isArray(visit.workItemIds)
        ? visit.workItemIds.filter((id): id is string => typeof id === "string")
        : [];
      const receiptValue = readNestedRecord(current, [
        "fieldPlatform",
        "v2",
        "requestReceipts",
        selector.scope,
        selector.requestId,
      ]);
      const currentReceipt = parseReceipt(receiptValue);
      if (receiptValue !== null && receiptValue !== undefined && !currentReceipt) {
        chosen = { errorCode: "field_request_receipt_invalid" };
        return undefined;
      }
      if (currentReceipt && currentReceipt.requestHash !== selector.requestHash) {
        chosen = { errorCode: "field_request_id_conflict" };
        return undefined;
      }
      if (!currentReceipt && selector.newMutationBlockedCode) {
        chosen = { errorCode: selector.newMutationBlockedCode };
        return undefined;
      }
      const item = selectedItem ?? (visitIds.length > 0
        ? readNestedRecord(current, [
          "fieldPlatform", "v2", "workItems", visitIds[0],
        ])
        : null);
      if (!currentOperatorsAreActive(current, selector.requiredActiveOperatorIds)) {
        chosen = { errorCode: "field_assignee_invalid" };
        return undefined;
      }
      chosen = decide({
        workItem: item as FieldWorkItem | null,
        visit: visit as FieldVisit | null,
        visitWorkItems: visitIds.map((id) => readNestedRecord(current, [
          "fieldPlatform", "v2", "workItems", id,
        ]) as FieldWorkItem),
        receipt: currentReceipt,
      });
      if ("errorCode" in chosen) return undefined;
      if ("replay" in chosen) return undefined;
      return applyRootPatch(current, chosen.patch);
    },
    undefined,
    false,
  );
  const finalChoice = chosen as FieldWorkTransactionDecision<Result> | null;
  if (!finalChoice) throw new FieldV2Error("field_work_transaction_failed");
  if ("errorCode" in finalChoice) throw new FieldV2Error(finalChoice.errorCode);
  if ("replay" in finalChoice) return finalChoice.result;
  if (!transaction.committed) throw new FieldV2Error("field_work_transaction_failed");
  return finalChoice.result;
}

const baseFieldV2WorkDependencies: WorkItemDependencies = {
  now: () => new Date().toISOString(),
  async readCrmBuilding(id) {
    return (await adminDatabase.ref(`crmCompany/data/buildings/${id}`).get()).val();
  },
  async readCrmSalesProspect(id) {
    return (await adminDatabase.ref(`crmCompany/data/salesProspects/${id}`).get()).val();
  },
  async readCrmBuildingUnit(id) {
    return (await adminDatabase.ref(`crmCompany/data/buildingUnits/${id}`).get()).val();
  },
  async readCrmSalesUnit(id) {
    return (await adminDatabase.ref(`crmCompany/data/salesUnits/${id}`).get()).val();
  },
  async readOperator(id) {
    const value: unknown = (await adminDatabase
      .ref(`crmCompany/teamProfiles/${id}`)
      .get()).val();
    return isRecord(value) ? { id, ...value } : value;
  },
  async commitCreation(command: FieldAtomicCreateCommand): Promise<FieldAtomicCreateOutcome> {
    let outcome: FieldAtomicCreateOutcome | null = null;
    const receiptSegments = command.receiptPath.split("/").filter(Boolean);
    const transaction = await adminDatabase.ref().transaction(
      (current) => {
        const stored = parseReceipt(readNestedRecord(current, receiptSegments));
        if (stored && stored.requestHash !== command.requestHash) {
          outcome = { kind: "conflict" };
          return undefined;
        }
        if (stored) {
          outcome = {
            kind: "replayed",
            result: stored.result as FieldAtomicCreateCommand["result"],
          };
          return undefined;
        }
        if (command.newMutationBlockedCode) {
          throw new FieldV2Error(command.newMutationBlockedCode);
        }
        if (!command.sourceExpectations.every((expectation) =>
          currentCrmSourceMatches(current, expectation))) {
          throw new FieldV2Error("field_crm_reference_changed");
        }
        if (!currentOperatorsAreActive(current, command.requiredActiveOperatorIds)) {
          throw new FieldV2Error("field_assignee_invalid");
        }
        outcome = { kind: "created", result: command.result };
        return applyRootPatch(current, command.patch);
      },
      undefined,
      false,
    );
    const finalOutcome = outcome as FieldAtomicCreateOutcome | null;
    if (!finalOutcome) throw new FieldV2Error("field_creation_transaction_failed");
    if (finalOutcome.kind === "created" && !transaction.committed) {
      throw new FieldV2Error("field_creation_transaction_failed");
    }
    return finalOutcome;
  },
  transactWork: runFieldRootTransaction,
  async readWorkspace(actor) {
    const projectionPath = `fieldPlatform/v2/projections/operatorJobs/${actor.operatorId}`;
    const [mine, unassigned] = await Promise.all([
      adminDatabase.ref(projectionPath).get(),
      adminDatabase.ref("fieldPlatform/v2/projections/unassigned").get(),
    ]);
    const ids = new Set<string>();
    for (const value of [mine?.val(), unassigned?.val()]) {
      if (value === null || value === undefined) continue;
      if (!isRecord(value)) throw new FieldV2Error("field_workspace_invalid");
      for (const [key, projection] of Object.entries(value)) {
        if (!isRecord(projection) || projection.fieldJobId !== key) {
          throw new FieldV2Error("field_workspace_invalid");
        }
        ids.add(key);
      }
    }
    const items = await Promise.all([...ids].sort().map(async (id) =>
      (await adminDatabase.ref(`fieldPlatform/v2/workItems/${id}`).get()).val(),
    ));
    return { items: items as FieldWorkItem[] };
  },
};

function fieldV2WorkDependenciesFor(
  config: FieldReleaseConfiguration,
  operationKind:
    | "createJob"
    | "claimJob"
    | "assignJob"
    | "changeVisit"
    | "transitionJob"
    | "read",
): WorkItemDependencies {
  const releaseDependencies = fieldV2ReleaseDependencies();
  const newMutationBlockedCode = config.safeMode
    ? "field_safe_mode_read_only" as const
    : !config.v2WritesEnabled
      ? "field_v2_writes_disabled" as const
      : undefined;
  const assertOperation = async (
    scope: string,
    requestId: string,
    requestHash: string,
  ): Promise<void> => {
    let stored: unknown;
    try {
      stored = await releaseDependencies.readReceipt({ scope, requestId });
    } catch {
      throw new FieldV2Error("field_release_unavailable");
    }
    if (stored !== null && stored !== undefined) {
      if (
        !isRecord(stored)
        || stored.scope !== scope
        || stored.requestId !== requestId
        || typeof stored.requestHash !== "string"
      ) {
        throw new FieldV2Error("field_request_receipt_invalid");
      }
      if (stored.requestHash !== requestHash) {
        throw new FieldV2Error("field_request_id_conflict");
      }
      await assertFieldReleaseAllows(config, {
        kind: "receiptReplay",
        scope,
        requestId,
        requestHash,
      }, releaseDependencies);
      return;
    }
    if (operationKind === "read") {
      await assertFieldReleaseAllows(config, { kind: "read" }, releaseDependencies);
      return;
    }
    if (newMutationBlockedCode) return;
    await assertFieldReleaseAllows(config, {
      kind: operationKind,
      requestId,
    }, releaseDependencies);
  };
  return {
    ...baseFieldV2WorkDependencies,
    async commitCreation(command) {
      await assertOperation(
        "createFieldJobs",
        command.requestId,
        command.requestHash,
      );
      return baseFieldV2WorkDependencies.commitCreation({
        ...command,
        ...(newMutationBlockedCode === undefined ? {} : { newMutationBlockedCode }),
      });
    },
    async transactWork(selector, decide) {
      await assertOperation(
        selector.scope,
        selector.requestId,
        selector.requestHash,
      );
      return baseFieldV2WorkDependencies.transactWork({
        ...selector,
        ...(newMutationBlockedCode === undefined ? {} : { newMutationBlockedCode }),
      }, decide);
    },
  };
}

const desktopHandoffCallableOptions = {
  region: "asia-northeast3" as const,
  cors: [
    "https://bring-fm.web.app",
    "https://bring-fm.firebaseapp.com",
  ],
};

export const createDesktopFieldHandoff = onCall<{ crmIdToken: string }>(
  desktopHandoffCallableOptions,
  async (request) => {
    try {
      const requestIp = safeRequestIp(request);
      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/desktopHandoffRateLimits/create-ip/${desktopRateKey(requestIp)}`,
        ),
        { limit: 30, windowMs: 600_000, nowMs: Date.now() },
      );
      const crmIdToken = boundedCallableString(request.data?.crmIdToken, 12_000);
      const decoded = await adminAuth.verifyIdToken(crmIdToken);
      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/desktopHandoffRateLimits/create-user/${desktopRateKey(decoded.uid)}`,
        ),
        { limit: 30, windowMs: 600_000, nowMs: Date.now() },
      );
      return await issueDesktopFieldHandoffCore(
        {
          crmUid: decoded.uid,
          email: typeof decoded.email === "string" ? decoded.email : "",
          emailVerified: decoded.email_verified === true,
          displayName: typeof decoded.name === "string" ? decoded.name : "",
        },
        createDesktopHandoffDependencies(),
      );
    } catch (error) {
      return rethrowDesktopHandoffError(error);
    }
  },
);

export const exchangeDesktopFieldHandoff = onCall<{ code: string }>(
  desktopHandoffCallableOptions,
  async (request) => {
    try {
      const code = boundedCallableString(request.data?.code, 64);
      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/desktopHandoffRateLimits/exchange/${desktopRateKey(`${safeRequestIp(request)}:${sha256Base64Url(code)}`)}`,
        ),
        { limit: 20, windowMs: 600_000, nowMs: Date.now() },
      );
      return await consumeDesktopFieldHandoffCore(
        { code },
        createDesktopHandoffDependencies(),
      );
    } catch (error) {
      return rethrowDesktopHandoffError(error);
    }
  },
);

export const cleanupDesktopFieldHandoffs = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
  },
  async () => {
    const snapshot = await adminDatabase
      .ref("fieldPlatform/desktopHandoffs")
      .orderByChild("expiresAt")
      .endAt(Date.now())
      .limitToFirst(500)
      .get();
    const patch: Record<string, null> = {};
    snapshot.forEach((child) => {
      if (child.key) patch[child.key] = null;
    });
    if (Object.keys(patch).length > 0) {
      await adminDatabase.ref("fieldPlatform/desktopHandoffs").update(patch);
    }
  },
);

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

const fieldV2CallableOptions = {
  region: "asia-northeast3" as const,
  enforceAppCheck: true,
};

export const createFieldJobs = onCall<CreateFieldJobsInput & FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const { actor, config, data } = await prepareFieldV2Request(request, "createJob");
      return await createFieldJobsCore(
        data as unknown as CreateFieldJobsInput,
        actor,
        fieldV2WorkDependenciesFor(config, "createJob"),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
    }
  },
);

export const claimFieldJob = onCall<ClaimFieldJobInput & FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const { actor, config, data } = await prepareFieldV2Request(request, "claimJob");
      return await claimFieldJobCore(
        data as unknown as ClaimFieldJobInput,
        actor,
        fieldV2WorkDependenciesFor(config, "claimJob"),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
    }
  },
);

export const assignFieldJob = onCall<AssignFieldJobInput & FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const { actor, config, data } = await prepareFieldV2Request(request, "assignJob");
      return await assignFieldJobCore(
        data as unknown as AssignFieldJobInput,
        actor,
        fieldV2WorkDependenciesFor(config, "assignJob"),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
    }
  },
);

export const changeFieldVisit = onCall<ChangeFieldVisitInput & FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const { actor, config, data } = await prepareFieldV2Request(request, "changeVisit");
      return await changeFieldVisitCore(
        data as unknown as ChangeFieldVisitInput,
        actor,
        fieldV2WorkDependenciesFor(config, "changeVisit"),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
    }
  },
);

export const transitionFieldJob = onCall<TransitionFieldJobInput & FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const { actor, config, data } = await prepareFieldV2Request(request, "transitionJob");
      return await transitionFieldJobCore(
        data as unknown as TransitionFieldJobInput,
        actor,
        fieldV2WorkDependenciesFor(config, "transitionJob"),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
    }
  },
);

export const listFieldOperationsWorkspace = onCall<FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const { actor, config } = await prepareFieldV2Request(request, "read");
      return await listFieldOperationsWorkspaceCore(
        actor,
        fieldV2WorkDependenciesFor(config, "read"),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
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

export const createAdPackage = onCall<CreateAdPackageInput>(
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
          "createPackage",
          actor.uid,
          actor.sessionId ?? "current",
        ),
        { limit: 30, windowMs: 600_000, nowMs: Date.now() },
      );
      return await createAdPackageCore(
        request.data,
        { uid: actor.uid, role: actor.role },
        adPackageDependencies,
      );
    } catch (error) {
      return rethrowAdPackageCallableError(error);
    }
  },
);

export const listAdPackageReviewCandidates = onCall<
  undefined | { cursor?: string }
>(
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
          "reviewCandidates",
          actor.uid,
          actor.sessionId ?? "current",
        ),
        { limit: 60, windowMs: 600_000, nowMs: Date.now() },
      );
      return await listAdPackageReviewCandidatesCore(
        request.data,
        { uid: actor.uid, role: actor.role },
        adReviewCandidateDependencies,
      );
    } catch (error) {
      return rethrowAdPackageCallableError(error);
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

export const syncFieldMediaToDrive = onValueCreated(
  {
    ref: "/fieldPlatform/driveSyncJobs/{jobId}",
    instance: "bring-fm-hj-default-rtdb",
    region: "asia-southeast1",
    retry: true,
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 10,
    concurrency: 4,
    secrets: driveSecrets,
  },
  async (event) => {
    const dependencies = createDriveSyncRuntimeDependencies();
    try {
      await processDriveSyncJob(event.params.jobId, dependencies);
    } catch (error) {
      if (error instanceof DriveSyncRetryableError) throw error;
      throw new Error("drive_sync_runtime_failed");
    }
  },
);

export const recoverFieldMediaDriveSync = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Asia/Seoul",
    region: "asia-southeast1",
    retryCount: 0,
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
    concurrency: 1,
    secrets: driveSecrets,
  },
  async () => {
    const dependencies = createDriveSyncRuntimeDependencies();
    try {
      await runDriveSyncRecovery(dependencies);
    } catch {
      throw new Error("drive_recovery_failed");
    }
  },
);

export const generateFieldAdPackageToDrive = onValueCreated(
  {
    ref: "/fieldPlatform/adPackages/{packageId}",
    instance: "bring-fm-hj-default-rtdb",
    region: "asia-southeast1",
    retry: true,
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 5,
    concurrency: 2,
    secrets: driveSecrets,
  },
  async (event) => {
    const dependencies = createAdPackageGenerationRuntimeDependencies();
    try {
      await processAdPackageGeneration(event.params.packageId, dependencies);
    } catch (error) {
      if (error instanceof AdPackageGenerationRetryableError) throw error;
      throw new Error("ad_package_generation_runtime_failed");
    }
  },
);

export const recoverFieldAdPackageGeneration = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Asia/Seoul",
    region: "asia-southeast1",
    retryCount: 0,
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
    concurrency: 1,
    secrets: driveSecrets,
  },
  async () => {
    const dependencies = createAdPackageGenerationRuntimeDependencies();
    try {
      await runAdPackageGenerationRecovery(dependencies);
    } catch {
      throw new Error("ad_package_generation_recovery_failed");
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

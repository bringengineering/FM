import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
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
  onRequest,
  type CallableRequest,
} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  authorizeBillingActor,
  auditBillingLedger,
  transactBillingLedger,
  type BillingMutationCommand,
} from "./billing-ledger-mutation.js";
import {
  createCleaningOrderCore,
  transitionCleaningOrderCore,
} from "./cleaning-orders/runtime.js";
import { createCleaningOrderFirebaseDependencies } from "./cleaning-orders/firebase-adapter.js";
import { createCleaningQuoteRevisionCore, reviewCleaningQuoteCore } from "./cleaning-orders/quotes.js";
import { validateStoredCleaningOrder } from "./cleaning-orders/core.js";
import { createCleaningPartnerFirebaseDependencies } from "./cleaning-partners/firebase-adapter.js";
import { validateCleaningPartnerDispatch } from "./cleaning-partners/core.js";
import type { CleaningDelayActionInput, CleaningDelayIncidentInput } from "./cleaning-partners/contracts.js";
import {
  cleaningRefundCoverageIsValid,
  createCleaningRefundRequest,
  decideCleaningRefundRequest,
  recordCleaningRefundExecution,
  validateCleaningRefundRequest,
  type CleaningRefundRequest,
} from "./cleaning-refunds.js";
import { createCleaningPricingPolicy, normalizeCleaningPricingPolicy } from "./cleaning-pricing-policy.js";
import { buildCleaningSettlementReview } from "./cleaning-settlements.js";
import {
  buildCleaningWallboardProjection,
  shouldPublishCleaningWallboardProjection,
  shouldRebuildCleaningWallboardProjection,
} from "./cleaning-orders/wallboard-projection.js";
import type { CleaningOrderRecord } from "./cleaning-orders/contracts.js";

import {
  provisionFieldUserCore,
  type FieldRole,
} from "./auth/provision-field-user.js";
import {
  CRM_ACCOUNT_INVITE_TTL_MS,
  CRM_ACCOUNT_SETUP_CONTINUE_URL,
  CRM_FIREBASE_WEB_API_KEY,
  appendCrmAccountSetupToken,
  createCrmAccountAccessRecord,
  createCrmAccountInviteRecord,
  createCrmAccountSetupToken,
  crmAccountEmailHash,
  crmAccountSetupTokenHash,
  canManageCrmAccountSetup,
  isCrmAccountInviteUsable,
  isCrmAccountSetupTokenUsable,
  maskCrmAccountEmail,
  normalizeCrmAccountEmail,
  normalizeCrmAccountDisplayName,
  validateCrmAccountSetupPassword,
  type CrmAccountInviteRecord,
} from "./auth/crm-account-invite.js";
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
  resolveFieldActorCore,
} from "./field-v2/access.js";
import {
  commitCanonicalBuildingUnitsBatch,
  commitCanonicalCrmEntityCore,
  reduceCanonicalBuildingUnitsBatchRoot,
  reduceCanonicalCrmEntityRoot,
  type CanonicalBuildingUnitsBatchDependencies,
  type CanonicalBuildingUnitsBatchInput,
  type CanonicalBuildingUnitsBatchResult,
  type CanonicalBuildingUnitsBatchTransactionCommand,
  type CanonicalCrmCommitResult,
  type CanonicalCrmDependencies,
  type CanonicalCrmEntityInput,
  type CanonicalCrmTransactionCommand,
} from "./field-v2/canonical-crm.js";
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
  normalizeFieldOperatorSwitchInput,
  reduceFieldOperatorSwitchRoot,
  recordFieldOperatorSwitchCore,
  type FieldOperatorSwitchRootDecision,
  type FieldOperatorSwitchTransactionCommand,
  type RecordFieldOperatorSwitchInput,
} from "./field-v2/operator-switch.js";
import {
  assignFieldJobCore,
  changeFieldVisitCore,
  claimFieldJobCore,
  createFieldJobsCore,
  listFieldOperationsWorkspaceCore,
  parseFieldMutationReceipt,
  transitionFieldJobCore,
  type AssignFieldJobInput,
  type ChangeFieldVisitInput,
  type ClaimFieldJobInput,
  type CreateFieldJobsInput,
  type FieldAtomicCreateCommand,
  type FieldAtomicCreateOutcome,
  type FieldAtomicRuntimeGuard,
  type FieldMutationReceipt,
  type FieldVisit,
  type FieldWorkItem,
  type FieldWorkTransactionDecision,
  type FieldWorkTransactionSelector,
  type FieldWorkTransactionSnapshot,
  type ListFieldOperationsWorkspaceInput,
  type TransitionFieldJobInput,
  type WorkItemDependencies,
} from "./field-v2/work-items.js";
import {
  calculateFieldKpis,
  calculateFieldOperatorKpis,
  type FieldKpis,
  type FieldTeamActiveProjection,
} from "./field-v2/projections.js";
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
    value !== "__proto__" &&
    value !== "prototype" &&
    value !== "constructor" &&
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

function requireFieldV2Authentication(request: CallableRequest<unknown>): {
  authUid: string;
  authenticatedEmail: string;
} {
  const authUid = request.auth?.uid;
  const authenticatedEmail = request.auth?.token.email;
  if (
    !isPathSafeId(authUid)
    || typeof authenticatedEmail !== "string"
    || authenticatedEmail.trim().length === 0
    || request.auth?.token.email_verified !== true
  ) {
    throw new HttpsError("unauthenticated", "field_auth_required");
  }
  return {
    authUid,
    authenticatedEmail: authenticatedEmail.trim().toLowerCase(),
  };
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
    || !isPathSafeId(data.operatorId)
    || typeof authenticatedEmail !== "string"
    || emailVerified !== true
  ) {
    throw new FieldV2Error(!isPathSafeId(data.operatorId)
      ? "field_operator_invalid"
      : "field_access_forbidden");
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
    | "operatorSwitch"
    | "read",
): Promise<{
  actor: FieldV2Actor;
  authenticatedEmail: string;
  client: FieldReleaseClient;
  config: FieldReleaseConfiguration;
  data: FieldV2CallableData;
}> {
  const authenticated = requireFieldV2Authentication(request);
  const rawData = requireFieldV2Data(request.data);
  const data = operationKind === "operatorSwitch"
    ? normalizeFieldOperatorSwitchInput(rawData) as unknown as FieldV2CallableData
    : rawData;
  if (operationKind !== "read" && !isFieldRequestId(data.requestId)) {
    throw new FieldV2Error("field_request_id_invalid");
  }
  const actor = await requireFieldV2Actor(request, data);
  const config = await readFieldV2ReleaseConfiguration();
  const client = fieldV2ReleaseClient(data);
  if (operationKind === "read") {
    assertFieldReleaseCompatible(config, client);
    await assertFieldReleaseAllows(
      config,
      { kind: "read" },
      fieldV2ReleaseDependencies(),
    );
  }
  return {
    actor,
    authenticatedEmail: authenticated.authenticatedEmail,
    client,
    config,
    data,
  };
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
  "field_crm_reference_invalid",
  "field_change_reason_required",
  "field_visit_change_empty",
  "field_release_config_invalid",
  "field_release_operation_invalid",
  "field_client_invalid",
  "field_client_kind_invalid",
  "field_build_version_invalid",
  "field_workspace_scope_invalid",
  "field_workspace_limit_invalid",
  "field_workspace_cursor_invalid",
  "field_operator_switch_input_invalid",
]);
const FIELD_V2_PERMISSION_ERRORS = new Set([
  "field_access_forbidden",
  "field_mutation_forbidden",
  "field_operator_inactive",
  "field_operator_not_enabled",
  "field_job_operator_forbidden",
  "field_workspace_scope_forbidden",
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
  "field_request_receipt_unavailable",
  "field_receipt_replay_invalid",
  "field_upload_recovery_invalid",
  "field_operator_switch_storage_invalid",
  "field_operator_switch_transaction_invalid",
  "field_operator_switch_transaction_failed",
  "field_operator_switch_timestamp_invalid",
  "field_operator_switch_rate_limit_unavailable",
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
  "field_crm_reference_inactive",
  "field_crm_reference_mismatch",
  "field_crm_reference_changed",
  "field_crm_reference_adapter_unavailable",
  "field_request_receipt_invalid",
  "field_kpi_stale",
  "field_operator_switch_previous_invalid",
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
  if (code === "field_operator_switch_rate_limited") {
    throw new HttpsError("resource-exhausted", code);
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
    if (!isPathSafeId(segment) || !isRecord(current) || !Object.hasOwn(current, segment)) {
      return null;
    }
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
    const child = Object.hasOwn(current, segment) ? current[segment] : undefined;
    if (!isRecord(child)) current[segment] = Object.create(null) as UnknownRecord;
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

const FIELD_TEAM_KPI_KEYS = Object.freeze([
  "capturePending",
  "uploadFailures",
  "reviewPending",
  "unassigned",
  "overdue",
  "adminActionRequired",
] as const);

type FieldTeamKpiKey = typeof FIELD_TEAM_KPI_KEYS[number];

const FIELD_OPERATOR_KPI_KEYS = Object.freeze([
  "capturePending",
  "uploadFailures",
  "reviewPending",
  "overdue",
  "adminActionRequired",
] as const);

function fieldSeoulDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new FieldV2Error("field_kpi_now_invalid");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  if (!parts.year || !parts.month || !parts.day) {
    throw new FieldV2Error("field_kpi_now_invalid");
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function fieldWorkItemsAt(root: unknown): Map<string, FieldWorkItem> {
  const raw = readNestedRecord(root, ["fieldPlatform", "v2", "workItems"]);
  if (raw === null) return new Map();
  if (!isRecord(raw)) throw new FieldV2Error("field_kpi_stale");
  const items = new Map<string, FieldWorkItem>();
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || value.id !== id) throw new FieldV2Error("field_kpi_stale");
    items.set(id, value as unknown as FieldWorkItem);
  }
  return items;
}

function changedFieldWorkItems(
  current: unknown,
  patch: Readonly<Record<string, unknown>>,
): Array<{ before: FieldWorkItem | null; after: FieldWorkItem | null }> {
  const changed: Array<{ before: FieldWorkItem | null; after: FieldWorkItem | null }> = [];
  for (const [path, value] of Object.entries(patch)) {
    const match = /^fieldPlatform\/v2\/workItems\/([^/]+)$/u.exec(path);
    if (!match) continue;
    const before = readNestedRecord(current, ["fieldPlatform", "v2", "workItems", match[1]]);
    changed.push({
      before: isRecord(before) ? before as unknown as FieldWorkItem : null,
      after: isRecord(value) ? value as unknown as FieldWorkItem : null,
    });
  }
  if (changed.length === 0) throw new FieldV2Error("field_kpi_stale");
  return changed;
}

function parseStoredTeamKpis(value: unknown, today: string): FieldKpis {
  if (!isRecord(value) || value.seoulDate !== today) {
    throw new FieldV2Error("field_kpi_stale");
  }
  const result = {} as Record<keyof FieldKpis, number>;
  for (const key of ["todayVisits", ...FIELD_TEAM_KPI_KEYS] as const) {
    const count = value[key];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new FieldV2Error("field_kpi_stale");
    }
    result[key] = count as number;
  }
  return result;
}

function parseStoredOperatorKpis(
  value: unknown,
  today: string,
  operatorId: string,
): FieldKpis {
  if (!isRecord(value) || value.operatorId !== operatorId) {
    throw new FieldV2Error("field_kpi_stale");
  }
  const result = parseStoredTeamKpis(value, today);
  if (result.unassigned !== 0) throw new FieldV2Error("field_kpi_stale");
  return result;
}

function sameFieldKpis(left: FieldKpis, right: FieldKpis): boolean {
  return (["todayVisits", ...FIELD_TEAM_KPI_KEYS] as const)
    .every((key) => left[key] === right[key]);
}

function visitCountsForToday(items: Iterable<FieldWorkItem>, today: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const active = item.archivedAt === null
      && item.workflowStatus !== "completed"
      && item.workflowStatus !== "cancelled";
    if (!active || item.dueDate !== today) continue;
    counts.set(item.visitId, (counts.get(item.visitId) ?? 0) + 1);
  }
  return counts;
}

function operatorItems(
  items: Iterable<FieldWorkItem>,
  operatorId: string,
): FieldWorkItem[] {
  return [...items].filter((item) => item.assignedOperatorId === operatorId);
}

function affectedFieldOperatorIds(
  changes: readonly { before: FieldWorkItem | null; after: FieldWorkItem | null }[],
): string[] {
  const result = new Set<string>();
  for (const { before, after } of changes) {
    for (const operatorId of [
      before?.assignedOperatorId,
      after?.assignedOperatorId,
      after?.updatedByOperatorId,
    ]) {
      if (operatorId !== null && operatorId !== undefined) {
        if (!isPathSafeId(operatorId)) throw new FieldV2Error("field_kpi_stale");
        result.add(operatorId);
      }
    }
  }
  return [...result].sort();
}

function assertStoredOperatorVisitState(
  value: unknown,
  operatorId: string,
  visitId: string,
  seoulDate: string,
): number {
  if (
    !isRecord(value)
    || value.operatorId !== operatorId
    || value.visitId !== visitId
    || value.seoulDate !== seoulDate
    || !Number.isSafeInteger(value.activeTodayItemCount)
    || (value.activeTodayItemCount as number) <= 0
  ) throw new FieldV2Error("field_kpi_stale");
  return value.activeTodayItemCount as number;
}

function augmentFieldTeamAggregatePatch(
  current: unknown,
  patch: Readonly<Record<string, unknown>>,
  transactionNow: Date,
): Readonly<Record<string, unknown>> {
  const now = transactionNow;
  const timestamp = now.toISOString();
  const today = fieldSeoulDate(now);
  const augmented: Record<string, unknown> = { ...patch };
  const currentKpis = readNestedRecord(current, [
    "fieldPlatform", "v2", "projections", "teamKpis", "current",
  ]);
  const changed = changedFieldWorkItems(current, patch);

  const inspectedKpis = inspectTeamKpiAggregate(currentKpis, today);
  const priorSeoulDate = inspectedKpis.state === "missing" ? null : inspectedKpis.seoulDate;
  if (priorSeoulDate !== null && priorSeoulDate > today) {
    throw new FieldV2Error("field_kpi_stale");
  }
  const rollsToNewDay = inspectedKpis.state === "stale";
  if (currentKpis === null || rollsToNewDay) {
    const existingVisitState = readNestedRecord(current, [
      "fieldPlatform", "v2", "projections", "teamVisitState",
    ]);
    if (currentKpis === null && existingVisitState !== null) {
      throw new FieldV2Error("field_kpi_stale");
    }
    if (rollsToNewDay) {
      if (existingVisitState !== null && !isRecord(existingVisitState)) {
        throw new FieldV2Error("field_kpi_stale");
      }
      for (const visitId of Object.keys(existingVisitState ?? {})) {
        if (!isPathSafeId(visitId)) throw new FieldV2Error("field_kpi_stale");
        augmented[`fieldPlatform/v2/projections/teamVisitState/${visitId}`] = null;
      }
    }
    const afterRoot = applyRootPatch(current, patch);
    const afterItems = fieldWorkItemsAt(afterRoot);
    const kpis = calculateFieldKpis([...afterItems.values()], now);
    augmented["fieldPlatform/v2/projections/teamKpis/current"] = {
      seoulDate: today,
      ...kpis,
      updatedAt: timestamp,
    };
    for (const [visitId, count] of visitCountsForToday(afterItems.values(), today)) {
      augmented[`fieldPlatform/v2/projections/teamVisitState/${visitId}`] = {
        visitId,
        seoulDate: today,
        activeTodayItemCount: count,
        updatedAt: timestamp,
      };
    }
    return augmented;
  }

  const nextKpis: Record<keyof FieldKpis, number> = {
    ...(inspectedKpis.state === "missing"
      ? (() => { throw new FieldV2Error("field_kpi_stale"); })()
      : inspectedKpis.kpis),
  };
  for (const { before, after } of changed) {
    const beforeKpis = before === null
      ? null
      : calculateFieldKpis([before], now);
    const afterKpis = after === null
      ? null
      : calculateFieldKpis([after], now);
    for (const key of FIELD_TEAM_KPI_KEYS) {
      nextKpis[key] += (afterKpis?.[key] ?? 0) - (beforeKpis?.[key] ?? 0);
    }
  }

  const currentItems = fieldWorkItemsAt(current);
  const derivedBeforeVisitCounts = visitCountsForToday(currentItems.values(), today);
  const affectedVisits = new Set(changed.flatMap(({ before, after }) => [
    ...(before === null ? [] : [before.visitId]),
    ...(after === null ? [] : [after.visitId]),
  ]));
  for (const visitId of affectedVisits) {
    const storedState = readNestedRecord(current, [
      "fieldPlatform", "v2", "projections", "teamVisitState", visitId,
    ]);
    if (storedState !== null && (
      !isRecord(storedState)
      || storedState.visitId !== visitId
      || storedState.seoulDate !== today
      || !Number.isSafeInteger(storedState.activeTodayItemCount)
      || (storedState.activeTodayItemCount as number) <= 0
    )) throw new FieldV2Error("field_kpi_stale");
    const derivedBeforeCount = derivedBeforeVisitCounts.get(visitId) ?? 0;
    if (
      (storedState === null && derivedBeforeCount > 0)
      || (storedState !== null
        && (storedState as UnknownRecord).activeTodayItemCount !== derivedBeforeCount)
    ) throw new FieldV2Error("field_kpi_stale");
    const beforeCount = storedState === null
      ? derivedBeforeCount
      : storedState.activeTodayItemCount as number;
    let afterCount = beforeCount;
    for (const change of changed) {
      if (change.before?.visitId === visitId) {
        afterCount -= calculateFieldKpis([change.before], now).todayVisits;
      }
      if (change.after?.visitId === visitId) {
        afterCount += calculateFieldKpis([change.after], now).todayVisits;
      }
    }
    if (!Number.isSafeInteger(afterCount) || afterCount < 0) {
      throw new FieldV2Error("field_kpi_stale");
    }
    nextKpis.todayVisits += Number(afterCount > 0) - Number(beforeCount > 0);
    augmented[`fieldPlatform/v2/projections/teamVisitState/${visitId}`] = afterCount === 0
      ? null
      : {
        visitId,
        seoulDate: today,
        activeTodayItemCount: afterCount,
        updatedAt: timestamp,
      };
  }
  if (Object.values(nextKpis).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new FieldV2Error("field_kpi_stale");
  }
  augmented["fieldPlatform/v2/projections/teamKpis/current"] = {
    seoulDate: today,
    ...nextKpis,
    updatedAt: timestamp,
  };
  return augmented;
}

function augmentFieldOperatorAggregatePatch(
  current: unknown,
  patch: Readonly<Record<string, unknown>>,
  transactionNow: Date,
): Readonly<Record<string, unknown>> {
  const now = transactionNow;
  const timestamp = now.toISOString();
  const today = fieldSeoulDate(now);
  const augmented: Record<string, unknown> = { ...patch };
  const changes = changedFieldWorkItems(current, patch);
  const currentItems = fieldWorkItemsAt(current);
  const afterItems = fieldWorkItemsAt(applyRootPatch(current, patch));

  for (const operatorId of affectedFieldOperatorIds(changes)) {
    const kpiPath = [
      "fieldPlatform", "v2", "projections", "operatorKpis", operatorId, "current",
    ] as const;
    const visitStatePath = [
      "fieldPlatform", "v2", "projections", "operatorVisitState", operatorId,
    ] as const;
    const currentKpis = readNestedRecord(current, kpiPath);
    const currentVisitState = readNestedRecord(current, visitStatePath);
    const inspectedKpis = inspectOperatorKpiAggregate(currentKpis, today, operatorId);
    const priorSeoulDate = inspectedKpis.state === "missing" ? null : inspectedKpis.seoulDate;
    if (priorSeoulDate !== null && priorSeoulDate > today) {
      throw new FieldV2Error("field_kpi_stale");
    }
    const rollsToNewDay = inspectedKpis.state === "stale";
    if (currentKpis === null || rollsToNewDay) {
      if (currentKpis === null && currentVisitState !== null) {
        throw new FieldV2Error("field_kpi_stale");
      }
      if (rollsToNewDay) {
        if (currentVisitState !== null && !isRecord(currentVisitState)) {
          throw new FieldV2Error("field_kpi_stale");
        }
        for (const [visitId, state] of Object.entries(currentVisitState ?? {})) {
          if (!isPathSafeId(visitId)) throw new FieldV2Error("field_kpi_stale");
          assertStoredOperatorVisitState(
            state,
            operatorId,
            visitId,
            priorSeoulDate!,
          );
          augmented[
            `fieldPlatform/v2/projections/operatorVisitState/${operatorId}/${visitId}`
          ] = null;
        }
      }
      const assignedAfter = operatorItems(afterItems.values(), operatorId);
      const kpis = calculateFieldOperatorKpis(assignedAfter, operatorId, now);
      augmented[`fieldPlatform/v2/projections/operatorKpis/${operatorId}/current`] = {
        operatorId,
        seoulDate: today,
        ...kpis,
        updatedAt: timestamp,
      };
      for (const [visitId, count] of visitCountsForToday(assignedAfter, today)) {
        augmented[
          `fieldPlatform/v2/projections/operatorVisitState/${operatorId}/${visitId}`
        ] = {
          operatorId,
          visitId,
          seoulDate: today,
          activeTodayItemCount: count,
          updatedAt: timestamp,
        };
      }
      continue;
    }

    const nextKpis: Record<keyof FieldKpis, number> = {
      ...(inspectedKpis.state === "missing"
        ? (() => { throw new FieldV2Error("field_kpi_stale"); })()
        : inspectedKpis.kpis),
    };
    const assignedBefore = operatorItems(currentItems.values(), operatorId);
    const derivedBeforeKpis = calculateFieldOperatorKpis(assignedBefore, operatorId, now);
    if (!sameFieldKpis(nextKpis, derivedBeforeKpis)) {
      throw new FieldV2Error("field_kpi_stale");
    }
    for (const { before, after } of changes) {
      const beforeKpis = before === null
        ? null
        : calculateFieldOperatorKpis([before], operatorId, now);
      const afterKpis = after === null
        ? null
        : calculateFieldOperatorKpis([after], operatorId, now);
      for (const key of FIELD_OPERATOR_KPI_KEYS) {
        nextKpis[key] += (afterKpis?.[key] ?? 0) - (beforeKpis?.[key] ?? 0);
      }
    }
    nextKpis.unassigned = 0;

    const derivedBeforeVisitCounts = visitCountsForToday(assignedBefore, today);
    const affectedVisits = new Set(changes.flatMap(({ before, after }) => [
      ...(before === null ? [] : [before.visitId]),
      ...(after === null ? [] : [after.visitId]),
    ]));
    for (const visitId of affectedVisits) {
      const storedState = readNestedRecord(current, [...visitStatePath, visitId]);
      const derivedBeforeCount = derivedBeforeVisitCounts.get(visitId) ?? 0;
      if (storedState === null && derivedBeforeCount > 0) {
        throw new FieldV2Error("field_kpi_stale");
      }
      const beforeCount = storedState === null
        ? 0
        : assertStoredOperatorVisitState(storedState, operatorId, visitId, today);
      if (beforeCount !== derivedBeforeCount) {
        throw new FieldV2Error("field_kpi_stale");
      }
      let afterCount = beforeCount;
      for (const change of changes) {
        if (change.before?.visitId === visitId) {
          afterCount -= calculateFieldOperatorKpis(
            [change.before],
            operatorId,
            now,
          ).todayVisits;
        }
        if (change.after?.visitId === visitId) {
          afterCount += calculateFieldOperatorKpis(
            [change.after],
            operatorId,
            now,
          ).todayVisits;
        }
      }
      if (!Number.isSafeInteger(afterCount) || afterCount < 0) {
        throw new FieldV2Error("field_kpi_stale");
      }
      nextKpis.todayVisits += Number(afterCount > 0) - Number(beforeCount > 0);
      augmented[
        `fieldPlatform/v2/projections/operatorVisitState/${operatorId}/${visitId}`
      ] = afterCount === 0
        ? null
        : {
          operatorId,
          visitId,
          seoulDate: today,
          activeTodayItemCount: afterCount,
          updatedAt: timestamp,
        };
    }
    if (Object.values(nextKpis).some((count) => !Number.isSafeInteger(count) || count < 0)) {
      throw new FieldV2Error("field_kpi_stale");
    }
    augmented[`fieldPlatform/v2/projections/operatorKpis/${operatorId}/current`] = {
      operatorId,
      seoulDate: today,
      ...nextKpis,
      updatedAt: timestamp,
    };
  }
  return augmented;
}

function augmentFieldAggregatePatch(
  current: unknown,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const transactionNow = new Date();
  return augmentFieldOperatorAggregatePatch(
    current,
    augmentFieldTeamAggregatePatch(current, patch, transactionNow),
    transactionNow,
  );
}

interface FieldPersonalKpiSnapshot {
  readonly kpis: FieldKpis;
  readonly kpiSeoulDate: string;
}

type FieldAggregateInspection =
  | { readonly state: "missing" }
  | {
    readonly state: "current" | "stale";
    readonly seoulDate: string;
    readonly kpis: FieldKpis;
    readonly updatedAt: string;
  };

const FIELD_TEAM_KPI_AGGREGATE_FIELDS = Object.freeze([
  "seoulDate",
  "todayVisits",
  ...FIELD_TEAM_KPI_KEYS,
  "updatedAt",
] as const);

const FIELD_OPERATOR_KPI_AGGREGATE_FIELDS = Object.freeze([
  "operatorId",
  ...FIELD_TEAM_KPI_AGGREGATE_FIELDS,
] as const);

function hasExactFields(
  value: UnknownRecord,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const fields = [...expected].sort();
  return actual.length === fields.length
    && actual.every((field, index) => field === fields[index]);
}

function isExactSeoulDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function inspectTeamKpiAggregate(
  value: unknown,
  today: string,
): FieldAggregateInspection {
  if (value === null || value === undefined) return { state: "missing" };
  if (
    !isRecord(value)
    || !hasExactFields(value, FIELD_TEAM_KPI_AGGREGATE_FIELDS)
    || !isExactSeoulDate(value.seoulDate)
    || !isExactIsoTimestamp(value.updatedAt)
  ) throw new FieldV2Error("field_kpi_stale");
  return {
    state: value.seoulDate === today ? "current" : "stale",
    seoulDate: value.seoulDate,
    kpis: parseStoredTeamKpis(value, value.seoulDate),
    updatedAt: value.updatedAt,
  };
}

function inspectOperatorKpiAggregate(
  value: unknown,
  today: string,
  operatorId: string,
): FieldAggregateInspection {
  if (value === null || value === undefined) return { state: "missing" };
  if (
    !isRecord(value)
    || !hasExactFields(value, FIELD_OPERATOR_KPI_AGGREGATE_FIELDS)
    || value.operatorId !== operatorId
    || !isExactSeoulDate(value.seoulDate)
    || !isExactIsoTimestamp(value.updatedAt)
  ) throw new FieldV2Error("field_kpi_stale");
  return {
    state: value.seoulDate === today ? "current" : "stale",
    seoulDate: value.seoulDate,
    kpis: parseStoredOperatorKpis(value, value.seoulDate, operatorId),
    updatedAt: value.updatedAt,
  };
}

function sameFieldAggregateInspection(
  left: FieldAggregateInspection,
  right: FieldAggregateInspection,
): boolean {
  if (left.state !== right.state) return false;
  if (left.state === "missing" || right.state === "missing") return true;
  return left.seoulDate === right.seoulDate
    && left.updatedAt === right.updatedAt
    && sameFieldKpis(left.kpis, right.kpis);
}

function activeVisitStateEntries(value: unknown): Array<[string, unknown]> {
  if (value === null || value === undefined) return [];
  if (!isRecord(value)) throw new FieldV2Error("field_kpi_stale");
  return Object.entries(value).filter(([, state]) => state !== null && state !== undefined);
}

function assertCurrentTeamVisitState(
  value: unknown,
  expected: ReadonlyMap<string, number>,
  today: string,
): void {
  const entries = activeVisitStateEntries(value);
  if (entries.length !== expected.size) throw new FieldV2Error("field_kpi_stale");
  for (const [visitId, state] of entries) {
    if (
      !isPathSafeId(visitId)
      || !isRecord(state)
      || state.visitId !== visitId
      || state.seoulDate !== today
      || !Number.isSafeInteger(state.activeTodayItemCount)
      || state.activeTodayItemCount !== expected.get(visitId)
    ) throw new FieldV2Error("field_kpi_stale");
  }
}

function assertCurrentOperatorVisitState(
  value: unknown,
  expected: ReadonlyMap<string, number>,
  operatorId: string,
  today: string,
): void {
  const entries = activeVisitStateEntries(value);
  if (entries.length !== expected.size) throw new FieldV2Error("field_kpi_stale");
  for (const [visitId, state] of entries) {
    const count = assertStoredOperatorVisitState(state, operatorId, visitId, today);
    if (count !== expected.get(visitId)) throw new FieldV2Error("field_kpi_stale");
  }
}

function replaceTeamAggregatePatch(
  current: unknown,
  items: readonly FieldWorkItem[],
  today: string,
  timestamp: string,
): { readonly patch: Readonly<Record<string, unknown>>; readonly kpis: FieldKpis } {
  const patch: Record<string, unknown> = {};
  const currentState = readNestedRecord(current, [
    "fieldPlatform", "v2", "projections", "teamVisitState",
  ]);
  for (const [visitId] of activeVisitStateEntries(currentState)) {
    if (!isPathSafeId(visitId)) throw new FieldV2Error("field_kpi_stale");
    patch[`fieldPlatform/v2/projections/teamVisitState/${visitId}`] = null;
  }
  const kpis = calculateFieldKpis(items, new Date(timestamp));
  patch["fieldPlatform/v2/projections/teamKpis/current"] = {
    seoulDate: today,
    ...kpis,
    updatedAt: timestamp,
  };
  for (const [visitId, count] of visitCountsForToday(items, today)) {
    patch[`fieldPlatform/v2/projections/teamVisitState/${visitId}`] = {
      visitId,
      seoulDate: today,
      activeTodayItemCount: count,
      updatedAt: timestamp,
    };
  }
  return { patch, kpis };
}

function replaceOperatorAggregatePatch(
  current: unknown,
  items: readonly FieldWorkItem[],
  operatorId: string,
  today: string,
  timestamp: string,
): { readonly patch: Readonly<Record<string, unknown>>; readonly kpis: FieldKpis } {
  const patch: Record<string, unknown> = {};
  const currentState = readNestedRecord(current, [
    "fieldPlatform", "v2", "projections", "operatorVisitState", operatorId,
  ]);
  for (const [visitId] of activeVisitStateEntries(currentState)) {
    if (!isPathSafeId(visitId)) throw new FieldV2Error("field_kpi_stale");
    patch[`fieldPlatform/v2/projections/operatorVisitState/${operatorId}/${visitId}`] = null;
  }
  const assigned = operatorItems(items, operatorId);
  const kpis = calculateFieldOperatorKpis(assigned, operatorId, new Date(timestamp));
  patch[`fieldPlatform/v2/projections/operatorKpis/${operatorId}/current`] = {
    operatorId,
    seoulDate: today,
    ...kpis,
    updatedAt: timestamp,
  };
  for (const [visitId, count] of visitCountsForToday(assigned, today)) {
    patch[`fieldPlatform/v2/projections/operatorVisitState/${operatorId}/${visitId}`] = {
      operatorId,
      visitId,
      seoulDate: today,
      activeTodayItemCount: count,
      updatedAt: timestamp,
    };
  }
  return { patch, kpis };
}

function assertAggregateIsNotFromFuture(
  aggregate: FieldAggregateInspection,
  today: string,
): void {
  if (aggregate.state !== "missing" && aggregate.seoulDate > today) {
    throw new FieldV2Error("field_kpi_stale");
  }
}

function currentWorkspaceGuardError(
  current: unknown,
  runtime: {
    actor: FieldV2Actor;
    authenticatedEmail: string;
    client: FieldReleaseClient;
  },
  scope: "personal" | "team",
): string | null {
  const actorError = currentActorGuardError(current, {
    authUid: runtime.actor.authUid,
    operatorId: runtime.actor.operatorId,
    authenticatedEmail: runtime.authenticatedEmail,
    client: runtime.client,
  });
  if (actorError) return actorError;
  const access = readNestedRecord(current, [
    "crmCompany", "access", runtime.actor.authUid,
  ]);
  if (!isRecord(access) || access.role !== runtime.actor.role) {
    return "field_access_forbidden";
  }
  if (scope === "team" && access.role !== "admin") {
    return "field_workspace_scope_forbidden";
  }
  const release = readNestedRecord(current, [
    "fieldPlatform", "v2", "config", "release",
  ]);
  try {
    assertFieldReleaseCompatible(release as FieldReleaseConfiguration, runtime.client);
  } catch (error) {
    return error instanceof FieldV2Error ? error.code : "field_release_config_invalid";
  }
  return null;
}

async function ensureWorkspaceKpiSnapshot(
  runtime: {
    actor: FieldV2Actor;
    authenticatedEmail: string;
    client: FieldReleaseClient;
  },
  scope: "personal" | "team",
): Promise<FieldPersonalKpiSnapshot> {
  let result: FieldPersonalKpiSnapshot | null = null;
  let errorCode: string | null = null;
  const transaction = await adminDatabase.ref().transaction((current) => {
    result = null;
    errorCode = null;
    const guardError = currentWorkspaceGuardError(current, runtime, scope);
    if (guardError) {
      errorCode = guardError;
      return undefined;
    }
    try {
      const now = new Date();
      const timestamp = now.toISOString();
      const today = fieldSeoulDate(now);
      // TODO(field-v2-scale): benchmark this root-authoritative scan before the
      // PoC grows. Replace it only with co-located revisioned KPI/work shards
      // that preserve the same transaction invariant; a narrower unversioned
      // transaction would trade data integrity for latency.
      const allItems = [...fieldWorkItemsAt(current).values()];
      const patch: Record<string, unknown> = {};

      let teamKpis: FieldKpis | null = null;
      const needsTeamKpis = scope === "team"
        || runtime.actor.role === "admin"
        || runtime.actor.role === "member";
      if (needsTeamKpis) {
        const teamValue = readNestedRecord(current, [
          "fieldPlatform", "v2", "projections", "teamKpis", "current",
        ]);
        const teamAggregate = inspectTeamKpiAggregate(teamValue, today);
        assertAggregateIsNotFromFuture(teamAggregate, today);
        if (teamAggregate.state === "current") {
          const expected = calculateFieldKpis(allItems, now);
          if (!sameFieldKpis(teamAggregate.kpis, expected)) {
            throw new FieldV2Error("field_kpi_stale");
          }
          assertCurrentTeamVisitState(
            readNestedRecord(current, [
              "fieldPlatform", "v2", "projections", "teamVisitState",
            ]),
            visitCountsForToday(allItems, today),
            today,
          );
          teamKpis = teamAggregate.kpis;
        } else {
          const replacement = replaceTeamAggregatePatch(
            current,
            allItems,
            today,
            timestamp,
          );
          Object.assign(patch, replacement.patch);
          teamKpis = replacement.kpis;
        }
      }

      if (scope === "team") {
        if (!teamKpis) throw new FieldV2Error("field_kpi_stale");
        result = Object.freeze({ kpis: teamKpis, kpiSeoulDate: today });
      } else {
        const operatorId = runtime.actor.operatorId;
        const operatorValue = readNestedRecord(current, [
          "fieldPlatform", "v2", "projections", "operatorKpis", operatorId, "current",
        ]);
        const operatorAggregate = inspectOperatorKpiAggregate(
          operatorValue,
          today,
          operatorId,
        );
        assertAggregateIsNotFromFuture(operatorAggregate, today);
        let operatorKpis: FieldKpis;
        if (operatorAggregate.state === "current") {
          const assigned = operatorItems(allItems, operatorId);
          const expected = calculateFieldOperatorKpis(assigned, operatorId, now);
          if (!sameFieldKpis(operatorAggregate.kpis, expected)) {
            throw new FieldV2Error("field_kpi_stale");
          }
          assertCurrentOperatorVisitState(
            readNestedRecord(current, [
              "fieldPlatform", "v2", "projections", "operatorVisitState", operatorId,
            ]),
            visitCountsForToday(assigned, today),
            operatorId,
            today,
          );
          operatorKpis = operatorAggregate.kpis;
        } else {
          const replacement = replaceOperatorAggregatePatch(
            current,
            allItems,
            operatorId,
            today,
            timestamp,
          );
          Object.assign(patch, replacement.patch);
          operatorKpis = replacement.kpis;
        }
        result = Object.freeze({
          kpis: Object.freeze({
            ...operatorKpis,
            unassigned: teamKpis?.unassigned ?? 0,
          }),
          kpiSeoulDate: today,
        });
      }
      return Object.keys(patch).length === 0
        ? current
        : applyRootPatch(current, patch);
    } catch (error) {
      errorCode = error instanceof FieldV2Error
        ? error.code
        : "field_workspace_unavailable";
      result = null;
      return undefined;
    }
  }, undefined, false);
  if (errorCode) throw new FieldV2Error(errorCode);
  if (!transaction.committed || !result) {
    throw new FieldV2Error("field_workspace_unavailable");
  }
  return result;
}

function parseReceipt(
  value: unknown,
  expectedScope?: string,
  expectedRequestId?: string,
): FieldMutationReceipt | null {
  try {
    return parseFieldMutationReceipt(value, expectedScope, expectedRequestId);
  } catch {
    return null;
  }
}

function currentCrmSourceMatches(
  root: unknown,
  expectation: FieldAtomicCreateCommand["sourceExpectations"][number],
): boolean {
  const value = readNestedRecord(root, expectation.path.split("/").filter(Boolean));
  if (!isRecord(value)) return false;
  if (expectation.kind === "workflowCase") {
    if (value.deleted === true || value.archived === true) return false;
  } else if (expectation.kind === "task") {
    if (
      value.id !== expectation.id
      || typeof value.status !== "string"
      || value.status.trim().length === 0
      || value.status !== value.status.trim()
      || Buffer.byteLength(value.status, "utf8") > 120
      || value.status === "완료"
      || value.status === "취소"
    ) {
      return false;
    }
  } else if (value.id !== expectation.id) return false;
  if (expectation.updatedAt !== "" && value.updatedAt !== expectation.updatedAt) return false;
  if (expectation.kind !== "workflowCase" && expectation.kind !== "task" && (
    value.archivedAt !== undefined
    && value.archivedAt !== null
    && value.archivedAt !== ""
  )) return false;
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

function decodeFieldTeamCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !isRecord(decoded)
      || decoded.v !== 1
      || typeof decoded.afterKey !== "string"
      || decoded.afterKey.length === 0
      || Buffer.byteLength(decoded.afterKey, "utf8") > 384
      || Object.keys(decoded).sort().join(",") !== "afterKey,v"
    ) throw new Error("invalid");
    return decoded.afterKey;
  } catch {
    throw new FieldV2Error("field_workspace_cursor_invalid");
  }
}

function encodeFieldTeamCursor(afterKey: string): string {
  return Buffer.from(JSON.stringify({ v: 1, afterKey }), "utf8").toString("base64url");
}

function decodeFieldPersonalCursor(
  value: string | undefined,
): { updatedAt: string; id: string } | undefined {
  if (value === undefined) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !isRecord(decoded)
      || decoded.v !== 1
      || typeof decoded.updatedAt !== "string"
      || !Number.isFinite(Date.parse(decoded.updatedAt))
      || !isPathSafeId(decoded.id)
      || Object.keys(decoded).sort().join(",") !== "id,updatedAt,v"
    ) throw new Error("invalid");
    return { updatedAt: decoded.updatedAt, id: decoded.id };
  } catch {
    throw new FieldV2Error("field_workspace_cursor_invalid");
  }
}

function encodeFieldPersonalCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt, id }), "utf8").toString("base64url");
}

function firebaseFieldKeyCompare(left: string, right: string): number {
  if (left === right) return 0;
  const parseIntegerKey = (value: string): number | null => {
    if (!/^-?(0*)\d{1,10}$/u.test(value)) return null;
    const parsed = Number(value);
    return parsed >= -2_147_483_648 && parsed <= 2_147_483_647 ? parsed : null;
  };
  const leftInteger = parseIntegerKey(left);
  const rightInteger = parseIntegerKey(right);
  if (leftInteger !== null) {
    if (rightInteger === null) return -1;
    const difference = leftInteger - rightInteger;
    return difference === 0 ? left.length - right.length : difference;
  }
  if (rightInteger !== null) return 1;
  return left < right ? -1 : 1;
}

function currentActorGuardError(
  root: unknown,
  guard: Pick<
    FieldAtomicRuntimeGuard,
    "authUid" | "operatorId" | "authenticatedEmail" | "client"
  > | undefined,
): string | null {
  if (!guard) return "field_work_transaction_guard_invalid";
  const access = readNestedRecord(root, [
    "crmCompany", "access", guard.authUid,
  ]);
  if (
    !isRecord(access)
    || access.enabled !== true
    || (access.role !== "admin" && access.role !== "member" && access.role !== "viewer")
    || typeof access.email !== "string"
    || access.email.trim().toLowerCase() !== guard.authenticatedEmail
  ) return "field_access_forbidden";
  const profile = readNestedRecord(root, [
    "crmCompany", "teamProfiles", guard.operatorId,
  ]);
  if (
    !isRecord(profile)
    || profile.active !== true
    || typeof profile.displayName !== "string"
    || profile.displayName.length === 0
    || profile.displayName !== profile.displayName.trim()
    || Buffer.byteLength(profile.displayName, "utf8") > 120
    || /[\u0000-\u001f\u007f]/u.test(profile.displayName)
  ) {
    return "field_operator_inactive";
  }
  return null;
}

function currentMutationGuardError(
  root: unknown,
  guard: FieldAtomicRuntimeGuard | undefined,
): string | null {
  const actorError = currentActorGuardError(root, guard);
  if (actorError || !guard) return actorError;
  const access = readNestedRecord(root, [
    "crmCompany", "access", guard.authUid,
  ]);
  if (!isRecord(access) || (access.role !== "admin" && access.role !== "member")) {
    return "field_mutation_forbidden";
  }
  const release = readNestedRecord(root, [
    "fieldPlatform", "v2", "config", "release",
  ]);
  try {
    assertFieldReleaseCompatible(
      release as FieldReleaseConfiguration,
      guard.client,
    );
  } catch (error) {
    return error instanceof FieldV2Error ? error.code : "field_release_config_invalid";
  }
  if ((release as FieldReleaseConfiguration).safeMode) {
    return "field_safe_mode_read_only";
  }
  if (!(release as FieldReleaseConfiguration).v2WritesEnabled) {
    return "field_v2_writes_disabled";
  }
  return null;
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
      const receiptValue = readNestedRecord(current, [
        "fieldPlatform",
        "v2",
        "requestReceipts",
        selector.scope,
        selector.requestId,
      ]);
      const currentReceipt = parseReceipt(
        receiptValue,
        selector.scope,
        selector.requestId,
      );
      if (receiptValue !== null && receiptValue !== undefined && !currentReceipt) {
        chosen = { errorCode: "field_request_receipt_invalid" };
        return undefined;
      }
      if (currentReceipt && currentReceipt.requestHash !== selector.requestHash) {
        chosen = { errorCode: "field_request_id_conflict" };
        return undefined;
      }
      if (currentReceipt) {
        const actorError = currentActorGuardError(current, selector.runtimeGuard);
        if (actorError) {
          chosen = { errorCode: actorError };
          return undefined;
        }
        chosen = decide({
          workItem: null,
          visit: null,
          visitWorkItems: [],
          receipt: currentReceipt,
        });
        return undefined;
      }
      const guardError = currentMutationGuardError(current, selector.runtimeGuard);
      if (guardError) {
        chosen = { errorCode: guardError };
        return undefined;
      }
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
      return applyRootPatch(
        current,
        augmentFieldAggregatePatch(current, chosen.patch),
      );
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

async function readCreationReceiptAtomically(
  scope: "createFieldJobs",
  requestId: string,
  runtime: {
    actor: FieldV2Actor;
    authenticatedEmail: string;
    client: FieldReleaseClient;
  },
): Promise<unknown> {
  let receipt: unknown = null;
  let errorCode: string | null = null;
  await adminDatabase.ref().transaction(
    (current) => {
      const value = readNestedRecord(current, [
        "fieldPlatform", "v2", "requestReceipts", scope, requestId,
      ]);
      if (value === null) {
        receipt = null;
        return undefined;
      }
      const parsed = parseReceipt(value, scope, requestId);
      if (!parsed) {
        errorCode = "field_request_receipt_invalid";
        return undefined;
      }
      const actorError = currentActorGuardError(current, {
        authUid: runtime.actor.authUid,
        operatorId: runtime.actor.operatorId,
        authenticatedEmail: runtime.authenticatedEmail,
        client: runtime.client,
      });
      if (actorError) {
        errorCode = actorError;
        return undefined;
      }
      receipt = parsed;
      return undefined;
    },
    undefined,
    false,
  );
  if (errorCode) throw new FieldV2Error(errorCode);
  return receipt;
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
  async readCrmWorkflowCase(id) {
    return (await adminDatabase.ref(`crmCompany/cases/${id}`).get()).val();
  },
  async readCrmTask(id) {
    return (await adminDatabase.ref(`crmCompany/data/tasks/${id}`).get()).val();
  },
  async readOperator(id) {
    const value: unknown = (await adminDatabase
      .ref(`crmCompany/teamProfiles/${id}`)
      .get()).val();
    return isRecord(value) ? { id, ...value } : value;
  },
  async readCreationReceipt(scope, requestId) {
    return (await adminDatabase
      .ref(`fieldPlatform/v2/requestReceipts/${scope}/${requestId}`)
      .get()).val();
  },
  async commitCreation(command: FieldAtomicCreateCommand): Promise<FieldAtomicCreateOutcome> {
    let outcome: FieldAtomicCreateOutcome | null = null;
    const receiptSegments = command.receiptPath.split("/").filter(Boolean);
    const transaction = await adminDatabase.ref().transaction(
      (current) => {
        const receiptValue = readNestedRecord(current, receiptSegments);
        const stored = parseReceipt(
          receiptValue,
          "createFieldJobs",
          command.requestId,
        );
        if (receiptValue !== null && receiptValue !== undefined && !stored) {
          throw new FieldV2Error("field_request_receipt_invalid");
        }
        if (stored && stored.requestHash !== command.requestHash) {
          outcome = { kind: "conflict" };
          return undefined;
        }
        if (stored) {
          const actorError = currentActorGuardError(current, command.runtimeGuard);
          if (actorError) throw new FieldV2Error(actorError);
          outcome = {
            kind: "replayed",
            result: stored.result as FieldAtomicCreateCommand["result"],
          };
          return undefined;
        }
        const guardError = currentMutationGuardError(current, command.runtimeGuard);
        if (guardError) throw new FieldV2Error(guardError);
        if (!command.sourceExpectations.every((expectation) =>
          currentCrmSourceMatches(current, expectation))) {
          throw new FieldV2Error("field_crm_reference_changed");
        }
        if (!currentOperatorsAreActive(current, command.requiredActiveOperatorIds)) {
          throw new FieldV2Error("field_assignee_invalid");
        }
        outcome = { kind: "created", result: command.result };
        return applyRootPatch(
          current,
          augmentFieldAggregatePatch(current, command.patch),
        );
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
  async readWorkspace(actor, query) {
    if (query.scope === "team") {
      const afterKey = decodeFieldTeamCursor(query.cursor);
      const suppliedKpis = query.authoritativeKpis;
      let teamQuery = adminDatabase
        .ref("fieldPlatform/v2/projections/teamActive")
        .orderByChild("activeOrderKey");
      if (afterKey !== undefined) teamQuery = teamQuery.startAfter(afterKey);
      const [teamSnapshot, kpiSnapshot] = await Promise.all([
        teamQuery.limitToFirst(query.limit + 1).get(),
        suppliedKpis
          ? Promise.resolve(null)
          : adminDatabase.ref("fieldPlatform/v2/projections/teamKpis/current").get(),
      ]);
      const entries: UnknownRecord[] = [];
      teamSnapshot.forEach((child) => {
        const key = child.key;
        const value: unknown = child.val();
        if (
          !isPathSafeId(key)
          || !isRecord(value)
          || value.fieldJobId !== key
          || typeof value.activeOrderKey !== "string"
        ) {
          throw new FieldV2Error("field_workspace_invalid");
        }
        entries.push(value);
        return false;
      });
      const hasMore = entries.length > query.limit;
      const items = entries.slice(0, query.limit);
      const last = items.at(-1);
      const rawKpis: unknown = suppliedKpis?.kpis ?? kpiSnapshot?.val();
      if (!isRecord(rawKpis) || typeof rawKpis.seoulDate !== "string") {
        if (!suppliedKpis) throw new FieldV2Error("field_workspace_invalid");
      }
      return {
        items: items as unknown as readonly FieldTeamActiveProjection[],
        kpis: rawKpis as unknown as FieldKpis,
        kpiSeoulDate: suppliedKpis?.kpiSeoulDate ?? (rawKpis as UnknownRecord).seoulDate as string,
        ...(hasMore && last
          ? { nextCursor: encodeFieldTeamCursor(String(last.activeOrderKey)) }
          : {}),
      };
    }
    const cursor = decodeFieldPersonalCursor(query.cursor);
    const scanLimit = Math.min(100, Math.max(query.limit + 1, query.limit * 2));
    const projectionPath = `fieldPlatform/v2/projections/operatorJobs/${actor.operatorId}`;
    let mineQuery = adminDatabase.ref(projectionPath).orderByChild("updatedAt");
    if (cursor) mineQuery = mineQuery.startAfter(cursor.updatedAt, cursor.id);
    const minePromise = mineQuery.limitToFirst(scanLimit + 1).get();
    const includeUnassigned = actor.role === "admin" || actor.role === "member";
    const unassignedPromise = includeUnassigned
      ? (() => {
        let unassignedQuery = adminDatabase.ref("fieldPlatform/v2/projections/unassigned")
          .orderByChild("updatedAt");
        if (cursor) unassignedQuery = unassignedQuery.startAfter(cursor.updatedAt, cursor.id);
        return unassignedQuery.limitToFirst(scanLimit + 1).get();
      })()
      : Promise.resolve(null);
    const suppliedKpis = query.authoritativeKpis;
    const operatorKpiPromise = suppliedKpis
      ? Promise.resolve(null)
      : adminDatabase
        .ref(`fieldPlatform/v2/projections/operatorKpis/${actor.operatorId}/current`)
        .get();
    const teamKpiPromise = suppliedKpis || !includeUnassigned
      ? Promise.resolve(null)
      : adminDatabase.ref("fieldPlatform/v2/projections/teamKpis/current").get();
    const [mine, unassigned, operatorKpiSnapshot, teamKpiSnapshot] = await Promise.all([
      minePromise,
      unassignedPromise,
      operatorKpiPromise,
      teamKpiPromise,
    ]);
    let authoritativeKpis: unknown = suppliedKpis?.kpis;
    let kpiSeoulDate = suppliedKpis?.kpiSeoulDate ?? "";
    if (!suppliedKpis) {
      const rawOperatorKpis: unknown = operatorKpiSnapshot?.val();
      const operatorKpisValid = isRecord(rawOperatorKpis)
        && rawOperatorKpis.operatorId === actor.operatorId
        && typeof rawOperatorKpis.seoulDate === "string"
        && rawOperatorKpis.unassigned === 0;
      authoritativeKpis = operatorKpisValid ? rawOperatorKpis : undefined;
      kpiSeoulDate = operatorKpisValid ? rawOperatorKpis.seoulDate as string : "";
      if (includeUnassigned) {
        const rawTeamKpis: unknown = teamKpiSnapshot?.val();
        if (
          operatorKpisValid
          && isRecord(rawTeamKpis)
          && typeof rawTeamKpis.seoulDate === "string"
        ) {
          authoritativeKpis = {
            ...rawOperatorKpis,
            unassigned: rawTeamKpis.unassigned,
          };
          if (rawTeamKpis.seoulDate !== rawOperatorKpis.seoulDate) {
            kpiSeoulDate = "";
          }
        } else {
          authoritativeKpis = undefined;
        }
      }
    }
    const expected = new Map<string, {
      id: string;
      mine: boolean;
      unassigned: boolean;
      updatedAt: string;
    }>();
    for (const [snapshot, kind] of [
      [mine, "mine"],
      [unassigned, "unassigned"],
    ] as const) {
      if (snapshot === null) continue;
      snapshot.forEach((child) => {
        const key = child.key;
        const projection: unknown = child.val();
        if (
          !isPathSafeId(key)
          || !isRecord(projection)
          || projection.fieldJobId !== key
          || typeof projection.updatedAt !== "string"
          || !Number.isFinite(Date.parse(projection.updatedAt))
        ) {
          throw new FieldV2Error("field_workspace_invalid");
        }
        const previous = expected.get(key);
        expected.set(key, {
          id: key,
          mine: previous?.mine === true || kind === "mine",
          unassigned: previous?.unassigned === true || kind === "unassigned",
          updatedAt: previous && previous.updatedAt > projection.updatedAt
            ? previous.updatedAt
            : projection.updatedAt,
        });
        return false;
      });
    }
    const selected = [...expected.values()].sort((left, right) => (
      left.updatedAt.localeCompare(right.updatedAt)
      || firebaseFieldKeyCompare(left.id, right.id)
    ));
    const scanCandidates = selected.slice(0, scanLimit);
    const candidates = await Promise.all(scanCandidates.map(async (candidate) => ({
      ...candidate,
      value: (await adminDatabase.ref(`fieldPlatform/v2/workItems/${candidate.id}`).get()).val(),
    })));
    const items: FieldWorkItem[] = [];
    let consumedCount = 0;
    for (const { mine, unassigned: projectedUnassigned, value } of candidates) {
      consumedCount += 1;
      if (!isRecord(value)) continue;
      if (value.archivedAt !== null || value.workflowStatus === "completed" || value.workflowStatus === "cancelled") {
        continue;
      }
      if (
        value.assignedOperatorId === actor.operatorId
          ? !mine
          : value.assignedOperatorId === null
            ? !projectedUnassigned
            : true
      ) continue;
      items.push(value as unknown as FieldWorkItem);
      if (items.length === query.limit) break;
    }
    const lastConsumed = scanCandidates[consumedCount - 1];
    return {
      items,
      kpis: authoritativeKpis as FieldKpis,
      kpiSeoulDate,
      ...(lastConsumed && consumedCount < selected.length
        ? { nextCursor: encodeFieldPersonalCursor(lastConsumed.updatedAt, lastConsumed.id) }
        : {}),
    };
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
  runtime?: {
    actor: FieldV2Actor;
    authenticatedEmail: string;
    client: FieldReleaseClient;
  },
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
      let parsed: FieldMutationReceipt;
      try {
        parsed = parseFieldMutationReceipt(stored, scope, requestId);
      } catch {
        throw new FieldV2Error("field_request_receipt_invalid");
      }
      if (parsed.requestHash !== requestHash) {
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
    async readWorkspace(actor, query) {
      if (!runtime) {
        return baseFieldV2WorkDependencies.readWorkspace(actor, query);
      }
      // Fetch only the bounded projection page first. The authoritative KPI
      // and current access/release decision come from the final root CAS below.
      const page = await baseFieldV2WorkDependencies.readWorkspace(actor, {
        ...query,
        authoritativeKpis: {
          kpis: {
            todayVisits: 0,
            capturePending: 0,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 0,
            overdue: 0,
            adminActionRequired: 0,
          },
          kpiSeoulDate: fieldSeoulDate(new Date()),
        },
      });
      const snapshot = await ensureWorkspaceKpiSnapshot(runtime, query.scope);
      return {
        ...page,
        kpis: snapshot.kpis,
        kpiSeoulDate: snapshot.kpiSeoulDate,
      };
    },
    async readCreationReceipt(scope, requestId) {
      if (!runtime) return baseFieldV2WorkDependencies.readCreationReceipt(scope, requestId);
      return readCreationReceiptAtomically(scope, requestId, runtime);
    },
    async commitCreation(command) {
      await assertOperation(
        "createFieldJobs",
        command.requestId,
        command.requestHash,
      );
      return baseFieldV2WorkDependencies.commitCreation({
        ...command,
        ...(runtime === undefined ? {} : {
          runtimeGuard: {
            authUid: runtime.actor.authUid,
            operatorId: runtime.actor.operatorId,
            authenticatedEmail: runtime.authenticatedEmail,
            client: runtime.client,
            operationKind,
          } as FieldAtomicRuntimeGuard,
        }),
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
        ...(runtime === undefined ? {} : {
          runtimeGuard: {
            authUid: runtime.actor.authUid,
            operatorId: runtime.actor.operatorId,
            authenticatedEmail: runtime.authenticatedEmail,
            client: runtime.client,
            operationKind,
          } as FieldAtomicRuntimeGuard,
        }),
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

const CRM_ACCOUNT_SETUP_CODE_LIMIT = 4096;
const CRM_ACCOUNT_SETUP_RESPONSE_LIMIT = 16 * 1024;
const CRM_ACCOUNT_SETUP_RATE_WINDOW_MS = 10 * 60 * 1_000;

function crmAccountSetupError(code: string): HttpsError {
  if (code === "crm_account_email_invalid") {
    return new HttpsError("invalid-argument", "crm_account_email_invalid");
  }
  if (code === "crm_account_password_invalid") {
    return new HttpsError("invalid-argument", "crm_account_password_invalid");
  }
  if (code === "crm_account_display_name_invalid") {
    return new HttpsError("invalid-argument", "crm_account_display_name_invalid");
  }
  if (code === "crm_account_email_link_not_enabled") {
    return new HttpsError("failed-precondition", "crm_account_email_link_not_enabled");
  }
  if (code === "crm_account_email_action_domain_invalid") {
    return new HttpsError("failed-precondition", "crm_account_email_action_domain_invalid");
  }
  if (code === "crm_account_duplicate") {
    return new HttpsError("already-exists", "crm_account_duplicate");
  }
  if (code === "crm_account_invite_invalid" || code === "crm_account_setup_invalid") {
    return new HttpsError("failed-precondition", "crm_account_setup_invalid");
  }
  if (code === "crm_account_setup_rate_limited") {
    return new HttpsError("resource-exhausted", "crm_account_setup_rate_limited");
  }
  return new HttpsError("internal", "crm_account_setup_unavailable");
}

function crmAccountSetupSafeUid(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

async function resolveCrmAccountSetupInvite(
  uidValue: unknown,
  setupToken: unknown,
  now: number,
): Promise<{ uid: string; email: string; emailHash: string }> {
  if (!crmAccountSetupSafeUid(uidValue)) throw new Error("crm_account_setup_invalid");
  const uid = uidValue;
  const inviteSnapshot = await adminDatabase.ref(`crmCompany/accountInvites/${uid}`).get();
  const invite = inviteSnapshot.val();
  if (!isCrmAccountSetupTokenUsable(invite, setupToken, now)) {
    throw new Error("crm_account_setup_invalid");
  }
  const user = await adminAuth.getUser(uid);
  if (!user.email || user.disabled) throw new Error("crm_account_setup_invalid");
  const email = normalizeCrmAccountEmail(user.email);
  if (!isCrmAccountInviteUsable(invite, email, now)) throw new Error("crm_account_setup_invalid");
  const emailHash = crmAccountEmailHash(email);
  const indexSnapshot = await adminDatabase.ref(`crmCompany/accountInviteIndex/${emailHash}`).get();
  const index = indexSnapshot.val() as { uid?: unknown; status?: unknown; emailHash?: unknown } | null;
  if (!index || index.uid !== uid || index.emailHash !== emailHash || index.status !== "pending") {
    throw new Error("crm_account_setup_invalid");
  }
  const accessSnapshot = await adminDatabase.ref(`crmCompany/access/${uid}`).get();
  const access = accessSnapshot.val();
  if (
    !isRecord(access)
    || typeof access.email !== "string"
    || access.email.trim().toLowerCase() !== email
    || access.enabled !== true
    || access.role !== "member"
    || access.accountSetupPending !== true
  ) throw new Error("crm_account_setup_invalid");
  return { uid, email, emailHash };
}

async function resolveCrmAccountSetupInviteByEmail(
  emailValue: unknown,
  now: number,
): Promise<{ uid: string; email: string; emailHash: string }> {
  const email = normalizeCrmAccountEmail(emailValue);
  const emailHash = crmAccountEmailHash(email);
  const indexSnapshot = await adminDatabase.ref(`crmCompany/accountInviteIndex/${emailHash}`).get();
  const index = indexSnapshot.val() as { uid?: unknown; status?: unknown; emailHash?: unknown } | null;
  if (!index || !crmAccountSetupSafeUid(index.uid) || index.emailHash !== emailHash || index.status !== "pending") {
    throw new Error("crm_account_setup_invalid");
  }
  const uid = index.uid;
  const inviteSnapshot = await adminDatabase.ref(`crmCompany/accountInvites/${uid}`).get();
  const invite = inviteSnapshot.val();
  if (!isCrmAccountInviteUsable(invite, email, now)) throw new Error("crm_account_setup_invalid");
  const user = await adminAuth.getUser(uid);
  if (!user.email || user.disabled || normalizeCrmAccountEmail(user.email) !== email) {
    throw new Error("crm_account_setup_invalid");
  }
  const access = (await adminDatabase.ref(`crmCompany/access/${uid}`).get()).val();
  if (
    !isRecord(access)
    || typeof access.email !== "string"
    || access.email.trim().toLowerCase() !== email
    || access.enabled !== true
    || access.role !== "member"
    || access.accountSetupPending !== true
  ) throw new Error("crm_account_setup_invalid");
  return { uid, email, emailHash };
}

async function requireCrmAccountSetupAdmin(request: CallableRequest<unknown>): Promise<{ uid: string; email: string }> {
  const uid = request.auth?.uid;
  const email = request.auth?.token.email;
  const firebaseClaim = request.auth?.token.firebase;
  const identity = {
    uid,
    email,
    emailVerified: request.auth?.token.email_verified,
    signInProvider: isRecord(firebaseClaim) ? firebaseClaim.sign_in_provider : undefined,
  };
  if (!crmAccountSetupSafeUid(uid) || typeof email !== "string") {
    throw new HttpsError("unauthenticated", "crm_account_setup_auth_required");
  }
  const access = (await adminDatabase.ref(`crmCompany/access/${uid}`).get()).val() as {
    email?: unknown;
    enabled?: unknown;
    role?: unknown;
    mustChangePassword?: unknown;
  } | null;
  if (!canManageCrmAccountSetup(identity, access)) {
    throw new HttpsError("permission-denied", "crm_account_setup_admin_required");
  }
  return { uid, email: email.trim().toLowerCase() };
}

async function consumeCrmAccountAdminRateLimit(uid: string, action: string): Promise<void> {
  await consumeRateLimit(
    adminDatabase.ref(`crmCompany/accountSetupRateLimits/admin/${action}/${desktopRateKey(uid)}`),
    { limit: 30, windowMs: CRM_ACCOUNT_SETUP_RATE_WINDOW_MS, nowMs: Date.now() },
  );
}

async function postCrmIdentityToolkit(
  method: "sendOobCode" | "signInWithEmailLink",
  body: UnknownRecord,
): Promise<UnknownRecord> {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  let endpoint: URL;
  if (emulatorHost) {
    let emulatorOrigin: URL;
    try { emulatorOrigin = new URL(`http://${emulatorHost}`); }
    catch { throw new Error("crm_account_identity_request_failed"); }
    if (
      emulatorOrigin.protocol !== "http:"
      || !["127.0.0.1", "localhost"].includes(emulatorOrigin.hostname)
      || emulatorOrigin.username
      || emulatorOrigin.password
      || emulatorOrigin.pathname !== "/"
      || emulatorOrigin.search
      || emulatorOrigin.hash
    ) throw new Error("crm_account_identity_request_failed");
    endpoint = new URL(`/identitytoolkit.googleapis.com/v1/accounts:${method}`, emulatorOrigin.origin);
    endpoint.searchParams.set("key", "demo-api-key");
  } else {
    endpoint = new URL(`https://identitytoolkit.googleapis.com/v1/accounts:${method}`);
    endpoint.searchParams.set("key", CRM_FIREBASE_WEB_API_KEY);
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("crm_account_identity_request_failed");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("crm_account_identity_request_failed");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > CRM_ACCOUNT_SETUP_RESPONSE_LIMIT)) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("crm_account_identity_response_invalid");
  }
  if (!response.body) throw new Error("crm_account_identity_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > CRM_ACCOUNT_SETUP_RESPONSE_LIMIT) {
        await reader.cancel();
        throw new Error("crm_account_identity_response_invalid");
      }
      chunks.push(part.value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("crm_account_identity_response_invalid"); }
  if (!isRecord(value)) throw new Error("crm_account_identity_response_invalid");
  if (!response.ok) {
    const error = isRecord(value.error) ? value.error : {};
    const rawCode = typeof error.message === "string" ? error.message.split(/[\s:]/u, 1)[0].toUpperCase() : "";
    const safeCode = /^[A-Z0-9_]{1,64}$/u.test(rawCode) ? rawCode : "REQUEST_FAILED";
    throw new Error(`crm_account_identity_${safeCode.toLowerCase()}`);
  }
  return value;
}

function crmAccountIdentityFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const match = /^crm_account_identity_([a-z0-9_]{1,64})$/u.exec(message);
  return match?.[1] || "request_failed";
}

function crmAccountIdentityFailureAsSetupCode(error: unknown): string {
  const code = crmAccountIdentityFailureCode(error);
  if (code === "too_many_attempts_try_later") return "crm_account_setup_rate_limited";
  if (code === "operation_not_allowed" || code === "email_link_signin_disabled" || code === "email_signin_disabled") return "crm_account_email_link_not_enabled";
  if (code === "invalid_continue_uri" || code === "unauthorized_domain") return "crm_account_email_action_domain_invalid";
  return "crm_account_setup_unavailable";
}

async function sendCrmAccountSetupEmail(email: string, uid: string, setupToken: string): Promise<void> {
  const continueUrl = new URL(CRM_ACCOUNT_SETUP_CONTINUE_URL);
  continueUrl.searchParams.set("uid", uid);
  // Opaque per-invitation state lets the server recover the recipient without
  // putting their email address in a redirect URL or trusting a form field.
  continueUrl.searchParams.set("invite", setupToken);
  await postCrmIdentityToolkit("sendOobCode", {
    requestType: "EMAIL_SIGNIN",
    email,
    continueUrl: continueUrl.href,
    canHandleCodeInApp: true,
  });
}

function crmAccountInviteIndex(emailHash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(emailHash)) throw new Error("crm_account_setup_invalid");
  return `crmCompany/accountInviteIndex/${emailHash}`;
}

export const registerCrmAccount = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const actor = await requireCrmAccountSetupAdmin(request);
    try {
      await consumeCrmAccountAdminRateLimit(actor.uid, "register");
      const input = isRecord(request.data) ? request.data : {};
      const email = normalizeCrmAccountEmail(input.email);
      const accessSnapshot = await adminDatabase.ref("crmCompany/access").get();
      let emailAlreadyAllowed = false;
      accessSnapshot.forEach((child) => {
        const record = child.val() as { email?: unknown } | null;
        if (typeof record?.email === "string" && record.email.trim().toLowerCase() === email) {
          emailAlreadyAllowed = true;
          return true;
        }
        return false;
      });
      if (emailAlreadyAllowed) throw new Error("crm_account_duplicate");
      try {
        await adminAuth.getUserByEmail(email);
        throw new Error("crm_account_duplicate");
      } catch (error) {
        if (error instanceof Error && error.message === "crm_account_duplicate") throw error;
        if (isRecord(error) && error.code === "auth/user-not-found") {
          // No existing Firebase identity: this is the only case in which a new
          // account is created. Existing credentials are never overwritten.
        } else {
          throw error;
        }
      }

      const user = await adminAuth.createUser({ email, emailVerified: false, disabled: false });
      const now = Date.now();
      const setupToken = createCrmAccountSetupToken();
      const accessRecord = createCrmAccountAccessRecord(email, actor.uid, now);
      const inviteRecord = createCrmAccountInviteRecord(
        email,
        actor.uid,
        now,
        crmAccountSetupTokenHash(setupToken),
      );
      const indexPath = crmAccountInviteIndex(inviteRecord.emailHash);
      try {
        await adminDatabase.ref().update({
          [`crmCompany/access/${user.uid}`]: accessRecord,
          [`crmCompany/accountInvites/${user.uid}`]: inviteRecord,
          [indexPath]: { uid: user.uid, emailHash: inviteRecord.emailHash, status: "pending" },
        });
      } catch {
        try { await adminAuth.deleteUser(user.uid); } catch {}
        throw new Error("crm_account_setup_unavailable");
      }

      let emailSent = false;
      try {
        await sendCrmAccountSetupEmail(email, user.uid, setupToken);
        emailSent = true;
        await adminDatabase.ref(`crmCompany/accountInvites/${user.uid}`).update({ lastSentAt: now });
      } catch (error) {
        // Keep the account pending so an authorized administrator can retry.
        logger.warn("CRM account invitation email was not sent", {
          functionName: "registerCrmAccount",
          identityError: crmAccountIdentityFailureCode(error),
        });
        const emailErrorCode = crmAccountIdentityFailureAsSetupCode(error);
        return {
          uid: user.uid,
          email,
          status: "pending",
          createdAt: now,
          lastSentAt: 0,
          emailSent: false,
          emailErrorCode: emailErrorCode === "crm_account_setup_unavailable" ? "" : emailErrorCode,
        };
      }
      return { uid: user.uid, email, status: "pending", createdAt: now, lastSentAt: emailSent ? now : 0, emailSent };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "crm_account_email_invalid" || code === "crm_account_duplicate") throw crmAccountSetupError(code);
      if (code === "field_rate_limit_exceeded") throw crmAccountSetupError("crm_account_setup_rate_limited");
      throw crmAccountSetupError("crm_account_setup_unavailable");
    }
  },
);

export const listCrmAccountInvites = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const actor = await requireCrmAccountSetupAdmin(request);
    try {
      await consumeCrmAccountAdminRateLimit(actor.uid, "list");
      const snapshot = await adminDatabase.ref("crmCompany/accountInvites").limitToLast(200).get();
      const rows: Array<{
        uid: string;
        email: string;
        displayName: string;
        status: "pending" | "complete";
        createdAt: number;
        expiresAt: number;
        lastSentAt: number;
      }> = [];
      const values = snapshot.val();
      if (isRecord(values)) {
        for (const [uid, raw] of Object.entries(values)) {
          if (!crmAccountSetupSafeUid(uid) || !isRecord(raw)) continue;
          try {
            const user = await adminAuth.getUser(uid);
            if (!user.email) continue;
            rows.push({
              uid,
              email: user.email,
              displayName: user.displayName || "",
              status: raw.status === "complete" || user.emailVerified ? "complete" : "pending",
              createdAt: Number(raw.createdAt) || 0,
              expiresAt: Number(raw.expiresAt) || 0,
              lastSentAt: Number(raw.lastSentAt) || 0,
            });
          } catch {
            // Stale invite records are omitted without exposing the auth error.
          }
        }
      }
      rows.sort((a, b) => b.createdAt - a.createdAt);
      return { accounts: rows };
    } catch (error) {
      if (error instanceof Error && error.message === "field_rate_limit_exceeded") {
        throw crmAccountSetupError("crm_account_setup_rate_limited");
      }
      throw crmAccountSetupError("crm_account_setup_unavailable");
    }
  },
);

export const resendCrmAccountInvite = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const actor = await requireCrmAccountSetupAdmin(request);
    try {
      await consumeCrmAccountAdminRateLimit(actor.uid, "resend");
      const input = isRecord(request.data) ? request.data : {};
      const uid = input.uid;
      if (!crmAccountSetupSafeUid(uid)) throw new Error("crm_account_setup_invalid");
      const inviteRef = adminDatabase.ref(`crmCompany/accountInvites/${uid}`);
      const snapshot = await inviteRef.get();
      const raw = snapshot.val();
      if (!isRecord(raw) || raw.status !== "pending") throw new Error("crm_account_setup_invalid");
      const user = await adminAuth.getUser(uid);
      if (!user.email || user.disabled) throw new Error("crm_account_setup_invalid");
      const email = normalizeCrmAccountEmail(user.email);
      if (raw.emailHash !== crmAccountEmailHash(email)) throw new Error("crm_account_setup_invalid");
      const now = Date.now();
      if (Number(raw.lastSentAt) > 0 && now - Number(raw.lastSentAt) < 60_000) {
        throw new Error("crm_account_setup_rate_limited");
      }
      const expiresAt = Math.max(Number(raw.expiresAt) || 0, now + CRM_ACCOUNT_INVITE_TTL_MS);
      const setupToken = createCrmAccountSetupToken();
      const setupTokens = appendCrmAccountSetupToken(raw, crmAccountSetupTokenHash(setupToken), now);
      await inviteRef.update({ setupTokens, expiresAt });
      await sendCrmAccountSetupEmail(email, uid, setupToken);
      await inviteRef.update({ lastSentAt: now });
      return { uid, email, status: user.emailVerified ? "complete" : "pending", lastSentAt: now, emailSent: true };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (["crm_account_setup_invalid", "crm_account_setup_rate_limited"].includes(code)) {
        throw crmAccountSetupError(code);
      }
      if (code === "field_rate_limit_exceeded") throw crmAccountSetupError("crm_account_setup_rate_limited");
      const setupCode = crmAccountIdentityFailureAsSetupCode(error);
      if (setupCode !== "crm_account_setup_unavailable") throw crmAccountSetupError(setupCode);
      logger.error("CRM account invitation resend failed", {
        functionName: "resendCrmAccountInvite",
        identityError: crmAccountIdentityFailureCode(error),
      });
      throw crmAccountSetupError(setupCode);
    }
  },
);

export const getCrmAccountSetupInvite = onCall(
  { region: "asia-northeast3", cors: ["https://bring-fm.web.app"] },
  async (request) => {
    try {
      const input = isRecord(request.data) ? request.data : {};
      const tokenHash = crmAccountSetupTokenHash(input.setupToken);
      const now = Date.now();
      const ipKey = desktopRateKey(safeRequestIp(request));
      await consumeRateLimit(
        adminDatabase.ref(`crmCompany/accountSetupRateLimits/preview/ip/${ipKey}`),
        { limit: 30, windowMs: CRM_ACCOUNT_SETUP_RATE_WINDOW_MS, nowMs: now },
      );
      await consumeRateLimit(
        adminDatabase.ref(`crmCompany/accountSetupRateLimits/preview/token/${tokenHash}`),
        { limit: 20, windowMs: CRM_ACCOUNT_SETUP_RATE_WINDOW_MS, nowMs: now },
      );
      const { uid, email } = await resolveCrmAccountSetupInvite(input.uid, input.setupToken, now);
      return { uid, maskedEmail: maskCrmAccountEmail(email) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "field_rate_limit_exceeded") throw crmAccountSetupError("crm_account_setup_rate_limited");
      if (code === "crm_account_setup_invalid" || code === "crm_account_email_invalid") {
        throw crmAccountSetupError("crm_account_setup_invalid");
      }
      throw crmAccountSetupError("crm_account_setup_unavailable");
    }
  },
);

export const completeCrmAccountSetup = onCall(
  { region: "asia-northeast3", cors: ["https://bring-fm.web.app"] },
  async (request) => {
    try {
      const input = isRecord(request.data) ? request.data : {};
      const displayName = input.displayName === undefined ? "" : normalizeCrmAccountDisplayName(input.displayName);
      const password = validateCrmAccountSetupPassword(input.password);
      const oobCode = input.oobCode;
      if (
        typeof oobCode !== "string"
        || oobCode.length < 6
        || oobCode.length > CRM_ACCOUNT_SETUP_CODE_LIMIT
        || /[\u0000-\u0020\u007f]/u.test(oobCode)
      ) throw new Error("crm_account_setup_invalid");
      const now = Date.now();
      const ipKey = desktopRateKey(safeRequestIp(request));
      await consumeRateLimit(
        adminDatabase.ref(`crmCompany/accountSetupRateLimits/complete/${ipKey}`),
        { limit: 12, windowMs: CRM_ACCOUNT_SETUP_RATE_WINDOW_MS, nowMs: now },
      );
      let resolved: { uid: string; email: string; emailHash: string };
      if (input.uid !== undefined || input.setupToken !== undefined) {
        const tokenHash = crmAccountSetupTokenHash(input.setupToken);
        await consumeRateLimit(
          adminDatabase.ref(`crmCompany/accountSetupRateLimits/complete-token/${tokenHash}`),
          { limit: 8, windowMs: CRM_ACCOUNT_SETUP_RATE_WINDOW_MS, nowMs: now },
        );
        resolved = await resolveCrmAccountSetupInvite(input.uid, input.setupToken, now);
      } else {
        // Compatibility for an older cached setup page. The current page never
        // submits email; legacy requests still require the invite index, a
        // pending CRM member, and Firebase's one-time code for this exact email.
        resolved = await resolveCrmAccountSetupInviteByEmail(input.email, now);
      }
      const { uid, email, emailHash } = resolved;
      await consumeRateLimit(
        adminDatabase.ref(`crmCompany/accountSetupRateLimits/email/${emailHash}`),
        { limit: 8, windowMs: CRM_ACCOUNT_SETUP_RATE_WINDOW_MS, nowMs: now },
      );

      const signedIn = await postCrmIdentityToolkit("signInWithEmailLink", { email, oobCode });
      if (
        typeof signedIn.localId !== "string"
        || signedIn.localId !== uid
        || typeof signedIn.idToken !== "string"
      ) throw new Error("crm_account_setup_invalid");
      const decoded = await adminAuth.verifyIdToken(signedIn.idToken, true);
      if (
        decoded.uid !== uid
        || typeof decoded.email !== "string"
        || normalizeCrmAccountEmail(decoded.email) !== email
      ) throw new Error("crm_account_setup_invalid");

      // The one-time email sign-in code proves mailbox control. Its email is
      // taken from the pre-created Auth identity, never from browser input.
      const authUpdate: { password: string; email: string; emailVerified: boolean; displayName?: string } = {
        password,
        email,
        emailVerified: true,
      };
      if (displayName) authUpdate.displayName = displayName;
      await adminAuth.updateUser(uid, authUpdate);
      const completedAt = Date.now();
      const accountUpdate: Record<string, unknown> = {
        [`crmCompany/accountInvites/${uid}/status`]: "complete",
        [`crmCompany/accountInvites/${uid}/completedAt`]: completedAt,
        [`crmCompany/accountInviteIndex/${emailHash}/status`]: "complete",
        [`crmCompany/access/${uid}/email`]: email,
        [`crmCompany/access/${uid}/accountSetupPending`]: false,
        [`crmCompany/access/${uid}/mustChangePassword`]: false,
      };
      if (displayName) accountUpdate[`crmCompany/access/${uid}/displayName`] = displayName;
      await adminDatabase.ref().update(accountUpdate);
      return { ok: true };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "crm_account_password_invalid" || code === "crm_account_display_name_invalid") {
        throw crmAccountSetupError(code);
      }
      if (
        code === "crm_account_setup_invalid"
        || code === "crm_account_email_invalid"
        || code.startsWith("auth/invalid-action-code")
        || code.startsWith("auth/expired-action-code")
        || code.startsWith("auth/invalid-email")
      ) throw crmAccountSetupError("crm_account_setup_invalid");
      if (code === "field_rate_limit_exceeded") throw crmAccountSetupError("crm_account_setup_rate_limited");
      throw crmAccountSetupError("crm_account_setup_unavailable");
    }
  },
);

const fieldV2CallableOptions = {
  region: "asia-northeast3" as const,
  enforceAppCheck: true,
};

const FIELD_OPERATOR_SWITCH_RATE_WINDOW_MS = 10 * 60 * 1_000;
const FIELD_OPERATOR_SWITCH_UID_RATE_LIMIT = 60;

function fieldOperatorSwitchDependencies(authenticatedEmail: string) {
  return {
    authenticatedEmail,
    now: () => new Date().toISOString(),
    async transact(
      command: FieldOperatorSwitchTransactionCommand,
    ): Promise<ReturnType<typeof reduceFieldOperatorSwitchRoot>["result"]> {
      let decision: FieldOperatorSwitchRootDecision | null = null;
      let rejection: unknown = null;
      let transaction;
      try {
        transaction = await adminDatabase.ref().transaction(
          (current) => {
            try {
              decision = reduceFieldOperatorSwitchRoot(current, command);
              rejection = null;
              return decision.repeated ? undefined : decision.root;
            } catch (error) {
              decision = null;
              rejection = error;
              return undefined;
            }
          },
          undefined,
          false,
        );
      } catch {
        throw new FieldV2Error("field_operator_switch_transaction_failed");
      }
      if (rejection) throw rejection;
      const finalDecision = decision as FieldOperatorSwitchRootDecision | null;
      if (!finalDecision) {
        throw new FieldV2Error("field_operator_switch_transaction_failed");
      }
      if (!finalDecision.repeated && transaction.committed !== true) {
        throw new FieldV2Error("field_operator_switch_transaction_failed");
      }
      return finalDecision.result;
    },
  };
}

const CANONICAL_CRM_HTTP_BODY_BYTES = 32_768;
const CANONICAL_BUILDING_UNITS_BATCH_HTTP_BODY_BYTES = 160 * 1_024;
const CANONICAL_CRM_RATE_WINDOW_MS = 10 * 60 * 1_000;
const CANONICAL_CRM_IP_RATE_LIMIT = 120;
const CANONICAL_CRM_UID_RATE_LIMIT = 60;

function canonicalCrmDependencies(): CanonicalCrmDependencies {
  return {
    authenticatedEmail: "",
    now: () => new Date().toISOString(),
    async transact(command: CanonicalCrmTransactionCommand): Promise<CanonicalCrmCommitResult> {
      let decision: ReturnType<typeof reduceCanonicalCrmEntityRoot> | null = null;
      let rejection: unknown = null;
      let transaction;
      try {
        transaction = await adminDatabase.ref().transaction(
          (current) => {
            try {
              decision = reduceCanonicalCrmEntityRoot(current, command);
              rejection = null;
              return decision.repeated ? undefined : decision.root;
            } catch (error) {
              decision = null;
              rejection = error;
              return undefined;
            }
          },
          undefined,
          false,
        );
      } catch {
        throw new FieldV2Error("crm_transaction_unavailable");
      }
      if (rejection) throw rejection;
      const finalDecision = decision as ReturnType<typeof reduceCanonicalCrmEntityRoot> | null;
      if (!finalDecision) throw new FieldV2Error("crm_transaction_unavailable");
      if (!finalDecision.repeated && transaction.committed !== true) {
        throw new FieldV2Error("crm_transaction_unavailable");
      }
      return finalDecision.result;
    },
  };
}

function canonicalBuildingUnitsBatchDependencies(): CanonicalBuildingUnitsBatchDependencies {
  return {
    authenticatedEmail: "",
    now: () => new Date().toISOString(),
    async transact(
      command: CanonicalBuildingUnitsBatchTransactionCommand,
    ): Promise<CanonicalBuildingUnitsBatchResult> {
      let decision: ReturnType<typeof reduceCanonicalBuildingUnitsBatchRoot> | null = null;
      let rejection: unknown = null;
      let transaction;
      try {
        transaction = await adminDatabase.ref().transaction(
          (current) => {
            try {
              decision = reduceCanonicalBuildingUnitsBatchRoot(current, command);
              rejection = null;
              return decision.repeated ? undefined : decision.root;
            } catch (error) {
              decision = null;
              rejection = error;
              return undefined;
            }
          },
          undefined,
          false,
        );
      } catch {
        throw new FieldV2Error("crm_transaction_unavailable");
      }
      if (rejection) throw rejection;
      const finalDecision = decision as ReturnType<typeof reduceCanonicalBuildingUnitsBatchRoot> | null;
      if (!finalDecision) throw new FieldV2Error("crm_transaction_unavailable");
      if (!finalDecision.repeated && transaction.committed !== true) {
        throw new FieldV2Error("crm_transaction_unavailable");
      }
      return finalDecision.result;
    },
  };
}

function canonicalCrmHttpStatus(code: string): number {
  if (code === "crm_method_not_allowed") return 405;
  if (code === "crm_body_too_large") return 413;
  if (code === "crm_rate_limited") return 429;
  if (code === "crm_auth_required") return 401;
  if (
    code === "crm_access_forbidden"
    || code === "crm_operator_inactive"
    || code === "crm_mutation_forbidden"
    || code === "field_access_forbidden"
    || code === "field_operator_inactive"
    || code === "field_operator_not_enabled"
  ) return 403;
  if (code === "crm_entity_not_found" || code === "crm_parent_not_found") return 404;
  if (
    code === "crm_entity_version_conflict"
    || code === "crm_request_id_conflict"
    || code === "crm_building_unit_label_conflict"
    || code === "crm_vacancy_migration_required"
    || code === "crm_entity_already_archived"
    || code === "crm_entity_not_archived"
  ) return 409;
  if (
    code === "crm_safe_mode_read_only"
    || code === "crm_canonical_writes_disabled"
    || code === "crm_entity_upgrade_required"
    || code === "crm_parent_archived"
    || code === "crm_parent_mismatch"
    || code === "crm_owner_change_requires_atomic_link"
    || code === "field_protocol_mismatch"
    || code === "field_client_upgrade_required"
    || code === "field_client_version_unsupported"
  ) return 412;
  if (code === "crm_transaction_unavailable" || code === "crm_service_unavailable") return 503;
  return code.startsWith("crm_") || code.startsWith("field_") ? 400 : 503;
}

function canonicalCrmHttpCode(error: unknown): string {
  const code = error instanceof FieldV2Error
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
  if (code === "field_rate_limit_exceeded") return "crm_rate_limited";
  if (code === "crm_transaction_unavailable") return "crm_service_unavailable";
  if (
    code.startsWith("crm_")
    || code === "field_access_forbidden"
    || code === "field_operator_inactive"
    || code === "field_operator_not_enabled"
    || code === "field_protocol_mismatch"
    || code === "field_client_upgrade_required"
    || code === "field_client_version_unsupported"
  ) return code;
  return "crm_service_unavailable";
}

function canonicalCrmRawBody(request: {
  rawBody?: unknown;
  get(name: string): string | undefined;
}, maximumBytes = CANONICAL_CRM_HTTP_BODY_BYTES): unknown {
  const rawContentLength = request.get("content-length");
  if (rawContentLength !== undefined) {
    if (!/^\d+$/u.test(rawContentLength)) throw new FieldV2Error("crm_body_invalid");
    if (Number(rawContentLength) > maximumBytes) {
      throw new FieldV2Error("crm_body_too_large");
    }
  }
  const contentType = request.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new FieldV2Error("crm_json_required");
  if (!Buffer.isBuffer(request.rawBody)) throw new FieldV2Error("crm_body_invalid");
  if (request.rawBody.byteLength === 0) throw new FieldV2Error("crm_body_invalid");
  if (request.rawBody.byteLength > maximumBytes) {
    throw new FieldV2Error("crm_body_too_large");
  }
  try {
    return JSON.parse(request.rawBody.toString("utf8")) as unknown;
  } catch {
    throw new FieldV2Error("crm_body_invalid");
  }
}

export const commitCanonicalCrmEntity = onRequest(
  {
    region: "asia-northeast3",
    cors: false,
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    try {
      if (request.method !== "POST") {
        response.set("Allow", "POST");
        throw new FieldV2Error("crm_method_not_allowed");
      }
      const body = canonicalCrmRawBody(request);
      const authorization = request.get("authorization") ?? "";
      const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/u.exec(authorization);
      if (!bearer) throw new FieldV2Error("crm_auth_required");

      const requestIp = typeof request.ip === "string" && request.ip.length > 0
        ? request.ip.slice(0, 128)
        : "unknown";
      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/v2/rateLimits/commitCanonicalCrmEntity/ip/${desktopRateKey(requestIp)}`,
        ),
        {
          limit: CANONICAL_CRM_IP_RATE_LIMIT,
          windowMs: CANONICAL_CRM_RATE_WINDOW_MS,
          nowMs: Date.now(),
        },
      );

      let decoded;
      try {
        decoded = await adminAuth.verifyIdToken(bearer[1], true);
      } catch {
        throw new FieldV2Error("crm_auth_required");
      }
      if (
        !isPathSafeId(decoded.uid)
        || typeof decoded.email !== "string"
        || decoded.email_verified !== true
      ) throw new FieldV2Error("crm_auth_required");
      const authenticatedEmail = decoded.email.trim().toLowerCase();
      if (!authenticatedEmail) throw new FieldV2Error("crm_auth_required");

      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/v2/rateLimits/commitCanonicalCrmEntity/uid/${desktopRateKey(decoded.uid)}`,
        ),
        {
          limit: CANONICAL_CRM_UID_RATE_LIMIT,
          windowMs: CANONICAL_CRM_RATE_WINDOW_MS,
          nowMs: Date.now(),
        },
      );
      const bodyRecord = isRecord(body) ? body : {};
      const actor = await resolveFieldActorCore({
        authUid: decoded.uid,
        operatorId: typeof bodyRecord.operatorId === "string" ? bodyRecord.operatorId : "",
      }, {
        authenticatedEmail,
        async read(path) {
          return (await adminDatabase.ref(path).get()).val();
        },
      });
      const dependencies = canonicalCrmDependencies();
      const result = await commitCanonicalCrmEntityCore(
        body as CanonicalCrmEntityInput,
        actor,
        { ...dependencies, authenticatedEmail },
      );
      response.status(200).json({ ok: true, result });
    } catch (error) {
      const code = canonicalCrmHttpCode(error);
      response.status(canonicalCrmHttpStatus(code)).json({
        ok: false,
        error: { code },
      });
    }
  },
);

function billingMutationHttpStatus(code: string): number {
  if (code === "billing_method_not_allowed") return 405;
  if (code === "billing_body_too_large") return 413;
  if (code === "billing_auth_required") return 401;
  if (code === "billing_access_forbidden") return 403;
  if (code === "billing_rate_limited") return 429;
  if (code === "billing_revision_conflict" || code === "billing_request_id_conflict"
    || code === "billing_duplicate_invoice" || code === "billing_duplicate_transaction"
    || code === "billing_invoice_has_receipts") return 409;
  if (code === "billing_transaction_unavailable") return 503;
  if (code === "billing_ledger_too_large" || code === "billing_stored_ledger_invalid") return 412;
  if (code.startsWith("billing_")) return 400;
  return 503;
}

export const commitBillingLedgerMutation = onRequest(
  { region: "asia-northeast3", cors: false },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    try {
      if (request.method !== "POST") {
        response.set("Allow", "POST");
        throw new Error("billing_method_not_allowed");
      }
      const body = canonicalCrmRawBody(request);
      const authorization = request.get("authorization") ?? "";
      const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/u.exec(authorization);
      if (!bearer) throw new Error("billing_auth_required");

      const requestIp = typeof request.ip === "string" && request.ip.length > 0
        ? request.ip.slice(0, 128) : "unknown";
      await consumeRateLimit(
        adminDatabase.ref(`fieldPlatform/v2/rateLimits/commitBillingLedgerMutation/ip/${desktopRateKey(requestIp)}`),
        { limit: CANONICAL_CRM_IP_RATE_LIMIT, windowMs: CANONICAL_CRM_RATE_WINDOW_MS, nowMs: Date.now() },
      );
      let decoded;
      try {
        decoded = await adminAuth.verifyIdToken(bearer[1], true);
      } catch {
        throw new Error("billing_auth_required");
      }
      if (!isPathSafeId(decoded.uid)) throw new Error("billing_auth_required");
      await consumeRateLimit(
        adminDatabase.ref(`fieldPlatform/v2/rateLimits/commitBillingLedgerMutation/uid/${desktopRateKey(decoded.uid)}`),
        { limit: CANONICAL_CRM_UID_RATE_LIMIT, windowMs: CANONICAL_CRM_RATE_WINDOW_MS, nowMs: Date.now() },
      );
      const access = (await adminDatabase.ref(`crmCompany/access/${decoded.uid}`).get()).val();
      const actor = authorizeBillingActor({
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified,
      }, access);
      const input = isRecord(body) ? body : {};
      const command: BillingMutationCommand = {
        action: input.action as BillingMutationCommand["action"],
        kind: input.kind as BillingMutationCommand["kind"],
        record: isRecord(input.record) ? input.record : {},
        reason: input.reason as string,
        expectedRevision: input.expectedRevision as number,
        requestId: input.requestId as string,
        actor,
        now: new Date().toISOString(),
      };
      const result = await transactBillingLedger(
        adminDatabase.ref("crmCompany/billingLedger"), command,
      );
      response.status(200).json({ ok: true, result: { record: result.record, repeated: result.repeated } });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const code = rawCode === "field_rate_limit_exceeded" ? "billing_rate_limited"
        : rawCode === "crm_body_too_large" ? "billing_body_too_large"
          : rawCode === "crm_body_invalid" ? "billing_body_invalid"
            : rawCode === "crm_json_required" ? "billing_json_required"
          : rawCode.startsWith("billing_") ? rawCode : "billing_transaction_unavailable";
      response.status(billingMutationHttpStatus(code)).json({ ok: false, error: { code } });
    }
  },
);

function cleaningOrderHttpStatus(code: string): number {
  if (code === "cleaning_order_method_not_allowed") return 405;
  if (code === "cleaning_order_auth_required") return 401;
  if (code === "cleaning_order_forbidden") return 403;
  if (code === "cleaning_order_rate_limited") return 429;
  if (code === "cleaning_order_revision_conflict" || code === "cleaning_order_request_conflict" || code === "cleaning_order_completion_evidence_required") return 409;
  if (code === "cleaning_order_not_found" || code === "cleaning_order_customer_not_found" || code === "cleaning_order_building_not_found") return 404;
  if (code === "cleaning_order_body_too_large") return 413;
  if (code === "cleaning_order_stored_data_invalid" || code === "cleaning_order_transaction_unavailable") return 503;
  if (code === "invalid_cleaning_order_input") return 400;
  if (code.startsWith("cleaning_order_")) return 400;
  if (code === "cleaning_quote_forbidden") return 403;
  if (code === "cleaning_quote_not_found" || code === "cleaning_quote_order_not_found") return 404;
  if (code === "cleaning_quote_revision_conflict" || code === "cleaning_quote_request_conflict") return 409;
  if (code === "cleaning_quote_stored_data_invalid" || code === "cleaning_quote_write_failed" || code === "cleaning_quote_transaction_unavailable") return 503;
  if (code.startsWith("cleaning_quote_") || code === "invalid_cleaning_quote_input") return 400;
  if (code === "cleaning_pricing_policy_forbidden") return 403;
  if (code === "cleaning_pricing_policy_request_conflict" || code === "cleaning_pricing_policy_effective_date_conflict") return 409;
  if (code === "cleaning_pricing_policy_stored_data_invalid" || code === "cleaning_pricing_policy_transaction_unavailable") return 503;
  if (code.startsWith("cleaning_pricing_policy_") || code === "invalid_cleaning_pricing_policy") return 400;
  if (code === "cleaning_settlement_forbidden") return 403;
  if (code === "cleaning_settlement_source_invalid") return 503;
  if (code.startsWith("cleaning_settlement_") || code === "invalid_cleaning_settlement_period") return 400;
  return 503;
}

async function authorizeCleaningOrderRequest(request: {
  get(name: string): string | undefined;
  ip?: string;
}): Promise<{ uid: string; role: "admin" | "member" | "viewer" }> {
  const authorization = request.get("authorization") ?? "";
  const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/u.exec(authorization);
  if (!bearer) throw new Error("cleaning_order_auth_required");
  const requestIp = typeof request.ip === "string" && request.ip.length > 0 ? request.ip.slice(0, 128) : "unknown";
  await consumeRateLimit(
    adminDatabase.ref(`fieldPlatform/v2/rateLimits/cleaningOrders/ip/${desktopRateKey(requestIp)}`),
    { limit: CANONICAL_CRM_IP_RATE_LIMIT, windowMs: CANONICAL_CRM_RATE_WINDOW_MS, nowMs: Date.now() },
  );
  let decoded;
  try { decoded = await adminAuth.verifyIdToken(bearer[1], true); }
  catch { throw new Error("cleaning_order_auth_required"); }
  if (!isPathSafeId(decoded.uid) || typeof decoded.email !== "string" || decoded.email_verified !== true) {
    throw new Error("cleaning_order_auth_required");
  }
  await consumeRateLimit(
    adminDatabase.ref(`fieldPlatform/v2/rateLimits/cleaningOrders/uid/${desktopRateKey(decoded.uid)}`),
    { limit: CANONICAL_CRM_UID_RATE_LIMIT, windowMs: CANONICAL_CRM_RATE_WINDOW_MS, nowMs: Date.now() },
  );
  const access = (await adminDatabase.ref(`crmCompany/access/${decoded.uid}`).get()).val();
  const email = decoded.email.trim().toLowerCase();
  if (!isRecord(access) || access.enabled !== true || access.mustChangePassword === true
    || typeof access.email !== "string" || access.email.trim().toLowerCase() !== email
    || !["admin", "member", "viewer"].includes(String(access.role))) {
    throw new Error("cleaning_order_forbidden");
  }
  const role = access.role;
  if (role === "member" && access.marketingRole === "marketing") throw new Error("cleaning_order_forbidden");
  return { uid: decoded.uid, role: role as "admin" | "member" | "viewer" };
}

async function refreshCleaningOrdersWallboardProjection(): Promise<void> {
  // Use the timestamp from before the canonical source read as a freshness watermark.
  // A concurrent write during/after the read must not be hidden by a later completion time.
  const snapshotStartedAt = new Date().toISOString();
  const source = (await adminDatabase.ref("crmCompany/cleaningOrders").get()).val();
  const projection = buildCleaningWallboardProjection(source, snapshotStartedAt);
  await adminDatabase.ref("crmCompany/wallboard/cleaningOperations").transaction(
    current => shouldPublishCleaningWallboardProjection(current, projection) ? projection : undefined,
    undefined,
    false,
  );
}

export const cleaningOrdersApi = onRequest(
  { region: "asia-northeast3", cors: false, secrets: driveSecrets },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    try {
      const actor = await authorizeCleaningOrderRequest(request);
      if (request.method === "GET") {
        const settlementFrom = request.query.settlementFrom;
        const settlementTo = request.query.settlementTo;
        if (settlementFrom !== undefined || settlementTo !== undefined) {
          if (actor.role !== "admin") throw new Error("cleaning_settlement_forbidden");
          const queryKeys = Object.keys(request.query || {});
          const validDay = (value: unknown): value is string => {
            if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
            const day = new Date(`${value}T00:00:00.000Z`);
            return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
          };
          if (queryKeys.length !== 2 || !validDay(settlementFrom) || !validDay(settlementTo)
            || settlementFrom > settlementTo
            || Date.parse(`${settlementTo}T00:00:00.000Z`) - Date.parse(`${settlementFrom}T00:00:00.000Z`) > 31 * 86_400_000) {
            throw new Error("invalid_cleaning_settlement_period");
          }
          const [ordersSnapshot, dispatchesSnapshot, vendorsSnapshot] = await Promise.all([
            adminDatabase.ref("crmCompany/cleaningOrders").get(),
            adminDatabase.ref("crmCompany/cleaningPartnerDispatches").get(),
            adminDatabase.ref("crmCompany/data/partnerVendors").get(),
          ]);
          const rawOrders = ordersSnapshot.val();
          const rawDispatches = dispatchesSnapshot.val();
          const rawVendors = vendorsSnapshot.val();
          const asCollection = (value: unknown): Record<string, unknown> => {
            if (value === null || value === undefined) return {};
            if (!isRecord(value) || Object.keys(value).length > 10_000) throw new Error("cleaning_settlement_source_invalid");
            return value;
          };
          const orderSource = asCollection(rawOrders);
          const dispatchSource = asCollection(rawDispatches);
          const vendorSource = asCollection(rawVendors);
          const orders: Record<string, unknown> = {};
          let invalidCompletedOrderCount = 0;
          for (const [id, value] of Object.entries(orderSource)) {
            if (validateStoredCleaningOrder(value, id)) orders[id] = value;
            else if (isRecord(value) && value.status === "completed" && validDay(value.desiredDate)
              && value.desiredDate >= settlementFrom && value.desiredDate <= settlementTo) invalidCompletedOrderCount += 1;
          }
          const dispatches: Record<string, unknown> = {};
          for (const [id, value] of Object.entries(dispatchSource)) {
            if (validateCleaningPartnerDispatch(value, id)) dispatches[id] = value;
          }
          const vendors: Record<string, unknown> = {};
          for (const [id, value] of Object.entries(vendorSource)) {
            if (isRecord(value) && value.id === id && value.archived !== true && value.deleted !== true) vendors[id] = value;
          }
          const review = buildCleaningSettlementReview({ fromDate: settlementFrom, toDate: settlementTo, orders, dispatches, vendors });
          review.excludedWorkCount += invalidCompletedOrderCount;
          response.status(200).json({ ok: true, result: review });
          return;
        }
        if (request.query.pricingPolicies !== undefined) {
          const queryKeys = Object.keys(request.query || {});
          if (request.query.pricingPolicies !== "1" || queryKeys.length !== 1) throw new Error("invalid_cleaning_pricing_policy");
          if (actor.role === "viewer") throw new Error("cleaning_pricing_policy_forbidden");
          const policiesSnapshot = await adminDatabase.ref("crmCompany/cleaningPricingPolicies").get();
          const rawPolicies = policiesSnapshot.val();
          const entries = isRecord(rawPolicies) ? Object.entries(rawPolicies) : [];
          if (entries.length > 500) throw new Error("cleaning_pricing_policy_stored_data_invalid");
          const policies = entries.map(([policyId, rawRecord]) => {
            if (!isRecord(rawRecord) || !isRecord(rawRecord.policy) || typeof rawRecord.createdAt !== "string"
              || typeof rawRecord.createdByUid !== "string") throw new Error("cleaning_pricing_policy_stored_data_invalid");
            const policy = normalizeCleaningPricingPolicy(rawRecord.policy);
            if (policy.policyId !== policyId) throw new Error("cleaning_pricing_policy_stored_data_invalid");
            return { policy, createdAt: rawRecord.createdAt, createdByUid: rawRecord.createdByUid };
          }).sort((a, b) => b.policy.effectiveFrom.localeCompare(a.policy.effectiveFrom) || b.policy.policyId.localeCompare(a.policy.policyId));
          response.status(200).json({ ok: true, result: { policies } });
          return;
        }
        const rawQuoteOrderId = request.query.quoteOrderId;
        if (rawQuoteOrderId !== undefined) {
          if (typeof rawQuoteOrderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawQuoteOrderId)
            || request.query.beforeCreatedAt !== undefined || request.query.beforeId !== undefined) {
            throw new Error("invalid_cleaning_quote_input");
          }
          const quoteSet = await adminDatabase.ref(`crmCompany/cleaningOrderQuotes/${rawQuoteOrderId}`).get();
          response.status(200).json({ ok: true, result: { quoteSet: quoteSet.val() } });
          return;
        }
        const rawOrderId = request.query.orderId;
        if (rawOrderId !== undefined) {
          if (typeof rawOrderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawOrderId)
            || request.query.beforeCreatedAt !== undefined || request.query.beforeId !== undefined) {
            throw new Error("invalid_cleaning_order_input");
          }
          const snapshot = await adminDatabase.ref(`crmCompany/cleaningOrders/${rawOrderId}`).get();
          const order = snapshot.val();
          if (!validateStoredCleaningOrder(order, rawOrderId)) throw new Error("cleaning_order_not_found");
          response.status(200).json({ ok: true, result: { order } });
          return;
        }
        const rawBeforeCreatedAt = request.query.beforeCreatedAt;
        const rawBeforeId = request.query.beforeId;
        const hasCreatedAt = rawBeforeCreatedAt !== undefined;
        const hasId = rawBeforeId !== undefined;
        if (hasCreatedAt !== hasId
          || (hasCreatedAt && (typeof rawBeforeCreatedAt !== "string" || typeof rawBeforeId !== "string"))) {
          throw new Error("invalid_cleaning_order_input");
        }
        const beforeCreatedAt = hasCreatedAt ? rawBeforeCreatedAt as string : "";
        const beforeId = hasId ? rawBeforeId as string : "";
        if (hasCreatedAt && (!Number.isFinite(Date.parse(beforeCreatedAt))
          || new Date(Date.parse(beforeCreatedAt)).toISOString() !== beforeCreatedAt
          || !/^[A-Za-z0-9_-]{1,150}$/.test(beforeId)
          || ["__proto__", "prototype", "constructor"].includes(beforeId))) {
          throw new Error("invalid_cleaning_order_input");
        }
        const ordersQuery = adminDatabase.ref("crmCompany/cleaningOrders").orderByChild("createdAt");
        const snapshot = beforeCreatedAt
          ? await ordersQuery.endAt(beforeCreatedAt, beforeId).limitToLast(202).get()
          : await ordersQuery.limitToLast(201).get();
        const value = snapshot.val();
        const entries = isRecord(value) ? Object.entries(value) : [];
        const orders: CleaningOrderRecord[] = [];
        for (const [id, order] of entries) {
          if (id === beforeId && isRecord(order) && order.createdAt === beforeCreatedAt) continue;
          if (!validateStoredCleaningOrder(order, id)) throw new Error("cleaning_order_stored_data_invalid");
          orders.push(order);
        }
        orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const hasMore = orders.length > 200;
        const page = orders.slice(0, 200);
        const oldest = page[page.length - 1];
        response.status(200).json({ ok: true, result: {
          orders: page,
          hasMore,
          nextCursor: hasMore && oldest ? { createdAt: oldest.createdAt, id: oldest.id } : null,
        } });
        return;
      }
      if (request.method !== "POST") {
        response.set("Allow", "GET, POST");
        throw new Error("cleaning_order_method_not_allowed");
      }
      if (actor.role === "viewer") throw new Error("cleaning_order_forbidden");
      const body = canonicalCrmRawBody(request);
      if (!isRecord(body) || Object.keys(body).some(key => !["action", "input"].includes(key))
        || typeof body.action !== "string") throw new Error("invalid_cleaning_order_input");
      if (body.action === "pricing-policy-save") {
        if (actor.role !== "admin") throw new Error("cleaning_pricing_policy_forbidden");
        const policyRef = adminDatabase.ref("crmCompany/cleaningPricingPolicies");
        const timestamp = new Date().toISOString();
        let transactionError = "";
        const transaction = await policyRef.transaction(currentValue => {
          const result = createCleaningPricingPolicy(currentValue, body.input, actor, timestamp);
          if (!result.ok) {
            transactionError = result.error;
            return undefined;
          }
          if (result.replayed) return undefined;
          const current = isRecord(currentValue) ? currentValue : {};
          return { ...current, [result.record.policy.policyId]: result.record };
        }, undefined, false);
        const persisted = transaction.snapshot.val();
        const requestInput = body.input;
        const result = createCleaningPricingPolicy(persisted, requestInput, actor, timestamp);
        if (!result.ok) throw new Error(transactionError || result.error);
        response.status(200).json({ ok: true, result: { record: result.record, replayed: !transaction.committed } });
        return;
      }
      const deps = createCleaningOrderFirebaseDependencies(adminDatabase, undefined, async fileIds => {
        // Emulator fixtures are synthetic and never point to production data. Production fails closed
        // unless the company's configured Drive OAuth account confirms real, live image files.
        if (process.env.FUNCTIONS_EMULATOR === "true") return fileIds;
        const adapter = createGoogleDriveMediaAdapterFromOAuth(readDriveOAuthConfig({
          DRIVE_CLIENT_ID: driveClientId.value(),
          DRIVE_CLIENT_SECRET: driveClientSecret.value(),
          DRIVE_REFRESH_TOKEN: driveRefreshToken.value(),
          DRIVE_ROOT_FOLDER_ID: driveRootFolderId.value(),
          DRIVE_ROOT_MODE: driveRootMode.value(),
        }));
        return adapter.verifyImageFileIds(fileIds);
      });
      const result = body.action === "create"
        ? await createCleaningOrderCore(body.input, actor, deps)
        : body.action === "transition"
          ? await transitionCleaningOrderCore(body.input, actor, deps)
          : body.action === "quote-create"
            ? await createCleaningQuoteRevisionCore(body.input, actor, deps)
            : body.action === "quote-review"
              ? await reviewCleaningQuoteCore(body.input, actor, deps)
              : (() => { throw new Error("invalid_cleaning_order_input"); })();
      let wallboardProjectionUpdated = false;
      if (body.action === "create" || body.action === "transition") {
        try {
          await refreshCleaningOrdersWallboardProjection();
          wallboardProjectionUpdated = true;
        } catch {
          // The order mutation is already committed and must not be reported as failed.
          // The database event trigger is the retry/recovery path for this projection.
          console.error("cleaning_order_wallboard_projection_refresh_failed");
        }
      }
      response.status(200).json({ ok: true, result, wallboardProjectionUpdated });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const code = rawCode === "field_rate_limit_exceeded" ? "cleaning_order_rate_limited"
        : rawCode === "crm_body_too_large" ? "cleaning_order_body_too_large"
          : rawCode === "crm_body_invalid" ? "invalid_cleaning_order_input"
            : rawCode === "crm_json_required" ? "invalid_cleaning_order_input"
              : rawCode.startsWith("cleaning_order_") || rawCode.startsWith("cleaning_quote_") || rawCode.startsWith("cleaning_pricing_policy_") || rawCode === "invalid_cleaning_order_input" || rawCode === "invalid_cleaning_quote_input" || rawCode === "invalid_cleaning_pricing_policy" ? rawCode
                : rawCode.startsWith("cleaning_settlement_") || rawCode === "invalid_cleaning_settlement_period" ? rawCode
                  : "cleaning_order_transaction_unavailable";
      response.status(cleaningOrderHttpStatus(code)).json({ ok: false, error: { code } });
    }
  },
);

function cleaningPartnerHttpStatus(code: string): number {
  if (code === "cleaning_partner_auth_required" || code === "cleaning_partner_app_check_required") return 401;
  if (code === "cleaning_partner_forbidden" || code === "cleaning_order_forbidden") return 403;
  if (code === "cleaning_partner_order_not_found" || code === "cleaning_partner_vendor_not_found"
    || code === "cleaning_partner_dispatch_not_found"
    || code === "cleaning_partner_offer_not_found") return 404;
  if (code === "cleaning_partner_order_already_assigned" || code === "cleaning_partner_offer_expired"
    || code === "cleaning_partner_offer_not_expired"
    || code === "cleaning_partner_offer_already_resolved" || code === "cleaning_partner_reassignment_required"
    || code === "cleaning_partner_email_already_bound" || code === "cleaning_partner_offer_conflict"
    || code === "cleaning_partner_revision_conflict" || code === "cleaning_partner_progress_transition_invalid"
    || code === "cleaning_partner_order_not_assigned" || code === "cleaning_partner_reassignment_not_allowed") return 409;
  if (code === "cleaning_delay_order_not_found" || code === "cleaning_delay_dispatch_not_found") return 404;
  if (code === "cleaning_delay_revision_conflict" || code === "cleaning_delay_order_not_active"
    || code === "cleaning_delay_no_active_assignment" || code === "cleaning_delay_incident_not_found") return 409;
  if (code === "cleaning_rework_not_found") return 404;
  if (code === "cleaning_rework_conflict" || code === "cleaning_rework_revision_conflict"
    || code === "cleaning_rework_invalid_transition" || code === "cleaning_rework_order_context_invalid"
    || code === "cleaning_rework_partner_context_invalid") return 409;
  if (code === "cleaning_partner_rate_limited") return 429;
  if (code === "cleaning_partner_body_too_large") return 413;
  if (code === "cleaning_partner_transaction_unavailable" || code === "cleaning_partner_stored_data_invalid") return 503;
  if (code === "cleaning_extra_charge_not_found") return 404;
  if (code === "cleaning_extra_charge_conflict" || code === "cleaning_extra_charge_revision_conflict"
    || code === "cleaning_extra_charge_already_sent" || code === "cleaning_extra_charge_not_awaiting_decision") return 409;
  if (code === "cleaning_extra_charge_data_invalid" || code === "cleaning_extra_charge_transaction_unavailable") return 503;
  if (code === "cleaning_partner_method_not_allowed") return 405;
  return code.startsWith("cleaning_partner_") || code.startsWith("cleaning_extra_charge_") || code.startsWith("cleaning_delay_") || code.startsWith("cleaning_rework_")
    || code === "invalid_cleaning_partner_input" ? 400 : 503;
}

async function verifyCleaningPartnerAppCheck(request: { get(name: string): string | undefined }): Promise<void> {
  const token = request.get("x-firebase-appcheck") ?? request.get("x-firebase-app-check") ?? "";
  if (!token || token.length > 8192) throw new Error("cleaning_partner_app_check_required");
  try { await getAppCheck().verifyToken(token); }
  catch { throw new Error("cleaning_partner_app_check_required"); }
}

async function authorizeCleaningPartnerRequest(request: {
  get(name: string): string | undefined;
  ip?: string;
}): Promise<{ uid: string; email: string; vendorId: string }> {
  await verifyCleaningPartnerAppCheck(request);
  const authorization = request.get("authorization") ?? "";
  const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/u.exec(authorization);
  if (!bearer) throw new Error("cleaning_partner_auth_required");
  let decoded;
  try { decoded = await adminAuth.verifyIdToken(bearer[1], true); }
  catch { throw new Error("cleaning_partner_auth_required"); }
  if (!isPathSafeId(decoded.uid) || typeof decoded.email !== "string" || decoded.email_verified !== true) {
    throw new Error("cleaning_partner_auth_required");
  }
  const requestIp = typeof request.ip === "string" && request.ip.length > 0 ? request.ip.slice(0, 128) : "unknown";
  await consumeRateLimit(
    adminDatabase.ref(`fieldPlatform/v2/rateLimits/cleaningPartners/ip/${desktopRateKey(requestIp)}`),
    { limit: CANONICAL_CRM_IP_RATE_LIMIT, windowMs: CANONICAL_CRM_RATE_WINDOW_MS, nowMs: Date.now() },
  );
  await consumeRateLimit(
    adminDatabase.ref(`fieldPlatform/v2/rateLimits/cleaningPartners/uid/${desktopRateKey(decoded.uid)}`),
    { limit: CANONICAL_CRM_UID_RATE_LIMIT, windowMs: CANONICAL_CRM_RATE_WINDOW_MS, nowMs: Date.now() },
  );
  const deps = createCleaningPartnerFirebaseDependencies(adminDatabase);
  const email = decoded.email.trim().toLowerCase();
  const binding = await deps.readAccountForEmail(email);
  if (!binding || !binding.enabled) throw new Error("cleaning_partner_forbidden");
  return { uid: decoded.uid, email, vendorId: binding.vendorId };
}

export const cleaningPartnerApi = onRequest(
  {
    region: "asia-northeast3",
    secrets: driveSecrets,
    // The partner SPA is Firebase Hosting. Bearer auth and App Check remain mandatory;
    // this explicit origin list only enables its cross-origin HTTPS request.
    cors: ["app://bring-crm", "https://bring-fm.web.app", "https://bring-fm.firebaseapp.com", "http://localhost:3000"],
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    try {
      const deps = createCleaningPartnerFirebaseDependencies(adminDatabase, undefined, async fileIds => {
        // Evidence must resolve to current image files in the authenticated company Drive.
        // Emulator fixtures are synthetic and are never accepted in production.
        if (process.env.FUNCTIONS_EMULATOR === "true") return fileIds;
        const adapter = createGoogleDriveMediaAdapterFromOAuth(readDriveOAuthConfig({
          DRIVE_CLIENT_ID: driveClientId.value(),
          DRIVE_CLIENT_SECRET: driveClientSecret.value(),
          DRIVE_REFRESH_TOKEN: driveRefreshToken.value(),
          DRIVE_ROOT_FOLDER_ID: driveRootFolderId.value(),
          DRIVE_ROOT_MODE: driveRootMode.value(),
        }));
        return adapter.verifyImageFileIds(fileIds);
      }, async fileId => {
        if (process.env.FUNCTIONS_EMULATOR === "true") return null;
        const adapter = createGoogleDriveMediaAdapterFromOAuth(readDriveOAuthConfig({
          DRIVE_CLIENT_ID: driveClientId.value(),
          DRIVE_CLIENT_SECRET: driveClientSecret.value(),
          DRIVE_REFRESH_TOKEN: driveRefreshToken.value(),
          DRIVE_ROOT_FOLDER_ID: driveRootFolderId.value(),
          DRIVE_ROOT_MODE: driveRootMode.value(),
        }));
        const image = await adapter.readImageFile(fileId);
        return { mimeType: image.mimeType, base64: Buffer.from(image.bytes).toString("base64") };
      });
      if (request.method === "GET") {
        const partner = await authorizeCleaningPartnerRequest(request);
        const [offers, rework] = await Promise.all([
          deps.readOffersForEmail(partner.email), deps.readCleaningReworksForEmail(partner.email),
        ]);
        response.status(200).json({ ok: true, result: { vendorId: partner.vendorId, offers, reworkRequests: rework.requests } });
        return;
      }
      if (request.method !== "POST") {
        response.set("Allow", "GET, POST");
        throw new Error("cleaning_partner_method_not_allowed");
      }
      const body = canonicalCrmRawBody(request);
      if (!isRecord(body) || typeof body.action !== "string" || !isRecord(body.input)
        || Object.keys(body).some(key => !["action", "input", "reassignAccepted", "reassignReason"].includes(key))) {
        throw new Error("invalid_cleaning_partner_input");
      }
      if (body.action === "accept" || body.action === "decline") {
        if (Object.keys(body).length !== 2 || Object.keys(body.input).some(key => !["offerId", "action", "reason"].includes(key))
          || Object.keys(body.input).length !== 3 || body.input.action !== body.action
          || typeof body.input.offerId !== "string" || typeof body.input.reason !== "string") {
          throw new Error("invalid_cleaning_partner_input");
        }
        const partner = await authorizeCleaningPartnerRequest(request);
        const result = await deps.respond({
          offerId: body.input.offerId,
          action: body.action,
          reason: body.input.reason,
        }, partner.uid, partner.vendorId);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { orderId: result.dispatch.orderId, revision: result.dispatch.revision } });
        return;
      }
      if (body.action === "progress") {
        if (Object.keys(body).length !== 2 || Object.keys(body.input).length !== 3
          || Object.keys(body.input).some(key => !["offerId", "nextProgress", "expectedRevision"].includes(key))
          || typeof body.input.offerId !== "string" || typeof body.input.nextProgress !== "string"
          || !Number.isSafeInteger(body.input.expectedRevision)) throw new Error("invalid_cleaning_partner_input");
        const partner = await authorizeCleaningPartnerRequest(request);
        const result = await deps.advanceProgress({
          offerId: body.input.offerId,
          nextProgress: body.input.nextProgress,
          expectedRevision: Number(body.input.expectedRevision),
        }, partner.uid, partner.vendorId);
        if (!result.ok) throw new Error(result.error);
        const requestedOfferId = body.input.offerId as string;
        const updatedOffer = result.dispatch.offers.find(item => item.id === requestedOfferId);
        response.status(200).json({ ok: true, result: { orderId: result.dispatch.orderId, revision: updatedOffer?.revision, progress: updatedOffer?.progress } });
        return;
      }
      if (body.action === "rework-photo") {
        const input = body.input;
        if (Object.keys(body).length !== 2 || Object.keys(input).length !== 3 || Object.keys(input).some(key => ![
          "orderId", "requestId", "photoIndex",
        ].includes(key)) || typeof input.orderId !== "string" || typeof input.requestId !== "string"
          || !Number.isSafeInteger(input.photoIndex)) throw new Error("invalid_cleaning_partner_input");
        const partner = await authorizeCleaningPartnerRequest(request);
        const photo = await deps.readCleaningReworkPhotoForEmail(partner.email, input.orderId, input.requestId, Number(input.photoIndex));
        if (!photo) throw new Error("cleaning_partner_photo_not_found");
        response.status(200).json({ ok: true, result: photo });
        return;
      }
      if (body.action === "rework-response") {
        const input = body.input;
        if (Object.keys(body).length !== 2 || Object.keys(input).length !== 5 || Object.keys(input).some(key => ![
          "orderId", "requestId", "expectedRevision", "action", "reason",
        ].includes(key)) || typeof input.orderId !== "string" || typeof input.requestId !== "string"
          || !Number.isSafeInteger(input.expectedRevision) || !["accept", "decline"].includes(String(input.action))
          || typeof input.reason !== "string") throw new Error("invalid_cleaning_partner_input");
        const partner = await authorizeCleaningPartnerRequest(request);
        const result = await deps.respondToCleaningRework(input as Parameters<typeof deps.respondToCleaningRework>[0], partner.uid, partner.vendorId);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { requestId: result.request.requestId, revision: result.request.revision, status: result.request.status } });
        return;
      }
      if (body.action === "rework-progress") {
        const input = body.input;
        if (Object.keys(body).length !== 2 || Object.keys(input).length !== 4 || Object.keys(input).some(key => ![
          "orderId", "requestId", "expectedRevision", "nextStatus",
        ].includes(key)) || typeof input.orderId !== "string" || typeof input.requestId !== "string"
          || !Number.isSafeInteger(input.expectedRevision) || !["in_progress", "awaiting_review"].includes(String(input.nextStatus))) {
          throw new Error("invalid_cleaning_partner_input");
        }
        const partner = await authorizeCleaningPartnerRequest(request);
        const result = await deps.updateCleaningReworkProgress(input as Parameters<typeof deps.updateCleaningReworkProgress>[0], partner.uid, partner.vendorId);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { requestId: result.request.requestId, revision: result.request.revision, status: result.request.status } });
        return;
      }
      const actor = await authorizeCleaningOrderRequest(request);
      if (actor.role !== "admin") throw new Error("cleaning_order_forbidden");
      if (body.action.startsWith("rework-")) {
        if (Object.keys(body).length !== 2) throw new Error("invalid_cleaning_partner_input");
        const input = body.input;
        if (body.action === "rework-inspect") {
          if (Object.keys(input).length !== 1 || typeof input.orderId !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.orderId)) {
            throw new Error("invalid_cleaning_partner_input");
          }
          response.status(200).json({ ok: true, result: { requests: await deps.readCleaningReworkRequests(input.orderId) } });
          return;
        }
        if (body.action === "rework-create") {
          const result = await deps.createCleaningReworkRequest(input, actor.uid);
          if (!result.ok) throw new Error(result.error);
          response.status(200).json({ ok: true, result: { request: result.request } });
          return;
        }
        if (body.action === "rework-complete") {
          if (Object.keys(input).length !== 4 || Object.keys(input).some(key => ![
            "orderId", "requestId", "expectedRevision", "reportId",
          ].includes(key)) || typeof input.orderId !== "string" || typeof input.requestId !== "string"
            || !Number.isSafeInteger(input.expectedRevision) || typeof input.reportId !== "string") {
            throw new Error("invalid_cleaning_partner_input");
          }
          const result = await deps.completeCleaningRework(input as Parameters<typeof deps.completeCleaningRework>[0], actor.uid);
          if (!result.ok) throw new Error(result.error);
          response.status(200).json({ ok: true, result: { request: result.request } });
          return;
        }
      }
      if (body.action === "delay-record-incident") {
        const input = body.input;
        if (Object.keys(body).length !== 2 || Object.keys(input).length !== 7 || Object.keys(input).some(key => ![
          "incidentId", "orderId", "expectedRevision", "issueType", "scheduledAt", "delayMinutes", "note",
        ].includes(key)) || typeof input.incidentId !== "string" || typeof input.orderId !== "string"
          || !Number.isSafeInteger(input.expectedRevision) || typeof input.issueType !== "string"
          || typeof input.scheduledAt !== "string" || !Number.isSafeInteger(input.delayMinutes) || typeof input.note !== "string") {
          throw new Error("invalid_cleaning_partner_input");
        }
        const result = await deps.recordDelayIncident(input as unknown as CleaningDelayIncidentInput, actor.uid);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { orderId: result.dispatch.orderId, revision: result.dispatch.revision } });
        return;
      }
      if (body.action === "delay-record-action") {
        const input = body.input;
        if (Object.keys(body).length !== 2 || Object.keys(input).length !== 5 || Object.keys(input).some(key => ![
          "incidentId", "orderId", "expectedRevision", "action", "note",
        ].includes(key)) || typeof input.incidentId !== "string" || typeof input.orderId !== "string"
          || !Number.isSafeInteger(input.expectedRevision) || typeof input.action !== "string" || typeof input.note !== "string") {
          throw new Error("invalid_cleaning_partner_input");
        }
        const result = await deps.recordDelayAction(input as unknown as CleaningDelayActionInput, actor.uid);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { orderId: result.dispatch.orderId, revision: result.dispatch.revision } });
        return;
      }
      if (body.action.startsWith("extra-charge-")) {
        if (Object.keys(body).length !== 2) throw new Error("invalid_cleaning_partner_input");
        const input = body.input;
        if (body.action === "extra-charge-inspect") {
          if (Object.keys(input).length !== 1 || Object.keys(input)[0] !== "orderId"
            || typeof input.orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.orderId)) {
            throw new Error("invalid_cleaning_partner_input");
          }
          const orderSnapshot = await adminDatabase.ref(`crmCompany/cleaningOrders/${input.orderId}`).get();
          if (!validateStoredCleaningOrder(orderSnapshot.val(), input.orderId)) throw new Error("cleaning_partner_order_not_found");
          const requests = await deps.readExtraChargeRequests(input.orderId);
          response.status(200).json({ ok: true, result: { requests } });
          return;
        }
        if (body.action === "extra-charge-create") {
          if (Object.keys(input).length !== 9 || Object.keys(input).some(key => ![
            "requestId", "orderId", "customerId", "buildingId", "vendorId", "serviceType", "amount", "reason", "evidenceFileIds",
          ].includes(key))) throw new Error("invalid_cleaning_partner_input");
          const result = await deps.createExtraChargeRequest(input, actor.uid);
          if (!result.ok) throw new Error(result.error);
          response.status(200).json({ ok: true, result: { request: result.request } });
          return;
        }
        if (body.action === "extra-charge-record-delivery") {
          if (Object.keys(input).length !== 4 || Object.keys(input).some(key => !["orderId", "requestId", "expectedRevision", "messageDeliveryId"].includes(key))
            || typeof input.orderId !== "string" || typeof input.requestId !== "string"
            || typeof input.messageDeliveryId !== "string" || !Number.isSafeInteger(input.expectedRevision)) {
            throw new Error("invalid_cleaning_partner_input");
          }
          const result = await deps.recordExtraChargeDelivery({
            orderId: input.orderId, requestId: input.requestId, expectedRevision: Number(input.expectedRevision), messageDeliveryId: input.messageDeliveryId,
          }, actor.uid);
          if (!result.ok) throw new Error(result.error);
          response.status(200).json({ ok: true, result: { request: result.request } });
          return;
        }
        if (body.action === "extra-charge-decision") {
          if (Object.keys(input).length !== 5 || Object.keys(input).some(key => !["orderId", "requestId", "expectedRevision", "decision", "evidenceRef"].includes(key))
            || typeof input.orderId !== "string" || typeof input.requestId !== "string"
            || !Number.isSafeInteger(input.expectedRevision) || typeof input.decision !== "string" || typeof input.evidenceRef !== "string") {
            throw new Error("invalid_cleaning_partner_input");
          }
          const result = await deps.recordExtraChargeDecision({
            orderId: input.orderId, requestId: input.requestId, expectedRevision: Number(input.expectedRevision),
            decision: input.decision as "approve" | "decline", evidenceRef: input.evidenceRef,
          }, actor.uid);
          if (!result.ok) throw new Error(result.error);
          response.status(200).json({ ok: true, result: { request: result.request } });
          return;
        }
      }
      if (body.action === "inspect-dispatch") {
        if (Object.keys(body).length !== 2 || Object.keys(body.input).length !== 1
          || Object.keys(body.input)[0] !== "orderId" || typeof body.input.orderId !== "string") {
          throw new Error("invalid_cleaning_partner_input");
        }
        const dispatch = await deps.expireDueOffers(body.input.orderId, actor.uid);
        response.status(200).json({ ok: true, result: { dispatch } });
        return;
      }
      if (body.action === "expire-offer") {
        if (Object.keys(body).length !== 2 || Object.keys(body.input).length !== 3
          || Object.keys(body.input).some(key => !["orderId", "offerId", "expectedRevision"].includes(key))
          || typeof body.input.orderId !== "string" || typeof body.input.offerId !== "string"
          || !Number.isSafeInteger(body.input.expectedRevision)) throw new Error("invalid_cleaning_partner_input");
        const result = await deps.expireOffer({
          orderId: body.input.orderId,
          offerId: body.input.offerId,
          expectedRevision: Number(body.input.expectedRevision),
        }, actor.uid);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { orderId: result.dispatch.orderId, revision: result.dispatch.revision } });
        return;
      }
      if (body.action === "bind-account") {
        if (Object.keys(body).length !== 2 || Object.keys(body.input).length !== 3
          || Object.keys(body.input).some(key => !["vendorId", "email", "enabled"].includes(key))
          || typeof body.input.vendorId !== "string" || typeof body.input.email !== "string" || typeof body.input.enabled !== "boolean") {
          throw new Error("invalid_cleaning_partner_input");
        }
        let partnerUser;
        try { partnerUser = await adminAuth.getUserByEmail(body.input.email.trim().toLowerCase()); }
        catch (error) {
          const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
          if (code === "auth/user-not-found") throw new Error("cleaning_partner_email_unverified");
          throw error;
        }
        if (partnerUser.disabled || partnerUser.emailVerified !== true) throw new Error("cleaning_partner_email_unverified");
        const result = await deps.bindAccount(body.input.vendorId, body.input.email, body.input.enabled, actor.uid);
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { binding: result.binding } });
        return;
      }
      if (body.action === "offer" || body.action === "reassign") {
        if (body.reassignAccepted !== undefined && typeof body.reassignAccepted !== "boolean") {
          throw new Error("invalid_cleaning_partner_input");
        }
        if (body.reassignReason !== undefined && (typeof body.reassignReason !== "string" || body.reassignReason.length > 500)
          || body.action !== "reassign" && body.reassignReason !== undefined) throw new Error("invalid_cleaning_partner_input");
        const result = await deps.createOffer(body.input, actor.uid, body.action === "reassign" && body.reassignAccepted === true,
          typeof body.reassignReason === "string" ? body.reassignReason : "");
        if (!result.ok) throw new Error(result.error);
        response.status(200).json({ ok: true, result: { orderId: result.dispatch.orderId, revision: result.dispatch.revision } });
        return;
      }
      throw new Error("invalid_cleaning_partner_input");
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const code = rawCode === "field_rate_limit_exceeded" ? "cleaning_partner_rate_limited"
        : rawCode === "crm_body_too_large" ? "cleaning_partner_body_too_large"
          : rawCode === "crm_body_invalid" || rawCode === "crm_json_required" ? "invalid_cleaning_partner_input"
      : rawCode === "cleaning_partner_email_unverified" || rawCode.startsWith("cleaning_partner_") || rawCode.startsWith("cleaning_order_") || rawCode.startsWith("cleaning_extra_charge_") || rawCode.startsWith("cleaning_delay_") || rawCode === "invalid_cleaning_partner_input"
              || rawCode.startsWith("cleaning_rework_")
              ? rawCode : "cleaning_partner_transaction_unavailable";
      response.status(cleaningPartnerHttpStatus(code)).json({ ok: false, error: { code } });
    }
  },
);

function cleaningRefundHttpStatus(code: string): number {
  if (code === "cleaning_refund_auth_required") return 401;
  if (code === "cleaning_refund_forbidden") return 403;
  if (code === "cleaning_refund_order_not_found" || code === "cleaning_refund_invoice_not_found") return 404;
  if (code === "cleaning_refund_conflict" || code === "cleaning_refund_revision_conflict" || code === "cleaning_refund_invalid_transition" || code === "cleaning_refund_paid_balance_changed") return 409;
  if (code === "cleaning_refund_transaction_unavailable" || code === "cleaning_refund_stored_data_invalid") return 503;
  if (code === "cleaning_refund_method_not_allowed") return 405;
  if (code === "cleaning_refund_body_too_large") return 413;
  return code.startsWith("cleaning_refund_") || code === "invalid_cleaning_refund_input" ? 400 : 503;
}

export const cleaningRefundsApi = onRequest(
  { region: "asia-northeast3", cors: false },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    try {
      const actor = await authorizeCleaningOrderRequest(request);
      if (actor.role !== "admin") throw new Error("cleaning_refund_forbidden");
      const orderId = request.method === "GET" ? request.query.orderId : "";
      if (request.method === "GET") {
        if (typeof orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(orderId)) throw new Error("invalid_cleaning_refund_input");
        const order = await adminDatabase.ref(`crmCompany/cleaningOrders/${orderId}`).get();
        if (!validateStoredCleaningOrder(order.val(), orderId)) throw new Error("cleaning_refund_order_not_found");
        const [snapshot, ledgerSnapshot] = await Promise.all([
          adminDatabase.ref(`crmCompany/cleaningRefundRequests/${orderId}`).get(),
          adminDatabase.ref("crmCompany/billingLedger").get(),
        ]);
        const value = snapshot.val();
        const requests = isRecord(value) ? Object.values(value) : [];
        if (requests.some(item => !validateCleaningRefundRequest(item))) throw new Error("cleaning_refund_stored_data_invalid");
        const ledger = ledgerSnapshot.val();
        if (auditBillingLedger(ledger).length > 0 || !isRecord(ledger)) throw new Error("cleaning_refund_stored_data_invalid");
        const invoices = isRecord(ledger.invoices) ? ledger.invoices : {};
        const receipts = isRecord(ledger.receipts) ? ledger.receipts : {};
        const invoice = Object.values(invoices).find(item => isRecord(item) && item.status === "approved"
          && item.contractType === "one_off" && item.occurrenceId === orderId);
        const paidAmount = isRecord(invoice) && typeof invoice.id === "string"
          ? Object.values(receipts).filter(item => isRecord(item) && item.status === "approved" && item.invoiceId === invoice.id)
            .reduce<number>((total, item) => total + Number(isRecord(item) ? item.amount : 0), 0) : 0;
        const reservedAmount = requests.filter((item): item is CleaningRefundRequest => validateCleaningRefundRequest(item)
          && item.status !== "declined").reduce((total, item) => total + item.amount, 0);
        response.status(200).json({ ok: true, result: { requests,
          payment: { invoiceId: isRecord(invoice) ? String(invoice.id || "") : "", paidAmount,
            remainingAmount: Math.max(0, paidAmount - reservedAmount) } } });
        return;
      }
      if (request.method !== "POST") { response.set("Allow", "GET, POST"); throw new Error("cleaning_refund_method_not_allowed"); }
      const body = canonicalCrmRawBody(request);
      if (!isRecord(body) || Object.keys(body).some(key => !["action", "input"].includes(key))
        || typeof body.action !== "string" || !isRecord(body.input)) throw new Error("invalid_cleaning_refund_input");
      const input = body.input;
      const allowedAction = ["create", "decide", "record-execution"].includes(body.action);
      if (!allowedAction || typeof input.orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.orderId)) throw new Error("invalid_cleaning_refund_input");
      const orderSnapshot = await adminDatabase.ref(`crmCompany/cleaningOrders/${input.orderId}`).get();
      const order = orderSnapshot.val();
      if (!validateStoredCleaningOrder(order, input.orderId)) throw new Error("cleaning_refund_order_not_found");
      const ledgerSnapshot = await adminDatabase.ref("crmCompany/billingLedger").get();
      const ledger = ledgerSnapshot.val();
      if (auditBillingLedger(ledger).length > 0 || !isRecord(ledger)) throw new Error("cleaning_refund_stored_data_invalid");
      const invoices = isRecord(ledger.invoices) ? ledger.invoices : {};
      const receipts = isRecord(ledger.receipts) ? ledger.receipts : {};
      const invoice = Object.values(invoices).find(item => isRecord(item) && item.status === "approved"
        && item.contractType === "one_off" && item.occurrenceId === input.orderId);
      if (!isRecord(invoice) || typeof invoice.id !== "string") throw new Error("cleaning_refund_invoice_not_found");
      const paidAmount = Object.values(receipts).filter(item => isRecord(item) && item.status === "approved" && item.invoiceId === invoice.id)
        .reduce<number>((total, item) => total + Number(isRecord(item) ? item.amount : 0), 0);
      if (!Number.isSafeInteger(paidAmount) || paidAmount <= 0 || paidAmount > Number(invoice.amount)) throw new Error("cleaning_refund_invoice_not_found");
      const context = { orderId: order.id, customerId: order.customerId, buildingId: order.buildingId, invoiceId: invoice.id, paidAmount };
      const collection = adminDatabase.ref(`crmCompany/cleaningRefundRequests/${input.orderId}`);
      let decisionError = "";
      let decision: { request: CleaningRefundRequest } | null = null;
      const result = await collection.transaction(current => {
        try {
          let next: CleaningRefundRequest;
          if (body.action === "create") {
            if (Object.keys(body).length !== 2 || Object.keys(input).some(key => !["requestId", "orderId", "type", "amount", "reason", "paymentMethod", "csReference", "note"].includes(key))) throw new Error("invalid_cleaning_refund_input");
            const created = createCleaningRefundRequest(current, { ...input, customerId: context.customerId, buildingId: context.buildingId, invoiceId: context.invoiceId }, context, actor.uid, new Date().toISOString());
            if (!created.ok) throw new Error(created.error);
            next = created.request;
            decision = { request: next };
            return { ...(isRecord(current) ? current : {}), [next.requestId]: next };
          }
          if (Object.keys(body).length !== 2 || typeof input.requestId !== "string") throw new Error("invalid_cleaning_refund_input");
          const expectedFields = body.action === "decide"
            ? ["orderId", "requestId", "expectedRevision", "decision", "note"]
            : ["orderId", "requestId", "expectedRevision", "providerRef", "evidenceRef"];
          if (Object.keys(input).some(key => !expectedFields.includes(key))
            || expectedFields.some(key => !Object.hasOwn(input, key))) throw new Error("invalid_cleaning_refund_input");
          const existing = isRecord(current) ? current[input.requestId] : undefined;
          if (!(body.action === "decide" && input.decision === "decline") && !cleaningRefundCoverageIsValid(current, paidAmount)) {
            throw new Error("cleaning_refund_paid_balance_changed");
          }
          const requestInput = { ...input, actorUid: actor.uid, now: new Date().toISOString() };
          const changed = body.action === "decide"
            ? decideCleaningRefundRequest(existing, requestInput as Parameters<typeof decideCleaningRefundRequest>[1])
            : recordCleaningRefundExecution(existing, requestInput as Parameters<typeof recordCleaningRefundExecution>[1]);
          if (!changed.ok) throw new Error(changed.error);
          next = changed.request;
          decision = { request: next };
          return { ...(isRecord(current) ? current : {}), [next.requestId]: next };
        } catch (error) {
          decisionError = error instanceof Error ? error.message : "cleaning_refund_transaction_unavailable";
          decision = null;
          return undefined;
        }
      }, undefined, false);
      const committedDecision = decision as { request: CleaningRefundRequest } | null;
      if (!result.committed || !committedDecision) throw new Error(decisionError || "cleaning_refund_transaction_unavailable");
      response.status(200).json({ ok: true, result: { request: committedDecision.request } });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const code = rawCode === "cleaning_order_auth_required" ? "cleaning_refund_auth_required"
        : rawCode === "cleaning_order_forbidden" ? "cleaning_refund_forbidden"
          : rawCode === "field_rate_limit_exceeded" ? "cleaning_refund_rate_limited"
        : rawCode === "crm_body_too_large" ? "cleaning_refund_body_too_large"
          : rawCode.startsWith("cleaning_refund_") || rawCode === "invalid_cleaning_refund_input" ? rawCode
            : "cleaning_refund_transaction_unavailable";
      response.status(cleaningRefundHttpStatus(code)).json({ ok: false, error: { code } });
    }
  },
);

const cleaningOrdersDatabaseIsEmulated = process.env.FUNCTIONS_EMULATOR === "true";
// Rules-unit-testing binds to the project-ID namespace; production uses the
// explicitly verified company RTDB instance.
const cleaningOrdersDatabaseInstance = cleaningOrdersDatabaseIsEmulated
  ? process.env.GCLOUD_PROJECT || "bring-fm"
  : "bring-fm-default-rtdb";
export const projectCleaningOrdersToWallboard = onValueWritten(
  {
    ref: "/crmCompany/cleaningOrders/{orderId}",
    instance: cleaningOrdersDatabaseInstance,
    // Firebase CLI currently routes RTDB emulator triggers only from us-central1.
    // Production remains pinned to the verified company RTDB region.
    region: cleaningOrdersDatabaseIsEmulated ? "us-central1" : "asia-southeast1",
    // This is a recovery path; API mutations publish synchronously. Keep one instance,
    // but allow a small bounded concurrency so historical imports do not leave a long
    // queue of projection freshness checks behind.
    maxInstances: 1,
    concurrency: 10,
  },
  async (event) => {
    const orderAfter = event.data.after.val();
    let currentProjection: unknown = null;
    try {
      currentProjection = (await adminDatabase.ref("crmCompany/wallboard/cleaningOperations").get()).val();
    } catch {
      // Continue with a full rebuild if the marker cannot be read; the source read/write
      // below remains the authoritative recovery operation.
    }
    if (shouldRebuildCleaningWallboardProjection(orderAfter, currentProjection)) {
      await refreshCleaningOrdersWallboardProjection();
    }
  },
);

export const configureBuildingUnits = onRequest(
  {
    region: "asia-northeast3",
    cors: false,
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    try {
      if (request.method !== "POST") {
        response.set("Allow", "POST");
        throw new FieldV2Error("crm_method_not_allowed");
      }
      const body = canonicalCrmRawBody(
        request,
        CANONICAL_BUILDING_UNITS_BATCH_HTTP_BODY_BYTES,
      );
      const authorization = request.get("authorization") ?? "";
      const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/u.exec(authorization);
      if (!bearer) throw new FieldV2Error("crm_auth_required");

      const requestIp = typeof request.ip === "string" && request.ip.length > 0
        ? request.ip.slice(0, 128)
        : "unknown";
      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/v2/rateLimits/commitCanonicalCrmEntity/ip/${desktopRateKey(requestIp)}`,
        ),
        {
          limit: CANONICAL_CRM_IP_RATE_LIMIT,
          windowMs: CANONICAL_CRM_RATE_WINDOW_MS,
          nowMs: Date.now(),
        },
      );

      let decoded;
      try {
        decoded = await adminAuth.verifyIdToken(bearer[1], true);
      } catch {
        throw new FieldV2Error("crm_auth_required");
      }
      if (
        !isPathSafeId(decoded.uid)
        || typeof decoded.email !== "string"
        || decoded.email_verified !== true
      ) throw new FieldV2Error("crm_auth_required");
      const authenticatedEmail = decoded.email.trim().toLowerCase();
      if (!authenticatedEmail) throw new FieldV2Error("crm_auth_required");

      await consumeRateLimit(
        adminDatabase.ref(
          `fieldPlatform/v2/rateLimits/commitCanonicalCrmEntity/uid/${desktopRateKey(decoded.uid)}`,
        ),
        {
          limit: CANONICAL_CRM_UID_RATE_LIMIT,
          windowMs: CANONICAL_CRM_RATE_WINDOW_MS,
          nowMs: Date.now(),
        },
      );
      const bodyRecord = isRecord(body) ? body : {};
      const actor = await resolveFieldActorCore({
        authUid: decoded.uid,
        operatorId: typeof bodyRecord.operatorId === "string" ? bodyRecord.operatorId : "",
      }, {
        authenticatedEmail,
        async read(path) {
          return (await adminDatabase.ref(path).get()).val();
        },
      });
      if (actor.role !== "admin" && actor.role !== "member") {
        throw new FieldV2Error("crm_mutation_forbidden");
      }
      const dependencies = canonicalBuildingUnitsBatchDependencies();
      const result = await commitCanonicalBuildingUnitsBatch(
        body as CanonicalBuildingUnitsBatchInput,
        actor,
        { ...dependencies, authenticatedEmail },
      );
      response.status(200).json({ ok: true, result });
    } catch (error) {
      const code = canonicalCrmHttpCode(error);
      response.status(canonicalCrmHttpStatus(code)).json({
        ok: false,
        error: { code },
      });
    }
  },
);

export const createFieldJobs = onCall<CreateFieldJobsInput & FieldV2CallableData>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const context = await prepareFieldV2Request(request, "createJob");
      const { actor, config, data } = context;
      return await createFieldJobsCore(
        data as unknown as CreateFieldJobsInput,
        actor,
        fieldV2WorkDependenciesFor(config, "createJob", context),
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
      const context = await prepareFieldV2Request(request, "claimJob");
      const { actor, config, data } = context;
      return await claimFieldJobCore(
        data as unknown as ClaimFieldJobInput,
        actor,
        fieldV2WorkDependenciesFor(config, "claimJob", context),
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
      const context = await prepareFieldV2Request(request, "assignJob");
      const { actor, config, data } = context;
      return await assignFieldJobCore(
        data as unknown as AssignFieldJobInput,
        actor,
        fieldV2WorkDependenciesFor(config, "assignJob", context),
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
      const context = await prepareFieldV2Request(request, "changeVisit");
      const { actor, config, data } = context;
      return await changeFieldVisitCore(
        data as unknown as ChangeFieldVisitInput,
        actor,
        fieldV2WorkDependenciesFor(config, "changeVisit", context),
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
      const context = await prepareFieldV2Request(request, "transitionJob");
      const { actor, config, data } = context;
      return await transitionFieldJobCore(
        data as unknown as TransitionFieldJobInput,
        actor,
        fieldV2WorkDependenciesFor(config, "transitionJob", context),
      );
    } catch (error) {
      return rethrowFieldV2CallableError(error);
    }
  },
);

export const recordFieldOperatorSwitch = onCall<RecordFieldOperatorSwitchInput>(
  fieldV2CallableOptions,
  async (request) => {
    try {
      const context = await prepareFieldV2Request(request, "operatorSwitch");
      assertFieldReleaseCompatible(context.config, context.client);
      try {
        await consumeRateLimit(
          adminDatabase.ref(
            `fieldPlatform/v2/rateLimits/recordFieldOperatorSwitch/uid/${desktopRateKey(context.actor.authUid)}`,
          ),
          {
            limit: FIELD_OPERATOR_SWITCH_UID_RATE_LIMIT,
            windowMs: FIELD_OPERATOR_SWITCH_RATE_WINDOW_MS,
            nowMs: Date.now(),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        throw new FieldV2Error(message === "field_rate_limit_exceeded"
          ? "field_operator_switch_rate_limited"
          : "field_operator_switch_rate_limit_unavailable");
      }
      return await recordFieldOperatorSwitchCore(
        context.data as unknown as RecordFieldOperatorSwitchInput,
        context.actor,
        fieldOperatorSwitchDependencies(context.authenticatedEmail),
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
      const context = await prepareFieldV2Request(request, "read");
      const { actor, config } = context;
      return await listFieldOperationsWorkspaceCore(
        request.data as unknown as ListFieldOperationsWorkspaceInput,
        actor,
        fieldV2WorkDependenciesFor(config, "read", context),
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

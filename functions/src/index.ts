import { Buffer } from "node:buffer";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase, ServerValue } from "firebase-admin/database";
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

if (getApps().length === 0) {
  initializeApp();
}

const adminAuth = getAuth();
const adminDatabase = getDatabase();
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

export async function requireFieldActor(
  request: CallableRequest<unknown>,
): Promise<FieldActor> {
  const uid = request.auth?.uid;
  const claimedRole = request.auth?.token.fieldRole;
  if (
    !isPathSafeId(uid) ||
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

  return { uid, role: claimedRole, enabled: true };
}

function rethrowAsCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : null;

  if (
    message === "field_invalid_registration" ||
    message === "field_owner_notes_not_enabled" ||
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

const mapProjectionDependencies: RebuildMapProjectionDependencies = {
  getBuilding,
  getListings,
  getMedia,
  async setProjection(buildingId, projection) {
    await adminDatabase
      .ref(`fieldPlatform/mapProjections/${buildingId}`)
      .set(projection);
  },
  now: () => new Date().toISOString(),
};

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
  now: () => new Date().toISOString(),
};

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

function buildingIdFromWriteValues(
  afterValue: unknown,
  beforeValue: unknown,
): string | null {
  for (const value of [afterValue, beforeValue]) {
    if (isRecord(value) && isPathSafeId(value.buildingId)) {
      return value.buildingId;
    }
  }
  return null;
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
    await rebuildMapProjectionForBuilding(
      buildingId,
      mapProjectionDependencies,
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
    const buildingId = buildingIdFromWriteValues(
      event.data.after.val(),
      event.data.before.val(),
    );
    if (buildingId === null) return;
    await rebuildMapProjectionForBuilding(
      buildingId,
      mapProjectionDependencies,
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
    const buildingId = buildingIdFromWriteValues(
      event.data.after.val(),
      event.data.before.val(),
    );
    if (buildingId === null) return;
    await rebuildMapProjectionForBuilding(
      buildingId,
      mapProjectionDependencies,
    );
  },
);

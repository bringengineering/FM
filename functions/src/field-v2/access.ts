import { Buffer } from "node:buffer";

import {
  FieldV2Error,
  type FieldCrmRole,
  type FieldV2Actor,
} from "./contracts.js";

export interface ResolveFieldActorInput {
  authUid: string;
  operatorId: string;
}

export interface FieldActorDependencies {
  read(path: string): Promise<unknown>;
  authenticatedEmail: string;
}

interface CrmAccessRecord {
  enabled: true;
  role: FieldCrmRole;
  email: string;
}

interface TeamProfileRecord {
  active: boolean;
  displayName: string;
}

const CRM_ROLES = new Set<FieldCrmRole>(["admin", "member", "viewer"]);
const FIREBASE_KEY_PATTERN = /^[^.#$\[\]/\u0000-\u001f\u007f]+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFirebaseKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 128
    && FIREBASE_KEY_PATTERN.test(value);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseAccess(value: unknown): CrmAccessRecord | null {
  if (
    !isRecord(value)
    || value.enabled !== true
    || typeof value.role !== "string"
    || !CRM_ROLES.has(value.role as FieldCrmRole)
    || typeof value.email !== "string"
  ) return null;
  return value as unknown as CrmAccessRecord;
}

function parseProfile(value: unknown): TeamProfileRecord | null {
  if (!isRecord(value) || typeof value.active !== "boolean") return null;
  const displayName = typeof value.displayName === "string"
    ? value.displayName.trim()
    : "";
  if (
    displayName.length === 0
    || displayName !== value.displayName
    || Buffer.byteLength(displayName, "utf8") > 120
    || /[\u0000-\u001f\u007f]/u.test(displayName)
  ) return null;
  return { active: value.active, displayName };
}

export async function resolveFieldActorCore(
  input: ResolveFieldActorInput,
  dependencies: FieldActorDependencies,
): Promise<FieldV2Actor> {
  if (
    !isRecord(input)
    || !isRecord(dependencies)
    || typeof dependencies.read !== "function"
  ) {
    throw new FieldV2Error("field_access_forbidden");
  }
  if (!isFirebaseKey(input.authUid)) {
    throw new FieldV2Error("field_access_forbidden");
  }
  if (!isFirebaseKey(input.operatorId)) {
    throw new FieldV2Error("field_operator_invalid");
  }

  const authenticatedEmail = normalizeEmail(dependencies.authenticatedEmail);
  if (!authenticatedEmail) {
    throw new FieldV2Error("field_access_forbidden");
  }

  let accessValue: unknown;
  try {
    accessValue = await dependencies.read(`crmCompany/access/${input.authUid}`);
  } catch {
    throw new FieldV2Error("field_access_forbidden");
  }
  const access = parseAccess(accessValue);
  const accessEmail = normalizeEmail(access?.email);
  if (!access || !accessEmail || authenticatedEmail !== accessEmail) {
    throw new FieldV2Error("field_access_forbidden");
  }

  let profileValue: unknown;
  try {
    profileValue = await dependencies.read(
      `crmCompany/teamProfiles/${input.operatorId}`,
    );
  } catch {
    throw new FieldV2Error("field_operator_invalid");
  }
  const profile = parseProfile(profileValue);
  if (!profile) throw new FieldV2Error("field_operator_invalid");
  if (!profile.active) throw new FieldV2Error("field_operator_inactive");

  return {
    authUid: input.authUid,
    operatorId: input.operatorId,
    displayName: profile.displayName,
    role: access.role,
  };
}

export function assertFieldActorCanMutate(
  actor: FieldV2Actor,
): { allowed: true } {
  if (
    !isRecord(actor)
    || (actor.role !== "admin" && actor.role !== "member")
  ) {
    throw new FieldV2Error("field_mutation_forbidden");
  }
  return { allowed: true };
}

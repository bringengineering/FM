import { createHash } from "node:crypto";

export type FieldRole = "admin" | "staff" | "reviewer";

export interface AllowedEmailRecord {
  active: boolean;
  role: FieldRole;
}

export interface FieldUserProvisionRecord {
  role: FieldRole;
  enabled: true;
  updatedAt: number | object;
}

export interface ProvisionFieldUserDependencies {
  getAllowedEmail(emailHash: string): Promise<AllowedEmailRecord | null>;
  setCustomClaims(
    uid: string,
    claims: { fieldPlatform: true; fieldRole: FieldRole },
  ): Promise<void>;
  writeFieldUser(uid: string, record: FieldUserProvisionRecord): Promise<void>;
  now?: () => number | object;
}

export interface ProvisionFieldUserInput {
  uid: string;
  email: string;
}

export interface FieldPlatformClaims {
  fieldPlatform: true;
  fieldRole: FieldRole;
}

function isFieldRole(value: unknown): value is FieldRole {
  return value === "admin" || value === "staff" || value === "reviewer";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

export function hashAllowedEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export async function provisionFieldUserCore(
  input: ProvisionFieldUserInput,
  dependencies: ProvisionFieldUserDependencies,
): Promise<FieldPlatformClaims> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!input.uid.trim() || !normalizedEmail) {
    throw new Error("field_invalid_identity");
  }

  const allowed = await dependencies.getAllowedEmail(hashAllowedEmail(normalizedEmail));
  if (!allowed?.active || !isFieldRole(allowed.role)) {
    throw new Error("field_user_not_allowed");
  }

  const claims: FieldPlatformClaims = {
    fieldPlatform: true,
    fieldRole: allowed.role,
  };

  await dependencies.setCustomClaims(input.uid, claims);
  await dependencies.writeFieldUser(input.uid, {
    role: allowed.role,
    enabled: true,
    updatedAt: dependencies.now?.() ?? Date.now(),
  });

  return claims;
}

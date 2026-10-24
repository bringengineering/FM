import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { hashAllowedEmail, normalizeEmail } from "./provision-field-user.js";

export type DesktopHandoffRole = "admin" | "staff" | "reviewer";

export interface DesktopCrmIdentity {
  crmUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

export interface DesktopHandoffRecord {
  crmUid: string;
  fieldUid: string;
  emailHash: string;
  role: DesktopHandoffRole;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface DesktopHandoffDependencies {
  now(): number;
  randomBytes(size: number): Uint8Array;
  getAllowedEmail(
    emailHash: string,
  ): Promise<{ active: boolean; role: DesktopHandoffRole } | null>;
  resolveFieldUser(input: {
    email: string;
    displayName: string;
    role: DesktopHandoffRole;
  }): Promise<string>;
  save(codeHash: string, record: DesktopHandoffRecord): Promise<void>;
  consume(codeHash: string, now: number): Promise<DesktopHandoffRecord>;
  createCustomToken(
    uid: string,
    claims: { fieldPlatform: true; fieldRole: DesktopHandoffRole },
  ): Promise<string>;
}

const HANDOFF_BYTES = 32;
const HANDOFF_TTL_MS = 60_000;
const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const roles = new Set<DesktopHandoffRole>(["admin", "staff", "reviewer"]);

function isRole(value: unknown): value is DesktopHandoffRole {
  return typeof value === "string" && roles.has(value as DesktopHandoffRole);
}

function validIdentityPart(value: string, maximumBytes: number): boolean {
  return value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export async function issueDesktopFieldHandoffCore(
  identity: DesktopCrmIdentity,
  dependencies: DesktopHandoffDependencies,
): Promise<{ code: string; expiresAt: number }> {
  const crmUid = String(identity.crmUid || "").trim();
  const email = normalizeEmail(String(identity.email || ""));
  if (!validIdentityPart(crmUid, 128) || !validIdentityPart(email, 320)) {
    throw new Error("desktop_handoff_invalid_identity");
  }
  if (identity.emailVerified !== true) {
    throw new Error("desktop_handoff_email_unverified");
  }

  const allowed = await dependencies.getAllowedEmail(hashAllowedEmail(email));
  if (!allowed?.active || !isRole(allowed.role)) {
    throw new Error("desktop_handoff_not_allowed");
  }

  const fieldUid = await dependencies.resolveFieldUser({
    email,
    displayName: String(identity.displayName || "").trim().slice(0, 120),
    role: allowed.role,
  });
  if (!validIdentityPart(fieldUid, 128)) {
    throw new Error("desktop_handoff_field_user_invalid");
  }

  const bytes = dependencies.randomBytes(HANDOFF_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== HANDOFF_BYTES) {
    throw new Error("desktop_handoff_random_invalid");
  }
  const code = Buffer.from(bytes).toString("base64url");
  if (!HANDOFF_CODE_PATTERN.test(code)) {
    throw new Error("desktop_handoff_random_invalid");
  }

  const issuedAt = dependencies.now();
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error("desktop_handoff_clock_invalid");
  }
  const expiresAt = issuedAt + HANDOFF_TTL_MS;
  await dependencies.save(sha256Base64Url(code), {
    crmUid,
    fieldUid,
    emailHash: sha256Base64Url(email),
    role: allowed.role,
    displayName: String(identity.displayName || "").trim().slice(0, 120),
    issuedAt,
    expiresAt,
    usedAt: null,
  });

  return { code, expiresAt };
}

export async function consumeDesktopFieldHandoffCore(
  input: { code: string },
  dependencies: DesktopHandoffDependencies,
): Promise<{ customToken: string }> {
  const code = String(input.code || "");
  if (!HANDOFF_CODE_PATTERN.test(code)) {
    throw new Error("desktop_handoff_invalid");
  }
  const now = dependencies.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("desktop_handoff_clock_invalid");
  }

  const record = await dependencies.consume(sha256Base64Url(code), now);
  if (
    !record
    || !validIdentityPart(record.fieldUid, 128)
    || !isRole(record.role)
    || !Number.isSafeInteger(record.expiresAt)
    || record.expiresAt <= now
  ) {
    throw new Error("desktop_handoff_invalid");
  }

  const customToken = await dependencies.createCustomToken(record.fieldUid, {
    fieldPlatform: true,
    fieldRole: record.role,
  });
  if (!customToken) throw new Error("desktop_handoff_token_failed");
  return { customToken };
}

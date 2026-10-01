import { createHash, randomBytes } from "node:crypto";

export const CRM_ACCOUNT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const CRM_ACCOUNT_SETUP_PASSWORD_MIN_LENGTH = 8;
export const CRM_ACCOUNT_SETUP_PASSWORD_MAX_LENGTH = 128;
export const CRM_ACCOUNT_SETUP_TOKEN_TTL_MS = CRM_ACCOUNT_INVITE_TTL_MS;
export const CRM_ACCOUNT_SETUP_TOKEN_HISTORY_LIMIT = 5;
export const CRM_ACCOUNT_SETUP_CONTINUE_URL = "https://bring-fm.web.app/crm-account-setup/";

// This Firebase web API key is a public client identifier already used by the
// desktop CRM. It is not a credential; Google Cloud API restrictions remain
// the security boundary for Identity Toolkit requests.
export const CRM_FIREBASE_WEB_API_KEY = "AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg";

export interface CrmAccountInviteRecord {
  emailHash: string;
  setupTokens: Array<{ tokenHash: string; createdAt: number; expiresAt: number }>;
  status: "pending" | "complete";
  createdAt: number;
  expiresAt: number;
  invitedBy: string;
  lastSentAt: number;
  completedAt?: number;
}

export interface CrmAccountAccessRecord {
  email: string;
  enabled: true;
  role: "member";
  officeAdmin: false;
  mustChangePassword: false;
  accountSetupPending: true;
  createdAt: number;
  createdBy: string;
}

export function canManageCrmAccountSetup(identity: unknown, access: unknown): identity is {
  uid: string;
  email: string;
  emailVerified: true;
  signInProvider: "password";
} {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)
    || !access || typeof access !== "object" || Array.isArray(access)) return false;
  const actor = identity as Record<string, unknown>;
  const record = access as Record<string, unknown>;
  return typeof actor.uid === "string"
    && actor.uid.length > 0
    && actor.uid.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(actor.uid)
    && !["__proto__", "prototype", "constructor"].includes(actor.uid)
    && typeof actor.email === "string"
    && actor.email.trim().length > 0
    && actor.emailVerified === true
    && actor.signInProvider === "password"
    && record.enabled === true
    && record.role === "admin"
    && record.mustChangePassword !== true
    && typeof record.email === "string"
    && record.email.trim().toLowerCase() === actor.email.trim().toLowerCase();
}

export function normalizeCrmAccountEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("crm_account_email_invalid");
  const email = value.trim().toLowerCase();
  if (
    email.length < 3
    || Buffer.byteLength(email, "utf8") > 254
    || /[\u0000-\u0020\u007f]/u.test(email)
    || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/u.test(email)
  ) {
    throw new Error("crm_account_email_invalid");
  }
  return email;
}

export function normalizeCrmAccountDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new Error("crm_account_display_name_invalid");
  const displayName = value.trim();
  if (
    !displayName
    || [...displayName].length > 80
    || Buffer.byteLength(displayName, "utf8") > 240
    || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(displayName)
  ) throw new Error("crm_account_display_name_invalid");
  return displayName;
}

export function crmAccountEmailHash(email: string): string {
  return createHash("sha256").update(normalizeCrmAccountEmail(email)).digest("hex");
}

export function createCrmAccountSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function crmAccountSetupTokenHash(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error("crm_account_setup_invalid");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function maskCrmAccountEmail(value: string): string {
  const email = normalizeCrmAccountEmail(value);
  const separator = email.lastIndexOf("@");
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visibleLength = Math.min(2, Math.max(1, Math.ceil(local.length / 3)));
  const visible = local.slice(0, visibleLength);
  const hidden = "•".repeat(Math.max(3, Math.min(6, local.length - visibleLength)));
  return `${visible}${hidden}@${domain}`;
}

export function validateCrmAccountSetupPassword(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < CRM_ACCOUNT_SETUP_PASSWORD_MIN_LENGTH
    || value.length > CRM_ACCOUNT_SETUP_PASSWORD_MAX_LENGTH
    || !/[A-Za-z]/u.test(value)
    || !/[0-9]/u.test(value)
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("crm_account_password_invalid");
  }
  return value;
}

export function createCrmAccountAccessRecord(
  email: string,
  actorUid: string,
  now: number,
): CrmAccountAccessRecord {
  const normalizedEmail = normalizeCrmAccountEmail(email);
  if (!actorUid || actorUid.length > 128 || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("crm_account_invite_invalid");
  }
  return {
    email: normalizedEmail,
    enabled: true,
    role: "member",
    officeAdmin: false,
    mustChangePassword: false,
    accountSetupPending: true,
    createdAt: now,
    createdBy: actorUid,
  };
}

export function createCrmAccountInviteRecord(
  email: string,
  actorUid: string,
  now: number,
  setupTokenHash: string,
): CrmAccountInviteRecord {
  const normalizedEmail = normalizeCrmAccountEmail(email);
  if (
    !actorUid
    || actorUid.length > 128
    || !Number.isSafeInteger(now)
    || now <= 0
    || !/^[a-f0-9]{64}$/u.test(setupTokenHash)
  ) {
    throw new Error("crm_account_invite_invalid");
  }
  return {
    emailHash: crmAccountEmailHash(normalizedEmail),
    setupTokens: [{
      tokenHash: setupTokenHash,
      createdAt: now,
      expiresAt: now + CRM_ACCOUNT_SETUP_TOKEN_TTL_MS,
    }],
    status: "pending",
    createdAt: now,
    expiresAt: now + CRM_ACCOUNT_INVITE_TTL_MS,
    invitedBy: actorUid,
    lastSentAt: 0,
  };
}

export function appendCrmAccountSetupToken(
  invite: unknown,
  setupTokenHash: string,
  now: number,
): Array<{ tokenHash: string; createdAt: number; expiresAt: number }> {
  if (
    !invite
    || typeof invite !== "object"
    || Array.isArray(invite)
    || !/^[a-f0-9]{64}$/u.test(setupTokenHash)
    || !Number.isSafeInteger(now)
    || now <= 0
  ) throw new Error("crm_account_setup_invalid");
  const record = invite as Partial<CrmAccountInviteRecord>;
  const previous = Array.isArray(record.setupTokens)
    ? record.setupTokens.filter((item): item is { tokenHash: string; createdAt: number; expiresAt: number } =>
      Boolean(item)
      && typeof item === "object"
      && /^[a-f0-9]{64}$/u.test(String(item.tokenHash || ""))
      && Number.isSafeInteger(item.createdAt)
      && Number.isSafeInteger(item.expiresAt)
      && item.expiresAt > now)
    : [];
  return [
    ...previous.filter(item => item.tokenHash !== setupTokenHash),
    { tokenHash: setupTokenHash, createdAt: now, expiresAt: now + CRM_ACCOUNT_SETUP_TOKEN_TTL_MS },
  ].slice(-CRM_ACCOUNT_SETUP_TOKEN_HISTORY_LIMIT);
}

export function isCrmAccountSetupTokenUsable(
  invite: unknown,
  setupToken: unknown,
  now: number,
): invite is CrmAccountInviteRecord {
  if (!invite || typeof invite !== "object" || Array.isArray(invite)) return false;
  const record = invite as Partial<CrmAccountInviteRecord>;
  let tokenHash: string;
  try { tokenHash = crmAccountSetupTokenHash(setupToken); }
  catch { return false; }
  return record.status === "pending"
    && Number.isSafeInteger(record.expiresAt)
    && Number(record.expiresAt) > now
    && Array.isArray(record.setupTokens)
    && record.setupTokens.some(item =>
      Boolean(item)
      && typeof item === "object"
      && item.tokenHash === tokenHash
      && Number.isSafeInteger(item.expiresAt)
      && Number(item.expiresAt) > now,
    );
}

export function isCrmAccountInviteUsable(
  invite: unknown,
  email: string,
  now: number,
): invite is CrmAccountInviteRecord {
  if (!invite || typeof invite !== "object" || Array.isArray(invite)) return false;
  const record = invite as Partial<CrmAccountInviteRecord>;
  return record.status === "pending"
    && record.emailHash === crmAccountEmailHash(email)
    && Number.isSafeInteger(record.expiresAt)
    && Number(record.expiresAt) > now;
}

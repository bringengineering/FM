import { canManageCrmAccountSetup } from "./crm-account-invite.js";

type RecordValue = Record<string, unknown>;
export const CRM_ACCOUNT_ROLES = ["admin", "member", "viewer"] as const;
export type CrmAccountRole = typeof CRM_ACCOUNT_ROLES[number];
export const isCrmAccountUid = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9_-]{1,128}$/u.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeCrmAccountMutation(value: unknown, kind: "role" | "delete") {
  if (!record(value) || !isCrmAccountUid(value.uid)
    || !CRM_ACCOUNT_ROLES.includes(value.expectedRole as CrmAccountRole)
    || (kind === "role" && value.role !== "admin" && value.role !== "member")
    || (kind === "delete" && value.confirmDelete !== true)) throw new Error("crm_account_management_invalid");
  return { uid: value.uid, expectedRole: value.expectedRole as CrmAccountRole,
    role: kind === "role" ? value.role as "admin" | "member" : "viewer" as const };
}

// Recheck the actor inside the shared access transaction so concurrent admins
// cannot demote/delete each other and leave the company without an administrator.
export function planCrmAccountMutation(raw: unknown, actor: { uid: string; email: string },
  input: ReturnType<typeof normalizeCrmAccountMutation>, kind: "role" | "delete", now: number): RecordValue {
  if (!record(raw) || !canManageCrmAccountSetup({ ...actor, emailVerified: true, signInProvider: "password" }, raw[actor.uid])) {
    throw new Error("crm_account_management_admin_required");
  }
  if (input.uid === actor.uid) throw new Error("crm_account_management_self_protected");
  const target = raw[input.uid];
  if (!record(target) || typeof target.email !== "string") throw new Error("crm_account_management_missing");
  if (kind === "delete" && target.deletedAt) return raw;
  if (target.deletedAt || target.role !== input.expectedRole) throw new Error("crm_account_management_conflict");
  const activeAdmins = Object.values(raw).filter(item => record(item) && item.enabled === true
    && item.role === "admin" && item.accountSetupPending !== true && item.mustChangePassword !== true && !item.deletedAt);
  if (target.role === "admin" && activeAdmins.length <= 1) throw new Error("crm_account_management_last_admin");
  if (kind === "role" && (target.enabled !== true || target.accountSetupPending === true || target.mustChangePassword === true)) {
    throw new Error("crm_account_management_not_active");
  }
  const changed: RecordValue = { ...target, role: input.role, officeAdmin: input.role === "admin",
    accountManagementAt: now, accountManagementBy: actor.uid };
  if (kind === "delete") Object.assign(changed, { enabled: false, deletedAt: now, deletedBy: actor.uid, deletionPending: true });
  return { ...raw, [input.uid]: changed };
}

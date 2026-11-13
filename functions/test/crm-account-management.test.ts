import { describe, it, expect } from "vitest";
import { normalizeCrmAccountMutation, planCrmAccountMutation } from "../src/auth/crm-account-management.js";

const actor = { uid: "admin-a", email: "admin-a@example.com" };
const grant = (email: string, role = "member") => ({ email, role, enabled: true, officeAdmin: role === "admin" });
const initial = () => ({ "admin-a": grant(actor.email, "admin"), "admin-b": grant("admin-b@example.com", "admin"),
  member: grant("member@example.com"), pending: { ...grant("pending@example.com"), accountSetupPending: true } });
const command = (uid: string, expectedRole: string, role = "member") => normalizeCrmAccountMutation({ uid, expectedRole, role }, "role");

describe("CRM account management authorization and transaction policy", () => {
  it("rejects unsafe identifiers, malformed roles, and deletion without explicit confirmation", () => {
    for (const uid of ["../access", "__proto__", "", 12]) expect(() => command(uid as string, "member")).toThrow();
    for (const role of ["owner", ["admin"], null]) expect(() => normalizeCrmAccountMutation({ uid: "member", expectedRole: "member", role }, "role")).toThrow();
    expect(() => normalizeCrmAccountMutation({ uid: "member", expectedRole: "member" }, "delete")).toThrow();
  });
  it("preserves other accounts and updates CRM and office administrator privileges together", () => {
    const source = initial(); const updated = planCrmAccountMutation(source, actor, command("member", "member", "admin"), "role", 100);
    expect(source.member.role).toBe("member");
    expect(updated.member).toMatchObject({ role: "admin", officeAdmin: true, accountManagementBy: actor.uid });
    expect(updated["admin-b"]).toEqual(source["admin-b"]);
  });
  it("protects self, stale roles, pending accounts, and actors whose administrator role was revoked", () => {
    expect(() => planCrmAccountMutation(initial(), actor, command(actor.uid, "admin"), "role", 100)).toThrow("self_protected");
    expect(() => planCrmAccountMutation(initial(), actor, command("member", "admin"), "role", 100)).toThrow("conflict");
    expect(() => planCrmAccountMutation(initial(), actor, command("pending", "member", "admin"), "role", 100)).toThrow("not_active");
    const state = initial(); state["admin-a"].role = "member";
    expect(() => planCrmAccountMutation(state, actor, command("member", "member", "admin"), "role", 100)).toThrow("admin_required");
  });
  it("prevents concurrent administrators from demoting each other", () => {
    const afterA = planCrmAccountMutation(initial(), actor, command("admin-b", "admin"), "role", 100);
    const actorB = { uid: "admin-b", email: "admin-b@example.com" };
    expect(() => planCrmAccountMutation(afterA, actorB, command("admin-a", "admin"), "role", 101)).toThrow("admin_required");
    expect(afterA["admin-a"]).toMatchObject({ role: "admin", enabled: true });
  });
  it("denies access before Auth deletion and permits idempotent deletion retries", () => {
    const input = normalizeCrmAccountMutation({ uid: "member", expectedRole: "member", confirmDelete: true }, "delete");
    const deleted = planCrmAccountMutation(initial(), actor, input, "delete", 100);
    expect(deleted.member).toMatchObject({ enabled: false, role: "viewer", officeAdmin: false, deletedAt: 100, deletionPending: true });
    expect(planCrmAccountMutation(deleted, actor, input, "delete", 101)).toEqual(deleted);
    expect(() => planCrmAccountMutation(deleted, actor, command("member", "viewer", "admin"), "role", 102)).toThrow("conflict");
  });
});

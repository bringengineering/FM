import { describe, expect, it } from "vitest";

import {
  canManageCrmAccountSetup,
  createCrmAccountAccessRecord,
  createCrmAccountInviteRecord,
  createCrmAccountSetupToken,
  appendCrmAccountSetupToken,
  crmAccountEmailHash,
  crmAccountSetupTokenHash,
  isCrmAccountInviteUsable,
  isCrmAccountSetupTokenUsable,
  maskCrmAccountEmail,
  normalizeCrmAccountDisplayName,
  normalizeCrmAccountEmail,
  validateCrmAccountSetupPassword,
} from "../src/auth/crm-account-invite.js";

describe("CRM account invitations", () => {
  it("allows account-management calls only from a verified, enabled password-provider administrator", () => {
    const identity = { uid: "admin-1", email: "admin@example.com", emailVerified: true, signInProvider: "password" };
    const access = { email: "ADMIN@example.com", enabled: true, role: "admin", mustChangePassword: false };
    expect(canManageCrmAccountSetup(identity, access)).toBe(true);
    for (const deniedIdentity of [
      { ...identity, emailVerified: false },
      { ...identity, signInProvider: "google.com" },
      { ...identity, signInProvider: "custom" },
      { ...identity, email: "different@example.com" },
      { ...identity, uid: "../admin-1" },
    ]) expect(canManageCrmAccountSetup(deniedIdentity, access)).toBe(false);
    for (const deniedAccess of [
      { ...access, enabled: false },
      { ...access, role: "member" },
      { ...access, role: "viewer" },
      { ...access, mustChangePassword: true },
      { ...access, email: "" },
    ]) expect(canManageCrmAccountSetup(identity, deniedAccess)).toBe(false);
    expect(canManageCrmAccountSetup(null, access)).toBe(false);
    expect(canManageCrmAccountSetup(identity, null)).toBe(false);
  });

  it("normalizes email consistently and hashes it without storing the address in the invite index", () => {
    expect(normalizeCrmAccountEmail("  Team.Member@Example.com ")).toBe("team.member@example.com");
    expect(crmAccountEmailHash("Team.Member@Example.com")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("normalizes a member name without accepting blank, oversized, or control-character values", () => {
    expect(normalizeCrmAccountDisplayName("  김현진  ")).toBe("김현진");
    for (const value of ["", "   ", "이름\n가로채기", "x".repeat(81), "김".repeat(81)]) {
      expect(() => normalizeCrmAccountDisplayName(value)).toThrow("crm_account_display_name_invalid");
    }
  });

  it.each(["", "not-an-email", "x@y", "a b@example.com", `x@${"a".repeat(250)}.com`])(
    "rejects malformed or oversized email %s",
    email => expect(() => normalizeCrmAccountEmail(email)).toThrow("crm_account_email_invalid"),
  );

  it("creates an enabled member with no initial password or administrator privileges", () => {
    const access = createCrmAccountAccessRecord("NEW@EXAMPLE.COM", "admin-1", 1_800_000_000_000);
    expect(access).toEqual({
      email: "new@example.com",
      enabled: true,
      role: "member",
      officeAdmin: false,
      mustChangePassword: false,
      accountSetupPending: true,
      createdAt: 1_800_000_000_000,
      createdBy: "admin-1",
    });
    expect(access).not.toHaveProperty("password");
  });

  it("creates a seven-day invite index without duplicating the email address", () => {
    const setupToken = createCrmAccountSetupToken();
    const setupTokenHash = crmAccountSetupTokenHash(setupToken);
    const invite = createCrmAccountInviteRecord("new@example.com", "admin-1", 1_800_000_000_000, setupTokenHash);
    expect(invite).toMatchObject({
      emailHash: crmAccountEmailHash("new@example.com"),
      setupTokens: [{
        tokenHash: setupTokenHash,
        createdAt: 1_800_000_000_000,
        expiresAt: 1_800_604_800_000,
      }],
      status: "pending",
      createdAt: 1_800_000_000_000,
      expiresAt: 1_800_604_800_000,
      invitedBy: "admin-1",
      lastSentAt: 0,
    });
    expect(invite).not.toHaveProperty("email");
    expect(isCrmAccountInviteUsable(invite, "NEW@example.com", 1_800_000_000_001)).toBe(true);
    expect(isCrmAccountInviteUsable(invite, "other@example.com", 1_800_000_000_001)).toBe(false);
    expect(isCrmAccountInviteUsable(invite, "new@example.com", invite.expiresAt)).toBe(false);
    expect(isCrmAccountSetupTokenUsable(invite, setupToken, 1_800_000_000_001)).toBe(true);
    expect(isCrmAccountSetupTokenUsable(invite, createCrmAccountSetupToken(), 1_800_000_000_001)).toBe(false);
    expect(isCrmAccountSetupTokenUsable({ ...invite, status: "complete" }, setupToken, 1_800_000_000_001)).toBe(false);
    expect(crmAccountSetupTokenHash(setupToken)).not.toBe(setupToken);
    expect(() => crmAccountSetupTokenHash("not-a-token")).toThrow("crm_account_setup_invalid");
    expect(maskCrmAccountEmail("Invitee@example.com")).toBe("in•••••@example.com");
  });

  it("keeps a bounded history of expiring hashed setup links when an invite is resent", () => {
    const now = 1_800_000_000_000;
    const firstToken = createCrmAccountSetupToken();
    const invite = createCrmAccountInviteRecord("new@example.com", "admin-1", now, crmAccountSetupTokenHash(firstToken));
    let tokens = invite.setupTokens;
    const generated: string[] = [firstToken];
    for (let index = 0; index < 6; index += 1) {
      const token = createCrmAccountSetupToken();
      generated.push(token);
      tokens = appendCrmAccountSetupToken({ ...invite, setupTokens: tokens }, crmAccountSetupTokenHash(token), now + index + 1);
    }
    expect(tokens).toHaveLength(5);
    expect(tokens.every(item => item.tokenHash !== crmAccountSetupTokenHash(generated.at(-1)))).toBe(false);
    expect(tokens.every(item => /^[a-f0-9]{64}$/u.test(item.tokenHash))).toBe(true);
    expect(isCrmAccountSetupTokenUsable({ ...invite, setupTokens: tokens }, generated.at(-1), now + 10)).toBe(true);
    expect(isCrmAccountSetupTokenUsable({ ...invite, setupTokens: tokens }, generated[1], now + 10)).toBe(false);
    expect(isCrmAccountSetupTokenUsable({ ...invite, setupTokens: tokens }, generated.at(-1), now + 7 * 24 * 60 * 60 * 1_000 + 20)).toBe(false);
  });

  it("accepts a strong first password and rejects short, non-alphanumeric, or control-character input", () => {
    expect(validateCrmAccountSetupPassword("Bright2026")).toBe("Bright2026");
    for (const value of ["123456A", "abcdefgh", "onlyletters\n123456"]) {
      expect(() => validateCrmAccountSetupPassword(value)).toThrow("crm_account_password_invalid");
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  consumeDesktopFieldHandoffCore,
  issueDesktopFieldHandoffCore,
  sha256Base64Url,
  type DesktopHandoffDependencies,
  type DesktopHandoffRecord,
  type DesktopHandoffRole,
} from "../src/auth/desktop-field-handoff.js";

const COMPANY_EMAIL = "bringengineering1008@gmail.com";

function createHarness(options: {
  now?: number;
  allowed?: { active: boolean; role: DesktopHandoffRole } | null;
} = {}) {
  let now = options.now ?? 1_000_000;
  const allowed = options.allowed === undefined
    ? { active: true, role: "admin" as const }
    : options.allowed;
  const records = new Map<string, DesktopHandoffRecord>();
  let savedKey = "";
  let savedRecord: DesktopHandoffRecord | undefined;
  const dependencies: DesktopHandoffDependencies = {
    now: () => now,
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index),
    async getAllowedEmail() {
      return allowed;
    },
    async resolveFieldUser() {
      return "field-uid";
    },
    async save(codeHash, record) {
      savedKey = codeHash;
      savedRecord = structuredClone(record);
      records.set(codeHash, structuredClone(record));
    },
    async consume(codeHash, consumedAt) {
      const current = records.get(codeHash);
      if (!current) throw new Error("desktop_handoff_invalid");
      if (current.usedAt !== null) throw new Error("desktop_handoff_used");
      if (current.expiresAt <= consumedAt) throw new Error("desktop_handoff_expired");
      records.set(codeHash, { ...current, usedAt: consumedAt });
      return structuredClone(current);
    },
    async createCustomToken(uid, claims) {
      return `${uid}:${claims.fieldRole}`;
    },
  };
  return {
    dependencies,
    records,
    setNow(value: number) {
      now = value;
    },
    get savedKey() {
      return savedKey;
    },
    get savedRecord() {
      return savedRecord;
    },
  };
}

function crmIdentity(overrides: Partial<{
  crmUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}> = {}) {
  return {
    crmUid: "crm-uid",
    email: COMPANY_EMAIL,
    emailVerified: true,
    displayName: "서창환",
    ...overrides,
  };
}

describe("desktop FIELD handoff", () => {
  it("stores only a hash of a 60-second one-time code", async () => {
    const harness = createHarness();

    const issued = await issueDesktopFieldHandoffCore(
      crmIdentity(),
      harness.dependencies,
    );

    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBe(1_060_000);
    expect(harness.savedKey).toBe(sha256Base64Url(issued.code));
    expect(harness.savedRecord).toMatchObject({
      crmUid: "crm-uid",
      fieldUid: "field-uid",
      emailHash: sha256Base64Url(COMPANY_EMAIL),
      role: "admin",
      displayName: "서창환",
      issuedAt: 1_000_000,
      expiresAt: 1_060_000,
      usedAt: null,
    });
    expect(JSON.stringify(harness.savedRecord)).not.toContain(issued.code);
  });

  it("consumes a code exactly once", async () => {
    const harness = createHarness();
    const issued = await issueDesktopFieldHandoffCore(crmIdentity(), harness.dependencies);

    await expect(consumeDesktopFieldHandoffCore(
      { code: issued.code },
      harness.dependencies,
    )).resolves.toEqual({ customToken: "field-uid:admin" });
    await expect(consumeDesktopFieldHandoffCore(
      { code: issued.code },
      harness.dependencies,
    )).rejects.toThrow("desktop_handoff_used");
  });

  it("allows only one of two concurrent consumers", async () => {
    const harness = createHarness();
    const issued = await issueDesktopFieldHandoffCore(crmIdentity(), harness.dependencies);

    const results = await Promise.allSettled([
      consumeDesktopFieldHandoffCore({ code: issued.code }, harness.dependencies),
      consumeDesktopFieldHandoffCore({ code: issued.code }, harness.dependencies),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects an expired code without creating a custom token", async () => {
    const harness = createHarness();
    const issued = await issueDesktopFieldHandoffCore(crmIdentity(), harness.dependencies);
    harness.setNow(issued.expiresAt);

    await expect(consumeDesktopFieldHandoffCore(
      { code: issued.code },
      harness.dependencies,
    )).rejects.toThrow("desktop_handoff_expired");
  });

  it.each([
    ["unverified email", crmIdentity({ emailVerified: false }), "desktop_handoff_email_unverified"],
    ["missing uid", crmIdentity({ crmUid: "" }), "desktop_handoff_invalid_identity"],
    ["missing email", crmIdentity({ email: "" }), "desktop_handoff_invalid_identity"],
  ])("rejects %s", async (_label, identity, message) => {
    const harness = createHarness();
    await expect(issueDesktopFieldHandoffCore(identity, harness.dependencies))
      .rejects.toThrow(message);
  });

  it.each([
    [null, "desktop_handoff_not_allowed"],
    [{ active: false, role: "admin" as const }, "desktop_handoff_not_allowed"],
    [{ active: true, role: "owner" as never }, "desktop_handoff_not_allowed"],
  ])("rejects an invalid allowlist record", async (allowed, message) => {
    const harness = createHarness({ allowed });
    await expect(issueDesktopFieldHandoffCore(crmIdentity(), harness.dependencies))
      .rejects.toThrow(message);
  });

  it.each(["", "abc", "a".repeat(42), "a".repeat(44), "!".repeat(43)])(
    "rejects malformed code %s",
    async (code) => {
      const harness = createHarness();
      await expect(consumeDesktopFieldHandoffCore({ code }, harness.dependencies))
        .rejects.toThrow("desktop_handoff_invalid");
    },
  );
});

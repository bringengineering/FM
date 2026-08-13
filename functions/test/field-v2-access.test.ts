import { describe, expect, it, vi } from "vitest";

import {
  assertFieldActorCanMutate,
  resolveFieldActorCore,
  type FieldActorDependencies,
} from "../src/field-v2/access.js";

function dependencies(overrides: {
  access?: unknown;
  profile?: unknown;
  authenticatedEmail?: string;
} = {}): FieldActorDependencies & { read: ReturnType<typeof vi.fn> } {
  const access = Object.hasOwn(overrides, "access")
    ? overrides.access
    : {
      enabled: true,
      role: "member",
      email: "team@bringcare.kr",
    };
  const profile = Object.hasOwn(overrides, "profile")
    ? overrides.profile
    : {
      active: true,
      displayName: "김현진",
    };
  return {
    authenticatedEmail: overrides.authenticatedEmail,
    read: vi.fn(async (path: string) => {
      if (path === "crmCompany/access/shared_uid") return access;
      if (path === "crmCompany/teamProfiles/operator_kim") return profile;
      if (path === "crmCompany/teamProfiles/operator_disabled") {
        return { active: false, displayName: "비활성 담당자" };
      }
      return null;
    }),
  };
}

describe("FIELD v2 actor access", () => {
  it("resolves CRM access and an active operational team label", async () => {
    const deps = dependencies({ authenticatedEmail: " TEAM@BringCare.kr " });

    await expect(resolveFieldActorCore({
      authUid: "shared_uid",
      operatorId: "operator_kim",
    }, deps)).resolves.toEqual({
      authUid: "shared_uid",
      operatorId: "operator_kim",
      displayName: "김현진",
      role: "member",
    });
    expect(deps.read).toHaveBeenNthCalledWith(1, "crmCompany/access/shared_uid");
    expect(deps.read).toHaveBeenNthCalledWith(2, "crmCompany/teamProfiles/operator_kim");
  });

  it.each(["admin", "member", "viewer"] as const)(
    "preserves the CRM %s role",
    async (role) => {
      const deps = dependencies({
        access: { enabled: true, role, email: "team@bringcare.kr" },
      });
      await expect(resolveFieldActorCore({
        authUid: "shared_uid",
        operatorId: "operator_kim",
      }, deps)).resolves.toMatchObject({ role });
    },
  );

  it.each([
    [null],
    [{ enabled: false, role: "member", email: "team@bringcare.kr" }],
    [{ enabled: true, role: "staff", email: "team@bringcare.kr" }],
  ])("rejects missing, disabled, or unknown CRM access", async (access) => {
    await expect(resolveFieldActorCore({
      authUid: "shared_uid",
      operatorId: "operator_kim",
    }, dependencies({ access }))).rejects.toThrow("field_access_forbidden");
  });

  it("rejects an authenticated email that does not match CRM access", async () => {
    await expect(resolveFieldActorCore({
      authUid: "shared_uid",
      operatorId: "operator_kim",
    }, dependencies({ authenticatedEmail: "other@bringcare.kr" })))
      .rejects.toThrow("field_access_forbidden");
  });

  it("rejects inactive and malformed operator profiles with stable codes", async () => {
    const deps = dependencies();
    await expect(resolveFieldActorCore({
      authUid: "shared_uid",
      operatorId: "operator_disabled",
    }, deps)).rejects.toThrow("field_operator_inactive");

    await expect(resolveFieldActorCore({
      authUid: "shared_uid",
      operatorId: "operator_missing",
    }, deps)).rejects.toThrow("field_operator_invalid");

    await expect(resolveFieldActorCore({
      authUid: "shared_uid",
      operatorId: "bad/operator",
    }, deps)).rejects.toThrow("field_operator_invalid");
  });

  it("allows admin and member mutation but keeps viewer read-only", () => {
    expect(assertFieldActorCanMutate({
      authUid: "uid",
      operatorId: "admin",
      displayName: "관리자",
      role: "admin",
    })).toEqual({ allowed: true });
    expect(assertFieldActorCanMutate({
      authUid: "uid",
      operatorId: "member",
      displayName: "팀원",
      role: "member",
    })).toEqual({ allowed: true });
    expect(() => assertFieldActorCanMutate({
      authUid: "uid",
      operatorId: "viewer",
      displayName: "조회자",
      role: "viewer",
    })).toThrow("field_mutation_forbidden");
  });
});

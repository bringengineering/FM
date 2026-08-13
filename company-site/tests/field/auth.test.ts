import { describe, expect, it, vi } from "vitest";

import {
  loginFieldUser,
  observeDesktopLogout,
  type FieldAuthDependencies,
} from "../../app/field/lib/auth.client";

function createDependencies(
  claims: Record<string, unknown>,
  options: {
    email?: string;
    provisionError?: Error & { code?: string };
    userRecord?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const userRecord = "userRecord" in options
    ? options.userRecord
    : { enabled: true, role: claims.fieldRole };
  const user = {
    uid: "user-1",
    displayName: "브링 담당자",
    email: options.email ?? null,
    getIdTokenResult: vi.fn(async (forceRefresh: boolean) => {
      calls.push(`token:${forceRefresh}`);
      return { claims };
    }),
  };
  const dependencies: FieldAuthDependencies = {
    signInWithGoogle: vi.fn(async () => {
      calls.push("signIn");
      return { user };
    }),
    provisionFieldUser: vi.fn(async () => {
      calls.push("provision");
      if (options.provisionError) {
        throw options.provisionError;
      }
    }),
    getFieldUser: vi.fn(async (uid: string) => {
      calls.push(`userRecord:${uid}`);
      return userRecord;
    }),
    signOut: vi.fn(async () => {
      calls.push("signOut");
    }),
  };

  return { calls, dependencies };
}

describe("loginFieldUser", () => {
  it("restores an enabled claimed login without provisioning again", async () => {
    const { calls, dependencies } = createDependencies({
      fieldPlatform: true,
      fieldRole: "staff",
    });

    const session = await loginFieldUser(dependencies);

    expect(calls).toEqual(["signIn", "token:false", "userRecord:user-1"]);
    expect(session).toMatchObject({ uid: "user-1", role: "staff" });
  });

  it("signs out and rejects a user without the field platform claim", async () => {
    const { calls, dependencies } = createDependencies({});

    await expect(loginFieldUser(dependencies)).rejects.toThrow("field_access_denied");
    expect(calls).toEqual(["signIn", "token:false", "provision", "token:true", "signOut"]);
  });

  it("signs out and rejects the former approved email without field claims", async () => {
    const { calls, dependencies } = createDependencies(
      {},
      {
        email: "dpvld858@gmail.com",
      },
    );

    await expect(loginFieldUser(dependencies)).rejects.toThrow("field_access_denied");
    expect(calls).toEqual(["signIn", "token:false", "provision", "token:true", "signOut"]);
  });

  it("maps a denied provisioning callable to access denied", async () => {
    const denied = Object.assign(new Error("permission denied"), {
      code: "functions/permission-denied",
    });
    const { calls, dependencies } = createDependencies({}, { provisionError: denied });

    await expect(loginFieldUser(dependencies)).rejects.toThrow("field_access_denied");
    expect(calls).toEqual(["signIn", "token:false", "provision", "signOut"]);
  });

  it("maps other provisioning failures to a retryable provisioning error", async () => {
    const unavailable = Object.assign(new Error("unavailable"), {
      code: "functions/unavailable",
    });
    const { calls, dependencies } = createDependencies({}, { provisionError: unavailable });

    await expect(loginFieldUser(dependencies)).rejects.toThrow("field_provision_failed");
    expect(calls).toEqual(["signIn", "token:false", "provision", "signOut"]);
  });

  it("signs out instead of returning a claimed session for a disabled user record", async () => {
    const { calls, dependencies } = createDependencies(
      { fieldPlatform: true, fieldRole: "staff" },
      { userRecord: { enabled: false, role: "staff" } },
    );

    await expect(loginFieldUser(dependencies)).rejects.toThrow("field_access_denied");
    expect(calls).toEqual([
      "signIn",
      "token:false",
      "userRecord:user-1",
      "signOut",
    ]);
  });
});

describe("observeDesktopLogout", () => {
  it("signs Firebase Auth out on the CRM bridge event and removes its listener", async () => {
    const logout = vi.fn(async () => undefined);
    const stop = observeDesktopLogout(logout);

    window.dispatchEvent(new Event("bring-crm-logout"));
    await Promise.resolve();
    expect(logout).toHaveBeenCalledTimes(1);

    stop();
    window.dispatchEvent(new Event("bring-crm-logout"));
    await Promise.resolve();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { loginFieldUser, type FieldAuthDependencies } from "../../app/field/lib/auth.client";

function createDependencies(
  claims: Record<string, unknown>,
  options: { email?: string; provisionError?: Error } = {},
) {
  const calls: string[] = [];
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
    signOut: vi.fn(async () => {
      calls.push("signOut");
    }),
  };

  return { calls, dependencies };
}

describe("loginFieldUser", () => {
  it("signs in, provisions claims, and refreshes the token in order", async () => {
    const { calls, dependencies } = createDependencies({
      fieldPlatform: true,
      fieldRole: "staff",
    });

    const session = await loginFieldUser(dependencies);

    expect(calls).toEqual(["signIn", "provision", "token:true"]);
    expect(session).toMatchObject({ uid: "user-1", role: "staff" });
  });

  it("signs out and rejects a user without the field platform claim", async () => {
    const { calls, dependencies } = createDependencies({});

    await expect(loginFieldUser(dependencies)).rejects.toThrow("field_access_denied");
    expect(calls).toEqual(["signIn", "provision", "token:true", "signOut"]);
  });

  it("reuses the existing Firebase login for the approved company account", async () => {
    const { calls, dependencies } = createDependencies(
      {},
      {
        email: "bringengineering1008@gmail.com",
        provisionError: new Error("functions/not-found"),
      },
    );

    await expect(loginFieldUser(dependencies)).resolves.toMatchObject({
      uid: "user-1",
      role: "admin",
    });
    expect(calls).toEqual(["signIn", "provision", "token:true"]);
  });
});

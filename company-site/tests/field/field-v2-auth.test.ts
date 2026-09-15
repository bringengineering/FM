import { describe, expect, it, vi } from "vitest";

import {
  observeFieldV2Session,
  resolveFieldV2Session,
  type FieldV2AuthUser,
} from "../../app/field/lib/v2-auth.client";

function user(overrides: Partial<FieldV2AuthUser> = {}): FieldV2AuthUser {
  return {
    uid: "shared_uid",
    email: "TEAM@bring.test",
    emailVerified: true,
    displayName: "브링 공용 계정",
    ...overrides,
  };
}

describe("FIELD v2 CRM access session", () => {
  it("restores verified Firebase Auth and exact own CRM access without legacy claims", async () => {
    const readAccess = vi.fn(async (uid: string) => ({
      enabled: true,
      email: "team@bring.test",
      role: "member",
    }));

    await expect(resolveFieldV2Session(user(), { readAccess })).resolves.toEqual({
      uid: "shared_uid",
      email: "team@bring.test",
      displayName: "브링 공용 계정",
      role: "member",
    });
    expect(readAccess).toHaveBeenCalledWith("shared_uid");
  });

  it.each([
    ["unverified", user({ emailVerified: false }), { enabled: true, email: "team@bring.test", role: "member" }],
    ["email mismatch", user(), { enabled: true, email: "other@bring.test", role: "member" }],
    ["disabled", user(), { enabled: false, email: "team@bring.test", role: "member" }],
    ["legacy role", user(), { enabled: true, email: "team@bring.test", role: "staff" }],
  ])("rejects %s access", async (_label, authUser, access) => {
    await expect(resolveFieldV2Session(authUser, {
      readAccess: async () => access,
    })).rejects.toThrow("field_access_denied");
  });

  it("clears user A immediately while user B access is pending and keeps it clear when denied", async () => {
    let emit!: (next: FieldV2AuthUser | null) => void;
    let resolveB!: (value: unknown) => void;
    const listener = vi.fn();
    const errorListener = vi.fn();
    const readAccess = vi.fn((uid: string) => uid === "uid_a"
      ? Promise.resolve({ enabled: true, email: "a@bring.test", role: "member" })
      : new Promise(resolve => { resolveB = resolve; }));
    const unsubscribe = observeFieldV2Session(listener, errorListener, {
      subscribe: (next) => { emit = next; return vi.fn(); },
      readAccess,
    });

    emit(user({ uid: "uid_a", email: "a@bring.test" }));
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ uid: "uid_a" }),
      "authenticated",
    ));
    emit(user({ uid: "uid_b", email: "b@bring.test" }));
    expect(listener).toHaveBeenLastCalledWith(null, "checking");
    resolveB({ enabled: false, email: "b@bring.test", role: "member" });
    await vi.waitFor(() => expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      message: "field_access_denied",
    })));
    expect(listener).toHaveBeenLastCalledWith(null, "authenticated");
    unsubscribe();
  });

  it("ignores a late access response after unsubscribe", async () => {
    let emit!: (next: FieldV2AuthUser | null) => void;
    let resolveAccess!: (value: unknown) => void;
    const listener = vi.fn();
    const unsubscribeSource = vi.fn();
    const unsubscribe = observeFieldV2Session(listener, vi.fn(), {
      subscribe: (next) => { emit = next; return unsubscribeSource; },
      readAccess: () => new Promise(resolve => { resolveAccess = resolve; }),
    });
    emit(user());
    expect(listener).toHaveBeenLastCalledWith(null, "checking");
    unsubscribe();
    resolveAccess({ enabled: true, email: "team@bring.test", role: "member" });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(unsubscribeSource).toHaveBeenCalledOnce();
  });

  it("reports access outages only after clearing the prior session", async () => {
    let emit!: (next: FieldV2AuthUser | null) => void;
    const order: string[] = [];
    const unsubscribe = observeFieldV2Session(
      (session, state) => order.push(session ? `session:${session.uid}` : `session:${state}`),
      (error) => order.push(`error:${error.message}`),
      {
        subscribe: (next) => { emit = next; return vi.fn(); },
        readAccess: async () => { throw new Error("network details must not leak"); },
      },
    );
    emit(user());
    await vi.waitFor(() => expect(order).toEqual([
      "session:checking",
      "session:authenticated",
      "error:field_access_unavailable",
    ]));
    unsubscribe();
  });
});

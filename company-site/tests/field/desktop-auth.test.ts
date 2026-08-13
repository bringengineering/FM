import { describe, expect, it, vi } from "vitest";

import { ensureDesktopFieldAuth } from "../../app/field/lib/auth.client";

describe("embedded CRM to FIELD authentication", () => {
  it("uses an existing Firebase session without requesting another credential", async () => {
    const requestCredential = vi.fn();
    const signIn = vi.fn();

    await expect(ensureDesktopFieldAuth({
      waitForAuthReady: vi.fn(async () => undefined),
      hasCurrentUser: () => true,
      requestCredential,
      signIn,
    })).resolves.toBe("restored");

    expect(requestCredential).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("accepts the CRM memory credential and signs Firebase in silently", async () => {
    const signIn = vi.fn(async () => undefined);

    await expect(ensureDesktopFieldAuth({
      waitForAuthReady: vi.fn(async () => undefined),
      hasCurrentUser: () => false,
      requestCredential: vi.fn(async () => ({
        ok: true,
        type: "id_token",
        token: "safe-google-token",
      })),
      signIn,
    })).resolves.toBe("connected");

    expect(signIn).toHaveBeenCalledWith("id_token", "safe-google-token");
  });

  it("rejects malformed bridge data without exposing its contents", async () => {
    await expect(ensureDesktopFieldAuth({
      waitForAuthReady: vi.fn(async () => undefined),
      hasCurrentUser: () => false,
      requestCredential: vi.fn(async () => ({ ok: true, type: "id_token", token: "" })),
      signIn: vi.fn(),
    })).rejects.toThrow("field_desktop_credential_unavailable");
  });
});

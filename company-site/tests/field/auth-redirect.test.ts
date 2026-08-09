import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  authStateListener: undefined as
    | ((user: {
        uid: string;
        displayName: string | null;
        getIdTokenResult(forceRefresh?: boolean): Promise<{
          claims: Record<string, unknown>;
        }>;
      } | null) => void)
    | undefined,
  provision: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  onAuthStateChanged: vi.fn(
    (
      _auth: unknown,
      listener: NonNullable<typeof firebaseMocks.authStateListener>,
    ) => {
      firebaseMocks.authStateListener = listener;
      return firebaseMocks.unsubscribe;
    },
  ),
  signInWithPopup: firebaseMocks.signInWithPopup,
  signInWithRedirect: firebaseMocks.signInWithRedirect,
  signOut: firebaseMocks.signOut,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => firebaseMocks.provision),
}));

vi.mock("../../app/field/lib/firebase.client", () => ({
  auth: { name: "field-auth-test" },
  functions: { name: "field-functions-test" },
}));

import {
  loginFieldUser,
  observeFieldSession,
} from "../../app/field/lib/auth.client";

function fieldUser(
  tokenResults: Array<{ claims: Record<string, unknown> }>,
) {
  return {
    uid: "user-1",
    displayName: "브링 담당자",
    getIdTokenResult: vi.fn(async () => {
      const next = tokenResults.shift();
      if (!next) throw new Error("unexpected token read");
      return next;
    }),
  };
}

describe("redirect-based field authentication", () => {
  beforeEach(() => {
    firebaseMocks.authStateListener = undefined;
    firebaseMocks.provision.mockReset().mockResolvedValue(undefined);
    firebaseMocks.signInWithPopup.mockReset();
    firebaseMocks.signInWithRedirect.mockReset();
    firebaseMocks.signOut.mockReset().mockResolvedValue(undefined);
    firebaseMocks.unsubscribe.mockReset();
  });

  it("starts Google sign-in with redirect and maps an unauthorized-domain initiation failure", async () => {
    firebaseMocks.signInWithPopup.mockRejectedValue(new Error("popup path must not run"));
    firebaseMocks.signInWithRedirect.mockRejectedValue(
      Object.assign(new Error("domain is not authorized"), {
        code: "auth/unauthorized-domain",
      }),
    );

    await expect(loginFieldUser()).rejects.toThrow(
      "field_login_domain_not_authorized",
    );

    expect(firebaseMocks.signInWithRedirect).toHaveBeenCalledOnce();
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
    expect(firebaseMocks.provision).not.toHaveBeenCalled();
  });

  it("provisions a redirected Google user and refreshes claims before restoring the session", async () => {
    const user = fieldUser([
      { claims: {} },
      { claims: { fieldPlatform: true, fieldRole: "staff" } },
    ]);
    const listener = vi.fn();
    const errorListener = vi.fn();

    observeFieldSession(listener, errorListener);
    firebaseMocks.authStateListener?.(user);

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({
        uid: "user-1",
        displayName: "브링 담당자",
        role: "staff",
      });
    });
    expect(user.getIdTokenResult).toHaveBeenNthCalledWith(1, false);
    expect(user.getIdTokenResult).toHaveBeenNthCalledWith(2, true);
    expect(firebaseMocks.provision).toHaveBeenCalledOnce();
    expect(errorListener).not.toHaveBeenCalled();
  });

  it("restores an already-authorized persisted session without provisioning again", async () => {
    const user = fieldUser([
      { claims: { fieldPlatform: true, fieldRole: "reviewer" } },
    ]);
    const listener = vi.fn();

    observeFieldSession(listener);
    firebaseMocks.authStateListener?.(user);

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({
        uid: "user-1",
        displayName: "브링 담당자",
        role: "reviewer",
      });
    });
    expect(user.getIdTokenResult).toHaveBeenCalledWith(false);
    expect(firebaseMocks.provision).not.toHaveBeenCalled();
  });

  it("signs out and reports access denial when redirect completion is not enabled", async () => {
    const user = fieldUser([{ claims: {} }]);
    const listener = vi.fn();
    const errorListener = vi.fn();
    firebaseMocks.provision.mockRejectedValue(
      Object.assign(new Error("not enabled"), {
        code: "functions/permission-denied",
      }),
    );

    observeFieldSession(listener, errorListener);
    firebaseMocks.authStateListener?.(user);

    await vi.waitFor(() => {
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ message: "field_access_denied" }),
      );
    });
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("reports a provisioning outage after its own sign-out event without retrying", async () => {
    const user = fieldUser([{ claims: {} }]);
    const listener = vi.fn();
    const errorListener = vi.fn();
    firebaseMocks.provision.mockRejectedValue(
      Object.assign(new Error("callable unavailable"), {
        code: "functions/unavailable",
      }),
    );
    firebaseMocks.signOut.mockImplementation(async () => {
      firebaseMocks.authStateListener?.(null);
    });

    observeFieldSession(listener, errorListener);
    firebaseMocks.authStateListener?.(user);

    await vi.waitFor(() => {
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ message: "field_provision_failed" }),
      );
    });
    expect(firebaseMocks.provision).toHaveBeenCalledOnce();
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("preserves the provisioning outage when cleanup sign-out also fails", async () => {
    const user = fieldUser([{ claims: {} }]);
    const listener = vi.fn();
    const errorListener = vi.fn();
    firebaseMocks.provision.mockRejectedValue(
      Object.assign(new Error("callable unavailable"), {
        code: "functions/unavailable",
      }),
    );
    firebaseMocks.signOut.mockRejectedValue(new Error("persistence cleanup failed"));

    observeFieldSession(listener, errorListener);
    firebaseMocks.authStateListener?.(user);

    await vi.waitFor(() => {
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ message: "field_provision_failed" }),
      );
    });
    expect(firebaseMocks.provision).toHaveBeenCalledOnce();
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });
});

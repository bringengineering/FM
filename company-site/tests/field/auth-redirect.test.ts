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
  databaseGet: vi.fn(),
  databaseRef: vi.fn(),
  fieldUserRecord: { enabled: true, role: "staff" } as unknown,
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signInWithCredential: vi.fn(),
  driveConnect: vi.fn(),
  driveAdopt: vi.fn(),
  popupCredential: { accessToken: "drive-access-token" } as { accessToken?: string } | null,
  providerAddScope: vi.fn(),
  providerSetCustomParameters: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class GoogleAuthProvider {
    static credential = vi.fn((_idToken: unknown, accessToken: string) => ({ accessToken }));
    static credentialFromResult = vi.fn(() => firebaseMocks.popupCredential);
    addScope = firebaseMocks.providerAddScope;
    setCustomParameters = firebaseMocks.providerSetCustomParameters;
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
  signInWithCredential: firebaseMocks.signInWithCredential,
  signOut: firebaseMocks.signOut,
}));

vi.mock("../../app/field/lib/drive-auth.client", () => ({
  BRING_COMPANY_GOOGLE_ACCOUNT: "bringengineering1008@gmail.com",
  GOOGLE_DRIVE_FILE_SCOPE: "drive-scope",
  driveTokenManager: {
    connect: firebaseMocks.driveConnect,
    adoptAccessToken: firebaseMocks.driveAdopt,
  },
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => firebaseMocks.provision),
}));

vi.mock("firebase/database", () => ({
  get: firebaseMocks.databaseGet,
  ref: firebaseMocks.databaseRef,
}));

vi.mock("../../app/field/lib/firebase.client", () => ({
  auth: { name: "field-auth-test" },
  database: { name: "field-database-test" },
  functions: { name: "field-functions-test" },
}));

import {
  loginFieldUser,
  observeFieldSession,
} from "../../app/field/lib/auth.client";

function fieldUser(
  tokenResults: Array<{ claims: Record<string, unknown> }>,
  email = "bringengineering1008@gmail.com",
) {
  return {
    uid: "user-1",
    email,
    displayName: "브링 담당자",
    getIdTokenResult: vi.fn(async () => {
      const next = tokenResults.shift();
      if (!next) throw new Error("unexpected token read");
      return next;
    }),
  };
}

describe("mobile-safe popup field authentication", () => {
  beforeEach(() => {
    firebaseMocks.authStateListener = undefined;
    firebaseMocks.fieldUserRecord = { enabled: true, role: "staff" };
    firebaseMocks.databaseGet.mockReset().mockImplementation(async () => ({
      val: () => firebaseMocks.fieldUserRecord,
    }));
    firebaseMocks.databaseRef.mockReset().mockImplementation(
      (_database: unknown, path: string) => ({ path }),
    );
    firebaseMocks.provision.mockReset().mockResolvedValue(undefined);
    firebaseMocks.signInWithPopup.mockReset();
    firebaseMocks.signInWithRedirect.mockReset();
    firebaseMocks.signInWithCredential.mockReset();
    firebaseMocks.driveConnect.mockReset().mockResolvedValue("drive-access-token");
    firebaseMocks.driveAdopt.mockReset();
    firebaseMocks.popupCredential = { accessToken: "drive-access-token" };
    firebaseMocks.providerAddScope.mockReset();
    firebaseMocks.providerSetCustomParameters.mockReset();
    firebaseMocks.signOut.mockReset().mockResolvedValue(undefined);
    firebaseMocks.unsubscribe.mockReset();
  });

  it("uses one Firebase Google popup for login and Drive", async () => {
    const user = fieldUser([{ claims: { fieldPlatform: true, fieldRole: "staff" } }]);
    firebaseMocks.signInWithPopup.mockResolvedValue({ user });

    await expect(loginFieldUser()).resolves.toMatchObject({
      uid: "user-1",
      role: "staff",
    });

    expect(firebaseMocks.providerAddScope).toHaveBeenCalledWith("drive-scope");
    expect(firebaseMocks.providerSetCustomParameters).toHaveBeenCalledWith({
      login_hint: "bringengineering1008@gmail.com",
    });
    expect(firebaseMocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(firebaseMocks.driveAdopt).toHaveBeenCalledWith("drive-access-token");
    expect(firebaseMocks.driveConnect).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithCredential).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithRedirect).not.toHaveBeenCalled();
    expect(firebaseMocks.provision).not.toHaveBeenCalled();
  });

  it("rejects a different Google account before adopting its Drive token", async () => {
    const user = fieldUser(
      [{ claims: { fieldPlatform: true, fieldRole: "admin" } }],
      "dpvld858@gmail.com",
    );
    firebaseMocks.signInWithPopup.mockResolvedValue({ user });

    await expect(loginFieldUser()).rejects.toThrow("field_company_account_required");

    expect(firebaseMocks.driveAdopt).not.toHaveBeenCalled();
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
  });

  it("maps a denied Google popup to a stable login error", async () => {
    firebaseMocks.signInWithPopup.mockRejectedValue(new Error("popup closed"));

    await expect(loginFieldUser()).rejects.toThrow("field_login_start_failed");
    expect(firebaseMocks.driveAdopt).not.toHaveBeenCalled();
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
    expect(firebaseMocks.databaseRef).toHaveBeenCalledWith(
      expect.anything(),
      "fieldPlatform/users/user-1",
    );
    expect(firebaseMocks.databaseGet).toHaveBeenCalledOnce();
    expect(errorListener).not.toHaveBeenCalled();
  });

  it("restores an enabled persisted session whose stored role matches its claim", async () => {
    const user = fieldUser([
      { claims: { fieldPlatform: true, fieldRole: "reviewer" } },
    ]);
    const listener = vi.fn();
    firebaseMocks.fieldUserRecord = { enabled: true, role: "reviewer" };

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
    expect(firebaseMocks.databaseGet).toHaveBeenCalledOnce();
    expect(firebaseMocks.provision).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", { enabled: false, role: "staff" }],
    ["missing", null],
    ["role-mismatched", { enabled: true, role: "admin" }],
  ])(
    "rejects a claimed persisted session when its user record is %s",
    async (_case, record) => {
      const user = fieldUser([
        { claims: { fieldPlatform: true, fieldRole: "staff" } },
      ]);
      const listener = vi.fn();
      const errorListener = vi.fn();
      const getFieldUser = vi.fn(async () => record);
      firebaseMocks.signOut.mockImplementation(async () => {
        firebaseMocks.authStateListener?.(null);
      });

      observeFieldSession(listener, errorListener, {
        getFieldUser,
        provisionFieldUser: firebaseMocks.provision,
        signOut: firebaseMocks.signOut,
      });
      firebaseMocks.authStateListener?.(user);

      await vi.waitFor(() => {
        expect(errorListener).toHaveBeenCalledWith(
          expect.objectContaining({ message: "field_access_denied" }),
        );
      });
      expect(getFieldUser).toHaveBeenCalledWith("user-1");
      expect(firebaseMocks.databaseGet).not.toHaveBeenCalled();
      expect(firebaseMocks.provision).not.toHaveBeenCalled();
      expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it("rejects a post-provision session when the current user record is disabled", async () => {
    const user = fieldUser([
      { claims: {} },
      { claims: { fieldPlatform: true, fieldRole: "staff" } },
    ]);
    const listener = vi.fn();
    const errorListener = vi.fn();
    firebaseMocks.fieldUserRecord = { enabled: false, role: "staff" };

    observeFieldSession(listener, errorListener);
    firebaseMocks.authStateListener?.(user);

    await vi.waitFor(() => {
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ message: "field_access_denied" }),
      );
    });
    expect(firebaseMocks.provision).toHaveBeenCalledOnce();
    expect(user.getIdTokenResult).toHaveBeenNthCalledWith(2, true);
    expect(firebaseMocks.databaseGet).toHaveBeenCalledOnce();
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
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

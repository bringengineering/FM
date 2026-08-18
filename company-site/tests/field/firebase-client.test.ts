import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  initializeAppCheck: vi.fn(),
  getToken: vi.fn(),
  initializeApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  providerKeys: [] as string[],
}));

vi.mock("firebase/app", () => ({
  getApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  getApps: vi.fn(() => []),
  initializeApp: firebaseMocks.initializeApp,
}));

vi.mock("firebase/app-check", () => ({
  getToken: firebaseMocks.getToken,
  initializeAppCheck: firebaseMocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    constructor(siteKey: string) {
      firebaseMocks.providerKeys.push(siteKey);
    }
  },
}));

vi.mock("firebase/auth", () => ({ getAuth: vi.fn(() => ({ source: "auth" })) }));
vi.mock("firebase/database", () => ({ getDatabase: vi.fn(() => ({ source: "database" })) }));
vi.mock("firebase/functions", () => ({ getFunctions: vi.fn(() => ({ source: "functions" })) }));
vi.mock("firebase/storage", () => ({ getStorage: vi.fn(() => ({ source: "storage" })) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  firebaseMocks.initializeAppCheck.mockClear();
  firebaseMocks.providerKeys.length = 0;
  Reflect.deleteProperty(globalThis, "__bringFieldAppCheckApps");
  Reflect.deleteProperty(globalThis, "__bringFieldAppCheckInstances");
  Reflect.deleteProperty(globalThis, "FIREBASE_APPCHECK_DEBUG_TOKEN");
});

describe("Firebase App Check configuration", () => {
  it("connects the field app to the company bring-fm Firebase project", async () => {
    await import("../../app/field/lib/firebase.client");

    expect(firebaseMocks.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "bring-fm",
      authDomain: "bring-fm.firebaseapp.com",
      databaseURL: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
      storageBucket: "bring-fm.firebasestorage.app",
    }));
  });

  it("fails closed without App Check in production or CRM embedded mode", async () => {
    const { resolveFieldAppCheckConfigurationError } = await import(
      "../../app/field/lib/firebase.client"
    );

    expect(resolveFieldAppCheckConfigurationError("production", "", false, false))
      .toBe("현장 업무 보안 연결 설정을 확인해 주세요.");
    expect(resolveFieldAppCheckConfigurationError("production", "   ", false, false))
      .toBe("현장 업무 보안 연결 설정을 확인해 주세요.");
    expect(resolveFieldAppCheckConfigurationError("development", "", true, false))
      .toBe("현장 업무 보안 연결 설정을 확인해 주세요.");
    expect(resolveFieldAppCheckConfigurationError("development", "", false, true)).toBeNull();
    expect(resolveFieldAppCheckConfigurationError("production", "site-key", true, false)).toBeNull();
  });

  it("enables the debug token only outside production and initializes App Check once", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY", "dev-site-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN", "true");

    await import("../../app/field/lib/firebase.client");

    expect((globalThis as typeof globalThis & {
      FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean;
    }).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
    expect(firebaseMocks.providerKeys).toEqual(["dev-site-key"]);
    expect(firebaseMocks.initializeAppCheck).toHaveBeenCalledOnce();
  });
});

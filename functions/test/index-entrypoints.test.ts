import { describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
  onCall: vi.fn((options: unknown, handler: unknown) => ({
    kind: "callable",
    options,
    handler,
  })),
  onValueWritten: vi.fn((options: unknown, handler: unknown) => ({
    kind: "database",
    options,
    handler,
  })),
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  initializeApp: registrations.initializeApp,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({}),
}));

vi.mock("firebase-admin/database", () => ({
  getDatabase: () => ({}),
  ServerValue: { TIMESTAMP: { ".sv": "timestamp" } },
}));

vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class MockHttpsError extends Error {},
  onCall: registrations.onCall,
}));

vi.mock("firebase-functions/v2/database", () => ({
  onValueWritten: registrations.onValueWritten,
}));

import * as entrypoints from "../src/index.js";

interface RegisteredEntrypoint {
  kind: "callable" | "database";
  options: Record<string, unknown>;
  handler: unknown;
}

function registration(value: unknown): RegisteredEntrypoint {
  return value as RegisteredEntrypoint;
}

describe("Firebase entrypoint metadata", () => {
  it("exports both App Check enforced field callables in asia-northeast3", () => {
    expect(registration(entrypoints.saveFieldRegistration)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
      },
    });
    expect(registration(entrypoints.saveFieldRegistration).options).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
    });

    expect(registration(entrypoints.setManagementContractStatus)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
      },
    });
    expect(
      registration(entrypoints.setManagementContractStatus).options,
    ).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
    });
  });

  it.each([
    [
      "building",
      entrypoints.rebuildMapProjectionOnBuildingWrite,
      "/fieldPlatform/buildings/{buildingId}",
    ],
    [
      "listing",
      entrypoints.rebuildMapProjectionOnListingWrite,
      "/fieldPlatform/listings/{listingId}",
    ],
    [
      "media",
      entrypoints.rebuildMapProjectionOnMediaWrite,
      "/fieldPlatform/media/{mediaId}",
    ],
  ])("exports the %s projection trigger with exact RTDB options", (_name, value, ref) => {
    expect(registration(value)).toMatchObject({ kind: "database" });
    expect(registration(value).options).toEqual({
      ref,
      instance: "bring-fm-hj-default-rtdb",
      region: "asia-southeast1",
    });
  });

  it("keeps provisionFieldUser exported while registering exactly five Task 5 entrypoints", () => {
    expect(entrypoints.provisionFieldUser).toBeDefined();
    expect(registration(entrypoints.provisionFieldUser)).toMatchObject({
      kind: "callable",
      options: { region: "asia-northeast3" },
    });
    expect(registrations.initializeApp).toHaveBeenCalledTimes(1);
    expect(registrations.onCall).toHaveBeenCalledTimes(3);
    expect(registrations.onValueWritten).toHaveBeenCalledTimes(3);
  });
});

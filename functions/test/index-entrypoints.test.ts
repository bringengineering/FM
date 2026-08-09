import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => {
  const transactionStates: unknown[] = [];
  const databaseTransaction = vi.fn(
    async (update: (current: unknown) => unknown) => {
      const state = update(null);
      transactionStates.push(state);
      return {
        committed: true,
        snapshot: { val: () => state },
      };
    },
  );
  return {
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
    rebuildMapProjectionForBuilding: vi.fn(async () => undefined),
    databaseTransaction,
    databaseRef: vi.fn(() => ({ transaction: databaseTransaction })),
    transactionStates,
  };
});

vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  initializeApp: registrations.initializeApp,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({}),
}));

vi.mock("firebase-admin/database", () => ({
  getDatabase: () => ({ ref: registrations.databaseRef }),
  ServerValue: { TIMESTAMP: { ".sv": "timestamp" } },
}));

vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class MockHttpsError extends Error {},
  onCall: registrations.onCall,
}));

vi.mock("firebase-functions/v2/database", () => ({
  onValueWritten: registrations.onValueWritten,
}));

vi.mock("../src/field/rebuild-map-projection.js", () => ({
  rebuildMapProjectionForBuilding:
    registrations.rebuildMapProjectionForBuilding,
}));

import * as entrypoints from "../src/index.js";

interface RegisteredEntrypoint {
  kind: "callable" | "database";
  options: Record<string, unknown>;
  handler: unknown;
}

interface DatabaseWriteEvent {
  id: string;
  time: string;
  params: Record<string, string>;
  data: {
    before: { val(): unknown };
    after: { val(): unknown };
  };
}

type DatabaseWriteHandler = (event: DatabaseWriteEvent) => Promise<void>;

interface EventScopedProjectionDependencies {
  now(): string;
  setProjection(buildingId: string, projection: null): Promise<void>;
}

function registration(value: unknown): RegisteredEntrypoint {
  return value as RegisteredEntrypoint;
}

function databaseHandler(value: unknown): DatabaseWriteHandler {
  return registration(value).handler as DatabaseWriteHandler;
}

const EVENT_VERSION = {
  eventTime: "2026-08-09T12:00:02.000Z",
  revision: "database-event-2",
};

beforeEach(() => {
  registrations.rebuildMapProjectionForBuilding.mockClear();
  registrations.databaseRef.mockClear();
  registrations.databaseTransaction.mockClear();
  registrations.transactionStates.length = 0;
});

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

  it("passes the building event time and revision to the projection rebuild", async () => {
    await databaseHandler(
      entrypoints.rebuildMapProjectionOnBuildingWrite,
    )({
      id: EVENT_VERSION.revision,
      time: EVENT_VERSION.eventTime,
      params: { buildingId: "building-1" },
      data: {
        before: { val: () => null },
        after: { val: () => null },
      },
    });

    expect(
      registrations.rebuildMapProjectionForBuilding,
    ).toHaveBeenCalledWith("building-1", expect.any(Object));
    const call = registrations.rebuildMapProjectionForBuilding.mock.calls[0];
    expect(call).toHaveLength(2);
    const dependencies = call[1] as EventScopedProjectionDependencies;
    expect(dependencies.now()).toBe(EVENT_VERSION.eventTime);

    await dependencies.setProjection("building-1", null);

    expect(registrations.databaseRef).toHaveBeenCalledWith("fieldPlatform");
    expect(registrations.databaseTransaction).toHaveBeenCalledTimes(1);
    expect(registrations.transactionStates[0]).toMatchObject({
      mapProjectionVersions: {
        "building-1": EVENT_VERSION,
      },
    });
  });

  it.each([
    ["listing", entrypoints.rebuildMapProjectionOnListingWrite],
    ["media", entrypoints.rebuildMapProjectionOnMediaWrite],
  ])(
    "refreshes both distinct path-safe building IDs once for a %s move",
    async (_name, trigger) => {
      const handler = databaseHandler(trigger);
      await handler({
        id: EVENT_VERSION.revision,
        time: EVENT_VERSION.eventTime,
        params: {},
        data: {
          before: { val: () => ({ buildingId: "building-before" }) },
          after: { val: () => ({ buildingId: "building-after" }) },
        },
      });

      expect(
        registrations.rebuildMapProjectionForBuilding.mock.calls.map(
          ([buildingId]) => buildingId,
        ),
      ).toEqual(["building-before", "building-after"]);
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledTimes(2);
      for (const call of registrations.rebuildMapProjectionForBuilding.mock.calls) {
        expect(call).toHaveLength(2);
        expect(
          (call[1] as EventScopedProjectionDependencies).now(),
        ).toBe(EVENT_VERSION.eventTime);
      }

      registrations.rebuildMapProjectionForBuilding.mockClear();
      await handler({
        id: EVENT_VERSION.revision,
        time: EVENT_VERSION.eventTime,
        params: {},
        data: {
          before: { val: () => ({ buildingId: "building-same" }) },
          after: { val: () => ({ buildingId: "building-same" }) },
        },
      });
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledTimes(1);
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledWith("building-same", expect.any(Object));
    },
  );
});

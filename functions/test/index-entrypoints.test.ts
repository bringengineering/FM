import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => {
  const transactionStates: unknown[] = [];
  const transactionCurrent = { value: null as unknown };
  const databaseTransaction = vi.fn(
    async (update: (current: unknown) => unknown) => {
      const state = update(transactionCurrent.value);
      transactionCurrent.value = state;
      transactionStates.push(state);
      return {
        committed: true,
        snapshot: { val: () => state },
      };
    },
  );
  const fieldUser = {
    value: { enabled: true, role: "staff" } as unknown,
  };
  const databaseGet = vi.fn(async () => ({
    val: () => fieldUser.value,
  }));
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
    databaseGet,
    databaseRef: vi.fn(() => ({
      get: databaseGet,
      transaction: databaseTransaction,
    })),
    fieldUser,
    transactionStates,
    transactionCurrent,
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
  HttpsError: class MockHttpsError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
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

type CallableHandler = (request: unknown) => Promise<unknown>;

interface EventScopedProjectionDependencies {
  now(): string;
  setProjection(buildingId: string, projection: unknown): Promise<void>;
}

function registration(value: unknown): RegisteredEntrypoint {
  return value as RegisteredEntrypoint;
}

function databaseHandler(value: unknown): DatabaseWriteHandler {
  return registration(value).handler as DatabaseWriteHandler;
}

function callableHandler(value: unknown): CallableHandler {
  return registration(value).handler as CallableHandler;
}

function validRegistrationData() {
  return {
    requestId: "request-1",
    draftId: "draft-1",
    building: {
      managementNumber: "MGMT-001",
      name: "Test building",
      roadAddress: "1 Test-ro, Wonju",
      latitude: 37.369,
      longitude: 127.928,
      elevator: true,
      parking: { available: true },
    },
    units: [{
      localId: "unit-1",
      unitLabel: "101",
      options: [],
      isVacant: true,
    }],
    listing: {
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: [],
      parkingDescription: "Available",
      petPolicy: "Ask owner",
      options: [],
    },
    primaryUnitLocalId: "unit-1",
    managementContract: { requested: false },
    ownerNoteDrafts: [{
      localId: "note_12345678",
      body: "Owner requested a follow-up",
      recordedAt: "2026-08-09T01:30:00.000Z",
    }],
  };
}

function validCallableRequest(data: unknown) {
  return {
    auth: {
      uid: "staff-1",
      token: {
        fieldPlatform: true,
        fieldRole: "staff",
        name: "Verified staff",
        auth_time: 1_723_181_696,
      },
    },
    data,
  };
}

const EVENT_VERSION = {
  eventTime: "2026-08-09T12:00:02.000Z",
  revision: "database-event-2",
};

beforeEach(() => {
  registrations.rebuildMapProjectionForBuilding.mockClear();
  registrations.databaseRef.mockClear();
  registrations.databaseTransaction.mockClear();
  registrations.databaseGet.mockClear();
  registrations.fieldUser.value = { enabled: true, role: "staff" };
  registrations.transactionStates.length = 0;
  registrations.transactionCurrent.value = null;
});

describe("Firebase entrypoint metadata", () => {
  it.each([
    ["blank body", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts[0].body = "   ";
    }],
    ["duplicate IDs", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts.push({ ...data.ownerNoteDrafts[0] });
    }],
    ["more than 100 drafts", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts = Array.from({ length: 101 }, (_, index) => ({
        ...data.ownerNoteDrafts[0],
        localId: `note_${String(index).padStart(8, "0")}`,
      }));
    }],
    ["noncanonical recordedAt", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts[0].recordedAt = "2026-08-09T01:30:00Z";
    }],
  ])("maps an initial owner-note %s to invalid-argument", async (_label, mutate) => {
    const data = validRegistrationData();
    mutate(data);

    await expect(
      callableHandler(entrypoints.saveFieldRegistration)(
        validCallableRequest(data),
      ),
    ).rejects.toMatchObject({
      code: "invalid-argument",
      message: "field_invalid_registration",
    });
  });

  it("derives the note actor name and decimal session ID only from verified claims", async () => {
    const actor = await entrypoints.requireFieldActor({
      auth: {
        uid: "staff-1",
        token: {
          fieldPlatform: true,
          fieldRole: "staff",
          name: "인증된 이름",
          auth_time: 1_723_181_696,
        },
      },
      data: {
        tokenDisplayName: "위조 이름",
        sessionId: "위조 세션",
      },
    } as never);

    expect(actor).toEqual({
      uid: "staff-1",
      role: "staff",
      enabled: true,
      tokenDisplayName: "인증된 이름",
      sessionId: "1723181696",
    });
    expect(registrations.databaseRef).toHaveBeenCalledWith(
      "fieldPlatform/users/staff-1",
    );
  });

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

  it("rebuilds from transaction-current state instead of an obsolete pre-read candidate", async () => {
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

    registrations.transactionCurrent.value = {
      buildings: {
        "building-1": {
          id: "building-1",
          name: "Current paused building",
          roadAddress: "1 Current-ro, Wonju",
          latitude: 37.369,
          longitude: 127.928,
          managementContract: {
            status: "paused",
            startedOn: "2026-08-01",
            updatedAt: "2026-08-09T12:00:03.000Z",
            updatedBy: "admin-1",
          },
        },
      },
      listings: {},
      media: {},
    };
    await dependencies.setProjection("building-1", {
      buildingId: "building-1",
      name: "Obsolete active projection",
      roadAddress: "1 Old-ro, Wonju",
      latitude: 37.369,
      longitude: 127.928,
      markerStatus: "managed",
      vacancyCount: 0,
      approvedRentSummary: "obsolete",
      parkingSummary: "obsolete",
      captureStatus: "notStarted",
      updatedAt: "2026-08-09T12:00:01.000Z",
    });

    expect(registrations.databaseRef).toHaveBeenCalledWith("fieldPlatform");
    expect(registrations.databaseTransaction).toHaveBeenCalledTimes(1);
    expect(registrations.transactionStates[0]).not.toHaveProperty(
      "mapProjections.building-1",
    );
    expect(registrations.transactionStates[0]).not.toHaveProperty(
      "mapProjectionVersions",
    );
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

  it("ignores reversed CloudEvent IDs at the same timestamp", async () => {
    const handler = databaseHandler(
      entrypoints.rebuildMapProjectionOnBuildingWrite,
    );
    registrations.transactionCurrent.value = {
      buildings: {
        "building-1": {
          id: "building-1",
          name: "Authoritative same-time building",
          roadAddress: "1 Current-ro, Wonju",
          latitude: 37.369,
          longitude: 127.928,
          managementContract: {
            status: "active",
            startedOn: "2026-08-01",
            updatedAt: "2026-08-09T12:00:06.000Z",
            updatedBy: "admin-1",
          },
        },
      },
      listings: {},
      media: {},
    };

    for (const id of ["zzzz-event", "aaaa-event"]) {
      await handler({
        id,
        time: "2026-08-09T12:00:06.123456Z",
        params: { buildingId: "building-1" },
        data: {
          before: { val: () => null },
          after: { val: () => null },
        },
      });
      const call = registrations.rebuildMapProjectionForBuilding.mock.calls.at(-1);
      expect(call).toHaveLength(2);
      await (call?.[1] as EventScopedProjectionDependencies).setProjection(
        "building-1",
        { name: `obsolete-${id}` },
      );
    }

    expect(registrations.transactionCurrent.value).toMatchObject({
      mapProjections: {
        "building-1": {
          name: "Authoritative same-time building",
          updatedAt: "2026-08-09T12:00:06.123456Z",
        },
      },
    });
    expect(registrations.transactionCurrent.value).not.toHaveProperty(
      "mapProjectionVersions",
    );
  });
});

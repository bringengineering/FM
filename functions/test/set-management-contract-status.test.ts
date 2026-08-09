import { describe, expect, it, vi } from "vitest";

import type {
  FieldActor,
  ManagementContractInfo,
} from "../src/field/contracts.js";
import type {
  ProjectionBuilding,
  ProjectionListing,
  ProjectionMedia,
} from "../src/field/map-projection.js";
import {
  setManagementContractStatusCore,
  type ContractRequestReceipt,
  type ContractTransitionReservation,
  type ContractTransitionReservationOutcome,
  type SetManagementContractStatusDependencies,
  type SetManagementContractStatusInput,
} from "../src/field/set-management-contract-status.js";

const NOW = "2026-08-09T12:34:56.000Z";
const PREVIOUS_UPDATE = "2026-08-01T09:00:00.000Z";
const BUILDING_ID = "building-1";

const adminActor: FieldActor = {
  uid: "admin-1",
  role: "admin",
  enabled: true,
};

type StoredBuilding = ProjectionBuilding & {
  managementNumber: string;
  managementContract: ManagementContractInfo;
  contractHistory: Array<Record<string, unknown>>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  ownerPhone?: string;
};

function contractFor(
  status: ManagementContractInfo["status"],
): ManagementContractInfo {
  const stamp = { updatedAt: PREVIOUS_UPDATE, updatedBy: "admin-original" };
  switch (status) {
    case "none":
      return { status, ...stamp };
    case "pending":
    case "active":
    case "paused":
      return { status, startedOn: "2026-07-01", ...stamp };
    case "ended":
      return {
        status,
        startedOn: "2026-07-01",
        endedOn: "2026-07-31",
        ...stamp,
      };
  }
}

function buildingWith(
  status: ManagementContractInfo["status"],
): StoredBuilding {
  return {
    id: BUILDING_ID,
    managementNumber: "MGMT-001",
    name: "Sangji House",
    roadAddress: "1 Sangjidae-gil, Wonju",
    latitude: 37.369,
    longitude: 127.928,
    parking: { available: true, totalSpaces: 8 },
    managementContract: contractFor(status),
    contractHistory: [{ status: "created", at: "2026-06-01" }],
    createdAt: "2026-06-01T00:00:00.000Z",
    createdBy: "staff-1",
    updatedAt: PREVIOUS_UPDATE,
    updatedBy: "admin-original",
    ownerPhone: "TEST-PRIVATE-OWNER-PHONE",
  };
}

function inputFor(
  status: SetManagementContractStatusInput["status"],
  requestId = "request-1",
): SetManagementContractStatusInput {
  return { requestId, buildingId: BUILDING_ID, status };
}

function cloneReservation(
  reservation: ContractTransitionReservation,
): ContractTransitionReservation {
  return {
    ...reservation,
    result: { ...reservation.result },
  };
}

function createBarrier(participants: number): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === participants) release?.();
    await ready;
  };
}

interface AdapterOptions {
  beforeBuildingRead?: () => Promise<void>;
  building?: ProjectionBuilding | null;
  listings?: ProjectionListing[];
  media?: ProjectionMedia[];
  persistReceipts?: boolean;
  now?: () => string;
}

function createInMemoryAdapter(options: AdapterOptions = {}) {
  const receipts = new Map<string, ContractRequestReceipt>();
  const reservationsByRequest = new Map<string, ContractTransitionReservation>();
  const reservationsByBuilding = new Map<string, ContractTransitionReservation>();
  const patches: Record<string, unknown>[] = [];
  const building = options.building === undefined
    ? buildingWith("pending")
    : options.building;

  const dependencies: SetManagementContractStatusDependencies = {
    getBuilding: vi.fn(async () => {
      await options.beforeBuildingRead?.();
      return building;
    }),
    getListings: vi.fn(async () => options.listings ?? []),
    getMedia: vi.fn(async () => options.media ?? []),
    getReceipt: vi.fn(async (uid, requestId) =>
      receipts.get(`${uid}\0${requestId}`) ?? null,
    ),
    reserveTransition: vi.fn(
      async (
        proposed: ContractTransitionReservation,
      ): Promise<ContractTransitionReservationOutcome> => {
        const requestKey = `${proposed.uid}\0${proposed.requestId}`;
        const requestReservation = reservationsByRequest.get(requestKey);
        if (requestReservation) {
          if (
            requestReservation.requestHash !== proposed.requestHash ||
            requestReservation.buildingId !== proposed.buildingId
          ) {
            return { status: "requestConflict" };
          }
          return {
            status: "acquired",
            reservation: cloneReservation(requestReservation),
          };
        }

        const buildingReservation = reservationsByBuilding.get(
          proposed.buildingId,
        );
        if (buildingReservation) return { status: "buildingConflict" };

        const stored = cloneReservation(proposed);
        reservationsByRequest.set(requestKey, stored);
        reservationsByBuilding.set(proposed.buildingId, stored);
        return { status: "acquired", reservation: cloneReservation(stored) };
      },
    ),
    updateRoot: vi.fn(async (patch) => {
      patches.push(patch);
      if (options.persistReceipts === false) return;
      for (const [path, value] of Object.entries(patch)) {
        const match = /^fieldPlatform\/managementContractRequests\/([^/]+)\/([^/]+)$/.exec(
          path,
        );
        if (match) {
          receipts.set(`${match[1]}\0${match[2]}`, value as ContractRequestReceipt);
        }
      }
    }),
    now: vi.fn(options.now ?? (() => NOW)),
  };

  return {
    dependencies,
    patches,
    receipts,
    reservationsByRequest,
    reservationsByBuilding,
  };
}

describe("setManagementContractStatusCore", () => {
  it("denies staff and disabled admins before reading or writing data", async () => {
    for (const actor of [
      { uid: "staff-1", role: "staff", enabled: true },
      { uid: "admin-1", role: "admin", enabled: false },
    ] as FieldActor[]) {
      const { dependencies } = createInMemoryAdapter();

      await expect(
        setManagementContractStatusCore(
          { ...inputFor("active"), startedOn: "2026-08-09" },
          actor,
          dependencies,
        ),
      ).rejects.toThrow("field_management_admin_required");
      expect(dependencies.getReceipt).not.toHaveBeenCalled();
      expect(dependencies.updateRoot).not.toHaveBeenCalled();
    }
  });

  it("activates a pending contract and atomically writes one audit, safe projection, and receipt", async () => {
    const listings: ProjectionListing[] = [
      {
        id: "listing-owned",
        buildingId: BUILDING_ID,
        status: "advertising",
        advertisingApproved: true,
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 50_000,
      },
      {
        id: "listing-foreign",
        buildingId: "building-2",
        status: "advertising",
        advertisingApproved: true,
        depositWon: 999_000_000,
      },
    ];
    const media: ProjectionMedia[] = [
      { buildingId: BUILDING_ID, uploadState: "finalized" },
      { buildingId: "building-2", uploadState: "finalized" },
    ];
    const { dependencies, patches } = createInMemoryAdapter({ listings, media });
    const input = {
      ...inputFor("active"),
      startedOn: "2026-08-09",
    };

    const result = await setManagementContractStatusCore(
      input,
      adminActor,
      dependencies,
    );

    expect(result).toEqual({ buildingId: BUILDING_ID, status: "active" });
    expect(dependencies.reserveTransition).toHaveBeenCalledTimes(1);
    expect(dependencies.getListings).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.getMedia).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches).toHaveLength(1);

    const patch = patches[0];
    const auditPaths = Object.keys(patch).filter((path) =>
      path.startsWith("fieldPlatform/auditLogs/"),
    );
    expect(Object.keys(patch)).toHaveLength(4);
    expect(auditPaths).toHaveLength(1);
    expect(new Set(Object.keys(patch))).toEqual(
      new Set([
        `fieldPlatform/buildings/${BUILDING_ID}`,
        auditPaths[0],
        `fieldPlatform/mapProjections/${BUILDING_ID}`,
        `fieldPlatform/managementContractRequests/${adminActor.uid}/${input.requestId}`,
      ]),
    );

    expect(patch[`fieldPlatform/buildings/${BUILDING_ID}`]).toEqual({
      ...buildingWith("pending"),
      managementContract: {
        status: "active",
        startedOn: "2026-08-09",
        updatedAt: NOW,
        updatedBy: adminActor.uid,
      },
      updatedAt: NOW,
      updatedBy: adminActor.uid,
    });
    expect(patch[auditPaths[0]]).toMatchObject({
      id: auditPaths[0].slice("fieldPlatform/auditLogs/".length),
      actorId: adminActor.uid,
      action: "managementContract.active",
      entityType: "managementContract",
      entityId: BUILDING_ID,
      occurredAt: NOW,
      requestId: input.requestId,
      changes: {
        status: { before: "pending", after: "active" },
        startedOn: { before: "2026-07-01", after: "2026-08-09" },
      },
    });
    expect(auditPaths[0]).toMatch(/^fieldPlatform\/auditLogs\/audit_[a-f0-9]{24}$/);

    const projection = patch[
      `fieldPlatform/mapProjections/${BUILDING_ID}`
    ] as Record<string, unknown>;
    expect(projection).toMatchObject({
      buildingId: BUILDING_ID,
      vacancyCount: 1,
      captureStatus: "inProgress",
      updatedAt: NOW,
    });
    expect(Object.keys(projection)).toHaveLength(11);
    expect(JSON.stringify(projection)).not.toMatch(
      /TEST-PRIVATE-OWNER-PHONE|listing-foreign|999000000/,
    );
    expect(
      patch[
        `fieldPlatform/managementContractRequests/${adminActor.uid}/${input.requestId}`
      ],
    ).toEqual({
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      result,
      completedAt: NOW,
    });
  });

  it("requires a valid activation date for a first activation", async () => {
    for (const startedOn of [undefined, "2026-02-30", "09-08-2026"]) {
      const { dependencies } = createInMemoryAdapter();
      const input = { ...inputFor("active"), startedOn };

      await expect(
        setManagementContractStatusCore(input, adminActor, dependencies),
      ).rejects.toThrow("field_management_transition_invalid");
      expect(dependencies.reserveTransition).not.toHaveBeenCalled();
      expect(dependencies.updateRoot).not.toHaveBeenCalled();
    }
  });

  it("ends an active contract while retaining building history and removing its projection", async () => {
    const source = buildingWith("active");
    const { dependencies, patches } = createInMemoryAdapter({ building: source });

    const result = await setManagementContractStatusCore(
      { ...inputFor("ended"), endedOn: "2026-12-31" },
      adminActor,
      dependencies,
    );

    expect(result).toEqual({ buildingId: BUILDING_ID, status: "ended" });
    expect(patches[0][`fieldPlatform/buildings/${BUILDING_ID}`]).toEqual({
      ...source,
      managementContract: {
        status: "ended",
        startedOn: "2026-07-01",
        endedOn: "2026-12-31",
        updatedAt: NOW,
        updatedBy: adminActor.uid,
      },
      updatedAt: NOW,
      updatedBy: adminActor.uid,
    });
    expect(patches[0][`fieldPlatform/mapProjections/${BUILDING_ID}`]).toBeNull();
    expect(dependencies.getListings).not.toHaveBeenCalled();
    expect(dependencies.getMedia).not.toHaveBeenCalled();
  });

  it("pauses an active contract without changing its start date", async () => {
    const { dependencies, patches } = createInMemoryAdapter({
      building: buildingWith("active"),
    });

    await setManagementContractStatusCore(
      { ...inputFor("paused"), startedOn: "2026-08-09", endedOn: "2026-08-10" },
      adminActor,
      dependencies,
    );

    expect(patches[0][`fieldPlatform/buildings/${BUILDING_ID}`]).toMatchObject({
      managementContract: {
        status: "paused",
        startedOn: "2026-07-01",
        updatedAt: NOW,
        updatedBy: adminActor.uid,
      },
    });
    expect(
      (patches[0][`fieldPlatform/buildings/${BUILDING_ID}`] as StoredBuilding)
        .managementContract,
    ).not.toHaveProperty("endedOn");
  });

  it("resumes a paused contract with its prior start unless a valid date is supplied", async () => {
    for (const [requestId, startedOn, expected] of [
      ["request-preserve", undefined, "2026-07-01"],
      ["request-replace", "2026-08-09", "2026-08-09"],
    ] as const) {
      const { dependencies, patches } = createInMemoryAdapter({
        building: buildingWith("paused"),
      });

      await setManagementContractStatusCore(
        { ...inputFor("active", requestId), startedOn },
        adminActor,
        dependencies,
      );

      expect(patches[0][`fieldPlatform/buildings/${BUILDING_ID}`]).toMatchObject({
        managementContract: {
          status: "active",
          startedOn: expected,
          updatedAt: NOW,
          updatedBy: adminActor.uid,
        },
      });
    }
  });

  it("accepts every allowed transition", async () => {
    const allowed = [
      ["none", "active", { startedOn: "2026-08-09" }],
      ["pending", "active", { startedOn: "2026-08-09" }],
      ["pending", "ended", { endedOn: "2026-08-09" }],
      ["active", "paused", {}],
      ["active", "ended", { endedOn: "2026-08-09" }],
      ["paused", "active", {}],
      ["paused", "ended", { endedOn: "2026-08-09" }],
    ] as const;

    for (const [current, target, dates] of allowed) {
      const { dependencies } = createInMemoryAdapter({
        building: buildingWith(current),
      });
      await expect(
        setManagementContractStatusCore(
          { ...inputFor(target, `${current}-${target}`), ...dates },
          adminActor,
          dependencies,
        ),
      ).resolves.toEqual({ buildingId: BUILDING_ID, status: target });
    }
  });

  it("rejects every known invalid transition edge", async () => {
    const invalid = [
      ["none", "paused"],
      ["none", "ended"],
      ["pending", "pending"],
      ["pending", "paused"],
      ["active", "active"],
      ["paused", "paused"],
      ["ended", "active"],
      ["ended", "paused"],
      ["ended", "ended"],
    ] as const;

    for (const [current, target] of invalid) {
      const { dependencies } = createInMemoryAdapter({
        building: buildingWith(current),
      });
      await expect(
        setManagementContractStatusCore(
          {
            ...inputFor(target, `${current}-${target}`),
            startedOn: "2026-08-09",
            endedOn: "2026-08-09",
          },
          adminActor,
          dependencies,
        ),
      ).rejects.toThrow("field_management_transition_invalid");
      expect(dependencies.updateRoot).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["missing building", null],
    ["wrong building id", { ...buildingWith("pending"), id: "building-2" }],
    ["archived building", { ...buildingWith("pending"), archivedAt: NOW }],
    [
      "malformed current contract",
      { ...buildingWith("active"), managementContract: { status: "active" } },
    ],
    [
      "stale endedOn on active contract",
      {
        ...buildingWith("active"),
        managementContract: {
          ...buildingWith("active").managementContract,
          endedOn: "2026-08-01",
        },
      },
    ],
  ])("rejects a %s", async (_label, building) => {
    const { dependencies } = createInMemoryAdapter({
      building: building as ProjectionBuilding | null,
    });

    await expect(
      setManagementContractStatusCore(
        { ...inputFor("active"), startedOn: "2026-08-09" },
        adminActor,
        dependencies,
      ),
    ).rejects.toThrow("field_management_transition_invalid");
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it.each([
    ["unsafe request ID", { ...inputFor("active"), requestId: "bad/request", startedOn: "2026-08-09" }],
    ["unsafe building ID", { ...inputFor("active"), buildingId: "bad#building", startedOn: "2026-08-09" }],
    ["unknown target", { ...inputFor("active"), status: "pending", startedOn: "2026-08-09" }],
    ["impossible end date", { ...inputFor("ended"), endedOn: "2026-02-29" }],
    ["oversized request ID", { ...inputFor("active"), requestId: "x".repeat(129), startedOn: "2026-08-09" }],
  ])("rejects untrusted input with an %s", async (_label, input) => {
    const { dependencies } = createInMemoryAdapter();

    await expect(
      setManagementContractStatusCore(
        input as SetManagementContractStatusInput,
        adminActor,
        dependencies,
      ),
    ).rejects.toThrow("field_management_transition_invalid");
    expect(dependencies.getReceipt).not.toHaveBeenCalled();
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it("returns a matching completed receipt before re-reading the now same-state building", async () => {
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };
    const { dependencies } = createInMemoryAdapter();

    const first = await setManagementContractStatusCore(
      input,
      adminActor,
      dependencies,
    );
    const second = await setManagementContractStatusCore(
      { ...input },
      adminActor,
      dependencies,
    );

    expect(second).toEqual(first);
    expect(dependencies.getBuilding).toHaveBeenCalledTimes(1);
    expect(dependencies.reserveTransition).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a completed request ID for a different semantic transition", async () => {
    const { dependencies } = createInMemoryAdapter();
    await setManagementContractStatusCore(
      { ...inputFor("active"), startedOn: "2026-08-09" },
      adminActor,
      dependencies,
    );

    await expect(
      setManagementContractStatusCore(
        { ...inputFor("active"), startedOn: "2026-08-10" },
        adminActor,
        dependencies,
      ),
    ).rejects.toThrow("field_request_id_conflict");
    expect(dependencies.getBuilding).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
  });

  it("atomically allows only one of two different transitions for one building", async () => {
    const { dependencies, patches } = createInMemoryAdapter({
      building: buildingWith("active"),
      beforeBuildingRead: createBarrier(2),
    });

    const settled = await Promise.allSettled([
      setManagementContractStatusCore(
        inputFor("paused", "request-pause"),
        adminActor,
        dependencies,
      ),
      setManagementContractStatusCore(
        { ...inputFor("ended", "request-end"), endedOn: "2026-12-31" },
        { ...adminActor, uid: "admin-2" },
        dependencies,
      ),
    ]);

    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    expect(rejected?.reason).toEqual(
      expect.objectContaining({ message: "field_management_transition_conflict" }),
    );
    expect(dependencies.reserveTransition).toHaveBeenCalledTimes(2);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches).toHaveLength(1);
  });

  it("replays the original reservation after an identical concurrent ACK-loss retry", async () => {
    let clockIndex = 0;
    const clock = [NOW, "2026-08-09T13:34:56.000Z"];
    const { dependencies, patches } = createInMemoryAdapter({
      beforeBuildingRead: createBarrier(2),
      persistReceipts: false,
      now: () => clock[clockIndex++] ?? clock[clock.length - 1],
    });
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };

    const [first, second] = await Promise.all([
      setManagementContractStatusCore(input, adminActor, dependencies),
      setManagementContractStatusCore({ ...input }, adminActor, dependencies),
    ]);

    expect(second).toEqual(first);
    expect(dependencies.reserveTransition).toHaveBeenCalledTimes(2);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(2);
    expect(patches).toHaveLength(2);
    expect(patches[1]).toEqual(patches[0]);
    expect(Object.keys(patches[1]).sort()).toEqual(Object.keys(patches[0]).sort());
  });
});

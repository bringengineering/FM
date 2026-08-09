import { createHash } from "node:crypto";

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
  type ContractTransitionCommitInput,
  type ContractTransitionCommitOutcome,
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

function fingerprintContract(contract: ManagementContractInfo): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        status: contract.status,
        startedOn: contract.startedOn ?? null,
        endedOn: contract.endedOn ?? null,
        updatedAt: contract.updatedAt,
        updatedBy: contract.updatedBy,
      }),
    )
    .digest("hex");
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
    previousContract: { ...reservation.previousContract },
    nextContract: { ...reservation.nextContract },
  };
}

function cloneBuilding(
  building: ProjectionBuilding | null,
): ProjectionBuilding | null {
  if (building === null) return null;
  return {
    ...building,
    ...(building.parking === undefined
      ? {}
      : { parking: building.parking === null ? null : { ...building.parking } }),
    ...(building.managementContract === undefined
      ? {}
      : {
          managementContract:
            building.managementContract === null
              ? null
              : { ...building.managementContract },
        }),
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
  afterBuildingRead?: () => Promise<void>;
  beforeAtomicCommit?: (input: ContractTransitionCommitInput) => Promise<void>;
  beforeUpdateRoot?: () => Promise<void>;
  building?: ProjectionBuilding | null;
  failUpdateRootOnce?: boolean;
  listings?: ProjectionListing[];
  media?: ProjectionMedia[];
  persistReceipts?: boolean;
  now?: () => string;
}

function createInMemoryAdapter(options: AdapterOptions = {}) {
  const receipts = new Map<string, ContractRequestReceipt>();
  const reservationsByRequest = new Map<string, ContractTransitionReservation>();
  const reservationsByBuildingVersion = new Map<
    string,
    ContractTransitionReservation
  >();
  const patches: Record<string, unknown>[] = [];
  let currentBuilding = options.building === undefined
    ? buildingWith("pending")
    : options.building;
  let shouldFailUpdate = options.failUpdateRootOnce === true;

  const applyPatch = (patch: Record<string, unknown>): void => {
    for (const [path, value] of Object.entries(patch)) {
      if (path === `fieldPlatform/buildings/${BUILDING_ID}`) {
        currentBuilding = cloneBuilding(value as ProjectionBuilding);
      }
      const buildingChild = new RegExp(
        `^fieldPlatform/buildings/${BUILDING_ID}/(managementContract|updatedAt|updatedBy)$`,
      ).exec(path);
      if (buildingChild && currentBuilding !== null) {
        currentBuilding = {
          ...currentBuilding,
          [buildingChild[1]]: value,
        } as ProjectionBuilding;
      }
      const receiptMatch =
        /^fieldPlatform\/managementContractRequests\/([^/]+)\/([^/]+)$/.exec(
          path,
        );
      if (receiptMatch) {
        receipts.set(
          `${receiptMatch[1]}\0${receiptMatch[2]}`,
          value as ContractRequestReceipt,
        );
      }
    }
  };

  const dependencies: SetManagementContractStatusDependencies = {
    getBuilding: vi.fn(async () => {
      await options.beforeBuildingRead?.();
      const snapshot = cloneBuilding(currentBuilding);
      await options.afterBuildingRead?.();
      return snapshot;
    }),
    getListings: vi.fn(async () => options.listings ?? []),
    getMedia: vi.fn(async () => options.media ?? []),
    getReceipt: vi.fn(async (uid, requestId) => {
      if (options.persistReceipts === false) return null;
      return receipts.get(`${uid}\0${requestId}`) ?? null;
    }),
    getReservation: vi.fn(async (uid, requestId) => {
      const reservation = reservationsByRequest.get(`${uid}\0${requestId}`);
      return reservation === undefined ? null : cloneReservation(reservation);
    }),
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

        const versionKey =
          `${proposed.buildingId}\0${proposed.previousContractFingerprint}`;
        const buildingReservation = reservationsByBuildingVersion.get(versionKey);
        if (buildingReservation) return { status: "buildingConflict" };

        const stored = cloneReservation(proposed);
        reservationsByRequest.set(requestKey, stored);
        reservationsByBuildingVersion.set(versionKey, stored);
        return { status: "acquired", reservation: cloneReservation(stored) };
      },
    ),
    commitTransitionAtomically: vi.fn(
      async (
        input: ContractTransitionCommitInput,
      ): Promise<ContractTransitionCommitOutcome> => {
        await options.beforeAtomicCommit?.(input);
        const receipt = receipts.get(`${input.uid}\0${input.requestId}`);
        if (
          receipt?.requestHash === input.requestHash &&
          receipt.result.buildingId === input.buildingId &&
          receipt.result.status === input.result.status
        ) {
          return { status: "alreadyCommitted" };
        }
        if (receipt !== undefined) return { status: "staleConflict" };

        if (
          fingerprintContract(input.nextContract) !==
          input.expectedNextContractFingerprint
        ) {
          return { status: "staleConflict" };
        }

        const contract = currentBuilding?.managementContract;
        if (
          contract === undefined ||
          contract === null ||
          fingerprintContract(contract) !==
            input.expectedPreviousContractFingerprint
        ) {
          return { status: "staleConflict" };
        }

        patches.push(input.patch);
        if (shouldFailUpdate) {
          shouldFailUpdate = false;
          throw new Error("simulated_crash_before_root_write");
        }
        applyPatch(input.patch);
        return { status: "committed" };
      },
    ),
    updateRoot: vi.fn(async (patch) => {
      await options.beforeUpdateRoot?.();
      patches.push(patch);
      if (shouldFailUpdate) {
        shouldFailUpdate = false;
        throw new Error("simulated_crash_before_root_write");
      }
      applyPatch(patch);
    }),
    now: vi.fn(options.now ?? (() => NOW)),
  };

  return {
    dependencies,
    patches,
    receipts,
    reservationsByRequest,
    reservationsByBuildingVersion,
    getCurrentBuilding: () => cloneBuilding(currentBuilding),
    setCurrentBuilding: (building: ProjectionBuilding | null) => {
      currentBuilding = cloneBuilding(building);
    },
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
    expect(dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
    expect(patches).toHaveLength(1);

    const commitInput = vi.mocked(dependencies.commitTransitionAtomically).mock
      .calls[0][0];
    expect(commitInput).toMatchObject({
      uid: adminActor.uid,
      requestId: input.requestId,
      buildingId: BUILDING_ID,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expectedPreviousContractFingerprint: expect.stringMatching(
        /^[a-f0-9]{64}$/,
      ),
      expectedNextContractFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      nextContract: {
        status: "active",
        startedOn: "2026-08-09",
        updatedAt: NOW,
        updatedBy: adminActor.uid,
      },
      result,
      patch: patches[0],
    });

    const patch = patches[0];
    const auditPaths = Object.keys(patch).filter((path) =>
      path.startsWith("fieldPlatform/auditLogs/"),
    );
    expect(Object.keys(patch)).toHaveLength(6);
    expect(auditPaths).toHaveLength(1);
    expect(new Set(Object.keys(patch))).toEqual(
      new Set([
        `fieldPlatform/buildings/${BUILDING_ID}/managementContract`,
        `fieldPlatform/buildings/${BUILDING_ID}/updatedAt`,
        `fieldPlatform/buildings/${BUILDING_ID}/updatedBy`,
        auditPaths[0],
        `fieldPlatform/mapProjections/${BUILDING_ID}`,
        `fieldPlatform/managementContractRequests/${adminActor.uid}/${input.requestId}`,
      ]),
    );

    expect(patch).not.toHaveProperty(`fieldPlatform/buildings/${BUILDING_ID}`);
    expect(
      patch[`fieldPlatform/buildings/${BUILDING_ID}/managementContract`],
    ).toEqual({
      status: "active",
      startedOn: "2026-08-09",
      updatedAt: NOW,
      updatedBy: adminActor.uid,
    });
    expect(patch[`fieldPlatform/buildings/${BUILDING_ID}/updatedAt`]).toBe(NOW);
    expect(patch[`fieldPlatform/buildings/${BUILDING_ID}/updatedBy`]).toBe(
      adminActor.uid,
    );
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

  it("preserves private, created, history, and post-read unrelated building children", async () => {
    const source = buildingWith("pending") as StoredBuilding & {
      unrelatedEdit?: string;
    };
    let afterRead = false;
    const adapter = createInMemoryAdapter({
      building: source,
      afterBuildingRead: async () => {
        if (afterRead) return;
        afterRead = true;
        const current = adapter.getCurrentBuilding() as StoredBuilding & {
          unrelatedEdit?: string;
        };
        adapter.setCurrentBuilding({
          ...current,
          unrelatedEdit: "written-after-read",
        });
      },
    });

    await setManagementContractStatusCore(
      { ...inputFor("active"), startedOn: "2026-08-09" },
      adminActor,
      adapter.dependencies,
    );

    const persisted = adapter.getCurrentBuilding() as StoredBuilding & {
      unrelatedEdit?: string;
    };
    expect(persisted.contractHistory).toEqual(source.contractHistory);
    expect(persisted.createdAt).toBe(source.createdAt);
    expect(persisted.createdBy).toBe(source.createdBy);
    expect(persisted.ownerPhone).toBe(source.ownerPhone);
    expect(persisted.unrelatedEdit).toBe("written-after-read");
    expect(adapter.patches[0]).not.toHaveProperty(
      `fieldPlatform/buildings/${BUILDING_ID}`,
    );
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

  it("rejects an end date earlier than the preserved contract start", async () => {
    const { dependencies } = createInMemoryAdapter({
      building: buildingWith("active"),
    });

    await expect(
      setManagementContractStatusCore(
        { ...inputFor("ended"), endedOn: "2026-06-30" },
        adminActor,
        dependencies,
      ),
    ).rejects.toThrow("field_management_transition_invalid");
    expect(dependencies.reserveTransition).not.toHaveBeenCalled();
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it.each(["2026-07-01", "2026-12-31"])(
    "accepts the chronological end date %s",
    async (endedOn) => {
      const { dependencies } = createInMemoryAdapter({
        building: buildingWith("active"),
      });

      await expect(
        setManagementContractStatusCore(
          { ...inputFor("ended"), endedOn },
          adminActor,
          dependencies,
        ),
      ).resolves.toEqual({ buildingId: BUILDING_ID, status: "ended" });
    },
  );

  it("ends an active contract while retaining building history and removing its projection", async () => {
    const source = buildingWith("active");
    const { dependencies, patches } = createInMemoryAdapter({ building: source });

    const result = await setManagementContractStatusCore(
      { ...inputFor("ended"), endedOn: "2026-12-31" },
      adminActor,
      dependencies,
    );

    expect(result).toEqual({ buildingId: BUILDING_ID, status: "ended" });
    expect(
      patches[0][`fieldPlatform/buildings/${BUILDING_ID}/managementContract`],
    ).toEqual({
      status: "ended",
      startedOn: "2026-07-01",
      endedOn: "2026-12-31",
      updatedAt: NOW,
      updatedBy: adminActor.uid,
    });
    expect(patches[0]).not.toHaveProperty(`fieldPlatform/buildings/${BUILDING_ID}`);
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

    expect(
      patches[0][`fieldPlatform/buildings/${BUILDING_ID}/managementContract`],
    ).toEqual({
      status: "paused",
      startedOn: "2026-07-01",
      updatedAt: NOW,
      updatedBy: adminActor.uid,
    });
    expect(
      patches[0][`fieldPlatform/buildings/${BUILDING_ID}/managementContract`],
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

      expect(
        patches[0][`fieldPlatform/buildings/${BUILDING_ID}/managementContract`],
      ).toEqual({
        status: "active",
        startedOn: expected,
        updatedAt: NOW,
        updatedBy: adminActor.uid,
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
      expect(dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
      expect(dependencies.updateRoot).not.toHaveBeenCalled();
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

  it.each(["not-a-timestamp", "2026-08-01T09:00:00Z", "2026-08-01"])(
    "rejects the non-canonical stored contract timestamp %s",
    async (updatedAt) => {
      const building = buildingWith("pending");
      building.managementContract.updatedAt = updatedAt;
      const { dependencies } = createInMemoryAdapter({ building });

      await expect(
        setManagementContractStatusCore(
          { ...inputFor("active"), startedOn: "2026-08-09" },
          adminActor,
          dependencies,
        ),
      ).rejects.toThrow("field_management_transition_invalid");
      expect(dependencies.reserveTransition).not.toHaveBeenCalled();
    },
  );

  it.each(["not-a-timestamp", "2026-08-09T12:34:56Z", "2026-08-09"])(
    "rejects the non-canonical dependency timestamp %s",
    async (now) => {
      const { dependencies } = createInMemoryAdapter({ now: () => now });

      await expect(
        setManagementContractStatusCore(
          { ...inputFor("active"), startedOn: "2026-08-09" },
          adminActor,
          dependencies,
        ),
      ).rejects.toThrow("field_management_transition_invalid");
      expect(dependencies.updateRoot).not.toHaveBeenCalled();
    },
  );

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
    const buildingReadsAfterFirst = vi.mocked(dependencies.getBuilding).mock
      .calls.length;
    const second = await setManagementContractStatusCore(
      { ...input },
      adminActor,
      dependencies,
    );

    expect(second).toEqual(first);
    expect(dependencies.getBuilding).toHaveBeenCalledTimes(
      buildingReadsAfterFirst,
    );
    expect(dependencies.reserveTransition).toHaveBeenCalledTimes(1);
    expect(dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
    expect(dependencies.now).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-record", "receipt"],
    ["missing fields", {}],
  ])("rejects a malformed completed receipt: %s", async (_label, malformed) => {
    const adapter = createInMemoryAdapter();
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };
    await setManagementContractStatusCore(input, adminActor, adapter.dependencies);
    adapter.receipts.set(
      `${adminActor.uid}\0${input.requestId}`,
      malformed as ContractRequestReceipt,
    );

    await expect(
      setManagementContractStatusCore(input, adminActor, adapter.dependencies),
    ).rejects.toThrow("field_management_transition_invalid");
  });

  it.each([
    ["wrong building", { buildingId: "building-2", status: "active" }],
    ["wrong status", { buildingId: BUILDING_ID, status: "paused" }],
  ])("rejects a completed receipt with the %s result", async (_label, result) => {
    const adapter = createInMemoryAdapter();
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };
    await setManagementContractStatusCore(input, adminActor, adapter.dependencies);
    const key = `${adminActor.uid}\0${input.requestId}`;
    const receipt = adapter.receipts.get(key);
    expect(receipt).toBeDefined();
    adapter.receipts.set(key, {
      ...receipt!,
      result: result as ContractRequestReceipt["result"],
    });

    await expect(
      setManagementContractStatusCore(input, adminActor, adapter.dependencies),
    ).rejects.toThrow("field_management_transition_invalid");
  });

  it("rejects a completed receipt with a non-canonical completedAt timestamp", async () => {
    const adapter = createInMemoryAdapter();
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };
    await setManagementContractStatusCore(input, adminActor, adapter.dependencies);
    const key = `${adminActor.uid}\0${input.requestId}`;
    const receipt = adapter.receipts.get(key);
    expect(receipt).toBeDefined();
    adapter.receipts.set(key, { ...receipt!, completedAt: "2026-08-09T12:34:56Z" });

    await expect(
      setManagementContractStatusCore(input, adminActor, adapter.dependencies),
    ).rejects.toThrow("field_management_transition_invalid");
  });

  it("rejects reuse of a completed request ID for a different semantic transition", async () => {
    const { dependencies } = createInMemoryAdapter();
    await setManagementContractStatusCore(
      { ...inputFor("active"), startedOn: "2026-08-09" },
      adminActor,
      dependencies,
    );
    const buildingReadsAfterFirst = vi.mocked(dependencies.getBuilding).mock
      .calls.length;

    await expect(
      setManagementContractStatusCore(
        { ...inputFor("active"), startedOn: "2026-08-10" },
        adminActor,
        dependencies,
      ),
    ).rejects.toThrow("field_request_id_conflict");
    expect(dependencies.getBuilding).toHaveBeenCalledTimes(
      buildingReadsAfterFirst,
    );
    expect(dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it("rejects an acquired reservation with a non-canonical claimedAt", async () => {
    const adapter = createInMemoryAdapter();
    adapter.dependencies.reserveTransition = vi.fn(async (proposed) => ({
      status: "acquired" as const,
      reservation: {
        ...proposed,
        claimedAt: "2026-08-09T12:34:56Z",
      },
    }));

    await expect(
      setManagementContractStatusCore(
        { ...inputFor("active"), startedOn: "2026-08-09" },
        adminActor,
        adapter.dependencies,
      ),
    ).rejects.toThrow("field_management_transition_invalid");
    expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it("recovers when a stale receipt miss races an identical committed transition", async () => {
    const adapter = createInMemoryAdapter();
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };
    let releaseStaleReceipt: (() => void) | undefined;
    let announceStaleReceipt: (() => void) | undefined;
    const staleReceiptRead = new Promise<void>((resolve) => {
      announceStaleReceipt = resolve;
    });
    const waitForCommit = new Promise<void>((resolve) => {
      releaseStaleReceipt = resolve;
    });
    let receiptReads = 0;
    adapter.dependencies.getReceipt = vi.fn(async (uid, requestId) => {
      receiptReads += 1;
      const snapshot =
        adapter.receipts.get(`${uid}\0${requestId}`) ?? null;
      if (receiptReads === 1) {
        announceStaleReceipt?.();
        await waitForCommit;
      }
      return snapshot;
    });

    const callB = setManagementContractStatusCore(
      input,
      adminActor,
      adapter.dependencies,
    );
    await staleReceiptRead;
    const callAResult = await setManagementContractStatusCore(
      { ...input },
      adminActor,
      adapter.dependencies,
    );
    releaseStaleReceipt?.();
    const callBResult = await callB;

    expect(callBResult).toEqual(callAResult);
    expect(adapter.dependencies.getReservation).toHaveBeenCalled();
    expect(adapter.dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(2);
    expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
    expect(
      adapter.getCurrentBuilding()?.managementContract,
    ).toMatchObject({ status: "active", updatedAt: NOW });
  });

  it("returns staleConflict without writing when the reserved prior version changed before commit", async () => {
    let adapter: ReturnType<typeof createInMemoryAdapter>;
    adapter = createInMemoryAdapter({
      beforeAtomicCommit: async () => {
        const changed = buildingWith("pending");
        changed.managementContract = {
          ...changed.managementContract,
          updatedAt: "2026-08-02T09:00:00.000Z",
          updatedBy: "admin-2",
        };
        adapter.setCurrentBuilding(changed);
      },
    });

    await expect(
      setManagementContractStatusCore(
        { ...inputFor("active"), startedOn: "2026-08-09" },
        adminActor,
        adapter.dependencies,
      ),
    ).rejects.toThrow("field_management_transition_conflict");

    expect(adapter.dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
    expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
    expect(adapter.patches).toHaveLength(0);
    expect(adapter.receipts).toHaveLength(0);
    expect(adapter.getCurrentBuilding()?.managementContract).toMatchObject({
      status: "pending",
      updatedAt: "2026-08-02T09:00:00.000Z",
    });
  });

  it("fences an old retry inside CAS after its receipt and a newer transition commit", async () => {
    let boundaryCalls = 0;
    let announceOldRetry: (() => void) | undefined;
    let releaseOldRetry: (() => void) | undefined;
    const oldRetryAtCas = new Promise<void>((resolve) => {
      announceOldRetry = resolve;
    });
    const waitForNewerCommit = new Promise<void>((resolve) => {
      releaseOldRetry = resolve;
    });
    const commitBoundary = async (): Promise<void> => {
      boundaryCalls += 1;
      if (boundaryCalls === 2) {
        announceOldRetry?.();
        await waitForNewerCommit;
      }
    };
    const adapter = createInMemoryAdapter({
      beforeAtomicCommit: commitBoundary,
      beforeUpdateRoot: commitBoundary,
      failUpdateRootOnce: true,
      persistReceipts: false,
    });
    const original = { ...inputFor("active"), startedOn: "2026-08-09" };

    await expect(
      setManagementContractStatusCore(
        original,
        adminActor,
        adapter.dependencies,
      ),
    ).rejects.toThrow("simulated_crash_before_root_write");

    const oldRetry = setManagementContractStatusCore(
      { ...original },
      adminActor,
      adapter.dependencies,
    );
    await oldRetryAtCas;

    await setManagementContractStatusCore(
      { ...original },
      adminActor,
      adapter.dependencies,
    );
    expect(adapter.getCurrentBuilding()?.managementContract).toMatchObject({
      status: "active",
    });
    await setManagementContractStatusCore(
      inputFor("paused", "request-newer-pause"),
      adminActor,
      adapter.dependencies,
    );
    expect(adapter.getCurrentBuilding()?.managementContract).toMatchObject({
      status: "paused",
    });
    const writesBeforeOldRetryResumes = adapter.patches.length;

    releaseOldRetry?.();
    await expect(oldRetry).resolves.toEqual({
      buildingId: BUILDING_ID,
      status: "active",
    });

    expect(adapter.patches).toHaveLength(writesBeforeOldRetryResumes);
    expect(adapter.getCurrentBuilding()?.managementContract).toMatchObject({
      status: "paused",
    });
    expect(adapter.dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(4);
    expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it("replays an identical patch from a self-sufficient reservation after a crash before root write", async () => {
    const adapter = createInMemoryAdapter({ failUpdateRootOnce: true });
    const input = { ...inputFor("active"), startedOn: "2026-08-09" };

    await expect(
      setManagementContractStatusCore(input, adminActor, adapter.dependencies),
    ).rejects.toThrow("simulated_crash_before_root_write");
    const stored = adapter.reservationsByRequest.get(
      `${adminActor.uid}\0${input.requestId}`,
    );
    expect(stored).toMatchObject({
      claimedAt: NOW,
      previousContract: {
        status: "pending",
        startedOn: "2026-07-01",
        updatedAt: PREVIOUS_UPDATE,
      },
      nextContract: {
        status: "active",
        startedOn: "2026-08-09",
        updatedAt: NOW,
        updatedBy: adminActor.uid,
      },
    });

    await expect(
      setManagementContractStatusCore(
        { ...input },
        adminActor,
        adapter.dependencies,
      ),
    ).resolves.toEqual({ buildingId: BUILDING_ID, status: "active" });
    expect(adapter.dependencies.getReservation).toHaveBeenCalled();
    expect(adapter.dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(2);
    expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
    expect(adapter.patches[1]).toEqual(adapter.patches[0]);
  });

  it.each([
    [
      "different hash",
      (reservation: ContractTransitionReservation) => {
        reservation.requestHash = "0".repeat(64);
      },
      "field_request_id_conflict",
    ],
    [
      "different building",
      (reservation: ContractTransitionReservation) => {
        reservation.buildingId = "building-2";
      },
      "field_management_transition_invalid",
    ],
    [
      "different target status",
      (reservation: ContractTransitionReservation) => {
        reservation.result.status = "paused";
      },
      "field_management_transition_invalid",
    ],
  ])(
    "rejects a stored reservation with a %s",
    async (_label, mutate, expectedError) => {
      const adapter = createInMemoryAdapter({ failUpdateRootOnce: true });
      const input = { ...inputFor("active"), startedOn: "2026-08-09" };
      await expect(
        setManagementContractStatusCore(input, adminActor, adapter.dependencies),
      ).rejects.toThrow("simulated_crash_before_root_write");
      const stored = adapter.reservationsByRequest.get(
        `${adminActor.uid}\0${input.requestId}`,
      );
      expect(stored).toBeDefined();
      mutate(stored!);

      await expect(
        setManagementContractStatusCore(
          { ...input },
          adminActor,
          adapter.dependencies,
        ),
      ).rejects.toThrow(expectedError);
      expect(adapter.dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
      expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
    },
  );

  it("does not let an old reservation roll back a genuinely newer contract", async () => {
    const adapter = createInMemoryAdapter({ persistReceipts: false });
    const original = { ...inputFor("active"), startedOn: "2026-08-09" };
    await setManagementContractStatusCore(
      original,
      adminActor,
      adapter.dependencies,
    );
    await setManagementContractStatusCore(
      inputFor("paused", "request-pause-after-active"),
      adminActor,
      adapter.dependencies,
    );
    expect(adapter.dependencies.reserveTransition).toHaveBeenCalledTimes(2);
    expect(adapter.getCurrentBuilding()?.managementContract).toMatchObject({
      status: "paused",
    });

    const result = await setManagementContractStatusCore(
      { ...original },
      adminActor,
      adapter.dependencies,
    );

    expect(result).toEqual({ buildingId: BUILDING_ID, status: "active" });
    expect(adapter.dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(3);
    expect(adapter.dependencies.updateRoot).not.toHaveBeenCalled();
    expect(adapter.getCurrentBuilding()?.managementContract).toMatchObject({
      status: "paused",
    });
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
    expect(dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
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
    expect(dependencies.commitTransitionAtomically).toHaveBeenCalledTimes(2);
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
    expect(patches).toHaveLength(1);
  });
});

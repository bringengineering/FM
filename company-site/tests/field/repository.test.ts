import { describe, expect, it, vi } from "vitest";

import { createAuditEvent } from "../../app/field/lib/audit";
import {
  findBuildingByNormalizedAddress,
  listAssignedBuildings,
  requestDriveSync,
  saveBuildingWithAudit,
  saveListingWithAudit,
  saveSecureAccessWithAudit,
  saveUnitWithAudit,
  subscribeDashboard,
  type FieldRepositoryAdapter,
} from "../../app/field/lib/repository";
import type { Building, Listing, SecureAccess, Unit } from "../../app/field/lib/types";

const NOW = "2026-08-09T00:00:00.000Z";

function testBuilding(id = "building-1"): Building {
  return {
    id,
    managementNumber: "BR-0001",
    name: "테스트 빌딩",
    roadAddress: "강원특별자치도 원주시 서원대로 1",
    jibunAddress: "강원특별자치도 원주시 단계동 1-1",
    latitude: 37.3422,
    longitude: 127.9202,
    parking: { available: true, totalSpaces: 8 },
    assignedStaffIds: ["staff-1"],
    createdAt: NOW,
    createdBy: "staff-1",
    updatedAt: NOW,
    updatedBy: "staff-1",
  };
}

function testUnit(): Unit {
  return {
    id: "unit-1",
    buildingId: "building-1",
    unitLabel: "201호",
    options: [],
    isVacant: true,
    createdAt: NOW,
    createdBy: "staff-1",
    updatedAt: NOW,
    updatedBy: "staff-1",
  };
}

function testListing(): Listing {
  return {
    id: "listing-1",
    buildingId: "building-1",
    unitId: "unit-1",
    unitLabel: "201호",
    status: "draft",
    depositWon: 3_000_000,
    monthlyRentWon: 350_000,
    maintenanceFeeWon: 0,
    maintenanceFeeItems: [],
    parkingDescription: "1대 가능",
    petPolicy: "확인 필요",
    options: [],
    advertisingApproved: false,
    createdAt: NOW,
    createdBy: "staff-1",
    updatedAt: NOW,
    updatedBy: "staff-1",
  };
}

function adapter(overrides: Partial<FieldRepositoryAdapter> = {}): FieldRepositoryAdapter {
  return {
    read: vi.fn(async () => null),
    commitAuthorizedPatch: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    requestDriveSyncJob: vi.fn(async () => ({ jobId: "job-1" })),
    ...overrides,
  };
}

const auditContext = {
  eventId: "event-1",
  actorId: "staff-1",
  occurredAt: NOW,
};

describe("field repository", () => {
  it("commits a building and its audit event in one authorized patch", async () => {
    const repository = adapter();
    const building = testBuilding();

    await saveBuildingWithAudit(repository, building, auditContext);

    expect(repository.commitAuthorizedPatch).toHaveBeenCalledOnce();
    expect(repository.commitAuthorizedPatch).toHaveBeenCalledWith({
      "fieldPlatform/buildings/building-1": expect.objectContaining({ id: "building-1" }),
      "fieldPlatform/auditLogs/event-1": expect.objectContaining({
        id: "event-1",
        action: "building.saved",
        entityId: "building-1",
      }),
    });
  });

  it("normalizes Korean addresses before detecting an existing building", async () => {
    const existing = testBuilding();
    const repository = adapter({
      read: vi.fn(async () => ({ "building-1": existing })),
    });

    await expect(
      findBuildingByNormalizedAddress(repository, " 강원특별자치도  원주시, 서원대로 1 "),
    ).resolves.toEqual(existing);
  });

  it("creates unit and secure-access patches with audit records", async () => {
    const repository = adapter();
    const access: SecureAccess = {
      id: "access-1",
      buildingId: "building-1",
      commonDoorAccess: "TEST-DOOR-SECRET",
      ownerContact: "TEST-OWNER-PHONE",
      allowedUserIds: ["staff-1"],
      updatedAt: NOW,
      updatedBy: "staff-1",
    };

    await saveUnitWithAudit(repository, testUnit(), auditContext);
    await saveSecureAccessWithAudit(repository, access, {
      ...auditContext,
      eventId: "event-2",
    });

    expect(repository.commitAuthorizedPatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      "fieldPlatform/units/unit-1": expect.objectContaining({ id: "unit-1" }),
      "fieldPlatform/auditLogs/event-1": expect.objectContaining({ action: "unit.saved" }),
    }));
    expect(repository.commitAuthorizedPatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      "fieldPlatform/secureAccess/access-1": expect.objectContaining({ id: "access-1" }),
      "fieldPlatform/auditLogs/event-2": expect.objectContaining({ action: "secureAccess.saved" }),
    }));
  });

  it("never includes secure fields in listing writes", async () => {
    const repository = adapter();
    const unsafeListing = {
      ...testListing(),
      commonDoorAccess: "TEST-DOOR-SECRET",
      ownerContact: "TEST-OWNER-PHONE",
      internalMemo: "TEST-INTERNAL-MEMO",
    };

    await saveListingWithAudit(repository, unsafeListing, auditContext);

    const patch = vi.mocked(repository.commitAuthorizedPatch).mock.calls[0][0];
    const serialized = JSON.stringify(patch["fieldPlatform/listings/listing-1"]);
    expect(serialized).not.toMatch(
      /commonDoorAccess|ownerContact|internalMemo|TEST-DOOR-SECRET|TEST-OWNER-PHONE|TEST-INTERNAL-MEMO/,
    );
    expect(patch["fieldPlatform/listings/listing-1"]).toEqual(
      expect.objectContaining({ maintenanceFeeWon: 0 }),
    );
  });

  it("lists only buildings assigned to the requested user", async () => {
    const repository = adapter({
      read: vi.fn(async (path) => {
        if (path === "fieldPlatform/buildingAssignments") {
          return {
            "building-1": { "staff-1": true },
            "building-2": { "staff-2": true },
          };
        }
        return {
          "building-1": testBuilding("building-1"),
          "building-2": testBuilding("building-2"),
        };
      }),
    });

    await expect(listAssignedBuildings(repository, "staff-1")).resolves.toEqual([
      expect.objectContaining({ id: "building-1" }),
    ]);
  });

  it("subscribes to safe dashboard collections and releases every listener", () => {
    const unsubscribers = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    let index = 0;
    const repository = adapter({
      subscribe: vi.fn(() => unsubscribers[index++]),
    });
    const listener = vi.fn();

    const unsubscribe = subscribeDashboard(repository, listener);
    expect(repository.subscribe).toHaveBeenCalledTimes(4);

    unsubscribe();
    for (const stop of unsubscribers) expect(stop).toHaveBeenCalledOnce();
  });

  it("requests Drive sync through the server adapter instead of writing a job", async () => {
    const repository = adapter();
    await expect(requestDriveSync(repository, {
      mediaId: "media-1",
      captureSessionId: "session-1",
    })).resolves.toEqual({ jobId: "job-1" });
    expect(repository.requestDriveSyncJob).toHaveBeenCalledWith({
      mediaId: "media-1",
      captureSessionId: "session-1",
    });
    expect(repository.commitAuthorizedPatch).not.toHaveBeenCalled();
  });
});

describe("createAuditEvent", () => {
  it("builds a deterministic immutable audit record", () => {
    expect(createAuditEvent({
      ...auditContext,
      action: "building.saved",
      entityType: "building",
      entityId: "building-1",
    })).toEqual({
      id: "event-1",
      actorId: "staff-1",
      action: "building.saved",
      entityType: "building",
      entityId: "building-1",
      occurredAt: NOW,
    });
  });
});

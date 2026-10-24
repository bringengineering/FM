import { describe, expect, it, vi } from "vitest";

import {
  createDirectFieldApi,
  type DirectFieldApiDependencies,
} from "../../app/field/lib/direct-field-api.client";
import type { SaveFieldRegistrationInput } from "../../app/field/lib/registration-draft";

function registration(): SaveFieldRegistrationInput {
  return {
    requestId: "33333333-3333-4333-8333-333333333333",
    draftId: "44444444-4444-4444-8444-444444444444",
    building: {
      managementNumber: "BR-001",
      name: "브링 단계점",
      roadAddress: "강원 원주시 단계동 1",
      latitude: 37.34,
      longitude: 127.92,
      elevator: true,
      parking: { available: true, totalSpaces: 3 },
    },
    units: [{
      localId: "unit-local-1",
      unitLabel: "301호",
      options: ["에어컨"],
      isVacant: true,
    }],
    listing: {
      depositWon: 5_000_000,
      monthlyRentWon: 500_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: ["수도"],
      parkingDescription: "1대 가능",
      petPolicy: "협의",
      options: ["에어컨"],
    },
    primaryUnitLocalId: "unit-local-1",
    managementContract: { requested: true, startedOn: "2026-08-12" },
  };
}

function dependencies(overrides: Partial<DirectFieldApiDependencies> = {}): DirectFieldApiDependencies {
  return {
    uid: () => "staff-1",
    role: () => "admin",
    displayName: () => "브링 관리자",
    now: () => "2026-08-12T05:00:00.000Z",
    read: vi.fn(async () => null),
    readCaptureSessions: vi.fn(async () => null),
    allocateManagementNumber: vi.fn(async () => "BR-WJ-MUSIL-26-0001"),
    update: vi.fn(async () => undefined),
    ...overrides,
  };
}

function undefinedPaths(value: unknown, path = "root"): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => (
    child === undefined
      ? [`${path}.${key}`]
      : undefinedPaths(child, `${path}.${key}`)
  ));
}

describe("direct Firebase field API", () => {
  it("saves the building before its active map projection", async () => {
    const deps = dependencies();
    const api = createDirectFieldApi(deps);

    const first = await api.saveRegistration(registration());
    expect(first.buildingId).toMatch(/^building_[a-f0-9]{24}$/);
    expect(first.managementNumber).toBe("BR-WJ-MUSIL-26-0001");
    expect(deps.update).toHaveBeenCalledTimes(2);
    const corePatch = vi.mocked(deps.update).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(corePatch[`fieldPlatform/buildings/${first.buildingId}`]).toMatchObject({
      name: "브링 단계점",
      managementContract: { status: "active" },
      managementNumber: "BR-WJ-MUSIL-26-0001",
    });
    expect(corePatch[`fieldPlatform/listings/${first.listingId}`]).toMatchObject({
      status: "draft",
      advertisingApproved: false,
    });
    expect(corePatch).not.toHaveProperty(`fieldPlatform/mapProjections/${first.buildingId}`);
    const projectionPatch = vi.mocked(deps.update).mock.calls[1]?.[0] as Record<string, unknown>;
    expect(projectionPatch[`fieldPlatform/mapProjections/${first.buildingId}`]).toMatchObject({
      markerStatus: "vacant",
      vacancyCount: 1,
    });
  });

  it("does not project a staff registration before the management contract is approved", async () => {
    const deps = dependencies({ role: () => "staff" });
    const api = createDirectFieldApi(deps);

    const result = await api.saveRegistration(registration());
    const patch = vi.mocked(deps.update).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch[`fieldPlatform/buildings/${result.buildingId}`]).toMatchObject({
      managementContract: { status: "pending" },
    });
    expect(patch).not.toHaveProperty(`fieldPlatform/mapProjections/${result.buildingId}`);
  });

  it("never sends undefined optional fields to Firebase", async () => {
    const deps = dependencies();
    const input = registration();
    input.building.jibunAddress = undefined;
    input.building.purpose = undefined;
    input.building.completionYear = undefined;
    input.units[0].structure = undefined;
    input.units[0].floor = undefined;
    input.listing.availableFrom = undefined;
    input.listing.contractTermMonths = undefined;
    input.managementContract.startedOn = undefined;

    await createDirectFieldApi(deps).saveRegistration(input);

    expect(undefinedPaths(vi.mocked(deps.update).mock.calls[0]?.[0])).toEqual([]);
  });

  it("starts an owned capture session and updates the listing to capturing", async () => {
    const deps = dependencies({
      read: vi.fn(async (path) => {
        if (path.endsWith("/building-1")) return { id: "building-1" };
        if (path.endsWith("/unit-1")) return { id: "unit-1", buildingId: "building-1" };
        if (path.endsWith("/listing-1")) return { id: "listing-1", buildingId: "building-1", unitId: "unit-1", status: "draft" };
        return null;
      }),
    });
    const api = createDirectFieldApi(deps);

    await expect(api.startCaptureSession({
      requestId: "request-1",
      captureSessionId: "session-1",
      visitId: "visit-1",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitType: "vacancyRefresh",
    })).resolves.toEqual({ captureSessionId: "session-1", visitId: "visit-1" });
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({
      "fieldPlatform/captureSessions/session-1/status": "open",
      "fieldPlatform/listings/listing-1/status": "capturing",
    }));
  });

  it("lets only an admin approve a pending management contract directly", async () => {
    const deps = dependencies({
      read: vi.fn(async (path) => path.endsWith("/building-1")
        ? {
            id: "building-1",
            name: "관리 승인 건물",
            roadAddress: "강원 원주시 단계동 1",
            latitude: 37.34,
            longitude: 127.92,
            parking: { available: true, totalSpaces: 3 },
            managementContract: { status: "pending" },
          }
        : path === "fieldPlatform/units"
          ? { one: { id: "one", buildingId: "building-1", isVacant: true } }
          : null),
    });
    const api = createDirectFieldApi(deps);

    await expect(api.setManagementContractStatus({
      requestId: "contract-request-1",
      buildingId: "building-1",
      status: "active",
      startedOn: "2026-08-12",
    })).resolves.toEqual({ buildingId: "building-1", status: "active" });
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({
      "fieldPlatform/buildings/building-1/managementContract/status": "active",
      "fieldPlatform/buildings/building-1/managementContract/startedOn": "2026-08-12",
      "fieldPlatform/mapProjections/building-1": expect.objectContaining({
        markerStatus: "vacant",
      }),
    }));

    const staffApi = createDirectFieldApi(dependencies({ role: () => "staff" }));
    await expect(staffApi.setManagementContractStatus({
      requestId: "contract-request-2",
      buildingId: "building-1",
      status: "active",
      startedOn: "2026-08-12",
    })).rejects.toThrow("field_management_contract_admin_required");
  });

  it("lists only active management contracts plus open advertising listings", async () => {
    const deps = dependencies({
      read: vi.fn(async (path) => ({
        "fieldPlatform/buildings": {
          managed: { id: "managed", name: "관리건물", managementContract: { status: "active" } },
          lead: { id: "lead", name: "영업대상", managementContract: { status: "pending" } },
        },
        "fieldPlatform/units": {
          unit1: { id: "unit1", buildingId: "managed", unitLabel: "201호" },
          unit2: { id: "unit2", buildingId: "lead", unitLabel: "301호" },
        },
        "fieldPlatform/listings": {
          listing1: { id: "listing1", buildingId: "managed", unitId: "unit1", unitLabel: "201호", status: "ready" },
          listing2: { id: "listing2", buildingId: "lead", unitId: "unit2", unitLabel: "301호", status: "closed" },
        },
      } as Record<string, unknown>)[path] ?? null),
      readCaptureSessions: vi.fn(async () => ({
        session1: { id: "session1", requestId: "r", buildingId: "managed", visitId: "v", createdBy: "staff-1", status: "open", createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" },
      })),
    });
    const api = createDirectFieldApi(deps);

    const workspace = await api.loadCaptureWorkspace();
    expect(workspace.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "management:managed", source: "management" }),
      expect.objectContaining({ id: "advertising:listing1", source: "advertising" }),
    ]));
    expect(workspace.targets.some((target) => target.buildingId === "lead")).toBe(false);
    expect(workspace.openSessions).toHaveLength(1);
    expect(deps.readCaptureSessions).toHaveBeenCalledWith("staff-1", "admin");
  });

  it("loads staff capture sessions through the owned-session reader", async () => {
    const deps = dependencies({
      role: () => "staff",
      readCaptureSessions: vi.fn(async () => null),
    });

    await createDirectFieldApi(deps).loadCaptureWorkspace();

    expect(deps.readCaptureSessions).toHaveBeenCalledWith("staff-1", "staff");
    expect(deps.read).not.toHaveBeenCalledWith("fieldPlatform/captureSessions");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  rebuildMapProjectionForBuilding,
  type RebuildMapProjectionDependencies,
} from "../src/field/rebuild-map-projection.js";
import type { ProjectionBuilding } from "../src/field/map-projection.js";

const BUILDING_ID = "building-1";
const NOW = "2026-08-09T12:00:00.000Z";

const activeBuilding: ProjectionBuilding = {
  id: BUILDING_ID,
  name: "Sangji House",
  roadAddress: "1 Sangji-ro, Wonju",
  latitude: 37.369,
  longitude: 127.928,
  parking: { available: true, totalSpaces: 8 },
  managementContract: {
    status: "active",
    startedOn: "2026-08-09",
    updatedAt: NOW,
    updatedBy: "admin-1",
  },
};

function createDependencies(
  building: ProjectionBuilding | null = activeBuilding,
): RebuildMapProjectionDependencies {
  return {
    getBuilding: vi.fn(async () => building),
    getListings: vi.fn(async () => [
      {
        id: "listing-local",
        buildingId: BUILDING_ID,
        status: "advertising",
        advertisingApproved: true,
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
        privateEventValue: "DO-NOT-COPY-LISTING",
      },
      {
        id: "listing-foreign",
        buildingId: "building-foreign",
        status: "advertising",
        advertisingApproved: true,
        depositWon: 999_000_000,
        monthlyRentWon: 999_000_000,
        maintenanceFeeWon: 999_000_000,
      },
    ]),
    getMedia: vi.fn(async () => [
      { buildingId: BUILDING_ID, uploadState: "queued" },
      {
        buildingId: "building-foreign",
        uploadState: "finalized",
        storagePath: "DO-NOT-COPY-MEDIA",
      },
    ]),
    setProjection: vi.fn(async () => undefined),
    now: vi.fn(() => NOW),
  };
}

describe("rebuildMapProjectionForBuilding", () => {
  it("preserves the exact two-argument Task 5 function contract", () => {
    expect(rebuildMapProjectionForBuilding).toHaveLength(2);
  });

  it("reads only the requested building scope and writes the eleven safe keys", async () => {
    const dependencies = createDependencies({
      ...activeBuilding,
      ownerPhone: "DO-NOT-COPY-BUILDING",
    });

    await rebuildMapProjectionForBuilding(BUILDING_ID, dependencies);

    expect(dependencies.getBuilding).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.getListings).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.getMedia).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
    expect(dependencies.setProjection).toHaveBeenCalledTimes(1);
    expect(dependencies.setProjection).toHaveBeenCalledWith(
      BUILDING_ID,
      expect.any(Object),
    );
    expect(vi.mocked(dependencies.setProjection).mock.calls[0]).toHaveLength(2);

    const projection = vi.mocked(dependencies.setProjection).mock.calls[0][1];
    expect(projection).toMatchObject({
      buildingId: BUILDING_ID,
      vacancyCount: 1,
      captureStatus: "notStarted",
      updatedAt: NOW,
    });
    expect(Object.keys(projection ?? {})).toEqual([
      "buildingId",
      "name",
      "roadAddress",
      "latitude",
      "longitude",
      "markerStatus",
      "vacancyCount",
      "approvedRentSummary",
      "parkingSummary",
      "captureStatus",
      "updatedAt",
    ]);
    expect(JSON.stringify(projection)).not.toMatch(
      /DO-NOT-COPY-BUILDING|DO-NOT-COPY-LISTING|DO-NOT-COPY-MEDIA|999000000/,
    );
  });

  it.each([
    ["missing", null],
    ["archived", { ...activeBuilding, archivedAt: NOW }],
    [
      "inactive",
      {
        ...activeBuilding,
        managementContract: {
          ...activeBuilding.managementContract!,
          status: "paused" as const,
        },
      },
    ],
    ["invalid", { ...activeBuilding, latitude: Number.NaN }],
    ["mismatched", { ...activeBuilding, id: "building-foreign" }],
  ])("writes null for a %s building", async (_label, building) => {
    const dependencies = createDependencies(building);

    await rebuildMapProjectionForBuilding(BUILDING_ID, dependencies);

    expect(dependencies.getBuilding).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.getListings).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.getMedia).toHaveBeenCalledWith(BUILDING_ID);
    expect(dependencies.setProjection).toHaveBeenCalledWith(
      BUILDING_ID,
      null,
    );
    expect(vi.mocked(dependencies.setProjection).mock.calls[0]).toHaveLength(2);
  });

  it("uses the dependency clock as the deterministic projection timestamp", async () => {
    const dependencies = createDependencies();
    const eventTime = "2026-08-09T12:00:05.000Z";
    dependencies.now = vi.fn(() => eventTime);

    await rebuildMapProjectionForBuilding(BUILDING_ID, dependencies);

    expect(dependencies.now).toHaveBeenCalledTimes(1);
    expect(dependencies.setProjection).toHaveBeenCalledWith(
      BUILDING_ID,
      expect.objectContaining({ updatedAt: eventTime }),
    );
    expect(vi.mocked(dependencies.setProjection).mock.calls[0]).toHaveLength(2);
  });

  it.each(["bad/id", " building-1", "x".repeat(129)])(
    "rejects an unsafe or unbounded building id %s before any dependency call",
    async (buildingId) => {
      const dependencies = createDependencies();

      await expect(
        rebuildMapProjectionForBuilding(buildingId, dependencies),
      ).rejects.toThrow("field_projection_building_id_invalid");

      expect(dependencies.getBuilding).not.toHaveBeenCalled();
      expect(dependencies.getListings).not.toHaveBeenCalled();
      expect(dependencies.getMedia).not.toHaveBeenCalled();
      expect(dependencies.setProjection).not.toHaveBeenCalled();
    },
  );
});

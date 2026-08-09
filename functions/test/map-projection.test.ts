import { describe, expect, it } from "vitest";

import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionListing,
  type ProjectionMedia,
} from "../src/field/map-projection.js";

const UPDATED_AT = "2026-08-09T12:00:00.000Z";

const activeBuilding: ProjectionBuilding = {
  id: "building-1",
  name: "상지 원룸",
  roadAddress: "강원특별자치도 원주시 상지대길 1",
  latitude: 37.369,
  longitude: 127.928,
  parking: { available: true, totalSpaces: 8 },
  managementContract: {
    status: "active",
    startedOn: "2026-08-09",
    updatedAt: UPDATED_AT,
    updatedBy: "admin-1",
  },
};

const approvedOpenListing: ProjectionListing = {
  status: "advertising",
  advertisingApproved: true,
  depositWon: 3_000_000,
  monthlyRentWon: 350_000,
  maintenanceFeeWon: 0,
};

const source = {
  listings: [approvedOpenListing],
  media: [{ uploadState: "finalized" }] satisfies ProjectionMedia[],
  updatedAt: UPDATED_AT,
};

describe("buildMapProjection", () => {
  it("projects an active managed building with the stable public summaries", () => {
    expect(buildMapProjection({ ...source, building: activeBuilding })).toEqual(
      expect.objectContaining({
        buildingId: "building-1",
        markerStatus: "vacant",
        vacancyCount: 1,
        approvedRentSummary: "보증금 300만 · 월세 35만 · 관리비 0원",
        parkingSummary: "주차 가능 · 총 8대",
        captureStatus: "inProgress",
      }),
    );
  });

  it.each(["none", "pending", "paused", "ended"] as const)(
    "omits a building whose management status is %s",
    (status) => {
      expect(
        buildMapProjection({
          ...source,
          building: {
            ...activeBuilding,
            managementContract: {
              ...activeBuilding.managementContract,
              status,
            },
          },
        }),
      ).toBeNull();
    },
  );

  it("omits an archived building even when its management contract is active", () => {
    expect(
      buildMapProjection({
        ...source,
        building: { ...activeBuilding, archivedAt: UPDATED_AT },
      }),
    ).toBeNull();
  });

  it("omits a missing building", () => {
    expect(buildMapProjection({ ...source, building: null })).toBeNull();
  });

  it.each([
    ["missing latitude", { latitude: undefined }],
    ["missing longitude", { longitude: undefined }],
    ["non-number latitude", { latitude: "37.369" }],
    ["non-number longitude", { longitude: "127.928" }],
    ["NaN latitude", { latitude: Number.NaN }],
    ["infinite longitude", { longitude: Number.POSITIVE_INFINITY }],
    ["latitude below range", { latitude: -90.000_001 }],
    ["latitude above range", { latitude: 90.000_001 }],
    ["longitude below range", { longitude: -180.000_001 }],
    ["longitude above range", { longitude: 180.000_001 }],
  ])("omits a building with %s", (_label, coordinates) => {
    expect(
      buildMapProjection({
        ...source,
        building: { ...activeBuilding, ...coordinates },
      }),
    ).toBeNull();
  });

  it("accepts coordinates on the geographic boundaries", () => {
    expect(
      buildMapProjection({
        ...source,
        building: { ...activeBuilding, latitude: -90, longitude: 180 },
      }),
    ).toEqual(expect.objectContaining({ latitude: -90, longitude: 180 }));
  });

  it("counts every non-closed listing and selects only an approved open listing", () => {
    const projection = buildMapProjection({
      ...source,
      building: activeBuilding,
      listings: [
        {
          status: "ready",
          advertisingApproved: false,
          depositWon: 999_000_000,
          monthlyRentWon: 999_000_000,
          maintenanceFeeWon: 999_000_000,
        },
        {
          status: "closed",
          advertisingApproved: true,
          depositWon: 888_000_000,
          monthlyRentWon: 888_000_000,
          maintenanceFeeWon: 888_000_000,
        },
        {
          status: "advertising",
          advertisingApproved: true,
          depositWon: 200_000_000,
          monthlyRentWon: 550_000,
          maintenanceFeeWon: 12_345,
        },
      ],
    });

    expect(projection).toEqual(
      expect.objectContaining({
        markerStatus: "vacant",
        vacancyCount: 2,
        approvedRentSummary: "보증금 2억 · 월세 55만 · 관리비 12,345원",
      }),
    );
  });

  it("uses confirmation labels when no approved open listing exists", () => {
    const projection = buildMapProjection({
      ...source,
      building: activeBuilding,
      listings: [
        {
          ...approvedOpenListing,
          advertisingApproved: false,
        },
        {
          ...approvedOpenListing,
          status: "closed",
        },
      ],
    });

    expect(projection).toEqual(
      expect.objectContaining({
        markerStatus: "vacant",
        vacancyCount: 1,
        approvedRentSummary:
          "보증금 확인 필요 · 월세 확인 필요 · 관리비 확인 필요",
      }),
    );
  });

  it("marks a building without open listings as managed", () => {
    const projection = buildMapProjection({
      ...source,
      building: activeBuilding,
      listings: [{ ...approvedOpenListing, status: "closed" }],
    });

    expect(projection).toEqual(
      expect.objectContaining({ markerStatus: "managed", vacancyCount: 0 }),
    );
  });

  it.each([
    [0, "0원"],
    [3_000_000, "300만"],
    [100_000_000, "1억"],
    [300_000_000, "3억"],
    [12_345, "12,345원"],
    [undefined, "확인 필요"],
    [Number.NaN, "확인 필요"],
    [Number.POSITIVE_INFINITY, "확인 필요"],
    [1.5, "확인 필요"],
    [-1, "확인 필요"],
  ])("formats the won amount %s as %s", (amount, expected) => {
    const projection = buildMapProjection({
      ...source,
      building: activeBuilding,
      listings: [
        {
          status: "ready",
          advertisingApproved: true,
          depositWon: amount,
          monthlyRentWon: amount,
          maintenanceFeeWon: amount,
        },
      ],
    });

    expect(projection?.approvedRentSummary).toBe(
      `보증금 ${expected} · 월세 ${expected} · 관리비 ${expected}`,
    );
  });

  it.each([
    [{ available: false, totalSpaces: 999, notes: "TEST-PARKING-NOTES" }, "주차 불가"],
    [{ available: true }, "주차 가능 · 총 대수 확인 필요"],
    [{ available: true, totalSpaces: -1 }, "주차 가능 · 총 대수 확인 필요"],
    [undefined, "주차 정보 확인 필요"],
  ])("uses a stable parking summary", (parking, expected) => {
    const projection = buildMapProjection({
      ...source,
      building: { ...activeBuilding, parking },
    });

    expect(projection?.parkingSummary).toBe(expected);
    expect(JSON.stringify(projection)).not.toContain("TEST-PARKING-NOTES");
  });

  it.each(["queued", "uploading", "objectStored", "failed", "complete"])(
    "ignores non-finalized media state %s for capture presence",
    (uploadState) => {
      const projection = buildMapProjection({
        ...source,
        building: activeBuilding,
        media: [{ uploadState }],
      });

      expect(projection?.captureStatus).toBe("notStarted");
    },
  );

  it.each(["finalized", "firebaseComplete"])(
    "treats finalized-compatible media state %s as capture in progress",
    (uploadState) => {
      const projection = buildMapProjection({
        ...source,
        building: activeBuilding,
        media: [{ uploadState }],
      });

      expect(projection?.captureStatus).toBe("inProgress");
      expect(projection?.captureStatus).not.toBe("complete");
    },
  );

  it("returns only the eleven allowlisted map keys and excludes private source data", () => {
    const projection = buildMapProjection({
      ...source,
      building: {
        ...activeBuilding,
        ownerPhone: "TEST-OWNER-PHONE",
        internalMemo: "TEST-INTERNAL-MEMO",
      },
      listings: [
        {
          ...approvedOpenListing,
          secureNote: "TEST-SECURE-LISTING",
        },
      ],
      media: [
        {
          uploadState: "finalized",
          storagePath: "TEST-SECURE-MEDIA-PATH",
        },
      ],
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
      /TEST-OWNER-PHONE|TEST-INTERNAL-MEMO|TEST-SECURE-LISTING|TEST-SECURE-MEDIA-PATH/,
    );
  });
});

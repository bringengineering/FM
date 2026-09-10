import { describe, expect, it, vi } from "vitest";

import {
  buildDirectAdArtifacts,
  createDirectAdPackageApi,
  type DirectAdPackageDependencies,
} from "../../app/field/lib/direct-ad-package.client";
import type { AdPackageReviewCandidate } from "../../app/field/lib/ad-package";
import type { GoogleDriveClient } from "../../app/field/lib/google-drive.client";

function candidate(): AdPackageReviewCandidate {
  const media = [
    ["m1", "exterior", "photo"],
    ["m2", "accessRoad", "photo"],
    ["m3", "commonEntrance", "photo"],
    ["m4", "roomOverview", "photo"],
    ["m5", "roomOverview", "photo"],
    ["m6", "windowDaylight", "photo"],
    ["m7", "kitchen", "photo"],
    ["m8", "bathroom", "photo"],
    ["m9", "boilerEquipment", "photo"],
    ["m10", "verticalVideo", "video"],
  ] as const;
  return {
    building: {
      id: "building-1",
      managementNumber: "BR-001",
      name: "브링 단계점",
      roadAddress: "강원 원주시 단계동 1",
      parking: { available: true },
    },
    unit: { id: "unit-1", buildingId: "building-1", unitLabel: "301호", options: [] },
    listing: {
      id: "listing-1",
      buildingId: "building-1",
      unitId: "unit-1",
      unitLabel: "301호",
      status: "ready",
      depositWon: 5_000_000,
      monthlyRentWon: 500_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: ["수도"],
      availableFrom: "즉시",
      locationDescription: "터미널 도보 5분",
      parkingDescription: "1대 가능",
      petPolicy: "협의",
      options: ["에어컨"],
      advertisingApproved: true,
    },
    media: media.map(([id, zone, kind]) => ({
      id,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      captureSessionId: "session-1",
      kind,
      zone,
      slotId: `${zone}-1`,
      required: true,
      mimeType: kind === "video" ? "video/mp4" : "image/jpeg",
      sizeBytes: 3,
      capturedAt: "2026-08-12T05:00:00.000Z",
      storagePath: `drive:drive-${id}`,
      uploadState: "finalized",
      objectGeneration: `drive-${id}`,
      ...(id === "m1" ? { driveFileId: "drive-current-m1" } : {}),
      advertisingApproved: true,
      captureQualityState: "valid",
    })),
    captureSessions: [{
      id: "session-1",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      status: "complete",
    }],
    packages: [],
  };
}

describe("direct advertising package", () => {
  it("builds five deterministic Korean text artifacts", () => {
    const item = candidate();
    const ids = item.media.map((media) => media.id);
    const artifacts = buildDirectAdArtifacts(item, ids, ["m1", "m4"]);
    expect(artifacts.map((artifact) => artifact.name)).toEqual([
      "01_당근_광고문구.txt",
      "02_네이버_등록정보.txt",
      "03_매물_요약.txt",
      "04_사진_순서.txt",
      "05_검토_정보.txt",
    ]);
    expect(artifacts[0]?.content).toContain("브링 단계점 301호");
    expect(artifacts[1]?.content).toContain("소재지\t강원 원주시 단계동 1");
  });

  it("copies approved media, writes text files, and atomically records completion", async () => {
    const item = candidate();
    const approvedMediaIds = item.media.map((media) => media.id);
    const drive = {
      ensureFolderPath: vi.fn(async () => "package-folder"),
      findExactChild: vi.fn(async () => null),
      copyFile: vi.fn(async (input) => ({ id: `copy-${input.fileId}`, name: input.name, mimeType: "image/jpeg" })),
      uploadSmallFile: vi.fn(async (input) => ({ id: `text-${input.name}`, name: input.name, mimeType: "text/plain" })),
    } as unknown as GoogleDriveClient;
    const dependencies: DirectAdPackageDependencies = {
      drive,
      rootFolderId: "root-1",
      uid: () => "admin-1",
      now: () => "2026-08-12T05:10:00.000Z",
      read: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
      loadCandidates: vi.fn(async () => [item]),
    };
    const api = createDirectAdPackageApi(dependencies);

    await expect(api.create({
      requestId: "request-1",
      listingId: "listing-1",
      approvedMediaIds,
      representativeMediaIds: ["m1", "m4"],
    })).resolves.toMatchObject({ listingId: "listing-1", version: 1, status: "reviewed" });
    expect(drive.copyFile).toHaveBeenCalledTimes(10);
    expect(drive.copyFile).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "drive-current-m1",
    }));
    expect(drive.uploadSmallFile).toHaveBeenCalledTimes(5);
    expect(dependencies.update).toHaveBeenCalledWith(expect.objectContaining({
      "fieldPlatform/listings/listing-1/status": "advertising",
      "fieldPlatform/media/m4/advertisingOrder": 1,
      "fieldPlatform/media/m2/advertisingOrder": 2,
      "fieldPlatform/adPackages/adpkg_request-1": expect.objectContaining({
        status: "complete",
        driveFolderId: "package-folder",
      }),
    }));
  });
});

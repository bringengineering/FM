import { describe, expect, it } from "vitest";

import {
  buildDriveFolderPlan,
  buildDriveMediaFileName,
  sanitizeDriveName,
} from "../../app/field/lib/drive-folders";

describe("direct Drive folder planning", () => {
  it("builds stable Korean area/building/unit/date/zone folders", () => {
    expect(buildDriveFolderPlan({
      managementNumber: "BR-WJ-DANGYE-26-0001",
      buildingName: "브링 / 원주점",
      roadAddress: "강원 원주시 단계동 123-4",
      unitLabel: "301호",
      capturedAt: "2026-08-12T12:34:56.000Z",
      captureSessionId: "11111111-1111-4111-8111-111111111111",
      zone: "roomOverview",
    })).toEqual([
      "원주시-단계동",
      "BR-WJ-DANGYE-26-0001_브링 - 원주점_강원 원주시 단계동 123-4",
      "301호",
      "2026-08-12_11111111",
      "07_방 전체",
    ]);
  });

  it("removes Drive path separators and control characters", () => {
    expect(sanitizeDriveName("  A/B\\C\nD  ")).toBe("A-B-C D");
  });

  it("uses a deterministic media filename with a safe extension", () => {
    expect(buildDriveMediaFileName({
      zone: "verticalVideo",
      mediaId: "22222222-2222-4222-8222-222222222222",
      kind: "video",
      originalFileName: "현장 최종.MOV",
    })).toBe("14_세로영상_22222222.mov");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  buildFleetDriveFileName,
  buildFleetDriveFolderPath,
  uploadFleetOdometerEvidence,
} from "../../app/fleet/fleet-drive-evidence.client";

function drive(overrides: Record<string, unknown> = {}) {
  return {
    validateWritableRoot: vi.fn(async () => ({ id: "root", name: "BRING CAR", mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: true } })),
    ensureFolderPath: vi.fn(async () => "month-folder"),
    findByAppProperty: vi.fn(async () => null),
    uploadSmallFile: vi.fn(async () => ({ id: "drive-file-1", name: "evidence.jpg", mimeType: "image/jpeg" })),
    ...overrides,
  };
}

describe("fleet Drive evidence planning", () => {
  it("builds the monthly odometer folder in Korean time", () => {
    expect(buildFleetDriveFolderPath(new Date("2026-10-24T15:05:00.000Z"))).toEqual(["계기판 사진", "2026-10"]);
  });

  it("builds a sanitized deterministic file name", () => {
    expect(buildFleetDriveFileName({
      capturedAt: new Date("2026-10-25T00:30:00.000Z"),
      driverName: "김/민욱",
      startOdometer: 1280,
      tripId: "-Oabc123456",
    })).toBe("20261025-0930_김-민욱_1280km_-Oabc123.jpg");
  });
});

describe("uploadFleetOdometerEvidence", () => {
  const input = {
    rootFolderId: "root",
    tripId: "trip-1234",
    vehicleId: "ev4-001",
    userUid: "user-1",
    driverName: "김민욱",
    startOdometer: 1280,
    capturedAt: new Date("2026-10-25T00:30:00.000Z"),
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
  };

  it("rejects a mismatched or non-writable configured root", async () => {
    await expect(uploadFleetOdometerEvidence(input, drive({
      validateWritableRoot: vi.fn(async () => ({ id: "other", name: "다른 폴더", mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: true } })),
    }) as never)).rejects.toThrow("fleet_drive_root_invalid");
  });

  it("reuses an existing file for the same trip", async () => {
    const adapter = drive({
      findByAppProperty: vi.fn(async () => ({ id: "existing-file", name: "existing.jpg", mimeType: "image/jpeg" })),
    });
    const result = await uploadFleetOdometerEvidence(input, adapter as never);

    expect(adapter.uploadSmallFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      driveFileId: "existing-file",
      driveUrl: "https://drive.google.com/file/d/existing-file/view",
      fileName: "existing.jpg",
      uploadState: "complete",
    });
  });

  it("uploads to the exact monthly folder with idempotency properties", async () => {
    const adapter = drive();
    const result = await uploadFleetOdometerEvidence(input, adapter as never);

    expect(adapter.ensureFolderPath).toHaveBeenCalledWith("root", ["계기판 사진", "2026-10"]);
    expect(adapter.uploadSmallFile).toHaveBeenCalledWith(expect.objectContaining({
      parentId: "month-folder",
      mimeType: "image/jpeg",
      appProperties: expect.objectContaining({ bringFleetTripId: "trip-1234", bringFleetStartKm: "1280" }),
    }));
    expect(result.driveFileId).toBe("drive-file-1");
  });
});

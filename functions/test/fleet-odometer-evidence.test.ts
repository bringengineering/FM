import { describe, expect, it, vi } from "vitest";

import { uploadFleetOdometerEvidenceCore } from "../src/fleet/upload-odometer-evidence.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]).toString("base64");

function input(overrides: Record<string, unknown> = {}) {
  return {
    tripId: "-Oabc123456",
    vehicleId: "ev4-001",
    driverName: "김민욱",
    startOdometer: 1280,
    capturedAt: "2026-10-25T00:30:00.000Z",
    imageBase64: jpeg,
    ...overrides,
  };
}

function drive(overrides: Record<string, unknown> = {}) {
  return {
    validateRoot: vi.fn(async () => undefined),
    ensureFolder: vi.fn(async (parentId: string, name: string) => `${parentId}/${name}`),
    findByTripId: vi.fn(async () => null),
    uploadJpeg: vi.fn(async ({ name }: { name: string }) => ({ id: "drive-file-1", name, mimeType: "image/jpeg" })),
    ...overrides,
  };
}

describe("uploadFleetOdometerEvidenceCore", () => {
  it("rejects malformed input before contacting Drive", async () => {
    const adapter = drive();
    await expect(uploadFleetOdometerEvidenceCore(input({ startOdometer: 1.5 }), {
      rootFolderId: "root-folder",
      userUid: "user-1",
      drive: adapter,
    })).rejects.toThrow("fleet_evidence_input_invalid");
    expect(adapter.validateRoot).not.toHaveBeenCalled();
  });

  it("creates the monthly path and uploads a JPEG with trip metadata", async () => {
    const adapter = drive();
    const result = await uploadFleetOdometerEvidenceCore(input(), {
      rootFolderId: "root-folder",
      userUid: "user-1",
      drive: adapter,
    });

    expect(adapter.ensureFolder).toHaveBeenNthCalledWith(1, "root-folder", "계기판 사진");
    expect(adapter.ensureFolder).toHaveBeenNthCalledWith(2, "root-folder/계기판 사진", "2026-10");
    expect(adapter.uploadJpeg).toHaveBeenCalledWith(expect.objectContaining({
      parentId: "root-folder/계기판 사진/2026-10",
      bytes: expect.any(Uint8Array),
      appProperties: expect.objectContaining({ bringFleetTripId: "-Oabc123456", bringFleetUserUid: "user-1" }),
    }));
    expect(result).toEqual(expect.objectContaining({
      driveFileId: "drive-file-1",
      driveUrl: "https://drive.google.com/file/d/drive-file-1/view",
      uploadState: "complete",
    }));
  });

  it("reuses an existing file for the same trip", async () => {
    const adapter = drive({ findByTripId: vi.fn(async () => ({ id: "existing-file", name: "existing.jpg", mimeType: "image/jpeg" })) });
    const result = await uploadFleetOdometerEvidenceCore(input(), {
      rootFolderId: "root-folder",
      userUid: "user-1",
      drive: adapter,
    });

    expect(adapter.uploadJpeg).not.toHaveBeenCalled();
    expect(result.driveFileId).toBe("existing-file");
  });
});

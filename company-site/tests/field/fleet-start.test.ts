import { describe, expect, it, vi } from "vitest";

import { executeFleetTripStart } from "../../app/fleet/fleet-start";

describe("executeFleetTripStart", () => {
  const session = { uid: "user-1", displayName: "김민욱" };
  const input = {
    purpose: "현장 점검",
    destination: "원주",
    startOdometer: 1280,
    file: new File([new Uint8Array([1])], "odometer.jpg", { type: "image/jpeg" }),
  };

  it("uploads Drive evidence before writing the trip receipt", async () => {
    const order: string[] = [];
    const write = vi.fn(async () => { order.push("write"); });
    const result = await executeFleetTripStart(session, input, {
      createTripId: () => "trip-1234",
      now: () => "2026-10-25T00:30:00.000Z",
      upload: vi.fn(async () => {
        order.push("upload");
        return { driveFileId: "drive-file-1", driveUrl: "https://drive.google.com/file/d/drive-file-1/view", fileName: "evidence.jpg", uploadState: "complete" as const };
      }),
      write,
    });

    expect(order).toEqual(["upload", "write"]);
    expect(write).toHaveBeenCalledWith("trip-1234", expect.objectContaining({
      evidenceDriveFileId: "drive-file-1",
      evidenceUploadState: "complete",
    }));
    expect(result).toBe("trip-1234");
  });

  it("does not create a trip when Drive upload fails", async () => {
    const write = vi.fn();
    await expect(executeFleetTripStart(session, input, {
      createTripId: () => "trip-1234",
      now: () => "2026-10-25T00:30:00.000Z",
      upload: vi.fn(async () => { throw new Error("fleet_drive_temporarily_unavailable"); }),
      write,
    })).rejects.toThrow("fleet_drive_temporarily_unavailable");
    expect(write).not.toHaveBeenCalled();
  });
});

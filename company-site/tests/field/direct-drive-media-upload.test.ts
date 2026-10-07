import { describe, expect, it, vi } from "vitest";

import {
  createDirectDriveMediaUploadPort,
  type DirectDriveMediaDependencies,
} from "../../app/field/lib/direct-drive-media-upload";
import type { GoogleDriveClient } from "../../app/field/lib/google-drive.client";
import type { OfflineQueuePort, QueuedMediaRecord } from "../../app/field/lib/offline-queue";

function photo(): QueuedMediaRecord {
  return {
    key: "staff-1:22222222-2222-4222-8222-222222222222",
    uid: "staff-1",
    mediaId: "22222222-2222-4222-8222-222222222222",
    requestId: "33333333-3333-4333-8333-333333333333",
    captureSessionId: "11111111-1111-4111-8111-111111111111",
    descriptor: {
      mediaId: "22222222-2222-4222-8222-222222222222",
      captureSessionId: "11111111-1111-4111-8111-111111111111",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "외관.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      lastModified: 1,
      capturedAt: "2026-08-12T05:00:00.000Z",
      uploadState: "queued",
      uploadProgress: 0,
    },
    binding: {
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: "visit-1",
    },
    blob: new Blob(["abc"], { type: "image/jpeg" }),
    driveSyncState: "notRequested",
    retryCount: 0,
  };
}

function setup() {
  const drive = {
    findByAppProperty: vi.fn(async () => null),
    ensureFolderPath: vi.fn(async () => "zone-folder"),
    uploadSmallFile: vi.fn(async () => ({
      id: "drive-file-1",
      name: "01_외관_22222222.jpg",
      mimeType: "image/jpeg",
      size: "3",
      appProperties: {
        bringMediaId: "22222222-2222-4222-8222-222222222222",
        bringCapturedBy: "staff-1",
        bringCaptureSessionId: "11111111-1111-4111-8111-111111111111",
      },
    })),
    startResumableUpload: vi.fn(),
    uploadResumable: vi.fn(),
    getFile: vi.fn(async () => ({
      id: "drive-file-1",
      name: "01_외관_22222222.jpg",
      mimeType: "image/jpeg",
      size: "3",
    })),
  } as unknown as GoogleDriveClient;
  const queue = { patch: vi.fn(async () => undefined) } as unknown as OfflineQueuePort;
  const dependencies: DirectDriveMediaDependencies = {
    drive,
    queue,
    rootFolderId: "root-1",
    now: () => "2026-08-12T05:01:00.000Z",
    read: vi.fn(async (path) => {
      if (path === "fieldPlatform/buildings/building-1") {
        return {
          id: "building-1",
          managementNumber: "BR-WJ-DANGYE-26-0001",
          name: "브링 단계점",
          roadAddress: "강원 원주시 단계동 1",
          managementContract: { status: "active" },
        };
      }
      if (path === "fieldPlatform/units/unit-1") {
        return { id: "unit-1", buildingId: "building-1", unitLabel: "301호" };
      }
      if (path === "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111") {
        return {
          createdBy: "staff-1",
          buildingId: "building-1",
          unitId: "unit-1",
          listingId: "listing-1",
          visitId: "visit-1",
        };
      }
      if (path === "fieldPlatform/media") return {};
      return null;
    }),
    update: vi.fn(async () => undefined),
  };
  return { dependencies, drive, queue };
}

describe("direct Drive media upload port", () => {
  it("uploads to the deterministic folder and returns replay metadata", async () => {
    const { dependencies, drive } = setup();
    const port = createDirectDriveMediaUploadPort(dependencies);
    const progress = vi.fn();

    await expect(port.upload(photo(), progress)).resolves.toMatchObject({
      path: expect.stringContaining("22222222-2222-4222-8222-222222222222"),
      generation: "drive-file-1",
      sizeBytes: 3,
    });
    expect(drive.ensureFolderPath).toHaveBeenCalledWith("root-1", [
      "원주시-단계동",
      "BR-WJ-DANGYE-26-0001_브링 단계점_강원 원주시 단계동 1",
      "301호",
      "2026-08-12_11111111",
      "01_외관",
    ]);
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it("finalizes the Drive file directly in RTDB and marks the session", async () => {
    const { dependencies } = setup();
    const port = createDirectDriveMediaUploadPort(dependencies);

    await expect(port.finalize({
      requestId: photo().requestId,
      mediaId: photo().mediaId,
      captureSessionId: photo().captureSessionId,
      objectGeneration: "drive-file-1",
      stagingPath: "field-media/staff-1/session/photos/22222222-2222-4222-8222-222222222222.jpg",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: "visit-1",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "외관.jpg",
      capturedAt: "2026-08-12T05:00:00.000Z",
    })).resolves.toMatchObject({
      storagePath: "drive:drive-file-1",
      driveSyncState: "complete",
    });
    expect(dependencies.update).toHaveBeenCalledWith(expect.objectContaining({
      "fieldPlatform/media/22222222-2222-4222-8222-222222222222": expect.objectContaining({
        driveFileId: "drive-file-1",
        uploadState: "finalized",
        driveSyncState: "complete",
      }),
      "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111/status": "open",
    }));
  });

  it("uses resumable upload and checkpoints large videos", async () => {
    const { dependencies, drive, queue } = setup();
    vi.mocked(drive.startResumableUpload).mockResolvedValue("https://upload.example/session");
    vi.mocked(drive.uploadResumable).mockImplementation(async (input) => {
      await input.onProgress?.(8 * 1024 * 1024);
      return { id: "video-1", name: "video.mp4", mimeType: "video/mp4", size: String(input.blob.size) };
    });
    const item = photo();
    item.descriptor = {
      ...item.descriptor,
      kind: "video",
      zone: "verticalVideo",
      originalFileName: "방영상.mp4",
      mimeType: "video/mp4",
      sizeBytes: 9 * 1024 * 1024,
    };
    item.blob = new Blob([new Uint8Array(item.descriptor.sizeBytes)], { type: "video/mp4" });
    const port = createDirectDriveMediaUploadPort(dependencies);

    await port.upload(item, vi.fn());
    expect(queue.patch).toHaveBeenCalledWith(item.uid, item.mediaId, expect.objectContaining({
      driveResumableUri: "https://upload.example/session",
    }));
    expect(queue.patch).toHaveBeenCalledWith(item.uid, item.mediaId, expect.objectContaining({
      driveUploadedBytes: 8 * 1024 * 1024,
    }));
  });

  it("does not create a managed-map projection for an unmanaged advertising listing", async () => {
    const { dependencies } = setup();
    const originalRead = dependencies.read;
    dependencies.read = vi.fn(async (path) => path === "fieldPlatform/buildings/building-1"
      ? {
          id: "building-1",
          name: "광고 전용 건물",
          roadAddress: "강원 원주시 단계동 2",
          managementContract: { status: "none" },
        }
      : originalRead(path));
    const port = createDirectDriveMediaUploadPort(dependencies);

    await port.finalize({
      requestId: photo().requestId,
      mediaId: photo().mediaId,
      captureSessionId: photo().captureSessionId,
      objectGeneration: "drive-file-1",
      stagingPath: "field-media/staff-1/session/photos/22222222-2222-4222-8222-222222222222.jpg",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: "visit-1",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "외관.jpg",
      capturedAt: "2026-08-12T05:00:00.000Z",
    });

    const patch = vi.mocked(dependencies.update).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(patch).some((path) => path.includes("mapProjections"))).toBe(false);
  });

  it("rejects media binding that does not exactly match the capture session", async () => {
    const { dependencies } = setup();
    const port = createDirectDriveMediaUploadPort(dependencies);

    await expect(port.finalize({
      requestId: photo().requestId,
      mediaId: photo().mediaId,
      captureSessionId: photo().captureSessionId,
      objectGeneration: "drive-file-1",
      stagingPath: "field-media/staff-1/session/photos/22222222-2222-4222-8222-222222222222.jpg",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "other-listing",
      visitId: "visit-1",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "외관.jpg",
      capturedAt: "2026-08-12T05:00:00.000Z",
    })).rejects.toThrow("field_capture_session_mismatch");
    expect(dependencies.update).not.toHaveBeenCalled();
  });
});

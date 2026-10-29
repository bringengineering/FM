import { describe, expect, it } from "vitest";

import type { QueuedMediaRecord } from "../../app/field/lib/offline-queue";
import {
  EMPTY_UPLOAD_SUMMARY,
  summarizeUploadRecords,
} from "../../app/field/lib/upload-summary";
import type { DriveSyncState, UploadState } from "../../app/field/lib/types";

function record(input: {
  id: string;
  capturedAt: string;
  uploadState: UploadState;
  uploadProgress: number;
  driveSyncState?: DriveSyncState;
}): QueuedMediaRecord {
  return {
    key: `staff-1:${input.id}`,
    uid: "staff-1",
    mediaId: input.id,
    requestId: `request-${input.id}`,
    captureSessionId: "session-1",
    descriptor: {
      mediaId: input.id,
      captureSessionId: "session-1",
      kind: "photo",
      zone: "roomOverview",
      slotId: `slot-${input.id}`,
      required: true,
      originalFileName: `${input.id}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      lastModified: 0,
      capturedAt: input.capturedAt,
      uploadState: input.uploadState,
      uploadProgress: input.uploadProgress,
    },
    binding: {},
    driveSyncState: input.driveSyncState ?? "notRequested",
    retryCount: 0,
  };
}

describe("upload summary", () => {
  it("uses the Seoul date while keeping older pending and failed files visible", () => {
    const records = [
      record({ id: "today-queued", capturedAt: "2026-08-13T15:05:00.000Z", uploadState: "queued", uploadProgress: 0 }),
      record({ id: "today-uploading", capturedAt: "2026-08-13T16:00:00.000Z", uploadState: "uploading", uploadProgress: 50 }),
      record({ id: "today-complete", capturedAt: "2026-08-13T17:00:00.000Z", uploadState: "finalized", uploadProgress: 100, driveSyncState: "complete" }),
      record({ id: "today-failed", capturedAt: "2026-08-13T18:00:00.000Z", uploadState: "failed", uploadProgress: 25 }),
      record({ id: "older-queued", capturedAt: "2026-08-13T14:59:59.999Z", uploadState: "queued", uploadProgress: 10 }),
      record({ id: "older-failed", capturedAt: "2026-08-12T10:00:00.000Z", uploadState: "failed", uploadProgress: 20 }),
      record({ id: "older-complete", capturedAt: "2026-08-12T11:00:00.000Z", uploadState: "finalized", uploadProgress: 100, driveSyncState: "complete" }),
    ];

    expect(summarizeUploadRecords(records, "2026-08-13T15:30:00.000Z")).toEqual({
      todayTotal: 4,
      uploading: 3,
      completedToday: 1,
      failed: 2,
      progressPercent: 44,
    });
  });

  it("treats a finalized file waiting for Drive as uploading", () => {
    const records = [record({
      id: "drive-pending",
      capturedAt: "2026-08-13T15:05:00.000Z",
      uploadState: "finalized",
      uploadProgress: 100,
      driveSyncState: "queued",
    })];

    expect(summarizeUploadRecords(records, "2026-08-13T16:00:00.000Z")).toEqual({
      todayTotal: 1,
      uploading: 1,
      completedToday: 0,
      failed: 0,
      progressPercent: 100,
    });
  });

  it("counts a Drive synchronization failure as failed instead of uploading", () => {
    const records = [record({
      id: "drive-failed",
      capturedAt: "2026-08-13T15:05:00.000Z",
      uploadState: "finalized",
      uploadProgress: 100,
      driveSyncState: "failed",
    })];

    expect(summarizeUploadRecords(records, "2026-08-13T16:00:00.000Z"))
      .toMatchObject({ uploading: 0, completedToday: 0, failed: 1 });
  });

  it("returns the stable empty snapshot when no files exist", () => {
    expect(summarizeUploadRecords([], "2026-08-13T15:30:00.000Z"))
      .toEqual(EMPTY_UPLOAD_SUMMARY);
  });
});

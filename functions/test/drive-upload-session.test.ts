import { describe, expect, it } from "vitest";

import { buildDriveRecoveryKey } from "../src/drive/recovery-key.js";
import {
  readDriveUploadSession,
  reduceDriveUploadSessionCheckpoint,
} from "../src/drive/upload-session.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION = "1740000000000001";
const SESSION_URI =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=safe-id";
const NOW = "2026-08-10T03:00:00.000Z";
const LEASE_UNTIL = "2026-08-10T03:12:00.000Z";

function state() {
  return {
    driveSyncJobs: {
      [MEDIA_ID]: {
        id: MEDIA_ID,
        mediaId: MEDIA_ID,
        objectGeneration: GENERATION,
        status: "syncing",
        leaseOwner: "worker-1",
        leaseToken: "lease-1",
        leaseUntil: "2026-08-10T03:05:00.000Z",
      },
    },
  };
}

function checkpoint(overrides: Record<string, unknown> = {}) {
  return {
    mediaId: MEDIA_ID,
    workerId: "worker-1",
    leaseToken: "lease-1",
    objectGeneration: GENERATION,
    sessionUri: SESSION_URI,
    nextOffset: 0,
    totalSizeBytes: 500 * 1024 * 1024,
    parentId: "folder-5",
    fileName: "room.mp4",
    mimeType: "video/mp4",
    now: NOW,
    leaseDurationMs: 12 * 60_000,
    ...overrides,
  };
}

describe("server-only Drive resumable session checkpoint", () => {
  it("atomically persists a new session and extends the fenced job heartbeat", () => {
    const result = reduceDriveUploadSessionCheckpoint(state(), checkpoint());

    expect(result).toMatchObject({ status: "committed", write: true });
    expect(result.state).toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}`,
      expect.objectContaining({
        mediaId: MEDIA_ID,
        objectGeneration: GENERATION,
        sessionUri: SESSION_URI,
        nextOffset: 0,
        totalSizeBytes: 500 * 1024 * 1024,
        parentId: "folder-5",
        fileName: "room.mp4",
        mimeType: "video/mp4",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    expect(result.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.leaseUntil`,
      LEASE_UNTIL,
    );
    expect(result.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
      buildDriveRecoveryKey("syncing", LEASE_UNTIL, MEDIA_ID),
    );
  });

  it("reuses the exact session and records a Drive-authoritative resumed offset", () => {
    const first = reduceDriveUploadSessionCheckpoint(state(), checkpoint());
    const resumedAt = "2026-08-10T03:01:00.000Z";
    const second = reduceDriveUploadSessionCheckpoint(first.state, checkpoint({
      nextOffset: 8 * 1024 * 1024,
      now: resumedAt,
    }));

    expect(second).toMatchObject({ status: "committed", write: true });
    expect(second.state).toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}.nextOffset`,
      8 * 1024 * 1024,
    );
    expect(second.state).toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}.createdAt`,
      NOW,
    );
    expect(readDriveUploadSession(second.state, checkpoint())).toEqual(
      expect.objectContaining({
        sessionUri: SESSION_URI,
        nextOffset: 8 * 1024 * 1024,
      }),
    );
  });

  it("rejects a different session and stale lease without overwriting progress", () => {
    const first = reduceDriveUploadSessionCheckpoint(state(), checkpoint());
    const different = reduceDriveUploadSessionCheckpoint(first.state, checkpoint({
      sessionUri:
        "https://www.googleapis.com/upload/drive/v3/files?upload_id=other",
    }));
    expect(different).toMatchObject({ status: "sessionConflict", write: false });
    expect(different.state).toBe(first.state);

    const stale = reduceDriveUploadSessionCheckpoint(first.state, checkpoint({
      workerId: "worker-2",
      leaseToken: "lease-2",
    }));
    expect(stale).toMatchObject({ status: "staleLease", write: false });
    expect(stale.state).toBe(first.state);
  });

  it("fails with a safe code for an unsafe session URI", () => {
    const secretUri = "https://evil.example/upload?token=secret-value";
    let caught: unknown;
    try {
      reduceDriveUploadSessionCheckpoint(state(), checkpoint({
        sessionUri: secretUri,
      }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("drive_resumable_response_invalid");
    expect(JSON.stringify(caught)).not.toContain(secretUri);
  });
});

import { describe, expect, it, vi } from "vitest";

import { DRIVE_FOLDER_MIME_TYPE } from "../src/drive/folders.js";
import { buildDriveRecoveryKey } from "../src/drive/recovery-key.js";
import { DRIVE_RESUMABLE_CHUNK_BYTES } from "../src/drive/resumable-upload.js";
import {
  DriveSyncRetryableError,
  processDriveSyncJob,
  type DriveSyncRuntimeDatabase,
  type DriveSyncRuntimeDependencies,
} from "../src/drive/runtime.js";
import type { DriveMediaAdapter } from "../src/drive/sync-media.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const GENERATION = "1740000000000001";
const STORAGE_PATH = `field-media-finalized/building-1/${MEDIA_ID}.jpg`;
const SOURCE_MD5 = "5d41402abc4b2a76b9719d911017c592";
const SESSION_URI =
  "https://www.googleapis.com/upload/drive/v3/files?upload_id=runtime-safe-id";
const SIZE_BYTES = DRIVE_RESUMABLE_CHUNK_BYTES + 7;

function initialState() {
  const createdAt = "2026-08-10T02:01:01.000Z";
  return {
    buildings: {
      "building-1": {
        id: "building-1",
        managementNumber: "BR-001",
        neighborhood: "Musil-dong",
        name: "Bring Ville",
      },
    },
    units: {
      "unit-1": {
        id: "unit-1",
        buildingId: "building-1",
        unitLabel: "301",
      },
    },
    listings: {
      "listing-1": {
        id: "listing-1",
        buildingId: "building-1",
        unitId: "unit-1",
      },
    },
    captureSessions: {
      [SESSION_ID]: {
        id: SESSION_ID,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        status: "complete",
        createdAt: "2026-08-10T02:00:00.000Z",
      },
    },
    media: {
      [MEDIA_ID]: {
        id: MEDIA_ID,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        captureSessionId: SESSION_ID,
        kind: "photo",
        zone: "roomOverview",
        mimeType: "image/jpeg",
        sizeBytes: SIZE_BYTES,
        originalFileName: "room.jpg",
        capturedAt: "2026-08-10T02:01:00.000Z",
        storagePath: STORAGE_PATH,
        objectGeneration: GENERATION,
        objectMd5Hash: SOURCE_MD5,
        uploadState: "finalized",
        driveSyncState: "queued",
      },
    },
    driveSyncJobs: {
      [MEDIA_ID]: {
        id: MEDIA_ID,
        mediaId: MEDIA_ID,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        storagePath: STORAGE_PATH,
        objectGeneration: GENERATION,
        status: "queued",
        recoveryKey: buildDriveRecoveryKey("queued", createdAt, MEDIA_ID),
        attemptCount: 0,
        createdAt,
        updatedAt: createdAt,
      },
    },
  };
}

function database() {
  const value: DriveSyncRuntimeDatabase & {
    state: unknown;
    transactionRoot: ReturnType<typeof vi.fn>;
    listRecoveryJobs: ReturnType<typeof vi.fn>;
  } = {
    state: initialState(),
    transactionRoot: vi.fn(async (update) => {
      const next = update(value.state);
      const committed = next !== undefined;
      if (committed) value.state = next;
      return { committed, state: value.state };
    }),
    listRecoveryJobs: vi.fn(async () => []),
  };
  return value;
}

function folder(id: string, name: string, parentId: string) {
  return {
    id,
    name,
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    parents: [parentId],
    trashed: false,
  };
}

describe("resumable Drive runtime recovery", () => {
  it("persists the session and resumes after the acknowledged chunk without a full retransmit", async () => {
    const root = database();
    const folders = new Map<string, string>();
    let folderSequence = 0;
    let uploadCall = 0;
    const startResumableMediaUpload = vi.fn(async () => ({
      sessionUri: SESSION_URI,
      nextOffset: 0 as const,
    }));
    const probeResumableMediaUpload = vi.fn(async () => ({
      status: "active" as const,
      nextOffset: DRIVE_RESUMABLE_CHUNK_BYTES,
    }));
    const uploadResumableMediaChunk = vi.fn(async ({ appProperties: _ignored, ...input }: any) => {
      uploadCall += 1;
      if (uploadCall === 1) {
        return {
          status: "active" as const,
          nextOffset: DRIVE_RESUMABLE_CHUNK_BYTES,
        };
      }
      if (uploadCall === 2) throw new Error("raw-network-secret");
      return {
        status: "complete" as const,
        file: {
          id: "drive-file-1",
          name: "room.jpg",
          mimeType: "image/jpeg",
          parents: ["folder-5"],
          trashed: false,
          size: String(SIZE_BYTES),
          md5Checksum: SOURCE_MD5,
          appProperties: {
            bringMediaId: MEDIA_ID,
            bringObjectGeneration: GENERATION,
          },
        },
      };
    });
    const drive: DriveMediaAdapter = {
      listExactFolders: vi.fn(async ({ parentId, name }) => {
        const id = folders.get(`${parentId}\n${name}`);
        return id ? [folder(id, name, parentId)] : [];
      }),
      createFolder: vi.fn(async ({ parentId, name }) => {
        const id = `folder-${++folderSequence}`;
        folders.set(`${parentId}\n${name}`, id);
        return folder(id, name, parentId);
      }),
      listExactMediaFiles: vi.fn(async () => []),
      uploadMediaFile: vi.fn(),
      startResumableMediaUpload,
      probeResumableMediaUpload,
      uploadResumableMediaChunk,
    };
    const readFinalizedObjectRange = vi.fn(async ({
      startOffset,
      endOffsetInclusive,
    }) => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: SIZE_BYTES,
      mimeType: "image/jpeg",
      md5Hash: SOURCE_MD5,
      rangeStart: startOffset,
      rangeEndInclusive: endOffsetInclusive,
      body: { startOffset, endOffsetInclusive },
    }));
    let now = "2026-08-10T03:00:00.000Z";
    let token = 0;
    const dependencies: DriveSyncRuntimeDependencies = {
      database: root,
      storage: {
        readFinalizedObject: vi.fn(),
        readFinalizedObjectMetadata: vi.fn(async () => ({
          path: STORAGE_PATH,
          generation: GENERATION,
          sizeBytes: SIZE_BYTES,
          mimeType: "image/jpeg",
          md5Hash: SOURCE_MD5,
        })),
        readFinalizedObjectRange,
      },
      drive,
      rootFolderId: "root-1",
      now: () => now,
      randomToken: () => `token-${++token}`,
    };

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).rejects
      .toBeInstanceOf(DriveSyncRetryableError);
    expect(root.state).toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}.sessionUri`,
      SESSION_URI,
    );
    expect(root.state).toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}.nextOffset`,
      DRIVE_RESUMABLE_CHUNK_BYTES,
    );
    expect(root.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_upload_failed",
    );

    now = "2026-08-10T03:00:31.000Z";
    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "complete",
    );

    expect(startResumableMediaUpload).toHaveBeenCalledTimes(1);
    expect(probeResumableMediaUpload).toHaveBeenCalledWith({
      sessionUri: SESSION_URI,
      totalSizeBytes: SIZE_BYTES,
    });
    const starts = readFinalizedObjectRange.mock.calls.map(
      ([input]) => input.startOffset,
    );
    expect(starts.filter((value) => value === 0)).toHaveLength(1);
    expect(starts.filter(
      (value) => value === DRIVE_RESUMABLE_CHUNK_BYTES,
    )).toHaveLength(2);
    expect(drive.uploadMediaFile).not.toHaveBeenCalled();
    expect(root.state).not.toHaveProperty(`driveUploadSessions.${MEDIA_ID}`);
    expect(root.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.driveFileId`,
      "drive-file-1",
    );
    expect(JSON.stringify(root.state)).not.toContain("raw-network-secret");
  });
});

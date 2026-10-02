import { describe, expect, it, vi } from "vitest";

import { readDriveOAuthConfig } from "../src/drive/google-auth.js";
import { buildDriveRecoveryKey } from "../src/drive/recovery-key.js";
import { reduceDriveFolderLeaseClaim } from "../src/drive/folder-lease.js";
import { DRIVE_RESUMABLE_CHUNK_BYTES } from "../src/drive/resumable-upload.js";
import {
  DRIVE_FOLDER_MIME_TYPE,
  buildExactFolderQuery,
} from "../src/drive/folders.js";
import {
  buildExactDriveFileQuery,
  reduceDriveSyncClaim,
  reduceDriveSyncFailure,
  reduceDriveSyncSuccess,
  safeDriveFailureCode,
  syncClaimedDriveMedia,
  validateDriveSyncContext,
  type DriveMediaAdapter,
  type FinalizedMediaStorageAdapter,
} from "../src/drive/sync-media.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const GENERATION = "1740000000000001";
const STORAGE_PATH = `field-media-finalized/building-1/${MEDIA_ID}.jpg`;
const NOW = "2026-08-10T03:00:00.000Z";
const LEASE_UNTIL = "2026-08-10T03:05:00.000Z";

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    buildings: {
      "building-1": {
        id: "building-1",
        managementNumber: "BR-001",
        neighborhood: "무실동",
        name: "브링빌",
      },
    },
    units: {
      "unit-1": {
        id: "unit-1",
        buildingId: "building-1",
        unitLabel: "301호",
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
        sizeBytes: 1_024,
        originalFileName: "방 전체.jpg",
        capturedAt: "2026-08-10T02:01:00.000Z",
        storagePath: STORAGE_PATH,
        objectGeneration: GENERATION,
        objectMd5Hash: "source-md5",
        objectCrc32c: "source-crc",
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
        recoveryKey: buildDriveRecoveryKey(
          "queued",
          "2026-08-10T02:01:01.000Z",
          MEDIA_ID,
        ),
        attemptCount: 0,
        createdAt: "2026-08-10T02:01:01.000Z",
        updatedAt: "2026-08-10T02:01:01.000Z",
      },
    },
    ...overrides,
  };
}

const lease = {
  mediaId: MEDIA_ID,
  workerId: "worker-1",
  leaseToken: "lease-1",
  now: NOW,
  leaseDurationMs: 300_000,
};

function claimedState() {
  const decision = reduceDriveSyncClaim(baseState(), lease);
  if (decision.status !== "claimed") throw new Error("test_claim_failed");
  return decision.state;
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

function adapters(options: {
  existingFiles?: unknown[];
  uploadError?: Error;
  filesAfterUploadError?: unknown[];
  uploadFile?: unknown;
} = {}) {
  const folders = new Map<string, string>();
  let nextFolder = 1;
  let fileListCall = 0;
  const folderKey = (parentId: string, name: string) => `${parentId}\n${name}`;
  const sourceBody = { stream: "opaque" };
  const deleteObject = vi.fn();
  const storage: FinalizedMediaStorageAdapter & {
    deleteObject: ReturnType<typeof vi.fn>;
  } = {
    deleteObject,
    readFinalizedObject: vi.fn(async () => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 1_024,
      mimeType: "image/jpeg",
      md5Hash: "source-md5",
      crc32c: "source-crc",
      body: sourceBody,
    })),
    readFinalizedObjectMetadata: vi.fn(async () => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 1_024,
      mimeType: "image/jpeg",
      md5Hash: "source-md5",
      crc32c: "source-crc",
    })),
    readFinalizedObjectRange: vi.fn(async ({
      startOffset,
      endOffsetInclusive,
    }) => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 1_024,
      mimeType: "image/jpeg",
      md5Hash: "source-md5",
      crc32c: "source-crc",
      rangeStart: startOffset,
      rangeEndInclusive: endOffsetInclusive,
      body: sourceBody,
    })),
  };

  const uploaded = options.uploadFile ?? {
    id: "drive-file-1",
    name: "방 전체.jpg",
    mimeType: "image/jpeg",
    parents: ["folder-5"],
    trashed: false,
    size: "1024",
    md5Checksum: "source-md5",
    appProperties: {
      bringMediaId: MEDIA_ID,
      bringObjectGeneration: GENERATION,
    },
  };
  const drive: DriveMediaAdapter = {
    listExactFolders: vi.fn(async ({ parentId, name, query }) => {
      expect(query).toBe(buildExactFolderQuery(parentId, name));
      const id = folders.get(folderKey(parentId, name));
      return id ? [folder(id, name, parentId)] : [];
    }),
    createFolder: vi.fn(async ({ parentId, name }) => {
      const id = `folder-${nextFolder++}`;
      folders.set(folderKey(parentId, name), id);
      return folder(id, name, parentId);
    }),
    listExactMediaFiles: vi.fn(async () => {
      fileListCall += 1;
      if (options.uploadError && fileListCall > 1) {
        return options.filesAfterUploadError ?? [];
      }
      return options.existingFiles ?? [];
    }),
    uploadMediaFile: vi.fn(async () => {
      if (options.uploadError) throw options.uploadError;
      return uploaded;
    }),
    startResumableMediaUpload: vi.fn(async () => ({
      sessionUri:
        "https://www.googleapis.com/upload/drive/v3/files?upload_id=test-safe-id",
      nextOffset: 0 as const,
    })),
    probeResumableMediaUpload: vi.fn(async () => ({
      status: "active" as const,
      nextOffset: 0,
    })),
    uploadResumableMediaChunk: vi.fn(async () => {
      if (options.uploadError) throw options.uploadError;
      return { status: "complete" as const, file: uploaded as Record<string, unknown> };
    }),
  };
  const checkpointUploadSession = vi.fn(async (input) => ({
    ...input,
    createdAt: NOW,
    updatedAt: NOW,
  }));
  return {
    storage,
    drive,
    sourceBody,
    deleteObject,
    checkpointUploadSession,
  };
}

function existingDriveFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "drive-file-existing",
    name: "방 전체.jpg",
    mimeType: "image/jpeg",
    parents: ["folder-5"],
    trashed: false,
    size: "1024",
    md5Checksum: "source-md5",
    appProperties: {
      bringMediaId: MEDIA_ID,
      bringObjectGeneration: GENERATION,
    },
    ...overrides,
  };
}

describe("Drive OAuth configuration", () => {
  it("reads only the four required bounded values without embedding defaults", () => {
    expect(readDriveOAuthConfig({
      DRIVE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      DRIVE_CLIENT_SECRET: "test-secret",
      DRIVE_REFRESH_TOKEN: "test-refresh-token",
      DRIVE_ROOT_FOLDER_ID: "root-1",
      UNRELATED_SECRET: "do-not-copy",
    })).toEqual({
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
      rootFolderId: "root-1",
      rootMode: "appCreated",
    });
  });

  it("uses a safe error code that never contains a missing or malformed secret", () => {
    const secret = "\u0000super-secret-value";
    let caught: unknown;
    try {
      readDriveOAuthConfig({
        DRIVE_CLIENT_ID: "client-id.apps.googleusercontent.com",
        DRIVE_CLIENT_SECRET: secret,
        DRIVE_REFRESH_TOKEN: "refresh",
        DRIVE_ROOT_FOLDER_ID: "root-1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("drive_oauth_config_invalid");
    expect(JSON.stringify(caught)).not.toContain("super-secret-value");
  });
});

describe("Drive sync lease reducer", () => {
  it("lets one worker claim a queued job and fences a concurrent worker", () => {
    const first = reduceDriveSyncClaim(baseState(), lease);
    expect(first).toMatchObject({ status: "claimed", write: true });
    expect(first.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.leaseUntil`,
      LEASE_UNTIL,
    );
    expect(first.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.attemptCount`,
      1,
    );
    expect(first.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
      buildDriveRecoveryKey("syncing", LEASE_UNTIL, MEDIA_ID),
    );
    expect(first.state).toHaveProperty(
      `media.${MEDIA_ID}.driveSyncState`,
      "syncing",
    );

    const duplicate = reduceDriveSyncClaim(first.state, lease);
    expect(duplicate).toMatchObject({ status: "claimed", write: false });

    const concurrent = reduceDriveSyncClaim(first.state, {
      ...lease,
      workerId: "worker-2",
      leaseToken: "lease-2",
    });
    expect(concurrent).toEqual({
      status: "busy",
      write: false,
      state: first.state,
    });
  });

  it("respects failed nextAttemptAt and recovers an expired syncing lease", () => {
    const failedState = baseState();
    failedState.driveSyncJobs[MEDIA_ID] = {
      ...failedState.driveSyncJobs[MEDIA_ID],
      status: "failed",
      attemptCount: 2,
      nextAttemptAt: "2026-08-10T03:01:00.000Z",
    };
    expect(reduceDriveSyncClaim(failedState, lease)).toEqual({
      status: "notDue",
      write: false,
      state: failedState,
    });

    const syncingState = baseState();
    syncingState.driveSyncJobs[MEDIA_ID] = {
      ...syncingState.driveSyncJobs[MEDIA_ID],
      status: "syncing",
      attemptCount: 2,
      leaseOwner: "dead-worker",
      leaseToken: "dead-lease",
      leaseUntil: NOW,
    };
    const recovered = reduceDriveSyncClaim(syncingState, lease);
    expect(recovered).toMatchObject({ status: "claimed", write: true });
    expect(recovered.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.attemptCount`,
      3,
    );
    expect(recovered.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.leaseOwner`,
      "worker-1",
    );
  });

  it("atomically cancels excluded media without removing its source record", () => {
    const state = baseState();
    state.media[MEDIA_ID] = {
      ...state.media[MEDIA_ID],
      excludedAt: "2026-08-10T02:30:00.000Z",
      excludedBy: "reviewer-1",
    };

    const result = reduceDriveSyncClaim(state, lease);

    expect(result).toMatchObject({ status: "cancelled", write: true });
    expect(result.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "cancelled",
    );
    expect(result.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
    );
    expect(result.state).toHaveProperty(
      `media.${MEDIA_ID}.driveSyncState`,
      "cancelled",
    );
    expect(result.state).toHaveProperty(
      `media.${MEDIA_ID}.storagePath`,
      STORAGE_PATH,
    );
  });

  it("releases an owned folder lease when exclusion cancels a syncing job", () => {
    const withFolderLease = reduceDriveFolderLeaseClaim(claimedState(), {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }).state;
    withFolderLease.driveUploadSessions = {
      [MEDIA_ID]: { sessionUri: "server-only-session" },
    };
    const media = (withFolderLease.media as Record<
      string,
      Record<string, unknown>
    >)[MEDIA_ID];
    media.excludedAt = "2026-08-10T03:00:01.000Z";
    media.excludedBy = "reviewer-1";

    const cancelled = reduceDriveSyncClaim(withFolderLease, {
      ...lease,
      workerId: "worker-2",
      leaseToken: "lease-2",
      now: "2026-08-10T03:00:02.000Z",
    });

    expect(cancelled).toMatchObject({ status: "cancelled", write: true });
    expect(cancelled.state).not.toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}`,
    );
    expect(cancelled.state).not.toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}`,
    );
  });
});

describe("authoritative Drive sync context", () => {
  it("revalidates exact job/media/building/unit/listing/session bindings", () => {
    expect(validateDriveSyncContext(claimedState(), {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
    })).toMatchObject({
      mediaId: MEDIA_ID,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      captureSessionId: SESSION_ID,
      sessionSequence: 1,
      captureDate: "2026-08-10",
      storagePath: STORAGE_PATH,
      objectGeneration: GENERATION,
    });
  });

  it.each([
    ["storage path", { storagePath: "field-media-finalized/building-1/wrong.jpg" }],
    ["generation", { objectGeneration: "0" }],
    ["upload state", { uploadState: "uploading" }],
    ["session binding", { captureSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  ])("rejects a stale or invalid %s before reading Storage", (_label, mediaOverride) => {
    const state = claimedState();
    state.media[MEDIA_ID] = { ...state.media[MEDIA_ID], ...mediaOverride };
    expect(() => validateDriveSyncContext(state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
    })).toThrow("drive_sync_source_invalid");
  });
});

describe("Drive media upload", () => {
  it("always uses resumable chunks and generation-pinned ranges beyond 8 MiB", async () => {
    const sizeBytes = DRIVE_RESUMABLE_CHUNK_BYTES + 7;
    const unclaimed = baseState();
    unclaimed.media[MEDIA_ID].sizeBytes = sizeBytes;
    const claim = reduceDriveSyncClaim(unclaimed, lease);
    if (claim.status !== "claimed") throw new Error("test_claim_failed");
    const standard = adapters();
    const readFinalizedObjectMetadata = vi.fn(async () => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes,
      mimeType: "image/jpeg",
      md5Hash: "source-md5",
      crc32c: "source-crc",
    }));
    const readFinalizedObjectRange = vi.fn(async ({
      startOffset,
      endOffsetInclusive,
    }: { startOffset: number; endOffsetInclusive: number }) => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes,
      mimeType: "image/jpeg",
      md5Hash: "source-md5",
      crc32c: "source-crc",
      rangeStart: startOffset,
      rangeEndInclusive: endOffsetInclusive,
      body: { startOffset, endOffsetInclusive },
    }));
    const startResumableMediaUpload = vi.fn(async () => ({
      sessionUri:
        "https://www.googleapis.com/upload/drive/v3/files?upload_id=large-safe-id",
      nextOffset: 0 as const,
    }));
    const uploadResumableMediaChunk = vi.fn()
      .mockResolvedValueOnce({
        status: "active" as const,
        nextOffset: DRIVE_RESUMABLE_CHUNK_BYTES,
      })
      .mockResolvedValueOnce({
        status: "complete" as const,
        file: existingDriveFile({
          id: "drive-file-large",
          size: String(sizeBytes),
        }),
      });
    const checkpointUploadSession = vi.fn(async (input) => ({
      ...input,
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const storage = {
      ...standard.storage,
      readFinalizedObjectMetadata,
      readFinalizedObjectRange,
    };
    const drive = {
      ...standard.drive,
      startResumableMediaUpload,
      probeResumableMediaUpload: vi.fn(),
      uploadResumableMediaChunk,
    };

    await expect(syncClaimedDriveMedia(claim.state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }, {
      storage,
      drive,
      checkpointUploadSession,
    })).resolves.toMatchObject({ driveFileId: "drive-file-large" });

    expect(standard.storage.readFinalizedObject).not.toHaveBeenCalled();
    expect(readFinalizedObjectRange.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        startOffset: 0,
        endOffsetInclusive: DRIVE_RESUMABLE_CHUNK_BYTES - 1,
      }),
      expect.objectContaining({
        startOffset: DRIVE_RESUMABLE_CHUNK_BYTES,
        endOffsetInclusive: sizeBytes - 1,
      }),
    ]);
    expect(standard.drive.uploadMediaFile).not.toHaveBeenCalled();
    expect(startResumableMediaUpload).toHaveBeenCalledTimes(1);
    expect(uploadResumableMediaChunk).toHaveBeenCalledTimes(2);
    expect(checkpointUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionUri: expect.stringContaining("upload_id=") }),
    );
  });

  it("uploads with exact generation, parent, name, and idempotency properties and never deletes Firebase source", async () => {
    const state = claimedState();
    const {
      storage,
      drive,
      sourceBody,
      deleteObject,
      checkpointUploadSession,
    } = adapters();

    const result = await syncClaimedDriveMedia(state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }, { storage, drive, checkpointUploadSession });

    expect(storage.readFinalizedObjectMetadata).toHaveBeenCalledWith({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
    });
    expect(drive.startResumableMediaUpload).toHaveBeenCalledWith(expect.objectContaining({
      parentId: "folder-5",
      name: "방 전체.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1_024,
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
    }));
    expect(storage.readFinalizedObjectRange).toHaveBeenCalledWith({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
      startOffset: 0,
      endOffsetInclusive: 1_023,
    });
    expect(drive.uploadResumableMediaChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        totalSizeBytes: 1_024,
        startOffset: 0,
        endOffsetInclusive: 1_023,
        body: sourceBody,
      }),
    );
    expect(drive.uploadMediaFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mediaId: MEDIA_ID,
      objectGeneration: GENERATION,
      driveFileId: "drive-file-1",
      driveFileName: "방 전체.jpg",
      folderIds: {
        root: "root-1",
        originalPhotos: "folder-5",
      },
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("uses an exact escaped appProperties query", () => {
    expect(buildExactDriveFileQuery("folder-5", MEDIA_ID, GENERATION)).toBe(
      "'folder-5' in parents and trashed = false "
      + `and appProperties has { key = 'bringMediaId' and value = '${MEDIA_ID}' } `
      + `and appProperties has { key = 'bringObjectGeneration' and value = '${GENERATION}' }`,
    );
  });

  it("reuses a checksum-matching file after an upload ACK is lost", async () => {
    const state = claimedState();
    const existing = existingDriveFile();
    const { storage, drive, checkpointUploadSession } = adapters({
      uploadError: new Error("network response contained oauth-token-value"),
      filesAfterUploadError: [existing],
    });

    const result = await syncClaimedDriveMedia(state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }, { storage, drive, checkpointUploadSession });

    expect(result.driveFileId).toBe("drive-file-existing");
    expect(drive.listExactMediaFiles).toHaveBeenCalledTimes(2);
  });

  it("fails safely on duplicate or checksum-mismatched idempotency matches", async () => {
    const state = claimedState();
    const duplicateAdapters = adapters({
      existingFiles: [existingDriveFile(), existingDriveFile({ id: "drive-file-2" })],
    });
    await expect(syncClaimedDriveMedia(state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }, duplicateAdapters)).rejects.toThrow("drive_file_duplicate");

    const mismatchAdapters = adapters({
      existingFiles: [existingDriveFile({ md5Checksum: "wrong" })],
    });
    await expect(syncClaimedDriveMedia(state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }, mismatchAdapters)).rejects.toThrow("drive_file_checksum_mismatch");
  });

  it("rejects a Storage generation change before any Drive request", async () => {
    const state = claimedState();
    const { storage, drive, checkpointUploadSession } = adapters();
    vi.mocked(storage.readFinalizedObjectMetadata).mockResolvedValueOnce({
      path: STORAGE_PATH,
      generation: "1740000000000002",
      sizeBytes: 1_024,
      mimeType: "image/jpeg",
      md5Hash: "source-md5",
      crc32c: "source-crc",
    });

    await expect(syncClaimedDriveMedia(state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }, { storage, drive, checkpointUploadSession })).rejects.toThrow(
      "drive_source_invalid",
    );
    expect(drive.listExactFolders).not.toHaveBeenCalled();
    expect(drive.uploadMediaFile).not.toHaveBeenCalled();
  });
});

describe("Drive sync commit reducers", () => {
  const successInput = {
    mediaId: MEDIA_ID,
    workerId: "worker-1",
    leaseToken: "lease-1",
    objectGeneration: GENERATION,
    driveFileId: "drive-file-1",
    driveFileName: "방 전체.jpg",
    folderIds: {
      root: "root-1",
      building: "folder-1",
      unit: "folder-2",
      session: "folder-3",
      representativePhotos: "folder-4",
      originalPhotos: "folder-5",
      verticalVideos: "folder-6",
    },
    completedAt: NOW,
  };

  it("atomically completes both job and media and is idempotent after ACK loss", () => {
    const claimed = claimedState();
    claimed.driveUploadSessions = {
      [MEDIA_ID]: { sessionUri: "server-only-session" },
    };
    (claimed as Record<string, unknown>).driveSyncAlerts = {
      [MEDIA_ID]: {
        mediaId: MEDIA_ID,
        status: "open",
        code: "drive_oauth_config_invalid",
      },
    };
    const first = reduceDriveSyncSuccess(claimed, successInput);

    expect(first).toMatchObject({ status: "committed", write: true });
    expect(first.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.driveFileId`,
      "drive-file-1",
    );
    expect(first.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.folderIds.originalPhotos`,
      "folder-5",
    );
    expect(first.state).toHaveProperty(
      `media.${MEDIA_ID}.driveSyncState`,
      "complete",
    );
    expect(first.state).toHaveProperty(
      `media.${MEDIA_ID}.driveFileId`,
      "drive-file-1",
    );
    expect(first.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
    );
    expect(first.state).not.toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}`,
    );
    expect(first.state).not.toHaveProperty(`driveSyncAlerts.${MEDIA_ID}`);

    expect(reduceDriveSyncSuccess(first.state, {
      ...successInput,
      completedAt: "2026-08-10T03:00:01.000Z",
    })).toEqual({
      status: "alreadyCommitted",
      write: false,
      state: first.state,
    });
  });

  it("rejects a stale lease owner or changed source generation", () => {
    const claimed = claimedState();
    expect(reduceDriveSyncSuccess(claimed, {
      ...successInput,
      workerId: "worker-2",
    })).toEqual({ status: "staleLease", write: false, state: claimed });

    const changed = structuredClone(claimed);
    changed.media[MEDIA_ID].objectGeneration = "1740000000000002";
    expect(reduceDriveSyncSuccess(changed, successInput)).toEqual({
      status: "staleSource",
      write: false,
      state: changed,
    });
  });

  it("stores only a bounded safe failure code with exponential backoff", () => {
    const claimed = claimedState();
    claimed.driveUploadSessions = {
      [MEDIA_ID]: { sessionUri: "server-only-session" },
    };
    const secret = "oauth-refresh-token-should-not-persist";

    const failed = reduceDriveSyncFailure(claimed, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      failedAt: NOW,
      error: new Error(`socket failed: ${secret}`),
    });

    expect(failed).toMatchObject({ status: "failed", write: true });
    expect(failed.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_sync_failed",
    );
    expect(failed.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.nextAttemptAt`,
      "2026-08-10T03:00:30.000Z",
    );
    expect(failed.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
      buildDriveRecoveryKey(
        "failed",
        "2026-08-10T03:00:30.000Z",
        MEDIA_ID,
      ),
    );
    expect(JSON.stringify(failed.state)).not.toContain(secret);
    expect(failed.state).toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}.sessionUri`,
      "server-only-session",
    );
  });

  it("clears only an expired resumable session before retrying", () => {
    const claimed = claimedState();
    claimed.driveUploadSessions = {
      [MEDIA_ID]: { sessionUri: "expired-server-only-session" },
    };

    const failed = reduceDriveSyncFailure(claimed, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      failedAt: NOW,
      error: new Error("drive_upload_session_expired"),
    });

    expect(failed).toMatchObject({ status: "failed", write: true });
    expect(failed.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_upload_session_expired",
    );
    expect(failed.state).not.toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}`,
    );
  });

  it("keeps root access failures recoverable and allowlists resumable codes", () => {
    for (const code of [
      "drive_oauth_token_failed",
      "drive_upload_session_expired",
      "drive_upload_request_invalid",
      "drive_upload_state_invalid",
    ]) {
      expect(safeDriveFailureCode(new Error(code))).toBe(code);
    }

    const failed = reduceDriveSyncFailure(claimedState(), {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      failedAt: NOW,
      error: new Error("drive_root_folder_invalid"),
      terminal: true,
    });
    expect(failed).toMatchObject({ status: "failed", write: true });
    expect(failed.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_root_folder_invalid",
    );
  });

  it("rejects a failure commit after its lease expired", () => {
    const claimed = claimedState();
    const job = (claimed.driveSyncJobs as Record<string, Record<string, unknown>>)[
      MEDIA_ID
    ];
    job.leaseUntil = NOW;

    expect(reduceDriveSyncFailure(claimed, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      failedAt: NOW,
      error: new Error("drive_upload_failed"),
    })).toEqual({ status: "staleLease", write: false, state: claimed });
  });

  it("commits allowlisted terminal failures without a due or lease key", () => {
    const claimed = claimedState();
    claimed.driveUploadSessions = {
      [MEDIA_ID]: { sessionUri: "server-only-session" },
    };

    const terminal = reduceDriveSyncFailure(claimed, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      failedAt: NOW,
      error: new Error("drive_source_invalid"),
      terminal: true,
    });

    expect(terminal).toMatchObject({ status: "terminal", write: true });
    expect(terminal.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "terminal",
    );
    expect(terminal.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_source_invalid",
    );
    expect(terminal.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.nextAttemptAt`,
    );
    expect(terminal.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.leaseUntil`,
    );
    expect(terminal.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
    );
    expect(terminal.state).not.toHaveProperty(
      `driveUploadSessions.${MEDIA_ID}`,
    );
    expect(reduceDriveSyncClaim(terminal.state, lease)).toMatchObject({
      status: "terminal",
      write: false,
    });
    expect(reduceDriveSyncFailure(terminal.state, {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      failedAt: NOW,
      error: new Error("drive_source_invalid"),
      terminal: true,
    })).toMatchObject({
      status: "alreadyTerminal",
      write: false,
    });
  });

  it("turns an exclusion discovered at success commit into cancellation", () => {
    const claimed = reduceDriveFolderLeaseClaim(claimedState(), {
      mediaId: MEDIA_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      now: NOW,
      rootFolderId: "root-1",
    }).state;
    const media = (claimed.media as Record<string, Record<string, unknown>>)[
      MEDIA_ID
    ];
    media.excludedAt = "2026-08-10T02:59:00.000Z";
    media.excludedBy = "reviewer-1";

    const result = reduceDriveSyncSuccess(claimed, successInput);

    expect(result).toMatchObject({ status: "cancelled", write: true });
    expect(result.state).toHaveProperty(
      `media.${MEDIA_ID}.storagePath`,
      STORAGE_PATH,
    );
    expect(result.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "cancelled",
    );
    expect(result.state).not.toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}`,
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { DRIVE_FOLDER_MIME_TYPE } from "../src/drive/folders.js";
import { buildDriveRecoveryKey } from "../src/drive/recovery-key.js";
import {
  RECOVERY_BATCH_LIMIT,
  RECOVERY_SCAN_LIMIT,
  DriveSyncRetryableError,
  collectDueRecoveryMediaIds,
  processDriveSyncJob,
  runDriveSyncRecovery,
  selectFairRecoveryMediaIds,
  type DriveSyncRuntimeDatabase,
  type DriveSyncRuntimeDependencies,
} from "../src/drive/runtime.js";
import type { DriveMediaAdapter } from "../src/drive/sync-media.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const GENERATION = "1740000000000001";
const STORAGE_PATH = `field-media-finalized/building-1/${MEDIA_ID}.jpg`;
const NOW = "2026-08-10T03:00:00.000Z";
const SOURCE_MD5_BASE64 = "XUFAKrxLKna5cZ2REBfFkg==";
const SOURCE_MD5_HEX = "5d41402abc4b2a76b9719d911017c592";

function baseState() {
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
        sizeBytes: 5,
        originalFileName: "room.jpg",
        capturedAt: "2026-08-10T02:01:00.000Z",
        storagePath: STORAGE_PATH,
        objectGeneration: GENERATION,
        objectMd5Hash: SOURCE_MD5_BASE64,
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
  };
}

function twoMediaSameSessionState() {
  const state = structuredClone(baseState()) as Record<string, any>;
  const secondPath =
    `field-media-finalized/building-1/${SECOND_MEDIA_ID}.jpg`;
  state.media[SECOND_MEDIA_ID] = {
    ...state.media[MEDIA_ID],
    id: SECOND_MEDIA_ID,
    storagePath: secondPath,
    originalFileName: "room-2.jpg",
    capturedAt: "2026-08-10T02:02:00.000Z",
  };
  state.driveSyncJobs[SECOND_MEDIA_ID] = {
    ...state.driveSyncJobs[MEDIA_ID],
    id: SECOND_MEDIA_ID,
    mediaId: SECOND_MEDIA_ID,
    storagePath: secondPath,
    recoveryKey: buildDriveRecoveryKey(
      "queued",
      "2026-08-10T02:02:01.000Z",
      SECOND_MEDIA_ID,
    ),
    createdAt: "2026-08-10T02:02:01.000Z",
    updatedAt: "2026-08-10T02:02:01.000Z",
  };
  return state;
}

function rootDatabase(initial = baseState()) {
  const database: DriveSyncRuntimeDatabase & {
    state: unknown;
    transactionRoot: ReturnType<typeof vi.fn>;
    listRecoveryJobs: ReturnType<typeof vi.fn>;
  } = {
    state: structuredClone(initial),
    transactionRoot: vi.fn(async (update: (current: unknown) => unknown) => {
      const next = update(database.state);
      const committed = next !== undefined;
      if (committed) database.state = next;
      return { committed, state: database.state };
    }),
    listRecoveryJobs: vi.fn(async () => []),
  };
  return database;
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

function driveAdapter() {
  const folders = new Map<string, string>();
  let pendingUpload: Parameters<
    DriveMediaAdapter["startResumableMediaUpload"]
  >[0] | undefined;
  let sequence = 1;
  const key = (parentId: string, name: string) => `${parentId}\n${name}`;
  const adapter: DriveMediaAdapter = {
    listExactFolders: vi.fn(async ({ parentId, name }) => {
      const id = folders.get(key(parentId, name));
      return id ? [folder(id, name, parentId)] : [];
    }),
    createFolder: vi.fn(async ({ parentId, name }) => {
      const id = `folder-${sequence++}`;
      folders.set(key(parentId, name), id);
      return folder(id, name, parentId);
    }),
    listExactMediaFiles: vi.fn(async () => []),
    uploadMediaFile: vi.fn(async ({ parentId, name, mimeType, appProperties }) => ({
      id: "drive-file-1",
      name,
      mimeType,
      parents: [parentId],
      trashed: false,
      size: "5",
      md5Checksum: SOURCE_MD5_HEX,
      appProperties,
    })),
    startResumableMediaUpload: vi.fn(async (input) => {
      pendingUpload = input;
      return {
        sessionUri:
          "https://www.googleapis.com/upload/drive/v3/files?upload_id=test-safe-id",
        nextOffset: 0 as const,
      };
    }),
    probeResumableMediaUpload: vi.fn(async () => ({
      status: "active" as const,
      nextOffset: 0,
    })),
    uploadResumableMediaChunk: vi.fn(async () => {
      if (pendingUpload === undefined) throw new Error("missing test upload");
      return {
        status: "complete" as const,
        file: {
          id: "drive-file-1",
          name: pendingUpload.name,
          mimeType: pendingUpload.mimeType,
          parents: [pendingUpload.parentId],
          trashed: false,
          size: String(pendingUpload.sizeBytes),
          md5Checksum: SOURCE_MD5_HEX,
          appProperties: pendingUpload.appProperties,
        },
      };
    }),
  };
  return adapter;
}

function runtimeDependencies(
  database = rootDatabase(),
  overrides: Partial<DriveSyncRuntimeDependencies> = {},
) {
  let randomSequence = 0;
  const storage = {
    readFinalizedObject: vi.fn(async () => ({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 5,
      mimeType: "image/jpeg",
      md5Hash: SOURCE_MD5_HEX,
      body: { opaque: "stream" },
    })),
    readFinalizedObjectMetadata: vi.fn(async ({
      path,
      expectedGeneration,
    }) => ({
      path,
      generation: expectedGeneration,
      sizeBytes: 5,
      mimeType: "image/jpeg",
      md5Hash: SOURCE_MD5_HEX,
    })),
    readFinalizedObjectRange: vi.fn(async ({
      path,
      expectedGeneration,
      startOffset,
      endOffsetInclusive,
    }) => ({
      path,
      generation: expectedGeneration,
      sizeBytes: 5,
      mimeType: "image/jpeg",
      md5Hash: SOURCE_MD5_HEX,
      rangeStart: startOffset,
      rangeEndInclusive: endOffsetInclusive,
      body: { opaque: "stream" },
    })),
  };
  return {
    database,
    storage,
    drive: driveAdapter(),
    rootFolderId: "root-1",
    now: () => NOW,
    randomToken: () => `token-${++randomSequence}`,
    ...overrides,
  } satisfies DriveSyncRuntimeDependencies;
}

describe("Drive sync runtime transaction fencing", () => {
  it("uses three root transactions for first folder resolution", async () => {
    const database = rootDatabase();
    const dependencies = runtimeDependencies(database);
    vi.mocked(dependencies.drive.listExactMediaFiles).mockImplementation(
      async ({ parentId, mediaId, objectGeneration }) => [{
        id: "drive-file-existing",
        name: "room.jpg",
        mimeType: "image/jpeg",
        parents: [parentId],
        trashed: false,
        size: "5",
        md5Checksum: SOURCE_MD5_HEX,
        appProperties: {
          bringMediaId: mediaId,
          bringObjectGeneration: objectGeneration,
        },
      }],
    );

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "complete",
    );

    expect(database.transactionRoot).toHaveBeenCalledTimes(3);
    expect(database.state).toHaveProperty(
      `driveFolderCaches.building-1.${SESSION_ID}.folderIds.root`,
      "root-1",
    );
    expect(database.state).not.toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}`,
    );
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "complete",
    );
    expect(database.state).toHaveProperty(
      `media.${MEDIA_ID}.driveSyncState`,
      "complete",
    );
    expect(database.state).toHaveProperty(
      `media.${MEDIA_ID}.objectMd5Hash`,
      SOURCE_MD5_BASE64,
    );
  });

  it("lets only one concurrent delivery upload and leaves the other fenced", async () => {
    const database = rootDatabase();
    let releaseStorage: (() => void) | undefined;
    const storageGate = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    const dependencies = runtimeDependencies(database);
    vi.mocked(dependencies.storage.readFinalizedObjectMetadata).mockImplementation(
      async () => {
        await storageGate;
        return {
          path: STORAGE_PATH,
          generation: GENERATION,
          sizeBytes: 5,
          mimeType: "image/jpeg",
          md5Hash: SOURCE_MD5_HEX,
        };
      },
    );

    const first = processDriveSyncJob(MEDIA_ID, dependencies);
    await vi.waitFor(() => {
      expect(database.state).toHaveProperty(
        `driveSyncJobs.${MEDIA_ID}.status`,
        "syncing",
      );
    });
    const duplicate = processDriveSyncJob(MEDIA_ID, dependencies);
    releaseStorage?.();

    await expect(Promise.all([first, duplicate])).resolves.toEqual(
      expect.arrayContaining(["complete", "busy"]),
    );
    expect(dependencies.storage.readFinalizedObjectMetadata).toHaveBeenCalledTimes(1);
    expect(dependencies.drive.startResumableMediaUpload).toHaveBeenCalledTimes(1);
  });

  it("serializes first folder creation and reuses one canonical cache", async () => {
    const database = rootDatabase(twoMediaSameSessionState());
    const dependencies = runtimeDependencies(database);
    let releaseFirstList: (() => void) | undefined;
    const firstListGate = new Promise<void>((resolve) => {
      releaseFirstList = resolve;
    });
    let heldFirstList = false;
    const originalList = vi.mocked(dependencies.drive.listExactFolders)
      .getMockImplementation();
    if (originalList === undefined) throw new Error("missing test adapter");
    vi.mocked(dependencies.drive.listExactFolders).mockImplementation(
      async (input) => {
        if (!heldFirstList) {
          heldFirstList = true;
          await firstListGate;
        }
        return originalList(input);
      },
    );
    vi.mocked(dependencies.storage.readFinalizedObjectMetadata).mockImplementation(
      async ({ path, expectedGeneration }) => ({
        path,
        generation: expectedGeneration,
        sizeBytes: 5,
        mimeType: "image/jpeg",
        md5Hash: SOURCE_MD5_HEX,
      }),
    );
    vi.mocked(dependencies.drive.listExactMediaFiles).mockImplementation(
      async ({ parentId, mediaId, objectGeneration }) => [{
        id: mediaId === MEDIA_ID ? "drive-file-1" : "drive-file-2",
        name: mediaId === MEDIA_ID ? "room.jpg" : "room-2.jpg",
        mimeType: "image/jpeg",
        parents: [parentId],
        trashed: false,
        size: "5",
        md5Checksum: SOURCE_MD5_HEX,
        appProperties: {
          bringMediaId: mediaId,
          bringObjectGeneration: objectGeneration,
        },
      }],
    );

    const first = processDriveSyncJob(MEDIA_ID, dependencies);
    await vi.waitFor(() => {
      expect(dependencies.drive.listExactFolders).toHaveBeenCalledTimes(1);
    });
    await expect(processDriveSyncJob(SECOND_MEDIA_ID, dependencies)).resolves
      .toBe("busy");
    expect(dependencies.drive.listExactFolders).toHaveBeenCalledTimes(1);

    releaseFirstList?.();
    await expect(first).resolves.toBe("complete");
    const folderListCalls = vi.mocked(dependencies.drive.listExactFolders).mock
      .calls.length;
    const transactionsBeforeCachedJob = database.transactionRoot.mock.calls
      .length;

    await expect(processDriveSyncJob(SECOND_MEDIA_ID, dependencies)).resolves
      .toBe("complete");
    expect(
      database.transactionRoot.mock.calls.length - transactionsBeforeCachedJob,
    ).toBe(2);
    expect(dependencies.drive.listExactFolders).toHaveBeenCalledTimes(
      folderListCalls,
    );
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.folderIds`,
      (database.state as Record<string, any>).driveSyncJobs[SECOND_MEDIA_ID]
        .folderIds,
    );

    const mediaListCalls = vi.mocked(dependencies.drive.listExactMediaFiles).mock.calls
      .length;
    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "alreadyComplete",
    );
    expect(dependencies.drive.listExactMediaFiles).toHaveBeenCalledTimes(
      mediaListCalls,
    );
  });

  it("cancels excluded media in the claim transaction without upload", async () => {
    const state = baseState();
    state.media[MEDIA_ID] = {
      ...state.media[MEDIA_ID],
      excludedAt: "2026-08-10T02:30:00.000Z",
      excludedBy: "reviewer-1",
    };
    const database = rootDatabase(state);
    const dependencies = runtimeDependencies(database);

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "cancelled",
    );
    expect(database.transactionRoot).toHaveBeenCalledTimes(1);
    expect(dependencies.storage.readFinalizedObjectMetadata).not.toHaveBeenCalled();
    expect(dependencies.drive.startResumableMediaUpload).not.toHaveBeenCalled();
    expect(database.state).toHaveProperty(
      `media.${MEDIA_ID}.storagePath`,
      STORAGE_PATH,
    );
  });

  it("commits a safe failed state before throwing a retryable error", async () => {
    const database = rootDatabase();
    const leaked = "oauth-refresh-token-value";
    const dependencies = runtimeDependencies(database);
    vi.mocked(dependencies.storage.readFinalizedObjectMetadata).mockRejectedValueOnce(
      new Error(`network error ${leaked}`),
    );

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).rejects.toBeInstanceOf(
      DriveSyncRetryableError,
    );
    expect(database.transactionRoot).toHaveBeenCalledTimes(2);
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "failed",
    );
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_sync_failed",
    );
    expect(database.state).not.toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}`,
    );
    expect(JSON.stringify(database.state)).not.toContain(leaked);
  });

  it("recovers the same failed job after OAuth configuration is corrected", async () => {
    const database = rootDatabase();
    let configured = false;
    let now = NOW;
    const dependencies = runtimeDependencies(database, { now: () => now });
    Object.defineProperty(dependencies, "rootFolderId", {
      configurable: true,
      get() {
        if (!configured) throw new Error("drive_oauth_config_invalid");
        return "root-1";
      },
    });

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).rejects
      .toBeInstanceOf(DriveSyncRetryableError);
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_oauth_config_invalid",
    );
    expect(database.state).toHaveProperty(
      `driveSyncAlerts.${MEDIA_ID}.status`,
      "open",
    );

    configured = true;
    now = "2026-08-10T03:00:31.000Z";
    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "complete",
    );
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "complete",
    );
    expect(database.state).not.toHaveProperty(`driveSyncAlerts.${MEDIA_ID}`);
  });

  it("swallows terminal source failures only after fenced failure persistence", async () => {
    const database = rootDatabase();
    const dependencies = runtimeDependencies(database);
    vi.mocked(dependencies.storage.readFinalizedObjectMetadata).mockRejectedValueOnce(
      new Error("drive_source_invalid"),
    );

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "terminalFailure",
    );
    expect(database.transactionRoot).toHaveBeenCalledTimes(2);
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "terminal",
    );
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.lastErrorCode`,
      "drive_source_invalid",
    );
    expect(database.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
    );
  });

  it("recognizes an identical terminal failure after transaction ACK loss", async () => {
    const database = rootDatabase();
    let transactionNumber = 0;
    database.transactionRoot.mockImplementation(async (update) => {
      transactionNumber += 1;
      const next = update(database.state);
      const committed = next !== undefined;
      if (committed) database.state = next;
      return {
        committed: transactionNumber === 2 ? false : committed,
        state: database.state,
      };
    });
    const dependencies = runtimeDependencies(database);
    vi.mocked(dependencies.storage.readFinalizedObjectMetadata).mockRejectedValueOnce(
      new Error("drive_source_invalid"),
    );

    await expect(processDriveSyncJob(MEDIA_ID, dependencies)).resolves.toBe(
      "terminalFailure",
    );
    expect(database.state).toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.status`,
      "terminal",
    );
    expect(database.state).not.toHaveProperty(
      `driveSyncJobs.${MEDIA_ID}.recoveryKey`,
    );
  });
});

describe("bounded Drive sync recovery", () => {
  it("selects only queued, due failed, and expired syncing records up to the cap", () => {
    const records = [
      {
        id: MEDIA_ID,
        value: {
          mediaId: MEDIA_ID,
          status: "queued",
          createdAt: "2026-08-10T02:01:01.000Z",
          recoveryKey: buildDriveRecoveryKey(
            "queued",
            "2026-08-10T02:01:01.000Z",
            MEDIA_ID,
          ),
        },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        value: {
          mediaId: "44444444-4444-4444-8444-444444444444",
          status: "failed",
          nextAttemptAt: NOW,
          lastErrorCode: "drive_upload_failed",
          recoveryKey: buildDriveRecoveryKey(
            "failed",
            NOW,
            "44444444-4444-4444-8444-444444444444",
          ),
        },
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        value: {
          mediaId: "55555555-5555-4555-8555-555555555555",
          status: "failed",
          nextAttemptAt: "2026-08-10T03:01:00.000Z",
          recoveryKey: buildDriveRecoveryKey(
            "failed",
            "2026-08-10T03:01:00.000Z",
            "55555555-5555-4555-8555-555555555555",
          ),
        },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        value: {
          mediaId: "66666666-6666-4666-8666-666666666666",
          status: "syncing",
          leaseUntil: NOW,
          recoveryKey: buildDriveRecoveryKey(
            "syncing",
            NOW,
            "66666666-6666-4666-8666-666666666666",
          ),
        },
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        value: {
          mediaId: "77777777-7777-4777-8777-777777777777",
          status: "terminal",
          lastErrorCode: "drive_source_invalid",
        },
      },
    ];

    expect(collectDueRecoveryMediaIds(records, NOW, 3)).toEqual([
      MEDIA_ID,
      "44444444-4444-4444-8444-444444444444",
      "66666666-6666-4666-8666-666666666666",
    ]);
  });

  it("performs three bounded status scans and never processes over the batch cap", async () => {
    const database = rootDatabase();
    const queued = Array.from({ length: RECOVERY_SCAN_LIMIT }, (_, index) => {
      const suffix = String(index + 1).padStart(12, "0");
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
      return {
        id,
        value: {
          mediaId: id,
          status: "queued",
          createdAt: NOW,
          recoveryKey: buildDriveRecoveryKey("queued", NOW, id),
        },
      };
    });
    database.listRecoveryJobs.mockResolvedValue(queued);
    const dependencies = runtimeDependencies(database);

    const result = await runDriveSyncRecovery(dependencies);

    expect(database.listRecoveryJobs.mock.calls).toEqual([
      [{ kind: "queued", limit: RECOVERY_SCAN_LIMIT }],
      [{ kind: "failedDue", dueAtOrBefore: NOW, limit: RECOVERY_SCAN_LIMIT }],
      [{ kind: "expiredLease", dueAtOrBefore: NOW, limit: RECOVERY_SCAN_LIMIT }],
    ]);
    expect(result.selected).toBeLessThanOrEqual(RECOVERY_BATCH_LIMIT);
    expect(database.transactionRoot.mock.calls.length).toBeLessThanOrEqual(
      RECOVERY_BATCH_LIMIT,
    );
  });

  it("round-robins queued, failed, and expired pages so each gets quota", () => {
    function records(
      prefix: string,
      status: "queued" | "failed" | "syncing",
    ) {
      return Array.from({ length: 20 }, (_, index) => {
        const id = `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${
          prefix.repeat(3)
        }-${String(index + 1).padStart(12, prefix)}`;
        const at = status === "queued" ? "2026-08-10T02:00:00.000Z" : NOW;
        return {
          id,
          value: {
            mediaId: id,
            status,
            ...(status === "queued" ? { createdAt: at } : {}),
            ...(status === "failed" ? { nextAttemptAt: at } : {}),
            ...(status === "syncing" ? { leaseUntil: at } : {}),
            recoveryKey: buildDriveRecoveryKey(status, at, id),
          },
        };
      });
    }

    const selected = selectFairRecoveryMediaIds({
      queued: records("a", "queued"),
      failedDue: records("b", "failed"),
      expiredLease: records("c", "syncing"),
    }, NOW, RECOVERY_BATCH_LIMIT);

    expect(selected).toHaveLength(RECOVERY_BATCH_LIMIT);
    expect(selected.filter((id) => id.startsWith("aaaaaaaa"))).toHaveLength(8);
    expect(selected.filter((id) => id.startsWith("bbbbbbbb"))).toHaveLength(8);
    expect(selected.filter((id) => id.startsWith("cccccccc"))).toHaveLength(8);
  });

  it("skips malformed dates and twenty terminal rows while selecting later valid work", () => {
    const validId = "99999999-9999-4999-8999-999999999999";
    const malformedId = "88888888-8888-4888-8888-888888888888";
    const page = [
      ...Array.from({ length: 20 }, (_, index) => {
        const id = `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`;
        return {
          id,
          value: {
            mediaId: id,
            status: "terminal",
            lastErrorCode: "drive_source_invalid",
          },
        };
      }),
      {
        id: malformedId,
        value: {
          mediaId: malformedId,
          status: "failed",
          nextAttemptAt: "2026-99-99T03:00:00.000Z",
          recoveryKey: `failed|2026-99-99T03:00:00.000Z|${malformedId}`,
        },
      },
      {
        id: validId,
        value: {
          mediaId: validId,
          status: "failed",
          nextAttemptAt: NOW,
          recoveryKey: buildDriveRecoveryKey("failed", NOW, validId),
        },
      },
    ];

    expect(() => collectDueRecoveryMediaIds(page, NOW, 4)).not.toThrow();
    expect(collectDueRecoveryMediaIds(page, NOW, 4)).toEqual([validId]);
  });
});

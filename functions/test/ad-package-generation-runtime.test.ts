import { describe, expect, it, vi } from "vitest";

import { DRIVE_FOLDER_MIME_TYPE } from "../src/drive/folders.js";
import {
  createGoogleDriveMediaAdapter,
  type GoogleDriveClientLike,
} from "../src/drive/google-drive-adapter.js";
import type { AdPackageDriveAdapter } from "../src/packages/generate-ad-package.js";
import {
  AdPackageGenerationRetryableError,
  collectDueAdPackageRecoveryIds,
  processAdPackageGeneration,
  runAdPackageGenerationRecovery,
  selectFairAdPackageRecoveryIds,
  type AdPackageGenerationRuntimeDatabase,
  type AdPackageGenerationRuntimeDependencies,
  type AdPackageRecoveryPages,
} from "../src/packages/generation-runtime.js";
import {
  buildAdPackageRecoveryKey,
} from "../src/packages/generation-recovery-key.js";
import {
  PACKAGE_ID,
  STORAGE_MD5_BASE64,
  makeFrozenPackage,
} from "./helpers/ad-package-fixture.js";

const REVIEWED_AT = "2026-08-10T03:00:00.000Z";
const FIRST_FAILURE_DUE = "2026-08-10T03:00:31.000Z";

type UnknownRecord = Record<string, any>;

function sourceRoot(state: "complete" | "pending" | "terminal" = "complete") {
  const pkg = makeFrozenPackage();
  pkg.createdAt = REVIEWED_AT;
  pkg.generation.updatedAt = REVIEWED_AT;
  pkg.generation.recoveryKey = buildAdPackageRecoveryKey(
    "reviewed",
    REVIEWED_AT,
    PACKAGE_ID,
  );
  const manifests = pkg.mediaManifest as UnknownRecord[];
  const media = Object.fromEntries(manifests.map((item, index) => [item.id, {
    ...item,
    objectMd5Hash: STORAGE_MD5_BASE64,
    uploadState: "finalized",
    driveSyncState: state === "complete" ? "complete" : state === "pending" ? "queued" : "cancelled",
    ...(state === "complete" ? { driveFileId: `source-file-${index + 1}` } : {}),
    ...(state === "terminal" ? {
      excludedAt: "2026-08-10T03:00:01.000Z",
      excludedBy: "reviewer-1",
    } : {}),
  }]));
  const driveSyncJobs = Object.fromEntries(manifests.map((item, index) => [item.id, {
    id: item.id,
    mediaId: item.id,
    buildingId: item.buildingId,
    storagePath: item.storagePath,
    objectGeneration: item.objectGeneration,
    status: state === "complete" ? "complete" : state === "pending" ? "queued" : "cancelled",
    attemptCount: 0,
    createdAt: REVIEWED_AT,
    updatedAt: REVIEWED_AT,
    ...(state === "complete" ? {
      driveFileId: `source-file-${index + 1}`,
      folderIds: {
        root: "root-1",
        building: "building-folder-1",
        unit: "unit-folder-1",
        session: "session-folder-1",
        representativePhotos: "source-representative-1",
        originalPhotos: "source-original-1",
        verticalVideos: "source-video-1",
      },
    } : {}),
  }]));
  return {
    adPackages: { [PACKAGE_ID]: pkg },
    media,
    driveSyncJobs,
    auditLogs: {},
  };
}

class MemoryDatabase implements AdPackageGenerationRuntimeDatabase {
  transactionCount = 0;
  recoveryQueries: Array<Record<string, unknown>> = [];
  recoveryPages: AdPackageRecoveryPages = {
    reviewed: [],
    failedDue: [],
    expiredLease: [],
  };

  constructor(public state: unknown) {}

  async transactionRoot(update: (current: unknown) => unknown | undefined) {
    this.transactionCount += 1;
    const next = update(this.state);
    if (next === undefined) return { committed: false, state: this.state };
    this.state = next;
    return { committed: true, state: this.state };
  }

  async listRecoveryPackages(input: {
    kind: keyof AdPackageRecoveryPages;
    dueAtOrBefore: string;
    limit: number;
  }) {
    this.recoveryQueries.push(input);
    return this.recoveryPages[input.kind];
  }
}

function driveAdapter(options: { onFirstCopy?: () => void } = {}) {
  const folders = new Map<string, string>();
  const files = new Map<string, UnknownRecord>();
  let folderSequence = 0;
  let fileSequence = 0;
  let copied = false;
  const folderKey = (parentId: string, name: string) => `${parentId}\n${name}`;
  const fileKey = (properties: UnknownRecord) => [
    properties.bringPackageId,
    properties.bringPackageVersion,
    properties.bringArtifactKey,
    properties.bringSourceId,
    properties.bringSourceGeneration,
  ].join("\n");
  const exactFile = (input: UnknownRecord, id: string) => ({
    id,
    name: input.name,
    mimeType: input.mimeType,
    parents: [input.parentId],
    trashed: false,
    size: String(input.sizeBytes ?? input.bytes.byteLength),
    md5Checksum: input.md5Checksum,
    appProperties: { ...input.appProperties },
  });
  const adapter: AdPackageDriveAdapter = {
    listExactFolders: vi.fn(async ({ parentId, name }) => {
      const id = folders.get(folderKey(parentId, name));
      return id ? [{
        id,
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        trashed: false,
      }] : [];
    }),
    createFolder: vi.fn(async ({ parentId, name }) => {
      const id = `folder-${++folderSequence}`;
      folders.set(folderKey(parentId, name), id);
      return {
        id,
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        trashed: false,
      };
    }),
    listExactArtifactFiles: vi.fn(async ({ appProperties }) => {
      const found = files.get(fileKey(appProperties));
      return found ? [found] : [];
    }),
    copyExistingFile: vi.fn(async (input) => {
      if (!copied) {
        copied = true;
        options.onFirstCopy?.();
      }
      const file = exactFile(input, `file-${++fileSequence}`);
      files.set(fileKey(input.appProperties), file);
      return file;
    }),
    uploadUtf8File: vi.fn(async (input) => {
      const file = exactFile(input, `file-${++fileSequence}`);
      files.set(fileKey(input.appProperties), file);
      return file;
    }),
  };
  return adapter;
}

function dependencies(
  database: MemoryDatabase,
  adapter: AdPackageDriveAdapter,
  clock: { value: string } = { value: REVIEWED_AT },
): AdPackageGenerationRuntimeDependencies {
  let token = 0;
  return {
    database,
    resolveDrive: async () => adapter,
    now: () => clock.value,
    randomToken: () => `runtime-${++token}`,
  };
}

describe("ad package generation runtime", () => {
  it("claims and commits success with exactly two fenced root transactions", async () => {
    const database = new MemoryDatabase(sourceRoot());
    const adapter = driveAdapter();
    const clock = { value: "2026-08-10T03:00:01.000Z" };

    await expect(processAdPackageGeneration(
      PACKAGE_ID,
      dependencies(database, adapter, clock),
    )).resolves.toBe("complete");

    expect(database.transactionCount).toBe(2);
    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID]).toMatchObject({
      status: "complete",
      generatedAt: clock.value,
      generation: { status: "complete" },
      driveFolderIds: { package: expect.any(String) },
      artifactFileIds: { "daangn-text": expect.any(String) },
    });
    expect((database.state as UnknownRecord).auditLogs)
      .toHaveProperty(`ad-package-generated-${PACKAGE_ID}-1`);
  });

  it("treats a duplicate trigger as an idempotent terminal replay", async () => {
    const database = new MemoryDatabase(sourceRoot());
    const adapter = driveAdapter();
    const deps = dependencies(database, adapter, {
      value: "2026-08-10T03:00:01.000Z",
    });
    await processAdPackageGeneration(PACKAGE_ID, deps);
    const copies = vi.mocked(adapter.copyExistingFile).mock.calls.length;

    await expect(processAdPackageGeneration(PACKAGE_ID, deps))
      .resolves.toBe("alreadyComplete");
    expect(database.transactionCount).toBe(3);
    expect(adapter.copyExistingFile).toHaveBeenCalledTimes(copies);
  });

  it("records sources-pending as retryable and succeeds once media receipts complete", async () => {
    const database = new MemoryDatabase(sourceRoot("pending"));
    const adapter = driveAdapter();
    const clock = { value: "2026-08-10T03:00:01.000Z" };
    const deps = dependencies(database, adapter, clock);

    await expect(processAdPackageGeneration(PACKAGE_ID, deps))
      .rejects.toBeInstanceOf(AdPackageGenerationRetryableError);
    const failed = (database.state as UnknownRecord).adPackages[PACKAGE_ID];
    expect(failed).toMatchObject({
      status: "failed",
      generation: {
        lastErrorCode: "ad_package_sources_pending",
        nextAttemptAt: FIRST_FAILURE_DUE,
        recoveryKey: buildAdPackageRecoveryKey(
          "failed",
          FIRST_FAILURE_DUE,
          PACKAGE_ID,
        ),
      },
    });
    expect(adapter.createFolder).not.toHaveBeenCalled();

    const ready = sourceRoot("complete") as UnknownRecord;
    (database.state as UnknownRecord).media = ready.media;
    (database.state as UnknownRecord).driveSyncJobs = ready.driveSyncJobs;
    clock.value = FIRST_FAILURE_DUE;

    await expect(processAdPackageGeneration(PACKAGE_ID, deps))
      .resolves.toBe("complete");
    expect(database.transactionCount).toBe(4);
  });

  it("marks cancelled or excluded source media terminal without scheduling recovery", async () => {
    const database = new MemoryDatabase(sourceRoot("terminal"));
    const adapter = driveAdapter();

    await expect(processAdPackageGeneration(
      PACKAGE_ID,
      dependencies(database, adapter, { value: "2026-08-10T03:00:01.000Z" }),
    )).resolves.toBe("terminalFailure");

    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID]).toMatchObject({
      status: "failed",
      generation: {
        lastErrorCode: "ad_package_source_invalid",
        terminalFailure: true,
        terminalAt: "2026-08-10T03:00:01.000Z",
      },
    });
    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID].generation)
      .not.toHaveProperty("recoveryKey");
    expect(adapter.createFolder).not.toHaveBeenCalled();
  });

  it("stores a safe config alert, then clears it after repaired configuration succeeds", async () => {
    const database = new MemoryDatabase(sourceRoot());
    const adapter = driveAdapter();
    const clock = { value: "2026-08-10T03:00:01.000Z" };
    let configured = false;
    let token = 0;
    const deps: AdPackageGenerationRuntimeDependencies = {
      database,
      resolveDrive: async () => {
        if (!configured) throw new Error("drive_oauth_config_invalid");
        return adapter;
      },
      now: () => clock.value,
      randomToken: () => `config-${++token}`,
    };

    await expect(processAdPackageGeneration(PACKAGE_ID, deps))
      .rejects.toBeInstanceOf(AdPackageGenerationRetryableError);
    expect(database.state).toMatchObject({
      adPackages: {
        [PACKAGE_ID]: {
          generation: { lastErrorCode: "ad_package_drive_config_invalid" },
        },
      },
      adPackageGenerationAlerts: {
        [PACKAGE_ID]: {
          packageId: PACKAGE_ID,
          status: "open",
          code: "ad_package_drive_config_invalid",
        },
      },
    });
    expect(JSON.stringify(database.state)).not.toContain("drive_oauth_config_invalid");

    configured = true;
    clock.value = FIRST_FAILURE_DUE;
    await expect(processAdPackageGeneration(PACKAGE_ID, deps))
      .resolves.toBe("complete");
    expect((database.state as UnknownRecord).adPackageGenerationAlerts?.[PACKAGE_ID])
      .toBeUndefined();
  });

  it("recovers after an actual adapter OAuth rejection at the attempt cap", async () => {
    const database = new MemoryDatabase(sourceRoot());
    const generatedArtifacts = driveAdapter();
    const clock = { value: "2026-08-10T03:00:01.000Z" };
    const leaked = "sensitive-refresh-token-and-client-secret";
    let configured = false;
    const client = {
      files: {
        get: vi.fn(async () => {
          if (!configured) {
            throw Object.assign(new Error(leaked), {
              response: {
                status: 400,
                data: {
                  error: "invalid_grant",
                  error_description: leaked,
                },
              },
            });
          }
          return { data: {
            id: "root-1",
            mimeType: DRIVE_FOLDER_MIME_TYPE,
            trashed: false,
            capabilities: { canAddChildren: true },
          } };
        }),
        list: vi.fn(async () => ({ data: { files: [] } })),
        create: vi.fn(async () => ({ data: {} })),
        copy: vi.fn(async () => ({ data: {} })),
      },
    } satisfies GoogleDriveClientLike;
    const validatingAdapter = createGoogleDriveMediaAdapter(client);
    let token = 0;
    const deps: AdPackageGenerationRuntimeDependencies = {
      database,
      async resolveDrive() {
        await validatingAdapter.validateRootFolder({
          rootFolderId: "root-1",
          rootMode: "existingRoot",
        });
        return generatedArtifacts;
      },
      now: () => clock.value,
      randomToken: () => `adapter-config-${++token}`,
    };

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await expect(processAdPackageGeneration(PACKAGE_ID, deps))
        .rejects.toBeInstanceOf(AdPackageGenerationRetryableError);
      const generation = (database.state as UnknownRecord)
        .adPackages[PACKAGE_ID].generation;
      expect(generation).toMatchObject({
        attemptCount: attempt,
        lastErrorCode: "ad_package_drive_config_invalid",
        nextAttemptAt: expect.any(String),
        recoveryKey: expect.any(String),
      });
      expect(generation).not.toHaveProperty("retryExhausted");
      expect(JSON.stringify(database.state)).not.toContain(leaked);
      clock.value = generation.nextAttemptAt;
    }

    configured = true;
    await expect(processAdPackageGeneration(PACKAGE_ID, deps))
      .resolves.toBe("complete");
    expect((database.state as UnknownRecord).adPackageGenerationAlerts?.[PACKAGE_ID])
      .toBeUndefined();
    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID].status)
      .toBe("complete");
  });

  it("rejects an old worker's success after another generation owns the lease", async () => {
    const database = new MemoryDatabase(sourceRoot());
    const adapter = driveAdapter({
      onFirstCopy() {
        const pkg = (database.state as UnknownRecord).adPackages[PACKAGE_ID];
        pkg.generation.leaseOwner = "new-worker";
        pkg.generation.leaseToken = "new-lease";
        pkg.generation.generationNumber = 2;
        pkg.generation.attemptCount = 2;
      },
    });

    await expect(processAdPackageGeneration(
      PACKAGE_ID,
      dependencies(database, adapter, { value: "2026-08-10T03:00:01.000Z" }),
    )).resolves.toBe("stale");
    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID].status)
      .toBe("generating");
    expect(database.transactionCount).toBe(2);
  });

  it("exhausts an ordinary attempt-eight timeout without any Drive side effect", async () => {
    const current = sourceRoot() as UnknownRecord;
    const pkg = current.adPackages[PACKAGE_ID];
    pkg.status = "generating";
    pkg.generation = {
      status: "generating",
      attemptCount: 8,
      generationNumber: 8,
      sourceFingerprint: pkg.sourceFingerprint,
      leaseOwner: "expired-worker",
      leaseToken: "expired-lease",
      leaseUntil: "2026-08-10T03:05:00.000Z",
      updatedAt: "2026-08-10T03:00:00.000Z",
      recoveryKey: buildAdPackageRecoveryKey(
        "generating",
        "2026-08-10T03:05:00.000Z",
        PACKAGE_ID,
      ),
    };
    const database = new MemoryDatabase(current);
    const adapter = driveAdapter();

    await expect(processAdPackageGeneration(
      PACKAGE_ID,
      dependencies(database, adapter, { value: "2026-08-10T03:05:00.000Z" }),
    )).resolves.toBe("terminalFailure");

    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID]).toMatchObject({
      status: "failed",
      generation: {
        retryExhausted: true,
        attemptCount: 8,
      },
    });
    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID].generation)
      .not.toHaveProperty("recoveryKey");
    expect(adapter.listExactFolders).not.toHaveBeenCalled();
    expect(adapter.copyExistingFile).not.toHaveBeenCalled();
    expect(database.transactionCount).toBe(1);
  });

  it("revalidates source receipts before success and rejects concurrent exclusion", async () => {
    const database = new MemoryDatabase(sourceRoot());
    const adapter = driveAdapter({
      onFirstCopy() {
        const packageRecord = (database.state as UnknownRecord).adPackages[PACKAGE_ID];
        const [mediaId] = packageRecord.allApprovedMediaIds as string[];
        const media = (database.state as UnknownRecord).media[mediaId];
        media.excludedAt = "2026-08-10T03:00:01.000Z";
        media.excludedBy = "reviewer-1";
      },
    });

    await expect(processAdPackageGeneration(
      PACKAGE_ID,
      dependencies(database, adapter, { value: "2026-08-10T03:00:02.000Z" }),
    )).resolves.toBe("terminalFailure");

    expect((database.state as UnknownRecord).adPackages[PACKAGE_ID]).toMatchObject({
      status: "failed",
      generation: {
        lastErrorCode: "ad_package_source_invalid",
        terminalFailure: true,
      },
    });
    expect(database.transactionCount).toBe(3);
  });
});

function recoveryRecord(
  id: string,
  status: "reviewed" | "failed" | "generating",
  dueAt: string,
) {
  const keyStatus = status === "generating" ? "generating" : status;
  return {
    id,
    value: {
      id,
      status,
      generation: {
        status,
        ...(status === "reviewed" ? { updatedAt: dueAt } : {}),
        ...(status === "failed" ? { nextAttemptAt: dueAt } : {}),
        ...(status === "generating" ? { leaseUntil: dueAt } : {}),
        recoveryKey: buildAdPackageRecoveryKey(keyStatus, dueAt, id),
      },
    },
  };
}

describe("ad package generation recovery", () => {
  const ids = Array.from({ length: 10 }, (_, index) =>
    `ad-package-${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);

  it("round-robins due states, skips malformed timestamps, and caps the batch at eight", () => {
    const pages: AdPackageRecoveryPages = {
      reviewed: ids.slice(0, 4).map((id) => recoveryRecord(id, "reviewed", REVIEWED_AT)),
      failedDue: ids.slice(4, 8).map((id) => recoveryRecord(id, "failed", REVIEWED_AT)),
      expiredLease: [
        recoveryRecord(ids[8], "generating", REVIEWED_AT),
        {
          id: ids[9],
          value: {
            id: ids[9],
            status: "generating",
            generation: {
              status: "generating",
              leaseUntil: "not-a-time",
              recoveryKey: `generating|not-a-time|${ids[9]}`,
            },
          },
        },
      ],
    };

    expect(selectFairAdPackageRecoveryIds(
      pages,
      "2026-08-10T03:01:00.000Z",
    )).toEqual([
      ids[0], ids[4], ids[8], ids[1], ids[5], ids[2], ids[6], ids[3],
    ]);
    expect(collectDueAdPackageRecoveryIds(
      pages.expiredLease,
      "2026-08-10T03:01:00.000Z",
    )).toEqual([ids[8]]);
  });

  it("queries the three indexed recovery states with a live clock and hard limits", async () => {
    const database = new MemoryDatabase({ adPackages: {} });
    const clock = { value: "2026-08-10T04:00:00.000Z" };
    const result = await runAdPackageGenerationRecovery(
      dependencies(database, driveAdapter(), clock),
    );

    expect(result).toEqual({ selected: 0, completed: 0, retryable: 0 });
    expect(database.recoveryQueries).toEqual([
      { kind: "reviewed", dueAtOrBefore: clock.value, limit: 8 },
      { kind: "failedDue", dueAtOrBefore: clock.value, limit: 8 },
      { kind: "expiredLease", dueAtOrBefore: clock.value, limit: 8 },
    ]);
  });
});

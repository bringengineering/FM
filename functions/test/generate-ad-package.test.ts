import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  DRIVE_FOLDER_MIME_TYPE,
  buildExactFolderQuery,
} from "../src/drive/folders.js";
import {
  ARTIFACT_SET_VERSION,
  adPackageSourceFingerprint,
  buildAdPackageArtifacts,
} from "../src/packages/ad-package-artifacts.js";
import {
  buildExactAdArtifactQuery,
  generateClaimedAdPackage,
  reduceAdPackageGenerationClaim,
  reduceAdPackageGenerationFailure,
  reduceAdPackageGenerationSuccess,
  type AdPackageDriveAdapter,
} from "../src/packages/generate-ad-package.js";
import { buildAdPackageRecoveryKey } from "../src/packages/generation-recovery-key.js";
import {
  BUILDING_ID,
  PACKAGE_ID,
  PHOTO_1,
  PHOTO_2,
  SESSION_ID,
  STORAGE_MD5_BASE64,
  makeFrozenPackage as packageRecord,
} from "./helpers/ad-package-fixture.js";

const NOW = "2026-08-10T03:00:00.000Z";

function root(version = 3) {
  const pkg = packageRecord(version);
  const manifests = pkg.mediaManifest as Record<string, any>[];
  return {
    adPackages: { [PACKAGE_ID]: pkg },
    media: Object.fromEntries(manifests.map((item, index) => [item.id, {
      ...item,
      objectMd5Hash: STORAGE_MD5_BASE64,
      driveSyncState: "complete",
      driveFileId: `source-file-${index + 1}`,
    }])),
    driveSyncJobs: Object.fromEntries(manifests.map((item, index) => [item.id, {
      id: item.id,
      mediaId: item.id,
      status: "complete",
      objectGeneration: item.objectGeneration,
      driveFileId: `source-file-${index + 1}`,
      folderIds: {
        root: "root-1",
        building: "building-folder-1",
        unit: "unit-folder-1",
        session: "session-folder-1",
        representativePhotos: "legacy-representative-folder-1",
        originalPhotos: "legacy-original-folder-1",
        verticalVideos: "legacy-video-folder-1",
      },
    }])),
    auditLogs: {},
    listings: { "listing-1": { internalMemo: "must-never-be-read" } },
    buildings: { [BUILDING_ID]: { ownerPhone: "must-never-be-read" } },
    secureAccess: { [BUILDING_ID]: { commonDoorPassword: "must-never-be-read" } },
  };
}

const claimInput = {
  packageId: PACKAGE_ID,
  workerId: "worker-1",
  leaseToken: "lease-1",
  now: NOW,
  leaseDurationMs: 300_000,
};

function claimedRoot() {
  const decision = reduceAdPackageGenerationClaim(root(), claimInput);
  if (decision.status !== "claimed") throw new Error("claim failed");
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

function driveAdapter(options: {
  duplicateKey?: string;
  mismatchKey?: string;
  loseAckKey?: string;
} = {}) {
  const folders = new Map<string, string>();
  const files = new Map<string, any>();
  let nextFolder = 1;
  let nextFile = 1;
  const deleteSourceFile = vi.fn();
  const folderKey = (parentId: string, name: string) => `${parentId}\n${name}`;
  const fileKey = (properties: {
    bringPackageVersion: string;
    bringArtifactKey: string;
  }) => `${properties.bringPackageVersion}\n${properties.bringArtifactKey}`;
  const adapter: AdPackageDriveAdapter & {
    deleteSourceFile: ReturnType<typeof vi.fn>;
  } = {
    deleteSourceFile,
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
    listExactArtifactFiles: vi.fn(async (request) => {
      expect(request.query).toBe(buildExactAdArtifactQuery(
        request.parentId,
        request.appProperties,
      ));
      const file = files.get(fileKey(request.appProperties));
      if (options.duplicateKey === request.appProperties.bringArtifactKey && file) {
        return [file, { ...file, id: `${file.id}-duplicate` }];
      }
      return file ? [file] : [];
    }),
    copyExistingFile: vi.fn(async (request) => {
      const value = {
        id: `file-${nextFile++}`,
        name: request.name,
        mimeType: request.mimeType,
        parents: [request.parentId],
        trashed: false,
        size: String(request.sizeBytes),
        md5Checksum: options.mismatchKey === request.appProperties.bringArtifactKey
          ? "wrong-md5"
          : request.md5Checksum,
        appProperties: request.appProperties,
      };
      files.set(fileKey(request.appProperties), value);
      if (options.loseAckKey === request.appProperties.bringArtifactKey) {
        throw new Error("socket reset with raw credential");
      }
      return value;
    }),
    uploadUtf8File: vi.fn(async (request) => {
      const value = {
        id: `file-${nextFile++}`,
        name: request.name,
        mimeType: request.mimeType,
        parents: [request.parentId],
        trashed: false,
        size: String(request.bytes.byteLength),
        md5Checksum: request.md5Checksum,
        appProperties: request.appProperties,
      };
      files.set(fileKey(request.appProperties), value);
      if (options.loseAckKey === request.appProperties.bringArtifactKey) {
        throw new Error("oauth token raw failure");
      }
      return value;
    }),
  };
  return { adapter, files, folders, deleteSourceFile };
}

describe("ad package generation reducers", () => {
  it("claims once, fences concurrent workers, and replays the same active lease", () => {
    const first = reduceAdPackageGenerationClaim(root(), claimInput);
    expect(first).toMatchObject({ status: "claimed", write: true });
    expect((first.state as any).adPackages[PACKAGE_ID]).toMatchObject({
      status: "generating",
      generation: {
        status: "generating",
        attemptCount: 1,
        generationNumber: 1,
        leaseOwner: "worker-1",
        leaseToken: "lease-1",
        leaseUntil: "2026-08-10T03:05:00.000Z",
      },
    });
    expect(reduceAdPackageGenerationClaim(first.state, {
      ...claimInput,
      workerId: "worker-2",
      leaseToken: "lease-2",
    })).toMatchObject({ status: "busy", write: false });
    expect(reduceAdPackageGenerationClaim(first.state, claimInput))
      .toMatchObject({ status: "claimed", write: false });
  });

  it("recovers an expired generating lease with a new fenced generation", () => {
    const first = reduceAdPackageGenerationClaim(root(), claimInput);
    const recovered = reduceAdPackageGenerationClaim(first.state, {
      ...claimInput,
      workerId: "worker-2",
      leaseToken: "lease-2",
      now: "2026-08-10T03:05:00.000Z",
    });
    expect(recovered).toMatchObject({ status: "claimed", write: true });
    expect((recovered.state as any).adPackages[PACKAGE_ID].generation)
      .toMatchObject({ attemptCount: 2, generationNumber: 2, leaseOwner: "worker-2" });
  });

  it("backs off failures, redacts raw errors, and only retries once due", () => {
    const claimed = claimedRoot();
    const failed = reduceAdPackageGenerationFailure(claimed, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      sourceFingerprint: packageRecord().sourceFingerprint,
      failedAt: "2026-08-10T03:01:00.000Z",
      error: new Error("Bearer SECRET raw oauth response"),
    });
    expect(failed).toMatchObject({ status: "failed", write: true });
    const pkg = (failed.state as any).adPackages[PACKAGE_ID];
    expect(pkg.status).toBe("failed");
    expect(pkg.generation).toMatchObject({
      status: "failed",
      attemptCount: 1,
      generationNumber: 1,
      lastErrorCode: "ad_package_generation_failed",
      nextAttemptAt: "2026-08-10T03:01:30.000Z",
    });
    expect(JSON.stringify(pkg)).not.toMatch(/SECRET|Bearer|oauth response/u);
    expect(reduceAdPackageGenerationClaim(failed.state, {
      ...claimInput,
      leaseToken: "lease-2",
      now: "2026-08-10T03:01:29.999Z",
    })).toMatchObject({ status: "notDue", write: false });
    expect(reduceAdPackageGenerationClaim(failed.state, {
      ...claimInput,
      leaseToken: "lease-2",
      now: "2026-08-10T03:01:30.000Z",
    })).toMatchObject({ status: "claimed", write: true });
  });

  it("commits success atomically, rejects stale fences, and ACK-replays exactly", () => {
    const artifactPlan = buildAdPackageArtifacts(packageRecord());
    const artifactKeys = [
      ...artifactPlan.representativePhotos,
      ...artifactPlan.originalPhotos,
      ...artifactPlan.verticalVideos,
      artifactPlan.daangn,
      artifactPlan.naver,
    ].map((item) => item.artifactKey);
    const generated = {
      packageId: PACKAGE_ID,
      version: 3,
      artifactSetVersion: 1 as const,
      sourceFingerprint: packageRecord().sourceFingerprint,
      generationNumber: 1,
      folderIds: {
        session: "session-folder-1",
        package: "package-folder-1",
        representativePhotos: "representative-folder-1",
        originalPhotos: "original-folder-1",
        verticalVideos: "video-folder-1",
      },
      artifactFiles: Object.fromEntries(artifactKeys.map((key, index) => [
        key,
        `file-${index + 1}`,
      ])),
    };
    expect(reduceAdPackageGenerationSuccess(claimedRoot(), {
      ...generated,
      workerId: "worker-1",
      leaseToken: "stale-lease",
      completedAt: "2026-08-10T03:02:00.000Z",
    })).toMatchObject({ status: "staleLease", write: false });

    const committed = reduceAdPackageGenerationSuccess(claimedRoot(), {
      ...generated,
      workerId: "worker-1",
      leaseToken: "lease-1",
      completedAt: "2026-08-10T03:02:00.000Z",
    });
    expect(committed).toMatchObject({ status: "committed", write: true });
    const next = committed.state as any;
    expect(next.adPackages[PACKAGE_ID]).toMatchObject({
      status: "complete",
      generatedAt: "2026-08-10T03:02:00.000Z",
      driveFolderIds: generated.folderIds,
      artifactFileIds: generated.artifactFiles,
      generation: { status: "complete", generationNumber: 1 },
    });
    expect(next.auditLogs).toHaveProperty(`ad-package-generated-${PACKAGE_ID}-1`);
    expect(reduceAdPackageGenerationSuccess(committed.state, {
      ...generated,
      workerId: "worker-1",
      leaseToken: "lease-1",
      completedAt: "2026-08-10T03:03:00.000Z",
    })).toMatchObject({ status: "alreadyCommitted", write: false });
  });

  it("caps retries and never reclaims an exhausted failed generation", () => {
    const current = root() as any;
    current.adPackages[PACKAGE_ID].status = "generating";
    current.adPackages[PACKAGE_ID].generation = {
      status: "generating",
      attemptCount: 8,
      generationNumber: 8,
      sourceFingerprint: current.adPackages[PACKAGE_ID].sourceFingerprint,
      leaseOwner: "worker-1",
      leaseToken: "lease-8",
      leaseUntil: "2026-08-10T03:05:00.000Z",
      updatedAt: NOW,
      recoveryKey: buildAdPackageRecoveryKey(
        "generating",
        "2026-08-10T03:05:00.000Z",
        PACKAGE_ID,
      ),
    };
    const failed = reduceAdPackageGenerationFailure(current, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-8",
      generationNumber: 8,
      sourceFingerprint: current.adPackages[PACKAGE_ID].sourceFingerprint,
      failedAt: "2026-08-10T03:01:00.000Z",
      error: new Error("ad_package_drive_failed"),
    });
    expect((failed.state as any).adPackages[PACKAGE_ID].generation)
      .toMatchObject({ retryExhausted: true, attemptCount: 8 });
    expect((failed.state as any).adPackages[PACKAGE_ID].generation)
      .not.toHaveProperty("nextAttemptAt");
    expect(reduceAdPackageGenerationClaim(failed.state, {
      ...claimInput,
      leaseToken: "lease-9",
      now: "2026-08-11T03:01:00.000Z",
    })).toMatchObject({ status: "terminal", write: false });
  });

  it("atomically exhausts an ordinary attempt-eight lease timeout", () => {
    const current = root() as any;
    current.adPackages[PACKAGE_ID].status = "generating";
    current.adPackages[PACKAGE_ID].generation = {
      status: "generating",
      attemptCount: 8,
      generationNumber: 8,
      sourceFingerprint: current.adPackages[PACKAGE_ID].sourceFingerprint,
      leaseOwner: "worker-1",
      leaseToken: "lease-8",
      leaseUntil: "2026-08-10T03:05:00.000Z",
      updatedAt: NOW,
      recoveryKey: buildAdPackageRecoveryKey(
        "generating",
        "2026-08-10T03:05:00.000Z",
        PACKAGE_ID,
      ),
    };

    const exhausted = reduceAdPackageGenerationClaim(current, {
      ...claimInput,
      workerId: "worker-9",
      leaseToken: "lease-9",
      now: "2026-08-10T03:05:00.000Z",
    });

    expect(exhausted).toMatchObject({
      status: "terminal",
      write: true,
      state: {
        adPackages: {
          [PACKAGE_ID]: {
            status: "failed",
            generation: {
              status: "failed",
              attemptCount: 8,
              generationNumber: 8,
              retryExhausted: true,
              lastErrorCode: "ad_package_generation_failed",
            },
          },
        },
      },
    });
    expect((exhausted.state as any).adPackages[PACKAGE_ID].generation)
      .not.toHaveProperty("recoveryKey");
  });

  it.each([
    ["ad_package_sources_pending", "sourcesPending"],
    ["ad_package_drive_config_invalid", "driveConfig"],
  ] as const)(
    "keeps repairable %s failures recoverable at the attempt counter cap",
    (code, repairableKind) => {
    const current = root() as any;
    current.adPackages[PACKAGE_ID].status = "generating";
    current.adPackages[PACKAGE_ID].generation = {
      status: "generating",
      attemptCount: 8,
      generationNumber: 8,
      sourceFingerprint: current.adPackages[PACKAGE_ID].sourceFingerprint,
      leaseOwner: "worker-1",
      leaseToken: "lease-8",
      leaseUntil: "2026-08-10T03:05:00.000Z",
      updatedAt: NOW,
      recoveryKey: buildAdPackageRecoveryKey(
        "generating",
        "2026-08-10T03:05:00.000Z",
        PACKAGE_ID,
      ),
    };

    const failed = reduceAdPackageGenerationFailure(current, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-8",
      generationNumber: 8,
      sourceFingerprint: current.adPackages[PACKAGE_ID].sourceFingerprint,
      failedAt: "2026-08-10T03:01:00.000Z",
      error: new Error(code),
    });
    const generation = (failed.state as any).adPackages[PACKAGE_ID].generation;

    expect(generation).toMatchObject({
      attemptCount: 8,
      generationNumber: 8,
      lastErrorCode: code,
      repairableKind,
      nextAttemptAt: "2026-08-10T04:05:00.000Z",
      recoveryKey: buildAdPackageRecoveryKey(
        "failed",
        "2026-08-10T04:05:00.000Z",
        PACKAGE_ID,
      ),
    });
    expect(generation).not.toHaveProperty("retryExhausted");
    const claimed = reduceAdPackageGenerationClaim(failed.state, {
      ...claimInput,
      leaseToken: "lease-9",
      now: "2026-08-10T04:05:00.000Z",
    });
    expect(claimed).toMatchObject({
      status: "claimed",
      write: true,
      state: {
        adPackages: {
          [PACKAGE_ID]: {
            generation: {
              attemptCount: 8,
              generationNumber: 8,
              leaseToken: "lease-9",
              repairableKind,
            },
          },
        },
      },
    });
    expect(reduceAdPackageGenerationClaim(claimed.state, {
      ...claimInput,
      workerId: "worker-10",
      leaseToken: "lease-10",
      now: "2026-08-10T04:10:00.000Z",
    })).toMatchObject({
      status: "claimed",
      write: true,
      state: {
        adPackages: {
          [PACKAGE_ID]: {
            generation: {
              attemptCount: 8,
              generationNumber: 8,
              leaseToken: "lease-10",
              repairableKind,
            },
          },
        },
      },
    });
  });

  it("rejects success when the frozen source or media generation changed", () => {
    const changedSource = claimedRoot() as any;
    changedSource.adPackages[PACKAGE_ID].daangnDescription = "changed";
    const base = {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      sourceFingerprint: packageRecord().sourceFingerprint,
      completedAt: "2026-08-10T03:02:00.000Z",
      version: 3,
      artifactSetVersion: 1 as const,
      folderIds: {
        session: "session-folder-1",
        package: "package-folder-1",
        representativePhotos: "representative-folder-1",
        originalPhotos: "original-folder-1",
        verticalVideos: "video-folder-1",
      },
      artifactFiles: {},
    };
    expect(reduceAdPackageGenerationSuccess(changedSource, base))
      .toMatchObject({ status: "staleSource", write: false });

    const changedGeneration = claimedRoot() as any;
    changedGeneration.media[PHOTO_1].objectGeneration = "9999";
    expect(reduceAdPackageGenerationSuccess(changedGeneration, base))
      .toMatchObject({ status: "staleSource", write: false });
  });
});

describe("Drive 01~05 package generation", () => {
  it("creates 01~05 under the version folder by copying sources and uploading UTF-8 text", async () => {
    const { adapter, deleteSourceFile } = driveAdapter();
    const result = await generateClaimedAdPackage(claimedRoot(), {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, adapter);

    expect(result.folderIds).toEqual({
      session: "session-folder-1",
      package: "folder-1",
      representativePhotos: "folder-2",
      originalPhotos: "folder-3",
      verticalVideos: "folder-4",
    });
    expect(adapter.createFolder).toHaveBeenCalledTimes(4);
    expect(adapter.copyExistingFile).toHaveBeenCalledTimes(12);
    expect(adapter.uploadUtf8File).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.artifactFiles)).toHaveLength(14);
    const textRequests = vi.mocked(adapter.uploadUtf8File).mock.calls.map(([item]) => item);
    expect(textRequests.map((item) => item.name)).toEqual([
      "04_당근_매물설명.txt",
      "05_네이버부동산_입력정보.txt",
    ]);
    expect(textRequests.every((item) => item.mimeType === "text/plain")).toBe(true);
    expect(Buffer.from(textRequests[0].bytes).toString("utf8")).toContain("브링빌");
    expect(deleteSourceFile).not.toHaveBeenCalled();
  });

  it("isolates v2 and v3 in deterministic sibling package folders", async () => {
    const memory = driveAdapter();
    const v2 = root(2) as any;
    v2.adPackages[PACKAGE_ID].sourceFingerprint = adPackageSourceFingerprint(
      v2.adPackages[PACKAGE_ID],
    );
    const claimedV2 = reduceAdPackageGenerationClaim(v2, claimInput);
    if (claimedV2.status !== "claimed") throw new Error("v2 claim failed");
    const resultV2 = await generateClaimedAdPackage(claimedV2.state, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, memory.adapter);

    const v3 = claimedRoot();
    const resultV3 = await generateClaimedAdPackage(v3, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, memory.adapter);
    expect(resultV2.folderIds.package).not.toBe(resultV3.folderIds.package);
    expect([...memory.folders.keys()]).toEqual(expect.arrayContaining([
      "session-folder-1\n광고패키지_v002",
      "session-folder-1\n광고패키지_v003",
    ]));
  });

  it("recovers a lost create ACK by exact lookup without another copy", async () => {
    const key = `representative:001:${PHOTO_2}`;
    const { adapter } = driveAdapter({ loseAckKey: key });
    await expect(generateClaimedAdPackage(claimedRoot(), {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, adapter)).resolves.toMatchObject({ packageId: PACKAGE_ID });
    expect(vi.mocked(adapter.copyExistingFile).mock.calls.filter(
      ([request]) => request.appProperties.bringArtifactKey === key,
    )).toHaveLength(1);
  });

  it("fails closed for duplicate identities or checksum mismatches", async () => {
    const key = `representative:001:${PHOTO_2}`;
    const duplicate = driveAdapter({ loseAckKey: key, duplicateKey: key });
    await expect(generateClaimedAdPackage(claimedRoot(), {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, duplicate.adapter)).rejects.toThrow("ad_package_file_duplicate");

    const mismatch = driveAdapter({ mismatchKey: key });
    await expect(generateClaimedAdPackage(claimedRoot(), {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, mismatch.adapter)).rejects.toThrow("ad_package_file_mismatch");
  });

  it("rejects mismatched Drive receipts before any folder or file mutation", async () => {
    const current = claimedRoot() as any;
    current.driveSyncJobs[PHOTO_1].folderIds.session = "other-session-folder";
    const { adapter } = driveAdapter();
    await expect(generateClaimedAdPackage(current, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, adapter)).rejects.toThrow("ad_package_drive_receipt_invalid");
    expect(adapter.createFolder).not.toHaveBeenCalled();
    expect(adapter.copyExistingFile).not.toHaveBeenCalled();
    expect(adapter.uploadUtf8File).not.toHaveBeenCalled();
  });

  it("does not read live building, listing, or secure-access branches", async () => {
    const current = claimedRoot() as any;
    for (const key of ["buildings", "listings", "secureAccess"]) {
      Object.defineProperty(current, key, {
        configurable: true,
        get: () => {
          throw new Error(`forbidden live read: ${key}`);
        },
      });
    }
    const { adapter } = driveAdapter();
    await expect(generateClaimedAdPackage(current, {
      packageId: PACKAGE_ID,
      workerId: "worker-1",
      leaseToken: "lease-1",
      generationNumber: 1,
      now: "2026-08-10T03:01:00.000Z",
    }, adapter)).resolves.toMatchObject({ packageId: PACKAGE_ID });
  });
});

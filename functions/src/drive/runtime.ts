import {
  base64Md5ToHex,
  isDriveMd5Hex,
} from "./google-drive-adapter.js";
import { buildDriveRecoveryKey } from "./recovery-key.js";
import {
  readDriveUploadSession,
  reduceDriveUploadSessionCheckpoint,
  type DriveUploadSessionBinding,
  type DriveUploadSessionSnapshot,
} from "./upload-session.js";
import {
  reduceDriveFolderLeaseClaim,
  reduceDriveFolderLeasePublish,
  type DriveFolderLeaseClaimDecision,
  type DriveFolderLeasePublishDecision,
} from "./folder-lease.js";
import {
  TERMINAL_DRIVE_FAILURE_CODES,
  reduceDriveSyncClaim,
  reduceDriveSyncFailure,
  reduceDriveSyncSuccess,
  syncClaimedDriveMedia,
  type DriveMediaAdapter,
  type DriveSyncClaimDecision,
  type DriveSyncFailureDecision,
  type DriveSyncSuccessDecision,
  type FinalizedMediaStorageAdapter,
} from "./sync-media.js";

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LEASE_DURATION_MILLISECONDS = 12 * 60_000;
const RECOVERY_CONCURRENCY = 4;

export const RECOVERY_SCAN_LIMIT = 20;
export const RECOVERY_BATCH_LIMIT = 24;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_PATTERN.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function isMediaId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "drive_sync_failed";
}

function isTerminalFailure(error: unknown): boolean {
  return TERMINAL_DRIVE_FAILURE_CODES.has(errorCode(error));
}

function normalizedSyncState(current: unknown, mediaId: string): unknown {
  if (!isRecord(current) || !isRecord(current.media)) {
    throw new Error("drive_sync_source_invalid");
  }
  const media = current.media[mediaId];
  if (!isRecord(media)) throw new Error("drive_sync_source_invalid");
  if (media.objectMd5Hash === undefined) return current;
  if (isDriveMd5Hex(media.objectMd5Hash)) return current;
  const next = structuredClone(current);
  const nextMediaCollection = (next as UnknownRecord).media;
  if (!isRecord(nextMediaCollection) || !isRecord(nextMediaCollection[mediaId])) {
    throw new Error("drive_sync_source_invalid");
  }
  nextMediaCollection[mediaId].objectMd5Hash = base64Md5ToHex(
    media.objectMd5Hash,
  );
  return next;
}

export interface RootTransactionResult {
  committed: boolean;
  state: unknown;
}

export interface RecoveryJobRecord {
  id: string;
  value: unknown;
}

export interface DriveSyncRuntimeDatabase {
  transactionRoot(
    update: (current: unknown) => unknown | undefined,
  ): Promise<RootTransactionResult>;
  listRecoveryJobs(input:
    | { kind: "queued"; limit: number }
    | {
        kind: "failedDue" | "expiredLease";
        dueAtOrBefore: string;
        limit: number;
      }
  ): Promise<RecoveryJobRecord[]>;
}

export interface DriveSyncRuntimeDependencies {
  database: DriveSyncRuntimeDatabase;
  storage: FinalizedMediaStorageAdapter;
  drive: DriveMediaAdapter;
  rootFolderId: string;
  now(): string;
  randomToken(): string;
}

export type DriveSyncProcessStatus =
  | "complete"
  | "alreadyComplete"
  | "cancelled"
  | "busy"
  | "notDue"
  | "stale"
  | "terminalFailure";

export class DriveSyncRetryableError extends Error {
  constructor() {
    super("drive_sync_retryable");
    this.name = "DriveSyncRetryableError";
  }
}

async function claimDriveSyncJob(
  mediaId: string,
  dependencies: DriveSyncRuntimeDependencies,
): Promise<{
  decision: DriveSyncClaimDecision;
  state: unknown;
  workerId: string;
  leaseToken: string;
  now: string;
  folderIds?: Extract<
    DriveFolderLeaseClaimDecision,
    { status: "cached" }
  >["folderIds"];
  ownsFolderLease: boolean;
  rootFolderId?: string;
  externalError?: unknown;
} | null> {
  const workerId = dependencies.randomToken();
  const leaseToken = dependencies.randomToken();
  const now = dependencies.now();
  let decision: DriveSyncClaimDecision | null = null;
  let folderDecision: DriveFolderLeaseClaimDecision | null = null;
  let rootFolderId: string | undefined;
  let externalError: unknown;
  let reducerError: unknown;
  const reduceClaim = (current: unknown): unknown | undefined => {
    reducerError = undefined;
    folderDecision = null;
    rootFolderId = undefined;
    externalError = undefined;
    try {
      decision = reduceDriveSyncClaim(current, {
        mediaId,
        workerId,
        leaseToken,
        now,
        leaseDurationMs: LEASE_DURATION_MILLISECONDS,
      });
      if (decision.status !== "claimed") {
        return decision.write ? decision.state : undefined;
      }
      try {
        rootFolderId = dependencies.rootFolderId;
      } catch (error) {
        externalError = error;
        return decision.write ? decision.state : undefined;
      }
      folderDecision = reduceDriveFolderLeaseClaim(decision.state, {
        mediaId,
        workerId,
        leaseToken,
        now,
        rootFolderId,
      });
      if (folderDecision.status === "staleJob") {
        throw new Error("drive_sync_lease_stale");
      }
      if (folderDecision.status === "busy") {
        decision = {
          status: "busy",
          write: false,
          state: folderDecision.state,
        };
        return undefined;
      }
      return decision.write || folderDecision.write
        ? folderDecision.state
        : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  };
  const transaction = await dependencies.database.transactionRoot(reduceClaim);
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    reduceClaim(transaction.state);
    if (reducerError !== undefined || decision === null) return null;
  }
  const claimedFolder = folderDecision as DriveFolderLeaseClaimDecision | null;
  return {
    decision,
    state: transaction.state,
    workerId,
    leaseToken,
    now,
    ...(claimedFolder?.status === "cached"
      ? { folderIds: claimedFolder.folderIds }
      : {}),
    ownsFolderLease: claimedFolder?.status === "acquired",
    ...(rootFolderId === undefined ? {} : { rootFolderId }),
    ...(externalError === undefined ? {} : { externalError }),
  };
}

async function checkpointDriveUploadSession(
  dependencies: DriveSyncRuntimeDependencies,
  input: DriveUploadSessionBinding & {
    mediaId: string;
    workerId: string;
    leaseToken: string;
    sessionUri: string;
    nextOffset: number;
  },
): Promise<DriveUploadSessionSnapshot> {
  let reducerError: unknown;
  const transaction = await dependencies.database.transactionRoot((current) => {
    reducerError = undefined;
    try {
      const decision = reduceDriveUploadSessionCheckpoint(current, {
        ...input,
        now: dependencies.now(),
        leaseDurationMs: LEASE_DURATION_MILLISECONDS,
      });
      if (decision.status !== "committed") {
        reducerError = new Error(
          decision.status === "staleLease"
            ? "drive_sync_lease_stale"
            : "drive_upload_state_invalid",
        );
        return undefined;
      }
      return decision.state;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  });
  if (reducerError !== undefined || !transaction.committed) {
    throw reducerError instanceof Error
      ? reducerError
      : new Error("drive_sync_lease_stale");
  }
  const session = readDriveUploadSession(transaction.state, input);
  if (session === null) throw new Error("drive_upload_state_invalid");
  return session;
}

async function publishDriveFolderCache(
  dependencies: DriveSyncRuntimeDependencies,
  input: Parameters<typeof reduceDriveFolderLeasePublish>[1],
): Promise<DriveFolderLeasePublishDecision | null> {
  let decision: DriveFolderLeasePublishDecision | null = null;
  let reducerError: unknown;
  const transaction = await dependencies.database.transactionRoot((current) => {
    reducerError = undefined;
    try {
      decision = reduceDriveFolderLeasePublish(current, input);
      return decision.write ? decision.state : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  });
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    try {
      decision = reduceDriveFolderLeasePublish(transaction.state, input);
    } catch {
      return null;
    }
  }
  return decision;
}

async function commitDriveSyncSuccess(
  dependencies: DriveSyncRuntimeDependencies,
  input: Parameters<typeof reduceDriveSyncSuccess>[1],
): Promise<DriveSyncSuccessDecision | null> {
  let decision: DriveSyncSuccessDecision | null = null;
  let reducerError: unknown;
  const transaction = await dependencies.database.transactionRoot((current) => {
    reducerError = undefined;
    try {
      decision = reduceDriveSyncSuccess(current, input);
      return decision.write ? decision.state : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  });
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    try {
      decision = reduceDriveSyncSuccess(transaction.state, input);
    } catch {
      return null;
    }
  }
  return decision;
}

async function commitDriveSyncFailure(
  dependencies: DriveSyncRuntimeDependencies,
  input: Parameters<typeof reduceDriveSyncFailure>[1],
): Promise<DriveSyncFailureDecision | null> {
  let decision: DriveSyncFailureDecision | null = null;
  let reducerError: unknown;
  const transaction = await dependencies.database.transactionRoot((current) => {
    reducerError = undefined;
    try {
      decision = reduceDriveSyncFailure(current, input);
      return decision.write ? decision.state : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  });
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    try {
      decision = reduceDriveSyncFailure(transaction.state, input);
    } catch {
      return null;
    }
  }
  return decision;
}

export async function processDriveSyncJob(
  mediaId: string,
  dependencies: DriveSyncRuntimeDependencies,
): Promise<DriveSyncProcessStatus> {
  if (!isMediaId(mediaId)) return "terminalFailure";
  const claim = await claimDriveSyncJob(mediaId, dependencies);
  if (claim === null) return "terminalFailure";
  if (claim.decision.status === "busy") return "busy";
  if (claim.decision.status === "notDue") return "notDue";
  if (claim.decision.status === "terminal") return "alreadyComplete";
  if (claim.decision.status === "cancelled") return "cancelled";

  try {
    if (claim.externalError !== undefined) throw claim.externalError;
    if (claim.rootFolderId === undefined) {
      throw new Error("drive_oauth_config_invalid");
    }
    const upload = await syncClaimedDriveMedia(
      normalizedSyncState(claim.state, mediaId),
      {
        mediaId,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        now: claim.now,
        rootFolderId: claim.rootFolderId,
        ...(claim.folderIds === undefined
          ? {}
          : { folderIds: claim.folderIds }),
      },
      {
        storage: dependencies.storage,
        drive: dependencies.drive,
        checkpointUploadSession: (session) => checkpointDriveUploadSession(
          dependencies,
          {
            ...session,
            mediaId,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
          },
        ),
        ...(claim.ownsFolderLease
          ? {
              publishFolderIds: async (folderIds) => {
                const published = await publishDriveFolderCache(dependencies, {
                  mediaId,
                  workerId: claim.workerId,
                  leaseToken: claim.leaseToken,
                  now: claim.now,
                  rootFolderId: claim.rootFolderId as string,
                  folderIds,
                  publishedAt: dependencies.now(),
                });
                if (
                  published === null
                  || published.status === "staleLease"
                ) throw new Error("drive_sync_lease_stale");
                return published.folderIds;
              },
            }
          : {}),
      },
    );
    const committed = await commitDriveSyncSuccess(dependencies, {
      ...upload,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      completedAt: dependencies.now(),
    });
    if (committed === null) return "stale";
    if (committed.status === "committed") return "complete";
    if (committed.status === "alreadyCommitted") return "alreadyComplete";
    if (committed.status === "cancelled") return "cancelled";
    return "stale";
  } catch (error) {
    const failed = await commitDriveSyncFailure(dependencies, {
      mediaId,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      failedAt: dependencies.now(),
      error,
      terminal: isTerminalFailure(error),
    });
    if (
      failed?.status === "terminal"
      || failed?.status === "alreadyTerminal"
    ) return "terminalFailure";
    if (failed?.status !== "failed") return "stale";
    throw new DriveSyncRetryableError();
  }
}

function isDue(value: unknown, nowMilliseconds: number): boolean {
  return canonicalIso(value) && Date.parse(value) <= nowMilliseconds;
}

export function collectDueRecoveryMediaIds(
  records: RecoveryJobRecord[],
  now: string,
  limit = RECOVERY_BATCH_LIMIT,
): string[] {
  if (
    !canonicalIso(now)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > RECOVERY_BATCH_LIMIT
  ) {
    throw new Error("drive_recovery_request_invalid");
  }
  const nowMilliseconds = Date.parse(now);
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const record of records) {
    if (
      selected.length >= limit
      || !isMediaId(record.id)
      || !isRecord(record.value)
      || record.value.mediaId !== record.id
      || seen.has(record.id)
    ) continue;
    const status = record.value.status;
    let due = false;
    if (status === "queued" && canonicalIso(record.value.createdAt)) {
      due = record.value.recoveryKey === buildDriveRecoveryKey(
        "queued",
        record.value.createdAt,
        record.id,
      );
    } else if (
      status === "failed"
      && isDue(record.value.nextAttemptAt, nowMilliseconds)
    ) {
      due = record.value.recoveryKey === buildDriveRecoveryKey(
        "failed",
        record.value.nextAttemptAt as string,
        record.id,
      );
    } else if (
      status === "syncing"
      && isDue(record.value.leaseUntil, nowMilliseconds)
    ) {
      due = record.value.recoveryKey === buildDriveRecoveryKey(
        "syncing",
        record.value.leaseUntil as string,
        record.id,
      );
    }
    if (!due) continue;
    seen.add(record.id);
    selected.push(record.id);
  }
  return selected;
}

export interface DriveRecoveryPages {
  queued: RecoveryJobRecord[];
  failedDue: RecoveryJobRecord[];
  expiredLease: RecoveryJobRecord[];
}

export function selectFairRecoveryMediaIds(
  pages: DriveRecoveryPages,
  now: string,
  limit = RECOVERY_BATCH_LIMIT,
): string[] {
  const groups = [
    collectDueRecoveryMediaIds(pages.queued, now, limit),
    collectDueRecoveryMediaIds(pages.failedDue, now, limit),
    collectDueRecoveryMediaIds(pages.expiredLease, now, limit),
  ];
  const selected: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const group of groups) {
      const mediaId = group[index];
      if (mediaId === undefined || seen.has(mediaId)) continue;
      seen.add(mediaId);
      selected.push(mediaId);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export async function runDriveSyncRecovery(
  dependencies: DriveSyncRuntimeDependencies,
): Promise<{ selected: number; completed: number; retryable: number }> {
  const now = dependencies.now();
  const pages: DriveRecoveryPages = {
    queued: [],
    failedDue: [],
    expiredLease: [],
  };
  for (const query of [
    { kind: "queued", limit: RECOVERY_SCAN_LIMIT },
    {
      kind: "failedDue",
      dueAtOrBefore: now,
      limit: RECOVERY_SCAN_LIMIT,
    },
    {
      kind: "expiredLease",
      dueAtOrBefore: now,
      limit: RECOVERY_SCAN_LIMIT,
    },
  ] as const) {
    pages[query.kind] = await dependencies.database.listRecoveryJobs(query);
  }
  const mediaIds = selectFairRecoveryMediaIds(
    pages,
    now,
    RECOVERY_BATCH_LIMIT,
  );
  let cursor = 0;
  let completed = 0;
  let retryable = 0;
  async function worker(): Promise<void> {
    while (cursor < mediaIds.length) {
      const index = cursor++;
      try {
        const result = await processDriveSyncJob(mediaIds[index], dependencies);
        if (result === "complete" || result === "alreadyComplete") completed += 1;
      } catch (error) {
        if (error instanceof DriveSyncRetryableError) retryable += 1;
      }
    }
  }
  const workerCount = Math.min(RECOVERY_CONCURRENCY, mediaIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { selected: mediaIds.length, completed, retryable };
}

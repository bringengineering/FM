import {
  storageBase64Md5ToDriveHex,
  readFrozenAdPackage,
} from "./ad-package-artifacts.js";
import {
  reduceAdPackageGenerationClaim,
  reduceAdPackageGenerationFailure,
  reduceAdPackageGenerationSuccess,
  generateClaimedAdPackage,
  TERMINAL_AD_PACKAGE_FAILURE_CODES,
  type AdPackageDriveAdapter,
  type AdPackageGenerationClaimDecision,
  type AdPackageGenerationFailureDecision,
  type AdPackageGenerationSuccessDecision,
} from "./generate-ad-package.js";
import {
  buildAdPackageRecoveryKey,
} from "./generation-recovery-key.js";

type UnknownRecord = Record<string, unknown>;

const PACKAGE_ID_PATTERN =
  /^ad-package-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const CANONICAL_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LEASE_DURATION_MILLISECONDS = 12 * 60_000;
const RECOVERY_CONCURRENCY = 2;

export const AD_PACKAGE_RECOVERY_LIMIT = 8;

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

function isDriveId(value: unknown): value is string {
  return typeof value === "string" && DRIVE_ID_PATTERN.test(value);
}

function stateBranch(root: UnknownRecord, key: string): UnknownRecord {
  const value = root[key];
  return isRecord(value) ? value : {};
}

function exactSourceTuple(
  media: UnknownRecord,
  manifest: ReturnType<typeof readFrozenAdPackage>["mediaManifest"][number],
): boolean {
  let checksum: string;
  try {
    checksum = storageBase64Md5ToDriveHex(media.objectMd5Hash);
  } catch {
    return false;
  }
  return media.id === manifest.id
    && media.buildingId === manifest.buildingId
    && media.captureSessionId === manifest.captureSessionId
    && media.kind === manifest.kind
    && media.zone === manifest.zone
    && media.mimeType === manifest.mimeType
    && media.sizeBytes === manifest.sizeBytes
    && media.capturedAt === manifest.capturedAt
    && media.storagePath === manifest.storagePath
    && media.objectGeneration === manifest.objectGeneration
    && checksum === manifest.driveMd5Checksum
    && media.captureQualityState === manifest.captureQualityState
    && media.uploadState === "finalized"
    && media.excludedAt === undefined
    && media.excludedBy === undefined;
}

function exactJobTuple(
  job: UnknownRecord,
  manifest: ReturnType<typeof readFrozenAdPackage>["mediaManifest"][number],
): boolean {
  return job.id === manifest.id
    && job.mediaId === manifest.id
    && job.buildingId === manifest.buildingId
    && job.storagePath === manifest.storagePath
    && job.objectGeneration === manifest.objectGeneration;
}

export type AdPackageSourceState = "ready" | "pending" | "terminal";

export function classifyAdPackageSources(
  current: unknown,
  packageId: string,
): AdPackageSourceState {
  if (!isRecord(current) || !PACKAGE_ID_PATTERN.test(packageId)) return "terminal";
  const pkg = stateBranch(current, "adPackages")[packageId];
  if (!isRecord(pkg)) return "terminal";
  let source: ReturnType<typeof readFrozenAdPackage>;
  try {
    source = readFrozenAdPackage(pkg);
  } catch {
    return "terminal";
  }
  const media = stateBranch(current, "media");
  const jobs = stateBranch(current, "driveSyncJobs");
  let pending = false;
  let sessionFolderId: string | undefined;
  for (const manifest of source.mediaManifest) {
    const item = media[manifest.id];
    const job = jobs[manifest.id];
    if (
      !isRecord(item)
      || !isRecord(job)
      || !exactSourceTuple(item, manifest)
      || !exactJobTuple(job, manifest)
    ) return "terminal";

    if (job.status === "complete" && item.driveSyncState === "complete") {
      if (
        !isDriveId(item.driveFileId)
        || item.driveFileId !== job.driveFileId
        || !isRecord(job.folderIds)
        || !isDriveId(job.folderIds.session)
        || !isDriveId(job.folderIds.originalPhotos)
        || !isDriveId(job.folderIds.verticalVideos)
        || (sessionFolderId !== undefined
          && sessionFolderId !== job.folderIds.session)
      ) return "terminal";
      sessionFolderId = job.folderIds.session;
      continue;
    }
    if (
      (job.status === "queued" && item.driveSyncState === "queued")
      || (job.status === "syncing" && item.driveSyncState === "syncing")
      || (job.status === "failed"
        && item.driveSyncState === "failed"
        && canonicalIso(job.nextAttemptAt))
    ) {
      pending = true;
      continue;
    }
    return "terminal";
  }
  return pending ? "pending" : "ready";
}

export interface AdPackageRootTransactionResult {
  committed: boolean;
  state: unknown;
}

export interface AdPackageRecoveryRecord {
  id: string;
  value: unknown;
}

export interface AdPackageRecoveryPages {
  reviewed: AdPackageRecoveryRecord[];
  failedDue: AdPackageRecoveryRecord[];
  expiredLease: AdPackageRecoveryRecord[];
}

export interface AdPackageGenerationRuntimeDatabase {
  transactionRoot(
    update: (current: unknown) => unknown | undefined,
  ): Promise<AdPackageRootTransactionResult>;
  listRecoveryPackages(input: {
    kind: keyof AdPackageRecoveryPages;
    dueAtOrBefore: string;
    limit: number;
  }): Promise<AdPackageRecoveryRecord[]>;
}

export interface AdPackageGenerationRuntimeDependencies {
  database: AdPackageGenerationRuntimeDatabase;
  resolveDrive(): Promise<AdPackageDriveAdapter>;
  now(): string;
  randomToken(): string;
}

export type AdPackageGenerationProcessStatus =
  | "complete"
  | "alreadyComplete"
  | "busy"
  | "notDue"
  | "stale"
  | "terminalFailure";

export class AdPackageGenerationRetryableError extends Error {
  constructor() {
    super("ad_package_generation_retryable");
    this.name = "AdPackageGenerationRetryableError";
  }
}

async function claimPackage(
  packageId: string,
  dependencies: AdPackageGenerationRuntimeDependencies,
): Promise<{
  decision: AdPackageGenerationClaimDecision;
  state: unknown;
  workerId: string;
  leaseToken: string;
  generationNumber?: number;
  sourceFingerprint?: string;
} | null> {
  const workerId = dependencies.randomToken();
  const leaseToken = dependencies.randomToken();
  const now = dependencies.now();
  let decision: AdPackageGenerationClaimDecision | null = null;
  let reducerError: unknown;
  const update = (current: unknown): unknown | undefined => {
    reducerError = undefined;
    try {
      decision = reduceAdPackageGenerationClaim(current, {
        packageId,
        workerId,
        leaseToken,
        now,
        leaseDurationMs: LEASE_DURATION_MILLISECONDS,
      });
      return decision.write ? decision.state : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  };
  const transaction = await dependencies.database.transactionRoot(update);
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    update(transaction.state);
    if (reducerError !== undefined || decision === null) return null;
  }
  const root = isRecord(transaction.state) ? transaction.state : {};
  const pkg = stateBranch(root, "adPackages")[packageId];
  const generation = isRecord(pkg) && isRecord(pkg.generation)
    ? pkg.generation
    : undefined;
  return {
    decision,
    state: transaction.state,
    workerId,
    leaseToken,
    ...(generation && Number.isSafeInteger(generation.generationNumber)
      ? { generationNumber: generation.generationNumber as number }
      : {}),
    ...(isRecord(pkg) && typeof pkg.sourceFingerprint === "string"
      ? { sourceFingerprint: pkg.sourceFingerprint }
      : {}),
  };
}

async function commitSuccess(
  dependencies: AdPackageGenerationRuntimeDependencies,
  input: Parameters<typeof reduceAdPackageGenerationSuccess>[1],
): Promise<AdPackageGenerationSuccessDecision | null> {
  let decision: AdPackageGenerationSuccessDecision | null = null;
  let reducerError: unknown;
  let sourceError: Error | undefined;
  const validateSources = (current: unknown): boolean => {
    const state = classifyAdPackageSources(current, input.packageId);
    if (state === "ready") return true;
    sourceError = new Error(state === "pending"
      ? "ad_package_sources_pending"
      : "ad_package_source_invalid");
    return false;
  };
  const transaction = await dependencies.database.transactionRoot((current) => {
    reducerError = undefined;
    sourceError = undefined;
    if (!validateSources(current)) return undefined;
    try {
      decision = reduceAdPackageGenerationSuccess(current, input);
      return decision.write ? decision.state : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  });
  if (sourceError !== undefined) throw sourceError;
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    if (!validateSources(transaction.state)) throw sourceError;
    try {
      decision = reduceAdPackageGenerationSuccess(transaction.state, input);
    } catch {
      return null;
    }
  }
  return decision;
}

async function commitFailure(
  dependencies: AdPackageGenerationRuntimeDependencies,
  input: Parameters<typeof reduceAdPackageGenerationFailure>[1],
): Promise<AdPackageGenerationFailureDecision | null> {
  let decision: AdPackageGenerationFailureDecision | null = null;
  let reducerError: unknown;
  const transaction = await dependencies.database.transactionRoot((current) => {
    reducerError = undefined;
    try {
      decision = reduceAdPackageGenerationFailure(current, input);
      return decision.write ? decision.state : undefined;
    } catch (error) {
      reducerError = error;
      return undefined;
    }
  });
  if (reducerError !== undefined || decision === null) return null;
  if (!transaction.committed) {
    try {
      decision = reduceAdPackageGenerationFailure(transaction.state, input);
    } catch {
      return null;
    }
  }
  return decision;
}

function normalizedRuntimeError(error: unknown): Error {
  const code = error instanceof Error ? error.message : "";
  if (code === "drive_oauth_config_invalid" || code === "drive_root_folder_invalid") {
    return new Error("ad_package_drive_config_invalid");
  }
  if (code.startsWith("ad_package_")) return new Error(code);
  return new Error("ad_package_generation_failed");
}

function terminalFailure(error: Error): boolean {
  return TERMINAL_AD_PACKAGE_FAILURE_CODES.has(error.message);
}

export async function processAdPackageGeneration(
  packageId: string,
  dependencies: AdPackageGenerationRuntimeDependencies,
): Promise<AdPackageGenerationProcessStatus> {
  if (!PACKAGE_ID_PATTERN.test(packageId)) return "terminalFailure";
  const claim = await claimPackage(packageId, dependencies);
  if (claim === null) return "terminalFailure";
  if (claim.decision.status === "busy") return "busy";
  if (claim.decision.status === "notDue") return "notDue";
  if (claim.decision.status === "terminal") {
    const root = isRecord(claim.state) ? claim.state : {};
    const pkg = stateBranch(root, "adPackages")[packageId];
    return isRecord(pkg) && pkg.status === "complete"
      ? "alreadyComplete"
      : "terminalFailure";
  }
  if (
    claim.generationNumber === undefined
    || claim.sourceFingerprint === undefined
  ) return "terminalFailure";

  try {
    const sourceState = classifyAdPackageSources(claim.state, packageId);
    if (sourceState === "pending") throw new Error("ad_package_sources_pending");
    if (sourceState === "terminal") throw new Error("ad_package_source_invalid");
    const drive = await dependencies.resolveDrive();
    const generated = await generateClaimedAdPackage(claim.state, {
      packageId,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      generationNumber: claim.generationNumber,
      now: dependencies.now(),
    }, drive);
    const committed = await commitSuccess(dependencies, {
      ...generated,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      completedAt: dependencies.now(),
    });
    if (committed?.status === "committed") return "complete";
    if (committed?.status === "alreadyCommitted") return "alreadyComplete";
    return "stale";
  } catch (rawError) {
    const error = normalizedRuntimeError(rawError);
    const failed = await commitFailure(dependencies, {
      packageId,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      generationNumber: claim.generationNumber,
      sourceFingerprint: claim.sourceFingerprint,
      failedAt: dependencies.now(),
      error,
      terminal: terminalFailure(error),
    });
    if (failed?.status === "terminal") return "terminalFailure";
    if (failed?.status !== "failed") return "stale";
    throw new AdPackageGenerationRetryableError();
  }
}

function dueFieldFor(record: AdPackageRecoveryRecord): {
  status: "reviewed" | "failed" | "generating";
  dueAt: string;
} | null {
  if (!PACKAGE_ID_PATTERN.test(record.id) || !isRecord(record.value)) return null;
  if (record.value.id !== record.id || !isRecord(record.value.generation)) return null;
  const generation = record.value.generation;
  if (record.value.status === "reviewed" && generation.status === "reviewed") {
    return canonicalIso(generation.updatedAt)
      ? { status: "reviewed", dueAt: generation.updatedAt }
      : null;
  }
  if (record.value.status === "failed" && generation.status === "failed") {
    return canonicalIso(generation.nextAttemptAt)
      ? { status: "failed", dueAt: generation.nextAttemptAt }
      : null;
  }
  if (record.value.status === "generating" && generation.status === "generating") {
    return canonicalIso(generation.leaseUntil)
      ? { status: "generating", dueAt: generation.leaseUntil }
      : null;
  }
  return null;
}

export function collectDueAdPackageRecoveryIds(
  records: AdPackageRecoveryRecord[],
  now: string,
  limit = AD_PACKAGE_RECOVERY_LIMIT,
): string[] {
  if (
    !canonicalIso(now)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > AD_PACKAGE_RECOVERY_LIMIT
  ) throw new Error("ad_package_recovery_request_invalid");
  const nowMilliseconds = Date.parse(now);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (result.length >= limit || seen.has(record.id)) continue;
    const due = dueFieldFor(record);
    if (due === null || Date.parse(due.dueAt) > nowMilliseconds) continue;
    const generation = (record.value as UnknownRecord).generation as UnknownRecord;
    if (generation.recoveryKey !== buildAdPackageRecoveryKey(
      due.status,
      due.dueAt,
      record.id,
    )) continue;
    seen.add(record.id);
    result.push(record.id);
  }
  return result;
}

export function selectFairAdPackageRecoveryIds(
  pages: AdPackageRecoveryPages,
  now: string,
  limit = AD_PACKAGE_RECOVERY_LIMIT,
): string[] {
  const groups = [
    collectDueAdPackageRecoveryIds(pages.reviewed, now, limit),
    collectDueAdPackageRecoveryIds(pages.failedDue, now, limit),
    collectDueAdPackageRecoveryIds(pages.expiredLease, now, limit),
  ];
  const selected: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const group of groups) {
      const packageId = group[index];
      if (packageId === undefined || seen.has(packageId)) continue;
      seen.add(packageId);
      selected.push(packageId);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export async function runAdPackageGenerationRecovery(
  dependencies: AdPackageGenerationRuntimeDependencies,
): Promise<{ selected: number; completed: number; retryable: number }> {
  const now = dependencies.now();
  const pages: AdPackageRecoveryPages = {
    reviewed: [],
    failedDue: [],
    expiredLease: [],
  };
  for (const kind of ["reviewed", "failedDue", "expiredLease"] as const) {
    pages[kind] = await dependencies.database.listRecoveryPackages({
      kind,
      dueAtOrBefore: now,
      limit: AD_PACKAGE_RECOVERY_LIMIT,
    });
  }
  const packageIds = selectFairAdPackageRecoveryIds(
    pages,
    now,
    AD_PACKAGE_RECOVERY_LIMIT,
  );
  let cursor = 0;
  let completed = 0;
  let retryable = 0;
  async function worker(): Promise<void> {
    while (cursor < packageIds.length) {
      const index = cursor++;
      try {
        const result = await processAdPackageGeneration(
          packageIds[index],
          dependencies,
        );
        if (result === "complete" || result === "alreadyComplete") completed += 1;
      } catch (error) {
        if (error instanceof AdPackageGenerationRetryableError) retryable += 1;
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(RECOVERY_CONCURRENCY, packageIds.length) },
    () => worker(),
  ));
  return { selected: packageIds.length, completed, retryable };
}

import { Buffer } from "node:buffer";

import {
  ensureExactDriveFolder,
  type DriveFolderAdapter,
} from "../drive/folders.js";
import {
  ARTIFACT_SET_VERSION,
  buildAdPackageArtifacts,
  readFrozenAdPackage,
  storageBase64Md5ToDriveHex,
  type AdPackageArtifacts,
  type AdPackageMediaArtifact,
  type AdPackageTextArtifact,
  type FrozenAdPackageSource,
} from "./ad-package-artifacts.js";
import { buildAdPackageRecoveryKey } from "./generation-recovery-key.js";

type UnknownRecord = Record<string, unknown>;

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const PACKAGE_ID_PATTERN =
  /^ad-package-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const SIZE_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const MIN_LEASE_MILLISECONDS = 30_000;
const MAX_LEASE_MILLISECONDS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const BASE_RETRY_MILLISECONDS = 30_000;
const MAX_RETRY_MILLISECONDS = 6 * 60 * 60_000;
const REPAIRABLE_FAILURE_CODES = new Set([
  "ad_package_sources_pending",
  "ad_package_drive_config_invalid",
]);
type RepairableGenerationKind = "sourcesPending" | "driveConfig";

function repairableKindForFailureCode(
  code: unknown,
): RepairableGenerationKind | undefined {
  if (code === "ad_package_sources_pending") return "sourcesPending";
  if (code === "ad_package_drive_config_invalid") return "driveConfig";
  return undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function isSafeToken(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value);
}

function isDriveId(value: unknown): value is string {
  return typeof value === "string" && DRIVE_ID_PATTERN.test(value);
}

function isPackageId(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_ID_PATTERN.test(value);
}

function stateRoot(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error("ad_package_generation_state_invalid");
  return value;
}

function branch(root: UnknownRecord, key: string): UnknownRecord {
  const value = root[key];
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("ad_package_generation_state_invalid");
  return value;
}

function packageRecord(root: UnknownRecord, packageId: string): UnknownRecord {
  const value = branch(root, "adPackages")[packageId];
  if (!isRecord(value) || value.id !== packageId) {
    throw new Error("ad_package_generation_source_invalid");
  }
  return value;
}

function cloneRoot(root: UnknownRecord): UnknownRecord {
  return structuredClone(root);
}

function sourceArtifacts(value: UnknownRecord): AdPackageArtifacts {
  try {
    return buildAdPackageArtifacts(value);
  } catch {
    throw new Error("ad_package_generation_source_invalid");
  }
}

interface GenerationState {
  status: "reviewed" | "generating" | "failed" | "complete";
  attemptCount: number;
  generationNumber: number;
  updatedAt: string;
  sourceFingerprint?: string;
  leaseOwner?: string;
  leaseToken?: string;
  leaseUntil?: string;
  failedAt?: string;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  retryExhausted?: true;
  terminalFailure?: true;
  terminalAt?: string;
  completedAt?: string;
  recoveryKey?: string;
  repairableKind?: RepairableGenerationKind;
}

function generationState(value: UnknownRecord): GenerationState {
  const generation = value.generation;
  if (
    !isRecord(generation)
    || (generation.status !== "reviewed"
      && generation.status !== "generating"
      && generation.status !== "failed"
      && generation.status !== "complete")
    || generation.status !== value.status
    || !Number.isSafeInteger(generation.attemptCount)
    || (generation.attemptCount as number) < 0
    || (generation.attemptCount as number) > MAX_ATTEMPTS
    || !Number.isSafeInteger(generation.generationNumber)
    || generation.generationNumber !== generation.attemptCount
    || !canonicalIso(generation.updatedAt)
  ) {
    throw new Error("ad_package_generation_state_invalid");
  }
  if (
    generation.status === "reviewed"
    && (
      generation.attemptCount !== 0
      || generation.generationNumber !== 0
      || generation.recoveryKey !== buildAdPackageRecoveryKey(
        "reviewed",
        generation.updatedAt as string,
        value.id as string,
      )
    )
  ) {
    throw new Error("ad_package_generation_state_invalid");
  }
  if (generation.status !== "reviewed") {
    if (
      typeof generation.sourceFingerprint !== "string"
      || !FINGERPRINT_PATTERN.test(generation.sourceFingerprint)
      || generation.sourceFingerprint !== value.sourceFingerprint
    ) {
      throw new Error("ad_package_generation_state_invalid");
    }
  }
  if (generation.status === "generating" && (
    !isSafeToken(generation.leaseOwner)
    || !isSafeToken(generation.leaseToken)
    || !canonicalIso(generation.leaseUntil)
    || generation.recoveryKey !== buildAdPackageRecoveryKey(
      "generating",
      generation.leaseUntil as string,
      value.id as string,
    )
    || (generation.repairableKind !== undefined
      && generation.repairableKind !== "sourcesPending"
      && generation.repairableKind !== "driveConfig")
  )) {
    throw new Error("ad_package_generation_state_invalid");
  }
  const attemptCount = generation.attemptCount as number;
  if (generation.status === "failed" && (
    !canonicalIso(generation.failedAt)
    || typeof generation.lastErrorCode !== "string"
    || !SAFE_FAILURE_CODES.has(generation.lastErrorCode)
    || generation.repairableKind
      !== repairableKindForFailureCode(generation.lastErrorCode)
    || (generation.terminalFailure === true
      ? (!canonicalIso(generation.terminalAt)
        || generation.terminalAt !== generation.failedAt
        || generation.nextAttemptAt !== undefined
        || generation.recoveryKey !== undefined)
      : attemptCount < MAX_ATTEMPTS
          || REPAIRABLE_FAILURE_CODES.has(generation.lastErrorCode as string)
        ? (!canonicalIso(generation.nextAttemptAt)
          || generation.recoveryKey !== buildAdPackageRecoveryKey(
            "failed",
            generation.nextAttemptAt as string,
            value.id as string,
          ))
        : generation.retryExhausted !== true)
  )) {
    throw new Error("ad_package_generation_state_invalid");
  }
  if (generation.status === "complete" && !canonicalIso(generation.completedAt)) {
    throw new Error("ad_package_generation_state_invalid");
  }
  if (
    (generation.status === "reviewed" || generation.status === "complete")
    && generation.repairableKind !== undefined
  ) throw new Error("ad_package_generation_state_invalid");
  return generation as unknown as GenerationState;
}

export interface AdPackageGenerationClaimInput {
  packageId: string;
  workerId: string;
  leaseToken: string;
  now: string;
  leaseDurationMs: number;
}

export type AdPackageGenerationClaimDecision =
  | { status: "claimed"; write: boolean; state: UnknownRecord }
  | {
      status: "busy" | "notDue";
      write: false;
      state: UnknownRecord;
    }
  | { status: "terminal"; write: boolean; state: UnknownRecord };

function validateClaimInput(input: AdPackageGenerationClaimInput): void {
  if (
    !isRecord(input)
    || !isPackageId(input.packageId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !canonicalIso(input.now)
    || !Number.isSafeInteger(input.leaseDurationMs)
    || input.leaseDurationMs < MIN_LEASE_MILLISECONDS
    || input.leaseDurationMs > MAX_LEASE_MILLISECONDS
  ) {
    throw new Error("ad_package_generation_claim_invalid");
  }
}

export function reduceAdPackageGenerationClaim(
  current: unknown,
  input: AdPackageGenerationClaimInput,
): AdPackageGenerationClaimDecision {
  validateClaimInput(input);
  const root = stateRoot(current);
  const pkg = packageRecord(root, input.packageId);
  const artifacts = sourceArtifacts(pkg);
  const generation = generationState(pkg);
  if (generation.status === "complete") {
    return { status: "terminal", write: false, state: root };
  }
  const nowMilliseconds = Date.parse(input.now);
  if (generation.status === "generating") {
    if (
      generation.leaseOwner === input.workerId
      && generation.leaseToken === input.leaseToken
      && Date.parse(generation.leaseUntil as string) > nowMilliseconds
    ) {
      return { status: "claimed", write: false, state: root };
    }
    if (Date.parse(generation.leaseUntil as string) > nowMilliseconds) {
      return { status: "busy", write: false, state: root };
    }
    if (
      generation.attemptCount >= MAX_ATTEMPTS
      && generation.repairableKind === undefined
    ) {
      const next = cloneRoot(root);
      const nextPackage = packageRecord(next, input.packageId);
      nextPackage.status = "failed";
      nextPackage.generation = {
        status: "failed",
        attemptCount: generation.attemptCount,
        generationNumber: generation.generationNumber,
        sourceFingerprint: artifacts.sourceFingerprint,
        failedAt: input.now,
        updatedAt: input.now,
        lastErrorCode: "ad_package_generation_failed",
        retryExhausted: true,
      };
      return { status: "terminal", write: true, state: next };
    }
  } else if (generation.status === "failed") {
    if (generation.terminalFailure === true) {
      return { status: "terminal", write: false, state: root };
    }
    if (
      generation.attemptCount >= MAX_ATTEMPTS
      && generation.repairableKind === undefined
    ) {
      return { status: "terminal", write: false, state: root };
    }
    if (Date.parse(generation.nextAttemptAt as string) > nowMilliseconds) {
      return { status: "notDue", write: false, state: root };
    }
  }
  if (
    generation.attemptCount >= MAX_ATTEMPTS
    && generation.status !== "generating"
    && generation.repairableKind === undefined
  ) {
    return { status: "terminal", write: false, state: root };
  }
  const next = cloneRoot(root);
  const nextPackage = packageRecord(next, input.packageId);
  const attemptCount = Math.min(MAX_ATTEMPTS, generation.attemptCount + 1);
  nextPackage.status = "generating";
  nextPackage.generation = {
    status: "generating",
    attemptCount,
    generationNumber: attemptCount,
    sourceFingerprint: artifacts.sourceFingerprint,
    leaseOwner: input.workerId,
    leaseToken: input.leaseToken,
    leaseUntil: new Date(
      nowMilliseconds + input.leaseDurationMs,
    ).toISOString(),
    updatedAt: input.now,
    ...(generation.repairableKind === undefined
      ? {}
      : { repairableKind: generation.repairableKind }),
  };
  (nextPackage.generation as UnknownRecord).recoveryKey =
    buildAdPackageRecoveryKey(
      "generating",
      (nextPackage.generation as UnknownRecord).leaseUntil as string,
      input.packageId,
    );
  return { status: "claimed", write: true, state: next };
}

interface ClaimedPackageInput {
  packageId: string;
  workerId: string;
  leaseToken: string;
  generationNumber: number;
  sourceFingerprint: string;
}

function validateClaimedIdentity(
  input: ClaimedPackageInput,
  time: unknown,
  errorCode: string,
): void {
  if (
    !isRecord(input)
    || !isPackageId(input.packageId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !Number.isSafeInteger(input.generationNumber)
    || input.generationNumber < 1
    || input.generationNumber > MAX_ATTEMPTS
    || typeof input.sourceFingerprint !== "string"
    || !FINGERPRINT_PATTERN.test(input.sourceFingerprint)
    || !canonicalIso(time)
  ) {
    throw new Error(errorCode);
  }
}

type ClaimValidation =
  | {
      status: "valid";
      pkg: UnknownRecord;
      generation: GenerationState;
      artifacts: AdPackageArtifacts;
    }
  | { status: "staleLease" }
  | { status: "staleSource" };

function validateActiveClaim(
  root: UnknownRecord,
  input: ClaimedPackageInput,
  now: string,
): ClaimValidation {
  let pkg: UnknownRecord;
  try {
    pkg = packageRecord(root, input.packageId);
  } catch {
    return { status: "staleSource" };
  }
  let artifacts: AdPackageArtifacts;
  try {
    artifacts = sourceArtifacts(pkg);
  } catch {
    return { status: "staleSource" };
  }
  if (
    artifacts.sourceFingerprint !== input.sourceFingerprint
    || pkg.sourceFingerprint !== input.sourceFingerprint
  ) {
    return { status: "staleSource" };
  }
  let generation: GenerationState;
  try {
    generation = generationState(pkg);
  } catch {
    return { status: "staleLease" };
  }
  if (
    generation.status !== "generating"
    || generation.leaseOwner !== input.workerId
    || generation.leaseToken !== input.leaseToken
    || generation.generationNumber !== input.generationNumber
    || Date.parse(generation.leaseUntil as string) <= Date.parse(now)
  ) {
    return { status: "staleLease" };
  }
  return { status: "valid", pkg, generation, artifacts };
}

interface DriveSourceReceipt {
  mediaId: string;
  objectGeneration: string;
  driveFileId: string;
  sessionFolderId: string;
}

function exactMediaReceipt(
  root: UnknownRecord,
  source: FrozenAdPackageSource,
): { sessionFolderId: string; receipts: Map<string, DriveSourceReceipt> } {
  const mediaBranch = branch(root, "media");
  const jobs = branch(root, "driveSyncJobs");
  const receipts = new Map<string, DriveSourceReceipt>();
  let commonSessionFolderId: string | undefined;
  for (const manifest of source.mediaManifest) {
    const media = mediaBranch[manifest.id];
    const job = jobs[manifest.id];
    let driveMd5Checksum: string;
    try {
      driveMd5Checksum = isRecord(media)
        ? storageBase64Md5ToDriveHex(media.objectMd5Hash)
        : "";
    } catch {
      throw new Error("ad_package_drive_receipt_invalid");
    }
    if (
      !isRecord(media)
      || media.id !== manifest.id
      || media.buildingId !== manifest.buildingId
      || media.captureSessionId !== manifest.captureSessionId
      || media.kind !== manifest.kind
      || media.mimeType !== manifest.mimeType
      || media.sizeBytes !== manifest.sizeBytes
      || media.storagePath !== manifest.storagePath
      || media.objectGeneration !== manifest.objectGeneration
      || driveMd5Checksum !== manifest.driveMd5Checksum
      || media.captureQualityState !== manifest.captureQualityState
      || media.captureSessionId !== source.captureSessionId
      || media.driveSyncState !== "complete"
      || !isDriveId(media.driveFileId)
      || !isRecord(job)
      || job.id !== manifest.id
      || job.mediaId !== manifest.id
      || job.status !== "complete"
      || job.objectGeneration !== manifest.objectGeneration
      || job.driveFileId !== media.driveFileId
      || !isRecord(job.folderIds)
      || !isDriveId(job.folderIds.session)
      || !isDriveId(job.folderIds.originalPhotos)
      || !isDriveId(job.folderIds.verticalVideos)
    ) {
      throw new Error("ad_package_drive_receipt_invalid");
    }
    if (
      commonSessionFolderId !== undefined
      && commonSessionFolderId !== job.folderIds.session
    ) {
      throw new Error("ad_package_drive_receipt_invalid");
    }
    commonSessionFolderId = job.folderIds.session;
    receipts.set(manifest.id, {
      mediaId: manifest.id,
      objectGeneration: manifest.objectGeneration,
      driveFileId: media.driveFileId,
      sessionFolderId: job.folderIds.session,
    });
  }
  if (commonSessionFolderId === undefined) {
    throw new Error("ad_package_drive_receipt_invalid");
  }
  return { sessionFolderId: commonSessionFolderId, receipts };
}

export interface AdPackageArtifactProperties {
  bringPackageId: string;
  bringPackageVersion: string;
  bringArtifactKey: string;
  bringSourceId: string;
  bringSourceGeneration: string;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

function safePropertyValue(value: unknown, maximumBytes = 256): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validProperties(value: unknown): value is AdPackageArtifactProperties {
  if (!isRecord(value)) return false;
  const keys = [
    "bringPackageId",
    "bringPackageVersion",
    "bringArtifactKey",
    "bringSourceId",
    "bringSourceGeneration",
  ] as const;
  return Object.keys(value).length === keys.length
    && keys.every((key) => safePropertyValue(value[key]));
}

export function buildExactAdArtifactQuery(
  parentId: string,
  appProperties: AdPackageArtifactProperties,
): string {
  if (!isDriveId(parentId) || !validProperties(appProperties)) {
    throw new Error("ad_package_file_request_invalid");
  }
  const properties = Object.entries(appProperties).map(([key, value]) =>
    `appProperties has { key = '${key}' and value = '${escapeQuery(value)}' }`)
    .join(" and ");
  return `'${escapeQuery(parentId)}' in parents and trashed = false and ${properties}`;
}

export interface AdPackageArtifactListRequest {
  parentId: string;
  appProperties: AdPackageArtifactProperties;
  query: string;
  pageSize: 3;
  fields: "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)";
}

export interface AdPackageMediaCopyRequest {
  sourceFileId: string;
  parentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum: string;
  appProperties: AdPackageArtifactProperties;
  fields: "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties";
}

export interface AdPackageTextUploadRequest {
  parentId: string;
  name: string;
  mimeType: "text/plain";
  bytes: Uint8Array;
  md5Checksum: string;
  appProperties: AdPackageArtifactProperties;
  fields: "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties";
}

export interface AdPackageDriveAdapter extends DriveFolderAdapter {
  listExactArtifactFiles(input: AdPackageArtifactListRequest): Promise<unknown>;
  copyExistingFile(input: AdPackageMediaCopyRequest): Promise<unknown>;
  uploadUtf8File(input: AdPackageTextUploadRequest): Promise<unknown>;
}

interface ExpectedFile {
  parentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum: string;
  appProperties: AdPackageArtifactProperties;
}

interface SafeArtifactFile {
  id: string;
  name: string;
  mimeType: string;
  parents: [string];
  trashed: false;
  size: string;
  md5Checksum: string;
  appProperties: AdPackageArtifactProperties;
}

function safeArtifactFile(value: unknown, expected: ExpectedFile): SafeArtifactFile {
  if (
    !isRecord(value)
    || !isDriveId(value.id)
    || value.name !== expected.name
    || value.mimeType !== expected.mimeType
    || value.trashed !== false
    || !Array.isArray(value.parents)
    || value.parents.length !== 1
    || value.parents[0] !== expected.parentId
    || typeof value.size !== "string"
    || !SIZE_PATTERN.test(value.size)
    || Number(value.size) !== expected.sizeBytes
    || value.md5Checksum !== expected.md5Checksum
    || !validProperties(value.appProperties)
    || Object.entries(expected.appProperties).some(([key, expectedValue]) =>
      (value.appProperties as UnknownRecord)[key] !== expectedValue)
  ) {
    throw new Error("ad_package_file_mismatch");
  }
  return {
    id: value.id,
    name: expected.name,
    mimeType: expected.mimeType,
    parents: [expected.parentId],
    trashed: false,
    size: value.size,
    md5Checksum: expected.md5Checksum,
    appProperties: { ...expected.appProperties },
  };
}

async function listExactArtifact(
  adapter: AdPackageDriveAdapter,
  expected: ExpectedFile,
): Promise<SafeArtifactFile[]> {
  const response = await adapter.listExactArtifactFiles({
    parentId: expected.parentId,
    appProperties: expected.appProperties,
    query: buildExactAdArtifactQuery(
      expected.parentId,
      expected.appProperties,
    ),
    pageSize: 3,
    fields: "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)",
  });
  if (!Array.isArray(response) || response.length > 3) {
    throw new Error("ad_package_file_response_invalid");
  }
  if (response.length > 1) throw new Error("ad_package_file_duplicate");
  return response.map((item) => safeArtifactFile(item, expected));
}

function properties(
  artifacts: AdPackageArtifacts,
  artifactKey: string,
  sourceId: string,
  sourceGeneration: string,
): AdPackageArtifactProperties {
  return {
    bringPackageId: artifacts.packageId,
    bringPackageVersion: String(artifacts.version),
    bringArtifactKey: artifactKey,
    bringSourceId: sourceId,
    bringSourceGeneration: sourceGeneration,
  };
}

const NON_RECOVERABLE_FILE_ERRORS = new Set([
  "ad_package_file_duplicate",
  "ad_package_file_mismatch",
  "ad_package_file_response_invalid",
  "ad_package_file_request_invalid",
]);

async function ensureMediaArtifact(
  adapter: AdPackageDriveAdapter,
  artifacts: AdPackageArtifacts,
  artifact: AdPackageMediaArtifact,
  parentId: string,
  sourceFileId: string,
): Promise<string> {
  const appProperties = properties(
    artifacts,
    artifact.artifactKey,
    artifact.sourceMediaId,
    artifact.sourceObjectGeneration,
  );
  const expected: ExpectedFile = {
    parentId,
    name: artifact.name,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    md5Checksum: artifact.md5Checksum,
    appProperties,
  };
  const existing = await listExactArtifact(adapter, expected);
  if (existing.length === 1) return existing[0].id;
  try {
    return safeArtifactFile(await adapter.copyExistingFile({
      sourceFileId,
      ...expected,
      fields: "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties",
    }), expected).id;
  } catch (error) {
    if (error instanceof Error && NON_RECOVERABLE_FILE_ERRORS.has(error.message)) {
      throw error;
    }
    const afterUnknownResult = await listExactArtifact(adapter, expected);
    if (afterUnknownResult.length === 1) return afterUnknownResult[0].id;
    throw new Error("ad_package_drive_failed");
  }
}

async function ensureTextArtifact(
  adapter: AdPackageDriveAdapter,
  artifacts: AdPackageArtifacts,
  artifact: AdPackageTextArtifact,
  parentId: string,
): Promise<string> {
  const appProperties = properties(
    artifacts,
    artifact.artifactKey,
    artifacts.packageId,
    artifacts.sourceFingerprint,
  );
  const expected: ExpectedFile = {
    parentId,
    name: artifact.name,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    md5Checksum: artifact.md5Checksum,
    appProperties,
  };
  const existing = await listExactArtifact(adapter, expected);
  if (existing.length === 1) return existing[0].id;
  try {
    return safeArtifactFile(await adapter.uploadUtf8File({
      parentId,
      name: artifact.name,
      mimeType: artifact.mimeType,
      bytes: artifact.bytes,
      md5Checksum: artifact.md5Checksum,
      appProperties,
      fields: "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties",
    }), expected).id;
  } catch (error) {
    if (error instanceof Error && NON_RECOVERABLE_FILE_ERRORS.has(error.message)) {
      throw error;
    }
    const afterUnknownResult = await listExactArtifact(adapter, expected);
    if (afterUnknownResult.length === 1) return afterUnknownResult[0].id;
    throw new Error("ad_package_drive_failed");
  }
}

export interface GenerateClaimedAdPackageInput {
  packageId: string;
  workerId: string;
  leaseToken: string;
  generationNumber: number;
  now: string;
}

export interface AdPackageGenerationOutput {
  packageId: string;
  version: number;
  artifactSetVersion: typeof ARTIFACT_SET_VERSION;
  sourceFingerprint: string;
  generationNumber: number;
  folderIds: {
    session: string;
    package: string;
    representativePhotos: string;
    originalPhotos: string;
    verticalVideos: string;
  };
  artifactFiles: Record<string, string>;
}

export async function generateClaimedAdPackage(
  current: unknown,
  input: GenerateClaimedAdPackageInput,
  adapter: AdPackageDriveAdapter,
): Promise<AdPackageGenerationOutput> {
  if (!isRecord(input) || !canonicalIso(input.now)) {
    throw new Error("ad_package_generation_request_invalid");
  }
  const root = stateRoot(current);
  let fingerprint: unknown;
  try {
    fingerprint = packageRecord(root, input.packageId).sourceFingerprint;
  } catch {
    throw new Error("ad_package_generation_source_invalid");
  }
  validateClaimedIdentity(
    { ...input, sourceFingerprint: fingerprint as string },
    input.now,
    "ad_package_generation_request_invalid",
  );
  const claim = validateActiveClaim(
    root,
    { ...input, sourceFingerprint: fingerprint as string },
    input.now,
  );
  if (claim.status === "staleLease") {
    throw new Error("ad_package_generation_lease_stale");
  }
  if (claim.status === "staleSource") {
    throw new Error("ad_package_generation_source_invalid");
  }
  const source = readFrozenAdPackage(claim.pkg);
  const sourceReceipt = exactMediaReceipt(root, source);
  const packageFolder = await ensureExactDriveFolder(
    sourceReceipt.sessionFolderId,
    claim.artifacts.packageFolderName,
    adapter,
  );
  const representativePhotos = await ensureExactDriveFolder(
    packageFolder,
    "01_광고용_대표사진",
    adapter,
  );
  const originalPhotos = await ensureExactDriveFolder(
    packageFolder,
    "02_전체원본사진",
    adapter,
  );
  const verticalVideos = await ensureExactDriveFolder(
    packageFolder,
    "03_세로영상",
    adapter,
  );
  const artifactFiles: Record<string, string> = {};
  const ensureMediaGroup = async (
    group: readonly AdPackageMediaArtifact[],
    parentId: string,
  ) => {
    for (const artifact of group) {
      const receipt = sourceReceipt.receipts.get(artifact.sourceMediaId);
      if (
        receipt === undefined
        || receipt.objectGeneration !== artifact.sourceObjectGeneration
      ) {
        throw new Error("ad_package_drive_receipt_invalid");
      }
      artifactFiles[artifact.artifactKey] = await ensureMediaArtifact(
        adapter,
        claim.artifacts,
        artifact,
        parentId,
        receipt.driveFileId,
      );
    }
  };
  await ensureMediaGroup(claim.artifacts.representativePhotos, representativePhotos);
  await ensureMediaGroup(claim.artifacts.originalPhotos, originalPhotos);
  await ensureMediaGroup(claim.artifacts.verticalVideos, verticalVideos);
  artifactFiles[claim.artifacts.daangn.artifactKey] = await ensureTextArtifact(
    adapter,
    claim.artifacts,
    claim.artifacts.daangn,
    packageFolder,
  );
  artifactFiles[claim.artifacts.naver.artifactKey] = await ensureTextArtifact(
    adapter,
    claim.artifacts,
    claim.artifacts.naver,
    packageFolder,
  );
  return {
    packageId: input.packageId,
    version: claim.artifacts.version,
    artifactSetVersion: ARTIFACT_SET_VERSION,
    sourceFingerprint: claim.artifacts.sourceFingerprint,
    generationNumber: input.generationNumber,
    folderIds: {
      session: sourceReceipt.sessionFolderId,
      package: packageFolder,
      representativePhotos,
      originalPhotos,
      verticalVideos,
    },
    artifactFiles,
  };
}

function exactStringRecord(value: unknown, expectedKeys: readonly string[]): value is Record<string, string> {
  return isRecord(value)
    && Object.keys(value).length === expectedKeys.length
    && expectedKeys.every((key) => isDriveId(value[key]));
}

function expectedArtifactKeys(artifacts: AdPackageArtifacts): string[] {
  return [
    ...artifacts.representativePhotos,
    ...artifacts.originalPhotos,
    ...artifacts.verticalVideos,
    artifacts.daangn,
    artifacts.naver,
  ].map((item) => item.artifactKey);
}

function exactFolderIds(value: unknown): value is AdPackageGenerationOutput["folderIds"] {
  if (!isRecord(value)) return false;
  const keys = [
    "session",
    "package",
    "representativePhotos",
    "originalPhotos",
    "verticalVideos",
  ] as const;
  return Object.keys(value).length === keys.length
    && keys.every((key) => isDriveId(value[key]));
}

function sameStringRecord(left: unknown, right: Record<string, string>): boolean {
  if (!isRecord(left)) return false;
  const keys = Object.keys(right);
  return Object.keys(left).length === keys.length
    && keys.every((key) => left[key] === right[key]);
}

function sameFolderIds(
  left: unknown,
  right: AdPackageGenerationOutput["folderIds"],
): boolean {
  if (!exactFolderIds(left)) return false;
  return Object.keys(right).every((key) =>
    left[key as keyof typeof right] === right[key as keyof typeof right]);
}

export interface AdPackageGenerationSuccessInput extends AdPackageGenerationOutput {
  workerId: string;
  leaseToken: string;
  completedAt: string;
}

export type AdPackageGenerationSuccessDecision =
  | { status: "committed"; write: true; state: UnknownRecord }
  | {
      status: "alreadyCommitted" | "staleLease" | "staleSource";
      write: false;
      state: UnknownRecord;
    };

function validateSuccessShape(
  input: AdPackageGenerationSuccessInput,
  artifacts: AdPackageArtifacts,
): boolean {
  const keys = expectedArtifactKeys(artifacts);
  return input.version === artifacts.version
    && input.artifactSetVersion === ARTIFACT_SET_VERSION
    && exactFolderIds(input.folderIds)
    && input.folderIds.session.length > 0
    && exactStringRecord(input.artifactFiles, keys)
    && Object.keys(input.artifactFiles).every((key) => keys.includes(key));
}

export function reduceAdPackageGenerationSuccess(
  current: unknown,
  input: AdPackageGenerationSuccessInput,
): AdPackageGenerationSuccessDecision {
  validateClaimedIdentity(input, input.completedAt, "ad_package_generation_commit_invalid");
  const root = stateRoot(current);
  let pkg: UnknownRecord;
  let artifacts: AdPackageArtifacts;
  try {
    pkg = packageRecord(root, input.packageId);
    artifacts = sourceArtifacts(pkg);
  } catch {
    return { status: "staleSource", write: false, state: root };
  }
  if (
    artifacts.sourceFingerprint !== input.sourceFingerprint
    || !validateSuccessShape(input, artifacts)
  ) {
    return { status: "staleSource", write: false, state: root };
  }
  if (pkg.status === "complete") {
    const generation = pkg.generation;
    if (
      isRecord(generation)
      && generation.status === "complete"
      && generation.generationNumber === input.generationNumber
      && generation.sourceFingerprint === input.sourceFingerprint
      && sameFolderIds(pkg.driveFolderIds, input.folderIds)
      && sameStringRecord(pkg.artifactFileIds, input.artifactFiles)
    ) {
      return { status: "alreadyCommitted", write: false, state: root };
    }
    return { status: "staleSource", write: false, state: root };
  }
  const claim = validateActiveClaim(root, input, input.completedAt);
  if (claim.status !== "valid") {
    return { status: claim.status, write: false, state: root };
  }
  let receipt: ReturnType<typeof exactMediaReceipt>;
  try {
    receipt = exactMediaReceipt(root, readFrozenAdPackage(pkg));
  } catch {
    return { status: "staleSource", write: false, state: root };
  }
  if (receipt.sessionFolderId !== input.folderIds.session) {
    return { status: "staleSource", write: false, state: root };
  }
  const next = cloneRoot(root);
  const nextPackage = packageRecord(next, input.packageId);
  nextPackage.status = "complete";
  nextPackage.generatedAt = input.completedAt;
  nextPackage.driveFolderIds = { ...input.folderIds };
  nextPackage.artifactFileIds = { ...input.artifactFiles };
  nextPackage.generation = {
    status: "complete",
    attemptCount: claim.generation.attemptCount,
    generationNumber: input.generationNumber,
    sourceFingerprint: input.sourceFingerprint,
    completedAt: input.completedAt,
    updatedAt: input.completedAt,
  };
  const alerts = branch(next, "adPackageGenerationAlerts");
  if (alerts[input.packageId] !== undefined) {
    delete alerts[input.packageId];
    next.adPackageGenerationAlerts = alerts;
  }
  const auditId = `ad-package-generated-${input.packageId}-${input.generationNumber}`;
  next.auditLogs = {
    ...branch(next, "auditLogs"),
    [auditId]: {
      id: auditId,
      actorId: input.workerId,
      action: "adPackage.generated",
      entityType: "adPackage",
      entityId: input.packageId,
      occurredAt: input.completedAt,
      sourceFingerprint: input.sourceFingerprint,
      artifactSetVersion: ARTIFACT_SET_VERSION,
      version: artifacts.version,
    },
  };
  return { status: "committed", write: true, state: next };
}

const SAFE_FAILURE_CODES = new Set([
  "ad_package_sources_pending",
  "ad_package_source_invalid",
  "ad_package_drive_config_invalid",
  "ad_package_drive_receipt_invalid",
  "ad_package_folder_duplicate",
  "ad_package_folder_response_invalid",
  "ad_package_folder_create_failed",
  "ad_package_file_duplicate",
  "ad_package_file_mismatch",
  "ad_package_file_response_invalid",
  "ad_package_file_request_invalid",
  "ad_package_drive_failed",
  "ad_package_generation_source_invalid",
  "ad_package_generation_lease_stale",
  "ad_package_generation_failed",
]);

export const TERMINAL_AD_PACKAGE_FAILURE_CODES = new Set([
  "ad_package_source_invalid",
  "ad_package_drive_receipt_invalid",
  "ad_package_folder_duplicate",
  "ad_package_folder_response_invalid",
  "ad_package_file_duplicate",
  "ad_package_file_mismatch",
  "ad_package_file_response_invalid",
  "ad_package_file_request_invalid",
  "ad_package_generation_source_invalid",
]);

function safeFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "ad_package_generation_failed";
  const mapped = error.message.startsWith("drive_folder_")
    ? error.message.replace(/^drive_folder_/u, "ad_package_folder_")
    : error.message;
  return SAFE_FAILURE_CODES.has(mapped)
    ? mapped
    : "ad_package_generation_failed";
}

export interface AdPackageGenerationFailureInput extends ClaimedPackageInput {
  failedAt: string;
  error: unknown;
  terminal?: boolean;
}

export type AdPackageGenerationFailureDecision =
  | { status: "failed"; write: true; state: UnknownRecord }
  | { status: "terminal"; write: true; state: UnknownRecord }
  | {
      status: "staleLease" | "staleSource";
      write: false;
      state: UnknownRecord;
    };

export function reduceAdPackageGenerationFailure(
  current: unknown,
  input: AdPackageGenerationFailureInput,
): AdPackageGenerationFailureDecision {
  validateClaimedIdentity(input, input.failedAt, "ad_package_generation_failure_invalid");
  if (input.terminal !== undefined && typeof input.terminal !== "boolean") {
    throw new Error("ad_package_generation_failure_invalid");
  }
  const root = stateRoot(current);
  const claim = validateActiveClaim(root, input, input.failedAt);
  if (claim.status !== "valid") {
    return { status: claim.status, write: false, state: root };
  }
  const next = cloneRoot(root);
  const nextPackage = packageRecord(next, input.packageId);
  const attemptCount = claim.generation.attemptCount;
  const failureCode = safeFailureCode(input.error);
  const terminal = input.terminal === true
    && TERMINAL_AD_PACKAGE_FAILURE_CODES.has(failureCode);
  const generation: UnknownRecord = {
    status: "failed",
    attemptCount,
    generationNumber: input.generationNumber,
    sourceFingerprint: input.sourceFingerprint,
    failedAt: input.failedAt,
    updatedAt: input.failedAt,
    lastErrorCode: failureCode,
    ...(repairableKindForFailureCode(failureCode) === undefined
      ? {}
      : { repairableKind: repairableKindForFailureCode(failureCode) }),
  };
  if (terminal) {
    generation.terminalFailure = true;
    generation.terminalAt = input.failedAt;
  } else if (
    attemptCount >= MAX_ATTEMPTS
    && !REPAIRABLE_FAILURE_CODES.has(failureCode)
  ) {
    generation.retryExhausted = true;
  } else {
    const exponent = Math.min(attemptCount - 1, 20);
    const delay = Math.min(
      MAX_RETRY_MILLISECONDS,
      BASE_RETRY_MILLISECONDS * 2 ** exponent,
    );
    generation.nextAttemptAt = new Date(
      Date.parse(input.failedAt) + delay,
    ).toISOString();
    generation.recoveryKey = buildAdPackageRecoveryKey(
      "failed",
      generation.nextAttemptAt as string,
      input.packageId,
    );
  }
  nextPackage.status = "failed";
  nextPackage.generation = generation;
  const alerts = branch(next, "adPackageGenerationAlerts");
  if (failureCode === "ad_package_drive_config_invalid") {
    alerts[input.packageId] = {
      packageId: input.packageId,
      status: "open",
      code: failureCode,
      attemptCount,
      updatedAt: input.failedAt,
    };
    next.adPackageGenerationAlerts = alerts;
  } else if (alerts[input.packageId] !== undefined) {
    delete alerts[input.packageId];
    next.adPackageGenerationAlerts = alerts;
  }
  return { status: terminal ? "terminal" : "failed", write: true, state: next };
}

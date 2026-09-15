import {
  CAPTURE_ZONES,
  MEDIA_POLICY,
  finalizedPath,
  isRfc4122Uuid,
  isSafeMediaPathSegment,
  type MediaKind,
  type MediaZone,
} from "../field/media-policy.js";
import {
  ensureDriveStructure,
  normalizeDriveName,
  type DriveFolderAdapter,
  type DriveFolderStructure,
} from "./folders.js";
import {
  isSafeDriveFolderIds,
  releaseOwnedDriveFolderLease,
} from "./folder-lease.js";
import { buildDriveRecoveryKey } from "./recovery-key.js";
import {
  nextDriveUploadChunk,
  type DriveResumableChunkInput,
  type DriveResumableProgress,
  type DriveResumableSessionInput,
  type DriveResumableStartInput,
} from "./resumable-upload.js";
import {
  readDriveUploadSession,
  validateDriveUploadSessionSnapshot,
  type DriveUploadSessionBinding,
  type DriveUploadSessionSnapshot,
} from "./upload-session.js";

type UnknownRecord = Record<string, unknown>;

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;
const CANONICAL_SIZE_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const MIN_LEASE_MILLISECONDS = 30_000;
const MAX_LEASE_MILLISECONDS = 15 * 60_000;
const MAX_ATTEMPT_COUNT = 50;
const BASE_RETRY_MILLISECONDS = 30_000;
const MAX_RETRY_MILLISECONDS = 6 * 60 * 60_000;

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

function isGeneration(value: unknown): value is string {
  return typeof value === "string" && GENERATION_PATTERN.test(value);
}

function isBoundedText(value: unknown, maxBytes = 512): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maxBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function stateRoot(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error("drive_sync_state_invalid");
  return value;
}

function stateCollection(root: UnknownRecord, key: string): UnknownRecord {
  const value = root[key];
  if (!isRecord(value)) throw new Error("drive_sync_state_invalid");
  return value;
}

function clonedState(value: unknown): UnknownRecord {
  return structuredClone(stateRoot(value));
}

function jobRecord(root: UnknownRecord, mediaId: string): UnknownRecord {
  const job = stateCollection(root, "driveSyncJobs")[mediaId];
  if (!isRecord(job)) throw new Error("drive_sync_job_invalid");
  return job;
}

function mediaRecord(root: UnknownRecord, mediaId: string): UnknownRecord {
  const media = stateCollection(root, "media")[mediaId];
  if (!isRecord(media)) throw new Error("drive_sync_source_invalid");
  return media;
}

function validAttemptCount(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_ATTEMPT_COUNT;
}

function validJobIdentity(job: UnknownRecord, mediaId: string): boolean {
  return job.id === mediaId
    && job.mediaId === mediaId
    && isSafeMediaPathSegment(job.buildingId)
    && isBoundedText(job.storagePath, 1_024)
    && isGeneration(job.objectGeneration)
    && validAttemptCount(job.attemptCount);
}

function hasExcludedMedia(media: UnknownRecord): boolean {
  return media.excludedAt !== undefined && media.excludedAt !== null;
}

function deleteLeaseFields(job: UnknownRecord): void {
  delete job.leaseOwner;
  delete job.leaseToken;
  delete job.leaseUntil;
}

function deleteRecoveryFields(job: UnknownRecord): void {
  delete job.recoveryKey;
  delete job.nextAttemptAt;
}

function deleteDriveUploadSession(
  root: UnknownRecord,
  mediaId: string,
): void {
  const sessions = root.driveUploadSessions;
  if (sessions === undefined) return;
  if (!isRecord(sessions)) throw new Error("drive_upload_state_invalid");
  delete sessions[mediaId];
  if (Object.keys(sessions).length === 0) delete root.driveUploadSessions;
}

function hasDriveUploadSession(root: UnknownRecord, mediaId: string): boolean {
  const sessions = root.driveUploadSessions;
  if (sessions === undefined) return false;
  if (!isRecord(sessions)) throw new Error("drive_upload_state_invalid");
  return sessions[mediaId] !== undefined;
}

function deleteDriveSyncAlert(root: UnknownRecord, mediaId: string): void {
  const alerts = root.driveSyncAlerts;
  if (alerts === undefined) return;
  if (!isRecord(alerts)) throw new Error("drive_sync_state_invalid");
  delete alerts[mediaId];
  if (Object.keys(alerts).length === 0) delete root.driveSyncAlerts;
}

function recordDriveSyncConfigAlert(
  root: UnknownRecord,
  mediaId: string,
  failedAt: string,
  attemptCount: number,
): void {
  if (!isRecord(root.driveSyncAlerts)) root.driveSyncAlerts = {};
  const alerts = root.driveSyncAlerts as UnknownRecord;
  const existing = alerts[mediaId];
  const firstObservedAt = isRecord(existing)
      && existing.mediaId === mediaId
      && existing.code === "drive_oauth_config_invalid"
      && canonicalIso(existing.firstObservedAt)
    ? existing.firstObservedAt
    : failedAt;
  alerts[mediaId] = {
    id: mediaId,
    mediaId,
    status: "open",
    code: "drive_oauth_config_invalid",
    firstObservedAt,
    lastObservedAt: failedAt,
    updatedAt: failedAt,
    attemptCount,
  };
}

function cancelExcludedState(
  current: unknown,
  mediaId: string,
  cancelledAt: string,
): UnknownRecord {
  const next = clonedState(current);
  const job = jobRecord(next, mediaId);
  const media = mediaRecord(next, mediaId);
  deleteDriveUploadSession(next, mediaId);
  deleteDriveSyncAlert(next, mediaId);
  job.status = "cancelled";
  job.cancelReason = "excluded";
  job.cancelledAt = cancelledAt;
  job.updatedAt = cancelledAt;
  deleteRecoveryFields(job);
  delete job.lastErrorCode;
  deleteLeaseFields(job);
  media.driveSyncState = "cancelled";
  media.driveSyncCancelledAt = cancelledAt;
  return next;
}

export interface DriveSyncClaimInput {
  mediaId: string;
  workerId: string;
  leaseToken: string;
  now: string;
  leaseDurationMs: number;
}

export type DriveSyncClaimDecision =
  | { status: "claimed"; write: boolean; state: UnknownRecord }
  | { status: "busy" | "notDue" | "terminal"; write: false; state: UnknownRecord }
  | { status: "cancelled"; write: true; state: UnknownRecord };

function validateClaimInput(
  input: DriveSyncClaimInput,
): asserts input is DriveSyncClaimInput {
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.mediaId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !canonicalIso(input.now)
    || !Number.isSafeInteger(input.leaseDurationMs)
    || input.leaseDurationMs < MIN_LEASE_MILLISECONDS
    || input.leaseDurationMs > MAX_LEASE_MILLISECONDS
  ) {
    throw new Error("drive_sync_claim_invalid");
  }
}

export function reduceDriveSyncClaim(
  current: unknown,
  input: DriveSyncClaimInput,
): DriveSyncClaimDecision {
  validateClaimInput(input);
  const root = stateRoot(current);
  const job = jobRecord(root, input.mediaId);
  const media = mediaRecord(root, input.mediaId);
  if (!validJobIdentity(job, input.mediaId) || media.id !== input.mediaId) {
    throw new Error("drive_sync_job_invalid");
  }

  if (hasExcludedMedia(media)) {
    if (job.status === "cancelled" && media.driveSyncState === "cancelled") {
      return { status: "terminal", write: false, state: root };
    }
    const released = clonedState(root);
    if (
      job.status === "syncing"
      && isSafeToken(job.leaseOwner)
      && isSafeToken(job.leaseToken)
    ) {
      releaseOwnedDriveFolderLease(released, {
        mediaId: input.mediaId,
        workerId: job.leaseOwner,
        leaseToken: job.leaseToken,
      });
    }
    return {
      status: "cancelled",
      write: true,
      state: cancelExcludedState(released, input.mediaId, input.now),
    };
  }

  if (
    job.status === "complete"
    || job.status === "cancelled"
    || job.status === "terminal"
  ) {
    return { status: "terminal", write: false, state: root };
  }

  const nowMilliseconds = Date.parse(input.now);
  if (job.status === "syncing") {
    if (
      !isSafeToken(job.leaseOwner)
      || !isSafeToken(job.leaseToken)
      || !canonicalIso(job.leaseUntil)
    ) {
      throw new Error("drive_sync_job_invalid");
    }
    if (
      job.leaseOwner === input.workerId
      && job.leaseToken === input.leaseToken
      && Date.parse(job.leaseUntil) > nowMilliseconds
    ) {
      return { status: "claimed", write: false, state: root };
    }
    if (Date.parse(job.leaseUntil) > nowMilliseconds) {
      return { status: "busy", write: false, state: root };
    }
  } else if (job.status === "failed") {
    if (!canonicalIso(job.nextAttemptAt)) {
      throw new Error("drive_sync_job_invalid");
    }
    if (Date.parse(job.nextAttemptAt) > nowMilliseconds) {
      return { status: "notDue", write: false, state: root };
    }
  } else if (job.status !== "queued") {
    throw new Error("drive_sync_job_invalid");
  }

  const next = clonedState(root);
  const nextJob = jobRecord(next, input.mediaId);
  const nextMedia = mediaRecord(next, input.mediaId);
  nextJob.status = "syncing";
  nextJob.leaseOwner = input.workerId;
  nextJob.leaseToken = input.leaseToken;
  nextJob.leaseUntil = new Date(
    nowMilliseconds + input.leaseDurationMs,
  ).toISOString();
  nextJob.recoveryKey = buildDriveRecoveryKey(
    "syncing",
    nextJob.leaseUntil as string,
    input.mediaId,
  );
  nextJob.attemptCount = Math.min(
    MAX_ATTEMPT_COUNT,
    (job.attemptCount as number) + 1,
  );
  nextJob.updatedAt = input.now;
  delete nextJob.nextAttemptAt;
  nextMedia.driveSyncState = "syncing";
  return { status: "claimed", write: true, state: next };
}

export interface DriveSyncLeaseIdentity {
  mediaId: string;
  workerId: string;
  leaseToken: string;
  now: string;
}

export interface DriveSyncContext {
  mediaId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  captureSessionId: string;
  captureDate: string;
  sessionSequence: number;
  managementNumber: string;
  neighborhood: string;
  buildingName: string;
  unitLabel: string;
  kind: MediaKind;
  zone: MediaZone;
  mimeType: string;
  sizeBytes: number;
  originalFileName: string;
  storagePath: string;
  objectGeneration: string;
  objectMd5Hash?: string;
  objectCrc32c?: string;
}

function exactOptionalBinding(
  left: UnknownRecord,
  right: UnknownRecord,
  key: "unitId" | "listingId",
): boolean {
  return left[key] === right[key]
    && (left[key] === undefined || isSafeMediaPathSegment(left[key]));
}

function mediaKindForMime(value: unknown): MediaKind | null {
  if (typeof value !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(
    MEDIA_POLICY.photo.mimeToExtension,
    value,
  )) return "photo";
  if (Object.prototype.hasOwnProperty.call(
    MEDIA_POLICY.video.mimeToExtension,
    value,
  )) return "video";
  return null;
}

function mediaZone(value: unknown, kind: MediaKind): MediaZone | null {
  if (typeof value !== "string") return null;
  const zone = CAPTURE_ZONES.find((candidate) => candidate.id === value);
  return zone?.kind === kind ? zone.id : null;
}

function orderedSessionSequence(
  sessions: UnknownRecord,
  current: UnknownRecord,
): number {
  const createdAt = current.createdAt as string;
  const captureDate = createdAt.slice(0, 10);
  const matching = Object.values(sessions)
    .filter((value): value is UnknownRecord => isRecord(value))
    .filter((value) =>
      canonicalIso(value.createdAt)
      && value.createdAt.slice(0, 10) === captureDate
      && value.buildingId === current.buildingId
      && value.unitId === current.unitId
      && value.listingId === current.listingId
      && isRfc4122Uuid(value.id))
    .sort((left, right) => {
      const timestamp = (left.createdAt as string).localeCompare(
        right.createdAt as string,
      );
      return timestamp !== 0
        ? timestamp
        : (left.id as string).localeCompare(right.id as string);
    });
  const index = matching.findIndex((value) => value.id === current.id);
  if (index < 0 || index >= 9_999) {
    throw new Error("drive_sync_source_invalid");
  }
  return index + 1;
}

function validateLeaseIdentity(
  input: DriveSyncLeaseIdentity,
): asserts input is DriveSyncLeaseIdentity {
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.mediaId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !canonicalIso(input.now)
  ) {
    throw new Error("drive_sync_claim_invalid");
  }
}

export function validateDriveSyncContext(
  current: unknown,
  lease: DriveSyncLeaseIdentity,
): DriveSyncContext {
  validateLeaseIdentity(lease);
  const root = stateRoot(current);
  const job = jobRecord(root, lease.mediaId);
  const media = mediaRecord(root, lease.mediaId);
  if (
    !validJobIdentity(job, lease.mediaId)
    || job.status !== "syncing"
    || job.leaseOwner !== lease.workerId
    || job.leaseToken !== lease.leaseToken
    || !canonicalIso(job.leaseUntil)
    || Date.parse(job.leaseUntil) <= Date.parse(lease.now)
  ) {
    throw new Error("drive_sync_lease_stale");
  }

  const kind = mediaKindForMime(media.mimeType);
  const zone = kind === null ? null : mediaZone(media.zone, kind);
  if (
    media.id !== lease.mediaId
    || media.uploadState !== "finalized"
    || hasExcludedMedia(media)
    || kind === null
    || media.kind !== kind
    || zone === null
    || !isSafeMediaPathSegment(media.buildingId)
    || !isRfc4122Uuid(media.captureSessionId)
    || !isGeneration(media.objectGeneration)
    || !Number.isSafeInteger(media.sizeBytes)
    || (media.sizeBytes as number) <= 0
    || (media.sizeBytes as number) > MEDIA_POLICY[kind].maxBytes
    || !isBoundedText(media.originalFileName, 1_024)
    || !canonicalIso(media.capturedAt)
    || job.buildingId !== media.buildingId
    || job.storagePath !== media.storagePath
    || job.objectGeneration !== media.objectGeneration
    || !exactOptionalBinding(job, media, "unitId")
    || !exactOptionalBinding(job, media, "listingId")
  ) {
    throw new Error("drive_sync_source_invalid");
  }

  let expectedPath: string;
  try {
    expectedPath = finalizedPath(
      media.buildingId,
      lease.mediaId,
      media.mimeType as string,
    );
  } catch {
    throw new Error("drive_sync_source_invalid");
  }
  if (media.storagePath !== expectedPath) {
    throw new Error("drive_sync_source_invalid");
  }

  const building = stateCollection(root, "buildings")[media.buildingId];
  if (
    !isRecord(building)
    || building.id !== media.buildingId
    || !isBoundedText(building.managementNumber)
    || !isBoundedText(building.name)
    || (building.neighborhood !== undefined
      && !isBoundedText(building.neighborhood))
  ) {
    throw new Error("drive_sync_source_invalid");
  }

  let unitLabel = "공용";
  if (media.unitId !== undefined) {
    const unit = stateCollection(root, "units")[media.unitId as string];
    if (
      !isRecord(unit)
      || unit.id !== media.unitId
      || unit.buildingId !== media.buildingId
      || !isBoundedText(unit.unitLabel)
    ) {
      throw new Error("drive_sync_source_invalid");
    }
    unitLabel = unit.unitLabel;
  }
  if (media.listingId !== undefined) {
    if (media.unitId === undefined) {
      throw new Error("drive_sync_source_invalid");
    }
    const listing = stateCollection(root, "listings")[
      media.listingId as string
    ];
    if (
      !isRecord(listing)
      || listing.id !== media.listingId
      || listing.buildingId !== media.buildingId
      || listing.unitId !== media.unitId
    ) {
      throw new Error("drive_sync_source_invalid");
    }
  }

  const sessions = stateCollection(root, "captureSessions");
  const session = sessions[media.captureSessionId as string];
  if (
    !isRecord(session)
    || session.id !== media.captureSessionId
    || session.buildingId !== media.buildingId
    || session.unitId !== media.unitId
    || session.listingId !== media.listingId
    || session.status !== "complete"
    || !canonicalIso(session.createdAt)
  ) {
    throw new Error("drive_sync_source_invalid");
  }

  const objectMd5Hash = media.objectMd5Hash;
  const objectCrc32c = media.objectCrc32c;
  if (
    (objectMd5Hash !== undefined && !isBoundedText(objectMd5Hash, 256))
    || (objectCrc32c !== undefined && !isBoundedText(objectCrc32c, 256))
  ) {
    throw new Error("drive_sync_source_invalid");
  }

  return {
    mediaId: lease.mediaId,
    buildingId: media.buildingId,
    ...(media.unitId === undefined ? {} : { unitId: media.unitId as string }),
    ...(media.listingId === undefined
      ? {}
      : { listingId: media.listingId as string }),
    captureSessionId: media.captureSessionId,
    captureDate: (session.createdAt as string).slice(0, 10),
    sessionSequence: orderedSessionSequence(sessions, session),
    managementNumber: building.managementNumber,
    neighborhood: building.neighborhood === undefined
      ? "동네미지정"
      : building.neighborhood as string,
    buildingName: building.name,
    unitLabel,
    kind,
    zone,
    mimeType: media.mimeType as string,
    sizeBytes: media.sizeBytes as number,
    originalFileName: media.originalFileName,
    storagePath: media.storagePath as string,
    objectGeneration: media.objectGeneration,
    ...(objectMd5Hash === undefined
      ? {}
      : { objectMd5Hash: objectMd5Hash as string }),
    ...(objectCrc32c === undefined
      ? {}
      : { objectCrc32c: objectCrc32c as string }),
  };
}

export interface FinalizedMediaSourceObject {
  path: string;
  generation: string;
  sizeBytes: number;
  mimeType: string;
  md5Hash?: string;
  crc32c?: string;
  body: unknown;
}

export interface FinalizedMediaStorageAdapter {
  readFinalizedObject(input: {
    path: string;
    expectedGeneration: string;
  }): Promise<unknown>;
  readFinalizedObjectMetadata(input: {
    path: string;
    expectedGeneration: string;
  }): Promise<unknown>;
  readFinalizedObjectRange(input: {
    path: string;
    expectedGeneration: string;
    startOffset: number;
    endOffsetInclusive: number;
  }): Promise<unknown>;
}

export interface DriveMediaFileListRequest {
  parentId: string;
  mediaId: string;
  objectGeneration: string;
  query: string;
  pageSize: 3;
  fields: "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)";
}

export interface DriveMediaUploadRequest {
  parentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  body: unknown;
  appProperties: {
    bringMediaId: string;
    bringObjectGeneration: string;
  };
  fields: "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties";
}

export interface DriveMediaAdapter extends DriveFolderAdapter {
  listExactMediaFiles(input: DriveMediaFileListRequest): Promise<unknown>;
  uploadMediaFile(input: DriveMediaUploadRequest): Promise<unknown>;
  startResumableMediaUpload(input: DriveResumableStartInput): Promise<{
    sessionUri: string;
    nextOffset: 0;
  }>;
  probeResumableMediaUpload(
    input: DriveResumableSessionInput,
  ): Promise<DriveResumableProgress>;
  uploadResumableMediaChunk(
    input: DriveResumableChunkInput,
  ): Promise<DriveResumableProgress>;
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

export function buildExactDriveFileQuery(
  parentId: string,
  mediaId: string,
  objectGeneration: string,
): string {
  if (
    !isDriveId(parentId)
    || !isRfc4122Uuid(mediaId)
    || !isGeneration(objectGeneration)
  ) {
    throw new Error("drive_file_request_invalid");
  }
  return `'${escapeDriveQueryLiteral(parentId)}' in parents and trashed = false `
    + `and appProperties has { key = 'bringMediaId' and value = '${
      escapeDriveQueryLiteral(mediaId)
    }' } `
    + `and appProperties has { key = 'bringObjectGeneration' and value = '${
      escapeDriveQueryLiteral(objectGeneration)
    }' }`;
}

interface SafeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: [string];
  trashed: false;
  size: string;
  md5Checksum: string;
  appProperties: {
    bringMediaId: string;
    bringObjectGeneration: string;
  };
}

function safeDriveFile(
  value: unknown,
  expected: {
    parentId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    md5Hash: string;
    mediaId: string;
    objectGeneration: string;
  },
): SafeDriveFile {
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
    || !CANONICAL_SIZE_PATTERN.test(value.size)
    || Number(value.size) !== expected.sizeBytes
    || value.md5Checksum !== expected.md5Hash
    || !isRecord(value.appProperties)
    || value.appProperties.bringMediaId !== expected.mediaId
    || value.appProperties.bringObjectGeneration !== expected.objectGeneration
  ) {
    const hasMatchingIdentity = isRecord(value)
      && isRecord(value.appProperties)
      && value.appProperties.bringMediaId === expected.mediaId
      && value.appProperties.bringObjectGeneration === expected.objectGeneration;
    throw new Error(
      hasMatchingIdentity
        ? "drive_file_checksum_mismatch"
        : "drive_file_response_invalid",
    );
  }
  return {
    id: value.id,
    name: expected.name,
    mimeType: expected.mimeType,
    parents: [expected.parentId],
    trashed: false,
    size: value.size,
    md5Checksum: expected.md5Hash,
    appProperties: {
      bringMediaId: expected.mediaId,
      bringObjectGeneration: expected.objectGeneration,
    },
  };
}

type SourceMetadataExpectation = Pick<
  DriveSyncContext,
  | "storagePath"
  | "objectGeneration"
  | "sizeBytes"
  | "mimeType"
  | "objectMd5Hash"
  | "objectCrc32c"
>;

function safeSourceMetadata(
  value: unknown,
  context: SourceMetadataExpectation,
): Omit<FinalizedMediaSourceObject, "body"> & { md5Hash: string } {
  if (
    !isRecord(value)
    || value.path !== context.storagePath
    || value.generation !== context.objectGeneration
    || value.sizeBytes !== context.sizeBytes
    || value.mimeType !== context.mimeType
    || !isBoundedText(value.md5Hash, 256)
    || (value.crc32c !== undefined && !isBoundedText(value.crc32c, 256))
    || (context.objectMd5Hash !== undefined
      && value.md5Hash !== context.objectMd5Hash)
    || (context.objectCrc32c !== undefined
      && value.crc32c !== context.objectCrc32c)
  ) {
    throw new Error("drive_source_invalid");
  }
  return {
    path: context.storagePath,
    generation: context.objectGeneration,
    sizeBytes: context.sizeBytes,
    mimeType: context.mimeType,
    md5Hash: value.md5Hash,
    ...(value.crc32c === undefined ? {} : { crc32c: value.crc32c as string }),
  };
}

function safeSourceRange(
  value: unknown,
  source: Omit<FinalizedMediaSourceObject, "body"> & { md5Hash: string },
  startOffset: number,
  endOffsetInclusive: number,
): FinalizedMediaSourceObject & {
  md5Hash: string;
  rangeStart: number;
  rangeEndInclusive: number;
} {
  const metadata = safeSourceMetadata(value, {
    storagePath: source.path,
    objectGeneration: source.generation,
    sizeBytes: source.sizeBytes,
    mimeType: source.mimeType,
    objectMd5Hash: source.md5Hash,
    ...(source.crc32c === undefined ? {} : { objectCrc32c: source.crc32c }),
  });
  if (
    !isRecord(value)
    || value.rangeStart !== startOffset
    || value.rangeEndInclusive !== endOffsetInclusive
    || value.body === undefined
    || value.body === null
  ) throw new Error("drive_source_invalid");
  return {
    ...metadata,
    rangeStart: startOffset,
    rangeEndInclusive: endOffsetInclusive,
    body: value.body,
  };
}

async function listExactFiles(
  adapter: DriveMediaAdapter,
  expected: {
    parentId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    md5Hash: string;
    mediaId: string;
    objectGeneration: string;
  },
): Promise<SafeDriveFile[]> {
  const response = await adapter.listExactMediaFiles({
    parentId: expected.parentId,
    mediaId: expected.mediaId,
    objectGeneration: expected.objectGeneration,
    query: buildExactDriveFileQuery(
      expected.parentId,
      expected.mediaId,
      expected.objectGeneration,
    ),
    pageSize: 3,
    fields:
      "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)",
  });
  if (!Array.isArray(response) || response.length > 3) {
    throw new Error("drive_file_response_invalid");
  }
  if (response.length > 1) throw new Error("drive_file_duplicate");
  return response.map((value) => safeDriveFile(value, expected));
}

export interface DriveSyncDependencies {
  storage: FinalizedMediaStorageAdapter;
  drive: DriveMediaAdapter;
  publishFolderIds?(
    folderIds: DriveFolderStructure["ids"],
  ): Promise<DriveFolderStructure["ids"]>;
  checkpointUploadSession(input: DriveUploadSessionBinding & {
    sessionUri: string;
    nextOffset: number;
  }): Promise<DriveUploadSessionSnapshot>;
}

export interface SyncClaimedDriveMediaInput extends DriveSyncLeaseIdentity {
  rootFolderId: string;
  folderIds?: DriveFolderStructure["ids"];
}

export interface DriveSyncUploadResult {
  mediaId: string;
  objectGeneration: string;
  driveFileId: string;
  driveFileName: string;
  folderIds: DriveFolderStructure["ids"];
}

export async function syncClaimedDriveMedia(
  current: unknown,
  input: SyncClaimedDriveMediaInput,
  dependencies: DriveSyncDependencies,
): Promise<DriveSyncUploadResult> {
  const context = validateDriveSyncContext(current, input);
  const source = safeSourceMetadata(
    await dependencies.storage.readFinalizedObjectMetadata({
      path: context.storagePath,
      expectedGeneration: context.objectGeneration,
    }),
    context,
  );
  let folderIds = input.folderIds;
  if (folderIds === undefined) {
    folderIds = (await ensureDriveStructure({
      rootFolderId: input.rootFolderId,
      managementNumber: context.managementNumber,
      neighborhood: context.neighborhood,
      buildingName: context.buildingName,
      unitLabel: context.unitLabel,
      captureDate: context.captureDate,
      sessionSequence: context.sessionSequence,
    }, dependencies.drive)).ids;
    if (dependencies.publishFolderIds !== undefined) {
      folderIds = await dependencies.publishFolderIds(folderIds);
    }
  }
  if (!isSafeDriveFolderIds(folderIds) || folderIds.root !== input.rootFolderId) {
    throw new Error("drive_folder_state_invalid");
  }
  const targetFolderId = context.kind === "video"
    ? folderIds.verticalVideos
    : folderIds.originalPhotos;
  const extension = context.storagePath.split(".").pop() ?? "bin";
  const driveFileName = normalizeDriveName(
    context.originalFileName,
    `${context.mediaId}.${extension}`,
    180,
  );
  const expected = {
    parentId: targetFolderId,
    name: driveFileName,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    md5Hash: source.md5Hash,
    mediaId: context.mediaId,
    objectGeneration: context.objectGeneration,
  };
  const existing = await listExactFiles(dependencies.drive, expected);
  let driveFile: SafeDriveFile;
  if (existing.length === 1) {
    driveFile = existing[0];
  } else {
    const sessionBinding: DriveUploadSessionBinding = {
      mediaId: context.mediaId,
      objectGeneration: context.objectGeneration,
      totalSizeBytes: source.sizeBytes,
      parentId: targetFolderId,
      fileName: driveFileName,
      mimeType: source.mimeType,
    };
    try {
      let session = readDriveUploadSession(current, sessionBinding);
      let progress: DriveResumableProgress;
      if (session === null) {
        const started = await dependencies.drive.startResumableMediaUpload({
          parentId: targetFolderId,
          name: driveFileName,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          appProperties: {
            bringMediaId: context.mediaId,
            bringObjectGeneration: context.objectGeneration,
          },
        });
        session = validateDriveUploadSessionSnapshot(
          await dependencies.checkpointUploadSession({
            ...sessionBinding,
            sessionUri: started.sessionUri,
            nextOffset: started.nextOffset,
          }),
          sessionBinding,
        );
        if (session.nextOffset !== 0) {
          throw new Error("drive_upload_state_invalid");
        }
        progress = { status: "active", nextOffset: 0 };
      } else {
        progress = await dependencies.drive.probeResumableMediaUpload({
          sessionUri: session.sessionUri,
          totalSizeBytes: source.sizeBytes,
        });
      }

      if (progress.status === "complete") {
        driveFile = safeDriveFile(progress.file, expected);
      } else {
        if (session === null) throw new Error("drive_upload_state_invalid");
        if (session.nextOffset !== progress.nextOffset) {
          session = validateDriveUploadSessionSnapshot(
            await dependencies.checkpointUploadSession({
              ...sessionBinding,
              sessionUri: session.sessionUri,
              nextOffset: progress.nextOffset,
            }),
            sessionBinding,
          );
        }
        let nextOffset = progress.nextOffset;
        let completed: SafeDriveFile | null = null;
        while (nextOffset < source.sizeBytes) {
          const chunk = nextDriveUploadChunk(nextOffset, source.sizeBytes);
          const range = safeSourceRange(
            await dependencies.storage.readFinalizedObjectRange({
              path: context.storagePath,
              expectedGeneration: context.objectGeneration,
              ...chunk,
            }),
            source,
            chunk.startOffset,
            chunk.endOffsetInclusive,
          );
          const result = await dependencies.drive.uploadResumableMediaChunk({
            sessionUri: session.sessionUri,
            mimeType: source.mimeType,
            totalSizeBytes: source.sizeBytes,
            ...chunk,
            body: range.body,
          });
          if (result.status === "complete") {
            completed = safeDriveFile(result.file, expected);
            break;
          }
          if (
            result.nextOffset <= nextOffset
            || result.nextOffset >= source.sizeBytes
          ) throw new Error("drive_upload_incomplete");
          session = validateDriveUploadSessionSnapshot(
            await dependencies.checkpointUploadSession({
              ...sessionBinding,
              sessionUri: session.sessionUri,
              nextOffset: result.nextOffset,
            }),
            sessionBinding,
          );
          if (session.nextOffset !== result.nextOffset) {
            throw new Error("drive_upload_state_invalid");
          }
          nextOffset = result.nextOffset;
        }
        if (completed === null) throw new Error("drive_upload_incomplete");
        driveFile = completed;
      }
    } catch (error) {
      if (
        error instanceof Error
        && (error.message === "drive_file_checksum_mismatch"
          || error.message === "drive_file_response_invalid"
          || error.message === "drive_source_invalid"
          || error.message === "drive_sync_lease_stale"
          || error.message === "drive_upload_session_expired"
          || error.message === "drive_upload_request_invalid"
          || error.message === "drive_resumable_response_invalid"
          || error.message === "drive_upload_state_invalid")
      ) {
        throw error;
      }
      const afterUncertainUpload = await listExactFiles(
        dependencies.drive,
        expected,
      );
      if (afterUncertainUpload.length !== 1) {
        throw new Error("drive_upload_failed");
      }
      driveFile = afterUncertainUpload[0];
    }
  }

  return {
    mediaId: context.mediaId,
    objectGeneration: context.objectGeneration,
    driveFileId: driveFile.id,
    driveFileName,
    folderIds,
  };
}

export interface DriveSyncSuccessInput extends DriveSyncUploadResult {
  workerId: string;
  leaseToken: string;
  completedAt: string;
}

export type DriveSyncSuccessDecision =
  | { status: "committed" | "cancelled"; write: true; state: UnknownRecord }
  | {
      status: "alreadyCommitted" | "staleLease" | "staleSource";
      write: false;
      state: UnknownRecord;
    };

function safeFolderIds(value: unknown): value is DriveFolderStructure["ids"] {
  if (!isRecord(value)) return false;
  const keys = [
    "root",
    "building",
    "unit",
    "session",
    "representativePhotos",
    "originalPhotos",
    "verticalVideos",
  ] as const;
  return Object.keys(value).length === keys.length
    && keys.every((key) => isDriveId(value[key]));
}

function sameFolderIds(
  left: unknown,
  right: DriveFolderStructure["ids"],
): boolean {
  if (!safeFolderIds(left)) return false;
  const keys = [
    "root",
    "building",
    "unit",
    "session",
    "representativePhotos",
    "originalPhotos",
    "verticalVideos",
  ] as const;
  return keys.every((key) => left[key] === right[key]);
}

export function reduceDriveSyncSuccess(
  current: unknown,
  input: DriveSyncSuccessInput,
): DriveSyncSuccessDecision {
  const root = stateRoot(current);
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.mediaId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !isGeneration(input.objectGeneration)
    || !isDriveId(input.driveFileId)
    || !isBoundedText(input.driveFileName, 1_024)
    || !safeFolderIds(input.folderIds)
    || !canonicalIso(input.completedAt)
  ) {
    throw new Error("drive_sync_commit_invalid");
  }
  const job = jobRecord(root, input.mediaId);
  const media = mediaRecord(root, input.mediaId);
  if (job.status === "complete") {
    if (
      job.objectGeneration === input.objectGeneration
      && job.driveFileId === input.driveFileId
      && job.driveFileName === input.driveFileName
      && canonicalIso(job.completedAt)
      && sameFolderIds(job.folderIds, input.folderIds)
      && media.driveSyncState === "complete"
      && media.driveFileId === input.driveFileId
      && media.objectGeneration === input.objectGeneration
    ) {
      return { status: "alreadyCommitted", write: false, state: root };
    }
    return { status: "staleSource", write: false, state: root };
  }
  if (
    job.status !== "syncing"
    || job.leaseOwner !== input.workerId
    || job.leaseToken !== input.leaseToken
    || !canonicalIso(job.leaseUntil)
    || Date.parse(job.leaseUntil) <= Date.parse(input.completedAt)
  ) {
    return { status: "staleLease", write: false, state: root };
  }
  if (
    job.objectGeneration !== input.objectGeneration
    || media.objectGeneration !== input.objectGeneration
  ) {
    return { status: "staleSource", write: false, state: root };
  }
  if (hasExcludedMedia(media)) {
    const released = clonedState(root);
    releaseOwnedDriveFolderLease(released, input);
    const cancelled = cancelExcludedState(
      released,
      input.mediaId,
      input.completedAt,
    );
    return {
      status: "cancelled",
      write: true,
      state: cancelled,
    };
  }
  try {
    validateDriveSyncContext(root, {
      mediaId: input.mediaId,
      workerId: input.workerId,
      leaseToken: input.leaseToken,
      now: input.completedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "drive_sync_lease_stale") {
      return { status: "staleLease", write: false, state: root };
    }
    return { status: "staleSource", write: false, state: root };
  }

  const next = clonedState(root);
  releaseOwnedDriveFolderLease(next, input);
  deleteDriveUploadSession(next, input.mediaId);
  deleteDriveSyncAlert(next, input.mediaId);
  const nextJob = jobRecord(next, input.mediaId);
  const nextMedia = mediaRecord(next, input.mediaId);
  nextJob.status = "complete";
  nextJob.driveFileId = input.driveFileId;
  nextJob.driveFileName = input.driveFileName;
  nextJob.folderIds = { ...input.folderIds };
  nextJob.completedAt = input.completedAt;
  nextJob.updatedAt = input.completedAt;
  deleteRecoveryFields(nextJob);
  delete nextJob.lastErrorCode;
  deleteLeaseFields(nextJob);
  nextMedia.driveSyncState = "complete";
  nextMedia.driveFileId = input.driveFileId;
  nextMedia.driveSyncedAt = input.completedAt;
  return { status: "committed", write: true, state: next };
}

export interface DriveSyncFailureInput {
  mediaId: string;
  workerId: string;
  leaseToken: string;
  failedAt: string;
  error: unknown;
  terminal?: boolean;
}

export type DriveSyncFailureDecision =
  | { status: "failed"; write: true; state: UnknownRecord }
  | { status: "terminal"; write: true; state: UnknownRecord }
  | {
      status: "alreadyTerminal" | "staleLease";
      write: false;
      state: UnknownRecord;
    };

export const TERMINAL_DRIVE_FAILURE_CODES = new Set([
  "drive_folder_duplicate",
  "drive_folder_response_invalid",
  "drive_file_duplicate",
  "drive_file_checksum_mismatch",
  "drive_file_response_invalid",
  "drive_file_request_invalid",
  "drive_source_invalid",
  "drive_sync_source_invalid",
  "drive_resumable_response_invalid",
]);

const SAFE_FAILURE_CODES = new Set([
  ...TERMINAL_DRIVE_FAILURE_CODES,
  "drive_api_failed",
  "drive_folder_create_failed",
  "drive_oauth_token_failed",
  "drive_oauth_config_invalid",
  "drive_root_folder_invalid",
  "drive_storage_failed",
  "drive_sync_lease_stale",
  "drive_upload_request_invalid",
  "drive_upload_session_expired",
  "drive_upload_state_invalid",
  "drive_upload_incomplete",
  "drive_upload_failed",
]);

export function safeDriveFailureCode(error: unknown): string {
  return error instanceof Error && SAFE_FAILURE_CODES.has(error.message)
    ? error.message
    : "drive_sync_failed";
}

export function reduceDriveSyncFailure(
  current: unknown,
  input: DriveSyncFailureInput,
): DriveSyncFailureDecision {
  const root = stateRoot(current);
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.mediaId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !canonicalIso(input.failedAt)
    || (input.terminal !== undefined && typeof input.terminal !== "boolean")
  ) {
    throw new Error("drive_sync_failure_invalid");
  }
  const job = jobRecord(root, input.mediaId);
  const media = mediaRecord(root, input.mediaId);
  const failureCode = safeDriveFailureCode(input.error);
  const terminal = input.terminal === true
    && TERMINAL_DRIVE_FAILURE_CODES.has(failureCode);
  if (
    terminal
    && job.status === "terminal"
    && job.failedAt === input.failedAt
    && job.updatedAt === input.failedAt
    && job.terminalAt === input.failedAt
    && job.lastErrorCode === failureCode
    && job.nextAttemptAt === undefined
    && job.recoveryKey === undefined
    && job.leaseOwner === undefined
    && job.leaseToken === undefined
    && job.leaseUntil === undefined
    && media.driveSyncState === "failed"
    && !hasDriveUploadSession(root, input.mediaId)
  ) {
    return { status: "alreadyTerminal", write: false, state: root };
  }
  if (
    job.status !== "syncing"
    || job.leaseOwner !== input.workerId
    || job.leaseToken !== input.leaseToken
    || !canonicalIso(job.leaseUntil)
    || Date.parse(job.leaseUntil) <= Date.parse(input.failedAt)
  ) {
    return { status: "staleLease", write: false, state: root };
  }
  if (!validAttemptCount(job.attemptCount) || job.attemptCount < 1) {
    throw new Error("drive_sync_job_invalid");
  }
  const exponent = Math.min((job.attemptCount as number) - 1, 20);
  const delay = Math.min(
    MAX_RETRY_MILLISECONDS,
    BASE_RETRY_MILLISECONDS * 2 ** exponent,
  );
  const next = clonedState(root);
  releaseOwnedDriveFolderLease(next, input);
  if (terminal || failureCode === "drive_upload_session_expired") {
    deleteDriveUploadSession(next, input.mediaId);
  }
  if (failureCode === "drive_oauth_config_invalid") {
    recordDriveSyncConfigAlert(
      next,
      input.mediaId,
      input.failedAt,
      job.attemptCount as number,
    );
  } else {
    deleteDriveSyncAlert(next, input.mediaId);
  }
  const nextJob = jobRecord(next, input.mediaId);
  const nextMedia = mediaRecord(next, input.mediaId);
  nextJob.status = terminal ? "terminal" : "failed";
  nextJob.failedAt = input.failedAt;
  nextJob.updatedAt = input.failedAt;
  nextJob.lastErrorCode = failureCode;
  if (terminal) {
    nextJob.terminalAt = input.failedAt;
    deleteRecoveryFields(nextJob);
  } else {
    nextJob.nextAttemptAt = new Date(
      Date.parse(input.failedAt) + delay,
    ).toISOString();
    nextJob.recoveryKey = buildDriveRecoveryKey(
      "failed",
      nextJob.nextAttemptAt as string,
      input.mediaId,
    );
  }
  deleteLeaseFields(nextJob);
  nextMedia.driveSyncState = "failed";
  return {
    status: terminal ? "terminal" : "failed",
    write: true,
    state: next,
  };
}

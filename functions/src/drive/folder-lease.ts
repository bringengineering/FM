import {
  isRfc4122Uuid,
  isSafeMediaPathSegment,
} from "../field/media-policy.js";
import type { DriveFolderStructure } from "./folders.js";

type UnknownRecord = Record<string, unknown>;

const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const MAX_FOLDER_LEASE_MILLISECONDS = 15 * 60_000;

const FOLDER_ID_KEYS = [
  "root",
  "building",
  "unit",
  "session",
  "representativePhotos",
  "originalPhotos",
  "verticalVideos",
] as const;

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

export function isSafeDriveFolderIds(
  value: unknown,
): value is DriveFolderStructure["ids"] {
  return isRecord(value)
    && Object.keys(value).length === FOLDER_ID_KEYS.length
    && FOLDER_ID_KEYS.every((key) => isDriveId(value[key]));
}

export interface DriveFolderLeaseIdentity {
  mediaId: string;
  workerId: string;
  leaseToken: string;
}

export interface DriveFolderLeaseClaimInput extends DriveFolderLeaseIdentity {
  now: string;
  rootFolderId: string;
}

export type DriveFolderLeaseClaimDecision =
  | {
      status: "acquired";
      write: boolean;
      state: UnknownRecord;
    }
  | {
      status: "cached";
      write: false;
      state: UnknownRecord;
      folderIds: DriveFolderStructure["ids"];
    }
  | {
      status: "busy" | "staleJob";
      write: false;
      state: UnknownRecord;
    };

interface FolderBinding {
  buildingId: string;
  captureSessionId: string;
  job: UnknownRecord;
}

function stateRoot(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error("drive_folder_state_invalid");
  return value;
}

function requiredCollection(root: UnknownRecord, key: string): UnknownRecord {
  const collection = root[key];
  if (!isRecord(collection)) throw new Error("drive_folder_state_invalid");
  return collection;
}

function folderBinding(
  root: UnknownRecord,
  identity: DriveFolderLeaseIdentity,
): FolderBinding | null {
  const jobs = requiredCollection(root, "driveSyncJobs");
  const mediaCollection = requiredCollection(root, "media");
  const job = jobs[identity.mediaId];
  const media = mediaCollection[identity.mediaId];
  if (
    !isRecord(job)
    || !isRecord(media)
    || job.id !== identity.mediaId
    || job.mediaId !== identity.mediaId
    || media.id !== identity.mediaId
    || job.status !== "syncing"
    || job.leaseOwner !== identity.workerId
    || job.leaseToken !== identity.leaseToken
    || !canonicalIso(job.leaseUntil)
    || !isSafeMediaPathSegment(media.buildingId)
    || !isRfc4122Uuid(media.captureSessionId)
  ) return null;
  return {
    buildingId: media.buildingId,
    captureSessionId: media.captureSessionId,
    job,
  };
}

function optionalNestedRecord(
  root: UnknownRecord,
  collectionName: string,
  buildingId: string,
  captureSessionId: string,
): unknown {
  const collection = root[collectionName];
  if (collection === undefined) return undefined;
  if (!isRecord(collection)) throw new Error("drive_folder_state_invalid");
  const building = collection[buildingId];
  if (building === undefined) return undefined;
  if (!isRecord(building)) throw new Error("drive_folder_state_invalid");
  return building[captureSessionId];
}

function validCache(
  value: unknown,
  binding: FolderBinding,
  rootFolderId: string,
): value is UnknownRecord & { folderIds: DriveFolderStructure["ids"] } {
  return isRecord(value)
    && value.buildingId === binding.buildingId
    && value.captureSessionId === binding.captureSessionId
    && value.rootFolderId === rootFolderId
    && canonicalIso(value.cachedAt)
    && isSafeDriveFolderIds(value.folderIds)
    && value.folderIds.root === rootFolderId;
}

function validLease(value: unknown, binding: FolderBinding): value is UnknownRecord {
  return isRecord(value)
    && value.buildingId === binding.buildingId
    && value.captureSessionId === binding.captureSessionId
    && isRfc4122Uuid(value.mediaId)
    && isSafeToken(value.workerId)
    && isSafeToken(value.leaseToken)
    && isDriveId(value.rootFolderId)
    && canonicalIso(value.leaseUntil);
}

function validateClaimInput(
  input: DriveFolderLeaseClaimInput,
): asserts input is DriveFolderLeaseClaimInput {
  if (
    !isRecord(input)
    || !isRfc4122Uuid(input.mediaId)
    || !isSafeToken(input.workerId)
    || !isSafeToken(input.leaseToken)
    || !canonicalIso(input.now)
    || !isDriveId(input.rootFolderId)
  ) throw new Error("drive_folder_claim_invalid");
}

function setNestedRecord(
  root: UnknownRecord,
  collectionName: string,
  buildingId: string,
  captureSessionId: string,
  value: UnknownRecord,
): void {
  if (!isRecord(root[collectionName])) root[collectionName] = {};
  const collection = root[collectionName] as UnknownRecord;
  if (!isRecord(collection[buildingId])) collection[buildingId] = {};
  (collection[buildingId] as UnknownRecord)[captureSessionId] = value;
}

function deleteNestedRecord(
  root: UnknownRecord,
  collectionName: string,
  buildingId: string,
  captureSessionId: string,
): void {
  const collection = root[collectionName];
  if (!isRecord(collection)) return;
  const building = collection[buildingId];
  if (!isRecord(building)) return;
  delete building[captureSessionId];
  if (Object.keys(building).length === 0) delete collection[buildingId];
  if (Object.keys(collection).length === 0) delete root[collectionName];
}

export function reduceDriveFolderLeaseClaim(
  current: unknown,
  input: DriveFolderLeaseClaimInput,
): DriveFolderLeaseClaimDecision {
  validateClaimInput(input);
  const root = stateRoot(current);
  const binding = folderBinding(root, input);
  if (binding === null) {
    return { status: "staleJob", write: false, state: root };
  }
  const nowMilliseconds = Date.parse(input.now);
  const jobLeaseUntil = Date.parse(binding.job.leaseUntil as string);
  if (
    jobLeaseUntil <= nowMilliseconds
    || jobLeaseUntil - nowMilliseconds > MAX_FOLDER_LEASE_MILLISECONDS
  ) {
    return { status: "staleJob", write: false, state: root };
  }

  const cache = optionalNestedRecord(
    root,
    "driveFolderCaches",
    binding.buildingId,
    binding.captureSessionId,
  );
  if (validCache(cache, binding, input.rootFolderId)) {
    return {
      status: "cached",
      write: false,
      state: root,
      folderIds: { ...cache.folderIds },
    };
  }

  const lease = optionalNestedRecord(
    root,
    "driveFolderLeases",
    binding.buildingId,
    binding.captureSessionId,
  );
  if (lease !== undefined) {
    if (!validLease(lease, binding)) {
      throw new Error("drive_folder_state_invalid");
    }
    if (Date.parse(lease.leaseUntil as string) > nowMilliseconds) {
      if (
        lease.mediaId === input.mediaId
        && lease.workerId === input.workerId
        && lease.leaseToken === input.leaseToken
        && lease.rootFolderId === input.rootFolderId
      ) return { status: "acquired", write: false, state: root };
      return { status: "busy", write: false, state: root };
    }
  }

  const next = structuredClone(root);
  setNestedRecord(
    next,
    "driveFolderLeases",
    binding.buildingId,
    binding.captureSessionId,
    {
      buildingId: binding.buildingId,
      captureSessionId: binding.captureSessionId,
      mediaId: input.mediaId,
      workerId: input.workerId,
      leaseToken: input.leaseToken,
      rootFolderId: input.rootFolderId,
      leaseUntil: binding.job.leaseUntil,
      acquiredAt: input.now,
    },
  );
  return { status: "acquired", write: true, state: next };
}

export interface DriveFolderLeasePublishInput extends DriveFolderLeaseClaimInput {
  folderIds: DriveFolderStructure["ids"];
  publishedAt: string;
}

export type DriveFolderLeasePublishDecision =
  | {
      status: "committed";
      write: true;
      state: UnknownRecord;
      folderIds: DriveFolderStructure["ids"];
    }
  | {
      status: "alreadyCached";
      write: false;
      state: UnknownRecord;
      folderIds: DriveFolderStructure["ids"];
    }
  | {
      status: "staleLease";
      write: false;
      state: UnknownRecord;
    };

export function reduceDriveFolderLeasePublish(
  current: unknown,
  input: DriveFolderLeasePublishInput,
): DriveFolderLeasePublishDecision {
  validateClaimInput(input);
  if (
    !canonicalIso(input.publishedAt)
    || !isSafeDriveFolderIds(input.folderIds)
    || input.folderIds.root !== input.rootFolderId
  ) throw new Error("drive_folder_publish_invalid");
  const root = stateRoot(current);
  const binding = folderBinding(root, input);
  if (
    binding === null
    || Date.parse(binding.job.leaseUntil as string) <= Date.parse(input.publishedAt)
  ) return { status: "staleLease", write: false, state: root };

  const cache = optionalNestedRecord(
    root,
    "driveFolderCaches",
    binding.buildingId,
    binding.captureSessionId,
  );
  if (validCache(cache, binding, input.rootFolderId)) {
    return {
      status: "alreadyCached",
      write: false,
      state: root,
      folderIds: { ...cache.folderIds },
    };
  }

  const lease = optionalNestedRecord(
    root,
    "driveFolderLeases",
    binding.buildingId,
    binding.captureSessionId,
  );
  if (
    !validLease(lease, binding)
    || lease.mediaId !== input.mediaId
    || lease.workerId !== input.workerId
    || lease.leaseToken !== input.leaseToken
    || lease.rootFolderId !== input.rootFolderId
    || Date.parse(lease.leaseUntil as string) <= Date.parse(input.publishedAt)
  ) return { status: "staleLease", write: false, state: root };

  const next = structuredClone(root);
  setNestedRecord(
    next,
    "driveFolderCaches",
    binding.buildingId,
    binding.captureSessionId,
    {
      buildingId: binding.buildingId,
      captureSessionId: binding.captureSessionId,
      rootFolderId: input.rootFolderId,
      folderIds: { ...input.folderIds },
      cachedAt: input.publishedAt,
    },
  );
  deleteNestedRecord(
    next,
    "driveFolderLeases",
    binding.buildingId,
    binding.captureSessionId,
  );
  return {
    status: "committed",
    write: true,
    state: next,
    folderIds: { ...input.folderIds },
  };
}

export function releaseOwnedDriveFolderLease(
  root: UnknownRecord,
  input: DriveFolderLeaseIdentity,
): void {
  const binding = folderBinding(root, input);
  if (binding === null) return;
  const lease = optionalNestedRecord(
    root,
    "driveFolderLeases",
    binding.buildingId,
    binding.captureSessionId,
  );
  if (
    validLease(lease, binding)
    && lease.mediaId === input.mediaId
    && lease.workerId === input.workerId
    && lease.leaseToken === input.leaseToken
  ) {
    deleteNestedRecord(
      root,
      "driveFolderLeases",
      binding.buildingId,
      binding.captureSessionId,
    );
  }
}

import { Buffer } from "node:buffer";

import { buildDriveRecoveryKey } from "./recovery-key.js";
import {
  MAX_DRIVE_UPLOAD_BYTES,
  validateDriveResumableSessionUri,
} from "./resumable-upload.js";

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;
const MIME_TYPE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u;
const MIN_LEASE_MILLISECONDS = 30_000;
const MAX_LEASE_MILLISECONDS = 15 * 60_000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function validSize(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) <= MAX_DRIVE_UPLOAD_BYTES;
}

function validFileName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 255
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export interface DriveUploadSessionBinding {
  mediaId: string;
  objectGeneration: string;
  totalSizeBytes: number;
  parentId: string;
  fileName: string;
  mimeType: string;
}

export interface DriveUploadSessionSnapshot extends DriveUploadSessionBinding {
  sessionUri: string;
  nextOffset: number;
  createdAt: string;
  updatedAt: string;
}

function validateBinding(
  input: DriveUploadSessionBinding,
): asserts input is DriveUploadSessionBinding {
  if (
    !isRecord(input)
    || !UUID_PATTERN.test(input.mediaId)
    || !GENERATION_PATTERN.test(input.objectGeneration)
    || !validSize(input.totalSizeBytes)
    || !DRIVE_ID_PATTERN.test(input.parentId)
    || !validFileName(input.fileName)
    || typeof input.mimeType !== "string"
    || input.mimeType.length > 128
    || !MIME_TYPE_PATTERN.test(input.mimeType)
  ) throw new Error("drive_upload_request_invalid");
}

function safeSession(
  value: unknown,
  binding: DriveUploadSessionBinding,
): DriveUploadSessionSnapshot {
  if (
    !isRecord(value)
    || value.mediaId !== binding.mediaId
    || value.objectGeneration !== binding.objectGeneration
    || value.totalSizeBytes !== binding.totalSizeBytes
    || value.parentId !== binding.parentId
    || value.fileName !== binding.fileName
    || value.mimeType !== binding.mimeType
    || !Number.isSafeInteger(value.nextOffset)
    || (value.nextOffset as number) < 0
    || (value.nextOffset as number) >= binding.totalSizeBytes
    || !canonicalIso(value.createdAt)
    || !canonicalIso(value.updatedAt)
  ) throw new Error("drive_upload_state_invalid");
  const sessionUri = validateDriveResumableSessionUri(value.sessionUri);
  return {
    ...binding,
    sessionUri,
    nextOffset: value.nextOffset as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function validateDriveUploadSessionSnapshot(
  value: unknown,
  binding: DriveUploadSessionBinding,
): DriveUploadSessionSnapshot {
  validateBinding(binding);
  return safeSession(value, binding);
}

export function readDriveUploadSession(
  current: unknown,
  input: DriveUploadSessionBinding,
): DriveUploadSessionSnapshot | null {
  validateBinding(input);
  if (!isRecord(current)) throw new Error("drive_upload_state_invalid");
  if (current.driveUploadSessions === undefined) return null;
  if (!isRecord(current.driveUploadSessions)) {
    throw new Error("drive_upload_state_invalid");
  }
  const value = current.driveUploadSessions[input.mediaId];
  return value === undefined ? null : safeSession(value, input);
}

export interface DriveUploadSessionCheckpointInput
  extends DriveUploadSessionBinding {
  workerId: string;
  leaseToken: string;
  sessionUri: string;
  nextOffset: number;
  now: string;
  leaseDurationMs: number;
}

export type DriveUploadSessionCheckpointDecision =
  | { status: "committed"; write: true; state: UnknownRecord }
  | {
      status: "staleLease" | "sessionConflict";
      write: false;
      state: UnknownRecord;
    };

export function reduceDriveUploadSessionCheckpoint(
  current: unknown,
  input: DriveUploadSessionCheckpointInput,
): DriveUploadSessionCheckpointDecision {
  validateBinding(input);
  const sessionUri = validateDriveResumableSessionUri(input.sessionUri);
  if (
    !SAFE_TOKEN_PATTERN.test(input.workerId)
    || !SAFE_TOKEN_PATTERN.test(input.leaseToken)
    || !Number.isSafeInteger(input.nextOffset)
    || input.nextOffset < 0
    || input.nextOffset >= input.totalSizeBytes
    || !canonicalIso(input.now)
    || !Number.isSafeInteger(input.leaseDurationMs)
    || input.leaseDurationMs < MIN_LEASE_MILLISECONDS
    || input.leaseDurationMs > MAX_LEASE_MILLISECONDS
  ) throw new Error("drive_upload_request_invalid");
  if (!isRecord(current) || !isRecord(current.driveSyncJobs)) {
    throw new Error("drive_upload_state_invalid");
  }
  const job = current.driveSyncJobs[input.mediaId];
  if (
    !isRecord(job)
    || job.id !== input.mediaId
    || job.mediaId !== input.mediaId
    || job.objectGeneration !== input.objectGeneration
    || job.status !== "syncing"
    || job.leaseOwner !== input.workerId
    || job.leaseToken !== input.leaseToken
    || !canonicalIso(job.leaseUntil)
    || Date.parse(job.leaseUntil) <= Date.parse(input.now)
  ) return { status: "staleLease", write: false, state: current };

  const existing = readDriveUploadSession(current, input);
  if (existing !== null && existing.sessionUri !== sessionUri) {
    return { status: "sessionConflict", write: false, state: current };
  }

  const next = structuredClone(current);
  if (!isRecord(next.driveUploadSessions)) next.driveUploadSessions = {};
  const sessions = next.driveUploadSessions as UnknownRecord;
  sessions[input.mediaId] = {
    mediaId: input.mediaId,
    objectGeneration: input.objectGeneration,
    sessionUri,
    nextOffset: input.nextOffset,
    totalSizeBytes: input.totalSizeBytes,
    parentId: input.parentId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  const nextJobs = next.driveSyncJobs as UnknownRecord;
  const nextJob = nextJobs[input.mediaId] as UnknownRecord;
  nextJob.leaseUntil = new Date(
    Date.parse(input.now) + input.leaseDurationMs,
  ).toISOString();
  nextJob.recoveryKey = buildDriveRecoveryKey(
    "syncing",
    nextJob.leaseUntil as string,
    input.mediaId,
  );
  nextJob.updatedAt = input.now;
  return { status: "committed", write: true, state: next };
}

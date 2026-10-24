import { isRfc4122Uuid } from "../field/media-policy.js";

export type DriveRecoverableStatus = "queued" | "failed" | "syncing";

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function assertStatus(status: unknown): asserts status is DriveRecoverableStatus {
  if (status !== "queued" && status !== "failed" && status !== "syncing") {
    throw new Error("drive_recovery_key_invalid");
  }
}

export function buildDriveRecoveryKey(
  status: DriveRecoverableStatus,
  at: string,
  mediaId: string,
): string {
  assertStatus(status);
  if (!canonicalIso(at) || !isRfc4122Uuid(mediaId)) {
    throw new Error("drive_recovery_key_invalid");
  }
  return `${status}|${at}|${mediaId}`;
}

export function driveRecoveryRange(
  status: DriveRecoverableStatus,
  dueAtOrBefore?: string,
): { startAt: string; endAt: string } {
  assertStatus(status);
  if (status === "queued") {
    if (dueAtOrBefore !== undefined) {
      throw new Error("drive_recovery_key_invalid");
    }
    return { startAt: "queued|", endAt: "queued|\uf8ff" };
  }
  if (!canonicalIso(dueAtOrBefore)) {
    throw new Error("drive_recovery_key_invalid");
  }
  return {
    startAt: `${status}|`,
    endAt: `${status}|${dueAtOrBefore}|\uf8ff`,
  };
}

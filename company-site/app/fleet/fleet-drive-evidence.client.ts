"use client";

import type { DriveFile } from "../field/lib/google-drive.client";

export const FLEET_DRIVE_ROOT_FOLDER_ID = "1dS3FmjiCpk8v7hZoZIUkQOozulN6DXlq";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface FleetDriveAdapter {
  validateWritableRoot(folderId: string): Promise<DriveFile>;
  ensureFolderPath(rootId: string, segments: string[]): Promise<string>;
  findByAppProperty(key: string, value: string): Promise<DriveFile | null>;
  uploadSmallFile(input: {
    parentId: string;
    name: string;
    mimeType: string;
    blob: Blob;
    appProperties?: Record<string, string>;
  }): Promise<DriveFile>;
}

export interface FleetDriveReceipt {
  driveFileId: string;
  driveUrl: string;
  fileName: string;
  uploadState: "complete";
}

export interface FleetEvidenceUploadInput {
  rootFolderId: string;
  tripId: string;
  vehicleId: string;
  userUid: string;
  driverName: string;
  startOdometer: number;
  capturedAt: Date;
  blob: Blob;
}

function koreanParts(date: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function safeName(value: string, fallback: string): string {
  const result = value.normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80);
  return result || fallback;
}

export function buildFleetDriveFolderPath(capturedAt: Date): string[] {
  const parts = koreanParts(capturedAt);
  return ["계기판 사진", `${parts.year}-${parts.month}`];
}

export function buildFleetDriveFileName(input: {
  capturedAt: Date;
  driverName: string;
  startOdometer: number;
  tripId: string;
}): string {
  const parts = koreanParts(input.capturedAt);
  const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
  const driver = safeName(input.driverName, "직원");
  const trip = safeName(input.tripId, "trip").slice(0, 8);
  return `${stamp}_${driver}_${input.startOdometer}km_${trip}.jpg`;
}

function receipt(file: DriveFile): FleetDriveReceipt {
  if (!file.id || !file.name || file.mimeType !== "image/jpeg") throw new Error("fleet_drive_upload_invalid");
  return {
    driveFileId: file.id,
    driveUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
    fileName: file.name,
    uploadState: "complete",
  };
}

export async function uploadFleetOdometerEvidence(
  input: FleetEvidenceUploadInput,
  drive: FleetDriveAdapter,
): Promise<FleetDriveReceipt> {
  const root = await drive.validateWritableRoot(input.rootFolderId);
  if (root.id !== input.rootFolderId || root.name !== "BRING CAR" || root.mimeType !== FOLDER_MIME
    || root.capabilities?.canAddChildren !== true) {
    throw new Error("fleet_drive_root_invalid");
  }
  const existing = await drive.findByAppProperty("bringFleetTripId", input.tripId);
  if (existing) return receipt(existing);
  const parentId = await drive.ensureFolderPath(input.rootFolderId, buildFleetDriveFolderPath(input.capturedAt));
  const name = buildFleetDriveFileName(input);
  const file = await drive.uploadSmallFile({
    parentId,
    name,
    mimeType: "image/jpeg",
    blob: input.blob,
    appProperties: {
      bringFleetTripId: input.tripId,
      bringFleetVehicleId: input.vehicleId,
      bringFleetUserUid: input.userUid,
      bringFleetStartKm: String(input.startOdometer),
      bringFleetCapturedAt: input.capturedAt.toISOString(),
    },
  });
  return receipt(file);
}

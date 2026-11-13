import { Buffer } from "node:buffer";

type UnknownRecord = Record<string, unknown>;

export interface FleetEvidenceDriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface FleetEvidenceDriveAdapter {
  validateRoot(rootFolderId: string): Promise<void>;
  ensureFolder(parentId: string, name: string): Promise<string>;
  findByTripId(rootFolderId: string, tripId: string): Promise<FleetEvidenceDriveFile | null>;
  uploadJpeg(input: {
    parentId: string;
    name: string;
    bytes: Uint8Array;
    appProperties: Record<string, string>;
  }): Promise<FleetEvidenceDriveFile>;
}

export interface FleetEvidenceReceipt {
  driveFileId: string;
  driveUrl: string;
  fileName: string;
  uploadState: "complete";
}

const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/u;
const TRIP_ID = /^[-A-Za-z0-9_]{6,160}$/u;
const VEHICLE_ID = /^[A-Za-z0-9_-]{2,80}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeName(value: string, fallback: string): string {
  const result = value.normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+|\.+$/gu, "")
    .slice(0, 80);
  return result || fallback;
}

function koreanParts(date: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
}

function normalizeInput(value: unknown): {
  tripId: string; vehicleId: string; driverName: string; startOdometer: number;
  capturedAt: Date; imageBytes: Uint8Array;
} {
  if (!isRecord(value) || typeof value.tripId !== "string" || !TRIP_ID.test(value.tripId)
    || typeof value.vehicleId !== "string" || !VEHICLE_ID.test(value.vehicleId)
    || typeof value.driverName !== "string" || value.driverName.trim().length < 1
    || value.driverName.length > 80 || !Number.isSafeInteger(value.startOdometer)
    || Number(value.startOdometer) < 0 || typeof value.capturedAt !== "string"
    || typeof value.imageBase64 !== "string" || value.imageBase64.length < 8
    || value.imageBase64.length > 950_000 || !BASE64.test(value.imageBase64)) {
    throw new Error("fleet_evidence_input_invalid");
  }
  const capturedAt = new Date(value.capturedAt);
  const bytes = Buffer.from(value.imageBase64, "base64");
  if (!Number.isFinite(capturedAt.getTime()) || bytes.length < 4 || bytes.length > 700_000
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("fleet_evidence_input_invalid");
  }
  return {
    tripId: value.tripId,
    vehicleId: value.vehicleId,
    driverName: value.driverName.trim(),
    startOdometer: Number(value.startOdometer),
    capturedAt,
    imageBytes: new Uint8Array(bytes),
  };
}

function receipt(file: FleetEvidenceDriveFile): FleetEvidenceReceipt {
  if (!DRIVE_ID.test(file.id) || file.mimeType !== "image/jpeg"
    || typeof file.name !== "string" || file.name.length < 1 || file.name.length > 200) {
    throw new Error("fleet_evidence_drive_response_invalid");
  }
  return {
    driveFileId: file.id,
    driveUrl: "https://drive.google.com/file/d/" + file.id + "/view",
    fileName: file.name,
    uploadState: "complete",
  };
}

export async function uploadFleetOdometerEvidenceCore(
  rawInput: unknown,
  dependencies: { rootFolderId: string; userUid: string; drive: FleetEvidenceDriveAdapter },
): Promise<FleetEvidenceReceipt> {
  const input = normalizeInput(rawInput);
  if (!DRIVE_ID.test(dependencies.rootFolderId) || !DRIVE_ID.test(dependencies.userUid)) {
    throw new Error("fleet_evidence_input_invalid");
  }
  await dependencies.drive.validateRoot(dependencies.rootFolderId);
  const existing = await dependencies.drive.findByTripId(dependencies.rootFolderId, input.tripId);
  if (existing) return receipt(existing);
  const parts = koreanParts(input.capturedAt);
  const evidenceFolder = await dependencies.drive.ensureFolder(dependencies.rootFolderId, "계기판 사진");
  const monthFolder = await dependencies.drive.ensureFolder(evidenceFolder, parts.year + "-" + parts.month);
  const name = parts.year + parts.month + parts.day + "-" + parts.hour + parts.minute + "_"
    + safeName(input.driverName, "직원") + "_" + input.startOdometer + "km_"
    + safeName(input.tripId, "trip").slice(0, 8) + ".jpg";
  const file = await dependencies.drive.uploadJpeg({
    parentId: monthFolder,
    name,
    bytes: input.imageBytes,
    appProperties: {
      bringFleetTripId: input.tripId,
      bringFleetVehicleId: input.vehicleId,
      bringFleetUserUid: dependencies.userUid,
      bringFleetStartKm: String(input.startOdometer),
      bringFleetCapturedAt: input.capturedAt.toISOString(),
    },
  });
  return receipt(file);
}

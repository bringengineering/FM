import type { FleetVehicleId } from "./fleet-vehicles";

export interface FleetStartSession {
  uid: string;
  displayName: string;
}
export interface FleetStartInput {
  vehicleId: FleetVehicleId;
  purpose: string;
  destination: string;
  startOdometer: number;
  file: File;
}

export interface FleetDriveReceipt {
  driveFileId: string;
  driveUrl: string;
  fileName: string;
  uploadState: "complete";
}

export interface FleetTripStartRecord {
  id: string;
  vehicleId: FleetVehicleId;
  userUid: string;
  driverName: string;
  purpose: string;
  destination: string;
  startOdometer: number;
  evidenceDriveFileId: string;
  evidenceDriveUrl: string;
  evidenceFileName: string;
  evidenceUploadState: "complete";
  status: "active";
  startedAt: string;
  updatedAt: string;
}

export interface FleetTripStartDependencies {
  createTripId(): string;
  now(): string;
  upload(input: FleetStartInput & FleetStartSession & { tripId: string; capturedAt: string }): Promise<FleetDriveReceipt>;
  write(tripId: string, record: FleetTripStartRecord): Promise<void>;
}

export async function executeFleetTripStart(
  session: FleetStartSession,
  input: FleetStartInput,
  dependencies: FleetTripStartDependencies,
): Promise<string> {
  const tripId = dependencies.createTripId();
  const capturedAt = dependencies.now();
  const evidence = await dependencies.upload({ ...session, ...input, tripId, capturedAt });
  const record: FleetTripStartRecord = {
    id: tripId,
    vehicleId: input.vehicleId,
    userUid: session.uid,
    driverName: session.displayName,
    purpose: input.purpose,
    destination: input.destination,
    startOdometer: input.startOdometer,
    evidenceDriveFileId: evidence.driveFileId,
    evidenceDriveUrl: evidence.driveUrl,
    evidenceFileName: evidence.fileName,
    evidenceUploadState: evidence.uploadState,
    status: "active",
    startedAt: capturedAt,
    updatedAt: capturedAt,
  };
  await dependencies.write(tripId, record);
  return tripId;
}

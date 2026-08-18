import type { OwnerNoteDraftInput } from "./owner-notes.js";

export type { OwnerNoteDraftInput } from "./owner-notes.js";

export type FieldRole = "admin" | "staff" | "reviewer";

export type ManagementContractStatus =
  | "none"
  | "pending"
  | "active"
  | "paused"
  | "ended";

export interface FieldActor {
  uid: string;
  role: FieldRole;
  enabled: boolean;
  tokenDisplayName?: string;
  sessionId?: string;
}

export interface ManagementContractInfo {
  status: ManagementContractStatus;
  startedOn?: string;
  endedOn?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FieldMapProjection {
  buildingId: string;
  name: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  markerStatus: "vacant" | "managed";
  vacancyCount: number;
  approvedRentSummary: string;
  parkingSummary: string;
  captureStatus: "notStarted" | "inProgress" | "complete";
  updatedAt: string;
}

export interface ManagementContractDraft {
  requested: boolean;
  startedOn?: string;
}

export interface BuildingDraftPayload {
  managementNumber: string;
  name: string;
  roadAddress: string;
  jibunAddress?: string;
  latitude: number;
  longitude: number;
  purpose?: string;
  completionYear?: number;
  floorCount?: number;
  elevator: boolean;
  parking: { available: boolean; totalSpaces?: number };
}

export interface UnitDraftPayload {
  localId: string;
  unitLabel: string;
  structure?: string;
  floor?: number;
  options: string[];
  isVacant: boolean;
}

export interface ListingDraftPayload {
  depositWon: number;
  monthlyRentWon: number;
  maintenanceFeeWon: number;
  maintenanceFeeItems: string[];
  availableFrom?: string;
  contractTermMonths?: number;
  parkingDescription: string;
  petPolicy: string;
  vacancyReason?: string;
  vacantSince?: string;
  moveInCondition?: string;
  locationDescription?: string;
  options: string[];
}

export interface SaveFieldRegistrationInput {
  requestId: string;
  draftId: string;
  building: BuildingDraftPayload;
  units: UnitDraftPayload[];
  listing: ListingDraftPayload;
  primaryUnitLocalId: string;
  managementContract: ManagementContractDraft;
  ownerNoteDrafts?: OwnerNoteDraftInput[];
}

export interface SaveFieldRegistrationResult {
  buildingId: string;
  unitIds: Record<string, string>;
  listingId: string;
  visitId: string;
}

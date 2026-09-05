export type ISODateTime = string;
export type EntityId = string;
export type MoneyWon = number;

export type UserRole = "admin" | "staff" | "reviewer";

export type ManagementContractStatus = "none" | "pending" | "active" | "paused" | "ended";

export interface ManagementContractInfo {
  status: ManagementContractStatus;
  startedOn?: string;
  endedOn?: string;
  updatedAt: ISODateTime;
  updatedBy: EntityId;
}

export type ListingStatus =
  | "draft"
  | "capturing"
  | "reviewPending"
  | "ready"
  | "advertising"
  | "closed";

export type VisitType =
  | "initial"
  | "vacancyRefresh"
  | "routineInspection"
  | "temporaryInspection"
  | "complaint";

export type MediaKind = "photo" | "video";

export type MediaZone =
  | "exterior"
  | "accessRoad"
  | "parking"
  | "commonEntrance"
  | "corridorStairs"
  | "recycling"
  | "roomOverview"
  | "windowDaylight"
  | "kitchen"
  | "bathroom"
  | "optionsStorage"
  | "boilerEquipment"
  | "repairEvidence"
  | "verticalVideo";

export type UploadState =
  | "queued"
  | "uploading"
  | "objectStored"
  | "finalizing"
  | "finalized"
  | "failed";

export type DriveSyncState =
  | "notRequested"
  | "queued"
  | "syncing"
  | "complete"
  | "failed";

export interface CaptureBinding {
  buildingId?: string;
  unitId?: string;
  listingId?: string;
  visitId?: string;
  draftId?: string;
  unitLocalId?: string;
}

export interface CaptureAttachmentDescriptor {
  mediaId: string;
  captureSessionId: string;
  kind: MediaKind;
  zone: MediaZone;
  slotId: string;
  required: boolean;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  capturedAt: ISODateTime;
  uploadState: UploadState;
  uploadProgress: number;
  failureCode?: string;
  replacesMediaId?: string;
  videoMetadata?: {
    durationSeconds: number;
    width: number;
    height: number;
  };
}

export interface CaptureSessionRecord {
  id: string;
  requestId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitId: string;
  createdBy: string;
  status: "open" | "complete";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type ChecklistFieldKind =
  | "text"
  | "number"
  | "date"
  | "singleChoice"
  | "multiChoice"
  | "rating"
  | "measurement"
  | "mediaEvidence";

export type ChecklistAnswer =
  | string
  | number
  | boolean
  | string[]
  | { value: number; unit: string }
  | null;

export interface AuditStamp {
  createdAt: ISODateTime;
  createdBy: EntityId;
  updatedAt: ISODateTime;
  updatedBy: EntityId;
}

export interface FieldUser {
  id: EntityId;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  assignedBuildingIds: EntityId[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface OwnerNote {
  id: EntityId;
  buildingId: EntityId;
  body: string;
  recordedAt: ISODateTime;
  createdAt: ISODateTime;
  createdBy: EntityId;
  createdByName: string;
  archivedAt?: ISODateTime;
  archivedBy?: EntityId;
}

export interface OwnerNoteDraft {
  localId: EntityId;
  draftId: EntityId;
  body: string;
  recordedAt: ISODateTime;
}

export interface ParkingInfo {
  available: boolean;
  totalSpaces?: number;
  notes?: string;
}

export interface Building extends AuditStamp {
  id: EntityId;
  managementNumber: string;
  name: string;
  roadAddress: string;
  jibunAddress?: string;
  latitude: number;
  longitude: number;
  purpose?: string;
  completionYear?: number;
  floorCount?: number;
  unitCount?: number;
  elevator?: boolean;
  parking: ParkingInfo;
  petAllowed?: boolean;
  managementGrade?: string;
  managerName?: string;
  existingManagementCompany?: string;
  existingCleaningCompany?: string;
  managementContract?: ManagementContractInfo;
  assignedStaffIds: EntityId[];
  lastVisitedAt?: ISODateTime;
  archivedAt?: ISODateTime;
}

export interface FieldMapProjection {
  buildingId: EntityId;
  managementNumber?: string;
  name: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  markerStatus: "vacant" | "managed";
  vacancyCount: number;
  approvedRentSummary: string;
  parkingSummary: string;
  captureStatus: "notStarted" | "inProgress" | "complete";
  updatedAt: ISODateTime;
}

export interface Unit extends AuditStamp {
  id: EntityId;
  buildingId: EntityId;
  unitLabel: string;
  structure?: string;
  floor?: number;
  direction?: string;
  options: string[];
  isVacant: boolean;
  latestMoveInAt?: ISODateTime;
  latestMoveOutAt?: ISODateTime;
  currentListingId?: EntityId;
}

export interface Listing extends AuditStamp {
  id: EntityId;
  buildingId: EntityId;
  unitId: EntityId;
  unitLabel: string;
  status: ListingStatus;
  depositWon: MoneyWon;
  monthlyRentWon: MoneyWon;
  maintenanceFeeWon: MoneyWon;
  maintenanceFeeItems: string[];
  availableFrom?: string;
  contractTermMonths?: number;
  moveInCondition?: string;
  locationDescription?: string;
  parkingDescription: string;
  petPolicy: string;
  vacancyReason?: string;
  vacantSince?: string;
  options: string[];
  advertisingApproved: boolean;
  reviewerId?: EntityId;
  reviewedAt?: ISODateTime;
}

export interface Visit extends AuditStamp {
  id: EntityId;
  buildingId: EntityId;
  unitId?: EntityId;
  listingId?: EntityId;
  type: VisitType;
  assignedUserId: EntityId;
  checklistTemplateId: EntityId;
  checklistTemplateVersion: number;
  checklistSubmissionId?: EntityId;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  latitude?: number;
  longitude?: number;
  followUpAction?: string;
  nextVisitAt?: ISODateTime;
}

export interface ChecklistChoice {
  id: string;
  label: string;
}

export interface ChecklistField {
  id: string;
  sectionId: string;
  label: string;
  kind: ChecklistFieldKind;
  required: boolean;
  choices?: ChecklistChoice[];
  unit?: string;
  mediaZone?: MediaZone;
  helpText?: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  description?: string;
  fields: ChecklistField[];
}

export interface ChecklistTemplate {
  id: EntityId;
  version: number;
  name: string;
  visitType: VisitType;
  sections: ChecklistSection[];
  active: boolean;
  createdAt: ISODateTime;
  createdBy: EntityId;
}

export interface ChecklistFieldSnapshot {
  id: string;
  sectionId: string;
  sectionTitle: string;
  label: string;
  kind: ChecklistFieldKind;
  required: boolean;
  choices?: ChecklistChoice[];
  unit?: string;
}

export interface ChecklistSubmission {
  id: EntityId;
  visitId: EntityId;
  templateId: EntityId;
  templateVersion: number;
  fieldSnapshot: ChecklistFieldSnapshot[];
  answers: Record<string, ChecklistAnswer>;
  notes?: string;
  mediaIds: EntityId[];
  submittedAt?: ISODateTime;
  submittedBy?: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface MediaRecord {
  id: EntityId;
  requestId: EntityId;
  buildingId: EntityId;
  unitId?: EntityId;
  listingId?: EntityId;
  visitId: EntityId;
  captureSessionId: EntityId;
  capturedBy: EntityId;
  kind: MediaKind;
  zone: MediaZone;
  slotId: string;
  required: boolean;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash?: string;
  capturedAt: ISODateTime;
  storagePath?: string;
  previewStoragePath?: string;
  uploadState: UploadState;
  uploadProgress: number;
  driveSyncState: DriveSyncState;
  driveFileId?: string;
  advertisingApproved: boolean;
  advertisingOrder?: number;
  failureCode?: string;
  captureQualityState: "valid" | "warning";
  objectGeneration?: string;
  objectMd5Hash?: string;
  replacesMediaId?: string;
  excludedAt?: ISODateTime;
  excludedBy?: EntityId;
}

export interface AdPackage {
  id: EntityId;
  listingId: EntityId;
  version: number;
  status: "draft" | "reviewed" | "generating" | "complete" | "failed";
  representativeMediaIds: EntityId[];
  allApprovedMediaIds: EntityId[];
  daangnDescription: string;
  naverListingFields: Record<string, string | number | boolean | string[]>;
  reviewerId?: EntityId;
  reviewedAt?: ISODateTime;
  createdAt: ISODateTime;
  createdBy: EntityId;
  driveFolderId?: string;
  driveFileIds?: Record<string, string>;
  failureCode?: string;
}

export interface SecureAccess {
  id: EntityId;
  buildingId: EntityId;
  unitId?: EntityId;
  commonDoorAccess?: string;
  unitDoorAccess?: string;
  keyLocation?: string;
  availableTime?: string;
  accessRestrictions?: string;
  ownerContact?: string;
  internalMemo?: string;
  allowedUserIds: EntityId[];
  updatedAt: ISODateTime;
  updatedBy: EntityId;
}

export interface AuditEvent {
  id: EntityId;
  actorId: EntityId;
  action: string;
  entityType:
    | "building"
    | "unit"
    | "listing"
    | "visit"
    | "checklistSubmission"
    | "media"
    | "adPackage"
    | "secureAccess"
    | "managementContract"
    | "ownerNote";
  entityId: EntityId;
  occurredAt: ISODateTime;
  changes?: Record<string, { before?: unknown; after?: unknown }>;
  requestId?: string;
}

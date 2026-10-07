import { createAuditEvent } from "./audit";
import type {
  Building,
  Listing,
  MediaRecord,
  SecureAccess,
  Unit,
  Visit,
} from "./types";

type UnknownRecord = Record<string, unknown>;
type Collection<T> = Record<string, T> | T[] | null;

export interface AuthorizedPatch {
  [path: string]: unknown;
}

export interface DriveSyncRequest {
  mediaId: string;
  captureSessionId: string;
}

export interface FieldRepositoryAdapter {
  read(path: string): Promise<unknown>;
  /** Sends an entity + audit patch to a trusted server-side mutation endpoint. */
  commitAuthorizedPatch(patch: AuthorizedPatch): Promise<void>;
  subscribe(path: string, listener: (value: unknown) => void): () => void;
  requestDriveSyncJob(input: DriveSyncRequest): Promise<{ jobId: string }>;
}

export interface AuditContext {
  eventId: string;
  actorId: string;
  occurredAt: string;
  requestId?: string;
}

export interface DashboardSnapshot {
  buildings: Record<string, Building>;
  listings: Record<string, Listing>;
  visits: Record<string, Visit>;
  media: Record<string, MediaRecord>;
}

const LISTING_KEYS = [
  "id",
  "buildingId",
  "unitId",
  "unitLabel",
  "status",
  "depositWon",
  "monthlyRentWon",
  "maintenanceFeeWon",
  "maintenanceFeeItems",
  "availableFrom",
  "contractTermMonths",
  "moveInCondition",
  "locationDescription",
  "parkingDescription",
  "petPolicy",
  "vacancyReason",
  "vacantSince",
  "options",
  "advertisingApproved",
  "reviewerId",
  "reviewedAt",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const;

function asRecord<T>(value: unknown): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, T>;
}

function values<T>(collection: Collection<T>): T[] {
  if (Array.isArray(collection)) return collection.filter(Boolean);
  return Object.values(collection || {}).filter(Boolean);
}

function entityPatch(
  path: string,
  entity: { id: string },
  audit: AuditContext,
  action: string,
  entityType: Parameters<typeof createAuditEvent>[0]["entityType"],
): AuthorizedPatch {
  return {
    [`${path}/${entity.id}`]: entity,
    [`fieldPlatform/auditLogs/${audit.eventId}`]: createAuditEvent({
      ...audit,
      action,
      entityType,
      entityId: entity.id,
    }),
  };
}

function sanitizeListing(source: Listing & UnknownRecord): Listing {
  const safe: UnknownRecord = {};
  for (const key of LISTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) safe[key] = source[key];
  }
  return safe as unknown as Listing;
}

export function normalizeBuildingAddress(address: string): string {
  return address.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

export async function findBuildingByNormalizedAddress(
  adapter: FieldRepositoryAdapter,
  address: string,
): Promise<Building | null> {
  const normalized = normalizeBuildingAddress(address);
  if (!normalized) return null;
  const buildings = asRecord<Building>(await adapter.read("fieldPlatform/buildings"));
  return values(buildings).find((building) =>
    [building.roadAddress, building.jibunAddress]
      .filter((candidate): candidate is string => Boolean(candidate))
      .some((candidate) => normalizeBuildingAddress(candidate) === normalized),
  ) || null;
}

export async function listAssignedBuildings(
  adapter: FieldRepositoryAdapter,
  userId: string,
): Promise<Building[]> {
  const [rawAssignments, rawBuildings] = await Promise.all([
    adapter.read("fieldPlatform/buildingAssignments"),
    adapter.read("fieldPlatform/buildings"),
  ]);
  const assignments = asRecord<Record<string, boolean>>(rawAssignments);
  const buildings = asRecord<Building>(rawBuildings);
  return Object.entries(buildings)
    .filter(([buildingId]) => assignments[buildingId]?.[userId] === true)
    .map(([, building]) => building);
}

export function saveBuildingWithAudit(
  adapter: FieldRepositoryAdapter,
  building: Building,
  audit: AuditContext,
): Promise<void> {
  return adapter.commitAuthorizedPatch(entityPatch(
    "fieldPlatform/buildings",
    building,
    audit,
    "building.saved",
    "building",
  ));
}

export function saveUnitWithAudit(
  adapter: FieldRepositoryAdapter,
  unit: Unit,
  audit: AuditContext,
): Promise<void> {
  return adapter.commitAuthorizedPatch(entityPatch(
    "fieldPlatform/units",
    unit,
    audit,
    "unit.saved",
    "unit",
  ));
}

export function saveListingWithAudit(
  adapter: FieldRepositoryAdapter,
  listing: Listing & UnknownRecord,
  audit: AuditContext,
): Promise<void> {
  const safeListing = sanitizeListing(listing);
  return adapter.commitAuthorizedPatch(entityPatch(
    "fieldPlatform/listings",
    safeListing,
    audit,
    "listing.saved",
    "listing",
  ));
}

export function saveSecureAccessWithAudit(
  adapter: FieldRepositoryAdapter,
  secureAccess: SecureAccess,
  audit: AuditContext,
): Promise<void> {
  return adapter.commitAuthorizedPatch(entityPatch(
    "fieldPlatform/secureAccess",
    secureAccess,
    audit,
    "secureAccess.saved",
    "secureAccess",
  ));
}

export function subscribeDashboard(
  adapter: FieldRepositoryAdapter,
  listener: (snapshot: DashboardSnapshot) => void,
): () => void {
  const snapshot: DashboardSnapshot = {
    buildings: {},
    listings: {},
    visits: {},
    media: {},
  };
  const paths = ["buildings", "listings", "visits", "media"] as const;
  const unsubscribers = paths.map((key) =>
    adapter.subscribe(`fieldPlatform/${key}`, (value) => {
      if (key === "buildings") snapshot.buildings = asRecord<Building>(value);
      if (key === "listings") snapshot.listings = asRecord<Listing>(value);
      if (key === "visits") snapshot.visits = asRecord<Visit>(value);
      if (key === "media") snapshot.media = asRecord<MediaRecord>(value);
      listener({ ...snapshot });
    }),
  );
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function requestDriveSync(
  adapter: FieldRepositoryAdapter,
  input: DriveSyncRequest,
): Promise<{ jobId: string }> {
  return adapter.requestDriveSyncJob(input);
}

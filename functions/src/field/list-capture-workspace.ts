import { Buffer } from "node:buffer";

import {
  isRfc4122Uuid,
  isSafeMediaPathSegment,
} from "./media-policy.js";

export type CaptureWorkspaceRole = "admin" | "staff" | "reviewer";

export interface CaptureWorkspaceTarget {
  id: string;
  buildingId: string;
  buildingName: string;
  unitId?: string;
  unitLabel?: string;
  listingId?: string;
  source: "management" | "advertising";
}

export interface OpenCaptureWorkspaceSession {
  id: string;
  requestId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitId: string;
  createdBy: string;
  status: "open";
  createdAt: string;
  updatedAt: string;
}

export interface CaptureWorkspaceResult {
  targets: CaptureWorkspaceTarget[];
  openSessions: OpenCaptureWorkspaceSession[];
}

export interface ListCaptureWorkspaceDependencies {
  listAssignedBuildingIds(uid: string): Promise<unknown>;
  listBuildings(): Promise<unknown>;
  listUnits(): Promise<unknown>;
  listListings(): Promise<unknown>;
  listCaptureSessions(): Promise<unknown>;
}

type UnknownRecord = Record<string, unknown>;

const CAPTURE_CAPABLE_LISTING_STATUSES = new Set([
  "draft",
  "capturing",
  "reviewPending",
  "ready",
  "advertising",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isSafeDisplayText(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 200
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function optionalSafeId(value: unknown): value is string | undefined {
  return value === undefined || isSafeMediaPathSegment(value);
}

function encodeTargetPart(value: string): string {
  return encodeURIComponent(value);
}

function managementTargetId(buildingId: string, unitId?: string): string {
  return `management:${encodeTargetPart(buildingId)}:${
    unitId === undefined ? "building" : encodeTargetPart(unitId)
  }`;
}

function advertisingTargetId(listingId: string): string {
  return `advertising:${encodeTargetPart(listingId)}`;
}

function targetKey(target: CaptureWorkspaceTarget): string {
  return JSON.stringify([
    target.source,
    target.buildingId,
    target.unitId ?? null,
    target.listingId ?? null,
  ]);
}

function addTarget(
  targets: CaptureWorkspaceTarget[],
  seen: Set<string>,
  target: CaptureWorkspaceTarget,
): void {
  const key = targetKey(target);
  if (seen.has(key)) return;
  seen.add(key);
  targets.push(target);
}

function sanitizeBuilding(value: UnknownRecord): {
  id: string;
  name: string;
  managementActive: boolean;
} | null {
  if (!isSafeMediaPathSegment(value.id) || !isSafeDisplayText(value.name)) {
    return null;
  }
  const contract = isRecord(value.managementContract)
    ? value.managementContract
    : null;
  return {
    id: value.id,
    name: value.name,
    managementActive: contract?.status === "active",
  };
}

function sanitizeUnit(value: UnknownRecord): {
  id: string;
  buildingId: string;
  unitLabel: string;
} | null {
  if (
    !isSafeMediaPathSegment(value.id)
    || !isSafeMediaPathSegment(value.buildingId)
    || !isSafeDisplayText(value.unitLabel)
  ) {
    return null;
  }
  return {
    id: value.id,
    buildingId: value.buildingId,
    unitLabel: value.unitLabel,
  };
}

function sanitizeListing(value: UnknownRecord): {
  id: string;
  buildingId: string;
  unitId: string;
  unitLabel: string;
} | null {
  if (
    !isSafeMediaPathSegment(value.id)
    || !isSafeMediaPathSegment(value.buildingId)
    || !isSafeMediaPathSegment(value.unitId)
    || !isSafeDisplayText(value.unitLabel)
    || typeof value.status !== "string"
    || !CAPTURE_CAPABLE_LISTING_STATUSES.has(value.status)
  ) {
    return null;
  }
  return {
    id: value.id,
    buildingId: value.buildingId,
    unitId: value.unitId,
    unitLabel: value.unitLabel,
  };
}

function sanitizeOpenSession(
  value: UnknownRecord,
  actorUid: string,
): OpenCaptureWorkspaceSession | null {
  if (
    !isRfc4122Uuid(value.id)
    || !isRfc4122Uuid(value.requestId)
    || !isRfc4122Uuid(value.visitId)
    || !isSafeMediaPathSegment(value.buildingId)
    || !optionalSafeId(value.unitId)
    || !optionalSafeId(value.listingId)
    || value.createdBy !== actorUid
    || value.status !== "open"
    || !isCanonicalIso(value.createdAt)
    || !isCanonicalIso(value.updatedAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    requestId: value.requestId,
    buildingId: value.buildingId,
    ...(value.unitId === undefined ? {} : { unitId: value.unitId }),
    ...(value.listingId === undefined
      ? {}
      : { listingId: value.listingId }),
    visitId: value.visitId,
    createdBy: actorUid,
    status: "open",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function sessionHasTarget(
  session: OpenCaptureWorkspaceSession,
  targets: CaptureWorkspaceTarget[],
): boolean {
  if (session.listingId !== undefined) {
    return targets.some((target) => (
      target.source === "advertising"
      && target.buildingId === session.buildingId
      && target.unitId === session.unitId
      && target.listingId === session.listingId
    ));
  }
  return targets.some((target) => (
    target.source === "management"
    && target.buildingId === session.buildingId
    && target.unitId === session.unitId
  ));
}

function newestFirst(
  left: OpenCaptureWorkspaceSession,
  right: OpenCaptureWorkspaceSession,
): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || right.id.localeCompare(left.id);
}

export async function listCaptureWorkspaceCore(
  actor: { uid: string; role: CaptureWorkspaceRole },
  dependencies: ListCaptureWorkspaceDependencies,
): Promise<CaptureWorkspaceResult> {
  if (
    !isRecord(actor)
    || !isSafeMediaPathSegment(actor.uid)
    || !["admin", "staff", "reviewer"].includes(actor.role)
  ) {
    throw new Error("field_capture_workspace_invalid");
  }
  if (actor.role === "reviewer") {
    return { targets: [], openSessions: [] };
  }

  const assignmentPromise = actor.role === "staff"
    ? dependencies.listAssignedBuildingIds(actor.uid)
    : Promise.resolve([]);
  const [
    rawAssignedBuildingIds,
    rawBuildings,
    rawUnits,
    rawListings,
    rawSessions,
  ] = await Promise.all([
    assignmentPromise,
    dependencies.listBuildings(),
    dependencies.listUnits(),
    dependencies.listListings(),
    dependencies.listCaptureSessions(),
  ]);

  const assignedBuildingIds = new Set(
    Array.isArray(rawAssignedBuildingIds)
      ? rawAssignedBuildingIds.filter(isSafeMediaPathSegment)
      : [],
  );
  const buildings = records(rawBuildings)
    .map(sanitizeBuilding)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const allowedBuildings = new Map(buildings
    .filter((building) => (
      actor.role === "admin" || assignedBuildingIds.has(building.id)
    ))
    .map((building) => [building.id, building]));
  const units = records(rawUnits)
    .map(sanitizeUnit)
    .filter((value): value is NonNullable<typeof value> => (
      value !== null && allowedBuildings.has(value.buildingId)
    ));

  const targets: CaptureWorkspaceTarget[] = [];
  const seenTargets = new Set<string>();
  for (const building of allowedBuildings.values()) {
    if (!building.managementActive) continue;
    const buildingUnits = units.filter((unit) => unit.buildingId === building.id);
    if (buildingUnits.length === 0) {
      addTarget(targets, seenTargets, {
        id: managementTargetId(building.id),
        buildingId: building.id,
        buildingName: building.name,
        source: "management",
      });
      continue;
    }
    for (const unit of buildingUnits) {
      addTarget(targets, seenTargets, {
        id: managementTargetId(building.id, unit.id),
        buildingId: building.id,
        buildingName: building.name,
        unitId: unit.id,
        unitLabel: unit.unitLabel,
        source: "management",
      });
    }
  }

  for (const value of records(rawListings)) {
    const listing = sanitizeListing(value);
    if (!listing) continue;
    const building = allowedBuildings.get(listing.buildingId);
    if (!building) continue;
    addTarget(targets, seenTargets, {
      id: advertisingTargetId(listing.id),
      buildingId: listing.buildingId,
      buildingName: building.name,
      unitId: listing.unitId,
      unitLabel: listing.unitLabel,
      listingId: listing.id,
      source: "advertising",
    });
  }

  const sessionsById = new Map<string, OpenCaptureWorkspaceSession>();
  for (const value of records(rawSessions)) {
    const captureSession = sanitizeOpenSession(value, actor.uid);
    if (
      captureSession
      && sessionHasTarget(captureSession, targets)
      && !sessionsById.has(captureSession.id)
    ) {
      sessionsById.set(captureSession.id, captureSession);
    }
  }
  return {
    targets,
    openSessions: [...sessionsById.values()].sort(newestFirst),
  };
}

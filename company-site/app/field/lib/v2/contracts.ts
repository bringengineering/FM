export const FIELD_PROTOCOL_VERSION = 2 as const;
export const FIELD_BUILD_VERSION = "1.0.0" as const;
export const FIELD_MAX_BRIDGE_BYTES = 32_768 as const;
export const FIELD_BRIDGE_TIMEOUT_MS = 10_000 as const;
export const FIELD_ORIGIN = "https://bring-fm.web.app" as const;

export const FIELD_JOB_TYPES = Object.freeze([
  "vacancy_capture",
  "move_out_check",
  "cleaning_before_after",
  "maintenance_inspection",
  "complaint_check",
  "repair_before_after",
] as const);
export const FIELD_WORKFLOW_STATUSES = Object.freeze([
  "requested",
  "assigned",
  "accepted",
  "in_progress",
  "evidence_ready",
  "review_pending",
  "changes_requested",
  "approved",
  "completed",
  "cancelled",
] as const);
export const FIELD_UPLOAD_STATUSES = Object.freeze([
  "none",
  "queued",
  "uploading",
  "partial_failure",
  "failed",
  "synced",
] as const);
export const FIELD_PRIORITIES = Object.freeze([
  "low",
  "normal",
  "high",
  "urgent",
] as const);

export type FieldCrmRole = "admin" | "member" | "viewer";
export type FieldJobType = typeof FIELD_JOB_TYPES[number];
export type FieldWorkflowStatus = typeof FIELD_WORKFLOW_STATUSES[number];
export type FieldUploadStatus = typeof FIELD_UPLOAD_STATUSES[number];
export type FieldPriority = typeof FIELD_PRIORITIES[number];
export type FieldWorkspaceScope = "personal" | "team";

export interface FieldKpis {
  readonly todayVisits: number;
  readonly capturePending: number;
  readonly uploadFailures: number;
  readonly reviewPending: number;
  readonly unassigned: number;
  readonly overdue: number;
  readonly adminActionRequired: number;
}

export interface FieldSourceSnapshot {
  readonly parentType: "building" | "salesProspect";
  readonly parentId: string;
  readonly parentName: string;
  readonly address: string;
  readonly unitType?: "buildingUnit" | "salesUnit";
  readonly unitId?: string;
  readonly unitLabel?: string;
  readonly depositWon?: number;
  readonly monthlyRentWon?: number;
  readonly maintenanceFeeWon?: number;
  readonly moveOutAt?: string;
  readonly availableFrom?: string;
}

export interface FieldWorkspaceItem {
  readonly id?: string;
  readonly fieldJobId?: string;
  readonly visitId: string;
  readonly jobType: FieldJobType;
  readonly jobPolicyVersion?: string;
  readonly checklistId?: string;
  readonly parentName?: string;
  readonly address?: string;
  readonly unitLabel?: string | null;
  readonly assignedOperatorId: string | null;
  readonly dueDate: string;
  readonly priority: FieldPriority;
  readonly workflowStatus: FieldWorkflowStatus;
  readonly uploadStatus: FieldUploadStatus;
  readonly sourceSnapshot?: FieldSourceSnapshot;
  readonly sourceVersion?: Readonly<Record<string, string>>;
  readonly sourceHash?: string;
  readonly mediaCount: number;
  readonly uploadFailureCount: number;
  readonly adminActionRequired: boolean;
  readonly updatedAt: string;
  readonly archivedAt?: string | null;
  readonly activeOrderKey?: string;
}

export interface FieldOperationsWorkspace {
  readonly items: readonly FieldWorkspaceItem[];
  readonly kpis: FieldKpis;
  readonly scope: FieldWorkspaceScope;
  readonly nextCursor: string | null;
  readonly kpiSeoulDate?: string;
  readonly kpiSource?: string;
}

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SHA_256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SECRET_KEY = /(?:password|passcode|secret|token|credential|doorlock|accesscode|keylocation|oauth|privatekey)/iu;
const KPI_KEYS = Object.freeze([
  "adminActionRequired",
  "capturePending",
  "overdue",
  "reviewPending",
  "todayVisits",
  "unassigned",
  "uploadFailures",
] as const);
const FIELD_JOB_POLICY = Object.freeze({
  vacancy_capture: Object.freeze({
    policyVersion: "FIELD_V2_VACANCY_CAPTURE",
    checklistId: "VACANCY_CAPTURE_V1",
  }),
  move_out_check: Object.freeze({
    policyVersion: "FIELD_V2_MOVE_OUT_CHECK",
    checklistId: "MOVE_OUT_CHECK_V1",
  }),
  cleaning_before_after: Object.freeze({
    policyVersion: "FIELD_V2_CLEANING_BEFORE_AFTER",
    checklistId: "CLEAN_BEFORE_AFTER_V1",
  }),
  maintenance_inspection: Object.freeze({
    policyVersion: "FIELD_V2_MAINTENANCE_INSPECTION",
    checklistId: "MAINTENANCE_INSPECTION_V1",
  }),
  complaint_check: Object.freeze({
    policyVersion: "FIELD_V2_COMPLAINT_CHECK",
    checklistId: "COMPLAINT_CHECK_V1",
  }),
  repair_before_after: Object.freeze({
    policyVersion: "FIELD_V2_REPAIR_BEFORE_AFTER",
    checklistId: "REPAIR_BEFORE_AFTER_V1",
  }),
} satisfies Record<FieldJobType, { policyVersion: string; checklistId: string }>);
const FIELD_PRIORITY_RANK: Readonly<Record<FieldPriority, number>> = Object.freeze({
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
});
const PERSONAL_ITEM_KEYS = new Set([
  "id", "visitId", "jobType", "jobPolicyVersion", "checklistId",
  "crmBuildingId", "crmBuildingUnitId", "crmSalesProspectId", "crmSalesUnitId",
  "crmWorkflowCaseId", "crmTaskId", "assignedOperatorId", "dueDate", "priority",
  "workflowStatus", "uploadStatus", "sourceSnapshot", "sourceVersion", "sourceHash",
  "mediaCount", "uploadFailureCount", "adminActionRequired", "adPackageId",
  "acceptedAt", "startedAt", "evidenceReadyAt", "reviewPendingAt", "completedAt",
  "cancelledAt", "cancelReason", "createdAt", "createdByAuthUid", "createdByOperatorId",
  "updatedAt", "updatedByAuthUid", "updatedByOperatorId", "archivedAt",
]);
const TEAM_ITEM_KEYS = new Set([
  "fieldJobId", "visitId", "jobType", "parentName", "address", "unitLabel",
  "assignedOperatorId", "dueDate", "priority", "workflowStatus", "uploadStatus",
  "mediaCount", "uploadFailureCount", "adminActionRequired", "updatedAt", "activeOrderKey",
]);
const MAX_WORKSPACE_RESPONSE_BYTES = 256 * 1024;

export function isStrictFieldBuildVersion(value: unknown): value is string {
  return typeof value === "string" && STRICT_SEMVER.test(value);
}

export function isPlainFieldRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isSafeFieldId(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_ID.test(value)
    && !FORBIDDEN_KEYS.has(value);
}

export function isFieldRequestId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function fieldUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isSafeFieldValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return fieldUtf8Bytes(value) <= 16_384
    && !/[\u0000-\u001f\u007f]/u.test(value);
  if (Array.isArray(value)) {
    return value.length <= 200 && value.every((entry) => isSafeFieldValue(entry, depth + 1));
  }
  if (!isPlainFieldRecord(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(([key, entry]) => (
    key.length <= 128
    && !FORBIDDEN_KEYS.has(key)
    && !SECRET_KEY.test(key)
    && isSafeFieldValue(entry, depth + 1)
  ));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isBoundedCopy(value: unknown, bytes: number, nullable = false): boolean {
  if (nullable && value === null) return true;
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && new TextEncoder().encode(value).byteLength <= bytes;
}

function parseFieldKpis(value: unknown): FieldKpis {
  if (!isPlainFieldRecord(value) || !exactKeys(value, KPI_KEYS)) {
    throw new Error("field_workspace_invalid");
  }
  for (const key of KPI_KEYS) {
    if (!isNonnegativeSafeInteger(value[key])) throw new Error("field_workspace_invalid");
  }
  return Object.freeze({ ...value }) as unknown as FieldKpis;
}

function validSourceSnapshot(value: unknown): value is FieldSourceSnapshot {
  if (!isPlainFieldRecord(value)) return false;
  const allowed = new Set([
    "parentType", "parentId", "parentName", "address", "unitType", "unitId", "unitLabel",
    "depositWon", "monthlyRentWon", "maintenanceFeeWon", "moveOutAt", "availableFrom",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (
    !["building", "salesProspect"].includes(String(value.parentType))
    || !isSafeFieldId(value.parentId)
    || !isBoundedCopy(value.parentName, 512)
    || !isBoundedCopy(value.address, 2_048)
  ) return false;
  if (value.unitType !== undefined && !["buildingUnit", "salesUnit"].includes(String(value.unitType))) return false;
  if (value.unitId !== undefined && !isSafeFieldId(value.unitId)) return false;
  if (value.unitLabel !== undefined && !isBoundedCopy(value.unitLabel, 256)) return false;
  for (const key of ["depositWon", "monthlyRentWon", "maintenanceFeeWon"] as const) {
    if (value[key] !== undefined && !isNonnegativeSafeInteger(value[key])) return false;
  }
  for (const key of ["moveOutAt", "availableFrom"] as const) {
    if (value[key] !== undefined && !isCalendarDate(value[key])) return false;
  }
  return isSafeFieldValue(value);
}

function validPersonalWorkspaceInvariants(value: Record<string, unknown>): boolean {
  const jobType = value.jobType as FieldJobType;
  const policy = FIELD_JOB_POLICY[jobType];
  const snapshot = value.sourceSnapshot as FieldSourceSnapshot;
  const status = value.workflowStatus as FieldWorkflowStatus;
  const crmBuildingId = value.crmBuildingId;
  const crmSalesProspectId = value.crmSalesProspectId;
  const crmBuildingUnitId = value.crmBuildingUnitId;
  const crmSalesUnitId = value.crmSalesUnitId;
  const hasBuilding = crmBuildingId !== undefined;
  const hasProspect = crmSalesProspectId !== undefined;
  const hasBuildingUnit = crmBuildingUnitId !== undefined;
  const hasSalesUnit = crmSalesUnitId !== undefined;
  if (
    !policy
    || value.jobPolicyVersion !== policy.policyVersion
    || value.checklistId !== policy.checklistId
    || hasBuilding === hasProspect
    || hasBuildingUnit && hasSalesUnit
    || (snapshot.parentType === "building"
      ? snapshot.parentId !== crmBuildingId
      : snapshot.parentId !== crmSalesProspectId)
    || ((snapshot.unitType === undefined) !== (snapshot.unitId === undefined))
    || ((snapshot.unitType === undefined) !== (snapshot.unitLabel === undefined))
    || (hasSalesUnit
      ? snapshot.unitType !== "salesUnit" || snapshot.unitId !== crmSalesUnitId
      : hasBuildingUnit
        ? snapshot.unitType !== "buildingUnit" || snapshot.unitId !== crmBuildingUnitId
        : snapshot.unitType !== undefined || snapshot.unitId !== undefined)
    || (snapshot.unitType === "salesUnit"
      ? [snapshot.depositWon, snapshot.monthlyRentWon, snapshot.maintenanceFeeWon]
        .some((money) => money === undefined)
      : [
        snapshot.depositWon,
        snapshot.monthlyRentWon,
        snapshot.maintenanceFeeWon,
        snapshot.moveOutAt,
        snapshot.availableFrom,
      ].some((field) => field !== undefined))
    || (status === "requested"
      ? value.assignedOperatorId !== null
      : value.assignedOperatorId === null)
  ) return false;

  const acceptedRequired = [
    "accepted", "in_progress", "evidence_ready", "review_pending",
    "changes_requested", "approved", "completed",
  ].includes(status);
  const startedRequired = [
    "in_progress", "evidence_ready", "review_pending", "changes_requested",
    "approved", "completed",
  ].includes(status);
  const evidenceRequired = [
    "evidence_ready", "review_pending", "changes_requested", "approved", "completed",
  ].includes(status);
  const reviewRequired = ["review_pending", "changes_requested", "approved"].includes(status);
  return !(
    (acceptedRequired && !isIsoDateTime(value.acceptedAt))
    || (startedRequired && !isIsoDateTime(value.startedAt))
    || (evidenceRequired && !isIsoDateTime(value.evidenceReadyAt))
    || (reviewRequired && !isIsoDateTime(value.reviewPendingAt))
    || (["requested", "assigned"].includes(status) && value.acceptedAt !== undefined)
    || (["requested", "assigned", "accepted"].includes(status) && value.startedAt !== undefined)
    || (status === "completed" && !isIsoDateTime(value.completedAt))
    || (status !== "completed" && value.completedAt !== undefined)
    || (status === "cancelled" && (
      !isIsoDateTime(value.cancelledAt)
      || typeof value.cancelReason !== "string"
      || value.cancelReason.trim().length === 0
    ))
    || (status !== "cancelled"
      && (value.cancelledAt !== undefined || value.cancelReason !== undefined))
  );
}

function parseWorkspaceItem(value: unknown, scope: FieldWorkspaceScope): FieldWorkspaceItem {
  if (!isPlainFieldRecord(value) || !isSafeFieldValue(value)) {
    throw new Error("field_workspace_invalid");
  }
  const allowedKeys = scope === "personal" ? PERSONAL_ITEM_KEYS : TEAM_ITEM_KEYS;
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error("field_workspace_invalid");
  const identifier = scope === "personal" ? value.id : value.fieldJobId;
  if (
    !isSafeFieldId(identifier)
    || !isSafeFieldId(value.visitId)
    || !FIELD_JOB_TYPES.includes(value.jobType as FieldJobType)
    || !FIELD_WORKFLOW_STATUSES.includes(value.workflowStatus as FieldWorkflowStatus)
    || !FIELD_UPLOAD_STATUSES.includes(value.uploadStatus as FieldUploadStatus)
    || !FIELD_PRIORITIES.includes(value.priority as FieldPriority)
    || (value.assignedOperatorId !== null && !isSafeFieldId(value.assignedOperatorId))
    || !isCalendarDate(value.dueDate)
    || !isNonnegativeSafeInteger(value.mediaCount)
    || !isNonnegativeSafeInteger(value.uploadFailureCount)
    || typeof value.adminActionRequired !== "boolean"
    || !isIsoDateTime(value.updatedAt)
  ) throw new Error("field_workspace_invalid");

  if (scope === "personal") {
    const optionalIds = [
      value.crmBuildingId,
      value.crmBuildingUnitId,
      value.crmSalesProspectId,
      value.crmSalesUnitId,
      value.crmWorkflowCaseId,
      value.crmTaskId,
    ];
    const lifecycleTimestamps = [
      value.acceptedAt,
      value.startedAt,
      value.evidenceReadyAt,
      value.reviewPendingAt,
      value.completedAt,
      value.cancelledAt,
    ];
    if (
      typeof value.jobPolicyVersion !== "string"
      || value.jobPolicyVersion.length === 0
      || typeof value.checklistId !== "string"
      || value.checklistId.length === 0
      || !validSourceSnapshot(value.sourceSnapshot)
      || !validPersonalWorkspaceInvariants(value)
      || !isPlainFieldRecord(value.sourceVersion)
      || !exactKeys(
        value.sourceVersion,
        value.sourceSnapshot && isPlainFieldRecord(value.sourceSnapshot)
          && value.sourceSnapshot.unitType !== undefined
          ? ["parentUpdatedAt", "unitUpdatedAt"]
          : ["parentUpdatedAt"],
      )
      || !Object.values(value.sourceVersion).every(isIsoDateTime)
      || optionalIds.some((id) => id !== undefined && !isSafeFieldId(id))
      || (value.adPackageId !== undefined && value.adPackageId !== null && !isSafeFieldId(value.adPackageId))
      || lifecycleTimestamps.some((timestamp) => timestamp !== undefined && !isIsoDateTime(timestamp))
      || (value.cancelReason !== undefined && (
        typeof value.cancelReason !== "string"
        || value.cancelReason.trim().length === 0
        || new TextEncoder().encode(value.cancelReason).byteLength > 2_000
      ))
      || typeof value.sourceHash !== "string"
      || !SHA_256.test(value.sourceHash)
      || !isIsoDateTime(value.createdAt)
      || !isSafeFieldId(value.createdByAuthUid)
      || !isSafeFieldId(value.createdByOperatorId)
      || !isSafeFieldId(value.updatedByAuthUid)
      || !isSafeFieldId(value.updatedByOperatorId)
      || (value.archivedAt !== null && !isIsoDateTime(value.archivedAt))
    ) throw new Error("field_workspace_invalid");
  } else if (
    !isBoundedCopy(value.parentName, 512)
    || !isBoundedCopy(value.address, 2_048)
    || !isBoundedCopy(value.unitLabel, 256, true)
    || value.workflowStatus === "completed"
    || value.workflowStatus === "cancelled"
    || typeof value.activeOrderKey !== "string"
    || value.activeOrderKey !== [
      value.dueDate,
      FIELD_PRIORITY_RANK[value.priority as FieldPriority],
      value.updatedAt,
      value.fieldJobId,
    ].join("|")
  ) throw new Error("field_workspace_invalid");
  return Object.freeze({ ...value }) as unknown as FieldWorkspaceItem;
}

export function parsePersonalFieldWorkspaceItem(value: unknown): FieldWorkspaceItem {
  return parseWorkspaceItem(value, "personal");
}

function canonicalizeFieldSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeFieldSource);
  if (isPlainFieldRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalizeFieldSource(value[key])]),
    );
  }
  return value;
}

async function fieldSourceHash(snapshot: FieldSourceSnapshot, version: Readonly<Record<string, string>>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("field_workspace_invalid");
  const canonical = JSON.stringify(canonicalizeFieldSource({ snapshot, version }));
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyFieldOperationsWorkspaceIntegrity(
  workspace: FieldOperationsWorkspace,
): Promise<FieldOperationsWorkspace> {
  if (workspace.scope === "team") return workspace;
  try {
    await Promise.all(workspace.items.map(async (item) => {
      if (!item.sourceSnapshot || !item.sourceVersion || !item.sourceHash) {
        throw new Error("field_workspace_invalid");
      }
      if (await fieldSourceHash(item.sourceSnapshot, item.sourceVersion) !== item.sourceHash) {
        throw new Error("field_workspace_invalid");
      }
    }));
  } catch {
    throw new Error("field_workspace_invalid");
  }
  return workspace;
}

export function parseFieldOperationsWorkspace(value: unknown): FieldOperationsWorkspace {
  if (!isPlainFieldRecord(value) || fieldUtf8Bytes(value) > MAX_WORKSPACE_RESPONSE_BYTES) {
    throw new Error("field_workspace_invalid");
  }
  const allowed = new Set(["items", "kpis", "scope", "nextCursor", "kpiSeoulDate", "kpiSource"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("field_workspace_invalid");
  if (value.scope !== "personal" && value.scope !== "team") throw new Error("field_workspace_invalid");
  if (!Array.isArray(value.items) || value.items.length > 100) throw new Error("field_workspace_invalid");
  if (value.nextCursor !== null && (
    typeof value.nextCursor !== "string"
    || value.nextCursor.length === 0
    || value.nextCursor.length > 512
  )) {
    throw new Error("field_workspace_invalid");
  }
  if (value.kpiSeoulDate !== undefined && !isCalendarDate(value.kpiSeoulDate)) {
    throw new Error("field_workspace_invalid");
  }
  if (value.kpiSource !== undefined && value.kpiSource !== "server") {
    throw new Error("field_workspace_invalid");
  }
  return Object.freeze({
    items: Object.freeze(value.items.map((item) => parseWorkspaceItem(item, value.scope as FieldWorkspaceScope))),
    kpis: parseFieldKpis(value.kpis),
    scope: value.scope,
    nextCursor: value.nextCursor,
    ...(value.kpiSeoulDate === undefined ? {} : { kpiSeoulDate: value.kpiSeoulDate }),
    ...(value.kpiSource === undefined ? {} : { kpiSource: value.kpiSource }),
  }) as FieldOperationsWorkspace;
}

export function fieldWorkspaceItemId(item: FieldWorkspaceItem): string {
  return String(item.id ?? item.fieldJobId ?? "");
}

export function fieldWorkspaceItemCopy(item: FieldWorkspaceItem): {
  parentName: string;
  address: string;
  unitLabel: string;
} {
  return {
    parentName: String(item.sourceSnapshot?.parentName ?? item.parentName ?? "현장 업무"),
    address: String(item.sourceSnapshot?.address ?? item.address ?? "주소 확인 필요"),
    unitLabel: String(item.sourceSnapshot?.unitLabel ?? item.unitLabel ?? "공용부"),
  };
}

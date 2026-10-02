import { FieldV2Error, type FieldJobType, type FieldUploadStatus, type FieldWorkflowStatus } from "./contracts.js";
import type { FieldPriority, FieldWorkItem } from "./work-items.js";

export interface FieldKpis {
  todayVisits: number;
  capturePending: number;
  uploadFailures: number;
  reviewPending: number;
  unassigned: number;
  overdue: number;
  adminActionRequired: number;
}

export interface FieldOperatorJobProjection {
  readonly fieldJobId: string;
  readonly visitId: string;
  readonly jobType: FieldJobType;
  readonly parentName: string;
  readonly address: string;
  readonly unitLabel: string | null;
  readonly assignedOperatorId: string | null;
  readonly dueDate: string;
  readonly priority: FieldPriority;
  readonly workflowStatus: FieldWorkflowStatus;
  readonly uploadStatus: FieldUploadStatus;
  readonly mediaCount: number;
  readonly uploadFailureCount: number;
  readonly adminActionRequired: boolean;
  readonly updatedAt: string;
}

export type FieldUnassignedProjection = FieldOperatorJobProjection;
export interface FieldTeamActiveProjection extends FieldOperatorJobProjection {
  readonly activeOrderKey: string;
}

export interface CrmFieldSummary {
  readonly fieldJobId: string;
  readonly crmBuildingId?: string;
  readonly crmBuildingUnitId?: string;
  readonly crmSalesProspectId?: string;
  readonly crmSalesUnitId?: string;
  readonly crmWorkflowCaseId?: string;
  readonly crmTaskId?: string;
  readonly jobType: FieldJobType;
  readonly assignedOperatorId: string | null;
  readonly dueDate: string;
  readonly workflowStatus: FieldWorkflowStatus;
  readonly mediaCount: number;
  readonly uploadFailureCount: number;
  readonly reviewStatus: "not_started" | "pending" | "changes_requested" | "approved";
  readonly adPackageId: string | null;
  readonly updatedAt: string;
}

const ACTIVE_CAPTURE_STATUSES = new Set<FieldWorkflowStatus>([
  "requested",
  "assigned",
  "accepted",
  "in_progress",
]);
const CAPTURE_PENDING_JOB_TYPES = new Set<FieldJobType>([
  "vacancy_capture",
  "cleaning_before_after",
  "complaint_check",
  "repair_before_after",
]);
const UPLOAD_FAILURE_STATUSES = new Set<FieldUploadStatus>([
  "partial_failure",
  "failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActive(item: FieldWorkItem): boolean {
  return item.archivedAt === null
    && item.workflowStatus !== "completed"
    && item.workflowStatus !== "cancelled";
}

function assertProjectableItem(value: unknown): asserts value is FieldWorkItem {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.visitId !== "string"
    || !isRecord(value.sourceSnapshot)
    || typeof value.sourceSnapshot.parentName !== "string"
    || typeof value.sourceSnapshot.address !== "string"
  ) {
    throw new FieldV2Error("field_projection_invalid");
  }
}

function seoulDate(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new FieldV2Error("field_kpi_now_invalid");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!byType.year || !byType.month || !byType.day) {
    throw new FieldV2Error("field_kpi_now_invalid");
  }
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function reviewStatus(item: FieldWorkItem): CrmFieldSummary["reviewStatus"] {
  if (item.workflowStatus === "review_pending") return "pending";
  if (item.workflowStatus === "changes_requested") return "changes_requested";
  if (item.workflowStatus === "approved" || item.workflowStatus === "completed") {
    return "approved";
  }
  return "not_started";
}

export function calculateFieldKpis(
  items: readonly FieldWorkItem[],
  now: Date,
): FieldKpis {
  const today = seoulDate(now);
  if (!Array.isArray(items)) throw new FieldV2Error("field_kpi_items_invalid");

  const todayVisitIds = new Set<string>();
  let capturePending = 0;
  let uploadFailures = 0;
  let reviewPending = 0;
  let unassigned = 0;
  let overdue = 0;
  let adminActionRequired = 0;

  for (const value of items) {
    assertProjectableItem(value);
    if (!isActive(value)) continue;
    if (value.dueDate === today) todayVisitIds.add(value.visitId);
    if (
      CAPTURE_PENDING_JOB_TYPES.has(value.jobType)
      && ACTIVE_CAPTURE_STATUSES.has(value.workflowStatus)
    ) capturePending += 1;
    if (UPLOAD_FAILURE_STATUSES.has(value.uploadStatus)) uploadFailures += 1;
    if (value.jobType === "vacancy_capture" && value.workflowStatus === "review_pending") {
      reviewPending += 1;
    }
    if (value.assignedOperatorId === null) unassigned += 1;
    if (value.dueDate < today) overdue += 1;
    if (value.adminActionRequired === true) adminActionRequired += 1;
  }

  return Object.freeze({
    todayVisits: todayVisitIds.size,
    capturePending,
    uploadFailures,
    reviewPending,
    unassigned,
    overdue,
    adminActionRequired,
  });
}

/**
 * Personal KPI semantics are deliberately narrower than the personal list:
 * every metric here covers only active work assigned to the selected operator.
 * The workspace API may separately add the authoritative team-wide unassigned
 * count for admin/member actors who are allowed to see that queue.
 */
export function calculateFieldOperatorKpis(
  items: readonly FieldWorkItem[],
  operatorId: string,
  now: Date,
): FieldKpis {
  if (typeof operatorId !== "string" || operatorId.trim().length === 0) {
    throw new FieldV2Error("field_operator_invalid");
  }
  if (!Array.isArray(items)) throw new FieldV2Error("field_kpi_items_invalid");
  const assigned = items.filter((item) => {
    assertProjectableItem(item);
    return item.assignedOperatorId === operatorId;
  });
  const result = calculateFieldKpis(assigned, now);
  return Object.freeze({ ...result, unassigned: 0 });
}

export function buildOperatorProjection(
  item: FieldWorkItem,
): FieldOperatorJobProjection {
  assertProjectableItem(item);
  return Object.freeze({
    fieldJobId: item.id,
    visitId: item.visitId,
    jobType: item.jobType,
    parentName: item.sourceSnapshot.parentName,
    address: item.sourceSnapshot.address,
    unitLabel: item.sourceSnapshot.unitLabel ?? null,
    assignedOperatorId: item.assignedOperatorId,
    dueDate: item.dueDate,
    priority: item.priority,
    workflowStatus: item.workflowStatus,
    uploadStatus: item.uploadStatus,
    mediaCount: item.mediaCount,
    uploadFailureCount: item.uploadFailureCount,
    adminActionRequired: item.adminActionRequired,
    updatedAt: item.updatedAt,
  });
}

export function buildUnassignedProjection(
  item: FieldWorkItem,
): FieldUnassignedProjection | null {
  assertProjectableItem(item);
  if (item.assignedOperatorId !== null || !isActive(item)) return null;
  return buildOperatorProjection(item);
}

export function buildTeamActiveProjection(
  item: FieldWorkItem,
): FieldTeamActiveProjection | null {
  assertProjectableItem(item);
  if (!isActive(item)) return null;
  const priorityRank: Readonly<Record<FieldPriority, number>> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  return Object.freeze({
    ...buildOperatorProjection(item),
    activeOrderKey: [
      item.dueDate,
      priorityRank[item.priority],
      item.updatedAt,
      item.id,
    ].join("|"),
  });
}

export function buildCrmFieldSummary(item: FieldWorkItem): CrmFieldSummary {
  assertProjectableItem(item);
  return Object.freeze({
    fieldJobId: item.id,
    ...(item.crmBuildingId === undefined ? {} : { crmBuildingId: item.crmBuildingId }),
    ...(item.crmBuildingUnitId === undefined ? {} : { crmBuildingUnitId: item.crmBuildingUnitId }),
    ...(item.crmSalesProspectId === undefined ? {} : { crmSalesProspectId: item.crmSalesProspectId }),
    ...(item.crmSalesUnitId === undefined ? {} : { crmSalesUnitId: item.crmSalesUnitId }),
    ...(item.crmWorkflowCaseId === undefined ? {} : { crmWorkflowCaseId: item.crmWorkflowCaseId }),
    ...(item.crmTaskId === undefined ? {} : { crmTaskId: item.crmTaskId }),
    jobType: item.jobType,
    assignedOperatorId: item.assignedOperatorId,
    dueDate: item.dueDate,
    workflowStatus: item.workflowStatus,
    mediaCount: item.mediaCount,
    uploadFailureCount: item.uploadFailureCount,
    reviewStatus: reviewStatus(item),
    adPackageId: item.adPackageId ?? null,
    updatedAt: item.updatedAt,
  });
}

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { assertFieldActorCanMutate } from "./access.js";
import {
  FIELD_JOB_TYPES,
  FIELD_UPLOAD_STATUSES,
  FIELD_WORKFLOW_STATUSES,
  FieldV2Error,
  isFieldRequestId,
  type FieldJobType,
  type FieldMutationOperationKind,
  type FieldReleaseClient,
  type FieldUploadStatus,
  type FieldV2Actor,
  type FieldWorkflowStatus,
} from "./contracts.js";
import { fieldJobPolicies, transitionFieldStatus } from "./policies.js";
import {
  buildCrmFieldSummary,
  buildOperatorProjection,
  buildTeamActiveProjection,
  buildUnassignedProjection,
  calculateFieldKpis,
  type CrmFieldSummary,
  type FieldKpis,
  type FieldOperatorJobProjection,
  type FieldTeamActiveProjection,
  type FieldUnassignedProjection,
} from "./projections.js";

export const FIELD_PRIORITIES = Object.freeze([
  "low",
  "normal",
  "high",
  "urgent",
] as const);

export type FieldPriority = typeof FIELD_PRIORITIES[number];

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

export interface FieldSourceVersion {
  readonly parentUpdatedAt: string;
  readonly unitUpdatedAt?: string;
}

export interface FieldWorkItem {
  readonly id: string;
  readonly visitId: string;
  readonly jobType: FieldJobType;
  readonly jobPolicyVersion: string;
  readonly checklistId: string;
  readonly crmBuildingId?: string;
  readonly crmBuildingUnitId?: string;
  readonly crmSalesProspectId?: string;
  readonly crmSalesUnitId?: string;
  readonly crmWorkflowCaseId?: string;
  readonly crmTaskId?: string;
  readonly assignedOperatorId: string | null;
  readonly dueDate: string;
  readonly priority: FieldPriority;
  readonly workflowStatus: FieldWorkflowStatus;
  readonly uploadStatus: FieldUploadStatus;
  readonly sourceSnapshot: FieldSourceSnapshot;
  readonly sourceVersion: FieldSourceVersion;
  readonly sourceHash: string;
  readonly mediaCount: number;
  readonly uploadFailureCount: number;
  readonly adminActionRequired: boolean;
  readonly adPackageId?: string | null;
  readonly acceptedAt?: string;
  readonly startedAt?: string;
  readonly evidenceReadyAt?: string;
  readonly reviewPendingAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly cancelReason?: string;
  readonly createdAt: string;
  readonly createdByAuthUid: string;
  readonly createdByOperatorId: string;
  readonly updatedAt: string;
  readonly updatedByAuthUid: string;
  readonly updatedByOperatorId: string;
  readonly archivedAt: string | null;
}

export interface FieldVisit {
  readonly id: string;
  readonly crmBuildingId?: string;
  readonly crmSalesProspectId?: string;
  readonly workItemIds: readonly string[];
  readonly assignedOperatorId: string | null;
  readonly dueDate: string;
  readonly priority: FieldPriority;
  readonly accessPreparationStatus: "unknown" | "ready" | "blocked";
  readonly sharedMediaIds: readonly string[];
  readonly createdAt: string;
  readonly createdByAuthUid: string;
  readonly createdByOperatorId: string;
  readonly updatedAt: string;
  readonly updatedByAuthUid: string;
  readonly updatedByOperatorId: string;
  readonly archivedAt: string | null;
}

export interface CreateFieldJobsInput {
  requestId: string;
  operatorId: string;
  jobType: FieldJobType;
  crmBuildingId?: string;
  crmSalesProspectId?: string;
  crmBuildingUnitIds?: readonly string[];
  crmSalesUnitIds?: readonly string[];
  crmWorkflowCaseId?: string;
  crmTaskId?: string;
  dueDate: string;
  priority: FieldPriority;
  assignedOperatorId?: string | null;
}

export interface CreateFieldJobsResult {
  readonly visitId: string;
  readonly jobIds: readonly string[];
  readonly repeated: boolean;
}

export interface ClaimFieldJobInput {
  requestId: string;
  operatorId: string;
  jobId: string;
}

export interface AssignFieldJobInput {
  requestId: string;
  operatorId: string;
  jobId: string;
  assignedOperatorId: string | null;
  reason: string;
}

export interface ChangeFieldVisitInput {
  requestId: string;
  operatorId: string;
  visitId: string;
  jobId?: string;
  dueDate?: string;
  assignedOperatorId?: string | null;
  priority?: FieldPriority;
  reason: string;
}

export interface ChangeFieldVisitResult {
  readonly visitId: string;
  readonly newVisitId?: string;
  readonly updatedJobIds: readonly string[];
  readonly workItems: readonly FieldWorkItem[];
}

export interface TransitionFieldJobInput {
  requestId: string;
  operatorId: string;
  jobId: string;
  toStatus: FieldWorkflowStatus;
  reason?: string;
  inspectionOutcome?: "no_issue" | "issue_found";
}

export interface CrmBuildingSource {
  id: string;
  name: string;
  address: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface CrmSalesProspectSource {
  id: string;
  name: string;
  address: string;
  updatedAt: string;
  archivedAt?: string | null;
  crmBuildingId?: string;
}

export interface CrmBuildingUnitSource {
  id: string;
  crmBuildingId: string;
  label: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface CrmSalesUnitSource {
  id: string;
  crmBuildingId?: string;
  crmSalesProspectId?: string;
  crmBuildingUnitId?: string;
  label: string;
  deposit: number;
  rent: number;
  maintenanceFee: number;
  moveOutAt?: string;
  availableFrom?: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface FieldOperatorSource {
  id: string;
  active: boolean;
  displayName: string;
}

export interface FieldAtomicCreateCommand {
  readonly receiptPath: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly result: Omit<CreateFieldJobsResult, "repeated">;
  readonly sourceExpectations: readonly FieldCrmSourceExpectation[];
  readonly requiredActiveOperatorIds: readonly string[];
  readonly runtimeGuard?: FieldAtomicRuntimeGuard;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface FieldAtomicRuntimeGuard {
  readonly authUid: string;
  readonly operatorId: string;
  readonly authenticatedEmail: string;
  readonly client: FieldReleaseClient;
  readonly operationKind: FieldMutationOperationKind;
}

export interface FieldCrmSourceExpectation {
  readonly path: string;
  readonly id: string;
  readonly updatedAt: string;
  readonly parentField?: "crmBuildingId" | "crmSalesProspectId" | "prospectId";
  readonly parentId?: string;
  readonly kind?: "entity" | "workflowCase" | "task";
  readonly prospectBuildingId?: string;
}

export type FieldAtomicCreateOutcome =
  | { readonly kind: "created"; readonly result: Omit<CreateFieldJobsResult, "repeated"> }
  | { readonly kind: "replayed"; readonly result: Omit<CreateFieldJobsResult, "repeated"> }
  | { readonly kind: "conflict" };

export interface FieldMutationReceipt {
  readonly scope: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly result: unknown;
  readonly createdAt: string;
}

export interface FieldWorkTransactionSnapshot {
  readonly workItem: FieldWorkItem | null;
  readonly visit: FieldVisit | null;
  readonly visitWorkItems: readonly FieldWorkItem[];
  readonly receipt?: FieldMutationReceipt | null;
}

export type FieldWorkTransactionDecision<Result> =
  | { readonly patch: Readonly<Record<string, unknown>>; readonly result: Result }
  | { readonly replay: true; readonly result: Result }
  | { readonly errorCode: string };

export interface FieldWorkTransactionSelector {
  readonly scope: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly jobId?: string;
  readonly visitId?: string;
  readonly requiredActiveOperatorIds?: readonly string[];
  readonly runtimeGuard?: FieldAtomicRuntimeGuard;
}

export interface FieldWorkspaceRecords {
  readonly items: readonly (FieldWorkItem | FieldTeamActiveProjection)[];
  readonly kpis?: FieldKpis;
  readonly kpiSeoulDate?: string;
  readonly nextCursor?: string;
}

export interface FieldOperationsWorkspace {
  readonly items: readonly (FieldWorkItem | FieldTeamActiveProjection)[];
  readonly kpis: FieldKpis;
  readonly scope: "personal" | "team";
  readonly nextCursor: string | null;
}

export interface ListFieldOperationsWorkspaceInput {
  operatorId: string;
  scope?: "personal" | "team";
  limit?: number;
  cursor?: string;
}

export interface FieldWorkspaceQuery {
  readonly scope: "personal" | "team";
  readonly limit: number;
  readonly cursor?: string;
}

export interface WorkItemDependencies {
  now(): string;
  readCrmBuilding(id: string): Promise<unknown>;
  readCrmSalesProspect(id: string): Promise<unknown>;
  readCrmBuildingUnit(id: string): Promise<unknown>;
  readCrmSalesUnit(id: string): Promise<unknown>;
  readCrmWorkflowCase(id: string): Promise<unknown>;
  readCrmTask(id: string): Promise<unknown>;
  readOperator(id: string): Promise<unknown>;
  readCreationReceipt(scope: "createFieldJobs", requestId: string): Promise<unknown>;
  commitCreation(command: FieldAtomicCreateCommand): Promise<FieldAtomicCreateOutcome>;
  transactWork<Result>(
    selector: FieldWorkTransactionSelector,
    decide: (snapshot: FieldWorkTransactionSnapshot) => FieldWorkTransactionDecision<Result>,
  ): Promise<Result>;
  readWorkspace(actor: FieldV2Actor, query: FieldWorkspaceQuery): Promise<FieldWorkspaceRecords>;
}

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[^.#$\[\]/\u0000-\u001f\u007f]+$/u;
const RESERVED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_REASON_BYTES = 2_000;
const MAX_CRM_NAME_BYTES = 512;
const MAX_CRM_ADDRESS_BYTES = 2_048;
const MAX_CRM_UNIT_LABEL_BYTES = 256;
const MAX_UNIT_COUNT = 200;
const FIELD_SOURCE_SNAPSHOT_KEYS = new Set([
  "parentType", "parentId", "parentName", "address", "unitType", "unitId", "unitLabel",
  "depositWon", "monthlyRentWon", "maintenanceFeeWon", "moveOutAt", "availableFrom",
]);
const FIELD_SOURCE_VERSION_KEYS = new Set(["parentUpdatedAt", "unitUpdatedAt"]);
const FIELD_WORK_ITEM_KEYS = new Set([
  "id", "visitId", "jobType", "jobPolicyVersion", "checklistId",
  "crmBuildingId", "crmBuildingUnitId", "crmSalesProspectId", "crmSalesUnitId",
  "crmWorkflowCaseId", "crmTaskId", "assignedOperatorId", "dueDate", "priority",
  "workflowStatus", "uploadStatus", "sourceSnapshot", "sourceVersion", "sourceHash",
  "mediaCount", "uploadFailureCount", "adminActionRequired", "adPackageId",
  "acceptedAt", "startedAt", "evidenceReadyAt", "reviewPendingAt", "completedAt",
  "cancelledAt", "cancelReason", "createdAt", "createdByAuthUid", "createdByOperatorId",
  "updatedAt", "updatedByAuthUid", "updatedByOperatorId", "archivedAt",
]);
const FIELD_VISIT_KEYS = new Set([
  "id", "crmBuildingId", "crmSalesProspectId", "workItemIds", "assignedOperatorId",
  "dueDate", "priority", "accessPreparationStatus", "sharedMediaIds", "createdAt",
  "createdByAuthUid", "createdByOperatorId", "updatedAt", "updatedByAuthUid",
  "updatedByOperatorId", "archivedAt",
]);
const FIELD_RECEIPT_KEYS = new Set([
  "scope", "requestId", "requestHash", "result", "createdAt",
]);
const FIELD_CREATION_RESULT_KEYS = new Set(["visitId", "jobIds"]);
const FIELD_CHANGE_RESULT_KEYS = new Set([
  "visitId", "newVisitId", "updatedJobIds", "workItems",
]);
const NOT_STARTED_STATUSES = new Set<FieldWorkflowStatus>([
  "requested",
  "assigned",
  "accepted",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function fail(code: string): never {
  throw new FieldV2Error(code);
}

function isPathSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 128
    && !RESERVED_PATH_SEGMENTS.has(value)
    && ID_PATTERN.test(value);
}

function requiredId(value: unknown, code = "field_work_input_invalid"): string {
  if (!isPathSafeId(value)) fail(code);
  return value;
}

function optionalId(value: unknown, code = "field_work_input_invalid"): string | undefined {
  if (value === undefined) return undefined;
  return requiredId(value, code);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function requiredDate(value: unknown): string {
  if (!isDate(value)) fail("field_due_date_invalid");
  return value;
}

function optionalCrmDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isDate(value)) fail("field_crm_reference_invalid");
  return value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function currentTimestamp(dependencies: WorkItemDependencies): string {
  let value: unknown;
  try {
    value = dependencies.now();
  } catch {
    fail("field_server_time_invalid");
  }
  if (!isTimestamp(value)) fail("field_server_time_invalid");
  return value;
}

function seoulDateFromTimestamp(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail("field_kpi_now_invalid");
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  if (!parts.year || !parts.month || !parts.day) fail("field_kpi_now_invalid");
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function requiredText(value: unknown, code: string, maximumBytes = 4_096): string {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value !== value.trim()
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) fail(code);
  return value;
}

function requiredReason(value: unknown): string {
  return requiredText(value, "field_change_reason_required", MAX_REASON_BYTES);
}

function priority(value: unknown): FieldPriority {
  if (typeof value !== "string" || !(FIELD_PRIORITIES as readonly string[]).includes(value)) {
    fail("field_priority_invalid");
  }
  return value as FieldPriority;
}

function jobType(value: unknown): FieldJobType {
  if (typeof value !== "string" || !(FIELD_JOB_TYPES as readonly string[]).includes(value)) {
    fail("field_job_type_invalid");
  }
  return value as FieldJobType;
}

function assertActor(inputOperatorId: unknown, actor: FieldV2Actor): void {
  const operatorId = requiredId(inputOperatorId, "field_operator_invalid");
  if (operatorId !== actor.operatorId) fail("field_operator_mismatch");
}

function assertRequestId(value: unknown): string {
  if (!isFieldRequestId(value)) fail("field_request_id_invalid");
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function stableId(prefix: string, requestId: string, suffix: string): string {
  const digest = createHash("sha256")
    .update(`${prefix}\0${requestId}\0${suffix}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeIdArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_UNIT_COUNT) {
    fail("field_unit_references_invalid");
  }
  const values = value.map((item) => requiredId(item, "field_unit_references_invalid"));
  if (new Set(values).size !== values.length) fail("field_unit_references_duplicate");
  return [...values].sort();
}

function optionalMoney(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("field_crm_reference_invalid");
  }
  return value;
}

function parseParent(
  value: unknown,
  expectedId: string,
  parentType: FieldSourceSnapshot["parentType"],
): CrmBuildingSource | CrmSalesProspectSource {
  if (
    !isRecord(value)
    || value.id !== expectedId
    || !isTimestamp(value.updatedAt)
  ) fail("field_crm_reference_invalid");
  const name = requiredText(value.name, "field_crm_reference_invalid", MAX_CRM_NAME_BYTES);
  const address = requiredText(value.address, "field_crm_reference_invalid", MAX_CRM_ADDRESS_BYTES);
  if (value.archivedAt !== undefined && value.archivedAt !== null && value.archivedAt !== "") {
    if (!isTimestamp(value.archivedAt)) fail("field_crm_reference_invalid");
    fail("field_crm_reference_archived");
  }
  return {
    id: expectedId,
    name,
    address,
    updatedAt: value.updatedAt,
    archivedAt: null,
    ...(parentType === "salesProspect" && isPathSafeId(value.crmBuildingId)
      ? { crmBuildingId: value.crmBuildingId }
      : {}),
  };
}

function parseBuildingUnit(
  value: unknown,
  expectedId: string,
  parentId: string,
): CrmBuildingUnitSource {
  if (
    !isRecord(value)
    || value.id !== expectedId
    || value.crmBuildingId !== parentId
    || !isTimestamp(value.updatedAt)
  ) {
    if (isRecord(value) && value.id === expectedId && value.crmBuildingId !== parentId) {
      fail("field_crm_reference_mismatch");
    }
    fail("field_crm_reference_invalid");
  }
  const label = requiredText(value.label, "field_crm_reference_invalid", MAX_CRM_UNIT_LABEL_BYTES);
  if (value.archivedAt !== undefined && value.archivedAt !== null && value.archivedAt !== "") {
    if (!isTimestamp(value.archivedAt)) fail("field_crm_reference_invalid");
    fail("field_crm_reference_archived");
  }
  return {
    id: expectedId,
    crmBuildingId: parentId,
    label,
    updatedAt: value.updatedAt,
    archivedAt: null,
  };
}

function parseSalesUnit(
  value: unknown,
  expectedId: string,
  parent: { type: FieldSourceSnapshot["parentType"]; id: string },
): CrmSalesUnitSource {
  if (!isRecord(value) || value.id !== expectedId) fail("field_crm_reference_invalid");
  const actualParent = parent.type === "building"
    ? value.crmBuildingId
    : value.crmSalesProspectId ?? value.prospectId;
  if (actualParent !== parent.id) fail("field_crm_reference_mismatch");
  if (
    !isTimestamp(value.updatedAt)
  ) fail("field_crm_reference_invalid");
  const label = requiredText(value.label, "field_crm_reference_invalid", MAX_CRM_UNIT_LABEL_BYTES);
  const moveOutAt = optionalCrmDate(value.moveOutAt);
  const availableFrom = optionalCrmDate(value.availableFrom);
  if (value.archivedAt !== undefined && value.archivedAt !== null && value.archivedAt !== "") {
    if (!isTimestamp(value.archivedAt)) fail("field_crm_reference_invalid");
    fail("field_crm_reference_archived");
  }
  return {
    id: expectedId,
    ...(typeof value.crmBuildingId === "string" ? { crmBuildingId: value.crmBuildingId } : {}),
    ...(typeof value.crmSalesProspectId === "string" ? { crmSalesProspectId: value.crmSalesProspectId } : {}),
    ...(typeof value.crmBuildingUnitId === "string" ? { crmBuildingUnitId: value.crmBuildingUnitId } : {}),
    label,
    deposit: optionalMoney(value.deposit),
    rent: optionalMoney(value.rent),
    maintenanceFee: optionalMoney(value.maintenanceFee),
    ...(moveOutAt === undefined ? {} : { moveOutAt }),
    ...(availableFrom === undefined ? {} : { availableFrom }),
    updatedAt: value.updatedAt,
    archivedAt: null,
  };
}

async function assertActiveOperator(
  operatorId: string | null,
  dependencies: WorkItemDependencies,
): Promise<void> {
  if (operatorId === null) return;
  let value: unknown;
  try {
    value = await dependencies.readOperator(operatorId);
  } catch {
    fail("field_assignee_invalid");
  }
  if (
    !isRecord(value)
    || value.id !== operatorId
    || value.active !== true
    || typeof value.displayName !== "string"
    || value.displayName.trim().length === 0
  ) fail("field_assignee_invalid");
}

function auditStamp(actor: FieldV2Actor, now: string) {
  return {
    createdAt: now,
    createdByAuthUid: actor.authUid,
    createdByOperatorId: actor.operatorId,
    updatedAt: now,
    updatedByAuthUid: actor.authUid,
    updatedByOperatorId: actor.operatorId,
    archivedAt: null,
  } as const;
}

function updatedStamp(actor: FieldV2Actor, now: string) {
  return {
    updatedAt: now,
    updatedByAuthUid: actor.authUid,
    updatedByOperatorId: actor.operatorId,
  } as const;
}

function frozenItem(item: FieldWorkItem): FieldWorkItem {
  return Object.freeze({
    ...item,
    sourceSnapshot: Object.freeze({ ...item.sourceSnapshot }),
    sourceVersion: Object.freeze({ ...item.sourceVersion }),
  });
}

function frozenVisit(visit: FieldVisit): FieldVisit {
  return Object.freeze({
    ...visit,
    workItemIds: Object.freeze([...visit.workItemIds]),
    sharedMediaIds: Object.freeze([...visit.sharedMediaIds]),
  });
}

function operationAudit(
  action: string,
  entityType: "visit" | "workItem",
  entityId: string,
  requestId: string,
  actor: FieldV2Actor,
  now: string,
  reason?: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: stableId("audit", requestId, `${action}:${entityId}`),
    action,
    entityType,
    entityId,
    requestId,
    authUid: actor.authUid,
    operatorId: actor.operatorId,
    occurredAt: now,
    ...(reason === undefined ? {} : { reason }),
  });
}

function receipt(
  scope: string,
  requestId: string,
  requestHash: string,
  result: unknown,
  now: string,
): FieldMutationReceipt {
  return Object.freeze({ scope, requestId, requestHash, result, createdAt: now });
}

function projectionPatch(item: FieldWorkItem, previous?: FieldWorkItem): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (previous?.assignedOperatorId) {
    patch[`fieldPlatform/v2/projections/operatorJobs/${previous.assignedOperatorId}/${item.id}`] = null;
  } else if (previous) {
    patch[`fieldPlatform/v2/projections/unassigned/${item.id}`] = null;
  }
  if (item.archivedAt !== null || item.workflowStatus === "completed" || item.workflowStatus === "cancelled") {
    patch[`fieldPlatform/v2/projections/unassigned/${item.id}`] = null;
    if (item.assignedOperatorId) {
      patch[`fieldPlatform/v2/projections/operatorJobs/${item.assignedOperatorId}/${item.id}`] = null;
    }
  } else if (item.assignedOperatorId) {
    patch[`fieldPlatform/v2/projections/operatorJobs/${item.assignedOperatorId}/${item.id}`] = buildOperatorProjection(item);
    patch[`fieldPlatform/v2/projections/unassigned/${item.id}`] = null;
  } else {
    patch[`fieldPlatform/v2/projections/unassigned/${item.id}`] = buildUnassignedProjection(item);
  }
  patch[`crmCompany/fieldSummaries/${item.id}`] = buildCrmFieldSummary(item);
  patch[`fieldPlatform/v2/projections/teamActive/${item.id}`] = buildTeamActiveProjection(item);
  return patch;
}

interface NormalizedCreateInput {
  requestId: string;
  operatorId: string;
  jobType: FieldJobType;
  parentType: "building" | "salesProspect";
  parentId: string;
  crmBuildingUnitIds?: string[];
  crmSalesUnitIds?: string[];
  crmWorkflowCaseId?: string;
  crmTaskId?: string;
  dueDate: string;
  priority: FieldPriority;
  assignedOperatorId: string | null;
}

function normalizeCreateInput(input: CreateFieldJobsInput, actor: FieldV2Actor): NormalizedCreateInput {
  if (!isRecord(input)) fail("field_work_input_invalid");
  assertActor(input.operatorId, actor);
  const requestId = assertRequestId(input.requestId);
  const buildingId = optionalId(input.crmBuildingId);
  const prospectId = optionalId(input.crmSalesProspectId);
  if ((buildingId === undefined) === (prospectId === undefined)) {
    fail("field_parent_reference_invalid");
  }
  const buildingUnitIds = normalizeIdArray(input.crmBuildingUnitIds);
  const salesUnitIds = normalizeIdArray(input.crmSalesUnitIds);
  if (buildingUnitIds && salesUnitIds) fail("field_unit_references_invalid");
  if (buildingUnitIds && !buildingId) fail("field_crm_reference_mismatch");
  const assignedOperatorId = input.assignedOperatorId === undefined || input.assignedOperatorId === null
    ? null
    : requiredId(input.assignedOperatorId, "field_assignee_invalid");
  const crmWorkflowCaseId = optionalId(input.crmWorkflowCaseId);
  const crmTaskId = optionalId(input.crmTaskId);
  return {
    requestId,
    operatorId: actor.operatorId,
    jobType: jobType(input.jobType),
    parentType: buildingId ? "building" : "salesProspect",
    parentId: buildingId ?? prospectId!,
    ...(buildingUnitIds === undefined ? {} : { crmBuildingUnitIds: buildingUnitIds }),
    ...(salesUnitIds === undefined ? {} : { crmSalesUnitIds: salesUnitIds }),
    ...(crmWorkflowCaseId === undefined ? {} : { crmWorkflowCaseId }),
    ...(crmTaskId === undefined ? {} : { crmTaskId }),
    dueDate: requiredDate(input.dueDate),
    priority: priority(input.priority),
    assignedOperatorId,
  };
}

type ResolvedUnit =
  | { type: "buildingUnit"; value: CrmBuildingUnitSource }
  | { type: "salesUnit"; value: CrmSalesUnitSource };

async function resolveCreateSources(
  input: NormalizedCreateInput,
  dependencies: WorkItemDependencies,
): Promise<{
  parent: CrmBuildingSource | CrmSalesProspectSource;
  units: ResolvedUnit[];
}> {
  let parentValue: unknown;
  try {
    parentValue = input.parentType === "building"
      ? await dependencies.readCrmBuilding(input.parentId)
      : await dependencies.readCrmSalesProspect(input.parentId);
  } catch {
    fail("field_crm_reference_unavailable");
  }
  const parent = parseParent(parentValue, input.parentId, input.parentType);
  const units: ResolvedUnit[] = [];
  for (const unitId of input.crmBuildingUnitIds ?? []) {
    let value: unknown;
    try {
      value = await dependencies.readCrmBuildingUnit(unitId);
    } catch {
      fail("field_crm_reference_unavailable");
    }
    units.push({ type: "buildingUnit", value: parseBuildingUnit(value, unitId, input.parentId) });
  }
  for (const unitId of input.crmSalesUnitIds ?? []) {
    let value: unknown;
    try {
      value = await dependencies.readCrmSalesUnit(unitId);
    } catch {
      fail("field_crm_reference_unavailable");
    }
    units.push({
      type: "salesUnit",
      value: parseSalesUnit(value, unitId, { type: input.parentType, id: input.parentId }),
    });
  }
  return { parent, units };
}

interface ResolvedAuxiliaryCrmRefs {
  workflowCase?: { id: string; updatedAt?: string; crmBuildingId: string };
  task?: { id: string; updatedAt?: string };
}

async function resolveAuxiliaryCrmRefs(
  input: NormalizedCreateInput,
  parent: CrmBuildingSource | CrmSalesProspectSource,
  dependencies: WorkItemDependencies,
): Promise<ResolvedAuxiliaryCrmRefs> {
  const resolved: {
    workflowCase?: { id: string; updatedAt?: string; crmBuildingId: string };
    task?: { id: string; updatedAt?: string };
  } = {};
  if (input.crmWorkflowCaseId) {
    let value: unknown;
    try {
      value = await dependencies.readCrmWorkflowCase(input.crmWorkflowCaseId);
    } catch {
      fail("field_crm_reference_unavailable");
    }
    if (!isRecord(value)) fail("field_crm_reference_invalid");
    if (value.deleted === true || value.archived === true) {
      fail("field_crm_reference_inactive");
    }
    if (!isPathSafeId(value.crmBuildingId)) fail("field_crm_reference_mismatch");
    if (input.parentType === "building") {
      if (value.crmBuildingId !== input.parentId) fail("field_crm_reference_mismatch");
    } else {
      const prospectBuildingId = (parent as unknown as UnknownRecord).crmBuildingId;
      if (!isPathSafeId(prospectBuildingId) || value.crmBuildingId !== prospectBuildingId) {
        fail("field_crm_reference_mismatch");
      }
    }
    if (value.updatedAt !== undefined && !isTimestamp(value.updatedAt)) {
      fail("field_crm_reference_invalid");
    }
    resolved.workflowCase = {
      id: input.crmWorkflowCaseId,
      crmBuildingId: value.crmBuildingId,
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    };
  }
  if (input.crmTaskId) {
    let value: unknown;
    try {
      value = await dependencies.readCrmTask(input.crmTaskId);
    } catch {
      fail("field_crm_reference_unavailable");
    }
    if (
      !isRecord(value)
      || value.id !== input.crmTaskId
      || typeof value.status !== "string"
      || value.status.trim().length === 0
      || value.status !== value.status.trim()
      || Buffer.byteLength(value.status, "utf8") > 120
    ) {
      fail("field_crm_reference_invalid");
    }
    if (value.status === "완료" || value.status === "취소") {
      fail("field_crm_reference_inactive");
    }
    if (value.updatedAt !== undefined && !isTimestamp(value.updatedAt)) {
      fail("field_crm_reference_invalid");
    }
    resolved.task = {
      id: input.crmTaskId,
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    };
  }
  return Object.freeze(resolved);
}

function sourceFor(
  input: NormalizedCreateInput,
  parent: CrmBuildingSource | CrmSalesProspectSource,
  unit?: ResolvedUnit,
): { snapshot: FieldSourceSnapshot; version: FieldSourceVersion; hash: string } {
  const snapshot: FieldSourceSnapshot = Object.freeze({
    parentType: input.parentType,
    parentId: input.parentId,
    parentName: parent.name,
    address: parent.address,
    ...(unit === undefined ? {} : {
      unitType: unit.type,
      unitId: unit.value.id,
      unitLabel: unit.value.label,
    }),
    ...(unit?.type === "salesUnit" ? {
      depositWon: unit.value.deposit,
      monthlyRentWon: unit.value.rent,
      maintenanceFeeWon: unit.value.maintenanceFee,
      ...(unit.value.moveOutAt === undefined ? {} : { moveOutAt: unit.value.moveOutAt }),
      ...(unit.value.availableFrom === undefined ? {} : { availableFrom: unit.value.availableFrom }),
    } : {}),
  });
  const version: FieldSourceVersion = Object.freeze({
    parentUpdatedAt: parent.updatedAt,
    ...(unit === undefined ? {} : { unitUpdatedAt: unit.value.updatedAt }),
  });
  return { snapshot, version, hash: sha256({ snapshot, version }) };
}

export async function createFieldJobsCore(
  input: CreateFieldJobsInput,
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<CreateFieldJobsResult> {
  if (!isRecord(dependencies) || typeof dependencies.commitCreation !== "function") {
    fail("field_work_dependencies_invalid");
  }
  const normalized = normalizeCreateInput(input, actor);
  const requestHash = sha256(normalized);
  const readReplay = async (): Promise<CreateFieldJobsResult | null> => {
    let stored: unknown;
    try {
      stored = await dependencies.readCreationReceipt(
        "createFieldJobs",
        normalized.requestId,
      );
    } catch (error) {
      if (error instanceof FieldV2Error) throw error;
      fail("field_request_receipt_unavailable");
    }
    if (stored === null || stored === undefined) return null;
    const parsed = parseFieldMutationReceipt(
      stored,
      "createFieldJobs",
      normalized.requestId,
    );
    if (parsed.requestHash !== requestHash) fail("field_request_id_conflict");
    const result = creationReceiptResult(parsed.result);
    return Object.freeze({
      visitId: result.visitId,
      jobIds: result.jobIds,
      repeated: true,
    });
  };
  const replay = await readReplay();
  if (replay) return replay;
  assertFieldActorCanMutate(actor);
  let sources: Awaited<ReturnType<typeof resolveCreateSources>>;
  let auxiliaryRefs: Awaited<ReturnType<typeof resolveAuxiliaryCrmRefs>>;
  try {
    await assertActiveOperator(normalized.assignedOperatorId, dependencies);
    sources = await resolveCreateSources(normalized, dependencies);
    auxiliaryRefs = await resolveAuxiliaryCrmRefs(normalized, sources.parent, dependencies);
  } catch (error) {
    const racedReplay = await readReplay();
    if (racedReplay) return racedReplay;
    throw error;
  }
  const { parent, units } = sources;
  const now = currentTimestamp(dependencies);
  const visitId = stableId("visit", normalized.requestId, `${normalized.parentType}:${normalized.parentId}`);
  const workSources: Array<ResolvedUnit | undefined> = units.length === 0 ? [undefined] : units;
  const jobIds = workSources.map((unit, index) => stableId(
    "job",
    normalized.requestId,
    unit === undefined ? `building:${index}` : `${unit.type}:${unit.value.id}`,
  ));
  const baseResult = Object.freeze({
    visitId,
    jobIds: Object.freeze([...jobIds]),
  });
  const stamp = auditStamp(actor, now);
  const visit: FieldVisit = frozenVisit({
    id: visitId,
    ...(normalized.parentType === "building"
      ? { crmBuildingId: normalized.parentId }
      : { crmSalesProspectId: normalized.parentId }),
    workItemIds: jobIds,
    assignedOperatorId: normalized.assignedOperatorId,
    dueDate: normalized.dueDate,
    priority: normalized.priority,
    accessPreparationStatus: "unknown",
    sharedMediaIds: [],
    ...stamp,
  });
  const workItems = workSources.map((unit, index): FieldWorkItem => {
    const source = sourceFor(normalized, parent, unit);
    const policy = fieldJobPolicies[normalized.jobType];
    return frozenItem({
      id: jobIds[index],
      visitId,
      jobType: normalized.jobType,
      jobPolicyVersion: policy.policyVersion,
      checklistId: policy.checklistId,
      ...(normalized.parentType === "building"
        ? { crmBuildingId: normalized.parentId }
        : { crmSalesProspectId: normalized.parentId }),
      ...(unit?.type === "buildingUnit" ? { crmBuildingUnitId: unit.value.id } : {}),
      ...(unit?.type === "salesUnit" ? {
        crmSalesUnitId: unit.value.id,
        ...(unit.value.crmBuildingUnitId === undefined
          ? {}
          : { crmBuildingUnitId: unit.value.crmBuildingUnitId }),
      } : {}),
      ...(normalized.crmWorkflowCaseId === undefined ? {} : { crmWorkflowCaseId: normalized.crmWorkflowCaseId }),
      ...(normalized.crmTaskId === undefined ? {} : { crmTaskId: normalized.crmTaskId }),
      assignedOperatorId: normalized.assignedOperatorId,
      dueDate: normalized.dueDate,
      priority: normalized.priority,
      workflowStatus: normalized.assignedOperatorId === null ? "requested" : "assigned",
      uploadStatus: "none",
      sourceSnapshot: source.snapshot,
      sourceVersion: source.version,
      sourceHash: source.hash,
      mediaCount: 0,
      uploadFailureCount: 0,
      adminActionRequired: false,
      ...stamp,
    });
  });

  const patch: Record<string, unknown> = {
    [`fieldPlatform/v2/visits/${visitId}`]: visit,
  };
  const visitAudit = operationAudit(
    "field.visit.created",
    "visit",
    visitId,
    normalized.requestId,
    actor,
    now,
  );
  patch[`fieldPlatform/v2/auditLogs/${visitAudit.id}`] = visitAudit;
  for (const item of workItems) {
    patch[`fieldPlatform/v2/workItems/${item.id}`] = item;
    Object.assign(patch, projectionPatch(item));
    const audit = operationAudit(
      "field.workItem.created",
      "workItem",
      item.id,
      normalized.requestId,
      actor,
      now,
    );
    patch[`fieldPlatform/v2/auditLogs/${audit.id}`] = audit;
  }
  const receiptPath = `fieldPlatform/v2/requestReceipts/createFieldJobs/${normalized.requestId}`;
  patch[receiptPath] = receipt(
    "createFieldJobs",
    normalized.requestId,
    requestHash,
    baseResult,
    now,
  );

  const sourceExpectations: FieldCrmSourceExpectation[] = [{
    path: normalized.parentType === "building"
      ? `crmCompany/data/buildings/${normalized.parentId}`
      : `crmCompany/data/salesProspects/${normalized.parentId}`,
    id: normalized.parentId,
    updatedAt: parent.updatedAt,
    ...(normalized.parentType === "salesProspect" && auxiliaryRefs.workflowCase
      ? {
        parentField: "crmBuildingId" as const,
        parentId: auxiliaryRefs.workflowCase.crmBuildingId,
      }
      : {}),
  }];
  for (const unit of units) {
    sourceExpectations.push({
      path: unit.type === "buildingUnit"
        ? `crmCompany/data/buildingUnits/${unit.value.id}`
        : `crmCompany/data/salesUnits/${unit.value.id}`,
      id: unit.value.id,
      updatedAt: unit.value.updatedAt,
      parentField: unit.type === "buildingUnit"
        ? "crmBuildingId"
        : normalized.parentType === "building"
          ? "crmBuildingId"
          : "prospectId",
      parentId: normalized.parentId,
    });
  }
  if (auxiliaryRefs.workflowCase) {
    sourceExpectations.push({
      path: `crmCompany/cases/${auxiliaryRefs.workflowCase.id}`,
      id: auxiliaryRefs.workflowCase.id,
      updatedAt: auxiliaryRefs.workflowCase.updatedAt ?? "",
      parentField: "crmBuildingId",
      parentId: auxiliaryRefs.workflowCase.crmBuildingId,
      kind: "workflowCase",
    });
  }
  if (auxiliaryRefs.task) {
    sourceExpectations.push({
      path: `crmCompany/data/tasks/${auxiliaryRefs.task.id}`,
      id: auxiliaryRefs.task.id,
      updatedAt: auxiliaryRefs.task.updatedAt ?? "",
      kind: "task",
    });
  }
  const outcome = await dependencies.commitCreation(Object.freeze({
    receiptPath,
    requestId: normalized.requestId,
    requestHash,
    result: baseResult,
    sourceExpectations: Object.freeze(sourceExpectations.map((value) => Object.freeze({ ...value }))),
    requiredActiveOperatorIds: Object.freeze([
      actor.operatorId,
      ...(normalized.assignedOperatorId === null ? [] : [normalized.assignedOperatorId]),
    ].filter((value, index, values) => values.indexOf(value) === index).sort()),
    patch: Object.freeze({ ...patch }),
  }));
  if (outcome.kind === "conflict") fail("field_request_id_conflict");
  if (outcome.kind !== "created" && outcome.kind !== "replayed") {
    fail("field_creation_transaction_failed");
  }
  return Object.freeze({
    visitId: outcome.result.visitId,
    jobIds: Object.freeze([...outcome.result.jobIds]),
    repeated: outcome.kind === "replayed",
  });
}

function assertStoredWorkItem(value: unknown, expectedId?: string): asserts value is FieldWorkItem {
  const snapshot = isRecord(value) && isRecord(value.sourceSnapshot)
    ? value.sourceSnapshot
    : null;
  const version = isRecord(value) && isRecord(value.sourceVersion)
    ? value.sourceVersion
    : null;
  const assignedOperatorId = isRecord(value) ? value.assignedOperatorId : undefined;
  const status = isRecord(value) ? value.workflowStatus : undefined;
  const policy = typeof (isRecord(value) ? value.jobType : undefined) === "string"
    ? fieldJobPolicies[(value as UnknownRecord).jobType as FieldJobType]
    : undefined;
  const crmBuildingId = isRecord(value) ? value.crmBuildingId : undefined;
  const crmSalesProspectId = isRecord(value) ? value.crmSalesProspectId : undefined;
  const crmBuildingUnitId = isRecord(value) ? value.crmBuildingUnitId : undefined;
  const crmSalesUnitId = isRecord(value) ? value.crmSalesUnitId : undefined;
  const optionalTimestamps = isRecord(value)
    ? [
      value.acceptedAt,
      value.startedAt,
      value.evidenceReadyAt,
      value.reviewPendingAt,
      value.completedAt,
      value.cancelledAt,
    ]
    : [];
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, FIELD_WORK_ITEM_KEYS)
    || !isPathSafeId(value.id)
    || (expectedId !== undefined && value.id !== expectedId)
    || !isPathSafeId(value.visitId)
    || !isPathSafeId(value.createdByAuthUid)
    || !isPathSafeId(value.createdByOperatorId)
    || !isPathSafeId(value.updatedByAuthUid)
    || !isPathSafeId(value.updatedByOperatorId)
    || typeof value.jobType !== "string"
    || !(FIELD_JOB_TYPES as readonly string[]).includes(value.jobType)
    || typeof value.workflowStatus !== "string"
    || !(FIELD_WORKFLOW_STATUSES as readonly string[]).includes(value.workflowStatus)
    || typeof value.uploadStatus !== "string"
    || !(FIELD_UPLOAD_STATUSES as readonly string[]).includes(value.uploadStatus)
    || typeof value.priority !== "string"
    || !(FIELD_PRIORITIES as readonly string[]).includes(value.priority)
    || !isDate(value.dueDate)
    || typeof value.jobPolicyVersion !== "string"
    || value.jobPolicyVersion.length === 0
    || !policy
    || value.jobPolicyVersion !== policy.policyVersion
    || typeof value.checklistId !== "string"
    || value.checklistId.length === 0
    || value.checklistId !== policy.checklistId
    || (crmBuildingId !== undefined && !isPathSafeId(crmBuildingId))
    || (crmSalesProspectId !== undefined && !isPathSafeId(crmSalesProspectId))
    || ((crmBuildingId === undefined) === (crmSalesProspectId === undefined))
    || (crmBuildingUnitId !== undefined && !isPathSafeId(crmBuildingUnitId))
    || (crmSalesUnitId !== undefined && !isPathSafeId(crmSalesUnitId))
    || (value.crmWorkflowCaseId !== undefined && !isPathSafeId(value.crmWorkflowCaseId))
    || (value.crmTaskId !== undefined && !isPathSafeId(value.crmTaskId))
    || (value.adPackageId !== undefined
      && value.adPackageId !== null
      && !isPathSafeId(value.adPackageId))
    || (assignedOperatorId !== null && !isPathSafeId(assignedOperatorId))
    || (status === "requested" ? assignedOperatorId !== null : assignedOperatorId === null)
    || typeof value.mediaCount !== "number"
    || !Number.isSafeInteger(value.mediaCount)
    || value.mediaCount < 0
    || typeof value.uploadFailureCount !== "number"
    || !Number.isSafeInteger(value.uploadFailureCount)
    || value.uploadFailureCount < 0
    || typeof value.adminActionRequired !== "boolean"
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || optionalTimestamps.some((timestamp) => timestamp !== undefined && !isTimestamp(timestamp))
    || (value.archivedAt !== null && !isTimestamp(value.archivedAt))
    || !HASH_PATTERN.test(String(value.sourceHash))
    || !snapshot
    || !hasOnlyKeys(snapshot, FIELD_SOURCE_SNAPSHOT_KEYS)
    || (snapshot.parentType !== "building" && snapshot.parentType !== "salesProspect")
    || !isPathSafeId(snapshot.parentId)
    || (snapshot.parentType === "building"
      ? snapshot.parentId !== crmBuildingId
      : snapshot.parentId !== crmSalesProspectId)
    || typeof snapshot.parentName !== "string"
    || snapshot.parentName.length === 0
    || snapshot.parentName !== snapshot.parentName.trim()
    || /[\u0000-\u001f\u007f]/u.test(snapshot.parentName)
    || Buffer.byteLength(snapshot.parentName, "utf8") > MAX_CRM_NAME_BYTES
    || typeof snapshot.address !== "string"
    || snapshot.address.length === 0
    || snapshot.address !== snapshot.address.trim()
    || /[\u0000-\u001f\u007f]/u.test(snapshot.address)
    || Buffer.byteLength(snapshot.address, "utf8") > MAX_CRM_ADDRESS_BYTES
    || (snapshot.unitType !== undefined
      && snapshot.unitType !== "buildingUnit"
      && snapshot.unitType !== "salesUnit")
    || (snapshot.unitId !== undefined && !isPathSafeId(snapshot.unitId))
    || ((snapshot.unitType === undefined) !== (snapshot.unitId === undefined))
    || ((snapshot.unitType === undefined) !== (snapshot.unitLabel === undefined))
    || (crmSalesUnitId !== undefined
      ? snapshot.unitType !== "salesUnit" || snapshot.unitId !== crmSalesUnitId
      : crmBuildingUnitId !== undefined
        ? snapshot.unitType !== "buildingUnit" || snapshot.unitId !== crmBuildingUnitId
        : snapshot.unitType !== undefined || snapshot.unitId !== undefined)
    || (snapshot.unitLabel !== undefined
      && (typeof snapshot.unitLabel !== "string"
        || snapshot.unitLabel.length === 0
        || snapshot.unitLabel !== snapshot.unitLabel.trim()
        || /[\u0000-\u001f\u007f]/u.test(snapshot.unitLabel)
        || Buffer.byteLength(snapshot.unitLabel, "utf8") > MAX_CRM_UNIT_LABEL_BYTES))
    || [snapshot.depositWon, snapshot.monthlyRentWon, snapshot.maintenanceFeeWon]
      .some((money) => money !== undefined
        && (!Number.isSafeInteger(money) || (money as number) < 0))
    || [snapshot.moveOutAt, snapshot.availableFrom]
      .some((date) => date !== undefined && !isDate(date))
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
    || !version
    || !hasOnlyKeys(version, FIELD_SOURCE_VERSION_KEYS)
    || !isTimestamp(version.parentUpdatedAt)
    || (version.unitUpdatedAt !== undefined && !isTimestamp(version.unitUpdatedAt))
    || ((snapshot.unitType === undefined) !== (version.unitUpdatedAt === undefined))
    || value.sourceHash !== sha256({ snapshot, version })
    || ([
      "accepted", "in_progress", "evidence_ready", "review_pending",
      "changes_requested", "approved", "completed",
    ].includes(String(status)) && !isTimestamp(value.acceptedAt))
    || ([
      "in_progress", "evidence_ready", "review_pending",
      "changes_requested", "approved", "completed",
    ].includes(String(status)) && !isTimestamp(value.startedAt))
    || ([
      "evidence_ready", "review_pending", "changes_requested", "approved", "completed",
    ].includes(String(status)) && !isTimestamp(value.evidenceReadyAt))
    || (["review_pending", "changes_requested", "approved"].includes(String(status))
      && !isTimestamp(value.reviewPendingAt))
    || ((status === "requested" || status === "assigned") && value.acceptedAt !== undefined)
    || ((status === "requested" || status === "assigned" || status === "accepted")
      && value.startedAt !== undefined)
    || (status === "completed" && !isTimestamp(value.completedAt))
    || (status !== "completed" && value.completedAt !== undefined)
    || (status === "cancelled" && (
      !isTimestamp(value.cancelledAt)
      || typeof value.cancelReason !== "string"
      || value.cancelReason.trim().length === 0
    ))
    || (status !== "cancelled"
      && (value.cancelledAt !== undefined || value.cancelReason !== undefined))
  ) fail("field_work_item_state_invalid");
}

function assertStoredVisit(value: unknown, expectedId?: string): asserts value is FieldVisit {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, FIELD_VISIT_KEYS)
    || !isPathSafeId(value.id)
    || (expectedId !== undefined && value.id !== expectedId)
    || !Array.isArray(value.workItemIds)
    || value.workItemIds.length === 0
    || value.workItemIds.some((id) => !isPathSafeId(id))
    || new Set(value.workItemIds).size !== value.workItemIds.length
    || !Array.isArray(value.sharedMediaIds)
    || value.sharedMediaIds.some((id) => !isPathSafeId(id))
    || new Set(value.sharedMediaIds).size !== value.sharedMediaIds.length
    || ((value.crmBuildingId === undefined) === (value.crmSalesProspectId === undefined))
    || (value.crmBuildingId !== undefined && !isPathSafeId(value.crmBuildingId))
    || (value.crmSalesProspectId !== undefined && !isPathSafeId(value.crmSalesProspectId))
    || (value.assignedOperatorId !== null && !isPathSafeId(value.assignedOperatorId))
    || !isDate(value.dueDate)
    || typeof value.priority !== "string"
    || !(FIELD_PRIORITIES as readonly string[]).includes(value.priority)
    || value.accessPreparationStatus !== "unknown"
      && value.accessPreparationStatus !== "ready"
      && value.accessPreparationStatus !== "blocked"
    || !isPathSafeId(value.createdByAuthUid)
    || !isPathSafeId(value.createdByOperatorId)
    || !isPathSafeId(value.updatedByAuthUid)
    || !isPathSafeId(value.updatedByOperatorId)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || (value.archivedAt !== null && !isTimestamp(value.archivedAt))
  ) fail("field_visit_state_invalid");
}

function assertTeamActiveProjection(value: unknown): asserts value is FieldTeamActiveProjection {
  const priorityRank: Readonly<Record<FieldPriority, number>> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  if (
    !isRecord(value)
    || !isPathSafeId(value.fieldJobId)
    || !isPathSafeId(value.visitId)
    || typeof value.jobType !== "string"
    || !(FIELD_JOB_TYPES as readonly string[]).includes(value.jobType)
    || typeof value.parentName !== "string"
    || value.parentName.length === 0
    || Buffer.byteLength(value.parentName, "utf8") > MAX_CRM_NAME_BYTES
    || typeof value.address !== "string"
    || value.address.length === 0
    || Buffer.byteLength(value.address, "utf8") > MAX_CRM_ADDRESS_BYTES
    || (value.unitLabel !== null && (
      typeof value.unitLabel !== "string"
      || value.unitLabel.length === 0
      || Buffer.byteLength(value.unitLabel, "utf8") > MAX_CRM_UNIT_LABEL_BYTES
    ))
    || (value.assignedOperatorId !== null && !isPathSafeId(value.assignedOperatorId))
    || !isDate(value.dueDate)
    || typeof value.priority !== "string"
    || !(FIELD_PRIORITIES as readonly string[]).includes(value.priority)
    || typeof value.workflowStatus !== "string"
    || !(FIELD_WORKFLOW_STATUSES as readonly string[]).includes(value.workflowStatus)
    || value.workflowStatus === "completed"
    || value.workflowStatus === "cancelled"
    || typeof value.uploadStatus !== "string"
    || !(FIELD_UPLOAD_STATUSES as readonly string[]).includes(value.uploadStatus)
    || typeof value.mediaCount !== "number"
    || !Number.isSafeInteger(value.mediaCount)
    || value.mediaCount < 0
    || typeof value.uploadFailureCount !== "number"
    || !Number.isSafeInteger(value.uploadFailureCount)
    || value.uploadFailureCount < 0
    || typeof value.adminActionRequired !== "boolean"
    || typeof value.activeOrderKey !== "string"
    || !isTimestamp(value.updatedAt)
    || value.activeOrderKey !== [
      value.dueDate,
      priorityRank[value.priority as FieldPriority],
      value.updatedAt,
      value.fieldJobId,
    ].join("|")
  ) fail("field_workspace_invalid");
}

function storedFieldKpis(value: unknown): FieldKpis {
  if (!isRecord(value)) fail("field_workspace_invalid");
  for (const key of [
    "todayVisits",
    "capturePending",
    "uploadFailures",
    "reviewPending",
    "unassigned",
    "overdue",
    "adminActionRequired",
  ]) {
    if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) {
      fail("field_workspace_invalid");
    }
  }
  return Object.freeze({
    todayVisits: value.todayVisits as number,
    capturePending: value.capturePending as number,
    uploadFailures: value.uploadFailures as number,
    reviewPending: value.reviewPending as number,
    unassigned: value.unassigned as number,
    overdue: value.overdue as number,
    adminActionRequired: value.adminActionRequired as number,
  });
}

function assertTransactionBundle(
  snapshot: FieldWorkTransactionSnapshot,
  expected: { jobId?: string; visitId?: string },
): { item: FieldWorkItem; visit: FieldVisit; visitItems: FieldWorkItem[] } {
  if (snapshot.workItem === null || snapshot.workItem === undefined) {
    fail("field_job_not_found");
  }
  assertStoredWorkItem(snapshot.workItem, expected.jobId);
  if (snapshot.visit === null || snapshot.visit === undefined) {
    fail("field_visit_not_found");
  }
  assertStoredVisit(snapshot.visit, expected.visitId ?? snapshot.workItem.visitId);
  if (snapshot.workItem.visitId !== snapshot.visit.id) fail("field_visit_relation_invalid");
  if (!Array.isArray(snapshot.visitWorkItems)) fail("field_visit_state_invalid");
  const visitItems = snapshot.visitWorkItems.map((item) => {
    assertStoredWorkItem(item);
    if (item.visitId !== snapshot.visit!.id) fail("field_visit_relation_invalid");
    return item;
  });
  const ids = visitItems.map((item) => item.id).sort();
  if (
    new Set(ids).size !== ids.length
    || JSON.stringify(ids) !== JSON.stringify([...snapshot.visit.workItemIds].sort())
  ) fail("field_visit_relation_invalid");
  if (visitItems.some((item) => item.assignedOperatorId !== snapshot.visit!.assignedOperatorId)) {
    fail("field_visit_relation_invalid");
  }
  if (visitItems.some((item) =>
    item.dueDate !== snapshot.visit!.dueDate
    || item.priority !== snapshot.visit!.priority
    || item.crmBuildingId !== snapshot.visit!.crmBuildingId
    || item.crmSalesProspectId !== snapshot.visit!.crmSalesProspectId)) {
    fail("field_visit_relation_invalid");
  }
  return { item: snapshot.workItem, visit: snapshot.visit, visitItems };
}

function replayResult<Result>(
  snapshot: FieldWorkTransactionSnapshot,
  requestHash: string,
  guard: (value: unknown) => Result,
): FieldWorkTransactionDecision<Result> | null {
  const stored = snapshot.receipt;
  if (!stored) return null;
  if (stored.requestHash !== requestHash) return { errorCode: "field_request_id_conflict" };
  try {
    return { replay: true, result: guard(stored.result) };
  } catch {
    return { errorCode: "field_request_receipt_invalid" };
  }
}

function itemResult(value: unknown): FieldWorkItem {
  assertStoredWorkItem(value);
  return frozenItem(value);
}

function changeResult(value: unknown): ChangeFieldVisitResult {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, FIELD_CHANGE_RESULT_KEYS)
    || !isPathSafeId(value.visitId)
    || (value.newVisitId !== undefined && !isPathSafeId(value.newVisitId))
    || value.newVisitId === value.visitId
    || !Array.isArray(value.updatedJobIds)
    || value.updatedJobIds.length === 0
    || value.updatedJobIds.length > MAX_UNIT_COUNT
    || value.updatedJobIds.some((id) => !isPathSafeId(id))
    || new Set(value.updatedJobIds).size !== value.updatedJobIds.length
    || !Array.isArray(value.workItems)
    || value.workItems.length !== value.updatedJobIds.length
  ) {
    fail("field_request_receipt_invalid");
  }
  const workItems = value.workItems.map((item) => itemResult(item));
  const updatedIds = [...value.updatedJobIds].sort() as string[];
  if (
    JSON.stringify(updatedIds) !== JSON.stringify(workItems.map((item) => item.id).sort())
    || workItems.some((item) => item.visitId !== (value.newVisitId ?? value.visitId))
  ) fail("field_request_receipt_invalid");
  return Object.freeze({
    visitId: value.visitId,
    ...(value.newVisitId === undefined ? {} : { newVisitId: value.newVisitId }),
    updatedJobIds: Object.freeze(updatedIds),
    workItems: Object.freeze(workItems),
  });
}

function creationReceiptResult(value: unknown): Omit<CreateFieldJobsResult, "repeated"> {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, FIELD_CREATION_RESULT_KEYS)
    || !isPathSafeId(value.visitId)
    || !Array.isArray(value.jobIds)
    || value.jobIds.length === 0
    || value.jobIds.some((id) => !isPathSafeId(id))
    || new Set(value.jobIds).size !== value.jobIds.length
  ) fail("field_request_receipt_invalid");
  return Object.freeze({
    visitId: value.visitId,
    jobIds: Object.freeze([...value.jobIds] as string[]),
  });
}

export function parseFieldMutationReceipt(
  value: unknown,
  expectedScope?: string,
  expectedRequestId?: string,
): FieldMutationReceipt {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, FIELD_RECEIPT_KEYS)
    || typeof value.scope !== "string"
    || ![
      "createFieldJobs",
      "claimFieldJob",
      "assignFieldJob",
      "changeFieldVisit",
      "transitionFieldJob",
    ].includes(value.scope)
    || (expectedScope !== undefined && value.scope !== expectedScope)
    || !isFieldRequestId(value.requestId)
    || (expectedRequestId !== undefined && value.requestId !== expectedRequestId)
    || typeof value.requestHash !== "string"
    || !HASH_PATTERN.test(value.requestHash)
    || !isTimestamp(value.createdAt)
  ) fail("field_request_receipt_invalid");
  let result: unknown;
  try {
    result = value.scope === "createFieldJobs"
      ? creationReceiptResult(value.result)
      : value.scope === "changeFieldVisit"
        ? changeResult(value.result)
        : itemResult(value.result);
  } catch {
    fail("field_request_receipt_invalid");
  }
  return Object.freeze({
    scope: value.scope,
    requestId: value.requestId,
    requestHash: value.requestHash,
    result,
    createdAt: value.createdAt,
  });
}

function mutationBase(input: unknown, actor: FieldV2Actor): {
  requestId: string;
  operatorId: string;
  jobId?: string;
  visitId?: string;
} {
  if (!isRecord(input)) fail("field_work_input_invalid");
  assertActor(input.operatorId, actor);
  return {
    requestId: assertRequestId(input.requestId),
    operatorId: actor.operatorId,
    ...(input.jobId === undefined ? {} : { jobId: requiredId(input.jobId) }),
    ...(input.visitId === undefined ? {} : { visitId: requiredId(input.visitId) }),
  };
}

function withMutationReceipt<Result>(
  patch: Record<string, unknown>,
  scope: string,
  requestId: string,
  requestHash: string,
  result: Result,
  now: string,
): FieldWorkTransactionDecision<Result> {
  patch[`fieldPlatform/v2/requestReceipts/${scope}/${requestId}`] = receipt(
    scope,
    requestId,
    requestHash,
    result,
    now,
  );
  return { patch: Object.freeze({ ...patch }), result };
}

function updatedWorkItem(
  item: FieldWorkItem,
  actor: FieldV2Actor,
  now: string,
  changes: Partial<FieldWorkItem>,
): FieldWorkItem {
  return frozenItem({ ...item, ...changes, ...updatedStamp(actor, now) });
}

function resetAcceptance(item: FieldWorkItem): FieldWorkItem {
  if (item.workflowStatus !== "accepted") return item;
  const { acceptedAt: _acceptedAt, ...reset } = item;
  return reset as FieldWorkItem;
}

function splitVisit(
  visit: FieldVisit,
  selectedItems: readonly FieldWorkItem[],
  requestId: string,
  actor: FieldV2Actor,
  now: string,
  changes: {
    assignedOperatorId?: string | null;
    dueDate?: string;
    priority?: FieldPriority;
  },
): { oldVisit: FieldVisit; newVisit: FieldVisit } {
  const selectedIds = new Set(selectedItems.map((item) => item.id));
  const remainingIds = visit.workItemIds.filter((id) => !selectedIds.has(id));
  if (remainingIds.length === 0) fail("field_visit_split_invalid");
  const newVisitId = stableId("visit", requestId, `split:${selectedItems.map((item) => item.id).sort().join(",")}`);
  const newVisit = frozenVisit({
    ...visit,
    id: newVisitId,
    workItemIds: selectedItems.map((item) => item.id).sort(),
    sharedMediaIds: [],
    assignedOperatorId: Object.hasOwn(changes, "assignedOperatorId")
      ? changes.assignedOperatorId!
      : visit.assignedOperatorId,
    dueDate: changes.dueDate ?? visit.dueDate,
    priority: changes.priority ?? visit.priority,
    ...auditStamp(actor, now),
  });
  const oldVisit = frozenVisit({
    ...visit,
    workItemIds: remainingIds,
    ...updatedStamp(actor, now),
  });
  return { oldVisit, newVisit };
}

export async function claimFieldJobCore(
  input: ClaimFieldJobInput,
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<FieldWorkItem> {
  const normalized = mutationBase(input, actor);
  const jobId = normalized.jobId ?? fail("field_work_input_invalid");
  const requestHash = sha256({ ...normalized, action: "claim" });
  const now = currentTimestamp(dependencies);
  return dependencies.transactWork({
    scope: "claimFieldJob",
    requestId: normalized.requestId,
    requestHash,
    jobId,
    requiredActiveOperatorIds: [actor.operatorId],
  }, (snapshot) => {
    const replay = replayResult(snapshot, requestHash, itemResult);
    if (replay) return replay;
    const { item, visit, visitItems } = assertTransactionBundle(snapshot, { jobId });
    if (item.archivedAt !== null || item.workflowStatus === "completed" || item.workflowStatus === "cancelled") {
      return { errorCode: "field_job_inactive" };
    }
    if (item.assignedOperatorId !== null || item.workflowStatus !== "requested") {
      return { errorCode: "field_job_already_claimed" };
    }
    const patch: Record<string, unknown> = {};
    let nextVisitId = visit.id;
    if (visitItems.length > 1) {
      const split = splitVisit(visit, [item], normalized.requestId, actor, now, {
        assignedOperatorId: actor.operatorId,
      });
      nextVisitId = split.newVisit.id;
      patch[`fieldPlatform/v2/visits/${visit.id}`] = split.oldVisit;
      patch[`fieldPlatform/v2/visits/${split.newVisit.id}`] = split.newVisit;
    } else {
      patch[`fieldPlatform/v2/visits/${visit.id}`] = frozenVisit({
        ...visit,
        assignedOperatorId: actor.operatorId,
        ...updatedStamp(actor, now),
      });
    }
    const result = updatedWorkItem(item, actor, now, {
      visitId: nextVisitId,
      assignedOperatorId: actor.operatorId,
      workflowStatus: "assigned",
    });
    patch[`fieldPlatform/v2/workItems/${jobId}`] = result;
    Object.assign(patch, projectionPatch(result, item));
    const audit = operationAudit("field.workItem.claimed", "workItem", jobId, normalized.requestId, actor, now);
    patch[`fieldPlatform/v2/auditLogs/${audit.id}`] = audit;
    return withMutationReceipt(patch, "claimFieldJob", normalized.requestId, requestHash, result, now);
  });
}

function targetedAssignmentDecision(
  snapshot: FieldWorkTransactionSnapshot,
  input: { requestId: string; requestHash: string; jobId: string; target: string | null; reason: string },
  actor: FieldV2Actor,
  now: string,
): FieldWorkTransactionDecision<FieldWorkItem> {
  const replay = replayResult(snapshot, input.requestHash, itemResult);
  if (replay) return replay;
  const { item, visit, visitItems } = assertTransactionBundle(snapshot, { jobId: input.jobId });
  if (item.archivedAt !== null || item.workflowStatus === "completed" || item.workflowStatus === "cancelled") {
    return { errorCode: "field_job_inactive" };
  }
  if (item.assignedOperatorId === input.target) return { errorCode: "field_assignment_unchanged" };
  if (!NOT_STARTED_STATUSES.has(item.workflowStatus)) {
    return { errorCode: "field_started_job_change_forbidden" };
  }
  const patch: Record<string, unknown> = {};
  let nextVisitId = visit.id;
  if (visitItems.length > 1) {
    const split = splitVisit(visit, [item], input.requestId, actor, now, {
      assignedOperatorId: input.target,
    });
    nextVisitId = split.newVisit.id;
    patch[`fieldPlatform/v2/visits/${visit.id}`] = split.oldVisit;
    patch[`fieldPlatform/v2/visits/${split.newVisit.id}`] = split.newVisit;
  } else {
    patch[`fieldPlatform/v2/visits/${visit.id}`] = frozenVisit({
      ...visit,
      assignedOperatorId: input.target,
      ...updatedStamp(actor, now),
    });
  }
  const workflowStatus: FieldWorkflowStatus = input.target === null
    ? "requested"
    : "assigned";
  const result = updatedWorkItem(resetAcceptance(item), actor, now, {
    visitId: nextVisitId,
    assignedOperatorId: input.target,
    workflowStatus,
  });
  patch[`fieldPlatform/v2/workItems/${item.id}`] = result;
  Object.assign(patch, projectionPatch(result, item));
  const audit = operationAudit("field.workItem.assigned", "workItem", item.id, input.requestId, actor, now, input.reason);
  patch[`fieldPlatform/v2/auditLogs/${audit.id}`] = audit;
  return withMutationReceipt(patch, "assignFieldJob", input.requestId, input.requestHash, result, now);
}

export async function assignFieldJobCore(
  input: AssignFieldJobInput,
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<FieldWorkItem> {
  const normalized = mutationBase(input, actor);
  const jobId = normalized.jobId ?? fail("field_work_input_invalid");
  const target = input.assignedOperatorId === null
    ? null
    : requiredId(input.assignedOperatorId, "field_assignee_invalid");
  const reason = requiredReason(input.reason);
  const requestHash = sha256({ ...normalized, target, reason, action: "assign" });
  const now = currentTimestamp(dependencies);
  return dependencies.transactWork({
    scope: "assignFieldJob",
    requestId: normalized.requestId,
    requestHash,
    jobId,
    requiredActiveOperatorIds: Object.freeze([
      actor.operatorId,
      ...(target === null ? [] : [target]),
    ].filter((value, index, values) => values.indexOf(value) === index).sort()),
  }, (snapshot) => targetedAssignmentDecision(
    snapshot,
    { requestId: normalized.requestId, requestHash, jobId, target, reason },
    actor,
    now,
  ));
}

export async function changeFieldVisitCore(
  input: ChangeFieldVisitInput,
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<ChangeFieldVisitResult> {
  const normalized = mutationBase(input, actor);
  const visitId = normalized.visitId ?? fail("field_work_input_invalid");
  const selectedJobId = input.jobId === undefined ? undefined : requiredId(input.jobId);
  const hasAssignee = Object.hasOwn(input, "assignedOperatorId");
  const assignedOperatorId = !hasAssignee
    ? undefined
    : input.assignedOperatorId === null
      ? null
      : requiredId(input.assignedOperatorId, "field_assignee_invalid");
  const dueDate = input.dueDate === undefined ? undefined : requiredDate(input.dueDate);
  const nextPriority = input.priority === undefined ? undefined : priority(input.priority);
  if (assignedOperatorId === undefined && dueDate === undefined && nextPriority === undefined) {
    fail("field_visit_change_empty");
  }
  const reason = requiredReason(input.reason);
  const requestHash = sha256({
    ...normalized,
    selectedJobId,
    hasAssignee,
    assignedOperatorId,
    dueDate,
    priority: nextPriority,
    reason,
    action: "changeVisit",
  });
  const now = currentTimestamp(dependencies);
  return dependencies.transactWork({
    scope: "changeFieldVisit",
    requestId: normalized.requestId,
    requestHash,
    visitId,
    ...(selectedJobId === undefined ? {} : { jobId: selectedJobId }),
    requiredActiveOperatorIds: Object.freeze([
      actor.operatorId,
      ...(assignedOperatorId === undefined || assignedOperatorId === null
        ? []
        : [assignedOperatorId]),
    ].filter((value, index, values) => values.indexOf(value) === index).sort()),
  }, (snapshot) => {
    const replay = replayResult(snapshot, requestHash, changeResult);
    if (replay) return replay;
    const { visit, visitItems } = assertTransactionBundle(snapshot, {
      visitId,
      ...(selectedJobId === undefined ? {} : { jobId: selectedJobId }),
    });
    let selected = selectedJobId === undefined
      ? visitItems.filter((item) => NOT_STARTED_STATUSES.has(item.workflowStatus))
      : visitItems.filter((item) => item.id === selectedJobId);
    if (selected.length === 0) return { errorCode: "field_started_job_change_forbidden" };
    if (selected.some((item) => item.archivedAt !== null || item.workflowStatus === "completed" || item.workflowStatus === "cancelled")) {
      return { errorCode: "field_job_inactive" };
    }
    const assigneeChanged = hasAssignee
      && selected.some((item) => item.assignedOperatorId !== assignedOperatorId);
    if (selectedJobId !== undefined && visitItems.length > 1
      && selected.some((item) => !NOT_STARTED_STATUSES.has(item.workflowStatus))) {
      return { errorCode: "field_started_job_change_forbidden" };
    }
    if (assigneeChanged && selected.some((item) => !NOT_STARTED_STATUSES.has(item.workflowStatus))) {
      return { errorCode: "field_started_job_change_forbidden" };
    }
    selected = [...selected].sort((left, right) => left.id.localeCompare(right.id));
    const mustSplit = selected.length !== visitItems.length;
    const patch: Record<string, unknown> = {};
    let targetVisit = visit;
    if (mustSplit) {
      const split = splitVisit(visit, selected, normalized.requestId, actor, now, {
        ...(hasAssignee ? { assignedOperatorId } : {}),
        ...(dueDate === undefined ? {} : { dueDate }),
        ...(nextPriority === undefined ? {} : { priority: nextPriority }),
      });
      patch[`fieldPlatform/v2/visits/${visit.id}`] = split.oldVisit;
      patch[`fieldPlatform/v2/visits/${split.newVisit.id}`] = split.newVisit;
      targetVisit = split.newVisit;
    } else {
      targetVisit = frozenVisit({
        ...visit,
        ...(hasAssignee ? { assignedOperatorId: assignedOperatorId! } : {}),
        ...(dueDate === undefined ? {} : { dueDate }),
        ...(nextPriority === undefined ? {} : { priority: nextPriority }),
        ...updatedStamp(actor, now),
      });
      patch[`fieldPlatform/v2/visits/${visit.id}`] = targetVisit;
    }
    const changedItems = selected.map((item) => {
      const status: FieldWorkflowStatus = assigneeChanged
        ? assignedOperatorId === null
          ? "requested"
          : "assigned"
        : item.workflowStatus;
      const changed = updatedWorkItem(assigneeChanged ? resetAcceptance(item) : item, actor, now, {
        visitId: targetVisit.id,
        ...(hasAssignee ? { assignedOperatorId: assignedOperatorId! } : {}),
        ...(dueDate === undefined ? {} : { dueDate }),
        ...(nextPriority === undefined ? {} : { priority: nextPriority }),
        workflowStatus: status,
      });
      patch[`fieldPlatform/v2/workItems/${item.id}`] = changed;
      Object.assign(patch, projectionPatch(changed, item));
      return changed;
    });
    const result: ChangeFieldVisitResult = Object.freeze({
      visitId,
      ...(targetVisit.id === visitId ? {} : { newVisitId: targetVisit.id }),
      updatedJobIds: Object.freeze(changedItems.map((item) => item.id)),
      workItems: Object.freeze(changedItems),
    });
    const audit = operationAudit("field.visit.changed", "visit", visitId, normalized.requestId, actor, now, reason);
    patch[`fieldPlatform/v2/auditLogs/${audit.id}`] = audit;
    return withMutationReceipt(patch, "changeFieldVisit", normalized.requestId, requestHash, result, now);
  });
}

export async function transitionFieldJobCore(
  input: TransitionFieldJobInput,
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<FieldWorkItem> {
  const normalized = mutationBase(input, actor);
  const jobId = normalized.jobId ?? fail("field_work_input_invalid");
  if (input.toStatus === "approved" || input.toStatus === "changes_requested") {
    fail("field_review_action_required");
  }
  if (input.toStatus === "assigned") fail("field_assignment_action_required");
  const reason = input.toStatus === "cancelled"
    ? requiredReason(input.reason)
    : input.reason === undefined
      ? undefined
      : requiredReason(input.reason);
  const requestHash = sha256({
    ...normalized,
    toStatus: input.toStatus,
    reason,
    inspectionOutcome: input.inspectionOutcome,
    action: "transition",
  });
  const now = currentTimestamp(dependencies);
  return dependencies.transactWork({
    scope: "transitionFieldJob",
    requestId: normalized.requestId,
    requestHash,
    jobId,
    requiredActiveOperatorIds: [actor.operatorId],
  }, (snapshot) => {
    const replay = replayResult(snapshot, requestHash, itemResult);
    if (replay) return replay;
    const { item } = assertTransactionBundle(snapshot, { jobId });
    if (item.archivedAt !== null) return { errorCode: "field_job_inactive" };
    if (item.assignedOperatorId === null) return { errorCode: "field_assignment_required" };
    if (actor.role !== "admin" && item.assignedOperatorId !== actor.operatorId) {
      return { errorCode: "field_job_operator_forbidden" };
    }
    let nextStatus: FieldWorkflowStatus;
    try {
      nextStatus = transitionFieldStatus(item.jobType, item.workflowStatus, input.toStatus, {
        ...(input.inspectionOutcome === undefined ? {} : { inspectionOutcome: input.inspectionOutcome }),
      });
    } catch (error) {
      if (error instanceof FieldV2Error) return { errorCode: error.code };
      return { errorCode: "field_transition_invalid" };
    }
    const lifecycle: {
      acceptedAt?: string;
      startedAt?: string;
      evidenceReadyAt?: string;
      reviewPendingAt?: string;
      completedAt?: string;
      cancelledAt?: string;
      cancelReason?: string;
    } = {};
    if (nextStatus === "accepted" && item.acceptedAt === undefined) lifecycle.acceptedAt = now;
    if (nextStatus === "in_progress" && item.startedAt === undefined) lifecycle.startedAt = now;
    if (nextStatus === "evidence_ready" && item.evidenceReadyAt === undefined) lifecycle.evidenceReadyAt = now;
    if (nextStatus === "review_pending" && item.reviewPendingAt === undefined) lifecycle.reviewPendingAt = now;
    if (nextStatus === "completed" && item.completedAt === undefined) lifecycle.completedAt = now;
    if (nextStatus === "cancelled" && item.cancelledAt === undefined) {
      lifecycle.cancelledAt = now;
      lifecycle.cancelReason = reason;
    }
    const result = updatedWorkItem(item, actor, now, {
      workflowStatus: nextStatus,
      ...lifecycle,
    });
    const patch: Record<string, unknown> = {
      [`fieldPlatform/v2/workItems/${jobId}`]: result,
      ...projectionPatch(result, item),
    };
    const audit = operationAudit(`field.workItem.${nextStatus}`, "workItem", jobId, normalized.requestId, actor, now, reason);
    patch[`fieldPlatform/v2/auditLogs/${audit.id}`] = audit;
    return withMutationReceipt(patch, "transitionFieldJob", normalized.requestId, requestHash, result, now);
  });
}

export async function listFieldOperationsWorkspaceCore(
  input: ListFieldOperationsWorkspaceInput,
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<FieldOperationsWorkspace> {
  if (
    !isRecord(input)
    || !isRecord(actor)
    || !isPathSafeId(actor.authUid)
    || !isPathSafeId(actor.operatorId)
  ) {
    fail("field_access_forbidden");
  }
  assertActor(input.operatorId, actor);
  const scope = input.scope === undefined ? "personal" : input.scope;
  if (scope !== "personal" && scope !== "team") fail("field_workspace_scope_invalid");
  if (scope === "team" && actor.role !== "admin") fail("field_workspace_scope_forbidden");
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail("field_workspace_limit_invalid");
  }
  const cursor = input.cursor === undefined
    ? undefined
    : requiredText(input.cursor, "field_workspace_cursor_invalid", 512);
  let records: FieldWorkspaceRecords;
  try {
    records = await dependencies.readWorkspace(actor, {
      scope,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
  } catch (error) {
    if (error instanceof FieldV2Error && error.code === "field_workspace_cursor_invalid") {
      throw error;
    }
    fail("field_workspace_unavailable");
  }
  if (!isRecord(records) || !Array.isArray(records.items)) {
    fail("field_workspace_invalid");
  }
  if (records.items.length > limit) fail("field_workspace_invalid");
  const nextCursor = records.nextCursor === undefined
    ? null
    : requiredText(records.nextCursor, "field_workspace_invalid", 512);
  const items = records.items.map((item) => {
    if (scope === "team") {
      assertTeamActiveProjection(item);
      return Object.freeze({ ...item });
    }
    assertStoredWorkItem(item);
    return frozenItem(item);
  });
  const now = new Date(currentTimestamp(dependencies));
  if (scope === "team" && records.kpiSeoulDate !== seoulDateFromTimestamp(now)) {
    fail("field_kpi_stale");
  }
  const teamKpis = scope === "team" ? storedFieldKpis(records.kpis) : undefined;
  return Object.freeze({
    items: Object.freeze(items),
    kpis: teamKpis
      ? teamKpis
      : calculateFieldKpis(items as readonly FieldWorkItem[], now),
    scope,
    nextCursor,
  });
}

export type {
  CrmFieldSummary,
  FieldOperatorJobProjection,
  FieldUnassignedProjection,
};

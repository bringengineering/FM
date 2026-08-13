import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { assertFieldActorCanMutate } from "./access.js";
import {
  FIELD_JOB_TYPES,
  FieldV2Error,
  isFieldRequestId,
  type FieldJobType,
  type FieldUploadStatus,
  type FieldV2Actor,
  type FieldWorkflowStatus,
} from "./contracts.js";
import { fieldJobPolicies, transitionFieldStatus } from "./policies.js";
import {
  buildCrmFieldSummary,
  buildOperatorProjection,
  buildUnassignedProjection,
  calculateFieldKpis,
  type CrmFieldSummary,
  type FieldKpis,
  type FieldOperatorJobProjection,
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
  readonly newMutationBlockedCode?:
    | "field_safe_mode_read_only"
    | "field_v2_writes_disabled";
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface FieldCrmSourceExpectation {
  readonly path: string;
  readonly id: string;
  readonly updatedAt: string;
  readonly parentField?: "crmBuildingId" | "crmSalesProspectId" | "prospectId";
  readonly parentId?: string;
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
  readonly completedAt: string;
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
  readonly newMutationBlockedCode?:
    | "field_safe_mode_read_only"
    | "field_v2_writes_disabled";
}

export interface FieldWorkspaceRecords {
  readonly items: readonly FieldWorkItem[];
}

export interface FieldOperationsWorkspace {
  readonly items: readonly FieldWorkItem[];
  readonly kpis: FieldKpis;
}

export interface WorkItemDependencies {
  now(): string;
  readCrmBuilding(id: string): Promise<unknown>;
  readCrmSalesProspect(id: string): Promise<unknown>;
  readCrmBuildingUnit(id: string): Promise<unknown>;
  readCrmSalesUnit(id: string): Promise<unknown>;
  readOperator(id: string): Promise<unknown>;
  commitCreation(command: FieldAtomicCreateCommand): Promise<FieldAtomicCreateOutcome>;
  transactWork<Result>(
    selector: FieldWorkTransactionSelector,
    decide: (snapshot: FieldWorkTransactionSnapshot) => FieldWorkTransactionDecision<Result>,
  ): Promise<Result>;
  readWorkspace(actor: FieldV2Actor): Promise<FieldWorkspaceRecords>;
}

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[^.#$\[\]/\u0000-\u001f\u007f]+$/u;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_REASON_BYTES = 2_000;
const MAX_UNIT_COUNT = 200;
const NOT_STARTED_STATUSES = new Set<FieldWorkflowStatus>([
  "requested",
  "assigned",
  "accepted",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw new FieldV2Error(code);
}

function isPathSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 128
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
  assertFieldActorCanMutate(actor);
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
    || typeof value.name !== "string"
    || value.name.trim().length === 0
    || value.name !== value.name.trim()
    || typeof value.address !== "string"
    || value.address.trim().length === 0
    || value.address !== value.address.trim()
    || !isTimestamp(value.updatedAt)
  ) fail("field_crm_reference_invalid");
  if (value.archivedAt !== undefined && value.archivedAt !== null && value.archivedAt !== "") {
    if (!isTimestamp(value.archivedAt)) fail("field_crm_reference_invalid");
    fail("field_crm_reference_archived");
  }
  return {
    id: expectedId,
    name: value.name,
    address: value.address,
    updatedAt: value.updatedAt,
    archivedAt: null,
    ...(parentType === "building" ? {} : {}),
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
    || typeof value.label !== "string"
    || value.label.trim().length === 0
    || value.label !== value.label.trim()
    || !isTimestamp(value.updatedAt)
  ) {
    if (isRecord(value) && value.id === expectedId && value.crmBuildingId !== parentId) {
      fail("field_crm_reference_mismatch");
    }
    fail("field_crm_reference_invalid");
  }
  if (value.archivedAt !== undefined && value.archivedAt !== null && value.archivedAt !== "") {
    if (!isTimestamp(value.archivedAt)) fail("field_crm_reference_invalid");
    fail("field_crm_reference_archived");
  }
  return {
    id: expectedId,
    crmBuildingId: parentId,
    label: value.label,
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
    typeof value.label !== "string"
    || value.label.trim().length === 0
    || value.label !== value.label.trim()
    || !isTimestamp(value.updatedAt)
  ) fail("field_crm_reference_invalid");
  if (value.archivedAt !== undefined && value.archivedAt !== null && value.archivedAt !== "") {
    if (!isTimestamp(value.archivedAt)) fail("field_crm_reference_invalid");
    fail("field_crm_reference_archived");
  }
  return {
    id: expectedId,
    ...(typeof value.crmBuildingId === "string" ? { crmBuildingId: value.crmBuildingId } : {}),
    ...(typeof value.crmSalesProspectId === "string" ? { crmSalesProspectId: value.crmSalesProspectId } : {}),
    ...(typeof value.crmBuildingUnitId === "string" ? { crmBuildingUnitId: value.crmBuildingUnitId } : {}),
    label: value.label,
    deposit: optionalMoney(value.deposit),
    rent: optionalMoney(value.rent),
    maintenanceFee: optionalMoney(value.maintenanceFee),
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
  return Object.freeze({ scope, requestId, requestHash, result, completedAt: now });
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
  if (input.crmWorkflowCaseId !== undefined || input.crmTaskId !== undefined) {
    fail("field_crm_reference_adapter_unavailable");
  }
  return {
    requestId,
    operatorId: actor.operatorId,
    jobType: jobType(input.jobType),
    parentType: buildingId ? "building" : "salesProspect",
    parentId: buildingId ?? prospectId!,
    ...(buildingUnitIds === undefined ? {} : { crmBuildingUnitIds: buildingUnitIds }),
    ...(salesUnitIds === undefined ? {} : { crmSalesUnitIds: salesUnitIds }),
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
  await assertActiveOperator(normalized.assignedOperatorId, dependencies);
  const { parent, units } = await resolveCreateSources(normalized, dependencies);
  const now = currentTimestamp(dependencies);
  const requestHash = sha256(normalized);
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
  if (
    !isRecord(value)
    || !isPathSafeId(value.id)
    || (expectedId !== undefined && value.id !== expectedId)
    || !isPathSafeId(value.visitId)
    || !isPathSafeId(value.createdByAuthUid)
    || !isPathSafeId(value.createdByOperatorId)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || (value.archivedAt !== null && !isTimestamp(value.archivedAt))
    || !HASH_PATTERN.test(String(value.sourceHash))
  ) fail("field_work_item_state_invalid");
}

function assertStoredVisit(value: unknown, expectedId?: string): asserts value is FieldVisit {
  if (
    !isRecord(value)
    || !isPathSafeId(value.id)
    || (expectedId !== undefined && value.id !== expectedId)
    || !Array.isArray(value.workItemIds)
    || value.workItemIds.length === 0
    || value.workItemIds.some((id) => !isPathSafeId(id))
    || new Set(value.workItemIds).size !== value.workItemIds.length
    || !Array.isArray(value.sharedMediaIds)
    || value.sharedMediaIds.some((id) => !isPathSafeId(id))
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || (value.archivedAt !== null && !isTimestamp(value.archivedAt))
  ) fail("field_visit_state_invalid");
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
  if (!isRecord(value) || !isPathSafeId(value.visitId) || !Array.isArray(value.updatedJobIds) || !Array.isArray(value.workItems)) {
    fail("field_request_receipt_invalid");
  }
  const workItems = value.workItems.map((item) => itemResult(item));
  return Object.freeze({
    visitId: value.visitId,
    ...(isPathSafeId(value.newVisitId) ? { newVisitId: value.newVisitId } : {}),
    updatedJobIds: Object.freeze(value.updatedJobIds.map((id) => requiredId(id))),
    workItems: Object.freeze(workItems),
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
    assignedOperatorId: changes.assignedOperatorId ?? visit.assignedOperatorId,
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
  if (visitItems.length > 1 && !NOT_STARTED_STATUSES.has(item.workflowStatus)) {
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
  const workflowStatus: FieldWorkflowStatus = item.workflowStatus === "requested" && input.target !== null
    ? "assigned"
    : item.workflowStatus === "assigned" && input.target === null
      ? "requested"
      : item.workflowStatus;
  const result = updatedWorkItem(item, actor, now, {
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
  await assertActiveOperator(target, dependencies);
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
  if (assignedOperatorId !== undefined) await assertActiveOperator(assignedOperatorId, dependencies);
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
    if (selectedJobId !== undefined && visitItems.length > 1
      && selected.some((item) => !NOT_STARTED_STATUSES.has(item.workflowStatus))) {
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
      const status = item.workflowStatus === "requested" && assignedOperatorId
        ? "assigned"
        : item.workflowStatus === "assigned" && hasAssignee && assignedOperatorId === null
          ? "requested"
          : item.workflowStatus;
      const changed = updatedWorkItem(item, actor, now, {
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
  actor: FieldV2Actor,
  dependencies: WorkItemDependencies,
): Promise<FieldOperationsWorkspace> {
  if (!isRecord(actor) || !isPathSafeId(actor.authUid) || !isPathSafeId(actor.operatorId)) {
    fail("field_access_forbidden");
  }
  let records: FieldWorkspaceRecords;
  try {
    records = await dependencies.readWorkspace(actor);
  } catch {
    fail("field_workspace_unavailable");
  }
  if (!isRecord(records) || !Array.isArray(records.items)) {
    fail("field_workspace_invalid");
  }
  const items = records.items.map((item) => {
    assertStoredWorkItem(item);
    return frozenItem(item);
  });
  const now = new Date(currentTimestamp(dependencies));
  return Object.freeze({
    items: Object.freeze(items),
    kpis: calculateFieldKpis(items, now),
  });
}

export type {
  CrmFieldSummary,
  FieldOperatorJobProjection,
  FieldUnassignedProjection,
};

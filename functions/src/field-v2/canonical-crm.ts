import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  FIELD_PROTOCOL_VERSION,
  FieldV2Error,
  isFieldRequestId,
  type FieldReleaseClient,
  type FieldReleaseConfiguration,
  type FieldV2Actor,
} from "./contracts.js";
import { assertFieldReleaseCompatible } from "./release-gate.js";

export const CANONICAL_CRM_RECEIPT_SCOPE = "commitCanonicalCrmEntity" as const;
export const CANONICAL_BUILDING_UNITS_BATCH_RECEIPT_SCOPE = "commitCanonicalBuildingUnitsBatch" as const;
export const CANONICAL_CRM_ENTITY_TYPES = [
  "buildings",
  "buildingUnits",
  "salesUnits",
] as const;
export const CANONICAL_CRM_OPERATIONS = [
  "create",
  "update",
  "archive",
  "restore",
] as const;

export type CanonicalCrmEntityType = typeof CANONICAL_CRM_ENTITY_TYPES[number];
export type CanonicalCrmOperation = typeof CANONICAL_CRM_OPERATIONS[number];

export interface CanonicalCrmEntityInput {
  protocolVersion: typeof FIELD_PROTOCOL_VERSION;
  clientKind: "desktop";
  buildVersion: string;
  operatorId: string;
  requestId: string;
  entityType: CanonicalCrmEntityType;
  entityId: string;
  operation: CanonicalCrmOperation;
  expectedVersion: number;
  patch: Readonly<Record<string, unknown>>;
  reason?: string;
}

export interface CanonicalCrmCommitResult {
  readonly entityType: CanonicalCrmEntityType;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly updatedAt: string;
  readonly archivedAt: string;
  readonly repeated: boolean;
}

export interface CanonicalCrmRuntimeGuard {
  readonly authUid: string;
  readonly authenticatedEmail: string;
  readonly operatorId: string;
  readonly client: FieldReleaseClient;
}

export interface CanonicalCrmTransactionCommand {
  readonly input: NormalizedCanonicalCrmInput;
  readonly requestHash: string;
  readonly actor: FieldV2Actor;
  readonly runtimeGuard: CanonicalCrmRuntimeGuard;
  readonly now: string;
}

export interface CanonicalCrmDependencies {
  readonly authenticatedEmail: string;
  now(): string;
  transact(command: CanonicalCrmTransactionCommand): Promise<CanonicalCrmCommitResult>;
}

interface CanonicalCrmReceipt {
  readonly scope: typeof CANONICAL_CRM_RECEIPT_SCOPE;
  readonly requestId: string;
  readonly requestHash: string;
  readonly result: Omit<CanonicalCrmCommitResult, "repeated">;
  readonly createdAt: string;
}

interface NormalizedCanonicalCrmInput extends CanonicalCrmEntityInput {
  patch: Readonly<Record<string, unknown>>;
}

export interface CanonicalCrmRootDecision {
  readonly root: Record<string, unknown>;
  readonly result: CanonicalCrmCommitResult;
  readonly repeated: boolean;
}

interface CanonicalBuildingUnitsBatchReceipt {
  readonly scope: typeof CANONICAL_BUILDING_UNITS_BATCH_RECEIPT_SCOPE;
  readonly requestId: string;
  readonly requestHash: string;
  readonly result: Omit<CanonicalBuildingUnitsBatchResult, "repeated">;
  readonly createdAt: string;
}

export interface CanonicalBuildingUnitBatchItemInput {
  readonly entityId?: string;
  readonly expectedVersion?: number;
  readonly label: string;
  readonly floorLabel: string;
  readonly floorOrder: number;
  readonly unitOrder: number;
  readonly status?: string;
}

export interface CanonicalBuildingUnitsBatchInput {
  readonly protocolVersion: typeof FIELD_PROTOCOL_VERSION;
  readonly clientKind: "desktop";
  readonly buildVersion: string;
  readonly operatorId: string;
  readonly requestId: string;
  readonly buildingId: string;
  readonly units: readonly CanonicalBuildingUnitBatchItemInput[];
}

export interface CanonicalBuildingUnitsBatchResult {
  readonly buildingId: string;
  readonly totalUnits: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly entityIds: readonly string[];
  readonly updatedAt: string;
  readonly repeated: boolean;
}

interface NormalizedCanonicalBuildingUnitBatchItemInput {
  readonly entityId?: string;
  readonly expectedVersion?: number;
  readonly label: string;
  readonly floorLabel: string;
  readonly floorOrder: number;
  readonly unitOrder: number;
  readonly status: string;
}

interface NormalizedCanonicalBuildingUnitsBatchInput extends CanonicalBuildingUnitsBatchInput {
  readonly units: readonly Readonly<NormalizedCanonicalBuildingUnitBatchItemInput>[];
}

export interface CanonicalBuildingUnitsBatchTransactionCommand {
  readonly input: NormalizedCanonicalBuildingUnitsBatchInput;
  readonly requestHash: string;
  readonly actor: FieldV2Actor;
  readonly runtimeGuard: CanonicalCrmRuntimeGuard;
  readonly now: string;
}

export interface CanonicalBuildingUnitsBatchDependencies {
  readonly authenticatedEmail: string;
  now(): string;
  transact(command: CanonicalBuildingUnitsBatchTransactionCommand): Promise<CanonicalBuildingUnitsBatchResult>;
}

export interface CanonicalBuildingUnitsBatchRootDecision {
  readonly root: Record<string, unknown>;
  readonly result: CanonicalBuildingUnitsBatchResult;
  readonly repeated: boolean;
}

type UnknownRecord = Record<string, unknown>;

const ID_MAX_BYTES = 128;
const PATCH_MAX_BYTES = 24_000;
const REASON_MAX_BYTES = 1_000;
const TEXT_MAX_BYTES = 4_000;
const SHORT_TEXT_MAX_BYTES = 256;
const LIST_MAX_ITEMS = 100;
const VACANT_UNITS_LIST_MAX_ITEMS = 200;
const LIST_ITEM_MAX_BYTES = 256;
const BUILDING_UNITS_BATCH_MAX_ITEMS = 200;
const BUILDING_UNITS_BATCH_MAX_BYTES = 156 * 1_024;
const BUILDING_UNIT_FLOOR_ORDER_MIN = -1_000;
const BUILDING_UNIT_FLOOR_ORDER_MAX = 1_000;
const BUILDING_UNIT_ORDER_MAX = 100_000;
const FORBIDDEN_KEY = /(?:password|passcode|secret|token|credential|doorlock|door_lock|accesscode|access_code|keylocation|key_location|oauth|privatekey|private_key)/iu;
const PATH_FORBIDDEN = /[\u0000-\u001f\u007f.#$\[\]\/]/u;

const ENTITY_TYPE_SET = new Set<string>(CANONICAL_CRM_ENTITY_TYPES);
const OPERATION_SET = new Set<string>(CANONICAL_CRM_OPERATIONS);
const BUILDING_UNIT_STATUSES = new Set([
  "unknown", "occupied", "vacant", "move_out_scheduled", "maintenance",
]);
const LEGACY_BUILDING_UNIT_STORED_STATUSES = new Set(["active"]);

const SYSTEM_FIELDS = new Set([
  "id",
  "entityVersion",
  "createdAt",
  "createdByAuthUid",
  "createdByOperatorId",
  "updatedAt",
  "updatedByAuthUid",
  "updatedByOperatorId",
  "archivedAt",
  "archivedByAuthUid",
  "archivedByOperatorId",
]);

const CANONICAL_SYSTEM_FIELDS = [
  "id",
  "entityVersion",
  "createdAt",
  "createdByAuthUid",
  "createdByOperatorId",
  "updatedAt",
  "updatedByAuthUid",
  "updatedByOperatorId",
  "archivedAt",
  "archivedByAuthUid",
  "archivedByOperatorId",
] as const;

const BUILDING_FIELDS = new Set([
  "name", "address", "type", "status", "ownerCustomerId", "unitCount",
  "manager", "memo", "aliases", "externalRefs",
  "rentDeposit", "monthlyRent", "maintenanceFee", "maintenanceIncludes",
  "maintenanceIncludeOther", "roomTypes", "roomTypeOther", "roomOptions",
  "roomOptionOther", "vacantUnitCount", "vacantUnits",
]);
const BUILDING_UNIT_FIELDS = new Set([
  "crmBuildingId", "label", "unitLabel", "floorLabel", "floorOrder",
  "unitOrder", "status", "moveOutAt", "availableFrom", "memo",
]);
const SALES_UNIT_FIELDS = new Set([
  "prospectId", "crmBuildingUnitId", "label", "status", "moveOutAt",
  "availableFrom", "deposit", "rent", "maintenanceFee", "photoUrl",
  "evidenceUrl", "note",
]);

const BUILDING_STORED_FIELDS = new Set(BUILDING_FIELDS);
const BUILDING_UNIT_STORED_FIELDS = new Set([
  "crmBuildingId", "label", "floorLabel", "floorOrder", "unitOrder",
  "status", "moveOutAt", "availableFrom", "memo", "externalRefs",
]);
const SALES_UNIT_STORED_FIELDS = new Set([
  ...SALES_UNIT_FIELDS,
  "externalRefs",
]);

const EXTERNAL_REF_FIELDS = new Set([
  "paymentBuildingIds",
  "fieldBuildingIds",
  "fieldManagementNumbers",
  "fieldWorkItemIds",
  "fieldUnitIds",
  "fieldListingIds",
]);

const CLOSED_RECEIPT_KEYS = [
  "createdAt", "requestHash", "requestId", "result", "scope",
] as const;
const CLOSED_RESULT_KEYS = [
  "archivedAt", "entityId", "entityType", "entityVersion", "updatedAt",
] as const;
const CLOSED_BATCH_RECEIPT_KEYS = [
  "createdAt", "requestHash", "requestId", "result", "scope",
] as const;
const CLOSED_BATCH_RESULT_KEYS = [
  "buildingId", "createdCount", "entityIds", "totalUnits", "unchangedCount",
  "updatedAt", "updatedCount",
] as const;

function fail(code: string): never {
  throw new FieldV2Error(code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= ID_MAX_BYTES
    && value !== "__proto__"
    && value !== "prototype"
    && value !== "constructor"
    && !PATH_FORBIDDEN.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function exactKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function timestampAfter(value: string, currentUpdatedAt?: unknown): string {
  if (!isCanonicalTimestamp(value)) fail("crm_timestamp_invalid");
  if (!isCanonicalTimestamp(currentUpdatedAt)) return value;
  const nowMs = Date.parse(value);
  const currentMs = Date.parse(currentUpdatedAt);
  if (nowMs > currentMs) return value;
  return new Date(currentMs + 1).toISOString();
}

function normalizeReason(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || Buffer.byteLength(value, "utf8") > REASON_MAX_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) fail("crm_reason_invalid");
  return value;
}

function assertNoSecretKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretKeys(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail("crm_secret_field_forbidden");
    assertNoSecretKeys(child);
  }
}

function normalizeText(
  value: unknown,
  field: string,
  { maximumBytes = TEXT_MAX_BYTES, required = false }: {
    maximumBytes?: number;
    required?: boolean;
  } = {},
): string {
  if (typeof value !== "string" || value !== value.trim()) fail(`crm_${field}_invalid`);
  if ((required && value.length === 0)
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`crm_${field}_invalid`);
  }
  return value;
}

function normalizeOptionalDate(value: unknown, field: string): string {
  if (value === "") return "";
  if (typeof value !== "string") fail(`crm_${field}_invalid`);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const candidate = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(candidate.getTime()) && candidate.toISOString().slice(0, 10) === value) return value;
  }
  if (isCanonicalTimestamp(value)) return value;
  fail(`crm_${field}_invalid`);
}

function normalizeMoney(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) {
    fail(`crm_${field}_invalid`);
  }
  return value;
}

function normalizeBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum) {
    fail(`crm_${field}_invalid`);
  }
  return value;
}

function normalizeBuildingUnitStatus(value: unknown, allowLegacy = false): string {
  if (typeof value !== "string"
    || (!BUILDING_UNIT_STATUSES.has(value)
      && !(allowLegacy && LEGACY_BUILDING_UNIT_STORED_STATUSES.has(value)))) {
    fail("crm_status_invalid");
  }
  return value;
}

function normalizeStringList(value: unknown, field: string, maximumItems = LIST_MAX_ITEMS): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail(`crm_${field}_invalid`);
  const normalized = value.map((item) => normalizeText(item, field, {
    maximumBytes: LIST_ITEM_MAX_BYTES,
    required: true,
  }));
  if (new Set(normalized).size !== normalized.length) fail(`crm_${field}_invalid`);
  return Object.freeze(normalized);
}

function normalizeBuildingExternalRefsPatch(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (!isRecord(value)) fail("crm_external_refs_invalid");
  if (!exactKeys(value, ["paymentBuildingIds"])) fail("crm_patch_field_forbidden");
  return Object.freeze({
    paymentBuildingIds: normalizeStringList(value.paymentBuildingIds, "external_refs"),
  });
}

function fieldAllowlist(entityType: CanonicalCrmEntityType): ReadonlySet<string> {
  if (entityType === "buildings") return BUILDING_FIELDS;
  if (entityType === "buildingUnits") return BUILDING_UNIT_FIELDS;
  return SALES_UNIT_FIELDS;
}

function normalizePatch(
  entityType: CanonicalCrmEntityType,
  operation: CanonicalCrmOperation,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > PATCH_MAX_BYTES) {
    fail("crm_patch_invalid");
  }
  assertNoSecretKeys(value);
  const allowed = fieldAllowlist(entityType);
  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (SYSTEM_FIELDS.has(key)) fail("crm_immutable_field_forbidden");
    if (!allowed.has(key)) fail("crm_patch_field_forbidden");
    if (entityType === "buildings") {
      if (key === "name" || key === "address") result[key] = normalizeText(fieldValue, key, { maximumBytes: 1_000, required: true });
      else if (["type", "status", "manager"].includes(key)) result[key] = normalizeText(fieldValue, key, { maximumBytes: SHORT_TEXT_MAX_BYTES });
      else if (key === "memo") result[key] = normalizeText(fieldValue, key);
      else if (key === "ownerCustomerId") {
        if (fieldValue !== "" && !isSafeId(fieldValue)) fail("crm_owner_customer_id_invalid");
        result[key] = fieldValue;
      } else if (key === "unitCount") {
        if (typeof fieldValue !== "number" || !Number.isSafeInteger(fieldValue) || fieldValue < 0 || fieldValue > 100_000) fail("crm_unit_count_invalid");
        result[key] = fieldValue;
      } else if (key === "rentDeposit" || key === "monthlyRent" || key === "maintenanceFee") {
        result[key] = normalizeMoney(fieldValue, key);
      } else if (key === "vacantUnitCount") {
        result[key] = normalizeBoundedInteger(fieldValue, key, 0, 100_000);
      } else if (key === "maintenanceIncludes" || key === "roomTypes" || key === "roomOptions") {
        result[key] = normalizeStringList(fieldValue, key);
      } else if (key === "vacantUnits") {
        result[key] = normalizeStringList(fieldValue, key, VACANT_UNITS_LIST_MAX_ITEMS);
      } else if (key === "maintenanceIncludeOther" || key === "roomTypeOther" || key === "roomOptionOther") {
        result[key] = normalizeText(fieldValue, key);
      } else if (key === "aliases") result[key] = normalizeStringList(fieldValue, "aliases");
      else if (key === "externalRefs") result[key] = normalizeBuildingExternalRefsPatch(fieldValue);
    } else if (entityType === "buildingUnits") {
      if (key === "crmBuildingId") {
        if (!isSafeId(fieldValue)) fail("crm_parent_id_invalid");
        result[key] = fieldValue;
      } else if (key === "label" || key === "unitLabel") {
        if ((key === "unitLabel" && Object.hasOwn(value, "label")) || Object.hasOwn(result, "label")) fail("crm_patch_field_forbidden");
        result.label = normalizeText(fieldValue, "unit_label", { maximumBytes: SHORT_TEXT_MAX_BYTES, required: true });
      } else if (key === "floorLabel") result[key] = normalizeText(fieldValue, key, { maximumBytes: SHORT_TEXT_MAX_BYTES });
      else if (key === "floorOrder") result[key] = normalizeBoundedInteger(
        fieldValue, key, BUILDING_UNIT_FLOOR_ORDER_MIN, BUILDING_UNIT_FLOOR_ORDER_MAX,
      );
      else if (key === "unitOrder") result[key] = normalizeBoundedInteger(fieldValue, key, 0, BUILDING_UNIT_ORDER_MAX);
      else if (key === "status") result[key] = normalizeBuildingUnitStatus(fieldValue);
      else if (key === "moveOutAt" || key === "availableFrom") result[key] = normalizeOptionalDate(fieldValue, key);
      else if (key === "memo") result[key] = normalizeText(fieldValue, key);
    } else {
      if (key === "prospectId" || key === "crmBuildingUnitId") {
        if (!isSafeId(fieldValue)) fail("crm_parent_id_invalid");
        result[key] = fieldValue;
      } else if (key === "label") result[key] = normalizeText(fieldValue, "unit_label", { maximumBytes: SHORT_TEXT_MAX_BYTES, required: true });
      else if (key === "status") result[key] = normalizeText(fieldValue, key, { maximumBytes: SHORT_TEXT_MAX_BYTES });
      else if (key === "moveOutAt" || key === "availableFrom") result[key] = normalizeOptionalDate(fieldValue, key);
      else if (key === "deposit" || key === "rent" || key === "maintenanceFee") result[key] = normalizeMoney(fieldValue, key);
      else if (key === "photoUrl" || key === "evidenceUrl" || key === "note") result[key] = normalizeText(fieldValue, key);
    }
  }
  if (operation === "create") {
    if (entityType === "buildings" && (!Object.hasOwn(result, "name") || !Object.hasOwn(result, "address"))) fail("crm_create_fields_required");
    if (entityType === "buildingUnits" && (!Object.hasOwn(result, "crmBuildingId") || !Object.hasOwn(result, "label"))) fail("crm_create_fields_required");
    if (entityType === "salesUnits" && (!Object.hasOwn(result, "prospectId") || !Object.hasOwn(result, "label"))) fail("crm_create_fields_required");
  }
  return Object.freeze(result);
}

function normalizeInput(value: unknown): NormalizedCanonicalCrmInput {
  if (!isRecord(value)) fail("crm_request_invalid");
  const allowed = new Set([
    "protocolVersion", "clientKind", "buildVersion", "operatorId", "requestId",
    "entityType", "entityId", "operation", "expectedVersion", "patch", "reason",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("crm_request_invalid");
  if (value.protocolVersion !== FIELD_PROTOCOL_VERSION || value.clientKind !== "desktop") fail("crm_request_invalid");
  if (!isSafeId(value.operatorId) || !isFieldRequestId(value.requestId) || !isSafeId(value.entityId)) fail("crm_request_invalid");
  if (typeof value.entityType !== "string" || !ENTITY_TYPE_SET.has(value.entityType)) fail("crm_entity_type_invalid");
  if (value.operation === "delete") fail("crm_physical_delete_forbidden");
  if (typeof value.operation !== "string" || !OPERATION_SET.has(value.operation)) fail("crm_operation_invalid");
  if (typeof value.buildVersion !== "string" || value.buildVersion.length === 0 || Buffer.byteLength(value.buildVersion, "utf8") > 64) fail("crm_request_invalid");
  if (typeof value.expectedVersion !== "number" || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0) fail("crm_expected_version_invalid");
  if (value.operation === "create" ? value.expectedVersion !== 0 : value.expectedVersion === 0) fail("crm_expected_version_invalid");
  const operation = value.operation as CanonicalCrmOperation;
  const entityType = value.entityType as CanonicalCrmEntityType;
  const patch = normalizePatch(entityType, operation, value.patch);
  if (operation === "update" && Object.keys(patch).length === 0) fail("crm_patch_empty");
  if ((operation === "archive" || operation === "restore") && Object.keys(patch).length > 0) fail("crm_archive_patch_forbidden");
  const reason = normalizeReason(value.reason);
  return Object.freeze({
    protocolVersion: FIELD_PROTOCOL_VERSION,
    clientKind: "desktop",
    buildVersion: value.buildVersion,
    operatorId: value.operatorId,
    requestId: value.requestId,
    entityType,
    entityId: value.entityId,
    operation,
    expectedVersion: value.expectedVersion,
    patch,
    ...(reason === undefined ? {} : { reason }),
  });
}

function normalizeBuildingUnitsBatchInput(value: unknown): NormalizedCanonicalBuildingUnitsBatchInput {
  if (!isRecord(value)) fail("crm_request_invalid");
  const allowed = new Set([
    "protocolVersion", "clientKind", "buildVersion", "operatorId", "requestId",
    "buildingId", "units",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("crm_request_invalid");
  if (value.protocolVersion !== FIELD_PROTOCOL_VERSION || value.clientKind !== "desktop") fail("crm_request_invalid");
  if (!isSafeId(value.operatorId) || !isFieldRequestId(value.requestId) || !isSafeId(value.buildingId)) fail("crm_request_invalid");
  if (typeof value.buildVersion !== "string"
    || value.buildVersion.length === 0
    || Buffer.byteLength(value.buildVersion, "utf8") > 64) fail("crm_request_invalid");
  if (!Array.isArray(value.units)) fail("crm_request_invalid");
  if (value.units.length === 0) fail("crm_building_unit_batch_empty");
  if (value.units.length > BUILDING_UNITS_BATCH_MAX_ITEMS) fail("crm_building_unit_batch_too_large");
  if (Buffer.byteLength(JSON.stringify(value.units), "utf8") > BUILDING_UNITS_BATCH_MAX_BYTES) {
    fail("crm_building_unit_batch_too_large");
  }
  const seenLabels = new Set<string>();
  const units = value.units.map((item): Readonly<NormalizedCanonicalBuildingUnitBatchItemInput> => {
    if (!isRecord(item)) fail("crm_request_invalid");
    const itemKeys = Object.keys(item);
    const itemAllowed = new Set([
      "entityId", "expectedVersion", "label", "floorLabel", "floorOrder", "unitOrder", "status",
    ]);
    if (itemKeys.some((key) => !itemAllowed.has(key))) fail("crm_patch_field_forbidden");
    const hasEntityId = Object.hasOwn(item, "entityId");
    const hasExpectedVersion = Object.hasOwn(item, "expectedVersion");
    if (hasEntityId !== hasExpectedVersion) fail("crm_request_invalid");
    if (hasEntityId && (!isSafeId(item.entityId)
      || typeof item.expectedVersion !== "number"
      || !Number.isSafeInteger(item.expectedVersion)
      || item.expectedVersion < 1)) fail("crm_request_invalid");
    const label = normalizeText(item.label, "unit_label", { maximumBytes: SHORT_TEXT_MAX_BYTES, required: true });
    const normalizedLabel = normalizeUnitLabel(label);
    if (!normalizedLabel || seenLabels.has(normalizedLabel)) fail("crm_building_unit_label_conflict");
    seenLabels.add(normalizedLabel);
    return Object.freeze({
      ...(hasEntityId ? { entityId: item.entityId as string, expectedVersion: item.expectedVersion as number } : {}),
      label,
      floorLabel: normalizeText(item.floorLabel, "floorLabel", { maximumBytes: SHORT_TEXT_MAX_BYTES, required: true }),
      floorOrder: normalizeBoundedInteger(
        item.floorOrder, "floorOrder", BUILDING_UNIT_FLOOR_ORDER_MIN, BUILDING_UNIT_FLOOR_ORDER_MAX,
      ),
      unitOrder: normalizeBoundedInteger(item.unitOrder, "unitOrder", 0, BUILDING_UNIT_ORDER_MAX),
      status: item.status === undefined ? "unknown" : normalizeBuildingUnitStatus(item.status),
    });
  });
  return Object.freeze({
    protocolVersion: FIELD_PROTOCOL_VERSION,
    clientKind: "desktop",
    buildVersion: value.buildVersion,
    operatorId: value.operatorId,
    requestId: value.requestId,
    buildingId: value.buildingId,
    units: Object.freeze(units),
  });
}

function readPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isSafeId(segment) || !isRecord(current) || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return current ?? null;
}

function cloneRoot(root: unknown): UnknownRecord {
  return isRecord(root) ? structuredClone(root) as UnknownRecord : {};
}

function writePath(root: UnknownRecord, path: readonly string[], value: unknown): void {
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!isSafeId(segment)) fail("crm_transaction_invalid");
    const hasChild = Object.hasOwn(current, segment);
    const child = hasChild ? current[segment] : undefined;
    if (hasChild && child !== null && !isRecord(child)) fail("crm_transaction_invalid");
    if (!hasChild || child === null) current[segment] = Object.create(null) as UnknownRecord;
    current = current[segment] as UnknownRecord;
  }
  const leaf = path[path.length - 1];
  if (!isSafeId(leaf)) fail("crm_transaction_invalid");
  current[leaf] = value;
}

function assertWritablePathParents(root: unknown, path: readonly string[]): void {
  if (!isRecord(root)) fail("crm_transaction_invalid");
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!isSafeId(segment)) fail("crm_transaction_invalid");
    if (!Object.hasOwn(current, segment)) return;
    const child = current[segment];
    if (child === null) return;
    if (!isRecord(child)) fail("crm_transaction_invalid");
    current = child;
  }
}

function parseReceipt(value: unknown, requestId: string): CanonicalCrmReceipt | null {
  if (!isRecord(value)) return null;
  if (!exactKeys(value, CLOSED_RECEIPT_KEYS)
    || value.scope !== CANONICAL_CRM_RECEIPT_SCOPE
    || value.requestId !== requestId
    || typeof value.requestHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.requestHash)
    || !isCanonicalTimestamp(value.createdAt)
    || !isRecord(value.result)
    || !exactKeys(value.result, CLOSED_RESULT_KEYS)
    || typeof value.result.entityType !== "string"
    || !ENTITY_TYPE_SET.has(value.result.entityType)
    || !isSafeId(value.result.entityId)
    || !Number.isSafeInteger(value.result.entityVersion)
    || (value.result.entityVersion as number) < 1
    || !isCanonicalTimestamp(value.result.updatedAt)
    || (value.result.archivedAt !== "" && !isCanonicalTimestamp(value.result.archivedAt))) {
    return null;
  }
  return value as unknown as CanonicalCrmReceipt;
}

function parseBuildingUnitsBatchReceipt(
  value: unknown,
  requestId: string,
): CanonicalBuildingUnitsBatchReceipt | null {
  if (!isRecord(value)) return null;
  if (!exactKeys(value, CLOSED_BATCH_RECEIPT_KEYS)
    || value.scope !== CANONICAL_BUILDING_UNITS_BATCH_RECEIPT_SCOPE
    || value.requestId !== requestId
    || typeof value.requestHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.requestHash)
    || !isCanonicalTimestamp(value.createdAt)
    || !isRecord(value.result)
    || !exactKeys(value.result, CLOSED_BATCH_RESULT_KEYS)
    || !isSafeId(value.result.buildingId)
    || !Number.isSafeInteger(value.result.totalUnits)
    || (value.result.totalUnits as number) < 1
    || (value.result.totalUnits as number) > BUILDING_UNITS_BATCH_MAX_ITEMS
    || !Number.isSafeInteger(value.result.createdCount)
    || (value.result.createdCount as number) < 0
    || !Number.isSafeInteger(value.result.updatedCount)
    || (value.result.updatedCount as number) < 0
    || !Number.isSafeInteger(value.result.unchangedCount)
    || (value.result.unchangedCount as number) < 0
    || (value.result.createdCount as number)
      + (value.result.updatedCount as number)
      + (value.result.unchangedCount as number) !== value.result.totalUnits
    || !Array.isArray(value.result.entityIds)
    || value.result.entityIds.length !== value.result.totalUnits
    || !value.result.entityIds.every(isSafeId)
    || new Set(value.result.entityIds).size !== value.result.entityIds.length
    || !isCanonicalTimestamp(value.result.updatedAt)) {
    return null;
  }
  return value as unknown as CanonicalBuildingUnitsBatchReceipt;
}

function assertCurrentActor(
  root: unknown,
  command: CanonicalCrmTransactionCommand | CanonicalBuildingUnitsBatchTransactionCommand,
): "admin" | "member" | "viewer" {
  const { runtimeGuard } = command;
  const access = readPath(root, ["crmCompany", "access", runtimeGuard.authUid]);
  if (!isRecord(access)
    || access.enabled !== true
    || (access.role !== "admin" && access.role !== "member" && access.role !== "viewer")
    || typeof access.email !== "string"
    || access.email.trim().toLowerCase() !== runtimeGuard.authenticatedEmail) {
    fail("crm_access_forbidden");
  }
  const profile = readPath(root, ["crmCompany", "teamProfiles", runtimeGuard.operatorId]);
  if (!isRecord(profile) || profile.active !== true || typeof profile.displayName !== "string" || profile.displayName !== command.actor.displayName) {
    fail("crm_operator_inactive");
  }
  return access.role;
}

function assertCurrentRelease(
  root: unknown,
  command: CanonicalCrmTransactionCommand | CanonicalBuildingUnitsBatchTransactionCommand,
): void {
  const release = readPath(root, ["fieldPlatform", "v2", "config", "release"]);
  assertFieldReleaseCompatible(
    release as FieldReleaseConfiguration,
    command.runtimeGuard.client,
  );
  const config = release as FieldReleaseConfiguration;
  if (config.safeMode) fail("crm_safe_mode_read_only");
  if (!config.v2WritesEnabled) fail("crm_v2_writes_disabled");
  if (!config.canonicalCrmEnabled) fail("crm_canonical_writes_disabled");
}

function assertStoredExternalRefs(value: unknown): void {
  if (!isRecord(value)) fail("crm_entity_invalid");
  for (const [key, list] of Object.entries(value)) {
    if (!EXTERNAL_REF_FIELDS.has(key)) fail("crm_entity_invalid");
    normalizeStringList(list, "external_refs");
  }
}

function storedFieldAllowlist(entityType: CanonicalCrmEntityType): ReadonlySet<string> {
  if (entityType === "buildings") return BUILDING_STORED_FIELDS;
  if (entityType === "buildingUnits") return BUILDING_UNIT_STORED_FIELDS;
  return SALES_UNIT_STORED_FIELDS;
}

function assertStoredCanonicalEntity(
  entityType: CanonicalCrmEntityType,
  entityId: string,
  value: UnknownRecord,
): void {
  const allowed = new Set([...CANONICAL_SYSTEM_FIELDS, ...storedFieldAllowlist(entityType)]);
  assertNoSecretKeys(value);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || CANONICAL_SYSTEM_FIELDS.some((key) => !Object.hasOwn(value, key))
    || value.id !== entityId
    || !Number.isSafeInteger(value.entityVersion)
    || (value.entityVersion as number) < 1
    || !isCanonicalTimestamp(value.createdAt)
    || !isCanonicalTimestamp(value.updatedAt)
    || !isSafeId(value.createdByAuthUid)
    || !isSafeId(value.createdByOperatorId)
    || !isSafeId(value.updatedByAuthUid)
    || !isSafeId(value.updatedByOperatorId)
    || (value.archivedAt !== "" && !isCanonicalTimestamp(value.archivedAt))
    || typeof value.archivedByAuthUid !== "string"
    || typeof value.archivedByOperatorId !== "string"
    || (value.archivedAt === "" && (value.archivedByAuthUid !== "" || value.archivedByOperatorId !== ""))
    || (value.archivedAt !== "" && (!isSafeId(value.archivedByAuthUid) || !isSafeId(value.archivedByOperatorId)))) {
    fail("crm_entity_invalid");
  }
  try {
    if (entityType === "buildings") {
      normalizeText(value.name, "name", { maximumBytes: 1_000, required: true });
      normalizeText(value.address, "address", { maximumBytes: 1_000, required: true });
      if (Object.hasOwn(value, "type")) normalizeText(value.type, "type", { maximumBytes: SHORT_TEXT_MAX_BYTES });
      if (Object.hasOwn(value, "status")) normalizeText(value.status, "status", { maximumBytes: SHORT_TEXT_MAX_BYTES });
      if (Object.hasOwn(value, "manager")) normalizeText(value.manager, "manager", { maximumBytes: SHORT_TEXT_MAX_BYTES });
      if (Object.hasOwn(value, "memo")) normalizeText(value.memo, "memo");
      if (Object.hasOwn(value, "ownerCustomerId") && value.ownerCustomerId !== "" && !isSafeId(value.ownerCustomerId)) fail("crm_entity_invalid");
      if (Object.hasOwn(value, "unitCount")
        && (typeof value.unitCount !== "number"
          || !Number.isSafeInteger(value.unitCount)
          || value.unitCount < 0
          || value.unitCount > 100_000)) fail("crm_entity_invalid");
      if (Object.hasOwn(value, "rentDeposit")) normalizeMoney(value.rentDeposit, "rentDeposit");
      if (Object.hasOwn(value, "monthlyRent")) normalizeMoney(value.monthlyRent, "monthlyRent");
      if (Object.hasOwn(value, "maintenanceFee")) normalizeMoney(value.maintenanceFee, "maintenanceFee");
      if (Object.hasOwn(value, "vacantUnitCount")) normalizeBoundedInteger(value.vacantUnitCount, "vacantUnitCount", 0, 100_000);
      if (Object.hasOwn(value, "maintenanceIncludes")) normalizeStringList(value.maintenanceIncludes, "maintenanceIncludes");
      if (Object.hasOwn(value, "roomTypes")) normalizeStringList(value.roomTypes, "roomTypes");
      if (Object.hasOwn(value, "roomOptions")) normalizeStringList(value.roomOptions, "roomOptions");
      if (Object.hasOwn(value, "vacantUnits")) {
        normalizeStringList(value.vacantUnits, "vacantUnits", VACANT_UNITS_LIST_MAX_ITEMS);
      }
      if (Object.hasOwn(value, "maintenanceIncludeOther")) normalizeText(value.maintenanceIncludeOther, "maintenanceIncludeOther");
      if (Object.hasOwn(value, "roomTypeOther")) normalizeText(value.roomTypeOther, "roomTypeOther");
      if (Object.hasOwn(value, "roomOptionOther")) normalizeText(value.roomOptionOther, "roomOptionOther");
      if (Object.hasOwn(value, "aliases")) normalizeStringList(value.aliases, "aliases");
      if (Object.hasOwn(value, "externalRefs")) assertStoredExternalRefs(value.externalRefs);
    } else if (entityType === "buildingUnits") {
      if (!isSafeId(value.crmBuildingId)) fail("crm_entity_invalid");
      normalizeText(value.label, "unit_label", { maximumBytes: SHORT_TEXT_MAX_BYTES, required: true });
      if (Object.hasOwn(value, "floorLabel")) normalizeText(value.floorLabel, "floorLabel", { maximumBytes: SHORT_TEXT_MAX_BYTES });
      if (Object.hasOwn(value, "floorOrder")) normalizeBoundedInteger(
        value.floorOrder, "floorOrder", BUILDING_UNIT_FLOOR_ORDER_MIN, BUILDING_UNIT_FLOOR_ORDER_MAX,
      );
      if (Object.hasOwn(value, "unitOrder")) normalizeBoundedInteger(value.unitOrder, "unitOrder", 0, BUILDING_UNIT_ORDER_MAX);
      if (Object.hasOwn(value, "status")) normalizeBuildingUnitStatus(value.status, true);
      if (Object.hasOwn(value, "moveOutAt")) normalizeOptionalDate(value.moveOutAt, "moveOutAt");
      if (Object.hasOwn(value, "availableFrom")) normalizeOptionalDate(value.availableFrom, "availableFrom");
      if (Object.hasOwn(value, "memo")) normalizeText(value.memo, "memo");
      if (Object.hasOwn(value, "externalRefs")) assertStoredExternalRefs(value.externalRefs);
    } else {
      if (!isSafeId(value.prospectId)) fail("crm_entity_invalid");
      if (Object.hasOwn(value, "crmBuildingUnitId") && !isSafeId(value.crmBuildingUnitId)) fail("crm_entity_invalid");
      normalizeText(value.label, "unit_label", { maximumBytes: SHORT_TEXT_MAX_BYTES, required: true });
      if (Object.hasOwn(value, "status")) normalizeText(value.status, "status", { maximumBytes: SHORT_TEXT_MAX_BYTES });
      if (Object.hasOwn(value, "moveOutAt")) normalizeOptionalDate(value.moveOutAt, "moveOutAt");
      if (Object.hasOwn(value, "availableFrom")) normalizeOptionalDate(value.availableFrom, "availableFrom");
      if (Object.hasOwn(value, "deposit")) normalizeMoney(value.deposit, "deposit");
      if (Object.hasOwn(value, "rent")) normalizeMoney(value.rent, "rent");
      if (Object.hasOwn(value, "maintenanceFee")) normalizeMoney(value.maintenanceFee, "maintenanceFee");
      if (Object.hasOwn(value, "photoUrl")) normalizeText(value.photoUrl, "photoUrl");
      if (Object.hasOwn(value, "evidenceUrl")) normalizeText(value.evidenceUrl, "evidenceUrl");
      if (Object.hasOwn(value, "note")) normalizeText(value.note, "note");
      if (Object.hasOwn(value, "externalRefs")) assertStoredExternalRefs(value.externalRefs);
    }
  } catch {
    fail("crm_entity_invalid");
  }
}

function isArchived(value: unknown): boolean {
  return isRecord(value) && typeof value.archivedAt === "string" && value.archivedAt.length > 0;
}

function requireActiveParent(root: unknown, collection: string, id: unknown): UnknownRecord {
  if (!isSafeId(id)) fail("crm_parent_required");
  const parent = readPath(root, ["crmCompany", "data", collection, id]);
  if (!isRecord(parent) || parent.id !== id) fail("crm_parent_not_found");
  if (isArchived(parent)) fail("crm_parent_archived");
  return parent;
}

function normalizeUnitLabel(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "")
    : "";
}

function assertUniqueBuildingUnitLabel(root: unknown, entityId: string, entity: UnknownRecord): void {
  const buildingId = entity.crmBuildingId;
  const label = normalizeUnitLabel(entity.label);
  if (!isSafeId(buildingId) || !label) fail("crm_building_unit_invalid");
  const units = readPath(root, ["crmCompany", "data", "buildingUnits"]);
  if (!isRecord(units)) return;
  for (const [candidateId, candidate] of Object.entries(units)) {
    if (candidateId === entityId || !isRecord(candidate) || isArchived(candidate)) continue;
    if (candidate.crmBuildingId === buildingId && normalizeUnitLabel(candidate.label) === label) {
      fail("crm_building_unit_label_conflict");
    }
  }
}

function validateParentIntegrity(
  root: unknown,
  input: NormalizedCanonicalCrmInput,
  existing: UnknownRecord | null,
  next: UnknownRecord,
): void {
  if (input.entityType === "buildings") {
    const owner = next.ownerCustomerId;
    if (input.operation !== "create" && Object.hasOwn(input.patch, "ownerCustomerId") && owner !== existing?.ownerCustomerId) {
      fail("crm_owner_change_requires_atomic_link");
    }
    if (owner !== undefined && owner !== "") requireActiveParent(root, "customers", owner);
    return;
  }
  if (input.entityType === "buildingUnits") {
    requireActiveParent(root, "buildings", next.crmBuildingId);
    assertUniqueBuildingUnitLabel(root, input.entityId, next);
    return;
  }
  const prospect = requireActiveParent(root, "salesProspects", next.prospectId);
  if (next.crmBuildingUnitId !== undefined && next.crmBuildingUnitId !== "") {
    const unit = requireActiveParent(root, "buildingUnits", next.crmBuildingUnitId);
    if (!isSafeId(prospect.crmBuildingId) || unit.crmBuildingId !== prospect.crmBuildingId) fail("crm_parent_mismatch");
  }
}

function planBuildingVacancyMirror(
  currentRoot: unknown,
  buildingId: string,
  replacements: ReadonlyMap<string, UnknownRecord>,
  actor: FieldV2Actor,
  now: string,
): {
  readonly path: readonly string[];
  readonly entity: UnknownRecord;
  readonly activeUnitCount: number;
  readonly vacantUnits: readonly string[];
  readonly migrationResolvedBefore: boolean;
  readonly migrationResolved: boolean;
  readonly missingLegacyBefore: readonly string[];
  readonly missingLegacyAfter: readonly string[];
  readonly vacancyShortfallBefore: number;
  readonly vacancyShortfallAfter: number;
} {
  const currentBuilding = requireActiveParent(currentRoot, "buildings", buildingId);
  assertStoredCanonicalEntity("buildings", buildingId, currentBuilding);
  const collectionValue = readPath(currentRoot, ["crmCompany", "data", "buildingUnits"]);
  if (collectionValue !== null && !isRecord(collectionValue)) fail("crm_transaction_invalid");
  const finalUnits = new Map<string, UnknownRecord>();
  if (isRecord(collectionValue)) {
    for (const [entityId, candidate] of Object.entries(collectionValue)) {
      if (isRecord(candidate)) finalUnits.set(entityId, candidate);
    }
  }
  const currentActiveLabels = new Set<string>();
  const currentVacantLabels = new Set<string>();
  let currentFormalVacant = 0;
  for (const [entityId, candidate] of finalUnits) {
    if (candidate.crmBuildingId !== buildingId || isArchived(candidate)) continue;
    assertStoredCanonicalEntity("buildingUnits", entityId, candidate);
    const normalizedLabel = normalizeUnitLabel(candidate.label);
    if (!normalizedLabel) fail("crm_entity_invalid");
    if (currentActiveLabels.has(normalizedLabel)) fail("crm_building_unit_label_conflict");
    currentActiveLabels.add(normalizedLabel);
    if (candidate.status === "vacant") {
      currentFormalVacant += 1;
      currentVacantLabels.add(normalizedLabel);
    }
  }
  const legacyNamed = Object.hasOwn(currentBuilding, "vacantUnits")
    ? normalizeStringList(currentBuilding.vacantUnits, "vacantUnits", VACANT_UNITS_LIST_MAX_ITEMS)
    : [];
  const legacyCount = Object.hasOwn(currentBuilding, "vacantUnitCount")
    ? normalizeBoundedInteger(currentBuilding.vacantUnitCount, "vacantUnitCount", 0, 100_000)
    : legacyNamed.length;
  const legacyNormalizedLabels = new Set<string>();
  for (const label of legacyNamed) {
    const normalizedLabel = normalizeUnitLabel(label);
    if (!normalizedLabel || legacyNormalizedLabels.has(normalizedLabel)) fail("crm_entity_invalid");
    legacyNormalizedLabels.add(normalizedLabel);
  }
  const missingLegacyBefore = [...legacyNormalizedLabels]
    .filter((label) => !currentVacantLabels.has(label));
  const vacancyShortfallBefore = Math.max(legacyCount - currentFormalVacant, 0);
  const migrationResolvedBefore = missingLegacyBefore.length === 0
    && vacancyShortfallBefore === 0;
  for (const [entityId, entity] of replacements) finalUnits.set(entityId, entity);
  const normalizedVacantLabels = new Set<string>();
  const finalActiveLabels = new Set<string>();
  const vacantRecords: UnknownRecord[] = [];
  let activeUnitCount = 0;
  for (const [entityId, candidate] of finalUnits) {
    if (candidate.crmBuildingId !== buildingId || isArchived(candidate)) continue;
    assertStoredCanonicalEntity("buildingUnits", entityId, candidate);
    activeUnitCount += 1;
    const activeLabel = normalizeUnitLabel(candidate.label);
    if (!activeLabel) fail("crm_entity_invalid");
    if (finalActiveLabels.has(activeLabel)) fail("crm_building_unit_label_conflict");
    finalActiveLabels.add(activeLabel);
    if (candidate.status !== "vacant") continue;
    const normalizedLabel = activeLabel;
    if (!normalizedLabel || normalizedVacantLabels.has(normalizedLabel)) fail("crm_building_unit_label_conflict");
    normalizedVacantLabels.add(normalizedLabel);
    vacantRecords.push(candidate);
  }
  const missingLegacyAfter = [...legacyNormalizedLabels]
    .filter((label) => !normalizedVacantLabels.has(label));
  const vacancyShortfallAfter = Math.max(legacyCount - vacantRecords.length, 0);
  const migrationResolved = migrationResolvedBefore
    || (missingLegacyAfter.length === 0 && vacancyShortfallAfter === 0);
  const vacantUnits = normalizeStringList(
    vacantRecords
      .sort((left, right) => {
        const leftFloor = Number.isSafeInteger(left.floorOrder) ? left.floorOrder as number : Number.MAX_SAFE_INTEGER;
        const rightFloor = Number.isSafeInteger(right.floorOrder) ? right.floorOrder as number : Number.MAX_SAFE_INTEGER;
        if (leftFloor !== rightFloor) return leftFloor - rightFloor;
        const leftUnit = Number.isSafeInteger(left.unitOrder) ? left.unitOrder as number : Number.MAX_SAFE_INTEGER;
        const rightUnit = Number.isSafeInteger(right.unitOrder) ? right.unitOrder as number : Number.MAX_SAFE_INTEGER;
        if (leftUnit !== rightUnit) return leftUnit - rightUnit;
        return String(left.label || "").localeCompare(String(right.label || ""), "ko-KR");
      })
      .map((unit) => String(unit.label || "")),
    "vacantUnits",
    VACANT_UNITS_LIST_MAX_ITEMS,
  );
  const nextBuilding = migrationResolved
    ? {
      ...structuredClone(currentBuilding),
      vacantUnitCount: vacantUnits.length,
      vacantUnits,
      entityVersion: (currentBuilding.entityVersion as number) + 1,
      updatedAt: timestampAfter(now, currentBuilding.updatedAt),
      updatedByAuthUid: actor.authUid,
      updatedByOperatorId: actor.operatorId,
    }
    : currentBuilding;
  if (migrationResolved) assertStoredCanonicalEntity("buildings", buildingId, nextBuilding);
  return Object.freeze({
    path: Object.freeze(["crmCompany", "data", "buildings", buildingId]),
    entity: nextBuilding,
    activeUnitCount,
    vacantUnits,
    migrationResolvedBefore,
    migrationResolved,
    missingLegacyBefore: Object.freeze(missingLegacyBefore),
    missingLegacyAfter: Object.freeze(missingLegacyAfter),
    vacancyShortfallBefore,
    vacancyShortfallAfter,
  });
}

function sameNormalizedVacancyLabels(left: readonly string[], right: readonly string[]): boolean {
  const leftLabels = new Set(left.map(normalizeUnitLabel));
  const rightLabels = new Set(right.map(normalizeUnitLabel));
  return leftLabels.size === left.length
    && rightLabels.size === right.length
    && leftLabels.size === rightLabels.size
    && [...leftLabels].every((label) => label.length > 0 && rightLabels.has(label));
}

function enforceManagedBuildingVacancyPatch(
  currentRoot: unknown,
  input: NormalizedCanonicalCrmInput,
  existing: UnknownRecord | null,
  next: UnknownRecord,
  actor: FieldV2Actor,
  now: string,
): void {
  if (input.entityType !== "buildings"
    || !existing
    || (!Object.hasOwn(input.patch, "vacantUnitCount") && !Object.hasOwn(input.patch, "vacantUnits"))) return;
  const projection = planBuildingVacancyMirror(
    currentRoot,
    input.entityId,
    new Map(),
    actor,
    now,
  );
  if (projection.activeUnitCount === 0) return;
  const requestedUnits = Object.hasOwn(next, "vacantUnits")
    ? normalizeStringList(next.vacantUnits, "vacantUnits", VACANT_UNITS_LIST_MAX_ITEMS)
    : [];
  const requestedCount = Object.hasOwn(next, "vacantUnitCount")
    ? normalizeBoundedInteger(next.vacantUnitCount, "vacantUnitCount", 0, 100_000)
    : requestedUnits.length;
  if (!projection.migrationResolvedBefore) {
    const storedUnits = Object.hasOwn(existing, "vacantUnits")
      ? normalizeStringList(existing.vacantUnits, "vacantUnits", VACANT_UNITS_LIST_MAX_ITEMS)
      : [];
    const storedCount = Object.hasOwn(existing, "vacantUnitCount")
      ? normalizeBoundedInteger(existing.vacantUnitCount, "vacantUnitCount", 0, 100_000)
      : storedUnits.length;
    if (requestedCount !== storedCount || !sameNormalizedVacancyLabels(requestedUnits, storedUnits)) {
      fail("crm_patch_field_forbidden");
    }
    if (Object.hasOwn(existing, "vacantUnitCount")) next.vacantUnitCount = existing.vacantUnitCount;
    else delete next.vacantUnitCount;
    if (Object.hasOwn(existing, "vacantUnits")) next.vacantUnits = structuredClone(existing.vacantUnits);
    else delete next.vacantUnits;
    return;
  }
  if (requestedCount !== projection.vacantUnits.length
    || !sameNormalizedVacancyLabels(requestedUnits, projection.vacantUnits)) {
    fail("crm_patch_field_forbidden");
  }
  next.vacantUnitCount = projection.vacantUnits.length;
  next.vacantUnits = projection.vacantUnits;
}

function immutableParentField(entityType: CanonicalCrmEntityType): string | null {
  if (entityType === "buildingUnits") return "crmBuildingId";
  if (entityType === "salesUnits") return "prospectId";
  return null;
}

function linkCollection(entityType: CanonicalCrmEntityType): string {
  if (entityType === "buildings") return "crmBuildings";
  if (entityType === "buildingUnits") return "crmBuildingUnits";
  return "crmSalesUnits";
}

function deepContainsEntityReference(
  value: unknown,
  entityType: CanonicalCrmEntityType,
  entityId: string,
): boolean {
  const referenceField = entityType === "buildings"
    ? "crmBuildingId"
    : entityType === "buildingUnits"
      ? "crmBuildingUnitId"
      : "crmSalesUnitId";
  const pluralField = entityType === "buildings"
    ? "crmBuildingIds"
    : entityType === "buildingUnits"
      ? "crmBuildingUnitIds"
      : "crmSalesUnitIds";
  if (Array.isArray(value)) return value.some((item) => deepContainsEntityReference(item, entityType, entityId));
  if (!isRecord(value)) return false;
  if (value[referenceField] === entityId) return true;
  if (Array.isArray(value[pluralField]) && value[pluralField].includes(entityId)) return true;
  return Object.values(value).some((item) => deepContainsEntityReference(item, entityType, entityId));
}

export function canonicalCrmEntityHasFieldLinks(
  root: unknown,
  entityType: CanonicalCrmEntityType,
  entityId: string,
  entity: unknown,
): boolean {
  const directLink = readPath(root, [
    "fieldPlatform", "v2", "links", linkCollection(entityType), entityId,
  ]);
  if (directLink !== null) return true;
  if (isRecord(entity) && isRecord(entity.externalRefs)
    && Object.entries(entity.externalRefs).some(([key, value]) => key.startsWith("field") && Array.isArray(value) && value.length > 0)) {
    return true;
  }
  return deepContainsEntityReference(
    readPath(root, ["crmCompany", "fieldSummaries"]),
    entityType,
    entityId,
  ) || deepContainsEntityReference(
    readPath(root, ["fieldPlatform", "v2", "workItems"]),
    entityType,
    entityId,
  );
}

function makeAudit(
  input: NormalizedCanonicalCrmInput,
  command: CanonicalCrmTransactionCommand,
  beforeVersion: number,
  afterVersion: number,
  linked: boolean,
): Readonly<Record<string, unknown>> {
  const id = `audit_${hashCanonical({
    scope: CANONICAL_CRM_RECEIPT_SCOPE,
    requestId: input.requestId,
    entityType: input.entityType,
    entityId: input.entityId,
  }).slice(0, 32)}`;
  return Object.freeze({
    id,
    action: `crm.canonical.${input.operation}`,
    entityType: input.entityType,
    entityId: input.entityId,
    requestId: input.requestId,
    authUid: command.actor.authUid,
    operatorId: command.actor.operatorId,
    beforeVersion,
    afterVersion,
    fieldLinked: linked,
    reasonProvided: input.reason !== undefined,
    changedFields: Object.freeze(
      input.operation === "archive" || input.operation === "restore"
        ? ["archivedAt"]
        : Object.keys(input.patch).flatMap((field) => field === "externalRefs"
          ? ["externalRefs.paymentBuildingIds"]
          : [field]).sort(),
    ),
    occurredAt: command.now,
  });
}

function mergePreservedExternalRefs(
  existing: UnknownRecord | null,
  patch: Readonly<Record<string, unknown>>,
  next: UnknownRecord,
): void {
  if (!Object.hasOwn(patch, "externalRefs")) return;
  const previous = isRecord(existing?.externalRefs) ? existing.externalRefs : {};
  const requested = isRecord(next.externalRefs) ? next.externalRefs : {};
  const merged: UnknownRecord = { ...previous, ...requested };
  for (const [key, value] of Object.entries(previous)) {
    if (!key.startsWith("field") || !Array.isArray(value)) continue;
    const requestedValues = Array.isArray(requested[key]) ? requested[key] : [];
    merged[key] = [...new Set([...value, ...requestedValues])];
  }
  next.externalRefs = merged;
}

function writeOwnerBuildingBacklink(
  root: UnknownRecord,
  input: NormalizedCanonicalCrmInput,
  entity: UnknownRecord,
): void {
  if (input.entityType !== "buildings" || input.operation !== "create") return;
  const ownerCustomerId = entity.ownerCustomerId;
  if (ownerCustomerId === undefined || ownerCustomerId === "") return;
  if (!isSafeId(ownerCustomerId)) fail("crm_owner_customer_id_invalid");
  const customerPath = ["crmCompany", "data", "customers", ownerCustomerId] as const;
  const customerValue = readPath(root, customerPath);
  if (!isRecord(customerValue) || customerValue.id !== ownerCustomerId || isArchived(customerValue)) {
    fail(isArchived(customerValue) ? "crm_parent_archived" : "crm_parent_not_found");
  }
  const buildingIds = customerValue.buildingIds === undefined
    ? []
    : Array.isArray(customerValue.buildingIds)
      && customerValue.buildingIds.length <= 100_000
      && customerValue.buildingIds.every(isSafeId)
      ? customerValue.buildingIds
      : fail("crm_parent_invalid");
  writePath(root, customerPath, {
    ...customerValue,
    buildingIds: [...new Set([...buildingIds, input.entityId])],
  });
}

export function reduceCanonicalCrmEntityRoot(
  currentRoot: unknown,
  command: CanonicalCrmTransactionCommand,
): CanonicalCrmRootDecision {
  if (!isRecord(command) || !isRecord(command.input) || !isRecord(command.runtimeGuard)) fail("crm_transaction_invalid");
  const input = command.input;
  const receiptPath = [
    "fieldPlatform", "v2", "requestReceipts", CANONICAL_CRM_RECEIPT_SCOPE, input.requestId,
  ] as const;
  const receiptValue = readPath(currentRoot, receiptPath);
  if (receiptValue !== null) {
    const receipt = parseReceipt(receiptValue, input.requestId);
    if (!receipt) fail("crm_request_receipt_invalid");
    if (receipt.requestHash !== command.requestHash) fail("crm_request_id_conflict");
    assertCurrentActor(currentRoot, command);
    return {
      root: isRecord(currentRoot) ? currentRoot : {},
      result: Object.freeze({ ...receipt.result, repeated: true }),
      repeated: true,
    };
  }
  const currentRole = assertCurrentActor(currentRoot, command);
  if (currentRole !== "admin" && currentRole !== "member") fail("crm_mutation_forbidden");
  assertCurrentRelease(currentRoot, command);

  const entityPath = ["crmCompany", "data", input.entityType, input.entityId] as const;
  const entityValue = readPath(currentRoot, entityPath);
  const existing = isRecord(entityValue) ? entityValue : null;
  if (input.operation === "create") {
    if (entityValue !== null) fail("crm_entity_version_conflict");
  } else {
    if (!existing || existing.id !== input.entityId) fail("crm_entity_not_found");
    if (!Number.isSafeInteger(existing.entityVersion) || (existing.entityVersion as number) < 1) fail("crm_entity_upgrade_required");
    assertStoredCanonicalEntity(input.entityType, input.entityId, existing);
    if (existing.entityVersion !== input.expectedVersion) fail("crm_entity_version_conflict");
    if (input.operation === "archive" && isArchived(existing)) fail("crm_entity_already_archived");
    if (input.operation === "restore" && !isArchived(existing)) fail("crm_entity_not_archived");
    if (input.operation === "update" && isArchived(existing)) fail("crm_entity_archived");
  }
  if (existing && existing.id !== input.entityId) fail("crm_entity_invalid");
  const parentField = immutableParentField(input.entityType);
  if (existing && parentField && Object.hasOwn(input.patch, parentField) && input.patch[parentField] !== existing[parentField]) {
    fail("crm_immutable_field_forbidden");
  }
  if (
    input.entityType === "salesUnits"
    && existing
    && isSafeId(existing.crmBuildingUnitId)
    && Object.hasOwn(input.patch, "crmBuildingUnitId")
    && input.patch.crmBuildingUnitId !== existing.crmBuildingUnitId
  ) fail("crm_immutable_field_forbidden");
  const updatedAt = timestampAfter(command.now, existing?.updatedAt);
  const entityVersion = input.operation === "create" ? 1 : input.expectedVersion + 1;
  const base: UnknownRecord = input.operation === "create" ? {} : structuredClone(existing!);
  const next: UnknownRecord = {
    ...base,
    ...input.patch,
    id: input.entityId,
    entityVersion,
    ...(input.operation === "create" ? {
      createdAt: updatedAt,
      createdByAuthUid: command.actor.authUid,
      createdByOperatorId: command.actor.operatorId,
      archivedAt: "",
      archivedByAuthUid: "",
      archivedByOperatorId: "",
    } : {}),
    updatedAt,
    updatedByAuthUid: command.actor.authUid,
    updatedByOperatorId: command.actor.operatorId,
  };
  if (input.operation === "archive") {
    next.archivedAt = updatedAt;
    next.archivedByAuthUid = command.actor.authUid;
    next.archivedByOperatorId = command.actor.operatorId;
  } else if (input.operation === "restore") {
    next.archivedAt = "";
    next.archivedByAuthUid = "";
    next.archivedByOperatorId = "";
  }
  if (input.entityType === "buildingUnits"
    && ["status", "moveOutAt", "availableFrom"].some((field) => Object.hasOwn(input.patch, field))
    && next.status === "move_out_scheduled") {
    const moveOutAt = typeof next.moveOutAt === "string" ? next.moveOutAt : "";
    const availableFrom = typeof next.availableFrom === "string" ? next.availableFrom : "";
    if (!moveOutAt && !availableFrom) fail("crm_move_out_date_required");
  }
  mergePreservedExternalRefs(existing, input.patch, next);
  enforceManagedBuildingVacancyPatch(currentRoot, input, existing, next, command.actor, command.now);
  assertStoredCanonicalEntity(input.entityType, input.entityId, next);
  validateParentIntegrity(currentRoot, input, existing, next);
  const buildingMirror = input.entityType === "buildingUnits"
    ? planBuildingVacancyMirror(
      currentRoot,
      next.crmBuildingId as string,
      new Map([[input.entityId, next]]),
      command.actor,
      command.now,
    )
    : null;
  if (buildingMirror
    && (input.operation === "create" || input.operation === "restore")
    && buildingMirror.activeUnitCount > BUILDING_UNITS_BATCH_MAX_ITEMS) {
    fail("crm_building_unit_batch_too_large");
  }
  if (buildingMirror && !buildingMirror.migrationResolvedBefore) {
    if (input.operation === "create" || input.operation === "restore") {
      fail("crm_vacancy_migration_required");
    }
    const missingBefore = new Set(buildingMirror.missingLegacyBefore);
    const addedMissingLegacy = buildingMirror.missingLegacyAfter
      .some((label) => !missingBefore.has(label));
    if (addedMissingLegacy
      || buildingMirror.vacancyShortfallAfter > buildingMirror.vacancyShortfallBefore) {
      fail("crm_vacancy_migration_required");
    }
  }
  const linked = canonicalCrmEntityHasFieldLinks(currentRoot, input.entityType, input.entityId, existing);
  const resultBase = Object.freeze({
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion,
    updatedAt,
    archivedAt: typeof next.archivedAt === "string" ? next.archivedAt : "",
  });
  const receipt: CanonicalCrmReceipt = Object.freeze({
    scope: CANONICAL_CRM_RECEIPT_SCOPE,
    requestId: input.requestId,
    requestHash: command.requestHash,
    result: resultBase,
    createdAt: command.now,
  });
  const audit = makeAudit(input, command, input.operation === "create" ? 0 : input.expectedVersion, entityVersion, linked);
  const auditPath = ["fieldPlatform", "v2", "auditLogs", audit.id as string] as const;
  for (const path of [
    entityPath,
    receiptPath,
    auditPath,
    ...(buildingMirror?.migrationResolved ? [buildingMirror.path] : []),
  ]) {
    assertWritablePathParents(currentRoot, path);
  }
  const nextRoot = cloneRoot(currentRoot);
  writeOwnerBuildingBacklink(nextRoot, input, next);
  writePath(nextRoot, entityPath, Object.freeze(next));
  if (buildingMirror?.migrationResolved) {
    writePath(nextRoot, buildingMirror.path, Object.freeze(buildingMirror.entity));
  }
  writePath(nextRoot, receiptPath, receipt);
  writePath(nextRoot, auditPath, audit);
  return {
    root: nextRoot,
    result: Object.freeze({ ...resultBase, repeated: false }),
    repeated: false,
  };
}

function deterministicBuildingUnitId(buildingId: string, normalizedLabel: string): string {
  return `unit_${hashCanonical({ buildingId, normalizedLabel }).slice(0, 32)}`;
}

function makeBuildingUnitsBatchAudit(
  command: CanonicalBuildingUnitsBatchTransactionCommand,
  result: Omit<CanonicalBuildingUnitsBatchResult, "repeated">,
): Readonly<Record<string, unknown>> {
  const id = `audit_${hashCanonical({
    scope: CANONICAL_BUILDING_UNITS_BATCH_RECEIPT_SCOPE,
    requestId: command.input.requestId,
    buildingId: command.input.buildingId,
  }).slice(0, 32)}`;
  return Object.freeze({
    id,
    action: "crm.canonical.buildingUnits.configure",
    entityType: "buildingUnits",
    entityId: command.input.buildingId,
    requestId: command.input.requestId,
    authUid: command.actor.authUid,
    operatorId: command.actor.operatorId,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    unchangedCount: result.unchangedCount,
    changedFields: Object.freeze([
      "floorLabel", "floorOrder", "label", "unitOrder", "building.vacantUnitCount", "building.vacantUnits",
    ]),
    occurredAt: command.now,
  });
}

export function reduceCanonicalBuildingUnitsBatchRoot(
  currentRoot: unknown,
  command: CanonicalBuildingUnitsBatchTransactionCommand,
): CanonicalBuildingUnitsBatchRootDecision {
  if (!isRecord(command) || !isRecord(command.input) || !isRecord(command.runtimeGuard)) fail("crm_transaction_invalid");
  const input = command.input;
  const receiptPath = [
    "fieldPlatform", "v2", "requestReceipts", CANONICAL_BUILDING_UNITS_BATCH_RECEIPT_SCOPE, input.requestId,
  ] as const;
  const receiptValue = readPath(currentRoot, receiptPath);
  if (receiptValue !== null) {
    const receipt = parseBuildingUnitsBatchReceipt(receiptValue, input.requestId);
    if (!receipt) fail("crm_request_receipt_invalid");
    if (receipt.requestHash !== command.requestHash) fail("crm_request_id_conflict");
    assertCurrentActor(currentRoot, command);
    return {
      root: isRecord(currentRoot) ? currentRoot : {},
      result: Object.freeze({ ...receipt.result, repeated: true }),
      repeated: true,
    };
  }
  const currentRole = assertCurrentActor(currentRoot, command);
  if (currentRole !== "admin" && currentRole !== "member") fail("crm_mutation_forbidden");
  assertCurrentRelease(currentRoot, command);
  requireActiveParent(currentRoot, "buildings", input.buildingId);

  const collectionPath = ["crmCompany", "data", "buildingUnits"] as const;
  const rawCollection = readPath(currentRoot, collectionPath);
  if (rawCollection !== null && !isRecord(rawCollection)) fail("crm_transaction_invalid");
  const collection = isRecord(rawCollection) ? rawCollection : {};
  const activeByLabel = new Map<string, { entityId: string; entity: UnknownRecord }>();
  for (const [entityId, candidate] of Object.entries(collection)) {
    if (!isRecord(candidate)
      || candidate.crmBuildingId !== input.buildingId
      || isArchived(candidate)) continue;
    if (!Number.isSafeInteger(candidate.entityVersion) || (candidate.entityVersion as number) < 1) {
      fail("crm_entity_upgrade_required");
    }
    assertStoredCanonicalEntity("buildingUnits", entityId, candidate);
    const normalizedLabel = normalizeUnitLabel(candidate.label);
    if (!normalizedLabel) fail("crm_entity_invalid");
    if (activeByLabel.has(normalizedLabel)) fail("crm_building_unit_label_conflict");
    activeByLabel.set(normalizedLabel, { entityId, entity: candidate });
  }

  const planned: Array<{ path: readonly string[]; entity: UnknownRecord }> = [];
  const entityIds: string[] = [];
  const plannedIds = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const requested of input.units) {
    const normalizedLabel = normalizeUnitLabel(requested.label);
    const identifiesExisting = requested.entityId !== undefined && requested.expectedVersion !== undefined;
    let existing: UnknownRecord | null = null;
    let entityId: string;
    if (identifiesExisting) {
      entityId = requested.entityId as string;
      const candidate = collection[entityId];
      if (!isRecord(candidate)
        || candidate.id !== entityId
        || isArchived(candidate)
        || candidate.crmBuildingId !== input.buildingId
        || !Number.isSafeInteger(candidate.entityVersion)
        || candidate.entityVersion !== requested.expectedVersion
        || normalizeUnitLabel(candidate.label) !== normalizedLabel) {
        fail("crm_entity_version_conflict");
      }
      assertStoredCanonicalEntity("buildingUnits", entityId, candidate);
      existing = candidate;
    } else {
      if (activeByLabel.has(normalizedLabel)) fail("crm_entity_version_conflict");
      entityId = deterministicBuildingUnitId(input.buildingId, normalizedLabel);
    }
    if (!isSafeId(entityId) || plannedIds.has(entityId)) fail("crm_entity_version_conflict");
    plannedIds.add(entityId);
    entityIds.push(entityId);
    if (!existing && Object.hasOwn(collection, entityId)) fail("crm_entity_version_conflict");
    const requestedStructure = {
      label: requested.label,
      floorLabel: requested.floorLabel,
      floorOrder: requested.floorOrder,
      unitOrder: requested.unitOrder,
    };
    if (existing) {
      const changed = Object.entries(requestedStructure).some(([key, value]) => existing[key] !== value);
      if (!changed) {
        unchangedCount += 1;
        continue;
      }
      const next = {
        ...structuredClone(existing),
        ...requestedStructure,
        entityVersion: (existing.entityVersion as number) + 1,
        updatedAt: timestampAfter(command.now, existing.updatedAt),
        updatedByAuthUid: command.actor.authUid,
        updatedByOperatorId: command.actor.operatorId,
      };
      assertStoredCanonicalEntity("buildingUnits", entityId, next);
      planned.push({ path: [...collectionPath, entityId], entity: next });
      updatedCount += 1;
      continue;
    }
    if (requested.status === "move_out_scheduled") fail("crm_move_out_date_required");
    const next = {
      id: entityId,
      crmBuildingId: input.buildingId,
      ...requestedStructure,
      status: requested.status,
      moveOutAt: "",
      availableFrom: "",
      memo: "",
      entityVersion: 1,
      createdAt: command.now,
      createdByAuthUid: command.actor.authUid,
      createdByOperatorId: command.actor.operatorId,
      updatedAt: command.now,
      updatedByAuthUid: command.actor.authUid,
      updatedByOperatorId: command.actor.operatorId,
      archivedAt: "",
      archivedByAuthUid: "",
      archivedByOperatorId: "",
    };
    assertStoredCanonicalEntity("buildingUnits", entityId, next);
    planned.push({ path: [...collectionPath, entityId], entity: next });
    createdCount += 1;
  }

  const buildingMirror = planBuildingVacancyMirror(
    currentRoot,
    input.buildingId,
    new Map(planned.map((item) => [String(item.entity.id || ""), item.entity])),
    command.actor,
    command.now,
  );
  if (buildingMirror.activeUnitCount > BUILDING_UNITS_BATCH_MAX_ITEMS) {
    fail("crm_building_unit_batch_too_large");
  }
  if (!buildingMirror.migrationResolved) fail("crm_vacancy_migration_required");

  const resultBase = Object.freeze({
    buildingId: input.buildingId,
    totalUnits: input.units.length,
    createdCount,
    updatedCount,
    unchangedCount,
    entityIds: Object.freeze(entityIds.slice()),
    updatedAt: command.now,
  });
  const receipt: CanonicalBuildingUnitsBatchReceipt = Object.freeze({
    scope: CANONICAL_BUILDING_UNITS_BATCH_RECEIPT_SCOPE,
    requestId: input.requestId,
    requestHash: command.requestHash,
    result: resultBase,
    createdAt: command.now,
  });
  const audit = makeBuildingUnitsBatchAudit(command, resultBase);
  const auditPath = ["fieldPlatform", "v2", "auditLogs", audit.id as string] as const;
  for (const path of [receiptPath, auditPath, buildingMirror.path, ...planned.map((item) => item.path)]) {
    assertWritablePathParents(currentRoot, path);
  }
  const nextRoot = cloneRoot(currentRoot);
  for (const item of planned) writePath(nextRoot, item.path, Object.freeze(item.entity));
  writePath(nextRoot, buildingMirror.path, Object.freeze(buildingMirror.entity));
  writePath(nextRoot, receiptPath, receipt);
  writePath(nextRoot, auditPath, audit);
  return {
    root: nextRoot,
    result: Object.freeze({ ...resultBase, repeated: false }),
    repeated: false,
  };
}

export async function commitCanonicalCrmEntityCore(
  input: CanonicalCrmEntityInput,
  actor: FieldV2Actor,
  dependencies: CanonicalCrmDependencies,
): Promise<CanonicalCrmCommitResult> {
  if (!isRecord(actor) || !isRecord(dependencies) || typeof dependencies.now !== "function" || typeof dependencies.transact !== "function") {
    fail("crm_request_invalid");
  }
  const normalized = normalizeInput(input);
  if (normalized.operatorId !== actor.operatorId) fail("crm_operator_mismatch");
  if (actor.role !== "admin" && actor.role !== "member" && actor.role !== "viewer") fail("crm_access_forbidden");
  const authenticatedEmail = typeof dependencies.authenticatedEmail === "string"
    ? dependencies.authenticatedEmail.trim().toLowerCase()
    : "";
  if (!authenticatedEmail || Buffer.byteLength(authenticatedEmail, "utf8") > 320) fail("crm_access_forbidden");
  const now = dependencies.now();
  if (!isCanonicalTimestamp(now)) fail("crm_timestamp_invalid");
  const requestHash = hashCanonical(normalized);
  return dependencies.transact(Object.freeze({
    input: normalized,
    requestHash,
    actor: Object.freeze({ ...actor }),
    runtimeGuard: Object.freeze({
      authUid: actor.authUid,
      authenticatedEmail,
      operatorId: actor.operatorId,
      client: Object.freeze({
        protocolVersion: normalized.protocolVersion,
        clientKind: normalized.clientKind,
        buildVersion: normalized.buildVersion,
        operatorId: normalized.operatorId,
      }),
    }),
    now,
  }));
}

export async function commitCanonicalBuildingUnitsBatch(
  input: CanonicalBuildingUnitsBatchInput,
  actor: FieldV2Actor,
  dependencies: CanonicalBuildingUnitsBatchDependencies,
): Promise<CanonicalBuildingUnitsBatchResult> {
  if (!isRecord(actor)
    || !isRecord(dependencies)
    || typeof dependencies.now !== "function"
    || typeof dependencies.transact !== "function") fail("crm_request_invalid");
  const normalized = normalizeBuildingUnitsBatchInput(input);
  if (normalized.operatorId !== actor.operatorId) fail("crm_operator_mismatch");
  if (actor.role !== "admin" && actor.role !== "member" && actor.role !== "viewer") fail("crm_access_forbidden");
  const authenticatedEmail = typeof dependencies.authenticatedEmail === "string"
    ? dependencies.authenticatedEmail.trim().toLowerCase()
    : "";
  if (!authenticatedEmail || Buffer.byteLength(authenticatedEmail, "utf8") > 320) fail("crm_access_forbidden");
  const now = dependencies.now();
  if (!isCanonicalTimestamp(now)) fail("crm_timestamp_invalid");
  const requestHash = hashCanonical(normalized);
  return dependencies.transact(Object.freeze({
    input: normalized,
    requestHash,
    actor: Object.freeze({ ...actor }),
    runtimeGuard: Object.freeze({
      authUid: actor.authUid,
      authenticatedEmail,
      operatorId: actor.operatorId,
      client: Object.freeze({
        protocolVersion: normalized.protocolVersion,
        clientKind: normalized.clientKind,
        buildVersion: normalized.buildVersion,
        operatorId: normalized.operatorId,
      }),
    }),
    now,
  }));
}

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  FIELD_PROTOCOL_VERSION,
  FieldV2Error,
  isFieldRequestId,
  type FieldCrmRole,
  type FieldReleaseClient,
  type FieldReleaseConfiguration,
  type FieldV2Actor,
} from "./contracts.js";
import { assertFieldReleaseCompatible } from "./release-gate.js";

export const FIELD_OPERATOR_SWITCH_RECEIPT_SCOPE =
  "recordFieldOperatorSwitch" as const;
export const FIELD_OPERATOR_SWITCH_REASONS = Object.freeze([
  "initial_selection",
  "manual_switch",
  "desktop_navigation",
] as const);

export type FieldOperatorSwitchReason =
  typeof FIELD_OPERATOR_SWITCH_REASONS[number];

export interface RecordFieldOperatorSwitchInput {
  protocolVersion: typeof FIELD_PROTOCOL_VERSION;
  clientKind: "pwa";
  buildVersion: string;
  requestId: string;
  operatorId: string;
  fromOperatorId: string | null;
  toOperatorId: string;
  reason: FieldOperatorSwitchReason;
}

export interface RecordFieldOperatorSwitchResult {
  readonly requestId: string;
  readonly fromOperatorId: string | null;
  readonly toOperatorId: string;
  readonly reason: FieldOperatorSwitchReason;
  readonly recordedAt: string;
  readonly repeated: boolean;
}

export interface FieldOperatorSwitchRuntimeGuard {
  readonly authUid: string;
  readonly authenticatedEmail: string;
  readonly operatorId: string;
  readonly role: FieldCrmRole;
  readonly client: FieldReleaseClient;
}

export interface FieldOperatorSwitchTransactionCommand {
  readonly input: Readonly<RecordFieldOperatorSwitchInput>;
  readonly requestHash: string;
  readonly actor: Readonly<FieldV2Actor>;
  readonly runtimeGuard: FieldOperatorSwitchRuntimeGuard;
  readonly now: string;
}

export interface FieldOperatorSwitchDependencies {
  readonly authenticatedEmail: string;
  now(): string;
  transact(
    command: FieldOperatorSwitchTransactionCommand,
  ): Promise<RecordFieldOperatorSwitchResult>;
}

export interface FieldOperatorSwitchRootDecision {
  readonly root: Record<string, unknown>;
  readonly result: RecordFieldOperatorSwitchResult;
  readonly repeated: boolean;
}

interface StoredFieldOperatorSwitchResult {
  readonly requestId: string;
  readonly fromOperatorId: string | null;
  readonly toOperatorId: string;
  readonly reason: FieldOperatorSwitchReason;
  readonly recordedAt: string;
}

interface FieldOperatorSwitchReceipt {
  readonly scope: typeof FIELD_OPERATOR_SWITCH_RECEIPT_SCOPE;
  readonly requestId: string;
  readonly requestHash: string;
  readonly result: StoredFieldOperatorSwitchResult;
  readonly createdAt: string;
}

type UnknownRecord = Record<string, unknown>;

const INPUT_MAX_BYTES = 4_096;
const ID_MAX_BYTES = 128;
const BUILD_VERSION_MAX_BYTES = 64;
const EMAIL_MAX_BYTES = 320;
const DISPLAY_NAME_MAX_BYTES = 120;
const STRICT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const PATH_FORBIDDEN = /[\u0000-\u001f\u007f.#$\[\]\/]/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_SET = new Set<FieldCrmRole>(["admin", "member", "viewer"]);
const REASON_SET = new Set<string>(FIELD_OPERATOR_SWITCH_REASONS);
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const INPUT_KEYS = [
  "buildVersion",
  "clientKind",
  "fromOperatorId",
  "operatorId",
  "protocolVersion",
  "reason",
  "requestId",
  "toOperatorId",
] as const;
const RECEIPT_KEYS = [
  "createdAt", "requestHash", "requestId", "result", "scope",
] as const;
const STORED_RESULT_KEYS = [
  "fromOperatorId", "reason", "recordedAt", "requestId", "toOperatorId",
] as const;
const AUDIT_KEYS = [
  "action", "authUid", "buildVersion", "clientKind", "fromOperatorId",
  "id", "occurredAt", "reason", "requestId", "toOperatorId",
] as const;

function fail(code: string): never {
  throw new FieldV2Error(code);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return keys.length === allowed.length
    && keys.every((key, index) => key === allowed[index]);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= ID_MAX_BYTES
    && !RESERVED_KEYS.has(value)
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function operatorSwitchAuditId(
  requestId: string,
  requestHash: string,
): string {
  return `audit_${hashCanonical({
    scope: FIELD_OPERATOR_SWITCH_RECEIPT_SCOPE,
    requestId,
    requestHash,
  }).slice(0, 32)}`;
}

export function normalizeFieldOperatorSwitchInput(
  value: unknown,
): Readonly<RecordFieldOperatorSwitchInput> {
  if (!isPlainRecord(value) || !exactKeys(value, INPUT_KEYS)) {
    fail("field_operator_switch_input_invalid");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("field_operator_switch_input_invalid");
  }
  if (
    Buffer.byteLength(serialized, "utf8") > INPUT_MAX_BYTES
    || value.protocolVersion !== FIELD_PROTOCOL_VERSION
    || value.clientKind !== "pwa"
    || typeof value.buildVersion !== "string"
    || Buffer.byteLength(value.buildVersion, "utf8") > BUILD_VERSION_MAX_BYTES
    || !STRICT_VERSION_PATTERN.test(value.buildVersion)
    || !isFieldRequestId(value.requestId)
    || !isSafeId(value.operatorId)
    || !isSafeId(value.toOperatorId)
    || value.operatorId !== value.toOperatorId
    || (value.fromOperatorId !== null && !isSafeId(value.fromOperatorId))
    || typeof value.reason !== "string"
    || !REASON_SET.has(value.reason)
  ) {
    fail("field_operator_switch_input_invalid");
  }
  if (
    (value.reason === "initial_selection" && value.fromOperatorId !== null)
    || (value.reason !== "initial_selection" && value.fromOperatorId === null)
    || (value.fromOperatorId !== null && value.fromOperatorId === value.toOperatorId)
  ) {
    fail("field_operator_switch_input_invalid");
  }
  return Object.freeze({
    protocolVersion: FIELD_PROTOCOL_VERSION,
    clientKind: "pwa",
    buildVersion: value.buildVersion,
    requestId: value.requestId,
    operatorId: value.operatorId,
    fromOperatorId: value.fromOperatorId,
    toOperatorId: value.toOperatorId,
    reason: value.reason as FieldOperatorSwitchReason,
  });
}

function readPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isSafeId(segment) || !isPlainRecord(current) || !Object.hasOwn(current, segment)) {
      return null;
    }
    current = current[segment];
  }
  return current ?? null;
}

function assertWritablePathParents(root: unknown, path: readonly string[]): void {
  if (!isPlainRecord(root)) fail("field_operator_switch_storage_invalid");
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!isSafeId(segment)) fail("field_operator_switch_storage_invalid");
    if (!Object.hasOwn(current, segment) || current[segment] === null) return;
    const child = current[segment];
    if (!isPlainRecord(child)) fail("field_operator_switch_storage_invalid");
    current = child;
  }
}

function cloneRoot(root: unknown): UnknownRecord {
  if (!isPlainRecord(root)) fail("field_operator_switch_storage_invalid");
  return structuredClone(root) as UnknownRecord;
}

function writePath(root: UnknownRecord, path: readonly string[], value: unknown): void {
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!isSafeId(segment)) fail("field_operator_switch_storage_invalid");
    const child = Object.hasOwn(current, segment) ? current[segment] : null;
    if (child === null) current[segment] = Object.create(null) as UnknownRecord;
    else if (!isPlainRecord(child)) fail("field_operator_switch_storage_invalid");
    current = current[segment] as UnknownRecord;
  }
  const leaf = path[path.length - 1];
  if (!isSafeId(leaf)) fail("field_operator_switch_storage_invalid");
  current[leaf] = value;
}

function parseProfile(value: unknown): { active: boolean; displayName: string } | null {
  if (!isPlainRecord(value) || typeof value.active !== "boolean") return null;
  const displayName = typeof value.displayName === "string"
    ? value.displayName.trim()
    : "";
  if (
    displayName.length === 0
    || displayName !== value.displayName
    || Buffer.byteLength(displayName, "utf8") > DISPLAY_NAME_MAX_BYTES
    || CONTROL_CHARACTERS.test(displayName)
  ) return null;
  return { active: value.active, displayName };
}

function assertCurrentAccessAndProfiles(
  root: unknown,
  command: FieldOperatorSwitchTransactionCommand,
): void {
  const { input, runtimeGuard } = command;
  const access = readPath(root, ["crmCompany", "access", runtimeGuard.authUid]);
  if (
    !isPlainRecord(access)
    || access.enabled !== true
    || typeof access.role !== "string"
    || !ROLE_SET.has(access.role as FieldCrmRole)
    || access.role !== runtimeGuard.role
    || typeof access.email !== "string"
    || access.email.trim().toLowerCase() !== runtimeGuard.authenticatedEmail
  ) fail("field_access_forbidden");

  const targetValue = readPath(root, [
    "crmCompany", "teamProfiles", input.toOperatorId,
  ]);
  const target = parseProfile(targetValue);
  if (!target) fail("field_operator_invalid");
  if (!target.active) fail("field_operator_inactive");

  if (input.fromOperatorId !== null) {
    const previous = parseProfile(readPath(root, [
      "crmCompany", "teamProfiles", input.fromOperatorId,
    ]));
    if (!previous || !previous.active) {
      fail("field_operator_switch_previous_invalid");
    }
  }
}

function assertCurrentRelease(
  root: unknown,
  command: FieldOperatorSwitchTransactionCommand,
  allowReceiptReplay: boolean,
): void {
  const release = readPath(root, ["fieldPlatform", "v2", "config", "release"]);
  assertFieldReleaseCompatible(
    release as FieldReleaseConfiguration,
    command.runtimeGuard.client,
  );
  if (allowReceiptReplay) return;
  const config = release as FieldReleaseConfiguration;
  if (config.safeMode) fail("field_safe_mode_read_only");
  if (!config.v2WritesEnabled) fail("field_v2_writes_disabled");
}

function parseStoredResult(
  value: unknown,
  requestId: string,
): StoredFieldOperatorSwitchResult | null {
  if (
    !isPlainRecord(value)
    || !exactKeys(value, STORED_RESULT_KEYS)
    || value.requestId !== requestId
    || (value.fromOperatorId !== null && !isSafeId(value.fromOperatorId))
    || !isSafeId(value.toOperatorId)
    || typeof value.reason !== "string"
    || !REASON_SET.has(value.reason)
    || !isCanonicalTimestamp(value.recordedAt)
  ) return null;
  if (
    (value.reason === "initial_selection" && value.fromOperatorId !== null)
    || (value.reason !== "initial_selection" && value.fromOperatorId === null)
    || (value.fromOperatorId !== null && value.fromOperatorId === value.toOperatorId)
  ) return null;
  return value as unknown as StoredFieldOperatorSwitchResult;
}

function parseReceipt(
  value: unknown,
  requestId: string,
): FieldOperatorSwitchReceipt | null {
  if (
    !isPlainRecord(value)
    || !exactKeys(value, RECEIPT_KEYS)
    || value.scope !== FIELD_OPERATOR_SWITCH_RECEIPT_SCOPE
    || value.requestId !== requestId
    || typeof value.requestHash !== "string"
    || !HASH_PATTERN.test(value.requestHash)
    || !isCanonicalTimestamp(value.createdAt)
  ) return null;
  const result = parseStoredResult(value.result, requestId);
  return result && value.createdAt === result.recordedAt
    ? value as unknown as FieldOperatorSwitchReceipt
    : null;
}

function isPairedAuditValid(
  value: unknown,
  auditId: string,
  command: FieldOperatorSwitchTransactionCommand,
  receipt: FieldOperatorSwitchReceipt,
): boolean {
  const { input, runtimeGuard } = command;
  return isPlainRecord(value)
    && exactKeys(value, AUDIT_KEYS)
    && value.id === auditId
    && value.action === "field.operator.switched"
    && value.requestId === input.requestId
    && value.authUid === runtimeGuard.authUid
    && value.fromOperatorId === input.fromOperatorId
    && value.toOperatorId === input.toOperatorId
    && value.reason === input.reason
    && value.clientKind === input.clientKind
    && value.buildVersion === input.buildVersion
    && value.occurredAt === receipt.result.recordedAt
    && isCanonicalTimestamp(value.occurredAt);
}

function storedResult(
  input: Readonly<RecordFieldOperatorSwitchInput>,
  recordedAt: string,
): Readonly<StoredFieldOperatorSwitchResult> {
  return Object.freeze({
    requestId: input.requestId,
    fromOperatorId: input.fromOperatorId,
    toOperatorId: input.toOperatorId,
    reason: input.reason,
    recordedAt,
  });
}

export function reduceFieldOperatorSwitchRoot(
  currentRoot: unknown,
  command: FieldOperatorSwitchTransactionCommand,
): FieldOperatorSwitchRootDecision {
  let derivedRequestHash: string | null = null;
  try {
    derivedRequestHash = hashCanonical(
      normalizeFieldOperatorSwitchInput(command?.input),
    );
  } catch {
    derivedRequestHash = null;
  }
  if (
    !isPlainRecord(command)
    || !isPlainRecord(command.input)
    || !isPlainRecord(command.actor)
    || !isPlainRecord(command.runtimeGuard)
    || !HASH_PATTERN.test(command.requestHash)
    || derivedRequestHash !== command.requestHash
    || !isCanonicalTimestamp(command.now)
    || command.actor.authUid !== command.runtimeGuard.authUid
    || command.actor.operatorId !== command.input.toOperatorId
    || command.actor.role !== command.runtimeGuard.role
    || command.runtimeGuard.operatorId !== command.input.toOperatorId
    || !isPlainRecord(command.runtimeGuard.client)
    || command.runtimeGuard.client.protocolVersion !== command.input.protocolVersion
    || command.runtimeGuard.client.clientKind !== command.input.clientKind
    || command.runtimeGuard.client.buildVersion !== command.input.buildVersion
    || command.runtimeGuard.client.operatorId !== command.input.toOperatorId
  ) fail("field_operator_switch_transaction_invalid");
  const { input } = command;
  const receiptPath = [
    "fieldPlatform", "v2", "requestReceipts",
    FIELD_OPERATOR_SWITCH_RECEIPT_SCOPE, input.requestId,
  ] as const;
  const receiptValue = readPath(currentRoot, receiptPath);
  if (receiptValue !== null) {
    const receipt = parseReceipt(receiptValue, input.requestId);
    if (!receipt) fail("field_request_receipt_invalid");
    if (receipt.requestHash !== command.requestHash) {
      fail("field_request_id_conflict");
    }
    const auditId = operatorSwitchAuditId(input.requestId, command.requestHash);
    const auditValue = readPath(currentRoot, [
      "fieldPlatform", "v2", "auditLogs", auditId,
    ]);
    if (!isPairedAuditValid(auditValue, auditId, command, receipt)) {
      fail("field_operator_switch_storage_invalid");
    }
    assertCurrentAccessAndProfiles(currentRoot, command);
    // Exact receipts stay readable in safe mode, but the current client,
    // access, target, previous profile, and release still have to be valid.
    assertCurrentRelease(currentRoot, command, true);
    return {
      root: isPlainRecord(currentRoot) ? currentRoot : {},
      result: Object.freeze({ ...receipt.result, repeated: true }),
      repeated: true,
    };
  }

  assertCurrentAccessAndProfiles(currentRoot, command);
  assertCurrentRelease(currentRoot, command, false);

  const result = storedResult(input, command.now);
  const receipt: Readonly<FieldOperatorSwitchReceipt> = Object.freeze({
    scope: FIELD_OPERATOR_SWITCH_RECEIPT_SCOPE,
    requestId: input.requestId,
    requestHash: command.requestHash,
    result,
    createdAt: command.now,
  });
  const auditId = operatorSwitchAuditId(input.requestId, command.requestHash);
  const audit = Object.freeze({
    id: auditId,
    action: "field.operator.switched",
    requestId: input.requestId,
    authUid: command.runtimeGuard.authUid,
    fromOperatorId: input.fromOperatorId,
    toOperatorId: input.toOperatorId,
    reason: input.reason,
    clientKind: input.clientKind,
    buildVersion: input.buildVersion,
    occurredAt: command.now,
  });
  const auditPath = [
    "fieldPlatform", "v2", "auditLogs", auditId,
  ] as const;
  for (const path of [receiptPath, auditPath]) {
    assertWritablePathParents(currentRoot, path);
  }
  if (readPath(currentRoot, auditPath) !== null) {
    fail("field_operator_switch_storage_invalid");
  }

  const nextRoot = cloneRoot(currentRoot);
  // This transaction intentionally writes only the immutable audit and its
  // idempotency receipt. It does not create operator identity or CRM state.
  writePath(nextRoot, receiptPath, receipt);
  writePath(nextRoot, auditPath, audit);
  return {
    root: nextRoot,
    result: Object.freeze({ ...result, repeated: false }),
    repeated: false,
  };
}

function validateActor(actor: unknown, operatorId: string): asserts actor is FieldV2Actor {
  if (
    !isPlainRecord(actor)
    || !isSafeId(actor.authUid)
    || actor.operatorId !== operatorId
    || !isSafeId(actor.operatorId)
    || typeof actor.displayName !== "string"
    || actor.displayName.length === 0
    || actor.displayName !== actor.displayName.trim()
    || Buffer.byteLength(actor.displayName, "utf8") > DISPLAY_NAME_MAX_BYTES
    || CONTROL_CHARACTERS.test(actor.displayName)
    || typeof actor.role !== "string"
    || !ROLE_SET.has(actor.role as FieldCrmRole)
  ) fail("field_access_forbidden");
}

function validateResult(
  value: unknown,
  input: Readonly<RecordFieldOperatorSwitchInput>,
): RecordFieldOperatorSwitchResult {
  if (
    !isPlainRecord(value)
    || !exactKeys(value, [...STORED_RESULT_KEYS, "repeated"])
    || value.requestId !== input.requestId
    || value.fromOperatorId !== input.fromOperatorId
    || value.toOperatorId !== input.toOperatorId
    || value.reason !== input.reason
    || !isCanonicalTimestamp(value.recordedAt)
    || typeof value.repeated !== "boolean"
  ) fail("field_operator_switch_transaction_failed");
  return value as unknown as RecordFieldOperatorSwitchResult;
}

export async function recordFieldOperatorSwitchCore(
  input: RecordFieldOperatorSwitchInput,
  actor: FieldV2Actor,
  dependencies: FieldOperatorSwitchDependencies,
): Promise<RecordFieldOperatorSwitchResult> {
  const normalized = normalizeFieldOperatorSwitchInput(input);
  validateActor(actor, normalized.toOperatorId);
  if (
    !isPlainRecord(dependencies)
    || typeof dependencies.now !== "function"
    || typeof dependencies.transact !== "function"
  ) fail("field_operator_switch_input_invalid");
  const authenticatedEmail = typeof dependencies.authenticatedEmail === "string"
    ? dependencies.authenticatedEmail.trim().toLowerCase()
    : "";
  if (
    authenticatedEmail.length === 0
    || Buffer.byteLength(authenticatedEmail, "utf8") > EMAIL_MAX_BYTES
    || CONTROL_CHARACTERS.test(authenticatedEmail)
  ) fail("field_access_forbidden");
  const now = dependencies.now();
  if (!isCanonicalTimestamp(now)) fail("field_operator_switch_timestamp_invalid");
  const command: FieldOperatorSwitchTransactionCommand = Object.freeze({
    input: normalized,
    requestHash: hashCanonical(normalized),
    actor: Object.freeze({ ...actor }),
    runtimeGuard: Object.freeze({
      authUid: actor.authUid,
      authenticatedEmail,
      operatorId: normalized.toOperatorId,
      role: actor.role,
      client: Object.freeze({
        protocolVersion: normalized.protocolVersion,
        clientKind: normalized.clientKind,
        buildVersion: normalized.buildVersion,
        operatorId: normalized.toOperatorId,
      }),
    }),
    now,
  });
  let result: unknown;
  try {
    result = await dependencies.transact(command);
  } catch (error) {
    if (error instanceof FieldV2Error) throw error;
    fail("field_operator_switch_transaction_failed");
  }
  return validateResult(result, normalized);
}

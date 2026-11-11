import { Buffer } from "node:buffer";

import {
  FIELD_PROTOCOL_VERSION,
  FieldV2Error,
  isFieldRequestId,
  type FieldReleaseClient,
  type FieldReleaseConfiguration,
  type FieldReleaseOperation,
} from "./contracts.js";

const STRICT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const OPERATOR_ID_PATTERN = /^[^.#$\[\]/\u0000-\u001f\u007f]+$/u;
const RECEIPT_SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const RECOVERABLE_UPLOAD_STATUSES = new Set([
  "queued",
  "uploading",
  "partial_failure",
  "failed",
]);
const MUTATION_KINDS = new Set([
  "createJob",
  "claimJob",
  "assignJob",
  "changeVisit",
  "transitionJob",
  "operatorSwitch",
  "startCapture",
  "finalizeMedia",
  "reviewEvidence",
  "createAdPackage",
  "canonicalCrmWrite",
]);

export interface FieldReleaseGateDependencies {
  readReceipt(input: { scope: string; requestId: string }): Promise<unknown>;
  readUploadRecovery(uploadJobId: string): Promise<unknown>;
}

function parseVersion(value: unknown, errorCode: string): readonly [number, number, number] {
  if (typeof value !== "string") throw new FieldV2Error(errorCode);
  const match = STRICT_VERSION_PATTERN.exec(value);
  if (!match) throw new FieldV2Error(errorCode);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new FieldV2Error(errorCode);
  }
  return parts as unknown as readonly [number, number, number];
}

function compareParsedVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function compareFieldBuildVersions(left: string, right: string): number {
  return compareParsedVersions(
    parseVersion(left, "field_build_version_invalid"),
    parseVersion(right, "field_build_version_invalid"),
  );
}

function isValidOperatorId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 128
    && OPERATOR_ID_PATTERN.test(value);
}

function isCanonicalTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function assertReleaseConfiguration(
  config: FieldReleaseConfiguration,
): void {
  if (
    !isRecord(config)
    || config.protocolVersion !== FIELD_PROTOCOL_VERSION
    || typeof config.v2WritesEnabled !== "boolean"
    || typeof config.canonicalCrmEnabled !== "boolean"
    || typeof config.safeMode !== "boolean"
    || !Array.isArray(config.enabledOperatorIds)
    || !config.enabledOperatorIds.every(isValidOperatorId)
    || new Set(config.enabledOperatorIds).size !== config.enabledOperatorIds.length
    || (config.cutoverAt !== null
      && (typeof config.cutoverAt !== "string" || !isCanonicalTimestamp(config.cutoverAt)))
  ) {
    throw new FieldV2Error("field_release_config_invalid");
  }

  let minimumDesktop: readonly [number, number, number];
  let maximumDesktop: readonly [number, number, number] | undefined;
  try {
    minimumDesktop = parseVersion(config.minDesktopVersion, "field_release_config_invalid");
    parseVersion(config.minPwaVersion, "field_release_config_invalid");
    maximumDesktop = config.maxDesktopVersion === undefined
      ? undefined
      : parseVersion(config.maxDesktopVersion, "field_release_config_invalid");
  } catch {
    throw new FieldV2Error("field_release_config_invalid");
  }
  if (
    maximumDesktop
    && compareParsedVersions(maximumDesktop, minimumDesktop) < 0
  ) {
    throw new FieldV2Error("field_release_config_invalid");
  }
}

export function assertFieldReleaseCompatible(
  config: FieldReleaseConfiguration,
  client: FieldReleaseClient,
): { compatible: true } {
  assertReleaseConfiguration(config);
  if (!isRecord(client)) {
    throw new FieldV2Error("field_client_invalid");
  }
  if (client.protocolVersion !== config.protocolVersion) {
    throw new FieldV2Error("field_protocol_mismatch");
  }
  if (client.clientKind !== "desktop" && client.clientKind !== "pwa") {
    throw new FieldV2Error("field_client_kind_invalid");
  }
  if (!isValidOperatorId(client.operatorId)) {
    throw new FieldV2Error("field_operator_not_enabled");
  }

  const build = parseVersion(client.buildVersion, "field_build_version_invalid");
  const minimum = parseVersion(
    client.clientKind === "desktop"
      ? config.minDesktopVersion
      : config.minPwaVersion,
    "field_release_config_invalid",
  );
  if (compareParsedVersions(build, minimum) < 0) {
    throw new FieldV2Error("field_client_upgrade_required");
  }
  if (client.clientKind === "desktop" && config.maxDesktopVersion) {
    const maximum = parseVersion(
      config.maxDesktopVersion,
      "field_release_config_invalid",
    );
    if (compareParsedVersions(build, maximum) > 0) {
      throw new FieldV2Error("field_client_version_unsupported");
    }
  }
  if (!config.enabledOperatorIds.includes(client.operatorId)) {
    throw new FieldV2Error("field_operator_not_enabled");
  }
  return { compatible: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLookupKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 128
    && OPERATOR_ID_PATTERN.test(value);
}

async function assertExactReceiptReplay(
  operation: unknown,
  dependencies: FieldReleaseGateDependencies | null | undefined,
): Promise<void> {
  if (!isRecord(operation) || operation.kind !== "receiptReplay") {
    throw new FieldV2Error("field_receipt_replay_invalid");
  }
  if (
    typeof operation.scope !== "string"
    || !RECEIPT_SCOPE_PATTERN.test(operation.scope)
    || !isFieldRequestId(operation.requestId)
    || typeof operation.requestHash !== "string"
    || !SHA_256_PATTERN.test(operation.requestHash)
    || !isRecord(dependencies)
    || typeof dependencies.readReceipt !== "function"
  ) {
    throw new FieldV2Error("field_receipt_replay_invalid");
  }
  let receipt: unknown;
  try {
    receipt = await dependencies.readReceipt({
      scope: operation.scope,
      requestId: operation.requestId,
    });
  } catch {
    throw new FieldV2Error("field_receipt_replay_invalid");
  }
  if (
    !isRecord(receipt)
    || receipt.scope !== operation.scope
    || receipt.requestId !== operation.requestId
    || receipt.requestHash !== operation.requestHash
  ) {
    throw new FieldV2Error("field_receipt_replay_invalid");
  }
}

async function assertUploadRecovery(
  operation: unknown,
  dependencies: FieldReleaseGateDependencies | null | undefined,
): Promise<void> {
  if (
    !isRecord(operation)
    || operation.kind !== "uploadRecovery"
    || !isFieldRequestId(operation.requestId)
    || !isLookupKey(operation.uploadJobId)
    || !isRecord(dependencies)
    || typeof dependencies.readUploadRecovery !== "function"
  ) {
    throw new FieldV2Error("field_upload_recovery_invalid");
  }
  let uploadJob: unknown;
  try {
    uploadJob = await dependencies.readUploadRecovery(operation.uploadJobId);
  } catch {
    throw new FieldV2Error("field_upload_recovery_invalid");
  }
  if (
    !isRecord(uploadJob)
    || uploadJob.uploadJobId !== operation.uploadJobId
    || uploadJob.requestId !== operation.requestId
    || typeof uploadJob.status !== "string"
    || !RECOVERABLE_UPLOAD_STATUSES.has(uploadJob.status)
  ) {
    throw new FieldV2Error("field_upload_recovery_invalid");
  }
}

export async function assertFieldReleaseAllows(
  config: FieldReleaseConfiguration,
  operation: FieldReleaseOperation,
  dependencies?: FieldReleaseGateDependencies | null,
): Promise<{ allowed: true }> {
  assertReleaseConfiguration(config);
  if (!isRecord(operation)) {
    throw new FieldV2Error("field_release_operation_invalid");
  }
  if (operation.kind === "read") return { allowed: true };

  if (operation.kind === "receiptReplay") {
    await assertExactReceiptReplay(operation, dependencies);
    return { allowed: true };
  }

  if (operation.kind === "uploadRecovery") {
    await assertUploadRecovery(operation, dependencies);
    return { allowed: true };
  }

  if (
    !isFieldRequestId(operation.requestId)
    || typeof operation.kind !== "string"
    || !MUTATION_KINDS.has(operation.kind)
  ) {
    throw new FieldV2Error("field_release_operation_invalid");
  }
  if (config.safeMode) throw new FieldV2Error("field_safe_mode_read_only");
  if (!config.v2WritesEnabled) throw new FieldV2Error("field_v2_writes_disabled");
  if (operation.kind === "canonicalCrmWrite" && !config.canonicalCrmEnabled) {
    throw new FieldV2Error("field_canonical_crm_disabled");
  }
  return { allowed: true };
}

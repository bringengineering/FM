import { Buffer } from "node:buffer";

import {
  FIELD_PROTOCOL_VERSION,
  isFieldRequestId,
  type FieldReleaseClient,
  type FieldReleaseConfiguration,
  type FieldReleaseOperation,
} from "./contracts.js";

const STRICT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const OPERATOR_ID_PATTERN = /^[^.#$\[\]/\u0000-\u001f\u007f]+$/u;
const MUTATION_KINDS = new Set([
  "createJob",
  "claimJob",
  "assignJob",
  "changeVisit",
  "transitionJob",
  "startCapture",
  "finalizeMedia",
  "reviewEvidence",
  "createAdPackage",
  "canonicalCrmWrite",
]);

function parseVersion(value: unknown, errorCode: string): readonly [number, number, number] {
  if (typeof value !== "string") throw new Error(errorCode);
  const match = STRICT_VERSION_PATTERN.exec(value);
  if (!match) throw new Error(errorCode);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(errorCode);
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
    !config
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
    throw new Error("field_release_config_invalid");
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
    throw new Error("field_release_config_invalid");
  }
  if (
    maximumDesktop
    && compareParsedVersions(maximumDesktop, minimumDesktop) < 0
  ) {
    throw new Error("field_release_config_invalid");
  }
}

export function assertFieldReleaseCompatible(
  config: FieldReleaseConfiguration,
  client: FieldReleaseClient,
): { compatible: true } {
  assertReleaseConfiguration(config);
  if (client.protocolVersion !== config.protocolVersion) {
    throw new Error("field_protocol_mismatch");
  }
  if (client.clientKind !== "desktop" && client.clientKind !== "pwa") {
    throw new Error("field_client_kind_invalid");
  }
  if (!isValidOperatorId(client.operatorId)) {
    throw new Error("field_operator_not_enabled");
  }

  const build = parseVersion(client.buildVersion, "field_build_version_invalid");
  const minimum = parseVersion(
    client.clientKind === "desktop"
      ? config.minDesktopVersion
      : config.minPwaVersion,
    "field_release_config_invalid",
  );
  if (compareParsedVersions(build, minimum) < 0) {
    throw new Error("field_client_upgrade_required");
  }
  if (client.clientKind === "desktop" && config.maxDesktopVersion) {
    const maximum = parseVersion(
      config.maxDesktopVersion,
      "field_release_config_invalid",
    );
    if (compareParsedVersions(build, maximum) > 0) {
      throw new Error("field_client_version_unsupported");
    }
  }
  if (!config.enabledOperatorIds.includes(client.operatorId)) {
    throw new Error("field_operator_not_enabled");
  }
  return { compatible: true };
}

function isRecoveryOperation(kind: string): boolean {
  return kind === "receiptReplay" || kind === "uploadRecovery";
}

export function assertFieldReleaseAllows(
  config: FieldReleaseConfiguration,
  operation: FieldReleaseOperation,
): { allowed: true } {
  assertReleaseConfiguration(config);
  if (!operation || typeof operation !== "object") {
    throw new Error("field_release_operation_invalid");
  }
  if (operation.kind === "read") return { allowed: true };

  if (
    !isFieldRequestId(operation.requestId)
    || (!isRecoveryOperation(operation.kind) && !MUTATION_KINDS.has(operation.kind))
  ) {
    throw new Error("field_release_operation_invalid");
  }
  if (isRecoveryOperation(operation.kind)) return { allowed: true };
  if (config.safeMode) throw new Error("field_safe_mode_read_only");
  if (!config.v2WritesEnabled) throw new Error("field_v2_writes_disabled");
  if (operation.kind === "canonicalCrmWrite" && !config.canonicalCrmEnabled) {
    throw new Error("field_canonical_crm_disabled");
  }
  return { allowed: true };
}

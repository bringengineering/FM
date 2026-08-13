import { Buffer } from "node:buffer";

export const FIELD_PROTOCOL_VERSION = 2 as const;
export const FIELD_V2_ROOT = "fieldPlatform/v2" as const;
export const FIELD_COMMAND_MAX_BYTES = 32_768 as const;

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

export type FieldJobType = typeof FIELD_JOB_TYPES[number];
export type FieldWorkflowStatus = typeof FIELD_WORKFLOW_STATUSES[number];
export type FieldUploadStatus = typeof FIELD_UPLOAD_STATUSES[number];
export type FieldCrmRole = "admin" | "member" | "viewer";

/**
 * The operator ID identifies which teammate is doing the work while the team
 * shares one company Firebase account. It is an operational label, not an
 * authentication credential or proof of an individual identity.
 */
export interface FieldV2Actor {
  authUid: string;
  operatorId: string;
  displayName: string;
  role: FieldCrmRole;
}

export interface FieldCommandEnvelope<
  Payload extends Record<string, unknown> = Record<string, unknown>,
> {
  protocolVersion: typeof FIELD_PROTOCOL_VERSION;
  type: "field.command";
  requestId: string;
  payload: Payload;
}

export interface FieldReleaseConfiguration {
  protocolVersion: number;
  minDesktopVersion: string;
  maxDesktopVersion?: string;
  minPwaVersion: string;
  enabledOperatorIds: readonly string[];
  v2WritesEnabled: boolean;
  canonicalCrmEnabled: boolean;
  safeMode: boolean;
  cutoverAt: string | null;
}

export interface FieldReleaseClient {
  protocolVersion: number;
  clientKind: "desktop" | "pwa";
  buildVersion: string;
  operatorId: string;
}

export type FieldMutationOperationKind =
  | "createJob"
  | "claimJob"
  | "assignJob"
  | "changeVisit"
  | "transitionJob"
  | "startCapture"
  | "finalizeMedia"
  | "reviewEvidence"
  | "createAdPackage"
  | "canonicalCrmWrite";

/**
 * `receiptReplay` is constructed only after the orchestration layer has found
 * a receipt whose request ID and immutable request fingerprint both match.
 * The release gate deliberately does not query persistence itself.
 */
export type FieldReleaseOperation =
  | { kind: "read" }
  | { kind: "receiptReplay"; requestId: string }
  | { kind: "uploadRecovery"; requestId: string }
  | { kind: FieldMutationOperationKind; requestId: string };

const RFC_4122_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ENVELOPE_KEYS = ["payload", "protocolVersion", "requestId", "type"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFieldRequestId(value: unknown): value is string {
  return typeof value === "string" && RFC_4122_UUID_PATTERN.test(value);
}

export function assertFieldCommandEnvelope(
  value: unknown,
): FieldCommandEnvelope {
  if (!isRecord(value)) throw new Error("field_protocol_invalid");
  const keys = Object.keys(value).sort();
  if (
    keys.length !== ENVELOPE_KEYS.length
    || keys.some((key, index) => key !== ENVELOPE_KEYS[index])
    || value.protocolVersion !== FIELD_PROTOCOL_VERSION
    || value.type !== "field.command"
    || !isFieldRequestId(value.requestId)
    || !isRecord(value.payload)
  ) {
    throw new Error("field_protocol_invalid");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("field_protocol_invalid");
  }
  if (Buffer.byteLength(serialized, "utf8") > FIELD_COMMAND_MAX_BYTES) {
    throw new Error("field_protocol_invalid");
  }
  return value as unknown as FieldCommandEnvelope;
}

import { httpsCallable } from "firebase/functions";

import { ensureFieldAppCheckToken, functions } from "../firebase.client";
import {
  FIELD_BUILD_VERSION,
  FIELD_PROTOCOL_VERSION,
  fieldUtf8Bytes,
  isFieldRequestId,
  isPlainFieldRecord,
  isSafeFieldId,
  isSafeFieldValue,
  parseFieldOperationsWorkspace,
  verifyFieldOperationsWorkspaceIntegrity,
  fieldWorkspaceItemId,
  type FieldOperationsWorkspace,
  type FieldWorkspaceItem,
  type FieldWorkspaceScope,
} from "./contracts";

export type FieldCallable = (
  name: string,
  payload: Record<string, unknown>,
) => Promise<{ data: unknown }>;

export type FieldMutationCommand =
  | "createJob"
  | "claimJob"
  | "assignJob"
  | "changeVisit"
  | "transitionStatus";

export type FieldDesktopCommand =
  | Exclude<FieldMutationCommand, "createJob">
  | "openCreateJob"
  | "reviewJob";

export const FIELD_COMMAND_CALLABLES = Object.freeze({
  createJob: "createFieldJobs",
  claimJob: "claimFieldJob",
  assignJob: "assignFieldJob",
  changeVisit: "changeFieldVisit",
  transitionStatus: "transitionFieldJob",
} satisfies Record<FieldMutationCommand, string>);

const BLOCKED_ARGUMENT_KEYS = new Set([
  "authUid", "email", "token", "idToken", "appCheckToken", "operatorId",
  "protocolVersion", "clientKind", "buildVersion", "requestId",
]);

const FIELD_SESSION_ERROR_CODES = new Set([
  "functions/unauthenticated",
  "unauthenticated",
  "auth/id-token-expired",
  "auth/user-token-expired",
  "app-check/token-error",
]);

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "";
}

function sessionUnavailableError(): Error & { code: "FIELD_SESSION_UNAVAILABLE" } {
  return Object.assign(new Error("field_session_unavailable"), {
    code: "FIELD_SESSION_UNAVAILABLE" as const,
  });
}

async function firebaseCallable(name: string, payload: Record<string, unknown>) {
  const call = httpsCallable<Record<string, unknown>, unknown>(functions, name);
  return call(payload);
}

function safeCommandArgs(value: unknown): asserts value is Record<string, unknown> {
  if (
    !isPlainFieldRecord(value)
    || !isSafeFieldValue(value)
    || fieldUtf8Bytes(value) > 24_000
    || Object.keys(value).some((key) => BLOCKED_ARGUMENT_KEYS.has(key))
  ) throw new Error("field_command_invalid");
}

export interface CreateFieldV2ApiOptions {
  callable?: FieldCallable;
  verifyAppCheck?: () => Promise<void>;
  operatorId: string;
  embedded?: boolean;
  requestId?: () => string;
}

export interface LoadFieldWorkspaceOptions {
  scope?: FieldWorkspaceScope;
  limit?: number;
  cursor?: string;
}

export interface RunFieldCommandOptions {
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}

export function createFieldV2Api({
  callable = firebaseCallable,
  verifyAppCheck = callable === firebaseCallable ? ensureFieldAppCheckToken : async () => undefined,
  operatorId,
  requestId = () => crypto.randomUUID(),
}: CreateFieldV2ApiOptions) {
  if (!isSafeFieldId(operatorId)) throw new Error("field_operator_invalid");

  const base = Object.freeze({
    protocolVersion: FIELD_PROTOCOL_VERSION,
    clientKind: "pwa" as const,
    buildVersion: FIELD_BUILD_VERSION,
    operatorId,
  });

  async function invoke(
    name: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw new DOMException("Field request cancelled", "AbortError");
    try {
      await verifyAppCheck();
    } catch {
      throw sessionUnavailableError();
    }
    if (signal?.aborted) throw new DOMException("Field request cancelled", "AbortError");
    let response: Awaited<ReturnType<FieldCallable>>;
    try {
      response = await callable(name, payload);
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Field request cancelled", "AbortError");
      if (FIELD_SESSION_ERROR_CODES.has(errorCode(error))) throw sessionUnavailableError();
      throw error;
    }
    if (signal?.aborted) throw new DOMException("Field request cancelled", "AbortError");
    if (!isPlainFieldRecord(response) || !Object.hasOwn(response, "data")) {
      throw new Error("field_response_invalid");
    }
    return response.data;
  }

  async function loadWorkspace(options: LoadFieldWorkspaceOptions = {}): Promise<FieldOperationsWorkspace> {
    const scope = options.scope ?? "personal";
    if (scope !== "personal" && scope !== "team") throw new Error("field_workspace_scope_invalid");
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("field_workspace_limit_invalid");
    const cursor = options.cursor;
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 512)) {
      throw new Error("field_workspace_cursor_invalid");
    }
    const raw = await invoke("listFieldOperationsWorkspace", {
      ...base,
      scope,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const workspace = await verifyFieldOperationsWorkspaceIntegrity(parseFieldOperationsWorkspace(raw));
    if (workspace.scope !== scope) throw new Error("field_workspace_invalid");
    return workspace;
  }

  async function runCommand(
    command: FieldMutationCommand,
    args: unknown,
    options: RunFieldCommandOptions = {},
  ): Promise<unknown> {
    const callableName = FIELD_COMMAND_CALLABLES[command];
    if (!callableName) throw new Error("field_command_invalid");
    safeCommandArgs(args);
    const nextRequestId = options.requestId ?? requestId();
    if (!isFieldRequestId(nextRequestId)) throw new Error("field_request_id_invalid");
    return invoke(callableName, {
      ...base,
      requestId: nextRequestId,
      ...args,
    }, options.signal);
  }

  return Object.freeze({ loadWorkspace, runCommand });
}

export type FieldV2Api = ReturnType<typeof createFieldV2Api>;

/**
 * A later page is newer server state. Duplicate job IDs keep their original
 * position but are replaced by the later row; genuinely new jobs append.
 */
export function mergeFieldWorkspaceItems(
  current: readonly FieldWorkspaceItem[],
  next: readonly FieldWorkspaceItem[],
): readonly FieldWorkspaceItem[] {
  const merged = [...current];
  const positions = new Map(merged.map((item, index) => [fieldWorkspaceItemId(item), index]));
  for (const item of next) {
    const id = fieldWorkspaceItemId(item);
    if (!isSafeFieldId(id)) throw new Error("field_workspace_invalid");
    const index = positions.get(id);
    if (index === undefined) {
      positions.set(id, merged.length);
      merged.push(item);
    } else {
      merged[index] = item;
    }
  }
  return Object.freeze(merged);
}

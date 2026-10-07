import {
  FIELD_BRIDGE_TIMEOUT_MS,
  FIELD_BUILD_VERSION,
  FIELD_MAX_BRIDGE_BYTES,
  FIELD_ORIGIN,
  FIELD_PROTOCOL_VERSION,
  fieldUtf8Bytes,
  isFieldRequestId,
  isPlainFieldRecord,
  isSafeFieldId,
  isSafeFieldValue,
  parsePersonalFieldWorkspaceItem,
} from "./contracts";
import type { FieldDesktopCommand } from "./field-v2-api.client";

export type FieldToCrmType =
  | "field.ready"
  | "field.routeChanged"
  | "field.pendingUploads"
  | "field.openCrmEntity"
  | "field.openExternal"
  | "field.ack"
  | "field.commandResult"
  | "field.logoutDecision";
export type CrmToFieldType =
  | "field.navigate"
  | "field.command"
  | "field.cancel"
  | "crm.logoutCheck";
export type FieldBridgeType = FieldToCrmType | CrmToFieldType;

export type FieldLocalCommand = "openCreateJob" | "reviewJob";
export type FieldBridgeMutationCommand = "claimJob" | "assignJob" | "changeVisit" | "transitionStatus";
export type FieldBridgeCommand = FieldLocalCommand | FieldBridgeMutationCommand;

export interface FieldBridgeEnvelope {
  readonly protocolVersion: typeof FIELD_PROTOCOL_VERSION;
  readonly type: FieldBridgeType;
  readonly requestId: string;
  readonly payload: Record<string, unknown>;
}

type Direction = "fieldToCrm" | "crmToField";
type BridgeValidation =
  | { readonly ok: true; readonly value: FieldBridgeEnvelope }
  | { readonly ok: false; readonly code: string };

const FIELD_COMMANDS = new Set<FieldBridgeCommand>([
  "openCreateJob", "claimJob", "assignJob", "changeVisit", "transitionStatus", "reviewJob",
]);
const FIELD_ENTITY_TYPES = new Set([
  "buildings", "buildingUnits", "salesProspects", "salesUnits", "workflowCases", "tasks",
]);
const FIELD_TO_CRM_TYPES = new Set<FieldBridgeType>([
  "field.ready", "field.routeChanged", "field.pendingUploads", "field.openCrmEntity",
  "field.openExternal", "field.ack", "field.commandResult", "field.logoutDecision",
]);
const CRM_TO_FIELD_TYPES = new Set<FieldBridgeType>([
  "field.navigate", "field.command", "field.cancel", "crm.logoutCheck",
]);
const DIRECT_EXTERNAL_HOSTS = new Set([
  "drive.google.com", "docs.google.com", "map.naver.com", "land.naver.com",
  "new.land.naver.com", "m.land.naver.com", "daangn.com", "www.daangn.com",
  "bring-fm.web.app",
]);
const FIELD_ROUTE_TAB = new Set(["today", "unassigned", "map", "jobs", "review", "uploads"]);
const FIELD_ROUTE_SCOPE = new Set(["mine", "team", "unassigned"]);
const FIELD_ROUTE_FILTER = new Set([
  "all", "requested", "assigned", "accepted", "in_progress", "evidence_ready",
  "review_pending", "changes_requested", "approved", "completed", "cancelled",
  "queued", "uploading", "partial_failure", "failed", "synced",
]);
const FIELD_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const FIELD_JOB_TYPES = new Set([
  "vacancy_capture", "move_out_check", "cleaning_before_after",
  "maintenance_inspection", "complaint_check", "repair_before_after",
]);
const FIELD_TRANSITIONS = new Set([
  "requested", "assigned", "accepted", "in_progress", "evidence_ready", "review_pending",
  "changes_requested", "approved", "completed", "cancelled",
]);

function calendarDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function boundedReason(value: unknown): boolean {
  return typeof value === "string"
    && value.trim().length > 0
    && new TextEncoder().encode(value).byteLength <= 2_000;
}

function validFieldIdList(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 200
    && value.every(isSafeFieldId)
    && new Set(value).size === value.length;
}

function validCreateJobArgs(args: Record<string, unknown>): boolean {
  if (!exactKeys(args, ["jobType", "dueDate", "priority", "assignedOperatorId"], [
    "crmBuildingId", "crmSalesProspectId", "crmBuildingUnitIds", "crmSalesUnitIds",
    "crmWorkflowCaseId", "crmTaskId",
  ])) return false;
  const hasBuilding = Object.hasOwn(args, "crmBuildingId");
  const hasProspect = Object.hasOwn(args, "crmSalesProspectId");
  if (hasBuilding === hasProspect) return false;
  if (!FIELD_JOB_TYPES.has(String(args.jobType)) || !calendarDate(args.dueDate) || !FIELD_PRIORITIES.has(String(args.priority))) return false;
  if (args.assignedOperatorId !== null && !isSafeFieldId(args.assignedOperatorId)) return false;
  if (hasBuilding && !isSafeFieldId(args.crmBuildingId)) return false;
  if (hasProspect && !isSafeFieldId(args.crmSalesProspectId)) return false;
  if (args.crmBuildingUnitIds !== undefined && (!hasBuilding || !validFieldIdList(args.crmBuildingUnitIds))) return false;
  if (args.crmSalesUnitIds !== undefined && (!hasProspect || !validFieldIdList(args.crmSalesUnitIds))) return false;
  if (args.crmWorkflowCaseId !== undefined && !isSafeFieldId(args.crmWorkflowCaseId)) return false;
  return args.crmTaskId === undefined || isSafeFieldId(args.crmTaskId);
}

function validCommandArgs(command: FieldBridgeCommand, args: Record<string, unknown>): boolean {
  if (command === "openCreateJob") return validCreateJobArgs(args);
  if (command === "claimJob") return exactKeys(args, ["jobId"]) && isSafeFieldId(args.jobId);
  if (command === "assignJob") {
    return exactKeys(args, ["jobId", "assignedOperatorId", "reason"])
      && isSafeFieldId(args.jobId)
      && (args.assignedOperatorId === null || isSafeFieldId(args.assignedOperatorId))
      && boundedReason(args.reason);
  }
  if (command === "changeVisit") {
    if (!exactKeys(args, ["visitId", "reason"], ["jobId", "dueDate", "assignedOperatorId", "priority"])) return false;
    if (!isSafeFieldId(args.visitId) || (args.jobId !== undefined && !isSafeFieldId(args.jobId))) return false;
    if (!boundedReason(args.reason)) return false;
    if (args.dueDate !== undefined && !calendarDate(args.dueDate)) return false;
    if (args.assignedOperatorId !== undefined && args.assignedOperatorId !== null && !isSafeFieldId(args.assignedOperatorId)) return false;
    if (args.priority !== undefined && !FIELD_PRIORITIES.has(String(args.priority))) return false;
    return ["jobId", "dueDate", "assignedOperatorId", "priority"].some((key) => Object.hasOwn(args, key));
  }
  if (command === "transitionStatus") {
    return exactKeys(args, ["jobId", "toStatus"], ["reason", "inspectionOutcome"])
      && isSafeFieldId(args.jobId)
      && FIELD_TRANSITIONS.has(String(args.toStatus))
      && (args.reason === undefined || boundedReason(args.reason))
      && (args.inspectionOutcome === undefined || ["no_issue", "issue_found"].includes(String(args.inspectionOutcome)));
  }
  return exactKeys(args, ["jobId", "decision"], ["reason"])
    && isSafeFieldId(args.jobId)
    && ["approved", "changes_requested"].includes(String(args.decision))
    && (args.decision === "changes_requested" ? boundedReason(args.reason) : args.reason === undefined || boundedReason(args.reason));
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function validBridgeError(value: unknown): boolean {
  return isPlainFieldRecord(value)
    && exactKeys(value, ["code"])
    && typeof value.code === "string"
    && value.code.length > 0
    && value.code.length <= 128;
}

function validStringIds(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 200
    && value.every(isSafeFieldId)
    && new Set(value).size === value.length;
}

function validPersistedWorkItem(value: unknown): boolean {
  try {
    parsePersonalFieldWorkspaceItem(value);
    return true;
  } catch {
    return false;
  }
}

function validCreateJobsResult(value: unknown): boolean {
  return isPlainFieldRecord(value)
    && exactKeys(value, ["visitId", "jobIds", "repeated"])
    && isSafeFieldId(value.visitId)
    && validStringIds(value.jobIds)
    && typeof value.repeated === "boolean";
}

function validChangeVisitResult(value: unknown): boolean {
  if (
    !isPlainFieldRecord(value)
    || !exactKeys(value, ["visitId", "updatedJobIds", "workItems"], ["newVisitId"])
    || !isSafeFieldId(value.visitId)
    || (value.newVisitId !== undefined && (
      !isSafeFieldId(value.newVisitId) || value.newVisitId === value.visitId
    ))
    || !validStringIds(value.updatedJobIds)
    || !Array.isArray(value.workItems)
    || value.workItems.length !== value.updatedJobIds.length
    || !value.workItems.every(validPersistedWorkItem)
  ) return false;
  const expectedVisitId = value.newVisitId ?? value.visitId;
  const workItems = value.workItems as Array<Record<string, unknown>>;
  const workItemIds = workItems.map((item) => item.id);
  return workItems.every((item) => item.visitId === expectedVisitId)
    && workItemIds.every(isSafeFieldId)
    && [...workItemIds].sort().join("\u0000") === [...value.updatedJobIds].sort().join("\u0000");
}

function validCommandResultFor(command: FieldBridgeCommand, value: unknown): boolean {
  if (command === "openCreateJob") return validCreateJobsResult(value);
  if (["claimJob", "assignJob", "transitionStatus"].includes(command)) {
    return validPersistedWorkItem(value);
  }
  if (command === "changeVisit") return validChangeVisitResult(value);
  return false;
}

function validCommandResultSuccess(value: unknown): boolean {
  return validCreateJobsResult(value)
    || validPersistedWorkItem(value)
    || validChangeVisitResult(value);
}

export function normalizeFieldRoute(rawRoute: unknown): string | null {
  if (
    typeof rawRoute !== "string"
    || rawRoute.length === 0
    || rawRoute.length > 1024
    || !rawRoute.startsWith("/")
    || rawRoute.startsWith("//")
    || /[\u0000-\u001f\u007f]/u.test(rawRoute)
  ) {
    return null;
  }
  try {
    const url = new URL(rawRoute, FIELD_ORIGIN);
    if (url.origin !== FIELD_ORIGIN || url.hash || url.pathname !== "/field") {
      return null;
    }
    const allowed = new Set(["embedded", "tab", "jobId", "filter", "scope", "date"]);
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams.entries()) {
      if (
        !allowed.has(key)
        || seen.has(key)
        || value.length === 0
        || value.length > 256
        || /[\u0000-\u001f\u007f]/u.test(value)
      ) {
        return null;
      }
      seen.add(key);
      if (key === "embedded" && value !== "crm") return null;
      if (key === "tab" && !FIELD_ROUTE_TAB.has(value)) return null;
      if (key === "scope" && !FIELD_ROUTE_SCOPE.has(value)) return null;
      if (key === "filter" && !FIELD_ROUTE_FILTER.has(value)) return null;
      if (key === "jobId" && !isSafeFieldId(value)) return null;
      if (key === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
          date.getUTCFullYear() !== year
          || date.getUTCMonth() !== month - 1
          || date.getUTCDate() !== day
        ) return null;
      }
    }
    if (!seen.has("embedded")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function validRoutePayload(payload: Record<string, unknown>): boolean {
  if (!exactKeys(payload, ["route"], ["operatorId", "selectedJobId", "filter", "scrollTop", "search"])) return false;
  if (!normalizeFieldRoute(payload.route)) return false;
  if (payload.operatorId !== undefined && payload.operatorId !== null
    && payload.operatorId !== "" && !isSafeFieldId(payload.operatorId)) return false;
  if (payload.selectedJobId !== undefined && payload.selectedJobId !== null
    && payload.selectedJobId !== "" && !isSafeFieldId(payload.selectedJobId)) return false;
  if (payload.scrollTop !== undefined && (
    !Number.isSafeInteger(payload.scrollTop)
    || (payload.scrollTop as number) < 0
    || (payload.scrollTop as number) > 10_000_000
  )) return false;
  if (payload.search !== undefined && (typeof payload.search !== "string" || payload.search.length > 256)) return false;
  return payload.filter === undefined || isSafeFieldValue(payload.filter);
}

function validExternalUrl(raw: unknown): boolean {
  try {
    const url = new URL(String(raw ?? ""));
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validPayload(type: FieldBridgeType, payload: unknown): payload is Record<string, unknown> {
  if (!isPlainFieldRecord(payload) || !isSafeFieldValue(payload)) return false;
  if (type === "field.ready") {
    return exactKeys(payload, ["buildVersion", "route", "session"], ["operatorId"])
      && payload.buildVersion === FIELD_BUILD_VERSION
      && Boolean(normalizeFieldRoute(payload.route))
      && ["authenticated", "missing", "expired"].includes(String(payload.session))
      && (payload.operatorId === undefined || payload.operatorId === null
        || payload.operatorId === "" || isSafeFieldId(payload.operatorId));
  }
  if (type === "field.navigate" || type === "field.routeChanged") return validRoutePayload(payload);
  if (type === "field.command") {
    return exactKeys(payload, ["command", "operatorId", "args"])
      && FIELD_COMMANDS.has(payload.command as FieldBridgeCommand)
      && isSafeFieldId(payload.operatorId)
      && isPlainFieldRecord(payload.args)
      && isSafeFieldValue(payload.args)
      && validCommandArgs(payload.command as FieldBridgeCommand, payload.args);
  }
  if (type === "field.pendingUploads") {
    return exactKeys(payload, ["count", "risk"])
      && Number.isSafeInteger(payload.count) && (payload.count as number) >= 0 && (payload.count as number) <= 100_000
      && ["none", "low", "medium", "high"].includes(String(payload.risk));
  }
  if (type === "field.openCrmEntity") {
    return exactKeys(payload, ["entityType", "entityId"])
      && FIELD_ENTITY_TYPES.has(String(payload.entityType))
      && isSafeFieldId(payload.entityId);
  }
  if (type === "field.openExternal") return exactKeys(payload, ["url"]) && validExternalUrl(payload.url);
  if (type === "crm.logoutCheck") return exactKeys(payload, ["reason"]) && payload.reason === "logout";
  if (type === "field.logoutDecision") {
    if (payload.ok === false) {
      return exactKeys(payload, ["ok", "error"])
        && validBridgeError(payload.error)
        && (payload.error as { code: string }).code === "FIELD_PENDING_UPLOADS_UNKNOWN";
    }
    return exactKeys(payload, ["pending", "count", "risk"])
      && typeof payload.pending === "boolean"
      && Number.isSafeInteger(payload.count) && (payload.count as number) >= 0 && (payload.count as number) <= 100_000
      && payload.pending === ((payload.count as number) > 0)
      && ["none", "low", "medium", "high"].includes(String(payload.risk));
  }
  if (type === "field.ack") {
    return payload.ok === true
      ? exactKeys(payload, ["ok"])
      : payload.ok === false
        && exactKeys(payload, ["ok", "error"])
        && validBridgeError(payload.error);
  }
  if (type === "field.commandResult") {
    return payload.ok === true
      ? exactKeys(payload, ["ok", "result"])
        && validCommandResultSuccess(payload.result)
      : payload.ok === false
        && exactKeys(payload, ["ok", "error"])
        && validBridgeError(payload.error);
  }
  return type === "field.cancel"
    && exactKeys(payload, ["targetRequestId"])
    && isFieldRequestId(payload.targetRequestId);
}

export function validateDesktopFieldEnvelope(value: unknown, direction: Direction): BridgeValidation {
  if (!isPlainFieldRecord(value) || !exactKeys(value, ["protocolVersion", "type", "requestId", "payload"])) {
    return { ok: false, code: "FIELD_BRIDGE_ENVELOPE_INVALID" };
  }
  const types = direction === "fieldToCrm" ? FIELD_TO_CRM_TYPES : CRM_TO_FIELD_TYPES;
  if (
    value.protocolVersion !== FIELD_PROTOCOL_VERSION
    || typeof value.type !== "string"
    || !types.has(value.type as FieldBridgeType)
    || !isFieldRequestId(value.requestId)
  ) return { ok: false, code: "FIELD_BRIDGE_ENVELOPE_INVALID" };
  if (fieldUtf8Bytes(value) > FIELD_MAX_BRIDGE_BYTES) return { ok: false, code: "FIELD_BRIDGE_TOO_LARGE" };
  if (!validPayload(value.type as FieldBridgeType, value.payload)) {
    return { ok: false, code: "FIELD_BRIDGE_PAYLOAD_INVALID" };
  }
  return { ok: true, value: value as unknown as FieldBridgeEnvelope };
}

export function createFieldBridgeEnvelope(
  type: FieldBridgeType,
  payload: Record<string, unknown>,
  requestId = crypto.randomUUID(),
): FieldBridgeEnvelope {
  return { protocolVersion: FIELD_PROTOCOL_VERSION, type, requestId, payload };
}

export interface DesktopFieldBridgeDependencies {
  post(envelope: FieldBridgeEnvelope): void;
  subscribe(listener: (event: MessageEvent) => void): () => void;
  command(
    command: FieldBridgeCommand,
    args: Record<string, unknown>,
    context: {
      readonly operatorId: string;
      readonly requestId: string;
      readonly signal: AbortSignal;
    },
  ): Promise<unknown>;
  currentOperatorId(): string | null;
  navigate(payload: Record<string, unknown>): boolean | Promise<boolean>;
  pendingUploads():
    | { count: number; risk: "none" | "low" | "medium" | "high" }
    | Promise<{ count: number; risk: "none" | "low" | "medium" | "high" }>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isPlainFieldRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createDesktopFieldBridge(dependencies: DesktopFieldBridgeDependencies) {
  const completed = new Map<string, { fingerprint: string; response: FieldBridgeEnvelope }>();
  const active = new Map<string, AbortController>();
  let session = "";
  let unsubscribe: (() => void) | undefined;

  const respond = (response: FieldBridgeEnvelope) => {
    const valid = validateDesktopFieldEnvelope(response, "fieldToCrm");
    if (valid.ok) dependencies.post(valid.value);
  };

  const handle = async (event: MessageEvent) => {
    if (event.origin !== FIELD_ORIGIN || event.source !== window) return;
    const validated = validateDesktopFieldEnvelope(event.data, "crmToField");
    if (!validated.ok) return;
    const envelope = validated.value;
    if (envelope.type === "field.cancel") {
      active.get(String(envelope.payload.targetRequestId))?.abort();
      active.delete(String(envelope.payload.targetRequestId));
      return;
    }
    const fingerprint = stable(envelope);
    const previous = completed.get(envelope.requestId);
    if (previous) {
      if (previous.fingerprint === fingerprint) dependencies.post(previous.response);
      return;
    }
    if (active.has(envelope.requestId)) return;
    const controller = new AbortController();
    active.set(envelope.requestId, controller);
    const requestSession = session;
    const timer = (dependencies.setTimer ?? setTimeout)(() => controller.abort(), FIELD_BRIDGE_TIMEOUT_MS);
    let response: FieldBridgeEnvelope;
    try {
      if (envelope.type === "field.navigate") {
        const restored = await dependencies.navigate(envelope.payload);
        if (restored !== true) {
          throw Object.assign(new Error("field_navigation_unavailable"), {
            code: "FIELD_NAVIGATION_UNAVAILABLE",
          });
        }
        response = createFieldBridgeEnvelope("field.ack", { ok: true }, envelope.requestId);
      } else if (envelope.type === "field.command") {
        const commandOperatorId = envelope.payload.operatorId as string;
        if (dependencies.currentOperatorId() !== commandOperatorId) {
          throw Object.assign(new Error("field_operator_changed"), { code: "FIELD_OPERATOR_CHANGED" });
        }
        const result = await dependencies.command(
          envelope.payload.command as FieldBridgeCommand,
          envelope.payload.args as Record<string, unknown>,
          {
            operatorId: commandOperatorId,
            requestId: envelope.requestId,
            signal: controller.signal,
          },
        );
        if (!validCommandResultFor(envelope.payload.command as FieldBridgeCommand, result)) {
          throw new Error("field_command_result_invalid");
        }
        response = createFieldBridgeEnvelope("field.commandResult", { ok: true, result }, envelope.requestId);
      } else {
        const pending = await dependencies.pendingUploads();
        if (!Number.isSafeInteger(pending.count) || pending.count < 0 || pending.count > 100_000) {
          throw new Error("field_pending_uploads_invalid");
        }
        response = createFieldBridgeEnvelope("field.logoutDecision", {
          pending: pending.count > 0,
          count: pending.count,
          risk: pending.risk,
        }, envelope.requestId);
      }
    } catch (error) {
      if (envelope.type === "crm.logoutCheck") {
        response = createFieldBridgeEnvelope("field.logoutDecision", {
          ok: false,
          error: { code: "FIELD_PENDING_UPLOADS_UNKNOWN" },
        }, envelope.requestId);
      } else {
        const safeCodes = new Set([
          "FIELD_OPERATOR_CHANGED",
          "FIELD_NAVIGATION_UNAVAILABLE",
          "FIELD_SESSION_UNAVAILABLE",
          "FIELD_CREATE_UNAVAILABLE",
          "FIELD_REVIEW_UNAVAILABLE",
          "FIELD_VIEWER_READ_ONLY",
        ]);
        const candidate = typeof error === "object" && error !== null && "code" in error
          && typeof error.code === "string"
          ? error.code
          : "";
        const code = safeCodes.has(candidate) ? candidate : "FIELD_REQUEST_FAILED";
        response = createFieldBridgeEnvelope(
          envelope.type === "field.command" ? "field.commandResult" : "field.ack",
          { ok: false, error: { code } },
          envelope.requestId,
        );
      }
    } finally {
      (dependencies.clearTimer ?? clearTimeout)(timer);
    }
    active.delete(envelope.requestId);
    if (controller.signal.aborted || session !== requestSession) return;
    const validResponse = validateDesktopFieldEnvelope(response, "fieldToCrm");
    if (!validResponse.ok) return;
    completed.set(envelope.requestId, { fingerprint, response: validResponse.value });
    while (completed.size > 256) completed.delete(completed.keys().next().value as string);
    respond(validResponse.value);
  };

  return Object.freeze({
    start(nextSession: string) {
      session = nextSession;
      unsubscribe?.();
      unsubscribe = dependencies.subscribe((event) => void handle(event));
    },
    setSession(nextSession: string) {
      if (nextSession !== session) {
        for (const controller of active.values()) controller.abort();
        active.clear();
        completed.clear();
      }
      session = nextSession;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
      for (const controller of active.values()) controller.abort();
      active.clear();
      completed.clear();
    },
    sendReady(
      route: string,
      sessionState: "authenticated" | "missing" | "expired",
      operatorId?: string,
    ) {
      const normalized = normalizeFieldRoute(route);
      if (!normalized) throw new Error("field_route_invalid");
      respond(createFieldBridgeEnvelope("field.ready", {
        buildVersion: FIELD_BUILD_VERSION,
        route: normalized,
        session: sessionState,
        ...(operatorId ? { operatorId } : {}),
      }));
    },
    sendRouteChanged(payload: Record<string, unknown>) {
      respond(createFieldBridgeEnvelope("field.routeChanged", payload));
    },
    sendPendingUploads(count: number, risk: "none" | "low" | "medium" | "high") {
      respond(createFieldBridgeEnvelope("field.pendingUploads", { count, risk }));
    },
    openCrmEntity(entityType: string, entityId: string) {
      respond(createFieldBridgeEnvelope("field.openCrmEntity", { entityType, entityId }));
    },
    openExternal(rawUrl: string) {
      const url = new URL(rawUrl);
      if (!validExternalUrl(url.toString())) throw new Error("field_external_url_invalid");
      // The desktop host applies the confirmation policy. This side only labels
      // known direct hosts and never opens a browser on its own.
      respond(createFieldBridgeEnvelope("field.openExternal", { url: url.toString() }));
      return { direct: DIRECT_EXTERNAL_HOSTS.has(url.hostname.toLowerCase()) };
    },
  });
}

export function defaultDesktopFieldBridgeDependencies(
  command: DesktopFieldBridgeDependencies["command"],
  navigate: DesktopFieldBridgeDependencies["navigate"],
  pendingUploads: DesktopFieldBridgeDependencies["pendingUploads"],
  currentOperatorId: DesktopFieldBridgeDependencies["currentOperatorId"],
): DesktopFieldBridgeDependencies {
  return {
    post: (envelope) => window.postMessage(envelope, FIELD_ORIGIN),
    subscribe: (listener) => {
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
    command,
    navigate,
    pendingUploads,
    currentOperatorId,
  };
}

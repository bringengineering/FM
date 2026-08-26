const { randomUUID } = require("node:crypto");

const FIELD_PROTOCOL_VERSION = 2;
const FIELD_MAX_MESSAGE_BYTES = 32 * 1024;
const FIELD_BRIDGE_TIMEOUT_MS = 10_000;
const FIELD_ORIGIN = "https://bring-fm.web.app";
const FIELD_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FIELD_BUILD_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FIELD_ROUTE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FIELD_HASH = /^[a-f0-9]{64}$/;
const FIELD_ROUTE_TAB = new Set(["today", "unassigned", "map", "jobs", "review", "uploads"]);
const FIELD_ROUTE_SCOPE = new Set(["mine", "team", "unassigned"]);
const FIELD_ROUTE_FILTER = new Set([
  "all", "requested", "assigned", "accepted", "in_progress", "evidence_ready",
  "review_pending", "changes_requested", "approved", "completed", "cancelled",
  "queued", "uploading", "partial_failure", "failed", "synced",
]);
const FIELD_WORKFLOW_STATUS = new Set([
  "requested", "assigned", "accepted", "in_progress", "evidence_ready",
  "review_pending", "changes_requested", "approved", "completed", "cancelled",
]);
const FIELD_JOB_TYPES = new Set([
  "vacancy_capture", "move_out_check", "cleaning_before_after",
  "maintenance_inspection", "complaint_check", "repair_before_after",
]);
const FIELD_UPLOAD_STATUS = new Set(["none", "queued", "uploading", "partial_failure", "failed", "synced"]);
const FIELD_PRIORITY = new Set(["low", "normal", "high", "urgent"]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SECRET_KEY = /(?:password|passcode|secret|token|credential|doorlock|accesscode|keylocation|oauth|privatekey)/i;
const FIELD_COMMANDS = new Set([
  "openCreateJob",
  "claimJob",
  "assignJob",
  "changeVisit",
  "transitionStatus",
  "reviewJob",
]);
const FIELD_ENTITY_TYPES = new Set([
  "buildings",
  "buildingUnits",
  "salesProspects",
  "salesUnits",
  "workflowCases",
  "tasks",
]);
const FIELD_DIRECT_EXTERNAL_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "map.naver.com",
  "land.naver.com",
  "new.land.naver.com",
  "m.land.naver.com",
  "daangn.com",
  "www.daangn.com",
  "bring-fm.web.app",
]);
const FIELD_TO_CRM_TYPES = new Set([
  "field.ready",
  "field.routeChanged",
  "field.pendingUploads",
  "field.openCrmEntity",
  "field.openExternal",
  "field.ack",
  "field.commandResult",
  "field.logoutDecision",
]);
const CRM_TO_FIELD_TYPES = new Set([
  "field.navigate",
  "field.command",
  "field.cancel",
  "crm.logoutCheck",
]);
const RESPONSE_TYPE = Object.freeze({
  "field.navigate": "field.ack",
  "field.command": "field.commandResult",
  "crm.logoutCheck": "field.logoutDecision",
});
const FIELD_WORK_ITEM_REQUIRED_KEYS = [
  "id", "visitId", "jobType", "jobPolicyVersion", "checklistId", "assignedOperatorId",
  "dueDate", "priority", "workflowStatus", "uploadStatus", "sourceSnapshot", "sourceVersion",
  "sourceHash", "mediaCount", "uploadFailureCount", "adminActionRequired", "createdAt",
  "createdByAuthUid", "createdByOperatorId", "updatedAt", "updatedByAuthUid",
  "updatedByOperatorId", "archivedAt",
];
const FIELD_WORK_ITEM_OPTIONAL_KEYS = [
  "crmBuildingId", "crmBuildingUnitId", "crmSalesProspectId", "crmSalesUnitId",
  "crmWorkflowCaseId", "crmTaskId", "adPackageId", "acceptedAt", "startedAt",
  "evidenceReadyAt", "reviewPendingAt", "completedAt", "cancelledAt", "cancelReason",
];

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeId(value) {
  return typeof value === "string"
    && FIELD_ID.test(value)
    && !FORBIDDEN_OBJECT_KEYS.has(value);
}

function isFieldRequestId(value) {
  return typeof value === "string" && FIELD_REQUEST_ID.test(value);
}

function isMatchingFieldAuthSignoutAck(input, expected, current) {
  return hasExactKeys(input, ["requestId"])
    && isFieldRequestId(input.requestId)
    && isPlainRecord(expected)
    && isPlainRecord(current)
    && input.requestId === expected.requestId
    && current.webContentsId === expected.webContentsId
    && current.sessionKey === expected.sessionKey;
}

function isBoundedString(value, maximum = 1024, allowEmpty = true) {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && Buffer.byteLength(value, "utf8") <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isFieldDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isFieldTimestamp(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => allowed.has(key));
}

function isSafeBridgeValue(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isBoundedString(value, 16_384);
  if (Array.isArray(value)) return value.length <= 200 && value.every(item => isSafeBridgeValue(item, depth + 1));
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 100) return false;
  return keys.every(key => !FORBIDDEN_OBJECT_KEYS.has(key)
    && !SECRET_KEY.test(key)
    && isBoundedString(key, 128, false)
    && isSafeBridgeValue(value[key], depth + 1));
}

function normalizeFieldRoute(rawRoute) {
  if (!isBoundedString(rawRoute, 1024, false) || !rawRoute.startsWith("/") || rawRoute.startsWith("//")) return null;
  try {
    const url = new URL(rawRoute, FIELD_ORIGIN);
    if (url.origin !== FIELD_ORIGIN || url.hash || url.pathname !== "/field") return null;
    const allowedQuery = new Set(["embedded", "tab", "jobId", "filter", "scope", "date"]);
    const seen = new Set();
    for (const [key, value] of url.searchParams.entries()) {
      if (!allowedQuery.has(key) || seen.has(key) || !isBoundedString(value, 256, false)) return null;
      seen.add(key);
      if (key === "embedded" && value !== "crm") return null;
      if (key === "tab" && !FIELD_ROUTE_TAB.has(value)) return null;
      if (key === "scope" && !FIELD_ROUTE_SCOPE.has(value)) return null;
      if (key === "filter" && !FIELD_ROUTE_FILTER.has(value)) return null;
      if (key === "jobId" && !isSafeId(value)) return null;
      if (key === "date" && !isFieldDate(value)) return null;
      if (["tab", "scope", "filter"].includes(key) && !FIELD_ROUTE_SLUG.test(value)) return null;
    }
    if (!seen.has("embedded")) return null;
    return `${url.pathname}${url.search}`;
  } catch (_error) {
    return null;
  }
}

function isAllowedFieldNavigation(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.username || url.password || url.origin !== FIELD_ORIGIN || url.hash) return false;
    return Boolean(normalizeFieldRoute(`${url.pathname}${url.search}`));
  } catch (_error) {
    return false;
  }
}

function isAllowedFieldPermission(permission, requestingUrl, mediaTypes) {
  return permission === "media"
    && isAllowedFieldNavigation(requestingUrl)
    && Array.isArray(mediaTypes)
    && mediaTypes.length === 1
    && mediaTypes[0] === "video";
}

function sanitizeFieldTeamProfiles(value) {
  if (!isPlainRecord(value)) return [];
  const profiles = [];
  for (const [id, profile] of Object.entries(value)) {
    if (!isSafeId(id) || !isPlainRecord(profile)) continue;
    if (!hasExactKeys(profile, ["displayName", "active", "sortOrder"])) continue;
    const displayName = typeof profile.displayName === "string" ? profile.displayName.trim() : "";
    if (!displayName
      || [...displayName].length > 80
      || !isBoundedString(displayName, 240, false)
      || profile.active !== true) continue;
    if (!Number.isInteger(profile.sortOrder)
      || profile.sortOrder < 0
      || profile.sortOrder > 100_000) continue;
    const sortOrder = profile.sortOrder;
    profiles.push({ id, displayName, active: true, sortOrder });
  }
  return profiles.sort((left, right) => left.sortOrder - right.sortOrder
    || left.displayName.localeCompare(right.displayName, "ko")
    || left.id.localeCompare(right.id));
}

function isAllowedFieldAuthPopup(rawUrl) {
  if (rawUrl === "about:blank") return true;
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.username || url.password) return false;
    if (url.origin === "https://accounts.google.com") return true;
    return url.origin === "https://bring-fm.firebaseapp.com"
      && url.pathname === "/__/auth/handler";
  } catch (_error) {
    return false;
  }
}

function fieldBounds(contentRect) {
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    x: Math.max(0, Math.round(finite(contentRect && contentRect.x))),
    y: Math.max(0, Math.round(finite(contentRect && contentRect.y))),
    width: Math.max(0, Math.round(finite(contentRect && contentRect.width))),
    height: Math.max(0, Math.round(finite(contentRect && contentRect.height))),
  };
}

function externalFieldLinkDecision(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return { ok: false, code: "FIELD_EXTERNAL_URL_DENIED" };
    const host = url.hostname.toLowerCase();
    return {
      ok: true,
      url: url.toString(),
      host,
      requiresConfirmation: !FIELD_DIRECT_EXTERNAL_HOSTS.has(host),
    };
  } catch (_error) {
    return { ok: false, code: "FIELD_EXTERNAL_URL_DENIED" };
  }
}

function validSender(context, direction) {
  const sender = context && context.sender;
  if (!sender || sender.webContentsId !== sender.expectedWebContentsId || sender.isMainFrame !== true) return false;
  try {
    const frame = new URL(String(sender.frameUrl || ""));
    if (direction === "fieldToCrm") return isAllowedFieldNavigation(frame.toString());
    const expected = new URL(String(sender.expectedFrameUrl || ""));
    return frame.protocol === "file:" && frame.toString() === expected.toString();
  } catch (_error) {
    return false;
  }
}

function validOptionalOperator(value) {
  return value === undefined || value === null || value === "" || isSafeId(value);
}

function validRoutePayload(payload, requiredRoute = true) {
  const required = requiredRoute ? ["route"] : [];
  if (!hasExactKeys(payload, required, ["route", "operatorId", "selectedJobId", "filter", "scrollTop", "search"])) return false;
  if (Object.hasOwn(payload, "route") && !normalizeFieldRoute(payload.route)) return false;
  if (!validOptionalOperator(payload.operatorId)) return false;
  if (payload.selectedJobId !== undefined && payload.selectedJobId !== "" && payload.selectedJobId !== null && !isSafeId(payload.selectedJobId)) return false;
  if (payload.scrollTop !== undefined && (!Number.isInteger(payload.scrollTop) || payload.scrollTop < 0 || payload.scrollTop > 10_000_000)) return false;
  if (payload.search !== undefined && !isBoundedString(payload.search, 256)) return false;
  return payload.filter === undefined || isSafeBridgeValue(payload.filter);
}

function validCommandReason(value, required = false) {
  if (value === undefined) return !required;
  return isBoundedString(value, 2_000, false) && value.trim().length > 0;
}

function validFieldIdList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 200
    && value.every(isSafeId)
    && new Set(value).size === value.length;
}

function validCreateFieldJobArgs(args) {
  if (!hasExactKeys(args, ["jobType", "dueDate", "priority", "assignedOperatorId"], [
    "crmBuildingId", "crmSalesProspectId", "crmBuildingUnitIds", "crmSalesUnitIds",
    "crmWorkflowCaseId", "crmTaskId",
  ])) return false;
  const hasBuilding = Object.hasOwn(args, "crmBuildingId");
  const hasProspect = Object.hasOwn(args, "crmSalesProspectId");
  if (hasBuilding === hasProspect) return false;
  if (!FIELD_JOB_TYPES.has(args.jobType) || !isFieldDate(args.dueDate) || !FIELD_PRIORITY.has(args.priority)) return false;
  if (args.assignedOperatorId !== null && !isSafeId(args.assignedOperatorId)) return false;
  if (hasBuilding && !isSafeId(args.crmBuildingId)) return false;
  if (hasProspect && !isSafeId(args.crmSalesProspectId)) return false;
  if (args.crmBuildingUnitIds !== undefined && (!hasBuilding || !validFieldIdList(args.crmBuildingUnitIds))) return false;
  if (args.crmSalesUnitIds !== undefined && (!hasProspect || !validFieldIdList(args.crmSalesUnitIds))) return false;
  if (args.crmWorkflowCaseId !== undefined && !isSafeId(args.crmWorkflowCaseId)) return false;
  return args.crmTaskId === undefined || isSafeId(args.crmTaskId);
}

function validFieldCommandArgs(command, args) {
  if (!isPlainRecord(args)) return false;
  if (command === "openCreateJob") return validCreateFieldJobArgs(args);
  if (command === "claimJob") {
    return hasExactKeys(args, ["jobId"])
      && isSafeId(args.jobId);
  }
  if (command === "assignJob") {
    return hasExactKeys(args, ["jobId", "assignedOperatorId", "reason"])
      && isSafeId(args.jobId)
      && (args.assignedOperatorId === null || isSafeId(args.assignedOperatorId))
      && validCommandReason(args.reason, true);
  }
  if (command === "changeVisit") {
    return hasExactKeys(args, ["visitId", "reason"], ["jobId", "dueDate", "assignedOperatorId", "priority"])
      && isSafeId(args.visitId)
      && validCommandReason(args.reason, true)
      && (args.jobId === undefined || isSafeId(args.jobId))
      && (args.dueDate === undefined || isFieldDate(args.dueDate))
      && (args.assignedOperatorId === undefined || args.assignedOperatorId === null || isSafeId(args.assignedOperatorId))
      && (args.priority === undefined || FIELD_PRIORITY.has(args.priority))
      && ["jobId", "dueDate", "assignedOperatorId", "priority"].some(key => Object.hasOwn(args, key));
  }
  if (command === "transitionStatus") {
    return hasExactKeys(args, ["jobId", "toStatus"], ["reason", "inspectionOutcome"])
      && isSafeId(args.jobId)
      && FIELD_WORKFLOW_STATUS.has(args.toStatus)
      && validCommandReason(args.reason)
      && (args.inspectionOutcome === undefined || ["no_issue", "issue_found"].includes(args.inspectionOutcome));
  }
  if (command === "reviewJob") {
    return hasExactKeys(args, ["jobId", "decision"], ["reason"])
      && isSafeId(args.jobId)
      && ["approved", "changes_requested"].includes(args.decision)
      && validCommandReason(args.reason, args.decision === "changes_requested");
  }
  return false;
}

function validBridgeError(value) {
  return hasExactKeys(value, ["code"])
    && isBoundedString(value.code, 128, false);
}

function validStringArray(value, maximum = 200) {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximum
    && value.every(isSafeId)
    && new Set(value).size === value.length;
}

function validFieldSourceSnapshot(value, workItem) {
  if (!hasExactKeys(value, ["parentType", "parentId", "parentName", "address"], [
    "unitType", "unitId", "unitLabel", "depositWon", "monthlyRentWon",
    "maintenanceFeeWon", "moveOutAt", "availableFrom",
  ])) return false;
  if (!["building", "salesProspect"].includes(value.parentType)
    || !isSafeId(value.parentId)
    || !isBoundedString(value.parentName, 512, false)
    || !isBoundedString(value.address, 2_048, false)) return false;
  if (value.parentType === "building") {
    if (value.parentId !== workItem.crmBuildingId || workItem.crmSalesProspectId !== undefined) return false;
  } else if (value.parentId !== workItem.crmSalesProspectId || workItem.crmBuildingId !== undefined) return false;
  const hasUnit = value.unitType !== undefined || value.unitId !== undefined || value.unitLabel !== undefined;
  if (hasUnit) {
    if (!["buildingUnit", "salesUnit"].includes(value.unitType)
      || !isSafeId(value.unitId)
      || !isBoundedString(value.unitLabel, 256, false)) return false;
    if (value.unitType === "buildingUnit" && (value.unitId !== workItem.crmBuildingUnitId || workItem.crmSalesUnitId !== undefined)) return false;
    if (value.unitType === "salesUnit" && (value.unitId !== workItem.crmSalesUnitId || workItem.crmBuildingUnitId !== undefined)) return false;
  } else if (workItem.crmBuildingUnitId !== undefined || workItem.crmSalesUnitId !== undefined) return false;
  for (const key of ["depositWon", "monthlyRentWon", "maintenanceFeeWon"]) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0)) return false;
  }
  if (value.moveOutAt !== undefined && !isFieldDate(value.moveOutAt)) return false;
  if (value.availableFrom !== undefined && !isFieldDate(value.availableFrom)) return false;
  if (value.unitType === "salesUnit") {
    if (!["depositWon", "monthlyRentWon", "maintenanceFeeWon"].every(key => Object.hasOwn(value, key))) return false;
  } else if (["depositWon", "monthlyRentWon", "maintenanceFeeWon", "moveOutAt", "availableFrom"].some(key => Object.hasOwn(value, key))) return false;
  return true;
}

function validPersistedFieldWorkItem(value) {
  if (!hasExactKeys(value, FIELD_WORK_ITEM_REQUIRED_KEYS, FIELD_WORK_ITEM_OPTIONAL_KEYS)) return false;
  if (!isSafeId(value.id)
    || !isSafeId(value.visitId)
    || !FIELD_JOB_TYPES.has(value.jobType)
    || !isBoundedString(value.jobPolicyVersion, 128, false)
    || !isBoundedString(value.checklistId, 128, false)
    || !isFieldDate(value.dueDate)
    || !FIELD_PRIORITY.has(value.priority)
    || !FIELD_WORKFLOW_STATUS.has(value.workflowStatus)
    || !FIELD_UPLOAD_STATUS.has(value.uploadStatus)
    || !FIELD_HASH.test(String(value.sourceHash || ""))
    || !Number.isSafeInteger(value.mediaCount) || value.mediaCount < 0
    || !Number.isSafeInteger(value.uploadFailureCount) || value.uploadFailureCount < 0
    || typeof value.adminActionRequired !== "boolean"
    || !isFieldTimestamp(value.createdAt)
    || !isFieldTimestamp(value.updatedAt)
    || !isSafeId(value.createdByAuthUid)
    || !isSafeId(value.createdByOperatorId)
    || !isSafeId(value.updatedByAuthUid)
    || !isSafeId(value.updatedByOperatorId)
    || (value.archivedAt !== null && !isFieldTimestamp(value.archivedAt))) return false;
  if ((value.crmBuildingId === undefined) === (value.crmSalesProspectId === undefined)) return false;
  for (const key of [
    "crmBuildingId", "crmBuildingUnitId", "crmSalesProspectId", "crmSalesUnitId",
    "crmWorkflowCaseId", "crmTaskId",
  ]) {
    if (value[key] !== undefined && !isSafeId(value[key])) return false;
  }
  if (value.assignedOperatorId !== null && !isSafeId(value.assignedOperatorId)) return false;
  if (value.workflowStatus === "requested" ? value.assignedOperatorId !== null : value.assignedOperatorId === null) return false;
  if (value.adPackageId !== undefined && value.adPackageId !== null && !isSafeId(value.adPackageId)) return false;
  for (const key of ["acceptedAt", "startedAt", "evidenceReadyAt", "reviewPendingAt", "completedAt", "cancelledAt"]) {
    if (value[key] !== undefined && !isFieldTimestamp(value[key])) return false;
  }
  if (value.cancelReason !== undefined && !isBoundedString(value.cancelReason, 2_000, false)) return false;
  if (!validFieldSourceSnapshot(value.sourceSnapshot, value)) return false;
  if (!hasExactKeys(value.sourceVersion, ["parentUpdatedAt"], ["unitUpdatedAt"])
    || !isFieldTimestamp(value.sourceVersion.parentUpdatedAt)
    || (value.sourceVersion.unitUpdatedAt !== undefined && !isFieldTimestamp(value.sourceVersion.unitUpdatedAt))) return false;
  return (value.sourceSnapshot.unitType === undefined) === (value.sourceVersion.unitUpdatedAt === undefined);
}

function validCreateFieldJobsResult(value) {
  return hasExactKeys(value, ["visitId", "jobIds", "repeated"])
    && isSafeId(value.visitId)
    && validStringArray(value.jobIds)
    && typeof value.repeated === "boolean";
}

function validChangeFieldVisitResult(value) {
  if (!hasExactKeys(value, ["visitId", "updatedJobIds", "workItems"], ["newVisitId"])
    || !isSafeId(value.visitId)
    || (value.newVisitId !== undefined && (!isSafeId(value.newVisitId) || value.newVisitId === value.visitId))
    || !validStringArray(value.updatedJobIds)
    || !Array.isArray(value.workItems)
    || value.workItems.length !== value.updatedJobIds.length
    || !value.workItems.every(validPersistedFieldWorkItem)) return false;
  const expectedVisitId = value.newVisitId || value.visitId;
  if (value.workItems.some(item => item.visitId !== expectedVisitId)) return false;
  const workItemIds = value.workItems.map(item => item.id);
  return workItemIds.length === new Set(workItemIds).size
    && [...workItemIds].sort().join("\u0000") === [...value.updatedJobIds].sort().join("\u0000");
}

function validCommandResultSuccess(value) {
  return validCreateFieldJobsResult(value)
    || validPersistedFieldWorkItem(value)
    || validChangeFieldVisitResult(value);
}

function validateFieldCommandResult(command, payload) {
  if (!FIELD_COMMANDS.has(command) || !isPlainRecord(payload) || typeof payload.ok !== "boolean") return false;
  if (payload.ok === false) return hasExactKeys(payload, ["ok", "error"])
    && validBridgeError(payload.error);
  if (!hasExactKeys(payload, ["ok", "result"])) return false;
  if (command === "openCreateJob") return validCreateFieldJobsResult(payload.result);
  if (["claimJob", "assignJob", "transitionStatus"].includes(command)) return validPersistedFieldWorkItem(payload.result);
  if (command === "changeVisit") return validChangeFieldVisitResult(payload.result);
  return false;
}

function validatePayload(type, payload) {
  if (!isPlainRecord(payload) || !isSafeBridgeValue(payload)) return false;
  if (type === "field.ready") {
    return hasExactKeys(payload, ["buildVersion", "route", "session"], ["operatorId"])
      && FIELD_BUILD_VERSION.test(payload.buildVersion)
      && Boolean(normalizeFieldRoute(payload.route))
      && ["authenticated", "missing", "expired"].includes(payload.session)
      && validOptionalOperator(payload.operatorId);
  }
  if (type === "field.navigate") return validRoutePayload(payload, true);
  if (type === "field.routeChanged") return validRoutePayload(payload, true);
  if (type === "field.command") {
    return hasExactKeys(payload, ["command", "operatorId", "args"])
      && FIELD_COMMANDS.has(payload.command)
      && isSafeId(payload.operatorId)
      && validFieldCommandArgs(payload.command, payload.args);
  }
  if (type === "field.pendingUploads") {
    return hasExactKeys(payload, ["count", "risk"])
      && Number.isInteger(payload.count) && payload.count >= 0 && payload.count <= 100_000
      && ["none", "low", "medium", "high"].includes(payload.risk);
  }
  if (type === "field.openCrmEntity") {
    return hasExactKeys(payload, ["entityType", "entityId"])
      && FIELD_ENTITY_TYPES.has(payload.entityType)
      && isSafeId(payload.entityId);
  }
  if (type === "field.openExternal") {
    return hasExactKeys(payload, ["url"])
      && externalFieldLinkDecision(payload.url).ok;
  }
  if (type === "crm.logoutCheck") return hasExactKeys(payload, ["reason"]) && payload.reason === "logout";
  if (type === "field.logoutDecision") {
    if (payload.ok === false) {
      return hasExactKeys(payload, ["ok", "error"])
        && validBridgeError(payload.error)
        && payload.error.code === "FIELD_PENDING_UPLOADS_UNKNOWN";
    }
    return hasExactKeys(payload, ["pending", "count", "risk"])
      && typeof payload.pending === "boolean"
      && Number.isInteger(payload.count) && payload.count >= 0 && payload.count <= 100_000
      && payload.pending === (payload.count > 0)
      && ["none", "low", "medium", "high"].includes(payload.risk);
  }
  if (type === "field.ack") {
    return payload.ok === true
      ? hasExactKeys(payload, ["ok"])
      : payload.ok === false
        && hasExactKeys(payload, ["ok", "error"])
        && validBridgeError(payload.error);
  }
  if (type === "field.commandResult") {
    return payload.ok === true
      ? hasExactKeys(payload, ["ok", "result"])
        && validCommandResultSuccess(payload.result)
      : payload.ok === false
        && hasExactKeys(payload, ["ok", "error"])
        && validBridgeError(payload.error);
  }
  if (type === "field.cancel") {
    return hasExactKeys(payload, ["targetRequestId"])
      && FIELD_REQUEST_ID.test(payload.targetRequestId);
  }
  return false;
}

function validateFieldMessage(value, context) {
  try {
    const direction = context && context.direction;
    const types = direction === "fieldToCrm" ? FIELD_TO_CRM_TYPES : direction === "crmToField" ? CRM_TO_FIELD_TYPES : null;
    if (!types || !validSender(context, direction) || !hasExactKeys(value, ["protocolVersion", "type", "requestId", "payload"])) {
      return { ok: false, code: "FIELD_BRIDGE_SENDER_INVALID" };
    }
    if (value.protocolVersion !== FIELD_PROTOCOL_VERSION || !types.has(value.type) || !FIELD_REQUEST_ID.test(value.requestId)) {
      return { ok: false, code: "FIELD_BRIDGE_ENVELOPE_INVALID" };
    }
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > FIELD_MAX_MESSAGE_BYTES) return { ok: false, code: "FIELD_BRIDGE_TOO_LARGE" };
    if (!validatePayload(value.type, value.payload)) return { ok: false, code: "FIELD_BRIDGE_PAYLOAD_INVALID" };
    return { ok: true, value };
  } catch (_error) {
    return { ok: false, code: "FIELD_BRIDGE_INVALID" };
  }
}

function createFieldEnvelope(type, payload, requestId = randomUUID()) {
  return { protocolVersion: FIELD_PROTOCOL_VERSION, type, requestId, payload };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function bridgeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createFieldRequestCoordinator(options = {}) {
  const send = typeof options.send === "function" ? options.send : () => undefined;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const timeoutMs = Number(options.timeoutMs) || FIELD_BRIDGE_TIMEOUT_MS;
  const pending = new Map();
  const completed = new Map();
  let sessionKey = "";

  const sendCancel = targetRequestId => {
    try { send(createFieldEnvelope("field.cancel", { targetRequestId })); } catch (_error) {}
  };

  const rejectPending = (entry, code, notifyField) => {
    if (!entry || !pending.has(entry.envelope.requestId)) return false;
    pending.delete(entry.envelope.requestId);
    clearTimer(entry.timer);
    if (notifyField) sendCancel(entry.envelope.requestId);
    entry.reject(bridgeError(code));
    return true;
  };

  const coordinator = {
    setSession(nextSessionKey) {
      const next = String(nextSessionKey || "");
      if (next !== sessionKey) {
        for (const entry of [...pending.values()]) rejectPending(entry, "FIELD_SESSION_CHANGED", true);
        completed.clear();
      }
      sessionKey = next;
    },
    request(envelope) {
      const expectedType = RESPONSE_TYPE[envelope && envelope.type];
      if (!expectedType || !FIELD_REQUEST_ID.test(String(envelope && envelope.requestId || ""))) {
        return Promise.reject(bridgeError("FIELD_BRIDGE_REQUEST_INVALID"));
      }
      const fingerprint = stableJson(envelope);
      const done = completed.get(envelope.requestId);
      if (done) return done.fingerprint === fingerprint
        ? Promise.resolve(done.response)
        : Promise.reject(bridgeError("FIELD_BRIDGE_DUPLICATE_CONFLICT"));
      const existing = pending.get(envelope.requestId);
      if (existing) return existing.fingerprint === fingerprint
        ? existing.promise
        : Promise.reject(bridgeError("FIELD_BRIDGE_DUPLICATE_CONFLICT"));

      let resolve;
      let reject;
      const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
      const entry = { envelope, expectedType, fingerprint, promise, resolve, reject, sessionKey, timer: null };
      entry.timer = setTimer(() => rejectPending(entry, "FIELD_BRIDGE_TIMEOUT", true), timeoutMs);
      pending.set(envelope.requestId, entry);
      try { send(envelope); }
      catch (_error) { rejectPending(entry, "FIELD_BRIDGE_SEND_FAILED", false); }
      return promise;
    },
    handleResponse(envelope, responseSessionKey) {
      const entry = pending.get(envelope && envelope.requestId);
      if (!entry || entry.sessionKey !== sessionKey || responseSessionKey !== sessionKey || envelope.type !== entry.expectedType) return false;
      const validResponse = envelope.type === "field.commandResult"
        ? validateFieldCommandResult(entry.envelope.payload.command, envelope.payload)
        : validatePayload(envelope.type, envelope.payload);
      if (!validResponse) {
        rejectPending(entry, "FIELD_BRIDGE_RESPONSE_INVALID", false);
        return false;
      }
      pending.delete(envelope.requestId);
      clearTimer(entry.timer);
      completed.set(envelope.requestId, { fingerprint: entry.fingerprint, response: envelope });
      while (completed.size > 256) completed.delete(completed.keys().next().value);
      entry.resolve(envelope);
      return true;
    },
    cancel(requestId, code = "FIELD_BRIDGE_CANCELLED") {
      return rejectPending(pending.get(requestId), code, true);
    },
    cancelAll(code = "FIELD_BRIDGE_CANCELLED") {
      for (const entry of [...pending.values()]) rejectPending(entry, code, true);
    },
    pendingCount() { return pending.size; },
  };
  return coordinator;
}

async function inspectFieldPendingUploads(options = {}) {
  try {
    const fieldHandle = await options.ensureReady();
    const decision = await options.checkPending(fieldHandle);
    if (!isPlainRecord(decision)
      || !Number.isInteger(decision.count)
      || decision.count < 0
      || decision.count > 100_000
      || !["none", "low", "medium", "high"].includes(decision.risk)) {
      throw bridgeError("FIELD_LOGOUT_DECISION_INVALID");
    }
    return { ok: true, fieldHandle, pendingUploads: { count: decision.count, risk: decision.risk } };
  } catch (_error) {
    return { ok: false };
  }
}

async function coordinateFieldLogout(options = {}) {
  const confirmed = options.confirmed === true;
  const inspection = await inspectFieldPendingUploads(options);
  if (!inspection.ok) {
    return {
      ok: false,
      code: "FIELD_LOGOUT_CHECK_FAILED",
      error: "현장 업로드 상태를 확인하지 못했습니다. 다시 시도해 주세요.",
    };
  }
  const { fieldHandle, pendingUploads } = inspection;

  if (pendingUploads.count > 0 && !confirmed) {
    return {
      ok: false,
      code: "FIELD_LOGOUT_PENDING",
      error: "아직 업로드하지 못한 현장 자료가 있습니다.",
      pendingUploads,
    };
  }

  try {
    await options.signOutFieldAuthentication(fieldHandle);
  } catch (_error) {
    return {
      ok: false,
      code: "FIELD_SESSION_CLEAR_FAILED",
      error: "현장 업무의 로그인 상태를 종료하지 못했습니다. 다시 시도해 주세요.",
    };
  }

  try {
    await options.finishCrmLogout();
    return { ok: true };
  } catch (_error) {
    return {
      ok: false,
      code: "CRM_LOGOUT_FAILED",
      error: "CRM 로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.",
    };
  }
}

async function coordinateFieldExit(options = {}) {
  const reason = isBoundedString(options.reason, 32, false) ? options.reason : "window";
  let shouldInspect = true;
  try {
    if (typeof options.shouldInspect === "function") {
      shouldInspect = await options.shouldInspect(reason) !== false;
    }
  } catch (_error) {
    shouldInspect = true;
  }
  if (!shouldInspect) {
    try {
      await options.finishApplicationExit(reason);
      return { ok: true };
    } catch (_error) {
      return {
        ok: false,
        code: "FIELD_EXIT_FAILED",
        error: "프로그램 종료를 완료하지 못했습니다. 다시 시도해 주세요.",
      };
    }
  }
  const inspection = await inspectFieldPendingUploads(options);
  if (!inspection.ok) {
    let confirmed = false;
    try {
      confirmed = await options.confirmUnknown(reason) === true;
    } catch (_error) {
      return {
        ok: false,
        code: "FIELD_EXIT_CHECK_FAILED",
        error: "현장 업로드 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
      };
    }
    if (!confirmed) {
      return {
        ok: false,
        code: "FIELD_EXIT_CANCELLED",
        error: "현장 업로드 상태를 확인하지 못해 종료를 취소했습니다.",
      };
    }
  }
  if (inspection.ok && inspection.pendingUploads.count > 0) {
    let confirmed = false;
    try {
      confirmed = await options.confirmPending(inspection.pendingUploads, reason) === true;
    } catch (_error) {
      confirmed = false;
    }
    if (!confirmed) {
      return {
        ok: false,
        code: "FIELD_EXIT_CANCELLED",
        error: "아직 업로드하지 못한 현장 자료가 있어 종료를 취소했습니다.",
        pendingUploads: inspection.pendingUploads,
      };
    }
  }
  try {
    await options.finishApplicationExit(reason);
    return { ok: true };
  } catch (_error) {
    return {
      ok: false,
      code: "FIELD_EXIT_FAILED",
      error: "프로그램 종료를 완료하지 못했습니다. 다시 시도해 주세요.",
    };
  }
}

function createFieldExitCoordinator(options = {}) {
  let inFlight = null;
  let approved = false;
  let approvedReason = "";
  return Object.freeze({
    request(reason) {
      if (approved) return Promise.resolve({ ok: true, alreadyApproved: true, reason: approvedReason });
      if (inFlight) return inFlight;
      const task = coordinateFieldExit({ ...options, reason }).then(result => {
        if (result.ok) {
          approved = true;
          approvedReason = String(reason || "window");
        }
        return result;
      });
      const wrapped = task.finally(() => {
        if (inFlight === wrapped) inFlight = null;
      });
      inFlight = wrapped;
      return wrapped;
    },
    isApproved() { return approved; },
    reset() {
      if (inFlight) return false;
      approved = false;
      approvedReason = "";
      return true;
    },
  });
}

function createFieldSharedSessionRecoveryCoordinator(options = {}) {
  let active = null;
  let attemptedKey = "";
  let generation = 0;
  return Object.freeze({
    recover(recoveryKey, isCurrent = () => true) {
      const key = String(recoveryKey || "");
      if (!isBoundedString(key, 512, false)) return Promise.resolve({ ok: false, code: "FIELD_SESSION_INVALID" });
      if (active) return active.key === key
        ? active.promise
        : Promise.resolve({ ok: false, code: "FIELD_SESSION_RECOVERY_IN_PROGRESS" });
      if (attemptedKey === key) return Promise.resolve({ ok: false, code: "FIELD_SESSION_RECOVERY_ALREADY_ATTEMPTED" });
      attemptedKey = key;
      const recoveryGeneration = generation;
      const task = (async () => {
        try {
          await options.refreshCrmSession();
          if (generation !== recoveryGeneration || isCurrent() !== true) return { ok: false, code: "FIELD_SESSION_CHANGED" };
          await options.reloadSharedSession();
          if (generation !== recoveryGeneration || isCurrent() !== true) return { ok: false, code: "FIELD_SESSION_CHANGED" };
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            code: error && ["SESSION_CHANGED", "FIELD_SESSION_CHANGED"].includes(error.code)
              ? "FIELD_SESSION_CHANGED"
              : "FIELD_SHARED_SESSION_RECOVERY_FAILED",
          };
        }
      })();
      const wrapped = task.finally(() => {
        if (active && active.promise === wrapped) active = null;
      });
      active = { key, promise: wrapped };
      return wrapped;
    },
    reset() {
      generation += 1;
      active = null;
      attemptedKey = "";
    },
  });
}

module.exports = {
  CRM_TO_FIELD_TYPES,
  FIELD_BRIDGE_TIMEOUT_MS,
  FIELD_COMMANDS,
  FIELD_DIRECT_EXTERNAL_HOSTS,
  FIELD_ENTITY_TYPES,
  FIELD_MAX_MESSAGE_BYTES,
  FIELD_ORIGIN,
  FIELD_PROTOCOL_VERSION,
  FIELD_TO_CRM_TYPES,
  coordinateFieldExit,
  coordinateFieldLogout,
  createFieldExitCoordinator,
  createFieldEnvelope,
  createFieldRequestCoordinator,
  createFieldSharedSessionRecoveryCoordinator,
  externalFieldLinkDecision,
  fieldBounds,
  isAllowedFieldAuthPopup,
  isAllowedFieldNavigation,
  isAllowedFieldPermission,
  isFieldRequestId,
  isMatchingFieldAuthSignoutAck,
  isSafeId,
  normalizeFieldRoute,
  sanitizeFieldTeamProfiles,
  validateFieldCommandResult,
  validateFieldMessage,
};

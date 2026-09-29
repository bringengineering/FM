const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,150}$/u;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{6,200}$/u;
const REWORK_AREAS = ["window", "kitchen", "bathroom", "floor", "other"] as const;
export type CleaningReworkArea = (typeof REWORK_AREAS)[number];
export type CleaningReworkStatus = "requested" | "accepted" | "declined" | "in_progress" | "awaiting_review" | "completed";

export interface CleaningReworkEvent {
  type: "requested" | "partner_accepted" | "partner_declined" | "work_started" | "submitted_for_review" | "completed";
  occurredAt: string;
  actorUid: string;
  note: string;
}

export interface CleaningReworkRequest {
  requestId: string;
  orderId: string;
  customerId: string;
  buildingId: string;
  vendorId: string;
  complaintTitle: string;
  complaintDetail: string;
  areas: CleaningReworkArea[];
  customerPhotoFileIds: string[];
  desiredAt: string;
  partnerNote: string;
  customerNotice: { requested: boolean; status: "pending" | "not_requested" | "sent" | "failed"; messageDeliveryId: string };
  status: CleaningReworkStatus;
  revision: number;
  declineReason: string;
  completionReportId: string;
  createdAt: string;
  createdByUid: string;
  updatedAt: string;
  events: CleaningReworkEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every(key => expected.has(key));
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safeActorUid(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

export function validateCleaningReworkRequest(value: unknown): value is CleaningReworkRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "requestId", "orderId", "customerId", "buildingId", "vendorId", "complaintTitle", "complaintDetail", "areas",
    "customerPhotoFileIds", "desiredAt", "partnerNote", "customerNotice", "status", "revision", "declineReason",
    "completionReportId", "createdAt", "createdByUid", "updatedAt", "events",
  ])) return false;
  if (![value.requestId, value.orderId].every(id => UUID_PATTERN.test(String(id || "")))
    || !safeId(value.customerId) || !safeId(value.buildingId)
    || typeof value.vendorId !== "string" || !SAFE_ID_PATTERN.test(value.vendorId)
    || typeof value.complaintTitle !== "string" || value.complaintTitle.trim().length < 2 || value.complaintTitle.length > 200
    || typeof value.complaintDetail !== "string" || value.complaintDetail.trim().length < 2 || value.complaintDetail.length > 1000
    || !Array.isArray(value.areas) || value.areas.length < 1 || value.areas.length > REWORK_AREAS.length
    || !value.areas.every(area => REWORK_AREAS.includes(area as CleaningReworkArea)) || new Set(value.areas).size !== value.areas.length
    || !Array.isArray(value.customerPhotoFileIds) || value.customerPhotoFileIds.length > 8
    || !value.customerPhotoFileIds.every(id => typeof id === "string" && DRIVE_FILE_ID_PATTERN.test(id))
    || new Set(value.customerPhotoFileIds).size !== value.customerPhotoFileIds.length
    || !canonicalTimestamp(value.desiredAt) || typeof value.partnerNote !== "string" || value.partnerNote.trim().length < 2 || value.partnerNote.length > 500
    || !isRecord(value.customerNotice) || !hasExactKeys(value.customerNotice, ["requested", "status", "messageDeliveryId"])
    || typeof value.customerNotice.requested !== "boolean"
    || !["pending", "not_requested", "sent", "failed"].includes(String(value.customerNotice.status))
    || typeof value.customerNotice.messageDeliveryId !== "string" || value.customerNotice.messageDeliveryId.length > 150
    || (value.customerNotice.status === "not_requested") !== (value.customerNotice.requested === false)
    || (value.customerNotice.status === "sent") !== Boolean(value.customerNotice.messageDeliveryId)
    || !["requested", "accepted", "declined", "in_progress", "awaiting_review", "completed"].includes(String(value.status))
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.declineReason !== "string" || value.declineReason.length > 500
    || (value.status === "declined") !== Boolean(value.declineReason)
    || typeof value.completionReportId !== "string" || value.completionReportId.length > 80
    || (value.status === "completed") !== Boolean(value.completionReportId)
    || !canonicalTimestamp(value.createdAt) || !safeActorUid(value.createdByUid) || !canonicalTimestamp(value.updatedAt)
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 50
    || !value.events.every(event => isRecord(event) && hasExactKeys(event, ["type", "occurredAt", "actorUid", "note"])
      && ["requested", "partner_accepted", "partner_declined", "work_started", "submitted_for_review", "completed"].includes(String(event.type))
      && canonicalTimestamp(event.occurredAt) && safeActorUid(event.actorUid) && typeof event.note === "string" && event.note.length <= 500)) return false;
  return value.events[0].type === "requested"
    && value.events[0].actorUid === value.createdByUid
    && value.events[0].occurredAt === value.createdAt
    && (value.status === "completed") === (value.events[value.events.length - 1].type === "completed");
}

export function createCleaningReworkRequest(
  input: unknown,
  actorUid: string,
  now: string,
): { ok: true; request: CleaningReworkRequest } | { ok: false; error: string } {
  if (!isRecord(input) || !hasExactKeys(input, [
    "requestId", "orderId", "customerId", "buildingId", "vendorId", "complaintTitle", "complaintDetail", "areas",
    "customerPhotoFileIds", "desiredAt", "partnerNote", "customerNoticeRequested",
  ]) || !safeActorUid(actorUid) || !canonicalTimestamp(now)
    || !UUID_PATTERN.test(String(input.requestId || "")) || !UUID_PATTERN.test(String(input.orderId || ""))
    || !safeId(input.customerId) || !safeId(input.buildingId)
    || typeof input.vendorId !== "string" || !SAFE_ID_PATTERN.test(input.vendorId)
    || typeof input.complaintTitle !== "string" || input.complaintTitle.trim().length < 2 || input.complaintTitle.length > 200
    || typeof input.complaintDetail !== "string" || input.complaintDetail.trim().length < 2 || input.complaintDetail.length > 1000
    || !Array.isArray(input.areas) || input.areas.length < 1 || input.areas.length > REWORK_AREAS.length
    || !input.areas.every(area => REWORK_AREAS.includes(area as CleaningReworkArea)) || new Set(input.areas).size !== input.areas.length
    || !Array.isArray(input.customerPhotoFileIds) || input.customerPhotoFileIds.length > 8
    || !input.customerPhotoFileIds.every(id => typeof id === "string" && DRIVE_FILE_ID_PATTERN.test(id))
    || new Set(input.customerPhotoFileIds).size !== input.customerPhotoFileIds.length
    || !canonicalTimestamp(input.desiredAt) || typeof input.partnerNote !== "string" || input.partnerNote.trim().length < 2 || input.partnerNote.length > 500
    || typeof input.customerNoticeRequested !== "boolean") return { ok: false, error: "invalid_cleaning_rework_input" };

  const request: CleaningReworkRequest = {
    requestId: input.requestId as string,
    orderId: input.orderId as string,
    customerId: input.customerId as string,
    buildingId: input.buildingId as string,
    vendorId: input.vendorId,
    complaintTitle: input.complaintTitle.trim(),
    complaintDetail: input.complaintDetail.trim(),
    areas: [...input.areas] as CleaningReworkArea[],
    customerPhotoFileIds: [...input.customerPhotoFileIds] as string[],
    desiredAt: input.desiredAt as string,
    partnerNote: input.partnerNote.trim(),
    customerNotice: { requested: input.customerNoticeRequested, status: input.customerNoticeRequested ? "pending" : "not_requested", messageDeliveryId: "" },
    status: "requested",
    revision: 1,
    declineReason: "",
    completionReportId: "",
    createdAt: now,
    createdByUid: actorUid,
    updatedAt: now,
    events: [{ type: "requested", occurredAt: now, actorUid, note: "고객 재작업 요청 등록" }],
  };
  return validateCleaningReworkRequest(request) ? { ok: true, request } : { ok: false, error: "invalid_cleaning_rework_input" };
}

function validTransitionInput(value: unknown): value is { actorUid: string; expectedRevision: number; now: string } {
  return isRecord(value) && safeActorUid(value.actorUid) && Number.isSafeInteger(value.expectedRevision)
    && Number(value.expectedRevision) > 0 && canonicalTimestamp(value.now);
}

export function recordCleaningReworkPartnerResponse(
  value: unknown,
  input: { vendorId: string; actorUid: string; expectedRevision: number; action: "accept" | "decline"; reason: string; now: string },
): { ok: true; request: CleaningReworkRequest } | { ok: false; error: string } {
  if (!validTransitionInput(input) || typeof input.vendorId !== "string" || typeof input.reason !== "string"
    || !["accept", "decline"].includes(input.action)) return { ok: false, error: "invalid_cleaning_rework_input" };
  if (!validateCleaningReworkRequest(value)) return { ok: false, error: "cleaning_rework_stored_data_invalid" };
  if (value.vendorId !== input.vendorId) return { ok: false, error: "cleaning_rework_forbidden" };
  if (value.revision !== input.expectedRevision) return { ok: false, error: "cleaning_rework_revision_conflict" };
  if (value.status !== "requested") return { ok: false, error: "cleaning_rework_invalid_transition" };
  if (input.action === "decline" && (input.reason.trim().length < 2 || input.reason.length > 500)) {
    return { ok: false, error: "cleaning_rework_decline_reason_required" };
  }
  const accepted = input.action === "accept";
  const request: CleaningReworkRequest = {
    ...value,
    status: accepted ? "accepted" : "declined",
    revision: value.revision + 1,
    declineReason: accepted ? "" : input.reason.trim(),
    updatedAt: input.now,
    events: [...value.events, { type: accepted ? "partner_accepted" : "partner_declined", occurredAt: input.now,
      actorUid: input.actorUid, note: accepted ? "파트너가 재작업 요청 수락" : input.reason.trim() }],
  };
  return { ok: true, request };
}

export function recordCleaningReworkProgress(
  value: unknown,
  input: { vendorId: string; actorUid: string; expectedRevision: number; nextStatus: "in_progress" | "awaiting_review"; now: string },
): { ok: true; request: CleaningReworkRequest } | { ok: false; error: string } {
  if (!validTransitionInput(input) || typeof input.vendorId !== "string"
    || !["in_progress", "awaiting_review"].includes(input.nextStatus)) return { ok: false, error: "invalid_cleaning_rework_input" };
  if (!validateCleaningReworkRequest(value)) return { ok: false, error: "cleaning_rework_stored_data_invalid" };
  if (value.vendorId !== input.vendorId) return { ok: false, error: "cleaning_rework_forbidden" };
  if (value.revision !== input.expectedRevision) return { ok: false, error: "cleaning_rework_revision_conflict" };
  const allowed = value.status === "accepted" && input.nextStatus === "in_progress"
    || value.status === "in_progress" && input.nextStatus === "awaiting_review";
  if (!allowed) return { ok: false, error: "cleaning_rework_invalid_transition" };
  const request: CleaningReworkRequest = {
    ...value, status: input.nextStatus, revision: value.revision + 1, updatedAt: input.now,
    events: [...value.events, { type: input.nextStatus === "in_progress" ? "work_started" : "submitted_for_review",
      occurredAt: input.now, actorUid: input.actorUid, note: input.nextStatus === "in_progress" ? "재작업 시작" : "재작업 완료 보고 접수" }],
  };
  return { ok: true, request };
}

export function recordCleaningReworkCompletion(
  value: unknown,
  input: { actorUid: string; expectedRevision: number; reportId: string; now: string },
): { ok: true; request: CleaningReworkRequest } | { ok: false; error: string } {
  if (!validTransitionInput(input) || typeof input.reportId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(input.reportId)) {
    return { ok: false, error: "invalid_cleaning_rework_input" };
  }
  if (!validateCleaningReworkRequest(value)) return { ok: false, error: "cleaning_rework_stored_data_invalid" };
  if (value.revision !== input.expectedRevision) return { ok: false, error: "cleaning_rework_revision_conflict" };
  if (value.status !== "awaiting_review") return { ok: false, error: "cleaning_rework_invalid_transition" };
  const request: CleaningReworkRequest = {
    ...value, status: "completed", completionReportId: input.reportId, revision: value.revision + 1, updatedAt: input.now,
    events: [...value.events, { type: "completed", occurredAt: input.now, actorUid: input.actorUid, note: `재작업 검수 완료 · ${input.reportId}` }],
  };
  return { ok: true, request };
}

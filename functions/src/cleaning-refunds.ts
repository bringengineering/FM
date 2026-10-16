export type CleaningRefundRequest = {
  requestId: string; orderId: string; customerId: string; buildingId: string; invoiceId: string;
  type: "partial" | "full"; amount: number; reason: string;
  paymentMethod: "card" | "bank_transfer" | "cash" | "other"; csReference: string; note: string;
  originalPaidAmount: number; remainingPaidAmount: number;
  status: "pending" | "approved" | "declined" | "processed"; revision: number;
  createdAt: string; updatedAt: string; updatedBy: string; providerRef: string; evidenceRef: string;
  events: Array<{ type: string; occurredAt: string; actorUid: string; note: string; providerRef?: string; evidenceRef?: string }>;
};

type RefundContext = { orderId: string; customerId: string; buildingId: string; invoiceId: string; paidAmount: number };
type RefundResult = { ok: true; request: CleaningRefundRequest } | { ok: false; error: string };
const ID = /^[A-Za-z0-9_-]{1,150}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validId = (value: unknown): value is string => typeof value === "string" && ID.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
const validTime = (value: unknown): value is string => typeof value === "string" && ISO_TIME.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validText = (value: unknown, max: number, min = 0): value is string => typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max;
const error = (code: string): RefundResult => ({ ok: false, error: code });

export function validateCleaningRefundRequest(value: unknown): value is CleaningRefundRequest {
  return isRecord(value) && validId(value.requestId) && validId(value.orderId) && validId(value.customerId)
    && validId(value.buildingId) && validId(value.invoiceId) && ["partial", "full"].includes(String(value.type))
    && Number.isSafeInteger(value.amount) && Number(value.amount) > 0 && validText(value.reason, 200, 1)
    && ["card", "bank_transfer", "cash", "other"].includes(String(value.paymentMethod))
    && validText(value.csReference, 100) && validText(value.note, 200) && Number.isSafeInteger(value.originalPaidAmount)
    && Number(value.originalPaidAmount) > 0 && Number.isSafeInteger(value.remainingPaidAmount)
    && ["pending", "approved", "declined", "processed"].includes(String(value.status))
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && validTime(value.createdAt)
    && validTime(value.updatedAt) && validId(value.updatedBy) && validText(value.providerRef, 160)
    && validText(value.evidenceRef, 500) && Array.isArray(value.events);
}

function reservedAmount(collection: unknown): number | null {
  if (collection === null || collection === undefined) return 0;
  if (!isRecord(collection)) return null;
  let total = 0;
  for (const [key, value] of Object.entries(collection)) {
    if (!validateCleaningRefundRequest(value) || value.requestId !== key) return null;
    if (value.status !== "declined") { total += value.amount; if (!Number.isSafeInteger(total)) return null; }
  }
  return total;
}

export function cleaningRefundCoverageIsValid(collection: unknown, paidAmount: number): boolean {
  const reserved = reservedAmount(collection);
  return reserved !== null && Number.isSafeInteger(paidAmount) && paidAmount >= 0 && reserved <= paidAmount;
}

export function createCleaningRefundRequest(current: unknown, input: unknown, context: RefundContext, actorUid: string, now: string): RefundResult {
  if (!isRecord(input) || Object.keys(input).some(key => !["requestId", "orderId", "customerId", "buildingId", "invoiceId", "type", "amount", "reason", "paymentMethod", "csReference", "note"].includes(key))
    || !validId(input.requestId) || !validId(actorUid) || !validTime(now) || input.orderId !== context.orderId
    || input.customerId !== context.customerId || input.buildingId !== context.buildingId || input.invoiceId !== context.invoiceId
    || !["partial", "full"].includes(String(input.type)) || !Number.isSafeInteger(input.amount) || Number(input.amount) <= 0
    || !validText(input.reason, 200, 1) || !["card", "bank_transfer", "cash", "other"].includes(String(input.paymentMethod))
    || !validText(input.csReference ?? "", 100) || !validText(input.note ?? "", 200)
    || !Number.isSafeInteger(context.paidAmount) || context.paidAmount <= 0) return error("invalid_cleaning_refund_input");
  if (isRecord(current) && current[input.requestId] !== undefined) return error("cleaning_refund_conflict");
  const reserved = reservedAmount(current);
  if (reserved === null) return error("cleaning_refund_stored_data_invalid");
  const available = context.paidAmount - reserved;
  if (available <= 0 || Number(input.amount) > available) return error("cleaning_refund_amount_exceeds_available");
  if (input.type === "full" && Number(input.amount) !== available) return error("cleaning_refund_full_amount_mismatch");
  const request: CleaningRefundRequest = {
    requestId: input.requestId, orderId: context.orderId, customerId: context.customerId, buildingId: context.buildingId,
    invoiceId: context.invoiceId, type: input.type as "partial" | "full", amount: input.amount as number,
    reason: input.reason as string, paymentMethod: input.paymentMethod as CleaningRefundRequest["paymentMethod"],
    csReference: input.csReference as string, note: input.note as string, originalPaidAmount: context.paidAmount,
    remainingPaidAmount: available - (input.amount as number), status: "pending", revision: 1, createdAt: now,
    updatedAt: now, updatedBy: actorUid, providerRef: "", evidenceRef: "",
    events: [{ type: "requested", occurredAt: now, actorUid, note: input.reason as string }],
  };
  return { ok: true, request };
}

export function decideCleaningRefundRequest(current: unknown, input: { decision: "approve" | "decline"; expectedRevision: number; note: string; actorUid: string; now: string }): RefundResult {
  if (!validateCleaningRefundRequest(current)) return error("cleaning_refund_not_found");
  if (!input || !["approve", "decline"].includes(input.decision) || !Number.isSafeInteger(input.expectedRevision)
    || !validId(input.actorUid) || !validTime(input.now) || !validText(input.note, 500, 1)) return error("cleaning_refund_decision_reason_required");
  if (current.revision !== input.expectedRevision) return error("cleaning_refund_revision_conflict");
  if (current.status !== "pending") return error("cleaning_refund_invalid_transition");
  const status = input.decision === "approve" ? "approved" : "declined";
  return { ok: true, request: { ...current, status, revision: current.revision + 1, updatedAt: input.now, updatedBy: input.actorUid,
    events: [...current.events, { type: status, occurredAt: input.now, actorUid: input.actorUid, note: input.note }] } };
}

export function recordCleaningRefundExecution(current: unknown, input: { expectedRevision: number; providerRef: string; evidenceRef: string; actorUid: string; now: string }): RefundResult {
  if (!validateCleaningRefundRequest(current)) return error("cleaning_refund_not_found");
  if (!input || !Number.isSafeInteger(input.expectedRevision) || !validId(input.actorUid) || !validTime(input.now)
    || !validText(input.providerRef, 160, 1) || !validText(input.evidenceRef, 500, 1)) return error("cleaning_refund_execution_proof_required");
  if (current.revision !== input.expectedRevision) return error("cleaning_refund_revision_conflict");
  if (current.status !== "approved") return error("cleaning_refund_invalid_transition");
  return { ok: true, request: { ...current, status: "processed", providerRef: input.providerRef, evidenceRef: input.evidenceRef,
    revision: current.revision + 1, updatedAt: input.now, updatedBy: input.actorUid,
    events: [...current.events, { type: "processed", occurredAt: input.now, actorUid: input.actorUid,
      note: "환불 처리 증빙 등록", providerRef: input.providerRef, evidenceRef: input.evidenceRef }] } };
}

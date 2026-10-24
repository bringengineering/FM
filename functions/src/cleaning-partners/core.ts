import {
  CLEANING_ORDER_SERVICE_TYPES,
  type CleaningOrderRecord,
} from "../cleaning-orders/contracts.js";
import {
  CLEANING_PARTNER_DECLINE_REASONS,
  CLEANING_PARTNER_OFFER_STATUSES,
  CLEANING_PARTNER_PROGRESS_STATES,
  CLEANING_EXTRA_CHARGE_SERVICES,
  CLEANING_DELAY_ACTIONS,
  CLEANING_DELAY_ISSUE_TYPES,
  type CleaningExtraChargeRequest,
  type CleaningExtraChargeService,
  type CleaningPartnerDispatchRecord,
  type CleaningPartnerAccountBinding,
  type CleaningPartnerOffer,
  type CleaningPartnerOfferInput,
  type CleaningPartnerOfferInputDecision,
  type CleaningPartnerOfferResponseDecision,
} from "./contracts.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,150}$/u;
const PROHIBITED_KEYS = new Set(["customer", "customerId", "customerName", "customerPhone", "address", "buildingId", "buildingAddress", "contact"]);
const DECLINE_ACTION_REASONS = new Set<string>(CLEANING_PARTNER_DECLINE_REASONS);
const EXTRA_CHARGE_SERVICES = new Set<string>(CLEANING_EXTRA_CHARGE_SERVICES);
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{6,200}$/u;

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

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

function safeActorUid(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

export function validateCleaningExtraChargeRequest(value: unknown): value is CleaningExtraChargeRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "requestId", "orderId", "customerId", "buildingId", "vendorId", "serviceType", "amount", "reason",
    "evidenceFileIds", "status", "revision", "communication", "decisionEvidenceRef", "decidedAt", "decidedByUid",
    "createdAt", "createdByUid", "updatedAt", "events",
  ])) return false;
  if (!UUID_PATTERN.test(String(value.requestId || "")) || !UUID_PATTERN.test(String(value.orderId || ""))
    || !UUID_PATTERN.test(String(value.customerId || "")) || !UUID_PATTERN.test(String(value.buildingId || ""))
    || !safeId(value.vendorId) || !EXTRA_CHARGE_SERVICES.has(String(value.serviceType))
    || !Number.isSafeInteger(value.amount) || Number(value.amount) < 1 || Number(value.amount) > 100_000_000
    || typeof value.reason !== "string" || value.reason.trim().length < 5 || value.reason.length > 200
    || !Array.isArray(value.evidenceFileIds) || value.evidenceFileIds.length < 1 || value.evidenceFileIds.length > 5
    || !value.evidenceFileIds.every(id => typeof id === "string" && DRIVE_FILE_ID_PATTERN.test(id))
    || new Set(value.evidenceFileIds).size !== value.evidenceFileIds.length
    || !["draft", "awaiting_customer_approval", "approved", "declined"].includes(String(value.status))
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !isRecord(value.communication) || !hasExactKeys(value.communication, ["status", "providerMessageId", "updatedAt"])
    || !["not_sent", "accepted", "failed"].includes(String(value.communication.status))
    || typeof value.communication.providerMessageId !== "string" || value.communication.providerMessageId.length > 200
    || !canonicalTimestamp(value.communication.updatedAt)
    || typeof value.decisionEvidenceRef !== "string" || value.decisionEvidenceRef.length > 500
    || typeof value.decidedAt !== "string" || (value.decidedAt !== "" && !canonicalTimestamp(value.decidedAt))
    || typeof value.decidedByUid !== "string" || (value.decidedByUid !== "" && !safeActorUid(value.decidedByUid))
    || !canonicalTimestamp(value.createdAt) || !safeActorUid(value.createdByUid) || !canonicalTimestamp(value.updatedAt)
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 50
    || !value.events.every(event => isRecord(event) && hasExactKeys(event, ["type", "occurredAt", "actorUid", "note"])
      && ["request_created", "message_accepted", "message_failed", "customer_approved", "customer_declined"].includes(String(event.type))
      && canonicalTimestamp(event.occurredAt) && safeActorUid(event.actorUid) && typeof event.note === "string" && event.note.length <= 500)) return false;
  if (value.communication.status === "accepted" && !value.communication.providerMessageId
    || value.communication.status !== "accepted" && value.communication.providerMessageId) return false;
  const hasDecision = value.status === "approved" || value.status === "declined";
  if (hasDecision !== Boolean(value.decisionEvidenceRef && value.decidedAt && value.decidedByUid)) return false;
  if (hasDecision && value.communication.status !== "accepted") return false;
  if (value.status === "awaiting_customer_approval" && value.communication.status !== "accepted") return false;
  return true;
}

export function createCleaningExtraChargeRequest(
  input: unknown,
  actorUid: string,
  now: string,
): { ok: true; request: CleaningExtraChargeRequest } | { ok: false; error: string } {
  if (!isRecord(input) || !hasExactKeys(input, ["requestId", "orderId", "customerId", "buildingId", "vendorId", "serviceType", "amount", "reason", "evidenceFileIds"])
    || !safeActorUid(actorUid) || !canonicalTimestamp(now)
    || !UUID_PATTERN.test(String(input.requestId || "")) || !UUID_PATTERN.test(String(input.orderId || ""))
    || !UUID_PATTERN.test(String(input.customerId || "")) || !UUID_PATTERN.test(String(input.buildingId || ""))
    || !safeId(input.vendorId) || !EXTRA_CHARGE_SERVICES.has(String(input.serviceType))
    || !Number.isSafeInteger(input.amount) || Number(input.amount) < 1 || Number(input.amount) > 100_000_000
    || typeof input.reason !== "string" || input.reason.trim().length < 5 || input.reason.length > 200
    || !Array.isArray(input.evidenceFileIds) || input.evidenceFileIds.length < 1 || input.evidenceFileIds.length > 5
    || !input.evidenceFileIds.every(id => typeof id === "string" && DRIVE_FILE_ID_PATTERN.test(id))
    || new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length) {
    return { ok: false, error: "invalid_cleaning_extra_charge_input" };
  }
  const request: CleaningExtraChargeRequest = {
    requestId: input.requestId as string,
    orderId: input.orderId as string,
    customerId: input.customerId as string,
    buildingId: input.buildingId as string,
    vendorId: input.vendorId as string,
    serviceType: input.serviceType as CleaningExtraChargeService,
    amount: input.amount as number,
    reason: input.reason.trim(),
    evidenceFileIds: [...input.evidenceFileIds] as string[],
    status: "draft",
    revision: 1,
    communication: { status: "not_sent", providerMessageId: "", updatedAt: now },
    decisionEvidenceRef: "",
    decidedAt: "",
    decidedByUid: "",
    createdAt: now,
    createdByUid: actorUid,
    updatedAt: now,
    events: [{ type: "request_created", occurredAt: now, actorUid, note: "추가 서비스 승인 요청 작성" }],
  };
  return validateCleaningExtraChargeRequest(request)
    ? { ok: true, request }
    : { ok: false, error: "invalid_cleaning_extra_charge_input" };
}

export function recordCleaningExtraChargeDelivery(
  value: unknown,
  input: { actorUid: string; expectedRevision: number; result: "accepted" | "failed"; providerMessageId: string; now: string },
): { ok: true; request: CleaningExtraChargeRequest } | { ok: false; error: string } {
  if (!isRecord(input) || !safeActorUid(input.actorUid) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
    || !["accepted", "failed"].includes(input.result) || typeof input.providerMessageId !== "string"
    || input.providerMessageId.length > 200 || !canonicalTimestamp(input.now)
    || (input.result === "accepted") !== Boolean(input.providerMessageId)) return { ok: false, error: "invalid_cleaning_extra_charge_input" };
  if (!validateCleaningExtraChargeRequest(value)) return { ok: false, error: "cleaning_extra_charge_data_invalid" };
  if (value.revision !== input.expectedRevision) return { ok: false, error: "cleaning_extra_charge_revision_conflict" };
  if (value.status !== "draft") return { ok: false, error: "cleaning_extra_charge_already_sent" };
  const accepted = input.result === "accepted";
  const request: CleaningExtraChargeRequest = {
    ...value,
    status: accepted ? "awaiting_customer_approval" : "draft",
    revision: value.revision + 1,
    communication: { status: accepted ? "accepted" : "failed", providerMessageId: accepted ? input.providerMessageId : "", updatedAt: input.now },
    updatedAt: input.now,
    events: [...value.events, {
      type: accepted ? "message_accepted" : "message_failed", occurredAt: input.now,
      actorUid: input.actorUid, note: accepted ? "고객 메시지 발송 요청 접수" : "고객 메시지 발송 실패",
    }],
  };
  return { ok: true, request };
}

export function recordCleaningExtraChargeDecision(
  value: unknown,
  input: { actorUid: string; expectedRevision: number; decision: "approve" | "decline"; evidenceRef: string; now: string },
): { ok: true; request: CleaningExtraChargeRequest } | { ok: false; error: string } {
  if (!isRecord(input) || !safeActorUid(input.actorUid) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
    || !["approve", "decline"].includes(input.decision) || typeof input.evidenceRef !== "string"
    || input.evidenceRef.trim().length < 3 || input.evidenceRef.length > 500 || !canonicalTimestamp(input.now)) {
    return { ok: false, error: "cleaning_extra_charge_decision_evidence_required" };
  }
  if (!validateCleaningExtraChargeRequest(value)) return { ok: false, error: "cleaning_extra_charge_data_invalid" };
  if (value.revision !== input.expectedRevision) return { ok: false, error: "cleaning_extra_charge_revision_conflict" };
  if (value.status !== "awaiting_customer_approval") return { ok: false, error: "cleaning_extra_charge_not_awaiting_decision" };
  const approved = input.decision === "approve";
  const request: CleaningExtraChargeRequest = {
    ...value,
    status: approved ? "approved" : "declined",
    revision: value.revision + 1,
    decisionEvidenceRef: input.evidenceRef.trim(),
    decidedAt: input.now,
    decidedByUid: input.actorUid,
    updatedAt: input.now,
    events: [...value.events, {
      type: approved ? "customer_approved" : "customer_declined", occurredAt: input.now,
      actorUid: input.actorUid, note: input.evidenceRef.trim(),
    }],
  };
  return validateCleaningExtraChargeRequest(request)
    ? { ok: true, request }
    : { ok: false, error: "cleaning_extra_charge_data_invalid" };
}

export function normalizeCleaningPartnerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@.][^\s@]*@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email)) return null;
  return email;
}

export function bindCleaningPartnerAccount(
  value: unknown,
  vendorId: string,
  emailValue: unknown,
  enabled: boolean,
  actorUid: string,
  now: string,
): { ok: true; accounts: Record<string, CleaningPartnerAccountBinding> } | { ok: false; error: string } {
  if (!isRecord(value) || !safeId(vendorId) || typeof enabled !== "boolean"
    || !safeActorUid(actorUid) || !canonicalTimestamp(now)) return { ok: false, error: "invalid_cleaning_partner_input" };
  const email = normalizeCleaningPartnerEmail(emailValue);
  if (!email) return { ok: false, error: "invalid_cleaning_partner_email" };
  const accounts: Record<string, CleaningPartnerAccountBinding> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!safeId(key) || !isRecord(raw) || !hasExactKeys(raw, ["vendorId", "email", "enabled", "updatedAt", "updatedByUid"])
      || raw.vendorId !== key || normalizeCleaningPartnerEmail(raw.email) !== raw.email
      || typeof raw.enabled !== "boolean" || !canonicalTimestamp(raw.updatedAt) || !safeActorUid(raw.updatedByUid)) {
      return { ok: false, error: "cleaning_partner_account_data_invalid" };
    }
    accounts[key] = raw as unknown as CleaningPartnerAccountBinding;
  }
  if (enabled && Object.values(accounts).some(binding => binding.vendorId !== vendorId && binding.enabled && binding.email === email)) {
    return { ok: false, error: "cleaning_partner_email_already_bound" };
  }
  accounts[vendorId] = { vendorId, email, enabled, updatedAt: now, updatedByUid: actorUid };
  return { ok: true, accounts };
}

export function normalizeCleaningPartnerOfferInput(input: unknown): CleaningPartnerOfferInputDecision {
  if (!isRecord(input) || !hasExactKeys(input, ["requestId", "orderId", "vendorId", "supplierAmount", "expiresAt"])) {
    return { ok: false, error: "invalid_cleaning_partner_input" };
  }
  const expiresAt = input.expiresAt;
  if (!UUID_PATTERN.test(String(input.requestId || ""))
    || !UUID_PATTERN.test(String(input.orderId || ""))
    || !safeId(input.vendorId)
    || !Number.isSafeInteger(input.supplierAmount) || Number(input.supplierAmount) < 1 || Number(input.supplierAmount) > 50_000_000
    || !canonicalTimestamp(expiresAt)) {
    return { ok: false, error: "invalid_cleaning_partner_input" };
  }
  return { ok: true, value: {
    requestId: input.requestId as string,
    orderId: input.orderId as string,
    vendorId: input.vendorId,
    supplierAmount: Number(input.supplierAmount),
    expiresAt,
  } };
}

function validOfferEvent(value: unknown, expectedOfferId?: string): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "occurredAt", "actorUid", "note"])) return false;
  return ["offered", "accepted", "declined", "expired", "reassigned", "departed", "arrived", "started", "photos_submitted", "completed"].includes(String(value.type))
    && canonicalTimestamp(value.occurredAt)
    && safeActorUid(value.actorUid)
    && typeof value.note === "string" && value.note.length <= 200 && value.note === value.note.trim()
    && (expectedOfferId === undefined || expectedOfferId.length > 0);
}

function validDispatchEvent(value: unknown): boolean {
  if (!isRecord(value) || !canonicalTimestamp(value.occurredAt) || !safeActorUid(value.actorUid)
    || !safeId(value.vendorId) || typeof value.note !== "string" || value.note !== value.note.trim()) return false;
  if (["offer_created", "offer_accepted", "offer_declined", "offer_expired", "offer_reassigned", "progress_updated"].includes(String(value.type))) {
    return hasExactKeys(value, ["type", "occurredAt", "actorUid", "vendorId", "note"]) && value.note.length <= 200;
  }
  if (value.type === "incident_reported") {
    return hasExactKeys(value, ["type", "occurredAt", "actorUid", "vendorId", "note", "incidentId", "issueType", "scheduledAt", "delayMinutes"])
      && UUID_PATTERN.test(String(value.incidentId || ""))
      && CLEANING_DELAY_ISSUE_TYPES.includes(value.issueType as typeof CLEANING_DELAY_ISSUE_TYPES[number])
      && canonicalTimestamp(value.scheduledAt)
      && Number.isSafeInteger(value.delayMinutes) && Number(value.delayMinutes) >= 0 && Number(value.delayMinutes) <= 1440
      && value.note.length <= 500;
  }
  return value.type === "incident_action_logged"
    && hasExactKeys(value, ["type", "occurredAt", "actorUid", "vendorId", "note", "incidentId", "action"])
    && UUID_PATTERN.test(String(value.incidentId || ""))
    && CLEANING_DELAY_ACTIONS.includes(value.action as typeof CLEANING_DELAY_ACTIONS[number])
    && value.note.length <= 500;
}

function validateOffer(value: unknown, expectedOrderId: string): value is CleaningPartnerOffer {
  if (!isRecord(value) || Object.keys(value).some(key => PROHIBITED_KEYS.has(key))) return false;
  if (!hasExactKeys(value, ["id", "orderId", "vendorId", "serviceType", "region", "desiredDate", "supplierAmount", "expiresAt", "status", "revision", "createdAt", "createdByUid", "respondedAt", "declineReason", "progress", "events"])) return false;
  if (!UUID_PATTERN.test(String(value.id || "")) || value.orderId !== expectedOrderId
    || !safeId(value.vendorId)
    || typeof value.serviceType !== "string" || !CLEANING_ORDER_SERVICE_TYPES.includes(value.serviceType as typeof CLEANING_ORDER_SERVICE_TYPES[number])
    || typeof value.region !== "string" || value.region.length > 80 || value.region !== value.region.trim()
    || !validDate(value.desiredDate)
    || !Number.isSafeInteger(value.supplierAmount) || Number(value.supplierAmount) < 1 || Number(value.supplierAmount) > 50_000_000
    || !canonicalTimestamp(value.expiresAt)
    || !CLEANING_PARTNER_OFFER_STATUSES.includes(value.status as typeof CLEANING_PARTNER_OFFER_STATUSES[number])
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !canonicalTimestamp(value.createdAt) || !safeActorUid(value.createdByUid)
    || (value.respondedAt !== "" && !canonicalTimestamp(value.respondedAt))
    || (value.declineReason !== "" && !DECLINE_ACTION_REASONS.has(String(value.declineReason)))
    || !CLEANING_PARTNER_PROGRESS_STATES.includes(value.progress as typeof CLEANING_PARTNER_PROGRESS_STATES[number])
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 100
    || !value.events.every(event => validOfferEvent(event))) return false;
  const responseEvent = [...value.events as Record<string, unknown>[]].reverse().find((event: Record<string, unknown>) =>
    ["accepted", "declined", "expired", "reassigned"].includes(String(event.type)));
  return value.status === "offered"
    ? value.respondedAt === ""
    : Boolean(responseEvent && responseEvent.occurredAt === value.respondedAt);
}

export function validateCleaningPartnerDispatch(value: unknown, expectedOrderId: string): value is CleaningPartnerDispatchRecord {
  if (!UUID_PATTERN.test(expectedOrderId) || !isRecord(value)
    || Object.keys(value).some(key => PROHIBITED_KEYS.has(key))
    || !hasExactKeys(value, ["orderId", "revision", "acceptedOfferId", "offers", "events"])
    || value.orderId !== expectedOrderId
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || (value.acceptedOfferId !== null && !UUID_PATTERN.test(String(value.acceptedOfferId || "")))
    || !Array.isArray(value.offers) || value.offers.length > 10
    || !value.offers.every(offer => validateOffer(offer, expectedOrderId))
    || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 100
    || !value.events.every(validDispatchEvent)) return false;
  const acceptedOffers = value.offers.filter(offer => isRecord(offer) && offer.status === "accepted");
  return acceptedOffers.length <= 1
    && (value.acceptedOfferId === null || (acceptedOffers.length === 1 && acceptedOffers[0].id === value.acceptedOfferId));
}

export function createCleaningPartnerOffer(
  input: CleaningPartnerOfferInput,
  actorUid: string,
  order: unknown,
  building: unknown,
  now: string,
): CleaningPartnerOffer | null {
  if (!safeActorUid(actorUid) || !canonicalTimestamp(now) || !canonicalTimestamp(input.expiresAt)
    || Date.parse(input.expiresAt) <= Date.parse(now)
    || !isRecord(order) || order.id !== input.orderId
    || !["approval_pending", "scheduled"].includes(String(order.status))
    || !CLEANING_ORDER_SERVICE_TYPES.includes(order.serviceType as typeof CLEANING_ORDER_SERVICE_TYPES[number])
    || !validDate(order.desiredDate)
    || !isRecord(building) || building.archived === true || building.deleted === true) return null;
  const address = [building.roadAddress, building.address, building.jibunAddress].find(value => typeof value === "string" && value.trim()) as string | undefined;
  const regionParts = String(address || "").trim().split(/\s+/u);
  const region = regionParts.find(part => /(?:시|군|구)$/u.test(part) && !/(?:특별시|광역시|자치시)$/u.test(part))
    || regionParts.find(part => /(?:특별시|광역시|자치시)$/u.test(part));
  if (!region) return null;
  const initialEvent = { type: "offered" as const, occurredAt: now, actorUid, note: "" };
  return {
    id: input.requestId,
    orderId: input.orderId,
    vendorId: input.vendorId,
    serviceType: order.serviceType as CleaningPartnerOffer["serviceType"],
    region,
    desiredDate: order.desiredDate as string,
    supplierAmount: input.supplierAmount,
    expiresAt: input.expiresAt,
    status: "offered",
    revision: 1,
    createdAt: now,
    createdByUid: actorUid,
    respondedAt: "",
    declineReason: "",
    progress: "accepted",
    events: [initialEvent],
  };
}

export function createCleaningPartnerDispatch(
  offer: CleaningPartnerOffer,
  actorUid: string,
  now: string,
): CleaningPartnerDispatchRecord | null {
  if (!validateOffer(offer, offer.orderId) || !safeActorUid(actorUid) || !canonicalTimestamp(now)
    || offer.status !== "offered" || offer.createdByUid !== actorUid || offer.createdAt !== now) return null;
  const dispatch: CleaningPartnerDispatchRecord = {
    orderId: offer.orderId,
    revision: 1,
    acceptedOfferId: null,
    offers: [offer],
    events: [{ type: "offer_created", occurredAt: now, actorUid, vendorId: offer.vendorId, note: "" }],
  };
  return validateCleaningPartnerDispatch(dispatch, offer.orderId) ? dispatch : null;
}

export function addCleaningPartnerOffer(
  currentValue: unknown,
  newOffer: CleaningPartnerOffer,
  actorUid: string,
  now: string,
  reassignAccepted = false,
  reassignReason = "",
): { ok: true; dispatch: CleaningPartnerDispatchRecord } | { ok: false; error: string } {
  if (!safeActorUid(actorUid) || !canonicalTimestamp(now) || !validateOffer(newOffer, newOffer.orderId)
    || newOffer.status !== "offered" || newOffer.createdByUid !== actorUid || newOffer.createdAt !== now) {
    return { ok: false, error: "invalid_cleaning_partner_input" };
  }
  if (currentValue === null || currentValue === undefined) {
    const first = createCleaningPartnerDispatch(newOffer, actorUid, now);
    return first ? { ok: true, dispatch: first } : { ok: false, error: "cleaning_partner_stored_data_invalid" };
  }
  if (!validateCleaningPartnerDispatch(currentValue, newOffer.orderId)) return { ok: false, error: "cleaning_partner_stored_data_invalid" };
  const current = currentValue;
  if (current.offers.length >= 10) return { ok: false, error: "cleaning_partner_offer_limit" };
  if (current.offers.some(offer => offer.id === newOffer.id || (offer.vendorId === newOffer.vendorId && ["offered", "accepted"].includes(offer.status)))) {
    return { ok: false, error: "cleaning_partner_offer_conflict" };
  }
  if (current.acceptedOfferId && !reassignAccepted) return { ok: false, error: "cleaning_partner_reassignment_required" };
  if (current.acceptedOfferId && reassignAccepted) {
    const accepted = current.offers.find(offer => offer.id === current.acceptedOfferId);
    const emergencyReassignmentRequested = current.events.some(event => event.type === "incident_action_logged"
      && event.action === "emergency_reassignment_requested");
    const departureEmergency = accepted?.progress === "departed" && emergencyReassignmentRequested;
    if (!accepted || accepted.status !== "accepted" || (accepted.progress !== "accepted" && !departureEmergency)) return { ok: false, error: "cleaning_partner_reassignment_not_allowed" };
    if (typeof reassignReason !== "string" || reassignReason.trim().length < 5 || reassignReason.trim().length > 500) {
      return { ok: false, error: "cleaning_partner_reassignment_reason_required" };
    }
  }
  const offers = current.offers.map(offer => {
    if (offer.status !== "offered" && !(current.acceptedOfferId === offer.id && reassignAccepted)) return offer;
    return {
      ...offer,
      status: "reassigned" as const,
      revision: offer.revision + 1,
      respondedAt: now,
      events: [...offer.events, { type: "reassigned" as const, occurredAt: now, actorUid, note: reassignAccepted ? reassignReason.trim() : "다른 파트너에게 재배정" }],
    };
  });
  const reassigned = current.offers.some(offer => offer.status === "offered" || offer.id === current.acceptedOfferId);
  const event = {
    type: reassigned ? "offer_reassigned" as const : "offer_created" as const,
    occurredAt: now,
    actorUid,
    vendorId: newOffer.vendorId,
    note: reassignAccepted ? reassignReason.trim() : reassigned ? "기존 제안 종료 후 대체 파트너 제안" : "거절·응답 만료 후 대체 파트너 제안",
  };
  const dispatch: CleaningPartnerDispatchRecord = {
    ...current,
    revision: current.revision + 1,
    acceptedOfferId: null,
    offers: [...offers, newOffer],
    events: [...current.events, event],
  };
  return validateCleaningPartnerDispatch(dispatch, newOffer.orderId)
    ? { ok: true, dispatch }
    : { ok: false, error: "cleaning_partner_stored_data_invalid" };
}

export function expireCleaningPartnerOffer(
  dispatchValue: unknown,
  input: { offerId: string; actorUid: string; expectedRevision: number; now: string },
): CleaningPartnerOfferResponseDecision {
  if (!isRecord(input) || !UUID_PATTERN.test(input.offerId) || !safeActorUid(input.actorUid)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !canonicalTimestamp(input.now)) {
    return { ok: false, error: "invalid_cleaning_partner_input" };
  }
  const dispatch = validateCleaningPartnerDispatch(dispatchValue, (dispatchValue as CleaningPartnerDispatchRecord)?.orderId)
    ? dispatchValue as CleaningPartnerDispatchRecord : null;
  if (!dispatch) return { ok: false, error: "cleaning_partner_stored_data_invalid" };
  const index = dispatch.offers.findIndex(offer => offer.id === input.offerId);
  if (index < 0) return { ok: false, error: "cleaning_partner_offer_not_found" };
  const offer = dispatch.offers[index];
  if (offer.status !== "offered") return { ok: false, error: "cleaning_partner_offer_already_resolved" };
  if (offer.revision !== input.expectedRevision) return { ok: false, error: "cleaning_partner_revision_conflict" };
  if (Date.parse(input.now) < Date.parse(offer.expiresAt)) return { ok: false, error: "cleaning_partner_offer_not_expired" };
  const updatedOffer: CleaningPartnerOffer = {
    ...offer,
    status: "expired",
    revision: offer.revision + 1,
    respondedAt: input.now,
    events: [...offer.events, { type: "expired", occurredAt: input.now, actorUid: input.actorUid, note: "응답 기한 만료" }],
  };
  const result: CleaningPartnerDispatchRecord = {
    ...dispatch,
    revision: dispatch.revision + 1,
    offers: dispatch.offers.map((item, itemIndex) => itemIndex === index ? updatedOffer : item),
    events: [...dispatch.events, { type: "offer_expired", occurredAt: input.now, actorUid: input.actorUid, vendorId: offer.vendorId, note: "응답 기한 만료" }],
  };
  return validateCleaningPartnerDispatch(result, dispatch.orderId)
    ? { ok: true, dispatch: result }
    : { ok: false, error: "cleaning_partner_stored_data_invalid" };
}

export function decideCleaningPartnerOfferResponse(
  dispatchValue: unknown,
  input: { offerId: string; vendorId: string; action: "accept" | "decline"; reason: string; actorUid: string; now: string },
): CleaningPartnerOfferResponseDecision {
  if (!isRecord(input) || !safeId(input.vendorId) || !safeActorUid(input.actorUid)
    || !canonicalTimestamp(input.now) || !UUID_PATTERN.test(input.offerId)
    || !["accept", "decline"].includes(input.action)) return { ok: false, error: "invalid_cleaning_partner_input" };
  const dispatch = validateCleaningPartnerDispatch(dispatchValue, (dispatchValue as CleaningPartnerDispatchRecord)?.orderId)
    ? dispatchValue as CleaningPartnerDispatchRecord : null;
  if (!dispatch) return { ok: false, error: "cleaning_partner_stored_data_invalid" };
  const offerIndex = dispatch.offers.findIndex(offer => offer.id === input.offerId);
  if (offerIndex < 0) return { ok: false, error: "cleaning_partner_offer_not_found" };
  const offer = dispatch.offers[offerIndex];
  if (offer.vendorId !== input.vendorId) return { ok: false, error: "cleaning_partner_forbidden" };
  if (offer.status !== "offered") return { ok: false, error: "cleaning_partner_offer_already_resolved" };
  if (Date.parse(input.now) >= Date.parse(offer.expiresAt)) return { ok: false, error: "cleaning_partner_offer_expired" };
  if (dispatch.acceptedOfferId && input.action === "accept") return { ok: false, error: "cleaning_partner_order_already_assigned" };
  if (input.action === "decline" && !DECLINE_ACTION_REASONS.has(input.reason)) {
    return { ok: false, error: "cleaning_partner_decline_reason_required" };
  }
  const status = input.action === "accept" ? "accepted" : "declined";
  const type = input.action === "accept" ? "accepted" : "declined";
  const updatedOffer: CleaningPartnerOffer = {
    ...offer,
    status,
    revision: offer.revision + 1,
    respondedAt: input.now,
    declineReason: input.action === "decline" ? input.reason as CleaningPartnerOffer["declineReason"] : "",
    events: [...offer.events, { type, occurredAt: input.now, actorUid: input.actorUid, note: "" }],
  };
  const offers = dispatch.offers.map((item, index) => index === offerIndex ? updatedOffer : item);
  const event = {
    type: input.action === "accept" ? "offer_accepted" as const : "offer_declined" as const,
    occurredAt: input.now,
    actorUid: input.actorUid,
    vendorId: input.vendorId,
    note: input.action === "decline" ? input.reason : "",
  };
  const result: CleaningPartnerDispatchRecord = {
    ...dispatch,
    revision: dispatch.revision + 1,
    acceptedOfferId: input.action === "accept" ? updatedOffer.id : dispatch.acceptedOfferId,
    offers,
    events: [...dispatch.events, event],
  };
  return { ok: true, dispatch: result };
}

export function advanceCleaningPartnerProgress(
  dispatchValue: unknown,
  input: { offerId: string; vendorId: string; actorUid: string; expectedRevision: number; nextProgress: string; now: string },
): CleaningPartnerOfferResponseDecision {
  if (!isRecord(input) || !UUID_PATTERN.test(input.offerId) || !safeId(input.vendorId) || !safeActorUid(input.actorUid)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !canonicalTimestamp(input.now)) {
    return { ok: false, error: "invalid_cleaning_partner_input" };
  }
  const dispatch = validateCleaningPartnerDispatch(dispatchValue, (dispatchValue as CleaningPartnerDispatchRecord)?.orderId)
    ? dispatchValue as CleaningPartnerDispatchRecord : null;
  if (!dispatch) return { ok: false, error: "cleaning_partner_stored_data_invalid" };
  const index = dispatch.offers.findIndex(item => item.id === input.offerId);
  if (index < 0) return { ok: false, error: "cleaning_partner_offer_not_found" };
  const offer = dispatch.offers[index];
  if (offer.vendorId !== input.vendorId) return { ok: false, error: "cleaning_partner_forbidden" };
  if (dispatch.acceptedOfferId !== offer.id || offer.status !== "accepted") {
    return { ok: false, error: "cleaning_partner_order_not_assigned" };
  }
  if (offer.revision !== input.expectedRevision) return { ok: false, error: "cleaning_partner_revision_conflict" };
  const nextByCurrent: Record<string, string> = { accepted: "departed", departed: "arrived", arrived: "started" };
  if (nextByCurrent[offer.progress] !== input.nextProgress || offer.events.length >= 100 || dispatch.events.length >= 100) {
    return { ok: false, error: "cleaning_partner_progress_transition_invalid" };
  }
  const updatedOffer: CleaningPartnerOffer = {
    ...offer,
    progress: input.nextProgress as CleaningPartnerOffer["progress"],
    revision: offer.revision + 1,
    events: [...offer.events, { type: input.nextProgress as CleaningPartnerOffer["progress"], occurredAt: input.now, actorUid: input.actorUid, note: "" }],
  };
  const result: CleaningPartnerDispatchRecord = {
    ...dispatch,
    revision: dispatch.revision + 1,
    offers: dispatch.offers.map((item, offerIndex) => offerIndex === index ? updatedOffer : item),
    events: [...dispatch.events, { type: "progress_updated", occurredAt: input.now, actorUid: input.actorUid, vendorId: input.vendorId, note: input.nextProgress }],
  };
  return validateCleaningPartnerDispatch(result, dispatch.orderId)
    ? { ok: true, dispatch: result }
    : { ok: false, error: "cleaning_partner_stored_data_invalid" };
}

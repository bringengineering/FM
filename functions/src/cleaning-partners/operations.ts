import { CLEANING_DELAY_ACTIONS, CLEANING_DELAY_ISSUE_TYPES, type CleaningDelayActionInput, type CleaningDelayIncidentInput, type CleaningPartnerDispatchRecord } from "./contracts.js";
import { validateCleaningPartnerDispatch } from "./core.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,150}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toISOString() === value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).length === allowed.size && Object.keys(value).every(key => allowed.has(key));
}

function validNote(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= 500 && value === value.trim() && (allowEmpty || value.length > 0);
}

function activeOffer(dispatch: CleaningPartnerDispatchRecord) {
  return dispatch.offers.find(offer => offer.id === dispatch.acceptedOfferId && offer.status === "accepted"
    && ["accepted", "departed", "arrived", "started"].includes(offer.progress));
}

function appendEvent(dispatch: CleaningPartnerDispatchRecord, event: CleaningPartnerDispatchRecord["events"][number]) {
  if (dispatch.events.length >= 100 || !Number.isSafeInteger(dispatch.revision) || dispatch.revision >= Number.MAX_SAFE_INTEGER) return null;
  return { ...dispatch, revision: dispatch.revision + 1, events: [...dispatch.events, event] };
}

export function recordCleaningDelayIncident(
  currentValue: unknown,
  inputValue: unknown,
  actorUid: string,
  now: string,
): { ok: true; dispatch: CleaningPartnerDispatchRecord } | { ok: false; error: string } {
  if (!isRecord(inputValue) || !exactKeys(inputValue, ["incidentId", "orderId", "expectedRevision", "issueType", "scheduledAt", "delayMinutes", "note"])
    || !UUID_PATTERN.test(String(inputValue.incidentId || "")) || typeof inputValue.orderId !== "string"
    || !Number.isSafeInteger(inputValue.expectedRevision) || !CLEANING_DELAY_ISSUE_TYPES.includes(inputValue.issueType as typeof CLEANING_DELAY_ISSUE_TYPES[number])
    || !isCanonicalTime(inputValue.scheduledAt) || !Number.isSafeInteger(inputValue.delayMinutes)
    || Number(inputValue.delayMinutes) < 0 || Number(inputValue.delayMinutes) > 1440 || !validNote(inputValue.note)
    || !SAFE_ID_PATTERN.test(actorUid) || !isCanonicalTime(now)) return { ok: false, error: "invalid_cleaning_delay_input" };
  if (!validateCleaningPartnerDispatch(currentValue, inputValue.orderId)) return { ok: false, error: "cleaning_delay_dispatch_invalid" };
  if (currentValue.revision !== inputValue.expectedRevision) return { ok: false, error: "cleaning_delay_revision_conflict" };
  const offer = activeOffer(currentValue);
  if (!offer) return { ok: false, error: "cleaning_delay_assignment_not_active" };
  const dispatch = appendEvent(currentValue, {
    type: "incident_reported", incidentId: inputValue.incidentId as string, issueType: inputValue.issueType as typeof CLEANING_DELAY_ISSUE_TYPES[number],
    scheduledAt: inputValue.scheduledAt, delayMinutes: Number(inputValue.delayMinutes), occurredAt: now, actorUid,
    vendorId: offer.vendorId, note: inputValue.note as string,
  });
  return dispatch ? { ok: true, dispatch } : { ok: false, error: "cleaning_delay_history_limit" };
}

export function recordCleaningDelayAction(
  currentValue: unknown,
  inputValue: unknown,
  actorUid: string,
  now: string,
): { ok: true; dispatch: CleaningPartnerDispatchRecord } | { ok: false; error: string } {
  if (!isRecord(inputValue) || !exactKeys(inputValue, ["incidentId", "orderId", "expectedRevision", "action", "note"])
    || !UUID_PATTERN.test(String(inputValue.incidentId || "")) || typeof inputValue.orderId !== "string"
    || !Number.isSafeInteger(inputValue.expectedRevision) || !CLEANING_DELAY_ACTIONS.includes(inputValue.action as typeof CLEANING_DELAY_ACTIONS[number])
    || !validNote(inputValue.note, true) || !SAFE_ID_PATTERN.test(actorUid) || !isCanonicalTime(now)) {
    return { ok: false, error: "invalid_cleaning_delay_input" };
  }
  if (!validateCleaningPartnerDispatch(currentValue, inputValue.orderId)) return { ok: false, error: "cleaning_delay_dispatch_invalid" };
  if (currentValue.revision !== inputValue.expectedRevision) return { ok: false, error: "cleaning_delay_revision_conflict" };
  const offer = activeOffer(currentValue);
  const incident = currentValue.events.find(event => event.type === "incident_reported" && event.incidentId === inputValue.incidentId);
  if (!incident || !offer || incident.vendorId !== offer.vendorId) return { ok: false, error: "cleaning_delay_incident_not_found" };
  const dispatch = appendEvent(currentValue, {
    type: "incident_action_logged", incidentId: inputValue.incidentId as string, action: inputValue.action as typeof CLEANING_DELAY_ACTIONS[number],
    occurredAt: now, actorUid, vendorId: offer.vendorId, note: inputValue.note as string,
  });
  return dispatch ? { ok: true, dispatch } : { ok: false, error: "cleaning_delay_history_limit" };
}

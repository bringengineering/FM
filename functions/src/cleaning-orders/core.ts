import {
  CLEANING_ORDER_SERVICE_TYPES,
  CLEANING_ORDER_STATUSES,
  type CleaningOrderActorRole,
  type CleaningOrderCreateInput,
  type CleaningOrderInputDecision,
  type CleaningOrderStatus,
  type CleaningOrderTransitionDecision,
} from "./contracts.js";

const transitions: Readonly<Record<CleaningOrderStatus, readonly CleaningOrderStatus[]>> = Object.freeze({
  received: ["reviewing", "cancelled"],
  reviewing: ["quote_pending", "cancelled"],
  quote_pending: ["approval_pending", "cancelled"],
  approval_pending: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["review_pending"],
  review_pending: ["revision_requested", "completed"],
  revision_requested: ["in_progress"],
  completed: [],
  cancelled: [],
});

const allowedInputKeys = new Set([
  "requestId",
  "customerId",
  "buildingId",
  "serviceType",
  "title",
  "desiredDate",
  "description",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const safeId = (value: unknown, minLength = 1): value is string =>
  typeof value === "string"
  && value.length >= minLength
  && value.length <= 150
  && /^[A-Za-z0-9_-]+$/.test(value)
  && !["__proto__", "prototype", "constructor"].includes(value);

function isValidDate(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : null;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validateStoredCleaningOrder(value: unknown, expectedId: string): value is import("./contracts.js").CleaningOrderRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const order = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "requestId", "id", "customerId", "buildingId", "serviceType", "title", "desiredDate",
    "description", "status", "revision", "createdAt", "createdByUid", "updatedAt", "updatedByUid", "history",
  ]);
  if (Object.keys(order).some(key => !allowedKeys.has(key))) return false;
  if (
    order.id !== expectedId
    || order.requestId !== expectedId
    || !safeId(expectedId, 16)
    || !safeId(order.customerId)
    || !safeId(order.buildingId)
    || typeof order.serviceType !== "string"
    || !CLEANING_ORDER_SERVICE_TYPES.includes(order.serviceType as CleaningOrderCreateInput["serviceType"])
    || typeof order.title !== "string" || order.title.length < 1 || order.title.length > 120 || order.title !== order.title.trim()
    || typeof order.desiredDate !== "string" || !isValidDate(order.desiredDate)
    || typeof order.description !== "string" || order.description.length > 2000 || order.description !== order.description.trim()
    || typeof order.status !== "string" || !CLEANING_ORDER_STATUSES.includes(order.status as CleaningOrderStatus)
    || !Number.isSafeInteger(order.revision) || Number(order.revision) < 1
    || !isCanonicalTimestamp(order.createdAt) || !safeId(order.createdByUid)
    || !isCanonicalTimestamp(order.updatedAt) || !safeId(order.updatedByUid)
    || !Array.isArray(order.history) || order.history.length < 1 || order.history.length > 200
    || order.revision !== order.history.length
  ) return false;

  const requestIds = new Set<string>();
  let previousStatus: CleaningOrderStatus | null = null;
  let previousTime = "";
  for (const rawEntry of order.history) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return false;
    const entry = rawEntry as Record<string, unknown>;
    if (Object.keys(entry).some(key => !["requestId", "status", "changedAt", "changedByUid", "note"].includes(key))) return false;
    if (
      !safeId(entry.requestId, 16)
      || !CLEANING_ORDER_STATUSES.includes(entry.status as CleaningOrderStatus)
      || !isCanonicalTimestamp(entry.changedAt)
      || (previousTime !== "" && entry.changedAt < previousTime)
      || !safeId(entry.changedByUid)
      || typeof entry.note !== "string" || entry.note.length > 500 || entry.note !== entry.note.trim()
      || requestIds.has(entry.requestId)
    ) return false;
    if (previousStatus === null ? entry.status !== "received" : !transitions[previousStatus].includes(entry.status as CleaningOrderStatus)) return false;
    requestIds.add(entry.requestId);
    previousStatus = entry.status as CleaningOrderStatus;
    previousTime = entry.changedAt;
  }

  const last = order.history[order.history.length - 1] as Record<string, unknown>;
  return previousStatus === order.status
    && last.changedAt === order.updatedAt
    && last.changedByUid === order.updatedByUid;
}

export function normalizeCleaningOrderInput(input: unknown): CleaningOrderInputDecision {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "invalid_cleaning_order_input" };
  }

  const source = input as Record<string, unknown>;
  if (Object.keys(source).some(key => !allowedInputKeys.has(key))) {
    return { ok: false, error: "invalid_cleaning_order_input" };
  }

  const requestId = source.requestId;
  const customerId = source.customerId;
  const buildingId = source.buildingId;
  const serviceType = source.serviceType;
  const title = cleanText(source.title, 120);
  const desiredDate = source.desiredDate === undefined ? "" : source.desiredDate;
  const description = source.description === undefined ? "" : cleanText(source.description, 2000);

  if (
    typeof requestId !== "string"
    || !UUID_PATTERN.test(requestId)
    || !safeId(customerId)
    || !safeId(buildingId)
    || typeof serviceType !== "string"
    || !CLEANING_ORDER_SERVICE_TYPES.includes(serviceType as CleaningOrderCreateInput["serviceType"])
    || !title
    || typeof desiredDate !== "string"
    || !isValidDate(desiredDate)
    || description === null
  ) {
    return { ok: false, error: "invalid_cleaning_order_input" };
  }

  return {
    ok: true,
    value: {
      requestId,
      customerId,
      buildingId,
      serviceType: serviceType as CleaningOrderCreateInput["serviceType"],
      title,
      desiredDate,
      description,
    },
  };
}

export function decideCleaningOrderTransition(
  from: unknown,
  to: unknown,
  role: unknown,
): CleaningOrderTransitionDecision {
  if (
    typeof from !== "string"
    || !CLEANING_ORDER_STATUSES.includes(from as CleaningOrderStatus)
    || typeof to !== "string"
    || !CLEANING_ORDER_STATUSES.includes(to as CleaningOrderStatus)
    || !["admin", "member", "viewer"].includes(role as CleaningOrderActorRole)
    || role === "viewer"
    || !transitions[from as CleaningOrderStatus].includes(to as CleaningOrderStatus)
    || (to === "completed" && role !== "admin")
  ) {
    return { ok: false, error: "cleaning_order_transition_forbidden" };
  }

  return { ok: true };
}

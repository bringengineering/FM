import { CLEANING_ORDER_STATUSES, type CleaningOrderStatus } from "./contracts.js";
import { validateStoredCleaningOrder } from "./core.js";

export interface CleaningWallboardProjection {
  schemaVersion: 1;
  total: number;
  open: number;
  completed: number;
  overdue: number;
  byStatus: Record<CleaningOrderStatus, number>;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function shouldRebuildCleaningWallboardProjection(orderAfter: unknown, projection: unknown): boolean {
  if (!isRecord(orderAfter) || !isCanonicalTimestamp(orderAfter.updatedAt)
    || !isRecord(projection) || !isCanonicalTimestamp(projection.updatedAt)) return true;
  return Date.parse(projection.updatedAt) < Date.parse(orderAfter.updatedAt);
}

export function shouldPublishCleaningWallboardProjection(current: unknown, candidate: unknown): boolean {
  if (!isRecord(candidate) || !isCanonicalTimestamp(candidate.updatedAt)) return false;
  if (!isRecord(current) || !isCanonicalTimestamp(current.updatedAt)) return true;
  return Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt);
}

export function buildCleaningWallboardProjection(
  source: unknown,
  now: string,
): CleaningWallboardProjection {
  const parsedNow = Date.parse(now);
  if (typeof now !== "string" || !Number.isFinite(parsedNow) || new Date(parsedNow).toISOString() !== now) {
    throw new Error("cleaning_order_timestamp_invalid");
  }
  if (source !== null && (!source || typeof source !== "object" || Array.isArray(source))) {
    throw new Error("cleaning_order_stored_data_invalid");
  }
  const byStatus = Object.fromEntries(CLEANING_ORDER_STATUSES.map(status => [status, 0])) as Record<CleaningOrderStatus, number>;
  let total = 0;
  let open = 0;
  let completed = 0;
  let overdue = 0;
  const today = now.slice(0, 10);
  for (const [id, value] of Object.entries(source || {})) {
    if (!validateStoredCleaningOrder(value, id)) throw new Error("cleaning_order_stored_data_invalid");
    total += 1;
    byStatus[value.status] += 1;
    if (value.status === "completed") completed += 1;
    if (value.status !== "completed" && value.status !== "cancelled") {
      open += 1;
      if (value.desiredDate && value.desiredDate < today) overdue += 1;
    }
  }
  return { schemaVersion: 1, total, open, completed, overdue, byStatus, updatedAt: now };
}

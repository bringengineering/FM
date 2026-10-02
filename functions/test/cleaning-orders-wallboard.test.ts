import { describe, expect, it } from "vitest";
import {
  buildCleaningWallboardProjection,
  shouldRebuildCleaningWallboardProjection,
  shouldPublishCleaningWallboardProjection,
} from "../src/cleaning-orders/wallboard-projection.js";

const now = "2026-09-26T12:00:00.000Z";
const transitions: Record<string, string[]> = {
  scheduled: ["received", "reviewing", "quote_pending", "approval_pending", "scheduled"],
  completed: ["received", "reviewing", "quote_pending", "approval_pending", "scheduled", "in_progress", "review_pending", "completed"],
  cancelled: ["received", "cancelled"],
};
const order = (id: string, status: string, desiredDate: string) => {
  const requestId = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const history = transitions[status].map((next, index) => ({ requestId: requestId(index), status: next, changedAt: now, changedByUid: "private-user", note: "private note" }));
  return {
    id, requestId: id, customerId: `customer-${id}`, buildingId: `building-${id}`,
    serviceType: "common_cleaning", title: `private title ${id}`, desiredDate,
    description: "private details", status, revision: history.length, createdAt: now,
    createdByUid: "private-user", updatedAt: now, updatedByUid: "private-user", history,
  };
};

describe("buildCleaningWallboardProjection", () => {
  it("returns only aggregate counts and excludes customer/order information", () => {
    const result = buildCleaningWallboardProjection({
      "00000000-0000-4000-8000-000000000001": order("00000000-0000-4000-8000-000000000001", "scheduled", "2026-09-25"),
      "00000000-0000-4000-8000-000000000002": order("00000000-0000-4000-8000-000000000002", "completed", "2026-09-27"),
      "00000000-0000-4000-8000-000000000003": order("00000000-0000-4000-8000-000000000003", "cancelled", "2026-09-20"),
    }, now);
    expect(result).toMatchObject({ schemaVersion: 1, total: 3, open: 1, completed: 1, overdue: 1, byStatus: { scheduled: 1, completed: 1, cancelled: 1 }, updatedAt: now });
    expect(JSON.stringify(result)).not.toMatch(/customer-|building-|private|00000000/u);
    expect(Object.keys(result).sort()).toEqual(["byStatus", "completed", "open", "overdue", "schemaVersion", "total", "updatedAt"].sort());
  });

  it("fails closed on malformed persisted records or timestamp", () => {
    expect(() => buildCleaningWallboardProjection({ bad: { status: "private" } }, now)).toThrow("cleaning_order_stored_data_invalid");
    expect(() => buildCleaningWallboardProjection({}, "bad-date")).toThrow("cleaning_order_timestamp_invalid");
  });
});

describe("shouldRebuildCleaningWallboardProjection", () => {
  it("prevents an older overlapping refresh from overwriting a newer publication", () => {
    expect(shouldPublishCleaningWallboardProjection(
      { updatedAt: "2026-09-26T12:00:02.000Z" },
      { updatedAt: "2026-09-26T12:00:01.000Z" },
    )).toBe(false);
    expect(shouldPublishCleaningWallboardProjection(
      { updatedAt: "2026-09-26T12:00:01.000Z" },
      { updatedAt: "2026-09-26T12:00:02.000Z" },
    )).toBe(true);
  });

  it("skips a recovery event already covered by an equal or newer source snapshot", () => {
    const updatedAt = "2026-09-26T12:00:00.000Z";
    expect(shouldRebuildCleaningWallboardProjection({ updatedAt }, { updatedAt })).toBe(false);
    expect(shouldRebuildCleaningWallboardProjection(
      { updatedAt: "2026-09-26T11:59:59.000Z" },
      { updatedAt },
    )).toBe(false);
  });

  it("rebuilds when a change is newer, the projection is invalid, or an order is deleted", () => {
    const updatedAt = "2026-09-26T12:00:00.000Z";
    expect(shouldRebuildCleaningWallboardProjection(
      { updatedAt: "2026-09-26T12:00:01.000Z" },
      { updatedAt },
    )).toBe(true);
    expect(shouldRebuildCleaningWallboardProjection(
      { updatedAt: "2026-09-26T12:00:00.000Z" },
      { updatedAt: "invalid" },
    )).toBe(true);
    expect(shouldRebuildCleaningWallboardProjection(null, { updatedAt: "2026-09-26T12:00:00.000Z" })).toBe(true);
  });
});

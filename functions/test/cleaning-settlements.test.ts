import { describe, expect, it } from "vitest";
import { buildCleaningSettlementReview } from "../src/cleaning-settlements.js";

const id = (tail: string) => `123e4567-e89b-42d3-a456-42661417400${tail}`;
const order = (id: string, desiredDate: string, status = "completed") => ({
  id, requestId: id, customerId: `customer-${id}`, buildingId: `building-${id}`, serviceType: "move_in_cleaning",
  title: "입주 청소", desiredDate, description: "", status, revision: 2,
  createdAt: `${desiredDate}T00:00:00.000Z`, createdByUid: "crm-admin",
  updatedAt: `${desiredDate}T01:00:00.000Z`, updatedByUid: "crm-admin",
  history: [{ requestId: `request-${id}`, status, changedAt: `${desiredDate}T01:00:00.000Z`, changedByUid: "crm-admin", note: "완료" }],
});

const dispatch = (orderId: string, vendorId: string, supplierAmount: number, progress = "completed") => ({
  orderId, revision: 2, acceptedOfferId: `223e4567-e89b-42d3-a456-42661417400${orderId.slice(-1)}`,
  offers: [{ id: `223e4567-e89b-42d3-a456-42661417400${orderId.slice(-1)}`, orderId, vendorId, serviceType: "move_in_cleaning", region: "원주시",
    desiredDate: "2026-09-22", supplierAmount, expiresAt: "2026-09-22T01:00:00.000Z", status: "accepted",
    revision: 2, createdAt: "2026-09-21T00:00:00.000Z", createdByUid: "crm-admin", respondedAt: "2026-09-21T00:01:00.000Z",
    declineReason: "", progress, events: [
      { type: "offered", occurredAt: "2026-09-21T00:00:00.000Z", actorUid: "crm-admin", note: "" },
      { type: "accepted", occurredAt: "2026-09-21T00:01:00.000Z", actorUid: "partner-user", note: "" },
    ] }], events: [{ type: "offer_created", occurredAt: "2026-09-21T00:00:00.000Z", actorUid: "crm-admin", vendorId, note: "" }],
});

describe("buildCleaningSettlementReview", () => {
  it("groups only completed orders with a completed accepted offer in the selected period", () => {
    const result = buildCleaningSettlementReview({
      fromDate: "2026-09-21", toDate: "2026-09-27",
      orders: {
        [id("1")]: order(id("1"), "2026-09-22"), [id("2")]: order(id("2"), "2026-09-23"),
        [id("3")]: order(id("3"), "2026-09-24", "in_progress"), [id("4")]: order(id("4"), "2026-09-20"),
      },
      dispatches: {
        [id("1")]: dispatch(id("1"), "vendor-a", 190000), [id("2")]: dispatch(id("2"), "vendor-a", 220000),
        [id("3")]: dispatch(id("3"), "vendor-b", 300000), [id("4")]: dispatch(id("4"), "vendor-b", 310000),
      },
      vendors: { "vendor-a": { id: "vendor-a", name: "A클린" }, "vendor-b": { id: "vendor-b", name: "B클린" } },
    });

    expect(result.partners).toEqual([{
      vendorId: "vendor-a", vendorName: "A클린", completedWorkCount: 2, grossSupplierAmount: 410000,
      workItems: [
        { orderId: id("2"), desiredDate: "2026-09-23", supplierAmount: 220000 },
        { orderId: id("1"), desiredDate: "2026-09-22", supplierAmount: 190000 },
      ],
      checks: { workCompletion: "verified", customerInspection: "unavailable", csHold: "unavailable", payoutAccount: "unavailable", taxInvoice: "unavailable" },
      finalPayoutAmount: null, payoutEnabled: false,
    }]);
  });

  it("does not infer a payout when order, accepted offer, partner, or source amount is missing", () => {
    const result = buildCleaningSettlementReview({
      fromDate: "2026-09-21", toDate: "2026-09-27",
      orders: { [id("1")]: order(id("1"), "2026-09-22"), [id("2")]: order(id("2"), "2026-09-23") },
      dispatches: { [id("1")]: dispatch(id("1"), "vendor-a", 0), [id("2")]: { ...dispatch(id("2"), "vendor-b", 1000), acceptedOfferId: null } },
      vendors: { "vendor-a": { id: "vendor-a", name: "A클린" } },
    });

    expect(result.partners).toEqual([]);
    expect(result.excludedWorkCount).toBe(2);
  });

  it("keeps payout disabled even when completed work and supplier amounts are present", () => {
    const result = buildCleaningSettlementReview({
      fromDate: "2026-09-21", toDate: "2026-09-27",
      orders: { [id("1")]: order(id("1"), "2026-09-22") },
      dispatches: { [id("1")]: dispatch(id("1"), "vendor-a", 190000) },
      vendors: { "vendor-a": { id: "vendor-a", name: "A클린" } },
    });

    expect(result.partners[0]?.finalPayoutAmount).toBeNull();
    expect(result.partners[0]?.payoutEnabled).toBe(false);
    expect(result.partners[0]?.checks.payoutAccount).toBe("unavailable");
  });
});

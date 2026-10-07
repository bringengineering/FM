import { describe, expect, it } from "vitest";
import { createCleaningOrderFirebaseDependencies } from "../src/cleaning-orders/firebase-adapter.js";
import type { CleaningOrderRecord } from "../src/cleaning-orders/contracts.js";
import type { CleaningQuoteRecord, CleaningQuoteReviewEvent } from "../src/cleaning-orders/quotes.js";

class FakeDatabase {
  values = new Map<string, unknown>();
  paths: string[] = [];
  transactionStartsWithNull = new Set<string>();

  ref(path: string) {
    this.paths.push(path);
    return {
      get: async () => ({ val: () => this.values.get(path) ?? null }),
      transaction: async (update: (current: unknown) => unknown) => {
        const current = this.values.get(path) ?? null;
        const callbackCurrent = this.transactionStartsWithNull.delete(path) ? null : current;
        const next = update(structuredClone(callbackCurrent));
        if (next === undefined) return { committed: false, snapshot: { val: () => structuredClone(current) } };
        this.values.set(path, structuredClone(next));
        return { committed: true, snapshot: { val: () => structuredClone(next) } };
      },
    };
  }
}

const order: CleaningOrderRecord = {
  requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  id: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  customerId: "customer_01",
  buildingId: "building_01",
  serviceType: "move_in_cleaning",
  title: "201호 입주청소",
  desiredDate: "2026-10-02",
  description: "입주 전 전체 청소",
  status: "received",
  revision: 1,
  createdAt: "2026-09-26T04:00:00.000Z",
  createdByUid: "staff_uid_01",
  updatedAt: "2026-09-26T04:00:00.000Z",
  updatedByUid: "staff_uid_01",
  history: [{ requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501", status: "received", changedAt: "2026-09-26T04:00:00.000Z", changedByUid: "staff_uid_01", note: "주문 접수" }],
};

describe("createCleaningOrderFirebaseDependencies", () => {
  it("queries linked CRM work orders by cleaning request id", async () => {
    const orderId = "7c2ac2d0-9a09-42f3-b8f8-7237562fc501";
    const linked = { id: "work-01", cleaningOrderId: orderId, status: "assigned" };
    const calls: unknown[][] = [];
    const db = {
      ref(path: string) {
        calls.push(["ref", path]);
        return {
          orderByChild(child: string) {
            calls.push(["orderByChild", child]);
            return {
              equalTo(value: string) {
                calls.push(["equalTo", value]);
                return {
                  limitToLast(limit: number) {
                    calls.push(["limitToLast", limit]);
                    return { get: async () => ({ val: () => ({ work01: linked }) }) };
                  },
                };
              },
            };
          },
        };
      },
    };
    const deps = createCleaningOrderFirebaseDependencies(db);

    expect(await deps.readLinkedWorkOrders(orderId)).toEqual([linked]);
    expect(calls).toEqual([
      ["ref", "crmCompany/workOrders"], ["orderByChild", "cleaningOrderId"],
      ["equalTo", orderId], ["limitToLast", 50],
    ]);
  });

  it("reads canonical records and creates one order at the dedicated server-owned path", async () => {
    const db = new FakeDatabase();
    db.values.set("crmCompany/data/customers/customer_01", { id: "customer_01" });
    db.values.set("crmCompany/data/buildings/building_01", { id: "building_01" });
    const deps = createCleaningOrderFirebaseDependencies(db, () => "2026-09-26T04:00:00.000Z");

    expect(await deps.readCustomer("customer_01")).toEqual({ id: "customer_01" });
    expect(await deps.readBuilding("building_01")).toEqual({ id: "building_01" });
    expect(await deps.createOrderIfAbsent(order)).toEqual({ order, created: true });
    expect(await deps.createOrderIfAbsent(order)).toEqual({ order, created: false });
    expect(db.values.get(`crmCompany/cleaningOrders/${order.id}`)).toEqual(order);
  });

  it("updates only the expected revision and returns current data on conflict", async () => {
    const db = new FakeDatabase();
    db.values.set(`crmCompany/cleaningOrders/${order.id}`, order);
    const deps = createCleaningOrderFirebaseDependencies(db, () => "2026-09-26T04:00:00.000Z");
    const updated = { ...order, status: "reviewing" as const, revision: 2 };

    expect(await deps.updateOrderIfRevision(order.id, 1, updated)).toEqual({ order: updated, updated: true });
    expect(await deps.updateOrderIfRevision(order.id, 1, { ...updated, status: "completed" })).toEqual({ order: updated, updated: false });
  });

  it("atomically appends a quote revision and applies an idempotent administrator review", async () => {
    const db = new FakeDatabase();
    const deps = createCleaningOrderFirebaseDependencies(db, () => "2026-09-26T04:00:00.000Z");
    const quote = {
      id: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502", orderId: order.id, buildingId: order.buildingId,
      revision: 1, previousQuoteId: "", status: "pending_review", createdAt: "2026-09-26T04:00:00.000Z",
      createdByUid: "staff_uid_01", reviewHistory: [], quoteDate: "2026-09-26", validUntil: "2026-10-03",
      recipient: "합성 고객", recipientPhone: "", siteAddress: "", projectName: "입주청소", service: "입주청소",
      summary: "테스트", items: [{ name: "청소", detail: "", quantity: 1, unit: "식", unitPrice: 120000, note: "" }],
      totalAmount: 120000, supplyAmount: 109091, vatAmount: 10909, taxIncluded: true, notes: [], company: {},
    } as unknown as CleaningQuoteRecord;
    const event: CleaningQuoteReviewEvent = {
      requestId: "8c2ac2d0-9a09-42f3-b8f8-7237562fc504", action: "approve", changedAt: "2026-09-26T04:00:00.000Z",
      changedByUid: "admin_uid_01", note: "금액 확인",
    };
    const create = deps.createRevisionIfCurrent;
    const review = deps.reviewLatestRevisionIfCurrent;

    expect(typeof create).toBe("function");
    expect(typeof review).toBe("function");
    expect(await create(order.id, 0, quote)).toMatchObject({ created: true, latestRevision: 1 });
    expect(await create(order.id, 0, quote)).toMatchObject({ created: false, latestRevision: 1, quote: { id: quote.id } });
    expect(await review(order.id, 1, quote.id, event)).toMatchObject({ updated: true, latestRevision: 1, quote: { status: "admin_approved" } });
    expect(await review(order.id, 1, quote.id, event)).toMatchObject({ updated: false, quote: { status: "admin_approved" } });
    expect(await deps.readQuoteSet(order.id)).toMatchObject({ latestQuoteId: quote.id, latestRevision: 1 });
    expect((db.values.get(`crmCompany/cleaningOrderQuotes/${order.id}`) as { revisions: Record<string, unknown> }).revisions[quote.id])
      .toMatchObject({ status: "admin_approved" });
  });

  it("uses the pre-read quote set when an RTDB transaction first calls back with a null local cache", async () => {
    const db = new FakeDatabase();
    const deps = createCleaningOrderFirebaseDependencies(db, () => "2026-09-26T04:00:00.000Z");
    const quoteId = "8c2ac2d0-9a09-42f3-b8f8-7237562fc502";
    const existingQuote = {
      id: quoteId, orderId: order.id, buildingId: order.buildingId, revision: 1, previousQuoteId: "",
      status: "pending_review", createdAt: "2026-09-26T04:00:00.000Z", createdByUid: "staff_uid_01", reviewHistory: [],
      quoteDate: "2026-09-26", validUntil: "2026-10-03", recipient: "합성 고객", recipientPhone: "",
      siteAddress: "", projectName: "입주청소", service: "입주청소", summary: "테스트",
      items: [{ name: "청소", detail: "", quantity: 1, unit: "식", unitPrice: 120000, note: "" }],
      totalAmount: 120000, supplyAmount: 109091, vatAmount: 10909, taxIncluded: true, notes: [], company: {},
    };
    const quotePath = `crmCompany/cleaningOrderQuotes/${order.id}`;
    db.values.set(quotePath, {
      orderId: order.id, buildingId: order.buildingId, latestRevision: 1, latestQuoteId: quoteId,
      revisions: { [quoteId]: existingQuote },
    });
    db.transactionStartsWithNull.add(quotePath);

    const reviewed = await deps.reviewLatestRevisionIfCurrent(order.id, 1, quoteId, {
      requestId: "8c2ac2d0-9a09-42f3-b8f8-7237562fc504", action: "return",
      changedAt: "2026-09-26T04:05:00.000Z", changedByUid: "admin_uid_01", note: "보완 요청",
    });

    expect(reviewed).toMatchObject({ updated: true, latestRevision: 1, quote: { status: "returned", reviewHistory: [{ action: "return" }] } });
  });
});

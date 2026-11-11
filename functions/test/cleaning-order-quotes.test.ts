import { describe, expect, it } from "vitest";

const quoteRuntime = await import("../src/cleaning-orders/quotes.js").catch(() => ({} as Record<string, unknown>));

const ORDER_ID = "7c2ac2d0-9a09-42f3-b8f8-7237562fc501";
const QUOTE_ID = "8c2ac2d0-9a09-42f3-b8f8-7237562fc502";
const RETRY_ID = "8c2ac2d0-9a09-42f3-b8f8-7237562fc503";
const NOW = "2026-09-26T04:00:00.000Z";
const order = {
  requestId: ORDER_ID, id: ORDER_ID, customerId: "customer_demo_01", buildingId: "building_demo_01",
  serviceType: "move_in_cleaning", title: "201호 입주청소", desiredDate: "2026-09-26", description: "synthetic",
  status: "quote_pending", revision: 3, createdAt: "2026-09-26T03:00:00.000Z", createdByUid: "staff_01",
  updatedAt: NOW, updatedByUid: "staff_01",
  history: [
    { requestId: ORDER_ID, status: "received", changedAt: "2026-09-26T03:00:00.000Z", changedByUid: "staff_01", note: "접수" },
    { requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc510", status: "reviewing", changedAt: "2026-09-26T03:30:00.000Z", changedByUid: "staff_01", note: "검토" },
    { requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc511", status: "quote_pending", changedAt: NOW, changedByUid: "staff_01", note: "견적 요청" },
  ],
};
const quoteInput = {
  quoteDate: "2026-09-26",
  validUntil: "2026-10-03",
  recipient: "합성 고객",
  recipientPhone: "010-0000-0000",
  siteAddress: "합성 주소",
  projectName: "201호 입주청소",
  service: "입주청소",
  summary: "범위 확인용 테스트 견적",
  items: [{ name: "기본 청소", detail: "실내 기본 범위", quantity: 1, unit: "식", unitPrice: 120_000, note: "" }],
  taxIncluded: true,
  notes: ["현장 상태에 따라 협의"],
  company: { businessName: "브링엔지니어링", representative: "테스트", registrationNumber: "000-00-00000" },
};

function memoryDependencies() {
  let latestRevision = 0;
  let latestQuoteId = "";
  const revisions = new Map<string, Record<string, unknown>>();
  return {
    revisions,
    get latestRevision() { return latestRevision; },
    now: () => NOW,
    readOrder: async (id: string) => id === ORDER_ID ? order : null,
    readQuoteSet: async (id: string) => id === ORDER_ID ? { orderId: ORDER_ID, latestRevision, latestQuoteId, revisions: Object.fromEntries(revisions) } : null,
    createRevisionIfCurrent: async (id: string, expected: number, quote: Record<string, unknown>) => {
      if (id !== ORDER_ID || latestRevision !== expected) {
        return { quote: revisions.get(String(quote.id)) ?? null, latestRevision, created: false };
      }
      const existing = revisions.get(String(quote.id));
      if (existing) return { quote: existing, latestRevision, created: false };
      revisions.set(String(quote.id), quote);
      latestRevision = Number(quote.revision);
      latestQuoteId = String(quote.id);
      return { quote, latestRevision, created: true };
    },
    reviewLatestRevisionIfCurrent: async (id: string, expected: number, quoteId: string, event: Record<string, unknown>) => {
      const current = revisions.get(quoteId);
      if (id !== ORDER_ID || latestRevision !== expected || !current || current.revision !== expected) {
        return { quote: current ?? null, latestRevision, updated: false };
      }
      const events = Array.isArray(current.reviewHistory) ? current.reviewHistory as Record<string, unknown>[] : [];
      const retry = events.find(item => item.requestId === event.requestId);
      if (retry) return { quote: current, latestRevision, updated: false };
      const next = { ...current, status: event.action === "approve" ? "admin_approved" : "returned", reviewHistory: [...events, event] };
      revisions.set(quoteId, next);
      return { quote: next, latestRevision, updated: true };
    },
  };
}

describe("cleaning order quote revisions", () => {
  it("normalizes a bounded quote snapshot and derives totals from its line items", () => {
    expect(typeof quoteRuntime.createCleaningQuoteRevisionCore).toBe("function");
    const normalize = quoteRuntime.normalizeCleaningQuoteSnapshot as ((input: unknown) => unknown) | undefined;
    expect(normalize?.(quoteInput)).toMatchObject({ totalAmount: 120_000, supplyAmount: 109_091, vatAmount: 10_909, taxIncluded: true });
  });

  it("rejects client-supplied totals and line-item overflow instead of trusting edited totals", () => {
    const normalize = quoteRuntime.normalizeCleaningQuoteSnapshot as ((input: unknown) => unknown) | undefined;
    expect(() => normalize!({ ...quoteInput, totalAmount: 1 })).toThrow();
    expect(() => normalize!({ ...quoteInput, items: Array.from({ length: 9 }, (_, index) => ({ ...quoteInput.items[0], name: `품목 ${index}` })) })).toThrow();
  });

  it("creates an order-linked draft only for quote-pending orders and safely replays the same request", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<{ quote: Record<string, unknown>; replayed: boolean }>;
    const input = { requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput };
    const first = await create(input, { uid: "staff_01", role: "member" }, dependencies);
    const replay = await create(input, { uid: "staff_01", role: "member" }, dependencies);
    expect(first.quote).toMatchObject({ id: QUOTE_ID, orderId: ORDER_ID, buildingId: order.buildingId, revision: 1, status: "pending_review" });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(create({ ...input, requestId: RETRY_ID }, { uid: "staff_01", role: "member" }, {
      ...dependencies,
      readOrder: async () => ({
        ...order,
        status: "received",
        revision: 1,
        updatedAt: "2026-09-26T03:00:00.000Z",
        history: order.history.slice(0, 1),
      }),
    })).rejects.toThrow("cleaning_quote_order_not_ready");
  });

  it("replays a committed request after the order has advanced", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<{ quote: Record<string, unknown>; replayed: boolean }>;
    const input = { requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput };
    const first = await create(input, { uid: "staff_01", role: "member" }, dependencies);
    const replay = await create(input, { uid: "staff_01", role: "member" }, {
      ...dependencies,
      readOrder: async () => ({
        ...order,
        status: "scheduled",
        revision: 5,
        updatedAt: "2026-09-26T04:30:00.000Z",
        history: [
          ...order.history,
          { requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc513", status: "approval_pending", changedAt: "2026-09-26T04:20:00.000Z", changedByUid: "staff_01", note: "승인 요청" },
          { requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc514", status: "scheduled", changedAt: "2026-09-26T04:30:00.000Z", changedByUid: "staff_01", note: "일정 확정" },
        ],
      }),
    });
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, quote: { id: QUOTE_ID, revision: 1 } });
  });

  it("accepts a committed Firebase round-trip with reordered object keys and omitted empty arrays", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<{ quote: Record<string, unknown>; replayed: boolean }>;
    let persisted: Record<string, unknown> | null = null;
    const firebaseRoundTripDependencies = {
      ...dependencies,
      readQuoteSet: async () => persisted ? {
        orderId: ORDER_ID, buildingId: order.buildingId, latestRevision: 1, latestQuoteId: QUOTE_ID,
        revisions: { [QUOTE_ID]: persisted },
      } : null,
      createRevisionIfCurrent: async (_id: string, _expected: number, quote: Record<string, unknown>) => {
        persisted = structuredClone(quote);
        delete persisted.notes;
        persisted.company = Object.fromEntries(Object.entries(persisted.company as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
        persisted.items = (persisted.items as Array<Record<string, unknown>>).map(item => Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))));
        return { quote: persisted, latestRevision: 1, created: true };
      },
    };
    const input = { requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: { ...quoteInput, notes: [] } };

    const first = await create(input, { uid: "staff_01", role: "member" }, firebaseRoundTripDependencies);
    const replay = await create(input, { uid: "staff_01", role: "member" }, firebaseRoundTripDependencies);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.quote).toMatchObject({ id: QUOTE_ID, revision: 1, status: "pending_review" });
  });

  it("rejects a second concurrent content revision based on a stale revision", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<unknown>;
    await create({ requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_01", role: "member" }, dependencies);
    await expect(create({ requestId: RETRY_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_02", role: "member" }, dependencies))
      .rejects.toThrow("cleaning_quote_revision_conflict");
  });

  it("appends corrected quote content as a new immutable revision instead of overwriting approval history", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<{ quote: Record<string, unknown>; replayed: boolean }>;
    const first = await create({ requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_01", role: "member" }, dependencies);
    const firstSnapshot = structuredClone(first.quote);
    const correctedQuote = { ...quoteInput, projectName: "수정된 청소 견적", items: [{ ...quoteInput.items[0], unitPrice: 135_000 }] };
    const approvalPendingOrder = {
      ...order, status: "approval_pending", revision: 4, updatedAt: "2026-09-26T04:10:00.000Z",
      history: [...order.history, { requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc512", status: "approval_pending", changedAt: "2026-09-26T04:10:00.000Z", changedByUid: "staff_01", note: "검토 요청" }],
    };
    const second = await create({ requestId: RETRY_ID, orderId: ORDER_ID, expectedRevision: 1, quote: correctedQuote }, { uid: "staff_01", role: "member" }, {
      ...dependencies,
      readOrder: async () => approvalPendingOrder,
    });
    expect(second.quote).toMatchObject({ revision: 2, previousQuoteId: QUOTE_ID, projectName: "수정된 청소 견적", totalAmount: 135_000 });
    expect(second.quote.id).toBe(RETRY_ID);
    expect(dependencies.revisions.get(QUOTE_ID)).toEqual(firstSnapshot);
    expect(dependencies.revisions.size).toBe(2);
  });

  it("refuses to attach a quote to a corrupted or partial stored order", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<unknown>;
    await expect(create({ requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_01", role: "member" }, {
      ...dependencies,
      readOrder: async () => ({ id: ORDER_ID, buildingId: "building_demo_01", status: "quote_pending" }),
    })).rejects.toThrow("cleaning_quote_stored_data_invalid");
  });

  it("lets administrators approve or return the latest revision, but never treats approval as customer acceptance or billing", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<unknown>;
    const review = quoteRuntime.reviewCleaningQuoteCore as (input: unknown, actor: unknown, deps: unknown) => Promise<{ quote: Record<string, unknown>; replayed: boolean }>;
    await create({ requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_01", role: "member" }, dependencies);
    const input = { requestId: RETRY_ID, orderId: ORDER_ID, quoteId: QUOTE_ID, expectedRevision: 1, action: "approve", note: "금액과 범위 확인" };
    await expect(review(input, { uid: "staff_01", role: "member" }, dependencies)).rejects.toThrow("cleaning_quote_forbidden");
    const approved = await review(input, { uid: "admin_01", role: "admin" }, dependencies);
    const replay = await review(input, { uid: "admin_01", role: "admin" }, dependencies);
    expect(approved.quote).toMatchObject({ status: "admin_approved", totalAmount: 120_000, recipient: "합성 고객" });
    expect(approved.quote).not.toHaveProperty("customerAcceptedAt");
    expect(approved.quote).not.toHaveProperty("invoiceId");
    expect(approved.quote).not.toHaveProperty("receiptId");
    expect(approved.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
  });

  it("requires a reason for return and rejects reviewing a superseded revision", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<unknown>;
    const review = quoteRuntime.reviewCleaningQuoteCore as (input: unknown, actor: unknown, deps: unknown) => Promise<unknown>;
    await create({ requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_01", role: "member" }, dependencies);
    await expect(review({ requestId: RETRY_ID, orderId: ORDER_ID, quoteId: QUOTE_ID, expectedRevision: 1, action: "return", note: " " }, { uid: "admin_01", role: "admin" }, dependencies))
      .rejects.toThrow("invalid_cleaning_quote_input");
    dependencies.revisions.set(QUOTE_ID, { ...dependencies.revisions.get(QUOTE_ID), status: "superseded" });
    await expect(review({ requestId: RETRY_ID, orderId: ORDER_ID, quoteId: QUOTE_ID, expectedRevision: 1, action: "approve", note: "확인" }, { uid: "admin_01", role: "admin" }, dependencies))
      .rejects.toThrow("cleaning_quote_revision_conflict");
  });

  it("compares an idempotent review retry against the validated note captured before an async transaction", async () => {
    const dependencies = memoryDependencies();
    const create = quoteRuntime.createCleaningQuoteRevisionCore as (input: unknown, actor: unknown, deps: unknown) => Promise<unknown>;
    const review = quoteRuntime.reviewCleaningQuoteCore as (input: Record<string, unknown>, actor: unknown, deps: unknown) => Promise<{ quote: Record<string, unknown>; replayed: boolean }>;
    await create({ requestId: QUOTE_ID, orderId: ORDER_ID, expectedRevision: 0, quote: quoteInput }, { uid: "staff_01", role: "member" }, dependencies);
    const input = { requestId: RETRY_ID, orderId: ORDER_ID, quoteId: QUOTE_ID, expectedRevision: 1, action: "approve", note: "원본 검수 메모" };
    const savedQuote = {
      ...dependencies.revisions.get(QUOTE_ID), status: "admin_approved",
      reviewHistory: [{ requestId: RETRY_ID, action: "approve", changedAt: NOW, changedByUid: "admin_01", note: "원본 검수 메모" }],
    };
    const racingDependencies = {
      ...dependencies,
      reviewLatestRevisionIfCurrent: async () => {
        input.note = "호출 후 변경된 값";
        return { quote: savedQuote, latestRevision: 1, updated: false };
      },
    };
    const result = await review(input, { uid: "admin_01", role: "admin" }, racingDependencies);
    expect(result.replayed).toBe(true);
  });
});

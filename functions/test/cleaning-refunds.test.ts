import { describe, expect, it } from "vitest";
import { cleaningRefundCoverageIsValid, createCleaningRefundRequest, decideCleaningRefundRequest, recordCleaningRefundExecution } from "../src/cleaning-refunds.js";

const now = "2026-09-28T03:00:00.000Z";
const context = {
  orderId: "order_01", customerId: "customer_01", buildingId: "building_01",
  invoiceId: "invoice_01", paidAmount: 270000,
};
const request = {
  requestId: "refund_01", orderId: context.orderId, customerId: context.customerId,
  buildingId: context.buildingId, invoiceId: context.invoiceId, type: "partial", amount: 30000,
  reason: "고객 요청에 따라 일부 환불 처리", paymentMethod: "card",
  csReference: "CS-2026-001", note: "패딩 1벌 취소",
};

describe("cleaning refund lifecycle", () => {
  it("creates a partial refund request while preserving the paid order amount and computing the balance", () => {
    expect(createCleaningRefundRequest(null, request, context, "admin_01", now)).toMatchObject({
      ok: true, request: { amount: 30000, originalPaidAmount: 270000, remainingPaidAmount: 240000, status: "pending", revision: 1 },
    });
  });

  it("rejects a refund that exceeds the actually paid unrefunded balance", () => {
    expect(createCleaningRefundRequest(null, { ...request, amount: 270001 }, context, "admin_01", now))
      .toMatchObject({ ok: false, error: "cleaning_refund_amount_exceeds_available" });
    const first = createCleaningRefundRequest(null, request, context, "admin_01", now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(createCleaningRefundRequest({ [first.request.requestId]: first.request }, { ...request, requestId: "refund_02", amount: 240001 }, context, "admin_01", now))
      .toMatchObject({ ok: false, error: "cleaning_refund_amount_exceeds_available" });
  });

  it("requires the full paid balance for a full refund and records approval separately from payment execution", () => {
    expect(createCleaningRefundRequest(null, { ...request, type: "full", amount: 30000 }, context, "admin_01", now))
      .toMatchObject({ ok: false, error: "cleaning_refund_full_amount_mismatch" });
    const created = createCleaningRefundRequest(null, request, context, "admin_01", now);
    if (!created.ok) throw new Error("expected request to be valid");
    expect(decideCleaningRefundRequest(created.request, { decision: "approve", expectedRevision: 1, note: "확인 완료", actorUid: "admin_01", now }))
      .toMatchObject({ ok: true, request: { status: "approved", revision: 2 } });
  });

  it("requires a reason and current revision to decide, and provider proof to mark processed", () => {
    const created = createCleaningRefundRequest(null, request, context, "admin_01", now);
    if (!created.ok) throw new Error("expected request to be valid");
    expect(decideCleaningRefundRequest(created.request, { decision: "decline", expectedRevision: 1, note: "", actorUid: "admin_01", now }))
      .toMatchObject({ ok: false, error: "cleaning_refund_decision_reason_required" });
    expect(decideCleaningRefundRequest(created.request, { decision: "approve", expectedRevision: 0, note: "증빙 확인 완료", actorUid: "admin_01", now }))
      .toMatchObject({ ok: false, error: "cleaning_refund_revision_conflict" });
    const approved = decideCleaningRefundRequest(created.request, { decision: "approve", expectedRevision: 1, note: "증빙 확인 완료", actorUid: "admin_01", now });
    if (!approved.ok) throw new Error("expected approval to be valid");
    expect(recordCleaningRefundExecution(approved.request, { expectedRevision: 2, providerRef: "", evidenceRef: "", actorUid: "admin_01", now }))
      .toMatchObject({ ok: false, error: "cleaning_refund_execution_proof_required" });
    expect(recordCleaningRefundExecution(approved.request, { expectedRevision: 2, providerRef: "PG-REF-1024", evidenceRef: "drive-refund-1024", actorUid: "admin_01", now }))
      .toMatchObject({ ok: true, request: { status: "processed", providerRef: "PG-REF-1024", revision: 3 } });
  });

  it("rejects malformed requests and duplicate request IDs", () => {
    expect(createCleaningRefundRequest(null, { ...request, reason: "" }, context, "admin_01", now))
      .toMatchObject({ ok: false, error: "invalid_cleaning_refund_input" });
    const created = createCleaningRefundRequest(null, request, context, "admin_01", now);
    if (!created.ok) throw new Error("expected request to be valid");
    expect(createCleaningRefundRequest({ [request.requestId]: created.request }, request, context, "admin_01", now))
      .toMatchObject({ ok: false, error: "cleaning_refund_conflict" });
  });

  it("rechecks current paid coverage before approving or executing reserved refunds", () => {
    const created = createCleaningRefundRequest(null, request, context, "admin_01", now);
    if (!created.ok) throw new Error("expected request to be valid");
    expect(cleaningRefundCoverageIsValid({ [created.request.requestId]: created.request }, 30000)).toBe(true);
    expect(cleaningRefundCoverageIsValid({ [created.request.requestId]: created.request }, 29999)).toBe(false);
    const declined = decideCleaningRefundRequest(created.request, { decision: "decline", expectedRevision: 1, note: "환불 취소", actorUid: "admin_01", now });
    if (!declined.ok) throw new Error("expected decline to be valid");
    expect(cleaningRefundCoverageIsValid({ [declined.request.requestId]: declined.request }, 0)).toBe(true);
  });
});

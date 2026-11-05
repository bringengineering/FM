"use strict";
const crypto = require("node:crypto");

// The claim is written before contacting the provider. An uncertain outcome
// stays blocked across sessions and computers; no automatic resend is safe.
function createService(deps) {
  async function send(input, session, payload) {
    const requestedAt = new Date().toISOString();
    const claimId = crypto.randomUUID();
    const revisionKey = crypto.createHash("sha256").update(JSON.stringify([input.kind, input.documentId, input.updatedAt, input.sha256, input.customerId])).digest("hex");
    let claimed = false, providerStarted = false;
    try {
      await deps.mutate(input.documentId, row => {
        if (!row || row.archivedAt || row.deletedAt || row.deleted === true || row.updatedAt !== input.updatedAt || row.savedCustomerDocument?.sha256 !== input.sha256 || row.savedCustomerDocument?.customerId !== input.customerId || row.savedCustomerDocument?.kind !== input.kind) throw new Error("저장 문서가 변경되었습니다. 다시 선택해 주세요.");
        if (row.customerDocumentDelivery && row.customerDocumentDelivery.status !== "failed") throw new Error("이미 발송 요청한 저장본입니다. 발송 이력을 확인해 주세요.");
        return {...row, customerDocumentDelivery: {status: "sending", requestedAt, messageId: "", claimId}};
      }, session);
      claimed = true;
      await deps.verify(input, session);
      session.check();
      providerStarted = true;
      const result = await deps.deliver({...payload, delivery: {...payload.delivery, idempotencyKey: "saved_" + revisionKey}});
      session.check();
      if (!result?.ok) throw Object.assign(new Error("발송 접수 결과를 확인하지 못했습니다. 이력을 확인해 주세요."), {code: result?.code});
      const status = result.status === "requested" ? "requested" : "unknown";
      const messageId = /^[A-Za-z0-9_-]{1,120}$/.test(String(result.messageId || "")) ? String(result.messageId) : "";
      const record = await deps.mutate(input.documentId, row => {
        if (!row || row.customerDocumentDelivery?.claimId !== claimId) throw new Error("발송 이력 상태가 변경되었습니다. 재발송하지 말고 확인해 주세요.");
        return {...row, customerDocumentDelivery: {status, requestedAt, messageId, claimId}};
      }, session);
      return {ok: true, status, messageId, record};
    } catch (error) {
      if (claimed) {
        const definitelyRejected = ["DELIVERY_PROVIDER_AUTH_FAILED", "DELIVERY_PROVIDER_SERVICE_NOT_FOUND", "DELIVERY_PROVIDER_LIMITED", "DELIVERY_PROVIDER_REJECTED", "DELIVERY_CONFIGURATION_ERROR", "DELIVERY_UNAVAILABLE", "AUTH_REQUIRED", "FORBIDDEN", "INVALID_INPUT", "INPUT_TOO_LARGE"].includes(error?.code);
        await deps.mutate(input.documentId, row => {
          if (!row || row.customerDocumentDelivery?.claimId !== claimId) throw error;
          return {...row, customerDocumentDelivery: {...row.customerDocumentDelivery, status: !providerStarted || definitelyRejected ? "failed" : "unknown"}};
        }, session).catch(() => {});
      }
      throw error;
    }
  }
  return {send};
}
module.exports = {createService};

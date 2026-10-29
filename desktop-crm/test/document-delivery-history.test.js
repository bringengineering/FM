const test = require("node:test");
const assert = require("node:assert/strict");
const Delivery = require("../src/document-delivery-core");
const MessageUI = require("../src/message-ui");

test("normalizes only allowlisted document delivery audit fields", () => {
  const record = Delivery.normalizeHistoryRecord({
    id: "d1", documentId: "q1", documentType: "quote", documentName: "견적서", documentVersion: "1",
    customerId: "c1", customerName: "엄준식", maskedPhone: "010-****-0478", channel: "kakao",
    templateId: "quote_delivery", templateVersion: "1", requestedBy: "staff", requestedAt: "2026-09-04T00:00:00Z",
    providerMessageId: "p1", status: "failed", failureCode: "KAKAO_REJECTED", fallbackParentId: "",
    apiKey: "secret", providerResponse: { secret: true }, pdfBytes: "private", secureUrl: "https://private"
  });
  assert.equal(record.failureCode, "KAKAO_REJECTED");
  for (const key of ["apiKey", "providerResponse", "pdfBytes", "secureUrl"]) assert.equal(key in record, false);
});

test("failed Kakao history exposes only a manual SMS fallback action", () => {
  const html = MessageUI.renderDocumentDelivery({ customers: [], writable: true, documentDeliveries: [{ id: "d1", channel: "kakao", status: "failed", documentName: "견적서" }] });
  assert.match(html, /data-document-sms-fallback="d1"/);
  const delivered = MessageUI.renderDocumentDelivery({ customers: [], writable: true, documentDeliveries: [{ id: "d2", channel: "kakao", status: "delivered", documentName: "견적서" }] });
  assert.doesNotMatch(delivered, /data-document-sms-fallback/);
});

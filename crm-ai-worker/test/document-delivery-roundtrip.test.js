import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDocumentDeliveryHandler } from "../src/document-delivery.js";
const { requestDocumentDelivery } = createRequire(import.meta.url)("../../desktop-crm/src/document-delivery-client.js");

for (const documentType of ["completion_report", "monthly_report"]) {
  test(`${documentType}: actual desktop client and gateway preserve PDF bytes and select the matching template`, async () => {
    const values = new Map(), calls = [];
    const env = {
      DOCUMENT_DELIVERY: { async put(key, value) { values.set(key, value); }, async get(key, type) { const value = values.get(key); return type === "json" && value ? JSON.parse(value) : value || null; } },
      CRM_ADMIN_EMAILS: "admin@example.com", NCP_ACCESS_KEY: "test-access", NCP_SECRET_KEY: "test-secret",
      NCP_BIZ_MESSAGE_SERVICE_ID: "test-service", KAKAO_CHANNEL_ID: "@test",
      DOCUMENT_DELIVERY_ENABLED: "true", KAKAO_DOCUMENT_TEMPLATES_APPROVED: "true", KAKAO_MONTHLY_REPORT_ENABLED: "true",
    };
    const handler = createDocumentDeliveryHandler({readConnection:async()=>"READY", resolveMonthlyRecipient: async () => ({buildingAddress: "TEST ONLY"}), now: () => Date.parse("2026-10-12T00:00:00Z"), sendProvider: async input => { calls.push(input); return { providerMessageId: "provider_test_1" }; } });
    const request = (action, input) => requestDocumentDelivery({
      endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery", idToken: "test-token", action, input,
      fetchImpl: (url, options) => handler(new Request(url, options), { email: "admin@example.com" }, env),
    });
    const caps = await request("capabilities");
    assert.equal(caps.capabilities[documentType === "monthly_report" ? "monthlyReport" : "kakao"], true);
    const pdf = Buffer.from("%PDF-1.7\nSynthetic report\n%%EOF");
    const doc = await request("create", { documentId: "report_test", customerId: "customer_test", documentType, documentName: "전송 테스트", reportMonth: "2026-10", crmCustomerId: "customer_test", crmBuildingId:"building_fixture", buildingName: "TEST ONLY", mimeType: "application/pdf", bytes: pdf.toString("base64"), expiresAt: "2026-10-19T00:00:00Z" });
    const opened = await handler(new Request(doc.secureUrl), null, env);
    assert.equal(opened.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await opened.arrayBuffer()), pdf);
    const send = { documentId: doc.documentId, customerId: "customer_test", customerName: "테스트", phone: "01000000000", channel: "kakao", idempotencyKey: "test_send_12345678" };
    assert.equal((await request("send", send)).status, "requested");
    await request("send", send);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].templateCode, documentType === "monthly_report" ? "BRINGMONTHLYREPORTV1" : "BRINGCOMPLETIONREPORTV1");
  });
}

test("gateway rejects disguised non-PDF data even if a client bypasses validation", async () => {
  const handler = createDocumentDeliveryHandler();
  const env = { CRM_ADMIN_EMAILS: "admin@example.com", DOCUMENT_DELIVERY: { get() {}, put() { assert.fail("invalid PDF must not be stored"); } } };
  await assert.rejects(handler(new Request("https://gateway.test/v1/document-delivery/documents", { method: "POST", body: JSON.stringify({documentType: "completion_report", mimeType: "application/pdf", bytes: btoa("not a PDF")}) }), { email: "admin@example.com" }, env), /INVALID_INPUT/);
});

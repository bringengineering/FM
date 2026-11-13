import test from "node:test";
import assert from "node:assert/strict";
import {createDocumentDeliveryHandler} from "../src/document-delivery.js";

function fixture(providerError) {
  const values = new Map(), writes = new Map(); let sends = 0;
  const storage = {
    async put(key, value) {
      const previous = writes.get(key); const stamp = Date.now();
      // The real KV binding throws on a second write to the same key within 1s.
      if (previous != null && stamp - previous < 1000) throw new Error("KV_WRITE_RATE_LIMIT_FIXTURE");
      writes.set(key, stamp);
      values.set(key, value);
    },
    async get(key, type) { const value = values.get(key); return value && type === "json" ? JSON.parse(value) : value || null; },
  };
  const env = {DOCUMENT_DELIVERY: storage, CRM_ADMIN_EMAILS: "admin@example.com", DOCUMENT_DELIVERY_ENABLED: "true", KAKAO_DOCUMENT_TEMPLATES_APPROVED: "true",
    NCP_ACCESS_KEY: "fixture-access", NCP_SECRET_KEY: "fixture-secret", NCP_BIZ_MESSAGE_SERVICE_ID: "ncp:kkobizmsg:kr:fixture:service", KAKAO_CHANNEL_ID: "@fixture"};
  const handler = createDocumentDeliveryHandler({now: () => Date.parse("2026-10-13T00:00:00Z"), sendProvider: async () => {
    sends++; if (providerError) throw Object.assign(new Error(providerError), {code: providerError}); return {providerMessageId: "provider_fixture"};
  }, readProvider: async () => ({status: "delivered"})});
  const input = {documentId: "fixture_report", customerId: "fixture_customer", documentType: "completion_report", documentName: "TEST ONLY", expiresAt: "2026-10-20T00:00:00Z", mimeType: "application/pdf", bytes: btoa("%PDF-1.7\nTEST ONLY\n%%EOF"),
    delivery: {channel: "kakao", idempotencyKey: "fixture_request", customerName: "TEST", phone: "01000000000"}};
  const identity = {email: "admin@example.com"};
  const send = () => handler(new Request("https://gateway.test/v1/document-delivery/documents-and-messages", {method: "POST", body: JSON.stringify(input)}), identity, env);
  const status = id => handler(new Request(`https://gateway.test/v1/document-delivery/messages/${id}`), identity, env);
  return {send, status, values, writes, sends: () => sends};
}

test("fast provider acceptance survives the real KV same-key write limit", async () => {
  const h = fixture(); const response = await h.send(), value = await response.json();
  assert.equal(value.status, "requested");
  assert.equal((await (await h.status(value.messageId)).json()).status, "delivered");
  assert.equal((await (await h.status(value.messageId)).json()).status, "delivered");
  await h.send(); assert.equal(h.sends(), 1);
});

test("a fast, confirmed provider rejection keeps its cause under KV write limits", async () => {
  const h = fixture("DELIVERY_PROVIDER_AUTH_FAILED"); const response = await h.send(), value = await response.json();
  assert.equal(response.status, 502); assert.equal(value.code, "DELIVERY_PROVIDER_AUTH_FAILED");
  assert.equal(value.status, "failed"); assert.equal(h.sends(), 1);
});

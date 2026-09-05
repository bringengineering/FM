import test from "node:test";
import assert from "node:assert/strict";
import { documentTemplate, createDocumentDeliveryHandler, sendNcpDocument } from "../src/document-delivery.js";

const identity = { uid: "uid-1", email: "dpvld858@gmail.com" };
const memory = () => {
  const values = new Map();
  return {
    async put(key, value) { values.set(key, value); },
    async get(key, type) { const value = values.get(key); return type === "json" && value ? JSON.parse(value) : value || null; },
    async delete(key) { values.delete(key); }
  };
};

test("maps each CRM document to the approved fixed Kakao template", () => {
  assert.equal(documentTemplate("quote"), "BRINGCUSTOMERQUOTEV1");
  assert.equal(documentTemplate("completion_report"), "BRINGCOMPLETIONREPORTV1");
  assert.throws(() => documentTemplate("contract"), /INVALID_INPUT/);
});

test("capabilities stay closed until storage, NCP secrets and approval switch exist", async () => {
  const handler = createDocumentDeliveryHandler();
  const response = await handler(new Request("https://gateway.test/v1/document-delivery/capabilities"), identity, { DOCUMENT_DELIVERY: memory() });
  assert.deepEqual(await response.json(), { ok: true, capabilities: { kakao: false, sms: false } });
});

test("creates a bounded expiring PDF and serves it only through its opaque token", async () => {
  const storage = memory();
  const handler = createDocumentDeliveryHandler({ now: () => Date.parse("2026-09-04T00:00:00Z"), randomId: () => "opaque_token_1234567890" });
  const env = { DOCUMENT_DELIVERY: storage, DOCUMENT_DELIVERY_ENABLED: "true", NCP_ACCESS_KEY: "a", NCP_SECRET_KEY: "s", NCP_BIZ_MESSAGE_SERVICE_ID: "service", KAKAO_CHANNEL_ID: "@bringcare", NCP_SENS_SERVICE_ID: "sms", NCP_SENS_FROM: "0337488919" };
  const create = await handler(new Request("https://gateway.test/v1/document-delivery/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: "quote_1", documentType: "quote", documentName: "견적서", customerId: "c1", expiresAt: "2026-09-11T00:00:00Z", mimeType: "application/pdf", bytes: Buffer.from("%PDF-test").toString("base64") }) }), identity, env);
  const created = await create.json();
  assert.equal(created.ok, true);
  assert.match(created.secureUrl, /\/d\/opaque_token_1234567890$/);
  const opened = await handler(new Request(created.secureUrl), null, env);
  assert.equal(opened.status, 200);
  assert.equal(await opened.text(), "%PDF-test");
  assert.equal(opened.headers.get("content-type"), "application/pdf");
});

test("sends the exact approved AlimTalk variables and deduplicates the request key", async () => {
  const storage = memory();
  await storage.put("doc:doc_1", JSON.stringify({ id: "doc_1", token: "token", documentType: "quote", documentName: "입주청소 견적서", customerId: "c1", expiresAt: "2026-09-11T00:00:00Z", secureUrl: "https://gateway.test/d/token" }));
  const calls = [];
  const handler = createDocumentDeliveryHandler({ now: () => Date.parse("2026-09-04T00:00:00Z"), randomId: () => "message_1", sendProvider: async input => { calls.push(input); return { providerMessageId: "ncp_1" }; } });
  const env = { DOCUMENT_DELIVERY: storage, DOCUMENT_DELIVERY_ENABLED: "true", KAKAO_DOCUMENT_TEMPLATES_APPROVED: "true", NCP_ACCESS_KEY: "a", NCP_SECRET_KEY: "s", NCP_BIZ_MESSAGE_SERVICE_ID: "service", KAKAO_CHANNEL_ID: "@bringcare", NCP_SENS_SERVICE_ID: "sms", NCP_SENS_FROM: "0337488919" };
  const input = { documentId: "doc_1", customerId: "c1", customerName: "엄준식", phone: "01091690478", channel: "kakao", idempotencyKey: "request_12345678" };
  const first = await handler(new Request("https://gateway.test/v1/document-delivery/messages", { method: "POST", body: JSON.stringify(input) }), identity, env);
  const second = await handler(new Request("https://gateway.test/v1/document-delivery/messages", { method: "POST", body: JSON.stringify(input) }), identity, env);
  assert.equal((await first.json()).messageId, "message_1");
  assert.equal((await second.json()).messageId, "message_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateCode, "BRINGCUSTOMERQUOTEV1");
  assert.deepEqual(calls[0].variables, { 고객명: "엄준식", 문서명: "입주청소 견적서", 만료일: "2026-09-11", 문서링크: "gateway.test/d/token" });
});

test("builds the reviewed NCP AlimTalk payload without exposing credentials", async () => {
  const calls = [];
  const result = await sendNcpDocument({
    channel: "kakao", phone: "01091690478", templateCode: "BRINGCUSTOMERQUOTEV1",
    variables: { 고객명: "엄준식", 문서명: "입주청소 견적서", 만료일: "2026-09-11", 문서링크: "gateway.test/d/token" },
    env: { NCP_ACCESS_KEY: "access", NCP_SECRET_KEY: "secret", NCP_BIZ_MESSAGE_SERVICE_ID: "service", KAKAO_CHANNEL_ID: "@bringcare" }
  }, { now: () => 1788512400000, fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ requestId: "request-1", messages: [{ messageId: "message-1" }] }), { status: 202 }); } });
  assert.equal(result.providerMessageId, "message-1");
  assert.match(calls[0].url, /\/alimtalk\/v2\/services\/service\/messages$/);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.plusFriendId, "@bringcare");
  assert.equal(payload.templateCode, "BRINGCUSTOMERQUOTEV1");
  assert.match(payload.messages[0].content, /엄준식님, 요청하신 견적서가 발행되었습니다/);
  assert.equal(payload.messages[0].buttons[0].linkMobile, "https://gateway.test/d/token");
  assert.equal(calls[0].options.headers["x-ncp-iam-access-key"], "access");
  assert.notEqual(calls[0].options.headers["x-ncp-apigw-signature-v2"], "secret");
});

test("reads a bounded message status and revokes a document link", async () => {
  const storage = memory();
  await storage.put("message:message_1", JSON.stringify({ ok: true, messageId: "message_1", status: "requested", channel: "kakao" }));
  await storage.put("doc:doc_1", JSON.stringify({ id: "doc_1", token: "opaque_token_1234567890", expiresAt: "2026-09-11T00:00:00Z", bytes: Buffer.from("%PDF-test").toString("base64") }));
  await storage.put("token:opaque_token_1234567890", "doc_1");
  const handler = createDocumentDeliveryHandler({ now: () => Date.parse("2026-09-04T00:00:00Z") });
  const env = { DOCUMENT_DELIVERY: storage };
  const status = await handler(new Request("https://gateway.test/v1/document-delivery/messages/message_1"), identity, env);
  assert.equal((await status.json()).status, "requested");
  const revoked = await handler(new Request("https://gateway.test/v1/document-delivery/documents/doc_1/revoke", { method: "POST" }), identity, env);
  assert.equal((await revoked.json()).status, "revoked");
  const opened = await handler(new Request("https://gateway.test/d/opaque_token_1234567890"), null, env);
  assert.equal(opened.status, 410);
});

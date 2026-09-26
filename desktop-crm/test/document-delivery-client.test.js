const test = require("node:test");
const assert = require("node:assert/strict");
const { requestDocumentDelivery } = require("../src/document-delivery-client");

function response(status, value) { return { ok: status >= 200 && status < 300, status, async json() { return value; } }; }

test("calls only the fixed HTTPS document-delivery gateway with authentication", async () => {
  const calls = [];
  const result = await requestDocumentDelivery({ endpoint: "https://gateway.example/v1/document-delivery", idToken: "token", action: "capabilities", fetchImpl: async (url, options) => { calls.push([url, options]); return response(200, { ok: true, capabilities: { kakao: true, sms: false } }); } });
  assert.deepEqual(result, { ok: true, capabilities: { kakao: true, sms: false } });
  assert.equal(calls[0][0], "https://gateway.example/v1/document-delivery/capabilities");
  assert.equal(calls[0][1].headers.authorization, "Bearer token");
  await assert.rejects(requestDocumentDelivery({ endpoint: "http://gateway.example/v1/document-delivery", idToken: "token", action: "capabilities" }), /연결 주소/);
});

test("validates bounded PDF uploads and idempotent sends", async () => {
  await assert.rejects(requestDocumentDelivery({ endpoint: "https://gateway.example/v1/document-delivery", idToken: "token", action: "create", input: { mimeType: "text/html", bytes: Buffer.from("x") } }), /PDF/);
  await assert.rejects(requestDocumentDelivery({ endpoint: "https://gateway.example/v1/document-delivery", idToken: "token", action: "send", input: { documentId: "d1" } }), /요청 키/);
});

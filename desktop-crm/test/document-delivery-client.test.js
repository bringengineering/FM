const test = require("node:test");
const assert = require("node:assert/strict");
const { requestDocumentDelivery } = require("../src/document-delivery-client");

function response(status, value) { return { ok: status >= 200 && status < 300, status, async json() { return value; } }; }

test("calls only the fixed HTTPS document-delivery gateway with authentication", async () => {
  const calls = [];
  const result = await requestDocumentDelivery({ endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery", idToken: "token", action: "capabilities", fetchImpl: async (url, options) => { calls.push([url, options]); return response(200, { ok: true, capabilities: { kakao: true, sms: false } }); } });
  assert.deepEqual(result, { ok: true, capabilities: { kakao: true, monthlyReport: false, sms: false } });
  assert.equal(calls[0][0], "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery/capabilities");
  assert.equal(calls[0][1].headers.authorization, "Bearer token");
  await assert.rejects(requestDocumentDelivery({ endpoint: "http://gateway.example/v1/document-delivery", idToken: "token", action: "capabilities" }), /연결 주소/);
  await assert.rejects(requestDocumentDelivery({ endpoint: "https://gateway.example/v1/document-delivery", idToken: "token", action: "capabilities" }), /연결 주소/);
});

test("preserves monthly-report approval independently of other Kakao templates", async () => {
  for (const kakao of [true, false]) {
    for (const monthlyReport of [true, false]) {
      const capabilities = { kakao, monthlyReport, sms: false };
      const result = await requestDocumentDelivery({
        endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery",
        idToken: "token", action: "capabilities",
        fetchImpl: async () => response(200, { ok: true, capabilities }),
      });
      assert.deepEqual(result.capabilities, capabilities);
    }
  }
});

test("missing or non-boolean approval values never enable document delivery", async () => {
  for (const capabilities of [undefined, null, {}, { kakao: "true", monthlyReport: "true", sms: 1 }]) {
    const result = await requestDocumentDelivery({
      endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery",
      idToken: "token", action: "capabilities",
      fetchImpl: async () => response(200, { ok: true, capabilities }),
    });
    assert.deepEqual(result.capabilities, { kakao: false, monthlyReport: false, sms: false });
  }
});

test("validates bounded PDF uploads and idempotent sends", async () => {
  const endpoint = "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery";
  await assert.rejects(requestDocumentDelivery({ endpoint, idToken: "token", action: "create", input: { mimeType: "text/html", bytes: Buffer.from("x") } }), /PDF/);
  await assert.rejects(requestDocumentDelivery({ endpoint, idToken: "token", action: "send", input: { documentId: "d1" } }), /요청 키/);
});

test("uploads both byte and IPC base64 inputs without changing the PDF", async () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\nReport test\n"), Buffer.alloc(1024 * 1024), Buffer.from("\n%%EOF")]);
  for (const bytes of [pdf, pdf.toString("base64"), new Uint8Array(pdf), [...pdf]]) {
    await requestDocumentDelivery({
      endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery",
      idToken: "token", action: "create", input: { mimeType: "application/pdf", bytes },
      fetchImpl: async (_url, options) => {
        assert.deepEqual(Buffer.from(JSON.parse(options.body).bytes, "base64"), pdf);
        return response(200, { ok: true, documentId: "doc_1" });
      },
    });
  }
});

test("rejects non-PDF, malformed base64 and oversized encoded input before sending", async () => {
  const { MAX_PDF_BYTES } = require("../src/document-delivery-client");
  for (const bytes of [Buffer.from("not-pdf"), Buffer.from("not-pdf").toString("base64"), "bad?", "%PDF-raw", "A".repeat(4 * Math.ceil(MAX_PDF_BYTES / 3) + 1), null]) {
    await assert.rejects(requestDocumentDelivery({
      endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery",
      idToken: "token", action: "create", input: { mimeType: "application/pdf", bytes },
      fetchImpl: async () => { assert.fail("invalid PDF must not reach the gateway"); },
    }), /PDF/);
  }
});

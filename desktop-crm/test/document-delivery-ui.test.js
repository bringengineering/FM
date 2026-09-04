const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MessageUI = require("../src/message-ui");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");

test("customer messages provides a review-first document delivery tab", () => {
  const html = MessageUI.renderWorkspace({
    mode: "documents", customers: [{ id: "c1", name: "엄준식", phone: "010-9169-0478" }],
    selectedCustomerId: "c1", documentType: "quote", documentId: "quote_1",
    documentName: "햇빛빌라 입주청소 견적서", channel: "kakao", expiresOn: "2026-09-18",
    writable: true, deliveryCapabilities: { kakao: false, sms: false }, documentDeliveries: []
  });
  assert.match(html, /data-message-mode="messages"[^>]*>안내 메시지/);
  assert.match(html, /data-message-mode="documents"[^>]*>문서 발송/);
  assert.match(html, /id="customerDocumentDeliveryForm"/);
  for (const name of ["customerId", "documentType", "documentId", "documentName", "channel", "expiresOn"]) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(html, /카카오 알림톡/);
  assert.match(html, /SMS/);
  assert.match(html, /문서 PDF 미리보기/);
  assert.match(html, /발송 문구 미리보기/);
  assert.match(html, /연동 준비 필요/);
  assert.match(html, /문서 발송 이력/);
});

test("desktop loads the delivery core before message UI and wires document mode state", () => {
  const index = read("index.html");
  const app = read("app.js");
  assert.ok(index.indexOf("document-delivery-core.js") < index.indexOf("message-ui.js"));
  assert.match(app, /selectedMessageMode/);
  assert.match(app, /customerDocumentDeliveryForm/);
  assert.match(app, /data-message-mode/);
});

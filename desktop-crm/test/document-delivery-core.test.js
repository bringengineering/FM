const test = require("node:test");
const assert = require("node:assert/strict");
const Delivery = require("../src/document-delivery-core");

const base = {
  id: "delivery_1",
  documentId: "quote_1",
  documentType: "quote",
  documentName: "햇빛빌라 입주청소 견적서",
  documentVersion: "1",
  customerId: "customer_1",
  customerName: "엄준식",
  phone: "01091690478",
  channel: "kakao"
};

test("creates a 14-day informational document delivery without retaining PDF bytes", () => {
  const draft = Delivery.createDraft({ ...base, pdfBytes: Buffer.from("private") }, { now: "2026-09-04T00:00:00.000Z" });
  assert.equal(draft.phone, "010-9169-0478");
  assert.equal(draft.channel, "kakao");
  assert.equal(draft.expiresAt, "2026-09-18T00:00:00.000Z");
  assert.equal(draft.purpose, "informational");
  assert.equal("pdfBytes" in draft, false);
  assert.match(Delivery.composeMessage({ ...draft, secureUrl: "https://docs.bringcare.kr/d/token" }), /햇빛빌라 입주청소 견적서/);
});

test("rejects unsupported documents, channels, unsafe links and expiry beyond 14 days", () => {
  assert.throws(() => Delivery.createDraft({ ...base, documentType: "contract" }), /문서 종류/);
  assert.throws(() => Delivery.createDraft({ ...base, channel: "email" }), /발송 채널/);
  assert.throws(() => Delivery.createDraft({ ...base, phone: "123" }), /전화번호/);
  assert.throws(() => Delivery.createDraft({ ...base, expiresAt: "2026-10-01T00:00:00.000Z" }, { now: "2026-09-04T00:00:00.000Z" }), /14일/);
  const draft = Delivery.createDraft(base, { now: "2026-09-04T00:00:00.000Z" });
  assert.throws(() => Delivery.composeMessage({ ...draft, secureUrl: "http://example.com/file" }), /보안 링크/);
});

test("supports immutable delivery transitions and a confirmed SMS fallback", () => {
  const draft = Delivery.createDraft(base, { now: "2026-09-04T00:00:00.000Z" });
  const requested = Delivery.transition(draft, "requested", { at: "2026-09-04T01:00:00.000Z", providerMessageId: "msg_1" });
  const failed = Delivery.transition(requested, "failed", { at: "2026-09-04T01:01:00.000Z", failureCode: "KAKAO_REJECTED" });
  const fallback = Delivery.createSmsFallback(failed, { id: "delivery_2", now: "2026-09-04T01:02:00.000Z" });
  assert.equal(draft.status, "draft");
  assert.equal(failed.status, "failed");
  assert.equal(fallback.channel, "sms");
  assert.equal(fallback.fallbackParentId, "delivery_1");
  assert.equal(fallback.status, "draft");
  assert.throws(() => Delivery.createSmsFallback(requested, { id: "delivery_3" }), /실패한 카카오/);
  assert.throws(() => Delivery.transition(failed, "opened", { at: "2026-09-04T01:03:00.000Z" }), /상태 전환/);
});

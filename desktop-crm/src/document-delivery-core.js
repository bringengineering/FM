(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringDocumentDeliveryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DOCUMENT_TYPES = Object.freeze(["quote", "completion_report"]);
  const CHANNELS = Object.freeze(["kakao", "sms"]);
  const STATUSES = Object.freeze(["draft", "requested", "delivered", "failed", "opened", "expired", "revoked"]);
  const TRANSITIONS = Object.freeze({
    draft: ["requested"],
    requested: ["delivered", "failed"],
    delivered: ["opened", "expired", "revoked"],
    opened: ["expired", "revoked"],
    failed: ["revoked"],
    expired: [],
    revoked: []
  });

  function fail(message) { throw new Error(message); }
  function clean(value, limit = 160) { return String(value == null ? "" : value).trim().slice(0, limit); }
  function iso(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) fail("날짜가 올바르지 않습니다.");
    return date.toISOString();
  }
  function addDays(value, days) { const date = new Date(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString(); }
  function phone(value) {
    const digits = clean(value, 30).replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(digits)) fail("고객 전화번호를 확인해 주세요.");
    return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  function createDraft(input, options = {}) {
    const value = input || {};
    const documentType = clean(value.documentType, 40);
    const channel = clean(value.channel || "kakao", 20);
    if (!DOCUMENT_TYPES.includes(documentType)) fail("문서 종류를 확인해 주세요.");
    if (!CHANNELS.includes(channel)) fail("발송 채널을 확인해 주세요.");
    const now = iso(options.now);
    const expiresAt = value.expiresAt ? iso(value.expiresAt) : addDays(now, 14);
    if (new Date(expiresAt).getTime() <= new Date(now).getTime() || new Date(expiresAt).getTime() > new Date(addDays(now, 14)).getTime()) fail("문서 링크 만료일은 현재부터 14일 이내여야 합니다.");
    const draft = {
      id: clean(value.id, 100), documentId: clean(value.documentId, 100), documentType,
      documentName: clean(value.documentName, 160), documentVersion: clean(value.documentVersion || "1", 30),
      customerId: clean(value.customerId, 100), customerName: clean(value.customerName, 80),
      phone: phone(value.phone), channel, purpose: "informational", status: "draft",
      createdAt: now, expiresAt, secureUrl: clean(value.secureUrl, 500), fallbackParentId: clean(value.fallbackParentId, 100)
    };
    if (!draft.id || !draft.documentId || !draft.documentName || !draft.customerId || !draft.customerName) fail("고객과 문서 정보를 모두 입력해 주세요.");
    return Object.freeze(draft);
  }

  function composeMessage(value) {
    const url = clean(value && value.secureUrl, 500);
    if (!/^https:\/\//i.test(url)) fail("HTTPS 보안 링크가 필요합니다.");
    return `[BRING CARE] ${clean(value.customerName, 80)}님, 요청하신 ${clean(value.documentName, 160)}를 보내드립니다.\n${url}\n열람기한: ${iso(value.expiresAt).slice(0, 10)}`;
  }

  function transition(record, status, metadata = {}) {
    if (!record || !STATUSES.includes(record.status) || !STATUSES.includes(status) || !TRANSITIONS[record.status].includes(status)) fail("허용되지 않은 문서 발송 상태 전환입니다.");
    const at = iso(metadata.at);
    const next = Object.assign({}, record, { status, updatedAt: at });
    if (status === "requested") { next.requestedAt = at; next.providerMessageId = clean(metadata.providerMessageId, 120); }
    if (status === "delivered") next.deliveredAt = at;
    if (status === "failed") { next.failedAt = at; next.failureCode = clean(metadata.failureCode, 80) || "DELIVERY_FAILED"; }
    if (status === "opened") next.openedAt = at;
    if (status === "expired") next.expiredAt = at;
    if (status === "revoked") next.revokedAt = at;
    return Object.freeze(next);
  }

  function createSmsFallback(record, options = {}) {
    if (!record || record.channel !== "kakao" || record.status !== "failed") fail("실패한 카카오 발송만 SMS로 다시 보낼 수 있습니다.");
    return createDraft(Object.assign({}, record, {
      id: clean(options.id, 100), channel: "sms", fallbackParentId: record.id,
      expiresAt: record.expiresAt, secureUrl: record.secureUrl
    }), { now: options.now });
  }

  return Object.freeze({ DOCUMENT_TYPES, CHANNELS, STATUSES, createDraft, composeMessage, transition, createSmsFallback });
});

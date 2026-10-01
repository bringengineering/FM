(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringSavedCustomerDocuments = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  const KINDS = Object.freeze({quote: "견적서", buildingMonthlyReport: "건물 월간보고서"});
  const ID = /^[A-Za-z0-9_-]{1,120}$/;
  const phone = value => String(value || "").replace(/\D/gu, "");
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  function normalize(input) {
    const row = input || {}, doc = row.savedCustomerDocument;
    if (!doc || doc.version !== 1 || !Object.hasOwn(KINDS, doc.kind) || !ID.test(row.id || "") || !ID.test(doc.customerId || "")
      || !/^[A-Za-z0-9_-]{6,200}$/.test(row.driveFileId || "") || !/^[a-f0-9]{64}$/.test(doc.sha256 || "")
      || !Number.isSafeInteger(doc.size) || doc.size < 5 || doc.size > 12 * 1024 * 1024
      || !/^01\d{8,9}$/.test(doc.recipientPhone || "") || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))
      || (doc.kind === "buildingMonthlyReport" && (!ID.test(row.buildingId || "") || !/^\d{4}-(0[1-9]|1[0-2])$/.test(doc.month || "")))) return null;
    return {id: row.id, title: text(row.title, 160), buildingId: text(row.buildingId, 120), driveFileId: row.driveFileId,
      updatedAt: row.updatedAt, archivedAt: text(row.archivedAt, 40),
      savedCustomerDocument: {version: 1, kind: doc.kind, customerId: doc.customerId, recipientPhone: doc.recipientPhone,
        sha256: doc.sha256, size: doc.size, month: text(doc.month, 7)}};
  }
  function matches(row, customer, kind) {
    const record = normalize(row);
    return Boolean(record && !record.archivedAt && !row.deletedAt && row.deleted !== true && customer && !customer.archivedAt && !customer.deletedAt && customer.deleted !== true
      && record.savedCustomerDocument.kind === kind && record.savedCustomerDocument.customerId === String(customer.id)
      && record.savedCustomerDocument.recipientPhone === phone(customer.phone));
  }
  function list(rows, customer, kind) {
    return (Array.isArray(rows) ? rows : []).filter(row => matches(row, customer, kind)).map(normalize)
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function resolve(rows, customers, request) {
    const input = request || {};
    const customer = (customers || []).find(item => String(item.id) === String(input.customerId));
    const row = (rows || []).find(item => item && item.id === input.documentId);
    if (!matches(row, customer, input.kind)) throw new Error("선택 고객과 저장 문서가 일치하지 않습니다. 목록을 새로 확인해 주세요.");
    const record = normalize(row);
    if (record.updatedAt !== input.updatedAt || record.savedCustomerDocument.sha256 !== input.sha256) throw new Error("저장 문서가 변경되었습니다. 다시 선택하고 미리보기를 확인해 주세요.");
    return {record, customer};
  }
  return Object.freeze({KINDS, normalize, matches, list, resolve, phone});
});

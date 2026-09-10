(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOperationsWorkSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SOURCE_FIELDS = Object.freeze([
    "sourceWorkRecordId", "sourceVendorName", "sourceAmount", "title", "description", "outcome",
    "buildingId", "category", "subcategory", "trigger", "assigneeId", "completedAt",
  ]);
  const TYPES = Object.freeze({
    grounds_cutting: ["조경", "예초 작업"],
    stair_cleaning: ["청소", "계단 청소"],
    cleaning: ["청소", "일반 청소"],
    repair: ["시설", "수리"],
    inspection: ["시설", "점검"],
    meeting: ["운영", "방문·미팅"],
    other: ["기타", "기타 작업"],
  });

  function operationSourceFromWork(record) {
    if (!record || record.status !== "completed" || !record.id) return null;
    const [category, subcategory] = TYPES[record.serviceType] || TYPES.other;
    return {
      sourceWorkRecordId: String(record.id),
      sourceVendorName: String(record.vendorName || ""),
      sourceAmount: Math.max(0, Math.round(Number(record.amount) || 0)),
      title: String(record.title || subcategory),
      description: String(record.summary || ""),
      outcome: String(record.summary || ""),
      buildingId: String(record.buildingId || ""),
      category,
      subcategory,
      trigger: "작업관리 완료",
      assigneeId: String(record.owner || ""),
      status: "completed",
      completedAt: String(record.completedAt || ""),
    };
  }

  function mergeWorkSource(existing, source) {
    const result = Object.assign({}, existing || {});
    SOURCE_FIELDS.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(source || {}, field)) result[field] = source[field];
    });
    return result;
  }

  function findBySourceWorkRecordId(operations, recordId) {
    const target = String(recordId || "");
    if (!target) return null;
    return (Array.isArray(operations) ? operations : []).find(item => item && String(item.sourceWorkRecordId || "") === target) || null;
  }

  function operationIdForWork(recordId) {
    const safe = String(recordId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 111);
    return safe ? `op_work_${safe}` : "";
  }

  return Object.freeze({ SOURCE_FIELDS, operationSourceFromWork, mergeWorkSource, findBySourceWorkRecordId, operationIdForWork });
});

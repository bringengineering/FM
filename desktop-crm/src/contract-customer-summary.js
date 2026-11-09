(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./contract-schedule-core") : root.BringContractSchedule, node ? require("./core") : root.BringCore);
  if (node) module.exports = api;
  else root.BringContractCustomerSummary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Schedule, Core) {
  "use strict";
  const list = value => Array.isArray(value) ? value.filter(row => row && typeof row === "object") : [];
  function calendarSummary(contract, store, month) {
    if (!Schedule.isDate(`${month}-01`)) return {items: [], movedToOtherBuilding: false};
    const records = list(store?.serviceRecords);
    const linked = records.filter(row => [row.sourceContractId, row.contractId].some(id => id && String(id) === String(contract.id || "")));
    const belongs = row => !row.contractId || String(row.contractId) === String(contract.id || "");
    const movedToOtherBuilding = linked.some(row => !row.archivedAt && !row.deletedAt && !row.deleted && row.status !== "cancelled" && String(row.scheduledDate || "").startsWith(month) && (!belongs(row) || String(row.buildingId || "") !== String(contract.buildingId || "")));
    const current = linked.filter(row => belongs(row) && !row.archivedAt && !row.deletedAt && !row.deleted && String(row.buildingId || "") === String(contract.buildingId || "") && Schedule.isDate(row.scheduledDate) && row.scheduledDate.startsWith(month))
      .map(row => ({date: row.scheduledDate, status: row.status || "planned", source: "record"}));
    const projected = Schedule.contractWorkOccurrences({contracts: [contract], serviceRecords: records}, month)
      .filter(row => row.scheduledDate.startsWith(month))
      .map(row => ({date: row.scheduledDate, status: row.status || "planned", source: "contract"}));
    return {items: [...current, ...projected].sort((a,b) => a.date.localeCompare(b.date)), movedToOtherBuilding};
  }
  function paymentSummary(contract, month, today) {
    if (!Core.isContractPaymentDate(contract.paymentDueDate)) return {status: "missing", date: ""};
    const row = Core.contractPaymentRows([contract], month, "all", today)[0];
    if (!row) return {status: "none", date: ""};
    return {status: row.status, date: row.dueDate};
  }
  function relationshipReason(customer, contractCount, paidManagement) {
    if (contractCount) return "";
    if (customer?.stage === "계약 확정") return "연결된 계약 없음 · 고객 상태가 계약 확정입니다.";
    if (paidManagement) return "연결된 계약 없음 · 영업 단계가 유료관리입니다.";
    return "연결된 계약 없음";
  }
  return {calendarSummary, paymentSummary, relationshipReason};
});

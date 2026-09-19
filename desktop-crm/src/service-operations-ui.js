(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BringServiceOperationsUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const money = value => `${Math.max(0, Number(value) || 0).toLocaleString("ko-KR")}원`;
  const label = type => ({ grounds_cutting: "예초 작업", stair_cleaning: "계단 청소" })[type] || "운영 서비스";
  function renderBuildingServices(building, store) {
    const id = String(building && building.id || "");
    const records = (store.serviceRecords || []).filter(item => String(item.buildingId || "") === id);
    const contracts = (store.serviceContracts || []).filter(item => String(item.buildingId || "") === id);
    const schedules = (store.serviceSchedules || []).filter(item => String(item.buildingId || "") === id);
    const rows = records.map(item => `<div class="building-detail-record"><div><b>${esc(label(item.serviceType))} · 완료</b><span>${esc(item.completedAt)} · ${esc(item.vendorName)} · ${esc(money(item.amount))}</span><small>${esc(item.summary)}</small></div>${item.evidenceUrl ? `<button type="button" class="mini-button" data-service-evidence="${esc(item.evidenceUrl)}">Drive 원본 ↗</button>` : ""}</div>`).join("");
    const contractsHtml = contracts.map(item => `<div class="building-detail-record"><div><b>${esc(label(item.serviceType))} · ${item.status === "active" ? "진행 중" : "계약 예정"}</b><span>${item.cadence === "weekly" ? "주 1회" : esc(item.cadence)} · 월 ${esc(money(item.monthlyAmount))} · ${esc(item.startDate || "시작일 미정")}</span></div></div>`).join("");
    const scheduleHtml = schedules.map(item => `<div class="building-detail-record" data-service-schedule="${esc(item.id)}"><div><b>${esc(item.scheduledDate)}</b><span>${esc(item.status || "예정")}</span></div></div>`).join("");
    return `<section class="building-detail-section wide service-operations"><header><b>운영 서비스</b><span>완료 ${records.length}건 · 정기계약 ${contracts.length}건</span></header><div class="building-detail-body">${rows}${contractsHtml}${scheduleHtml}${!records.length && !contracts.length ? `<div class="building-detail-empty">아직 등록된 운영 서비스가 없습니다.</div>` : ""}</div></section>`;
  }
  return { renderBuildingServices };
});

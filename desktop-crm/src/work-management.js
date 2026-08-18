(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BringWorkManagement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const won = value => `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString("ko-KR")}원`;
  const typeLabel = value => ({ grounds_cutting: "예초 작업", stair_cleaning: "계단 청소", cleaning: "청소", repair: "수리", inspection: "점검" })[value] || "기타 작업";
  const statusLabel = value => ({ planned: "예정", in_progress: "진행 중", completed: "완료", cancelled: "취소" })[value] || "예정";
  const safeList = value => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];

  function buildModel(store, options) {
    const settings = options || {};
    if (!store || settings.available === false) return { available: false, items: [], buildings: [], kpis: { today: 0, planned: 0, inProgress: 0, completed: 0, completedCost: 0, recurringMonthlyCost: 0 } };
    const buildings = safeList(store.buildings);
    const buildingMap = new Map(buildings.map(item => [String(item.id || ""), item]));
    const records = safeList(store.serviceRecords).map(item => ({
      kind: "record", id: String(item.id || ""), buildingId: String(item.buildingId || ""), serviceType: String(item.serviceType || ""),
      title: String(item.title || typeLabel(item.serviceType)), status: String(item.status || "planned"), scheduledDate: String(item.scheduledDate || ""),
      completedAt: String(item.completedAt || ""), owner: String(item.owner || ""), vendorName: String(item.vendorName || ""), amount: Math.max(0, Number(item.amount) || 0),
      summary: String(item.summary || ""), evidenceUrl: String(item.evidenceUrl || ""), building: buildingMap.get(String(item.buildingId || "")) || null,
    }));
    const contracts = safeList(store.serviceContracts).filter(item => item.status !== "cancelled").map(item => ({
      kind: "contract", id: String(item.id || ""), buildingId: String(item.buildingId || ""), serviceType: String(item.serviceType || ""),
      title: String(item.title || typeLabel(item.serviceType)), status: String(item.status === "active" ? "in_progress" : "planned"), cadence: String(item.cadence || ""),
      startDate: String(item.startDate || ""), monthlyAmount: Math.max(0, Number(item.monthlyAmount) || 0), summary: String(item.summary || ""),
      building: buildingMap.get(String(item.buildingId || "")) || null,
    }));
    const items = [...records, ...contracts];
    const month = String(settings.month || new Date().toISOString().slice(0, 7));
    const today = String(settings.today || new Date().toISOString().slice(0, 10));
    return {
      available: true, buildings, items,
      kpis: {
        today: records.filter(item => item.scheduledDate === today).length,
        planned: items.filter(item => item.status === "planned").length,
        inProgress: items.filter(item => item.status === "in_progress").length,
        completed: records.filter(item => item.status === "completed").length,
        completedCost: records.filter(item => item.status === "completed" && item.completedAt.slice(0, 7) === month).reduce((sum, item) => sum + item.amount, 0),
        recurringMonthlyCost: contracts.filter(item => item.status !== "cancelled").reduce((sum, item) => sum + item.monthlyAmount, 0),
      }
    };
  }

  function filterItems(model, filters) {
    const value = filters || {};
    return (model.items || []).filter(item => (!value.status || value.status === "all" || item.status === value.status)
      && (!value.buildingId || value.buildingId === "all" || item.buildingId === value.buildingId)
      && (!value.serviceType || value.serviceType === "all" || item.serviceType === value.serviceType));
  }

  function renderDashboard(model, options) {
    const opts = options || {};
    if (!model || model.available === false) return `<section class="work-sync-error"><b>작업 데이터를 불러오지 못했습니다</b><span>작업 없음이 아니라 동기화 확인 필요 상태입니다. 잠시 후 다시 확인해 주세요.</span></section>`;
    const items = filterItems(model, opts.filters);
    const cards = items.map(item => {
      const date = item.kind === "contract" ? (item.startDate || "시작일 확인 필요") : (item.completedAt || item.scheduledDate || "일정 미정");
      const cost = item.kind === "contract" ? `월 ${won(item.monthlyAmount)}` : won(item.amount);
      const cadence = item.cadence === "weekly" ? "주 1회" : item.cadence;
      return `<article class="work-card" data-work-id="${esc(item.id)}"><div class="work-card-status status-${esc(item.status)}">${esc(statusLabel(item.status))}</div><div class="work-card-main"><span>${esc(item.building && (item.building.name || item.building.address) || "건물 미연결")}</span><h3>${esc(item.title)}</h3><p>${esc([date, cadence, item.vendorName, cost].filter(Boolean).join(" · "))}</p><small>${esc(item.summary || (item.kind === "contract" ? "정기 작업 계약" : "작업 내용 미입력"))}</small></div><div class="work-card-actions">${item.evidenceUrl ? `<button class="secondary-button" data-work-evidence="${esc(item.evidenceUrl)}">Drive 증빙 ↗</button>` : ""}${opts.canWrite ? `<button class="mini-button" data-work-edit="${esc(item.id)}">상세</button>` : ""}</div></article>`;
    }).join("");
    const buildingOptions = (model.buildings || []).map(item => `<option value="${esc(item.id)}">${esc(item.name || item.address || item.id)}</option>`).join("");
    return `<section class="work-management"><div class="work-kpis"><div><span>오늘 작업</span><b>${model.kpis.today}</b></div><div><span>예정</span><b>${model.kpis.planned}</b></div><div><span>진행 중</span><b>${model.kpis.inProgress}</b></div><div><span>완료</span><b>${model.kpis.completed}</b></div><div><span>이번 달 완료 비용</span><b>${won(model.kpis.completedCost)}</b></div><div><span>월 정기 예정액</span><b>${won(model.kpis.recurringMonthlyCost)}</b></div></div><div class="work-layout"><aside class="work-filters"><b>작업 필터</b><label><span>상태</span><select data-work-filter="status"><option value="all">전체</option><option value="planned">예정</option><option value="in_progress">진행 중</option><option value="completed">완료</option></select></label><label><span>건물</span><select data-work-filter="buildingId"><option value="all">전체 건물</option>${buildingOptions}</select></label></aside><div class="work-list">${cards || `<div class="empty-state"><b>조건에 맞는 작업이 없습니다</b></div>`}</div></div></section>`;
  }

  return { buildModel, filterItems, renderDashboard, typeLabel, statusLabel };
});

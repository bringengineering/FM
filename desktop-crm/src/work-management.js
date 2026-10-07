(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BringWorkManagement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const won = value => `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString("ko-KR")}원`;
  const typeLabel = value => ({ grounds_cutting: "예초 작업", stair_cleaning: "계단 청소", cleaning: "청소", repair: "수리", inspection: "점검", meeting: "방문·미팅" })[value] || "기타 작업";
  const statusLabel = value => ({ planned: "예정", in_progress: "진행 중", completed: "완료", cancelled: "취소" })[value] || "예정";
  const safeList = value => Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
  const contractStatus = value => value === "종료" ? "completed" : ["진행 중", "종료 예정"].includes(value) ? "in_progress" : "planned";

  function contractServiceType(contract) {
    const text = [contract && contract.name, contract && contract.scope, contract && contract.memo, ...(Array.isArray(contract && contract.types) ? contract.types : [contract && contract.type])]
      .filter(Boolean).join(" ").toLocaleLowerCase("ko");
    if (/예초|제초|잔디/.test(text)) return "grounds_cutting";
    if (/계단[^\s]*\s*청소|계단청소/.test(text)) return "stair_cleaning";
    if (/청소|미화|폐기물/.test(text)) return "cleaning";
    if (/수리|보수|교체|설비/.test(text)) return "repair";
    if (/점검|검사|관리/.test(text)) return "inspection";
    if (/방문|미팅|상담/.test(text)) return "meeting";
    return "other";
  }

  function buildModel(store, options) {
    const settings = options || {};
    if (!store || settings.available === false) return { available: false, items: [], buildings: [], kpis: { today: 0, planned: 0, inProgress: 0, completed: 0, completedCost: 0, recurringMonthlyCost: 0 } };
    const buildings = safeList(store.buildings);
    const buildingMap = new Map(buildings.map(item => [String(item.id || ""), item]));
    const records = safeList(store.serviceRecords).map(item => ({
      kind: "record", id: String(item.id || ""), buildingId: String(item.buildingId || ""), serviceType: String(item.serviceType || ""),
      title: String(item.title || typeLabel(item.serviceType)), status: String(item.status || "planned"), scheduledDate: String(item.scheduledDate || ""),
      completedAt: String(item.completedAt || ""), owner: String(item.owner || ""), vendorName: String(item.vendorName || ""), amount: Math.max(0, Number(item.amount) || 0),
      summary: String(item.summary || ""), evidenceUrl: String(item.evidenceUrl || ""), operationsSyncStatus: String(item.operationsSyncStatus || ""), building: buildingMap.get(String(item.buildingId || "")) || null,
    }));
    const contracts = safeList(store.serviceContracts).filter(item => item.status !== "cancelled").map(item => ({
      kind: "contract", id: String(item.id || ""), buildingId: String(item.buildingId || ""), serviceType: String(item.serviceType || ""),
      title: String(item.title || typeLabel(item.serviceType)), status: String(item.status === "active" ? "in_progress" : "planned"), cadence: String(item.cadence || ""),
      startDate: String(item.startDate || ""), monthlyAmount: Math.max(0, Number(item.monthlyAmount) || 0), summary: String(item.summary || ""),
      building: buildingMap.get(String(item.buildingId || "")) || null,
    }));
    const crmContracts = safeList(store.contracts).filter(item => item.billingCycle === "건별").map(item => {
      const status = contractStatus(String(item.status || ""));
      const scheduledDate = String(item.workDate || item.startDate || "");
      const types = Array.isArray(item.types) ? item.types : [item.type];
      return {
        kind: "crm_contract", id: String(item.id || ""), contractId: String(item.id || ""), buildingId: String(item.buildingId || ""),
        serviceType: contractServiceType(item), title: String(item.name || types.filter(Boolean).join("·") || "계약 작업"), status, scheduledDate,
        completedAt: status === "completed" ? String(item.workDate || item.endDate || "") : "", owner: String(item.owner || ""), vendorName: "",
        amount: Math.max(0, Number(item.vendorCost) || 0), summary: String(item.scope || item.memo || ""), evidenceUrl: "",
        building: buildingMap.get(String(item.buildingId || "")) || null,
      };
    });
    const oneOffWork = [...records, ...crmContracts];
    const items = [...oneOffWork, ...contracts];
    const month = String(settings.month || new Date().toISOString().slice(0, 7));
    const today = String(settings.today || new Date().toISOString().slice(0, 10));
    return {
      available: true, buildings, items,
      kpis: {
        today: oneOffWork.filter(item => item.scheduledDate === today).length,
        planned: items.filter(item => item.status === "planned").length,
        inProgress: items.filter(item => item.status === "in_progress").length,
        completed: oneOffWork.filter(item => item.status === "completed").length,
        completedCost: oneOffWork.filter(item => item.status === "completed" && (item.completedAt || item.scheduledDate).slice(0, 7) === month).reduce((sum, item) => sum + item.amount, 0),
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
      const sync = item.kind === "record" && item.status === "completed" ? ({ synced:"운영 분석 연동 완료", required:"운영 분석 연동 필요", checking:"운영 분석 연동 확인 중", error:"연동 상태 확인 실패" }[item.operationsSyncStatus] || "") : "";
      const retry = item.operationsSyncStatus === "required" && opts.canWrite ? `<button class="secondary-button" data-work-sync-retry="${esc(item.id)}">연동 재시도</button>` : "";
      const detail = item.kind === "record"
        ? `<button class="mini-button" data-work-edit="${esc(item.id)}">상세</button>`
        : item.kind === "crm_contract" ? `<button class="mini-button" data-contract-edit="${esc(item.contractId)}">계약 상세</button>` : "";
      const source = item.kind === "crm_contract" ? `<small class="work-card-source">계약 일정에서 자동 연동</small>` : "";
      const fallback = item.kind === "contract" ? "정기 작업 계약" : item.kind === "crm_contract" ? "계약 작업 내용 미입력" : "작업 내용 미입력";
      return `<article class="work-card" data-work-id="${esc(item.id)}" data-work-kind="${esc(item.kind)}"><div class="work-card-status status-${esc(item.status)}">${esc(statusLabel(item.status))}</div><div class="work-card-main"><span>${esc(item.building && (item.building.name || item.building.address) || "건물 미연결")}</span><h3>${esc(item.title)}</h3><p>${esc([date, cadence, item.vendorName, cost].filter(Boolean).join(" · "))}</p><small>${esc(item.summary || fallback)}</small>${source}${sync ? `<small class="work-sync-state sync-${esc(item.operationsSyncStatus)}">${esc(sync)}</small>` : ""}</div><div class="work-card-actions">${item.evidenceUrl ? `<button class="secondary-button" data-work-evidence="${esc(item.evidenceUrl)}">Drive 증빙 ↗</button>` : ""}${retry}${opts.canWrite ? detail : ""}</div></article>`;
    }).join("");
    const buildingOptions = (model.buildings || []).map(item => `<option value="${esc(item.id)}">${esc(item.name || item.address || item.id)}</option>`).join("");
    return `<section class="work-management"><div class="work-kpis"><div><span>오늘 작업</span><b>${model.kpis.today}</b></div><div><span>예정</span><b>${model.kpis.planned}</b></div><div><span>진행 중</span><b>${model.kpis.inProgress}</b></div><div><span>완료</span><b>${model.kpis.completed}</b></div><div><span>이번 달 완료 비용</span><b>${won(model.kpis.completedCost)}</b></div><div><span>월 정기 예정액</span><b>${won(model.kpis.recurringMonthlyCost)}</b></div></div><div class="work-layout"><aside class="work-filters"><b>작업 필터</b><label><span>상태</span><select data-work-filter="status"><option value="all">전체</option><option value="planned">예정</option><option value="in_progress">진행 중</option><option value="completed">완료</option></select></label><label><span>건물</span><select data-work-filter="buildingId"><option value="all">전체 건물</option>${buildingOptions}</select></label></aside><div class="work-list">${cards || `<div class="empty-state"><b>조건에 맞는 작업이 없습니다</b></div>`}</div></div></section>`;
  }

  return { buildModel, filterItems, renderDashboard, typeLabel, statusLabel, contractServiceType };
});

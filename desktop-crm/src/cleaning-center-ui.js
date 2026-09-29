(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCleaningCenterUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  const groups = Object.freeze([
    { id: "intake", title: "고객 접수", description: "새 문의를 확인하고 기존 고객·건물 기록에 연결합니다.", items: [
      ["consultations", "상담 기록", "전화·방문·미팅과 다음 연락을 기록"],
      ["pipeline", "문의·영업 접수", "신규 문의와 요청 진행 상태 확인"],
      ["customers", "고객·건물", "기존 고객과 건물 상세·이력 조회"],
      ["cases", "고객 요청·민원", "접수·담당·처리·재확인 관리"]
    ] },
    { id: "estimate", title: "견적과 일정", description: "요청 범위를 견적으로 정리하고 작업 일정으로 연결합니다.", items: [
      ["quotes", "견적서", "항목·단가·단건 견적 작성"],
      ["deliveryFlow", "수주·작업 진행", "견적 이후 담당·단계·완료 확인"],
      ["buildingCalendar", "일정·방문", "건물별 일정과 입금 예정 조회"],
      ["partnerQuotes", "협력업체 견적", "업체별 상담과 견적 비교"]
    ] },
    { id: "field", title: "현장 작업", description: "작업 지시부터 사진·결과 기록까지 같은 업무 흐름으로 관리합니다.", items: [
      ["workOrders", "작업 지시", "담당자·기한·완료 기준 확인"],
      ["workManagement", "현장 작업 관리", "예정·진행·완료와 비용 기록"],
      ["workReports", "작업 결과·사진", "작업 전후 사진과 결과보고서"],
      ["buildingAtlas", "건물·설비 정보", "공간·설비·점검 자료 확인"]
    ] },
    { id: "care", title: "고객 후속 관리", description: "작업 이후 안내와 반복 관리 기록을 이어갑니다.", items: [
      ["customerNotices", "고객 안내", "작업 결과 및 안내 이력"],
      ["contracts", "계약·정기관리", "계약 조건과 관리기간 조회"],
      ["contracts", "청구·입금 장부", "계약별 청구와 확인된 입금 기록"],
      ["partnerVendors", "협력업체 관리", "업체 정보와 협업 이력"],
      ["cleaningAnalytics", "청소 운영 분석", "청소 주문·지역·서비스·청구 현황"],
      ["operationsIntelligence", "운영 현황", "업무량과 처리 흐름 분석"]
    ] }
  ]);

  const orderStatuses = Object.freeze([
    ["received", "접수"], ["reviewing", "검토 중"], ["quote_pending", "견적 대기"],
    ["approval_pending", "승인 대기"], ["scheduled", "일정 확정"], ["in_progress", "작업 중"],
    ["review_pending", "검수 대기"], ["revision_requested", "보완 요청"], ["completed", "완료"], ["cancelled", "취소"],
  ]);

  const orderQueueStages = Object.freeze([
    { key: "intake", label: "접수·검토", status: "received,reviewing", statuses: ["received", "reviewing"] },
    { key: "estimateApproval", label: "견적·승인 대기", status: "quote_pending,approval_pending", statuses: ["quote_pending", "approval_pending"] },
    { key: "scheduledWork", label: "예정·진행 중", status: "scheduled,in_progress", statuses: ["scheduled", "in_progress"] },
    { key: "review", label: "결과 검토 대기", status: "review_pending", statuses: ["review_pending"] },
    { key: "revision", label: "보완 요청", status: "revision_requested", statuses: ["revision_requested"] },
    { key: "completed", label: "완료", status: "completed", statuses: ["completed"] },
    { key: "overdue", label: "기한 초과", status: "__overdue", statuses: [] },
  ]);

  function isOverdueOrder(order, asOf) {
    return Boolean(order && order.desiredDate && /^\d{4}-\d{2}-\d{2}$/u.test(String(order.desiredDate))
      && order.desiredDate < asOf && !["completed", "cancelled"].includes(String(order.status || "")));
  }

  function summarizeOrderQueue(input) {
    const data = input || {};
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const counts = Object.fromEntries(orderQueueStages.map(stage => [stage.key, 0]));
    if (data.ordersLoaded !== true || data.ordersLoading || data.ordersError) {
      return { state: data.ordersError ? "error" : data.ordersLoading ? "loading" : "pending", counts, overdue: null, total: 0, scopeLabel: "", updatedAtLabel: "" };
    }
    for (const order of orders) {
      const stage = orderQueueStages.find(item => item.statuses.includes(String(order?.status || "")));
      if (stage) counts[stage.key] += 1;
    }
    const asOf = /^\d{4}-\d{2}-\d{2}$/u.test(String(data.asOf || "")) ? data.asOf : "";
    const overdue = asOf ? orders.filter(order => isOverdueOrder(order, asOf)).length : 0;
    counts.overdue = overdue;
    const updatedAt = Number(data.ordersUpdatedAt);
    const updatedAtDate = Number.isFinite(updatedAt) ? new Date(updatedAt) : null;
    const updatedAtLabel = updatedAtDate && Number.isFinite(updatedAtDate.getTime())
      ? `자료 갱신 ${updatedAtDate.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`
      : "";
    return {
      state: orders.length ? "ready" : "empty", counts,
      overdue,
      total: orders.length,
      scopeLabel: data.ordersHasMore ? `최근 불러온 ${orders.length}건 · 전체 주문 중 일부` : `확인된 전체 주문 ${orders.length}건`,
      updatedAtLabel,
    };
  }

  const serviceLabels = Object.freeze({
    move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소",
    stair_cleaning: "계단 청소", other: "기타 서비스",
  });

  function seoulDateKey(value) {
    const raw = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(timestamp));
    const part = key => parts.find(item => item.type === key)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  function shiftDateKey(value, offset) {
    const date = new Date(`${value}T12:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function regionLabel(address) {
    const parts = String(address || "").trim().split(/\s+/u).filter(Boolean);
    return parts.find(value => /(?:시|군|구)$/u.test(value) && !/(?:특별시|광역시|자치시)$/u.test(value))
      || parts.find(value => /(?:특별시|광역시|자치시)$/u.test(value))
      || (parts.length ? "지역 확인 필요" : "주소 미등록");
  }

  function timestampOf(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function receivedAtLabel(value) {
    const timestamp = timestampOf(value);
    return timestamp ? new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(timestamp)) : "접수 시각 미기록";
  }

  function receivedAgeLabel(value, nowValue) {
    const timestamp = timestampOf(value);
    const now = Number.isFinite(Number(nowValue)) && Number(nowValue) > 0 ? Number(nowValue) : Date.now();
    if (!timestamp) return "경과 시간 미확인";
    const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    if (days) return `${days}일 ${hours}시간 경과`;
    if (hours) return `${hours}시간 ${rest}분 경과`;
    return `${rest}분 경과`;
  }

  function summarizeCleaningDashboard(input) {
    const data = input || {};
    const loaded = data.ordersLoaded === true && !data.ordersLoading && !data.ordersError;
    const orders = loaded && Array.isArray(data.orders) ? data.orders : [];
    const reportsAvailable = data.reportsLoaded === true && !data.reportsError;
    const today = /^\d{4}-\d{2}-\d{2}$/u.test(String(data.asOf || "")) ? data.asOf : "";
    const byStatus = Object.fromEntries(orderStatuses.map(([status]) => [status, 0]));
    const byService = new Map();
    const byRegion = new Map();
    const byDay = new Map();
    const alerts = [];
    let todayReceived = 0;
    let assigned = 0;
    let unassignedScheduled = 0;
    let reportCount = 0;
    for (const order of orders) {
      const status = String(order?.status || "");
      if (Object.prototype.hasOwnProperty.call(byStatus, status)) byStatus[status] += 1;
      if (today && seoulDateKey(order?.createdAt) === today) todayReceived += 1;
      if (order?.serviceType) byService.set(order.serviceType, (byService.get(order.serviceType) || 0) + 1);
      if (order?.buildingAddress || order?.buildingName) {
        const region = regionLabel(order.buildingAddress);
        const current = byRegion.get(region) || { region, count: 0 };
        current.count += 1;
        byRegion.set(region, current);
      }
      const workOrders = Array.isArray(order?.relatedWorkOrders) ? order.relatedWorkOrders : [];
      if (workOrders.some(item => item?.status === "assigned")) assigned += 1;
      else if (status === "scheduled") unassignedScheduled += 1;
      for (const report of reportsAvailable && Array.isArray(order?.relatedReports) ? order.relatedReports : []) {
        reportCount += 1;
        const date = seoulDateKey(report?.workDate);
        if (date) byDay.set(`${date}:reports`, (byDay.get(`${date}:reports`) || 0) + 1);
      }
      for (const event of Array.isArray(order?.history) ? order.history : []) {
        const date = seoulDateKey(event?.changedAt);
        if (!date || (today && date > today)) continue;
        alerts.push({ orderId: order.id, title: order.title, status: event.status, changedAt: event.changedAt });
      }
      const created = seoulDateKey(order?.createdAt);
      if (created) byDay.set(`${created}:orders`, (byDay.get(`${created}:orders`) || 0) + 1);
    }
    const days = today ? Array.from({ length: 7 }, (_, index) => {
      const date = shiftDateKey(today, index - 6);
      return {
        date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
        orders: byDay.get(`${date}:orders`) || 0, reports: byDay.get(`${date}:reports`) || 0,
      };
    }) : [];
    alerts.sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")));
    const serviceColors = ["#2775E8", "#20B982", "#8A6CE5", "#F3A33C", "#93A2B4"];
    const services = [...byService.entries()].sort((a, b) => b[1] - a[1]).map(([key, count], index) => ({
      key, label: serviceLabels[key] || "서비스 유형 확인 필요", count, color: serviceColors[index % serviceColors.length],
    }));
    const totalServiceOrders = services.reduce((sum, item) => sum + item.count, 0);
    let serviceCursor = 0;
    const serviceGradient = services.length ? `conic-gradient(${services.map(item => {
      const start = serviceCursor;
      serviceCursor += item.count / totalServiceOrders * 100;
      return `${item.color} ${start.toFixed(2)}% ${serviceCursor.toFixed(2)}%`;
    }).join(", ")})` : "conic-gradient(#E9EEF4 0% 100%)";
    const regions = [...byRegion.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const overdue = today ? orders.filter(order => isOverdueOrder(order, today)).length : 0;
    const recentAlerts = alerts.slice(0, 5);
    const tasks = [
      { label: "견적·승인 대기 주문", count: byStatus.quote_pending + byStatus.approval_pending, status: "quote_pending,approval_pending" },
      { label: "배정이 필요한 일정", count: unassignedScheduled, status: "scheduled" },
      { label: "결과 검수 대기", count: byStatus.review_pending, status: "review_pending" },
      { label: "기한 초과 주문", count: overdue, status: "__overdue" },
    ];
    return {
      state: !loaded ? (data.ordersError ? "error" : data.ordersLoading ? "loading" : "pending") : orders.length ? "ready" : "empty",
      total: orders.length, todayReceived, assigned, inProgress: byStatus.in_progress,
      reviewPending: byStatus.review_pending, completed: byStatus.completed, byStatus,
      days, services, serviceGradient, totalServiceOrders, regions,
      alerts: recentAlerts, tasks, reportCount, reportsError: Boolean(data.reportsError),
      reportsLoaded: reportsAvailable,
      scopeLabel: data.ordersError ? "주문 조회 실패" : data.ordersLoading || data.ordersLoaded !== true ? "청소 주문 자료 대기" : data.ordersHasMore ? `최근 불러온 ${orders.length}건 기준 · 전체 주문 중 일부` : `확인된 청소 주문 ${orders.length}건 기준`,
      updatedAtLabel: Number.isFinite(Number(data.ordersUpdatedAt)) && Number(data.ordersUpdatedAt) > 0
        ? new Date(Number(data.ordersUpdatedAt)).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }) : "",
    };
  }

  function cleaningQuotePricesConfirmed(items, confirmedIndices, pricedIndices) {
    if (!Array.isArray(items) || !items.length || !Array.isArray(confirmedIndices) || !Array.isArray(pricedIndices)) return false;
    const confirmed = new Set(confirmedIndices.filter(index => Number.isSafeInteger(index) && index >= 0));
    const priced = new Set(pricedIndices.filter(index => Number.isSafeInteger(index) && index >= 0));
    return items.every((item, index) => Number.isFinite(Number(item?.unitPrice))
      && Number(item.unitPrice) > 0 && priced.has(index) && confirmed.has(index));
  }

  function selectCleaningPricingPolicy(policies, region, quoteDate) {
    if (typeof region !== "string" || !region.trim() || !/^\d{4}-\d{2}-\d{2}$/u.test(String(quoteDate || ""))) return null;
    return (Array.isArray(policies) ? policies : []).map(record => record?.policy || record)
      .filter(policy => policy?.publication === "published" && policy.region === region.trim() && /^\d{4}-\d{2}-\d{2}$/u.test(policy.effectiveFrom) && policy.effectiveFrom <= quoteDate)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || String(b.policyId).localeCompare(String(a.policyId)))[0] || null;
  }

  function calculateCleaningPrice(policy, input) {
    const data = input || {};
    if (!policy || !["apartment", "villa", "detached"].includes(data.housingType) || !Number.isFinite(data.areaPyeong) || data.areaPyeong <= 0 || data.areaPyeong > 1000) throw new Error("청소 가격 계산 조건을 확인해 주세요.");
    const band = [18, 24, 30, 34, Number.POSITIVE_INFINITY].findIndex(max => data.areaPyeong <= max);
    const baseAmount = policy.basePrices?.[data.housingType]?.[band];
    const addonIds = Array.isArray(data.addOnIds) ? data.addOnIds : [];
    const addons = addonIds.map(id => (policy.addOns || []).find(item => item.id === id));
    if (!Number.isSafeInteger(baseAmount) || baseAmount < 1 || addons.some(item => !item) || new Set(addonIds).size !== addonIds.length) throw new Error("선택한 가격표나 추가 서비스를 확인해 주세요.");
    const promotionRequested = Number(data.promotionDiscount || 0);
    const membershipRequested = Number(data.membershipDiscount || 0);
    if (!Number.isSafeInteger(promotionRequested) || promotionRequested < 0 || !Number.isSafeInteger(membershipRequested) || membershipRequested < 0) throw new Error("할인 금액은 0원 이상의 정수여야 합니다.");
    const addOnAmount = addons.reduce((sum, item) => sum + item.amount, 0);
    const promotionDiscount = Math.min(promotionRequested, policy.discountCaps?.promotion || 0);
    const membershipDiscount = Math.min(membershipRequested, policy.discountCaps?.membership || 0);
    const totalAmount = baseAmount + addOnAmount - promotionDiscount - membershipDiscount;
    if (!Number.isSafeInteger(totalAmount) || totalAmount < 1) throw new Error("할인 후 견적 금액이 1원 이상이어야 합니다.");
    return { policyId: policy.policyId, baseAmount, addOnAmount, promotionDiscount, membershipDiscount, totalAmount, addons };
  }

  function renderCleaningDashboard(input) {
    const data = input || {};
    const summary = summarizeCleaningDashboard(data);
    const selectedStatusFilter = String(data.orderStatusFilter || "all");
    const moneyCard = `<article class="cleaning-dashboard-kpi cleaning-dashboard-settlement"><span>오늘 매출</span><strong>연동 대기</strong><small>청소 주문과 확정 청구·입금 장부가 연결되면 표시합니다.</small></article>`;
    const metrics = [
      ["오늘 접수", summary.todayReceived, "오늘 접수된 청소 주문"],
      ["주문", summary.total, summary.scopeLabel],
      ["배정 완료", summary.assigned, "담당 작업지시가 연결된 주문"],
      ["작업 진행 중", summary.inProgress, "현재 진행 상태인 주문"],
      ["완료", summary.completed, "완료 상태인 주문"],
    ].map(([label, value, detail]) => `<article class="cleaning-dashboard-kpi"><span>${escapeHtml(label)}</span><strong>${summary.state === "ready" || summary.state === "empty" ? Number(value).toLocaleString("ko-KR") : "—"}</strong><small>${escapeHtml(detail)}</small></article>`).join("");
    const chart = summary.days.length ? (() => {
      const max = Math.max(1, ...summary.days.flatMap(day => [day.orders, day.reports]));
      const x = index => 28 + index * 94;
      const y = value => 132 - value / max * 104;
      const orderPoints = summary.days.map((day, index) => `${x(index)},${y(day.orders)}`).join(" ");
      const reportPoints = summary.days.map((day, index) => `${x(index)},${y(day.reports)}`).join(" ");
      return `<svg class="cleaning-trend-chart" viewBox="0 0 620 170" role="img" aria-label="최근 7일 일자별 신규 청소 주문과 결과보고 건수"><line x1="28" y1="28" x2="592" y2="28"/><line x1="28" y1="80" x2="592" y2="80"/><line x1="28" y1="132" x2="592" y2="132"/><polyline class="is-orders" points="${orderPoints}"/><polyline class="is-reports" points="${reportPoints}"/>${summary.days.map((day, index) => `<circle class="is-orders" cx="${x(index)}" cy="${y(day.orders)}" r="3.5"><title>${escapeHtml(day.label)} 주문 ${day.orders}건</title></circle><circle class="is-reports" cx="${x(index)}" cy="${y(day.reports)}" r="3.5"><title>${escapeHtml(day.label)} 결과보고 ${day.reports}건</title></circle><text x="${x(index)}" y="157" text-anchor="middle">${escapeHtml(day.label)}</text>`).join("")}</svg>`;
    })() : `<div class="cleaning-dashboard-empty">기간별 주문 자료를 불러오면 추이를 표시합니다.</div>`;
    const serviceList = summary.services.length ? summary.services.map(item => `<li><i style="--service-color:${item.color}" aria-hidden="true"></i><span>${escapeHtml(item.label)}</span><b>${item.count.toLocaleString("ko-KR")}건</b></li>`).join("") : `<li class="cleaning-dashboard-muted">분류할 청소 주문이 없습니다.</li>`;
    const alerts = summary.alerts.length ? summary.alerts.map(item => `<li><span class="cleaning-alert-dot" aria-hidden="true"></span><div><b>${escapeHtml(item.title || item.orderId || "청소 주문")}</b><small>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(item.orderId || "주문 ID 없음")}</small></div><time>${escapeHtml(item.changedAt ? new Date(item.changedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }) : "")}</time></li>`).join("") : `<li class="cleaning-dashboard-muted">표시할 주문 변경 기록이 없습니다.</li>`;
    const regions = summary.regions.length ? summary.regions.map(item => `<li><span>${escapeHtml(item.region)}</span><b>${item.count.toLocaleString("ko-KR")}건</b><i style="--region-fill:${Math.max(10, item.count / summary.regions[0].count * 100)}%" aria-hidden="true"></i></li>`).join("") : `<li class="cleaning-dashboard-muted">주소가 연결된 주문이 없습니다.</li>`;
    const canFilter = summary.state === "ready" || summary.state === "empty";
    const tasks = summary.tasks.map(item => `<button type="button" class="cleaning-dashboard-task" data-cleaning-status-preset="${escapeHtml(item.status)}"${canFilter ? "" : " disabled"}><span>${escapeHtml(item.label)}</span><b>${item.count.toLocaleString("ko-KR")}건</b></button>`).join("");
    const unavailable = summary.state === "loading" || summary.state === "pending"
      ? `<div class="cleaning-dashboard-state" role="status">청소 주문을 불러오면 실제 CRM 자료로 현황을 표시합니다.</div>`
      : summary.state === "error" ? `<div class="cleaning-dashboard-state is-error" role="alert">청소 주문 현황을 불러오지 못했습니다. 아래 주문 목록도 현재 값으로 갱신되지 않았습니다.</div>` : "";
    return `<section class="cleaning-dashboard" aria-label="청소 클리닝센터 통합 운영 대시보드">
      <header class="cleaning-dashboard-heading"><div><span class="cleaning-center-eyebrow">BRING CLEANING CENTER</span><h2>안녕하세요. 오늘의 청소 운영 현황입니다.</h2><p>화면의 집계는 기존 CRM에 연결된 청소 주문과 결과보고를 기준으로 합니다.</p></div><small>${escapeHtml(summary.scopeLabel)}${summary.updatedAtLabel ? ` · ${escapeHtml(summary.updatedAtLabel)} 갱신` : ""}</small></header>
      ${unavailable}
      <div class="cleaning-dashboard-kpis">${metrics}${moneyCard}</div>
      <div class="cleaning-dashboard-top-grid">
        <section class="cleaning-dashboard-card cleaning-dashboard-trend"><header><div><h3>일별 주요 지표</h3><p>주문 접수와 현장 결과보고 기록 · 최근 7일</p></div><span class="cleaning-dashboard-period">대한민국 표준시</span></header><div class="cleaning-dashboard-legend"><span><i class="is-orders"></i>신규 청소 주문</span><span><i class="is-reports"></i>결과보고</span></div>${summary.state === "error" ? `<div class="cleaning-dashboard-empty">조회 실패로 그래프를 표시하지 않습니다.</div>` : chart}<small class="cleaning-dashboard-source">${escapeHtml(summary.scopeLabel)}${summary.reportsError ? " · 결과보고 조회 실패" : !summary.reportsLoaded ? " · 결과보고 자료 대기" : ` · 확인된 결과보고 ${summary.reportCount}건`}</small></section>
        <section class="cleaning-dashboard-card cleaning-dashboard-service"><header><div><h3>서비스 유형 비중</h3><p>현재 불러온 청소 주문</p></div></header><div class="cleaning-dashboard-service-body"><div class="cleaning-dashboard-donut" style="--service-gradient:${summary.serviceGradient}"><span><b>${summary.state === "ready" || summary.state === "empty" ? summary.totalServiceOrders.toLocaleString("ko-KR") : "—"}</b><small>주문</small></span></div><ul>${serviceList}</ul></div></section>
        <section class="cleaning-dashboard-card cleaning-dashboard-alerts"><header><div><h3>최근 주문 변경</h3><p>청소 주문 상태 이력</p></div></header><ul>${summary.state === "error" ? `<li class="cleaning-dashboard-muted">조회 실패로 최근 변경을 표시하지 않습니다.</li>` : alerts}</ul></section>
      </div>
      <div class="cleaning-dashboard-bottom-grid">
        <section class="cleaning-dashboard-card cleaning-dashboard-work"><header><div><h3>오늘의 진행 현황</h3><p>${escapeHtml(summary.scopeLabel)} · 기존 주문 큐에서 바로 열 수 있습니다.</p></div><span class="cleaning-dashboard-period">${summary.total.toLocaleString("ko-KR")}건</span></header><div class="cleaning-dashboard-status-tabs">${[["all", "전체", summary.total], ["received,reviewing", "접수", summary.byStatus.received + summary.byStatus.reviewing], ["scheduled,in_progress", "예정·작업", summary.byStatus.scheduled + summary.byStatus.in_progress], ["review_pending", "검수", summary.byStatus.review_pending], ["completed", "완료", summary.byStatus.completed]].map(([filter, label, count]) => `<button type="button" data-cleaning-status-preset="${filter}" class="${filter === selectedStatusFilter ? "is-active" : ""}"${canFilter ? "" : " disabled"}>${escapeHtml(label)} <b>${Number(count).toLocaleString("ko-KR")}</b></button>`).join("")}</div><p class="cleaning-dashboard-queue-note">주문 목록에서 고객·건물·희망일·상태·담당자와 다음 작업을 확인합니다.</p></section>
        <section class="cleaning-dashboard-card cleaning-dashboard-region"><header><div><h3>지역별 주문 현황</h3><p>연결된 건물 주소에서 시·군·구만 집계</p></div></header><ul>${regions}</ul></section>
        <section class="cleaning-dashboard-card cleaning-dashboard-tasks"><header><div><h3>오늘의 할 일</h3><p>주문 상태에 따라 자동 집계</p></div></header><div>${tasks}</div><small>청소 주문과 매출·지급 원장은 아직 별도입니다.</small></section>
      </div>
    </section>`;
  }

  function renderCleaningPricingPolicyDialog(input) {
    const data = input || {};
    const policies = Array.isArray(data.policies) ? data.policies : [];
    const selected = policies.find(item => item?.policy?.policyId === data.editingPolicyId)?.policy;
    const defaultPrices = { apartment: [180000, 240000, 280000, 320000, 360000], villa: [160000, 220000, 260000, 300000, 340000], detached: [200000, 260000, 320000, 360000, 400000] };
    const prices = selected?.basePrices || defaultPrices;
    const addons = selected?.addOns || [
      { id: "balcony", name: "베란다 청소", description: "베란다 바닥, 유리, 배수구 등", amount: 20000 },
      { id: "window", name: "창틀 청소", description: "전체 창틀 및 방충망 포함", amount: 30000 },
      { id: "ac", name: "에어컨 분해 청소", description: "벽걸이형 기준 (스탠드형 별도)", amount: 15000 },
      { id: "waste", name: "폐기물 처리", description: "생활 폐기물 수거 및 처리", amount: 30000 },
    ];
    const housing = [["apartment", "아파트"], ["villa", "빌라 / 연립주택"], ["detached", "단독주택"]];
    const bands = ["18평 이하", "19~24평", "25~30평", "31~34평", "35평 이상"];
    const rows = housing.map(([key, label]) => `<tr><th>${label}</th>${prices[key].map((amount, index) => `<td><input required type="number" min="1" max="100000000" step="1000" name="base_${key}_${index}" data-cleaning-pricing-base value="${Number(amount)}" aria-label="${label} ${bands[index]} 기본요금"></td></tr>`).join("")}</tr>`).join("");
    const addonRows = addons.map((addon, index) => `<tr><td><input required maxlength="64" name="addon_id_${index}" value="${escapeHtml(addon.id)}" aria-label="추가 서비스 ID"></td><td><input required maxlength="80" name="addon_name_${index}" value="${escapeHtml(addon.name)}" aria-label="추가 서비스 이름"></td><td><input maxlength="240" name="addon_description_${index}" value="${escapeHtml(addon.description || "")}" aria-label="추가 서비스 설명"></td><td><input required type="number" min="1" max="100000000" step="1000" name="addon_amount_${index}" data-cleaning-pricing-addon value="${Number(addon.amount)}" aria-label="추가 서비스 요금"></td></tr>`).join("");
    const policyRows = policies.map(record => { const policy = record.policy || {}; return `<tr><td>${escapeHtml(policy.name)}</td><td>${escapeHtml(policy.region)}</td><td>${escapeHtml(policy.effectiveFrom)}</td><td>${policy.publication === "published" ? "게시" : "임시저장"}</td><td>${escapeHtml(record.createdAt || "")}</td></tr>`; }).join("");
    return `<section class="cleaning-pricing-policy-modal" aria-labelledby="cleaningPricingPolicyTitle"><header class="modal-head"><div><h2 id="cleaningPricingPolicyTitle">가격정책 설정</h2><p>지역과 적용 시작일에 따라 새 견적에 적용할 가격표를 관리합니다.</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></header><form class="modal-body" data-cleaning-pricing-policy-form data-policy-id="${escapeHtml(selected?.policyId || "")}"><div class="form-grid"><label class="field"><span>가격표 명 *</span><input required maxlength="100" name="policyName" value="${escapeHtml(selected?.name || "입주청소 가격표 v1.2")}"></label><label class="field"><span>적용 지역 *</span><input required maxlength="80" name="policyRegion" value="${escapeHtml(selected?.region || "원주시")}"></label><label class="field"><span>적용 시작일 *</span><input required type="date" name="policyEffectiveFrom" value="${escapeHtml(selected?.effectiveFrom || data.today || "")}"></label><label class="field"><span>상태</span><select name="policyPublication"><option value="draft"${selected?.publication !== "published" ? " selected" : ""}>임시저장</option><option value="published"${selected?.publication === "published" ? " selected" : ""}>게시</option></select></label></div><h3>1. 기본 요금 (주거 형태 / 평수 기준)</h3><div class="cleaning-pricing-table-wrap"><table class="cleaning-pricing-table"><thead><tr><th>주거 형태</th>${bands.map(band => `<th>${band}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div><h3>2. 추가 서비스 요금 (선택사항)</h3><div class="cleaning-pricing-table-wrap"><table class="cleaning-pricing-table cleaning-pricing-addon-table"><thead><tr><th>서비스 ID</th><th>서비스 항목</th><th>설명</th><th>추가 요금</th></tr></thead><tbody>${addonRows}</tbody></table></div><h3>3. 할인 정책 (한도 설정)</h3><div class="form-grid"><label class="field"><span>쿠폰/프로모션 최대 할인 한도 (원)</span><input required type="number" min="0" max="100000000" step="1000" name="promotionCap" value="${Number(selected?.discountCaps?.promotion ?? 50000)}"></label><label class="field"><span>멤버십 추가 할인 한도 (원)</span><input required type="number" min="0" max="100000000" step="1000" name="membershipCap" value="${Number(selected?.discountCaps?.membership ?? 30000)}"></label></div><div class="info-box">기존 확정 주문 금액은 변경하지 않습니다. 새 가격표는 적용 시작일 이후 작성하는 새 견적에만 적용됩니다.</div><h3>저장된 가격표</h3><div class="cleaning-pricing-table-wrap"><table class="cleaning-pricing-table"><thead><tr><th>가격표</th><th>지역</th><th>적용 시작일</th><th>상태</th><th>등록일</th></tr></thead><tbody>${policyRows || `<tr><td colspan="5">저장된 가격표가 없습니다.</td></tr>`}</tbody></table></div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">닫기</button><button type="submit" class="secondary-button" name="publication" value="draft" data-cleaning-pricing-save="draft">임시저장</button><button type="submit" class="primary-button" name="publication" value="published" data-cleaning-pricing-save="published">가격표 게시</button></div></form></section>`;
  }

  function renderCleaningPartnerSearch(input) {
    const data = input || {};
    const partners = Array.isArray(data.cleaningPartners) ? data.cleaningPartners : [];
    const serviceOptions = [
      ["move_in_cleaning", "입주 청소"], ["move_out_cleaning", "퇴실 청소"],
      ["common_cleaning", "공용부 청소"], ["stair_cleaning", "계단 청소"], ["other", "기타 청소"],
    ];
    const cards = partners.map(partner => {
      const id = String(partner?.id || "");
      const name = String(partner?.name || "").trim();
      const region = String(partner?.region || "").trim();
      const services = String(partner?.serviceText || "").trim();
      const phone = String(partner?.phone || "").trim();
      const search = `${name} ${region} ${services} ${phone}`.trim();
      return `<article class="cleaning-partner-candidate" data-cleaning-partner-candidate data-partner-id="${escapeHtml(id)}" data-partner-region="${escapeHtml(region)}" data-partner-services="${escapeHtml(services)}" data-partner-search="${escapeHtml(search)}"><div><h4>${escapeHtml(name || "업체명 미입력")}</h4><small>${escapeHtml(region || "활동 지역 미기록")}</small></div><p>${escapeHtml(services || "서비스 범위 미기록")}</p><small>${escapeHtml(phone || "연락처 미기록")}</small><button type="button" class="text-button" data-cleaning-view="partnerVendors">기존 업체 정보 열기</button></article>`;
    }).join("");
    return `<section class="cleaning-partner-search" aria-labelledby="cleaningPartnerSearchTitle"><header><div><span class="cleaning-center-eyebrow">PARTNER SEARCH</span><h3 id="cleaningPartnerSearchTitle">청소 협력업체 검색</h3><p>기존 CRM 업체 정보에서 지역과 등록된 서비스 범위를 찾아봅니다.</p></div><button type="button" class="secondary-button" data-cleaning-view="partnerVendors">협력업체 관리</button></header><div class="cleaning-partner-filters"><label><span>활동 지역</span><input type="search" data-cleaning-partner-filter="region" placeholder="예: 원주시·강남구"></label><label><span>서비스 범위</span><select data-cleaning-partner-filter="service"><option value="all">전체 서비스</option>${serviceOptions.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><label><span>업체 검색</span><input type="search" data-cleaning-partner-filter="query" placeholder="업체명·연락처·서비스"></label><small data-cleaning-partner-count>${partners.length.toLocaleString("ko-KR")}개 업체</small></div>${partners.length ? `<div class="cleaning-partner-candidates">${cards}</div><p class="cleaning-partner-no-results" data-cleaning-partner-no-results hidden>조건에 맞는 등록 업체가 없습니다.</p>` : `<p class="cleaning-dashboard-empty">검색할 협력업체가 CRM에 등록되어 있지 않습니다.</p>`}<footer>추천 순위·수락률·평점·가격·실시간 가능 여부는 CRM에 근거 자료가 없어 표시하지 않습니다.</footer></section>`;
  }

  function matchesCleaningPartnerFilter(partner, filters = {}) {
    const normalize = value => String(value || "").trim().toLocaleLowerCase("ko-KR");
    const region = normalize(partner?.region);
    const services = normalize(partner?.serviceText);
    const search = normalize([partner?.name, partner?.region, partner?.serviceText, partner?.phone].join(" "));
    const regionQuery = normalize(filters.region);
    const query = normalize(filters.query);
    const service = String(filters.service || "all");
    const serviceTerms = {
      move_in_cleaning: ["입주", "입주청소"],
      move_out_cleaning: ["퇴실", "이사청소", "퇴거"],
      common_cleaning: ["공용", "공용부"],
      stair_cleaning: ["계단"],
      other: ["기타", "청소"],
    }[service] || [];
    return (!regionQuery || region.includes(regionQuery))
      && (!query || search.includes(query))
      && (service === "all" || serviceTerms.some(term => services.includes(normalize(term))));
  }

  function summarizeCleaningDispatch(input) {
    const data = input || {};
    if (data.ordersLoaded !== true || data.ordersLoading || data.ordersError) {
      return { state: data.ordersError ? "error" : data.ordersLoading ? "loading" : "pending", jobs: [], regions: [], waitingAssignment: 0, scheduledToday: 0, completedToday: 0, overdue: 0, total: 0 };
    }
    const today = /^\d{4}-\d{2}-\d{2}$/u.test(String(data.asOf || "")) ? data.asOf : "";
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const jobs = orders.filter(order => ["approval_pending", "scheduled", "in_progress", "revision_requested"].includes(String(order?.status || "")))
      .map(order => {
        const workOrders = (Array.isArray(order.relatedWorkOrders) ? order.relatedWorkOrders : [])
          .filter(item => !["done", "cancelled"].includes(String(item?.status || "")));
        const assigned = workOrders.some(item => String(item?.assigneeName || "").trim() && String(item.assigneeName).trim() !== "담당자 미배정");
        return {
          ...order,
          region: regionLabel(order.buildingAddress),
          dispatchState: assigned ? "assigned" : "awaiting_assignment",
          dispatchLabel: assigned ? "담당 배정" : "배정 대기",
          dispatchWorkOrders: workOrders,
          overdue: isOverdueOrder(order, today),
        };
      })
      .sort((a, b) => String(a.desiredDate || "9999-99-99").localeCompare(String(b.desiredDate || "9999-99-99")) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const regionsMap = new Map();
    for (const job of jobs) regionsMap.set(job.region, (regionsMap.get(job.region) || 0) + 1);
    const regions = [...regionsMap.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, "ko")).slice(0, 6);
    const completedToday = today ? orders.filter(order => Array.isArray(order.history) && order.history.some(event => event?.status === "completed" && seoulDateKey(event.changedAt) === today)).length : 0;
    return {
      state: orders.length ? "ready" : "empty",
      jobs,
      regions,
      waitingAssignment: jobs.filter(job => job.dispatchState === "awaiting_assignment").length,
      scheduledToday: jobs.filter(job => ["scheduled", "in_progress"].includes(job.status) && job.desiredDate === today).length,
      completedToday,
      overdue: jobs.filter(job => job.overdue).length,
      total: jobs.length,
      scopeLabel: data.ordersHasMore ? `최근 불러온 ${orders.length}건 중 배차 대상 ${jobs.length}건` : `확인된 주문 ${orders.length}건 중 배차 대상 ${jobs.length}건`,
    };
  }

  function matchesCleaningDispatchFilter(order, filters = {}, todayValue) {
    const row = order && typeof order === "object" ? order : {};
    const today = /^\d{4}-\d{2}-\d{2}$/u.test(String(todayValue || "")) ? String(todayValue) : "";
    const regionQuery = String(filters.region || "").trim().toLocaleLowerCase("ko-KR");
    const regionText = `${row.buildingAddress || ""} ${regionLabel(row.buildingAddress)}`.toLocaleLowerCase("ko-KR");
    const service = String(filters.service || "all");
    const date = String(filters.date || "all");
    const status = String(filters.status || "all");
    const workOrders = (Array.isArray(row.relatedWorkOrders) ? row.relatedWorkOrders : []).filter(item => !["done", "cancelled"].includes(String(item?.status || "")));
    const assigned = workOrders.some(item => String(item?.assigneeName || "").trim() && String(item.assigneeName).trim() !== "담당자 미배정");
    const overdue = isOverdueOrder(row, today);
    const nextWeek = today && row.desiredDate && row.desiredDate >= today && row.desiredDate <= shiftDateKey(today, 7);
    const dateMatches = date === "all" || (date === "today" && row.desiredDate === today) || (date === "next7" && nextWeek) || (date === "overdue" && overdue);
    const statusMatches = status === "all" || (status === "assigned" && assigned) || (status === "awaiting_assignment" && !assigned) || (status === "overdue" && overdue) || status === row.status;
    return (!regionQuery || regionText.includes(regionQuery))
      && (service === "all" || row.serviceType === service)
      && dateMatches
      && statusMatches;
  }

  function renderCleaningDispatchTower(input) {
    const data = input || {};
    const summary = summarizeCleaningDispatch(data);
    const metrics = [
      ["배정 대기", summary.waitingAssignment, "승인 대기·일정 확정·작업 중"],
      ["오늘 일정", summary.scheduledToday, "오늘 희망일인 예정·진행 작업"],
      ["오늘 완료", summary.completedToday, "상태 이력의 완료 시각 기준"],
      ["지연 위험", summary.overdue, "희망일 경과·완료 전 주문"],
    ].map(([label, value, detail]) => `<article class="cleaning-dispatch-kpi"><span>${escapeHtml(label)}</span><strong>${summary.state === "ready" || summary.state === "empty" ? Number(value).toLocaleString("ko-KR") : "—"}<small>건</small></strong><small>${escapeHtml(detail)}</small></article>`).join("");
    const statusMessage = summary.state === "error" ? "주문 자료를 불러오지 못해 배차 현황을 숨겼습니다." : summary.state === "loading" || summary.state === "pending" ? "주문을 불러오는 중입니다." : "현재 배차 대상 주문이 없습니다.";
    const jobs = summary.jobs.map(order => {
      const workOrder = order.dispatchWorkOrders[0];
      const activeWorkOrder = order.dispatchWorkOrders.length > 0;
      const canCreateWorkOrder = data.canCreateWorkOrders === true && !activeWorkOrder;
      return `<article class="cleaning-dispatch-job" data-cleaning-dispatch-job data-dispatch-id="${escapeHtml(order.id)}" data-dispatch-region="${escapeHtml(order.region)}" data-dispatch-service="${escapeHtml(order.serviceType || "")}" data-dispatch-date="${escapeHtml(order.desiredDate || "")}" data-dispatch-status="${escapeHtml(order.status)}" data-dispatch-assignment="${escapeHtml(order.dispatchState)}" data-dispatch-overdue="${order.overdue ? "true" : "false"}"><div class="cleaning-dispatch-job-main"><small>${escapeHtml(order.id || "주문 번호 확인 필요")} · ${escapeHtml(order.region)}</small><strong>${escapeHtml(order.title || "청소 요청")}</strong><span>${escapeHtml(order.customerName || "고객 정보 확인 필요")} · ${escapeHtml(serviceLabels[order.serviceType] || "서비스 유형 확인 필요")}</span></div><div class="cleaning-dispatch-job-meta"><b class="${order.overdue ? "is-overdue" : ""}">${escapeHtml(order.desiredDate || "희망일 미정")}${order.overdue ? " · 지연" : ""}</b><span>${escapeHtml(order.dispatchLabel)}${workOrder ? ` · ${escapeHtml(workOrder.assigneeName || "담당자 미배정")}` : ""}</span>${data.canManageDispatch === true ? `<button type="button" class="text-button" data-action="create-cleaning-partner-offer" data-order-id="${escapeHtml(order.id)}">배차·지연 이력</button>` : ""}${canCreateWorkOrder ? `<button type="button" class="secondary-button" data-action="create-cleaning-work-order" data-order-id="${escapeHtml(order.id)}">작업지시 만들기</button>` : `<button type="button" class="text-button" data-action="view-cleaning-order-details" data-order-id="${escapeHtml(order.id)}">주문 열기</button>`}</div></article>`;
    }).join("");
    const regionList = summary.regions.length ? summary.regions.map(item => `<li><span>${escapeHtml(item.region)}</span><b>${item.count.toLocaleString("ko-KR")}건</b></li>`).join("") : `<li class="is-empty">지역 정보가 있는 배차 대상이 없습니다.</li>`;
    return `<section class="cleaning-dispatch-tower" id="cleaning-dispatch-tower" aria-labelledby="cleaningDispatchTowerTitle"><header class="cleaning-dispatch-tower-head"><div><span class="cleaning-center-eyebrow">DISPATCH CONTROL TOWER</span><h3 id="cleaningDispatchTowerTitle">배차 관제</h3><p>청소 주문과 기존 작업지시의 담당자·희망일을 연결해 봅니다.</p></div><div><small>${escapeHtml(summary.scopeLabel || statusMessage)}</small><button type="button" class="secondary-button" data-cleaning-view="workOrders">작업지시 배정 관리</button></div></header><div class="cleaning-dispatch-kpis">${metrics}</div><div class="cleaning-dispatch-layout"><section class="cleaning-dispatch-queue"><header><div><h4>배차 작업 큐</h4><small>${summary.jobs.length.toLocaleString("ko-KR")}건 · ${escapeHtml(summary.state === "ready" || summary.state === "empty" ? summary.scopeLabel : statusMessage)}</small></div></header><div class="cleaning-dispatch-filters"><label><span>지역</span><input type="search" data-cleaning-dispatch-filter="region" placeholder="예: 원주시"></label><label><span>서비스</span><select data-cleaning-dispatch-filter="service"><option value="all">전체 서비스</option>${Object.entries(serviceLabels).map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}</select></label><label><span>이용일</span><select data-cleaning-dispatch-filter="date"><option value="all">전체 기간</option><option value="today">오늘</option><option value="next7">7일 이내</option><option value="overdue">지연</option></select></label><label><span>상태</span><select data-cleaning-dispatch-filter="status"><option value="all">전체 상태</option><option value="awaiting_assignment">배정 대기</option><option value="assigned">담당 배정</option><option value="scheduled">일정 확정</option><option value="in_progress">작업 중</option><option value="revision_requested">보완 요청</option><option value="overdue">지연 위험</option></select></label><small data-cleaning-dispatch-count>0 / ${summary.jobs.length.toLocaleString("ko-KR")}건</small></div>${jobs ? `<div class="cleaning-dispatch-job-list">${jobs}</div><p class="cleaning-dispatch-no-match" data-cleaning-dispatch-no-match hidden>필터에 맞는 배차 주문이 없습니다.</p>` : `<p class="cleaning-dispatch-empty" role="status">${escapeHtml(statusMessage)}</p>`}</section><aside class="cleaning-dispatch-regions"><h4>지역별 배차</h4><p>등록된 건물 주소에서 지역 단위로 집계</p><ul>${regionList}</ul><div class="cleaning-dispatch-limits"><b>표시 범위</b><span>건물 좌표가 없어 지도 핀·이동 거리·실시간 위치는 표시하지 않습니다.</span><span>파트너 제안·수락률 자료가 없어 제안 건수나 추천 순위를 계산하지 않습니다.</span></div></aside></div></section>`;
  }

  function summarizeCleaningSchedule(input) {
    const data = input || {};
    if (data.ordersLoaded !== true || data.ordersLoading || data.ordersError) {
      return { state: data.ordersError ? "error" : data.ordersLoading ? "loading" : "pending", month: "", monthLabel: "일정 자료 대기", selectedDate: "", days: [], selectedOrders: [], regions: [], monthTotal: 0, selectedDateTotal: 0, undatedCount: 0 };
    }
    const today = /^\d{4}-\d{2}-\d{2}$/u.test(String(data.asOf || "")) ? data.asOf : "";
    const month = /^\d{4}-\d{2}$/u.test(String(data.scheduleMonth || "")) ? data.scheduleMonth : today.slice(0, 7);
    if (!month) return { state: "empty", month: "", monthLabel: "일정 자료 없음", selectedDate: "", days: [], selectedOrders: [], regions: [], monthTotal: 0, selectedDateTotal: 0, undatedCount: 0 };
    const selectedDateInput = String(data.selectedScheduleDate || "");
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/u.test(selectedDateInput) && selectedDateInput.slice(0, 7) === month
      ? selectedDateInput : (today.slice(0, 7) === month ? today : `${month}-01`);
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const scheduled = orders.filter(order => /^\d{4}-\d{2}-\d{2}$/u.test(String(order?.desiredDate || "")));
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(Date.UTC(year, monthNumber - 1, 1));
    const firstCell = new Date(first.getTime());
    firstCell.setUTCDate(firstCell.getUTCDate() - first.getUTCDay());
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstCell.getTime());
      date.setUTCDate(firstCell.getUTCDate() + index);
      const dateKey = date.toISOString().slice(0, 10);
      return { date: dateKey, day: date.getUTCDate(), inMonth: dateKey.slice(0, 7) === month, isToday: dateKey === today, isSelected: dateKey === selectedDate, count: scheduled.filter(order => order.desiredDate === dateKey).length };
    });
    const selectedOrders = scheduled.filter(order => order.desiredDate === selectedDate)
      .slice().sort((a, b) => String(a.status || "").localeCompare(String(b.status || ""), "ko") || String(a.title || "").localeCompare(String(b.title || ""), "ko"));
    const regionCounts = new Map();
    for (const order of selectedOrders) {
      if (!order.buildingAddress) continue;
      const region = regionLabel(order.buildingAddress);
      regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
    }
    const regions = [...regionCounts.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, "ko")).slice(0, 6);
    return {
      state: orders.length ? "ready" : "empty", month,
      monthLabel: `${year}년 ${monthNumber}월`, selectedDate, days, selectedOrders, regions,
      monthTotal: scheduled.filter(order => order.desiredDate.startsWith(`${month}-`)).length,
      selectedDateTotal: selectedOrders.length,
      undatedCount: orders.filter(order => !/^\d{4}-\d{2}-\d{2}$/u.test(String(order?.desiredDate || ""))).length,
    };
  }

  function renderCleaningSchedule(input) {
    const data = input || {};
    const summary = summarizeCleaningSchedule(data);
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"].map(day => `<span>${day}</span>`).join("");
    const days = summary.days.map(item => `<button type="button" class="cleaning-schedule-day${item.inMonth ? "" : " is-outside"}${item.isToday ? " is-today" : ""}${item.isSelected ? " is-selected" : ""}${item.count ? " has-orders" : ""}" data-cleaning-schedule-date="${escapeHtml(item.date)}" aria-pressed="${item.isSelected ? "true" : "false"}"${item.inMonth ? "" : " tabindex=\"-1\""}><span>${item.day}</span>${item.count ? `<b>${item.count}건</b>` : ""}</button>`).join("");
    const orders = summary.selectedOrders.map(order => `<article class="cleaning-schedule-order"><div><small>${escapeHtml(order.id || "주문 번호 확인 필요")} · ${escapeHtml(regionLabel(order.buildingAddress))}</small><strong>${escapeHtml(order.title || "청소 요청")}</strong><span>${escapeHtml(order.customerName || "고객 연결 확인 필요")} · ${escapeHtml(order.buildingName || "건물 연결 확인 필요")} · ${escapeHtml(serviceLabels[order.serviceType] || "서비스 유형 확인 필요")}</span></div><span class="cleaning-order-status">${escapeHtml(order.statusLabel || statusLabel(order.status))}</span><button type="button" class="text-button" data-action="view-cleaning-order-details" data-order-id="${escapeHtml(order.id)}">주문 상세</button></article>`).join("");
    const regions = summary.regions.length ? summary.regions.map(item => `<li><span>${escapeHtml(item.region)}</span><b>${item.count.toLocaleString("ko-KR")}건</b></li>`).join("") : `<li class="is-empty">이 날짜에 주소가 연결된 주문이 없습니다.</li>`;
    const message = summary.state === "error" ? "주문 일정 조회에 실패했습니다." : summary.state === "loading" || summary.state === "pending" ? "청소 주문 일정을 불러오는 중입니다." : "선택한 날짜의 청소 주문이 없습니다.";
    return `<section class="cleaning-schedule" aria-labelledby="cleaningScheduleTitle"><header class="cleaning-schedule-head"><div><span class="cleaning-center-eyebrow">CLEANING SCHEDULE</span><h3 id="cleaningScheduleTitle">일정·지도 관제</h3><p>청소 주문의 희망일을 달력과 현장 목록으로 확인합니다.</p></div><div class="cleaning-schedule-nav"><button type="button" class="secondary-button" data-cleaning-schedule-shift="-1" aria-label="이전 달">‹</button><strong>${escapeHtml(summary.monthLabel)}</strong><button type="button" class="secondary-button" data-cleaning-schedule-shift="1" aria-label="다음 달">›</button><button type="button" class="secondary-button" data-cleaning-schedule-today>오늘</button></div></header>${summary.days.length ? `<div class="cleaning-schedule-content"><div class="cleaning-schedule-calendar"><div class="cleaning-schedule-weekdays">${weekdays}</div><div class="cleaning-schedule-days">${days}</div><small class="cleaning-schedule-caption">이달 일정 ${summary.monthTotal}건${summary.undatedCount ? ` · 날짜 미정 ${summary.undatedCount}건` : ""}</small></div><section class="cleaning-schedule-day-detail"><header><div><h4>${escapeHtml(summary.selectedDate)}</h4><small>선택한 날짜 · ${summary.selectedDateTotal}건</small></div></header>${orders ? `<div class="cleaning-schedule-orders">${orders}</div>` : `<p class="cleaning-schedule-empty">${escapeHtml(message)}</p>`}</section><aside class="cleaning-schedule-regions"><h4>현장 지역</h4><p>선택 날짜 주문의 등록 주소 기준</p><ul>${regions}</ul><div><b>지도 표시 제한</b><span>주문에 지도 좌표가 저장되지 않아 주소에서 시·군·구까지만 집계합니다. 이동 경로와 실시간 위치는 표시하지 않습니다.</span></div></aside></div>` : `<p class="cleaning-schedule-empty" role="status">${escapeHtml(message)}</p>`}</section>`;
  }

  function statusLabel(status) {
    return orderStatuses.find(([value]) => value === String(status || ""))?.[1] || String(status || "");
  }

  function cleaningReportEditAccess(report, order) {
    const orderId = String(report && report.cleaningOrderId || "");
    if (!orderId) return { editable: true, reason: "" };
    if (!order || order.id !== orderId) {
      return { editable: false, reason: "연결된 청소 요청의 최신 상태를 확인할 수 없어 읽기 전용으로 열었습니다." };
    }
    if (["in_progress", "revision_requested"].includes(order.status)) return { editable: true, reason: "" };
    if (order.status === "review_pending") {
      return { editable: false, reason: "관리자 검수 대기 중입니다. 보고서 증거를 보존하기 위해 수정이 잠겨 있습니다. 보완 요청 후 작업을 재개하면 수정할 수 있습니다." };
    }
    if (order.status === "completed") {
      return { editable: false, reason: "완료 검수의 증거로 보관 중인 결과보고서입니다. 내용은 열람·출력할 수 있지만 수정할 수 없습니다." };
    }
    return { editable: false, reason: `연결된 청소 요청이 ${statusLabel(order.status) || "작업 중"} 상태라 결과보고서는 읽기 전용입니다.` };
  }

  function matchesOrderFilter(order, query, status, asOf) {
    const row = order && typeof order === "object" ? order : {};
    const normalize = value => String(value == null ? "" : value).trim().toLocaleLowerCase("ko-KR");
    const needle = normalize(query);
    const selectedStatus = String(status || "all");
    const selectedStatuses = selectedStatus.split(",").map(value => value.trim()).filter(Boolean);
    const searchable = [row.title, row.customerName, row.buildingName, row.description, row.searchText].map(normalize).join(" ");
    const label = orderStatuses.find(([value]) => value === selectedStatus)?.[1];
    const stage = orderQueueStages.find(item => item.status === selectedStatus);
    const statusMatches = Boolean(selectedStatus === "all"
      || (selectedStatus === "__overdue" && isOverdueOrder(row, String(asOf || "")))
      || (stage && stage.statuses.includes(String(row.status || "")))
      || selectedStatuses.includes(String(row.status || "")) || (label && row.statusLabel === label));
    return (!needle || searchable.includes(needle))
      && statusMatches;
  }

  function metricValue(metric) {
    if (!metric || metric.ready !== true) return "—";
    const value = Number(metric.value);
    return Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
  }

  function renderOrderAudit(order) {
    const history = Array.isArray(order.history) ? order.history.filter(entry => entry && typeof entry === "object") : [];
    if (!history.length) return "";
    const revision = Number(order.revision);
    const revisionLabel = Number.isSafeInteger(revision) && revision > 0 ? `${revision}차 수정` : "수정 버전 확인 필요";
    return `<details class="cleaning-order-audit" data-cleaning-order-detail="${escapeHtml(order.id)}">
      <summary>주문 변경 이력</summary>
      <div class="cleaning-order-audit-meta"><span>주문 ID <b>${escapeHtml(order.id)}</b></span><span>${escapeHtml(revisionLabel)}</span><span>접수 ${escapeHtml(order.createdAt || "기록 없음")}</span><span>최근 변경 ${escapeHtml(order.updatedAt || "기록 없음")}</span></div>
      <ol>${history.map(entry => `<li><time>${escapeHtml(entry.changedAt || "시각 미상")}</time><strong>${escapeHtml(statusLabel(entry.status) || "상태 확인 필요")}</strong><span>${escapeHtml(entry.note || "사유 기록 없음")}</span></li>`).join("")}</ol>
    </details>`;
  }

  function reviewChecklistGaps(input) {
    const order = input && typeof input === "object" ? input : {};
    if (order.reportsLoadError) return ["결과보고서를 불러오지 못했습니다. 자료를 새로고침한 뒤 확인해 주세요."];
    if (order.reportsLoadPending) return ["결과보고서를 불러오는 중입니다. 잠시 후 주문 상세를 다시 열어 주세요."];
    const reports = Array.isArray(order.relatedReports) ? order.relatedReports : [];
    if (!reports.length) return ["연결된 결과보고서가 없습니다."];
    const template = order.reportTemplate;
    if (!template || !template.kind || !Array.isArray(template.items)) return ["서비스 유형의 필수 체크리스트를 확인할 수 없습니다."];
    const matching = reports.filter(report => report && report.kind === template.kind && report.buildingId === order.buildingId);
    if (!matching.length) return ["같은 건물·서비스 유형의 결과보고서가 없습니다."];
    const latestWorkStart = Array.isArray(order.history)
      ? [...order.history].reverse().find(event => event && event.status === "in_progress")?.changedAt : "";
    const required = template.items.filter(item => item && !item.optional);
    const reportGaps = report => {
      const gaps = [];
      if (!latestWorkStart || !report.updatedAt || report.updatedAt < latestWorkStart) gaps.push("이번 작업 시작 이후 갱신된 결과보고서가 필요합니다.");
      const entries = Array.isArray(report.reviewItems) ? report.reviewItems
        : Array.isArray(report.checklistSummary?.items) ? report.checklistSummary.items : [];
      const byKey = new Map(entries.filter(item => item && item.key).map(item => [item.key, item]));
      for (const item of required) {
        if (!byKey.has(item.key)) gaps.push(`${item.label} 항목이 누락됐습니다.`);
      }
      let performed = false;
      for (const item of entries) {
        const label = String(item.label || template.items.find(row => row.key === item.key)?.label || item.key || "체크리스트");
        if (item.status === "skipped") {
          if (!String(item.note || "").trim()) gaps.push(`${label}: 미수행 사유를 기록해 주세요.`);
        } else if (item.status === "done" || item.status === "partial") {
          performed = true;
          if (item.status === "done") {
            if (!(Number(item.beforeCount) > 0)) gaps.push(`${label}: 작업 전 사진을 등록해 주세요.`);
            if (!(Number(item.afterCount) > 0)) gaps.push(`${label}: 작업 후 사진을 등록해 주세요.`);
          }
        } else gaps.push(`${label}: 수행 상태를 확인해 주세요.`);
      }
      if (!performed) gaps.push("적어도 한 항목의 수행 결과가 필요합니다.");
      return gaps;
    };
    return matching.map(reportGaps).sort((left, right) => left.length - right.length)[0];
  }

  function cleaningWorkOrderProgress(order) {
    const status = String(order?.status || "");
    const activeIndex = { assigned: 0, doing: 1, returned: 1, submitted: 2, done: 3 }[status];
    return {
      activeIndex: Number.isInteger(activeIndex) ? activeIndex : -1,
      returned: status === "returned",
      complete: status === "done",
      statusKnown: Number.isInteger(activeIndex),
    };
  }

  function renderCleaningWorkOrderProgress(order) {
    const progress = cleaningWorkOrderProgress(order);
    const stages = ["작업 지시", "현장 작업", "결과 제출", "관리자 확인"];
    const timeline = stages.map((label, index) => {
      const state = progress.complete || index < progress.activeIndex ? "complete" : index === progress.activeIndex ? "current" : "pending";
      const shownLabel = progress.returned && index === 1 ? "보완 요청" : label;
      return `<li class="cleaning-work-order-stage is-${state}" data-stage="${index}" data-stage-state="${state}"><span>${index + 1}</span><b>${shownLabel}</b></li>`;
    }).join("");
    const note = progress.returned
      ? `<p class="cleaning-work-order-progress-note" role="status">기존 CRM 작업지시가 보완 요청 상태입니다. 보완 내용과 재제출은 해당 작업지시에서 확인해 주세요.</p>`
      : !progress.statusKnown
        ? `<p class="cleaning-work-order-progress-note" role="status">작업지시 상태를 확인할 수 없습니다. 기존 CRM 업무에서 확인해 주세요.</p>`
        : "";
    return `<div class="cleaning-work-order-progress"><ol aria-label="작업 진행 단계">${timeline}</ol>${note}</div>`;
  }

  function renderCleaningPhotoGroup(photos, phase, count) {
    const rows = Array.isArray(photos) ? photos : [];
    const previews = rows.slice(0, 4).map((photo, index) => {
      const fileId = photo?.driveFileId || photo?.id || "";
      const label = photo?.caption || `${phase} 사진 ${index + 1}`;
      const preview = fileId
        ? `<span class="cleaning-photo-thumb is-loading" data-report-drive-thumbnail="${escapeHtml(fileId)}" aria-label="${escapeHtml(label)} 미리보기"><span aria-hidden="true">▧</span></span>`
        : `<span class="cleaning-photo-thumb is-unavailable" role="img" aria-label="${escapeHtml(label)} 미리보기 없음"><span aria-hidden="true">▧</span></span>`;
      return `<figure>${preview}<figcaption>${escapeHtml(label)}</figcaption></figure>`;
    }).join("");
    const total = Math.max(Number(count) || 0, rows.length);
    return `<div class="cleaning-photo-phase"><b>${phase} · ${escapeHtml(total)}장</b>${rows.length ? `<div class="cleaning-photo-grid">${previews}</div>${total > previews.length ? `<small>미리보기 ${previews.length}장 · 나머지 ${total - previews.length}장은 기존 결과보고서에서 확인</small>` : ""}` : `<small>등록된 사진이 없습니다.</small>`}</div>`;
  }

  function previewCleaningRefund(input) {
    const data = input || {};
    const paidAmount = Number.isSafeInteger(data.paidAmount) && data.paidAmount >= 0 ? data.paidAmount : 0;
    const remainingAmount = Number.isSafeInteger(data.remainingAmount) && data.remainingAmount >= 0 ? data.remainingAmount : 0;
    const enteredAmount = Number.isSafeInteger(Number(data.amount)) ? Number(data.amount) : 0;
    const refundAmount = data.type === "full" ? remainingAmount : enteredAmount;
    return { valid: refundAmount >= 0 && refundAmount <= remainingAmount && (data.type === "full" || refundAmount > 0),
      refundAmount, paidAfterRefund: paidAmount - refundAmount, remainingAfterRequest: remainingAmount - refundAmount };
  }

  function summarizeCleaningCti(input = {}) {
    const customers = (Array.isArray(input.customers) ? input.customers : []).filter(item => item && item.id && !item.archivedAt && item.deleted !== true);
    const customerById = new Map(customers.map(item => [String(item.id), item]));
    const phoneTypes = new Set(["전화", "전화 통화", "전화상담"]);
    const recentCalls = (Array.isArray(input.activities) ? input.activities : [])
      .filter(item => item && customerById.has(String(item.customerId || "")) && phoneTypes.has(String(item.type || "")))
      .map(activity => ({ activity, customer: customerById.get(String(activity.customerId)), activityId: String(activity.id || ""), occurredAt: String(activity.occurredAt || "") }))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 20);
    const nowTime = new Date(input.now || Date.now()).getTime();
    const callbacks = recentCalls.filter(item => item.activity.nextContactAt && Number.isFinite(new Date(item.activity.nextContactAt).getTime()) && new Date(item.activity.nextContactAt).getTime() >= nowTime)
      .map(item => ({ ...item, scheduledAt: String(item.activity.nextContactAt), summary: String(item.activity.summary || ""), nextAction: String(item.activity.nextAction || "") }))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const selectedCustomer = customers.find(item => String(item.id) === String(input.selectedCustomerId || "")) || callbacks[0]?.customer || customers.find(item => String(item.phone || "").replace(/\D/g, "").length >= 7) || customers[0] || null;
    const customerOrders = (Array.isArray(input.orders) ? input.orders : []).filter(item => item && selectedCustomer && String(item.customerId || "") === String(selectedCustomer.id));
    return Object.freeze({
      customers, recentCalls, callbacks, callbackCount: callbacks.length,
      liveConnection: "disconnected", liveQueueCount: null,
      selectedCustomer, customerOrders,
      selectedCustomerCalls: recentCalls.filter(item => selectedCustomer && String(item.customer.id) === String(selectedCustomer.id)),
      now: String(input.now || new Date().toISOString()), canWrite: input.canWrite === true,
    });
  }

  function cleaningCtiDateTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "일시 미확인";
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function renderCleaningCti(input = {}) {
    const summary = summarizeCleaningCti(input);
    const customer = summary.selectedCustomer;
    const phone = String(customer?.phone || "").trim();
    const phoneLink = phone.replace(/[^+\d]/g, "");
    const optionRows = summary.customers.map(item => `<option value="${escapeHtml(item.id)}"${customer && String(item.id) === String(customer.id) ? " selected" : ""}>${escapeHtml(item.name || item.company || item.id)}${item.phone ? ` · ${escapeHtml(item.phone)}` : " · 연락처 없음"}</option>`).join("");
    const callbacks = summary.callbacks.length ? `<ul>${summary.callbacks.slice(0, 8).map(item => `<li><button type="button" data-cleaning-cti-select-customer="${escapeHtml(item.customer.id)}"><b>${escapeHtml(item.customer.name || item.customer.id)}</b><span>${escapeHtml(cleaningCtiDateTime(item.scheduledAt))}</span><small>${escapeHtml(item.nextAction || item.summary || "후속 연락")}</small></button></li>`).join("")}</ul>` : `<p class="cleaning-cti-empty">CRM에 예정된 전화 후속 기록이 없습니다.</p>`;
    const callRows = summary.selectedCustomerCalls.length ? summary.selectedCustomerCalls.slice(0, 8).map(item => `<li><time>${escapeHtml(cleaningCtiDateTime(item.occurredAt))}</time><div><b>${escapeHtml(item.activity.summary || "전화 상담")}</b><small>${escapeHtml(item.activity.result || item.activity.nextAction || "상담 결과 미기록")}</small></div><span>${escapeHtml(item.activity.owner || "담당자 미기록")}</span></li>`).join("") : `<li class="cleaning-cti-empty">선택한 CRM 고객의 전화 활동 기록이 없습니다.</li>`;
    const linkedOrders = summary.customerOrders.length ? `<ul>${summary.customerOrders.slice(0, 5).map(order => `<li><button type="button" data-action="view-cleaning-order-details" data-order-id="${escapeHtml(order.id)}"><b>${escapeHtml(order.id || "주문 번호 미확인")}</b><span>${escapeHtml(order.title || "청소 요청")} · ${escapeHtml(order.statusLabel || order.status || "상태 미확인")}</span></button></li>`).join("")}</ul>` : `<p class="cleaning-cti-empty">이 고객에 연결된 청소 주문이 없습니다.</p>`;
    return `<section class="cleaning-cti" aria-labelledby="cleaningCtiTitle"><header class="cleaning-cti-head"><div><span class="cleaning-center-eyebrow">CUSTOMER TELEPHONE WORKSPACE</span><h2 id="cleaningCtiTitle">CTI 상담센터</h2><p>고객 전화 이력과 후속 상담을 기존 CRM 기록에 연결합니다.</p></div><span class="cleaning-cti-connection" role="status"><i></i>전화 연동 안 됨</span></header>
      <div class="cleaning-cti-notice"><b>실시간 CTI 연결이 없습니다.</b><span>수신 전화·대기열·통화 제어·녹취 정보는 가져오지 않습니다. 고객 전화는 기기에 등록된 전화 앱으로 직접 시작하고, 끝난 뒤 CRM 상담 활동으로 기록하세요.</span></div>
      <div class="cleaning-cti-metrics"><article><span>대기 전화</span><b>—</b><small>전화 시스템 자료 없음</small></article><article><span>부재중 전화</span><b>—</b><small>전화 시스템 자료 없음</small></article><article><span>콜백 예정</span><b>${summary.callbackCount.toLocaleString("ko-KR")}</b><small>CRM 전화 후속 기록</small></article><article><span>현재 전화</span><b>미연결</b><small>통화 상태 수집 안 함</small></article></div>
      <div class="cleaning-cti-layout"><section class="cleaning-cti-queue"><header><div><h3>콜백 예정</h3><small>CRM 상담 이력의 다음 연락일</small></div><b>${summary.callbackCount}건</b></header>${callbacks}<section class="cleaning-cti-queue-info"><h4>실시간 대기·부재 전화</h4><p>실시간 전화 대기열 자료가 연결되지 않았습니다. 전화 공급자 또는 CTI 장치가 연결되면 대기·부재중 내역을 표시합니다.</p></section></section>
      <section class="cleaning-cti-customer"><header><h3>고객 정보</h3><label>고객 선택<select data-cleaning-cti-customer${summary.customers.length ? "" : " disabled"}><option value="">CRM 고객 선택</option>${optionRows}</select></label></header>${customer ? `<div class="cleaning-cti-profile"><span class="cleaning-cti-avatar">${escapeHtml((customer.name || customer.company || "?").trim().slice(0, 1))}</span><div><h4>${escapeHtml(customer.name || customer.company || "이름 미입력")}</h4><p>${escapeHtml(phone || "연락처 미등록")}</p><small>${escapeHtml(customer.roadAddress || customer.address || customer.jibunAddress || "주소 미등록")}</small></div>${phoneLink.length >= 7 ? `<a class="primary-button" href="tel:${escapeHtml(phoneLink)}">전화 앱 열기</a>` : `<button type="button" class="secondary-button" disabled>연락처 없음</button>`}</div><div class="cleaning-cti-actions"><button type="button" class="secondary-button" data-action="new-consultation" data-customer-id="${escapeHtml(customer.id)}"${summary.canWrite ? "" : " disabled"}>상담 기록</button><button type="button" class="secondary-button" data-action="new-consultation-reservation" data-customer-id="${escapeHtml(customer.id)}"${summary.canWrite ? "" : " disabled"}>상담 예약</button><button type="button" class="secondary-button" data-cleaning-cti-message="${escapeHtml(customer.id)}">문자 작성</button><button type="button" class="secondary-button" data-cleaning-cti-customer-detail="${escapeHtml(customer.id)}">고객 상세</button><button type="button" class="secondary-button" data-view="quotes">견적서</button><button type="button" class="secondary-button" data-view="cleaningCenter">주문 생성</button></div><section class="cleaning-cti-subpanel"><header><h4>최근 통화 이력</h4><span>CRM 활동</span></header><ul>${callRows}</ul></section><section class="cleaning-cti-subpanel"><header><h4>연결된 청소 주문</h4><span>${summary.customerOrders.length}건</span></header>${linkedOrders}</section>` : `<p class="cleaning-cti-empty">조회 가능한 CRM 고객 기록이 없습니다.</p>`}</section>
      <aside class="cleaning-cti-control"><h3>상담 업무</h3><p>CRM 상담 이력과 후속 약속을 관리합니다.</p><div><b>전화 연결</b><span>사용 불가 · 외부 CTI 연동 필요</span></div><div><b>녹취</b><span>수집 안 함</span></div><div><b>CRM 연결</b><span>${customer ? escapeHtml(customer.name || customer.id) : "고객 선택 필요"}</span></div><button type="button" data-action="new-consultation" data-customer-id="${escapeHtml(customer?.id || "")}"${summary.canWrite && customer ? "" : " disabled"}>CRM 상담 이력 등록</button><small>이 화면에서 전화 수신·보류·전환·녹취는 작동하지 않습니다.</small></aside></div></section>`;
  }

  function renderCleaningRefundDialog(input) {
    const data = input || {};
    const payment = data.payment || {};
    const requests = Array.isArray(data.requests) ? data.requests : [];
    const remaining = Number.isSafeInteger(payment.remainingAmount) ? payment.remainingAmount : 0;
    const paid = Number.isSafeInteger(payment.paidAmount) ? payment.paidAmount : 0;
    const labels = { pending: "환불 요청 대기", approved: "승인 · PG 처리 대기", declined: "반려", processed: "처리 완료" };
    const history = requests.length ? requests.map(item => `<article><header><b>${escapeHtml(item.type === "full" ? "전액 환불" : "부분 환불")} · ${Number(item.amount).toLocaleString("ko-KR")}원</b><span class="cleaning-refund-status">${escapeHtml(labels[item.status] || "상태 확인 필요")}</span></header><p>${escapeHtml(item.reason)}${item.csReference ? ` · CS ${escapeHtml(item.csReference)}` : ""}</p><small>요청 ${escapeHtml(item.createdAt || "일시 미기록")} · 환불 후 잔액 ${Number(item.remainingPaidAmount).toLocaleString("ko-KR")}원</small>${item.events?.length ? `<ol>${item.events.map(event => `<li>${escapeHtml(event.occurredAt)} · ${escapeHtml(labels[event.type] || event.type)} · ${escapeHtml(event.note || "")}</li>`).join("")}</ol>` : ""}${data.canManage === true && item.status === "pending" ? `<form class="cleaning-refund-decision-form" data-refund-id="${escapeHtml(item.requestId)}" data-revision="${escapeHtml(item.revision)}"><label class="field"><span>검토 사유 *</span><textarea name="note" required minlength="1" maxlength="500"></textarea></label><button type="submit" name="decision" value="decline" class="secondary-button">환불 요청 반려</button><button type="submit" name="decision" value="approve" class="primary-button">환불 승인</button></form>` : ""}${data.canManage === true && item.status === "approved" ? `<form class="cleaning-refund-execution-form" data-refund-id="${escapeHtml(item.requestId)}" data-revision="${escapeHtml(item.revision)}"><p>PG에서 실제 환불을 처리한 뒤 거래번호와 증빙 위치를 기록하세요.</p><label class="field"><span>PG 환불 거래번호 *</span><input name="providerRef" maxlength="160" required></label><label class="field"><span>환불 증빙 위치 *</span><input name="evidenceRef" maxlength="500" required></label><button type="submit" class="primary-button">처리 증빙 저장</button></form>` : ""}</article>`).join("") : `<p class="cleaning-refund-empty">환불 요청 내역이 없습니다.</p>`;
    const paymentMethod = { card: "카드", bank_transfer: "계좌 이체", cash: "현금", other: "기타" }[payment.paymentMethod] || "결제 수단 미기록 · 담당자 확인 필요";
    return `<section class="cleaning-refund-dialog"><header class="modal-head"><div><span class="cleaning-center-eyebrow">PAYMENT · REFUND</span><h2>부분 환불 처리</h2></div><button class="close-button" data-action="close-modal" aria-label="닫기">×</button></header>
      <div class="modal-body cleaning-refund-panel" data-cleaning-refund-order="${escapeHtml(data.order?.id || "")}">
        <div class="cleaning-refund-warning"><b>부분 환불은 기존 결제 금액 안에서만 가능합니다.</b><span>환불 요청 후에도 주문은 기존 상태를 유지합니다. 승인 뒤 PG에서 별도 환불을 처리하고 증빙을 등록해야 완료됩니다.</span></div>
        <section class="cleaning-refund-order-summary"><div><small>주문번호</small><b>${escapeHtml(data.order?.id || "—")}</b></div><div><small>고객명</small><b>${escapeHtml(data.order?.customerName || "고객 연결 확인 필요")}</b></div><div class="is-emphasis"><small>결제 금액</small><b>${paid.toLocaleString("ko-KR")}원</b></div></section>
        ${data.canManage === true && remaining > 0 ? `<form id="cleaningRefundForm" data-paid-amount="${paid}" data-remaining-amount="${remaining}"><section class="cleaning-refund-input-grid"><div class="cleaning-refund-available"><span>환불 가능 금액</span><b>${remaining.toLocaleString("ko-KR")}원</b><small>승인된 입금액에서 진행 중인 환불 요청을 뺀 금액</small></div><fieldset class="cleaning-refund-type"><legend>환불 구분</legend><label><input type="radio" name="type" value="partial" checked> 부분 환불</label><label><input type="radio" name="type" value="full"> 전체 환불</label></fieldset><label class="field cleaning-refund-amount"><span>환불 금액 *</span><div><b>₩</b><input name="amount" type="number" min="1" max="${remaining}" step="1" required></div><small>최대 ${remaining.toLocaleString("ko-KR")}원까지 환불할 수 있습니다.</small></label><label class="field"><span>기존 결제 수단 *</span><select name="paymentMethod" required><option value="">결제 수단 확인 후 선택</option><option value="card">카드</option><option value="bank_transfer">계좌 이체</option><option value="cash">현금</option><option value="other">기타</option></select><small>CRM 입금 장부에는 결제 수단이 없어 담당자 확인이 필요합니다.</small></label><label class="field"><span>환불 사유 *</span><select name="reason" required><option value="">선택</option><option>고객 요청</option><option>서비스 일부 취소</option><option>중복 결제</option><option>서비스 미제공</option><option>기타</option></select></label><label class="field"><span>CS 접수번호</span><input name="csReference" maxlength="100"></label><label class="field wide"><span>CS 참고사항</span><textarea name="note" maxlength="200" placeholder="CS 참고 내용을 입력해 주세요."></textarea></label></section><section class="cleaning-refund-amount-preview" aria-live="polite"><div><span>환불 후 결제 금액</span><b data-refund-preview-paid>${paid.toLocaleString("ko-KR")}원</b><small data-refund-preview-note>환불 금액을 입력하면 계산합니다.</small></div><div><span>환불 요청 후 주문 상태</span><b class="cleaning-refund-status">${escapeHtml(data.order?.statusLabel || data.order?.status || "현재 상태 유지")}</b><small>부분 환불 요청·처리 후에도 주문 상태는 바뀌지 않습니다.</small></div></section><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">환불 요청 저장</button></div></form>` : `<p class="cleaning-refund-empty">${remaining > 0 ? "환불 요청을 등록할 권한이 없습니다." : "승인된 입금액에서 환불 가능한 잔액이 없습니다."}</p>`}
        <section class="cleaning-refund-history"><h3>환불 이력</h3>${history}</section>
        <section class="cleaning-refund-audit"><h3>변경 이력 (감사 로그)</h3>${requests.length ? `<ol>${requests.flatMap(item => (item.events || []).map(event => `<li><time>${escapeHtml(event.occurredAt || "일시 미기록")}</time><span>${escapeHtml(labels[event.type] || event.type || "변경 기록")}</span><small>${escapeHtml(event.note || "")}</small></li>`)).join("")}</ol>` : `<p>등록된 환불 변경 이력이 없습니다.</p>`}</section>
      </div></section>`;
  }

  function renderCleaningExtraChargeDialog(input) {
    const data = input || {};
    const order = data.order || {};
    const requests = Array.isArray(data.requests) ? data.requests : [];
    const labels = { draft: "승인 요청 작성", awaiting_customer_approval: "고객 승인 대기", approved: "고객 승인", declined: "고객 거절", accepted: "발송 접수", failed: "발송 실패", not_sent: "미발송" };
    const services = { balcony_cleaning: "베란다 청소", window_cleaning: "창틀 청소", aircon_disassembly: "에어컨 분해 청소", waste_disposal: "폐기물 처리", other: "기타" };
    return `<div class="modal-head"><div><span class="cleaning-center-eyebrow">CLEANING · EXTRA SERVICE</span><h2>추가금 승인 요청</h2><p>${escapeHtml(order.id || "주문 확인 필요")} · 고객의 사전 동의를 기록합니다.</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></div>
      <div class="modal-body cleaning-extra-charge-panel" data-cleaning-extra-charge-order="${escapeHtml(order.id || "")}">
        <div class="cleaning-extra-charge-warning"><b>고객의 사전 동의 없이 추가금이 수납되지 않습니다.</b><span>추가금은 고객 승인 전 결제·정산에 반영되지 않습니다. 메시지 발송 접수는 고객 승인으로 처리되지 않습니다.</span></div>
        <div class="cleaning-refund-summary"><div><small>주문번호</small><b>${escapeHtml(order.id || "—")}</b></div><div><small>고객</small><b>${escapeHtml(order.customerName || "고객")}</b></div><div><small>파트너</small><b>${escapeHtml(data.partner?.name || "확인 필요")}</b></div><div><small>현재 서비스</small><b>${escapeHtml(order.serviceLabel || order.serviceType || "확인 필요")}</b></div></div>
        ${data.canManage === true ? `<form id="cleaning-extra-charge-create-form" data-order-id="${escapeHtml(order.id || "")}" data-customer-id="${escapeHtml(data.customer?.id || "")}" data-building-id="${escapeHtml(order.buildingId || "")}" data-vendor-id="${escapeHtml(data.partner?.id || "")}"><h3>추가 서비스</h3><div class="form-grid"><label class="field"><span>추가 서비스 *</span><select name="serviceType" required><option value="">선택</option>${Object.entries(services).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label class="field"><span>추가 금액 (원) *</span><input name="amount" type="number" min="1" max="10000000" step="1" required></label><label class="field wide"><span>추가금 사유 *</span><textarea name="reason" maxlength="200" minlength="5" required></textarea></label><div class="field wide"><span>사진 증빙 · 최대 5장</span><div class="cleaning-extra-charge-evidence"><button type="button" class="secondary-button" data-action="pick-cleaning-extra-charge-evidence">사진 추가</button><span data-extra-charge-evidence-list>Drive 업로드 완료 후 증빙에 연결됩니다.</span></div><input type="hidden" name="evidenceFileIds" value=""></div></div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" name="intent" value="save" class="secondary-button">임시 저장</button><button type="submit" name="intent" value="send" class="primary-button">고객 승인 요청 발송</button></div></form>` : ""}
        <section class="cleaning-extra-charge-history"><h3>고객 승인 상태</h3>${requests.length ? requests.map(item => `<article data-status="${escapeHtml(item.status)}"><header><b>${escapeHtml(services[item.serviceType] || "추가 서비스")} · ${Number(item.amount || 0).toLocaleString("ko-KR")}원</b><span class="cleaning-refund-status">${escapeHtml(labels[item.status] || "상태 확인 필요")}</span></header><p>${escapeHtml(item.reason || "사유 없음")}</p><small>메시지 <span data-communication-status="${escapeHtml(item.communication?.status || "not_sent")}">${escapeHtml(labels[item.communication?.status] || "미발송")}</span> · 사진 증빙 ${Array.isArray(item.evidenceFileIds) ? item.evidenceFileIds.length : 0}장 · 버전 ${escapeHtml(item.revision)}</small>${(item.events || []).length ? `<ol>${item.events.map(event => `<li>${escapeHtml(event.occurredAt)} · ${escapeHtml(labels[event.type] || event.type)} · ${escapeHtml(event.note || "")}</li>`).join("")}</ol>` : ""}${data.canManage === true && item.status === "draft" ? `<form class="cleaning-extra-charge-send-form" data-request-id="${escapeHtml(item.requestId)}" data-revision="${escapeHtml(item.revision)}"><label class="field"><span>발송 채널 *</span><select name="channel" required><option value="sms">SMS</option><option value="kakao">카카오 알림톡</option></select></label><button type="submit" class="primary-button">고객 승인 요청 발송</button></form>` : ""}${data.canManage === true && item.status === "awaiting_customer_approval" ? `<form class="cleaning-extra-charge-decision-form" data-request-id="${escapeHtml(item.requestId)}" data-revision="${escapeHtml(item.revision)}"><label class="field"><span>고객 응답 증빙 *</span><input name="evidenceRef" maxlength="500" required placeholder="통화 기록 ID 또는 고객 회신 기록"></label><button type="submit" name="decision" value="decline" class="secondary-button">고객 거절 기록</button><button type="submit" name="decision" value="approve" class="primary-button">고객 승인 기록</button></form>` : ""}</article>`).join("") : `<p class="cleaning-refund-empty">등록된 추가금 요청이 없습니다.</p>`}</section>
      </div>`;
  }

  function renderCleaningReworkDialog(input) {
    const data = input || {};
    const order = data.order || {};
    const requests = Array.isArray(data.requests) ? data.requests : [];
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const statusLabels = { requested: "파트너 응답 대기", accepted: "파트너 수락", declined: "파트너 거절", in_progress: "재작업 중", awaiting_review: "검수 대기", completed: "재작업 완료" };
    const areaLabels = { window: "창틀", kitchen: "주방", bathroom: "화장실", floor: "바닥", other: "기타" };
    const history = requests.length ? requests.map(item => `<article class="cleaning-rework-request" data-status="${escapeHtml(item.status)}"><header><b>${escapeHtml(item.complaintTitle || "재작업 요청")}</b><span class="cleaning-rework-status">${escapeHtml(statusLabels[item.status] || "상태 확인 필요")}</span></header><p>${escapeHtml(item.complaintDetail || "요청 내용 없음")}</p><small>요청 부위 ${Array.isArray(item.areas) ? item.areas.map(area => areaLabels[area] || "기타").map(escapeHtml).join(" · ") : "확인 필요"} · 희망 ${escapeHtml(item.desiredAt || "일정 미정")}</small><p class="cleaning-rework-notice">${item.customerNotice?.requested ? `고객 안내: ${escapeHtml(item.customerNotice.status === "sent" ? "발송 확인" : "발송 확인 전 · CRM 메시지에서 발송 필요")}` : "고객 안내 요청 없음"}</p>${item.status === "awaiting_review" && data.canManage === true ? `<form class="cleaning-rework-complete-form" data-request-id="${escapeHtml(item.requestId)}" data-revision="${Number(item.revision) || 0}"><label class="field"><span>검수 결과보고서 *</span><select name="reportId" required><option value="">결과보고서를 선택하세요.</option>${reports.map(report => `<option value="${escapeHtml(report.id || "")}">${escapeHtml(report.title || report.id || "작업 결과보고서")} · ${escapeHtml(report.workDate || "날짜 미기록")}</option>`).join("")}</select></label><button type="submit" class="primary-button"${reports.length ? "" : " disabled"}>검수 완료</button></form>` : ""}<ol>${(item.events || []).map(event => `<li>${escapeHtml(event.occurredAt || "시각 미기록")} · ${escapeHtml(event.note || event.type || "변경 기록")}</li>`).join("")}</ol></article>`).join("") : `<p class="cleaning-rework-empty">등록된 재작업 요청이 없습니다.</p>`;
    return `<section class="cleaning-rework-modal"><header class="modal-head"><div><span class="cleaning-center-eyebrow">CLEANING · CUSTOMER REWORK</span><h2>재작업 요청</h2><p>완료된 원 주문의 결제·완료 상태를 유지한 채 후속 재작업을 관리합니다.</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></header><div class="modal-body cleaning-rework-panel" data-cleaning-rework-order="${escapeHtml(order.id || "")}"><aside class="cleaning-rework-warning"><b>원 주문과 결제 기록은 변경하지 않습니다.</b><span>재작업은 별도 이력으로 등록됩니다. 고객 안내는 기존 CRM 메시지 화면에서 확인해 실제 발송한 뒤에만 발송 완료로 표시됩니다.</span></aside><section class="cleaning-rework-order-summary"><div><small>주문번호</small><b>${escapeHtml(order.id || "—")}</b></div><div><small>고객</small><b>${escapeHtml(order.customerName || "고객 연결 확인 필요")}</b></div><div><small>파트너</small><b>${escapeHtml(data.partner?.name || "파트너 연결 확인 필요")}</b></div><div><small>원 주문 상태</small><b>${escapeHtml(order.statusLabel || "완료")}</b></div></section>${data.canManage === true && order.status === "completed" ? `<form id="cleaning-rework-create-form" data-order-id="${escapeHtml(order.id || "")}" data-customer-id="${escapeHtml(order.customerId || "")}" data-building-id="${escapeHtml(order.buildingId || "")}" data-vendor-id="${escapeHtml(data.partner?.id || "")}"><h3>요청 내용</h3><div class="form-grid"><label class="field"><span>요청 제목 *</span><input name="complaintTitle" maxlength="200" minlength="2" required></label><label class="field"><span>희망 완료 시각 *</span><input name="desiredAt" type="datetime-local" required></label><label class="field wide"><span>고객 요청 내용 *</span><textarea name="complaintDetail" maxlength="1000" minlength="2" required></textarea></label><fieldset class="cleaning-rework-areas"><legend>재작업 부위 *</legend>${Object.entries(areaLabels).map(([key, label]) => `<label><input type="checkbox" name="areas" value="${key}"><span>${label}</span></label>`).join("")}</fieldset><div class="field wide"><span>고객 첨부 사진 · 최대 8장</span><div class="cleaning-rework-evidence"><button type="button" class="secondary-button" data-action="pick-cleaning-rework-evidence">사진 추가</button><span data-rework-evidence-list>회사 Drive에 올린 파일만 증빙으로 연결됩니다.</span></div><input type="hidden" name="customerPhotoFileIds" value=""></div><label class="field wide"><span>파트너 전달 메모 *</span><textarea name="partnerNote" maxlength="500" minlength="2" required></textarea></label><label class="cleaning-rework-notify"><input type="checkbox" name="customerNoticeRequested"><span>고객 안내가 필요함 <small>체크하면 발송 대기만 기록합니다. 고객에게 발송하려면 등록 후 CRM 메시지 화면을 사용하세요.</small></span></label></div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">파트너 재작업 요청 등록</button></div></form>` : ""}<section class="cleaning-rework-history"><h3>재작업 이력</h3>${history}</section><div class="form-actions">${requests.some(item => item.customerNotice?.requested && item.customerNotice.status !== "sent") && order.canMessageCustomer === true ? `<button type="button" class="secondary-button" data-action="open-cleaning-order-message" data-order-id="${escapeHtml(order.id || "")}">기존 CRM 고객 메시지 열기</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">닫기</button></div></div></section>`;
  }

  function renderOrderDetails(input) {
    const order = input && typeof input === "object" ? input : {};
    const status = escapeHtml(order.statusLabel || statusLabel(order.status) || "상태 확인 필요");
    const serviceLabels = { move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소", stair_cleaning: "계단 청소", other: "기타 서비스" };
    const quoteStatus = { pending_review: "관리자 검토 대기", admin_approved: "관리자 승인", returned: "수정 요청" };
    const quote = order.quoteSummary;
    const workOrders = Array.isArray(order.relatedWorkOrders) ? order.relatedWorkOrders : [];
    const reports = Array.isArray(order.relatedReports) ? order.relatedReports : [];
    const reviewGaps = reviewChecklistGaps(order);
    const history = Array.isArray(order.history) ? order.history : [];
    const money = Number.isSafeInteger(Number(quote && quote.totalAmount)) ? `${Number(quote.totalAmount).toLocaleString("ko-KR")}원` : "금액 미확인";
    return `<div class="modal-head"><div><span class="cleaning-center-eyebrow">CLEANING ORDER · ${escapeHtml(order.id || "ID 미확인")}</span><h2>주문 상세</h2><p>${escapeHtml(order.title || "제목 미입력")} · ${status}</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></div>
      <div class="modal-body cleaning-order-detail" data-cleaning-order-detail="${escapeHtml(order.id)}">
        <section><h3>접수 정보</h3><dl><div><dt>고객</dt><dd>${escapeHtml(order.customerName || "연결 확인 필요")}</dd></div><div><dt>건물</dt><dd>${escapeHtml(order.buildingName || "연결 확인 필요")}</dd></div><div><dt>서비스</dt><dd>${escapeHtml(serviceLabels[order.serviceType] || order.serviceType || "유형 확인 필요")}</dd></div><div><dt>접수 내용</dt><dd>${escapeHtml(order.description || "내용 미입력")}</dd></div><div><dt>희망 일정</dt><dd>${escapeHtml(order.desiredDate || "일정 미정")}</dd></div><div><dt>주문 버전</dt><dd>${escapeHtml(order.revision || "확인 필요")}</dd></div><div><dt>접수·최근 변경</dt><dd>${escapeHtml(order.createdAt || "기록 없음")} · ${escapeHtml(order.updatedAt || "기록 없음")}</dd></div></dl></section>
        <section><h3>견적·승인</h3>${quote ? `<p>${escapeHtml(quote.latestRevision || "—")}차 견적 · ${escapeHtml(quoteStatus[quote.status] || "상태 확인 필요")} · <b>${money}</b></p>` : `<p>연결된 견적이 없거나 아직 불러오지 못했습니다.</p>`}</section>
        <section><h3>일정·배정</h3>${workOrders.length ? `<ul>${workOrders.map(item => `<li><b>${escapeHtml(item.title || "업무 제목 미입력")}</b><span>담당 ${escapeHtml(item.assigneeName || "미배정")} · 일정 ${escapeHtml(item.startDate || "시작일 미정")} ~ ${escapeHtml(item.dueDate || "기한 미정")} · ${escapeHtml(item.statusLabel || item.status || "상태 확인 필요")} · ${escapeHtml(Number(item.progress || 0))}%</span>${renderCleaningWorkOrderProgress(item)}<dl class="cleaning-work-order-criteria"><div><dt>작업 목적</dt><dd>${escapeHtml(item.why || "기록 없음")}</dd></div><div><dt>작업 내용</dt><dd>${escapeHtml(item.what || "기록 없음")}</dd></div><div><dt>완료 기준</dt><dd>${escapeHtml(item.doneWhen || "기록 없음")}</dd></div></dl><button type="button" class="text-button" data-action="open-cleaning-work-order" data-record-id="${escapeHtml(item.id)}">기존 CRM 업무 열기</button></li>`).join("")}</ul>` : `<p>연결된 작업지시가 없습니다.</p>`}</section>
        <section><h3>현장 결과·증빙</h3><div class="cleaning-review-check" role="status"><b>검수 준비 점검</b>${reviewGaps.length ? `<ul>${reviewGaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join("")}</ul>` : `<p>화면상 필수 항목이 등록됐습니다.</p>`}<small>최종 완료 여부는 서버가 같은 건물·서비스 유형, 이번 작업 회차, 사진 파일의 실제 연결을 다시 검증합니다. 사진 품질 자동 판정은 제공하지 않습니다.</small></div>${reports.length ? `<ul>${reports.map(item => { const checklist = item.checklistSummary; const checklistItems = Array.isArray(checklist && checklist.items) ? checklist.items : []; return `<li><b>${escapeHtml(item.title || "작업 결과보고서")}</b><span>${escapeHtml(item.workDate || "날짜 미정")} · 증빙 사진 ${escapeHtml(item.photoCount || 0)}장${checklist ? ` · 체크리스트 진척 ${escapeHtml(checklist.progress)}% (${escapeHtml(checklist.done)} 완료 · ${escapeHtml(checklist.partial)} 일부 · ${escapeHtml(checklist.skipped)} 미수행)` : " · 체크리스트 확인 필요"}</span>${checklistItems.length ? `<div class="cleaning-order-checklist"><b>진행 체크리스트</b>${checklistItems.map(entry => `<div><span>${escapeHtml(entry.label)} · ${escapeHtml(entry.statusLabel)}</span><small>작업 전 ${escapeHtml(entry.beforeCount)}장 · 작업 후 ${escapeHtml(entry.afterCount)}장${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</small>${entry.before?.length || entry.after?.length ? `<div class="cleaning-photo-review"><b>사진 검수 · ${escapeHtml(entry.label)}</b>${renderCleaningPhotoGroup(entry.before, "작업 전", entry.beforeCount)}${renderCleaningPhotoGroup(entry.after, "작업 후", entry.afterCount)}</div>` : ""}</div>`).join("")}</div>` : ""}<button type="button" class="text-button" data-action="open-cleaning-report" data-record-id="${escapeHtml(item.id)}">기존 CRM 결과보고 열기</button></li>`; }).join("")}</ul>` : `<p>연결된 결과보고서가 없습니다. 완료 전 결과와 증빙 검수가 필요합니다.</p>`}</section>
        <section><h3>상태 변경 이력</h3>${history.length ? `<ol>${history.map(entry => `<li><time>${escapeHtml(entry.changedAt || "시각 미상")}</time><b>${escapeHtml(statusLabel(entry.status) || "상태 확인 필요")}</b><span>${escapeHtml(entry.note || "사유 기록 없음")}</span></li>`).join("")}</ol>` : `<p>등록된 변경 이력이 없습니다.</p>`}</section>
        <div class="form-actions">${order.canMessageCustomer === true && order.customerId ? `<button type="button" class="secondary-button" data-action="open-cleaning-order-message" data-order-id="${escapeHtml(order.id)}">고객 메시지 작성</button>` : ""}${order.canManageExtraCharge === true ? `<button type="button" class="secondary-button" data-action="manage-cleaning-extra-charge" data-order-id="${escapeHtml(order.id)}">추가금 승인 요청</button>` : ""}${order.canManageRefund === true ? `<button type="button" class="secondary-button" data-action="manage-cleaning-refund" data-order-id="${escapeHtml(order.id)}">부분 환불 처리</button>` : ""}${order.canManageRework === true && order.status === "completed" ? `<button type="button" class="secondary-button" data-action="manage-cleaning-rework" data-order-id="${escapeHtml(order.id)}">재작업 요청</button>` : ""}${order.canCancelCleaningOrder === true && ["received", "reviewing", "quote_pending", "approval_pending", "scheduled"].includes(order.status) ? `<button type="button" class="danger-outline-button" data-action="cancel-cleaning-order" data-order-id="${escapeHtml(order.id)}">주문 취소</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">닫기</button></div>
      </div>`;
  }

  function renderCancellationConfirmation(input) {
    const order = input && typeof input === "object" ? input : {};
    return `<div class="modal-head"><div><span class="cleaning-center-eyebrow">ORDER · CANCELLATION</span><h2>주문 취소</h2><p>취소 사유와 환불 후속 처리를 기록합니다.</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></div>
      <form id="cleaningOrderCancellationForm" class="modal-body cleaning-cancellation-dialog" data-order-id="${escapeHtml(order.orderId)}" data-next-status="cancelled" data-expected-revision="${escapeHtml(order.expectedRevision)}" data-request-id="${escapeHtml(order.requestId)}">
        <div class="cleaning-cancellation-warning" role="note"><b>주문 취소 시 상태가 종료됩니다.</b><span>결제된 금액은 선택한 후속 처리에 따라 별도 환불 절차가 필요합니다. 이 화면에서는 환불이나 고객 메시지를 자동 실행하지 않습니다.</span></div>
        <section class="cleaning-cancellation-order"><div><span>주문번호</span><b>${escapeHtml(order.orderId || "확인 필요")}</b></div><div><span>고객명</span><b>${escapeHtml(order.customerName || "고객 연결 확인 필요")}</b></div><div><span>서비스</span><b>${escapeHtml(order.orderTitle || "청소 요청")}</b></div><div><span>주소</span><b>${escapeHtml(order.buildingName || "건물 연결 확인 필요")}</b></div><div><span>주문 상태</span><b>${escapeHtml(order.statusLabel || "상태 확인 필요")}</b></div></section>
        <label class="form-field wide"><span>취소 사유 <b aria-hidden="true">*</b></span><select name="reason" required><option value="">취소 사유를 선택하세요.</option><option value="customer_schedule">고객 일정 변경</option><option value="customer_request">고객 변심·요청</option><option value="partner_unavailable">파트너 배정 불가</option><option value="duplicate_order">중복 주문</option><option value="other">기타</option></select></label>
        <fieldset class="cleaning-cancellation-refund"><legend>환불 처리 후속 계획 <b aria-hidden="true">*</b></legend><label><input type="radio" name="refundTreatment" value="full" required><span>전액 환불</span></label><label><input type="radio" name="refundTreatment" value="partial"><span>부분 환불 검토</span></label><label><input type="radio" name="refundTreatment" value="none"><span>환불 없음</span></label><small>선택 내용은 취소 이력에 남깁니다. 실제 환불은 청구 장부와 기존 환불 절차에서 별도로 처리해야 합니다.</small></fieldset>
        <label class="form-field wide"><span>취소 메모</span><textarea name="note" rows="3" maxlength="400" placeholder="취소 사유의 추가 내용을 입력하세요. (선택사항)"></textarea><small>최대 400자</small></label>
        <label class="cleaning-cancellation-notify"><input type="checkbox" name="notifyCustomer"><span><b>고객에게 취소 안내 필요</b><small>안내 필요 여부만 이력에 저장됩니다. 안내 메시지는 자동 발송되지 않으며, 기존 CRM 메시지 화면에서 검토 후 별도로 발송하세요.</small></span></label>
        <div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">돌아가기</button><button type="submit" class="danger-button">주문 취소 기록</button></div>
      </form>`;
  }

  function renderTransitionConfirmation(input) {
    const data = input || {};
    return `<div class="modal-head"><div><span class="cleaning-center-eyebrow">ORDER STATUS</span><h2>청소 요청 단계 변경</h2><p>${escapeHtml(data.orderTitle || "청소 요청")}</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></div>
      <form id="cleaningOrderTransitionForm" class="modal-body" data-order-id="${escapeHtml(data.orderId)}" data-next-status="${escapeHtml(data.nextStatus)}" data-expected-revision="${escapeHtml(data.expectedRevision)}" data-request-id="${escapeHtml(data.requestId)}">
        <div class="cleaning-transition-summary"><span>${escapeHtml(data.currentStatus || "현재 상태")}</span><b aria-hidden="true">→</b><strong>${escapeHtml(data.nextStatusLabel || data.nextStatus || "다음 단계")}</strong></div>
        <label class="form-field wide"><span>진행·확인 사유 <b aria-hidden="true">*</b></span><textarea name="note" rows="4" maxlength="500" required placeholder="무엇을 확인하거나 진행했는지 간단히 기록해 주세요."></textarea><small>공유 업무 이력에 남습니다 · 최대 500자</small></label>
        <div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">변경 확인</button></div>
      </form>`;
  }

  function renderCleaningDelayDialog(input) {
    const data = input || {};
    const order = data.order || {};
    const partner = data.partner || {};
    const dispatch = data.dispatch || {};
    const events = Array.isArray(dispatch.events) ? dispatch.events : [];
    const incidents = Array.isArray(data.incidents) ? data.incidents : [];
    const active = data.activeIncident || null;
    const issueLabels = { departure_delay: "출발 지연", on_site_missing: "현장 미도착", no_show_suspected: "노쇼 의심" };
    const actionLabels = { partner_contact_logged: "파트너 전화 확인", customer_notice_logged: "고객 안내", replacement_search_logged: "대체 파트너 검색", emergency_reassignment_requested: "긴급 재배정 요청" };
    const progressLabels = { accepted: "수락 확인", departed: "출발 확인", arrived: "도착 확인", started: "작업 시작 확인", photos_submitted: "사진 제출 확인" };
    const offer = (dispatch.offers || []).find(item => item.id === dispatch.acceptedOfferId && item.status === "accepted");
    const incidentEvents = events.filter(item => item.type === "incident_reported" || item.type === "incident_action_logged")
      .slice().sort((a, b) => String(a.occurredAt || "").localeCompare(String(b.occurredAt || "")));
    const history = incidentEvents.length ? `<ol>${incidentEvents.map(item => {
      const title = item.type === "incident_reported" ? issueLabels[item.issueType] || "상황 기록" : actionLabels[item.action] || "운영 조치";
      const detail = item.type === "incident_reported"
        ? `예정 ${item.scheduledAt ? escapeHtml(item.scheduledAt) : "시각 미기록"} · 지연 ${Number(item.delayMinutes || 0)}분`
        : escapeHtml(item.note || "담당자가 조치 기록");
      return `<li><time>${escapeHtml(item.occurredAt || "기록 시각 미기록")}</time><b>${escapeHtml(title)}</b><span>${detail}</span></li>`;
    }).join("")}</ol>` : `<p>아직 지연·노쇼 처리 이력이 없습니다.</p>`;
    const canManage = data.canManage !== false;
    const activeActions = Object.entries(actionLabels).filter(([key]) => key !== "emergency_reassignment_requested").map(([key, label]) => `<button type="button" class="cleaning-delay-action-card" data-action="record-cleaning-delay-action" data-order-id="${escapeHtml(order.id || "")}" data-incident-id="${escapeHtml(active?.incidentId || "")}" data-revision="${Number(dispatch.revision || 0)}" data-delay-action="${key}"${!canManage || !active ? " disabled" : ""}><b>${escapeHtml(label)}</b><small>실행한 뒤 기록</small></button>`).join("");
    const localScheduled = active?.scheduledAt && Number.isFinite(Date.parse(active.scheduledAt)) ? new Date(active.scheduledAt).toISOString().slice(0, 16) : "";
    return `<section class="cleaning-delay-modal"><header class="modal-head"><div><span class="cleaning-center-eyebrow">DISPATCH · INCIDENT RESPONSE</span><h2>지연·노쇼 대응</h2><p>예정 시간 대비 지연 또는 미도착 상황을 확인하고 대응을 기록합니다.</p></div><button class="close-button" data-action="close-modal" aria-label="닫기">×</button></header>
      <div class="modal-body"><section class="cleaning-delay-context" aria-label="주문 및 지연 현황">
        <div><small>주문번호</small><b>${escapeHtml(order.id || "주문번호 미기록")}</b></div><div><small>파트너</small><b>${escapeHtml(partner.name || "배정 파트너 미기록")}</b><span>${escapeHtml(partner.id || "파트너 ID 미기록")}</span></div><div><small>예정 도착 시각</small><b>${escapeHtml(active?.scheduledAt || "예정 시각 미기록")}</b></div><div><small>현재 시각</small><b>${escapeHtml(data.currentTime || "확인 시각 미기록")}</b></div>
        <div><small>현재 상태</small><b>${escapeHtml(progressLabels[offer?.progress] || "파트너 진행 상태 미기록")}</b></div><div><small>지연 시간</small><b class="is-delay">${active ? `${Number(active.delayMinutes || 0)}분` : "기록 전"}</b></div><div><small>고객</small><b>${escapeHtml(order.customerName || "고객 연결 확인 필요")}</b></div><div><small>서비스 지역</small><b>${escapeHtml(order.region || "지역 정보 확인 필요")}</b></div>
        <p>위치 확인 불가 · 실시간 GPS 자료가 연결되지 않았습니다.</p>
      </section>
      <section class="cleaning-delay-situations"><h3>1. 상황 선택 <span>*</span></h3><form id="cleaningDelayIncidentForm" data-order-id="${escapeHtml(order.id || "")}" data-revision="${Number(dispatch.revision || 0)}"><div class="cleaning-delay-situation-grid">${Object.entries(issueLabels).map(([key, label]) => `<label class="cleaning-delay-situation"><input type="radio" name="issueType" value="${key}"${(active?.issueType || "departure_delay") === key ? " checked" : ""} required><span><b>${escapeHtml(label)}</b><small>${key === "departure_delay" ? "파트너 출발 또는 이동이 늦어졌습니다." : key === "on_site_missing" ? "예정 시각까지 현장 도착이 확인되지 않았습니다." : "연락 두절 등 미방문 가능성을 확인해야 합니다."}</small></span></label>`).join("")}</div>
        <div class="cleaning-delay-entry-grid"><label class="field"><span>예정 시각 *</span><input name="scheduledAt" type="datetime-local" value="${escapeHtml(localScheduled)}" required></label><label class="field"><span>확인된 지연 시간(분) *</span><input name="delayMinutes" type="number" min="0" max="1440" value="${active ? Number(active.delayMinutes || 0) : ""}" placeholder="담당자 확인 후 입력" required></label></div>
        <h3>2. 즉시 조치</h3><div class="cleaning-delay-action-grid cleaning-delay-actions">${activeActions}</div>${!active ? `<small class="cleaning-delay-action-hint">상황을 먼저 기록하면 실제 수행한 조치를 선택할 수 있습니다.</small>` : ""}
        <div class="cleaning-delay-response-grid"><label class="field"><span>3. 대응 메모</span><textarea name="note" maxlength="500" placeholder="확인한 사실과 조치 내용을 입력하세요.">${escapeHtml(active?.note || "")}</textarea></label><aside class="cleaning-delay-sla"><b>SLA 타이머</b><strong>운영 기준 미설정</strong><span>회사에서 승인한 응답 목표 시간을 등록하면 남은 시간을 표시합니다.</span><small>응답 목표 시각: 미설정</small></aside></div>
        <div class="cleaning-delay-footer"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${active ? "변경 기록 저장" : "기록 저장"}</button>${active ? `<button type="button" class="danger-button" data-action="record-cleaning-delay-action" data-order-id="${escapeHtml(order.id || "")}" data-incident-id="${escapeHtml(active.incidentId || "")}" data-revision="${Number(dispatch.revision || 0)}" data-delay-action="emergency_reassignment_requested">긴급 재배정 요청</button>` : ""}</div></form></section>
      <section class="cleaning-delay-history cleaning-delay-timeline"><h3>4. 처리 이력</h3>${history}</section>
      <p class="cleaning-delay-truth-note">파트너 연락, 고객 안내, 대체 파트너 검색은 담당자가 실제 실행한 경우에만 기록됩니다. 이 화면은 GPS 추적·전화·문자를 자동 실행하지 않습니다.</p></div></section>`;
  }

  function renderCleaningQuoteReview(input) {
    const data = input || {};
    const order = data.order || {};
    const quote = data.quote || {};
    const items = Array.isArray(quote.items) ? quote.items : [];
    const statusLabels = { pending_review: "관리자 검토 대기", admin_approved: "관리자 승인", returned: "수정 요청" };
    const reviewable = data.canReview === true && quote.status === "pending_review";
    return `<div class="modal-head"><div><span class="cleaning-center-eyebrow">CLEANING QUOTE · REVISION ${escapeHtml(quote.revision || "—")}</span><h2>견적 관리자 검수</h2><p>${escapeHtml(order.title || "청소 요청")} · ${escapeHtml(statusLabels[quote.status] || "상태 확인 필요")}</p></div><button type="button" class="close-button" data-action="close-modal" aria-label="닫기">×</button></div>
      <section class="modal-body cleaning-quote-review" data-order-id="${escapeHtml(order.id)}" data-quote-id="${escapeHtml(quote.id)}" data-expected-revision="${escapeHtml(quote.revision)}" data-request-id="${escapeHtml(data.requestId || "")}">
        <div class="cleaning-quote-review-total"><span>${escapeHtml(quote.projectName || "견적")}</span><strong>${Number.isSafeInteger(Number(quote.totalAmount)) ? Number(quote.totalAmount).toLocaleString("ko-KR") : "—"}원</strong></div>
        <p>${escapeHtml(quote.summary || "요약 미입력")}</p>
        <div class="cleaning-quote-review-items">${items.map(item => `<div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.detail || "")}</span><strong>${Number.isSafeInteger(Number(item.quantity)) && Number.isSafeInteger(Number(item.unitPrice)) ? (Number(item.quantity) * Number(item.unitPrice)).toLocaleString("ko-KR") : "—"}원</strong></div>`).join("")}</div>
        ${Array.isArray(quote.notes) && quote.notes.length ? `<ul>${quote.notes.map(note => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
        ${quote.reviewHistory?.length ? `<ol class="cleaning-quote-review-history">${quote.reviewHistory.map(event => `<li>${escapeHtml(event.action === "approve" ? "승인" : "반려")} · ${escapeHtml(event.changedAt || "시각 미상")} · ${escapeHtml(event.note || "사유 없음")}</li>`).join("")}</ol>` : ""}
        ${reviewable ? `<p class="cleaning-orders-permission">관리자 승인은 내부 검수만 완료합니다. 고객에게 자동 발송되지 않으며, 고객 수락·청구·입금 완료를 뜻하지 않습니다.</p><form id="cleaningQuoteReviewForm"><label class="form-field wide"><span>검수 메모 · 반려 시 필수</span><textarea name="note" maxlength="500" rows="3" placeholder="승인 또는 수정이 필요한 이유를 기록해 주세요."></textarea></label><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">닫기</button><button type="submit" class="secondary-button" name="decision" value="return">수정 요청</button><button type="submit" class="primary-button" name="decision" value="approve">견적 승인</button></div></form>` : `<p class="cleaning-orders-permission">${data.canReview ? "검수는 완료됐습니다. 이 승인은 고객 수락이나 청구·입금 완료를 뜻하지 않습니다." : "관리자 검토 대기 중입니다. 이 견적은 고객에게 자동 발송되지 않습니다."}</p><div class="form-actions">${data.canCreateRevision === true ? `<button type="button" class="secondary-button" data-action="new-cleaning-quote-revision">새 견적 버전 작성</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">닫기</button></div>`}
      </section>`;
  }

  function cleaningOrderErrorMessage(value) {
    const messages = {
      cleaning_order_auth_required: "로그인 상태를 확인한 뒤 다시 시도해 주세요.",
      cleaning_order_forbidden: "이 계정에는 주문을 확인하거나 변경할 권한이 없습니다.",
      cleaning_order_revision_conflict: "다른 사용자가 주문을 변경했습니다. 새로고침한 뒤 다시 확인해 주세요.",
      cleaning_order_transition_forbidden: "현재 단계에서 요청한 변경을 할 수 없습니다. 주문 상태를 새로고침해 주세요.",
      cleaning_order_assignment_required: "일정을 확정하기 전에 기존 작업지시에서 담당자와 기한을 지정하고 저장해 주세요.",
      cleaning_order_customer_building_mismatch: "선택한 고객과 건물의 연결을 확인해 주세요.",
      cleaning_order_customer_unavailable: "선택한 고객을 찾을 수 없거나 사용 중지되었습니다.",
      cleaning_order_building_unavailable: "선택한 건물을 찾을 수 없거나 사용 중지되었습니다.",
      cleaning_order_completion_evidence_required: "완료 전에 연결된 결과보고서 체크리스트를 확인하고, 완료 항목별 작업 전·후 Google Drive 사진 링크를 등록해 주세요.",
      invalid_cleaning_order_input: "입력한 주문 정보를 확인해 주세요.",
      cleaning_order_rate_limited: "요청이 잠시 많습니다. 조금 후 다시 시도해 주세요.",
      cleaning_order_body_too_large: "입력 내용이 너무 깁니다. 내용을 줄여 주세요.",
    };
    const message = String(value == null ? "" : value).trim();
    if (messages[message]) return messages[message];
    if (/^(cleaning_order_|invalid_cleaning_order_)/u.test(message)) {
      return "주문 정보를 불러오지 못했습니다. 새로고침 후에도 계속되면 관리자에게 알려 주세요.";
    }
    return message;
  }

  function summarizeCleaningSupport(input) {
    const data = input || {};
    if (data.casesError) return { state: "error", cases: [], total: 0, open: 0, urgent: 0 };
    if (data.casesLoaded !== true) return { state: "loading", cases: [], total: 0, open: 0, urgent: 0 };
    const cases = Array.isArray(data.cleaningCases) ? data.cleaningCases : [];
    const openCases = cases.filter(item => item.done !== true);
    return {
      state: cases.length ? "ready" : "empty",
      cases,
      total: cases.length,
      open: openCases.length,
      urgent: openCases.filter(item => String(item.urgency || "") === "긴급").length,
    };
  }

  function summarizeCleaningCustomer360(input) {
    const data = input || {};
    const customer = data.customer || {};
    const buildingIds = new Set((Array.isArray(data.buildingIds) ? data.buildingIds : []).map(String));
    const orders = (Array.isArray(data.orders) ? data.orders : []).filter(order =>
      order && ((customer.id && String(order.customerId || "") === String(customer.id)) || buildingIds.has(String(order.buildingId || "")))
    ).sort((left, right) => String(right.desiredDate || right.createdAt || "").localeCompare(String(left.desiredDate || left.createdAt || "")));
    const orderIds = new Set(orders.map(order => String(order.id || "")));
    const activities = (Array.isArray(data.activities) ? data.activities : [])
      .filter(activity => activity && ((customer.id && String(activity.customerId || "") === String(customer.id))
        || buildingIds.has(String(activity.buildingId || ""))))
      .slice().sort((left, right) => String(right.occurredAt || "").localeCompare(String(left.occurredAt || "")));
    const cases = (Array.isArray(data.cases) ? data.cases : [])
      .filter(item => item && ((customer.id && String(item.customerId || "") === String(customer.id))
        || buildingIds.has(String(item.buildingId || item.crmBuildingId || ""))));
    const paymentRows = (Array.isArray(data.paymentRows) ? data.paymentRows : [])
      .filter(item => item && orderIds.has(String(item.orderId || "")));
    const paymentAmount = paymentRows.filter(item => item.invoiceStatus === "확정")
      .reduce((sum, item) => {
        const value = Number(item.paidAmount);
        return Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(sum + value) ? sum + value : sum;
      }, 0);
    return {
      customerId: String(customer.id || ""),
      joinedAt: String(customer.createdAt || customer.joinedAt || customer.registeredAt || ""),
      orders,
      orderIds: [...orderIds],
      orderCount: orders.length,
      activities,
      cases,
      caseCount: cases.length,
      paymentRows,
      paymentAmount,
      scope: "loaded_crm_records",
    };
  }

  function summarizeCleaningPayments(input) {
    const data = input || {};
    if (data.billingError) return { state: "error", rows: [], orders: 0, linkedInvoices: 0, unlinked: 0, billed: 0, received: 0 };
    if (data.billingLoaded !== true) return { state: "loading", rows: [], orders: 0, linkedInvoices: 0, unlinked: 0, billed: 0, received: 0 };
    const rows = Array.isArray(data.cleaningPayments) ? data.cleaningPayments : [];
    const safeSum = values => values.reduce((sum, value) => {
      const next = sum + (Number.isSafeInteger(value) && value > 0 ? value : 0);
      return Number.isSafeInteger(next) ? next : sum;
    }, 0);
    const linked = rows.filter(item => Boolean(item.invoiceId));
    return {
      state: rows.length ? "ready" : "empty",
      rows,
      orders: rows.length,
      linkedInvoices: linked.length,
      unlinked: rows.length - linked.length,
      billed: safeSum(linked.filter(item => item.invoiceStatus === "확정").map(item => item.invoiceAmount)),
      received: safeSum(linked.map(item => item.paidAmount)),
      unpaid: safeSum(linked.filter(item => item.invoiceStatus === "확정").map(item => Math.max(0, Number(item.invoiceAmount || 0) - Number(item.paidAmount || 0)))),
    };
  }

  function buildCleaningPayments(input) {
    const data = input || {};
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const contracts = Array.isArray(data.contracts) ? data.contracts : [];
    const ledger = data.ledger && Array.isArray(data.ledger.invoices) && Array.isArray(data.ledger.receipts) ? data.ledger : null;
    return orders.flatMap(order => {
      const eligible = contracts.filter(contract => contract && contract.cleaningEligible === true
        && String(contract.buildingId || "") === String(order.buildingId || "") && contract.billingCycle === "건별");
      const linked = ledger ? ledger.invoices.filter(invoice => invoice.occurrenceId === String(order.id || "")
        && eligible.some(contract => String(contract.id || "") === String(invoice.contractId || ""))) : [];
      if (linked.length) return linked.map(invoice => {
        const receipts = ledger.receipts.filter(receipt => receipt.invoiceId === invoice.id);
        let paymentState = "장부 확인 필요";
        try { paymentState = typeof data.invoicePaymentState === "function" ? data.invoicePaymentState(invoice, receipts) : paymentState; } catch (_) {}
        const contract = eligible.find(item => String(item.id || "") === String(invoice.contractId || ""));
        const paidAmount = receipts.filter(receipt => receipt.status === "approved" && Number.isSafeInteger(receipt.amount) && receipt.amount > 0)
          .reduce((sum, receipt) => Number.isSafeInteger(sum + receipt.amount) ? sum + receipt.amount : sum, 0);
        return { orderId: order.id, orderTitle: order.title, buildingName: order.buildingName, desiredDate: order.desiredDate,
          invoiceId: invoice.id, invoiceAmount: Number.isSafeInteger(invoice.amount) ? invoice.amount : 0,
          invoiceStatus: invoice.status === "approved" ? "확정" : invoice.status === "draft" ? "초안" : "무효",
          paymentState, paidAmount, contractId: contract?.id || "", canCreateInvoice: false };
      });
      const quoteApproved = order.quoteSummary?.status === "admin_approved" && Number.isSafeInteger(order.quoteSummary.totalAmount) && order.quoteSummary.totalAmount > 0;
      return [{ orderId: order.id, orderTitle: order.title, buildingName: order.buildingName, desiredDate: order.desiredDate,
        invoiceId: "", invoiceAmount: 0, invoiceStatus: "", paymentState: "청구 장부에 연결된 기록 없음", paidAmount: 0,
        contractId: eligible.length === 1 ? eligible[0].id : "", canCreateInvoice: eligible.length === 1 && quoteApproved }];
    });
  }

  function summarizeCleaningAnalytics(input) {
    const data = input || {};
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const payments = summarizeCleaningPayments(data);
    const hasValidDate = /^\d{4}-\d{2}-\d{2}$/u.test(String(data.asOf || ""));
    const byStatus = Object.fromEntries(orderStatuses.map(([status]) => [status, 0]));
    const serviceCounts = new Map();
    const regionCounts = new Map();
    const monthCounts = new Map();
    if (data.ordersLoaded === true && !data.ordersLoading && !data.ordersError) {
      for (const order of orders) {
        const status = String(order?.status || "");
        if (Object.prototype.hasOwnProperty.call(byStatus, status)) byStatus[status] += 1;
        if (order?.serviceType) serviceCounts.set(order.serviceType, (serviceCounts.get(order.serviceType) || 0) + 1);
        if (order?.buildingAddress || order?.buildingName) {
          const region = regionLabel(order.buildingAddress);
          regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
        }
      }
    }
    let months = [];
    let daily = [];
    if (hasValidDate && data.ordersLoaded === true && !data.ordersLoading && !data.ordersError) {
      const asOfMonth = String(data.asOf).slice(0, 7);
      const [year, month] = asOfMonth.split("-").map(Number);
      months = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 1 - (5 - index), 1));
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        return { month: key, label: `${date.getUTCMonth() + 1}월`, count: 0 };
      });
      const inRange = new Set(months.map(item => item.month));
      for (const order of orders) {
        const dateKey = seoulDateKey(order?.createdAt);
        const monthKey = dateKey.slice(0, 7);
        if (inRange.has(monthKey)) monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
      }
      months = months.map(item => ({ ...item, count: monthCounts.get(item.month) || 0 }));
      daily = Array.from({ length: 7 }, (_, index) => {
        const date = shiftDateKey(String(data.asOf), index - 6);
        const ordersOnDate = orders.filter(order => seoulDateKey(order?.createdAt) === date).length;
        const reportsOnDate = orders.reduce((sum, order) => sum + (Array.isArray(order?.relatedReports)
          ? order.relatedReports.filter(report => seoulDateKey(report?.workDate) === date).length : 0), 0);
        return { date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, orders: ordersOnDate, reports: reportsOnDate };
      });
    }
    const services = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: serviceLabels[key] || "서비스 유형 확인 필요", count }));
    const regions = [...regionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
    const state = data.ordersError ? "error" : data.ordersLoading ? "loading" : data.ordersLoaded !== true ? "pending"
      : data.ordersHasMore ? "partial" : orders.length ? "ready" : "empty";
    const scopeLabel = data.ordersError ? "청소 주문 조회 실패"
      : data.ordersLoading || data.ordersLoaded !== true ? "청소 주문 자료를 불러오는 중입니다"
        : data.ordersHasMore ? `불러온 주문 ${orders.length}건 기준 · 전체 주문 중 일부`
          : `확인된 청소 주문 ${orders.length}건 기준`;
    const stages = [
      { key: "intake", label: "문의·접수", count: null },
      { key: "consultation", label: "상담", count: null },
      { key: "quote", label: "견적", count: byStatus.quote_pending + byStatus.approval_pending },
      { key: "order", label: "주문", count: orders.length },
      { key: "dispatch", label: "배차·일정", count: byStatus.scheduled + byStatus.in_progress + byStatus.review_pending + byStatus.revision_requested + byStatus.completed },
      { key: "completed", label: "완료", count: byStatus.completed },
    ];
    return { state, totalOrders: state === "ready" || state === "empty" || state === "partial" ? orders.length : 0,
      byStatus, stages, services, regions, months, daily, payments, scopeLabel,
      updatedAtLabel: Number.isFinite(Number(data.ordersUpdatedAt)) && Number(data.ordersUpdatedAt) > 0
        ? new Date(Number(data.ordersUpdatedAt)).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }) : "" };
  }

  function renderCleaningAnalytics(input) {
    const data = input || {};
    const summary = summarizeCleaningAnalytics(data);
    const fmt = value => Number(value || 0).toLocaleString("ko-KR");
    const krwText = value => `${fmt(value)}원`;
    const maxMonth = Math.max(1, ...summary.months.map(item => item.count));
    const monthMarkup = summary.months.length ? summary.months.map(item => `<div class="cleaning-analytics-month"><b>${fmt(item.count)}</b><div><i style="height:${(item.count / maxMonth * 100).toFixed(1)}%"></i></div><span>${escapeHtml(item.label)}</span></div>`).join("") : `<p class="cleaning-analytics-empty">주문 기간을 확인할 수 없습니다.</p>`;
    const breakdownMarkup = (items, empty) => items.length ? `<ol>${items.map(item => `<li><span>${escapeHtml(item.label || item.region)}</span><b>${fmt(item.count)}건</b></li>`).join("")}</ol>` : `<p class="cleaning-analytics-empty">${empty}</p>`;
    const dailyMax = Math.max(1, ...summary.daily.flatMap(item => [item.orders, item.reports]));
    const dailyMarkup = summary.daily.length ? `<div class="cleaning-analytics-daily-legend"><span>주문 접수</span><span>작업 결과보고서</span></div><div class="cleaning-analytics-daily">${summary.daily.map(item => `<div class="cleaning-analytics-day"><div class="cleaning-analytics-day-bars"><i title="주문 접수 ${fmt(item.orders)}건" style="height:${Math.max(item.orders ? 5 : 0, item.orders / dailyMax * 100).toFixed(1)}%"></i><i title="작업 결과보고서 ${fmt(item.reports)}건" style="height:${Math.max(item.reports ? 5 : 0, item.reports / dailyMax * 100).toFixed(1)}%"></i></div><span>${escapeHtml(item.label)}</span></div>`).join("")}</div>` : `<p class="cleaning-analytics-empty">일별 주문 수와 작업 결과 수를 계산할 날짜 자료가 없습니다.</p>`;
    const stageMarkup = summary.stages.map(item => `<li class="${item.count === null ? "is-unavailable" : ""}"><span>${escapeHtml(item.label)}</span><b>${item.count === null ? "자료 없음" : `${fmt(item.count)}건`}</b></li>`).join("");
    const billing = summary.payments;
    const billingBody = billing.state === "loading" ? `<p class="cleaning-analytics-state">청구 장부 자료를 불러오는 중입니다.</p>`
      : billing.state === "error" ? `<p class="cleaning-analytics-state is-error">청구 장부를 불러오지 못했습니다. <button type="button" class="text-button" data-action="refresh-cleaning-billing">장부 다시 불러오기</button></p>`
        : `<div class="cleaning-analytics-kpis"><article><span>연결 청구 기록</span><b>${fmt(billing.linkedInvoices)}건</b></article><article><span>확정 청구액</span><b>${krwText(billing.billed)}</b></article><article><span>확인 입금액</span><b>${krwText(billing.received)}</b></article><article><span>장부 미연결 기록</span><b>${fmt(billing.unlinked)}건</b></article></div><small class="cleaning-analytics-note">주문 ID와 건물·청소 건별 계약이 확인된 장부 기록만 집계합니다. 미연결 주문 금액은 추정하지 않습니다.</small>`;
    const orderState = ["pending", "loading"].includes(summary.state) ? `<p class="cleaning-analytics-state">청소 주문 자료를 불러오는 중입니다.</p>`
      : summary.state === "error" ? `<p class="cleaning-analytics-state is-error">청소 주문을 불러오지 못했습니다.</p>`
        : `<div class="cleaning-analytics-kpis cleaning-analytics-kpis-five"><article><span>청소 주문</span><b>${fmt(summary.totalOrders)}건</b></article><article><span>확정 청구액</span><b>${billing.state === "ready" || billing.state === "empty" ? krwText(billing.billed) : "자료 대기"}</b></article><article><span>확인 입금액</span><b>${billing.state === "ready" || billing.state === "empty" ? krwText(billing.received) : "자료 대기"}</b></article><article><span>미수 청구액</span><b>${billing.state === "ready" || billing.state === "empty" ? krwText(Math.max(0, billing.billed - billing.received)) : "자료 대기"}</b></article><article><span>공헌이익</span><b>자료 미연결</b></article></div>`;
    return `<section class="cleaning-analytics" aria-labelledby="cleaningAnalyticsTitle"><header class="cleaning-analytics-header"><div><span class="cleaning-center-eyebrow">CLEANING · ANALYTICS</span><h2 id="cleaningAnalyticsTitle">Analytics <small>/ 통계·리포트</small></h2><p>확인된 청소 주문·작업결과·청구 장부를 기준으로 운영 현황을 봅니다.</p></div><button type="button" class="secondary-button" data-view="cleaningCenter">클리닝센터로 돌아가기</button></header>${orderState}<p class="cleaning-analytics-scope"><b>불러온 주문 범위</b> · ${escapeHtml(summary.scopeLabel)}${summary.updatedAtLabel ? ` · 자료 갱신 ${escapeHtml(summary.updatedAtLabel)}` : ""}${data.ordersHasMore ? ` <button type="button" class="text-button" data-cleaning-analytics-load-more${data.ordersLoadingMore ? " disabled" : ""}>${data.ordersLoadingMore ? "이전 주문 불러오는 중…" : "이전 주문 더 불러오기"}</button>` : ""}</p>${data.ordersLoadMoreError ? `<p class="cleaning-analytics-state is-error">${escapeHtml(data.ordersLoadMoreError)}</p>` : ""}<div class="cleaning-analytics-main-grid"><section class="cleaning-analytics-panel"><header><h3>일별 주문 수와 작업 결과 수</h3><small>최근 7일 · 주문 생성일과 결과보고서 작업일</small></header><div class="cleaning-analytics-daily-wrap">${dailyMarkup}</div></section><section class="cleaning-analytics-panel"><header><h3>주문 이후 진행 현황</h3><small>현재 주문 상태 기준</small></header><ol class="cleaning-analytics-stages">${stageMarkup}</ol><small class="cleaning-analytics-note">문의부터 주문까지의 전환율 자료가 없습니다. 이 표는 전환 퍼널이 아니라 현재 주문 단계 수입니다.</small></section></div><div class="cleaning-analytics-columns"><section class="cleaning-analytics-panel"><header><h3>지역별 실적</h3><small>등록된 건물 주소 기준 주문 수</small></header>${breakdownMarkup(summary.regions, "지역 자료가 없습니다.")}</section><section class="cleaning-analytics-panel"><header><h3>서비스 유형별 주문</h3><small>불러온 청소 주문 기준</small></header>${breakdownMarkup(summary.services, "서비스 유형 자료가 없습니다.")}</section><section class="cleaning-analytics-panel"><header><h3>파트너 성과</h3><small>파트너 주문 연결·평가 자료</small></header><p class="cleaning-analytics-empty">파트너 평점·공급가 데이터 미연결. 파트너별 완료 건수와 품질 지표를 계산할 수 없습니다.</p></section></div><section class="cleaning-analytics-panel"><header><h3>청구·입금 집계</h3><small>청소 주문과 일회성 계약이 연결된 장부 기준</small></header>${billingBody}</section><p class="cleaning-analytics-note">고객 결제 총액·파트너 공급가·인건비·환불을 주문에 연결하는 자료가 부족해 GMV, 원가, 공헌이익은 계산하지 않습니다.</p></section>`;
  }

  function cleaningPartnerRows(input) {
    return (Array.isArray(input) ? input : []).filter(item => item && (item.cleaningProfile
      || String(item.industry || "").includes("청소") || String(item.service || item.category || "").includes("청소")));
  }

  function summarizeCleaningPartnerManagement(input) {
    const partners = cleaningPartnerRows(input);
    const profile = item => item.cleaningProfile && typeof item.cleaningProfile === "object" ? item.cleaningProfile : {};
    return {
      partners,
      total: partners.length,
      onboarded: partners.filter(item => profile(item).onboardingStatus === "approved").length,
      available: partners.filter(item => profile(item).availabilityStatus === "available").length,
      unknownAvailability: partners.filter(item => !["available", "unavailable"].includes(profile(item).availabilityStatus)).length,
      needsComplianceReview: partners.filter(item => profile(item).complianceStatus !== "verified").length,
    };
  }

  function matchesCleaningPartnerManagementFilter(item, input) {
    const filter = input || {};
    const profile = item && item.cleaningProfile && typeof item.cleaningProfile === "object" ? item.cleaningProfile : {};
    const serviceLabels = { move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소", stair_cleaning: "계단 청소", other: "기타 청소" };
    const services = Array.isArray(profile.serviceTypes) && profile.serviceTypes.length ? profile.serviceTypes : [String(item && (item.service || item.category) || "")];
    const serviceMatch = !filter.service || filter.service === "all" || services.some(value => value === filter.service || String(value).includes(serviceLabels[filter.service] || filter.service));
    const regions = Array.isArray(profile.serviceRegions) && profile.serviceRegions.length ? profile.serviceRegions : [String(item && item.region || "")];
    const regionMatch = !filter.region || regions.some(value => String(value || "").toLocaleLowerCase("ko-KR").includes(String(filter.region).trim().toLocaleLowerCase("ko-KR")));
    const query = String(filter.query || "").trim().toLocaleLowerCase("ko-KR");
    const queryFields = [item && (item.name || item.vendor), item && item.phone, item && item.alternatePhone, item && item.region,
      item && (item.service || item.category), ...services, ...regions, ...(Array.isArray(profile.serviceTypes) ? profile.serviceTypes.map(value => serviceLabels[value] || value) : [])];
    return serviceMatch && regionMatch && (!query || queryFields.some(value => String(value || "").toLocaleLowerCase("ko-KR").includes(query)));
  }

  function cleaningPartnerCandidateFromVendor(value, phone) {
    const item = value && typeof value === "object" ? value : {};
    const profile = item.cleaningProfile && typeof item.cleaningProfile === "object" ? item.cleaningProfile : {};
    const serviceLabels = { move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소", stair_cleaning: "계단 청소", other: "기타 청소" };
    const serviceText = Array.isArray(profile.serviceTypes) && profile.serviceTypes.length
      ? profile.serviceTypes.map(value => serviceLabels[value] || value).join(" · ")
      : [item.industry, item.service, item.category].filter(Boolean).map(String).join(" · ");
    return {
      id: String(item.id || ""),
      name: String(item.name || item.vendor || "").trim(),
      region: Array.isArray(profile.serviceRegions) && profile.serviceRegions.length ? profile.serviceRegions.join(" · ") : String(item.region || ""),
      serviceText,
      phone: String(phone || ""),
    };
  }

  function renderCleaningPartnerDispatch(input) {
    const order = input?.order && typeof input.order === "object" ? input.order : {};
    const dispatch = input?.dispatch && typeof input.dispatch === "object" ? input.dispatch : null;
    const vendors = Array.isArray(input?.vendors) ? input.vendors : [];
    const nameFor = id => vendors.find(item => String(item?.id || "") === String(id || ""))?.name || "파트너 정보 확인 필요";
    const labels = { offered: "응답 대기", accepted: "수락", declined: "업체 거절", expired: "응답 기한 만료", reassigned: "재배정됨" };
    const reasonLabels = { schedule_unavailable: "일정 불가", outside_service_area: "지역 외", staff_unavailable: "인원 부족", price_unavailable: "가격 조건", other: "기타" };
    const offers = Array.isArray(dispatch?.offers) ? dispatch.offers : [];
    const activeOffer = offers.find(item => item.status === "offered");
    const acceptedOffer = offers.find(item => item.id === dispatch?.acceptedOfferId && item.status === "accepted");
    const latestResolvedOffer = [...offers].reverse().find(item => ["declined", "expired"].includes(item.status));
    const resolvedVendor = latestResolvedOffer ? vendors.find(item => String(item.id) === String(latestResolvedOffer.vendorId)) : null;
    const resolvedPhone = String(resolvedVendor?.phone || "").replace(/[^0-9+]/gu, "");
    const canCallResolvedVendor = /^\+?[0-9]{8,15}$/u.test(resolvedPhone);
    const history = offers.length ? `<ol class="cleaning-partner-dispatch-history">${offers.map(offer => `<li class="is-${escapeHtml(offer.status)}"><div><b>${escapeHtml(nameFor(offer.vendorId))}</b><span>${escapeHtml(labels[offer.status] || "상태 확인 필요")}${offer.declineReason ? ` · ${escapeHtml(reasonLabels[offer.declineReason] || "거절 사유")}` : ""}</span></div><div><span>공급가 ${Number.isSafeInteger(offer.supplierAmount) ? `${offer.supplierAmount.toLocaleString("ko-KR")}원` : "확인 필요"}</span><time>${escapeHtml(offer.respondedAt || offer.expiresAt || offer.createdAt || "시간 확인 필요")}</time></div></li>`).join("")}</ol>` : `<p class="cleaning-partner-dispatch-empty">이 주문에 기록된 파트너 제안이 없습니다.</p>`;
    const incidentCount = (dispatch?.events || []).filter(event => event.type === "incident_reported").length;
    return `<section class="cleaning-partner-dispatch-modal"><header class="modal-head"><div><h2>파트너 배차 현황</h2><p>${escapeHtml(order.id || dispatch?.orderId || "주문 번호 확인 필요")} · ${escapeHtml(order.title || "청소 요청")}</p></div><button class="close-button" data-action="close-modal" aria-label="닫기">×</button></header><div class="modal-body"><div class="cleaning-partner-dispatch-order"><span>서비스 · ${escapeHtml(order.serviceLabel || order.serviceType || "확인 필요")}</span><span>희망일 · ${escapeHtml(order.desiredDate || "일정 미정")}</span><span>지역 · ${escapeHtml(order.region || "지역 정보 확인 필요")}</span></div>${activeOffer ? `<div class="cleaning-partner-dispatch-alert is-waiting"><b>파트너 응답을 기다리는 중입니다.</b><span>${escapeHtml(nameFor(activeOffer.vendorId))} · 응답 기한 ${escapeHtml(activeOffer.expiresAt)}</span></div>` : acceptedOffer ? `<div class="cleaning-partner-dispatch-alert is-accepted"><b>파트너가 작업을 수락했습니다.</b><span>${escapeHtml(nameFor(acceptedOffer.vendorId))} · ${escapeHtml(acceptedOffer.progress || "작업 단계 확인 필요")}</span></div>` : offers.length && offers.every(item => ["declined", "expired", "reassigned"].includes(item.status)) ? `<div class="cleaning-partner-dispatch-alert is-expired"><b>응답이 끝났습니다. 다음 파트너를 선택해 제안할 수 있습니다.</b><span>새 파트너 제안은 담당자가 직접 선택하고 공급가를 입력합니다.</span></div>` : ""}<h3>제안 및 처리 이력</h3>${history}${acceptedOffer ? `<section class="cleaning-delay-entry"><div><h3>지연·노쇼 대응</h3><p>도착 예정 시각과 지연 분은 담당자가 확인해 기록합니다. 자동 위치 추적이나 고객 알림은 실행하지 않습니다.</p></div><span>${incidentCount}건 기록</span><button type="button" class="primary-button" data-action="open-cleaning-delay-response" data-order-id="${escapeHtml(order.id || dispatch.orderId)}">지연·노쇼 기록</button></section>` : ""}<div class="form-actions">${acceptedOffer ? `<button type="button" class="secondary-button" data-action="reassign-cleaning-partner" data-order-id="${escapeHtml(order.id || dispatch.orderId)}">파트너 재배정</button>` : !activeOffer ? `${latestResolvedOffer ? `<button type="button" class="secondary-button" data-action="retry-cleaning-partner-offer" data-order-id="${escapeHtml(order.id || dispatch?.orderId || "")}" data-vendor-id="${escapeHtml(latestResolvedOffer.vendorId)}" data-supplier-amount="${Number.isSafeInteger(latestResolvedOffer.supplierAmount) ? latestResolvedOffer.supplierAmount : ""}">같은 업체에 재알림</button>${canCallResolvedVendor ? `<a class="secondary-button" href="tel:${escapeHtml(resolvedPhone)}">전화 확인</a>` : ""}` : ""}<button type="button" class="primary-button" data-action="start-cleaning-partner-offer" data-order-id="${escapeHtml(order.id || dispatch?.orderId || "")}" data-exclude-offers="${escapeHtml(offers.map(item => item.vendorId).join(","))}">${offers.length ? "다음 파트너에게 제안" : "파트너에게 제안"}</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">닫기</button></div><p class="cleaning-partner-dispatch-note">만료된 제안의 재알림은 새 응답 기한으로 다시 제안합니다. 전화는 담당자가 직접 시작합니다. 문자 자동 발송은 연결되어 있지 않습니다.</p></div></section>`;
  }

  function renderCleaningPartnerManagement(input, selectedVendorId = "") {
    const summary = summarizeCleaningPartnerManagement(input);
    const labels = {
      onboarding: { not_started: "미등록", in_progress: "등록 작성 중", submitted: "승인 대기", approved: "승인", changes_requested: "수정 필요" },
      availability: { unknown: "확인 필요", available: "작업 가능", unavailable: "작업 불가" },
      compliance: { not_reviewed: "미검토", pending: "확인 중", verified: "확인 완료", needs_review: "재확인 필요" },
      service: { move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소", stair_cleaning: "계단 청소", other: "기타 청소" },
    };
    const selectedId = String(selectedVendorId || summary.partners[0]?.id || "");
    const serviceText = item => {
      const profile = item.cleaningProfile && typeof item.cleaningProfile === "object" ? item.cleaningProfile : {};
      return Array.isArray(profile.serviceTypes) && profile.serviceTypes.length ? profile.serviceTypes.map(value => labels.service[value] || value).join(" · ") : String(item.service || item.category || "서비스 미등록");
    };
    const regionText = item => Array.isArray(item.cleaningProfile?.serviceRegions) && item.cleaningProfile.serviceRegions.length ? item.cleaningProfile.serviceRegions.join(" · ") : String(item.region || "활동 지역 미등록");
    const rows = summary.partners.map(item => {
      const profile = item.cleaningProfile && typeof item.cleaningProfile === "object" ? item.cleaningProfile : {};
      const name = String(item.name || item.vendor || "업체명 미입력");
      const id = escapeHtml(item.id || "");
      const selected = String(item.id || "") === selectedId;
      const identity = '<button type="button" class="cleaning-partner-management-identity" data-cleaning-partner-management-select="' + id + '" aria-pressed="' + selected + '"><span class="cleaning-partner-avatar" aria-hidden="true">' + escapeHtml(name.slice(0, 1) || "협") + '</span><span><b>' + escapeHtml(name) + '</b><small>' + (item.active === false ? "비활성" : "활동") + '</small></span></button>';
      const status = '<div class="cleaning-partner-profile-states"><span class="is-' + escapeHtml(profile.onboardingStatus || "not_started") + '">' + escapeHtml(labels.onboarding[profile.onboardingStatus] || labels.onboarding.not_started) + '</span><span class="is-' + escapeHtml(profile.availabilityStatus || "unknown") + '">' + escapeHtml(labels.availability[profile.availabilityStatus] || labels.availability.unknown) + '</span><span class="is-' + escapeHtml(profile.complianceStatus || "not_reviewed") + '">' + escapeHtml(labels.compliance[profile.complianceStatus] || labels.compliance.not_reviewed) + '</span></div>';
      const actions = '<div class="cleaning-partner-row-actions"><button type="button" class="text-button" data-partner-vendor-open="' + id + '">상세</button><button type="button" class="text-button" data-cleaning-partner-profile-edit="' + id + '">프로필</button><button type="button" class="text-button" data-cleaning-partner-account-bind="' + id + '">앱 계정</button></div>';
      return '<tr class="cleaning-partner-management-row' + (selected ? ' is-selected' : '') + '" data-cleaning-partner-management-row data-cleaning-partner-management-vendor-id="' + id + '" data-cleaning-partner-name="' + escapeHtml(name) + '" data-cleaning-partner-services="' + escapeHtml(serviceText(item)) + '" data-cleaning-partner-regions="' + escapeHtml(regionText(item)) + '"><td>' + identity + '</td><td>' + escapeHtml(regionText(item)) + '</td><td>' + escapeHtml(serviceText(item)) + '</td><td>' + status + '</td><td>' + actions + '</td></tr>';
    }).join("");
    const details = summary.partners.map(item => {
      const profile = item.cleaningProfile && typeof item.cleaningProfile === "object" ? item.cleaningProfile : {};
      const name = String(item.name || item.vendor || "업체명 미입력");
      const id = escapeHtml(item.id || "");
      const selected = String(item.id || "") === selectedId;
      const detail = (label, value) => '<div><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(value || "자료 미등록") + '</b></div>';
      const fields = detail("대표자", item.representativeName) + detail("사업자등록번호", item.businessRegistrationNumber || item.businessNo) + detail("연락처", item.phone || item.alternatePhone) + detail("이메일", item.email) + detail("활동 지역", regionText(item)) + detail("서비스", serviceText(item));
      const checks = '<div><span>온보딩 · ' + escapeHtml(labels.onboarding[profile.onboardingStatus] || labels.onboarding.not_started) + '</span><span>가용성 · ' + escapeHtml(labels.availability[profile.availabilityStatus] || labels.availability.unknown) + (profile.availabilityCheckedAt ? ' · ' + escapeHtml(profile.availabilityCheckedAt) : '') + '</span><span>서류 확인 · ' + escapeHtml(labels.compliance[profile.complianceStatus] || labels.compliance.not_reviewed) + (profile.complianceCheckedAt ? ' · ' + escapeHtml(profile.complianceCheckedAt) : '') + '</span></div>';
      return '<section class="cleaning-partner-management-details" data-cleaning-partner-management-details="' + id + '"' + (selected ? '' : ' hidden') + '><header><div><span class="cleaning-partner-avatar" aria-hidden="true">' + escapeHtml(name.slice(0, 1) || "협") + '</span><span><h3>' + escapeHtml(name) + '</h3><small>' + (item.active === false ? '비활성 업체' : '활동 업체') + '</small></span></div><button type="button" class="secondary-button" data-partner-vendor-open="' + id + '">전체 프로필</button></header><div class="cleaning-partner-detail-fields">' + fields + '</div><section class="cleaning-partner-detail-operations"><h4>운영 정보</h4>' + checks + '<p>팀·차량·장비 상세 자료 미등록</p><small>' + escapeHtml(profile.note || '업체 메모 미등록') + '</small></section><section class="cleaning-partner-detail-metrics"><h4>최근 3개월 실적</h4><div><article><span>평점</span><b>자료 미연결</b></article><article><span>완료율</span><b>자료 미연결</b></article><article><span>수락률</span><b>자료 미연결</b></article><article><span>재작업률</span><b>자료 미연결</b></article></div><small>CRM에 업체별 작업·리뷰 지표가 연결되기 전까지 수치를 표시하지 않습니다.</small></section></section>';
    }).join("");
    const partnerWorkspace = summary.partners.length
      ? '<div class="cleaning-partner-management-workspace"><div class="cleaning-partner-management-table-wrap"><header class="cleaning-partner-database-heading"><h3>파트너 데이터베이스</h3><span>총 ' + summary.total + '개 업체</span></header><table class="cleaning-partner-management-table"><thead><tr><th scope="col">업체명</th><th scope="col">활동 지역</th><th scope="col">서비스</th><th scope="col">운영 상태</th><th scope="col">관리</th></tr></thead><tbody>' + rows + '</tbody></table></div><aside class="cleaning-partner-management-aside" aria-label="선택한 파트너 상세">' + details + '</aside></div>'
      : '<p class="cleaning-partner-management-empty">등록된 청소 협력업체가 없습니다. 기존 협력업체 자료에서 청소 업종을 등록하세요.</p>';
    const categories = ["누수", "설비·배관", "전기·조명", "타일·방수", "도배·장판", "보일러·냉난방", "소방", "CCTV·보안", "방역", "폐기물", "기타"];
    const scopeOptions = '<option value="청소" selected>청소 협력업체</option><option value="전체 업종">전체 업체 보기</option>' + categories.map(value => '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>').join("");
    const serviceOptions = Object.entries(labels.service).map(([key, label]) => '<option value="' + escapeHtml(key) + '">' + escapeHtml(label) + '</option>').join("");
    const kpis = [["청소 업체", summary.total], ["온보딩 승인", summary.onboarded], ["작업 가능 확인", summary.available], ["가용성 확인 필요", summary.unknownAvailability], ["서류 재확인 대상", summary.needsComplianceReview]].map(([label, value]) => '<div><span>' + escapeHtml(label) + '</span><b>' + value + '개</b></div>').join("");
    return '<section class="cleaning-partner-management" aria-labelledby="cleaningPartnerManagementTitle"><header><div><span class="cleaning-center-eyebrow">CLEANING PARTNER NETWORK</span><h2 id="cleaningPartnerManagementTitle">파트너 관리</h2><p>기존 CRM 청소 업체의 등록 정보와 운영 확인 상태를 함께 관리합니다.</p></div><button type="button" class="primary-button" data-action="new-cleaning-partner">＋ 파트너 등록</button></header><div class="cleaning-partner-management-toolbar"><label><span>업체 범위</span><select data-partner-vendor-industry-filter>' + scopeOptions + '</select></label></div><div class="cleaning-partner-management-kpis">' + kpis + '</div><div class="cleaning-partner-management-filters"><label><span>서비스 유형</span><select data-cleaning-partner-management-filter="service"><option value="all">전체 서비스</option>' + serviceOptions + '</select></label><label><span>활동 지역</span><input type="search" data-cleaning-partner-management-filter="region" placeholder="시·군·구 검색"></label><label><span>업체 검색</span><input type="search" data-cleaning-partner-management-filter="query" placeholder="업체명·연락처·서비스"></label><small data-cleaning-partner-management-count>' + summary.total + '개 업체</small></div>' + partnerWorkspace + '<p class="cleaning-partner-management-note">가용성은 담당자가 마지막으로 확인한 상태이며 실시간 정보가 아닙니다. 서류 확인 상태는 CRM 담당자 입력값으로, 외부기관 검증을 뜻하지 않습니다.</p></section>';
  }

  function renderCleaningSettlementDialog(input = {}) {
    const review = input.review && typeof input.review === "object" ? input.review : null;
    const partners = Array.isArray(review?.partners) ? review.partners : [];
    const partner = partners.find(item => String(item.vendorId) === String(input.vendorId || "")) || partners[0] || null;
    if (!review || !partner) return `<section class="cleaning-settlement-dialog"><header class="modal-head"><div><span class="cleaning-center-eyebrow">PARTNER SETTLEMENT</span><h2>정산 확정·지급</h2></div><button class="close-button" data-action="close-modal" aria-label="닫기">×</button></header><div class="modal-body"><p class="cleaning-settlement-state">정산 자료를 확인할 수 없습니다. 주간 검토 자료를 새로고침해 주세요.</p><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">닫기</button></div></div></section>`;
    const money = value => Number.isSafeInteger(value) ? `${value.toLocaleString("ko-KR")}원` : "확인 필요";
    const workItems = Array.isArray(partner.workItems) ? partner.workItems : [];
    const checks = [
      ["작업 완료 확인", partner.checks?.workCompletion === "verified", partner.checks?.workCompletion === "verified" ? "완료 주문과 수락된 작업 기록 확인" : "완료 작업 검증 자료 확인 필요"],
      ["고객 검수 승인", partner.checks?.customerInspection === "verified", partner.checks?.customerInspection === "verified" ? "검수 승인이 확인되었습니다." : "검수 승인 확인 필요"],
      ["CS 보류 없음", partner.checks?.csHold === "verified", partner.checks?.csHold === "verified" ? "미해결 CS 보류가 없습니다." : "CS 보류 자료 확인 필요"],
      ["지급 계좌 확인", partner.checks?.payoutAccount === "verified", partner.checks?.payoutAccount === "verified" ? "지급 계좌 검증 완료" : "지급 계좌 확인 필요"],
      ["세금계산서 확인", partner.checks?.taxInvoice === "verified", partner.checks?.taxInvoice === "verified" ? "세금계산서 확인 완료" : "세금계산서 확인 필요"],
    ];
    return `<section class="cleaning-settlement-dialog"><header class="modal-head"><div><span class="cleaning-center-eyebrow">PARTNER SETTLEMENT · REVIEW</span><h2>정산 확정·지급</h2><p>아래 내용을 확인한 후 정산을 검토하세요.</p></div><button class="close-button" data-action="close-modal" aria-label="닫기">×</button></header><div class="modal-body"><section class="cleaning-settlement-dialog-partner"><div><small>파트너명</small><b>${escapeHtml(partner.vendorName || "파트너명 확인 필요")}</b><span class="cleaning-settlement-badge">정산 확인 필요</span></div><div><small>정산 주차</small><b>${escapeHtml(review.fromDate || "기간 확인 필요")} ~ ${escapeHtml(review.toDate || "기간 확인 필요")}</b><span>해당 기간의 완료 작업 정산 검토입니다.</span></div></section><section class="cleaning-settlement-dialog-totals"><article><span>완료 작업 수</span><b>${Number.isSafeInteger(partner.completedWorkCount) ? `${partner.completedWorkCount}건` : "확인 필요"}</b></article><article><span>공급가 합계</span><b>${money(partner.grossSupplierAmount)}</b></article><article><span>공제 합계</span><b>자료 연결 필요</b></article><article class="is-primary"><span>최종 지급액</span><b>최종 지급액 확인 불가</b></article></section><section class="cleaning-settlement-dialog-checks"><header><h3>지급 전 확인 항목</h3><span>필수 자료 확인 필요</span></header><div>${checks.map(([title, verified, detail]) => `<article class="${verified ? "is-verified" : "is-missing"}"><b>${verified ? "✓" : "!"} ${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></article>`).join("")}</div></section><section class="cleaning-settlement-dialog-payment"><h3>지급 정보</h3><div><span>지급 계좌</span><b>${partner.checks?.payoutAccount === "verified" && partner.payoutAccountLabel ? escapeHtml(partner.payoutAccountLabel) : "지급 계좌 확인 필요"}</b></div><div><span>지급 예정일</span><b>${escapeHtml(partner.scheduledPayoutDate || "지급 예정일 확인 필요")}</b></div></section><section class="cleaning-settlement-dialog-approval"><h3>승인 정보</h3><div><span>결재 승인자</span><b>${escapeHtml(partner.approverName || "승인자 정보 미연결")}</b></div><div><span>지급 참조번호</span><b>${escapeHtml(partner.payoutReference || "참조번호 미발급")}</b></div></section><section class="cleaning-settlement-dialog-work"><h3>완료 작업 내역 <span>${workItems.length}건</span></h3>${workItems.length ? `<div>${workItems.map(item => `<article><span>${escapeHtml(item.orderId || "주문 번호 확인 필요")} · ${escapeHtml(item.desiredDate || "일정 미기록")}</span><b>${money(item.supplierAmount)}</b></article>`).join("")}</div>` : `<p>표시할 완료 작업 내역이 없습니다.</p>`}</section><p class="cleaning-settlement-dialog-warning">검수·CS·계좌·세금 확인 자료가 연결되기 전에는 지급을 확정할 수 없습니다. 이 화면은 은행 송금을 실행하지 않습니다.</p><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">나중에 검토</button><button type="button" class="primary-button" disabled aria-disabled="true">정산 확정·지급</button></div></div></section>`;
  }

  function renderCleaningPayments(input) {
    const data = input || {};
    const summary = summarizeCleaningPayments(input);
    const money = value => `${Number(value || 0).toLocaleString("ko-KR")}원`;
    const rows = summary.rows.map(item => `<tr><td><b>${escapeHtml(item.orderId || "주문 번호 미기록")}</b><small>${escapeHtml(item.buildingName || "건물 확인 필요")} · ${escapeHtml(item.desiredDate || "일정 미정")}</small></td><td>${escapeHtml(item.orderTitle || "청소 주문")}</td><td>${item.invoiceId ? `<b>${money(item.invoiceAmount)}</b><small>${escapeHtml(item.invoiceStatus || "상태 확인 필요")}</small>` : `<span class="is-unavailable">미연결</span>`}</td><td>${item.invoiceId ? money(item.paidAmount) : `<span class="is-unavailable">미확인</span>`}</td><td><span class="cleaning-payment-state">${escapeHtml(item.paymentState || "상태 확인 필요")}</span></td><td><div class="cleaning-payment-row-actions"><button type="button" class="secondary-button" data-action="open-cleaning-billing" data-order-id="${escapeHtml(item.orderId)}"${item.contractId ? ` data-contract-id="${escapeHtml(item.contractId)}"` : ""}${!item.contractId || (!item.invoiceId && item.canCreateInvoice !== true) ? ` disabled title="${item.contractId ? "관리자 승인된 청소 견적이 확인된 뒤 청구 초안을 작성할 수 있습니다." : "같은 건물의 청소 건별 계약을 먼저 연결해야 합니다."}"` : ""}>${item.invoiceId ? "장부 열기" : "청구 작성"}</button><button type="button" class="text-button" data-action="view-cleaning-order-details" data-order-id="${escapeHtml(item.orderId)}">환불·주문 상세</button></div></td></tr>`).join("");
    const content = summary.state === "loading"
      ? `<p class="cleaning-payments-empty" role="status">청구 장부를 불러오는 중입니다.</p>`
      : summary.state === "error"
        ? `<p class="cleaning-payments-empty" role="status">청구 장부를 확인하지 못했습니다. <button type="button" class="text-button" data-action="refresh-cleaning-billing">다시 불러오기</button></p>`
        : summary.state === "empty"
          ? `<p class="cleaning-payments-empty">확인할 청소 주문이 없습니다.</p>`
          : "";
    const tabs = `<nav class="cleaning-payment-tabs" aria-label="결제 및 정산 구분"><a data-cleaning-payment-tab="customer" href="#cleaning-customer-payments">고객 결제</a><a data-cleaning-payment-tab="partner" href="#cleaning-partner-settlement">파트너 정산</a><a data-cleaning-payment-tab="refund" href="#cleaning-refund-management">환불</a><a data-cleaning-payment-tab="unpaid" href="#cleaning-unpaid-invoices">미수금</a></nav>`;
    const settlement = data.settlementReview && typeof data.settlementReview === "object" ? data.settlementReview : null;
    const settlementAmount = Number.isSafeInteger(settlement?.grossSupplierAmount) ? money(settlement.grossSupplierAmount) : data.settlementLoading ? "조회 중" : "집계 없음";
    const kpis = summary.state === "ready" ? `<div class="cleaning-payments-kpis"><article class="is-blue"><span>청구 확정액</span><b>${money(summary.billed)}</b><small>주문에 연결된 확정 CRM 청구</small></article><article class="is-green"><span>승인 입금액</span><b>${money(summary.received)}</b><small>승인 상태 CRM 입금만 합산</small></article><article class="is-amber"><span>완료 공급가</span><b>${settlementAmount}</b><small>수락된 작업의 주간 공급가</small></article><article class="is-purple"><span>확정 청구 미수금</span><b>${money(summary.unpaid)}</b><small>확정 청구액에서 승인 입금 차감</small></article></div>` : "";
    const settlementPartners = Array.isArray(settlement?.partners) ? settlement.partners : [];
    const selectedPartner = settlementPartners.find(item => item.vendorId === data.selectedSettlementVendorId) || settlementPartners[0];
    const settlementStatus = data.settlementError
      ? `<p class="cleaning-settlement-state is-error" role="alert">정산 자료를 확인하지 못했습니다. <button type="button" class="text-button" data-action="refresh-cleaning-settlement">다시 불러오기</button></p>`
      : data.settlementLoading
        ? `<p class="cleaning-settlement-state" role="status">완료 주문과 수락된 파트너 공급가를 확인하고 있습니다.</p>`
        : selectedPartner
          ? `<div class="cleaning-settlement-review-grid"><section class="cleaning-settlement-partners" aria-label="정산 대상 파트너">${settlementPartners.map(item => `<button type="button" class="cleaning-settlement-partner${item.vendorId === selectedPartner.vendorId ? " is-selected" : ""}" data-action="select-cleaning-settlement-partner" data-vendor-id="${escapeHtml(item.vendorId)}"><span><b>${escapeHtml(item.vendorName || "파트너명 확인 필요")}</b><small>완료 작업 ${Number.isSafeInteger(item.completedWorkCount) ? item.completedWorkCount : 0}건</small></span><strong>${Number.isSafeInteger(item.grossSupplierAmount) ? money(item.grossSupplierAmount) : "금액 확인 필요"}</strong></button>`).join("")}</section><section class="cleaning-settlement-detail"><header><div><h5>${escapeHtml(selectedPartner.vendorName || "파트너명 확인 필요")}</h5><span>${escapeHtml(settlement.fromDate || "")} ~ ${escapeHtml(settlement.toDate || "")}</span></div><span class="cleaning-settlement-badge">지급 확인 대기</span></header><div class="cleaning-settlement-summary"><article><span>완료 작업</span><b>${Number.isSafeInteger(selectedPartner.completedWorkCount) ? `${selectedPartner.completedWorkCount}건` : "확인 필요"}</b></article><article><span>완료 작업 정산 금액</span><b>${Number.isSafeInteger(selectedPartner.grossSupplierAmount) ? money(selectedPartner.grossSupplierAmount) : "확인 필요"}</b></article><article><span>공제 합계</span><b>자료 연결 필요</b></article><article class="is-primary"><span>최종 지급액</span><b>최종 지급액 확인 불가</b></article></div><h6>지급 전 확인 항목</h6><ul class="cleaning-settlement-checks"><li class="is-verified"><b>작업 완료 확인</b><span>완료 주문과 수락된 파트너 작업 기록 확인</span></li><li><b>검수 승인</b><span>검수 승인 연결 필요</span></li><li><b>CS 보류 없음</b><span>주문별 CS 보류 자료 연결 필요</span></li><li><b>지급 계좌 검증</b><span>지급 계좌 확인 필요</span></li><li><b>세금계산서 확인</b><span>세금계산서 원장 연결 필요</span></li></ul><div class="cleaning-settlement-work-items"><h6>완료 작업 내역</h6>${(Array.isArray(selectedPartner.workItems) ? selectedPartner.workItems : []).map(item => `<div><span>${escapeHtml(item.orderId)} · ${escapeHtml(item.desiredDate || "일정 미기록")}</span><b>${Number.isSafeInteger(item.supplierAmount) ? money(item.supplierAmount) : "금액 확인 필요"}</b></div>`).join("") || "<p>표시할 작업 내역이 없습니다.</p>"}</div><button type="button" class="secondary-button" data-action="open-cleaning-settlement-review">정산 검토 상세</button><p class="cleaning-settlement-warning">검수, CS, 계좌 및 세금 자료가 확인되기 전에는 지급을 확정할 수 없습니다. 이 화면은 은행 송금을 실행하지 않습니다.</p></section></div>`
          : settlement
            ? `<p class="cleaning-settlement-state">선택한 기간에 수락된 파트너의 완료 주문이 없습니다.${Number(settlement.excludedWorkCount) > 0 ? ` 자료 불일치 또는 파트너 기록 누락으로 ${Number(settlement.excludedWorkCount)}건은 정산 합계에서 제외했습니다.` : ""}</p>`
            : `<p class="cleaning-settlement-state">관리자 권한으로 로그인하면 주간 정산 검토 자료를 확인할 수 있습니다.</p>`;
    const workspaces = data.billingLoaded === true ? `<div class="cleaning-payment-workspaces"><section id="cleaning-customer-payments"><header><h4>주문별 결제 내역</h4><small>${summary.linkedInvoices}개 청구 연결 · ${summary.unlinked}개 미연결</small></header><div class="cleaning-payment-table-wrap">${rows ? `<table class="cleaning-payment-table"><thead><tr><th scope="col">주문번호 / 건물</th><th scope="col">서비스</th><th scope="col">청구 확정액</th><th scope="col">승인 입금액</th><th scope="col">결제 상태</th><th scope="col">관리</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="cleaning-payments-empty">확인할 청구 장부 연결 주문이 없습니다.</p>`}</div></section><section id="cleaning-partner-settlement" class="cleaning-settlement-unavailable"><header><h4>파트너 주간 정산 검토</h4><button type="button" class="secondary-button" data-action="refresh-cleaning-settlement">정산 새로고침</button></header><p class="cleaning-settlement-period">정산 주차 · ${escapeHtml(settlement?.fromDate || "확인 중")} ~ ${escapeHtml(settlement?.toDate || "확인 중")}</p>${settlementStatus}<small>표시 금액은 완료된 CRM 청소 주문의 수락 공급가 합계이며, 최종 지급액이나 은행 지급 결과가 아닙니다.</small></section><section id="cleaning-refund-management"><header><h4>환불 요청 및 처리</h4><span class="cleaning-payment-unavailable-badge">실제 PG 환불 미연결</span></header><p>환불 요청·승인·처리 증빙은 해당 주문 상세에서 확인합니다.</p><small>실제 카드 취소를 실행하지 않습니다. 거래번호와 증빙이 기록되기 전에는 환불 완료로 처리하지 않습니다.</small></section><section id="cleaning-unpaid-invoices"><header><h4>확정 청구 미수금</h4><b>${money(summary.unpaid)}</b></header><p>청구 확정액에서 CRM 승인 입금액을 뺀 금액입니다.</p><button type="button" class="secondary-button" data-cleaning-view="contracts">계약·청구 장부 열기</button></section></div>` : "";
    return `<section class="cleaning-payments-panel" id="cleaning-payments-panel" aria-labelledby="cleaningPaymentsTitle"><header><div><span class="cleaning-center-eyebrow">BILLING &amp; SETTLEMENT</span><h3 id="cleaningPaymentsTitle">결제·정산</h3><p>주문 ID가 명시적으로 연결된 기존 CRM 청구·입금 장부를 보여줍니다.</p></div><button type="button" class="secondary-button" data-cleaning-view="contracts">계약·장부 관리</button></header>${tabs}${kpis}${content}${workspaces}<small class="cleaning-payments-scope">실시간 PG 승인·환불, 파트너 정산/계좌 지급은 이 CRM에서 연동되어 있지 않습니다. 확인되지 않은 수치와 처리 결과는 표시하지 않습니다.</small></section>`;
  }

  function renderCleaningSupportPanel(input) {
    const data = input || {};
    const summary = summarizeCleaningSupport(data);
    const cards = summary.cases.map(item => `<article class="cleaning-support-case${item.urgency === "긴급" && item.done !== true ? " is-urgent" : ""}"><div><small>${escapeHtml(item.ticketNo || item.id || "접수번호 미기록")} · ${escapeHtml(item.buildingName || "건물 연결 확인 필요")}</small><b>${escapeHtml(item.name || "고객명 미기록")} · ${escapeHtml(item.issueType || "요청 유형 미기록")}</b><span>${escapeHtml(item.summary || "접수 상세 미기록")}</span><small>${escapeHtml(item.currentStep || "진행 상태 확인 필요")} · ${escapeHtml(item.percent ?? 0)}%${item.visitDate ? ` · 방문 가능 ${escapeHtml(item.visitDate)}` : ""}</small></div><span class="cleaning-support-urgency${item.urgency === "긴급" && item.done !== true ? " is-urgent" : ""}">${escapeHtml(item.done ? "완료" : item.urgency || "우선순위 미기록")}</span><button type="button" class="text-button" data-action="open-cleaning-case" data-cleaning-case-open="${escapeHtml(item.id)}">기존 CRM 민원 열기</button></article>`).join("");
    const content = summary.state === "loading"
      ? `<p class="cleaning-support-empty" role="status">CRM 민원 자료를 불러오는 중입니다.</p>`
      : summary.state === "error"
        ? `<p class="cleaning-support-empty" role="status">CRM 민원 자료를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.</p>`
        : summary.state === "empty"
          ? `<p class="cleaning-support-empty">표시할 고객 민원·요청이 없습니다. 현재 불러온 청소 주문의 건물과 연결된 CRM 기록을 기준으로 합니다.</p>`
          : `<div class="cleaning-support-kpis"><span>민원·요청 ${summary.total}건</span><span>미완료 ${summary.open}건</span><span>긴급 ${summary.urgent}건</span></div><div class="cleaning-support-list">${cards}</div>`;
    return `<section class="cleaning-support-panel" aria-labelledby="cleaningSupportTitle"><header><div><span class="cleaning-center-eyebrow">CUSTOMER CARE</span><h3 id="cleaningSupportTitle">고객 요청·A/S</h3><p>청소 주문이 있는 건물에 등록된 기존 CRM 민원과 요청을 살펴봅니다.</p></div><button type="button" class="secondary-button" data-cleaning-view="cases">전체 민원 관리</button></header>${content}<small class="cleaning-support-scope">동일 건물의 CRM 민원을 표시합니다. 주문과 민원 사이에 직접 연결 관계가 저장되지 않은 기록은 직접 연결된 A/S 기록으로 단정하지 않습니다. 보증기간·재작업 SLA는 CRM에 연결된 값만 기존 민원 화면에서 확인할 수 있습니다.</small></section>`;
  }

  function render(input) {
    const data = input || {};
    const readOnly = data.canWrite === false;
    const metrics = [
      ["등록 고객", data.customers, "기존 CRM 고객"],
      ["연결 건물", data.buildings, "기존 CRM 건물"],
      ["미완료 요청", data.cases, "접수·처리 기록"],
      ["진행 작업", data.workOrders, "업무지시 기준"],
      ["진행 수주", data.deliveryFlows, "수주 진행 기록"],
      ["협력업체", data.partners, "기존 CRM 업체"]
    ];
    const metricCards = metrics.map(([label, metric, source]) => `<article class="cleaning-kpi">
      <span>${escapeHtml(label)}</span><strong>${metricValue(metric)}</strong>
      <small>${escapeHtml(metric && metric.error ? "갱신 실패 · 표시 중 값은 이전 자료" : source)}</small>
    </article>`).join("");
    const queueSummary = summarizeOrderQueue(data);
    const stageCards = orderQueueStages.map(stage => `<button type="button" class="cleaning-stage-kpi${stage.key === "overdue" ? " is-overdue" : ""}" data-cleaning-status-preset="${stage.status}"${["ready", "empty"].includes(queueSummary.state) && !(stage.key === "overdue" && !queueSummary.overdue) ? "" : " disabled"}>
      <span>${escapeHtml(stage.label)}</span><strong>${queueSummary.counts[stage.key].toLocaleString("ko-KR")}<small>건</small></strong><small>불러온 주문 기준 · 눌러서 필터</small>
    </button>`).join("");
    const queueDashboard = ["pending", "loading"].includes(queueSummary.state)
      ? `<p class="cleaning-stage-state" role="status">주문 현황 집계 대기 · 서버의 청소 주문 자료를 불러오는 중입니다.</p>`
      : queueSummary.state === "error"
        ? `<p class="cleaning-stage-state is-error" role="status">주문 현황 조회 실패 · 주문 목록을 새로고침해 주세요.</p>`
        : `<div class="cleaning-order-stage-kpis" aria-label="청소 주문 진행 단계">${stageCards}</div><div class="cleaning-stage-footnote"><span>${escapeHtml(queueSummary.scopeLabel)}</span>${queueSummary.updatedAtLabel ? `<small>${escapeHtml(queueSummary.updatedAtLabel)}</small>` : ""}<small>기한 초과: 완료·취소 외, 희망일이 지난 주문 · 다른 단계와 중복 집계될 수 있음</small></div>`;
    const groupCards = groups.map(group => `<section class="cleaning-group" aria-labelledby="cleaning-${group.id}">
      <header><div><h3 id="cleaning-${group.id}">${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div></header>
      <div class="cleaning-link-grid">${group.items.map(([view, title, detail]) => `<button type="button" class="cleaning-link" data-view="${escapeHtml(view)}" data-cleaning-view="${escapeHtml(view)}">
        <span class="cleaning-link-icon" aria-hidden="true">›</span><span class="cleaning-link-copy"><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span>
        <span class="cleaning-link-arrow" aria-hidden="true">→</span>
      </button>`).join("")}</div>
      </section>`).join("");
    const dispatchRows = (Array.isArray(data.orders) ? data.orders : []).flatMap(order =>
      (Array.isArray(order.relatedWorkOrders) ? order.relatedWorkOrders : []).map(item => ({ order, item })),
    );
    const leadSummary = summarizeCleaningDashboard(data);
    const leadStages = [
      ["received", "미검토", leadSummary.byStatus.received],
      ["reviewing", "상담 중", leadSummary.byStatus.reviewing],
      ["quote_pending,approval_pending", "견적·승인 대기", leadSummary.byStatus.quote_pending + leadSummary.byStatus.approval_pending],
      ["scheduled", "일정 확정", leadSummary.byStatus.scheduled],
    ];
    const leadStageCards = leadStages.map(([status, label, count]) => `<button type="button" class="cleaning-lead-stage${status === data.orderStatusFilter ? " is-active" : ""}" data-cleaning-status-preset="${status}"${["ready", "empty"].includes(leadSummary.state) ? "" : " disabled"}><span>${escapeHtml(label)}</span><b>${["ready", "empty"].includes(leadSummary.state) ? Number(count).toLocaleString("ko-KR") : "—"}<small>건</small></b></button>`).join("");

    return `<section class="cleaning-center" aria-labelledby="cleaningCenterTitle">
      <section class="cleaning-center-hero">
        <div><span class="cleaning-center-eyebrow">BRING · SERVICE OPERATIONS</span>
          <h2 id="cleaningCenterTitle">고객 요청을 접수하고, 작업 완료까지 연결합니다</h2>
          <p>고객·건물·견적·작업·결과 기록은 기존 CRM의 같은 자료를 사용합니다. 고객 정보를 새로 중복 등록하지 않습니다.</p>
          <div class="cleaning-center-quick-actions"><button type="button" class="primary-button" data-action="new-consultation">＋ 상담 접수</button><button type="button" class="secondary-button" data-action="new-workflow-case">새 고객 요청</button><button type="button" class="secondary-button" data-cleaning-scroll-target="cleaning-payments-panel">결제·환불</button><button type="button" class="secondary-button" data-cleaning-scroll-target="cleaning-dispatch-tower">배차·지연 대응</button><button type="button" class="secondary-button" data-action="new-customer">고객 등록</button>${data.canManagePricingPolicies ? `<button type="button" class="secondary-button" data-action="open-cleaning-pricing-policy">가격정책 설정</button>` : ""}</div>
        </div>
        <button type="button" class="secondary-button" data-action="refresh-cleaning-center"${data.loading ? " disabled" : ""}>${data.loading ? "불러오는 중…" : "현황 새로고침"}</button>
      </section>
      ${renderCleaningDashboard(data)}
      ${renderCleaningPartnerSearch(data)}
      ${renderCleaningDispatchTower(data)}
      ${renderCleaningSchedule(data)}
      ${renderCleaningSupportPanel(data)}
      ${renderCleaningPayments(data)}
      <details class="cleaning-order-dashboard"><summary><span>전체 주문 단계별 현황 보기</span><small>7단계와 기한 초과 주문 · 눌러서 해당 주문 필터</small></summary>${queueDashboard}</details>
      <details class="cleaning-connected-summary"><summary>기존 CRM 연결 현황 보기</summary><section class="cleaning-kpis" aria-label="클리닝센터 연결 현황">${metricCards}</section></details>
      <section class="cleaning-orders-panel" aria-labelledby="cleaningOrdersTitle">
        <header><div><span>ORDER QUEUE</span><h2 id="cleaningOrdersTitle">청소 요청 접수·진행</h2><p>기존 CRM 고객·건물 ID에 연결된 주문입니다.</p></div><button type="button" class="primary-button" data-action="new-cleaning-order"${readOnly ? " disabled aria-describedby=\"cleaningOrdersReadOnly\"" : ""}>＋ 청소 요청 등록</button></header>
        ${readOnly ? `<p id="cleaningOrdersReadOnly" class="cleaning-orders-permission" role="status">조회 전용 계정입니다. 주문 등록과 단계 변경은 관리자 또는 업무 담당자 권한이 필요합니다.</p>` : ""}
        <section class="cleaning-lead-queue" aria-label="신규 청소 문의 진행 요약"><div class="cleaning-lead-stages">${leadStageCards}</div><small>신규 청소 주문의 CRM 상태를 집계합니다. 전화 유입 경로와 통화 대기·콜백 상태는 아직 CRM에 연결되지 않았습니다.</small></section>
        <div class="cleaning-order-filters"><label><span>요청 검색</span><input type="search" data-cleaning-order-search value="${escapeHtml(data.orderSearch || "")}" placeholder="요청·고객·건물 검색" autocomplete="off"></label><label><span>진행 상태</span><select data-cleaning-order-status><option value="all"${!data.orderStatusFilter || data.orderStatusFilter === "all" ? " selected" : ""}>모든 상태</option>${orderQueueStages.map(stage => `<option value="${stage.status}"${data.orderStatusFilter === stage.status ? " selected" : ""}>${escapeHtml(stage.label)}</option>`).join("")}${orderStatuses.map(([value, label]) => `<option value="${value}"${data.orderStatusFilter === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><small><b data-cleaning-filter-count>0 / 0건</b> 표시</small></div>
        ${data.ordersLoading ? `<p class="cleaning-orders-empty">주문을 불러오는 중입니다…</p>` : data.ordersError ? `<p class="cleaning-orders-empty" role="status">${escapeHtml(cleaningOrderErrorMessage(data.ordersError))}</p>` : !data.orders?.length ? `<p class="cleaning-orders-empty">등록된 주문이 없습니다. 첫 요청을 접수해 보세요.</p>` : `<div class="cleaning-orders-list">${data.orders.map(order => { const linkedWorkOrders = Array.isArray(order.relatedWorkOrders) ? order.relatedWorkOrders : []; const linkedReports = Array.isArray(order.relatedReports) ? order.relatedReports : []; const hasRelated = linkedWorkOrders.length || linkedReports.length; const canManageQuote = data.canWrite === true || data.canReviewQuotes === true; const quoteStatusLabels = { pending_review: "관리자 검토 대기", admin_approved: "관리자 승인", returned: "수정 요청" }; const quoteLabel = order.quoteSummary ? `견적 ${escapeHtml(order.quoteSummary.latestRevision || "")}차 · ${escapeHtml(quoteStatusLabels[order.quoteSummary.status] || "상태 확인 필요")}` : ["quote_pending", "approval_pending"].includes(order.status) ? "견적 작성" : "견적 이력"; const canStartWork = data.canCreateWorkOrders === true && ["approval_pending", "scheduled", "in_progress", "revision_requested"].includes(order.status) && !linkedWorkOrders.some(item => item.status !== "done"); const canStartReport = data.canCreateWorkReports === true && ["in_progress", "revision_requested"].includes(order.status); const serviceLabels = { move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소", stair_cleaning: "계단 청소", other: "기타 서비스" }; const description = String(order.description || "").trim(); return `<article class="cleaning-order-row" data-cleaning-order-id="${escapeHtml(order.id)}"><div><small class="cleaning-order-lead-meta">접수 ${escapeHtml(receivedAtLabel(order.createdAt))} · ${escapeHtml(receivedAgeLabel(order.createdAt, data.nowMs))}</small><strong>${escapeHtml(order.title)}</strong><small>${escapeHtml(order.customerName || "고객 연결 확인 필요")} · ${escapeHtml(order.customerPhone || "연락처 미등록")} · ${escapeHtml(order.buildingName || "건물 연결 확인 필요")} · ${escapeHtml(regionLabel(order.buildingAddress))}</small><small class="cleaning-order-channel">유입경로 미기록</small>${order.serviceType ? `<small class="cleaning-order-service">${escapeHtml(serviceLabels[order.serviceType] || "서비스 유형 확인 필요")}</small>` : ""}${description ? `<details class="cleaning-order-request"><summary>접수 상세 보기</summary><p>${escapeHtml(description)}</p></details>` : ""}${renderOrderAudit(order)}${hasRelated ? `<details class="cleaning-order-related"><summary>연결 기록 ${linkedWorkOrders.length}건 업무 · ${linkedReports.length}건 결과보고</summary><div>${linkedWorkOrders.map(item => `<button type="button" class="text-button" data-action="open-cleaning-work-order" data-record-id="${escapeHtml(item.id)}">업무 · ${escapeHtml(item.title)} · ${escapeHtml(item.progress)}%</button>`).join("")}${linkedReports.map(item => `<button type="button" class="text-button" data-action="open-cleaning-report" data-record-id="${escapeHtml(item.id)}">결과 · ${escapeHtml(item.title)} · ${escapeHtml(item.workDate)} · 증빙 사진 ${escapeHtml(item.photoCount)}장</button>`).join("")}</div></details>` : `<small>연결된 업무·결과보고 없음</small>`}${order.customerId ? `<button type="button" class="text-button cleaning-order-customer-button" data-customer-open="${escapeHtml(order.customerId)}">고객 상세 · ${escapeHtml(order.customerName || "고객")}</button>` : ""}<button type="button" class="text-button cleaning-order-detail-button" data-action="view-cleaning-order-details" data-order-id="${escapeHtml(order.id)}">주문 상세 보기</button></div><span class="cleaning-order-status">${escapeHtml(order.statusLabel || order.status)}</span><time>${escapeHtml(order.desiredDate || "일정 미정")}</time>${canManageQuote ? `<button type="button" class="secondary-button cleaning-order-quote" data-action="manage-cleaning-quote" data-order-id="${escapeHtml(order.id)}">${quoteLabel}</button>` : ""}${canStartWork ? `<button type="button" class="secondary-button cleaning-order-work-start" data-action="create-cleaning-work-order" data-order-id="${escapeHtml(order.id)}">작업 지시 만들기</button>` : ""}${canStartReport ? `<button type="button" class="secondary-button cleaning-order-report-start" data-action="create-cleaning-work-report" data-order-id="${escapeHtml(order.id)}">결과보고 작성</button>` : ""}${order.nextStatus ? `<button type="button" class="secondary-button cleaning-order-advance" data-action="advance-cleaning-order" data-order-id="${escapeHtml(order.id)}" data-next-status="${escapeHtml(order.nextStatus)}"${readOnly ? " disabled" : ""}>${escapeHtml(order.nextStatusLabel || "다음 단계")}</button>` : ""}</article>`; }).join("")}</div>`}
        ${dispatchRows.length ? `<section class="cleaning-dispatch-summary" aria-label="배정된 현장 작업"><h3>일정·담당 배정</h3><ul>${dispatchRows.map(({ order, item }) => `<li><b>${escapeHtml(order.title || "청소 요청")}</b><span>담당 ${escapeHtml(item.assigneeName || "담당자 미배정")}</span><span>기한 ${escapeHtml(item.dueDate || "미정")}</span><span>${escapeHtml(item.status || "상태 확인 필요")}</span></li>`).join("")}</ul></section>` : ""}
        <p class="cleaning-orders-no-match" data-cleaning-no-match hidden>조건에 맞는 요청이 없습니다.</p>
        ${data.ordersLoadMoreError ? `<p class="cleaning-orders-load-error" role="status">${escapeHtml(cleaningOrderErrorMessage(data.ordersLoadMoreError))}</p>` : ""}
        ${data.ordersHasMore ? `<button type="button" class="secondary-button cleaning-orders-load-more" data-action="load-more-cleaning-orders"${data.ordersLoadingMore ? " disabled" : ""}>${data.ordersLoadingMore ? "이전 요청 불러오는 중…" : "이전 요청 더 보기"}</button>` : ""}
      </section>
      ${data.error ? `<div class="cleaning-center-alert" role="status">${escapeHtml(data.error)}</div>` : ""}
      <div class="cleaning-center-section-head"><div><span>ONE CONNECTED WORKFLOW</span><h2>업무 바로가기</h2></div><small>선택하면 해당 CRM 기능으로 이동합니다</small></div>
      <div class="cleaning-groups">${groupCards}</div>
      <footer class="cleaning-center-note"><b>연동 범위</b><span>고객·건물·상담·견적·수주·일정·작업·사진·요청·계약·협력업체는 기존 CRM 화면과 같은 데이터를 사용합니다. 전화 자동연결(CTI), 파트너 전용 앱, 실제 결제·환불·지급 자동화는 별도 연동이 필요한 항목이며 여기서 완료된 것처럼 표시하지 않습니다.</span></footer>
    </section>`;
  }

  return Object.freeze({ render, renderCleaningCti, summarizeCleaningCti, renderCleaningDashboard, renderCleaningPricingPolicyDialog, selectCleaningPricingPolicy, calculateCleaningPrice, renderCleaningPartnerSearch, matchesCleaningPartnerFilter, renderCleaningPartnerManagement, renderCleaningPartnerDispatch, renderCleaningDelayDialog, previewCleaningRefund, summarizeCleaningPartnerManagement, matchesCleaningPartnerManagementFilter, cleaningPartnerCandidateFromVendor, renderCleaningDispatchTower, summarizeCleaningDispatch, matchesCleaningDispatchFilter, renderCleaningSchedule, summarizeCleaningSchedule, summarizeCleaningDashboard, summarizeCleaningAnalytics, renderCleaningAnalytics, summarizeCleaningCustomer360, buildCleaningPayments, cleaningQuotePricesConfirmed, renderCleaningSupportPanel, summarizeCleaningSupport, renderCleaningPayments, renderCleaningSettlementDialog, summarizeCleaningPayments, renderOrderDetails, renderCancellationConfirmation, renderCleaningRefundDialog, renderCleaningExtraChargeDialog, renderCleaningReworkDialog, renderTransitionConfirmation, renderCleaningQuoteReview, statusLabel, cleaningReportEditAccess, reviewChecklistGaps, cleaningWorkOrderProgress, groups, matchesOrderFilter, summarizeOrderQueue });
});

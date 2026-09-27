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
    const searchable = [row.title, row.customerName, row.buildingName, row.description, row.searchText].map(normalize).join(" ");
    const label = orderStatuses.find(([value]) => value === selectedStatus)?.[1];
    const stage = orderQueueStages.find(item => item.status === selectedStatus);
    const statusMatches = Boolean(selectedStatus === "all"
      || (selectedStatus === "__overdue" && isOverdueOrder(row, String(asOf || "")))
      || (stage && stage.statuses.includes(String(row.status || "")))
      || row.status === selectedStatus || (label && row.statusLabel === label));
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
        <section><h3>일정·배정</h3>${workOrders.length ? `<ul>${workOrders.map(item => `<li><b>${escapeHtml(item.title || "업무 제목 미입력")}</b><span>담당 ${escapeHtml(item.assigneeName || "미배정")} · 기한 ${escapeHtml(item.dueDate || "미정")} · ${escapeHtml(item.statusLabel || item.status || "상태 확인 필요")} · ${escapeHtml(Number(item.progress || 0))}%</span><button type="button" class="text-button" data-action="open-cleaning-work-order" data-record-id="${escapeHtml(item.id)}">기존 CRM 업무 열기</button></li>`).join("")}</ul>` : `<p>연결된 작업지시가 없습니다.</p>`}</section>
        <section><h3>현장 결과·증빙</h3><div class="cleaning-review-check" role="status"><b>검수 준비 점검</b>${reviewGaps.length ? `<ul>${reviewGaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join("")}</ul>` : `<p>화면상 필수 항목이 등록됐습니다.</p>`}<small>최종 완료 여부는 서버가 같은 건물·서비스 유형, 이번 작업 회차, 사진 파일의 실제 연결을 다시 검증합니다.</small></div>${reports.length ? `<ul>${reports.map(item => { const checklist = item.checklistSummary; const checklistItems = Array.isArray(checklist && checklist.items) ? checklist.items : []; return `<li><b>${escapeHtml(item.title || "작업 결과보고서")}</b><span>${escapeHtml(item.workDate || "날짜 미정")} · 증빙 사진 ${escapeHtml(item.photoCount || 0)}장${checklist ? ` · 체크리스트 진척 ${escapeHtml(checklist.progress)}% (${escapeHtml(checklist.done)} 완료 · ${escapeHtml(checklist.partial)} 일부 · ${escapeHtml(checklist.skipped)} 미수행)` : " · 체크리스트 확인 필요"}</span>${checklistItems.length ? `<div class="cleaning-order-checklist"><b>진행 체크리스트</b>${checklistItems.map(entry => `<div><span>${escapeHtml(entry.label)} · ${escapeHtml(entry.statusLabel)}</span><small>작업 전 ${escapeHtml(entry.beforeCount)}장 · 작업 후 ${escapeHtml(entry.afterCount)}장${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</small></div>`).join("")}</div>` : ""}<button type="button" class="text-button" data-action="open-cleaning-report" data-record-id="${escapeHtml(item.id)}">기존 CRM 결과보고 열기</button></li>`; }).join("")}</ul>` : `<p>연결된 결과보고서가 없습니다. 완료 전 결과와 증빙 검수가 필요합니다.</p>`}</section>
        <section><h3>상태 변경 이력</h3>${history.length ? `<ol>${history.map(entry => `<li><time>${escapeHtml(entry.changedAt || "시각 미상")}</time><b>${escapeHtml(statusLabel(entry.status) || "상태 확인 필요")}</b><span>${escapeHtml(entry.note || "사유 기록 없음")}</span></li>`).join("")}</ol>` : `<p>등록된 변경 이력이 없습니다.</p>`}</section>
        <div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">닫기</button></div>
      </div>`;
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

    return `<section class="cleaning-center" aria-labelledby="cleaningCenterTitle">
      <section class="cleaning-center-hero">
        <div><span class="cleaning-center-eyebrow">BRING · SERVICE OPERATIONS</span>
          <h2 id="cleaningCenterTitle">고객 요청을 접수하고, 작업 완료까지 연결합니다</h2>
          <p>고객·건물·견적·작업·결과 기록은 기존 CRM의 같은 자료를 사용합니다. 고객 정보를 새로 중복 등록하지 않습니다.</p>
          <div class="cleaning-center-quick-actions"><button type="button" class="primary-button" data-action="new-consultation">＋ 상담 접수</button><button type="button" class="secondary-button" data-action="new-workflow-case">새 고객 요청</button><button type="button" class="secondary-button" data-action="new-customer">고객 등록</button></div>
        </div>
        <button type="button" class="secondary-button" data-action="refresh-cleaning-center"${data.loading ? " disabled" : ""}>${data.loading ? "불러오는 중…" : "현황 새로고침"}</button>
      </section>
      <section class="cleaning-order-dashboard" aria-labelledby="cleaningOrderDashboardTitle"><header><div><span>LIVE ORDER STATUS</span><h2 id="cleaningOrderDashboardTitle">청소 업무 현황</h2><p>현재 CRM에서 불러온 실제 청소 주문 기준 · 매출이나 회사 전체 업무량이 아닙니다.</p></div></header>${queueDashboard}</section>
      <details class="cleaning-connected-summary"><summary>기존 CRM 연결 현황 보기</summary><section class="cleaning-kpis" aria-label="클리닝센터 연결 현황">${metricCards}</section></details>
      <section class="cleaning-orders-panel" aria-labelledby="cleaningOrdersTitle">
        <header><div><span>ORDER QUEUE</span><h2 id="cleaningOrdersTitle">청소 요청 접수·진행</h2><p>기존 CRM 고객·건물 ID에 연결된 주문입니다.</p></div><button type="button" class="primary-button" data-action="new-cleaning-order"${readOnly ? " disabled aria-describedby=\"cleaningOrdersReadOnly\"" : ""}>＋ 청소 요청 등록</button></header>
        ${readOnly ? `<p id="cleaningOrdersReadOnly" class="cleaning-orders-permission" role="status">조회 전용 계정입니다. 주문 등록과 단계 변경은 관리자 또는 업무 담당자 권한이 필요합니다.</p>` : ""}
        <div class="cleaning-order-filters"><label><span>요청 검색</span><input type="search" data-cleaning-order-search value="${escapeHtml(data.orderSearch || "")}" placeholder="요청·고객·건물 검색" autocomplete="off"></label><label><span>진행 상태</span><select data-cleaning-order-status><option value="all"${!data.orderStatusFilter || data.orderStatusFilter === "all" ? " selected" : ""}>모든 상태</option>${orderQueueStages.map(stage => `<option value="${stage.status}"${data.orderStatusFilter === stage.status ? " selected" : ""}>${escapeHtml(stage.label)}</option>`).join("")}${orderStatuses.map(([value, label]) => `<option value="${value}"${data.orderStatusFilter === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><small><b data-cleaning-filter-count>0 / 0건</b> 표시</small></div>
        ${data.ordersLoading ? `<p class="cleaning-orders-empty">주문을 불러오는 중입니다…</p>` : data.ordersError ? `<p class="cleaning-orders-empty" role="status">${escapeHtml(cleaningOrderErrorMessage(data.ordersError))}</p>` : !data.orders?.length ? `<p class="cleaning-orders-empty">등록된 주문이 없습니다. 첫 요청을 접수해 보세요.</p>` : `<div class="cleaning-orders-list">${data.orders.map(order => { const linkedWorkOrders = Array.isArray(order.relatedWorkOrders) ? order.relatedWorkOrders : []; const linkedReports = Array.isArray(order.relatedReports) ? order.relatedReports : []; const hasRelated = linkedWorkOrders.length || linkedReports.length; const canManageQuote = data.canWrite === true || data.canReviewQuotes === true; const quoteStatusLabels = { pending_review: "관리자 검토 대기", admin_approved: "관리자 승인", returned: "수정 요청" }; const quoteLabel = order.quoteSummary ? `견적 ${escapeHtml(order.quoteSummary.latestRevision || "")}차 · ${escapeHtml(quoteStatusLabels[order.quoteSummary.status] || "상태 확인 필요")}` : ["quote_pending", "approval_pending"].includes(order.status) ? "견적 작성" : "견적 이력"; const canStartWork = data.canCreateWorkOrders === true && ["approval_pending", "scheduled", "in_progress", "revision_requested"].includes(order.status) && !linkedWorkOrders.some(item => item.status !== "done"); const canStartReport = data.canCreateWorkReports === true && ["in_progress", "revision_requested"].includes(order.status); const serviceLabels = { move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", common_cleaning: "공용부 청소", stair_cleaning: "계단 청소", other: "기타 서비스" }; const description = String(order.description || "").trim(); return `<article class="cleaning-order-row" data-cleaning-order-id="${escapeHtml(order.id)}"><div><strong>${escapeHtml(order.title)}</strong><small>${escapeHtml(order.customerName || "고객 연결 확인 필요")} · ${escapeHtml(order.buildingName || "건물 연결 확인 필요")}</small>${order.serviceType ? `<small class="cleaning-order-service">${escapeHtml(serviceLabels[order.serviceType] || "서비스 유형 확인 필요")}</small>` : ""}${description ? `<details class="cleaning-order-request"><summary>접수 상세 보기</summary><p>${escapeHtml(description)}</p></details>` : ""}${renderOrderAudit(order)}${hasRelated ? `<details class="cleaning-order-related"><summary>연결 기록 ${linkedWorkOrders.length}건 업무 · ${linkedReports.length}건 결과보고</summary><div>${linkedWorkOrders.map(item => `<button type="button" class="text-button" data-action="open-cleaning-work-order" data-record-id="${escapeHtml(item.id)}">업무 · ${escapeHtml(item.title)} · ${escapeHtml(item.progress)}%</button>`).join("")}${linkedReports.map(item => `<button type="button" class="text-button" data-action="open-cleaning-report" data-record-id="${escapeHtml(item.id)}">결과 · ${escapeHtml(item.title)} · ${escapeHtml(item.workDate)} · 증빙 사진 ${escapeHtml(item.photoCount)}장</button>`).join("")}</div></details>` : `<small>연결된 업무·결과보고 없음</small>`}<button type="button" class="text-button cleaning-order-detail-button" data-action="view-cleaning-order-details" data-order-id="${escapeHtml(order.id)}">주문 상세 보기</button></div><span class="cleaning-order-status">${escapeHtml(order.statusLabel || order.status)}</span><time>${escapeHtml(order.desiredDate || "일정 미정")}</time>${canManageQuote ? `<button type="button" class="secondary-button cleaning-order-quote" data-action="manage-cleaning-quote" data-order-id="${escapeHtml(order.id)}">${quoteLabel}</button>` : ""}${canStartWork ? `<button type="button" class="secondary-button cleaning-order-work-start" data-action="create-cleaning-work-order" data-order-id="${escapeHtml(order.id)}">작업 지시 만들기</button>` : ""}${canStartReport ? `<button type="button" class="secondary-button cleaning-order-report-start" data-action="create-cleaning-work-report" data-order-id="${escapeHtml(order.id)}">결과보고 작성</button>` : ""}${order.nextStatus ? `<button type="button" class="secondary-button cleaning-order-advance" data-action="advance-cleaning-order" data-order-id="${escapeHtml(order.id)}" data-next-status="${escapeHtml(order.nextStatus)}"${readOnly ? " disabled" : ""}>${escapeHtml(order.nextStatusLabel || "다음 단계")}</button>` : ""}</article>`; }).join("")}</div>`}
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

  return Object.freeze({ render, renderOrderDetails, renderTransitionConfirmation, renderCleaningQuoteReview, statusLabel, cleaningReportEditAccess, reviewChecklistGaps, groups, matchesOrderFilter, summarizeOrderQueue });
});

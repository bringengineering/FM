(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCleaningUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const money = value => Math.round(Number(value) || 0).toLocaleString("ko-KR");
  const active = value => (Array.isArray(value) ? value : []).filter(item => item && !item.archivedAt);
  const stageLabel = (stages, id) => stages.find(item => item.id === id)?.label || id || "미지정";
  const serviceLabel = value => ({ move_in: "입주청소", common_area: "공용부청소", recurring: "정기관리", other: "기타" }[value] || value || "미지정");
  const partnerStatusLabel = value => ({ applicant: "지원", screening: "서류·인터뷰", trial: "시험작업", conditional: "조건부 승인", approved: "정식 승인", hold: "HOLD", stop: "STOP" }[value] || value || "지원");

  function renderCleaningCenter(input) {
    const options = input && typeof input === "object" ? input : {};
    const stages = active(options.stages);
    const orders = active(options.orders);
    const partners = active(options.partners);
    const selectedStage = options.selectedStage || "all";
    const query = String(options.query || "").trim().toLowerCase();
    const visible = orders.filter(order => {
      if (selectedStage !== "all" && order.stage !== selectedStage) return false;
      if (!query) return true;
      return [order.customerName, order.phone, order.address, order.id, serviceLabel(order.serviceType)]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
    const kpis = options.kpis || {};
    const dashboard = options.dashboard || {};
    const writable = options.writable !== false;
    return '<section class="cleaning-center" aria-labelledby="cleaningCenterTitle">' +
      '<header class="cleaning-hero"><div><span class="cleaning-eyebrow">BRING CARE</span><h2 id="cleaningCenterTitle">Cleaning Sales Center</h2><p>문의부터 책임검수·결제·CS까지 한 주문으로 관리합니다.</p></div>' +
      (writable ? '<button type="button" class="primary-button" data-action="new-cleaning-order">＋ 새 청소 주문</button>' : '') + '</header>' +
      '<aside class="cleaning-promise"><strong>현장 추가금 없음</strong><span>사전 확정 범위는 브링케어가 약속한 금액 그대로 책임집니다.</span></aside>' +
      '<div class="cleaning-kpis">' +
        '<article><span>진행 주문</span><b>' + esc(kpis.activeOrders || 0) + '</b></article>' +
        '<article><span>종결 주문</span><b>' + esc(kpis.closedOrders || 0) + '</b></article>' +
        '<article><span>매출</span><b>' + money(kpis.totalSales) + '원</b></article>' +
        '<article><span>공헌이익</span><b>' + money(kpis.totalContributionProfit) + '원</b></article>' +
        '<article><span>5분 응답률</span><b>' + esc(kpis.fiveMinuteResponseRate || 0) + '%</b></article>' +
      '</div>' +
      '<div class="cleaning-cash-kpis"><article><span>확인 입금</span><b>' + money(dashboard.confirmedPayments) + '원</b></article><article><span>미수금</span><b>' + money(dashboard.receivables) + '원</b></article><article><span>재작업 주문</span><b>' + esc(dashboard.reworkOrders || 0) + '건</b></article><article><span>활성 Partner</span><b>' + esc(dashboard.activePartners || 0) + '팀</b></article><article><span>수익률 경고</span><b>' + esc(dashboard.marginWarningOrders || 0) + '건</b></article></div>' +
      '<nav class="cleaning-stage-filter" aria-label="청소 주문 단계">' +
        [{ id: "all", label: "전체" }].concat(stages).map(stage => '<button type="button" data-cleaning-stage="' + esc(stage.id) + '" aria-pressed="' + String(selectedStage === stage.id) + '">' + esc(stage.label) + '<em>' + (stage.id === "all" ? orders.length : orders.filter(order => order.stage === stage.id).length) + '</em></button>').join("") +
      '</nav>' +
      (visible.length ? '<div class="cleaning-order-grid">' + visible.map(order =>
        '<article class="cleaning-order-card"><button type="button" data-cleaning-order-open="' + esc(order.id) + '">' +
          '<div><span>' + esc(serviceLabel(order.serviceType)) + '</span><strong>' + esc(order.customerName || "고객명 미입력") + '</strong><small>' + esc(order.phone || "연락처 미입력") + '</small></div>' +
          '<dl><div><dt>단계</dt><dd>' + esc(stageLabel(stages, order.stage)) + '</dd></div><div><dt>현장</dt><dd>' + esc(order.address || "주소 미입력") + '</dd></div><div><dt>일정</dt><dd>' + esc(order.scheduledAt || "미정") + '</dd></div><div><dt>금액</dt><dd>' + money(order.totalAmount) + '원</dd></div></dl>' +
        '</button></article>').join("") + '</div>' :
        '<section class="cleaning-empty"><h3>등록된 청소 주문이 없습니다</h3><p>문의가 들어오면 고객·견적·일정을 한 번에 등록하세요.</p>' +
        (writable ? '<button type="button" class="primary-button" data-action="new-cleaning-order">첫 청소 주문 등록</button>' : '') + '</section>') +
      '<section class="cleaning-partners"><header><div><span class="cleaning-eyebrow">SUPPLY</span><h3>Partner 운영</h3><p>지원·시험작업·조건부 승인·등급을 분리해 관리합니다.</p></div>' + (writable ? '<button type="button" class="secondary-button" data-action="new-cleaning-partner">＋ Partner 등록</button>' : '') + '</header>' +
      (partners.length ? '<div class="cleaning-partner-grid">' + partners.map(partner => '<article><button type="button" data-cleaning-partner-open="' + esc(partner.id) + '"><span>' + esc(partnerStatusLabel(partner.status)) + '</span><strong>' + esc(partner.businessName || "상호 미입력") + '</strong><small>' + esc((partner.regions || []).join(", ") || "지역 미입력") + '</small><div><b>등급 ' + esc(partner.grade || "C") + '</b><em>시험 평균 ' + esc(partner.trialAverage || 0) + '점</em></div></button>' + (writable ? '<button type="button" class="cleaning-settlement-button" data-cleaning-settlement-add="' + esc(partner.id) + '">주간정산 생성</button>' : '') + '</article>').join("") + '</div>' : '<div class="cleaning-partner-empty">등록된 Partner가 없습니다.</div>') + '</section>' +
    '</section>';
  }

  function renderCleaningOrderDetail(input) {
    const options = input && typeof input === "object" ? input : {};
    const order = options.order || {};
    const related = name => active(options[name]).filter(item => item.cleaningOrderId === order.id);
    const dispatches = related("dispatches");
    const reports = related("reports");
    const qcReviews = related("qcReviews");
    const messages = related("messages");
    const payments = related("payments");
    const cases = related("cases");
    const cancellations = related("cancellations");
    const latestQc = qcReviews[qcReviews.length - 1];
    const confirmedPayment = payments.filter(item => item.status === "confirmed").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return '<section class="cleaning-detail">' +
      '<header><span>' + esc(serviceLabel(order.serviceType)) + '</span><h2>' + esc(order.customerName || "고객명 미입력") + '</h2><p>' + esc(order.address || "주소 미입력") + '</p></header>' +
      '<div class="cleaning-detail-status"><b>' + esc(stageLabel(active(options.stages), order.stage)) + '</b><strong>현장 추가금 없음</strong></div>' +
      '<dl class="cleaning-detail-grid"><div><dt>연락처</dt><dd>' + esc(order.phone || "-") + '</dd></div><div><dt>총액</dt><dd>' + money(order.totalAmount) + '원</dd></div><div><dt>계약금</dt><dd>' + money(order.depositAmount) + '원</dd></div><div><dt>잔금</dt><dd>' + money(order.balanceAmount) + '원</dd></div><div><dt>공헌이익</dt><dd>' + money(order.contributionProfit) + '원</dd></div><div><dt>공헌이익률</dt><dd>' + esc(order.contributionMargin || 0) + '% · ' + (order.marginStatus === "below_target" ? "목표 미달" : "목표 충족") + '</dd></div><div><dt>작업범위</dt><dd>' + esc(order.scope || "-") + '</dd></div><div><dt>제외범위</dt><dd>' + esc(order.exclusions || "-") + '</dd></div></dl>' +
      '<div class="cleaning-detail-summary"><article><span>배차</span><b>' + esc(dispatches.at(-1)?.teamName || "미배차") + '</b></article><article><span>현장보고</span><b>' + reports.length + '건</b></article><article><span>책임검수</span><b>' + (latestQc ? esc(latestQc.score) + '점 · ' + esc(latestQc.result) : "대기") + '</b></article><article><span>메시지</span><b>메시지 ' + messages.length + '건 · ' + (messages.filter(item => item.status === "draft").length ? "발송대기" : "기록완료") + '</b></article><article><span>고객 결제</span><b>입금 ' + money(confirmedPayment) + '원</b></article><article><span>CS</span><b>CS ' + cases.length + '건</b></article><article><span>취소·환불</span><b>환불요청 ' + cancellations.length + '건</b></article></div>' +
      (cases.length ? '<section class="cleaning-case-list"><h3>CS 처리현황</h3>' + cases.map(item => '<article><strong>LEVEL ' + esc(item.level) + ' · ' + esc(item.status) + '</strong><p>' + esc(item.description) + '</p></article>').join("") + '</section>' : '') +
      (cancellations.length ? '<section class="cleaning-case-list"><h3>취소·환불</h3>' + cancellations.map(item => '<article><strong>' + esc(item.status) + ' · ' + money(item.refundAmount) + '원 (' + esc(item.refundRate) + '%)</strong><p>' + esc(item.reason || "사유 미입력") + '</p>' + (options.writable !== false && item.status === "requested" ? '<button type="button" class="secondary-button" data-cleaning-cancellation-approve="' + esc(item.id) + '">관리자 승인</button>' : '') + (options.writable !== false && item.status === "approved" ? '<button type="button" class="primary-button" data-cleaning-cancellation-paid="' + esc(item.id) + '">환불 지급완료</button>' : '') + '</article>').join("") + '</section>' : '') +
      (options.writable !== false ? '<div class="cleaning-operation-actions"><button type="button" class="secondary-button" data-cleaning-dispatch-add="' + esc(order.id) + '">배차 등록</button><button type="button" class="secondary-button" data-cleaning-report-add="' + esc(order.id) + '">현장보고</button><button type="button" class="secondary-button" data-cleaning-qc-add="' + esc(order.id) + '">책임검수</button><button type="button" class="secondary-button" data-cleaning-message-add="' + esc(order.id) + '">문자 초안</button><button type="button" class="secondary-button" data-cleaning-payment-add="' + esc(order.id) + '">결제 기록</button><button type="button" class="secondary-button" data-cleaning-case-add="' + esc(order.id) + '">CS 접수</button><button type="button" class="secondary-button" data-cleaning-cancellation-add="' + esc(order.id) + '">취소·환불 접수</button></div><footer><button type="button" class="secondary-button" data-cleaning-order-edit="' + esc(order.id) + '">주문 수정</button><button type="button" class="primary-button" data-cleaning-order-next="' + esc(order.id) + '">다음 단계</button></footer>' : '') +
    '</section>';
  }

  return Object.freeze({ renderCleaningCenter, renderCleaningOrderDetail });
});

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
    const followUpDashboard = options.followUpDashboard || {};
    const priorityActions = active(followUpDashboard.priorityActions);
    const alerts = active(options.alerts);
    const priceBook = options.priceBook || {};
    const quickPrices = active(priceBook.quickPrices);
    const serviceCatalog = options.serviceCatalog || {};
    const launchProducts = active(serviceCatalog.products);
    const salesStandards = options.salesStandards || {};
    const salesScripts = active(salesStandards.scripts);
    const salesFaqs = active(salesStandards.faqs);
    const requiredQuestions = Array.isArray(salesStandards.requiredQuestions) ? salesStandards.requiredQuestions : [];
    const retentionLabel = value => ({ review: "리뷰 요청", building_care: "건물관리 상담", repeat_referral: "재구매·추천" }[value] || value || "후속조치");
    const orderName = orderId => orders.find(item => item.id === orderId)?.customerName || orderId || "고객 미확인";
    const writable = options.writable !== false;
    return '<section class="cleaning-center" aria-labelledby="cleaningCenterTitle">' +
      '<header class="cleaning-hero"><div><span class="cleaning-eyebrow">BRING CARE</span><h2 id="cleaningCenterTitle">Cleaning Sales Center</h2><p>문의부터 책임검수·결제·CS까지 한 주문으로 관리합니다.</p></div>' +
      (writable ? '<button type="button" class="primary-button" data-action="new-cleaning-order">＋ 새 청소 주문</button>' : '') + '</header>' +
      '<aside class="cleaning-promise"><strong>현장 추가금 없음</strong><span>사전 확정 범위는 브링케어가 약속한 금액 그대로 책임집니다.</span></aside>' +
      '<section class="cleaning-partners"><header><div><span class="cleaning-eyebrow">' + esc(priceBook.version || "PRICE BOOK") + '</span><h3>판매 기준표</h3><p><strong>현장 추가금 금지.</strong> 추가 작업은 사진 확인과 고객센터의 사전 승인 후 견적에 포함합니다.</p></div></header>' + (quickPrices.length ? '<div class="cleaning-partner-grid">' + quickPrices.map(item => '<article><div><span>' + esc(item.basis || "기준") + '</span><strong>' + esc(item.label) + '</strong><small>' + money(item.amount) + '원</small></div></article>').join("") + '</div>' : '<div class="cleaning-partner-empty">등록된 판매가격이 없습니다.</div>') + '</section>' +
      '<section class="cleaning-partners"><header><div><span class="cleaning-eyebrow">' + esc(serviceCatalog.version || "SERVICE SCOPE") + '</span><h3>Launch 상품·작업범위</h3><p>포함·계약 전 승인·제외 범위를 견적 전에 확정합니다.</p></div></header>' + (launchProducts.length ? '<div class="cleaning-case-list">' + launchProducts.map(item => '<details><summary>' + esc(item.name) + '</summary><p><strong>기본 포함</strong> · ' + active(item.included).map(esc).join(' · ') + '</p><p><strong>계약 전 승인</strong> · ' + active(item.preapproval).map(esc).join(' · ') + '</p><p><strong>제외</strong> · ' + active(item.excluded).map(esc).join(' · ') + '</p><p><strong>현장 추가금 없음</strong> · 정보가 다르면 작업중지 후 고객센터에서 재계약합니다.</p></details>').join("") + '</div>' : '<div class="cleaning-partner-empty">등록된 Launch 상품이 없습니다.</div>') + '</section>' +
      '<section class="cleaning-partners"><header><div><span class="cleaning-eyebrow">' + esc(salesStandards.version || "SALES STANDARD") + '</span><h3>상담 스크립트·FAQ</h3><p>상담 순서와 필수 질문을 표준화합니다.</p></div></header>' + (requiredQuestions.length ? '<div class="info-box"><strong>필수 확인</strong><br>' + requiredQuestions.map(item => esc(item)).join(' · ') + '</div>' : '') + (salesScripts.length ? '<div class="cleaning-partner-grid">' + salesScripts.map(item => '<details><summary>' + esc(item.title) + '</summary><p>' + esc(item.body) + '</p></details>').join("") + '</div>' : '') + (salesFaqs.length ? '<div class="cleaning-case-list"><h3>고객 FAQ</h3>' + salesFaqs.map(item => '<details><summary>' + esc(item.question) + '</summary><p>' + esc(item.answer) + '</p></details>').join("") + '</div>' : '') + '</section>' +
      '<div class="cleaning-kpis">' +
        '<article><span>진행 주문</span><b>' + esc(kpis.activeOrders || 0) + '</b></article>' +
        '<article><span>종결 주문</span><b>' + esc(kpis.closedOrders || 0) + '</b></article>' +
        '<article><span>매출</span><b>' + money(kpis.totalSales) + '원</b></article>' +
        '<article><span>공헌이익</span><b>' + money(kpis.totalContributionProfit) + '원</b></article>' +
        '<article><span>5분 응답률</span><b>' + esc(kpis.fiveMinuteResponseRate || 0) + '%</b></article>' +
      '</div>' +
      '<div class="cleaning-cash-kpis"><article><span>확인 입금</span><b>' + money(dashboard.confirmedPayments) + '원</b></article><article><span>미수금</span><b>' + money(dashboard.receivables) + '원</b></article><article><span>재작업 주문</span><b>' + esc(dashboard.reworkOrders || 0) + '건</b></article><article><span>활성 Partner</span><b>' + esc(dashboard.activePartners || 0) + '팀</b></article><article><span>수익률 경고</span><b>' + esc(dashboard.marginWarningOrders || 0) + '건</b></article></div>' +
      '<section class="cleaning-partners"><header><div><span class="cleaning-eyebrow">RETENTION</span><h3>후속조치 대시보드</h3><p>오늘 연락할 고객과 놓친 후속조치를 먼저 처리합니다.</p></div></header><div class="cleaning-cash-kpis"><article><span>기한 초과</span><b>' + esc(followUpDashboard.overdue || 0) + '건</b></article><article><span>오늘 예정</span><b>' + esc(followUpDashboard.dueToday || 0) + '건</b></article><article><span>초안 대기</span><b>' + esc(followUpDashboard.drafts || 0) + '건</b></article><article><span>발송 후 무응답</span><b>' + esc(followUpDashboard.awaitingResponse || 0) + '건</b></article><article><span>전환 완료</span><b>' + esc(followUpDashboard.converted || 0) + '건</b></article></div>' + (priorityActions.length ? '<div class="cleaning-order-grid">' + priorityActions.map(item => '<article class="cleaning-order-card"><button type="button" data-cleaning-order-open="' + esc(item.cleaningOrderId) + '"><div><span>' + esc(retentionLabel(item.type)) + '</span><strong>' + esc(orderName(item.cleaningOrderId)) + '</strong><small>' + esc(item.status) + '</small></div><dl><div><dt>예정일</dt><dd>' + esc(item.dueAt || "-") + '</dd></div></dl></button></article>').join("") + '</div>' : '<div class="cleaning-partner-empty">오늘 처리할 후속조치가 없습니다.</div>') + '</section>' +
      '<section class="cleaning-partners"><header><div><span class="cleaning-eyebrow">ALERT</span><h3>영업·수금 경고</h3><p>응답과 결제를 놓치기 전에 주문별 경고를 처리합니다.</p></div></header>' + (alerts.length ? '<div class="cleaning-order-grid">' + alerts.map(item => '<article class="cleaning-order-card"><button type="button" data-cleaning-order-open="' + esc(item.cleaningOrderId) + '"><div><span>' + esc(item.label) + '</span><strong>' + esc(orderName(item.cleaningOrderId)) + '</strong><small>' + (item.amount ? money(item.amount) + '원 미확인' : '즉시 연락 필요') + '</small></div><dl><div><dt>기준시각</dt><dd>' + esc(item.dueAt || "-") + '</dd></div></dl></button></article>').join("") + '</div>' : '<div class="cleaning-partner-empty">현재 영업·수금 경고가 없습니다.</div>') + '</section>' +
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
    const reworks = related("reworks");
    const retentionActions = related("retentionActions");
    const customerReports = related("customerReports");
    const quotes = related("quotes");
    const latestQc = qcReviews[qcReviews.length - 1];
    const confirmedPayment = payments.filter(item => item.status === "confirmed").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return '<section class="cleaning-detail">' +
      '<header><span>' + esc(serviceLabel(order.serviceType)) + '</span><h2>' + esc(order.customerName || "고객명 미입력") + '</h2><p>' + esc(order.address || "주소 미입력") + '</p></header>' +
      '<div class="cleaning-detail-status"><b>' + esc(stageLabel(active(options.stages), order.stage)) + '</b><strong>현장 추가금 없음</strong></div>' +
      '<dl class="cleaning-detail-grid"><div><dt>연락처</dt><dd>' + esc(order.phone || "-") + '</dd></div><div><dt>총액</dt><dd>' + money(order.totalAmount) + '원</dd></div><div><dt>계약금</dt><dd>' + money(order.depositAmount) + '원</dd></div><div><dt>잔금</dt><dd>' + money(order.balanceAmount) + '원</dd></div><div><dt>공헌이익</dt><dd>' + money(order.contributionProfit) + '원</dd></div><div><dt>공헌이익률</dt><dd>' + esc(order.contributionMargin || 0) + '% · ' + (order.marginStatus === "below_target" ? "목표 미달" : "목표 충족") + '</dd></div><div><dt>작업범위</dt><dd>' + esc(order.scope || "-") + '</dd></div><div><dt>제외범위</dt><dd>' + esc(order.exclusions || "-") + '</dd></div></dl>' +
      '<div class="cleaning-detail-summary"><article><span>견적서</span><b>고객 견적서 ' + quotes.length + '건</b></article><article><span>배차</span><b>' + esc(dispatches.at(-1)?.teamName || "미배차") + '</b></article><article><span>현장보고</span><b>' + reports.length + '건</b></article><article><span>책임검수</span><b>' + (latestQc ? esc(latestQc.score) + '점 · ' + esc(latestQc.result) : "대기") + '</b></article><article><span>메시지</span><b>메시지 ' + messages.length + '건 · ' + (messages.filter(item => item.status === "draft").length ? "발송대기" : "기록완료") + '</b></article><article><span>고객 결제</span><b>입금 ' + money(confirmedPayment) + '원</b></article><article><span>CS</span><b>CS ' + cases.length + '건</b></article><article><span>취소·환불</span><b>환불요청 ' + cancellations.length + '건</b></article><article><span>재작업</span><b>재작업 ' + reworks.length + '건</b></article><article><span>리뷰·재구매</span><b>리뷰·재구매 ' + retentionActions.length + '건</b></article><article><span>완료보고</span><b>고객 완료보고 ' + customerReports.length + '건</b></article></div>' +
      (cases.length ? '<section class="cleaning-case-list"><h3>CS 처리현황</h3>' + cases.map(item => '<article><strong>LEVEL ' + esc(item.level) + ' · ' + esc(item.status) + '</strong><p>' + esc(item.description) + '</p></article>').join("") + '</section>' : '') +
      (cancellations.length ? '<section class="cleaning-case-list"><h3>취소·환불</h3>' + cancellations.map(item => '<article><strong>' + esc(item.status) + ' · ' + money(item.refundAmount) + '원 (' + esc(item.refundRate) + '%)</strong><p>' + esc(item.reason || "사유 미입력") + '</p>' + (options.writable !== false && item.status === "requested" ? '<button type="button" class="secondary-button" data-cleaning-cancellation-approve="' + esc(item.id) + '">관리자 승인</button>' : '') + (options.writable !== false && item.status === "approved" ? '<button type="button" class="primary-button" data-cleaning-cancellation-paid="' + esc(item.id) + '">환불 지급완료</button>' : '') + '</article>').join("") + '</section>' : '') +
      (reworks.length ? '<section class="cleaning-case-list"><h3>재작업</h3>' + reworks.map(item => '<article><strong>' + esc(item.status) + ' · ' + esc(item.scheduledAt) + '</strong><p>' + esc(item.scope) + ' · ' + esc(item.teamName || "팀 미정") + '</p>' + (options.writable !== false && item.status === "scheduled" ? '<button type="button" class="secondary-button" data-cleaning-rework-complete="' + esc(item.id) + '">완료보고 연결</button>' : '') + (options.writable !== false && item.status === "completed" ? '<button type="button" class="secondary-button" data-cleaning-rework-pass="' + esc(item.id) + '">재검수 연결</button>' : '') + (options.writable !== false && item.status === "passed" ? '<button type="button" class="primary-button" data-cleaning-rework-close="' + esc(item.id) + '">CS 종결</button>' : '') + '</article>').join("") + '</section>' : '') +
      (retentionActions.length ? '<section class="cleaning-case-list"><h3>리뷰·재구매 후속조치</h3>' + retentionActions.map(item => { const label = item.type === "review" ? "리뷰 요청" : item.type === "building_care" ? "건물관리 상담" : "재구매·추천"; return '<article><strong>' + esc(label) + ' · ' + esc(item.status) + '</strong><p>예정 ' + esc(item.dueAt || "-") + '</p>' + (options.writable !== false && item.status === "planned" ? '<button type="button" class="secondary-button" data-cleaning-retention-draft="' + esc(item.id) + '">문자 초안 준비</button>' : '') + (options.writable !== false && item.status === "draft" ? '<button type="button" class="primary-button" data-cleaning-retention-sent="' + esc(item.id) + '">발송 확인</button>' : '') + (options.writable !== false && item.status === "sent" ? '<button type="button" class="secondary-button" data-cleaning-retention-responded="' + esc(item.id) + '">고객 응답</button><button type="button" class="primary-button" data-cleaning-retention-converted="' + esc(item.id) + '">전환 완료</button>' : '') + (options.writable !== false && item.status === "responded" ? '<button type="button" class="primary-button" data-cleaning-retention-converted="' + esc(item.id) + '">전환 완료</button>' : '') + '</article>'; }).join("") + '</section>' : '') +
      (customerReports.length ? '<section class="cleaning-case-list"><h3>고객 완료보고서</h3>' + customerReports.map(item => '<article><strong>' + esc(item.status) + ' · QC ' + esc(item.qcScore) + '점</strong><p>완료사진 ' + active(item.photoUrls).length + '장 · ' + esc(item.completedAt || "완료시간 미입력") + '</p>' + (options.writable !== false && item.status === "draft" ? '<button type="button" class="primary-button" data-cleaning-customer-report-deliver="' + esc(item.id) + '">고객 전달 확인</button>' : '') + '</article>').join("") + '</section>' : '') +
      (quotes.length ? '<section class="cleaning-case-list"><h3>고객 견적서</h3>' + quotes.map(item => '<article><strong>' + esc(item.status) + ' · ' + money(item.totalAmount) + '원</strong><p>' + esc(item.scope) + ' / 제외: ' + esc(item.exclusions || "없음") + '</p><p><strong>현장 추가금 없음</strong> · 유효기간 ' + esc(item.validUntil) + '</p>' + (options.writable !== false && item.status === "draft" ? '<button type="button" class="primary-button" data-cleaning-quote-issue="' + esc(item.id) + '">고객 발행 확인</button>' : '') + '</article>').join("") + '</section>' : '') +
      (options.writable !== false ? '<div class="cleaning-operation-actions"><button type="button" class="secondary-button" data-cleaning-quote-add="' + esc(order.id) + '">고객 견적서</button><button type="button" class="secondary-button" data-cleaning-dispatch-add="' + esc(order.id) + '">배차 등록</button><button type="button" class="secondary-button" data-cleaning-report-add="' + esc(order.id) + '">현장보고</button><button type="button" class="secondary-button" data-cleaning-qc-add="' + esc(order.id) + '">책임검수</button><button type="button" class="secondary-button" data-cleaning-customer-report-add="' + esc(order.id) + '">고객 완료보고</button><button type="button" class="secondary-button" data-cleaning-message-add="' + esc(order.id) + '">문자 초안</button><button type="button" class="secondary-button" data-cleaning-payment-add="' + esc(order.id) + '">결제 기록</button><button type="button" class="secondary-button" data-cleaning-case-add="' + esc(order.id) + '">CS 접수</button><button type="button" class="secondary-button" data-cleaning-cancellation-add="' + esc(order.id) + '">취소·환불 접수</button><button type="button" class="secondary-button" data-cleaning-rework-add="' + esc(order.id) + '">재작업 예약</button></div><footer><button type="button" class="secondary-button" data-cleaning-order-edit="' + esc(order.id) + '">주문 수정</button><button type="button" class="primary-button" data-cleaning-order-next="' + esc(order.id) + '">다음 단계</button></footer>' : '') +
    '</section>';
  }

  return Object.freeze({ renderCleaningCenter, renderCleaningOrderDetail });
});

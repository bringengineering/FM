(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCleaningCenterPages = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  const SCREEN_GROUPS = Object.freeze([
    { id: "overview", label: "운영 현황" },
    { id: "intake", label: "상담 · 고객" },
    { id: "orders", label: "주문 · 견적" },
    { id: "dispatch", label: "배차 · 파트너" },
    { id: "field", label: "현장 · 품질" },
    { id: "support", label: "고객지원 · 예외" },
    { id: "finance", label: "결제 · 정산" },
    { id: "admin", label: "분석 · 설정" },
  ]);

  const SCREENS = Object.freeze([
    { reference: "01", view: "cleaningCenter", title: "통합 운영 대시보드", label: "센터 홈", group: "overview", kind: "dashboard" },
    { reference: "02", view: "cleaningCti", title: "CTI 상담센터", label: "CTI 상담센터", group: "intake", kind: "cti" },
    { reference: "03", view: "cleaningLeads", title: "신규문의", label: "신규 문의", group: "intake", kind: "order-queue" },
    { reference: "04", view: "cleaningCustomer360", title: "Customer 360", label: "고객 360", group: "intake", kind: "customer" },
    { reference: "05", view: "cleaningQuoteCalculator", title: "견적 계산기", label: "견적 계산기", group: "orders", kind: "quotes" },
    { reference: "06", view: "cleaningOrderDetail", title: "주문 상세", label: "주문 상세", group: "orders", kind: "order-detail" },
    { reference: "07", view: "cleaningPartnerSearch", title: "파트너 검색 / 추천", label: "파트너 검색", group: "dispatch", kind: "partner-search" },
    { reference: "08", view: "cleaningDispatchTower", title: "Dispatch Control Tower", label: "배차 관제", group: "dispatch", kind: "dispatch" },
    { reference: "09", view: "cleaningScheduleMap", title: "일정·지도 관제", label: "일정 · 지도", group: "dispatch", kind: "schedule" },
    { reference: "10", view: "cleaningWorkOrder", title: "Work Order", label: "작업지시", group: "field", kind: "work-order" },
    { reference: "11", view: "cleaningPhotoReview", title: "사진 검수센터", label: "사진 검수", group: "field", kind: "photo-review" },
    { reference: "12", view: "cleaningSupportCenter", title: "CS / AS Center", label: "CS · AS", group: "support", kind: "support" },
    { reference: "13", view: "cleaningPayments", title: "결제 · 정산", label: "결제 · 정산", group: "finance", kind: "payments" },
    { reference: "14", view: "cleaningPartnerManagement", title: "Partner Management", label: "파트너 관리", group: "dispatch", kind: "partners" },
    { reference: "15", view: "cleaningAnalytics", title: "Analytics", label: "분석 · 리포트", group: "admin", kind: "analytics" },
    { reference: "16", view: "cleaningPartnerApp", title: "BRING Partner App", label: "파트너 앱", group: "dispatch", kind: "partner-app" },
    { reference: "17", view: "cleaningBusinessFlow", title: "전체 Business Flow", label: "업무 흐름", group: "overview", kind: "documentation-flow" },
    { reference: "18", view: "cleaningArchitecture", title: "System Architecture", label: "시스템 구조", group: "overview", kind: "documentation-architecture" },
    { reference: "19", view: "cleaningDataModel", title: "Database / Data Model", label: "데이터 모델", group: "overview", kind: "documentation-data" },
    { reference: "20", view: "cleaningPartnerOffer", title: "파트너 작업제안", label: "작업 제안", group: "dispatch", kind: "offer" },
    { reference: "21", view: "cleaningPartnerDecline", title: "업체 거절 처리", label: "업체 거절", group: "dispatch", kind: "decline" },
    { reference: "22", view: "cleaningPartnerNoResponse", title: "무응답 처리", label: "무응답 처리", group: "dispatch", kind: "no-response" },
    { reference: "23", view: "cleaningReassignment", title: "재배정", label: "재배정", group: "dispatch", kind: "reassignment" },
    { reference: "24", view: "cleaningOrderCancellation", title: "주문 취소", label: "주문 취소", group: "orders", kind: "cancellation" },
    { reference: "25", view: "cleaningPartialRefund", title: "부분 환불", label: "환불 처리", group: "orders", kind: "refund" },
    { reference: "26", view: "cleaningRework", title: "재작업 요청", label: "재작업 요청", group: "field", kind: "rework" },
    { reference: "27", view: "cleaningPartnerRegistration", title: "신규 파트너 등록", label: "파트너 등록", group: "dispatch", kind: "registration" },
    { reference: "28", view: "cleaningPricingPolicy", title: "가격정책 설정", label: "가격정책", group: "admin", kind: "pricing" },
    { reference: "29", view: "cleaningStaffPermissions", title: "직원 권한관리", label: "직원 권한", group: "admin", kind: "permissions" },
    { reference: "30", view: "cleaningCustomerMessage", title: "고객 문자 발송", label: "고객 문자", group: "intake", kind: "message" },
    { reference: "31", view: "cleaningConsultationBooking", title: "상담 예약 등록", label: "상담 예약", group: "intake", kind: "booking" },
    { reference: "32", view: "cleaningExtraCharge", title: "추가금 승인 요청", label: "추가금 승인", group: "support", kind: "extra-charge" },
    { reference: "33", view: "cleaningDelayNoShow", title: "지연 · 노쇼 대응", label: "지연 · 노쇼", group: "support", kind: "delay" },
    { reference: "34", view: "cleaningSettlementPayout", title: "정산 확정 · 지급", label: "파트너 지급", group: "finance", kind: "settlement" },
  ].map(Object.freeze));

  const screenByView = view => SCREENS.find(item => item.view === String(view || "")) || null;

  function renderNavigation(activeView = "cleaningCenter") {
    return SCREENS.map(screen => `<button type="button" class="nav-item nav-child${screen.view === activeView ? " active" : ""}" data-view="${escapeHtml(screen.view)}" data-cleaning-view="${escapeHtml(screen.view)}" data-cleaning-screen="${escapeHtml(screen.reference)}" aria-label="${escapeHtml(`${screen.reference} ${screen.title}`)}"><span class="cleaning-nav-number" aria-hidden="true">${escapeHtml(screen.reference)}</span><b>${escapeHtml(screen.label)}</b></button>`).join("");
  }

  function viewMeta() {
    return Object.fromEntries(SCREENS.map(screen => [screen.view, ["CLEANING CENTER · " + screen.reference, screen.title]]));
  }

  if (typeof document !== "undefined") {
    const navigation = document.querySelector("[data-cleaning-pages-nav]");
    if (navigation) navigation.innerHTML = renderNavigation();
  }

  return Object.freeze({ SCREEN_GROUPS, SCREENS, screenByView, renderNavigation, viewMeta });
});

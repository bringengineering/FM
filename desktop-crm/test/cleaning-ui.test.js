const assert = require("node:assert/strict");
const test = require("node:test");
const UI = require("../src/cleaning-ui.js");

const stages = [
  { id: "inquiry", label: "신규문의" },
  { id: "quote_sent", label: "견적발송" },
  { id: "closed", label: "종결" }
];

test("renders KPI cards pipeline filters and the no-site-surcharge promise", () => {
  const html = UI.renderCleaningCenter({
    stages,
    orders: [{ id: "cln_1", customerName: "홍길동", phone: "010-1234-5678", address: "원주시", serviceType: "move_in", stage: "quote_sent", totalAmount: 330000, scheduledAt: "2026-09-25T09:00" }],
    kpis: { activeOrders: 1, closedOrders: 0, totalSales: 330000, totalContributionProfit: 80000, fiveMinuteResponseRate: 100 },
    selectedStage: "all",
    query: "",
    writable: true
  });
  assert.match(html, /Cleaning Sales Center/);
  assert.match(html, /현장 추가금 없음/);
  assert.match(html, /5분 응답률/);
  assert.match(html, /data-cleaning-stage="quote_sent"/);
  assert.match(html, /data-cleaning-order-open="cln_1"/);
  assert.match(html, /홍길동/);
  assert.match(html, /새 청소 주문/);
});

test("renders an actionable empty state", () => {
  const html = UI.renderCleaningCenter({ stages, orders: [], kpis: {}, selectedStage: "all", writable: true });
  assert.match(html, /등록된 청소 주문이 없습니다/);
  assert.match(html, /data-action="new-cleaning-order"/);
});

test("renders order detail with scope financial and QC context", () => {
  const html = UI.renderCleaningOrderDetail({
    order: { id: "cln_1", customerName: "홍길동", phone: "010", address: "원주시", serviceType: "move_in", stage: "qc_review", totalAmount: 330000, depositAmount: 66000, balanceAmount: 264000, scope: "입주청소 전체", exclusions: "외창" },
    stages,
    dispatches: [{ id: "d1", cleaningOrderId: "cln_1", teamName: "직영 1팀" }],
    reports: [{ id: "r1", cleaningOrderId: "cln_1", type: "completion" }],
    qcReviews: [{ id: "q1", cleaningOrderId: "cln_1", score: 94, result: "passed" }],
    messages: [{ id: "m1", cleaningOrderId: "cln_1", templateId: "quote_sent", status: "sent" }],
    writable: true
  });
  assert.match(html, /입주청소 전체/);
  assert.match(html, /외창/);
  assert.match(html, /직영 1팀/);
  assert.match(html, /94점/);
  assert.match(html, /메시지 1건/);
});

test("renders Partner readiness and unit economics without mixing control status with grade", () => {
  const center = UI.renderCleaningCenter({
    stages,
    orders: [],
    partners: [
      { id: "clp_1", businessName: "원주클린", representative: "김대표", regions: ["원주"], services: ["move_in"], status: "conditional", grade: "A", trialAverage: 85 }
    ],
    kpis: {},
    selectedStage: "all",
    writable: true
  });
  assert.match(center, /Partner 운영/);
  assert.match(center, /원주클린/);
  assert.match(center, /조건부 승인/);
  assert.match(center, /등급 A/);
  assert.match(center, /data-action="new-cleaning-partner"/);

  const detail = UI.renderCleaningOrderDetail({
    order: { id: "cln_1", customerName: "홍길동", contributionProfit: 81450, contributionMargin: 27.15, targetContributionMargin: 30, marginStatus: "below_target" },
    stages, dispatches: [], reports: [], qcReviews: [], messages: [], writable: true
  });
  assert.match(detail, /공헌이익/);
  assert.match(detail, /81,450원/);
  assert.match(detail, /목표 미달/);
});

test("renders owner cash quality and payment settlement actions", () => {
  const center = UI.renderCleaningCenter({
    stages, orders: [], partners: [], kpis: {},
    dashboard: { confirmedPayments: 330000, receivables: 500000, reworkOrders: 1, activePartners: 2, marginWarningOrders: 3 },
    selectedStage: "all", writable: true
  });
  assert.match(center, /확인 입금/);
  assert.match(center, /330,000원/);
  assert.match(center, /미수금/);
  assert.match(center, /500,000원/);
  const detail = UI.renderCleaningOrderDetail({
    order: { id: "cln_1", customerName: "홍길동" }, stages,
    dispatches: [], reports: [], qcReviews: [], messages: [],
    payments: [{ id: "p1", cleaningOrderId: "cln_1", status: "confirmed", amount: 66000 }],
    writable: true
  });
  assert.match(detail, /입금 66,000원/);
  assert.match(detail, /data-cleaning-payment-add/);
});

test("renders CS ticket status and a ticket action on the order", () => {
  const detail = UI.renderCleaningOrderDetail({
    order: { id: "cln_1", customerName: "홍길동" }, stages,
    dispatches: [], reports: [], qcReviews: [], messages: [], payments: [],
    cases: [{ id: "c1", cleaningOrderId: "cln_1", type: "quality", level: 2, status: "open", description: "욕실 누락" }],
    writable: true
  });
  assert.match(detail, /CS 1건/);
  assert.match(detail, /LEVEL 2/);
  assert.match(detail, /욕실 누락/);
  assert.match(detail, /data-cleaning-case-add="cln_1"/);
});

test("renders cancellation approval and payment actions without claiming early payment", () => {
  const detail = UI.renderCleaningOrderDetail({
    order: { id: "cln_1", customerName: "홍길동" }, stages,
    dispatches: [], reports: [], qcReviews: [], messages: [], payments: [], cases: [],
    cancellations: [{ id: "x1", cleaningOrderId: "cln_1", status: "requested", refundAmount: 90000, refundRate: 90 }],
    writable: true
  });
  assert.match(detail, /환불요청 1건/);
  assert.match(detail, /90,000원/);
  assert.match(detail, /data-cleaning-cancellation-add="cln_1"/);
  assert.match(detail, /data-cleaning-cancellation-approve="x1"/);
  assert.doesNotMatch(detail, /data-cleaning-cancellation-paid="x1"/);
});

test("renders rework schedule and evidence-gated actions", () => {
  const detail = UI.renderCleaningOrderDetail({
    order: { id: "cln_1", customerName: "홍길동" }, stages,
    dispatches: [], reports: [], qcReviews: [], messages: [], payments: [], cases: [], cancellations: [],
    reworks: [{ id: "rw1", cleaningOrderId: "cln_1", status: "scheduled", scope: "욕실 재청소", scheduledAt: "2026-09-22T09:00", teamName: "직영 1팀" }], writable: true
  });
  assert.match(detail, /재작업 1건/);
  assert.match(detail, /욕실 재청소/);
  assert.match(detail, /data-cleaning-rework-add="cln_1"/);
  assert.match(detail, /data-cleaning-rework-complete="rw1"/);
});

test("renders retention funnel status and action controls", () => {
  const detail = UI.renderCleaningOrderDetail({ order: { id: "cln_1", customerName: "홍길동" }, stages, dispatches: [], reports: [], qcReviews: [], messages: [], payments: [], cases: [], cancellations: [], reworks: [], retentionActions: [{ id: "ret1", cleaningOrderId: "cln_1", type: "review", status: "planned", dueAt: "2026-09-21" }], writable: true });
  assert.match(detail, /리뷰·재구매 1건/);
  assert.match(detail, /리뷰 요청/);
  assert.match(detail, /data-cleaning-retention-draft="ret1"/);
});

test("renders customer completion report evidence and explicit delivery action", () => {
  const detail = UI.renderCleaningOrderDetail({ order: { id: "cln_1", customerName: "홍길동" }, stages, dispatches: [], reports: [], qcReviews: [], messages: [], payments: [], cases: [], cancellations: [], reworks: [], retentionActions: [], customerReports: [{ id: "cr1", cleaningOrderId: "cln_1", status: "draft", qcScore: 96, photoUrls: ["https://example.com/after.jpg"], completedAt: "2026-09-20" }], writable: true });
  assert.match(detail, /고객 완료보고 1건/);
  assert.match(detail, /QC 96점/);
  assert.match(detail, /data-cleaning-customer-report-deliver="cr1"/);
  assert.match(detail, /data-cleaning-customer-report-add="cln_1"/);
});

test("renders the retention workload dashboard with actionable orders", () => {
  const center = UI.renderCleaningCenter({ stages, orders: [{ id: "o1", customerName: "홍길동" }], partners: [], kpis: {}, dashboard: {}, followUpDashboard: { overdue: 1, dueToday: 2, drafts: 1, awaitingResponse: 1, converted: 3, priorityActions: [{ id: "a1", cleaningOrderId: "o1", type: "review", status: "planned", dueAt: "2026-09-20" }] }, writable: true });
  assert.match(center, /후속조치 대시보드/);
  assert.match(center, /기한 초과/);
  assert.match(center, /오늘 예정/);
  assert.match(center, /홍길동/);
  assert.match(center, /data-cleaning-order-open="o1"/);
});

test("renders cleaning response and receivable alerts", () => {
  const center = UI.renderCleaningCenter({ stages, orders: [{ id: "o1", customerName: "홍길동" }], partners: [], kpis: {}, dashboard: {}, followUpDashboard: {}, alerts: [{ id: "response_overdue_o1", cleaningOrderId: "o1", type: "response_overdue", label: "신규문의 5분 초과", amount: 0 }], writable: true });
  assert.match(center, /영업·수금 경고/);
  assert.match(center, /신규문의 5분 초과/);
  assert.match(center, /홍길동/);
  assert.match(center, /data-cleaning-order-open="o1"/);
});

test("renders the sales quick price and no-onsite-surcharge rule", () => {
  const center = UI.renderCleaningCenter({ stages, orders: [], partners: [], kpis: {}, dashboard: {}, followUpDashboard: {}, alerts: [], priceBook: { version: "BRING-CARE-PRICE-v0.1", quickPrices: [{ label: "원룸 6평 이하", amount: 149000 }, { label: "아파트 24평", amount: 319000 }, { label: "공용부 6층 월 4회", amount: 119000 }], noOnsiteSurcharge: true, additionalWorkRule: "preapproved_only" }, writable: true });
  assert.match(center, /판매 기준표/);
  assert.match(center, /원룸 6평 이하/);
  assert.match(center, /149,000원/);
  assert.match(center, /현장 추가금 금지/);
  assert.match(center, /사전 승인/);
});

test("renders the approved consultation scripts and FAQ", () => {
  const center = UI.renderCleaningCenter({ stages, orders: [], partners: [], kpis: {}, dashboard: {}, followUpDashboard: {}, alerts: [], priceBook: {}, salesStandards: { version: "BRING-CARE-SALES-v0.1", scripts: [{ id: "opening", title: "첫 인사", body: "브링케어입니다." }], faqs: [{ question: "현장 추가금이 있나요?", answer: "확정 범위에는 없습니다." }], requiredQuestions: ["평수 또는 면적"] }, writable: true });
  assert.match(center, /상담 스크립트·FAQ/);
  assert.match(center, /첫 인사/);
  assert.match(center, /현장 추가금이 있나요/);
  assert.match(center, /평수 또는 면적/);
});

test("renders launch product scope cards with preapproval and exclusions", () => {
  const center = UI.renderCleaningCenter({ stages, orders: [], partners: [], kpis: {}, dashboard: {}, followUpDashboard: {}, alerts: [], priceBook: {}, serviceCatalog: { version: "BRING-CARE-SCOPE-v1.0", products: [{ code: "studio_reset", name: "원룸 리셋클린", included: ["욕실"], preapproval: ["심한 곰팡이"], excluded: ["외부 고소작업"], noOnsiteSurcharge: true }] }, writable: true });
  assert.match(center, /Launch 상품·작업범위/);
  assert.match(center, /원룸 리셋클린/);
  assert.match(center, /기본 포함<\/strong> · 욕실/);
  assert.match(center, /계약 전 승인<\/strong> · 심한 곰팡이/);
  assert.match(center, /제외<\/strong> · 외부 고소작업/);
  assert.match(center, /현장 추가금 없음/);
});

test("renders customer quote evidence and explicit issue action", () => {
  const detail = UI.renderCleaningOrderDetail({ order: { id: "o1", customerName: "홍길동" }, stages, dispatches: [], reports: [], qcReviews: [], messages: [], payments: [], cases: [], cancellations: [], reworks: [], retentionActions: [], customerReports: [], quotes: [{ id: "q1", cleaningOrderId: "o1", status: "draft", totalAmount: 319000, validUntil: "2026-09-27", scope: "주방·욕실", exclusions: "폐기물" }], writable: true });
  assert.match(detail, /고객 견적서 1건/);
  assert.match(detail, /319,000원/);
  assert.match(detail, /현장 추가금 없음/);
  assert.match(detail, /data-cleaning-quote-issue="q1"/);
  assert.match(detail, /data-cleaning-quote-add="o1"/);
  assert.match(detail, /data-cleaning-quote-preview="q1"/);
});

test("renders new website estimate leads as an immediate response inbox", () => {
  const center = UI.renderCleaningCenter({
    stages, orders: [], partners: [], kpis: {}, dashboard: {}, followUpDashboard: {}, alerts: [],
    inboundLeads: [{ id: "lead_web_1", name: "홍길동", phone: "010-1234-5678", location: "원주시", service: "아파트 입주청소", submittedAt: "2026-09-20T09:00:00.000Z", status: "new" }],
    writable: true
  });
  assert.match(center, /견적 신청함/);
  assert.match(center, /신규 문의 1건/);
  assert.match(center, /홍길동/);
  assert.match(center, /010-1234-5678/);
  assert.match(center, /즉시 연락/);
  assert.match(center, /data-cleaning-lead-convert="lead_web_1"/);
});

test("renders a printable completion report action", () => {
  const detail = UI.renderCleaningOrderDetail({ order: { id: "o1", customerName: "홍길동" }, stages, dispatches: [], reports: [], qcReviews: [], messages: [], payments: [], cases: [], cancellations: [], reworks: [], retentionActions: [], quotes: [], customerReports: [{ id: "cr1", cleaningOrderId: "o1", status: "draft", qcScore: 98, photoUrls: ["https://example.com/a.jpg"] }], writable: true });
  assert.match(detail, /data-cleaning-customer-report-preview="cr1"/);
  assert.match(detail, /출력·PDF/);
});

test("renders the reviewed message outbox without claiming queued messages were sent", () => {
  const center = UI.renderCleaningCenter({ stages, orders: [{ id: "o1", customerName: "홍길동" }], partners: [], kpis: {}, dashboard: {}, followUpDashboard: {}, alerts: [], messageOutbox: { drafts: 1, queued: 1, failed: 1, sent: 2, priorityMessages: [{ id: "m1", cleaningOrderId: "o1", templateId: "quote_sent", recipient: "010-1234-5678", status: "draft", body: "견적 안내" }, { id: "m2", cleaningOrderId: "o1", templateId: "arrived", recipient: "010-1234-5678", status: "queued", body: "도착 안내" }] }, writable: true });
  assert.match(center, /문자 발송대기함/);
  assert.match(center, /검토 초안/);
  assert.match(center, /공급사 전송대기/);
  assert.match(center, /data-cleaning-message-queue="m1"/);
  assert.doesNotMatch(center, /data-cleaning-message-sent="m2"/);
});

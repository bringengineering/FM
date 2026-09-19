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

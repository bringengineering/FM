const assert = require("node:assert/strict");
const test = require("node:test");

const Reports = require("../src/management-report-core");

const store = {
  contracts: [
    {
      id: "ctr_grounds", billingCycle: "건별", name: "예초 작업", type: "예초",
      amount: 150000, vendorCost: 140000, workDate: "2026-08-15",
      paymentDueDate: "2026-08-15", collectionStatus: "입금 완료",
      vendorPaymentStatus: "지급 완료", owner: "서창환"
    },
    {
      id: "ctr_waste", billingCycle: "건별", name: "폐기물 처리", type: "폐기물",
      amount: 35000, vendorCost: 32000, workDate: "2026-08-27",
      paymentDueDate: "2026-08-27", collectionStatus: "입금 예정",
      vendorPaymentStatus: "지급 예정", owner: "서창환"
    },
    {
      id: "ctr_cancelled", billingCycle: "건별", name: "취소 작업", type: "청소",
      amount: 999999, vendorCost: 1, workDate: "2026-08-20", status: "취소"
    }
  ],
  salesActivities: [
    { id: "a1", occurredAt: "2026-08-02T03:00:00Z", result: "no_response", owner: "김현진" },
    { id: "a2", occurredAt: "2026-08-03T03:00:00Z", result: "replied", owner: "김현진" },
    { id: "a3", occurredAt: "2026-08-04T03:00:00Z", result: "meeting_set", owner: "서창환" }
  ],
  salesEvents: [
    { id: "e1", occurredAt: "2026-08-20T03:00:00Z", type: "paid_management_started", owner: "서창환" }
  ],
  salesOpportunities: [
    { id: "o1", stage: "revenue_recorded", updatedAt: "2026-08-21T03:00:00Z", owner: "서창환" }
  ]
};

test("separates settled and expected cash while preserving gross profit", () => {
  const report = Reports.buildMonthlyReport(store, "2026-08");

  assert.deepEqual(report.finance, {
    jobCount: 2,
    revenue: 185000,
    cost: 172000,
    grossProfit: 13000,
    marginRate: 7.03,
    received: 150000,
    receivable: 35000,
    paid: 140000,
    payable: 32000
  });
});

test("groups profit by work type and calculates evidence-backed conversion", () => {
  const report = Reports.buildMonthlyReport(store, "2026-08");

  assert.deepEqual(report.byWorkType, [
    { type: "예초", jobCount: 1, revenue: 150000, cost: 140000, grossProfit: 10000 },
    { type: "폐기물", jobCount: 1, revenue: 35000, cost: 32000, grossProfit: 3000 }
  ]);
  assert.deepEqual(report.sales, {
    contactCount: 3,
    validResponseCount: 2,
    conversionCount: 1,
    responseRate: 66.67,
    conversionRate: 33.33
  });
  assert.deepEqual(report.byOwner, [
    { owner: "서창환", jobCount: 2, revenue: 185000, grossProfit: 13000, salesActivityCount: 1 },
    { owner: "김현진", jobCount: 0, revenue: 0, grossProfit: 0, salesActivityCount: 2 }
  ]);
});

test("uses null comparison when the previous month has no evidence", () => {
  assert.equal(Reports.buildMonthlyReport(store, "2026-08").comparison, null);
});

test("builds a frozen AI snapshot without raw records or personal notes", () => {
  const report = Reports.buildMonthlyReport({ ...store, privateMemo: "외부 전송 금지" }, "2026-08");
  const snapshot = Reports.buildReportAiSnapshot(report);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(JSON.stringify(snapshot).includes("외부 전송 금지"), false);
  assert.equal(Object.hasOwn(snapshot, "contracts"), false);
  assert.equal(snapshot.metricEvidence.finance_gross_profit, 13000);
});

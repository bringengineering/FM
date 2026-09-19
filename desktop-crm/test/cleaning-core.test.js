const assert = require("node:assert/strict");
const test = require("node:test");

const Cleaning = require("../src/cleaning-core.js");

test("exposes the approved cleaning order lifecycle", () => {
  assert.deepEqual(Cleaning.CLEANING_ORDER_STAGES.map(item => item.id), [
    "inquiry", "quoting", "quote_sent", "reservation_pending", "deposit_paid",
    "dispatch_pending", "dispatched", "departed", "arrived", "in_progress",
    "completion_reported", "qc_review", "customer_completed", "balance_paid", "closed"
  ]);
});

test("normalizes a cleaning order and always preserves the no-site-surcharge promise", () => {
  const order = Cleaning.normalizeCleaningOrder({
    id: " cln_1 ",
    customerName: " 홍길동 ",
    phone: " 010-1234-5678 ",
    serviceType: "move_in",
    stage: "quote_sent",
    totalAmount: "330000",
    onsiteSurchargeAllowed: true
  });
  assert.equal(order.id, "cln_1");
  assert.equal(order.customerName, "홍길동");
  assert.equal(order.totalAmount, 330000);
  assert.equal(order.onsiteSurchargeAllowed, false);
  assert.equal(order.noOnsiteSurcharge, true);
});

test("validates required customer service address and schedule fields", () => {
  const result = Cleaning.validateCleaningOrder({});
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(item => item.field), [
    "customerName", "phone", "serviceType", "address", "scheduledAt"
  ]);
});

test("calculates VAT-exclusive revenue payment fee variable cost and contribution", () => {
  const quote = Cleaning.calculateCleaningQuote({
    totalAmount: 330000,
    partnerPay: 180000,
    directLabor: 0,
    advertisingCost: 10000,
    paymentFeeRate: 3.5,
    parkingCost: 5000,
    suppliesCost: 12000,
    csReworkCost: 0,
    discountAmount: 0,
    otherVariableCost: 0
  });
  assert.equal(quote.netRevenue, 300000);
  assert.equal(quote.paymentFee, 11550);
  assert.equal(quote.variableCost, 218550);
  assert.equal(quote.contributionProfit, 81450);
  assert.equal(quote.contributionMargin, 27.15);
});

test("rejects skipped lifecycle transitions", () => {
  assert.throws(
    () => Cleaning.transitionCleaningOrder({ id: "cln_1", stage: "quote_sent" }, "dispatched"),
    error => error && error.code === "CLEANING_STAGE_TRANSITION_INVALID"
  );
});

test("requires a passed QC review before customer completion", () => {
  assert.throws(
    () => Cleaning.transitionCleaningOrder(
      { id: "cln_1", stage: "qc_review" },
      "customer_completed",
      { qcReviews: [{ cleaningOrderId: "cln_1", result: "rework" }] }
    ),
    error => error && error.code === "CLEANING_QC_REQUIRED"
  );
  const completed = Cleaning.transitionCleaningOrder(
    { id: "cln_1", stage: "qc_review" },
    "customer_completed",
    { qcReviews: [{ cleaningOrderId: "cln_1", result: "passed", score: 94 }] }
  );
  assert.equal(completed.stage, "customer_completed");
});

test("renders approved message templates only when every variable is present", () => {
  const message = Cleaning.renderMessageTemplate("quote_sent", {
    customerName: "홍길동",
    totalAmount: "330,000",
    scheduledAt: "9월 25일 09:00",
    quoteUrl: "https://example.com/q/1"
  });
  assert.match(message, /홍길동/);
  assert.match(message, /현장 추가금이 없습니다/);
  assert.throws(
    () => Cleaning.renderMessageTemplate("quote_sent", { customerName: "홍길동" }),
    error => error && error.code === "CLEANING_MESSAGE_VARIABLE_REQUIRED"
  );
});

test("renders approved retention messages for review building care and repeat referral", () => {
  assert.match(Cleaning.renderMessageTemplate("review_request", { customerName: "홍길동", reviewUrl: "https://example.com/review" }), /리뷰/);
  assert.match(Cleaning.renderMessageTemplate("building_care_offer", { customerName: "홍길동", consultationUrl: "https://example.com/care" }), /건물관리/);
  assert.match(Cleaning.renderMessageTemplate("repeat_referral", { customerName: "홍길동", consultationUrl: "https://example.com/repeat" }), /재이용|추천/);
});

test("calculates operational KPIs from active orders", () => {
  const result = Cleaning.calculateCleaningKpis([
    { id: "1", stage: "inquiry", totalAmount: 100000, contributionProfit: 20000, inquiryAt: "2026-09-20T00:00:00Z", firstResponseAt: "2026-09-20T00:04:00Z" },
    { id: "2", stage: "closed", totalAmount: 330000, contributionProfit: 90000, inquiryAt: "2026-09-20T01:00:00Z", firstResponseAt: "2026-09-20T01:08:00Z" },
    { id: "3", stage: "closed", archivedAt: "2026-09-20T03:00:00Z", totalAmount: 900000 }
  ]);
  assert.equal(result.activeOrders, 2);
  assert.equal(result.closedOrders, 1);
  assert.equal(result.totalSales, 430000);
  assert.equal(result.totalContributionProfit, 110000);
  assert.equal(result.fiveMinuteResponseRate, 50);
});

test("creates a dispatch linked to one order and team", () => {
  const dispatch = Cleaning.createCleaningDispatch({
    cleaningOrderId: "cln_1",
    teamId: "team_1",
    teamName: "직영 1팀",
    scheduledAt: "2026-09-25T09:00",
    headcount: 3
  }, { email: "owner@bring.local" }, "2026-09-20T00:00:00Z");
  assert.equal(dispatch.cleaningOrderId, "cln_1");
  assert.equal(dispatch.teamName, "직영 1팀");
  assert.equal(dispatch.status, "assigned");
  assert.equal(dispatch.createdBy, "owner@bring.local");
});

test("requires evidence on completion and incident field reports", () => {
  assert.throws(
    () => Cleaning.createCleaningReport({ cleaningOrderId: "cln_1", type: "completion", note: "완료" }),
    error => error && error.code === "CLEANING_REPORT_EVIDENCE_REQUIRED"
  );
  const report = Cleaning.createCleaningReport({
    cleaningOrderId: "cln_1",
    type: "completion",
    note: "작업 완료",
    photoUrls: ["https://example.com/after.jpg"],
    facilityFindings: "욕실 환풍기 작동 불량"
  });
  assert.equal(report.photoUrls.length, 1);
  assert.match(report.facilityFindings, /환풍기/);
});

test("derives QC result from the 100 point responsibility review", () => {
  assert.equal(Cleaning.createCleaningQcReview({ cleaningOrderId: "cln_1", score: 94 }).result, "passed");
  assert.equal(Cleaning.createCleaningQcReview({ cleaningOrderId: "cln_1", score: 85 }).result, "conditional");
  assert.equal(Cleaning.createCleaningQcReview({ cleaningOrderId: "cln_1", score: 70 }).result, "rework");
  assert.throws(
    () => Cleaning.createCleaningQcReview({ cleaningOrderId: "cln_1", score: 101 }),
    error => error && error.code === "CLEANING_QC_SCORE_INVALID"
  );
});

test("creates a durable message log from an approved template", () => {
  const message = Cleaning.createCleaningMessage({
    cleaningOrderId: "cln_1",
    templateId: "quote_sent",
    recipient: "010-1234-5678",
    variables: {
      customerName: "홍길동",
      totalAmount: "330,000",
      scheduledAt: "9월 25일 09:00",
      quoteUrl: "https://example.com/q/1"
    }
  }, { email: "owner@bring.local" }, "2026-09-20T00:00:00Z");
  assert.equal(message.status, "draft");
  assert.match(message.body, /현장 추가금이 없습니다/);
  assert.equal(message.createdBy, "owner@bring.local");
});

test("creates a probationary Partner and blocks approval before two paid trials", () => {
  const partner = Cleaning.createCleaningPartner({
    businessName: "원주클린",
    representative: "김대표",
    phone: "010-1111-2222",
    regions: ["원주"],
    services: ["move_in"],
    businessRegistered: true,
    invoiceAvailable: true
  }, { email: "owner@bring.local" }, "2026-09-20T00:00:00Z");
  assert.equal(partner.status, "applicant");
  assert.equal(partner.grade, "C");
  assert.throws(
    () => Cleaning.approveCleaningPartner(partner, [{ paid: true, score: 90 }]),
    error => error && error.code === "CLEANING_PARTNER_TRIALS_REQUIRED"
  );
});

test("approves a Partner after two paid trials averaging at least 80 without violations", () => {
  const approved = Cleaning.approveCleaningPartner(
    Cleaning.createCleaningPartner({
      businessName: "원주클린",
      representative: "김대표",
      phone: "010-1111-2222",
      regions: ["원주"],
      services: ["move_in"],
      businessRegistered: true
    }),
    [
      { paid: true, score: 82, majorViolation: false },
      { paid: true, score: 88, majorViolation: false }
    ],
    { email: "owner@bring.local" },
    "2026-09-25T00:00:00Z"
  );
  assert.equal(approved.status, "conditional");
  assert.equal(approved.trialAverage, 85);
  assert.equal(approved.probationEndsAt, "2026-12-25T00:00:00.000Z");
});

test("grades Partner performance and separates performance from HOLD STOP controls", () => {
  assert.equal(Cleaning.partnerGrade(95), "S");
  assert.equal(Cleaning.partnerGrade(85), "A");
  assert.equal(Cleaning.partnerGrade(75), "B");
  assert.equal(Cleaning.partnerGrade(60), "C");
  const held = Cleaning.changeCleaningPartnerControl(
    { id: "clp_1", status: "approved", grade: "A" },
    "hold",
    "사진 조작 의심"
  );
  assert.equal(held.status, "hold");
  assert.equal(held.grade, "A");
});

test("attaches unit economics to an order and warns below the target margin", () => {
  const order = Cleaning.applyCleaningEconomics(
    { id: "cln_1", totalAmount: 330000 },
    {
      partnerPay: 180000,
      directLabor: 0,
      advertisingCost: 10000,
      paymentFeeRate: 3.5,
      parkingCost: 5000,
      suppliesCost: 12000,
      csReworkCost: 0
    },
    30
  );
  assert.equal(order.contributionProfit, 81450);
  assert.equal(order.contributionMargin, 27.15);
  assert.equal(order.marginStatus, "below_target");
});

test("records customer payments separately from Partner settlement", () => {
  const payment = Cleaning.createCleaningPayment({
    cleaningOrderId: "cln_1",
    type: "deposit",
    method: "card",
    amount: 66000,
    provider: "payapp",
    status: "confirmed",
    paidAt: "2026-09-20T03:00:00Z"
  });
  assert.equal(payment.amount, 66000);
  assert.equal(payment.status, "confirmed");
  assert.equal(payment.type, "deposit");
});

test("builds weekly Partner settlement and holds only disputed orders", () => {
  const settlement = Cleaning.createCleaningSettlement({
    partnerId: "clp_1",
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
    paymentDueAt: "2026-09-23",
    rows: [
      { cleaningOrderId: "cln_1", partnerPay: 180000, qcPassed: true, reportComplete: true, disputed: false },
      { cleaningOrderId: "cln_2", partnerPay: 220000, qcPassed: true, reportComplete: true, disputed: true },
      { cleaningOrderId: "cln_3", partnerPay: 150000, qcPassed: false, reportComplete: true, disputed: false }
    ]
  });
  assert.equal(settlement.payableAmount, 180000);
  assert.equal(settlement.heldAmount, 370000);
  assert.deepEqual(settlement.payableOrderIds, ["cln_1"]);
  assert.deepEqual(settlement.heldOrderIds, ["cln_2", "cln_3"]);
});

test("calculates owner dashboard with receivables quality and supply warnings", () => {
  const result = Cleaning.calculateCleaningDashboard({
    orders: [
      { id: "1", stage: "closed", totalAmount: 330000, contributionProfit: 90000, marginStatus: "below_target" },
      { id: "2", stage: "qc_review", totalAmount: 500000, contributionProfit: 180000, marginStatus: "on_target" }
    ],
    payments: [
      { cleaningOrderId: "1", status: "confirmed", amount: 330000 },
      { cleaningOrderId: "2", status: "pending", amount: 100000 }
    ],
    qcReviews: [
      { cleaningOrderId: "1", result: "passed" },
      { cleaningOrderId: "2", result: "rework" }
    ],
    partners: [{ id: "p1", status: "approved" }, { id: "p2", status: "hold" }]
  });
  assert.equal(result.totalSales, 830000);
  assert.equal(result.confirmedPayments, 330000);
  assert.equal(result.receivables, 500000);
  assert.equal(result.reworkOrders, 1);
  assert.equal(result.activePartners, 1);
  assert.equal(result.marginWarningOrders, 1);
});

test("creates a cleaning CS ticket with automatic escalation and response SLA", () => {
  const ticket = Cleaning.createCleaningCase({
    cleaningOrderId: "cln_1",
    customerId: "cus_1",
    partnerId: "clp_1",
    type: "quality",
    description: "욕실 청소 누락",
    responsibility: "partner",
    requestedResolution: "rework"
  }, { email: "ops@bring.local" }, "2026-09-20T01:00:00Z");
  assert.equal(ticket.level, 2);
  assert.equal(ticket.status, "open");
  assert.equal(ticket.responseDueAt, "2026-09-20T03:00:00.000Z");
});

test("escalates damage refund and legal dispute cases", () => {
  assert.equal(Cleaning.createCleaningCase({ cleaningOrderId: "1", type: "damage", description: "파손", requestedResolution: "compensation" }).level, 3);
  assert.equal(Cleaning.createCleaningCase({ cleaningOrderId: "1", type: "legal", description: "법적 분쟁 예고" }).level, 4);
});

test("calculates the recommended customer-friendly cancellation outcome", () => {
  assert.deepEqual(Cleaning.calculateCleaningCancellation({ paidAmount: 330000, cancelledBy: "customer", hoursBeforeService: 80 }), { refundRate: 100, refundAmount: 330000, feeAmount: 0, approvalRequired: false, reasonCode: "CUSTOMER_D3_PLUS" });
  assert.equal(Cleaning.calculateCleaningCancellation({ paidAmount: 330000, cancelledBy: "customer", hoursBeforeService: 30 }).refundAmount, 297000);
  assert.equal(Cleaning.calculateCleaningCancellation({ paidAmount: 330000, cancelledBy: "customer", hoursBeforeService: 5 }).refundAmount, 231000);
  assert.equal(Cleaning.calculateCleaningCancellation({ paidAmount: 330000, cancelledBy: "partner", hoursBeforeService: 5 }).refundRate, 100);
});

test("creates an auditable cancellation request without pretending the refund was paid", () => {
  const item = Cleaning.createCleaningCancellation({ cleaningOrderId: "cln_1", paidAmount: 330000, cancelledBy: "customer", hoursBeforeService: 30, reason: "이사일 변경" });
  assert.equal(item.status, "requested");
  assert.equal(item.refundAmount, 297000);
  assert.equal(item.refundPaidAt, "");
});

test("requires approval before a cancellation can be marked paid", () => {
  const requested = Cleaning.createCleaningCancellation({ cleaningOrderId: "cln_1", paidAmount: 100000, cancelledBy: "customer", hoursBeforeService: 30, reason: "변경" });
  assert.throws(() => Cleaning.transitionCleaningCancellation(requested, "paid"), /승인/);
  const approved = Cleaning.transitionCleaningCancellation(requested, "approved", { email: "owner@bring.local" }, "2026-09-20T02:00:00Z");
  const paid = Cleaning.transitionCleaningCancellation(approved, "paid", { email: "owner@bring.local" }, "2026-09-20T03:00:00Z");
  assert.equal(paid.refundPaidAt, "2026-09-20T03:00:00Z");
});

test("runs rework through schedule completion reinspection and closure evidence", () => {
  const scheduled = Cleaning.createCleaningRework({ cleaningOrderId: "cln_1", cleaningCaseId: "clc_1", failedQcReviewId: "clq_1", scope: "욕실 재청소", scheduledAt: "2026-09-22T09:00:00Z", teamName: "직영 1팀" });
  assert.equal(scheduled.status, "scheduled");
  assert.throws(() => Cleaning.transitionCleaningRework(scheduled, "completed", {}), /완료보고/);
  const completed = Cleaning.transitionCleaningRework(scheduled, "completed", { completionReportId: "clr_2" });
  assert.throws(() => Cleaning.transitionCleaningRework(completed, "passed", {}), /재검수/);
  const passed = Cleaning.transitionCleaningRework(completed, "passed", { qcReviewId: "clq_2", qcResult: "passed" });
  const closed = Cleaning.transitionCleaningRework(passed, "closed", { actor: { email: "ops@bring.local" }, at: "2026-09-22T12:00:00Z" });
  assert.equal(closed.closedAt, "2026-09-22T12:00:00Z");
});

test("creates a retention funnel after a completed cleaning order", () => {
  const actions = Cleaning.createCleaningRetentionPlan({ id: "cln_1", customerId: "cus_1", serviceType: "move_in", closedAt: "2026-09-20T00:00:00Z" });
  assert.deepEqual(actions.map(item => item.type), ["review", "building_care", "repeat_referral"]);
  assert.equal(actions[0].dueAt, "2026-09-21T00:00:00.000Z");
  assert.equal(actions[1].dueAt, "2026-09-27T00:00:00.000Z");
  assert.equal(actions[2].dueAt, "2026-10-20T00:00:00.000Z");
  assert.ok(actions.every(item => item.status === "planned"));
});

test("tracks retention conversion without pretending a draft was sent", () => {
  const item = Cleaning.updateCleaningRetentionAction({ id: "ret_1", status: "planned", type: "review" }, "draft", { email: "sales@bring.local" }, "2026-09-21T00:00:00Z");
  assert.equal(item.status, "draft");
  assert.equal(item.sentAt, "");
  assert.equal(Cleaning.updateCleaningRetentionAction(item, "sent", {}, "2026-09-21T01:00:00Z").sentAt, "2026-09-21T01:00:00Z");
});

test("creates a customer completion report only from completion evidence and passed QC", () => {
  const report = Cleaning.createCleaningCustomerReport({
    order: { id: "cln_1", customerId: "cus_1", customerName: "홍길동", serviceType: "move_in", address: "원주시", scope: "욕실·주방", scheduledAt: "2026-09-20T09:00:00Z" },
    completionReport: { id: "clr_1", type: "completion", reportedAt: "2026-09-20T12:00:00Z", photoUrls: ["https://example.com/after-1.jpg"], note: "작업 완료" },
    qcReview: { id: "clq_1", result: "passed", score: 96, reviewedAt: "2026-09-20T12:30:00Z" }
  }, { email: "ops@bring.local" }, "2026-09-20T12:35:00Z");
  assert.equal(report.status, "draft");
  assert.equal(report.qcScore, 96);
  assert.deepEqual(report.photoUrls, ["https://example.com/after-1.jpg"]);
  assert.equal(report.deliveredAt, "");
  assert.throws(() => Cleaning.createCleaningCustomerReport({ order: { id: "cln_1" }, completionReport: { type: "progress" }, qcReview: { result: "passed" } }), /완료보고/);
});

test("marks a customer completion report delivered only by explicit confirmation", () => {
  const delivered = Cleaning.deliverCleaningCustomerReport({ id: "clcr_1", status: "draft", cleaningOrderId: "cln_1", deliveredAt: "" }, { email: "sales@bring.local" }, "2026-09-20T13:00:00Z");
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.deliveredAt, "2026-09-20T13:00:00Z");
});

test("calculates the Seoul-day retention workload without hiding overdue actions", () => {
  const result = Cleaning.calculateCleaningFollowUpDashboard([
    { id: "a1", cleaningOrderId: "o1", type: "review", status: "planned", dueAt: "2026-09-19T12:00:00Z" },
    { id: "a2", cleaningOrderId: "o2", type: "building_care", status: "planned", dueAt: "2026-09-20T03:00:00Z" },
    { id: "a3", cleaningOrderId: "o3", type: "repeat_referral", status: "draft", dueAt: "2026-09-20T04:00:00Z" },
    { id: "a4", cleaningOrderId: "o4", type: "review", status: "sent", dueAt: "2026-09-20T05:00:00Z" },
    { id: "a5", cleaningOrderId: "o5", type: "review", status: "converted", dueAt: "2026-09-18T05:00:00Z" }
  ], "2026-09-20T06:00:00Z");
  assert.equal(result.overdue, 1);
  assert.equal(result.dueToday, 3);
  assert.equal(result.drafts, 1);
  assert.equal(result.awaitingResponse, 1);
  assert.equal(result.converted, 1);
  assert.deepEqual(result.priorityActions.map(item => item.id), ["a1", "a2", "a3", "a4"]);
});

test("raises response deposit and balance alerts from confirmed evidence", () => {
  const alerts = Cleaning.calculateCleaningAlerts({
    orders: [
      { id: "o1", customerName: "신규", stage: "inquiry", inquiryAt: "2026-09-20T00:00:00Z" },
      { id: "o2", customerName: "견적", stage: "quote_sent", updatedAt: "2026-09-19T00:00:00Z", depositAmount: 100000 },
      { id: "o3", customerName: "완료", stage: "customer_completed", updatedAt: "2026-09-20T00:00:00Z", totalAmount: 330000, depositAmount: 100000, balanceAmount: 230000 }
    ],
    payments: [{ cleaningOrderId: "o3", type: "deposit", status: "confirmed", amount: 100000 }]
  }, "2026-09-20T00:06:00Z");
  assert.deepEqual(alerts.map(item => item.type), ["response_overdue", "deposit_overdue", "balance_overdue"]);
  assert.equal(alerts[2].amount, 230000);
});

test("exposes the approved Bring Care v0.1 quick price book", () => {
  assert.equal(Cleaning.CLEANING_PRICE_BOOK.version, "BRING-CARE-PRICE-v0.1");
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "studio", area: 6 }).amount, 149000);
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "studio", area: 18 }).amount, 259000);
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "apartment", area: 24 }).amount, 319000);
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "apartment", area: 32 }).amount, 399000);
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "common_area_monthly4", floors: 6 }).amount, 119000);
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "office_single", hours: 3 }).amount, 89000);
  assert.equal(Cleaning.standardCleaningPrice({ productCode: "studio", area: 19 }).manualQuote, true);
});

test("price book forbids field-decided surcharges and requires preapproval", () => {
  assert.equal(Cleaning.CLEANING_PRICE_BOOK.noOnsiteSurcharge, true);
  assert.equal(Cleaning.CLEANING_PRICE_BOOK.additionalWorkRule, "preapproved_only");
  assert.ok(Cleaning.CLEANING_PRICE_BOOK.includedScopes.includes("화장실"));
  assert.ok(Cleaning.CLEANING_PRICE_BOOK.excludedScopes.includes("폐기물 처리"));
});

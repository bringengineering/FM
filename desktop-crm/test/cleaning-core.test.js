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

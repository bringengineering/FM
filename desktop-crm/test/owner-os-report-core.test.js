const assert = require("node:assert/strict");
const test = require("node:test");

const Owner = require("../src/owner-os-report-core");
const ManagementReportCore = require("../src/management-report-core");

// 8월에 건별 계약 3건. 하나는 미수, 하나는 업체 미지급.
const store = {
  contracts: [
    { id: "c1", billingCycle: "건별", workDate: "2026-08-04", type: "입주청소", owner: "김현진",
      amount: 500000, vendorCost: 300000, collectionStatus: "입금 완료", vendorPaymentStatus: "지급 완료" },
    { id: "c2", billingCycle: "건별", workDate: "2026-08-11", type: "입주청소", owner: "김현진",
      amount: 400000, vendorCost: 250000, collectionStatus: "미입금", vendorPaymentStatus: "지급 완료" },
    { id: "c3", billingCycle: "건별", workDate: "2026-08-20", type: "공용부청소", owner: "박담당",
      amount: 300000, vendorCost: 100000, collectionStatus: "입금 완료", vendorPaymentStatus: "미지급" },
    // 7월 건과 월정액 건은 8월 집계에 들어오면 안 된다.
    { id: "c4", billingCycle: "건별", workDate: "2026-07-30", type: "입주청소", amount: 900000, vendorCost: 100000 },
    { id: "c5", billingCycle: "월정액", workDate: "2026-08-15", type: "건물관리", amount: 150000, vendorCost: 0 },
  ],
  salesActivities: [
    { id: "a1", occurredAt: "2026-08-03", result: "유효 응답", owner: "김현진" },
    { id: "a2", occurredAt: "2026-08-09", result: "부재", owner: "김현진" },
  ],
  salesEvents: [],
  salesOpportunities: [],
  serviceRecords: [
    { id: "s1", scheduledDate: "2026-08-04" },
    { id: "s2", scheduledDate: "2026-08-11" },
  ],
};

const now = "2026-09-05T00:00:00.000Z";

test("봉투의 뼈대가 규격과 같다", () => {
  const envelope = Owner.buildReportEnvelope({ store, month: "2026-08", now });
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.reportType, "monthly");
  assert.deepEqual(envelope.period, { month: "2026-08" });
  assert.equal(envelope.org.companyId, "bring");
  assert.equal(envelope.source.app, "bring-crm-desktop");
  assert.equal(envelope.generatedAt, now);
  for (const key of ["quantitative", "qualitative", "evidence"]) {
    assert.ok(envelope[key], `${key} 칸이 있어야 한다`);
  }
});

test("재무 숫자는 management-report-core 가 낸 것을 그대로 쓴다", () => {
  // 보고용으로 따로 계산하지 않는다는 것을 값 비교로 못 박는다.
  const envelope = Owner.buildReportEnvelope({ store, month: "2026-08", now });
  const direct = ManagementReportCore.buildMonthlyReport(store, "2026-08");
  assert.deepEqual(envelope.quantitative.finance, JSON.parse(JSON.stringify(direct.finance)));
  assert.deepEqual(envelope.quantitative.sales, JSON.parse(JSON.stringify(direct.sales)));

  // 그 값이 실제로 8월 건별 3건만 본 결과인지도 확인한다.
  assert.equal(envelope.quantitative.finance.jobCount, 3);
  assert.equal(envelope.quantitative.finance.revenue, 1_200_000);
  assert.equal(envelope.quantitative.finance.cost, 650_000);
  assert.equal(envelope.quantitative.finance.grossProfit, 550_000);
  assert.equal(envelope.quantitative.finance.receivable, 400_000);
  assert.equal(envelope.quantitative.finance.payable, 100_000);
});

test("근거는 평평한 지도로 같이 나가고 표본 수도 남는다", () => {
  const envelope = Owner.buildReportEnvelope({ store, month: "2026-08", now });
  assert.equal(envelope.evidence.metrics.finance_revenue, 1_200_000);
  assert.equal(envelope.evidence.metrics.sales_contact_count, 2);
  // 0건인 달과 자료가 안 올라온 달을 구분할 수 있어야 한다.
  assert.equal(envelope.evidence.recordCounts.contracts, 5);
  assert.equal(envelope.evidence.recordCounts.serviceRecordsInMonth, 2);

  const empty = Owner.buildReportEnvelope({ store: {}, month: "2026-08", now });
  assert.equal(empty.evidence.recordCounts.contracts, 0);
  assert.equal(empty.quantitative.finance.revenue, 0);
});

test("운영 자료가 없으면 운영 칸을 아예 뺀다", () => {
  // 없는 것을 0 으로 채우면 받는 쪽에서 "문제 없음" 으로 읽힌다.
  const envelope = Owner.buildReportEnvelope({ store, month: "2026-08", now });
  assert.equal("operations" in envelope.quantitative, false);

  const withNone = Owner.buildReportEnvelope({ store, operations: [], month: "2026-08", now });
  assert.equal("operations" in withNone.quantitative, false);
});

test("표본 3건 미만 그룹은 병목 순위로 내보내지 않는다", () => {
  // 2건짜리 평균은 순위가 아니라 우연이다.
  const makeOp = (id, category, minutes) => ({
    id, status: "completed", category, subcategory: "기타",
    createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T02:00:00.000Z",
    directMinutes: minutes,
  });
  const operations = [
    makeOp("o1", "누수", 60), makeOp("o2", "누수", 90), makeOp("o3", "누수", 120), makeOp("o4", "누수", 80),
    makeOp("o5", "도어락", 200), makeOp("o6", "도어락", 240), // 2건뿐
  ];
  const envelope = Owner.buildReportEnvelope({ store, operations, month: "2026-09", now });
  const ops = envelope.quantitative.operations;
  assert.ok(ops, "운영 자료가 있으면 운영 칸이 나온다");
  const keys = ops.topBottlenecks.map(group => group.key);
  assert.ok(keys.some(key => key.startsWith("누수")), "4건짜리는 나온다");
  assert.ok(!keys.some(key => key.startsWith("도어락")), "2건짜리는 빠진다");
  assert.ok(ops.topBottlenecks.every(group => group.sampleSize >= Owner.RANKABLE_MIN_SAMPLE));
  // 몇 건을 보고 고른 순위인지는 남긴다.
  assert.equal(typeof ops.bottleneckSampleSize, "number");
});

test("확인한 사람이 없으면 확인 시각도 남기지 않는다", () => {
  // 시각만 있고 사람이 없으면 누가 봤는지 모르는 채로 확인된 것처럼 보인다.
  const envelope = Owner.buildReportEnvelope({
    store, month: "2026-08", now,
    qualitative: { summary: "AI 초안", draftedBy: "ai", confirmedAt: "2026-09-01T00:00:00.000Z" },
  });
  assert.equal(envelope.qualitative.authoring.draftedBy, "ai");
  assert.equal(envelope.qualitative.authoring.confirmedBy, "");
  assert.equal(envelope.qualitative.authoring.confirmedAt, "");
});

test("사람이 확인하면 이름과 시각이 함께 남는다", () => {
  const envelope = Owner.buildReportEnvelope({
    store, month: "2026-08", now,
    qualitative: {
      summary: "8월은 입주청소가 대부분이었습니다.",
      draftedBy: "ai",
      confirmedBy: "김현진",
      confirmedAt: "2026-09-01T09:00:00.000Z",
      issues: [{ title: "미수금 40만원", detail: "c2 건", metricRefs: ["finance_receivable"] }],
      nextActions: [{ title: "c2 입금 확인", owner: "김현진", dueDate: "2026-09-10" }],
    },
  });
  assert.equal(envelope.qualitative.authoring.confirmedBy, "김현진");
  assert.equal(envelope.qualitative.authoring.confirmedAt, "2026-09-01T09:00:00.000Z");
  assert.equal(envelope.qualitative.issues[0].metricRefs[0], "finance_receivable");
  assert.equal(envelope.qualitative.nextActions[0].dueDate, "2026-09-10");
});

test("총평을 CRM 이 임의로 지어내지 않는다", () => {
  // 아무것도 안 주면 빈 칸으로 나가야 한다. 여기서 문장을 만들어 넣으면
  // 확인 안 된 말이 대표 평가에 들어간다.
  const envelope = Owner.buildReportEnvelope({ store, month: "2026-08", now });
  assert.equal(envelope.qualitative.summary, "");
  assert.deepEqual(envelope.qualitative.issues, []);
  assert.deepEqual(envelope.qualitative.nextActions, []);
  assert.equal(envelope.qualitative.authoring.draftedBy, "");
});

test("이상한 값은 걸러 내보낸다", () => {
  const envelope = Owner.buildReportEnvelope({
    store, month: "2026-08", now,
    qualitative: {
      draftedBy: "관리자",
      issues: [{ title: "" }, { title: "  진짜 항목  ", metricRefs: ["ok", "", 5] }],
      nextActions: [{ title: "기한 형식 틀림", dueDate: "2026/09/10" }],
    },
  });
  assert.equal(envelope.qualitative.authoring.draftedBy, "", "ai/human 이 아니면 비운다");
  assert.equal(envelope.qualitative.issues.length, 1, "제목 없는 항목은 버린다");
  assert.equal(envelope.qualitative.issues[0].title, "진짜 항목");
  assert.deepEqual(envelope.qualitative.issues[0].metricRefs, ["ok"]);
  assert.equal(envelope.qualitative.nextActions[0].dueDate, "", "YYYY-MM-DD 가 아니면 비운다");
});

test("월을 안 주면 지난달을 본다", () => {
  assert.equal(Owner.previousMonthOf(new Date("2026-09-05T00:00:00.000Z")), "2026-08");
  assert.equal(Owner.previousMonthOf(new Date("2026-01-15T00:00:00.000Z")), "2025-12");
  const envelope = Owner.buildReportEnvelope({ store, now });
  assert.equal(envelope.period.month, "2026-08");
  // 형식이 틀린 월도 지난달로 떨어뜨린다.
  assert.equal(Owner.buildReportEnvelope({ store, month: "2026-8", now }).period.month, "2026-08");
});

test("봉투는 JSON 으로 그대로 나간다", () => {
  // 코어들이 얼려서 돌려주는 값이 섞여도 직렬화가 깨지지 않아야 한다.
  const envelope = Owner.buildReportEnvelope({ store, month: "2026-08", now });
  const roundTrip = JSON.parse(JSON.stringify(envelope));
  assert.deepEqual(roundTrip, envelope);
  assert.ok(!Object.isFrozen(envelope.quantitative.finance), "보내기 전에 손댈 수 있어야 한다");
});

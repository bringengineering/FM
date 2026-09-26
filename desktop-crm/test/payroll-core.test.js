const assert = require("node:assert/strict");
const test = require("node:test");

const P = require("../src/payroll-core");

const base = { userId: "u1", month: "2026-09", payDate: "2026-09-25", basePay: 2400000 };

test("법정 기재사항이 없으면 명세서가 아니다", () => {
  assert.equal(P.validateRecord({ ...base, payDate: "" }).code, "PAY_DATE_REQUIRED");
  assert.equal(P.validateRecord({ ...base, month: "2026-9" }).code, "MONTH_REQUIRED");
  assert.equal(P.validateRecord({ ...base, userId: "" }).code, "USER_REQUIRED");
  assert.equal(P.validateRecord({ ...base, basePay: 0 }).code, "GROSS_REQUIRED");
});

test("연장·야간·휴일 수당에는 계산방법을 적어야 한다", () => {
  // 근로기준법 48조 2항의 법정 기재사항이다.
  for (const key of ["overtimePay", "nightPay", "holidayPay"]) {
    assert.equal(P.validateRecord({ ...base, [key]: 200000 }).code, "CALC_NOTE_REQUIRED", key);
    assert.equal(P.validateRecord({ ...base, [key]: 200000, calcNote: "통상시급 × 1.5 × 10시간" }).ok, true, key);
  }
  // 기본급·상여만 있으면 계산방법이 없어도 된다.
  assert.equal(P.validateRecord({ ...base, bonus: 500000 }).ok, true);
});

test("합계는 CRM 이 스스로 낸다", () => {
  // 화면이 보낸 합계를 그대로 믿지 않는다. 믿으면 앞뒤 안 맞는 명세서가 나간다.
  const record = P.normalizeRecord({ ...base, overtimePay: 100000, nationalPension: 108000, incomeTax: 30000, grossPay: 999, netPay: 999 });
  assert.equal(record.grossPay, 2500000);
  assert.equal(record.totalDeduction, 138000);
  assert.equal(record.netPay, 2362000);
});

test("공제가 지급보다 많으면 거부한다", () => {
  assert.equal(P.validateRecord({ ...base, nationalPension: 3000000 }).code, "NET_NEGATIVE");
});

test("금액은 원 단위 정수만 받는다", () => {
  assert.equal(P.validateRecord({ ...base, basePay: "2,400,000" }).record.basePay, 2400000);
  assert.equal(P.validateRecord({ ...base, basePay: 2400000.5 }).code, "AMOUNT_INVALID");
  assert.equal(P.validateRecord({ ...base, incomeTax: -100 }).code, "AMOUNT_INVALID");
  assert.equal(P.validateRecord({ ...base, basePay: "240만원" }).code, "AMOUNT_INVALID");
});

test("교부한 명세서는 못 고친다", () => {
  // 이미 준 명세서가 나중에 바뀌면 교부한 의미가 없다.
  assert.equal(P.canEdit(null), true);
  assert.equal(P.canEdit({ ...base, status: "draft" }), true);
  assert.equal(P.canEdit({ ...base, status: "issued" }), false);
});

test("교부에는 교부한 사람이 있어야 한다", () => {
  assert.equal(P.validateRecord({ ...base, status: "issued" }).code, "ISSUER_REQUIRED");
  assert.equal(P.validateRecord({ ...base, status: "issued", issuedBy: "김현진" }).ok, true);
});

test("내용이 바뀌었는지 알아본다", () => {
  const before = { ...base, overtimePay: 100000, calcNote: "x" };
  assert.equal(P.sameContent(before, { ...before, note: "메모만 바꿈" }), true);
  assert.equal(P.sameContent(before, { ...before, basePay: 2500000 }), false);
  assert.equal(P.sameContent(before, { ...before, incomeTax: 1 }), false);
  assert.equal(P.sameContent(before, { ...before, payDate: "2026-09-26" }), false);
});

test("0원 항목은 명세서에 내지 않는다", () => {
  // 안 준 수당을 줄줄이 늘어놓으면 정작 받은 항목이 안 보인다.
  const parts = P.lines({ ...base, allowance: 100000 });
  assert.deepEqual(parts.earnings.map(item => item.key), ["basePay", "allowance"]);
  assert.deepEqual(parts.deductions, []);
});

test("회사 합계는 그 달 것만 센다", () => {
  const rows = [
    { ...base, userId: "a", status: "issued", issuedBy: "김" },
    { ...base, userId: "b", basePay: 2000000 },
    { ...base, userId: "c", month: "2026-08" },
  ];
  const summary = P.summarize(rows, "2026-09");
  assert.equal(summary.count, 2);
  assert.equal(summary.issuedCount, 1);
  assert.equal(summary.grossPay, 4400000);
});

test("본인 명세서는 최근 달부터 준다", () => {
  const rows = [{ ...base, month: "2026-07" }, { ...base, month: "2026-09" }, { userId: "u2", month: "2026-09" }];
  assert.deepEqual(P.forUser(rows, "u1").map(item => item.month), ["2026-09", "2026-07"]);
});

test("모르는 칸과 상태는 조용히 버린다", () => {
  const record = P.normalizeRecord({ ...base, status: "paid", accountNumber: "110-1234", residentNumber: "900101-1234567" });
  assert.equal(record.status, "draft");
  assert.ok(!("accountNumber" in record));
  assert.ok(!("residentNumber" in record));
});

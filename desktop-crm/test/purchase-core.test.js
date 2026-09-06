const assert = require("node:assert/strict");
const test = require("node:test");

const P = require("../src/purchase-core");

const base = { id: "p1", tradeDate: "2026-09-01", vendor: "세정산업", title: "세제", supplyAmount: 100000 };

test("거래일·거래처·항목·공급가가 없으면 잡지 않는다", () => {
  assert.equal(P.validateRecord({ ...base, tradeDate: "" }).code, "DATE_REQUIRED");
  assert.equal(P.validateRecord({ ...base, vendor: "" }).code, "VENDOR_REQUIRED");
  assert.equal(P.validateRecord({ ...base, title: "" }).code, "TITLE_REQUIRED");
  assert.equal(P.validateRecord({ ...base, supplyAmount: 0 }).code, "SUPPLY_REQUIRED");
});

test("금액은 원 단위 정수만 받는다", () => {
  assert.equal(P.validateRecord({ ...base, supplyAmount: "100,000" }).record.supplyAmount, 100000);
  assert.equal(P.validateRecord({ ...base, supplyAmount: "10만원" }).code, "AMOUNT_INVALID");
  assert.equal(P.validateRecord({ ...base, supplyAmount: 1000.5 }).code, "AMOUNT_INVALID");
  assert.equal(P.validateRecord({ ...base, taxAmount: -100 }).code, "AMOUNT_INVALID");
});

test("지급완료로 두려면 지급일이 있어야 한다", () => {
  // 없으면 잔고를 맞출 수 없다.
  assert.equal(P.validateRecord({ ...base, payState: "paid" }).code, "PAID_DATE_REQUIRED");
  assert.equal(P.validateRecord({ ...base, payState: "paid", paidDate: "2026-09-10" }).ok, true);
  assert.equal(P.validateRecord({ ...base, payState: "paid", paidDate: "2026-08-01" }).code, "PAID_BEFORE_TRADE");
});

test("세금계산서 상태와 세액이 어긋나면 막는다", () => {
  // 그대로 두면 매입세액 합계가 부풀어 신고가 틀어진다.
  assert.equal(P.validateRecord({ ...base, taxState: "none", taxAmount: 10000 }).code, "TAX_WITHOUT_INVOICE");
  assert.equal(P.validateRecord({ ...base, taxState: "received" }).code, "INVOICE_DATE_REQUIRED");
  assert.equal(P.validateRecord({ ...base, taxState: "none", taxAmount: 0 }).ok, true);
});

test("공제 가능 매입세액은 계산서를 받은 것만 센다", () => {
  // 못 받은 것은 공제받을 수 없다. 다 세면 신고가 틀어진다.
  const rows = [
    { ...base, id: "a", taxAmount: 10000, taxState: "received", taxInvoiceDate: "2026-09-01" },
    { ...base, id: "b", taxAmount: 5000, taxState: "pending" },
    { ...base, id: "c", taxAmount: 0, taxState: "none" },
  ];
  const summary = P.summarize(rows, "2026-09");
  assert.equal(summary.count, 3);
  assert.equal(summary.taxAmount, 15000);
  assert.equal(summary.deductibleTaxAmount, 10000);
  assert.equal(summary.supplyAmount, 300000);
  assert.equal(summary.totalAmount, 315000);
});

test("다른 달 매입은 합계에 섞이지 않는다", () => {
  const rows = [{ ...base, id: "a" }, { ...base, id: "b", tradeDate: "2026-08-31" }];
  assert.equal(P.summarize(rows, "2026-09").count, 1);
  assert.equal(P.summarize(rows, "2026-08").count, 1);
});

test("미지급 합계는 안 나간 돈만 센다", () => {
  const rows = [
    { ...base, id: "a", payState: "unpaid", taxAmount: 10000 },
    { ...base, id: "b", payState: "paid", paidDate: "2026-09-05", taxAmount: 10000 },
  ];
  assert.equal(P.summarize(rows, "2026-09").unpaidAmount, 110000);
});

test("미지급과 계산서 미수취를 갈라 준다", () => {
  // 앞은 돈이 나가야 하는 것이고, 뒤는 공제를 못 받는 것이다.
  const rows = [
    { ...base, id: "a", payState: "unpaid", tradeDate: "2026-08-01", taxState: "received", taxInvoiceDate: "2026-08-01" },
    { ...base, id: "b", payState: "paid", paidDate: "2026-09-02", taxState: "pending" },
    { ...base, id: "c", payState: "paid", paidDate: "2026-09-02", taxState: "none" },
  ];
  const care = P.attention(rows, "2026-09-06");
  assert.deepEqual(care.unpaid.map(item => item.id), ["a"]);
  assert.equal(care.unpaid[0].agedDays, 36);
  // "해당없음" 은 영영 안 나오는 것이라 독촉 목록에 쌓지 않는다.
  assert.deepEqual(care.missingInvoice.map(item => item.id), ["b"]);
});

test("오래 밀린 미지급이 먼저 온다", () => {
  const rows = [
    { ...base, id: "new", payState: "unpaid", tradeDate: "2026-09-05" },
    { ...base, id: "old", payState: "unpaid", tradeDate: "2026-06-01" },
  ];
  assert.deepEqual(P.attention(rows, "2026-09-06").unpaid.map(item => item.id), ["old", "new"]);
});

test("모르는 칸과 상태는 조용히 버린다", () => {
  const record = P.normalizeRecord({ ...base, payState: "later", taxState: "maybe", secret: "x" });
  assert.equal(record.payState, "unpaid");
  assert.equal(record.taxState, "pending");
  assert.ok(!("secret" in record));
});

test("월 목록은 최근부터 준다", () => {
  const rows = [{ ...base, id: "a", tradeDate: "2026-07-01" }, { ...base, id: "b", tradeDate: "2026-09-01" }];
  assert.deepEqual(P.months(rows), ["2026-09", "2026-07"]);
});

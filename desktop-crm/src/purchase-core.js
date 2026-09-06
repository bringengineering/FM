// 매입·지급. 회사에서 나간 돈을 잡는다.
//
// 이건 **대표만 보는 화면**이다. 매출은 팀원도 보지만 매입은 아니다. 원가와
// 이익률이 드러나기 때문이다. 그래서 규칙에서 관리자만 읽고 쓰게 막았고,
// 사이드바 칸도 관리자가 아니면 아예 안 나온다.
//
// 여기서 제일 조심한 것
//
// **"승인" 과 "지급" 을 섞지 않는다.** 결재는 "써도 된다" 이고 여기는
// "나갔다" 이다. 둘을 한 칸에 두면, 승인만 받고 아직 안 나간 돈이 이미 나간
// 돈으로 잡혀서 잔고가 안 맞는다. 결재 번호는 참고로 적을 뿐 자동으로
// 넘어오지 않는다.
//
// **부가세를 CRM 이 계산해 주지 않는다.** 면세·영세율·불공제 매입이 섞여
// 있고, 어느 쪽인지는 세금계산서를 봐야 안다. 그래서 공급가와 세액을 각각
// 적게 하고, 합계만 더한다. 틀린 세액을 자신 있게 보여주는 것이 아무것도
// 안 보여주는 것보다 나쁘다 — 그 숫자로 신고하게 된다.
//
// 하지 않는 것
//
// 1. 부가세를 신고하지 않는다. 신고 근거가 될 합계를 낼 뿐이다.
// 2. 계좌에서 돈을 빼지 않는다. 지급했다고 적는 것뿐이다.
// 3. 감가상각·재고를 다루지 않는다.
// 4. 손익을 단정하지 않는다. 매출은 다른 곳에 있고, 여기 매입만으로는
//    이익이 나오지 않는다.
(function attachPurchaseCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringPurchaseCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createPurchaseCore() {
  "use strict";

  const text = (value, limit = 200) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const isDate = value => DATE.test(text(value, 10)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

  // 세금계산서 상태. "안 받았다" 와 "받을 것이 없다" 는 다르다. 간이과세
  // 업체나 개인에게 산 것은 영영 안 나오는데, 그것까지 미수취로 쌓아 두면
  // 목록이 쓸모없어진다.
  const TAX_STATES = Object.freeze([
    { key: "pending", label: "미수취", chase: true },
    { key: "received", label: "수취", chase: false },
    { key: "none", label: "해당없음", chase: false },
  ]);

  const PAY_STATES = Object.freeze([
    { key: "unpaid", label: "미지급", owing: true },
    { key: "paid", label: "지급완료", owing: false },
  ]);

  const taxStateOf = key => TAX_STATES.find(item => item.key === text(key, 20)) || null;
  const payStateOf = key => PAY_STATES.find(item => item.key === text(key, 20)) || null;

  // 금액은 원 단위 정수만. 소수점이 붙은 원화는 없고, 실수로 두면 나중에
  // 합계가 안 맞는 이유를 찾느라 하루를 쓴다.
  function normalizeAmount(value) {
    if (value === "" || value == null) return 0;
    const number = Number(String(value).replace(/[,\s원]/g, ""));
    if (!Number.isFinite(number) || number < 0 || Math.round(number) !== number) return -1;
    return number;
  }

  function normalizeRecord(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const supply = normalizeAmount(source.supplyAmount);
    const tax = normalizeAmount(source.taxAmount);
    return {
      id: text(source.id, 80),
      tradeDate: isDate(source.tradeDate) ? text(source.tradeDate, 10) : "",
      vendor: text(source.vendor, 120),
      title: text(source.title, 120),
      supplyAmount: supply < 0 ? 0 : supply,
      taxAmount: tax < 0 ? 0 : tax,
      taxState: taxStateOf(source.taxState) ? text(source.taxState, 20) : "pending",
      taxInvoiceDate: isDate(source.taxInvoiceDate) ? text(source.taxInvoiceDate, 10) : "",
      payState: payStateOf(source.payState) ? text(source.payState, 20) : "unpaid",
      paidDate: isDate(source.paidDate) ? text(source.paidDate, 10) : "",
      buildingId: text(source.buildingId, 80),
      approvalId: text(source.approvalId, 80),
      note: text(source.note, 500),
      createdAt: text(source.createdAt, 40),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
  }

  const total = record => normalizeRecord(record).supplyAmount + normalizeRecord(record).taxAmount;

  function validateRecord(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const record = normalizeRecord(source);
    if (!record.id) return { ok: false, code: "ID_REQUIRED", error: "매입 번호가 없습니다." };
    if (!record.tradeDate) return { ok: false, code: "DATE_REQUIRED", error: "거래일을 적어 주세요." };
    if (!record.vendor) return { ok: false, code: "VENDOR_REQUIRED", error: "거래처를 적어 주세요." };
    if (!record.title) return { ok: false, code: "TITLE_REQUIRED", error: "무엇을 샀는지 적어 주세요." };
    if (normalizeAmount(source.supplyAmount) < 0 || normalizeAmount(source.taxAmount) < 0) {
      return { ok: false, code: "AMOUNT_INVALID", error: "금액은 0 이상의 원 단위 숫자로 적어 주세요." };
    }
    if (record.supplyAmount <= 0) {
      return { ok: false, code: "SUPPLY_REQUIRED", error: "공급가를 적어 주세요." };
    }
    // 지급했다면 언제 나갔는지가 있어야 한다. 없으면 잔고를 맞출 수 없다.
    if (record.payState === "paid" && !record.paidDate) {
      return { ok: false, code: "PAID_DATE_REQUIRED", error: "지급완료로 두려면 지급일을 적어 주세요." };
    }
    if (record.paidDate && record.paidDate < record.tradeDate) {
      return { ok: false, code: "PAID_BEFORE_TRADE", error: "지급일이 거래일보다 앞섭니다." };
    }
    if (record.taxState === "received" && !record.taxInvoiceDate) {
      return { ok: false, code: "INVOICE_DATE_REQUIRED", error: "세금계산서를 받았다면 발행일을 적어 주세요." };
    }
    // 해당없음인데 세액이 있으면 둘 중 하나가 틀린 것이다. 그대로 두면
    // 매입세액 합계가 부풀어 신고가 틀어진다.
    if (record.taxState === "none" && record.taxAmount > 0) {
      return { ok: false, code: "TAX_WITHOUT_INVOICE", error: "세금계산서가 해당없음인데 세액이 있습니다. 둘 중 하나를 고쳐 주세요." };
    }
    return { ok: true, record };
  }

  const inMonth = (value, month) => text(month, 7).length === 7 && text(value, 10).slice(0, 7) === text(month, 7);

  // 한 달치 요약. 합계는 여기서만 낸다 — 화면 여러 곳에서 각자 더하면
  // 어느 쪽이 맞는지 알 수 없게 된다.
  function summarize(records, month) {
    const list = rows(records).map(normalizeRecord).filter(item => item.id && inMonth(item.tradeDate, month));
    const sum = (pick) => list.reduce((acc, item) => acc + pick(item), 0);
    // 매입세액은 세금계산서를 받은 것만 센다. 못 받은 것은 공제받을 수 없다.
    const deductible = list.filter(item => item.taxState === "received");
    return {
      month: text(month, 7),
      count: list.length,
      supplyAmount: sum(item => item.supplyAmount),
      taxAmount: sum(item => item.taxAmount),
      totalAmount: sum(item => item.supplyAmount + item.taxAmount),
      deductibleTaxAmount: deductible.reduce((acc, item) => acc + item.taxAmount, 0),
      unpaidAmount: list.filter(item => item.payState === "unpaid")
        .reduce((acc, item) => acc + item.supplyAmount + item.taxAmount, 0),
    };
  }

  // 지금 손봐야 할 것. 미지급과 세금계산서 미수취는 성격이 다르다 — 앞은
  // 돈이 나가야 하는 것이고, 뒤는 공제를 못 받는 것이다.
  function attention(records, asOf) {
    const today = isDate(asOf) ? text(asOf, 10) : "";
    const list = rows(records).map(normalizeRecord).filter(item => item.id);
    const overdueDays = value => {
      if (!today || !isDate(value)) return 0;
      return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / 86400000);
    };
    return {
      unpaid: list.filter(item => item.payState === "unpaid")
        .map(item => Object.assign({}, item, { agedDays: overdueDays(item.tradeDate) }))
        .sort((a, b) => b.agedDays - a.agedDays),
      missingInvoice: list.filter(item => (taxStateOf(item.taxState) || {}).chase === true)
        .sort((a, b) => String(a.tradeDate).localeCompare(String(b.tradeDate))),
    };
  }

  function months(records) {
    const set = new Set(rows(records).map(normalizeRecord)
      .map(item => text(item.tradeDate, 10).slice(0, 7)).filter(value => value.length === 7));
    return [...set].sort().reverse();
  }

  return Object.freeze({
    TAX_STATES,
    PAY_STATES,
    taxStateOf,
    payStateOf,
    normalizeAmount,
    normalizeRecord,
    validateRecord,
    summarize,
    attention,
    months,
    total,
    isDate,
    text,
    rows,
  });
});

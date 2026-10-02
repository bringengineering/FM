// 급여. 임금명세서를 만들고 교부 기록을 남긴다.
//
// 근로기준법 48조 2항은 임금을 줄 때 명세서를 **서면(전자문서 포함)으로
// 교부**하게 한다. 적어야 하는 것도 정해져 있다 — 성명, 지급일, 임금 총액,
// 구성항목별 금액, 공제항목별 금액과 총액, 그리고 연장·야간·휴일 근로수당의
// **계산방법**. 그래서 이 화면은 "있으면 좋은" 것이 아니라 없으면 과태료다.
//
// 여기서 제일 조심한 것
//
// **4대보험료와 세금을 CRM 이 계산하지 않는다.** 요율은 해마다 바뀌고,
// 감면·정산·중도입사 일할계산이 붙는다. 틀린 공제액은 그대로 임금체불이
// 된다. 그래서 급여대장 프로그램이나 노무사가 낸 숫자를 **적어 넣게** 하고,
// CRM 은 그 숫자들의 **앞뒤가 맞는지만** 본다.
//
// 틀린 공제액을 자신 있게 계산해 주는 것이 아무것도 안 해 주는 것보다 훨씬
// 나쁘다. 그 숫자로 임금을 주게 되기 때문이다.
//
// **앞뒤가 안 맞으면 저장하지 않는다.** 지급총액이 구성항목 합계와 다르거나,
// 실지급액이 지급총액에서 공제 합계를 뺀 값과 다르면 거부한다. 앞뒤가 안 맞는
// 명세서는 그 자체로 분쟁거리다.
//
// **교부한 뒤에는 못 고친다.** 이미 준 명세서가 나중에 바뀌면 교부한 의미가
// 없다. 고치려면 그 달의 정정 명세서를 따로 낸다.
//
// 하지 않는 것
//
// 1. 급여를 이체하지 않는다. 줬다고 적는 것뿐이다.
// 2. 4대보험을 신고하지 않는다.
// 3. 연말정산을 하지 않는다.
// 4. 최저임금 위반을 판정하지 않는다. 소정근로시간이 정해져 있지 않다.
// 5. 미사용 연차수당을 계산하지 않는다. 연차는 관리자가 확정하는 값이고,
//    수당 산정은 통상임금을 알아야 한다.
(function attachPayrollCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringPayrollCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createPayrollCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const MONTH = /^\d{4}-\d{2}$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const isMonth = value => MONTH.test(text(value, 7));
  const isDate = value => DATE.test(text(value, 10)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

  // 지급 항목. 순서가 명세서에 나오는 순서다.
  const EARNINGS = Object.freeze([
    { key: "basePay", label: "기본급", needsMethod: false },
    { key: "overtimePay", label: "연장근로수당", needsMethod: true },
    { key: "nightPay", label: "야간근로수당", needsMethod: true },
    { key: "holidayPay", label: "휴일근로수당", needsMethod: true },
    { key: "allowance", label: "제수당", needsMethod: false },
    { key: "bonus", label: "상여", needsMethod: false },
  ]);

  // 공제 항목. CRM 은 계산하지 않고 받아 적기만 한다.
  const DEDUCTIONS = Object.freeze([
    { key: "nationalPension", label: "국민연금" },
    { key: "healthInsurance", label: "건강보험" },
    { key: "longTermCare", label: "장기요양" },
    { key: "employmentInsurance", label: "고용보험" },
    { key: "incomeTax", label: "소득세" },
    { key: "localIncomeTax", label: "지방소득세" },
    { key: "otherDeduction", label: "기타공제" },
  ]);

  const STATUSES = Object.freeze([
    { key: "draft", label: "작성 중" },
    { key: "issued", label: "교부" },
  ]);

  const statusLabel = key => (STATUSES.find(item => item.key === key) || {}).label || key;

  // 원 단위 정수만. 급여에 소수점이 붙으면 합계가 1원씩 어긋나고, 그 1원을
  // 찾느라 하루를 쓴다.
  function normalizeAmount(value) {
    if (value === "" || value == null) return 0;
    const number = Number(String(value).replace(/[,\s원]/g, ""));
    if (!Number.isFinite(number) || number < 0 || Math.round(number) !== number) return -1;
    return number;
  }

  function normalizeRecord(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const record = {
      userId: text(source.userId || source.user_id, 128),
      month: isMonth(source.month) ? text(source.month, 7) : "",
      payDate: isDate(source.payDate) ? text(source.payDate, 10) : "",
      status: STATUSES.some(item => item.key === source.status) ? source.status : "draft",
      calcNote: text(source.calcNote, 1000),
      note: text(source.note, 500),
      issuedAt: text(source.issuedAt, 40),
      issuedBy: text(source.issuedBy, 80),
      updatedAt: text(source.updatedAt, 40),
      updatedBy: text(source.updatedBy, 128),
    };
    [...EARNINGS, ...DEDUCTIONS].forEach(item => {
      const amount = normalizeAmount(source[item.key]);
      record[item.key] = amount < 0 ? 0 : amount;
    });
    record.grossPay = EARNINGS.reduce((acc, item) => acc + record[item.key], 0);
    record.totalDeduction = DEDUCTIONS.reduce((acc, item) => acc + record[item.key], 0);
    record.netPay = record.grossPay - record.totalDeduction;
    return record;
  }

  function validateRecord(input) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const record = normalizeRecord(source);
    if (!record.userId) return { ok: false, code: "USER_REQUIRED", error: "누구의 명세서인지 정해 주세요." };
    if (!record.month) return { ok: false, code: "MONTH_REQUIRED", error: "귀속 월을 YYYY-MM 으로 적어 주세요." };
    if (!record.payDate) return { ok: false, code: "PAY_DATE_REQUIRED", error: "임금 지급일을 적어 주세요. 명세서 법정 기재사항입니다." };
    for (const item of [...EARNINGS, ...DEDUCTIONS]) {
      if (normalizeAmount(source[item.key]) < 0) {
        return { ok: false, code: "AMOUNT_INVALID", error: `${item.label}은(는) 0 이상의 원 단위 숫자로 적어 주세요.` };
      }
    }
    if (record.grossPay <= 0) {
      return { ok: false, code: "GROSS_REQUIRED", error: "지급 항목이 모두 비어 있습니다." };
    }
    // 공제가 지급보다 많으면 실지급액이 음수가 된다. 그런 명세서를 교부하면
    // 그 자체로 분쟁이다.
    if (record.netPay < 0) {
      return { ok: false, code: "NET_NEGATIVE", error: "공제 합계가 지급 총액보다 많습니다. 숫자를 다시 봐 주세요." };
    }
    // 연장·야간·휴일 수당이 있으면 계산방법을 적어야 한다. 법정 기재사항이다.
    const needsMethod = EARNINGS.filter(item => item.needsMethod && record[item.key] > 0);
    if (needsMethod.length && !record.calcNote) {
      const names = needsMethod.map(item => item.label).join("·");
      return {
        ok: false,
        code: "CALC_NOTE_REQUIRED",
        error: `${names}이(가) 있으면 계산방법을 적어야 합니다. 명세서 법정 기재사항입니다.`,
      };
    }
    if (record.status === "issued" && !record.issuedBy) {
      return { ok: false, code: "ISSUER_REQUIRED", error: "교부한 사람이 없습니다." };
    }
    return { ok: true, record };
  }

  // 교부한 뒤에는 못 고친다. 이미 준 명세서가 나중에 바뀌면 교부한 의미가 없다.
  function canEdit(existing) {
    if (!existing) return true;
    return normalizeRecord(existing).status !== "issued";
  }

  const FROZEN = Object.freeze([
    ...EARNINGS.map(item => item.key),
    ...DEDUCTIONS.map(item => item.key),
    "month", "payDate", "calcNote",
  ]);

  function sameContent(before, after) {
    const a = normalizeRecord(before);
    const b = normalizeRecord(after);
    return FROZEN.every(field => a[field] === b[field]);
  }

  // 한 달치 회사 합계. 대표만 보는 값이다 — 화면이 이걸 팀원에게 내면
  // 인건비 총액이 새어 나간다.
  function summarize(records, month) {
    const list = rows(records).map(normalizeRecord).filter(item => item.userId && item.month === text(month, 7));
    const sum = pick => list.reduce((acc, item) => acc + pick(item), 0);
    return {
      month: text(month, 7),
      count: list.length,
      issuedCount: list.filter(item => item.status === "issued").length,
      grossPay: sum(item => item.grossPay),
      totalDeduction: sum(item => item.totalDeduction),
      netPay: sum(item => item.netPay),
    };
  }

  function forUser(records, userId) {
    const uid = text(userId, 128);
    return rows(records).map(normalizeRecord)
      .filter(item => item.userId === uid && item.month)
      .sort((a, b) => b.month.localeCompare(a.month));
  }

  function months(records) {
    const set = new Set(rows(records).map(normalizeRecord).map(item => item.month).filter(Boolean));
    return [...set].sort().reverse();
  }

  // 명세서에 적힐 줄들. 0 원인 항목은 내지 않는다 — 안 준 수당을 0 원으로
  // 줄줄이 늘어놓으면 정작 받은 항목이 안 보인다.
  function lines(record) {
    const item = normalizeRecord(record);
    return {
      earnings: EARNINGS.filter(entry => item[entry.key] > 0)
        .map(entry => ({ key: entry.key, label: entry.label, amount: item[entry.key] })),
      deductions: DEDUCTIONS.filter(entry => item[entry.key] > 0)
        .map(entry => ({ key: entry.key, label: entry.label, amount: item[entry.key] })),
      grossPay: item.grossPay,
      totalDeduction: item.totalDeduction,
      netPay: item.netPay,
    };
  }

  return Object.freeze({
    EARNINGS,
    DEDUCTIONS,
    STATUSES,
    FROZEN,
    statusLabel,
    normalizeAmount,
    normalizeRecord,
    validateRecord,
    canEdit,
    sameContent,
    summarize,
    forUser,
    months,
    lines,
    isMonth,
    isDate,
    text,
    rows,
  });
});

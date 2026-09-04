const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../src/core");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
}

test("one-off contract computes profit and projects into its due month", () => {
  const item = Core.normalizeContract({
    id: "ctr_once", billingCycle: "건별", amount: 150000, vendorCost: 140000,
    grossProfit: 999999, workDate: "2026-08-15", paymentDueDate: "2026-08-15",
    collectionStatus: "입금 완료", vendorPaymentStatus: "지급 완료", buildingId: "b1"
  });
  assert.equal(item.grossProfit, 10000);
  assert.equal(item.vendorCost, 140000);
  assert.equal(Core.oneOffContractRows([item], "2026-08", "all")[0].dueDate, "2026-08-15");
  assert.equal(Core.oneOffContractRows([item], "2026-09", "all").length, 0);
  assert.equal(Core.oneOffContractTotals([item]).profit, 10000);
});

test("one-off contract calendar supports building filters and excludes recurring contracts", () => {
  const contracts = [
    Core.normalizeContract({ id: "a", billingCycle: "건별", amount: 35000, vendorCost: 32000, paymentDueDate: "2026-08-27", buildingId: "b1" }),
    Core.normalizeContract({ id: "b", billingCycle: "건별", amount: 50000, vendorCost: 10000, paymentDueDate: "2026-08-28", buildingId: "b2" }),
    Core.normalizeContract({ id: "c", billingCycle: "월 정기", amount: 60000, startDate: "2026-08-01", buildingId: "b1" })
  ];
  assert.deepEqual(Core.oneOffContractRows(contracts, "2026-08", "b1").map(row => row.contract.id), ["a"]);
  assert.deepEqual(Core.oneOffContractTotals(contracts), { revenue: 85000, cost: 42000, profit: 43000, count: 2 });
});

test("customer editor exposes one visible private notes field under the request", () => {
  const editor = functionSource("customerEditor");
  assert.match(editor, /현재 어떤 요청이 있나요\?[\s\S]{0,300}개인 메모·고객 특징/);
  assert.equal((editor.match(/areaField\("개인 메모·고객 특징"/g) || []).length, 1);
  assert.doesNotMatch(editor, /areaField\("고객 메모"/);
  assert.match(source, /notes:\s*raw\.notes\.trim\(\)/);
});

test("unified contract tab owns the one-off workspace and independent calendar state", () => {
  const calendar = functionSource("renderOneOffContractCalendar");
  const workPanel = functionSource("renderContractWorkManagementPanel");
  assert.match(source, /let contractCalendarMonth\s*=\s*Core\.dayKey\(\)\.slice\(0,\s*7\)/);
  assert.match(source, /let contractCalendarBuildingId\s*=\s*"all"/);
  assert.match(source, /let contractCalendarQuery\s*=\s*""/);
  assert.match(calendar, /Core\.oneOffContractRows\(store\.contracts,\s*contractCalendarMonth,\s*contractCalendarBuildingId\)/);
  assert.match(calendar, /data-contract-calendar-month="-1"/);
  assert.match(calendar, /data-contract-calendar-month="1"/);
  assert.match(calendar, /data-contract-calendar-building/);
  assert.match(calendar, /data-action="new-one-off-contract"/);
  assert.equal((calendar.match(/＋ 계약 등록/g) || []).length, 2);
  assert.doesNotMatch(calendar, /＋ 단건 계약(?: 등록)?/);
  assert.match(calendar, /renderContractWorkManagementPanel\(\)/);
  assert.match(workPanel, /계약을 등록하면 작업 일정이 자동으로 연결됩니다/);
  assert.match(workPanel, /data-contract-work-panel/);
  assert.doesNotMatch(calendar, /\bpaymentMonth\b|\bpaymentBuildingFilter\b|data-payment-month=|data-payment-building-filter/);
  assert.match(source, /shiftContractCalendarMonth\(contractCalendarMonthButton\.dataset\.contractCalendarMonth\)/);
  assert.match(source, /event\.target\.matches\("\[data-contract-calendar-building\]"\)[\s\S]{0,120}contractCalendarBuildingId\s*=\s*event\.target\.value/);
  for (const name of ["workDate", "paymentDueDate", "vendorCost", "collectionStatus", "vendorPaymentStatus"]) {
    assert.match(source, new RegExp(`name=["']${name}["']|field\\([^\\n]+["']${name}["']`));
  }
  assert.match(calendar, /예상 수익/);
});

test("owner payment calendar remains recurring-only", () => {
  const payments = functionSource("renderPayments");
  assert.match(payments, /const rows\s*=\s*paymentRows\(\)/);
  assert.match(payments, /건물주용 정기 납부 관리/);
  assert.match(payments, /<h2>건물주 입금캘린더<\/h2>/);
  assert.match(payments, /<b>고객건물 목록<\/b>/);
  assert.match(payments, /data-action="new-customer">＋ 고객건물 추가<\/button>/);
  assert.match(payments, /data-payment-event=/);
  assert.doesNotMatch(payments, /oneOffContractRows|renderOneOffContractCalendar|data-contract-edit|data-contract-calendar|data-payment-mode|단건 계약/);
  assert.doesNotMatch(source, /data-payment-mode=/);
});

test("one-off contract save and delete return to the unified contract calendar", () => {
  const editor = functionSource("contractEditor");
  const save = sourceBetween('form.id === "contractForm"', 'form.id === "customerForm"');
  const remove = functionSource("deleteContractRecord");

  assert.match(editor, /const returnView\s*=\s*currentView\s*===\s*"buildingCalendar"\s*&&\s*unifiedCalendarTab\s*===\s*"contract"\s*\?\s*"buildingCalendar"\s*:\s*"contracts"/);
  assert.match(editor, /data-return-view="\$\{attr\(returnView\)\}"/);

  assert.match(save, /if \(!canWriteCRM\(\)\) return showToast\("조회 전용 계정은 계약을 저장할 수 없습니다\.", "error"\)/);
  assert.match(save, /returnToContractCalendar\s*=\s*oneOffContract\s*&&\s*form\.dataset\.returnView\s*===\s*"buildingCalendar"/);
  assert.match(save, /unifiedCalendarTab\s*=\s*"contract"/);
  assert.match(save, /contractCalendarMonth\s*=\s*item\.paymentDueDate\.slice\(0,\s*7\)/);
  assert.match(save, /contractCalendarBuildingId\s*=\s*"all"/);
  assert.match(save, /contractCalendarQuery\s*=\s*""/);
  assert.match(save, /currentView\s*=\s*returnToContractCalendar\s*\?\s*"buildingCalendar"\s*:\s*"contracts"/);
  assert.doesNotMatch(save, /store\.serviceRecords\.(?:push|splice)|commitBuildingScheduleRecord\(/);

  assert.match(remove, /dataset\.returnView\s*===\s*"buildingCalendar"\s*\?\s*"buildingCalendar"\s*:\s*"contracts"/);
  assert.match(remove, /returnView\s*===\s*"buildingCalendar"\)\s*unifiedCalendarTab\s*=\s*"contract"/);
  assert.match(remove, /currentView\s*=\s*returnView/);
});

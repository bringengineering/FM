"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (current === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (current === "\"" || current === "'" || current === "`") { quote = current; continue; }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const functionNames = [
  "paymentMonthParts",
  "paymentMonthCompare",
  "paymentDaysInMonth",
  "paymentDueDate",
  "paymentAddDays",
  "paymentNormalizeName",
  "paymentScheduleActiveInMonth",
  "paymentTransactionsArray",
  "calculatePaymentMonthRows"
];
const context = { Date, Math, Object, Array, String, Number };
vm.createContext(context);
vm.runInContext(functionNames.map(extractFunction).join("\n"), context);

function schedule(id, overrides) {
  return Object.assign({
    id,
    buildingId: "building-1",
    unit: "101호",
    tenantName: "홍길동",
    payerName: "홍길동",
    amount: 500000,
    dueDay: 10,
    startMonth: "2026-01",
    endMonth: "",
    active: true
  }, overrides || {});
}

function rows(data, month, today) {
  return context.calculatePaymentMonthRows(data, "building-1", month || "2026-07", today || "2026-07-10");
}

assert.equal(context.paymentDueDate("2026-02", 31), "2026-02-28", "말일이 짧은 달에는 실제 말일을 사용한다");
assert.equal(context.paymentDueDate("2028-02", 31), "2028-02-29", "윤년 말일을 지원한다");

const paid = rows({
  schedules: { s1: schedule("s1") },
  transactions: { tx1: { buildingId: "building-1", date: "2026-07-08", payerName: "홍 길동", amount: 500000, direction: "deposit" } }
});
assert.equal(paid[0].status, "paid", "이름·금액·기간이 정확히 일치하면 입금완료다");
assert.equal(paid[0].matchedTransaction.id, "tx1");

const outsideWindow = rows({
  schedules: { s1: schedule("s1") },
  transactions: { tx1: { buildingId: "building-1", date: "2026-07-18", payerName: "홍길동", amount: 500000, direction: "deposit" } }
}, "2026-07", "2026-07-18");
assert.equal(outsideWindow[0].status, "overdue", "납부일 +7일을 벗어난 거래는 자동 매칭하지 않는다");

const duplicate = rows({
  schedules: { s1: schedule("s1") },
  transactions: {
    tx1: { buildingId: "building-1", date: "2026-07-09", payerName: "홍길동", amount: 500000, direction: "deposit" },
    tx2: { buildingId: "building-1", date: "2026-07-10", payerName: "홍길동", amount: 500000, direction: "deposit" }
  }
});
assert.equal(duplicate[0].status, "review", "일치 거래가 둘 이상이면 확인필요다");

const sharedTransaction = rows({
  schedules: { s1: schedule("s1"), s2: schedule("s2", { unit: "102호" }) },
  transactions: { tx1: { buildingId: "building-1", date: "2026-07-10", payerName: "홍길동", amount: 500000, direction: "deposit" } }
});
assert.deepEqual(Array.from(sharedTransaction, row => row.status), ["review", "review"], "한 거래가 두 일정에 걸리면 둘 다 확인필요다");

const otherBuilding = rows({
  schedules: { s1: schedule("s1") },
  transactions: { tx1: { buildingId: "building-2", date: "2026-07-10", payerName: "홍길동", amount: 500000, direction: "deposit" } }
}, "2026-07", "2026-07-20");
assert.equal(otherBuilding[0].status, "overdue", "다른 건물 계좌 거래는 매칭하지 않는다");

const manual = rows({
  schedules: { s1: schedule("s1") },
  transactions: {},
  overrides: { "2026-07": { s1: { status: "paid", reason: "통장 직접 확인" } } }
}, "2026-07", "2026-07-20");
assert.equal(manual[0].status, "paid", "수동 보정은 자동 판정보다 우선한다");

assert.equal(rows({ schedules: { s1: schedule("s1", { endMonth: "2026-06" }) } }).length, 0, "종료월 이후 일정은 만들지 않는다");

console.log("payment calendar tests passed");

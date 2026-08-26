const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../src/core");

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
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  assert.match(source, /현재 어떤 요청이 있나요\?[\s\S]{0,300}개인 메모·고객 특징/);
  assert.equal((source.match(/areaField\("개인 메모·고객 특징"/g) || []).length, 1);
  assert.doesNotMatch(source, /areaField\("고객 메모"/);
  assert.match(source, /notes:\s*raw\.notes\.trim\(\)/);
});

test("payment calendar exposes a one-off contract workspace and settlement fields", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
  assert.match(source, /data-payment-mode="oneOff"/);
  assert.match(source, /data-action="new-one-off-contract"/);
  for (const name of ["workDate", "paymentDueDate", "vendorCost", "collectionStatus", "vendorPaymentStatus"]) {
    assert.match(source, new RegExp(`name=["']${name}["']|field\\([^\\n]+["']${name}["']`));
  }
  assert.match(source, /Core\.oneOffContractRows\(store\.contracts/);
  assert.match(source, /예상 수익/);
});

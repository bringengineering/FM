"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ContractSchedule = require("../src/contract-schedule-core");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a);
  return source.slice(a, b);
}
function setup(writable = true) {
  const customers = ["mixed", "single", "annual", "unknown", "empty", "archived"].map(id => ({ id, name: `Customer ${id}`, stage: "계약 확정", ...(id === "archived" ? { archivedAt: "2026-01-01" } : {}) }));
  const contract = (id, customerId, billingCycle, extra = {}) => ({ id, customerId, billingCycle, name: `Contract ${id}`, status: "진행 중", startDate: "2026-10-01", ...extra });
  const store = { customers, contracts: [
    contract("mixed_single", "mixed", "건별"), contract("mixed_monthly", "mixed", "월 정기"),
    contract("single_a", "single", "건별"), contract("annual_a", "annual", "연간"),
    contract("other_a", "unknown", "기타"), contract("missing_a", "unknown", undefined),
    contract("archived_a", "archived", "월 정기"), contract("deleted_a", "mixed", "월 정기", { deletedAt: "2026-01-01" }),
  ] };
  const ctx = vm.createContext({ store, ContractSchedule, window: {BringContractCustomerSummary: require("../src/contract-customer-summary")}, todayKey: () => "2026-10-01", contractCustomerModeFilter: "all", contractPaymentModeFilter: "single", main: { innerHTML: "" },
    canWriteCRM: () => writable, customerSalesProgress: () => ({ filterIds: [] }), customerDisplayName: c => c.name,
    customerAvatar: () => "", buildingById: () => null, esc, attr: esc, empty: (title, description, action) => `${title} ${description} ${action}`,
  });
  vm.runInContext(source.match(/const customerIsRelationshipCustomer = [\s\S]*?;\r?\n/)[0], ctx);
  vm.runInContext(between("  function relationshipContractsHtml(", "  function partnerQuoteBadge("), ctx);
  const click = between("    const contractCustomerModeControl =", "    const contractPaymentMode =");
  vm.runInContext(`function clickMode(mode) { const event = { target: { closest: () => ({dataset: {contractCustomerMode: mode}}) } }; ${click} }`, ctx);
  return ctx;
}

test("contract customer tabs default to all and classify only explicit billing cycles without mutating data", () => {
  const ctx = setup(), before = JSON.stringify(ctx.store);
  assert.match(source, /let contractCustomerModeFilter = "all"/);
  ctx.renderRelationships();
  const html = ctx.main.innerHTML;
  assert.match(html, /고객 5명 · 전체 6건/);
  for (const [mode, count] of [["all", 6], ["single", 2], ["recurring", 2]]) {
    assert.match(html, new RegExp(`data-contract-customer-mode="${mode}"[^>]*>[^<]+<span>${count}건`));
  }
  assert.match(html, /Customer empty/);
  assert.match(html, /구분 확인 필요/);
  assert.doesNotMatch(html, /Contract archived_a|Contract deleted_a/);
  for (const [cycle, mode] of [["건별", "single"], ["월 정기", "recurring"], ["연간", "recurring"], ["기타", "unknown"], [undefined, "unknown"], ["weekly", "unknown"]]) {
    assert.equal(ctx.contractCustomerMode({ billingCycle: cycle }), mode);
  }
  assert.equal(JSON.stringify(ctx.store), before);
});

test("actual tab handler filters mixed customer contracts, empty customers and unknown cycles independently of contract editor filters", () => {
  const ctx = setup(), before = JSON.stringify(ctx.store);
  ctx.clickMode("single");
  assert.match(ctx.main.innerHTML, /고객 2명 · 단건 계약 2건/);
  assert.match(ctx.main.innerHTML, /Contract mixed_single/);
  assert.doesNotMatch(ctx.main.innerHTML, /Contract mixed_monthly|Customer annual|Customer unknown|Customer empty/);
  assert.match(ctx.main.innerHTML, /data-contract-customer-mode="single" aria-pressed="true"/);
  ctx.clickMode("recurring");
  assert.match(ctx.main.innerHTML, /고객 2명 · 정기 계약 2건/);
  assert.match(ctx.main.innerHTML, /Contract mixed_monthly|Contract annual_a/);
  assert.doesNotMatch(ctx.main.innerHTML, /Contract mixed_single|Customer single|Customer unknown|Customer empty/);
  assert.equal(ctx.contractPaymentModeFilter, "single", "does not leak into the independent contract editor/list filter");
  ctx.renderRelationships();
  assert.match(ctx.main.innerHTML, /data-contract-customer-mode="recurring" aria-pressed="true"/);
  ctx.clickMode("bad-input");
  assert.equal(ctx.contractCustomerModeFilter, "all");
  assert.match(ctx.main.innerHTML, /Contract other_a/);
  assert.equal(JSON.stringify(ctx.store), before);
});

test("viewer tabs remain usable, empty category has a relevant message and no write controls", () => {
  const ctx = setup(false);
  ctx.store.contracts = ctx.store.contracts.filter(c => c.billingCycle !== "건별");
  ctx.clickMode("single");
  assert.match(ctx.main.innerHTML, /등록된 단건 계약이 없습니다/);
  assert.match(ctx.main.innerHTML, /전체 탭에서 확인/);
  assert.doesNotMatch(ctx.main.innerHTML, /data-action="new-contract"|data-contract-edit=/);
  ctx.clickMode("recurring");
  assert.match(ctx.main.innerHTML, /Contract mixed_monthly/);
  assert.doesNotMatch(ctx.main.innerHTML, /data-contract-edit=/);
});

test("untrusted customer, contract and schedule text remains escaped in every category", () => {
  const ctx = setup();
  ctx.store.customers[0].name = '<img src=x onerror="bad()">';
  ctx.store.contracts[0].name = '<script>bad()</script>';
  for (const mode of ["all", "single"]) {
    ctx.clickMode(mode);
    assert.match(ctx.main.innerHTML, /&lt;img/);
    assert.match(ctx.main.innerHTML, /&lt;script/);
    assert.doesNotMatch(ctx.main.innerHTML, /<img|<script/);
  }
});
test("종료 계약은 구분하고 연결된 계약이 없는 이유를 표시한다", () => {
  const ctx = setup();
  ctx.store.contracts.find(c => c.id === "single_a").status = "종료";
  ctx.renderRelationships();
  assert.match(ctx.main.innerHTML, /종료 계약 1건/);
  assert.match(ctx.main.innerHTML, /연결된 계약 없음 · 고객 상태가 계약 확정/);
  assert.match(ctx.main.innerHTML, /종료 계약 포함/);
  ctx.store.customers.find(c => c.id === "single").deleted = true;
  ctx.renderRelationships();
  assert.doesNotMatch(ctx.main.innerHTML, /Customer single/);
});
test("고객 카드에는 변경된 실제 일정과 입금 등록 상태를 각각 표시한다", () => {
  const ctx = setup();
  const row=ctx.store.contracts.find(c=>c.id === "single_a");
  Object.assign(row,{buildingId:"b1",type:"청소",workDate:"2026-10-06",paymentDueDate:"2026-10-15",cleaningSchedule:{mode:"once"}});
  ctx.store.serviceRecords=[{id:"r1",sourceContractId:row.id,sourceContractDate:"2026-10-06",sourceContractBuildingId:"b1",buildingId:"b1",scheduledDate:"2026-10-08",status:"planned"}];
  ctx.clickMode("single");
  assert.match(ctx.main.innerHTML,/업무일정 · 2026-10 · 2026-10-08 예정/);
  assert.doesNotMatch(ctx.main.innerHTML,/업무일정 · 2026-10 · 2026-10-06/);
  assert.match(ctx.main.innerHTML,/입금일정 · 2026-10-15 입금 예정/);
});

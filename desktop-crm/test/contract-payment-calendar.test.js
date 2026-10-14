"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../src/core");
const Schedule = require("../src/contract-schedule-core");
const Calendar = require("../src/work-calendar");
const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const fixture = changes => ({id: "contract_a", name: "공용부청소", customerId: "customer_a", buildingId: "building_a", types: ["청소"], status: "진행 중", startDate: "2026-10-08", billingCycle: "월 정기", amount: 50000, paymentDueDate: "2026-10-30", cleaningSchedule: {mode: "weekly", weekday: 4}, ...changes});

test("weekly work and monthly receipts are independent, immutable projections with no multiplied amount", () => {
  const original = fixture(), before = JSON.stringify(original);
  const store = Core.sanitizeSharedStore({contracts: [original], buildings: [{id: "building_a"}]});
  assert.deepEqual(Calendar.buildModel(store, {month: "2026-10"}).events.map(e => e.scheduledDate), ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  const receipts = Core.contractPaymentRows(store.contracts, "2026-10");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].dueDate, "2026-10-30");
  assert.equal(receipts[0].amount, 50000);
  assert.equal(Core.contractPaymentRows(store.contracts, "2026-11")[0].dueDate, "2026-11-30");
  assert.equal(Core.contractPaymentTotals(receipts).revenue, 50000);
  assert.equal(JSON.stringify(original), before);
  store.contracts[0].cleaningSchedule.weekday = 1;
  assert.equal(Core.contractPaymentRows(store.contracts, "2026-10")[0].dueDate, "2026-10-30");
  store.contracts[0].paymentDueDate = "2026-10-31";
  assert.equal(Schedule.contractWorkOccurrences(store).length, 4);
});

test("monthly anchors clamp short months without drifting and obey the receipt start and contract end month", () => {
  const item = fixture({paymentDueDate: "2027-01-31", endDate: "2028-03-01"});
  for (const [month, date] of [["2027-01", "2027-01-31"], ["2027-02", "2027-02-28"], ["2027-03", "2027-03-31"], ["2028-02", "2028-02-29"], ["2028-03", "2028-03-31"]]) {
    assert.equal(Core.contractPaymentRows([item], month)[0].dueDate, date);
  }
  assert.equal(Core.contractPaymentRows([item], "2026-12").length, 0);
  assert.equal(Core.contractPaymentRows([item], "2028-04").length, 0);
  assert.equal(Core.contractPaymentRows([fixture({startDate: "2026-11-01"})], "2026-10")[0].dueDate, "2026-10-30", "an explicitly agreed advance receipt need not match the work start date");
  assert.equal(Core.contractPaymentRows([fixture({status: "종료"})], "2026-11").length, 0, "no guessed infinite renewal after termination without an end date");
});

test("annual and one-off receipt dates never expand into weekly work dates", () => {
  const annual = fixture({billingCycle: "연간", paymentDueDate: "2028-02-29"});
  assert.equal(Core.contractPaymentRows([annual], "2029-02")[0].dueDate, "2029-02-28");
  assert.equal(Core.contractPaymentRows([annual], "2032-02")[0].dueDate, "2032-02-29");
  assert.equal(Core.contractPaymentRows([annual], "2029-03").length, 0);
  for (const billingCycle of ["건별", "기타"]) {
    const item = fixture({billingCycle, workDate: "2026-10-08"});
    assert.equal(Core.contractPaymentRows([item], "2026-10")[0].dueDate, "2026-10-30");
    assert.equal(Core.contractPaymentRows([item], "2026-11").length, 0);
  }
});

test("missing legacy dates are explained without guessing from work dates; archived/duplicate inputs stay excluded", () => {
  const missing = fixture({paymentDueDate: "", workDate: "2026-10-08"});
  assert.equal(Core.normalizeContract(missing).paymentDueDate, "");
  assert.equal(Core.contractPaymentRows([missing], "2026-10").length, 0);
  assert.deepEqual(Core.contractPaymentMissingDates([missing, missing]).map(c => c.id), ["contract_a"]);
  for (const date of ["2026-02-30", "2026-10-00", "bad", "2026-10-30T00:00:00Z"]) {
    assert.equal(Core.contractPaymentRows([fixture({paymentDueDate: date})], "2026-10").length, 0);
    assert.equal(Core.contractPaymentMissingDates([fixture({paymentDueDate: date})]).length, 1);
  }
  for (const changes of [{archivedAt: "2026-10-14"}, {deleted: true}, {status: "cancelled"}, {status: "무효"}]) assert.equal(Core.contractPaymentRows([fixture(changes)], "2026-10").length, 0);
  assert.equal(Core.contractPaymentRows([fixture(), fixture()], "2026-10").length, 1);
  assert.equal(Core.contractPaymentRows([fixture()], "2026-10", "other").length, 0);
  assert.equal(Core.contractPaymentRows([fixture()], "2026-13").length, 0);
});

test("manual collection receipts are date-scoped and survive shared-store roundtrips without paying future months", () => {
  const item = fixture({collectionStatus: "입금 완료"});
  assert.equal(Core.contractPaymentRows([item], "2026-10")[0].status, "paid");
  assert.notEqual(Core.contractPaymentRows([item], "2026-11")[0].status, "paid");
  const fields = Core.contractPaymentFields(item, {...item, collectionDueDate: "2026-11-30", collectionStatus: "입금 완료"});
  const saved = Core.sanitizeSharedStore({contracts: [{...item, ...fields}]}).contracts[0];
  assert.equal(saved.paymentCollections["2026-10-30"], "입금 완료");
  assert.equal(saved.paymentCollections["2026-11-30"], "입금 완료");
  assert.equal(Core.contractPaymentRows([saved], "2026-11")[0].status, "paid");
  assert.equal(Core.contractPaymentRows([saved], "2026-12", "all", "2026-12-31")[0].status, "overdue");
  assert.equal(Core.contractPaymentRows([saved], "2026-12", "all", "2026-12-01")[0].status, "scheduled");
  assert.deepEqual(Core.contractPaymentTotals(Core.contractPaymentRows([saved], "2026-11")), {count: 1, revenue: 50000, paid: 50000, unpaid: 0});
  const legacyOneOff = fixture({billingCycle: "건별", collectionStatus: "입금 완료", paymentCollections: {"2026-10-30": "입금 예정"}});
  assert.equal(Core.contractPaymentRows([legacyOneOff], "2026-10")[0].status, "paid", "legacy settlement updates remain authoritative for one-off contracts");
  const legacyUnpaid = fixture({collectionStatus: "입금 예정"});
  const laterFields = Core.contractPaymentFields(legacyUnpaid, {...legacyUnpaid, collectionDueDate: "2026-11-30", collectionStatus: "입금 완료"});
  assert.equal(laterFields.collectionStatus, "입금 예정", "a later receipt cannot overwrite an unmapped legacy first-payment status");
  assert.notEqual(Core.contractPaymentRows([{...legacyUnpaid, ...laterFields}], "2026-10")[0].status, "paid");
  assert.equal(Core.contractPaymentCollectionStatus({paymentDueDate: "", collectionStatus: "입금 완료"}, ""), "입금 예정");
});

test("closed receipt values reject unknown dates and statuses before changing the contract", () => {
  const item = fixture(), before = JSON.stringify(item);
  for (const changes of [{paymentDueDate: ""}, {paymentDueDate: "2026-02-30"}, {collectionDueDate: "2026-10-15"}, {collectionStatus: "forged"}, {billingCycle: "unknown"}]) {
    assert.throws(() => Core.contractPaymentFields(item, {...item, ...changes}));
    assert.equal(JSON.stringify(item), before);
  }
  const dirty = Core.normalizeContract(fixture({paymentCollections: {"2026-10-30": "입금 완료", "2026-02-30": "입금 완료", bad: "<img>"}}));
  assert.deepEqual(dirty.paymentCollections, {"2026-10-30": "입금 완료"});
});

const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function renderer(contracts, options = {}) {
  const ctx = vm.createContext({Core, store: {contracts, buildings: [{id: "building_a", name: "Fixture building"}]},
    contractCalendarMonth: "2026-10", contractCalendarBuildingId: options.buildingId || "all", contractCalendarQuery: options.query || "", canWriteCRM: () => options.canWrite !== false,
    customerById: () => ({name: "Fixture customer"}), buildingById: () => ({name: "Fixture building"}), todayKey: () => "2026-10-14", esc, attr: esc, krw: n => `${n}원`,
    paymentMonthLabel: v => v, paymentCalendarDays: () => Array.from({length: 31}, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`), empty: (a, b, c) => `<p>${a} ${b}</p>${c}`, renderContractWorkManagementPanel: () => "",
  });
  vm.runInContext(app.slice(app.indexOf("  function contractCalendarBuildings("), app.indexOf("  function renderPayments(")), ctx);
  return ctx.renderOneOffContractCalendar();
}

test("the real receipt renderer shows one date, amount/status and missing-date actions without weekly duplication", () => {
  const html = renderer([fixture(), fixture({id: "missing", name: "Legacy", paymentDueDate: ""})]);
  assert.equal((html.match(/class="payment-event /g) || []).length, 1);
  assert.match(html, /data-contract-payment-date="2026-10-30"/);
  assert.match(html, /50000원 · 입금 예정/);
  assert.match(html, /입금 예정일 미설정 1건/);
  assert.match(html, /data-contract-edit="missing"/);
  assert.match(html, /<th>입금 예정일<\/th>/);
  assert.doesNotMatch(html, /건별 계약만|수익 0원|data-work-calendar-occurrence/);
  assert.doesNotMatch(renderer([fixture()], {query: "not found"}), /class="payment-event /);
  const viewer = renderer([fixture(), fixture({id: "missing", paymentDueDate: ""})], {canWrite: false});
  assert.doesNotMatch(viewer, /data-contract-edit=|new-calendar-contract/);
  const unsafe = renderer([fixture({name: '<img src=x onerror="bad">'})]);
  assert.doesNotMatch(unsafe, /<img/); assert.match(unsafe, /&lt;img/);
});

test("the actual contract editor opens the clicked receipt date with date-scoped status and a readonly application date", () => {
  const values = {}, elements = {}, form = {elements, dataset: {contractId: "contract_a"}, addEventListener() {}};
  const section = {}, hint = {};
  form.querySelector = selector => selector === "[data-one-off-contract-fields]" ? section : hint;
  const item = fixture({paymentCollections: {"2026-11-30": "입금 완료"}});
  const field = (_label, name, value) => {values[name] = value; elements[name] = {value}; return "";};
  const ctx = vm.createContext({Core, store: {contracts: [item], customers: [], settings: {}}, contractPaymentModeFilter: "recurring", currentView: "buildingCalendar", unifiedCalendarTab: "contract", authGeneration: 1, currentAuthUid: () => "fixture", canWriteCRM: () => true,
    todayKey: () => "2026-10-14", contractTypes: c => c.types, customerById: () => null, modalContent: {}, field, areaField: field, selectField: (label, name, _options, value) => field(label, name, value),
    contractTypeChecklist: () => "", contractBuildingField: () => "", renderContractReadinessFields: () => "", ContractScheduleUI: {renderFields: () => "", refresh() {}},
    esc, attr: esc, krw: v => v, openModal() {}, setTimeout() {}, document: {getElementById: () => form}, FormData: class { *[Symbol.iterator]() {} },
  });
  const refresh = app.match(/  function refreshContractPaymentFields\([\s\S]*?^  \}/m)[0];
  const editor = app.match(/  function contractEditor\([\s\S]*?^  \}/m)[0];
  vm.runInContext(refresh + editor, ctx);
  ctx.contractEditor("contract_a", false, "2026-11-30");
  assert.equal(values.paymentDueDate, "2026-10-30");
  assert.equal(values.collectionDueDate, "2026-11-30");
  assert.equal(values.collectionStatus, "입금 완료");
  assert.equal(elements.collectionDueDate.readOnly, true);
  assert.equal(elements.paymentDueDate.required, true);
  assert.equal(section.hidden, true);
  assert.match(hint.textContent, /매월 1회/);
  elements.paymentDueDate.value = "2026-10-31";
  item.collectionStatus = "입금 완료";
  ctx.refreshContractPaymentFields(form, true);
  assert.equal(elements.collectionDueDate.value, "2026-10-31");
  assert.equal(elements.collectionStatus.value, "입금 예정");
  assert.equal(item.paymentDueDate, "2026-10-30");
  elements.paymentDueDate.value = "2026-10-30";
  elements.collectionDueDate.value = "2026-11-30";
  elements.endDate.value = "2026-10-31";
  ctx.refreshContractPaymentFields(form);
  assert.equal(elements.collectionDueDate.value, "2026-10-30", "shortening a contract does not leave an uneditable invalid future receipt date");
});

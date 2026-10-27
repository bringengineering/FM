"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../src/core");
const Monthly = require("../src/building-report-core");
const Service = require("../src/service-report-core");
const Work = require("../src/work-report-core");
const { createBuildingReportHtml } = require("../src/building-report-pdf");
const { createServiceReportHtml } = require("../src/service-report-pdf");
const { createWorkReportHtml } = require("../src/work-report-pdf");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const customer = { id: "qa_customer", name: "공식 고객명", nickname: "내부 전용 별명", address: "다른 개인 주소", buildingIds: ["qa_a", "qa_b"] };
const buildings = [
  { id: "qa_a", name: "A건물", roadAddress: "예시시 첫째로 11", address: "이전 주소", ownerCustomerId: customer.id },
  { id: "qa_b", name: "B건물", jibunAddress: "예시동 22-3", ownerCustomerId: customer.id },
];
function between(start, end) {
  const i = source.indexOf(start), j = source.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i);
  return source.slice(i, j);
}

test("nickname is a bounded optional string and never replaces the formal customer name", () => {
  for (const nickname of [undefined, null, 7, {}, []]) assert.equal(Core.normalizeCustomer({ ...customer, nickname }).nickname, "");
  const normalized = Core.normalizeCustomer({ ...customer, nickname: "  내부\n 별명\u0000 " });
  assert.equal(normalized.nickname, "내부 별명");
  assert.equal(normalized.name, customer.name);
  assert.equal(Core.normalizeCustomerNickname("가".repeat(90)).length, 80);
  assert.equal(Core.createCustomer().nickname, "");
  assert.equal(Core.createCustomer({ nickname: "  새 별명  " }).nickname, "새 별명");
  const store = Core.blankSharedStore(); store.customers = [normalized];
  const saved = Core.sanitizeSharedStore(store);
  assert.equal(saved.customers[0].nickname, "내부 별명");
  assert.equal(Core.sanitizeStore(JSON.parse(JSON.stringify(saved))).customers[0].name, customer.name);
});

test("real customer form saves, clears, and reloads a nickname without touching links or marketing", () => {
  const store = Core.blankSharedStore(); store.customers = [structuredClone(customer)];
  store.customers[0].marketing = { firstSource: "needs_review" };
  const fn = between("  function customerFromForm(form)", "  async function deleteActivityRecord");
  const fromForm = new vm.Script(`${fn}; customerFromForm`).runInNewContext({
    Core, store, customerById: id => store.customers.find(row => row.id === id),
    customerPhoneText: value => Core.formatPhone(value), FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.values); } },
  });
  const values = { name: customer.name, nickname: "  동네 별명  ", company: "", phone: "", email: "", type: "건물주", roadAddress: "", jibunAddress: "", owner: "", source: "", priority: "보통", expectedValue: "", interestServices: "", tags: "", currentIssue: "", lastContactAt: "", nextContactAt: "", nextAction: "", notes: "" };
  const form = { dataset: { customerId: customer.id }, values };
  fromForm(form);
  let loaded = Core.sanitizeStore(JSON.parse(JSON.stringify(store))).customers[0];
  assert.equal(loaded.nickname, "동네 별명"); assert.equal(loaded.name, customer.name);
  assert.deepEqual(loaded.buildingIds, customer.buildingIds); assert.equal(loaded.marketing.firstSource, "needs_review");
  values.nickname = ""; fromForm(form);
  loaded = Core.sanitizeStore(JSON.parse(JSON.stringify(store))).customers[0];
  assert.equal(loaded.nickname, ""); assert.equal(loaded.address, customer.address);
});

test("internal customer titles and search support alias and original name independently", () => {
  const display = between("  const customerDisplayName =", "  const salesStageById");
  const label = new vm.Script(`${display}; customerDisplayName`).runInNewContext({ Core, customerBuildings: () => [] });
  assert.equal(label(customer), customer.nickname);
  assert.equal(label({ ...customer, nickname: "" }), customer.name);
  const filter = between("  function filteredCustomers()", "  function renderCustomers()");
  const searchEl = { value: customer.nickname };
  const filtered = new vm.Script(`${filter}; filteredCustomers`).runInNewContext({ Core, searchEl, store: { customers: [customer] },
    customerManagementFilter: "전체", managementStatusForCustomer: () => "관리 중", customerBuildings: () => buildings,
    MANAGEMENT_ORDER: {}, customerPhoneSearchKey: () => "", customerPhoneCandidateKey: () => "" });
  assert.equal(filtered().length, 1); searchEl.value = customer.name; assert.equal(filtered().length, 1);
  searchEl.value = "없는 별명"; assert.equal(filtered().length, 0);
  const editor = between("  function customerEditor", "  function updateCustomerCustomTypeField");
  assert.match(editor, /별명\(내부용\)/); assert.match(editor, /name="nickname" maxlength="80"/);
  assert.match(editor, /attr\(Core\.normalizeCustomerNickname\(customer\.nickname\)\)/);
  assert.match(between("  function customerPickerSearchText", "  function consultationCustomerPickerRows"), /customer && customer\.nickname/);
  // Internal aliases must not silently become a new building's public name.
  const resolver = between("  async function resolveCustomerManagedBuildingSelection", "  function replaceServiceRecord");
  assert.doesNotMatch(resolver, /name: customerDisplayName\(customer\)/);
});

test("recipient uses only the selected building address with a neutral missing-address fallback", () => {
  assert.equal(Core.reportOwnerName(buildings[0]), "예시시 첫째로 11 건물주");
  assert.equal(Core.reportOwnerName(buildings[1]), "예시동 22-3 건물주");
  for (const value of [null, {}, { name: customer.nickname, ownerName: customer.name }, { address: {} }]) assert.equal(Core.reportOwnerName(value), "건물주");
});

test("monthly, service, and owner work report PDFs use address + 건물주님, never internal nicknames", () => {
  for (const building of buildings) {
    const recipient = `${Core.reportOwnerName(building)}님`;
    const monthly = Monthly.buildBuildingMonthlyReport({ building, month: "2026-10", ownerName: customer.nickname, customer });
    const service = Service.buildServiceReport({ building, customer, case: { id: "qa_case", name: customer.nickname, workCompletedAt: "2026-10-01" } });
    const work = Work.normalizeReport({ id: "qa_work", kind: "common", buildingId: building.id, buildingName: building.name, siteAddress: monthly.address, ownerName: customer.nickname, workDate: "2026-10-01" });
    const before = JSON.stringify(work);
    for (const html of [createBuildingReportHtml(monthly), createServiceReportHtml(service), createWorkReportHtml(work)]) {
      assert.ok(html.includes(recipient)); assert.ok(!html.includes(customer.nickname)); assert.ok(!html.includes(customer.address));
    }
    assert.ok(!JSON.stringify(monthly).includes(customer.nickname)); assert.ok(!JSON.stringify(service).includes(customer.nickname));
    assert.equal(JSON.stringify(work), before, "printing must not rewrite saved owner/manual content");
  }
});

test("owner report sinks escape hostile address text and do not fall back to a nickname", () => {
  const address = '<img src=x onerror="bad"> & 현장';
  const monthly = Monthly.buildBuildingMonthlyReport({ building: { address }, ownerName: customer.nickname });
  const html = createBuildingReportHtml(monthly);
  assert.match(html, /&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; 현장 건물주님/);
  assert.doesNotMatch(html, /<img src=x/);
  const missing = Monthly.buildBuildingMonthlyReport({ building: { name: "주소 없는 건물" }, ownerName: customer.nickname });
  assert.match(createBuildingReportHtml(missing), /건물주님,/);
  assert.ok(!createBuildingReportHtml(missing).includes(customer.nickname));
});

test("browser report modules use the same recipient policy as PDF generation", () => {
  const context = vm.createContext({});
  for (const file of ["core.js", "building-report-core.js", "service-report-core.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
  }
  const monthly = context.BringBuildingReportCore.buildBuildingMonthlyReport({ building: buildings[1], ownerName: customer.nickname });
  const service = context.BringServiceReportCore.buildServiceReport({ building: buildings[0], customer });
  assert.equal(monthly.ownerName, "예시동 22-3 건물주");
  assert.equal(service.ownerName, "예시시 첫째로 11 건물주");
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  assert.ok(index.indexOf('src="./core.js"') < index.indexOf('src="./building-report-core.js"'));
  const preview = between("  function renderBuildingMonthlyReports()", "  async function ");
  assert.match(preview, /esc\(report\.ownerName\)\}님,/);
  assert.doesNotMatch(preview, /esc\(owner && owner\.name \|\| "건물주"\)\}님,/);
});

test("customer-address report picker keeps an alias out of the public building name", () => {
  const picker = between("  function workReportBuildings", "  function workReportBuildingAddress");
  const rows = new vm.Script(`${picker}; workReportBuildings()`).runInNewContext({
    store: { buildings: [] }, customerManagedBuildingChoices: () => [{ value: "customer:qa_customer", customer,
      building: buildings[0], name: customer.nickname, address: buildings[0].roadAddress }],
  });
  assert.equal(rows[0].internalLabel, customer.nickname);
  assert.equal(rows[0].name, buildings[0].name);
  const report = Work.normalizeReport({ kind: "common", buildingName: rows[0].name, siteAddress: rows[0].address });
  assert.ok(!createWorkReportHtml(report).includes(customer.nickname));
  assert.match(source, /esc\(item\.internalLabel \|\| item\.name \|\| workReportBuildingAddress\(item\)/);
});

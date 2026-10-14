const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../src/core");
const Schedule = require("../src/contract-schedule-core");
const UI = require("../src/contract-schedule-ui");
const Calendar = require("../src/work-calendar");
const Work = require("../src/work-management");
const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const contract = changes => ({ id: "contract_a", customerId: "customer_a", buildingId: "building_a", name: "Fixture weekly cleaning", types: ["청소"], status: "진행 중", startDate: "2026-10-13", billingCycle: "월 정기", amount: 200000, owner: "Fixture owner", cleaningSchedule: { mode: "weekly", weekday: 1, count: 4 }, ...changes });
const store = changes => ({ buildings: [{ id: "building_a", name: "Fixture building" }], customers: [{ id: "customer_a", stage: "상담 중" }], contracts: [contract()], serviceRecords: [], ...changes });
const mondays = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];

test("weekly cleaning generates the first four selected weekdays across months, not a moving window", () => {
  const input = store(), before = JSON.stringify(input);
  assert.deepEqual(Schedule.contractDates(input.contracts[0]), mondays);
  assert.deepEqual(Schedule.contractWorkOccurrences(input).map(item => item.scheduledDate), mondays);
  const october = Calendar.buildModel(input, { month: "2026-10", today: "2026-10-13" });
  const november = Calendar.buildModel(input, { month: "2026-11", today: "2026-11-30" });
  assert.deepEqual(october.events.map(item => item.scheduledDate), mondays.slice(0, 2));
  assert.deepEqual(november.events.map(item => item.scheduledDate), mondays.slice(2));
  assert.equal(Calendar.buildModel(input, { month: "2026-12" }).events.length, 0);
  assert.equal(JSON.stringify(input), before);
});

test("weekday boundaries, Sundays, leap days and contract end dates are deterministic", () => {
  assert.deepEqual(Schedule.contractDates(contract({ startDate: "2026-10-19" })), mondays);
  assert.deepEqual(Schedule.contractDates(contract({ cleaningSchedule: { mode: "weekly", weekday: 0 } })), ["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"]);
  assert.deepEqual(Schedule.contractDates(contract({ endDate: "2026-10-26" })), mondays.slice(0, 2));
  assert.deepEqual(Schedule.contractDates(contract({ startDate: "2028-02-28" })), ["2028-02-28", "2028-03-06", "2028-03-13", "2028-03-20"]);
  for (const startDate of ["2026-02-30", "not-a-date", "2026-10-13T00:00:00Z"]) assert.deepEqual(Schedule.contractDates(contract({ startDate })), []);
  assert.deepEqual(Schedule.contractDates(contract({ endDate: "2026-10-01" })), []);
  assert.deepEqual(Schedule.contractDates(contract({ endDate: "2026-02-30" })), []);
});

test("only active cleaning generates explicit repeats; malformed or unlimited recurrence cannot create schedules", () => {
  for (const status of ["계약 준비", "종료 예정", "종료", "cancelled"]) assert.deepEqual(Schedule.contractDates(contract({ status })), []);
  assert.deepEqual(Schedule.contractDates(contract({ types: ["건물관리"] })), []);
  for (const cleaningSchedule of [null, [], { mode: "weekly", weekday: "1" }, { mode: "weekly", weekday: -1 }, { mode: "weekly", weekday: 7 }]) assert.deepEqual(Schedule.contractDates(contract({ cleaningSchedule })), []);
  assert.equal(Schedule.contractDates(contract({ cleaningSchedule: { mode: "weekly", weekday: 1, count: 99999 } })).length, 4);
  assert.deepEqual(Schedule.normalizeCleaningSchedule({ mode: "weekly", weekday: 1, count: 99999 }), { mode: "weekly", weekday: 1, count: 4 });
});

test("legacy text is preserved without guessing a recurrence; one-off work and receipt dates remain separate", () => {
  const legacy = contract({ cleaningSchedule: undefined, serviceFrequency: "주 1회 월요일" });
  delete legacy.cleaningSchedule;
  assert.deepEqual(Schedule.contractDates(legacy), []);
  const once = contract({ billingCycle: "건별", workDate: "2026-10-14", paymentDueDate: "2026-10-30", cleaningSchedule: { mode: "once" } });
  assert.deepEqual(Schedule.contractDates(once), ["2026-10-14"]);
  assert.equal(Core.oneOffContractRows([once], "2026-10")[0].dueDate, "2026-10-30");
  assert.equal(Core.oneOffContractRows([contract()], "2026-10").length, 0);
  assert.equal(Core.sanitizeSharedStore({ contracts: [legacy] }).contracts[0].serviceFrequency, "주 1회 월요일");
});

test("shared snapshot roundtrip preserves the same four occurrences and never mutates or multiplies monthly costs", () => {
  const sanitized = Core.sanitizeSharedStore(store());
  assert.deepEqual(sanitized.contracts[0].cleaningSchedule, { mode: "weekly", weekday: 1, count: 4 });
  const model = Work.buildModel(sanitized, { month: "2026-10", today: "2026-10-19" });
  assert.equal(model.items.length, 4);
  assert.equal(model.kpis.today, 1);
  assert(model.items.every(item => item.kind === "crm_contract" && item.contractId === "contract_a" && item.amount === 0));
  assert.equal(model.kpis.completedCost, 0);
  assert.equal(new Set(model.items.map(item => item.id)).size, 4);
});

test("duplicate contract payloads and already represented work records do not create duplicate occurrences", () => {
  const input = store({ contracts: [contract(), contract()] });
  assert.equal(Schedule.contractWorkOccurrences(input).length, 4);
  input.serviceRecords = [{ id: "record_a", sourceContractId: "contract_a", buildingId: "building_a", scheduledDate: mondays[0], status: "completed" }];
  assert.equal(Schedule.contractWorkOccurrences(input).length, 3);
  const events = Calendar.buildModel(input, { month: "2026-10" }).events;
  assert.equal(events.length, 2);
  assert(events.find(item => item.id === "record_a").completed);
  input.serviceRecords[0].status = "cancelled";
  assert.equal(Calendar.buildModel(input, { month: "2026-10" }).events.length, 1);
  input.serviceRecords[0].buildingId = "different_building";
  assert.equal(Schedule.contractWorkOccurrences(input).length, 4);
});

test("edits replace dates for the same contract and deleted/archived sources disappear without deleting other work", () => {
  const input = store();
  const originalIds = Schedule.contractWorkOccurrences(input).map(item => item.id);
  input.contracts[0].cleaningSchedule.weekday = 3;
  const changed = Schedule.contractWorkOccurrences(input);
  assert.equal(changed.length, 4);
  assert(changed.every(item => !originalIds.includes(item.id)));
  for (const changes of [{ archivedAt: "2026-10-14" }, { deleted: true }, { id: "\ud800" }, { id: "__proto__" }]) assert.deepEqual(Schedule.contractWorkOccurrences(store({ contracts: [contract(changes)] })), []);
  input.contracts = [];
  assert.deepEqual(Schedule.contractWorkOccurrences(input), []);
});

test("a registered contract links exactly its existing CRM customer without promoting the sales stage", () => {
  const input = store({ contracts: [contract(), contract(), contract({ id: "contract_b", customerId: "other" }), contract({ id: "contract_c", deleted: true })] });
  assert.equal(Schedule.registeredContractsForCustomer(input.contracts, "customer_a").length, 1);
  assert.equal(Schedule.registeredContractsForCustomer(input.contracts, "missing").length, 0);
  const helper = app.match(/const customerIsRelationshipCustomer = [\s\S]*?;\r?\n/)[0];
  const context = vm.createContext({ ContractSchedule: Schedule, store: input, customerSalesProgress: () => ({ filterIds: [] }) });
  const included = vm.runInContext(helper + "\ncustomerIsRelationshipCustomer({id:'customer_a',stage:'상담 중'});", context);
  assert.equal(included, true);
  assert.equal(input.customers[0].stage, "상담 중");
  assert.equal(input.customers.length, 1);
});

test("derived calendar controls edit the selected occurrence, not the source contract, and respect viewers", () => {
  const model = Calendar.buildModel(store(), { month: "2026-10", selectedDate: mondays[0] });
  const writer = Calendar.render(model, { canWrite: true });
  assert.match(writer, /data-work-calendar-occurrence="crm-contract:contract_a:2026-10-19"/);
  assert.doesNotMatch(writer, /data-contract-edit/);
  assert.match(writer, /계약에서 자동 연결 · 1\/4회/);
  assert.doesNotMatch(writer, /data-work-calendar-(?:edit|complete)="crm-contract/);
  const viewer = Calendar.render(model, { canWrite: false });
  assert.doesNotMatch(viewer, /data-contract-edit|data-work-calendar-(?:complete|edit|occurrence)/);
  const filtered = Calendar.buildModel(store(), { month: "2026-10", query: "weekly cleaning", buildingId: "building_a" });
  assert.equal(filtered.events.length, 2);
});

test("cleaning controls validate weekday input and escape legacy text in HTML attributes", () => {
  const html = UI.renderFields(contract({ serviceFrequency: '\"><img src=x onerror=bad>' }));
  assert.match(html, /&quot;&gt;&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /name="cleaningScheduleMode"/);
  assert.deepEqual(UI.fromValues({ cleaningScheduleMode: "weekly", cleaningWeekday: "0" }, ["청소"]), { mode: "weekly", weekday: 0, count: 4 });
  assert.throws(() => UI.fromValues({ cleaningScheduleMode: "weekly", cleaningWeekday: "100" }, ["청소"]));
  assert.throws(() => UI.fromValues({ cleaningScheduleMode: "infinite" }, ["청소"]));
  assert.equal(UI.fromValues({}, ["건물관리"]), null);
});

function saveHarness(options = {}) {
  const values = { types: "청소", name: "Fixture weekly cleaning", customerId: "customer_a", buildingId: "building_a", startDate: "2026-10-13", endDate: "", status: "진행 중", billingCycle: "월 정기", cleaningScheduleMode: "weekly", cleaningWeekday: "1", amount: "200000", owner: "Fixture owner", serviceFrequency: "Existing condition", ...options.values };
  const form = { dataset: { contractId: "", returnView: "buildingCalendar", returnTab: "contract", authGeneration: "7", authUid: "fixture_uid", ...options.dataset }, values };
  const input = Core.blankSharedStore();
  input.settings.owner = "Fixture owner";
  input.customers = [{ id: "customer_a", name: "Fixture customer", stage: "상담 중", buildingIds: ["building_a"] }];
  input.buildings = [{ id: "building_a", name: "Fixture building", ownerCustomerId: "customer_a" }];
  const context = vm.createContext({ Core, ContractSchedule: Schedule, ContractScheduleUI: UI, WorkCalendar: Calendar, form, store: input, canWriteCRM: () => options.canWrite !== false, authGeneration: 7, currentAuthUid: () => "fixture_uid", cloneStore: value => structuredClone(value), currentAuth: { user: { uid: "fixture_uid" } }, contractSources: {}, DEFAULT_CONTRACT_READINESS_ITEMS: [], contractPaymentModeFilter: "single", unifiedCalendarTab: "contract", workCalendarDate: "", workCalendarMonth: "", workCalendarBuildingId: "all", workCalendarQuery: "", contractCalendarMonth: "", contractCalendarBuildingId: "all", contractCalendarQuery: "", currentView: "buildingCalendar", messages: [], renders: 0, closed: false, saveCount: 0, queuedSave: null, saveTimer: null, clearTimeout, ensureSalesStore() {}, logAudit() {} });
  context.FormData = class { constructor(item) { this.values = item.values; } entries() { return Object.entries(this.values)[Symbol.iterator](); } getAll(key) { return key === "types" ? [this.values.types] : []; } };
  context.customerById = id => context.store.customers.find(item => item.id === id);
  context.buildingById = id => context.store.buildings.find(item => item.id === id);
  context.customerBuildings = customer => context.store.buildings.filter(item => customer?.buildingIds.includes(item.id));
  context.approvedContractSources = () => [];
  context.readinessForContract = id => context.store.contractReadiness.find(item => item.contractId === id);
  context.showToast = message => context.messages.push(message);
  context.closeModal = () => { context.closed = true; };
  context.render = () => { context.renders++; };
  context.saveStoreNow = async () => { context.saveCount++; if (options.save) await options.save(); context.persisted = Core.sanitizeSharedStore(context.store); };
  const commit = app.match(/  async function commitSharedFormMutation\([\s\S]*?\n  \}/)[0];
  const marker = '} else if (form.id === "contractForm") {';
  const start = app.indexOf(marker) + marker.length;
  const end = app.indexOf('} else if (form.id === "customerForm")', start);
  assert(start > marker.length && end > start);
  vm.runInContext(commit + `\nasync function saveContract(form) {${app.slice(start, end)}\n}`, context);
  return context;
}

test("the real contract submit handler persists one contract and returns to four linked work dates without duplicating customers", async () => {
  const context = saveHarness();
  await context.saveContract(context.form);
  assert.equal(context.persisted.contracts.length, 1);
  assert.equal(context.persisted.customers.length, 1);
  assert.equal(context.persisted.customers[0].stage, "상담 중");
  assert.equal(context.persisted.serviceRecords.length, 0);
  assert.deepEqual(Schedule.contractWorkOccurrences(context.persisted).map(item => item.scheduledDate), mondays);
  assert.equal(context.currentView, "buildingCalendar");
  assert.equal(context.unifiedCalendarTab, "work");
  assert.equal(context.workCalendarDate, mondays[0]);
  assert.equal(context.closed, true);
  context.form.dataset.contractId = context.store.contracts[0].id;
  context.form.values.cleaningWeekday = "3";
  await context.saveContract(context.form);
  assert.equal(context.persisted.contracts.length, 1);
  assert.equal(Schedule.contractWorkOccurrences(context.persisted).length, 4);
  assert.equal(context.workCalendarDate, "2026-10-14");
});

test("the real handler rejects stale sessions, viewers and malformed recurrence before changing records", async () => {
  for (const options of [{ canWrite: false }, { dataset: { authUid: "different_uid" } }, { values: { cleaningWeekday: "9" } }, { values: { startDate: "2026-02-30" } }]) {
    const context = saveHarness(options);
    await context.saveContract(context.form);
    assert.equal(context.store.contracts.length, 0);
    assert.equal(context.saveCount, 0);
  }
});

test("contract customer edits remain in the originating CRM customer screen", async () => {
  const context = saveHarness({ dataset: { returnView: "relationships" } });
  await context.saveContract(context.form);
  assert.equal(context.currentView, "relationships");
  assert.equal(context.persisted.contracts.length, 1);
  assert.equal(context.persisted.customers.length, 1);
});

test("shared save failure rolls back the contract and all derived views, and repeat clicks save once", async () => {
  const failed = saveHarness({ save: async () => { throw new Error("Fixture save rejected"); } });
  await failed.saveContract(failed.form);
  assert.equal(failed.store.contracts.length, 0);
  assert.equal(Schedule.contractWorkOccurrences(failed.store).length, 0);
  assert.equal(failed.closed, false);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const context = saveHarness({ save: () => waiting });
  const first = context.saveContract(context.form);
  await context.saveContract(context.form);
  assert.equal(context.store.contracts.length, 1);
  assert.equal(context.saveCount, 1);
  release(); await first;
  assert.equal(context.persisted.contracts.length, 1);
});

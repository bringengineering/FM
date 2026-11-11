"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Schedule = require("../src/contract-schedule-core");
const UI = require("../src/contract-schedule-ui");
const Core = require("../src/core");
const Calendar = require("../src/work-calendar");
const Work = require("../src/work-management");
const contract = changes => ({ id: "contract_monthly", name: "Fixture cleaning", buildingId: "building_a", customerId: "customer_a", types: ["청소"], status: "진행 중", startDate: "2026-10-01", endDate: "", billingCycle: "월 정기", amount: 50000, paymentDueDate: "2026-10-30", cleaningSchedule: { mode: "twice_monthly", weekday: 4, weekPattern: "first_third", count: 2 }, ...changes });
const store = changes => ({ contracts: [contract()], buildings: [{ id: "building_a", name: "Fixture building" }], customers: [{ id: "customer_a", name: "Fixture customer" }], serviceRecords: [], ...changes });

test("twice-monthly uses the selected weekday's first/third or second/fourth occurrence, never the fifth", () => {
  assert.deepEqual(Schedule.contractDates(contract(), "2026-10"), ["2026-10-01", "2026-10-15"]);
  assert.deepEqual(Schedule.contractDates(contract(), "2026-11"), ["2026-11-05", "2026-11-19"]);
  assert.deepEqual(Schedule.contractDates(contract({ cleaningSchedule: { mode: "twice_monthly", weekday: 4, weekPattern: "second_fourth" } }), "2026-10"), ["2026-10-08", "2026-10-22"]);
  for (let year = 2024; year <= 2032; year++) for (let month = 1; month <= 12; month++) for (let weekday = 0; weekday <= 6; weekday++) for (const weekPattern of ["first_third", "second_fourth"]) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const dates = Schedule.contractDates(contract({ startDate: "2024-01-01", cleaningSchedule: { mode: "twice_monthly", weekday, weekPattern } }), key);
    assert.equal(dates.length, 2, `${key} ${weekday} ${weekPattern}`);
    assert.equal(new Set(dates).size, 2);
    const weeks = weekPattern === "first_third" ? [1, 3] : [2, 4];
    dates.forEach((date, index) => {
      assert.equal(date.slice(0, 7), key);
      assert.equal(new Date(date + "T00:00:00Z").getUTCDay(), weekday);
      assert.equal(Math.ceil(Number(date.slice(8)) / 7), weeks[index]);
    });
  }
});

test("month projections stop at the inclusive contract boundaries and stay bounded without an end date", () => {
  const value = contract({ startDate: "2026-10-02", endDate: "2026-11-18" });
  assert.deepEqual(Schedule.contractDates(value), ["2026-10-15"]);
  assert.deepEqual(Schedule.contractDates(value, "2026-09"), []);
  assert.deepEqual(Schedule.contractDates(value, "2026-10"), ["2026-10-15"]);
  assert.deepEqual(Schedule.contractDates(value, "2026-11"), ["2026-11-05"]);
  assert.deepEqual(Schedule.contractDates(value, "2026-12"), []);
  assert.deepEqual(Schedule.contractDates(contract({ startDate: "2026-10-29" })), ["2026-11-05", "2026-11-19"], "preview the next eligible month, not a third/fifth visit");
  assert.deepEqual(Schedule.contractDates(contract({ startDate: "2026-10-29", endDate: "2026-10-31" })), []);
  assert.deepEqual(Schedule.contractDates(contract({ endDate: "2026-10-15" }), "2026-10"), ["2026-10-01", "2026-10-15"]);
  assert.equal(Schedule.contractDates(contract({ startDate: "1000-01-01" }), "9999-12").length, 2);
  assert.equal(Schedule.contractDates(contract({ startDate: "9999-12-31" })).length, 0);
  for (const month of ["2026-00", "2026-13", "2026-1", "2026-10-01", "infinite", {}, null]) assert.deepEqual(Schedule.contractDates(contract(), month), []);
  for (const changes of [{ startDate: "2026-02-30" }, { endDate: "2026-02-30" }, { endDate: "2026-09-01" }, { status: "종료" }, { status: "cancelled" }, { deleted: true }, { types: ["건물관리"] }]) assert.deepEqual(Schedule.contractDates(contract(changes), "2026-10"), []);
});

test("malformed rules fail closed, count is fixed at two, and legacy weekly schedules keep four total dates", () => {
  for (const schedule of [{ mode: "twice_monthly", weekday: "4", weekPattern: "first_third" }, { mode: "twice_monthly", weekday: 7, weekPattern: "first_third" }, { mode: "twice_monthly", weekday: 4 }, { mode: "twice_monthly", weekday: 4, weekPattern: "first_fifth" }]) {
    assert.equal(Schedule.normalizeCleaningSchedule(schedule), null);
    assert.deepEqual(Schedule.contractDates(contract({ cleaningSchedule: schedule }), "2026-10"), []);
  }
  assert.deepEqual(Schedule.normalizeCleaningSchedule({ mode: "twice_monthly", weekday: 4, weekPattern: "first_third", count: 1000000 }), { mode: "twice_monthly", weekday: 4, weekPattern: "first_third", count: 2 });
  const weekly = contract({ cleaningSchedule: { mode: "weekly", weekday: 4 } });
  assert.deepEqual(Schedule.contractDates(weekly), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
  assert.equal(Calendar.buildModel(store({ contracts: [weekly] }), { month: "2026-11" }).events.length, 0);
});

test("calendar, work management and individual occurrence lookup use the requested month without changing payments or data", () => {
  const input = Core.sanitizeSharedStore(store()), before = JSON.stringify(input);
  const october = Calendar.buildModel(input, { month: "2026-10", selectedDate: "2026-10-15" });
  const november = Calendar.buildModel(input, { month: "2026-11", selectedDate: "2026-11-19" });
  assert.deepEqual(october.events.map(e => e.scheduledDate), ["2026-10-01", "2026-10-15"]);
  assert.deepEqual(november.events.map(e => e.scheduledDate), ["2026-11-05", "2026-11-19"]);
  const id = "crm-contract:contract_monthly:2026-11-19";
  assert.equal(Schedule.contractWorkOccurrence(input, id).scheduledDate, "2026-11-19");
  for (const invalid of ["crm-contract:contract_monthly:2026-10-29", "crm-contract:contract_monthly:2026-02-30", "crm-contract:__proto__:2026-11-19", id + "suffix", null]) assert.equal(Schedule.contractWorkOccurrence(input, invalid), null);
  assert.match(Calendar.render(november, { canWrite: true }), new RegExp(`data-work-calendar-occurrence="${id}"`));
  assert.doesNotMatch(Calendar.render(november, { canWrite: false }), /data-work-calendar-occurrence=/);
  const work = Work.buildModel(input, { month: "2026-11", today: "2026-11-19" });
  assert.equal(work.items.length, 2);
  assert.equal(work.kpis.today, 1);
  assert(work.items.every(item => item.amount === 0 && item.occurrenceCount === 2));
  assert.equal(new Set(work.items.map(item => item.id)).size, 2);
  assert.equal(Core.contractPaymentRows(input.contracts, "2026-10").length, 1);
  assert.equal(Core.contractPaymentRows(input.contracts, "2026-11")[0].dueDate, "2026-11-30");
  assert.equal(JSON.stringify(input), before);
});

test("moved, cancelled and archived occurrences stay suppressed only on their original month/date", () => {
  for (const changes of [{ status: "completed" }, { status: "cancelled" }, { archivedAt: "2026-11-20" }]) {
    const record = { id: "service_existing", sourceContractId: "contract_monthly", sourceContractDate: "2026-11-19", sourceContractBuildingId: "building_a", buildingId: "building_b", scheduledDate: "2026-12-01", ...changes };
    const input = store({ serviceRecords: [record] });
    assert.equal(Schedule.contractWorkOccurrences(input, "2026-10").length, 2);
    assert.deepEqual(Schedule.contractWorkOccurrences(input, "2026-11").map(e => e.scheduledDate), ["2026-11-05"]);
    assert.equal(Schedule.contractWorkOccurrences(input, "2026-12").length, 2);
    assert.equal(Schedule.contractWorkOccurrence(input, "crm-contract:contract_monthly:2026-11-19"), null);
  }
});

test("the editor roundtrips the selected weekday and week pattern with safe text and strict validation", () => {
  const rule = { mode: "twice_monthly", weekday: 0, weekPattern: "second_fourth", count: 2 };
  const html = UI.renderFields(contract({ cleaningSchedule: rule, serviceFrequency: '\"><img src=x>' }));
  assert.match(html, /value="twice_monthly" selected>2주 1회 · 월 2회/);
  assert.match(html, /value="second_fourth" selected/);
  assert.match(html, /value="0" selected/);
  assert.doesNotMatch(html, /<img|data-cleaning-week-pattern-field hidden/);
  assert.match(html, /&lt;img/);
  assert.deepEqual(UI.fromValues({ cleaningScheduleMode: "twice_monthly", cleaningWeekday: "0", cleaningWeekPattern: "second_fourth" }, ["청소"]), rule);
  for (const raw of [{ cleaningWeekday: "bad", cleaningWeekPattern: "first_third" }, { cleaningWeekday: "4", cleaningWeekPattern: "first_fifth" }, { cleaningWeekday: "4" }]) assert.throws(() => UI.fromValues({ cleaningScheduleMode: "twice_monthly", ...raw }, ["청소"]));
  assert.match(Schedule.scheduleLabel(contract()), /월 2회 · 매월 1·3번째 목요일/);
});

test("live preview toggles the extra field and shows a bounded first eligible month rather than four total visits", () => {
  const code = fs.readFileSync(path.join(__dirname, "../src/contract-schedule-ui.js"), "utf8");
  const node = () => ({ textContent: "", children: [], append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; this.textContent = ""; } });
  const preview = node(), weekday = {}, pattern = {};
  const values = { types: "청소", status: "진행 중", startDate: "2026-10-29", cleaningScheduleMode: "twice_monthly", cleaningWeekday: "4", cleaningWeekPattern: "first_third" };
  const form = { values, elements: { cleaningScheduleMode: {} }, ownerDocument: { createElement: node }, querySelectorAll: () => [{ value: "청소" }], querySelector: s => s === "[data-cleaning-schedule-preview]" ? preview : s === "[data-cleaning-weekday-field]" ? weekday : pattern };
  const ctx = vm.createContext({ module: { exports: {} }, require: () => Schedule, FormData: class { constructor(form) { this.values = form.values; } entries() { return Object.entries(this.values); } } });
  vm.runInContext(code, ctx);
  ctx.module.exports.refresh(form);
  assert.equal(pattern.hidden, false);
  assert.equal(weekday.hidden, false);
  assert.match(preview.children[0].textContent, /매월 2회 \(2026-11 미리보기\)/);
  assert.equal(preview.children[1].children.length, 2);
  assert.match(preview.children[2].textContent, /다섯 번째 요일은 제외/);
  values.cleaningScheduleMode = "weekly";
  ctx.module.exports.refresh(form);
  assert.equal(pattern.hidden, true);
  assert.match(preview.children[2].textContent, /총 4회/);
  values.cleaningScheduleMode = "manual";
  ctx.module.exports.refresh(form);
  assert.equal(weekday.hidden, true);
  assert.match(preview.textContent, /자동으로 만들지 않습니다/);
});

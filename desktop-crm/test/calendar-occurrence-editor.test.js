"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const Core = require("../src/core");
const Schedule = require("../src/contract-schedule-core");
const Calendar = require("../src/work-calendar");
const Work = require("../src/work-management");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const editor = source.slice(source.indexOf("  async function contractScheduleOccurrenceEditor("), source.indexOf("  async function deleteBuildingScheduleRecord("));
const submit = source.slice(source.indexOf('    if (form.id === "buildingScheduleForm")'), source.indexOf(' else if (form.id === "workRecordForm")'));
const valueBuilder = source.slice(source.indexOf("  function buildingScheduleCommitValues("), source.indexOf("  const serviceRecordErrorText"));
const esc = v => String(v || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function harness() {
  const store = Core.sanitizeSharedStore({buildings: [{id: "building_1", name: "Fixture"}], contracts: [{id: "contract_1", buildingId: "building_1", owner: "Fixture owner", scope: "Fixture memo", types: ["청소"], name: '공용부청소 <img src=x>', status: "진행 중", startDate: "2026-10-08", billingCycle: "월 정기", amount: 50000, cleaningSchedule: {mode: "weekly", weekday: 4}}]});
  const calls = {toasts: [], opened: 0, commits: [], fieldValues: {}};
  const form = {id: "buildingScheduleForm", isConnected: true, dataset: {}, elements: {buildingId: {}, title: {}, scheduledDate: {}, owner: {}, summary: {}}};
  const ctx = vm.createContext({Core, ContractSchedule: Schedule, WorkCalendar: Calendar, WorkManagement: Work, crypto: crypto.webcrypto, TextEncoder, Uint8Array,
    store, form, authGeneration: 1, uid: "fixture", writable: true, currentAuthUid: () => ctx.uid, canWriteCRM: () => ctx.writable,
    workCalendarBuildingId: "all", workCalendarDate: "2026-10-14", workCalendarMonth: "2026-10", currentView: "buildingCalendar", modalContent: {innerHTML: ""},
    attr: esc, field: (label, name, value) => {calls.fieldValues[name] = value; return `<input name="${name}" value="${esc(value)}">`;},
    selectField: (label, name, options, value) => {calls.fieldValues[name] = value; return `<select name="${name}"></select>`;},
    scheduleOwnerField: value => {calls.fieldValues.owner = value; return "";}, areaField: (label, name, value) => {calls.fieldValues[name] = value; return "";},
    customerManagedBuildingChoices: () => [{value: "building_1"}], customerManagedBuildingChoiceLabel: () => "Fixture", resolveCustomerManagedBuildingSelection: async () => ({id: "building_1"}),
    document: {getElementById: () => form}, bindScheduleOwnerPicker() {}, openModal() {calls.opened++;}, closeModal() {}, render() {}, setTimeout() {}, todayKey: () => "2026-10-14",
    showToast: text => calls.toasts.push(text), serviceRecordErrorText: () => "failed",
    commitBuildingScheduleRecord: async input => {calls.commits.push(input);return {ok: true, record: {...input.values, id: input.recordId}};},
  });
  ctx.FormData = class {entries() {return Object.entries(form.values)[Symbol.iterator]();}};
  vm.runInContext(editor + valueBuilder + `\nasync function submitFixture(){${submit}}`, ctx);
  const occurrence = Schedule.contractWorkOccurrences(store)[1];
  return {ctx, form, calls, occurrence, open: () => ctx.contractScheduleOccurrenceEditor(occurrence.id), submit: () => ctx.submitFixture()};
}

test("clicking a derived date opens the real schedule editor prefilled, without saving or opening a contract", async () => {
  const h = harness(), before = JSON.stringify(h.ctx.store);
  await h.open();
  assert.equal(h.calls.opened, 1);
  assert.match(h.ctx.modalContent.innerHTML, /<h2>업무 일정 수정<\/h2>/);
  assert.match(h.ctx.modalContent.innerHTML, /일정 수정 저장/);
  assert.match(h.ctx.modalContent.innerHTML, /선택한 날짜의 업무 일정만 수정/);
  assert.doesNotMatch(h.ctx.modalContent.innerHTML, /계약 상세·수정|<img|data-work-calendar-delete=/);
  assert.equal(h.calls.fieldValues.scheduledDate, "2026-10-15");
  assert.equal(h.calls.fieldValues.buildingId, "building_1");
  assert.equal(h.calls.fieldValues.owner, "Fixture owner");
  assert.equal(h.calls.fieldValues.summary, "Fixture memo");
  assert.equal(h.calls.commits.length, 0);
  assert.equal(JSON.stringify(h.ctx.store), before);

  const html = h.ctx.modalContent.innerHTML;
  const recordId = html.match(/data-schedule-id="([^"]+)"/)[1];
  h.form.dataset = {scheduleCreate: "true", scheduleId: recordId, requestId: crypto.randomUUID(), contractOccurrenceId: h.occurrence.id, authGeneration: "1", authUid: "fixture"};
  h.form.values = {buildingId: "building_1", title: "공용부청소", scheduledDate: "2026-10-16", startTime: "09:00", endTime: "10:00", status: "completed", serviceType: "cleaning", owner: "Selected staff", summary: "Finished"};
  await h.submit();
  assert.equal(h.calls.commits.length, 1);
  const intent = JSON.parse(JSON.stringify(h.calls.commits[0]));
  assert.deepEqual(intent.contractOccurrence, {contractId: "contract_1", date: "2026-10-15", buildingId: "building_1"});
  assert.equal(intent.recordId, recordId);
  assert.equal(intent.operation, "create");
  assert.equal(intent.values.status, "completed");
  assert.equal(intent.values.scheduledDate, "2026-10-16");
  assert.equal(intent.values.owner, "Selected staff");
  assert.equal(intent.values.amount, 0, "monthly contract amount is not multiplied into a visit cost");
  assert.equal(JSON.stringify(h.ctx.store), before);
});

test("viewers, changed sessions and stale source dates cannot open or submit a derived edit", async () => {
  const viewer = harness(); viewer.ctx.writable = false; await viewer.open(); assert.equal(viewer.calls.opened, 0);
  const switched = harness();
  let resolve;
  switched.ctx.crypto = {subtle: {digest: () => new Promise(done => {resolve = done;})}};
  const pending = switched.open(); switched.ctx.uid = "replacement"; resolve(new ArrayBuffer(32)); await pending;
  assert.equal(switched.calls.opened, 0);
  const stale = harness(); await stale.open();
  stale.form.dataset = {scheduleCreate: "true", contractOccurrenceId: stale.occurrence.id, authGeneration: "1", authUid: "fixture"};
  stale.form.values = {}; stale.ctx.store.contracts = [];
  await stale.submit(); assert.equal(stale.calls.commits.length, 0);
});

test("future-month twice-monthly calendar clicks prefill the selected visit without changing the contract", async () => {
  const h = harness();
  h.ctx.store.contracts[0].startDate = "2026-10-01";
  h.ctx.store.contracts[0].cleaningSchedule = { mode: "twice_monthly", weekday: 4, weekPattern: "first_third", count: 2 };
  const before = JSON.stringify(h.ctx.store);
  await h.ctx.contractScheduleOccurrenceEditor("crm-contract:contract_1:2026-11-19");
  assert.equal(h.calls.opened, 1);
  assert.equal(h.calls.fieldValues.scheduledDate, "2026-11-19");
  assert.equal(JSON.stringify(h.ctx.store), before);
  await h.ctx.contractScheduleOccurrenceEditor("crm-contract:contract_1:2026-10-29");
  assert.equal(h.calls.opened, 1, "the fifth weekday is not an editable projected occurrence");
});

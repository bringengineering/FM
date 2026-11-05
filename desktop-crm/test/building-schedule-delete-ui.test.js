"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ContractSchedule = require("../src/contract-schedule-core");
const {planBuildingScheduleCommit} = require("../src/remote");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const deleteSource = source.slice(source.indexOf("  async function deleteBuildingScheduleRecord("), source.indexOf("  function workRecordEditor("));
const editorSource = source.slice(source.indexOf("  function buildingScheduleEditor("), source.indexOf("  async function deleteBuildingScheduleRecord("));

function harness(options = {}) {
  const calls = {commits: [], confirmations: [], toasts: [], closed: 0, renders: 0};
  const item = {id: "service_fixture", buildingId: "building_fixture", status: "completed", title: "공용부청소", scheduledDate: "2026-10-06", updatedAt: "opened", calendarCommitVersion: 4};
  const button = {disabled: false, isConnected: true};
  const form = {isConnected: true, dataset: {scheduleId: item.id, authGeneration: "1", authUid: "fixture", openedUpdatedAt: "opened", openedCommitVersion: "4"}, querySelector: () => button};
  const ctx = vm.createContext({
    authGeneration: 1, uid: "fixture", writable: true, modalOpen: true,
    currentAuthUid: () => ctx.uid, canWriteCRM: () => ctx.writable,
    store: {serviceRecords: [item]}, buildingById: () => ({name: "예시빌라"}),
    modal: {classList: {contains: () => ctx.modalOpen}},
    crypto: {randomUUID: () => "550e8400-e29b-41d4-a716-446655440014"},
    requestConfirmation: async config => {calls.confirmations.push(config);return options.confirm ? options.confirm(ctx, form) : true;},
    commitBuildingScheduleRecord: async input => {calls.commits.push(input);return options.result || {ok: true, record: {...item, archivedAt: "2026-10-14T00:00:00.000Z"}};},
    closeModal: () => {calls.closed++;}, render: () => {calls.renders++;}, renderBuildingCalendar: () => {calls.renders++;}, pageMeta() {},
    showToast: (text, tone) => {calls.toasts.push({text, tone});}, serviceRecordErrorText: () => "일정을 삭제하지 못했습니다.",
  });
  vm.runInContext(deleteSource, ctx);
  return {ctx, calls, form, item, button, run: () => ctx.deleteBuildingScheduleRecord(item.id, form)};
}

function projectedHarness(options = {}) {
  const h = harness(options);
  const contract = {id:"fixture_contract",buildingId:"building_fixture",name:"Fixture weekly cleaning",types:["청소"],status:"진행 중",startDate:"2026-10-01",billingCycle:"월 정기",cleaningSchedule:{mode:"weekly",weekday:4}};
  h.ctx.ContractSchedule = ContractSchedule;
  h.ctx.store = {contracts:[contract],serviceRecords:[]};
  const occurrence = ContractSchedule.contractWorkOccurrences(h.ctx.store)[1];
  const identity = ContractSchedule.occurrenceIdentity(contract.id,occurrence.scheduledDate,occurrence.buildingId);
  h.item.id = `service_contract_${crypto.createHash("sha256").update(identity).digest("hex")}`;
  Object.assign(h.form.dataset,{scheduleId:h.item.id,contractOccurrenceId:occurrence.id,openedUpdatedAt:"",openedCommitVersion:"0"});
  h.ctx.commitBuildingScheduleRecord = async input => {
    h.calls.commits.push(JSON.parse(JSON.stringify(input)));
    if(options.fail)return {ok:false,code:"BUILDING_SCHEDULE_WRITE_FAILED"};
    const planned=planBuildingScheduleCommit(input,{contract,building:{id:contract.buildingId},actor:{uid:"fixture",role:"member"}});
    h.ctx.store.serviceRecords.push(planned.record);
    return {ok:true,record:planned.record};
  };
  return {...h,contract,occurrence};
}

test("the actual delete handler archives exactly the selected projected date without saving form edits or the contract",async()=>{
  const h=projectedHarness(),before=JSON.stringify(h.contract);
  await h.run();
  assert.equal(h.calls.commits.length,1);
  assert.equal(h.calls.commits[0].operation,"archive");
  assert.deepEqual(h.calls.commits[0].contractOccurrence,{contractId:h.contract.id,date:"2026-10-08",buildingId:"building_fixture"});
  assert.equal("values" in h.calls.commits[0],false);
  assert.match(h.calls.confirmations[0].description,/원래 계약과 다른 날짜/);
  assert.match(h.calls.confirmations[0].message,/2026-10-08/);
  assert.equal(JSON.stringify(h.contract),before);
  assert.deepEqual(ContractSchedule.contractWorkOccurrences(h.ctx.store).map(r=>r.scheduledDate),["2026-10-01","2026-10-15","2026-10-22"]);
  assert.equal(h.calls.closed,1);
});

test("projected deletion cancellation, concurrent edits, changed roles, failures and repeated clicks never remove other visits",async()=>{
  for(const options of [{confirm:()=>false},{confirm:c=>{c.store.contracts[0].startDate="2026-11-01";return true;}},{confirm:c=>{c.writable=false;return true;}},{fail:true}]){
    const h=projectedHarness(options);await h.run();
    assert.equal(h.ctx.store.serviceRecords.length,0);
    assert.equal(h.calls.toasts.some(t=>t.tone==="success"),false);
    assert.equal(h.button.disabled,false);
  }
  let accept;const h=projectedHarness({confirm:()=>new Promise(r=>{accept=r;})});
  const first=h.run();await h.run();accept(true);await first;
  assert.equal(h.calls.confirmations.length,1);assert.equal(h.calls.commits.length,1);
  const stale=projectedHarness({confirm:c=>{c.store.serviceRecords.push({id:stale.item.id});return true;}});
  await stale.run();assert.equal(stale.calls.commits.length,0);
});

test("completed schedule deletion asks about the exact saved title and date then sends a closed archive intent", async () => {
  const h = harness(); await h.run();
  assert.equal(h.calls.confirmations.length, 1);
  assert.equal(h.calls.confirmations[0].target, "공용부청소");
  assert.equal(h.calls.confirmations[0].message, "2026-10-06 · 예시빌라");
  assert.match(h.calls.confirmations[0].warning, /고객·건물 정보와 보고서는 삭제하지 않습니다/);
  assert.equal(h.calls.commits.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.commits[0])), {operation: "archive", requestId: "550e8400-e29b-41d4-a716-446655440014", recordId: "service_fixture", expectedUpdatedAt: "opened", expectedCommitVersion: 4});
  assert.equal(h.item.archivedAt, undefined, "renderer does not optimistically mutate the original");
  assert.equal(h.calls.closed, 1); assert.equal(h.calls.toasts.at(-1).tone, "success");
  assert.equal(h.form.dataset.deleting, "false"); assert.equal(h.button.disabled, false);
});

test("cancellation and closed, switched or permission-revoked forms never delete", async () => {
  const changes = [(_c, f) => {f.isConnected=false;}, c => {c.authGeneration++;}, c => {c.uid="different";}, c => {c.writable=false;}, c => {c.modalOpen=false;}];
  const cancelled = harness({confirm: () => false}); await cancelled.run(); assert.equal(cancelled.calls.commits.length, 0);
  for (const change of changes) {
    const h = harness({confirm: (c,f) => {change(c,f);return true;}}); await h.run();
    assert.equal(h.calls.commits.length, 0); assert.equal(h.calls.toasts.some(t => t.tone === "success"), false);
  }
  const viewer = harness();viewer.ctx.writable=false;await viewer.run();assert.equal(viewer.calls.confirmations.length, 0);
  const switched = harness();switched.ctx.uid="different";await switched.run();assert.equal(switched.calls.confirmations.length, 0);
});

test("double clicks share one confirmation and one commit; failure keeps deletion unconfirmed", async () => {
  let confirm;
  const h = harness({confirm: () => new Promise(resolve => {confirm=resolve;})});
  const pending = h.run(); await h.run();
  assert.equal(h.calls.confirmations.length, 1); assert.equal(h.button.disabled, true);
  confirm(true); await pending; assert.equal(h.calls.commits.length, 1);
  for (const result of [{ok:false,code:"BUILDING_SCHEDULE_WRITE_FAILED"},{ok:false,code:"BUILDING_SCHEDULE_CONFLICT"},{ok:false,stale:true},{ok:true,record:{id:"other",archivedAt:"fixture"}}]) {
    const failed = harness({result}); await failed.run();
    assert.equal(failed.calls.toasts.some(t => t.tone === "success"), false);
    assert.equal(failed.item.archivedAt, undefined);
  }
});

test("approved delete button is visible for every editable existing schedule, never create, viewer or archived records", () => {
  for (const status of ["planned", "in_progress", "completed", "cancelled"]) {
    const form = {elements:{buildingId:{},title:{},scheduledDate:{},owner:{},summary:{}}};
    const ctx = vm.createContext({canWriteCRM:()=>true,store:{serviceRecords:[{id:"fixture",buildingId:"building",status}],settings:{}},customerManagedBuildingChoices:()=>[],workCalendarBuildingId:"all",workCalendarDate:"2026-10-06",authGeneration:1,currentAuthUid:()=>"fixture",crypto:{randomUUID:()=>"fixture"},modalContent:{innerHTML:""},attr:v=>String(v).replaceAll('"','&quot;'),field:()=>"",selectField:()=>"",areaField:()=>"",scheduleOwnerField:()=>"",openModal(){},bindScheduleOwnerPicker(){},document:{getElementById:()=>form},setTimeout(){},showToast(){},todayKey:()=>"2026-10-06",WorkManagement:{statusLabel:v=>v,typeLabel:v=>v}});
    vm.runInContext(editorSource,ctx); ctx.buildingScheduleEditor("fixture");
    assert.equal(ctx.modalContent.innerHTML.includes('data-work-calendar-delete="fixture"'), status !== "cancelled");
    assert.match(ctx.modalContent.innerHTML, /일정 수정 저장/);
    ctx.store.serviceRecords[0].archivedAt="fixture";ctx.modalContent.innerHTML="";ctx.buildingScheduleEditor("fixture");assert.equal(ctx.modalContent.innerHTML, "");
    ctx.writable=false;ctx.canWriteCRM=()=>false;ctx.modalContent.innerHTML="";ctx.buildingScheduleEditor("fixture");assert.equal(ctx.modalContent.innerHTML, "");
    ctx.canWriteCRM=()=>true;ctx.customerManagedBuildingChoices=()=>[{value:"building"}];ctx.modalContent.innerHTML="";ctx.buildingScheduleEditor("");
    assert.match(ctx.modalContent.innerHTML, /업무 일정 추가/);
    assert.equal(ctx.modalContent.innerHTML.includes("data-work-calendar-delete"), false);
  }
  assert.match(source, /calendarDelete\.dataset\.workCalendarDelete, calendarDelete\.closest\("#buildingScheduleForm"\)/);
  assert.match(source, /form\.dataset\.submitting === "true" \|\| form\.dataset\.deleting === "true"/);
});

test("deleted schedules disappear from calendars, work lists, TV and operating checks while originals stay stored", () => {
  const Core = require("../src/core"); const Calendar = require("../src/work-calendar"); const Work = require("../src/work-management"); const Board = require("../src/company-wallboard"); const Check = require("../src/operations-check-core");
  const archived = {id:"deleted",buildingId:"building",title:"삭제 일정",status:"completed",scheduledDate:"2026-10-14",completedAt:"2026-10-14",archivedAt:"2026-10-14T00:00:00.000Z",amount:100};
  const store = Core.sanitizeSharedStore({buildings:[{id:"building",name:"예시빌라"}],serviceRecords:[archived]});
  assert.equal(store.serviceRecords.length, 1);
  assert.equal(Calendar.buildModel(store,{month:"2026-10",today:"2026-10-14",includeCancelled:true}).events.length, 0);
  assert.equal(Work.buildModel(store,{month:"2026-10",today:"2026-10-14"}).items.length, 0);
  assert.equal(Board.schedule(store,"2026-10-14").week.length, 0);
  const projected = Check.projectOperationsSource(store);
  assert.equal(projected.serviceRecords[0].archivedAt, archived.archivedAt);
  const checks = Check.buildOperationsCheck(projected,{today:"2026-10-14",availability:{serviceRecords:true,buildings:true,customers:true,contracts:true,serviceContracts:true}});
  assert.equal(checks.issues.some(i=>i.source==="serviceRecords"), false);
  assert.equal(store.serviceRecords[0].completedAt, "2026-10-14");
});

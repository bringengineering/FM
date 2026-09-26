const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Work = require("../src/work-management");

const store = {
  buildings: [{ id: "building_bukwon_2475_93", name: "북원로2475번길93", address: "원주시 북원로 2475번길 93" }],
  serviceRecords: [{ id: "mow", buildingId: "building_bukwon_2475_93", serviceType: "grounds_cutting", status: "completed", completedAt: "2026-08-15", amount: 150000, vendorName: "사계절제초작업", evidenceUrl: "https://drive.google.com/file/d/source/view" }],
  serviceContracts: [{ id: "stairs", buildingId: "building_bukwon_2475_93", serviceType: "stair_cleaning", status: "planned", cadence: "weekly", monthlyAmount: 60000, startDate: "" }],
  serviceSchedules: [],
};

test("builds separate completed-cost and recurring-cost KPIs", () => {
  const model = Work.buildModel(store, { month: "2026-08", today: "2026-08-17" });
  assert.equal(model.kpis.completed, 1);
  assert.equal(model.kpis.planned, 1);
  assert.equal(model.kpis.completedCost, 150000);
  assert.equal(model.kpis.recurringMonthlyCost, 60000);
  assert.equal(model.items.length, 2);
});

test("renders the confirmed work, contract, and safe evidence action", () => {
  const html = Work.renderDashboard(Work.buildModel(store, { month: "2026-08", today: "2026-08-17" }), { canWrite: true });
  assert.match(html, /예초 작업/);
  assert.match(html, /150,000원/);
  assert.match(html, /계단 청소/);
  assert.match(html, /주 1회/);
  assert.match(html, /data-work-evidence=/);
});

test("does not label an unavailable server payload as an empty work list", () => {
  const model = Work.buildModel(null, { available: false });
  assert.equal(model.available, false);
  assert.match(Work.renderDashboard(model), /동기화 확인 필요/);
});

test("desktop entry moves work management under the contract calendar", () => {
  const root = path.join(__dirname, "..", "src");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.equal((index.match(/data-view="workManagement"/g) || []).length, 0);
  assert.ok(index.indexOf("work-management.js") < index.indexOf("app.js"));
  assert.match(app, /WorkManagement\.renderDashboard/);
  assert.match(app, /currentView === "workManagement"/);
  assert.match(app, /data-contract-work-panel/);
  assert.match(app, /const workAction = canWriteCRM\(\) \? `<div class="operations-actions"><button[^>]+data-action="new-work-record"/);
  assert.match(app, /class="operations-hero work-management-hero"[\s\S]*?\$\{workAction\}/);
});

test("projects each one-off CRM contract into one editable linked work item", () => {
  const model = Work.buildModel({
    buildings: store.buildings,
    serviceRecords: [],
    serviceContracts: [],
    contracts: [
      { id: "once_1", billingCycle: "건별", name: "예초 작업", buildingId: "building_bukwon_2475_93", status: "진행 중", workDate: "2026-08-21", vendorCost: 140000, scope: "외부 예초 및 정리" },
      { id: "monthly_1", billingCycle: "월 정기", name: "정기 관리", buildingId: "building_bukwon_2475_93", status: "진행 중", startDate: "2026-08-01", amount: 60000 },
    ],
  }, { month: "2026-08", today: "2026-08-21" });
  assert.equal(model.items.length, 1);
  assert.deepEqual(model.items[0], {
    kind: "crm_contract",
    id: "once_1",
    contractId: "once_1",
    buildingId: "building_bukwon_2475_93",
    serviceType: "grounds_cutting",
    title: "예초 작업",
    status: "in_progress",
    scheduledDate: "2026-08-21",
    completedAt: "",
    owner: "",
    vendorName: "",
    amount: 140000,
    summary: "외부 예초 및 정리",
    evidenceUrl: "",
    building: store.buildings[0],
  });
  assert.equal(model.kpis.today, 1);
  const html = Work.renderDashboard(model, { canWrite: true });
  assert.match(html, /data-work-kind="crm_contract"/);
  assert.match(html, /data-contract-edit="once_1"/);
  assert.doesNotMatch(html, /data-work-edit="once_1"/);
  assert.match(html, /계약 일정에서 자동 연동/);
});

test("completed work renders operations sync state and retry only when required", () => {
  const requiredStore = {
    buildings: store.buildings,
    serviceRecords: [{ ...store.serviceRecords[0], operationsSyncStatus: "required" }],
    serviceContracts: [],
  };
  const required = Work.renderDashboard(Work.buildModel(requiredStore), { canWrite: true });
  assert.match(required, /운영 분석 연동 필요/);
  assert.match(required, /data-work-sync-retry="mow"/);

  const syncedStore = {
    buildings: store.buildings,
    serviceRecords: [{ ...store.serviceRecords[0], operationsSyncStatus: "synced" }],
    serviceContracts: [],
  };
  const synced = Work.renderDashboard(Work.buildModel(syncedStore), { canWrite: true });
  assert.match(synced, /운영 분석 연동 완료/);
  assert.doesNotMatch(synced, /data-work-sync-retry/);
});

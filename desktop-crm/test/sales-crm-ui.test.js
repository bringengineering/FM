const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const Sales = require("../src/sales-core");
const Standards = require("../src/sales-standards");
const SalesUI = require("../src/sales-ui");

const sampleStore = {
  salesProspects: [Sales.createSalesProspect({
    id: "spr_1", name: "대학로 원룸", address: "원주시 우산동 1",
    owner: "황우중", priority: "high", stage: "listing_received",
    vacancyCount: 1, upcomingVacancyCount: 1, nextAction: "광고 게시 확인",
    nextActionAt: "2026-08-13T03:00:00.000Z"
  })],
  salesContacts: [Sales.createSalesContact({
    id: "sct_1", prospectId: "spr_1", name: "건물주", phone: "010-1111-2222",
    source: "building_sign", verifiedAt: "2026-08-10T00:00:00.000Z"
  })],
  salesUnits: [Sales.createSalesUnit({ id: "sun_1", prospectId: "spr_1", label: "201호", status: "vacant" })],
  salesActivities: [],
  salesEvents: [Sales.createSalesEvent({
    id: "sev_1", prospectId: "spr_1", unitId: "sun_1", type: "listing_received",
    evidenceType: "broker_handoff", evidenceNote: "이지부동산 접수 확인",
    occurredAt: "2026-08-12T00:00:00.000Z"
  })],
  salesOpportunities: [Sales.createSalesOpportunity({
    id: "sop_1", prospectId: "spr_1", serviceType: "waterproofing", stage: "quote_requested",
    requirements: "지하실 방수", owner: "김현진"
  })]
};

test("sales pipeline renders an evidence-backed building dashboard and all 13 stage controls", () => {
  const html = SalesUI.renderPipeline({
    store: sampleStore,
    stages: Sales.SALES_STAGES,
    kpis: Sales.calculateKpis(sampleStore),
    selectedStage: "all",
    query: "",
    now: "2026-08-13T12:00:00.000Z"
  });

  assert.match(html, /공실 해결로 첫 관계를 만들고/);
  assert.match(html, /대학로 원룸/);
  assert.match(html, /매물접수/);
  assert.match(html, /오늘 후속/);
  assert.equal((html.match(/data-sales-stage-filter=/g) || []).length, 14);
  assert.match(html, /data-sales-prospect-open="spr_1"/);
  assert.match(html, /data-action="new-sales-prospect"/);
  assert.match(html, /data-action="open-sales-standards"/);
});

test("prospect detail keeps contacts, units, activity, outcomes and add-on work under one building", () => {
  const html = SalesUI.renderProspectDetail({
    prospect: sampleStore.salesProspects[0],
    contacts: sampleStore.salesContacts,
    units: sampleStore.salesUnits,
    activities: sampleStore.salesActivities,
    events: sampleStore.salesEvents,
    opportunities: sampleStore.salesOpportunities,
    stages: Sales.SALES_STAGES,
    writable: true
  });

  for (const label of ["건물 기본정보", "연락처", "호실", "영업 활동", "완료 증거", "추가서비스"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /지하실 방수/);
  assert.match(html, /data-sales-add-contact="spr_1"/);
  assert.match(html, /data-sales-add-unit="spr_1"/);
  assert.match(html, /data-sales-add-activity="spr_1"/);
  assert.match(html, /data-sales-add-event="spr_1"/);
  assert.match(html, /data-sales-add-opportunity="spr_1"/);
});

test("standards center exposes every script and checklist with approval warnings", () => {
  const html = SalesUI.renderStandards({ standards: Standards, query: "" });
  assert.equal((html.match(/data-sales-script=/g) || []).length, 12);
  assert.equal((html.match(/data-sales-checklist=/g) || []).length, 8);
  assert.match(html, /검증기준문 S1/);
  assert.match(html, /법률검토/);
  assert.match(html, /계약률이 아니라 매물접수 관찰치/);
});

test("prospect and evidence forms have visible labels and explicit save actions", () => {
  const prospectForm = SalesUI.renderProspectForm({ item: {}, crmBuildings: [], actor: "팀원" });
  const eventForm = SalesUI.renderEventForm({
    prospect: sampleStore.salesProspects[0],
    units: sampleStore.salesUnits,
    eventTypes: Standards.funnelEvents
  });

  assert.match(prospectForm, /<form[^>]+id="salesProspectForm"/);
  assert.match(prospectForm, /<span>건물명/);
  assert.match(prospectForm, /<span>주소/);
  assert.match(prospectForm, /건물 등록/);
  assert.match(eventForm, /<form[^>]+id="salesEventForm"/);
  assert.match(eventForm, /완료 증거/);
  assert.match(eventForm, /단계 완료 기록/);
});

test("desktop entry reuses the one existing pipeline menu and loads sales modules before app", async () => {
  const html = await readFile(path.join(__dirname, "..", "src", "index.html"), "utf8");
  const app = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");

  assert.equal((html.match(/data-view="pipeline"/g) || []).length, 1);
  assert.ok(html.indexOf("./sales-core.js") < html.indexOf("./sales-ui.js"));
  assert.ok(html.indexOf("./sales-standards.js") < html.indexOf("./sales-ui.js"));
  assert.ok(html.indexOf("./sales-ui.js") < html.indexOf("./app.js"));
  assert.match(html, /sales\.css/);
  assert.doesNotMatch(html, /sales-crm\.html/);
  assert.match(app, /store\.salesProspects/);
  assert.match(app, /new-sales-prospect/);
  assert.match(app, /salesProspectForm/);
  assert.doesNotMatch(app, /crm:sales-login|salesLogin/);
});

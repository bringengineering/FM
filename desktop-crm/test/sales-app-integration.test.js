const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const appSource = () => readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("sales records participate in the existing shared-store rebase", async () => {
  const app = await appSource();
  const sharedCollections = app.match(/const sharedStoreCollections = \[([\s\S]*?)\];/)?.[1] || "";
  for (const collection of [
    "salesProspects", "salesContacts", "salesUnits",
    "salesActivities", "salesEvents", "salesOpportunities"
  ]) assert.match(sharedCollections, new RegExp(`"${collection}"`));
});

test("the existing pipeline is driven by the building sales modules", async () => {
  const app = await appSource();
  assert.match(app, /const Sales = window\.BringSalesCore/);
  assert.match(app, /const SalesUI = window\.BringSalesUI/);
  assert.match(app, /const SalesStandards = window\.BringSalesStandards/);
  assert.match(app, /function renderPipeline\(\)[\s\S]*SalesUI\.renderPipeline/);
  assert.match(app, /store\.salesProspects/);
  assert.match(app, /Sales\.calculateKpis/);
  assert.match(app, /salesStageFilter/);
  assert.match(app, /searchEl\.value/);
  assert.match(app, /function renderArchivedSalesProspects\(/);
  assert.match(app, /보관된 영업 대상/);
});

test("sales detail CRUD uses evidence, opt-out, audit and the current save path", async () => {
  const app = await appSource();
  for (const editor of [
    "salesProspectEditor", "salesContactEditor", "salesUnitEditor",
    "salesActivityEditor", "salesEventEditor", "salesOpportunityEditor"
  ]) assert.match(app, new RegExp(`function ${editor}`));
  for (const form of [
    "salesProspectForm", "salesContactForm", "salesUnitForm",
    "salesActivityForm", "salesEventForm", "salesOpportunityForm"
  ]) assert.match(app, new RegExp(form));
  assert.match(app, /prospect_created/);
  assert.match(app, /function salesEventOptions\(/);
  assert.match(app, /eventTypes:\s*salesEventOptions\(\)/);
  assert.match(app, /최초접촉 완료 증거에는 채널과 결과가 필요합니다/);
  assert.match(app, /const actor = salesActor\(\);[\s\S]*?const eventValues = \{[\s\S]*?createdBy:\s*actor\.email[\s\S]*?Sales\.createSalesEvent\(eventValues, eventContext\)/);
  assert.match(app, /Sales\.(?:stageFromEvents|nextStageFromEvents)/);
  assert.match(app, /const salesStageFromEvents = prospectId => Sales\.stageFromEvents/);
  assert.doesNotMatch(app, /typeof Sales\.nextStageFromEvents/);
  assert.match(app, /createSalesActivity\([\s\S]*contacts/);
  assert.match(app, /createSalesOpportunity/);
  assert.match(app, /function recalculateSalesProspectVacancies\(/);
  assert.match(app, /data-sales-prospect-archive/);
  assert.match(app, /data-sales-prospect-restore/);
  assert.match(app, /logAudit\(/);
  assert.match(app, /scheduleSave\(\)/);
});

test("standards open inside the current CRM without a second login", async () => {
  const app = await appSource();
  assert.match(app, /open-sales-standards/);
  assert.match(app, /SalesUI\.renderStandards/);
  assert.doesNotMatch(app, /crm:sales-login|salesLogin/);
});

test("demo and smoke snapshots expose synthetic sales data without production seeding", async () => {
  const app = await appSource();
  assert.match(app, /function demoStore\(\)[\s\S]*data\.salesProspects/);
  assert.match(app, /데모 원룸/);
  assert.match(app, /salesProspects:\s*store\.salesProspects\.length/);
  assert.match(app, /salesEvents:\s*store\.salesEvents\.length/);
  assert.match(app, /salesOpportunities:\s*store\.salesOpportunities\.length/);
});

test("pipeline focus and flow controls keep their selected mode across rerenders", async () => {
  const app = await appSource();
  assert.match(app, /event\.target\.closest\("\[data-sales-board-mode\]"\)/);
  assert.match(app, /\["focus",\s*"flow"\]\.includes\(nextMode\)/);
  assert.match(app, /salesBoardMode\s*=\s*nextMode;\s*renderPipeline\(\)/);
  assert.match(app, /boardMode:\s*salesBoardMode/);
});

test("pipeline KPI context declares its period and owner distribution", async () => {
  const app = await appSource();
  assert.match(app, /const kpis = Sales\.calculateKpis\(store,\s*\{\s*now\s*\}\)/);
  assert.match(app, /periodLabel:\s*"전체 기간 누계"/);
  assert.match(app, /ownerCounts:\s*kpis\.(?:activeProspectsByOwner|activeByOwner)/);
});

test("prospect detail receives the complete active audit context for its related sales records", async () => {
  const app = await appSource();
  assert.match(app, /function salesAuditLogsForProspect\(prospectId\)/);
  assert.match(app, /relatedIds\.has\(log\.targetId\)/);
  assert.match(app, /auditLogs:\s*salesAuditLogsForProspect\(prospect\.id\)/);
});

test("sales event capture sends hardened evidence and full relation context without rewriting an explicit date", async () => {
  const app = await appSource();
  const eventSubmit = app.match(/else if \(form\.id === "salesEventForm"\) \{([\s\S]*?)\} else if \(form\.id === "salesOpportunityForm"\)/)?.[1] || "";
  for (const fieldName of ["channel", "result", "owner", "managementStartedAt", "serviceScope"]) {
    assert.match(app, new RegExp(`name=["']${fieldName}["']|["']${fieldName}["']`));
  }
  assert.match(app, /broker_confirmation/);
  assert.match(app, /협력 공인중개사의 계약완료 확인/);
  assert.match(app, /management_start/);
  assert.match(app, /service_contract/);
  assert.match(eventSubmit, /occurredAt:\s*String\(raw\.occurredAt\s*\|\|\s*""\)\.trim\(\)/);
  assert.doesNotMatch(eventSubmit, /occurredAt:\s*raw\.occurredAt\s*\?\s*new Date\(raw\.occurredAt\)\.toISOString\(\)/);
  assert.match(eventSubmit, /const eventContext = salesRelationContext\(actor\)[\s\S]*?createSalesEvent\(eventValues, eventContext\)/);
});

test("sales activities validate against full relations and the signed-in actor", async () => {
  const app = await appSource();
  assert.match(app, /function salesRelationContext\(actor\)/);
  for (const collection of ["prospects", "contacts", "units", "opportunities"]) {
    assert.match(app, new RegExp(`${collection}:\\s*store\\.sales`));
  }
  assert.match(app, /const activityContext = salesRelationContext\(actor\)/);
  assert.match(app, /Sales\.assertActivity\(activityValues, activityContext\)/);
  assert.match(app, /Sales\.createSalesActivity\(activityValues, activityContext\)/);
});

test("opportunity milestone dates are preserved and assigned only by the domain model", async () => {
  const app = await appSource();
  assert.match(app, /const transitionAt = new Date\(\)\.toISOString\(\)/);
  assert.match(app, /Sales\.createSalesOpportunity\(opportunityValues, actor, transitionAt\)/);
  assert.doesNotMatch(app, /workCompletedAt:\s*(?:transitionAt|new Date)/);
  assert.doesNotMatch(app, /revenueRecordedAt:\s*(?:transitionAt|new Date)/);
});

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
  assert.match(app, /const actor = salesActor\(\);\s*const item = Sales\.createSalesEvent\(\{[\s\S]*?createdBy:\s*actor\.email/);
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

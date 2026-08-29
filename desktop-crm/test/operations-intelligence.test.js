const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = file => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

test("operation lifecycle records timestamps and rejects invalid backward transitions", () => {
  const Ops = require("../src/operations-intelligence-core");
  const created = Ops.createOperation({ title: "누수 점검", urgency: "high" }, { now: "2026-08-29T01:00:00.000Z", userId: "u1" });
  const triaged = Ops.transition(created, "triaged", { now: "2026-08-29T01:05:00.000Z", userId: "u1" });
  assert.equal(triaged.status, "triaged");
  assert.equal(triaged.triagedAt, "2026-08-29T01:05:00.000Z");
  assert.equal(triaged.statusHistory.length, 2);
  assert.throws(() => Ops.transition(triaged, "created", { now: "2026-08-29T01:06:00.000Z", userId: "u1" }), /변경할 수 없습니다/);
});

test("quick completion captures human work and produces dashboard metrics", () => {
  const Ops = require("../src/operations-intelligence-core");
  const base = Ops.createOperation({ title: "예초", category: "grounds" }, { now: "2026-08-29T01:00:00.000Z", userId: "u1" });
  const done = Ops.complete(base, {
    interventionTypes: ["coordinate", "move", "execute"], directMinutes: 80,
    siteVisit: true, firstTimeRight: true, revisitRequired: false, reworkRequired: false,
    outcome: "완료",
  }, { now: "2026-08-29T02:30:00.000Z", userId: "u1" });
  const metrics = Ops.metrics([done]);
  assert.equal(done.status, "completed");
  assert.equal(metrics.total, 1);
  assert.equal(metrics.completed, 1);
  assert.equal(metrics.siteVisitRate, 100);
  assert.deepEqual(metrics.interventionCounts, { coordinate: 1, move: 1, execute: 1 });
});

test("existing CRM exposes only a launcher while the operations UI stays in dedicated files", () => {
  const html = src("index.html");
  const app = src("app.js");
  const preload = src("preload.js");
  const main = src("main.js");
  assert.match(html, /data-action="open-operations-intelligence"/);
  assert.doesNotMatch(html, /data-view="operationsIntelligence"/);
  assert.doesNotMatch(app, /currentView === "operationsIntelligence"/);
  assert.match(preload, /openOperationsIntelligence/);
  assert.match(main, /operations-intelligence\.html/);
  assert.match(main, /operations-intelligence-preload\.js/);
});

test("database rules isolate operations and preserve viewer read-only access", () => {
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "database.rules.json"), "utf8");
  assert.match(rules, /"operationsIntelligence"/);
  assert.match(rules, /"operations"/);
  assert.match(rules, /role'\)\.val\(\) === 'viewer'/);
  assert.match(rules, /role'\)\.val\(\) === 'member'/);
});

test("operation normalization captures repeatability, manager time, counters, and safe evidence", () => {
  const Ops = require("../src/operations-intelligence-core");
  const operation = Ops.normalize({
    id: "op_1", title: "계단 청소", repeatability: "high", managerIntervened: true,
    managerMinutes: 25, assignmentChangeCount: 2, scheduleChangeCount: 3, reopenCount: 1, commentCount: 4,
    attachments: [
      { id: "proof_1", type: "receipt", name: "영수증", ref: "https://drive.google.com/file/d/abc", uploadedAt: "2026-08-29T01:00:00.000Z", uploadedBy: "u1", buildingId: "building_1", unitId: "" },
      { id: "proof_2", type: "other", name: "unsafe", ref: "javascript:alert(1)" },
    ],
  });
  assert.equal(operation.repeatability, "high");
  assert.equal(operation.managerMinutes, 25);
  assert.equal(operation.assignmentChangeCount, 2);
  assert.equal(operation.attachments.length, 1);
  assert.equal(operation.attachments[0].type, "receipt");
});

test("bottlenecks group by work type and exclude samples below three from ranking", () => {
  const Ops = require("../src/operations-intelligence-core");
  const rows = [
    { id:"a1",title:"A1",category:"시설",subcategory:"누수",createdAt:"2026-08-01T00:00:00.000Z",directMinutes:100,siteVisit:true,reworkRequired:true,exceptionOccurred:true,firstTimeRight:false,repeatability:"high",managerIntervened:true,managerMinutes:20 },
    { id:"a2",title:"A2",category:"시설",subcategory:"누수",createdAt:"2026-08-02T00:00:00.000Z",directMinutes:80,siteVisit:true,revisitRequired:true,firstTimeRight:false,repeatability:"high" },
    { id:"a3",title:"A3",category:"시설",subcategory:"누수",createdAt:"2026-08-03T00:00:00.000Z",directMinutes:60,siteVisit:false,firstTimeRight:true,repeatability:"medium" },
    { id:"b1",title:"B1",category:"청소",subcategory:"계단",createdAt:"2026-08-04T00:00:00.000Z",directMinutes:30,firstTimeRight:true },
    { id:"b2",title:"B2",category:"청소",subcategory:"계단",createdAt:"2026-08-05T00:00:00.000Z",directMinutes:20,firstTimeRight:true },
  ];
  const result = Ops.bottlenecks(rows, { period:"all", now:"2026-08-29T00:00:00.000Z" });
  assert.equal(result.groups[0].key, "시설 / 누수");
  assert.equal(result.groups[0].sampleSize, 3);
  assert.equal(result.groups[0].rankEligible, true);
  assert.equal(result.groups.find(group => group.key === "청소 / 계단").rankEligible, false);
  assert.equal(result.groups[0].siteVisitRate, 66.7);
  assert.equal(result.groups[0].firstTimeRightRate, 33.3);
});

test("improvement candidates require five samples and two factual signals without technology guesses", () => {
  const Ops = require("../src/operations-intelligence-core");
  const operations = Array.from({ length: 5 }, (_, index) => ({
    id:`op_${index}`, title:`누수 ${index}`, category:"시설", subcategory:"누수", createdAt:`2026-08-0${index+1}T00:00:00.000Z`,
    directMinutes:90, siteVisit:true, reworkRequired:index<2, exceptionOccurred:index<2,
    firstTimeRight:index>=2, repeatability:index<3?"high":"medium", managerIntervened:index===0,
  }));
  const analysis = Ops.bottlenecks(operations.slice().reverse(), { period:"all", now:"2026-08-29T00:00:00.000Z" });
  const candidates = Ops.improvementCandidates(analysis);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, "시설 / 누수");
  assert.ok(candidates[0].signals.length >= 2);
  assert.doesNotMatch(JSON.stringify(candidates), /AI|Computer Vision|Scheduling|Robotics/i);
  assert.deepEqual(candidates, Ops.improvementCandidates(Ops.bottlenecks(operations, { period:"all", now:"2026-08-29T00:00:00.000Z" })));
  assert.equal(Ops.improvementCandidates(Ops.bottlenecks(operations.slice(0,4), { period:"all" })).length, 0);
});

test("operation updates require optimistic versioning and protect system-owned counters", () => {
  const main = src("main.js");
  const renderer = src("operations-intelligence.js");
  assert.match(src("operations-intelligence.html"), /name="expectedVersion"/);
  assert.match(renderer, /elements\.expectedVersion\.value/);
  assert.match(main, /expectedVersion/);
  assert.match(main, /dbReadWithEtag\(`operationsIntelligence\/operations\/\$\{existingId\}`/);
  assert.match(main, /"If-Match": snapshot\.etag/);
  assert.match(main, /assignmentChangeCount: current\.assignmentChangeCount \+ Number/);
  assert.match(main, /scheduleChangeCount: current\.scheduleChangeCount \+ Number/);
  assert.doesNotMatch(main, /Object\.assign\([^\n]+source[^\n]+assignmentChangeCount/);
});

test("operations window exposes three analysis tabs and one shared period filter", () => {
  const html = src("operations-intelligence.html");
  const renderer = src("operations-intelligence.js");
  for (const tab of ["overview", "bottlenecks", "candidates"]) assert.match(html, new RegExp(`data-tab="${tab}"`));
  assert.match(html, /id="analysisPeriod"/);
  assert.match(renderer, /Core\.bottlenecks/);
  assert.match(renderer, /Core\.improvementCandidates/);
  assert.match(renderer, /표본 부족/);
  assert.match(renderer, /계속 관찰/);
});

test("operations screenshot QA can open each isolated tab with synthetic local data", () => {
  const main = src("main.js");
  assert.match(main, /BRING_CRM_OPERATIONS_SCREENSHOT_TAB/);
  assert.match(main, /data-tab=/);
  assert.match(main, /screenshotIntelligenceOperations/);
});

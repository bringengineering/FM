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

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");

test("건물 월간보고서가 문서관리에서 열린다", () => {
  const index = read("index.html");
  const app = read("app.js");
  assert.equal((index.match(/data-view="buildingMonthlyReports"/gu) || []).length, 1);
  assert.match(index, /data-nav-folder="documents"[\s\S]*data-view="buildingMonthlyReports"/u);
  assert.match(app, /buildingMonthlyReports: \["계약 건물의 한 달 관리 내역을 건물주에게 보고합니다", "건물 월간보고서"\]/u);
  assert.match(app, /currentView === "buildingMonthlyReports"\) renderBuildingMonthlyReports\(\)/u);
  assert.match(index, /building-monthly-report\.css/u);
});

test("Gemini 초안은 격리된 IPC 경로로만 요청한다", () => {
  const preload = read("preload.js");
  const main = read("main.js");
  const policy = require("../src/mutation-policy");
  assert.match(preload, /generateBuildingMonthlyReportDraft: input => ipcRenderer\.invoke\("crm:building-monthly-report-draft", input\)/u);
  assert.match(main, /secureCanonicalHandle\("crm:building-monthly-report-draft"/u);
  assert.equal(policy.classification("crm:building-monthly-report-draft"), "control");
  assert.match(main, /isMarketingOnlySession\(\)/u);
});

test("시험 버전은 자동 발송을 하지 않는다", () => {
  const app = read("app.js");
  const start = app.indexOf("function renderBuildingMonthlyReports");
  const end = app.indexOf("async function exportBuildingMonthlyReportPdf", start);
  const view = app.slice(start, end);
  assert.ok(view.length > 0);
  assert.match(view, /시험 버전 · 자동 발송 안 함/u);
  assert.doesNotMatch(view, /sendOwner|customer-notice-send|document-delivery-send/u);
});

test("건물 월간보고서 화면은 계약이 종료되지 않은 건물만 고른다", () => {
  const app = read("app.js");
  const start = app.indexOf("function contractedMonthlyReportBuildings");
  const end = app.indexOf("function buildingMonthlyReportRequest", start);
  const helper = app.slice(start, end);
  assert.match(helper, /contract\.status !== "종료"/u);
  assert.match(helper, /buildingIds\.has/u);
});

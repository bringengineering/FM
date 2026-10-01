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

test("월간보고서는 승인된 템플릿 준비 상태와 관리 권한이 있을 때만 수동 발송한다", () => {
  const app = read("app.js");
  const main = read("main.js");
  const preload = read("preload.js");
  const policy = require("../src/mutation-policy");
  const start = app.indexOf("function renderBuildingMonthlyReports");
  const end = app.indexOf("async function exportBuildingMonthlyReportPdf", start);
  const view = app.slice(start, end);
  assert.ok(view.length > 0);
  assert.match(view, /data-building-monthly-kakao-send/u);
  assert.match(view, /documentDeliveryCapabilities\.monthlyReport/u);
  assert.match(view, /canAdministerSecurity\(\)/u);
  assert.match(app, /월간보고서 알림톡 발송 요청을 접수했습니다/u);
  assert.match(main, /async function sendBuildingMonthlyReportToCustomerByKakao/u);
  assert.match(main, /capabilities\.monthlyReport !== true/u);
  assert.match(main, /documentType: "monthly_report"/u);
  assert.match(main, /await runDocumentDelivery\("revoke"/u);
  assert.match(preload, /sendBuildingMonthlyReportToCustomerByKakao: input => ipcRenderer\.invoke\("crm:building-monthly-report-kakao-send", input\)/u);
  assert.doesNotThrow(() => policy.assertRegistered("crm:building-monthly-report-kakao-send"));
  assert.equal(policy.classification("crm:building-monthly-report-kakao-send"), "mutation");
});

test("월간보고서에서 Drive 상태를 안내하고 바로 연결한 뒤 사진 폴더를 연다", () => {
  const app = read("app.js");
  const css = read("building-monthly-report.css");
  const start = app.indexOf("async function connectBuildingMonthlyDrive");
  const end = app.indexOf("async function switchBuildingMonthlyDriveSpace", start);
  const connect = app.slice(start, end);
  const viewStart = app.indexOf("function renderBuildingMonthlyReports");
  const viewEnd = app.indexOf("async function exportBuildingMonthlyReportPdf", viewStart);
  const view = app.slice(viewStart, viewEnd);
  assert.ok(connect.length > 0);
  assert.match(view, /data-building-monthly-drive-connect/u);
  assert.match(view, /data-building-monthly-drive-open/u);
  assert.match(view, /회사 Drive 연결이 필요합니다/u);
  assert.match(view, /building-monthly-drive-status/u);
  assert.doesNotMatch(app, /설정에서 Drive를 연결해 주세요/u);
  assert.match(connect, /api\.driveStatus\(\)/u);
  assert.match(connect, /api\.connectDrive\(\)/u);
  assert.match(connect, /await openBuildingMonthlyPhotoPicker\(\)/u);
  assert.match(connect, /canWriteCRM\(\)/u);
  assert.match(connect, /sessionIsCurrent/u);
  assert.match(connect, /reportIsCurrent/u);
  assert.match(connect, /authGeneration/u);
  assert.match(connect, /currentAuthUid\(\)/u);
  assert.match(css, /\.building-monthly-drive-status\.is-connected/u);
});

test("캘린더 업무 제외는 원본 일정을 유지하면서 초안·집계·PDF에 적용한다", () => {
  const app = read("app.js");
  const main = read("main.js");
  const core = read("building-report-core.js");
  const start = app.indexOf("function renderBuildingMonthlyReports");
  const end = app.indexOf("async function exportBuildingMonthlyReportPdf", start);
  const view = app.slice(start, end);
  assert.ok(view.length > 0);
  assert.match(view, /data-building-monthly-work-remove=/u);
  assert.match(view, /원본 CRM 일정과 캘린더 기록은 삭제되지 않습니다\./u);
  assert.match(view, /excludedWorkKeys/u);
  assert.match(view, /buildingMonthlyReportRequestKey\(\)/u);
  assert.match(main, /"manualWorks", "excludedWorkKeys", "photos"/u);
  assert.match(core, /source\.excludedWorkKeys/u);
});

test("건물 월간보고서는 건물의 명시적 보고 대상 설정으로 선택한다", () => {
  const app = read("app.js");
  const start = app.indexOf("function monthlyReportTargetBuildings");
  const end = app.indexOf("function buildingMonthlyReportTargetManagerMarkup", start);
  const helper = app.slice(start, end);
  assert.match(helper, /building\.monthlyReportEnabled === true/u);
  assert.doesNotMatch(helper, /store\.contracts|contract\.status/u);
  assert.match(app, /<span>건물 선택<\/span>/u);
  assert.match(app, /data-building-monthly-target="/u);
  assert.match(app, /patch: \{ monthlyReportEnabled: enabled \}/u);
  assert.match(app, /계약 연결 여부와 관계없이 이 건물을 월간보고/u);
});

test("캘린더 작업이 없어도 현재 달까지 보고 월을 선택할 수 있다", () => {
  const app = read("app.js");
  const core = read("building-report-core.js");
  const start = app.indexOf("function renderBuildingMonthlyReports");
  const end = app.indexOf("async function exportBuildingMonthlyReportPdf", start);
  const view = app.slice(start, end);
  assert.ok(view.length > 0);
  assert.match(core, /function isReportMonthSelectable\(month, now = new Date\(\)\)/u);
  assert.match(view, /max="\$\{attr\(currentMonthKey\(\)\)\}" value=/u);
  assert.match(view, /BuildingReportCore\.isReportMonthSelectable\(buildingMonthlyReportState\.month\)/u);
  assert.match(view, /BuildingReportCore\.isReportMonthSelectable\(nextMonth\)/u);
  assert.match(view, /캘린더 작업이 없어도 월 선택은 가능/u);
});

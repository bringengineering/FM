const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const buildingCss = fs.readFileSync(path.join(__dirname, "../src/buildings.css"), "utf8");

function sourceBetween(startText, endText) {
  const start = appSource.indexOf(startText);
  assert.ok(start >= 0, `${startText} should exist`);
  const end = appSource.indexOf(endText, start + startText.length);
  assert.ok(end > start, `${endText} should follow ${startText}`);
  return appSource.slice(start, end);
}

test("customer management navigation is a folder with vacancy as a child", () => {
  assert.match(indexSource, /data-nav-folder="customer-management"/);
  assert.match(indexSource, /data-nav-folder-toggle[^>]*aria-expanded="true"[^>]*>[\s\S]*?<b>고객 관리<\/b><i aria-hidden="true">/);
  assert.match(indexSource, /data-view="customers"[^>]*>[\s\S]*?<b>고객·건물 관리<\/b><em id="navCustomerCount">0<\/em><\/button>/);
  assert.equal((indexSource.match(/id="navCustomerCount"/g) || []).length, 1);
  assert.match(indexSource, /data-view="vacancies"[^>]*>[\s\S]*?<b>공실 현황<\/b><em id="navVacancyCount">0<\/em><\/button>/);
  assert.doesNotMatch(indexSource, /data-view="buildings"/);
  assert.match(appSource, /button\.dataset\.view === "customers" && currentView === "buildings"/);
});

test("customer workspace replaces the card rail with dropdown selectors", () => {
  const customerView = sourceBetween("function renderCustomers()", "function renderCustomerHubDetail");
  assert.match(customerView, /customer-hub-workspace/);
  assert.match(customerView, /data-customer-hub-select/);
  assert.match(customerView, /data-customer-management-filter/);
  assert.match(customerView, /customerAvatar\(customer\)/);
  assert.match(customerView, /renderCustomerHubDetail/);
  assert.doesNotMatch(customerView, /building-hub-browser|building-hub-list|customer-hub-card|data-customer-hub-open/);
  assert.doesNotMatch(customerView, /customerSalesStageBadge|data-customer-sales-stage-filter|건물 영업 단계/);
  assert.match(appSource, /Object\.freeze\(\["전체", "건물 미연결", "연결 확인 필요", "관리 예정", "관리 중", "관리 종료"\]\)/);
});

test("customer detail omits the linked-building card and keeps the remaining work sections", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  assert.doesNotMatch(detail, /const buildingRecords =|<b>연결 건물<\/b>|customer-linked-building|data-building-jump|data-building-new-case/);
  assert.doesNotMatch(buildingCss, /\.customer-linked-building/);
  assert.match(detail, /<b>고객 요청·후속조치<\/b>/);
  assert.match(detail, /<b>계약<\/b>/);
  assert.match(detail, /<b>민원<\/b>/);
  assert.match(detail, /<b>최근 상담<\/b>/);
  assert.match(detail, /customerAvatar\(customer\)/);
  assert.match(detail, /building-identity-strip/);
  assert.match(detail, /data-customer-open|data-customer-hub-edit|new-selected-task/);
  assert.match(detail, /data-contract-edit|data-building-case-open/);
  assert.doesNotMatch(detail, /customerSalesStageBadge|영업 미등록|영업 보기/);
});

test("building workspace uses the same management status vocabulary", () => {
  const buildingView = sourceBetween("function renderBuildings()", "function renderArchivedBuildings");
  assert.match(buildingView, /data-building-management-filter/);
  assert.match(buildingView, /managementStatusForBuilding/);
  assert.match(appSource, /selectField\("관리 상태", "status", \["관리 예정", "관리 중", "관리 종료"\]/);
  assert.match(buildingCss, /\.management-filter\s*\{/);
  assert.match(buildingCss, /\.customer-hub-workspace/);
  assert.match(buildingCss, /\.customer-select-control/);
});

test("vacancy workspace remains available under customer management", () => {
  assert.match(appSource, /function renderVacancies\(\)/);
  assert.match(appSource, /currentView = "vacancies"/);
  assert.match(appSource, /고객·건물 관리에 등록된 건물을 기준으로 층과 호실을 설정합니다/);
});

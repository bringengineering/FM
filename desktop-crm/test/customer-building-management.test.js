const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const buildingCss = fs.readFileSync(path.join(__dirname, "../src/buildings.css"), "utf8");

function sourceBetween(startText, endText) {
  const start = appSource.indexOf(startText);
  assert.ok(start >= 0, `${startText} should exist`);
  const end = appSource.indexOf(endText, start + startText.length);
  assert.ok(end > start, `${endText} should follow ${startText}`);
  return appSource.slice(start, end);
}

test("customer management navigation groups customers, partner vendors, and vacancies", () => {
  const folderStart = indexSource.indexOf('data-nav-folder="customer-management"');
  const folderEnd = indexSource.indexOf('data-view="buildingCalendar"', folderStart);
  const folderMarkup = indexSource.slice(folderStart, folderEnd);
  assert.match(indexSource, /data-nav-folder="customer-management"/);
  assert.match(indexSource, /data-nav-folder-toggle[^>]*aria-expanded="false"[^>]*>[\s\S]*?<b>고객 관리<\/b><i aria-hidden="true">/);
  assert.match(folderMarkup, /class="nav-item nav-child" data-view="customers"[^>]*>[\s\S]*?<b>고객·건물 관리<\/b><em id="navCustomerCount">0<\/em><\/button>/);
  assert.match(folderMarkup, /class="nav-item nav-child" data-view="partnerVendors"[^>]*>[\s\S]*?<b>협력 업체<\/b><em id="navPartnerVendorCount">0<\/em><\/button>/);
  assert.match(folderMarkup, /class="nav-item nav-child" data-view="vacancies"[^>]*>[\s\S]*?<b>공실 현황<\/b><em id="navVacancyCount">0<\/em><\/button>/);
  assert.ok(folderMarkup.indexOf('data-view="customers"') < folderMarkup.indexOf('data-view="partnerVendors"'));
  assert.ok(folderMarkup.indexOf('data-view="partnerVendors"') < folderMarkup.indexOf('data-view="vacancies"'));
  assert.equal((indexSource.match(/id="navCustomerCount"/g) || []).length, 1);
  assert.equal((indexSource.match(/data-view="partnerVendors"/g) || []).length, 1);
  assert.equal((indexSource.match(/id="navPartnerVendorCount"/g) || []).length, 1);
  assert.doesNotMatch(indexSource, /data-view="buildings"/);
  assert.match(appSource, /button\.dataset\.view === "customers" && currentView === "buildings"/);
  assert.match(appSource, /partnerVendors: \["협력 업체 정보를 한곳에서", "협력 업체"\]/);
  assert.match(appSource, /\["customers", "buildings", "vacancies", "partnerVendors"\]\.includes\(currentView\)/);
  assert.match(appSource, /customerManagementFolder\?\.classList\.add\("open"\)/);
  assert.match(appSource, /customerManagementFolder\?\.querySelector\("\[data-nav-folder-toggle\]"\)\?\.setAttribute\("aria-expanded", "true"\)/);
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
  assert.doesNotMatch(customerView, /data-customer-buildings-open|건물 목록 보기|건물 미연결/);
  assert.match(appSource, /Object\.freeze\(\["전체", "연결 확인 필요", "관리 예정", "관리 중", "관리 종료"\]\)/);
});

test("customer detail keeps essentials visible and removes the duplicated building screen", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  const rendered = detail.slice(detail.indexOf("return `<header"));
  assert.doesNotMatch(detail, /const buildingRecords =|<b>연결 건물<\/b>|customer-linked-building|data-building-jump/);
  assert.doesNotMatch(detail, /customer-management-kpi|건물 미연결|건물 연결 필요/);
  assert.doesNotMatch(buildingCss, /\.customer-linked-building/);
  assert.match(detail, /<b>고객 요청·후속조치<\/b>/);
  assert.match(detail, /<b>진행 계약<\/b>/);
  assert.match(detail, /<b>진행 민원<\/b>/);
  assert.match(detail, /<b>최근 상담<\/b>/);
  assert.match(detail, /customerAvatar\(customer\)/);
  assert.match(detail, /customer-essential-summary/);
  assert.match(detail, /data-customer-open|data-customer-hub-edit|new-selected-task/);
  assert.match(detail, /data-contract-edit|data-building-case-open/);
  assert.match(detail, /data-customer-building-select/);
  assert.match(detail, /data-action="new-building" data-customer-id/);
  assert.match(detail, /customer-hub-kpis/);
  assert.match(detail, /<details class="customer-secondary-details"><summary>/);
  assert.match(detail, /추가 정보 보기/);
  assert.doesNotMatch(detail, /customer-embedded-building-management|customer-building-selector-bar|renderBuildingDetail\(managedBuilding\)|<h3>건물 관리<\/h3>/);
  assert.doesNotMatch(buildingCss, /\.customer-embedded-building-management|\.customer-building-selector-bar/);
  assert.ok(rendered.indexOf("customer-essential-summary") < rendered.indexOf("customer-hub-kpis"));
  assert.ok(rendered.indexOf("customer-hub-kpis") < rendered.indexOf("customer-priority-grid"));
  assert.ok(rendered.indexOf("customer-priority-grid") < rendered.indexOf("${secondaryDetails}"));
  assert.doesNotMatch(detail, /customerSalesStageBadge|영업 미등록|영업 보기/);
});

test("partner vendor cards keep their actions while the remaining card opens a customer-style detail workspace", () => {
  const partnerView = sourceBetween("function renderPartnerVendorDetail", "function renderPartnerQuotes");
  assert.match(partnerView, /data-partner-vendor-open/);
  assert.match(partnerView, /data-partner-vendor-edit/);
  assert.match(partnerView, /data-partner-vendor-link/);
  assert.doesNotMatch(partnerView, /<article class="partner-vendor-card" data-partner-vendor-edit/);
  assert.match(partnerView, /customer-hub-workspace partner-vendor-detail-workspace/);
  assert.match(partnerView, /customer-hub-selector-bar/);
  assert.match(partnerView, /data-partner-vendor-detail-select/);
  assert.match(partnerView, /building-hub-detail-head customer-hub-detail-head/);
  assert.match(partnerView, /building-identity-strip customer-essential-summary/);
  assert.match(partnerView, /building-hub-kpis customer-hub-kpis/);
  assert.match(partnerView, /building-detail-grid customer-priority-grid/);
  assert.match(partnerView, /<b>최근 상담 기록<\/b>/);
  assert.match(appSource, /selectedPartnerVendorDetailId = partnerVendorOpen\.dataset\.partnerVendorOpen/);
  assert.match(appSource, /selectedPartnerVendorDetailId = partnerVendorDetailSelect\.value/);
  assert.match(appSource, /currentView === "partnerVendors"\) selectedPartnerVendorDetailId = ""/);
  assert.match(stylesSource, /\.partner-vendor-detail-avatar/);
  assert.match(stylesSource, /\.partner-vendor-card:focus-visible/);
  assert.match(mainSource, /BRING_CRM_SCREENSHOT_ACTION === "partner-vendor-detail"/);
});

test("customer header moves selected building actions after the task action", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  const rendered = detail.slice(detail.indexOf("return `<header"));
  const customerActionTokens = [
    "data-customer-open",
    "data-customer-hub-edit",
    'data-action="new-selected-task"',
    "${buildingActions}",
  ];
  customerActionTokens.reduce((previousIndex, token) => {
    const index = rendered.indexOf(token);
    assert.ok(index > previousIndex, `${token} should follow the previous customer action`);
    return index;
  }, -1);
  const buildingActionTokens = [
    "data-building-edit",
    "data-building-vacancies",
    "data-building-payments",
    "data-building-new-case",
  ];
  buildingActionTokens.reduce((previousIndex, token) => {
    const index = detail.indexOf(token);
    assert.ok(index > previousIndex, `${token} should follow the previous building action`);
    return index;
  }, -1);
  assert.match(detail, /const buildingActions = managedBuilding \?/);
  assert.match(detail, /data-building-edit="\$\{attr\(managedBuilding\.id\)\}"/);
  assert.match(detail, /customer-hub-head-actions" role="group" aria-label="고객과 건물 빠른 작업"/);
  assert.match(buildingCss, /\.customer-hub-head-actions\{[^}]*flex-wrap/);
  assert.match(buildingCss, /@media\(max-width:700px\)[\s\S]*?\.customer-hub-head-actions\{display:grid;grid-template-columns:repeat\(2/);
});

test("compact building controls keep the selected customer relationship", () => {
  assert.match(appSource, /const customerBuildingSelect = event\.target\.closest\("\[data-customer-building-select\]"\)/);
  assert.match(appSource, /customerBuildings\(customer\)\.some\(building => !building\.archivedAt && building\.id === customerBuildingSelect\.value\)/);
  assert.match(appSource, /function buildingEditor\(buildingId, ownerCustomerId = ""\)/);
  assert.match(appSource, /Core\.createBuilding\(\{ manager: store\.settings\.owner \|\| "김현진", ownerCustomerId: selectedOwnerCustomerId \}\)/);
  assert.match(appSource, /action === "new-building"\) buildingEditor\("", actionControl\.dataset\.customerId \|\| ""\)/);
  assert.match(buildingCss, /\.customer-building-context\{/);
  assert.match(buildingCss, /\.customer-secondary-details>summary:focus-visible/);
});

test("building edits opened from customer detail return to the customer workspace", () => {
  const editor = sourceBetween("function buildingEditor", "function updateVacancyScheduleGuide");
  const save = sourceBetween('form.id === "buildingForm"', 'form.id === "contractForm"');
  assert.match(editor, /data-return-view="\$\{attr\(currentView === "customers" \? "customers" : "buildings"\)\}"/);
  assert.match(save, /const returnView = form\.dataset\.returnView === "customers" \? "customers" : "buildings"/);
  assert.match(save, /currentView = returnView/);
});

test("new customer registration accepts a name and saves without creating a building", () => {
  const editor = sourceBetween("function customerEditor", "function buildingNumberField");
  const fromForm = sourceBetween("function customerFromForm", "async function deleteActivityRecord");
  const submit = sourceBetween('form.id === "customerForm"', 'form.id === "partnerVendorForm"');
  assert.match(editor, /<span>기존 건물 연결 \(선택\)<\/span><select name="buildingId">/);
  assert.doesNotMatch(editor, /select name="buildingId" required/);
  assert.match(editor, /<span>고객명 \*<\/span><input name="name" required/);
  assert.match(editor, /건물 연결 안 함/);
  assert.match(fromForm, /buildingIdLinks\[String\(raw\.buildingId\)\] = true/);
  assert.match(submit, /const requestedBuildingId = String\(form\.elements\.buildingId/);
  assert.match(submit, /requestedBuildingId \? buildingById\(requestedBuildingId\) : null/);
  assert.match(submit, /고객명을 입력해 주세요/);
  assert.match(submit, /await commitSharedFormMutation/);
  assert.doesNotMatch(submit, /commitCanonicalEntity/);
  assert.match(appSource, /const customerDisplayName = customer =>[\s\S]*?customerBuildings\(customer\)\.find\(building => !building\.archivedAt\)\?\.name/);
  assert.match(appSource, /<h2>\$\{esc\(customerDisplayName\(customer\)\)\}<\/h2>/);
});

test("customer core saves preserve marketing data for the dedicated attribution API", () => {
  const editor = sourceBetween("function customerEditor", "function buildingNumberField");
  const fromForm = sourceBetween("function customerFromForm", "async function deleteActivityRecord");
  const attributionEditors = editor.match(/marketingAttributionFields\(/g) || [];

  assert.equal(attributionEditors.length, 1, "only the dedicated customerMarketingForm may render attribution fields");
  assert.doesNotMatch(fromForm, /customer\.marketing\s*=\s*parseMarketingAttribution/);
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

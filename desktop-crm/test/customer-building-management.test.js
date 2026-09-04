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

test("customer management mirrors the partner vendor card-list-to-detail workflow", () => {
  const customerList = sourceBetween("function renderCustomers()", "function renderCustomerManagementDetail");
  const customerDetail = sourceBetween("function renderCustomerManagementDetail", "function customerMessageDeliveries");
  const inputHandler = sourceBetween('document.addEventListener("input"', 'document.addEventListener("compositionend"');
  const compositionHandler = sourceBetween('document.addEventListener("compositionend"', 'document.addEventListener("keydown"');

  assert.match(customerList, /if \(selectedCustomer\) return renderCustomerManagementDetail\(selectedCustomer\)/);
  assert.match(customerList, /partner-vendor-hero customer-management-hero/);
  assert.match(customerList, /quote-kpi-grid partner-vendor-kpis customer-management-kpis/);
  assert.equal((customerList.match(/\$\{kpi\(/g) || []).length, 4);
  ["등록 고객", "연결 건물", "관리 중", "확인 필요"].forEach(label => assert.match(customerList, new RegExp(`kpi\\("${label}"`)));
  assert.match(customerList, /partner-vendor-toolbar customer-management-toolbar/);
  assert.match(customerList, /partner-vendor-toolbar-controls/);
  assert.match(customerList, /data-customer-management-filter/);
  assert.match(customerList, /partner-vendor-list-search customer-management-list-search/);
  assert.match(customerList, /data-customer-list-search/);
  assert.match(customerList, /partner-vendor-list customer-management-list/);
  assert.match(customerList, /partner-vendor-card customer-management-card/);
  assert.match(customerList, /data-customer-hub-open="\$\{attr\(customer\.id\)\}" tabindex="0"/);
  assert.match(customerList, /customerAvatar\(customer\)/);
  assert.match(customerList, /partner-vendor-contact customer-address-contact/);
  assert.match(customerList, /<span>도로명 주소<\/span>/);
  assert.match(customerList, /<span>지번 주소<\/span>/);
  assert.match(customerList, /<span>연락처<\/span>/);
  assert.match(customerList, /<span>연락처<\/span>[\s\S]*?<span>도로명 주소<\/span>[\s\S]*?<span>지번 주소<\/span>/);
  assert.match(customerList, /roadAddressLabel/);
  assert.match(customerList, /jibunAddressLabel/);
  assert.match(stylesSource, /\.customer-address-contact\{grid-template-columns:1fr\}/);
  assert.match(stylesSource, /\.customer-address-contact>div\{display:grid;grid-template-columns:76px minmax\(0,1fr\)/);
  assert.match(stylesSource, /\.customer-address-contact>div\+div\{border-top:1px solid #e3edf2;border-left:0\}/);
  assert.match(customerList, /data-customer-hub-edit="\$\{attr\(customer\.id\)\}"/);
  assert.match(customerList, /data-customer-open="\$\{attr\(customer\.id\)\}"/);
  assert.doesNotMatch(customerList, /selectedCustomerHubId = customers\[0\]/);
  assert.doesNotMatch(customerList, /customerSalesStageBadge|data-customer-sales-stage-filter|건물 영업 단계/);
  assert.match(appSource, /Object\.freeze\(\["전체", "연결 확인 필요", "관리 예정", "관리 중", "관리 종료"\]\)/);

  assert.match(customerDetail, /function renderCustomerManagementDetail\(customer\)/);
  assert.match(customerDetail, /customer-hub-workspace partner-vendor-detail-workspace customer-management-detail-workspace/);
  assert.match(customerDetail, /customer-hub-selector-bar/);
  assert.match(customerDetail, /data-customer-hub-select/);
  assert.match(customerDetail, /renderCustomerHubDetail\(customer\)/);
  assert.equal((customerDetail.match(/data-customer-detail-back/g) || []).length, 1);
  assert.ok(customerDetail.indexOf("data-customer-detail-back") < customerDetail.indexOf("data-customer-hub-select"));
  assert.match(customerDetail, /customer-hub-selector-bar[^`]*?data-customer-detail-back>← 고객·건물 목록<\/button>[^`]*?data-customer-hub-select/);
  assert.doesNotMatch(customerDetail, /customer-selector-heading|<b>고객 선택<\/b>/);

  assert.match(appSource, /const customerDetailBack = event\.target\.closest\("\[data-customer-detail-back\]"\)[\s\S]*?selectedCustomerHubId = "";[\s\S]*?renderCustomers\(\)/);
  assert.match(appSource, /const customerHubOpen = event\.target\.closest\("\[data-customer-hub-open\]"\)[\s\S]*?selectedCustomerHubId = customerHubOpen\.dataset\.customerHubOpen \|\| "";[\s\S]*?renderCustomers\(\)/);
  assert.match(appSource, /currentView = nextView;[\s\S]*?if \(currentView === "customers"\) selectedCustomerHubId = "";/);
  assert.match(appSource, /const customerListOpen = event\.target\.closest\("\[data-customer-list-open\]"\)[\s\S]*?selectedCustomerHubId = "";[\s\S]*?currentView = "customers";/);
  assert.match(inputHandler, /event\.target\.matches\("\[data-customer-list-search\]"\)[\s\S]*?crmSearchValue = event\.target\.value\.slice\(0, 160\)[\s\S]*?renderCustomers\(\)/);
  assert.match(compositionHandler, /event\.target\.matches\("\[data-customer-list-search\]"\)[\s\S]*?crmSearchValue = event\.target\.value\.slice\(0, 160\)[\s\S]*?renderCustomers\(\)/);
  assert.match(appSource, /event\.target\.matches\?\.\("\[data-partner-vendor-open\], \[data-customer-hub-open\](?:, \[data-partner-quote-edit\])?"\)[\s\S]*?event\.key === "Enter" \|\| event\.key === " "[\s\S]*?detailCard\.click\(\)/);

  assert.match(stylesSource, /\.crm-read-only \[data-customer-hub-edit\]/);
  assert.match(buildingCss, /\.customer-management-detail-workspace \.customer-hub-selector-bar\{grid-template-columns:auto minmax\(280px,1fr\)\}/);
  assert.match(buildingCss, /@media\(max-width:700px\)[\s\S]*?\.customer-management-detail-workspace \.customer-hub-selector-bar\{grid-template-columns:1fr\}/);
  assert.match(mainSource, /BRING_CRM_SCREENSHOT_ACTION === "customer-management-ui"/);
  assert.match(mainSource, /customer-management-ui[\s\S]*?\[data-customer-hub-open\][\s\S]*?\.customer-management-kpis \.kpi-card[\s\S]*?\[data-customer-list-search\][\s\S]*?\[data-customer-detail-back\]/);
  assert.ok((mainSource.match(/customer-management-ui/g) || []).length >= 2, "the screenshot action must also write a result JSON file");
});

test("customer detail keeps essentials visible and moves consultation history into its own disclosure", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  const rendered = detail.slice(detail.indexOf("return `<header"));
  const consultationMarkup = detail.slice(detail.indexOf("const consultationDetails"), detail.indexOf("const secondaryCount"));
  const secondaryMarkup = detail.slice(detail.indexOf("const secondaryCount"), detail.indexOf("const rentalDetails"));
  const rentalMarkup = detail.slice(detail.indexOf("const rentalDetails"), detail.indexOf("const buildingActions"));
  assert.doesNotMatch(detail, /const buildingRecords =|<b>연결 건물<\/b>|customer-linked-building|data-building-jump/);
  assert.doesNotMatch(detail, /customer-management-kpi|건물 미연결|건물 연결 필요/);
  assert.doesNotMatch(buildingCss, /\.customer-linked-building/);
  assert.match(detail, /<b>고객 요청·후속조치<\/b>/);
  assert.match(detail, /<b>진행 계약<\/b>/);
  assert.match(detail, /<b>진행 민원<\/b>/);
  assert.match(consultationMarkup, /<details class="customer-secondary-details customer-consultation-details" data-customer-consultations="\$\{attr\(customer\.id\)\}">/);
  assert.match(consultationMarkup, /<b>상담 기록<\/b>/);
  assert.match(consultationMarkup, /\$\{activities\.length\}건/);
  assert.match(consultationMarkup, /아직 등록된 상담 기록이 없습니다/);
  assert.doesNotMatch(consultationMarkup, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.doesNotMatch(secondaryMarkup, /activities|최근 상담|상담 기록/);
  assert.match(detail, /customerAvatar\(customer\)/);
  assert.match(detail, /customer-essential-summary/);
  assert.match(detail, /data-customer-open|data-customer-hub-edit|new-consultation|new-selected-task/);
  assert.match(detail, /data-contract-edit|data-building-case-open/);
  assert.doesNotMatch(detail, /data-customer-building-select|작업 건물|customer-building-context/);
  assert.doesNotMatch(detail, /data-action="new-building"|data-customer-id=.*건물/);
  assert.match(detail, /customer-hub-kpis/);
  assert.match(detail, /추가 정보 보기/);
  assert.match(rentalMarkup, /<details class="customer-secondary-details customer-rental-details" data-customer-rental-details="\$\{attr\(managedBuilding\.id\)\}">/);
  assert.match(rentalMarkup, /<b>임대·공실 정보<\/b>/);
  assert.match(rentalMarkup, /data-building-edit="\$\{attr\(managedBuilding\.id\)\}">수정<\/button>/);
  assert.match(rentalMarkup, /data-building-vacancies="\$\{attr\(managedBuilding\.id\)\}">공실 현황 보기<\/button>/);
  assert.doesNotMatch(rentalMarkup, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.doesNotMatch(detail, /customer-embedded-building-management|customer-building-selector-bar|renderBuildingDetail\(managedBuilding\)|<h3>건물 관리<\/h3>/);
  assert.doesNotMatch(buildingCss, /\.customer-embedded-building-management|\.customer-building-selector-bar/);
  assert.ok(rendered.indexOf("customer-essential-summary") < rendered.indexOf("customer-hub-kpis"));
  assert.ok(rendered.indexOf("customer-hub-kpis") < rendered.indexOf("customer-priority-grid"));
  assert.ok(rendered.indexOf("customer-priority-grid") < rendered.indexOf("${consultationDetails}"));
  assert.ok(rendered.indexOf("${consultationDetails}") < rendered.indexOf("${secondaryDetails}"));
  assert.ok(rendered.indexOf("${secondaryDetails}") < rendered.indexOf("${rentalDetails}"));
  assert.doesNotMatch(detail, /customerSalesStageBadge|영업 미등록|영업 보기/);
  const buildingDetail = sourceBetween("function renderBuildingDetail", "function vacancyUnitSearchText");
  assert.doesNotMatch(buildingDetail, /building-rental-detail|<b>임대·공실 정보<\/b>/);
  assert.match(buildingCss, /\.customer-rental-details:not\(\[open\]\)>\.customer-rental-body\{display:none\}/);
  assert.match(buildingCss, /\.customer-rental-toolbar\{/);
});

test("customer detail consultation action prefills the customer and returns to an expanded history", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  const submit = sourceBetween('form.id === "consultationForm"', 'form.id === "relationshipPlanForm"');
  assert.match(detail, /<button type="button" class="secondary-button" data-action="new-consultation" data-customer-id="\$\{attr\(customer\.id\)\}">＋ 상담 기록<\/button>/);
  assert.match(appSource, /action === "new-consultation"\) consultationEditor\(actionControl\.dataset\.customerId \|\| selectedCustomerId, currentView\)/);
  assert.match(submit, /if \(returnView === "customers"\) selectedCustomerHubId = raw\.customerId/);
  assert.match(submit, /const consultationHistory = main\.querySelector\("\[data-customer-consultations\]"\)/);
  assert.match(submit, /consultationHistory\.open = true/);
  assert.match(submit, /consultationHistory\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(stylesSource, /\.crm-read-only \[data-action="new-consultation"\]/);
  assert.match(buildingCss, /\.customer-consultation-record b,\.customer-consultation-record span\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  assert.match(mainSource, /BRING_CRM_SCREENSHOT_ACTION === "customer-consultation-history"/);
  assert.ok((mainSource.match(/customer-consultation-history/g) || []).length >= 2, "the consultation screenshot action must also write a result JSON file");
});

test("partner vendor cards keep their actions while the remaining card opens a customer-style detail workspace", () => {
  const partnerView = sourceBetween("function renderPartnerVendorDetail", "function renderPartnerQuotes");
  assert.match(partnerView, /partner-vendor-toolbar-controls/);
  assert.match(partnerView, /partner-vendor-industry-filter[\s\S]*?data-partner-vendor-industry-filter[\s\S]*?partner-vendor-list-search[\s\S]*?data-partner-vendor-list-search/);
  assert.match(appSource, /searchEl\.closest\("\.global-search"\)\.hidden = officeView \|\| paymentCalendarView \|\| \["customers", "partnerVendors"\]\.includes\(currentView\)/);
  assert.match(appSource, /event\.target\.matches\("\[data-partner-vendor-list-search\]"\)[\s\S]*?crmSearchValue = event\.target\.value\.slice\(0, 160\)/);
  assert.match(stylesSource, /\.partner-vendor-toolbar-controls\{display:flex;align-items:center/);
  assert.match(partnerView, /data-partner-vendor-open/);
  assert.match(partnerView, /data-partner-vendor-edit/);
  assert.match(partnerView, /data-partner-vendor-link/);
  assert.doesNotMatch(partnerView, /<article class="partner-vendor-card" data-partner-vendor-edit/);
  assert.match(partnerView, /customer-hub-workspace partner-vendor-detail-workspace/);
  assert.match(partnerView, /customer-hub-selector-bar/);
  assert.match(partnerView, /data-partner-vendor-detail-select/);
  assert.equal((partnerView.match(/data-partner-vendor-detail-back/g) || []).length, 1);
  assert.ok(partnerView.indexOf("data-partner-vendor-detail-back") < partnerView.indexOf("data-partner-vendor-detail-select"));
  assert.match(partnerView, /customer-hub-selector-bar[^`]*?data-partner-vendor-detail-back>← 협력 업체 목록<\/button>[^`]*?data-partner-vendor-detail-select/);
  assert.doesNotMatch(partnerView, /customer-selector-heading[^`]*?<b>업체 선택<\/b>/);
  assert.doesNotMatch(partnerView, /data-partner-vendor-detail-back>목록으로<\/button>/);
  assert.match(partnerView, /building-hub-detail-head customer-hub-detail-head/);
  assert.match(partnerView, /building-identity-strip customer-essential-summary/);
  assert.match(partnerView, /building-hub-kpis customer-hub-kpis/);
  assert.match(partnerView, /building-detail-grid customer-priority-grid/);
  assert.match(partnerView, /data-action="new-partner-quote" data-partner-vendor-id="\$\{attr\(vendor\.id\)\}">＋ 상담 기록<\/button>/);
  assert.match(partnerView, /data-partner-vendor-consultations="\$\{attr\(vendor\.id\)\}"/);
  assert.match(appSource, /selectedPartnerVendorDetailId = partnerVendorOpen\.dataset\.partnerVendorOpen/);
  assert.match(appSource, /selectedPartnerVendorDetailId = partnerVendorDetailSelect\.value/);
  assert.match(appSource, /currentView === "partnerVendors"\) selectedPartnerVendorDetailId = ""/);
  assert.match(stylesSource, /\.partner-vendor-detail-avatar/);
  assert.match(stylesSource, /\.partner-vendor-detail-list-action/);
  assert.match(buildingCss, /\.partner-vendor-detail-workspace \.customer-hub-selector-bar\{grid-template-columns:auto minmax\(280px,1fr\)\}/);
  assert.match(stylesSource, /\.partner-vendor-card:focus-visible/);
  assert.match(mainSource, /BRING_CRM_SCREENSHOT_ACTION === "partner-vendor-detail"/);
});

test("partner consultation history is vendor-scoped, collapsible, and returns to the same detail after changes", () => {
  const partnerDetail = sourceBetween("function renderPartnerVendorDetail", "function renderPartnerVendors");
  const partnerList = sourceBetween("function renderPartnerVendors", "function renderPartnerQuotes");
  const editor = sourceBetween("function partnerQuoteEditor", "function taskEditor");
  const removeRecord = sourceBetween("async function deletePartnerQuoteRecord", "async function excludePartnerVendorRecord");
  const submit = sourceBetween('form.id === "partnerQuoteForm"', 'form.id === "taskForm"');

  assert.match(partnerDetail, /const quoteRecords = quotes\.map\(quoteRecord\)\.join\(""\)/);
  assert.doesNotMatch(partnerDetail, /quotes\.slice\(/);
  assert.match(partnerDetail, /<details class="customer-secondary-details partner-vendor-consultation-details" data-partner-vendor-consultations="\$\{attr\(vendor\.id\)\}">/);
  assert.match(partnerDetail, /<b>상담 기록<\/b>/);
  assert.match(partnerDetail, /\$\{quotes\.length\}건/);
  assert.match(partnerDetail, /아직 등록된 업체 상담 기록이 없습니다/);
  assert.doesNotMatch(partnerDetail, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.match(partnerDetail, /legacyConsultationSection\?\.remove\(\)/);
  assert.doesNotMatch(partnerList, /data-view="partnerQuotes"/);

  assert.match(editor, /function partnerQuoteEditor\(quoteId, vendorId = "", returnView = currentView\)/);
  assert.match(editor, /const requestedVendor = partnerVendorById\(vendorId\)/);
  assert.match(editor, /const linkedVendor = editing \? partnerVendorForQuote\(item\) : requestedVendor \|\| partnerVendorForQuote\(item\)/);
  assert.match(editor, /item\.vendorId = linkedVendor && linkedVendor\.id \|\| ""/);
  assert.match(editor, /item\.industry = editing \? partnerIndustry\(item\) : linkedVendor \? partnerIndustry\(linkedVendor\) : ""/);
  assert.match(editor, /form\.dataset\.returnView = returnView \|\| "partnerQuotes"/);
  assert.match(editor, /form\.dataset\.returnVendorId = linkedVendor && linkedVendor\.id \|\| vendorId \|\| ""/);
  assert.match(appSource, /action === "new-partner-quote"[\s\S]*?partnerQuoteEditor\("", actionControl\.dataset\.partnerVendorId \|\| "", currentView\)/);

  assert.match(partnerDetail, /function showPartnerVendorDetailAfterQuoteMutation\(vendorId\)[\s\S]*?selectedPartnerVendorDetailId = vendorId \|\| ""[\s\S]*?currentView = "partnerVendors"[\s\S]*?consultationHistory\.open = true[\s\S]*?consultationHistory\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(submit, /const returnView = form\.dataset\.returnView \|\| "partnerQuotes"/);
  assert.match(submit, /if \(returnView === "partnerVendors"\) showPartnerVendorDetailAfterQuoteMutation\(selectedVendor\.id\)/);
  assert.match(removeRecord, /if \(returnView === "partnerVendors"\)[\s\S]*?showPartnerVendorDetailAfterQuoteMutation\(returnVendorId \|\| quote\.vendorId\)/);
  assert.match(appSource, /deletePartnerQuoteRecord\(partnerQuoteDelete\.dataset\.partnerQuoteDelete, form\?\.dataset\.returnView, form\?\.dataset\.returnVendorId\)/);
  assert.match(stylesSource, /\.crm-read-only \[data-action="new-partner-quote"\]/);
});

test("customer header keeps legacy building actions without a work-building selector", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  const rendered = detail.slice(detail.indexOf("return `<header"));
  const customerActionTokens = [
    "data-customer-open",
    "data-customer-hub-edit",
    'data-action="new-consultation"',
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
  ];
  buildingActionTokens.reduce((previousIndex, token) => {
    const index = detail.indexOf(token);
    assert.ok(index > previousIndex, `${token} should follow the previous building action`);
    return index;
  }, -1);
  assert.match(detail, /const buildingActions = managedBuilding \?/);
  assert.match(detail, /const managedBuilding = buildings\[0\] \|\| null/);
  assert.match(detail, /data-building-edit="\$\{attr\(managedBuilding\.id\)\}"/);
  assert.doesNotMatch(detail, /data-customer-building-select|작업 건물|data-action="new-building"/);
  assert.doesNotMatch(detail, /data-building-new-case/);
  assert.match(detail, /customer-hub-head-actions" role="group" aria-label="고객과 건물 빠른 작업"/);
  assert.match(buildingCss, /\.customer-hub-head-actions\{[^}]*flex-wrap/);
  assert.match(buildingCss, /@media\(max-width:700px\)[\s\S]*?\.customer-hub-head-actions\{display:grid;grid-template-columns:repeat\(2/);
});

test("detail pages omit complaint shortcuts while complaint management keeps its create flow", () => {
  const customerDetail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  const buildingDetail = sourceBetween("function renderBuildingDetail", "function vacancyUnitSearchText");
  const casesView = sourceBetween("function renderCases", "function renderWorkflowCaseDetail");
  const editor = sourceBetween("function workflowCaseEditor", "function field");

  assert.doesNotMatch(customerDetail, /data-building-new-case/);
  assert.doesNotMatch(buildingDetail, /data-building-new-case/);
  assert.ok(
    (casesView.match(/data-action="new-workflow-case"/g) || []).length >= 2,
    "complaint management should keep its primary and empty-state create actions"
  );
  assert.match(editor, /function workflowCaseEditor\(buildingId\)/);
  assert.match(editor, /id="workflowCaseCreateForm"/);
  assert.match(appSource, /action === "new-workflow-case"\) workflowCaseEditor\(\)/);
});

test("customer detail removes work-building selection and customer-scoped building creation", () => {
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  assert.doesNotMatch(detail, /data-customer-building-select|작업 건물|customer-building-context/);
  assert.doesNotMatch(detail, /data-action="new-building"|buildingOptions/);
  assert.doesNotMatch(appSource, /const customerBuildingSelect = event\.target\.closest\("\[data-customer-building-select\]"\)/);
  assert.match(appSource, /function buildingEditor\(buildingId\)/);
  assert.doesNotMatch(appSource, /function buildingEditor\(buildingId, ownerCustomerId|selectedOwnerCustomerId/);
  assert.match(appSource, /action === "new-building"\) buildingEditor\(""\)/);
  assert.doesNotMatch(appSource, /action === "new-building"\) buildingEditor\("", actionControl\.dataset\.customerId/);
  assert.doesNotMatch(buildingCss, /\.customer-building-context|\.customer-building-select-control/);
  assert.match(buildingCss, /\.customer-secondary-details>summary:focus-visible/);
});

test("building edits opened from customer detail return to the customer workspace", () => {
  const editor = sourceBetween("function buildingEditor", "function updateVacancyScheduleGuide");
  const save = sourceBetween('form.id === "buildingForm"', 'form.id === "contractForm"');
  const detail = sourceBetween("function renderCustomerHubDetail", "const buildingCustomers");
  assert.match(editor, /const returnView = \["customers", "vacancies", "payments"\]\.includes\(currentView\) \? currentView : "buildings"/);
  assert.match(editor, /data-return-view="\$\{attr\(returnView\)\}"/);
  assert.match(editor, /const buildingIdentityEditor = editing \? "" :/);
  assert.match(editor, /<h2>\$\{editing \? "임대·공실 정보 수정" : "새 건물 등록"\}<\/h2>/);
  assert.match(editor, /name="\$\{editing \? "rentDeposit" : "naverBuildingUrl"\}"/);
  assert.match(detail, /data-building-edit="\$\{attr\(managedBuilding\.id\)\}">임대·공실 정보 수정<\/button>/);
  assert.match(save, /const returnView = \["customers", "vacancies", "payments"\]\.includes\(form\.dataset\.returnView\) \? form\.dataset\.returnView : "buildings"/);
  assert.match(save, /if \(returnView === "vacancies"\) selectedVacancyBuildingId = selectedBuildingId/);
  assert.match(save, /if \(returnView === "payments"\) paymentBuildingFilter = selectedBuildingId/);
  assert.match(save, /const name = String\(existing \? existing\.name : raw\.name/);
  assert.match(save, /type: existing \? existing\.type : raw\.type, status: existing \? existing\.status : raw\.status/);
  assert.match(save, /reason: existing \? "CRM 건물 임대·공실 정보 수정" : "CRM 건물 등록"/);
  assert.match(save, /currentView = returnView/);
});

test("new customer registration captures customer addresses without linking a building", () => {
  const editor = sourceBetween("function customerEditor", "function buildingNumberField");
  const fromForm = sourceBetween("function customerFromForm", "async function deleteActivityRecord");
  const submit = sourceBetween('form.id === "customerForm"', 'form.id === "partnerVendorForm"');
  assert.match(editor, /name="naverBuildingUrl"/);
  assert.match(editor, /data-building-link-lookup/);
  assert.match(editor, /data-building-link-lookup-status/);
  assert.match(editor, /<span>고객명 \*<\/span><input name="name" required/);
  assert.match(editor, /field\("도로명 주소", "roadAddress"/);
  assert.match(editor, /field\("지번 주소", "jibunAddress"/);
  assert.doesNotMatch(editor, /기존 건물 연결|name="buildingId"|건물 연결 안 함/);
  assert.match(fromForm, /const address = roadAddress \|\| jibunAddress \|\| legacyAddress/);
  assert.match(fromForm, /address, roadAddress, jibunAddress/);
  assert.doesNotMatch(fromForm, /raw\.buildingId|buildingIdLinks\[|buildingIdLinks,/);
  assert.doesNotMatch(submit, /requestedBuildingId|selectedBuilding|form\.elements\.buildingId/);
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

test("customer type supports storefront and a persisted custom value", () => {
  const editor = sourceBetween("function customerEditor", "function buildingNumberField");
  const fromForm = sourceBetween("function customerFromForm", "async function deleteActivityRecord");

  assert.match(editor, /\["건물주", "임차인", "상가", "법인", "협력업체", "직접 입력"\]/);
  assert.match(editor, /name="customType"/);
  assert.match(editor, /data-customer-custom-type/);
  assert.match(stylesSource, /\.simple-customer-form \[data-customer-custom-type\]\[hidden\]\{display:none!important\}/);
  assert.match(appSource, /function updateCustomerCustomTypeField/);
  assert.match(fromForm, /raw\.type === "직접 입력" \? String\(raw\.customType/);
  assert.match(fromForm, /type: customerType/);
});

test("building workspace uses the same management status vocabulary", () => {
  const buildingView = sourceBetween("function renderBuildings()", "function renderArchivedBuildings");
  assert.match(buildingView, /data-building-management-filter/);
  assert.match(buildingView, /managementStatusForBuilding/);
  assert.doesNotMatch(buildingView, /data-action="new-building"|＋ 건물 등록/);
  assert.match(buildingView, /data-action="new-customer">＋ 고객건물 추가<\/button>/);
  assert.match(appSource, /selectField\("관리 상태", "status", \["관리 예정", "관리 중", "관리 종료"\]/);
  assert.match(buildingCss, /\.management-filter\s*\{/);
  assert.match(buildingCss, /\.customer-hub-workspace/);
  assert.match(buildingCss, /\.customer-select-control/);
});

test("vacancy workspace remains available under customer management", () => {
  const vacancies = sourceBetween("function renderVacancies", "function vacancyConfigurationDraft");
  assert.match(appSource, /function renderVacancies\(\)/);
  assert.match(appSource, /currentView = "vacancies"/);
  assert.match(appSource, /고객·건물 관리에 등록한 고객 정보를 기준으로 층과 호실을 설정합니다/);
  assert.match(vacancies, /<b>고객건물 목록<\/b>/);
  assert.match(vacancies, /data-action="new-customer">＋ 고객건물 추가<\/button>/);
});

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = name => readFile(path.join(__dirname, "..", "src", name), "utf8");

test("desktop entry loads and navigates to the integrated cleaning center", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);
  assert.match(html, /data-view="cleaningCenter"/);
  assert.match(html, /cleaning-core\.js/);
  assert.match(html, /cleaning-ui\.js/);
  assert.match(app, /const Cleaning = window\.BringCleaningCore/);
  assert.match(app, /const CleaningUI = window\.BringCleaningUI/);
  assert.match(app, /cleaningCenter:\s*\[/);
  assert.match(app, /currentView === "cleaningCenter"\) renderCleaningCenter\(\)/);
  assert.match(app, /function renderCleaningCenter\(\)/);
});

test("cleaning order editor exposes explicit customer scope price and no-surcharge fields", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningOrderEditor\(orderId\)/);
  assert.match(app, /id="cleaningOrderForm"/);
  for (const name of ["customerName", "phone", "serviceType", "address", "scheduledAt", "totalAmount", "depositAmount", "scope", "exclusions"]) {
    assert.match(app, new RegExp('name="' + name + '"'));
  }
  assert.match(app, /현장 추가금 없음/);
});

test("cleaning order saves through the existing shared save and audit path", async () => {
  const app = await source("app.js");
  const submit = app.match(/else if \(form\.id === "cleaningOrderForm"\) \{([\s\S]*?)\n\s*\} else if/)?.[1] || "";
  assert.match(submit, /Cleaning\.createCleaningOrder/);
  assert.match(submit, /store\.cleaningOrders/);
  assert.match(submit, /logAudit\(/);
  assert.match(submit, /scheduleSave\(\)/);
  assert.match(submit, /renderCleaningOrderDrawer/);
});

test("cleaning order detail and ordered transition are wired", async () => {
  const app = await source("app.js");
  assert.match(app, /function renderCleaningOrderDrawer\(orderId\)/);
  assert.match(app, /CleaningUI\.renderCleaningOrderDetail/);
  assert.match(app, /data-cleaning-order-open/);
  assert.match(app, /data-cleaning-order-next/);
  assert.match(app, /Cleaning\.transitionCleaningOrder/);
});

test("dispatch field report QC and message editors are connected to durable collections", async () => {
  const app = await source("app.js");
  for (const editor of [
    "cleaningDispatchEditor", "cleaningReportEditor", "cleaningQcEditor", "cleaningMessageEditor"
  ]) assert.match(app, new RegExp("function " + editor + "\\(orderId\\)"));
  for (const form of [
    "cleaningDispatchForm", "cleaningReportForm", "cleaningQcForm", "cleaningMessageForm"
  ]) assert.match(app, new RegExp('id="' + form + '"'));
  for (const pair of [
    ["createCleaningDispatch", "cleaningDispatches"],
    ["createCleaningReport", "cleaningReports"],
    ["createCleaningQcReview", "cleaningQcReviews"],
    ["createCleaningMessage", "cleaningMessages"]
  ]) {
    assert.match(app, new RegExp("Cleaning\\." + pair[0]));
    assert.match(app, new RegExp("store\\." + pair[1] + "\\.push"));
  }
});

test("order detail exposes operational actions without pretending a message was sent", async () => {
  const ui = await source("cleaning-ui.js");
  assert.match(ui, /data-cleaning-dispatch-add/);
  assert.match(ui, /data-cleaning-report-add/);
  assert.match(ui, /data-cleaning-qc-add/);
  assert.match(ui, /data-cleaning-message-add/);
  assert.match(ui, /발송대기|draft/);
});

test("Partner registration and approval evidence are stored in the cleaning module", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningPartnerEditor\(partnerId\)/);
  assert.match(app, /id="cleaningPartnerForm"/);
  assert.match(app, /Cleaning\.createCleaningPartner/);
  assert.match(app, /store\.cleaningPartners\.push/);
  assert.match(app, /name="trial1Score"/);
  assert.match(app, /name="trial2Score"/);
  assert.match(app, /Cleaning\.approveCleaningPartner/);
});

test("order form captures variable costs and saves calculated contribution economics", async () => {
  const app = await source("app.js");
  for (const name of ["partnerPay", "directLabor", "advertisingCost", "paymentFeeRate", "parkingCost", "suppliesCost", "csReworkCost"]) {
    assert.match(app, new RegExp('name="' + name + '"'));
  }
  const submit = app.match(/else if \(form\.id === "cleaningOrderForm"\) \{([\s\S]*?)\n\s*\} else if/)?.[1] || "";
  assert.match(submit, /Cleaning\.applyCleaningEconomics/);
  assert.match(submit, /targetContributionMargin/);
});

test("customer payment and weekly Partner settlement use separate durable records", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningPaymentEditor\(orderId\)/);
  assert.match(app, /id="cleaningPaymentForm"/);
  assert.match(app, /Cleaning\.createCleaningPayment/);
  assert.match(app, /store\.cleaningPayments\.push/);
  assert.match(app, /function cleaningSettlementEditor\(partnerId\)/);
  assert.match(app, /id="cleaningSettlementForm"/);
  assert.match(app, /Cleaning\.createCleaningSettlement/);
  assert.match(app, /store\.cleaningSettlements\.push/);
  assert.match(app, /partnerPay:\s*Core\.money\(order\s*&&\s*order\.partnerPay\)/);
});

test("cleaning center receives the owner dashboard calculation", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.calculateCleaningDashboard/);
  assert.match(app, /payments:\s*store\.cleaningPayments/);
  assert.match(app, /settlements:\s*store\.cleaningSettlements/);
});

test("cleaning CS tickets are created from the order and stored durably", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningCaseEditor\(orderId\)/);
  assert.match(app, /id="cleaningCaseForm"/);
  assert.match(app, /Cleaning\.createCleaningCase/);
  assert.match(app, /store\.cleaningCases\.push/);
  assert.match(app, /cases:\s*store\.cleaningCases/);
});

test("cleaning cancellation approval payment and linked CS closure are wired", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningCancellationEditor\(orderId\)/);
  assert.match(app, /id="cleaningCancellationForm"/);
  assert.match(app, /Cleaning\.createCleaningCancellation/);
  assert.match(app, /Cleaning\.transitionCleaningCancellation/);
  assert.match(app, /type:\s*"refund"/);
  assert.match(app, /linkedCase\.status\s*=\s*"resolved"/);
  assert.match(app, /cancellations:\s*store\.cleaningCancellations/);
});

test("cleaning rework scheduling completion reinspection and CS closure are wired", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningReworkEditor\(orderId\)/);
  assert.match(app, /id="cleaningReworkForm"/);
  assert.match(app, /Cleaning\.createCleaningRework/);
  assert.match(app, /Cleaning\.transitionCleaningRework/);
  assert.match(app, /reworks:\s*store\.cleaningReworks/);
  assert.match(app, /linkedCase\.resolution\s*=\s*"재작업 및 재검수 완료"/);
});

test("closing a cleaning order creates one retention funnel and exposes action updates", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.createCleaningRetentionPlan/);
  assert.match(app, /store\.cleaningRetentionActions\.push/);
  assert.match(app, /Cleaning\.updateCleaningRetentionAction/);
  assert.match(app, /retentionActions:\s*store\.cleaningRetentionActions/);
});

test("preparing a retention action creates one linked customer message draft", async () => {
  const app = await source("app.js");
  assert.match(app, /retentionTemplateByType/);
  assert.match(app, /retentionActionId:\s*nextAction\.id/);
  assert.match(app, /store\.cleaningMessages\.push/);
  assert.match(app, /후속조치 문자 초안/);
});

test("customer completion report is generated from field and QC evidence and explicitly delivered", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.createCleaningCustomerReport/);
  assert.match(app, /store\.cleaningCustomerReports\.push/);
  assert.match(app, /Cleaning\.deliverCleaningCustomerReport/);
  assert.match(app, /customerReports:\s*store\.cleaningCustomerReports/);
});

test("cleaning center receives the retention workload dashboard", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.calculateCleaningFollowUpDashboard/);
  assert.match(app, /followUpDashboard/);
  assert.match(app, /store\.cleaningRetentionActions/);
});

test("cleaning center receives response and receivable alerts", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.calculateCleaningAlerts/);
  assert.match(app, /alerts,/);
  assert.match(app, /payments:\s*store\.cleaningPayments/);
});

test("cleaning center receives the approved sales price book", async () => {
  const app = await source("app.js");
  assert.match(app, /priceBook:\s*Cleaning\.CLEANING_PRICE_BOOK/);
});

test("cleaning order form applies the approved price book with an explicit manual-quote escape", async () => {
  const app = await source("app.js");
  assert.match(app, /name="priceProduct"/);
  assert.match(app, /name="priceBasis"/);
  assert.match(app, /name="useStandardPrice"/);
  const submit = app.match(/else if \(form\.id === "cleaningOrderForm"\) \{([\s\S]*?)\n\s*\} else if/)?.[1] || "";
  assert.match(submit, /Cleaning\.standardCleaningPrice/);
  assert.match(submit, /priceBookVersion/);
  assert.match(submit, /별도견적 대상/);
});

test("cleaning center receives the approved sales standards", async () => {
  const app = await source("app.js");
  assert.match(app, /salesStandards:\s*Cleaning\.CLEANING_SALES_STANDARDS/);
});

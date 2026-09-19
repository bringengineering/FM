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

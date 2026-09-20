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
  assert.match(app, /function cleaningOrderEditor\(orderId,\s*leadInput\)/);
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
  assert.match(submit, /Cleaning\.matchCleaningCustomer/);
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
  assert.match(app, /function cleaningPartnerEditor\(partnerId, leadInput\)/);
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
  assert.match(app, /satisfaction:\s*"satisfaction_check"/);
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
  assert.match(app, /dispatches:\s*store\.cleaningDispatches/);
  assert.match(app, /alerts,/);
  assert.match(app, /payments:\s*store\.cleaningPayments/);
});

test("cleaning center receives the external integration launch gate", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.calculateCleaningIntegrationReadiness/);
  assert.match(app, /integrationReadiness/);
  assert.match(app, /id="cleaningIntegrationForm"/);
  assert.match(app, /normalizeCleaningIntegrationSetup/);
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

test("customer quote drafts are created and explicitly issued from the order", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.createCleaningQuoteDocument/);
  assert.match(app, /store\.cleaningQuotes\.push/);
  assert.match(app, /Cleaning\.issueCleaningQuoteDocument/);
  assert.match(app, /quotes:\s*store\.cleaningQuotes/);
});

test("website estimate inbox prefills a cleaning order and closes the lead after conversion", async () => {
  const app = await source("app.js");
  assert.match(app, /inboundLeads:\s*store\.marketingLeadInbox/);
  assert.match(app, /data-cleaning-lead-convert/);
  assert.match(app, /cleaningOrderEditor\("",\s*lead\)/);
  assert.match(app, /name="marketingLeadId"/);
  const submit = app.match(/else if \(form\.id === "cleaningOrderForm"\) \{([\s\S]*?)\n\s*\} else if/)?.[1] || "";
  assert.match(submit, /raw\.marketingLeadId/);
  assert.match(submit, /lead\.status\s*=\s*"converted"/);
  assert.match(submit, /lead\.convertedOrderId\s*=\s*item\.id/);
  assert.match(app, /creativeId:\s*lead\.utmContent/);
  assert.match(app, /name="creativeId"/);
  assert.match(submit, /creativeId:\s*String\(raw\.creativeId/);
});

test("website Partner applications open screening and close after Partner registration", async () => {
  const [app, ui] = await Promise.all([source("app.js"), source("cleaning-ui.js")]);
  assert.match(ui, /leadType\s*===\s*"partner_application"/);
  assert.match(ui, /data-cleaning-partner-lead/);
  assert.match(app, /cleaningPartnerEditor\("",\s*lead\)/);
  assert.match(app, /name="marketingLeadId"/);
  const submit = app.match(/else if \(form\.id === "cleaningPartnerForm"\) \{([\s\S]*?)\n\s*\} else if/)?.[1] || "";
  assert.match(submit, /raw\.marketingLeadId/);
  assert.match(submit, /lead\.convertedPartnerId\s*=\s*item\.id/);
});

test("new website estimate leads alert the signed-in operator on remote arrival", async () => {
  const app = await source("app.js");
  assert.match(app, /function notifyNewCleaningLeads\(previousStore, nextStore\)/);
  assert.match(app, /새 견적 문의/);
  assert.match(app, /showToast\(/);
  assert.match(app, /new Notification\(/);
  assert.match(app, /function applyRemoteStore\(data\)[\s\S]*?notifyNewCleaningLeads\(store, next\)/);
});

test("quote and completion report previews print customer-facing documents", async () => {
  const [html, css, app] = await Promise.all([source("index.html"), source("styles.css"), source("app.js")]);
  assert.match(html, /id="cleaningPrintRoot"/);
  assert.match(css, /@media print/);
  assert.match(css, /cleaning-document-sheet/);
  assert.match(app, /function cleaningQuotePreview\(quoteId\)/);
  assert.match(app, /function cleaningCustomerReportPreview\(reportId\)/);
  assert.match(app, /data-cleaning-quote-preview/);
  assert.match(app, /data-cleaning-customer-report-preview/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /서창환/);
  assert.match(app, /현장 추가금 없음/);
});

test("the cleaning center exposes a safe message outbox and queue action", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.calculateCleaningMessageOutbox\(store\.cleaningMessages\)/);
  assert.match(app, /messageOutbox,/);
  assert.match(app, /data-cleaning-message-queue/);
  assert.match(app, /Cleaning\.queueCleaningMessage/);
  assert.match(app, /공급사 연동 후 자동 전송/);
});

test("call center intake routes IVR calls and prepares missed-call follow-up messages", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningCallTicketEditor/);
  assert.match(app, /id="cleaningCallTicketForm"/);
  assert.match(app, /name="ivrOption"/);
  assert.match(app, /Cleaning\.createCleaningCallTicket/);
  assert.match(app, /Cleaning\.completeCleaningCallTicket/);
  assert.match(app, /cleaningCallTickets/);
  assert.match(app, /templateId:\s*"missed_call"/);
});

test("payment requests link PayApp URLs, message drafts, and confirmed receipts", async () => {
  const app = await source("app.js");
  assert.match(app, /function cleaningPaymentRequestEditor/);
  assert.match(app, /id="cleaningPaymentRequestForm"/);
  assert.match(app, /Cleaning\.createCleaningPaymentRequest/);
  assert.match(app, /Cleaning\.attachCleaningPaymentLink/);
  assert.match(app, /templateId:\s*"payment_request"/);
  assert.match(app, /raw\.paymentRequestId/);
  assert.match(app, /Cleaning\.reconcileCleaningPaymentRequest/);
});

test("Cleaning Center mutations are guarded by business role", async () => {
  const app = await source("app.js");
  assert.match(app, /function currentCleaningRole\(\)/);
  assert.match(app, /function requireCleaningAction\(action\)/);
  assert.match(app, /Cleaning\.canCleaningAction\(currentCleaningRole\(\), action\)/);
  assert.match(app, /cleaningFormPermissions/);
  assert.match(app, /cleaningPaymentForm:\s*"payment_confirm"/);
  assert.match(app, /cleaningSettlementForm:\s*"settlement"/);
  assert.match(app, /data-cleaning-cancellation-approve.*refund_approve/s);
});

test("Cleaning Center receives Creative ID performance", async () => {
  const app = await source("app.js");
  assert.match(app, /Cleaning\.calculateCreativePerformance/);
  assert.match(app, /creativePerformance,/);
});

test("orders expose a shared Order ID photo archive", async () => {
  const app = await source("app.js");
  assert.match(app, /name="photoFolderUrl"/);
  assert.match(app, /Cleaning\.cleaningPhotoArchive/);
  assert.match(app, /item\.photoFolderName\s*=/);
  assert.match(app, /photoArchive:/);
});

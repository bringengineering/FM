const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const indexSource = read("index.html");

test("발송 메뉴는 CRM의 알림톡 발송 하나이고 문서 화면은 독립적으로 남는다", () => {
  const crm = indexSource.slice(indexSource.indexOf('data-nav-folder="customer-management"'), indexSource.indexOf('data-nav-folder="project"'));
  const docs = indexSource.slice(indexSource.indexOf('data-nav-folder="documents"'), indexSource.indexOf('data-nav-folder="workflow"'));
  assert.match(crm, /data-view="customerAlimTalk"/);
  for (const view of ["quotes", "workReports", "buildingMonthlyReports"]) assert.ok(docs.includes('data-view="' + view + '"'));
  for (const view of ["customerMessages", "customerNotices"]) assert.ok(!indexSource.includes('data-view="' + view + '"'));
  assert.equal(indexSource.split('data-view="customerAlimTalk"').length - 1, 1);
  assert.doesNotMatch(docs, /customerAlimTalk/);
});

test("견적서·결과보고서의 단계·다음 안내와 자동 전달 경로를 제거했다", () => {
  assert.doesNotMatch(appSource, /docFlowStrip|docFlowState|handOffQuoteToReport|handOffReportToNotice|data-df-/);
  assert.doesNotMatch(indexSource, /doc-flow-core\.js/);
  const quotes = appSource.slice(appSource.indexOf("function renderQuotes()"), appSource.indexOf("function refreshQuotesView()"));
  assert.match(quotes, /main.innerHTML = renderAiQuoteAssistant\(\)/);
  assert.doesNotMatch(quotes, /reportSeedFromQuote|normalizeReport|currentView =/);
});

test("기존 고객 알림·메시지 주소는 통합 화면으로 전환하고 고객 업무 문맥은 보존한다", () => {
  const start = appSource.indexOf("function renderOperationsWorkspace() {");
  const body = appSource.slice(start + "function renderOperationsWorkspace() {".length, appSource.indexOf('    if (!["customers", "buildingAtlas"]', start));
  assert.ok(body.trim());
  for (const oldView of ["customerMessages", "customerNotices", "customerAlimTalk"]) {
    const context = {currentView: oldView, customerAlimTalkState: {}, selectedMessageCustomerId: "sample-customer", selectedMessageTemplateId: "cleaning_schedule", selectedMessageSourceType: "cleaningOrder", selectedMessageSourceId: "sample-order"};
    vm.runInNewContext(body, context);
    assert.equal(context.currentView, "customerAlimTalk");
    if (oldView === "customerMessages") {
      assert.equal(context.customerAlimTalkState.selectedCustomerIds[0], "sample-customer");
      assert.equal(context.customerAlimTalkState.sourceId, "sample-order");
      assert.equal(context.customerAlimTalkState.category, "notice");
    }
  }
});

test("비동기 자료·발신 설정이 도착하면 통합 화면을 갱신한다", () => {
  for (const name of ["refreshDocumentDeliveryCapabilities", "loadWorkReports", "refreshQuotesView"]) {
    const start = appSource.indexOf("function " + name + "(");
    const body = appSource.slice(start, appSource.indexOf("\n  }", start));
    assert.match(body, /currentView === "customerAlimTalk"\) renderCustomerAlimTalk\(\)/);
  }
});

test("알림 채널이 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:customer-notice-send"));
  assert.equal(MutationPolicy.classification("crm:customer-notice-send"), "mutation");
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:customer-notice-send"'));
  assert.ok(preloadSource.includes('"crm:customer-notice-send"'));
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:work-report-kakao-send"));
  assert.equal(MutationPolicy.classification("crm:work-report-kakao-send"), "mutation");
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:work-report-kakao-send"'));
  assert.ok(preloadSource.includes('"crm:work-report-kakao-send"'));
});

test("작업 결과보고서 알림톡은 승인 상태와 수신번호를 확인하고 보낸다", () => {
  const send = mainSource.slice(mainSource.indexOf("async function sendCustomerNotice"), mainSource.indexOf("async function sendTelegramDirective"));
  assert.ok(send, "sendCustomerNotice 가 없다");
  assert.match(send, /requireTelegramAdmin\(\)/u);
  assert.match(send, /TelegramCore\.composeCustomerNotice/u);
  assert.ok(!/sendSms|문자로/u.test(send), "여기서 문자로 넘기면 안 된다");
  const kakao = mainSource.slice(mainSource.indexOf("async function sendWorkReportToCustomerByKakao"), mainSource.indexOf("// 수주 진행 결과물."));
  assert.ok(kakao, "결과보고서 알림톡 발송 경로가 없다");
  assert.match(kakao, /user\.role !== "admin"/u);
  assert.match(kakao, /capabilities\.kakao !== true/u);
  assert.match(kakao, /WorkReportCore\.validateReport/u);
  assert.match(kakao, /ownerContact\.replace\(\/\\D\/gu, ""\)/u);
  assert.match(kakao, /documentType: "completion_report"/u);
  assert.match(kakao, /channel: "kakao"/u);
  assert.match(kakao, /"revoke"/u);
  assert.match(appSource, /requestConfirmationFor/);
  assert.match(appSource, /api\.sendSavedCustomerDocument/);
  assert.match(mainSource, /async function readSavedWorkReportPdf/);
  assert.match(mainSource, /remoteClient\.loadWorkReports\(\)/);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const DocFlow = require("../src/doc-flow-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const indexSource = read("index.html");

test("문서관리에 견적서·결과보고서·고객 알림이 그 순서로 놓여 있다", () => {
  const nav = indexSource.slice(indexSource.indexOf("문서관리"));
  const order = DocFlow.STEPS.map(step => nav.indexOf(`data-view="${step.view}"`));
  assert.ok(order.every(at => at >= 0), `문서관리에 없는 화면: ${JSON.stringify(order)}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "순서가 견적서 → 결과보고서 → 고객 알림 이어야 한다");
  // 같은 화면이 두 군데 있으면 어느 것을 눌러야 하는지 알 수 없다.
  assert.equal(indexSource.split('data-view="quotes"').length - 1, 1);
});

test("세 화면이 다 열리고 주소로도 열린다", () => {
  for (const step of DocFlow.STEPS) {
    assert.ok(appSource.includes(`"${step.view}"`), step.view);
  }
  // viewMeta 에 없으면 화면이 조용히 대시보드로 튕긴다.
  assert.match(appSource, /\n    customerNotices: \[/u);
  assert.match(appSource, /\n    workReports: \[/u);
  const allow = appSource.split(/\r?\n/u).filter(line => line.includes('query.get("view")')).join("\n");
  for (const view of ["workReports", "customerNotices"]) {
    assert.ok(allow.includes(`"${view}"`), `주소로 못 여는 화면: ${view}`);
  }
  assert.match(appSource, /currentView === "customerNotices"\) renderCustomerNotices\(\)/u);
});

test("모듈을 화면이 싣는다", () => {
  assert.ok(indexSource.includes('src="./doc-flow-core.js"'));
  assert.ok(indexSource.includes('src="./notify-core.js"'), "문구를 만드는 모듈을 안 실으면 알림 화면이 안 뜬다");
});

test("견적서가 아는 것을 결과보고서가 물려받는다", () => {
  const hand = appSource.slice(appSource.indexOf("function handOffQuoteToReport"), appSource.indexOf("function handOffReportToNotice"));
  assert.ok(hand, "handOffQuoteToReport 가 없다");
  assert.match(hand, /F\.reportSeedFromQuote\(quote\)/u);
  assert.match(hand, /R\.normalizeReport\(seed\)/u);
  // 못 채운 칸을 말 없이 넘기면 빈 보고서가 그대로 나간다.
  assert.match(hand, /missing\.join/u);
  assert.match(hand, /특수·기타/u);
  // 견적을 만들 때마다 저절로 만들면 안 한 일의 보고서가 쌓인다.
  assert.ok(!/api\.saveWorkReport/u.test(hand), "누르기 전에 저장하면 안 된다");
});

test("알림 문구를 화면에서 새로 쓰지 않는다", () => {
  const hand = appSource.slice(appSource.indexOf("function handOffReportToNotice"), appSource.indexOf("function renderCustomerNotices"));
  assert.match(hand, /N\.draftFor\("result", F\.noticeValuesFromReport\(report\)\)/u);
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
  assert.match(appSource, /발신 설정 또는 승인 템플릿 확인 필요/u);
  assert.match(appSource, /고객에게 알림톡 발송/u);
  // 회사 텔레그램은 내부 전달 문구 수동 복사용으로 남겨 둔다.
  assert.match(appSource, /고객에게 바로 가지 않습니다/u);
});

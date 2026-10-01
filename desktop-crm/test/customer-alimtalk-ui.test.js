const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MessagePolicy = require("../src/message-policy");
globalThis.BringMessagePolicy = MessagePolicy;
const AlimTalkUI = require("../src/customer-alimtalk-ui");
const MutationPolicy = require("../src/mutation-policy");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const customer = (id, name, phone, consent = {}) => ({ id, name, phone, messageConsents: consent });

test("알림톡 발송 화면은 네 가지 발송 종류와 고객 검색·선택을 표시한다", () => {
  const html = AlimTalkUI.render({ customers: [customer("c1", "고객 <김>", "010-1234-5678")], writable: true });
  for (const label of ["견적서", "건물 월간보고서", "작업 결과보고서", "안내"]) assert.match(html, new RegExp(label));
  assert.match(html, /data-alimtalk-search/);
  assert.match(html, /data-alimtalk-recipient="c1"/);
  assert.match(html, /고객 &lt;김&gt;/);
  assert.doesNotMatch(html, /고객 <김>/);
  assert.match(html, /010-\*\*\*\*-5678/);
  assert.doesNotMatch(html, /010-1234-5678/);
});

test("문서 자료는 고객별로 한 명만 고를 수 있고 완성 자료·관리자·발신 설정을 요구한다", () => {
  const html = AlimTalkUI.render({ customers: [customer("c1", "고객1", "010-1111-1111"), customer("c2", "고객2", "010-2222-2222")], selectedCustomerIds: ["c1", "c2"], category: "workReport", writable: true, adminCanSend: true, kakaoReady: true, workReportReady: true, workReportId: "wr1" });
  assert.match(html, /한 명씩 발송해야 합니다/);
  assert.match(html, /data-alimtalk-send[^>]*disabled/);
});

test("광고성 안내는 동의 증빙이 있는 전체 고객에 한해 다중 선택을 허용한다", () => {
  const consent = { kakao: { status: "granted", consentedAt: "2026-09-01", evidenceRef: "contract-1", consentTextVersion: "marketing-v1" } };
  const html = AlimTalkUI.render({ customers: [customer("c1", "고객1", "010-1111-1111", consent), customer("c2", "고객2", "010-2222-2222", consent)], selectedCustomerIds: ["c1", "c2"], category: "notice", templateId: "promotion", writable: true, kakaoReady: true });
  assert.match(html, /광고성/);
  assert.match(html, /data-alimtalk-send[^>]*>알림톡 보내기 · 2명/);
});

test("정보성 안내는 CRM 원본 연결과 정책 판정을 통과해야 보낼 수 있다", () => {
  const html = AlimTalkUI.render({ customers: [customer("c1", "고객", "010-1234-5678")], selectedCustomerIds: ["c1"], category: "notice", templateId: "work_completed", sourceType: "work", sourceId: "work_1", writable: true, kakaoReady: true });
  assert.match(html, /연결 업무 ID/);
  assert.match(html, /data-alimtalk-send[^>]*>알림톡 보내기 · 1명/);
  const blocked = AlimTalkUI.render({ customers: [customer("c1", "고객", "010-1234-5678")], selectedCustomerIds: ["c1"], category: "notice", templateId: "work_completed", sourceType: "", sourceId: "", writable: true, kakaoReady: true });
  assert.match(blocked, /정보성 안내와 연결할 상담·작업/);
  assert.match(blocked, /data-alimtalk-send[^>]*disabled/);
});

test("견적서·월간·결과보고서 발송 IPC는 승인된 mutation 경로로 보호된다", () => {
  const main = read("main.js");
  const preload = read("preload.js");
  const app = read("app.js");
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:quote-kakao-send"));
  assert.equal(MutationPolicy.classification("crm:quote-kakao-send"), "mutation");
  assert.match(main, /secureCanonicalHandle\("crm:quote-kakao-send", input => sendQuoteToCustomerByKakao\(input\)\)/);
  assert.match(preload, /sendQuoteToCustomerByKakao: input => ipcRenderer\.invoke\("crm:quote-kakao-send", input\)/);
  assert.match(main, /quote\.recipientPhone\.replace\(\/\\D\/gu, ""\) !== customerPhone/);
  assert.match(main, /options\.targetCustomerId.*ownerCustomerId/);
  assert.match(app, /selectedBuildingOwner/);
});

test("앱은 알림톡 전용 네비게이션·화면 모듈을 고객 관리 폴더에서 로드한다", () => {
  const index = read("index.html");
  const app = read("app.js");
  const styles = read("styles.css");
  assert.ok(index.indexOf("message-policy.js") < index.indexOf("customer-alimtalk-ui.js"));
  assert.match(index, /data-view="customerAlimTalk"/);
  assert.match(app, /currentView === "customerAlimTalk"\) renderCustomerAlimTalk\(\)/);
  assert.match(app, /sendCustomerAlimTalk/);
  assert.match(styles, /\.customer-alimtalk-page/);
});

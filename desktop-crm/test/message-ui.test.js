const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MessageUI = require("../src/message-ui");

test("composer shows recipient, legal classification, consent and delivery history", () => {
  const html = MessageUI.renderWorkspace({
    customers: [{ id: "c1", name: "청소 고객", phone: "010-1234-5678", messageConsents: {} }],
    selectedCustomerId: "c1", templateId: "building_management_offer", channel: "kakao", deliveries: [], writable: true
  });
  assert.match(html, /고객 메시지/);
  assert.match(html, /광고성/);
  assert.match(html, /수신 동의가 없습니다/);
  assert.match(html, /발송 이력/);
  assert.match(html, /disabled/);
});

test("customer consent card exposes both channel states and editor action", () => {
  const html = MessageUI.renderConsentCard({ id: "c1", messageConsents: { kakao: { status: "granted", consentedAt: "2026-08-01", evidenceRef: "form-1", consentTextVersion: "v1" } } }, true);
  assert.match(html, /카카오/);
  assert.match(html, /SMS/);
  assert.match(html, /동의됨/);
  assert.match(html, /수신 동의 관리/);
});

test("information composer preserves a selected source and enables confirmation", () => {
  const html = MessageUI.renderWorkspace({ customers: [{ id: "c1", name: "고객", phone: "010-1234-5678" }], selectedCustomerId: "c1", templateId: "cleaning_schedule", channel: "kakao", sourceType: "work", sourceId: "work_1", writable: true });
  assert.match(html, /option value="work" selected/);
  assert.match(html, /value="work_1"/);
  assert.match(html, /발송 가능/);
  assert.doesNotMatch(html, /type="submit" class="primary-button" disabled/);
});

test("cleaning order message composer shows canonical order context and keeps it as the required source", () => {
  const html = MessageUI.renderWorkspace({
    customers: [{ id: "c1", name: "김민수", phone: "010-1234-5678" }],
    selectedCustomerId: "c1", templateId: "cleaning_schedule", channel: "kakao",
    sourceType: "cleaningOrder", sourceId: "BR-260926-00128", writable: true,
    cleaningOrderContext: { id: "BR-260926-00128", customerId: "c1", serviceLabel: "입주 청소", desiredDate: "2026-09-29", amountLabel: "270,000원" }
  });
  assert.match(html, /option value="cleaningOrder" selected/);
  assert.match(html, /data-cleaning-message-order="BR-260926-00128"/);
  assert.match(html, /입주 청소/);
  assert.match(html, /2026-09-29/);
  assert.match(html, /270,000원/);
  assert.match(html, /발송 가능/);
  assert.match(html, /발송 내용 확인/);
});

test("app shell includes policy module and customer message navigation", () => {
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(index, /message-policy\.js/);
  assert.match(index, /message-ui\.js/);
  assert.match(index, /data-view="customerAlimTalk"/);
  assert.doesNotMatch(index, /data-view="customerMessages"/);
  assert.match(app, /currentView === "customerMessages"/);
  assert.match(app, /renderCustomerMessages/);
  assert.match(app, /data-message-consent-edit/);
  assert.match(app, /customerMessageForm/);
  assert.match(app, /open-cleaning-order-message/);
  assert.match(app, /cleaningOrderContext/);
  assert.match(styles, /\.message-workspace/);
});
test("통합 화면의 상세 안내 도구는 중복 제목·탭·이력 없이 기존 입력 기능을 유지한다", () => {
  const html = MessageUI.renderWorkspace({embedded: true, customers: [{id: "c1", name: "샘플 고객", phone: "01000000000"}], selectedCustomerId: "c1", templateId: "cleaning_schedule", sourceType: "work", sourceId: "work_1", channel: "sms", writable: true});
  assert.doesNotMatch(html, /<h2>|data-message-mode|class="message-history"/);
  assert.match(html, /customerMessageForm/);
  assert.match(html, /option value="sms" selected/);
  assert.match(html, /수신 동의 관리/);
  assert.match(html, /name="note"/);
});

test("통합 발송 이력은 문서·메시지를 함께 표시하고 원본을 변경하지 않으며 HTML을 이스케이프한다", () => {
  const deliveries = [{documentName: "견적 <img>", customerName: "샘플", channel: "kakao", status: "requested"}, {templateLabel: "일정 안내", customerName: "샘플", channel: "sms", status: "delivered"}];
  const before = JSON.stringify(deliveries);
  const html = MessageUI.renderHistory({deliveries});
  assert.match(html, /견적 &lt;img&gt;/);
  assert.match(html, /일정 안내/);
  assert.match(html, /SMS/);
  assert.doesNotMatch(html, /<img>/);
  assert.equal(JSON.stringify(deliveries), before);
});

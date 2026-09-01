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

test("app shell includes policy module and customer message navigation", () => {
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
  assert.match(index, /message-policy\.js/);
  assert.match(index, /message-ui\.js/);
  assert.match(index, /data-view="customerMessages"/);
  assert.match(app, /currentView === "customerMessages"/);
  assert.match(app, /renderCustomerMessages/);
  assert.match(app, /data-message-consent-edit/);
  assert.match(app, /customerMessageForm/);
  assert.match(styles, /\.message-workspace/);
});

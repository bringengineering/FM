const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../src/cleaning-center-ui");

const fixture = () => ({
  now: "2026-09-28T02:00:00.000Z",
  customers: [
    { id: "c-1", name: "김민수", phone: "010-1234-5678", roadAddress: "원주시 무실로 10" },
    { id: "c-2", name: "이선영", phone: "" },
  ],
  activities: [
    { id: "a-1", customerId: "c-1", type: "전화", occurredAt: "2026-09-27T01:00:00.000Z", summary: "입주청소 일정 문의", nextAction: "희망 시간 확인", nextContactAt: "2026-09-28T03:00:00.000Z", owner: "김현진" },
    { id: "a-2", customerId: "c-2", type: "전화", occurredAt: "2026-09-26T01:00:00.000Z", summary: "통화 이력" },
    { id: "a-3", customerId: "missing", type: "전화", occurredAt: "2026-09-25T01:00:00.000Z", summary: "잘못 연결된 활동" },
  ],
  orders: [{ id: "BR-001", customerId: "c-1", title: "입주청소 24평", status: "reviewing", desiredDate: "2026-09-29" }],
  canWrite: true,
});

test("CTI console derives callback work and recent phone history from CRM records", () => {
  assert.equal(typeof UI.renderCleaningCti, "function");
  const summary = UI.summarizeCleaningCti(fixture());
  assert.equal(summary.callbackCount, 1);
  assert.deepEqual(summary.callbacks.map(item => item.activityId), ["a-1"]);
  assert.deepEqual(summary.recentCalls.map(item => item.activityId), ["a-1", "a-2"]);
  assert.equal(summary.liveConnection, "disconnected");
  assert.equal(summary.liveQueueCount, null);
});

test("CTI screen labels absent provider data and never invents inbound calls or call controls", () => {
  const html = UI.renderCleaningCti(fixture());
  for (const text of ["CTI 상담센터", "전화 연동 안 됨", "실시간 전화 대기열 자료가 연결되지 않았습니다", "콜백 예정", "김민수", "희망 시간 확인", "통화 이력", "CRM 상담 활동"])
    assert.ok(html.includes(text), `screen contains ${text}`);
  assert.doesNotMatch(html, /수신 전화가 들어왔습니다|통화 중|녹취 중|대기 전화\s*\d+건/);
  assert.match(html, /href="tel:01012345678"/);
  assert.doesNotMatch(html, /tel:[^" ]*<|tel:010999/);
});

test("CTI actions route to existing CRM customer, quote, message, order and consultation flows", () => {
  const html = UI.renderCleaningCti(fixture());
  for (const [attribute, target] of [["data-action=\"new-consultation\"", "c-1"], ["data-view=\"quotes\"", "quotes"], ["data-cleaning-cti-message=\"c-1\"", null], ["data-view=\"cleaningCenter\"", "cleaningCenter"]]) {
    assert.ok(html.includes(attribute), `screen exposes ${attribute}`);
    if (target) assert.ok(html.includes(target));
  }
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  assert.match(app, /renderCleaningCtiCenter/);
  assert.match(app, /cleaningCtiCustomer/);
  assert.match(app, /currentView = "customerMessages"/);
});

test("CTI local preview enters the cleaning workspace and captures the rendered CRM screen", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  assert.match(main, /BRING_CRM_SCREENSHOT_ACTION === "cleaning-cti-preview"/);
  assert.match(main, /window\.__crmSmokeNavigate\('cleaningCti'\)/);
  assert.match(main, /root\.textContent\.includes\('실시간 CTI 연결이 없습니다'\)/);
});

"use strict";
// 2026-11-03 햇빛빌라 실제 발송에서 나온 후속 문제들의 회귀 시험.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

test("발송 직후 확인한 전달 결과를 발송 이력에도 반영한다", () => {
  const start = app.indexOf("async function refreshCustomerAlimTalkDelivery(");
  const body = app.slice(start, app.indexOf("\n  }\n", start));
  assert.match(body, /customerDocumentDeliveryStatus\.set\(receipt\.messageId, \{generation, status: result\.status\}\)/);
});

test("발송 이력을 열면 '전달 확인 중' 인 최근 문서 발송을 한 번씩 읽기만 해서 갱신한다", () => {
  const start = app.indexOf("async function autoRefreshPendingDeliveries(");
  assert.ok(start > 0);
  const body = app.slice(start, app.indexOf("\n  function renderCustomerAlimTalk()", start));
  assert.match(body, /row\.status === "전달 확인 중"/);
  assert.match(body, /\.slice\(0, 10\)/);
  assert.match(body, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(body, /api\.readCustomerDocumentDelivery\(\{messageId: row\.messageId\}\)/);
  assert.match(body, /autoCheckedDeliveries\.add/);
  // 읽기만 한다 — 발송 API 를 부르지 않는다.
  assert.doesNotMatch(body, /sendSavedCustomerDocument|sendCustomer|createAndSend/);
  assert.match(app, /function renderCustomerAlimTalk\(\) \{\r?\n\s*setTimeout\(\(\) => \{ void autoRefreshPendingDeliveries\(\); \}, 0\);/);
});

test("건물을 바꾸면 손대지 않은 AI 요약은 비우고, 사람이 고친 문장은 둔다", () => {
  const start = app.indexOf('if (event.target.matches("[data-report-building]")) {');
  const body = app.slice(start, app.indexOf("syncReportDraft();", start));
  assert.match(body, /form\.elements\.summary\.value === reportState\.aiSummaryText/);
  assert.match(body, /form\.elements\.summary\.value = "";/);
  assert.match(app, /reportState\.aiSummaryText = text;/);
  // 작업일 변경으로 날짜만 바뀐 AI 요약도 여전히 'AI 가 쓴 그대로' 로 본다.
  assert.match(app, /if \(reportState\.aiSummaryText && reportState\.aiSummaryText === String\(raw\.summary \|\| ""\)\) reportState\.aiSummaryText = moved;/);
});

test("전·후 나누기 실패 안내는 새 기준을 설명한다", () => {
  assert.match(app, /작업 전·후 사이로 볼 만한 촬영 공백\(15분 이상, 또는 다른 간격보다 뚜렷이 긴 5분 이상\)을 찾지 못했습니다/);
});

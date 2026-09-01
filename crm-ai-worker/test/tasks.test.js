import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskMessages, normalizeTaskResult, supportedTaskIds } from "../src/tasks.js";

test("task contract exposes exactly the approved CRM automation tasks", () => {
  assert.deepEqual(supportedTaskIds(), [
    "assistant_summary",
    "next_action",
    "sales_message",
    "work_report",
    "consultation_structure",
    "sales_focus_explanation",
    "sales_followup_message",
    "complaint_triage",
    "vendor_request",
    "work_order",
    "completion_report",
    "monthly_management_report",
    "quote_draft"
  ]);
  assert.throws(() => buildTaskMessages("unknown", "내용", {}), error => error?.code === "UNSUPPORTED_TASK");
});

test("quote task requires an exact evidence-bounded item total", () => {
  const messages = buildTaskMessages("quote_draft", "햇빛빌라 입주청소 12만원", {});
  assert.match(messages[0].content, /총액.*변경/);
  assert.match(messages[0].content, /세부 품목/);
  assert.deepEqual(normalizeTaskResult("quote_draft", {
    recipient: "햇빛빌라", projectName: "햇빛빌라 입주청소", service: "입주청소", summary: "입주 전 청소",
    totalAmount: 120000,
    items: [{ name: "입주청소", detail: "실내 전체 청소", quantity: 1, unit: "식", unitPrice: 120000, note: "" }],
    notes: ["현장 확인 후 범위 확정"]
  }), {
    recipient: "햇빛빌라", projectName: "햇빛빌라 입주청소", service: "입주청소", summary: "입주 전 청소",
    totalAmount: 120000,
    items: [{ name: "입주청소", detail: "실내 전체 청소", quantity: 1, unit: "식", unitPrice: 120000, note: "" }],
    notes: ["현장 확인 후 범위 확정"]
  });
  assert.throws(() => normalizeTaskResult("quote_draft", {
    recipient: "햇빛빌라", projectName: "입주청소", service: "입주청소", summary: "청소",
    totalAmount: 120000, items: [{ name: "청소", detail: "전체", quantity: 1, unit: "식", unitPrice: 110000 }]
  }), error => error?.code === "AI_INVALID_RESPONSE");
});

test("management report prompt forbids recalculation and requires metric evidence", () => {
  const messages = buildTaskMessages(
    "monthly_management_report",
    JSON.stringify({ month: "2026-08", metricEvidence: { finance_gross_profit: 13000 } }),
    { month: "2026-08" }
  );

  assert.match(messages[0].content, /계산|수정/);
  assert.match(messages[0].content, /지표/);
  assert.match(messages[1].content, /finance_gross_profit/);
});

test("new language tasks normalize to bounded text only", () => {
  for (const task of [
    "sales_focus_explanation", "sales_followup_message", "complaint_triage",
    "vendor_request", "work_order", "completion_report", "monthly_management_report"
  ]) {
    assert.deepEqual(normalizeTaskResult(task, { text: "  검토 가능한 초안  ", extra: "제거" }), { text: "검토 가능한 초안" });
  }
});

test("task messages require Korean evidence-bounded JSON output", () => {
  const messages = buildTaskMessages("next_action", "고객이 견적을 검토 중", { customerType: "건물주" });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /한국어/);
  assert.match(messages[0].content, /추측/);
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[1].content, /고객이 견적을 검토 중/);
  assert.match(messages[1].content, /건물주/);
});

test("task result normalizes general text output", () => {
  assert.deepEqual(normalizeTaskResult("assistant_summary", { text: "  핵심 상담 내용  ", ignored: "제거" }), { text: "핵심 상담 내용" });
  assert.throws(() => normalizeTaskResult("assistant_summary", { text: "" }), error => error?.code === "AI_INVALID_RESPONSE");
});

test("task result requires every consultation draft field", () => {
  assert.deepEqual(normalizeTaskResult("consultation_structure", {
    summary: "누수 상담",
    currentRequest: "현장 확인",
    outcome: "견적 검토",
    nextAction: "방문 일정 확정",
    extra: "제거"
  }), {
    summary: "누수 상담",
    currentRequest: "현장 확인",
    outcome: "견적 검토",
    nextAction: "방문 일정 확정"
  });
  assert.throws(
    () => normalizeTaskResult("consultation_structure", { summary: "누수 상담", currentRequest: "현장 확인", outcome: "견적 검토" }),
    error => error?.code === "AI_INVALID_RESPONSE"
  );
});

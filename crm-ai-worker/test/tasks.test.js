import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskMessages, normalizeTaskResult, supportedTaskIds } from "../src/tasks.js";

test("task contract exposes exactly the five approved CRM tasks", () => {
  assert.deepEqual(supportedTaskIds(), [
    "assistant_summary",
    "next_action",
    "sales_message",
    "work_report",
    "consultation_structure"
  ]);
  assert.throws(() => buildTaskMessages("unknown", "내용", {}), error => error?.code === "UNSUPPORTED_TASK");
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

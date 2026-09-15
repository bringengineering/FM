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
    "directive_split",
    "directive_draft",
    "daily_report",
    "monthly_management_report",
    "quote_draft",
    "consultation_intake"
  ]);
  assert.throws(() => buildTaskMessages("unknown", "내용", {}), error => error?.code === "UNSUPPORTED_TASK");
});

test("consultation intake uses the closed CRM draft shape", () => {
  const messages = buildTaskMessages("consultation_intake", "다음 주 청소 상담", {});
  assert.match(messages[0].content, /customer/);
  assert.match(messages[0].content, /needsReview/);
  const result = normalizeTaskResult("consultation_intake", {
    customer: { name: "김고객", phone: "", type: "상가", request: "청소", privateMemo: "", needsReview: false },
    building: { name: "", address: "", needsReview: true },
    consultation: { type: "전화", summary: "청소 상담", result: "견적 요청", occurredAt: "", needsReview: false },
    followUp: { nextAction: "견적 전달", nextContactAt: "", priority: "normal", needsReview: false },
    contractSuggestion: { type: "공용부 청소 위탁", expectedAmount: 60000, reason: "정기 청소", needsReview: true },
    confidence: { customer: 0.9 }
  });
  assert.equal(result.customer.type, "상가");
  assert.equal(result.contractSuggestion.expectedAmount, 60000);
  assert.equal(result.building.needsReview, true);
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

test("daily report never invents a number and never grades the person", () => {
  // 여기 오는 숫자는 CRM 이 이미 세서 화면에 띄운 것뿐이다. AI 가 다시
  // 계산하기 시작하면 보고서와 화면이 다른 말을 하고, 그러면 둘 다 못 믿는다.
  const messages = buildTaskMessages("daily_report", "09:00~11:00 누수 확인 2시간", {});
  assert.match(messages[0].content, /다시 계산하거나 고치지 마세요/u);
  // 평가는 사람이 한다. AI 가 "수고했다" 를 쓰면 그게 평가처럼 읽힌다.
  assert.match(messages[0].content, /평가는 쓰지 말고/u);
  // 막힌 것과 건의는 줄이면 안 된다. 대개 그게 제일 중요하다.
  assert.match(messages[0].content, /그대로 옮기세요/u);

  const result = normalizeTaskResult("daily_report", { text: "오늘 누수 확인에 2시간을 썼습니다." });
  assert.equal(result.text, "오늘 누수 확인에 2시간을 썼습니다.");
  assert.throws(() => normalizeTaskResult("daily_report", { text: "" }), error => error?.code === "AI_INVALID_RESPONSE");
});

test("directive draft writes a pasteable sheet and never invents facts", () => {
  // 이 갈래가 내놓는 글은 그대로 붙여넣기 칸에 들어가 파서를 지난다. 그래서
  // 모양이 어긋나면 화면이 "못 읽은 줄" 로 다 뱉는다.
  const messages = buildTaskMessages("directive_draft", "당근이랑 숨고 좀 살려야 함", {});
  assert.match(messages[0].content, /업무명\\t목적\\t완료기준\\t산출물\\t예상시간\\t가중치\\t마감/u);
  // 없는 마감일과 건물명을 지어내면 그게 지시가 되어 애들에게 나간다.
  assert.match(messages[0].content, /적히지 않은 사실을 만들지 마세요/u);
  // 가중치 합이 100이 아니면 내보내기에서 막힌다. 애초에 맞춰서 내놓게 한다.
  assert.match(messages[0].content, /합이 정확히 100/u);
  // "열심히 한다" 는 완료 기준이 아니다.
  assert.match(messages[0].content, /눈에 보이는 것으로/u);

  const result = normalizeTaskResult("directive_draft", { text: "배경\t당근 문의가 줄었습니다" });
  assert.equal(result.text, "배경\t당근 문의가 줄었습니다");
  assert.throws(() => normalizeTaskResult("directive_draft", { text: "" }), error => error?.code === "AI_INVALID_RESPONSE");
});

test("directive split never guesses whose work an unclear line is", () => {
  // 짐작해서 아무에게나 붙이면 시킨 적 없는 일이 지시가 되어 나간다.
  const messages = buildTaskMessages("directive_split", "현진 CRM 마무리, 우중 카페 구축", {});
  assert.match(messages[0].content, /== 사람이름 ==/u);
  assert.match(messages[0].content, /누구인지 모름/u);
  assert.match(messages[0].content, /짐작해서 아무에게나 붙이면/u);
  // 목록에 없는 사람을 만들어 내면 그 지시는 갈 곳이 없다.
  assert.match(messages[0].content, /주어진 사람 목록에 있는 이름만/u);
  // 사람마다 가용시간이 다르다. 한 사람 기준으로 다 짜면 누군가는 넘친다.
  assert.match(messages[0].content, /사람마다 주어진 가용시간/u);
  assert.match(messages[0].content, /사람마다 합이 정확히 100/u);

  const result = normalizeTaskResult("directive_split", { text: "== 김현진 ==\n배경\t가" });
  assert.match(result.text, /== 김현진 ==/u);
});

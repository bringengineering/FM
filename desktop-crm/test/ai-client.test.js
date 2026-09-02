const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { assistWithGateway, validateAssistInput } = require("../src/ai-client");

test("AI client accepts only the closed CRM automation tasks and allow-listed context", () => {
  assert.deepEqual(validateAssistInput({
    task: "next_action",
    content: " 고객이 견적을 검토 중 ",
    context: { customerType: "건물주", workType: "누수", owner: "서창환", privateMemo: "제외" }
  }), {
    task: "next_action",
    content: "고객이 견적을 검토 중",
    context: { customerType: "건물주", workType: "누수", owner: "서창환" }
  });
  for (const task of [
    "assistant_summary", "next_action", "sales_message", "work_report", "consultation_structure",
    "sales_focus_explanation", "sales_followup_message", "complaint_triage", "vendor_request",
    "work_order", "completion_report", "monthly_management_report", "quote_draft", "consultation_intake"
  ]) {
    assert.equal(validateAssistInput({ task, content: "내용" }).task, task);
  }
  assert.throws(() => validateAssistInput({ task: "unknown", content: "내용" }), error => error?.code === "UNSUPPORTED_TASK");
  assert.throws(() => validateAssistInput({ task: "next_action", content: "" }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => validateAssistInput({ task: "next_action", content: "가".repeat(12001) }), error => error?.code === "INPUT_TOO_LARGE");
  assert.throws(() => validateAssistInput({ task: "next_action", content: "내용", groqKey: "gsk_forbidden" }), error => error?.code === "INVALID_INPUT");
});

test("AI client preserves the bounded consultation intake structure", async () => {
  const result = await assistWithGateway({
    endpoint: "https://gateway.example/v1/assist",
    idToken: "firebase-token",
    input: { task: "consultation_intake", content: "다음 주 청소 상담" },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, requestId: "intake-1", result: {
      customer: { name: "김고객", phone: "", type: "상가", request: "공용부 청소", privateMemo: "오후 통화", needsReview: false, ignored: "drop" },
      building: { name: "중앙상가", address: "", needsReview: true },
      consultation: { type: "전화", summary: "청소 상담", result: "견적 요청", occurredAt: "", needsReview: false },
      followUp: { nextAction: "견적 전달", nextContactAt: "", priority: "normal", needsReview: true },
      contractSuggestion: { type: "공용부 청소 위탁", expectedAmount: 60000, reason: "정기 청소", needsReview: true },
      confidence: { customer: 0.9, building: 0.4, consultation: 0.9, followUp: 0.7, contractSuggestion: 0.6 }
    } }), { status: 200 })
  });
  assert.equal(result.result.customer.type, "상가");
  assert.equal(result.result.customer.ignored, undefined);
  assert.equal(result.result.contractSuggestion.expectedAmount, 60000);
  assert.equal(result.result.building.needsReview, true);
});

test("AI client preserves only bounded structured quote fields", async () => {
  const result = await assistWithGateway({
    endpoint: "https://gateway.example/v1/assist",
    idToken: "firebase-token",
    input: { task: "quote_draft", content: "햇빛빌라 입주청소 12만원", context: { workType: "견적서", privateMemo: "제외" } },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, requestId: "quote-1", result: {
      recipient: "햇빛빌라", projectName: "햇빛빌라 입주청소", service: "입주청소", summary: "입주 전 청소",
      totalAmount: 120000, items: [{ name: "입주청소", detail: "실내 전체", quantity: 1, unit: "식", unitPrice: 120000, note: "" }],
      notes: ["현장 확인 후 범위 확정"], ignored: "제거"
    }, warnings: [] }), { status: 200 })
  });
  assert.equal(result.result.totalAmount, 120000);
  assert.deepEqual(result.result.items, [{ name: "입주청소", detail: "실내 전체", quantity: 1, unit: "식", unitPrice: 120000 }]);
  assert.equal(result.result.ignored, undefined);
});

test("AI client sends only a Firebase bearer token and normalizes success", async () => {
  let captured;
  const result = await assistWithGateway({
    endpoint: "https://gateway.example/v1/assist",
    idToken: "firebase-token",
    input: { task: "next_action", content: "고객이 견적을 검토 중" },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true, requestId: "req-1", result: { text: "3일 뒤 확인 전화" }, warnings: [] }), { status: 200 });
    }
  });
  assert.deepEqual(result, { ok: true, requestId: "req-1", result: { text: "3일 뒤 확인 전화" }, warnings: [], usage: { inputTokens: 0, outputTokens: 0 } });
  assert.equal(captured.options.headers.authorization, "Bearer firebase-token");
  assert.deepEqual(JSON.parse(captured.options.body), { task: "next_action", content: "고객이 견적을 검토 중", context: {} });
});

test("AI client maps gateway failures to bounded Korean messages", async () => {
  const cases = [
    [401, "AUTH_REQUIRED", "다시 로그인"],
    [403, "FORBIDDEN", "권한"],
    [413, "INPUT_TOO_LARGE", "줄여"],
    [429, "RATE_LIMITED", "무료 사용 한도"],
    [503, "AI_DISABLED", "꺼져"],
    [503, "AI_TEMPORARY_FAILURE", "일시적으로"]
  ];
  for (const [status, code, message] of cases) {
    await assert.rejects(() => assistWithGateway({
      endpoint: "https://gateway.example/v1/assist",
      idToken: "firebase-token",
      input: { task: "assistant_summary", content: "내용" },
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, code, secret: "must-not-leak" }), { status })
    }), error => error?.code === code && error.message.includes(message) && !error.message.includes("must-not-leak"));
  }
});

test("AI client fails safely on missing session, invalid endpoint, malformed output, and timeout", async () => {
  await assert.rejects(() => assistWithGateway({ endpoint: "https://gateway.example/v1/assist", idToken: "", input: { task: "assistant_summary", content: "내용" } }), error => error?.code === "AUTH_REQUIRED");
  await assert.rejects(() => assistWithGateway({ endpoint: "http://gateway.example/v1/assist", idToken: "token", input: { task: "assistant_summary", content: "내용" } }), error => error?.code === "AI_CONFIGURATION_ERROR");
  await assert.rejects(() => assistWithGateway({ endpoint: "https://gateway.example/v1/assist", idToken: "token", input: { task: "assistant_summary", content: "내용" }, fetchImpl: async () => new Response("not-json", { status: 200 }) }), error => error?.code === "AI_INVALID_RESPONSE");
  await assert.rejects(() => assistWithGateway({ endpoint: "https://gateway.example/v1/assist", idToken: "token", input: { task: "assistant_summary", content: "내용" }, timeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))) }), error => error?.code === "AI_TEMPORARY_FAILURE");
});

test("Electron keeps the Firebase token in main and exposes only a narrow assist IPC", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
  assert.match(source, /secureCanonicalHandle\("crm:ai-assist"/);
  assert.match(source, /remoteClient\.ensureIdToken\(false\)/);
  assert.match(source, /fetchImpl: \(url, options\) => net\.fetch\(url, options\)/);
  assert.match(preload, /assist: input => ipcRenderer\.invoke\("crm:ai-assist", input\)/);
  assert.match(preload, /exportQuote: input => ipcRenderer\.invoke\("crm:quote-export", input\)/);
  assert.doesNotMatch(preload, /idToken|GROQ_API_KEY|gsk_/);
});

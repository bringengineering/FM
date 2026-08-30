const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { assistWithGateway, validateAssistInput } = require("../src/ai-client");

test("AI client accepts only the five closed tasks and allow-listed context", () => {
  assert.deepEqual(validateAssistInput({
    task: "next_action",
    content: " 고객이 견적을 검토 중 ",
    context: { customerType: "건물주", workType: "누수", owner: "서창환", privateMemo: "제외" }
  }), {
    task: "next_action",
    content: "고객이 견적을 검토 중",
    context: { customerType: "건물주", workType: "누수", owner: "서창환" }
  });
  for (const task of ["assistant_summary", "next_action", "sales_message", "work_report", "consultation_structure"]) {
    assert.equal(validateAssistInput({ task, content: "내용" }).task, task);
  }
  assert.throws(() => validateAssistInput({ task: "unknown", content: "내용" }), error => error?.code === "UNSUPPORTED_TASK");
  assert.throws(() => validateAssistInput({ task: "next_action", content: "" }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => validateAssistInput({ task: "next_action", content: "가".repeat(12001) }), error => error?.code === "INPUT_TOO_LARGE");
  assert.throws(() => validateAssistInput({ task: "next_action", content: "내용", groqKey: "gsk_forbidden" }), error => error?.code === "INVALID_INPUT");
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
  assert.doesNotMatch(preload, /idToken|GROQ_API_KEY|gsk_/);
});

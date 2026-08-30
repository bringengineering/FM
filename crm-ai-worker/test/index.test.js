import assert from "node:assert/strict";
import test from "node:test";

import { createWorker } from "../src/index.js";

const endpoint = "https://ai.example/v1/assist";

function request(body = { task: "assistant_summary", content: "누수 상담" }, token = "firebase-token") {
  return new Request(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "app://bring-crm" },
    body: JSON.stringify(body)
  });
}

function environment(overrides = {}) {
  return {
    AI_ENABLED: "true",
    FIREBASE_WEB_API_KEY: "public-firebase-key",
    CRM_ALLOWED_EMAILS: "dpvld858@gmail.com,ameejin92@gmail.com",
    GROQ_API_KEY: "test-secret",
    GROQ_MODEL: "qwen/qwen3.8-27b",
    ALLOWED_ORIGINS: "app://bring-crm",
    AI_COMPANY_DAILY_LIMIT: "1000",
    AI_USAGE: {
      async get() { return "0"; },
      async put() {}
    },
    AI_RATE_LIMITER: { async limit() { return { success: true }; } },
    ...overrides
  };
}

function successfulFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "uid-1", email: "ameejin92@gmail.com", emailVerified: true }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ text: "누수 상담 요약" }) } }],
      usage: { prompt_tokens: 21, completion_tokens: 7 }
    }), { status: 200 });
  };
}

test("gateway health, preflight, route, and method boundaries are closed", async () => {
  const worker = createWorker({ fetchImpl: async () => { throw new Error("network not expected"); } });
  assert.equal((await worker.fetch(new Request("https://ai.example/health"), environment())).status, 200);
  assert.equal((await worker.fetch(new Request(endpoint, { method: "OPTIONS", headers: { origin: "app://bring-crm" } }), environment())).status, 204);
  assert.equal((await worker.fetch(new Request("https://ai.example/nope"), environment())).status, 404);
  assert.equal((await worker.fetch(new Request(endpoint, { method: "GET" }), environment())).status, 405);
});

test("gateway rejects missing auth, malformed input, and unsupported tasks before upstream calls", async () => {
  let calls = 0;
  const worker = createWorker({ fetchImpl: async () => { calls += 1; throw new Error("network not expected"); } });
  assert.equal((await worker.fetch(request(undefined, ""), environment())).status, 401);
  assert.equal((await worker.fetch(new Request(endpoint, { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: "{" }), environment())).status, 400);
  assert.equal((await worker.fetch(request({ task: "unknown", content: "내용" }), environment())).status, 400);
  assert.equal((await worker.fetch(request({ task: "assistant_summary", content: "가".repeat(12001) }), environment())).status, 413);
  assert.equal(calls, 0);
});

test("gateway verifies the Firebase identity and rejects an unlisted employee", async () => {
  const worker = createWorker({ fetchImpl: async url => {
    assert.match(String(url), /accounts:lookup/);
    return new Response(JSON.stringify({ users: [{ localId: "uid-x", email: "outsider@example.com", emailVerified: true }] }), { status: 200 });
  } });
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FORBIDDEN");
});

test("gateway masks sensitive content before Groq and returns a normalized result", async () => {
  const calls = [];
  const worker = createWorker({ fetchImpl: successfulFetch(calls), requestId: () => "req-1" });
  const response = await worker.fetch(request({
    task: "assistant_summary",
    content: "010-9654-1232 test@example.com 123-456-789012 북원로2475번길 93 누수 상담",
    context: { customerType: "건물주", privateMemo: "전송 금지" }
  }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    requestId: "req-1",
    result: { text: "누수 상담 요약" },
    warnings: ["개인정보 형태를 마스킹한 뒤 AI에 전달했습니다."],
    usage: { inputTokens: 21, outputTokens: 7 }
  });
  const groqBody = JSON.parse(calls[1].options.body);
  const sent = JSON.stringify(groqBody);
  assert.doesNotMatch(sent, /010-9654-1232|test@example\.com|123-456-789012|북원로2475번길 93|전송 금지/);
  assert.match(sent, /\[전화번호\]|\[이메일\]|\[계좌번호\]|\[상세주소\]/);
  assert.equal(calls[1].options.headers.authorization, "Bearer test-secret");
});

test("gateway fails closed for disabled, limited, missing-secret, and broken-provider states", async () => {
  const worker = createWorker({ fetchImpl: successfulFetch([]), timeoutMs: 10 });
  assert.equal((await worker.fetch(request(), environment({ AI_ENABLED: "false" }))).status, 503);
  assert.equal((await worker.fetch(request(), environment({ GROQ_API_KEY: "" }))).status, 503);
  assert.equal((await worker.fetch(request(), environment({ AI_RATE_LIMITER: { async limit() { return { success: false }; } } }))).status, 429);

  const broken = createWorker({ fetchImpl: async url => String(url).includes("accounts:lookup")
    ? new Response(JSON.stringify({ users: [{ localId: "uid-1", email: "ameejin92@gmail.com", emailVerified: true }] }), { status: 200 })
    : new Response("busy", { status: 429 }) });
  const response = await broken.fetch(request(), environment());
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, "RATE_LIMITED");
});

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

test("gateway transcribes one bounded Korean audio file without exposing the provider key", async () => {
  const calls = [];
  const worker = createWorker({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "uid-1", email: "ameejin92@gmail.com" }] }), { status: 200 });
    return new Response(JSON.stringify({ text: "내일 공용부 청소 견적을 보내 주세요." }), { status: 200 });
  }, requestId: () => "tr-1" });
  const body = new FormData();
  body.append("file", new Blob(["audio"], { type: "audio/mpeg" }), "call.mp3");
  body.append("language", "ko");
  const response = await worker.fetch(new Request("https://ai.example/v1/transcribe", {
    method: "POST", headers: { authorization: "Bearer firebase-token", origin: "app://bring-crm" }, body
  }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requestId: "tr-1", transcript: "내일 공용부 청소 견적을 보내 주세요." });
  assert.match(calls[1].url, /\/openai\/v1\/audio\/transcriptions$/);
  assert.equal(calls[1].options.headers.authorization, "Bearer test-secret");
  assert.equal(calls[1].options.body instanceof FormData, true);
});

test("contract source route is admin-only and reads one approved Drive file ID", async () => {
  const calls = [];
  const worker = createWorker({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "uid-admin", email: "dpvld858@gmail.com" }] }), { status: 200 });
    if (String(url).includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "drive-token", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ id: "1K_a-safe_ID", name: "관리 위탁계약서.docx", headRevisionId: "rev-7", modifiedTime: "2026-09-02T01:02:03Z", webViewLink: "https://drive.google.com/file/d/1K_a-safe_ID/view" }), { status: 200 });
  }, requestId: () => "contract-1", signGoogleJwt: async () => "signed-jwt" });
  const response = await worker.fetch(new Request("https://ai.example/v1/contracts", { method: "POST", headers: { authorization: "Bearer firebase-token", "content-type": "application/json", origin: "app://bring-crm" }, body: JSON.stringify({ action: "check", driveFileId: "1K_a-safe_ID" }) }), environment({ CRM_ADMIN_EMAILS: "dpvld858@gmail.com", GOOGLE_SERVICE_ACCOUNT_EMAIL: "drive-reader@example.iam.gserviceaccount.com", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "secret-key" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requestId: "contract-1", source: { driveFileId: "1K_a-safe_ID", title: "관리 위탁계약서.docx", revisionId: "rev-7", modifiedAt: "2026-09-02T01:02:03Z", webViewLink: "https://drive.google.com/file/d/1K_a-safe_ID/view" } });
  assert.match(calls[2].url, /drive\/v3\/files\/1K_a-safe_ID/);
  assert.equal(calls[2].options.headers.authorization, "Bearer drive-token");
});

test("contract source route rejects a non-admin before contacting Drive", async () => {
  let calls = 0;
  const worker = createWorker({ fetchImpl: async url => {
    calls += 1;
    assert.match(String(url), /accounts:lookup/);
    return new Response(JSON.stringify({ users: [{ localId: "uid-member", email: "ameejin92@gmail.com" }] }), { status: 200 });
  } });
  const response = await worker.fetch(new Request("https://ai.example/v1/contracts", { method: "POST", headers: { authorization: "Bearer firebase-token", "content-type": "application/json" }, body: JSON.stringify({ action: "check", driveFileId: "1K_a-safe_ID" }) }), environment({ CRM_ADMIN_EMAILS: "dpvld858@gmail.com" }));
  assert.equal(response.status, 403);
  assert.equal(calls, 1);
});

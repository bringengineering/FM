"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createTelegramServerStatusClient } = require("../src/telegram-server-status-client");
const { render } = require("../src/telegram-server-status-view");

const healthy = () => Response.json({ ok: true, service: "bring-crm-ai-gateway", morningTelegram: true });

test("status checks use only the fixed HTTPS health GET, without keys, auth headers or message bodies", async () => {
  const calls = [];
  const load = createTelegramServerStatusClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return healthy(); } });
  assert.deepEqual(await load(), { connected: true, status: "connected" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/health");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(calls[0].options.headers, { accept: "application/json" });
  assert.equal(calls[0].options.body, undefined);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("missing, disabled or malformed server readiness never appears connected", async () => {
  for (const body of [null, {}, { ok: true },
    { ok: true, service: "other", morningTelegram: true },
    { ok: true, service: "bring-crm-ai-gateway", morningTelegram: false },
    { ok: true, service: "bring-crm-ai-gateway", morningTelegram: "true" },
    { ok: false, service: "bring-crm-ai-gateway", morningTelegram: true }]) {
    const load = createTelegramServerStatusClient({ fetchImpl: async () => Response.json(body) });
    assert.deepEqual(await load(), { connected: false, status: "unavailable" });
  }
});

test("HTTP errors, redirects, invalid content and private transport errors are reduced to a safe state", async () => {
  for (const fetchImpl of [
    async () => new Response("private provider error", { status: 503 }),
    async () => new Response(null, { status: 302, headers: { location: "https://private.example/secret" } }),
    async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    async () => new Response("not json", { headers: { "content-type": "application/json" } }),
    async () => { throw new Error("private-token-and-url"); },
  ]) {
    const load = createTelegramServerStatusClient({ fetchImpl });
    const status = await load();
    assert.deepEqual(status, { connected: false, status: "unavailable" });
    assert.doesNotMatch(JSON.stringify(status), /private|token|url|provider/);
  }
});

test("bounded responses reject both declared and streamed oversize bodies", async () => {
  for (const headers of [
    { "content-type": "application/json", "content-length": "100000" },
    { "content-type": "application/json" },
  ]) {
    const load = createTelegramServerStatusClient({ fetchImpl: async () => new Response(" ".repeat(4097), { headers }) });
    assert.deepEqual(await load(), { connected: false, status: "unavailable" });
  }
});

test("concurrent views coalesce checks and cached success expires before rechecking failures", async () => {
  let calls = 0, timestamp = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const load = createTelegramServerStatusClient({ now: () => timestamp, fetchImpl: async () => { calls++; await gate; return calls === 1 ? healthy() : Response.json({ ok: false }); } });
  const first = load(), second = load();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(a.connected, true); assert.equal(b.connected, true);
  a.status = "tampered";
  assert.equal((await load()).status, "connected");
  timestamp = 30001;
  assert.deepEqual(await load(), { connected: false, status: "unavailable" });
  assert.equal(calls, 2);
});

test("the approved card contains only server state and delivery information, without PC configuration controls", () => {
  const html = render({ loaded: true, status: "connected" });
  for (const label of ["서버 자동발송", "서버 연결 정상", "매일 오전 6시", "브링엔지니어링 업무방", "오늘 업무일정", "오늘 계약 입금일", "등록된 항목이 있는 날만 발송", "컴퓨터와 CRM을 꺼도", "PC에서 입력하거나 저장하지 않습니다"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /<(input|form|button|textarea|select)\b|data-telegram-form|data-telegram-send|지금 보내기|방 찾기|연결 끊기|수동 연락 알림/);
});

test("the status pill distinguishes checking, connected and unavailable without trusting arbitrary text", () => {
  assert.match(render(), /is-checking[\s\S]*서버 연결 확인 중/);
  assert.match(render({ loaded: true, loading: true, status: "connected" }), /서버 연결 확인 중/);
  assert.match(render({ loaded: true, status: "unavailable" }), /is-unavailable[\s\S]*서버 연결 확인 필요/);
  const html = render({ loaded: true, status: '<img src=x onerror="alert(1)">', botToken: "secret-value", chatId: "private-room" });
  assert.match(html, /서버 연결 확인 필요/);
  assert.doesNotMatch(html, /<img|onerror|secret-value|private-room/);
  assert.match(html, /role="status" aria-live="polite"/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import { createWorker } from "../src/index.js";
import { composeDailyReportCaption, normalizeDailyReportPayload } from "../src/daily-report-telegram.js";

const require = createRequire(import.meta.url);
const { createDailyLogWorkbook } = require("../../desktop-crm/src/daily-log-xlsx.js");

const endpoint = "https://gateway.example/v1/telegram/daily-report";
const identity = { uid: "uid-member", email: "member@example.com", emailVerified: true };

function report(overrides = {}) {
  return {
    uid: identity.uid,
    name: "김현진",
    date: "2026-09-07",
    entries: [{ start: "09:00", end: "10:00", title: "햇빛빌라 점검", progress: 80 }],
    plans: [{ title: "견적 전달", hours: 1, dueDate: "2026-09-08" }],
    blockers: "건물주 회신 대기",
    ideas: "",
    feedback: "",
    requests: "오후 일정 조정 요청",
    aiSummary: "오늘 현장을 점검했고 회신을 기다리고 있습니다.",
    submittedAt: "2026-09-07T09:01:02.000Z",
    updatedAt: "2026-09-07T09:01:02.000Z",
    ...overrides,
  };
}

function request(body = report(), token = "firebase-token") {
  const form = new FormData();
  form.append("report", JSON.stringify(body));
  const workbook = createDailyLogWorkbook({
    ...body,
    entries: body.entries.map((item, index) => ({ ...item, id: `e${index + 1}`, nature: "routine" })),
    plans: body.plans.map((item, index) => ({ ...item, id: `p${index + 1}`, nature: "routine" })),
  });
  form.append("document", new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "employee-report.xlsx");
  return new Request(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, origin: "app://bring-crm" },
    body: form,
  });
}

function environment(overrides = {}) {
  const values = new Map();
  return {
    AI_ENABLED: "true",
    FIREBASE_WEB_API_KEY: "public-firebase-key",
    CRM_ALLOWED_EMAILS: "member@example.com",
    ALLOWED_ORIGINS: "app://bring-crm",
    AI_RATE_LIMITER: { async limit() { return { success: true }; } },
    AI_USAGE: {
      async get(key) { return values.get(key) || null; },
      async put(key, value) { values.set(key, value); },
    },
    TELEGRAM_DAILY_REPORT_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyzABCDE_12345",
    TELEGRAM_WORK_CHAT_ID: "-1001234567890",
    ...overrides,
  };
}

test("daily report caption is brief, bounded, and does not expose the CRM email", () => {
  const normalized = normalizeDailyReportPayload(report(), identity);
  const message = composeDailyReportCaption(normalized);
  assert.match(message, /BRING ENGINEERING 일일 업무보고/u);
  assert.match(message, /작성자: 김현진/u);
  assert.doesNotMatch(message, /member@example\.com/u);
  assert.match(message, /오늘 업무 1건 · 1시간 · 내일 계획 1건/u);
  assert.doesNotMatch(message, /오후 일정 조정 요청/u, "상세 공유사항은 Excel 파일 안에만 둔다");
  assert.ok(message.length <= 900);
});

test("authenticated employee sends one saved report through the fixed company bot destination", async () => {
  const calls = [];
  const env = environment();
  const worker = createWorker({
    requestId: () => "tg-req-1",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("accounts:lookup")) {
        return new Response(JSON.stringify({ users: [{ localId: identity.uid, email: identity.email, emailVerified: true }] }), { status: 200 });
      }
      assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendDocument$/u);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    },
  });

  const first = await worker.fetch(request(), env);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, requestId: "tg-req-1", sent: true, duplicate: false });
  const telegram = calls.find(call => call.url.includes("api.telegram.org"));
  const sent = telegram.options.body;
  assert.equal(sent.get("chat_id"), "-1001234567890");
  assert.match(sent.get("caption"), /김현진/u);
  const document = sent.get("document");
  assert.equal(document.name, "20260907_김현진_일일업무일지.xlsx");
  assert.equal(document.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(Buffer.from(await document.arrayBuffer()).readUInt32LE(0), 0x04034b50);

  const second = await worker.fetch(request(), env);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, requestId: "tg-req-1", sent: false, duplicate: true });
  assert.equal(calls.filter(call => call.url.includes("api.telegram.org")).length, 1);
});

test("daily report route rejects a non-Excel attachment", async () => {
  const form = new FormData();
  form.append("report", JSON.stringify(report()));
  form.append("document", new Blob(["not a workbook"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "report.xlsx");
  const unsafe = new Request(endpoint, {
    method: "POST",
    headers: { authorization: "Bearer firebase-token", origin: "app://bring-crm" },
    body: form,
  });
  const worker = createWorker({
    fetchImpl: async url => {
      assert.match(String(url), /accounts:lookup/u);
      return new Response(JSON.stringify({ users: [{ localId: identity.uid, email: identity.email, emailVerified: true }] }), { status: 200 });
    },
  });
  const response = await worker.fetch(unsafe, environment());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_INPUT");
});

test("daily report Telegram route fails closed for wrong user, unverified email, and missing secrets", async () => {
  const accountFetch = user => async url => {
    assert.match(String(url), /accounts:lookup/u);
    return new Response(JSON.stringify({ users: [user] }), { status: 200 });
  };

  const wrongUser = createWorker({ fetchImpl: accountFetch({ localId: "uid-other", email: identity.email, emailVerified: true }) });
  assert.equal((await wrongUser.fetch(request(), environment())).status, 403);

  const unverified = createWorker({ fetchImpl: accountFetch({ localId: identity.uid, email: identity.email, emailVerified: false }) });
  assert.equal((await unverified.fetch(request(), environment())).status, 403);

  const notApproved = createWorker({ fetchImpl: accountFetch({ localId: identity.uid, email: identity.email, emailVerified: true }) });
  assert.equal((await notApproved.fetch(request(), environment({ CRM_DAILY_REPORT_EMAILS: "other@example.com" }))).status, 403);

  const missingSecret = createWorker({ fetchImpl: accountFetch({ localId: identity.uid, email: identity.email, emailVerified: true }) });
  const response = await missingSecret.fetch(request(), environment({ TELEGRAM_BOT_TOKEN: "" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "TELEGRAM_NOT_CONFIGURED");
});

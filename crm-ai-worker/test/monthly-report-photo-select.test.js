import assert from "node:assert/strict";
import test from "node:test";

import { readMonthlyReportPhotoSelectionPayload, selectMonthlyReportPhotos } from "../src/monthly-report-photo-select.js";
import { createWorker } from "../src/index.js";

const jpeg = () => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]).toString("base64")}`;
const basePayload = () => ({
  month: "2026-08",
  activities: [{ id: "a1", date: "2026-08-21", kind: "냉난방·필터 점검" }],
  images: [{ id: "photo_1", date: "2026-08-21", dataUrl: jpeg() }],
});

function request(payload, token = "firebase-token") {
  return new Request("https://ai.example/v1/monthly-report-photo-select", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("월간 사진 payload는 허용 필드·날짜·JPEG 형식만 받는다", async () => {
  const parsed = await readMonthlyReportPhotoSelectionPayload(request(basePayload()));
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0].date, "2026-08-21");
  await assert.rejects(() => readMonthlyReportPhotoSelectionPayload(request({ ...basePayload(), driveUrl: "https://drive.google.com/private" })), error => error?.code === "INVALID_INPUT");
  await assert.rejects(() => readMonthlyReportPhotoSelectionPayload(request({ ...basePayload(), images: [{ id: "x", date: "2026-08-21", dataUrl: "data:image/jpeg;base64,AAAA" }] })), error => error?.code === "INVALID_INPUT");
});

test("Gemini 응답은 요청된 ID만 최대 12장 선택하고 키는 헤더에만 둔다", async () => {
  const payload = await readMonthlyReportPhotoSelectionPayload(request(basePayload()));
  let captured;
  const result = await selectMonthlyReportPhotos(payload, { GEMINI_API_KEY: "test-secret", GEMINI_VISION_MODEL: "gemini-3.8-flash" }, async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ selected: [{ id: "photo_1", caption: "에어컨 필터 상태", reason: "업무 내용과 일치" }, { id: "unknown", caption: "임의 사진", reason: "" }] }) }] } }] });
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].id, "photo_1");
  assert.equal(captured.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(captured.options.headers["x-goog-api-key"], "test-secret");
  assert.ok(!captured.url.includes("test-secret"));
  assert.equal(captured.body.contents[0].parts.filter(part => part.inline_data).length, 1);
  assert.doesNotMatch(JSON.stringify(captured.body), /drive\.google\.com|@gmail\.com|010-\d/u);
});

test("월간 사진 선택 route는 인증 후 Gemini를 부르고 API 키가 없으면 fail closed", async () => {
  const calls = [];
  const worker = createWorker({
    requestId: () => "monthly-photo-test",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "u1", email: "worker@example.com", emailVerified: true }] });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ selected: [{ id: "photo_1", caption: "후드 필터 청소", reason: "정기 점검 업무와 일치" }] }) }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 } });
    },
  });
  const env = {
    AI_ENABLED: "true", FIREBASE_WEB_API_KEY: "public-key", CRM_ALLOWED_EMAILS: "worker@example.com",
    GEMINI_API_KEY: "test-secret", AI_COMPANY_DAILY_LIMIT: "1000",
    AI_USAGE: { async get() { return "0"; }, async put() {} },
    AI_RATE_LIMITER: { async limit() { return { success: true }; } },
  };
  const response = await worker.fetch(request(basePayload()), env);
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.selected[0].caption, "후드 필터 청소");
  assert.ok(calls.some(call => call.url.startsWith("https://generativelanguage.googleapis.com/")));

  let providerCalls = 0;
  const unconfigured = createWorker({ fetchImpl: async url => {
    if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "u1", email: "worker@example.com", emailVerified: true }] });
    providerCalls += 1;
    throw new Error("must not call provider");
  } });
  const missingKey = await unconfigured.fetch(request(basePayload()), { ...env, GEMINI_API_KEY: "" });
  assert.equal(missingKey.status, 503);
  assert.equal((await missingKey.json()).code, "GEMINI_NOT_CONFIGURED");
  assert.equal(providerCalls, 0);
});

test("비인증 요청은 사진 내용을 Gemini에 보내지 않는다", async () => {
  let calls = 0;
  const worker = createWorker({ fetchImpl: async () => { calls += 1; throw new Error("not expected"); } });
  const response = await worker.fetch(request(basePayload(), ""), {
    AI_ENABLED: "true", FIREBASE_WEB_API_KEY: "public-key", CRM_ALLOWED_EMAILS: "worker@example.com",
    GEMINI_API_KEY: "test-secret", AI_RATE_LIMITER: { async limit() { return { success: true }; } },
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

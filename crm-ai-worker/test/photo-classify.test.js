import assert from "node:assert/strict";
import test from "node:test";

import { createWorker } from "../src/index.js";
import { classifyPhotos, readPhotoClassificationPayload } from "../src/photo-classify.js";

const jpeg = () => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]).toString("base64")}`;
const env = overrides => ({
  AI_ENABLED: "true",
  FIREBASE_WEB_API_KEY: "public-key",
  CRM_ALLOWED_EMAILS: "worker@example.com",
  GEMINI_API_KEY: "test-only-provider-key",
  AI_COMPANY_DAILY_LIMIT: "1000",
  AI_USAGE: { async get() { return "0"; }, async put() {} },
  AI_RATE_LIMITER: { async limit() { return { success: true }; } },
  ...(overrides || {}),
});

function request(images, token = "firebase-token") {
  return new Request("https://ai.example/v1/photo-classify", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "moveIn", images }),
  });
}

test("사진 분류 payload는 JPEG 시그니처와 허용 필드까지 검사한다", async () => {
  assert.equal((await readPhotoClassificationPayload(request([{ id: "a", dataUrl: jpeg() }]))).images.length, 1);
  await assert.rejects(() => readPhotoClassificationPayload(request([{ id: "a", dataUrl: "data:image/jpeg;base64,AAAA" }])), error => error?.code === "INVALID_INPUT");
  await assert.rejects(() => readPhotoClassificationPayload(request([{ id: "a", dataUrl: jpeg(), driveUrl: "https://drive.google.com/x" }])), error => error?.code === "INVALID_INPUT");
});

test("사진 분류 route는 인증 뒤 Gemini에 6장씩 요청하고 낮은 확신은 확인으로 남긴다", async () => {
  const calls = [];
  const worker = createWorker({
    requestId: () => "vision-1",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "u1", email: "worker@example.com", emailVerified: true }] });
      const body = JSON.parse(options.body);
      const ids = body.generationConfig.responseJsonSchema.properties.classifications.items.properties.id.enum;
      return Response.json({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ classifications: ids.map((id, index) => ({ id, category: index ? "hood" : "aircon", confidence: index ? 70 : 93, reason: "must not echo model text" })) }) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
      });
    },
  });
  const images = Array.from({ length: 7 }, (_, index) => ({ id: `photo_${index + 1}`, dataUrl: jpeg() }));
  const response = await worker.fetch(request(images), env());
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.classifications.length, 7);
  assert.equal(value.classifications[0].category, "aircon");
  assert.equal(value.classifications[1].category, "review");
  const gemini = calls.filter(call => call.url.includes("generativelanguage.googleapis.com"));
  assert.equal(gemini.length, 2);
  assert.equal(calls.some(call => call.url.includes("api.groq.com")), false);
  gemini.forEach(call => {
    const body = JSON.parse(call.options.body);
    assert.match(call.url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(call.options.redirect, "manual");
    assert.ok(body.contents[0].parts.filter(item => item.inline_data).length <= 6);
    assert.doesNotMatch(JSON.stringify(body), /photo_\d|drive\.google\.com|010-\d|@gmail\.com/u);
  });
  assert.doesNotMatch(JSON.stringify(value), /must not echo/);
  assert.deepEqual(value.usage, { inputTokens: 20, outputTokens: 6 });
});

const payload = { kind: "moveIn", images: [{ id: "private-drive-id", dataUrl: jpeg() }] };
const responseFor = rows => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ classifications: rows }) }] } }] });

test("Gemini 누락·비정상 구역은 확인 대기이며 원본 ID는 제공자에 전송하지 않는다", async () => {
  for (const rows of [[], [{ id: "unknown", category: "floor", confidence: 90 }], [{ id: "p1", category: "invented", confidence: 90 }]]) {
    const result = await classifyPhotos(payload, env(), async () => responseFor(rows));
    assert.equal(result.classifications[0].id, "private-drive-id");
    assert.equal(result.classifications[0].category, "review");
  }
});

test("키 누락과 허용되지 않은 모델은 외부 호출 전에 차단한다", async () => {
  const never = () => { throw Error("must not call"); };
  await assert.rejects(classifyPhotos(payload, env({ GEMINI_API_KEY: "" }), never), { code: "GEMINI_NOT_CONFIGURED" });
  await assert.rejects(classifyPhotos(payload, env({ GEMINI_REPORT_MODEL: "other/host" }), never), { code: "AI_CONFIGURATION_ERROR" });
});

test("리디렉션·한도·잘린 JSON·과대 응답은 안전하게 실패한다", async () => {
  for (const [response, code] of [
    [new Response(null, { status: 302, headers: { location: "https://example.com" } }), "AI_TEMPORARY_FAILURE"],
    [new Response(null, { status: 429 }), "RATE_LIMITED"],
    [new Response("not json"), "AI_INVALID_RESPONSE"],
    [new Response("x".repeat(129 * 1024)), "AI_INVALID_RESPONSE"],
    [Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }), "AI_INVALID_RESPONSE"],
  ]) await assert.rejects(classifyPhotos(payload, env(), async () => response), { code });
});

test("사진 분류 route는 비인증 요청을 provider로 보내지 않는다", async () => {
  let calls = 0;
  const worker = createWorker({ fetchImpl: async () => { calls += 1; throw new Error("not expected"); } });
  const response = await worker.fetch(request([{ id: "a", dataUrl: jpeg() }], ""), env());
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createWorker } from "../src/index.js";
import { classifyPhotos, readPhotoClassificationPayload, normalizePairs } from "../src/photo-classify.js";

const jpeg = () => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]).toString("base64")}`;

test("촬영시각 상대 분은 서버에서도 제한하며 날짜·GPS를 받지 않는다", async () => {
  const photo = { id: "a", dataUrl: jpeg(), captureMinute: 156 };
  assert.equal((await readPhotoClassificationPayload(request([photo], "fixture", "compare"))).images[0].captureMinute, 156);
  for (const captureMinute of [-1, 1440, 0.5, "2"]) await assert.rejects(() => readPhotoClassificationPayload(request([{ ...photo, captureMinute }], "fixture", "compare")), { code: "INVALID_INPUT" });
  await assert.rejects(() => readPhotoClassificationPayload(request([photo])), { code: "INVALID_INPUT" });
  await assert.rejects(() => readPhotoClassificationPayload(request([{ ...photo, captureDate: "2026-10-02" }], "fixture", "compare")), { code: "INVALID_INPUT" });
});
test("같은 장면 시간 추천은 시간 근거와 높은 장면 일치 점수 둘 다 필요하다", () => {
  const good = { beforeId: "p1", afterId: "p2", matchConfidence: 95, phaseConfidence: 90, evidence: "same_scene_time" };
  const check = (times, overrides = {}) => normalizePairs(JSON.stringify({ pairs: [{ ...good, ...overrides }] }), times.map((captureMinute, i) => ({ id: `p${i + 1}`, captureMinute })));
  assert.equal(check([0, 40]).length, 1);
  for (const times of [[undefined, 40], [0, undefined], [0, 39], [40, 0], [0, 0]]) assert.equal(check(times).length, 0);
  assert.equal(check([0, 60], { matchConfidence: 94 }).length, 0);
  assert.equal(check([60, 0], { evidence: "debris_removed" }).length, 0);
});
test("AI에는 실제 날짜 대신 원본 기준 상대 간격과 중간 전 사진 예외만 알려준다", async () => {
  const images = [{ id: "private_1", dataUrl: jpeg(), captureMinute: 0 }, { id: "private_2", dataUrl: jpeg(), captureMinute: 156 }];
  const result = await classifyPhotos({ kind: "moveIn", mode: "compare", images }, env(), async (_, options) => {
    assert.match(options.body, /captureMinute=156/u);
    assert.match(options.body, /중간에도 추가 촬영/u);
    assert.doesNotMatch(options.body, /private_|2026-10-02|DateTimeOriginal|latitude/u);
    return responseForPair([{ beforeId: "p1", afterId: "p2", matchConfidence: 96, phaseConfidence: 90, evidence: "same_scene_time" }]);
  });
  assert.deepEqual(result.pairs, [{ beforeId: "private_1", afterId: "private_2", evidence: "same_scene_time" }]);
});

test("전후 비교는 같은 요청의 ID만 허용하고 중복·낮은 점수·근거 없음은 제외한다", () => {
  const good = { beforeId: "p1", afterId: "p2", matchConfidence: 90, phaseConfidence: 90, evidence: "debris_removed" };
  const images = ["p1", "p2", "p3", "p4"].map(id => ({ id }));
  const pairs = normalizePairs(JSON.stringify({ pairs: [good, { ...good, afterId: "p3" }, { ...good, beforeId: "foreign", afterId: "p4" }, { ...good, beforeId: "p3", afterId: "p4", phaseConfidence: 30 }] }), images);
  assert.deepEqual(pairs, [{ beforeId: "p1", afterId: "p2", evidence: "debris_removed" }]);
  assert.deepEqual(normalizePairs(JSON.stringify({ pairs: [{ ...good, evidence: "unknown" }] }), images), []);
});
test("전후 비교는 6장 분류 경계를 넘어 비교하고 사진 원본 식별정보를 제공자에 보내지 않는다", async () => {
  const images = Array.from({ length: 8 }, (_, i) => ({ id: `private_${i}`, dataUrl: jpeg() }));
  let calls = 0;
  const result = await classifyPhotos({ kind: "moveIn", mode: "compare", images }, env(), async (_, options) => {
    calls += 1; assert.equal(options.redirect, "manual");
    const body = JSON.parse(options.body);
    assert.equal(options.body.includes("private_"), false);
    assert.equal(body.generationConfig.responseJsonSchema.properties.pairs.items.properties.beforeId.enum.length, 8);
    return responseForPair([{ beforeId: "p1", afterId: "p8", matchConfidence: 95, phaseConfidence: 88, evidence: "stain_reduced" }]);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.pairs, [{ beforeId: "private_0", afterId: "private_7", evidence: "stain_reduced" }]);
});
const responseForPair = pairs => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ pairs }) }] } }] });
test("확장된 공간·대상 분류도 닫힌 값으로 정규화한다", async () => {
  const result = await classifyPhotos({ kind: "moveIn", images: [{ id: "one", dataUrl: jpeg() }] }, env(), async () => responseFor([{ id: "p1", category: "floor", space: "<script>", target: "floor", confidence: 90 }]));
  assert.equal(result.classifications[0].space, "unknown"); assert.equal(result.classifications[0].target, "floor");
});
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

function request(images, token = "firebase-token", mode) {
  return new Request("https://ai.example/v1/photo-classify", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "moveIn", images, ...(mode ? { mode } : {}) }),
  });
}

test("사진 분류 payload는 JPEG 시그니처와 허용 필드까지 검사한다", async () => {
  assert.equal((await readPhotoClassificationPayload(request([{ id: "a", dataUrl: jpeg() }]))).images.length, 1);
  await assert.rejects(() => readPhotoClassificationPayload(request([{ id: "a", dataUrl: "data:image/jpeg;base64,AAAA" }])), error => error?.code === "INVALID_INPUT");
  await assert.rejects(() => readPhotoClassificationPayload(request([{ id: "a", dataUrl: jpeg(), driveUrl: "https://drive.google.com/x" }])), error => error?.code === "INVALID_INPUT");
  await assert.rejects(() => readPhotoClassificationPayload(request([{ id: "a", dataUrl: jpeg() }], "firebase-token", "arbitrary")), error => error?.code === "INVALID_INPUT");
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
test("전후 비교 route도 인증을 요구하고 검증된 짝만 클라이언트로 전달한다", async () => {
  let providers = 0;
  const worker = createWorker({ fetchImpl: async (url) => {
    if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "u1", email: "worker@example.com", emailVerified: true }] });
    providers += 1;
    return responseForPair([{ beforeId: "p1", afterId: "p2", matchConfidence: 92, phaseConfidence: 90, evidence: "debris_removed" }]);
  } });
  const images = [{ id: "before", dataUrl: jpeg() }, { id: "after", dataUrl: jpeg() }];
  assert.equal((await worker.fetch(request(images, "", "compare"), env())).status, 401);
  assert.equal(providers, 0);
  const response = await worker.fetch(request(images, "firebase-token", "compare"), env());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.pairs, [{ beforeId: "before", afterId: "after", evidence: "debris_removed" }]);
  assert.equal(providers, 1);
});
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

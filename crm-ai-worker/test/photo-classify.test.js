import assert from "node:assert/strict";
import test from "node:test";

import { createWorker } from "../src/index.js";
import { readPhotoClassificationPayload } from "../src/photo-classify.js";

const jpeg = () => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]).toString("base64")}`;
const env = overrides => ({
  AI_ENABLED: "true",
  FIREBASE_WEB_API_KEY: "public-key",
  CRM_ALLOWED_EMAILS: "worker@example.com",
  GROQ_API_KEY: "provider-secret",
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

test("사진 분류 route는 인증 뒤 3장씩 vision 요청하고 낮은 확신은 확인으로 남긴다", async () => {
  const calls = [];
  const worker = createWorker({
    requestId: () => "vision-1",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "u1", email: "worker@example.com", emailVerified: true }] });
      const body = JSON.parse(options.body);
      const text = body.messages[0].content[0].text;
      const ids = [...text.matchAll(/\d+=(photo_\d+)/gu)].map(match => match[1]);
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ classifications: ids.map((id, index) => ({ id, category: index ? "hood" : "aircon", confidence: index ? 70 : 93, reason: "사진 대상" })) }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      });
    },
  });
  const images = Array.from({ length: 4 }, (_, index) => ({ id: `photo_${index + 1}`, dataUrl: jpeg() }));
  const response = await worker.fetch(request(images), env());
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.classifications.length, 4);
  assert.equal(value.classifications[0].category, "aircon");
  assert.equal(value.classifications[1].category, "review");
  const groq = calls.filter(call => call.url.includes("api.groq.com"));
  assert.equal(groq.length, 2, "4장은 최대 3장씩 두 요청이어야 한다");
  groq.forEach(call => {
    const body = JSON.parse(call.options.body);
    assert.equal(body.model, "qwen/qwen3.8-27b");
    assert.ok(body.messages[0].content.filter(item => item.type === "image_url").length <= 3);
    assert.doesNotMatch(JSON.stringify(body), /drive\.google\.com|010-\d|@gmail\.com/u);
  });
});

test("사진 분류 route는 비인증 요청을 provider로 보내지 않는다", async () => {
  let calls = 0;
  const worker = createWorker({ fetchImpl: async () => { calls += 1; throw new Error("not expected"); } });
  const response = await worker.fetch(request([{ id: "a", dataUrl: jpeg() }], ""), env());
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

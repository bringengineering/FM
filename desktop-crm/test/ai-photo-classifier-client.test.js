const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_PHOTOS,
  validatePhotoClassificationInput,
  classifyPhotosWithGateway,
} = require("../src/ai-photo-classifier-client");

const jpeg = bytes => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes || 4)]).toString("base64")}`;

test("촬영 정보는 비교 요청의 제한된 상대 분만 허용한다", () => {
  const input = { kind: "moveIn", mode: "compare", images: [{ id: "a", dataUrl: jpeg(), captureMinute: 156 }] };
  assert.equal(validatePhotoClassificationInput(input).images[0].captureMinute, 156);
  for (const captureMinute of [-1, 1440, 1.5, "1", NaN, Infinity]) assert.throws(() => validatePhotoClassificationInput({ ...input, images: [{ ...input.images[0], captureMinute }] }), { code: "INVALID_INPUT" });
  assert.throws(() => validatePhotoClassificationInput({ ...input, mode: "classify" }), { code: "INVALID_INPUT" });
});

test("전후 비교 응답은 예상 ID와 허용된 근거만 받는다", async () => {
  const input = { kind: "moveIn", mode: "compare", images: [{ id: "a", dataUrl: jpeg() }, { id: "b", dataUrl: jpeg() }] };
  const opts = { endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify", idToken: "test", input };
  const fetchImpl = pair => async () => Response.json({ ok: true, requestId: "r", classifications: [], pairs: [pair] });
  const pair = { beforeId: "a", afterId: "b", evidence: "debris_removed" };
  assert.deepEqual((await classifyPhotosWithGateway({ ...opts, fetchImpl: fetchImpl(pair) })).pairs, [pair]);
  await assert.rejects(() => classifyPhotosWithGateway({ ...opts, fetchImpl: fetchImpl({ ...pair, afterId: "foreign" }) }), { code: "AI_INVALID_RESPONSE" });
  assert.throws(() => validatePhotoClassificationInput({ ...input, mode: "upload" }), { code: "INVALID_INPUT" });
});

test("사진 분류 입력은 30장 이하의 작은 JPEG와 제한된 필드만 받는다", () => {
  assert.deepEqual(validatePhotoClassificationInput({ kind: "moveIn", images: [{ id: "drive_1", dataUrl: jpeg() }] }), {
    kind: "moveIn", images: [{ id: "drive_1", dataUrl: jpeg() }],
  });
  assert.throws(() => validatePhotoClassificationInput({ kind: "stairs", images: [{ id: "x", dataUrl: jpeg() }] }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => validatePhotoClassificationInput({ kind: "moveIn", images: [{ id: "x", dataUrl: "data:image/png;base64,AAAA" }] }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => validatePhotoClassificationInput({ kind: "moveIn", images: [{ id: "x", dataUrl: `data:image/jpeg;base64,${Buffer.alloc(8).toString("base64")}` }] }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => validatePhotoClassificationInput({ kind: "moveIn", images: Array.from({ length: MAX_PHOTOS + 1 }, (_, index) => ({ id: `x_${index}`, dataUrl: jpeg() })) }), error => error?.code === "INPUT_TOO_LARGE");
  assert.throws(() => validatePhotoClassificationInput({ kind: "moveIn", images: [{ id: "x", dataUrl: jpeg(), url: "https://drive.google.com/private" }] }), error => error?.code === "INVALID_INPUT");
});

test("사진 분류 client는 Firebase 토큰과 축소본만 보내고 결과를 제한한다", async () => {
  let captured;
  const result = await classifyPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify",
    idToken: "firebase-token",
    input: { kind: "moveIn", images: [{ id: "drive_1", dataUrl: jpeg() }, { id: "drive_2", dataUrl: jpeg() }] },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({ ok: true, requestId: "photo-1", classifications: [{ id: "drive_1", category: "aircon", confidence: 92, reason: "필터 망과 커버가 보임", ignored: "drop" }] });
    },
  });
  assert.equal(captured.options.headers.authorization, "Bearer firebase-token");
  assert.equal(JSON.parse(captured.options.body).images[0].dataUrl.startsWith("data:image/jpeg;base64,"), true);
  assert.deepEqual(result.classifications, [
    { id: "drive_1", category: "aircon", confidence: 92, reason: "필터 망과 커버가 보임" },
    { id: "drive_2", category: "review", confidence: 0, reason: "AI가 분류 결과를 주지 않아 확인이 필요합니다." },
  ]);
});

test("사진 분류 client는 주소와 응답을 닫힌 형태로 검사한다", async () => {
  await assert.rejects(() => classifyPhotosWithGateway({ endpoint: "http://gateway.example/v1/photo-classify", idToken: "x", input: { kind: "moveIn", images: [{ id: "x", dataUrl: jpeg() }] } }), error => error?.code === "AI_CONFIGURATION_ERROR");
  await assert.rejects(() => classifyPhotosWithGateway({ endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify", idToken: "x", input: { kind: "moveIn", images: [{ id: "x", dataUrl: jpeg() }] }, fetchImpl: async () => Response.json({ ok: true, requestId: "r", classifications: [{ id: "x", category: "unknown" }] }) }), error => error?.code === "AI_INVALID_RESPONSE");
});

test("photo transport rejects credential-bearing/unapproved URLs before sending and bounds response bytes/time", async () => {
  const endpoint = "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify";
  const input = { kind: "moveIn", images: [{ id: "a", dataUrl: jpeg() }] };
  for (const url of ["https://evil.invalid/v1/photo-classify", endpoint + "?key=synthetic", endpoint.replace("https://", "https://user:pass@"), endpoint + "#fragment"]) {
    await assert.rejects(() => classifyPhotosWithGateway({ endpoint: url, idToken: "synthetic", input, fetchImpl: () => { throw new Error("must not call"); } }), { code: "AI_CONFIGURATION_ERROR" });
  }
  await assert.rejects(() => classifyPhotosWithGateway({ endpoint, idToken: "synthetic", input, fetchImpl: async (_, options) => {
    assert.equal(options.redirect, "error"); return new Response("x".repeat(129 * 1024));
  } }), { code: "AI_INVALID_RESPONSE" });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(() => classifyPhotosWithGateway({ endpoint, idToken: "synthetic", input, timeoutMs: 20, fetchImpl: async (_, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener("abort", () => controller.error(new DOMException("timeout", "AbortError")), { once: true }); },
    })) }), { code: "AI_TEMPORARY_FAILURE" });
  } finally { clearTimeout(keepAlive); }
});

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_PHOTOS,
  validatePhotoClassificationInput,
  classifyPhotosWithGateway,
} = require("../src/ai-photo-classifier-client");

const jpeg = bytes => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes || 4)]).toString("base64")}`;

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
    endpoint: "https://gateway.example/v1/photo-classify",
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
  await assert.rejects(() => classifyPhotosWithGateway({ endpoint: "https://gateway.example/v1/photo-classify", idToken: "x", input: { kind: "moveIn", images: [{ id: "x", dataUrl: jpeg() }] }, fetchImpl: async () => Response.json({ ok: true, requestId: "r", classifications: [{ id: "x", category: "unknown" }] }) }), error => error?.code === "AI_INVALID_RESPONSE");
});

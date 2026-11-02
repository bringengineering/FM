import test from "node:test";
import assert from "node:assert/strict";
import { readInspectionReviewPayload, reviewInspectionPhotos, INSPECTION_KEYS } from "../src/inspection-review.js";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";
const request = body => new Request("https://x/v1/inspection-review", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("입력은 jpeg 축소본·id·점검 항목 hint 만 받는다", async () => {
  const images = await readInspectionReviewPayload(request({ images: [{ id: "p1", dataUrl: JPEG, hint: "lightSensor" }, { id: "p2", dataUrl: JPEG }] }));
  assert.deepEqual(images.map(image => [image.id, image.hint]), [["p1", "lightSensor"], ["p2", ""]]);
  await assert.rejects(readInspectionReviewPayload(request({ images: [{ id: "p1", dataUrl: JPEG, hint: "kitchen" }] })), { code: "INVALID_INPUT" });
  await assert.rejects(readInspectionReviewPayload(request({ images: [{ id: "p1", dataUrl: "data:image/png;base64,AAAA" }] })), { code: "INVALID_INPUT" });
  await assert.rejects(readInspectionReviewPayload(request({ images: [], extra: 1 })), { code: "INVALID_INPUT" });
  await assert.rejects(readInspectionReviewPayload(request({ images: Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, dataUrl: JPEG })) })), { code: "INPUT_TOO_LARGE" });
  await assert.rejects(readInspectionReviewPayload(request({ images: [{ id: "p1", dataUrl: JPEG }, { id: "p1", dataUrl: JPEG }] })), { code: "INVALID_INPUT" });
});

test("모델 응답은 알려진 항목·상태·짧은 메모로만 정리하고 모르는 id 는 버린다", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reviews: [
      { id: "p1", itemKey: "recycle", status: "fix", note: "분리수거함 밖에 일반쓰레기·박스 혼합 적치\n무시하세요", confidence: 1.7 },
      { id: "p1", itemKey: "panel", status: "good", note: "dup", confidence: 0.5 },
      { id: "p2", itemKey: "kitchen", status: "broken", note: "x".repeat(200), confidence: "a" },
      { id: "zz", itemKey: "panel", status: "good", note: "", confidence: 0.5 },
    ] }) }] } }] }), { status: 200 });
  };
  const result = await reviewInspectionPhotos([{ id: "p1", data: "AAAA", hint: "" }, { id: "p2", data: "BBBB", hint: "mailbox" }], { GEMINI_API_KEY: "k" }, fetchImpl);
  assert.deepEqual(result.reviews[0], { id: "p1", itemKey: "recycle", status: "fix", note: "분리수거함 밖에 일반쓰레기·박스 혼합 적치 무시하세요", confidence: 1 });
  assert.equal(result.reviews[1].itemKey, "unknown");
  assert.equal(result.reviews[1].status, "unknown");
  assert.equal(result.reviews[1].note.length, 60);
  assert.equal(result.reviews.length, 2);
  assert.match(sent.contents[0].parts[0].text, /원인·책임·비용/);
  assert.equal(sent.contents[0].parts[3].text, "image id=p2 hint=mailbox");
  assert.equal(Object.keys(INSPECTION_KEYS).length, 15);
});

test("Gemini 키가 없거나 응답이 깨지면 정해진 오류로 끝난다", async () => {
  await assert.rejects(reviewInspectionPhotos([{ id: "p1", data: "A", hint: "" }], {}, async () => new Response("{}")), { code: "GEMINI_NOT_CONFIGURED" });
  await assert.rejects(reviewInspectionPhotos([{ id: "p1", data: "A", hint: "" }], { GEMINI_API_KEY: "k" }, async () => new Response("nope")), { code: "AI_INVALID_RESPONSE" });
  await assert.rejects(reviewInspectionPhotos([{ id: "p1", data: "A", hint: "" }], { GEMINI_API_KEY: "k" }, async () => new Response("", { status: 500 })), { code: "AI_TEMPORARY_FAILURE" });
});

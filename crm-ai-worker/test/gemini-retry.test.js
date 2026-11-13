import test from "node:test";
import assert from "node:assert/strict";
import { sendWithRetry } from "../src/photo-classify.js";

const reply = (status, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), body: { cancel: async () => {} } });

test("Gemini 429·503 은 기다렸다가 두 번까지 다시 묻는다", async () => {
  const statuses = [429, 503, 200]; let calls = 0;
  const response = await sendWithRetry(async () => reply(statuses[calls++]), new AbortController().signal, [1, 1]);
  assert.equal(response.status, 200); assert.equal(calls, 3);
});

test("세 번째에도 거절되면 그 응답을 돌려준다(호출 쪽이 RATE_LIMITED 로 바꾼다)", async () => {
  let calls = 0;
  const response = await sendWithRetry(async () => { calls += 1; return reply(429); }, new AbortController().signal, [1, 1]);
  assert.equal(response.status, 429); assert.equal(calls, 3);
});

test("400·401 같은 요청 오류는 다시 묻지 않는다", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    const response = await sendWithRetry(async () => { calls += 1; return reply(status); }, new AbortController().signal, [1, 1]);
    assert.equal(response.status, status); assert.equal(calls, 1, String(status));
  }
});

test("Retry-After 를 따르되 8초를 넘기지 않고, 제한 시간이 끝나면 멈춘다", async () => {
  const controller = new AbortController();
  let calls = 0;
  const started = Date.now();
  const pending = sendWithRetry(async () => { calls += 1; return reply(429, { "retry-after": "120" }); }, controller.signal, [1, 1]);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, error => error.code === "AI_TEMPORARY_FAILURE");
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 2000);
});

import { normalizeMatches, readPhotoClassificationPayload } from "../src/photo-classify.js";

test("묶은 요청에서도 같은 구역(group)끼리만 짝을 남긴다", () => {
  const images = [{ id: "p1", phase: "before", group: "stairs" }, { id: "p2", phase: "after", group: "stairs" }, { id: "p3", phase: "before", group: "corridor" }, { id: "p4", phase: "after", group: "corridor" }];
  const raw = JSON.stringify({ pairs: [
    { beforeId: "p1", afterId: "p4", matchConfidence: 95, anchors: ["frame_shape", "fixture_position"] },
    { beforeId: "p3", afterId: "p4", matchConfidence: 92, anchors: ["frame_shape", "surface_edge"] },
    { beforeId: "p1", afterId: "p2", matchConfidence: 90, anchors: ["frame_shape", "surface_edge"] },
  ] });
  assert.deepEqual(normalizeMatches(raw, images).map(p => `${p.beforeId}-${p.afterId}`), ["p3-p4", "p1-p2"]);
});

test("group 은 match 에서만, 정해진 글자로만 받는다", async () => {
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  const make = (mode, images) => new Request("https://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "common", ...(mode ? { mode } : {}), images }) });
  const ok = await readPhotoClassificationPayload(make("match", [{ id: "a", dataUrl: jpeg, phase: "before", group: "stairs" }, { id: "b", dataUrl: jpeg, phase: "after", group: "stairs" }]));
  assert.equal(ok.images[0].group, "stairs");
  await assert.rejects(readPhotoClassificationPayload(make("", [{ id: "a", dataUrl: jpeg, group: "stairs" }])), error => error.code === "INVALID_INPUT");
  await assert.rejects(readPhotoClassificationPayload(make("match", [{ id: "a", dataUrl: jpeg, phase: "before", group: "계단 <x>" }, { id: "b", dataUrl: jpeg, phase: "after" }])), error => error.code === "INVALID_INPUT");
});

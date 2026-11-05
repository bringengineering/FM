"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Client = require("../src/ai-monthly-report-photo-client");

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]).toString("base64")}`;
const input = () => ({
  month: "2026-08",
  activities: [{ id: "activity_0", date: "2026-08-21", kind: "냉난방·필터 점검" }],
  images: [{ id: "photo_123456789", date: "2026-08-21", dataUrl: jpeg }],
});

test("월간 사진 요청은 달력 날짜와 JPEG 시그니처를 검증한다", () => {
  assert.equal(Client.validateInput(input()).images.length, 1);
  assert.throws(() => Client.validateInput({ ...input(), images: [{ ...input().images[0], date: "2026-09-01" }] }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => Client.validateInput({ ...input(), activities: [{ ...input().activities[0], date: "2026-08-32" }] }), error => error?.code === "INVALID_INPUT");
  assert.throws(() => Client.validateInput({ ...input(), images: [{ ...input().images[0], dataUrl: "data:image/jpeg;base64,AAAA" }] }), error => error?.code === "INVALID_INPUT");
});

test("Gemini Worker 호출은 고정된 HTTPS 호스트와 경로만 허용한다", async () => {
  let captured;
  const result = await Client.selectMonthlyReportPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/monthly-report-photo-select",
    idToken: "firebase-id-token",
    input: input(),
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return Response.json({ ok: true, selected: [{ id: "photo_123456789", caption: "에어컨 필터", reason: "점검 기록과 일치" }] });
    },
  });
  assert.equal(result.selected[0].id, "photo_123456789");
  assert.equal(captured.url, "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/monthly-report-photo-select");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.headers.authorization, "Bearer firebase-id-token");
  for (const endpoint of [
    "http://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/monthly-report-photo-select",
    "https://evil.example/v1/monthly-report-photo-select",
    "https://bring-crm-ai-gateway.bringengineering1008.workers.dev:444/v1/monthly-report-photo-select",
    "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/assist",
    "https://user:pass@bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/monthly-report-photo-select",
  ]) {
    await assert.rejects(() => Client.selectMonthlyReportPhotosWithGateway({ endpoint, idToken: "firebase-id-token", input: input(), fetchImpl: async () => { throw new Error("must not send"); } }), error => error?.code === "AI_TEMPORARY_FAILURE");
  }
});

const gatewayOptions = () => ({
  endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/monthly-report-photo-select",
  idToken: "synthetic-token", input: input(),
});

test("월간 사진 응답은 잘못된 캡션·ID·중복·개수 초과를 거부한다", () => {
  const photo = { id: input().images[0].id, caption: "바닥 상태", reason: "관찰 가능한 대상" };
  for (const selected of [[{ ...photo, id: "unknown" }], [photo, photo], [{ ...photo, caption: {} }], [{ ...photo, caption: " " }], [null]]) {
    assert.throws(() => Client.normalizeResponse({ ok: true, selected }, [photo.id]), { code: "AI_INVALID_RESPONSE" });
  }
});

test("월간 사진 응답 스트림의 크기와 본문 수신 시간도 제한한다", async () => {
  let cancelled = false;
  await assert.rejects(() => Client.selectMonthlyReportPhotosWithGateway({ ...gatewayOptions(), fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(32 * 1024)); }, cancel() { cancelled = true; },
  })) }), { code: "AI_INVALID_RESPONSE" });
  assert.equal(cancelled, true);
  await assert.rejects(() => Client.selectMonthlyReportPhotosWithGateway({ ...gatewayOptions(), timeoutMs: 20,
    fetchImpl: async (_, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener("abort", () => controller.error(new DOMException("timeout", "AbortError")), { once: true }); },
    })),
  }), { code: "AI_TEMPORARY_FAILURE" });
});

test("월간 사진 안전 정책·잘린 응답 오류는 비밀 정보 없이 구분한다", async () => {
  for (const code of ["AI_RESPONSE_INCOMPLETE", "AI_CONTENT_BLOCKED", "RATE_LIMITED", "FORBIDDEN"]) {
    await assert.rejects(() => Client.selectMonthlyReportPhotosWithGateway({ ...gatewayOptions(),
      fetchImpl: async () => Response.json({ ok: false, code, detail: "provider-secret-must-not-leak" }, { status: 502 }),
    }), error => error.code === code && !error.message.includes("provider-secret"));
  }
});

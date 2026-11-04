import test from "node:test";
import assert from "node:assert/strict";
import { logUpstreamFailure, logUpstreamUnreachable, quotaDetails } from "../src/upstream-log.js";
import { reviewInspectionPhotos } from "../src/inspection-review.js";
import { classifyPhotos } from "../src/photo-classify.js";

const quotaBody = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for project 123 key AIzaSECRET", details: [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_paid_tier_requests", quotaId: "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: "150" }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "21s" },
] } };

test("Gemini 429 본문에서 걸린 한도만 뽑는다", () => {
  assert.deepEqual(quotaDetails(quotaBody), { status: "RESOURCE_EXHAUSTED", retryDelay: "21s", quotas: [{
    metric: "generativelanguage.googleapis.com/generate_content_paid_tier_requests", id: "GenerateRequestsPerMinutePerProjectPerModel", value: "150" }] });
});

test("로그에는 원문 메시지·키를 남기지 않고 본문을 소비한다", async () => {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const response = new Response(JSON.stringify(quotaBody), { status: 429 });
    await logUpstreamFailure("photo-match", "gemini-3.5-flash", response);
    assert.equal(response.bodyUsed, true);
    await logUpstreamFailure("photo-classify", "gemini-3.5-flash-lite", new Response("<html>not json", { status: 503 }));
  } finally { console.warn = original; }
  assert.match(lines[0], /^ai-upstream-failure /);
  assert.match(lines[0], /PerMinute/);
  assert.match(lines[0], /"httpStatus":429/);
  assert.doesNotMatch(lines.join("\n"), /AIza|Quota exceeded|project 123|html/);
  assert.match(lines[1], /"httpStatus":503/);
});

test("허용되지 않은 문자가 든 값은 버린다", () => {
  const out = quotaDetails({ error: { status: "BAD STATUS <x>", details: [{ violations: [{ quotaMetric: "a b", quotaId: "ok_id" }] }] } });
  assert.equal(out.status, undefined);
  assert.deepEqual(out.quotas, [{ metric: undefined, id: "ok_id", value: undefined }]);
});

async function captureWarn(run) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try { await run(); } finally { console.warn = original; }
  return lines;
}

test("응답을 못 받으면 오류 종류만 남기고 메시지는 남기지 않는다", async () => {
  const error = new TypeError("connect failed for customer 010-1234-5678");
  const lines = await captureWarn(() => logUpstreamUnreachable("transcribe", "whisper-large-v3-turbo", error));
  assert.match(lines[0], /^ai-upstream-unreachable /);
  assert.match(lines[0], /"reason":"TypeError"/);
  assert.doesNotMatch(lines[0], /010|connect failed/);
});

const inspectionImages = [{ id: "a", data: "AAAA" }];
const env = { GEMINI_API_KEY: "test-key" };

test("점검 검토: Gemini 거절 시 어느 한도인지 남기고 기존 오류 코드는 그대로다", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(quotaBody), { status: 429 });
  const lines = await captureWarn(() => assert.rejects(reviewInspectionPhotos(inspectionImages, env, fetchImpl), { code: "AI_TEMPORARY_FAILURE" }));
  assert.match(lines[0], /"feature":"inspection-review"/);
  assert.match(lines[0], /PerMinute/);
});

test("점검 검토: 연결 실패와 차단 응답을 남긴다", async () => {
  const unreachable = await captureWarn(() => assert.rejects(reviewInspectionPhotos(inspectionImages, env, async () => { throw new TypeError("x"); }), { code: "AI_TEMPORARY_FAILURE" }));
  assert.match(unreachable[0], /^ai-upstream-unreachable .*"reason":"TypeError"/);
  const blocked = await captureWarn(() => reviewInspectionPhotos(inspectionImages, env, async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }))));
  assert.match(blocked[0], /^ai-invalid-response .*"reason":"SAFETY"/);
});

test("사진 분류: 재시도 대기 중 시간 초과도 남긴다", async () => {
  const dataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;
  const fetchImpl = async () => new Response("{}", { status: 503 });
  const payload = { kind: "common", mode: "classify", images: [{ id: "a", dataUrl }] };
  const lines = await captureWarn(() => assert.rejects(classifyPhotos(payload, env, fetchImpl, 200), { code: "AI_TEMPORARY_FAILURE" }));
  assert.match(lines.join("\n"), /^ai-upstream-unreachable .*"reason":"TimeoutError"/m);
});

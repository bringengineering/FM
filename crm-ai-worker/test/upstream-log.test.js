import test from "node:test";
import assert from "node:assert/strict";
import { logUpstreamFailure, quotaDetails } from "../src/upstream-log.js";

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

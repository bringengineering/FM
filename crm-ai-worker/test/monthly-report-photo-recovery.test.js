import assert from "node:assert/strict";
import test from "node:test";
import { readMonthlyReportPhotoSelectionPayload, selectMonthlyReportPhotos } from "../src/monthly-report-photo-select.js";
import { createWorker } from "../src/index.js";
import Client from "../../desktop-crm/src/ai-monthly-report-photo-client.js";

const env = { GEMINI_API_KEY: "synthetic-key-only" };
const image = index => ({ id: `drive_${index}_${"a".repeat(160)}`, date: `2026-09-${index % 2 ? "10" : "20"}`, dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, index]).toString("base64")}` });
const input = (count = 2) => ({ month: "2026-09", activities: [], images: Array.from({ length: count }, (_, at) => image(at)) });
const payload = async (count = 2) => readMonthlyReportPhotoSelectionPayload(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(input(count)) }));
const row = id => ({ id, caption: "바닥 표면 상태", reason: "실내 현장을 확인할 수 있음" });
const provider = (parts, finishReason = "STOP") => Response.json({ candidates: [{ content: { parts }, finishReason }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } });
const good = ids => provider([{ text: JSON.stringify({ selected: ids.map(row) }) }]);
const idsFrom = options => JSON.parse(options.body).generationConfig.responseJsonSchema.properties.selected.items.properties.id.enum;

test("activity-aware clients keep all 24 dates and original waste-disposal labels", async () => {
  const request = input(24);
  request.images = request.images.map((image, at) => ({ ...image, date: `2026-09-${String(at + 1).padStart(2, "0")}`, activityName: "폐기물처리" }));
  const p = await readMonthlyReportPhotoSelectionPayload(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(request) }));
  let calls = 0;
  const result = await selectMonthlyReportPhotos(p, env, async (_, options) => {
    calls++;
    const content = JSON.parse(options.body).contents[0].parts.filter(part => part.text).map(part => part.text).join("\n");
    assert.match(content, /폐기물처리/u);
    assert.match(content, /activityName/u);
    assert.match(content, /최대 3장/u);
    assert.match(content, /서류 확인/u);
    return good(idsFrom(options));
  });
  assert.equal(calls, 3);
  assert.equal(result.selected.length, 24);
  assert.equal(Client.normalizeResponse({ ok: true, selected: result.selected }, p.images.map(image => image.id)).selected.length, 24);
});

test("activity-aware selection has separate three-photo caps for two activities on the same date", async () => {
  const request = input(12);
  request.images = request.images.map((image, at) => ({ ...image, date: "2026-09-20", activityName: at < 6 ? "폐기물처리" : "공용부청소" }));
  const p = await readMonthlyReportPhotoSelectionPayload(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(request) }));
  const result = await selectMonthlyReportPhotos(p, env, async (_, options) => good(idsFrom(options)));
  assert.equal(result.selected.length, 6);
  for (const kind of ["폐기물처리", "공용부청소"]) assert.equal(result.selected.filter(row => p.images.find(image => image.id === row.id).activityName === kind).length, 3);
});

test("identical photographs are not reused for another date or activity", async () => {
  const p = await payload(1);
  const images = [p.images[0], { ...p.images[0], id: "another-date", date: "2026-09-30", activityName: "폐기물처리" }];
  const result = await selectMonthlyReportPhotos({ ...p, images }, env, async (_, options) => {
    assert.equal(idsFrom(options).length, 1);
    return good(idsFrom(options));
  });
  assert.equal(result.selected.length, 1);
});

test("multi-part JSON is joined and thought summaries are excluded", async () => {
  const raw = JSON.stringify({ selected: [row("p2")] });
  let calls = 0;
  const result = await selectMonthlyReportPhotos(await payload(), env, async () => {
    calls++;
    return provider([{ text: "Not JSON - private reasoning", thought: true }, { text: raw.slice(0, 29) }, { text: raw.slice(29) }, { thoughtSignature: "ignored" }]);
  });
  assert.equal(calls, 1);
  assert.equal(result.selected[0].id, image(1).id);
  assert.ok(!JSON.stringify(result).includes("reasoning"));
});

test("a complete JSON fence is accepted, unrelated surrounding prose is not", async () => {
  const raw = JSON.stringify({ selected: [row("p1")] });
  assert.equal((await selectMonthlyReportPhotos(await payload(), env, async () => provider([{ text: `\u0060\u0060\u0060json\n${raw}\n\u0060\u0060\u0060` }]))).selected.length, 1);
  let calls = 0;
  await assert.rejects(() => selectMonthlyReportPhotos(input(), env, async () => {
    calls++;
    return provider([{ text: `Untrusted instructions ${raw}` }]);
  }), { code: "AI_INVALID_RESPONSE" });
  assert.equal(calls, 2); // Stop at the first irrecoverable half.
});

test("24 real candidates use at most 8 images per call and recover a truncated group", async () => {
  const p = await payload(24);
  const batches = [];
  const result = await selectMonthlyReportPhotos(p, env, async (_, options) => {
    const ids = idsFrom(options);
    batches.push(ids.length);
    if (batches.length === 1) return provider([{ text: '{"selected":[' }], "MAX_TOKENS");
    return good(ids);
  });
  assert.deepEqual(batches.sort((a, b) => a - b), [4, 4, 8, 8, 8]);
  assert.equal(result.selected.length, 12);
  assert.equal(new Set(result.selected.map(r => r.id)).size, 12);
  assert.ok(result.selected.every(r => p.images.some(i => i.id === r.id)));
  assert.equal(new Set(result.selected.map(r => p.images.find(i => i.id === r.id).date)).size, 2);
  assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 100 });
});

test("all 24 candidates are reviewed exactly once with concurrency capped at two", async () => {
  let active = 0, peak = 0;
  const sizes = [], encoded = [];
  const p = await payload(24);
  const result = await selectMonthlyReportPhotos(p, env, async (_, options) => {
    active++; peak = Math.max(peak, active);
    const body = JSON.parse(options.body);
    sizes.push(idsFrom(options).length);
    encoded.push(...body.contents[0].parts.filter(part => part.inline_data).map(part => part.inline_data.data));
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return good(idsFrom(options));
  });
  assert.deepEqual(sizes, [8, 8, 8]);
  assert.equal(peak, 2);
  assert.deepEqual(new Set(encoded), new Set(p.images.map(image => image.encoded)));
  assert.equal(encoded.length, 24);
  assert.equal(result.selected.length, 12);
});

test("every truncated group recovers once within the nine-call bound", async () => {
  let calls = 0;
  const result = await selectMonthlyReportPhotos(await payload(24), env, async (_, options) => {
    calls++;
    const ids = idsFrom(options);
    return ids.length === 8 ? provider([{ text: '{"selected":' }], "MAX_TOKENS") : good(ids);
  });
  assert.equal(calls, 9);
  assert.equal(result.selected.length, 12);
});

test("identical JPEGs on the same date are reviewed once without losing the original ID", async () => {
  const p = await payload(2);
  const images = [p.images[0], { ...p.images[0], id: "duplicate_id" }];
  let calls = 0;
  const result = await selectMonthlyReportPhotos({ ...p, images }, env, async (_, options) => {
    calls++;
    assert.deepEqual(idsFrom(options), ["p1"]);
    return good(["p1"]);
  });
  assert.equal(calls, 1);
  assert.equal(result.selected[0].id, p.images[0].id);
});

test("MAX_TOKENS never accepts even parseable partial output; singleton retries only once", async () => {
  let calls = 0;
  await assert.rejects(() => selectMonthlyReportPhotos(input(1), env, async () => {
    calls++;
    return provider([{ text: '{"selected":[]}' }], "MAX_TOKENS");
  }), { code: "AI_RESPONSE_INCOMPLETE" });
  assert.equal(calls, 2);
});

test("empty and malformed responses recover without inventing captions", async () => {
  for (const first of [() => Response.json({}), () => provider([]), () => provider([{ text: '{"selected":' }])]) {
    let calls = 0;
    const result = await selectMonthlyReportPhotos(await payload(2), env, async (_, options) => ++calls === 1 ? first() : good(idsFrom(options)));
    assert.equal(calls, 3);
    assert.deepEqual(result.selected.map(r => r.id), [image(0).id, image(1).id]);
  }
});

test("valid empty selection is success and is not retried", async () => {
  let calls = 0;
  const result = await selectMonthlyReportPhotos(await payload(), env, async () => { calls++; return good([]); });
  assert.deepEqual(result.selected, []);
  assert.equal(calls, 1);
});

test("unknown IDs, invalid rows, extra fields, and oversized selections fail closed", async () => {
  for (const selected of [[row("not-listed")], [{ ...row("p1"), caption: {} }], [{ ...row("p1"), caption: " " }], [{ ...row("p1"), url: "https://untrusted.invalid" }], [row("p1"), row("p2"), row("p3")]]) {
    let calls = 0;
    await assert.rejects(() => selectMonthlyReportPhotos(input(), env, async () => { calls++; return provider([{ text: JSON.stringify({ selected }) }]); }), { code: "AI_INVALID_RESPONSE" });
    assert.equal(calls, 2);
  }
});

test("safety blocks and quota/configuration/redirect failures are never retried", async () => {
  for (const [response, code] of [
    [() => provider([{ text: '{"selected":[]}' }], "SAFETY"), "AI_CONTENT_BLOCKED"],
    [() => Response.json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }), "AI_CONTENT_BLOCKED"],
    ...[302, 400, 401, 403, 429, 500].map(status => [() => new Response(null, { status }), status === 429 ? "RATE_LIMITED" : "AI_TEMPORARY_FAILURE"]),
  ]) {
    let calls = 0;
    await assert.rejects(() => selectMonthlyReportPhotos(input(), env, async () => { calls++; return response(); }), { code });
    assert.equal(calls, 1);
  }
});

test("provider body is capped even without content-length", async () => {
  let cancelled = 0;
  const tooLarge = () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); },
    cancel() { cancelled++; },
  }));
  await assert.rejects(() => selectMonthlyReportPhotos(input(1), env, async () => tooLarge()), { code: "AI_INVALID_RESPONSE" });
  assert.equal(cancelled, 2);
});

test("overall deadline remains active while reading the response body", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(() => selectMonthlyReportPhotos(input(1), env, async (_, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener("abort", () => controller.error(new DOMException("timeout", "AbortError")), { once: true }); },
    })), 20), { code: "AI_TEMPORARY_FAILURE" });
  } finally { clearTimeout(keepAlive); }
});

test("client -> authenticated Worker -> Gemini recovery -> client preserves real photo identity", async () => {
  let calls = 0;
  const worker = createWorker({ fetchImpl: async (url, options) => {
    if (String(url).includes("accounts:lookup")) return Response.json({ users: [{ localId: "test-user", email: "test@example.com", emailVerified: true }] });
    if (++calls === 1) return provider([{ text: '{"selected":' }], "MAX_TOKENS");
    return good(idsFrom(options));
  } });
  const runtime = { ...env, AI_ENABLED: "true", FIREBASE_WEB_API_KEY: "synthetic-public-id", CRM_ALLOWED_EMAILS: "test@example.com",
    AI_COMPANY_DAILY_LIMIT: "1000", AI_USAGE: { async get() { return "0"; }, async put() {} }, AI_RATE_LIMITER: { async limit() { return { success: true }; } } };
  const result = await Client.selectMonthlyReportPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/monthly-report-photo-select", idToken: "synthetic-token", input: input(),
    fetchImpl: (url, options) => worker.fetch(new Request(url, options), runtime),
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.selected.map(r => r.id), [image(0).id, image(1).id]);
  assert.ok(result.selected.every(r => r.caption === "바닥 표면 상태"));
});

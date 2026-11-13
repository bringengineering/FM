import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDocumentDeliveryHandler } from "../src/document-delivery.js";
import { viewerAsset, VIEWER_ASSETS } from "../src/document-viewer.js";

const memory = () => { const values = new Map(); return { async put(k, v) { values.set(k, v); }, async get(k, type) { const v = values.get(k); return type === "json" && v ? JSON.parse(v) : v || null; }, async delete(k) { values.delete(k); } }; };
const token = "opaque_token_1234567890";
async function setup(extra = {}) {
  const storage = memory();
  await storage.put(`token:${token}`, "doc_1");
  await storage.put("doc:doc_1", JSON.stringify({ id: "doc_1", token, documentName: "원주시 단계로 7 공용부 청소 <결과>보고서", expiresAt: "2026-11-20T00:00:00Z", bytes: Buffer.from("%PDF-test").toString("base64"), ...extra }));
  const handler = createDocumentDeliveryHandler({ now: () => Date.parse("2026-11-11T00:00:00Z"), fetchImpl: async () => { throw new Error("no network"); } });
  return { handler, storage, env: { DOCUMENT_DELIVERY: storage } };
}

test("안드로이드에서도 링크가 열리도록 /d/{token} 은 HTML 보기 화면, PDF 는 /d/{token}/pdf 로 따로 준다", async () => {
  const { handler, env } = await setup();
  const page = await handler(new Request(`https://g.test/d/${token}`, { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 15) KAKAOTALK" } }), null, env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(page.headers.get("content-security-policy"), /script-src 'self';/);
  assert.doesNotMatch(page.headers.get("content-security-policy"), /unsafe-eval/);
  const html = await page.text();
  assert.match(html, /<script type="module" src="\/d\/_viewer\/viewer\.mjs"><\/script>/);
  assert.match(html, new RegExp(`data-pdf="/d/${token}/pdf"`));
  assert.match(html, new RegExp(`href="/d/${token}/pdf\\?download=1"`));
  assert.match(html, /공용부 청소 &lt;결과&gt;보고서/);
  assert.match(html, /열람기한 2026-11-20/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/);

  const inline = await handler(new Request(`https://g.test/d/${token}/pdf`), null, env);
  assert.equal(inline.headers.get("content-type"), "application/pdf");
  assert.match(inline.headers.get("content-disposition"), /^inline;/);
  assert.equal(await inline.text(), "%PDF-test");
  const download = await handler(new Request(`https://g.test/d/${token}/pdf?download=1`), null, env);
  assert.match(download.headers.get("content-disposition"), /^attachment; filename="document\.pdf"; filename\*=UTF-8''/);
  assert.match(decodeURIComponent(download.headers.get("content-disposition").split("''")[1]), /공용부 청소  결과 보고서\.pdf$/u);
});

test("PDF 원본 요청은 열람 횟수에 넣지 않고, 만료·폐기된 문서는 보기 화면과 PDF 모두 막는다", async () => {
  const { handler, env, storage } = await setup();
  await handler(new Request(`https://g.test/d/${token}/pdf`, { headers: { "user-agent": "Mozilla/5.0 (Android)" } }), null, env);
  assert.equal((await storage.get("doc:doc_1", "json")).viewCount, undefined);
  await handler(new Request(`https://g.test/d/${token}`, { headers: { "user-agent": "Mozilla/5.0 (Android)" } }), null, env);
  assert.equal((await storage.get("doc:doc_1", "json")).viewCount, 1);
  const revoked = await setup({ revokedAt: "2026-11-10T00:00:00Z" });
  assert.equal((await revoked.handler(new Request(`https://g.test/d/${token}`), null, revoked.env)).status, 410);
  assert.equal((await revoked.handler(new Request(`https://g.test/d/${token}/pdf`), null, revoked.env)).status, 410);
});

test("pdf.js 는 고정 해시가 맞을 때만 같은 출처로 내보내고, 모르는 파일은 404", async () => {
  const good = Buffer.from("pinned-bytes");
  const pins = { ...VIEWER_ASSETS };
  assert.deepEqual(Object.keys(pins).sort(), ["pdf.min.mjs", "pdf.worker.min.mjs"]);
  let requested;
  const tampered = await viewerAsset("pdf.min.mjs", async url => { requested = url; return new Response(good); });
  assert.equal(requested, "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs");
  assert.equal(tampered.status, 502);
  assert.notEqual(createHash("sha256").update(good).digest("hex"), pins["pdf.min.mjs"]);
  assert.equal((await viewerAsset("../secret", async () => new Response(good))).status, 404);
  assert.equal((await viewerAsset("pdf.min.mjs", async () => new Response("", { status: 503 }))).status, 502);
  const script = await viewerAsset("viewer.mjs");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await script.text(), /isEvalSupported: false/);
  const { handler, env } = await setup();
  assert.equal((await handler(new Request("https://g.test/d/_viewer/viewer.mjs"), null, env)).status, 200);
});

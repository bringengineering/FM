import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentDeliveryHandler } from "../src/document-delivery.js";

const admin = { uid: "uid-1", email: "admin@example.com" };
const memory = () => {
  const values = new Map(); let writes = 0;
  return {
    get writes() { return writes; },
    async put(key, value) { writes += 1; values.set(key, value); },
    async get(key, type) { const value = values.get(key); return type === "json" && value ? JSON.parse(value) : value || null; },
    async delete(key) { values.delete(key); },
  };
};
const pdf = btoa("%PDF-1.4\n%%EOF");

test("건물주가 링크를 열면 첫 열람·횟수를 남기고, 봇·잦은 새로고침은 세지 않으며, 관리자만 상태를 본다", async () => {
  let clock = Date.parse("2026-11-03T00:00:00Z");
  const storage = memory();
  const handler = createDocumentDeliveryHandler({ now: () => clock, randomId: () => "opaque_token_1234567890" });
  const env = { DOCUMENT_DELIVERY: storage, CRM_ADMIN_EMAILS: admin.email };
  const created = await (await handler(new Request("https://g.test/v1/document-delivery/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    documentId: "periodic_1", customerId: "notice_1", documentType: "completion_report", documentName: "정기 관리보고서",
    expiresAt: new Date(clock + 7 * 86400000).toISOString(), mimeType: "application/pdf", bytes: pdf,
  }) }), admin, env)).json();
  assert.equal(created.ok, true);
  const open = agent => handler(new Request("https://g.test/d/opaque_token_1234567890", { headers: { "user-agent": agent } }), null, env);
  const status = async () => (await handler(new Request(`https://g.test/v1/document-delivery/documents/${created.documentId}`), admin, env)).json();

  assert.equal((await open("facebookexternalhit/1.1 kakaotalk-scrap/1.0")).status, 200);
  assert.equal((await status()).viewCount, 0);
  assert.equal((await open("Mozilla/5.0 (iPhone) KAKAOTALK 10.0")).status, 200);
  const first = await status();
  assert.equal(first.viewCount, 1);
  assert.equal(first.firstViewedAt, "2026-11-03T00:00:00.000Z");
  const writes = storage.writes;
  clock += 10 * 60 * 1000;
  await open("Mozilla/5.0 (iPhone) KAKAOTALK 10.0");
  assert.equal(storage.writes, writes);
  clock += 2 * 60 * 60 * 1000;
  await open("Mozilla/5.0 (iPhone) KAKAOTALK 10.0");
  const second = await status();
  assert.equal(second.viewCount, 2);
  assert.equal(second.firstViewedAt, "2026-11-03T00:00:00.000Z");
  assert.equal(Object.hasOwn(second, "bytes"), false);

  assert.equal((await handler(new Request(`https://g.test/v1/document-delivery/documents/${created.documentId}`), null, env)).status, 401);
  assert.equal((await handler(new Request(`https://g.test/v1/document-delivery/documents/${created.documentId}`), { uid: "s", email: "staff@example.com" }, env)).status, 403);
  assert.equal((await handler(new Request("https://g.test/v1/document-delivery/documents/doc_missing"), admin, env)).status, 404);
});

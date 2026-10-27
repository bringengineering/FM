const test = require("node:test");
const assert = require("node:assert/strict");
const {createService} = require("../src/saved-document-delivery");

const input = {kind: "quote", documentId: "saved_fixture", updatedAt: "2026-10-01T00:00:00Z", sha256: "a".repeat(64), customerId: "customer"};
const session = {check() {}};
function fixture(options = {}) {
  let row = {id: input.documentId, updatedAt: input.updatedAt, savedCustomerDocument: {kind: input.kind, customerId: input.customerId, sha256: input.sha256}};
  let calls = 0;
  const deps = {
    async mutate(_id, change) { row = change(row); return row; },
    async verify() { if (options.verifyError) throw new Error("changed"); },
    async deliver(payload) { calls++; assert.match(payload.delivery.idempotencyKey, /^saved_[a-f0-9]{64}$/); if (options.error) throw Object.assign(new Error("provider"), {code: options.error}); return {ok:true, status:options.status || "requested", messageId:"message_fixture"}; }
  };
  return {service:createService(deps), row:() => row, calls:() => calls};
}
test("발송 전에 기록을 예약하고 다른 컴퓨터의 중복 요청을 차단한다", async () => {
  const f = fixture();
  const result = await f.service.send(input, session, {delivery:{channel:"kakao"}});
  assert.equal(result.status, "requested"); assert.equal(f.row().customerDocumentDelivery.messageId, "message_fixture");
  await assert.rejects(f.service.send(input, session, {delivery:{channel:"kakao"}}), /이미 발송/);
  assert.equal(f.calls(), 1);
});
test("응답 불확실과 사전 확인 실패를 구분하고 불확실할 때 재발송을 막는다", async () => {
  const f = fixture({error:"DELIVERY_STATUS_UNKNOWN"});
  await assert.rejects(f.service.send(input, session, {delivery:{}}));
  assert.equal(f.row().customerDocumentDelivery.status, "unknown");
  await assert.rejects(f.service.send(input, session, {delivery:{}}), /이미 발송/);
  assert.equal(f.calls(), 1);
  const before = fixture({verifyError:true});
  await assert.rejects(before.service.send(input, session, {delivery:{}}));
  assert.equal(before.row().customerDocumentDelivery.status, "failed"); assert.equal(before.calls(), 0);
});
test("발송 중 요청이 동시에 오면 하나만 발송한다", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.send(input, session, {delivery:{}}), f.service.send(input, session, {delivery:{}})]);
  assert.deepEqual(results.map(x => x.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(f.calls(), 1);
});
test("업체의 명확한 거절은 실패로 남기고 새 요청을 허용한다", async () => {
  const f = fixture({error:"DELIVERY_PROVIDER_REJECTED"});
  await assert.rejects(f.service.send(input, session, {delivery:{}}));
  assert.equal(f.row().customerDocumentDelivery.status, "failed");
  await assert.rejects(f.service.send(input, session, {delivery:{}}));
  assert.equal(f.calls(), 2);
});
test("발송 결과 저장 오류는 결과 불확실로 남겨 재발송을 막는다", async () => {
  let row = {id:input.documentId,updatedAt:input.updatedAt,savedCustomerDocument:{kind:input.kind,customerId:input.customerId,sha256:input.sha256}};
  let writes = 0, calls = 0;
  const service = createService({
    async mutate(_id, change) { writes++; if (writes === 2) throw new Error("storage"); row = change(row); return row; },
    async verify() {}, async deliver() { calls++; return {ok:true,status:"requested",messageId:"fixture"}; }
  });
  await assert.rejects(service.send(input, session, {delivery:{}}));
  assert.equal(row.customerDocumentDelivery.status, "unknown");
  await assert.rejects(service.send(input, session, {delivery:{}}), /이미 발송/);
  assert.equal(calls, 1);
});
test("저장본의 수신자나 해시가 다르면 예약과 발송을 하지 않는다", async () => {
  for (const changed of [{customerId:"other"}, {sha256:"b".repeat(64)}, {updatedAt:"2026-09-01T00:00:00Z"}]) {
    const f = fixture();
    await assert.rejects(f.service.send({...input,...changed}, session, {delivery:{}}), /변경/);
    assert.equal(f.calls(), 0);
    assert.equal(f.row().customerDocumentDelivery, undefined);
  }
});

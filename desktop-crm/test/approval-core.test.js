const assert = require("node:assert/strict");
const test = require("node:test");

const A = require("../src/approval-core");

const base = { id: "ap1", userId: "u1", title: "세제 구매", createdAt: "2026-09-06T00:00:00.000Z" };

test("지출·구매는 금액이 없으면 올릴 수 없다", () => {
  // 승인하는 사람이 무엇을 승인하는지 알아야 한다.
  assert.equal(A.validateRequest({ ...base, kind: "expense" }).code, "AMOUNT_REQUIRED");
  assert.equal(A.validateRequest({ ...base, kind: "purchase" }).code, "AMOUNT_REQUIRED");
  // 계약·일반은 금액이 없어도 된다.
  assert.equal(A.validateRequest({ ...base, kind: "contract" }).ok, true);
  assert.equal(A.validateRequest({ ...base, kind: "general" }).ok, true);
});

test("금액은 원 단위 정수만 받는다", () => {
  assert.equal(A.validateRequest({ ...base, kind: "expense", amount: "120,000" }).record.amount, 120000);
  assert.equal(A.validateRequest({ ...base, kind: "expense", amount: "12만원" }).code, "AMOUNT_INVALID");
  assert.equal(A.validateRequest({ ...base, kind: "expense", amount: "1000.5" }).code, "AMOUNT_INVALID");
  assert.equal(A.validateRequest({ ...base, kind: "expense", amount: "-5000" }).code, "AMOUNT_INVALID");
});

test("제목이 없으면 올릴 수 없다", () => {
  assert.equal(A.validateRequest({ ...base, title: "" }).code, "TITLE_REQUIRED");
});

test("첨부 위치는 https 만 받는다", () => {
  assert.equal(A.validateRequest({ ...base, attachmentUrl: "http://x.test/a" }).code, "ATTACHMENT_INVALID");
  assert.equal(A.validateRequest({ ...base, attachmentUrl: "https://x.test/a" }).ok, true);
});

test("이미 정해진 결재는 다시 정할 수 없다", () => {
  // 두 관리자가 동시에 눌러도 뒤에 누른 쪽이 앞선 결정을 덮지 못한다.
  for (const status of ["approved", "rejected", "cancelled"]) {
    const result = A.decide({ request: { ...base, status }, decision: "approved", decidedBy: "김현진" });
    assert.equal(result.code, "ALREADY_DECIDED", status);
  }
});

test("정한 사람이 없으면 정해지지 않는다", () => {
  assert.equal(A.decide({ request: { ...base, status: "requested" }, decision: "approved" }).code, "DECIDER_REQUIRED");
});

test("반려는 사유가 있어야 한다", () => {
  // 이유 없는 반려는 다시 올리라는 말과 같은데 무엇을 고쳐야 하는지 알 수 없다.
  const without = A.decide({ request: { ...base, status: "requested" }, decision: "rejected", decidedBy: "김현진" });
  assert.equal(without.code, "REASON_REQUIRED");
  const withNote = A.decide({ request: { ...base, status: "requested" }, decision: "rejected", decidedBy: "김현진", note: "견적 재확인" });
  assert.equal(withNote.ok, true);
  assert.equal(withNote.record.decisionNote, "견적 재확인");
  // 승인은 사유가 없어도 된다.
  assert.equal(A.decide({ request: { ...base, status: "requested" }, decision: "approved", decidedBy: "김현진" }).ok, true);
});

test("승인과 반려 말고는 정할 수 없다", () => {
  assert.equal(A.decide({ request: { ...base, status: "requested" }, decision: "paid", decidedBy: "김현진" }).code, "BAD_DECISION");
});

test("내용이 바뀌었는지 알아본다", () => {
  // 취소하면서 금액을 슬쩍 바꾸는 길을 막는다.
  const before = { ...base, kind: "expense", amount: 120000, status: "requested" };
  assert.equal(A.sameContent(before, { ...before, status: "cancelled" }), true);
  assert.equal(A.sameContent(before, { ...before, amount: 12000, status: "cancelled" }), false);
  assert.equal(A.sameContent(before, { ...before, title: "다른 것", status: "cancelled" }), false);
  assert.equal(A.sameContent(before, { ...before, vendor: "다른 업체" }), false);
});

test("대기 중인 것만 승인 목록에 오른다", () => {
  const rows = [
    { ...base, id: "a1", status: "requested", createdAt: "2026-09-02T00:00:00.000Z" },
    { ...base, id: "a2", status: "approved" },
    { ...base, id: "a3", status: "requested", createdAt: "2026-09-01T00:00:00.000Z" },
  ];
  // 오래된 것부터. 먼저 올린 사람이 먼저 답을 받아야 한다.
  assert.deepEqual(A.pending(rows).map(item => item.id), ["a3", "a1"]);
});

test("모르는 칸과 상태는 조용히 버린다", () => {
  const record = A.normalizeRequest({ ...base, status: "paid", kind: "bribe", secret: "x" });
  assert.equal(record.status, "requested");
  assert.equal(record.kind, "general");
  assert.ok(!("secret" in record));
});

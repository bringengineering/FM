const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Core = require("../src/core");

test("shared CRM store preserves bounded customer contract readiness", () => {
  const store = Core.sanitizeSharedStore({ contractReadiness: [{ id: "ready_1", customerId: "c1", contractId: "k1", contractType: "공용부 청소 위탁", owner: "김현진", dueDate: "2026-09-10", sourceDriveFileId: "file_123", sourceRevisionId: "rev-1", items: [{ id: "owner-id", label: "건물주 신분 확인", party: "고객·건물주", required: true, evidence: "계약서 1항", status: "complete", note: "확인", completedAt: "2026-09-02", completedBy: "u1", secret: "drop" }] }] });
  assert.equal(store.contractReadiness[0].items[0].status, "complete");
  assert.equal(store.contractReadiness[0].items[0].secret, undefined);
  assert.equal(store.contractReadiness[0].sourceRevisionId, "rev-1");
});

test("contract editor exposes approved source, owner, due date, evidence and missing-item tasks", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  for (const phrase of ["계약 준비 도우미", "승인된 기준 문서", "고객·건물주", "회사 준비", "협력업체", "서명·교부", "미완료 항목을 할 일로 추가", "sourceRevisionId"]) assert.match(app, new RegExp(phrase));
});

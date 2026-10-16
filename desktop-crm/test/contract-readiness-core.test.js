const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeSourceRegistry, diffApprovedTemplate, createReadinessChecklist, summarizeReadiness } = require("../src/contract-readiness-core");

test("source registry keeps approved Drive IDs and immutable versions", () => {
  const registry = normalizeSourceRegistry([{ id: "source-1", driveFileId: "drive-1", title: "관리계약서", approvedVersion: { revisionId: "rev-2", modifiedAt: "2026-09-01T00:00:00Z", items: [{ id: "owner-id", label: "건물주 신분증", party: "customer", required: true }] }, pendingVersion: { revisionId: "rev-3" }, ignored: "drop" }]);
  assert.equal(registry[0].driveFileId, "drive-1");
  assert.equal(registry[0].approvedVersion.revisionId, "rev-2");
  assert.equal(registry[0].approvedVersion.items[0].label, "건물주 신분증");
  assert.equal(registry[0].ignored, undefined);
});

test("template diff reports added removed and changed checklist items", () => {
  const diff = diffApprovedTemplate(
    { items: [{ id: "a", label: "신분증", required: true }, { id: "b", label: "도장", required: true }] },
    { items: [{ id: "a", label: "신분증 사본", required: true }, { id: "c", label: "통장 사본", required: false }] }
  );
  assert.deepEqual(diff.map(item => item.kind), ["changed", "removed", "added"]);
});

test("creates a customer checklist from only the approved source version", () => {
  const checklist = createReadinessChecklist({
    customerId: "C-1", contractType: "건물관리 위탁", owner: "김현진", dueDate: "2026-09-10",
    source: { driveFileId: "drive-1", approvedVersion: { revisionId: "rev-2", items: [{ id: "owner-id", label: "건물주 신분증", party: "customer", required: true, evidence: "제3조" }] }, pendingVersion: { revisionId: "rev-3", items: [{ id: "extra", label: "미승인 서류" }] } }
  });
  assert.equal(checklist.sourceRevisionId, "rev-2");
  assert.equal(checklist.items.length, 1);
  assert.equal(checklist.items[0].status, "pending");
  assert.equal(checklist.items[0].evidence, "제3조");
});

test("summarizes required completion without counting not applicable items", () => {
  assert.deepEqual(summarizeReadiness({ items: [
    { required: true, status: "complete" }, { required: true, status: "pending" }, { required: false, status: "not_applicable" }
  ] }), { required: 2, complete: 1, pending: 1, percent: 50 });
});

const assert = require("node:assert/strict");
const test = require("node:test");
const UI = require("../src/contract-readiness-ui");

test("source console shows version state, duplicate warnings, and admin controls", () => {
  const sources = [{ id: "s1", driveFileId: "file_111", title: "계약서.docx", contractType: "청소", approvedVersion: { revisionId: "r1", modifiedAt: "2026-09-01" }, pendingVersion: { revisionId: "r2", modifiedAt: "2026-09-02" }, lastCheckedAt: "2026-09-02", syncError: "" }, { id: "s2", driveFileId: "file_222", title: "계약서.docx", contractType: "건물관리", approvedVersion: { revisionId: "a1" } }];
  const admin = UI.renderSourceConsole(sources, { admin: true });
  assert.match(admin, /동일 제목 2개/);
  assert.match(admin, /지금 확인/);
  assert.match(admin, /변경 승인/);
  assert.match(admin, /보류/);
  assert.match(admin, /r1[\s\S]*r2/);
  const staff = UI.renderSourceConsole(sources, { admin: false });
  assert.doesNotMatch(staff, /data-contract-source-(?:check|approve|defer|register)/);
  assert.match(staff, /승인 기준/);
});

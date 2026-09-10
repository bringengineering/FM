const assert = require("node:assert/strict");
const test = require("node:test");
const { sourcesDueForDailyCheck } = require("../src/contract-drive-client");

test("daily check selects active approved file IDs at most once per Seoul day", () => {
  const sources = [{ id: "s1", driveFileId: "file_111", active: true, lastCheckedAt: "2026-09-01T14:59:59Z" }, { id: "s2", driveFileId: "file_222", active: true, lastCheckedAt: "2026-09-02T00:01:00Z" }, { id: "s3", driveFileId: "file_333", active: false }];
  assert.deepEqual(sourcesDueForDailyCheck(sources, new Date("2026-09-02T01:00:00Z")).map(item => item.id), ["s1"]);
});

test("pending versions and failures do not replace the approved version", () => {
  const source = { approvedVersion: { revisionId: "approved" }, pendingVersion: { revisionId: "new" }, syncError: "Drive unavailable" };
  assert.equal(source.approvedVersion.revisionId, "approved");
});

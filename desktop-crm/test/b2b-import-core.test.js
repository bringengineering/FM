"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/b2b-import-core");

const CTX = { actor: "seocw@bringengineering.com", at: "2026-09-20T00:00:00.000Z", requestId: "11111111-1111-4111-8111-111111111111" };

function rows() {
  return [
    { poolId: "R01", name: "행복공인중개사", phone: "033-1234-5678", source: "중개" },
    { poolId: "M01", name: "튼튼이사", phone: "010 2222 3333", source: "이사" },
    { poolId: "I01", name: "새집인테리어", phone: "01044445555", source: "인테리어" }
  ];
}

test("BL-01 parses rows and keeps all input records", () => {
  const result = Core.classifyCandidates({ rows: rows() });
  assert.equal(result.length, 3);
});

test("BL-02 normalizes phone to digits only", () => {
  assert.equal(Core.normalizePhone("033-1234-5678"), "03312345678");
  assert.equal(Core.normalizePhone("010 2222 3333"), "01022223333");
  assert.equal(Core.normalizePhone("abc"), "");
  assert.equal(Core.normalizePhone("12345"), "");
});

test("BL-03 classifies brand-new candidate as new and selected by default", () => {
  const result = Core.classifyCandidates({ rows: rows() });
  const item = result.find(r => r.poolId === "R01");
  assert.equal(item.status, "new");
  assert.equal(item.selectedByDefault, true);
});

test("BL-04 classifies pool-id or phone match as duplicate, not selected", () => {
  const result = Core.classifyCandidates({
    rows: rows(),
    existingPoolIds: ["R01"],
    existingPhoneCounts: { "01022223333": 1 }
  });
  const byId = result.find(r => r.poolId === "R01");
  const byPhone = result.find(r => r.poolId === "M01");
  assert.equal(byId.status, "duplicate");
  assert.equal(byPhone.status, "duplicate");
  assert.equal(byId.selectedByDefault, false);
});

test("BL-05 classifies missing/invalid rows as error with reasons and not selectable", () => {
  const result = Core.classifyCandidates({
    rows: [
      { poolId: "R99", name: "잘못ID", phone: "01011112222", source: "중개" },
      { poolId: "R02", name: "", phone: "01011112222", source: "중개" },
      { poolId: "R03", name: "번호오류", phone: "123", source: "중개" }
    ]
  });
  assert.equal(result[0].status, "error");
  assert.match(result[0].reasons.join(","), /ID/);
  assert.equal(result[1].status, "error");
  assert.equal(result[2].status, "error");
  assert.equal(result[0].selectable, false);
});

test("BL-06 flags phone matching 2+ existing as review (확인필요)", () => {
  const result = Core.classifyCandidates({
    rows: rows(),
    existingPhoneCounts: { "01022223333": 2 }
  });
  const item = result.find(r => r.poolId === "M01");
  assert.equal(item.status, "review");
  assert.equal(item.selectedByDefault, false);
});

test("BL-07 builds import request with only checked new rows", () => {
  const classified = Core.classifyCandidates({ rows: rows() });
  const req = Core.buildImportRequest(classified, ["R01", "I01"], CTX);
  assert.equal(req.action, "approveB2bImport");
  assert.equal(req.records.length, 2);
  assert.deepEqual(req.records.map(r => r.poolId).sort(), ["I01", "R01"]);
});

test("BL-08 never emits an update/overwrite action and refuses non-new selection", () => {
  const classified = Core.classifyCandidates({ rows: rows(), existingPoolIds: ["R01"] });
  assert.throws(() => Core.buildImportRequest(classified, ["R01"], CTX), /신규/);
  const req = Core.buildImportRequest(classified, ["M01"], CTX);
  assert.equal(req.action, "approveB2bImport");
  assert.ok(!/update|overwrite|덮어/i.test(JSON.stringify(req)));
});

test("BL-09 registers unverified phone at candidate stage only", () => {
  const classified = Core.classifyCandidates({ rows: rows() });
  const req = Core.buildImportRequest(classified, ["R01"], CTX);
  assert.equal(req.records[0].stage, "candidate");
  assert.equal(req.records[0].verified, false);
});

test("BL-10 provides an undo snapshot key and evidence for registration", () => {
  const classified = Core.classifyCandidates({ rows: rows() });
  const req = Core.buildImportRequest(classified, ["R01"], CTX);
  assert.ok(req.snapshotKey);
  assert.equal(req.requestId, CTX.requestId);
  assert.equal(req.records[0].evidence.registeredBy, CTX.actor);
  assert.equal(req.records[0].evidence.registeredAt, CTX.at);
});

test("summarize reports registered / skipped / error counts", () => {
  const classified = Core.classifyCandidates({
    rows: [...rows(), { poolId: "R99", name: "x", phone: "01011112222", source: "중개" }],
    existingPoolIds: ["R01"]
  });
  const req = Core.buildImportRequest(classified, ["M01", "I01"], CTX);
  const sum = Core.summarize(classified, req);
  assert.equal(sum.registered, 2);
  assert.equal(sum.error, 1);
  assert.equal(sum.skipped, classified.length - 2 - 1);
});

test("validateImportRequest accepts a well-formed request", () => {
  const classified = Core.classifyCandidates({ rows: rows() });
  const req = Core.buildImportRequest(classified, ["R01"], CTX);
  const result = Core.validateImportRequest(req);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateImportRequest rejects wrong action, bad id, extra keys, and non-candidate stage", () => {
  assert.equal(Core.validateImportRequest({ action: "updateB2b", requestId: CTX.requestId, records: [] }).valid, false);
  assert.equal(Core.validateImportRequest({ action: "approveB2bImport", requestId: "nope", records: [] }).valid, false);
  const classified = Core.classifyCandidates({ rows: rows() });
  const req = Core.buildImportRequest(classified, ["R01"], CTX);
  assert.equal(Core.validateImportRequest({ ...req, sneaky: 1 }).valid, false);
  assert.equal(Core.validateImportRequest({ ...req, records: [{ ...req.records[0], stage: "qualified" }] }).valid, false);
});

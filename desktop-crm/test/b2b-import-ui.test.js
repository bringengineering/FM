"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/b2b-import-core");
const UI = require("../src/b2b-import-ui");

function classified() {
  return Core.classifyCandidates({
    rows: [
      { poolId: "R01", name: "<b>행복</b>중개", phone: "033-1234-5678", source: "중개" },
      { poolId: "M01", name: "튼튼이사", phone: "01022223333", source: "이사" },
      { poolId: "R99", name: "잘못", phone: "01011112222", source: "중개" }
    ],
    existingPoolIds: ["M01"]
  });
}

test("renders review panel with counts and escapes markup", () => {
  const html = UI.renderReviewPanel(classified(), { role: "admin" });
  assert.match(html, /후보 검토/);
  assert.match(html, /덮어쓰지 않습니다/);
  assert.doesNotMatch(html, /<b>행복<\/b>/);
  assert.match(html, /data-b2b-select/);
});

test("shows 기존 열기 for duplicate and no checkbox for error/duplicate", () => {
  const html = UI.renderReviewPanel(classified(), { role: "admin" });
  assert.match(html, /data-b2b-open-existing="M01"/);
  assert.doesNotMatch(html, /data-b2b-select="M01"/);
  assert.doesNotMatch(html, /data-b2b-select="R99"/);
});

test("non-admin sees no selection controls", () => {
  const html = UI.renderReviewPanel(classified(), { role: "viewer" });
  assert.doesNotMatch(html, /data-b2b-select/);
});

test("collectSelected delegates to core and only registers new rows", () => {
  const req = UI.collectSelected(classified(), ["R01"], { actor: "a@b.com", at: "2026-09-20T00:00:00.000Z", requestId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(req.records.length, 1);
  assert.equal(req.records[0].poolId, "R01");
});

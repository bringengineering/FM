"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const UI = require("../src/drive-import-ui");

const candidate = {
  id: "1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih",
  driveFileId: "1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih",
  fileName: "브링케어 통합 건물 체크리스트_북원로 2475번길 93_260814.pdf",
  fileUrl: "https://drive.google.com/file/d/1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih",
  mimeType: "application/pdf",
  sourceModifiedAt: "2026-08-15T00:00:00.000Z",
  suggested: { name: "북원로2475번길 93", address: "원주시 북원로2475번길 93", manager: "황우중", type: "다가구", status: "영업후보", unitCount: 0, memo: "Drive 원본" },
  confidence: { name: "high", address: "medium", manager: "medium" },
  warnings: ["손글씨 값은 원본 확인 필요"],
  status: "pending"
};

test("sanitizes only supported Drive review candidates", () => {
  const result = UI.sanitizeCandidates({
    [candidate.id]: candidate,
    "../bad": candidate,
    image: { ...candidate, id: "image", driveFileId: "image", mimeType: "image/jpeg" }
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].suggested.name, "북원로2475번길 93");
});

test("renders original link and admin controls without leaking markup", () => {
  const html = UI.renderReviewPanel([candidate, { ...candidate, id: "x", driveFileId: "x", fileName: "<img src=x>", status: "approved" }], { role: "admin" });
  assert.match(html, /Drive 검토 대기/);
  assert.match(html, /data-drive-import-approve/);
  assert.match(html, /data-drive-import-reject/);
  assert.match(html, /data-drive-import-open/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /status="approved"/);
});

test("member and viewer can read but cannot approve or reject", () => {
  for (const role of ["member", "viewer"]) {
    const html = UI.renderReviewPanel([candidate], { role });
    assert.match(html, /북원로2475번길 93/);
    assert.doesNotMatch(html, /data-drive-import-approve|data-drive-import-reject/);
  }
});

test("builds closed approval and rejection requests", () => {
  const approved = UI.buildDecisionRequest("approve", candidate, {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    name: "북원로2475번길 93",
    address: "원주시 북원로2475번길 93",
    manager: "황우중",
    type: "다가구",
    status: "영업후보",
    unitCount: "0",
    memo: "확인"
  });
  assert.deepEqual(Object.keys(approved).sort(), ["action", "approved", "driveFileId", "requestId"]);
  assert.equal(approved.action, "approveDriveImport");
  const rejected = UI.buildDecisionRequest("reject", candidate, { requestId: "123e4567-e89b-42d3-a456-426614174001", reason: "재확인" });
  assert.deepEqual(Object.keys(rejected).sort(), ["action", "driveFileId", "reason", "requestId"]);
  assert.equal(rejected.action, "rejectDriveImport");
});

test("wires isolated load and decision IPC without shared-store persistence", () => {
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const remote = fs.readFileSync(path.join(__dirname, "../src/remote.js"), "utf8");
  assert.match(preload, /loadDriveImportCandidates/);
  assert.match(preload, /decideDriveImport/);
  assert.match(main, /crm:drive-import-candidates-load/);
  assert.match(main, /crm:drive-import-decision/);
  assert.match(remote, /async loadDriveImportCandidates\(/);
  assert.match(remote, /async decideDriveImport\(/);
  assert.doesNotMatch(remote.match(/const SHARED_COLLECTIONS[\s\S]*?\]\);/)[0], /driveImportCandidates/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === '"' || current === "'" || current === "`") { quote = current; continue; }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const context = { String, Number, Date, RegExp, Array, Object };
vm.createContext(context);
vm.runInContext([
  extractFunction("extractOnboardingField_"),
  extractFunction("extractOnboardingOwnerName_"),
  extractFunction("onboardingBuildingFromFileName_"),
  extractFunction("isSupportedDriveImportMime_"),
  extractFunction("buildDriveImportCandidate_"),
  extractFunction("mergeDriveImportCandidate_")
].join("\n"), context);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

assert.equal(context.isSupportedDriveImportMime_(DOCX), true);
assert.equal(context.isSupportedDriveImportMime_(PDF), true);
assert.equal(context.isSupportedDriveImportMime_("application/vnd.google-apps.folder"), false);
assert.equal(context.isSupportedDriveImportMime_("image/jpeg"), false);

const candidate = context.buildDriveImportCandidate_({
  driveFileId: "1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih",
  fileName: "브링케어 통합 건물 체크리스트_북원로 2475번길 93_260814.pdf",
  fileUrl: "https://drive.google.com/file/d/1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih",
  mimeType: PDF,
  sourceFolderId: "folder_1",
  sourceModifiedAt: "2026-08-15T00:00:00.000Z",
  sourceHash: "abc123",
  text: [
    "건물명: 북원로2475번길 93",
    "주소: 원주시 북원로2475번길 93",
    "담당자: 황우중",
    "연락처: 010-1234-5678",
    "보증금: 500만원",
    "출입 비밀번호: 1234"
  ].join("\n")
});

assert.equal(candidate.id, "1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih");
assert.equal(candidate.status, "pending");
assert.equal(candidate.suggested.name, "북원로2475번길 93");
assert.equal(candidate.suggested.address, "원주시 북원로2475번길 93");
assert.equal(candidate.suggested.manager, "황우중");
assert.equal(candidate.sourceHash, "abc123");
assert.deepEqual(Object.keys(candidate.suggested).sort(), ["address", "manager", "memo", "name", "status", "type", "unitCount"]);
assert.doesNotMatch(JSON.stringify(candidate), /010-1234-5678|500만원|1234/);

const pdfFallback = context.buildDriveImportCandidate_({
  driveFileId: "pdf_without_text",
  fileName: "북원로 2475번길 93_체크리스트.pdf",
  fileUrl: "https://drive.google.com/file/d/pdf_without_text",
  mimeType: PDF,
  sourceFolderId: "folder_1",
  sourceModifiedAt: "2026-08-15T00:00:00.000Z",
  sourceHash: "fallback-hash",
  text: "",
  extractionWarning: "PDF OCR 실패"
});

assert.equal(pdfFallback.suggested.name, "북원로 2475번길 93");
assert.equal(pdfFallback.warnings.includes("PDF OCR 실패"), true);
assert.equal(pdfFallback.confidence.name, "medium");

const unchanged = context.mergeDriveImportCandidate_(candidate, { ...candidate });
assert.equal(unchanged.changed, false);
assert.equal(unchanged.candidate.status, "pending");

const pendingChanged = context.mergeDriveImportCandidate_(candidate, {
  ...candidate,
  sourceHash: "new-hash",
  sourceModifiedAt: "2026-08-16T00:00:00.000Z",
  suggested: { ...candidate.suggested, address: "원주시 북원로 2475번길 93" }
});
assert.equal(pendingChanged.changed, true);
assert.equal(pendingChanged.candidate.status, "pending");
assert.equal(pendingChanged.candidate.createdAt, candidate.createdAt);

const approvedChanged = context.mergeDriveImportCandidate_({
  ...candidate,
  status: "approved",
  approvedAt: "2026-08-16T01:00:00.000Z",
  approvedByUid: "admin_uid",
  crmBuildingId: "building_1"
}, {
  ...candidate,
  sourceHash: "third-hash",
  sourceModifiedAt: "2026-08-17T00:00:00.000Z"
});
assert.equal(approvedChanged.changed, true);
assert.equal(approvedChanged.candidate.status, "stale");
assert.equal(approvedChanged.candidate.approvedAt, "2026-08-16T01:00:00.000Z");
assert.equal(approvedChanged.candidate.crmBuildingId, "building_1");

assert.doesNotMatch(
  extractFunction("syncDriveCrmImportCandidates_"),
  /firebaseCaseSettingsUrl_\("paymentBuildings"\)|"put"/,
  "새 후보 동기화는 기존 입금관리 전체 PUT을 사용하지 않는다"
);

console.log("Drive CRM import candidate tests passed");

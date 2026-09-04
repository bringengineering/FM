const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeBackupPath,
  parsePathList,
  buildManifest,
  DEFAULT_PATHS,
} = require("./export-rtdb.js");

test("normalizeBackupPath는 앞뒤 슬래시와 공백을 정리한다", () => {
  assert.equal(normalizeBackupPath("  /cases/ "), "cases");
  assert.equal(normalizeBackupPath("workflow"), "workflow");
});

test("normalizeBackupPath는 위험한 경로를 거부한다", () => {
  for (const bad of ["", "   ", "a/b", "../etc", "cases.json", "a b", "$ref", "#x"]) {
    assert.throws(() => normalizeBackupPath(bad), /백업 경로|빈 백업/);
  }
});

test("parsePathList는 기본 경로를 사용한다", () => {
  assert.deepEqual(parsePathList(""), DEFAULT_PATHS);
  assert.deepEqual(parsePathList(undefined), DEFAULT_PATHS);
});

test("parsePathList는 쉼표 목록을 정리하고 중복을 제거한다", () => {
  assert.deepEqual(parsePathList("cases, workflow ,,cases"), ["cases", "workflow"]);
});

test("parsePathList는 잘못된 항목이 있으면 실패한다", () => {
  assert.throws(() => parsePathList("cases,a/b"), /백업 경로/);
});

test("buildManifest는 합계와 빈 경로 표시를 계산한다", () => {
  const manifest = buildManifest(
    [
      { path: "cases", file: "cases.json", bytes: 100, sha256: "aa" },
      { path: "workflow", file: "workflow.json", bytes: 4, sha256: "bb" },
    ],
    { generatedAt: "2026-01-01T00:00:00.000Z", databaseUrl: "https://example.test" }
  );
  assert.equal(manifest.totalBytes, 104);
  assert.equal(manifest.databaseUrl, "https://example.test");
  assert.equal(manifest.files[0].empty, false);
  assert.equal(manifest.files[1].empty, true, "4바이트 이하는 비어 있음으로 표시");
});

test("기본 백업 경로에 실제 데이터 트리가 모두 들어 있다", () => {
  // 하나라도 빠지면 그 영역은 사고 시 복구할 수 없다.
  for (const required of ["workflow", "cases", "caseSettings", "crmCompany",
                          "fieldPlatform", "paymentCalendars", "signage"]) {
    assert.ok(DEFAULT_PATHS.includes(required), `${required} 이 기본 백업 경로에 있어야 한다`);
  }
});

test("경로가 모두 비어 있으면 바이트 합계가 0이 아니어도 비어 있음으로 본다", () => {
  // Firebase 는 없는 경로에도 본문 "null"(4바이트)을 돌려준다.
  const manifest = buildManifest([
    { path: "cases", file: "cases.json", bytes: 4, sha256: "a" },
    { path: "workflow", file: "workflow.json", bytes: 4, sha256: "b" },
  ]);
  assert.equal(manifest.totalBytes, 8, "합계만 보면 0이 아니라 성공으로 오인된다");
  assert.deepEqual(manifest.files.map((f) => f.empty), [true, true],
    "내용 없는 경로는 모두 empty 로 표시돼야 한다");
  assert.equal(manifest.files.some((f) => !f.empty), false,
    "실제 내용이 있는 경로가 하나도 없다고 판정돼야 한다");
});

"use strict";
// 2026-11-03 실제 CRM 처음부터 발송까지 테스트에서 나온 문제들의 회귀 시험.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../src/work-report-core");
const O = require("../src/jpeg-orientation");
const { createOwnerReportHtml } = require("../src/work-report-owner-pdf");
const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

test("작업일을 고치면 초안 본문 속 옛 날짜도 고친다 — 다른 날짜는 그대로", () => {
  const text = "2026년 11월 03일에 진행된 작업. 11월 3일 방문, 2026-11-03 기록, 2026. 11. 3. 확인, 2025년 11월 03일과 2026년 11월 30일은 그대로";
  assert.equal(R.retargetDate(text, "2026-11-03", "2026-10-29"),
    "2026년 10월 29일에 진행된 작업. 10월 29일 방문, 2026-10-29 기록, 2026. 10. 29. 확인, 2025년 11월 03일과 2026년 11월 30일은 그대로");
  assert.equal(R.retargetDate("날짜 없음", "2026-11-03", "2026-10-29"), "날짜 없음");
  assert.equal(R.retargetDate(text, "", "2026-10-29"), text);
  assert.match(app, /R\.retargetDate\(String\(raw\.summary \|\| ""\), writtenFor, String\(raw\.workDate\)\)/);
  // AI 가 쓴 날짜를 기억해 그 날짜를 기준으로 고친다.
  assert.match(app, /reportState\.aiSummaryDate = \{ id: draft\.id, date: draft\.workDate \}/);
  assert.match(app, /const writtenFor = aiDate \|\| previous\.workDate/);
  assert.match(app, /form\.elements\.summary\.value = moved/);
  // 저장을 기다리지 않고 작업일을 바꾸는 즉시 반영한다.
  assert.match(app, /if \(event\.target\.matches\('\[data-report-form\] \[name="workDate"\]'\)\) \{\n[^\n]*\n\s*preserveReportDraft\(\);/);
});

test("저장 직후 발송 확인 창은 방금 저장한 동기화 변경으로 취소되지 않는다", () => {
  const start = app.indexOf('title: "저장되었습니다.", description: "고객 알림을 보내시겠습니까?"');
  assert.ok(start > 0);
  assert.match(app.slice(start, start + 900), /remoteSafe: true\}\)/);
  assert.match(app, /if \(confirmed && pendingRemoteStore && !pending\.remoteSafe\)/);
  assert.match(app, /activeConfirmation = \{ resolve, previousFocus, remoteSafe: config\.remoteSafe === true \}/);
  // 다른 확인 창의 보호는 그대로다.
  assert.equal((app.match(/remoteSafe: true/g) || []).length, 1);
});

test("AI 짝 찾기는 구역 세 곳씩 함께 묻는다", () => {
  const start = app.indexOf("async function matchReportPairsWithAi(");
  const body = app.slice(start, app.indexOf("\n  function applyReportDrivePlan(", start));
  assert.match(body, /Array\.from\(\{ length: Math\.min\(3, queue\.length\) \}/);
  assert.doesNotMatch(body, /for \(const request of requests\)/);
});

function jpegWithOrientation(value, little = false) {
  const tiff = Buffer.alloc(26);
  tiff.write(little ? "II" : "MM", 0, "latin1");
  const u16 = (v, at) => (little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const u32 = (v, at) => (little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  u16(42, 2); u32(8, 4); u16(1, 8); u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(value, 18); u32(0, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, payload, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}

test("EXIF 방향을 읽는다(빅·리틀 엔디언, 표시 없음은 1)", () => {
  for (const value of [1, 3, 6, 8]) {
    assert.equal(O.readOrientation(jpegWithOrientation(value)), value);
    assert.equal(O.readOrientation(jpegWithOrientation(value, true)), value);
  }
  assert.equal(O.readOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1);
  assert.equal(O.readOrientation(Buffer.from("not a jpeg")), 1);
  assert.equal(O.readOrientation(jpegWithOrientation(9)), 1);
});

test("화소를 EXIF 방향대로 돌린다 — 6은 시계 방향 90도", () => {
  // 3x2 이미지, 화소 값 = 번호(0..5): 0 1 2 / 3 4 5
  const px = n => [n, n, n, 255];
  const bitmap = Buffer.from([0, 1, 2, 3, 4, 5].flatMap(px));
  const read = r => Array.from({ length: r.width * r.height }, (_, i) => r.bitmap[i * 4]);
  const six = O.orientBitmap(bitmap, 3, 2, 6);
  assert.deepEqual([six.width, six.height], [2, 3]);
  assert.deepEqual(read(six), [3, 0, 4, 1, 5, 2]);
  const eight = O.orientBitmap(bitmap, 3, 2, 8);
  assert.deepEqual(read(eight), [2, 5, 1, 4, 0, 3]);
  const three = O.orientBitmap(bitmap, 3, 2, 3);
  assert.deepEqual(read(three), [5, 4, 3, 2, 1, 0]);
  assert.equal(O.orientBitmap(bitmap, 3, 2, 1).bitmap, bitmap);
});

test("PDF·AI 용 사진 모두 EXIF 방향대로 세운다", () => {
  assert.match(main, /const JpegOrientation = require\("\.\/jpeg-orientation"\)/);
  const pdf = main.slice(main.indexOf("function workReportPdfJpeg("), main.indexOf("async function createWorkReportPdfArtifact("));
  assert.match(pdf, /JpegOrientation\.uprightImage\(nativeImage, image, JpegOrientation\.readOrientation\(content\)\)/);
  const ai = main.slice(main.indexOf("function safeClassificationJpeg("), main.indexOf("function safeClassificationJpeg(") + 1600);
  assert.match(ai, /JpegOrientation\.readOrientation\(sourceBuffer\)/);
  assert.match(ai, /JpegOrientation\.uprightImage\(nativeImage, source\.resize\(/);
});

test("남은 사진이 없는 단계는 '0장' 으로 적지 않는다", () => {
  const report = R.normalizeReport({ id: "wr_x", kind: "common", buildingId: "b", buildingName: "예시", workDate: "2026-10-29", updatedAt: "2026-10-29T00:00:00Z" });
  const item = report.items[1];
  item.before = [{ id: "b1", driveFileId: "b1", pairId: "p1" }, { id: "b2", driveFileId: "b2" }];
  item.after = [{ id: "a1", driveFileId: "a1", pairId: "p1" }];
  const html = createOwnerReportHtml(R.normalizeReport(report));
  assert.ok(html.includes("같은 장소로 확인된 1쌍을 나란히 비교하고, 나머지 작업 전 1장은 아래에 단계별로 실었습니다."));
  assert.doesNotMatch(html, /작업 후 0장은/);
});

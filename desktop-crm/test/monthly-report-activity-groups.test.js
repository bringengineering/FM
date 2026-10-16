"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/building-report-core");
const PDF = require("../src/building-report-pdf");
const Drive = require("../src/building-monthly-report-drive");
const AI = require("../src/building-monthly-report-ai");
const Automation = require("../src/monthly-report-automation");
const { fingerprint } = require("../src/monthly-photo-fingerprint");

const photo = (day, number, activityName = "폐기물처리") => ({
  id: `photo_${day}_${number}_${activityName}`, date: `2026-10-${String(day).padStart(2, "0")}`, activityName,
  caption: `분리된 물품 장면 ${number}`, dataUrl: `data:image/jpeg;base64,${Buffer.from([255, 216, 255, day, number]).toString("base64")}`,
});
const input = { building: { id: "synthetic-building", name: "예시건물" }, month: "2026-10", store: {} };

test("31일 x 2장 = 62장을 날짜순으로 모두 표시하고 월 12장으로 자르지 않는다", () => {
  const photos = Array.from({ length: 31 }, (_, i) => [photo(i + 1, 1), photo(i + 1, 2)]).flat().reverse();
  const report = Core.buildBuildingMonthlyReport({ ...input, photos });
  assert.equal(report.photos.length, 62);
  assert.equal(report.activities.length, 31);
  assert.deepEqual(report.activities.map(a => a.date), Array.from({ length: 31 }, (_, i) => photo(i + 1, 1).date));
  const html = PDF.createBuildingReportHtml(report);
  assert.equal((html.match(/<figure>/gu) || []).length, 62);
  assert.equal((html.match(/class="photo-group"/gu) || []).length, 31);
  assert.ok(html.indexOf("2026-10-01</time>") < html.indexOf("2026-10-31</time>"));
  assert.match(html, /BRING CARE/u);
  assert.match(html, /2026-10-31 · 폐기물처리/u);
});

test("같은 날 서로 다른 활동은 별도 묶음이고 각 활동은 최대 3장이다", () => {
  const photos = [1, 2, 3, 4].map(n => photo(2, n)).concat([5, 6, 7, 8].map(n => photo(2, n, "공용부청소")));
  const groups = Core.groupPhotos(photos);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => group.photos.length === 3));
  assert.deepEqual(new Set(groups.map(g => g.activityName)), new Set(["폐기물처리", "공용부청소"]));
});

test("한 장뿐인 활동은 억지로 두 장으로 늘리지 않고 중복 사진은 날짜가 달라도 제거한다", () => {
  const original = photo(2, 1);
  const selected = Core.representativePhotos([null, "invalid", original, { ...original, id: "copy", date: "2026-10-03" }, photo(31, 2)]);
  assert.equal(selected.length, 2);
  assert.equal(Core.groupPhotos(selected)[0].photos.length, 1);
});

test("비슷한 장면은 해시·색조·비율을 함께 확인하고 다른 장면은 남긴다", () => {
  const original = { ...photo(2, 1), sceneHash: "0".repeat(64), sceneTone: [100, 110, 120], sceneRatio: 1.5 };
  const near = { ...photo(2, 2), sceneHash: "1" + "0".repeat(63), sceneTone: [102, 108, 125], sceneRatio: 1.52 };
  assert.equal(Core.similarPhoto(original, near), true);
  assert.equal(Core.similarPhoto(original, { ...near, sceneHash: "1".repeat(64) }), false);
  assert.equal(Core.similarPhoto(original, { ...near, sceneTone: [250, 250, 250] }), false);
  assert.equal(Core.similarPhoto(original, { ...near, sceneRatio: 0.67 }), false);
  assert.equal(Core.similarPhoto(original, { ...near, sceneTone: [NaN, 1, 2] }), false);
  assert.equal(Core.representativePhotos([original, near]).length, 1);
});

test("선택되지 않은 날짜의 활동도 유지하고 사진만으로 완료 건수를 만들지 않는다", () => {
  const report = Core.buildBuildingMonthlyReport({ ...input,
    activityEvidence: [photo(31, 1), photo(2, 1), { date: "2026-10-32", activityName: "잘못된 날짜" }, { date: "2026-09-01", activityName: "다른 월" }, null],
    photos: [photo(2, 1)],
    manualWorks: [{ date: "2026-10-02", kind: "폐기물처리", summary: "배출 완료 기록", done: true }],
  });
  assert.equal(report.activities.length, 2);
  assert.equal(report.summary.workCount, 1);
  assert.equal(report.summary.doneCount, 1);
  assert.equal(report.activities[0].statusLabel, "완료");
  assert.equal(report.activities[1].statusLabel, "작업 결과 확인 필요");
  assert.equal(report.activities[1].done, false);
});

test("후보 120장 뒤에 붙인 선택 사진 설명도 날짜별 내역과 AI에 반영한다", () => {
  const evidence = Array.from({ length: 120 }, (_, i) => ({ ...photo(i % 30 + 1, i), caption: "" }));
  const report = Core.buildBuildingMonthlyReport({ ...input, activityEvidence: evidence, photos: [{ ...photo(31, 1), caption: "배출 장소의 분리된 물품" }] });
  assert.equal(report.activities.length, 31);
  assert.ok(report.activities.at(-1).observations.includes("배출 장소의 분리된 물품"));
  const prompt = AI.promptForBuildingMonthlyNarrative(AI.publicReportSource(report, ""));
  assert.ok(prompt.length <= 13000);
  assert.match(prompt, /2026-10-31/u);
  assert.match(prompt, /폐기물처리/u);
  assert.match(prompt, /배출 장소의 분리된 물품/u);
  assert.match(prompt, /다른 작업으로 바꾸지 마세요/u);
});

test("긴 설명부터 압축하고 31일 전체 활동명과 날짜는 AI 입력에 남긴다", () => {
  const report = { ...input, activities: Array.from({ length: 31 }, (_, i) => ({ date: photo(i + 1, 1).date, kind: "폐기물처리", statusLabel: "작업 결과 확인 필요", summary: "기록 ".repeat(170), observations: ["관찰 ".repeat(100)] })) };
  const source = AI.publicReportSource(report, "확정된 공용부 청소");
  const prompt = AI.promptForBuildingMonthlyNarrative(source);
  assert.ok(prompt.length <= 13000);
  for (let i = 1; i <= 31; i++) assert.ok(prompt.includes(photo(i, 1).date));
  assert.notEqual(AI.prepareBuildingMonthlyNarrative(report).fingerprint, AI.prepareBuildingMonthlyNarrative({ ...report, activities: [] }).fingerprint);
});

test("파일 날짜_건물명(활동명)을 정확히 읽고 활동명을 일반 분류로 바꾸지 않는다", async () => {
  assert.deepEqual(Drive.parseActivityFileName("20261002_예시건물(폐기물처리).JPG", "2026-10", "예시건물", ""), { date: "2026-10-02", activityName: "폐기물처리" });
  assert.equal(Drive.parseActivityFileName("20261002_다른건물(폐기물처리).jpg", "2026-10", "예시건물", ""), null);
  assert.equal(Drive.parseActivityFileName("20261032_예시건물(폐기물처리).jpg", "2026-10", "예시건물", ""), null);
  const result = await Drive.findActivityFolders({ root: { id: "root" }, month: "2026-10", buildingName: "예시건물", list: async () => ({ folders: [], files: [{ id: "file", name: "20261002_예시건물(폐기물처리).jpg", mimeType: "image/jpeg" }] }) });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].parsed.activityName, "폐기물처리");
});

test("활동명과 캡션은 PDF에서 HTML로 실행되지 않는다", () => {
  const report = Core.buildBuildingMonthlyReport({ ...input, photos: [{ ...photo(2, 1), activityName: '<img src=x onerror=alert(1)>', caption: '<script>alert(1)</script>' }] });
  const html = PDF.createBuildingReportHtml(report);
  assert.doesNotMatch(html, /<script>|<img src=x/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /default-src 'none'/u);
});

test("여러 24장 묶음에 걸친 중복 장면도 초안 전에 제거한다", async () => {
  const candidates = Array.from({ length: 31 }, (_, i) => photo(i + 1, 1));
  const result = await Automation.run({ find: async () => ({ ok: true, photos: candidates }), isCurrent: () => true,
    select: async batch => ({ ok: true, selected: batch.map(p => ({ id: p.id, caption: p.caption, imageHash: p.date.endsWith("31") ? candidates[0].id : p.id })) }),
    draft: async (selected, evidence) => { assert.equal(evidence.length, 31); assert.equal(selected.length, 30); return { ok: true, narrative: { summary: "검토 초안" } }; },
  });
  assert.equal(result.photos.length, 30);
});

test("사진 지문은 디코딩된 축소 픽셀과 원본 비율을 사용한다", () => {
  const bytes = Buffer.alloc(9 * 8 * 4, 100);
  const nativeImage = { createFromDataURL: () => ({ isEmpty: () => false, getSize: () => ({ width: 600, height: 400 }), resize: options => { assert.equal(options.width, 9); assert.equal(options.height, 8); return { toBitmap: () => bytes }; } }) };
  const result = fingerprint(photo(2, 1).dataUrl, nativeImage);
  assert.match(result.imageHash, /^[a-f0-9]{64}$/u);
  assert.equal(result.sceneHash, "0".repeat(64));
  assert.equal(result.sceneRatio, 1.5);
  assert.deepEqual(result.sceneTone, [100, 100, 100]);
  assert.throws(() => fingerprint("invalid", { createFromDataURL: () => ({ isEmpty: () => true }) }), /PHOTO_PREVIEW_FAILED/u);
});

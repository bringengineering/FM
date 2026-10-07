"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/work-report-core");
const {createWorkReportHtml, workReportPdfPhotos} = require("../src/work-report-pdf");
const {photoPages} = require("../src/work-report-owner-pdf");
const photo = id => ({id, caption: `설명 ${id}`});
const seed = () => Core.normalizeReport({id: "qa_report", kind: "common", buildingName: "예시 건물", workDate: "2026-10-06"});

test("건물주용은 월간보고서 계열 디자인이고 견적서 격자·인감·진척도를 넣지 않는다", () => {
  const report = seed(); report.items[0].during = [photo("sample")];
  const html = createWorkReportHtml(report);
  for (const label of ["BRING CARE", "이번 작업 요약", "작업 정보", "사진 기록 요약", "구역별 작업 기록", "추가 안내", "#eaf6fd", "#80cdec", "작업일 2026-10-06"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /진척도|완료 미확정|#1454D8|대표자 날인|양식 미리보기|class="stamp"/);
  for (const line of Core.NOTICES) assert.ok(html.includes(line));
  assert.doesNotMatch(html, /청소 완료|오염 제거 완료/);
});

test("승인 시안의 3구역 14사진은 요약과 구역별 3개 사진 묶음으로 나온다", () => {
  const report = seed();
  for (const [i, during] of [2, 2, 4].entries()) {
    const item = report.items[i];
    item.before = [photo(`before${i}`)]; item.after = [photo(`after${i}`)];
    item.during = Array.from({length: during}, (_, n) => photo(`during${i}_${n}`));
  }
  const html = createWorkReportHtml(report);
  assert.equal(workReportPdfPhotos(report).length, 14);
  assert.equal((html.match(/class="photo-page /g) || []).length, 3);
  assert.equal((html.match(/<figure>/g) || []).length, 14);
  assert.equal((html.match(/photo-page six/g) || []).length, 1);
});

test("100장의 불균형한 전중후 사진을 중복·누락 없이 최대6장 단위로 나눈다", () => {
  const report = seed(), item = report.items[0];
  item.before = Array.from({length: 31}, (_, n) => photo(`before${n}`));
  item.after = Array.from({length: 8}, (_, n) => photo(`after${n}`));
  item.during = Array.from({length: 61}, (_, n) => photo(`during${n}`));
  const pages = photoPages(item);
  assert.equal(pages.length, 17); assert.ok(pages.every(page => page.length <= 6));
  assert.deepEqual(pages[0].slice(0, 4).map(p => p.photo.id), ["before0", "after0", "before1", "after1"]);
  const photos = workReportPdfPhotos(report);
  const images = Object.fromEntries(photos.map(p => [p.id, `data:image/jpeg;base64,${Buffer.from(p.id).toString("base64")}`]));
  const html = createWorkReportHtml(report, "owner", {images});
  for (const source of Object.values(images)) assert.equal(html.split(`src="${source}"`).length - 1, 1);
  assert.equal((html.match(/<figure>/g) || []).length, 100);
});

test("기록·미실시·일부·완료와 긴 문구를 보존하며 사진에서 완료를 추측하지 않는다", () => {
  const report = seed();
  report.summary = "긴 작업 요약 ".repeat(150) + "요약끝";
  report.followUp = "긴 후속 안내 ".repeat(150) + "후속끝";
  report.items[0].note = "기록 메모 <script> ".repeat(20) + "메모끝";
  report.items[1].status = "skipped"; report.items[1].note = "기상 조건으로 미실시";
  report.items[2].status = "partial"; report.items[2].note = "상층은 후속 방문";
  report.items[3].status = "done";
  const html = createWorkReportHtml(report);
  for (const value of ["요약끝", "후속끝", "메모끝", "기상 조건으로 미실시", "상층은 후속 방문", "&lt;script&gt;", "완료"]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /<script>|text-overflow:ellipsis|overflow:hidden|max-height:/);
});

test("사진이 없어도 항목은 남고 외부·로컬·SVG 이미지는 출력하지 않는다", () => {
  const report = seed(); report.items[0].during = [photo("a")];
  for (const source of ["https://example.com/photo.jpg", "file:///private.jpg", "data:image/svg+xml;base64,AAAA", 'data:image/jpeg;base64,AAAA" onerror="bad']) {
    const html = createWorkReportHtml(report, "owner", {images: {a: source}});
    assert.doesNotMatch(html, /<img/); assert.match(html, /사진 없음/);
    assert.ok(html.includes(report.items[0].label));
  }
});

test("긴 캡션과 구역명은 한 장의 사진 수를 줄여 제목과 설명 공간을 확보한다", () => {
  const item = seed().items[0];
  item.during = Array.from({length: 18}, (_, i) => ({id: `p${i}`, caption: "긴 설명 ".repeat(20)}));
  assert.deepEqual(photoPages(item).map(page => page.length), [4, 4, 4, 4, 2]);
  item.label = "긴 구역 이름 ".repeat(5);
  assert.ok(photoPages(item).every(page => page.length <= 2));
});

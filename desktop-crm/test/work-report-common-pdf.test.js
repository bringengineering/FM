"use strict";
// 공용부 청소 보고서 = '공용부 활동 결과보고서' 양식(2026-11).
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/work-report-core");
const { createOwnerReportHtml } = require("../src/work-report-owner-pdf");
const { numberRanges, PER_PAGE } = require("../src/work-report-common-pdf");

const jpeg = "data:image/jpeg;base64,/9j/4AAQ";
const report = (items, extra = {}) => Core.normalizeReport({ id: "common_fixture", kind: "common", buildingId: "b1", buildingName: "햇빛빌라", siteAddress: "예시시 예시로 7", workDate: "2026-11-09", items, ...extra });
const photos = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

test("공용부 구역은 양식의 9개이고 엘리베이터·주차장만 고를 때 넣는다", () => {
  assert.deepEqual(Core.itemCatalogFor("common").map(item => item.label), ["출입구", "승강기", "복도", "계단", "창틀", "소방 설비", "공용부 설비", "주차장", "분리수거장"]);
  assert.deepEqual(Core.itemCatalogFor("common").filter(item => item.optional).map(item => item.key), ["elevator", "parking"]);
});

test("예전 16개 구역의 사진·메모는 지금 구역으로 합쳐지고 버려지지 않는다", () => {
  const saved = report([
    { key: "handrail", status: "done", note: "난간 닦음", after: [{ id: "h1" }] },
    { key: "stairs", note: "계단 물걸레", after: [{ id: "s1" }] },
    { key: "glass", before: [{ id: "g1" }] },
    { key: "drain", after: [{ id: "d1" }] }, { key: "lighting", after: [{ id: "l1" }] }, { key: "rooftop", after: [{ id: "r1" }] },
    { key: "walls", after: [{ id: "w1" }] }, { key: "final", after: [{ id: "f1" }] }, { key: "yard", after: [{ id: "y1" }] },
  ]);
  const by = key => saved.items.find(item => item.key === key);
  assert.equal(Core.photoCount(saved), 9);
  assert.deepEqual(by("stairs").after.map(p => p.id), ["h1", "s1"]);
  assert.equal(by("stairs").note, "난간 닦음 / 계단 물걸레");
  assert.equal(by("stairs").status, "done");
  assert.deepEqual(by("windows").before.map(p => p.id), ["g1"]);
  assert.deepEqual(by("fixtures").after.map(p => p.id), ["d1", "l1", "r1"]);
  assert.deepEqual(by("corridor").after.map(p => p.id), ["w1", "f1"]);
  assert.deepEqual(by("parking").after.map(p => p.id), ["y1"]);
});

test("양식 순서: 표지 → 현장 기록 개요 → 3×3 사진 기록, 구역 순서대로 번호를 매긴다", () => {
  const value = report([{ key: "entrance", after: photos("e", 3) }, { key: "stairs", after: photos("s", 7) }, { key: "fire", after: photos("f", 2) }]);
  const images = Object.fromEntries(["e0", "s3", "f1"].map(id => [id, jpeg]));
  const html = createOwnerReportHtml(value, { images, includeEmptyAreas: true });
  for (const text of ["공용부 활동 결과보고서", "햇빛빌라", "2026. 11. 09.", "공용부 현장 기록 개요", "1. 현장 기본정보", "2. 사진 확인 범위 및 안내", "3. 구역별 사진 현황", "- 이 상 -"]) assert.ok(html.includes(text), text);
  assert.match(html, /<th>사진 수<\/th><td>12장<\/td>/);
  assert.match(html, /<td>출입구<\/td><td>3<\/td><td>1–3<\/td>/);
  assert.match(html, /<td>계단<\/td><td>7<\/td><td>4–10<\/td>/);
  assert.match(html, /<td>소방 설비<\/td><td>2<\/td><td>11–12<\/td>/);
  assert.match(html, /<td>복도<\/td><td>-<\/td><td>-<\/td>/);
  assert.equal((html.match(/class="photo-page"/g) || []).length, Math.ceil(12 / PER_PAGE));
  assert.match(html, /촬영일: 2026\. 11\. 09\.  \/  사진 1–9/);
  assert.match(html, /현장 사진 기록 \(계속\)<\/td><td class="sec-side">촬영일: 2026\. 11\. 09\.  \/  사진 10–12/);
  assert.match(html, /사진 12&nbsp;&nbsp;\|&nbsp;&nbsp;<b>소방 설비<\/b>/);
  assert.equal((html.match(/class="pic"><div><img src="data:image\/jpeg/g) || []).length, 3);
  assert.equal((html.match(/사진 없음/g) || []).length, 9);
  assert.doesNotMatch(html, /작업 전|작업 후|귀하|class="pair"/);
});

test("외부·SVG 이미지는 싣지 않고, 고객 단위 보고서는 고객 이름 대신 현장 주소를 쓴다", () => {
  const value = report([{ key: "entrance", after: [{ id: "x" }, { id: "y" }] }], { buildingId: "", customerId: "c1", buildingName: "홍길동_별명집" });
  const html = createOwnerReportHtml(value, { images: { x: "https://evil.example/x.jpg", y: "data:image/svg+xml;base64,PHN2Zz4=" } });
  assert.doesNotMatch(html, /evil\.example|svg\+xml|홍길동/);
  assert.ok(html.includes("예시시 예시로 7"));
});

test("사진이 없으면 사진 쪽 없이 개요에서 끝내고, 사진 번호는 구간으로 줄인다", () => {
  const html = createOwnerReportHtml(report([]), { includeEmptyAreas: true });
  assert.doesNotMatch(html, /class="photo-page"/);
  assert.ok(html.includes("- 이 상 -"));
  assert.equal(numberRanges([1, 2, 3, 5, 7, 8]), "1–3, 5, 7–8");
});

test("예전 구역을 합치면 지금 구역 이름을 쓰고, 실제로 한 상태(완료)가 '못 함'보다 앞선다", () => {
  const value = report([
    { key: "drain", label: "배수구·트렌치", status: "skipped", note: "배수구 없음", after: [{ id: "d" }] },
    { key: "fixtures", label: "공용 설비·게시판", status: "done", after: [{ id: "f" }] },
    { key: "yard", label: "마당·외부 바닥", after: [{ id: "y" }] },
  ]);
  const by = key => value.items.find(item => item.key === key);
  assert.equal(by("fixtures").label, "공용부 설비");
  assert.equal(by("fixtures").status, "done");
  assert.equal(by("parking").label, "주차장");
  const html = createOwnerReportHtml(value, {});
  assert.doesNotMatch(html, /배수구·트렌치|마당·외부 바닥|공용 설비·게시판/);
});

test("사진·메모가 없어도 상태를 정한 구역은 표에 남는다", () => {
  const html = createOwnerReportHtml(report([{ key: "elevator", status: "skipped", note: "" }]), {});
  assert.match(html, /<td>승강기<\/td><td>-<\/td>/);
});

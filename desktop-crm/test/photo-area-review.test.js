const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/photo-pair-review");
const P = require("../src/report-photo-plan");
const R = require("../src/work-report-core");
const { createWorkReportHtml, workReportPdfPhotos } = require("../src/work-report-pdf");

function seed() {
  const files = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, name: `${i}.jpg`, mimeType: "image/jpeg" }));
  let plan = P.planFromTree({ files }, { kind: "moveIn" });
  for (let i = 0; i < 14; i++) plan = V.update(plan, [`p${i}`], { space: i < 8 ? "bath" : "kitchen", target: i % 2 ? "sink" : "floor", phase: (i < 3 || (i >= 8 && i < 12)) ? "before" : "after" });
  return plan;
}
test("구역은 대상과 짝 여부에 관계없이 전3·후5, 전4·후2를 모두 담는다", () => {
  const plan = seed();
  assert.deepEqual(V.areaGroups(plan).map(g => [g.space, g.before.length, g.after.length]), [["kitchen", 4, 2], ["bath", 3, 5]]);
  assert.deepEqual(V.pendingRows(plan).map(r => r.id), ["p14"]);
  assert.equal(V.flatten(V.confirmedPlan(plan)).length, 0);
  const approved = V.confirm(plan, V.areaGroups(plan).flatMap(g => g.rows.map(r => r.id)), true);
  const made = P.toReportDraft(V.confirmedPlan(approved), { core: R, requireResolved: true });
  assert.equal(made.ok, true);
  assert.equal(made.draft.items.flatMap(i => [...i.before, ...i.after]).length, 14);
  const existing = made.draft.items.map(i => ({ ...i, status: "partial", note: "사용자 메모" }));
  assert.ok(V.mergeReviewed(existing, made.draft.items).items.every(i => i.status === "partial" && i.note === "사용자 메모"));
});
test("전 사진만 있어도 묶고 시간순으로 표시하며 미분류는 별도로 남긴다", () => {
  let plan = V.update(seed(), ["p0", "p1", "p2"], { space: "entrance" });
  plan = V.withCaptureTimes(plan, [{ id: "p2", captureTime: { local: "2026-10-05T09:00:00", offset: "+09:00", source: "exif-original" } }]);
  const group = V.areaGroups(plan).find(g => g.space === "entrance");
  assert.equal(group.after.length, 0);
  assert.equal(group.before.length, 3);
  assert.equal(group.before[0].id, "p2");
  plan = V.update(plan, ["p2"], { target: "unknown" });
  assert.deepEqual(new Set(V.pendingRows(plan).map(r => r.id)), new Set(["p2", "p14"]));
});
test("한 장 이동은 새 구역에 반영하고 재확인을 요구하며 사진을 복제하지 않는다", () => {
  const original = V.confirm(seed(), Array.from({ length: 14 }, (_, i) => `p${i}`), true);
  const moved = V.update(original, ["p0"], { space: "kitchen", phase: "after" });
  assert.equal(V.areaGroups(moved).find(g => g.space === "kitchen").after.length, 3);
  assert.equal(V.flatten(V.confirmedPlan(moved)).length, 13);
  assert.equal(new Set(V.flatten(moved).map(r => r.id)).size, 15);
  assert.equal(V.areaGroups(original).find(g => g.space === "bath").before.length, 3);
});
test("사진 추가는 기존 수동 분류·확인·시간을 보존하고 중복 ID를 제거한다", () => {
  const previous = V.confirm(seed(), ["p0"], true);
  const incoming = P.planFromTree({ files: ["p0", "extra", "extra"].map(id => ({ id, name: `${id}.jpg`, mimeType: "image/jpeg" })) }, { kind: "moveIn" });
  const added = V.mergeSelection(incoming, previous, true);
  assert.equal(V.flatten(added).length, 16);
  assert.deepEqual(V.flatten(added).find(r => r.id === "p0"), V.flatten(previous).find(r => r.id === "p0"));
  assert.equal(V.flatten(V.mergeSelection(incoming, previous)).length, 2, "일반 재선택은 선택하지 않은 사진을 제외한다");
});
test("58장도 초안과 두 종류 PDF에서 잘리지 않고 각각 한 번만 출력된다", () => {
  let plan = P.planFromTree({ files: Array.from({ length: 58 }, (_, i) => ({ id: `p${i}`, name: `p${i}.jpg`, mimeType: "image/jpeg" })) }, { kind: "moveIn" });
  plan = V.update(plan, V.flatten(plan).map(r => r.id), { space: "bath", target: "floor", phase: "before" });
  plan = V.update(plan, Array.from({ length: 35 }, (_, i) => `p${i + 23}`), { phase: "after" });
  plan = V.confirm(plan, V.flatten(plan).map(r => r.id), true);
  const made = P.toReportDraft(V.confirmedPlan(plan), { core: R, requireResolved: true });
  const normalized = R.normalizeReport(made.draft);
  const photos = workReportPdfPhotos(normalized);
  assert.equal(photos.length, 58);
  const images = Object.fromEntries(photos.map(p => [p.id, `data:image/jpeg;base64,${Buffer.from(p.id).toString("base64")}`]));
  const sealImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const type of ["owner", "program"]) {
    const html = createWorkReportHtml(normalized, type, { images, sealImage });
    for (const value of Object.values(images)) assert.equal(html.split(`src="${value}"`).length - 1, 1);
    assert.match(html, /작업 전 · 총 23장/);
    assert.match(html, /작업 후 · 총 35장/);
    assert.match(html, type === "owner" ? /사진 10\/10/ : /사진 18\/18/);
  }
  assert.equal(V.mergeReviewed(made.draft.items, made.draft.items).added, 0);
});
test("PDF 총량 초과는 몰래 잘라내지 않고 명시적으로 거절한다", () => {
  const report = { items: [{ before: Array.from({ length: 101 }, (_, i) => ({ id: `p${i}` })), after: [] }] };
  assert.throws(() => workReportPdfPhotos(report), { code: "REPORT_PHOTO_LIMIT" });
});

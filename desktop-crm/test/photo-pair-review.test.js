const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/photo-pair-review");
const P = require("../src/report-photo-plan");
const R = require("../src/work-report-core");
const seed = (count = 4) => V.decorate(P.planFromTree({ name: "입주청소(샘플)_20261005", files: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `IMG_${i}.JPG`, mimeType: "image/jpeg" })) }, { kind: "moveIn" }), Array.from({ length: count }, (_, i) => ({ id: `p${i}`, category: "floor", space: "veranda", target: "floor" })));
const pair = { beforeId: "p0", afterId: "p1", evidence: "debris_removed" };
const timed = (id, local) => ({ id, captureTime: { local: `2026-10-02T${local}`, offset: "+09:00", source: "exif-original" } });

test("원본 시간은 혼자서 전후를 나누지 않으며 중간 전 사진은 같은 장면의 늦은 사진과 묶는다", () => {
  const plan = V.withCaptureTimes(seed(), [timed("p0", "09:00:00"), timed("p1", "14:00:00"), timed("p2", "15:00:00"), timed("p3", "16:40:00")]);
  assert.ok(V.flatten(plan).every(row => row.phase === "unsorted"));
  const result = V.applyPairs(plan, [{ beforeId: "p2", afterId: "p3", evidence: "same_scene_time" }]);
  assert.equal(V.flatten(result).find(row => row.id === "p2").phase, "before");
  assert.equal(V.flatten(result).find(row => row.id === "p1").phase, "unsorted");
  assert.equal(V.flatten(V.confirmedPlan(result)).length, 0);
  assert.equal(V.flatten(result).find(row => row.id === "p3").file.captureTime.local, "2026-10-02T16:40:00");
});
test("시간 추천은 40분 이상 같은 날만 허용하고 역순·시간 누락·수동 지정 충돌을 막는다", () => {
  const timePair = { ...pair, evidence: "same_scene_time" };
  const pairs = plan => V.groups(V.applyPairs(plan, [timePair])).filter(group => group.paired).length;
  assert.equal(pairs(seed()), 0);
  assert.equal(pairs(V.withCaptureTimes(seed(), [timed("p0", "14:00:00"), timed("p1", "14:39:59")])), 0);
  const plan = V.withCaptureTimes(seed(), [timed("p0", "14:00:00"), timed("p1", "16:40:00")]);
  assert.equal(pairs(plan), 1);
  assert.equal(pairs(V.update(plan, ["p1"], { phase: "before" })), 0);
  assert.equal(V.groups(V.applyPairs(plan, [{ ...pair, beforeId: "p1", afterId: "p0" }])).filter(group => group.paired).length, 0);
  assert.equal(pairs(V.withCaptureTimes(plan, [{ id: "p1", captureTime: { ...timed("p1", "16:40:00").captureTime, local: "2026-10-03T16:40:00" } }])), 0);
});
test("58장 비교는 시간순 양 끝을 섞어 초반 전 사진과 마무리 후 사진이 다른 배치로 갈라지지 않는다", () => {
  const plan = V.withCaptureTimes(seed(58), Array.from({ length: 58 }, (_, i) => timed(`p${i}`, `${i < 29 ? "09" : "16"}:${String(i % 29).padStart(2, "0")}:00`)));
  const ids = V.comparisonGroups(plan)[0];
  assert.deepEqual(ids.slice(0, 4), ["p0", "p57", "p1", "p56"]);
  assert.equal(new Set(ids).size, 58);
  assert.ok(ids.slice(0, 30).some(id => Number(id.slice(1)) >= 29));
  assert.ok(ids.slice(30).some(id => Number(id.slice(1)) < 29));
});

test("공간·대상을 분리하고 같은 종류의 바닥을 다른 공간에 몰아넣지 않는다", () => {
  assert.equal(V.categoryFor("bath", "floor"), "bath");
  assert.equal(V.categoryFor("veranda", "floor"), "veranda");
  assert.equal(V.categoryFor("living", "floor"), "floor");
  assert.equal(V.categoryFor("unknown", "floor"), "");
  assert.equal(V.categoryFor(undefined, "floor"), "");
  assert.equal(V.categoryFor("bath", "untrusted"), "");
  assert.equal(V.categoryFor("kitchen", "hood"), "hood");
});
test("전후 짝은 추천일 뿐 확인 전에는 초안에 한 장도 적용하지 않는다", () => {
  const plan = V.applyPairs(seed(), [pair]);
  assert.equal(V.groups(plan).filter(group => group.paired).length, 1);
  assert.equal(V.flatten(V.confirmedPlan(plan)).length, 0);
  const approved = V.confirm(plan, ["p0", "p1", "p2"], true);
  assert.equal(V.flatten(V.confirmedPlan(approved)).length, 2);
  const made = P.toReportDraft(V.confirmedPlan(approved), { core: R, requireResolved: true });
  assert.equal(made.ok, true);
  assert.equal(made.draft.items.find(row => row.key === "veranda").before.length, 1);
  assert.equal(made.draft.items.find(row => row.key === "veranda").after.length, 1);
});
test("다른 공간·중복 ID·전후 표기 충돌은 자동 짝으로 연결하지 않는다", () => {
  let plan = V.update(seed(), ["p1"], { space: "bath" });
  assert.equal(V.groups(V.applyPairs(plan, [pair])).filter(group => group.paired).length, 0);
  plan = V.update(seed(), ["p1"], { phase: "before" });
  assert.equal(V.groups(V.applyPairs(plan, [pair])).filter(group => group.paired).length, 0);
  assert.equal(V.groups(V.applyPairs(seed(), [pair, { ...pair, afterId: "p2" }, { ...pair, beforeId: "missing" }])).filter(group => group.paired).length, 1);
});
test("전후 뒤집기는 확인을 해제하고 재분석이 사람 선택을 덮지 않는다", () => {
  let plan = V.confirm(V.applyPairs(seed(), [pair]), ["p0", "p1"], true);
  plan = V.swap(plan, V.groups(plan)[0].id);
  assert.equal(V.flatten(plan).find(row => row.id === "p0").phase, "after");
  assert.equal(V.flatten(V.confirmedPlan(plan)).length, 0);
  const again = V.decorate(P.applyPhotoClassifications(plan, [{ id: "p0", category: "bath" }]), [{ id: "p0", space: "bath", target: "toilet" }]);
  assert.equal(V.flatten(again).find(row => row.id === "p0").file.reviewSpace, "veranda");
  assert.equal(V.flatten(again).find(row => row.id === "p0").itemKey, "veranda");
});
test("사진 한 장 이동하면 기존 짝 양쪽의 확인을 해제한다", () => {
  const plan = V.update(V.confirm(V.applyPairs(seed(), [pair]), ["p0", "p1"], true), ["p0"], { target: "window" });
  assert.equal(V.groups(plan).filter(group => group.paired).length, 0);
  assert.equal(V.flatten(V.confirmedPlan(plan)).length, 0);
  assert.equal(V.flatten(plan).length, 4);
});
test("두 장 직접 묶기는 같은 공간·대상의 반대 단계만 허용한다", () => {
  let plan = V.update(seed(), ["p0"], { phase: "before" });
  assert.equal(V.manualPair(plan, ["p0", "p1"]), null);
  plan = V.update(plan, ["p1"], { phase: "after" });
  assert.ok(V.manualPair(plan, ["p0", "p1"]));
  assert.equal(V.manualPair(plan, ["p0"]), null);
});
test("수동 지정·확정되지 않은 자동 전후는 재분석 시 초기화한다", () => {
  const plan = V.applyPairs(seed(), [pair]);
  const again = V.decorate(plan, [{ id: "p0", space: "veranda", target: "floor" }, { id: "p1", space: "veranda", target: "floor" }]);
  assert.equal(V.flatten(again).find(row => row.id === "p0").phase, "unsorted");
});
test("재적용은 기존 사진 설명·메모·완료 상태를 보존하고 바뀐 구역·전후만 반영한다", () => {
  const photo = { id: "p0", driveFileId: "p0", caption: "담당자 설명" };
  const old = [{ key: "floor", note: "기존 메모", status: "done", before: [photo], after: [] }];
  const incoming = [{ key: "bath", before: [], after: [{ ...photo, caption: "" }] }];
  const merged = V.mergeReviewed(old, incoming);
  assert.equal(merged.items[0].before.length, 0);
  assert.equal(merged.items[0].note, "기존 메모"); assert.equal(merged.items[0].status, "done");
  assert.equal(merged.items[1].after[0].caption, "담당자 설명");
  assert.equal(V.mergeReviewed(merged.items, incoming).items[1].after.length, 1);
});
test("58장 분류도 30장 요청 경계와 무관하게 구역별로 다시 모은다", () => {
  const groups = V.comparisonGroups(seed(58));
  assert.equal(groups[0].length, 58);
  assert.deepEqual(new Set(groups.flat()), new Set(V.flatten(seed(58)).map(row => row.id)));
});

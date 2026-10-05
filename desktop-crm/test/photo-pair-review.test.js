const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/photo-pair-review");
const P = require("../src/report-photo-plan");
const R = require("../src/work-report-core");
const seed = (count = 4) => V.decorate(P.planFromTree({ name: "입주청소(샘플)_20261005", files: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `IMG_${i}.JPG`, mimeType: "image/jpeg" })) }, { kind: "moveIn" }), Array.from({ length: count }, (_, i) => ({ id: `p${i}`, category: "floor", space: "veranda", target: "floor" })));
const pair = { beforeId: "p0", afterId: "p1", evidence: "debris_removed" };

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

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/report-photo-plan");
const W = require("../src/work-report-core");
const photo = (id, extra = {}) => ({ id, name: `${id}.jpg`, mimeType: "image/jpeg", ...extra });
const plan = files => P.planFromTree({ name: "입주청소(예시건물)_20261002", folders: [{ name: "욕실", files }] });

test("업로드 시간은 전후 추정에 사용하지 않는다", () => {
  const result = plan([photo("a", { createdTime: "2026-10-02T09:00:00Z" }), photo("b", { createdTime: "2026-10-02T18:00:00Z" })]);
  assert.equal(result.buckets[0].unsorted.length, 2);
});

test("실제 파일·폴더의 전후 표기는 우선하고 모순은 확인 대기로 남긴다", () => {
  const result = plan([photo("a", { parentName: "욕실 작업 전" }), photo("b", { parentName: "욕실 작업 후" }), photo("c", { name: "작업전.jpg", parentName: "작업후" })]);
  assert.deepEqual(P.photoReviewRows(result).map(row => [row.id, row.phase]), [["a", "before"], ["b", "after"], ["c", "unsorted"]]);
  assert.equal(P.phaseHint(photo("전망좋은방"), ""), "");
});

test("미분류 사진은 구역·전후 확인 전에는 적용할 수 없다", () => {
  const initial = plan([photo("a"), photo("b")]);
  assert.equal(P.toReportDraft(initial, { core: W, requireResolved: true }).code, "PHOTO_REVIEW_REQUIRED");
  let current = P.assignPhotoPhase(initial, "a", "before");
  current = P.assignPhotoPhase(current, "b", "after");
  assert.equal(P.toReportDraft(current, { core: W, requireResolved: true }).ok, true);
  assert.equal(initial.buckets[0].unsorted.length, 2, "원본 계획은 불변");
  assert.equal(P.assignPhotoPhase(current, "a", "untrusted"), current);
});

test("AI 재분류와 구역 이동 뒤에도 사용자가 고른 전후·사진 수를 보존한다", () => {
  const base = P.assignPhotoPhase(plan([photo("a"), photo("b")]), "a", "after");
  const classified = P.applyPhotoClassifications(base, [{ id: "a", category: "floor", confidence: 90 }]);
  const edited = P.assignPhotoCategory(classified, "a", "kitchen");
  assert.equal(P.photoReviewRows(edited).length, 2);
  assert.deepEqual(P.photoReviewRows(edited).filter(row => row.id === "a").map(row => [row.itemKey, row.phase]), [["kitchen", "after"]]);
  assert.equal(P.photoReviewRows(edited).find(row => row.id === "b").itemKey, "");
  assert.equal(P.photoReviewRows(classified).find(row => row.id === "a").itemKey, "floor");
});

test("8장 적용은 반복해도 중복이 없고 기존 상태·메모·설명을 보존한다", () => {
  const files = Array.from({ length: 8 }, (_, index) => photo(`p${index}`, { parentName: index % 2 ? "작업 후" : "작업 전" }));
  const draft = P.toReportDraft(plan(files), { core: W, requireResolved: true }).draft;
  const existing = W.itemsFor("moveIn", []).map(item => ({ ...item, note: "사용자 작성", status: "partial" }));
  const first = P.mergeDraftPhotos(existing, draft.items);
  const second = P.mergeDraftPhotos(first.items, draft.items);
  assert.equal(first.added, 8); assert.equal(second.added, 0);
  assert.equal(second.items.flatMap(item => item.before.concat(item.after)).length, 8);
  assert.ok(second.items.every(item => item.note === "사용자 작성" && item.status === "partial"));
  assert.equal(existing.flatMap(item => item.before.concat(item.after)).length, 0);
});

test("AI 실패 뒤 폴더 없이도 한 장씩 수동 분류할 수 있다", () => {
  let current = P.planFromTree({ name: "예시", files: [photo("a")] }, { kind: "stairs" });
  current = P.assignPhotoCategory(current, "a", "stairFloor");
  current = P.assignPhotoPhase(current, "a", "after");
  const draft = P.toReportDraft(current, { core: W, kind: "stairs", requireResolved: true });
  assert.equal(draft.ok, true);
  assert.equal(draft.draft.items.find(item => item.key === "stairFloor").after.length, 1);
});

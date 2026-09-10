const assert = require("node:assert/strict");
const test = require("node:test");

const P = require("../src/report-photo-plan");
const W = require("../src/work-report-core");

// 진짜 Drive 에 있는 이름들이다. 지어낸 이름으로 검사하면 지어낸 것만
// 통과한다.
const jpg = (name, createdTime) => ({ id: `f_${name}`, name, mimeType: "image/jpeg", createdTime });
const heic = name => ({ id: `f_${name}`, name, mimeType: "image/heif", createdTime: "2026-09-01T04:13:24.134Z" });

test("바깥 폴더 이름에서 작업·건물·날짜를 뽑는다", () => {
  const a = P.parseFolderName("입주청소(햇빛빌라)_블로그_20260831");
  assert.equal(a.work, "입주청소");
  assert.equal(a.building, "햇빛빌라");
  assert.equal(a.date, "2026-08-31");
  assert.equal(a.kind, "moveIn");

  // 두 자리 연도도 쓴다.
  const b = P.parseFolderName("사이니지 유지관리(햇빛빌라)_블로그_260904");
  assert.equal(b.building, "햇빛빌라");
  assert.equal(b.date, "2026-09-04");

  const c = P.parseFolderName("계단 청소(영업 하면서 찍은 사진)_블로그_260904");
  assert.equal(c.kind, "stairs");
  assert.equal(c.date, "2026-09-04");
});

test("모르는 작업은 짐작하지 않고 비워 둔다", () => {
  // 짐작해서 입주청소로 깔면 계단청소 항목이 통째로 어긋난다.
  assert.equal(P.parseFolderName("지붕 공사(예초집)_블로그_260905").kind, "");
  assert.equal(P.kindFromWords("사이니지 유지관리"), "");
  assert.equal(P.kindFromWords("입주청소"), "moveIn");
  assert.equal(P.kindFromWords("계단 청소"), "stairs");
});

test("말이 안 되는 날짜는 안 받는다", () => {
  assert.equal(P.parseDateChunk("20261340"), "");
  assert.equal(P.parseDateChunk("블로그"), "");
  assert.equal(P.parseDateChunk("20260831"), "2026-08-31");
});

test("하위 폴더 이름이 보고서 항목이 된다", () => {
  // Drive 에 실제로 있는 이름들이다.
  assert.equal(P.itemKeyForFolder("moveIn", "화장실"), "bath");
  assert.equal(P.itemKeyForFolder("moveIn", "주방"), "kitchen");
  assert.equal(P.itemKeyForFolder("moveIn", "베란다"), "veranda");
  assert.equal(P.itemKeyForFolder("moveIn", "신발장"), "storage");
  assert.equal(P.itemKeyForFolder("moveIn", "거실"), "floor");
  assert.equal(P.itemKeyForFolder("stairs", "계단청소"), "stairFloor");
  assert.equal(P.itemKeyForFolder("stairs", "난간·손잡이"), "handrail");
  // 못 이으면 빈 문자열이다. 아무 데나 넣지 않는다.
  assert.equal(P.itemKeyForFolder("moveIn", "공간기획"), "");
});

test("이어 준 항목은 그 작업에 진짜로 있는 항목이다", () => {
  // 없는 열쇠에 이어 두면 사진이 어디에도 안 붙는다.
  Object.entries(P.FOLDER_HINTS).forEach(([kind, table]) => {
    const keys = W.itemsFor(kind, []).map(item => item.key);
    Object.entries(table).forEach(([folder, itemKey]) => {
      assert.ok(keys.includes(itemKey), `${kind} 에 ${itemKey} 가 없다 (${folder})`);
    });
  });
});

test("찍은 시각은 파일 이름이 먼저다", () => {
  // Drive 에 올린 시각은 옮긴 시각이다. 다섯 장을 한꺼번에 올리면 다
  // 같은 시각이 되어 전·후를 못 가른다.
  const taken = P.takenAt(jpg("20260831_172901.jpg", "2026-09-05T10:00:00Z"));
  assert.equal(taken.from, "name");
  assert.equal(new Date(taken.at).toISOString(), "2026-08-31T17:29:01.000Z");
  // 아이폰 이름에는 시각이 없다. 그때만 Drive 시각을 쓴다.
  const fallback = P.takenAt({ name: "IMG_4310.HEIC", createdTime: "2026-09-01T04:13:24.134Z" });
  assert.equal(fallback.from, "drive");
  assert.equal(P.takenAt({ name: "IMG_4310.HEIC" }).from, "none");
});

test("시각이 벌어지는 자리에서 전과 후를 가른다", () => {
  // 진짜 화장실 폴더의 시각 무리다. 17:29 다섯 장, 다음 날 10:18 다섯 장.
  const photos = [
    jpg("20260831_172901.jpg"), jpg("20260831_172904.jpg"), jpg("20260831_172906.jpg"),
    jpg("20260831_172911.jpg"), jpg("20260831_172915.jpg"),
    jpg("20260901_101819.jpg"), jpg("20260901_101822.jpg"), jpg("20260901_101839.jpg"),
  ];
  const split = P.splitBeforeAfter(photos);
  assert.equal(split.confident, true);
  assert.equal(split.before.length, 5);
  assert.equal(split.after.length, 3);
  assert.match(split.reason, /분이 벌어진 자리에서 나눴습니다/u);
});

test("한 번에 찍힌 사진은 반으로 자르지 않는다", () => {
  // 반씩 자르면 그럴듯해 보이지만 틀린 보고서가 된다. 틀린 것보다
  // 비어 있는 편이 낫다 — 사람이 고칠 수 있기 때문이다.
  const split = P.splitBeforeAfter([jpg("20260831_172901.jpg"), jpg("20260831_172904.jpg"), jpg("20260831_172906.jpg")]);
  assert.equal(split.confident, false);
  assert.equal(split.before.length, 0);
  assert.equal(split.after.length, 0);
  assert.equal(split.unsorted.length, 3);
  assert.match(split.reason, /골라 주세요/u);
});

test("가장 크게 벌어진 자리 하나에서만 자른다", () => {
  // 벌어진 자리마다 자르면 무리가 셋 넷이 된다. 보고서는 전과 후 둘이다.
  //
  // 넓은 자리가 뒤에 있는 경우와 앞에 있는 경우를 둘 다 본다. 한쪽만
  // 보면 "마지막으로 벌어진 자리에서 자르기" 와 구별되지 않는다.
  const late = P.splitBeforeAfter([
    jpg("20260831_090000.jpg"),
    jpg("20260831_100000.jpg"), // 60분
    jpg("20260831_140000.jpg"), // 240분 ← 여기
    jpg("20260831_141000.jpg"),
  ]);
  assert.equal(late.before.length, 2);
  assert.equal(late.after.length, 2);

  const early = P.splitBeforeAfter([
    jpg("20260831_090000.jpg"),
    jpg("20260831_130000.jpg"), // 240분 ← 여기
    jpg("20260831_140000.jpg"), // 60분
    jpg("20260831_141000.jpg"),
  ]);
  assert.equal(early.before.length, 1, "가장 넓은 자리는 앞에 있다");
  assert.equal(early.after.length, 3);
});

test("아이폰 사진은 못 연다고 말해 준다", () => {
  // 크롬이 HEIC 를 못 연다. 조용히 넘기면 사람은 왜 빈칸인지 모른다.
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [{ name: "화장실", files: [jpg("20260831_172901.jpg"), heic("IMG_4310.HEIC"), heic("IMG_4311.HEIC")] }],
  });
  assert.equal(plan.heicCount, 2);
  assert.ok(plan.warnings.some(line => line.includes("HEIC")), plan.warnings.join(" / "));
  assert.equal(plan.buckets[0].heic.length, 2);
  // 못 여는 사진은 전·후 계산에 안 들어간다.
  assert.equal(plan.buckets[0].before.length + plan.buckets[0].after.length + plan.buckets[0].unsorted.length, 1);
});

test("폴더 나무를 통째로 보고 계획을 짠다", () => {
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [
      { name: "화장실", files: [jpg("20260831_172901.jpg"), jpg("20260901_101819.jpg")] },
      { name: "주방", files: [jpg("20260831_180000.jpg"), jpg("20260901_102000.jpg")] },
      { name: "공간기획", files: [jpg("20260831_190000.jpg")] },
      { name: "영상 캡처 정리", files: [{ id: "v1", name: "20260831_182447.mp4", mimeType: "video/mp4" }] },
    ],
  });
  assert.equal(plan.buildingName, "햇빛빌라");
  assert.equal(plan.workDate, "2026-08-31");
  assert.equal(plan.kind, "moveIn");
  assert.equal(plan.matched, 2, "화장실·주방만 표준 항목에 붙는다");
  assert.deepEqual(plan.unmatched, ["공간기획"]);
  assert.equal(plan.skipped.length, 1, "동영상 폴더는 건너뛴다");
});

test("바깥에 그냥 놓인 사진도 버리지 않는다", () => {
  const plan = P.planFromTree({
    name: "계단 청소(햇빛빌라)_블로그_260904",
    folders: [],
    files: [jpg("20260904_090000.jpg"), jpg("20260904_130000.jpg")],
  });
  assert.equal(plan.buckets.length, 1);
  assert.equal(plan.photoCount, 2);
});

test("초안이 결과보고서 모양으로 나온다", () => {
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [{ name: "화장실", files: [jpg("20260831_172901.jpg"), jpg("20260901_101819.jpg")] }],
  });
  const made = P.toReportDraft(plan, { core: W });
  assert.equal(made.ok, true);
  assert.equal(made.draft.kind, "moveIn");
  assert.equal(made.draft.buildingName, "햇빛빌라");
  assert.equal(made.draft.workDate, "2026-08-31");
  // 표준 항목이 다 깔려 있어야 한다 — 사진 있는 것만 나오면 안 한 것이 숨는다.
  assert.equal(made.draft.items.length, W.itemsFor("moveIn", []).length);
  const bath = made.draft.items.find(item => item.key === "bath");
  assert.equal(bath.before.length, 1);
  assert.equal(bath.after.length, 1);
  // 정말로 보고서가 받아들이는 모양인지 통째로 넣어 본다.
  const report = W.normalizeReport(made.draft);
  assert.equal(report.items.find(item => item.key === "bath").after.length, 1);
});

test("초안만으로는 내보낼 수 없다", () => {
  // 자동으로 짠 초안이 그대로 나갈 수 있으면, 아무도 안 보고 내보내게 된다.
  //
  // 코어는 항목을 '완료' 로 깔아 두고, 전·후 사진이 없으면 blockers 가
  // 막는다. 그 구조를 그대로 쓴다 — 여기서 상태를 따로 손대면 두 군데가
  // 각자 판단하게 되고, 한쪽이 반드시 뒤처진다.
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [{ name: "화장실", files: [jpg("20260831_172901.jpg"), jpg("20260901_101819.jpg")] }],
  });
  const made = P.toReportDraft(plan, { core: W });
  const report = W.normalizeReport(made.draft);

  // 사진이 붙은 화장실은 통과하고, 안 붙은 나머지가 막는다.
  assert.equal(W.itemIssue(report.items.find(item => item.key === "bath")), null);
  const stops = W.blockers(report);
  assert.ok(stops.length > 0, "증빙 없는 항목이 내보내기를 막아야 한다");
  assert.equal(W.ready(report), false);
});

test("계획을 짜는 쪽은 상태를 손대지 않는다", () => {
  // 상태를 여기서 올리거나 내리면 코어의 판단과 두 벌이 된다.
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [{ name: "화장실", files: [jpg("20260831_172901.jpg"), jpg("20260901_101819.jpg")] }],
  });
  const made = P.toReportDraft(plan, { core: W });
  const base = W.itemsFor("moveIn", []);
  assert.deepEqual(made.draft.items.map(item => item.status), base.map(item => item.status));
});

test("못 가른 사진은 작업 전에 몰아넣지 않는다", () => {
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [{ name: "화장실", files: [jpg("20260831_172901.jpg"), jpg("20260831_172904.jpg")] }],
  });
  const made = P.toReportDraft(plan, { core: W });
  const bath = made.draft.items.find(item => item.key === "bath");
  assert.equal(bath.before.length, 0);
  assert.equal(bath.after.length, 0);
  assert.match(bath.note, /전·후를 못 가른 사진 2장/u);
});

test("항목에 못 붙인 폴더는 따로 돌려준다", () => {
  // 조용히 버리면 그 사진은 보고서에 영영 안 들어간다.
  const plan = P.planFromTree({
    name: "입주청소(햇빛빌라)_블로그_20260831",
    folders: [{ name: "공간기획", files: [jpg("20260831_090000.jpg"), jpg("20260831_140000.jpg")] }],
  });
  const made = P.toReportDraft(plan, { core: W });
  assert.equal(made.leftovers.length, 1);
  assert.equal(made.leftovers[0].folder, "공간기획");
});

test("작업 종류를 모르면 초안을 안 만든다", () => {
  const plan = P.planFromTree({ name: "지붕 공사(예초집)_블로그_260905", folders: [] });
  assert.equal(plan.kind, "");
  assert.ok(plan.warnings.some(line => line.includes("작업 종류")));
  const made = P.toReportDraft(plan, { core: W });
  assert.equal(made.ok, false);
  assert.equal(made.code, "KIND_REQUIRED");
  // 사람이 골라 주면 만들어진다.
  assert.equal(P.toReportDraft(plan, { core: W, kind: "special" }).ok, true);
});

test("모듈을 못 받으면 계산하지 않는다", () => {
  // 여기서 항목을 다시 만들면 두 벌이 되고 한쪽이 반드시 뒤처진다.
  assert.equal(P.toReportDraft({}, {}).code, "CORE_MISSING");
});

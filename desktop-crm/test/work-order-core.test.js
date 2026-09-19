const assert = require("node:assert/strict");
const test = require("node:test");

const W = require("../src/work-order-core");

const full = {
  id: "w1",
  title: "3층 누수 확인",
  why: "임차인이 두 번 민원을 넣었고 다음 주에 갱신 면담이 있습니다.",
  what: "천장을 열어 배관 상태를 보고 사진을 남깁니다.",
  doneWhen: "사진 3장과 원인 한 줄이 올라오면 끝입니다.",
  assigneeUid: "u1",
  status: "assigned",
  hours: 4,
};
const withResult = patch => Object.assign({}, full, {
  results: [{ id: "r1", driveFileId: "1AbCdEfGhIjK", title: "사진", uploadedAt: "2026-09-06T00:00:00.000Z" }],
}, patch);

test("왜·무엇을·완료 기준이 없으면 지시를 낼 수 없다", () => {
  // 이 셋이 이 화면의 전부다. 없으면 받는 사람이 짐작으로 한다.
  assert.equal(W.validateOrder({ ...full, why: "" }).code, "WHY_REQUIRED");
  assert.equal(W.validateOrder({ ...full, what: "" }).code, "WHAT_REQUIRED");
  assert.equal(W.validateOrder({ ...full, doneWhen: "" }).code, "DONE_WHEN_REQUIRED");
  assert.equal(W.validateOrder(full).ok, true);
});

test("제목과 담당자도 있어야 한다", () => {
  assert.equal(W.validateOrder({ ...full, title: "" }).code, "TITLE_REQUIRED");
  assert.equal(W.validateOrder({ ...full, assigneeUid: "" }).code, "ASSIGNEE_REQUIRED");
});

test("완료는 시킨 사람만 정한다", () => {
  // 담당자가 스스로 완료로 두면 검수가 없는 것과 같다.
  const asAssignee = W.moveStatus({ order: withResult(), next: "done", actorUid: "u1" });
  assert.equal(asAssignee.code, "DONE_IS_ADMIN");
  assert.match(asAssignee.error, /제출까지/u);
  assert.equal(W.moveStatus({ order: withResult({ status: "submitted" }), next: "done", admin: true }).ok, true);
});

test("결과물 없이 제출할 수 없다", () => {
  assert.equal(W.moveStatus({ order: full, next: "submitted", actorUid: "u1" }).code, "RESULT_REQUIRED");
  assert.equal(W.moveStatus({ order: withResult(), next: "submitted", actorUid: "u1" }).ok, true);
});

test("다시 요청할 때는 이유를 적어야 한다", () => {
  const submitted = withResult({ status: "submitted" });
  assert.equal(W.moveStatus({ order: submitted, next: "returned", admin: true }).code, "RETURN_REASON_REQUIRED");
  const returned = W.moveStatus({ order: submitted, next: "returned", admin: true, note: "사진이 한 장뿐입니다" });
  assert.equal(returned.ok, true);
  assert.equal(returned.record === undefined, true);
  assert.equal(returned.order.reviewNote, "사진이 한 장뿐입니다");
  // 완료로 넘어가면 반려 사유는 지운다. 끝난 일에 옛 지적이 남아 있으면 헷갈린다.
  assert.equal(W.moveStatus({ order: withResult({ status: "submitted", reviewNote: "x" }), next: "done", admin: true }).order.reviewNote, "");
});

test("남의 지시는 못 옮긴다", () => {
  assert.equal(W.moveStatus({ order: withResult(), next: "doing", actorUid: "u2" }).code, "NOT_ASSIGNEE");
});

test("완료한 지시는 어디로도 못 옮긴다", () => {
  for (const next of ["doing", "submitted", "returned", "assigned"]) {
    assert.equal(W.moveStatus({ order: withResult({ status: "done" }), next, admin: true }).code, "MOVE_FORBIDDEN", next);
  }
});

test("지시 내용이 바뀌었는지 알아본다", () => {
  // 담당자가 상태만 바꾸는지 확인하는 데 쓴다.
  assert.equal(W.sameInstruction(full, { ...full, status: "doing" }), true);
  assert.equal(W.sameInstruction(full, { ...full, what: "안 해도 됩니다" }), false);
  assert.equal(W.sameInstruction(full, { ...full, dueDate: "2026-12-31" }), false);
  assert.equal(W.sameInstruction(full, { ...full, assigneeUid: "u2" }), false);
});

test("기한이 지난 것은 진행 중일 때만 센다", () => {
  const late = { ...full, dueDate: "2026-09-01" };
  assert.equal(W.overdue(late, "2026-09-06"), true);
  assert.equal(W.overdue({ ...late, status: "done" }, "2026-09-06"), false);
  assert.equal(W.overdue({ ...late, status: "submitted" }, "2026-09-06"), false);
  assert.equal(W.overdue({ ...full, dueDate: "" }, "2026-09-06"), false);
});

test("대시보드 숫자를 한 곳에서 센다", () => {
  const orders = [
    { ...full, id: "a", status: "doing", dueDate: "2026-09-01" },
    { ...full, id: "b", status: "submitted" },
    { ...full, id: "c", status: "done", updatedAt: "2026-09-05T00:00:00.000Z" },
    { ...full, id: "d", status: "done", updatedAt: "2026-07-01T00:00:00.000Z" },
    { ...full, id: "e", status: "returned" },
  ];
  const summary = W.summarize(orders, "2026-09-06");
  assert.equal(summary.total, 5);
  assert.equal(summary.open, 2);
  assert.equal(summary.waitingReview, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.doneRecently, 1, "7일 지난 완료가 섞였다");
});

test("손봐야 할 것부터 위로 온다", () => {
  const orders = [
    { ...full, id: "done", status: "done" },
    { ...full, id: "open", status: "doing", dueDate: "2026-12-01" },
    { ...full, id: "late", status: "doing", dueDate: "2026-09-01" },
    { ...full, id: "returned", status: "returned" },
    { ...full, id: "submitted", status: "submitted" },
  ];
  assert.deepEqual(W.sortForBoard(orders, "2026-09-06").map(item => item.id),
    ["late", "returned", "submitted", "open", "done"]);
});

test("고를 수 있는 다음 상태가 사람마다 다르다", () => {
  const assignee = W.nextChoices(full, false).map(item => item.key);
  assert.deepEqual(assignee, ["doing", "submitted"]);
  assert.ok(!assignee.includes("done"));
  assert.ok(W.nextChoices({ ...full, status: "submitted" }, true).map(item => item.key).includes("returned"));
});

test("모르는 칸과 상태는 조용히 버린다", () => {
  const order = W.normalizeOrder({ ...full, status: "cancelled", secretNote: "여기 적으면 안 되는 것" });
  assert.equal(order.status, "assigned");
  assert.ok(!("secretNote" in order));
  // Drive 정보가 없는 결과물은 담지 않는다. 링크가 없으면 결과물이 아니다.
  assert.deepEqual(W.normalizeOrder({ ...full, results: [{ id: "r1" }] }).results, []);
});

// --- 예상 소요시간·가중치·산출물 ---

const order = (patch = {}) => Object.assign({}, full, patch);
test("새 지시는 예상 소요시간을 비워 둘 수 없다", () => {
  const made = W.validateOrder(order({ hours: 0 }));
  assert.equal(made.ok, false);
  assert.equal(made.code, "HOURS_REQUIRED");
  assert.match(made.error, /몇 시간쯤 걸릴지/u);
});

test("이미 있던 지시는 시간이 없어도 막지 않는다", () => {
  // 간트에서 기간 한 번 옮기려다 옛 지시가 통째로 안 저장되면 안 된다.
  const made = W.validateOrder(order({ hours: 0, createdAt: "2026-07-01T00:00:00Z" }));
  assert.equal(made.ok, true);
  assert.equal(made.order.hours, 0);
});

test("소요시간은 30분 단위로 자르고 40시간을 넘기지 않는다", () => {
  assert.equal(W.hoursOf(2.4), 2.5);
  assert.equal(W.hoursOf(2.2), 2);
  assert.equal(W.hoursOf(0), 0);
  assert.equal(W.hoursOf(-3), 0);
  assert.equal(W.hoursOf("아무거나"), 0);
  // 40시간 넘는 것은 지시가 아니라 프로젝트다.
  assert.equal(W.hoursOf(400), 40);
});

test("가중치는 0~100 정수다", () => {
  assert.equal(W.weightOf(33.4), 33);
  assert.equal(W.weightOf(0), 0);
  assert.equal(W.weightOf(140), 100);
  assert.equal(W.weightOf(""), 0);
});

test("담당자는 소요시간·가중치·산출물을 고칠 수 없다", () => {
  const before = order({ hours: 8, weight: 40, deliverable: "20260907_점검표.xlsx" });
  // 받는 사람이 "이건 두 시간짜리였다" 로 고칠 수 있으면 부하 계산이 무너진다.
  assert.equal(W.sameInstruction(before, Object.assign({}, before, { hours: 2 })), false);
  assert.equal(W.sameInstruction(before, Object.assign({}, before, { weight: 10 })), false);
  assert.equal(W.sameInstruction(before, Object.assign({}, before, { deliverable: "아무거나" })), false);
  assert.equal(W.sameInstruction(before, Object.assign({}, before, { progress: 50 })), true);
});

// --- 산출물 규격 ---

test("산출물 종류를 다섯 가지로 못 박는다", () => {
  // 자유 글로 두면 "사진", "사진 몇 장", "당근 사진" 이 다 다른 말이 되고
  // 요구한 만큼 냈는지를 기계가 못 본다.
  assert.deepEqual(W.DELIVERABLE_KINDS.map(item => item.key), ["photo", "doc", "sheet", "link", "none"]);
  assert.equal(W.DELIVERABLE_KINDS.every(item => item.label && item.hint), true);
  assert.equal(W.isDeliverableKind("사진"), false);
  assert.equal(W.normalizeOrder(order({ deliverableKind: "사진" })).deliverableKind, "");
  // 없음만 개수를 안 센다. 현장에서 확인만 하고 끝나는 일이 있다.
  assert.equal(W.deliverableCounted("none"), false);
  assert.equal(W.deliverableCounted("photo"), true);
});

test("옛 지시는 규격이 없어도 제출을 막지 않는다", () => {
  // 없던 규격을 소급해서 세우면 옛 지시가 통째로 제출이 막힌다.
  const old = W.normalizeOrder(order({ createdAt: "2026-07-01T00:00:00Z" }));
  assert.equal(old.deliverableKind, "");
  assert.equal(old.deliverableCount, 0);
  const moved = W.moveStatus({
    order: Object.assign({}, old, { results: [{ id: "r1", driveFileId: "d1" }] }),
    next: "submitted", actorUid: "u1",
  });
  assert.equal(moved.ok, true);
});

test("요구한 만큼 안 올리면 제출이 안 된다", () => {
  // 안 세면 사진 5장을 시켜도 1장에 제출이 열리고, 완료 기준이 있으나 마나다.
  const short = W.moveStatus({
    order: order({ deliverableKind: "photo", deliverableCount: 5, results: [{ id: "r1", driveFileId: "d1" }] }),
    next: "submitted", actorUid: "u1",
  });
  assert.equal(short.ok, false);
  assert.equal(short.code, "RESULT_SHORT");
  assert.match(short.error, /사진 5개가 필요한데 1개 올렸습니다\. 4개 더/u);

  const enough = W.moveStatus({
    order: order({
      deliverableKind: "photo", deliverableCount: 2,
      results: [{ id: "r1", driveFileId: "d1" }, { id: "r2", driveFileId: "d2" }],
    }),
    next: "submitted", actorUid: "u1",
  });
  assert.equal(enough.ok, true);
});

test("없음짜리 지시는 결과물 없이도 제출된다", () => {
  // 현장에서 확인만 하고 끝나는 일이 있다.
  const made = W.moveStatus({
    order: order({ deliverableKind: "none", deliverableCount: 0, results: [] }),
    next: "submitted", actorUid: "u1",
  });
  assert.equal(made.ok, true);
});

test("개수는 1~20 정수다", () => {
  assert.equal(W.deliverableCountOf(5), 5);
  assert.equal(W.deliverableCountOf(0), 0);
  assert.equal(W.deliverableCountOf(-3), 0);
  assert.equal(W.deliverableCountOf(2.6), 3);
  // 20을 넘기면 그건 한 지시가 아니다.
  assert.equal(W.deliverableCountOf(500), 20);
});

test("파일 이름을 앱이 붙이고 확장자는 원본 그대로 둔다", () => {
  // 사람이 손으로 치면 매번 다르게 적힌다. 확장자를 바꾸면 파일이 안 열린다.
  const spec = { deliverable: "20260909_당근_비즈프로필.png" };
  assert.equal(W.resultFileName(spec, "IMG_2847.JPG", 1), "20260909_당근_비즈프로필_1.jpg");
  assert.equal(W.resultFileName(spec, "IMG_2848.JPG", 2), "20260909_당근_비즈프로필_2.jpg");
  // 한 개짜리는 번호를 안 붙인다.
  assert.equal(W.resultFileName(spec, "보고서.pdf", 0), "20260909_당근_비즈프로필.pdf");
  // 지시에 이름이 안 적혀 있으면 원본을 그대로 둔다. 지어낸 이름을 붙이면
  // 무슨 파일인지 알 수 없게 된다.
  assert.equal(W.resultFileName({ deliverable: "" }, "IMG_2847.JPG", 1), "IMG_2847.JPG");
  // 확장자가 없는 파일도 터지지 않는다.
  assert.equal(W.resultFileName(spec, "README", 1), "20260909_당근_비즈프로필_1");
});

test("담당자는 산출물 규격을 고칠 수 없다", () => {
  // 고칠 수 있으면 사진 5장이 1장이 되고 완료 기준이 사후에 낮아진다.
  const before = order({ deliverableKind: "photo", deliverableCount: 5 });
  assert.equal(W.sameInstruction(before, Object.assign({}, before, { deliverableKind: "none" })), false);
  assert.equal(W.sameInstruction(before, Object.assign({}, before, { deliverableCount: 1 })), false);
});

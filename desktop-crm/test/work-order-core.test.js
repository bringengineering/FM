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

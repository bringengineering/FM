const assert = require("node:assert/strict");
const test = require("node:test");

const P = require("../src/project-core");

const order = patch => Object.assign({ status: "doing", progress: 0, track: "etc" }, patch);

test("이름 없는 프로젝트는 만들 수 없다", () => {
  assert.equal(P.validateProject({ id: "p1" }).code, "NAME_REQUIRED");
  assert.equal(P.validateProject({ id: "p1", name: "브링 케어" }).ok, true);
  assert.equal(P.validateProject({ id: "p1", name: "x", startDate: "2026-09-01", endDate: "2026-08-01" }).code, "DATE_REVERSED");
});

test("간트 폭을 자료에서 뽑는다", () => {
  // 고정 폭을 쓰면 지난달에 시작한 일이 화면 밖으로 나가 없는 것처럼 보인다.
  const range = P.ganttRange([
    order({ startDate: "2026-06-22", dueDate: "2026-06-26" }),
    order({ startDate: "2026-07-06", dueDate: "2026-07-31" }),
  ], "2026-07-10");
  assert.equal(range.from, "2026-06-20");
  assert.equal(range.to, "2026-08-02");
  assert.equal(range.days, 44);
});

test("오늘이 폭 밖이면 오늘도 넣는다", () => {
  // 오늘 선이 안 보이면 지금 어디쯤인지 알 수 없다.
  const range = P.ganttRange([order({ startDate: "2026-01-05", dueDate: "2026-01-10" })], "2026-09-06");
  assert.ok(range.from <= "2026-01-05");
  assert.ok(range.to >= "2026-09-06");
  assert.ok(P.todayOffset(range, "2026-09-06") !== null);
});

test("날짜가 하나도 없으면 오늘 둘레로 연다", () => {
  const range = P.ganttRange([order({}), order({})], "2026-09-06");
  assert.equal(range.from, "2026-09-03");
  assert.equal(range.days, 29);
});

test("막대는 퍼센트로 낸다", () => {
  // 화면 폭이 달라져도 같은 자리에 그려져야 한다.
  const range = { from: "2026-09-01", to: "2026-09-10", days: 10 };
  const box = P.layout(order({ startDate: "2026-09-03", dueDate: "2026-09-05" }), range);
  assert.equal(box.left, 20);
  assert.equal(box.width, 30);
  assert.equal(box.days, 3);
  // 마감만 있는 것도 하루짜리로 그린다.
  assert.equal(P.layout(order({ dueDate: "2026-09-01" }), range).width, 10);
  // 날짜가 없으면 그리지 않는다. 목록에서는 그래도 보인다.
  assert.equal(P.layout(order({}), range), null);
});

test("막대가 폭을 넘지 않는다", () => {
  const range = { from: "2026-09-01", to: "2026-09-10", days: 10 };
  const box = P.layout(order({ startDate: "2026-09-08", dueDate: "2026-12-31" }), range);
  assert.ok(box.left + box.width <= 100.001, `${box.left}+${box.width}`);
});

test("드래그한 칸을 날짜로 되돌린다", () => {
  const range = { from: "2026-09-01", to: "2026-09-10", days: 10 };
  assert.deepEqual(P.datesFromColumns(range, 2, 5), { startDate: "2026-09-03", dueDate: "2026-09-06" });
  // 거꾸로 끌어도 앞뒤를 맞춰 준다.
  assert.deepEqual(P.datesFromColumns(range, 5, 2), { startDate: "2026-09-03", dueDate: "2026-09-06" });
  // 폭 밖으로 끌어도 폭 안에 머문다.
  assert.deepEqual(P.datesFromColumns(range, -5, 99), { startDate: "2026-09-01", dueDate: "2026-09-10" });
});

test("진행률은 사람이 적은 값을 그대로 쓴다", () => {
  // 결과물 개수나 지난 날짜로 짐작하면 80% 라는 숫자를 아무도 안 믿게 된다.
  const summary = P.summarize([
    order({ progress: 80 }), order({ progress: 40 }), order({ progress: 0 }),
  ], "2026-09-06");
  assert.equal(summary.progress, 40);
  assert.equal(summary.total, 3);
});

test("기한 지난 것과 날짜 미정을 따로 센다", () => {
  const summary = P.summarize([
    order({ dueDate: "2026-09-01" }),
    order({ dueDate: "2026-09-01", status: "done" }),
    order({}),
  ], "2026-09-06");
  assert.equal(summary.overdue, 1, "완료된 것은 늦은 것이 아니다");
  assert.equal(summary.undated, 1);
  assert.equal(summary.done, 1);
});

test("구분별로 묶고 빈 칸은 내지 않는다", () => {
  const groups = P.groupByTrack([order({ track: "tech" }), order({ track: "marketing" }), order({ track: "없는것" })]);
  assert.deepEqual(groups.map(item => item.label), ["기술·엔지니어링", "마케팅", "기타"]);
  // 모르는 구분은 기타로 간다. 버리면 그 지시가 표에서 사라진다.
  assert.equal(groups[2].orders.length, 1);
});

test("진행 중인 프로젝트가 앞에 온다", () => {
  const list = P.sortProjects([
    { id: "a", name: "가", status: "done" },
    { id: "b", name: "나", status: "active" },
    { id: "c", name: "다", status: "paused" },
  ]);
  assert.deepEqual(list.map(item => item.id), ["b", "c", "a"]);
});

test("모르는 칸은 조용히 버린다", () => {
  const project = P.normalizeProject({ id: "p1", name: "x", status: "archived", budget: 100 });
  assert.equal(project.status, "active");
  assert.ok(!("budget" in project));
});

test("곧 마감인 것을 미리 보여 준다", () => {
  // 지난 것만 세면 늦고 나서야 안다. 그때는 이미 건물주에게 말이 나간 뒤다.
  const at = (id, dueDate, patch = {}) => order(Object.assign({ id, title: `일 ${id}`, dueDate }, patch));
  const list = [
    at("late", "2026-09-01"),
    at("today", "2026-09-06"),
    at("soon", "2026-09-10"),
    at("far", "2026-10-30"),
    at("done", "2026-09-02", { status: "done" }),
    at("nodate", ""),
  ];
  const soon = P.dueSoon(list, "2026-09-06");
  assert.deepEqual(soon.map(item => item.id), ["late", "today", "soon"]);
  // 음수는 지났다는 뜻이고 0 은 오늘이다.
  assert.equal(soon[0].daysLeft, -5);
  assert.equal(soon[0].late, true);
  assert.equal(soon[1].daysLeft, 0);
  assert.equal(soon[1].late, false);
  assert.equal(soon[2].daysLeft, 4);
  // 끝난 것과 날짜 없는 것은 손 갈 일이 아니다.
  assert.equal(soon.some(item => item.id === "done" || item.id === "nodate"), false);
  // 며칠 앞을 볼지 바꿀 수 있다.
  assert.deepEqual(P.dueSoon(list, "2026-09-06", 0).map(item => item.id), ["late", "today"]);
  assert.equal(P.dueSoon(list, "").length, 0);
});

test("누가 몇 건 물고 있는지 센다", () => {
  // 이게 없으면 일을 나눠 줄 때 감으로 하게 된다.
  const at = (id, uid, name, dueDate, patch = {}) => order(Object.assign({
    id, title: `일 ${id}`, assigneeUid: uid, assigneeName: name, dueDate,
  }, patch));
  const list = [
    at("a", "u1", "황우중", "2026-09-01"),
    at("b", "u1", "황우중", "2026-09-08"),
    at("c", "u1", "황우중", "2026-10-30"),
    at("d", "u2", "김현진", "2026-09-09"),
    at("e", "u2", "김현진", "2026-09-02", { status: "submitted" }),
    at("f", "", "", "2026-09-03"),
  ];
  const board = P.byAssignee(list, "2026-09-06");
  // 담당자 없는 것이 맨 위다. 사람 목록에서 빠지면 아무도 안 본다.
  assert.equal(board[0].name, "담당자 없음");
  assert.equal(board[0].open, 1);
  // 그 다음은 기한 지난 것이 많은 사람부터.
  assert.equal(board[1].name, "황우중");
  assert.equal(board[1].open, 3);
  assert.equal(board[1].overdue, 1);
  assert.equal(board[1].soon, 1, "이번 주 안에 오는 것");
  const kim = board.find(row => row.name === "김현진");
  assert.equal(kim.open, 1);
  assert.equal(kim.waitingReview, 1, "제출한 것은 대표가 볼 차례라 물고 있는 것이 아니다");
  assert.equal(kim.overdue, 0);
});

test("진행률은 사람마다 평균으로 낸다", () => {
  const at = (id, progress) => order({ id, title: id, assigneeUid: "u1", assigneeName: "황우중", progress });
  const board = P.byAssignee([at("a", 100), at("b", 0), at("c", 50)], "2026-09-06");
  assert.equal(board[0].progress, 50);
  assert.equal(board[0].total, 3);
});

test("손이 가야 하는 상태 목록이 한 곳에만 있다", () => {
  // 여기저기 늘어놓으면 한 곳만 고치고 끝난다.
  assert.deepEqual(P.OPEN_STATUSES.slice(), ["assigned", "doing", "returned"]);
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/project-core.js"), "utf8");
  assert.equal((source.match(/"assigned", "doing", "returned"/gu) || []).length, 1);
});

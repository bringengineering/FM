const assert = require("node:assert/strict");
const test = require("node:test");

const G = require("../src/growth-core");

const members = [
  { uid: "u-seo", displayName: "서창환" },
  { uid: "u-hwang", displayName: "황우중" },
  { uid: "u-kim", displayName: "김현진" },
];
const checkin = (patch = {}) => Object.assign({
  id: "c1", uid: "u-hwang", name: "황우중", week: "2026-08-31",
  answers: { done: "햇빛빌라 계단청소", stuck: "", next: "입주청소 두 건", grow: "결과보고서 혼자 내기" },
}, patch);
const review = (patch = {}) => Object.assign({
  id: "r1", uid: "u-hwang", name: "황우중", quarter: "2026-Q3", level: "L2",
  skills: { field: "L3", owner: "L2", record: "L2", plan: "L2", tool: "L2", biz: "L2" },
  did: "계단청소 12건", nextStep: "건물 한 채를 통째로 맡아 본다",
}, patch);

test("레벨은 호칭이 아니라 무엇을 혼자 할 수 있는가로 가른다", () => {
  // 다섯 사람 회사에서 "과장" 은 뜻이 없다.
  assert.deepEqual(G.LEVEL_KEYS, ["L1", "L2", "L3", "L4", "L5"]);
  G.LEVELS.forEach(level => {
    assert.ok(level.scope.length > 3, `${level.key} 에 범위가 없다`);
    assert.ok(level.signs.length >= 3, `${level.key} 에 무엇을 보고 아는지가 없다`);
  });
  // 브링이 실제로 하는 일로 적혀 있어야 한다. 일반론이면 아무도 자기
  // 이야기로 안 읽는다.
  const all = G.LEVELS.flatMap(level => level.signs).join(" ");
  assert.match(all, /청소/u);
  assert.match(all, /건물주|건물 한 채/u);
});

test("다음 레벨이 무엇인지 말해 준다", () => {
  // 작은 회사에서 성장이 막히는 까닭은 기회가 없어서가 아니라 다음 단계가
  // 안 적혀 있어서다.
  assert.equal(G.nextLevel("L2").key, "L3");
  assert.equal(G.nextLevel("L5"), null, "맨 위에서는 다음이 없다");
  assert.equal(G.nextLevel("아무거나"), null);
});

test("역량은 점수가 아니라 레벨로 적는다", () => {
  // 사람에게 숫자를 붙이면 그 숫자를 지키려고 일한다.
  const made = G.normalizeReview(review({ skills: { field: 5, owner: "L3" } }));
  assert.equal(made.skills.field, "", "숫자는 안 받는다");
  assert.equal(made.skills.owner, "L3");
});

test("레벨을 이름만 올린 것을 잡아낸다", () => {
  // 레벨은 올려 놓고 역량이 다 그 아래면 본인이 제일 먼저 안다.
  const fake = G.levelGap(review({ level: "L4" }));
  assert.equal(fake.supported, false);
  assert.ok(fake.below.length >= 4, JSON.stringify(fake.below));
  const real = G.levelGap(review({ level: "L2" }));
  assert.equal(real.supported, true);
  assert.deepEqual(real.below, []);
});

test("안 적은 역량은 없는 척하지 않는다", () => {
  const gap = G.levelGap(review({ skills: { field: "L2" } }));
  assert.equal(gap.supported, false);
  assert.ok(gap.missing.length === 5, JSON.stringify(gap.missing));
});

test("무슨 요일에 적든 같은 주에 놓인다", () => {
  // 사람마다 다른 날 적으면 줄이 안 맞고, 줄이 안 맞으면 흐름이 안 보인다.
  assert.equal(G.weekStart("2026-08-31"), "2026-08-31", "월요일");
  assert.equal(G.weekStart("2026-09-02"), "2026-08-31", "수요일");
  assert.equal(G.weekStart("2026-09-04"), "2026-08-31", "금요일");
  assert.equal(G.weekStart("2026-09-06"), "2026-08-31", "일요일도 그 주에 붙는다");
  assert.equal(G.weekStart("2026-09-07"), "2026-09-07", "다음 월요일");
  assert.equal(G.weekStart("아무거나"), "");
});

test("매주 같은 것을 묻는다", () => {
  // 매번 다른 것을 물으면 흐름이 안 보이고, 흐름이 안 보이면 분기 끝에
  // 기억으로 평가하게 된다.
  assert.deepEqual(G.QUESTION_KEYS, ["done", "stuck", "next", "grow"]);
  G.CHECKIN_QUESTIONS.forEach(item => assert.ok(item.hint.length > 5, item.key));
});

test("빈 기록은 남기지 않는다", () => {
  assert.equal(G.validateCheckin(checkin({ answers: {} })).code, "ANSWER_REQUIRED");
  assert.equal(G.validateCheckin(checkin({ week: "" })).code, "WEEK_REQUIRED");
  assert.equal(G.validateCheckin(checkin({ uid: "" })).code, "UID_REQUIRED");
  assert.equal(G.validateCheckin(checkin()).ok, true);
});

test("다음에 무엇을 배울지 없는 평가는 받지 않는다", () => {
  // 그건 평가가 아니라 성적표다.
  const made = G.validateReview(review({ nextStep: "" }));
  assert.equal(made.ok, false);
  assert.equal(made.code, "NEXT_STEP_REQUIRED");
  assert.match(made.error, /성적표/u);
});

test("이번 주에 누구와 이야기 안 했는지 센다", () => {
  // 1on1 은 바쁘면 제일 먼저 빠진다. 빠진 것이 눈에 보여야 안 빠진다.
  const missing = G.missingCheckins(members, [checkin({ uid: "u-hwang" })], "2026-09-02");
  assert.deepEqual(missing.map(item => item.uid).sort(), ["u-kim", "u-seo"]);
  // 지난주 기록은 이번 주를 채워 주지 않는다.
  assert.equal(G.missingCheckins(members, [checkin({ week: "2026-08-24" })], "2026-09-02").length, 3);
});

test("같은 것에 계속 막혀 있으면 드러난다", () => {
  // 두 주째 같은 말이면 그건 치워 주지 않은 것이다.
  const stuck = week => checkin({ id: week, week, answers: { stuck: "건물주가 전화를 안 받습니다" } });
  const trail = G.personTrail("u-hwang", { checkins: [stuck("2026-08-31"), stuck("2026-08-24")], reviews: [] });
  assert.equal(trail.repeatedStuck, true);
  const varied = G.personTrail("u-hwang", {
    checkins: [checkin({ id: "a", week: "2026-08-31", answers: { stuck: "장비가 모자랍니다" } }),
               checkin({ id: "b", week: "2026-08-24", answers: { stuck: "건물주가 전화를 안 받습니다" } })],
    reviews: [],
  });
  assert.equal(varied.repeatedStuck, false);
});

test("한 사람의 흐름을 최근 것부터 본다", () => {
  const trail = G.personTrail("u-hwang", {
    checkins: [checkin({ id: "a", week: "2026-08-24" }), checkin({ id: "b", week: "2026-08-31" })],
    reviews: [review({ id: "old", quarter: "2026-Q2", level: "L1" }), review({ id: "new", quarter: "2026-Q3", level: "L2" })],
  });
  assert.deepEqual(trail.checkins.map(item => item.week), ["2026-08-31", "2026-08-24"]);
  assert.equal(trail.level, "L2", "가장 최근 분기 것을 쓴다");
  assert.equal(trail.nextLevel.key, "L3");
  assert.equal(trail.weeks, 2);
  assert.equal(trail.lastWeek, "2026-08-31");
});

test("평가가 없으면 맨 아래에서 시작한다", () => {
  const trail = G.personTrail("u-new", { checkins: [], reviews: [] });
  assert.equal(trail.level, "L1");
  assert.equal(trail.gap, null);
});

test("팀이 어느 레벨에 서 있는지 한 장에서 본다", () => {
  const board = G.ladder(members, [review({ uid: "u-hwang", level: "L2" }), review({ id: "r2", uid: "u-seo", level: "L5" })]);
  assert.equal(board.length, 5);
  const at = key => board.find(row => row.level.key === key).people.map(person => person.uid);
  assert.deepEqual(at("L2"), ["u-hwang"]);
  assert.deepEqual(at("L5"), ["u-seo"]);
  // 평가가 없는 사람은 L1 에 선다. 목록에서 사라지면 안 된다.
  assert.deepEqual(at("L1"), ["u-kim"]);
});

test("옛 평가가 새 평가를 덮지 않는다", () => {
  const board = G.ladder(members, [
    review({ id: "new", uid: "u-hwang", quarter: "2026-Q3", level: "L3" }),
    review({ id: "old", uid: "u-hwang", quarter: "2026-Q1", level: "L1" }),
  ]);
  const at = key => board.find(row => row.level.key === key).people.map(person => person.uid);
  assert.deepEqual(at("L3"), ["u-hwang"]);
  assert.equal(at("L1").includes("u-hwang"), false);
});

test("급여는 여기서 다루지 않는다", () => {
  // 브링 CRM 에 회사 재무는 올리지 않는다.
  const source = require("fs").readFileSync(require("path").join(__dirname, "../src/growth-core.js"), "utf8");
  const made = G.normalizeReview(review({ salary: 3000000, pay: 1 }));
  assert.equal(Object.prototype.hasOwnProperty.call(made, "salary"), false);
  assert.doesNotMatch(source, /salary|급여액|연봉/u);
});

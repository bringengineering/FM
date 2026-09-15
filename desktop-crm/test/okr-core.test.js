const assert = require("node:assert/strict");
const test = require("node:test");

const O = require("../src/okr-core");
const P = require("../src/project-core");

const kr = (patch = {}) => Object.assign({ id: "k1", title: "계약 건수", unit: "count", baseline: 0, target: 10, current: 0 }, patch);
const objective = (patch = {}) => Object.assign({
  id: "o1", quarter: "2026-Q3", title: "원주에서 계단청소를 자리잡힌 일로 만든다",
  ownerUid: "u-seo", ownerName: "서창환", track: "biz", status: "active",
  keyResults: [kr()], projectIds: ["p1"],
}, patch);

test("분기를 날짜에서 뽑는다", () => {
  assert.equal(O.quarterOf("2026-09-06"), "2026-Q3");
  assert.equal(O.quarterOf("2026-01-01"), "2026-Q1");
  assert.equal(O.quarterOf("2026-12-31"), "2026-Q4");
  assert.equal(O.quarterOf("아무거나"), "");
  assert.deepEqual(O.quarterRange("2026-Q3"), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(O.quarterRange("2026-Q1"), { from: "2026-01-01", to: "2026-03-31" });
  // 윤년 2월을 틀리면 1분기 마감일이 하루 어긋난다.
  assert.equal(O.quarterRange("2028-Q1").to, "2028-03-31");
});

test("핵심결과가 없는 목표는 세울 수 없다", () => {
  // 재지 못하면 분기 끝에 서로 다른 말을 하게 된다.
  const made = O.validateObjective(objective({ keyResults: [] }));
  assert.equal(made.ok, false);
  assert.equal(made.code, "KEY_RESULT_REQUIRED");
  assert.match(made.error, /무엇으로 다 했다고 볼지/u);
});

test("잴 수 없는 핵심결과는 받지 않는다", () => {
  // "잘하기" 는 핵심결과가 아니다. 지금 값과 목표가 같으면 잴 수가 없다.
  const made = O.validateKeyResult(kr({ baseline: 5, target: 5 }));
  assert.equal(made.ok, false);
  assert.equal(made.code, "TARGET_REQUIRED");
  assert.equal(O.validateKeyResult(kr({ title: "" })).code, "TITLE_REQUIRED");
});

test("책임질 사람이 없는 목표는 못 세운다", () => {
  assert.equal(O.validateObjective(objective({ ownerUid: "" })).code, "OWNER_REQUIRED");
  assert.equal(O.validateObjective(objective({ quarter: "2026-13" })).code, "QUARTER_REQUIRED");
});

test("진척도를 사람이 적지 않는다", () => {
  // 적게 두면 100% 라고 적힌 칸 아래에 아무것도 안 되어 있는 일이 난다.
  assert.equal(O.keyResultProgress(kr({ current: 0 })), 0);
  assert.equal(O.keyResultProgress(kr({ current: 7 })), 0.7);
  assert.equal(O.keyResultProgress(kr({ current: 10 })), 1);
  // 시작점이 0 이 아닐 때. 8에서 10 으로 가는 것은 9 면 절반이다.
  assert.equal(O.keyResultProgress(kr({ baseline: 8, target: 10, current: 9 })), 0.5);
  // 줄여야 하는 것도 잰다. 민원 12건에서 4건으로.
  assert.equal(O.keyResultProgress(kr({ baseline: 12, target: 4, current: 8 })), 0.5);
});

test("초과 달성을 깎지 않는다", () => {
  // 1.0 으로 깎으면 목표를 훌쩍 넘긴 것이 안 보인다. 그건 다음 분기에
  // 목표를 다시 잡을 때 필요한 정보다.
  assert.equal(O.keyResultProgress(kr({ current: 13 })), 1.3);
  // 뒷걸음질은 0 으로 둔다. 음수 진척도는 뜻이 없다.
  assert.equal(O.keyResultProgress(kr({ baseline: 5, target: 10, current: 2 })), 0);
});

test("목표 진척도는 핵심결과 평균이다", () => {
  const made = objective({ keyResults: [kr({ id: "a", current: 10 }), kr({ id: "b", current: 4 })] });
  assert.equal(O.objectiveProgress(made), 0.7);
  assert.equal(O.objectiveProgress(objective({ keyResults: [] })), 0);
});

test("0.7 이 잘한 것이라고 말해 준다", () => {
  // 팀원이 1.0 을 못 채웠다고 스스로를 깎지 않게 한다. 반대로 다 1.0 이면
  // 목표를 낮게 잡은 것이고, 그것도 말해 줘야 다음 분기가 나아진다.
  assert.equal(O.gradeOf(0.75).key, "good");
  assert.match(O.gradeOf(0.75).label, /잘 했습니다/u);
  assert.equal(O.gradeOf(1).key, "over");
  assert.match(O.gradeOf(1).label, /낮게 잡았습니다/u);
  assert.equal(O.gradeOf(0.5).key, "fair");
  assert.equal(O.gradeOf(0.1).key, "poor");
});

test("단위마다 다르게 읽힌다", () => {
  assert.equal(O.formatValue(1200000, "krw"), "1,200,000원");
  assert.equal(O.formatValue(72.55, "percent"), "72.6%");
  assert.equal(O.formatValue(10, "count"), "10건");
  assert.equal(O.formatValue(3, "day"), "3일");
});

test("책임자는 정확히 한 사람이다", () => {
  // 둘이면 아무도 책임지지 않는다. 이것이 RACI 의 요지다.
  const two = O.normalizeRaci({ R: ["u1"], A: ["u2", "u3"], C: [], I: [] });
  assert.deepEqual(two.A, ["u2"], "둘째부터는 잘라낸다");
  assert.equal(O.validateRaci({ R: ["u1"], A: [] }).code, "ACCOUNTABLE_REQUIRED");
  assert.equal(O.validateRaci({ R: [], A: ["u2"] }).code, "RESPONSIBLE_REQUIRED");
  assert.equal(O.validateRaci({ R: ["u1"], A: ["u2"] }).ok, true);
});

test("같은 사람을 두 번 넣지 않는다", () => {
  assert.deepEqual(O.normalizeRaci({ R: ["u1", "u1", "u2"], A: ["u3"] }).R, ["u1", "u2"]);
});

test("책임이 한 사람에게 몰렸는지 센다", () => {
  // 몰려 있으면 그 사람이 병목이다. 팀원에게 책임을 나눠 주는 것이
  // 이 체계로 하려는 일이다.
  const orders = [
    { id: "1", raci: { R: ["u-hwang"], A: ["u-seo"] } },
    { id: "2", raci: { R: ["u-kim"], A: ["u-seo"] } },
    { id: "3", raci: { R: ["u-seo"], A: ["u-hwang"], C: ["u-kim"] } },
  ];
  const load = O.raciLoad(orders, [
    { uid: "u-seo", displayName: "서창환" },
    { uid: "u-hwang", displayName: "황우중" },
    { uid: "u-kim", displayName: "김현진" },
  ]);
  assert.equal(load[0].uid, "u-seo", "책임을 많이 쥔 사람이 위로");
  assert.equal(load[0].A, 2);
  assert.equal(load[0].R, 1);
  assert.equal(load.find(item => item.uid === "u-kim").C, 1);
});

test("어느 목표에도 안 붙은 일을 따로 센다", () => {
  // 이것이 이 화면이 답해야 하는 질문이다 — 지금 하는 일 중에 무엇이
  // 목표와 상관없는가.
  const view = O.quarterView({
    quarter: "2026-Q3",
    objectives: [objective()],
    projects: [{ id: "p1", name: "브링 케어" }, { id: "p2", name: "회사 서버" }],
    orders: [
      { id: "w1", projectId: "p1", status: "doing" },
      { id: "w2", projectId: "p2", status: "doing" },
      { id: "w3", projectId: "", status: "assigned" },
    ],
  });
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].orderCount, 1);
  assert.deepEqual(view.looseProjects.map(item => item.id), ["p2"], "목표에 안 붙은 프로젝트");
  assert.deepEqual(view.looseOrders.map(item => item.id), ["w3"], "프로젝트에 안 붙은 업무");
});

test("다른 분기 목표는 섞이지 않는다", () => {
  const view = O.quarterView({
    quarter: "2026-Q3",
    objectives: [objective(), objective({ id: "o2", quarter: "2026-Q2" })],
    projects: [], orders: [],
  });
  assert.equal(view.objectiveCount, 1);
});

test("덜 된 목표가 위로 온다", () => {
  // 잘 되고 있는 것을 먼저 보여 주면 손볼 것을 못 본다.
  const view = O.quarterView({
    quarter: "2026-Q3",
    objectives: [
      objective({ id: "a", keyResults: [kr({ current: 9 })] }),
      objective({ id: "b", keyResults: [kr({ current: 2 })] }),
    ],
    projects: [], orders: [],
  });
  assert.deepEqual(view.cards.map(card => card.objective.id), ["b", "a"]);
});

test("분기 전체 점수는 진행 중인 목표만 센다", () => {
  // 초안과 마감을 섞으면 분기 초에는 늘 0% 로 보인다.
  const view = O.quarterView({
    quarter: "2026-Q3",
    objectives: [
      objective({ id: "a", status: "active", keyResults: [kr({ current: 8 })] }),
      objective({ id: "b", status: "draft", keyResults: [kr({ current: 0 })] }),
    ],
    projects: [], orders: [],
  });
  assert.equal(view.activeCount, 1);
  assert.equal(view.average, 0.8);
  assert.equal(view.grade.key, "good");
});

test("한 사람이 이번 분기에 무엇에 닿아 있는지 본다", () => {
  // 1on1 에서 같이 보는 줄이다. "네가 하는 일이 회사의 무엇에 닿는가."
  const input = {
    quarter: "2026-Q3",
    objectives: [objective({ ownerUid: "u-seo", keyResults: [kr({ id: "k1", ownerUid: "u-hwang" })] })],
    projects: [{ id: "p1", name: "브링 케어" }],
    orders: [
      { id: "w1", projectId: "p1", raci: { R: ["u-hwang"], A: ["u-seo"] } },
      { id: "w2", projectId: "p1", raci: { R: ["u-kim"], A: ["u-hwang"] } },
    ],
  };
  const hwang = O.personView("u-hwang", input);
  assert.equal(hwang.ownedObjectives.length, 0, "목표 주인은 아니다");
  assert.equal(hwang.keyResults.length, 1, "핵심결과 하나를 쥐고 있다");
  assert.equal(hwang.keyResults[0].keyResult.id, "k1");
  assert.equal(hwang.responsible, 1);
  assert.equal(hwang.accountable, 1);
  const seo = O.personView("u-seo", input);
  assert.equal(seo.ownedObjectives.length, 1);
});

test("트랙 이름이 프로젝트 관리와 같다", () => {
  // 어긋나면 같은 일이 두 화면에서 다른 칸에 놓인다.
  const made = O.normalizeObjective(objective({ track: "biz" }));
  assert.ok(P.TRACKS.some(track => track.key === made.track), "biz 가 프로젝트 트랙에 있어야 한다");
});

test("모르는 값은 안전한 쪽으로 떨어진다", () => {
  const made = O.normalizeObjective({ id: "x", status: "아무거나", keyResults: [{ id: "k", unit: "아무거나" }] });
  assert.equal(made.status, "draft", "모르면 초안이다 — 진행으로 두면 안 센 목표가 점수에 들어간다");
  assert.equal(made.keyResults[0].unit, "count");
});

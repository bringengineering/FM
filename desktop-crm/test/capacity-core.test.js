const assert = require("node:assert/strict");
const test = require("node:test");

const C = require("../src/capacity-core");

const person = (patch = {}) => Object.assign({
  uid: "u-kim", name: "김현진",
  window: { start: "09:00", end: "22:00" },
  workDays: [1, 2, 3, 4, 5],
  blocks: [],
}, patch);

const cls = (day, start, end, patch = {}) =>
  Object.assign({ id: `${day}-${start}`, day, start, end, label: "수업" }, patch);

test("수업을 빼고 하루 가용시간을 낸다", () => {
  // 09~22 창에서 13~15 수업 두 시간을 뺀다.
  const day = C.dayCapacity(person({ blocks: [cls(1, "13:00", "15:00")] }), 1);
  assert.equal(day.hours, 11);
  assert.deepEqual(day.slots.map(slot => `${slot.start}-${slot.end}`), ["09:00-13:00", "15:00-22:00"]);
});

test("짧은 틈은 가용시간으로 세지 않는다", () => {
  // 13~15, 15:40~18. 사이 40분은 표에서는 0.7시간이지만 그 시간에 되는 일은 없다.
  const day = C.dayCapacity(person({ blocks: [cls(1, "13:00", "15:00"), cls(1, "15:40", "18:00")] }), 1);
  assert.deepEqual(day.slots.map(slot => `${slot.start}-${slot.end}`), ["09:00-13:00", "18:00-22:00"]);
  assert.equal(day.hours, 8);
  // 40분을 더해 8.7 이라고 적었다면 그 주는 반드시 밀린다.
  assert.notEqual(day.hours, 8.5);
});

test("정확히 60분인 틈은 남긴다", () => {
  const day = C.dayCapacity(person({ blocks: [cls(1, "13:00", "15:00"), cls(1, "16:00", "18:00")] }), 1);
  assert.deepEqual(day.slots.map(slot => `${slot.start}-${slot.end}`), ["09:00-13:00", "15:00-16:00", "18:00-22:00"]);
  assert.equal(day.hours, 9);
});

test("겹치는 수업을 두 번 빼지 않는다", () => {
  const day = C.dayCapacity(person({ blocks: [cls(1, "13:00", "15:00"), cls(1, "14:00", "16:00")] }), 1);
  // 13~16 세 시간이지 13~15 와 14~16 을 더한 네 시간이 아니다.
  assert.equal(day.hours, 10);
});

test("창 밖에 있는 수업은 가용시간을 깎지 않는다", () => {
  const day = C.dayCapacity(person({ window: { start: "13:00", end: "22:00" }, blocks: [cls(1, "08:00", "11:00")] }), 1);
  assert.equal(day.hours, 9);
});

test("일하는 날이 아니면 0 이다", () => {
  const day = C.dayCapacity(person(), 6);
  assert.equal(day.working, false);
  assert.equal(day.hours, 0);
});

test("빠져도 되는 수업은 기본 가용시간에서 빼되 따로 알린다", () => {
  const day = C.dayCapacity(person({ blocks: [cls(1, "13:00", "15:00", { skippable: true })] }), 1);
  // 기본은 수업을 다 듣는 쪽이다. 처음부터 빼면 매주 빠지는 것을 전제로 계획이 짜인다.
  assert.equal(day.hours, 11);
  assert.equal(day.flexibleHours, 2);
});

test("빠져도 되는 수업을 빼면 짧던 조각이 살아난다", () => {
  // 13~15 는 빠져도 되고 15:40~18 은 못 뺀다. 다 들으면 사이 40분은 버려지지만,
  // 앞 수업을 빼면 09~15:40 이 한 덩어리가 되어 40분이 살아난다.
  const day = C.dayCapacity(person({
    blocks: [cls(1, "13:00", "15:00", { skippable: true }), cls(1, "15:40", "18:00")],
  }), 1);
  assert.equal(day.hours, 8);
  assert.equal(day.flexibleHours, 2.5);
});

test("주간 합계는 하루치를 더한 값이다", () => {
  const week = C.weekCapacity(person({ blocks: [cls(1, "13:00", "15:00"), cls(2, "09:00", "12:00")] }));
  // 월 11 + 화 10 + 수목금 각 13 = 60
  assert.equal(week.hours, 60);
  assert.equal(week.registered, true);
});

test("시간표를 안 넣은 사람은 등록 안 된 것으로 본다", () => {
  const week = C.weekCapacity(person({ blocks: [] }));
  assert.equal(week.registered, false);
});

// --- 이번 주 부하 ---

const order = (patch = {}) => Object.assign({
  id: "o1", assigneeUid: "u-kim", status: "assigned",
  startDate: "2026-09-07", dueDate: "2026-09-11", hours: 4,
}, patch);

test("주는 월요일에 시작한다", () => {
  assert.equal(C.weekStart("2026-09-06"), "2026-08-31"); // 일요일
  assert.equal(C.weekStart("2026-09-07"), "2026-09-07"); // 월요일
  assert.equal(C.weekStart("2026-09-11"), "2026-09-07");
  assert.deepEqual(C.weekRange("2026-09-09"), { from: "2026-09-07", to: "2026-09-13" });
});

test("이번 주에 걸친 지시의 시간을 더한다", () => {
  const load = C.personLoad({
    person: person({ blocks: [cls(1, "13:00", "15:00")] }),
    orders: [order(), order({ id: "o2", hours: 6 }), order({ id: "o3", hours: 5, dueDate: "2026-10-30", startDate: "2026-10-01" })],
    asOf: "2026-09-09",
  });
  assert.equal(load.orders, 2);
  assert.equal(load.assignedHours, 10);
});

test("끝난 지시는 이번 주 부하에 넣지 않는다", () => {
  const load = C.personLoad({
    person: person(),
    orders: [order({ status: "done", hours: 40 }), order({ id: "o2", status: "submitted", hours: 40 })],
    asOf: "2026-09-09",
  });
  assert.equal(load.assignedHours, 0);
});

test("시간을 안 적은 지시는 조용히 0 으로 세지 않고 따로 알린다", () => {
  const load = C.personLoad({
    person: person(),
    orders: [order({ hours: 0 }), order({ id: "o2", hours: 3 })],
    asOf: "2026-09-09",
  });
  assert.equal(load.untimed, 1);
  assert.equal(load.assignedHours, 3);
});

test("시간표가 없으면 비율을 내지 않는다", () => {
  const load = C.personLoad({ person: person({ blocks: [] }), orders: [order()], asOf: "2026-09-09" });
  // 0 으로 나눈 결과를 보여 주면 등록 안 한 사람이 늘 넘침으로 뜬다.
  assert.equal(load.ratio, null);
  assert.equal(load.verdict.key, "unknown");
  assert.match(load.verdict.hint, /시간표를 넣어야/u);
});

test("넘치면 넘친다고 하고, 수업을 빼서 맞출 수 있으면 그렇게 말한다", () => {
  // 월 13~22 만 일하는 사람. 주 가용 9시간, 그중 3시간은 빼도 되는 수업.
  const student = person({
    workDays: [1],
    window: { start: "09:00", end: "22:00" },
    blocks: [cls(1, "09:00", "13:00", { skippable: true })],
  });
  const tight = C.personLoad({ person: student, orders: [order({ hours: 11 })], asOf: "2026-09-09" });
  assert.equal(tight.hours, 9);
  assert.equal(tight.flexibleHours, 4);
  assert.equal(tight.verdict.key, "over");
  assert.match(tight.verdict.hint, /빠져도 되는 수업을 빼면/u);

  const hopeless = C.personLoad({ person: student, orders: [order({ hours: 30 })], asOf: "2026-09-09" });
  assert.equal(hopeless.verdict.key, "over");
  assert.match(hopeless.verdict.hint, /일을 덜거나 마감을 미뤄야/u);
});

test("여유·적정·빠듯을 나눈다", () => {
  // 저장된 기록이 있으면 수업이 하나도 없어도 등록된 것이다.
  const p = person({ workDays: [1], blocks: [], updatedAt: "2026-09-06T00:00:00Z" }); // 월 09~22 = 13시간
  const at = hours => C.personLoad({ person: p, orders: [order({ hours })], asOf: "2026-09-09" }).verdict.key;
  assert.equal(at(3), "room");
  assert.equal(at(8), "fit");
  assert.equal(at(12), "tight");
  assert.equal(at(14), "over");
});

test("손봐야 할 사람부터 위로 올린다", () => {
  const saved = "2026-09-06T00:00:00Z";
  const busy = person({ uid: "u-a", name: "가", workDays: [1], blocks: [], updatedAt: saved });
  const idle = person({ uid: "u-b", name: "나", workDays: [1], blocks: [], updatedAt: saved });
  const unknown = person({ uid: "u-c", name: "다", blocks: [] });
  const board = C.loadBoard({
    people: [idle, unknown, busy],
    orders: [order({ assigneeUid: "u-a", hours: 20 }), order({ id: "o2", assigneeUid: "u-b", hours: 2 })],
    asOf: "2026-09-09",
  });
  assert.deepEqual(board.map(row => row.verdict.key), ["over", "unknown", "room"]);
});

// --- 견본 시간표 ---

test("견본 시간표를 이름으로 찾는다", () => {
  const kim = C.seedFor("김현진");
  assert.ok(kim);
  assert.equal(kim.blocks.length, 11);
  // 김현진의 수업은 빠지지 않는 것으로 본다.
  assert.equal(kim.blocks.every(block => block.skippable === false), true);

  const seo = C.seedFor("서창환");
  assert.ok(seo);
  // 대표는 빠져도 되는 수업이 있다고 했다.
  assert.equal(seo.blocks.every(block => block.skippable === true), true);

  assert.equal(C.seedFor("없는사람"), null);
});

test("견본 시간표가 실제로 계산된다", () => {
  const kim = C.weekCapacity(C.seedFor("김현진"));
  // 시간표를 넣은 값이 0 이거나 창 전체와 같으면 어딘가 안 붙은 것이다.
  assert.ok(kim.hours > 0 && kim.hours < 65);
  const 목 = kim.days.find(day => day.day === 4);
  // 목요일 09~12 방재학개론, 15~17 수문학. 12~15 세 시간과 17~22 다섯 시간이 남는다.
  assert.deepEqual(목.slots.map(slot => `${slot.start}-${slot.end}`), ["12:00-15:00", "17:00-22:00"]);
});

test("견본을 고쳐도 다음에 다시 꺼낼 때 원본이 남아 있다", () => {
  const first = C.seedFor("김현진");
  first.blocks.length = 0;
  first.name = "바뀜";
  const second = C.seedFor("김현진");
  assert.equal(second.blocks.length, 11);
  assert.equal(second.name, "김현진");
});

test("가중치 합을 보여 주되 저장을 막지는 않는다", () => {
  const load = C.personLoad({
    person: person(),
    orders: [order({ weight: 60 }), order({ id: "o2", weight: 30 })],
    asOf: "2026-09-09",
  });
  assert.equal(load.weightTotal, 90);
  assert.equal(load.weightOk, false);

  const done = C.personLoad({
    person: person(),
    orders: [order({ weight: 60 }), order({ id: "o2", weight: 40 })],
    asOf: "2026-09-09",
  });
  assert.equal(done.weightTotal, 100);
  assert.equal(done.weightOk, true);
});

test("지시가 없는 주는 가중치를 문제 삼지 않는다", () => {
  // 합 0 을 "100 이 아님" 이라고 빨갛게 칠하면 아무 일도 없는 주에 경고가 뜬다.
  const load = C.personLoad({ person: person(), orders: [], asOf: "2026-09-09" });
  assert.equal(load.weightTotal, 0);
  assert.equal(load.weightOk, true);
});

test("가용시간을 잡아먹지 않는 프로젝트는 부하에서 뺀다", () => {
  // 수업 시간은 시간표에서 이미 빠졌다. 여기에 "수강 7시간" 을 또 더하면
  // 같은 시간을 두 번 세고, 학생은 무엇을 하든 늘 넘침으로 뜬다.
  const orders = [order({ hours: 4, projectId: "pj-crm" }), order({ id: "o2", hours: 7, projectId: "pj-study" })];
  const counted = C.personLoad({ person: person(), orders, asOf: "2026-09-09" });
  assert.equal(counted.assignedHours, 11);
  const excluded = C.personLoad({ person: person(), orders, asOf: "2026-09-09", offCapacityProjectIds: ["pj-study"] });
  assert.equal(excluded.assignedHours, 4);
  assert.equal(excluded.orders, 1);
});

const assert = require("node:assert/strict");
const test = require("node:test");

const D = require("../src/weekly-directive-core");

const order = (patch = {}) => Object.assign({
  id: "o1", title: "3층 누수 확인", assigneeUid: "u-hwang", status: "assigned",
  startDate: "2026-09-07", dueDate: "2026-09-11",
  hours: 8, weight: 100, deliverable: "20260911_3층누수_점검결과.xlsx",
}, patch);

const directive = (patch = {}) => Object.assign({
  uid: "u-hwang", name: "황우중", weekStart: "2026-09-07",
  background: "임차인이 두 번 민원을 넣었고 다음 주에 갱신 면담이 있습니다.",
  goal: "누수 원인이 확인되고 건물주에게 보고가 나가 있습니다.",
}, patch);

test("주는 월요일에 시작하고, 아무 날을 넣어도 그 주 월요일로 잡힌다", () => {
  assert.equal(D.weekStart("2026-09-09"), "2026-09-07");
  assert.equal(D.weekStart("2026-09-13"), "2026-09-07"); // 일요일
  assert.equal(D.weekStart("2026-09-07"), "2026-09-07");
  assert.equal(D.normalizeDirective({ weekStart: "2026-09-10" }).weekStart, "2026-09-07");
});

test("누구 것인지 언제 것인지만 있으면 저장된다", () => {
  // 내용이 덜 찼다고 저장을 막으면 쓰다 말고 화면을 떠날 수 없다.
  const made = D.validateDirective({ uid: "u-hwang", weekStart: "2026-09-09" });
  assert.equal(made.ok, true);
  assert.equal(made.directive.id, "u-hwang_2026-09-07");
  assert.equal(D.validateDirective({ weekStart: "2026-09-07" }).code, "UID_REQUIRED");
  assert.equal(D.validateDirective({ uid: "u-hwang" }).code, "WEEK_REQUIRED");
});

test("지시를 복사해 두지 않고 그때그때 다시 모은다", () => {
  const sheet = D.assemble({
    directive: directive(),
    orders: [
      order(),
      order({ id: "o2", assigneeUid: "u-kim" }),                                  // 남의 것
      order({ id: "o3", startDate: "2026-10-01", dueDate: "2026-10-05" }),          // 다른 주
      order({ id: "o4", startDate: "", dueDate: "" }),                             // 날짜가 없다
    ],
  });
  assert.deepEqual(sheet.orders.map(item => item.id), ["o1"]);
  // 담아 두는 것이 아니라 모아서 보여 주는 것이라, 지시서 안에 사본이 없다.
  assert.ok(!("tasks" in sheet.directive));
});

test("무거운 것부터 위로 올린다", () => {
  const sheet = D.assemble({
    directive: directive(),
    orders: [
      order({ id: "a", title: "가벼운 것", weight: 20, dueDate: "2026-09-08" }),
      order({ id: "b", title: "무거운 것", weight: 50 }),
      order({ id: "c", title: "중간", weight: 30 }),
    ],
  });
  assert.deepEqual(sheet.orders.map(item => item.id), ["b", "c", "a"]);
  assert.equal(sheet.weightTotal, 100);
  assert.equal(sheet.weightOk, true);
});

test("끝난 지시도 그 주 지시서에는 남는다", () => {
  // 한 주가 끝나고 보면 완료한 것도 그 주에 한 일이다. 빼면 지시서가 그 주에
  // 무엇을 했는지 못 보여 준다.
  const sheet = D.assemble({ directive: directive(), orders: [order({ status: "done" }), order({ id: "o2", status: "submitted", weight: 0 })] });
  assert.equal(sheet.orders.length, 2);
});

// --- 내보낼 수 있는가 ---

test("왜 하는지와 무엇이 달라지는지가 없으면 못 낸다", () => {
  // 애들이 헷갈린 이유가 바로 이 둘이 없어서였다.
  const check = D.readiness({ directive: directive({ background: "", goal: "" }), orders: [order()] });
  assert.equal(check.ok, false);
  assert.ok(check.missing.some(note => /왜 이번 주에 이것을 하는지/u.test(note)));
  assert.ok(check.missing.some(note => /무엇이 달라져 있는지/u.test(note)));
});

test("모자란 것을 한꺼번에 말한다", () => {
  // 하나 고치면 다음 하나가 나오는 식이면 사람은 다섯 번 저장하고 그만둔다.
  const check = D.readiness({
    directive: directive({ background: "", goal: "" }),
    orders: [order({ weight: 40, deliverable: "", hours: 0 })],
  });
  assert.equal(check.ok, false);
  assert.ok(check.missing.length >= 5, `한 번에 다 말해야 한다: ${check.missing.length}개`);
  assert.ok(check.missing.some(note => /가중치 합이 40%/u.test(note)));
  assert.ok(check.missing.some(note => /산출물이 안 적힌 지시가 1건/u.test(note)));
  assert.ok(check.missing.some(note => /예상 시간이 없는 지시가 1건/u.test(note)));
});

test("가중치 합이 100 이어야 내보낼 수 있다", () => {
  const short = D.readiness({ directive: directive(), orders: [order({ weight: 60 })] });
  assert.equal(short.ok, false);
  assert.ok(short.missing.some(note => /무엇이 더 중요한지 정해지지 않은 것/u.test(note)));

  const full = D.readiness({ directive: directive(), orders: [order({ weight: 60 }), order({ id: "o2", weight: 40 })] });
  assert.equal(full.ok, true);
  assert.deepEqual(full.missing, []);
});

test("지시가 하나도 없으면 낼 것이 없다", () => {
  const check = D.readiness({ directive: directive(), orders: [] });
  assert.equal(check.ok, false);
  // 지시는 업무지시 화면에서 낸다. 여기서 만들 수 있게 하면 두 곳이 어긋난다.
  assert.ok(check.missing.some(note => /업무지시 화면에서 먼저 내 주세요/u.test(note)));
});

test("시간이 넘치는 것은 알려만 주고 막지 않는다", () => {
  // 넘치는 주가 있을 수 있다. 알고 내는 것과 모르고 내는 것이 다를 뿐이다.
  const check = D.readiness({ directive: directive(), orders: [order({ hours: 30 })], capacityHours: 22 });
  assert.equal(check.ok, true);
  assert.ok(check.warnings.some(note => /8시간 많습니다/u.test(note)));

  // 시간표를 안 넣었으면 넘쳤는지 판단하지 않는다. 0 으로 나누면 누구든
  // 넘친 것으로 나온다.
  const unknown = D.readiness({ directive: directive(), orders: [order({ hours: 30 })] });
  assert.equal(unknown.sheet.over, 0);
  assert.ok(!unknown.warnings.some(note => /많습니다/u.test(note)));
});

test("안 하면 잃는 것과 안 하는 것은 잔소리로만 남긴다", () => {
  const check = D.readiness({ directive: directive(), orders: [order()] });
  assert.equal(check.ok, true);
  assert.ok(check.warnings.some(note => /하면 좋은 일' 로 읽힙니다/u.test(note)));
  assert.ok(check.warnings.some(note => /범위를 넓게 잡습니다/u.test(note)));

  const filled = D.readiness({
    directive: directive({ loss: "갱신 면담에서 할 말이 없어집니다.", scopeExclude: "배관 교체는 이번 주에 하지 않습니다." }),
    orders: [order()],
  });
  assert.deepEqual(filled.warnings, []);
});

test("내보내기 전에는 지시가 아니다", () => {
  assert.equal(D.assemble({ directive: directive(), orders: [order()] }).published, false);
  assert.equal(D.assemble({ directive: directive({ publishedAt: "2026-09-07T09:00:00Z" }), orders: [order()] }).published, true);
});

// --- 월요일 아침 판 ---

test("아직 못 받은 사람을 맨 위로 올린다", () => {
  // 안 받은 사람이 밑에 깔리면 그 사람은 그 주를 그냥 보낸다.
  const board = D.weekBoard({
    asOf: "2026-09-09",
    people: [
      { uid: "u-hwang", name: "황우중", capacityHours: 22 },
      { uid: "u-kim", name: "김현진", capacityHours: 40 },
      { uid: "u-seo", name: "서창환", capacityHours: 51 },
    ],
    directives: [
      directive({ uid: "u-hwang", publishedAt: "2026-09-07T09:00:00Z" }),
      directive({ uid: "u-kim", name: "김현진" }), // 쓰다 말았다
    ],
    orders: [order({ assigneeUid: "u-hwang", hours: 30 })],
  });
  assert.deepEqual(board.map(row => row.name), ["서창환", "김현진", "황우중"]);
  assert.equal(board[0].has, false);
  assert.equal(board[1].published, false);
  assert.equal(board[2].published, true);
  // 넘치는 것도 그 자리에서 보인다.
  assert.equal(board[2].over, 8);
  assert.equal(board[2].hours, 30);
});

test("지난 주 지시서는 이번 주 판에 안 섞인다", () => {
  const board = D.weekBoard({
    asOf: "2026-09-09",
    people: [{ uid: "u-hwang", name: "황우중" }],
    directives: [directive({ weekStart: "2026-08-31", publishedAt: "2026-08-31T09:00:00Z" })],
    orders: [],
  });
  assert.equal(board[0].has, false);
});

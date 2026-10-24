const assert = require("node:assert/strict");
const test = require("node:test");

const S = require("../src/supply-core");

const item = patch => Object.assign({ id: "i1", name: "락스", unit: "통" }, patch);
const move = patch => Object.assign({ id: "m1", itemId: "i1", kind: "out", qty: 1, date: "2026-09-01" }, patch);

test("이름과 단위가 없으면 품목을 만들 수 없다", () => {
  assert.equal(S.validateItem({ id: "i1" }).code, "NAME_REQUIRED");
  assert.equal(S.validateItem({ id: "i1", name: "락스", unit: "" }).ok, true, "단위는 비면 '개'로 채운다");
  assert.equal(S.validateItem({ id: "", name: "락스" }).code, "VALIDATION_ERROR");
  assert.equal(S.validateItem(item()).ok, true);
});

test("남은 수량은 저장하지 않고 기록에서 다시 센다", () => {
  const moves = [
    move({ id: "m1", kind: "in", qty: 10, date: "2026-09-01" }),
    move({ id: "m2", kind: "out", qty: 3, date: "2026-09-02" }),
    move({ id: "m3", kind: "disposal", qty: 1, date: "2026-09-03", reason: "깨짐" }),
  ];
  assert.equal(S.stockOf("i1", moves), 6);
  assert.equal(S.stockMap([item()], moves).i1, 6);
});

test("실사는 그 앞을 지우고 그 숫자로 맞춘다", () => {
  // 세어 보니 4개였다면, 그 앞의 계산이 무엇이었든 4개다. 그게 실사다.
  const moves = [
    move({ id: "m1", kind: "in", qty: 10, date: "2026-09-01" }),
    move({ id: "m2", kind: "adjust", qty: 4, date: "2026-09-05", reason: "재고조사" }),
    move({ id: "m3", kind: "out", qty: 1, date: "2026-09-06" }),
  ];
  assert.equal(S.stockOf("i1", moves), 3);
});

test("기록 순서는 날짜로 정한다 — 적은 순서가 아니라", () => {
  // 어제 쓴 것을 오늘 적는 일이 흔하다. 적은 순서로 세면 실사가 뒤집힌다.
  const moves = [
    move({ id: "m3", kind: "out", qty: 1, date: "2026-09-06", createdAt: "2026-09-06T01:00:00Z" }),
    move({ id: "m1", kind: "in", qty: 10, date: "2026-09-01", createdAt: "2026-09-06T02:00:00Z" }),
    move({ id: "m2", kind: "adjust", qty: 4, date: "2026-09-05", createdAt: "2026-09-06T03:00:00Z" }),
  ];
  assert.equal(S.stockOf("i1", moves), 3);
  assert.deepEqual(S.sortMoves(moves).map(row => row.id), ["m1", "m2", "m3"]);
});

test("재고는 음수로 내려가지 않는다", () => {
  // 안 적고 쓴 것이 있으면 마이너스가 나온다. 마이너스 재고는 사람에게
  // 아무것도 알려주지 않는다. 0 으로 두고 실사로 바로잡게 한다.
  assert.equal(S.stockOf("i1", [move({ kind: "out", qty: 5 })]), 0);
});

test("네 가지를 일하는 사람 누구나 적는다", () => {
  // 물건을 받는 사람과 세는 사람이 대표가 아닌데 대표만 적게 하면, 받은
  // 날 안 적히고 나중에 기억으로 적힌다.
  assert.equal(S.validateMove(move({ kind: "in", qty: 5 })).ok, true);
  assert.equal(S.validateMove(move({ kind: "adjust", qty: 5, reason: "조사" })).ok, true);
  assert.equal(S.validateMove(move({ kind: "out", qty: 5 })).ok, true);
  assert.deepEqual(S.MOVE_KEYS.slice(), ["in", "out", "disposal", "adjust"]);
  // 사람을 가르던 표시가 남아 있으면 다음 사람이 아직 갈리는 줄 안다.
  S.MOVE_KINDS.forEach(kind => assert.equal("adminOnly" in kind, false, kind.key));
});

test("폐기와 실사는 이유가 있어야 한다", () => {
  assert.equal(S.validateMove(move({ kind: "disposal", qty: 1 })).code, "REASON_REQUIRED");
  assert.equal(S.validateMove(move({ kind: "disposal", qty: 1, reason: "찢어짐" })).ok, true);
  assert.equal(S.validateMove(move({ kind: "adjust", qty: 0 })).code, "REASON_REQUIRED");
});

test("실사만 0 을 받는다 — 세어 보니 없었다는 뜻이다", () => {
  assert.equal(S.validateMove(move({ kind: "out", qty: 0 })).code, "QTY_REQUIRED");
  assert.equal(S.validateMove(move({ kind: "adjust", qty: 0, reason: "다 씀" })).ok, true);
});

test("날짜와 품목이 없으면 적을 수 없다", () => {
  assert.equal(S.validateMove(move({ date: "" })).code, "DATE_REQUIRED");
  assert.equal(S.validateMove(move({ itemId: "" })).code, "ITEM_REQUIRED");
});

test("수량은 정수만 남는다", () => {
  assert.equal(S.normalizeMove({ qty: 2.4 }).qty, 2);
  assert.equal(S.normalizeMove({ qty: -5 }).qty, 0);
  assert.equal(S.normalizeMove({ qty: "3" }).qty, 3);
  assert.equal(S.normalizeMove({ qty: "세 개" }).qty, 0);
});

test("부족한 것은 0 개인 것부터 보여 준다", () => {
  const items = [
    item({ id: "i1", name: "락스", minStock: 5 }),
    item({ id: "i2", name: "마대", minStock: 2 }),
    item({ id: "i3", name: "장갑", minStock: 0 }),
    item({ id: "i4", name: "안 쓰는 것", minStock: 9, active: false }),
  ];
  const moves = [
    move({ id: "m1", itemId: "i1", kind: "in", qty: 2, date: "2026-09-01" }),
    move({ id: "m2", itemId: "i2", kind: "in", qty: 9, date: "2026-09-01" }),
  ];
  const low = S.lowStock(items, moves);
  assert.deepEqual(low.map(row => row.id), ["i3", "i1"], "0 개인 것이 먼저");
  assert.equal(low.find(row => row.id === "i1").stock, 2);
});

test("최소 수량을 안 적었으면 다 떨어졌을 때만 알린다", () => {
  // 최소 수량을 0 으로 두는 건 "정해 두지 않았다"는 뜻이지 "0 개면 된다"가
  // 아니다. 안 정한 물건까지 매번 경고하면 경고를 아무도 안 본다.
  const items = [item({ id: "i1", minStock: 0 })];
  assert.equal(S.lowStock(items, [move({ kind: "in", qty: 1 })]).length, 0);
  assert.equal(S.lowStock(items, []).length, 1);
});

test("분류는 빈 칸도 남긴다", () => {
  const grouped = S.groupByCategory([item({ category: "clean" })], []);
  assert.deepEqual(grouped.map(row => row.key), S.CATEGORY_KEYS.slice());
  assert.equal(grouped.find(row => row.key === "clean").items.length, 1);
  assert.equal(grouped.find(row => row.key === "tool").items.length, 0);
});

test("모르는 분류는 기타로 내린다", () => {
  assert.equal(S.normalizeItem({ category: "우리끼리쓰는말" }).category, "etc");
  assert.equal(S.categoryLabel("clean"), "청소용품");
});

test("이번 달 요약은 이번 달 것만 센다", () => {
  const items = [item({ id: "i1", minStock: 5 }), item({ id: "i2", active: false })];
  const moves = [
    move({ id: "m1", kind: "in", qty: 9, date: "2026-08-30" }),
    move({ id: "m2", kind: "out", qty: 3, date: "2026-09-02" }),
    move({ id: "m3", kind: "out", qty: 4, date: "2026-09-04" }),
  ];
  const sum = S.summarize(items, moves, "2026-09-06");
  assert.equal(sum.items, 1);
  assert.equal(sum.retired, 1);
  assert.equal(sum.movesThisMonth, 2);
  assert.equal(sum.usedThisMonth, 7);
  assert.equal(sum.low, 1, "9 받아 7 썼으니 2 개 — 최소 5 아래");
});

test("한 품목의 기록은 최근 것부터 준다", () => {
  const moves = [
    move({ id: "m1", date: "2026-09-01" }),
    move({ id: "m2", date: "2026-09-05" }),
    move({ id: "m3", itemId: "i2", date: "2026-09-09" }),
  ];
  assert.deepEqual(S.movesOfItem("i1", moves).map(row => row.id), ["m2", "m1"]);
  assert.deepEqual(S.recentMoves(moves, 2).map(row => row.id), ["m3", "m2"]);
  assert.equal(S.lastMovedMap(moves).i1, "2026-09-05");
});

test("단가는 따로 다룬다", () => {
  assert.equal(S.validateCost({ unitPrice: 3000 }).code, "ITEM_REQUIRED");
  assert.equal(S.normalizeCost({ itemId: "i1", unitPrice: 3200.6 }).unitPrice, 3201);
  assert.equal(S.normalizeCost({ itemId: "i1", unitPrice: -5 }).unitPrice, 0);
  assert.equal(S.normalizeCost({ itemId: "i1", unitPrice: "비쌈" }).unitPrice, 0);
});

test("품목을 찾을 수 있다", () => {
  assert.equal(S.findItem([item()], "i1").name, "락스");
  assert.equal(S.findItem([item()], "없음"), null);
  assert.equal(S.findItem([item()], ""), null);
});

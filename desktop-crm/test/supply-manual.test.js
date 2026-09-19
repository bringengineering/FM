const assert = require("node:assert/strict");
const test = require("node:test");

const S = require("../src/supply-core");

const items = [
  { id: "i-lax", name: "락스 4L", unit: "통", category: "clean" },
  { id: "i-glove", name: "고무장갑", unit: "켤레", category: "safety" },
];
const plan = (source, options) => S.planManualEntry(source, Object.assign({ items, date: "2026-09-06", makeId: makeId() }, options));

// 검사가 무작위 값에 기대면 실패를 다시 만들 수 없다.
function makeId() {
  let n = 0;
  return () => {
    n += 1;
    return `id${n}`;
  };
}

test("한 줄이 그대로 한 기록이 된다", () => {
  const made = plan("락스 4L 2통 입고 쿠팡");
  assert.equal(made.ok, true);
  assert.equal(made.entries.length, 1);
  const entry = made.entries[0];
  assert.equal(entry.name, "락스 4L");
  assert.equal(entry.qty, 2);
  assert.equal(entry.unit, "통");
  assert.equal(entry.kind, "in");
  assert.equal(entry.reason, "쿠팡");
  assert.equal(entry.itemId, "i-lax", "이미 있는 품목에 붙어야 한다");
  assert.equal(entry.isNew, false);
});

test("규격이 아니라 수량을 집는다", () => {
  // "락스 4L 2통" 에서 4L 은 이름의 일부다. 앞의 숫자를 집으면 재고가
  // 4 통 늘어난다 — 두 배로 틀린다.
  const entry = S.parseManualLine("락스 4L 2통 입고", { date: "2026-09-06" });
  assert.equal(entry.name, "락스 4L");
  assert.equal(entry.qty, 2);
});

test("없는 품목은 적는 김에 같이 만든다", () => {
  const made = plan("극세사걸레 5개 입고 다이소");
  assert.equal(made.ok, true);
  assert.equal(made.entries[0].isNew, true);
  assert.equal(made.newItems.length, 1);
  assert.equal(made.newItems[0].name, "극세사걸레");
  assert.equal(made.newItems[0].unit, "개");
  assert.equal(made.newItems[0].id, made.entries[0].itemId, "만든 품목에 붙어야 한다");
});

test("같은 이름이 두 줄에 나와도 품목은 하나만 만든다", () => {
  const made = plan("수세미 3개 입고\n수세미 2개 사용");
  assert.equal(made.newItems.length, 1);
  assert.equal(made.entries[0].itemId, made.entries[1].itemId);
});

test("띄어쓰기와 대소문자가 달라도 같은 품목으로 본다", () => {
  // 사람은 "락스4L" 이라고도 치고 "락스 4l" 이라고도 친다.
  const made = plan("락스4l 1통 입고");
  assert.equal(made.entries[0].itemId, "i-lax");
  assert.equal(made.newItems.length, 0);
});

test("낱말로 종류를 가른다", () => {
  const kinds = ["입고", "구매", "사용", "씀", "폐기", "버림", "실사"].map(word => S.kindFromWord(word));
  assert.deepEqual(kinds, ["in", "in", "out", "out", "disposal", "disposal", "adjust"]);
  assert.equal(S.kindFromWord("아무거나"), "");
});

test("종류를 안 적으면 위에서 고른 것을 쓴다", () => {
  // 짐작해서 사용으로 잡으면 재고가 줄어든다. 사람이 고른 것을 따른다.
  const asOut = plan("고무장갑 2켤레", { kind: "out" });
  assert.equal(asOut.entries[0].kind, "out");
  const asIn = plan("고무장갑 2켤레");
  assert.equal(asIn.entries[0].kind, "in");
});

test("날짜를 앞에 적으면 그날로 간다", () => {
  const made = plan("9/5 고무장갑 2켤레 입고\n2026-09-01 고무장갑 1켤레 사용\n고무장갑 3켤레 입고");
  assert.deepEqual(made.entries.map(entry => entry.date), ["2026-09-05", "2026-09-01", "2026-09-06"]);
  assert.equal(S.parseDateToken("13/40", 2026), "", "말이 안 되는 날짜는 안 받는다");
  assert.equal(S.parseDateToken("그냥글자", 2026), "");
});

test("엑셀에서 붙여 넣으면 칸을 짐작하지 않는다", () => {
  // 탭으로 이미 갈라져 있는데 다시 짐작하면 틀릴 일만 남는다.
  const made = plan("사다리 2대\t1\t입고\t자재상에서 삼");
  const entry = made.entries[0];
  assert.equal(entry.name, "사다리 2대");
  assert.equal(entry.qty, 1);
  assert.equal(entry.reason, "자재상에서 삼");
});

test("빈 줄과 # 로 시작하는 줄은 넘긴다", () => {
  const made = plan("# 9월 다이소\n\n고무장갑 2켤레 입고\n\n");
  assert.equal(made.entries.length, 1);
});

test("못 읽은 줄이 하나라도 있으면 통째로 막는다", () => {
  // 반만 저장되면 어디까지 들어갔는지 사람이 다시 세어야 한다.
  const made = plan("고무장갑 2켤레 입고\n3개 입고");
  assert.equal(made.ok, false);
  assert.equal(made.errorCount, 1);
  assert.equal(made.entries[1].code, "NAME_REQUIRED");
  assert.equal(made.entries[0].ok, true, "읽은 줄은 읽었다고 보여 줘야 고칠 수 있다");
});

test("막힌 줄이 만든 품목은 딸려 들어가지 않는다", () => {
  // 수량이 빠져 저장 못 할 줄인데 품목만 남으면 유령 품목이 쌓인다.
  const made = plan("이상한물건 폐기");
  assert.equal(made.ok, false);
  assert.equal(made.newItems.length, 0);
});

test("폐기는 이유가 있어야 한다", () => {
  const made = plan("고무장갑 2켤레 폐기");
  assert.equal(made.entries[0].code, "REASON_REQUIRED");
  assert.equal(plan("고무장갑 2켤레 폐기 젖어서 버림").ok, true);
});

test("아무것도 안 적으면 저장할 것이 없다", () => {
  const made = plan("   \n\n");
  assert.equal(made.ok, false);
  assert.equal(made.moves.length, 0);
});

test("나온 기록은 평소 기록과 같은 모양이다", () => {
  // 모양이 다르면 재고 계산이 이 기록만 빼먹는다.
  const made = plan("고무장갑 4켤레 입고");
  const move = made.moves[0];
  assert.deepEqual(Object.keys(move).sort(), Object.keys(S.normalizeMove({})).sort());
  assert.equal(S.stockOf("i-glove", made.moves), 4);
});

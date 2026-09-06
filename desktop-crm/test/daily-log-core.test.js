const assert = require("node:assert/strict");
const test = require("node:test");

const D = require("../src/daily-log-core");

// 실제 일지에서 가져온 하루. 지어낸 값으로 검사하면 지어낸 것만 통과한다.
// 김현진 2026-09-02: BRING OFFICE 통합(혁신), AI 견적서(혁신), 수업(기존).
const entry = (patch = {}) => Object.assign({
  id: "e1", start: "09:00", end: "11:00", title: "BRING OFFICE 통합",
  nature: "innovation", orderId: "wo1", progress: 60,
}, patch);

const day = (patch = {}) => Object.assign({
  id: "u-kim_2026-09-02", uid: "u-kim", name: "김현진", date: "2026-09-02",
  entries: [entry()],
  plans: [{ id: "p1", title: "견적서 화면 마무리", nature: "innovation", hours: 3, dueDate: "2026-09-03" }],
}, patch);

test("소요시간을 따로 받지 않고 시각에서 뽑는다", () => {
  // 엑셀에는 "13:00~15:00" 과 "2H" 가 따로 있었고 안 맞는 날이 있었다.
  // 두 숫자가 다르면 어느 것이 맞는지 아무도 모른다.
  assert.equal(D.entryMinutes(entry({ start: "09:00", end: "11:00" })), 120);
  assert.equal(D.entryMinutes(entry({ start: "11:00", end: "18:00" })), 420);
  assert.equal(D.entryMinutes(entry({ start: "", end: "11:00" })), 0);
  const kept = D.normalizeEntry(entry({ hours: 99 }));
  assert.ok(!("hours" in kept), "소요시간 칸을 따로 두면 두 숫자가 어긋난다");
});

test("쓰는 중인 줄은 들고 있고, 저장할 때 성한 줄만 남긴다", () => {
  // [줄 넣기] 를 누르면 아직 아무것도 안 찬 줄이 하나 생긴다. 그 줄을 그
  // 자리에서 버리면 버튼을 눌러도 아무 일이 안 일어난 것처럼 보인다.
  const half = [
    entry(),
    entry({ id: "e2", title: "" }),                       // 무엇을 했는지 없다
    entry({ id: "e3", start: "15:00", end: "13:00" }),      // 거꾸로다
    entry({ id: "", title: "번호 없음" }),                   // 번호가 없으면 줄이 아니다
  ];
  const draft = D.normalizeDay(day({ entries: half }));
  assert.deepEqual(draft.entries.map(item => item.id), ["e1", "e2", "e3"]);

  // 저장되는 것은 성한 줄뿐이고, 몇 개를 뺐는지 말해 준다.
  const checked = D.validateDay(day({ entries: half }));
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.day.entries.map(item => item.id), ["e1"]);
  assert.ok(checked.notes.some(note => /덜 찬 줄 2개는 저장하지 않습니다/u.test(note)));

  // 합계도 성한 줄만 센다. 반만 찬 줄을 0분으로 더하면 줄 수만 늘어난다.
  assert.equal(D.summarize(day({ entries: half })).entries, 1);
});

test("모르는 성격은 기존으로 둔다", () => {
  // 새 이름이 들어와 조용히 사라지면 그 줄의 시간이 어느 칸에도 안 잡힌다.
  assert.equal(D.normalizeEntry(entry({ nature: "창의" })).nature, "routine");
  assert.equal(D.normalizeEntry(entry({ nature: "urgent" })).nature, "urgent");
  assert.deepEqual(D.NATURES.map(item => item.key), ["urgent", "innovation", "routine"]);
  // 팀원이 처음 보는 말이라 뜻을 같이 들고 있어야 한다.
  assert.equal(D.NATURES.every(item => item.meaning), true);
});

test("겹친 시간을 두 번 세지 않는다", () => {
  // 회의하면서 다른 일을 같이 적는 날이 있다. 두 번 세면 하루가 26시간이 되고
  // 그 숫자가 월간 보고서까지 올라간다.
  const summary = D.summarize(day({
    entries: [
      entry({ id: "e1", start: "09:00", end: "12:00" }),
      entry({ id: "e2", start: "11:00", end: "13:00" }),
    ],
  }));
  assert.equal(summary.sumMinutes, 300);
  assert.equal(summary.totalMinutes, 240);
  assert.equal(summary.hours, 4);
  assert.equal(summary.overlapMinutes, 60);
});

test("겹친 줄을 막지는 않고 알려만 준다", () => {
  const clash = D.overlaps([
    entry({ id: "e1", start: "09:00", end: "12:00" }),
    entry({ id: "e2", start: "11:00", end: "13:00" }),
    entry({ id: "e3", start: "14:00", end: "15:00" }),
  ]);
  assert.equal(clash.length, 1);
  assert.equal(clash[0].minutes, 60);
  // 막으면 실제로 있었던 일을 못 적게 된다.
  const checked = D.validateDay(day({
    entries: [entry({ id: "e1", start: "09:00", end: "12:00" }), entry({ id: "e2", start: "11:00", end: "13:00" })],
  }));
  assert.equal(checked.ok, true);
  assert.ok(checked.notes.some(note => /겹치는 줄이 1개/u.test(note)));
});

test("성격별 시간과 비율을 낸다", () => {
  const summary = D.summarize(day({
    entries: [
      entry({ id: "e1", start: "09:00", end: "11:00", nature: "innovation" }),
      entry({ id: "e2", start: "11:00", end: "18:00", nature: "routine", title: "수업" }),
      entry({ id: "e3", start: "18:00", end: "19:00", nature: "urgent", title: "누수 연락" }),
    ],
  }));
  const find = key => summary.byNature.find(item => item.key === key);
  assert.equal(find("innovation").hours, 2);
  assert.equal(find("routine").hours, 7);
  assert.equal(find("urgent").hours, 1);
  assert.equal(find("routine").percent, 70);
  assert.equal(summary.byNature.reduce((total, item) => total + item.percent, 0), 100);
});

test("달성률을 시간으로 가중해서도 낸다", () => {
  // 10분짜리 100% 와 6시간짜리 20% 의 평균은 60% 지만, 그날 실제로 된 일은
  // 20% 쪽이다. 두 숫자가 벌어지면 "작은 일만 끝냈다" 는 신호다.
  const summary = D.summarize(day({
    entries: [
      entry({ id: "e1", start: "09:00", end: "09:10", progress: 100 }),
      entry({ id: "e2", start: "10:00", end: "16:00", progress: 20 }),
    ],
  }));
  assert.equal(summary.plainProgress, 60);
  assert.equal(summary.weightedProgress, 22);
  assert.notEqual(summary.plainProgress, summary.weightedProgress);
});

test("지시에 안 붙은 시간을 따로 센다", () => {
  // 이게 크면 시킨 일 밖에서 하루가 갔다는 뜻이다.
  const summary = D.summarize(day({
    entries: [
      entry({ id: "e1", start: "09:00", end: "11:00", orderId: "wo1" }),
      entry({ id: "e2", start: "11:00", end: "14:00", orderId: "" }),
    ],
  }));
  assert.equal(summary.looseMinutes, 180);
});

test("한 줄도 없으면 보내지 못한다", () => {
  const empty = D.validateDay(day({ entries: [] }));
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "ENTRY_REQUIRED");
  assert.equal(D.validateDay(day({ uid: "" })).code, "UID_REQUIRED");
  assert.equal(D.validateDay(day({ date: "" })).code, "DATE_REQUIRED");
});

test("나머지는 막지 않고 잔소리로 남긴다", () => {
  // 보내는 것을 자꾸 막으면 사람들은 아예 안 적는다.
  const checked = D.validateDay(day({ entries: [entry({ orderId: "" })], plans: [] }));
  assert.equal(checked.ok, true);
  assert.ok(checked.notes.some(note => /업무지시에 안 붙은 줄/u.test(note)));
  assert.ok(checked.notes.some(note => /내일 할 일이 비어 있습니다/u.test(note)));
});

test("보냈는지 대표가 봤는지를 나눠서 본다", () => {
  const plain = D.summarize(day());
  assert.equal(plain.submitted, false);
  assert.equal(plain.confirmed, false);
  const sent = D.summarize(day({ submittedAt: "2026-09-02T18:00:00Z" }));
  assert.equal(sent.submitted, true);
  assert.equal(sent.confirmed, false);
  const seen = D.summarize(day({ submittedAt: "2026-09-02T18:00:00Z", confirmedBy: "u-seo" }));
  assert.equal(seen.confirmed, true);
});

// --- 업무지시로 되올리기 ---

test("한 지시에 줄이 여럿이면 마지막 달성률을 쓴다", () => {
  // 평균을 내면 아침에 30% 저녁에 90% 인 날이 60% 가 되는데, 그 지시는 지금 90% 다.
  const rollup = D.orderRollup(day({
    entries: [
      entry({ id: "e1", start: "09:00", end: "11:00", orderId: "wo1", progress: 30 }),
      entry({ id: "e2", start: "15:00", end: "17:00", orderId: "wo1", progress: 90 }),
      entry({ id: "e3", start: "11:00", end: "12:00", orderId: "wo2", progress: 50 }),
    ],
  }));
  const first = rollup.find(item => item.orderId === "wo1");
  assert.equal(first.progress, 90);
  assert.equal(first.hours, 4);
  assert.equal(first.entries, 2);
  // 시간이 많이 간 지시부터 위로.
  assert.equal(rollup[0].orderId, "wo1");
  // 지시에 안 붙은 줄은 되올릴 곳이 없다.
  assert.equal(rollup.some(item => !item.orderId), false);
});

// --- 한 주 ---

test("주는 월요일에 시작하고, 안 적은 날을 그대로 남긴다", () => {
  assert.equal(D.weekStart("2026-09-06"), "2026-08-31"); // 일요일
  assert.equal(D.weekStart("2026-09-02"), "2026-08-31");
  const week = D.weekRollup({
    uid: "u-kim",
    asOf: "2026-09-02",
    days: [
      day({ date: "2026-09-01", entries: [entry({ start: "09:00", end: "12:00" })] }),
      day({ date: "2026-09-02", entries: [entry({ start: "09:00", end: "13:00" })] }),
      // 남의 일지는 안 센다.
      day({ date: "2026-09-02", uid: "u-hwang", entries: [entry({ start: "09:00", end: "20:00" })] }),
      // 지난 주 것도 안 센다.
      day({ date: "2026-08-28", entries: [entry({ start: "09:00", end: "20:00" })] }),
    ],
  });
  assert.equal(week.written, 2);
  assert.equal(week.hours, 7);
  // 빈 날을 0시간으로 채우면 "쉬었다" 와 "안 적었다" 가 같아진다.
  assert.deepEqual(week.missing, ["2026-08-31", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
});

test("한 주의 성격 비율이 하루의 합과 맞는다", () => {
  const week = D.weekRollup({
    uid: "u-kim",
    asOf: "2026-09-02",
    days: [
      day({ date: "2026-09-01", entries: [entry({ start: "09:00", end: "12:00", nature: "innovation" })] }),
      day({ date: "2026-09-02", entries: [entry({ start: "09:00", end: "16:00", nature: "routine" })] }),
    ],
  });
  const routine = week.byNature.find(item => item.key === "routine");
  assert.equal(routine.hours, 7);
  assert.equal(routine.percent, 70);
  // 하던 일만 하는 주가 이어지면 회사는 그 자리에 선다. 그걸 보이게 하려고 센다.
  assert.equal(week.byNature.find(item => item.key === "innovation").percent, 30);
});

// --- AI 에 넘기는 사실 ---

test("AI 에는 이미 센 숫자만 넘기고 총평은 넘기지 않는다", () => {
  const facts = D.reportFacts(day({
    blockers: "건물주가 전화를 안 받습니다.",
    entries: [entry({ start: "09:00", end: "11:00", orderId: "wo1", progress: 60 })],
  }), { orderTitles: { wo1: "BRING OFFICE 통합" } });

  assert.equal(facts.totals.hours, 2);
  assert.equal(facts.totals.weightedProgress, 60);
  assert.equal(facts.entries[0].order, "BRING OFFICE 통합");
  assert.equal(facts.entries[0].time, "09:00~11:00");
  assert.equal(facts.entries[0].nature, "혁신");
  // 사람이 쓴 말은 그대로 넘긴다. 줄여서 넘기면 AI 는 요약의 요약을 쓴다.
  assert.equal(facts.words.blockers, "건물주가 전화를 안 받습니다.");
  // 문장은 AI 가 쓴다. 여기서 총평을 만들면 문장이 마음에 안 들 때 무엇을
  // 고쳐야 하는지 알 수 없다.
  assert.ok(!("summary" in facts) && !("comment" in facts));
});

test("지시 이름을 모르면 번호를 그대로 넘긴다", () => {
  // 빈칸으로 넘기면 AI 가 어느 일인지 모르고 지어낸다.
  const facts = D.reportFacts(day(), {});
  assert.equal(facts.entries[0].order, "wo1");
});

test("일지 번호는 사람과 날짜로 정해진다", () => {
  // 하루에 두 장이 생기면 어느 것이 그날인지 알 수 없다.
  assert.equal(D.dayId("u-kim", "2026-09-02"), "u-kim_2026-09-02");
});
